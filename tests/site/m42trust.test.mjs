// M4.2 Trust page: three distinct headline measures from data, the demo-month rule, explorer filters and counts,
// progressive disclosure (every former element still reachable), copy rules. Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as M from '../../site/js/m2.js';
import * as S from '../../site/js/story.js';
import * as U from '../../site/js/ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const sets = [];
for (const dir of ['site/data', 'site/data-fixtures']) {
  if (!existsSync(path.join(ROOT, dir, 'm2_validation.json'))) continue;
  sets.push({ dir, manifest: read(`${dir}/manifest.json`), val: read(`${dir}/m2_validation.json`) });
}
const real = sets.find((x) => x.dir === 'site/data');

test('headline measures: three distinct kinds, numbers and denominators read from the file', () => {
  for (const { val } of sets) {
    const ms = M.headlineMetrics(val);
    assert.deepEqual(ms.map((m) => m.id), ['coverage', 'skill', 'verdict']);
    assert.deepEqual(ms.map((m) => m.claim), ['A2', 'A5', 'A6']);
    const q1 = val.pooled.q1; const t = M.confusionTallies(val.pooled.q4.arms.n20_direct.confusion);
    assert.equal(ms[0].k, q1.cov90_covered); assert.equal(ms[0].n, q1.n);
    assert.equal(ms[0].big, String(q1.cov90_covered)); assert.match(ms[0].of, new RegExp(`of ${q1.n} months`));
    assert.equal(ms[1].big, `${Math.round(q1.skill_vs_aqua_clim * 100)}%`);
    assert.equal(ms[2].k, t.agree); assert.equal(ms[2].n, t.decided);
    assert.match(ms[2].note, new RegExp(`^${t.abstained} more`));
    for (const m of ms) for (const s of [m.kind, m.of, m.plain, m.note]) assert.deepEqual(S.bannedIn(s), [], s);
    // never "more accurate", never "better" for the skill figure (M2-AUDIT §9 not approved)
    assert.doesNotMatch(`${ms[1].of} ${ms[1].plain}`, /accurate|better/i);
  }
  if (real) {
    const ms = M.headlineMetrics(real.val);
    assert.equal(`${ms[0].big} ${ms[0].of}`, '200 of 215 months');
    assert.equal(`${ms[2].big} ${ms[2].of}`, '186 of 204 months');
  }
});

test('demo months: fixed rules over the file (a clean success from the pre-locked opening months, and a double miss)', () => {
  for (const { val } of sets) {
    const d = M.demoCases(val);
    if (!d.success || !d.miss) { assert.notEqual(val, real && real.val, 'the real file has both demo months'); continue; }
    const s = d.success.row; const m = d.miss.row;
    assert.equal(s.inside90, true); assert.equal(M.matched(s), true); assert.ok(!s.range_crosses_edge);
    if (d.success.how.startsWith('rule')) assert.ok(val.regions.some((r) => r.region_id === s.region_id && r.featured_month === s.month));
    assert.ok(m.inside90 === false || M.matched(m) === false);
    if (d.miss.how.startsWith('rule')) {
      assert.equal(m.inside90, false); assert.equal(M.matched(m), false);
      const both = val.month_rows.filter((r) => r.inside90 === false && M.matched(r) === false);
      assert.equal(m.actual, Math.max(...both.map((r) => r.actual)));
    }
    assert.deepEqual(M.demoCases(val), d, 'deterministic');
  }
  if (real) {
    const d = M.demoCases(real.val);
    assert.deepEqual([d.success.row.region_id, d.success.row.month.slice(5), d.miss.row.region_id, d.miss.row.month.slice(5)], ['kazakh_steppe', '07', 'cerrado_tocantins', '03']);
  }
  for (const t of Object.values(M.DEMO_RULE)) assert.deepEqual(S.bannedIn(t), []);
});

test('demo rule falls back when no opening month is a clean success', () => {
  const v = structuredClone((real || sets[0]).val);
  for (const reg of v.regions) { const r = v.month_rows.find((x) => x.region_id === reg.region_id && x.month === reg.featured_month); if (r) r.range_crosses_edge = true; }
  const d = M.demoCases(v);
  assert.match(d.success.how, /^fallback/);
  assert.equal(d.success.row.inside90, true);
});

test('explorer filters: counts match independent tallies; every month is in "all"; a filter can be empty', () => {
  for (const { val } of sets) {
    const c = M.filterCounts(val);
    const q1 = val.pooled.q1; const t = M.confusionTallies(val.pooled.q4.arms.n20_direct.confusion);
    assert.equal(c.all, val.month_rows.length);
    assert.equal(c.outside, q1.n - q1.cov90_covered);
    assert.equal(c.verdict_miss, t.decided - t.agree);
    assert.equal(c.cant_tell, val.month_rows.filter((r) => r.q4_n20 === 'cant_tell').length);
    assert.equal(c.edge, val.month_rows.filter((r) => r.range_crosses_edge).length);
    assert.equal(c.success, val.month_rows.filter((r) => r.inside90 && M.matched(r) === true).length);
    // per area: sums over areas equal the pooled count for every filter
    for (const f of M.EXPLORE_FILTERS) assert.equal(val.regions.reduce((s, g) => s + M.filterCounts(val, g.region_id)[f.id], 0), c[f.id], f.id);
    for (const f of M.EXPLORE_FILTERS) assert.deepEqual(S.bannedIn(f.label), []);
  }
  if (real) {
    assert.deepEqual(M.filterCounts(real.val), { all: 215, success: 173, verdict_miss: 18, outside: 15, cant_tell: 11, edge: 150 });
    assert.deepEqual(M.filterRows(real.val, 'verdict_miss', 'kazakh_steppe'), [], 'an empty filter is possible (the UI says so)');
  }
  assert.equal(M.exploreFilter('nope').id, 'all');
});

test('Trust copy: question, provisional line and coverage groups from data, no banned words or year literals', () => {
  assert.equal(S.TRUST_QUESTION, 'Can the newer satellite reproduce the older satellite’s measurements?');
  for (const { manifest, val } of sets) {
    const p = S.provisionalLine(manifest);
    const prov = manifest.regions.filter((r) => r.status === 'provisional');
    if (prov.length) { assert.ok(p.includes('provisional')); for (const r of prov) assert.ok(p.includes(S.shortName(r.name))); } else assert.equal(p, null);
    const cov = S.trustCoverage(manifest, val);
    assert.equal(cov.provisional.length, prov.length);
    assert.equal(cov.validated.length, (manifest.m2_regions || []).filter((r) => r.status === 'validated').length + manifest.regions.filter((r) => r.status === 'validated').length);
    assert.deepEqual(cov.untested.map((u) => u.id), ['after', 'night', 'noaa21']);
    assert.match(cov.untested[0].label, new RegExp(`From ${Number(val.window.end.slice(0, 4)) + 1} on`));
    for (const s of [p || '', ...cov.untested.flatMap((u) => [u.label, u.why])]) assert.deepEqual(S.bannedIn(s), []);
  }
});

test('progressive disclosure: default = question, answer, measures, demo, coverage, explorer; everything else in Scientific details', () => {
  const t = src('site/js/trust.js');
  const d = src('site/js/decades.js');
  // default order in the hero
  const hero = t.slice(t.indexOf("class: 'tr-hero no-demo'"), t.indexOf('root.append(coverage(')) /* M4.5: the hub hero has no demo */;
  assert.ok(t.indexOf('plainAnswer(m2val, m1)') < t.indexOf("class: 'tr-hero no-demo'") && t.includes('provisionalLine(manifest)'));
  assert.match(t, /'data-claim': 'trustAnswer' \}, h\('b', \{ text: 'The answer, approved wording: ' \}\), answerVerbatim\)/, 'approved answer kept verbatim in the details');
  // M4.5: the hub (Full scientific evidence) has no demo of its own; its one action opens the default region's Time Machine
  const order = ['TRUST_QUESTION', "'answer tr-answer'", "'tr-prov'", "'A1'", "'Try a hidden month →'", 'trustMetricTiles(m2val)'].map((k) => hero.indexOf(k));
  assert.ok(order.every((i) => i >= 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // Scientific details holds every former section
  for (const id of ['sd-stats', 'sd-matrices', 'sd-method', 'sd-robust', 'sd-m1', 'sd-audit', 'sd-limits']) assert.match(t, new RegExp(`'${id}'`));
  assert.match(t, /class: 'tr-science', id: 'science'/);
  // the M1 pieces still exist: guided walk, picker, plain summary, numbers, scoreboard, pre-registered score, audit, limitations
  for (const k of ["id: 'pr-h'", "class: 'trust-summary'", 'resultBlock(', 'scoreboard(', 'preregScore(', 'auditSection(', 'limitations(val']) assert.ok(t.includes(k), k);
  // the NOAA-20 statistics keep every approved sentence and all three matrices
  for (const k of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A12']) assert.ok(d.includes(`'${k}'`), k);
  for (const id of ['cm-n20', 'cm-naive', 'cm-viirs']) assert.ok(d.includes(id), id);
  assert.match(d, /'A10-region'/, 'per-area coverage line (43-month denominators) stays with the explorer');
  // explorer: the incoming #decades link lands on it and opens it
  assert.match(d, /class: 'tr-explore', id: 'decades'/);
  assert.match(t, /location\.hash === '#decades' \|\| explorer\.m2Requested\)\) explorer\.open\(\)/);
  // marks keep their meanings; dimmed cells stay (filters never remove a month)
  assert.match(d, /underlined = Aqua outside the 90% range/);
  assert.match(d, /hatched = not tested/);
  assert.match(d, /classList\.toggle\('off', !on\)/);
  assert.match(d, /No test months\$\{where\} match/);
  // table alternative and keyboard grid
  assert.match(d, /class: 'score-table tr-x-table'/);
  assert.match(d, /gridMove\(nRows, el\.__pos, ev\.key\)/);
});

test('reveal motion: interval first, then the measured value; instant under reduced motion; Aqua hidden until asked', () => {
  const d = src('site/js/decades.js');
  // M4.5: the demo is retired; the Time Machine carries the reveal (range at full stored width, then Aqua; none when reduced)
  assert.doesNotMatch(d, /export function trustDemo/);
  const demo = src('site/js/machine.js');
  assert.match(demo, /if \(prefersReducedMotion\(\) \|\| from === s\) return;/);
  assert.match(demo, /const mo = revealMotion\(false\);/);
  assert.match(demo, /'hidden'/);
  assert.match(demo, /'aria-live': 'polite'/);
  assert.doesNotMatch(demo, /verdictFor|revealOutcome/, 'the stored point verdict (q4) is shown, never recomputed');
  assert.equal(M.revealMotion(true), null);
});

test('index.html links trust.css after site.css, one cache tag', () => {
  const html = src('site/index.html');
  const a = html.indexOf('css/site.css?v='); const b = html.indexOf('css/trust.css?v=');
  assert.ok(a > 0 && b > a);
  const tags = new Set([...html.matchAll(/\?v=([\w-]+)/g)].map((m) => m[1]));
  assert.equal(tags.size, 1, [...tags].join(','));
});

test('plain answer (H4): the same facts as the approved trustAnswer, nothing added, plain words first', () => {
  for (const { val } of sets) {
    const m1 = { held: 2, tested: 4 };
    const a = M.trustAnswer(val, m1); const p = M.plainAnswer(val, m1);
    const all = `${p.lead} ${p.main} ${p.rest}`;
    assert.equal(p.lead, 'Partly.');
    assert.ok(p.main.startsWith(`In ${val.pooled.q1.cov90_covered} of ${val.pooled.q1.n} hidden months, the newer satellite`));
    // every number in the plain lead is also in the approved answer (nothing added)
    const nums = (t) => (t.match(/\d+/g) || []);
    for (const n of nums(all)) assert.ok(nums(a).includes(n), `${n} not in the approved answer`);
    assert.ok(all.endsWith('Nothing after MODIS has been tested.'));
    assert.deepEqual(S.bannedIn(all), []);
  }
});

test('Q2/Q3/Q4/Q6 copy: skill caveat, point vs range verdict notes, chip scopes, drift chip, two meanings of can’t tell', () => {
  for (const { val, manifest } of sets) {
    const sk = M.headlineMetrics(val)[1];
    const tn = M.confusionTallies(val.pooled.q4.arms.naive.confusion);
    assert.match(sk.caveat, /deliberately simple baseline that never sees the month/);
    assert.ok(sk.caveat.includes(`${tn.agree} of ${tn.decided}`));
    const cov = S.trustCoverage(manifest, val);
    for (const r of cov.validated.concat(cov.provisional)) assert.ok(r.scope.startsWith(r.test), r.scope);
    for (const r of cov.validated.filter((x) => x.test === 'S-NPP')) {
      const m = manifest.regions.find((x) => x.id === r.id);
      for (const y of m.held_out_years) assert.ok(r.scope.includes(String(y)));
      if (m.role === 'control') assert.match(r.scope, /control region/);
    }
    assert.equal(cov.untested[0].why, 'Aqua’s timing drifted, so its counts can’t confirm the conversion; then MODIS ends.');
  }
  if (real) {
    const ok = M.filterRows(real.val, 'success').filter((r) => r.range_crosses_edge).length;
    assert.equal(ok, 124);
  }
  const g = S.glossary({}).find((x) => x.term === 'Can’t tell');
  assert.match(g.precise, /Two uses\. On the region pages/); assert.match(g.precise, /too few NOAA-20 detections/);
  const d = src('site/js/decades.js');
  // M4.5: the note moved with the reveal into the Time Machine's stage-3 details (NOAA-20, edge-crossing months)
  assert.match(src('site/js/trust.js'), /so a range-based call would have been ‘uncertain’\. The point verdict shown is the one counted in/);
  // M4.5: the pooled demo's context line went with the retired demo (the Time Machine shows the region's own k of n)
  assert.match(d, /Point verdict; \$\{nEdgeOk\} of these/);
});

test('H6 plain reveal words: error factor, usual-for-month verdicts', async () => {
  const D = await import('../../site/js/decades.js').catch(() => null);
  // decades.js imports DOM-free modules only at load; if the environment cannot import it, fall back to the source
  if (D && D.errorPlain) {
    assert.equal(D.errorPlain(M.errorRatio(303, 392)), 'Prediction was 1.3× too low.');
    assert.equal(D.errorPlain(M.errorRatio(199, 108)), 'Prediction was 1.8× too high.');
    assert.equal(D.errorPlain(M.errorRatio(100, 101)), 'Prediction was within 5% of Aqua’s count.');
    assert.equal(D.usualWord('within', 6, 'B'), 'usual for July (B)');
    assert.equal(D.usualWord('above', 2, 'B'), 'above usual for March (B)');
  } else assert.match(src('site/js/decades.js'), /export function errorPlain/);
});

// ---------- B1 deep links: behaviour, with a tiny fake DOM ----------
function fakeEl(tag, { cls = [], data = {}, href = null, parent = null } = {}) {
  const el = { tag, classList: new Set(cls), dataset: data, parent, attrs: { href }, open: false,
    get parentElement() { return this.parent; },
    getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    matches(sel) { return sel === 'details' ? this.tag === 'details' : sel.startsWith('.') ? this.classList.has(sel.slice(1)) : false; },
    closest(sel) { for (let e = this; e; e = e.parent) if (e.matches(sel)) return e; return null; } };
  return el;
}

test('B1: masthead rewrite leaves in-page links (and their #decades hash) alone', () => {
  const masthead = fakeEl('header', { cls: ['masthead'] });
  const nav = fakeEl('ul', { cls: ['nav'], parent: masthead });
  const navTrust = fakeEl('a', { data: { nav: 'trust' }, href: '?view=trust', parent: nav });
  const mainEl = fakeEl('main');
  const inPage = fakeEl('a', { data: { nav: 'trust' }, href: '?view=trust#decades', parent: mainEl });
  const all = [navTrust, inPage];
  const doc = { querySelectorAll: (sel) => {
    if (sel === '[data-nav]') return all;
    const m = sel.match(/^\.(\S+) \[data-nav\]$/);
    return m ? all.filter((a) => a.closest(`.${m[1]}`)) : [];
  } };
  U.rewriteNavLinks(doc, 'region', (a) => ({ view: a.dataset.nav }), (t) => `?view=${t.view}&data=x`);
  assert.equal(navTrust.getAttribute('href'), '?view=trust&data=x');
  assert.equal(inPage.getAttribute('href'), '?view=trust#decades', 'in-page link keeps its hash');
  assert.equal(U.linkHash(inPage.getAttribute('href'), 'http://localhost:8000/?view=region&region=se_asia_mainland'), '#decades');
  assert.equal(U.linkHash('?view=trust', 'http://localhost:8000/'), '');
  assert.equal(U.withHash('?view=trust', '#decades'), '?view=trust#decades');
  assert.equal(U.withHash('?view=trust', ''), '?view=trust');
});

test('B1/SF2: openTo opens the target and every <details> around it (explorer, region optional tool)', () => {
  const outer = fakeEl('details');
  const mid = fakeEl('div', { parent: outer });
  const inner = fakeEl('details', { parent: mid });
  const target = fakeEl('h2', { parent: inner });
  U.openTo(target);
  assert.equal(inner.open, true); assert.equal(outer.open, true);
  const lone = fakeEl('details'); U.openTo(lone); assert.equal(lone.open, true, 'a <details> target opens itself');
  U.openTo(null);
  const main = src('site/js/main.js');
  assert.match(main, /if \(t\) \{ openTo\(t\); requestAnimationFrame/);
  assert.match(main, /navigate\(.*\{ hash \}\)/);
});

test('?science=1 opens Scientific details; ?region=<NOAA-20 area> pre-selects it in the explorer', () => {
  const t = src('site/js/trust.js');
  assert.match(src('site/js/main.js'), /science: p\.get\('science'\) === '1'/);
  assert.match(t, /open: openM1 \|\| science \|\| null/);
  assert.doesNotMatch(t, /\badvanced\b/);
  assert.match(t, /trustExplorer\(m2val, manifest, \{ onTry, region: m2Requested \}\)/);
  assert.match(t, /const onTry = \(row\) => ctx\.navigate\(\{ view: 'trust', region: row\.region_id, month: row\.month \}\);/, 'M4.5: an explorer month opens that region’s Time Machine');
});
