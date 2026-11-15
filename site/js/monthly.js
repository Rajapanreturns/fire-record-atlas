// The calendar-month climatology layer (belt_monthly.json, contract 1.3.0) read against belt.json's cells.
// Pure: no DOM, no d3. Display density = counts / n_years / land_km2 x 1000 (per month; "All year" = per year).
// Check order per cell-month: zero ("no detections reported") first, then sparse, then the colour class.
// Cells absent from belt.cells are ocean or have too little land: they are not zero.
import { classOf, quantile } from './core.js';

/** Quintile breaks of positive values, rounded to 2 significant figures and strictly increasing. */
export function sigBreaks(values) {
  const s = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const r2 = (x) => { const k = 10 ** (Math.floor(Math.log10(x)) - 1); return Math.round(x / k) * k; };
  const t = [0.2, 0.4, 0.6, 0.8].map((p) => r2(quantile(s, p)));
  for (let i = 1; i < t.length; i += 1) if (t[i] <= t[i - 1]) t[i] = r2(t[i - 1] * 1.5);
  return t.map((x) => Number(x.toPrecision(2)));
}

/** Atlas `cal` URL parameter: 1..12 = that calendar month, 0 = all year. Anything else is all year. */
export function parseCal(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 0;
}
export const calParam = (m) => (m >= 1 && m <= 12 ? String(m) : null);

/**
 * Pair belt_monthly with belt. Returns null (fall back to belt.json) when the monthly layer is missing or not aligned.
 * The result is the single object the map and the custom-area card read.
 */
export function joinLayers(belt, bm) {
  if (!belt || !Array.isArray(belt.cells)) return null;
  const cols = belt.cell_columns || [];
  const iLat = cols.indexOf('lat_bin'); const iLon = cols.indexOf('lon_bin'); const iLand = cols.indexOf('land_km2');
  const lat = new Int16Array(belt.cells.length); const lon = new Int16Array(belt.cells.length); const land = new Float64Array(belt.cells.length);
  const index = new Map();
  belt.cells.forEach((c, i) => { lat[i] = c[iLat]; lon[i] = c[iLon]; land[i] = iLand >= 0 ? c[iLand] : NaN; index.set(`${c[iLat]}|${c[iLon]}`, i); });
  const ok = !!(bm && Array.isArray(bm.counts) && bm.counts.length === belt.cells.length && (!bm.aligned_to || bm.aligned_to.n_cells === belt.cells.length) && iLand >= 0);
  return {
    monthly: ok, belt, bm: ok ? bm : null, n: belt.cells.length, lat, lon, land, index,
    nYears: ok ? bm.period.n_years : (belt.period && belt.period.n_years) || null,
    res: (belt.grid && belt.grid.resolution_deg) || 1,
    daynight: ok ? bm.daynight : belt.daynight,
    period: ok ? bm.period : belt.period,
    sparseRule: ok ? bm.sparse_rule : null,
  };
}

/** Density of cell i at month m (1..12) or all year (0). Monthly units: per month; all year: per year. */
export function density(L, i, m) {
  if (!L.monthly) { const iV = L.belt.cell_columns.indexOf('value'); return m === 0 ? L.belt.cells[i][iV] : null; }
  const c = L.bm.counts[i];
  const total = m === 0 ? c.reduce((a, b) => a + b, 0) : c[m - 1];
  return total / L.nYears / L.land[i] * 1000;
}
export const countOf = (L, i, m) => (L.monthly ? (m === 0 ? L.bm.counts[i].reduce((a, b) => a + b, 0) : L.bm.counts[i][m - 1]) : null);
export const isSparse = (L, i, m) => !!(L.monthly && L.bm.sparse && ((L.bm.sparse[i] >> (m === 0 ? (L.sparseRule.all_year_bit ?? 12) : m - 1)) & 1) === 1);
/** Years (of n) with any detection in that calendar month; null when the file has no years_seen. "All year" is not derivable. */
export function seenIn(L, i, m) {
  if (!L.monthly || !L.bm.years_seen || m === 0) return null;
  const k = parseInt(L.bm.years_seen[i][m - 1], 36);
  return Number.isFinite(k) ? k : null;
}

/** 'zero' | 'sparse' | 'value': the state a cell-month is drawn in, in the agreed order. */
export function cellState(L, i, m) {
  const v = density(L, i, m);
  if (v == null) return 'none';
  if (v === 0) return 'zero';
  if (isSparse(L, i, m)) return 'sparse';
  return 'value';
}

/**
 * Colour thresholds. Months share one scale (so scrubbing compares like with like); "All year" has its own, because
 * its unit is per year, not per month. Fixed thresholds are computed once from all positive values.
 */
export function layerThresholds(L) {
  const all = []; const months = [];
  for (let i = 0; i < L.n; i += 1) {
    all.push(density(L, i, 0));
    if (L.monthly) for (let m = 1; m <= 12; m += 1) months.push(density(L, i, m));
  }
  return { all: sigBreaks(all), month: L.monthly ? sigBreaks(months) : null };
}
/** Class index per cell for one position: -1 absent, 0 zero, 1..5 ramp. Sparse flag in a parallel array. */
export function classify(L, m, th) {
  const cls = new Int8Array(L.n); const sp = new Uint8Array(L.n);
  const t = m === 0 ? th.all : th.month;
  for (let i = 0; i < L.n; i += 1) {
    const v = density(L, i, m);
    const k = classOf(v, t);
    cls[i] = k == null ? -1 : k;
    sp[i] = k > 0 && isSparse(L, i, m) ? 1 : 0;
  }
  return { cls, sp };
}

/** Global daytime detections per calendar month (all latitude bands), for the month strip's sparkline. */
export function monthTotals(L) {
  if (!L.monthly || !L.bm.bands) return null;
  const t = Array(12).fill(0);
  for (const r of L.bm.bands.rows) (r.counts || []).forEach((c, k) => { t[k] += c; });
  return t;
}
/** Latitude bands in the panel's shape: share of each band's (daytime) detections by month. */
export function bandRows(L) {
  if (L.monthly && L.bm.bands) {
    return L.bm.bands.rows.map((r) => ({ lat_min: r.lat_min, lat_max: r.lat_max, n_total: r.n_total, monthly_share: r.n_total ? r.counts.map((c) => c / r.n_total) : null }));
  }
  return (L.belt.bands && L.belt.bands.rows) || [];
}

/** The 1-degree cell that contains a point (south-west anchored bins). */
export const cellOf = (lat, lon, res = 1) => ({ lat: Math.floor(lat / res) * res, lon: Math.floor(((lon + 180) % 360 + 360) % 360 / res) * res - 180 });

/**
 * Season for a custom area: the cell containing (lat, lon), or a size x size box of cells centred on it.
 * Sums counts and land over cells present; density = sum counts / n_years / sum land x 1000.
 * A box-month is sparse when its summed total is < sparse_rule.min_total (and not zero). For one cell the file's own
 * sparse bits and years_seen are used; for a box, years seen is reported as "at least k" (the largest single cell).
 */
export function areaSeason(L, lat, lon, size = 1) {
  if (!L || !L.monthly) return null;
  const c = cellOf(lat, lon, L.res);
  const half = Math.floor(size / 2);
  const cells = [];
  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      const la = c.lat + dy * L.res;
      let lo = c.lon + dx * L.res; if (lo < -180) lo += 360; if (lo >= 180) lo -= 360;
      const i = L.index.get(`${la}|${lo}`);
      if (i != null) cells.push(i);
    }
  }
  const out = { cell: c, size, nCells: cells.length, nPossible: size * size, land: 0, months: [], allYear: null };
  if (!cells.length) return out;
  for (const i of cells) out.land += L.land[i];
  const minTotal = (L.sparseRule && L.sparseRule.min_total) || 10;
  for (let m = 1; m <= 12; m += 1) {
    let n = 0; let seenMax = null; let seenSum = null;
    for (const i of cells) { n += L.bm.counts[i][m - 1]; const s = seenIn(L, i, m); if (s != null) { seenMax = Math.max(seenMax ?? 0, s); seenSum = (seenSum ?? 0) + s; } }
    const single = cells.length === 1 && size === 1;
    // a box: sparse when its total is small OR its cells' years-seen add up to <= max_years_seen (an upper bound on the
    // box's own years), so a box whose detections all came in one or two years cannot look well supported
    const maxSeen = (L.sparseRule && L.sparseRule.max_years_seen) ?? 2;
    const sparse = n > 0 && (single ? isSparse(L, cells[0], m) : (n < minTotal || (seenSum != null && seenSum <= maxSeen)));
    out.months.push({ m, count: n, density: n / L.nYears / out.land * 1000, zero: n === 0, sparse, seen: seenMax, seenExact: single });
  }
  const tot = out.months.reduce((a, x) => a + x.count, 0);
  out.allYear = { count: tot, density: tot / L.nYears / out.land * 1000, zero: tot === 0 };
  return out;
}

/** Nearest study region to a point: inside its box, or the closest box centre within maxDeg (great-circle-ish degrees). */
export function nearestRegion(regions, lat, lon, maxDeg = 15) {
  let best = null;
  for (const r of regions || []) {
    const [w, s, e, n] = r.bbox || [];
    if (lat >= s && lat <= n && lon >= w && lon <= e) return { region: r, inside: true, deg: 0 };
    const cy = (s + n) / 2; const cx = (w + e) / 2;
    const dx = (((lon - cx + 540) % 360) - 180) * Math.cos((lat + cy) / 2 * Math.PI / 180);
    const d = Math.hypot(lat - cy, dx);
    if (d <= maxDeg && (!best || d < best.deg)) best = { region: r, inside: false, deg: d };
  }
  return best;
}
