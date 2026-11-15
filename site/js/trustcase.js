// M4.5 step 2: one data shape for every region's Time Machine (pure; no DOM; not wired into the UI yet).
// Adapters turn the two stored tests into the same TestMonth / RegionTest shapes, value for value:
//   NOAA-20 test (M2): m2_validation.json month_rows (one row holds raw, estimate, range, Aqua, usual band, raw verdict).
//   S-NPP test (M1):  validation.json held-out rows of the region's record method with Aqua observed, joined to the region's
//                     series.json for the raw S-NPP count (native.snpp.n) and the usual band (the region page's envelope rule).
// Nothing is computed that is not already stored, except the join itself and the side of the range read from stored flags.
// Missing values stay null (never 0). S-NPP and NOAA-20 counts are never combined; each month carries ONE satellite.
import { monthIndex, yearOf, nativeStatus, nativeN, PLATFORM_LABEL } from './core.js';
import { matched } from './m2.js';
import { m1Rows, m1RegionCases, m2RegionCases, regionFacts, sideOf, periodWords, REGION_CASE_RULE, D7 } from './trustctx.js';

const num = (v) => (Number.isFinite(v) ? v : null);
export const LEVEL = 0.9; // both tests store a 90% range per month

/**
 * TestMonth: { region, test: 'm1'|'m2', satellite, month, year, mi, raw, est, lo, hi, level, actual, side, inside,
 *   verdictMatch (M2 only, else null), rawVerdict (M2 q4_naive only, else null), envLo, envHi, provenance, fitNote }
 */
export function m2TestMonths(m2val, regionId) {
  const sat = (m2val && m2val.method && m2val.method.predictor_platform) || null;
  return ((m2val && m2val.month_rows) || []).filter((r) => r.region_id === regionId && r.actual != null).map((r) => ({
    region: r.region_id, test: 'm2', satellite: sat, month: r.month, year: yearOf(r.month), mi: monthIndex(r.month),
    raw: num(r.noaa20_raw), est: num(r.pred), lo: num(r.lo90), hi: num(r.hi90), level: LEVEL,
    actual: num(r.actual), side: sideOf(r.inside90, r.actual, r.lo90, r.hi90), inside: r.inside90 === true ? true : r.inside90 === false ? false : null,
    verdictMatch: matched(r), rawVerdict: r.q4_naive || null, verdictPred: r.q4_n20 || null, verdictTruth: r.q4_truth || null, rangeCrossesEdge: r.range_crosses_edge === true,
    envLo: num(r.env_p10), envHi: num(r.env_p90),
    provenance: { file: 'm2_validation.json', table: 'month_rows', key: { region_id: r.region_id, month: r.month } },
    fitNote: 'm2_loyo',
  }));
}

/** M1 (S-NPP) held-out months of the record method with Aqua observed; series gives raw S-NPP and the usual band. */
export function m1TestMonths(val, region, series) {
  if (!val || !region) return [];
  const rows = m1Rows(val, region).filter((r) => r.actual_status === 'observed' && r.actual != null);
  const byMonth = new Map(((series && series.months) || []).map((m) => [m.month, m]));
  // the usual band: the series' STORED baseline entries only (the region page's exported envelope); never a browser fallback
  const base = series && series.baseline && Array.isArray(series.baseline.entries) ? series.baseline : null;
  const band = (mi) => { const e = base && base.entries.find((x) => x.month === mi + 1); return e && e.n_years >= (base.min_years ?? 5) && num(e.p10) != null && num(e.p90) != null ? [e.p10, e.p90] : [null, null]; };
  return rows.map((r) => {
    const sat = r.input_platform || null;
    const srow = byMonth.get(r.month);
    const mi = monthIndex(r.month);
    const [envLo, envHi] = band(mi);
    return {
      region: r.region_id, test: 'm1', satellite: sat, month: r.month, year: yearOf(r.month), mi,
      raw: srow && sat && nativeStatus(srow, sat) === 'observed' ? nativeN(srow, sat) : null,
      est: num(r.predicted), lo: num(r.lo), hi: num(r.hi), level: num(r.interval_level) ?? LEVEL,
      actual: num(r.actual), side: sideOf(r.inside_interval, r.actual, r.lo, r.hi), inside: r.inside_interval === true ? true : r.inside_interval === false ? false : null,
      verdictMatch: null, rawVerdict: null, verdictPred: null, verdictTruth: null, // not stored for the S-NPP test (D2): never computed
      envLo, envHi,
      provenance: { file: 'validation.json', table: 'rows', key: { region_id: r.region_id, method_id: r.method_id, stratum: r.stratum, daynight: r.daynight, month: r.month }, raw: srow ? { file: `region/${region.id}/series.json`, key: { month: r.month, native: sat } } : null },
      fitNote: 'm1_training_years',
    };
  });
}

/**
 * The months a visitor steps through: the test's own example month first (D1: the documented rule), then, for NOAA-20,
 * the area's pre-locked opening month (today's behaviour), then every other month in time order. No outcome filter.
 */
export function rotation(months, exampleMonth, preLocked = null) {
  const sorted = [...months].map((m) => m.month).sort();
  const head = [exampleMonth, preLocked].filter((m, i, a) => m && sorted.includes(m) && a.indexOf(m) === i);
  return [...head, ...sorted.filter((m) => !head.includes(m))];
}

/** RegionTest: the stored region result plus the example, miss and rotation by each test's EXISTING rules. */
export function regionTest(manifest, val, m2val, id, months) {
  const f = regionFacts(manifest, val, m2val, id);
  if (!f) return null;
  let example = null; let miss = null; let preLocked = null;
  if (f.test === 'm2') {
    const c = m2RegionCases(m2val, id);
    example = c.success ? { month: c.success.row.month, how: c.success.how } : null;
    miss = c.miss ? { month: c.miss.row.month, how: c.miss.how } : null;
    const reg = (m2val.regions || []).find((g) => g.region_id === id);
    preLocked = reg ? reg.featured_month || null : null;
  } else {
    const region = manifest.regions.find((r) => r.id === id);
    const c = m1RegionCases(val, region);
    example = c.success ? { month: c.success.row.month, how: c.success.how } : null;
    miss = c.miss ? { month: c.miss.row.month, how: c.miss.how } : null;
  }
  const c90 = f.cov90 || {}; const c80 = f.cov80 || null;
  return {
    region: id, test: f.test, satellite: f.platform || null, name: f.name,
    k: c90.k ?? null, n: c90.n ?? f.n ?? null, required: c90.threshold ?? null, passed90: c90.passed ?? null,
    status: f.status, reasons: f.statusReasons || [],
    cov80: c80 ? { k: c80.k ?? null, n: c80.n ?? null, required: c80.threshold ?? null, passed: c80.passed ?? null } : null,
    period: f.period, role: f.role === 'control' ? 'control' : f.tier === 'stretch' ? 'stretch' : null,
    cpUpper: c90.cpUpper ?? null,
    example, miss, preLocked,
    rotation: rotation(months || [], example && example.month, preLocked),
  };
}

// ---------- per-test copy and facts (a config table, not branches through the view) ----------

const satShort = (p) => (PLATFORM_LABEL[p] || p || '').replace(/ VIIRS$/, '');
const andYears = (ys) => (ys.length <= 1 ? ys.join('') : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`);
/**
 * The S-NPP limits footer (scientific-qa M4.5 §1): trust.js regionLimits(f) sentences verbatim. `visible` stays on screen
 * (the S-NPP-not-NOAA-20 line always); `more` sits in a small disclosure; provisional regions add PROVISIONAL_NOTE there.
 */
export function m1Limits(f, provisionalNote = null) {
  return {
    visible: ['Tested with S-NPP, not NOAA-20: the NOAA-20 conversion has not been independently validated in this region.',
      'Daytime only; night-time is untested.',
      `These hidden years only. From ${f.driftFrom || 'the drift years'} on, Aqua’s timing drifted, so later comparisons are unconfirmed; nothing after MODIS is tested.`],
    more: ['Detections, not separate fire events. One region’s result does not transfer to nearby places.',
      ...(f.status === 'provisional' && provisionalNote ? [provisionalNote] : [])],
  };
}

export const TEST_CONFIG = {
  m2: {
    lane1: 'NOAA-20, raw', s1head: 'NOAA-20, read raw.',
    s1line: (m, M) => (m.rawVerdict === 'above' ? `That’s above Aqua’s usual ${M}, but VIIRS sees smaller hotspots.` : 'Raw counts aren’t on Aqua’s scale, so this comparison means little.'),
    s2line: () => 'Ratio and range fitted on other years; only this month’s NOAA-20 count goes in.',
    verdictLine: true, rule: REGION_CASE_RULE.m2, featured: true,
  },
  m1: {
    lane1: 'S-NPP, raw', s1head: 'S-NPP, read raw.',
    // decision D2, verbatim: no raw verdict is stored for S-NPP, so none is described
    s1line: () => 'S-NPP and Aqua detect hotspots differently. Their raw counts aren’t directly comparable.',
    s2line: (rt) => `Ratio and range fitted on training years; ${andYears(((rt && rt.period && rt.period.years) || []).map(String))} were hidden.`,
    verdictLine: false, rule: REGION_CASE_RULE.m1, featured: false,
  },
};

/** Header facts that never hide behind a click (D3): chip, satellite + period + n, role, and a provisional reason line. */
export function regionMeta(rt, f) {
  const chip = rt.status === 'validated' ? '✓ Validated' : rt.status === 'provisional' ? '◐ Provisional' : rt.status;
  const role = rt.role === 'control' ? ' · control' : rt.role === 'stretch' ? ' · stretch region' : '';
  const meta = `${satShort(rt.satellite)} test · ${periodWords(f)} · ${rt.n} months${role}`;
  const reasons = [];
  if (rt.status === 'provisional') {
    // every FAILING stored check is named, and only those (QA Q4, M4.5 Q1): CAR shows both, Punjab the 80% check
    const line = (c, lvl) => `${lvl}% range: ${c.k} of ${c.n} inside; at least ${Math.round(c.threshold * 100)}% required.`;
    if (f.cov90 && f.cov90.passed === false && f.cov90.k != null) reasons.push(line(f.cov90, 90));
    if (f.cov80 && f.cov80.passed === false && f.cov80.k != null) reasons.push(line(f.cov80, 80));
  }
  return { chip, meta, reasons };
}

/**
 * Everything a region's Time Machine needs, from stored files only. series is needed for S-NPP regions (raw count, band).
 * Returns { ...RegionTest, months, facts, meta, cfg } or { region, missing: '<reason>' }.
 */
export function regionCase(id, { manifest, val, m2val, series = null }) {
  const f = regionFacts(manifest, val, m2val, id);
  if (!f) return { region: id, missing: 'no_test' };
  let months;
  if (f.test === 'm2') months = m2TestMonths(m2val, id);
  else {
    const region = manifest.regions.find((r) => r.id === id);
    if (!series) return { region: id, missing: 'series_unavailable' };
    months = m1TestMonths(val, region, series).filter((t) => t.raw != null && t.est != null && t.lo != null && t.hi != null && t.actual != null);
  }
  if (!months.length) return { region: id, missing: 'no_complete_month' };
  const rt = regionTest(manifest, val, m2val, id, months);
  return { ...rt, months, facts: f, meta: regionMeta(rt, f), cfg: TEST_CONFIG[f.test] };
}
export { D7 };
