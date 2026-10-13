// Sondeo temporal (7): rutas del servicio de la página de partido de Apuesta Total
// (cliente "us" = /api/eventpage), de dónde salen los tipos que pide para un
// partido, y la opción withSecondaryMarkets de markets/all.
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

const show = (re, n = 12, before = 160, after = 260) => {
  const hits = [...code.matchAll(re)].slice(0, n);
  console.log(`\n== ${re}: ${hits.length}`);
  for (const h of hits) console.log('   …', code.slice(Math.max(0, h.index - before), h.index + after).replace(/\s+/g, ' '));
};
show(/\bus\.(get|post)\(/g, 15, 60, 220);
show(/\bos\.(get|post)\(/g, 10, 60, 220);
show(/eventpageFetch/g, 10, 80, 260);
show(/prelive-markets/g, 4, 900, 200);
show(/withSecondaryMarkets/g, 6, 200, 200);

const now = Date.now();
const { items } = await getEventList({ sport: 'football', from: now, to: now + 48 * 3600000 });
const evs = items.filter((e) => !e.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder).slice(0, 3);
for (const ev of evs) {
  const id = ev.eventId;
  // Rutas candidatas sacadas del código (las que use el cliente "us").
  const routes = [...new Set([...code.matchAll(/\bus\.get\(`([^`$]+)`/g)].map((m) => m[1]))].slice(0, 20);
  console.log(`\nPartido ${id} ${ev.home} vs ${ev.away} | rutas: ${routes.join(', ')}`);
  for (const r of routes) {
    for (const q of [`?eventId=${id}`, `/${id}`, `?id=${id}`]) {
      const x = await get(`/api/eventpage/${r}${q}`);
      if (x.status === 200) console.log(`200 /api/eventpage/${r}${q} ${x.text.length} car. | ${x.text.slice(0, 300).replace(/\s+/g, ' ')}${/isparo/.test(x.text) ? ' | ¡DISPAROS!' : ''}`);
    }
  }
  const sec = await get(`/api/eventlist/eu/markets/all?markets=${encodeURIComponent(`${id}:OU0|OU200|OU615`)}&withSecondaryMarkets=true`);
  const names = (() => { try { return JSON.parse(sec.text).map((m) => `${m.MarketType?._id} ${m.Name}`); } catch { return []; } })();
  console.log(`withSecondaryMarkets: ${sec.status} ${names.length} mercados | ${names.filter((n) => /isparo|emate|tiro/i.test(n)).join(' / ') || names.slice(0, 8).join(' / ')}`);
}
