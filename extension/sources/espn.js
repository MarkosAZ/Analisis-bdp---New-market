// ESPN: noticias de fútbol en español, resultados (incluye Liga 1 de Perú) y
// estadísticas por jugador de la NBA y la WNBA (Más/Menos de jugador).
import { fetchData } from '../lib/net.js';
import { toIso } from '../lib/model.js';

const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const SPORTS_API = 'https://site.api.espn.com/apis/site/v2/sports';
const BASKET_API = `${SPORTS_API}/basketball`;
const WEB_API = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball';

const STATE = { pre: 'pendiente', in: 'en_vivo', post: 'finalizado' };

// Noticias para la red neuronal: fútbol (todas y ligas principales) y las
// ligas grandes de otros deportes. path: "soccer/all", "basketball/nba"...
export const NEWS_PATHS = ['soccer/all', 'soccer/per.1', 'soccer/esp.1', 'soccer/eng.1', 'soccer/ita.1', 'soccer/arg.1', 'soccer/uefa.champions', 'basketball/nba', 'hockey/nhl', 'football/nfl', 'baseball/mlb', 'tennis/atp', 'tennis/wta'];

export async function getNews({ league = 'all', path = null } = {}) {
  const url = path ? `${SPORTS_API}/${path}/news?lang=es&region=pe` : `${API}/${league}/news?lang=es&region=pe`;
  const { data, mode } = await fetchData(url, { modes: ['direct'] });
  return {
    mode,
    items: (data.articles || []).map((a) => ({
      source: 'espn',
      title: a.headline || '',
      summary: a.description || '',
      published: toIso(a.published),
      url: a.links?.web?.href || null,
      image: a.images?.[0]?.url || null,
      section: data.header || '',
      sport: path ? path.split('/')[0] : 'soccer',
    })),
  };
}

// Todas las noticias de NEWS_PATHS (las que fallen se omiten).
export async function getAllNews() {
  const items = [];
  const errors = [];
  for (const path of NEWS_PATHS) {
    try {
      items.push(...(await getNews({ path })).items);
    } catch (e) {
      errors.push(`${path}: ${e.message}`);
    }
  }
  return { mode: 'direct', items, errors };
}

// league: código ESPN, p. ej. "per.1" (Liga 1 Perú), "esp.1", "eng.1", "all".
export async function getMatches({ league = 'per.1', date } = {}) {
  const query = date ? `?dates=${date.replace(/-/g, '')}` : '';
  const { data, mode } = await fetchData(`${API}/${league}/scoreboard${query}`, { modes: ['direct'] });
  const leagueName = data.leagues?.[0]?.name || league;
  return {
    mode,
    items: (data.events || []).map((e) => {
      const comp = e.competitions?.[0] || {};
      const home = comp.competitors?.find((c) => c.homeAway === 'home') || {};
      const away = comp.competitors?.find((c) => c.homeAway === 'away') || {};
      const st = STATE[e.status?.type?.state] || 'otro';
      return {
        source: 'espn',
        id: String(e.id),
        start: toIso(e.date),
        league: leagueName,
        country: '',
        home: home.team?.displayName || '',
        away: away.team?.displayName || '',
        status: st,
        score: st === 'pendiente' ? null : { home: Number(home.score ?? NaN), away: Number(away.score ?? NaN) },
        url: e.links?.[0]?.href || null,
      };
    }),
  };
}

// ---- Básquet: jugadores de la NBA y la WNBA ----

export const BASKETBALL_LEAGUES = ['nba', 'wnba'];

// fga/tpa/fta: tiros de campo, triples y tiros libres intentados.
const PLAYER_FIELDS = ['min', 'pts', 'reb', 'ast', 'tpm', 'stl', 'blk', 'tov', 'oreb', 'dreb', 'ftm', 'fgm', 'fga', 'tpa', 'fta'];
// Columna de cada dato en el box score: por `keys` y, de respaldo, por `names`/`labels`.
// Los "x-y" son anotados-intentados: los anotados son el primer número.
const BOX_COLUMNS = {
  min: ['minutes', 'MIN'],
  pts: ['points', 'PTS'],
  reb: ['rebounds', 'totalRebounds', 'REB'],
  ast: ['assists', 'AST'],
  tpm: ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointFieldGoalsMade', '3PT', '3PM'],
  stl: ['steals', 'STL'],
  blk: ['blocks', 'BLK'],
  tov: ['turnovers', 'TO', 'TOV'],
  oreb: ['offensiveRebounds', 'OREB'],
  dreb: ['defensiveRebounds', 'DREB'],
  ftm: ['freeThrowsMade-freeThrowsAttempted', 'freeThrowsMade', 'FT', 'FTM'],
  fgm: ['fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalsMade', 'FG', 'FGM'],
  // Intentos con columna propia; si no la hay, el segundo número del "x-y" de sus anotados.
  fga: ['fieldGoalsAttempted', 'FGA'],
  tpa: ['threePointFieldGoalsAttempted', '3PA'],
  fta: ['freeThrowsAttempted', 'FTA'],
};
const MADE_OF = { fga: 'fgm', tpa: 'tpm', fta: 'ftm' };

const toMs = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v ? Date.parse(v) : NaN);
const limaYmd = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(ms)); // AAAA-MM-DD
const nextDay = (ymd) => new Date(Date.parse(`${ymd}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

function checkLeague(league) {
  if (!BASKETBALL_LEAGUES.includes(league)) throw new Error(`ESPN: liga de básquet no soportada (${league})`);
}

function columnIndex(block, alts) {
  for (const alt of alts) {
    for (const list of [block.keys, block.names, block.labels]) {
      const i = (list || []).findIndex((k) => String(k).toLowerCase() === alt.toLowerCase());
      if (i >= 0) return i;
    }
  }
  return -1;
}

// "15" → 15, "3-12" → 3 (con second: 12; "15" con second → null), "34:30" (minutos) → 34.5,
// "--" o vacío → null.
function boxNumber(raw, field, second = false) {
  const s = String(raw ?? '').trim();
  const clock = field === 'min' && s.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Math.round((Number(clock[1]) + Number(clock[2]) / 60) * 100) / 100;
  const m = s.match(/^(\d+(?:\.\d+)?)(?:-(\d+))?$/);
  if (!m) return null;
  if (!second) return Number(m[1]);
  return m[2] != null ? Number(m[2]) : null;
}

// Fila normalizada de un jugador: { min, pts, ..., fgm, fga, tpa, fta } o { min: 0, dnp: true }
// (no jugó: didNotPlay, sin estadísticas, o 0 minutos sin ningún dato).
function athleteRow(a, cols) {
  if (a.didNotPlay || !a.stats?.length) return { min: 0, dnp: true };
  // Todo en cero (también intentos y +/-): no jugó. Con "MIN 0" pero algún intento o
  // +/- sí entró a la cancha, y la casa liquida la apuesta.
  if (a.stats.every((v) => /^(?:[+-]?0+(?:-0+)?|--?|)$/.test(String(v ?? '').trim()))) return { min: 0, dnp: true };
  const row = {};
  for (const f of PLAYER_FIELDS) {
    const made = MADE_OF[f];
    if (cols[f] >= 0) row[f] = boxNumber(a.stats[cols[f]], f);
    else row[f] = made && cols[made] >= 0 ? boxNumber(a.stats[cols[made]], made, true) : null;
    // Menos intentos que anotados: dato roto, mejor sin dato.
    if (made && row[f] != null && row[made] != null && row[f] < row[made]) row[f] = null;
  }
  return row;
}

// Box score del resumen de un partido: { [teamId]: [{ id, name, short, row }] }.
export function boxFromSummary(summary) {
  const out = {};
  for (const team of summary?.boxscore?.players || []) {
    const id = String(team.team?.id ?? '');
    const list = (out[id] ||= []);
    const seen = new Set(list.map((p) => p.name));
    for (const block of team.statistics || []) {
      const cols = Object.fromEntries(Object.entries(BOX_COLUMNS).map(([f, alts]) => [f, columnIndex(block, alts)]));
      for (const a of block.athletes || []) {
        const name = a.athlete?.displayName || a.athlete?.fullName || a.athlete?.shortName;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        list.push({ id: a.athlete?.id != null ? String(a.athlete.id) : null, name, short: a.athlete?.shortName || null, row: athleteRow(a, cols) });
      }
    }
  }
  return out;
}

// Jugadores de un equipo en el box score: [{ id, name, short, row }] ([] si el equipo no está).
export function teamPlayersFromSummary(summary, teamId) {
  return boxFromSummary(summary)[String(teamId)] || [];
}

// Jugadores de ambos equipos: { [nombre]: fila } (el formato de rec.players).
export function playersFromSummary(summary) {
  return playersOfBox(boxFromSummary(summary));
}

function playersOfBox(box) {
  const out = {};
  for (const list of Object.values(box || {})) for (const p of list) if (!(p.name in out)) out[p.name] = p.row;
  return out;
}

// Bajas (lesión o suspensión) de un equipo en el resumen de un partido por jugar:
// [{ id, name }]. "Day-To-Day" o "Questionable" no cuentan como baja.
export function outFromSummary(summary, teamId) {
  const out = [];
  for (const t of summary?.injuries || []) {
    if (String(t.team?.id ?? '') !== String(teamId)) continue;
    for (const inj of t.injuries || []) {
      const text = [inj.status, inj.type?.name, inj.type?.description, inj.details?.fantasyStatus?.description].filter(Boolean).join(' ');
      const name = inj.athlete?.displayName || inj.athlete?.fullName;
      if (name && /(^|[^a-z])out([^a-z]|$)|suspen/i.test(text)) out.push({ id: inj.athlete?.id != null ? String(inj.athlete.id) : null, name });
    }
  }
  return out;
}

// ---- Equipos ----

// Nombre de equipo comparable: sin tildes ni signos, minúsculas y sin espacios;
// "LA Clippers" = "L.A. Clippers" = "Los Angeles Clippers".
const TEAM_ALIAS = { la: 'losangeles', ny: 'newyork', gs: 'goldenstate', okc: 'oklahomacity' };
function teamNorm(s) {
  const w = String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (w.length > 1 && TEAM_ALIAS[w[0]]) w[0] = TEAM_ALIAS[w[0]];
  return w.join('');
}

// 3: nombre completo (displayName, location + name o shortDisplayName); 2: solo el
// apodo ("Lakers") o el apodo con la ciudad abreviada; 1: abreviatura ("LAL").
function teamScore(target, t) {
  if ([t.displayName, `${t.location ?? ''} ${t.name ?? ''}`, t.shortDisplayName].map(teamNorm).includes(target)) return 3;
  const nick = teamNorm(t.name || t.shortDisplayName);
  const loc = teamNorm(t.location);
  if (nick && target.endsWith(nick)) {
    const rest = target.slice(0, -nick.length);
    if (!rest || (loc && rest.length >= 2 && (loc.startsWith(rest) || rest.startsWith(loc)))) return 2;
  }
  return t.abbreviation && target === teamNorm(t.abbreviation) ? 1 : 0;
}

// Equipo de ESPN ({ id, displayName, shortDisplayName, location, name, abbreviation })
// que corresponde a `name`, o null si ninguno o si dos empatan.
export function matchEspnTeam(name, teams = []) {
  const target = teamNorm(name);
  if (!target) return null;
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const t of teams || []) {
    if (!t) continue;
    const s = teamScore(target, t);
    if (s > bestScore) {
      best = t;
      bestScore = s;
      tie = false;
    } else if (s && s === bestScore && String(t.id) !== String(best.id)) tie = true;
  }
  return tie ? null : best;
}

// ---- Marcador del día y calendario ----

function espnState(status) {
  const type = status?.type || {};
  if (type.completed) return 'finalizado';
  if (/postpon/i.test(type.name || '')) return 'aplazado';
  if (/cancel/i.test(type.name || '')) return 'cancelado';
  return type.state === 'in' ? 'en_vivo' : type.state === 'pre' ? 'pendiente' : 'otro';
}

// Partidos del marcador: [{ id, start (ms), state, home: equipo, away: equipo }].
export function eventsFromScoreboard(data) {
  return (data?.events || []).map((e) => {
    const comp = e.competitions?.[0] || {};
    const side = (s) => comp.competitors?.find((c) => c.homeAway === s);
    const score = (s) => (side(s)?.score != null && Number.isFinite(Number(side(s).score)) ? Number(side(s).score) : null);
    return { id: String(e.id), start: Date.parse(e.date), state: espnState(e.status || comp.status), home: side('home')?.team || null, away: side('away')?.team || null, score: [score('home'), score('away')] };
  });
}

// Partido de `events` entre los equipos `home` y `away` (nombres; también con
// local y visita invertidos, p. ej. en cancha neutral), el más cercano a `start`
// y a menos de 12 horas. null si no está.
export function findGame(events, home, away, start = NaN) {
  let best = null;
  for (const e of events || []) {
    if (!e.home || !e.away) continue;
    const same = (n, t) => Boolean(matchEspnTeam(n, [t]));
    if (!((same(home, e.home) && same(away, e.away)) || (same(home, e.away) && same(away, e.home)))) continue;
    const dt = Number.isFinite(start) && Number.isFinite(e.start) ? Math.abs(e.start - start) : 0;
    if (dt > 12 * 3600000) continue;
    if (!best || dt < best.dt) best = { e, dt };
  }
  return best?.e || null;
}

// Partidos terminados del calendario de un equipo antes de `before` (ms), del más
// reciente al más antiguo: [{ id, start }].
export function finishedGames(schedule, before = Infinity) {
  return (schedule?.events || [])
    .map((e) => ({ id: String(e.id), start: Date.parse(e.date), done: Boolean((e.competitions?.[0]?.status || e.status)?.type?.completed) }))
    .filter((g) => g.done && g.start < before)
    .sort((a, b) => b.start - a.start)
    .map(({ id, start }) => ({ id, start }));
}

// Últimos partidos de los jugadores de un equipo a partir de los box scores de sus
// partidos (games: [{ start, box }], box = boxFromSummary). `out`: bajas [{ id, name }].
// → { teamGames, players: [{ name, short, games, out }] } con games solo los partidos
// jugados (más recientes primero) y los jugadores por minutos promedio del equipo.
export function teamLogs(games, teamId, out = []) {
  const byPlayer = new Map();
  let teamGames = 0;
  for (const g of [...(games || [])].sort((a, b) => b.start - a.start)) {
    const list = g.box?.[String(teamId)];
    if (!list?.length) continue;
    teamGames++;
    for (const p of list) {
      const key = p.id || `n:${p.name}`;
      if (!byPlayer.has(key)) byPlayer.set(key, { id: p.id, name: p.name, short: p.short, games: [] });
      if (!p.row.dnp && p.row.min > 0) byPlayer.get(key).games.push({ start: g.start, ...Object.fromEntries(PLAYER_FIELDS.map((f) => [f, p.row[f] ?? null])) });
    }
  }
  const outIds = new Set(out.map((o) => o.id).filter(Boolean));
  const outNames = new Set(out.map((o) => teamNorm(o.name)));
  const minutes = (p) => p.games.reduce((s, x) => s + x.min, 0) / (teamGames || 1);
  const players = [...byPlayer.values()]
    .filter((p) => p.games.length)
    .map((p) => ({ name: p.name, short: p.short, games: p.games, out: Boolean((p.id && outIds.has(p.id)) || outNames.has(teamNorm(p.name))), m: minutes(p) }))
    .sort((a, b) => b.m - a.m)
    .map(({ m, ...p }) => p);
  return { teamGames, players };
}

// ---- Registro de partidos de cada jugador ----

// Palabras de un nombre de jugador: sin tildes, signos ni sufijos ("Jr.", "III").
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
const nameWords = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !SUFFIXES.has(w));

// ¿`name` (como lo escribe la casa: "LeBron James", "L. James", "James L.") es el
// atleta de ESPN `athlete` ({ displayName })?
export function sameAthlete(name, athlete) {
  const a = nameWords(name);
  const b = nameWords(athlete?.displayName);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const rest = b.slice(1).join(' ');
  if (a.length >= 2 && a[0].length === 1) return a[0] === b[0][0] && a.slice(1).join(' ') === rest;
  if (a.length >= 2 && a[a.length - 1].length === 1) return a[a.length - 1] === b[0][0] && a.slice(0, -1).join(' ') === rest;
  return false;
}

// Partidos de un jugador en su registro de ESPN (gamelog de una temporada): la
// temporada regular y los playoffs (la pretemporada no), del más reciente al más
// antiguo: [{ start, min, pts, ... }] (sin rebotes ofensivos ni defensivos: el
// registro no los trae).
export function gamesFromGamelog(data) {
  const cols = Object.fromEntries(Object.entries(BOX_COLUMNS).map(([f, alts]) => [f, columnIndex({ names: data?.names, labels: data?.labels }, alts)]));
  const out = [];
  for (const type of data?.seasonTypes || []) {
    if (/pre-?season|pretemporada|all-?star/i.test(type.displayName || type.name || '')) continue;
    for (const cat of type.categories || []) {
      for (const e of cat.events || []) {
        const start = toMs(data.events?.[e.eventId]?.gameDate);
        const row = athleteRow({ stats: e.stats }, cols);
        if (Number.isFinite(start) && !row.dnp) out.push({ start, ...row });
      }
    }
  }
  return out.sort((a, b) => b.start - a.start);
}

// ---- Pedidos (con caché en memoria) ----

const getJson = async (url) => (await fetchData(url, { modes: ['direct'] })).data;

// Guarda la promesa (se comparte entre pedidos simultáneos); si falla, se olvida.
function memo(cache, key, fn, max = Infinity) {
  if (!cache.has(key)) {
    const p = fn();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > max) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

async function pool(items, worker, concurrency = 4) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

const teamsCache = new Map();
function leagueTeams(league) {
  return memo(teamsCache, league, async () => {
    const data = await getJson(`${BASKET_API}/${league}/teams`);
    const teams = (data.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => x.team).filter(Boolean);
    if (!teams.length) throw new Error(`ESPN ${league.toUpperCase()}: sin equipos`);
    return teams;
  });
}

// Box score de un partido terminado (no cambia): se guarda el ya procesado.
const boxCache = new Map();
const summaryBox = (league, id) =>
  memo(boxCache, `${league}|${id}`, async () => boxFromSummary(await getJson(`${BASKET_API}/${league}/summary?event=${id}`)), 400);

// Marcador de un día (date: AAAA-MM-DD o AAAAMMDD) por liga. Se guarda `maxAgeMs`
// (Infinity para una corrida que no necesita ver cambios, como la de GitHub
// Actions); si falla, solo un minuto (para no insistir, pero sin perder la corrida).
const boards = new Map();
const FAIL_MS = 60000;
export function getScoreboard({ league, date, maxAgeMs = 60000 } = {}) {
  checkLeague(league);
  const ymd = String(date || '').replace(/-/g, '');
  const key = `${league}|${ymd}`;
  const hit = boards.get(key);
  if (hit && (hit.failedAt ? Date.now() - hit.failedAt < Math.min(maxAgeMs, FAIL_MS) : Date.now() - hit.at < maxAgeMs)) return hit.promise;
  const url = `${BASKET_API}/${league}/scoreboard?dates=${ymd}`;
  const promise = fetchData(url, { modes: ['direct'] }).then(({ data, mode }) => ({ mode, events: eventsFromScoreboard(data) }));
  const entry = { at: Date.now(), promise };
  promise.catch(() => (entry.failedAt = Date.now())); // el error lo recibe quien espera la promesa
  boards.set(key, entry);
  return promise;
}

// Partido en el marcador del día de `start` (hora de Lima) o del siguiente.
async function scoreboardGame({ league, home, away, start, maxAgeMs }) {
  const day = limaYmd(start);
  for (const date of [day, nextDay(day)]) {
    const { events } = await getScoreboard({ league, date, maxAgeMs });
    const game = findGame(events, home, away, start);
    if (game) return game;
  }
  return null;
}

// Plantel actual de un equipo: [{ id, displayName, shortName }].
const rosterCache = new Map();
const teamRoster = (league, teamId) =>
  memo(rosterCache, `${league}|${teamId}`, async () => {
    const data = await getJson(`${BASKET_API}/${league}/teams/${teamId}/roster`);
    return (data.athletes || [])
      .flatMap((a) => (Array.isArray(a.items) ? a.items : [a]))
      .filter((a) => a?.id != null)
      .map((a) => ({ id: String(a.id), displayName: a.displayName || a.fullName || '', shortName: a.shortName || null }));
  });
// Registro de un jugador en una temporada (no cambia durante el análisis).
const logCache = new Map();
const athleteLog = (league, id, season) =>
  memo(logCache, `${league}|${id}|${season}`, async () => gamesFromGamelog(await getJson(`${WEB_API}/${league}/athletes/${id}/gamelog?season=${season}`)), 400);

// Jugadores pedidos (`names`, los que ofrece la casa) que en los partidos del equipo
// tienen menos de `n`: traspasados, novatos o los que descansaron al cierre de la
// temporada anterior. Se completan con su registro de ESPN de esta temporada y la
// anterior (también los partidos con otro equipo). `out`: bajas [{ id, name }].
async function fillFromGamelogs({ league, team, logs, names, before, n, season, out = [] }) {
  if (!names?.length) return logs;
  let roster;
  try {
    roster = await teamRoster(league, team.id);
  } catch {
    return logs; // sin plantel: quedan los partidos del equipo
  }
  const wanted = roster.filter((a) => names.some((x) => sameAthlete(x, a)));
  const outIds = new Set(out.map((o) => o.id).filter(Boolean));
  const players = [...logs.players];
  const close = (x, y) => Math.abs(x.start - y.start) < 6 * 3600000; // el mismo partido
  await pool(wanted, async (a) => {
    const i = players.findIndex((p) => sameAthlete(p.name, a));
    const games = [...(i >= 0 ? players[i].games : [])];
    if (games.length >= n) return;
    for (const year of [season, season - 1]) {
      if (games.length >= n) break;
      let list = [];
      try {
        list = await athleteLog(league, a.id, year);
      } catch {
        continue; // sin registro de esa temporada
      }
      for (const g of list) if (g.start < before && !games.some((x) => close(x, g))) games.push(g);
      games.sort((x, y) => y.start - x.start);
    }
    const last = games.slice(0, n);
    if (i >= 0) players[i] = { ...players[i], games: last };
    else if (last.length) players.push({ name: a.displayName, short: a.shortName, games: last, out: outIds.has(a.id) });
  });
  return { ...logs, players };
}

// Temporada (año en que termina) si el calendario no la informa.
const seasonOf = (league, ms) => {
  const d = new Date(ms);
  return league === 'nba' && d.getUTCMonth() >= 8 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
};

// Últimos `n` partidos terminados de un equipo antes de `before`: calendario actual y,
// si no alcanzan (p. ej. la NBA en pretemporada), temporada regular actual y anterior.
// regular: el partido a analizar es de la temporada regular (o playoffs); si ESPN
// todavía muestra la pretemporada (los primeros días), esos partidos no cuentan.
async function lastGames(league, teamId, before, n, { regular = false } = {}) {
  const base = `${BASKET_API}/${league}/teams/${teamId}/schedule`;
  const found = new Map();
  const add = (data) => {
    for (const g of finishedGames(data, before)) if (!found.has(g.id)) found.set(g.id, g);
  };
  const first = await getJson(base);
  const season = Number(first.requestedSeason?.year ?? first.season?.year) || seasonOf(league, before);
  const type = Number(first.requestedSeason?.type ?? first.season?.type);
  if (!(regular && type === 1)) add(first);
  const more = [...(type !== 2 ? [`${base}?season=${season}&seasontype=2`] : []), `${base}?season=${season - 1}&seasontype=2`];
  for (const url of more) {
    if (found.size >= n) break;
    try {
      add(await getJson(url));
    } catch {
      // temporada sin calendario
    }
  }
  return [...found.values()].sort((a, b) => b.start - a.start).slice(0, n);
}

// Últimos `n` partidos de los jugadores de ambos equipos (nombres) antes de `start`:
// { mode, home: { team, teamGames, players }, away: {...} } (formato de jugadores del
// contrato). `out` sale de las bajas del partido a analizar si está en el marcador.
// Un equipo que ESPN no tiene (amistosos de pretemporada con clubes de otras ligas)
// queda sin jugadores; el error es solo si no está ninguno de los dos. `names`: los
// jugadores que ofrece la casa; si les faltan partidos con el equipo se completan con
// su registro de ESPN (fillFromGamelogs). regular: el partido no es de pretemporada.
export async function getPlayerLogs({ league, home, away, start, n = 10, names = [], regular = false } = {}) {
  checkLeague(league);
  const before = Number.isFinite(toMs(start)) ? toMs(start) : Date.now();
  const teams = await leagueTeams(league);
  const h = matchEspnTeam(home, teams);
  const a = matchEspnTeam(away, teams);
  if (!h && !a) throw new Error(`ESPN ${league.toUpperCase()}: no se encontraron los equipos ${home} y ${away}`);
  let outs = {};
  try {
    const game = h && a ? await scoreboardGame({ league, home: h.displayName, away: a.displayName, start: before }) : null;
    if (game) {
      const summary = await getJson(`${BASKET_API}/${league}/summary?event=${game.id}`);
      outs = { [h.id]: outFromSummary(summary, h.id), [a.id]: outFromSummary(summary, a.id) };
    }
  } catch {
    // sin bajas
  }
  const side = async (team, name) => {
    if (!team) return { team: name, teamGames: 0, players: [] };
    const list = await lastGames(league, team.id, before, n, { regular });
    const games = [];
    const errors = [];
    await pool(list, async (g) => {
      try {
        games.push({ start: g.start, box: await summaryBox(league, g.id) });
      } catch (e) {
        errors.push(e.message);
      }
    });
    if (list.length && !games.length) throw new Error(`ESPN ${team.displayName}: sin box scores (${errors[0]})`);
    const logs = teamLogs(games, team.id, outs[team.id] || []);
    return { team: team.displayName, ...(await fillFromGamelogs({ league, team, logs, names, before, n, season: seasonOf(league, before), out: outs[team.id] })) };
  };
  const [hs, as] = await Promise.all([side(h, home), side(a, away)]);
  return { mode: 'direct', home: hs, away: as };
}

// Box score del partido (nombres de equipo y hora de inicio): { id, state, score, players }
// con players = { [nombre]: fila } solo si terminó (si no, null). null si no está.
export async function getBoxScore({ league, home, away, start, maxAgeMs = 60000 } = {}) {
  checkLeague(league);
  const ms = toMs(start);
  if (!Number.isFinite(ms)) throw new Error('ESPN: falta la hora de inicio del partido');
  const game = await scoreboardGame({ league, home, away, start: ms, maxAgeMs });
  if (!game) return null;
  // Marcador final orientado como se pidió (el partido puede figurar al revés en ESPN).
  const swapped = !matchEspnTeam(home, [game.home]);
  const [hs, as] = swapped ? [...(game.score || [])].reverse() : game.score || [];
  const score = hs != null && as != null ? { home: hs, away: as } : null;
  if (game.state !== 'finalizado') return { id: game.id, state: game.state, score, players: null };
  const players = playersOfBox(await summaryBox(league, game.id));
  return { id: game.id, state: game.state, score, players: Object.keys(players).length ? players : null };
}

export default {
  id: 'espn',
  name: 'ESPN',
  role: 'Noticias en español, resultados de Liga 1 y jugadores de la NBA y la WNBA',
  async diagnose() {
    const news = await getNews();
    let liga1;
    try {
      liga1 = await getMatches({ league: 'per.1' });
    } catch (e) {
      liga1 = { error: e.message };
    }
    let nba;
    try {
      nba = { teams: (await leagueTeams('nba')).length };
    } catch (e) {
      nba = { error: e.message };
    }
    return {
      mode: news.mode,
      count: news.items.length,
      sample: news.items.slice(0, 5),
      details: { liga1: liga1.error ? liga1 : { count: liga1.items.length, sample: liga1.items.slice(0, 3) }, nba },
    };
  },
};
