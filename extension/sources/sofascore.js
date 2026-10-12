// Sofascore: partidos de todos los deportes, estadísticas previas de cada
// partido (forma, últimos resultados, H2H, bajas, votos, cuotas de referencia),
// estadísticas de los jugadores de básquet (alineaciones) y resultados finales
// para liquidar apuestas.
//
// Primero se intenta el API (rápido). Si no responde, la extensión abre la web
// de Sofascore en una pestaña y lee los datos que la propia web descarga
// (page-hook.js): página del deporte para los partidos del día, página del
// partido para sus estadísticas y, si hace falta, páginas de los equipos.
import { fetchMany, FetchError, scanPage } from '../lib/net.js';
import { findAll, fractionalToDecimal, limaDate } from '../lib/model.js';

const SITE = 'https://www.sofascore.com';
const PAGE = `${SITE}/`;
const API = `${SITE}/api/v1`;
const API_DIRECT = 'https://api.sofascore.com/api/v1';

const limaDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(ms));

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- API ----

// Si el API respondió o no en los últimos 10 minutos (el service worker se
// reinicia seguido, por eso se guarda en chrome.storage.session).
async function apiWorks() {
  const { sofaApi } = await chrome.storage.session.get('sofaApi');
  return sofaApi && Date.now() - sofaApi.at < 10 * 60000 ? sofaApi.works : null;
}
const setApiWorks = (works) => chrome.storage.session.set({ sofaApi: { works, at: Date.now() } });

// api.sofascore.com directo y luego www.sofascore.com (directo y en pestaña).
// `required(path)`: peticiones que deben existir; si todas fallan, el API no sirve.
async function apiMany(paths, required = () => false) {
  const notes = [];
  const reqs = (base) => paths.map((p) => ({ url: base + p, required: required(p) }));
  const failed = (results) => {
    const idx = paths.map((p, j) => (required(p) ? j : -1)).filter((j) => j >= 0);
    return idx.length ? idx.every((j) => !results[j].ok) : results.filter((r) => !r.ok).length > results.length / 2;
  };
  for (const [base, modes, label] of [
    [API_DIRECT, ['direct'], 'api.sofascore.com'],
    [API, ['direct', 'tab'], 'www.sofascore.com'],
  ]) {
    try {
      const r = await fetchMany(reqs(base), { pageUrl: PAGE, modes });
      notes.push(...r.notes.map((n) => `${label} ${n}`));
      if (!failed(r.results)) return { ...r, notes };
      const bad = r.results.find((x) => !x.ok);
      notes.push(`${label} ${r.mode}: ${bad?.error || 'sin datos'}`);
    } catch (e) {
      notes.push(`${label}: ${e.message}`);
    }
  }
  return { results: null, notes };
}

// ---- Formato común ----

const STATE = {
  notstarted: 'pendiente',
  inprogress: 'en_vivo',
  finished: 'finalizado',
  postponed: 'aplazado',
  canceled: 'cancelado',
  interrupted: 'interrumpido',
  suspended: 'interrumpido',
};

function team(t = {}) {
  return {
    id: t.id,
    name: t.name || '',
    short: t.shortName || t.name || '',
    slug: t.slug || null,
    alpha2: t.country?.alpha2 || null,
    ranking: t.ranking ?? null,
    national: Boolean(t.national),
  };
}

const score = (s) => (s?.current == null ? null : s);

export function toEvent(e, sport) {
  const ut = e.tournament?.uniqueTournament;
  const cat = e.tournament?.category || {};
  const hs = score(e.homeScore);
  const as = score(e.awayScore);
  return {
    id: e.id,
    sport: sport || cat.sport?.slug || null,
    start: e.startTimestamp * 1000,
    tournament: {
      id: ut?.id ?? e.tournament?.id ?? null,
      name: ut?.name || e.tournament?.name || '',
      priority: e.tournament?.priority ?? ut?.priority ?? 0,
    },
    category: { id: cat.id ?? null, name: cat.name || '', alpha2: cat.alpha2 || cat.country?.alpha2 || null },
    home: team(e.homeTeam),
    away: team(e.awayTeam),
    state: STATE[e.status?.type] || 'otro',
    statusText: e.status?.description || '',
    score: hs && as ? { home: hs.current, away: as.current, homeNT: hs.normaltime ?? null, awayNT: as.normaltime ?? null } : null,
    winner: e.winnerCode ?? null,
    url: e.slug && e.customId ? `${SITE}/${e.slug}/${e.customId}#id:${e.id}` : null,
  };
}

// Un partido de Sofascore dentro de cualquier JSON.
const isSofaEvent = (o) =>
  typeof o.id === 'number' && typeof o.startTimestamp === 'number' && o.homeTeam?.name != null && o.awayTeam?.name != null;

function eventsIn(responses) {
  const map = new Map();
  for (const r of responses) for (const e of findAll(r.data, isSofaEvent)) map.set(e.id, e);
  return [...map.values()];
}

// Rutas de API que usó la web (sin números), para el diagnóstico.
function apiPaths(responses) {
  return [
    ...new Set(
      responses.map((r) => {
        try {
          const u = new URL(r.url);
          return `${u.hostname}${u.pathname.replace(/\d{3,}/g, '{n}').replace(/\d{4}-\d{2}-\d{2}/g, '{fecha}')}`;
        } catch {
          return r.url;
        }
      }),
    ),
  ];
}

// ---- Partidos del día ----

function eventsForDay(raws, sport, date) {
  const out = new Map();
  for (const e of raws) {
    const slug = e.tournament?.category?.sport?.slug;
    if (slug && slug !== sport) continue;
    if (limaDay(e.startTimestamp * 1000) !== date || out.has(e.id)) continue;
    out.set(e.id, toEvent(e, sport));
  }
  return [...out.values()].sort((a, b) => a.start - b.start);
}

// Partidos de un deporte para un día en hora de Lima.
export async function getSportEvents({ sport = 'football', date = limaDate() } = {}) {
  const notes = [];
  if ((await apiWorks()) !== false) {
    // Sofascore agrupa por día UTC: se piden dos días y se filtra por Lima.
    const r = await apiMany([`/sport/${sport}/scheduled-events/${date}`, `/sport/${sport}/scheduled-events/${addDays(date, 1)}`], () => true);
    notes.push(...r.notes);
    if (r.results) {
      await setApiWorks(true);
      const raws = r.results.flatMap((x) => (x.ok ? x.data.events || [] : []));
      return { mode: r.mode, notes, items: eventsForDay(raws, sport, date) };
    }
    await setApiWorks(false);
  }
  // Abrir la web: página del deporte en ese día (y la de hoy como respaldo).
  const pages = [`${SITE}/${sport}/${date}`];
  if (date === limaDate()) pages.push(`${SITE}/${sport}`);
  let lastScan = null;
  for (const url of pages) {
    try {
      const scan = await scanPage(url, { waitMs: 20000, scrolls: 6 });
      lastScan = scan;
      const items = eventsForDay(eventsIn(scan.responses), sport, date);
      notes.push(`web ${url}: ${items.length} partidos`);
      if (items.length) return { mode: 'scan', notes, items, scan: { page: scan.url, apiPaths: apiPaths(scan.responses) } };
    } catch (e) {
      notes.push(`web ${url}: ${e.message}`);
    }
  }
  return { mode: 'scan', notes, items: [], scan: lastScan && { page: lastScan.url, title: lastScan.title, hooked: lastScan.hooked, apiPaths: apiPaths(lastScan.responses) } };
}

// ---- Estadísticas de cada partido ----

// Últimos partidos jugados por un equipo, del más reciente al más antiguo.
// En fútbol se usa el marcador de los 90 minutos (sin prórroga ni penales).
function lastMatches(events, teamId, sport, before) {
  const regular = sport === 'football' || sport === 'futsal';
  return (events || [])
    .filter((e) => (e.homeTeam?.id === teamId || e.awayTeam?.id === teamId) && e.status?.type === 'finished' && e.startTimestamp * 1000 < before)
    .sort((a, b) => b.startTimestamp - a.startTimestamp)
    .slice(0, 15)
    .map((e) => {
      const isHome = e.homeTeam?.id === teamId;
      const pick = (s) => (regular ? s?.normaltime ?? s?.current : s?.current) ?? null;
      const [hs, as] = [pick(e.homeScore), pick(e.awayScore)];
      const gf = isHome ? hs : as;
      const ga = isHome ? as : hs;
      let r;
      if (regular && gf != null && ga != null) r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      else r = e.winnerCode === 3 ? 'D' : e.winnerCode === (isHome ? 1 : 2) ? 'W' : 'L';
      return {
        id: e.id,
        start: e.startTimestamp * 1000,
        home: isHome,
        gf,
        ga,
        r,
        opp: (isHome ? e.awayTeam : e.homeTeam)?.name || '',
        league: e.tournament?.uniqueTournament?.name || e.tournament?.name || '',
      };
    });
}

function missingPlayers(side) {
  return (side?.missingPlayers || []).map((m) => ({
    player: m.player?.name || m.player?.shortName || '',
    position: m.player?.position || '',
    type: m.type || '', // "missing" (baja segura) o "doubtful" (duda)
    reason: m.description || '',
  }));
}

function oddsMarkets(data) {
  return (data?.markets || []).map((m) => ({
    name: m.marketName || '',
    group: m.choiceGroup ?? null,
    live: Boolean(m.isLive),
    choices: (m.choices || []).map((c) => ({ name: String(c.name), price: fractionalToDecimal(c.fractionalValue) })).filter((c) => c.price > 1),
  }));
}

function votes(data) {
  const v = data?.vote;
  if (!v) return null;
  const total = (v.vote1 || 0) + (v.voteX || 0) + (v.vote2 || 0);
  return total ? { home: (v.vote1 || 0) / total, draw: (v.voteX || 0) / total, away: (v.vote2 || 0) / total, total } : null;
}

// Arma las estadísticas de un partido con las piezas encontradas.
function buildDetails(ev, parts, events) {
  const form = parts.form;
  const duel = parts.h2h?.teamDuel;
  return {
    form: form
      ? {
          home: { form: form.homeTeam?.form || [], position: form.homeTeam?.position ?? null, avgRating: Number(form.homeTeam?.avgRating) || null },
          away: { form: form.awayTeam?.form || [], position: form.awayTeam?.position ?? null, avgRating: Number(form.awayTeam?.avgRating) || null },
        }
      : null,
    h2h: duel ? { homeWins: duel.homeWins || 0, draws: duel.draws || 0, awayWins: duel.awayWins || 0 } : null,
    missing: parts.lineups ? { home: missingPlayers(parts.lineups.home), away: missingPlayers(parts.lineups.away), confirmed: Boolean(parts.lineups.confirmed) } : null,
    odds: parts.odds ? oddsMarkets(parts.odds) : null,
    votes: votes(parts.votes),
    lastHome: lastMatches(events.home, ev.homeId, ev.sport, ev.start),
    lastAway: lastMatches(events.away, ev.awayId, ev.sport, ev.start),
  };
}

const DETAIL_PARTS = { form: 'pregame-form', h2h: 'h2h', lineups: 'lineups', odds: 'odds/1/all', votes: 'votes' };

async function detailsFromApi(events) {
  const paths = [];
  const index = [];
  const teamIdx = new Map();
  for (const ev of events) {
    for (const [key, part] of Object.entries(DETAIL_PARTS)) {
      index.push({ ev: ev.id, key });
      paths.push(`/event/${ev.id}/${part}`);
    }
    for (const id of [ev.homeId, ev.awayId]) {
      if (id && !teamIdx.has(id)) {
        teamIdx.set(id, paths.length);
        index.push({ team: id });
        paths.push(`/team/${id}/events/last/0`);
      }
    }
  }
  const r = await apiMany(paths, (p) => p.startsWith('/team/'));
  if (!r.results) return { notes: r.notes };
  const parts = {};
  r.results.forEach((x, i) => {
    const { ev, key } = index[i];
    if (ev && x.ok) (parts[ev] ||= {})[key] = x.data;
  });
  const teamEvents = (id) => (teamIdx.has(id) && r.results[teamIdx.get(id)].ok ? r.results[teamIdx.get(id)].data.events || [] : []);
  const items = {};
  for (const ev of events) items[ev.id] = buildDetails(ev, parts[ev.id] || {}, { home: teamEvents(ev.homeId), away: teamEvents(ev.awayId) });
  await addTeamMatchStats(events, items, r.notes);
  return { mode: r.mode, items, notes: r.notes };
}

// Estadísticas (córners, tarjetas, tiros, rebotes, aces...) de los últimos
// partidos de cada equipo: solo el total del partido, reducido a { key, home, away }.
// La página las convierte en promedios (docs/js/analysis/teamstats.js).
const STAT_SPORTS = new Set(['football', 'basketball', 'ice-hockey', 'tennis', 'baseball', 'american-football', 'handball']);
const TEAM_STAT_MATCHES = 5;
const statsCache = new Map(); // id de partido -> estadísticas reducidas (no cambian)
function reduceStatistics(data) {
  const all = (data?.statistics || []).find((b) => b.period === 'ALL');
  if (!all) return null;
  const items = [];
  for (const g of all.groups || []) for (const it of g.statisticsItems || []) items.push({ key: it.key, homeValue: it.homeTotal ?? it.homeValue, awayValue: it.awayTotal ?? it.awayValue });
  return items.length ? { statistics: [{ period: 'ALL', groups: [{ statisticsItems: items }] }] } : null;
}
async function addTeamMatchStats(events, items, notes) {
  const want = new Map();
  for (const ev of events) {
    if (!STAT_SPORTS.has(ev.sport) || !items[ev.id]) continue;
    for (const side of ['lastHome', 'lastAway']) for (const m of items[ev.id][side].slice(0, TEAM_STAT_MATCHES)) if (m.id && !statsCache.has(m.id)) want.set(m.id, true);
  }
  const ids = [...want.keys()];
  if (ids.length) {
    try {
      const r = await apiMany(ids.map((id) => `/event/${id}/statistics`));
      (r.results || []).forEach((x, i) => statsCache.set(ids[i], x.ok ? reduceStatistics(x.data) : null));
    } catch (e) {
      notes.push(`estadísticas de los últimos partidos: ${e.message}`);
    }
  }
  for (const ev of events) {
    const d = items[ev.id];
    if (!d || !STAT_SPORTS.has(ev.sport)) continue;
    const pick = (list) => list.slice(0, TEAM_STAT_MATCHES).map((m) => ({ home: m.home, statistics: statsCache.get(m.id) || null })).filter((m) => m.statistics);
    d.teamMatches = { home: pick(d.lastHome), away: pick(d.lastAway) };
  }
}

// Estadísticas de un partido leyendo su página (y las de los equipos si faltan
// sus últimos resultados).
async function detailsFromWeb(ev) {
  const pick = (responses, test) => responses.find((r) => test(r.url, r.data))?.data;
  const scan = await scanPage(ev.url, { waitMs: 15000, scrolls: 2 });
  const rs = scan.responses;
  const parts = {
    form: pick(rs, (u, d) => u.includes('/pregame-form') && (d.homeTeam || d.awayTeam)),
    h2h: pick(rs, (u, d) => /\/h2h(\?|$)/.test(u) && d.teamDuel),
    lineups: pick(rs, (u, d) => u.includes('/lineups') && (d.home || d.away)),
    odds: rs.filter((r) => r.url.includes('/odds') && Array.isArray(r.data?.markets)).sort((a, b) => b.data.markets.length - a.data.markets.length)[0]?.data,
    votes: pick(rs, (u, d) => u.includes('/votes') && d.vote),
  };
  let all = eventsIn(rs);
  const paths = apiPaths(rs);
  // Si la página del partido no trae los últimos resultados de un equipo, se abre la del equipo.
  for (const [id, slug] of [
    [ev.homeId, ev.homeSlug],
    [ev.awayId, ev.awaySlug],
  ]) {
    // Los enfrentamientos directos pueden ser de hace años: solo cuentan los recientes.
    const recent = lastMatches(all, id, ev.sport, ev.start).filter((m) => ev.start - m.start < 120 * 86400000);
    if (!id || !slug || recent.length >= 5) continue;
    try {
      const teamScan = await scanPage(`${SITE}/team/${ev.sport}/${slug}/${id}`, { waitMs: 12000, scrolls: 1 });
      all = [...all, ...eventsIn(teamScan.responses)];
      paths.push(...apiPaths(teamScan.responses));
    } catch {
      // sin la página del equipo se sigue con lo que haya
    }
  }
  return { details: buildDetails(ev, parts, { home: all, away: all }), apiPaths: [...new Set(paths)] };
}

// events: [{ id, sport, homeId, awayId, start, url, homeSlug, awaySlug }]
export async function getEventDetails({ events = [] } = {}) {
  let notes = [];
  if ((await apiWorks()) !== false) {
    const r = await detailsFromApi(events);
    notes = r.notes;
    if (r.items) return { mode: r.mode, items: r.items, failed: 0, notes };
  }
  const items = {};
  const paths = new Set();
  let failed = 0;
  for (const ev of events) {
    if (!ev.url) {
      failed++;
      continue;
    }
    try {
      const { details, apiPaths: p } = await detailsFromWeb(ev);
      items[ev.id] = details;
      p.forEach((x) => paths.add(x));
    } catch (e) {
      failed++;
      notes.push(`web ${ev.id}: ${e.message}`);
    }
  }
  return { mode: 'scan', items, failed, notes, apiPaths: [...paths] };
}

// ---- Jugadores (básquet) ----

const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const firstNum = (s, keys) => keys.map((k) => num(s[k])).find((v) => v != null) ?? null;
const addOrNull = (a, b) => (a == null || b == null ? null : a + b);
// Nombre comparable: sin tildes ni mayúsculas.
const nameKey = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Minutos jugados: secondsPlayed (segundos) o minutesPlayed (número o "MM:SS").
function minutesOf(s) {
  const secs = num(s.secondsPlayed);
  if (secs != null) return secs / 60;
  const m = s.minutesPlayed;
  if (typeof m === 'string' && m.includes(':')) {
    const [a, b] = m.split(':').map(num);
    return a == null || b == null ? null : a + b / 60;
  }
  return num(m);
}

// Estadísticas de un jugador en un partido (alineación de Sofascore) en el formato
// común { min, pts, reb, ast, tpm, stl, blk, tov, oreb, dreb, ftm, fgm } (null si
// falta el dato) o { min: 0, dnp: true } si no jugó: sin estadísticas, 0 segundos o,
// sin minutos, todo en cero (las ligas sin minutos marcan así a los que no jugaron).
export function playerRow(statistics) {
  const s = statistics && typeof statistics === 'object' ? statistics : {};
  const raw = minutesOf(s);
  const min = raw == null ? null : Math.round(raw * 100) / 100;
  const oreb = num(s.offensiveRebounds);
  const dreb = num(s.defensiveRebounds);
  const tpm = firstNum(s, ['threePointsMade', 'threePointersMade', 'threePointFieldGoalsMade']);
  const row = {
    min,
    pts: num(s.points),
    reb: firstNum(s, ['rebounds', 'totalRebounds']) ?? addOrNull(oreb, dreb),
    ast: num(s.assists),
    tpm,
    stl: num(s.steals),
    blk: firstNum(s, ['blocks', 'blockedShots']),
    tov: num(s.turnovers),
    oreb,
    dreb,
    ftm: num(s.freeThrowsMade),
    fgm: num(s.fieldGoalsMade) ?? addOrNull(num(s.twoPointsMade), tpm),
  };
  if (min != null ? min <= 0 : Object.values(row).every((v) => !v)) return { min: 0, dnp: true };
  return row;
}

// Jugadores de un lado ('home' | 'away') de la respuesta de /event/{id}/lineups:
// [{ id, name, short, row }] con row en el formato común.
export function playersFromLineups(lineups, side) {
  const out = [];
  const seen = new Set();
  for (const p of lineups?.[side]?.players || []) {
    const name = p?.player?.name || p?.player?.shortName || '';
    const key = p?.player?.id ?? nameKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const short = p.player.shortName && p.player.shortName !== name ? p.player.shortName : null;
    out.push({ id: p.player.id ?? null, name, short, row: playerRow(p.statistics) });
  }
  return out;
}

// Un lado sin nadie con estadísticas (liga sin box score) no sirve: no son bajas.
function sideWithStats(lineups, side) {
  const list = playersFromLineups(lineups, side);
  return list.some((p) => !p.row.dnp) ? list : [];
}

// Alineación reducida de un partido terminado (lo que se guarda en caché).
const teamIdOf = (side) => (side?.players || []).find((p) => p?.teamId != null)?.teamId ?? null;
export function reduceLineups(lineups) {
  return { home: sideWithStats(lineups, 'home'), away: sideWithStats(lineups, 'away'), homeTeam: teamIdOf(lineups?.home), awayTeam: teamIdOf(lineups?.away) };
}

// Box score para liquidar: { [nombre]: fila } de ambos equipos. Las bajas del partido
// que no están en la lista van como no jugados (la casa anula esas apuestas).
export function boxScoreFromLineups(lineups) {
  const out = {};
  for (const side of ['home', 'away']) {
    const list = sideWithStats(lineups, side);
    if (!list.length) continue;
    for (const p of list) if (!out[p.name] || out[p.name].dnp) out[p.name] = p.row;
    for (const m of lineups[side].missingPlayers || []) if (m?.player?.name && !out[m.player.name]) out[m.player.name] = { min: 0, dnp: true };
  }
  return out;
}

// Del más reciente al más antiguo (los que no traen fecha quedan en su orden, al final).
const recentFirst = (list) => (list || []).filter((m) => m?.id != null).sort((a, b) => (b.start ?? -Infinity) - (a.start ?? -Infinity));

// Últimos partidos de los jugadores de un equipo.
//   games: [{ id, home, start? }] últimos partidos del equipo (home: si fue local);
//   lineupsOf(id): alineación reducida (reduceLineups) o null;
//   teamId: para saber el lado si falta `home`; missing: missingPlayers del partido a analizar.
// → { teamGames, players: [{ name, short, games: [{ start, min, pts, ... }], out, doubtful }] }
//   teamGames: partidos revisados (con estadísticas del equipo); games: solo los que jugó,
//   del más reciente al más antiguo; players por minutos promedio (en teamGames), desc.
//   out: baja segura; doubtful: en duda (no cuenta como baja).
export function teamPlayerLogs(games, lineupsOf, { teamId = null, missing = [], n = 10 } = {}) {
  const byKey = new Map();
  let teamGames = 0;
  for (const g of recentFirst(games).slice(0, n)) {
    const lu = lineupsOf(g.id);
    if (!lu) continue;
    let side = null;
    if (typeof g.home === 'boolean') side = g.home ? 'home' : 'away';
    else if (teamId != null) side = lu.homeTeam === teamId ? 'home' : lu.awayTeam === teamId ? 'away' : null;
    const list = (side && lu[side]) || [];
    if (!list.length) continue;
    teamGames++;
    for (const p of list) {
      const key = p.id ?? nameKey(p.name);
      if (!byKey.has(key)) byKey.set(key, { id: p.id, name: p.name, short: p.short, games: [] });
      if (!p.row.dnp) byKey.get(key).games.push({ start: g.start ?? null, ...p.row });
    }
  }
  const flagged = (type) => {
    const list = (missing || []).filter((m) => m?.player && (type === 'doubtful') === (m.type === 'doubtful'));
    return { ids: new Set(list.map((m) => m.player.id).filter((x) => x != null)), names: new Set(list.map((m) => nameKey(m.player.name)).filter(Boolean)) };
  };
  const out = flagged('missing');
  const doubt = flagged('doubtful');
  const is = (set, p) => (p.id != null && set.ids.has(p.id)) || set.names.has(nameKey(p.name));
  const avgMin = (p) => p.games.reduce((a, g) => a + (g.min || 0), 0) / Math.max(1, teamGames);
  const players = [...byKey.values()]
    .filter((p) => p.games.length)
    .sort((a, b) => avgMin(b) - avgMin(a) || b.games.length - a.games.length)
    .map((p) => ({ name: p.name, short: p.short, games: p.games, out: is(out, p), doubtful: !is(out, p) && is(doubt, p) }));
  return { teamGames, players };
}

const LINEUPS_CACHE_MAX = 1500;
const lineupsCache = new Map(); // id de partido terminado -> alineación reducida o null (no cambia)
function cacheLineups(id, value) {
  lineupsCache.delete(id);
  lineupsCache.set(id, value);
  if (lineupsCache.size > LINEUPS_CACHE_MAX) lineupsCache.delete(lineupsCache.keys().next().value);
}

// Últimos partidos de los jugadores de ambos equipos (ligas que ESPN no tiene).
// events: [{ id, homeId, awayId, start, lastHome: [{ id, home, start? }], lastAway }] (de getEventDetails).
// → { mode, items: { [id]: { home: { teamGames, players }, away: {...} } }, notes }
// Pide /event/{id}/lineups de los últimos `n` partidos de cada equipo (en caché) y del
// partido a analizar (sus bajas).
export async function getPlayerLogs({ events = [], n = 10 } = {}) {
  const k = Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
  const notes = [];
  const known = new Map();
  const past = new Set();
  for (const ev of events) {
    for (const m of [...recentFirst(ev.lastHome).slice(0, k), ...recentFirst(ev.lastAway).slice(0, k)]) {
      const id = String(m.id);
      if (lineupsCache.has(id)) known.set(id, lineupsCache.get(id));
      else past.add(id);
    }
  }
  const current = [...new Set(events.map((ev) => String(ev.id)))].filter((id) => !past.has(id));
  const ids = [...past, ...current];
  const now = {};
  let mode = null;
  let failed = false;
  if (ids.length) {
    // Los partidos terminados deben tener alineación: si ninguna llega, se prueba otra vía.
    const r = await apiMany(
      ids.map((id) => `/event/${id}/lineups`),
      (p) => past.has(p.split('/')[2]),
    );
    notes.push(...r.notes);
    mode = r.mode ?? null;
    failed = !r.results;
    (r.results || []).forEach((x, i) => {
      const id = ids[i];
      if (past.has(id) && (x.ok || x.status === 404)) {
        const lu = x.ok ? reduceLineups(x.data) : null; // 404: el partido no tiene alineación
        known.set(id, lu);
        cacheLineups(id, lu);
      } else if (x.ok) now[id] = x.data;
    });
  }
  const lineupsOf = (id) => known.get(String(id)) || null;
  const items = {};
  for (const ev of events) {
    const lu = now[String(ev.id)];
    const team = (side, teamId, games) => teamPlayerLogs(games, lineupsOf, { teamId, missing: lu?.[side]?.missingPlayers || [], n: k });
    items[ev.id] = { home: team('home', ev.homeId, ev.lastHome), away: team('away', ev.awayId, ev.lastAway) };
  }
  if (failed && !Object.values(items).some((x) => x.home.players.length || x.away.players.length)) {
    throw new FetchError(`Sofascore no devolvió alineaciones. Intentos: ${notes.join(' | ') || 'ninguno'}`, { mode });
  }
  return { mode, items, notes };
}

// ---- Resultados ----

function resultOf(e) {
  const ev = toEvent(e, null);
  return { state: ev.state, score: ev.score, winner: ev.winner };
}

// Estado y marcador final de varios partidos (para liquidar apuestas).
// urls (opcional): { id: url de la página del partido } para leerla si el API no responde.
// detail: ids de los que además se quieren estadísticas e incidencias (para
// mercados de córners, tarjetas, minuto del gol...). Se devuelven sin procesar
// en items[id].raw = { event, statistics, incidents } (la página arma el registro).
// players: ids (básquet) de los que además se quiere el box score de los jugadores:
// items[id].players = { [nombre]: fila } de ambos equipos (ver boxScoreFromLineups).
export async function getEventResults({ ids = [], urls = {}, detail = [], players = [] } = {}) {
  const box = new Set((players || []).map(String));
  const items = {};
  if ((await apiWorks()) !== false) {
    const r = await apiMany(
      ids.map((id) => `/event/${id}`),
      () => true,
    );
    if (r.results) {
      r.results.forEach((x, i) => x.ok && x.data?.event && (items[ids[i]] = resultOf(x.data.event)));
      const want = detail.map(String).filter((id) => items[id]?.state === 'finalizado');
      if (want.length) {
        const extra = await apiMany(want.flatMap((id) => [`/event/${id}/statistics`, `/event/${id}/incidents`]));
        want.forEach((id, i) => {
          const event = r.results[ids.map(String).indexOf(id)].data.event;
          const st = extra.results?.[2 * i];
          const inc = extra.results?.[2 * i + 1];
          items[id].raw = { event, statistics: st?.ok ? st.data : null, incidents: inc?.ok ? inc.data : null };
        });
      }
      const boxIds = [...box].filter((id) => items[id]?.state === 'finalizado');
      if (boxIds.length) {
        // Sin `required` (como las estadísticas): un 404 no abre una pestaña del sitio.
        const lu = await apiMany(boxIds.map((id) => `/event/${id}/lineups`));
        boxIds.forEach((id, i) => {
          const x = lu.results?.[i];
          const rows = x?.ok ? boxScoreFromLineups(x.data) : {};
          if (Object.keys(rows).length) items[id].players = rows;
        });
      }
      return { mode: r.mode, items };
    }
  }
  for (const id of ids) {
    if (!urls[id]) continue;
    try {
      const scan = await scanPage(urls[id], { waitMs: 12000 });
      const e = eventsIn(scan.responses).find((x) => x.id === Number(id));
      if (e) items[id] = resultOf(e);
      // Box score si la página descargó la alineación.
      const lu = scan.responses.find((x) => x.url.includes(`/event/${id}/lineups`) && (x.data?.home || x.data?.away))?.data;
      const rows = e && box.has(String(id)) && items[id].state === 'finalizado' && lu ? boxScoreFromLineups(lu) : {};
      if (Object.keys(rows).length) items[id].players = rows;
    } catch {
      // se reintentará en la próxima actualización
    }
  }
  return { mode: 'scan', items };
}

// Compatibilidad con la primera versión del diagnóstico.
export async function getMatches({ date = limaDate() } = {}) {
  return getSportEvents({ sport: 'football', date });
}

export default {
  id: 'sofascore',
  name: 'Sofascore',
  role: 'Partidos de todos los deportes, forma, H2H, bajas y lesiones',
  async diagnose() {
    const { mode, items, notes, scan } = await getSportEvents({ sport: 'football' });
    // Siempre hay partidos de fútbol: una lista vacía significa que algo falló.
    if (!items.length) {
      const err = new FetchError(`Sofascore no devolvió partidos de fútbol para hoy. Intentos: ${notes.join(' | ') || 'ninguno'}`, { mode });
      err.attempts = [{ scan }];
      throw err;
    }
    const upcoming = items.find((m) => m.state === 'pendiente') || items[0];
    const ev = {
      id: upcoming.id,
      sport: 'football',
      homeId: upcoming.home.id,
      awayId: upcoming.away.id,
      homeSlug: upcoming.home.slug,
      awaySlug: upcoming.away.slug,
      start: upcoming.start,
      url: upcoming.url,
    };
    const r = await getEventDetails({ events: [ev] });
    const d = r.items[upcoming.id];
    const details = {
      partido: `${upcoming.home.name} vs ${upcoming.away.name}`,
      modoEstadisticas: r.mode,
      notasEstadisticas: r.notes,
      forma: d?.form,
      h2h: d?.h2h,
      bajas: d?.missing,
      votos: d?.votes,
      mercadosCuotas: (d?.odds || []).map((m) => `${m.name}${m.group ? ` ${m.group}` : ''}`).slice(0, 15),
      ultimosLocal: d?.lastHome.slice(0, 3),
      ultimosVisita: d?.lastAway.slice(0, 3),
      cantidadUltimos: d ? [d.lastHome.length, d.lastAway.length] : null,
      rutasWebPartido: r.apiPaths,
    };
    let basket = null;
    try {
      basket = (await getSportEvents({ sport: 'basketball' })).items.length;
    } catch (e) {
      basket = e.message;
    }
    const sample = items.slice(0, 5).map((e) => ({
      start: new Date(e.start).toISOString(),
      league: e.tournament.name,
      country: e.category.name,
      home: e.home.name,
      away: e.away.name,
      status: e.state,
      score: e.score,
    }));
    return { mode, count: items.length, sample, details: { intentosPrevios: notes, rutasWebLista: scan?.apiPaths, ...details, partidosBasquet: basket } };
  },
};
