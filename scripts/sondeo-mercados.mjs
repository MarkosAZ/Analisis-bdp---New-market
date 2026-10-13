// Sondeo temporal (11): cómo vienen los mercados de jugador (QA4400...) y las líneas
// alternativas del primer tiempo (OU2125/HC2125) de básquet en Apuesta Total, y cómo
// los lee hoy el catálogo.
import { getEventList } from '../extension/sources/apuestatotal.js';
import { offersFromApuestaTotal } from '../docs/js/analysis/markets.js';
import { parseMarket } from '../docs/js/analysis/catalog.js';

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
const TYPES = 'OU623 HC623 OU2125 HC2125 OU660 HC660 QA4400 QA4402 QA4403 QA4872 QA5543 QA4407 QA4408 QA4410 QA4975'.split(' ');
const now = Date.now();
const { items } = await getEventList({ sport: 'basketball', from: now, to: now + 10 * 86400000 });
const want = [/^NBA$/, /Pretemporada NBA/, /Euroleague/, /WNBA/, /ACB/];
const picked = [];
for (const re of want) {
  const list = items.filter((e) => !e.live && re.test(e.league)).sort((a, b) => a.start - b.start);
  picked.push(...list.slice(0, re.source === '^NBA$' ? 3 : 1));
}
for (const ev of picked) {
  const query = encodeURIComponent(`${ev.eventId}:${TYPES.join('|')}`);
  const r = await fetch(`${BASE}/api/eventlist/eu/markets/all?markets=${query}`, { headers: await session(), signal: AbortSignal.timeout(40000) });
  const data = await r.json().catch(() => null);
  const markets = Array.isArray(data) ? data : [];
  console.log(`\n==== ${ev.league} | ${ev.home} vs ${ev.away} | ${new Date(ev.start).toISOString()} | HTTP ${r.status} | ${markets.length} mercados`);
  const shown = new Map();
  for (const m of markets) {
    const t = m.MarketType?._id;
    const n = (shown.get(t) || 0) + 1;
    shown.set(t, n);
    const sels = (m.Selections || []).filter((s) => !s.IsDisabled && !s.IsRemoved);
    const simple = {
      name: m.Name || m.MarketType?.Name || '',
      type: t,
      selections: sels.map((s) => ({
        name: s.BetslipLine || s.Name || '',
        line: s.QAParam1 != null && s.QAParam1 !== '' && Number.isFinite(Number(s.QAParam1)) ? Number(s.QAParam1) : null,
        price: Number(s.DisplayOdds?.Decimal ?? s.TrueOdds),
      })).filter((s) => s.price > 1),
    };
    let parsed;
    try {
      const p = parseMarket(simple.name, simple.selections, { sport: 'basketball', home: ev.home, away: ev.away });
      parsed = p.unsupported ? `NO(${p.unsupported})` : p.outcomes.map((o) => `${o.market}|${o.sel}|${o.line}`).join(' ');
    } catch (e) {
      parsed = `ERROR ${e.message}`;
    }
    if (n <= 3) {
      console.log(`  ${t} | ${simple.name} | ${sels.length} sel | lee: ${parsed}`);
      for (const s of sels.slice(0, 4)) console.log(`      sel: ${JSON.stringify({ Name: s.Name, BetslipLine: s.BetslipLine, QAParam1: s.QAParam1, QAParam2: s.QAParam2, Side: s.Side, OutcomeType: s.OutcomeType, Odds: s.DisplayOdds?.Decimal, Group: s.Group, Points: s.Points, Player: s.PlayerName ?? s.Player ?? s.ParticipantName })}`);
      if (n === 1 && /^QA44|QA48|QA55/.test(t)) console.log(`      claves mercado: ${Object.keys(m).join(',')} | claves sel: ${Object.keys(sels[0] || {}).join(',')}`);
    }
  }
  console.log(`  por tipo: ${[...shown].map(([t, n]) => `${t}=${n}`).join(' ')}`);
  const offers = offersFromApuestaTotal(markets.map((m) => ({
    name: m.Name || '', type: m.MarketType?._id, selections: (m.Selections || []).filter((s) => !s.IsDisabled && !s.IsRemoved).map((s) => ({ name: s.BetslipLine || s.Name || '', line: s.QAParam1 != null && s.QAParam1 !== '' && Number.isFinite(Number(s.QAParam1)) ? Number(s.QAParam1) : null, price: Number(s.DisplayOdds?.Decimal ?? s.TrueOdds) })).filter((s) => s.price > 1),
  })), ev, { ...ev, sport: 'basketball' });
  const by = {};
  for (const o of offers) (by[o.market] ||= new Set()).add(o.line);
  console.log(`  ofertas: ${Object.entries(by).map(([k, v]) => `${k}: ${[...v].slice(0, 12).join(',')}`).join(' | ')}`);
}
