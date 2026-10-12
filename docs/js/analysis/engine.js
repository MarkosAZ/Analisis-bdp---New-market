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
  marketProbabilities,
  offersFromApuestaTotal,
  offersFromBetano,
  offersFromSofascore,
  pricesByKey,
  selectionLabel,
} from './markets.js';
import { familyOf, parseMarketId, STAT_NAME } from './catalog.js';
import { bestByName, matchEvent } from './matching.js';
import { predict } from './models.js';
import { BOOKMAKERS, buildCombos, DEFAULT_SETTINGS, marketsOf, selectPicks } from './picks.js';
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
const VIA = { modelo: 'Modelo', estadísticas: 'Promedios de los equipos', simulación: 'Simulación' };

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

// Candidatos (las dos selecciones de la línea elegida de cada mercado, con
// cuota y probabilidad) de un partido, sin aplicar todavía el método
// (estadístico o red neuronal).
//  1) De cada mercado permitido, la línea .5 más pareja de cada casa.
//  2) Probabilidad con la estadística de los equipos: modelo de goles o de
//     puntos (total, hándicap, ambos marcan, ganador), promedios de córners,
//     tarjetas y tiros, o partidos simulados con lo esperado del modelo
//     (1.er tiempo del básquet). Las cuotas no la cambian.
//  3) Sin datos suficientes de ambos equipos no se da probabilidad.
export function baseCandidates(ev, d, offers, { xg, simulations = SIMULATIONS } = {}) {
  const cfg = sportOf(ev.sport);
  const chosen = balancedLines(offers, marketsOf(ev.sport));
  const lines = (market) => [...new Set(chosen.filter((o) => o.market === market).map((o) => o.line))];
  const model = predict(ev, d, cfg, { lines: { OU: lines('OU'), HCP: lines('HCP') }, xg });
  const enough = Math.min(model?.form?.home?.n ?? 0, model?.form?.away?.n ?? 0) >= MIN_MATCHES;
  const fromModel = new Map(enough ? model.candidates.map((c) => [candidateKey(c.market, c.sel, c.line), c.p]) : []);
  const pMarket = marketProbabilities(chosen);
  const prices = pricesByKey(chosen);

  const items = [];
  const need = []; // sin modelo propio: se simulan
  for (const key of prices.keys()) {
    const [market, sel, raw] = key.split('|');
    const line = raw === '' ? null : Number(raw);
    const spec = parseMarketId(market);
    const c = { key, market, sel, line, spec, pModel: null, via: null, quality: model?.quality ?? 0 };
    if (fromModel.has(key)) Object.assign(c, { pModel: fromModel.get(key), via: 'modelo' });
    else if (spec.stat !== 'score') {
      const r = statProbability(ev.sport, d?.teamStats, spec, sel, line);
      if (r) Object.assign(c, { pModel: r.p, via: 'estadísticas', quality: Math.min(1, r.n / 8) });
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
    if (c.pModel == null) continue; // sin datos de los equipos no se inventa una probabilidad
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
    cand.x = buildFeatures({ ...cand, price: best.price }, { sport: ev.sport, cfg, model, details: d, spec: c.spec, quality: c.quality });
    cand.label = selectionLabel(cand, ev, cfg.unit);
    cand.factors = factorsFor(ev, d, model, cand, chosen);
    out.push(cand);
  }
  return { model, candidates: out, simulated };
}

// Aplica el método: con red neuronal corrige la probabilidad base.
export function applyMethod(candidates, method, network) {
  return candidates.map((c) => {
    let p = method === 'red_neuronal' && network ? network.predict(c.x, c.pBase) : c.pBase;
    p = clamp(p, 0.001, 0.999);
    return { ...c, p, ev: p * c.best.price - 1 };
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

  // Partidos automáticos: cuotas publicadas de Apuesta Total si no se
  // obtuvieron en vivo con la extensión.
  let usedPublished = 0;
  for (const ev of auto) {
    const p = published.get(ev.id);
    if (!p) continue;
    const live = offers.get(ev.id) || [];
    if (p.offers.length && !live.some((o) => o.source === 'apuestatotal')) {
      offers.set(ev.id, [...live, ...p.offers]);
      usedPublished++;
    }
    if (p.xg) xg.set(ev.id, p.xg);
  }
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
      network: net ? { trained: net.trained, samples: net.meta?.samples || 0 } : null,
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
