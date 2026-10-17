// Formato compacto de los datos publicados en data/fuente (los escribe
// scripts/collect-data.mjs y los lee la página). Compacto para que carguen
// rápido en el celular; aquí se convierten al formato normal de la página.
import { compactRecord, expandRecord } from './analysis/records.js';
import { compactTeamStats, expandTeamStats } from './analysis/teamstats.js';

export const FORMAT_VERSION = 2; // 2: grupos de cuotas, estadísticas de equipo y registros
const LAST_MATCHES = 10;
// Béisbol: más partidos (la forma de 10 partidos es casi ruido; ver baseball.js).
const LAST_BY_SPORT = { baseball: 30 };

const fsUrl = (id) => `https://www.flashscore.pe/partido/${String(id).replace(/^fs:/, '')}/`;

export function compactEvent(e) {
  return {
    id: e.id,
    sp: e.sport,
    st: Math.round(e.start / 1000),
    t: [e.tournament.id, e.tournament.name, e.tournament.priority || 0],
    c: [e.category.name, e.category.alpha2 || null],
    h: [e.home.id, e.home.name],
    a: [e.away.id, e.away.name],
    s: e.state,
    ...(e.score ? { sc: [e.score.home, e.score.away] } : {}),
  };
}

const team = ([id, name]) => ({ id, name, short: name, slug: null, alpha2: null, ranking: null, national: false });

export function expandEvent(c) {
  return {
    id: c.id,
    source: 'flashscore',
    sport: c.sp,
    start: c.st * 1000,
    tournament: { id: c.t[0], name: c.t[1], priority: c.t[2] },
    category: { id: null, name: c.c[0], alpha2: c.c[1] },
    home: team(c.h),
    away: team(c.a),
    state: c.s,
    statusText: '',
    score: c.sc ? { home: c.sc[0], away: c.sc[1], homeNT: null, awayNT: null } : null,
    winner: null,
    url: fsUrl(c.id),
  };
}

const compactMatches = (list = [], n = LAST_MATCHES) => list.slice(0, n).map((m) => [Math.round(m.start / 1000), m.home ? 1 : 0, m.gf, m.ga, m.r]);
const expandMatches = (list = []) => list.map(([st, home, gf, ga, r]) => ({ start: st * 1000, home: Boolean(home), gf, ga, r }));

// Últimos partidos de los jugadores de un equipo (básquet, ESPN): [partidos del
// equipo, [[nombre, nombre corto, de baja, [[inicio, min, pts, ...], ...]], ...]].
const PLAYER_FIELDS = ['min', 'pts', 'reb', 'ast', 'tpm', 'stl', 'blk', 'tov', 'oreb', 'dreb', 'ftm', 'fgm', 'fga', 'tpa', 'fta'];
const compactPlayers = (side) => [side?.teamGames || 0, (side?.players || []).map((p) => [p.name, p.short || null, p.out ? 1 : 0, (p.games || []).map((g) => [Math.round(g.start / 1000), ...PLAYER_FIELDS.map((f) => g[f] ?? null)])])];
const expandPlayers = (c) => ({
  teamGames: c?.[0] || 0,
  players: (c?.[1] || []).map(([name, short, out, games]) => ({
    name,
    short,
    out: Boolean(out),
    games: (games || []).map(([st, ...v]) => ({ start: st * 1000, ...Object.fromEntries(PLAYER_FIELDS.map((f, i) => [f, v[i] ?? null])) })),
  })),
});

export function compactDetails(d, sport = null) {
  const n = LAST_BY_SPORT[sport] || LAST_MATCHES;
  const out = { h: compactMatches(d.lastHome, n), a: compactMatches(d.lastAway, n), d: d.h2h ? [d.h2h.homeWins, d.h2h.draws, d.h2h.awayWins] : null };
  if (d.teamStats) out.ts = { h: compactTeamStats(d.teamStats.home), a: compactTeamStats(d.teamStats.away) };
  if (d.players) out.pl = { s: d.players.source || 'espn', h: compactPlayers(d.players.home), a: compactPlayers(d.players.away) };
  if (d.h2hGames?.length) out.hg = d.h2hGames.map((m) => [Math.round(m.start / 1000), m.gf, m.ga, m.home ? 1 : 0]);
  if (d.mlb) out.mlb = compactMlb(d.mlb);
  return out;
}

// Contexto de la MLB (béisbol): abridores con sus aperturas, bullpen, estadio, clima y serie.
const START_FIELDS = ['ip', 'r', 'er', 'h', 'bb', 'k', 'hr', 'hbp'];
const compactSide = (s) =>
  s
    ? {
        t: s.team,
        // Aperturas null: no se pudo leer su registro (se conserva para no mostrarlo como "sin aperturas").
        p: s.pitcher ? [s.pitcher.id, s.pitcher.name, s.pitcher.hand || null, s.pitcher.starts ? s.pitcher.starts.map((g) => [Math.round(g.start / 1000), ...START_FIELDS.map((f) => (f === 'ip' ? Math.round(g.ip * 1000) / 1000 : g[f] ?? 0)), g.opp || null]) : null] : null,
        b: s.bullpen ? [s.bullpen.ip, s.bullpen.np, s.bullpen.games] : null,
      }
    : null;
const expandSide = (c) =>
  c
    ? {
        team: c.t,
        pitcher: c.p ? { id: c.p[0], name: c.p[1], hand: c.p[2], starts: c.p[3] ? c.p[3].map(([st, ...v]) => ({ start: st * 1000, ...Object.fromEntries(START_FIELDS.map((f, i) => [f, v[i]])), opp: v[START_FIELDS.length] ?? null })) : null } : null,
        bullpen: c.b ? { ip: c.b[0], np: c.b[1], games: c.b[2] } : null,
      }
    : null;
export const compactMlb = (m) => ({ g: m.gamePk, v: m.venue, w: m.weather, s: m.series, pk: m.park, h: compactSide(m.home), a: compactSide(m.away) });
export const expandMlb = (c) => ({ source: 'mlb', gamePk: c.g, venue: c.v ?? null, weather: c.w ?? null, series: c.s ?? null, park: c.pk ?? null, home: expandSide(c.h), away: expandSide(c.a) });

export function expandDetails(c) {
  return {
    form: null,
    missing: null,
    odds: null,
    votes: null,
    h2h: c.d ? { homeWins: c.d[0], draws: c.d[1], awayWins: c.d[2] } : null,
    lastHome: expandMatches(c.h),
    lastAway: expandMatches(c.a),
    teamStats: c.ts ? { home: expandTeamStats(c.ts.h) || {}, away: expandTeamStats(c.ts.a) || {} } : null,
    ...(c.pl ? { players: { source: c.pl.s || 'espn', home: expandPlayers(c.pl.h), away: expandPlayers(c.pl.a) } } : {}),
    ...(c.hg ? { h2hGames: c.hg.map(([st, gf, ga, home]) => ({ start: st * 1000, gf, ga, home: Boolean(home) })) } : {}),
    ...(c.mlb ? { mlb: expandMlb(c.mlb) } : {}),
  };
}

// Cuotas: { g: [grupos], o: [[mercado, selección, línea, cuota, grupo]] }. El
// grupo (mercado de la casa con su línea) sirve para quitar el margen.
export function compactOffers(list) {
  const groups = [];
  const index = new Map();
  const gi = (g) => {
    if (g == null) return null;
    if (!index.has(g)) index.set(g, groups.push(g.replace(/^apuestatotal\|/, '')) - 1);
    return index.get(g);
  };
  return { g: groups, o: list.map((o) => [o.market, o.sel, o.line, o.price, gi(o.group)]) };
}
export function expandOffers(c = []) {
  // Versión 1: lista sin grupos.
  if (Array.isArray(c)) return c.map(([market, sel, line, price]) => ({ source: 'apuestatotal', market, sel, line, price }));
  return (c.o || []).map(([market, sel, line, price, g]) => ({ source: 'apuestatotal', market, sel, line, price, ...(g != null ? { group: `apuestatotal|${c.g[g]}` } : {}) }));
}

const r3 = (x) => Math.round(x * 1000) / 1000;
export const compactXg = (x) => ({ h: [r3(x.home.xgFor), r3(x.home.xgAgainst)], a: [r3(x.away.xgFor), r3(x.away.xgAgainst)] });
export const expandXg = (c) => ({ home: { xgFor: c.h[0], xgAgainst: c.h[1] }, away: { xgFor: c.a[0], xgAgainst: c.a[1] } });

// Archivo de un día y un deporte.
// datos: ids de los partidos con su archivo de la pestaña Datos (datos/<id>.json).
export function compactDay({ date, sport, generated, events, offers = {}, details = {}, xg = {}, datos = null }) {
  const map = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
  return { v: FORMAT_VERSION, date, sport, generated, events: events.map(compactEvent), offers: map(offers, compactOffers), details: map(details, (d) => compactDetails(d, sport)), xg: map(xg, compactXg), ...(datos ? { datos } : {}) };
}

export function expandDay(c) {
  const map = (obj, fn) => new Map(Object.entries(obj || {}).map(([k, v]) => [k, fn(v)]));
  return {
    date: c.date,
    sport: c.sport,
    generated: c.generated,
    events: (c.events || []).map(expandEvent),
    offers: map(c.offers, expandOffers),
    details: map(c.details, expandDetails),
    xg: map(c.xg, expandXg),
    // Archivos de antes: solo tenían datos los partidos con cuotas (los de details).
    datos: new Set(c.datos || Object.keys(c.details || {})),
  };
}

// Resultados: { id: [estado, local, visita, periodos?, registro?] }. Los
// periodos salen del feed del día; el registro completo (incidencias y
// estadísticas) solo para los partidos analizados.
export function compactResult(r, { per = null, record = null } = {}) {
  const out = [r.state, r.score?.home ?? null, r.score?.away ?? null];
  if (per || record) out.push(per || null);
  if (record) out.push(compactRecord(record));
  return out;
}
export function expandResult([state, home, away, per, record], sport = null) {
  const out = { state, score: home != null && away != null ? { home, away, homeNT: null, awayNT: null } : null, winner: null };
  if (per) out.per = per;
  if (record) out.record = expandRecord(record, sport, state);
  return out;
}

// ---- Datos de un partido (pestaña Datos): data/fuente/datos/<id>.json ----
// Se baja solo al abrir el partido. Últimos partidos de cada equipo con el rival, el
// marcador y las estadísticas de cada uno; enfrentamientos directos; jugadores (NBA y
// WNBA) con su registro y abridores (MLB) con sus aperturas.

// Estadísticas por partido: [código, nombre en la página, estadística de parseFsStats, alcance].
const MATCH_STATS = [
  ['c', 'corners', 'corners', 'ft'],
  ['c1', 'corners_h1', 'corners', 'h1'],
  ['y', 'yellows', 'yellows', 'ft'],
  ['r', 'reds', 'reds', 'ft'],
  ['s', 'shots', 'shots', 'ft'],
  ['t', 'shots_on', 'shots_on', 'ft'],
  ['f', 'fouls', 'fouls', 'ft'],
  ['x', 'xg', 'xg', 'ft'],
  ['p', 'possession', 'possession', 'ft'],
  ['o', 'offsides', 'offsides', 'ft'],
  ['rb', 'reb', 'reb', 'ft'],
  ['as', 'ast', 'ast', 'ft'],
  ['tp', 'threes', 'threes', 'ft'],
  ['to', 'tov', 'tov', 'ft'],
];

// Estadísticas de un partido (parseFsStats) → { código: [a, b] } en el orden pedido:
// flip = true las da vueltas (visita primero). null si no hay ninguna.
export function compactMatchStats(stats, flip = false) {
  if (!stats) return null;
  const out = {};
  for (const [code, , name, scope] of MATCH_STATS) {
    const v = stats[name]?.[scope];
    if (!Array.isArray(v) || !v.every(Number.isFinite)) continue;
    const r = (x) => Math.round(x * 100) / 100;
    out[code] = flip ? [r(v[1]), r(v[0])] : [r(v[0]), r(v[1])];
  }
  return Object.keys(out).length ? out : null;
}
const expandMatchStats = (c) => (c ? Object.fromEntries(MATCH_STATS.filter(([code]) => c[code]).map(([code, name]) => [name, c[code]])) : null);

const START_ROW = ['ip', 'h', 'er', 'bb', 'k', 'hr'];

// d: { id, sport, generated, home: { name, last }, away: { name, last }, h2h, players, pitchers }
//  last: [{ start, home, opp, gf, ga, league, stats }] (stats: [a favor, en contra])
//  h2h: [{ start, home (el local de hoy fue local), gf, ga (del local de hoy), league, stats ([local de hoy, visita de hoy]) }]
//  players: [{ side: 'home' | 'away', name, games: [{ start, opp, home, min, pts, ... }] }]
//    (fútbol: min, sh remates, sot tiros al arco, gl goles, xg)
//  abbr: [sigla del local, sigla de la visita] (las de `opp` en los partidos de los jugadores)
//  pitchers: { home: { name, starts: [{ start, opp, ip, h, er, bb, k, hr }] }, away }
// Campos de cada partido de un jugador en el archivo de un partido, por deporte.
const MATCH_PLAYER_FIELDS = { football: ['min', 'sh', 'sot', 'gl', 'xg'] };
const playerFieldsOf = (sport) => MATCH_PLAYER_FIELDS[sport] || PLAYER_FIELDS;

export function compactMatchData(d) {
  const fields = playerFieldsOf(d.sport);
  const leagues = [];
  const li = (name) => {
    const i = leagues.indexOf(name || '');
    return i >= 0 ? i : leagues.push(name || '') - 1;
  };
  const ts = (ms) => Math.round(ms / 1000);
  const last = (list = []) => list.map((m) => [ts(m.start), m.home ? 1 : 0, m.opp || '', m.gf, m.ga, li(m.league), m.stats || 0]);
  const out = { v: 1, id: d.id, sp: d.sport, g: d.generated, n: [d.home?.name || '', d.away?.name || ''], h: last(d.home?.last), a: last(d.away?.last), hh: (d.h2h || []).map((m) => [ts(m.start), m.home ? 1 : 0, m.gf, m.ga, li(m.league), m.stats || 0]) };
  if (d.abbr) out.ab = d.abbr;
  if (d.players?.length) out.pl = d.players.map((p) => [p.side === 'away' ? 'a' : 'h', p.name, p.games.map((g) => [ts(g.start), g.opp || '', g.home == null ? null : g.home ? 1 : 0, ...fields.map((f) => g[f] ?? null)])]);
  const pitcher = (p) => (p ? [p.name || '', (p.starts || []).map((g) => [ts(g.start), g.opp || '', ...START_ROW.map((f) => (f === 'ip' ? Math.round(g.ip * 1000) / 1000 : g[f] ?? null))])] : null);
  if (d.pitchers?.home || d.pitchers?.away) out.mp = { h: pitcher(d.pitchers.home), a: pitcher(d.pitchers.away) };
  out.L = leagues;
  return out;
}

export function expandMatchData(c) {
  const fields = playerFieldsOf(c.sp);
  const league = (i) => c.L?.[i] || '';
  const last = (list = []) => list.map(([st, home, opp, gf, ga, l, stats]) => ({ start: st * 1000, home: Boolean(home), opp, gf, ga, league: league(l), stats: expandMatchStats(stats || null) }));
  const pitcher = (p) => (p ? { name: p[0], starts: p[1].map(([st, opp, ...v]) => ({ start: st * 1000, opp, ...Object.fromEntries(START_ROW.map((f, i) => [f, v[i]])) })) } : null);
  return {
    id: c.id,
    sport: c.sp,
    generated: c.g,
    home: { name: c.n?.[0] || '', last: last(c.h) },
    away: { name: c.n?.[1] || '', last: last(c.a) },
    h2h: (c.hh || []).map(([st, home, gf, ga, l, stats]) => ({ start: st * 1000, home: Boolean(home), gf, ga, league: league(l), stats: expandMatchStats(stats || null) })),
    players: (c.pl || []).map(([side, name, games]) => ({
      side: side === 'a' ? 'away' : 'home',
      name,
      games: games.map(([st, opp, home, ...v]) => ({ start: st * 1000, opp, home: home == null ? null : Boolean(home), ...Object.fromEntries(fields.map((f, i) => [f, v[i] ?? null])) })),
    })),
    abbr: c.ab || null,
    pitchers: c.mp ? { home: pitcher(c.mp.h), away: pitcher(c.mp.a) } : null,
  };
}
