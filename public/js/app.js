import { SAMPLE_RETURNS, CITIES, cityById, CATEGORIES, CONDITIONS } from './data.js';
import { scoreItem, scoreBatch, planBatch, ROUTES, inr } from './score.js';
import { templateExplanation } from './explain.js';
import { renderMap } from './map.js';
import { parseCsv } from './csv.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cityName = (id) => cityById[id]?.name ?? id ?? '';
const pct = (v) => (v == null ? '–' : Math.round(v * 100));
const app = $('#app');

const DEFAULTS = { maxDistanceKm: 2600, shippingBudget: 500 };
const state = {
  mode: { qloo: 'demo', llm: 'template' },
  items: [],
  overrides: {},
  constraints: { ...DEFAULTS },
  filter: 'all',
  explanations: {},
  heat: {},
  listings: {},
  planTitles: {},
  planSig: '',
  summary: null,
  results: [],
  plan: null,
  source: '',
  running: false,
};

// ---------------------------------------------------------------- persistence
function save() {
  try { sessionStorage.setItem('rehome', JSON.stringify({ items: state.items, overrides: state.overrides, constraints: state.constraints, mode: state.mode, source: state.source })); } catch {}
}
function restore() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rehome') || 'null');
    if (s?.items?.length) Object.assign(state, s, { running: false });
  } catch {}
}

// ---------------------------------------------------------------- engine
function compute() {
  state.results = scoreBatch(state.items, state.constraints, state.overrides);
  state.plan = state.items.length ? planBatch(state.items, state.results) : null;
}
const resultFor = (id) => state.results[state.items.findIndex((i) => i.id === id)];

async function api(path, body) {
  const res = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// ---------------------------------------------------------------- chrome
function renderModes() {
  const q = state.mode.qloo === 'live';
  const l = state.mode.llm === 'live';
  $('#modes').innerHTML = `
    <span class="pill ${q ? 'is-live' : 'is-demo'}" title="${q ? 'Calling the Qloo API' : 'No QLOO_API_KEY set: using sample signals, not Qloo data'}">${q ? 'Qloo live' : 'Sample signals'}</span>
    <span class="pill ${l ? 'is-live' : 'is-demo'}" title="${l ? 'Agent text written by Gemini' : 'No GEMINI_API_KEY set: agent text uses templates'}">${l ? 'Agent live' : 'Agent templates'}</span>`;
  const hm = document.getElementById('hero-mode');
  if (hm) hm.innerHTML = `<i></i>${q ? 'Live · Qloo' : 'Sample signals'}`;
  const has = state.items.length > 0;
  $('#topnav').innerHTML = has ? `<a href="#/truck">Returns truck</a><a href="#/">New batch</a>` : '';
}

// ---------------------------------------------------------------- start
function viewStart() {
  const live = state.mode.qloo === 'live';
  app.innerHTML = `
  <section class="start">
    <div class="start-copy">
      <p class="eyebrow">Returns routing · India</p>
      <p class="start-brand">Rehome</p>
      <h1 class="hero-title">Every return has a city <em>that wants&nbsp;it.</em></h1>
      <p class="lede">Upload your returns. Rehome asks Qloo where each product's audience is strongest and routes it there, or tells you when resale, a bundle or a donation pays better.</p>
      <label class="dropbar" for="csv-file" id="dropbar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
        <span class="dropbar-text">Drop a returns CSV here, or choose a file</span>
        <span class="dropbar-btn">Upload <span aria-hidden="true">→</span></span>
      </label>
      <input type="file" id="csv-file" accept=".csv,text/csv" hidden>
      <p class="error" id="start-error" role="alert"></p>
      <div class="start-links">
        <button class="link-btn" id="run-sample"><span aria-hidden="true">▶</span> Route 50 sample returns (no upload)</button>
        <a class="link-btn quiet" href="/sample/returns.csv" download><span aria-hidden="true">↓</span> CSV template</a>
      </div>
      <ul class="tags" aria-label="What Rehome uses">
        <li>Qloo taste graph</li><li>10 cities</li><li>Live what-ifs</li><li>Agent reasons</li>
      </ul>
      <dl class="stats">
        <div><dt>Sample returns ready</dt><dd>50</dd></div>
        <div><dt>Cities scored per item</dt><dd>10</dd></div>
        <div><dt>Ways a return can go</dt><dd>6</dd></div>
      </dl>
    </div>
    <figure class="hero-card">
      <span class="hero-card-mode" id="hero-mode"><i></i>${live ? 'Live · Qloo' : 'Sample signals'}</span>
      ${renderMap({ hubs: ['MAA', 'DEL', 'BOM'] })}
      <figcaption>Returns wait in Chennai, Delhi and Mumbai. Route them and the map shows where each one sells.</figcaption>
    </figure>
  </section>`;
  const bar = $('#dropbar');
  bar.ondragover = (e) => { e.preventDefault(); bar.classList.add('is-over'); };
  bar.ondragleave = () => bar.classList.remove('is-over');
  bar.ondrop = (e) => { e.preventDefault(); bar.classList.remove('is-over'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };
  $('#run-sample').onclick = () => run(SAMPLE_RETURNS, 'sample');
  $('#csv-file').onchange = (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); };
}

async function handleFile(file) {
  try {
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error('That file has no rows under the header.');
    if (rows.length > 300) throw new Error('Upload at most 300 returns at a time.');
    if (!('brand' in rows[0]) || !('product' in rows[0])) throw new Error('The CSV needs at least “product” and “brand” columns. Download the template to see the format.');
    run(rows, file.name);
  } catch (err) {
    $('#start-error').textContent = err.message;
  }
}

// ---------------------------------------------------------------- run
async function run(rows, source) {
  state.running = true;
  location.hash = '#/run';
  state.items = []; state.overrides = {}; state.explanations = {}; state.heat = {}; state.listings = {};
  state.planTitles = {}; state.planSig = ''; state.summary = null; state.source = source; state.constraints = { ...DEFAULTS };
  app.innerHTML = `
  <section class="run">
    <h1>Routing ${rows.length} returns</h1>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${rows.length}" aria-valuenow="0"><span></span></div>
    <ol class="log" id="log"></ol>
  </section>`;
  const log = $('#log');
  const add = (text, cls = '') => { const li = document.createElement('li'); li.className = cls; li.textContent = text; log.append(li); li.scrollIntoView({ block: 'nearest' }); return li; };
  const bar = $('.progress');
  const CHUNK = 10;
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const pending = add(`Agent is matching rows ${i + 1}–${i + chunk.length} to Qloo…`, 'is-pending');
      const out = await api('analyze', { items: chunk });
      state.mode = out.mode; renderModes();
      pending.remove();
      out.trace.filter((t) => t.step !== 'done').forEach((t) => add(t.text, 'is-step'));
      for (const it of out.items) {
        state.items.push(it);
        const r = scoreItem(it, it.affinity);
        add(`${it.brand} ${it.product}: ${ROUTES[r.best.route]}${r.best.route === 'relocate' ? ' to ' + cityName(r.best.city) : r.best.route === 'restock' ? ' in ' + cityName(r.best.city) : ''}, ${inr(r.best.expected)}`, it.flags.length ? 'is-item is-flag' : 'is-item');
      }
      bar.setAttribute('aria-valuenow', state.items.length);
      bar.firstElementChild.style.width = `${(state.items.length / rows.length) * 100}%`;
    }
    add('Grouping the batch into shipments…', 'is-step');
    save();
    state.running = false;
    setTimeout(() => (location.hash = '#/truck'), 500);
  } catch (err) {
    state.running = false;
    add(`Stopped: ${err.message}. Check the server log, then try again.`, 'is-error');
    if (state.items.length) { save(); add('Routed items so far are on the truck page.', 'is-step'); }
  }
}

// ---------------------------------------------------------------- constraints UI
function constraintControls(withCondition = null) {
  const c = state.constraints;
  const cond = withCondition ? (state.overrides[withCondition.id] || withCondition.condition) : null;
  return `
  <fieldset class="whatif">
    <legend>What if</legend>
    <label class="ctl">
      <span>Only cities within <output id="o-km">${c.maxDistanceKm >= 2600 ? 'any distance' : c.maxDistanceKm.toLocaleString('en-IN') + ' km'}</output></span>
      <input type="range" id="c-km" min="0" max="2600" step="100" value="${c.maxDistanceKm}">
    </label>
    <label class="ctl">
      <span>Shipping budget per item <output id="o-budget">${c.shippingBudget >= 500 ? 'no cap' : inr(c.shippingBudget)}</output></span>
      <input type="range" id="c-budget" min="0" max="500" step="10" value="${c.shippingBudget}">
    </label>
    ${withCondition ? `<label class="ctl"><span>Condition</span>
      <select id="c-cond">${Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}" ${k === cond ? 'selected' : ''}>${v.label}${k === withCondition.condition ? ' (as returned)' : ''}</option>`).join('')}</select></label>` : ''}
    <button class="btn btn-small btn-quiet" id="c-reset" type="button">Reset</button>
  </fieldset>`;
}

function bindConstraints(onChange, item = null) {
  const km = $('#c-km'), budget = $('#c-budget'), cond = $('#c-cond');
  const update = () => {
    state.constraints.maxDistanceKm = Number(km.value);
    state.constraints.shippingBudget = Number(budget.value);
    if (item && cond) {
      if (cond.value === item.condition) delete state.overrides[item.id];
      else state.overrides[item.id] = cond.value;
    }
    $('#o-km').textContent = km.value >= 2600 ? 'any distance' : Number(km.value).toLocaleString('en-IN') + ' km';
    $('#o-budget').textContent = budget.value >= 500 ? 'no cap' : inr(budget.value);
    compute(); save(); onChange();
  };
  km.oninput = update; budget.oninput = update; if (cond) cond.onchange = update;
  $('#c-reset').onclick = () => {
    state.constraints = { ...DEFAULTS };
    if (item) delete state.overrides[item.id];
    km.value = DEFAULTS.maxDistanceKm; budget.value = DEFAULTS.shippingBudget; if (cond) cond.value = item.condition;
    update();
  };
}

// ---------------------------------------------------------------- truck
function localTitle(s) {
  const n = s.items.length, many = n > 1 ? 's' : '';
  if (s.route === 'relocate') return `Send ${n} item${many} from ${cityName(s.from)} to ${cityName(s.to)}`;
  if (s.route === 'restock') return `Restock ${n} item${many} in ${cityName(s.from)}`;
  if (s.route === 'resell') return `List ${n} item${many} online for targeted resale`;
  if (s.route === 'bundle') return `Bundle ${n} low-value item${many}`;
  if (s.route === 'donate') return `Donate ${n} item${many} in ${cityName(s.from)}`;
  return `Liquidate ${n} item${many}`;
}

let planTimer = null;
function refreshPlanTitles(rerender) {
  const sig = state.plan.shipments.map((s) => `${s.key}:${s.items.length}`).join('|');
  if (sig === state.planSig) return;
  state.planSig = sig;
  clearTimeout(planTimer);
  planTimer = setTimeout(async () => {
    try {
      const out = await api('plan', { shipments: state.plan.shipments, items: state.items.map(({ id, brand, product, category }) => ({ id, brand, product, category })) });
      if (sig !== state.planSig) return;
      state.planTitles = Object.fromEntries(out.shipments.map((s) => [s.key, s]));
      state.summary = out.summary;
      rerender();
    } catch { /* titles stay local */ }
  }, 700);
}

function viewTruck() {
  if (!state.items.length) return (location.hash = '#/');
  compute();
  const draw = () => {
    const { totals, shipments } = state.plan;
    const max = Math.max(totals.rehome, totals.restockNearest, totals.liquidateAll, 1);
    const bar = (label, v, cls) => `<div class="cmp-row ${cls}"><span class="cmp-label">${label}</span><span class="cmp-track"><span style="width:${(v / max) * 100}%"></span></span><span class="cmp-val">${inr(v)}</span></div>`;
    const counts = state.results.reduce((m, r) => ((m[r.best.route] = (m[r.best.route] || 0) + 1), m), {});
    const flagged = state.items.filter((i) => i.flags?.length).length;
    const chips = [['all', 'All', state.items.length], ...Object.keys(ROUTES).filter((k) => counts[k]).map((k) => [k, ROUTES[k], counts[k]]), ...(flagged ? [['flagged', 'Flagged', flagged]] : [])];
    const rows = state.items.map((it, i) => ({ it, r: state.results[i] }))
      .filter(({ it, r }) => state.filter === 'all' || (state.filter === 'flagged' ? it.flags?.length : r.best.route === state.filter));

    $('#truck-body').innerHTML = `
      <section class="compare" aria-label="Recovery compared">
        ${bar('Rehome routing', totals.rehome, 'is-rehome')}
        ${bar('Restock where it was returned', totals.restockNearest, 'is-nearest')}
        ${bar('Liquidate everything', totals.liquidateAll, 'is-liquidate')}
        <p class="compare-note"><strong>${inr(totals.rehome - totals.liquidateAll)}</strong> more than liquidating, <strong>${inr(totals.rehome - totals.restockNearest)}</strong> more than restocking where each item came back.</p>
        <dl class="facts">
          <div><dt>Kept from landfill</dt><dd>${totals.diverted} of ${totals.count}</dd></div>
          <div><dt>Inter-city lanes</dt><dd>${totals.interCityShipments}</dd></div>
          <div><dt>Logistics cost</dt><dd>${inr(totals.logistics)}</dd></div>
          <div><dt>Saved by consolidating</dt><dd>${inr(totals.consolidationSaving)}</dd></div>
        </dl>
      </section>
      ${state.summary ? `<p class="summary">${esc(state.summary)}</p>` : ''}
      <section aria-labelledby="ship-h">
        <h2 id="ship-h">Shipments</h2>
        <ol class="manifest">
          ${shipments.map((s) => {
            const t = state.planTitles[s.key];
            return `<li class="lane lane-${s.route}">
              <span class="lane-code">${s.route === 'relocate' ? `${s.from}<i>→</i>${s.to}` : s.route === 'restock' || s.route === 'donate' ? s.from : s.route === 'resell' ? 'WEB' : s.route === 'bundle' ? 'BDL' : 'LIQ'}</span>
              <span class="lane-main"><strong>${esc(t?.title || localTitle(s))}</strong>${t?.note ? `<span>${esc(t.note)}</span>` : ''}</span>
              <span class="lane-num">${s.items.length}<small>items</small></span>
              <span class="lane-num">${inr(s.expected)}<small>${s.saving ? `saves ${inr(s.saving)} consolidated` : s.transfer ? `${inr(s.transfer)} freight` : 'recovered'}</small></span>
            </li>`;
          }).join('')}
        </ol>
      </section>
      <section aria-labelledby="items-h">
        <h2 id="items-h">Every item</h2>
        <div class="chips" role="group" aria-label="Filter items">
          ${chips.map(([k, l, n]) => `<button class="chip ${state.filter === k ? 'is-on' : ''}" data-filter="${k}" aria-pressed="${state.filter === k}">${l} <span>${n}</span></button>`).join('')}
        </div>
        <div class="table-wrap"><table class="items">
          <thead><tr><th>Item</th><th>Now in</th><th>Route</th><th class="num">Recovers</th><th class="num">vs liquidating</th><th>Confidence</th></tr></thead>
          <tbody>${rows.map(({ it, r }) => `
            <tr data-id="${esc(it.id)}" tabindex="0">
              <td><a href="#/item/${encodeURIComponent(it.id)}"><strong>${esc(it.brand)}</strong> ${esc(it.product)}</a>${it.flags?.length ? `<span class="flag-dot" title="${esc(it.flags.map((f) => f.note).join('. '))}">${it.flags.length}</span>` : ''}</td>
              <td>${esc(cityName(it.city))}</td>
              <td><span class="route route-${r.best.route}">${ROUTES[r.best.route]}${r.best.city && r.best.route === 'relocate' ? ' to ' + esc(cityName(r.best.city)) : ''}</span></td>
              <td class="num">${inr(r.best.expected)}</td>
              <td class="num ${r.best.expected - r.liquidation >= 0 ? 'pos' : 'neg'}">${r.best.expected - r.liquidation >= 0 ? '+' : '−'}${inr(Math.abs(r.best.expected - r.liquidation))}</td>
              <td><span class="conf"><span style="width:${r.confidence * 100}%"></span></span></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </section>`;
    $('#truck-body').querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; draw(); }));
    $('#truck-body').querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.onclick = (e) => { if (e.target.closest('a')) return; location.hash = `#/item/${encodeURIComponent(tr.dataset.id)}`; };
      tr.onkeydown = (e) => { if (e.key === 'Enter') location.hash = `#/item/${encodeURIComponent(tr.dataset.id)}`; };
    });
    refreshPlanTitles(draw);
  };
  const cities = [...new Set(state.items.map((i) => cityName(i.city)))];
  app.innerHTML = `
  <section class="truck">
    <header class="page-head">
      <h1>Clear the returns truck</h1>
      <p>${state.items.length} returns from ${cities.slice(0, -1).join(', ')}${cities.length > 1 ? ' and ' : ''}${cities.at(-1)}. Change the limits to see every route and total update.</p>
      <a class="btn btn-quiet btn-small" href="data:text/csv;charset=utf-8,${encodeURIComponent(exportCsv())}" download="rehome-routes.csv" id="export">Download routes as CSV</a>
    </header>
    ${constraintControls()}
    <div id="truck-body"></div>
  </section>`;
  bindConstraints(() => { draw(); $('#export').href = `data:text/csv;charset=utf-8,${encodeURIComponent(exportCsv())}`; });
  draw();
}

function exportCsv() {
  compute();
  const rows = state.items.map((it, i) => {
    const r = state.results[i];
    return { ...it, city: cityName(it.city), route: ROUTES[r.best.route], destination: r.best.city ? cityName(r.best.city) : '', expectedRecovery: r.best.expected, liquidation: r.liquidation, confidence: r.confidence, flags: (it.flags || []).map((f) => f.note).join('; ') };
  });
  const cols = ['id', 'brand', 'product', 'category', 'condition', 'city', 'listPrice', 'route', 'destination', 'expectedRecovery', 'liquidation', 'confidence', 'flags'];
  const e = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => e(r[c])).join(','))].join('\n');
}

// ---------------------------------------------------------------- item
function viewItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return (location.hash = state.items.length ? '#/truck' : '#/');
  compute();
  const idx = state.items.indexOf(item);
  const prev = state.items[idx - 1], next = state.items[idx + 1];

  app.innerHTML = `
  <section class="item-view">
    <nav class="crumbs"><a href="#/truck">Back to the truck</a>
      <span>${prev ? `<a href="#/item/${encodeURIComponent(prev.id)}" aria-label="Previous item">Previous</a>` : ''}${next ? `<a href="#/item/${encodeURIComponent(next.id)}" aria-label="Next item">Next</a>` : ''}</span>
    </nav>
    <h1 class="item-title"><span>${esc(item.brand)}</span> ${esc(item.product)}</h1>
    <div class="item-grid">
      <div class="col-left" id="left"></div>
      <figure class="col-map" id="map"></figure>
      <div class="col-right" id="right"></div>
    </div>
    <div class="item-lower">
      <div id="why" class="why" aria-live="polite"></div>
      ${constraintControls(item)}
    </div>
    <section class="listing" id="listing"></section>
  </section>`;

  const draw = () => {
    const r = resultFor(item.id);
    const b = r.best;
    const cond = state.overrides[item.id] || item.condition;
    const blocked = new Set(r.options.filter((o) => o.blocked && o.city).map((o) => o.city));
    const isLive = item.match?.source === 'qloo';

    $('#left').innerHTML = `
      <dl class="spec">
        <div><dt>Returned to</dt><dd>${esc(cityName(item.city))}</dd></div>
        <div><dt>Category</dt><dd>${esc(CATEGORIES[item.category]?.label)}</dd></div>
        ${item.size ? `<div><dt>Size</dt><dd>${esc(item.size)}</dd></div>` : ''}
        <div><dt>Condition</dt><dd>${esc(CONDITIONS[cond]?.label)}${state.overrides[item.id] ? ' <em>(what-if)</em>' : ''}</dd></div>
        <div><dt>List price</dt><dd>${inr(item.listPrice)}</dd></div>
        <div><dt>Liquidator pays</dt><dd>${inr(r.liquidation)}</dd></div>
        <div><dt>Qloo match</dt><dd>${item.match?.found ? esc(item.match.name) + (isLive ? '' : ' <em>(sample)</em>') : 'None'}</dd></div>
      </dl>
      ${item.flags?.length ? `<ul class="flags">${item.flags.map((f) => `<li>${esc(f.note)}</li>`).join('')}</ul>` : ''}
      <div class="tag" aria-label="Routing decision">
        <span class="tag-hole" aria-hidden="true"></span>
        <span class="tag-route">${ROUTES[b.route]}</span>
        <span class="tag-code">${b.route === 'relocate' || b.route === 'restock' ? b.city : b.route === 'resell' ? 'WEB' : b.route === 'bundle' ? 'BDL' : b.route === 'donate' ? 'DON' : 'LIQ'}</span>
        <span class="tag-dest">${b.city ? esc(cityName(b.city)) : b.route === 'resell' ? 'Targeted online listing' : b.route === 'donate' ? 'Local donation partner' : b.route === 'bundle' ? 'Bundle with related items' : 'Bulk liquidator'}</span>
        <span class="tag-money"><strong>${inr(b.expected)}</strong> expected, ${b.expected >= r.liquidation ? `${inr(b.expected - r.liquidation)} more than liquidating` : 'no better option'}</span>
        <span class="tag-conf">Confidence ${Math.round(r.confidence * 100)}%</span>
      </div>`;

    const heat = state.heat[item.match?.id];
    $('#map').innerHTML = `
      ${renderMap({ affinity: item.affinity, heat: heat || [], from: item.city, to: b.route === 'relocate' ? b.city : null, blocked })}
      <figcaption>Where ${esc(item.brand)}'s audience is strongest. Numbers are ${isLive ? 'Qloo' : 'sample'} affinity out of 100; the square is where it sits now.${heat ? '' : ' Loading heatmap…'}</figcaption>`;

    const maxE = Math.max(...r.options.map((o) => o.expected), 1);
    $('#right').innerHTML = `
      <h2>Ranked options</h2>
      <ol class="options">
        ${r.options.slice(0, 9).map((o) => `
          <li class="opt ${o === b ? 'is-best' : ''} ${o.blocked ? 'is-blocked' : ''}">
            <span class="opt-name">${ROUTES[o.route]}${o.city && o.route === 'relocate' ? ' to ' + esc(cityName(o.city)) : o.route === 'restock' ? ' in ' + esc(cityName(o.city)) : ''}</span>
            <span class="opt-val">${inr(o.expected)}</span>
            <span class="opt-bar"><span style="width:${Math.max(0, o.expected / maxE) * 100}%"></span></span>
            <span class="opt-detail">${o.blocked ? esc(o.blocked) : optionDetail(o)}</span>
          </li>`).join('')}
      </ol>`;

    // Explanation: template now, agent text after a pause.
    const key = `${item.id}|${b.route}|${b.city}|${cond}|${b.expected}`;
    const cached = state.explanations[key];
    const text = cached?.text || templateExplanation(item, b, r.second);
    $('#why').innerHTML = `<h2>Why</h2><p>${esc(text)}</p>${!cached && state.mode.llm === 'live' ? '<p class="muted">Agent is writing the reason…</p>' : ''}`;
    if (!cached) debounceExplain(key, item, b, r.second, draw);

    drawListing(item, b);
  };

  bindConstraints(draw, item);
  draw();
  loadHeat(item, draw);
}

function optionDetail(o) {
  const parts = [];
  if (o.affinity != null) parts.push(`${o.route === 'resell' ? 'audience reach' : 'affinity'} ${pct(o.affinity)}`);
  if (o.sellProbability != null && o.route !== 'liquidate') parts.push(`${Math.round(o.sellProbability * 100)}% chance it sells`);
  if (o.route === 'relocate') parts.push(`${o.km.toLocaleString('en-IN')} km, ${inr(o.transfer)} freight`);
  if (o.crowding) parts.push(`${o.crowding.load} similar item${o.crowding.load === 1 ? '' : 's'} already headed there`);
  if (o.route === 'resell') parts.push(`after 15% fee and ${inr(o.transfer)} courier`);
  if (o.route === 'liquidate') parts.push('guaranteed, today');
  if (o.route === 'donate') parts.push('no recovery, stays out of landfill');
  if (o.route === 'bundle') parts.push('sold with related items');
  return parts.join(' · ');
}

let explainTimer = null;
function debounceExplain(key, item, best, second, redraw) {
  clearTimeout(explainTimer);
  if (state.mode.llm !== 'live') { state.explanations[key] = { text: templateExplanation(item, best, second) }; return; }
  explainTimer = setTimeout(async () => {
    try {
      const out = await api('explain', { item, best, second, constraints: state.constraints });
      state.explanations[key] = out;
    } catch { state.explanations[key] = { text: templateExplanation(item, best, second) }; }
    if (location.hash === `#/item/${encodeURIComponent(item.id)}`) redraw();
  }, 600);
}

async function loadHeat(item, redraw) {
  const id = item.match?.id;
  if (!id || state.heat[id]) return;
  try {
    const qs = new URLSearchParams({ id, brand: item.brand, category: item.category });
    const out = await api(`heatmap?${qs}`);
    state.heat[id] = out.points || [];
  } catch { state.heat[id] = []; }
  if (location.hash === `#/item/${encodeURIComponent(item.id)}`) redraw();
}

function drawListing(item, best) {
  const el = $('#listing');
  const l = state.listings[item.id];
  if (l === 'loading') { el.innerHTML = `<h2>Resale listing</h2><p class="muted">Agent is writing the listing for ${esc(item.brand)}'s audience…</p>`; return; }
  if (l) {
    el.innerHTML = `<h2>Resale listing</h2>
      <div class="listing-card"><p class="listing-aud">For: ${esc(l.audience)}</p><h3>${esc(l.title)}</h3><p>${esc(l.body)}</p></div>
      <button class="btn btn-small btn-quiet" id="copy-listing">Copy listing</button>`;
    $('#copy-listing').onclick = async (e) => {
      try { await navigator.clipboard.writeText(`${l.title}\n\n${l.body}`); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select and copy the text above'; }
    };
    return;
  }
  el.innerHTML = `<h2>Resale listing</h2><p class="muted">${best.route === 'resell' ? 'This item is routed to resale.' : 'Useful if you sell it online instead.'} The agent writes it for the audience Qloo links to ${esc(item.brand)}.</p>
    <button class="btn btn-small ${best.route === 'resell' ? 'btn-primary' : 'btn-quiet'}" id="make-listing">Write resale listing</button>`;
  $('#make-listing').onclick = async () => {
    state.listings[item.id] = 'loading'; drawListing(item, best);
    try { state.listings[item.id] = await api('listing', { item }); }
    catch (err) { state.listings[item.id] = null; el.insertAdjacentHTML('beforeend', `<p class="error">${esc(err.message)}</p>`); return; }
    drawListing(item, best);
  };
}

// ---------------------------------------------------------------- router
function route() {
  renderModes();
  const h = location.hash || '#/';
  window.scrollTo(0, 0);
  if (h.startsWith('#/item/')) return viewItem(decodeURIComponent(h.slice(7)));
  if (h === '#/truck') return viewTruck();
  if (h === '#/run') return state.running ? undefined : state.items.length ? viewTruck() : viewStart();
  return viewStart();
}

restore();
api('status').then((m) => { state.mode = m; renderModes(); }).catch(() => {});
window.addEventListener('hashchange', route);
route();
