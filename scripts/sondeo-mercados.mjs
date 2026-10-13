// Sondeo temporal (5): tipos ML/OU/HC/QA del 7000 al 19999 en partidos de fútbol
// (los del 0 al 6999 ya se probaron): nombres y cómo los lee la página.
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

const TYPES = ['OU', 'QA', 'HC', 'ML'].flatMap((p) => Array.from({ length: 13000 }, (_, i) => `${p}${i + 7000}`));
const now = Date.now();
for (const [sport, n] of [['football', 8]]) {
  const { items } = await getEventList({ sport, from: now, to: now + 48 * 3600000 });
  const events = items.filter((e) => !e.live).sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder || a.start - b.start).slice(0, n);
  console.log(`\n==================== ${sport}: ${events.map((e) => `${e.home} vs ${e.away}`).join(' | ')}`);
  const ids = events.map((e) => e.eventId);
  const byType = new Map();
  for (let j = 0; j < TYPES.length; j += 60) {
    for (const raw of await markets(ids, TYPES.slice(j, j + 60))) {
      if (raw.IsRemoved) continue;
      const m = toMarket(raw);
      const ev = events.find((x) => x.eventId === String(raw.EventId));
      if (!ev) continue;
      const offers = offersFromApuestaTotal([m], ev, { sport });
      const list = [...new Set(offers.map((o) => o.market).filter((x) => marketsOf(sport).has(x)))];
      const t = byType.get(m.type) || { names: new Set(), list: new Set(), events: new Set(), sample: '' };
      t.names.add(m.name.replace(ev.home, '[L]').replace(ev.away, '[V]'));
      list.forEach((x) => t.list.add(x));
      t.events.add(ev.eventId);
      if (!t.sample) t.sample = `${m.selections.slice(0, 4).map((s) => `${s.name}${s.line != null ? `(${s.line})` : ''}@${s.price}`).join(' · ')} → ${[...new Set(offers.map((o) => `${o.market}${o.line != null ? ' ' + o.line : ''}`))].slice(0, 3).join(', ') || 'no se lee'}`;
      byType.set(m.type, t);
    }
  }
  for (const [type, t] of [...byType].sort()) console.log(`${t.list.size ? '★' : ' '} ${type} | ${t.events.size} partidos | ${[...t.names].slice(0, 2).join(' / ')} | ${t.sample}`);
}
