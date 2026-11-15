// M4.5 step 2: trustcase.js adapters reconcile with the stored rows, value for value (not wired into the UI yet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as TC from '../../site/js/trustcase.js';
import { m1RegionCases, m2RegionCases } from '../../site/js/trustctx.js';
import { envelopeFor, monthIndex, nativeN } from '../../site/js/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = path.join(ROOT, 'site/data');
const hasReal = existsSync(path.join(REAL, 'manifest.json'));
const read = (p) => JSON.parse(readFileSync(path.join(REAL, p), 'utf8'));
const man = hasReal ? read('manifest.json') : null;
const val = hasReal ? read('validation.json') : null;
const m2 = hasReal ? read('m2_validation.json') : null;
const seriesOf = (r) => read(r.series_path || `region/${r.id}/series.json`);

function allMonths() {
  const out = new Map();
  for (const r of man.m2_regions) out.set(r.id, TC.m2TestMonths(m2, r.id));
  for (const r of man.regions) out.set(r.id, TC.m1TestMonths(val, r, seriesOf(r), man.eras));
  return out;
}

test('359 test months: 215 NOAA-20 + 144 S-NPP, every field equal to its source row', { skip: !hasReal }, () => {
  const all = allMonths();
  let n2 = 0; let n1 = 0;
  for (const r of man.m2_regions) {
    const src = m2.month_rows.filter((x) => x.region_id === r.id && x.actual != null);
    const got = all.get(r.id);
    assert.equal(got.length, src.length, r.id);
    got.forEach((t, i) => {
      const s = src[i];
      assert.deepEqual([t.month, t.raw, t.est, t.lo, t.hi, t.actual, t.envLo, t.envHi, t.rawVerdict, t.inside], [s.month, s.noaa20_raw, s.pred, s.lo90, s.hi90, s.actual, s.env_p10, s.env_p90, s.q4_naive, s.inside90], `${r.id} ${s.month}`);
      assert.equal(t.side, s.inside90 ? 'inside' : s.actual > s.hi90 ? 'above' : 'below');
      assert.equal(t.verdictMatch, s.q4_n20 === 'cant_tell' || s.q4_truth === 'cant_tell' ? null : s.q4_n20 === s.q4_truth);
      assert.equal(t.level, 0.9); assert.equal(t.fitNote, 'm2_loyo');
      assert.deepEqual(t.provenance.key, { region_id: r.id, month: s.month });
    });
    n2 += got.length;
  }
  for (const r of man.regions) {
    const ser = seriesOf(r); const { env, minYears } = envelopeFor(ser, man.eras);
    const src = val.rows.filter((x) => x.region_id === r.id && x.method_id === r.method && x.stratum === 'held_out' && x.daynight === val.daynight && x.actual_status === 'observed' && x.actual != null);
    const got = all.get(r.id);
    assert.equal(got.length, src.length, r.id); assert.equal(got.length, 36, r.id);
    got.forEach((t, i) => {
      const s = src[i]; const row = ser.months.find((m) => m.month === s.month); const e = env[monthIndex(s.month)];
      assert.deepEqual([t.month, t.est, t.lo, t.hi, t.actual, t.inside, t.level], [s.month, s.predicted, s.lo, s.hi, s.actual, s.inside_interval, s.interval_level], `${r.id} ${s.month}`);
      assert.equal(t.raw, nativeN(row, s.input_platform), 'raw = the series count of the tested satellite');
      assert.deepEqual([t.envLo, t.envHi], e.n_years >= minYears ? [e.p10, e.p90] : [null, null], 'usual band by the region page rule');
      assert.equal(t.rawVerdict, null, 'no raw verdict is stored for S-NPP, so none is made');
      assert.equal(t.verdictMatch, null);
      assert.equal(t.fitNote, 'm1_training_years');
      assert.equal(t.provenance.key.month, s.month); assert.equal(t.provenance.key.method_id, r.method);
    });
    n1 += got.length;
  }
  assert.equal(n2, 215); assert.equal(n1, 144); assert.equal(n1 + n2, 359);
});

test('each region uses ONLY the satellite it was tested with; raw comes from that satellite', { skip: !hasReal }, () => {
  const all = allMonths();
  for (const r of man.m2_regions) for (const t of all.get(r.id)) assert.equal(t.satellite, 'noaa20', r.id);
  for (const r of man.regions) {
    const plats = new Set(val.rows.filter((x) => x.region_id === r.id && x.stratum === 'held_out' && x.method_id === r.method).map((x) => x.input_platform));
    assert.deepEqual([...plats], ['snpp']);
    for (const t of all.get(r.id)) { assert.equal(t.satellite, 'snpp'); assert.ok(t.raw > 0, `${r.id} ${t.month}: observed S-NPP count`); }
  }
});

test('only held-out, record-method, Aqua-observed months: no drift, training, gap or unobserved rows', { skip: !hasReal }, () => {
  const all = allMonths();
  for (const r of man.regions) {
    const held = new Set(r.held_out_years); const train = new Set(r.trained_on_years);
    for (const t of all.get(r.id)) {
      assert.ok(held.has(t.year) && !train.has(t.year), `${r.id} ${t.month}: a hidden year`);
      const srcs = val.rows.filter((x) => x.region_id === r.id && x.month === t.month && x.method_id === r.method);
      assert.ok(srcs.every((x) => x.stratum === 'held_out'), 'never a drift-stratum row');
      assert.ok(t.actual != null && t.actual > 0);
    }
    const ser = seriesOf(r);
    for (const t of all.get(r.id)) assert.equal(ser.months.find((m) => m.month === t.month).record.source, 'observed_aqua', 'not a gap month');
  }
  for (const r of man.m2_regions) {
    const w = m2.window;
    for (const t of all.get(r.id)) { assert.ok(t.month >= w.start && t.month <= w.end); assert.ok(t.actual != null); }
  }
});

test('example months and misses are exactly today’s rules (D1); rotation: example first, then all months in time order', { skip: !hasReal }, () => {
  const all = allMonths();
  const se = TC.regionTest(man, val, m2, 'se_asia_mainland', all.get('se_asia_mainland'));
  assert.equal(se.example.month, '2021-03');
  assert.equal(se.rotation[0], '2021-03'); assert.equal(se.rotation[1], se.preLocked, 'then the pre-locked opening month (today’s "another month")');
  for (const r of man.m2_regions) {
    const t = TC.regionTest(man, val, m2, r.id, all.get(r.id)); const c = m2RegionCases(m2, r.id);
    assert.equal(t.example.month, c.success.row.month); assert.equal(t.miss && t.miss.month, c.miss && c.miss.row.month);
    assert.equal(t.rotation.length, all.get(r.id).length); assert.equal(new Set(t.rotation).size, t.rotation.length);
    const rest = t.rotation.slice(t.preLocked && t.preLocked !== t.example.month ? 2 : 1);
    assert.deepEqual(rest, [...rest].sort(), 'time order, no outcome filter');
    assert.equal(t.satellite, 'noaa20'); assert.equal(t.test, 'm2');
    assert.equal(t.k, m2.regions.find((g) => g.region_id === r.id).cov90_covered);
  }
  for (const r of man.regions) {
    const t = TC.regionTest(man, val, m2, r.id, all.get(r.id)); const c = m1RegionCases(val, r);
    assert.equal(t.example.month, c.success.row.month); assert.equal(t.miss && t.miss.month, c.miss && c.miss.row.month);
    assert.equal(t.rotation[0], c.success.row.month); assert.deepEqual(t.rotation.slice(1), [...t.rotation.slice(1)].sort());
    assert.equal(t.rotation.length, 36); assert.equal(t.preLocked, null);
    assert.equal(t.satellite, 'snpp'); assert.equal(t.test, 'm1'); assert.equal(t.status, r.status);
    assert.equal(t.k, all.get(r.id).filter((x) => x.inside).length);
  }
  const statuses = Object.fromEntries([...man.regions, ...man.m2_regions].map((r) => [r.id, TC.regionTest(man, val, m2, r.id, all.get(r.id)).status]));
  assert.equal(statuses.punjab_haryana, 'provisional'); assert.equal(statuses.car_sudanian, 'provisional');
  assert.equal(TC.regionTest(man, val, m2, 'car_sudanian', all.get('car_sudanian')).role, 'stretch');
  assert.equal(TC.regionTest(man, val, m2, 'iberia_control', all.get('iberia_control')).role, 'control');
  assert.equal(TC.regionTest(man, val, m2, 'kazakh_steppe', all.get('kazakh_steppe')).role, 'control');
});

test('missing values stay null, never 0', () => {
  const m2fake = { method: { predictor_platform: 'noaa20' }, month_rows: [{ region_id: 'x', month: '2019-05', actual: 3, noaa20_raw: null, pred: undefined, lo90: null, hi90: null, env_p10: null, env_p90: null, inside90: null, q4_n20: 'cant_tell', q4_truth: 'within' }] };
  const [t] = TC.m2TestMonths(m2fake, 'x');
  for (const k of ['raw', 'est', 'lo', 'hi', 'envLo', 'envHi', 'inside', 'verdictMatch', 'rawVerdict']) assert.equal(t[k], null, k);
  assert.equal(t.side, 'unknown');
  const region = { id: 'y', method: 'aqua_equiv_ratio' };
  const valFake = { daynight: 'D', rows: [{ region_id: 'y', method_id: 'aqua_equiv_ratio', stratum: 'held_out', daynight: 'D', input_platform: 'snpp', interval_level: 0.9, month: '2016-07', predicted: 5, lo: null, hi: null, actual: 4, actual_status: 'observed', inside_interval: null }] };
  const seriesFake = { months: [{ month: '2016-07', native: { snpp: { status: 'not_observed', n: null } } }] };
  const [u] = TC.m1TestMonths(valFake, region, seriesFake, []);
  assert.equal(u.raw, null, 'an unobserved S-NPP month has no raw count, not 0');
  assert.equal(u.lo, null); assert.equal(u.envLo, null); assert.equal(u.side, 'unknown');
  const [v] = TC.m1TestMonths(valFake, region, null, []);
  assert.equal(v.raw, null); assert.equal(v.envLo, null);
});

test('trustcase.js is pure: no DOM, no fetch, no year literals (M4.5 step 3: now the machine’s only data source)', () => {
  const s = readFileSync(path.join(ROOT, 'site/js/trustcase.js'), 'utf8');
  assert.doesNotMatch(s, /document\.|window\.|fetch\(|from '\.\/ui\.js'|from '\.\/data\.js'/);
  assert.deepEqual(s.match(/['"`\s(=]((19|20)\d\d)\b/g) || [], []);
  const mj = readFileSync(path.join(ROOT, 'site/js/machine.js'), 'utf8');
  assert.doesNotMatch(mj, /month_rows|noaa20_raw|loadSeries|validation\.json/, 'the machine never reads a test’s files');
  assert.doesNotMatch(mj, /test === 'm1'/, 'no satellite branches in the view; the config decides');
});

test('S-NPP join guard: the series’ stored estimate equals the validation row for every S-NPP test month; band = stored baseline', { skip: !hasReal }, () => {
  for (const r of man.regions) {
    const ser = seriesOf(r);
    for (const t of TC.m1TestMonths(val, r, ser)) {
      const row = ser.months.find((m) => m.month === t.month);
      assert.equal(row.modelled[r.method].value, t.est, `${r.id} ${t.month}`);
      const e = ser.baseline.entries.find((x) => x.month === t.mi + 1);
      assert.deepEqual([t.envLo, t.envHi], [e.p10, e.p90]);
    }
  }
});
