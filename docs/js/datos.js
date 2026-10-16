// Pestaña Datos: cálculos sobre los datos de un partido (data-format.expandMatchData),
// sin interfaz. Últimos N partidos (todos, o solo de local o de visita), el valor de
// cada estadística en cada partido y su resumen frente a una línea (promedio,
// mediana y cuántas veces quedó por encima).
import { PLAYER_STATS, statValue } from './analysis/players.js';
import { balancedLines } from './analysis/markets.js';

const sum = (v) => (Array.isArray(v) && v.every(Number.isFinite) ? v : null);
const both = (v) => (v ? v[0] + v[1] : null);

// Estadísticas de equipo de cada deporte. of(partido) → [a favor, en contra] o null.
// market: mercado de la casa con la línea del total del partido (si lo ofrece).
export const TEAM_STATS = {
  football: [
    { id: 'goals', name: 'Goles', of: (m) => sum([m.gf, m.ga]), market: 'OU', step: 1 },
    { id: 'corners', name: 'Córners', of: (m) => sum(m.stats?.corners), market: 'OU.corners', step: 1 },
    { id: 'cards', name: 'Tarjetas', of: (m) => (m.stats?.yellows ? sum([m.stats.yellows[0] + (m.stats.reds?.[0] || 0), m.stats.yellows[1] + (m.stats.reds?.[1] || 0)]) : null), market: 'OU.cards', step: 1 },
    { id: 'shots', name: 'Remates', of: (m) => sum(m.stats?.shots), market: 'OU.shots', step: 1 },
    { id: 'shots_on', name: 'Tiros al arco', of: (m) => sum(m.stats?.shots_on), market: 'OU.shots_on', step: 1 },
    { id: 'corners_h1', name: 'Córners 1.er tiempo', of: (m) => sum(m.stats?.corners_h1), market: 'OU.corners@h1', step: 1 },
    { id: 'fouls', name: 'Faltas', of: (m) => sum(m.stats?.fouls), market: null, step: 1 },
  ],
  basketball: [
    { id: 'points', name: 'Puntos', of: (m) => sum([m.gf, m.ga]), market: 'OU', step: 1 },
    { id: 'reb', name: 'Rebotes', of: (m) => sum(m.stats?.reb), market: null, step: 1 },
    { id: 'ast', name: 'Asistencias', of: (m) => sum(m.stats?.ast), market: null, step: 1 },
    { id: 'threes', name: 'Triples', of: (m) => sum(m.stats?.threes), market: null, step: 1 },
  ],
  baseball: [{ id: 'runs', name: 'Carreras', of: (m) => sum([m.gf, m.ga]), market: 'OU', step: 1 }],
};
export const statsOf = (sport) => TEAM_STATS[sport] || [{ id: 'score', name: 'Tantos', of: (m) => sum([m.gf, m.ga]), market: 'OU', step: 1 }];
export const statById = (sport, id) => statsOf(sport).find((s) => s.id === id) || statsOf(sport)[0];

// De quién: el total del partido, lo que hizo el equipo o lo que le hicieron.
export const WHO = { total: 'Del partido', for: 'A favor', against: 'En contra' };
export const valueOf = (pair, who) => (!pair ? null : who === 'for' ? pair[0] : who === 'against' ? pair[1] : both(pair));

// Últimos `n` partidos (la lista viene del más reciente al más viejo); venue: 'all',
// 'home' (solo de local) o 'away' (solo de visita).
export function pickMatches(list = [], { n = 10, venue = 'all' } = {}) {
  const ok = venue === 'home' ? (m) => m.home : venue === 'away' ? (m) => !m.home : () => true;
  return list.filter(ok).slice(0, n);
}

// Valor de la estadística en cada partido (los que no la tienen no cuentan):
// [{ value, match }], del más viejo al más reciente (como se leen las barras).
export function seriesOf(matches, stat, who = 'total') {
  return matches
    .map((match) => ({ value: valueOf(stat.of(match), who), match }))
    .filter((x) => Number.isFinite(x.value))
    .reverse();
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Resumen frente a la línea: { n, avg, median, over, under, push, pct } (pct: de los
// que no quedaron justo en la línea, cuántos quedaron por encima).
export function summarize(values, line) {
  const xs = values.filter(Number.isFinite);
  const n = xs.length;
  const over = Number.isFinite(line) ? xs.filter((x) => x > line).length : 0;
  const under = Number.isFinite(line) ? xs.filter((x) => x < line).length : 0;
  const push = n - over - under;
  return { n, avg: n ? xs.reduce((s, x) => s + x, 0) / n : null, median: median(xs), over, under, push: Number.isFinite(line) ? push : 0, pct: over + under ? over / (over + under) : null };
}

// Línea por defecto: la de la casa o, si no la hay, una .5 cerca del promedio.
export function defaultLine(values, offered = null) {
  if (Number.isFinite(offered)) return offered;
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return 0.5;
  const avg = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.max(0.5, Math.round(avg) - 0.5);
}

// Línea de la casa de un mercado (la más pareja, como en el análisis), o null.
export function offeredLine(offers = [], market) {
  if (!market) return null;
  const chosen = balancedLines(offers, (o) => o.market === market, { whole: () => true });
  return chosen.length ? chosen[0].line : null;
}

// ---- Resumen de un equipo ----

// { n, w, d, l, gf, ga, over25, btts, form } en sus partidos (form: 'GEPGG...' del más reciente).
export function record(matches) {
  const ms = matches.filter((m) => Number.isFinite(m.gf) && Number.isFinite(m.ga));
  const n = ms.length;
  const res = ms.map((m) => (m.gf > m.ga ? 'G' : m.gf < m.ga ? 'P' : 'E'));
  const avg = (f) => (n ? ms.reduce((s, m) => s + f(m), 0) / n : null);
  return {
    n,
    w: res.filter((r) => r === 'G').length,
    d: res.filter((r) => r === 'E').length,
    l: res.filter((r) => r === 'P').length,
    gf: avg((m) => m.gf),
    ga: avg((m) => m.ga),
    over25: avg((m) => (m.gf + m.ga > 2.5 ? 1 : 0)),
    btts: avg((m) => (m.gf > 0 && m.ga > 0 ? 1 : 0)),
    form: res.join(''),
  };
}

// Promedio [a favor, en contra] de una estadística en los partidos que la tienen.
export function averagePair(matches, stat) {
  const pairs = matches.map((m) => stat.of(m)).filter(Boolean);
  if (!pairs.length) return null;
  return { n: pairs.length, for: pairs.reduce((s, p) => s + p[0], 0) / pairs.length, against: pairs.reduce((s, p) => s + p[1], 0) / pairs.length };
}

// Enfrentamientos: { n, home, draw, away } (victorias del local y de la visita de hoy).
export function h2hRecord(list) {
  const ms = list.filter((m) => Number.isFinite(m.gf) && Number.isFinite(m.ga));
  return { n: ms.length, home: ms.filter((m) => m.gf > m.ga).length, draw: ms.filter((m) => m.gf === m.ga).length, away: ms.filter((m) => m.gf < m.ga).length };
}

// ---- Jugadores (básquet) ----

// Estadísticas de jugador que se pueden ver, en el orden de los botones.
export const PLAYER_CHART_STATS = ['pl_pts', 'pl_reb', 'pl_ast', 'pl_3pm', 'pl_pra', 'pl_pr', 'pl_pa', 'pl_ra', 'pl_stl', 'pl_blk', 'pl_sb', 'pl_tov'].filter((c) => PLAYER_STATS[c]);

// Partidos del jugador: los últimos `n` o, con `vs`, todos contra ese rival (sigla).
export function playerGames(player, { n = 10, vs = null } = {}) {
  const games = player?.games || [];
  return vs ? games.filter((g) => g.opp === vs) : games.slice(0, n);
}

export function playerSeries(games, code) {
  return games
    .map((game) => ({ value: statValue(game, code), game }))
    .filter((x) => Number.isFinite(x.value))
    .reverse();
}

// Mercados de jugador ofrecidos para un jugador: { código: línea } (la más pareja).
export function playerLines(offers = [], name, match) {
  const out = {};
  for (const code of PLAYER_CHART_STATS) {
    const list = offers.filter((o) => o.market.startsWith(`OU.${code}#`) && match(o.market.split('#')[1], name));
    const line = offeredLine(list, list[0]?.market);
    if (line != null) out[code] = line;
  }
  return out;
}

// ---- Abridores (béisbol) ----

export const PITCHER_STATS = [
  { id: 'k', name: 'Ponches' },
  { id: 'h', name: 'Hits permitidos' },
  { id: 'er', name: 'Carreras limpias' },
  { id: 'bb', name: 'Bases por bolas' },
  { id: 'ip', name: 'Entradas lanzadas' },
];

export function pitcherSeries(starts, id) {
  return (starts || [])
    .map((start) => ({ value: start[id], start }))
    .filter((x) => Number.isFinite(x.value))
    .reverse();
}

// ---- Etiquetas ----

const STOP = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'cd', 'ud', 'sd', 'rc', 'ss', 'as', 'club', 'de', 'la', 'el', 'los', 'real', 'deportivo', 'atletico', 'sporting', 'olympique', 'stade', 'united', 'city', 'sub', 'u20', 'u21', 'u23']);

// Sigla de 3 letras de un equipo para las barras ("Deportivo de A Coruña" → "COR").
export function shortName(name = '') {
  const words = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const main = words.filter((w) => !STOP.has(w.toLowerCase()) && w.length > 1);
  const word = (main.length ? main : words).sort((a, b) => b.length - a.length)[0] || '?';
  return word.slice(0, 3).toUpperCase();
}
