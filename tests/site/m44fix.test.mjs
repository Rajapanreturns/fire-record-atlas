// M4.4 Phase 1 site corrections (docs/m44/IMPLEMENTATION.md §Phase 1). Run: node --test tests/site/*.mjs
// UI-01: "Aqua only" shows measured Aqua only; stored gap estimates stay reachable on the labelled VIIRS layer.
// SQ-02, SQ-01, UI-03/SQ-10, UI-05/GD-07, SQ-03, SQ-04, SQ-09, SQ-11, ML-01, GD-10: wording and labelling only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../../site/js/core.js';
import * as P from '../../site/js/periods.js';
import * as S from '../../site/js/story.js';
import * as H from '../../site/js/hero.js';
import * as M2 from '../../site/js/m2.js';
import * as T from '../../site/js/trustctx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = path.join(ROOT, 'site/data');
const hasReal = existsSync(path.join(REAL, 'manifest.json'));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const src = (f) => readFileSync(path.join(ROOT, 'site/js', f), 'utf8');
const man = hasReal ? read(path.join(REAL, 'manifest.json')) : null;
const seriesOf = (id) => read(path.join(REAL, `region/${id}/series.json`));
const M1 = hasReal ? man.regions : [];
const M2R = hasReal ? man.m2_regions || [] : [];
const FILLED = new Set(['modelled_from_viirs', 'blended']);

test('UI-01: aquaOnlyMonths leaves no VIIRS-derived value in the record slot and keeps the stored estimate', { skip: !hasReal }, () => {
  let filled = 0;
  for (const reg of [...M1, ...M2R]) {
    const s = seriesOf(reg.id);
    const before = JSON.stringify(s.months);
    const out = core.aquaOnlyMonths(s.months);
    assert.equal(JSON.stringify(s.months), before, `${reg.id}: the stored rows are not mutated`);
    assert.equal(out.length, s.months.length);
    out.forEach((r, i) => {
      const orig = s.months[i];
      assert.ok(!FILLED.has(r.record.source), `${reg.id} ${r.month}: no VIIRS-derived record`);
      if (!FILLED.has(orig.record.source)) { assert.equal(r, orig, 'observed / missing rows are passed through unchanged'); return; }
      filled += 1;
      assert.equal(r.record.source, 'not_observed'); assert.equal(r.record.value, null);
      assert.equal(core.rulerValue(r, 'record').value, null);
      assert.equal(core.monthVerdict(r, 'record', core.envelopeFor(s, man.eras).env).cls, 'none', 'a filled month is "not observed", never judged');
      assert.deepEqual({ ...r.gap_estimate, stored_verdict: undefined }, { ...orig.record, stored_verdict: undefined }, 'the stored estimate is kept, value for value');
      assert.equal(r.gap_estimate.value, orig.record.value);
      assert.deepEqual(r.modelled, orig.modelled, 'modelled lanes kept');
    });
  }
  // 4 S-NPP regions x (2020 outage Aug, Sep + drift-era Apr) in the stored data; NOAA-20 areas store none
  assert.equal(filled, 12);
  for (const reg of M2R) assert.ok(seriesOf(reg.id).months.every((r) => !FILLED.has(r.record.source)), `${reg.id} stores no filled month`);
});

test('UI-01: verdicts, tallies and the "stood out" timeline treat filled months as not measured; findings unchanged', { skip: !hasReal }, () => {
  const expect = { // confirmed (pre-drift) timeline counts after the fix; before: uncertain 1/1/1/2, below N Australia 14
    punjab_haryana: { above: 28, below: 25, uncertain: 0 }, n_australia_topend: { above: 30, below: 13, uncertain: 0 },
    iberia_control: { above: 10, below: 44, uncertain: 0 }, car_sudanian: { above: 15, below: 23, uncertain: 0 },
  };
  for (const reg of M1) {
    const s = seriesOf(reg.id); const { env, minYears } = core.envelopeFor(s, man.eras);
    const base = core.baselinePeriodLabel(s, env);
    const ms = core.aquaOnlyMonths(s.months);
    const t = P.unusualTimeline(ms, env, reg.status);
    assert.ok(t.unusual.every((u) => u.kind.key !== 'estimated'), `${reg.id}: no estimate in the timeline`);
    if (expect[reg.id]) assert.deepEqual(t.counts, expect[reg.id], reg.id);
    for (const r of ms.filter((x) => x.gap_estimate)) {
      const tl = t.rows.flatMap((row) => row.cells).find((c) => c && c.r.month === r.month);
      assert.equal(tl.state, 'missing', `${reg.id} ${r.month} is drawn as missing`);
    }
    // findings: season and the recurring screen were measured-only before and stay identical
    const a = P.findings({ months: s.months, env, minYears, baseLabel: base });
    const b = P.findings({ months: ms, env, minYears, baseLabel: base });
    assert.deepEqual(b.season, a.season); assert.deepEqual(b.recurringLine, a.recurringLine);
    assert.deepEqual(P.recurringAbove(ms, env).months, P.recurringAbove(s.months, env).months);
  }
  // the three filled months whose stored verdict was decisive now have none
  const vd = (id, m) => { const s = seriesOf(id); const env = core.envelopeFor(s, man.eras).env; return core.monthVerdict(core.aquaOnlyMonths(s.months).find((r) => r.month === m), 'record', env).cls; };
  const stored = (id, m) => seriesOf(id).months.find((r) => r.month === m).verdict.class;
  for (const [id, m, was] of [['punjab_haryana', '2020-08', 'within'], ['iberia_control', '2020-09', 'within'], ['n_australia_topend', '2020-09', 'below']]) {
    assert.equal(stored(id, m), was, 'the stored verdict is untouched in the file');
    assert.equal(vd(id, m), 'none');
  }
});

test('UI-01: gap estimates are labelled provisional / untested, never validated', { skip: !hasReal }, () => {
  for (const reg of M1) {
    for (const r of core.aquaOnlyMonths(seriesOf(reg.id).months).filter((x) => x.gap_estimate)) {
      const tag = S.gapEstimateTag(r, reg, man.eras);
      assert.doesNotMatch(tag, /(?<!never )validated/i, tag);
      if (reg.status === 'provisional') assert.match(tag, /provisional/, `${reg.id} ${r.month}`);
      if (S.isDriftMonth(r, man.eras)) assert.match(tag, /untested/, `${reg.id} ${r.month}`);
      assert.deepEqual(S.bannedIn(tag), []);
    }
  }
  const pj = core.aquaOnlyMonths(seriesOf('punjab_haryana').months).find((r) => r.month === '2020-09');
  assert.equal(pj.gap_estimate.value, 181.27); assert.equal(pj.gap_estimate.lo, 108.87); assert.equal(pj.gap_estimate.hi, 284.05);
  assert.equal(S.gapEstimateTag(pj, M1.find((r) => r.id === 'punjab_haryana'), man.eras), 'gap estimate: Aqua has no data · provisional conversion · not tested');
});

test('UI-01: the hero shows gap estimates only on the VIIRS layer, in their own class; the region page feeds it the Aqua-only months', () => {
  assert.equal(H.viirsClass({ gap: true, heldOut: false, train: true }), 'gap', 'an outage month in a training year is not "in-sample"');
  const keys = H.legendKeys({ year: 2020, vals: [{ value: null, kind: 'none' }], viirs: { classes: new Set(['gap']) } }).map(([k, t]) => [k, t]);
  assert.ok(keys.some(([k, t]) => k === 'v-gap' && /cannot be checked/.test(t) && !/\bvalidated\b/.test(t)));
  // a missing month is never labelled "Aqua + estimates"
  // chart simplification: the key names Aqua's line plainly; a missing month is never labelled as an estimate
  assert.equal(H.heroKeyItems({ year: 2020, baseLabel: 'B' })[0].text, 'Aqua measured, 2020');
  const region = src('region.js');
  assert.match(region, /const months = aquaOnlyMonths\(series\.months\);/);
  assert.match(region, /buildCsv\(series\)/, 'the CSV still exports the stored record with its record_source column');
  assert.doesNotMatch(region, /estimated from VIIRS where (marked|framed)/);
  assert.match(region, /data-gap': 'estimate'/, 'the month detail keeps the stored estimate reachable');
  assert.match(src('hero.js'), /return gap \? \{ \.\.\.m, gap: true \} : m;/);
});

test('SQ-02: S-NPP Trust pages say no skill was computed for the S-NPP test', () => {
  const t = src('trust.js');
  assert.match(t, /No skill against a simple guess was computed for the S-NPP record method/);
  assert.doesNotMatch(t, /No skill score was computed for the S-NPP test/);
  assert.doesNotMatch(t, /Skill is stored for all study areas together/);
  if (hasReal) {
    const val = read(path.join(REAL, 'validation.json')); const m2 = read(path.join(REAL, 'm2_validation.json'));
    for (const id of ['punjab_haryana', 'car_sudanian', 'n_australia_topend', 'iberia_control']) {
      const f = T.regionFacts(man, val, m2, id);
      assert.equal(f.test, 'm1'); assert.equal(f.skill.stored, false);
      assert.match(f.skill.why, /No skill against a simple guess was computed for the S-NPP record method/);
      assert.doesNotMatch(f.skill.why, /\d+\s*%/, 'no per-region (or borrowed) skill number');
    }
  }
});

test('SQ-01: each season rule is named by its purpose; neither calculation changed', () => {
  assert.match(M2.seasonDefinition('B'), /^Main burning season: the busiest calendar months that together hold at least 80% of the area’s Aqua B detections, ranked by their mean \(the pre-registered test season/);
  assert.equal(H.seasonRuns([9, 10], null).label(0.83), 'busiest months · 83%');
  const env = Array.from({ length: 12 }, (_, i) => ({ n_years: 9, p50: i === 8 ? 100 : 1 }));
  const fd = P.findings({ months: [], env, minYears: 5, baseLabel: 'B' });
  assert.ok(fd.notes.some((n) => /median-year rule/.test(n) && /pre-registered test season/.test(n)));
  assert.match(fd.season.sub, /median-year rule/);
  assert.deepEqual(P.mainSeason(env, 5).months, [8], 'the median rule itself is unchanged');
  assert.match(src('trustctx.js'), /months of the pre-registered test season and/);
});

test('UI-03 / SQ-10: the conversion divisor is named as this month’s, not one constant', () => {
  const d = src('decades.js');
  assert.doesNotMatch(d, /this area’s conversion factor'/);
  // M4.5: the demo that carried this label is retired; the Time Machine names the divisor as this month's, once, on the arrow
  assert.match(src('machine.js'), /÷\$\{m\.ratioTxt\} this month/);
});

test('UI-05 / GD-07: the home total is labelled a daytime multi-year total, not a yearly or per-area figure', () => {
  const s = src('stage.js');
  assert.match(s, /detections worldwide: \$\{S\.L\.nYears\}-year total, \$\{periodWords\(\)\} \(not per year\)/);
  assert.doesNotMatch(s, /Detections across all latitudes/);
  assert.doesNotMatch(s, /in the averaging period/);
  assert.match(s, /shares within a row, not amounts/);
});

test('SQ-03, SQ-04, SQ-11, ML-01, SQ-09: small wording corrections', () => {
  const a = src('advanced.js');
  assert.match(a, /leave-one-year-out/); assert.match(a, /the stored record here is observed Aqua only/);
  const t = src('trust.js');
  assert.doesNotMatch(t, /not yet published in the site data/);
  assert.match(t, /see Audit flags above/);
  assert.doesNotMatch(t, /Validated \(daytime\) · \$\{cov\.validated\.length\} study areas/);
  for (const f of ['stage.js', 'story.js', 'globe.js']) assert.doesNotMatch(src(f), /(tested|validated) across decades/, f);
  const g = S.glossary({ driftFrom: 2022 }).find((x) => x.term === 'Timing drift');
  assert.match(g.precise, /began drifting slowly before 2022; this site treats 2022 on as the drift era/);
  assert.match(src('timeline.js'), /orbit drift begins \$\{s\.drift\.date\}/);
  if (hasReal) {
    const m2 = read(path.join(REAL, 'm2_validation.json'));
    const cov = S.trustCoverage(man, m2);
    assert.equal(cov.validated.filter((r) => r.test === 'NOAA-20').length, 5);
    assert.equal(cov.validated.filter((r) => r.test === 'S-NPP').length, 2);
  }
});

test('GD-10: the map place card keeps the box’s conversion status inside a study box', () => {
  assert.equal(S.boxStatusWord({ id: 'x', status: 'provisional' }), 'VIIRS conversion provisional, not yet reliable');
  assert.equal(S.boxStatusWord({ id: 'x', status: 'validated' }), 'VIIRS conversion validated, S-NPP');
  assert.equal(S.boxStatusWord({ id: 'x', status: 'explore_only' }), 'no VIIRS conversion tested');
  if (hasReal) for (const r of M2R) assert.equal(S.boxStatusWord(r), 'VIIRS conversion validated, NOAA-20');
  assert.match(src('stage.js'), /\$\{near\.inside \? ` \(\$\{boxStatusWord\(near\.region\)\}\)` : ''\}/);
});

test('M4.4: new wording has no banned words or year literals; cache tag bumped', () => {
  for (const f of ['core.js', 'story.js', 'region.js', 'hero.js', 'trust.js', 'trustctx.js', 'stage.js', 'advanced.js', 'decades.js', 'timeline.js', 'periods.js', 'm2.js', 'globe.js']) {
    assert.deepEqual(src(f).match(/['"`\s(=]((19|20)\d\d)\b/g) || [], [], `${f}: year literals`);
  }
  for (const t of [M2.seasonDefinition('B'), S.glossary({ driftFrom: 2022 }).map((g) => g.precise).join(' '), S.boxStatusWord({ status: 'provisional' })]) assert.deepEqual(S.bannedIn(t), []);
  const html = readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  assert.doesNotMatch(html, /\?v=m43b/); assert.match(html, /\?v=m4[45][abcd]?"/); // m44a in Phase 1, m44 at the end of M4.4, m45 in M4.5
});
