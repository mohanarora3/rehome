// Rehome routing engine. Pure functions, no I/O, shared by browser and server.
// Qloo affinity (0..1 per city) is the demand signal; everything else is costs.

import { CITIES, cityById, CATEGORIES, CONDITIONS } from './data.js';

export const ASSUMPTIONS = {
  handlingPerItem: 40,        // ₹ to inspect, repack and relabel any return
  transferBase: 80,           // ₹ fixed cost of an inter-city transfer per item
  transferPerKgKm: 0.12,      // ₹ per kg per km
  marketplaceFee: 0.15,       // share of resale price
  resaleShipping: 110,        // ₹ courier to the end buyer
  resaleListingCost: 30,      // ₹ photos and listing
  resalePriceFactor: 0.78,    // resale price vs list, before condition
  bundleFactor: 0.5,          // bundle value vs list, before condition
  bundleMaxPrice: 1500,       // only cheap items are bundled
  donateBelow: 50,            // ₹: if nothing recovers more, donate
  consolidationSaving: 0.35,  // transfer saving when 5+ items share a lane
  consolidationMin: 5,
  capacityBase: 3,            // items of one category a city absorbs before demand thins...
  capacityPerPopularity: 12,  // ...plus this many more at full Qloo popularity
};

export const ROUTES = {
  restock: 'Restock locally',
  relocate: 'Relocate',
  resell: 'Resell online',
  bundle: 'Bundle',
  liquidate: 'Liquidate',
  donate: 'Donate',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function distanceKm(a, b) {
  const A = cityById[a], B = cityById[b];
  if (!A || !B || a === b) return 0;
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(B.lat - A.lat), dLon = toRad(B.lon - A.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(A.lat)) * Math.cos(toRad(B.lat)) * Math.sin(dLon / 2) ** 2;
  // Road distance is roughly 1.25x the straight line.
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.25);
}

export function transferCost(from, to, category) {
  if (from === to) return 0;
  const kg = Math.max(0.5, CATEGORIES[category]?.kg ?? 0.8);
  return Math.round(ASSUMPTIONS.transferBase + distanceKm(from, to) * ASSUMPTIONS.transferPerKgKm * kg);
}

// Probability the item sells at its condition-adjusted price within the sell window.
export function sellProbability(affinity) {
  return clamp(0.15 + 0.8 * (affinity ?? 0), 0.05, 0.95);
}

function liquidation(item, condFactor) {
  const base = item.liquidationValue ?? Math.round(item.listPrice * 0.28);
  return Math.round(base * Math.min(1, condFactor / 0.92));
}

/**
 * Score every route for one item.
 * @param item  {id, category, condition, city, listPrice, liquidationValue}
 * @param affinity {cityId: 0..1} from Qloo
 * @param c constraints {maxDistanceKm, shippingBudget, condition}
 * @param ctx batch context {load: {'CITY|category': items already headed there}, popularity: {cityId: 0..1} from Qloo}
 * @returns {options: [...], best, liquidation}
 */
export function scoreItem(item, affinity = {}, c = {}, ctx = {}) {
  const A = ASSUMPTIONS;
  const condition = c.condition || item.condition;
  const condFactor = CONDITIONS[condition]?.factor ?? 0.75;
  const maxKm = c.maxDistanceKm ?? Infinity;
  const budget = c.shippingBudget ?? Infinity;
  const price = item.listPrice * condFactor;
  const liq = liquidation(item, condFactor);
  const sellable = condition !== 'damaged';
  const options = [];

  // Store routes: the current city (restock) and every other city (relocate).
  for (const city of CITIES) {
    const aff = affinity[city.id];
    if (aff == null) continue;
    const local = city.id === item.city;
    const km = distanceKm(item.city, city.id);
    const transfer = transferCost(item.city, city.id, item.category);
    // City capacity: each item of the same category already headed here thins demand,
    // less so where Qloo shows a big audience for the brand.
    const load = ctx.load?.[`${city.id}|${item.category}`] ?? 0;
    const capacity = A.capacityBase + A.capacityPerPopularity * (ctx.popularity?.[city.id] ?? aff);
    const crowd = load ? capacity / (capacity + load) : 1;
    const p = sellProbability(aff) * crowd;
    const expected = Math.round(p * price + (1 - p) * liq - transfer - A.handlingPerItem);
    let blocked = null;
    if (!sellable) blocked = 'Damaged items can’t go back on a shelf';
    else if (!local && km > maxKm) blocked = `Beyond the ${maxKm.toLocaleString('en-IN')} km limit`;
    else if (!local && transfer > budget) blocked = `Shipping ₹${transfer} is over the ₹${budget} budget`;
    options.push({
      route: local ? 'restock' : 'relocate',
      city: city.id,
      affinity: aff,
      sellProbability: p,
      km, transfer,
      expected,
      blocked,
      crowding: load ? { load, factor: Math.round(crowd * 100) / 100 } : null,
    });
  }

  // Resell online: a national marketplace reaches the strongest audiences.
  const affs = Object.values(affinity).filter((v) => v != null);
  if (affs.length) {
    const top = Math.max(...affs), mean = affs.reduce((s, v) => s + v, 0) / affs.length;
    const reach = 0.6 * top + 0.4 * mean;
    const p = clamp(0.2 + 0.7 * reach, 0.05, 0.9);
    const resalePrice = price * A.resalePriceFactor;
    const net = resalePrice * (1 - A.marketplaceFee) - A.resaleShipping;
    const expected = Math.round(p * net + (1 - p) * liq * 0.9 - A.resaleListingCost - A.handlingPerItem);
    const blocked = A.resaleShipping > budget ? `Courier ₹${A.resaleShipping} is over the ₹${budget} budget` : null;
    options.push({ route: 'resell', city: null, affinity: reach, sellProbability: p, km: 0, transfer: A.resaleShipping, expected, blocked });
  }

  // Bundle cheap items with related products.
  if (item.listPrice <= A.bundleMaxPrice) {
    const expected = Math.round(item.listPrice * condFactor * A.bundleFactor - A.handlingPerItem);
    options.push({ route: 'bundle', city: null, affinity: null, sellProbability: null, km: 0, transfer: 0, expected, blocked: null });
  }

  options.push({ route: 'liquidate', city: null, affinity: null, sellProbability: 1, km: 0, transfer: 0, expected: liq, blocked: null });
  options.push({ route: 'donate', city: null, affinity: null, sellProbability: null, km: 0, transfer: 0, expected: 0, blocked: null });

  const open = options.filter((o) => !o.blocked).sort((a, b) => b.expected - a.expected);
  let best = open[0];
  if (best.expected < A.donateBelow) best = options.find((o) => o.route === 'donate');
  const second = open.find((o) => o !== best);
  const gap = best.expected > 0 && second ? (best.expected - second.expected) / best.expected : 0;
  const confidence = Math.round(clamp(0.5 + gap * 0.9, 0.35, 0.95) * 100) / 100;

  options.sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || b.expected - a.expected);
  return { options, best, second, confidence, liquidation: liq, condition, condFactor };
}

/**
 * Score a whole batch with city capacity. Dearer items choose first; every item routed to a
 * store (restock or relocate) adds to that city's load for its category, so later items of the
 * same kind see thinner demand there and spread to the next-best cities.
 */
export function scoreBatch(items, c = {}, overrides = {}) {
  const load = {};
  const results = new Array(items.length);
  const order = items.map((_, i) => i).sort((a, b) => (items[b].listPrice ?? 0) - (items[a].listPrice ?? 0));
  for (const i of order) {
    const it = items[i];
    const r = scoreItem(it, it.affinity, { ...c, condition: overrides[it.id] ?? c.condition }, { load, popularity: it.popularity });
    results[i] = r;
    if (r.best.route === 'restock' || r.best.route === 'relocate') {
      const k = `${r.best.city}|${it.category}`;
      load[k] = (load[k] || 0) + 1;
    }
  }
  return results;
}

export function bestCity(affinity) {
  let top = null;
  for (const [id, v] of Object.entries(affinity || {})) if (v != null && (!top || v > top.v)) top = { id, v };
  return top;
}

/** Group a scored batch into shipments and totals. */
export function planBatch(items, results) {
  const A = ASSUMPTIONS;
  const lanes = new Map();
  let rehome = 0, liquidateAll = 0, restockNearest = 0, diverted = 0;

  items.forEach((item, i) => {
    const r = results[i];
    if (!r) return;
    liquidateAll += r.liquidation;
    const local = r.options.find((o) => o.route === 'restock');
    restockNearest += local && !local.blocked ? local.expected : r.liquidation;
    rehome += r.best.expected;
    if (r.best.route !== 'liquidate') diverted += 1;
    const key = r.best.route === 'relocate' ? `relocate:${item.city}>${r.best.city}`
      : r.best.route === 'restock' ? `restock:${item.city}`
      : r.best.route === 'donate' ? `donate:${item.city}`
      : r.best.route;
    if (!lanes.has(key)) lanes.set(key, { key, route: r.best.route, from: item.city, to: r.best.city, items: [], expected: 0, transfer: 0 });
    const lane = lanes.get(key);
    lane.items.push(item.id);
    lane.expected += r.best.expected;
    lane.transfer += r.best.route === 'relocate' ? r.best.transfer : 0;
  });

  let saving = 0;
  for (const lane of lanes.values()) {
    if (lane.route === 'relocate' && lane.items.length >= A.consolidationMin) {
      lane.saving = Math.round(lane.transfer * A.consolidationSaving);
      saving += lane.saving;
    } else lane.saving = 0;
  }
  const shipments = [...lanes.values()].sort((a, b) => b.items.length - a.items.length || b.expected - a.expected);
  const logistics = shipments.reduce((s, l) => s + l.transfer - l.saving, 0);
  return {
    shipments,
    totals: {
      rehome: rehome + saving,
      liquidateAll,
      restockNearest,
      uplift: rehome + saving - liquidateAll,
      diverted,
      count: items.length,
      interCityShipments: shipments.filter((s) => s.route === 'relocate').length,
      logistics,
      consolidationSaving: saving,
    },
  };
}

export const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
