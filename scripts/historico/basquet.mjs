// Básquet fuera de la NBA (Sofascore): Euroliga y Liga ACB desde 2010-11, con el
// marcador por cuarto y las estadísticas de cada jugador, en el mismo formato que la
// NBA (data/historico/nba): data/historico/basquet/<código>/<año>.json. Equipos y
// jugadores con id de Sofascore ("sf:<id>").
// Sofascore no responde desde GitHub Actions: se corre desde una sesión con internet.
// Uso: NODE_USE_ENV_PROXY=1 node scripts/historico/basquet.mjs [--solo=euroliga]
import { readJson, writeJson } from './comun.mjs';
import { FIELDS } from './nba.mjs';
import { API, get, log, pool, seasonEvents, seasonStart } from './sofa.mjs';

const DAY = 86400000;
const FIRST = 2010;
// Terminado (100) o tras prórroga (110).
const ENDED = new Set([100, 110]);
export const LIGAS = [
  { code: 'euroliga', ut: 138, name: 'Euroliga' },
  { code: 'acb', ut: 264, name: 'Liga ACB' },
];

const pair = (S, k) => (Number.isFinite(S.home[k]) && Number.isFinite(S.away[k]) ? [S.home[k], S.away[k]] : null);
const team = (t) => [`sf:${t.id}`, t.nameCode || t.shortName || '', t.name];
const n = (v) => (Number.isFinite(v) ? v : 0);

// Jugadores de un equipo en /event/{id}/lineups: [id, nombre, titular, ...FIELDS].
function playersOf(side) {
  return (side?.players || [])
    .filter((p) => p.statistics && n(p.statistics.secondsPlayed) > 0)
    .map((p) => {
      const s = p.statistics;
      const row = { min: Math.round(n(s.secondsPlayed) / 60), pts: n(s.points), reb: n(s.rebounds), ast: n(s.assists), tpm: n(s.threePointsMade), stl: n(s.steals), blk: n(s.blocks), tov: n(s.turnovers), oreb: n(s.offensiveRebounds), dreb: n(s.defensiveRebounds), ftm: n(s.freeThrowsMade), fgm: n(s.fieldGoalsMade), fga: n(s.fieldGoalAttempts), tpa: n(s.threePointAttempts), fta: n(s.freeThrowAttempts) };
      return [`sf:${p.player.id}`, p.player.name, p.substitute ? 0 : 1, ...FIELDS.map((f) => row[f])];
    });
}

async function gameOf(e) {
  const S = { home: e.homeScore || {}, away: e.awayScore || {} };
  const g = pair(S, 'display') || pair(S, 'current');
  if (!g) return null;
  // Cuartos y, si hubo, la prórroga como un periodo más (como ESPN).
  const per = [1, 2, 3, 4].map((i) => pair(S, `period${i}`));
  const q = per.every(Boolean) ? [per.map((p) => p[0]), per.map((p) => p[1])] : [[], []];
  const ot = pair(S, 'overtime');
  if (q[0].length && ot && ot[0] + ot[1] > 0) q.forEach((list, i) => list.push(ot[i]));
  const lu = await get(`${API}/event/${e.id}/lineups`);
  return { id: `sf:${e.id}`, t: e.startTimestamp, ty: null, h: team(e.homeTeam), a: team(e.awayTeam), g, q, p: [playersOf(lu?.home), playersOf(lu?.away)] };
}

async function download(L) {
  const seasons = ((await get(`${API}/unique-tournament/${L.ut}/seasons`))?.seasons || []).filter((s) => seasonStart(s.year) >= FIRST);
  const summary = [];
  for (const s of seasons) {
    const year = seasonStart(s.year);
    const rel = `basquet/${L.code}/${year}.json`;
    const old = readJson(rel);
    if (old?.complete) continue;
    const have = new Map((old?.games || []).map((g) => [g.id, g]));
    const events = (await seasonEvents(L.ut, s.id)).filter((e) => ENDED.has(e.status?.code) && e.homeTeam && e.awayTeam && !have.has(`sf:${e.id}`));
    for (const g of (await pool(events, (e) => gameOf(e).catch(() => null), 8)).filter(Boolean)) have.set(g.id, g);
    if (!have.size) continue;
    const next = await get(`${API}/unique-tournament/${L.ut}/season/${s.id}/events/next/0`);
    const games = [...have.values()].sort((a, b) => a.t - b.t);
    const complete = !next?.events?.length && Date.now() - games.at(-1).t * 1000 > 3 * DAY;
    const bytes = writeJson(rel, { source: 'sofascore', code: L.code, ut: L.ut, name: L.name, year, season: s.year, complete, fields: FIELDS, games });
    summary.push(`${s.year}: ${games.length} (${games.filter((g) => g.p[0].length && g.p[1].length).length} con jugadores, ${Math.round(bytes / 1024)} kB)`);
  }
  log(`${L.name}: ${summary.join(' · ') || 'sin temporadas nuevas'}`);
}

const only = process.argv.find((a) => a.startsWith('--solo='))?.slice(7).split(',') || null;
for (const L of LIGAS.filter((x) => !only || only.includes(x.code))) await download(L).catch((e) => log(`${L.name}: ${e.message}`));
