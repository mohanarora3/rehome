// Demand map: Natural Earth outline of India (Mercator), dotted land, Qloo heat and city affinity.
import { CITIES, cityById } from './data.js';
import { INDIA } from './india.js';

const W = 800, H = 900, PAD = 28;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const pts = INDIA.flat();
const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
const minY = Math.min(...pts.map((p) => mercY(p[1]))), maxY = Math.max(...pts.map((p) => mercY(p[1])));
const k = Math.min((W - 2 * PAD) / (((maxX - minX) * Math.PI) / 180), (H - 2 * PAD) / (maxY - minY));
const offX = (W - (((maxX - minX) * Math.PI) / 180) * k) / 2;
const offY = (H - (maxY - minY) * k) / 2;

export const project = (lat, lon) => [offX + (((lon - minX) * Math.PI) / 180) * k, offY + (maxY - mercY(lat)) * k];

const OUTLINE = INDIA.map((ring) => ring.map(([lon, lat], i) => `${i ? 'L' : 'M'}${project(lat, lon).map((v) => v.toFixed(1)).join(',')}`).join('') + 'Z').join('');

// Label placement so nearby cities don't collide (Mumbai/Pune, Bengaluru/Chennai).
const LEFT_LABELS = new Set(['BOM', 'BLR', 'AMD']);
const LABEL_DY = { BOM: -8, PNQ: 12, BLR: 10, MAA: -4 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let uid = 0;

/**
 * @param opts {affinity, heat:[{lat,lon,affinity}], from, to, blocked:Set, hubs:[cityId], compact}
 */
export function renderMap(opts = {}) {
  const { affinity = {}, heat = [], from = null, to = null, blocked = new Set(), hubs = [], compact = false } = opts;
  const id = `m${++uid}`;
  const vals = Object.values(affinity).filter((v) => v != null);
  const max = vals.length ? Math.max(...vals) : 1;

  const heatDots = heat.map((p) => {
    const [x, y] = project(p.lat, p.lon);
    const a = Math.max(0, Math.min(1, (p.affinity ?? 0) / (max || 1)));
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(14 + 30 * a).toFixed(1)}" fill="url(#${id}-heat)" style="opacity:${(0.15 + 0.6 * a).toFixed(2)}"/>`;
  }).join('');

  const target = to && cityById[to] ? project(cityById[to].lat, cityById[to].lon) : null;
  let arc = '';
  if (from && target && from !== to && cityById[from]) {
    const [x1, y1] = project(cityById[from].lat, cityById[from].lon);
    const [x2, y2] = target;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
    arc = `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}Q${(mx - dy * 0.3).toFixed(1)} ${(my + dx * 0.3).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" class="route-arc" marker-end="url(#${id}-arrow)"/>`;
  }

  const cities = CITIES.map((c) => {
    const [x, y] = project(c.lat, c.lon);
    const v = affinity[c.id];
    const a = v == null ? 0 : v / (max || 1);
    const r = v == null ? (hubs.includes(c.id) ? 9 : 6) : 6 + 12 * a;
    const isTo = c.id === to, isFrom = c.id === from, isHub = hubs.includes(c.id);
    const cls = ['city', isTo && 'is-to', isFrom && 'is-from', isHub && 'is-hub', blocked.has(c.id) && 'is-blocked', v == null && 'is-empty'].filter(Boolean).join(' ');
    const anchor = LEFT_LABELS.has(c.id) ? 'end' : 'start';
    const lx = anchor === 'end' ? x - r - 10 : x + r + 10;
    const ly = y + 8 + (LABEL_DY[c.id] || 0);
    const label = compact ? '' : `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" class="city-label">${esc(c.name)}${v != null ? ` <tspan class="city-val">${Math.round(v * 100)}</tspan>` : ''}</text>`;
    const box = isFrom ? `<rect x="${(x - r - 6).toFixed(1)}" y="${(y - r - 6).toFixed(1)}" width="${(2 * r + 12).toFixed(1)}" height="${(2 * r + 12).toFixed(1)}" class="from-box"/>` : '';
    const ripple = isHub || isTo ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" class="ripple"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" class="ripple late"/>` : '';
    return `<g class="${cls}" data-city="${c.id}"><title>${esc(c.name)}${v != null ? `: affinity ${v.toFixed(2)}` : ''}</title>${ripple}${box}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="dot"/>${label}</g>`;
  }).join('');

  const glow = target || project(21, 79);

  return `<svg viewBox="0 0 ${W} ${H}" class="map" role="img" aria-label="Map of India showing where this brand's audience is strongest">
    <defs>
      <pattern id="${id}-dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="1.6" class="land-dot"/></pattern>
      <radialGradient id="${id}-shine" cx="${(glow[0] / W).toFixed(3)}" cy="${(glow[1] / H).toFixed(3)}" r="0.55"><stop offset="0" class="shine-in"/><stop offset="1" class="shine-out"/></radialGradient>
      <radialGradient id="${id}-heat"><stop offset="0" class="heat-in"/><stop offset="1" class="heat-out"/></radialGradient>
      <filter id="${id}-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <clipPath id="${id}-clip"><path d="${OUTLINE}"/></clipPath>
      <marker id="${id}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrow-head"/></marker>
    </defs>
    <g clip-path="url(#${id}-clip)">
      <rect width="${W}" height="${H}" class="land"/>
      <rect width="${W}" height="${H}" fill="url(#${id}-dots)"/>
      <rect width="${W}" height="${H}" fill="url(#${id}-shine)"/>
      <g class="heat-layer">${heatDots}</g>
    </g>
    <path d="${OUTLINE}" class="outline" filter="url(#${id}-glow)"/>
    ${arc}${cities}
  </svg>`;
}
