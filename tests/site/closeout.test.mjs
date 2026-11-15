// M1.3 closeout: short Trust intro, caveats kept below the reveal, plain first mentions, token contrast, sheet a11y.
// Run: node --test tests/site/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as S from '../../site/js/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = path.join(ROOT, 'site/data');
const hasReal = existsSync(path.join(REAL, 'manifest.json')) && existsSync(path.join(REAL, 'validation.json'));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const src = (f) => readFileSync(path.join(ROOT, 'site', f), 'utf8');

test('Trust intro is the short answer plus one short sentence; the experiment and the "not a replacement" caveat move to the summary', () => {
  const trust = src('js/trust.js');
  const intro = trust.slice(trust.indexOf('function intro('), trust.indexOf('function shortLimits('));
  assert.ok(intro.includes('story.answer') && intro.includes('story.lead'), 'intro = answer + lead');
  assert.ok(!intro.includes('story.experiment'), 'the long experiment sentence is not in the intro');
  assert.ok(!/blockquote/.test(intro));
  // the caveats are still on the page, in "What the test shows"
  const summary = trust.slice(trust.indexOf("class: 'trust-summary'"), trust.indexOf("class: 'trust-summary'") + 900);
  assert.match(summary, /story\.experiment/);
  assert.match(summary, /REQUIRED_COPY/);
  // M4.5: the guided S-NPP walk is retired (each S-NPP region has its own Time Machine); examples stay framed as examples
  assert.doesNotMatch(trust, /async function guided\(/);
  assert.match(src('js/machine.js'), /One genuine held-out example, not a guarantee/);
});

test('Trust lead: one sentence, short, plain glosses for Aqua/MODIS/VIIRS, no banned words or year literals', { skip: !hasReal }, () => {
  const m = read(path.join(REAL, 'manifest.json')); const v = read(path.join(REAL, 'validation.json'));
  if (v.status !== 'evaluated') return;
  const t = S.trustStory(m, v, 'aqua_equiv_ratio');
  assert.ok(t.lead.length <= 140, `${t.lead.length} chars`);
  assert.equal((t.lead.match(/[.!?](\s|$)/g) || []).length, 1, 'one sentence');
  assert.match(t.lead, /Aqua MODIS counts \(the older sensor\)/);
  assert.match(t.lead, /newer VIIRS sensor/);
  assert.ok(!/(?:19|20)\d\d/.test(t.lead));
  assert.deepEqual(S.bannedIn(t.lead), []);
  assert.ok(!/Here is how we checked/.test(t.answer), 'answer is not padded');
  assert.ok(t.answer.length <= 200, `${t.answer.length} chars`);
  assert.match(t.experiment, /^How we checked: /);
  if (t.ranges && /provisional/.test(t.ranges)) assert.match(t.ranges, /provisional \(not yet reliable\)/);
});

test('region page: Aqua is glossed on first mention in the headline sentence', () => {
  const e = [1, 1, 1, 1, 1, 1, 1, 1, 9, 10, 1, 1].map((v, i) => ({ month: i + 1, p50: v }));
  assert.match(S.seasonSentence('X', e, 'P', null, 'D').text, /^Aqua \(NASA’s older satellite\) records/);
  assert.match(S.seasonSentence('X', e, 'P', { aquaFrom: 7 }, 'D').text, /^Aqua records .* as measured by Aqua \(NASA’s older satellite, measuring since 7\)/);
});

// WCAG 2.x relative luminance contrast, from the CSS tokens actually shipped
const tokens = Object.fromEntries([...src('css/site.css').matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((x) => [x[1], x[2]]));
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('token contrast: body/muted text >= 4.5:1 and control borders (--rule-strong) >= 3:1 on paper and plate', () => {
  for (const bg of ['paper', 'plate']) {
    assert.ok(ratio(tokens.ink, tokens[bg]) >= 4.5);
    assert.ok(ratio(tokens.muted, tokens[bg]) >= 4.5, `muted on ${bg}: ${ratio(tokens.muted, tokens[bg]).toFixed(2)}`);
    assert.ok(ratio(tokens['rule-strong'], tokens[bg]) >= 3, `rule-strong on ${bg}: ${ratio(tokens['rule-strong'], tokens[bg]).toFixed(2)}`);
  }
  // the zero swatch is told apart from the blank one by a solid vs dashed edge, not by its fill alone
  assert.match(src('css/site.css'), /\.sw-zero \{[^}]*border: 1px solid var\(--rule-strong\)/);
  assert.match(src('css/site.css'), /\.sw-blank \{[^}]*border: 1px dashed var\(--rule-strong\)/);
});

test('month sheet is modal on phones with Tab kept inside; the year is announced once', () => {
  const region = src('js/region.js');
  assert.match(region, /setAttribute\('aria-modal', sheetMode \? 'true' : 'false'\)/);
  assert.match(region, /ev\.key !== 'Tab' \|\| !detail\.classList\.contains\('is-sheet'\)/);
  assert.match(region, /ev\.target !== scrim/, 'a scrim tap closes with focus returned');
  assert.match(region, /class: 'visually-hidden', text: tallyText\(/);
  assert.ok(!/class: 'ys-year', 'aria-live'/.test(src('js/season.js')), 'the year label is not a second live region');
  assert.match(src('js/trust.js'), /prefersReducedMotion\(\) \? 'auto' : 'smooth'/);
});
