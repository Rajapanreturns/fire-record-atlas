// The persistent map ("stage"). One DOM node lives for the whole session: the router parks it outside <main> before a
// view is replaced and shows it again as the world map (atlas), a docked inset (region) or hidden (trust).
// Cells are projected once into a fixed base space (Equal Earth, BASE_W wide); a view is an affine transform, so zooming
// and resizing never re-project. Each month's colours are one Path2D per class, built once and cached; a frame is a
// handful of fills. Canvas draws cells; SVG draws coast, graticule, region boxes, leaders and the focus point.
// The URL stays the only state: the atlas month is &cal=1..12 (absent = all year).
import { MONTH_ABBR, MONTH_LETTER } from './core.js';
import { loadDoc, loadLand } from './data.js';
import { h, fmtN, prefersReducedMotion, fixtureVeil } from './ui.js';
import { MONTH_FULL, MONTH_PLURAL, regionChip, shortName, peakMonths, runLabel, DETECTION_NOTE, boxStatusWord, landingCopy } from './story.js';
import { allRegions } from './m2.js';
import { westEast, statusChip, testWord } from './trustctx.js';
import { joinLayers, layerThresholds, classify, monthTotals, bandRows, areaSeason, nearestRegion, cellOf, calParam } from './monthly.js';

import { createGlobe } from './globe.js';

import { VIZ } from './viz.js';
const OCHRE = ['#455052', '#796449', '#9E7847', '#C5924C', '#E9A84F', '#FFD078'];
// 'no detections reported' keeps its flat grey fill; a 1 px lighter inner edge separates it from blank (4.05:1 vs #0B1114).
export const ZERO_EDGE = '#6A7678';
const BASE_W = 1000;
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const ICON = {
  labels: 'M2 3h7l5 5-6 6-6-6zM5.2 6h.1',
  month: 'M3 4h10v9H3zM3 7h10M6 2.5v3M10 2.5v3',
  regions: 'M2.5 3.5h11v9h-11zM5 6h3v3H5zM10 9.5h1.5',
  trust: 'M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4zM5.8 8l1.6 1.6L10.5 6.5',
  place: 'M8 14s-4.5-4.2-4.5-7.5a4.5 4.5 0 0 1 9 0C12.5 9.8 8 14 8 14zM8 8.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  words: 'M3 3h4.5c.8 0 .5.5.5 1v9c0-.6-.3-1-1-1H3zM13 3H8.5c-.8 0-.5.5-.5 1v9c0-.6.3-1 1-1H13z',
  play: 'M5 3.5v9l7-4.5z',
  pause: 'M5 3.5h2v9H5zM9.5 3.5h2v9h-2z',
};
const icon = (d) => { const s = svgEl('svg', { viewBox: '0 0 16 16', class: 'ico', 'aria-hidden': 'true' }); s.append(svgEl('path', { d })); return s; };

const S = {
  el: null, home: null, ready: null, L: null, th: null, proj: null, baseH: 0, quads: null, cache: new Map(), land: null,
  mode: 'hidden', cal: 0, view: null, ctx: null, manifest: null, region: null, focus: { lat: -13, lon: 132 }, card: null,
  projection: 'globe', globe: null, playing: null, lastFrameMs: null, tween: null,
};

/** Build the stage DOM once. `home` is the element the stage is parked in between views. */
export function createStage(home) {
  if (S.el) return S.el;
  S.home = home;
  const canvas = h('canvas', { class: 'st-canvas', 'aria-hidden': 'true' });
  const ghost = h('canvas', { class: 'st-ghost', 'aria-hidden': 'true' });
  const svg = svgEl('svg', { class: 'st-svg', 'aria-hidden': 'true' });
  const gWorld = svgEl('g', { class: 'st-world' }); const gScreen = svgEl('g', { class: 'st-screen' });
  svg.append(gWorld, gScreen);
  const labels = h('div', { class: 'st-labels' });
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const map = h('div', { class: 'st-map', tabindex: '0', role: 'group', 'aria-roledescription': 'map',
    'aria-label': 'World map of typical hot-spot detections. Arrow keys move a point (Shift for 5 degrees); Enter shows that place’s typical season. Region labels open each study region.' },
    canvas, ghost, svg, labels, live);
  const stampEl = h('p', { class: 'st-stamp' });
  const miniLegend = h('div', { class: 'st-mini', 'aria-label': 'Map legend' });
  const coordinateEl = h('p', { class: 'st-coordinates', 'aria-hidden': 'true', text: 'Inspect a place' });
  const globeHost = h('div', { class: 'st-globe', hidden: true });
  map.append(globeHost, stampEl, coordinateEl);
  const rail = h('nav', { class: 'st-rail', 'aria-label': 'Map tools' });
  const strip = h('div', { class: 'st-strip' });
  const bands = h('aside', { class: 'st-bands', 'aria-labelledby': 'st-bands-h' });
  const legend = h('div', { class: 'st-legend' });
  // M4.4 landing: one headline, one supporting sentence, one primary action (filled from data in initStage)
  const cta = h('a', { class: 'btn btn-primary st-cta', href: '?view=trust&machine=1', 'data-nav': 'trust', hidden: true });
  const head = h('div', { class: 'st-head' },
    h('div', { class: 'st-head-t' }, h('h1', { class: 'st-title', id: 'st-title', text: 'Global fire atlas' }),
      h('p', { class: 'st-deck', text: 'Where and when satellites detect hot spots.' })), cta);
  const menu = h('div', { class: 'st-menu', hidden: true, role: 'dialog', 'aria-label': 'Regions and places' });
  const cardBox = h('div', { class: 'st-card', hidden: true, role: 'dialog', 'aria-labelledby': 'st-card-h' });
  const veil = h('div', { class: 'st-veil' });
  // Region directory: one list per test group (NOAA-20 across decades; the earlier S-NPP test).
  const chips = h('div', { class: 'st-dir-groups' });
  const regionsTitle = h('h2', { class: 'side-title', text: 'Study regions' });
  const regionsCount = h('span', { class: 'regions-count' });
  const directory = h('section', { class: 'st-directory', 'aria-label': 'Study regions' },
    h('div', { class: 'side-heading' }, regionsTitle, regionsCount), chips);
  const acquisition = h('section', { class: 'st-acquisition instrument', 'aria-label': 'Map layer' });
  const profile = h('section', { class: 'st-profile instrument', 'aria-label': 'Monthly detection profile' });
  const projectionControls = h('div', { class: 'projection-controls', role: 'group', 'aria-label': 'Projection' });
  for (const [value, name] of [['globe', 'Globe'], ['flat', 'Flat map']]) {
    projectionControls.append(h('button', { type: 'button', 'data-projection': value, text: name,
      onclick: () => { closeCard(); toggleMenuClosed(); S.projection = value; updateProjection(); } }));
  }
  const mapHeading = h('div', { class: 'st-toolbar' },
    h('h2', { class: 'map-title', text: 'Detection density' }), projectionControls);
  const el = h('section', { class: 'stage', id: 'stage', 'aria-label': 'Map', hidden: true }, head,
    h('div', { class: 'st-body' },
      h('div', { class: 'st-left' }, acquisition, directory),
      h('div', { class: 'st-mapcol' }, mapHeading,
        h('div', { class: 'st-mapwrap' }, map, miniLegend, cardBox, menu, veil), strip,
        h('div', { class: 'map-tools-row' }, rail),
        h('p', { class: 'st-cap' })),
      h('div', { class: 'st-side' }, profile, bands)),
    legend);
  Object.assign(S, { cta, miniLegend, globeHost, projectionControls, profile, acquisition, directory, regionsCount, coordinateEl, chips, el, canvas, ghost, svg, gWorld, gScreen, labels, live, map, stampEl, rail, strip, bands, legend, head, menu, cardBox, veil });
  home.append(el);
  new ResizeObserver(() => { if (S.mode !== 'hidden' && S.proj) { sizeCanvas(); S.view = targetView(); draw(); S.globe?.resize(); } }).observe(map);
  bindMap();
  return el;
}

/** Load belt (+ belt_monthly when listed and aligned) and land, project once. Resolves to the joined layer or null. */
export function initStage(manifest) {
  if (S.ready && S.manifest === manifest) return S.ready;
  S.manifest = manifest; S.cache.clear();
  S.ready = (async () => {
    const layers = manifest.global_layers || [];
    const lb = layers.find((l) => l.id === 'belt'); const lm = layers.find((l) => l.id === 'belt_monthly');
    const okStatus = (l) => l && l.path && l.status !== 'pending';
    const [belt, bm, land] = await Promise.all([
      okStatus(lb) ? loadDoc(lb.path, 'belt').catch((e) => { S.err = e; return null; }) : null,
      okStatus(lm) ? loadDoc(lm.path, 'belt_monthly').catch(() => null) : null,
      loadLand().catch(() => null)]);
    S.land = land;
    project();
    S.L = belt ? joinLayers(belt, bm) : null;
    if (S.L) { S.th = layerThresholds(S.L); buildQuads(); }
    if (S.L) {
      S.globe = createGlobe(S.globeHost, { layer: S.L, thresholds: S.th, landGeo: S.landGeo,
        regions: allRegions(manifest), colours: OCHRE, zeroEdge: ZERO_EDGE, onRegion: openRegion,
        onPlace: (point) => openCard(point, { opener: S.globeHost.querySelector('canvas') }),
        onCoordinates: (point) => { S.coordinateEl.textContent = point ? `${fmtLat(point.lat)}   ${fmtLon(point.lon)}` : 'Drag to rotate · click to inspect'; } });
    }
    buildRail(); buildStrip(); buildAcquisition(); buildProfile(); paintStatic(); paintHead();
    if (S.L && S.L.monthly) warmCache();
    return S.L;
  })();
  return S.ready;
}

function usingGlobe() {
  return Boolean(S.globe && S.projection === 'globe' && S.mode === 'world');
}

function updateProjection() {
  const active = usingGlobe();
  S.globeHost.hidden = !active;
  S.el.classList.toggle('use-globe', active);
  S.map.tabIndex = active ? -1 : 0;
  S.globe?.setActive(active);
  if (active) {
    S.globe.setMonth(S.cal);
    S.globe.setLabels(S.labelsBtn?.getAttribute('aria-pressed') !== 'false');
    S.globe.resize();
    S.map.setAttribute('aria-label', 'World globe of typical hot-spot detections');
  } else if (S.mode === 'world') {
    S.map.setAttribute('aria-label', 'World map of typical hot-spot detections. Arrow keys move a point, Shift moves five degrees, and Enter shows its season.');
  }
  S.coordinateEl.textContent = active ? 'Drag to rotate · click to inspect' : 'Inspect a place';
  S.projectionControls.querySelectorAll('button').forEach((button) => {
    const globe = button.dataset.projection === 'globe';
    button.disabled = globe && !S.globe;
    button.setAttribute('aria-pressed', String(globe === active));
  });
}

function buildAcquisition() {
  S.acquisition.replaceChildren();
  if (!S.L) { S.acquisition.hidden = true; return; }
  S.acquisition.hidden = false;
  const rows = h('dl', { class: 'layer-readings' });
  for (const [label,value] of [
    ['Sensor', 'Aqua MODIS'], ['Overpass', dnWords()], ['Grid', `${S.L.res}° × ${S.L.res}°`], ['Land cells', fmtN(S.L.n)],
  ]) rows.append(h('div', {}, h('dt', { text: label }), h('dd', { text: value })));
  S.acquisition.append(h('h2', { class: 'side-title', text: 'Map layer' }),
    h('p', { class: 'layer-span', text: periodWords() }),
    h('p', { class: 'instrument-caption', text: 'Averaging period' }), rows);
}

function buildProfile() {
  S.profile.replaceChildren();
  const totals = S.L?.monthly ? monthTotals(S.L) : null;
  S.profile.hidden = !totals;
  if (S.profile.hidden) return;
  const annual = totals.reduce((sum,n) => sum + n, 0);
  const w = 240, chartH = 67, left = 37, step = (w - left - 8) / 11, max = Math.max(...totals,1);
  const x = (i) => left + i * step;
  const y = (v) => chartH - 6 - (chartH - 16) * v / max;
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${chartH + 15}`, class: 'profile-chart', role: 'img',
    'aria-label': `Worldwide ${dnWords()} detections by calendar month, summed over ${S.L.nYears} years. Exact totals are also on the month selector.` });
  const axisNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  for (const fraction of [0,.5,1]) {
    const value = max * fraction;
    svg.append(svgEl('line', { x1: left, x2: w, y1: y(value), y2: y(value), class: 'profile-rule' }));
    const tick = svgEl('text', { x: left - 5, y: y(value) + 3, 'text-anchor': 'end', class: 'profile-month' });
    tick.textContent = axisNumber.format(value);
    svg.append(tick);
  }
  const path = totals.map((n,i) => `${i ? 'L' : 'M'} ${x(i)} ${y(n)}`).join(' ');
  svg.append(svgEl('path', { d: path, class: 'profile-line' }));
  totals.forEach((n,i) => {
    const point = svgEl('circle', { cx: x(i), cy: y(n), r: 2.1, class: 'profile-point', 'data-profile-month': i + 1 });
    const title = svgEl('title'); title.textContent = `${MONTH_FULL[i]}: ${fmtN(n)} ${dnWords()} detections, summed over ${S.L.nYears} years`; point.append(title);
    const month = svgEl('text', { x: x(i), y: chartH + 10, 'text-anchor': 'middle', class: 'profile-month' });
    month.textContent = MONTH_LETTER[i]; svg.append(point, month);
  });
  const number = h('p', { class: 'profile-count' });
  const description = h('p', { class: 'instrument-caption' });
  S.updateProfile = () => {
    number.textContent = fmtN(S.cal ? totals[S.cal - 1] : annual);
    description.textContent = S.cal ? `Aqua ${dnWords()} detections in all ${MONTH_PLURAL[S.cal - 1]}: ${S.L.nYears}-year total, ${periodWords()}` : `Aqua ${dnWords()} detections worldwide: ${S.L.nYears}-year total, ${periodWords()} (not per year)`;
    for (const point of svg.querySelectorAll('[data-profile-month]')) point.classList.toggle('selected', Number(point.dataset.profileMonth) === S.cal);
  };
  S.profile.append(h('h2', { class: 'side-title', text: 'Detection profile' }), number, description, svg);
  S.updateProfile();
}

function project() {
  const d3 = window.d3;
  S.proj = d3.geoEqualEarth().fitWidth(BASE_W, { type: 'Sphere' });
  const [[, y0], [, y1]] = d3.geoPath(S.proj).bounds({ type: 'Sphere' });
  S.baseH = Math.ceil(y1 - y0);
  const path = d3.geoPath(S.proj);
  S.sphereD = path({ type: 'Sphere' });
  S.gratD = path(d3.geoGraticule10());
  S.landGeo = S.land ? window.topojson.feature(S.land, S.land.objects.land) : null;
  S.coastD = S.landGeo ? path(S.landGeo) : '';
  S.landP = S.coastD ? new Path2D(S.coastD) : null;
  S.sphereP = new Path2D(S.sphereD);
}

function buildQuads() {
  const { L } = S; const q = new Float32Array(L.n * 8); const r = L.res;
  for (let i = 0; i < L.n; i += 1) {
    const la = L.lat[i]; const lo = L.lon[i];
    [[lo, la], [lo + r, la], [lo + r, la + r], [lo, la + r]].forEach((p, k) => { const xy = S.proj(p); q[i * 8 + k * 2] = xy[0]; q[i * 8 + k * 2 + 1] = xy[1]; });
  }
  S.quads = q;
}

/** Build the other months' paths when the browser is idle, so the first scrub to a month is as fast as later ones. */
function warmCache() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 60));
  const todo = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const work = (dl) => { while (todo.length && dl.timeRemaining() > 4) { const m = todo.shift(); if (!S.cache.has(m)) pathsFor(m); } if (todo.length) idle(work); };
  idle(work);
}

/** Path2D per class (and per class for sparse cells) for one position; cached. */
function pathsFor(m) {
  if (S.cache.has(m)) return S.cache.get(m);
  const { cls, sp } = classify(S.L, m, S.th);
  const full = Array.from({ length: 6 }, () => new Path2D()); const light = Array.from({ length: 6 }, () => new Path2D());
  const dots = new Path2D(); const q = S.quads;
  for (let i = 0; i < S.L.n; i += 1) {
    const k = cls[i]; if (k < 0) continue;
    const p = sp[i] ? light[k] : full[k]; const o = i * 8;
    // no closePath(): fill() closes each subpath, and closePath on a Path2D is very slow in some engines (~1 s per month)
    p.moveTo(q[o], q[o + 1]); p.lineTo(q[o + 2], q[o + 3]); p.lineTo(q[o + 4], q[o + 5]); p.lineTo(q[o + 6], q[o + 7]);
    if (sp[i]) { const cx = (q[o] + q[o + 4]) / 2; const cy = (q[o + 1] + q[o + 5]) / 2; dots.moveTo(cx + 0.45, cy); dots.arc(cx, cy, 0.45, 0, Math.PI * 2); }
  }
  const out = { full, light, dots };
  S.cache.set(m, out);
  return out;
}

// ---------- views ----------

function sizeCanvas() {
  // layout size, not getBoundingClientRect: during the dock/undock FLIP the map carries a scale transform, and
  // measuring then would size the canvas to the inset (map stuck zoomed in, labels misplaced)
  S.W = Math.max(1, S.map.clientWidth); S.H = Math.max(1, S.map.clientHeight);
  S.dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of [S.canvas, S.ghost]) { c.width = Math.round(S.W * S.dpr); c.height = Math.round(S.H * S.dpr); }
  S.svg.setAttribute('viewBox', `0 0 ${S.W} ${S.H}`);
}
function worldView() {
  const pad = S.W < 550 ? 9 : 18;
  const k = Math.min((S.W - pad * 2) / BASE_W, (S.H - pad * 2) / S.baseH);
  return { k, x: (S.W - BASE_W * k) / 2, y: (S.H - S.baseH * k) / 2 };
}
function boxView(bbox, pad = 2.6) {
  const [w, s, e, n] = bbox; const pts = [];
  for (let t = 0; t <= 4; t += 1) { pts.push(S.proj([w + (e - w) * t / 4, s]), S.proj([w + (e - w) * t / 4, n]), S.proj([w, s + (n - s) * t / 4]), S.proj([e, s + (n - s) * t / 4])); }
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs); const bh = Math.max(...ys) - Math.min(...ys);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2; const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const k = Math.min(S.W / (bw * pad), S.H / (bh * pad));
  return { k, x: S.W / 2 - cx * k, y: S.H / 2 - cy * k };
}
/** A box padded to at least ~36° x 22° around the region, so the docked inset still reads as "you are here". */
function contextBox(bbox) {
  const [w, s, e, n] = bbox; const cx = (w + e) / 2; const cy = (s + n) / 2;
  const hw = Math.max((e - w) / 2 * 1.3, 18); const hh = Math.max((n - s) / 2 * 1.3, 11);
  return [cx - hw, Math.max(-85, cy - hh), cx + hw, Math.min(85, cy + hh)];
}
function targetView() { return S.mode === 'region' && S.region ? boxView(contextBox(S.region.bbox), 1.0) : worldView(); }

function tweenTo(to, ms) {
  return new Promise((resolve) => {
    if (S.tween) cancelAnimationFrame(S.tween);
    if (prefersReducedMotion() || ms <= 0) { S.view = to; draw(); resolve(); return; }
    const from = S.view; const t0 = performance.now();
    // interpolate the centre in base space and the scale in log space, so the zoom feels even
    const cOf = (v) => [(S.W / 2 - v.x) / v.k, (S.H / 2 - v.y) / v.k];
    const c0 = cOf(from); const c1 = cOf(to);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms); const e = 1 - (1 - t) ** 3;
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      const cx = c0[0] + (c1[0] - c0[0]) * e; const cy = c0[1] + (c1[1] - c0[1]) * e;
      S.view = { k, x: S.W / 2 - cx * k, y: S.H / 2 - cy * k }; draw();
      if (t < 1) S.tween = requestAnimationFrame(step); else { S.tween = null; S.view = to; draw(); resolve(); }
    };
    S.tween = requestAnimationFrame(step);
  });
}

// ---------- drawing ----------

function draw() {
  if (!S.proj || !S.view) return;
  const t0 = performance.now();
  const g = S.canvas.getContext('2d'); const { k, x, y } = S.view; const d = S.dpr;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S.canvas.width, S.canvas.height);
  g.setTransform(d * k, 0, 0, d * k, d * x, d * y);
  g.fillStyle = '#0B1114'; g.fill(S.sphereP);
  // land without a cell (ocean, or under the land minimum) stays blank: "no data", never the zero colour
  if (S.landP && !S.L) { g.fillStyle = '#414B4D'; g.fill(S.landP); }
  if (S.L) {
    const P = pathsFor(S.cal);
    for (let c = 0; c < 6; c += 1) { g.fillStyle = OCHRE[c]; g.fill(P.full[c]); }
    g.save(); g.clip(P.full[0]); g.strokeStyle = ZERO_EDGE; g.lineWidth = 1 / k; g.stroke(P.full[0]); g.restore();
    // sparse: a paler tint of the class colour plus a dot stipple, so it never reads as the flat zero grey
    g.fillStyle = '#C2C4BA';
    for (let c = 0; c < 6; c += 1) g.fill(P.light[c]);
    g.globalAlpha = 0.55;
    for (let c = 0; c < 6; c += 1) { g.fillStyle = OCHRE[c]; g.fill(P.light[c]); }
    g.globalAlpha = 1;
    const pat = stipple(g, d * k);
    if (pat) { g.fillStyle = pat; for (let c = 1; c < 6; c += 1) g.fill(P.light[c]); }
  }
  S.lastFrameMs = performance.now() - t0;
  S.gWorld.setAttribute('transform', `matrix(${k} 0 0 ${k} ${x} ${y})`);
  drawScreen();
}

/** A 4 x 4 device-pixel dot pattern, transformed so the dots stay the same size at any zoom. */
let stippleTile = null;
function stipple(g, scale) {
  if (!stippleTile) {
    stippleTile = document.createElement('canvas'); stippleTile.width = 4; stippleTile.height = 4;
    const t = stippleTile.getContext('2d'); t.fillStyle = 'rgba(26,25,23,0.7)'; t.fillRect(1, 1, 1.5, 1.5);
  }
  const p = g.createPattern(stippleTile, 'repeat');
  if (p && p.setTransform) p.setTransform(new DOMMatrix().scale(1 / scale));
  return p;
}

function paintStatic() {
  S.gWorld.replaceChildren(
    svgEl('path', { class: 'st-grat', d: S.gratD, 'vector-effect': 'non-scaling-stroke' }),
    svgEl('path', { class: 'st-coast', d: S.coastD, 'vector-effect': 'non-scaling-stroke' }),
    svgEl('path', { class: 'st-sphere', d: S.sphereD, 'vector-effect': 'non-scaling-stroke' }));
  S.veil.replaceChildren(S.L && S.L.belt.kind === 'fixture' ? fixtureVeil(true) : document.createComment(''));
  if (!S.L) S.veil.append(h('div', { class: 'empty-state st-empty' }, h('p', { text: S.err ? `Could not read the map layer (${S.err.detail || S.err.message}). Land outlines only; no values are drawn.` : 'The map layer is not published yet. Land outlines only; no values are drawn in its place.' })));
}

const toScreen = (p) => [p[0] * S.view.k + S.view.x, p[1] * S.view.k + S.view.y];
function boxRect(r) {
  const [w, s, e, n] = r.bbox; const pts = [[w, s], [e, s], [e, n], [w, n], [(w + e) / 2, n], [(w + e) / 2, s]].map((p) => toScreen(S.proj(p)));
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  let x0 = Math.min(...xs); let y0 = Math.min(...ys); let bw = Math.max(...xs) - x0; let bh = Math.max(...ys) - y0;
  if (bw < 9) { x0 -= (9 - bw) / 2; bw = 9; } if (bh < 9) { y0 -= (9 - bh) / 2; bh = 9; }
  return { x: x0, y: y0, w: bw, h: bh };
}

/** Screen-space layer: region boxes, leaders and label buttons; the focus point. Re-placed every frame (few objects). */
function drawScreen() {
  S.gScreen.replaceChildren();
  const regions = allRegions(S.manifest);
  const world = S.mode === 'world';
  S.boxes = [];
  const placed = [];
  // UI-07: every study box is an obstacle for every other box's label, so a label never covers another region
  const obstacles = world ? regions.map((r) => { const b = boxRect(r); return { id: r.id, x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h }; }) : [];
  for (const r of regions) {
    if (S.mode === 'region' && S.region && r.id !== S.region.id) continue;
    const b = boxRect(r); S.boxes.push({ r, b });
    const tested = regionChip(r).tested;
    const hot = S.hot === r.id;
    // M4.5 (M3): every study box drawn alike; only provisional ones dashed (as the Trust mini-map); no "validated" weight
    S.gScreen.append(svgEl('rect', { class: `st-box${tested ? '' : ' explore'}${r.status === 'provisional' ? ' prov' : ''}${hot ? ' hot' : ''}${S.mode === 'region' ? ' docked' : ''}`, x: b.x, y: b.y, width: b.w, height: b.h }));
    const lab = S.labelEls && S.labelEls.get(r.id);
    if (lab && world) {
      lab.hidden = false;
      // place the label at the first corner whose box overlaps no label placed so far (9 regions can crowd)
      lab.classList.remove('st-label-min');
      const lw = lab.offsetWidth || 120; const lh = lab.offsetHeight || 24;
      const pref = b.x + b.w + 150 < S.W ? 1 : -1; const prefA = b.y > 46;
      const cands = [[pref, prefA], [pref, !prefA], [-pref, prefA], [-pref, !prefA]];
      const rectOf = ([sd, ab]) => { const x = sd > 0 ? b.x + b.w + 14 : b.x - 14; const y = ab ? b.y - 14 : b.y + b.h + 14; return { x, y, r: { x0: sd > 0 ? x : x - lw, x1: sd > 0 ? x + lw : x, y0: ab ? y - lh : y, y1: ab ? y : y + lh } }; };
      const over = (a, q) => a.x0 < q.x1 + 4 && a.x1 + 4 > q.x0 && a.y0 < q.y1 + 4 && a.y1 + 4 > q.y0;
      const hit = (a) => placed.some((q) => over(a, q)) || obstacles.some((q) => q.id !== r.id && over(a, q)) || a.x0 < 0 || a.x1 > S.W || a.y0 < 0 || a.y1 > S.H;
      const fit = cands.find((c) => !hit(rectOf(c).r));
      const pick = fit || cands[0];
      // no free corner: keep a small marker (the name shows on hover and focus; the button keeps its accessible name)
      lab.classList.toggle('st-label-min', !fit);
      const side = pick[0]; const above = pick[1];
      if (!fit) { // the marker sits on the box's own corner, with no leader, so it never covers another label
        lab.style.left = `${b.x + b.w - 3}px`; lab.style.top = `${b.y - 3}px`; lab.dataset.side = 'r'; lab.dataset.v = 'b';
        continue;
      }
      const pr = rectOf(pick); placed.push(pr.r);
      const lx = pr.x; const ly = pr.y;
      S.gScreen.append(svgEl('path', { class: `st-leader${hot ? ' hot' : ''}`, d: `M${side > 0 ? b.x + b.w : b.x} ${above ? b.y : b.y + b.h} L${lx} ${ly}` }));
      lab.style.left = `${lx}px`; lab.style.top = `${ly}px`;
      lab.dataset.side = side > 0 ? 'r' : 'l'; lab.dataset.v = above ? 'a' : 'b';
    } else if (lab) lab.hidden = true;
  }
  if (S.point && world) {
    const [px, py] = toScreen(S.proj([S.point.lon, S.point.lat]));
    S.gScreen.append(svgEl('circle', { class: 'st-pt-halo', cx: px, cy: py, r: 9 }), svgEl('circle', { class: 'st-pt', cx: px, cy: py, r: 4 }));
  }
}

// ---------- labels, rail, strip, bands, legend ----------

// A crop of the same coastline and extent as the interactive map.
function regionThumbnail(region) {
  const frame = svgEl('svg', { class: 'region-thumb', viewBox: '0 0 58 44', 'aria-hidden': 'true' });
  if (!S.landGeo) return frame;
  const projection = window.d3.geoEquirectangular();
  const [west, south, east, north] = contextBox(region.bbox);
  const [cx, cy] = [(west + east) / 2, (south + north) / 2];
  const scale = Math.min(58 / (east - west), 44 / (north - south)) * 180 / Math.PI;
  projection.center([cx, cy]).scale(scale).translate([29, 22]).clipExtent([[0, 0], [58, 44]]);
  frame.append(svgEl('path', { d: window.d3.geoPath(projection)(S.landGeo), class: 'thumb-land' }));
  const [w, s, e, n] = region.bbox;
  const [x, y] = projection([w, n]);
  const [x2, y2] = projection([e, s]);
  frame.append(svgEl('rect', { x, y, width: Math.max(2, x2 - x), height: Math.max(2, y2 - y), class: 'thumb-box' }));
  return frame;
}

/** The sidebar’s quiet line (QA Q2): "NOAA-20 test · {window years}" or "S-NPP test · hidden years {years}" (from data). */
export function sidebarLine(r, x) {
  const w = r && r.m2 && r.m2.validated_window;
  if (x.test === 'm2') return `${testWord('m2')}${w ? ` · ${w.start.slice(0, 4)}–${w.end.slice(0, 4)}` : ''}`;
  return `${testWord('m1')}${(r.held_out_years || []).length ? ` · hidden years ${r.held_out_years.join(', ')}` : ''}`;
}

function buildLabels() {
  S.labels.replaceChildren(); S.labelEls = new Map();
  const regionCount = allRegions(S.manifest).length;
  S.directory.hidden = !regionCount;
  S.regionsCount.textContent = String(regionCount);
  // M4.5 (D4): ONE list, west -> east by box-centre longitude (from data); each entry = name + compact status + one quiet
  // line naming the tested satellite and its period. No satellite group headers.
  const byId = new Map(allRegions(S.manifest).map((r) => [r.id, r]));
  const chipItem = (x) => {
    const r = byId.get(x.id);
    const quiet = sidebarLine(r, x);
    const b = h('button', { type: 'button', class: `region-chip st-${x.status}`, 'data-region': r.id, 'aria-label': `${r.name}: ${statusChip(x.status)}, ${quiet}. Open the region.` },
      regionThumbnail(r),
      h('span', { class: 'region-chip-text' }, h('span', { class: 'nm', text: x.name }), h('span', { class: `st-chip st-${x.status}`, text: statusChip(x.status) }), h('span', { class: 'st' }, ...quiet.split(' · ').map((x) => h('span', { class: 'st-q', text: x })))),
      h('span', { class: 'region-arrow', 'aria-hidden': 'true', text: '↗' }));
    b.addEventListener('click', () => openRegion(r));
    return h('li', {}, b);
  };
  S.chips.replaceChildren(h('ul', { class: 'st-chips', 'aria-label': 'Study regions, west to east' }, ...westEast(S.manifest).map(chipItem)));
  for (const r of allRegions(S.manifest)) {
    const ch = regionChip(r);
    const b = h('button', { type: 'button', class: `st-label ${ch.cls || ''}`, 'data-region': r.id, 'aria-label': `${r.name}. Open the region.` },
      h('span', { class: 'nm', text: shortName(r.name) }), h('span', { class: 'st', id: `st-lab-${r.id}`, text: ch.word }));
    b.setAttribute('aria-describedby', `st-lab-${r.id}`);
    b.addEventListener('click', () => openRegion(r));
    b.addEventListener('mouseenter', () => { S.hot = r.id; drawScreen(); });
    b.addEventListener('mouseleave', () => { S.hot = null; drawScreen(); });
    b.addEventListener('focus', () => { S.hot = r.id; drawScreen(); });
    b.addEventListener('blur', () => { S.hot = null; drawScreen(); });
    S.labels.append(b); S.labelEls.set(r.id, b);
  }
}

function buildRail() {
  const item = (key, label, onclick, attrs = {}) => h('button', { type: 'button', class: 'st-rail-btn', 'data-key': key, onclick, ...attrs }, icon(ICON[key]), h('span', { text: label }));
  const regionsBtn = item('regions', 'Regions', (ev) => toggleMenu(undefined, ev.currentTarget), { 'aria-expanded': 'false', 'aria-haspopup': 'dialog' });
  // map actions only: the masthead already links to Trust and the glossary
  const labelsBtn = item('labels', 'Labels', () => {
    const visible = labelsBtn.getAttribute('aria-pressed') !== 'true';
    labelsBtn.setAttribute('aria-pressed', String(visible));
    S.el.classList.toggle('hide-labels', !visible); S.globe?.setLabels(visible);
  }, { 'aria-label': 'Show map labels', 'aria-pressed': 'true' });
  S.labelsBtn = labelsBtn;
  S.rail.replaceChildren(
    item('month', 'Month', () => { const b = S.strip.querySelector('[aria-checked="true"]'); if (b) b.focus(); }, { hidden: !S.L?.monthly }),
    regionsBtn, labelsBtn,
    item('place', 'Find a place', (ev) => { toggleMenu(true, ev.currentTarget); document.getElementById('st-lat')?.focus(); }, { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }));
  S.regionsBtn = regionsBtn;
}

function buildStrip() {
  S.strip.replaceChildren();
  if (!S.L || !S.L.monthly) { S.strip.hidden = true; return; }
  S.strip.hidden = false;
  const tot = monthTotals(S.L) || []; const max = Math.max(1, ...tot);
  const p = S.L.period;
  const lab = `Typical month, ${p.start.slice(0, 4)}–${p.end.slice(0, 4)} average (Aqua, ${S.L.daynight === 'D' ? 'daytime' : 'day and night'})`;
  const group = h('div', { class: 'st-months', role: 'radiogroup', 'aria-label': lab });
  const opts = [0, ...Array.from({ length: 12 }, (_, i) => i + 1)].map((m) => {
    const spark = h('span', { class: 'st-spark', 'aria-hidden': 'true' });
    if (m === 0) tot.forEach((t) => spark.append(h('i', { style: `height:${Math.max(6, (t / max) * 100).toFixed(1)}%` })));
    else if (tot.length) spark.append(h('i', { style: `height:${Math.max(6, (tot[m - 1] / max) * 100).toFixed(1)}%` }));
    const b = h('button', { type: 'button', role: 'radio', class: `st-mo${m === 0 ? ' all' : ''}`, 'data-m': String(m), 'aria-label': m === 0 ? 'All year' : tot.length ? `${MONTH_FULL[m - 1]}: ${fmtN(tot[m - 1])} ${dnWords()} detections worldwide over ${S.L.nYears} years` : MONTH_FULL[m - 1] },
      spark, h('span', { class: 'st-mo-l', text: m === 0 ? 'All year' : MONTH_ABBR[m - 1] }), m === 0 ? null : h('span', { class: 'st-mo-s', text: MONTH_LETTER[m - 1], 'aria-hidden': 'true' }));
    b.addEventListener('click', () => { stop(); setMonth(m, { push: true }); });
    return b;
  });
  group.append(...opts);
  group.addEventListener('keydown', (ev) => {
    const cur = S.cal; const j = { ArrowLeft: cur - 1, ArrowUp: cur - 1, ArrowRight: cur + 1, ArrowDown: cur + 1, Home: 0, End: 12 }[ev.key];
    if (j === undefined) return;
    ev.preventDefault(); stop();
    setMonth(Math.max(0, Math.min(12, j)), { push: true });
    S.strip.querySelector(`[data-m="${S.cal}"]`).focus();
  });
  const play = h('button', { type: 'button', class: 'st-play', 'aria-pressed': 'false', 'aria-label': 'Play the months' }, icon(ICON.play), h('span', { class: 'st-play-l', text: 'Play' }));
  play.addEventListener('click', () => (S.playing ? stop() : start()));
  S.playBtn = play;
  S.strip.append(h('p', { class: 'st-strip-l', id: 'st-strip-l', text: lab }), h('div', { class: 'st-strip-row' }, play, group));
  S.monthBtns = opts;
}

function start() {
  if (S.playing) return;
  S.playBtn.setAttribute('aria-pressed', 'true'); S.playBtn.setAttribute('aria-label', 'Pause');
  S.playBtn.replaceChildren(icon(ICON.pause), h('span', { class: 'st-play-l', text: 'Pause' }));
  const tick = () => setMonth(S.cal >= 12 ? 1 : S.cal + 1, { push: true, fade: true });
  tick();
  S.playing = setInterval(tick, 1100);
}
export function stop() {
  if (!S.playing) return;
  clearInterval(S.playing); S.playing = null;
  if (S.playBtn) { S.playBtn.setAttribute('aria-pressed', 'false'); S.playBtn.setAttribute('aria-label', 'Play the months'); S.playBtn.replaceChildren(icon(ICON.play), h('span', { class: 'st-play-l', text: 'Play' })); }
}

/** Change the calendar month (0 = all year). Recolours from the cached paths; a short cross-fade unless reduced motion. */
export function setMonth(m, { push = false, fade = false } = {}) {
  if (m === S.cal && S.monthPainted) return;
  const doFade = fade !== false && S.monthPainted && !prefersReducedMotion() && S.mode === 'world';
  if (doFade) { const g = S.ghost.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S.ghost.width, S.ghost.height); g.drawImage(S.canvas, 0, 0); }
  S.cal = m; S.monthPainted = true;
  if (usingGlobe()) S.globe.setMonth(m);
  S.updateProfile?.();
  const t0 = performance.now();
  draw();
  S.lastMonthMs = performance.now() - t0;
  if (doFade) S.ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
  else S.ghost.getContext('2d').clearRect(0, 0, S.ghost.width, S.ghost.height);
  if (S.monthBtns) S.monthBtns.forEach((b) => { const on = Number(b.dataset.m) === m; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
  paintCaption(); paintLegend(); paintBands();
  if (S.card && !S.cardBox.hidden) { paintCard(); placeCard(); }
  if (push && S.ctx) S.ctx.setParams({ cal: calParam(m) });
}

function periodWords() { const p = S.L && S.L.period; return p ? `${p.start.slice(0, 4)}–${p.end.slice(0, 4)}` : ''; }
function dnWords() { const d = S.L && S.L.daynight; return d === 'D' ? 'daytime' : d === 'N' ? 'night-time' : d === 'DN' ? 'day and night combined' : ''; }
function posWords(m) { return m === 0 ? 'All year' : `Typical ${MONTH_FULL[m - 1]}`; }

function paintCaption() {
  const cap = S.el.querySelector('.st-cap');
  if (!S.L) { cap.textContent = ''; return; }
  const timescale = S.cal === 0 ? 'per year' : `in a typical ${MONTH_FULL[S.cal - 1]}`;
  cap.replaceChildren(h('strong', { text: `${dnWords().replace(/^./, (c) => c.toUpperCase())} detections per 1,000 km² of land ${timescale}.` }),
    ` ${periodWords()} average from Aqua MODIS (the older satellite sensor), one satellite with no conversion.`);
  S.stampEl.replaceChildren(h('b', { class: 'st-stamp-m', text: S.cal === 0 ? 'All year' : MONTH_FULL[S.cal - 1] }), ` ${S.cal === 0 ? '' : 'typical · '}${periodWords()} average · not real-time`);
  paintMini();
}

/** M4.4 landing head: headline A, one sentence, one action (the Time Machine), all from data. */
function paintHead() {
  if (!S.manifest || S.manifest.partial) return;
  const c = landingCopy(S.manifest);
  S.head.querySelector('.st-title').textContent = c.head;
  S.head.querySelector('.st-deck').textContent = c.line;
  const hasM2 = (S.manifest.m2_regions || []).some((r) => r.status === 'validated');
  S.cta.hidden = !hasM2; S.cta.textContent = c.cta;
  if (S.ctx && S.ctx.urlFor) S.cta.setAttribute('href', S.ctx.urlFor({ view: 'trust', machine: '1' }));
}

/** UI-04: a compact legend inside the map frame, so the scale and its unit are in the first view. */
function paintMini() {
  if (!S.L || !S.th) { S.miniLegend.replaceChildren(); return; }
  const t = S.cal === 0 || !S.L.monthly ? S.th.all : S.th.month;
  S.miniLegend.replaceChildren(
    h('span', { class: 'st-mini-u', text: `Detections per 1,000 km² of land, ${S.cal === 0 ? 'per year' : `in a typical ${MONTH_FULL[S.cal - 1]}`}` }),
    h('span', { class: 'st-mini-r' }, h('span', { class: 'st-mini-l', text: t ? `≤${fmtV(t[0])}` : '0' }), ...OCHRE.map((c) => h('i', { style: `background:${c}` })), h('span', { class: 'st-mini-l', text: t ? `>${fmtV(t[t.length - 1])}` : '>0' })),
    h('span', { class: 'st-mini-k' }, h('i', { class: 'sw-zero' }), 'none reported', h('i', { class: 'sw-blank' }), 'no data'));
}


function paintLegend() {
  S.legend.replaceChildren();
  if (!S.L) return;
  const t = S.cal === 0 || !S.L.monthly ? S.th.all : S.th.month;
  const labs = t ? ['0', `≤${fmtV(t[0])}`, ...t.slice(1).map((x) => `≤${fmtV(x)}`), `>${fmtV(t[t.length - 1])}`] : ['0', '>0'];
  const unit = S.L.monthly
    ? `Shading = ${dnWords()} hotspot detections Aqua recorded per 1,000 km² of land ${S.cal === 0 ? 'per year' : `in a typical ${MONTH_FULL[S.cal - 1]}`} (${periodWords()} average).`
    : `Shading = hotspot detections Aqua recorded per 1,000 km² of land per year (${periodWords()} average, ${dnWords()}).`;
  S.legend.append(
    h('div', { class: 'legend-block' }, h('span', { class: 'legend-title', text: unit }),
      h('div', { class: 'legend-scale' }, h('span', { class: 'ls-end', text: 'fewer' }),
        h('div', { class: 'legend-ramp' }, ...labs.map((l, i) => h('div', { class: 'step' }, h('span', { class: 'sw', style: `background:${OCHRE[i]}` }), h('span', { class: 'lab', text: l })))),
        h('span', { class: 'ls-end', text: 'more' }))),
    h('div', { class: 'legend-items' },
      h('span', {}, h('span', { class: 'sw sw-zero' }), 'flat grey = no detections reported (not proof that nothing burned)'),
      S.L.monthly ? h('span', {}, h('span', { class: 'sw sw-sparse' }), `dotted = sparse: based on fewer than ${(S.L.sparseRule && S.L.sparseRule.min_total) || 10} detections, or seen in ${(S.L.sparseRule && S.L.sparseRule.max_years_seen) || 2} or fewer of ${S.L.nYears} years (few detections or few years, not low activity)`) : null,
      h('span', {}, h('span', { class: 'sw sw-blank' }), `blank = no data: ocean, or a cell with under ${fmtN((S.L.belt.grid || {}).min_land_km2 || 500)} km² of land (not a zero)`),
      h('span', {}, h('span', { class: 'sw sw-box' }), 'study region · its test and status are in the list'),
      allRegions(S.manifest).some((r) => r.status === 'provisional') ? h('span', {}, h('span', { class: 'sw sw-box sw-prov' }), 'dashed = satellite comparison provisional') : null),
    h('p', { class: 'legend-note', text: `${DETECTION_NOTE} Native counts from one satellite: nothing on this map is converted between satellites.` }));
}
const fmtV = (x) => (x >= 10 ? fmtN(x) : String(Number(x.toPrecision(2))));

/** The heatmap's 5 share classes use the globe's five NON-zero density colours OCHRE[1..5] (dark muted amber -> gold).
 *  OCHRE[0] is the map's "none reported" grey, so it is never used for a positive share; zero shares stay hollow and
 *  empty bands hatched. Same palette as the map, NOT the same numerical scale (shares within a band, not density). */
export const BAND_RAMP = OCHRE.slice(1);
/** A tiny key for the latitude heatmap: what the colour means here (a share), with three of its steps. */
function bandKey() {
  const sw = (fill, label) => h('span', { class: 'bk-step' }, h('i', { style: fill ? `background:${fill}` : '', class: fill ? '' : 'bk-zero' }), label);
  return h('p', { class: 'st-bands-key', 'aria-label': 'Key: share of the band’s detections in a month: hollow 0, up to 4%, 8 to 12%, over 18%' },
    h('span', { class: 'bk-t', text: 'share of the band’s detections' }), sw(null, '0'), sw(BAND_RAMP[0], '≤4%'), sw(BAND_RAMP[2], '8–12%'), sw(BAND_RAMP[4], '>18%'));
}

function paintBands() {
  const tableOpen = S.bands.querySelector('details')?.open;
  S.bands.replaceChildren();
  S.bands.hidden = !S.L || S.mode !== 'world';
  if (S.bands.hidden) return;
  const rows = bandRows(S.L);
  if (!rows.length) {
    S.bands.append(h('h2', { class: 'side-title', id: 'st-bands-h', text: 'Seasons by latitude' }),
      h('p', { class: 'band-subtitle', text: 'Latitude-band values are unavailable for this layer.' }));
    return;
  }
  const w = 320;
  const top = 21, left = 32, cw = (w - left - 2) / 12;
  const latMin = Math.min(...rows.map((r) => r.lat_min));
  const latMax = Math.max(...rows.map((r) => r.lat_max));
  const Hh = 150;
  const y = (lat) => top + (latMax - lat) / (latMax - latMin) * (Hh - top - 2);
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${Hh}`, role: 'img', 'aria-label': `Latitude bands: share of each band’s ${dnWords()} detections in each month.` });
  MONTH_LETTER.forEach((m, i) => { const t = svgEl('text', { class: `belt-cell-label${S.cal === i + 1 ? ' on' : ''}`, x: left + i * cw + cw / 2, y: top - 6, 'text-anchor': 'middle' }); t.textContent = m; svg.append(t); });
  for (const r of rows) {
    const y0 = y(r.lat_max); const rh = Math.max(1, y(r.lat_min) - y0 - 0.6);
    if (!r.monthly_share) { svg.append(svgEl('rect', { x: left, y: y0, width: cw * 12 - 1, height: rh, fill: 'url(#pat-hatch)', opacity: 0.5 })); continue; }
    r.monthly_share.forEach((s, i) => {
      const k = s <= 0 ? 0 : s <= 0.04 ? 1 : s <= 0.08 ? 2 : s <= 0.12 ? 3 : s <= 0.18 ? 4 : 5;
      // home fix: the globe's own colour family (OCHRE, the map's density ramp) for the share classes 1..5, so low = dark
      // grey-brown, rising through muted amber to bright gold; a zero share stays a hollow cell, an empty band stays hatched.
      // The classes and the share-within-band normalisation are unchanged; the key says "share", never density.
      const rect = svgEl('rect', k === 0 ? { x: left + i * cw + 0.5, y: y0 + 0.5, width: cw - 2, height: Math.max(0.5, rh - 1), fill: 'none', stroke: VIZ.dim, 'stroke-width': 0.8, 'data-month': i + 1 }
        : { x: left + i * cw, y: y0, width: cw - 1, height: rh, fill: BAND_RAMP[k - 1], 'data-month': i + 1 });
      const tt = svgEl('title'); tt.textContent = `${r.lat_min}° to ${r.lat_max}°, ${MONTH_ABBR[i]}: ${(s * 100).toFixed(1)}% of the band’s ${fmtN(r.n_total)} detections`; rect.append(tt);
      svg.append(rect);
    });
  }
  if (S.cal > 0) svg.append(svgEl('rect', { class: 'band-on', x: left + (S.cal - 1) * cw - 1, y: top - 2, width: cw + 1, height: Hh - top }));
  for (const l of [-60, -30, 0, 30, 60]) { const t = svgEl('text', { class: 'belt-cell-label', x: left - 4, y: y(l) + 3, 'text-anchor': 'end' }); t.textContent = `${Math.abs(l)}°${l > 0 ? 'N' : l < 0 ? 'S' : ''}`; svg.append(t); }
  const table = h('table', { class: 'data-table' }, h('caption', { text: `Share of each band’s ${dnWords()} detections by month (%)` }),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Band' }), ...MONTH_ABBR.map((m) => h('th', { scope: 'col', text: m })), h('th', { scope: 'col', text: 'Detections' }))),
    h('tbody', {}, ...rows.slice().reverse().map((r) => h('tr', {}, h('th', { scope: 'row', text: `${r.lat_min}° to ${r.lat_max}°` }),
      ...(r.monthly_share ? r.monthly_share.map((s) => h('td', { class: 'num', text: (s * 100).toFixed(1) })) : MONTH_ABBR.map(() => h('td', { text: 'none reported' }))),
      h('td', { class: 'num', text: fmtN(r.n_total) })))));
  if (S.L.monthly) svg.addEventListener('click', (ev) => {
    const month = Number(ev.target.dataset.month);
    if (month) { stop(); setMonth(month, { push: true }); }
  });
  S.bands.append(h('h2', { class: 'side-title', id: 'st-bands-h', text: 'Seasons by latitude' }),
    h('p', { class: 'band-subtitle' }, 'When each latitude band ', `has the most ${dnWords()} detections`, '.'),
    bandKey(), svg, // the key sits above its graph (user request)
    h('p', { class: 'caption st-bands-cap', text: 'Each row is a latitude band. Warmer, brighter cells show a larger share of that band’s detections (shares within a row, not amounts, so not the map’s density scale). The fire belt shifts north and south with the seasons.' }),
    h('details', { class: 'caption', open: tableOpen }, h('summary', { text: 'As a table' }), h('div', { class: 'table-wrap' }, table)));
}

// ---------- interaction: hit testing, focus point, custom-area card, regions menu ----------

function lonLatAt(clientX, clientY) {
  const r = S.map.getBoundingClientRect();
  const bx = (clientX - r.left - S.view.x) / S.view.k; const by = (clientY - r.top - S.view.y) / S.view.k;
  const ll = S.proj.invert([bx, by]);
  if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
  const back = S.proj(ll); if (Math.hypot(back[0] - bx, back[1] - by) > 0.5) return null; // outside the sphere
  return { lon: ll[0], lat: ll[1] };
}
function boxAt(clientX, clientY) {
  const r = S.map.getBoundingClientRect(); const x = clientX - r.left; const y = clientY - r.top;
  const tol = S.W < 640 ? 10 : 3; // a finger needs a larger target than a pointer
  return (S.boxes || []).find(({ b }) => x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol);
}

function bindMap() {
  S.map.addEventListener('click', (ev) => {
    if (usingGlobe() || ev.target.closest('.st-label, .st-card, .st-menu')) return;
    if (S.mode === 'region') { if (S.ctx) S.ctx.backToAtlas(); return; }
    if (S.mode !== 'world') return;
    const hit = boxAt(ev.clientX, ev.clientY);
    if (hit) { openRegion(hit.r); return; }
    const ll = lonLatAt(ev.clientX, ev.clientY);
    if (ll) openCard(ll, { opener: S.map });
  });
  S.map.addEventListener('pointermove', (ev) => {
    if (S.mode !== 'world' || usingGlobe()) return;
    const ll = lonLatAt(ev.clientX, ev.clientY);
    S.coordinateEl.textContent = ll ? `${fmtLat(ll.lat)}   ${fmtLon(ll.lon)}` : 'Inspect a place';
    const hit = boxAt(ev.clientX, ev.clientY); const id = hit ? hit.r.id : null;
    S.map.style.cursor = hit ? 'pointer' : 'crosshair';
    if (id !== S.hot) { S.hot = id; drawScreen(); }
  });
  S.map.addEventListener('pointerleave', () => { if (!usingGlobe()) S.coordinateEl.textContent = 'Inspect a place'; });
  S.map.addEventListener('keydown', (ev) => {
    if (usingGlobe()) return;
    if (ev.target === S.map && S.mode === 'region' && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); if (S.ctx) S.ctx.backToAtlas(); return; }
    if (ev.target !== S.map || S.mode !== 'world') return;
    const step = ev.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [0, -step], ArrowRight: [0, step], ArrowUp: [step, 0], ArrowDown: [-step, 0] }[ev.key];
    if (d) {
      ev.preventDefault();
      const p = S.point || S.focus;
      S.point = { lat: Math.max(-89.5, Math.min(89.5, p.lat + d[0])), lon: ((p.lon + d[1] + 540) % 360) - 180 };
      S.focus = S.point; drawScreen();
      S.live.textContent = `${fmtLat(S.point.lat)} ${fmtLon(S.point.lon)}. Enter shows its season.`;
    } else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); const p = S.point || S.focus; S.point = p; openCard(p, { opener: S.map }); }
  });
  S.map.addEventListener('focus', () => { if (S.mode === 'world' && !usingGlobe() && !S.point) { S.point = S.focus; drawScreen(); } });
  S.map.addEventListener('blur', () => { if (!usingGlobe() && S.cardBox.hidden && S.point) { S.point = null; drawScreen(); } });
  S.cardBox.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeCard(); } });
  S.menu.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); toggleMenu(false); } });
}
const fmtLat = (v) => `${Math.abs(v).toFixed(v % 1 ? 1 : 0)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(v % 1 ? 1 : 0)}°${v >= 0 ? 'E' : 'W'}`;

function openCard(ll, { opener } = {}) {
  toggleMenuClosed();
  S.card = { ll, size: (S.card && S.card.size) || 1, opener: opener || document.activeElement };
  S.point = { lat: ll.lat, lon: ll.lon }; drawScreen();
  S.cardBox.hidden = false;
  paintCard();
  placeCard();
  const hd = S.cardBox.querySelector('h2'); hd.focus({ preventScroll: true });
}
function closeCard() {
  if (S.cardBox.hidden) return;
  S.cardBox.hidden = true; S.point = null; drawScreen();
  const o = S.card && S.card.opener; S.card = null;
  if (o && o.isConnected) o.focus({ preventScroll: true });
}
function placeCard() {
  if (window.matchMedia('(max-width: 640px)').matches) { S.cardBox.style.left = ''; S.cardBox.style.top = ''; return; }
  // dock in a bottom corner of the map, on the side away from the clicked point
  const px = usingGlobe() ? S.W / 2 : toScreen(S.proj([S.card.ll.lon, S.card.ll.lat]))[0];
  const w = S.cardBox.offsetWidth; const hh = S.cardBox.offsetHeight;
  const left = px > S.W / 2 ? 8 : S.W - w - 8;
  S.cardBox.style.left = `${left}px`; S.cardBox.style.top = `${Math.max(8, S.H - hh - 8)}px`;
}

function paintCard() {
  const { ll, size } = S.card;
  const a = S.L && S.L.monthly ? areaSeason(S.L, ll.lat, ll.lon, size) : null;
  const c = cellOf(ll.lat, ll.lon, S.L ? S.L.res : 1);
  const where = size === 1 ? `1° cell ${fmtLat(c.lat)}–${fmtLat(c.lat + 1)}, ${fmtLon(c.lon)}–${fmtLon(c.lon + 1)}` : `${size}×${size} cells around ${fmtLat(c.lat + 0.5)}, ${fmtLon(c.lon + 0.5)}`;
  const close = h('button', { type: 'button', class: 'md-close', 'aria-label': 'Close' }, '×');
  close.addEventListener('click', closeCard);
  const sizes = h('div', { class: 'st-sizes', role: 'group', 'aria-label': 'Area size' }, ...[1, 3, 5].map((n) => {
    const b = h('button', { type: 'button', class: 'st-size', 'aria-pressed': n === size ? 'true' : 'false', text: n === 1 ? '1°' : `${n}×${n}` });
    b.addEventListener('click', () => { S.card.size = n; paintCard(); placeCard(); S.cardBox.querySelector(`.st-size[aria-pressed="true"]`).focus(); });
    return b;
  }));
  const kids = [close, h('h2', { id: 'st-card-h', tabindex: '-1', text: 'Typical season here' }), h('p', { class: 'st-card-where', text: where }), sizes];
  if (!S.L || !S.L.monthly) kids.push(h('p', { class: 'caption', text: 'The calendar-month layer is not available, so no season can be shown for a custom area.' }));
  else if (!a.nCells) kids.push(h('p', { text: 'Ocean, or too little land in this cell: there is no value here. That is not a zero.' }));
  else {
    const max = Math.max(...a.months.map((x) => x.density));
    const bars = h('div', { class: 'cs-bars', role: 'list', 'aria-label': 'Daytime detections per 1,000 km² of land in each typical month' }, ...a.months.map((x) => {
      const word = x.zero ? 'no detections reported' : `${fmtV(x.density)} per 1,000 km²`;
      const seen = x.seen == null ? '' : x.seenExact ? `; seen in ${x.seen} of ${S.L.nYears} years` : `; seen in at least ${x.seen} of ${S.L.nYears} years`;
      return h('div', { role: 'listitem', class: `cs-col${S.cal === x.m ? ' on' : ''}`, 'aria-label': `${MONTH_FULL[x.m - 1]}: ${word}${x.sparse ? ' (sparse)' : ''}${seen}` },
        h('span', { class: `cs-bar${x.zero ? ' zero' : x.sparse ? ' sparse' : ''}`, style: `height:${x.zero ? 0 : Math.max(3, (x.density / (max || 1)) * 100).toFixed(1)}%` }),
        h('span', { class: 'cs-m', 'aria-hidden': 'true', text: MONTH_LETTER[x.m - 1] }),
        h('span', { class: 'cs-seen', 'aria-hidden': 'true', text: x.seen == null ? '' : String(x.seen) }));
    }));
    const pk = max > 0 ? peakMonths(a.months.map((x) => ({ month: x.m, p50: x.density }))) : null;
    const allSparse = a.months.filter((x) => !x.zero).every((x) => x.sparse);
    const lead = a.allYear.zero ? `No detections reported here in ${periodWords()} (Aqua, ${dnWords()}). That is not proof that nothing burned.`
      : allSparse ? `Very few detections here: ${fmtN(a.allYear.count)} in ${S.L.nYears} years, too few to describe a usual season.`
      : (() => {
        const peak = a.months.reduce((b, x) => (x.density > b.density ? x : b));
        if (peak.sparse) return 'Too few detections to name a peak month here.';
        return pk && pk.main.length ? `Most detections here come in ${pk.main.map(runLabel).join(' and ')}.` : 'Detections here are spread across the year.';
      })();
    const nSparse = a.months.filter((x) => x.sparse).length;
    const sel = S.cal > 0 ? a.months[S.cal - 1] : null;
    kids.push(h('p', { class: 'cs-lead', text: lead }), bars,
      h('p', { class: 'cs-key caption' }, h('span', { class: 'sw sw-sparse' }), ' dotted = sparse', h('span', { class: 'cs-key-n', text: ` · digits = years (of ${S.L.nYears}) with any detection${size > 1 ? ', at least' : ''}` })),
      sel ? h('p', { class: 'cs-sel', text: `${MONTH_FULL[S.cal - 1]}: ${sel.zero ? 'no detections reported' : `${fmtV(sel.density)} per 1,000 km² of land`}${sel.seen != null && !sel.zero ? `, seen in ${sel.seenExact ? '' : 'at least '}${sel.seen} of ${S.L.nYears} ${MONTH_PLURAL[S.cal - 1]}` : ''}${sel.sparse ? '. Sparse: one big year can dominate a 9-year average' : ''}.` }) : null,
      nSparse ? h('p', { class: 'caption', text: `${nSparse} of 12 months ${nSparse === 1 ? 'is' : 'are'} sparse here: few detections or few years, so one big year can dominate.` }) : null,
      size > 1 ? h('p', { class: 'caption', text: 'For a box, years seen is a lower bound; one big year can still dominate.' }) : null,
      size > 1 && a.nCells < a.nPossible ? h('p', { class: 'caption', text: `${a.nCells} of ${a.nPossible} cells have enough land to count; the rest are ocean or coast.` }) : null);
  }
  kids.push(h('p', { class: 'cs-label', text: `Aqua MODIS ${dnWords()}, ${periodWords()} average. Typical season only; year-by-year history and satellite comparison exist for the ${allRegions(S.manifest).length} study regions.` }));
  const near = nearestRegion(allRegions(S.manifest), ll.lat, ll.lon);
  if (near) {
    // GD-10: inside a box the card keeps the region's conversion status, and says it covers the box, not this cell
    const link = h('a', { href: `?view=region&region=${encodeURIComponent(near.region.id)}`, class: 'cs-near', text: `${near.inside ? 'Inside' : 'Nearest study region'}: ${shortName(near.region.name)}${near.inside ? ` (${boxStatusWord(near.region)})` : ''} →` });
    link.addEventListener('click', (ev) => { if (ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); closeCard(); openRegion(near.region); });
    kids.push(link);
    if (near.inside) kids.push(h('p', { class: 'caption cs-scope', text: 'That status is for the whole box’s monthly total, not this cell.' }));
  }
  // no conversion has been validated for an arbitrary place: Trust explains that and points to the evidence
  // (A2) built with the router's urlFor so data / validation params survive; the click stays in the app (pushState)
  if (!(near && near.inside)) {
    const at = `${ll.lat.toFixed(1)},${ll.lon.toFixed(1)}`;
    const params = { view: 'trust', region: 'custom', at };
    const why = h('a', { href: S.ctx && S.ctx.urlFor ? S.ctx.urlFor(params) : `?view=trust&region=custom&at=${at}`, class: 'cs-near', text: 'Satellite comparison here: not validated. Why? →' });
    why.addEventListener('click', (ev) => { if (ev.metaKey || ev.ctrlKey || !S.ctx) return; ev.preventDefault(); closeCard(); S.ctx.navigate(params); });
    kids.push(why);
  }
  S.cardBox.replaceChildren(...kids.filter((k) => k != null && k !== false));
}

function toggleMenu(force, opener) {
  const open = force != null ? force : S.menu.hidden;
  if (opener) S.menuOpener = opener;
  for (const control of S.rail.querySelectorAll('[aria-haspopup="dialog"]')) control.setAttribute('aria-expanded', String(open));
  S.menu.hidden = !open;
  if (!open) { (S.menuOpener || S.regionsBtn).focus(); return; }
  if (!S.cardBox.hidden) closeCard();
  const lat = h('input', { type: 'number', id: 'st-lat', min: '-90', max: '90', step: 'any', inputmode: 'decimal', required: true, placeholder: '-13.5' });
  const lon = h('input', { type: 'number', id: 'st-lon', min: '-180', max: '180', step: 'any', inputmode: 'decimal', required: true, placeholder: '132.5' });
  const err = h('p', { class: 'st-err', 'aria-live': 'polite' });
  const form = h('form', { class: 'st-form', novalidate: true },
    h('p', { class: 'st-menu-h', text: 'Or any place' }),
    h('div', { class: 'st-form-row' }, h('label', { for: 'st-lat', text: 'Latitude' }), lat, h('label', { for: 'st-lon', text: 'Longitude' }), lon),
    h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Show its typical season' }), err);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const la = Number(lat.value); const lo = Number(lon.value);
    if (lat.value === '' || lon.value === '' || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) { err.textContent = 'Enter a latitude from -90 to 90 and a longitude from -180 to 180 (south and west are negative).'; return; }
    toggleMenu(false); S.focus = { lat: la, lon: lo }; if (usingGlobe()) S.globe.focusPlace(S.focus); openCard({ lat: la, lon: lo }, { opener: S.menuOpener || S.regionsBtn });
  });
  const close = h('button', { type: 'button', class: 'md-close', 'aria-label': 'Close' }, '×');
  close.addEventListener('click', () => toggleMenu(false));
  S.menu.replaceChildren(close, h('p', { class: 'st-menu-h', text: 'Study regions' }),
    h('ul', { class: 'st-menu-list' }, ...allRegions(S.manifest).map((r) => {
      const a = h('a', { href: `?view=region&region=${encodeURIComponent(r.id)}` }, h('b', { text: shortName(r.name) }), h('span', { text: regionChip(r).word }));
      a.addEventListener('click', (ev) => { if (ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); toggleMenu(false); openRegion(r); });
      return h('li', {}, a);
    })), form);
  if (force !== true || !S.menu.contains(document.activeElement)) (S.menu.querySelector('a') || lat).focus();
}

// ---------- routes ----------

/** Zoom to a region (world mode), then navigate. Reduced motion: navigate at once. */
export async function openRegion(r) {
  stop(); closeCard(); toggleMenuClosed();
  if (S.ctx && S.ctx.session) S.ctx.session.lastRegion = r.id;
  if (S.mode === 'world' && !usingGlobe() && S.view && !prefersReducedMotion()) { S.region = r; await tweenTo(boxView(contextBox(r.bbox), 1.0), 600); }
  S.ctx.openRegion(r.id, { cal: S.cal });
}
function toggleMenuClosed() {
  if (!S.menu || S.menu.hidden) return;
  S.menu.hidden = true;
  for (const control of S.rail.querySelectorAll('[aria-haspopup="dialog"]')) control.setAttribute('aria-expanded', 'false');
}

/** Before a view is replaced: move the stage out of <main> (it may be docked there), keeping the same node. */
export function parkStage() {
  if (!S.el) return;
  S.prevRect = S.mode !== 'hidden' ? S.map.getBoundingClientRect() : null;
  S.prevMode = S.mode;
  if (S.el.parentElement !== S.home) S.home.append(S.el);
}

/**
 * Show the stage for a view. mode 'world' (atlas): full map, strip, bands, legend; cal from the URL.
 * mode 'region': docked into `slot` as an inset showing the region box; clicking it returns to the map.
 * mode 'hidden': parked and hidden. Transitions use FLIP from the previous map rectangle; reduced motion cuts.
 */
export async function showStage(mode, { ctx, region = null, slot = null, cal = 0 } = {}) {
  S.ctx = ctx || S.ctx;
  if (mode === 'world') paintHead(); // F7: the action's href is built once ctx (urlFor, data params) is known
  const was = S.prevMode || 'hidden'; const prevRect = S.prevRect; S.prevRect = null; S.prevMode = null;
  if (mode !== 'world') stop();
  closeCard(); toggleMenuClosed();
  S.mode = mode;
  S.el.className = `stage mode-${mode}`;
  S.el.classList.toggle('hide-labels', S.labelsBtn?.getAttribute('aria-pressed') === 'false');
  S.el.hidden = mode === 'hidden';
  S.head.hidden = mode !== 'world';
  if (mode === 'hidden') { S.globe?.setActive(false); return; }
  if (mode === 'region' && slot) slot.append(S.el); else if (S.el.parentElement !== S.home) S.home.append(S.el);
  S.region = mode === 'region' ? region : S.region;
  S.map.setAttribute('tabindex', mode === 'world' ? '0' : '-1');
  S.map.setAttribute('aria-label', mode === 'region' && region ? `Map inset: where ${region.name} is. Activate to return to the world map.` : S.map.getAttribute('aria-label'));
  if (mode === 'region') { S.map.setAttribute('role', 'link'); S.map.setAttribute('tabindex', '0'); }
  else { S.map.setAttribute('role', 'group'); S.map.setAttribute('aria-label', 'World map of typical hot-spot detections. Arrow keys move a point (Shift for 5 degrees); Enter shows that place’s typical season. Region labels open each study region.'); }
  await S.ready;
  if (!S.labelEls) buildLabels();
  updateProjection();
  sizeCanvas();
  S.cal = S.L?.monthly ? (mode === 'world' ? cal : S.cal) : 0;
  const target = targetView();
  const motion = !prefersReducedMotion();
  const fromRegion = was === 'region' && mode === 'world' && S.region;
  // start from where the eye was: a zoomed-in box when coming back from a region
  S.view = fromRegion ? boxView(contextBox(S.region.bbox), 1.0) : target;
  S.monthPainted = false; setMonth(S.cal, { fade: false });
  flip(prevRect, motion && was !== 'hidden' && !usingGlobe());
  if (fromRegion && !usingGlobe()) await tweenTo(target, motion ? 600 : 0);
  else draw();
  paintBands();
  // back from a region: focus returns to that region's control on the map (label, or the phone list)
  if (fromRegion && S.region) {
    const lab = usingGlobe() || window.matchMedia('(max-width: 760px)').matches || S.el.classList.contains('hide-labels') ? S.chips.querySelector(`[data-region="${CSS.escape(S.region.id)}"]`) : S.labelEls.get(S.region.id);
    if (lab) lab.focus({ preventScroll: true });
  }
}

/** Animate the map rectangle from where it was to where it is now (dock / undock). */
function flip(prev, animate) {
  if (!prev || !animate) return;
  const now = S.map.getBoundingClientRect();
  if (!now.width || !prev.width) return;
  const dx = prev.left - now.left; const dy = prev.top - now.top; const sx = prev.width / now.width; const sy = prev.height / now.height;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return;
  S.map.animate([{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: 450, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
}

/** For tests and the perf readout. */
export const stageDebug = () => ({ mode: S.mode, cal: S.cal, lastFrameMs: S.lastFrameMs, lastMonthMs: S.lastMonthMs, canvas: S.canvas, monthly: !!(S.L && S.L.monthly), cached: [...S.cache.keys()] });
export const stageMonth = () => S.cal;

/** The active map layer's unit label, for pages that must say how the map differs from their own numbers. */
export function mapUnitLabel() {
  if (!S.L) return null;
  const u = (S.L.monthly ? S.L.bm.unit : S.L.belt.unit) || {};
  return u.label || null;
}
