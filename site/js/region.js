// Region: question 2, "when are detections usual here, and how does a chosen year compare?"
// M4.1ux page order (docs/m41/UX-REVISION.md): head (name, one status chip, locator) -> three headline findings ->
// ONE hero seasonal chart (usual range, usual month, the chosen year; year strip) -> unusual months as a year x month
// timeline -> toolbar -> full calendar (behind "Show every month") -> optional tool -> satellites + method details. Month detail opens as a popover (desktop) or bottom sheet (phone).
// Comparisons in compare.js, method detail in advanced.js.
// Every visual decision reads record.source / native status / manifest.eras for that month. No year is special.
import {
  MONTH_ABBR, VERDICT, envelopeFor, monthVerdict, recordLanes, normalizeRuler, methodName, rulerValue, classOf, thresholdsFrom,
  aquaScaleThresholds, yearRows, latestRecordMonth, nativeStatus, nativeN, recordSource, isViirsDerived, monthIndex, monthLabel, yearOf,
  buildCsv, csvFilename, PLATFORM_LABEL, NATIVE_STATUS_WORD, VIIRS_PLATFORMS, coverageShortfalls, monthCaveats, baselinePeriodLabel, overpassSeries, fmtHour,
  calendarMove, latestComparableYear, unconfirmedYears, aquaOnlyMonths,
} from './core.js';
import { loadSeries, loadSensors, loadValidation } from './data.js';
import { h, glyph, verdictWord, fmtN, fmtInterval, fixtureVeil, errorBox, prefersReducedMotion } from './ui.js';
import { renderTimeline } from './timeline.js';
import { seasonSentence, lastMonthLine, tallyText, mustShowCaveats, regionChip, eraPlain, countVerdicts, shortName, sourceTag, isDriftMonth, countWords, MONTH_FULL, DETECTION_NOTE, SCREENING_NOTE, estimateSource, gapEstimateTag, regionGeoNote } from './story.js';
import { yearStrip, yearTally } from './season.js';
import { seasonHero } from './hero.js';
import { initStage, mapUnitLabel } from './stage.js';
import { twoSat, twoSatModel, twoSatDomain, twoSatAvailable } from './twosat.js';
import { compareUI, paintStrands, rawKey } from './compare.js';
import { loupeDetail, advancedSection } from './advanced.js';
import { allRegions, isM2Region } from './m2.js';
import { decadesPanel, m1NoaaLine } from './decades.js';
import { findings, findingsPanel, timelinePanel } from './periods.js';
import { calToMonth, fallbackLine, isTestMonthCandidate } from './nav.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export async function renderRegion(ctx, regionId) {
  const { manifest, params } = ctx;
  const region = allRegions(manifest).find((r) => r.id === regionId);
  if (!region) {
    return h('div', {}, errorBox('Region not found', { message: `No region “${regionId || ''}” in this dataset.` }),
      h('p', {}, h('a', { href: '?view=atlas', 'data-nav': 'atlas', text: 'Back to the map' })));
  }
  let series;
  try { series = await loadSeries(region); } catch (e) {
    return h('div', {}, errorBox(`The record for ${region.name} could not be loaded`, e, 'No values are shown in its place.'),
      h('p', {}, h('a', { href: '?view=atlas', 'data-nav': 'atlas', text: 'Back to the map' })));
  }
  const sensors = await loadSensors(manifest).catch(() => null);
  const validation = await loadValidation(manifest).catch(() => null);
  const driftShortfalls = coverageShortfalls(validation, region.id, region.method, 'drift');
  const aquaLst = new Map(overpassSeries(sensors, 'aqua', 'D', region.id).map((p) => [p.year, p]));
  const lstBase = [...aquaLst.values()].filter((p) => series.baseline && series.baseline.period ? p.year >= series.baseline.period.start_year && p.year <= series.baseline.period.end_year : false);
  const lstBaseH = lstBase.length ? lstBase.map((p) => p.h).sort((a, b) => a - b)[Math.floor(lstBase.length / 2)] : null;
  // technical caveats (shown in "More detail"); the plain must-show caveats come from story.js
  const caveatsOf = (r) => monthCaveats(r, { driftShortfalls }).map((k) => {
    if (k.key !== 'aqua_drifting') return k;
    const p = aquaLst.get(yearOf(r.month));
    return p ? { ...k, text: `observed; orbit drifting (median daytime overpass ${fmtHour(p.h)} in ${p.year}${lstBaseH != null ? ` vs ${fmtHour(lstBaseH)} in the baseline years` : ''}, measured from detections); comparability with earlier years not established` } : k;
  });
  // M4.4 (UI-01): the page shows measured Aqua only. Months the stored record filled from VIIRS are shown as not
  // observed (no value, no verdict, no tally); their stored estimates stay on row.gap_estimate for the labelled VIIRS layer.
  const months = aquaOnlyMonths(series.months);
  const { env, source: envSource, minYears } = envelopeFor(series, manifest.eras);
  const lanes = recordLanes(series.months, region.method);
  const laneMethod = (lane) => { const r = months.find((x) => x.modelled && x.modelled[lane] && x.modelled[lane].method_id); return r ? r.modelled[lane].method_id : lane; };
  const exploreOnly = region.status === 'explore_only';
  const methods = Object.fromEntries((manifest.methods || []).map((m) => [m.id, m]));
  const altMeta = methods[laneMethod(lanes.alt)] || { id: lanes.alt };
  const fixture = series.kind === 'fixture';
  const latest = latestRecordMonth(months);
  const baseLabel = baselinePeriodLabel(series, env);
  const aquaT = aquaScaleThresholds(env) || thresholdsFrom(months.map((r) => r.record && r.record.value));

  // ---------- shared state (one object; painters register for repaint) ----------
  const legacy = normalizeRuler(params.ruler);
  const state = {
    advanced: !!params.advanced,
    ruler: exploreOnly ? 'raw' : params.compare ? (params.advanced && legacy === 'alt' ? 'alt' : 'raw') : 'record',
    selected: null,
  };
  // M4.4 (UI-02, R2, R4): a month from the map arrives as cal= and becomes this record's month by the page's default-year
  // rule; an unknown month falls back to the default. Either way, one quiet line says what happened.
  const calPick = !params.month && params.cal ? calToMonth(params.cal, months, manifest.eras) : null;
  const askedRow = params.month ? months.find((m) => m.month === params.month) : null;
  state.selected = askedRow || (calPick && months.find((m) => m.month === calPick.month)) || latest || months[months.length - 1];
  const navNote = params.month && !askedRow ? fallbackLine.region(params.month, state.selected.month)
    : calPick && calPick.rule !== 'comparable' ? fallbackLine.calLatest(calPick.month) : null; // the comparable year is already named by the year note
  const monthGiven = !!(askedRow || calPick);
  const painters = [];
  const S = {
    ctx, manifest, region, series, months, env, minYears, envSource, lanes, methods, altMeta, fixture, exploreOnly, baseLabel, state, caveatsOf,
    recName: methodName(methods[laneMethod(lanes.record)] || { id: lanes.record }), altName: methodName(altMeta),
    aquaT, rawAquaT: thresholdsFrom(months.map((r) => nativeN(r, 'aqua'))), rawViirsT: thresholdsFrom(months.flatMap((r) => VIIRS_PLATFORMS.map((p) => nativeN(r, p)))),
    onRepaint: (fn) => painters.push(fn), setRuler,
  };
  const verdictOf = (r) => (state.ruler === 'raw' ? null : monthVerdict(r, state.ruler, env, lanes.alt).cls);
  const rulerValueFor = (r) => rulerValue(r, state.ruler, lanes.alt);

  const root = h('div', { class: 'view-enter lightbox' });

  // ---------- head: name, status, season sentence, latest month ----------
  const chip = regionChip(region);
  const usualEntries = env.map((e, i) => ({ month: i + 1, p50: e.n_years >= minYears ? e.p50 : null }));
  // the glossary explains Aqua; the sentence stays short
  const season = seasonSentence(shortName(region.name), usualEntries, baseLabel, null, series.daynight);
  const latestBox = h('div', { class: 'latest' });
  const dayWord = series.daynight === 'D' ? 'daytime ' : series.daynight === 'N' ? 'night-time ' : '';
  await initStage(manifest).catch(() => null);
  const unit = mapUnitLabel();
  const gapCount = months.filter((r) => r.gap_estimate).length;
  const measureLine = `Chart and calendar: Aqua ${dayWord}detections per month inside this box (measured by Aqua only; months Aqua missed stay empty${gapCount ? ', and their stored VIIRS estimates appear only on the “+ VIIRS on Aqua’s scale” layer' : ''}).${unit ? ` The world map shows ${unit}, so its values differ.` : ''}`;
  const inset = h('div', { class: 'lb-inset' });
  // region status, shown once: both reliabilities in the chip; what they mean is one click away (approved wording)
  const m2 = isM2Region(region);
  // the chip doubles as the key: ● = Aqua measured, ◇ = VIIRS estimate (reliability words unchanged)
  const win = m2 && region.m2 && region.m2.validated_window ? `${yearOf(region.m2.validated_window.start)}–${yearOf(region.m2.validated_window.end)}` : '';
  const viirsWord = m2 ? `VIIRS conversion validated ${win} (comparison tool)` : chip.word.replace(/^Aqua measured · /, '');
  const aquaWord = m2 ? 'Aqua measured only' : 'Aqua measured';
  const chipWord = `${aquaWord} · ${viirsWord}`;
  const recordKind = m2 ? 'Record: Aqua MODIS measurements only. The VIIRS conversion is used only in the optional comparison tools.'
    : region.status === 'provisional' ? 'Record: Aqua MODIS measurements only; months Aqua missed stay empty. Their stored VIIRS estimates are provisional and appear only on the VIIRS layer.'
      : 'Record: Aqua MODIS measurements only; months Aqua missed stay empty. Their stored VIIRS estimates cannot be checked and appear only on the VIIRS layer, marked not tested.';
  // Region → Trust (M4.3 contract, owned by the Trust view): ?view=trust&region=<id> opens Trust in this region's context.
  // ctx.urlFor keeps the data/validation params, so cmd/middle-click opens the same dataset (fallback: the plain query).
  const trustHrefFor = (r) => { const p = { view: 'trust', region: region.id, month: r && isTestMonthCandidate(region, r) ? r.month : null }; return typeof ctx.urlFor === 'function' ? ctx.urlFor(p) : `?view=trust&region=${encodeURIComponent(region.id)}${p.month ? `&month=${p.month}` : ''}`; };
  const trustHref = trustHrefFor(null);
  // M4.4: the Time Machine entry (NOAA-20 areas only), carrying the month when it is a plausible test month
  const machineHrefFor = (r) => { const p = { view: 'trust', region: region.id, machine: '1', month: r && isTestMonthCandidate(region, r) ? r.month : null }; return typeof ctx.urlFor === 'function' ? ctx.urlFor(p) : `?view=trust&region=${encodeURIComponent(region.id)}&machine=1`; };
  const trustA = (cls, text) => h('a', { class: cls, href: trustHref, 'data-nav': 'trust', 'data-region': region.id, text });
  const chipBox = h('details', { class: 'chip-d status-chip' }, h('summary', { class: `chip ${chip.cls || ''}`, 'aria-label': `${chipWord}. What does this mean?` },
    h('span', { class: 'ck ck-aqua', 'aria-hidden': 'true' }), aquaWord, ' · ', h('span', { class: 'ck ck-viirs', 'aria-hidden': 'true' }), viirsWord),
    h('div', { class: 'chip-pop' }, h('p', { class: 'chip-record', text: recordKind }), h('p', { text: chip.title }), chip.detail ? h('p', { class: 'chip-detail', text: chip.detail }) : null,
      trustA('chip-trust-in', 'See the evidence for this region →')));
  const picker = h('select', { class: 'region-picker', 'aria-label': 'Switch study region' },
    h('option', { value: '', text: 'Switch region', selected: true, disabled: true }),
    ...allRegions(manifest).map((r) => h('option', { value: r.id, text: r.name, disabled: r.id === region.id })));
  picker.addEventListener('change', () => {
    const target = { view: 'region', region: picker.value };
    const selection = new URLSearchParams(location.search);
    for (const key of ['month', 'ruler', 'compare', 'detail', 'all']) {
      if (selection.has(key)) target[key] = selection.get(key);
    }
    ctx.navigate(target);
  });
  const head = h('div', { class: 'lb-head' },
    h('div', { class: 'lb-title' },
      h('nav', { class: 'region-links', 'aria-label': 'Region navigation' },
        h('a', { class: 'lb-back', href: '?view=atlas', 'aria-label': 'Back to the map', onclick: (ev) => { ev.preventDefault(); ctx.backToAtlas(); } }, glyph('back'), 'Map'),
        allRegions(manifest).length > 1 ? picker : null),
      // the header Trust entry sits beside the chip, so it is in the first view at every width (the chip still expands)
      h('div', { class: 'title-line' }, h('h1', { text: region.name }), chipBox, trustA('chip-trust', 'See the evidence →')),
      regionGeoNote(region.id, baseLabel) ? h('p', { class: 'lb-geo', text: regionGeoNote(region.id, baseLabel) }) : ''),
    h('div', { class: 'lb-nav' }, inset));
  root.append(head);
  if (navNote) root.append(h('p', { class: 'nav-note', role: 'status', text: navNote }));
  root.__stageSlot = inset; root.__region = region;
  // One page structure for all study regions; validation differences change labels and the optional comparison
  // tool, never the layout. Findings first: when burning peaks, which months recur above usual, how to explore.
  const fd = findings({ months, env, minYears, baseLabel });
  const peakOf = (ms) => ms.reduce((a, i) => ((env[i] && env[i].p50) > (env[a] && env[a].p50) ? i : a), ms[0]);
  root.append(findingsPanel(fd, {
    highlight: (ms) => { shape.highlight(ms); tlPanel.highlight(ms); },
    // the recurring finding zooms into its smallest month (the one the shared axis flattens most); the season finding into its peak
    open: (ms) => { shape.openZoom(ms === fd.recurringLine.months ? ms.reduce((a, i) => ((env[i] && env[i].p50) < (env[a] && env[a].p50) ? i : a), ms[0]) : peakOf(ms)); seasonBox.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); },
  }));

  // ---------- season shape + selected year + year strip (the first viewport) ----------
  const rows = yearRows(months);
  const yearOfRows = new Map(rows.map((yr) => [yr.year, yr]));
  // default: the latest year with no drift-era month (from manifest.eras); later years stay one click away, marked unconfirmed
  const driftYears = unconfirmedYears(months, manifest.eras);
  const comparable = latestComparableYear(months, manifest.eras);
  // deep links: month=YYYY-MM selects that month (and its year); year=YYYY (M4.3b) selects a year when no month is given
  const yearParam = Number(params.year ?? new URLSearchParams(location.search).get('year')); // main.js does not parse year=
  const firstYear = monthGiven ? yearOf(state.selected.month)
    : Number.isInteger(yearParam) && yearOfRows.has(yearParam) ? yearParam : comparable;
  const spanTxt = (ys) => (ys.length ? (ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`) : '');
  const yearNote = h('p', { class: 'sv-yearnote' });
  const paintYearNote = () => {
    yearNote.textContent = !driftYears.length ? ''
      : driftYears.includes(state.year) ? `Unconfirmed: Aqua’s timing had drifted by ${state.year}. ${comparable} is the latest year we can compare with confidence.`
        : state.year === comparable ? `${comparable}: the latest year we can compare with confidence. ${spanTxt(driftYears)}: unconfirmed (Aqua’s timing drifted).`
          : `${spanTxt(driftYears)}: unconfirmed (Aqua’s timing drifted).`;
  };
  state.year = firstYear;
  const seasonValue = (r) => rulerValue(r, 'record', lanes.alt);
  const seasonVerdict = (r) => monthVerdict(r, 'record', env, lanes.alt).cls;
  // the axis holds every reference-year point drawn in the chart's cloud, so no real value is clipped
  const axisMax = Math.max(1, ...env.map((e) => (e.n_years >= minYears && e.p90 != null ? Math.max(e.p90, ...(e.values || []).filter(Number.isFinite)) : 0)), ...months.map((r) => seasonValue(r).value || 0));
  const unitLabel = `Aqua ${dayWord}detections per month in this box`;
  // the converted-VIIRS switch (default off): the region's own conversion lane, with its status wording on the layer
  const viirsLane = m2 ? region.m2 && region.m2.lane : region.method;
  const viirsOpt = !exploreOnly && chip.tested && viirsLane ? { lane: viirsLane, region, status: `VIIRS on Aqua’s scale · ${viirsWord}${gapCount ? ' · months Aqua missed: gap estimates, cannot be checked (no Aqua value)' : ''}`, gapTag: (r) => gapEstimateTag(r, region, manifest.eras) } : null;
  const shape = seasonHero({ env, minYears, axisMax, baseLabel, eras: manifest.eras, unitLabel, value: seasonValue, verdict: seasonVerdict,
    mainSeason: fd.mainSeason, recurrence: exploreOnly ? null : fd.recurring, allRows: months, viirs: viirsOpt, regionStatus: region.status, trust: { href: trustHrefFor, region: region.id }, machine: chip.tested && !exploreOnly ? { href: machineHrefFor, region: region.id } : null,
    onPick: (r, el) => openDetail(r, el), onSelect: (r) => select(r, { push: true, syncYear: false }) });
  const strip = yearStrip({ yearRows: rows, thresholds: aquaT, value: seasonValue, selected: firstYear, onSelect: (y) => setYear(y), flagged: driftYears, flagLabel: 'unconfirmed', stepperOnly: true });
  const seasonTitle = h('h2', { class: 'section-title', id: 'season-h' });
  const tally = h('p', { class: 'ss-tally', 'aria-live': 'polite' });
  const seasonBox = h('section', { class: 'season-view', 'aria-labelledby': 'season-h', 'aria-describedby': 'season-sum' },
    h('div', { class: 'sv-head' }, h('div', { class: 'sv-titles' }, seasonTitle, yearNote),
      h('div', { class: 'sv-years' }, h('p', { class: 'visually-hidden', id: 'ys-label', text: 'Choose a year to lay over the usual season' }), strip.el,
        h('p', { class: 'sv-hint', text: 'Step through years, or pick one in the timeline below.' }))),
    // the season sentence stays as the chart's spoken summary; the findings above carry it visibly
    h('p', { class: 'visually-hidden', id: 'season-sum', text: season.text }),
    shape.el,
    h('div', { class: 'sv-under' }, tally),
    h('details', { class: 'disclose sv-how' }, h('summary', { text: 'How this is counted' }),
      ...fd.notes.map((t) => h('p', { class: 'caption', text: t })),
      h('p', { class: 'caption', text: `${SCREENING_NOTE} ${DETECTION_NOTE}` }),
      h('p', { class: 'caption measure-line', text: measureLine })));
  root.append(seasonBox);

  // ---------- unusual months: a year x month timeline; every unusual month is one keyboard path away ----------
  const tlPanel = timelinePanel({ months, env, region, mainMonths: fd.mainSeason ? fd.mainSeason.months : [], onPick: (r, el) => openDetail(r, el),
    onYear: (y) => { setYear(y); seasonBox.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); } });
  tlPanel.slot.append(latestBox);
  root.append(tlPanel.el);

  // ---------- toolbar: compare, test, CSV ----------
  const cmp = compareUI(S);
  const csvBtn = h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => downloadCsv() }, glyph('download'), `Download CSV${fixture ? ' (fixture)' : ''}`);
  const calToggle = h('button', { class: 'btn btn-quiet cal-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'calendar' }, 'Show every month');
  root.append(h('div', { class: 'toolbar quiet-row' }, calToggle, m2 ? null : cmp.toggle, csvBtn), m2 ? h('span', { hidden: true }) : cmp.panel);

  // ---------- calendar (contact sheet), behind "Show every month" ----------
  const sheet = h('div', { class: 'sheet', role: 'grid', 'aria-label': `Monthly detections for ${region.name}, one row per year. Use arrow keys to move between months.`, 'aria-rowcount': rows.length + 2 });
  const countHead = h('span', { role: 'columnheader', text: 'Months vs usual' });
  sheet.append(h('div', { class: 'sheet-head', role: 'row' }, h('span', { role: 'columnheader', text: 'Year' }), ...MONTH_ABBR.map((m) => h('span', { role: 'columnheader', text: m })), countHead));
  const usualCells = env.map((e, i) => h('div', { class: 'cell', role: 'gridcell', 'aria-label': `Usual ${MONTH_FULL[i]}: typical ${fmtN(e.p50)} from ${e.n_years} Aqua years` }));
  sheet.append(h('div', { class: 'yrow usual', role: 'row', 'data-year': 'usual' },
    h('span', { class: 'ylab', role: 'rowheader', text: 'Usual' }), ...usualCells.map((c) => h('div', { class: 'mcol' }, c)),
    h('span', { class: 'ynote', text: `typical ${baseLabel}` })));
  sheet.append(h('div', { class: 'usual-gap', 'aria-hidden': 'true' }));

  const eraStarts = new Map();
  for (const e of manifest.eras || []) { const y = yearOf(e.start); if (!eraStarts.has(y)) eraStarts.set(y, []); eraStarts.get(y).push(e); }
  const eraStartMonths = new Set((manifest.eras || []).map((e) => e.start));
  const cellEls = []; const rowEls = [];
  for (const yr of rows) {
    if (eraStarts.has(yr.year)) {
      sheet.append(h('div', { class: 'era-tag', 'aria-hidden': 'true' }, ...eraStarts.get(yr.year).map((e) => h('span', { text: eraPlain(e) }))));
    }
    const label = h('span', { class: 'ylab', role: 'rowheader' }, String(yr.year), yr.heldOut ? h('span', { class: 'dag', title: 'Test year: hidden when the conversion was built', 'aria-label': 'test year', text: '†' }) : '');
    const cols = yr.cells.map((r) => {
      const col = h('div', { class: 'mcol' });
      if (!r) { col.append(h('div', { class: 'cell st-not_in_archive', role: 'gridcell', 'aria-label': 'outside the series' })); return col; }
      const cell = h('div', { class: 'cell', role: 'gridcell', tabindex: '-1', 'data-month': r.month });
      if (eraStartMonths.has(r.month) && monthIndex(r.month) !== 0) cell.classList.add('era-start');
      cell.__row = r;
      cell.__strands = h('div', { class: 'strands' });
      col.append(cell, cell.__strands);
      cellEls.push(cell);
      return col;
    });
    const note = h('span', { class: 'ynote counts' });
    const rowEl = h('div', { class: `yrow${yr.heldOut ? ' held' : ''}`, role: 'row', 'data-year': yr.year }, label, ...cols, note);
    rowEl.__yr = yr; rowEl.__note = note;
    rowEls.push(rowEl);
    sheet.append(rowEl);
  }
  const sheetKey = h('div', { class: 'sheet-legend' });
  const sheetWrap = h('div', { class: 'sheet-wrap' }, sheetKey, sheet, fixtureVeil(fixture));
  const calendar = h('section', { class: 'calendar', id: 'calendar', 'aria-label': `Every month for ${region.name}`, hidden: true },
    h('h2', { class: 'section-title cal-title', text: 'Full burning calendar' }),
    h('p', { class: 'caption cal-note', text: `Calendar: Aqua ${dayWord}detections per month in this box, measured by Aqua only. ${DETECTION_NOTE}` }), sheetWrap);
  root.append(calendar);
  // the full calendar is painted lazily: on first open, and on every repaint while it is open
  let calDirty = true;
  function paintCalendar() { paintUsual(); cellEls.forEach(paintCell); paintCounts(); paintKey(); calDirty = false; }
  function setCalendar(open) {
    calendar.hidden = !open;
    if (open && calDirty) paintCalendar();
    calToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    calToggle.textContent = open ? 'Hide every month' : 'Show every month';
  }
  calToggle.addEventListener('click', () => { const open = calendar.hidden; setCalendar(open); ctx.setParams({ all: open ? '1' : null }); if (open) { const c = cellEls.find((x) => x.tabIndex === 0); if (c) c.focus(); } });

  // ---------- optional tool: compare a newer-satellite month with the 2000s ----------
  let decadesTeardown = null; // the Across-decades panel may hold its own listeners (el.__teardown, set by decades.js)
  const tool = h('details', { class: 'optional-tool', id: 'across-decades' },
    h('summary', {}, h('span', { class: 'ot-title', text: 'Optional: compare a newer-satellite month with the 2000s' }),
      h('span', { class: 'caption', text: m2 ? ` tested tool · ${chip.word.replace(/^VIIRS estimates: /, '')}` : ' not validated for NOAA-20 here' })));
  if (m2) {
    const dp = await decadesPanel({ ctx, manifest, region, series, env });
    decadesTeardown = dp.el && typeof dp.el.__teardown === 'function' ? dp.el.__teardown : null;
    tool.append(dp.el);
    if (params.rev || params.tm) tool.open = true;
  } else if (chip.tested) tool.append(m1NoaaLine((manifest.m2_regions || []).length));
  else tool.append(h('p', { class: 'caption', text: 'No satellite conversion has been tested in this region.' }));
  root.append(tool);

  // ---------- month detail: popover beside the cell (desktop) or bottom sheet (phone) ----------
  const loupe = h('div', { class: 'loupe' });
  const closeBtn = h('button', { type: 'button', class: 'md-close', 'aria-label': 'Close month detail' }, '×');
  const detail = h('div', { class: 'mdetail', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'loupe-h', hidden: true }, closeBtn, loupe);
  const scrim = h('div', { class: 'md-scrim', hidden: true, 'aria-hidden': 'true' });
  root.append(scrim, detail);
  let detailAnchor = null;

  // ---------- lower: simple satellite timeline, then "Method details" ----------
  const tl = renderTimeline(sensors, region.id, region.name, manifest.eras);
  root.append(h('div', { class: 'lb-lower' }, tl.box, advancedSection(S, tl.extras)));

  // ---------- painting ----------
  const rowOf = new Map(rowEls.map((re) => [re.__yr.year, re.__yr]));
  function paintCell(cell) {
    const r = cell.__row;
    cell.className = cell.className.split(' ').filter((c) => c === 'cell' || c === 'era-start' || c === 'selected').join(' ');
    cell.replaceChildren();
    let label;
    if (state.ruler === 'raw') {
      const st = nativeStatus(r, 'aqua');
      if (st === 'observed') { const k = classOf(nativeN(r, 'aqua'), S.rawAquaT); cell.classList.add(k === 0 ? 'c0' : `t${k}`); if (k >= 4) cell.classList.add('dark'); }
      else if (recordSource(r) === 'terra_only' && st === 'not_in_archive') cell.classList.add('st-terra_only');
      else cell.classList.add(`st-${st}`);
      const viirs = VIIRS_PLATFORMS.filter((p) => nativeStatus(r, p) === 'observed').map((p) => `${PLATFORM_LABEL[p]} ${fmtN(nativeN(r, p))}`);
      label = `${monthLabel(r.month)}: Aqua MODIS ${st === 'observed' ? countWords(nativeN(r, 'aqua'), 0) : NATIVE_STATUS_WORD[st]}${viirs.length ? `; ${viirs.join('; ')}` : ''}. Each on its own scale, no verdict.`;
    } else {
      const v = rulerValueFor(r);
      const src = recordSource(r);
      if (v.value != null) {
        const k = classOf(v.value, aquaT); cell.classList.add(k === 0 ? 'c0' : `o${k}`); if (k >= 3) cell.classList.add('dark');
        if (v.kind === 'modelled') cell.classList.add('modelled');
        if (v.kind === 'blended') cell.classList.add('blended');
      } else if (src === 'terra_only') cell.classList.add('st-terra_only');
      else if (src === 'not_observed') cell.classList.add(nativeStatus(r, 'aqua') === 'excluded' ? 'st-excluded' : 'st-not_observed');
      else cell.classList.add('st-unknown');
      const vd = verdictOf(r);
      if (v.value != null || vd === 'none') cell.append(glyph(VERDICT[vd].glyph));
      const drift = ['above', 'within', 'below'].includes(vd) && isDriftMonth(r, manifest.eras);
      label = `${monthLabel(r.month)}: ${v.value != null ? countWords(v.value) : 'no Aqua-scale count'}, ${sourceTag(r)}${state.ruler === 'alt' && isViirsDerived(r) ? ` (${S.altName.toLowerCase()}, not adopted)` : ''}, ${VERDICT[vd].word}${drift ? ' (unconfirmed: Aqua’s timing drifted)' : ''}${r.held_out ? ', test year' : ''}`;
    }
    const cav = state.ruler === 'raw' ? [] : caveatsOf(r).filter((k) => k.key !== 'aqua_drifting');
    if (cav.length) { cell.classList.add('caveat'); cell.append(h('span', { class: 'cv-mark', 'aria-hidden': 'true' })); label += '. Read with care'; }
    cell.setAttribute('aria-label', label);
    paintStrands(S, cell, rowOf.get(yearOf(r.month)));
  }

  function paintUsual() {
    usualCells.forEach((c, i) => {
      c.className = 'cell';
      const e = env[i];
      if (e.n_years === 0) { c.classList.add('st-not_in_archive'); return; }
      const k = classOf(e.p50, state.ruler === 'raw' ? S.rawAquaT : aquaT);
      c.classList.add(k === 0 ? 'c0' : state.ruler === 'raw' ? `t${k}` : `o${k}`);
    });
  }

  function paintCounts() {
    countHead.textContent = state.ruler === 'raw' ? '' : 'Months vs usual';
    for (const re of rowEls) {
      re.__note.replaceChildren();
      if (state.ruler === 'raw') continue;
      const c = countVerdicts(re.__yr.cells.filter(Boolean).map(verdictOf));
      const parts = [['above', c.above], ['within', c.within], ['below', c.below]].filter(([, n]) => n > 0);
      re.__note.setAttribute('aria-label', `${re.__yr.year}: ${c.above} months above usual, ${c.within} within, ${c.below} below, ${c.unknown} can’t tell`);
      re.__note.append(...parts.map(([k, n]) => h('span', { class: `vc vc-${k}` }, glyph(VERDICT[k].glyph), String(n))));
    }
  }

  function ramp(prefix, t, title) {
    const labs = t ? ['0', `≤${fmtN(t[0], 1)}`, ...t.slice(1).map((x) => `≤${fmtN(x, 1)}`), `>${fmtN(t[t.length - 1], 1)}`] : ['0', '>0'];
    return h('div', { class: 'legend-block' }, h('span', { class: 'legend-title', text: title }),
      h('div', { class: 'legend-ramp' }, ...labs.map((l, i) => h('div', { class: 'step' }, h('span', { class: `sw ${i === 0 ? 'c0' : prefix + i}` }), h('span', { class: 'lab', text: l })))));
  }
  function paintKey() {
    sheetKey.replaceChildren();
    if (state.ruler === 'raw') sheetKey.append(...rawKey(S, ramp));
    else {
      sheetKey.append(ramp('o', aquaT, 'Detections per month'),
        h('div', { class: 'legend-items' },
          ...['above', 'within', 'below', 'unknown'].map((k) => h('span', {}, glyph(VERDICT[k].glyph), VERDICT[k].word)),
          months.some((r) => rulerValueFor(r).kind === 'modelled') ? h('span', {}, h('span', { class: 'sw o2 sw-framed' }), 'framed = estimated from the newer satellite') : '',
          h('span', {}, h('span', { class: 'sw st-not_observed' }), 'hatched = not observed (not zero)')));
    }
    if (state.ruler === 'raw') sheetKey.append(h('div', { class: 'legend-items' }, h('span', {}, h('span', { class: 'sw st-not_observed' }), 'hatched = not observed (not zero)')));
    sheetKey.append(h('details', { class: 'legend-more' }, h('summary', { text: 'More symbols' }), h('div', { class: 'legend-items' },
      h('span', {}, h('span', { class: 'sw o2', style: 'position:relative' }, h('span', { class: 'cv-mark' })), 'corner = read with care (an estimate that can’t be checked, or a drift-year estimate)'),
      h('span', {}, h('span', { class: 'sw st-terra_only' }), 'dashed = no count on the older satellite’s scale'),
      h('span', {}, h('b', { text: '†' }), 'test year: hidden when the conversion was built'))));
  }

  function paintAll(animateChanges) {
    const calOpen = !calendar.hidden;
    const before = animateChanges && calOpen ? new Map(cellEls.map((c) => [c, c.className + c.childElementCount])) : null;
    if (calOpen) paintCalendar(); else calDirty = true;
    paintLatest();
    paintSeason();
    cmp.paint();
    if (before && !prefersReducedMotion()) {
      for (const c of cellEls) if (before.get(c) !== c.className + c.childElementCount && recordSource(c.__row) !== 'observed_aqua') {
        c.animate([{ transform: 'scaleY(0.4)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.16,1,0.3,1)' });
      }
    }
    for (const fn of painters) fn();
  }

  function paintLatest() {
    latestBox.replaceChildren();
    const r = latest;
    if (!r) { latestBox.append(h('p', { class: 'latest-line', text: 'No month in this record has an Aqua-scale count yet.' })); return; }
    if (exploreOnly) { latestBox.append(h('p', { class: 'latest-line', text: `Last month in this record: ${monthLabel(r.month)}. Explore only, so there is no comparison with the usual year.` })); return; }
    const vd = monthVerdict(r, 'record', env, lanes.alt).cls;
    const s = lastMonthLine(r, { verdict: vd, period: baseLabel, region, eras: manifest.eras });
    latestBox.append(h('p', { class: 'latest-line' }, h('span', { class: 'latest-verdict' }, glyph(VERDICT[vd] ? VERDICT[vd].glyph : 'unknown')), s.text),
      ...s.caveats.map((k) => h('p', { class: 'caveat-line', 'data-caveat': k.key, text: k.text })));
  }

  let moreOpen = state.advanced;
  function paintLoupe(r) {
    loupe.replaceChildren(h('h2', { id: 'loupe-h', text: monthLabel(r.month) }));
    const e = env[monthIndex(r.month)];
    const usual = e.n_years >= minYears && e.p10 != null ? `Usual for ${MONTH_FULL[monthIndex(r.month)]}: ${fmtN(e.p10, 1)}–${fmtN(e.p90, 1)}.` : `Too few usual years for ${MONTH_FULL[monthIndex(r.month)]} (${e.n_years}; need ${minYears}): no verdict.`;
    if (state.ruler === 'raw') {
      const items = ['aqua', ...VIIRS_PLATFORMS].filter((p) => p === 'aqua' || nativeStatus(r, p) === 'observed').map((p) => h('li', {}, h('b', { text: `${PLATFORM_LABEL[p]}: ` }), nativeStatus(r, p) === 'observed' ? `${fmtN(nativeN(r, p))} detections` : NATIVE_STATUS_WORD[nativeStatus(r, p)]));
      loupe.append(h('ul', { class: 'plain-list' }, ...items), h('p', { class: 'caption', text: 'Each satellite on its own scale: these counts are not comparable with each other, so there is no verdict.' }));
    } else {
      const v = rulerValueFor(r); const vd = verdictOf(r);
      const iv = fmtInterval(v.lo, v.hi);
      loupe.append(h('p', { class: 'loupe-main' }, h('b', { text: `${cap(sourceTag(r))}${v.value != null ? ':' : '.'}` }), v.value != null ? ` ${v.value === 0 ? `no detections reported${v.kind === 'observed' ? ' (Aqua observed)' : ''}` : `${fmtN(v.value, 1)} detections`}${iv ? ` (likely range ${iv})` : ''}.` : ''),
        h('p', { class: 'loupe-usual', text: usual }), h('p', {}, verdictWord(vd)));
      if (state.ruler === 'alt' && isViirsDerived(r)) loupe.append(h('p', { class: 'caption', text: `Shown with the ${S.altName.toLowerCase()} (not adopted), not the record.` }));
      if (isViirsDerived(r) && v.value != null) {
        const lane = r.record && r.record.lane; const inputs = lane && r.modelled && r.modelled[lane] ? r.modelled[lane].inputs || [] : [];
        loupe.append(h('p', { class: 'loupe-source', 'data-rule': 'satellite-selection', text: estimateSource(region, { platform: inputs[0] || null, afterValidation: ['aqua_drift', 'post_modis'].includes(r.era) }).text }));
      }
      const cv = mustShowCaveats(r, region, manifest.eras, vd);
      if (cv.length) loupe.append(h('ul', { class: 'caveats' }, ...cv.map((k) => h('li', { 'data-caveat': k.key, text: k.text }))));
      // UI-01: the stored gap estimate stays reachable, labelled, and outside the Aqua-only record
      const g = r.gap_estimate;
      if (g && g.value != null) loupe.append(h('p', { class: 'loupe-gap', 'data-gap': 'estimate', text: `Stored VIIRS estimate (not in the Aqua record): ${fmtN(g.value, 1)}${fmtInterval(g.lo, g.hi) ? `, likely range ${fmtInterval(g.lo, g.hi)}` : ''} · ${gapEstimateTag(r, region, manifest.eras)}.` }));
    }
    const tm = twoSatModel(r, { method: lanes.record, env, region, eras: manifest.eras });
    if (twoSatAvailable(tm, region)) {
      const plat = PLATFORM_LABEL[tm.viirs.platform] || tm.viirs.platform;
      const hidden = tm.heldOut ? 'This year was hidden; neighbouring years were used to build the conversion.' : tm.train ? 'This year was used to build the conversion, so it is not a test.' : 'Not one of the test years.';
      const tested = manifest.regions.filter((x) => ['validated', 'provisional'].includes(x.status));
      const held = tested.filter((x) => x.status === 'validated');
      const scope = `Region: ${chip.word} (on hidden years). ${hidden} Daytime, ${plat} only. One example; the conversion is tested in ${tested.length} regions and held up in ${held.length}.`;
      loupe.append(twoSat(tm, { domain: tsDomain, regionName: shortName(region.name), scope, revealed: true, idPrefix: 'md-ts', ratioMethod: /ratio/i.test(lanes.record) }).el);
    }
    const more = loupeDetail(S, r);
    more.open = moreOpen;
    more.addEventListener('toggle', () => { moreOpen = more.open; });
    loupe.append(more);
  }

  const tsDomain = twoSatDomain(months, lanes.record);

  function paintSeason() {
    const yr = yearOfRows.get(state.year);
    const cells = yr ? yr.cells : Array(12).fill(null);
    seasonTitle.textContent = `The usual season, and ${state.year}`;
    paintYearNote();
    tlPanel.setYear(state.year);
    shape.paint(state.year, cells);
    const c = yearTally(cells, seasonVerdict);
    // any drift month in the year makes every verdict in it unconfirmed: say so first (QA B1)
    const anyDrift = cells.some((r) => r && ['above', 'within', 'below'].includes(seasonVerdict(r)) && isDriftMonth(r, manifest.eras));
    // closeout: the live region announces its text content, so the spoken tally is a visually-hidden span
    // (aria-label on a <p> is not reliably announced); the visible glyph chips stay aria-hidden.
    // M4.2: the visible counts now live in the chart's "<year> vs usual" lane title; the spoken tally stays here
    tally.replaceChildren(h('span', { class: 'visually-hidden', text: tallyText(state.year, c, anyDrift) }));
  }

  function setYear(y, { fromCalendar = false } = {}) {
    if (y === state.year) return;
    state.year = y;
    strip.set(y);
    paintSeason();
    if (!fromCalendar) {
      const keep = monthIndex(state.selected.month);
      const yr = yearOfRows.get(y);
      const r = yr && (yr.cells[keep] || yr.cells.find(Boolean));
      if (r) select(r, { push: true, syncYear: false });
    }
  }

  function openDetail(r, anchor) {
    if (r !== state.selected) select(r, { syncYear: true });
    paintLoupe(r);
    detailAnchor = anchor || null;
    const sheetMode = window.matchMedia('(max-width: 640px)').matches;
    detail.classList.toggle('is-sheet', sheetMode);
    detail.setAttribute('aria-modal', sheetMode ? 'true' : 'false'); // the phone sheet sits over a scrim: it is modal
    detail.hidden = false; scrim.hidden = !sheetMode;
    detail.style.left = ''; detail.style.top = '';
    if (!sheetMode && anchor) {
      const rr = root.getBoundingClientRect(); const a = anchor.getBoundingClientRect();
      const w = detail.offsetWidth; const ht = detail.offsetHeight;
      const right = a.right + 12 + w <= window.innerWidth - 8;
      let left = right ? a.right + 12 : a.left - 12 - w;
      left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
      let top = a.top - 24;
      top = Math.max(8, Math.min(window.innerHeight - ht - 8, top));
      detail.style.left = `${left - rr.left}px`; detail.style.top = `${top - rr.top}px`;
    }
    if (sheetMode && !prefersReducedMotion()) detail.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    const hd = loupe.querySelector('h2'); hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: !sheetMode });
  }
  function closeDetail({ restore = true } = {}) {
    if (detail.hidden) return;
    detail.hidden = true; scrim.hidden = true;
    if (restore && detailAnchor && detailAnchor.isConnected) detailAnchor.focus({ preventScroll: true });
    detailAnchor = null;
  }
  closeBtn.addEventListener('click', () => closeDetail());
  scrim.addEventListener('click', () => closeDetail());
  detail.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeDetail(); return; }
    // phone sheet: keep Tab inside the sheet (the page behind is covered by the scrim)
    if (ev.key !== 'Tab' || !detail.classList.contains('is-sheet')) return;
    const f = [...detail.querySelectorAll('button, summary, a[href], select, input, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.getClientRects().length);
    if (!f.length) return;
    const first = f[0]; const last = f[f.length - 1]; const a = document.activeElement;
    if (ev.shiftKey && a === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && a === last) { ev.preventDefault(); first.focus(); }
  });
  // document listeners live for one render: aborted by root.__teardown (called by main.js before the next view)
  const ac = new AbortController();
  root.__teardown = () => { ac.abort(); shape.destroy(); if (decadesTeardown) decadesTeardown(); };
  const outside = (ev) => {
    if (!detail.hidden && !detail.contains(ev.target) && ev.target !== scrim && !(detailAnchor && detailAnchor.contains(ev.target)) && !ev.target.closest('.hc-col, .ut-c, .cell[data-month]')) closeDetail({ restore: false });
  };

  function select(r, { focus = false, push = true, syncYear = true } = {}) {
    state.selected = r;
    for (const c of cellEls) { const on = c.__row === r; c.classList.toggle('selected', on); c.tabIndex = on ? 0 : -1; c.setAttribute('aria-selected', on ? 'true' : 'false'); if (on && focus) c.focus(); }
    if (syncYear && yearOf(r.month) !== state.year) setYear(yearOf(r.month), { fromCalendar: true });
    shape.setCurrent(monthIndex(r.month));
    if (!detail.hidden) paintLoupe(r);
    if (push) ctx.setParams({ month: r.month });
    // the header Trust link carries the month when it is a plausible test month (Trust checks it again, R5)
    for (const a of head.querySelectorAll('a[data-nav="trust"]')) a.setAttribute('href', trustHrefFor(r));
  }

  function setRuler(r) {
    if (exploreOnly && r !== 'raw') return;
    state.ruler = r;
    ctx.setParams({ compare: r === 'record' ? null : '1', ruler: r === 'alt' ? 'alt' : null });
    if (r !== 'record') setCalendar(true);
    paintAll(true);
    if (!detail.hidden) paintLoupe(state.selected);
  }

  function downloadCsv() {
    const blob = new Blob([buildCsv(series)], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: csvFilename(series) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  // keyboard: roving focus across months; up/down moves a year
  // Keyboard: roving focus. Home/End use the row's own months (core.calendarMove), so a partial first row is safe.
  const monthList = cellEls.map((c) => c.__row.month);
  const cellOf = new Map(cellEls.map((c) => [c.__row.month, c]));
  sheet.addEventListener('keydown', (ev) => {
    const cell = ev.target.closest('.cell[data-month]'); if (!cell) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(cell.__row, cell); return; }
    const target = calendarMove(monthList, cell.__row.month, ev.key);
    if (target == null) return;
    ev.preventDefault();
    select(cellOf.get(target).__row, { focus: true });
  });
  sheet.addEventListener('click', (ev) => { const c = ev.target.closest('.cell[data-month]'); if (c) { select(c.__row, { focus: true }); openDetail(c.__row, c); } });

  root.__afterMount = () => {
    paintAll(false);
    select(state.selected, { push: false, syncYear: false });
    if (params.all === '1' || state.ruler !== 'record' || state.advanced) setCalendar(true);
    if (params.detail && params.month === state.selected.month) requestAnimationFrame(() => openDetail(state.selected, shape.button(monthIndex(state.selected.month))));
    // the readout opens on a month that recurs above usual yet is not above this year (M4.2: the readout then states
    // both answers side by side), else on the selected year's peak month, unless a month was asked for in the URL
    if (!monthGiven) { const cm = shape.contrastMonth(); if (cm != null) shape.setCurrent(cm, { why: true }); else shape.setCurrent(shape.peakMonth()); }
    if (calPick) ctx.setParams({ month: state.selected.month, cal: null }); // cal is converted once; month is this page's vocabulary
    document.addEventListener('pointerdown', outside, { capture: true, signal: ac.signal });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (!detail.hidden) { ev.preventDefault(); closeDetail(); return; }
      if (!ev.target.closest('select, input[type=text], details[open] summary, .glossary')) { ev.preventDefault(); ctx.backToAtlas(); }
    }, { signal: ac.signal });
    if (ctx.fromAtlas) { const h1 = head.querySelector('h1'); h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  };

  return root;
}
