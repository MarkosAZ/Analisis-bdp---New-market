// Pestaña "Errores de cuota": la línea más pareja de cada casa (la del análisis, con sus
// dos cuotas) frente a lo que dicen los datos del partido (pestaña Datos). Si el promedio
// de los últimos partidos queda lejos de la línea y lo confirma cuántas veces la pasó,
// la opción que favorecen los datos es un error de cuota. Sin interfaz.
//
// "Lejos" depende de cuánto varía cada mercado: la diferencia entre el promedio y la
// línea se mide en desviaciones de esos mismos partidos (un gol en los goles pesa lo
// que unos 8 puntos en el total del básquet).
import * as D from './datos.js';
import { parseMarketId } from './analysis/catalog.js';
import { matchPlayer } from './analysis/players.js';

// Estadística de la pestaña Datos de cada mercado (total del partido o hándicap).
const TEAM_STAT = {
  football: { OU: 'goals', 'OU.corners': 'corners', 'OU.cards': 'cards', 'OU.shots': 'shots', 'OU.shots_on': 'shots_on', 'OU.corners@h1': 'corners_h1', 'HCP.corners': 'corners' },
  basketball: { OU: 'points', HCP: 'points' },
  baseball: { OU: 'runs', HCP: 'runs' },
};

// Exigencia: diferencia mínima (en desviaciones) y parte mínima de los partidos que
// pasaron la línea hacia ese lado.
export const LEVELS = {
  baja: { name: 'Baja', z: 0.25, hit: 0.55 },
  media: { name: 'Media', z: 0.4, hit: 0.6 },
  alta: { name: 'Alta', z: 0.6, hit: 0.7 },
};
// Partidos mínimos (en el hándicap, pares de partidos de uno y otro equipo).
const MIN_N = { total: 6, margin: 5 };
// Desviación mínima (con pocos partidos muy parecidos no se exagera la diferencia).
const MIN_SD = { total: 0.5, margin: 1 };

// Muestra de un mercado: { kind: 'total' | 'margin', values, stat, player }.
//  - total: el total del partido en los últimos `n` de cada equipo (todos, o el local
//    de local y la visita de visita), o lo del jugador en sus últimos `n`;
//  - margin (hándicap): diferencia del local en cada par (su partido i menos el i de
//    la visita), es decir, lo que suele sacar el local menos lo que suele sacar la visita.
export function sampleOf(data, sport, market, { n = 10, venue = 'all' } = {}) {
  const spec = parseMarketId(market);
  if (!data || !spec) return null;
  if (spec.t === 'OU' && /^pl_/.test(spec.stat)) {
    const player = matchPlayer(String(spec.n ?? ''), data.players || []);
    if (!player) return null;
    return { kind: 'total', values: D.playerSeries(D.playerGames(player, { n }), spec.stat).map((x) => x.value), stat: spec.stat, player: player.name };
  }
  const statId = TEAM_STAT[sport]?.[market];
  if (!statId || (spec.t !== 'OU' && spec.t !== 'HCP')) return null;
  const stat = D.statById(sport, statId);
  const home = D.pickMatches(data.home?.last, { n, venue: venue === 'split' ? 'home' : 'all' });
  const away = D.pickMatches(data.away?.last, { n, venue: venue === 'split' ? 'away' : 'all' });
  if (spec.t === 'OU') return { kind: 'total', values: [...D.seriesOf(home, stat, 'total'), ...D.seriesOf(away, stat, 'total')].map((x) => x.value), stat: statId };
  const margins = (list) => list.map((m) => stat.of(m)).filter(Boolean).map(([f, a]) => f - a);
  const mh = margins(home);
  const ma = margins(away);
  const k = Math.min(mh.length, ma.length);
  return { kind: 'margin', values: Array.from({ length: k }, (_, i) => mh[i] - ma[i]), stat: statId };
}

// Frente a la línea: { n, avg, sd, gap, z, up, down, upN, downN }. gap > 0 favorece
// Más (o al local en el hándicap, cuya línea es la del local: gana si diferencia +
// línea > 0); up/down: parte de los partidos que quedaron de cada lado.
export function evaluate(values, line, kind = 'total') {
  const xs = (values || []).filter(Number.isFinite);
  const n = xs.length;
  if (!n || !Number.isFinite(line)) return null;
  const avg = xs.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1)) : 0;
  const shift = kind === 'margin' ? line : -line;
  const gap = avg + shift;
  const upN = xs.filter((x) => x + shift > 0).length;
  const downN = xs.filter((x) => x + shift < 0).length;
  return { n, avg, sd, gap, z: gap / Math.max(sd, MIN_SD[kind] ?? 0.5), up: upN / n, down: downN / n, upN, downN };
}

// Líneas de un partido (las del análisis) agrupadas por mercado y línea, con la
// mejor cuota de cada opción: [{ market, line, sides: { over: oferta, under: ... } }].
export function lineGroups(lines = []) {
  const groups = new Map();
  for (const o of lines) {
    if (o.line == null || !Number.isFinite(o.price)) continue;
    const key = `${o.market}|${o.line}`;
    if (!groups.has(key)) groups.set(key, { market: o.market, line: o.line, sides: {} });
    const g = groups.get(key);
    if (!g.sides[o.sel] || o.price > g.sides[o.sel].price) g.sides[o.sel] = o;
  }
  return [...groups.values()];
}

// Errores de cuota de un análisis: por partido y mercado, el más fuerte, del más
// fuerte al más débil. dataOf(eventId) → datos del partido (expandMatchData) o null.
export function findErrors(analysis, dataOf, { n = 10, venue = 'all', level = 'media' } = {}) {
  const L = LEVELS[level] || LEVELS.media;
  const out = [];
  for (const [eventId, lines] of Object.entries(analysis?.lines || {})) {
    const ev = analysis.events?.[eventId];
    const data = ev ? dataOf(eventId) : null;
    if (!data) continue;
    const samples = new Map();
    const best = new Map();
    for (const g of lineGroups(lines)) {
      if (!samples.has(g.market)) samples.set(g.market, sampleOf(data, ev.sport, g.market, { n, venue }));
      const s = samples.get(g.market);
      if (!s || s.values.length < MIN_N[s.kind]) continue;
      const r = evaluate(s.values, g.line, s.kind);
      const [up, down] = s.kind === 'margin' ? ['home', 'away'] : ['over', 'under'];
      const sel = r.z >= L.z && r.up >= L.hit ? up : r.z <= -L.z && r.down >= L.hit ? down : null;
      if (!sel || !g.sides[sel]) continue;
      const pick = g.sides[sel];
      const other = g.sides[sel === up ? down : up] || null;
      const e = { eventId, ev, market: g.market, line: g.line, sel, label: pick.label, price: pick.price, source: pick.source, other, kind: s.kind, stat: s.stat, player: s.player || null, ...r, hits: sel === up ? r.upN : r.downN, strength: Math.abs(r.z) };
      if (!best.has(g.market) || e.strength > best.get(g.market).strength) best.set(g.market, e);
    }
    out.push(...best.values());
  }
  return out.sort((a, b) => b.strength - a.strength);
}

// Qué tan grande es la diferencia, en palabras.
export const strengthName = (z) => (Math.abs(z) >= 1 ? 'muy grande' : Math.abs(z) >= 0.6 ? 'grande' : 'moderada');
