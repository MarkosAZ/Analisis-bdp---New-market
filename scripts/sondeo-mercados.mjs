// Sondeo temporal (3): todos los mercados de un partido desde /api/event/eu/<id>
// (fútbol y básquet): nombres, tipos y cómo los lee la página; y del código de la
// web, los tipos con nombre de tiros / primer tiempo.
import { getEventList } from '../extension/sources/apuestatotal.js';
import { offersFromApuestaTotal } from '../docs/js/analysis/markets.js';
import { marketsOf } from '../docs/js/analysis/picks.js';

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
  const r = await fetch(url.startsWith('http') ? url : BASE + url, { headers: await session(), signal: AbortSignal.timeout(40000) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, text, data };
}

// Tipos con nombre en el código de la web.
const page = await get(PAGE);
const scripts = [...page.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], PAGE).href);
const named = new Map();
for (const src of scripts) {
  const js = await get(src);
  for (const m of js.text.matchAll(/([a-zA-Z0-9]+):`((?:ML|OU|HC|QA|CS|LN)\d+)`/g)) named.set(m[2], m[1]);
}
console.log('tipos con nombre en el código:', named.size);
for (const [t, n] of [...named].filter(([, n]) => /shot|Shot|half|Half|1st|Quarter|corner|Corner/.test(n)).sort()) console.log(`  ${t} ${n}`);

const now = Date.now();
for (const [sport, n] of [['football', 4], ['basketball', 3]]) {
  const { items } = await getEventList({ sport, from: now, to: now + 48 * 3600000 });
  const events = items.filter((e) => !e.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder || a.start - b.start).slice(0, n);
  for (const ev of events) {
    const r = await get(`/api/event/eu/${ev.eventId}`);
    const d = r.data;
    console.log(`\n==== ${sport} ${ev.eventId} ${ev.league} | ${ev.home} vs ${ev.away} | HTTP ${r.status} ${r.text.length} car.`);
    if (!d) continue;
    console.log('claves:', Object.keys(d).join(' '));
    // Busca la lista de mercados en la respuesta (la primera lista de objetos con MarketType).
    const lists = [];
    const walk = (o, path) => {
      if (Array.isArray(o)) { if (o.length && o[0] && typeof o[0] === 'object' && ('MarketType' in o[0] || 'Selections' in o[0])) lists.push([path, o]); o.slice(0, 3).forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(d, '');
    console.log('listas de mercados:', lists.map(([p, l]) => `${p} (${l.length})`).join(' · '));
    const markets = lists.length ? lists.sort((a, b) => b[1].length - a[1].length)[0][1] : [];
    const counts = { total: markets.length, lista: 0 };
    for (const raw of markets) {
      const m = {
        name: raw.Name || raw.MarketType?.Name || '',
        type: raw.MarketType?._id || '',
        selections: (raw.Selections || []).filter((s) => !s.IsDisabled && !s.IsRemoved).map((s) => ({
          name: s.BetslipLine || s.Name || '',
          line: s.QAParam1 != null && s.QAParam1 !== '' && Number.isFinite(Number(s.QAParam1)) ? Number(s.QAParam1) : null,
          price: Number(s.DisplayOdds?.Decimal ?? s.TrueOdds),
        })).filter((s) => s.price > 1),
      };
      const offers = offersFromApuestaTotal([m], ev, { sport });
      const list = [...new Set(offers.map((o) => o.market).filter((x) => marketsOf(sport).has(x)))];
      if (list.length) counts.lista++;
      const interesting = sport === 'football' ? /isparo|emate|tiro|arco|puerta|esquina|tarjeta/i : /mitad|tiempo|cuarto|h[aá]ndicap|total|jugador|puntos/i;
      if (interesting.test(m.name) || list.length) {
        const name = m.name.replace(ev.home, '[L]').replace(ev.away, '[V]');
        const sels = m.selections.slice(0, 4).map((s) => `${s.name}${s.line != null ? `(${s.line})` : ''}@${s.price}`).join(' · ');
        const read = [...new Set(offers.map((o) => `${o.market}${o.line != null ? ' ' + o.line : ''}`))].slice(0, 3).join(', ') || 'no se lee';
        console.log(`${list.length ? '★' : ' '} ${m.type}${named.has(m.type) ? `(${named.get(m.type)})` : ''} | ${name} | ${sels} → ${read}`);
      }
    }
    console.log('mercados:', JSON.stringify(counts));
  }
}
