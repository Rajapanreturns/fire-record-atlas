// M3 "Across decades": pure helpers, no DOM. Every number shown comes from m2_validation.json (contract 1.4.0, §2g)
// or the region series; nothing here types a result in. Wording follows docs/m2/M2-AUDIT.md §9 (A1–A12) verbatim, with
// the numbers and years read from data. The verdict is the pre-registered Q4 POINT class (q4_n20 / q4_truth), never the
// interval rule in core.verdictFor: the 91% agreement describes the point rule only (M2-AUDIT §3, JOURNEY §0).
import { MONTH_ABBR, yearOf, monthIndex, nativeStatus, nativeN } from './core.js';

export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const CLASSES = ['below', 'within', 'above', 'cant_tell'];

/** One label + mark per value kind (JOURNEY §5). The mark is a shape/fill, so kinds never differ by colour alone. */
export const KIND = {
  observed: { label: 'Aqua measured', mark: 'solid black dot' },
  raw_viirs: { label: 'NOAA-20 counted (own scale)', mark: 'hollow ring' },
  raw_terra: { label: 'Terra counted (own scale)', mark: 'hollow square' },
  converted_validated: { label: 'Converted to Aqua scale · tested', mark: 'filled orange dot, bar = 90% range' },
  converted_unvalidated: { label: 'Converted · not tested', mark: 'hollow orange dot, dashed bar' },
  unavailable: { label: 'No usable data (not zero)', mark: 'hatching, no dot' },
};
/** The full label for a kind; the tested window is read from data. */
export function kindLabel(kind, win = null) {
  const k = KIND[kind] || KIND.unavailable;
  if (kind === 'converted_validated' && win) return `${k.label} ${yearOf(win.start)}–${yearOf(win.end)}`;
  return k.label;
}

/** Verdict words (JOURNEY §5). */
export const VERDICT_M2 = {
  below: { word: 'below the 2000s range', short: 'below', glyph: 'below' },
  within: { word: 'within the 2000s range', short: 'within', glyph: 'within' },
  above: { word: 'above the 2000s range', short: 'above', glyph: 'above' },
  cant_tell: { word: 'can’t tell (too few detections)', short: 'can’t tell', glyph: 'unknown' },
};

/** Map regions: the M2 regions first (JOURNEY §1: listed first on phones), then the M1 regions unchanged. */
export function allRegions(manifest) {
  if (!manifest) return [];
  const m1 = manifest.regions || [];
  const m2 = (manifest.m2_regions || []).filter((r) => !m1.some((x) => x.id === r.id));
  return [...m2, ...m1];
}
export const isM2Region = (r) => !!(r && r.tier === 'm2_primary' && r.m2);

/** Region directory groups (atlas sidebar): NOAA-20 across-decades regions, then the earlier S-NPP test. Every region appears once. */
export function directoryGroups(manifest) {
  const regions = allRegions(manifest);
  return [
    { id: 'm2', label: 'Tested against the 2000s · NOAA-20', list: regions.filter(isM2Region) },
    { id: 'm1', label: 'Earlier test · S-NPP', list: regions.filter((r) => !isM2Region(r)) },
  ].filter((g) => g.list.length);
}

/** Rows of one region from m2_validation, sorted by month. */
export function regionRows(val, regionId) {
  return ((val && val.month_rows) || []).filter((r) => r.region_id === regionId).sort((a, b) => (a.month < b.month ? -1 : 1));
}
export const regionSummary = (val, regionId) => ((val && val.regions) || []).find((r) => r.region_id === regionId) || null;

/**
 * The case of a comparison (JOURNEY §2), fixed BEFORE reveal and never changed by it: it reads only fields that are
 * known without Aqua (the converted class, the range tag). A miss inside "supported" stays "supported".
 * kind: 'validated' (a test row), 'unvalidated' (converted outside the tested window or region), 'raw' (raw vs Aqua).
 */
export function caseOf(row, kind = 'validated') {
  if (kind !== 'validated' || !row) {
    const reason = kind === 'raw' ? 'raw NOAA-20 counts are on their own scale' : kind === 'm1' ? 'NOAA-20 conversion not tested here' : 'outside the tested window; not tested after it';
    return { id: 'unsupported', badge: 'Unsupported: not tested', reason };
  }
  if (row.q4_n20 === 'cant_tell') return { id: 'uncertain', badge: 'Uncertain: too few detections', reason: 'too few NOAA-20 detections for a verdict' };
  if (row.range_crosses_edge) return { id: 'uncertain', badge: 'Uncertain: range crosses the edge', reason: 'the 90% range crosses the edge of the 2000s range' };
  return { id: 'supported', badge: 'Supported: tested comparison', reason: 'tested month, clear verdict, range inside one band' };
}

/** Did the converted verdict match Aqua's own verdict? null when the converted side abstained. */
export function matched(row) {
  if (!row || row.q4_n20 === 'cant_tell' || row.q4_truth === 'cant_tell') return null;
  return row.q4_n20 === row.q4_truth;
}

/** Error as a ratio on count + 1 (consistent with the log1p error, safe at 0). */
export function errorRatio(pred, actual) {
  if (!Number.isFinite(pred) || !Number.isFinite(actual)) return null;
  const r = (pred + 1) / (actual + 1);
  const f = r >= 1 ? r : 1 / r;
  return { ratio: r, factor: f, text: f < 1.05 ? 'converted value within 5% of Aqua’s count' : `converted value ×${f.toFixed(f >= 10 ? 0 : 1)} ${r > 1 ? 'higher' : 'lower'} than Aqua’s count`, note: 'ratio on count + 1' };
}

/** Months of the grid: one row per test year (from window.folds), 12 columns. */
export function gridModel(val, regionId) {
  const win = val.window;
  const years = (win.folds && win.folds.length ? win.folds : range(yearOf(win.start), yearOf(win.end))).slice().sort((a, b) => a - b);
  const byMonth = new Map(regionRows(val, regionId).map((r) => [r.month, r]));
  return years.map((y) => ({
    year: y,
    cells: MONTH_ABBR.map((_, i) => {
      const month = `${y}-${String(i + 1).padStart(2, '0')}`;
      const row = byMonth.get(month) || null;
      const state = month < win.start ? 'before' : month > win.end ? 'after' : row ? 'test' : 'untested';
      return { month, row, state };
    }),
  }));
}
function range(a, b) { const o = []; for (let y = a; y <= b; y += 1) o.push(y); return o; }

/** Grid keyboard: arrows move within the year rows, Home/End within a row, PageUp/PageDown to first/last row. */
export function gridMove(rows, cur, key) {
  const nR = rows; const [r, c] = cur;
  const m = { ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], Home: [r, 0], End: [r, 11], PageUp: [0, c], PageDown: [nR - 1, c] }[key];
  if (!m) return null;
  return [Math.max(0, Math.min(nR - 1, m[0])), Math.max(0, Math.min(11, m[1]))];
}

/** What a key does on the panel: 'select' (Enter/Space), 'reveal' (r / R). */
export function keyAction(key) {
  if (key === 'Enter' || key === ' ') return 'select';
  if (key === 'r' || key === 'R') return 'reveal';
  return null;
}

/** Reveal motion: none when the reader prefers reduced motion (the mark simply appears). */
export function revealMotion(reduced) {
  if (reduced) return null;
  return { keyframes: [{ opacity: 0, transform: 'translate(-50%, -50%) scale(1.8)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }], duration: 320 };
}

/** Fixed log domain for a region: every NOAA-20 raw count, converted value/range, Aqua count and envelope edge. */
export function regionDomain(rows, seriesMonths = [], lane = 'aqua_equiv_n20_ratio') {
  const vals = [];
  for (const r of rows) for (const v of [r.noaa20_raw, r.pred, r.lo90, r.hi90, r.actual, r.env_p10, r.env_p90]) if (v > 0) vals.push(v);
  for (const m of seriesMonths) {
    const l = m.modelled && m.modelled[lane];
    if (l && l.status === 'estimated' && l.value_kind === 'converted_unvalidated') {
      for (const v of [l.value, l.lo, l.hi, nativeN(m, 'noaa20'), nativeStatus(m, 'aqua') === 'observed' ? nativeN(m, 'aqua') : null]) if (v > 0) vals.push(v);
    }
  }
  if (!vals.length) return [1, 10];
  const lo = 10 ** Math.floor(Math.log10(Math.min(...vals)));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...vals)) + 1e-9);
  return [Math.min(lo, 1), Math.max(hi, lo * 10)];
}

/** Converted values OUTSIDE the tested window (after its end, for M2 regions): kind converted_unvalidated, from the series. */
export function unvalidatedMonths(series, lane = 'aqua_equiv_n20_ratio') {
  return ((series && series.months) || []).filter((m) => m.modelled && m.modelled[lane] && m.modelled[lane].value_kind === 'converted_unvalidated' && m.modelled[lane].status === 'estimated');
}

/** A row-shaped model for an unvalidated month (no Q4 classes: there is no verdict to test). */
export function unvalidatedModel(m, env, lane = 'aqua_equiv_n20_ratio') {
  const l = m.modelled[lane];
  const e = env ? env[monthIndex(m.month)] : null;
  const aquaObs = nativeStatus(m, 'aqua') === 'observed';
  return {
    month: m.month, noaa20_raw: nativeStatus(m, 'noaa20') === 'observed' ? nativeN(m, 'noaa20') : null,
    pred: l.value, lo90: l.lo, hi90: l.hi, actual: aquaObs ? nativeN(m, 'aqua') : null, aquaStatus: nativeStatus(m, 'aqua'),
    env_p10: e && e.p10, env_p90: e && e.p90, kind: 'converted_unvalidated',
  };
}

// ---------- approved wording (M2-AUDIT §9), numbers from data ----------

const pct = (x) => `${Math.round(x * 100)}%`;
const monthWords = (m) => `${MONTH_LONG[monthIndex(m)]} ${yearOf(m)}`;
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/** counts[truth][arm] -> tallies used by A6–A9. */
export function confusionTallies(conf) {
  const idx = (k) => conf.classes.indexOf(k);
  const c = (t, a) => conf.counts[idx(t)][idx(a)];
  const dec = ['below', 'within', 'above'];
  let decided = 0; let agree = 0; let total = 0;
  for (const t of CLASSES) for (const a of CLASSES) {
    const n = c(t, a); total += n;
    if (dec.includes(t) && dec.includes(a)) { decided += n; if (t === a) agree += n; }
  }
  const unusual = ['below', 'above'].reduce((s, t) => s + dec.reduce((x, a) => x + c(t, a), 0), 0);
  const unusualHit = c('below', 'below') + c('above', 'above');
  const unusualMissed = c('below', 'within') + c('above', 'within');
  const opposite = c('below', 'above') + c('above', 'below');
  const usual = dec.reduce((x, a) => x + c('within', a), 0);
  const falseFlags = c('within', 'below') + c('within', 'above');
  const abstained = CLASSES.reduce((x, t) => x + c(t, 'cant_tell'), 0);
  return { total, decided, agree, unusual, unusualHit, unusualMissed, opposite, usual, falseFlags, abstained };
}

/** The tested window and other scope facts, all from the file. */
export function scopeFacts(val) {
  const w = val.window;
  const nRegions = (val.regions || []).length;
  const p = val.envelope && val.envelope.period;
  const base = p ? `${p.start_year}–${p.end_year}` : '';
  const era = ((val.pooled.q4.viirs_era_arm || {}).note || '').match(/S-NPP (\d{4})-(\d{4})/);
  return { start: w.start, end: w.end, y0: yearOf(w.start), y1: yearOf(w.end), afterYear: yearOf(w.end) + 1, nRegions, base, viirsEra: era ? `${era[1]}–${era[2]}` : 'VIIRS', perRegion: (val.regions[0] || {}).n };
}

/** A1–A12 as {id, text}; each sentence is the audit's wording with numbers substituted from the file. */
export function approvedWording(val) {
  const f = scopeFacts(val);
  const q1 = val.pooled.q1; const q4 = val.pooled.q4;
  const rows = val.month_rows;
  const n = q1.n;
  const ratios = rows.map((r) => { const x = (r.pred + 1) / (r.actual + 1); return x >= 1 ? x : 1 / x; });
  const med = median(ratios);
  const within15 = ratios.filter((x) => x <= 1.5).length;
  const t = confusionTallies(q4.arms.n20_direct.confusion);
  const tn = confusionTallies(q4.arms.naive.confusion);
  const tc = confusionTallies(q4.arms.aqua_clim.confusion);
  const tv = confusionTallies(q4.viirs_era_arm.confusion);
  const off = q1.by_season.off; const act = q1.by_season.active;
  const outside = n - q1.cov90_covered; const offOutside = off.n - off.cov90_covered;
  const [s0, s1] = q1.skill_ci95_block || [];
  const span = `${monthWords(f.start)} – ${monthWords(f.end)}`;
  const A = {
    A1: `Tested in ${f.nRegions} study areas that were not used to design the method, on daytime monthly detection counts, ${span}, when both NOAA-20 and Aqua MODIS were observing. Each area’s conversion factor comes from its own overlap years; the tested month was always hidden.`,
    A2: `${q1.cov90_covered} of ${n} tested months (${pct(q1.cov90_covered / n)}): Aqua’s measured count fell inside the converted value’s 90% range.`,
    A3: `${q1.cov80_covered} of ${n} (${pct(q1.cov80_covered / n)}) fell inside the 80% range.`,
    A4: `In half of the tested months the converted value was within about ${Math.round((med - 1) * 100)}% of Aqua’s measured count; in ${within15} of ${n} (${pct(within15 / n)}) it was within a factor of 1.5.`,
    A5: `On a log scale, the average error was about ${pct(q1.skill_vs_aqua_clim)} smaller${s0 != null ? ` (95% range ${Math.round(s0 * 100)}–${pct(s1)})` : ''} than guessing each month from the same calendar month in the other ${f.y0}–${f.y1} years.`,
    A6: `For ${t.decided} of the ${t.total} months a verdict could be made. The converted value’s verdict (‘below / within / above the ${f.base} usual range’) matched Aqua’s own verdict in ${t.agree} (${pct(t.agree / t.decided)}). The other ${t.abstained} were ‘can’t tell’ (very few detections).`,
    A7: `Of the ${t.unusual} months Aqua measured as unusual, ${t.unusualHit} were called correctly and ${t.unusualMissed} were called ‘within’. Of ${t.usual} usual months, ${t.falseFlags} were wrongly flagged as unusual. ${t.opposite === 0 ? 'No month was called in the opposite direction.' : `${t.opposite} were called in the opposite direction.`}`,
    A8: `Comparing raw NOAA-20 counts directly with the 2000s Aqua range gave the matching verdict in only ${tn.agree} of ${tn.decided} months (${pct(tn.agree / tn.decided)}). Guessing the usual month gave ${tc.agree} of ${tc.decided} (${pct(tc.agree / tc.decided)}).`,
    A9: `Ranking NOAA-20 against its own satellite era (${f.viirsEra} VIIRS) instead matched Aqua’s 2000s verdict in only ${tv.agree} of ${tv.decided} months (${pct(tv.agree / tv.decided)}). Rankings within one satellite era cannot stand in for rankings across eras.`,
    A10: (offOutside === outside && act.n - act.cov90_covered === 0
      ? `All ${outside} months that fell outside the 90% range were outside the main burning season; `
      : `${offOutside} of the ${outside} months that fell outside the 90% range were outside the main burning season; `) + `off-season coverage was ${off.cov90_covered} of ${off.n} (${pct(off.cov90_covered / off.n)}).`,
    A12: `Detections, not separate fire events. Validated only for ${span} in these ${f.nRegions} areas. Values after MODIS, from ${f.afterYear} onward (Aqua’s orbit drifted), from NOAA-21, or at night are not validated.`,
  };
  return { A, facts: f, tallies: { n20: t, naive: tn, clim: tc, viirs: tv } };
}

/** Per-region line (QA M2): two labelled measures, each with its 43-month denominator. */
export function regionCoverageLine(reg, t) {
  return `Inside the 90% range: ${reg.cov90_covered} of ${reg.n} · Verdict matched Aqua: ${t.matched} of ${t.n} (${t.missed} didn’t, ${t.none} can’t tell)`;
}

/** Grid tally words (QA M1): ✗ is "didn't match"; "missed" is kept for unusual -> within in the tables only. */
export const tallyWords = (t) => `✓ ${t.matched} matched · ✗ ${t.missed} didn’t match · ? ${t.none} can’t tell`;

/** Main burning season, as defined in PREREGISTRATION §5 (the active season), with the baseline years from data. */
export const seasonDefinition = (base) => `Main burning season: the busiest calendar months that together hold at least 80% of the area’s Aqua ${base} detections, ranked by their mean (the pre-registered test season, set before testing). Region pages rank months by the median year, so their busiest months can differ.`;

/** Trust page opening answer covering both tests (QA M4); every number from data. */
export function trustAnswer(val, m1) {
  const f = scopeFacts(val);
  return `Partly. Converted NOAA-20 was tested on ${val.pooled.q1.n} hidden months in ${f.nRegions} new study areas (${monthWords(f.start)} – ${monthWords(f.end)}); its 90% range held Aqua’s count in ${val.pooled.q1.cov90_covered}. The earlier S-NPP conversion held up in ${m1.held} of the first ${m1.tested} study areas. Nothing after MODIS has been tested.`;
}

/** Glossary entry for the M2 status (QA m5), from the manifest. */
export function m2Glossary(manifest) {
  const rs = manifest.m2_regions || [];
  const w = rs[0] && rs[0].m2 && rs[0].m2.validated_window;
  if (!w) return null;
  return { term: 'validated — NOAA-20', plain: `Met criteria set before testing, for daytime NOAA-20 → Aqua conversion on hidden months, ${monthWords(w.start)} – ${monthWords(w.end)}, in ${rs.length} study areas. Not night, not ${yearOf(w.end) + 1} onward, not after MODIS.`, precise: '' };
}

/** The rule that chose the opening month, as stated on screen (JOURNEY §3). */
export const FEATURED_LABEL = (n) => `Opening month chosen by a fixed random rule, not picked to look good. All ${n} are in the grid.`;

/** Region-level tallies of the grid once revealed: matched / missed / no verdict. */
export function gridTally(rows) {
  const c = { matched: 0, missed: 0, none: 0, inside90: 0, n: rows.length };
  for (const r of rows) { const m = matched(r); if (m === null) c.none += 1; else if (m) c.matched += 1; else c.missed += 1; if (r.inside90) c.inside90 += 1; }
  return c;
}

// ---------- M4.2 Trust page: headline metrics, demo cases and explorer filters (pure; numbers from data) ----------

/**
 * The three headline measures, kept DISTINCT (M2-AUDIT §9: never merged): interval coverage (A2), size of error vs a
 * simple guess (A5) and the above / within / below verdict (A6, with its abstentions). Each carries its denominator.
 */
export function headlineMetrics(val) {
  const { tallies, facts } = approvedWording(val);
  const q1 = val.pooled.q1; const t = tallies.n20;
  const [s0, s1] = q1.skill_ci95_block || [];
  return [
    { id: 'coverage', claim: 'A2', kind: 'Range check', k: q1.cov90_covered, n: q1.n, big: `${q1.cov90_covered}`, of: `of ${q1.n} months`,
      plain: 'Aqua’s real count landed inside the predicted 90% range.', note: `${q1.n - q1.cov90_covered} landed outside it.` },
    { id: 'skill', claim: 'A5', kind: 'Size of error', big: pct(q1.skill_vs_aqua_clim), of: 'smaller average error', n: q1.n,
      plain: `than guessing each month from the same calendar month in the other ${f2(facts)} years (log scale).`,
      note: `${s0 != null ? `95% range ${Math.round(s0 * 100)}–${pct(s1)} · ` : ''}${q1.n} months`,
      caveat: `A deliberately simple baseline that never sees the month. Raw NOAA-20 counts, unconverted, got the verdict right in only ${tallies.naive.agree} of ${tallies.naive.decided}.` },
    { id: 'verdict', claim: 'A6', kind: 'Unusual or not', k: t.agree, n: t.decided, big: `${t.agree}`, of: `of ${t.decided} months`,
      plain: `The above / within / below-usual verdict matched Aqua’s own.`, note: `${t.abstained} more had too few detections to call.` },
  ];
}
const f2 = (f) => `${f.y0}–${f.y1}`;

/**
 * Plain-language lead for the Trust answer (QA H4): the same facts as trustAnswer, nothing added, ordinary words first,
 * satellite names second. trustAnswer itself stays verbatim in Scientific details.
 */
export function plainAnswer(val, m1) {
  const f = scopeFacts(val); const q1 = val.pooled.q1;
  return {
    lead: 'Partly.',
    main: `In ${q1.cov90_covered} of ${q1.n} hidden months, the newer satellite’s converted estimate, with its 90% range, caught what the older satellite actually measured (NOAA-20 → Aqua MODIS, ${f.nRegions} study areas, ${monthWords(f.start)} – ${monthWords(f.end)}).`,
    rest: `The earlier S-NPP conversion held up in ${m1.held} of the first ${m1.tested} study areas. Nothing after MODIS has been tested.`,
  };
}

/** How the two demo months are chosen: fixed rules over the file, never by hand (docs/m42/TRUST-REDESIGN.md). */
export const DEMO_RULE = {
  success: 'First study area, in file order, whose opening month (picked by the pre-locked random rule before any result was seen) landed inside the 90% range, got the matching verdict, and has a range that does not cross a usual-range edge.',
  miss: 'Of the months that failed both checks (Aqua outside the 90% range and a verdict that did not match), the one with the largest Aqua count, so the miss is visible on the scale rather than a near-zero month.',
};

/** Resolve the demo months from data. Returns { success, miss } of { row, how } (either may be null). */
export function demoCases(val) {
  const rows = (val && val.month_rows) || [];
  const clean = (r) => r && r.inside90 === true && matched(r) === true && !r.range_crosses_edge;
  let success = null; let sHow = 'rule: pre-locked opening month';
  for (const reg of val.regions || []) {
    const r = rows.find((x) => x.region_id === reg.region_id && x.month === reg.featured_month);
    if (clean(r)) { success = r; break; }
  }
  if (!success) { success = rows.find(clean) || null; sHow = 'fallback: first clean success in file order'; }
  const byCount = (a, b) => (b.actual - a.actual) || (a.month < b.month ? -1 : 1);
  let mHow = 'rule: failed both checks, largest Aqua count';
  let miss = rows.filter((r) => r.inside90 === false && matched(r) === false).sort(byCount)[0] || null;
  if (!miss) { miss = rows.filter((r) => r.inside90 === false || matched(r) === false).sort(byCount)[0] || null; mHow = 'fallback: failed one check, largest Aqua count'; }
  return { success: success ? { row: success, how: sHow } : null, miss: miss ? { row: miss, how: mHow } : null };
}

/**
 * Explorer filters over the test months. They overlap (a month can be in several). "Range crosses an edge" is a
 * per-month tag only: no agreement rate is computed on it (q4.rule.range_crosses_edge).
 */
export const EXPLORE_FILTERS = [
  { id: 'all', label: 'All test months', test: () => true },
  { id: 'success', label: 'Successful: inside the range, verdict matched', test: (r) => r.inside90 === true && matched(r) === true },
  { id: 'verdict_miss', label: 'Verdict didn’t match Aqua', test: (r) => matched(r) === false },
  { id: 'outside', label: 'Aqua outside the 90% range', test: (r) => r.inside90 === false },
  { id: 'cant_tell', label: 'Can’t tell: too few detections', test: (r) => r.q4_n20 === 'cant_tell' },
  { id: 'edge', label: 'Range crosses a usual-range edge', test: (r) => !!r.range_crosses_edge },
];
export const exploreFilter = (id) => EXPLORE_FILTERS.find((f) => f.id === id) || EXPLORE_FILTERS[0];

/** Rows matching a filter and an area ('all' for every area), in file order. */
export function filterRows(val, filterId = 'all', regionId = 'all') {
  const f = exploreFilter(filterId);
  return ((val && val.month_rows) || []).filter((r) => (regionId === 'all' || r.region_id === regionId) && f.test(r));
}

/** Count per filter for one area selection: { all: n, success: n, ... }. */
export function filterCounts(val, regionId = 'all') {
  return Object.fromEntries(EXPLORE_FILTERS.map((f) => [f.id, filterRows(val, f.id, regionId).length]));
}
