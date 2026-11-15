// Unified region page (M4 information-architecture review): one structure for all nine study regions,
// operational critical-period definitions computed from published data only.
// Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../../site/js/core.js';
import * as P from '../../site/js/periods.js';
import { allRegions } from '../../site/js/m2.js';
import { bannedIn } from '../../site/js/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const src = (p) => readFileSync(path.join(ROOT, 'site/js', p), 'utf8');
const real = existsSync(path.join(ROOT, 'site/data/manifest.json')) ? read('site/data/manifest.json') : null;
const regions = real ? allRegions(real).map((r) => ({ r, s: read(`site/data/${r.series_path}`) })) : [];

test('all nine study regions load and share one page structure (no region-type layout branch at the top)', { skip: !real }, () => {
  assert.equal(regions.length, 9);
  const r = src('region.js');
  // M4.1ux shared order: status chip (once) -> findings -> hero seasonal chart -> unusual-month timeline -> full calendar -> optional tool
  const order = ["'chip-d status-chip'", 'findingsPanel(', "'season-view'", 'timelinePanel(', "'Full burning calendar'", 'optional-tool'].map((k) => r.indexOf(k));
  assert.ok(order.every((i) => i > 0), `all sections present: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections in the shared order');
  assert.doesNotMatch(r.slice(0, r.indexOf('findingsPanel(')), /if \(m2\) root\.append\(\(await decadesPanel/, 'Across decades no longer leads M2 pages');
  assert.doesNotMatch(r, /if \(m2\)[^\n]*(findingsPanel|seasonHero|timelinePanel)/, 'no region-type branch around the shared sections');
  assert.match(r, /if \(params\.all === '1'/, 'full calendar behind "Show every month" by default (M4.1ux)');
});

test('main season: fewest months reaching the share, from the published baseline', { skip: !real }, () => {
  for (const { r, s } of regions) {
    const { env, minYears } = core.envelopeFor(s, real.eras);
    const ms = P.mainSeason(env, minYears);
    assert.ok(ms, r.id);
    assert.ok(ms.share >= P.SEASON_SHARE, `${r.id} share ${ms.share}`);
    const p50 = (i) => env[i].p50;
    const without = ms.share - p50(ms.months.reduce((a, b) => (p50(a) < p50(b) ? a : b))) / ms.total;
    assert.ok(without < P.SEASON_SHARE, `${r.id}: minimal set`);
  }
});

test('recurring counts: measured Aqua only, after the baseline, before the drift era', { skip: !real }, () => {
  for (const { r, s } of regions) {
    const { env } = core.envelopeFor(s, real.eras);
    const rec = P.recurringAbove(s.months, env);
    const baseEnd = Math.max(...env.flatMap((e) => e.years));
    assert.ok(rec.years.every((y) => y > baseEnd), `${r.id}: no baseline year judged against itself`);
    const drift = new Set(s.months.filter((m) => ['aqua_drift', 'post_modis'].includes(m.era)).map((m) => core.yearOf(m.month)));
    assert.ok(rec.years.every((y) => !drift.has(y)), `${r.id}: no drift-era year`);
    for (const [i, o] of rec.months.entries()) {
      assert.equal(o.above + o.within + o.below, o.decided);
      assert.ok(o.decided <= rec.years.length);
      assert.equal(o.flagged, o.decided >= P.RECUR_MIN_YEARS && o.above >= P.RECUR_MIN, `${r.id} m${i + 1}`);
      for (const y of o.years) {
        const row = s.months.find((m) => core.yearOf(m.month) === y && core.monthIndex(m.month) === i);
        assert.equal(core.rulerValue(row, 'record').kind, 'observed', `${r.id} ${row.month}: estimates never count`);
      }
    }
  }
});

test('unusual months carry a source kind; estimated ones name the region status', { skip: !real }, () => {
  for (const { r, s } of regions) {
    const { env } = core.envelopeFor(s, real.eras);
    for (const u of P.unusualMonths(s.months, env, r.status)) {
      assert.ok(['above', 'below', 'uncertain'].includes(u.cls));
      assert.ok(['observed', 'observed_drift', 'estimated'].includes(u.kind.key), u.kind.key);
      if (u.kind.key === 'estimated') assert.match(u.kind.word, /conversion held up|provisional: not yet reliable|not validated/);
      if (u.cls === 'uncertain') assert.equal(core.rulerValue(u.r, 'record').kind, 'modelled');
    }
  }
});

test('periods panel copy: no forecasts or alerts, no banned words, no year literals', () => {
  const p = src('periods.js');
  assert.deepEqual(bannedIn(p), []);
  assert.doesNotMatch(p, /\b(19|20)\d\d\b/);
  assert.doesNotMatch(p, /\b(forecast(s|ing)? (of|the) |predicts?|early warning|alert)\b/i);
  assert.match(p, /not a forecast/);
  assert.match(p, /not a warning/);
});

test('monthSpan wraps the year end', () => {
  assert.equal(P.monthSpan([0, 1, 11]), 'Dec–Feb');
  assert.equal(P.monthSpan([6, 7, 8, 9]), 'Jul–Oct');
  assert.equal(P.monthSpan([2, 4]), 'Mar, May');
});
