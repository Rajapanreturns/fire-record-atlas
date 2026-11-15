// Region page helpers: the axis for the hero seasonal chart (hero.js), the year strip (one mini column of 12 months
// per year) that selects the year laid over the usual season, and the per-year verdict tally.
import { recordSource, classOf } from './core.js';
import { h } from './ui.js';

/** A "nice" axis maximum and ticks for a linear count axis starting at 0. */
export function niceAxis(max) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const step0 = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * step0).find((s) => max / s <= 5) || step0 * 10;
  const top = Math.ceil(max / step) * step;
  const ticks = []; for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { max: top, ticks };
}

/**
 * Year strip: one mini column of 12 months per year, shaded on the record's scale, hatched where not observed,
 * outlined where estimated. A horizontal listbox: Left/Right, Home/End; selection follows focus.
 * opts: { yearRows, thresholds, value(row), selected, onSelect(year), flagged, flagLabel, stepperOnly }
 */
export function yearStrip(opts) {
  const years = opts.yearRows.map((yr) => yr.year);
  let sel = opts.selected;
  const list = h('div', { class: 'ys-list', role: 'listbox', 'aria-orientation': 'horizontal', 'aria-label': 'Choose a year' });
  const opt = new Map();
  const flagged = new Set(opts.flagged || []);
  let flagGroup = null;
  for (const yr of opts.yearRows) {
    const o = h('div', { class: `ys-opt${flagged.has(yr.year) ? ' flagged' : ''}`, role: 'option', id: `ys-${yr.year}`, 'data-year': String(yr.year), tabindex: '-1' });
    const stack = h('span', { class: 'ys-stack', 'aria-hidden': 'true' });
    let est = 0; let missing = 0;
    for (let i = 0; i < 12; i += 1) {
      const r = yr.cells[i];
      const c = h('span', { class: 'ys-cell' });
      if (!r) c.classList.add('outside');
      else {
        const v = opts.value(r);
        if (v.value == null) { c.classList.add(recordSource(r) === 'terra_only' ? 'terra' : 'none'); missing += 1; } else {
          const k = classOf(v.value, opts.thresholds); c.classList.add(k === 0 ? 'c0' : `o${k}`);
          if (v.kind !== 'observed') { c.classList.add('est'); est += 1; }
        }
      }
      stack.append(c);
    }
    o.append(stack, h('span', { class: `ys-lab${yr.year % 5 === 0 ? ' major' : ''}`, text: String(yr.year).slice(2), 'aria-hidden': 'true' }));
    o.setAttribute('aria-label', `${yr.year}${flagged.has(yr.year) ? `, ${opts.flagLabel || 'flagged'}` : ''}${yr.heldOut ? ', test year' : ''}${est ? `, ${est} months estimated from VIIRS` : ''}${missing ? `, ${missing} months without an Aqua-scale count` : ''}`);
    o.addEventListener('click', () => choose(yr.year, true));
    opt.set(yr.year, o);
    // flagged years (e.g. unconfirmed drift years) sit together under a visible bracket
    if (flagged.has(yr.year)) {
      if (!flagGroup) { flagGroup = h('div', { class: 'ys-flag', role: 'group', 'aria-label': `${opts.flagLabel || 'flagged'} years` }, h('span', { class: 'ys-flag-l', 'aria-hidden': 'true', text: opts.flagLabel || '' })); list.append(flagGroup); }
      flagGroup.append(o);
    } else list.append(o);
  }
  list.addEventListener('keydown', (ev) => {
    const i = years.indexOf(sel);
    const j = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: years.length - 1 }[ev.key];
    if (j === undefined) return;
    ev.preventDefault();
    choose(years[Math.max(0, Math.min(years.length - 1, j))], true);
  });
  const prev = h('button', { type: 'button', class: 'ys-step', 'aria-label': 'Previous year', onclick: () => choose(years[Math.max(0, years.indexOf(sel) - 1)], false) }, '‹');
  const next = h('button', { type: 'button', class: 'ys-step', 'aria-label': 'Next year', onclick: () => choose(years[Math.min(years.length - 1, years.indexOf(sel) + 1)], false) }, '›');
  // not a live region: the year is announced once, by the region page's tally (which starts with the year)
  const label = h('span', { class: 'ys-year' });
  // stepperOnly (region page, M4.1ux): just ‹ year ›; the unusual-month timeline's year labels pick a year directly
  const el = h('div', { class: `year-strip${opts.stepperOnly ? ' stepper-only' : ''}` }, h('div', { class: 'ys-stepper' }, prev, label, next), opts.stepperOnly ? null : h('div', { class: 'ys-scroll' }, list));

  function paint() {
    for (const [yy, o] of opt) { const on = yy === sel; o.setAttribute('aria-selected', on ? 'true' : 'false'); o.tabIndex = on ? 0 : -1; o.classList.toggle('on', on); }
    label.textContent = String(sel);
    label.classList.toggle('flagged', flagged.has(sel));
    prev.disabled = years.indexOf(sel) <= 0; next.disabled = years.indexOf(sel) >= years.length - 1;
  }
  function choose(year, focus) {
    if (year == null) return;
    const changed = year !== sel;
    sel = year; paint();
    if (focus) opt.get(year).focus();
    const o = opt.get(year); if (o && o.scrollIntoView && changed) o.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (changed) opts.onSelect(year);
  }
  paint();
  return { el, set: (y) => { if (y !== sel && opt.has(y)) { sel = y; paint(); } } };
}

/** Verdict counts for a year in words, e.g. "3 above, 8 within, 1 can't tell". */
export function yearTally(rows, verdict) {
  const c = { above: 0, within: 0, below: 0, unknown: 0, none: 0 };
  for (const r of rows) if (r) { const v = verdict(r); if (v in c) c[v] += 1; }
  return c;
}

