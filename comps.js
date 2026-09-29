import { activeComps } from "./sources/ebay.js";
import { runActor } from "./apify.js";
import { loadCache, saveCache, trimOutliers, percentile, toNum } from "./util.js";

const cache = loadCache("comps"); // { [query]: { active, sold, at } }
const fresh = (entry, field, days) => entry?.[field] && Date.now() - entry[field].at < days * 864e5;

export async function getActive(query, cfg) {
  const e = (cache[query] ??= {});
  if (!fresh(e, "active", 2)) {
    const { total, prices } = await activeComps(query);
    e.active = { total, prices, at: Date.now() };
  }
  return e.active;
}

export function activeMedian(active) {
  const s = trimOutliers(active?.prices || []);
  return s.length >= 3 ? percentile(s, 0.5) : null;
}

// Fetch sold comps for many queries, 6 per Apify run, respecting the budget.
export async function loadSold(queries, cfg) {
  const need = queries.filter((q) => !fresh(cache[q], "sold", cfg.compCacheDays));
  const allowed = need.slice(0, cfg.maxNewSoldCompSearchesPerRun);
  const skipped = need.length - allowed.length;
  const errors = [];

  for (let i = 0; i < allowed.length; i += 6) {
    const batch = allowed.slice(i, i + 6);
    try {
      const items = await runActor(cfg.apifyActors.soldcomps, {
        keywords: batch, daysToScrape: 30, count: cfg.soldCompResultsPerSearch,
        ebaySite: "ebay.com", sortOrder: "endedRecently", itemLocation: "domestic",
        itemCondition: "any", includeCompletedListings: true,
      }, "soldcomps");
      const byKw = Object.fromEntries(batch.map((q) => [q, []]));
      for (const it of items) {
        const kw = it.keyword && byKw[it.keyword] ? it.keyword : batch.length === 1 ? batch[0] : null;
        if (!kw) continue;
        if (/for parts|broken|not working|read description/i.test(it.title || "")) continue;
        let p = toNum(it.soldPrice);
        if (!p) continue;
        if (it.isBestOfferAccepted) p *= 0.85; // eBay hides the real accepted offer; assume ~15% under asking
        byKw[kw].push(p);
      }
      for (const q of batch) (cache[q] ??= {}).sold = { prices: byKw[q], at: Date.now() };
    } catch (e) {
      errors.push(`Sold comps: ${e.message}`);
    }
  }
  if (!process.env.DEMO) saveCache("comps", cache);
  return { skipped, errors };
}

export function compSummary(query, cfg) {
  const e = cache[query];
  const soldRaw = e?.sold?.prices || [];
  const sold = trimOutliers(soldRaw);
  const activeTotal = e?.active?.total ?? null;
  const capped = soldRaw.length >= cfg.soldCompResultsPerSearch;

  if (sold.length === 0) {
    return { query, resale: null, confidence: "none", soldCount: 0, activeTotal };
  }
  const confidence = sold.length >= 8 ? "high" : sold.length >= 4 ? "medium" : "low";
  const str = activeTotal !== null ? soldRaw.length / (soldRaw.length + activeTotal) : null;
  return {
    query,
    resale: percentile(sold, 0.4),        // the price that sells reasonably fast
    median: percentile(sold, 0.5),
    confidence,
    soldCount: soldRaw.length,
    soldCountCapped: capped,
    activeTotal,
    sellThrough: str,
  };
}

export const hasSold = (q) => Array.isArray(cache[q]?.sold?.prices);

// Used by the demo to preview the email without any network calls.
export function primeCache(query, { activeTotal = 0, activePrices = [], sold = [] }) {
  cache[query] = {
    active: { total: activeTotal, prices: activePrices, at: Date.now() },
    sold: { prices: sold, at: Date.now() },
  };
}
