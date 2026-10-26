// Qloo client for Rehome: entity search, per-city brand affinity, heatmap, audience.
// Live mode needs QLOO_API_KEY. Without it, Rehome runs on clearly labelled sample signals.

import { CITIES } from '../public/js/data.js';
import { cacheGet, cacheSet } from './cache.js';

const BASE = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, '');
const KEY = process.env.QLOO_API_KEY || '';
const TIMEOUT_MS = Number(process.env.QLOO_TIMEOUT_MS) || 20000;

export const qlooMode = () => (KEY ? 'live' : 'demo');

// Qloo rate-limits bursts: keep a few calls in flight and retry politely on 429.
const MAX_IN_FLIGHT = Number(process.env.QLOO_CONCURRENCY) || 3;
let inFlight = 0;
const waiting = [];
async function slot() {
  if (inFlight < MAX_IN_FLIGHT) { inFlight++; return; }
  await new Promise((resolve) => waiting.push(resolve)); // slot handed over by release()
}
function release() {
  const next = waiting.shift();
  if (next) next(); else inFlight--;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function qget(path, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  const url = `${BASE}${path}?${qs}`;
  const cached = cacheGet(url);
  if (cached) return cached;
  for (let attempt = 0; ; attempt++) {
    await slot();
    let res, text;
    try {
      res = await fetch(url, { headers: { 'X-Api-Key': KEY, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (err) {
      if (err.name === 'TimeoutError' && attempt < 2) { console.warn(`[qloo] ${path} timed out, retrying`); continue; }
      throw err;
    } finally {
      release();
    }
    if (res.status === 429 && attempt < 5) {
      await sleep((Number(res.headers.get('retry-after')) || 0) * 1000 || 700 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Qloo ${path} ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    cacheSet(url, json);
    return json;
  }
}

const entitiesOf = (json) => json?.results?.entities ?? json?.results ?? json?.entities ?? [];
const idOf = (e) => e?.entity_id ?? e?.id ?? e?.qloo_id;
const affinityOf = (e) => e?.query?.affinity ?? e?.affinity ?? e?.query?.score ?? null;

const norm = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/['’]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');

/** True when a Qloo result really is the brand asked for: "MAC" -> "MAC Cosmetics", but not "Biba" -> "Lady Biba". */
export function nameMatches(query, name) {
  const q = norm(query), n = norm(name);
  if (!q || !n) return false;
  const qc = q.replace(/ /g, ''), nc = n.replace(/ /g, '');
  if (qc.length <= 3) return nc === qc || n.split(' ')[0] === qc;
  return nc.startsWith(qc) || (nc.length >= 4 && qc.startsWith(nc));
}

/**
 * Resolve a brand name to a Qloo entity. Prefers a brand entity whose name matches;
 * when Qloo has none (common for Indian brands such as Fabindia), falls back to the
 * brand's own stores as places, whose heatmap still shows where its audience is.
 */
export async function resolveBrand(query) {
  if (!KEY) return demoEntity(query);
  let hit = null;
  try {
    hit = entitiesOf(await qget('/search', { query, types: 'urn:entity:brand', take: 5 })).find((e) => nameMatches(query, e.name));
  } catch (err) {
    console.warn('[qloo] brand search failed', query, err.message);
  }
  if (hit) return { query, id: idOf(hit), name: hit.name ?? query, kind: 'brand', source: 'qloo', found: true, popularity: hit.popularity ?? null };
  try {
    const stores = entitiesOf(await qget('/search', { query, types: 'urn:entity:place', take: 10 })).filter((e) => nameMatches(query, e.name));
    if (stores.length) return { query, id: idOf(stores[0]), name: `${query} (stores)`, kind: 'place', source: 'qloo', found: true, stores: stores.length };
  } catch (err) {
    console.warn('[qloo] store fallback failed', query, err.message);
  }
  return { query, id: null, name: query, source: 'qloo', found: false };
}

// ---------------------------------------------------------------------------
// City demand from Qloo's heatmap: one call per brand, aggregated around each city.

export const DEMAND = {
  radiusKm: 50,          // heatmap points within this distance count toward a city
  affinityWeight: 0.6,   // fit: how much more this area likes the brand than elsewhere
  popularityWeight: 0.4, // size: how big the brand's audience is there
  shrinkPoints: 4,       // a city with n points is trusted n/(n+4); the rest is the brand's average
  cityLiftRemoved: 0.7,  // share of a city's "high for every brand" lift that is removed
  minBrandsForLift: 4,   // need this many brands in the batch to measure a city's general lift
};

const kmBetween = (lat1, lon1, lat2, lon2) => {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const avg = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
const round2 = (v) => Math.round(v * 100) / 100;

/** Heatmap points -> {cityId: {aff, pop, n}} for the points near each city. */
export function cityStats(points) {
  const out = {};
  for (const c of CITIES) {
    const near = points.filter((p) => p.lat != null && kmBetween(c.lat, c.lon, p.lat, p.lon) <= DEMAND.radiusKm);
    const aff = avg(near.map((p) => p.affinity).filter((v) => v != null));
    if (aff == null) continue;
    const pop = avg(near.map((p) => p.popularity).filter((v) => v != null));
    out[c.id] = { aff, pop: pop ?? aff, n: near.length };
  }
  return out;
}

/** Pure: {entityId: cityStats} -> {entityId: {cityId: fit}}, fit = weighted affinity + popularity, shrunk toward the brand's average where a city has few points. */
export function fitFromStats(stats) {
  const D = DEMAND;
  const fit = {};
  for (const [id, s] of Object.entries(stats)) {
    const cities = Object.keys(s);
    if (!cities.length) continue;
    const raw = Object.fromEntries(cities.map((c) => [c, D.affinityWeight * s[c].aff + D.popularityWeight * s[c].pop]));
    const mean = avg(cities.map((c) => raw[c]));
    fit[id] = Object.fromEntries(cities.map((c) => {
      const w = s[c].n / (s[c].n + D.shrinkPoints);
      return [c, w * raw[c] + (1 - w) * mean];
    }));
  }
  return fit;
}

/** Pure: how high each city scores for brands in general = its average fit across a set of brands. */
export function cityBaseline(fit) {
  if (Object.keys(fit).length < DEMAND.minBrandsForLift) return {};
  const base = {};
  for (const c of CITIES) {
    const v = avg(Object.values(fit).map((f) => f[c.id]).filter((x) => x != null));
    if (v != null) base[c.id] = v;
  }
  return base;
}

/**
 * Pure: {entityId: cityStats} -> {entityId: {affinity, popularity, points}} per city.
 * Removes most of each city's general lift (a big metro that scores high for every brand
 * shouldn't win every item). `base` is that lift per city; if omitted it is measured from `stats`.
 */
export function demandFromStats(stats, base) {
  const fit = fitFromStats(stats);
  const b = base ?? cityBaseline(fit);
  const overall = avg(Object.values(b)) ?? 0;
  const out = {};
  for (const [id, f] of Object.entries(fit)) {
    out[id] = { affinity: {}, popularity: {}, points: {} };
    for (const [c, v] of Object.entries(f)) {
      const adjusted = b[c] != null ? v - DEMAND.cityLiftRemoved * (b[c] - overall) : v;
      out[id].affinity[c] = round2(Math.max(0.02, Math.min(0.98, adjusted)));
      out[id].popularity[c] = round2(stats[id][c].pop);
      out[id].points[c] = stats[id][c].n;
    }
  }
  return out;
}

async function pool(list, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (i < list.length) await fn(list[i++]);
  }));
}

/**
 * Per-city demand for each entity: { key: { affinity: {cityId: 0..1}, popularity: {...}, points: {...} } }.
 * Live: one Qloo heatmap call per brand (cached). Demo: labelled sample signals.
 */
export async function cityDemand(entities) {
  const keyOf = (e) => e.id ?? e.query;
  const out = {};
  if (!KEY) {
    for (const e of entities) {
      const a = demoAffinity(e.query, e.category);
      out[keyOf(e)] = { affinity: a, popularity: a, points: null };
    }
    return out;
  }
  for (const e of entities) out[keyOf(e)] = { affinity: {}, popularity: {}, points: {} };
  const live = entities.filter((e) => e.id && e.source === 'qloo');
  const stats = {};
  await pool(live, 6, async (e) => { stats[e.id] = cityStats(await heatmap(e)); });
  Object.assign(out, demandFromStats(stats, await referenceBaseline()));
  return out;
}

// A fixed basket of widely known brands measures each city's general lift, so the result
// doesn't depend on which brands happen to be in one upload or one batch of rows.
export const REFERENCE_BRANDS = ['Nike', 'Adidas', "Levi's", 'Zara', 'H&M', 'MAC', 'Maybelline', 'LEGO', 'Sony', 'Penguin Random House'];
let baselinePromise = null;
function referenceBaseline() {
  baselinePromise ??= (async () => {
    const refs = (await Promise.all(REFERENCE_BRANDS.map(resolveBrand))).filter((e) => e.found && e.kind === 'brand');
    const stats = {};
    await pool(refs, 6, async (e) => { stats[e.id] = cityStats(await heatmap(e)); });
    const base = cityBaseline(fitFromStats(stats));
    if (!Object.keys(base).length) baselinePromise = null; // try again next time
    return Object.keys(base).length ? base : undefined;
  })().catch((err) => {
    console.warn('[qloo] reference baseline failed', err.message);
    baselinePromise = null;
    return undefined;
  });
  return baselinePromise;
}

/** Back-compatible: { key: {cityId: 0..1} }. */
export async function cityAffinity(entities) {
  const d = await cityDemand(entities);
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.affinity]));
}

/** Geographic heatmap for one brand across India. Returns [{lat, lon, affinity, popularity}]. */
export async function heatmap(entity) {
  if (!KEY) return demoHeatmap(entity.query, entity.category);
  try {
    const json = await qget('/v2/insights', {
      'filter.type': 'urn:heatmap',
      'signal.interests.entities': entity.id,
      'filter.location.query': 'India',
      take: 50,
    });
    const pts = json?.results?.heatmap ?? json?.heatmap ?? [];
    return pts.map((p) => ({
      lat: p.location?.latitude ?? p.latitude,
      lon: p.location?.longitude ?? p.longitude,
      affinity: p.query?.affinity ?? p.affinity ?? null,
      popularity: p.query?.popularity ?? p.popularity ?? null,
    })).filter((p) => p.lat != null && p.lon != null);
  } catch (err) {
    console.warn('[qloo] heatmap failed', err.message);
    return [];
  }
}

/** Who likes this brand: Qloo demographics for the entity. */
export async function audience(entity) {
  if (!KEY) return demoAudience(entity.category);
  try {
    const json = await qget('/v2/insights', {
      'filter.type': 'urn:demographics',
      'signal.interests.entities': entity.id,
    });
    const d = json?.results?.demographics?.[0]?.query ?? json?.results?.demographics?.[0] ?? null;
    return d ? { source: 'qloo', ...d } : null;
  } catch (err) {
    console.warn('[qloo] audience failed', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Demo mode: deterministic sample signals so the app works before a key exists.
// These are NOT Qloo data and the UI labels them as samples.

const LEAN = {
  apparel:  { DEL: .78, BOM: .82, BLR: .74, MAA: .52, HYD: .62, CCU: .55, PNQ: .70, AMD: .58, JAI: .60, IXC: .72 },
  sneakers: { DEL: .80, BOM: .78, BLR: .86, MAA: .50, HYD: .66, CCU: .48, PNQ: .76, AMD: .52, JAI: .50, IXC: .70 },
  beauty:   { DEL: .84, BOM: .88, BLR: .70, MAA: .58, HYD: .66, CCU: .60, PNQ: .62, AMD: .56, JAI: .54, IXC: .68 },
  games:    { DEL: .62, BOM: .66, BLR: .86, MAA: .58, HYD: .74, CCU: .60, PNQ: .82, AMD: .50, JAI: .46, IXC: .52 },
  books:    { DEL: .72, BOM: .66, BLR: .80, MAA: .62, HYD: .60, CCU: .86, PNQ: .70, AMD: .48, JAI: .50, IXC: .56 },
  audio:    { DEL: .72, BOM: .74, BLR: .84, MAA: .60, HYD: .76, CCU: .58, PNQ: .72, AMD: .56, JAI: .52, IXC: .60 },
};
const TRAD = { DEL: .70, BOM: .66, BLR: .50, MAA: .74, HYD: .70, CCU: .68, PNQ: .58, AMD: .82, JAI: .86, IXC: .64 };
const TRADITIONAL = ['fabindia', 'biba', 'manyavar', 'forest essentials'];

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

function demoEntity(query) {
  return { query, id: `demo:${String(query).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: query, source: 'demo', found: true };
}

export function demoAffinity(brand, category) {
  const lean = TRADITIONAL.includes(String(brand).toLowerCase()) ? TRAD : LEAN[category] ?? LEAN.apparel;
  const out = {};
  for (const c of CITIES) {
    const noise = (hash(`${brand}|${c.id}`) - 0.5) * 0.22;
    out[c.id] = Math.round(Math.max(0.05, Math.min(0.97, lean[c.id] - 0.12 + noise)) * 100) / 100;
  }
  return out;
}

function demoHeatmap(brand, category) {
  const aff = demoAffinity(brand, category);
  const pts = [];
  for (const c of CITIES) {
    for (let k = 0; k < 5; k++) {
      const r = hash(`${brand}|${c.id}|${k}`), t = hash(`${c.id}|${k}|${brand}`) * Math.PI * 2;
      pts.push({ lat: c.lat + Math.sin(t) * r * 0.9, lon: c.lon + Math.cos(t) * r * 0.9, affinity: Math.max(0.05, aff[c.id] - r * 0.25), popularity: null });
    }
  }
  return pts;
}

function demoAudience(category) {
  const m = {
    apparel: 'style-conscious 25–40 year olds', sneakers: 'runners and sneaker collectors, 18–35',
    beauty: 'skincare and makeup enthusiasts, 20–35', games: 'board-game groups and families',
    books: 'readers and gift buyers', audio: 'commuters and music listeners, 18–35',
  };
  return { source: 'demo', summary: m[category] ?? 'online shoppers' };
}
