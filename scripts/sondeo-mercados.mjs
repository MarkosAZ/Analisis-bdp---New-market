// Sondeo temporal: pide a Apuesta Total TODOS los tipos ML/OU/HC/QA del 0 al 999
// para partidos de hoy y mañana (fútbol, básquet, béisbol) y muestra qué tipos
// traen mercados de la lista, cuáles faltan en TYPES_BY_SPORT y los nombres de
// los mercados de tiros, córners, tarjetas y primer tiempo con cómo los lee la página.
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
async function markets(ids, types) {
  const q = encodeURIComponent(`${ids.join('|')}:${types.join('|')}`);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/api/eventlist/eu/markets/all?markets=${q}`, { headers: await session(), signal: AbortSignal.timeout(30000) });
      if (r.status === 403) { headers = null; continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    } catch (e) {
      if (i === 2) { console.log('error', e.message); return []; }
    }
  }
  return [];
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

const ALL = ['ML', 'OU', 'HC', 'QA'].flatMap((p) => Array.from({ length: 1000 }, (_, i) => `${p}${i}`));
const now = Date.now();
const INTEREST = /tiro|remate|disparo|arco|puerta|corner|córner|esquina|tarjeta|mitad|tiempo|parte|cuarto|handicap|hándicap|total/i;
for (const [sport, n] of [['football', 10], ['basketball', 6], ['baseball', 3]]) {
  const { items } = await getEventList({ sport, from: now, to: now + 48 * 3600000 });
  const events = items.filter((e) => !e.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder || a.start - b.start).slice(0, n);
  console.log(`\n==================== ${sport}: ${items.length} eventos; se sondean ${events.length}`);
  for (const e of events) console.log(`  ${e.eventId} ${e.country} · ${e.league} | ${e.home} vs ${e.away}`);
  const ids = events.map((e) => e.eventId);
  const byType = new Map(); // tipo -> { names: Set, list: Set(mercados de la lista), events: Set }
  const samples = [];
  for (let j = 0; j < ALL.length; j += 60) {
    const data = await markets(ids, ALL.slice(j, j + 60));
    for (const raw of data) {
      if (raw.IsRemoved) continue;
      const m = toMarket(raw);
      const ev = events.find((x) => x.eventId === String(raw.EventId));
      if (!ev) continue;
      const offers = offersFromApuestaTotal([m], ev, { sport, home: { name: ev.home }, away: { name: ev.away } });
      const list = [...new Set(offers.map((o) => o.market).filter((x) => marketsOf(sport).has(x)))];
      const t = byType.get(m.type) || { names: new Set(), list: new Set(), events: new Set() };
      t.names.add(m.name.replace(ev.home, '[L]').replace(ev.away, '[V]'));
      list.forEach((x) => t.list.add(x));
      t.events.add(ev.eventId);
      byType.set(m.type, t);
      if (INTEREST.test(m.name) && samples.length < 400) samples.push(`${m.type} | ${m.name.replace(ev.home, '[L]').replace(ev.away, '[V]')} | ${m.selections.slice(0, 4).map((s) => `${s.name}${s.line != null ? `(${s.line})` : ''}@${s.price}`).join(' · ')} → ${[...new Set(offers.map((o) => `${o.market}${o.line != null ? ' ' + o.line : ''}`))].slice(0, 4).join(', ') || 'no se lee'}`);
    }
  }
  const have = current[sport] || new Set();
  console.log(`\n-- tipos que traen mercados de la lista (${sport}) --`);
  for (const [type, t] of [...byType].sort()) if (t.list.size) console.log(`${have.has(type) ? '   ' : 'NUEVO'} ${type} → ${[...t.list].join(', ')} | ${t.events.size} partidos | ${[...t.names].slice(0, 3).join(' / ')}`);
  console.log(`\n-- tipos que existen pero no dan mercados de la lista (${sport}) --`);
  for (const [type, t] of [...byType].sort()) if (!t.list.size) console.log(`${have.has(type) ? '   ' : 'nuevo'} ${type} | ${t.events.size} partidos | ${[...t.names].slice(0, 2).join(' / ')}`);
  console.log(`\n-- nombres de interés (${sport}) --`);
  for (const s of [...new Set(samples)].slice(0, 250)) console.log(s);
}
