// M4.3 region chart: two principal lines, a quiet band, one month card (docs/m43/REGION-CHART-SIMPLE.md).
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

test('default chart: two principal lines and a band with no edge strokes; no lane, no pip matrix', () => {
  const hero = src('hero.js');
  assert.doesNotMatch(hero, /hc-band-edge|hc-pip|laneTitle|drawRecur|drawGlyphs|hc-lane/);
  assert.match(css, /\.hc-band \{ fill: rgba\(195,203,201,\.12\); stroke: none; \}/);
  assert.doesNotMatch(css, /\.hc-band-edge/);
  assert.match(css, /\.hc-median \{ fill: none; stroke: var\(--viz-silver\); stroke-width: 1\.25;/);
  assert.match(css, /\.hc-yline \{ stroke: var\(--viz-hi\); stroke-width: 2\.2;/);
  // geometry below the axis holds only the month labels and the main-season bracket
  const g = hero.slice(hero.indexOf('const geom = '), hero.indexOf('const small = '));
  assert.doesNotMatch(g, /l1t|l2t|pip/);
});

test('month card keeps the selected-year verdict and the 2012–2021-style recurrence in separate blocks (real data)', { skip: !real }, () => {
  const { s } = regions.find((x) => x.r.id === 'n_australia_topend');
  const { env } = core.envelopeFor(s, real.eras);
  const rec = P.recurringAbove(s.months, env);
  const jun = s.months.find((x) => x.month === '2021-06');
  const c = H.monthCard({ i: 5, year: 2021, value: core.rulerValue(jun, 'record'), env: env[5], verdict: 'within', o: rec.months[5], years: rec.years, baseLabel: 'B' });
  assert.equal(c.title, 'June 2021');
  assert.equal(c.answer, 'Within its B usual range in 2021, but above it in 5 of 10 years, 2012–2021.');
  assert.deepEqual([c.year.kicker, c.year.amount, c.year.unit, c.year.source.key, c.year.vText], ['In 2021', '4,014', 'detections', 'measured', 'Within the usual range']);
  assert.match(c.year.range, /^usual range 3,6\d\d–5,7\d\d \(B\)$/);
  assert.equal(c.hist.period, '2012–2021');
  assert.equal(c.hist.head, 'Above usual in 5 of 10 counted years');
  assert.deepEqual(c.hist.aboveYears, [2012, 2014, 2017, 2018, 2019]);
  assert.deepEqual(c.hist.strip.filter((x) => x.cls === 'on').map((x) => x.y), [2012, 2014, 2017, 2018, 2019]);
  assert.equal(c.hist.strip.length, 10);
  assert.deepEqual(c.hist.strip.filter((x) => x.sel).map((x) => x.y), [2021], 'the selected year is marked by position (outline + tick)');
  // the year's verdict is not in the history block, and the history count is not in the year block
  assert.doesNotMatch(JSON.stringify(c.hist), /within|Within/);
  assert.doesNotMatch(JSON.stringify(c.year), /of 10|counted/);
  for (const t of [c.answer, c.year.vText, c.hist.head, c.hist.note]) assert.deepEqual(bannedIn(t), []);
});

test('month card counts equal the published recurrence in all nine regions and twelve months (no new numbers)', { skip: !real }, () => {
  for (const { r, s } of regions) {
    const { env } = core.envelopeFor(s, real.eras);
    const rec = P.recurringAbove(s.months, env);
    for (let i = 0; i < 12; i += 1) {
      const o = rec.months[i];
      const c = H.monthCard({ i, year: rec.years[rec.years.length - 1], value: { value: 1, kind: 'observed' }, env: env[i], verdict: 'within', o, years: rec.years });
      assert.equal(c.hist.strip.filter((x) => x.cls === 'on').length, o.above, `${r.id} m${i + 1}`);
      assert.equal(c.hist.strip.filter((x) => x.cls !== 'none').length, o.decided, `${r.id} m${i + 1}`);
      if (o.decided) assert.equal(c.hist.head, `Above usual in ${o.above} of ${o.decided} counted years`);
    }
  }
});

test('month card edge cases: no data is not a zero; measured zero; estimate (provisional); drift; in-sample; small', () => {
  const years = [1, 2, 3];
  const o = { above: 1, decided: 2, flagged: false, years: [2], byYear: { 1: 'within', 2: 'above' } };
  const nd = H.monthCard({ i: 0, year: 4, value: { value: null }, env: { p10: 1, p90: 9 }, verdict: null, o, years });
  assert.deepEqual([nd.year.amount, nd.year.unit, nd.year.vText], ['no usable data', 'not a zero', 'No verdict without data']);
  assert.equal(nd.answer, null);
  assert.deepEqual(nd.hist.strip.map((x) => x.cls), ['off', 'on', 'none'], 'a year not counted is a dot, not an empty square');
  const z = H.monthCard({ i: 0, year: 4, value: { value: 0, kind: 'observed' }, env: { p10: 1, p90: 9 }, verdict: 'below', o, years });
  assert.deepEqual([z.year.amount, z.year.unit], ['none reported', 'a measured zero']);
  const e = H.monthCard({ i: 8, year: 4, value: { value: 181, lo: 109, hi: 284, kind: 'modelled' }, env: { p10: 53, p90: 278 }, verdict: 'unknown', o, years, regionStatus: 'provisional', small: true });
  assert.equal(e.year.unit, 'detections, estimate'); assert.match(e.year.source.text, /^estimate from VIIRS · likely range 109–284$/);
  assert.match(e.year.vText, /^Can’t tell/);
  assert.ok(e.caveats.some((t) => /provisional/.test(t) && /Aqua’s own measurements are not affected/.test(t)));
  assert.ok(e.caveats.some((t) => /the zoom shows September on its own scale/.test(t)));
  const fl = { ...o, flagged: true };
  const d = H.monthCard({ i: 0, year: 4, value: { value: 5, kind: 'observed' }, env: { p10: 1, p90: 9 }, verdict: 'within', drift: true, o: fl, years });
  assert.ok(d.year.tags.includes('Unconfirmed: Aqua’s timing had drifted by 4'));
  assert.match(d.answer, /^Within its usual range in 4 \(unconfirmed\), but above it in 1 of 2 years, 1–3\.$/);
  const ab = H.monthCard({ i: 0, year: 2, value: { value: 50, kind: 'observed' }, env: { p10: 1, p90: 9 }, verdict: 'above', o: fl, years, baseLabel: 'B' });
  assert.equal(ab.answer, 'Above its B usual range in 2, as in 1 of 2 years, 1–3, including 2.');
  const s = H.monthCard({ i: 0, year: 2, value: { value: 5, kind: 'observed' }, env: { p10: 1, p90: 9 }, verdict: 'within', inSample: true, o, years });
  assert.ok(s.year.tags.some((t) => /2 helped set the usual range/.test(t)));
  const out = H.monthCard({ i: 0, year: 4, inRecord: false, value: null, env: null, o: null, years: null });
  assert.equal(out.year.amount, 'outside the record'); assert.equal(out.hist, null);
});

test('selected-year verdict glyphs only on its own points (above/below/can’t tell), explained in the legend', () => {
  const hero = src('hero.js');
  const pg = fn(hero, 'drawPointGlyphs', 'drawDirect');
  assert.match(pg, /\['above', 'below', 'unknown'\]\.includes\(vd\)/);
  assert.match(pg, /drift \? ' drift' : ''/);
  const k = H.legendKeys({ year: 2021, vals: [{ value: 5, kind: 'observed' }], glyphs: { drift: true } });
  assert.ok(k.some(([key, t]) => key === 'glyphs' && /hollow = unconfirmed/.test(t)));
  assert.ok(!H.legendKeys({ year: 2021, vals: [{ value: 5, kind: 'observed' }] }).some(([key]) => key === 'glyphs'));
});

test('month selection: click/Enter selects and fills the card; the full month detail is one button away', () => {
  const hero = src('hero.js');
  assert.match(hero, /setCur\(Number\(b\.dataset\.i\), true\); if \(opts\.onSelect\) opts\.onSelect\(b\.__row\);/);
  assert.match(hero, /b\.addEventListener\('focus', \(\) => \{ setCur\(i, true\); if \(b\.__row && opts\.onSelect\) opts\.onSelect\(b\.__row\); \}\);/, 'arrows commit month= too');
  assert.match(hero, /class: 'hc-linkbtn hc-open', onclick: \(ev\) => opts\.onPick\(r, ev\.currentTarget\)/);
  assert.match(hero, /state\.current = i; rove\(\); if \(G\) drawCursor\(\); paintCard\(i\);/);
  assert.match(hero, /Showing a month that is often above usual but wasn’t in \$\{state\.year\} · click any month/);
  assert.match(src('region.js'), /if \(cm != null\) shape\.setCurrent\(cm, \{ why: true \}\)/);
  assert.doesNotMatch(css, /\.hc-cursor \{/, 'nothing hides the selected-month column');
  assert.match(src('region.js'), /onSelect: \(r\) => select\(r, \{ push: true, syncYear: false \}\)/);
});

test('secondary view "Every year, month by month": a real table with the recurrence per year and the k/n footer', () => {
  const hero = src('hero.js');
  const ev = hero.slice(hero.indexOf('export function everyYearTable('), hero.indexOf('/** True when a month'));
  assert.match(ev, /h\('details', \{ class: 'disclose hc-every', id: 'hc-every' \}/);
  assert.match(ev, /h\('table', \{ class: 'ev-table' \}/);
  assert.match(ev, /scope: 'row'/); assert.match(ev, /`\$\{o\.above\}\/\$\{o\.decided\}`/);
  assert.doesNotMatch(ev, /glyph\(|#g-/, 'squares, never the verdict glyphs');
});

test('Region → Trust: header link beside the chip (chip still expands) + one link under the card; ctx.urlFor keeps params', () => {
  const r = src('region.js'); const hero = src('hero.js');
  // M4.4 (UI-02, R5): the Trust href carries the month when it is a plausible test month; Trust re-checks it
  assert.match(r, /const trustHrefFor = \(r\) => \{ const p = \{ view: 'trust', region: region\.id, month: r && isTestMonthCandidate\(region, r\) \? r\.month : null \}; return typeof ctx\.urlFor === 'function' \? ctx\.urlFor\(p\)/);
  assert.match(r, /const trustHref = trustHrefFor\(null\);/);
  assert.match(r, /h\('h1', \{ text: region\.name \}\), chipBox, trustA\('chip-trust', 'See the evidence →'\)/);
  assert.match(r, /trustA\('chip-trust-in',/);
  const n = (r.match(/How trustworthy is the satellite comparison here/g) || []).length + (hero.match(/How trustworthy is the satellite comparison here/g) || []).length;
  assert.equal(n, 1, 'one "How trustworthy" link (in the card), plus the header link');
  assert.match(r, /trust: \{ href: trustHrefFor, region: region\.id \}/);
  assert.doesNotMatch(r, /\?view=trust#decades/);
});

test('year=YYYY deep link selects that year when no month is given', () => {
  assert.match(src('region.js'), /: Number\.isInteger\(yearParam\) && yearOfRows\.has\(yearParam\) \? yearParam : comparable;/);
});

test('M4.3 copy: no banned words, no year literals in hero/periods; region.js no year literals', () => {
  for (const f of ['hero.js', 'periods.js']) assert.deepEqual(bannedIn(src(f)), [], f);
  for (const f of ['hero.js', 'periods.js', 'region.js']) assert.doesNotMatch(src(f), /\b(19|20)\d\d\b/, f);
});
