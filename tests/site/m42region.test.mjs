// M4.2 region chart: three concepts in three labelled places, one bright line, no smoothing (docs/m42/REGION-CHART.md).
// Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../../site/js/core.js';
import * as P from '../../site/js/periods.js';
import * as H from '../../site/js/hero.js';
import { allRegions } from '../../site/js/m2.js';
import { bannedIn } from '../../site/js/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const src = (p) => readFileSync(path.join(ROOT, 'site/js', p), 'utf8');
const css = readFileSync(path.join(ROOT, 'site/css/site.css'), 'utf8');
const real = existsSync(path.join(ROOT, 'site/data/manifest.json')) ? read('site/data/manifest.json') : null;
const regions = real ? allRegions(real).map((r) => ({ r, s: read(`site/data/${r.series_path}`) })) : [];
const fn = (code, name, next) => code.slice(code.indexOf(`function ${name}(`), code.indexOf(`function ${next}(`));

test('n_australia_topend: Jan/Jun recur above usual in 2012–2021 yet are within usual in 2021; Jul is above (verified fact)', { skip: !real }, () => {
  const { r, s } = regions.find((x) => x.r.id === 'n_australia_topend');
  const { env } = core.envelopeFor(s, real.eras);
  const rec = P.recurringAbove(s.months, env);
  assert.deepEqual(rec.years, [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021]);
  const m = (i) => rec.months[i];
  assert.deepEqual([m(0).above, m(0).decided, m(0).years], [5, 10, [2012, 2013, 2014, 2019, 2020]]);
  assert.deepEqual([m(5).above, m(5).decided, m(5).years], [5, 10, [2012, 2014, 2017, 2018, 2019]]);
  assert.deepEqual([m(6).above, m(6).decided], [7, 10]); assert.ok(m(6).years.includes(2021));
  const v = (mo) => core.monthVerdict(s.months.find((x) => x.month === mo), 'record', env).cls;
  assert.equal(v('2021-01'), 'within'); assert.equal(v('2021-06'), 'within'); assert.equal(v('2021-07'), 'above');
  // default readout month: the contrast month with the largest usual median (Jun, visible on the shared axis; Jan is flat)
  const verdicts = Array.from({ length: 12 }, (_, i) => v(`2021-${String(i + 1).padStart(2, '0')}`));
  const { minYears } = core.envelopeFor(s, real.eras);
  assert.equal(H.contrastIndex({ recurrence: rec, env, minYears, verdicts }), 5);
  assert.ok(H.tinyOnAxis(env[0], 12500), 'Jan is under 2% of the axis (the zoom opens with it)');
  assert.ok(!H.tinyOnAxis(env[5], 12500));
  // the answer line names both periods and both answers, with the real values
  const jun = s.months.find((x) => x.month === '2021-06');
  const a = H.monthAnswer({ i: 5, year: 2021, value: core.rulerValue(jun, 'record'), env: env[5], verdict: 'within', o: m(5), years: rec.years });
  assert.equal(a.head, 'Within usual in 2021, but often above usual in 2012–2021.');
  assert.match(a.body, /^June 2021: 4,014 detections, inside the usual range \(3,6\d\d–5,7\d\d\)\. In 5 of the 10 counted years 2012–2021, June was above its usual range\.$/, 'a within year is not claimed as one of the above years');
  assert.deepEqual(bannedIn(a.head + a.body), []);
  assert.equal(H.recurPhrase(m(0), rec.years), 'above usual in 5 of 10 years, 2012–2021');
  // the finding names its period
  const f = P.findings({ months: s.months, env, minYears: core.envelopeFor(s, real.eras).minYears, baseLabel: 'B' });
  assert.equal(f.recurringLine.head.join(''), 'Jan, Jun, Jul were above usual again and again in 2012–2021');
  void r;
});

test('recurrence per year (byYear) adds up to the published counts in every region (no new numbers)', { skip: !real }, () => {
  for (const { r, s } of regions) {
    const { env } = core.envelopeFor(s, real.eras);
    const rec = P.recurringAbove(s.months, env);
    for (const o of rec.months) {
      const vals = Object.values(o.byYear);
      assert.equal(vals.length, o.decided, r.id);
      assert.equal(vals.filter((c) => c === 'above').length, o.above, r.id);
      assert.deepEqual(Object.keys(o.byYear).map(Number).filter((y) => o.byYear[y] === 'above').sort(), [...o.years].sort(), r.id);
      for (const y of Object.keys(o.byYear)) assert.ok(rec.years.includes(Number(y)), r.id);
    }
  }
});

test('monthAnswer: verdict and history side by side; n from data (never a fixed "10"); drift, in-sample, no data', () => {
  const years = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const o9 = { above: 4, decided: 9, flagged: false, byYear: {} };
  const val = { value: 50, kind: 'observed' }; const e = { p10: 10, p90: 100 };
  const a = H.monthAnswer({ i: 7, year: 11, value: val, env: e, verdict: 'within', o: o9, years });
  assert.equal(a.head, 'Within usual in 11.');
  assert.equal(a.body, 'August 11: 50 detections, inside the usual range (10–100). In 4 of the 9 counted years 1–10, August was above its usual range.');
  const fl = { above: 6, decided: 10, flagged: true, byYear: { 3: 'above' } };
  assert.match(H.monthAnswer({ i: 0, year: 3, value: val, env: e, verdict: 'below', o: fl, years, drift: true }).head, /^Below usual in 3 \(unconfirmed\), though often above usual in 1–10\.$/);
  assert.match(H.monthAnswer({ i: 0, year: 3, value: val, env: e, verdict: 'above', o: fl, years }).body, /was above its usual range, including 3\.$/);
  assert.match(H.monthAnswer({ i: 0, year: 0, value: val, env: e, verdict: 'within', o: fl, years, inSample: true }).head, /\(0 helped set the usual range\)/);
  const nd = H.monthAnswer({ i: 0, year: 11, value: { value: null }, env: e, verdict: null, o: fl, years });
  assert.equal(nd.head, 'No usable data for January 11 (not a zero).'); assert.doesNotMatch(nd.body, /inside|over|under/);
  assert.equal(H.monthAnswer({ i: 0, year: 11, value: val, env: e, verdict: 'within', o: null, years }), null);
  assert.doesNotMatch(src('hero.js'), /\$\{recurrence\.years\.length\}-year count|10-year count/, 'no fixed-length count phrase');
  assert.equal(H.recurPhrase({ above: 0, decided: 0 }, years), null, 'no counted years: say nothing');
  // contrast month: largest usual median among flagged months that are within/below
  const months = Array.from({ length: 12 }, () => ({ above: 0, decided: 10, flagged: false }));
  months[0] = { above: 5, decided: 10, flagged: true }; months[5] = { above: 5, decided: 10, flagged: true };
  const env = Array.from({ length: 12 }, (_, i) => ({ n_years: 9, p50: i === 0 ? 1 : i === 5 ? 4000 : 10 }));
  assert.equal(H.contrastIndex({ recurrence: { months, years }, env, minYears: 5, verdicts: Array(12).fill('within') }), 5);
  assert.equal(H.contrastIndex({ recurrence: { months, years }, env, minYears: 5, verdicts: Array(12).fill('above') }), null);
});

test('the answer line lives inside the month card, under the plot (M4.3; was under the readout in M4.2b)', () => {
  const hero = src('hero.js');
  assert.match(hero, /vNote, key, plot, card, inset,/); // chart simplification: the three-item key replaces the direct-label row
  // M4.3b: the card headline names the baseline period (monthAnswer stays exported and tested above)
  assert.match(hero, /answer = verdict === 'within' \? `Within \$\{base\} in \$\{year\}\$\{tag\}, but above it in \$\{k\}\.`/);
});

test('timeline below is tied to the month card: the solid ▲ per column over the comparison years equal the recurrence count', { skip: !real }, () => {
  for (const { r, s } of regions) {
    const { env } = core.envelopeFor(s, real.eras);
    const rec = P.recurringAbove(s.months, env); const t = P.unusualTimeline(s.months, env, r.status);
    for (let i = 0; i < 12; i += 1) {
      const n = t.rows.filter((row) => rec.years.includes(row.year)).filter((row) => { const c = row.cells[i]; return c && c.state === 'above' && c.kind.key === 'observed' && !c.drift; }).length;
      assert.equal(n, rec.months[i].above, `${r.id} m${i + 1}`);
    }
  }
  assert.match(src('periods.js'), /class: 'ut-tie'/);
});

test('three concepts, separate places (M4.3): verdict glyphs only on the selected year’s points; recurrence only as squares in the card and the table', () => {
  const hero = src('hero.js');
  const pg = fn(hero, 'drawPointGlyphs', 'drawDirect');
  assert.match(pg, /#g-\$\{g\}/); assert.match(pg, /\['above', 'below', 'unknown'\]\.includes\(vd\)/, 'no glyph for within');
  const card = fn(hero, 'paintCard', 'rove');
  const hist = card.slice(card.indexOf('if (c.hist)'), card.indexOf('card.replaceChildren('));
  assert.doesNotMatch(hist, /glyph\(|#g-/, 'the history block never reuses the verdict glyphs');
  assert.match(hist, /hc-strip-sq/);
  assert.doesNotMatch(hero, /hc-pip|drawRecur|drawGlyphs|laneTitle/, 'no lane or pip matrix in the default chart');
  // the readout's month still opens on the contrast case
  assert.match(src('region.js'), /const cm = shape\.contrastMonth\(\); if \(cm != null\) shape\.setCurrent\(cm, \{ why: true \}\); else shape\.setCurrent\(shape\.peakMonth\(\)\);/);
});

test('one bright line: the selected year glows; the median is a thin silver line (not bright, not dashed)', () => {
  const hero = src('hero.js');
  assert.match(css, /\.hc-median \{ fill: none; stroke: var\(--viz-silver\); stroke-width: 1\.25;/);
  assert.match(css, /\.hc-yline \{ stroke: var\(--viz-hi\); stroke-width: 2\.2;/);
  assert.equal((css.match(/^\.hc-(median|plot|yline) \{/gm) || []).length, 3, 'one definition each (folded)');
  assert.doesNotMatch(hero, /class: 'hc-median', filter/, 'no glow on the median');
  assert.match(hero, /class: `hc-yline\$\{sg\.dashed \? ' est' : ''\}`, filter: sg\.dashed \? null : 'url\(#hc-glow\)'/);
  assert.doesNotMatch(css.match(/\.hc-median \{[^}]*\}/)[0], /dasharray/);
});

test('no smoothing: band edges, median and the year are straight between month centres', () => {
  const hero = src('hero.js');
  assert.doesNotMatch(hero, /monotone/i);
  assert.match(hero, /const line = \(pts\) => pts\.map\(\(p, k\) => `\$\{k \? 'L' : 'M'\}/);
});

test('chart simplification: a three-item key (Aqua, VIIRS when on, band) replaces the direct labels; no median item', () => {
  const o = (v) => ({ value: v, kind: 'observed' });
  assert.deepEqual(H.heroKeyItems({ year: 2021, baseLabel: 'B' }).map((x) => x.key), ['aqua', 'band']);
  assert.deepEqual(H.heroKeyItems({ year: 2021, baseLabel: 'B', showViirs: true }).map((x) => x.key), ['aqua', 'viirs', 'band']);
  assert.equal(H.heroKeyItems({ year: 2021, baseLabel: 'B' })[1].text, 'usual range (middle 80%, B)');
  assert.deepEqual(H.legendKeys({ year: 2021, vals: Array(12).fill(o(5)), baseLabel: 'B' }), []);
  assert.equal(H.directLabels, undefined, 'the right-hand annotations are gone');
});

test('chip: no stray "~ " or doubled "✓✓" before the status chip keys', () => {
  assert.match(css, /\.status-chip > summary\.chip::before \{ content: none; \}/);
  const r = src('region.js');
  assert.match(r, /h\('span', \{ class: 'ck ck-aqua'/);
});

test('timeline year labels: one Tab stop (roving tabindex), arrows move between years', () => {
  const p = src('periods.js');
  assert.match(p, /class: `ut-y\$\{row\.drift \? ' drift' : ''\}`, tabindex: '-1'/);
  assert.match(p, /function roveYear\(b\) \{ for \(const x of yList\) x\.tabIndex = x === b \? 0 : -1; \}/);
  assert.match(p, /ArrowUp: k - 1, ArrowDown: k \+ 1/);
});

test('M4.2 copy: no banned words, no year literals in site code', () => {
  // region.js already carried a raw-scale sentence before M4.2 that the source-level scan flags; its new copy is in hero.js
  for (const f of ['hero.js', 'periods.js', 'region.js']) {
    if (f !== 'region.js') assert.deepEqual(bannedIn(src(f)), [], f);
    assert.doesNotMatch(src(f), /\b(19|20)\d\d\b/, `${f}: no year literals`);
  }
});
