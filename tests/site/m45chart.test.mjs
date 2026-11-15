// Region chart simplification: three encodings (Aqua line, VIIRS dashed line when on, usual band); no median line;
// the VIIRS line breaks at gaps; one interval only (the selected month); the key follows state; one status line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as H from '../../site/js/hero.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hero = readFileSync(path.join(ROOT, 'site/js/hero.js'), 'utf8');
const css = readFileSync(path.join(ROOT, 'site/css/site.css'), 'utf8');

test('no median path anywhere in the hero chart (main plot or zoom); the band stays, fill only', () => {
  assert.doesNotMatch(hero, /class: 'hc-median'|class: 'hc-med-pt'|class: 'hc-imed'|gMed/);
  assert.match(hero, /class: 'hc-band' \}/);
  assert.match(css, /\.hc-band \{ fill: rgba\(195, 203, 201, \.13\); stroke: none; \}/);
});

test('VIIRS line segments join consecutive months and BREAK at any month without a value', () => {
  assert.deepEqual(H.viirsSegments([1, 2, 3, null, 5, 6, null, null, 9, null, 11, 12]), [{ from: 0, to: 2 }, { from: 4, to: 5 }, { from: 10, to: 11 }]);
  assert.deepEqual(H.viirsSegments([null, 4, null, 4, null]), [], 'isolated months are markers only, never joined across a gap');
  assert.deepEqual(H.viirsSegments([0, 0]), [{ from: 0, to: 1 }], 'zero is a value');
  assert.deepEqual(H.viirsSegments([NaN, 1, 2]), [{ from: 1, to: 2 }]);
});

test('one interval only: the selected month’s whisker; no per-month VIIRS bars; markers small', () => {
  const dv = hero.slice(hero.indexOf('function drawViirs('), hero.indexOf('const isDrift = '));
  assert.equal((dv.match(/class: 'hc-vwhisk'/g) || []).length, 1);
  assert.match(dv, /const cur = pts\[state\.current\];/);
  assert.match(dv, /width: 5\.2, height: 5\.2, class: `hc-vpt/);
  assert.match(css, /\.hc-vline \{ fill: none; stroke: var\(--viz-est\); stroke-width: 1\.8; stroke-dasharray: 5 3\.5;/);
  assert.match(css, /\.hc-vcase \{ fill: none; stroke: var\(--paper\); stroke-width: 4\.2;/);
});

test('the key reflects state: VIIRS item only while the layer is on', () => {
  assert.deepEqual(H.heroKeyItems({ year: 2019, baseLabel: '2003–2011' }).map((x) => x.text), ['Aqua measured, 2019', 'usual range (middle 80%, 2003–2011)']);
  assert.deepEqual(H.heroKeyItems({ year: 2019, baseLabel: 'B', showViirs: true }).map((x) => x.key), ['aqua', 'viirs', 'band']);
  assert.equal(H.heroKeyItems({ year: 2019, baseLabel: 'B', showViirs: true })[1].text, 'VIIRS on Aqua’s scale (converted estimate)');
});

test('one status line per class; mixed classes joined; never "validated" for provisional or drift-era months', () => {
  const m2 = { status: 'validated', m2: { validated_window: { start: '2018-04', end: '2021-12' } } };
  const snppV = { status: 'validated' }; const prov = { status: 'provisional' };
  const L = (region, year, months) => H.viirsStatusLine({ region, year, months });
  assert.equal(L(m2, 2021, [{ cls: 'test' }]), 'VIIRS on Aqua’s scale · region test: validated (NOAA-20, 2018–2021) · 2021: hidden test year');
  assert.equal(L(m2, 2023, [{ cls: 'untested', drift: true }]), 'VIIRS on Aqua’s scale · region test: validated (NOAA-20, 2018–2021) · 2023: untested (Aqua drift era)');
  assert.equal(L(prov, 2020, [{ cls: 'train' }, { cls: 'gap' }, { cls: 'train' }]), 'VIIRS on Aqua’s scale · region test: provisional (S-NPP), not yet reliable · 2020: in-sample training year + gap estimates (Aqua missed the month)');
  assert.equal(L(prov, 2023, [{ cls: 'untested', drift: true, platform: 'snpp' }, { cls: 'gap', drift: true }]), 'VIIRS on Aqua’s scale · region test: provisional (S-NPP), not yet reliable · 2023: untested (Aqua drift era) + gap estimates (Aqua missed the month)');
  assert.equal(L(snppV, 2016, [{ cls: 'test' }]), 'VIIRS on Aqua’s scale · region test: validated (S-NPP) · 2016: hidden test year');
  assert.equal(L(snppV, 2023, [{ cls: 'untested', platform: 'noaa20' }]), 'VIIRS on Aqua’s scale · region test: validated (S-NPP) · 2023: untested (NOAA-20 on an S-NPP region)');
  assert.equal(L(m2, 2008, []), 'VIIRS on Aqua’s scale · no converted month in 2008');
  assert.doesNotMatch(L(prov, 2019, [{ cls: 'test' }]), /\bvalidated\b/);
});

test('per-month classes stay in the tooltip / month card; the region page still feeds Aqua-only months', () => {
  assert.match(hero, /const cls = m\.gap \? \(opts\.viirs\.gapTag \? opts\.viirs\.gapTag\(r\)/);
  assert.match(hero, /'data-class': viirsClass\(p\.m\)/);
  assert.match(readFileSync(path.join(ROOT, 'site/js/region.js'), 'utf8'), /const months = aquaOnlyMonths\(series\.months\);/);
});
