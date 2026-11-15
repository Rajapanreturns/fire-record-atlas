// M4.3 region-aware Trust: URL contract, per-region facts read from STORED results only (validation.json /
// m2_validation.json), the per-region example-month rules, pooled-only measures, copy rules.
// Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as T from '../../site/js/trustctx.js';
import * as M from '../../site/js/m2.js';
import * as S from '../../site/js/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const man = read('site/data/manifest.json');
const val = read('site/data/validation.json');
const m2 = read('site/data/m2_validation.json');
const M1_IDS = man.regions.filter((r) => ['validated', 'provisional'].includes(r.status)).map((r) => r.id);
const M2_IDS = m2.regions.map((r) => r.region_id);

test('switcher groups: All + the nine regions, M2 then M1; nothing withheld or explore-only listed', () => {
  const g = T.trustRegionGroups(man);
  assert.deepEqual(g.map((x) => x.id), ['m2', 'm1']);
  assert.deepEqual(g[0].regions.map((r) => r.id), M2_IDS);
  assert.deepEqual(g[1].regions.map((r) => r.id), M1_IDS);
  assert.equal(M2_IDS.length + M1_IDS.length, 9);
  for (const r of [...g[0].regions, ...g[1].regions]) assert.ok(!['n_california', 'yakutia_boreal'].includes(r.id));
});

test('URL contract: all/absent, region ids, unknown ids, custom places; masthead carries the region', () => {
  assert.deepEqual(T.resolveTrustRegion(null, man), { mode: 'all' });
  assert.deepEqual(T.resolveTrustRegion('all', man), { mode: 'all' });
  for (const id of [...M1_IDS, ...M2_IDS]) assert.equal(T.resolveTrustRegion(id, man).mode, 'region');
  assert.equal(T.resolveTrustRegion('kazakh_steppe', man).group, 'm2');
  assert.equal(T.resolveTrustRegion('punjab_haryana', man).group, 'm1');
  assert.deepEqual(T.resolveTrustRegion('atlantis', man), { mode: 'unknown', raw: 'atlantis' });
  assert.deepEqual(T.resolveTrustRegion('custom', man, '14.2,101.3'), { mode: 'custom', at: { lat: 14.2, lon: 101.3 } });
  assert.deepEqual(T.resolveTrustRegion('custom', man, '200,5'), { mode: 'custom', at: null });
  assert.deepEqual(T.trustParams('all'), { view: 'trust', region: undefined, at: undefined });
  assert.equal(T.trustParams('iberia_control').region, 'iberia_control');
  assert.equal(T.trustLinkRegion({ view: 'region', region: 'zambia_miombo' }), 'zambia_miombo');
  assert.equal(T.trustLinkRegion({ view: 'trust', region: 'all' }), null);
  assert.equal(T.trustLinkRegion({ view: 'trust', region: 'car_sudanian' }), 'car_sudanian');
  assert.equal(T.trustLinkRegion({ view: 'atlas' }, 'punjab_haryana'), null);
  // A1: only ids that resolve to a study region are carried
  assert.equal(T.trustLinkRegion({ view: 'trust', region: 'atlantis' }, null, man), null);
  assert.equal(T.trustLinkRegion({ view: 'trust', region: 'custom' }, null, man), null);
  assert.equal(T.trustLinkRegion({ view: 'region', region: 'kazakh_steppe' }, null, man), 'kazakh_steppe');
  assert.equal(T.resolveTrustRegion('custom', man, '-13.5,132.5').mode, 'custom');
  assert.equal(T.nearestStudyRegion(man, { lat: -13.5, lon: 132.5 }).inside, true, 'a place inside a study box resolves to that region (trust.js redirects)');
  const near = T.nearestStudyRegion(man, { lat: 14.2, lon: 101.3 });
  assert.equal(near.region.id, 'se_asia_mainland');
});

test('M2 region facts are exactly the stored regions[] fields', () => {
  for (const reg of m2.regions) {
    const f = T.regionFacts(man, val, m2, reg.region_id);
    assert.equal(f.test, 'm2');
    assert.equal(f.n, reg.n);
    assert.equal(f.cov90.k, reg.cov90_covered); assert.equal(f.cov80.k, reg.cov80_covered);
    assert.equal(f.cov90.share, reg.cov90); assert.equal(f.cov80.share, reg.cov80);
    assert.equal(f.error.value, reg.mae_log1p);
    assert.equal(f.status, reg.status); assert.deepEqual(f.statusReasons, reg.status_reasons);
    assert.deepEqual(f.q3, reg.q3_status);
    // pooled-only measures are never given a regional value
    assert.equal(f.skill.stored, false); assert.equal(f.verdict.stored, false);
    assert.equal(T.covWords(f.cov90), `${reg.cov90_covered} of ${reg.n}`); // A10 per-region form: k of 43
    // the descriptive month marks agree with the stored count
    const marks = T.regionMonthMarks(man, val, m2, reg.region_id);
    assert.equal(marks.length, reg.n);
    assert.equal(marks.filter((x) => x.inside).length, reg.cov90_covered);
  }
  const f = T.regionFacts(man, val, m2, 'se_asia_mainland');
  assert.deepEqual([f.n, f.cov90.k, f.cov80.k, f.error.value.toFixed(3)], [43, 40, 37, '0.231']);
});

test('M1 region facts are the stored held-out summary rows (record method, season all) and rows', () => {
  for (const id of M1_IDS) {
    const region = man.regions.find((r) => r.id === id);
    const f = T.regionFacts(man, val, m2, id);
    assert.equal(f.test, 'm1');
    const sum = (metric, lvl) => val.summary.find((s) => s.region_id === id && s.method_id === region.method && s.stratum === 'held_out' && s.season === 'all' && s.daynight === 'D' && s.metric === metric && (lvl === undefined || s.interval_level === lvl));
    assert.equal(f.cov90.share, sum('interval_coverage', 0.9).value);
    assert.equal(f.cov80.share, sum('interval_coverage', 0.8).value);
    assert.equal(f.cov90.passed, sum('interval_coverage', 0.9).passed);
    assert.equal(f.cov80.passed, sum('interval_coverage', 0.8).passed);
    assert.equal(f.error.value, sum('mae_log1p', null).value);
    assert.ok(f.countedFromRows.matchesStored, `${id}: counted inside_interval rows match the stored 90% share`);
    assert.equal(f.cov90.k, Math.round(f.cov90.share * f.cov90.n)); assert.equal(f.cov80.k, Math.round(f.cov80.share * f.cov80.n));
    assert.equal(f.status, region.status);
    assert.equal(f.skill.stored, false); assert.equal(f.verdict.stored, false);
    assert.deepEqual(f.period.years, region.held_out_years);
    // only held-out rows of the record method
    for (const m of T.regionMonthMarks(man, val, m2, id)) { assert.equal(m.row.stratum, 'held_out'); assert.equal(m.row.method_id, region.method); assert.ok(region.held_out_years.includes(m.row.year)); }
  }
  const p = T.regionFacts(man, val, m2, 'punjab_haryana');
  assert.deepEqual([p.n, p.cov90.k, p.cov80.k, p.cov90.passed, p.cov80.passed], [36, 31, 26, true, false]);
  const c = T.regionFacts(man, val, m2, 'car_sudanian');
  assert.deepEqual([c.cov90.k, c.cov80.k, c.cov90.passed, c.cov80.passed], [28, 25, false, false]);
});

test('region answers by status: validated (M1, M2), provisional; numbers match the facts', () => {
  for (const id of [...M1_IDS, ...M2_IDS]) {
    const f = T.regionFacts(man, val, m2, id);
    const a = T.regionAnswer(f);
    assert.ok(a.main.includes(T.covWords(f.cov90)), id);
    if (f.status === 'validated') assert.match(a.lead, /^Validated here, within limits/);
    if (f.status === 'provisional') { assert.match(a.lead, /^Provisional/); assert.match(a.main, /too rarely/); assert.ok(a.main.includes(T.covWords(f.cov80))); }
    assert.ok(a.main.includes(f.platform === 'noaa20' ? 'NOAA-20' : 'S-NPP'));
    assert.deepEqual(S.bannedIn(`${a.lead} ${a.main}`), [], id);
  }
  assert.match(S.PROVISIONAL_NOTE, /Aqua’s own measurements are not affected/);
});

test('example months: fixed rules over THIS region’s test months only; a success and an outside-range miss', () => {
  for (const id of M2_IDS) {
    const c = T.m2RegionCases(m2, id);
    assert.equal(c.success.row.region_id, id); assert.equal(c.success.row.inside90, true);
    assert.equal(c.miss.row.region_id, id); assert.equal(c.miss.row.inside90, false);
    const out = m2.month_rows.filter((r) => r.region_id === id && r.inside90 === false);
    const both = out.filter((r) => M.matched(r) === false);
    assert.equal(c.miss.row.actual, Math.max(...(both.length ? both : out).map((r) => r.actual)));
    assert.deepEqual(T.m2RegionCases(m2, id), c, 'deterministic');
  }
  for (const id of M1_IDS) {
    const region = man.regions.find((r) => r.id === id);
    const c = T.m1RegionCases(val, region);
    for (const k of ['success', 'miss']) { assert.equal(c[k].row.region_id, id); assert.equal(c[k].row.stratum, 'held_out'); assert.equal(c[k].row.method_id, region.method); }
    assert.equal(c.success.row.inside_interval, true); assert.equal(c.miss.row.inside_interval, false);
    // Q6: the success is the median-error inside month, not the most flattering one
    const e = (r) => Math.abs(Math.log1p(r.predicted) - Math.log1p(r.actual));
    const inside = val.rows.filter((r) => r.region_id === id && r.method_id === region.method && r.stratum === 'held_out' && r.daynight === 'D' && r.inside_interval === true && r.actual != null).map(e).sort((a, b) => a - b);
    assert.equal(e(c.success.row), inside[Math.floor((inside.length - 1) / 2)]);
    assert.ok(e(c.success.row) > inside[0], `${id}: not the best month`);
  }
  // no miss -> say so, never invent one
  const v = structuredClone(m2);
  for (const r of v.month_rows) if (r.region_id === 'kazakh_steppe') r.inside90 = true;
  const c = T.m2RegionCases(v, 'kazakh_steppe');
  assert.equal(c.miss, null);
  assert.equal(T.noCaseLine('miss', c.n), 'In this region, all 43 test months landed inside the 90% range, so there is no miss to show.');
  for (const t of [...Object.values(T.REGION_CASE_RULE.m1), ...Object.values(T.REGION_CASE_RULE.m2), T.UNSUPPORTED_LINE]) assert.deepEqual(S.bannedIn(t), []);
});

test('Trust view wiring: region view, unsupported state, switcher, legacy links and masthead', () => {
  const t = src('site/js/trust.js'); const mjs = src('site/js/main.js'); const d = src('site/js/decades.js');
  // M4.5: routing is one pure decision (trustctx.trustRoute), table-tested in m45page.test.mjs
  assert.match(t, /const route = trustRoute\(\{ \.\.\.ctx\.params, region: requestedRegion \}, location\.hash, manifest\);/);
  assert.match(t, /return unsupportedView\(ctx, manifest, sel\.at\)/);
  assert.match(t, /if \(near && near\.inside\) \{ ctx\.navigate\(trustParams\(near\.region\.id\), \{ replace: true \}\)/);
  assert.match(t, /requestedRegion = ctx\.params\.pick/, 'the old ?region= picker pre-selection moved to ?pick=');
  assert.match(t, /ctx\.setParams\(\{ pick: state\.region \}\)/, 'the S-NPP picker never rewrites ?region=');
  assert.match(t, /ctx\.navigate\(trustParams\(e\.target\.value === ALL \? ALL : e\.target\.value\), \{ replace: true \}\);/, 'switcher replaces (no history spam on arrow keys)');
  // M4.5: the "one example" framing now lives in the Time Machine's stage-3 sentence
  assert.match(src('site/js/machine.js'), /One genuine held-out example, not a guarantee/);
  assert.match(t, /'Not measured per region on this site'/); assert.doesNotMatch(t, /'Pooled only'/);
  assert.match(t, /PROVISIONAL_NOTE/);
  // M4.5: the regional demo is retired (dead code removed); example and miss come from the existing rules via trustcase.js
  assert.match(src('site/js/trustcase.js'), /const c = m2RegionCases\(m2val, id\);/);
  assert.doesNotMatch(d, /export function trustDemo/);
  assert.match(mjs, /pick: p\.get\('pick'\), at: p\.get\('at'\)/);
  // M4.4 (R3): masthead targets are computed from the current page (month carried) at render and click time
  assert.match(mjs, /const cur = currentParamsRaw\(\);\n  const trustRegion = trustLinkRegion\(cur, session\.lastRegion, navManifest\);/);
  const html = src('site/index.html');
  assert.match(html, /"\.\/js\/trustctx\.js": "\.\/js\/trustctx\.js\?v=/);
});

test('QA round 2: q3 counts, thresholds, per-check provisional wording, roles, season lines, unknown sides', () => {
  // Q1: a provisional q3 line never shows a percentage equal to the stated threshold
  for (const reg of m2.regions) {
    const line = T.q3Line(reg.q3_status);
    const k = T.countFromShare(reg.q3_status.cov90, reg.q3_status.n);
    assert.ok(line.includes(`${k} of ${reg.q3_status.n}`), line);
    const need = line.match(/below the (\d+)% needed/);
    if (need) assert.equal(line.split(`${need[1]}%`).length - 1, 1, `the threshold percentage appears only as the threshold: ${line}`);
    assert.deepEqual(S.bannedIn(line), []);
  }
  assert.match(T.q3Line(m2.regions.find((r) => r.region_id === 'argentina_chaco_parana').q3_status), /61 of 72 months, below the 85% needed/);
  assert.match(T.q3Line(m2.regions.find((r) => r.region_id === 'cerrado_tocantins').q3_status), /60 of 72 months/);
  // Q4: Punjab names only the failing 80% check; CAR both, plus the stored CP upper bound vs D7
  const pa = T.regionAnswer(T.regionFacts(man, val, m2, 'punjab_haryana')).main;
  assert.match(pa, /the 80% range caught Aqua’s real value too rarely \(26 of 36; at least 75% required\)\. The 90% range met its threshold \(31 of 36; 85%\)/);
  const ca = T.regionAnswer(T.regionFacts(man, val, m2, 'car_sudanian')).main;
  assert.match(ca, /both caught Aqua’s real value too rarely/); assert.match(ca, /0\.899, is also below the 0\.90/);
  // Q5: M2 rows carry the D7 thresholds, met from stored values
  for (const reg of m2.regions) { const f = T.regionFacts(man, val, m2, reg.region_id); assert.equal(f.cov90.threshold, 0.85); assert.equal(f.cov90.passed, reg.cov90 >= 0.85); assert.equal(f.cov80.passed, reg.cov80 >= 0.75); assert.equal(f.cov90.cpUpper, reg.cp90_upper); }
  // Q3: Kazakh is the M2 control, Iberia the M1 control; switcher roles are consistent
  const roles = Object.fromEntries(T.trustRegionGroups(man).flatMap((g) => g.regions).map((r) => [r.id, r.role]));
  assert.equal(roles.kazakh_steppe, 'control'); assert.equal(roles.iberia_control, 'control');
  assert.equal(Object.values(roles).filter((x) => x === 'control').length, 2);
  const t = src('site/js/trust.js');
  assert.match(t, /Control area for the NOAA-20 test, chosen before testing: steppe and agricultural grass burning\./); // public release: no citation of unpublished internal files
  assert.match(t, /`Tested with \$\{satShort\(f\)\}, not NOAA-20/); assert.doesNotMatch(t, /`Validated with \$\{satShort/);
  assert.match(t, /No verdict-agreement check is stored for the S-NPP test\./);
  assert.match(t, /Points measured by Aqua \(●\) don’t depend on this; estimates \(◇\) and ‘\+ VIIRS on Aqua’s scale’ do\./);
  assert.match(t, /'passed the thresholds set before testing'/);
  // season line from by_season counts
  const ar = T.seasonLine(T.regionFacts(man, val, m2, 'argentina_chaco_parana'));
  assert.match(ar, /17 of 22 off-season months; all 5 months outside the range were off-season/);
  // typical factor is an exact transform of the stored value
  assert.equal(T.typicalFactor(0.153), Math.exp(0.153));
  // unknown sides are never shown as below
  assert.equal(T.sideOf(null, 5, 1, 9), 'unknown'); assert.equal(T.sideOf(false, 10, 1, 9), 'above'); assert.equal(T.sideOf(false, 0.5, 1, 9), 'below'); assert.equal(T.sideOf(false, null, 1, 9), 'unknown');
  // A2/A5: links built with urlFor; the map card's custom link stays in the app
  const st = src('site/js/stage.js');
  assert.match(st, /S\.ctx\.urlFor\(params\)/); assert.match(st, /closeCard\(\); S\.ctx\.navigate\(params\)/);
  assert.match(src('site/js/main.js'), /navigate, setParams, urlFor, isCurrent/);
  assert.doesNotMatch(t, /href: `\?view=trust&pick=/);
});
