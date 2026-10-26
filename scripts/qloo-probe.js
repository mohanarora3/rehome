// Diagnostic: tries several ways to get per-city brand signal from Qloo and prints compact raw results.
// Usage: node scripts/qloo-probe.js   (reads QLOO_API_KEY from .env)
import fs from 'node:fs';
try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}
const KEY = process.env.QLOO_API_KEY;
if (!KEY) { console.error('Set QLOO_API_KEY in .env first.'); process.exit(1); }
const BASE = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, '');

async function q(path, params) {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'X-Api-Key': KEY, accept: 'application/json' } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const ents = (j) => j?.results?.entities ?? j?.results ?? [];
const short = (o, n = 220) => JSON.stringify(o ?? null).slice(0, n);

const NIKE = 'C70CE2B8-0AD1-4150-BF18-5A6347F2E860';
const LEVI = 'EE2B58FF-37F6-4521-912F-55EBC25D83E2';
const CITIES = [['Delhi', 77.21, 28.61], ['Bengaluru', 77.59, 12.97], ['Chennai', 80.27, 13.08]];

console.log('=== A. current method: brand insights + signal.location.query + filter.results.entities');
for (const [name] of CITIES) {
  const r = await q('/v2/insights', { 'filter.type': 'urn:entity:brand', 'signal.location.query': name, 'filter.results.entities': `${NIKE},${LEVI}`, take: 5 });
  const e = ents(r.json);
  console.log(`${name}: HTTP ${r.status}, ${Array.isArray(e) ? e.length : '?'} results`, Array.isArray(e) ? e.map((x) => `${x.name} query=${short(x.query, 120)}`).join(' | ') : short(r.json, 300));
}

console.log('\n=== B. same, but location as a WKT point + radius');
for (const [name, lon, lat] of CITIES) {
  const r = await q('/v2/insights', { 'filter.type': 'urn:entity:brand', 'signal.location': `POINT(${lon} ${lat})`, 'signal.location.radius': 30000, 'filter.results.entities': `${NIKE},${LEVI}`, take: 5 });
  const e = ents(r.json);
  console.log(`${name}: HTTP ${r.status}, ${Array.isArray(e) ? e.length : '?'} results`, Array.isArray(e) ? e.map((x) => `${x.name} query=${short(x.query, 120)}`).join(' | ') : short(r.json, 300));
}

console.log('\n=== C. top brands per city (no restriction): where do Nike / Levi rank?');
for (const [name] of CITIES) {
  const r = await q('/v2/insights', { 'filter.type': 'urn:entity:brand', 'signal.location.query': name, take: 50 });
  const e = ents(r.json);
  if (!Array.isArray(e)) { console.log(`${name}: HTTP ${r.status}`, short(r.json, 300)); continue; }
  const rank = (id) => { const i = e.findIndex((x) => x.entity_id === id); return i < 0 ? 'not in top 50' : `#${i + 1} aff=${e[i].query?.affinity}`; };
  console.log(`${name}: HTTP ${r.status}, top3 = ${e.slice(0, 3).map((x) => `${x.name} (${x.query?.affinity})`).join(', ')} | Nike ${rank(NIKE)} | Levi ${rank(LEVI)}`);
}

console.log('\n=== D. heatmap for Nike in India');
for (const params of [
  { 'filter.type': 'urn:heatmap', 'signal.interests.entities': NIKE, 'filter.location.query': 'India', take: 50 },
  { 'filter.type': 'urn:heatmap', 'signal.interests.entities': NIKE, 'filter.location.query': 'New Delhi', take: 50 },
]) {
  const r = await q('/v2/insights', params);
  const pts = r.json?.results?.heatmap ?? r.json?.heatmap;
  console.log(`${params['filter.location.query']}: HTTP ${r.status}, ${Array.isArray(pts) ? pts.length + ' points, first: ' + short(pts[0], 200) : short(r.json, 300)}`);
}

console.log('\n=== E. finding Fabindia');
for (const params of [
  { query: 'FabIndia', types: 'urn:entity:brand', take: 3 },
  { query: 'Fab India', types: 'urn:entity:brand', take: 3 },
  { query: 'Fabindia', take: 5 },
  { query: 'Biba', types: 'urn:entity:brand', take: 3 },
  { query: 'Manyavar', types: 'urn:entity:brand', take: 3 },
]) {
  const r = await q('/search', params);
  const e = ents(r.json);
  console.log(`"${params.query}"${params.types ? '' : ' (any type)'}: HTTP ${r.status}`, Array.isArray(e) ? e.map((x) => `${x.name} [${(x.types || [x.type]).join(',')}]`).join(' | ') || 'none' : short(r.json, 200));
}
