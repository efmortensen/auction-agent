import { fetchJson, toNum } from "./util.js";

const API = "https://api.ebay.com";
let tokenCache = null;

async function getToken() {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.token;
  const id = process.env.EBAY_CLIENT_ID, secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set");
  const data = await fetchJson(`${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  }, { label: "eBay token" });
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 120) * 1000 };
  return tokenCache.token;
}

export async function browseSearch(params) {
  const token = await getToken();
  const qs = new URLSearchParams(params).toString();
  return fetchJson(`${API}/buy/browse/v1/item_summary/search?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  }, { label: `eBay search "${params.q}"` });
}

function normalize(it, search, local) {
  const ship = it.shippingOptions?.[0];
  const shipCost = toNum(ship?.shippingCost);
  const shipKnown = local ? true : ship?.shippingCostType === "FIXED" || shipCost === 0 || shipCost > 0;
  return {
    id: `ebay:${it.itemId}`,
    source: "ebay",
    title: it.title || "",
    description: it.shortDescription || "",
    condition: it.condition || "",
    url: it.itemWebUrl,
    imageUrl: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
    currentBid: toNum(it.currentBidPrice) ?? toNum(it.price) ?? 0,
    minNextBid: null,
    bidCount: it.bidCount ?? null,
    endsAt: it.itemEndDate,
    category: search.category,
    searchTerm: search.term,
    pickup: local,
    pickupZip: local ? it.itemLocation?.postalCode?.slice(0, 5) || null : null,
    pickupText: local
      ? [it.itemLocation?.city, it.itemLocation?.stateOrProvince, it.itemLocation?.postalCode].filter(Boolean).join(", ")
      : "",
    seller: it.seller?.username || "",
    shippingIn: local ? 0 : shipKnown ? shipCost || 0 : null,
    premiumPct: null,
  };
}

export async function fetchEbayAuctions(cfg, hoursAhead) {
  const end = new Date(Date.now() + hoursAhead * 3.6e6).toISOString().replace(/\.\d+Z$/, "Z");
  const baseFilter = [`buyingOptions:{AUCTION}`, `itemEndDate:[..${end}]`];
  const out = [], errors = [];

  const run = async (search, local) => {
    const filter = local
      ? [...baseFilter, "deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP}", "pickupCountry:US",
         `pickupPostalCode:${cfg.homeZip}`, `pickupRadius:${cfg.maxPickupMiles}`, "pickupRadiusUnit:mi"]
      : [...baseFilter, "deliveryCountry:US"];
    try {
      const data = await browseSearch({ q: search.term, filter: filter.join(","), sort: "endingSoonest", limit: "100" });
      for (const it of data?.itemSummaries || []) out.push(normalize(it, search, local));
    } catch (e) {
      errors.push(e.message);
    }
  };

  for (const s of cfg.ebaySearches) await run(s, false);
  for (const s of cfg.ebayLocalSearches) await run(s, true);

  // Same item can show up under two searches. Keep the shipped version if it has known shipping.
  const byId = new Map();
  for (const l of out) {
    const prev = byId.get(l.id);
    if (!prev || (prev.pickup && !l.pickup && l.shippingIn !== null)) byId.set(l.id, l);
  }
  return { listings: [...byId.values()].filter((l) => new Date(l.endsAt) > Date.now()), errors };
}

// Active fixed-price listings for a comp query (free; used to pre-screen and for sell-through)
export async function activeComps(query) {
  const data = await browseSearch({ q: query, filter: "buyingOptions:{FIXED_PRICE},deliveryCountry:US", limit: "50" });
  const prices = (data?.itemSummaries || [])
    .filter((it) => !/for parts|broken|not working/i.test(it.title || ""))
    .map((it) => toNum(it.price))
    .filter((n) => n > 0);
  return { total: data?.total ?? prices.length, prices };
}
