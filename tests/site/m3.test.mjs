// M3 "Across decades": value kinds, the point-verdict rule, the featured-month rule, approved wording from data,
// keyboard and reduced-motion helpers. Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../../site/js/core.js';
import * as M from '../../site/js/m2.js';
import { bannedIn, regionChip } from '../../site/js/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const sets = [];
for (const dir of ['site/data', 'site/data-fixtures']) {
  if (!existsSync(path.join(ROOT, dir, 'm2_validation.json'))) continue;
  const manifest = read(`${dir}/manifest.json`);
  const val = read(`${dir}/m2_validation.json`);
  const series = (manifest.m2_regions || []).map((r) => ({ region: r, s: existsSync(path.join(ROOT, dir, r.series_path)) ? read(`${dir}/${r.series_path}`) : null })).filter((x) => x.s);
  sets.push({ dir, manifest, val, series });
}
const real = sets.find((x) => x.dir === 'site/data');
const src = (f) => readFileSync(path.join(ROOT, 'site/js', f), 'utf8');

test('m2 data present for at least one data dir', () => { assert.ok(sets.length > 0); });

test('value kinds: every kind in the M2 series has one label and one mark; labels are distinct', () => {
  const labels = Object.keys(M.KIND).map((k) => M.kindLabel(k));
  assert.equal(new Set(labels).size, labels.length);
  for (const k of Object.keys(M.KIND)) assert.ok(M.KIND[k].mark && M.KIND[k].label);
  for (const { series } of sets) for (const { s } of series) for (const m of s.months) {
    const cells = [m.record, ...Object.values(m.native), ...Object.values(m.modelled)];
    for (const c of cells) assert.ok(c.value_kind in M.KIND, `${m.month}: unknown kind ${c.value_kind}`);
  }
  assert.match(M.kindLabel('converted_validated', { start: '2018-04', end: '2021-12' }), /tested \d{4}–\d{4}$/);
  assert.match(M.kindLabel('unavailable'), /not zero/);
});

test('no converted value in the observed slot: the record and the Aqua lane only ever show native Aqua', () => {
  for (const { series } of sets) for (const { s } of series) {
    for (const m of s.months) {
      const v = core.rulerValue(m, 'record');
      if (v.value != null) {
        assert.equal(v.kind, 'observed', `${m.month}: record shows ${v.kind}`);
        assert.equal(m.record.value_kind, 'observed');
        assert.equal(v.value, core.nativeN(m, 'aqua'));
      } else assert.equal(m.record.value_kind, 'unavailable');
    }
    const { env } = core.envelopeFor(s, []);
    for (const m of M.unvalidatedMonths(s)) {
      const u = M.unvalidatedModel(m, env);
      assert.equal(u.kind, 'converted_unvalidated');
      assert.equal(u.actual, core.nativeStatus(m, 'aqua') === 'observed' ? core.nativeN(m, 'aqua') : null, `${m.month}: Aqua lane must be native Aqua or empty`);
    }
  }
});

test('unvalidated converted values are all after the tested window and never sit in the record', () => {
  for (const { val, series } of sets) for (const { s } of series) for (const m of M.unvalidatedMonths(s)) {
    assert.ok(m.month > val.window.end, m.month);
    assert.ok(!String(m.record.value_kind).startsWith('converted'));
  }
});

test('verdicts are the exported Q4 POINT classes, reproducible from pred/actual and the exported envelope', () => {
  const cls = (v, r) => (v > r.env_p90 ? 'above' : v < r.env_p10 ? 'below' : 'within');
  for (const { val } of sets) for (const r of val.month_rows) {
    assert.equal(r.q4_truth, cls(r.actual, r), `${r.region_id} ${r.month} truth`);
    assert.equal(r.q4_n20, r.low_count ? 'cant_tell' : cls(r.pred, r), `${r.region_id} ${r.month} arm`);
    assert.ok(M.VERDICT_M2[r.q4_n20] && M.VERDICT_M2[r.q4_truth]);
  }
});

test('case covers every row, is one of three, and does not change on reveal', () => {
  for (const { val } of sets) for (const r of val.month_rows) {
    const c = M.caseOf(r);
    assert.ok(['supported', 'uncertain', 'unsupported'].includes(c.id));
    const hidden = { ...r, actual: undefined, q4_truth: undefined, inside80: undefined, inside90: undefined, log1p_error: undefined, ratio_pred_to_actual: undefined };
    assert.deepEqual(M.caseOf(hidden), c, 'case must be computable before reveal');
    if (r.q4_n20 === 'cant_tell' || r.range_crosses_edge) assert.equal(c.id, 'uncertain'); else assert.equal(c.id, 'supported');
  }
  assert.equal(M.caseOf(null, 'unvalidated').id, 'unsupported');
  assert.equal(M.caseOf(null, 'raw').id, 'unsupported');
  assert.equal(M.caseOf(null, 'm1').id, 'unsupported');
});

test('featured month: the exported month equals the sha256 rule; the panel opens on it and states the rule', () => {
  for (const { val } of sets) for (const reg of val.regions) {
    const months = M.regionRows(val, reg.region_id).map((r) => r.month);
    const idx = Number(BigInt(`0x${createHash('sha256').update(`${val.provenance.lock_id}:${reg.region_id}`).digest('hex')}`) % BigInt(months.length));
    assert.equal(reg.featured_index, idx);
    assert.equal(reg.featured_month, months[idx]);
  }
  const d = src('decades.js');
  assert.match(d, /: reg\.featured_month;/, 'first month falls back to the exported featured month');
  assert.match(d, /FEATURED_LABEL\(rows\.length\)/);
  assert.match(M.FEATURED_LABEL(43), /^Opening month chosen by a fixed random rule, not picked to look good\. All 43 are in the grid\.$/);
});

test('approved wording A1–A10, A12 equals M2-AUDIT §9 verbatim on the real data', { skip: !real || !existsSync(path.join(ROOT, 'docs/m2/M2-AUDIT.md')) /* internal audit: not in the public release */ }, () => {
  const md = readFileSync(path.join(ROOT, 'docs/m2/M2-AUDIT.md'), 'utf8');
  const sec = md.slice(md.indexOf('## 9.'), md.indexOf('**Not approved'));
  const quotes = [...sec.matchAll(/^> "(.*)"$/gm)].map((m) => m[1]);
  const ids = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'];
  assert.equal(quotes.length, ids.length);
  const norm = (t) => t.replace(/[’‘]/g, "'");
  const { A } = M.approvedWording(real.val);
  for (const [i, id] of ids.entries()) { if (id === 'A11') continue; assert.equal(norm(A[id]), norm(quotes[i]), id); }
});

test('approved-wording numbers are read from data: changing the file changes the text', { skip: !real }, () => {
  const v = structuredClone(real.val);
  v.pooled.q1.cov90_covered -= 1;
  v.window.end = v.window.end.replace(/^\d{4}/, (y) => String(Number(y) + 1));
  v.pooled.q4.arms.n20_direct.confusion.counts[1][1] -= 1; // one within/within month becomes...
  v.pooled.q4.arms.n20_direct.confusion.counts[1][2] += 1; // ...a false flag
  const a = M.approvedWording(real.val).A; const b = M.approvedWording(v).A;
  assert.notEqual(a.A2, b.A2); assert.notEqual(a.A1, b.A1); assert.notEqual(a.A12, b.A12); assert.notEqual(a.A6, b.A6); assert.notEqual(a.A7, b.A7);
  assert.match(b.A7, new RegExp(`${M.confusionTallies(v.pooled.q4.arms.n20_direct.confusion).falseFlags} were wrongly flagged`));
});

test('confusion matrix: misses and false flags recomputed from the month rows match the exported matrix', () => {
  for (const { val } of sets) {
    const t = M.confusionTallies(val.pooled.q4.arms.n20_direct.confusion);
    const rows = val.month_rows;
    const misses = rows.filter((r) => ['above', 'below'].includes(r.q4_truth) && r.q4_n20 === 'within').length;
    const flags = rows.filter((r) => r.q4_truth === 'within' && ['above', 'below'].includes(r.q4_n20)).length;
    const agree = rows.filter((r) => r.q4_n20 !== 'cant_tell' && r.q4_n20 === r.q4_truth).length;
    assert.equal(t.unusualMissed, misses); assert.equal(t.falseFlags, flags); assert.equal(t.agree, agree);
    assert.equal(t.total, rows.length);
    assert.equal(t.decided, val.pooled.q4.arms.n20_direct.n_decided);
    const g = M.gridTally(rows); assert.equal(g.matched, agree); assert.equal(g.missed, rows.length - agree - g.none);
  }
});

test('wording: no banned words (incl. "not comparable"), no year literals; site labels come from data', () => {
  const texts = [...Object.values(M.KIND).map((k) => k.label), ...Object.values(M.VERDICT_M2).map((v) => v.word), M.FEATURED_LABEL(43),
    ...['validated', 'unvalidated', 'raw', 'm1'].map((k) => M.caseOf(k === 'validated' ? { q4_n20: 'within' } : null, k).badge)];
  for (const { val, manifest } of sets) {
    texts.push(...Object.values(M.approvedWording(val).A), val.pooled.q4.viirs_era_arm.site_label, val.pooled.q4.viirs_era_arm.crosstab_label);
    for (const r of manifest.m2_regions || []) texts.push(regionChip(r).word);
  }
  for (const t of texts) assert.deepEqual(bannedIn(t), [], t);
  for (const f of ['m2.js', 'decades.js']) {
    const s = src(f);
    assert.doesNotMatch(s, /not comparable/i, f);
    assert.deepEqual(s.match(/['"`\s(=]((19|20)\d\d)\b/g) || [], [], `${f} year literals`);
    assert.doesNotMatch(s, /\b(accurate|calibrated|seamless|harmoni[sz]ed|proves?)\b/i, f);
  }
  // the interval rule (core.verdictFor) must not drive the across-decades verdict
  assert.doesNotMatch(src('decades.js'), /verdictFor|revealOutcome/);
});

test('M2 chip: status read from the manifest window; M1 regions keep their chips', { skip: !real }, () => {
  for (const r of real.manifest.m2_regions) {
    const c = regionChip(r);
    assert.equal(c.word, `VIIRS estimates: validated (NOAA-20, ${core.yearOf(r.m2.validated_window.start)}–${core.yearOf(r.m2.validated_window.end)})`);
    assert.ok(c.m2 && c.title.includes(r.m2.status_label));
  }
  for (const r of real.manifest.regions) assert.ok(!regionChip(r).m2);
  const all = M.allRegions(real.manifest);
  assert.equal(all.length, real.manifest.regions.length + real.manifest.m2_regions.length);
  assert.ok(M.isM2Region(all[0]), 'M2 regions listed first');
});

test('keyboard: grid arrows clamp, Home/End stay in the row, PageUp/Down jump rows; Enter selects, R reveals', () => {
  assert.deepEqual(M.gridMove(4, [0, 0], 'ArrowLeft'), [0, 0]);
  assert.deepEqual(M.gridMove(4, [0, 0], 'ArrowRight'), [0, 1]);
  assert.deepEqual(M.gridMove(4, [3, 5], 'ArrowDown'), [3, 5]);
  assert.deepEqual(M.gridMove(4, [2, 5], 'ArrowUp'), [1, 5]);
  assert.deepEqual(M.gridMove(4, [2, 5], 'End'), [2, 11]);
  assert.deepEqual(M.gridMove(4, [2, 5], 'Home'), [2, 0]);
  assert.deepEqual(M.gridMove(8, [2, 5], 'PageDown'), [7, 5]);
  assert.equal(M.gridMove(4, [2, 5], 'x'), null);
  assert.equal(M.keyAction('Enter'), 'select'); assert.equal(M.keyAction(' '), 'select');
  assert.equal(M.keyAction('r'), 'reveal'); assert.equal(M.keyAction('R'), 'reveal'); assert.equal(M.keyAction('a'), null);
  const d = src('decades.js');
  assert.match(d, /role: 'grid'/); assert.match(d, /'aria-keyshortcuts': 'R'/); assert.match(d, /aria-live/);
});

test('grid model: rows are the test years, months before the window are disabled, missing test rows are hatched (never zero)', () => {
  for (const { val } of sets) for (const reg of val.regions) {
    const g = M.gridModel(val, reg.region_id);
    const cells = g.flatMap((y) => y.cells);
    assert.equal(cells.filter((c) => c.state === 'test').length, reg.n);
    for (const c of cells) {
      if (c.month < val.window.start) assert.equal(c.state, 'before');
      if (c.state === 'untested') assert.equal(c.row, null);
    }
  }
});

test('reduced motion: the reveal does not animate; CSS has a reduced-motion rule for the panel', () => {
  assert.equal(M.revealMotion(true), null);
  assert.ok(M.revealMotion(false).duration > 0);
  assert.match(src('decades.js'), /revealMotion\(prefersReducedMotion\(\)\)/);
  const css = readFileSync(path.join(ROOT, 'site/css/site.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.dc-ruler/);
});

test('error ratio (QA M3): converted value vs Aqua’s count, on count + 1, safe at zero', () => {
  assert.equal(M.errorRatio(0, 0).text, 'converted value within 5% of Aqua’s count');
  assert.equal(M.errorRatio(29, 9).text, 'converted value ×3.0 higher than Aqua’s count');
  assert.equal(M.errorRatio(9, 29).text, 'converted value ×3.0 lower than Aqua’s count');
  assert.equal(M.errorRatio(9, 29).note, 'ratio on count + 1');
  assert.equal(M.errorRatio(null, 3), null);
  assert.match(src('decades.js'), /er\.note/);
});

test('QA M1/M2: ✗ is "didn’t match" (not "missed"); per-region line has two labelled measures with denominators', () => {
  const d = src('decades.js');
  assert.doesNotMatch(d, /verdict missed|'missed'\)|✗ missed|✗ \$\{t\.missed\} missed/);
  assert.match(d, /'didn’t match'/); assert.match(d, /verdict didn’t match/);
  assert.match(d, /miss: 'missed'/, 'the table keeps "missed" for unusual -> within');
  for (const { val } of sets) for (const reg of val.regions) {
    const t = M.gridTally(M.regionRows(val, reg.region_id));
    assert.equal(M.regionCoverageLine(reg, t), `Inside the 90% range: ${reg.cov90_covered} of ${reg.n} · Verdict matched Aqua: ${t.matched} of ${t.n} (${t.missed} didn’t, ${t.none} can’t tell)`);
    assert.equal(t.matched + t.missed + t.none, reg.n);
  }
  assert.equal(M.tallyWords({ matched: 1, missed: 2, none: 3 }), '✓ 1 matched · ✗ 2 didn’t match · ? 3 can’t tell');
});

test('QA M4: Trust opening answer covers both tests, numbers from data', { skip: !real }, () => {
  const t = M.trustAnswer(real.val, { held: 2, tested: 4 });
  assert.match(t, new RegExp(`tested on ${real.val.pooled.q1.n} hidden months in ${real.val.regions.length} new study areas`));
  assert.match(t, new RegExp(`held Aqua’s count in ${real.val.pooled.q1.cov90_covered}\\.`));
  assert.match(t, /held up in 2 of the first 4 study areas\. Nothing after MODIS has been tested\.$/);
  const v = structuredClone(real.val); v.pooled.q1.cov90_covered -= 3;
  assert.notEqual(M.trustAnswer(v, { held: 2, tested: 4 }), t);
  assert.deepEqual(bannedIn(t), []);
  assert.match(src('trust.js'), /trustAnswer\(m2val, m1\)/); // M4.2: the M2 file is loaded once as m2val
});

test('minor wording: glossary entry, M1 line, Trust heading, old caption, season definition; A10 stays verbatim', { skip: !real }, () => {
  const g = M.m2Glossary(real.manifest);
  assert.equal(g.term, 'validated — NOAA-20');
  assert.match(g.plain, /^Met criteria set before testing, for daytime NOAA-20 → Aqua conversion on hidden months, \w+ \d{4} – \w+ \d{4}, in 5 study areas\. Not night, not \d{4} onward, not after MODIS\.$/);
  const d = src('decades.js');
  assert.match(d, /NOAA-20 conversion not independently validated in this region/);
  assert.match(d, /How close were the converted values\?/);
  assert.match(d, /seasonDefinition\(facts\.base\)/);
  assert.match(M.seasonDefinition('B'), /^Main burning season: the busiest calendar months that together hold at least 80% of the area’s Aqua B detections/);
  assert.match(src('trust.js'), /NOAA-20 is tested separately, above, in/);
  assert.match(src('main.js'), /m2Glossary\(manifest\)/);
  assert.match(d, /descriptive, from the M3 audit/);
  for (const t of [g.plain, M.seasonDefinition('B')]) assert.deepEqual(bannedIn(t), []);
});

test('strategist: raw verdict per month, collapsed post-window rows, drifted Aqua never styled as a check', () => {
  const d = src('decades.js');
  assert.match(d, /Not on Aqua’s scale \(unsupported\) — raw count would say: /); assert.match(d, /r\.q4_naive/);
  assert.match(d, /afterOpen: tmAfter/, 'post-window rows are collapsed unless the URL opens one');
  assert.match(d, /drifted Aqua is not a check/);
  assert.match(d, /ts-dot aqua\$\{tested \? '' : ' drift'\}/);
  assert.match(d, /it is not a test\./);
  // a post-window month is never "revealed", so it never gets ✓/✗ (the grid marks come from test rows only)
  assert.match(d, /if \(c\.state === 'test'\) \{/);
  assert.match(d, /Uncertain: the range crosses a band edge, so the verdict could go either way/);
  for (const { val } of sets) for (const r of val.month_rows) assert.ok(['below', 'within', 'above', 'cant_tell'].includes(r.q4_naive));
});
