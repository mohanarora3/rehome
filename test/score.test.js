import assert from 'node:assert/strict';
import { scoreItem, scoreBatch, planBatch, transferCost, distanceKm } from '../public/js/score.js';
import { SAMPLE_RETURNS } from '../public/js/data.js';
import { demoAffinity, nameMatches, demandFromStats } from '../lib/qloo.js';

const jacket = SAMPLE_RETURNS[0];
const flat = { DEL: 0.5, BOM: 0.5, BLR: 0.5, MAA: 0.5 };
const skew = { ...flat, BLR: 0.9, MAA: 0.3 };

assert.equal(transferCost('MAA', 'MAA', 'apparel'), 0);
assert.ok(distanceKm('MAA', 'BLR') > 250 && distanceKm('MAA', 'BLR') < 450, 'Chennai-Bengaluru road distance');

let r = scoreItem(jacket, skew);
assert.equal(r.best.route, 'relocate');
assert.equal(r.best.city, 'BLR');

r = scoreItem(jacket, { ...skew, MAA: 0.95 });
assert.equal(r.best.route, 'restock', 'strong local demand keeps it local');

r = scoreItem(jacket, skew, { shippingBudget: 50 });
assert.notEqual(r.best.route, 'relocate', 'budget blocks transfers');

r = scoreItem(jacket, skew, { condition: 'damaged' });
assert.ok(!['restock', 'relocate'].includes(r.best.route), 'damaged never goes to a shelf');

r = scoreItem(jacket, skew, { maxDistanceKm: 100 });
assert.ok(r.options.find((o) => o.city === 'BLR').blocked, 'distance limit blocks Bengaluru');


// Brand matching: accept the real brand, reject look-alikes.
assert.ok(nameMatches('MAC', 'MAC Cosmetics'));
assert.ok(nameMatches("Levi's", 'Levi Strauss & Co.'));
assert.ok(nameMatches('Lakmé', 'Lakme'));
assert.ok(nameMatches('LEGO', 'The LEGO Group'));
assert.ok(nameMatches('Fabindia', 'Fabindia Koramangala Home & Garments'));
assert.ok(!nameMatches('Biba', 'Lady Biba'), 'Biba is not Lady Biba');
assert.ok(!nameMatches('Fab India', 'India Today'));
assert.ok(!nameMatches('H&M', 'HMV'));

// City demand: a city that scores high for every brand must not win every brand.
const st = (big, other) => ({ DEL: { aff: big, pop: big, n: 12 }, BLR: { aff: other.A, pop: other.A, n: 12 }, MAA: { aff: other.B, pop: other.B, n: 12 } });
const demand = demandFromStats({
  b1: st(0.95, { A: 0.90, B: 0.60 }), b2: st(0.95, { A: 0.60, B: 0.90 }),
  b3: st(0.93, { A: 0.70, B: 0.70 }), b4: st(0.94, { A: 0.75, B: 0.65 }),
});
const top = (id) => Object.entries(demand[id].affinity).sort((a, b) => b[1] - a[1])[0][0];
assert.equal(top('b1'), 'BLR', 'brand-specific strength beats a city that is hot for everything');
assert.equal(top('b2'), 'MAA');

// Capacity: a big batch of one kind spreads out instead of all going to one city.
const many = Array.from({ length: 12 }, (_, k) => ({ ...jacket, id: `C${k}`, affinity: skew, popularity: { BLR: 0.3 } }));
const toBLR = scoreBatch(many).filter((x) => x.best.route === 'relocate' && x.best.city === 'BLR').length;
assert.ok(toBLR > 0 && toBLR < many.length, `capacity spreads the batch (${toBLR}/12 to Bengaluru)`);

const results = SAMPLE_RETURNS.map((it) => scoreItem(it, demoAffinity(it.brand, it.category)));
const plan = planBatch(SAMPLE_RETURNS, results);
assert.ok(plan.totals.rehome >= plan.totals.liquidateAll, 'Rehome never recovers less than liquidating everything');
assert.equal(plan.shipments.reduce((s, l) => s + l.items.length, 0), SAMPLE_RETURNS.length);
console.log('All score tests passed.');
console.log(plan.totals);
console.log(plan.shipments.map((s) => `${s.key}: ${s.items.length}`).join('\n'));
