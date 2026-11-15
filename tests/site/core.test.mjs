// Rendering-rule tests for the static site. Run: node --test tests/site/*.mjs
// They load the labelled fixtures (and real site/data files when present) and check the rules the UI relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../../site/js/core.js';
const core_ = core;
const coreRegion = core.isCoreRegion;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'site/data-fixtures');
const REAL = path.join(ROOT, 'site/data');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = read(path.join(FIX, 'manifest.json'));
const alpha = read(path.join(FIX, 'region/fixture-alpha/series.json'));
const control = read(path.join(FIX, 'region/fixture-control/series.json'));

function realSeries() {
  const out = [];
  if (!existsSync(path.join(REAL, 'manifest.json'))) return out;
  const m = read(path.join(REAL, 'manifest.json'));
  for (const r of m.regions) {
    const p = path.join(REAL, r.series_path || `region/${r.id}/series.json`);
    if (existsSync(p)) out.push({ manifest: m, series: read(p) });
  }
  return out;
}
const allSeries = [{ manifest, series: alpha }, { manifest, series: control }, ...realSeries()];

test('fixtures are fixtures (watermark rule input)', () => {
  for (const d of [manifest, alpha, control]) assert.ok(core.isFixtureDoc(d));
});

test('record styling follows record.source, never the calendar year', () => {
  for (const { series } of allSeries) {
    for (const r of series.months) {
      const v = core.rulerValue(r, 'record');
      const src = r.record.source;
      const expected = { observed_aqua: 'observed', modelled_from_viirs: 'modelled', blended: 'blended' }[src] || 'none';
      assert.equal(v.kind, expected, `${series.region_id} ${r.month}`);
      if (src === 'terra_only' || src === 'not_observed') assert.equal(v.value, null);
    }
  }
});

test('a record whose source switches at an arbitrary month is drawn by source', () => {
  // Synthetic: switch from observed Aqua to VIIRS-derived at a mid-year month that is not a "splice year".
  const months = alpha.months.map((r) => structuredClone(r));
  const k = months.findIndex((r) => r.month === '2017-03');
  for (let i = k; i < months.length; i += 1) {
    const m = months[i].modelled.aqua_equiv_operator;
    if (m.status === 'estimated') months[i].record = { source: 'modelled_from_viirs', value: m.value, lo: m.lo, hi: m.hi, method_id: m.method_id, lane: 'aqua_equiv_operator' };
  }
  assert.equal(core.rulerValue(months[k - 1], 'record').kind, months[k - 1].record.source === 'observed_aqua' ? 'observed' : core.rulerValue(months[k - 1], 'record').kind);
  assert.equal(core.rulerValue(months[k], 'record').kind, 'modelled');
});

test('raw native ruler never yields a verdict across instruments', () => {
  for (const { manifest: m, series } of allSeries) {
    const env = core.baselineEnvelope(series.months, m.eras);
    for (const r of series.months) {
      const v = core.rulerValue(r, 'raw');
      assert.equal(v.value, null);
      assert.equal(v.noVerdict, true);
      assert.ok(!['above', 'within', 'below'].includes(core.verdictFor(v, env[core.monthIndex(r.month)])), r.month);
    }
  }
});

test('observed Aqua months never change when the ruler switches', () => {
  for (const { manifest: m, series } of allSeries) {
    const env = core.baselineEnvelope(series.months, m.eras);
    for (const r of series.months.filter((x) => x.record.source === 'observed_aqua')) {
      assert.deepEqual(core.rulerValue(r, 'alt', 'aqua_equiv_operator'), core.rulerValue(r, 'record'), r.month);
      assert.deepEqual(core.rulerValue(r, 'alt', 'aqua_equiv_ratio'), core.rulerValue(r, 'record'), r.month);
      assert.equal(core.rulerValue(r, 'record').value, r.native.aqua.n, `record value equals native Aqua ${r.month}`);
    }
    const lanes = core.recordLanes(series.months, (m.regions.find((x) => x.id === series.region_id) || {}).method);
    const c = core.classChanges(series.months, env, 'alt', lanes.alt);
    assert.equal(c.observedChanged, 0);
    assert.equal(c.total, series.months.filter((x) => ['modelled_from_viirs', 'blended'].includes(x.record.source)).length);
    assert.ok(c.changed <= c.total);
  }
});

test('alternative ruler swaps VIIRS-derived months to the lane the record did not use', () => {
  const lanes = core.recordLanes(alpha.months, manifest.regions[0].method);
  assert.equal(lanes.record, 'aqua_equiv_operator');
  assert.equal(lanes.alt, 'aqua_equiv_ratio');
  const r = alpha.months.find((x) => x.record.source === 'modelled_from_viirs' && x.modelled.aqua_equiv_ratio.status === 'estimated');
  const v = core.rulerValue(r, 'alt', lanes.alt);
  assert.equal(v.lane, 'aqua_equiv_ratio');
  assert.equal(v.value, r.modelled.aqua_equiv_ratio.value);
  assert.equal(core.normalizeRuler('ratio'), 'alt');
  for (const { manifest: m, series } of allSeries) {
    const region = m.regions.find((x) => x.id === series.region_id);
    const l = core.recordLanes(series.months, region && region.method);
    for (const x of series.months.filter((y) => y.record.source === 'modelled_from_viirs')) assert.equal(x.record.lane, l.record, `${series.region_id} ${x.month} record lane`);
  }
});

test('exported baseline and verdicts are preferred (contract 1.1), browser rule agrees with them', () => {
  for (const { manifest: m, series } of allSeries) {
    const { env, source } = core.envelopeFor(series, m.eras);
    if (!series.baseline) { assert.equal(source, 'browser'); continue; }
    assert.equal(source, 'export');
    assert.equal(env[0].p90, series.baseline.entries.find((e) => e.month === 1).p90);
    const lanes = core.recordLanes(series.months, (m.regions.find((x) => x.id === series.region_id) || {}).method);
    for (const r of series.months.filter((x) => x.verdict)) {
      const mv = core.monthVerdict(r, 'record', env, lanes.alt);
      assert.equal(mv.source, 'export');
      const browser = core.verdictFor(core.rulerValue(r, 'record'), env[core.monthIndex(r.month)], series.baseline.min_years);
      const exported = { cant_tell: 'unknown' }[r.verdict.class] || r.verdict.class;
      if (r.record.value != null) assert.equal(browser, exported, `${series.region_id} ${r.month}: browser fallback ${browser} vs export ${exported}`);
    }
  }
});

test('baseline uses only observed Aqua in the manifest modis_only era', () => {
  const env = core.baselineEnvelope(alpha.months, manifest.eras);
  const era = manifest.eras.find((e) => e.id === 'modis_only');
  for (const e of env) for (const y of e.years) assert.ok(String(y) >= era.start.slice(0, 4) && String(y) <= era.end.slice(0, 4));
  // excluded / not_observed months never enter the baseline
  const bad = alpha.months.filter((r) => r.native.aqua.status !== 'observed').map((r) => r.month);
  for (const m of bad) {
    const e = env[core.monthIndex(m)];
    assert.ok(!e.years.includes(core.yearOf(m)) || alpha.months.find((r) => r.month === m).era !== 'modis_only');
  }
});

test('missing states are distinct and never zero', () => {
  const seen = new Set();
  for (const r of alpha.months) for (const p of core.PLATFORMS) {
    const st = core.nativeStatus(r, p); seen.add(st);
    if (st !== 'observed') assert.equal(core.nativeN(r, p), null);
  }
  for (const st of ['observed', 'not_observed', 'not_in_archive', 'excluded']) assert.ok(seen.has(st), `fixture exercises ${st}`);
  assert.equal(core.nativeStatus({ native: { aqua: { status: 'something_new', n: null } } }, 'aqua'), 'unknown');
});

test('verdict rule: intervals that straddle the usual range are "can\'t tell"', () => {
  const env = { n_years: 9, p10: 10, p50: 20, p90: 30 };
  assert.equal(core.verdictFor({ value: 40, kind: 'observed' }, env), 'above');
  assert.equal(core.verdictFor({ value: 5, kind: 'observed' }, env), 'below');
  assert.equal(core.verdictFor({ value: 20, lo: 12, hi: 28, kind: 'modelled' }, env), 'within');
  assert.equal(core.verdictFor({ value: 28, lo: 20, hi: 36, kind: 'modelled' }, env), 'unknown');
  assert.equal(core.verdictFor({ value: 40, kind: 'observed' }, { ...env, n_years: 3 }), 'unknown');
  assert.equal(core.verdictFor({ value: null, kind: 'none', missing: true }, env), 'none');
});

test('CSV export follows CONTRACT §2f', () => {
  const csv = core.buildCsv(alpha).trim().split('\n');
  assert.equal(csv[0], core.CSV_COLUMNS.join(','));
  assert.equal(csv.length - 1, alpha.months.length * 8);
  const cols = core.CSV_COLUMNS;
  const rows = csv.slice(1).map((l) => l.split(','));
  const lanes = new Set(rows.map((r) => r[cols.indexOf('lane')]));
  assert.deepEqual([...lanes].sort(), ['aqua_equiv_operator', 'aqua_equiv_ratio', 'native_aqua', 'native_noaa20', 'native_noaa21', 'native_snpp', 'native_terra', 'record'].sort());
  for (const r of rows) {
    const status = r[cols.indexOf('status')]; const value = r[cols.indexOf('value')]; const kind = r[cols.indexOf('value_kind')];
    if (['not_observed', 'not_in_archive', 'excluded', 'not_applicable', 'not_computed', 'terra_only'].includes(status)) assert.equal(value, '', `empty, never 0: ${r.join(',')}`);
    if (kind === 'none') assert.equal(value, '');
    assert.equal(r[cols.indexOf('kind')], 'fixture');
  }
  assert.match(core.csvFilename(alpha), /^FIXTURE_fixture-alpha_monthly_D_fixture-0\.csv$/);
});

test('data path parameter cannot escape the site', () => {
  assert.equal(core.safeRelPath('data-fixtures', 'data'), 'data-fixtures');
  for (const bad of ['../etc', 'http://x', '/abs', '.hidden', 'a/../b', 'a//b', '']) assert.equal(core.safeRelPath(bad, 'data'), 'data');
});

test('contract major version is checked', () => {
  assert.ok(core.checkEnvelope({ file: 'series', contract_version: '1.3.0' }, 'series').ok);
  assert.ok(!core.checkEnvelope({ file: 'series', contract_version: '2.0.0' }, 'series').ok);
  assert.ok(!core.checkEnvelope({ file: 'belt', contract_version: '1.0.0' }, 'series').ok);
});

test('Predict -> Reveal cards and locked state', () => {
  const v = read(path.join(FIX, 'validation.json'));
  const cards = core.revealCards(v);
  assert.ok(cards.length > 0);
  for (const c of cards) assert.ok(c.methods.length >= 1);
  assert.deepEqual(core.revealCards(read(path.join(FIX, 'variants/validation.not_evaluated.json'))), []);
  const roles = new Set(manifest.methods.map(core.methodRole));
  assert.ok(roles.has('baseline'));
});

test('sensor timeline separates actual and projected dates', () => {
  const s = read(path.join(FIX, 'sensors.json'));
  const aqua = core.missionSpan(s.missions.find((m) => m.platform === 'aqua'));
  assert.equal(aqua.endProjected.status, 'projected');
  assert.equal(aqua.endActual, null);
  const n20 = core.missionSpan(s.missions.find((m) => m.platform === 'noaa20'));
  assert.ok(n20.endUnknown);
});

test('belt files: every listed value is a number >= 0 (zeros listed, not omitted)', () => {
  for (const dir of [FIX, REAL]) {
    const p = path.join(dir, 'global/belt.json');
    if (!existsSync(p)) continue;
    const b = read(p);
    const iV = b.cell_columns.indexOf('value');
    assert.ok(iV >= 0);
    for (const c of b.cells) assert.ok(Number.isFinite(c[iV]) && c[iV] >= 0);
    const t = core.thresholdsFrom(b.cells.map((c) => c[iV]));
    if (t) for (let i = 1; i < t.length; i += 1) assert.ok(t[i] > t[i - 1]);
    for (const r of b.bands.rows) if (r.monthly_share) assert.ok(Math.abs(r.monthly_share.reduce((a, x) => a + x, 0) - 1) < 0.01);
  }
});

test('no hard-coded calendar years in site code (splice must come from data)', () => {
  const dir = path.join(ROOT, 'site/js');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(path.join(dir, f), 'utf8').replace(/http:\/\/www\.w3\.org\/\d+\/svg/g, '');
    const hits = src.match(/['"`\s(=]((19|20)\d\d)\b/g) || [];
    assert.deepEqual(hits, [], `${f} contains year-like literals: ${hits.join(' ')}`);
  }
});

test('status wording: one rule from manifest status; scope and shortfalls come from validation data', () => {
  assert.equal(core.regionStatusWords({ status: 'validated' }).word, 'validated');
  assert.equal(core.regionStatusWords({ status: 'explore_only' }).tested, false);
  const vp = path.join(REAL, 'validation.json');
  if (!existsSync(vp)) return;
  const v = read(vp); const m = read(path.join(REAL, 'manifest.json'));
  if (v.status !== 'evaluated') return;
  const methods = Object.fromEntries(m.methods.map((x) => [x.id, x]));
  for (const r of m.regions) {
    if (r.status === 'validated') assert.ok(core.validationScope(v, r, methods).text.includes('withheld'));
    if (r.status === 'provisional') {
      const f = core.coverageShortfalls(v, r.id, r.method, 'held_out');
      if (f.length) assert.ok(f[0].k < f[0].needed, `${r.id}: ${f[0].k}/${f[0].n} vs ${f[0].needed}`);
    }
  }
});

test('month caveats: gap fills, drift-year estimates and drifting Aqua are flagged', () => {
  const gap = alpha.months.find((r) => r.record.source === 'modelled_from_viirs' && r.native.aqua.status !== 'observed');
  assert.ok(core.monthCaveats(gap).some((k) => k.key === 'gap_fill'));
  const obsDrift = alpha.months.find((r) => r.record.source === 'observed_aqua' && (r.quality || []).includes('aqua_drift'));
  assert.ok(core.monthCaveats(obsDrift).some((k) => k.key === 'aqua_drifting'));
  const plain = alpha.months.find((r) => r.record.source === 'observed_aqua' && r.era === 'modis_only');
  assert.deepEqual(core.monthCaveats(plain), []);
});

test('regression: no nullable value is passed straight to DOM append/replaceChildren (stray "null" text)', () => {
  const dir = path.join(ROOT, 'site/js');
  const ui = readFileSync(path.join(dir, 'ui.js'), 'utf8');
  const veil = ui.slice(ui.indexOf('export function fixtureVeil'), ui.indexOf('}', ui.indexOf('export function fixtureVeil')) + 1);
  assert.ok(!/:\s*null\s*;/.test(veil), 'fixtureVeil must return a node in both branches');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    // A ternary with a null branch directly inside append()/replaceChildren() renders "null".
    const bad = src.match(/\.(append|replaceChildren)\([^;]*?\?[^;:]*:\s*null\s*[,)]/g) || [];
    const unsafe = bad.filter((m) => !/h\('/.test(m.slice(0, m.indexOf('?'))));
    assert.deepEqual(unsafe, [], `${f}: ${unsafe.join(' | ')}`);
  }
});

test('Trust defaults to a validated core region, never the stretch region', () => {
  const m = {
    regions: [
      { id: 'stretch', status: 'validated', role: 'pilot', description: 'spatial-transfer test region (stretch)' },
      { id: 'prov', status: 'provisional', role: 'pilot', description: 'core pilot region' },
      { id: 'ctl', status: 'validated', role: 'control', description: 'core pilot region' },
      { id: 'core1', status: 'validated', role: 'pilot', description: 'core pilot region' },
    ],
  };
  assert.equal(core.defaultTrustRegion(m), 'core1');
  assert.equal(core.defaultTrustRegion(m, ['stretch', 'prov', 'ctl']), 'ctl');
  assert.equal(core.defaultTrustRegion({ regions: [{ id: 'x', tier: 'stretch', status: 'validated', role: 'pilot' }, { id: 'y', tier: 'core', status: 'provisional', role: 'pilot' }] }), 'y');
  if (existsSync(path.join(REAL, 'manifest.json'))) {
    const real = read(path.join(REAL, 'manifest.json'));
    const id = core.defaultTrustRegion(real);
    const r = real.regions.find((x) => x.id === id);
    if (real.regions.some((x) => x.status === 'validated' && core.isCoreRegion(x))) { assert.equal(r.status, 'validated'); if (r.tier) assert.equal(r.tier, 'core'); }
    assert.ok(core.isCoreRegion(r));
  }
});

test('v1.2 sensor events: launch is separate from archive start; archive end is not retirement', () => {
  const m = { platform: 'noaa20', instrument: 'VIIRS', events: [
    { kind: 'launch', date: '2017-11-18', status: 'actual' }, { kind: 'archive_start', date: '2018-04-01', status: 'actual' }] };
  const s = core.missionSpan(m);
  assert.equal(s.start.date, '2018-04-01');
  assert.equal(s.launch.date, '2017-11-18');
  assert.ok(s.endUnknown);
  const snpp = core.missionSpan({ events: [{ kind: 'archive_start', date: '2012-01-19', status: 'actual' }, { kind: 'archive_end', date: '2026-11-02', status: 'actual' }] });
  assert.equal(snpp.endActualKind, 'archive_end');
  assert.equal(snpp.retired, null);
  const aqua = core.missionSpan({ events: [{ kind: 'archive_start', date: '2002-07', status: 'actual' }, { kind: 'drift_start', date: '2021-07', status: 'actual' }, { kind: 'projected_end_of_science', date: '2027-09', status: 'projected' }] });
  assert.equal(aqua.endProjected.date, '2027-09');
  assert.equal(aqua.drift.date, '2021-07');
  // real sensors.json: every mission bar starts at an archive start when one is listed
  const sp = path.join(REAL, 'sensors.json');
  if (existsSync(sp)) for (const mm of read(sp).missions) {
    const sx = core.missionSpan(mm);
    const as = (mm.events || []).find((e) => ['archive_start', 'firms_data_start'].includes(e.kind) && e.date);
    if (as) assert.equal(sx.start.date, as.date, mm.platform);
  }
});

test('overpass LST, baseline period label and audit flags are read from data', () => {
  const pts = core.overpassSeries({ overpass_lst: [
    { platform: 'aqua', year: 2025, daynight: 'D', median_local_solar_time_h: 14.85, n: 10 },
    { platform: 'aqua', year: 2003, daynight: 'D', median_local_solar_time_h: 13.55, n: 10 },
    { platform: 'aqua', year: 2004, daynight: 'D', median_local_solar_time_h: null, n: 0 },
    { platform: 'aqua', year: 2005, daynight: 'N', median_local_solar_time_h: 1.5, n: 10 },
    { platform: 'terra', year: 2003, daynight: 'D', median_local_solar_time_h: 10.5, n: 10 }] }, 'aqua', 'D');
  assert.deepEqual(pts.map((p) => p.year), [2003, 2025], 'aqua, daytime, n>0 only, sorted');
  assert.equal(core.fmtHour(13.55), '13:33');
  assert.equal(core.baselinePeriodLabel({ baseline: { period: { start_year: 2003, end_year: 2011, complete_years_only: true } } }, [{ years: [2002] }]), '2003–2011');
  assert.equal(core.baselinePeriodLabel({}, [{ years: [2004, 2003] }, { years: [2011] }]), '2003–2011');
  const a = core.formatAuditFlag({ id: 'C1_frp_floor', label: 'FRP floor change', value: -12.9, unit: '%', ci_low: -20, ci_high: -5, ci_level: 0.95, flagged: true, n: 9, source_ref: { path: 'analysis/results/x.json', key: 'c1/frp' } });
  assert.match(a.detail, /-12\.9 % \(95% CI -20 to -5\)/);
  assert.match(a.detail, /analysis\/results\/x\.json → c1\/frp/);
  assert.equal(a.state, 'flagged');
  assert.equal(core.formatAuditFlag({ id: 'x', value: null, flagged: null }).state, 'not assessed');
  // fixtures and real data: every audit flag renders its own value and CI verbatim
  for (const dir of [FIX, REAL]) {
    const mp = path.join(dir, 'manifest.json');
    if (!existsSync(mp)) continue;
    for (const r of read(mp).regions) for (const f of r.audit_flags || []) {
      const d = core.formatAuditFlag(f).detail;
      if (Number.isFinite(f.value) && Math.abs(f.value) < 100) assert.ok(d.includes(String(Math.round(f.value * 1000) / 1000)), `${r.id} ${f.id}: ${d}`);
      if (Number.isFinite(f.ci_low) && Math.abs(f.ci_low) < 100) assert.ok(d.includes(String(Math.round(f.ci_low * 1000) / 1000)), `${r.id} ${f.id} CI`);
    }
  }
  // real data: if the export provides a baseline period, the label must match it exactly
  if (existsSync(path.join(REAL, 'manifest.json'))) {
    const m = read(path.join(REAL, 'manifest.json'));
    for (const r of m.regions) {
      const p = path.join(REAL, r.series_path);
      if (!existsSync(p)) continue;
      const s = read(p);
      const per = s.baseline && s.baseline.period;
      if (per) {
        assert.equal(core.baselinePeriodLabel(s, []), `${per.start_year}–${per.end_year}`);
        for (const e of s.baseline.entries || []) for (const y of e.years || []) assert.ok(y >= per.start_year && y <= per.end_year, `${r.id} baseline year ${y} outside ${per.start_year}–${per.end_year}`);
      }
    }
  }
});

test('scoreboard values shown equal site/data validation summary (no reformatting drift)', () => {
  const vp = path.join(REAL, 'validation.json');
  if (!existsSync(vp)) return;
  const v = read(vp);
  if (v.status !== 'evaluated') return;
  // The rendered value is value.toFixed(3); check the rounding never changes pass/fail interpretation.
  for (const s of v.summary.filter((x) => x.threshold != null && x.value != null && x.meets_minimum_n)) {
    const shown = Number(s.value.toFixed(3));
    assert.equal(shown >= s.threshold, s.value >= s.threshold, `${s.method_id} ${s.region_id} ${s.metric}: shown ${shown} vs threshold ${s.threshold}`);
  }
});

test('cache-busting: every module is version-mapped in index.html, with one version', () => {
  // Python http.server sends no Cache-Control, so browsers may mix stale and fresh ES modules
  // (this is how an already-fixed "null" kept appearing). The import map pins one version for all.
  const html = readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const mods = readdirSync(path.join(ROOT, 'site/js')).filter((x) => x.endsWith('.js'));
  const versions = new Set();
  for (const m of mods) {
    const v = map[`./js/${m}`];
    assert.ok(v, `${m} missing from import map`);
    versions.add(v.split('?v=')[1]);
  }
  const main = html.match(/src="js\/main\.js\?v=([^"]+)"/);
  assert.ok(main, 'main.js script tag carries ?v=');
  versions.add(main[1]);
  assert.equal(versions.size, 1, `one version everywhere: ${[...versions]}`);
});

test('overpass LST is never pooled across region scopes (that drew a zig-zag line)', () => {
  const s = { overpass_lst: [
    { platform: 'aqua', year: 2003, daynight: 'D', median_local_solar_time_h: 13.2, n: 5, region_scope: 'a' },
    { platform: 'aqua', year: 2003, daynight: 'D', median_local_solar_time_h: 13.6, n: 5, region_scope: 'b' },
    { platform: 'aqua', year: 2004, daynight: 'D', median_local_solar_time_h: 13.3, n: 5, region_scope: 'a' }] };
  assert.deepEqual(core.overpassSeries(s, 'aqua', 'D'), [], 'ambiguous scope: draw nothing rather than mix');
  assert.deepEqual(core.overpassSeries(s, 'aqua', 'D', 'a').map((p) => p.h), [13.2, 13.3]);
  const sp = path.join(REAL, 'sensors.json');
  if (existsSync(sp)) {
    const real = read(sp);
    for (const scope of new Set((real.overpass_lst || []).map((o) => o.region_scope))) {
      const pts = core.overpassSeries(real, 'aqua', 'D', scope);
      assert.equal(new Set(pts.map((p) => p.year)).size, pts.length, `${scope}: one point per year`);
    }
  }
});

test('Trust result copy: pre-registered wording, numbers from validation.json, never "won"', () => {
  const vp = path.join(REAL, 'validation.json');
  const files = [path.join(FIX, 'validation.json'), ...(existsSync(vp) ? [vp] : [])];
  for (const f of files) {
    const v = read(f);
    if (v.status !== 'evaluated') continue;
    const m = read(path.join(path.dirname(f), 'manifest.json'));
    const methods = Object.fromEntries(m.methods.map((x) => [x.id, x]));
    const rc = {}; for (const r of m.regions) rc[r.method] = (rc[r.method] || 0) + 1;
    const recordMethod = Object.keys(rc).sort((a, b) => rc[b] - rc[a])[0];
    const core = new Set(m.regions.filter(core_.isPooledRegion).map((r) => r.id));
    const copy = core_.resultCopy(v, methods, recordMethod, (id) => core.has(id), (id) => (m.regions.find((r) => r.id === id) || {}).name || id);
    const text = [...copy.lede, ...copy.detail, ...copy.triggers.map((t) => t.text)].join(' ').replace(/−/g, '-');
    assert.ok(!/\bwon\b/i.test(text), `"won" in: ${text}`);
    if (v.decision) {
      for (const t of v.decision.triggers.filter((x) => x.fired && x.region)) {
        const r = m.regions.find((x) => x.id === t.region);
        assert.ok(text.includes(`${r.name} triggered it (${t.value.toFixed(2)}`) || copy.triggers.some((c) => c.text.replace(/−/g, '-').includes(t.value.toFixed(2))), `trigger ${t.region}`);
        if (t.below_display_minimum) assert.ok(copy.triggers.find((c) => c.region === t.region).text.includes('below the display minimum'));
      }
      if (v.decision.blocks_won) assert.ok(text.includes(`${v.decision.blocks_won.candidate} of ${v.decision.blocks_won.total} test region-years`));
      if (v.decision.outcome === 'fallback_to_baseline') assert.match(text, /did not meet the adoption criterion set in advance/);
    }
    for (const s of v.summary.filter((x) => !v.decision && x.metric === 'skill_vs_ratio_log1p' && x.region_id === 'all' && x.stratum === 'held_out' && x.season === 'all' && x.value != null && core_.methodRole(methods[x.method_id]) === 'candidate')) {
      assert.ok(text.includes(s.value.toFixed(2)), `skill ${s.value} shown`);
      if (s.passed === false) assert.match(text, /did not meet the adoption criterion set in advance/);
      assert.ok(text.includes(`≥ ${s.threshold}`) || s.passed == null, 'threshold from data');
    }
    // block coverage counts agree with the pooled coverage figure
    const bc = core_.blockCoverage(v, recordMethod, (id) => core.has(id));
    if (!bc) continue;
    const cov = v.summary.find((s) => s.method_id === recordMethod && s.metric === 'interval_coverage' && s.region_id === 'all' && s.stratum === 'held_out' && s.season === 'all' && s.interval_level === bc.level);
    if (cov && bc) {
      assert.equal(bc.totalN, cov.n, 'pooled n equals summed region-year months');
      assert.ok(Math.abs(bc.totalK / bc.totalN - cov.value) < 0.001, `rows ${bc.totalK}/${bc.totalN} vs summary ${cov.value}`);
      assert.ok(text.includes(`${bc.minK === bc.maxK ? bc.minK : `${bc.minK}–${bc.maxK}`} of`));
    }
  }
});

test('pooled scope is tier core + control (Deviation D1); stretch is never pooled', () => {
  assert.ok(core.isPooledRegion({ tier: 'control' }));
  assert.ok(core.isPooledRegion({ tier: 'core' }));
  assert.ok(!core.isPooledRegion({ tier: 'stretch' }));
  assert.ok(!core.isCoreRegion({ tier: 'control' }));
  assert.equal(core.defaultTrustRegion({ regions: [{ id: 'c', tier: 'control', status: 'validated', role: 'control' }, { id: 'p', tier: 'core', status: 'provisional', role: 'pilot' }, { id: 'v', tier: 'core', status: 'validated', role: 'pilot' }] }), 'v');
});

test('every site module parses as an ES module (a broken if/else once shipped past node --check on .js)', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, copyFileSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const dir = path.join(ROOT, 'site/js');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sitecheck-'));
  try {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const dst = path.join(tmp, f.replace(/\.js$/, '.mjs'));
      copyFileSync(path.join(dir, f), dst);
      execFileSync(process.execPath, ['--check', dst], { stdio: 'pipe' });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
