// M4.1ux region page: one hero seasonal chart, findings first, unusual months as a timeline (docs/m41/UX-REVISION.md).
// Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../../site/js/core.js';
import * as P from '../../site/js/periods.js';
import * as V from '../../site/js/viz.js';
import { allRegions } from '../../site/js/m2.js';
import { bannedIn } from '../../site/js/story.js';
import * as H from '../../site/js/hero.js';
import { niceAxis } from '../../site/js/season.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const src = (p) => readFileSync(path.join(ROOT, 'site/js', p), 'utf8');
const real = existsSync(path.join(ROOT, 'site/data/manifest.json')) ? read('site/data/manifest.json') : null;
const regions = real ? allRegions(real).map((r) => ({ r, s: read(`site/data/${r.series_path}`) })) : [];

test('hero chart: y-axis unit label, tick labels and month labels are drawn', () => {
  const hero = src('hero.js'); const region = src('region.js');
  assert.match(region, /const unitLabel = `Aqua \$\{dayWord\}detections per month in this box/);
  assert.match(region, /seasonHero\(\{[^}]*unitLabel/);
  assert.match(hero, /h\('p', \{ class: 'hc-unit', text: opts\.unitLabel \}\)/);
  assert.match(hero, /class: 'hc-tick'/); assert.match(hero, /class: `hc-month/);
  assert.match(hero, /for \(const t of ax\.ticks\)/, 'one label per axis tick');
  // one seasonal chart: the old at-a-glance bar chart and the old season shape are gone
  assert.doesNotMatch(region, /periodsPanel|seasonShape/);
  assert.doesNotMatch(src('periods.js'), /pd-bar|pd-cols/);
});

test('hero chart: individual baseline years are hidden by default behind a pressed/unpressed toggle', () => {
  const hero = src('hero.js');
  assert.match(hero, /showYears: false/);
  assert.match(hero, /class: 'hc-toggle', 'aria-pressed': 'false'/);
  assert.match(hero, /gYears\.style\.display = state\.showYears \? '' : 'none';\s*if \(!state\.showYears\) return;/);
  assert.match(hero, /setAttribute\('aria-pressed', state\.showYears \? 'true' : 'false'\)/);
});

test('hero chart: zero, small, missing and estimate are drawn as four different marks', () => {
  const hero = src('hero.js');
  // measured zero: open ring on the baseline; small: filled point + lift tick; missing: hatched slot; estimate: hollow diamond + whisker
  assert.match(hero, /const y = st === 'zero' \? G\.base : G\.Y\(v\.value\);/);
  assert.match(hero, /if \(st === 'small'\) gYear\.append\(svgEl\('line', \{[^}]*class: 'hc-lift'/);
  assert.match(hero, /class: `hc-missing/);
  assert.match(hero, /class: `hc-pt estimated s-\$\{st\}`/);
  assert.match(hero, /class: `hc-whisk/);
  const small = V.smallThreshold(15000, 300, 3);
  assert.deepEqual([null, 0, 1, 20000].map((v) => V.markState(v, small)), ['missing', 'zero', 'small', 'value']);
  assert.deepEqual(V.finiteRuns([1, 2, null, 0, NaN, 3]).map((r) => r.map((x) => x.i)), [[0, 1], [3], [5]]);
});

test('S1: axis tick labels keep one decimal in thousands (2,500 is "2.5k", never "3k")', () => {
  const ax = niceAxis(10105);
  assert.deepEqual(ax.ticks, [0, 2500, 5000, 7500, 10000, 12500]);
  assert.deepEqual(ax.ticks.map((t) => H.tickLabel(t, true)), ['0', '2.5k', '5k', '7.5k', '10k', '12.5k']);
  assert.deepEqual(ax.ticks.map((t) => H.tickLabel(t, false)), ['0', '2,500', '5,000', '7,500', '10,000', '12,500']);
  assert.equal(H.tickLabel(0.5, true), '0.5');
  assert.match(src('hero.js'), /lab\.textContent = tickLabel\(t, G\.narrow\)/);
});

test('S2: a split main season labels both parts on the largest run and marks a Dec→Jan wrap', () => {
  const car = H.seasonRuns([0, 10, 11], null);
  assert.equal(car.wraps, true); assert.deepEqual(car.labelRun, [10, 11]);
  // M4.4 (SQ-01): the region page's median-year set is labelled "busiest months"; "main burning season" names the pre-registered test season only
  assert.equal(car.label(0.84), 'busiest months (both parts) · 84%');
  const kz = H.seasonRuns([3, 4, 7, 8, 9], null);
  assert.equal(kz.wraps, false); assert.deepEqual(kz.labelRun, [7, 8, 9]);
  assert.equal(H.seasonRuns([9, 10], null).label(0.83), 'busiest months · 83%');
  assert.match(src('hero.js'), /class: 'hc-wrap'/);
});

test('S3/S8 (revised M4.2): legend keys only for drawn, not directly labelled marks; "measured by Aqua" and the zero ring only for measured values', () => {
  const o = (v) => ({ value: v, kind: 'observed' }); const e = (v) => ({ value: v, kind: 'modelled' });
  const keys = (vals, extra = {}) => H.legendKeys({ year: 2020, vals, baseLabel: 'B', ...extra }).map(([k]) => k);
  const allEst = keys(Array.from({ length: 12 }, () => e(5)));
  // chart simplification: the right-hand direct labels are gone; a three-item key names the encodings instead
  assert.deepEqual(H.heroKeyItems({ year: 2020, baseLabel: 'B' }).map((x) => x.key), ['aqua', 'band']);
  assert.ok(allEst.includes('est'));
  assert.ok(!keys([e(0), ...Array(11).fill(e(5))]).includes('zero'), 'an estimated 0 is not called "none reported"');
  assert.ok(keys([o(0), ...Array(11).fill(o(5))]).includes('zero'));
  assert.ok(keys([{ value: null }, ...Array(11).fill(o(5))]).includes('missing'));
  assert.ok(!keys([null, ...Array(11).fill(o(5))]).includes('missing'), 'outside the record is not "no usable data"');
  // M4.2: band, median and the selected year are labelled on the chart, so they are not in the legend
  for (const k of ['band', 'median', 'year', 'glyphs', 'recur', 'season']) assert.ok(!keys(Array(12).fill(o(5))).includes(k), k);
  assert.equal(H.heroKeyItems({ year: 2020, baseLabel: 'B' })[0].text, 'Aqua measured, 2020');
  // M4.3: no verdict lane; the month card names the year it describes ("In <year>")
  assert.match(src('hero.js'), /kicker: `In \$\{year\}`/, 'the selected-year verdict is titled where it is shown');
});

test('S4: no verdict glyph without a value (missing / Terra-only months are not "can’t tell")', () => {
  assert.equal(H.verdictGlyph({ value: null }, 'unknown'), null);
  assert.equal(H.verdictGlyph(null, 'above'), null);
  assert.equal(H.verdictGlyph({ value: 3 }, 'none'), null);
  assert.equal(H.verdictGlyph({ value: 3 }, 'above'), 'above');
  assert.equal(H.verdictGlyph({ value: 3, kind: 'modelled' }, 'unknown'), 'unknown');
  // M4.3: a month without a value gets no point glyph, and the month card says "no usable data" in words
  assert.match(src('hero.js'), /const g = verdictGlyph\(state\.vals\[i\], vd\); const v = vals\[i\];\s*if \(!g \|\| !v \|\| v\.value == null\) return;/);
  assert.match(src('hero.js'), /amount = 'no usable data'; unit = 'not a zero';/);
});

test('S5 (revised M4.2): every line is straight between month centres; nothing is smoothed', () => {
  const hero = src('hero.js');
  const fy = hero.slice(hero.indexOf('function drawYear('), hero.indexOf('function drawViirs('));
  assert.match(fy, /profileSegments\(pts\)/);
  assert.match(fy, /svgEl\('line', \{ x1: G\.X\(sg\.from\)/);
  assert.doesNotMatch(fy, /monotone/i, 'no smoothing of a single year');
  // chart simplification: the median line is gone (the band alone shows the usual range); the VIIRS line is straight too
  assert.doesNotMatch(hero, /hc-median|hc-imed/); assert.doesNotMatch(hero, /monotone|[^a-z]C\$\{/i, 'no curve anywhere in the hero chart');
  assert.match(hero, /for \(const sg of viirsSegments\(/);
});

test('H1: the converted-VIIRS layer is off by default, labelled, beside (never in) Aqua’s measured slot', () => {
  const hero = src('hero.js'); const region = src('region.js');
  assert.match(hero, /showViirs: false/);
  assert.match(hero, /'aria-pressed': 'true' \}, 'Aqua only'\)/);
  assert.match(hero, /'aria-pressed': 'false' \}, '\+ VIIRS on Aqua’s scale'\)/);
  // M4.4 (UI-01): beside a month Aqua measured, or (as a labelled gap estimate) in a month Aqua missed; never in Aqua's slot
  assert.match(hero, /if \(v\.kind !== 'observed' && !gap\) return null;/, 'drawn only beside a measured month or as a gap estimate');
  assert.match(hero, /const gap = !!r\.gap_estimate && v\.value == null;/, 'a gap estimate only where Aqua has no value');
  // chart simplification: VIIRS is its own dashed series (own layer, drawn above Aqua with a casing), never in Aqua's slot
  assert.match(hero, /gViirs\.append\(svgEl\('path', \{ d, class: 'hc-vcase' \}\), svgEl\('path', \{ d, class: 'hc-vline' \}\)\);/);
  assert.doesNotMatch(hero.slice(hero.indexOf('function drawViirs('), hero.indexOf('const isDrift = ')), /\+ v\.value|value \+/, 'never summed');
  assert.equal(H.viirsClass({ heldOut: true, train: false }), 'test');
  assert.equal(H.viirsClass({ heldOut: false, train: true }), 'train');
  assert.equal(H.viirsClass({ heldOut: false, train: false }), 'untested');
  const o = { value: 5, kind: 'observed' };
  const lab = H.legendKeys({ year: 2015, vals: [o], viirs: { classes: new Set(['test', 'train']) } }).map(([, t]) => t);
  assert.ok(lab.includes('VIIRS on Aqua’s scale, test year (hidden from the fit)'));
  assert.ok(lab.includes('VIIRS on Aqua’s scale, training year (in-sample)'));
  assert.match(region, /status: `VIIRS on Aqua’s scale · \$\{viirsWord\}\$\{gapCount \? ' · months Aqua missed: gap estimates, cannot be checked \(no Aqua value\)' : ''\}`/, 'the layer carries the region’s status wording (and, M4.4, the gap-estimate status)');
  assert.match(region, /const viirsWord = m2 \? `VIIRS conversion validated \$\{win\} \(comparison tool\)` : chip\.word/);
});

test('A1/A2: one AbortController per render for document listeners; main.js tears the old view down; hero has destroy()', () => {
  const region = src('region.js'); const main = src('main.js'); const hero = src('hero.js');
  assert.match(region, /const ac = new AbortController\(\);/);
  assert.match(region, /root\.__teardown = \(\) => \{ ac\.abort\(\); shape\.destroy\(\); if \(decadesTeardown\) decadesTeardown\(\); \};/, 'M4.2b: also tears down the Across-decades panel');
  assert.equal((region.match(/document\.addEventListener\(/g) || []).length, 2);
  assert.equal((region.match(/signal: ac\.signal/g) || []).length, 2, 'both document listeners are bound to the render');
  assert.doesNotMatch(region, /escHandler/);
  assert.match(main, /for \(const prev of main\.children\) if \(prev\.__teardown\) prev\.__teardown\(\);\s*main\.replaceChildren\(node\);/);
  assert.match(hero, /destroy: \(\) => \{ alive = false; if \(ro\) ro\.disconnect\(\); cancelAnimationFrame\(raf\); \}/);
});

test('region status chip is shown once, doubles as a key, keeps the reliability words; provisional explanation one click away', () => {
  const r = src('region.js');
  assert.equal((r.match(/class: 'chip-d status-chip'/g) || []).length, 1);
  assert.doesNotMatch(r, /rk-status|record-kinds/, 'the second "Record:" chip line is gone');
  assert.match(r, /chip\.word\.replace\(\/\^Aqua measured · \/, ''\)/, 'M1 chip keeps regionChip wording');
  assert.match(r, /h\('span', \{ class: 'ck ck-aqua'/); assert.match(r, /h\('span', \{ class: 'ck ck-viirs'/);
  assert.match(r, /h\('p', \{ text: chip\.title \}\), chip\.detail \? h\('p', \{ class: 'chip-detail', text: chip\.detail \}\)/);
});

test('methodology, chance rate, counting rules and map-unit note live inside disclosures', () => {
  const r = src('region.js'); const p = src('periods.js');
  const how = r.indexOf("h('details', { class: 'disclose sv-how' }");
  assert.ok(how > 0);
  for (const k of ['fd.notes.map', 'SCREENING_NOTE', 'measureLine })']) assert.ok(r.indexOf(k, how) > how && r.indexOf(k, how) < how + 600, `${k} inside "How this is counted"`);
  assert.ok(r.indexOf('measureLine', how) - how < 600 && !/class: 'caption measure-line', text: measureLine \}\),\s*latestBox/.test(r), 'map-unit note not shown outside');
  // the chance text and the shift sentence are only in the notes (disclosure), not in the visible findings
  assert.match(p, /const chance = `Chance alone/);
  assert.match(p, /const notes = \[[\s\S]*?Estimates never count\. \$\{chance\}`/);
  assert.doesNotMatch(p.slice(p.indexOf('export function findingsPanel')), /chance|Chance/, 'the chance text is never in the visible findings');
  const above = p.indexOf("h('details', { class: 'disclose' }, h('summary', { text: 'What above and below mean' })");
  assert.ok(above > 0 && p.indexOf('about one month in three', above) > above, 'the long above/below paragraph is in a disclosure');
});

test('visible limitations stay as one short phrase each', () => {
  const p = src('periods.js'); const r = src('region.js');
  assert.match(p, /a past pattern, not a forecast/);
  assert.match(p, /a screen: chance alone ≈ 1 year in 5–6/);
  assert.match(p, /Descriptive history, not a warning\./);
  assert.match(p, /Unconfirmed: Aqua’s timing drifted/);
  assert.match(r, /: unconfirmed \(Aqua’s timing drifted\)/);
  for (const f of ['periods.js', 'hero.js']) { assert.deepEqual(bannedIn(src(f)), [], f); assert.doesNotMatch(src(f), /\b(19|20)\d\d\b/, `${f}: no year literals`); }
});

test('every unusual month is in the timeline exactly once, as a keyboard-operable button', { skip: !real }, () => {
  const p = src('periods.js');
  assert.match(p, /if \(!\['above', 'below', 'uncertain'\]\.includes\(c\.state\)\)/, 'only non-unusual cells are inert');
  assert.match(p, /h\('button', \{ type: 'button', class: `\$\{colCls\} v-\$\{c\.state\}/);
  assert.match(p, /ev\.key === 'ArrowRight'/); assert.match(p, /ev\.key === 'ArrowUp' \|\| ev\.key === 'ArrowDown'/);
  for (const { r, s } of regions) {
    const { env } = core.envelopeFor(s, real.eras);
    const t = P.unusualTimeline(s.months, env, r.status);
    const cells = t.rows.flatMap((row) => row.cells.filter((c) => c && ['above', 'below', 'uncertain'].includes(c.state)));
    const want = P.unusualMonths(s.months, env, r.status);
    assert.equal(cells.length, want.length, r.id);
    assert.deepEqual(new Set(cells.map((c) => c.r.month)), new Set(want.map((u) => u.r.month)), r.id);
    for (const u of want) assert.equal(cells.find((c) => c.r.month === u.r.month).state, u.cls, `${r.id} ${u.r.month}`);
    // counts before the drift + the drift-year remainder add up to every unusual month
    assert.equal(t.counts.above + t.counts.below + t.counts.uncertain + t.nDrift, want.length, r.id);
    // drift-year months are marked unconfirmed in their row
    for (const row of t.rows) for (const c of row.cells) if (c && c.drift) assert.ok(row.drift, `${r.id} ${row.year}`);
  }
});

test('findings: the two headline answers come from the published series (no new numbers)', { skip: !real }, () => {
  for (const { r, s } of regions) {
    const { env, minYears } = core.envelopeFor(s, real.eras);
    const f = P.findings({ months: s.months, env, minYears, baseLabel: 'B' });
    const ms = P.mainSeason(env, minYears);
    assert.equal(f.season.key, P.monthSpan(ms.months), r.id);
    assert.match(f.season.sub, new RegExp(`^${Math.round(ms.share * 100)}% of a usual year`));
    const rec = P.recurringAbove(s.months, env);
    assert.deepEqual(f.recurringLine.months, rec.months.map((o, i) => (o.flagged ? i : -1)).filter((i) => i >= 0), r.id);
    for (const i of f.recurringLine.months) assert.ok(f.recurringLine.sub.includes(`${core.MONTH_ABBR[i]} ${rec.months[i].above} of ${rec.months[i].decided}`), r.id);
    for (const t of [f.season.head.join(''), f.season.sub, f.recurringLine.head.join(''), f.recurringLine.sub, ...f.notes]) assert.deepEqual(bannedIn(t), [], `${r.id}: ${t}`);
  }
});
