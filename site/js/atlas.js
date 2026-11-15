// Map view: the map itself is the persistent stage (stage.js). This module renders what sits under it: the notes on
// what the shading measures, its coverage and its limits. Every period, day/night and threshold comes from the layer.
import { regionStatusWords } from './core.js';
import { loadBelt } from './data.js';
import { h, fmtN } from './ui.js';
import { initStage, mapUnitLabel } from './stage.js';
import { recordSpan } from './story.js';

export { regionStatusWords };

export async function renderAtlas(ctx) {
  const { manifest } = ctx;
  const L = await initStage(manifest).catch(() => null);
  const root = h('div', { class: 'view-enter atlas atlas-under' });
  const span = manifest.partial ? null : recordSpan(manifest);
  if (!L) {
    const b = await loadBelt(manifest).catch(() => ({ state: 'error' }));
    root.append(h('p', { class: 'caption', text: b.state === 'pending' ? 'The map layer is not published yet: land outlines only.' : 'The map layer could not be read: land outlines only, no values drawn.' }));
    return root;
  }
  const p = L.period; const yrs = `${p.start.slice(0, 4)}–${p.end.slice(0, 4)}`;
  const day = L.daynight === 'D' ? 'daytime' : L.daynight === 'DN' ? 'day and night combined' : L.daynight;
  const src = L.monthly ? L.bm : L.belt;
  root.append(h('details', { class: 'atlas-notes more' },
    h('summary', { text: 'About this map: what the shading counts, and its limits' }),
    h('p', {}, h('b', { text: 'What it counts. ' }), `${mapUnitLabel() || 'Aqua MODIS detections per 1,000 km² of land'}. ${L.monthly ? 'Pick a calendar month below the map, or “All year” (per year).' : ''} A detection is a satellite pixel (about 1 km across at the centre of the swath, larger at the edges) flagged hot when Aqua passed over: not a fire count, burned area or damage estimate.`),
    h('p', {}, h('b', { text: 'One satellite, nothing converted. ' }), `Aqua MODIS alone, ${day}, ${yrs}. Terra is left out (a different overpass time). This is the yardstick the region pages compare with; it is not harmonized with VIIRS.`),
    h('p', {}, h('b', { text: 'A typical month, not a date. ' }), `Each month is the ${yrs} average for that calendar month${span ? `; the record itself runs ${span.long.replace(/^Record: /, '').replace(/\.$/, '')}` : ''}. Calendar months are UTC months of 28–31 days; values are not adjusted per day.`),
    L.monthly ? h('p', {}, h('b', { text: 'Sparse cells. ' }), `Pale cells rest on fewer than ${L.sparseRule.min_total} detections, or were seen in ${L.sparseRule.max_years_seen} or fewer of ${L.nYears} years: one big year can dominate a ${L.nYears}-year average. “Sparse” means few detections or few years, not low activity.`) : null,
    h('p', {}, h('b', { text: 'Coverage. ' }), `Only cells with at least ${fmtN(L.belt.grid.min_land_km2)} km² of land are drawn; ocean and slivers of coast are blank (no data), never zero. A flat grey cell means no detections were reported there: that is not proof that nothing burned. FIRMS assigns detections to countries, so offshore and some coastal detections are missing.`),
    h('p', { class: 'prov', text: `${src.file} · ${src.platform} · ${p.start}..${p.end} (${p.n_years} yr) · ${src.daynight} · filter ${src.filter_id} · ${src.grid.resolution_deg}° ${src.grid.anchor} · contract ${src.contract_version} · dataset ${src.dataset_version}${L.monthly ? ` · aligned to ${L.bm.aligned_to.path} (${L.bm.aligned_to.n_cells} cells)` : ''} · land mask: ${L.belt.grid.land_source}` })));
  return root;
}
