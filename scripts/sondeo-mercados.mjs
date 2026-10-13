// Sondeo temporal (6): cómo arma la web de Apuesta Total los pedidos de la página de
// un partido (/api/eventpage, /api/master, /api/sportscenter) y si alguno trae el
// catálogo de tipos de mercado o los mercados de "Disparos a puerta".
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
async function get(url) {
  try {
    const r = await fetch(url.startsWith('http') ? url : BASE + url, { headers: await session(), signal: AbortSignal.timeout(40000) });
    return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() };
  } catch (e) {
    return { status: 0, type: '', text: String(e.message) };
  }
}

const page = await get(PAGE);
const scripts = [...page.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], PAGE).href);
let code = '';
for (const src of scripts) code += (await get(src)).text + '\n';
console.log('código:', code.length, 'car.');
for (const key of ['/api/eventpage', '/api/master', '/api/sportscenter', '/api/eventlist/eu', 'markets/all', 'MarketGroups', 'marketGroups', 'TotalMarketsCount', 'isparo']) {
  const hits = [...code.matchAll(new RegExp(key.replace(/[/]/g, '\\/'), 'g'))].slice(0, 6);
  console.log(`\n== ${key}: ${hits.length} apariciones`);
  for (const h of hits) console.log('   …', code.slice(Math.max(0, h.index - 220), h.index + 260).replace(/\s+/g, ' '));
}

const now = Date.now();
const { items } = await getEventList({ sport: 'football', from: now, to: now + 48 * 3600000 });
const ev = items.filter((e) => !e.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder)[0];
const id = ev.eventId;
console.log(`\nPartido ${id} ${ev.home} vs ${ev.away}`);
for (const path of [
  `/api/eventpage/eu/markets?eventId=${id}`, `/api/eventpage/eu/${id}/markets`, `/api/eventpage/eu/event?eventId=${id}`, `/api/eventpage/eu/events/${id}`,
  `/api/eventpage/eu/markets/all?eventId=${id}`, `/api/eventpage/eu/markets/all?markets=${id}`, `/api/eventpage/eu/markettypes?eventId=${id}`,
  `/api/master/eu/markettypes`, `/api/master/markettypes`, `/api/master/eu/marketgroups`, `/api/master/marketgroups`, `/api/master/eu/sports`, `/api/master/sports`,
  `/api/sportscenter/eu/markets?eventId=${id}`, `/api/sportscenter/eu/event/${id}`,
]) {
  const r = await get(path);
  const json = /json/.test(r.type);
  console.log(`${r.status} ${json ? 'JSON' : r.type.slice(0, 12)} ${r.text.length} car. ${path}${json ? ' | ' + r.text.slice(0, 220).replace(/\s+/g, ' ') : ''}${/isparo/.test(r.text) && json ? ' | ¡DISPAROS!' : ''}`);
}
