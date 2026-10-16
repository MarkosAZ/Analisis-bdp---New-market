// MLB histórica (statsapi): partidos con abridores probables y clima, y el registro
// de aperturas de cada abridor (temporada regular y playoffs). data/historico/mlb.
import { get, log, pool, readJson, writeJson } from './comun.mjs';
import { startsFromGameLog } from '../../extension/sources/mlb.js';

const API = 'https://statsapi.mlb.com/api/v1';
const TYPES = ['R', 'F', 'D', 'L', 'W'];

async function schedule(season) {
  const games = [];
  for (const type of TYPES) {
    const r = await get(`${API}/schedule?sportId=1&season=${season}&gameType=${type}&hydrate=probablePitcher,team,weather,venue`).catch(() => null);
    games.push(...(r?.dates || []).flatMap((d) => d.games || []));
  }
  return games
    .filter((g) => g.status?.abstractGameState === 'Final' && g.teams?.home?.score != null && !/postponed|cancel/i.test(g.status?.detailedState || ''))
    .map((g) => ({
      pk: g.gamePk,
      t: Math.round(Date.parse(g.gameDate) / 1000),
      d: g.officialDate,
      ty: g.gameType,
      h: [g.teams.home.team.id, g.teams.home.team.name],
      a: [g.teams.away.team.id, g.teams.away.team.name],
      g: [g.teams.home.score, g.teams.away.score],
      pp: [g.teams.home.probablePitcher?.id || null, g.teams.away.probablePitcher?.id || null],
      pn: [g.teams.home.probablePitcher?.fullName || null, g.teams.away.probablePitcher?.fullName || null],
      w: g.weather?.temp || g.weather?.wind ? { condition: g.weather.condition || null, temp: Number(g.weather.temp) || null, wind: g.weather.wind || null } : null,
      v: g.venue?.name || null,
    }));
}

export async function mlb({ now = Date.now() } = {}) {
  const thisYear = new Date(now).getUTCFullYear();
  // Desde 2010 hasta la temporada en curso.
  const seasons = Array.from({ length: thisYear - 2009 }, (_, i) => 2010 + i);
  for (const season of seasons) {
    const rel = `mlb/partidos/${season}.json`;
    const old = readJson(rel);
    if (old?.complete) continue;
    const games = await schedule(season);
    // Las cuotas ya guardadas (cuotas-flashscore.mjs) se conservan.
    const prev = new Map((old?.games || []).map((g) => [g.pk, g]));
    for (const g of games) for (const k of ['k', 'kf']) if (prev.get(g.pk)?.[k] != null) g[k] = prev.get(g.pk)[k];
    writeJson(rel, { season, complete: season < thisYear || new Date(now).getUTCMonth() >= 11, games: games.sort((a, b) => a.t - b.t) });
    log(`MLB ${season}: ${games.length} partidos`);
  }
  // Registro de aperturas de los abridores de cada temporada (y de la siguiente).
  for (const season of seasons) {
    const rel = `mlb/lanzadores/${season}.json`;
    const old = readJson(rel);
    if (old?.complete) continue;
    const ids = new Set();
    for (const y of [season, season + 1]) for (const g of readJson(`mlb/partidos/${y}.json`)?.games || []) for (const id of g.pp) if (id) ids.add(id);
    const logs = {};
    await pool(
      [...ids],
      async (id) => {
        const starts = [];
        for (const type of ['R', 'P']) {
          const r = await get(`${API}/people/${id}/stats?stats=gameLog&group=pitching&season=${season}&gameType=${type}`).catch(() => null);
          starts.push(...startsFromGameLog(r));
        }
        if (starts.length) logs[id] = starts.sort((a, b) => b.start - a.start).map((s) => [Math.round(s.start / 1000), Math.round(s.ip * 1000) / 1000, s.r, s.er, s.h, s.bb, s.k, s.hr, s.hbp]);
      },
      8,
    );
    writeJson(rel, { season, complete: season < thisYear - 1, fields: ['start', 'ip', 'r', 'er', 'h', 'bb', 'k', 'hr', 'hbp'], logs });
    log(`MLB lanzadores ${season}: ${Object.keys(logs).length} con aperturas de ${ids.size}`);
  }
}
