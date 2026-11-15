// Sensor-life strip: actual spans solid, projected spans dashed and labelled, unknown ends left open.
import { missionSpan, decimalYear, PLATFORM_LABEL, overpassSeries, fmtHour } from './core.js';
import { h } from './ui.js';

// M4.1: dark-theme instrument colours (were light-paper inks, near-invisible on the dark page). MODIS = luminous, VIIRS = violet identity.
const COLOR = { terra: '#8E9A9A', aqua: '#F4F6F2', snpp: '#CCA6E7', noaa20: '#CCA6E7', noaa21: '#CCA6E7' };

/**
 * Returns { box, extras }: box is the simple strip shown to everyone; extras (overpass-time panel and the
 * table of every mission date with its source) go into the region's "Method details" section.
 */
export function renderTimeline(sensors, scope = null, scopeName = null, eras = null) {
  const driftEra = (Array.isArray(eras) ? eras : []).find((e) => e.id === 'aqua_drift') || null; // SQ-09
  const box = h('section', { class: 'timeline', 'aria-labelledby': 'tl-h' });
  const extras = [];
  box.append(h('h2', { class: 'section-title', id: 'tl-h', text: 'The satellites behind this record' }));
  if (!sensors) { box.append(h('p', { class: 'caption', text: 'Mission dates (sensors.json) are not available, so the satellite timeline is not drawn.' })); return { box, extras }; }
  const missions = sensors.missions || [];
  const spans = missions.map((m) => ({ m, s: missionSpan(m) }));
  const asOf = decimalYear(sensors.as_of) || null;
  const years = spans.flatMap(({ s }) => [s.start, s.endActual, s.endProjected].filter(Boolean).map((e) => decimalYear(e.date)));
  if (asOf) years.push(asOf);
  if (!years.some(Number.isFinite)) { box.append(h('p', { class: 'caption', text: 'No dated mission events are listed, so the timeline is not drawn.' })); return { box, extras }; }
  const x0 = Math.floor(Math.min(...years)); const x1 = Math.ceil(Math.max(...years) + 2);

  const modisEnds = spans.filter(({ m }) => m.instrument === 'MODIS').map(({ s }) => s.endActual || s.endProjected).filter(Boolean);
  const viirsStarts = spans.filter(({ m }) => m.instrument === 'VIIRS').map(({ s }) => s.start).filter(Boolean);
  const ovStart = viirsStarts.length ? Math.min(...viirsStarts.map((e) => decimalYear(e.date))) : null;
  const ovEndEv = modisEnds.length ? modisEnds.reduce((a, b) => (decimalYear(a.date) > decimalYear(b.date) ? a : b)) : null;
  const ovEnd = ovEndEv ? decimalYear(ovEndEv.date) : asOf;

  // one sentence (M4.1ux): who built the record, where a conversion can be checked, and when MODIS ends
  box.append(h('p', { class: 'caption' },
    `MODIS built most of this record and VIIRS (finer pixels, so it counts differently) continues it${ovStart != null ? `; a conversion can be checked only where both fly (from ${Math.floor(ovStart)})` : ''}${ovEndEv ? `; MODIS end of science: ${ovEndEv.status === 'projected' ? 'projected' : 'recorded'} ${ovEndEv.date}${ovEndEv.status === 'projected' ? ', not yet certain' : ''}` : ''}.`));

  const d3 = window.d3;
  const W = 1000; const rowH = 36; const top = 44; const left = 150; const right = 230;
  const H = top + spans.length * rowH + 30;
  const x = d3.scaleLinear().domain([x0, x1]).range([left, W - right]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
    .attr('aria-label', `Mission timeline for ${spans.length} instruments. Actual dates are solid; projected dates are dashed and labelled projected. The table that follows lists every date and its source.`);
  if (ovStart != null && ovEnd != null && ovEnd > ovStart) {
    svg.append('rect').attr('class', 'tl-overlap').attr('x', x(ovStart)).attr('y', top - 6).attr('width', x(ovEnd) - x(ovStart)).attr('height', spans.length * rowH + 4);
    svg.append('text').attr('class', 'tl-ann').attr('x', x(ovStart) + 4).attr('y', top - 26).text('both satellites measuring: where the conversion is checked');
  }
  const ax = svg.append('g').attr('class', 'tl-axis').attr('transform', `translate(0,${top + spans.length * rowH + 2})`)
    .call(d3.axisBottom(x).ticks(Math.min(14, x1 - x0)).tickFormat(d3.format('d')).tickSizeOuter(0));
  ax.select('.domain').remove();
  const lab = (e) => e.date;
  spans.forEach(({ m, s }, i) => {
    const y = top + i * rowH + rowH / 2;
    const col = COLOR[m.platform] || '#8E9A9A';
    svg.append('text').attr('class', 'tl-label').attr('x', 0).attr('y', y - 1).text(m.label && !/⟨/.test(m.label) ? m.label : PLATFORM_LABEL[m.platform] || m.platform);
    svg.append('text').attr('class', 'tl-sub').attr('x', 0).attr('y', y + 11).text(`${m.instrument}${m.nominal_overpass_local ? ` · ${m.nominal_overpass_local}` : ''}`);
    if (!s.start) return;
    if (!s.archiveStart) {
      const lx = x(decimalYear(s.launch.date));
      svg.append('line').attr('x1', lx).attr('x2', lx).attr('y1', y - 6).attr('y2', y + 6).attr('stroke', col).attr('stroke-width', 1.5);
      svg.append('text').attr('class', 'tl-sub').attr('x', lx + 6).attr('y', y + 3).text(`launch ${lab(s.launch)} · no FIRMS archive dates listed`);
      return;
    }
    const a = decimalYear(s.start.date);
    const endA = s.endActual ? decimalYear(s.endActual.date) : (asOf || a);
    // drift: a lighter hatched band on the row from the drift start
    if (s.drift) {
      const d0 = decimalYear(s.drift.date);
      const d1 = s.endProjected ? decimalYear(s.endProjected.date) : endA;
      svg.append('rect').attr('x', x(d0)).attr('y', y - 9).attr('width', Math.max(0, x(d1) - x(d0))).attr('height', 18).attr('fill', 'url(#pat-hatch)').attr('opacity', 0.45);
      svg.append('text').attr('class', 'tl-sub').attr('x', x(d0)).attr('y', y - 11).text(`orbit drift begins ${s.drift.date}${s.drift.status === 'projected' ? ' (projected)' : ''}${m.platform === 'aqua' && driftEra && driftEra.start > s.drift.date ? `; counted as drift from ${driftEra.start.slice(0, 4)}` : ''}`);
    }
    svg.append('line').attr('class', 'tl-bar').attr('x1', x(a)).attr('x2', x(endA)).attr('y1', y).attr('y2', y).attr('stroke', col);
    // launch is a tick, separate from when the FIRMS archive starts
    if (s.launch && s.archiveStart && s.launch.date !== s.archiveStart.date) {
      const lx = x(decimalYear(s.launch.date));
      svg.append('line').attr('x1', lx).attr('x2', lx).attr('y1', y - 6).attr('y2', y + 6).attr('stroke', col).attr('stroke-width', 1.5);
      svg.append('text').attr('class', 'tl-sub').attr('x', lx).attr('y', y + 15).attr('text-anchor', 'start').text(`launch ${lab(s.launch)}`);
    }
    if (!s.drift) svg.append('text').attr('class', 'tl-sub').attr('x', x(a)).attr('y', y - 7).attr('text-anchor', x(a) > 700 ? 'end' : 'start').text(s.archiveStart ? `FIRMS data from ${lab(s.archiveStart)}` : lab(s.start));
    if (s.constellationExit) {
      const cx = x(decimalYear(s.constellationExit.date));
      svg.append('circle').attr('cx', cx).attr('cy', y).attr('r', 3).attr('fill', '#101518').attr('stroke', '#F4F6F2');
    }
    if (s.endActual) {
      svg.append('line').attr('x1', x(endA)).attr('x2', x(endA)).attr('y1', y - 6).attr('y2', y + 6).attr('stroke', '#F4F6F2').attr('stroke-width', 1.5);
      svg.append('text').attr('class', 'tl-sub').attr('x', x(endA) + 6).attr('y', y + 3).text(s.endActualKind === 'archive_end' ? `FIRMS data ends ${lab(s.endActual)} (not retirement)` : `ended ${lab(s.endActual)}`);
    } else if (s.endProjected) {
      const p = decimalYear(s.endProjected.date);
      if (p > endA) svg.append('line').attr('class', 'tl-proj').attr('x1', x(endA)).attr('x2', x(p)).attr('y1', y).attr('y2', y).attr('stroke', col).attr('opacity', 0.7);
      svg.append('text').attr('class', 'tl-sub').attr('x', x(Math.max(p, endA)) + 6).attr('y', y + 3).text(`projected end of science ${lab(s.endProjected)}`);
    } else {
      svg.append('line').attr('x1', x(endA)).attr('x2', x(endA) + 26).attr('y1', y).attr('y2', y).attr('stroke', col).attr('stroke-width', 1.5).attr('stroke-dasharray', '1 3');
      svg.append('text').attr('class', 'tl-sub').attr('x', x(endA) + 32).attr('y', y + 3).text('continuing; end not announced');
    }
  });
  if (asOf) {
    svg.append('line').attr('class', 'tl-today').attr('x1', x(asOf)).attr('x2', x(asOf)).attr('y1', top - 4).attr('y2', top + spans.length * rowH);
    svg.append('text').attr('class', 'tl-sub').attr('x', x(asOf) + 4).attr('y', top - 10).attr('text-anchor', 'start').text(`as of ${sensors.as_of}`);
  }
  box.append(h('div', { style: 'overflow-x:auto' }, h('div', { style: 'min-width:640px' }, svg.node())));
  const lst = missions.map((m) => ({ m, pts: overpassSeries(sensors, m.platform, 'D', scope) })).filter((o) => o.pts.length > 1);
  if (lst.length) extras.push(h('section', { 'aria-labelledby': 'lst-h' }, h('h2', { class: 'section-title', id: 'lst-h', text: 'Overpass time (orbit drift)' }), lstPanel(lst, x0, x1, scopeName)));

  const rows = missions.flatMap((m) => (m.events || []).map((e) => h('tr', {},
    h('td', { text: PLATFORM_LABEL[m.platform] || m.platform }), h('td', { text: e.kind.replace(/_/g, ' ') }),
    h('td', { class: 'num', text: e.date || 'unknown' }), h('td', { text: e.status }), h('td', { text: e.source || '—' }), h('td', { text: e.note || '' }))));
  extras.push(h('details', { class: 'more' }, h('summary', { text: 'Every mission date and its source' }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, ...['Platform', 'Event', 'Date', 'Status', 'Source', 'Note'].map((t) => h('th', { scope: 'col', text: t })))), h('tbody', {}, ...rows)))));
  return { box, extras };
}

/** Median daytime overpass local solar time per year, from the data: the drift made visible. */
function lstPanel(series, x0, x1, scopeName) {
  const d3 = window.d3;
  const W = 1000; const H = 150; const left = 150; const right = 230; const top = 18; const bottom = 24;
  const x = d3.scaleLinear().domain([x0, x1]).range([left, W - right]);
  const all = series.flatMap((o) => o.pts.map((p) => p.h));
  const y = d3.scaleLinear().domain([Math.floor(Math.min(...all) * 2) / 2 - 0.25, Math.ceil(Math.max(...all) * 2) / 2 + 0.25]).range([H - bottom, top]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
    .attr('aria-label', series.map((o) => `${PLATFORM_LABEL[o.m.platform] || o.m.platform} median daytime overpass ${fmtHour(o.pts[0].h)} in ${o.pts[0].year}, ${fmtHour(o.pts[o.pts.length - 1].h)} in ${o.pts[o.pts.length - 1].year}`).join('; '));
  svg.append('text').attr('class', 'tl-label').attr('x', 0).attr('y', top + 4).text('Overpass time');
  svg.append('text').attr('class', 'tl-sub').attr('x', 0).attr('y', top + 18).text('daytime, median');
  const ax = svg.append('g').attr('class', 'tl-axis').attr('transform', `translate(${left},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((v) => fmtHour(v)).tickSizeOuter(0));
  ax.select('.domain').remove();
  svg.append('g').attr('class', 'tl-axis').attr('transform', `translate(0,${H - bottom})`).call(d3.axisBottom(x).ticks(Math.min(14, x1 - x0)).tickFormat(d3.format('d')).tickSizeOuter(0)).select('.domain').remove();
  for (const o of series) {
    const col = COLOR[o.m.platform] || '#8E9A9A';
    const pts = o.pts.map((p) => [x(p.year + 0.5), y(p.h)]);
    svg.append('path').attr('d', d3.line()(pts)).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 1.6);
    for (const [cx, cy] of pts) svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 2).attr('fill', col);
    const f = o.pts[0]; const l = o.pts[o.pts.length - 1];
    svg.append('text').attr('class', 'tl-sub').attr('x', x(l.year + 0.5) + 6).attr('y', y(l.h) + 3)
      .text(`${PLATFORM_LABEL[o.m.platform] || o.m.platform}: ${fmtHour(f.h)} (${f.year}) → ${fmtHour(l.h)} (${l.year})`);
  }
  const wrap = h('div', { class: 'lst-panel', style: 'overflow-x:auto;margin-top:8px' }, h('div', { style: 'min-width:640px' }, svg.node()),
    h('p', { class: 'caption', text: `Median local solar time of daytime detections each year${scopeName ? ` in ${scopeName}` : ''}, measured from the FIRMS records (acquisition time + longitude/15). A proxy for orbit drift, not orbit telemetry.` }));
  const rows = series.flatMap((o) => o.pts.map((p) => h('tr', {}, h('td', { text: PLATFORM_LABEL[o.m.platform] || o.m.platform }), h('td', { class: 'num', text: String(p.year) }), h('td', { class: 'num', text: fmtHour(p.h) }), h('td', { class: 'num', text: p.n != null ? String(p.n) : '—' }))));
  return h('div', {}, wrap, h('details', { class: 'caption' }, h('summary', { text: 'Overpass times as a table' }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, h('thead', {}, h('tr', {}, ...['Platform', 'Year', 'Median local solar time', 'Detections'].map((t) => h('th', { scope: 'col', text: t })))), h('tbody', {}, ...rows)))));
}
