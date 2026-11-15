// Plain-language story rules (M1.2). Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as S from '../../site/js/story.js';
import * as core from '../../site/js/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = path.join(ROOT, 'site/data');
const FIX = path.join(ROOT, 'site/data-fixtures');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const entries = (p50) => p50.map((v, i) => ({ month: i + 1, p50: v }));
const hasReal = existsSync(path.join(REAL, 'manifest.json'));

test('peak months: one contiguous run, a wrap-around run, two separate runs, ties', () => {
  assert.deepEqual(S.peakMonths(entries([1, 1, 1, 1, 1, 1, 1, 1, 9, 10, 1, 1])).main, [[8, 9]]);
  assert.deepEqual(S.peakMonths(entries([10, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2, 9])).main, [[11, 0]], 'Dec–Jan wraps');
  assert.deepEqual(S.peakMonths(entries([6, 2, 1, 1, 1, 1, 1, 1, 1, 1, 6, 10])).main, [[10, 11, 0]], 'extends across the year end at >= 50%');
  assert.equal(S.runLabel([10, 11, 0]), 'November–January');
  assert.deepEqual(S.peakMonths(entries([1, 1, 1, 10, 9, 1, 1, 1, 1, 10, 9, 1])).main, [[3, 4], [9, 10]], 'two seasons');
  assert.deepEqual(S.peakMonths(entries([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5])).main, [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], 'all tied');
  assert.equal(S.peakMonths(entries([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, null])), null, 'needs all 12 months');
  const two = S.seasonSentence('X', entries([1, 1, 1, 10, 9, 1, 1, 1, 1, 10, 9, 1]), 'A–B');
  assert.match(two.text, /two seasons of detections: April–May and October–November/);
  assert.match(two.text, /\(typical year A–B, measured by Aqua\)/);
  const glossed = S.seasonSentence('X', entries([1, 1, 1, 10, 9, 1, 1, 1, 1, 10, 9, 1]), 'A–B', { aquaFrom: 7 });
  assert.match(glossed.text, /October–November\. Typical year A–B, as measured by Aqua \(NASA’s older satellite, measuring since 7\)\.$/);
});

test('peak months: a smaller, separate second season is named (Punjab-like shape)', () => {
  // peak Oct, Nov >= 50% joins it; May is >= 20% of the max and cut off by months < 10% on both sides
  const pk = S.peakMonths(entries([113, 93, 51, 449, 1652, 38, 7, 8, 94, 7570, 5643, 226]));
  assert.deepEqual(pk.main, [[9, 10]]);
  assert.deepEqual(pk.second, [[4]]);
  // no deep trough between the runs -> no second season (Iberia-like shape)
  assert.deepEqual(S.peakMonths(entries([44, 178, 142, 126, 60, 100, 208, 393, 203, 309, 76, 49])).second, []);
});

test('real data: season sentences match the exported baselines', { skip: !hasReal }, () => {
  const m = read(path.join(REAL, 'manifest.json'));
  const want = { punjab_haryana: /in October–November, with a smaller second season in May/, n_australia_topend: /in May–October/, iberia_control: /in July–October/, car_sudanian: /in December–January/ };
  for (const r of m.regions) {
    const s = read(path.join(REAL, r.series_path));
    const t = S.seasonSentence(S.shortName(r.name), s.baseline.entries, core.baselinePeriodLabel(s, [])).text;
    if (want[r.id]) assert.match(t, want[r.id], `${r.id}: ${t}`);
    assert.deepEqual(S.bannedIn(t), [], t);
    assert.ok(!/burn/i.test(t), 'never "burn the most"');
  }
});

test('"provisional" appears only on months estimated from VIIRS, never on measured months', () => {
  const files = [path.join(FIX, 'manifest.json'), ...(hasReal ? [path.join(REAL, 'manifest.json')] : [])];
  for (const mf of files) {
    const m = read(mf);
    for (const r of m.regions) {
      const p = path.join(path.dirname(mf), r.series_path || `region/${r.id}/series.json`);
      if (!existsSync(p)) continue;
      for (const row of read(p).months) {
        for (const v of ['above', 'within', 'below', 'unknown', 'none']) {
          const s = S.monthSentence(row, { verdict: v, period: 'P', region: r, eras: m.eras });
          const text = [s.text, ...s.caveats.map((c) => c.text)].join(' ');
          if (!core.isViirsDerived(row)) assert.ok(!/provisional/i.test(text), `${r.id} ${row.month}: ${text}`);
          if (core.isViirsDerived(row) && r.status !== 'validated') assert.ok(s.caveats.some((c) => c.key === 'provisional'), `${r.id} ${row.month}`);
          if (core.isViirsDerived(row)) assert.ok(s.caveats.some((c) => c.key === 'estimated'));
        }
      }
    }
  }
});

test('must-show caveats: drift-era verdicts are unconfirmed; not observed is not zero', () => {
  const eras = [{ id: 'modis_only', start: '2002-07', end: '2011-12' }, { id: 'aqua_drift', start: '2022-01', end: null }];
  const measuredDrift = { month: '2025-12', era: 'aqua_drift', quality: ['aqua_drift'], record: { source: 'observed_aqua', value: 5 }, native: { aqua: { status: 'observed', n: 5 } } };
  for (const v of ['above', 'within', 'below']) {
    const c = S.mustShowCaveats(measuredDrift, { status: 'provisional' }, eras, v);
    assert.ok(c.some((k) => k.key === 'drift_unconfirmed' && /unconfirmed/.test(k.text)));
    assert.ok(!c.some((k) => k.key === 'provisional'), 'measured month: never provisional');
  }
  const early = { ...measuredDrift, month: '2005-06', era: 'modis_only', quality: [] };
  assert.deepEqual(S.mustShowCaveats(early, { status: 'provisional' }, eras, 'above'), []);
  const missing = { month: '2005-06', era: 'modis_only', quality: [], record: { source: 'not_observed', value: null }, native: { aqua: { status: 'not_observed', n: null } } };
  const c = S.mustShowCaveats(missing, { status: 'validated' }, eras, 'none');
  assert.ok(c.some((k) => k.key === 'not_observed' && /not a zero/.test(k.text)));
  assert.match(S.DETECTION_NOTE, /not a count of separate fires/);
  assert.deepEqual(S.bannedIn(S.DETECTION_NOTE), [], 'the detection note itself is allowed');
});

test('Trust story: numbers from validation.json, operator decision stated, no pooled-coverage badge, no banned words', { skip: !hasReal }, () => {
  const m = read(path.join(REAL, 'manifest.json'));
  const v = read(path.join(REAL, 'validation.json'));
  if (v.status !== 'evaluated') return;
  const t = S.trustStory(m, v, 'aqua_equiv_ratio');
  // M1.3: the plain metric replaced "typically off by about X%"; its numbers are checked in m13.test.mjs
  assert.ok(t.error && !/typically off/i.test(t.error), t.error);
  if (v.decision && v.decision.outcome === 'fallback_to_baseline') assert.match(t.operator, /did not pass the bar we set before testing/);
  const all = [t.answer, t.experiment, t.error, t.ranges, t.operator, t.notTested, t.primary, t.secondary].join(' ');
  assert.deepEqual(S.bannedIn(all), [], all);
  assert.ok(!/✓|\bpass(ed)?\b.*coverage|coverage.*\bpass/i.test(all), 'pooled coverage pass is never the trust badge');
  for (const y of (m.regions[0].held_out_years || [])) assert.ok(t.experiment.includes(String(y)));
  const held = m.regions.filter((r) => r.status === 'validated');
  for (const r of held) assert.ok(t.ranges.includes(S.shortName(r.name)));
  assert.match(t.answer, /^Partly/);
  assert.match(t.notTested, /after MODIS ends/);
});

test('glossary covers the agreed terms and contains no banned wording', () => {
  const g = S.glossary({ heldOut: [1, 2], baseline: 'A–B', driftFrom: 3 });
  const terms = g.map((x) => `${x.term} ${x.also || ''}`.toLowerCase()).join(' | ');
  for (const k of ['detection', 'harmonization', 'held-out', 'likely range', 'provisional', 'validated', 'drift', 'aqua-scale', 'can’t tell', 'not observed', 'ratio method', 'forward operator', 'estimated', 'usual', 'after modis']) assert.ok(terms.includes(k), k);
  for (const x of g) assert.deepEqual(S.bannedIn(`${x.plain}`), [], x.term);
});

test('drift wording: never "less certain" or "not comparable" in user-facing core words', () => {
  assert.ok(!/less certain/i.test(core.QUALITY_WORD.aqua_drift));
  assert.ok(!/less certain|not comparable/i.test(S.eraPlain({ id: 'aqua_drift', start: '2022-01', end: null })));
});

test('plain glosses: chips say what was tested; Aqua, VIIRS and the conversion are explained with years from data', () => {
  assert.equal(S.regionChip({ status: 'validated' }).word, 'VIIRS estimates: validated (S-NPP)');
  assert.equal(S.regionChip({ status: 'provisional' }).word, 'Aqua measured · VIIRS estimates: provisional, not yet reliable (S-NPP)');
  assert.match(S.CHIP_EXPLAINER, /newer satellite’s numbers convert to the older one’s scale/);
  const y = S.satelliteYears({ eras: [{ id: 'modis_only', start: '2002-07' }, { id: 'overlap', start: '2012-01' }] });
  assert.deepEqual(y, { aquaFrom: 2002, viirsFrom: 2012 });
  assert.match(S.rangeNote(0.9), /about 9 times in 10/);
  if (hasReal) {
    const m = read(path.join(REAL, 'manifest.json')); const v = read(path.join(REAL, 'validation.json'));
    const t = S.trustStory(m, v, 'aqua_equiv_ratio');
    assert.match(t.experiment, /Aqua \(NASA’s older satellite, measuring since \d{4}\)/);
    assert.match(t.experiment, /VIIRS \(the newer satellite instrument, since \d{4}\)/);
    assert.ok(t.experiment.includes(S.CONVERSION_GLOSS));
    for (const e of m.eras) assert.deepEqual(S.bannedIn(S.eraPlain(e)), [], S.eraPlain(e));
  }
});
