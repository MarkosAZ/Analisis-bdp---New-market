// Dónde se guardan el historial y la red neuronal:
//  - github-web: en el repositorio, con el token pegado en ⚙ Ajustes. Funciona
//    en el celular y en la PC.
//  - github: en el repositorio, con el token guardado en la extensión.
//  - local: en este navegador (IndexedDB). Privado, pero solo en este dispositivo.
//  - lectura: el navegador no permite guardar; se leen los archivos publicados.
import * as ext from './ext.js';
import * as gh from './github.js';

let mode = 'lectura';
let info = null;

const DB = 'analisis-bdp';
const STORE = 'archivos';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(method, ...args) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, method === 'get' || method === 'getAllKeys' ? 'readonly' : 'readwrite');
    const req = tx.objectStore(STORE)[method](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbWorks() {
  try {
    await idb('getAllKeys');
    return true;
  } catch {
    return false;
  }
}

// Elige dónde guardar. Devuelve { mode, info, tokenError }.
export async function init() {
  info = null;
  let tokenError = null;
  if (gh.hasToken()) {
    info = await gh.status();
    if (info.ok) {
      mode = 'github-web';
      return { mode, info };
    }
    tokenError = info.error;
    info = null;
  }
  if (ext.available()) {
    try {
      const st = await ext.call('github', 'status', {}, { timeout: 20000 });
      if (st.configured && st.ok) {
        mode = 'github';
        info = st;
        return { mode, info, tokenError };
      }
    } catch {
      // sin GitHub en la extensión: se guarda en el navegador
    }
  }
  mode = (await idbWorks()) ? 'local' : 'lectura';
  return { mode, info, tokenError };
}

export const getMode = () => mode;
export const getInfo = () => info;
export const canWrite = () => mode !== 'lectura';
export const isGithub = () => mode.startsWith('github');

// path: ruta lógica, p. ej. "data/historial/2026-10-02.json".
export async function read(path) {
  if (mode === 'github-web') {
    const file = await gh.getFile({ path: `docs/${path}` });
    return file ? JSON.parse(file.text) : null;
  }
  if (mode === 'github') {
    const file = await ext.call('github', 'getFile', { path: `docs/${path}` }, { timeout: 60000 });
    return file ? JSON.parse(file.text) : null;
  }
  if (mode === 'local') return (await idb('get', path)) ?? null;
  try {
    const resp = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

// Lo publicado en la página (GitHub Pages), sin pasar por GitHub ni el navegador:
// p. ej. las redes que entrena GitHub Actions.
export async function readPublished(path) {
  try {
    const resp = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

export async function write(path, value, message) {
  if (mode === 'github-web') return gh.putFile({ path: `docs/${path}`, text: JSON.stringify(value), message });
  if (mode === 'github') return ext.call('github', 'putFile', { path: `docs/${path}`, text: JSON.stringify(value), message }, { timeout: 60000 });
  if (mode === 'local') return idb('put', value, path);
  throw new Error('Este navegador no permite guardar datos');
}

const isConflict = (e) => Boolean(e?.conflict) || /^Conflicto/.test(String(e?.message || ''));

// Lee, cambia y guarda un archivo sin pisar lo que otro dispositivo (o pestaña) guardó
// en el medio: `change(actual)` recibe lo guardado (o null) y devuelve el nuevo valor
// (undefined: nada que guardar). En GitHub solo se guarda si el archivo sigue siendo
// el leído; si cambió, se vuelve a leer y se aplica el cambio otra vez (por eso
// `change` no debe depender de lo que haya visto en un intento anterior). Devuelve lo
// que quedó guardado (o lo leído, si no hubo cambio).
export async function update(path, change, message) {
  if (mode === 'local') {
    const current = (await idb('get', path)) ?? null;
    const next = await change(current);
    if (next === undefined) return current;
    await idb('put', next, path);
    return next;
  }
  if (!isGithub()) throw new Error('Este navegador no permite guardar datos');
  const full = `docs/${path}`;
  const getFile = (fresh) => (mode === 'github-web' ? gh.getFile({ path: full, fresh }) : ext.call('github', 'getFile', { path: full, fresh }, { timeout: 60000 }));
  const putFile = (text, sha) => (mode === 'github-web' ? gh.putFile({ path: full, text, message, sha }) : ext.call('github', 'putFile', { path: full, text, message, sha }, { timeout: 60000 }));
  let last = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    // Entre intentos se espera (1, 2, 4, 8, 8 s): justo después de un commit GitHub puede devolver la versión anterior.
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(attempt - 1, 3)));
    const file = await getFile(attempt > 0);
    const current = file ? JSON.parse(file.text) : null;
    const next = await change(current);
    if (next === undefined) return current;
    try {
      await putFile(JSON.stringify(next), file?.sha ?? null);
      return next;
    } catch (e) {
      if (!isConflict(e)) throw e;
      last = e;
    }
  }
  throw new Error(`No se pudo guardar ${path}: otro dispositivo lo cambió varias veces seguidas (${last?.message || ''})`);
}

// Rutas guardadas en este navegador (para subirlas a GitHub).
export async function localPaths() {
  try {
    return await idb('getAllKeys');
  } catch {
    return [];
  }
}

export const readLocal = (path) => idb('get', path);
