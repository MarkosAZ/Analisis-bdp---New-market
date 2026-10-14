// Sondeo temporal (14): de punta a punta con datos reales. Jugadores que ofrece
// Apuesta Total en partidos de la temporada regular de la NBA → sus últimos partidos
// en ESPN (con el registro de cada jugador si le faltan) → probabilidad.
import { getEventList, getMarkets } from '../extension/sources/apuestatotal.js';
import { getPlayerLogs } from '../extension/sources/espn.js';
import { offersFromApuestaTotal } from '../docs/js/analysis/markets.js';
import { parseMarketId } from '../docs/js/analysis/catalog.js';
import { matchPlayer, playerProbability } from '../docs/js/analysis/players.js';
import { isPlayerMarket } from '../docs/js/analysis/picks.js';

const now = Date.now();
const { items } = await getEventList({ sport: 'basketball', from: now, to: now + 10 * 86400000 });
const nba = items.filter((e) => e.league === 'NBA').sort((a, b) => a.start - b.start).slice(0, 6);
const { items: markets } = await getMarkets({ eventIds: nba.map((e) => e.eventId), sport: 'basketball' });
for (const ev of nba) {
  const offers = offersFromApuestaTotal(markets[ev.eventId] || [], ev, { ...ev, sport: 'basketball' });
  const players = offers.filter((o) => isPlayerMarket(o.market));
  const names = [...new Set(players.map((o) => parseMarketId(o.market).n))];
  console.log(`\n==== ${ev.home} vs ${ev.away} | ${new Date(ev.start).toISOString()} | ${players.length} cuotas de jugador | ${names.join(', ')}`);
  if (!names.length) continue;
  const t0 = Date.now();
  let logs;
  try {
    logs = await getPlayerLogs({ league: 'nba', home: ev.home, away: ev.away, start: ev.start, n: 10, names });
  } catch (e) {
    console.log(`  ESPN: ${e.message}`);
    continue;
  }
  console.log(`  ESPN en ${((Date.now() - t0) / 1000).toFixed(1)} s | local ${logs.home.team} ${logs.home.teamGames} partidos, visita ${logs.away.team} ${logs.away.teamGames}`);
  const roster = [...logs.home.players, ...logs.away.players];
  for (const name of names) {
    const p = matchPlayer(name, roster);
    if (!p) {
      console.log(`  ${name}: NO está en los datos`);
      continue;
    }
    const dates = p.games.map((g) => new Date(g.start).toISOString().slice(0, 10));
    const line = players.find((o) => parseMarketId(o.market).n === name && o.market.startsWith('OU.pl_pts#'));
    const r = line ? playerProbability(p.games, 'pl_pts', 'over', line.line) : null;
    console.log(`  ${name} → ${p.name}: ${p.games.length} partidos (${dates[0]} … ${dates.at(-1)}) | pts ${p.games.map((g) => g.pts).join(',')}${r ? ` | Más de ${line.line} puntos p=${r.p.toFixed(2)} (media ${r.mean.toFixed(1)})` : ''}`);
  }
}
