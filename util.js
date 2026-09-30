import fs from "node:fs";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, opts = {}, { retries = 2, label = url } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      if (!res.ok) throw new Error(`${label} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

export function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object") return toNum(v.value ?? v.amount ?? v.usd);
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Drop outliers with the IQR rule, return sorted array
export function trimOutliers(values) {
  const s = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (s.length < 4) return s;
  const q1 = percentile(s, 0.25), q3 = percentile(s, 0.75);
  const iqr = q3 - q1;
  return s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
}

export const money = (n) =>
  n === null || n === undefined ? "?" : `$${Number(n).toFixed(n >= 100 ? 0 : 2).replace(/\.00$/, "")}`;

// ---------- simple JSON cache on disk (kept between runs by GitHub Actions) ----------
const CACHE_DIR = path.resolve(".cache");
export function loadCache(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${name}.json`), "utf8"));
  } catch {
    return {};
  }
}
export function saveCache(name, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(data));
}

// ---------- distance from home, by zip code (free zippopotam.us lookup) ----------
const zipCache = loadCache("zips");
export async function zipLatLng(zip) {
  if (!zip) return null;
  zip = String(zip).slice(0, 5);
  if (zip in zipCache) return zipCache[zip];
  try {
    const data = await fetchJson(`https://api.zippopotam.us/us/${zip}`, {}, { retries: 1, label: `zip ${zip}` });
    const p = data?.places?.[0];
    zipCache[zip] = p ? { lat: +p.latitude, lng: +p.longitude } : null;
  } catch {
    zipCache[zip] = null;
  }
  saveCache("zips", zipCache);
  return zipCache[zip];
}

// Fallback when there's no zip: look up the city
export async function cityLatLng(city, state) {
  if (!city || !state) return null;
  const key = `${state}|${city}`.toLowerCase();
  if (key in zipCache) return zipCache[key];
  try {
    const data = await fetchJson(`https://api.zippopotam.us/us/${state.toLowerCase()}/${encodeURIComponent(city.toLowerCase())}`,
      {}, { retries: 1, label: `city ${city}` });
    const p = data?.places?.[0];
    zipCache[key] = p ? { lat: +p.latitude, lng: +p.longitude } : null;
  } catch {
    zipCache[key] = null;
  }
  saveCache("zips", zipCache);
  return zipCache[key];
}

export function milesBetween(a, b) {
  if (!a || !b) return null;
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const findZip = (text) => (String(text || "").match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || null;

export function fmtEnd(iso, tz) {
  if (!iso) return "?";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function hoursUntil(iso) {
  return (new Date(iso).getTime() - Date.now()) / 3.6e6;
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
