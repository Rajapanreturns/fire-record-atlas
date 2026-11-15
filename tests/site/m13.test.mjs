// M1.3 stage 1: scientific wording, plain metric, guided reveal, two-satellite figure helpers, calendar keyboard.
// Run: node --test tests/site/*.mjs. Expected numbers are recomputed here from the data files, never hard-coded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as S from '../../site/js/story.js';
import * as core from '../../site/js/core.js';
import * as T from '../../site/js/twosat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = path.join(ROOT, 'site/data');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const hasReal = existsSync(path.join(REAL, 'manifest.json')) && existsSync(path.join(REAL, 'validation.json'));
const real = () => {
  const m = read(path.join(REAL, 'manifest.json')); const v = read(path.join(REAL, 'validation.json'));
  const rec = Object.entries(m.regions.reduce((a, r) => ({ ...a, [r.method]: (a[r.method] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0][0];
  return { m, v, rec };
};
const yearsIn = (t) => (String(t).match(/\b(?:19|20)\d\d\b/g) || []).map(Number);

// ---------- reveal outcome: point error and range coverage are scored separately ----------

test('revealOutcome never says "Close"; a caught-but-far estimate says so plainly', () => {
  const far = S.revealOutcome(30, 10, 5, 50);
  assert.equal(far.kind, 'inside_far');
  assert.equal(far.point, 'Estimate vs measured: 3.0× too high');
  assert.equal(far.range, 'Likely range: caught it');
  assert.match(far.text, /^Inside the likely range, but the estimate was 3\.0× too high \(30 vs 10\)\. The range was wide enough; the estimate itself was far off\.$/);
  const low = S.revealOutcome(4, 10, 2, 50);
  assert.equal(low.point, 'Estimate vs measured: 2.5× too low');
  const near = S.revealOutcome(1001, 1000, 500, 2000);
  assert.equal(near.point, 'Estimate vs measured: within 1%');
  assert.match(near.text, /^Inside the likely range\. Estimate 1,001 vs measured 1,000: 0\.1% over\.$/);
  const mid = S.revealOutcome(1300, 1000, 500, 2000);
  assert.equal(mid.point, 'Estimate vs measured: 30% too high');
  const missed = S.revealOutcome(100, 300, 50, 200);
  assert.equal(missed.kind, 'missed');
  assert.equal(missed.range, 'Likely range: missed it');
  assert.match(missed.text, /^Missed: Aqua measured 300, above the likely range 50–200\.$/);
  assert.match(S.revealOutcome(100, 10, 50, 200).text, /below the likely range/);
  const gap = S.revealOutcome(100, null, 50, 200);
  assert.equal(gap.kind, 'gap');
  assert.equal(gap.text, 'Can’t be checked: Aqua has no usable value this month.');
  const zero = S.revealOutcome(3, 0, 0, 7);
  assert.match(zero.point, /no detections reported/);
  for (const o of [far, low, near, mid, missed, gap, zero]) {
    for (const t of [o.text, o.point, o.range]) { assert.ok(!/^Close/.test(t), t); assert.deepEqual(S.bannedIn(t), [], t); }
  }
  assert.equal(S.isMiss(30, 10, 5, 50), true, 'more than 2x off is a miss even inside the range');
  assert.equal(S.isMiss(100, 300, 50, 200), true);
  assert.equal(S.isMiss(1001, 1000, 500, 2000), false);
  assert.equal(S.isMiss(1, null, 0, 2), false, 'a gap is not a miss');
});

// ---------- plain metric: computed from validation.rows ----------

test('plain metric: every number is recomputed from validation rows (pooled core + control, primary day/night)', { skip: !hasReal }, () => {
  const { m, v, rec } = real();
  const pooled = new Set(m.regions.filter(core.isPooledRegion).map((r) => r.id));
  const clim = S.climatologyMethod(m.methods);
  const score = (id) => {
    const rows = v.rows.filter((r) => r.method_id === id && r.stratum === 'held_out' && r.daynight === v.daynight && r.actual_status === 'observed' && r.actual > 0 && pooled.has(r.region_id));
    const p = rows.map((r) => Math.abs(r.predicted - r.actual) / r.actual).sort((a, b) => a - b);
    const k = Math.floor(p.length / 2);
    const med = p.length % 2 ? p[k] : (p[k - 1] + p[k]) / 2;
    return { n: rows.length, med, w25: p.filter((x) => x <= 0.25).length, w2: rows.filter((r) => Math.max(r.predicted, r.actual) / Math.min(r.predicted, r.actual) <= 2).length, regions: new Set(rows.map((r) => r.region_id)).size };
  };
  const ours = score(rec); const guess = score(clim);
  const pm = S.plainMetric(m, v, rec);
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
  assert.equal(pm.text, `Across ${ours.n} hidden test months in ${words[ours.regions]} regions, half of our estimates were within ${Math.round(ours.med * 100)}% of what Aqua measured (guessing the usual month: half within ${Math.round(guess.med * 100)}%). ${ours.w25} of ${ours.n} were within 25%.`);
  assert.ok(pm.detail.startsWith(`${ours.w2} of ${ours.n} were within a factor of 2.`), pm.detail);
  assert.ok(pm.detail.includes(`${guess.w25} of ${guess.n} within 25%, ${guess.w2} within a factor of 2`), pm.detail);
  assert.equal(pm.label, S.PLAIN_METRIC_LABEL); assert.match(pm.label, /^Descriptive summary of stored test predictions, not the pre-registered score/);
  assert.match(pm.definitions, /\|estimate − measured\| ÷ measured/);
  // the stretch region only on a second, labelled line
  const stretch = m.regions.filter((r) => !pooled.has(r.id) && ['validated', 'provisional'].includes(r.status));
  if (stretch.length) { assert.match(pm.stretchLine, /stretch region, still provisional/); assert.ok(!pm.text.includes(S.shortName(stretch[0].name))); }
  assert.deepEqual(S.bannedIn([pm.text, pm.detail, pm.stretchLine || ''].join(' ')), []);
  // the old log-metric percentage is gone from the plain story and the glossary
  const t = S.trustStory(m, v, rec);
  assert.ok(!/typically off/i.test(Object.values(t).filter((x) => typeof x === 'string').join(' ')));
  assert.equal(typeof S.typicalError, 'undefined', 'typicalError (exp(MAE) − 1) is removed');
  assert.ok(!S.glossary({}).some((g) => /Typical error|exp\(mean/.test(`${g.term} ${g.precise}`)));
});

// ---------- which test decides; strata; no "to 2021" / "after 2019" ----------

test('trust story: primary vs secondary strata, correct scope, drift coverage from data, years only from data', { skip: !hasReal }, () => {
  const { m, v, rec } = real();
  const t = S.trustStory(m, v, rec);
  const held = [...new Set(v.rows.filter((r) => r.stratum === 'held_out').map((r) => r.year))].sort();
  assert.match(t.answer, /^Partly/);
  assert.ok(t.answer.includes(`tested on hidden ${held.slice(0, -1).join(', ')} and ${held[held.length - 1]}`), t.answer);
  assert.match(t.answer, /method built from the other \d{4}–\d{4} years/);
  const all = Object.values(t).filter((x) => typeof x === 'string').join(' ');
  assert.ok(!/\bto (?:19|20)\d\d\b/.test(all), `no "to <year>": ${all}`);
  assert.ok(!/\bafter (?:19|20)\d\d\b/.test(all), `no "after <year>": ${all}`);
  assert.ok(!/Not tested:/.test(all));
  assert.match(t.primary, /^The test that decides: daytime, /);
  assert.match(t.secondary, /^Two extra checks that cannot change the decision: night-time/);
  assert.match(t.notTested, /^Not part of the deciding test: night-time, /);
  assert.match(t.notTested, /anything after MODIS ends\.$/);
  // drift coverage and bar recomputed from validation
  const cov = v.summary.find((s) => s.method_id === rec && s.stratum === 'drift' && s.region_id === 'all' && s.season === 'all' && s.metric === 'interval_coverage' && s.interval_level === v.interval_level);
  const bar = v.decision.criteria.find((c) => c.metric === 'interval_coverage' && c.interval_level === v.interval_level).threshold;
  const driftYears = [...new Set(v.rows.filter((r) => r.stratum === 'drift').map((r) => r.year))].sort();
  assert.ok(t.notTested.includes(`${driftYears[0]}–${driftYears[driftYears.length - 1]}`), t.notTested);
  if (cov.value < bar) assert.ok(t.notTested.includes(`only ${Math.round(cov.value * 100)}% of months there, below the ${Math.round(bar * 100)}% bar`), t.notTested);
  // year-literal rule on output: every year printed is a year present in the data
  const dataYears = new Set([...v.rows.map((r) => r.year), ...m.regions.flatMap((r) => [...(r.trained_on_years || []), ...(r.held_out_years || [])]), ...m.eras.map((e) => core.yearOf(e.start))]);
  for (const y of yearsIn(all)) assert.ok(dataYears.has(y), `year ${y} is not from data`);
  assert.deepEqual(S.bannedIn(all), [], all);
});

// ---------- record end, zero wording, present tense ----------

test('record stamp comes from data; zero reads "no detections reported"; present-tense "this year" is banned', { skip: !hasReal }, () => {
  const { m } = real();
  const sp = S.recordSpan(m);
  const start = m.eras.map((e) => e.start).sort()[0];
  const end = m.regions.map((r) => r.latest_month).sort().slice(-1)[0];
  assert.equal(sp.stamp, `Record: ${core.monthLabel(start)} – ${core.monthLabel(end)} · not real-time`);
  const aqua = m.eras.find((e) => e.id === 'modis_only').start;
  assert.equal(sp.long, `Record: ${core.monthLabel(start)} – ${core.monthLabel(end)} (Aqua from ${core.monthLabel(aqua)}), FIRMS standard archive. Not real-time.`);
  assert.equal(S.countWords(0), 'no detections reported');
  assert.equal(S.countWords(1), '1 detection');
  for (const bad of ['no fires here', '0 fires', 'how this year compares', 'the conversion never saw it', 'typically off by about 26%']) assert.ok(S.bannedIn(bad).length, bad);
  assert.deepEqual(S.bannedIn('This year was hidden; neighbouring years were used to build the conversion.'), [], 'the QA-required wording is allowed');
});

test('site sources: no "Each mark is a detection", no "this year compares", no "burns" band caption; map legend reads day/night from data', () => {
  const dir = path.join(ROOT, 'site/js');
  // story.js's BANNED list names the phrases it forbids; it is not copy, so it is removed before the scan
  const src = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(path.join(dir, f), 'utf8').replace(/export const BANNED = \[[\s\S]*?\];/, '')]));
  const html = readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  for (const [f, t] of [...Object.entries(src), ['index.html', html]]) {
    assert.ok(!/Each mark is a/i.test(t), `${f}: "Each mark is ..."`);
    assert.ok(!/how this year compares|this year compares/i.test(t), `${f}: present-tense "this year"`);
    assert.ok(!/latitude band burns/i.test(t), f);
    assert.ok(!/never saw it/i.test(t), f);
    assert.ok(!/1 km satellite pixel/i.test(t), f);
    assert.ok(!/Close: Aqua/.test(t), f);
  }
  assert.match(src['stage.js'], /When each latitude band/);
  assert.match(src['monthly.js'], /bm\.daynight : belt\.daynight/, 'the map legend states day/night from the layer, never assumed');
  assert.match(src['region.js'], /detections per month inside this box/);
  assert.match(html, /importmap[\s\S]*twosat\.js\?v=/);
  assert.match(html, /importmap[\s\S]*season\.js\?v=/);
});

test('season sentence names daytime; drift-year verdicts lead with "unconfirmed"', () => {
  const ent = [1, 1, 1, 10, 9, 1, 1, 1, 1, 10, 9, 1].map((v, i) => ({ month: i + 1, p50: v }));
  assert.match(S.seasonSentence('X', ent, 'A–B', { aquaFrom: 7 }, 'D').text, /measured by Aqua \(NASA’s older satellite, measuring since 7\) in daytime\.$/);
  const eras = [{ id: 'aqua_drift', start: '2022-01', end: null }];
  const row = { month: '2025-12', era: 'aqua_drift', quality: ['aqua_drift'], record: { source: 'observed_aqua', value: 5 }, native: { aqua: { status: 'observed', n: 5 } } };
  assert.equal(S.monthSentence(row, { verdict: 'within', period: 'P', region: { status: 'validated' }, eras }).lead, 'unconfirmed: within usual');
});

// ---------- guided reveal: months from data by role, verified ----------

test('guided picks resolve from data and fit their roles (success, a miss the range caught, a gap that is not a test)', { skip: !hasReal }, () => {
  const { m, v } = real();
  const region = m.regions.find((r) => r.id === S.GUIDED.region);
  assert.ok(region, 'the guided region exists');
  const series = read(path.join(REAL, region.series_path));
  const rows = v.rows.filter((r) => r.method_id === region.method);
  const p = S.guidedPicks(region, rows, series.months);
  const inside = (r) => r.actual >= r.lo && r.actual <= r.hi;
  assert.ok(inside(p.success.row) && S.pctError(p.success.row.predicted, p.success.row.actual) <= 0.1, 'success is close and caught');
  assert.ok(inside(p.miss.row) && S.foldRatio(p.miss.row.predicted, p.miss.row.actual) > 2, 'miss is caught but more than 2x off');
  const g = series.months.find((r) => r.month === p.gap.month);
  assert.ok(region.trained_on_years.includes(core.yearOf(g.month)), 'gap month is a training year: not a test');
  assert.notEqual(core.nativeStatus(g, 'aqua'), 'observed');
  assert.ok(core.isViirsDerived(g));
  assert.ok(!rows.some((r) => r.month === g.month && r.stratum === 'held_out'), 'the gap is never scored');
  // the agreed picks are the ones used (not the fallback rule) for the current data
  assert.equal(p.success.how, 'agreed pick'); assert.equal(p.miss.how, 'agreed pick');
  assert.deepEqual([p.success.month, p.miss.month, p.gap.month], ['2019-11', '2013-01', '2020-08'], 'the three months agreed in SPEC decision 5');
  // the miss note names what came closer, from rows
  const card = core.revealCards(v).find((c) => c.region_id === region.id && c.month === p.miss.month && c.stratum === 'held_out');
  const note = S.closerThanOurs(card, region.method, (id) => id);
  const ours = card.methods.find((x) => x.method_id === region.method);
  for (const x of card.methods.filter((x) => x !== ours)) {
    const closer = Math.abs(x.predicted - card.actual) < Math.abs(ours.predicted - card.actual);
    assert.equal(note.includes(x.method_id), closer, x.method_id);
  }
  const med = S.regionMedians(v, region.method);
  const sn = S.successNote(region.id, 'R', med, null);
  assert.match(sn, /^One example, not typical\./);
  if ([...med.values()].every((x) => x >= med.get(region.id))) assert.ok(sn.includes(`half within ${Math.round(med.get(region.id) * 100)}%`));
});

test('guided picks fall back to a stated rule when the agreed month no longer fits its role', () => {
  const region = { id: 'r', held_out_years: [1, 2], trained_on_years: [3] };
  const mk = (month, predicted, actual, lo, hi) => ({ region_id: 'r', stratum: 'held_out', actual_status: 'observed', month, predicted, actual, lo, hi });
  const rows = [mk('0002-11', 500, 100, 50, 900), mk('0001-05', 101, 100, 50, 200), mk('0001-01', 90, 100, 80, 120), mk('0002-03', 400, 100, 50, 500)];
  const p = S.guidedPicks(region, rows, []);
  assert.equal(p.success.month, '0001-05'); assert.match(p.success.how, /^rule/);
  assert.equal(p.miss.month, '0002-11'); assert.match(p.miss.how, /^rule/);
  assert.equal(p.gap, null);
});

// ---------- two satellites: fixed log axis, zero stub, gap handling ----------

test('two-satellite helpers: fixed per-region log domain, zero on its own stub, gap and explore-only handled', { skip: !hasReal }, () => {
  const { m } = real();
  const region = m.regions.find((r) => r.id === S.GUIDED.region);
  const series = read(path.join(REAL, region.series_path));
  const d = T.twoSatDomain(series.months, region.method);
  assert.ok(Math.log10(d[0]) % 1 === 0 && Math.log10(d[1]) % 1 === 0, 'domain ends are powers of ten');
  let max = 0; let min = Infinity;
  for (const r of series.months) for (const p of ['aqua', 'snpp', 'noaa20', 'noaa21']) { const n = core.nativeN(r, p); if (n > 0) { max = Math.max(max, n); min = Math.min(min, n); } }
  assert.ok(d[1] >= max && d[0] <= min, 'every count fits the fixed axis');
  assert.equal(T.logPos(0, d), T.ZERO_STUB / 2, 'zero sits on the stub, not on the log axis');
  assert.ok(T.logPos(d[0], d) > T.ZERO_STUB, 'the smallest positive value is right of the stub');
  assert.ok(T.logPos(d[1] * 10, d) <= 100, 'clamped');
  assert.equal(T.logPos(null, d), null);
  const { env } = core.envelopeFor(series, m.eras);
  const gapRow = series.months.find((r) => core.nativeStatus(r, 'aqua') === 'excluded' && core.isViirsDerived(r));
  const g = T.twoSatModel(gapRow, { method: region.method, env, region, eras: m.eras });
  assert.equal(g.aqua.n, null, 'no measurement is null, never zero');
  assert.ok(g.est && g.viirs.n > 0 && g.usual);
  assert.ok(T.twoSatAvailable(g, region));
  assert.equal(T.twoSatAvailable(g, { ...region, status: 'explore_only' }), false, 'never shown for explore-only regions');
  const zeroRow = series.months.find((r) => core.nativeStatus(r, 'aqua') === 'observed' && core.nativeN(r, 'aqua') === 0);
  if (zeroRow) assert.equal(T.twoSatModel(zeroRow, { method: region.method, env, region }).aqua.n, 0, 'an observed zero stays a zero');
  assert.match(T.WHY_LINE, /finer pixels pick up smaller and more hot spots/);
  assert.deepEqual(S.bannedIn(T.WHY_LINE), []);
});

// ---------- calendar keyboard: Home/End use the row's own months (regression for region.js Home/End) ----------

test('calendarMove: Home/End stay in the row and use its months; up/down clamp at partial rows', () => {
  const months = [];
  for (let y = 2000; y <= 2002; y += 1) for (let i = 1; i <= 12; i += 1) { const mm = `${y}-${String(i).padStart(2, '0')}`; if (mm >= '2000-11' && mm <= '2002-03') months.push(mm); }
  // the old bug: Home on Jan of the first full year jumped to the record's first month (Nov of the year before)
  assert.equal(core.calendarMove(months, '2001-01', 'Home'), '2001-01');
  assert.equal(core.calendarMove(months, '2001-07', 'Home'), '2001-01');
  assert.equal(core.calendarMove(months, '2001-07', 'End'), '2001-12');
  assert.equal(core.calendarMove(months, '2000-12', 'Home'), '2000-11', 'partial first row');
  assert.equal(core.calendarMove(months, '2000-11', 'End'), '2000-12');
  assert.equal(core.calendarMove(months, '2002-01', 'End'), '2002-03', 'partial last row');
  assert.equal(core.calendarMove(months, '2001-03', 'ArrowUp'), '2000-11', 'clamped to the nearest month of a partial row');
  assert.equal(core.calendarMove(months, '2001-11', 'ArrowDown'), '2002-03');
  assert.equal(core.calendarMove(months, '2001-05', 'PageDown'), '2002-03');
  assert.equal(core.calendarMove(months, '2000-11', 'ArrowLeft'), '2000-11', 'stays at the start');
  assert.equal(core.calendarMove(months, '2000-12', 'ArrowRight'), '2001-01');
  assert.equal(core.calendarMove(months, '2001-01', 'x'), null);
  if (hasReal) {
    const { m } = real();
    for (const r of m.regions) {
      const ms = read(path.join(REAL, r.series_path)).months.map((x) => x.month);
      for (const cur of ms) {
        const h = core.calendarMove(ms, cur, 'Home'); const e = core.calendarMove(ms, cur, 'End');
        assert.equal(core.yearOf(h), core.yearOf(cur)); assert.equal(core.yearOf(e), core.yearOf(cur));
      }
    }
  }
  assert.equal(core.latestCompleteYear(months.map((month) => ({ month }))), 2001);
});
