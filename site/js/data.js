// Loading with honest failure states. Nothing here invents a value.
import { checkEnvelope, safeRelPath, isFixtureDoc } from './core.js';

const cache = new Map();
export const loaded = new Set(); // every successfully loaded doc, for the fixture watermark

export function dataBase() {
  const p = new URLSearchParams(location.search);
  return safeRelPath(p.get('data'), 'data');
}

async function getJson(path) {
  if (cache.has(path)) return cache.get(path);
  const pr = (async () => {
    let res;
    try { res = await fetch(path, { cache: 'no-cache' }); } catch (e) { throw new LoadError('network', path, e.message); }
    if (!res.ok) throw new LoadError(res.status === 404 ? 'missing' : 'http', path, `HTTP ${res.status}`);
    try { return await res.json(); } catch (e) { throw new LoadError('parse', path, 'not valid JSON'); }
  })();
  cache.set(path, pr);
  pr.catch(() => cache.delete(path));
  return pr;
}

export class LoadError extends Error {
  constructor(kind, path, detail) { super(`${kind}: ${path} (${detail})`); this.kind = kind; this.path = path; this.detail = detail; }
}

export async function loadDoc(rel, expectedFile) {
  const base = dataBase();
  const safe = safeRelPath(rel, null);
  if (!safe) throw new LoadError('path', rel, 'path rejected');
  const doc = await getJson(`${base}/${safe}`);
  const chk = checkEnvelope(doc, expectedFile);
  if (!chk.ok) throw new LoadError('contract', `${base}/${safe}`, chk.error);
  loaded.add(doc);
  return doc;
}

export const loadManifest = () => loadDoc('manifest.json', 'manifest');
export async function loadSensors(manifest) { return loadDoc(manifest.sensors_path || 'sensors.json', 'sensors'); }
export async function loadValidation(manifest) {
  const override = new URLSearchParams(location.search).get('validation');
  return loadDoc(safeRelPath(override, null) || manifest.validation_path || 'validation.json', 'validation');
}
export async function loadSeries(region) { return loadDoc(region.series_path || `region/${region.id}/series.json`, 'series'); }
export async function loadBelt(manifest) {
  const layer = (manifest.global_layers || []).find((l) => l.id === 'belt');
  if (!layer) return { state: 'absent' };
  if (layer.status === 'pending' || !layer.path) return { state: 'pending', layer };
  try { return { state: 'ok', layer, doc: await loadDoc(layer.path, 'belt') }; } catch (e) { return { state: 'error', layer, error: e }; }
}

let landPromise = null;
export function loadLand() {
  if (!landPromise) landPromise = fetch('vendor/land-110m.json').then((r) => { if (!r.ok) throw new Error('land'); return r.json(); });
  return landPromise;
}

export const anyFixture = () => [...loaded].some(isFixtureDoc);
export const fixtureWatermark = () => ([...loaded].find(isFixtureDoc) || {}).watermark || 'FIXTURE: synthetic values, not NASA data';
