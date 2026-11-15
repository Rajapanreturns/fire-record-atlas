// Router: URL query is the only state (view, region, compare, mode, ruler, month, data, validation). Works with back/forward.
// Legacy ?ruler= links are rewritten once: raw -> compare=1; alt/operator/ratio -> compare=1 + mode=advanced + ruler=alt (mode=advanced is now ignored).
import { loadManifest, anyFixture, fixtureWatermark, dataBase } from './data.js';
import { h, errorBox, openTo, linkHash, withHash, rewriteNavLinks } from './ui.js';
import { renderAtlas } from './atlas.js';
import { renderRegion } from './region.js';
import { renderTrust } from './trust.js';
import { glossary, recordSpan } from './story.js';
import { baselinePeriodLabel, yearOf } from './core.js';
import { createStage, initStage, parkStage, showStage, stop as stopPlay } from './stage.js';
import { parseCal } from './monthly.js';
import { m2Glossary } from './m2.js';
import { trustLinkRegion, resolveTrustRegion } from './trustctx.js';
import { carryMonth, navParamsFromHref } from './nav.js';
let navManifest = null; // the last loaded manifest, so masthead links carry only ids that resolve (A1)

const main = document.getElementById('main');
const stageHome = document.getElementById('stage-home');
if (stageHome) createStage(stageHome);
const banners = document.getElementById('banners');
const KEEP = ['data', 'validation', 'mode'];
const session = { lastRegion: null, fromAtlas: false, renderId: 0 };

export function urlFor(params) {
  const cur = new URLSearchParams(location.search);
  const next = new URLSearchParams();
  for (const k of KEEP) if (cur.get(k)) next.set(k, cur.get(k));
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') next.set(k, v);
  return `?${next.toString()}`;
}

export function navigate(params, { replace = false, fromAtlas = false, hash = '' } = {}) {
  session.fromAtlas = fromAtlas;
  const url = withHash(urlFor(params), hash);
  if (replace) history.replaceState({ fromAtlas }, '', url); else history.pushState({ fromAtlas }, '', url);
  route();
}

/** Update URL state without re-rendering (ruler, selected month). Keeps the #hash (R7) and refreshes masthead hrefs (R3). */
export function setParams(patch) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) { if (v == null) p.delete(k); else p.set(k, v); }
  history.replaceState(history.state, '', `?${p.toString()}${location.hash || ''}`);
  updateNav(currentParamsRaw().view);
}

/** Rewrite legacy ruler links in place (no history entry). */
function normalizeLegacy() {
  const p = new URLSearchParams(location.search);
  const r = p.get('ruler');
  if (!r) return;
  if (r === 'raw') { p.set('compare', '1'); p.delete('ruler'); }
  else if (['alt', 'operator', 'ratio'].includes(r)) { p.set('compare', '1'); p.set('mode', 'advanced'); p.set('ruler', 'alt'); }
  else p.delete('ruler');
  history.replaceState(history.state, '', `?${p.toString()}`);
}

// The former "For scientists" switch was removed (user request); old ?mode=advanced links simply open the plain view.
export const isAdvanced = () => false;

function currentParams() {
  normalizeLegacy();
  const p = new URLSearchParams(location.search);
  const view = ['atlas', 'region', 'trust'].includes(p.get('view')) ? p.get('view') : 'atlas';
  return { view, region: p.get('region'), tm: p.get('tm'), rev: p.get('rev') === '1', ruler: p.get('ruler'), month: p.get('month'), cal: parseCal(p.get('cal')), all: p.get('all'), detail: p.get('detail') === '1', step: p.get('step'), compare: p.get('compare') === '1', science: p.get('science') === '1', pick: p.get('pick'), at: p.get('at'), machine: p.get('machine') === '1', stage: p.get('stage'), walk: p.get('walk') };
}

function currentParamsRaw() {
  const p = new URLSearchParams(location.search);
  return { view: ['atlas', 'region', 'trust'].includes(p.get('view')) ? p.get('view') : 'atlas', region: p.get('region'), month: p.get('month'), cal: parseCal(p.get('cal')) };
}

/** Where a masthead link goes from the current page, with the month carried (R2, R3); computed again at click time. */
function mastheadTarget(a) {
  const cur = currentParamsRaw();
  const trustRegion = trustLinkRegion(cur, session.lastRegion, navManifest);
  const v = a.dataset.nav;
  if (v === 'region' && session.lastRegion) return { view: 'region', region: session.lastRegion, ...(cur.view === 'atlas' || cur.region === session.lastRegion ? carryMonth(cur, 'region') : {}) };
  if (v === 'trust' && (a.dataset.region || trustRegion)) { const r = a.dataset.region || trustRegion; return { view: 'trust', region: r, ...(cur.region === r ? carryMonth(cur, 'trust') : {}) }; }
  return { view: v, ...carryMonth(cur, v) };
}

function updateNav(view) {
  const skip = document.querySelector('.skip');
  if (skip) skip.href = '#main';
  // masthead links only: in-page links (e.g. "Every test month →" with #decades) keep their own href and hash
  // M4.3: the masthead "Can we trust it?" link carries the region being looked at (region page, or Trust's own region)
  rewriteNavLinks(document, view, mastheadTarget, urlFor);
}

export function updateBanners(manifest, view = null, regionId = null) {
  banners.replaceChildren();
  if (anyFixture()) {
    banners.append(h('div', { class: 'banner banner-fixture', role: 'note' },
      h('strong', { text: 'Fixture' }), h('span', { text: `${fixtureWatermark()}. Every number on this page is synthetic test data.` })));
  }
  // One plain line on region pages; the strategy wording lives in the region's "Method details" provenance.
  const line = null; // M1.3: the region chip carries this; no site-wide banner on region pages
  if (line) {
    banners.append(h('div', { class: 'banner banner-plain', role: 'note' }, h('span', { text: `${line} ` }),
      h('a', { href: urlFor({ view: 'trust', region: regionId || undefined }), 'data-nav': 'trust', 'data-region': regionId || '', text: 'How we checked →' })));
  }
  if (manifest && manifest.partial) {
    banners.append(h('div', { class: 'banner', role: 'note' }, h('strong', { text: 'Partial build' }),
      h('span', { text: 'The dataset manifest is not published yet, so no regions, methods or sources are listed. Only the global layer is shown.' })));
  }
  const prov = document.getElementById('colophon-prov');
  if (prov && manifest && !manifest.partial) {
    const groups = new Map();
    for (const x of manifest.sources || []) {
      const k = `${x.sensor}/${x.platform} · ${x.product || '?'} · v${x.version ?? '?'} · archive ${x.archive}`;
      if (!groups.has(k)) groups.set(k, { years: [], retrieved: new Set() });
      groups.get(k).years.push(...(x.years || [])); groups.get(k).retrieved.add(x.retrieved || '?');
    }
    const srcs = [...groups.entries()].map(([k, g]) => { const y = g.years.sort(); return `${k} · years ${y.length ? `${y[0]}–${y[y.length - 1]} (${y.length} files)` : '?'} · retrieved ${[...g.retrieved].join('/')}`; });
    prov.replaceChildren(`dataset ${manifest.dataset_version} · built ${manifest.build_time || '?'} · contract ${manifest.contract_version} · data dir “${dataBase()}”`,
      h('details', {}, h('summary', { text: `Sources (${srcs.length} groups of FIRMS yearly archives)` }), h('ul', { class: 'src-list' }, ...srcs.map((x) => h('li', { text: x })))));
  }
}

async function route() {
  const id = ++session.renderId;
  const params = currentParams();
  updateNav(params.view);
  let manifest;
  try {
    manifest = await loadManifest();
  } catch (e) {
    if (id !== session.renderId) return;
    // No manifest yet. The atlas can still show the global Aqua layer if it has been published on its own.
    if (e.kind === 'missing' && params.view === 'atlas') {
      manifest = { partial: true, regions: [], methods: [], eras: [], sources: [], strategy: null,
        global_layers: [{ id: 'belt', path: 'global/belt.json', status: 'available' }] };
    } else {
      main.replaceChildren(noData(e));
      updateBanners(null);
      return;
    }
  }
  if (id !== session.renderId) return;
  navManifest = manifest;
  // A4: the masthead "Regions" link follows the region shown on Trust
  if (params.view === 'trust' && params.region && !manifest.partial && resolveTrustRegion(params.region, manifest).mode === 'region') session.lastRegion = params.region;
  const ctx = {
    manifest, params, session, navigate, setParams, urlFor, isCurrent: () => id === session.renderId,
    // the map's month travels to the region as cal= (converted there by a stated rule, R2)
    openRegion(regionId, { cal = 0 } = {}) { session.lastRegion = regionId; navigate({ view: 'region', region: regionId, cal: cal >= 1 && cal <= 12 ? String(cal) : null }, { fromAtlas: true }); },
    backToAtlas() {
      if (history.state && history.state.fromAtlas) history.back(); else navigate({ view: 'atlas', ...carryMonth(currentParamsRaw(), 'atlas') });
    },
  };
  const fromAtlas = session.fromAtlas; session.fromAtlas = false;
  ctx.fromAtlas = fromAtlas;
  try {
    let node;
    if (params.view === 'region') {
      const regionId = params.region || (manifest.regions.find((r) => r.role === 'pilot') || manifest.regions[0] || {}).id;
      session.lastRegion = regionId || session.lastRegion;
      node = await renderRegion(ctx, regionId);
    } else if (params.view === 'trust') node = await renderTrust(ctx, params.region);
    else node = await renderAtlas(ctx);
    // F1: a superseded render releases its own listeners before it is dropped
    if (id !== session.renderId) { if (node && node.__teardown) node.__teardown(); return; }
    // F6: entering or leaving the Time Machine counts as a view change (scroll to top)
    const viewKey = `${params.view}|${params.region}|${params.machine ? 'm' : ''}`;
    const viewChanged = session.lastView !== viewKey;
    session.lastView = viewKey;
    parkStage();
    // the outgoing view releases its document listeners, observers and animation frames (region.js __teardown)
    for (const prev of main.children) if (prev.__teardown) prev.__teardown();
    main.replaceChildren(node);
    if (viewChanged) window.scrollTo(0, 0);
    updateBanners(manifest, params.view, session.lastRegion);
    updateNav(params.view);
    updateChrome(manifest, params);
    if (stageHome && !manifest.partial) initStage(manifest);
    if (params.view === 'atlas') {
      showStage('world', { ctx, cal: params.cal });
      document.querySelector('.skip').href = '#stage-home';
    }
    else if (params.view === 'region' && node.__stageSlot) showStage('region', { ctx, region: node.__region, slot: node.__stageSlot });
    else { stopPlay(); showStage('hidden', { ctx }); }
    if (node.__afterMount) node.__afterMount();
    // a #hash target inside closed <details> (Trust explorer, region optional tool) is opened before scrolling
    if (viewChanged && location.hash.length > 1) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) { openTo(t); requestAnimationFrame(() => t.scrollIntoView({ block: 'start' })); } }
    document.title = `${{ atlas: 'Map', region: 'Region', trust: 'Can we trust it?' }[params.view]} · Fire Record Atlas`;
  } catch (e) {
    console.error(e);
    if (id !== session.renderId) return;
    main.replaceChildren(errorBox('This view could not be drawn', e, 'Nothing has been substituted for the missing data.'));
    updateBanners(manifest);
  }
}

/** Glossary (from data facts) and the record stamp, in the masthead on every page. */
let glossaryFor = null;
function updateChrome(manifest, params) {
  const list = document.getElementById('glossary-list');
  if (list && manifest && glossaryFor !== manifest) {
    glossaryFor = manifest;
    const regions = manifest.regions || [];
    const heldOut = [...new Set(regions.flatMap((r) => r.held_out_years || []))].sort((a, b) => a - b);
    const modis = (manifest.eras || []).find((e) => e.id === 'modis_only');
    const drift = (manifest.eras || []).find((e) => e.id === 'aqua_drift');
    const base = modis ? baselinePeriodLabel(null, [{ years: [yearOf(modis.start) + (modis.start.endsWith('-01') ? 0 : 1), yearOf(modis.end)] }]) : null;
    const facts = { heldOut, baseline: base, driftFrom: drift && yearOf(drift.start) };
    const m2g = m2Glossary(manifest);
    list.replaceChildren(...[...glossary(facts), ...(m2g ? [m2g] : [])]
      .flatMap((g) => [h('dt', {}, g.term, g.also ? h('span', { class: 'also', text: ` (${g.also})` }) : ''), h('dd', {}, h('span', { class: 'plain', text: g.plain }), ' ', h('span', { class: 'precise', text: g.precise }))]));
  }
  const stamp = document.getElementById('record-stamp');
  const sp = manifest && !manifest.partial ? recordSpan(manifest) : null;
  if (stamp) { stamp.textContent = sp ? sp.stamp : ''; stamp.hidden = !sp; if (sp) stamp.title = sp.long; }
}

function noData(e) {
  return h('section', { class: 'empty-state' },
    h('h1', { class: 'section-title', text: 'No published record yet' }),
    h('p', { text: `The site could not read ${dataBase()}/manifest.json (${e.detail || e.message}).` }),
    h('p', { class: 'caption', text: 'Real data is written to site/data/ by “make site-data”. For development only, synthetic fixtures can be viewed with ?data=data-fixtures; they are watermarked and are not NASA data.' }),
    h('p', {}, h('a', { href: '?view=atlas&data=data-fixtures', text: 'View the synthetic fixtures' })));
}

const glossaryPanel = document.getElementById('glossary');
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && glossaryPanel?.open) {
    glossaryPanel.open = false;
    glossaryPanel.querySelector('summary').focus();
  }
});
document.addEventListener('click', (ev) => {
  if (glossaryPanel?.open && !glossaryPanel.contains(ev.target)) glossaryPanel.open = false;
});

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-nav]');
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
  ev.preventDefault();
  const v = a.dataset.nav;
  const hash = linkHash(a.getAttribute('href')); // carried through pushState (B1)
  // R1: masthead links are computed now from the current page; any other in-app link goes exactly where its href says
  if (a.closest('.masthead')) { navigate(mastheadTarget(a), { hash }); return; }
  const target = navParamsFromHref(a.getAttribute('href'), location.href) || {};
  if (!target.view) target.view = v;
  if (v === 'trust' && !target.region && a.dataset.region) target.region = a.dataset.region;
  if (v === 'region' && !target.region && session.lastRegion) target.region = session.lastRegion;
  navigate(target, { hash });
});
window.addEventListener('popstate', () => { session.fromAtlas = false; route(); });
route();
