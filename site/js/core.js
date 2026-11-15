// Pure rules shared by the views and by tests/site. No DOM, no d3.
// Everything the UI decides about a month is derived from data fields (record.source,
// native[platform].status, manifest.eras), never from the calendar year.

export const PLATFORMS = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21'];
export const VIIRS_PLATFORMS = ['snpp', 'noaa20', 'noaa21'];
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LETTER = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
export const RULERS = ['raw', 'record', 'alt'];
export const MODEL_LANES = ['aqua_equiv_operator', 'aqua_equiv_ratio'];
/** URL compatibility: the third ruler used to be called 'ratio'. */
export const normalizeRuler = (r) => (r === 'ratio' ? 'alt' : RULERS.includes(r) ? r : null);
export const SUPPORTED_MAJOR = 1;

export const PLATFORM_LABEL = {
  terra: 'Terra MODIS', aqua: 'Aqua MODIS', snpp: 'S-NPP VIIRS', noaa20: 'NOAA-20 VIIRS', noaa21: 'NOAA-21 VIIRS',
};

export const NATIVE_STATUS_WORD = {
  observed: 'observed',
  not_observed: 'not observed',
  not_in_archive: 'not in archive',
  excluded: 'excluded',
  unknown: 'unknown status',
};
export const NATIVE_STATUS_NOTE = {
  observed: 'FIRMS archive covers this month. 0 means no detections were reported, not that the month was fire-free.',
  not_observed: 'The platform was operating but this month is missing (outage). Not a zero.',
  not_in_archive: 'Outside this platform’s mission or not ingested. Not a zero.',
  excluded: 'Removed by a pre-registered quality rule. Never fitted, never scored.',
  unknown: 'Status value not recognised by this version of the site.',
};

export const RECORD_SOURCE_WORD = {
  observed_aqua: 'measured by Aqua',
  modelled_from_viirs: 'modelled from VIIRS',
  blended: 'blend of Aqua and VIIRS',
  terra_only: 'Terra only, no Aqua-scale value',
  not_observed: 'not observed',
  unknown: 'unknown source',
};

export const VERDICT = {
  above: { word: 'above usual', glyph: 'above' },
  within: { word: 'within usual', glyph: 'within' },
  below: { word: 'below usual', glyph: 'below' },
  unknown: { word: 'can’t tell', glyph: 'unknown' },
  none: { word: 'not observed', glyph: 'none' },
};

export const QUALITY_WORD = {
  nrt_data: 'near-real-time data (may be revised)',
  partial_month: 'partial month',
  aqua_drift: 'Aqua’s timing drifted: comparison unconfirmed',
  terra_only: 'Terra only',
  aqua_outage: 'Aqua outage',
  aqua_outage_2020: 'Aqua outage (pre-registered exclusion)',
  terra_outage: 'Terra outage',
  input_outage: 'VIIRS input month excluded',
  snpp_ended: 'S-NPP data ended',
  low_count: 'fewer than 10 native detections: estimate unstable',
  extrapolated: 'outside the method’s training range',
  post_modis: 'after MODIS: no Aqua check possible',
  fixture: 'fixture (synthetic)',
  unvalidated_method: 'method not validated',
};

const KNOWN_NATIVE = new Set(['observed', 'not_observed', 'not_in_archive', 'excluded']);
const KNOWN_SOURCES = new Set(Object.keys(RECORD_SOURCE_WORD));
const VIIRS_DERIVED = new Set(['modelled_from_viirs', 'blended']);

// ---------- envelope and safety ----------

/** Only allow a relative path of simple segments for ?data= / ?validation= (no scheme, no '..'). */
export function safeRelPath(param, fallback) {
  if (typeof param !== 'string' || param === '') return fallback;
  const ok = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(param) && !param.split('/').some((s) => s === '..' || s.startsWith('.'));
  return ok ? param : fallback;
}

export function checkEnvelope(doc, expectedFile) {
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'File is not a JSON object.' };
  if (doc.file !== expectedFile) return { ok: false, error: `Expected a “${expectedFile}” file, got “${doc.file}”.` };
  const major = Number(String(doc.contract_version || '').split('.')[0]);
  if (major !== SUPPORTED_MAJOR) return { ok: false, error: `Contract version ${doc.contract_version} is not supported (this site reads ${SUPPORTED_MAJOR}.x).` };
  return { ok: true };
}

export const isFixtureDoc = (doc) => !!doc && (doc.kind === 'fixture' || !!doc.watermark);

// ---------- month helpers ----------

export const yearOf = (m) => Number(m.slice(0, 4));
export const monthIndex = (m) => Number(m.slice(5, 7)) - 1;
export const monthLabel = (m) => `${MONTH_ABBR[monthIndex(m)]} ${yearOf(m)}`;

export function nativeStatus(row, platform) {
  const c = row && row.native && row.native[platform];
  if (!c) return 'unknown';
  return KNOWN_NATIVE.has(c.status) ? c.status : 'unknown';
}
export function nativeN(row, platform) {
  return nativeStatus(row, platform) === 'observed' && Number.isFinite(row.native[platform].n) ? row.native[platform].n : null;
}
export function recordSource(row) {
  const s = row && row.record && row.record.source;
  return KNOWN_SOURCES.has(s) ? s : 'unknown';
}
export const isViirsDerived = (row) => VIIRS_DERIVED.has(recordSource(row));

/**
 * M4.4 (UI-01): the "Aqua only" record as the region page shows it. A month whose stored record was filled from VIIRS
 * (Strategy A gap filling, `modelled_from_viirs` / `blended`) is shown as NOT observed in Aqua, with no Aqua-scale value
 * and no verdict, exactly as the NOAA-20 areas store their outage months. The stored estimate is kept, untouched, on
 * `gap_estimate` (and in `modelled`) so the explicitly labelled VIIRS layer can still show it. Stored files are never
 * changed; observed rows are returned as the same objects.
 */
export function aquaOnlyMonths(months) {
  return (months || []).map((r) => {
    if (!isViirsDerived(r)) return r;
    return {
      ...r,
      record: { source: 'not_observed', value: null, lo: null, hi: null, method_id: null, lane: null, value_kind: 'unavailable' },
      verdict: { class: 'cant_tell', rule_id: r.verdict ? r.verdict.rule_id : null, reason: 'no_record' },
      gap_estimate: { ...r.record, stored_verdict: r.verdict ? r.verdict.class : null },
    };
  });
}

/** Era of a month according to manifest.eras (data), falling back to the row's own era field. */
export function eraFor(month, eras, rowEra) {
  if (Array.isArray(eras)) {
    for (const e of eras) {
      if (month >= e.start && (e.end == null || month <= e.end)) return e.id;
    }
  }
  return rowEra || null;
}

export function isLessCertain(row) {
  const q = row.quality || [];
  return q.includes('aqua_drift') || q.includes('post_modis') || q.includes('extrapolated') || row.era === 'aqua_drift' || row.era === 'post_modis';
}

// ---------- baseline envelope (descriptive screening rule, stated in the UI) ----------

export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

/**
 * Typical month from native Aqua months that are observed, inside the manifest era
 * `modis_only` (one instrument, no conversion), and not flagged partial.
 * Returns 12 entries {n_years, years[], values[], p10, p50, p90}.
 */
export const MIN_BASELINE_YEARS = 5;
export function baselineEnvelope(months, eras) {
  const per = Array.from({ length: 12 }, () => ({ years: [], values: [] }));
  for (const r of months) {
    if (eraFor(r.month, eras, r.era) !== 'modis_only') continue;
    if (nativeStatus(r, 'aqua') !== 'observed') continue;
    if ((r.quality || []).includes('partial_month')) continue;
    const v = nativeN(r, 'aqua');
    if (v == null) continue;
    const b = per[monthIndex(r.month)];
    b.years.push(yearOf(r.month));
    b.values.push(v);
  }
  return per.map((b) => {
    const s = [...b.values].sort((x, y) => x - y);
    return { n_years: s.length, years: b.years, values: s, pairs: b.years.map((y, i) => [y, b.values[i]]), p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
  });
}

/** Verdict of one value (with optional interval) against one calendar month of the envelope. */
export function verdictFor(v, env, minYears = MIN_BASELINE_YEARS) {
  if (!v || v.value == null) return v && v.kind === 'none' && v.missing ? 'none' : 'unknown';
  if (!env || env.n_years < minYears || env.p10 == null || env.p90 == null) return 'unknown';
  if (v.lowCount && v.kind !== 'observed') return 'unknown';
  const lo = v.lo != null ? v.lo : v.value;
  const hi = v.hi != null ? v.hi : v.value;
  if (lo > env.p90) return 'above';
  if (hi < env.p10) return 'below';
  if (lo >= env.p10 && hi <= env.p90) return 'within';
  return 'unknown'; // interval straddles the edge of the usual range
}

// ---------- rulers ----------

/**
 * Which modelled lane the record uses for VIIRS-derived months, and the other ("alternative") lane.
 * Prefers the lane the record actually used, then the region's declared method, then the operator.
 */
export function recordLanes(months, regionMethod) {
  const counts = {};
  for (const r of months) if (isViirsDerived(r) && r.record && MODEL_LANES.includes(r.record.lane)) counts[r.record.lane] = (counts[r.record.lane] || 0) + 1;
  const used = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const declared = MODEL_LANES.find((l) => months.some((r) => r.modelled && r.modelled[l] && r.modelled[l].method_id === regionMethod)) || (MODEL_LANES.includes(regionMethod) ? regionMethod : null);
  const record = used || declared || 'aqua_equiv_operator'; // the record's own lanes are authoritative
  return { record, alt: MODEL_LANES.find((l) => l !== record) };
}

/**
 * The value a month shows on a ruler.
 * 'record': record as assembled by the analysis.
 * 'alt'   : identical for every month not derived from VIIRS; VIIRS-derived months switch to `altLane`
 *           (the method the record did not adopt), so the reader can see what that choice changes.
 * 'raw'   : no Aqua-scale value at all (native lanes only, no verdict).
 */
export function rulerValue(row, ruler, altLane = 'aqua_equiv_ratio') {
  const src = recordSource(row);
  const lowCount = (row.quality || []).includes('low_count');
  if (ruler === 'raw') return { value: null, lo: null, hi: null, kind: 'none', source: src, lane: null, method_id: null, noVerdict: true };
  const rec = row.record || {};
  const fromRecord = {
    value: rec.value ?? null, lo: rec.lo ?? null, hi: rec.hi ?? null,
    kind: src === 'observed_aqua' ? 'observed' : src === 'modelled_from_viirs' ? 'modelled' : src === 'blended' ? 'blended' : 'none',
    missing: src === 'not_observed', source: src, lane: rec.lane ?? null, method_id: rec.method_id ?? null, lowCount,
  };
  if (ruler === 'record' || !VIIRS_DERIVED.has(src)) return fromRecord;
  const lane = ruler === 'ratio' ? 'aqua_equiv_ratio' : altLane;
  const r = row.modelled && row.modelled[lane];
  if (!r || r.status !== 'estimated' || r.value == null) {
    return { value: null, lo: null, hi: null, kind: 'none', source: src, lane, method_id: r ? r.method_id : null, status: r ? r.status : 'not_computed', lowCount };
  }
  return { value: r.value, lo: r.lo ?? null, hi: r.hi ?? null, kind: 'modelled', source: src, lane, method_id: r.method_id, lowCount };
}

const EXPORT_CLASS = { above: 'above', within: 'within', below: 'below', cant_tell: 'unknown' };
/**
 * Verdict for a month on a ruler. On the record ruler the exported months[].verdict wins (contract 1.1);
 * the browser rule is only a fallback, and is used for the alternative ruler (same rule, same baseline).
 * Returns {cls, source: 'export'|'browser'|'none'}.
 */
export function monthVerdict(row, ruler, env, altLane) {
  if (ruler === 'raw') return { cls: null, source: 'none' };
  const v = rulerValue(row, ruler, altLane);
  const exp = row.verdict && EXPORT_CLASS[row.verdict.class];
  const sameAsRecord = ruler === 'record' || !isViirsDerived(row);
  if (exp && sameAsRecord) {
    // a missing record is still drawn as "not observed", whatever class the export gives it
    if (v.value == null && v.missing) return { cls: 'none', source: 'export' };
    return { cls: exp, source: 'export' };
  }
  return { cls: verdictFor(v, env[monthIndex(row.month)]), source: 'browser' };
}

/** Change report between the record ruler and another ruler. Observed Aqua is compared too, as a check. */
export function classChanges(months, env, ruler, altLane) {
  let total = 0; let changed = 0; let observedTotal = 0; let observedChanged = 0;
  for (const r of months) {
    const a = monthVerdict(r, 'record', env, altLane).cls;
    const b = monthVerdict(r, ruler, env, altLane).cls;
    if (isViirsDerived(r)) { total += 1; if (a !== b) changed += 1; }
    if (recordSource(r) === 'observed_aqua') { observedTotal += 1; if (a !== b || rulerValue(r, 'record').value !== rulerValue(r, ruler, altLane).value) observedChanged += 1; }
  }
  return { total, changed, observedTotal, observedChanged };
}

/**
 * Usual-month envelope. Prefers the exported series.baseline (contract 1.1); falls back to the browser
 * computation from native Aqua. `values` (for colour bins only) always come from the observed months.
 */
export function envelopeFor(series, eras) {
  const local = baselineEnvelope(series.months, eras);
  const b = series.baseline;
  if (!b || !Array.isArray(b.entries) || b.entries.length !== 12) return { env: local, source: 'browser', minYears: MIN_BASELINE_YEARS };
  const env = Array.from({ length: 12 }, (_, i) => {
    const e = b.entries.find((x) => x.month === i + 1) || {};
    // baseline points = only the years the exported band is built from (scientific-qa M4.1 C1: the browser era
    // starts mid-year, so its partial first year used to add an extra point against the band)
    const ys = new Set(e.years || []);
    const pairs = (local[i].pairs || []).filter(([y]) => ys.has(y));
    const values = pairs.map(([, v]) => v).sort((x, y) => x - y);
    return { n_years: e.n_years ?? 0, years: e.years || [], values, pairs, p10: e.p10 ?? null, p50: e.p50 ?? null, p90: e.p90 ?? null };
  });
  return { env, source: 'export', minYears: b.min_years ?? MIN_BASELINE_YEARS, meta: b };
}

// ---------- colour classes (bins shown in the legend) ----------

function nice(x) {
  if (x <= 0) return 0;
  if (x < 1) return Math.round(x * 10) / 10;
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  const r = m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 3 : m < 7.5 ? 5 : 10;
  return r * p;
}
/** Four ascending thresholds giving 5 non-zero classes, from quintiles of positive values, rounded. */
export function thresholdsFrom(values) {
  const s = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const t = [0.2, 0.4, 0.6, 0.8].map((p) => nice(quantile(s, p)));
  for (let i = 1; i < t.length; i += 1) if (t[i] <= t[i - 1]) t[i] = t[i - 1] * 2 || 1;
  return t;
}
/** 0 = observed zero, 1..5 ramp classes, null = no value. */
export function classOf(value, thresholds) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  if (!thresholds) return 1;
  let c = 1;
  for (const t of thresholds) if (value > t) c += 1;
  return c;
}
export function aquaScaleThresholds(env) {
  return thresholdsFrom(env.flatMap((e) => e.values));
}
export function nativeThresholds(months, platform) {
  return thresholdsFrom(months.map((r) => nativeN(r, platform)).filter((v) => v != null));
}

// ---------- calendar rows ----------

export function yearRows(months) {
  const by = new Map();
  for (const r of months) {
    const y = yearOf(r.month);
    if (!by.has(y)) by.set(y, Array(12).fill(null));
    by.get(y)[monthIndex(r.month)] = r;
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([year, cells]) => {
    const present = cells.filter(Boolean);
    const hasAqua = present.some((r) => nativeStatus(r, 'aqua') === 'observed');
    const hasModel = present.some((r) => Object.values(r.modelled || {}).some((m) => m && m.status === 'estimated'));
    const viirsPlatforms = VIIRS_PLATFORMS.filter((p) => present.some((r) => nativeStatus(r, p) === 'observed'));
    return {
      year, cells,
      heldOut: present.some((r) => r.held_out === true),
      train: present.some((r) => r.split === 'train'),
      lessCertain: present.some(isLessCertain),
      braid: hasAqua && hasModel,
      hasAqua, hasModel, viirsPlatforms,
    };
  });
}

/** Latest month that has an Aqua-scale record value. */
export function latestRecordMonth(months) {
  for (let i = months.length - 1; i >= 0; i -= 1) if (months[i].record && months[i].record.value != null) return months[i];
  return null;
}

// ---------- sensors timeline ----------

export function decimalYear(date) {
  if (!date) return null;
  const [y, m, d] = String(date).split('-').map(Number);
  if (!Number.isFinite(y)) return null;
  if (!m) return y + 0.5; // a bare year: draw at mid-year, labelled as a year
  return y + (m - 1) / 12 + ((d || 15) - 1) / 365;
}
// v1.2 sensor event kinds, with the v1.0 names accepted as synonyms.
const ARCHIVE_START = ['archive_start', 'firms_data_start'];
const ARCHIVE_END = ['archive_end', 'firms_data_end'];
const RETIRE = ['ended', 'end_of_operations', 'decommission'];
const SCIENCE_END = ['projected_end_of_science', 'end_of_science'];
const firstOf = (ev, kinds, pred = () => true) => kinds.map((k) => ev.find((e) => e.kind === k && e.date && pred(e))).find(Boolean) || null;

/**
 * Spans for the instrument strip. The bar runs over FIRMS archive availability (archive_start..archive_end),
 * the launch is a separate tick, and an archive end is never presented as retirement.
 */
export function missionSpan(mission) {
  const ev = mission.events || [];
  const launch = firstOf(ev, ['launch']);
  const archiveStart = firstOf(ev, ARCHIVE_START);
  const start = archiveStart || launch;
  const archiveEnd = firstOf(ev, ARCHIVE_END, (e) => e.status !== 'projected');
  const retired = firstOf(ev, RETIRE, (e) => e.status === 'actual');
  const scienceEnd = firstOf(ev, [...SCIENCE_END, ...RETIRE], (e) => e.status === 'projected');
  const endActual = archiveEnd || retired;
  return {
    start, launch, archiveStart, archiveEnd, retired,
    endActual, endActualKind: archiveEnd ? 'archive_end' : retired ? 'ended' : null,
    endProjected: scienceEnd, endUnknown: !endActual && !scienceEnd,
    drift: firstOf(ev, ['drift_start']), constellationExit: firstOf(ev, ['constellation_exit']),
  };
}

/**
 * Per-year overpass local solar time for one platform (contract 1.2: sensors.overpass_lst[], top level).
 * Measured from FIRMS detections (a proxy for drift, not orbit telemetry). Years with n = 0 are dropped.
 */
export function overpassSeries(sensors, platform, daynight = 'D', scope = null) {
  let arr = (sensors && Array.isArray(sensors.overpass_lst)) ? sensors.overpass_lst.filter((o) => o.platform === platform) : [];
  // Entries are per region_scope; never pool scopes into one line. Use the requested scope, or the only one.
  const scopes = [...new Set(arr.map((o) => o.region_scope ?? null))];
  if (scope != null && scopes.includes(scope)) arr = arr.filter((o) => (o.region_scope ?? null) === scope);
  else if (scopes.length === 1) arr = arr.filter((o) => (o.region_scope ?? null) === scopes[0]);
  else return [];
  return arr.filter((o) => o.platform === platform && (!daynight || !o.daynight || o.daynight === daynight) && Number.isFinite(o.median_local_solar_time_h))
    .map((o) => ({ year: Number(o.year), h: o.median_local_solar_time_h, iqr: o.iqr_h || null, n: o.n ?? null, scope: o.region_scope || null, ref: o.source_ref || null }))
    .sort((x, y) => x.year - y.year);
}
export function fmtHour(h) {
  if (!Number.isFinite(h)) return '?';
  let hh = Math.floor(h); let mm = Math.round((h - hh) * 60);
  if (mm === 60) { hh += 1; mm = 0; }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Label for the usual-month baseline period, from the data (baseline.period, else the entries' years). */
export function baselinePeriodLabel(series, env) {
  const p = series && series.baseline && series.baseline.period;
  if (p) {
    const y = (v) => (v == null ? null : String(v).slice(0, 4));
    const a = y(p.start_year ?? p.start ?? (Array.isArray(p) ? p[0] : null));
    const b = y(p.end_year ?? p.end ?? (Array.isArray(p) ? p[p.length - 1] : null));
    if (a && b) return a === b ? a : `${a}–${b}`;
  }
  const years = [...new Set((env || []).flatMap((e) => e.years || []))].sort();
  return years.length ? `${years[0]}–${years[years.length - 1]}` : 'none';
}

/** Regions in the core analysis: v1.2 `tier`/`core` if present, else not described as a stretch region. */
export function isCoreRegion(r) {
  if (!r) return false;
  if (r.tier) return r.tier === 'core';
  if (typeof r.core === 'boolean') return r.core;
  return !/stretch/i.test(`${r.description || ''} ${r.status_reason || ''}`);
}
/** Regions in the pooled primary analysis: tier core + control (pre-registration Deviation D1). */
export function isPooledRegion(r) {
  if (!r) return false;
  if (r.tier) return r.tier === 'core' || r.tier === 'control';
  return isCoreRegion(r);
}
/** Default Trust region: first validated core pilot, then validated core, then any core, then any. */
export function defaultTrustRegion(manifest, ids) {
  const rs = (manifest.regions || []).filter((r) => !ids || ids.includes(r.id));
  const pick = rs.find((r) => r.status === 'validated' && isCoreRegion(r) && r.role === 'pilot')
    || rs.find((r) => r.status === 'validated' && isCoreRegion(r))
    || rs.find((r) => r.status === 'validated' && isPooledRegion(r))
    || rs.find((r) => isCoreRegion(r)) || rs.find((r) => isPooledRegion(r)) || rs[0];
  return pick ? pick.id : (ids || [])[0];
}

/** One audit flag as display text (contract 1.2 audit_flags[]). Every number comes from the flag object. */
export function formatAuditFlag(f) {
  if (typeof f === 'string') return { title: f, detail: '', flagged: null };
  const num = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 1000) / 1000)) : null);
  const unit = f.unit ? ` ${f.unit}` : '';
  const lo = f.ci_low ?? f.ci_lo; const hi = f.ci_high ?? f.ci_hi;
  const ci = num(lo) != null && num(hi) != null ? ` (${f.ci_level ? `${Math.round(f.ci_level * 100)}% ` : ''}CI ${num(lo)} to ${num(hi)})` : '';
  const val = num(f.value);
  const state = f.flagged === true ? 'flagged' : f.flagged === false ? 'not flagged' : 'not assessed';
  const ref = f.source_ref ? `${f.source_ref.path}${f.source_ref.key ? ` → ${f.source_ref.key}` : ''}` : (f.source || f.ref || null);
  const period = f.period ? `${typeof f.period === 'object' ? `${f.period.start_year ?? f.period.start}–${f.period.end_year ?? f.period.end}` : f.period}` : '';
  const headline = [val != null ? `${val}${unit}${ci}` : 'no value', f.n != null ? `n = ${f.n}` : '', period].filter(Boolean).join(' · ');
  const rule = f.threshold_rule || '';
  const note = f.note && f.note !== 'fixture' ? f.note : '';
  const detail = [headline, rule ? `rule: ${rule}` : '', note, ref ? `source: ${ref}` : ''].filter(Boolean).join(' · ');
  return { title: f.label || f.id || 'audit flag', headline, rule, note, ref, detail, flagged: f.flagged ?? null, state, scope: f.scope || null, id: f.id || null };
}

// ---------- CSV (CONTRACT §2f) ----------

export const CSV_COLUMNS = ['region_id', 'month', 'lane', 'platform', 'value', 'lo', 'hi', 'interval_level', 'value_kind', 'status', 'record_source',
  'method_id', 'method_version', 'held_out', 'quality_flags', 'filter_id', 'daynight', 'strategy_id', 'dataset_version', 'contract_version', 'kind'];

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvFilename(series) {
  const base = `${series.region_id}_monthly_${series.daynight}_${series.dataset_version}.csv`.replace(/[^A-Za-z0-9_.-]/g, '_');
  return series.kind === 'fixture' ? `FIXTURE_${base}` : base;
}

export function buildCsv(series) {
  const lines = [CSV_COLUMNS.join(',')];
  const common = (r) => ({
    region_id: series.region_id, month: r.month, held_out: r.held_out === true ? 'true' : 'false',
    quality_flags: (r.quality || []).join(';'), filter_id: series.filter_id, daynight: series.daynight,
    strategy_id: series.strategy_id, dataset_version: series.dataset_version, contract_version: series.contract_version,
    kind: series.kind, record_source: recordSource(r), interval_level: series.interval_level,
  });
  for (const r of series.months) {
    const c = common(r);
    for (const p of PLATFORMS) {
      const n = r.native && r.native[p];
      const st = nativeStatus(r, p);
      lines.push(row({ ...c, lane: `native_${p}`, platform: p, value: st === 'observed' ? n.n : null, value_kind: st === 'observed' ? 'observed' : 'none', status: st, interval_level: null }));
    }
    for (const lane of ['aqua_equiv_operator', 'aqua_equiv_ratio']) {
      const m = r.modelled && r.modelled[lane];
      const est = m && m.status === 'estimated' && m.value != null;
      lines.push(row({ ...c, lane, platform: m && m.inputs ? m.inputs.join(';') : null, value: est ? m.value : null, lo: est ? m.lo : null, hi: est ? m.hi : null,
        value_kind: est ? 'modelled' : 'none', status: m ? m.status : 'not_computed', method_id: m ? m.method_id : null, method_version: m ? m.method_version : null }));
    }
    const rec = r.record || {};
    const src = recordSource(r);
    const kind = src === 'observed_aqua' ? 'observed' : src === 'modelled_from_viirs' ? 'modelled' : src === 'blended' ? 'blended' : 'none';
    const methodVersion = rec.method_id && r.modelled ? (Object.values(r.modelled).find((m) => m && m.method_id === rec.method_id) || {}).method_version : null;
    lines.push(row({ ...c, lane: 'record', platform: src === 'observed_aqua' ? 'aqua' : null, value: rec.value ?? null, lo: rec.lo ?? null, hi: rec.hi ?? null,
      value_kind: rec.value == null ? 'none' : kind, status: src, method_id: rec.method_id ?? null, method_version: methodVersion ?? null }));
  }
  return lines.join('\n') + '\n';

  function row(o) { return CSV_COLUMNS.map((k) => csvCell(o[k])).join(','); }
}

// ---------- validation helpers ----------

/** Plain name for a method, from its role and id/label. */
export function methodName(method) {
  if (!method) return 'method';
  const t = `${method.id} ${method.label}`;
  if (/ratio/i.test(t)) return 'Ratio method';
  if (/operator/i.test(t)) return 'Forward operator';
  if (/clim/i.test(t)) return 'Climatology (null reference)';
  return method.label || method.id;
}

export function methodRole(method) {
  if (!method) return 'method';
  if (method.role) return method.role; // forward-compatible: a future contract field
  return /ratio/i.test(`${method.id} ${method.label}`) ? 'baseline' : 'candidate';
}

/** Group validation rows into Predict -> Reveal cards: one per (region, month, daynight, input_platform, stratum). */
export function revealCards(validation) {
  if (!validation || validation.status !== 'evaluated') return [];
  const by = new Map();
  for (const r of validation.rows || []) {
    const k = [r.region_id, r.month, r.daynight, r.input_platform, r.stratum].join('|');
    if (!by.has(k)) by.set(k, { key: k, region_id: r.region_id, month: r.month, year: r.year, daynight: r.daynight, input_platform: r.input_platform, stratum: r.stratum, actual: r.actual, actual_status: r.actual_status, methods: [] });
    by.get(k).methods.push(r);
  }
  return [...by.values()].sort((a, b) => (a.region_id + a.month).localeCompare(b.region_id + b.month));
}

// ---------- status wording (one rule, used by every view) ----------

/** Region status words come from manifest region.status only. */
export function regionStatusWords(r) {
  if (r.status === 'validated') return { word: 'validated', sub: 'held-out tests passed', tested: true };
  if (r.status === 'provisional') return { word: 'provisional', sub: 'tested, not yet passed', tested: true };
  if (r.status === 'fixture') return { word: 'fixture', sub: 'synthetic test region', tested: true };
  return { word: 'explore only', sub: 'no verdict', tested: false };
}

/** What a "validated" label covers, built from the validation file and manifest (nothing assumed). */
export function validationScope(validation, region, methods) {
  if (!validation || validation.status !== 'evaluated' || !region) return null;
  const rows = (validation.rows || []).filter((r) => r.region_id === region.id && r.method_id === region.method && r.stratum === 'held_out');
  const pool = rows.length ? rows : (validation.rows || []).filter((r) => r.method_id === region.method && r.stratum === 'held_out');
  const count = (k) => { const c = {}; for (const r of pool) c[r[k]] = (c[r[k]] || 0) + 1; return Object.keys(c).sort((a, b) => c[b] - c[a]); };
  const dn = count('daynight'); const inp = count('input_platform');
  const years = (region.held_out_years || []).length ? region.held_out_years : [...new Set(pool.map((r) => r.year))].sort();
  const name = methodName(methods[region.method] || { id: region.method }).toLowerCase().replace(/ method$/, '');
  const day = dn.length === 1 ? (dn[0] === 'D' ? 'daytime ' : dn[0] === 'N' ? 'night ' : '') : '';
  const input = inp.length === 1 ? ` from ${PLATFORM_LABEL[inp[0]] || inp[0]}` : '';
  return {
    text: `${day}${name} conversion${input}, tested on withheld ${years.join('/')}`,
    excludes: `It does not cover ${dn[0] === 'D' ? 'night overpasses, ' : ''}the Aqua drift years, values converted from other VIIRS satellites, or the native Aqua record itself.`,
  };
}

/** Pre-registered coverage checks that failed for a region/method/stratum, with month counts. */
export function coverageShortfalls(validation, regionId, methodId, stratum) {
  if (!validation || validation.status !== 'evaluated') return [];
  return (validation.summary || []).filter((s) => s.region_id === regionId && s.method_id === methodId && s.stratum === stratum && s.season === 'all'
    && s.metric === 'interval_coverage' && s.passed === false && s.daynight === (validation.daynight || s.daynight) && s.n)
    .map((s) => ({ level: s.interval_level, k: Math.round(s.value * s.n), n: s.n, needed: Math.ceil((s.threshold ?? 0) * s.n - 1e-9), threshold: s.threshold }));
}

/** Month-level caveats the UI must show, from record.source, native status, quality flags and eras. */
export function monthCaveats(row, { driftShortfalls = [] } = {}) {
  const out = [];
  const src = recordSource(row);
  const q = row.quality || [];
  const drift = q.includes('aqua_drift') || row.era === 'aqua_drift';
  const aquaSt = nativeStatus(row, 'aqua');
  if (isViirsDerived(row) && aquaSt !== 'observed') out.push({ key: 'gap_fill', text: 'gap fill; not validatable (Aqua has no usable value this month, so this estimate cannot be checked against Aqua)' });
  if (isViirsDerived(row) && drift) {
    const s = driftShortfalls[0];
    out.push({ key: 'drift_stratum', text: s ? `drift stratum: intervals under-cover here (${Math.round((s.level || 0) * 100)}% interval held ${s.k}/${s.n} drift-year months; ${s.needed} needed)` : 'drift stratum: interval coverage not established in drift years' });
  }
  if (src === 'observed_aqua' && drift) out.push({ key: 'aqua_drifting', text: 'observed; orbit drifting (later overpass time); comparability with earlier years not established' });
  return out;
}

// ---------- Trust result copy (pure, so tests can check every number and word) ----------

/** Per test region-year coverage counts for one method, from validation rows (core regions only). */
export function blockCoverage(validation, methodId, regionFilter = () => true) {
  const by = new Map();
  for (const r of (validation && validation.rows) || []) {
    if (r.method_id !== methodId || r.stratum !== 'held_out' || r.daynight !== (validation.daynight || r.daynight)) continue;
    if (!regionFilter(r.region_id) || r.actual == null || typeof r.inside_interval !== 'boolean') continue;
    const k = `${r.region_id}|${r.year}`;
    if (!by.has(k)) by.set(k, { k: 0, n: 0 });
    const b = by.get(k); b.n += 1; if (r.inside_interval) b.k += 1;
  }
  const blocks = [...by.values()];
  if (!blocks.length) return null;
  const levels = [...new Set(((validation && validation.rows) || []).filter((r) => r.method_id === methodId).map((r) => r.interval_level))];
  return { blocks: blocks.length, minK: Math.min(...blocks.map((b) => b.k)), maxK: Math.max(...blocks.map((b) => b.k)), n: Math.max(...blocks.map((b) => b.n)),
    sameN: new Set(blocks.map((b) => b.n)).size === 1, totalK: blocks.reduce((a, b) => a + b.k, 0), totalN: blocks.reduce((a, b) => a + b.n, 0), level: levels.length === 1 ? levels[0] : null };
}

/**
 * Sentences for the Trust result box. Every number is read from validation.json; a clause whose
 * number is not in the data is omitted rather than written from memory.
 */
export function resultCopy(validation, methods, recordMethod, poolFilter = () => true, regionName = (id) => id) {
  const name = (id) => methodName(methods[id] || { id }).toLowerCase();
  const out = { lede: [], detail: [], triggers: [] };
  const d = validation.decision;
  const fx = (v) => (Number.isFinite(v) ? (Math.abs(v) < 10 ? v.toFixed(2) : String(Math.round(v))).replace(/^-/, '−') : '—');
  if (d) {
    const cand = d.candidate_method; const adopted = d.adopted_method || recordMethod;
    const pooledSkill = (d.criteria || []).find((c) => c.metric === 'skill_vs_ratio_log1p' && c.region == null);
    const ciCrit = (d.criteria || []).find((c) => /ci_low/.test(c.metric || ''));
    if (d.outcome === 'fallback_to_baseline') {
      const crit = pooledSkill ? `skill vs the ratio method ${pooledSkill.comparison || '≥'} ${pooledSkill.threshold}${ciCrit ? `, with its confidence interval ${(ciCrit.comparison || '>') === '>' ? 'above' : ciCrit.comparison} ${ciCrit.threshold}` : ''}` : 'see the pre-registration';
      out.lede.push(`The ${name(cand)} did not meet the adoption criterion set in advance (${crit.replace('>=', '≥')}).`);
      out.lede.push(`The record therefore uses the simpler ${name(adopted)} under the pre-registered fallback rule.`);
    } else if (d.outcome === 'adopt_candidate') {
      out.lede.push(`The ${name(cand)} met every adoption criterion set in advance, so the record uses it.`);
    } else out.lede.push('The pre-registered decision was inconclusive: no method is adopted for the record.');
    for (const t of (d.triggers || []).filter((x) => x.fired && x.region)) {
      out.triggers.push({ region: t.region, value: t.value, threshold: t.threshold, below: !!t.below_display_minimum, n: t.n,
        text: `${regionName(t.region)} triggered it (${fx(t.value)}, below ${fx(t.threshold)})${t.below_display_minimum ? `: a decision input over ${t.n} months, below the display minimum, not evidence on its own` : ''}.` });
    }
    if (pooledSkill) {
      const ci = pooledSkill.ci_low != null && pooledSkill.ci_high != null ? ` (CI ${fx(pooledSkill.ci_low)} to ${fx(pooledSkill.ci_high)})` : '';
      const bw = d.blocks_won;
      out.detail.push(`${methodName(methods[cand] || { id: cand })} skill vs ratio: ${fx(pooledSkill.value)}${ci}${pooledSkill.note ? `; ${pooledSkill.note}` : ''}.${bw ? ` It had lower error in ${bw.candidate} of ${bw.total} test region-years.` : ''}`);
    }
  } else {
    // Older files (before 1.2.2): read the pooled skill rows.
    const cands = [...new Set((validation.summary || []).filter((x) => x.metric === 'skill_vs_ratio_log1p' && methodRole(methods[x.method_id]) === 'candidate').map((x) => x.method_id))];
    for (const c of cands) {
      const x = (validation.summary || []).find((y) => y.method_id === c && y.metric === 'skill_vs_ratio_log1p' && y.region_id === 'all' && y.stratum === 'held_out' && y.season === 'all');
      if (!x) continue;
      if (x.passed === false) {
        out.lede.push(`The ${name(c)} did not meet the adoption criterion set in advance (skill vs the ratio method ≥ ${x.threshold}).`);
        if (recordMethod) out.lede.push(`The record therefore uses the simpler ${name(recordMethod)} under the pre-registered fallback rule.`);
      }
      out.detail.push(`${methodName(methods[c] || { id: c })} skill vs ratio: ${x.meets_minimum_n === false ? 'insufficient sample' : fx(x.value)}; n = ${x.n} months.`);
    }
  }
  if (recordMethod) {
    const bc = blockCoverage(validation, recordMethod, poolFilter);
    const cov = (validation.summary || []).find((s) => s.method_id === recordMethod && s.metric === 'interval_coverage' && s.region_id === 'all' && s.stratum === 'held_out'
      && s.season === 'all' && (bc && bc.level != null ? s.interval_level === bc.level : true) && s.daynight === (validation.daynight || s.daynight));
    if (cov && bc) {
      const lvl = Math.round((cov.interval_level || bc.level || 0) * 100);
      out.detail.push(`${methodName(methods[recordMethod] || { id: recordMethod })} ${lvl}% intervals: ${cov.value.toFixed(3)} of ${cov.n} pooled test months inside (${bc.totalK}/${bc.totalN}); per test region-year, ${bc.minK === bc.maxK ? bc.minK : `${bc.minK}–${bc.maxK}`} of ${bc.sameN ? bc.n : `up to ${bc.n}`} months inside, in each of ${bc.blocks} region-years.`);
    }
  }
  return out;
}

// ---------- calendar keyboard (one row per year; rows may be partial at the record's ends) ----------

/**
 * Target month for a key press in the year x month calendar. `months` is the sorted list of 'YYYY-MM' cells present.
 * Left/Right step one month (across rows); Up/Down and PageUp/PageDown move a year, clamped to the nearest month that
 * exists in that row; Home/End go to the first/last month of the current row (by the row's own months, never by list
 * position). Returns null for keys it does not handle.
 */
export function calendarMove(months, current, key) {
  const i = months.indexOf(current);
  if (i < 0) return null;
  const y = yearOf(current); const mi = monthIndex(current);
  const row = (yy) => months.filter((m) => yearOf(m) === yy);
  const nearest = (yy) => {
    const r = row(yy);
    if (!r.length) return current;
    return r.reduce((b, m) => (Math.abs(monthIndex(m) - mi) < Math.abs(monthIndex(b) - mi) ? m : b));
  };
  switch (key) {
    case 'ArrowLeft': return months[i - 1] || current;
    case 'ArrowRight': return months[i + 1] || current;
    case 'ArrowUp': case 'PageUp': return nearest(y - 1);
    case 'ArrowDown': case 'PageDown': return nearest(y + 1);
    case 'Home': return row(y)[0];
    case 'End': { const r = row(y); return r[r.length - 1]; }
    default: return null;
  }
}

/**
 * Default selectable year on a region page: the latest year with all twelve months present and none of them in the
 * Aqua drift or post-MODIS eras (from manifest.eras, never a literal). Falls back to the latest complete year.
 */
export function latestComparableYear(months, eras) {
  const byYear = new Map();
  for (const r of months) { const y = yearOf(r.month); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(r); }
  const ok = [...byYear].filter(([, rs]) => rs.length === 12 && rs.every((r) => !['aqua_drift', 'post_modis'].includes(eraFor(r.month, eras, r.era)))).map(([y]) => y);
  return ok.length ? Math.max(...ok) : latestCompleteYear(months);
}
/** Years with any month in the Aqua drift or post-MODIS eras: their verdicts are unconfirmed. */
export function unconfirmedYears(months, eras) {
  return [...new Set(months.filter((r) => ['aqua_drift', 'post_modis'].includes(eraFor(r.month, eras, r.era))).map((r) => yearOf(r.month)))].sort((a, b) => a - b);
}

/** Latest year with all twelve months present in the series (the default selectable year), else the last year. */
export function latestCompleteYear(months) {
  const count = new Map();
  for (const r of months) count.set(yearOf(r.month), (count.get(yearOf(r.month)) || 0) + 1);
  const full = [...count].filter(([, n]) => n === 12).map(([y]) => y);
  return full.length ? Math.max(...full) : (count.size ? Math.max(...count.keys()) : null);
}
