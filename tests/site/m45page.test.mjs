// M4.5 steps 5–6: Trust routing (table), the region page = its Time Machine, lazy evidence, the mini-map + select, the sidebar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as T from '../../site/js/trustctx.js';
import * as MM from '../../site/js/minimap.js';
import { sidebarLine } from '../../site/js/stage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = path.join(ROOT, 'site/data');
const hasReal = existsSync(path.join(REAL, 'manifest.json'));
const man = hasReal ? JSON.parse(readFileSync(path.join(REAL, 'manifest.json'), 'utf8')) : null;
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('trustRoute: one routing table for every Trust URL, old deep links included', { skip: !hasReal }, () => {
  const R = (params, hash = '') => T.trustRoute(params, hash, man);
  const def = man.m2_regions.find((r) => r.status === 'validated').id;
  assert.equal(def, 'se_asia_mainland', 'the default comes from data (first validated NOAA-20 area)');
  const table = [
    [{}, '', { mode: 'machine', id: def, normalise: { region: def, machine: null }, openEvidence: false }],
    [{ machine: true }, '', { mode: 'machine', id: def, normalise: { region: def, machine: null }, openEvidence: false }],
    [{}, '#evidence', { mode: 'machine', id: def, normalise: { region: def, machine: null }, openEvidence: true }], // G2
    [{}, '#decades', { mode: 'all' }], [{}, '#tests', { mode: 'all' }], [{}, '#science', { mode: 'all' }], [{}, '#pr-h', { mode: 'all' }],
    [{ science: true }, '', { mode: 'all' }], [{ pick: 'punjab_haryana' }, '', { mode: 'all' }], [{ step: '2' }, '', { mode: 'all' }],
    [{ region: 'all' }, '', { mode: 'all' }],
    [{ region: 'punjab_haryana' }, '', { mode: 'machine', id: 'punjab_haryana', normalise: null, openEvidence: false }],
    [{ region: 'punjab_haryana', machine: true }, '', { mode: 'machine', id: 'punjab_haryana', normalise: { machine: null }, openEvidence: false }],
    [{ region: 'se_asia_mainland' }, '#decades', { mode: 'machine', id: 'se_asia_mainland', normalise: null, openEvidence: true }],
    [{ region: 'car_sudanian' }, '#tests', { mode: 'machine', id: 'car_sudanian', normalise: null, openEvidence: true }],
    [{ region: 'car_sudanian' }, '#evidence', { mode: 'machine', id: 'car_sudanian', normalise: null, openEvidence: true }],
    [{ region: 'zambia_miombo', science: true }, '', { mode: 'machine', id: 'zambia_miombo', normalise: null, openEvidence: true }],
    [{ region: 'n_california' }, '', { mode: 'unknown', raw: 'n_california' }],
    [{ region: 'yakutia_boreal', machine: true }, '', { mode: 'unknown', raw: 'yakutia_boreal' }],
    [{ region: 'custom', at: '31.6,74.9' }, '', { mode: 'custom', at: { lat: 31.6, lon: 74.9 } }],
  ];
  for (const [p, hsh, want] of table) assert.deepEqual(R(p, hsh), want, `${JSON.stringify(p)} ${hsh}`);
});

test('D4: nine regions west -> east by bbox centre (from data); select options name status AND the test (QA Q2)', { skip: !hasReal }, () => {
  const we = T.westEast(man);
  assert.deepEqual(we.map((x) => x.id), ['argentina_chaco_parana', 'cerrado_tocantins', 'iberia_control', 'car_sudanian', 'zambia_miombo', 'kazakh_steppe', 'punjab_haryana', 'se_asia_mainland', 'n_australia_topend']);
  assert.ok(we.every((x, i) => i === 0 || we[i - 1].cx <= x.cx));
  assert.equal(T.regionOptionText(we.find((x) => x.id === 'punjab_haryana')), 'Punjab-Haryana · ◐ Provisional · S-NPP test');
  assert.equal(T.regionOptionText(we.find((x) => x.id === 'se_asia_mainland')), 'Mainland SE Asia · ✓ Validated · NOAA-20 test');
  for (const x of we.filter((y) => y.test === 'm1')) assert.doesNotMatch(T.regionOptionText(x), /NOAA-20/, 'never NOAA-20 for an S-NPP region');
  assert.ok(!we.some((x) => /n_california|yakutia/.test(x.id)), 'withheld regions are never listed');
  const t = src('site/js/trust.js');
  assert.match(t, /h\('option', \{ value: ALL, text: 'Full scientific evidence \(all regions\)' \}\)/);
});

test('sidebar (D4, QA Q2): one list, name + chip + one quiet line naming the test and its period', { skip: !hasReal }, () => {
  const we = T.westEast(man);
  const byId = Object.fromEntries([...man.regions, ...man.m2_regions].map((r) => [r.id, r]));
  assert.equal(sidebarLine(byId.se_asia_mainland, we.find((x) => x.id === 'se_asia_mainland')), 'NOAA-20 test · 2018–2021');
  assert.equal(sidebarLine(byId.punjab_haryana, we.find((x) => x.id === 'punjab_haryana')), `S-NPP test · hidden years ${byId.punjab_haryana.held_out_years.join(', ')}`);
  const s = src('site/js/stage.js');
  assert.match(s, /S\.chips\.replaceChildren\(h\('ul', \{ class: 'st-chips', 'aria-label': 'Study regions, west to east' \}, \.\.\.westEast\(S\.manifest\)\.map\(chipItem\)\)\);/);
  assert.doesNotMatch(s, /Tested against the 2000s/);
});

test('mini-map: true boxes, nearest-centre hit rule capped at 25°, every region reachable, ocean selects nothing', { skip: !hasReal }, () => {
  const L = MM.miniLayout(man, 320);
  assert.equal(L.height, Math.round(135 * (320 / 360)), 'cropped to 60°S–75°N');
  for (const r of L.regions) {
    const [w, s, e, n] = r.bbox;
    assert.ok(Math.abs(r.x - (w + 180) * L.k) < 1e-9 && Math.abs(r.w - (e - w) * L.k) < 1e-9 && Math.abs(r.y - (75 - n) * L.k) < 1e-9, `${r.id}: the true box`);
    assert.equal(MM.nearestAt(L, r.px, r.py).id, r.id, `${r.id}: its own centre selects it`);
  }
  // open ocean selects nothing (mid-Pacific, South Atlantic far from Chaco)
  assert.equal(MM.nearestAt(L, L.X(-150), L.Y(0)), null);
  assert.equal(MM.nearestAt(L, L.X(-20), L.Y(-50)), null);
  // the closest pair (Chaco - Cerrado): each still gets a target of at least 8 px radius around its centre at 320 px (centres ~17 px apart; the Voronoi cells extend far outward)
  const ch = L.regions.find((r) => r.id === 'argentina_chaco_parana'); const ce = L.regions.find((r) => r.id === 'cerrado_tocantins');
  for (let a = 0; a < 360; a += 30) { const dx = Math.cos(a * Math.PI / 180) * 8; const dy = Math.sin(a * Math.PI / 180) * 8; assert.equal(MM.nearestAt(L, ch.px + dx, ch.py + dy).id, ch.id); assert.equal(MM.nearestAt(L, ce.px + dx, ce.py + dy).id, ce.id); }
  const m = src('site/js/minimap.js');
  assert.match(m, /'aria-hidden': 'true'/, 'the SVG is decorative; the paired select is the accessible control');
  assert.match(m, /ArrowLeft: kb - 1/); assert.match(m, /ev\.key === 'Enter'/);
  assert.match(m, /teardown: \(\) => ac\.abort\(\)/);
  assert.doesNotMatch(m.replace(/http:\/\/www\.w3\.org\/\d+\/svg/g, ''), /\b(19|20)\d\d\b/);
});

test('region page: Evidence built on first open (reveal integrity); Esc / "Explore the evidence" open it in place; teardowns composed', () => {
  const t = src('site/js/trust.js');
  assert.match(t, /evidence\.addEventListener\('toggle', \(\) => \{ if \(evidence\.open\) buildEvidence\(\); \}\);/);
  assert.match(t, /function buildEvidence\(\) \{\n    if \(built\) return; built = true;/);
  assert.match(t, /const \[picker, tm\] = await Promise\.all\(\[regionPicker\(ctx, manifest, f\.id\), machineFor\(ctx, manifest, val, m2val, f\.id, \{ onEvidence: \(\) => openEvidence\(\) \}\)\]\);/); // G4
  assert.match(t, /root\.__teardown = \(\) => \{ if \(tm && tm\.__teardown\) tm\.__teardown\(\); if \(explorer && explorer\.el\.__teardown\) explorer\.el\.__teardown\(\); picker\.teardown\(\); \};/);
  assert.match(t, /if \(route\.normalise\) ctx\.setParams\(route\.normalise\);/);
  assert.doesNotMatch(t, /function m1RegionReveal|async function guided\(/, 'dead code removed');
  const mj = src('site/js/machine.js');
  assert.match(mj, /ev\.preventDefault\(\); opts\.onEvidence\(\);/);
});

test('G1: before the reveal, the model and axis are independent of Aqua’s value, for all 359 test months', { skip: !hasReal }, async () => {
  const TC = await import('../../site/js/trustcase.js'); const MC = await import('../../site/js/machine.js');
  const read = (p) => JSON.parse(readFileSync(path.join(REAL, p), 'utf8'));
  const val = read('validation.json'); const m2 = read('m2_validation.json');
  let n = 0;
  for (const r of [...man.m2_regions, ...man.regions]) {
    const series = man.regions.includes(r) ? read(r.series_path || `region/${r.id}/series.json`) : null;
    const rc = TC.regionCase(r.id, { manifest: man, val, m2val: m2, series });
    for (const t of rc.months) {
      const a = MC.machineModel(t); const b = MC.machineModel({ ...t, actual: (t.actual || 0) * 1000 + 999999, side: 'above' });
      const strip = (m) => JSON.stringify({ ...m, pct: undefined });
      assert.equal(strip(a), strip(b), `${r.id} ${t.month}`);
      assert.equal(a.actual, null); assert.equal(a.side, null); assert.equal(a.apart, null);
      n += 1;
    }
  }
  assert.equal(n, 359);
  const pj = MC.machineModel({ raw: 10, est: 5, lo: 2, hi: 8, envLo: 1, envHi: 9, actual: 22, side: 'above', mi: 7, year: 2016 });
  assert.ok(pj.axis.max < 22, 'a larger Aqua value no longer stretches the pre-reveal axis');
});

test('review batch: GD-01 note, F1/F2 strings, M1 rail order, M3 neutral key, M4 closed select shows the name, N4', async () => {
  const S = await import('../../site/js/story.js');
  assert.equal(S.regionGeoNote('argentina_chaco_parana', '2003–2011'), 'Box spans Paraguay and Argentina (about 60% of its Aqua 2003–2011 detections are in Paraguay).');
  assert.equal(S.regionGeoNote('se_asia_mainland', '2003–2011'), null);
  const t = src('site/js/trust.js'); const r = src('site/js/region.js'); const st = src('site/js/stage.js'); const mj = src('site/js/machine.js'); const d = src('site/js/decades.js');
  assert.match(t, /const geo = regionGeoNote\(f\.id,/); assert.match(r, /regionGeoNote\(region\.id, baseLabel\)/);
  assert.doesNotMatch(st, /REGION_GEO_NOTE|regionGeoNote/, 'not in the sidebar entry');
  assert.match(d, /'Open in this area’s Time Machine →'/); assert.doesNotMatch(d, /Open in Predict, then reveal/);
  assert.doesNotMatch(t, /walk-through, every month/);
  assert.ok(mj.indexOf("h('div', { class: 'tm-top' }, rail),\n    kicker,") > 0, 'M1: the rail sits directly above the month line');
  assert.doesNotMatch(st, /thick box/); assert.match(st, /'study region · its test and status are in the list'/);
  assert.match(t, /class: 'tm-sel-name', text: cur \? cur\.name : 'Choose a study region'/);
  assert.match(mj, /text: 'Monthly record →'/);
  assert.match(t, /footer: \{ visible: m1Limits\(f, PROVISIONAL_NOTE\)\.visible, more: \[\] \}/, 'N2: no nested "More limits"');
});

test('home fix: the latitude heatmap uses the globe’s colour family, monotonic; zero hollow, empty band hatched; key says share', async () => {
  const { BAND_RAMP } = await import('../../site/js/stage.js');
  const V = await import('../../site/js/viz.js');
  const st = src('site/js/stage.js');
  const ochre = st.match(/const OCHRE = \[([^\]]+)\]/)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(BAND_RAMP, ochre.slice(1), 'the globe and flat map NON-zero density colours; OCHRE[0] (none reported) is never a positive share');
  const L = BAND_RAMP.map(V.luminance);
  assert.ok(L.every((x, i) => i === 0 || x > L[i - 1]), 'monotonic: low dark, high bright');
  assert.match(st, /fill: 'none', stroke: VIZ\.dim/, 'a zero share stays a hollow cell');
  assert.match(st, /fill: 'url\(#pat-hatch\)', opacity: 0\.5/, 'an empty band stays hatched');
  assert.match(st, /'share of the band’s detections'/);
  assert.match(st, /shares within a row, not amounts, so not the map’s density scale/);
  assert.doesNotMatch(st, /Brighter cells show/);
});
