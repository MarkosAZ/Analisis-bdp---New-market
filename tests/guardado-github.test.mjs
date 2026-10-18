// Guardar en GitHub sin pisar lo que otro dispositivo guardó en el medio, y solo
// dentro de docs/data/ (sin "..").
import assert from 'node:assert/strict';
import test from 'node:test';

const REPO = 'MarkosAZ/Analisis-bdp---New-market';
const files = new Map(); // ruta -> { text, sha }
let seq = 0;
const puts = [];

// localStorage con el token (como el que se pega en Ajustes) y la API de contenidos en memoria.
const kv = new Map([['bdp:github', JSON.stringify({ token: 't', repo: REPO, branch: 'main' })]]);
globalThis.localStorage = { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => kv.set(k, String(v)), removeItem: (k) => kv.delete(k) };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (u.pathname === `/repos/${REPO}`) return json(200, { permissions: { push: true } });
  const m = u.pathname.match(/\/contents\/(.+)$/);
  if (!m) return json(404, {});
  const path = decodeURIComponent(m[1]);
  if (opts.method === 'PUT') {
    const body = JSON.parse(opts.body);
    puts.push({ path, sha: body.sha ?? null });
    const current = files.get(path);
    // Como GitHub: con el sha de otra versión, 409; sin sha y el archivo existe, 422.
    if (current ? body.sha !== current.sha : body.sha) return json(current && body.sha ? 409 : 422, { message: 'sha does not match' });
    files.set(path, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `s${++seq}` });
    return json(200, {});
  }
  const f = files.get(path);
  return f ? json(200, { content: Buffer.from(f.text).toString('base64'), encoding: 'base64', sha: f.sha }) : json(404, {});
};

const gh = await import('../docs/js/github.js');
const store = await import('../docs/js/storage.js');
await store.init();
const put = (path, value) => files.set(`docs/${path}`, { text: JSON.stringify(value), sha: `s${++seq}` });
const get = (path) => JSON.parse(files.get(`docs/${path}`).text);

test('guardar: si otro dispositivo guardó en el medio, se vuelve a leer y se aplica el cambio encima', async () => {
  assert.equal(store.getMode(), 'github-web');
  const path = 'data/historial/2026-10-17.json';
  put(path, { analyses: ['pc'] });
  let calls = 0;
  const saved = await store.update(
    path,
    (day) => {
      calls++;
      // Mientras tanto, el celular guarda otro análisis en el mismo día.
      if (calls === 1) put(path, { analyses: ['pc', 'celular'] });
      return { analyses: [...day.analyses, 'nuevo'] };
    },
    'prueba',
  );
  assert.equal(calls, 2, 'el primer intento choca (409) y se repite sobre lo nuevo');
  assert.deepEqual(get(path), { analyses: ['pc', 'celular', 'nuevo'] });
  assert.deepEqual(saved, { analyses: ['pc', 'celular', 'nuevo'] });
});

test('guardar: archivo nuevo, sin cambios y otros errores', async () => {
  const path = 'data/historial/2026-10-18.json';
  assert.deepEqual(await store.update(path, (day) => ({ ...(day || {}), date: '2026-10-18' }), 'prueba'), { date: '2026-10-18' });
  assert.deepEqual(get(path), { date: '2026-10-18' });
  // Sin nada que cambiar no se escribe.
  const before = puts.length;
  assert.deepEqual(await store.update(path, () => undefined, 'prueba'), { date: '2026-10-18' });
  assert.equal(puts.length, before);
  // Un error del cambio (p. ej. archivo leído a medias) corta sin escribir.
  await assert.rejects(store.update(path, () => {
    throw new Error('No se pudo leer bien');
  }), /No se pudo leer bien/);
  assert.equal(puts.length, before);
});

test('guardar: con el sha leído, un archivo que cambió da conflicto (no se pisa)', async () => {
  const path = 'docs/data/historial/2026-10-19.json';
  files.set(path, { text: '{}', sha: 'viejo' });
  files.set(path, { text: '{"otro":1}', sha: 'nuevo' });
  await assert.rejects(gh.putFile({ path, text: '{}', message: 'x', sha: 'viejo' }), (e) => e.conflict === true);
  assert.deepEqual(JSON.parse(files.get(path).text), { otro: 1 });
});

test('guardar: solo dentro de docs/data/ (sin "." ni "..")', async () => {
  for (const path of ['docs/data/../../.github/workflows/x.json', 'docs/data/./x.json', 'docs/data//x.json', 'docs/js/x.json', 'docs/data/x.js']) {
    await assert.rejects(gh.putFile({ path, text: '{}', message: 'x' }), /Ruta no permitida/, path);
    await assert.rejects(gh.getFile({ path }), /Ruta no permitida/, path);
  }
  await gh.putFile({ path: 'docs/data/modelo/x.json', text: '{"ok":true}', message: 'x' });
  assert.deepEqual(JSON.parse((await gh.getFile({ path: 'docs/data/modelo/x.json' })).text), { ok: true });
});
