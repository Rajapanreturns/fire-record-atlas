// Can we trust it? (M4.2) One strong visual story first, depth on demand:
//   1. the question, a qualified answer and three DISTINCT headline measures (range check, size of error, verdict);
//   2. Predict -> Reveal on real NOAA-20 test months (a success and a miss, chosen by a fixed rule from the data);
//   3. where the conversion is validated, provisional or untested;
//   4. "Explore all test months" (every month, filters, table) behind one obvious control;
//   5. "Scientific details" (collapsed): statistics, matrices, method, robustness, the earlier S-NPP test, audit flags.
// The withheld Aqua value is hidden until the reader asks for it (a UI rule; the file is not encrypted).
import { revealCards, methodRole, methodName, defaultTrustRegion, formatAuditFlag, resultCopy, isPooledRegion, MONTH_ABBR, monthIndex, monthLabel, PLATFORM_LABEL, yearOf } from './core.js';
import { loadValidation, loadSeries } from './data.js';
import { h, glyph, fmtN, fmtInterval, fixtureVeil, errorBox, prefersReducedMotion, openTo } from './ui.js';
import { regionGeoNote } from './story.js';
import { trustStory, revealOutcome, isMiss, shortName, regionChip, rangeNote, TRUST_QUESTION, provisionalLine, trustCoverage, recordSpan, PROVISIONAL_NOTE, PROVISIONAL_DETAIL } from './story.js';
import { m2TrustData, trustMetricTiles, trustExplorer, trustStatistics, trustMatrices, trustMethod, trustRobustness } from './decades.js';
import { trustAnswer, plainAnswer, approvedWording } from './m2.js';
import { timeMachine } from './machine.js';
import { miniMap } from './minimap.js';
import { regionCase, m1Limits } from './trustcase.js';
import { scopeFacts } from './m2.js';
import { REQUIRED_COPY_M2 } from './decades.js';
import { baselinePeriodLabel } from './core.js';
import { trustRoute, westEast, regionOptionText, trustRegionGroups, trustParams, regionFacts, regionAnswer, periodWords, covWords, REGION_CASE_RULE, nearestStudyRegion, regionMonthMarks, UNSUPPORTED_LINE, ALL, typicalFactor, seasonLine, q3Line, D7 } from './trustctx.js';

const REQUIRED_COPY = 'We predict withheld MODIS months to test the conversion, not because real MODIS measurements should be replaced.';
const revealed = new Set(); // per session only


export async function renderTrust(ctx, requestedRegion = null) {
  const { manifest } = ctx;
  const science = !!ctx.params.science; // ?science=1 opens Scientific details
  let val;
  try { val = await loadValidation(manifest); } catch (e) {
    return h('div', {}, intro(null), errorBox('Test results could not be loaded', e, 'Nothing is shown in their place.'), limitations(null, manifest));
  }
  const fixture = val.kind === 'fixture';
  const methods = Object.fromEntries((manifest.methods || []).map((m) => [m.id, m]));
  // The method the published record uses (region.method), most common across regions.
  const mc = {}; for (const r of manifest.regions) if (r.method) mc[r.method] = (mc[r.method] || 0) + 1;
  const recordMethod = Object.keys(mc).sort((a, b) => mc[b] - mc[a])[0] || null;
  const tagOf = (id) => { const meta = methods[id] || {}; if (id === recordMethod) return 'used by the record'; if (methodRole(meta) === 'candidate') return 'more detailed model, not adopted'; return /clim/i.test(`${id} ${meta.label}`) ? 'do-nothing guess: the usual month, ignores VIIRS' : 'baseline'; };
  const rank = (id) => (id === recordMethod ? 0 : methodRole(methods[id]) === 'candidate' ? 1 : 2);
  const nameOf = (id) => methodName(methods[id] || { id });
  const plainName = (id) => (id === recordMethod ? 'Our estimate' : methodRole(methods[id]) === 'candidate' ? 'More detailed model (not adopted)' : /clim/i.test(`${id} ${(methods[id] || {}).label}`) ? 'Guessing the usual month' : nameOf(id));
  const story = val.status === 'evaluated' ? trustStory(manifest, val, recordMethod) : null;
  const m2val = await m2TrustData(manifest);
  // M4.5: one routing decision (trustctx.trustRoute, table-tested). A region (or no region, without an evidence signal)
  // opens that region's Time Machine page; region=all and old evidence deep links open the full evidence hub.
  const route = trustRoute({ ...ctx.params, region: requestedRegion }, location.hash, manifest);
  const sel = route.mode === 'custom' ? { mode: 'custom', at: route.at } : route.mode === 'unknown' ? { mode: 'unknown', raw: route.raw } : { mode: 'all' };
  if (route.mode === 'machine' && val.status === 'evaluated') {
    const node = await regionView(ctx, manifest, val, m2val, route);
    if (node) return node;
  }
  if (sel.mode === 'custom') {
    // a place inside a study box has that region's own evidence: show it instead of "unsupported" (QA note)
    const near = nearestStudyRegion(manifest, sel.at);
    if (near && near.inside) { ctx.navigate(trustParams(near.region.id), { replace: true }); return h('div', {}); }
    return unsupportedView(ctx, manifest, sel.at);
  }
  requestedRegion = ctx.params.pick || null; // the All view's S-NPP picker / NOAA-20 explorer pre-selection (was ?region=)

  if (val.status !== 'evaluated') {
    const root0 = h('div', { class: 'view-enter trust' }, regionSwitcher(ctx, manifest, ALL), intro(story));
    const held = [...new Set(manifest.regions.flatMap((r) => r.held_out_years || []))].sort();
    root0.append(h('div', { class: 'locked' },
      h('div', { class: 'lockbox' }, fixtureVeil(fixture),
        h('h2', { text: 'Not yet tested' }),
        h('p', { text: val.reason || 'The hidden-year test has not been run.' }),
        h('p', { class: 'caption', text: 'No scores, error bars or pass marks are shown until the pre-registered test run exists. Months estimated from VIIRS stay marked provisional meanwhile.' })),
      h('div', {},
        h('h2', { class: 'section-title', text: 'What will appear here' }),
        h('ul', {},
          h('li', { text: `For each hidden month (years ${held.join(', ') || 'set in the pre-registration'}), our estimate of what Aqua measured, with its likely range.` }),
          h('li', { text: 'Then the value Aqua actually measured, revealed only when you ask.' }),
          h('li', { text: 'A scoreboard with the sample size beside every number.' })))));
    root0.append(limitations(null, manifest));
    return root0;
  }

  const cards = revealCards(val);
  const regionIds = [...new Set(cards.map((c) => c.region_id))];
  const strata = [...new Set(cards.map((c) => c.stratum))];
  const okRequested = requestedRegion && regionIds.includes(requestedRegion) && cards.some((c) => c.region_id === requestedRegion && c.stratum === 'held_out');
  const state = { region: okRequested ? requestedRegion : defaultTrustRegion(manifest, regionIds), stratum: strata.includes('held_out') ? 'held_out' : strata[0], key: null, misses: false };
  const regionOf = (id) => manifest.regions.find((r) => r.id === id) || {};
  const regionName = (id) => regionOf(id).name || id;

  // ---------- default view (NOAA-20 test): question, answer, three measures, Predict -> Reveal, coverage, explorer ----------
  const root = h('div', { class: 'view-enter trust tr-page' });
  const unknownRaw = sel.mode === 'unknown' ? sel.raw : '';
  root.append(regionSwitcher(ctx, manifest, ALL, unknownRaw));
  const m1 = { held: manifest.regions.filter((r) => r.status === 'validated').length, tested: manifest.regions.filter((r) => ['validated', 'provisional'].includes(r.status)).length };
  let explorer = null;
  let answerVerbatim = null;
  if (m2val) {
    // QA M4: the opening answer covers both tests (numbers from data). QA H4: the hero leads with the same facts in plain
    // words (plainAnswer); the approved trustAnswer stays verbatim in Scientific details.
    answerVerbatim = trustAnswer(m2val, m1);
    const plain = plainAnswer(m2val, m1);
    const prov = provisionalLine(manifest);
    const m2Requested = requestedRegion && (m2val.regions || []).some((g) => g.region_id === requestedRegion) ? requestedRegion : null;
    // M4.5: the hub has no demo of its own; opening an explorer month goes to that region's Time Machine on that month
    const onTry = (row) => ctx.navigate({ view: 'trust', region: row.region_id, month: row.month });
    explorer = trustExplorer(m2val, manifest, { onTry, region: m2Requested });
    explorer.m2Requested = m2Requested;
    const def = (manifest.m2_regions || []).find((r) => r.status === 'validated');
    root.append(h('div', { class: 'tr-hero no-demo' },
      h('div', { class: 'tr-lead' },
        h('p', { class: 'tr-kicker', text: 'Full scientific evidence' }),
        h('h1', { class: 'tr-question', text: TRUST_QUESTION }),
        h('p', { class: 'answer tr-answer' }, h('strong', { text: plain.lead }), ' ', plain.main, ' ', plain.rest),
        prov ? h('p', { class: 'tr-prov', text: prov }) : '',
        h('p', { class: 'caption tr-a1', 'data-claim': 'A1', text: approvedWording(m2val).A.A1 }),
        def ? h('p', {}, h('a', { class: 'btn btn-primary tr-try', href: hrefFor(ctx, { view: 'trust', region: def.id }), 'data-nav': 'trust', text: 'Try a hidden month →' })) : '',
        trustMetricTiles(m2val))));
    root.append(coverage(manifest, m2val), explorer.el);
  } else root.append(intro(story));

  // ---------- the earlier S-NPP test (M1): guided walk, picker, plain summary, numbers, method details ----------
  const m1Body = h('div', { class: 'tr-m1' });
  m1Body.append(h('p', { class: 'dt-m1-h', text: `The earlier test: S-NPP conversion in the first ${manifest.regions.length} study regions.` }), story ? h('p', { class: 'caption', text: `${story.answer} ${story.lead}` }) : '');
  // M4.5: the guided S-NPP walk is gone; every S-NPP region now has its own Time Machine (its region page)

  const cardBox = h('div', { class: 'pr-card' });
  const picker = h('div', { class: 'picker' });
  const regionSel = h('select', { id: 'tr-region', onchange: (e) => { state.region = e.target.value; state.key = null; ctx.setParams({ pick: state.region }); paint(); } },
    ...regionIds.map((id) => h('option', { value: id, selected: id === state.region, text: `${shortName(regionName(id))} (${regionChip(regionOf(id)).word})` })));
  const missBox = h('input', { type: 'checkbox', id: 'tr-miss', onchange: (e) => { state.misses = e.target.checked; paint(); } });
  m1Body.append(h('section', { class: 'reveal', 'aria-labelledby': 'pr-h' },
    h('h2', { class: 'section-title reveal-title', id: 'pr-h', text: 'Try any S-NPP test month' }),
    h('p', { class: 'caption', text: 'Every hidden test month, in every tested region. Predict where Aqua’s count falls, then reveal it, or show the misses straight away.' }),
    h('div', { class: 'select-line' }, h('label', { for: 'tr-region', text: 'Region' }), regionSel,
      h('label', { class: 'check', for: 'tr-miss' }, missBox, ' Show the misses')),
    h('div', { class: 'reveal-grid' }, cardBox, picker)));

  // the answer in plain words, visible by default
  const summary = h('section', { class: 'trust-summary', 'aria-labelledby': 'sum-h' }, fixtureVeil(fixture),
    h('h2', { class: 'section-title', id: 'sum-h', text: 'What the test shows' }),
    h('ul', { class: 'summary-list' },
      h('li', { 'data-claim': 'how', text: story.experiment }),
      h('li', { 'data-claim': 'why', text: REQUIRED_COPY }),
      story.metric ? h('li', { 'data-claim': 'error' }, h('span', { text: story.metric.text }), h('span', { class: 'claim-label', text: ` ${story.metric.label}` }),
        h('details', { class: 'caption metric-more' }, h('summary', { text: 'How this is counted' }),
          h('p', { text: story.metric.detail }), h('p', { text: story.metric.definitions }), story.metric.stretchLine ? h('p', { text: story.metric.stretchLine }) : null)) : '',
      story.ranges ? h('li', { 'data-claim': 'ranges', text: story.ranges }) : '',
      h('li', { 'data-claim': 'primary', text: story.primary }),
      h('li', { 'data-claim': 'secondary', text: story.secondary }),
      story.operator ? h('li', { 'data-claim': 'operator', class: 'operator', text: story.operator }) : '',
      h('li', { 'data-claim': 'not-tested', text: story.notTested })),
    h('details', { class: 'more' }, h('summary', { text: 'The numbers behind this' }), resultBlock(val, methods, recordMethod, nameOf, fixture, manifest)));
  m1Body.append(summary);

  function visible() { return cards.filter((c) => c.region_id === state.region && c.stratum === state.stratum); }

  function paint() {
    const list = visible();
    if (!state.key || !list.find((c) => c.key === state.key)) state.key = (list.find((c) => !revealed.has(c.key) && c.actual_status === 'observed') || list[0] || {}).key;
    paintCard(list.find((c) => c.key === state.key), list);
    paintPicker(list);
  }

  let othersOpen = false;
  function paintCard(card, list) {
    cardBox.replaceChildren(fixtureVeil(fixture));
    if (!card) { cardBox.append(h('p', { text: 'No test months for this selection.' })); return; }
    const isOpen = revealed.has(card.key);
    const sorted = [...card.methods].sort((a, b) => rank(a.method_id) - rank(b.method_id));
    const mine = sorted.find((m) => m.method_id === recordMethod) || sorted[0];
    const others = sorted.filter((m) => m !== mine);
    const scoreable = card.actual_status === 'observed' && card.actual != null;
    const vals = sorted.flatMap((m) => [m.predicted, m.lo, m.hi]).filter((v) => v != null);
    if (isOpen && scoreable) vals.push(card.actual);
    const max = Math.max(1, ...vals) * 1.08;
    const sx = (v) => 6 + (v / max) * 288;
    cardBox.append(h('h3', { class: 'pr-when', text: `${monthLabel(card.month)} · ${shortName(regionName(card.region_id))}` }),
      h('p', { class: 'ctx', text: `${card.stratum === 'held_out' ? '† A hidden test year: this year was hidden; neighbouring years were used to build the conversion.' : 'A drift year: Aqua itself was drifting (exploratory).'} Estimated from ${PLATFORM_LABEL[card.input_platform] || card.input_platform}${card.daynight === 'D' ? ', daytime' : card.daynight === 'N' ? ', night' : ''}.` }));
    const row = (m) => {
      const iv = fmtInterval(m.lo, m.hi);
      return h('div', { class: 'pr-row' },
        h('div', { class: 'who' }, plainName(m.method_id), h('small', { text: tagOf(m.method_id) })),
        bar(sx, m.lo, m.hi, m.predicted, isOpen && scoreable ? card.actual : null),
        h('div', { class: 'val' }, fmtN(m.predicted, 1), h('div', { class: 'muted', style: 'font-size:.75rem', text: iv ? `likely ${iv}` : 'no likely range' })));
    };
    const rows = h('div', { class: 'pr-rows' }, row(mine));
    rows.append(h('div', { class: `pr-row actual${isOpen ? '' : ' hidden-actual'}` },
      h('div', { class: 'who' }, 'What Aqua measured', h('small', { text: scoreable ? 'real measurement, hidden from the method' : `Aqua ${card.actual_status.replace(/_/g, ' ')}` })),
      bar(sx, null, null, null, isOpen && scoreable ? card.actual : null, true),
      h('div', { class: 'val', text: !scoreable ? 'not scoreable' : isOpen ? fmtN(card.actual) : '?' })));
    cardBox.append(rows);

    const outcome = h('p', { class: 'pr-outcome', 'aria-live': 'polite', tabindex: '-1' });
    if (!scoreable) outcome.textContent = `Aqua did not provide a usable value for this month (${card.actual_status.replace(/_/g, ' ')}). It is never scored.`;
    else if (isOpen) {
      const o = revealOutcome(mine.predicted, card.actual, mine.lo, mine.hi);
      outcome.append(h('b', { text: `${o.point}. ${o.range}.` }), ' ', o.text);
    } else outcome.textContent = 'Where do you think the real value falls? Then reveal it.';
    cardBox.append(outcome, h('p', { class: 'caption range-note', text: rangeNote(val.interval_level) }));

    const idx = list.indexOf(card);
    const revealBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: isOpen || !scoreable, onclick: () => { revealed.add(card.key); paint(); cardBox.querySelector('.pr-outcome')?.focus(); } }, isOpen ? 'Revealed' : 'Reveal what Aqua measured');
    const nextBtn = h('button', { class: 'btn btn-quiet', type: 'button', disabled: idx >= list.length - 1, onclick: () => { state.key = list[idx + 1].key; paint(); cardBox.querySelector('.btn-primary:not([disabled])')?.focus(); } }, 'Next month');
    cardBox.append(h('div', { class: 'pr-actions' }, revealBtn, nextBtn, h('span', { class: 'caption', text: `${list.filter((c) => revealed.has(c.key)).length} of ${list.length} revealed` })));

    if (others.length) {
      const det = h('details', { class: 'more others', open: othersOpen || null }, h('summary', { text: 'Show the other methods' }),
        h('div', { class: 'pr-rows' }, ...others.map(row)));
      det.addEventListener('toggle', () => { othersOpen = det.open; });
      if (isOpen && scoreable) {
        det.append(h('div', { class: 'caption' }, ...others.map((m) => h('span', { style: 'display:block' }, h('b', { text: `${plainName(m.method_id)}: ` }), revealOutcome(m.predicted, card.actual, m.lo, m.hi).text))));
      }
      cardBox.append(det);
    }
  }

  function paintPicker(list) {
    const missOf = (c) => { const m = primary(c); return c.actual_status === 'observed' && c.actual != null && isMiss(m.predicted, c.actual, m.lo, m.hi); };
    const nMiss = list.filter(missOf).length;
    const nScored = list.filter((c) => c.actual_status === 'observed' && c.actual != null).length;
    if (state.misses) for (const c of list) if (missOf(c)) revealed.add(c.key);
    picker.replaceChildren(h('h3', { text: 'All test months' }),
      h('p', { class: 'caption', text: 'After a reveal: ● inside our likely range, ▲ Aqua above it, ▼ below it. A small ring marks an estimate more than 2× off.' }),
      state.misses ? h('p', { class: 'miss-count', 'aria-live': 'polite', text: `${nMiss} of ${nScored} scored months here are misses: Aqua outside the likely range, or the estimate more than 2× off.` }) : '');
    const years = [...new Set(list.map((c) => c.year))].sort();
    const grid = h('div', { class: 'picker-grid', role: 'group', 'aria-label': 'Test months' }, h('span', {}), ...MONTH_ABBR.map((m) => h('span', { class: 'ml', text: m[0] })));
    for (const y of years) {
      grid.append(h('span', { class: 'yl', text: `${y}${state.stratum === 'held_out' ? '†' : ''}` }));
      for (let i = 0; i < 12; i += 1) {
        const c = list.find((x) => x.year === y && monthIndex(x.month) === i);
        if (!c) { grid.append(h('span', { class: 'pick-gap' })); continue; }
        const open = revealed.has(c.key);
        const scoreable = c.actual_status === 'observed' && c.actual != null;
        const miss = missOf(c);
        const b = h('button', { class: `pick${open ? ' revealed' : ''}${c.key === state.key ? ' current' : ''}${state.misses && !miss ? ' dim' : ''}${open && miss ? ' far' : ''}`, type: 'button', 'aria-pressed': c.key === state.key ? 'true' : 'false',
          'aria-label': `${monthLabel(c.month)}${!scoreable ? ', not scoreable' : open ? `, revealed: ${outcomeWord(c)}${miss ? ', a miss' : ''}` : ', not yet revealed'}`, onclick: () => { state.key = c.key; paint(); } });
        if (!scoreable) b.append(glyph('none'));
        else if (open) b.append(glyph(outcomeGlyph(c)));
        grid.append(b);
      }
    }
    picker.append(grid);
  }

  function primary(c) { return c.methods.find((m) => m.method_id === recordMethod) || c.methods.find((m) => methodRole(methods[m.method_id]) !== 'baseline') || c.methods[0]; }
  function outcomeGlyph(c) { const m = primary(c); if (m.lo == null || m.hi == null) return 'unknown'; if (c.actual < m.lo) return 'below'; if (c.actual > m.hi) return 'above'; return 'within'; }
  function outcomeWord(c) { return { within: 'inside the likely range', above: 'Aqua above the likely range', below: 'Aqua below the likely range', unknown: 'no likely range' }[outcomeGlyph(c)]; }

  const m1Method = h('details', { class: 'adv', id: 'for-scientists' },
    h('summary', {}, h('span', { class: 'adv-title', text: 'Method details' }), h('span', { class: 'caption', text: ' full scoreboard, run ids' })),
    h('div', { class: 'adv-body' },
      h('p', { class: 'prov', text: `run ${val.run ? `${val.run.id} (${val.run.kind})` : '—'} · evaluated ${val.evaluated_at || '—'} · pre-registration ${val.preregistration_ref} sha256 ${short(val.preregistration_sha256)} · frozen config ${short(val.frozen_config_sha256)} at ${val.frozen_at || '—'} · target: ${val.target || '—'} · dataset ${val.dataset_version}` }),
      preregScore(val, methods, recordMethod, nameOf),
      scoreboard(val, methods, regionName, nameOf, tagOf, rank)));
  const audit = auditSection(manifest, regionName) || h('p', { class: 'caption', text: 'No audit flags are published.' });
  const limits = limitations(val, manifest, methods, regionName, recordMethod, nameOf);

  const openM1 = okRequested || !!ctx.params.step;
  if (m2val) {
    // ---------- Scientific details (collapsed): every number and method note, one level down ----------
    const sub = (id, title, note, kids, open = false) => h('details', { class: 'tr-sd', id, open: open || null },
      h('summary', {}, h('h3', { class: 'tr-sd-t' }, title, note ? h('span', { class: 'tr-sd-note', text: ` ${note}` }) : '')), h('div', { class: 'tr-sd-body' }, ...kids));
    m1Body.append(m1Method);
    const sciEl = h('details', { class: 'tr-science', id: 'science', open: openM1 || science || null },
      h('summary', { class: 'tr-science-sum' }, h('span', { class: 'tr-science-t', text: 'Scientific details' }),
        h('span', { class: 'tr-science-s', text: 'Statistics, confusion matrices, methods, robustness, the earlier S-NPP test, audit flags and limitations' })),
      h('div', { class: 'tr-science-body' },
        sub('sd-stats', 'Detailed statistics', 'NOAA-20 test, every approved figure', [h('p', { class: 'tr-answer-verbatim', 'data-claim': 'trustAnswer' }, h('b', { text: 'The answer, approved wording: ' }), answerVerbatim), trustStatistics(m2val)]),
        sub('sd-matrices', 'Confusion matrices', 'three ways to call a month above / within / below', [trustMatrices(m2val)]),
        sub('sd-method', 'Methodology', 'how the NOAA-20 test was run', [trustMethod(m2val)]),
        sub('sd-robust', 'Robustness checks', '', [trustRobustness(m2val)]),
        sub('sd-m1', 'The earlier test: S-NPP', `${m1.held} of ${m1.tested} study regions held up; every month, scoreboard`, [m1Body], openM1),
        sub('sd-audit', 'Audit flags', 'checks on the record itself', [audit]),
        sub('sd-limits', 'Limitations, and the S-NPP months where we missed', '', [limits.querySelector('.limits') || limits])));
    root.append(sciEl);
  } else root.append(m1Body, shortLimits(), limits, m1Method, audit);

  root.__afterMount = () => {
    focusSwitcher(ctx);
    paint();
    if (explorer && (location.hash === '#decades' || explorer.m2Requested)) explorer.open();
    if (m2val && okRequested) { const t = document.getElementById('pr-h'); if (t) { openTo(t); requestAnimationFrame(() => t.scrollIntoView({ block: 'start' })); } }
  };
  return root;
}

/** Where the conversion is validated, provisional or untested: a time strip and three labelled groups (no colour-only codes). */
function coverage(manifest, m2val) {
  const cov = trustCoverage(manifest, m2val);
  const span = recordSpan(manifest);
  const w = m2val.window;
  const y0 = span ? yearOf(span.start) : yearOf(w.start); const y1 = span ? yearOf(span.end) + 1 : yearOf(w.end) + 1;
  const x = (ym) => (((yearOf(ym) + (monthIndex(ym)) / 12) - y0) / (y1 - y0)) * 100;
  const xs = (y) => ((y - y0) / (y1 - y0)) * 100;
  const held = [...new Set(manifest.regions.flatMap((r) => r.held_out_years || []))].sort((a, b) => a - b);
  const endX = x(w.end) + 100 / 12 / (y1 - y0);
  const decadeTicks = []; for (let y = Math.ceil(y0 / 5) * 5; y < y1; y += 5) decadeTicks.push(y);
  const strip = h('div', { class: 'tr-time', role: 'img', 'aria-label': `Record ${y0} to ${y1 - 1}. S-NPP test: hidden years ${held.join(', ')}. NOAA-20 test: ${monthLabel(w.start)} to ${monthLabel(w.end)}. After that: not tested. Other years are not a conversion test (measured by Aqua, or training years).` },
    h('div', { class: 'tr-time-bar' },
      ...held.map((y) => h('span', { class: 'tr-time-snpp', style: `left:${xs(y).toFixed(2)}%;width:${(100 / (y1 - y0)).toFixed(2)}%` })),
      h('span', { class: 'tr-time-n20', style: `left:${x(w.start).toFixed(2)}%;width:${(endX - x(w.start)).toFixed(2)}%` }),
      h('span', { class: 'tr-time-none', style: `left:${endX.toFixed(2)}%;right:0` })),
    h('div', { class: 'tr-time-axis', 'aria-hidden': 'true' }, ...decadeTicks.map((y) => h('span', { style: `left:${xs(y).toFixed(2)}%`, text: String(y) }))),
    h('ul', { class: 'tr-time-key', 'aria-hidden': 'true' },
      h('li', {}, h('i', { class: 'k-snpp' }), `S-NPP test: hidden years ${held.join(', ')}`),
      h('li', {}, h('i', { class: 'k-n20' }), `NOAA-20 test: ${monthLabel(w.start)} – ${monthLabel(w.end)}`),
      h('li', {}, h('i', { class: 'k-none' }), `Not tested: ${yearOf(w.end) + 1} on`),
      h('li', {}, h('i', { class: 'k-blank' }), 'Blank = not a conversion test (measured by Aqua, or training years)')));
  const chip = (r, cls, g) => h('li', { class: `tr-chip ${cls}` }, glyph(g), h('span', { text: r.name }), h('small', { text: r.scope || r.test }));
  return h('section', { class: 'tr-where', 'aria-labelledby': 'trw-h' },
    h('h2', { class: 'tr-h2', id: 'trw-h', text: 'Where it works, where it is unsure, where it is untested' }),
    strip,
    h('div', { class: 'tr-where-cols' },
      h('div', { class: 'tr-where-g g-ok' }, h('h3', {}, glyph('within'), ` Validated (daytime) · ${[['NOAA-20', 'areas'], ['S-NPP', 'regions']].map(([t, w]) => [cov.validated.filter((r) => r.test === t).length, t, w]).filter(([n]) => n).map(([n, t, w]) => `${n} ${t} ${w}`).join(' + ')}`), h('ul', {}, ...cov.validated.map((r) => chip(r, 'ok', 'within')))),
      h('div', { class: 'tr-where-g g-prov' }, h('h3', {}, glyph('unknown'), ` Provisional · ${cov.provisional.length}`), h('ul', {}, ...cov.provisional.map((r) => chip(r, 'pv', 'unknown'))),
        h('p', { class: 'caption', text: 'Tested, but too few hidden months fell inside the likely range: not yet reliable.' })),
      h('div', { class: 'tr-where-g g-none' }, h('h3', {}, glyph('none'), ' Not tested anywhere'), h('ul', {}, ...cov.untested.map((u) => h('li', { class: 'tr-chip none' }, glyph('none'), h('span', { text: u.label }), h('small', { text: u.why }))))),
      h('div', { class: 'tr-where-g g-keep' }, h('h3', { text: 'Keep in mind' }), shortLimitsList())));
}


/** The pre-registered score (MAE on log(1 + count)), shown under "Method details". Values read from validation.summary. */
function preregScore(val, methods, recordMethod, nameOf) {
  const rows = (val.summary || []).filter((x) => x.metric === 'mae_log1p' && x.region_id === 'all' && x.stratum === 'held_out' && x.season === 'all' && (!val.daynight || x.daynight === val.daynight));
  if (!rows.length) return h('span', {});
  const order = (id) => (id === recordMethod ? 0 : methodRole(methods[id]) === 'candidate' ? 2 : 1);
  const parts = rows.sort((a, b) => order(a.method_id) - order(b.method_id)).map((x) => `${nameOf(x.method_id)} ${x.value.toFixed(3)} (n = ${x.n})`);
  return h('section', { class: 'prereg' }, h('h2', { class: 'section-title', text: 'The pre-registered score' }),
    h('p', { text: `Mean absolute error on log(1 + count), hidden test months, pooled core + control regions: ${parts.join('; ')}. Lower is better. The plain summary above (% error) describes the same stored predictions; it is not this score.` }),
    h('p', { class: 'caption', text: 'Night-time (secondary): reported in the project’s research records, not in this site’s data. There the more detailed model beat the ratio method in every night block (skill 0.19, 95% CI 0.15–0.23, 9 of 9 blocks), although both methods err more at night than by day; night results cannot change the daytime decision.' }));
}

function short(s) { return s ? `${String(s).slice(0, 10)}…` : '—'; }

function bar(sx, lo, hi, pred, actual, actualRow = false) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 26'); svg.setAttribute('aria-hidden', 'true');
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
  mk('line', { x1: 6, x2: 294, y1: 13, y2: 13, class: 'pr-scale', stroke: '#CFC9BC' });
  if (lo != null && hi != null) mk('line', { x1: sx(lo), x2: sx(hi), y1: 13, y2: 13, class: 'pr-int' });
  if (pred != null) mk('circle', { cx: sx(pred), cy: 13, r: 5, class: 'pr-pt' });
  if (actual != null) {
    mk('line', { x1: sx(actual), x2: sx(actual), y1: 2, y2: 24, class: 'pr-actual-line' });
    if (actualRow) mk('circle', { cx: sx(actual), cy: 13, r: 5, class: 'pr-pt actual' });
  }
  return svg;
}

function intro(story) {
  return h('div', { class: 'trust-intro' },
    h('h1', { class: 'plate-title', text: story ? story.question : 'Can we trust comparisons between these two satellites?' }),
    story ? h('p', { class: 'answer', text: story.answer }) : '',
    story ? h('p', { class: 'lede', text: story.lead }) : h('p', { class: 'why', text: REQUIRED_COPY }));
}

function shortLimits() {
  return h('section', { class: 'short-limits', 'aria-labelledby': 'sl-h' },
    h('h2', { class: 'section-title', id: 'sl-h', text: 'Keep in mind' }), shortLimitsList());
}
function shortLimitsList() {
  return h('ul', { class: 'tr-keep' },
      h('li', { text: 'A detection is a hot satellite pixel, not a fire, a burned area or a damage estimate.' }),
      h('li', { text: 'A month with no usable data is shown as not observed. It is never treated as zero.' }),
      h('li', { text: 'In Aqua’s final years its timing drifted, so recent comparisons are unconfirmed.' }),
      h('li', { text: 'Above / within / below usual on the region pages is a simple check against Aqua’s early years, not proof of change.' }));
}

const METRIC_LABEL = {
  mae_log1p: 'Mean absolute error', rmse_log1p: 'Root mean square error', mean_signed_error_log1p: 'Mean signed error (bias)',
  annual_total_bias: 'Annual total bias', interval_coverage: 'Interval coverage', interval_coverage_block: 'Coverage, by region-year block',
  interval_mean_width_log1p: 'Mean interval width', skill_vs_ratio_log1p: 'Skill vs ratio method',
};
const METRIC_NOTE = { skill_vs_ratio_log1p: '1 − error ÷ ratio-method error, log(1+count)', annual_total_bias: 'predicted ÷ actual − 1, summed over scored months', interval_coverage_block: 'mean of region × year block coverages' };
const SCALE_NOTE = { log1p: 'log(1+count)', fraction: 'share of months', ratio: 'predicted ÷ actual − 1' };

function scoreboard(val, methods, regionName, nameOf, tagOf, rank) {
  const sec = h('section', { class: 'score', 'aria-labelledby': 'sb-h' }, h('h2', { class: 'section-title', id: 'sb-h', text: 'Scoreboard' }),
    h('p', { class: 'caption', text: 'n = scored months beside every number; “insufficient sample” where the pre-registered minimum is not met. Errors are on log(1 + count): lower is better. Skill above 0 means lower error than the ratio method. Training years are never scored here.' }));
  const all = val.summary || [];
  const uniq = (k) => [...new Set(all.map((x) => x[k]))];
  const st = { region: uniq('region_id').includes('all') ? 'all' : uniq('region_id')[0], stratum: uniq('stratum').includes('held_out') ? 'held_out' : uniq('stratum')[0], season: uniq('season').includes('all') ? 'all' : uniq('season')[0] };
  const sel = (id, label, key, opts, fmt) => h('label', { for: id }, label, ' ', h('select', { id, onchange: (e) => { st[key] = e.target.value; paint(); } }, ...opts.map((o) => h('option', { value: o, selected: o === st[key], text: fmt(o) }))));
  const stratumWord = (o) => (o === 'held_out' ? 'held-out years' : o === 'drift' ? 'drift years (Aqua less reliable)' : o);
  const seasonWord = (o) => (o === 'all' ? 'whole year' : o === 'active' ? 'fire season' : o === 'off' ? 'off season' : o);
  sec.append(h('div', { class: 'select-line' },
    sel('sb-r', 'Region', 'region', uniq('region_id'), (o) => (o === 'all' ? 'pooled (core + control)' : regionName(o))),
    sel('sb-s', 'Months', 'stratum', uniq('stratum'), stratumWord),
    sel('sb-se', 'Season', 'season', uniq('season'), seasonWord)));
  const box = h('div', { class: 'score-wrap' });
  sec.append(box);
  const fx = (v) => (v == null ? '—' : Math.abs(v) < 100 ? v.toFixed(3) : fmtN(v));
  function resultCell(s, insufficient) {
    if (insufficient) return h('td', { class: 'res insufficient' }, 'insufficient');
    if (s.passed === true) return h('td', { class: 'res pass' }, h('span', { 'aria-hidden': 'true', text: '✓ ' }), 'pass');
    if (s.passed === false) return h('td', { class: 'res fail' }, h('span', { 'aria-hidden': 'true', text: '✗ ' }), 'fail');
    return h('td', { class: 'res muted', text: s.preregistered ? '' : 'exploratory' });
  }
  function paint() {
    const rows = all.filter((x) => x.region_id === st.region && x.stratum === st.stratum && x.season === st.season);
    const groups = new Map();
    for (const r of rows) { const k = `${r.method_id}|${r.daynight}|${r.input_platform}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const keys = [...groups.keys()].sort((a, b) => {
      const [ma, da] = a.split('|'); const [mb, db] = b.split('|');
      return (da === val.daynight ? 0 : 1) - (db === val.daynight ? 0 : 1) || rank(ma) - rank(mb);
    });
    const ctx = `${st.region === 'all' ? 'Pooled: core + control regions' : regionName(st.region)} · ${stratumWord(st.stratum)} · ${seasonWord(st.season)}`;
    const table = h('table', { class: 'score-table grouped' }, h('caption', { text: ctx }),
      h('thead', {}, h('tr', {}, ...['Metric', 'Value', 'n', 'CI', 'Threshold', 'Result'].map((t, i) => h('th', { scope: 'col', class: i > 0 && i < 5 ? 'num' : '', text: t })))));
    for (const k of keys) {
      const [mid, dn, inp] = k.split('|');
      const secondary = val.daynight && dn && dn !== val.daynight;
      const ms = groups.get(k).filter((x) => x.metric !== 'interval_mean_width_log1p');
      const width = groups.get(k).find((x) => x.metric === 'interval_mean_width_log1p');
      const body = h('tbody', {}, h('tr', { class: 'group' }, h('th', { scope: 'rowgroup', colspan: '6' },
        h('span', { class: 'gname', text: nameOf(mid) }), h('span', { class: 'gtag', text: ` ${tagOf(mid)}` }),
        h('span', { class: 'gmeta', text: ` · ${dn === 'D' ? 'day' : dn === 'N' ? 'night' : dn}${secondary ? ' (secondary, exploratory)' : ''}${inp && inp !== 'undefined' ? ` · from ${inp}` : ''}` }))));
      for (const s of ms) {
        const insufficient = s.meets_minimum_n === false;
        const lvl = s.interval_level ? ` · ${Math.round(s.interval_level * 100)}% interval` : '';
        const isCov = /^interval_coverage/.test(s.metric);
        body.append(h('tr', {},
          h('th', { scope: 'row', class: 'metric' }, METRIC_LABEL[s.metric] || s.metric, h('span', { class: 'scale', text: ` ${METRIC_NOTE[s.metric] || SCALE_NOTE[s.scale] || s.scale}${lvl}` })),
          h('td', { class: 'num' }, insufficient ? '—' : fx(s.value), isCov && width && width.value != null && (width.interval_level == null || s.interval_level == null || width.interval_level === s.interval_level) ? h('span', { class: 'width', text: ` width ${width.value.toFixed(2)}` }) : isCov ? h('span', { class: 'width', text: ' width not reported at this level' }) : null),
          h('td', { class: 'num', text: s.n == null ? 'missing' : String(s.n) }),
          h('td', { class: 'num', title: s.ci_method || '', text: !insufficient && s.ci_lo != null && s.ci_hi != null ? `${fx(s.ci_lo)} – ${fx(s.ci_hi)}` : '' }),
          h('td', { class: 'num', text: s.threshold != null ? `≥ ${fx(s.threshold)}` : '' }),
          resultCell(s, insufficient)));
      }
      table.append(body);
    }
    const cim = [...new Set(rows.map((x) => x.ci_method).filter(Boolean))];
    box.replaceChildren(rows.length ? h('div', { class: 'score-scroll' }, table) : h('p', { class: 'caption', text: 'No summary rows for this selection.' }),
      ...(cim.length ? [h('p', { class: 'caption', text: `CI methods: ${cim.join('; ')}. Coverage “width” is the mean interval width on log(1+count) at the same level as the coverage.` })] : []));
  }
  paint();
  if (val.run && val.run.kind === 'deviation_rerun') sec.append(h('p', { class: 'caption', text: `This is a deviation re-run (${val.run.deviation_ref || 'see deviation note'}), shown alongside, not instead of, the primary run ${val.run.supersedes || ''}.` }));
  return sec;
}

/** Audit flags per region (contract 1.2): disclosed next to the validation they qualify. */
function auditSection(manifest, regionName) {
  const withFlags = (manifest.regions || []).filter((r) => Array.isArray(r.audit_flags) && r.audit_flags.length);
  if (!withFlags.length) return null;
  return h('section', { class: 'audit', 'aria-labelledby': 'au-h' }, h('h2', { class: 'section-title', id: 'au-h', text: 'Audit flags' }),
    h('p', { class: 'caption', text: 'Checks on the record itself (before and around the instrument change). They qualify the regions’ status; they are not part of the held-out score.' }),
    h('dl', { class: 'audit-list' }, ...withFlags.flatMap((r) => [h('dt', { text: `${regionName(r.id)} · ${r.status}` }),
      ...r.audit_flags.map((f) => { const a = formatAuditFlag(f); return h('dd', { class: a.flagged ? 'flagged' : '' },
        h('div', { class: 'aline' }, h('span', { class: 'astate', text: a.state }), h('b', { text: a.title })),
        h('div', { class: 'aval mono', text: a.headline }),
        (a.rule || a.note || a.ref) ? h('details', { class: 'caption' }, h('summary', { text: 'Rule, note and source' }),
          a.rule ? h('p', { text: `Rule: ${a.rule}` }) : null, a.note ? h('p', { text: a.note }) : null, a.ref ? h('p', { class: 'prov', text: a.ref }) : null) : null); })])));
}

/** The decision in one paragraph, read from the pre-registered skill rows. */
function resultBlock(val, methods, recordMethod, nameOf, fixture, manifestRef) {
  const box = h('section', { class: 'result-block', 'aria-labelledby': 'res-h' }, fixtureVeil(fixture));
  box.append(h('h2', { class: 'section-title', id: 'res-h', text: 'The pre-registered decision, in numbers' }));
  const poolIds = new Set((manifestRef.regions || []).filter(isPooledRegion).map((r) => r.id));
  const rName = (id) => ((manifestRef.regions || []).find((r) => r.id === id) || {}).name || id;
  const copy = resultCopy(val, methods, recordMethod, (id) => !poolIds.size || poolIds.has(id), rName);
  if (copy.lede.length) box.append(h('p', { class: 'result-lede', text: copy.lede.join(' ') }));
  else if (recordMethod) box.append(h('p', { class: 'result-lede', text: `The record uses the ${nameOf(recordMethod).toLowerCase()}.` }));
  for (const t of copy.triggers) box.append(h('p', { class: 'result-trigger' }, h('span', { class: 'tag', text: t.below ? 'decision input' : 'trigger' }), ' ', t.text));
  for (const d of copy.detail) box.append(h('p', { class: 'result-detail mono', text: d }));
  const night = (val.summary || []).filter((s) => s.daynight && s.daynight !== (val.daynight || 'D'));
  const held = [...new Set((val.rows || []).filter((r) => r.stratum === 'held_out').map((r) => r.year))].sort();
  const inputs = [...new Set((val.rows || []).filter((r) => r.stratum === 'held_out').map((r) => PLATFORM_LABEL[r.input_platform] || r.input_platform))];
  box.append(h('p', { class: 'caption', text: `What this covers: ${val.daynight === 'D' ? 'daytime ' : ''}conversion from ${inputs.join(' and ')}, tested on withheld ${held.join('/')}. It does not cover night overpasses, the Aqua drift years, values converted from other VIIRS satellites, or the native Aqua record.${(manifestRef.m2_regions || []).length ? ` (NOAA-20 is tested separately, above, in ${manifestRef.m2_regions.length} other study areas.)` : ''}` }),
    h('p', { class: 'caption', text: night.length
      ? 'Night results are secondary and exploratory. They are listed in the scoreboard but cannot change the pre-registered daytime decision.'
      : 'Night results are secondary and exploratory, are not in this file, and cannot change the pre-registered daytime decision. They are kept in the project’s research records, not on this site.' }));
  return box;
}

function limitations(val, manifest, methods = {}, regionName = (x) => x, recordMethod = null, nameOf = (x) => x) {
  const fails = val && val.status === 'evaluated' ? (val.rows || []).filter((r) => r.inside_interval === false && r.actual != null && r.stratum === 'held_out' && (recordMethod ? r.method_id === recordMethod : methodRole(methods[r.method_id]) !== 'baseline'))
    .sort((a, b) => Math.abs(Math.log1p(b.predicted) - Math.log1p(b.actual)) - Math.abs(Math.log1p(a.predicted) - Math.log1p(a.actual))).slice(0, 8) : [];
  return h('details', { class: 'more limits-wrap' }, h('summary', { text: 'All limitations, and the months where we missed' }), h('section', { class: 'limits', 'aria-labelledby': 'lim-h' },
    h('div', {}, h('h2', { class: 'section-title', id: 'lim-h', text: 'Limitations' }), h('ul', {},
      h('li', { text: 'A detection is a hot satellite pixel at overpass time, not a fire, a burned area or an emissions estimate.' }),
      h('li', { text: 'FIRMS records detections only. A month with no detections and a month the satellite could not see (cloud, outage) can look alike; outages we know of are marked “not observed”, others may be hidden.' }),
      h('li', { text: 'Agreement in training years is in-sample and is not shown as validation. Only withheld years count.' }),
      h('li', { text: 'Aqua’s orbit drifts in its final years, so later Aqua months are themselves a weaker reference: comparisons there are unconfirmed.' }),
      h('li', { text: 'After MODIS ends there is nothing to check the conversion against. Those months carry the widest uncertainty.' }),
      h('li', { text: 'A smoother series at the instrument change is not proof the conversion is right.' }),
      (() => { const fl = manifest.regions.filter((r) => (r.audit_flags || []).some((x) => x.flagged === true)); return fl.length ? h('li', { text: `Pre-2012 stability checks of MODIS itself flagged ${fl.map((r) => shortName(r.name)).join(' and ')}: see Audit flags above.` }) : ''; })(),
      h('li', { text: 'The above / within / below verdicts on the region pages are a simple check against Aqua’s own early years, not proof of change.' }))),
    h('div', {}, h('h2', { class: 'section-title', text: 'Where we missed' }), recordMethod && val && val.status === 'evaluated' ? h('p', { class: 'caption', text: `Held-out months where Aqua fell outside the ${nameOf(recordMethod).toLowerCase()}’s ${Math.round((val.interval_level || 0) * 100)}% interval, worst first.` }) : null,
      !val || val.status !== 'evaluated' ? h('p', { class: 'caption', text: 'Listed here once the held-out run exists: the test months where Aqua fell outside the conversion’s interval, worst first.' })
        : fails.length ? h('div', { style: 'overflow-x:auto' }, h('table', { class: 'score-table' }, h('thead', {}, h('tr', {}, ...['Month', 'Region', 'Predicted [interval]', 'Aqua measured'].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', {}, ...fails.map((r) => h('tr', {}, h('td', { text: monthLabel(r.month) }), h('td', { text: regionName(r.region_id) }),
            h('td', { class: 'num', text: `${fmtN(r.predicted, 1)} [${fmtInterval(r.lo, r.hi) || 'none'}]` }), h('td', { class: 'num', text: fmtN(r.actual) }))))))
          : h('p', { class: 'caption', text: 'No held-out month fell outside the record method’s interval in this run. That is a property of these months, not a guarantee.' }))));
}

// ====================================================================================================================
// M4.3 region-aware Trust (docs/m43/TRUST-CONTEXT.md). URL: ?view=trust&region=<id>|all|custom[&at=lat,lon].
// Every region number comes from trustctx.js (stored results only); pooled-only measures say so.
// ====================================================================================================================

/** All regions + the nine study regions, grouped by test. Changing it pushes a new URL and re-renders. */
/**
 * M4.5: the region select: ONE list, west -> east by box-centre longitude (D4), each option "{Name} · ✓ Validated|◐ Provisional
 * · {NOAA-20|S-NPP} test" (QA Q2); the last option opens the full evidence hub.
 */
function regionSelect(ctx, manifest, current) {
  const list = westEast(manifest);
  const sel = h('select', { id: 'tr-switch', class: 'tr-switch-sel', onchange: (e) => {
    ctx.session.focusSwitcher = true;
    // replace, not push: keyboard arrows on a closed select fire change per step (no history spam)
    ctx.navigate(trustParams(e.target.value === ALL ? ALL : e.target.value), { replace: true });
  } },
  current == null ? h('option', { value: 'custom', disabled: true, selected: true, text: 'A map location (unsupported)' }) : '',
  current === ALL ? h('option', { value: '', disabled: true, selected: true, text: 'Choose a study region' }) : '',
  ...list.map((x) => h('option', { value: x.id, selected: x.id === current || null, text: regionOptionText(x) })),
  h('option', { value: ALL, text: 'Full scientific evidence (all regions)' }));
  return sel;
}
function regionSwitcher(ctx, manifest, current, unknownRaw = null) {
  return h('div', { class: 'tr-switch' },
    h('label', { for: 'tr-switch', class: 'tr-switch-l', text: 'Study region' }), regionSelect(ctx, manifest, current),
    unknownRaw ? h('p', { class: 'tr-switch-note', role: 'status', text: `There is no study region called “${unknownRaw}”, so the full evidence is shown.` }) : '');
}
/** Region page selection: the mini-map (pointer/touch + its own keyboard) paired with the select (the accessible fallback). */
async function regionPicker(ctx, manifest, current) {
  const sel = regionSelect(ctx, manifest, current);
  const label = h('label', { for: 'tr-switch', class: 'visually-hidden', text: 'Study region' });
  // M4: closed, the select shows only the region's name (the full option text stays in the list and in its value)
  const cur = westEast(manifest).find((x) => x.id === current);
  const face = h('span', { class: 'tm-sel-face', 'aria-hidden': 'true' }, h('span', { class: 'tm-sel-name', text: cur ? cur.name : 'Choose a study region' }), h('span', { class: 'tm-sel-chev', text: '▾' }));
  const mini = await miniMap(ctx, manifest, current).catch(() => null);
  return { el: h('div', { class: 'tm-pick' }, mini ? mini.el : '', h('div', { class: 'tm-pick-sel' }, label, face, sel)), teardown: () => { if (mini) mini.teardown(); } };
}
function focusSwitcher(ctx) {
  if (!ctx.session || !ctx.session.focusSwitcher) return;
  ctx.session.focusSwitcher = false;
  document.getElementById('tr-switch')?.focus({ preventScroll: true });
}

const pctW = (x) => `${Math.round(x * 100)}%`;
/** Links keep the data / validation params (main.urlFor via ctx); a bare query string only when no ctx.urlFor exists. */
const hrefFor = (ctx, params, hash = '') => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null));
  return `${ctx.urlFor ? ctx.urlFor(clean) : `?${new URLSearchParams(clean)}`}${hash}`;
};
/** C2: what the region answer does and does not cover, in the region chart's own marks. */
export const MEASURED_LINE = 'Points measured by Aqua (●) don’t depend on this; estimates (◇) and ‘+ VIIRS on Aqua’s scale’ do.';
/** Stored status reasons in plain words (the stored code stays in Method notes). */
const plainReason = (r) => (/passed M1 §6/.test(r) || /passed pre-registered thresholds/.test(r) ? 'passed the thresholds set before testing' : r);
const satShort = (f) => (f.platform === 'noaa20' ? 'NOAA-20' : f.platform === 'snpp' ? 'S-NPP' : f.satellite);

/**
 * M4.5: a region's Trust page IS its Time Machine. Header (name + region selection), the Time Machine, then two closed
 * disclosures: "Evidence for {Region}" (built on FIRST OPEN, so no test month's Aqua value or outcome is in the DOM before
 * the visitor asks; Esc and "Explore the evidence" open it in place, no history entry) and "What this does not show".
 */
async function regionView(ctx, manifest, val, m2val, route) {
  const f = regionFacts(manifest, val, m2val, route.id);
  if (!f) return null;
  const ans = regionAnswer(f);
  const marks = regionMonthMarks(manifest, val, m2val, f.id);
  const root = h('div', { class: 'view-enter trust tr-page tr-regional tm-page', 'data-region': f.id, 'data-status': f.status });
  const dis = (id, title, sub, kids) => h('details', { class: 'tr-sd tr-ctx-more', id }, h('summary', {}, h('h2', { class: 'tr-sd-t' }, title, sub ? h('span', { class: 'tr-sd-note', text: ` ${sub}` }) : '')), h('div', { class: 'tr-sd-body' }, ...kids));

  // ---------- Evidence for {Region}: lazily built ----------
  let explorer = null; let built = false;
  const evBody = h('div', { class: 'tr-sd-body' });
  const evidence = h('details', { class: 'tr-sd tr-ctx-more tm-evidence', id: 'evidence' }, h('summary', {}, h('h2', { class: 'tr-sd-t', text: `Evidence for ${f.name}` })), evBody);
  function buildEvidence() {
    if (built) return; built = true;
    evBody.append(h('p', { class: `answer tr-answer tone-${ans.tone}`, 'data-claim': 'region-answer' }, h('strong', { text: ans.lead }), ' ', ans.main), factsList(f, marks));
    if (f.test === 'm2') {
      explorer = trustExplorer(m2val, manifest, { onTry: (row) => ctx.navigate({ view: 'trust', region: f.id, month: row.month }), region: f.id, scoped: true });
      evBody.append(explorer.el);
    } else evBody.append(dis('tests', `This region’s ${marks.length} test months`, 'every hidden month, as a table', [m1MonthTable(f, marks)]));
    evBody.append(dis('method-notes', 'Method notes', 'where each number on this page comes from', methodNotes(f)));
    if (f.test === 'm1') {
      evBody.append(h('p', { class: 'caption tr-picker-link' }, h('a', { href: hrefFor(ctx, { view: 'trust', region: ALL, pick: f.id }, '#pr-h'), text: 'Try any S-NPP test month in the picker, with the other methods →',
        onclick: (ev) => { if (ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); ev.stopPropagation(); ctx.navigate({ view: 'trust', region: ALL, pick: f.id }, { hash: '#pr-h' }); } })));
    }
  }
  evidence.addEventListener('toggle', () => { if (evidence.open) buildEvidence(); });
  function openEvidence(focus = true) {
    buildEvidence(); evidence.open = true;
    evidence.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    if (focus) evidence.querySelector('summary').focus({ preventScroll: true });
  }

  // ---------- What this does not show (moved here from the old header; nothing deleted) ----------
  const notShown = dis('caveats', 'What this does not show', '', [
    regionLimits(f), shortLimitsList(),
    // this page draws no ●/◇ marks, so MEASURED_LINE is said in its own words here (QA): measured Aqua is unaffected
    h('p', { class: 'tr-measured-line', 'data-claim': 'measured-unaffected', text: 'Aqua’s own measurements don’t depend on this test; only converted estimates do.' }),
    f.status === 'provisional' ? h('p', { class: 'tr-prov tr-prov-note', 'data-claim': 'provisional' }, PROVISIONAL_NOTE, ' ', h('span', { class: 'muted', text: PROVISIONAL_DETAIL })) : '',
    f.role === 'control' ? h('p', { class: 'tr-role-note', 'data-claim': 'control' }, f.test === 'm2' ? '' : h('b', { text: 'Control region. ' }), f.test === 'm2'
      ? 'Control area for the NOAA-20 test, chosen before testing: steppe and agricultural grass burning.'
      : 'Chosen before testing as a low-activity control: temperate, with low and episodic detections, to check the method at small counts.') : '',
    f.tier === 'stretch' ? h('p', { class: 'tr-role-note' }, h('b', { text: 'Stretch region. ' }), 'A spatial-transfer test outside the three core regions; it is not part of the pooled core scores.') : '']);

  // ---------- header: region selection (mini-map + select), the region's name ----------
  const [picker, tm] = await Promise.all([regionPicker(ctx, manifest, f.id), machineFor(ctx, manifest, val, m2val, f.id, { onEvidence: () => openEvidence() })]); // G4
  const nAll = westEast(manifest).length;
  const hub = h('a', { class: 'tm-hub', href: hrefFor(ctx, { view: 'trust', region: ALL }), 'data-nav': 'trust', text: `Full scientific evidence: all ${nAll} regions →` });
  const geo = regionGeoNote(f.id, m2val && m2val.envelope ? baselinePeriodLabel({ baseline: { period: m2val.envelope.period } }) : null);
  root.append(h('div', { class: 'tm-pagehead' }, h('h1', { class: 'tm-name', text: f.name }), geo ? h('p', { class: 'tm-geo', text: geo }) : '', picker.el),
    tm || h('p', { class: 'tr-nocase', text: 'No complete hidden test month is stored for this region; its evidence is below.' }),
    h('div', { class: 'tm-below' }, evidence, notShown, h('p', { class: 'tm-hub-l' }, hub)));
  root.__teardown = () => { if (tm && tm.__teardown) tm.__teardown(); if (explorer && explorer.el.__teardown) explorer.el.__teardown(); picker.teardown(); };
  root.__afterMount = () => {
    if (tm && tm.__afterMount) tm.__afterMount();
    if (route.normalise) ctx.setParams(route.normalise);
    focusSwitcher(ctx);
    if (route.openEvidence) {
      openEvidence(false);
      if (location.hash === '#decades' && explorer) explorer.open();
      if (location.hash === '#tests') { const t = document.getElementById('tests'); if (t) { t.open = true; t.scrollIntoView({ block: 'start' }); } }
    }
  };
  return root;
}

/** The region facts row: each fact labelled, its denominator beside it, pooled-only measures said plainly. */
function factsList(f, marks) {
  const item = (k, label, value, note, src) => h('div', { class: `tr-fact tr-fact-${k}`, 'data-fact': k },
    h('dt', { text: label }), h('dd', {}, h('span', { class: 'tr-fact-v' }, ...[].concat(value)), note ? h('span', { class: 'tr-fact-n', text: note }) : '', src ? h('span', { class: 'tr-fact-src', text: src }) : ''));
  const lvl = (c) => (c ? `${covWords(c)} inside the ${Math.round(c.level * 100)}% range${c.threshold != null ? ` (needed ${pctW(c.threshold)}${c.passed === true ? ': met' : c.passed === false ? ': not met' : ''})` : ''}` : null);
  const fx = typicalFactor(f.error && f.error.value);
  const covNode = [h('b', { text: covWords(f.cov90) }), ` months inside the 90% range`];
  const strip = monthStrip(f, marks);
  return h('dl', { class: 'tr-facts', 'aria-label': `${f.name}: facts from the stored test results` },
    item('satellite', 'Satellite tested', `${satShort(f)} VIIRS → Aqua MODIS`, `${f.daynight === 'D' ? 'daytime' : f.daynight} monthly detection counts`),
    item('period', f.test === 'm2' ? 'Validation period' : 'Hidden test years', f.test === 'm2' ? periodWords(f) : f.period.years.join(', '),
      f.test === 'm2' ? 'each year hidden from the fit that predicted it' : `fitted on the other ${f.period.trainedOn.length} years`),
    item('n', 'Test months', String(f.n), f.test === 'm2' ? 'every month in the window with a usable Aqua value' : 'scored hidden months'),
    item('coverage', 'Range check', covNode, [f.cov90 && f.cov90.threshold != null ? `90% range: needed ${pctW(f.cov90.threshold)}${f.cov90.passed === true ? ', met' : f.cov90.passed === false ? ', not met' : ''}` : '', lvl(f.cov80),
      f.test === 'm2' ? `With ${f.n} months in 4 year-blocks, one region’s coverage is imprecise: a month or two either way changes it noticeably.` : ''].filter(Boolean).join(' · ')),
    h('div', { class: 'tr-fact tr-fact-strip' }, strip),
    item('error', 'Size of error', f.error ? [h('b', { text: `≈ ×${fx.toFixed(2)}` }), ' typical error'] : 'not stored',
      f.error ? `Approximate: estimate and Aqua differ by about this factor on average (count + 1), over ${f.error.n} months. Stored as average error on a log scale: ${f.error.value.toFixed(3)} (see Method notes).` : ''),
    item('verdict', 'Not measured per region on this site', f.test === 'm2' ? 'Skill against a simple guess; verdict agreement' : 'Skill against a simple guess',
      f.test === 'm2' ? 'Both are stored only pooled over the NOAA-20 test areas (see All regions). The test-month list below marks each month’s verdict, as a description.'
        : 'No skill against a simple guess was computed for the S-NPP record method (the ratio method). The S-NPP test’s stored skill scores compare the more detailed model and the guess with the ratio method (Scientific details). The skill on All regions belongs to the separate NOAA-20 test in other study areas. No verdict-agreement check is stored for the S-NPP test.'),
    item('status', 'Status', h('b', { class: `tr-status st-${f.status}`, text: f.statusLabel || f.status }), f.statusReasons.length ? `reason: ${f.statusReasons.map(plainReason).join('; ')}` : ''),
    h('div', { class: 'tr-fact tr-fact-limits', 'data-fact': 'limits' }, h('dt', { text: 'Limits' }), h('dd', {}, regionLimits(f))));
}

/** One mark per test month, time order: filled = inside the 90% range, outlined ▲/▼ = Aqua above / below it. */
function monthStrip(f, marks) {
  const k = marks.filter((m) => m.inside).length;
  const label = `${f.name}: ${k} of ${marks.length} test months inside the 90% range, in time order. ${marks.filter((m) => !m.inside).map((m) => `${monthLabel(m.month)} ${m.side}`).join('; ')}.`;
  return h('figure', { class: 'tr-strip', role: 'img', 'aria-label': label },
    h('div', { class: 'tr-strip-row', 'aria-hidden': 'true' }, ...marks.map((m, i) => {
      const yearStart = i === 0 || marks[i - 1].month.slice(0, 4) !== m.month.slice(0, 4);
      return h('span', { class: `tr-sm ${m.side}${yearStart ? ' ys' : ''}`, title: `${monthLabel(m.month)}: ${m.inside ? 'inside' : `Aqua ${m.side}`} the 90% range`, 'data-year': yearStart ? m.month.slice(0, 4) : null }, m.side === 'above' ? '▲' : m.side === 'below' ? '▼' : '');
    })),
    h('figcaption', { class: 'tr-strip-cap' }, h('span', {}, h('i', { class: 'tr-sm inside' }), ' inside'), h('span', {}, h('i', { class: 'tr-sm above' }, '▲'), ' Aqua above'), h('span', {}, h('i', { class: 'tr-sm below' }, '▼'), ' Aqua below'), h('span', { class: 'muted', text: ' · one mark per test month, in time order' })));
}

function regionLimits(f) {
  const items = [
    'Daytime only; night-time is untested.',
    f.test === 'm2' ? `This window only (${periodWords(f)}). Nothing from ${f.afterYear} on is validated: Aqua’s timing drifted, then MODIS ends.` : `These hidden years only. From ${f.driftFrom || 'the drift years'} on, Aqua’s timing drifted, so later comparisons are unconfirmed; nothing after MODIS is tested.`,
    'NOAA-21 is untested.',
  ];
  if (f.test === 'm1') items.push(`Tested with ${satShort(f)}, not NOAA-20: the NOAA-20 conversion has not been independently validated in this region.`);
  else {
    const sl = seasonLine(f); if (sl) items.push(sl);
    if (f.q3) items.push(q3Line(f.q3));
  }
  items.push('Detections, not separate fire events. One region’s result does not transfer to nearby places.');
  return h('ul', { class: 'tr-limits-list' }, ...items.map((t) => h('li', { text: t })));
}

function methodNotes(f) {
  const rule = REGION_CASE_RULE[f.test];
  const src = f.test === 'm2' ? 'site/data/m2_validation.json' : 'site/data/validation.json';
  return [
    h('p', { text: `Every number in this region’s facts is read from ${src}. Nothing on this page is a new calculation; counts of stored per-month fields are descriptive.` }),
    h('ul', { class: 'tr-src' },
      h('li', {}, h('b', { text: 'Range check, 90%: ' }), `${covWords(f.cov90)} · ${f.cov90.field}`),
      h('li', {}, h('b', { text: 'Range check, 80%: ' }), `${covWords(f.cov80)} · ${f.cov80.field}`),
      f.error ? h('li', {}, h('b', { text: 'Size of error: ' }), `stored mean absolute error on log(1 + count) ${f.error.value.toFixed(3)} · ${f.error.field}. The “≈ ×${typicalFactor(f.error.value).toFixed(2)}” shown is exp(${f.error.value.toFixed(3)}): the geometric mean of the ratio between estimate + 1 and Aqua + 1, an exact transform of the stored value, rounded.`) : '',
      f.cov90.threshold != null ? h('li', {}, h('b', { text: 'Thresholds: ' }), `90% coverage ≥ ${D7.cov90}, its Clopper-Pearson upper bound ≥ ${D7.cp90Upper}, 80% coverage ≥ ${D7.cov80}, on the region’s own n (${D7.ref}).${f.cov90.cpUpper != null ? ` Stored upper bound here: ${f.cov90.cpUpper.toFixed(3)}.` : ''}`) : '',
      f.statusReasons.length ? h('li', {}, h('b', { text: 'Status reason, as stored: ' }), f.statusReasons.join('; ')) : '',
      h('li', {}, h('b', { text: 'Skill against a baseline: ' }), f.skill.why),
      h('li', {}, h('b', { text: 'Verdict agreement: ' }), f.test === 'm2' ? 'stored only pooled over the NOAA-20 test areas; no per-region value is stored as a result.' : 'no verdict-agreement check is stored for the S-NPP test.'),
      f.test === 'm1' && f.countedFromRows ? h('li', {}, h('b', { text: '90% count: ' }), `counted from the ${f.countedFromRows.n} stored held-out rows (inside_interval); ${f.countedFromRows.matchesStored ? 'it matches' : 'it does NOT match'} the stored share ${f.cov90.share.toFixed(4)}.`) : '',
      f.cov90.ci ? h('li', {}, h('b', { text: '90% coverage interval: ' }), `${f.cov90.ci[0].toFixed(3)}–${f.cov90.ci[1].toFixed(3)} (stored; Clopper-Pearson, optimistic because months within a year are correlated)`) : ''),
    h('p', {}, h('b', { text: 'How the example months were chosen. ' }), `Success: ${rule.success} Miss: ${rule.miss} Only stored test months are used, never training months.`),
    f.test === 'm2' ? h('p', { class: 'caption', text: f.period.design }) : h('p', { class: 'caption', text: `Hidden years ${f.period.years.join(', ')}; the conversion was fitted on ${f.period.trainedOn.join(', ')}.` }),
  ];
}

/** M1 test months as a table (every stored hidden month of the record method). */
function m1MonthTable(f, marks) {
  return h('div', { class: 'tr-x-tablewrap' }, h('table', { class: 'score-table' },
    h('caption', { text: `${f.name}: ${marks.length} hidden test months, ${satShort(f)} → Aqua, daytime` }),
    h('thead', {}, h('tr', {}, ...['Month', 'Converted [90% range]', 'Aqua measured', 'Inside range'].map((t) => h('th', { scope: 'col', text: t })))),
    h('tbody', {}, ...marks.map((m) => h('tr', {}, h('th', { scope: 'row', text: monthLabel(m.month) }),
      h('td', { class: 'num', text: `${fmtN(m.row.predicted, 1)} [${fmtInterval(m.row.lo, m.row.hi) || 'none'}]` }), h('td', { class: 'num', text: fmtN(m.row.actual) }),
      h('td', { class: m.inside ? '' : 'bad', text: m.inside ? 'yes' : `no (Aqua ${m.side})` }))))));
}

/** A custom map location: no conversion was validated for that exact place. */
function unsupportedView(ctx, manifest, at) {
  const near = nearestStudyRegion(manifest, at);
  const fmt = (v, p, q) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? p : q}`;
  const root = h('div', { class: 'view-enter trust tr-page tr-unsupported', 'data-status': 'unsupported' });
  const go = (id) => (ev) => { if (ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); ev.stopPropagation(); ctx.navigate(trustParams(id)); };
  root.append(regionSwitcher(ctx, manifest, null),
    h('div', { class: 'tr-lead tr-unsup-lead' },
      h('p', { class: 'tr-kicker', text: `Can we trust it? · ${at ? `${fmt(at.lat, 'N', 'S')}, ${fmt(at.lon, 'E', 'W')}` : 'a place on the map'}` }),
      h('h1', { class: 'tr-question', text: 'Unsupported location' }),
      h('p', { class: 'answer tr-answer tone-none' }, h('strong', { text: UNSUPPORTED_LINE }), ` The converted counts were tested only in the ${trustRegionGroups(manifest).reduce((t, g) => t + g.regions.length, 0)} study regions; a result there does not transfer to other places, even nearby ones. The map’s shading here is Aqua MODIS alone, so it involves no conversion.`),
      h('ul', { class: 'tr-unsup-links' },
        near ? h('li', {}, h('a', { href: hrefFor(ctx, trustParams(near.region.id)), onclick: go(near.region.id) }, `${near.inside ? 'Inside' : 'Nearest study region'}: ${shortName(near.region.name)} · its evidence →`)) : h('li', { class: 'caption', text: 'No study region lies within 15° of this place.' }),
        h('li', {}, h('a', { href: hrefFor(ctx, trustParams(ALL)), onclick: go(ALL) }, 'All regions: the global evidence →')),
        h('li', {}, h('a', { href: hrefFor(ctx, { view: 'atlas' }), 'data-nav': 'atlas' }, 'Back to the map →'))),
      h('section', { class: 'tr-keep-wrap', 'aria-label': 'Keep in mind' }, shortLimitsList())));
  root.__afterMount = () => focusSwitcher(ctx);
  return root;
}

/**
 * M4.5: one region's Time Machine from stored files (trustcase.regionCase). S-NPP regions read their series (cached by
 * data.js when the region page loaded it); NOAA-20 areas need month_rows only. Null when no complete test month exists.
 */
export async function machineFor(ctx, manifest, val, m2val, id, { onEvidence = null } = {}) {
  const region = (manifest.regions || []).find((r) => r.id === id);
  let series = null;
  if (region) { try { series = await loadSeries(region); } catch (e) { series = null; } }
  const rc = regionCase(id, { manifest, val, m2val, series });
  if (!rc || rc.missing) return null;
  const f = rc.facts;
  const opts = rc.test === 'm2'
    ? { footer: approvedWording(m2val).A.A12, base: scopeFacts(m2val).base,
      // QA Q3 (M4.2) note for months whose range crosses a usual-range edge, verbatim from the retired demo
      edgeNote: (() => { const t = approvedWording(m2val).tallies; return `Its 90% range crossed a usual-range edge, so a range-based call would have been ‘uncertain’. The point verdict shown is the one counted in ${t.n20.agree} of ${t.n20.decided}.`; })(),
      stage2Detail: ['A ratio for this area and calendar month, fitted on the other test years; small counts are pulled toward the area’s overall ratio, so the divisor changes month to month.', REQUIRED_COPY_M2] }
    // N2: the footer keeps its always-visible lines; the rest already sits in "What this does not show"
    : { footer: { visible: m1Limits(f, PROVISIONAL_NOTE).visible, more: [] }, base: baselinePeriodLabel(series, null),
      stage2Detail: ['A per-region, per-season ratio of Aqua to S-NPP counts from the overlap training years, applied to VIIRS counts.', REQUIRED_COPY] };
  return timeMachine(ctx, rc, { ...opts, name: f.name,
    onEvidence: onEvidence || (() => ctx.navigate({ view: 'trust', region: id })),
    recordHref: (t) => (ctx.urlFor ? ctx.urlFor({ view: 'region', region: id, month: t.month }) : `?view=region&region=${id}&month=${t.month}`) });
}
