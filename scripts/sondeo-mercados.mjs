// Sondeo temporal (17): béisbol. Qué ligas hay (Apuesta Total y Flashscore), qué datos
// de lanzadores da la API oficial de MLB (abridores probables, registro por partido,
// temporada, ligas de invierno) y ESPN, y el H2H de Flashscore con carreras.
import { getEventList } from '../extension/sources/apuestatotal.js';
import { getH2H, getSportDay } from '../extension/sources/flashscore.js';

const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, text };
};
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const now = Date.now();

// (a) Apuesta Total y Flashscore: ligas de béisbol.
const { items: at } = await getEventList({ sport: 'baseball', from: now, to: now + 7 * 86400000 });
const atLeagues = {};
for (const e of at) atLeagues[`${e.country} · ${e.league}`] = (atLeagues[`${e.country} · ${e.league}`] || 0) + 1;
console.log(`Apuesta Total béisbol 7 días: ${at.length} partidos | ${JSON.stringify(atLeagues)}`);
for (const day of [0, 1, 2]) {
  const { items } = await getSportDay({ sport: 'baseball', day });
  const lg = {};
  for (const e of items) lg[`${e.category.name} · ${e.tournament.name}`] = (lg[`${e.category.name} · ${e.tournament.name}`] || 0) + 1;
  console.log(`Flashscore béisbol día ${day}: ${items.length} | ${JSON.stringify(lg)}`);
  if (day === 0) {
    const mlb = items.find((e) => /MLB/.test(e.tournament.name)) || items[0];
    if (mlb) {
      const d = await getH2H({ fsId: mlb.id.replace(/^fs:/, ''), homeId: mlb.home.id, awayId: mlb.away.id }).catch((e) => ({ error: e.message }));
      console.log(`  H2H ${mlb.home.name} vs ${mlb.away.name} [${mlb.tournament.name}]: ${JSON.stringify(d.h2h)} | local ${d.lastHome?.length} | visita ${d.lastAway?.length}`);
      for (const m of (d.lastHome || []).slice(0, 12)) console.log(`     ${ymd(m.start)} ${m.league} ${m.home ? 'L' : 'V'} vs ${m.opp} ${m.gf}-${m.ga}`);
    }
  }
}

// (b) API oficial de MLB.
const API = 'https://statsapi.mlb.com/api/v1';
for (const sportId of [1, 17]) {
  const s = await get(`${API}/schedule?sportId=${sportId}&startDate=${ymd(now - 86400000)}&endDate=${ymd(now + 4 * 86400000)}&hydrate=probablePitcher,team,venue,linescore,weather,seriesStatus`);
  const games = (s.data?.dates || []).flatMap((d) => d.games || []);
  const leagues = {};
  for (const g of games) {
    const k = g.teams?.home?.team?.league?.name || g.teams?.home?.team?.sport?.name || g.gameType;
    leagues[k] = (leagues[k] || 0) + 1;
  }
  console.log(`\n==== statsapi sportId=${sportId}: HTTP ${s.status}, ${games.length} partidos | ligas ${JSON.stringify(leagues)}`);
  for (const g of games.slice(0, 8)) {
    const side = (t) => `${t.team?.name} (${t.probablePitcher ? `${t.probablePitcher.fullName} #${t.probablePitcher.id}` : 'sin abridor'})`;
    console.log(`  ${g.gameDate} ${g.gameType} ${g.status?.detailedState} | ${side(g.teams.away)} @ ${side(g.teams.home)} | estadio ${g.venue?.name} | clima ${JSON.stringify(g.weather || null)} | serie ${g.seriesStatus?.description || ''}`);
  }
  const withP = games.find((g) => g.teams.home.probablePitcher || g.teams.away.probablePitcher);
  if (!withP) continue;
  const p = withP.teams.home.probablePitcher || withP.teams.away.probablePitcher;
  const season = new Date(withP.gameDate).getUTCFullYear();
  for (const stats of ['gameLog', 'season']) {
    const r = await get(`${API}/people/${p.id}/stats?stats=${stats}&group=pitching&season=${season}`);
    const splits = r.data?.stats?.[0]?.splits || [];
    console.log(`  ${p.fullName} ${stats} ${season}: HTTP ${r.status}, ${splits.length} filas | claves stat: ${Object.keys(splits[0]?.stat || {}).join(',')}`);
    for (const x of splits.slice(-3)) console.log(`     ${x.date || ''} ${x.opponent?.name || ''} ${x.isHome ? 'L' : 'V'} | IP ${x.stat?.inningsPitched} R ${x.stat?.runs} ER ${x.stat?.earnedRuns} H ${x.stat?.hits} BB ${x.stat?.baseOnBalls} K ${x.stat?.strikeOuts} HR ${x.stat?.homeRuns} NP ${x.stat?.numberOfPitches} ERA ${x.stat?.era} WHIP ${x.stat?.whip} GS ${x.stat?.gamesStarted}`);
  }
  // Postemporada y temporada anterior (para el comienzo de temporada).
  const r2 = await get(`${API}/people/${p.id}/stats?stats=gameLog&group=pitching&season=${season}&gameType=P`);
  console.log(`  ${p.fullName} gameLog postemporada: ${(r2.data?.stats?.[0]?.splits || []).length} filas`);
  // Partidos de un equipo en la temporada (factor de estadio con sus marcadores).
  const team = withP.teams.home.team;
  const ts = await get(`${API}/schedule?sportId=${sportId}&teamId=${team.id}&season=${season}&gameType=R`);
  const tg = (ts.data?.dates || []).flatMap((d) => d.games || []).filter((g) => g.status?.abstractGameState === 'Final');
  console.log(`  ${team.name} temporada ${season}: ${tg.length} partidos terminados | ejemplo ${JSON.stringify(tg[0]?.teams?.home?.score)}-${JSON.stringify(tg[0]?.teams?.away?.score)} en ${tg[0]?.venue?.name}`);
  // Bullpen: box score del último partido (lanzadores usados y entradas).
  const last = tg.at(-1);
  if (last) {
    const b = await get(`${API}/game/${last.gamePk}/boxscore`);
    const side = b.data?.teams?.home?.team?.id === team.id ? 'home' : 'away';
    const pitchers = b.data?.teams?.[side]?.pitchers || [];
    const players = b.data?.teams?.[side]?.players || {};
    console.log(`  boxscore ${last.gamePk}: HTTP ${b.status} | lanzadores ${pitchers.length}: ${pitchers.map((id) => `${players['ID' + id]?.person?.fullName} ${players['ID' + id]?.stats?.pitching?.inningsPitched}IP ${players['ID' + id]?.stats?.pitching?.numberOfPitches}NP`).join('; ')}`);
  }
}

// (c) ESPN MLB: abridores probables en el marcador.
const espn = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${ymd(now).replace(/-/g, '')}`);
for (const e of (espn.data?.events || []).slice(0, 3)) {
  const c = e.competitions?.[0];
  console.log(`\nESPN ${e.name} | probables: ${(c?.competitors || []).map((t) => `${t.team?.abbreviation}: ${(t.probables || []).map((p) => `${p.athlete?.displayName} ${(p.statistics || []).map((s) => `${s.abbreviation}=${s.displayValue}`).join(' ')}`).join(', ')}`).join(' | ')}`);
}
