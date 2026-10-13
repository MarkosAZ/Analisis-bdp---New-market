// Sondeo temporal (8): todos los mercados de un partido como los pide la página de
// partido de Apuesta Total (/api/eventpage/events/<id>), cómo los lee la página y
// qué tipos traen mercados de la lista que hoy no se piden.
import { getEventList } from '../extension/sources/apuestatotal.js';
import { offersFromApuestaTotal } from '../docs/js/analysis/markets.js';
import { marketsOf } from '../docs/js/analysis/picks.js';
import { readFileSync } from 'node:fs';

const BASE = 'https://prod20392.kmianko.com';
const PAGE = `${BASE}/es-pe/spbkv3?operatorToken=logout`;
const src = readFileSync(new URL('../extension/sources/apuestatotal.js', import.meta.url), 'utf8');
const current = Object.fromEntries([...src.matchAll(/^\s+'?([a-z-]+)'?: '([A-Z0-9 ]+)',$/gm)].map((m) => [m[1], new Set(m[2].split(' '))]));
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
async function get(path) {
  const r = await fetch(BASE + path, { headers: await session(), signal: AbortSignal.timeout(40000) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, text, data };
}
const toMarket = (m) => ({
  name: m.Name || m.MarketType?.Name || '',
  type: m.MarketType?._id || '',
  selections: (m.Selections || []).filter((s) => !s.IsDisabled && !s.IsRemoved).map((s) => ({
    name: s.BetslipLine || s.Name || '',
    line: s.QAParam1 != null && s.QAParam1 !== '' && Number.isFinite(Number(s.QAParam1)) ? Number(s.QAParam1) : null,
    price: Number(s.DisplayOdds?.Decimal ?? s.TrueOdds),
  })).filter((s) => s.price > 1),
});

const now = Date.now();
for (const [sport, n] of [['football', 6], ['basketball', 4], ['baseball', 2]]) {
  const { items } = await getEventList({ sport, from: now, to: now + 48 * 3600000 });
  const events = items.filter((e) => !e.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder || a.start - b.start).slice(0, n);
  const have = current[sport] || new Set();
  const byType = new Map();
  for (const ev of events) {
    const r = await get(`/api/eventpage/events/${ev.eventId}?hideX25X75Selections=false`);
    const event = Array.isArray(r.data?.data) ? r.data.data[0] : r.data?.data || r.data;
    const markets = event?.Markets || event?.markets || [];
    console.log(`\n==== ${sport} ${ev.league} | ${ev.home} vs ${ev.away} | HTTP ${r.status} ${r.text.length} car. | claves: ${Object.keys(event || {}).slice(0, 12).join(' ')} | mercados: ${markets.length}`);
    for (const raw of markets) {
      const m = toMarket(raw);
      const offers = offersFromApuestaTotal([m], ev, { sport });
      const list = [...new Set(offers.map((o) => o.market).filter((x) => marketsOf(sport).has(x)))];
      const t = byType.get(m.type) || { names: new Set(), list: new Set(), events: 0, sample: '' };
      t.names.add(m.name.replace(ev.home, '[L]').replace(ev.away, '[V]'));
      list.forEach((x) => t.list.add(x));
      t.events++;
      if (!t.sample) t.sample = `${m.selections.slice(0, 4).map((s) => `${s.name}${s.line != null ? `(${s.line})` : ''}@${s.price}`).join(' · ')} → ${[...new Set(offers.map((o) => `${o.market}${o.line != null ? ' ' + o.line : ''}`))].slice(0, 3).join(', ') || 'no se lee'}`;
      byType.set(m.type, t);
    }
  }
  console.log(`\n-- ${sport}: tipos con mercados de la lista (NUEVO = hoy no se pide) --`);
  for (const [type, t] of [...byType].sort()) if (t.list.size) console.log(`${have.has(type) ? '   ' : 'NUEVO'} ${type} → ${[...t.list].join(', ')} | ${t.events} | ${[...t.names].slice(0, 2).join(' / ')} | ${t.sample}`);
  const interest = sport === 'football' ? /isparo|emate|tiro|arco|puerta|esquina|corner|tarjeta|h[aá]ndicap/i : /mitad|tiempo|h[aá]ndicap|total|puntos|jugador|carreras/i;
  console.log(`\n-- ${sport}: otros de interés --`);
  for (const [type, t] of [...byType].sort()) if (!t.list.size && [...t.names].some((x) => interest.test(x))) console.log(`${have.has(type) ? '   ' : 'nuevo'} ${type} | ${t.events} | ${[...t.names].slice(0, 2).join(' / ')} | ${t.sample}`);
}
