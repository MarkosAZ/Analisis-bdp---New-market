// Sondeo temporal (2): ¿por dónde llegan los "Disparos a puerta" de Apuesta Total?
// 1) Campos del evento en el snapshot. 2) Direcciones de la API en el código de la
// web. 3) Otras direcciones posibles para un partido. 4) Otras familias de tipos.
import { getEventList } from '../extension/sources/apuestatotal.js';

const BASE = 'https://prod20392.kmianko.com';
const PAGE = `${BASE}/es-pe/spbkv3?operatorToken=logout`;
let headers = null;
async function session() {
  if (headers) return headers;
  const r = await fetch(PAGE, { signal: AbortSignal.timeout(25000) });
  const jar = {};
  for (const c of r.headers.getSetCookie()) {
    const pair = c.split(';')[0];
    jar[pair.slice(0, pair.indexOf('='))] = pair.slice(pair.indexOf('=') + 1);
  }
  headers = { 'time-area': '01', ...(jar.authorization ? { authorization: jar.authorization, session: jar.session } : {}) };
  return headers;
}
async function get(url, json = true) {
  try {
    const r = await fetch(url.startsWith('http') ? url : BASE + url, { headers: await session(), signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    return { status: r.status, text, data: json ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null };
  } catch (e) {
    return { status: 0, text: String(e.message), data: null };
  }
}

const now = Date.now();
const { items } = await getEventList({ sport: 'football', from: now, to: now + 48 * 3600000 });
const ev = items.filter((e) => !e.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder || a.start - b.start)[0];
console.log('Partido:', ev.eventId, ev.league, ev.home, 'vs', ev.away);

// 1) El evento completo en el snapshot.
const snap = await get('/api/pulse/snapshot/events?lang=ES-PE&t=hPNl');
const raw = (snap.data || []).find((e) => String(e._id) === ev.eventId);
console.log('\n== 1) evento en el snapshot ==\n', JSON.stringify(raw).slice(0, 3000));

// 2) Código de la web: direcciones /api/... y prefijos de tipos de mercado.
const page = await get(PAGE, false);
const scripts = [...page.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], PAGE).href);
console.log('\n== 2) scripts de la página ==', scripts.length, scripts.slice(0, 15).join(' '));
const apis = new Set();
const prefixes = new Set();
const disparo = [];
for (const src of scripts.slice(0, 25)) {
  const js = await get(src, false);
  for (const m of js.text.matchAll(/["'`](\/api\/[a-zA-Z0-9_\-/{}$.:?=&]+)["'`]/g)) apis.add(m[1]);
  for (const m of js.text.matchAll(/["'`]([A-Z]{2})(\d{1,4})["'`]/g)) prefixes.add(m[1]);
  for (const m of js.text.matchAll(/.{0,120}(?:isparo|hots|Shot).{0,120}/g)) if (disparo.length < 30) disparo.push(m[0]);
}
console.log('apis:', [...apis].sort().join('\n  '));
console.log('prefijos tipo XX123 en el código:', [...prefixes].sort().join(' '));
console.log('textos con disparo/shot:', disparo.join('\n  '));

// 3) Otras direcciones posibles para todos los mercados de un partido.
const id = ev.eventId;
for (const path of [
  `/api/eventlist/eu/markets/all?markets=${id}`,
  `/api/eventlist/eu/markets/all?markets=${id}:`,
  `/api/eventlist/eu/markets/all?eventId=${id}`,
  `/api/eventlist/eu/event/${id}`,
  `/api/eventlist/eu/events/${id}`,
  `/api/eventlist/eu/events/${id}/markets`,
  `/api/eventpage/eu/${id}`,
  `/api/eventpage/eu/event/${id}`,
  `/api/event/eu/${id}`,
  `/api/pulse/snapshot/event/${id}`,
  `/api/pulse/event/${id}`,
  `/api/eventlist/eu/markets/event/${id}`,
  `/api/eventlist/eu/markets/${id}`,
  ...[...apis].filter((a) => /market|event/i.test(a) && !/\$\{|\{/.test(a)).slice(0, 15).map((a) => `${a}${a.includes('?') ? '&' : '?'}eventId=${id}`),
]) {
  const r = await get(path);
  const names = Array.isArray(r.data) ? r.data.map((m) => m.Name || m.MarketType?.Name).filter(Boolean) : [];
  console.log(`${r.status} ${path} | ${r.text.length} car. | mercados: ${names.length} | disparos: ${(r.text.match(/isparo/g) || []).length} | ${names.filter((n) => /isparo|emate|tiro/i.test(n)).slice(0, 6).join(' / ')}`);
}

// 4) Otras familias de tipos (del 0 al 999) con los prefijos vistos en el código.
const tried = new Set(['ML', 'OU', 'HC', 'QA']);
const fam = [...prefixes].filter((p) => !tried.has(p)).slice(0, 30);
console.log('\n== 4) familias probadas:', fam.join(' '));
const found = new Map();
for (const p of fam) {
  const types = Array.from({ length: 1000 }, (_, i) => `${p}${i}`);
  for (let j = 0; j < types.length; j += 60) {
    const r = await get(`/api/eventlist/eu/markets/all?markets=${encodeURIComponent(`${id}:${types.slice(j, j + 60).join('|')}`)}`);
    for (const m of Array.isArray(r.data) ? r.data : []) found.set(m.MarketType?._id, m.Name || m.MarketType?.Name);
  }
}
for (const [t, n] of [...found].sort()) console.log(`  ${t} | ${n}`);
