// M4.1 shared visualization system: tokens and small helpers used by every chart (docs/m41/VIZ-SYSTEM.md).
// Luminance carries magnitude (dark grey -> white); line weight, fill and geometry carry the kind of value.
// Two accents only, each with a meaning: --viz-est (converted VIIRS estimate, always hollow or dashed) and
// --viz-warn (caution / status). Nothing here invents a value: helpers classify and draw what they are given.

/** Token values, mirrored in site.css (:root --viz-*). Kept here for canvas/SVG drawing and for the tests. */
export const VIZ = {
  paper: '#090C0E', plate: '#101518',
  hi: '#F4F6F2', // selected / measured value: the brightest mark on the page
  silver: '#C3CBC9', // secondary data lines, reference value marks
  grey: '#8E9A9A', // reference-year points (each a real baseline-year value), ticks
  dim: '#5E6A6B', // hollow zero rings, faint structure that must still be seen (>= 3:1 on plate)
  grid: '#262F32', // hairline grid; never the only carrier of meaning
  est: '#E9B46A', // converted VIIRS estimate (always hollow / dashed)
  warn: '#F4A56A', // caution, provisional, unconfirmed
};

/** Magnitude ramp for class 1..5 (class 0 = observed zero is drawn hollow, not filled). Monotonic in luminance. */
export const LUM_RAMP = ['#5A6668', '#788485', '#949E9D', '#C2C9C6', '#F0F2EE'];

/**
 * How a single value must be drawn. Missing, zero and small-nonzero are always distinguishable:
 *   'missing' -> hatched slot, never drawn as zero
 *   'zero'    -> hollow ring on the baseline ("none reported")
 *   'small'   -> filled mark plus a fine tick lifted off the baseline, so it reads as "more than zero" without exaggeration
 *   'value'   -> filled mark at its true position
 * smallBelow: the value under which the mark would sit within ~2 px of the baseline (see smallThreshold).
 */
export function markState(value, smallBelow = 0) {
  if (value == null || !Number.isFinite(value)) return 'missing';
  if (value <= 0) return 'zero';
  if (value < smallBelow) return 'small';
  return 'value';
}

/** Value that maps to `minPx` pixels on a linear axis of `axisMax` drawn `plotPx` tall. */
export function smallThreshold(axisMax, plotPx = 200, minPx = 3) {
  if (!(axisMax > 0) || !(plotPx > 0)) return 0;
  return (axisMax * minPx) / plotPx;
}

/** Duration in ms, or 0 when the reader asked for reduced motion (motion is then instant, never skipped content). */
export function motionMs(ms, reduced) {
  return reduced ? 0 : ms;
}

/**
 * Split a 12-month profile into drawable segments. points: [{ value, kind }] (kind 'observed' | anything else = estimate).
 * A missing month breaks the line (no interpolation across a gap). A segment touching an estimate is dashed.
 * Returns [{ from, to, dashed }] with month indices.
 */
export function profileSegments(points) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]; const b = points[i + 1];
    if (!a || !b || a.value == null || b.value == null || !Number.isFinite(a.value) || !Number.isFinite(b.value)) continue;
    segs.push({ from: i, to: i + 1, dashed: a.kind !== 'observed' || b.kind !== 'observed' });
  }
  return segs;
}

/** WCAG relative luminance and contrast ratio for #RRGGBB colours. */
export function luminance(hex) {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---------- DOM helpers (browser only) ----------

const NS = 'http://www.w3.org/2000/svg';
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  return el;
}

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fade/grow an interval in first, so the reader sees the range before the measured value lands. Returns the delay to use for the value. */
export function intervalFirst(intervalEls, ms = 260) {
  const d = motionMs(ms, reducedMotion());
  if (!d) return 0;
  for (const el of intervalEls) if (el && el.animate) el.animate([{ opacity: 0.2, clipPath: 'inset(0 50% 0 50%)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], { duration: d, easing: 'ease-out' });
  return d;
}

// ---------- monthly runs (M4.2: no curves; every chart line is straight between month centres) ----------

/** Split 12 (or n) values into runs of consecutive finite values: [[{i, v}, ...], ...]. A gap is never bridged. */
export function finiteRuns(values) {
  const runs = []; let cur = null;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { cur = null; return; }
    if (!cur) { cur = []; runs.push(cur); }
    cur.push({ i, v });
  });
  return runs;
}
