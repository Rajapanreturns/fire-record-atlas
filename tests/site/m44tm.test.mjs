// M4.4 Phases 2–3: navigation state (R1–R7, UI-02), the Satellite Time Machine, the landing (headline, suggestion, UI-04/07).
// Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as N from '../../site/js/nav.js';
import * as S from '../../site/js/story.js';
import * as MC from '../../site/js/machine.js';
import * as TC from '../../site/js/trustcase.js';
import { m2RegionCases } from '../../site/js/trustctx.js';
import { resolveTrustRegion } from '../../site/js/trustctx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = path.join(ROOT, 'site/data');
const hasReal = existsSync(path.join(REAL, 'manifest.json'));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const man = hasReal ? read(path.join(REAL, 'manifest.json')) : null;
const m2 = hasReal ? read(path.join(REAL, 'm2_validation.json')) : null;
const series = (r) => read(path.join(REAL, r.series_path || `region/${r.id}/series.json`));

// ---------------- navigation state ----------------

test('R2: two month vocabularies with explicit conversions; never both in one target', () => {
  assert.equal(N.monthToCal('2021-03'), 3); assert.equal(N.monthToCal('2021-13'), 0); assert.equal(N.monthToCal('x'), 0);
  assert.deepEqual(N.carryMonth({ view: 'atlas', cal: 3 }, 'region'), { cal: '3' });
  assert.deepEqual(N.carryMonth({ view: 'atlas', cal: 0 }, 'region'), {});
  assert.deepEqual(N.carryMonth({ view: 'atlas', cal: 3 }, 'trust'), {}, 'a typical month is not a test month');
  assert.deepEqual(N.carryMonth({ view: 'region', month: '2021-03' }, 'atlas'), { cal: '3' });
  assert.deepEqual(N.carryMonth({ view: 'region', month: '2021-03' }, 'trust'), { month: '2021-03' });
  assert.deepEqual(N.carryMonth({ view: 'trust', month: '2021-03' }, 'region'), { month: '2021-03' });
  assert.deepEqual(N.carryMonth({ view: 'region', month: 'bad' }, 'trust'), {});
  for (const from of [{ view: 'atlas', cal: 5 }, { view: 'region', month: '2019-05' }, { view: 'trust', month: '2019-05' }]) {
    for (const to of ['atlas', 'region', 'trust']) { const t = N.carryMonth(from, to); assert.ok(!(t.cal && t.month), `${from.view}->${to}`); }
  }
});

test('R2/R4: cal becomes the region page’s default comparable year; a year without that month falls back, with a line', { skip: !hasReal }, () => {
  const se = man.m2_regions.find((r) => r.id === 'se_asia_mainland');
  const ms = series(se).months;
  const p = N.calToMonth(3, ms, man.eras);
  assert.equal(p.rule, 'comparable'); assert.equal(p.month.slice(5), '03');
  assert.equal(N.calToMonth(0, ms, man.eras), null);
  assert.equal(N.fallbackLine.region('2031-08', '2025-12'), 'No Aug 2031 in this record; showing Dec 2025.');
  assert.equal(N.fallbackLine.trust('2023-08', '2021-03'), 'Aug 2023 isn’t a test month here; showing Mar 2021 (stated rule).');
  const r = src('site/js/region.js');
  assert.match(r, /const calPick = !params\.month && params\.cal \? calToMonth\(params\.cal, months, manifest\.eras\) : null;/);
  assert.match(r, /h\('p', \{ class: 'nav-note', role: 'status', text: navNote \}\)/, 'the fallback is said, once, as a status line');
});

test('R1/R3/R7: plain clicks follow the href; masthead targets are computed at click time; setParams keeps the hash', () => {
  const m = src('site/js/main.js');
  assert.match(m, /if \(a\.closest\('\.masthead'\)\) \{ navigate\(mastheadTarget\(a\), \{ hash \}\); return; \}/);
  assert.match(m, /const target = navParamsFromHref\(a\.getAttribute\('href'\), location\.href\) \|\| \{\};/);
  assert.match(m, /history\.replaceState\(history\.state, '', `\?\$\{p\.toString\(\)\}\$\{location\.hash \|\| ''\}`\);\n  updateNav\(currentParamsRaw\(\)\.view\);/);
  assert.match(m, /openRegion\(regionId, \{ cal = 0 \} = \{\}\)/);
  const q = N.navParamsFromHref('?view=trust&region=se_asia_mainland&month=2021-03&machine=1&data=x', 'http://h/');
  assert.deepEqual(q, { view: 'trust', region: 'se_asia_mainland', month: '2021-03', machine: '1' }, 'data/validation are carried by KEEP, not here');
});

test('R5: Trust months are only stored test months; withheld regions stay unreachable by URL', { skip: !hasReal }, () => {
  const rows = N.m2TestRows(m2, 'se_asia_mainland');
  assert.ok(rows.every((r) => r.actual != null)); assert.equal(rows.length, m2RegionCases(m2, 'se_asia_mainland').n);
  const se = man.m2_regions.find((r) => r.id === 'se_asia_mainland');
  const row = (month, aqua = 'observed') => ({ month, native: { aqua: { status: aqua } } });
  assert.equal(N.isTestMonthCandidate(se, row('2021-03')), true);
  assert.equal(N.isTestMonthCandidate(se, row('2023-03')), false, 'after the validated window');
  assert.equal(N.isTestMonthCandidate(se, row('2020-08', 'excluded')), false, 'no Aqua value: not a test month');
  const pj = man.regions.find((r) => r.id === 'punjab_haryana');
  assert.equal(N.isTestMonthCandidate(pj, row(`${pj.held_out_years[0]}-10`)), true);
  assert.equal(N.isTestMonthCandidate(pj, row(`${pj.trained_on_years[0]}-10`)), false);
  for (const id of ['n_california', 'yakutia']) {
    assert.notEqual(resolveTrustRegion(id, man).mode, 'region', `${id} is withheld`);
    assert.equal(N.m2TestRows(m2, id).length, 0);
  }
  const t = src('site/js/trust.js');
  // M4.5: the region page is the Time Machine; a carried month opens only if it is one of the case's stored test months
  assert.match(src('site/js/machine.js'), /const askedRow = asked && MONTH_RE\.test\(asked\) \? byMonth\.get\(asked\) : null;/);
});

// ---------------- the Satellite Time Machine ----------------

test('Time Machine: the demo month comes from the stated rule; the three numbers come from the stored row', { skip: !hasReal }, () => {
  const c = m2RegionCases(m2, 'se_asia_mainland');
  // M4.5: the machine reads TestMonth rows (trustcase.js); the values must be the stored row's, unchanged
  const tms = TC.m2TestMonths(m2, 'se_asia_mainland'); const tmOf = (row) => tms.find((x) => x.month === row.month);
  const m = MC.machineModel(tmOf(c.success.row), { withActual: true }); // the revealed (stage 3) model
  assert.equal(c.success.row.month.slice(5), '03', 'March, by the fallback rule (the pre-locked month crosses a band edge)');
  assert.equal(m.raw, c.success.row.noaa20_raw); assert.equal(m.pred, c.success.row.pred); assert.equal(m.actual, c.success.row.actual);
  assert.equal(m.lo, c.success.row.lo90); assert.equal(m.hi, c.success.row.hi90, 'the range is the stored width');
  assert.equal(m.side, 'inside');
  assert.equal(m.apart, Math.round(Math.abs(c.success.row.pred - c.success.row.actual)));
  assert.ok(m.pct(m.raw) <= 100 && m.pct(m.raw) > 85, 'the largest value sits near the right edge of the linear axis');
  // one headline + at most one sentence per stage; numbers from data
  const k = { k: c.nInside, n: c.n };
  const s1 = MC.machineCopy(m, 1, k); const s2 = MC.machineCopy(m, 2, k); const s3 = MC.machineCopy(m, 3, k);
  // main-session copy decisions (QA R6/R7 + TEXT-CRITIQUE): the numbers sit in the lanes; headlines name the act / verdict
  assert.equal(s1.head, 'NOAA-20, read raw.');
  assert.equal(s1.line, 'That’s above Aqua’s usual March, but VIIRS sees smaller hotspots.');
  for (const v of ['within', 'below', 'cant_tell']) assert.equal(MC.machineCopy({ ...m, rawVerdict: v }, 1, k).line, 'Raw counts aren’t on Aqua’s scale, so this comparison means little.');
  assert.equal(s2.head, 'Converted to Aqua’s scale.');
  assert.equal(s2.line, 'Ratio and range fitted on other years; only this month’s NOAA-20 count goes in.');
  assert.equal(s3.head, 'Inside the 90% range.');
  assert.equal(s3.line, `One genuine held-out example, not a guarantee: ${c.nInside} of ${c.n} test months here landed inside.`);
  for (const t of [s1, s2, s3]) { assert.ok(t.head.split(/\s+/).length <= 8, t.head); assert.equal((t.line.match(/[.!?](\s|$)/g) || []).length, 1, t.line); assert.deepEqual(S.bannedIn(`${t.head} ${t.line}`), []); }
  const miss = MC.machineModel(tmOf(c.miss.row), { withActual: true });
  assert.match(MC.machineCopy(miss, 3, k).head, /^(Above|Below) the 90% range\.$/);
  assert.equal(MC.machineCopy(miss, 3, k).line, s3.line, 'the held-out qualifier is kept verbatim for misses too');
});

test('Time Machine: "another month" starts at the pre-locked opening month, then time order, unfiltered, and cycles all', { skip: !hasReal }, () => {
  const rows = N.m2TestRows(m2, 'se_asia_mainland'); const reg = m2.regions.find((g) => g.region_id === 'se_asia_mainland');
  const c = m2RegionCases(m2, 'se_asia_mainland');
  const seen = new Set([c.success.row.month]);
  let cur = c.success.row; const order = [];
  for (let i = 0; i < rows.length - 1; i += 1) { cur = N.nextTestRow(rows, reg.featured_month, cur, seen); seen.add(cur.month); order.push(cur.month); }
  assert.equal(order[0], reg.featured_month);
  assert.equal(new Set(order).size, rows.length - 1, 'every other test month, once');
  assert.ok(order.slice(1).every((mm, i, a) => i === 0 || a[i - 1] < mm), 'time order after the opening month');
  assert.ok(order.includes(c.miss.row.month), 'misses are not filtered out');
});

test('Time Machine: stage 3 never in the URL; reduced motion; Esc and Skip; A12 near converted values; one primary action', () => {
  assert.equal(N.urlStage(3), '2'); assert.equal(N.urlStage(1), '1'); assert.equal(N.parseStage('3'), 2); assert.equal(N.parseStage('2'), 2);
  const t = src('site/js/machine.js');
  assert.match(t, /if \(prefersReducedMotion\(\) \|\| from === s\) return;/);
  assert.match(t, /range\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/, 'the range fades in at full stored width; it never grows');
  assert.doesNotMatch(t, /intervalFirst/);
  // M4.5: the evidence is on the same page: "Explore the evidence" and Esc open it (no history entry); no Skip link
  assert.match(t, /if \(ev\.key !== 'Escape'/); assert.match(t, /ev\.preventDefault\(\); opts\.onEvidence\(\);/);
  assert.match(t, /'Explore the evidence'/); assert.match(t, /'Converted estimate'/);
  assert.equal((t.match(/this month`/g) || []).length, 1, 'the divisor appears once, on the arrow');
  assert.match(t, /live\.textContent = `Step \$\{s\} of 3: \$\{STAGES\[s - 1\]\}`;/, 'F2: the live region names the step only');
  assert.match(t, /foot\.hidden = s === 1 \|\| !fv\.visible\.length;/);
  assert.equal((t.match(/class: 'btn btn-primary tm-go'/g) || []).length, 3, 'one primary button per stage');
  assert.doesNotMatch(t, /\b(19|20)\d\d\b/);
  const tr = src('site/js/trust.js');
  assert.match(tr, /machineFor\(ctx, manifest, val, m2val, f\.id, \{ onEvidence: \(\) => openEvidence\(\) \}\)\]\);/, 'M4.5: every study region’s Trust page is its Time Machine');
});

// ---------------- landing ----------------

test('Landing: headline A and one sentence from data; one primary action', { skip: !hasReal }, () => {
  const c = S.landingCopy(man);
  assert.equal(c.head, 'Explore 25 years of fire detections from satellites that count differently.');
  assert.equal((c.line.match(/[.!?](\s|$)/g) || []).length, 1);
  assert.deepEqual(S.bannedIn(`${c.head} ${c.line} ${c.cta}`), []);
  assert.doesNotMatch(c.head, /MODIS|VIIRS/, 'no acronyms in the headline');
  const st = src('site/js/stage.js');
  assert.match(st, /const cta = h\('a', \{ class: 'btn btn-primary st-cta'/);
});

test('Landing suggestion removed (user request): no floating suggestion element, helpers or lazy series loading', () => {
  // the user asked to remove the month suggestion over the globe; its rule, copy and the 9-series lazy load existed only for it
  const st = src('site/js/stage.js');
  assert.doesNotMatch(st, /st-suggest|suggestEl|paintSuggestion|loadSeasons|monthSuggestion|suggestionText|loadSeries/);
  assert.equal(N.monthSuggestion, undefined); assert.equal(N.usualShares, undefined); assert.equal(S.suggestionText, undefined);
  assert.doesNotMatch(src('site/css/site.css'), /\.st-suggest/);
});

test('UI-04 / UI-07: frame legend with unit, month in the stamp, strip under the map; labels avoid every study box', () => {
  const st = src('site/js/stage.js');
  assert.match(st, /h\('div', \{ class: 'st-mapwrap' \}, map, miniLegend, cardBox, menu, veil\), strip,/); // suggestion removed (user request)
  assert.match(st, /`Detections per 1,000 km² of land, \$\{S\.cal === 0 \? 'per year' : `in a typical \$\{MONTH_FULL\[S\.cal - 1\]\}`\}`/);
  assert.match(st, /h\('b', \{ class: 'st-stamp-m', text: S\.cal === 0 \? 'All year' : MONTH_FULL\[S\.cal - 1\] \}\)/);
  assert.match(st, /obstacles\.some\(\(q\) => q\.id !== r\.id && over\(a, q\)\)/);
  assert.match(st, /lab\.classList\.toggle\('st-label-min', !fit\);/);
});

test('M4.4 close-out: no year literals or banned words in the new modules; cache tag m44 on every asset', () => {
  for (const f of ['site/js/nav.js', 'site/js/machine.js']) {
    assert.deepEqual(src(f).match(/['"`\s(=]((19|20)\d\d)\b/g) || [], [], f);
  }
  const html = src('site/index.html');
  assert.doesNotMatch(html, /\?v=m4[0-3]|\?v=m44a/);
  for (const f of ['nav.js', 'machine.js', 'main.js', 'stage.js']) assert.match(html, new RegExp(`js/${f.replace('.', '\\.')}\\?v=m45[bcd]?"`)); // M4.5 tag (m45b: homepage fixes; m45c: region chart)
});

test('QA R5: pre-reveal tab words depend on position only, never on role (S-NPP and NOAA-20 demos)', () => {
  for (const role of ['success', 'miss', 'pick']) {
    assert.equal(S.revealRoleWord(0, false, role), 'a hidden test month');
    assert.equal(S.revealRoleWord(1, false, role), 'another hidden test month');
  }
  assert.equal(S.revealRoleWord(0, true, 'miss'), 'a miss: outside the range');
  assert.equal(S.revealRoleWord(1, true, 'success'), 'a success');
  // M4.5: both tabbed demos are retired; the Time Machine's kicker never names a month's role before the reveal
  const t = src('site/js/trust.js');
  assert.doesNotMatch(t, /function m1RegionReveal/); assert.doesNotMatch(src('site/js/decades.js'), /export function trustDemo/);
  assert.match(src('site/js/machine.js'), /kicker\.textContent = `\$\{M\} \$\{m\.year\} · hidden test month`;/);
});

test('Landing sentence (main-session copy): the region count comes from data', { skip: !hasReal }, () => {
  const n = man.regions.length + man.m2_regions.length;
  assert.equal(S.landingCopy(man).line, `Newer VIIRS sensors can detect smaller hotspots than MODIS; in ${n} study regions we tested whether their counts compare.`);
});

test('Architect F1, F3–F7', () => {
  const m = src('site/js/main.js');
  assert.match(m, /if \(id !== session\.renderId\) \{ if \(node && node\.__teardown\) node\.__teardown\(\); return; \}/);
  assert.match(m, /const viewKey = `\$\{params\.view\}\|\$\{params\.region\}\|\$\{params\.machine \? 'm' : ''\}`;/);
  const st = src('site/js/stage.js');
  assert.doesNotMatch(st, /st-suggest', hidden: true, 'aria-live'/);
  assert.match(st, /if \(mode === 'world'\) paintHead\(\);/);
  assert.match(src('site/js/trustcase.js'), /const rows = m1Rows\(val, region\)\.filter/, 'F4: the one M1 row filter, reused');
  for (const k of ['year', 'ruler']) assert.ok(N.NAV_KEYS.includes(k), k);
});

test('M4.4 rehearsal fix: hovering the hero chart does not change the month card or its links', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../site/js/hero.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /addEventListener\('pointerenter', \(\) => paintCard/);
  assert.doesNotMatch(src, /addEventListener\('pointerleave', \(\) => paintCard/);
});
