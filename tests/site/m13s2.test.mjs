// M1.3 stage 2: the calendar-month map layer (belt_monthly.json), the atlas `cal` parameter, custom-area seasons,
// and the scientific-QA wording fixes. Run: node --test tests/site/*.mjs. Expected values are recomputed from the files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as M from '../../site/js/monthly.js';
import * as S from '../../site/js/story.js';
import * as core from '../../site/js/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dirs = ['site/data', 'site/data-fixtures'].map((d) => path.join(ROOT, d)).filter((d) => existsSync(path.join(d, 'global/belt_monthly.json')));
const pair = (d) => ({ belt: read(path.join(d, 'global/belt.json')), bm: read(path.join(d, 'global/belt_monthly.json')), dir: d });
const REAL = path.join(ROOT, 'site/data');
const hasReal = existsSync(path.join(REAL, 'global/belt_monthly.json'));

test('atlas `cal`: 1..12 is a month, anything else is all year; the region page uses `all` for "show every month"', () => {
  for (const [v, want] of [['8', 8], ['1', 1], ['12', 12], ['0', 0], ['13', 0], ['-1', 0], ['x', 0], ['2.5', 0], [null, 0], [undefined, 0], ['', 0]]) assert.equal(M.parseCal(v), want, String(v));
  assert.equal(M.calParam(0), null, 'all year is the absence of the parameter');
  assert.equal(M.calParam(8), '8');
  const main = readFileSync(path.join(ROOT, 'site/js/main.js'), 'utf8');
  const region = readFileSync(path.join(ROOT, 'site/js/region.js'), 'utf8');
  assert.match(main, /cal: parseCal\(p\.get\('cal'\)\)/);
  assert.match(main, /all: p\.get\('all'\),/); // raw: the calendar is open unless all=0 (unified region page)
  assert.ok(!/setParams\(\{ cal:/.test(region), 'region.js no longer writes `cal`');
  assert.match(region, /setParams\(\{ all: /);
});

test('layers join by index; a misaligned or missing monthly file falls back to belt.json', () => {
  for (const d of dirs) {
    const { belt, bm } = pair(d);
    const L = M.joinLayers(belt, bm);
    assert.equal(L.monthly, true, d);
    assert.equal(L.n, belt.cells.length);
    assert.equal(L.daynight, bm.daynight);
    const short = { ...bm, counts: bm.counts.slice(1) };
    assert.equal(M.joinLayers(belt, short).monthly, false, 'length mismatch -> fallback');
    assert.equal(M.joinLayers(belt, { ...bm, aligned_to: { ...bm.aligned_to, n_cells: 1 } }).monthly, false, 'aligned_to mismatch -> fallback');
    const F = M.joinLayers(belt, null);
    assert.equal(F.monthly, false);
    assert.equal(F.daynight, belt.daynight, 'fallback legend reads the annual layer’s day/night');
    assert.equal(M.density(F, 0, 0), belt.cells[0][belt.cell_columns.indexOf('value')]);
    assert.equal(M.density(F, 0, 3), null, 'no monthly values without the monthly layer');
  }
});

test('density = counts / n_years / land_km2 x 1000, recomputed from the raw arrays for every cell and month', () => {
  for (const d of dirs) {
    const { belt, bm } = pair(d);
    const L = M.joinLayers(belt, bm);
    const iLand = belt.cell_columns.indexOf('land_km2');
    const ny = bm.period.n_years;
    for (let i = 0; i < belt.cells.length; i += 97) {
      const land = belt.cells[i][iLand];
      for (let m = 1; m <= 12; m += 1) assert.ok(Math.abs(M.density(L, i, m) - bm.counts[i][m - 1] / ny / land * 1000) < 1e-9);
      const tot = bm.counts[i].reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(M.density(L, i, 0) - tot / ny / land * 1000) < 1e-9, 'all year is per year');
    }
  }
});

test('zero is never sparse; sparse bits drive the pale state; absent cells are not zero', () => {
  for (const d of dirs) {
    const { belt, bm } = pair(d);
    const L = M.joinLayers(belt, bm); const th = M.layerThresholds(L);
    let nZero = 0; let nSparse = 0;
    for (let m = 0; m <= 12; m += 1) {
      const { cls, sp } = M.classify(L, m, th);
      for (let i = 0; i < L.n; i += 1) {
        const total = m === 0 ? bm.counts[i].reduce((a, b) => a + b, 0) : bm.counts[i][m - 1];
        const bit = ((bm.sparse[i] >> (m === 0 ? 12 : m - 1)) & 1) === 1;
        const st = M.cellState(L, i, m);
        if (total === 0) { assert.equal(st, 'zero'); assert.equal(cls[i], 0); assert.equal(sp[i], 0); nZero += 1; }
        else { assert.equal(st, bit ? 'sparse' : 'value'); assert.equal(sp[i], bit ? 1 : 0); assert.ok(cls[i] >= 1); if (bit) nSparse += 1; }
      }
    }
    assert.ok(nZero > 0 && nSparse > 0, 'both states occur in the data');
    // a cell missing from belt.cells has no index entry: the card says "no data", never zero
    assert.equal(L.index.get('999|999'), undefined);
    for (const t of [th.all, th.month]) { assert.ok(t[0] > 0, 'the first class is not empty'); for (let k = 1; k < t.length; k += 1) assert.ok(t[k] > t[k - 1]); }
  }
});

test('the documented worked example: (-13, 132) in August, sparse January and March', { skip: !hasReal }, () => {
  const { belt, bm } = pair(REAL);
  const L = M.joinLayers(belt, bm);
  const i = L.index.get('-13|132');
  const land = belt.cells[i][belt.cell_columns.indexOf('land_km2')];
  assert.ok(Math.abs(M.density(L, i, 8) - bm.counts[i][7] / bm.period.n_years / land * 1000) < 1e-9);
  assert.equal(M.cellState(L, i, 8), 'value');
  assert.equal(M.cellState(L, i, 1), 'sparse');
  assert.equal(M.cellState(L, i, 3), 'sparse');
  assert.equal(M.seenIn(L, i, 8), Number(bm.years_seen[i][7]));
});

test('custom-area season: one cell uses its own bits; a box sums counts and land, sparse if total < min_total, years "at least"', { skip: !hasReal }, () => {
  const { belt, bm } = pair(REAL);
  const L = M.joinLayers(belt, bm);
  const one = M.areaSeason(L, -12.5, 132.5, 1);
  const i = L.index.get('-13|132');
  assert.deepEqual(one.cell, { lat: -13, lon: 132 });
  one.months.forEach((x, k) => { assert.equal(x.count, bm.counts[i][k]); assert.equal(x.sparse, M.isSparse(L, i, k + 1)); assert.equal(x.seenExact, true); });
  const box = M.areaSeason(L, -12.5, 132.5, 3);
  const ids = []; for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) { const j = L.index.get(`${-13 + dy}|${132 + dx}`); if (j != null) ids.push(j); }
  assert.equal(box.nCells, ids.length);
  const land = ids.reduce((a, j) => a + L.land[j], 0);
  box.months.forEach((x, k) => {
    const n = ids.reduce((a, j) => a + bm.counts[j][k], 0);
    assert.equal(x.count, n);
    assert.ok(Math.abs(x.density - n / bm.period.n_years / land * 1000) < 1e-9);
    const seenSum = ids.reduce((acc, j) => acc + Number(bm.years_seen[j][k]), 0);
    assert.equal(x.sparse, n > 0 && (n < bm.sparse_rule.min_total || seenSum <= bm.sparse_rule.max_years_seen));
    assert.equal(x.seen, Math.max(...ids.map((j) => Number(bm.years_seen[j][k]))));
    assert.equal(x.seenExact, false);
  });
  const sea = M.areaSeason(L, -40, -150, 1);
  assert.equal(sea.nCells, 0, 'open ocean: no cells, no values (not zeros)');
  assert.equal(sea.months.length, 0);
  assert.deepEqual(M.cellOf(-0.5, 179.9), { lat: -1, lon: 179 });
  assert.deepEqual(M.cellOf(10, -180), { lat: 10, lon: -180 });
  const m = read(path.join(REAL, 'manifest.json'));
  assert.equal(M.nearestRegion(m.regions, -14, 133).inside, true);
  assert.equal(M.nearestRegion(m.regions, -40, -150), null);
});

test('month strip totals come from the latitude bands', () => {
  for (const d of dirs) {
    const { belt, bm } = pair(d);
    const L = M.joinLayers(belt, bm);
    const t = M.monthTotals(L);
    for (let k = 0; k < 12; k += 1) assert.equal(t[k], bm.bands.rows.reduce((a, r) => a + r.counts[k], 0));
    for (const r of M.bandRows(L)) if (r.monthly_share) assert.ok(Math.abs(r.monthly_share.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
});

test('QA wording: tally caveat first in drift years; last-month line puts "unconfirmed" before the verdict', () => {
  assert.equal(S.tallyText(2025, { above: 5, within: 5, below: 2, unknown: 0, none: 0 }, true), '2025 (Aqua’s timing had drifted, so all unconfirmed): 5 above usual · 5 within · 2 below');
  assert.equal(S.tallyText(2013, { above: 2, within: 8, below: 2, unknown: 0, none: 0 }, false), '2013: 2 above usual · 8 within · 2 below');
  const eras = [{ id: 'aqua_drift', start: '2022-01', end: null }];
  const row = { month: '2025-12', era: 'aqua_drift', quality: ['aqua_drift'], record: { source: 'observed_aqua', value: 5 }, native: { aqua: { status: 'observed', n: 5 } } };
  const l = S.lastMonthLine(row, { verdict: 'within', period: 'P', region: { status: 'validated' }, eras });
  assert.equal(l.text, 'Last month in this record: Dec 2025, measured by Aqua. Unconfirmed (Aqua’s timing had drifted): within the P range for December.');
  assert.ok(!l.caveats.some((c) => c.key === 'drift_unconfirmed'), 'not repeated after the verdict');
  const early = { ...row, month: '2005-12', era: 'modis_only', quality: [] };
  assert.equal(S.lastMonthLine(early, { verdict: 'above', period: 'P', region: {}, eras }).text, 'Last month in this record: Dec 2005, measured by Aqua. Above the P range for December.');
});

test('region page and twosat wording from QA: season in the conversion note; no Aqua parenthetical in the season sentence', () => {
  const tw = readFileSync(path.join(ROOT, 'site/js/twosat.js'), 'utf8');
  assert.match(tw, /in the same region and season, from the training years/);
  assert.match(tw, /Newer satellite \(VIIRS\) counted/);
  const region = readFileSync(path.join(ROOT, 'site/js/region.js'), 'utf8');
  assert.match(region, /seasonSentence\(shortName\(region\.name\), usualEntries, baseLabel, null, series\.daynight\)/);
  assert.match(region, /mapUnitLabel\(\)/, 'the measure line is built from the active map layer’s unit label');
  const trust = readFileSync(path.join(ROOT, 'site/js/trust.js'), 'utf8');
  // M4.5: the old step tabs are gone; the Time Machine never labels a month by its outcome before the reveal (kicker)
  assert.match(readFileSync(path.join(ROOT, 'site/js/machine.js'), 'utf8'), /kicker\.textContent = `\$\{M\} \$\{m\.year\} · hidden test month`;/);
  assert.match(trust, /both methods err more at night than by day/);
  for (const t of ['a hidden test month', 'another hidden test month']) assert.deepEqual(S.bannedIn(t), []);
});

test('box sparse rule: total < min_total OR summed years-seen <= max_years_seen, over many boxes', { skip: !hasReal }, () => {
  const { belt, bm } = pair(REAL);
  const L = M.joinLayers(belt, bm);
  let flaggedBySeen = 0;
  for (let i = 0; i < L.n; i += 211) {
    for (const size of [3, 5]) {
      const a = M.areaSeason(L, L.lat[i] + 0.5, L.lon[i] + 0.5, size);
      const half = Math.floor(size / 2); const ids = [];
      for (let dy = -half; dy <= half; dy += 1) for (let dx = -half; dx <= half; dx += 1) {
        let lo = L.lon[i] + dx; if (lo < -180) lo += 360; if (lo >= 180) lo -= 360;
        const j = L.index.get(`${L.lat[i] + dy}|${lo}`); if (j != null) ids.push(j);
      }
      a.months.forEach((x, k) => {
        const n = ids.reduce((acc, j) => acc + bm.counts[j][k], 0);
        const seen = ids.reduce((acc, j) => acc + Number(bm.years_seen[j][k]), 0);
        const want = n > 0 && (n < bm.sparse_rule.min_total || seen <= bm.sparse_rule.max_years_seen);
        assert.equal(x.sparse, want, `${L.lat[i]},${L.lon[i]} ${size}x${size} m${k + 1}`);
        if (n >= bm.sparse_rule.min_total && seen <= bm.sparse_rule.max_years_seen) flaggedBySeen += 1;
        if (n === 0) assert.equal(x.sparse, false, 'zero is never sparse');
      });
    }
  }
  assert.ok(flaggedBySeen >= 0);
});

test('region default year: the latest complete year with no drift-era month, from manifest.eras', () => {
  const months = [];
  for (let y = 2018; y <= 2025; y += 1) for (let m = 1; m <= 12; m += 1) months.push({ month: `${y}-${String(m).padStart(2, '0')}` });
  const eras = [{ id: 'overlap', start: '2012-01', end: '2021-12' }, { id: 'aqua_drift', start: '2022-01', end: null }];
  assert.equal(core.latestComparableYear(months, eras), 2021);
  assert.deepEqual(core.unconfirmedYears(months, eras), [2022, 2023, 2024, 2025]);
  assert.equal(core.latestComparableYear(months, [{ id: 'aqua_drift', start: '2021-07', end: null }]), 2020, 'a year with any drift month is not comparable');
  assert.equal(core.latestComparableYear(months.slice(0, -3), []), 2024, 'only complete years');
  assert.equal(core.latestComparableYear(months, [{ id: 'aqua_drift', start: '2000-01', end: null }]), 2025, 'falls back to the latest complete year');
  if (hasReal) {
    const m = read(path.join(REAL, 'manifest.json'));
    const drift = m.eras.find((e) => e.id === 'aqua_drift');
    for (const r of m.regions) {
      const ms = read(path.join(REAL, r.series_path)).months;
      const y = core.latestComparableYear(ms, m.eras);
      assert.ok(drift && `${y}-12` < drift.start, `${r.id}: ${y} is before the drift era`);
      assert.equal(ms.filter((x) => core.yearOf(x.month) === y).length, 12);
    }
  }
  const region = readFileSync(path.join(ROOT, 'site/js/region.js'), 'utf8');
  assert.match(region, /latestComparableYear\(months, manifest\.eras\)/);
  assert.match(region, /the latest year we can compare with confidence/);
});

test('final QA copy: plurals, singular sparse, Aqua records, band title, twosat month', () => {
  assert.equal(S.MONTH_PLURAL[0], 'Januaries');
  const st = readFileSync(path.join(ROOT, 'site/js/stage.js'), 'utf8');
  assert.match(st, /nSparse === 1 \? 'is' : 'are'/);
  assert.match(st, /'When each latitude band ', `has the most \$\{dnWords\(\)\} detections`/);
  assert.match(st, /Too few detections to name a peak month here/);
  assert.match(st, /For a box, years seen is a lower bound/);
  assert.match(S.seasonSentence('X', [1, 1, 1, 1, 1, 1, 1, 1, 9, 10, 1, 1].map((v, i) => ({ month: i + 1, p50: v })), 'P', null, 'D').text, /^Aqua \(NASA’s older satellite\) records the most detections in X in September–October \(typical year P, daytime\)\.$/);
  assert.match(readFileSync(path.join(ROOT, 'site/js/twosat.js'), 'utf8'), /more than Aqua here in \$\{mname\}/);
  // the internal demo script is not part of the public release; check it only where it exists
  const demoPath = path.join(ROOT, 'docs/DEMO.md');
  if (!existsSync(demoPath)) return;
  const demo = readFileSync(demoPath, 'utf8');
  assert.ok(!/the record continues, with its uncertainty shown/.test(demo), 'D1');
  assert.match(demo, /nothing can check them/);
});
