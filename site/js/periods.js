// Region-page findings and the unusual-month timeline (M4.1ux), identical for every study region.
// Three operational definitions, all computed in the browser from the published series (no new data):
//  1. Main season (historical preparedness window): the fewest calendar months whose usual (median) Aqua
//     detections together make up at least SEASON_SHARE of a usual year. Describes the past, not a forecast.
//  2. Recurring above-usual months: calendar months in which Aqua's own measurement was above the usual
//     range (p90 of the baseline years) in at least RECUR_MIN of the comparison years. The comparison years
//     come after the baseline and before Aqua's drift, so a year is never judged against itself. With a stable
//     season, a new year beats the p90 of 9 baseline years about 18% of the time (scientific-qa M4 check;
//     PREREG ≈ 0.17), so the bar is RECUR_MIN of the measured years, and the page states the expected number
//     of chance flags per region (binomial; years treated as independent, so it is a screen, not a test).
//  3. Unusual months: individual months above/below the usual range, or "can't tell" when an estimate's
//     range crosses the band edge, listed for the comparison years only (baseline-year months were part of
//     the range). Each carries its source kind (measured / estimated / unconfirmed).
import { MONTH_ABBR, monthIndex, monthLabel, yearOf, rulerValue, monthVerdict } from './core.js';
import { h, glyph } from './ui.js';
import { SCREENING_NOTE } from './story.js';

export const SEASON_SHARE = 0.8;
export const RECUR_MIN = 5;
export const RECUR_MIN_YEARS = 8;
export const CHANCE_RATE = 0.18;

/** P(X ≥ k) for X ~ Binomial(n, p). */
export function binomTail(n, k, p) {
  let t = 0; let c = 1;
  for (let i = 0; i <= n; i += 1) { if (i > 0) c = (c * (n - i + 1)) / i; if (i >= k) t += c * p ** i * (1 - p) ** (n - i); }
  return t;
}
const DRIFT_ERAS = new Set(['aqua_drift', 'post_modis']);

/** Main season: months (0–11) ranked by usual median until SEASON_SHARE of the usual year is reached. */
export function mainSeason(env, minYears, share = SEASON_SHARE) {
  const p = env.map((e, i) => ({ i, v: e && e.n_years >= minYears && e.p50 != null ? e.p50 : null }));
  if (p.some((x) => x.v == null)) return null;
  const total = p.reduce((s, x) => s + x.v, 0);
  if (!(total > 0)) return null;
  const ranked = [...p].sort((a, b) => b.v - a.v);
  const months = []; let acc = 0;
  for (const x of ranked) { if (acc / total >= share) break; months.push(x.i); acc += x.v; }
  return { months: months.sort((a, b) => a - b), share: acc / total, total };
}

/** Comparison years for the recurrence count: after the baseline, before Aqua's drift, measured Aqua only. */
export function comparisonYears(months, env) {
  const baseEnd = Math.max(0, ...env.flatMap((e) => (e && e.years) || []));
  const ys = new Set();
  for (const r of months) {
    const y = yearOf(r.month);
    if (y > baseEnd && !DRIFT_ERAS.has(r.era)) ys.add(y);
  }
  return [...ys].sort((a, b) => a - b);
}

/** Per calendar month: how often measured Aqua was above / within / below the usual range in the comparison years. */
export function recurringAbove(months, env, opts = {}) {
  const years = new Set(opts.years || comparisonYears(months, env));
  // byYear: year -> 'above' | 'within' | 'below' for every decided year (the month card's strip and "Every year, month by month")
  const out = Array.from({ length: 12 }, () => ({ above: 0, within: 0, below: 0, decided: 0, years: [], byYear: {} }));
  for (const r of months) {
    if (!years.has(yearOf(r.month))) continue;
    const v = rulerValue(r, 'record');
    if (v.kind !== 'observed' || v.value == null) continue; // measured Aqua only: estimates never feed this count
    const cls = monthVerdict(r, 'record', env).cls;
    if (!['above', 'within', 'below'].includes(cls)) continue;
    const o = out[monthIndex(r.month)];
    o[cls] += 1; o.decided += 1; o.byYear[yearOf(r.month)] = cls;
    if (cls === 'above') o.years.push(yearOf(r.month));
  }
  for (const o of out) { o.flagged = o.decided >= RECUR_MIN_YEARS && o.above >= RECUR_MIN; o.chance = o.decided >= RECUR_MIN_YEARS ? binomTail(o.decided, RECUR_MIN, CHANCE_RATE) : 0; }
  return { months: out, years: [...years].sort((a, b) => a - b), expectedChanceFlags: out.reduce((s, o) => s + o.chance, 0) };
}

/** Source kind of a month's record value, for labels. */
export function recordKind(r, regionStatus) {
  const v = rulerValue(r, 'record');
  if (v.value == null) return { key: 'unavailable', word: 'no usable data (not zero)' };
  const unconfirmed = DRIFT_ERAS.has(r.era);
  if (v.kind === 'observed') return unconfirmed ? { key: 'observed_drift', word: 'measured · Aqua drifting (unconfirmed)' } : { key: 'observed', word: 'measured by Aqua' };
  const st = regionStatus === 'validated' ? 'conversion held up' : regionStatus === 'provisional' ? 'provisional: not yet reliable' : 'not validated';
  return { key: 'estimated', word: `estimated from VIIRS · ${st}` };
}

/** Every month above or below the usual range, plus estimates whose range crosses a band edge ("can't tell"). */
export function unusualMonths(months, env, regionStatus) {
  const out = [];
  const baseEnd = Math.max(0, ...env.flatMap((e) => (e && e.years) || []));
  for (const r of months) {
    if (yearOf(r.month) <= baseEnd) continue; // baseline-year months helped set the range they would be judged against
    const cls = monthVerdict(r, 'record', env).cls;
    const v = rulerValue(r, 'record');
    const kind = recordKind(r, regionStatus);
    if (cls === 'above' || cls === 'below') out.push({ r, cls, value: v.value, kind });
    else if (cls === 'unknown' && v.kind === 'modelled' && v.value != null) out.push({ r, cls: 'uncertain', value: v.value, kind });
  }
  // confirmed (pre-drift) months first, most recent first; drift-era months after them
  const drift = (u) => (DRIFT_ERAS.has(u.r.era) ? 1 : 0);
  return out.sort((a, b) => drift(a) - drift(b) || (a.r.month < b.r.month ? 1 : -1));
}

const monthSpan = (idx) => {
  // consecutive runs, wrapping Dec→Jan, written "Jul–Oct" or "Dec–Feb, May"
  if (!idx.length) return '';
  const set = new Set(idx); const runs = []; const seen = new Set();
  for (const i of idx) {
    if (seen.has(i)) continue;
    let s = i; while (set.has((s + 11) % 12) && !seen.has((s + 11) % 12) && (s + 11) % 12 !== i) s = (s + 11) % 12;
    let e = s; const run = [s]; seen.add(s);
    while (set.has((e + 1) % 12) && !seen.has((e + 1) % 12)) { e = (e + 1) % 12; run.push(e); seen.add(e); }
    runs.push(run);
  }
  return runs.map((run) => (run.length === 1 ? MONTH_ABBR[run[0]] : `${MONTH_ABBR[run[0]]}–${MONTH_ABBR[run[run.length - 1]]}`)).join(', ');
};
export { monthSpan };

const WORD = { above: 'above usual', below: 'below usual', uncertain: 'can’t tell (the estimate’s range crosses the band edge)' };
const GLYPH_ID = { above: 'above', below: 'below', uncertain: 'unknown' };

/** Short headline findings for the top of the region page (pure; tested). */
export function findings({ months, env, minYears, baseLabel }) {
  const ms = mainSeason(env, minYears);
  const rec = recurringAbove(months, env);
  const yrs = rec.years;
  const yrSpan = yrs.length ? `${yrs[0]}–${yrs[yrs.length - 1]}` : '';
  const flagged = rec.months.map((o, i) => ({ i, o })).filter((x) => x.o.flagged);
  const season = ms
    ? { key: monthSpan(ms.months), head: ['Most detections fall in ', monthSpan(ms.months)], sub: `${Math.round(ms.share * 100)}% of a usual year (Aqua, ${baseLabel}, median-year rule) · a past pattern, not a forecast` }
    : { key: null, head: ['Busiest months: not enough baseline years to say'], sub: '' };
  const shift = flagged.some((x) => x.o.above >= Math.ceil(x.o.decided / 2));
  const recurring = flagged.length
    // M4.2: the head names its period, so it is not read as a verdict on the year shown in the chart
    ? { months: flagged.map((x) => x.i), head: [flagged.map((x) => MONTH_ABBR[x.i]).join(', '), ` ${flagged.length === 1 ? 'was' : 'were'} above usual again and again in ${yrSpan}`],
      sub: `${flagged.map((x) => `${MONTH_ABBR[x.i]} ${x.o.above} of ${x.o.decided}`).join(' · ')} years · a screen: chance alone ≈ 1 year in 5–6` }
    : { months: [], head: ['No month was above usual again and again'], sub: `none above usual in ${RECUR_MIN} or more of the ${yrSpan} years · a screen, not a test` };
  const chance = `Chance alone puts a month above its usual range about 1 year in 5–6. Across all 12 months, about ${rec.expectedChanceFlags < 0.1 ? 'no' : rec.expectedChanceFlags.toFixed(1)} month${rec.expectedChanceFlags >= 0.95 && rec.expectedChanceFlags < 1.05 ? '' : 's'} per region would reach ${RECUR_MIN} by chance. Years are not independent, so treat this as a screen.`;
  const notes = [
    ms ? `Busiest months (this page’s median-year rule): the fewest calendar months whose usual (median) Aqua detections make up at least ${Math.round(SEASON_SHARE * 100)}% of a usual year (${baseLabel}). A historical preparedness window, not a forecast. The Trust page’s pre-registered test season ranks months by their mean instead, so its months can differ.` : null,
    `“Above usual again and again”: Aqua’s own measurement beat the top of that month’s usual range in at least ${RECUR_MIN} of the measured years (${yrSpan}), counted after the baseline years and before Aqua’s orbit drifted. Estimates never count. ${chance}`,
    shift ? 'Above usual in half or more of the recent years: something may have changed since the baseline years (the season itself, land use, or how Aqua observes), rather than a run of one-off spikes.' : null,
  ].filter(Boolean);
  return { mainSeason: ms, recurring: rec, season, recurringLine: recurring, shift, notes };
}

/**
 * Year × month timeline of unusual months (pure; tested). One row per year after the baseline.
 * Cell state: 'above' | 'below' | 'uncertain' (an unusual month, from unusualMonths) | 'within' | 'missing' | 'quiet' | null (outside).
 */
export function unusualTimeline(months, env, regionStatus) {
  const unusual = unusualMonths(months, env, regionStatus);
  const byMonth = new Map(unusual.map((u) => [u.r.month, u]));
  const baseEnd = Math.max(0, ...env.flatMap((e) => (e && e.years) || []));
  const years = new Map();
  for (const r of months) {
    const y = yearOf(r.month);
    if (y <= baseEnd) continue;
    if (!years.has(y)) years.set(y, { year: y, drift: false, cells: Array(12).fill(null) });
    const row = years.get(y);
    if (DRIFT_ERAS.has(r.era)) row.drift = true;
    const u = byMonth.get(r.month);
    let state;
    if (u) state = u.cls;
    else if (rulerValue(r, 'record').value == null) state = 'missing';
    else state = monthVerdict(r, 'record', env).cls === 'within' ? 'within' : 'quiet';
    row.cells[monthIndex(r.month)] = { r, state, kind: u ? u.kind : recordKind(r, regionStatus), drift: DRIFT_ERAS.has(r.era) };
  }
  const rows = [...years.values()].sort((a, b) => a.year - b.year);
  const confirmed = unusual.filter((u) => !DRIFT_ERAS.has(u.r.era));
  const counts = { above: 0, below: 0, uncertain: 0 };
  for (const u of confirmed) counts[u.cls] += 1;
  return { rows, unusual, counts, nDrift: unusual.length - confirmed.length };
}

/**
 * Findings strip (DOM): two short answers. Hovering or focusing one highlights its months in the hero chart and the
 * timeline; activating it opens the zoom on its first month. actions: { highlight(months|null), open(months) }.
 */
export function findingsPanel(f, actions) {
  const item = (cls, mark, head, sub, months) => {
    const btn = h('button', { type: 'button', class: 'f-head', 'aria-describedby': `${cls}-sub` },
      ...head.map((t, k) => (k === (cls === 'f-season' ? 1 : 0) && head.length > 1 ? h('b', { text: t }) : t)));
    if (months && months.length) {
      const on = () => actions.highlight(months); const off = () => actions.highlight(null);
      btn.addEventListener('pointerenter', on); btn.addEventListener('pointerleave', off);
      btn.addEventListener('focus', on); btn.addEventListener('blur', off);
      btn.addEventListener('click', () => actions.open(months));
    } else btn.disabled = true;
    return h('li', { class: `finding ${cls}` }, h('span', { class: 'f-mark', 'aria-hidden': 'true' }, mark), btn, sub ? h('p', { class: 'f-sub', id: `${cls}-sub`, text: sub }) : null);
  };
  return h('section', { class: 'findings', 'aria-label': 'What this record shows' },
    h('ul', { class: 'f-list' },
      item('f-season', h('span', { class: 'f-bracket' }), f.season.head, f.season.sub, f.mainSeason ? f.mainSeason.months : []),
      item('f-recur', h('span', { class: 'f-pips' }, ...[1, 1, 0, 1, 0].map((on) => h('i', { class: on ? 'on' : '' }))), f.recurringLine.head, f.recurringLine.sub, f.recurringLine.months)));
}

/**
 * Unusual months as a year × month timeline (DOM). Every unusual month is a button (one Tab stop, then arrow keys);
 * each year label is a button that lays that year over the hero chart.
 * opts: { months, env, region, mainMonths, onPick(row, el), onYear(year) }
 * Returns { el, timeline, buttons, focusFirst(), setYear(year), highlight(months|null), slot }.
 */
export function timelinePanel({ months, env, region, mainMonths = [], onPick, onYear }) {
  const t = unusualTimeline(months, env, region.status);
  const main = new Set(mainMonths);
  const grid = h('div', { class: 'ut-grid', role: 'group', 'aria-labelledby': 'ut-h', 'aria-describedby': 'ut-help' });
  grid.append(h('span', { class: 'ut-corner', 'aria-hidden': 'true' }), ...MONTH_ABBR.map((m, i) => h('span', { class: `ut-mh${main.has(i) ? ' main' : ''}`, 'data-i': String(i), 'aria-hidden': 'true', text: m })));
  const buttons = []; const yearBtns = new Map(); const cellsByCol = Array.from({ length: 12 }, () => []);
  let driftShown = false;
  for (const row of t.rows) {
    if (row.drift && !driftShown) {
      driftShown = true;
      grid.append(h('p', { class: 'ut-divider' }, h('span', { text: 'Unconfirmed: Aqua’s timing drifted' }), h('span', { class: 'ut-dn', text: ` · ${t.nDrift} unusual month${t.nDrift === 1 ? '' : 's'}` })));
    }
    const yb = h('button', { type: 'button', class: `ut-y${row.drift ? ' drift' : ''}`, tabindex: '-1', 'aria-pressed': 'false', 'aria-label': `Show ${row.year} on the season chart${row.drift ? ' (unconfirmed)' : ''}`, text: String(row.year) });
    yb.addEventListener('click', () => onYear && onYear(row.year));
    yearBtns.set(row.year, yb); grid.append(yb);
    row.cells.forEach((c, i) => {
      const colCls = `ut-c${main.has(i) ? ' main' : ''}`;
      let node;
      if (!c) node = h('span', { class: `${colCls} outside`, 'aria-hidden': 'true' });
      else if (!['above', 'below', 'uncertain'].includes(c.state)) node = h('span', { class: `${colCls} s-${c.state}${c.kind.key === 'estimated' ? ' est' : ''}`, 'aria-hidden': 'true' });
      else {
        const est = c.kind.key === 'estimated';
        node = h('button', { type: 'button', class: `${colCls} v-${c.state}${est ? ' est' : ''}${c.drift ? ' drift' : ''}`, tabindex: '-1', 'data-month': c.r.month,
          'aria-label': `${monthLabel(c.r.month)}: ${WORD[c.state]}; ${c.kind.word}${c.drift && !/unconfirmed/.test(c.kind.word) ? ' (unconfirmed: Aqua’s timing drifted)' : ''}. Open the month.` },
        glyph(GLYPH_ID[c.state]));
        node.__row = c.r; node.__i = i; node.__y = row.year;
        node.addEventListener('click', () => { rove(node); onPick && onPick(c.r, node); });
        buttons.push(node);
      }
      cellsByCol[i].push(node); grid.append(node);
    });
  }
  const firstConfirmed = [...buttons].reverse().find((b) => !b.classList.contains('drift')) || buttons[buttons.length - 1];
  function rove(b) { for (const x of buttons) x.tabIndex = x === b ? 0 : -1; }
  if (firstConfirmed) rove(firstConfirmed);
  // year labels: one Tab stop (the year shown in the chart), Up/Down/Home/End move between years, Enter shows one
  const yList = [...yearBtns.values()];
  function roveYear(b) { for (const x of yList) x.tabIndex = x === b ? 0 : -1; }
  if (yList.length) roveYear(yList[yList.length - 1]);
  grid.addEventListener('keydown', (ev) => {
    const yb = ev.target.closest('button.ut-y');
    if (yb) {
      const k = yList.indexOf(yb);
      const j = { ArrowUp: k - 1, ArrowDown: k + 1, ArrowLeft: k - 1, ArrowRight: k + 1, Home: 0, End: yList.length - 1 }[ev.key];
      if (j === undefined) return;
      ev.preventDefault();
      const nb = yList[Math.max(0, Math.min(yList.length - 1, j))]; roveYear(nb); nb.focus();
      return;
    }
    const b = ev.target.closest('button.ut-c'); if (!b) return;
    const k = buttons.indexOf(b); let next = null;
    if (ev.key === 'ArrowRight') next = buttons[k + 1];
    else if (ev.key === 'ArrowLeft') next = buttons[k - 1];
    else if (ev.key === 'Home') next = buttons[0];
    else if (ev.key === 'End') next = buttons[buttons.length - 1];
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      const dir = ev.key === 'ArrowUp' ? -1 : 1;
      const ys = [...new Set(buttons.map((x) => x.__y))];
      const yi = ys.indexOf(b.__y) + dir;
      if (yi >= 0 && yi < ys.length) { const cand = buttons.filter((x) => x.__y === ys[yi]); next = cand.reduce((a, x) => (Math.abs(x.__i - b.__i) < Math.abs(a.__i - b.__i) ? x : a), cand[0]); }
    } else return;
    ev.preventDefault();
    if (next) { rove(next); next.focus(); }
  });
  const c = t.counts;
  const confirmed = t.unusual.filter((u) => !DRIFT_ERAS.has(u.r.era));
  const nEst = confirmed.filter((u) => u.kind.key === 'estimated').length;
  const slot = h('div', { class: 'ut-latest' });
  // ties this grid to the hero chart (M4.3): same marks as the selected year's point glyphs; the solid ▲ in a column over the
  // comparison years are exactly the month card's "Above usual in k of n" count (tested for every region)
  const rec = recurringAbove(months, env);
  const recSpan = rec.years.length ? `${rec.years[0]}–${rec.years[rec.years.length - 1]}` : '';
  const el = h('section', { class: 'unusual', id: 'unusual', 'aria-labelledby': 'ut-h' },
    h('div', { class: 'ut-head' },
      h('h2', { class: 'section-title', id: 'ut-h', text: 'Months that stood out, year by year' }),
      h('p', { class: 'ut-count' },
        h('span', {}, glyph('above'), ` ${c.above} above`), h('span', {}, glyph('below'), ` ${c.below} below`), h('span', {}, glyph('unknown'), ` ${c.uncertain} can’t tell`),
        h('span', { class: 'ut-scope', text: `before Aqua’s drift${nEst ? ` · ${nEst} from estimates` : ' · all measured by Aqua'}` }))),
    buttons.length ? grid : h('p', { class: 'caption', text: 'No month after the baseline years falls outside its usual range.' }),
    h('p', { class: 'ut-tie', text: `Each row is one year, with the same marks as the selected year’s points on the chart.${recSpan ? ` Solid ▲ in a column, ${recSpan}, add up to the month card’s “Above usual in k of n counted years”.` : ''}` }),
    h('ul', { class: 'ut-key', id: 'ut-help', 'aria-label': 'Key' },
      h('li', {}, h('span', { class: 'ut-sw solid', 'aria-hidden': 'true' }, glyph('above')), 'measured by Aqua'),
      h('li', {}, h('span', { class: 'ut-sw est', 'aria-hidden': 'true' }, glyph('above')), 'estimate from VIIRS'),
      t.nDrift ? h('li', {}, h('span', { class: 'ut-sw drift', 'aria-hidden': 'true' }, glyph('above')), 'unconfirmed (drift years)') : null,
      h('li', {}, h('span', { class: 'ut-sw dot', 'aria-hidden': 'true' }), 'within usual'),
      h('li', {}, h('span', { class: 'ut-sw dot est', 'aria-hidden': 'true' }), 'within usual, estimate'),
      h('li', {}, h('span', { class: 'ut-sw miss', 'aria-hidden': 'true' }), 'no usable data (not a zero)'),
      h('li', { class: 'ut-hint' }, 'Click a year to show it above; click a month to open it.')),
    slot,
    h('div', { class: 'ut-limit' }, h('span', { text: 'Descriptive history, not a warning.' }),
      h('details', { class: 'disclose' }, h('summary', { text: 'What above and below mean' }),
        h('p', { class: 'caption', text: 'Above/below compare a month with the middle 80% of the same calendar month in the baseline years. Even with no change, about one month in three falls outside the middle 80%, so a single unusual month is common; listed from the first year after the baseline. Descriptive history, not a significance test and not a warning.' }),
        h('p', { class: 'caption', text: SCREENING_NOTE }))));
  return {
    el, timeline: t, buttons, slot, nEstimated: nEst,
    focusFirst: () => { const b = buttons.find((x) => x.tabIndex === 0); if (b) b.focus(); },
    setYear: (y) => { for (const [yy, b] of yearBtns) b.setAttribute('aria-pressed', yy === y ? 'true' : 'false'); if (yearBtns.has(y) && !yList.includes(document.activeElement)) roveYear(yearBtns.get(y)); },
    highlight: (ms) => {
      const set = new Set(ms || []);
      grid.classList.toggle('has-hl', set.size > 0);
      cellsByCol.forEach((col, i) => col.forEach((n) => n.classList.toggle('hl', set.has(i))));
      grid.querySelectorAll('.ut-mh').forEach((n) => n.classList.toggle('hl', set.has(Number(n.dataset.i))));
    },
  };
}
