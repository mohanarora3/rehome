// The day-one go/no-go test: do Qloo brand affinities differ meaningfully by Indian city?
// Usage: QLOO_API_KEY=... node scripts/qloo-test.js
import fs from 'node:fs';
try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}
if (!process.env.QLOO_API_KEY) { console.error('Set QLOO_API_KEY in .env first.'); process.exit(1); }

const { resolveBrand, cityAffinity, heatmap } = await import('../lib/qloo.js');
const BRANDS = ['Nike', 'Fabindia', 'MAC', 'Hasbro', "Levi's"];
const CITIES = ['DEL', 'BOM', 'BLR', 'MAA', 'HYD', 'CCU', 'PNQ', 'AMD', 'JAI', 'IXC'];

const ents = [];
for (const b of BRANDS) {
  const e = await resolveBrand(b);
  console.log(`${b.padEnd(10)} -> ${e.found ? `${e.name} (${e.id})` : 'NOT FOUND'}`);
  ents.push({ ...e, category: 'apparel' });
}
const aff = await cityAffinity(ents.filter((e) => e.found));
console.log('\nQloo demand by city (heatmap, city lift removed)');
console.log('brand'.padEnd(16) + CITIES.map((c) => c.padStart(6)).join('') + '   spread');
let good = 0;
for (const e of ents.filter((x) => x.found)) {
  const row = aff[e.id] || {};
  const vals = CITIES.map((c) => row[c]).filter((v) => v != null);
  const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
  if (spread >= 0.1) good++;
  console.log(e.name.slice(0, 15).padEnd(16) + CITIES.map((c) => (row[c] != null ? row[c].toFixed(2) : '  -').padStart(6)).join('') + '   ' + spread.toFixed(2));
}
const hm = ents.find((e) => e.found) ? await heatmap(ents.find((e) => e.found)) : [];
console.log(`\nHeatmap points for ${ents[0].name}: ${hm.length}`);
const tops = ents.filter((e) => e.found).map((e) => [e.name, Object.entries(aff[e.id] || {}).sort((a, b) => b[1] - a[1])[0]?.[0]]).filter(([, c]) => c);
console.log('Top city per brand: ' + tops.map(([n, c]) => `${n.split(' ')[0]} -> ${c}`).join(', '));
const distinct = new Set(tops.map(([, c]) => c)).size;
console.log(hm.length && distinct >= 3
  ? `\nGO: Qloo sends different brands to different cities (${distinct} different top cities).`
  : '\nCHECK: most brands land on the same city, or the heatmap is empty. Look at the raw responses.');
