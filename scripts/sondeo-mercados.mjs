// Sondeo temporal (9): en la respuesta de la página de partido de Apuesta Total,
// dónde aparecen los "disparos" (y otros mercados de la lista) y su tipo de mercado.
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
const now = Date.now();
const { items } = await getEventList({ sport: 'football', from: now, to: now + 48 * 3600000 });
const events = items.filter((e) => !e.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder).slice(0, 3);
for (const ev of events) {
  const r = await fetch(`${BASE}/api/eventpage/events/${ev.eventId}?hideX25X75Selections=true`, { headers: await session(), signal: AbortSignal.timeout(40000) });
  const text = await r.text();
  console.log(`\n==== ${ev.home} vs ${ev.away} | ${text.length} car. | inicio: ${text.slice(0, 400).replace(/\s+/g, ' ')}`);
  // Tipos de mercado (XX123) que aparecen y, para cada nombre con disparo/remate/tiros, el tipo más cercano antes.
  const types = new Set([...text.matchAll(/"((?:ML|OU|HC|QA|CS|LN)\d+)"/g)].map((m) => m[1]));
  console.log(`tipos distintos en la respuesta: ${types.size}`);
  const seen = new Set();
  for (const m of text.matchAll(/"([^"]{0,80}(?:isparo|emate|[Tt]iros a|[Tt]iros al)[^"]{0,60})"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const before = text.slice(Math.max(0, m.index - 600), m.index);
    const near = [...before.matchAll(/"((?:ML|OU|HC|QA)\d+)"/g)].map((x) => x[1]).pop();
    console.log(`  ${near || '?'} | ${m[1]} | …${text.slice(m.index, m.index + 260).replace(/\s+/g, ' ')}`);
    if (seen.size > 40) break;
  }
}
