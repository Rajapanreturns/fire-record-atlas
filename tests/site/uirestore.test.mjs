// UI restore (M3): the dark "cartographic workspace" design carries the M3 regions and stays still under reduced motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import * as M from '../../site/js/m2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(ROOT, 'site/data/manifest.json');
const hasReal = existsSync(manifestPath);
const manifest = hasReal ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('region directory lists every M1 and M2 region exactly once, in two labelled groups', { skip: !hasReal }, () => {
  const groups = M.directoryGroups(manifest);
  const ids = groups.flatMap((g) => g.list.map((r) => r.id));
  const expected = [...new Set([...(manifest.m2_regions || []), ...manifest.regions].map((r) => r.id))];
  assert.equal(ids.length, expected.length);
  assert.deepEqual([...ids].sort(), [...expected].sort());
  assert.equal(ids.length, 9, 'contract 1.4.0: 5 M2 + 4 M1 regions');
  assert.deepEqual(groups.map((g) => g.id), ['m2', 'm1']);
  assert.ok(groups[0].list.every(M.isM2Region));
  assert.ok(groups[1].list.every((r) => !M.isM2Region(r)));
  for (const g of groups) assert.doesNotMatch(g.label, /\b(19|20)\d\d\b/, 'no year literals in group labels');
});

test('atlas wiring: directory uses directoryGroups; globe receives all regions, not only M1', () => {
  const s = src('site/js/stage.js');
  // M4.5 (D4): one west -> east list from data; no satellite groups
  assert.match(s, /westEast\(S\.manifest\)\.map\(chipItem\)/); assert.doesNotMatch(s, /directoryGroups\(/);
  assert.match(s, /createGlobe\([^)]*regions: allRegions\(manifest\)/s);
  assert.doesNotMatch(s, /regions: manifest\.regions \|\| \[\], colours/);
});

// ---- globe under a minimal DOM stub ----
function stubDom({ reduce }) {
  const frames = []; const timers = { n: 0 };
  const ctxCalls = [];
  const ctx = new Proxy({}, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { ctxCalls.push({ k, lw: t.lineWidth, a }); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  const listeners = {};
  const canvas = {
    style: {}, width: 0, height: 0, tabIndex: -1, className: '',
    setAttribute() {}, addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    getContext: () => ctx, matches: () => false, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }),
    hasPointerCapture: () => false, setPointerCapture() {}, releasePointerCapture() {},
  };
  globalThis.window = { devicePixelRatio: 1, matchMedia: (q) => ({ matches: reduce && /reduced-motion/.test(q) }) };
  globalThis.document = { createElement: () => canvas };
  globalThis.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  globalThis.setInterval = () => { timers.n += 1; return 0; };
  if (!globalThis.d3) vm.runInThisContext(readFileSync(path.join(ROOT, 'site/vendor/d3.v7.9.0.min.js'), 'utf8'));
  window.d3 = globalThis.d3;
  const host = { clientWidth: 600, clientHeight: 600, append() {} };
  const flush = () => { let n = 0; while (frames.length && n < 50) { frames.shift()(); n += 1; } return n; };
  return { host, frames, flush, timers, ctxCalls, listeners };
}

test('globe: no autonomous rotation; with reduced motion it draws once and stays still; focus jumps without a tween', { skip: !hasReal }, async () => {
  const realSetInterval = globalThis.setInterval;
  try {
    const env = stubDom({ reduce: true });
    const { createGlobe } = await import('../../site/js/globe.js');
    const globe = createGlobe(env.host, { layer: null, thresholds: null, landGeo: null, regions: M.allRegions(manifest), colours: ['#455052'] });
    assert.equal(env.flush(), 1, 'one initial frame');
    assert.equal(env.frames.length, 0, 'no frame re-queued: nothing spins on its own');
    assert.equal(env.timers.n, 0, 'no interval timers');
    const se = M.allRegions(manifest).find((r) => r.id === 'se_asia_mainland');
    const [w, s, e, n] = se.bbox;
    env.ctxCalls.length = 0;
    globe.focusPlace({ lat: (s + n) / 2, lon: (w + e) / 2 });
    assert.equal(env.flush(), 1, 'focusing a place is a single redraw (a jump), not an animation');
    assert.equal(env.frames.length, 0);
    // M4.5 (M3): every study region's marker is drawn alike (no "validated" weight); the list carries each test and status
    const boxes = env.ctxCalls.filter((c) => c.k === 'strokeRect' && c.a[2] === 8);
    assert.ok(boxes.length && boxes.every((c) => !(c.lw > 2)), 'no thick (validated) marker');
    globe.setActive(false);
    globe.reset();
    assert.equal(env.frames.length, 0, 'an inactive globe schedules nothing');
  } finally {
    globalThis.setInterval = realSetInterval;
    delete globalThis.window; delete globalThis.document; delete globalThis.requestAnimationFrame;
  }
});

test('globe markers: all 9 regions are passed and each centre is drawable', { skip: !hasReal }, async () => {
  const realSetInterval = globalThis.setInterval;
  try {
    const env = stubDom({ reduce: false });
    const { createGlobe } = await import('../../site/js/globe.js');
    const regions = M.allRegions(manifest);
    const globe = createGlobe(env.host, { layer: null, thresholds: null, landGeo: null, regions, colours: ['#455052'] });
    env.flush();
    for (const r of regions) {
      const [w, s, e, n] = r.bbox;
      env.ctxCalls.length = 0;
      globe.focusPlace({ lat: (s + n) / 2, lon: (w + e) / 2 });
      env.flush();
      const boxes = env.ctxCalls.filter((c) => c.k === 'strokeRect' && c.a[2] === 8);
      const centre = boxes.find((c) => Math.abs(c.a[0] + 4 - 300) < 1 && Math.abs(c.a[1] + 4 - 300) < 1);
      assert.ok(centre, `${r.id}: marker at the globe centre when focused`);
      assert.ok(!(centre.lw > 2), `${r.id}: the same marker weight for every region (M3)`);
    }
  } finally {
    globalThis.setInterval = realSetInterval;
    delete globalThis.window; delete globalThis.document; delete globalThis.requestAnimationFrame;
  }
});

test('dark workspace: M3 components carry no light-paper fills outside print; M3 block is restated after the theme', () => {
  const css = src('site/css/site.css');
  const theme = css.indexOf('/* Fire Record Atlas — cartographic workspace */');
  const restore = css.indexOf('/* ---------- M3 components in the cartographic workspace');
  assert.ok(theme > 0 && restore > theme, 'restyle block comes after the copy theme');
  const tail = css.slice(restore).replace(/@media print \{[\s\S]*?\n\}/g, '');
  assert.doesNotMatch(tail, /#F1E1D6|#E6E1D6|#F6EAE1/i);
  for (const sel of ['.dc-cell.rev.miss', '.cm td.cm-diag', '.cm td.cm-miss', '.ag-bar i', '.case-supported', '.dc-readout']) assert.ok(tail.includes(sel), sel);
});

test('QA u1–u5: drift mark shape, value-kind caption, zero-cell edge, raw prefix, directory label', () => {
  const css = src('site/css/site.css');
  const d = src('site/js/decades.js');
  const st = src('site/js/stage.js');
  // u1: drifted Aqua is a filled dot with a dashed edge; raw NOAA-20 stays a hollow ring
  const drift = css.slice(css.lastIndexOf('.ts-dot.aqua.drift, .ts-key.aqua.drift'));
  assert.match(drift, /background: var\(--muted\); border: 0; outline: 1\.5px dashed/);
  assert.match(css, /\.ts-dot\.ring \{ border: 2\.5px solid var\(--viirs\); background: var\(--plate\); \}/);
  // u2: one caption line naming the kinds under the ruler, no year literals or banned words
  const cap = d.match(/'(● Aqua measured[^']+)'/);
  assert.ok(cap, 'value-kind caption present');
  for (const k of ['Aqua measured', 'NOAA-20 own scale', 'converted, tested', 'converted, not tested', 'drifted Aqua (not a check)', 'no usable data (not zero)']) assert.ok(cap[1].includes(k), k);
  assert.doesNotMatch(cap[1], /\b(19|20)\d\d\b/);
  // u3: zero cells keep the grey fill and get a lighter inner edge >= 3:1 against blank, on map, globe and swatch
  const lum = (hex) => { const c = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const edge = st.match(/ZERO_EDGE = '(#[0-9A-Fa-f]{6})'/)[1];
  assert.match(st, /const OCHRE = \['#455052'/, 'zero fill unchanged');
  for (const blank of ['#0B1114', '#0A1012', '#090C0E']) assert.ok(ratio(edge, blank) >= 3, `${edge} vs ${blank}: ${ratio(edge, blank).toFixed(2)}`);
  assert.match(st, /g\.clip\(P\.full\[0\]\); g\.strokeStyle = ZERO_EDGE/);
  assert.match(st, /zeroEdge: ZERO_EDGE/);
  assert.match(src('site/js/globe.js'), /g\.clip\(paths\[0\]\);[\s\S]{0,80}g\.strokeStyle = zeroEdge/);
  assert.ok(css.includes(`.sw-zero { box-shadow: inset 0 0 0 1px ${edge}; }`));
  // u4 + u5
  assert.match(d, /Not on Aqua’s scale \(unsupported\) — raw count would say: /);
  assert.equal(M.directoryGroups({ regions: [], m2_regions: [{ id: 'x', tier: 'm2_primary', m2: {} }] })[0].label, 'Tested against the 2000s · NOAA-20');
});

test('QA plan review: post-window converted values say the range is carried over and the result is assumption-only (years from data)', () => {
  const d = src('site/js/decades.js');
  assert.match(d, /const span = `\$\{yearOf\(win\.start\)\}–\$\{yearOf\(win\.end\)\}`/);
  assert.match(d, /range carried over from \$\{span\}; not tested after/);
  assert.match(d, /Assumption-only: assumes the \$\{span\} NOAA-20→Aqua relation still holds; Aqua’s drift means this can’t be checked\./);
  assert.match(d, /const carried = tested \? '' :/, 'only on untested (post-window) months');
  assert.doesNotMatch(d.match(/Assumption-only:[^`]+/)[0], /\b(19|20)\d\d\b/, 'no year literals');
});
