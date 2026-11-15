// Small DOM helpers. Text is always set with textContent; data never becomes markup.
import { VERDICT } from './core.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function glyph(name, label) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', 'glyph');
  s.setAttribute('viewBox', '0 0 12 12');
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); } else s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', `#g-${name}`);
  s.append(u);
  return s;
}

export function verdictWord(v) {
  const d = VERDICT[v] || VERDICT.unknown;
  return h('span', { class: 'verdict-word' }, glyph(d.glyph), d.word);
}

export function fmtN(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 100 || digits === 0) return Math.round(v).toLocaleString('en-US');
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export function fmtInterval(lo, hi) {
  if (lo == null || hi == null) return null;
  return `${fmtN(lo, 1)}–${fmtN(hi, 1)}`;
}

/**
 * Watermark overlay. Returns a node in both cases (an empty comment when off): DOM append()/replaceChildren()
 * stringify null into a visible "null" text node, which is how a stray "null" reached the Trust card.
 */
export function fixtureVeil(on) {
  return on ? h('div', { class: 'fixture-veil', 'aria-hidden': 'true' }, h('span', { text: 'FIXTURE' })) : document.createComment('no fixture watermark');
}

export function stamp(status) {
  const validated = status === 'validated';
  return h('span', { class: `stamp${validated ? ' stamp-validated' : ''}`, title: validated ? 'Passed the pre-registered held-out tests' : 'Method not yet validated on held-out years' }, validated ? 'Validated' : 'Provisional');
}

export function errorBox(title, err, hint) {
  return h('div', { class: 'error-state', role: 'alert' },
    h('h2', { class: 'section-title', text: title }),
    h('p', { text: err && err.detail ? `${err.path}: ${err.detail}` : String(err && err.message ? err.message : err) }),
    hint ? h('p', { class: 'caption', text: hint }) : null);
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Open an element if it is a <details>, and every <details> around it, so a jump to it lands on something visible. */
export function openTo(el) {
  for (let d = el && el.closest ? el.closest('details') : null; d; d = d.parentElement ? d.parentElement.closest('details') : null) d.open = true;
}

/** The #hash of a link's own href ('' when none); base defaults to the page URL. Pure: used by the router (B1). */
export function linkHash(href, base = (typeof location !== 'undefined' ? location.href : 'http://x/')) {
  try { const u = new URL(href || '', base); return u.hash && u.hash !== '#' ? u.hash : ''; } catch (e) { return ''; }
}
/** A query URL with an optional hash appended (navigate() carries it through pushState). */
export const withHash = (url, hash) => `${url}${hash && hash !== '#' ? hash : ''}`;

/**
 * Rewrite the masthead's [data-nav] links for the current view. Only links inside .masthead are touched: in-page links
 * such as "Every test month →" (?view=trust#decades) keep their own href and hash (B1).
 */
export function rewriteNavLinks(doc, view, targetFor, urlFor) {
  doc.querySelectorAll('.masthead [data-nav]').forEach((a) => {
    if (a.closest('.nav')) { if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    a.setAttribute('href', urlFor(targetFor(a)));
  });
}
