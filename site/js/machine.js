// M4.4/M4.5 Satellite Time Machine: a guided three-stage view of ONE stored hidden test month (Compare -> Harmonize -> Reveal),
// for every study region. It renders a RegionCase from trustcase.js (TestMonth rows + the region's stored result + a per-test
// config); it never reads a test's files itself and never asks which satellite it shows. Only the region's own tested
// satellite appears. It computes nothing new except presentation (positions on a linear axis, |est - actual| rounded).
// URL: ?view=trust&region=<id>[&month=YYYY-MM][&stage=1|2]. Stage 3 is never written to the URL (R6).
import { h, fmtN, prefersReducedMotion } from './ui.js';
import { MONTH_LONG, errorRatio, revealMotion } from './m2.js';
import { niceAxis } from './season.js';
import { WHY_LINE } from './twosat.js';
import { revealedKeys, errorPlain, usualWord } from './decades.js';
import { nextTestRow, urlStage, parseStage, fallbackLine, MONTH_RE } from './nav.js';
import { TEST_CONFIG } from './trustcase.js';

export const STAGES = ['Compare', 'Harmonize', 'Reveal'];

/**
 * Everything one stage needs from one TestMonth (trustcase.js). Pure. Before the reveal (withActual false) Aqua's value,
 * its side and the gap are absent AND excluded from the axis domain, so nothing about the hidden value leaks (G1).
 */
export function machineModel(tm, { withActual = false } = {}) {
  if (!tm) return null;
  const vals = [tm.raw, tm.hi, tm.envHi, withActual ? tm.actual : null, tm.est].filter((v) => Number.isFinite(v));
  const vmax = Math.max(1, ...vals);
  const nice = niceAxis(vmax);
  const ax = { max: vmax * 1.06, ticks: nice.ticks.filter((t) => t <= vmax * 1.06) }; // the largest value sits near the right edge
  const ratio = tm.raw > 0 && tm.est > 0 ? tm.raw / tm.est : null;
  return {
    month: tm.month, region: tm.region, mi: tm.mi, year: tm.year, test: tm.test, satellite: tm.satellite,
    raw: tm.raw, pred: tm.est, lo: tm.lo, hi: tm.hi, actual: withActual ? tm.actual : null, envLo: tm.envLo, envHi: tm.envHi,
    rawVerdict: tm.rawVerdict, ratio, ratioTxt: ratio ? (ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)) : null,
    side: withActual ? tm.side : null,
    apart: withActual && Number.isFinite(tm.est) && Number.isFinite(tm.actual) ? Math.round(Math.abs(tm.est - tm.actual)) : null,
    axis: ax, pct: (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, (v / ax.max) * 100)) : null),
  };
}

/** One headline and at most one short sentence per stage (D2's S-NPP line is two short sentences, by decision). Pure. */
export function machineCopy(m, stage, { k, n } = {}, cfg = TEST_CONFIG[m.test] || TEST_CONFIG.m2, rt = null) {
  const M = MONTH_LONG[m.mi];
  if (stage === 1) return { head: cfg.s1head, line: cfg.s1line(m, M) };
  if (stage === 2) return { head: 'Converted to Aqua’s scale.', line: cfg.s2line(rt) };
  // the revealed Aqua numeral is the large figure; the headline carries only the range check
  const head = m.side === 'inside' ? 'Inside the 90% range.' : m.side === 'above' ? 'Above the 90% range.' : m.side === 'below' ? 'Below the 90% range.' : 'Range not stored.';
  return { head, line: n ? `One genuine held-out example, not a guarantee: ${k} of ${n} test months here landed inside.` : 'One genuine held-out example, not a guarantee.' };
}

/** The NOAA-20 stored verdict-agreement call, short and separate from the range check (never computed for S-NPP). */
export function verdictCall(tm) {
  if (!tm || tm.test !== 'm2') return null;
  // a stored "can't tell" from the converted side (fewer than 10 NOAA-20 detections) is "no call", never "didn't match"
  if (tm.verdictPred === 'cant_tell') return 'Unusual-or-not call: no call (too few NOAA-20 detections)';
  return tm.verdictMatch == null ? null : `Unusual-or-not call: ${tm.verdictMatch ? 'matched' : 'didn’t match'}`;
}
/** A count as shown: a stored 0 is a genuine zero ("none reported"); a missing value is never 0. */
export const countText = (v) => (v == null ? '–' : fmtN(v));
const zeroSub = (v) => (v === 0 ? 'none reported' : null);
/** Range ends under 10 keep one decimal, so 0.13 never reads as 0 (QA). */
export const rangeN = (v) => (v != null && Math.abs(v) < 10 ? fmtN(v, 1) : fmtN(v));

/**
 * The view. rc: a RegionCase (trustcase.regionCase). opts: { name, footer (approved limits text), stage2Detail: [texts],
 *   onEvidence() (opens the in-page evidence; Esc too), recordHref, base (baseline years label) }.
 * Returns a root element with __afterMount/__teardown, or null when the region has no complete test month.
 */
export function timeMachine(ctx, rc, opts = {}) {
  if (!rc || rc.missing || !rc.months || !rc.months.length) return null;
  const { months, cfg } = rc;
  const byMonth = new Map(months.map((t) => [t.month, t]));
  const asked = ctx.params.month;
  const askedRow = asked && MONTH_RE.test(asked) ? byMonth.get(asked) : null;
  const exampleRow = rc.example && byMonth.get(rc.example.month);
  const missRow = rc.miss && byMonth.get(rc.miss.month);
  const first = askedRow || exampleRow || months[0];
  const note = asked && !askedRow ? fallbackLine.trust(asked, first.month) : null;
  const st = { row: first, how: askedRow ? 'chosen in the link' : first === exampleRow ? rc.example.how : 'first test month', stage: parseStage(ctx.params.stage), guess: null, seen: new Set([first.month]) };
  const key = (r) => `${r.region}|${r.month}`;
  const tally = { k: rc.k, n: rc.n };

  const rail = h('ol', { class: 'tm-rail', 'aria-label': 'Steps' });
  const metaEl = h('p', { class: 'tm-meta' }, h('span', { class: `tm-chip st-${rc.status}`, text: rc.meta.chip }), h('span', { class: 'tm-meta-t', text: rc.meta.meta }));
  const reasonEl = rc.meta.reasons && rc.meta.reasons.length ? h('p', { class: 'tm-reason' }, ...rc.meta.reasons.flatMap((x, i) => (i ? [h('br'), x] : [x]))) : '';
  const kicker = h('p', { class: 'tm-kicker' });
  const head = h('h2', { class: 'tm-head', tabindex: '-1', id: 'tm-h' });
  const line = h('p', { class: 'tm-line' });
  const fig = h('figure', { class: 'tm-fig' });
  const actions = h('div', { class: 'tm-actions' });
  const more = h('div', { class: 'tm-more' });
  // limits near every converted value: A12 (NOAA-20) or the S-NPP regionLimits sentences ({ visible, more })
  const fv = typeof opts.footer === 'string' ? { visible: [opts.footer], more: [] } : opts.footer || { visible: [], more: [] };
  const foot = h('div', { class: 'caption tm-a12', 'data-claim': rc.test === 'm2' ? 'A12' : 'm1-limits' },
    ...fv.visible.map((x) => h('p', { text: x })),
    fv.more.length ? h('details', { class: 'tm-limits-more' }, h('summary', { text: 'More limits' }), ...fv.more.map((x) => h('p', { text: x }))) : '');
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const root = h('section', { class: 'view-enter tm', 'aria-labelledby': 'tm-h', 'data-region': rc.region, 'data-test': rc.test },
    metaEl, reasonEl,
    note ? h('p', { class: 'nav-note', role: 'status', text: note }) : '',
    h('div', { class: 'tm-top' }, rail),
    kicker, head, line, fig, actions, more, foot, live);

  function setStage(s, { focus = true, animate = true } = {}) {
    const prev = st.stage;
    st.stage = s;
    if (s === 3) revealedKeys.add(key(st.row));
    ctx.setParams({ month: st.row.month, stage: urlStage(s) });
    paint(animate ? prev : s);
    if (focus) head.focus({ preventScroll: false });
  }
  function load(row, s) {
    st.row = row; st.seen.add(row.month); st.guess = null;
    st.how = row === missRow ? rc.miss.how : cfg.featured ? 'next test month in time order (pre-locked opening month first)' : 'next test month in time order';
    setStage(s);
  }
  const nextRow = () => byMonth.get(nextTestRow(months, cfg.featured ? rc.preLocked : null, st.row, st.seen).month);

  function lane(cls, label, kids, value, isNew, sub) {
    return h('div', { class: `tm-lane ${cls}${isNew ? ' is-new' : ''}` },
      h('span', { class: 'tm-lab', text: label }),
      h('div', { class: 'tm-track' }, ...kids),
      h('div', { class: 'tm-num' }, h('b', { text: value }), sub ? h('small', { text: sub }) : ''));
  }

  function paint(from) {
    const t = st.row;
    const s = st.stage;
    const m = machineModel(t, { withActual: s === 3 });
    const c = machineCopy(m, s, tally, cfg, rc);
    const M = MONTH_LONG[m.mi];
    kicker.textContent = `${M} ${m.year} · hidden test month`; // the region's name is the page h1 (M4.5)
    head.textContent = c.head;
    line.textContent = c.line;
    rail.replaceChildren(...STAGES.map((x, i) => h('li', {}, h('button', { type: 'button', class: 'tm-step', 'aria-current': i + 1 === s ? 'step' : null,
      disabled: i + 1 > s && !(i + 1 === 3 && revealedKeys.has(key(t))) ? true : null, onclick: () => setStage(i + 1) }, h('span', { class: 'tm-step-n', text: String(i + 1) }), x))));
    // ---- the ruler: three lanes on one linear axis; marks appear by stage, never narrower than stored ----
    const p = (v) => `${m.pct(v).toFixed(2)}%`;
    const band = Number.isFinite(m.envLo) && Number.isFinite(m.envHi) ? h('span', { class: 'tm-usual', style: `left:${p(m.envLo)};width:${(m.pct(m.envHi) - m.pct(m.envLo)).toFixed(2)}%` }) : null;
    const ring = h('span', { class: `tm-dot ring${s > 1 ? ' ghost' : ''}`, style: `left:${p(m.raw)}` });
    const band1 = band ? band.cloneNode() : null;
    // N3: the label stays inside the band; a narrow band gets the short word (the full label is in the figure's aria-label and details)
    const bandPct = band ? m.pct(m.envHi) - m.pct(m.envLo) : 0;
    if (band1) band1.append(h('span', { class: 'tm-usual-l', text: bandPct >= 28 ? `Aqua’s usual ${M}, ${opts.base || ''}`.replace(/, $/, '') : 'usual' }));
    const l1 = lane('tm-raw', cfg.lane1, [band1 || '', ring], countText(m.raw), s === 1, zeroSub(m.raw));
    let l2;
    let dot = null; let range = null;
    if (s >= 2) {
      range = h('span', { class: 'tm-range', style: `left:${p(m.lo)};width:${(m.pct(m.hi) - m.pct(m.lo)).toFixed(2)}%` });
      dot = h('span', { class: 'tm-dot est', style: `left:${p(m.pred)}` });
      const arrow = m.ratioTxt ? h('span', { class: 'tm-div', style: `left:${p(Math.min(m.pred, m.raw))};width:${Math.abs(m.pct(m.raw) - m.pct(m.pred)).toFixed(2)}%` }, h('span', { text: `÷${m.ratioTxt} this month` })) : '';
      l2 = lane('tm-est', 'Converted estimate', [band ? band.cloneNode() : '', range, arrow, dot], countText(m.pred), s === 2, `90% range ${rangeN(m.lo)}–${rangeN(m.hi)}`);
    } else l2 = lane('tm-est pending', 'Converted estimate', [band ? band.cloneNode() : ''], '–', false);
    let aqua = null;
    const l3kids = [band ? band.cloneNode() : ''];
    if (s === 3) {
      aqua = h('span', { class: 'tm-dot aqua', style: `left:${p(m.actual)}` });
      const a = Math.min(m.pct(m.pred), m.pct(m.actual)); const w = Math.abs(m.pct(m.pred) - m.pct(m.actual));
      l3kids.push(h('span', { class: 'tm-gap', style: `left:${a.toFixed(2)}%;width:${w.toFixed(2)}%` }, h('span', { class: 'tm-gap-l', text: `${fmtN(m.apart)} apart` })), aqua);
    } else l3kids.push(h('span', { class: 'tm-hidden' }, h('span', { text: 'hidden' })));
    const l3 = lane('tm-aqua', 'Aqua measured', l3kids, s === 3 ? countText(m.actual) : '?', s === 3, s === 3 ? zeroSub(m.actual) : null);
    const ticks = m.axis.ticks.filter((x, i, a) => a.length <= 5 || i % 2 === 0 || i === a.length - 1);
    const axis = h('div', { class: 'tm-lane tm-axisrow', 'aria-hidden': 'true' }, h('span'), h('div', { class: 'tm-axis' }, ...ticks.map((x) => h('span', { class: 'tm-tick', style: `left:${p(x)}`, text: fmtN(x) }))), h('span'));
    fig.replaceChildren(h('div', { class: 'tm-lanes' }, l1, l2, l3, axis));
    const satWord = cfg.lane1.replace(/, raw$/, '');
    fig.setAttribute('aria-label', `${opts.name || rc.name}, ${M} ${m.year}. ${satWord} counted ${fmtN(m.raw)}.${s >= 2 ? ` Converted estimate ${fmtN(m.pred)}, 90% range ${rangeN(m.lo)} to ${rangeN(m.hi)}.` : ''} Aqua: ${s === 3 ? fmtN(m.actual) : 'hidden'}.${band ? ` Usual ${M}: ${fmtN(m.envLo)} to ${fmtN(m.envHi)}.` : ''}`);
    fig.setAttribute('role', 'img');

    // ---- one primary action per stage ----
    actions.replaceChildren();
    if (s === 1) actions.append(h('button', { type: 'button', class: 'btn btn-primary tm-go', onclick: () => setStage(2) }, 'Harmonize'));
    else if (s === 2) {
      actions.append(h('button', { type: 'button', class: 'btn btn-primary tm-go', onclick: () => { st.guess = null; setStage(3); } }, 'Reveal Aqua'),
        h('span', { class: 'tm-guess', role: 'group', 'aria-label': 'Optional: your call first' }, h('span', { class: 'tm-guess-l', text: 'Your call first:' }),
          ...['below', 'inside', 'above'].map((g) => h('button', { type: 'button', class: 'btn-link tm-guess-b', onclick: () => { st.guess = g; setStage(3); } }, g))));
    } else {
      const g = st.guess;
      if (g) actions.append(h('p', { class: `tm-you ${g === m.side ? 'ok' : 'no'}` }, h('span', { 'aria-hidden': 'true', text: g === m.side ? '✓ ' : '✗ ' }), `your call: ${g}`));
      const vc = cfg.verdictLine ? verdictCall(t) : null;
      if (vc) actions.append(h('p', { class: 'tm-vcall', text: vc }));
      actions.append(h('button', { type: 'button', class: 'btn btn-primary tm-go', onclick: () => load(nextRow(), 2) }, 'Try another test month'),
        missRow && missRow !== t ? h('button', { type: 'button', class: 'btn-link tm-sec', onclick: () => load(missRow, 2) }, 'See a miss') : '',
        opts.onEvidence ? h('button', { type: 'button', class: 'btn-link tm-sec tm-ev', onclick: () => opts.onEvidence() }, 'Explore the evidence') : '',
        opts.recordHref ? h('a', { class: 'btn-link tm-sec', href: opts.recordHref(t), 'data-nav': 'region', text: 'Monthly record →' }) : '');
    }

    // ---- detail on demand: one closed <details> per stage ----
    const d = (title, ...kids) => h('details', { class: 'more tm-d' }, h('summary', { text: title }), ...kids);
    if (s === 1) more.replaceChildren(d('Why the counts differ', h('p', { text: WHY_LINE }), band ? h('p', { text: `Grey band: the middle 80% of Aqua’s ${M} counts, ${opts.base || ''}.` }) : ''));
    else if (s === 2) more.replaceChildren(d('How the conversion works', ...(opts.stage2Detail || []).map((x, i) => h('p', i === (opts.stage2Detail.length - 1) ? { 'data-copy': 'not-a-replacement', text: x } : { text: x }))));
    else {
      const chosen = st.how === (rc.example && rc.example.how) ? `${cfg.rule.success} (${st.how}.)` : st.how === (rc.miss && rc.miss.how) ? `${cfg.rule.miss} (${st.how}.)` : `${st.how}.`;
      more.replaceChildren(d('How it was chosen and checked',
        h('p', {}, h('b', { text: 'Chosen: ' }), chosen),
        h('ul', { class: 'tr-out' },
          h('li', {}, h('b', { text: 'Range check ' }), `Aqua ${fmtN(t.actual)}; 90% range ${fmtN(t.lo, 1)}–${fmtN(t.hi, 1)}.`),
          h('li', {}, h('b', { text: 'Size of error ' }), errorPlain(errorRatio(t.est, t.actual))),
          // the stored point verdicts exist for the NOAA-20 test only; nothing is computed for S-NPP
          cfg.verdictLine && t.verdictPred ? h('li', {}, h('b', { text: 'Unusual or not ' }), `Prediction said ${usualWord(t.verdictPred, m.mi, opts.base || '')}; Aqua was ${usualWord(t.verdictTruth, m.mi, opts.base || '')}: ${t.verdictMatch === null ? 'no converted verdict to check' : t.verdictMatch ? 'verdict matched' : 'verdict didn’t match'}.`) : ''),
        cfg.verdictLine && t.rangeCrossesEdge && opts.edgeNote ? h('p', { class: 'caption tr-edge', text: opts.edgeNote }) : '',
        h('p', { class: 'caption', text: cfg.verdictLine ? 'Range check, size of error and verdict are separate measures.' : 'Range check and size of error are separate measures.' })));
    }
    foot.hidden = s === 1 || !fv.visible.length; // limits sit near every converted value (stages 2-3), muted
    live.textContent = `Step ${s} of 3: ${STAGES[s - 1]}`; // the headline is read when it takes focus (no double announcement)

    // ---- purposeful motion (none under reduced motion; final state identical) ----
    if (prefersReducedMotion() || from === s) return;
    if (s === 2 && dot && dot.animate) {
      const track = dot.parentElement; const w = track.getBoundingClientRect().width;
      const dx = ((m.pct(m.raw) - m.pct(m.pred)) / 100) * w;
      dot.animate([{ transform: `translate(calc(-50% + ${dx.toFixed(1)}px), -50%)` }, { transform: 'translate(-50%, -50%)' }], { duration: 600, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'backwards' });
      // the range appears at its full stored width (opacity only), never grown from narrower
      range.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: 600, fill: 'backwards' });
    }
    if (s === 3 && aqua && aqua.animate) {
      const mo = revealMotion(false);
      aqua.animate(mo.keyframes, { duration: mo.duration, delay: 150, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'backwards' });
      const gap = fig.querySelector('.tm-gap'); if (gap) gap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 150 + mo.duration, fill: 'backwards' });
    }
  }

  // Esc opens the in-page evidence (unless a disclosure or control has focus); Back leaves because stages replace history (R7)
  const ac = new AbortController();
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !root.isConnected || ev.target.closest('details[open], select, input, .glossary')) return;
    if (!opts.onEvidence) return;
    ev.preventDefault(); opts.onEvidence();
  }, { signal: ac.signal });
  root.__teardown = () => ac.abort();
  // a stage-3 deep link is never honoured: the reveal needs a click (R6); stage 2 shows the conversion, Aqua hidden
  paint(st.stage);
  root.__afterMount = () => { ctx.setParams({ month: st.row.month, stage: urlStage(st.stage), rev: null }); }; // focus moves to the headline only on a stage change
  return root;
}
