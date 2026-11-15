// "Raw counts, each satellite on its own scale" (was "Compare old and new satellites"): today's raw ruler (each satellite on its own scale, no verdict), plus,
// formerly in the removed advanced mode, the method selector including the detailed model labelled "not adopted".
import { VIIRS_PLATFORMS, PLATFORM_LABEL, NATIVE_STATUS_WORD, classOf, nativeStatus, nativeN, recordSource, classChanges, methodRole, yearOf } from './core.js';
import { h } from './ui.js';
import { satelliteYears, glossAqua, glossViirs } from './story.js';

/** Overlap years (both satellites measuring) from manifest.eras, as a label; null when the manifest has none. */
export function overlapLabel(eras) {
  const e = (eras || []).find((x) => x.id === 'overlap');
  if (!e) return null;
  const a = yearOf(e.start); const b = e.end ? yearOf(e.end) : null;
  return b == null ? `from ${a}` : `${a}–${b}`;
}

/**
 * Builds the compare toggle and panel. S is the region's shared state (see region.js).
 * Returns { toggle, panel, paint }.
 */
export function compareUI(S) {
  const { state } = S;
  const toggle = h('button', { class: 'btn btn-compare', type: 'button', 'aria-controls': 'compare-panel', onclick: () => S.setRuler(state.ruler === 'record' ? 'raw' : 'record', { focusPanel: true }) });
  const panel = h('section', { class: 'compare-panel', id: 'compare-panel', 'aria-labelledby': 'cmp-h', tabindex: '-1' });

  function paint() {
    const open = state.ruler !== 'record';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Back to the record' : 'Raw counts, each satellite on its own scale';
    toggle.hidden = S.exploreOnly;
    panel.hidden = !open;
    panel.replaceChildren();
    if (!open) return;
    const ov = overlapLabel(S.manifest.eras);
    panel.append(h('p', { class: 'panel-label', text: state.ruler === 'alt' ? 'Method comparison' : `Compare · ${ov ? `both satellites ${ov}` : 'old and new satellites'}` }));
    panel.append(h('h2', { class: 'section-title', id: 'cmp-h', text: state.ruler === 'alt' ? 'The record redrawn with the model we did not adopt' : 'Old and new satellites, each on its own scale' }));
    if (state.ruler === 'raw') {
      panel.append(h('p', {},
        `${ov ? `In ${ov} both satellites measured this region. ` : ''}Here each one is drawn on its own colour scale: ${glossAqua(satelliteYears(S.manifest))} in teal (the squares), ${glossViirs(satelliteYears(S.manifest))} in violet (the thin strips under each month). `,
        h('b', { text: 'No month gets a verdict here: ' }), 'VIIRS has finer pixels and records more detections, so raw counts from the two satellites are not on the same scale.'));
      if (S.exploreOnly) panel.append(h('p', { class: 'caption', text: 'This region is explore only: no conversion has been tested here.' }));
    }
    if (S.state.advanced && !S.exploreOnly) panel.append(methodSelector(S), changeReport(S));
  }
  return { toggle, panel, paint };
}

function methodSelector(S) {
  const label = { record: `Record (${S.recName.toLowerCase()})`, raw: 'Each satellite on its own scale', alt: `${S.altName}${methodRole(S.altMeta) === 'candidate' ? ' (not adopted)' : ''}` };
  return h('fieldset', { class: 'ruler' }, h('legend', { class: 'visually-hidden', text: 'Method: which scale the calendar is drawn on' }),
    ...['record', 'raw', 'alt'].map((r) => h('label', {}, h('input', { type: 'radio', name: 'ruler', value: r, checked: r === S.state.ruler,
      onchange: () => S.setRuler(r) }), label[r])));
}

function changeReport(S) {
  const p = h('p', { class: 'change-report', 'aria-live': 'polite' });
  if (S.state.ruler !== 'alt') return p;
  const c = classChanges(S.months, S.env, 'alt', S.lanes.alt);
  if (!c.total) { p.append(`No month in this record comes from VIIRS, so swapping the method changes nothing. ${c.observedChanged} Aqua-measured months changed.`); return p; }
  p.append(h('b', { text: `${c.changed} of ${c.total} months estimated from VIIRS change verdict` }), ` · ${c.observedChanged} Aqua-measured months changed. `,
    h('span', { class: 'muted', text: `Only months estimated from VIIRS can move; measured months are pinned. The record itself uses the ${S.recName.toLowerCase()}.` }));
  return p;
}

/** Thin strips under a month: VIIRS lanes on their own scale (raw), or the measured/estimated braid (former advanced mode). */
export function paintStrands(S, cell, yr) {
  const r = cell.__row; const box = cell.__strands; box.replaceChildren();
  if (S.state.ruler === 'raw') {
    for (const p of yr.viirsPlatforms) {
      const st = nativeStatus(r, p);
      const s = h('div', { class: 'strand', 'aria-hidden': 'true', title: `${PLATFORM_LABEL[p]}: ${st === 'observed' ? nativeN(r, p) : NATIVE_STATUS_WORD[st]}` });
      if (st === 'observed') { const k = classOf(nativeN(r, p), S.rawViirsT); s.classList.add(k === 0 ? 'c0' : `v${k}`); } else s.classList.add(`st-${st}`);
      box.append(s);
    }
    return;
  }
  if (!S.state.advanced || !yr.braid) return;
  const src = recordSource(r);
  const a = h('div', { class: 'strand', 'aria-hidden': 'true' });
  const ast = nativeStatus(r, 'aqua');
  if (ast === 'observed') { const k = classOf(nativeN(r, 'aqua'), S.aquaT); a.classList.add(k === 0 ? 'c0' : `o${k}`); } else a.classList.add(`st-${ast}`);
  if (src === 'observed_aqua' || src === 'blended') a.classList.add('thread');
  const lane = S.state.ruler === 'alt' ? S.lanes.alt : S.lanes.record;
  const m = r.modelled && r.modelled[lane];
  const b = h('div', { class: 'strand modelled', 'aria-hidden': 'true' });
  if (m && m.status === 'estimated' && m.value != null) { const k = classOf(m.value, S.aquaT); b.classList.add(k === 0 ? 'c0' : `o${k}`); } else b.classList.add('st-not_in_archive');
  if (src === 'modelled_from_viirs' || src === 'blended') b.classList.add('thread');
  box.append(a, b);
}

/** Key for the compare view: one ramp per satellite family, never shared. */
export function rawKey(S, ramp) {
  const anyViirs = S.months.some((r) => VIIRS_PLATFORMS.some((p) => nativeStatus(r, p) === 'observed'));
  return [ramp('t', S.rawAquaT, 'Aqua MODIS detections / month (its own scale)'),
    anyViirs ? ramp('v', S.rawViirsT, 'VIIRS detections / month (its own scale, thin strips)') : h('span', { class: 'caption', text: 'No VIIRS months in this series yet.' })];
}
