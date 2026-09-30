import fs from "node:fs";
import cfg from "./config.js";
import { fetchEbayAuctions } from "./ebay.js";
import { fetchGov } from "./gov.js";
import { classify } from "./classify.js";
import { getActive, activeMedian, loadSold, compSummary } from "./comps.js";
import { maxCostPerPiece, costRates, price, groupTrips } from "./deals.js";
import { buildEmail, sendEmail } from "./email.js";
import { apifyUsage } from "./apify.js";
import { zipLatLng, cityLatLng, milesBetween, money } from "./util.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayInTz(tz) {
  return new Date().toLocaleDateString("en-US", { timeZone: tz, weekday: "short" }).slice(0, 3);
}

// Look ahead until the next gov scan day, plus a few hours of overlap.
function govHoursAhead(today, scanDays) {
  const t = DAYS.indexOf(today);
  for (let i = 1; i <= 7; i++) {
    if (scanDays.includes(DAYS[(t + i) % 7])) return i * 24 + 6;
  }
  return 7 * 24 + 6;
}

async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx]); }
  }));
  return results;
}

export async function runAgent(deps = {}) {
  const fetchEbay = deps.fetchEbay || fetchEbayAuctions;
  const fetchGovFn = deps.fetchGov || fetchGov;
  const geocode = deps.geocode || zipLatLng;
  const geocodeCity = deps.geocodeCity || cityLatLng;
  const notes = [], errors = [];

  const today = todayInTz(cfg.timezone);
  const runGov = cfg.govScanDays.includes(today) || process.env.FORCE_GOV === "1";

  // 1. Gather listings
  const ebay = await fetchEbay(cfg, cfg.ebayHoursAhead);
  errors.push(...ebay.errors);
  let listings = [...ebay.listings];
  if (runGov) {
    const gov = await fetchGovFn(cfg, govHoursAhead(today, cfg.govScanDays));
    errors.push(...gov.errors);
    listings.push(...gov.listings);
    if (gov.sampleRaw && process.env.DEBUG) console.log("GovDeals sample record:", JSON.stringify(gov.sampleRaw, null, 2));
    const unknownEnd = gov.listings.filter((l) => !l.endsAt).length;
    if (unknownEnd) notes.push(`${unknownEnd} government listings had no end time, so the scraper output may have changed.`);
  }
  const totalFetched = listings.length;
  console.log(`Fetched ${listings.length} listings (gov sites ${runGov ? "included" : "skipped today"}).`);

  // 2. Read each listing and check pickup distance
  const home = await geocode(cfg.homeZip);
  listings = listings.map((l) => classify(l, cfg)).map((l) => {
    if (l.shippingIn !== null) return l;
    // eBay "calculated" shipping: estimate it so the item isn't thrown out
    const est = (cfg.shipOutEstimate[l.category] ?? cfg.shipOutEstimate.other) * l.pieces;
    return { ...l, shippingIn: est, flags: [...l.flags, `Shipping to you estimated at ${money(est)}`] };
  });
  listings = await pool(listings, 4, async (l) => {
    if (!l.pickup) return l;
    let where = null;
    if (l.pickupZip) where = await geocode(l.pickupZip);
    if (!where && l.pickupCity) where = await geocodeCity(l.pickupCity, cfg.homeState);
    const miles = where && home ? milesBetween(home, where) : null;
    return { ...l, miles };
  });
  listings = listings.filter((l) => {
    if (!l.pickup) return true;
    if (l.miles != null) return l.miles <= cfg.maxPickupMiles;
    if (l.source === "ebay") return true; // eBay already filtered by radius
    l.lookReason ??= "Couldn't find the pickup location, check distance";
    return true;
  });

  // Your size rule: skip anything bigger than about 2 ft x 2 ft
  const bigCount = listings.filter((l) => l.tooBig).length;
  listings = listings.filter((l) => !l.tooBig);
  // Your spending limit: skip anything already past it
  const overCap = listings.filter((l) => (l.minNextBid ?? l.currentBid) > cfg.maxBidCap).length;
  listings = listings.filter((l) => (l.minNextBid ?? l.currentBid) <= cfg.maxBidCap);

  const looks = listings.filter((l) => l.lookReason);
  let candidates = listings.filter((l) => !l.lookReason);

  // 3. Free pre-screen using active eBay listings
  const queries = [...new Set(candidates.map((l) => l.compQuery))];
  const active = {};
  await pool(queries, 5, async (q) => {
    try { active[q] = await getActive(q, cfg); } catch (e) { errors.push(`Active comps "${q}": ${e.message}`); }
  });
  const mustBeat = (l) => l.minNextBid ?? (l.bidCount ? l.currentBid + 0.5 : l.currentBid);
  candidates = candidates
    .map((l) => {
      const am = activeMedian(active[l.compQuery], l.compQuery);
      if (am == null) return { ...l, headroom: 0 }; // unknown: still worth a sold-comp check
      const { cost } = maxCostPerPiece(am * l.valueFactor, cfg.multipleTiers);
      const optimisticBid = (cost * l.pieces - (l.shippingIn ?? 0)) / costRates(l, cfg).factor;
      return { ...l, headroom: optimisticBid - mustBeat(l) };
    })
    .filter((l) => l.headroom >= 0)
    .sort((a, b) => b.headroom - a.headroom);

  // 4. Real sold comps for survivors (budgeted, cached)
  const soldQueries = [...new Set(candidates.map((l) => l.compQuery))];
  const sold = await loadSold(soldQueries, cfg);
  errors.push(...sold.errors);
  if (sold.skipped) notes.push(`${sold.skipped} item types weren't comped tonight (budget cap). They'll get checked next run.`);

  // 5. Price everything
  const pickupDeals = [], shipped = [];
  for (const l of candidates) {
    const comp = compSummary(l.compQuery, cfg);
    if (!comp.resale) continue;
    if (comp.confidence === "low") {
      looks.push({ ...l, comp, lookReason: `Only ${comp.soldCount} sold comps, too few to trust a max bid` });
      continue;
    }
    const calc = price(l, comp, cfg);
    if (!calc.biddable) continue;
    const deal = { ...l, comp, calc };
    (l.pickup ? pickupDeals : shipped).push(deal);
  }

  const trips = groupTrips(pickupDeals, cfg);
  if (trips.dropped.length) {
    notes.push(`${trips.dropped.length} pickup spot(s) had deals but didn't reach ${money(cfg.minProfitPerPickupTrip)} for the trip.`);
  }
  shipped.sort((a, b) => b.calc.profitAtMax - a.calc.profitAtMax);

  const lookList = looks
    .filter((l) => new Date(l.endsAt) > Date.now() || !l.endsAt)
    .sort((a, b) => (a.pickup === b.pickup ? 0 : a.pickup ? -1 : 1) || String(a.endsAt).localeCompare(String(b.endsAt)))
    .slice(0, cfg.maxWorthALook);

  // 6. Footer notes
  if (bigCount || overCap) notes.push(`Skipped ${bigCount} too-big item(s) and ${overCap} already over your ${money(cfg.maxBidCap)} limit.`);
  const noCert = Object.entries(cfg.resaleCertificateOnFile).filter(([, v]) => !v).map(([k]) => k);
  if (noCert.length) notes.push(`Max bids include ${cfg.salesTaxPercent}% sales tax for: ${noCert.join(", ")}. Flip them to true in config.js once your resale certificate is on file.`);
  const cost = Object.entries(apifyUsage).reduce((s, [k, n]) => s + (n / 1000) * (cfg.apifyPricePer1000[k] || 0), 0);
  notes.push(`Checked ${totalFetched} auctions${runGov ? " across eBay, GovDeals and Public Surplus" : " on eBay (government sites run " + cfg.govScanDays.join(" and ") + ")"}. Estimated Apify cost this run: ${money(cost)}.`);
  if (errors.length) notes.push(`Problems this run (${errors.length}): ${errors.slice(0, 5).join(" | ")}`);

  const dateLabel = new Date().toLocaleDateString("en-US", { timeZone: cfg.timezone, weekday: "long", month: "long", day: "numeric" });
  const email = buildEmail({ trips: trips.keep, shipped, looks: lookList, notes, cfg, dateLabel });
  console.log(`Subject: ${email.subject}`);
  errors.forEach((e) => console.warn("WARN:", e));
  return email;
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAgent()
    .then(async (email) => {
      if (process.env.DRY_RUN === "1") {
        fs.writeFileSync("preview.html", email.html);
        console.log("DRY_RUN: wrote preview.html instead of emailing.");
      } else {
        await sendEmail(email);
        console.log("Email sent.");
      }
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
