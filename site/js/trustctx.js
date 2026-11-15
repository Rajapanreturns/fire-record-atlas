// M4.3 region-aware Trust page: URL state, per-region facts and the per-region Predict -> Reveal months.
// Pure (no DOM). Every region number is read from STORED results only (docs/m43/TRUST-CONTEXT.md):
//   M1 (S-NPP): validation.json summary rows for the region (stratum held_out, season all, the region's record method)
//               and its held-out rows; M2 (NOAA-20): m2_validation.json regions[] and month_rows.
// Simple counts of stored per-month fields are labelled descriptive. A pooled-only metric is reported as pooled only,
// never as the region's own value.
import { PLATFORM_LABEL, monthIndex, yearOf } from './core.js';
import { shortName } from './story.js';
import { matched, MONTH_LONG } from './m2.js';
import { nearestRegion } from './monthly.js';

export const ALL = 'all';
export const CUSTOM = 'custom';
const monthWords = (m) => `${MONTH_LONG[monthIndex(m)]} ${yearOf(m)}`;
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const pct = (x) => `${Math.round(x * 100)}%`;

/** The switcher's groups: NOAA-20 (M2) study areas first, then the S-NPP (M1) regions, in manifest order. */
export function trustRegionGroups(manifest) {
  const m2 = ((manifest && manifest.m2_regions) || []).map((r) => ({ id: r.id, name: shortName(r.name), group: 'm2', status: r.status, role: m2Role(r) }));
  const m1 = ((manifest && manifest.regions) || []).filter((r) => ['validated', 'provisional'].includes(r.status))
    .map((r) => ({ id: r.id, name: shortName(r.name), group: 'm1', status: r.status, role: r.role }));
  return [
    { id: 'm2', label: 'NOAA-20 test (M2)', regions: m2 },
    { id: 'm1', label: 'S-NPP test (M1)', regions: m1 },
  ];
}

/** M2 areas carry no role field; the control is named in the manifest description (PREREGISTRATION-M2 §2.2). */
export const m2Role = (r) => (/\(control\)/i.test((r && r.description) || '') ? 'control' : null);

/**
 * The region-status rule as clarified in PREREGISTRATION D7 (M1 §6, used for every region status in M1 and M2):
 * 90% coverage >= 0.85, Clopper-Pearson upper bound >= 0.90, 80% coverage >= 0.75, on the region's own n.
 * Thresholds of a documented rule, compared with stored values; not a new statistic.
 */
export const D7 = { cov90: 0.85, cp90Upper: 0.9, cov80: 0.75, ref: 'thresholds set before testing' };

/** "lat,lon" -> { lat, lon } or null (validated ranges). */
export function parseAt(s) {
  const m = String(s || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]); const lon = Number(m[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

/**
 * URL contract: ?view=trust[&region=<id>|all|custom[&at=<lat>,<lon>]].
 * Returns { mode: 'all' } | { mode: 'region', id, group } | { mode: 'unknown', raw } | { mode: 'custom', at }.
 */
export function resolveTrustRegion(raw, manifest, at = null) {
  if (raw == null || raw === '' || raw === ALL) return { mode: 'all' };
  if (raw === CUSTOM) return { mode: 'custom', at: parseAt(at) };
  for (const g of trustRegionGroups(manifest)) {
    const r = g.regions.find((x) => x.id === raw);
    if (r) return { mode: 'region', id: r.id, group: g.id };
  }
  return { mode: 'unknown', raw: String(raw) };
}

/** The Trust URL for a region id (null/'all' -> the All regions view). Other query keys are kept by main.urlFor. */
export const trustParams = (id, at = null) => ({ view: 'trust', region: id && id !== ALL ? id : undefined, at: id === CUSTOM && at ? `${at.lat},${at.lon}` : undefined });

/** Which region the masthead "Can we trust it?" link should carry, from the current view's params. */
export function trustLinkRegion(params, lastRegion = null, manifest = null) {
  if (!params) return null;
  const ok = (id) => (id && (!manifest || resolveTrustRegion(id, manifest).mode === 'region') ? id : null);
  if (params.view === 'region') return ok(params.region || lastRegion);
  if (params.view === 'trust') return ok(params.region && params.region !== ALL ? params.region : null);
  return null;
}

// ---------- M1 (S-NPP) facts: validation.json ----------

export function m1Rows(val, region) {
  return (val.rows || []).filter((r) => r.region_id === region.id && r.method_id === region.method && r.stratum === 'held_out' && (!val.daynight || r.daynight === val.daynight));
}
function m1Summary(val, region, metric, level = undefined) {
  return (val.summary || []).find((s) => s.region_id === region.id && s.method_id === region.method && s.stratum === 'held_out' && s.season === 'all'
    && (!val.daynight || s.daynight === val.daynight) && s.metric === metric && (level === undefined || s.interval_level === level)) || null;
}
/** k of n from a stored share, only when the share is exactly k/n to the stored precision (else null: show the share). */
export function countFromShare(share, n) {
  if (share == null || !n) return null;
  const k = Math.round(share * n);
  return Math.abs(k / n - share) < 5e-4 ? k : null;
}

export function m1RegionFacts(manifest, val, id) {
  const region = ((manifest && manifest.regions) || []).find((r) => r.id === id);
  if (!region || !val || val.status !== 'evaluated') return null;
  const rows = m1Rows(val, region);
  const scored = rows.filter((r) => r.actual_status === 'observed' && r.actual != null);
  const inside90 = scored.filter((r) => r.inside_interval === true).length;
  const c90 = m1Summary(val, region, 'interval_coverage', 0.9);
  const c80 = m1Summary(val, region, 'interval_coverage', 0.8);
  const mae = m1Summary(val, region, 'mae_log1p', null);
  const width = m1Summary(val, region, 'interval_mean_width_log1p', 0.9);
  const plats = [...new Set(rows.map((r) => r.input_platform))];
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const cov = (s, level) => (s ? { level, share: s.value, n: s.n, k: level === 0.9 ? inside90 : countFromShare(s.value, s.n), threshold: s.threshold, passed: s.passed, ci: s.ci_lo != null ? [s.ci_lo, s.ci_hi] : null, ci_method: s.ci_method,
    cpUpper: level === 0.9 && s.ci_hi != null && /clopper/i.test(s.ci_method || '') ? s.ci_hi : null, field: `validation.summary[region_id=${id}, method_id=${region.method}, stratum=held_out, season=all, metric=interval_coverage, interval_level=${level}]` } : null);
  const drift = ((manifest.eras || []).find((e) => e.id === 'aqua_drift') || {}).start;
  return {
    id, test: 'm1', name: shortName(region.name), fullName: region.name, role: region.role, tier: region.tier, description: region.description,
    status: region.status, statusReasons: [region.status_reason].filter(Boolean),
    satellite: plats.map((p) => PLATFORM_LABEL[p] || p).join(', '), platform: plats[0] || null, daynight: val.daynight,
    period: { kind: 'held_out_years', years, trainedOn: [...(region.trained_on_years || [])].sort((a, b) => a - b) },
    n: scored.length, nRows: rows.length,
    cov90: cov(c90, 0.9), cov80: cov(c80, 0.8),
    error: mae ? { metric: 'mae_log1p', value: mae.value, n: mae.n, field: `validation.summary[region_id=${id}, metric=mae_log1p, method_id=${region.method}, stratum=held_out, season=all]` } : null,
    width90: width ? width.value : null,
    skill: { stored: false, why: 'No skill against a simple guess was computed for the S-NPP record method (the ratio method). The S-NPP test’s stored skill scores compare the more detailed model and the guess with the ratio method (Scientific details). The skill on All regions belongs to the separate NOAA-20 test in other study areas. Per-region skill rows in the file are for other methods and are below the pre-registered minimum sample.' },
    verdict: { stored: false },
    driftFrom: drift ? yearOf(drift) : null,
    method: region.method,
    countedFromRows: { inside90, n: scored.length, matchesStored: c90 ? countFromShare(c90.value, c90.n) === inside90 : null },
  };
}

// ---------- M2 (NOAA-20) facts: m2_validation.json ----------

export function m2RegionFacts(manifest, m2val, id) {
  const reg = ((m2val && m2val.regions) || []).find((r) => r.region_id === id);
  const man = ((manifest && manifest.m2_regions) || []).find((r) => r.id === id);
  if (!reg) return null;
  const w = m2val.window;
  const plat = m2val.method && m2val.method.predictor_platform;
  return {
    id, test: 'm2', name: shortName(man ? man.name : id), fullName: man ? man.name : id, role: m2Role(man), tier: man && man.tier, description: man && man.description,
    status: reg.status, statusLabel: reg.status_label, statusReasons: reg.status_reasons || [],
    satellite: PLATFORM_LABEL[plat] || plat, platform: plat, daynight: m2val.daynight,
    period: { kind: 'window', start: w.start, end: w.end, design: w.design, folds: w.folds },
    n: reg.n,
    cov90: { level: 0.9, share: reg.cov90, n: reg.n, k: reg.cov90_covered, threshold: D7.cov90, passed: reg.cov90 >= D7.cov90, cpUpper: reg.cp90_upper, thresholdRef: D7.ref, field: `m2_validation.regions[region_id=${id}].cov90_covered / n` },
    cov80: { level: 0.8, share: reg.cov80, n: reg.n, k: reg.cov80_covered, threshold: D7.cov80, passed: reg.cov80 >= D7.cov80, thresholdRef: D7.ref, field: `m2_validation.regions[region_id=${id}].cov80_covered / n` },
    bySeason: reg.by_season || null,
    error: reg.mae_log1p != null ? { metric: 'mae_log1p', value: reg.mae_log1p, n: reg.n, field: `m2_validation.regions[region_id=${id}].mae_log1p` } : null,
    width90: reg.mean_width90_log1p,
    skill: { stored: false, why: 'The skill against guessing the usual month is stored only pooled over the NOAA-20 test areas, not for each area.' },
    verdict: { stored: false },
    q3: reg.q3_status || null,
    featuredMonth: reg.featured_month,
    afterYear: yearOf(w.end) + 1,
    method: m2val.method && m2val.method.id,
  };
}

export function regionFacts(manifest, val, m2val, id) {
  return m2RegionFacts(manifest, m2val, id) || m1RegionFacts(manifest, val, id);
}

/** Period words: "<Month YYYY> – <Month YYYY>" (M2 window) or "hidden years <a>, <b> and <c>" (M1). */
export function periodWords(f) {
  if (!f) return '';
  return f.period.kind === 'window' ? `${monthWords(f.period.start)} – ${monthWords(f.period.end)}` : `hidden years ${andList(f.period.years.map(String))}`;
}

/** "40 of 43" (or the stored share when no exact count is available). */
export function covWords(c) {
  if (!c) return 'not stored';
  return c.k != null ? `${c.k} of ${c.n}` : `${pct(c.share)} of ${c.n}`;
}

/** The one-line region answer from status (plain words; the numbers are from facts). */
export function regionAnswer(f) {
  if (!f) return null;
  const sat = f.platform === 'noaa20' ? 'NOAA-20' : f.platform === 'snpp' ? 'S-NPP' : f.satellite;
  const where = `${sat}, daytime, ${periodWords(f)}`;
  if (f.status === 'validated') {
    return { tone: 'ok', lead: 'Validated here, within limits.',
      main: `Tested on ${f.n} hidden months in this region (${where}): the converted 90% range caught Aqua’s real count in ${covWords(f.cov90)}.` };
  }
  if (f.status === 'provisional') {
    // name only the failing checks as "too rarely"; a check that met its threshold is reported as met (QA Q4)
    const checks = [f.cov90, f.cov80].filter((c) => c && c.threshold != null);
    const lvl = (c) => `the ${Math.round(c.level * 100)}% range`;
    const fail = checks.filter((c) => c.passed === false);
    const ok = checks.filter((c) => c.passed === true);
    const failTxt = fail.length === 1 ? `${lvl(fail[0])} caught Aqua’s real value too rarely (${covWords(fail[0])}; at least ${pct(fail[0].threshold)} required)`
      : `${fail.map((c) => `${lvl(c)} (${covWords(c)}; at least ${pct(c.threshold)} required)`).join(' and ')} both caught Aqua’s real value too rarely`;
    const okTxt = ok.map((c) => `${lvl(c)} met its threshold (${covWords(c)}; ${pct(c.threshold)})`).join('; ');
    const cp = f.cov90 && f.cov90.cpUpper != null && f.cov90.cpUpper < D7.cp90Upper ? ` Its stored upper confidence bound for 90% coverage (Clopper-Pearson), ${f.cov90.cpUpper.toFixed(3)}, is also below the ${D7.cp90Upper.toFixed(2)} the status rule requires.` : '';
    const lead = 'Provisional: not yet reliable.';
    if (!fail.length) return { tone: 'prov', lead, main: `In the pre-registered test (${where}, ${f.n} hidden months), the region did not meet the status rule.${cp}` };
    return { tone: 'prov', lead,
      main: `In the pre-registered test (${where}, ${f.n} hidden months), ${failTxt}.${okTxt ? ` ${okTxt.charAt(0).toUpperCase()}${okTxt.slice(1)}.` : ''}${cp}` };
  }
  return { tone: 'none', lead: 'Not validated.', main: 'No conversion test passed for this region.' };
}

// ---------- the region's Predict -> Reveal months: fixed rules over the stored test months ----------

export const REGION_CASE_RULE = {
  m2: {
    success: 'This area’s opening month (picked by the pre-locked random rule before any result was seen) if it landed inside the 90% range, got the matching verdict and its range does not cross a usual-range edge; otherwise the first such month in the main burning season (file order), then in any season; otherwise the first month inside the 90% range.',
    miss: 'Of this area’s months where Aqua fell outside the 90% range, the one with the largest Aqua count, preferring months whose verdict also did not match.',
  },
  m1: {
    success: 'Of this region’s hidden test months inside the 90% range, the one with the median error (|log(1 + estimate) − log(1 + Aqua)|, lower middle when even; ties: earliest), so the example is neither the best nor the worst month.',
    miss: 'Of this region’s hidden test months where Aqua fell outside the 90% range, the one with the largest Aqua count (ties: earliest).',
  },
};

const byCountDesc = (a, b) => (b.actual - a.actual) || (a.month < b.month ? -1 : 1);

/** M2: { success, miss } of { row, how } from this area's month_rows only (all are held-out months). */
export function m2RegionCases(m2val, id) {
  const rows = ((m2val && m2val.month_rows) || []).filter((r) => r.region_id === id && r.actual != null);
  const reg = ((m2val && m2val.regions) || []).find((r) => r.region_id === id);
  const clean = (r) => r && r.inside90 === true && matched(r) === true && !r.range_crosses_edge;
  let success = null; let sHow = null;
  const feat = reg && rows.find((r) => r.month === reg.featured_month);
  if (clean(feat)) { success = feat; sHow = 'rule: this area’s pre-locked opening month'; }
  else if (rows.find((r) => clean(r) && r.season === 'active')) { success = rows.find((r) => clean(r) && r.season === 'active'); sHow = 'fallback: first clean success in the main burning season, file order'; }
  else if (rows.find(clean)) { success = rows.find(clean); sHow = 'fallback: first clean success in file order'; }
  else if (rows.find((r) => r.inside90 === true)) { success = rows.find((r) => r.inside90 === true); sHow = 'fallback: first month inside the 90% range'; }
  const out = rows.filter((r) => r.inside90 === false);
  const both = out.filter((r) => matched(r) === false).sort(byCountDesc);
  const miss = both[0] || out.sort(byCountDesc)[0] || null;
  const mHow = both[0] ? 'rule: outside the 90% range and verdict did not match, largest Aqua count' : miss ? 'rule: outside the 90% range, largest Aqua count' : null;
  return { success: success ? { row: success, how: sHow } : null, miss: miss ? { row: miss, how: mHow } : null, n: rows.length, nInside: rows.filter((r) => r.inside90 === true).length };
}

/** M1: { success, miss } of { row, how } from this region's held-out rows of its record method only. */
export function m1RegionCases(val, region) {
  if (!val || !region) return { success: null, miss: null, n: 0, nInside: 0 };
  const rows = m1Rows(val, region).filter((r) => r.actual_status === 'observed' && r.actual != null && r.lo != null && r.hi != null);
  // |error| on log(1 + count), the scale of the stored score; the median month, so the example is neither the best nor the worst
  const err = (r) => Math.abs(Math.log1p(r.predicted) - Math.log1p(r.actual));
  const inside = rows.filter((r) => r.inside_interval === true).sort((a, b) => (err(a) - err(b)) || (a.month < b.month ? -1 : 1));
  const out = rows.filter((r) => r.inside_interval === false).sort(byCountDesc);
  const mid = inside.length ? inside[Math.floor((inside.length - 1) / 2)] : null;
  return {
    success: mid ? { row: mid, how: 'rule: inside the 90% range, median error' } : null,
    miss: out[0] ? { row: out[0], how: 'rule: outside the 90% range, largest Aqua count' } : null,
    n: rows.length, nInside: inside.length,
  };
}

/** What to say when a region has no success or no miss (never invent one). */
export function noCaseLine(kind, n) {
  return kind === 'miss' ? `In this region, all ${n} test months landed inside the 90% range, so there is no miss to show.`
    : `In this region, none of the ${n} test months landed inside the 90% range, so there is no success to show.`;
}

/** For a custom map location: the nearest study region (any test), or null. Reuses the map card's rule. */
export function nearestStudyRegion(manifest, at) {
  if (!at) return null;
  const all = [...((manifest && manifest.m2_regions) || []), ...((manifest && manifest.regions) || []).filter((r) => ['validated', 'provisional'].includes(r.status))];
  return nearestRegion(all, at.lat, at.lon);
}

export const UNSUPPORTED_LINE = 'No conversion has been validated for this exact place.';


/** inside / above / below from stored fields; 'unknown' when the stored inside flag or the bounds are missing. */
export function sideOf(inside, actual, lo, hi) {
  if (inside === true) return 'inside';
  if (inside !== false || actual == null) return 'unknown';
  if (hi != null && actual > hi) return 'above';
  if (lo != null && actual < lo) return 'below';
  return 'unknown';
}

/** Typical factor between estimate and Aqua (count + 1): exp(stored mean |log error|), an exact transform of mae_log1p
 *  (the geometric mean of the ratio of count + 1). Shown as approximate. */
export const typicalFactor = (maeLog1p) => (Number.isFinite(maeLog1p) ? Math.exp(maeLog1p) : null);

/** The M2 area's secondary S-NPP re-check (q3_status), in plain words; never called a clean replication when provisional. */
export function q3Line(q) {
  const yrs = (q.label || '').match(/(\d{4})-(\d{4})/);
  const when = yrs ? `${yrs[1]}–${yrs[2]}` : 'the S-NPP years';
  const need = ((q.reasons || []).join(' ').match(/<\s*([\d.]+)/) || [])[1];
  // counts, not rounded percentages: 0.847 must never read as "85% ... below the 85% needed" (QA Q1)
  const k = countFromShare(q.cov90, q.n);
  const held = q.cov90 == null ? 'no coverage stored' : `its 90% range held Aqua’s count in ${k != null ? `${k} of ${q.n}` : `${(q.cov90 * 100).toFixed(1)}% of ${q.n}`} months`;
  return `The earlier S-NPP method was re-checked here on ${when} (a secondary check that cannot change this result): ${q.status}; ${held}${q.status === 'provisional' && need ? `, below the ${pct(Number(need))} needed` : ''}.`;
}

/** Per-season coverage for an M2 area, from the stored regions[].by_season counts (descriptive). */
export function seasonLine(f) {
  const b = f && f.bySeason; if (!b || !b.active || !b.off) return null;
  const outAct = b.active.n - b.active.cov90_covered; const outOff = b.off.n - b.off.cov90_covered;
  const where = outAct === 0 && outOff > 0 ? `; all ${outOff} months outside the range were off-season` : '';
  return `By season: inside the 90% range in ${b.active.cov90_covered} of ${b.active.n} months of the pre-registered test season and ${b.off.cov90_covered} of ${b.off.n} off-season months${where}.`;
}

/**
 * One mark per stored test month, in time order: { month, inside, side: 'inside'|'above'|'below' }. Descriptive:
 * the inside count equals the stored k (tests check it). M2: month_rows inside90/lo90/hi90; M1: held-out rows inside_interval/lo/hi.
 */
export function regionMonthMarks(manifest, val, m2val, id) {
  const m2rows = ((m2val && m2val.month_rows) || []).filter((r) => r.region_id === id);
  if (m2rows.length) {
    return m2rows.filter((r) => r.actual != null).sort((a, b) => (a.month < b.month ? -1 : 1))
      .map((r) => ({ month: r.month, inside: r.inside90 === true, side: sideOf(r.inside90, r.actual, r.lo90, r.hi90), row: r }));
  }
  const region = ((manifest && manifest.regions) || []).find((r) => r.id === id);
  if (!region || !val) return [];
  return m1Rows(val, region).filter((r) => r.actual_status === 'observed' && r.actual != null).sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((r) => ({ month: r.month, inside: r.inside_interval === true, side: sideOf(r.inside_interval, r.actual, r.lo, r.hi), row: r }));
}

// ---------- M4.5: routing, region order and the region select ----------

/** Hashes and params that mean "the full evidence" (old deep links into the All-regions view). */
export const EVIDENCE_HASHES = ['#decades', '#tests', '#science', '#pr-h'];
/** Hashes that open the evidence disclosure on a REGION page (its scoped explorer / month table live there). */
export const REGION_EVIDENCE_HASHES = ['#evidence', '#decades', '#tests'];

/**
 * Where ?view=trust goes (pure; table-tested). params: { region, at, science, pick, step, machine }; hash: location.hash.
 * Returns { mode: 'machine'|'all'|'custom'|'unknown', id?, raw?, normalise?: {region, machine}, openEvidence? }.
 *  - no region + an evidence signal (old All-regions deep links) -> the hub ('all');
 *  - no region otherwise -> the default region's Time Machine: the first validated NOAA-20 area in manifest order;
 *  - region=all -> the hub ("Full scientific evidence"); custom -> the unsupported-location view; unknown -> hub + note;
 *  - any of the 9 regions -> its Time Machine; machine=1 is an alias, normalised away.
 */
export function trustRoute(params, hash, manifest) {
  const p = params || {}; const hsh = hash || '';
  const evidenceSignal = EVIDENCE_HASHES.includes(hsh) || !!p.science || !!p.pick || !!p.step;
  const raw = p.region;
  if (raw == null || raw === '') {
    if (evidenceSignal) return { mode: 'all' };
    const def = ((manifest && manifest.m2_regions) || []).find((r) => r.status === 'validated');
    if (!def) return { mode: 'all' };
    return { mode: 'machine', id: def.id, normalise: { region: def.id, machine: null }, openEvidence: hsh === '#evidence' };
  }
  const sel = resolveTrustRegion(raw, manifest, p.at);
  if (sel.mode === 'all') return { mode: 'all' };
  if (sel.mode === 'custom') return { mode: 'custom', at: sel.at };
  if (sel.mode === 'unknown') return { mode: 'unknown', raw: sel.raw };
  return { mode: 'machine', id: sel.id, normalise: p.machine ? { machine: null } : null, openEvidence: REGION_EVIDENCE_HASHES.includes(hsh) || !!p.science };
}

/** The nine study regions west -> east by bbox-centre longitude (GEO.md §1; ties by id). Derived at runtime, never listed. */
export function westEast(manifest) {
  const m2 = ((manifest && manifest.m2_regions) || []).map((r) => ({ r, test: 'm2' }));
  const m1 = ((manifest && manifest.regions) || []).filter((r) => ['validated', 'provisional'].includes(r.status)).map((r) => ({ r, test: 'm1' }));
  return [...m2, ...m1].filter(({ r }) => Array.isArray(r.bbox) && r.bbox.length === 4).map(({ r, test }) => {
    const [w, s, e, n] = r.bbox;
    return { id: r.id, name: shortName(r.name), fullName: r.name, status: r.status, test, bbox: r.bbox, cx: (w + e) / 2, cy: (s + n) / 2, role: test === 'm2' ? m2Role(r) : r.role, held: r.held_out_years || null };
  }).sort((a, b) => a.cx - b.cx || (a.id < b.id ? -1 : 1));
}

export const statusChip = (status) => (status === 'validated' ? '✓ Validated' : status === 'provisional' ? '◐ Provisional' : status);
export const testWord = (test) => (test === 'm2' ? 'NOAA-20 test' : 'S-NPP test');
/** Select option (QA Q2: "… test" where no period is adjacent). */
export const regionOptionText = (x) => `${x.name} · ${statusChip(x.status)} · ${testWord(x.test)}`;
