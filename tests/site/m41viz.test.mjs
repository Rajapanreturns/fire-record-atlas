// M4.1 visual system: zero / missing / small-nonzero stay distinct, motion is instant under reduced motion,
// chart colours meet contrast, the profile breaks at gaps, and the Part 6/7 wording is present and clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as V from '../../site/js/viz.js';
import * as S from '../../site/js/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('markState: missing, zero, small non-zero and value are four different states', () => {
  const small = V.smallThreshold(10000, 200, 3); // 150
  assert.equal(small, 150);
  assert.equal(V.markState(null, small), 'missing');
  assert.equal(V.markState(undefined, small), 'missing');
  assert.equal(V.markState(NaN, small), 'missing');
  assert.equal(V.markState(0, small), 'zero');
  assert.equal(V.markState(1, small), 'small');
  assert.equal(V.markState(149.9, small), 'small');
  assert.equal(V.markState(150, small), 'value');
  // a missing value is never classed as zero, and a tiny count is never classed as zero
  assert.notEqual(V.markState(null), V.markState(0));
  assert.notEqual(V.markState(0.01), V.markState(0));
  assert.equal(V.smallThreshold(0), 0);
});

test('CSS draws the four states differently (hollow zero, hatched missing, tick for small)', () => {
  const css = src('site/css/site.css');
  const ux = css.slice(css.indexOf('/* ---------- M4.1ux region page'));
  assert.ok(ux.length > 100, 'M4.1ux block present');
  // hero chart (M4.1ux): open ring for a measured zero, lifted tick for small, hatched slot for missing, hollow amber estimate
  assert.match(ux, /\.hc-pt\.measured\.s-zero \{ fill: var\(--hc-ink\); stroke: var\(--viz-hi\)/);
  assert.match(ux, /\.hc-pt\.measured \{ fill: var\(--viz-hi\)/);
  assert.match(ux, /\.hc-lift \{/);
  assert.match(ux, /\.hc-missing \{ fill: url\(#pat-hatch\)/);
  assert.match(ux, /\.hc-pt\.estimated \{ fill: var\(--hc-ink\); stroke: var\(--viz-est\)/);
  assert.match(ux, /\.hc-yline\.est \{ stroke: var\(--viz-est\); stroke-dasharray/);
  // timeline: missing is hatched, within is a dot; estimates and drift-year months are hollow glyphs
  assert.match(ux, /\.ut-c\.s-missing::after \{[^}]*var\(--viz-hatch\)/);
  assert.match(ux, /\.ut-c\.est \.glyph, \.ut-c\.drift \.glyph \{ fill: none/);
  assert.match(css, /\.ys-cell\.c0 \{ background: transparent/);
  const hero = src('site/js/hero.js');
  assert.match(hero, /markState\(v \? v\.value : null, sm\)/, 'the hero classifies every value with markState');
  assert.match(hero, /if \(st === 'missing'\)/); assert.match(hero, /s-\$\{st\}/); assert.match(hero, /if \(st === 'small'\)/);
});

test('reduced motion: every helper is instant (0 ms) and returns no animation', () => {
  assert.equal(V.motionMs(520, true), 0);
  assert.equal(V.motionMs(520, false), 520);
  // simulate a reduced-motion browser
  globalThis.matchMedia = () => ({ matches: true });
  let animated = 0;
  const el = { style: { bottom: '40%' }, animate: () => { animated += 1; return {}; } };
  assert.equal(V.intervalFirst([el]), 0);
  assert.equal(animated, 0, 'no animation runs under reduced motion');
  assert.equal(V.reducedMotion(), true);
  globalThis.matchMedia = () => ({ matches: false });
  assert.ok(V.intervalFirst([el]) > 0, 'interval leads the measured value');
  assert.equal('drawIn' in V || 'morphFrom' in V, false, 'unused motion helpers removed (M4.1ux A3)');
  delete globalThis.matchMedia;
  assert.match(src('site/css/site.css'), /@media \(prefers-reduced-motion: reduce\) \{ \.hero-chart \*/);
  assert.match(src('site/js/hero.js'), /motionMs\(420, reducedMotion\(\)\)/, 'year morph is instant under reduced motion');
  assert.match(src('site/js/hero.js'), /if \(!motionMs\(1, reducedMotion\(\)\)/, 'intro is skipped under reduced motion');
});

test('profile segments: a gap breaks the line, an estimate makes the segment dashed', () => {
  const o = (v) => ({ value: v, kind: 'observed' });
  const e = (v) => ({ value: v, kind: 'modelled' });
  const segs = V.profileSegments([o(1), o(2), null, o(0), e(5), { value: null, kind: 'none' }, o(3)]);
  assert.deepEqual(segs, [{ from: 0, to: 1, dashed: false }, { from: 3, to: 4, dashed: true }]);
});

test('contrast: chart marks and text tokens against the chart backgrounds', () => {
  const bgs = [V.VIZ.paper, V.VIZ.plate, '#0C1214'];
  for (const bg of bgs) {
    for (const [name, fg, min] of [['hi', V.VIZ.hi, 7], ['silver', V.VIZ.silver, 4.5], ['grey', V.VIZ.grey, 4.5], ['dim', V.VIZ.dim, 3], ['est', V.VIZ.est, 4.5], ['warn', V.VIZ.warn, 4.5]]) {
      assert.ok(V.contrast(fg, bg) >= min, `${name} ${fg} on ${bg}: ${V.contrast(fg, bg).toFixed(2)} < ${min}`);
    }
  }
  // luminance ramp is monotonic and its first step meets 3:1 against the page ( zero is a hollow ring instead)
  const L = V.LUM_RAMP.map(V.luminance);
  for (let i = 1; i < L.length; i += 1) assert.ok(L[i] > L[i - 1], 'ramp increases');
  assert.ok(V.contrast(V.LUM_RAMP[0], V.VIZ.plate) >= 3, 'first step >= 3:1 on plate');
  // CSS mirrors the JS tokens
  const css = src('site/css/site.css');
  for (const [k, v] of Object.entries({ hi: V.VIZ.hi, silver: V.VIZ.silver, grey: V.VIZ.grey, dim: V.VIZ.dim, est: V.VIZ.est })) assert.ok(css.includes(`--viz-${k}: ${v}`), k);
  V.LUM_RAMP.forEach((c, i) => assert.ok(css.includes(`--viz-r${i + 1}: ${c}`), `r${i + 1}`));
});

test('Part 6: provisional wording (exact), detail line, no "never", chip names both kinds', () => {
  assert.equal(S.PROVISIONAL_NOTE, 'VIIRS estimates here are provisional: in the pre-registered test their likely ranges caught Aqua’s real value too rarely. Those test months have now been examined, so a new check here cannot be independent. Aqua’s own measurements are not affected.');
  assert.equal(S.PROVISIONAL_DETAIL, 'A future method could gain support from new comparable regions; that would not be a direct validation here.');
  const c = S.regionChip({ status: 'provisional' });
  assert.match(c.word, /^Aqua measured · VIIRS estimates: provisional/);
  assert.equal(c.title, S.PROVISIONAL_NOTE);
  for (const t of [S.PROVISIONAL_NOTE, S.PROVISIONAL_DETAIL, c.word]) { assert.doesNotMatch(t, /\bnever\b/i); assert.deepEqual(S.bannedIn(t), []); assert.doesNotMatch(t, /\b(19|20)\d\d\b/); }
});

test('Part 7: satellite selection follows the fixed rule and says it is a rule, not a better method', () => {
  const v = S.estimateSource({ status: 'validated' }, { platform: 'snpp' });
  assert.equal(v.step, 1); assert.equal(v.platform, 'snpp'); assert.match(v.text, /^Estimate from: S-NPP VIIRS \(rule: validated conversion here\)/);
  const p = S.estimateSource({ status: 'provisional' }, { platform: 'snpp' });
  assert.equal(p.step, 2); assert.match(p.text, /^Estimate from: S-NPP VIIRS \(rule: /);
  const m2 = { tier: 'm2_primary', status: 'validated', m2: { predictor_platform: 'noaa20' } };
  assert.equal(S.estimateSource(m2, { inWindow: true }).platform, 'noaa20');
  assert.equal(S.estimateSource(m2, { inWindow: false }).platform, null);
  assert.equal(S.estimateSource({ status: 'explore_only' }).platform, null);
  for (const r of [v, p, S.estimateSource(m2, { inWindow: true }), S.estimateSource(m2)]) {
    assert.match(r.text, /Selected by a fixed rule; not shown to be better than combining satellites\./);
    assert.deepEqual(S.bannedIn(r.text), []);
    assert.doesNotMatch(r.text, /\b(19|20)\d\d\b/);
  }
});

test('M4.1 QA C1/C3: baseline points only from the band years; drift-era estimates are not "validated"', async () => {
  const S = await import('../../site/js/story.js');
  const v = S.estimateSource({ status: 'validated' }, { platform: 'snpp', afterValidation: true });
  assert.equal(v.step, 2); assert.match(v.text, /not after/);
  assert.equal(S.estimateSource({ status: 'validated' }, { platform: 'snpp' }).step, 1);
});
