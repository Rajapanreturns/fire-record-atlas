// "Method details": per-month instrument tables, provenance, audit flags, overpass times, the full table.
// Every section is a native <details> (collapsed by default; the old ?mode=advanced switch is gone). Nothing here is needed to read the story.
import {
  PLATFORMS, PLATFORM_LABEL, NATIVE_STATUS_WORD, NATIVE_STATUS_NOTE, RECORD_SOURCE_WORD, VERDICT, QUALITY_WORD,
  nativeStatus, nativeN, recordSource, methodName, methodRole, formatAuditFlag, monthVerdict, rulerValue,
} from './core.js';
import { h, fmtN, fmtInterval } from './ui.js';

const open = (S) => (S.state.advanced ? true : null);

/** "More detail" for one month: native counts, modelled lanes, quality codes, ids. */
export function loupeDetail(S, r) {
  const { methods, lanes, series } = S;
  const src = recordSource(r);
  const box = h('details', { class: 'more', open: open(S) }, h('summary', { text: 'More detail' }));
  const split = r.held_out ? 'held-out test year' : r.split === 'train' ? 'training year (agreement here is in-sample)' : r.split || '';
  box.append(h('p', { class: 'prov', text: `era ${r.era || '—'}${split ? ` · ${split}` : ''} · record source ${RECORD_SOURCE_WORD[src]}` }));
  box.append(h('h3', { text: 'Each satellite’s own count' }), h('table', {},
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Satellite' }), h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', style: 'text-align:right', text: 'Detections' }), h('th', { scope: 'col', style: 'text-align:right', text: 'Days' }))),
    h('tbody', {}, ...PLATFORMS.map((p) => {
      const c = r.native[p] || {}; const st = nativeStatus(r, p);
      return h('tr', {}, h('td', { text: PLATFORM_LABEL[p] }), h('td', { title: NATIVE_STATUS_NOTE[st] }, NATIVE_STATUS_WORD[st], c.archive && c.archive !== 'standard' && st === 'observed' ? ` (${c.archive})` : ''),
        h('td', { class: 'num', text: st === 'observed' ? fmtN(c.n) : '—' }), h('td', { class: 'num', text: st === 'observed' && c.n_days_with_detection != null ? String(c.n_days_with_detection) : '—' }));
    }))));
  const modelLanes = Object.entries(r.modelled || {});
  if (modelLanes.length) {
    box.append(h('h3', { text: 'Estimates of Aqua’s count from VIIRS' }), h('table', {},
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Method' }), h('th', { scope: 'col', style: 'text-align:right', text: 'Value' }), h('th', { scope: 'col', style: 'text-align:right', text: 'Likely range' }))),
      h('tbody', {}, ...modelLanes.map(([k, m]) => h('tr', {},
        h('td', {}, `${methodName(methods[m.method_id] || { id: k })}${k === lanes.record ? (r.gap_estimate ? ' · stored gap estimate (VIIRS layer only)' : ' · used by the record') : methodRole(methods[m.method_id]) === 'candidate' ? ' · not adopted' : ''}`, h('br'), h('span', { class: 'mono muted', text: `${m.method_id || '—'} ${m.method_version || ''}${m.inputs && m.inputs.length ? ` · from ${m.inputs.join('+')}` : ''}` })),
        h('td', { class: 'num', text: m.status === 'estimated' ? fmtN(m.value, 1) : m.status.replace(/_/g, ' ') }),
        h('td', { class: 'num', text: m.status === 'estimated' ? (fmtInterval(m.lo, m.hi) || 'none') : '' }))))));
  }
  const tech = S.caveatsOf(r);
  if (tech.length) box.append(h('h3', { text: 'Technical caveats' }), h('ul', { class: 'flags' }, ...tech.map((k) => h('li', { text: k.text }))));
  const q = (r.quality || []).filter((f) => f !== 'fixture');
  if (q.length) box.append(h('h3', { text: 'Quality codes' }), h('ul', { class: 'flags' }, ...q.map((f) => h('li', { text: `${f}: ${QUALITY_WORD[f] || f}` }))));
  const v = rulerValue(r, S.state.ruler === 'raw' ? 'record' : S.state.ruler, lanes.alt);
  const mv = monthVerdict(r, S.state.ruler === 'raw' ? 'record' : S.state.ruler, S.env, lanes.alt);
  box.append(h('p', { class: 'prov', style: 'margin-top:10px', text: `${series.region_id} · ${r.month} · value ${v.value ?? '—'} · verdict ${mv.cls ? VERDICT[mv.cls].word : '—'} (${mv.source === 'export' ? 'from the published record' : 'computed in this browser, same rule'}) · lane=${(r.record && r.record.lane) || '—'} · dataset ${series.dataset_version}${S.fixture ? ' · FIXTURE' : ''}` }));
  return box;
}

/** Provenance and method, including the strategy wording that used to sit in the global banner. */
export function provenance(S) {
  const { manifest, months, region, series, envSource, baseLabel } = S;
  const ml = (manifest.methods || []).filter((mm) => months.some((r) => Object.values(r.modelled || {}).some((x) => x && x.method_id === mm.id) || (r.record && r.record.method_id === mm.id)));
  const st = manifest.strategy;
  return h('dl', { class: 'dl-grid prov' },
    h('dt', { text: 'region' }), h('dd', { text: `${region.id} · status ${region.status} (${region.status_reason || '—'}) · bbox ${region.bbox.join(', ')}` }),
    h('dt', { text: 'unit' }), h('dd', { text: `${series.unit.label} · ${series.daynight === 'D' ? 'daytime overpasses' : series.daynight === 'N' ? 'night overpasses' : 'day + night'} · filter ${series.filter_id}` }),
    // SQ-03: the manifest's Strategy A sentence describes the S-NPP regions' stored record; NOAA-20 areas store observed Aqua only
    h('dt', { text: 'strategy' }), h('dd', { text: region.m2
      ? `${series.strategy_id} · the stored record here is observed Aqua only: no month is filled from VIIRS. How each month is assembled is shown per month.`
      : `${series.strategy_id} · ${st ? st.status : '?'}${st && st.summary ? ` · ${st.summary}` : ''} This page shows measured Aqua only; the stored gap estimates appear only on the VIIRS layer. Nothing assumes a fixed splice year.` }),
    h('dt', { text: 'held out' }), h('dd', { text: (region.held_out_years || []).join(', ') || 'none' }),
    h('dt', { text: 'trained on' }), h('dd', { text: region.m2 ? 'each year was predicted by a fit on the other years of the window (leave-one-year-out)' : (region.trained_on_years || []).join(', ') || 'none' }),
    ...ml.flatMap((mm) => [h('dt', { text: 'method' }), h('dd', { text: `${mm.label} · ${mm.id} v${mm.version} · ${mm.value_kind} · ${mm.status}` })]),
    h('dt', { text: 'baseline' }), h('dd', { text: envSource === 'export' ? `usual month = exported baseline (${series.baseline.platform}, era ${series.baseline.era}, ${baseLabel}, ${series.baseline.quantile_method} quantiles); verdict rule ${series.verdict_rule ? series.verdict_rule.id : '—'} from the export` : `usual month = observed Aqua in era “modis_only” (${baseLabel}); computed in the browser (no exported baseline)` }),
    h('dt', { text: 'latest' }), h('dd', { text: `standard archive to ${region.latest_standard_month || '—'}; newest ${region.latest_month || '—'} (later months may be near-real-time)` }),
    h('dt', { text: 'eras' }), h('dd', { text: (manifest.eras || []).map((e) => `${e.id} from ${e.start} (boundary ${e.boundary_status}${e.basis && !/⟨/.test(e.basis) ? `: ${e.basis}` : ''})`).join(' · ') }),
    h('dt', { text: 'dataset' }), h('dd', { text: `${series.dataset_version} · contract ${series.contract_version} · ${series.kind}` }),
    ...(series.notes || []).flatMap((n) => [h('dt', { text: 'note' }), h('dd', { text: n })]),
    ...((region.audit_flags || series.audit_flags || []).flatMap((f) => { const a = formatAuditFlag(f); return [h('dt', { text: `audit · ${a.state}` }), h('dd', { text: a.detail ? `${a.title} · ${a.detail}` : a.title })]; })));
}

/** The whole record as a table (every lane), built on demand. */
export function fullTable(S) {
  const { months, region, series, lanes } = S;
  const ruler = S.state.ruler;
  const cols = ['Month', 'Era', 'Split', 'Aqua-scale value', 'Likely range', 'Source', 'Verdict', ...PLATFORMS.map((p) => `${PLATFORM_LABEL[p]} own count`), 'Detailed model (not adopted)', 'Ratio', 'Quality'];
  const body = months.map((r) => {
    const v = rulerValue(r, ruler, lanes.alt); const vd = ruler === 'raw' ? null : monthVerdict(r, ruler, S.env, lanes.alt).cls;
    return h('tr', {}, h('th', { scope: 'row', text: r.month }), h('td', { text: r.era || '' }), h('td', { text: r.held_out ? 'held out †' : r.split }),
      h('td', { class: 'num', text: ruler === 'raw' ? '—' : fmtN(v.value, 1) }), h('td', { class: 'num', text: ruler === 'raw' ? '' : fmtInterval(v.lo, v.hi) || '' }),
      h('td', { text: RECORD_SOURCE_WORD[recordSource(r)] }), h('td', { text: vd ? VERDICT[vd].word : 'no verdict' }),
      ...PLATFORMS.map((p) => { const st = nativeStatus(r, p); return h('td', { class: st === 'observed' ? 'num' : '', text: st === 'observed' ? fmtN(nativeN(r, p)) : NATIVE_STATUS_WORD[st] }); }),
      ...['aqua_equiv_operator', 'aqua_equiv_ratio'].map((k) => { const m = r.modelled && r.modelled[k]; return h('td', { class: 'num', text: m && m.status === 'estimated' ? `${fmtN(m.value, 1)}${fmtInterval(m.lo, m.hi) ? ` [${fmtInterval(m.lo, m.hi)}]` : ''}` : m ? m.status.replace(/_/g, ' ') : '—' }); }),
      h('td', { text: (r.quality || []).filter((f) => f !== 'fixture').join('; ') }));
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
    h('caption', { text: `${region.name}: every month, ${series.unit.label}. Each satellite’s own count is on its own scale.` }),
    h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', { scope: 'col', text: c })))), h('tbody', {}, ...body)));
}

/** The "Method details" block under the region page. `extras` are the timeline's overpass panel and dates table. */
export function advancedSection(S, extras = []) {
  const tableBox = h('div', {});
  const tableDetails = h('details', { class: 'more', ontoggle: () => { if (tableDetails.open && !tableBox.childElementCount) tableBox.append(fullTable(S)); } },
    h('summary', { text: 'The whole record as a table' }), tableBox);
  S.onRepaint(() => { if (tableBox.childElementCount) tableBox.replaceChildren(fullTable(S)); });
  return h('details', { class: 'adv', id: 'for-scientists', open: open(S) },
    h('summary', {}, h('span', { class: 'adv-title', text: 'Method details' }), h('span', { class: 'caption', text: ' method, provenance, audit checks, overpass times and the full table' })),
    h('div', { class: 'adv-body' },
      h('section', { 'aria-labelledby': 'prov-h' }, h('h2', { class: 'section-title', id: 'prov-h', text: 'Provenance and method' }), provenance(S)),
      ...extras, tableDetails));
}
