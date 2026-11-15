// "Same place, same month, two satellites": raw VIIRS -> converted to Aqua's scale (with its likely range) ->
// what Aqua measured (or a hatched "no measurement" slot). One fixed log axis per region so months can be compared,
// with a separate "0" stub because a log axis has no zero. Used on the Trust page (guided reveal) and in the
// region month detail. Pure helpers (twoSatModel, twoSatDomain, logPos) carry no DOM and are unit-tested.
import { PLATFORM_LABEL, NATIVE_STATUS_WORD, VIIRS_PLATFORMS, nativeStatus, nativeN, monthIndex, monthLabel, yearOf, eraFor, verdictFor, VERDICT } from './core.js';
import { h, fmtN, prefersReducedMotion } from './ui.js';
import { intervalFirst } from './viz.js';
import { revealOutcome, MONTH_FULL } from './story.js';

export const WHY_LINE = 'VIIRS’s finer pixels pick up smaller and more hot spots, so its raw counts are several times higher. We convert using the ratio between the two satellites in the same region and season, from the training years.';

/** Everything the figure needs for one region-month, read from a series row. `method` is the record's conversion lane. */
export function twoSatModel(row, { method, env = null, region = null, eras = null } = {}) {
  if (!row) return null;
  const lane = row.modelled && row.modelled[method];
  const est = lane && lane.status === 'estimated' && Number.isFinite(lane.value) ? { value: lane.value, lo: lane.lo, hi: lane.hi, inputs: lane.inputs || [] } : null;
  const platform = (est && est.inputs.find((p) => VIIRS_PLATFORMS.includes(p))) || VIIRS_PLATFORMS.find((p) => nativeStatus(row, p) === 'observed') || null;
  const e = env ? env[monthIndex(row.month)] : null;
  const year = yearOf(row.month);
  return {
    month: row.month,
    viirs: platform ? { platform, status: nativeStatus(row, platform), n: nativeN(row, platform) } : null,
    est,
    aqua: { status: nativeStatus(row, 'aqua'), n: nativeN(row, 'aqua') },
    usual: e && e.n_years >= 5 && e.p10 != null ? { p10: e.p10, p90: e.p90, n_years: e.n_years } : null,
    heldOut: row.held_out === true,
    train: !!(region && (region.trained_on_years || []).includes(year)) || row.split === 'train',
    era: eraFor(row.month, eras, row.era),
  };
}

/** True when the figure has something honest to show: a VIIRS count and a conversion of it. */
export const twoSatAvailable = (m, region) => !!(m && m.viirs && m.viirs.status === 'observed' && m.est && region && region.status !== 'explore_only');

/** Fixed log10 domain [lo, hi] for a region: decades bracketing every positive VIIRS count, estimate, range end and Aqua count. */
export function twoSatDomain(months, method) {
  const vals = [];
  for (const r of months || []) {
    for (const p of ['aqua', ...VIIRS_PLATFORMS]) { const n = nativeN(r, p); if (n > 0) vals.push(n); }
    const l = r.modelled && r.modelled[method];
    if (l && l.status === 'estimated') for (const v of [l.value, l.lo, l.hi]) if (v > 0) vals.push(v);
  }
  if (!vals.length) return [1, 10];
  const lo = 10 ** Math.floor(Math.log10(Math.min(...vals)));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...vals)) + 1e-9);
  return [Math.min(lo, 1), Math.max(hi, lo * 10)];
}

export const ZERO_STUB = 6; // % of the track reserved for the "0 · none reported" stub, left of the log axis
/** Position (0..100, % of track) of a value on the fixed axis. Zero goes to the stub; values are clamped to the domain. */
export function logPos(v, [lo, hi]) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v <= 0) return ZERO_STUB / 2;
  const t = (Math.log10(Math.min(Math.max(v, lo), hi)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return ZERO_STUB + 3 + t * (100 - ZERO_STUB - 4);
}

const tickLabel = (v) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}k` : String(v));

/**
 * Build the figure. opts: { domain, regionName, scope (text), revealed (bool), revealable (bool) }.
 * Returns { el, reveal({ animate }) }. When revealable and not yet revealed, the Aqua row shows a placeholder.
 */
export function twoSat(m, { domain, regionName = '', scope = '', revealed = true, idPrefix = 'ts', ratioMethod = true } = {}) {
  const pos = (v) => logPos(v, domain);
  const pct = (v) => `${pos(v).toFixed(2)}%`;
  const mname = MONTH_FULL[monthIndex(m.month)];
  const aquaOk = m.aqua.status === 'observed' && m.aqua.n != null;
  const plat = m.viirs ? (PLATFORM_LABEL[m.viirs.platform] || m.viirs.platform) : 'VIIRS';

  const usualBand = () => (m.usual ? h('span', { class: 'ts-usual', style: `left:${pct(m.usual.p10)};width:${(pos(m.usual.p90) - pos(m.usual.p10)).toFixed(2)}%`, 'aria-hidden': 'true' }) : null);
  // the usual band is on Aqua's scale, so it is drawn only on the converted and measured rows, never on raw VIIRS
  const track = (...kids) => h('div', { class: 'ts-track' }, h('span', { class: 'ts-zero', 'aria-hidden': 'true' }), ...kids);
  const aquaTrackOf = (...kids) => track(usualBand(), ...kids);

  // row 1: raw VIIRS
  const vN = m.viirs ? m.viirs.n : null;
  const r1 = h('div', { class: 'ts-row ts-viirs' },
    h('div', { class: 'ts-who' }, h('span', { class: 'ts-key ring', 'aria-hidden': 'true' }), h('span', {}, 'Newer satellite (VIIRS) counted', h('small', { text: `on the ${plat.replace(' VIIRS', '')} satellite; raw, own scale` }))),
    track(vN != null ? h('span', { class: 'ts-dot ring', style: `left:${pct(vN)}` }) : null),
    h('div', { class: 'ts-val', text: vN == null ? (m.viirs ? NATIVE_STATUS_WORD[m.viirs.status] : 'no VIIRS') : vN === 0 ? 'none reported' : fmtN(vN) }));

  // row 2: converted, with range and the "÷ ratio" connector from the raw dot
  const e = m.est;
  const ratio = e && vN > 0 && e.value > 0 ? vN / e.value : null;
  // the conversion step: its own row, a labelled arrow from the raw count to the converted one
  const rTxt = ratio ? (ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)) : null;
  const conn = e && vN != null ? h('span', { class: `ts-arrow${pos(e.value) < pos(vN) ? ' leftward' : ''}`, style: `left:${pct(Math.min(vN, e.value) || 0)};width:${Math.abs(pos(vN) - pos(e.value)).toFixed(2)}%`, 'aria-hidden': 'true' }) : null;
  const rc = rTxt ? h('div', { class: 'ts-row ts-convert' },
    h('div', { class: 'ts-who ts-ratio' }, h('span', { class: 'ts-div', text: `÷ ${rTxt}` })),
    track(conn), h('div', { class: 'ts-val' }),
    h('p', { class: 'ts-convert-t', text: ratioMethod ? `In the training years, VIIRS counted about ${rTxt}× more than Aqua here in ${mname}, so its count is divided by ${rTxt}.` : `The estimate is the VIIRS count divided by about ${rTxt} this month.` })) : null;
  const r2 = h('div', { class: 'ts-row ts-est' },
    h('div', { class: 'ts-who' }, h('span', { class: 'ts-key est', 'aria-hidden': 'true' }), h('span', {}, 'Converted to Aqua’s scale', h('small', { text: e && e.lo != null ? `likely range ${fmtN(e.lo, 1)}–${fmtN(e.hi, 1)}` : 'no likely range' }))),
    aquaTrackOf(e && e.lo != null ? h('span', { class: 'ts-range', style: `left:${pct(e.lo)};width:${(pos(e.hi) - pos(e.lo)).toFixed(2)}%` }) : null,
      e ? h('span', { class: 'ts-dot est', style: `left:${pct(e.value)}` }) : null),
    h('div', { class: 'ts-val', text: e ? fmtN(e.value, 1) : 'not converted' }));

  // row 3: Aqua measured, or a hatched slot when there is no measurement (never drawn as zero)
  const aquaWord = aquaOk ? (m.aqua.n === 0 ? 'none reported' : fmtN(m.aqua.n)) : `no measurement (${NATIVE_STATUS_WORD[m.aqua.status] || m.aqua.status})`;
  const aquaTrack = aquaOk ? aquaTrackOf() : aquaTrackOf(h('span', { class: 'ts-gap', text: m.aqua.status === 'excluded' ? 'Aqua excluded (outage): nothing to check' : `Aqua ${NATIVE_STATUS_WORD[m.aqua.status] || m.aqua.status}: nothing to check` }));
  const aquaVal = h('div', { class: 'ts-val' });
  const r3 = h('div', { class: `ts-row ts-aqua${aquaOk ? '' : ' is-gap'}` },
    h('div', { class: 'ts-who' }, h('span', { class: 'ts-key aqua', 'aria-hidden': 'true' }), h('span', {}, 'Aqua measured', h('small', { text: m.heldOut ? 'real measurement, hidden from the method' : aquaOk ? 'real measurement' : 'no usable value this month' }))),
    aquaTrack, aquaVal);
  const aquaDot = aquaOk ? h('span', { class: 'ts-dot aqua', style: `left:${pct(m.aqua.n)}` }) : null;
  const aquaDrop = aquaOk ? h('span', { class: 'ts-drop', style: `left:${pct(m.aqua.n)}`, 'aria-hidden': 'true' }) : null;
  const hiddenMark = aquaOk ? h('span', { class: 'ts-hidden', text: 'hidden until you reveal it' }) : null;

  // axis: zero stub + decades
  const ticks = [];
  for (let v = domain[0]; v <= domain[1] * 1.0001; v *= 10) ticks.push(v);
  const axis = h('div', { class: 'ts-axisrow', 'aria-hidden': 'true' }, h('div'),
    h('div', { class: 'ts-axis' }, h('span', { class: 'ts-tick zero', style: `left:${(ZERO_STUB / 2).toFixed(2)}%`, text: '0' }),
      ...ticks.map((v) => h('span', { class: 'ts-tick', style: `left:${pct(v)}`, text: tickLabel(v) }))),
    h('div'));

  const readout = h('div', { class: 'ts-readout', 'aria-live': 'polite', id: `${idPrefix}-readout` });
  const usualKey = m.usual ? h('span', { class: 'ts-legend-usual' }, h('span', { class: 'sw', 'aria-hidden': 'true' }), `shaded = usual ${mname} (middle 80% of Aqua’s early-years months, ${fmtN(m.usual.p10, 1)}–${fmtN(m.usual.p90, 1)})`) : null;
  const el = h('figure', { class: 'twosat' },
    h('figcaption', { id: `${idPrefix}-cap` }, h('span', { class: 'ts-title', text: 'Same place, same month, two satellites' }), h('span', { class: 'ts-sub', text: `${monthLabel(m.month)}${regionName ? ` · ${regionName}` : ''} · daytime detections per month` })),
    h('div', { class: 'ts-rows' }, r1, rc, r2, r3, axis),
    h('p', { class: 'ts-key-line caption' }, h('span', { text: 'Log scale: each step is ten times the last; 0 (none reported) sits apart at the left. ' }), usualKey),
    readout,
    h('p', { class: 'ts-why caption', text: WHY_LINE }),
    scope ? h('p', { class: 'ts-scope caption', text: scope }) : null);
  el.setAttribute('aria-label', describe(m, plat));

  let isOpen = false;
  function paintReadout() {
    readout.replaceChildren();
    if (!aquaOk) {
      const vd = m.est && m.usual ? verdictFor({ value: m.est.value, lo: m.est.lo, hi: m.est.hi, kind: 'modelled' }, { ...m.usual, n_years: m.usual.n_years }) : 'unknown';
      readout.append(h('p', { class: 'ts-line' }, h('b', { text: 'Estimate vs measured: ' }), 'no measurement to compare'),
        h('p', { class: 'ts-line' }, h('b', { text: 'Against the usual month: ' }), m.est && m.usual
          ? `Estimate only (not this month’s verdict; not counted): likely range ${fmtN(m.est.lo, 1)}–${fmtN(m.est.hi, 1)} vs usual ${fmtN(m.usual.p10, 1)}–${fmtN(m.usual.p90, 1)}: ${VERDICT[vd] ? VERDICT[vd].word : 'can’t tell'}` : 'no usual range to compare'));
      return;
    }
    if (!isOpen) { readout.append(h('p', { class: 'ts-line muted', text: 'Where do you think Aqua’s count falls? Then reveal it.' })); return; }
    const o = revealOutcome(m.est ? m.est.value : null, m.aqua.n, m.est ? m.est.lo : null, m.est ? m.est.hi : null);
    readout.append(h('p', { class: 'ts-line' }, h('b', { text: o.point.split(': ')[0] + ': ' }), o.point.split(': ').slice(1).join(': ')),
      h('p', { class: `ts-line ${o.kind === 'missed' ? 'miss' : ''}` }, h('b', { text: 'Likely range: ' }), o.range.replace('Likely range: ', '')),
      h('p', { class: 'ts-outcome caption', text: o.text }));
  }

  function reveal({ animate = true } = {}) {
    if (!aquaOk) return;
    isOpen = true;
    hiddenMark && hiddenMark.remove();
    const t = r3.querySelector('.ts-track');
    if (!t.contains(aquaDot)) t.append(aquaDot);
    for (const tr of [r1, r2].map((r) => r.querySelector('.ts-track'))) if (!tr.querySelector('.ts-drop')) tr.append(aquaDrop.cloneNode());
    aquaVal.textContent = aquaWord;
    if (!t.querySelector('.ts-landed')) t.append(h('span', { class: 'ts-landed', style: `left:${pct(m.aqua.n)}`, 'aria-hidden': 'true' }));
    if (animate && !prefersReducedMotion() && aquaDot.animate) {
      // interval first: the likely range and the usual band re-draw, then the measured value lands
      const lag = intervalFirst(el.querySelectorAll('.ts-est .ts-range, .ts-aqua .ts-usual'));
      aquaDot.animate([{ transform: 'translate(-50%, -420%) scale(1.3)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 400, delay: lag, easing: 'cubic-bezier(0.34, 1.2, 0.64, 1)', fill: 'backwards' });
      const ring = t.querySelector('.ts-landed');
      ring.animate([{ transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.9 }, { transform: 'translate(-50%, -50%) scale(2.2)', opacity: 0 }], { duration: 500, delay: lag + 360, easing: 'ease-out', fill: 'both' });
      el.querySelectorAll('.ts-drop').forEach((d) => d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: lag + 200, fill: 'backwards' }));
    }
    paintReadout();
  }

  if (aquaOk) {
    if (revealed) reveal({ animate: false });
    else { r3.querySelector('.ts-track').append(hiddenMark); aquaVal.textContent = '?'; paintReadout(); }
  } else { aquaVal.textContent = '—'; paintReadout(); }
  return { el, reveal, aquaOk, isRevealed: () => isOpen };
}

function describe(m, plat) {
  const parts = [`${monthLabel(m.month)}.`];
  parts.push(m.viirs && m.viirs.n != null ? `${plat} counted ${m.viirs.n === 0 ? 'no detections' : fmtN(m.viirs.n)} on its own scale.` : `${plat}: no count.`);
  if (m.est) parts.push(`Converted to Aqua’s scale: ${fmtN(m.est.value, 1)}${m.est.lo != null ? `, likely range ${fmtN(m.est.lo, 1)} to ${fmtN(m.est.hi, 1)}` : ''}.`);
  if (m.aqua.status !== 'observed') parts.push(`Aqua: no usable measurement (${NATIVE_STATUS_WORD[m.aqua.status] || m.aqua.status}); this is not a zero.`);
  return parts.join(' ');
}
