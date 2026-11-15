// Plain-language story copy. Pure: no DOM, no d3. Every number and year is read from data passed in;
// tests/site/story.test.mjs checks the rules (peak months, where "provisional" may appear, must-show caveats,
// banned words). Precise definitions live in the glossary; the UI shows the plain line first.
import { PLATFORM_LABEL, monthIndex, monthLabel, yearOf, recordSource, isViirsDerived, nativeStatus, eraFor, methodName, methodRole, isPooledRegion } from './core.js';
import { fmtN } from './ui.js';

/** Plural month names ("seen in 5 of 9 Januaries"). */
export const MONTH_PLURAL = ['Januaries', 'Februaries', 'Marches', 'Aprils', 'Mays', 'Junes', 'Julys', 'Augusts', 'Septembers', 'Octobers', 'Novembers', 'Decembers'];
export const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** One sentence that must stay visible wherever counts are shown. */
export const DETECTION_NOTE = 'Each count is a satellite detection of a hot spot, not a count of separate fires.';
export const NOT_OBSERVED_NOTE = 'Hatched = not observed (no usable satellite data). That is not a zero.';
export const SCREENING_NOTE = 'Above / within / below is a simple check against the usual range, not proof of change.';

/** Words the story copy must never use (spec wording rules). Matched case-insensitively on rendered text. */
export const BANNED = [
  /\bfires\b/i, // "fires" for detections; the negated "not ... fires" phrasing is stripped by bannedIn first
  /burn(?:s|ed)? the most/i, /\baccurate\b/i, /\bproves?\b/i, /\bcalibrated\b/i, /\bseamless\b/i, /\bsignificant\b/i,
  /\banomal(?:y|ies)\b/i, /\bwon\b/i, /\ba third\b/i, /\bless certain\b/i, /\bnot comparable\b/i,
  /\bno fires?\b/i, /\b0 fires?\b/i, /\bhow this year\b/i, /\bthis year compares\b/i, /\bthis year so far\b/i, /\bharmoni[sz]ed everywhere\b/i, /\bnever saw\b/i, /^Close\b/, /\btypically off by\b/i,
];
/** Returns the banned patterns found in a text (the detection note's "not a count of separate fires" is allowed). */
export function bannedIn(text) {
  const t = String(text).split(DETECTION_NOTE).join(' ').replace(/not (?:a count of )?(?:separate )?fires/gi, ' ');
  return BANNED.filter((re) => re.test(t)).map(String);
}

// ---------- season ----------

export const PEAK_SHARE = 0.8; // a season is anchored on a month within 80% of the busiest usual month...
export const EXTEND_SHARE = 0.5; // ...and extends to contiguous neighbours (wrapping Dec->Jan) at >= 50% of the peak
export const SECOND_SHARE = 0.2; // a separate, smaller season must reach 20% of the busiest month...
export const TROUGH_SHARE = 0.1; // ...and be cut off from the main peak by a month under 10% on both sides

/** Group month indices (0..11) into runs that are contiguous on the cyclic calendar. */
export function cyclicRuns(indices) {
  const s = [...new Set(indices)].sort((a, b) => a - b);
  if (!s.length) return [];
  const runs = [];
  for (const i of s) {
    const last = runs[runs.length - 1];
    if (last && i === last[last.length - 1] + 1) last.push(i); else runs.push([i]);
  }
  if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1].slice(-1)[0] === 11) {
    const tail = runs.pop();
    runs[0] = [...tail, ...runs[0]];
  }
  return runs;
}

/**
 * Peak months from the usual-year medians (p50 of observed Aqua in the baseline years).
 * main: contiguous runs of months with p50 >= EXTEND_SHARE x max that contain a month >= PEAK_SHARE x max. second: when there is one main run, a separate smaller
 * season (runs of months >= SECOND_SHARE x max, not touching the main run, with a month < TROUGH_SHARE x max
 * between it and the main run on both sides). Returns null when there is no usable baseline.
 */
export function peakMonths(entries) {
  const p50 = Array.from({ length: 12 }, (_, i) => {
    const e = Array.isArray(entries) ? (entries.find((x) => x && x.month === i + 1) || entries[i]) : null;
    return e && Number.isFinite(e.p50) ? e.p50 : null;
  });
  const known = p50.filter((v) => v != null);
  if (known.length < 12) return null;
  const max = Math.max(...known);
  if (!(max > 0)) return null;
  const main = cyclicRuns(p50.map((v, i) => (v >= EXTEND_SHARE * max ? i : -1)).filter((i) => i >= 0))
    .filter((r) => r.some((i) => p50[i] >= PEAK_SHARE * max));
  let second = [];
  if (main.length === 1) {
    const mainSet = new Set(main[0]);
    const big = cyclicRuns(p50.map((v, i) => (v >= SECOND_SHARE * max ? i : -1)).filter((i) => i >= 0));
    const deep = (from, step) => { // walk from a run edge toward the main run; true if a deep trough lies between
      for (let k = 1, i = (from + step + 12) % 12; k < 12; k += 1, i = (i + step + 12) % 12) {
        if (mainSet.has(i)) return false;
        if (p50[i] < TROUGH_SHARE * max) return true;
      }
      return false;
    };
    second = big.filter((r) => !r.some((i) => mainSet.has(i)) && deep(r[r.length - 1], 1) && deep(r[0], -1));
  }
  return { main, second, max, p50 };
}

/** "October", "October–November", "December–January". */
export function runLabel(run) {
  if (run.length === 1) return MONTH_FULL[run[0]];
  return `${MONTH_FULL[run[0]]}–${MONTH_FULL[run[run.length - 1]]}`;
}
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Lead sentence for a region page. `period` is the baseline label from data, e.g. the first..last baseline year. */
export function seasonSentence(name, entries, period, years = null, daynight = null) {
  const pk = peakMonths(entries);
  if (!pk) return { text: `There are not enough measured years to describe a usual season in ${name}.`, peaks: null };
  const dt = daynight === 'D' ? ' in daytime' : daynight === 'N' ? ' at night' : '';
  const tail = years ? `. Typical year ${period}, as measured by ${glossAqua(years)}${dt}.` : dt ? ` (typical year ${period},${dt.replace(' in ', ' ')}).` : ` (typical year ${period}, measured by Aqua).`;
  const aq = years ? 'Aqua' : glossAqua({}); // without years in the tail, gloss Aqua where the sentence first names it
  let text;
  if (pk.main.length > 1) text = `${name} has ${pk.main.length === 2 ? 'two' : 'several'} seasons of detections: ${andList(pk.main.map(runLabel))}${tail}`;
  else if (pk.second.length) text = `${aq} records the most detections in ${name} in ${runLabel(pk.main[0])}, with a smaller second season in ${andList(pk.second.map(runLabel))}${tail}`;
  else text = `${aq} records the most detections in ${name} in ${runLabel(pk.main[0])}${tail}`;
  return { text, peaks: pk };
}

// ---------- one month ----------

const SOURCE_TAG = {
  observed_aqua: 'measured by Aqua',
  modelled_from_viirs: 'estimated from VIIRS',
  blended: 'partly estimated from VIIRS',
  terra_only: 'Terra only, no Aqua-scale count',
  not_observed: 'not observed',
  unknown: 'source unknown',
};
export const sourceTag = (row) => SOURCE_TAG[recordSource(row)] || SOURCE_TAG.unknown;

export function isDriftMonth(row, eras) {
  return (row.quality || []).includes('aqua_drift') || eraFor(row.month, eras, row.era) === 'aqua_drift';
}

/**
 * M4.4 (UI-01): the label of a stored gap estimate (a month Aqua missed, filled from VIIRS in the stored record) on the
 * explicitly labelled VIIRS layer. Never "validated": no Aqua value exists to check it against. Provisional regions say
 * "provisional"; drift-era months say "untested".
 */
export function gapEstimateTag(row, region, eras) {
  const parts = ['gap estimate: Aqua has no data'];
  if (region && region.status === 'provisional') parts.push('provisional conversion');
  parts.push(isDriftMonth(row, eras) ? 'untested (Aqua drift era)' : 'not tested');
  return parts.join(' · ');
}

/**
 * Caveats that change how a month reads. They are never hidden behind a click.
 * `verdict` is the month's class ('above' | 'within' | 'below' | 'unknown' | 'none' | null).
 */
export function mustShowCaveats(row, region, eras, verdict) {
  const out = [];
  const src = recordSource(row);
  const q = row.quality || [];
  const derived = isViirsDerived(row);
  if (['above', 'within', 'below'].includes(verdict) && isDriftMonth(row, eras)) {
    out.push({ key: 'drift_unconfirmed', text: 'Aqua’s timing had drifted, so this comparison is unconfirmed.' });
  }
  if (derived) {
    out.push({ key: 'estimated', text: 'Estimated from the newer VIIRS satellite, not measured.' });
    if (!region || region.status !== 'validated') out.push({ key: 'provisional', text: 'Provisional: the conversion has not yet passed its test in this region.' });
    if (nativeStatus(row, 'aqua') !== 'observed') out.push({ key: 'gap_fill', text: 'Aqua has no usable value this month, so this estimate cannot be checked against Aqua.' });
  }
  if (src === 'not_observed' || verdict === 'none') out.push({ key: 'not_observed', text: 'Not observed: no usable satellite data this month. That is not a zero.' });
  if (q.includes('post_modis')) out.push({ key: 'post_modis', text: 'After MODIS: there is nothing to check this estimate against.' });
  return out;
}

const VERDICT_PHRASE = { above: 'above', within: 'within', below: 'below' };

/**
 * The latest-month line. "Provisional" appears only for estimated months (never on measured ones).
 * Returns { lead, text, caveats } where lead is the short verdict ("below usual") and text the sentence.
 */
export function monthSentence(row, { verdict, period, region, eras }) {
  const when = monthLabel(row.month);
  const mname = MONTH_FULL[monthIndex(row.month)];
  const tag = sourceTag(row);
  const caveats = mustShowCaveats(row, region, eras, verdict);
  let text; let lead;
  if (verdict && VERDICT_PHRASE[verdict]) {
    lead = caveats.some((c) => c.key === 'drift_unconfirmed') ? `unconfirmed: ${VERDICT_PHRASE[verdict]} usual` : `${VERDICT_PHRASE[verdict]} usual`;
    text = `${when} (${tag}) was ${VERDICT_PHRASE[verdict]} the ${period} range for ${mname}.`;
  } else if (verdict === 'none' || recordSource(row) === 'not_observed' || recordSource(row) === 'terra_only') {
    lead = 'no comparison';
    text = `${when}: ${tag}, so there is no comparison with a usual ${mname}.`;
  } else {
    lead = 'can’t tell';
    text = `${when} (${tag}): we can’t tell whether it was unusual. ${isViirsDerived(row) ? 'The estimate’s likely range overlaps the edge of the usual range.' : 'There are too few usual years to compare.'}`;
  }
  return { lead, text, caveats };
}

/**
 * The region page's "last month in this record" line. The drift caveat comes before the verdict, never after it.
 * Returns { text, verdictFirst: false, caveats } where caveats excludes the drift caveat already folded into text.
 */
export function lastMonthLine(row, { verdict, period, region, eras }) {
  const s = monthSentence(row, { verdict, period, region, eras });
  const when = monthLabel(row.month); const mname = MONTH_FULL[monthIndex(row.month)];
  const drift = s.caveats.some((c) => c.key === 'drift_unconfirmed');
  const rest = s.caveats.filter((c) => c.key !== 'drift_unconfirmed');
  if (verdict && VERDICT_PHRASE[verdict]) {
    const v = `${VERDICT_PHRASE[verdict]} the ${period} range for ${mname}`;
    return { text: `Last month in this record: ${when}, ${sourceTag(row)}. ${drift ? `Unconfirmed (Aqua’s timing had drifted): ${v}.` : `${v.charAt(0).toUpperCase()}${v.slice(1)}.`}`, caveats: rest, drift };
  }
  return { text: `Last month in this record: ${s.text}`, caveats: rest, drift };
}

/** The year tally line; when any month of the year is a drift month every verdict in it is unconfirmed, and says so first. */
export function tallyText(year, counts, anyDrift) {
  const parts = [['above', 'above usual'], ['within', 'within'], ['below', 'below'], ['unknown', 'can’t tell'], ['none', 'not observed']]
    .filter(([k]) => counts[k] > 0).map(([k, w]) => `${counts[k]} ${w}`);
  return `${year}${anyDrift ? ' (Aqua’s timing had drifted, so all unconfirmed)' : ''}: ${parts.join(' · ')}`;
}

/** Visible explanation of the status chip, shown at its first use on each page. */
export const CHIP_EXPLAINER = 'Comparison status: how well the newer satellite’s numbers convert to the older one’s scale. It matters only for months estimated from the newer satellite.';

/** First years of Aqua data and of VIIRS data, from manifest.eras (modis_only start, overlap start). */
export function satelliteYears(manifest) {
  const eras = (manifest && manifest.eras) || [];
  const m = eras.find((e) => e.id === 'modis_only');
  const o = eras.find((e) => e.id === 'overlap');
  return { aquaFrom: m ? yearOf(m.start) : null, viirsFrom: o ? yearOf(o.start) : null };
}
export const glossAqua = (y) => `Aqua (NASA’s older satellite${y.aquaFrom ? `, measuring since ${y.aquaFrom}` : ''})`;
export const glossViirs = (y) => `VIIRS (the newer satellite instrument${y.viirsFrom ? `, since ${y.viirsFrom}` : ''})`;
export const CONVERSION_GLOSS = 'the conversion (turning newer-satellite counts into the older satellite’s scale)';

/** One plain line on what the likely range is for, with the share from validation.interval_level. */
export function rangeNote(level) {
  const tenths = Number.isFinite(level) ? Math.round(level * 10) : null;
  return `The likely range is wide because monthly counts swing a lot from year to year. A good range catches the real value ${tenths ? `about ${tenths} times in 10` : 'most of the time'}, and is no wider than it needs to be.`;
}

/** Short plain status chip for a region (applies to months estimated from VIIRS only). */
export function regionChip(region) {
  const title = CHIP_EXPLAINER;
  if (!region) return { word: 'unknown', title, tested: false };
  if (region.tier === 'm2_primary' && region.m2) {
    const w = region.m2.validated_window || {};
    const span = w.start && w.end ? `${yearOf(w.start)}–${yearOf(w.end)}` : '';
    const plat = region.m2.predictor_platform === 'noaa20' ? 'NOAA-20' : region.m2.predictor_platform;
    return { word: `VIIRS estimates: validated (${plat}, ${span})`, title: `${region.m2.status_label}: tested on hidden ${span} months; verdicts compare with Aqua’s earlier usual range; not tested after MODIS.`, tested: true, cls: 'held m2', m2: true };
  }
  if (region.status === 'validated') return { word: 'VIIRS estimates: validated (S-NPP)', title, tested: true, cls: 'held' };
  if (region.status === 'provisional') return { word: 'Aqua measured · VIIRS estimates: provisional, not yet reliable (S-NPP)', title: PROVISIONAL_NOTE, detail: PROVISIONAL_DETAIL, tested: true, cls: 'notyet' };
  if (region.status === 'fixture') return { word: 'fixture', title: 'Synthetic test region', tested: true, cls: 'notyet' };
  return { word: 'explore only', title: 'No conversion has been tested here; each satellite is shown on its own scale.', tested: false, cls: 'explore' };
}

/** M4.4 (GD-10): the region's conversion status in a few words, for the map's place card inside a study box. */
export function boxStatusWord(region) {
  const c = regionChip(region);
  if (c.m2) return 'VIIRS conversion validated, NOAA-20';
  if (region && region.status === 'validated') return 'VIIRS conversion validated, S-NPP';
  if (region && region.status === 'provisional') return 'VIIRS conversion provisional, not yet reliable';
  return 'no VIIRS conversion tested';
}

// M4.1 Part 6: provisional regions (Punjab–Haryana, CAR). Observed Aqua and converted VIIRS have different reliability.
export const PROVISIONAL_NOTE = 'VIIRS estimates here are provisional: in the pre-registered test their likely ranges caught Aqua’s real value too rarely. Those test months have now been examined, so a new check here cannot be independent. Aqua’s own measurements are not affected.';
export const PROVISIONAL_DETAIL = 'A future method could gain support from new comparable regions; that would not be a direct validation here.';

// M4.1 Part 7: which satellite an estimated month uses. A fixed, pre-defined rule (docs/m41/SATELLITE-SELECTION.md):
// 1. a validated conversion (M1 S-NPP validated regions; M2 NOAA-20 regions inside their validated window);
// 2. else the region's frozen record lane (S-NPP, M1); 3. else no estimate. Raw counts are never summed; no fusion.
export const SELECTION_NOTE = 'Selected by a fixed rule; not shown to be better than combining satellites.';
/**
 * region: manifest region; platform: the platform id the shown estimate was converted from (read from data);
 * inWindow: for M2 regions, whether the month is inside the validated window.
 * Returns { platform, step, text } or { platform: null, step: 3, text } when the rule selects no estimate.
 */
export function estimateSource(region, { platform = null, inWindow = false, afterValidation = false } = {}) {
  const label = (p) => PLATFORM_LABEL[p] || p;
  if (region && region.tier === 'm2_primary' && region.m2) {
    const p = region.m2.predictor_platform || platform;
    if (inWindow && p) return { platform: p, step: 1, text: `Estimate from: ${label(p)} (rule: validated conversion for this region and period). ${SELECTION_NOTE}` };
    return { platform: null, step: 3, text: `Not an estimate under the rule: no validated conversion for this month and no record lane here, so this converted value is shown for comparison only. ${SELECTION_NOTE}` };
  }
  const p = platform || 'snpp';
  // M1 validation covers the nominal-orbit years only (scientific-qa M4.1 C3): drift-era estimates fall to step 2
  if (region && region.status === 'validated' && !afterValidation) return { platform: p, step: 1, text: `Estimate from: ${label(p)} (rule: validated conversion here). ${SELECTION_NOTE}` };
  if (region && region.status === 'validated') return { platform: p, step: 2, text: `Estimate from: ${label(p)} (rule: this region’s fixed record lane; validated before Aqua’s drift, not after). ${SELECTION_NOTE}` };
  if (region && region.status === 'provisional') return { platform: p, step: 2, text: `Estimate from: ${label(p)} (rule: this region’s fixed record lane; its conversion is provisional here). ${SELECTION_NOTE}` };
  return { platform: null, step: 3, text: `No estimate: no validated conversion and no record lane here. ${SELECTION_NOTE}` };
}

/** Era band label in plain words, years from manifest.eras. */
export function eraPlain(era) {
  const y0 = yearOf(era.start);
  const y1 = era.end ? yearOf(era.end) : null;
  const span = y1 == null ? `From ${y0}` : y0 === y1 ? `${y0}` : `${y0}–${y1}`;
  switch (era.id) {
    case 'terra_only': return `${era.end ? `Until ${monthLabel(era.end)}` : span}: only an earlier satellite (Terra), not on this scale`;
    case 'modis_only': return `${span}: the older satellite only`;
    case 'overlap': return `${span}: both satellites`;
    case 'aqua_drift': return `${span}: the older satellite’s timing drifted, so comparisons are unconfirmed`;
    case 'post_modis': return `${span}: after the older satellite, estimated from the newer one only`;
    default: return `${span}: ${era.label || era.id}`;
  }
}

/** Per-year counts of verdict classes (only the classes; never annual totals mixing measured and estimated). */
export function countVerdicts(classes) {
  const c = { above: 0, within: 0, below: 0, unknown: 0, none: 0 };
  for (const k of classes) if (k && k in c) c[k] += 1;
  return c;
}

/** One plain line for the region banner: how many tested regions held up. */
export function bannerLine(manifest) {
  const tested = (manifest.regions || []).filter((r) => ['validated', 'provisional'].includes(r.status));
  if (!tested.length) return null;
  const ok = tested.filter((r) => r.status === 'validated').length;
  return `Comparisons across satellites held up in ${ok} of ${tested.length} tested regions.`;
}

// ---------- trust ----------

export const shortName = (name) => String(name || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();

// ---------- plain error metric (descriptive, computed from validation.rows) ----------

export const PLAIN_METRIC_LABEL = 'Descriptive summary of stored test predictions, not the pre-registered score (the measure fixed before testing; see Method details).';
export const PLAIN_METRIC_DEFS = '% error = |estimate − measured| ÷ measured. “Within 25%” means a % error of 25% or less. “Within a factor of 2” means the larger of the two numbers is at most twice the smaller. Small measured counts make % errors look large.';

/** |e − a| ÷ a, or null when a is not a positive count. */
export const pctError = (e, a) => (Number.isFinite(e) && Number.isFinite(a) && a > 0 ? Math.abs(e - a) / a : null);
/** max(e, a) ÷ min(e, a), or null when either is not positive. */
export const foldRatio = (e, a) => (e > 0 && a > 0 ? Math.max(e, a) / Math.min(e, a) : null);
export function median(xs) {
  const s = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
const pctWord = (x) => `${Math.round(x * 100)}%`;

/** Held-out rows of one method that can be scored (Aqua observed), primary day/night only. */
export function scoredRows(validation, methodId, keepRegion = () => true, stratum = 'held_out') {
  return ((validation && validation.rows) || []).filter((r) => r.method_id === methodId && r.stratum === stratum
    && (!validation.daynight || r.daynight === validation.daynight) && r.actual_status === 'observed' && Number.isFinite(r.actual) && keepRegion(r.region_id));
}

/** Median % error, within-25% and within-×2 counts for one method. Zero actuals are counted apart (no % error exists). */
export function errorScores(validation, methodId, keepRegion) {
  const rows = scoredRows(validation, methodId, keepRegion);
  const pos = rows.filter((r) => r.actual > 0);
  const p = pos.map((r) => pctError(r.predicted, r.actual));
  return {
    n: pos.length, nZero: rows.length - pos.length, nRegions: new Set(pos.map((r) => r.region_id)).size,
    median: median(p), within25: p.filter((x) => x <= 0.25).length,
    within2: pos.filter((r) => { const f = foldRatio(r.predicted, r.actual); return f != null && f <= 2; }).length,
  };
}

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const num = (n) => NUM[n] || String(n);

/**
 * The plain metric for the Trust page: median % error and "within 25%" for the record's method against the do-nothing
 * guess, over the pooled (core + control) regions the decision uses. Every number is computed here from rows.
 */
export function plainMetric(manifest, validation, recordMethod) {
  const regions = (manifest && manifest.regions) || [];
  const pooled = new Set(regions.filter(isPooledRegion).map((r) => r.id));
  const inPool = (id) => !pooled.size || pooled.has(id);
  const ours = recordMethod ? errorScores(validation, recordMethod, inPool) : null;
  const climId = climatologyMethod(manifest && manifest.methods);
  const guess = climId ? errorScores(validation, climId, inPool) : null;
  if (!ours || !ours.n || ours.median == null) return null;
  const text = `Across ${ours.n} hidden test months in ${num(ours.nRegions)} regions, half of our estimates were within ${pctWord(ours.median)} of what Aqua measured${guess && guess.median != null ? ` (guessing the usual month: half within ${pctWord(guess.median)})` : ''}. ${ours.within25} of ${ours.n} were within 25%.`;
  const detail = `${ours.within2} of ${ours.n} were within a factor of 2.${guess && guess.n ? ` Guessing the usual month: ${guess.within25} of ${guess.n} within 25%, ${guess.within2} within a factor of 2.` : ''}${ours.nZero ? ` ${ours.nZero} months where Aqua reported no detections have no % error and are not counted.` : ''}`;
  // the stretch region(s): a second, labelled line only
  const stretch = regions.filter((r) => !pooled.has(r.id) && ['validated', 'provisional'].includes(r.status));
  let stretchLine = null;
  if (stretch.length && pooled.size) {
    const all = errorScores(validation, recordMethod, () => true);
    if (all.n > ours.n && all.median != null) stretchLine = `With ${andList(stretch.map((r) => shortName(r.name)))} added (a stretch region, still provisional): ${all.n} months, half within ${pctWord(all.median)}, ${all.within25} of ${all.n} within 25%.`;
  }
  return { text, detail, label: PLAIN_METRIC_LABEL, definitions: PLAIN_METRIC_DEFS, stretchLine, ours, guess };
}

/** Per-region median % error of one method (pooled regions), for "one example, not typical" notes. */
export function regionMedians(validation, methodId) {
  const by = new Map();
  for (const r of scoredRows(validation, methodId)) {
    if (!(r.actual > 0)) continue;
    if (!by.has(r.region_id)) by.set(r.region_id, []);
    by.get(r.region_id).push(pctError(r.predicted, r.actual));
  }
  return new Map([...by].map(([k, v]) => [k, median(v)]));
}


/** The do-nothing guess: the climatology reference method, by role/label/id. */
export function climatologyMethod(methods) {
  const list = Array.isArray(methods) ? methods : Object.values(methods || {});
  const m = list.find((x) => /clim|null reference/i.test(`${x.id} ${x.label}`));
  return m ? m.id : null;
}

const span = (ys) => { const s = [...new Set(ys)].filter(Number.isFinite).sort((a, b) => a - b); return !s.length ? null : s[0] === s[s.length - 1] ? String(s[0]) : `${s[0]}–${s[s.length - 1]}`; };

/** Interval coverage of the record method in the drift stratum, and the pre-registered bar, both from validation. */
export function driftCoverage(validation, recordMethod) {
  const lvl = validation && validation.interval_level;
  const s = ((validation && validation.summary) || []).find((x) => x.method_id === recordMethod && x.stratum === 'drift' && x.region_id === 'all'
    && x.season === 'all' && x.metric === 'interval_coverage' && x.interval_level === lvl && (!validation.daynight || x.daynight === validation.daynight));
  const crit = (((validation && validation.decision) || {}).criteria || []).find((c) => c.metric === 'interval_coverage' && c.interval_level === lvl && c.threshold != null);
  const years = span(((validation && validation.rows) || []).filter((r) => r.stratum === 'drift').map((r) => r.year));
  return { value: s && Number.isFinite(s.value) ? s.value : null, n: s ? s.n : null, bar: crit ? crit.threshold : null, years };
}

/**
 * The Trust page story, every number from validation.json and the manifest.
 * Never uses the pooled coverage tick as a trust badge; always states whether the detailed model was adopted.
 */
export function trustStory(manifest, validation, recordMethod) {
  const regions = manifest.regions || [];
  const tested = regions.filter((r) => ['validated', 'provisional'].includes(r.status));
  const held = regions.filter((r) => r.status === 'validated');
  const notYet = regions.filter((r) => r.status === 'provisional');
  const rows = ((validation && validation.rows) || []).filter((r) => r.stratum === 'held_out');
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const heldYears = years.length ? years : [...new Set(regions.flatMap((r) => r.held_out_years || []))].sort((a, b) => a - b);
  const trainSpan = span(regions.flatMap((r) => [...(r.trained_on_years || []), ...(r.held_out_years || [])]));
  const day = validation && validation.daynight === 'D';
  const out = {};
  out.question = 'Can we trust comparisons between these two satellites?';
  const tested_ = `tested on hidden ${andList(heldYears.map(String))}${trainSpan ? ` (method built from the other ${trainSpan} years)` : ''}`;
  out.answer = `Partly. For ${day ? 'daytime ' : ''}detections, ${tested_}, the conversion held up in ${num(held.length)} of ${num(tested.length)} test regions.`;
  // M1.3 closeout: the one short line under the answer; the full experiment sentence moves to the summary section.
  out.lead = 'We hid those years of Aqua MODIS counts (the older sensor) and predicted them from the newer VIIRS sensor; check each guess below.';
  const yrs = satelliteYears(manifest);
  out.experiment = `How we checked: we hid real measurements by ${glossAqua(yrs)} from ${andList(heldYears.map(String))}, built ${CONVERSION_GLOSS} without them, then predicted them from ${glossViirs(yrs)}.`;
  const methods = Object.fromEntries((manifest.methods || []).map((m) => [m.id, m]));
  out.metric = plainMetric(manifest, validation, recordMethod);
  out.error = out.metric ? out.metric.text : null;
  const pooled = tested.filter(isPooledRegion).length;
  out.ranges = held.length || notYet.length
    ? `Our likely ranges held in ${andList(held.map((r) => shortName(r.name)))}${notYet.length ? `, but not often enough in ${andList(notYet.map((r) => shortName(r.name)))}, so ${notYet.length === 1 ? 'that region stays' : 'those stay'} provisional (not yet reliable)` : ''}.`
    : null;
  const d = validation && validation.decision;
  if (d && d.outcome === 'fallback_to_baseline') out.operator = `Our more detailed model did not pass the bar we set before testing, so the record uses the simpler ${methodName(methods[d.adopted_method || recordMethod] || { id: recordMethod }).toLowerCase()}.`;
  else if (d && d.outcome === 'adopt_candidate') out.operator = 'Our more detailed model passed the bar we set before testing, so the record uses it.';
  else if (d) out.operator = 'The test set before running was inconclusive, so no detailed model is adopted.';
  else {
    const failed = ((validation && validation.summary) || []).some((x) => x.metric === 'skill_vs_ratio_log1p' && x.region_id === 'all' && x.passed === false && methodRole(methods[x.method_id]) === 'candidate');
    out.operator = failed ? 'Our more detailed model did not pass the bar we set before testing, so the record uses the simpler ratio method.' : null;
  }
  // which test decides, and the two that cannot
  out.primary = `The test that decides: ${day ? 'daytime, ' : ''}${andList(heldYears.map(String))} hidden, ${num(pooled || tested.length)} regions.`;
  const dc = driftCoverage(validation, recordMethod);
  const driftWhen = dc.years || 'the drift years';
  out.secondary = `Two extra checks that cannot change the decision: ${day ? 'night-time (in the analysis report, not on this site; there the more detailed model did better), and ' : ''}${driftWhen}, when Aqua was drifting.`;
  const covTxt = dc.value != null
    ? (dc.bar != null && dc.value < dc.bar
      ? `the likely ranges caught the real value in only ${pctWord(dc.value)} of months there, below the ${pctWord(dc.bar)} bar`
      : `the likely ranges caught the real value in ${pctWord(dc.value)} of months there`)
    : null;
  out.notTested = `Not part of the deciding test: ${day ? 'night-time, ' : ''}${driftWhen} (checked separately${covTxt ? `; ${covTxt}` : ''}), and anything after MODIS ends.`;
  out.driftCoverage = dc;
  out.heldYears = heldYears;
  return out;
}

/**
 * Plain outcome after a reveal. Point error and range coverage are scored separately: a wide range can catch a poor
 * estimate. Returns { kind, text, point, range } where point and range are the two readout lines.
 * kind: 'gap' | 'none' | 'inside' | 'inside_far' | 'missed'.
 */
export function revealOutcome(est, actual, lo, hi) {
  const e = fmtN(est, 1); const a = fmtN(actual);
  if (actual == null || !Number.isFinite(actual)) {
    return { kind: 'gap', text: 'Can’t be checked: Aqua has no usable value this month.', point: 'Estimate vs measured: no measurement to compare', range: 'Likely range: can’t be checked' };
  }
  const hasRange = lo != null && hi != null;
  const inside = hasRange && actual >= lo && actual <= hi;
  const range = !hasRange ? 'Likely range: none given' : inside ? 'Likely range: caught it' : 'Likely range: missed it';
  if (actual === 0) {
    return { kind: hasRange && !inside ? 'missed' : 'inside', range, point: `Estimate vs measured: ${e} vs no detections reported`,
      text: `Aqua observed this month and reported no detections; the estimate was ${e}.${hasRange ? ` ${inside ? 'That is inside' : 'That is outside'} the likely range ${fmtN(lo, 1)}–${fmtN(hi, 1)}.` : ''}` };
  }
  const p = pctError(est, actual); const f = foldRatio(est, actual);
  const dir = est > actual ? 'high' : 'low';
  const far = f != null && f > 2;
  const point = far ? `Estimate vs measured: ${f.toFixed(1)}× too ${dir}`
    : p < 0.01 ? 'Estimate vs measured: within 1%' : `Estimate vs measured: ${Math.round(p * 100)}% too ${dir}`;
  if (hasRange && !inside) return { kind: 'missed', point, range, text: `Missed: Aqua measured ${a}, ${actual > hi ? 'above' : 'below'} the likely range ${fmtN(lo, 1)}–${fmtN(hi, 1)}.` };
  if (!hasRange) return { kind: far ? 'inside_far' : 'inside', point, range, text: `Estimate ${e} vs measured ${a}. No likely range to check against.` };
  if (far) return { kind: 'inside_far', point, range, text: `Inside the likely range, but the estimate was ${f.toFixed(1)}× too ${dir} (${e} vs ${a}). The range was wide enough; the estimate itself was far off.` };
  const pw = p < 0.1 ? (Math.round(p * 1000) / 10).toString() : String(Math.round(p * 100));
  return { kind: 'inside', point, range, text: `Inside the likely range. Estimate ${e} vs measured ${a}: ${pw}% ${est > actual ? 'over' : est < actual ? 'under' : 'off'}.` };
}

/** A month is a "miss" in the explorer when Aqua fell outside the likely range or the estimate was more than 2× off. */
export function isMiss(est, actual, lo, hi) {
  if (!Number.isFinite(actual)) return false;
  if (lo != null && hi != null && (actual < lo || actual > hi)) return true;
  const f = foldRatio(est, actual);
  return f != null && f > 2;
}

// ---------- M4.2 Trust page: the question, the provisional line and the coverage summary ----------

/** The Trust page question in plain words (M4.2 brief). */
export const TRUST_QUESTION = 'Can the newer satellite reproduce the older satellite’s measurements?';

/** One line naming the earlier-test regions that stay provisional; null when there are none. Names from the manifest. */
export function provisionalLine(manifest) {
  const prov = ((manifest && manifest.regions) || []).filter((r) => r.status === 'provisional');
  if (!prov.length) return null;
  return `In the earlier S-NPP test, ${andList(prov.map((r) => shortName(r.name)))} ${prov.length === 1 ? 'stays' : 'stay'} provisional (not yet reliable).`;
}

/**
 * Where the conversion is validated, provisional or untested, for the Trust coverage strip. Everything from data:
 * the NOAA-20 window and areas (m2_validation + manifest.m2_regions), the S-NPP statuses (manifest.regions).
 */
export function trustCoverage(manifest, m2val) {
  const m1 = (manifest && manifest.regions) || [];
  const m2 = (manifest && manifest.m2_regions) || [];
  const w = m2val && m2val.window;
  const after = w ? yearOf(w.end) + 1 : null;
  const n20Scope = w ? `NOAA-20 · ${monthLabel(w.start)} – ${monthLabel(w.end)}` : 'NOAA-20';
  const snppScope = (r) => `S-NPP · hidden years ${andList((r.held_out_years || []).map(String))}${r.role === 'control' ? ' · control region' : ''}`;
  return {
    validated: [
      ...m2.filter((r) => r.status === 'validated').map((r) => ({ id: r.id, name: shortName(r.name), test: 'NOAA-20', scope: n20Scope })),
      ...m1.filter((r) => r.status === 'validated').map((r) => ({ id: r.id, name: shortName(r.name), test: 'S-NPP', scope: snppScope(r) })),
    ],
    provisional: m1.filter((r) => r.status === 'provisional').map((r) => ({ id: r.id, name: shortName(r.name), test: 'S-NPP', scope: snppScope(r) })),
    untested: [
      { id: 'after', label: after ? `From ${after} on` : 'After the test window', why: 'Aqua’s timing drifted, so its counts can’t confirm the conversion; then MODIS ends.' },
      { id: 'night', label: 'Night-time', why: 'only daytime counts were tested' },
      { id: 'noaa21', label: 'NOAA-21', why: 'no conversion from this satellite was tested' },
    ],
  };
}

// ---------- guided reveal: three months chosen to show a success, a miss and a gap ----------

/**
 * The guided months, by role. Years are never literals: they are indices into the region's held-out / training years
 * from the manifest. Each pick is verified against its role below; if the data no longer fit, a stated rule picks instead.
 */
export const GUIDED = {
  region: 'n_australia_topend',
  success: { heldOut: 'last', month: 11 },
  miss: { heldOut: 'first', month: 1 },
  gap: 'first_training_outage',
};
const mm = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

/**
 * Resolve the three guided months for one region. rows: validation rows of the record method for that region
 * (held-out stratum); months: the region's series rows. Returns { success, miss, gap } of { month, row?, how }.
 */
export function guidedPicks(region, rows, months, spec = GUIDED) {
  const held = [...(region.held_out_years || [])].sort((a, b) => a - b);
  const train = new Set(region.trained_on_years || []);
  const scored = rows.filter((r) => r.region_id === region.id && r.stratum === 'held_out' && r.actual_status === 'observed' && r.actual > 0);
  const at = (sel) => { const y = sel.heldOut === 'last' ? held[held.length - 1] : held[0]; return y == null ? null : scored.find((r) => r.month === mm(y, sel.month)); };
  const inside = (r) => r.lo != null && r.hi != null && r.actual >= r.lo && r.actual <= r.hi;
  // success: inside the range and within 10%; else the closest estimate in the region
  let s = at(spec.success); let sHow = 'agreed pick';
  if (!s || !inside(s) || pctError(s.predicted, s.actual) > 0.1) { s = [...scored].sort((a, b) => pctError(a.predicted, a.actual) - pctError(b.predicted, b.actual))[0]; sHow = 'rule: closest estimate'; }
  // miss the range caught: inside the range but more than 2x off; else the worst such month
  let m = at(spec.miss); let mHow = 'agreed pick';
  if (!m || !inside(m) || !(foldRatio(m.predicted, m.actual) > 2)) { m = scored.filter((r) => inside(r) && foldRatio(r.predicted, r.actual) > 2).sort((a, b) => foldRatio(b.predicted, b.actual) - foldRatio(a.predicted, a.actual))[0]; mHow = 'rule: furthest off while inside the range'; }
  // gap: a training-year month with no usable Aqua value, whose record is a VIIRS estimate
  const g = (months || []).find((r) => train.has(yearOf(r.month)) && nativeStatus(r, 'aqua') !== 'observed' && isViirsDerived(r));
  return {
    success: s ? { month: s.month, row: s, how: sHow } : null,
    miss: m ? { month: m.month, row: m, how: mHow } : null,
    gap: g ? { month: g.month, how: 'rule: first training-year month without Aqua' } : null,
  };
}

/** "One example, not typical" note for the success step, from per-region medians. */
export function successNote(regionId, regionName, medians, pooledMedian) {
  const mine = medians.get(regionId);
  const lowest = mine != null && [...medians.values()].every((v) => v == null || v >= mine);
  return `One example, not typical.${lowest ? ` ${regionName} is the tested region where estimates came closest (half within ${pctWord(mine)}${pooledMedian != null ? `, against ${pctWord(pooledMedian)} across all the deciding months` : ''}).` : ''}`;
}

/** For the miss step: which other methods came closer than ours, with their numbers. */
export function closerThanOurs(card, recordMethod, nameOf) {
  const ours = card.methods.find((x) => x.method_id === recordMethod);
  if (!ours || !Number.isFinite(card.actual)) return null;
  const d = Math.abs(ours.predicted - card.actual);
  const closer = card.methods.filter((x) => x !== ours && Math.abs(x.predicted - card.actual) < d);
  if (!closer.length) return null;
  return `${andList(closer.map((x) => `${nameOf(x.method_id)} (${fmtN(x.predicted, 1)})`))} came closer than our estimate (${fmtN(ours.predicted, 1)}) to what Aqua measured (${fmtN(card.actual)}).`;
}

/** How a month reads as a count: zero is "no detections reported", never "no fires". */
export function countWords(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return 'no count';
  return v === 0 ? 'no detections reported' : `${fmtN(v, digits)} detection${v === 1 ? '' : 's'}`;
}

/** First and last month of the published record, from data: earliest era start, latest region month. */
export function recordSpan(manifest) {
  const eras = (manifest && manifest.eras) || [];
  const starts = eras.map((e) => e.start).filter(Boolean).sort();
  const ends = ((manifest && manifest.regions) || []).map((r) => r.latest_month || r.latest_standard_month).filter(Boolean).sort();
  if (!starts.length || !ends.length) return null;
  const start = starts[0]; const end = ends[ends.length - 1];
  const aqua = eras.find((e) => e.id === 'modis_only');
  const aq = aqua && aqua.start && aqua.start !== start ? ` (Aqua from ${monthLabel(aqua.start)})` : '';
  return { start, end, aquaFrom: aqua ? aqua.start : null, stamp: `Record: ${monthLabel(start)} – ${monthLabel(end)} · not real-time`, long: `Record: ${monthLabel(start)} – ${monthLabel(end)}${aq}, FIRMS standard archive. Not real-time.` };
}

/**
 * M4.4 (QA R5): a test month's tab word. Before the reveal it depends only on POSITION (first / later), never on the
 * month's role, so the label cannot tell the reader which month is the miss. After the reveal it names the outcome.
 */
export function revealRoleWord(index, revealed, role) {
  if (!revealed) return index === 0 ? 'a hidden test month' : 'another hidden test month';
  return role === 'success' ? 'a success' : 'a miss: outside the range';
}

/** GD-01: one quiet geography note per region id, where the box name could mislead (geospatial-data audit).
 *  The share was measured on Aqua detections over the baseline period, which is passed in from the data (no year literals). */
export const REGION_GEO_NOTE = {
  argentina_chaco_parana: (period) => `Box spans Paraguay and Argentina (about 60% of its Aqua ${period ? `${period} ` : 'baseline-period '}detections are in Paraguay).`,
};
export function regionGeoNote(id, period) { const f = REGION_GEO_NOTE[id]; return f ? f(period) : null; }

/** M4.4 landing copy: one headline, one supporting sentence, one action. The year count is the floor of the record span (data). */
export function landingCopy(manifest) {
  const sp = recordSpan(manifest);
  const months = sp ? (yearOf(sp.end) - yearOf(sp.start)) * 12 + (monthIndex(sp.end) - monthIndex(sp.start)) + 1 : 0;
  const years = Math.floor(months / 12);
  return {
    head: years ? `Explore ${years} years of fire detections from satellites that count differently.` : 'Explore fire detections from satellites that count differently.',
    line: `Newer VIIRS sensors can detect smaller hotspots than MODIS; in ${((manifest && manifest.regions) || []).length + ((manifest && manifest.m2_regions) || []).length} study regions we tested whether their counts compare.`,
    cta: 'Compare the satellites',
  };
}


// ---------- glossary ----------

/**
 * Plain line + precise definition for every term the site uses. Years come from `facts` (data), never literals.
 * facts: { heldOut: [years], baseline: 'a–b', driftFrom: year|null, level: 0.9, target: 'k/n'|null }
 */
export function glossary(facts = {}) {
  const held = facts.heldOut && facts.heldOut.length ? andList(facts.heldOut.map(String)) : 'the withheld years';
  const base = facts.baseline || 'the baseline years';
  const lvl = facts.level ? `${Math.round(facts.level * 100)}%` : 'stated';
  return [
    { term: 'Detection', plain: 'A satellite pixel flagged as containing a hot spot when the satellite passed over.', precise: 'An active-fire detection in NASA FIRMS. One fire can make many detections; a small or short fire can make none. Not a fire count, burned area or damage estimate.' },
    { term: 'Making the satellites comparable', also: 'harmonization', plain: 'Putting counts from different satellites on the same scale.', precise: 'Converting VIIRS detections into an estimate of what Aqua MODIS would have recorded, on Aqua’s daytime scale.' },
    { term: 'Tested on hidden years', also: 'held-out test', plain: 'Checking predictions against real measurements that were not used to build the method.', precise: `The method was fitted without ${held}; its predictions were then compared with Aqua’s actual counts for those years.` },
    { term: 'Likely range', also: 'interval', plain: 'The range we expect the real value to fall in, most of the time.', precise: `A ${lvl} prediction interval: about that share of real months should fall inside it.` },
    { term: 'Tested, held up', also: 'validated', plain: 'The conversion passed its test in this region.', precise: `Met the criteria set before testing, for daytime conversion from S-NPP VIIRS on ${held} only. Not night-time, not the drift years, not after MODIS.` },
    { term: 'Tested, not yet reliable', also: 'provisional', plain: 'The conversion was tested here but did not pass yet.', precise: `Too few hidden test months fell inside the likely range${facts.target ? ` (needed ${facts.target})` : ''}. Applies only to months estimated from VIIRS.` },
    { term: 'Timing drift', also: 'drift', plain: 'Aqua now passes over later in the day than it used to.', precise: `${facts.driftFrom ? `Aqua’s orbit began drifting slowly before ${facts.driftFrom}; this site treats ${facts.driftFrom} on as the drift era, when the measured overpass times move.` : 'In its final years Aqua’s orbit drifted later.'} Fire activity changes with the time of day, so later counts may not match earlier years: comparisons are unconfirmed.` },
    { term: 'Aqua-scale detections', plain: 'Detections as Aqua MODIS counts them.', precise: 'Aqua’s own count when measured, or an estimate of what it would have been when converted from VIIRS.' },
    { term: 'Estimated from VIIRS', also: 'estimated', plain: 'Not measured: worked out from the newer satellite.', precise: 'The ratio method’s output, with its likely range. Marked with a frame in the calendar.' },
    { term: 'Usual', plain: 'What a month normally looks like here.', precise: `The middle 80% (10th–90th percentile) of Aqua’s measured counts for that calendar month, ${base}.` },
    { term: 'Can’t tell', plain: 'No verdict: the value could be usual or unusual.', precise: 'Two uses. On the region pages: the estimate’s likely range overlaps an edge of the usual range, or there are too few usual years. In the NOAA-20 test on the Trust page: too few NOAA-20 detections that month to call it (a 90% range that crosses an edge is tagged separately there, and the point verdict is still counted).' },
    { term: 'Not observed', plain: 'No usable satellite data that month. Not a zero.', precise: 'Outside a mission, an outage, or not ingested. Different from “no detections recorded”, where data exist and contain none; clouds or a missed pass can still hide fire.' },
    { term: 'Ratio method', plain: 'The simple conversion the record uses.', precise: 'A per-region, per-season ratio of Aqua to S-NPP counts from the overlap training years, applied to VIIRS counts.' },
    { term: 'More detailed model (not adopted)', also: 'forward operator', plain: 'A more complex conversion we tested and did not adopt.', precise: 'A model of how each satellite sees fire. It did not beat the ratio method by the margin set before testing, so it was rejected under the pre-set rule.' },
    { term: 'After MODIS', plain: 'Once MODIS stops, there is nothing to check against.', precise: 'Months estimated from VIIRS after MODIS ends carry the widest uncertainty and are not validated.' },
    { term: '% error', also: 'within 25%', plain: 'How far an estimate was from what Aqua measured, as a share of the measured value.', precise: PLAIN_METRIC_DEFS },
  ];
}
