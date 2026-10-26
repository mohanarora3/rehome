// Template explanation, used instantly in the browser and as the server fallback.
import { cityById } from './data.js';
import { ROUTES, inr } from './score.js';

export function templateExplanation(item, best, second) {
  const name = (id) => cityById[id]?.name ?? id;
  const here = name(item.city);
  if (best.route === 'relocate') {
    const local = item.affinity?.[item.city];
    return `${name(best.city)} shows ${pct(best.affinity)} affinity for ${item.brand} vs ${pct(local)} in ${here}. Moving it costs ${inr(best.transfer)} and lifts expected recovery to ${inr(best.expected)}${second ? `, ahead of ${ROUTES[second.route].toLowerCase()}${second.city && second.route === 'relocate' ? ' to ' + name(second.city) : second.route === 'restock' ? ' in ' + name(second.city) : ''} at ${inr(second.expected)}` : ''}.`;
  }
  if (best.route === 'restock') {
    const top = Object.entries(item.affinity || {}).sort((a, b) => b[1] - a[1])[0];
    if (!top || top[0] === item.city) return `${here} already has the strongest pull for ${item.brand} (${pct(best.affinity)} affinity), so it goes back on the local shelf with no transfer cost. Expected recovery ${inr(best.expected)}.`;
    return `${name(top[0])} wants ${item.brand} more (${pct(top[1])} vs ${pct(best.affinity)} here), but the move isn't worth it within your limits, so it goes back on the shelf in ${here}. Expected recovery ${inr(best.expected)}.`;
  }
  if (best.route === 'resell') return `No single store beats selling it online: ${item.brand}'s audience is spread across cities, so a targeted listing recovers about ${inr(best.expected)} after fees and courier.`;
  if (best.route === 'bundle') return `At ${inr(item.listPrice)} it earns more in a bundle with related products (${inr(best.expected)}) than it would after shipping on its own.`;
  if (best.route === 'liquidate') return `Every other route costs more than it adds, so the liquidator's ${inr(best.expected)} is the best return.`;
  return `Nothing recovers more than ₹${50}, so it goes to a local donation partner and stays out of landfill.`;
}

export const pct = (v) => (v == null ? 'no' : `${Math.round(v * 100)}%`);
