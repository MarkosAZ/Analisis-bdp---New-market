// Análisis de los partidos seleccionados:
//  1) Estadísticas: de Sofascore (forma, últimos partidos, H2H, bajas, votos y
//     cuotas de referencia, vía la extensión) o de los datos automáticos que
//     publica GitHub Actions (partidos "fs:" de Flashscore: últimos partidos y H2H).
//  2) Cuotas de Apuesta Total y Betano (emparejando cada partido). Sin la
//     extensión se usan las cuotas de Apuesta Total publicadas cada 2 horas.
//  3) xG de Understat (fútbol, 5 grandes ligas).
//  4) Solo los mercados de picks.MARKETS y, en cada casa, su línea .5 más
//     pareja (la de menos diferencia entre sus dos cuotas).
//  5) Probabilidad de cada selección con la estadística: modelo de goles o de
//     puntos, promedios de los equipos (córners, tarjetas, tiros) o partidos
//     simulados (1.er tiempo del básquet). Las cuotas no la cambian.
//  6) Red neuronal (opcional): corrige esa probabilidad.
//  7) Picks por nivel de confianza y combinadas.
import * as ext from '../ext.js';
import * as provider from '../provider.js';
import { addTeamStats } from '../flashscore-link.js';
import { sportOf } from '../sports.js';
import { clamp, groupBy, limaDateOf } from '../util.js';
import { buildFeatures, FEATURE_VERSION } from './features.js';
import {
  balancedLines,
  BETTABLE,
  candidateKey,
  isHalfLine,
  marketProbabilities,
  offeredPlayers,
  offersFromApuestaTotal,
  offersFromBetano,
  offersFromSofascore,
  pricesByKey,
  selectionLabel,
} from './markets.js';
import { familyOf, parseMarketId, STAT_NAME } from './catalog.js';
import { bestByName, matchEvent } from './matching.js';
import { predict } from './models.js';
import { acceptsOffer, BOOKMAKERS, buildCombos, DEFAULT_SETTINGS, isPlayerMarket, selectPicks } from './picks.js';
import { networkOf } from './networks.js';
import { basketballLeague, isPreseason, matchPlayer, playerProbability, statValue } from './players.js';
import { estimate, simParams } from './simulate.js';
import { MIN_MATCHES, statProbability } from './stats.js';
import { xgFromTeamStats } from './teamstats.js';
import { newsFeatures, prepareNews } from './news.js';

// Ligas de Understat según el id de torneo de Sofascore.
const UNDERSTAT_LEAGUES = { 17: 'EPL', 8: 'La_liga', 35: 'Bundesliga', 23: 'Serie_A', 34: 'Ligue_1' };
const DETAILS_PER_CALL = 5;

function bestPrice(prices) {
  let best = null;
  for (const source of BETTABLE) if (prices[source] > 1 && (!best || prices[source] > best.price)) best = { source, price: prices[source] };
  return best;
}

function formText(f) {
  if (!f?.last5?.length) return '';
  return f.last5.map((r) => ({ W: 'G', D: 'E', L: 'P' })[r]).join('');
}

const SIDE_NAME = { over: 'Más', under: 'Menos', yes: 'Sí', no: 'No' };
const VIA = { modelo: 'Modelo', estadísticas: 'Promedios de los equipos', simulación: 'Simulación', jugador: 'Últimos partidos del jugador' };

// Cuotas de la línea elegida en cada casa ("Apuesta Total Más 1.85 / Menos 1.95").
function lineText(ev, c, chosen) {
  const parts = [];
  for (const source of BETTABLE) {
    const pair = chosen.filter((o) => o.source === source && o.market === c.market && o.line === c.line);
    if (pair.length !== 2) continue;
    const name = (o) => SIDE_NAME[o.sel] || (o.sel === 'home' ? ev.home.name : ev.away.name);
    parts.push(`${BOOKMAKERS[source]} ${pair.map((o) => `${name(o)} ${o.price.toFixed(2)}`).join(' / ')}`);
  }
  return parts.length ? `Línea más pareja: ${parts.join(' · ')}` : null;
}

const round1 = (x) => (Math.round(x * 10) / 10).toString();

// Datos de un pick de jugador: su promedio, sus últimos valores y la línea.
function playerFactors(c, cand, chosen, ev) {
  const r = c.extra;
  const pl = c.player;
  const what = STAT_NAME[c.spec.stat] || c.spec.stat;
  const last = pl.games.slice(0, 5).map((g) => statValue(g, c.spec.stat)).filter((v) => v != null);
  return [
    `${pl.name} (${pl.side === 'home' ? ev.home.name : ev.away.name}): ${round1(r.mean)} ${what} por partido en sus últimos ${r.n} (desvío ${round1(r.sd)}) · ${round1(r.minutes)} min`,
    last.length ? `Últimos ${last.length} partidos: ${last.join(', ')}` : null,
    lineText(ev, cand, chosen),
    cand.pMarket != null ? `Según las cuotas (solo referencia): ${Math.round(cand.pMarket * 100)}%` : null,
    `${VIA.jugador}: ${Math.round(cand.pModel * 100)}%`,
  ].filter(Boolean);
}

// Datos que explican el pick (se muestran en la tarjeta).
function factorsFor(ev, d, model, c, chosen = []) {
  const out = [];
  const fh = model?.form?.home;
  const fa = model?.form?.away;
  if (fh && fa) out.push(`Forma: ${ev.home.name} ${formText(fh)} · ${ev.away.name} ${formText(fa)}`);
  const e = model?.expected;
  if (e && model.kind === 'goals') out.push(`Esperado: ${e.home.toFixed(2)} – ${e.away.toFixed(2)}${e.xg ? ' (con xG)' : ''}`);
  if (e && model.kind === 'points') out.push(`Esperado: ${e.home.toFixed(0)} – ${e.away.toFixed(0)} (total ${e.total.toFixed(1)})`);
  if (d?.h2h && d.h2h.homeWins + d.h2h.draws + d.h2h.awayWins > 0) out.push(`H2H: ${d.h2h.homeWins}-${d.h2h.draws}-${d.h2h.awayWins}`);
  if (ev.home.ranking && ev.away.ranking) out.push(`Ranking: ${ev.home.ranking} vs ${ev.away.ranking}`);
  const miss = d?.missing;
  if (miss && (miss.home.length || miss.away.length)) out.push(`Bajas: ${miss.home.length} local · ${miss.away.length} visita`);
  // Mercados simulados: promedios de cada equipo en la estadística del mercado.
  const spec = parseMarketId(c.market);
  const ts = d?.teamStats;
  const st = spec && spec.stat !== 'score' ? spec.stat : null;
  if (st && ts?.home?.[st] && ts?.away?.[st]) {
    const f = (x) => (Math.round(x * 10) / 10).toString();
    out.push(`${STAT_NAME[st] || st} por partido: ${ev.home.name} ${f(ts.home[st].for)} (recibe ${f(ts.home[st].against)}) · ${ev.away.name} ${f(ts.away[st].for)} (recibe ${f(ts.away[st].against)})`);
  }
  const line = lineText(ev, c, chosen);
  if (line) out.push(line);
  if (c.pMarket != null) out.push(`Según las cuotas (solo referencia): ${Math.round(c.pMarket * 100)}%`);
  if (c.pModel != null) out.push(`${c.via === 'simulación' ? `Simulación (${SIMULATIONS} partidos)` : VIA[c.via] || 'Modelo'}: ${Math.round(c.pModel * 100)}%`);
  return out;
}

async function sofascoreDetails(events, sources, progress) {
  const details = {};
  let failed = 0;
  for (let i = 0; i < events.length; i += DETAILS_PER_CALL) {
    progress(`Sofascore: estadísticas ${Math.min(i + DETAILS_PER_CALL, events.length)} de ${events.length}`, (0.6 * i) / events.length);
    const chunk = events.slice(i, i + DETAILS_PER_CALL).map((e) => ({
      id: e.id,
      sport: e.sport,
      homeId: e.home.id,
      awayId: e.away.id,
      homeSlug: e.home.slug || null,
      awaySlug: e.away.slug || null,
      start: e.start,
      url: e.url || null,
    }));
    try {
      const r = await ext.call('sofascore', 'getEventDetails', { events: chunk }, { timeout: 400000 });
      Object.assign(details, r.items);
      failed += r.failed || 0;
      sources.sofascore = { ok: true, mode: r.mode, failed };
    } catch (e) {
      sources.sofascore = { ok: false, error: e.message };
    }
  }
  return details;
}

const BETANO_PAGES = 40; // partidos cuya página de Betano se abre (para todos los mercados)

async function bookmakerOffers(events, sources, progress, { allMarkets = true } = {}) {
  const offers = new Map(); // id de Sofascore -> ofertas
  const add = (id, list) => offers.set(id, [...(offers.get(id) || []), ...list]);
  const bySport = groupBy(events, (e) => e.sport);

  progress('Apuesta Total: cuotas', 0.65);
  let atMatched = 0;
  const atStats = {}; // mercados reconocidos / sin modelar (de jugador, de torneo...)
  for (const [sport, evs] of bySport) {
    try {
      const from = Math.min(...evs.map((e) => e.start)) - 3 * 3600000;
      const to = Math.max(...evs.map((e) => e.start)) + 3 * 3600000;
      const list = (await ext.call('apuestatotal', 'getEventList', { sport, from, to })).items;
      const pairs = new Map();
      for (const ev of evs) {
        const m = matchEvent(ev, list, { toleranceMin: sport === 'tennis' ? 90 : 25 });
        if (m) pairs.set(m.item.eventId, { ev, m });
      }
      if (!pairs.size) continue;
      const { items } = await ext.call('apuestatotal', 'getMarkets', { eventIds: [...pairs.keys()], sport }, { timeout: 120000 });
      for (const [atId, { ev, m }] of pairs) {
        const list2 = offersFromApuestaTotal(items[atId] || [], m.item, ev, m.swapped, atStats);
        if (list2.length) atMatched++;
        add(ev.id, list2);
      }
      sources.apuestatotal = { ok: true, matched: atMatched, markets: atStats };
    } catch (e) {
      sources.apuestatotal = { ok: false, error: e.message };
    }
  }
  sources.apuestatotal ||= { ok: true, matched: 0 };

  progress('Betano: cuotas', 0.72);
  let bMatched = 0;
  const matched = []; // { ev, m } para abrir la página de cada partido
  const bErrors = [];
  for (const [sport, evs] of bySport) {
    try {
      const list = (await ext.call('betano', 'getOdds', { sport }, { timeout: 90000 })).items;
      for (const ev of evs) {
        const m = matchEvent(ev, list, { toleranceMin: sport === 'tennis' ? 90 : 25 });
        if (m) matched.push({ ev, m });
      }
    } catch (e) {
      bErrors.push(`${sport}: ${e.message}`);
    }
  }
  // Basta con que responda en algún deporte.
  sources.betano = bErrors.length === bySport.size ? { ok: false, error: bErrors.join(' | ') } : { ok: true, matched: 0, ...(bErrors.length ? { partial: bErrors } : {}) };
  // Todos los mercados: la lista del deporte trae solo los principales; se abre
  // la página de cada partido (pestañas Goles, Córners, Tarjetas...).
  const full = {};
  const withUrl = allMarkets ? matched.filter((x) => x.m.item.url).slice(0, BETANO_PAGES) : [];
  for (let i = 0; i < withUrl.length; i += 4) {
    progress(`Betano: todos los mercados ${Math.min(i + 4, withUrl.length)} de ${withUrl.length}`, 0.74 + (0.06 * i) / withUrl.length);
    const chunk = withUrl.slice(i, i + 4);
    try {
      const r = await ext.call('betano', 'getEventMarkets', { urls: Object.fromEntries(chunk.map((x) => [x.ev.id, x.m.item.url])) }, { timeout: 240000 });
      Object.assign(full, r.items);
    } catch (e) {
      sources.betanoPages = { ok: false, error: e.message };
    }
  }
  const stats = {};
  for (const { ev, m } of matched) {
    const markets = full[ev.id]?.length > (m.item.markets?.length || 0) ? full[ev.id] : m.item.markets;
    const list2 = offersFromBetano(markets, m.item, ev, m.swapped, stats);
    if (list2.length) bMatched++;
    add(ev.id, list2);
  }
  if (sources.betano?.ok) sources.betano = { ok: true, matched: bMatched, pages: Object.keys(full).length, markets: stats };
  return offers;
}

const PLAYER_GAMES = 10; // últimos partidos de cada jugador

// Últimos partidos de los jugadores de ambos equipos: ESPN en la NBA y la WNBA;
// Sofascore (con sus ids de partido) en las demás ligas. details[id].players =
// { source, home: { teamGames, players }, away: { teamGames, players } }.
async function addPlayerLogs(events, details, sources, progress, offers = new Map()) {
  if (!events.length) return;
  progress('Jugadores: últimos partidos', 0.8);
  let found = 0;
  const errors = [];
  const set = (ev, r, source) => {
    if (!r?.home?.players?.length && !r?.away?.players?.length) return;
    details[ev.id] = { ...(details[ev.id] || {}), players: { source, home: r.home || { teamGames: 0, players: [] }, away: r.away || { teamGames: 0, players: [] } } };
    found++;
  };
  const sofa = [];
  for (const ev of events) {
    const league = basketballLeague(ev);
    if (league) {
      try {
        const names = offeredPlayers(offers.get(ev.id));
        set(ev, await ext.call('espn', 'getPlayerLogs', { league, home: ev.home.name, away: ev.away.name, start: ev.start, n: PLAYER_GAMES, names, regular: !isPreseason(ev) }, { timeout: 180000 }), 'espn');
      } catch (e) {
        errors.push(`ESPN ${ev.home.name}: ${e.message}`);
      }
    } else if (!provider.isAuto(ev.id) && details[ev.id]?.lastHome) sofa.push(ev);
  }
  if (sofa.length) {
    const last = (list) => (list || []).filter((m) => m.id).slice(0, PLAYER_GAMES).map((m) => ({ id: m.id, home: m.home, start: m.start }));
    try {
      const r = await ext.call(
        'sofascore',
        'getPlayerLogs',
        { events: sofa.map((ev) => ({ id: ev.id, homeId: ev.home.id, awayId: ev.away.id, start: ev.start, lastHome: last(details[ev.id].lastHome), lastAway: last(details[ev.id].lastAway) })), n: PLAYER_GAMES },
        { timeout: 300000 },
      );
      for (const ev of sofa) set(ev, r.items?.[ev.id], 'sofascore');
    } catch (e) {
      errors.push(`Sofascore: ${e.message}`);
    }
  }
  sources.jugadores = found || !errors.length ? { ok: true, matched: found, ...(errors.length ? { partial: errors } : {}) } : { ok: false, error: errors.join(' | ') };
}

async function understatXg(events, sources, progress) {
  const out = new Map();
  const byLeague = groupBy(
    events.filter((e) => e.sport === 'football' && UNDERSTAT_LEAGUES[e.tournament?.id]),
    (e) => UNDERSTAT_LEAGUES[e.tournament.id],
  );
  if (!byLeague.size) return out;
  progress('Understat: goles esperados (xG)', 0.82);
  for (const [league, evs] of byLeague) {
    try {
      const { items } = await ext.call('understat', 'getTeamStrength', { league });
      for (const ev of evs) {
        const home = bestByName(ev.home.name, items);
        const away = bestByName(ev.away.name, items);
        if (home && away) out.set(ev.id, { home, away });
      }
      sources.understat = { ok: true, matched: out.size };
    } catch (e) {
      sources.understat = { ok: false, error: e.message };
    }
  }
  return out;
}

// Noticias de Flashscore, ESPN y FotMob (con la extensión, al momento; sin
// ella, las publicadas cada 2 horas). Solo las usa la red neuronal.
async function loadArticles(withExt, sources, progress) {
  progress('Noticias: Flashscore, ESPN y FotMob', 0.84);
  const articles = [];
  const used = [];
  if (withExt) {
    for (const [source, fn] of [
      ['flashscore', 'getNews'],
      ['espn', 'getAllNews'],
      ['fotmob', 'getNews'],
    ]) {
      try {
        const { items } = await ext.call(source, fn, {}, { timeout: 60000 });
        articles.push(...items);
        if (items.length) used.push(source);
      } catch {
        // fuente de noticias no disponible
      }
    }
  }
  if (!articles.length) {
    articles.push(...(await provider.loadNews()));
    if (articles.length) used.push('publicadas');
  }
  articles.splice(0, articles.length, ...prepareNews(articles));
  sources.noticias = articles.length ? { ok: true, matched: articles.length, via: used.join(', ') } : { ok: false, error: 'Sin noticias disponibles' };
  return articles;
}

export const SIMULATIONS = 10000;

// Jugadores de ambos equipos con sus últimos partidos: [{ name, short, games, out, side }].
function rosterOf(d) {
  const p = d?.players;
  if (!p) return [];
  return ['home', 'away'].flatMap((side) => (p[side]?.players || []).map((x) => ({ ...x, side })));
}

// Los mercados de jugador llevan el nombre como lo escribe la casa: se cambia por
// el del jugador encontrado en los datos (ESPN o Sofascore). Sin jugador, se quitan.
function canonicalPlayers(offers, roster) {
  return offers.flatMap((o) => {
    if (!isPlayerMarket(o.market)) return [o];
    const [base, name] = o.market.split('#');
    const player = roster.length ? matchPlayer(name || '', roster) : null;
    return player ? [{ ...o, market: `${base}#${player.name}`, group: o.group ? `${o.group}#${player.name}` : o.group }] : [];
  });
}

const DIR = { over: 1, yes: 1, home: 1, under: -1, no: -1, away: -1 };

// Distancia (en desvíos) entre lo esperado y la línea, a favor de la selección.
function zFor(c, e, extra) {
  const dir = DIR[c.sel] ?? 0;
  // Estadísticas: Más/Menos frente al total esperado; hándicap (línea del local) frente a la diferencia esperada.
  if (extra?.sd > 0 && c.line != null) return ((c.spec.t === 'HCP' ? extra.mean + c.line : extra.mean - c.line) / extra.sd) * dir;
  if (!e) return 0;
  const half = c.spec.scope === 'h1';
  const total = half ? e.total / 2 : e.total;
  const sdTotal = half ? e.sdTotal / Math.SQRT2 : e.sdTotal;
  const margin = half ? e.margin / 2 : e.margin;
  const sdMargin = half ? e.sdMargin / Math.SQRT2 : e.sdMargin;
  if (c.spec.t === 'OU' && c.spec.stat === 'score' && c.line != null) return ((total - c.line) / sdTotal) * dir;
  if (c.spec.t === 'HCP' && c.line != null) return ((margin + c.line) / sdMargin) * dir;
  if (c.spec.t === 'ML') return (margin / sdMargin) * dir;
  return 0;
}

// Goles/puntos de los últimos 3 partidos de ambos equipos frente a sus últimos 10 (en desvíos del total).
function totalsTrend(d, e) {
  const avg = (list) => (list.length ? list.reduce((s, m) => s + m.gf + m.ga, 0) / list.length : null);
  const both = (n) => {
    const h = avg((d?.lastHome || []).filter((m) => m.gf != null).slice(0, n));
    const a = avg((d?.lastAway || []).filter((m) => m.gf != null).slice(0, n));
    return h == null || a == null ? null : (h + a) / 2;
  };
  const recent = both(3);
  const all = both(10);
  return recent == null || all == null || !(e?.sdTotal > 0) ? 0 : (recent - all) / e.sdTotal;
}

// Candidatos (las dos selecciones de la línea elegida de cada mercado, con
// cuota y probabilidad) de un partido, sin aplicar todavía el método
// (estadístico o red neuronal).
//  1) De cada mercado permitido, la línea .5 más pareja de cada casa (en los de
//     jugador, con el nombre del jugador ya buscado en sus datos).
//  2) Probabilidad con la estadística: modelo de goles o de puntos (total,
//     hándicap, ambos marcan, ganador), promedios de córners, tarjetas y tiros,
//     últimos partidos del jugador, o partidos simulados con lo esperado del
//     modelo (1.er tiempo del básquet). Las cuotas no la cambian.
//  3) Sin datos suficientes no se da probabilidad.
export function baseCandidates(ev, d, offers, { xg, simulations = SIMULATIONS } = {}) {
  const cfg = sportOf(ev.sport);
  const roster = rosterOf(d);
  // Bajas seguras (las dudas no: el jugador puede jugar y la apuesta seguir viva).
  const missing = [...(d?.missing?.home || []), ...(d?.missing?.away || [])].filter((m) => m?.type !== 'doubtful').map((m) => ({ name: m.player || m.name || '' }));
  const chosen = balancedLines(canonicalPlayers(offers, roster), (o) => acceptsOffer(ev.sport, o.market, o.line));
  const lines = (market) => [...new Set(chosen.filter((o) => o.market === market).map((o) => o.line))];
  const model = predict(ev, d, cfg, { lines: { OU: lines('OU'), HCP: lines('HCP') }, xg });
  const enough = Math.min(model?.form?.home?.n ?? 0, model?.form?.away?.n ?? 0) >= MIN_MATCHES;
  const fromModel = new Map(enough ? model.candidates.map((c) => [candidateKey(c.market, c.sel, c.line), c.p]) : []);
  const pMarket = marketProbabilities(chosen);
  const prices = pricesByKey(chosen);
  const trend = totalsTrend(d, model?.expected);

  const items = [];
  const need = []; // sin modelo propio: se simulan
  for (const key of prices.keys()) {
    const [market, sel, raw] = key.split('|');
    const line = raw === '' ? null : Number(raw);
    const spec = parseMarketId(market);
    const c = { key, market, sel, line, spec, pModel: null, via: null, quality: model?.quality ?? 0, extra: null, trend: 0, minutes: 0 };
    if (isPlayerMarket(market)) {
      const player = roster.find((x) => x.name === spec.n);
      // Baja anunciada: la casa anula la apuesta; no se analiza.
      const out = !player || player.out || (missing.length && matchPlayer(player.name, missing));
      const r = out ? null : playerProbability(player.games, spec.stat, sel, line);
      if (r) Object.assign(c, { pModel: r.p, via: 'jugador', quality: Math.min(1, r.n / 10), extra: r, trend: (r.trend || 0) * (DIR[sel] ?? 0), minutes: r.minutes || 0, player });
    } else if (fromModel.has(key)) {
      Object.assign(c, { pModel: fromModel.get(key), via: 'modelo', trend: spec.t === 'OU' && spec.stat === 'score' ? trend * (DIR[sel] ?? 0) : 0 });
    } else if (spec.stat !== 'score') {
      const r = statProbability(ev.sport, d?.teamStats, spec, sel, line);
      if (r) Object.assign(c, { pModel: r.p, via: 'estadísticas', quality: Math.min(1, r.n / 8), extra: r });
    } else if (enough) need.push(c);
    items.push(c);
  }
  let simulated = 0;
  if (need.length && simulations > 0) {
    const params = simParams(ev, cfg, model, { teamStats: d?.teamStats });
    const est = params ? estimate(params, need, { n: simulations, seed: hashSeed(ev.id) }) : new Map();
    for (const c of need) {
      const r = est.get(c.key);
      if (!r) continue;
      c.pModel = r.p;
      c.via = 'simulación';
      simulated++;
    }
  }

  const out = [];
  for (const c of items) {
    if (c.pModel == null) continue; // sin datos suficientes no se inventa una probabilidad
    const priceMap = prices.get(c.key);
    const best = bestPrice(priceMap);
    if (!best) continue;
    const cand = {
      key: c.key,
      eventId: ev.id,
      sport: ev.sport,
      start: ev.start,
      market: c.market,
      sel: c.sel,
      line: c.line,
      family: familyOf(c.spec),
      pModel: c.pModel,
      pMarket: pMarket.get(c.key) ?? null,
      pBase: clamp(c.pModel, 0.001, 0.999),
      quality: c.quality,
      via: c.via,
      prices: priceMap,
      best,
    };
    const z = zFor(c, model?.expected, c.extra);
    cand.x = buildFeatures({ ...cand, price: best.price, z, trend: c.trend, minutes: c.minutes }, { sport: ev.sport, cfg, model, details: d, spec: c.spec, quality: c.quality });
    cand.label = selectionLabel(cand, ev, cfg.unit);
    cand.factors = c.player ? playerFactors(c, cand, chosen, ev) : factorsFor(ev, d, model, cand, chosen);
    out.push(cand);
  }
  // Mercados de la lista con línea .5 en alguna casa pero sin datos para calcularlos
  // (se muestran en el partido con ese motivo).
  const done = new Set(out.map((c) => c.market));
  const noData = [...new Set(items.filter((c) => c.pModel == null && !isPlayerMarket(c.market) && !done.has(c.market)).map((c) => c.market))];
  // Mercados de la lista que las casas ofrecen solo con líneas enteras o asiáticas
  // (p. ej. el 1.er tiempo de la NBA en 88 o +1): sin .5 no se apuestan.
  const offered = offers.filter((o) => BETTABLE.includes(o.source) && !isPlayerMarket(o.market) && o.line != null && acceptsOffer(ev.sport, o.market, o.line));
  const withHalf = new Set(offered.filter((o) => isHalfLine(o.line)).map((o) => o.market));
  const wholeOnly = [...new Set(offered.map((o) => o.market))].filter((m) => !withHalf.has(m) && !done.has(m));
  return { model, candidates: out, simulated, noData, wholeOnly };
}

// Aplica el método: con red neuronal, la red especializada de cada mercado
// (networks.NetworkSet) corrige la probabilidad base si ya está entrenada.
export function applyMethod(candidates, method, network) {
  return candidates.map((c) => {
    const net = method === 'red_neuronal' && network ? network.forCandidate(c) : null;
    const p = clamp(net ? net.predict(c.x, c.pBase) : c.pBase, 0.001, 0.999);
    return { ...c, p, ev: p * c.best.price - 1, ...(net?.trained ? { net: networkOf(c.sport, c.market) } : {}) };
  });
}

// Candidatos de un partido con el método ya aplicado.
export function analyzeEvent(ev, d, offers, { xg, network = null, method = 'estadistico', simulations } = {}) {
  const { model, candidates } = baseCandidates(ev, d, offers, { xg, simulations });
  return { model, candidates: applyMethod(candidates, method, network) };
}

// Semilla fija por partido: el mismo partido da las mismas probabilidades.
function hashSeed(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const summaryOf = (ev) => ({
  id: ev.id,
  sport: ev.sport,
  start: ev.start,
  league: ev.tournament?.name || '',
  country: ev.category?.name || '',
  home: ev.home.name,
  away: ev.away.name,
  url: ev.url || null,
});

// Estadísticas, cuotas y xG publicados para los partidos automáticos.
async function publishedData(events, details, sources, progress) {
  progress('Datos automáticos: estadísticas y cuotas', 0.1);
  const out = await provider.detailsFor(events);
  let withStats = 0;
  for (const ev of events) {
    const d = out.get(ev.id)?.details;
    if (!d) continue;
    details[ev.id] = d;
    if (d.lastHome.length || d.lastAway.length) withStats++;
  }
  const generated = [...out.values()].map((x) => x?.generated).filter(Boolean).sort()[0] || null;
  sources.flashscore = { ok: true, matched: withStats, generated };
  return out;
}

export const METHODS = ['estadistico', 'red_neuronal'];

// events: partidos seleccionados (de Sofascore o automáticos). Junta los datos
// una sola vez y devuelve un análisis por cada método pedido:
// { estadistico: análisis, red_neuronal: análisis }.
export async function analyzeMany(events, { methods = ['estadistico'], settings = DEFAULT_SETTINGS, network = null, onProgress = () => {} } = {}) {
  const sources = {};
  const pending = events.filter((e) => e.state === 'pendiente');
  const auto = pending.filter((e) => provider.isAuto(e.id));
  const sofa = pending.filter((e) => !provider.isAuto(e.id));
  const withExt = ext.available();
  if (sofa.length && !withExt) throw new Error('Los partidos de Sofascore necesitan la extensión. Elige la fuente "Automático" o abre la página en la PC con la extensión.');

  const details = sofa.length ? await sofascoreDetails(sofa, sources, onProgress) : {};
  // Sofascore + Flashscore: estadísticas de los equipos de ambas fuentes.
  if (sofa.length) await addTeamStats(sofa, details, sources, onProgress);
  const published = auto.length ? await publishedData(auto, details, sources, onProgress) : new Map();
  const offers = withExt ? await bookmakerOffers(pending, sources, onProgress, { allMarkets: settings.betanoAllMarkets !== false }) : new Map();
  const xg = sofa.length && withExt ? await understatXg(sofa, sources, onProgress) : new Map();

  // Partidos automáticos: cuotas publicadas de Apuesta Total que no se
  // obtuvieron en vivo con la extensión (todas, o las selecciones que faltan:
  // una extensión sin actualizar no pide los jugadores ni las líneas extra).
  let usedPublished = 0;
  for (const ev of auto) {
    const p = published.get(ev.id);
    if (!p) continue;
    const live = offers.get(ev.id) || [];
    const have = new Set(live.filter((o) => o.source === 'apuestatotal').map((o) => candidateKey(o.market, o.sel, o.line)));
    const missing = p.offers.filter((o) => !have.has(candidateKey(o.market, o.sel, o.line)));
    if (missing.length) {
      offers.set(ev.id, [...live, ...missing]);
      if (!have.size) usedPublished++;
    }
    if (p.xg) xg.set(ev.id, p.xg);
  }
  // Básquet con cuotas de jugador (Apuesta Total o Betano): últimos partidos de cada jugador.
  if (withExt) await addPlayerLogs(pending.filter((ev) => ev.sport === 'basketball' && (offers.get(ev.id) || []).some((o) => isPlayerMarket(o.market))), details, sources, onProgress, offers);
  // Sin la extensión: los últimos partidos de los jugadores publicados por GitHub Actions.
  const publishedPlayers = withExt ? 0 : auto.filter((ev) => details[ev.id]?.players).length;
  if (publishedPlayers) sources.jugadores = { ok: true, matched: publishedPlayers, published: true };
  if (usedPublished) {
    const at = sources.apuestatotal;
    sources.apuestatotal = { ok: true, matched: (at?.ok ? at.matched : 0) + usedPublished, published: true };
  }
  if (auto.some((e) => xg.has(e.id))) sources.understat ||= { ok: true, matched: auto.filter((e) => xg.has(e.id)).length };

  // Noticias de cada equipo (para las variables de la red neuronal).
  const articles = pending.length ? await loadArticles(withExt, sources, onProgress) : [];
  let withNews = 0;
  for (const ev of pending) {
    const news = newsFeatures(ev, articles);
    if (!news) continue;
    details[ev.id] = { ...(details[ev.id] || {}), news };
    if (news.home.n || news.away.n) withNews++;
  }
  if (sources.noticias) sources.noticias.events = withNews;

  const created = new Date().toISOString();
  const date = pending.length ? limaDateOf(Math.min(...pending.map((e) => e.start))) : null;
  // Probabilidades de cada partido (una sola vez para todos los métodos).
  const base = [];
  const eventInfo = {};
  let simulated = 0;
  for (const [i, ev] of pending.entries()) {
    onProgress(`Calculando probabilidades ${i + 1} de ${pending.length}`, 0.86 + (0.12 * i) / Math.max(1, pending.length));
    await new Promise((r) => setTimeout(r, 0)); // deja que la página se actualice
    const sofaOffers = offersFromSofascore(details[ev.id]?.odds, ev);
    const all = [...sofaOffers, ...(offers.get(ev.id) || [])];
    // xG: Understat o, si no, el promedio de Flashscore de los últimos partidos.
    const r = baseCandidates(ev, details[ev.id], all, { xg: xg.get(ev.id) || xgFromTeamStats(details[ev.id]?.teamStats) || undefined });
    simulated += r.simulated;
    base.push(...r.candidates);
    eventInfo[ev.id] = {
      ...summaryOf(ev),
      hasModel: Boolean(r.model),
      quality: r.model?.quality ?? 0,
      bookmakers: [...new Set(all.map((o) => o.source))],
      markets: new Set(all.map((o) => o.market)).size,
      teamStats: Boolean(details[ev.id]?.teamStats),
      players: Boolean(details[ev.id]?.players),
      noData: r.noData,
      wholeOnly: r.wholeOnly,
      ...(details[ev.id]?.fsId ? { fsId: details[ev.id].fsId } : {}),
    };
  }
  sources.simulacion = { ok: true, matched: simulated };
  const out = {};
  for (const method of methods) {
    const net = method === 'red_neuronal' ? network : null;
    const candidates = applyMethod(base, method, net);
    out[method] = {
      id: `${method === 'red_neuronal' ? 'rn' : 'est'}-${created.replace(/\D/g, '').slice(0, 14)}`,
      method,
      created,
      run: created, // los análisis hechos juntos comparten "run"
      date,
      settings: { ...settings },
      network: net ? net.summary() : null,
      sources,
      events: eventInfo,
      candidates,
      picks: selectPicks(candidates, settings),
      combos: buildCombos(candidates, settings),
      skipped: events.length - pending.length,
      featureVersion: FEATURE_VERSION,
    };
  }
  onProgress('Listo', 1);
  return out;
}

// Un solo método (atajo de analyzeMany).
export async function analyze(events, { method = 'estadistico', ...opts } = {}) {
  return (await analyzeMany(events, { ...opts, methods: [method] }))[method];
}
