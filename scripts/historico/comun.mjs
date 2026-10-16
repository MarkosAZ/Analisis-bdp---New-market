// Utilidades de la descarga de datos históricos (corre en GitHub Actions).
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../data/historico');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET con reintentos (429, 5xx, tiempo agotado); 404 → null.
export async function get(url, { as = 'json', headers = {}, tries = 4 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json,text/csv,text/plain,*/*', ...headers }, signal: AbortSignal.timeout(45000) });
      if (r.status === 404) return null;
      if (r.ok) {
        const t = await r.text();
        return as === 'json' ? JSON.parse(t) : t;
      }
      last = new Error(`HTTP ${r.status} ${url}`);
      if (r.status < 429 && r.status !== 408) throw last;
    } catch (e) {
      last = e;
      if (/HTTP 4\d\d/.test(e.message) && !/HTTP 429|HTTP 408/.test(e.message)) throw e;
    }
    await sleep(1500 * 2 ** i);
  }
  throw last;
}

// Tareas en paralelo con un tope.
export async function pool(items, fn, n = 6) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch {
    return null;
  }
}

export function writeJson(rel, value) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return fs.statSync(file).size;
}

export const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
export const DAY = 86400000;
export const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
