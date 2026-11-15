// Hero seasonal chart: the one seasonal chart on the region page (docs/m41/UX-REVISION.md, docs/m42/REGION-CHART.md,
// simplified in docs/m43/REGION-CHART-SIMPLE.md). Default view, two principal lines and one band:
//   the selected year : the ONE bright line (glowing) with a clear point per month; straight segments between its own
//                       monthly values (no smoothing anywhere: each value is a whole month). Filled = measured by Aqua,
//                       hollow amber diamond = estimate (whisker = likely range), open ring on the baseline = measured
//                       zero, lifted tick = small non-zero, hatched slot = no usable data. A small ▲ / ▼ / ? beside a
//                       point = that year's verdict (only above, below, can't tell; hollow when unconfirmed).
//   the median        : thin silver line, secondary.
//   the usual range   : a subtle translucent band (p10–p90 of each calendar month over Aqua's baseline years), no edge
//                       strokes, so it never reads as a line.
// Below the chart, ONE month card for the month in focus: the selected year's value and verdict, and, in a separate
// block with its own period and marks (squares, never the verdict triangles), how often that calendar month was above
// usual in the comparison years. Year-by-year recurrence for all months sits in the disclosure "Every year, month by month".
//   optional  = each baseline year's own Aqua values (toggle, off); VIIRS converted to Aqua's scale beside Aqua's
//               measured point (switch, off); a month on its own scale across all years (zoom inset, closed)
// SVG is redrawn at the container's pixel size, so marks stay round and lines stay fine. The 12 month columns are
// real buttons over the plot (roving tabindex), so every value has a keyboard path and a text equivalent.
import { MONTH_ABBR, VERDICT, PLATFORM_LABEL, recordSource, monthIndex, yearOf } from './core.js';
import { h, fmtN, glyph } from './ui.js';
import { MONTH_FULL, sourceTag, countWords, isDriftMonth } from './story.js';
import { niceAxis } from './season.js';
import { twoSatModel } from './twosat.js';
import { markState, smallThreshold, svgEl, reducedMotion, motionMs, finiteRuns, profileSegments } from './viz.js';

const ease = (t) => 1 - (1 - t) ** 3;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** Axis tick label: thousands as "k" with one decimal where needed (2,500 -> "2.5k", never "3k"). */
export function tickLabel(t, compact) {
  if (!compact || Math.abs(t) < 1000) return fmtN(t, 1);
  const k = t / 1000;
  return `${Number.isInteger(k) ? fmtN(k) : fmtN(Math.round(k * 10) / 10, 1)}k`;
}

/** Main-season runs on the Jan–Dec axis, the run that carries the share label, and whether the season wraps Dec→Jan. */
export function seasonRuns(months, env) {
  const s = [...(months || [])].sort((a, b) => a - b); const runs = [];
  for (const i of s) { const last = runs[runs.length - 1]; if (last && last[last.length - 1] === i - 1) last.push(i); else runs.push([i]); }
  const wraps = runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1].slice(-1)[0] === 11;
  const weight = (run) => run.reduce((a, i) => a + ((env && env[i] && env[i].p50) || 0), 0);
  const labelRun = runs.length ? runs.reduce((a, r) => (r.length > a.length || (r.length === a.length && weight(r) > weight(a)) ? r : a), runs[0]) : null;
  return { runs, wraps, labelRun, label: (share) => `busiest months${runs.length > 1 ? ` (${runs.length === 2 ? 'both parts' : 'all parts'})` : ''} · ${Math.round(share * 100)}%` };
}

/** The verdict glyph for a month, or null: no glyph without a value (a missing or Terra-only month is not "can't tell"). */
export function verdictGlyph(value, verdict) {
  if (!value || value.value == null || !Number.isFinite(value.value)) return null;
  if (!VERDICT[verdict] || verdict === 'none') return null;
  return VERDICT[verdict].glyph;
}

/**
 * Legend keys for marks that are NOT labelled directly on the chart (M4.2). The band, the median, the selected year,
 * the main season and both lanes carry their own labels where they are drawn, so they are not repeated here.
 * vals: 12 entries, null = outside the record, {value: null} = no usable data. Keys only appear for marks that are drawn.
 */
export function legendKeys({ year, vals, small = 0, showYears = false, viirs = null, baseLabel = '', glyphs = null }) {
  const v = vals.filter(Boolean);
  const est = v.filter((x) => x.value != null && x.kind !== 'observed');
  const k = [];
  if (est.length) k.push(['est', `${year}, estimate from VIIRS (bar = likely range)`]);
  if (v.some((x) => x.value === 0 && x.kind === 'observed')) k.push(['zero', 'open ring = none reported (a measured zero)']);
  if (v.some((x) => x.value != null && markState(x.value, small) === 'small')) k.push(['small', 'tick = small, above zero']);
  if (v.some((x) => x.value == null)) k.push(['missing', 'no usable data (not a zero)']);
  // M4.3: the verdict marks beside the selected year's points (only when some are drawn); glyphs = { drift }
  if (glyphs) k.push(['glyphs', `▲ ▼ ? beside a point = above / below usual / can’t tell in ${year}${glyphs.drift ? ' (hollow = unconfirmed)' : ''}`]);
  if (showYears) k.push(['years', `each ${baseLabel} year`]);
  if (viirs) for (const c of ['test', 'train', 'untested', 'gap']) if (viirs.classes.has(c)) k.push([`v-${c}`, { test: 'VIIRS on Aqua’s scale, test year (hidden from the fit)', train: 'VIIRS on Aqua’s scale, training year (in-sample)', untested: 'VIIRS on Aqua’s scale, not tested', gap: 'VIIRS on Aqua’s scale in a month Aqua missed (gap estimate; cannot be checked, no Aqua value)' }[c]]);
  return k;
}

/**
 * Chart simplification: the three encodings, as a compact key. The VIIRS item appears only while the layer is on.
 * Returns [{ key, text }].
 */
export function heroKeyItems({ year, showViirs = false, baseLabel = '', showYears = false }) {
  const out = [{ key: 'aqua', text: `Aqua measured, ${year}` }];
  if (showViirs) out.push({ key: 'viirs', text: 'VIIRS on Aqua’s scale (converted estimate)' });
  out.push({ key: 'band', text: `usual range (middle 80%, ${baseLabel})` });
  if (showYears) out.push({ key: 'years', text: `each ${baseLabel} year` });
  return out;
}

/** Line segments of the VIIRS series: consecutive months that BOTH have a value; a missing month breaks the line. */
export function viirsSegments(values) {
  const segs = [];
  for (let i = 0; i < values.length - 1; i += 1) {
    const a = values[i]; const b = values[i + 1];
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const last = segs[segs.length - 1];
    if (last && last.to === i) last.to = i + 1; else segs.push({ from: i, to: i + 1 });
  }
  return segs;
}

const CLASS_PHRASE = { test: 'hidden test year', train: 'in-sample training year', gap: 'gap estimates (Aqua missed the month)' };
/**
 * ONE short status line for the VIIRS layer: the region's conversion status, then the classes of this year's drawn months
 * (test / in-sample training / untested (drift era, or NOAA-20 on an S-NPP region) / gap estimate), mixed classes joined.
 * months: [{ cls, drift, platform }]. Pure; tested.
 */
export function viirsStatusLine({ region = null, year, months = [] }) {
  const m2 = !!(region && region.m2);
  const w = m2 && region.m2.validated_window;
  const regionPart = m2 ? `validated (NOAA-20${w ? `, ${w.start.slice(0, 4)}–${w.end.slice(0, 4)}` : ''})`
    : region && region.status === 'validated' ? 'validated (S-NPP)' : region && region.status === 'provisional' ? 'provisional (S-NPP), not yet reliable' : 'not validated';
  if (!months.length) return `VIIRS on Aqua’s scale · no converted month in ${year}`;
  const phrases = [];
  const add = (p) => { if (!phrases.includes(p)) phrases.push(p); };
  for (const x of months) {
    if (x.cls === 'untested') add(!m2 && x.platform && x.platform !== 'snpp' ? 'untested (NOAA-20 on an S-NPP region)' : x.drift ? 'untested (Aqua drift era)' : 'untested (not a test year)');
    else add(CLASS_PHRASE[x.cls] || x.cls);
  }
  return `VIIRS on Aqua’s scale · region test: ${regionPart} · ${year}: ${phrases.join(' + ')}`;
}

const span = (ys) => (ys && ys.length ? (ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`) : '');

/** Recurrence of one calendar month in words: "above usual in 5 of 10 years, <first>–<last>", or null without counted years. */
export function recurPhrase(o, years) {
  if (!o || !o.decided) return null;
  return `above usual in ${o.above} of ${o.decided} years, ${span(years)}`;
}

/**
 * The answer line (M4.2b; inside the month card since M4.3): for one month, the selected year's verdict AND that calendar month's
 * count over the comparison years, each with its own period, so "within usual this year" and "often above before"
 * are read together. Pure. Returns { head, body } or null (no recurrence data, e.g. explore-only regions).
 * m: { i, year, value: {value, kind} | null, env: {p10, p90} | null, verdict, drift, inSample, o: {above, decided, flagged}, years }
 */
export function monthAnswer({ i, year, value, env: e, verdict, drift = false, inSample = false, o, years }) {
  if (!o || !years || !years.length) return null;
  const M = MONTH_FULL[i]; const S = span(years);
  const tag = `${drift ? ' (unconfirmed)' : ''}${inSample ? ` (${year} helped set the usual range)` : ''}`;
  const count = o.decided ? `In ${o.above} of the ${o.decided} counted years ${S}, ${M} was above its usual range` : `No year in ${S} could be counted for ${M}`;
  const inYear = o.decided && o.byYear && o.byYear[year] === 'above' ? `, including ${year}` : '';
  const has = value && value.value != null && Number.isFinite(value.value);
  const amt = !has ? '' : value.value === 0 ? (value.kind === 'observed' ? 'none reported' : 'an estimate of 0') : `${value.kind === 'observed' ? '' : 'an estimate of '}${fmtN(value.value, 1)} detections`;
  const rng = e && e.p10 != null ? ` (${fmtN(e.p10, 1)}–${fmtN(e.p90, 1)})` : '';
  const where = { within: 'inside', above: 'over', below: 'under' }[verdict];
  const often = o.flagged;
  let head;
  if (verdict === 'within') head = often ? `Within usual in ${year}${tag}, but often above usual in ${S}.` : `Within usual in ${year}${tag}.`;
  else if (verdict === 'below') head = often ? `Below usual in ${year}${tag}, though often above usual in ${S}.` : `Below usual in ${year}${tag}.`;
  else if (verdict === 'above') head = often ? `Above usual in ${year}${tag}, as it often was in ${S}.` : `Above usual in ${year}${tag}.`;
  else if (!has) head = `No usable data for ${M} ${year} (not a zero).`;
  else head = `Can’t tell for ${M} ${year}: the estimate’s range crosses the edge of the usual range.`;
  const first = has && where ? `${M} ${year}: ${amt}, ${where} the usual range${rng}. ` : '';
  return { head, body: `${first}${count}${inYear}.` };
}

/**
 * The month card (M4.3): one calendar month, two separate answers. Pure.
 *   year : the selected year's measured activity (value, source) and its verdict against the usual range;
 *   hist : how often that calendar month was above usual in the comparison years (its own period; measured Aqua only).
 * The answer line (monthAnswer head) is kept only when it applies: the month recurs above usual (o.flagged) and the
 * selected year has a verdict. Returns { title, answer, year, hist, caveats }.
 * m: { i, year, inRecord, value: {value, kind, lo, hi} | null, env: {p10, p90} | null, verdict (null = no verdict glyph),
 *      drift, inSample, o: {above, decided, flagged, years, byYear} | null, years, regionStatus, small, baseLabel }
 */
export function monthCard({ i, year, inRecord = true, value, env: e, verdict = null, drift = false, inSample = false, o = null, years = null, regionStatus = '', small = false, baseLabel = '' }) {
  const M = MONTH_FULL[i];
  const has = !!(inRecord && value && value.value != null && Number.isFinite(value.value));
  const est = has && value.kind !== 'observed';
  let amount; let unit;
  if (!inRecord) { amount = 'outside the record'; unit = ''; }
  else if (!has) { amount = 'no usable data'; unit = 'not a zero'; }
  else if (value.value === 0 && !est) { amount = 'none reported'; unit = 'a measured zero'; }
  else { amount = fmtN(value.value, 1); unit = est ? 'detections, estimate' : 'detections'; }
  const source = !has ? { key: 'missing', text: inRecord ? 'no Aqua-scale count for this month' : '' }
    : est ? { key: 'estimate', text: `estimate from VIIRS${value.lo != null && value.hi != null ? ` · likely range ${fmtN(value.lo, 1)}–${fmtN(value.hi, 1)}` : ''}` }
      : { key: 'measured', text: 'measured by Aqua' };
  const rng = e && e.p10 != null ? `usual range ${fmtN(e.p10, 1)}–${fmtN(e.p90, 1)}${baseLabel ? ` (${baseLabel})` : ''}` : '';
  let vText;
  if (verdict === 'above' || verdict === 'within' || verdict === 'below') vText = { above: 'Above the usual range', within: 'Within the usual range', below: 'Below the usual range' }[verdict];
  else if (verdict === 'unknown') vText = 'Can’t tell: the estimate’s range crosses the edge of the usual range';
  else if (!has) vText = 'No verdict without data';
  else vText = rng ? 'No verdict' : 'No verdict: too few usual years for this month';
  const tags = [];
  if (drift && verdict) tags.push(`Unconfirmed: Aqua’s timing had drifted by ${year}`);
  if (inSample && verdict) tags.push(`${year} helped set the usual range, so this comparison is not independent`);
  let hist = null;
  if (o && years && years.length) {
    const S = span(years);
    hist = {
      period: S,
      head: o.decided ? `Above usual in ${o.above} of ${o.decided} counted years` : `No year in ${S} could be counted`,
      // sel: the selected year's position in the strip (an outline and a year tick: where the year sits, not its verdict)
      strip: years.map((y) => ({ y, cls: o.byYear && o.byYear[y] ? (o.byYear[y] === 'above' ? 'on' : 'off') : 'none', sel: y === year })),
      selIn: years.includes(year),
      aboveYears: [...(o.years || [])].sort((a, b) => a - b),
      flagged: !!o.flagged,
      note: 'Measured by Aqua only; estimates and drift years are not counted.',
    };
  }
  // the headline (M4.3b): names the baseline period and both answers; only when the month recurs above usual
  let answer = null;
  if (o && o.flagged && o.decided && ['above', 'within', 'below'].includes(verdict) && has) {
    const S = span(years); const base = baseLabel ? `its ${baseLabel} usual range` : 'its usual range';
    const tag = `${drift ? ' (unconfirmed)' : ''}${inSample ? ` (${year} helped set the usual range)` : ''}`;
    const k = `${o.above} of ${o.decided} years, ${S}`;
    const incl = o.byYear && o.byYear[year] === 'above' ? `, including ${year}` : '';
    answer = verdict === 'within' ? `Within ${base} in ${year}${tag}, but above it in ${k}.`
      : verdict === 'below' ? `Below ${base} in ${year}${tag}, though above it in ${k}.`
        : `Above ${base} in ${year}${tag}, as in ${k}${incl}.`;
  }
  const caveats = [];
  if (est) caveats.push(regionStatus === 'provisional' ? 'This estimate is provisional: the conversion is not yet reliable here. Aqua’s own measurements are not affected.' : 'An estimate from VIIRS, not a measurement.');
  if (small) caveats.push(`Small on this chart’s scale: the zoom shows ${M} on its own scale.`);
  return { title: `${M} ${year}`, answer,
    year: { kicker: `In ${year}`, amount, unit, source, verdict: verdict || null, vText, range: rng, tags }, hist, caveats };
}


/**
 * Secondary view (M4.3): "Every year, month by month". The recurrence detail that used to sit under the chart as a
 * square matrix: a real table, one row per comparison year, one column per month, ■ above usual / □ not above /
 * · not counted, and the k/n count per month in the footer (bold when it recurs). Closed by default.
 * rec: periods.recurringAbove(...). Returns { el, open(i), mark(i) }.
 */
export function everyYearTable(rec) {
  const S = span(rec.years);
  const WORDS = { on: 'above usual', off: 'not above', none: 'not counted' };
  const cell = (o, y) => { const c = o && o.byYear && o.byYear[y] ? (o.byYear[y] === 'above' ? 'on' : 'off') : 'none'; return h('td', { class: `ev-${c}` }, h('i', { 'aria-hidden': 'true' }), h('span', { class: 'visually-hidden', text: WORDS[c] })); };
  const head = h('tr', {}, h('th', { scope: 'col', text: 'Year' }), ...MONTH_ABBR.map((m, i) => h('th', { scope: 'col', 'data-i': String(i) }, h('abbr', { title: MONTH_FULL[i], text: m }))));
  const body = rec.years.map((y) => h('tr', {}, h('th', { scope: 'row', text: String(y) }), ...rec.months.map((o) => cell(o, y))));
  const foot = h('tr', { class: 'ev-sum' }, h('th', { scope: 'row', text: 'Above' }),
    ...rec.months.map((o) => h('td', { class: o && o.flagged ? 'flagged' : '' }, o && o.decided ? `${o.above}/${o.decided}` : '–')));
  const table = h('table', { class: 'ev-table' }, h('caption', { class: 'visually-hidden', text: `Above usual, each year ${S}, by month (measured by Aqua)` }),
    h('thead', {}, head), h('tbody', {}, ...body), h('tfoot', {}, foot));
  const summary = h('summary', { text: `Every year, month by month (${S})` });
  const el = h('details', { class: 'disclose hc-every', id: 'hc-every' }, summary,
    h('p', { class: 'caption', text: `Each row is one year, ${S}. ■ = Aqua measured that month above its usual range; □ = not above; · = not counted (an estimate, no data, or Aqua’s drift years). The bottom row is the count in the month card. Measured by Aqua only.` }),
    h('div', { class: 'ev-wrap' }, table),
    h('p', { class: 'caption' }, 'Every unusual month, including estimates and below-usual months, is also in ', h('a', { href: '#unusual', text: 'the timeline below' }), '.'));
  const mark = (i) => table.querySelectorAll('tr').forEach((tr) => [...tr.children].forEach((c, k) => c.classList.toggle('cur', k === i + 1)));
  return {
    el, mark,
    open: (i) => { el.open = true; mark(i); el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); summary.focus({ preventScroll: true }); },
  };
}

/** True when a month's usual range (p90) would be under `share` of the axis: flat on the shared scale. */
export function tinyOnAxis(e, axisMax, share = 0.02) {
  return !!(e && e.p90 != null && axisMax > 0 && e.p90 < share * axisMax);
}

/** Index of the contrast month with the largest usual median (see contrastMonth), or null. */
export function contrastIndex({ recurrence, env, minYears = 0, verdicts }) {
  if (!recurrence || !recurrence.months) return null;
  let best = null;
  recurrence.months.forEach((o, i) => {
    if (!o || !o.flagged || !['within', 'below'].includes(verdicts[i])) return;
    const e = env[i]; const m = e && e.n_years >= minYears && e.p50 != null ? e.p50 : -1;
    if (best == null || m > best.m) best = { i, m };
  });
  return best ? best.i : null;
}

/** Converted-VIIRS class of a month: held-out test year, training year (in-sample), or not tested. */
export const viirsClass = (m) => (m.gap ? 'gap' : m.heldOut ? 'test' : m.train ? 'train' : 'untested');

/**
 * opts: { env, minYears, axisMax, baseLabel, eras, unitLabel, value(row) -> {value, lo, hi, kind}, verdict(row) -> cls,
 *         mainSeason: {months, share} | null, recurrence: { months: [{above, decided, flagged, byYear}], years } | null (periods.recurringAbove), allRows: every series row (for the zoom),
 *         viirs: { lane, region, status } | null (the converted-VIIRS switch), onPick(row, el) }
 * Returns { el, paint(year, rows), setCurrent(i), focusMonth(i), button(i), peakMonth(), highlight(months|null),
 *           openZoom(i), destroy() }.
 */
export function seasonHero(opts) {
  const { env, minYears, baseLabel } = opts;
  const ax = niceAxis(opts.axisMax);
  const okEnv = (e) => e && e.n_years >= minYears && e.p10 != null;
  const svg = svgEl('svg', { class: 'hc-svg', 'aria-hidden': 'true', focusable: 'false' });
  const cols = h('div', { class: 'hc-cols', role: 'group' });
  const plot = h('div', { class: 'hc-plot' }, svg, cols);
  const yearsBtn = h('button', { type: 'button', class: 'hc-toggle', 'aria-pressed': 'false' }, h('span', { class: 'hc-tg-box', 'aria-hidden': 'true' }), `Each ${baseLabel} year`);
  const zoomBtn = h('button', { type: 'button', class: 'hc-toggle hc-zoom-btn', 'aria-expanded': 'false', 'aria-controls': 'hc-inset' });
  // chart simplification: ONE compact key above the plot with the three encodings (Aqua line, VIIRS line when on, usual
  // band). The rarer marks (missing slot, zero ring, small tick, verdict glyphs) are explained in the month card and
  // each month's accessible label; the separate "Other marks" disclosure was removed at the user's request.
  const key = h('ul', { class: 'hc-key', 'aria-label': 'Lines on the chart' });
  const baseYears = new Set(env.flatMap((e) => (e && e.years) || []));
  const rec = opts.recurrence || null;
  // the month card (M4.3): the selected year's answer and the month's history, in two separate blocks
  const card = h('section', { class: 'hc-card', 'aria-label': 'The month in focus' });
  // secondary view: every comparison year, month by month (the recurrence detail; closed by default)
  const every = rec && rec.years && rec.years.length ? everyYearTable(rec) : null;
  // converted-VIIRS switch: default off ("Aqua only"); never draws into Aqua's measured slot, never sums satellites
  const swAqua = h('button', { type: 'button', class: 'hc-seg', 'aria-pressed': 'true' }, 'Aqua only');
  const swViirs = h('button', { type: 'button', class: 'hc-seg', 'aria-pressed': 'false' }, '+ VIIRS on Aqua’s scale');
  const sw = opts.viirs ? h('div', { class: 'hc-switch', role: 'group', 'aria-label': 'Satellites on the chart' }, swAqua, swViirs) : null;
  // one short status line for the VIIRS layer (region's test + this year's month classes), shown only when the layer is on
  const vNote = opts.viirs ? h('p', { class: 'hc-vnote', hidden: true }) : null;
  // zoom inset: one calendar month in every year, on its own y-axis
  const insetSvg = svgEl('svg', { class: 'hc-inset-svg', 'aria-hidden': 'true', focusable: 'false' });
  const insetTitle = h('p', { class: 'hc-inset-t' });
  const insetDesc = h('p', { class: 'visually-hidden' });
  const insetClose = h('button', { type: 'button', class: 'hc-inset-x', 'aria-label': 'Close the zoom' }, '×');
  const inset = h('div', { class: 'hc-inset', id: 'hc-inset', hidden: true, role: 'region', 'aria-label': 'One month in every year, on its own scale' },
    h('div', { class: 'hc-inset-h' }, insetTitle, insetClose), insetSvg, insetDesc,
    h('p', { class: 'hc-inset-c', text: 'Own scale: small months that the main chart flattens become visible. Band = this month’s usual range.' }));
  const el = h('div', { class: 'hero-chart' },
    h('div', { class: 'hc-top' }, h('p', { class: 'hc-unit', text: opts.unitLabel }), sw),
    vNote, key, plot, card, inset,
    h('div', { class: 'hc-foot' }, h('div', { class: 'hc-btns' }, zoomBtn, yearsBtn)), every ? every.el : null);

  const state = { year: null, rows: Array(12).fill(null), current: 0, why: null, showYears: false, showViirs: false, insetOpen: false, autoZoom: false, zoomDismissed: false, hl: null, vals: Array(12).fill(null), first: true };
  const buttons = [];
  let W = 0; let H = 0; let M = null; let G = null; let raf = 0; let alive = true;
  // below the axis, top to bottom: month labels, main-season bracket (M4.3: no lanes; the month card sits under the plot)
  const geom = () => {
    const narrow = W < 760; // below this the gutter labels no longer fit
    const L = narrow ? { month: 15, bracket: 26, bracketL: 37, end: 44 } : { month: 17, bracket: 29, bracketL: 40, end: 48 };
    M = { l: narrow ? 38 : 56, r: narrow ? 8 : 16, t: 14, b: 0 }; // no right-hand annotation gutter any more
    const pw = Math.max(10, W - M.l - M.r);
    const cw = pw / 12;
    M.b = L.end;
    const ph = Math.max(10, H - M.t - M.b);
    return { narrow, pw, ph, cw, L, X: (i) => M.l + (i + 0.5) * (pw / 12), Y: (v) => M.t + ph * (1 - Math.max(0, Math.min(1, v / ax.max))), base: M.t + ph };
  };
  const small = () => smallThreshold(ax.max, G ? G.ph : 240, 3);
  const vModel = (r) => (opts.viirs && r ? twoSatModel(r, { method: opts.viirs.lane, env, region: opts.viirs.region, eras: opts.eras }) : null);
  // a converted value is drawn beside a month Aqua measured, or (M4.4, UI-01) in a month Aqua missed whose stored record
  // was a gap estimate: then it is drawn only on this layer, beside the hatched "no usable data" slot, marked as a gap estimate
  const vShown = (r, v) => {
    if (!state.showViirs || !r || !v) return null;
    const gap = !!r.gap_estimate && v.value == null;
    if (v.kind !== 'observed' && !gap) return null;
    const m = vModel(r);
    if (!(m && m.est && m.viirs && m.viirs.status === 'observed')) return null;
    return gap ? { ...m, gap: true } : m;
  };

  // ---------- static layers (redrawn on resize) ----------
  const layer = (cls) => svgEl('g', { class: cls });
  let gGrid; let gSeason; let gHl; let gYears; let gBand; let gYear; let gViirs; let gGlyph; let gSel; let gCursor;
  function drawStatic() {
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
    const defs = svgEl('defs');
    const f = svgEl('filter', { id: 'hc-glow', x: '-10%', y: '-30%', width: '120%', height: '160%' });
    f.append(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '3.2', result: 'b' }));
    const mg = svgEl('feMerge'); mg.append(svgEl('feMergeNode', { in: 'b' }), svgEl('feMergeNode', { in: 'SourceGraphic' })); f.append(mg);
    defs.append(f); svg.append(defs);
    [gGrid, gSeason, gHl, gBand, gYears, gYear, gViirs, gGlyph, gSel, gCursor] = ['hc-grid', 'hc-season', 'hc-hl', 'hc-band', 'hc-years', 'hc-year', 'hc-viirs', 'hc-vglyphs', 'hc-sel', 'hc-cursor'].map(layer);
    // the VIIRS line is drawn ON TOP of Aqua's (with a dark casing), so it stays visible where the two nearly coincide
    svg.append(gSeason, gHl, gCursor, gGrid, gBand, gYears, gYear, gViirs, gGlyph, gSel);

    for (const t of ax.ticks) {
      const y = G.Y(t);
      gGrid.append(svgEl('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: t === 0 ? 'hc-baseline' : 'hc-gridline' }));
      const lab = svgEl('text', { x: M.l - 8, y: y + 3.5, class: 'hc-tick', 'text-anchor': 'end' }); lab.textContent = tickLabel(t, G.narrow); gGrid.append(lab);
    }
    const mainSet = new Set(opts.mainSeason ? opts.mainSeason.months : []);
    for (let i = 0; i < 12; i += 1) {
      const x = G.X(i);
      gGrid.append(svgEl('line', { x1: x, x2: x, y1: G.base, y2: G.base + 4, class: 'hc-mtick' }));
      const t = svgEl('text', { x, y: G.base + G.L.month, class: `hc-month${mainSet.has(i) ? ' main' : ''}`, 'text-anchor': 'middle', 'data-i': String(i) }); t.textContent = MONTH_ABBR[i]; gGrid.append(t);
    }
    // main season: shaded columns + brackets; the share label sits on the largest part; a Dec→Jan season gets wrap arrows
    if (opts.mainSeason) {
      const sr = seasonRuns(opts.mainSeason.months, env);
      const by = G.base + G.L.bracket;
      for (const run of sr.runs) {
        const x0 = M.l + run[0] * G.cw; const x1 = M.l + (run[run.length - 1] + 1) * G.cw;
        gSeason.append(svgEl('rect', { x: x0, y: M.t, width: x1 - x0, height: G.ph, class: 'hc-season-col' }));
        const openL = sr.wraps && run[0] === 0; const openR = sr.wraps && run[run.length - 1] === 11;
        gSeason.append(svgEl('path', { d: `M${x0 + 3} ${by - (openL ? 0 : 4)} V${by} H${x1 - 3} V${by - (openR ? 0 : 4)}`, class: 'hc-bracket' }));
        if (openL) gSeason.append(svgEl('path', { d: `M${x0 + 2} ${by} l5 -3.5 v7 z`, class: 'hc-wrap' }));
        if (openR) gSeason.append(svgEl('path', { d: `M${x1 - 2} ${by} l-5 -3.5 v7 z`, class: 'hc-wrap' }));
        if (run === sr.labelRun) {
          const label = sr.label(opts.mainSeason.share);
          const half = (label.length * (G.narrow ? 5.8 : 6.4)) / 2; // mono glyph width estimate keeps the label inside the plot
          const cx = Math.max(M.l + half, Math.min(W - M.r - half, (x0 + x1) / 2));
          const t = svgEl('text', { x: cx, y: G.base + G.L.bracketL, class: 'hc-bracket-l', 'text-anchor': 'middle' }); t.textContent = label; gSeason.append(t);
        }
      }
    }
    // usual range band + missing-baseline slots. M4.2: no smoothing anywhere. Each value is a whole month, so the band
    // edges and the median are straight segments between month centres (a curve would suggest sub-monthly values).
    const line = (pts) => pts.map((p, k) => `${k ? 'L' : 'M'}${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`).join('');
    const p10 = env.map((e) => (okEnv(e) ? e.p10 : null)); const p90 = env.map((e) => (okEnv(e) ? e.p90 : null));
    for (const run of finiteRuns(p10)) {
      const lo = run.map(({ i, v }) => ({ x: G.X(i), y: G.Y(v) }));
      const hi = run.map(({ i }) => ({ x: G.X(i), y: G.Y(p90[i]) }));
      if (run.length === 1) { gBand.append(svgEl('rect', { x: lo[0].x - 6, y: hi[0].y, width: 12, height: Math.max(1, lo[0].y - hi[0].y), class: 'hc-band' })); continue; }
      // M4.3: a fill only, no edge strokes, so the band never reads as another line
      gBand.append(svgEl('path', { d: `${line(hi)}${line([...lo].reverse()).replace(/^M/, 'L')}Z`, class: 'hc-band' }));
    }
    env.forEach((e, i) => { if (!okEnv(e)) gBand.append(svgEl('rect', { x: G.X(i) - G.cw * 0.3, y: M.t, width: G.cw * 0.6, height: G.ph, class: 'hc-nobase' })); });
    // (chart simplification) no median line: the band alone shows the usual range; the median stays in the data and the card
    drawYears(); drawHighlight();
  }

  function drawYears() {
    gYears.replaceChildren();
    gYears.style.display = state.showYears ? '' : 'none';
    if (!state.showYears) return;
    const years = [...new Set(env.flatMap((e) => (okEnv(e) ? (e.pairs || []).map(([y]) => y) : [])))].sort();
    for (const yy of years) {
      const vals = env.map((e) => { const p = okEnv(e) ? (e.pairs || []).find(([z]) => z === yy) : null; return p && Number.isFinite(p[1]) ? p[1] : null; });
      for (const run of finiteRuns(vals)) {
        if (run.length > 1) gYears.append(svgEl('polyline', { points: run.map(({ i, v }) => `${G.X(i)},${G.Y(v)}`).join(' '), class: 'hc-yr-line' }));
        for (const { i, v } of run) gYears.append(svgEl('circle', { cx: G.X(i) + (((yy * 7) % 9) - 4) * 1.2, cy: G.Y(v), r: v > 0 ? 1.6 : 2, class: v > 0 ? 'hc-yr-pt' : 'hc-yr-pt zero' }));
      }
    }
  }

  function drawHighlight() {
    if (!gHl) return;
    gHl.replaceChildren();
    svg.classList.toggle('has-hl', !!state.hl);
    if (!state.hl) return;
    for (const i of state.hl) gHl.append(svgEl('rect', { x: M.l + i * G.cw + 1, y: M.t - 8, width: G.cw - 2, height: G.ph + 8 + G.L.end - 4, class: 'hc-hl-col' }));
  }

  // ---------- the selected year: straight segments between its own values (never smoothed) ----------
  function drawYear(vals) {
    gYear.replaceChildren();
    const pts = state.rows.map((r, i) => (r && vals[i] && vals[i].value != null ? { value: vals[i].value, kind: vals[i].kind } : null));
    for (const sg of profileSegments(pts)) {
      gYear.append(svgEl('line', { x1: G.X(sg.from), y1: G.Y(pts[sg.from].value), x2: G.X(sg.to), y2: G.Y(pts[sg.to].value), class: `hc-yline${sg.dashed ? ' est' : ''}`, filter: sg.dashed ? null : 'url(#hc-glow)' }));
    }
    const sm = small();
    state.rows.forEach((r, i) => {
      if (!r) return;
      const v = vals[i]; const x = G.X(i);
      const st = markState(v ? v.value : null, sm);
      if (st === 'missing') {
        gYear.append(svgEl('rect', { x: x - Math.min(9, G.cw * 0.32), y: G.base - 30, width: Math.min(18, G.cw * 0.64), height: 30, class: `hc-missing${recordSource(r) === 'terra_only' ? ' terra' : ''}` }));
        return;
      }
      const y = st === 'zero' ? G.base : G.Y(v.value);
      if (v.lo != null && v.hi != null) {
        const y0 = G.Y(v.lo); const y1 = G.Y(v.hi);
        gYear.append(svgEl('path', { d: `M${x} ${y0}V${y1}M${x - 4} ${y0}h8M${x - 4} ${y1}h8`, class: `hc-whisk${v.hi > ax.max ? ' clipped' : ''}` }));
      }
      if (v.kind === 'observed') gYear.append(svgEl('circle', { cx: x, cy: y, r: 4.6, class: `hc-pt measured s-${st}` }));
      else gYear.append(svgEl('path', { d: `M${x} ${y - 5.5}L${x + 5.5} ${y}L${x} ${y + 5.5}L${x - 5.5} ${y}Z`, class: `hc-pt estimated s-${st}` }));
      if (st === 'small') gYear.append(svgEl('line', { x1: x, x2: x, y1: y - 7, y2: y - 13, class: 'hc-lift' }));
    });
    drawPointGlyphs(vals);
    if (G) drawSel(vals);
  }

  // the selected year's verdict, ON its own points (M4.3): a small ▲ / ▼ / ? up and to the right of the point, only for
  // above, below and can't tell (within needs no mark; no data has no verdict). Hollow when unconfirmed (Aqua drift).
  // There is no separate glyph row; the history of the month (recurrence) never uses these marks.
  function drawPointGlyphs(vals) {
    gGlyph.replaceChildren();
    state.rows.forEach((r, i) => {
      if (!r) return;
      const vd = opts.verdict(r);
      if (!['above', 'below', 'unknown'].includes(vd)) return;
      const g = verdictGlyph(state.vals[i], vd); const v = vals[i];
      if (!g || !v || v.value == null) return;
      const drift = isDrift(r);
      const sm = small(); const st = markState(v.value, sm);
      const y0 = st === 'zero' ? G.base : G.Y(v.value);
      const gy = Math.min(G.base - 6, vd === 'below' ? y0 + 9 : y0 - 10);
      const sv = svgEl('svg', { x: G.X(i) + 6, y: gy - 4.5, width: 9, height: 9, viewBox: '0 0 12 12', class: `hc-glyph v-${vd}${drift ? ' drift' : ''}` });
      sv.append(svgEl('use', { href: `#g-${g}` }));
      gGlyph.append(sv);
    });
  }

  // converted VIIRS as a real second series (only when the switch is on): an amber dashed line with a thin dark casing,
  // straight segments between month centres, BROKEN wherever a month has no eligible converted value; small markers;
  // only the SELECTED month's 90% range is drawn (as one whisker on its marker). Never drawn into Aqua's slot.
  function drawViirs() {
    gViirs.replaceChildren();
    if (!state.showViirs) return;
    const pts = state.rows.map((r, i) => { const m = vShown(r, state.vals[i]); return m ? { i, m, x: G.X(i), y: m.est.value <= 0 ? G.base : G.Y(m.est.value) } : null; });
    for (const sg of viirsSegments(pts.map((p) => (p ? p.m.est.value : null)))) {
      const d = pts.slice(sg.from, sg.to + 1).map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');
      gViirs.append(svgEl('path', { d, class: 'hc-vcase' }), svgEl('path', { d, class: 'hc-vline' }));
    }
    const cur = pts[state.current];
    if (cur && cur.m.est.lo != null && cur.m.est.hi != null) {
      const y0 = G.Y(cur.m.est.lo); const y1 = G.Y(cur.m.est.hi); const x = cur.x;
      gViirs.append(svgEl('path', { d: `M${x} ${y0}V${y1}M${x - 3.5} ${y0}h7M${x - 3.5} ${y1}h7`, class: 'hc-vwhisk' }));
      if (cur.m.est.hi > ax.max) gViirs.append(svgEl('path', { d: `M${x - 3.5} ${M.t + 4}L${x} ${M.t}L${x + 3.5} ${M.t + 4}`, class: 'hc-vclip' })); // range runs past the axis top
    }
    for (const p of pts) if (p) gViirs.append(svgEl('rect', { x: p.x - 2.6, y: p.y - 2.6, width: 5.2, height: 5.2, class: `hc-vpt${p.i === state.current ? ' cur' : ''}`, 'data-class': viirsClass(p.m) }));
  }

  const isDrift = (r) => ['above', 'within', 'below'].includes(opts.verdict(r)) && isDriftMonth(r, opts.eras);

  // the month in focus: a faint column through the plot, its month label bright, and a ring on the selected year's point
  function drawCursor() {
    gCursor.replaceChildren();
    gCursor.append(svgEl('rect', { x: M.l + state.current * G.cw + 1, y: M.t, width: G.cw - 2, height: G.ph + G.L.month + 4, class: 'hc-cursor-col' }));
    gGrid.querySelectorAll('.hc-month').forEach((t) => t.classList.toggle('cur', Number(t.dataset.i) === state.current));
    drawSel(state.vals);
    if (state.showViirs) drawViirs(); // the one interval follows the selected month
  }
  function drawSel(vals) {
    gSel.replaceChildren();
    const i = state.current; const v = vals[i];
    if (!state.rows[i] || !v || v.value == null) return;
    const st = markState(v.value, small());
    gSel.append(svgEl('circle', { cx: G.X(i), cy: st === 'zero' ? G.base : G.Y(v.value), r: 8.5, class: 'hc-sel-ring' }));
  }

  // ---------- zoom inset: this calendar month in every year, on its own y-axis ----------
  function drawInset() {
    inset.hidden = !state.insetOpen;
    zoomBtn.setAttribute('aria-expanded', state.insetOpen ? 'true' : 'false');
    zoomBtn.textContent = state.insetOpen ? `Hide the ${MONTH_ABBR[state.current]} zoom` : `Zoom: ${MONTH_ABBR[state.current]} on its own scale`;
    if (!state.insetOpen || !G) return;
    const i = state.current; const e = env[i];
    const pts = (opts.allRows || []).filter((r) => monthIndex(r.month) === i).map((r) => ({ r, y: yearOf(r.month), v: opts.value(r) }));
    if (!pts.length) { insetSvg.replaceChildren(); return; }
    const vmax = Math.max(1, okEnv(e) ? e.p90 : 0, ...pts.map((p) => (p.v.value != null ? p.v.value : 0)));
    const a2 = niceAxis(vmax);
    const w = W; const ht = G.narrow ? 132 : 150; const t = 10; const b = 22;
    const y0 = pts[0].y; const n = pts[pts.length - 1].y - y0 + 1;
    const pw = w - M.l - M.r; const ph = ht - t - b;
    const X = (yy) => M.l + (yy - y0 + 0.5) * (pw / n);
    const Y = (v) => t + ph * (1 - Math.max(0, Math.min(1, v / a2.max)));
    insetSvg.replaceChildren();
    insetSvg.setAttribute('viewBox', `0 0 ${w} ${ht}`); insetSvg.setAttribute('width', w); insetSvg.setAttribute('height', ht);
    for (const tk of a2.ticks.filter((_, k, arr) => k === 0 || k === arr.length - 1 || arr.length <= 4)) {
      insetSvg.append(svgEl('line', { x1: M.l, x2: w - M.r, y1: Y(tk), y2: Y(tk), class: tk === 0 ? 'hc-baseline' : 'hc-gridline' }));
      const lab = svgEl('text', { x: M.l - 8, y: Y(tk) + 3.5, class: 'hc-tick', 'text-anchor': 'end' }); lab.textContent = tickLabel(tk, G.narrow); insetSvg.append(lab);
    }
    if (okEnv(e)) {
      insetSvg.append(svgEl('rect', { x: M.l, y: Y(e.p90), width: pw, height: Math.max(1, Y(e.p10) - Y(e.p90)), class: 'hc-band hc-iband' }));
    }
    const sm = smallThreshold(a2.max, ph, 3);
    for (const p of pts) {
      const x = X(p.y); const st = markState(p.v.value, sm); const sel = p.y === state.year;
      if (sel) insetSvg.append(svgEl('rect', { x: x - pw / n / 2, y: t, width: pw / n, height: ph, class: 'hc-isel' }));
      if ((p.y % 5 === 0 && Math.abs(p.y - state.year) >= 2) || sel) { const tx = svgEl('text', { x, y: ht - 6, class: `hc-month${sel ? ' main' : ''}`, 'text-anchor': 'middle' }); tx.textContent = String(p.y); insetSvg.append(tx); }
      if (st === 'missing') { insetSvg.append(svgEl('rect', { x: x - 3, y: Y(0) - 12, width: 6, height: 12, class: 'hc-missing' })); continue; }
      const y = st === 'zero' ? Y(0) : Y(p.v.value);
      if (p.v.kind === 'observed') insetSvg.append(svgEl('circle', { cx: x, cy: y, r: sel ? 4 : 3, class: `hc-pt measured s-${st}` }));
      else insetSvg.append(svgEl('path', { d: `M${x} ${y - 4}L${x + 4} ${y}L${x} ${y + 4}L${x - 4} ${y}Z`, class: `hc-pt estimated s-${st}` }));
      if (st === 'small') insetSvg.append(svgEl('line', { x1: x, x2: x, y1: y - 6, y2: y - 11, class: 'hc-lift' }));
    }
    insetTitle.textContent = `${MONTH_FULL[i]} in every year · own scale 0–${fmtN(a2.max)}`;
    insetDesc.textContent = pts.map((p) => `${p.y}: ${p.v.value == null ? 'no usable data' : `${fmtN(p.v.value, 1)}${p.v.kind === 'observed' ? '' : ' (estimate)'}`}`).join('; ');
  }

  // ---------- text: per-month descriptions (button names) and the month card ----------
  function describe(i) {
    const r = state.rows[i]; const e = env[i];
    if (!r) return { aria: `${MONTH_FULL[i]} ${state.year}: outside the record.`, viirs: null };
    const v = opts.value(r); const vd = opts.verdict(r);
    let aria = `${MONTH_FULL[i]} ${state.year}: `;
    if (v.value == null) { aria += `no Aqua-scale count (${sourceTag(r)}). Not a zero`; }
    else {
      aria += `${v.kind === 'observed' ? countWords(v.value) : `estimate ${fmtN(v.value, 1)}`}, ${sourceTag(r)}${v.lo != null ? `, likely range ${fmtN(v.lo, 1)} to ${fmtN(v.hi, 1)}` : ''}`;
    }
    if (okEnv(e)) { aria += `. Usual ${fmtN(e.p10, 1)} to ${fmtN(e.p90, 1)}`; }
    const g = verdictGlyph(v, vd);
    if (g) {
      const drift = ['above', 'within', 'below'].includes(vd) && isDriftMonth(r, opts.eras);
      aria += `: ${VERDICT[vd].word} in ${state.year}${drift ? ' (unconfirmed: Aqua’s timing drifted)' : ''}`;
    }
    // the historical count for this calendar month, always named with its own period (never the selected year's verdict)
    const rp = rec ? recurPhrase(rec.months[i], rec.years) : null;
    if (rp) aria += `. ${cap(rp)}`;
    const m = vShown(r, v); let vtxt = null;
    if (m) {
      const plat = PLATFORM_LABEL[m.viirs.platform] || m.viirs.platform;
      const ratio = m.viirs.n > 0 && m.est.value > 0 ? m.viirs.n / m.est.value : null;
      const rTxt = ratio ? (ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)) : null;
      const cls = m.gap ? (opts.viirs.gapTag ? opts.viirs.gapTag(r) : 'gap estimate; cannot be checked (no Aqua value)') : { test: 'test year', train: 'training year (in-sample)', untested: 'not tested' }[viirsClass(m)];
      const txt = `${plat} ${fmtN(m.viirs.n)} raw${rTxt ? ` ÷${rTxt}` : ''} → ${fmtN(m.est.value, 1)} (${fmtN(m.est.lo, 1)}–${fmtN(m.est.hi, 1)}) on Aqua’s scale · ${cls}`;
      vtxt = txt; aria += `. VIIRS converted: ${txt}`;
    }
    return { aria: `${aria}.`, viirs: vtxt };
  }
  // the month card: two blocks that never share a mark. Left: the selected year (verdict triangles, bright).
  // Right: the calendar month's history over the comparison years (squares, silver), with its own period in its title.
  function cardModel(i) {
    const r = state.rows[i]; const v = r ? state.vals[i] : null; const vd = r ? opts.verdict(r) : null;
    const st = v && v.value != null ? markState(v.value, small()) : null;
    return monthCard({ i, year: state.year, inRecord: !!r, value: v, env: okEnv(env[i]) ? env[i] : null, verdict: r && verdictGlyph(v, vd) ? vd : null,
      drift: !!r && isDrift(r), inSample: baseYears.has(state.year), o: rec ? rec.months[i] : null, years: rec ? rec.years : null,
      regionStatus: opts.regionStatus || '', small: !!r && v && v.value != null && (st === 'small' || (v.value > 0 && tinyOnAxis(env[i], ax.max))), baseLabel });
  }
  function paintCard(i) {
    const c = cardModel(i); const r = state.rows[i];
    const y = c.year;
    const srcMark = h('span', { class: `hc-srcmark ${y.source.key}`, 'aria-hidden': 'true' });
    const yearBlock = h('div', { class: 'hc-cy' },
      h('p', { class: 'hc-kick', text: y.kicker }),
      h('p', { class: 'hc-cy-v' }, h('b', { text: y.amount }), y.unit ? h('span', { text: ` ${y.unit}` }) : null),
      y.source.text ? h('p', { class: 'hc-cy-src' }, srcMark, y.source.text) : null,
      h('p', { class: `hc-cy-vd v-${y.verdict || 'none'}` }, y.verdict && y.verdict !== 'within' ? glyph(VERDICT[y.verdict].glyph) : y.verdict === 'within' ? h('span', { class: 'hc-dot', 'aria-hidden': 'true' }) : null,
        h('span', { text: y.vText })),
      y.range ? h('p', { class: 'hc-cy-rng', text: y.range }) : null,
      ...y.tags.map((t) => h('p', { class: 'hc-tag', text: t })));
    const d = r ? describe(i) : null;
    if (d && d.viirs) yearBlock.append(h('p', { class: 'hc-cy-viirs', text: `VIIRS converted: ${d.viirs}` }));
    if (r) yearBlock.append(h('button', { type: 'button', class: 'hc-linkbtn hc-open', onclick: (ev) => opts.onPick(r, ev.currentTarget), text: `Open ${c.title} in detail` }));
    // the one Trust link near the chart (the header carries the other), directly under the "In <year>" block
    const hrefOf = (o) => (typeof o.href === 'function' ? o.href(r) : o.href);
    if (opts.trust) yearBlock.append(h('a', { class: 'hc-trust', href: hrefOf(opts.trust), 'data-nav': 'trust', 'data-region': opts.trust.region, text: 'How trustworthy is the satellite comparison here? →' }));
    // M4.4: the Time Machine entry (NOAA-20 areas), one quiet link
    if (opts.machine) yearBlock.append(h('a', { class: 'hc-trust hc-machine', href: hrefOf(opts.machine), 'data-nav': 'trust', 'data-region': opts.machine.region, text: 'Compare the satellites here →' }));
    let histBlock = null;
    if (c.hist) {
      const H2 = c.hist;
      histBlock = h('div', { class: 'hc-ch' },
        h('p', { class: 'hc-kick', text: `${MONTH_FULL[i]}, ${H2.period}` }),
        h('p', { class: `hc-ch-v${H2.flagged ? ' flagged' : ''}`, text: H2.head }),
        h('div', { class: 'hc-strip', 'aria-hidden': 'true' },
          h('span', { class: 'hc-strip-sq' }, ...H2.strip.map((x) => h('i', { class: `${x.cls}${x.sel ? ' sel' : ''}`, title: `${x.y}: ${{ on: 'above usual', off: 'not above', none: 'not counted' }[x.cls]}` }))),
          h('span', { class: 'hc-strip-y' }, ...H2.strip.map((x, k, a) => {
            const near = (j) => H2.selIn && Math.abs(a.findIndex((z) => z.sel) - j) <= 2 && !a[j].sel;
            const show = x.sel || ((k === 0 || k === a.length - 1) && !near(k));
            return h('span', { class: x.sel ? 'sel' : '', text: show ? String(x.y) : '' });
          }))),
        h('p', { class: 'hc-ch-yrs', text: H2.aboveYears.length ? `Above in ${H2.aboveYears.join(', ')}.` : 'Not above usual in any counted year.' }),
        h('p', { class: 'hc-ch-note', text: `Filled square = above usual that year; empty = not above; dot = not counted. ${H2.note}` }),
        every ? h('button', { type: 'button', class: 'hc-linkbtn', onclick: () => every.open(i), text: 'Every year, month by month ↓' }) : null);
    }
    const parts = [
      h('div', { class: 'hc-card-h' }, h('h3', { class: 'hc-card-t', text: c.title }), c.answer ? h('p', { class: 'hc-card-ans', text: c.answer }) : ''),
      // why this month is shown (M4.3b): only while the month chosen by the contrast rule is on show and still a contrast case
      state.why === i && c.answer && ['within', 'below'].includes(c.year.verdict) ? h('p', { class: 'hc-why', text: `Showing a month that is often above usual but wasn’t in ${state.year} · click any month` }) : '',
      h('div', { class: `hc-card-b${histBlock ? '' : ' one'}` }, yearBlock, histBlock || ''),
    ];
    if (c.caveats.length) parts.push(h('ul', { class: 'hc-cav' }, ...c.caveats.map((t) => h('li', { text: t }))));
    card.replaceChildren(...parts);
  }

  // ---------- month buttons (a month outside the record is aria-disabled and skipped by the arrows) ----------
  for (let i = 0; i < 12; i += 1) {
    const b = h('button', { type: 'button', class: 'hc-col', 'data-i': String(i), tabindex: i === 0 ? '0' : '-1' });
    // M4.4: no hover preview; the card (and its links) change only when a month is selected by click or focus
    // focus (Tab, arrows) commits the month too: the card fills and the URL's month= follows (replaceState)
    b.addEventListener('focus', () => { setCur(i, true); if (b.__row && opts.onSelect) opts.onSelect(b.__row); });
    buttons.push(b); cols.append(b);
  }
  // M4.3: a click (or Enter) selects the month and fills the month card; its "Open … in detail" button opens the full month
  cols.addEventListener('click', (ev) => { const b = ev.target.closest('.hc-col'); if (b && b.__row) { setCur(Number(b.dataset.i), true); if (opts.onSelect) opts.onSelect(b.__row); } });
  cols.addEventListener('keydown', (ev) => {
    const b = ev.target.closest('.hc-col'); if (!b) return;
    const i = Number(b.dataset.i);
    const dir = { ArrowLeft: -1, ArrowRight: 1, Home: 1, End: -1 }[ev.key];
    if (dir === undefined) return;
    ev.preventDefault();
    let j = ev.key === 'Home' ? 0 : ev.key === 'End' ? 11 : i + dir;
    while (j >= 0 && j <= 11 && !buttons[j].__row) j += dir;
    if (j < 0 || j > 11) return;
    buttons[j].focus();
  });
  function rove() { buttons.forEach((b, k) => { b.tabIndex = k === state.current ? 0 : -1; }); }
  // a month whose usual range is under 2% of the axis is flat on the shared scale: open its own-scale zoom with it
  // (and close a zoom that was opened that way when the reader moves to a month that is visible)
  function setCur(i, user = false) {
    if (user && state.why !== i) state.why = null; // the reader chose another month: the contrast caption goes
    state.current = i; rove(); if (G) drawCursor(); paintCard(i); if (every) every.mark(i);
    const tiny = tinyOnAxis(env[i], ax.max);
    if (tiny && !state.insetOpen && !state.zoomDismissed) { state.insetOpen = true; state.autoZoom = true; }
    else if (!tiny && state.autoZoom) { state.insetOpen = false; state.autoZoom = false; }
    drawInset();
  }

  function paintLegend() {
    const shown = state.showViirs ? state.rows.map((r, i) => { const m = vShown(r, state.vals[i]); return m ? { m, r } : null; }).filter(Boolean) : [];
    key.replaceChildren(...heroKeyItems({ year: state.year, showViirs: state.showViirs && shown.length > 0, baseLabel, showYears: state.showYears }).map((it) => h('li', { 'data-key': it.key }, h('span', { class: `hc-k ${it.key}`, 'aria-hidden': 'true' }), it.text)));
    if (vNote) {
      vNote.hidden = !state.showViirs;
      if (state.showViirs) vNote.textContent = viirsStatusLine({ region: opts.viirs.region, year: state.year, months: shown.map(({ m, r }) => ({ cls: viirsClass(m), drift: isDriftMonth(r, opts.eras), platform: m.viirs && m.viirs.platform })) });
    }
  }

  // ---------- paint / motion ----------
  function paint(year, rows) {
    const prev = state.vals;
    const changed = state.year !== null && state.year !== year;
    state.year = year; state.rows = rows;
    const next = rows.map((r) => (r ? opts.value(r) : null));
    state.vals = next;
    cols.setAttribute('aria-label', `${year} against the usual year, month by month. Left and right arrows move; the month card below the chart describes the month.`);
    buttons.forEach((b, i) => { const r = rows[i]; b.__row = r || null; b.setAttribute('aria-disabled', r ? 'false' : 'true'); b.setAttribute('aria-label', describe(i).aria); });
    paintLegend();
    paintCard(state.current);
    if (!G) return;
    drawCursor(); drawViirs(); drawInset();
    cancelAnimationFrame(raf);
    const ms = motionMs(420, reducedMotion());
    if (!changed || !ms) { drawYear(next); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (!alive) return;
      const k = ease(Math.min(1, (now - t0) / ms));
      const mid = next.map((v, i) => {
        const p = prev[i];
        if (!v || v.value == null || !p || p.value == null) return v;
        const lerp = (a, b) => (a == null || b == null ? b : a + (b - a) * k);
        return { ...v, value: lerp(p.value, v.value), lo: v.lo == null ? null : lerp(p.lo ?? p.value, v.lo), hi: v.hi == null ? null : lerp(p.hi ?? p.value, v.hi) };
      });
      drawYear(k < 1 ? mid : next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function intro() {
    if (!motionMs(1, reducedMotion()) || !gBand.animate) return;
    gBand.style.transformOrigin = `0 ${G.base}px`;
    gBand.animate([{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(0.16,1,0.3,1)' });
    for (const g of [gYear, gGlyph, gSel]) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 600, fill: 'backwards' });
  }

  function layout() {
    if (!alive) return;
    const w = Math.round(plot.clientWidth); const ht = Math.round(plot.clientHeight);
    if (!w || !ht || (w === W && ht === H)) return;
    const firstDraw = !G;
    W = w; H = ht; G = geom();
    cols.style.left = `${M.l}px`; cols.style.right = `${M.r}px`; cols.style.top = `${Math.max(0, M.t - 8)}px`; cols.style.bottom = '2px';
    drawStatic(); drawYear(state.vals); drawViirs(); drawCursor(); paintLegend(); drawInset();
    if (firstDraw && state.first) { state.first = false; intro(); }
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
  if (ro) ro.observe(plot);
  raf = requestAnimationFrame(layout);

  yearsBtn.addEventListener('click', () => {
    state.showYears = !state.showYears;
    yearsBtn.setAttribute('aria-pressed', state.showYears ? 'true' : 'false');
    if (G) drawYears();
    paintLegend();
  });
  const setViirs = (on) => {
    state.showViirs = on;
    swAqua.setAttribute('aria-pressed', on ? 'false' : 'true'); swViirs.setAttribute('aria-pressed', on ? 'true' : 'false');
    buttons.forEach((b, i) => b.setAttribute('aria-label', describe(i).aria));
    if (G) drawViirs();
    paintLegend(); paintCard(state.current);
  };
  swAqua.addEventListener('click', () => setViirs(false));
  swViirs.addEventListener('click', () => setViirs(true));
  const setZoom = (open) => { state.insetOpen = open; state.autoZoom = false; if (!open) state.zoomDismissed = true; drawInset(); };
  zoomBtn.addEventListener('click', () => setZoom(!state.insetOpen));
  insetClose.addEventListener('click', () => { setZoom(false); zoomBtn.focus(); });
  drawInset();

  const peakMonth = () => {
    let best = -1; let bi = 0;
    state.vals.forEach((v, i) => { if (state.rows[i] && v && v.value != null && v.value > best) { best = v.value; bi = i; } });
    return bi;
  };

  // Default month-card month (fixed rule, M4.2b): among months that recur above usual but are within/below usual in the
  // selected year, the one with the LARGEST usual median, so the case is visible on the shared axis (n_australia: Jun).
  const contrastMonth = () => contrastIndex({ recurrence: rec, env, minYears,
    verdicts: state.rows.map((r, k) => (r && verdictGlyph(state.vals[k], opts.verdict(r)) ? opts.verdict(r) : null)) });

  return {
    el, paint, contrastMonth,
    setCurrent: (i, { why = false } = {}) => { if (why) state.why = i; setCur(i); },
    focusMonth: (i) => { setCur(i); buttons[i].focus(); },
    button: (i) => buttons[i],
    peakMonth,
    highlight: (months) => { state.hl = months && months.length ? months : null; drawHighlight(); },
    openZoom: (i) => { if (i != null) setCur(i); setZoom(true); },
    setViirs,
    toggle: yearsBtn,
    destroy: () => { alive = false; if (ro) ro.disconnect(); cancelAnimationFrame(raf); },
  };
}
