// Cuotas reales de Flashscore (las del cierre) para la NBA, la MLB, la Euroliga y la
// Liga ACB: total, hándicap y ganador del partido y, en el básquet, total y hándicap del
// 1.er tiempo. Se guardan en cada partido como k = { mercado: [[línea, cuota A, cuota B]] }
// (A/B: Más/Menos, local/visita), el promedio de las casas en cada línea. Primero con
// la versión de EE. UU. de Flashscore (una casa, liviana); si no trae nada (temporadas
// viejas), con la de Perú (varias casas).
// Uso: NODE_USE_ENV_PROXY=1 node scripts/historico/cuotas-flashscore.mjs [--solo=nba,mlb,euroliga,acb]
import { readJson, writeJson } from './comun.mjs';
import { similar } from './repeticion/futbol.mjs';
import { log, pool } from './sofa.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SITE = 'https://www.flashscore.com';
const FEED = 'https://global.flashscore.ninja/2/x/feed/';
const ODDS = 'https://global.ds.lsapp.eu/odds/pq_graphql';
const HOUR = 3600000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, headers = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, referer: `${SITE}/`, ...headers }, signal: AbortSignal.timeout(45000) });
      if (r.ok) return r.text();
      if (r.status === 404) return null;
    } catch {
      // red: reintento
    }
    await sleep(1500 * 2 ** i);
  }
  return null;
}

// Feed de Flashscore: registros separados por "~", campos "clave÷valor" por "¬".
const parseFeed = (s) =>
  String(s || '')
    .split('~')
    .map((rec) => Object.fromEntries(rec.split('¬').map((f) => [f.slice(0, f.indexOf('÷')), f.slice(f.indexOf('÷') + 1)])))
    .filter((o) => o.AA);

// Partidos terminados de una temporada (página de resultados y sus "mostrar más").
async function seasonEvents(path) {
  const html = await fetchText(`${SITE}${path}`);
  if (!html) return [];
  const init = html.match(/initialFeeds\['results'\]\s*=\s*\{\s*data:\s*`([^`]*)`,\s*allEventsCount:\s*(\d+),\s*seasonId:\s*(\d+)/);
  const country = html.match(/country_id\s*=\s*(\d+)/)?.[1];
  const tournament = html.match(/tournament_id\s*=\s*"([A-Za-z0-9]+)"/)?.[1];
  if (!init || !country || !tournament) return [];
  const sport = init[1].match(/SA÷(\d+)/)?.[1];
  const all = new Map(parseFeed(init[1]).map((e) => [e.AA, e]));
  for (let page = 1; all.size < Number(init[2]) && page < 150; page++) {
    const more = parseFeed(await fetchText(`${FEED}tr_${sport}_${country}_${tournament}_${init[3]}_${page}_-4_en_1`, { 'x-fsign': 'SW9D1eZo' }));
    const before = all.size;
    for (const e of more) all.set(e.AA, e);
    if (all.size === before) break;
  }
  return [...all.values()]
    .filter((e) => Number.isFinite(Number(e.AG)) && Number.isFinite(Number(e.AH)))
    .map((e) => ({ id: e.AA, t: Number(e.AD), home: e.AE, away: e.AF, hp: e.JA, ap: e.JB, g: [Number(e.AG), Number(e.AH)] }));
}

const MARKETS = {
  'OVER_UNDER|FULL_TIME_OVER_TIME': 'OU',
  'ASIAN_HANDICAP|FULL_TIME_OVER_TIME': 'HCP',
  'HOME_AWAY|FULL_TIME_OVER_TIME': 'ML',
  'OVER_UNDER|FIRST_HALF': 'OU@h1',
  'ASIAN_HANDICAP|FIRST_HALF': 'HCP@h1',
};

// k de las cuotas de un partido: promedio de las casas en cada línea; como mucho las 4
// líneas más parejas de cada mercado. swapped: el local de Flashscore es nuestra visita.
export function kOf(data, fe, swapped = false) {
  const acc = new Map(); // `${mercado}|${línea}` → [[A...], [B...]] por casa
  for (const o of data?.odds || []) {
    const market = MARKETS[`${o.bettingType}|${o.bettingScope}`];
    if (!market) continue;
    const sides = new Map(); // línea → [A, B] de esta casa
    for (const x of o.odds || []) {
      const price = Number(x.value);
      if (!(price > 1) || x.active === false) continue;
      let side;
      let line = null;
      if (market.startsWith('OU')) {
        side = x.selection === 'OVER' ? 0 : x.selection === 'UNDER' ? 1 : null;
        line = Number(x.handicap?.value);
      } else {
        side = x.eventParticipantId === fe.hp ? 0 : x.eventParticipantId === fe.ap ? 1 : null;
        if (market.startsWith('HCP')) line = side === 0 ? Number(x.handicap?.value) : -Number(x.handicap?.value);
      }
      if (side == null || (market !== 'ML' && !Number.isFinite(line))) continue;
      if (swapped && !market.startsWith('OU')) {
        side = 1 - side;
        if (line != null) line = -line;
      }
      const s = sides.get(line) || sides.set(line, [null, null]).get(line);
      s[side] = price;
    }
    for (const [line, [a, b]] of sides) {
      if (!a || !b) continue;
      const key = `${market}|${line}`;
      const v = acc.get(key) || acc.set(key, [[], []]).get(key);
      v[0].push(a);
      v[1].push(b);
    }
  }
  const avg = (xs) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100;
  const k = {};
  for (const [key, [as, bs]] of acc) {
    const [market, raw] = key.split('|');
    const a = avg(as);
    const b = avg(bs);
    const over = 1 / a + 1 / b;
    if (over < 0.98 || over > 1.3) continue;
    (k[market] ||= []).push([raw === 'null' ? null : Number(raw), a, b]);
  }
  for (const m of Object.keys(k)) k[m] = k[m].sort((x, y) => Math.abs(x[1] - x[2]) - Math.abs(y[1] - y[2])).slice(0, 4);
  return k;
}

async function eventOdds(id) {
  for (const geo of ['US', 'PE']) {
    const t = await fetchText(`${ODDS}?_hash=oce&eventId=${id}&projectId=2&geoIpCode=${geo}&geoIpSubdivisionCode=${geo}1`);
    const d = t ? JSON.parse(t)?.data?.findOddsByEventId : null;
    if (d?.odds?.length) return d;
  }
  return null;
}

// Nuestro partido de un partido de Flashscore: ±36 h, mismo marcador, nombres parecidos
// y, entre esos, el de horario más cercano (en una serie, los mismos equipos juegan
// días seguidos y pueden repetir el marcador).
function findGame(fe, games) {
  let best = null;
  for (const g of games) {
    const dt = Math.abs(g.t * 1000 - fe.t * 1000);
    if (dt > 36 * HOUR) continue;
    for (const swapped of [false, true]) {
      const [h, a] = swapped ? [fe.away, fe.home] : [fe.home, fe.away];
      const [gh, ga] = swapped ? [fe.g[1], fe.g[0]] : fe.g;
      if (gh !== g.g[0] || ga !== g.g[1]) continue;
      const s = similar(g.home, h) + similar(g.away, a);
      if (s >= 1 && (!best || dt < best.dt || (dt === best.dt && s > best.s))) best = { g, swapped, s, dt };
    }
  }
  return best;
}

const YEAR = new Date().getUTCFullYear();
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// Ligas: archivo de cada temporada, página de Flashscore y nombres de los equipos.
const LEAGUES = {
  nba: range(YEAR - 7, YEAR + 1).map((y) => ({ rel: `nba/${y}.json`, path: `/basketball/usa/nba-${y - 1}-${y}/results/`, current: '/basketball/usa/nba/results/' })),
  euroliga: range(YEAR - 8, YEAR).map((y) => ({ rel: `basquet/euroliga/${y}.json`, path: `/basketball/europe/euroleague-${y}-${y + 1}/results/`, current: '/basketball/europe/euroleague/results/' })),
  acb: range(YEAR - 8, YEAR).map((y) => ({ rel: `basquet/acb/${y}.json`, path: `/basketball/spain/acb-${y}-${y + 1}/results/`, current: '/basketball/spain/acb/results/' })),
  mlb: range(YEAR - 6, YEAR).map((y) => ({ rel: `mlb/partidos/${y}.json`, path: `/baseball/usa/mlb-${y}/results/`, current: '/baseball/usa/mlb/results/' })),
};
const gamesOf = (d) => (d.games || []).map((g) => ({ ref: g, t: g.t, home: g.h[2] || g.h[1], away: g.a[2] || g.a[1], g: g.g }));
// En la MLB los equipos son [id, nombre]; en el básquet [id, sigla, nombre].
const mlbGames = (d) => (d.games || []).map((g) => ({ ref: g, t: g.t, home: g.h[1], away: g.a[1], g: g.g }));

const only = process.argv.find((a) => a.startsWith('--solo='))?.slice(7).split(',') || null;
for (const [league, seasons] of Object.entries(LEAGUES).filter(([l]) => !only || only.includes(l))) {
  for (const s of seasons) {
    const d = readJson(s.rel);
    if (!d) continue;
    // Los que todavía no tienen las cuotas de Flashscore (kf) y ya se jugaron.
    const games = (league === 'mlb' ? mlbGames(d) : gamesOf(d)).filter((x) => !x.ref.kf && x.t * 1000 < Date.now() - 6 * HOUR);
    if (!games.length) continue;
    let events = await seasonEvents(s.path);
    if (!events.length) events = await seasonEvents(s.current);
    let found = 0;
    let withOdds = 0;
    // Uno a uno: si dos partidos de Flashscore dan el mismo nuestro, el de horario más cercano.
    const byGame = new Map();
    for (const fe of events) {
      const hit = findGame(fe, games);
      if (hit && (!byGame.has(hit.g) || hit.dt < byGame.get(hit.g).dt)) byGame.set(hit.g, { fe, ...hit });
    }
    const pairs = [...byGame.values()];
    found = pairs.length;
    await pool(
      pairs,
      async ({ fe, g, swapped }) => {
        const k = kOf(await eventOdds(fe.id), fe, swapped);
        if (!Object.keys(k).length) return;
        g.ref.k = { ...(g.ref.k || {}), ...k };
        g.ref.kf = 1;
        withOdds++;
      },
      8,
    );
    writeJson(s.rel, d);
    log(`${league} ${s.rel}: ${events.length} partidos en Flashscore · ${found} de ${games.length} unidos · ${withOdds} con cuotas`);
  }
}
