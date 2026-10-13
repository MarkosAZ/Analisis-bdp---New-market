// Sondeo temporal (10): básquet en Apuesta Total. Qué ligas y partidos hay en los
// próximos días (¿ya aparece la temporada regular de la NBA?), qué tipos de mercado
// trae la página de partido (primer tiempo, cuartos, jugadores) y cuáles se leen hoy.
import { getEventList, getMarkets } from '../extension/sources/apuestatotal.js';
import { offersFromApuestaTotal } from '../docs/js/analysis/markets.js';
import { marketsOf } from '../docs/js/analysis/picks.js';
import { readFileSync } from 'node:fs';

const BASE = 'https://prod20392.kmianko.com';
const PAGE = `${BASE}/es-pe/spbkv3?operatorToken=logout`;
const src = readFileSync(new URL('../extension/sources/apuestatotal.js', import.meta.url), 'utf8');
const have = new Set(src.match(/basketball: '([A-Z0-9 ]+)'/)[1].split(' '));
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
const { items } = await getEventList({ sport: 'basketball', from: now, to: now + 10 * 86400000 });
const leagues = new Map();
for (const e of items) {
  const k = `${e.country} · ${e.league}`;
  const l = leagues.get(k) || { n: 0, first: e.start, top: e.topLeague, order: e.leagueOrder, sample: `${e.home} vs ${e.away}` };
  l.n++;
  l.first = Math.min(l.first, e.start);
  leagues.set(k, l);
}
console.log(`Partidos de básquet en 10 días: ${items.length}`);
for (const [k, l] of [...leagues].sort((a, b) => b[1].top - a[1].top || a[1].order - b[1].order))
  console.log(`  ${k} | ${l.n} partidos | primero ${new Date(l.first).toISOString()} | top=${l.top} | ${l.sample}`);

// Un partido de cada liga importante: NBA (pretemporada y regular si existe), Euroliga, ACB, etc.
const picked = [];
const seenLeague = new Set();
for (const e of items.filter((x) => !x.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder || a.start - b.start)) {
  const k = `${e.country}|${e.league}`;
  if (seenLeague.has(k)) continue;
  seenLeague.add(k);
  picked.push(e);
  if (picked.length >= 7) break;
}
const nbaRegular = items.find((e) => /NBA/i.test(e.league) && !/pre/i.test(e.league));
if (nbaRegular && !picked.includes(nbaRegular)) picked.push(nbaRegular);

const allTypes = new Map();
for (const ev of picked) {
  const r = await fetch(`${BASE}/api/eventpage/events/${ev.eventId}?hideX25X75Selections=true`, { headers: await session(), signal: AbortSignal.timeout(40000) });
  const text = await r.text();
  const tuples = new Map();
  for (const m of text.matchAll(/\["((?:ML|OU|HC|QA|CS|LN)\d+)","([^"]*)",[^,\]]*,\d+,"([^"]*)"/g)) if (!tuples.has(m[1])) tuples.set(m[1], `${m[2]} | ${m[3]}`);
  console.log(`\n==== ${ev.country} · ${ev.league} | ${ev.home} vs ${ev.away} | ${new Date(ev.start).toISOString()} | HTTP ${r.status} ${text.length} car. | tipos: ${tuples.size}`);
  for (const [t, n] of [...tuples].sort()) {
    console.log(`  ${have.has(t) ? '   ' : 'NEW'} ${t} | ${n}`);
    const a = allTypes.get(t) || { name: n, events: 0 };
    a.events++;
    allTypes.set(t, a);
  }
  // Nombres de mercados con jugadores o mitades/cuartos (por si el formato de tupla no coincide).
  const extra = new Set();
  for (const m of text.matchAll(/"([^"]{0,60}(?:[Mm]itad|[Cc]uarto|[Jj]ugador|[Pp]untos|[Rr]ebotes|[Aa]sistencias|[Tt]riples)[^"]{0,60})"/g)) extra.add(m[1]);
  console.log(`  nombres con mitad/cuarto/jugador/puntos (${extra.size}): ${[...extra].slice(0, 60).join(' ;; ')}`);
  // Lo que se lee hoy con los tipos actuales.
  const { items: mk } = await getMarkets({ eventIds: [ev.eventId], sport: 'basketball' });
  const markets = mk[ev.eventId] || [];
  const offers = offersFromApuestaTotal(markets, ev, { ...ev, sport: 'basketball' });
  const list = marketsOf('basketball');
  const by = {};
  for (const o of offers) if (list.has(o.market)) (by[o.market] ||= new Set()).add(o.line);
  console.log(`  hoy (tipos actuales): ${markets.length} mercados | ${Object.entries(by).map(([k, v]) => `${k}: ${[...v].filter((x) => x != null).sort((a, b) => a - b).join(',')}`).join(' | ')}`);
  for (const m of markets) if (/mitad|cuarto|jugador|puntos de|rebote|asistencia|triple/i.test(m.name)) console.log(`    ${m.type} | ${m.name} | ${m.selections.slice(0, 4).map((s) => `${s.name}@${s.price}`).join(', ')}`);
}
console.log('\n==== Tipos vistos (NEW = no se piden hoy)');
for (const [t, a] of [...allTypes].sort()) console.log(`${have.has(t) ? '   ' : 'NEW'} ${t} | ${a.events} partidos | ${a.name}`);
