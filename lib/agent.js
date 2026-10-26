// The Rehome agent: plan (match products, flag oddities) -> act (Qloo) -> review (explain, group, list).
// Scoring itself is a pure tool in public/js/score.js so what-if changes run instantly in the browser.

import { CATEGORIES, CONDITIONS, cityById, cityIdFromName } from '../public/js/data.js';
import { ROUTES, inr } from '../public/js/score.js';
import { complete, completeJson, llmMode } from './llm.js';
import { templateExplanation } from '../public/js/explain.js';
import { resolveBrand, cityDemand, qlooMode } from './qloo.js';

const SYSTEM = `You are Rehome, a returns-routing agent for an Indian retailer.
You decide where returned products should go next: restock, relocate to another city, resell online, bundle, liquidate or donate.
Qloo's taste graph tells you where each brand's audience is strongest, city by city. Costs come from a fixed table.
Be concrete and brief. Use rupees (₹). Never invent numbers that were not given to you.`;

const CATEGORY_WORDS = {
  apparel: ['apparel', 'clothing', 'shirt', 'tee', 'jacket', 'kurta', 'dress', 'jeans', 'hoodie', 'fashion', 'leggings'],
  sneakers: ['sneaker', 'shoe', 'footwear', 'trainer', 'clog'],
  beauty: ['beauty', 'cosmetic', 'makeup', 'skincare', 'serum', 'lipstick', 'perfume', 'fragrance'],
  games: ['game', 'toy', 'puzzle', 'lego', 'board'],
  books: ['book', 'novel', 'manga', 'comic'],
  audio: ['audio', 'headphone', 'earbud', 'speaker'],
};

export function normaliseCategory(text) {
  const t = String(text || '').toLowerCase();
  if (CATEGORIES[t]) return t;
  for (const [cat, words] of Object.entries(CATEGORY_WORDS)) if (words.some((w) => t.includes(w))) return cat;
  return 'apparel';
}

export function normaliseCondition(text) {
  const t = String(text || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (CONDITIONS[t]) return t;
  if (t.includes('like')) return 'like_new';
  if (t.includes('new') || t.includes('unopened') || t.includes('sealed')) return 'new';
  if (t.includes('damag') || t.includes('broken') || t.includes('defect')) return 'damaged';
  if (t.includes('fair') || t.includes('worn')) return 'fair';
  return 'good';
}

/** Clean one uploaded row into Rehome's item shape. */
export function normaliseItem(row, i) {
  const listPrice = Number(String(row.listPrice ?? row.price ?? '').replace(/[^0-9.]/g, '')) || 0;
  const liq = Number(String(row.liquidationValue ?? '').replace(/[^0-9.]/g, ''));
  return {
    id: row.id || `R-${String(i + 1).padStart(4, '0')}`,
    product: row.product || row.name || 'Unnamed item',
    brand: (row.brand || '').trim(),
    category: normaliseCategory(row.category || row.product),
    size: row.size || '',
    condition: normaliseCondition(row.condition),
    city: cityIdFromName(row.city) || row.city || 'DEL',
    listPrice,
    liquidationValue: liq > 0 ? liq : Math.round(listPrice * 0.28),
  };
}

function ruleFlags(item) {
  const flags = [];
  if (item.condition === 'damaged') flags.push({ type: 'damaged', note: 'Damaged, so shelf routes are off' });
  if (item.listPrice > 0 && item.listPrice < 400) flags.push({ type: 'low_value', note: 'Low value: shipping can cost more than it earns' });
  if (item.listPrice >= 15000) flags.push({ type: 'high_value', note: 'High value: inspect before it ships' });
  if (!item.brand) flags.push({ type: 'no_brand', note: 'No brand given, so Qloo has nothing to match' });
  if (!cityById[item.city]) flags.push({ type: 'unknown_city', note: `Unknown city “${item.city}”` });
  return flags;
}

/** Step 1, plan: map messy rows to Qloo brand queries and flag oddities. */
async function planMatches(items) {
  const rules = items.map((it) => ({ id: it.id, brandQuery: it.brand, flags: ruleFlags(it) }));
  if (llmMode() !== 'live') return { matches: rules, by: 'rules' };
  const rows = items.map((it) => `${it.id} | ${it.product} | brand: ${it.brand || '?'} | ${it.category} | ${it.condition} | ${inr(it.listPrice)}`).join('\n');
  const reply = await completeJson({
    system: SYSTEM,
    maxTokens: 2500,
    prompt: `For each returned item, give the brand name exactly as Qloo's brand catalog would know it (e.g. "Levis" -> "Levi's", a book -> its publisher brand), and any flag a human should see (wrong category, suspicious price, product that does not match the brand). Return JSON only: [{"id": "...", "brandQuery": "...", "flag": null or "short note"}].\n\n${rows}`,
  });
  if (!Array.isArray(reply)) return { matches: rules, by: 'rules' };
  const byId = Object.fromEntries(reply.map((r) => [r.id, r]));
  return {
    by: 'llm',
    matches: rules.map((r) => {
      const l = byId[r.id];
      const flags = [...r.flags];
      if (l?.flag) flags.push({ type: 'agent', note: String(l.flag).slice(0, 120) });
      return { ...r, brandQuery: (l?.brandQuery || r.brandQuery || '').trim(), flags };
    }),
  };
}

/** Plan -> act: match every item to Qloo and fetch per-city affinity. */
export async function analyze(rawItems) {
  const trace = [];
  const items = rawItems.map(normaliseItem);
  const t0 = Date.now();
  const { matches, by } = await planMatches(items);
  trace.push({ step: 'match', text: by === 'llm' ? `Matched ${items.length} rows to Qloo brand names` : `Read ${items.length} rows (rule-based matching)` });

  const brands = new Map();
  matches.forEach((m, i) => {
    const q = m.brandQuery;
    if (q && !brands.has(q.toLowerCase())) brands.set(q.toLowerCase(), { query: q, category: items[i].category });
  });
  const entities = await Promise.all([...brands.values()].map(async (b) => ({ ...(await resolveBrand(b.query)), category: b.category })));
  const found = entities.filter((e) => e.found).length;
  trace.push({ step: 'resolve', text: `Found ${found} of ${entities.length} brands in Qloo` });

  const demand = await cityDemand(entities);
  const viaStores = entities.filter((e) => e.kind === 'place').length;
  trace.push({ step: 'affinity', text: `Mapped Qloo heatmap demand for ${found} brands across 10 cities${viaStores ? ` (${viaStores} via their stores)` : ''}` });

  const byQuery = Object.fromEntries(entities.map((e) => [e.query.toLowerCase(), e]));
  const out = items.map((it, i) => {
    const m = matches[i];
    const ent = byQuery[(m.brandQuery || '').toLowerCase()];
    const d = ent ? demand[ent.id ?? ent.query] ?? {} : {};
    const affinity = d.affinity ?? {};
    const flags = [...m.flags];
    if (ent && !ent.found) flags.push({ type: 'no_match', note: `Qloo has no brand called “${m.brandQuery}”` });
    else if (ent && !Object.keys(affinity).length) flags.push({ type: 'no_signal', note: 'Qloo returned no city signal for this brand' });
    else if (ent?.kind === 'place') flags.push({ type: 'proxy', note: `No Qloo brand entity; demand read from its ${ent.stores} store${ent.stores === 1 ? '' : 's'}` });
    return { ...it, match: ent ? { id: ent.id, name: ent.name, kind: ent.kind, source: ent.source, found: ent.found } : null, affinity, popularity: d.popularity ?? null, flags };
  });
  trace.push({ step: 'done', text: `Analysed in ${((Date.now() - t0) / 1000).toFixed(1)} s` });
  return { items: out, trace, mode: { qloo: qlooMode(), llm: llmMode() } };
}

// ---------------------------------------------------------------------------
// Review: explanations, shipment plan, listings.


export async function explain({ item, best, second, constraints }) {
  const fallback = templateExplanation(item, best, second);
  if (llmMode() !== 'live') return { text: fallback, by: 'template' };
  const affLines = Object.entries(item.affinity || {}).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${cityById[c]?.name}: ${v}`).join(', ');
  const text = await complete({
    system: SYSTEM,
    maxTokens: 160,
    prompt: `Write ONE sentence (max 35 words) explaining this routing decision to a returns manager. Cite the Qloo affinity and the money.\n\nItem: ${item.product} by ${item.brand}, ${item.condition}, now in ${cityById[item.city]?.name}, list ${inr(item.listPrice)}.\nQloo affinity by city: ${affLines || 'none'}.\nChosen: ${ROUTES[best.route]}${best.city ? ' to ' + cityById[best.city]?.name : ''}, expected ${inr(best.expected)}, transfer ${inr(best.transfer)}.\nRunner-up: ${second ? `${ROUTES[second.route]}${second.city ? ' to ' + cityById[second.city]?.name : ''}, ${inr(second.expected)}` : 'none'}.\nConstraints: ${JSON.stringify(constraints || {})}.`,
  });
  return { text: text || fallback, by: text ? 'llm' : 'template' };
}

export async function planShipments({ shipments, items }) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const name = (id) => cityById[id]?.name ?? id;
  const describe = (s) => {
    const its = s.items.map((id) => byId[id]).filter(Boolean);
    const cats = [...new Set(its.map((i) => CATEGORIES[i.category]?.label.toLowerCase()))].slice(0, 3).join(', ');
    return { its, cats };
  };
  const fallback = shipments.map((s) => {
    const { cats } = describe(s);
    const n = s.items.length;
    const title = s.route === 'relocate' ? `Send ${n} item${n > 1 ? 's' : ''} from ${name(s.from)} to ${name(s.to)}`
      : s.route === 'restock' ? `Restock ${n} in ${name(s.from)}`
      : s.route === 'resell' ? `List ${n} online for targeted resale`
      : s.route === 'bundle' ? `Bundle ${n} low-value item${n > 1 ? 's' : ''}`
      : s.route === 'donate' ? `Donate ${n} in ${name(s.from)}`
      : `Liquidate ${n}`;
    return { key: s.key, title, note: cats ? `Mostly ${cats}` : '' };
  });
  if (llmMode() !== 'live') return { shipments: fallback, summary: null, by: 'template' };
  const lines = shipments.map((s) => {
    const { its } = describe(s);
    return `${s.key} | ${s.route} ${s.from ? name(s.from) : ''}${s.to ? ' -> ' + name(s.to) : ''} | ${its.length} items: ${its.map((i) => `${i.brand} ${i.product}`).join('; ')} | expected ${inr(s.expected)}`;
  }).join('\n');
  const reply = await completeJson({
    system: SYSTEM,
    maxTokens: 1500,
    prompt: `Here is the routing plan for a batch of returns, grouped into lanes. For each lane write a short imperative title (max 9 words, e.g. "Send 12 athleisure items to Bengaluru") and a note (max 14 words) on what the items have in common or what to watch. Then a 2-sentence summary for the returns manager. JSON only: {"lanes":[{"key":"...","title":"...","note":"..."}],"summary":"..."}\n\n${lines}`,
  });
  if (!reply?.lanes) return { shipments: fallback, summary: null, by: 'template' };
  const byKey = Object.fromEntries(reply.lanes.map((l) => [l.key, l]));
  return { shipments: fallback.map((f) => ({ ...f, ...(byKey[f.key] || {}) })), summary: reply.summary || null, by: 'llm' };
}

export async function writeListing({ item, audience }) {
  const aud = audience?.summary || describeAudience(audience) || 'shoppers who follow the brand';
  const cond = CONDITIONS[item.condition]?.label.toLowerCase() ?? 'good';
  const fallback = {
    title: `${cond[0].toUpperCase() + cond.slice(1)} ${item.brand} ${item.product}${item.size ? ', ' + item.size : ''}`,
    body: `${item.brand} ${item.product} in ${cond} condition${item.size ? ', size ' + item.size : ''}. ${item.condition === 'new' || item.condition === 'like_new' ? 'Returned unused and checked by our team.' : 'Checked by our team; see photos for wear.'} Ships in 2 days.`,
    audience: aud,
  };
  if (llmMode() !== 'live') return { ...fallback, by: 'template' };
  const reply = await completeJson({
    system: SYSTEM,
    maxTokens: 400,
    prompt: `Write a resale marketplace listing for a returned item, aimed at this audience: ${aud}. Honest about condition, no hype, no made-up specs. JSON only: {"title": "max 80 chars", "body": "2-3 sentences"}.\n\nItem: ${item.brand} ${item.product}, size ${item.size || 'n/a'}, condition ${cond}, list price ${inr(item.listPrice)}.`,
  });
  return reply?.title ? { title: reply.title, body: reply.body, audience: aud, by: 'llm' } : { ...fallback, by: 'template' };
}

function describeAudience(d) {
  if (!d || typeof d !== 'object') return null;
  const parts = [];
  const age = d.age && Object.entries(d.age).sort((a, b) => b[1] - a[1])[0];
  const gender = d.gender && Object.entries(d.gender).sort((a, b) => b[1] - a[1])[0];
  if (age) parts.push(`skews ${age[0].replace(/_/g, ' ')}`);
  if (gender) parts.push(`leans ${gender[0]}`);
  return parts.length ? `Qloo audience ${parts.join(', ')}` : null;
}
