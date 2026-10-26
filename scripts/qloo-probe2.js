// Diagnostic 2: does Qloo's heatmap give each Indian city a different score per brand?
// Usage: node scripts/qloo-probe2.js
import fs from 'node:fs';
try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}
const KEY = process.env.QLOO_API_KEY;
const BASE = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, '');
const { CITIES } = await import('../public/js/data.js');

async function q(path, params) {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { 'X-Api-Key': KEY } });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const km = (a, b, c, d) => { const r = (x) => x * Math.PI / 180; const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const mean = (xs) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
const f = (v) => v == null ? '   -' : v.toFixed(2);

const fab = (await q('/search', { query: 'Fabindia', take: 1 })).json?.results?.[0];
const BRANDS = [
  ['Nike', 'C70CE2B8-0AD1-4150-BF18-5A6347F2E860'],
  ["Levi's", 'EE2B58FF-37F6-4521-912F-55EBC25D83E2'],
  ['MAC', '853AD85F-89EF-4274-BD23-E2B5C1F1A8DC'],
  ['Hasbro', 'D6563632-EE01-49FB-8177-A4D18480B913'],
  ...(fab ? [['Fabindia(pl)', fab.entity_id]] : []),
];

const all = {};
for (const [name, id] of BRANDS) {
  const r = await q('/v2/insights', { 'filter.type': 'urn:heatmap', 'signal.interests.entities': id, 'filter.location.query': 'India', take: 50 });
  const pts = (r.json?.results?.heatmap ?? []).map((p) => ({ lat: p.location?.latitude, lon: p.location?.longitude, aff: p.query?.affinity, rank: p.query?.affinity_rank, pop: p.query?.popularity }));
  const affs = pts.map((p) => p.aff).filter((v) => v != null), pops = pts.map((p) => p.pop).filter((v) => v != null);
  console.log(`\n${name}: HTTP ${r.status}, ${pts.length} pts | affinity min ${f(Math.min(...affs))} max ${f(Math.max(...affs))} mean ${f(mean(affs))} | popularity min ${f(Math.min(...pops))} max ${f(Math.max(...pops))} mean ${f(mean(pops))}`);
  console.log('city  pts   aff  rank   pop');
  all[name] = {};
  for (const c of CITIES) {
    const near = pts.filter((p) => p.lat != null && km(c.lat, c.lon, p.lat, p.lon) <= 50);
    const row = { n: near.length, aff: mean(near.map((p) => p.aff).filter((v) => v != null)), rank: mean(near.map((p) => p.rank).filter((v) => v != null)), pop: mean(near.map((p) => p.pop).filter((v) => v != null)) };
    all[name][c.id] = row;
    console.log(`${c.id}  ${String(row.n).padStart(4)}  ${f(row.aff)}  ${f(row.rank)}  ${f(row.pop)}`);
  }
}
console.log('\nBest city by popularity:', Object.entries(all).map(([b, rows]) => `${b} -> ${Object.entries(rows).filter(([, r]) => r.pop != null).sort((a, b2) => b2[1].pop - a[1].pop)[0]?.[0]}`).join(', '));
