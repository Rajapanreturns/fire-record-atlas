// M4.5 steps 3–4: one generalised Time Machine for all nine regions (machine.js reads trustcase.js RegionCases only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as TC from '../../site/js/trustcase.js';
import * as MC from '../../site/js/machine.js';
import * as S from '../../site/js/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = path.join(ROOT, 'site/data');
const hasReal = existsSync(path.join(REAL, 'manifest.json'));
const read = (p) => JSON.parse(readFileSync(path.join(REAL, p), 'utf8'));
const man = hasReal ? read('manifest.json') : null;
const val = hasReal ? read('validation.json') : null;
const m2 = hasReal ? read('m2_validation.json') : null;
const seriesOf = (r) => read(r.series_path || `region/${r.id}/series.json`);
const caseOf = (id) => { const r = man.regions.find((x) => x.id === id); return TC.regionCase(id, { manifest: man, val, m2val: m2, series: r ? seriesOf(r) : null }); };
const baseline = JSON.parse(readFileSync(path.join(ROOT, 'tests/site/fixtures-m45-machine-baseline.json'), 'utf8'));

test('regression gate: SE Asia (and Zambia) model values and stage copy are identical to the M4.4 release', { skip: !hasReal }, () => {
  for (const [k, want] of Object.entries(baseline)) {
    const [id, month] = k.split('|');
    const rc = caseOf(id);
    const m = MC.machineModel(rc.months.find((t) => t.month === month), { withActual: true }); // stage-3 model = M4.4 model
    const got = { raw: m.raw, pred: m.pred, lo: m.lo, hi: m.hi, actual: m.actual, envLo: m.envLo, envHi: m.envHi, rawVerdict: m.rawVerdict, ratioTxt: m.ratioTxt, side: m.side, apart: m.apart, axisMax: m.axis.max, ticks: m.axis.ticks, year: m.year, mi: m.mi };
    assert.deepEqual(got, want.model, k);
    assert.deepEqual([1, 2, 3].map((s) => MC.machineCopy(m, s, { k: rc.k, n: rc.n }, rc.cfg, rc)), want.copy, k);
  }
  const se = caseOf('se_asia_mainland');
  assert.equal(se.example.month, '2021-03'); assert.equal(se.k, 40); assert.equal(se.n, 43);
});

test('all nine regions build a case with their own satellite; S-NPP copy is D2/Q3 verbatim, years from data', { skip: !hasReal }, () => {
  for (const r of [...man.m2_regions, ...man.regions]) {
    const rc = caseOf(r.id);
    assert.ok(!rc.missing, r.id);
    const isM2 = man.m2_regions.includes(r);
    assert.equal(rc.cfg.lane1, isM2 ? 'NOAA-20, raw' : 'S-NPP, raw');
    assert.ok(rc.months.every((t) => t.satellite === (isM2 ? 'noaa20' : 'snpp')));
    const m = MC.machineModel(rc.months.find((t) => t.month === rc.example.month));
    const s1 = MC.machineCopy(m, 1, rc, rc.cfg, rc); const s2 = MC.machineCopy(m, 2, rc, rc.cfg, rc);
    if (!isM2) {
      assert.equal(s1.head, 'S-NPP, read raw.');
      assert.equal(s1.line, 'S-NPP and Aqua detect hotspots differently. Their raw counts aren’t directly comparable.');
      const ys = r.held_out_years.map(String);
      assert.equal(s2.line, `Ratio and range fitted on training years; ${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]} were hidden.`);
      assert.equal(MC.verdictCall(rc.months[0]), null, 'no verdict call is ever made for S-NPP');
      assert.doesNotMatch(`${s1.line} ${s2.line} ${rc.meta.meta}`, /NOAA-20/, 'never NOAA-20 wording for an S-NPP region');
    }
    for (const t of [s1, s2]) assert.deepEqual(S.bannedIn(`${t.head} ${t.line}`), []);
  }
  assert.equal(caseOf('punjab_haryana').months.find((t) => t.month === caseOf('punjab_haryana').example.month).month, '2013-03');
});

test('D3 + QA Q1: chip, satellite test and period always in the header; provisional reasons name every failing check', { skip: !hasReal }, () => {
  const meta = (id) => caseOf(id).meta;
  assert.equal(meta('se_asia_mainland').chip, '✓ Validated'); assert.match(meta('se_asia_mainland').meta, /^NOAA-20 test · April 2018 – December 2021 · 43 months$/);
  assert.equal(meta('punjab_haryana').chip, '◐ Provisional'); assert.match(meta('punjab_haryana').meta, /^S-NPP test · hidden years .* · 36 months$/);
  assert.deepEqual(meta('punjab_haryana').reasons, ['80% range: 26 of 36 inside; at least 75% required.']);
  assert.deepEqual(meta('car_sudanian').reasons, ['90% range: 28 of 36 inside; at least 85% required.', '80% range: 25 of 36 inside; at least 75% required.']);
  assert.match(meta('car_sudanian').meta, / · stretch region$/); assert.match(meta('iberia_control').meta, / · control$/); assert.match(meta('kazakh_steppe').meta, / · control$/);
  for (const id of ['n_australia_topend', 'iberia_control']) { assert.equal(meta(id).chip, '✓ Validated'); assert.deepEqual(meta(id).reasons, []); }
});

test('NOAA-20 verdict call: stored match only; Kazakh low-count months say "no call", never "didn’t match"', { skip: !hasReal }, () => {
  const kz = caseOf('kazakh_steppe').months;
  const none = kz.filter((t) => t.verdictPred === 'cant_tell');
  assert.equal(none.length, 11);
  for (const t of none) assert.equal(MC.verdictCall(t), 'Unusual-or-not call: no call (too few NOAA-20 detections)');
  const se = caseOf('se_asia_mainland').months.find((t) => t.month === '2021-03');
  assert.equal(MC.verdictCall(se), 'Unusual-or-not call: matched');
});

test('zeros: a stored 0 reads "none reported"; a missing value is never 0', { skip: !hasReal }, () => {
  const kz = caseOf('kazakh_steppe').months;
  for (const m of ['2018-12', '2019-01']) { const t = kz.find((x) => x.month === m); assert.equal(t.raw, 0); assert.equal(t.actual, 0); }
  assert.equal(MC.countText(0), '0'); assert.equal(MC.countText(null), '–');
  const src = readFileSync(path.join(ROOT, 'site/js/machine.js'), 'utf8');
  assert.match(src, /const zeroSub = \(v\) => \(v === 0 \? 'none reported' : null\);/);
});

test('S-NPP limits footer: regionLimits sentences verbatim; S-NPP-not-NOAA-20 always visible; provisional note for Punjab/CAR', { skip: !hasReal }, () => {
  const lim = (id) => TC.m1Limits(caseOf(id).facts, S.PROVISIONAL_NOTE);
  const t = readFileSync(path.join(ROOT, 'site/js/trust.js'), 'utf8');
  for (const id of ['punjab_haryana', 'car_sudanian', 'n_australia_topend', 'iberia_control']) {
    const l = lim(id);
    assert.equal(l.visible[0], 'Tested with S-NPP, not NOAA-20: the NOAA-20 conversion has not been independently validated in this region.');
    for (const x of [...l.visible, ...l.more].filter((y) => y !== S.PROVISIONAL_NOTE)) {
      const tmpl = x.replace(/From \d+ on/, 'From ${f.driftFrom || \'the drift years\'} on').replace('Tested with S-NPP,', 'Tested with ${satShort(f)},');
      assert.ok(t.includes(x) || t.includes(tmpl), `verbatim from regionLimits: ${x}`);
    }
    assert.equal(l.more.includes(S.PROVISIONAL_NOTE), caseOf(id).status === 'provisional');
  }
});
