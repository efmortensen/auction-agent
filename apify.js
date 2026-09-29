import { fetchJson } from "./util.js";

export const apifyUsage = { govdeals: 0, publicsurplus: 0, soldcomps: 0 };

// Runs an Apify tool and waits for its results (up to ~5 minutes).
export async function runActor(actorId, input, usageKey) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=280`;
  const items = await fetchJson(
    url,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    { retries: 1, label: `Apify ${actorId}` }
  );
  const list = Array.isArray(items) ? items : [];
  if (usageKey) apifyUsage[usageKey] += list.length;
  return list;
}
