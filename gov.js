import { runActor } from "./apify.js";
import { toNum, findZip } from "./util.js";

// Scraper output field names aren't guaranteed, so try several likely names.
const pick = (o, keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((x, p) => (x == null ? x : x[p]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

function premiumFrom(obj) {
  // Look for any field mentioning "premium" and pull a percentage out of it
  for (const [k, v] of Object.entries(obj || {})) {
    if (/premium/i.test(k)) {
      const n = toNum(v);
      if (n !== null && n >= 0 && n <= 30) return n;
    }
  }
  const m = String(obj?.description || "").match(/(\d{1,2}(?:\.\d+)?)\s*%\s*buyer'?s?\s*premium/i);
  return m ? parseFloat(m[1]) : null;
}

// Walk every field of a record, collecting text (so we find the address wherever it's kept)
function allStrings(o, path = "", out = []) {
  if (o == null) return out;
  if (typeof o === "string" || typeof o === "number") out.push({ key: path.toLowerCase(), val: String(o) });
  else if (Array.isArray(o)) o.forEach((v, i) => allStrings(v, `${path}.${i}`, out));
  else if (typeof o === "object") for (const [k, v] of Object.entries(o)) allStrings(v, path ? `${path}.${k}` : k, out);
  return out;
}

// Find where the item is: a zip code, or at least "City, TX"
export function findLocation(it, state) {
  const strs = allStrings(it);
  const locish = strs.filter((s) => /(loc|address|city|zip|postal|pickup|seller|state)/.test(s.key));
  // 1. A zip in a location-type field
  for (const s of locish) {
    const z = /(zip|postal)/.test(s.key) && /^\d{5}(-\d{4})?$/.test(s.val.trim()) ? s.val.trim().slice(0, 5) : findZip(s.val);
    if (z) return { zip: z, text: s.val };
  }
  // 2. "TX 77002" anywhere (a bare 5-digit number could be an asset number, so require the state)
  const st = `(?:${state}|Texas)`;
  for (const s of strs) {
    const m = s.val.match(new RegExp(`\\b${st},?\\s+(\\d{5})\\b`, "i"));
    if (m) return { zip: m[1], text: s.val };
  }
  // 3. "Pasadena, TX" -> look up by city
  for (const s of [...locish, ...strs]) {
    const m = s.val.match(new RegExp(`([A-Za-z][A-Za-z .'-]{1,40}),\\s*${st}\\b`, "i"));
    if (m) return { city: m[1].trim().split(/\s{2,}|\n/).pop(), text: s.val };
  }
  // 4. Separate city + state fields
  const city = strs.find((s) => /(^|\.)city$/.test(s.key));
  if (city) return { city: city.val, text: city.val };
  return { text: "" };
}

function normGovDeals(it, search, state) {
  const loc = findLocation(it, state);
  const locText = loc.text.slice(0, 120);
  const id = pick(it, ["assetId", "id", "itemId", "auctionId", "accountId"]) ?? pick(it, ["url"]);
  return {
    id: `govdeals:${id}`,
    source: "govdeals",
    title: String(pick(it, ["title", "name", "assetTitle", "description"]) || "").slice(0, 200),
    description: String(pick(it, ["description", "shortDescription", "details"]) || ""),
    condition: String(pick(it, ["condition"]) || ""),
    url: pick(it, ["url", "link", "assetUrl", "listingUrl"]),
    imageUrl: pick(it, ["imageUrl", "image", "photo", "thumbnail", "thumbnailUrl", "images.0", "photos.0"]),
    currentBid: toNum(pick(it, ["currentBid", "currentBidUsd", "current_bid", "currentPrice", "price", "bid"])) ?? 0,
    minNextBid: toNum(pick(it, ["minimumBid", "minBid", "nextBid", "minimumNextBid"])),
    bidCount: toNum(pick(it, ["bidCount", "bids", "numberOfBids"])),
    endsAt: pick(it, ["endDate", "endsAt", "auctionEndDate", "endTime", "closeDate", "auctionEnd", "endDateTime"]),
    category: search.category,
    searchTerm: search.term,
    pickup: true,
    pickupZip: loc.zip || null,
    pickupCity: loc.city || null,
    pickupText: locText,
    seller: String(pick(it, ["seller", "sellerName", "agency", "seller.name"]) || ""),
    shippingIn: 0,
    premiumPct: premiumFrom(it),
    _raw: it,
  };
}

function normPublicSurplus(it, search) {
  return {
    id: `publicsurplus:${it.auctionId}`,
    source: "publicsurplus",
    title: it.title || "",
    description: it.description || "",
    condition: it.condition || "",
    url: it.url,
    imageUrl: it.imageUrl || null,
    currentBid: toNum(it.currentPriceUsd) ?? 0,
    minNextBid: toNum(it.minimumBidUsd),
    bidCount: toNum(it.bids),
    endsAt: it.endsAt,
    category: search.category,
    searchTerm: search.term,
    pickup: true,
    pickupZip: findZip(it.pickupAddress),
    pickupCity: (String(it.pickupAddress || "").match(/([A-Za-z][A-Za-z .'-]+),\s*[A-Z]{2}\b/) || [])[1]?.trim() || null,
    pickupText: it.pickupAddress || it.state || "",
    seller: it.agency || "",
    shippingIn: 0,
    premiumPct: premiumFrom(it),
    auctionType: it.auctionType,
  };
}

export async function fetchGov(cfg, hoursAhead) {
  const out = [], errors = [];
  const cutoff = Date.now() + hoursAhead * 3.6e6;

  for (const s of cfg.govSearches) {
    try {
      const items = await runActor(cfg.apifyActors.govdeals, {
        mode: "byState", state: cfg.homeState, searchText: s.term,
        auctionStatus: "open", sortBy: "endingSoonest", maxItems: cfg.govResultsPerSearch,
      }, "govdeals");
      for (const it of items) out.push(normGovDeals(it, s, cfg.homeState));
    } catch (e) { errors.push(`GovDeals "${s.term}": ${e.message}`); }

    try {
      const items = await runActor(cfg.apifyActors.publicsurplus, {
        keyword: s.term, state: cfg.homeState.toLowerCase(), includeDetails: true, maxItems: cfg.govResultsPerSearch,
      }, "publicsurplus");
      for (const it of items) out.push(normPublicSurplus(it, s));
    } catch (e) { errors.push(`Public Surplus "${s.term}": ${e.message}`); }
  }

  const seen = new Set();
  const listings = out.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    const t = new Date(l.endsAt).getTime();
    // Keep items with an unknown end time (so a field-name change doesn't hide everything)
    return Number.isNaN(t) ? true : t > Date.now() && t <= cutoff;
  });
  return { listings, errors, sampleRaw: out.find((l) => l.source === "govdeals")?._raw };
}
