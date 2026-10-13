// Niveles de confianza, mercados analizados (con su red especializada) y combinadas.
import { groupBy } from '../util.js';

// Baja: menos de "moderada". Se muestra y se guarda en su propia fila, sin
// sumarse a los totales de los otros niveles.
export const LEVELS = [
  { id: 'alta', name: 'Alta' },
  { id: 'moderada_alta', name: 'Moderada-alta' },
  { id: 'moderada', name: 'Moderada' },
  { id: 'baja', name: 'Baja' },
];
export const MAIN_LEVELS = LEVELS.filter((l) => l.id !== 'baja');

// Mercados que se analizan: solo estos, con líneas .5 (dos resultados posibles,
// sin devolución) y, en cada casa, la línea con menos diferencia entre sus dos
// cuotas (markets.balancedLines). market: identificador del catálogo ('OU.player'
// reúne los Más/Menos de jugador: OU.pl_pts#Nombre, OU.pl_reb#Nombre...).
// range: líneas posibles; las de fuera son de otro mercado mal leído (p. ej. los
// 24.5 puntos de un jugador no son el total del partido). net: su red especializada,
// una por mercado (el primer tiempo no comparte red con el partido completo). Los
// de jugador no tienen una sola: hay una red por estadística (networks.PLAYER_NETWORKS).
export const MARKETS = [
  { sport: 'football', market: 'OU', name: 'Goles totales Más/Menos', range: [0.5, 7.5], net: 'Football_Goals_Model' },
  { sport: 'football', market: 'BTTS', name: 'Ambos equipos anotan', net: 'Football_BTTS_Model' },
  { sport: 'football', market: 'OU.corners', name: 'Más/Menos córners', range: [3.5, 18.5], net: 'Football_Corners_Model' },
  { sport: 'football', market: 'HCP.corners', name: 'Hándicap de córners', range: [-9.5, 9.5], net: 'Football_CornersHandicap_Model' },
  { sport: 'football', market: 'OU.cards', name: 'Total de tarjetas', range: [0.5, 12.5], net: 'Football_Cards_Model' },
  { sport: 'football', market: 'OU.shots_on', name: 'Tiros al arco', range: [2.5, 22.5], net: 'Football_ShotsOnTarget_Model' },
  { sport: 'football', market: 'OU.shots', name: 'Remates totales', range: [8.5, 45.5], net: 'Football_Shots_Model' },
  { sport: 'football', market: 'OU.corners@h1', name: 'Córners en el primer tiempo Más/Menos', range: [0.5, 10.5], net: 'Football_CornersH1_Model' },
  { sport: 'basketball', market: 'OU', name: 'Total de puntos', range: [80.5, 300.5], net: 'Basketball_Totals_Model' },
  { sport: 'basketball', market: 'HCP', name: 'Hándicap', range: [-75.5, 75.5], net: 'Basketball_Handicap_Model' },
  { sport: 'basketball', market: 'OU.player', name: 'Jugador: Más/Menos (puntos, rebotes, asistencias, triples...)', range: [0.5, 80.5], net: null },
  { sport: 'basketball', market: 'HCP@h1', name: 'Primer tiempo: hándicap', range: [-40.5, 40.5], net: 'Basketball_HandicapH1_Model' },
  { sport: 'basketball', market: 'OU@h1', name: 'Primer tiempo: total de puntos', range: [40.5, 160.5], net: 'Basketball_TotalsH1_Model' },
  { sport: 'baseball', market: 'ML', name: 'Ganador', net: 'Baseball_Winner_Model' },
  { sport: 'baseball', market: 'HCP', name: 'Hándicap (run line)', range: [-5.5, 5.5], net: 'Baseball_RunLine_Model' },
  { sport: 'baseball', market: 'OU', name: 'Total de carreras', range: [3.5, 22.5], net: 'Baseball_Totals_Model' },
].map((m) => ({ ...m, id: `${m.sport}:${m.market}` }));

const BY_ID = new Map(MARKETS.map((m) => [m.id, m]));
export const isPlayerMarket = (market) => /^OU\.pl_/.test(String(market));
// Mercado de la lista al que pertenece una selección ("basketball:OU.player" para los de jugador).
// Solo en los de jugador se quita el '#nombre': 'BTTS#2' (ambos anotan 2+) es otro mercado.
export const marketKey = (sport, market) => `${sport}:${isPlayerMarket(market) ? 'OU.player' : String(market)}`;
export const marketInfo = (sport, market) => BY_ID.get(marketKey(sport, market)) || null;
// ¿El mercado (identificador del catálogo) se analiza en ese deporte?
export const marketsOf = (sport) => ({ has: (market) => Boolean(marketInfo(sport, market)) });

// ¿La oferta es de un mercado analizado y su línea es posible para ese mercado?
export function acceptsOffer(sport, market, line) {
  const info = marketInfo(sport, market);
  if (!info) return false;
  if (!info.range || line == null) return true;
  return line >= info.range[0] && line <= info.range[1];
}

// Los ajustes eligen cuáles de los mercados analizados pueden salir en picks y
// combinadas (se guardan los apagados: un mercado nuevo sale encendido).
const allowedMarket = (c, s) => !(s.marketsOff || []).includes(marketKey(c.sport, c.market));

export const DEFAULT_SETTINGS = {
  alta: 0.8, // probabilidad mínima para "alta"
  moderadaAlta: 0.7,
  moderada: 0.6,
  minOdds: 1.15, // combinadas: no entran selecciones con cuota más baja (ganancia casi nula)
  comboTargets: [5, 10], // cuota mínima de cada combinada
  comboMinProb: 0.7, // probabilidad mínima de cada selección de una combinada
  comboMaxLegs: 8,
  marketsOff: [], // mercados de la lista que no salen en picks ni combinadas
  betanoAllMarkets: true, // abrir la página de cada partido en Betano (todos los mercados; más lento)
};

export const BOOKMAKERS = { apuestatotal: 'Apuesta Total', betano: 'Betano', sofascore: 'Sofascore (referencia)' };

export function levelOf(p, s = DEFAULT_SETTINGS) {
  if (p >= s.alta) return 'alta';
  if (p >= s.moderadaAlta) return 'moderada_alta';
  if (p >= s.moderada) return 'moderada';
  return 'baja';
}

const marketOrder = (c) => {
  const i = MARKETS.findIndex((m) => m.id === marketKey(c.sport, c.market));
  return i < 0 ? MARKETS.length : i;
};

// Todos los mercados de cada partido: por cada uno (y cada jugador), la
// selección más probable de su línea con su nivel de confianza, también Baja,
// aunque no tenga valor o su cuota sea muy baja: cada mercado tiene su apuesta
// (y su resultado alimenta la red de ese mercado). La cuota mínima solo cuenta
// en las combinadas.
export function selectPicks(candidates, s = DEFAULT_SETTINGS) {
  const picks = [];
  for (const list of groupBy(
    candidates.filter((c) => c.best && allowedMarket(c, s)),
    (c) => `${c.eventId}|${c.market}`,
  ).values()) {
    const best = list.reduce((a, b) => (b.p > a.p || (b.p === a.p && b.best.price > a.best.price) ? b : a));
    picks.push({ ...best, level: levelOf(best.p, s) });
  }
  return picks.sort((a, b) => (a.start || 0) - (b.start || 0) || String(a.eventId).localeCompare(String(b.eventId)) || marketOrder(a) - marketOrder(b) || b.p - a.p);
}

// Combinación de selecciones (máximo una por partido) que alcanza la cuota
// `target` con la mayor probabilidad conjunta. Mochila en escala logarítmica:
// coste = -log(p), peso = log(cuota) redondeado hacia abajo, así la cuota
// real nunca queda por debajo del objetivo.
export function bestCombo(options, target, maxLegs = 8) {
  const STEP = 0.002;
  const T = Math.ceil(Math.log(target) / STEP);
  const groups = [...groupBy(options, (o) => o.eventId).values()];
  const width = T + 1;
  let dp = new Float64Array((maxLegs + 1) * width).fill(Infinity);
  dp[0] = 0;
  const trace = [];
  for (const g of groups) {
    const next = dp.slice();
    const chosen = new Int16Array(dp.length).fill(-1);
    const from = new Int32Array(dp.length).fill(-1);
    for (let l = 0; l < maxLegs; l++) {
      for (let w = 0; w <= T; w++) {
        const cost = dp[l * width + w];
        if (cost === Infinity) continue;
        g.forEach((o, oi) => {
          const w2 = Math.min(T, w + Math.floor(Math.log(o.price) / STEP));
          const c2 = cost - Math.log(o.p);
          const idx = (l + 1) * width + w2;
          if (c2 < next[idx]) {
            next[idx] = c2;
            chosen[idx] = oi;
            from[idx] = l * width + w;
          }
        });
      }
    }
    trace.push({ g, chosen, from });
    dp = next;
  }
  let end = -1;
  for (let l = 1; l <= maxLegs; l++) {
    const idx = l * width + T;
    if (dp[idx] < Infinity && (end < 0 || dp[idx] < dp[end])) end = idx;
  }
  if (end < 0) return null;
  const legs = [];
  let idx = end;
  for (let gi = trace.length - 1; gi >= 0 && idx > 0; gi--) {
    const { g, chosen, from } = trace[gi];
    if (chosen[idx] >= 0) {
      legs.push(g[chosen[idx]]);
      idx = from[idx];
    }
  }
  return legs.reverse();
}

// Combinadas por casa de apuestas (una combinada se juega en una sola casa).
// Para cada cuota objetivo se dan hasta dos alternativas con partidos distintos.
export function buildCombos(candidates, s = DEFAULT_SETTINGS, sources = ['apuestatotal', 'betano']) {
  const combos = [];
  const seen = new Set();
  for (const source of sources) {
    const options = candidates
      .filter((c) => c.p >= s.comboMinProb && c.prices?.[source] >= s.minOdds && allowedMarket(c, s))
      .map((c) => ({ key: c.key, eventId: c.eventId, p: c.p, price: c.prices[source] }));
    for (const target of s.comboTargets) {
      const used = new Set();
      for (let alt = 0; alt < 2; alt++) {
        const legs = bestCombo(
          options.filter((o) => !used.has(o.eventId)),
          target,
          s.comboMaxLegs,
        );
        if (!legs || legs.length < 2) break;
        legs.forEach((o) => used.add(o.eventId));
        const id = `${source}:${legs.map((o) => o.key + '@' + o.eventId).sort().join(',')}`;
        if (seen.has(id)) continue;
        seen.add(id);
        combos.push({
          id: `c${combos.length + 1}`,
          source,
          target,
          legs: legs.map((o) => ({ key: o.key, eventId: o.eventId, price: o.price, p: o.p })),
          odds: legs.reduce((x, o) => x * o.price, 1),
          p: legs.reduce((x, o) => x * o.p, 1),
        });
      }
    }
  }
  return combos.sort((a, b) => a.target - b.target || b.p - a.p);
}
