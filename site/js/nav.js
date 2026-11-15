// M4.4 navigation state (pure; tested in tests/site/m44tm.test.mjs). Two month vocabularies, never mixed (ARCH-REVIEW R2):
//   atlas  : cal=1..12   a typical calendar month (no year)
//   region : month=YYYY-MM a specific month (cal= is accepted once and converted by a stated rule, then dropped)
//   trust  : month=YYYY-MM honoured only when it is one of the region's stored test months (R5)
import { latestComparableYear, monthIndex, yearOf, MONTH_ABBR } from './core.js';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Query keys that carry app state between views; data/validation/mode are carried by urlFor's KEEP. */
export const NAV_KEYS = ['view', 'region', 'month', 'cal', 'year', 'ruler', 'machine', 'stage', 'step', 'pick', 'at', 'science', 'walk', 'tm', 'rev', 'all', 'detail', 'compare'];

/** "YYYY-MM" -> MM as a number (1..12); anything else -> 0. */
export const monthToCal = (month) => (typeof month === 'string' && MONTH_RE.test(month) ? monthIndex(month) + 1 : 0);

/**
 * cal (1..12) -> a month of the region's record, by the region page's own default-year rule (latest comparable year,
 * i.e. before Aqua's drift). If that year lacks the month, the latest year that has it. Returns { month, rule } or null.
 */
export function calToMonth(cal, months, eras) {
  if (!(cal >= 1 && cal <= 12) || !months || !months.length) return null;
  const mm = String(cal).padStart(2, '0');
  const has = new Set(months.map((r) => r.month));
  const y = latestComparableYear(months, eras);
  if (y != null && has.has(`${y}-${mm}`)) return { month: `${y}-${mm}`, rule: 'comparable' };
  const any = months.filter((r) => r.month.slice(5) === mm).map((r) => r.month).sort();
  return any.length ? { month: any[any.length - 1], rule: 'latest' } : null;
}

/** Month state to carry from the current page to a target view (masthead links, map <-> region <-> Trust). */
export function carryMonth(from, toView) {
  if (!from) return {};
  const cal = from.view === 'atlas' ? (from.cal >= 1 && from.cal <= 12 ? from.cal : 0) : monthToCal(from.month);
  if (toView === 'atlas') return cal ? { cal: String(cal) } : {};
  if (toView === 'region') return from.view === 'atlas' ? (cal ? { cal: String(cal) } : {}) : (MONTH_RE.test(from.month || '') ? { month: from.month } : {});
  if (toView === 'trust') return from.view !== 'atlas' && MONTH_RE.test(from.month || '') ? { month: from.month } : {};
  return {};
}

/** The in-app params of a link's href (R1: a plain click must reach the same place as cmd-click). */
export function navParamsFromHref(href, base) {
  let u; try { u = new URL(href || '', base); } catch (e) { return null; }
  const out = {};
  for (const k of NAV_KEYS) { const v = u.searchParams.get(k); if (v != null && v !== '') out[k] = v; }
  return out;
}

/** Short month label from a YYYY-MM string, or the raw text when malformed (for fallback lines). */
export const monthWords = (m) => (MONTH_RE.test(m || '') ? `${MONTH_ABBR[monthIndex(m)]} ${yearOf(m)}` : String(m || ''));

/** R4/R5 fallback lines: one quiet sentence, only when a fallback happened. */
export const fallbackLine = {
  region: (asked, shown) => `No ${monthWords(asked)} in this record; showing ${monthWords(shown)}.`,
  calLatest: (shown) => `${monthWords(shown)}: the latest year with this month.`,
  trust: (asked, shown) => `${monthWords(asked)} isn’t a test month here; showing ${monthWords(shown)} (stated rule).`,
};

/** Test months of an NOAA-20 area that the Time Machine and Trust may open (stored Aqua value present). */
export const m2TestRows = (m2val, id) => ((m2val && m2val.month_rows) || []).filter((r) => r.region_id === id && r.actual != null);

/**
 * "Try another test month": the area's pre-locked opening month first (chosen before results), then every other test
 * month in time order; outcomes unfiltered. The first month not yet seen in this visit; once all are seen, the one after
 * `current`, wrapping. rows: the area's test rows; seen: Set of months already shown.
 */
export function nextTestRow(rows, featured, current, seen = new Set()) {
  const sorted = [...rows].sort((a, b) => (a.month < b.month ? -1 : 1));
  const feat = sorted.find((r) => r.month === featured);
  const order = feat ? [feat, ...sorted.filter((r) => r !== feat)] : sorted;
  if (!order.length) return null;
  const fresh = order.find((r) => !seen.has(r.month) && r.month !== (current && current.month));
  if (fresh) return fresh;
  const i = order.findIndex((r) => r.month === (current && current.month));
  return order[(i + 1) % order.length];
}

/** Time Machine stage written to the URL: 1 or 2 only (R6: a shared link never lands revealed). */
export const urlStage = (s) => (Number(s) >= 2 ? '2' : '1');
export const parseStage = (s) => (Number(s) >= 2 ? 2 : 1); // a hand-typed stage=3 opens stage 2: the reveal needs a click

/**
 * Is a region month worth carrying to Trust? Only a plausible stored test month (Trust checks again, exactly):
 * NOAA-20 areas: inside the validated window with Aqua observed; S-NPP regions: a held-out year with Aqua observed.
 */
export function isTestMonthCandidate(region, row) {
  if (!region || !row || !MONTH_RE.test(row.month || '')) return false;
  const aqua = row.native && row.native.aqua && row.native.aqua.status === 'observed';
  if (!aqua) return false;
  const w = region.m2 && region.m2.validated_window;
  if (w) return row.month >= w.start && row.month <= w.end;
  return (region.held_out_years || []).includes(yearOf(row.month));
}

