// M3 "Across decades": the region panel (pick a test month -> converted verdict -> reveal Aqua) and, since M4.2, the Trust
// page parts (headline metrics, Predict -> Reveal demo, the every-month explorer, the Scientific details pieces).
// Numbers and years come from m2_validation.json and the series; wording from m2.js (M2-AUDIT §9).
// The ruler reuses twosat's fixed log axis (logPos, the separate 0 stub) and its ts-* marks.
import { MONTH_ABBR, MONTH_LETTER, monthIndex, monthLabel, yearOf, NATIVE_STATUS_WORD } from './core.js';
import { loadDoc } from './data.js';
import { h, glyph, fmtN, prefersReducedMotion } from './ui.js';
import { intervalFirst } from './viz.js';
import { estimateSource } from './story.js';
import { logPos, ZERO_STUB } from './twosat.js';
import { REGION_CASE_RULE } from './trustctx.js';
import {
  KIND, kindLabel, VERDICT_M2, CLASSES, caseOf, matched, errorRatio, gridModel, gridMove, keyAction, revealMotion, regionDomain,
  unvalidatedMonths, unvalidatedModel, regionRows, regionSummary, approvedWording, regionCoverageLine, seasonDefinition, FEATURED_LABEL, gridTally, confusionTallies, MONTH_LONG,
  headlineMetrics, EXPLORE_FILTERS, exploreFilter, filterRows, filterCounts,
} from './m2.js';

const LANE = 'aqua_equiv_n20_ratio';
export const revealedKeys = new Set(); // per session (shared with the Time Machine, machine.js); (JOURNEY §2: no need to persist)
let activeKeys = null; // the one document-level R handler

export async function loadM2Validation(manifest) {
  return loadDoc(manifest.m2_validation_path || 'm2_validation.json', 'm2_validation');
}

/** One line for M1 regions: the NOAA-20 comparison is unsupported there (not independently validated). */
export function m1NoaaLine(nM2) {
  return h('p', { class: 'dc-m1 caption', 'data-case': 'unsupported' }, h('span', { class: 'case-badge case-unsupported', text: 'Unsupported' }),
    ` NOAA-20 conversion not independently validated in this region${nM2 ? ` (the method was validated in ${nM2} other study areas)` : ''}.`);
}

// ---------------------------------------------------------------- region panel

export async function decadesPanel({ ctx, manifest, region, series, env }) {
  let val;
  try { val = await loadM2Validation(manifest); } catch (e) {
    return { el: h('section', { class: 'decades' }, h('p', { class: 'caption', text: 'The tested comparison could not be loaded; nothing is shown in its place.' })) };
  }
  const rows = regionRows(val, region.id);
  const reg = regionSummary(val, region.id);
  if (!rows.length || !reg) return { el: h('section', { class: 'decades', hidden: true }) };
  const win = { start: val.window.start, end: val.window.end };
  const base = val.envelope && val.envelope.period ? `${val.envelope.period.start_year}–${val.envelope.period.end_year}` : '';
  win.usualLabel = `Aqua ${base} usual range (middle 80%)`;
  const { A } = approvedWording(val);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const unval = unvalidatedMonths(series, LANE);
  const unvalBy = new Map(unval.map((m) => [m.month, m]));
  const domain = regionDomain(rows, series.months, LANE);
  const grid = gridModel(val, region.id);
  const afterYears = [...new Set(series.months.filter((m) => m.month > win.end && m.modelled && m.modelled[LANE]).map((m) => yearOf(m.month)))].sort((a, b) => a - b);
  const allRows = [...grid.map((g) => ({ ...g, part: 'test' })), ...afterYears.map((y) => ({
    year: y, part: 'after',
    cells: MONTH_ABBR.map((_, i) => { const month = `${y}-${String(i + 1).padStart(2, '0')}`; const m = unvalBy.get(month); return { month, um: m || null, state: m ? 'unvalidated' : series.months.some((x) => x.month === month) ? 'none' : 'outside' }; }),
  }))];
  const name = region.name.replace(/\s*\(.*\)$/, '');

  const tmAfter = !!(ctx.params.tm && unvalBy.has(ctx.params.tm));
  const state = { afterOpen: tmAfter, sel: null, all: rows.every((r) => revealedKeys.has(`${region.id}|${r.month}`)) };
  const key = (m) => `${region.id}|${m}`;
  const isRev = (m) => state.all || revealedKeys.has(key(m));

  // ----- grid
  const maxP50 = Math.max(1, ...env.map((e) => e.p50 || 0));
  const season = h('div', { class: 'dc-season', 'aria-hidden': 'true' }, h('span', { class: 'dc-ylab' }),
    ...env.map((e) => h('span', { class: 'dc-p50' }, h('i', { style: `height:${e.p50 ? Math.max(4, (e.p50 / maxP50) * 100).toFixed(1) : 0}%` }))));
  const gridEl = h('div', { class: 'dc-grid', role: 'grid', 'aria-label': `Test months for ${name}: one row per year, one column per month. Arrow keys move, Enter picks a month, R reveals Aqua.` });
  gridEl.append(h('div', { class: 'dc-row dc-head', role: 'row' }, h('span', { class: 'dc-ylab', role: 'columnheader', 'aria-label': 'Year' }),
    ...MONTH_LETTER.map((l, i) => h('span', { class: 'dc-mh', role: 'columnheader', 'aria-label': MONTH_LONG[i], text: l }))));
  const cellEls = []; // [rowIndex][col]
  // after the window: collapsed to one toggle by default (strategist #2); the rows only join the grid when opened
  const afterRowEls = [];
  const afterBtn = h('button', { type: 'button', class: 'dc-after-toggle', 'aria-expanded': 'false' });
  const paintAfter = () => {
    afterBtn.setAttribute('aria-expanded', state.afterOpen ? 'true' : 'false');
    afterBtn.replaceChildren(h('span', { class: 'dc-ring', 'aria-hidden': 'true' }), h('b', { text: `${afterYears[0]}–${afterYears[afterYears.length - 1]}: converted, not tested` }),
      h('span', { text: ' · drifted Aqua is not a check ' }), h('span', { 'aria-hidden': 'true', text: state.afterOpen ? '▾' : '▸' }));
    afterRowEls.forEach((r) => { r.hidden = !state.afterOpen; });
  };
  afterBtn.addEventListener('click', () => { state.afterOpen = !state.afterOpen; paintAfter(); });
  allRows.forEach((yr, ri) => {
    if (yr.part === 'after' && allRows[ri - 1].part !== 'after') gridEl.append(h('div', { class: 'dc-after-row', role: 'row' }, h('div', { role: 'gridcell', class: 'dc-after-cell' }, afterBtn)));
    const rowCells = yr.cells.map((c, ci) => {
      const el = h('div', { class: `dc-cell st-${c.state}`, role: 'gridcell', tabindex: '-1', 'data-month': c.month, 'data-state': c.state });
      el.__c = c; el.__pos = [ri, ci];
      cellEls.push(el);
      return el;
    });
    const rowEl = h('div', { class: `dc-row${yr.part === 'after' ? ' after' : ''}`, role: 'row' }, h('span', { class: 'dc-ylab', role: 'rowheader', text: String(yr.year) }), ...rowCells);
    if (yr.part === 'after') afterRowEls.push(rowEl);
    gridEl.append(rowEl);
  });
  const navRows = () => (state.afterOpen ? allRows.length : grid.length);
  const cellAt = ([r, c]) => cellEls.find((e) => e.__pos[0] === r && e.__pos[1] === c);

  function paintCell(el) {
    const c = el.__c; el.replaceChildren();
    el.classList.toggle('rev', false); el.classList.remove('hit', 'miss', 'nov');
    let label = `${MONTH_LONG[monthIndex(c.month)]} ${yearOf(c.month)}: `;
    if (c.state === 'test') {
      const r = c.row; const v = VERDICT_M2[r.q4_n20];
      el.append(glyph(v.glyph));
      label += `converted verdict ${v.word}`;
      if (r.range_crosses_edge) label += ', range crosses the edge';
      if (isRev(c.month)) {
        const m = matched(r);
        el.classList.add('rev', m === null ? 'nov' : m ? 'hit' : 'miss');
        el.append(h('span', { class: 'dc-mark', 'aria-hidden': 'true', text: m === null ? '?' : m ? '✓' : '✗' }));
        label += `; Aqua ${VERDICT_M2[r.q4_truth].word}; ${m === null ? 'no verdict to check' : m ? 'verdict matched' : 'verdict didn’t match'}`;
      } else label += '; Aqua hidden';
      if (c.month === reg.featured_month) { el.classList.add('featured'); label += '; opening month (fixed rule)'; }
    } else if (c.state === 'untested') label += 'not tested (Aqua not usable this month; not zero)';
    else if (c.state === 'before') label += 'before the test window';
    else if (c.state === 'unvalidated') { el.append(h('span', { class: 'dc-ring', 'aria-hidden': 'true' })); label += 'converted, not tested (unsupported)'; }
    else if (c.state === 'none') label += 'no converted value (not zero)';
    else label += 'outside the record';
    el.setAttribute('aria-label', label);
    const on = state.sel === c.month;
    el.classList.toggle('sel', on); el.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  const selectable = (c) => c.state === 'test' || c.state === 'unvalidated';

  // ----- ruler
  const fig = h('figure', { class: 'twosat dc-ruler' });
  const readout = h('div', { class: 'dc-readout', 'aria-live': 'polite' });
  const revealBtn = h('button', { type: 'button', class: 'btn btn-primary dc-reveal', 'aria-keyshortcuts': 'R' });
  const head = h('div', { class: 'dc-when' });

  function lane(cls, who, sub, keyCls, kids, valTxt, kind) {
    return h('div', { class: `ts-row ${cls}`, 'data-kind': kind || '' },
      h('div', { class: 'ts-who' }, h('span', { class: `ts-key ${keyCls}`, 'aria-hidden': 'true' }), h('span', {}, who, sub ? h('small', { text: sub }) : '')),
      h('div', { class: 'ts-track' }, h('span', { class: 'ts-zero', 'aria-hidden': 'true' }), ...kids),
      h('div', { class: 'ts-val', text: valTxt }));
  }
  const pos = (v) => logPos(v, domain);
  const pct = (v) => `${pos(v).toFixed(2)}%`;
  const band = (p10, p90) => (p10 != null && p90 != null ? h('span', { class: 'ts-usual', style: `left:${pct(p10)};width:${(pos(p90) - pos(p10)).toFixed(2)}%`, 'aria-hidden': 'true' }) : null);
  const tickLabel = (v) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}k` : String(v));

  function paintRuler(animate = false) {
    const m = state.sel;
    const r = byMonth.get(m);
    const um = !r && unvalBy.get(m) ? unvalidatedModel(unvalBy.get(m), env, LANE) : null;
    const x = r || um;
    const tested = !!r;
    const kase = tested ? caseOf(r) : caseOf(null, 'unvalidated');
    const open = tested && isRev(m);
    const e = { p10: x.env_p10, p90: x.env_p90 };
    head.replaceChildren(h('h3', { class: 'dc-month', id: 'dc-month-h', tabindex: '-1', text: `${MONTH_LONG[monthIndex(m)]} ${yearOf(m)}` }),
      h('span', { class: `case-badge case-${kase.id}`, 'data-case': kase.id, title: kase.reason, text: kase.badge }),
      m === reg.featured_month ? h('span', { class: 'dc-feat-tag', text: 'opening month · fixed rule' }) : '');
    // lane 1: raw NOAA-20 on its own scale (no band: it is not on Aqua's scale)
    const raw = x.noaa20_raw;
    const l1 = lane('ts-viirs', KIND.raw_viirs.label, 'own scale · never compared with the band', 'ring',
      [raw != null ? h('span', { class: 'ts-dot ring', style: `left:${pct(raw)}` }) : null], raw == null ? '—' : fmtN(raw), 'raw_viirs');
    const ratio = raw > 0 && x.pred > 0 ? raw / x.pred : null;
    const conv = ratio ? h('div', { class: 'ts-row ts-convert' }, h('div', { class: 'ts-who ts-ratio' }, h('span', { class: 'ts-div', text: `÷ ${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}` })),
      h('div', { class: 'ts-track' }, h('span', { class: `ts-arrow${pos(x.pred) < pos(raw) ? ' leftward' : ''}`, style: `left:${pct(Math.min(raw, x.pred))};width:${Math.abs(pos(raw) - pos(x.pred)).toFixed(2)}%`, 'aria-hidden': 'true' })),
      h('div', { class: 'ts-val' })) : null;
    const kind = tested ? 'converted_validated' : 'converted_unvalidated';
    const span = `${yearOf(win.start)}–${yearOf(win.end)}`;
    const carried = tested ? '' : ` · range carried over from ${span}; not tested after`;
    const l2 = lane(`ts-est${tested ? '' : ' unval'}`, kindLabel(kind, win), x.lo90 != null ? `90% range ${fmtN(x.lo90, 1)}–${fmtN(x.hi90, 1)}${carried}` : 'no range', `est${tested ? '' : ' hollow'}`,
      [band(e.p10, e.p90), x.lo90 != null ? h('span', { class: `ts-range${tested ? '' : ' dashed'}`, style: `left:${pct(x.lo90)};width:${(pos(x.hi90) - pos(x.lo90)).toFixed(2)}%` }) : null,
        h('span', { class: `ts-dot est${tested ? '' : ' hollow'}`, style: `left:${pct(x.pred)}` })], fmtN(x.pred, 1), kind);
    // lane 3: Aqua's usual band and, after reveal, the measured dot
    const aquaObs = tested ? Number.isFinite(r.actual) : x.actual != null;
    const aquaKids = [band(e.p10, e.p90)];
    let aquaVal = '?';
    if (tested && !open) aquaKids.push(h('span', { class: 'ts-hidden dc-hidden', text: 'hidden until you reveal it' }));
    else if (aquaObs) {
      const dot = h('span', { class: `ts-dot aqua${tested ? '' : ' drift'}`, style: `left:${pct(x.actual)}` });
      aquaKids.push(dot); aquaVal = x.actual === 0 ? 'none reported' : fmtN(x.actual);
      const mo = animate ? revealMotion(prefersReducedMotion()) : null;
      // interval first: the converted range re-draws, then the measured value lands (both instant under reduced motion)
      if (mo && dot.animate) requestAnimationFrame(() => { const lag = intervalFirst(fig.querySelectorAll('.ts-est .ts-range, .ts-aqua .ts-usual')); dot.animate(mo.keyframes, { duration: mo.duration, delay: lag, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'backwards' }); });
    } else { aquaKids.push(h('span', { class: 'ts-gap', text: `${KIND.unavailable.label}: ${NATIVE_STATUS_WORD[x.aquaStatus] || 'not observed'}` })); aquaVal = '—'; }
    const l3 = lane(`ts-aqua${tested ? '' : ' drift'}`, KIND.observed.label, tested ? (open ? 'the record; was hidden' : 'the record; hidden') : aquaObs ? 'orbit drifted: not a check' : 'no usable value', `aqua${tested ? '' : ' drift'}`, aquaKids, aquaVal, aquaObs && (!tested || open) ? 'observed' : tested ? '' : 'unavailable');
    const ticks = []; for (let v = domain[0]; v <= domain[1] * 1.0001; v *= 10) ticks.push(v);
    const axis = h('div', { class: 'ts-axisrow', 'aria-hidden': 'true' }, h('div'), h('div', { class: 'ts-axis' },
      h('span', { class: 'ts-tick zero', style: `left:${(ZERO_STUB / 2).toFixed(2)}%`, text: '0' }), ...ticks.map((v) => h('span', { class: 'ts-tick', style: `left:${pct(v)}`, text: tickLabel(v) }))), h('div'));
    fig.replaceChildren(
      h('div', { class: 'ts-rows' }, l1, conv, l2, l3, axis),
      h('p', { class: 'ts-key-line caption' }, h('span', { class: 'ts-legend-usual' }, h('span', { class: 'sw', 'aria-hidden': 'true' }), `${win.usualLabel} for ${MONTH_LONG[monthIndex(m)]}: ${fmtN(e.p10, 1)}–${fmtN(e.p90, 1)}`), ' · log scale; 0 sits apart'),
      h('p', { class: 'ts-key-line caption dc-kinds', 'data-kinds': '1' }, '● Aqua measured · ○ NOAA-20 own scale · orange dot + bar = converted, tested · dashed = converted, not tested · grey dot, dashed edge = drifted Aqua (not a check) · hatched = no usable data (not zero)'));
    fig.setAttribute('aria-label', `${monthLabel(m)}. NOAA-20 counted ${raw == null ? 'nothing usable' : fmtN(raw)} on its own scale. ${kindLabel(kind, win)}: ${fmtN(x.pred, 1)}, 90% range ${fmtN(x.lo90, 1)} to ${fmtN(x.hi90, 1)}${tested ? '' : `, range carried over from ${span}; not tested after`}. ${win.usualLabel}: ${fmtN(e.p10, 1)} to ${fmtN(e.p90, 1)}. Aqua: ${tested && !open ? 'hidden' : aquaObs ? fmtN(x.actual) : 'no usable data, not zero'}.`);

    // readout: verdict before, outcome after
    readout.replaceChildren();
    readout.append(h('p', { class: 'dc-source caption', 'data-rule': 'satellite-selection', text: estimateSource(region, { inWindow: tested }).text }));
    if (tested) {
      const v = VERDICT_M2[r.q4_n20];
      const rw = VERDICT_M2[r.q4_naive] || VERDICT_M2.cant_tell;
      const rawOk = open && r.q4_naive !== 'cant_tell' ? r.q4_naive === r.q4_truth : null;
      readout.append(h('p', { class: 'dc-line' }, h('b', { text: 'Converted: ' }), h('span', { class: 'dc-verdict' }, glyph(v.glyph), v.word),
        r.range_crosses_edge ? h('span', { class: 'dc-tag', text: 'range crosses the band edge' }) : ''),
        kase.id === 'uncertain' ? h('p', { class: 'dc-case-note caption', 'data-case-note': 'uncertain', text: r.q4_n20 === 'cant_tell' ? 'Uncertain: too few NOAA-20 detections for a verdict.' : 'Uncertain: the range crosses a band edge, so the verdict could go either way, even if it turns out to match. Set before you reveal.' }) : '',
        h('p', { class: 'dc-line dc-raw', 'data-raw': r.q4_naive }, h('b', { text: 'Not on Aqua’s scale (unsupported) — raw count would say: ' }), h('span', { class: 'dc-verdict' }, glyph(rw.glyph), rw.short),
          rawOk === null ? '' : h('span', { class: rawOk ? 'ok' : 'bad' }, h('span', { 'aria-hidden': 'true', text: rawOk ? ' ✓ ' : ' ✗ ' }), rawOk ? 'matched Aqua' : 'didn’t match Aqua')));
      if (open) {
        const t = VERDICT_M2[r.q4_truth]; const mt = matched(r); const er = errorRatio(r.pred, r.actual);
        readout.append(h('p', { class: 'dc-line' }, h('b', { text: 'Aqua: ' }), h('span', { class: 'dc-verdict' }, glyph(t.glyph), t.word)),
          h('ul', { class: 'dc-out' },
            h('li', { class: r.inside90 ? 'ok' : 'bad' }, h('span', { 'aria-hidden': 'true', text: r.inside90 ? '✓ ' : '✗ ' }), r.inside90 ? 'inside the 90% range' : 'outside the 90% range'),
            h('li', {}, er ? er.text : '—', er ? h('small', { class: 'dc-note', text: ` (${er.note})` }) : ''),
            h('li', { class: mt === null ? '' : mt ? 'ok' : 'bad' }, h('span', { 'aria-hidden': 'true', text: mt === null ? '? ' : mt ? '✓ ' : '✗ ' }), mt === null ? 'no converted verdict to check' : mt ? 'verdict matched' : 'verdict didn’t match')));
      }
      revealBtn.hidden = false;
      revealBtn.disabled = open;
      revealBtn.textContent = open ? 'Aqua revealed' : 'Reveal what Aqua measured (R)';
    } else {
      readout.append(h('p', { class: 'dc-line' }, h('b', { text: 'No verdict: ' }), 'converted values after the test window are not tested.'),
        h('p', { class: 'dc-case-note caption', 'data-tier': 'assumption', text: `Assumption-only: assumes the ${span} NOAA-20→Aqua relation still holds; Aqua’s drift means this can’t be checked.` }),
        x.actual != null ? h('p', { class: 'dc-case-note caption', 'data-caveat': 'drift', text: 'Aqua’s orbit was drifting, so a gap between these two dots mixes drift and conversion error; it is not a test.' }) : '');
      revealBtn.hidden = true;
    }
  }

  // ----- controls
  const allBtn = h('button', { type: 'button', class: 'btn btn-quiet dc-all' });
  const tally = h('p', { class: 'dc-tally', 'aria-live': 'polite' });
  function paintAll() {
    cellEls.forEach(paintCell);
    allBtn.textContent = state.all ? `All ${rows.length} revealed` : `Reveal all ${rows.length}`;
    allBtn.disabled = state.all;
    tally.replaceChildren();
    if (state.all) {
      const t = gridTally(rows);
      tally.append(h('span', { text: regionCoverageLine(reg, t) }));
    }
  }
  function select(month, { focus = false, push = true } = {}) {
    state.sel = month;
    cellEls.forEach((el) => { const on = el.__c.month === month; el.tabIndex = on ? 0 : -1; if (on && focus) el.focus(); });
    paintAll(); paintRuler(false);
    if (push) ctx.setParams({ tm: month, rev: isRev(month) && byMonth.has(month) ? '1' : null });
  }
  function reveal() {
    const m = state.sel; if (!byMonth.has(m) || isRev(m)) return;
    revealedKeys.add(key(m)); paintAll(); paintRuler(true); ctx.setParams({ rev: '1' });
  }
  revealBtn.addEventListener('click', reveal);
  allBtn.addEventListener('click', () => { rows.forEach((r) => revealedKeys.add(key(r.month))); state.all = true; paintAll(); paintRuler(true); ctx.setParams({ rev: '1' }); });

  gridEl.addEventListener('keydown', (ev) => {
    const el = ev.target.closest('.dc-cell'); if (!el) return;
    const act = keyAction(ev.key);
    if (act === 'select') { ev.preventDefault(); if (selectable(el.__c)) select(el.__c.month, { focus: true }); return; }
    if (act === 'reveal') { ev.preventDefault(); reveal(); return; }
    const to = gridMove(navRows(), el.__pos, ev.key);
    if (!to) return;
    ev.preventDefault();
    const t = cellAt(to); if (!t) return;
    cellEls.forEach((c) => { c.tabIndex = c === t ? 0 : -1; }); t.focus();
    if (selectable(t.__c)) select(t.__c.month, { focus: false });
  });
  gridEl.addEventListener('click', (ev) => { const el = ev.target.closest('.dc-cell'); if (el && selectable(el.__c)) select(el.__c.month, { focus: true }); });
  // R reveals from anywhere on the page (not while typing; the grid handles its own keys)
  const panelKeys = (ev) => {
    if (!el.isConnected) { document.removeEventListener('keydown', panelKeys); return; }
    if (keyAction(ev.key) !== 'reveal' || ev.metaKey || ev.ctrlKey || ev.altKey || ev.defaultPrevented) return;
    if (ev.target.closest && ev.target.closest('input, select, textarea, [contenteditable], .dc-grid')) return;
    ev.preventDefault(); reveal();
  };

  const legend = h('ul', { class: 'dc-legend', 'aria-label': 'Grid symbols' },
    ...['above', 'within', 'below', 'cant_tell'].map((k) => h('li', {}, glyph(VERDICT_M2[k].glyph), VERDICT_M2[k].short)),
    h('li', {}, h('span', { class: 'sw-hatch', 'aria-hidden': 'true' }), 'not tested'),
    h('li', {}, h('b', { 'aria-hidden': 'true', text: '✓' }), 'matched'), h('li', {}, h('b', { 'aria-hidden': 'true', text: '✗' }), 'didn’t match'));
  const rule = h('details', { class: 'dc-rule caption' }, h('summary', { text: FEATURED_LABEL(rows.length) }),
    h('p', { class: 'mono', text: (val.provenance && val.provenance.featured_month_rule) || '' }),
    h('p', { class: 'mono', text: `lock ${val.provenance.lock_id} · index ${reg.featured_index} of ${rows.length} → ${monthLabel(reg.featured_month)}` }));

  const el = h('section', { class: 'decades', id: 'decades', 'aria-labelledby': 'dc-h' },
    h('div', { class: 'dc-top' },
      h('h2', { class: 'section-title', id: 'dc-h', text: `Across decades: was a NOAA-20 month unusual for the ${base} Aqua years?` }),
      h('p', { class: 'dc-purpose', text: `NOAA-20 is a newer satellite whose VIIRS sensor counts several times more hot spots than Aqua MODIS, the 2000s record. Its raw counts can’t be set against the 2000s; converted ones were tested here, ${yearOf(win.start)}–${yearOf(win.end)}.` })),
    h('div', { class: 'dc-body' },
      h('div', { class: 'dc-pick' }, h('p', { class: 'dc-hint', text: 'Pick a test month. ▲●▼ is the converted verdict; Aqua stays hidden.' }), season, gridEl, legend, rule,
        h('div', { class: 'dc-actions' }, allBtn, h('a', { class: 'btn btn-quiet', href: '?view=trust#decades', 'data-nav': 'trust', text: `All ${val.month_rows.length} test months →` })), tally),
      h('div', { class: 'dc-side' }, head, fig, readout, h('div', { class: 'pr-actions' }, revealBtn),
        h('p', { class: 'dc-a12 caption', 'data-claim': 'A12', text: A.A12 }))));
  if (activeKeys) document.removeEventListener('keydown', activeKeys);
  activeKeys = panelKeys;
  document.addEventListener('keydown', panelKeys);
  // teardown for the host view (region.js calls el.__teardown when present): releases the document-level R handler
  el.__teardown = () => { document.removeEventListener('keydown', panelKeys); if (activeKeys === panelKeys) activeKeys = null; };

  // first month: ?tm= when it is a test or unvalidated month, else the exported featured month (the rule; never chosen here)
  const tm = ctx.params.tm;
  const first = tm && (byMonth.has(tm) || unvalBy.has(tm)) ? tm : reg.featured_month;
  if (ctx.params.rev && byMonth.has(first)) revealedKeys.add(key(first));
  state.sel = first;
  cellEls.forEach((c) => { c.tabIndex = c.__c.month === first ? 0 : -1; });
  if (afterYears.length) paintAfter();
  paintAll(); paintRuler(false);
  return { el, teardown: el.__teardown };
}

// ---------------------------------------------------------------- Trust page (M4.2)
// The NOAA-20 test (every held-out month) split by depth: headline metrics, the Predict -> Reveal demo, the
// "Explore all test months" grid + table, and the Scientific details parts (statistics, matrices, method, robustness).
// Every number comes from m2_validation.json; the wording is M2-AUDIT §9 via approvedWording (verbatim in the details).

const DESCRIPTIVE = new Set(['A4']); // not pre-registered: computed in the M3 audit (strategist d)
const descTag = () => h('span', { class: 'claim-label desc-tag', text: ' descriptive, from the M3 audit' });

function confTable(conf, { id, armLabel, caption }) {
  const t = confusionTallies(conf);
  const idx = (k) => conf.classes.indexOf(k);
  const head = h('tr', {}, h('th', { scope: 'col', text: 'Aqua measured ↓ · verdict →' }), ...CLASSES.map((k) => h('th', { scope: 'col', text: VERDICT_M2[k].short })));
  const body = ['below', 'within', 'above'].map((tr) => h('tr', {}, h('th', { scope: 'row', text: VERDICT_M2[tr].short }),
    ...CLASSES.map((a) => {
      const n = conf.counts[idx(tr)][idx(a)];
      const kind = a === 'cant_tell' ? 'abst' : tr === a ? 'diag' : a === 'within' ? 'miss' : tr === 'within' ? 'flag' : 'opp';
      const word = { diag: 'matched', miss: 'missed', flag: 'false flag', opp: 'opposite', abst: 'no verdict' }[kind];
      return h('td', { class: `cm-${kind}${n === 0 ? ' zero' : ''}`, 'data-n': String(n) }, h('b', { text: String(n) }), n && kind !== 'diag' ? h('small', { text: word }) : '');
    })));
  return h('figure', { class: 'cm', id }, h('figcaption', {}, h('b', { text: armLabel }), ` ${t.agree} of ${t.decided} matched`),
    h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)), caption ? h('p', { class: 'caption', text: caption }) : '');
}

export const nameOfM2 = (manifest) => {
  const regions = new Map((manifest.m2_regions || []).map((r) => [r.id, r]));
  return (id) => ((regions.get(id) || {}).name || id).replace(/\s*\(.*\)$/, '');
};
const sideOf = (r) => (r.actual < r.lo90 ? 'below' : r.actual > r.hi90 ? 'above' : 'inside');
export const GUESS = { below: 'below the range', inside: 'inside the range', above: 'above the range' };
const tickLabel = (v) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}k` : String(v));

/** Whole-decade log domain over one month's values (raw, converted, range, Aqua, usual band); zero sits in the stub. */
function monthDomain(r) {
  const v = [r.noaa20_raw, r.pred, r.lo90, r.hi90, r.actual, r.env_p10, r.env_p90].filter((x) => x > 0);
  if (!v.length) return [1, 10];
  const lo = 10 ** Math.floor(Math.log10(Math.min(...v)));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...v)) + 1e-9);
  return [lo, Math.max(hi, lo * 10)];
}

/** Load the NOAA-20 test file once for the Trust page; null when it cannot be read (the page then leads with the S-NPP test). */
export async function m2TrustData(manifest) {
  try { return await loadM2Validation(manifest); } catch (e) { console.warn(e); return null; }
}

/** The three headline measures as tiles: number, denominator, one plain line. The verbatim sentences sit in the details. */
export function trustMetricTiles(val) {
  const tiles = headlineMetrics(val).map((m) => h('li', { class: `tr-metric tr-m-${m.id}`, 'data-claim': m.claim },
    h('span', { class: 'tr-m-kind', text: m.kind }),
    h('span', { class: 'tr-m-big' }, h('b', { text: m.big }), h('span', { text: ` ${m.of}` })),
    m.k != null ? meter(m.k, m.n) : h('span', { class: 'tr-meter tr-meter-empty', 'aria-hidden': 'true' }),
    h('span', { class: 'tr-m-plain', text: m.plain }),
    h('span', { class: 'tr-m-note', text: m.note }),
    m.caveat ? h('span', { class: 'tr-m-caveat', text: m.caveat }) : ''));
  return h('div', { class: 'tr-metrics-wrap' },
    h('p', { class: 'tr-metrics-h', id: 'trm-h', text: `Across all ${val.month_rows.length} test months, three separate checks` }),
    h('ul', { class: 'tr-metrics', 'aria-labelledby': 'trm-h' }, ...tiles));
}
function meter(k, n) {
  return h('span', { class: 'tr-meter', 'aria-hidden': 'true' }, h('i', { style: `width:${((k / n) * 100).toFixed(2)}%` }));
}

/** Error in plain words (QA H6): "Prediction was 1.3× too low". The ratio is on count + 1; that is said in the disclosure. */
export function errorPlain(er) {
  if (!er) return '—';
  if (er.factor < 1.05) return 'Prediction was within 5% of Aqua’s count.';
  return `Prediction was ${er.factor.toFixed(er.factor >= 10 ? 0 : 1)}× too ${er.ratio > 1 ? 'high' : 'low'}.`;
}
/** Point verdict in plain words with its month and baseline years from data (QA H6). */
export function usualWord(cls, mi, base) {
  const m = MONTH_LONG[mi];
  return { above: `above usual for ${m} (${base})`, within: `usual for ${m} (${base})`, below: `below usual for ${m} (${base})`, cant_tell: 'can’t tell (too few detections)' }[cls] || 'no verdict';
}
export const REQUIRED_COPY_M2 = 'We predict withheld MODIS months to test the conversion, not because real MODIS measurements should be replaced.';

// M4.5: trustDemo (the old two-tab Predict -> Reveal) is retired; every study region's Trust page is its Time Machine (machine.js).

/**
 * Every test month in one filterable grid (one block per study area, one row per year), with a table alternative.
 * Marks keep their original meanings: ✓ verdict matched · ✗ didn’t match · ? can’t tell · underline = outside the 90%
 * range · hatched = not tested. Cells outside the filter are dimmed, never removed.
 */
export function trustExplorer(val, manifest, { onTry, region = null, scoped = false } = {}) {
  const nm = nameOfM2(manifest);
  const total = val.month_rows.length;
  const state = { region: region && val.regions.some((g) => g.region_id === region) ? region : 'all', filter: 'all', view: 'grid', sel: null };
  const note = h('p', { class: 'tr-x-note caption' });
  const status = h('p', { class: 'tr-x-status', role: 'status', 'aria-live': 'polite' });
  const regionSel = h('select', { id: 'trx-region', onchange: (e) => { state.region = e.target.value; paint(); } },
    h('option', { value: 'all', text: `All ${val.regions.length} study areas` }), ...val.regions.map((g) => h('option', { value: g.region_id, text: nm(g.region_id), selected: g.region_id === state.region || null })));
  const filterBox = h('div', { class: 'tr-x-filters' });
  const radios = EXPLORE_FILTERS.map((f) => {
    const input = h('input', { type: 'radio', name: 'trx-filter', id: `trx-f-${f.id}`, value: f.id, checked: f.id === state.filter || null, onchange: () => { state.filter = f.id; paint(); } });
    const count = h('span', { class: 'tr-x-n' });
    filterBox.append(h('label', { class: `tr-x-chip f-${f.id}`, for: `trx-f-${f.id}` }, input, h('span', { text: f.label }), count));
    return { f, input, count };
  });
  const viewBtns = ['grid', 'table'].map((v) => h('button', { type: 'button', class: 'tr-x-view', 'aria-pressed': v === state.view ? 'true' : 'false', onclick: () => { state.view = v; paint(); } }, v === 'grid' ? 'Grid' : 'Table'));
  const body = h('div', { class: 'tr-x-body' });
  const detail = h('div', { class: 'tr-x-detail', 'aria-live': 'polite' });
  const legend = h('p', { class: 'tr-x-legend caption' },
    h('span', {}, h('b', { 'aria-hidden': 'true', text: '✓' }), ' verdict matched'), h('span', {}, h('b', { 'aria-hidden': 'true', text: '✗' }), ' verdict didn’t match'),
    h('span', {}, h('b', { 'aria-hidden': 'true', text: '?' }), ' can’t tell (too few detections)'), h('span', {}, h('u', { 'aria-hidden': 'true', text: '✓' }), ' underlined = Aqua outside the 90% range'),
    h('span', {}, h('i', { class: 'sw-hatch', 'aria-hidden': 'true' }), ' hatched = not tested (no usable Aqua value; not zero)'), h('span', {}, h('i', { class: 'sw-dim', 'aria-hidden': 'true' }), ' faded = not in the current filter'));

  // grid blocks, built once; painting only toggles classes
  const blocks = val.regions.map((reg) => {
    const g = gridModel(val, reg.region_id);
    const t = gridTally(regionRows(val, reg.region_id));
    const cells = [];
    const grid = h('div', { class: 'tr-x-grid', role: 'grid', 'aria-label': `${nm(reg.region_id)}: one row per year, one column per month. Arrow keys move; Enter shows the month.` },
      h('div', { class: 'tr-x-row head', role: 'row' }, h('span', { class: 'tr-x-yl', role: 'columnheader', 'aria-label': 'Year' }), ...MONTH_LETTER.map((l, i) => h('span', { class: 'tr-x-mh', role: 'columnheader', 'aria-label': MONTH_LONG[i], text: l }))));
    g.forEach((yr, ri) => {
      const row = h('div', { class: 'tr-x-row', role: 'row' }, h('span', { class: 'tr-x-yl', role: 'rowheader', text: String(yr.year) }));
      yr.cells.forEach((c, ci) => {
        let el;
        if (c.state === 'test') {
          const m = matched(c.row);
          el = h('span', { class: `tr-x-c ${m === null ? 'nov' : m ? 'hit' : 'miss'}${c.row.inside90 ? '' : ' out90'}`, role: 'gridcell', tabindex: '-1' }, h('span', { 'aria-hidden': 'true', text: m === null ? '?' : m ? '✓' : '✗' }));
          el.__row = c.row;
        } else el = h('span', { class: `tr-x-c st-${c.state}`, role: 'gridcell', tabindex: '-1', 'aria-label': `${MONTH_LONG[ci]} ${yr.year}: ${c.state === 'untested' ? 'not tested (Aqua not usable this month; not zero)' : c.state === 'before' ? 'before the test window' : 'after the test window'}` });
        el.__pos = [ri, ci];
        cells.push(el); row.append(el);
      });
      grid.append(row);
    });
    const block = h('div', { class: 'tr-x-block', 'data-region': reg.region_id },
      h('div', { class: 'tr-x-bh' }, h('a', { href: `?view=region&region=${encodeURIComponent(reg.region_id)}#decades`, text: nm(reg.region_id) }),
        h('span', { class: 'tg-line', 'data-claim': 'A10-region', text: regionCoverageLine(reg, t) })), grid);
    const nRows = g.length;
    grid.addEventListener('keydown', (ev) => {
      const el = ev.target.closest('.tr-x-c'); if (!el) return;
      const act = keyAction(ev.key);
      if (act === 'select') { ev.preventDefault(); select(el); return; }
      const to = gridMove(nRows, el.__pos, ev.key); if (!to) return;
      ev.preventDefault();
      const t2 = cells.find((x) => x.__pos[0] === to[0] && x.__pos[1] === to[1]); if (!t2) return;
      cells.forEach((x) => { x.tabIndex = x === t2 ? 0 : -1; }); t2.focus();
    });
    grid.addEventListener('click', (ev) => { const el = ev.target.closest('.tr-x-c'); if (el) { cells.forEach((x) => { x.tabIndex = x === el ? 0 : -1; }); select(el); } });
    const first = cells.find((x) => x.__row) || cells[0];
    first.tabIndex = 0;
    return { reg, block, cells };
  });

  const rowWords = (r) => {
    const m = matched(r);
    return `${nm(r.region_id)}, ${MONTH_LONG[monthIndex(r.month)]} ${yearOf(r.month)}: Aqua ${r.inside90 ? 'inside' : `outside (${sideOf(r)})`} the 90% range; converted verdict ${VERDICT_M2[r.q4_n20].short}, Aqua ${VERDICT_M2[r.q4_truth].short}; ${m === null ? 'can’t tell' : m ? 'verdict matched' : 'verdict didn’t match'}${r.range_crosses_edge ? '; range crosses a usual-range edge' : ''}`;
  };
  function select(el) {
    blocks.forEach((b) => b.cells.forEach((x) => x.classList.toggle('sel', x === el)));
    const r = el.__row;
    state.sel = r || null;
    if (!r) { detail.replaceChildren(h('p', { class: 'caption', text: el.getAttribute('aria-label') })); return; }
    const er = errorRatio(r.pred, r.actual);
    detail.replaceChildren(h('p', { class: 'tr-x-dl' }, h('b', { text: `${nm(r.region_id)} · ${MONTH_LONG[monthIndex(r.month)]} ${yearOf(r.month)}` }),
      ` NOAA-20 counted ${fmtN(r.noaa20_raw)} (own scale) · converted ${fmtN(r.pred, 1)}, 90% range ${fmtN(r.lo90, 1)}–${fmtN(r.hi90, 1)} · Aqua measured ${fmtN(r.actual)}: ${r.inside90 ? 'inside' : `outside, ${sideOf(r)}`} · ${er ? er.text : ''} · converted ${VERDICT_M2[r.q4_n20].short}, Aqua ${VERDICT_M2[r.q4_truth].short}.`),
    onTry ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => onTry(r) }, 'Open in this area’s Time Machine →') : '');
  }

  function table(rows) {
    const yesNo = (b) => (b ? 'yes' : 'no');
    return h('div', { class: 'tr-x-tablewrap' }, h('table', { class: 'score-table tr-x-table' },
      h('caption', { text: `${rows.length} test month${rows.length === 1 ? '' : 's'} · ${exploreFilter(state.filter).label}${state.region === 'all' ? '' : ` · ${nm(state.region)}`}` }),
      h('thead', {}, h('tr', {}, ...['Study area', 'Month', 'NOAA-20 counted', 'Converted [90% range]', 'Aqua measured', 'Inside range', 'Converted verdict', 'Aqua verdict', 'Verdict matched', 'Range crosses edge'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, ...rows.map((r) => { const m = matched(r); return h('tr', {},
        h('td', { text: nm(r.region_id) }), h('th', { scope: 'row', text: monthLabel(r.month) }), h('td', { class: 'num', text: fmtN(r.noaa20_raw) }),
        h('td', { class: 'num', text: `${fmtN(r.pred, 1)} [${fmtN(r.lo90, 1)}–${fmtN(r.hi90, 1)}]` }), h('td', { class: 'num', text: fmtN(r.actual) }),
        h('td', { class: r.inside90 ? '' : 'bad', text: r.inside90 ? 'yes' : `no (${sideOf(r)})` }), h('td', { text: VERDICT_M2[r.q4_n20].short }), h('td', { text: VERDICT_M2[r.q4_truth].short }),
        h('td', { class: m === false ? 'bad' : '', text: m === null ? 'can’t tell' : yesNo(m) }), h('td', { text: yesNo(!!r.range_crosses_edge) })); }))));
  }

  function paint() {
    const counts = filterCounts(val, state.region);
    radios.forEach(({ f, input, count }) => { count.textContent = String(counts[f.id]); input.checked = f.id === state.filter; });
    viewBtns.forEach((b, i) => b.setAttribute('aria-pressed', ['grid', 'table'][i] === state.view ? 'true' : 'false'));
    const f = exploreFilter(state.filter);
    const n = counts[state.filter];
    const where = state.region === 'all' ? '' : ` in ${nm(state.region)}`;
    const scopeN = counts.all;
    status.textContent = n ? `${n} of ${scopeN} test months${where} · ${f.label}` : `No test months${where} match “${f.label}”. Try another filter or study area.`;
    // QA Q2: the "successful" verdict is the point verdict; say how many of those had a range crossing an edge
    const nEdgeOk = state.filter === 'success' ? filterRows(val, 'success', state.region).filter((r) => r.range_crosses_edge).length : 0;
    note.textContent = state.filter === 'success' ? `Point verdict; ${nEdgeOk} of these ${n} have 90% ranges crossing a usual-range edge, so a range-based call would have been ‘uncertain’.` : '';
    note.hidden = state.filter !== 'success';
    for (const b of blocks) {
      b.block.hidden = state.region !== 'all' && b.reg.region_id !== state.region;
      for (const c of b.cells) {
        if (!c.__row) continue;
        const on = f.test(c.__row);
        c.classList.toggle('off', !on);
        c.setAttribute('aria-label', `${rowWords(c.__row)}${on ? '' : '; not in the current filter'}`);
      }
    }
    if (state.view === 'grid') body.replaceChildren(...blocks.map((b) => b.block));
    else body.replaceChildren(table(filterRows(val, state.filter, state.region)));
    legend.hidden = state.view !== 'grid';
    detail.hidden = state.view !== 'grid';
  }

  const el = h('details', { class: 'tr-explore', id: 'decades' },
    h('summary', { class: 'tr-explore-sum' }, h('span', { class: 'tr-explore-t', text: scoped && state.region !== 'all' ? `This area’s ${filterCounts(val, state.region).all} test months` : `Explore all ${total} test months` }),
      h('span', { class: 'tr-explore-s', text: scoped && state.region !== 'all' ? `Every month in ${nm(state.region)}, with its range check and verdict; switch to all ${val.regions.length} study areas inside` : 'Filter by study area, find every miss, read every month as a table' })),
    h('div', { class: 'tr-explore-body' },
      h('div', { class: 'tr-x-controls' },
        h('div', { class: 'tr-x-region' }, h('label', { for: 'trx-region', text: 'Study area' }), regionSel),
        h('fieldset', { class: 'tr-x-fs' }, h('legend', { text: 'Show (filters overlap; counts are for the chosen area)' }), filterBox),
        h('div', { class: 'tr-x-views', role: 'group', 'aria-label': 'View as' }, ...viewBtns)),
      status, note, legend, body, detail));
  paint();
  return { el, open: () => { el.open = true; }, filterIds: EXPLORE_FILTERS.map((f) => f.id), state };
}

/** Scientific details, NOAA-20 test: every approved sentence (A1–A10, A12), the agreement bars, and the season definition. */
export function trustStatistics(val) {
  const { A, facts, tallies } = approvedWording(val);
  const bars = [['Converted NOAA-20', tallies.n20], ['Guessing the usual month', tallies.clim], ['Raw NOAA-20 counts', tallies.naive]].map(([lab, t]) =>
    h('div', { class: 'ag-row' }, h('span', { class: 'ag-lab', text: lab }), h('span', { class: 'ag-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${((t.agree / t.decided) * 100).toFixed(1)}%` })),
      h('span', { class: 'ag-n', text: `${t.agree} of ${t.decided} (${Math.round((t.agree / t.decided) * 100)}%)` })));
  return h('div', { class: 'tr-stats' },
    h('p', { class: 'dt-scope', 'data-claim': 'A1', text: A.A1 }),
    h('h4', { text: 'How close were the converted values?' }),
    h('ul', { class: 'summary-list' }, ...['A2', 'A3', 'A4', 'A5'].map((k) => h('li', { 'data-claim': k }, h('span', { text: A[k] }), DESCRIPTIVE.has(k) ? descTag() : ''))),
    h('h4', { text: 'Did the verdict match?' }),
    h('div', { class: 'ag' }, ...bars),
    h('ul', { class: 'summary-list' }, ...['A6', 'A7', 'A8'].map((k) => h('li', { 'data-claim': k, text: A[k] }))),
    h('h4', { text: 'Where it is weaker' }),
    h('ul', { class: 'summary-list' }, h('li', { 'data-claim': 'A10' }, h('span', { text: A.A10 }), descTag()), h('li', { class: 'caption', 'data-def': 'season', text: seasonDefinition(facts.base) })),
    h('p', { class: 'dc-a12 caption', 'data-claim': 'A12', text: A.A12 }));
}

/** Scientific details: the three confusion matrices (they are never pooled or ranked together) and A9. */
export function trustMatrices(val) {
  const { A, facts } = approvedWording(val);
  const q4 = val.pooled.q4;
  return h('div', { class: 'tr-mats' },
    h('p', { class: 'caption', text: 'Rows: what Aqua measured. Columns: the verdict from each approach. The diagonal is a match; “missed” = an unusual month called within; “false flag” = a usual month called unusual.' }),
    h('div', { class: 'tr-mats-row' },
      confTable(q4.arms.n20_direct.confusion, { id: 'cm-n20', armLabel: 'Converted NOAA-20:' }),
      confTable(q4.arms.naive.confusion, { id: 'cm-naive', armLabel: 'Raw NOAA-20 counts:' }),
      confTable(q4.viirs_era_arm.confusion, { id: 'cm-viirs', armLabel: `Ranking within the ${facts.viirsEra} VIIRS years:`, caption: q4.viirs_era_arm.crosstab_label })),
    h('p', { class: 'dt-a9', 'data-claim': 'A9', text: A.A9 }));
}

/** Scientific details: how the NOAA-20 test was run (rules, leave-one-year-out, provenance hashes, the month-picking rules). */
export function trustMethod(val) {
  const { facts } = approvedWording(val);
  const q4 = val.pooled.q4; const p = val.provenance;
  return h('ul', { class: 'caption tr-method' },
    h('li', { text: `Verdict = the converted point value against Aqua’s ${facts.base} p10–p90 for that calendar month (${q4.rule.classification}).` }),
    h('li', { text: `Decided months that disagreed, as a share of all ${q4.n_rows}: ${(q4.arms.n20_direct.wrong_decisive_rate * 100).toFixed(1)}% (includes misses; not 1 − agreement).` }),
    h('li', { text: `Leave-one-year-out: ${val.window.design}.` }),
    p && p.featured_month_rule ? h('li', { text: `Pre-locked opening month per study area: ${p.featured_month_rule}.` }) : '',
    h('li', { text: `Example month in each area’s Time Machine: ${REGION_CASE_RULE.m2.success}` }),
    h('li', { text: `“See a miss”: ${REGION_CASE_RULE.m2.miss}` }),
    h('li', { class: 'mono', text: `lock ${p.lock_id} · ${p.freeze_tag} ${String(p.freeze_commit).slice(0, 7)} · ${p.results_tag} ${p.results_commit} · ${p.files.length} files hashed` }));
}

/** Scientific details: robustness checks that are in the site data. */
export function trustRobustness(val) {
  const q4 = val.pooled.q4;
  const res = q4.arms.n20_direct.over_reference_resamples && q4.arms.n20_direct.over_reference_resamples.agreement_among_decided;
  return h('ul', { class: 'caption tr-robust' },
    res ? h('li', { text: `Agreement over resampled reference years: ${Math.round(res.q025 * 100)}–${Math.round(res.q975 * 100)}%. The 90% ranges do not include the baseline’s own sampling error.` }) : '',
    h('li', { text: `Every scored month was predicted by a fit that excluded its whole year (${val.window.design.split(';')[0]}).` }),
    h('li', { text: 'Further control checks (a placebo link test, a version-step check and a pseudo-switch check) are stored with the test file’s controls; the robustness table (other quantile rules, a longer baseline, dropping one area at a time) is in the project’s internal audit records, which are not part of this site. They are not restated here.' }));
}
