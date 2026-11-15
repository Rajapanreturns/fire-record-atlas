// M4.5 step 6: the Trust page's region mini-map (D5). A small equirectangular instrument, cropped to the study latitudes,
// that draws the nine TRUE manifest boxes as thin outlines on faint land (no fills between boxes, no countries) and selects
// by the NEAREST box centre (capped, so open ocean selects nothing): every region gets a large target although every box is
// under 44 px (docs/m45/GEO.md). Pointer, touch and its own keyboard path (Left/Right in west -> east order, Enter opens);
// the paired <select> beside it is the accessible fallback. No new library: d3 + land-110m already vendored.
import { h } from './ui.js';
import { loadLand } from './data.js';
import { westEast, statusChip, testWord } from './trustctx.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

export const MINI = { lonW: -180, lonE: 180, latN: 75, latS: -60, width: 320, capDeg: 25 };

/** Pure layout: the viewBox and each region's projected box and centre (equirectangular, plate carrée). */
export function miniLayout(manifest, width = MINI.width) {
  const k = width / (MINI.lonE - MINI.lonW);
  const height = Math.round((MINI.latN - MINI.latS) * k);
  const X = (lon) => (lon - MINI.lonW) * k; const Y = (lat) => (MINI.latN - lat) * k;
  const regions = westEast(manifest).map((r) => {
    const [w, s, e, n] = r.bbox;
    return { ...r, x: X(w), y: Y(n), w: (e - w) * k, h: (n - s) * k, px: X(r.cx), py: Y(r.cy) };
  });
  return { k, width, height, X, Y, regions, lonOf: (x) => MINI.lonW + x / k, latOf: (y) => MINI.latN - y / k };
}

/** Nearest box centre (in degrees) to a point in viewBox coordinates, or null beyond the cap (open ocean selects nothing). */
export function nearestAt(layout, x, y, capDeg = MINI.capDeg) {
  const lon = layout.lonOf(x); const lat = layout.latOf(y);
  let best = null; let bd = Infinity;
  for (const r of layout.regions) { const d = Math.hypot(r.cx - lon, r.cy - lat); if (d < bd) { bd = d; best = r; } }
  return best && bd <= capDeg ? best : null;
}

export async function miniMap(ctx, manifest, current) {
  const d3 = window.d3; const topojson = window.topojson;
  if (!d3 || !topojson) return null;
  const L = miniLayout(manifest);
  if (!L.regions.length) return null;
  const land = await loadLand().catch(() => null);
  const svg = svgEl('svg', { class: 'mini-svg', viewBox: `0 0 ${L.width} ${L.height}`, 'aria-hidden': 'true', focusable: 'false' });
  const defs = svgEl('defs'); const pat = svgEl('pattern', { id: 'mini-sel', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(svgEl('rect', { width: 2, height: 4, class: 'mini-sel-hatch' })); defs.append(pat); svg.append(defs);
  if (land) {
    const proj = d3.geoEquirectangular().scale((L.k * 180) / Math.PI).translate([L.X(0), L.Y(0)]).clipExtent([[0, 0], [L.width, L.height]]);
    svg.append(svgEl('path', { class: 'mini-land', d: d3.geoPath(proj)(topojson.feature(land, land.objects.land)) }));
  }
  // the true boxes, drawn as straight lon/lat rectangles (never resampled into arcs)
  const rects = new Map();
  for (const r of L.regions) {
    const g = svgEl('g', { class: `mini-box st-${r.status}${r.id === current ? ' sel' : ''}`, 'data-region': r.id });
    if (r.id === current) g.append(svgEl('rect', { x: r.x, y: r.y, width: Math.max(r.w, 2), height: Math.max(r.h, 2), class: 'mini-fill', fill: 'url(#mini-sel)' }));
    g.append(svgEl('rect', { x: r.x, y: r.y, width: Math.max(r.w, 2), height: Math.max(r.h, 2), class: 'mini-outline' }));
    svg.append(g); rects.set(r.id, g);
  }
  const tag = svgEl('g', { class: 'mini-tag' }); svg.append(tag);
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const curIdx = Math.max(0, L.regions.findIndex((r) => r.id === current));
  const el = h('div', { class: 'mini', tabindex: '0', role: 'group', 'aria-roledescription': 'map',
    'aria-label': 'Study regions on a map, west to east. Left and Right arrows move between regions; Enter opens one. The list beside it does the same.' }, svg, live);
  let hot = null;

  function showTag(r) {
    tag.replaceChildren();
    for (const [id, g] of rects) g.classList.toggle('hot', !!r && id === r.id);
    if (!r) return;
    const t = svgEl('text', { class: 'mini-name', x: 0, y: 0 }); t.textContent = r.name;
    tag.append(t);
    const bw = t.getComputedTextLength ? t.getComputedTextLength() : r.name.length * 6;
    const above = r.y > 18;
    const x = Math.max(4, Math.min(L.width - bw - 4, r.px - bw / 2));
    const y = above ? r.y - 6 : r.y + r.h + 13;
    const bg = svgEl('rect', { class: 'mini-name-bg', x: x - 4, y: y - 11, width: bw + 8, height: 15, rx: 2 });
    t.setAttribute('x', x); t.setAttribute('y', y);
    tag.insertBefore(bg, t);
  }
  const say = (r) => { live.textContent = r ? `${r.name} · ${statusChip(r.status)} · ${testWord(r.test)}${r.id === current ? ' (shown)' : ''}` : ''; };
  const open = (r) => { if (r && r.id !== current) { ctx.session.focusSwitcher = false; ctx.navigate({ view: 'trust', region: r.id }); } };
  const toView = (ev) => { const b = svg.getBoundingClientRect(); return [((ev.clientX - b.left) / b.width) * L.width, ((ev.clientY - b.top) / b.height) * L.height]; };

  const ac = new AbortController(); const sig = { signal: ac.signal };
  svg.addEventListener('pointermove', (ev) => { const r = nearestAt(L, ...toView(ev)); if (r !== hot) { hot = r; showTag(r); el.classList.toggle('pointing', !!r); } }, sig);
  svg.addEventListener('pointerleave', () => { hot = null; showTag(document.activeElement === el ? L.regions[kb] : null); el.classList.remove('pointing'); }, sig);
  svg.addEventListener('click', (ev) => open(nearestAt(L, ...toView(ev))), sig);
  let kb = curIdx;
  el.addEventListener('focus', () => { showTag(L.regions[kb]); say(L.regions[kb]); }, sig);
  el.addEventListener('blur', () => { if (!hot) showTag(null); }, sig);
  el.addEventListener('keydown', (ev) => {
    const n = L.regions.length;
    const j = { ArrowLeft: kb - 1, ArrowUp: kb - 1, ArrowRight: kb + 1, ArrowDown: kb + 1, Home: 0, End: n - 1 }[ev.key];
    if (j !== undefined) { ev.preventDefault(); kb = (j + n) % n; showTag(L.regions[kb]); say(L.regions[kb]); return; }
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(L.regions[kb]); }
  }, sig);
  return { el, teardown: () => ac.abort(), layout: L };
}
