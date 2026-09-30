import { activeComps } from "./ebay.js";
import { runActor } from "./apify.js";
import { tokens } from "./classify.js";
import { loadCache, saveCache, trimOutliers, percentile, toNum } from "./util.js";

const cache = loadCache("comps2"); // { [query]: { active, sold } } each with items [{p, t}]
const fresh = (entry, field, days) => entry?.[field] && Date.now() - entry[field].at < days * 864e5;

// Cheaper "add-on" things. If a sold listing is one of these and ours isn't, it's not a match.
const ACCESSORY = new Set(("dvd dvds cd cds disc discs disk vhs box boxes empty case cases manual manuals charger chargers " +
  "adapter adapters cable cables cord battery batteries remote remotes lens cover covers bag bags stand dock cartridge " +
  "cartridges parts keyboard mouse strap straps band bands replacement screen skin skins sticker stickers poster posters " +
  "book books guide insert inserts tag tags").split(" "));
const norm = (w) => (w.length > 3 ? w.replace(/s$/, "") : w);

// Does a sold/active listing title actually match what we're pricing?
export function matches(query, title) {
  const all = query.split(" ");
  const isLot = all.includes("lot") || all.includes("lots");
  const q = all.filter((w) => w && !["lot", "lots", "of"].includes(w)).map(norm);
  const t = new Set(tokens(title, true).map(norm));
  const theirsLot = t.has("lot") || /\b(bundle|set of|collection of|\d+\s*(pc|pcs|piece|pieces))\b/i.test(title);
  if (isLot !== theirsLot) return false; // a lot only compares to lots, a single item only to singles
  if (!q.length) return false;
  const hits = q.filter((w) => t.has(w)).length;
  if (hits / q.length < 0.6) return false;
  for (const w of q) if (ACCESSORY.has(w) && !t.has(w)) return false;     // ours is a DVD, theirs isn't
  const qs = new Set(q);
  for (const w of t) if (ACCESSORY.has(w) && !qs.has(w)) return false;       // theirs is a charger, ours isn't
  return true;
}

export async function getActive(query, cfg) {
  const e = (cache[query] ??= {});
  if (!fresh(e, "active", 2)) {
    const { total, items } = await activeComps(query);
    e.active = { total, items, at: Date.now() };
  }
  return e.active;
}

export function activeMedian(active, query) {
  const s = trimOutliers((active?.items || []).filter((x) => matches(query, x.t)).map((x) => x.p));
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
        byKw[kw].push({ p, t: it.title || "" });
      }
      for (const q of batch) (cache[q] ??= {}).sold = { items: byKw[q], at: Date.now() };
    } catch (e) {
      errors.push(`Sold comps: ${e.message}`);
    }
  }
  if (!process.env.DEMO) saveCache("comps2", cache);
  return { skipped, errors };
}

export function compSummary(query, cfg) {
  const all = cache[query]?.sold?.items || [];
  const good = all.filter((x) => matches(query, x.t));
  const sold = trimOutliers(good.map((x) => x.p));
  if (sold.length === 0) return { query, resale: null, confidence: "none", soldCount: 0 };
  const confidence = sold.length >= 8 ? "high" : sold.length >= 4 ? "medium" : "low";
  return {
    query,
    resale: percentile(sold, 0.4), // the price that sells reasonably fast
    median: percentile(sold, 0.5),
    confidence,
    soldCount: good.length,
    soldCountCapped: all.length >= cfg.soldCompResultsPerSearch && good.length === all.length,
    rejected: all.length - good.length,
  };
}

// Used by the demo to preview the email without any network calls.
export function primeCache(query, { activeTotal = 0, active = [], sold = [] }) {
  cache[query] = {
    active: { total: activeTotal, items: active, at: Date.now() },
    sold: { items: sold, at: Date.now() },
  };
}
