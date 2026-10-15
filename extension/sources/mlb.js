// MLB (API oficial, statsapi.mlb.com): el contexto de un partido para el béisbol.
//  - Abridores probables y su registro apertura por apertura (temporada actual,
//    playoffs y, si hacen falta, la temporada anterior).
//  - Desgaste del bullpen: entradas y lanzamientos de los relevistas en los 3 días
//    anteriores (box scores).
//  - Efecto del estadio: carreras por partido en los partidos de local del equipo
//    local frente a sus partidos de visita (temporada actual y anterior).
//  - Clima (temperatura y viento) y serie de playoffs.
// Solo la MLB: las ligas de invierno no tienen datos de sus lanzadores.
import { fetchData } from '../lib/net.js';

const API = 'https://statsapi.mlb.com/api/v1';
const DAY = 86400000;

const getJson = async (url) => (await fetchData(url, { modes: ['direct'] })).data;

// Guarda la promesa (se comparte entre pedidos simultáneos); si falla, se olvida.
function memo(cache, key, fn, max = 500) {
  if (!cache.has(key)) {
    const p = fn();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > max) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

const toMs = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v ? Date.parse(v) : NaN);
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// "5.2" (5 entradas y 2 outs) → 5.667.
export function inningsOf(v) {
  const m = String(v ?? '').match(/^(\d+)(?:\.(\d))?$/);
  return m ? Number(m[1]) + Number(m[2] || 0) / 3 : null;
}

// ---- Equipos ----

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const ALIAS = { la: 'los angeles', ny: 'new york', sf: 'san francisco', sd: 'san diego', kc: 'kansas city', tb: 'tampa bay', chi: 'chicago', stl: 'st louis', 'saint louis': 'st louis' };
function teamWords(s) {
  let t = norm(s);
  for (const [k, v] of Object.entries(ALIAS)) t = t.replace(new RegExp(`^${k}\\b`), v);
  return t;
}

// ¿`name` (de Flashscore, Sofascore o la casa) es el equipo `t` de la API?
// Nombre completo o corto; o termina con su apodo ("Red Sox", "Dodgers").
export function sameTeam(name, t) {
  const n = teamWords(name);
  if (!n || !t) return false;
  if ([t.name, t.shortName, t.clubName && `${t.locationName} ${t.clubName}`].filter(Boolean).map(teamWords).includes(n)) return true;
  const nick = teamWords(t.teamName || t.clubName);
  return Boolean(nick) && (n === nick || n.endsWith(` ${nick}`));
}

// ---- Partido ----

// Partidos de la MLB entre dos fechas, con abridores, estadio, clima y serie.
const scheduleCache = new Map();
const schedule = (from, to) =>
  memo(scheduleCache, `${from}|${to}`, async () => {
    const data = await getJson(`${API}/schedule?sportId=1&startDate=${from}&endDate=${to}&hydrate=probablePitcher,team,venue,weather,seriesStatus`);
    return (data?.dates || []).flatMap((d) => d.games || []);
  });

// Partido de `home` contra `away` que empieza cerca de `start` (o null).
export function findGame(games, home, away, start) {
  let best = null;
  for (const g of games || []) {
    const h = g.teams?.home?.team;
    const a = g.teams?.away?.team;
    if (!sameTeam(home, h) || !sameTeam(away, a)) continue;
    const dt = Math.abs(toMs(g.gameDate) - start);
    if (dt <= 8 * 3600000 && (!best || dt < best.dt)) best = { g, dt };
  }
  return best?.g || null;
}

// ---- Lanzadores ----

// Aperturas de un lanzador en su registro (gameLog): [{ start, ip, r, er, h, bb, k, hr, hbp, opp }]
// del más reciente al más antiguo. Solo las aperturas (no las salidas como relevista).
export function startsFromGameLog(data) {
  const out = [];
  for (const block of data?.stats || []) {
    for (const x of block.splits || []) {
      const s = x.stat || {};
      if (!(Number(s.gamesStarted) > 0)) continue;
      const ip = inningsOf(s.inningsPitched);
      const start = toMs(x.date);
      if (ip == null || !Number.isFinite(start)) continue;
      out.push({ start, ip, r: num(s.runs) ?? 0, er: num(s.earnedRuns) ?? 0, h: num(s.hits) ?? 0, bb: num(s.baseOnBalls) ?? 0, k: num(s.strikeOuts) ?? 0, hr: num(s.homeRuns) ?? 0, hbp: num(s.hitBatsmen) ?? 0, opp: x.opponent?.name || null });
    }
  }
  return out.sort((a, b) => b.start - a.start);
}

const logCache = new Map();
const gameLog = (id, season, type) =>
  memo(logCache, `${id}|${season}|${type}`, async () => startsFromGameLog(await getJson(`${API}/people/${id}/stats?stats=gameLog&group=pitching&season=${season}&gameType=${type}`)));

// Registro de una temporada; un 404 es "sin registro" (lista vacía), otro error se propaga.
const seasonLog = (id, year, type) => gameLog(id, year, type).catch((e) => (e?.status === 404 ? [] : Promise.reject(e)));

// Últimas `n` aperturas antes de `before`: temporada regular y playoffs de esta
// temporada y, si no alcanzan, los de la temporada anterior. El registro trae solo
// la fecha (sin hora): las de las 30 horas anteriores no cuentan (no puede ser otra
// apertura del mismo lanzador y evita tomar el partido a analizar).
// Si no se puede leer el registro de esta temporada, error: las aperturas de la
// temporada anterior pasarían por las últimas.
export async function lastStarts(id, season, before, n = 10) {
  const found = [];
  const add = (list) => {
    for (const g of list) if (g.start < before - 30 * 3600000 && !found.some((x) => Math.abs(x.start - g.start) < 6 * 3600000)) found.push(g);
  };
  for (const year of [season, season - 1]) {
    if (year < season && found.length >= n) break;
    const logs = await Promise.allSettled([seasonLog(id, year, 'R'), seasonLog(id, year, 'P')]);
    const failed = logs.find((r) => r.status === 'rejected');
    if (failed && year === season) throw failed.reason;
    // Temporada anterior incompleta: solo las de esta temporada (son las más recientes).
    if (failed) break;
    for (const r of logs) add(r.value);
  }
  return found.sort((a, b) => b.start - a.start).slice(0, n);
}

// ---- Bullpen ----

// Entradas y lanzamientos de los relevistas de un equipo en los partidos de los
// 3 días anteriores (y, en un doble juego, el primero del mismo día): { ip, np, games }.
const boxCache = new Map();
const boxscore = (gamePk) => memo(boxCache, String(gamePk), () => getJson(`${API}/game/${gamePk}/boxscore`));

export function relieversOf(box, teamId) {
  const side = String(box?.teams?.home?.team?.id) === String(teamId) ? 'home' : String(box?.teams?.away?.team?.id) === String(teamId) ? 'away' : null;
  if (!side) return null;
  const t = box.teams[side];
  const ids = t.pitchers || [];
  let ip = 0;
  let np = 0;
  for (const id of ids.slice(1)) {
    const st = t.players?.[`ID${id}`]?.stats?.pitching || {};
    ip += inningsOf(st.inningsPitched) || 0;
    np += num(st.numberOfPitches) || 0;
  }
  return { ip, np };
}

// Fechas de la API: la fecha oficial (local) del partido, no la de UTC (un partido
// de noche en el oeste empieza al día siguiente en UTC).
export function bullpenDates(officialDate, before) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(officialDate || '') ? Date.parse(`${officialDate}T12:00:00Z`) : before - 7 * 3600000;
  return { from: ymd(base - 3 * DAY), to: ymd(base) };
}

const PLAYED = (g) => g.status?.abstractGameState === 'Final' && !/postponed|cancel/i.test(g.status?.detailedState || '');

async function bullpen(teamId, before, officialDate) {
  const { from, to } = bullpenDates(officialDate, before);
  const data = await getJson(`${API}/schedule?sportId=1&teamId=${teamId}&startDate=${from}&endDate=${to}`);
  const games = (data?.dates || []).flatMap((d) => d.games || []).filter((g) => PLAYED(g) && toMs(g.gameDate) < before);
  let ip = 0;
  let np = 0;
  for (const g of games) {
    const r = relieversOf(await boxscore(g.gamePk), teamId);
    if (r) (ip += r.ip), (np += r.np);
  }
  return { ip: Math.round(ip * 10) / 10, np, games: games.length };
}

// ---- Estadio ----

// Carreras por partido (de ambos equipos) en los partidos de local y de visita de
// un equipo en una temporada regular: { home, away, nHome, nAway }.
export function parkRuns(games, teamId) {
  let home = 0;
  let away = 0;
  let nHome = 0;
  let nAway = 0;
  for (const g of games || []) {
    if (g.status?.abstractGameState !== 'Final') continue;
    const hs = num(g.teams?.home?.score);
    const as = num(g.teams?.away?.score);
    if (hs == null || as == null) continue;
    if (String(g.teams.home.team?.id) === String(teamId)) (home += hs + as), nHome++;
    else if (String(g.teams.away.team?.id) === String(teamId)) (away += hs + as), nAway++;
  }
  return { home: nHome ? home / nHome : null, away: nAway ? away / nAway : null, nHome, nAway };
}

const parkCache = new Map();
const seasonGames = (teamId, season) =>
  memo(parkCache, `${teamId}|${season}`, async () => {
    const data = await getJson(`${API}/schedule?sportId=1&teamId=${teamId}&season=${season}&gameType=R`);
    return (data?.dates || []).flatMap((d) => d.games || []);
  });

// Factor del estadio del equipo local (temporadas actual y anterior juntas):
// { factor, n } con factor = carreras por partido de local / de visita.
async function parkFactor(teamId, season) {
  let home = 0;
  let away = 0;
  let nHome = 0;
  let nAway = 0;
  for (const year of [season, season - 1]) {
    try {
      const r = parkRuns(await seasonGames(teamId, year), teamId);
      if (r.nHome) (home += r.home * r.nHome), (nHome += r.nHome);
      if (r.nAway) (away += r.away * r.nAway), (nAway += r.nAway);
    } catch {
      // sin calendario de esa temporada
    }
  }
  if (nHome < 20 || nAway < 20) return null;
  return { factor: Math.round((home / nHome / (away / nAway)) * 1000) / 1000, n: nHome + nAway };
}

// ---- Contexto completo ----

// Contexto de un partido de la MLB por los nombres de los equipos y la hora de
// inicio, o null si no es de la MLB: { gamePk, venue, weather, series, park,
// home: { team, pitcher: { id, name, starts }, bullpen }, away: {...}, partial? }.
// starts null: no se pudo leer el registro del abridor (distinto de [] sin aperturas).
export async function getGameContext({ home, away, start } = {}) {
  const ms = toMs(start);
  if (!Number.isFinite(ms)) throw new Error('MLB: falta la hora de inicio del partido');
  const games = await schedule(ymd(ms - DAY), ymd(ms + DAY));
  const g = findGame(games, home, away, ms);
  if (!g) return null;
  const season = Number(g.season) || new Date(ms).getUTCFullYear();
  // Lo que no se pudo leer queda en `partial` (y sin datos: starts null, bullpen null).
  const partial = [];
  const side = async (key) => {
    const t = g.teams[key];
    const p = t.probablePitcher;
    const [starts, pen] = await Promise.all([
      p?.id
        ? lastStarts(p.id, season, ms).catch((e) => {
            partial.push(`aperturas de ${p.fullName || p.id}: ${e.message}`);
            return null;
          })
        : [],
      bullpen(t.team.id, ms, g.officialDate).catch((e) => {
        partial.push(`bullpen de ${t.team.name}: ${e.message}`);
        return null;
      }),
    ]);
    return {
      team: t.team.name,
      pitcher: p?.id ? { id: String(p.id), name: p.fullName || '', hand: p.pitchHand?.code || null, starts } : null,
      bullpen: pen,
    };
  };
  const [h, a, park] = await Promise.all([side('home'), side('away'), parkFactor(g.teams.home.team.id, season).catch(() => null)]);
  const w = g.weather || {};
  return {
    ...(partial.length ? { partial } : {}),
    source: 'mlb',
    gamePk: String(g.gamePk),
    venue: g.venue?.name || null,
    weather: w.condition || w.temp || w.wind ? { condition: w.condition || null, temp: num(w.temp), wind: w.wind || null } : null,
    series: g.seriesStatus?.description || null,
    park,
    home: h,
    away: a,
  };
}

export default {
  id: 'mlb',
  name: 'MLB',
  role: 'Béisbol: abridores, bullpen, estadio y clima (API oficial de la MLB)',
  async diagnose() {
    const now = Date.now();
    const games = await schedule(ymd(now), ymd(now + 2 * DAY));
    const next = games.find((g) => g.status?.abstractGameState !== 'Final');
    let context = null;
    if (next) {
      try {
        context = await getGameContext({ home: next.teams.home.team.name, away: next.teams.away.team.name, start: next.gameDate });
      } catch (e) {
        context = { error: e.message };
      }
    }
    return {
      mode: 'direct',
      count: games.length,
      sample: games.slice(0, 3).map((g) => `${g.teams.away.team.name} @ ${g.teams.home.team.name} · ${g.teams.away.probablePitcher?.fullName || 'sin abridor'} vs ${g.teams.home.probablePitcher?.fullName || 'sin abridor'}`),
      details: { context },
    };
  },
};
