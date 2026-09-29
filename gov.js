import { runActor } from "../apify.js";
import { toNum, findZip } from "../util.js";

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

function normGovDeals(it, search) {
  const locText = [
    pick(it, ["location", "locationText", "address", "pickupAddress"]),
    pick(it, ["city", "location.city"]),
    pick(it, ["state", "location.state"]),
    pick(it, ["zip", "zipCode", "postalCode", "location.zip", "location.postalCode"]),
  ].filter((x) => typeof x === "string" || typeof x === "number").join(", ");
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
    pickupZip: findZip(locText) || findZip(pick(it, ["description"])),
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
      for (const it of items) out.push(normGovDeals(it, s));
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
