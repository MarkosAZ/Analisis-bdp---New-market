// Mercados de estadísticas de fútbol (córners, tarjetas, tiros al arco,
// remates): probabilidad del Más/Menos y del hándicap con los promedios de cada
// equipo en sus últimos partidos (lo que hace y lo que le permite el rival).
// Cada equipo sigue una binomial negativa (más dispersa que Poisson) con su
// media; las cuotas no intervienen.
import { FOOTBALL_STATS, statPriors } from './simulate.js';

// Partidos con datos de cada equipo para dar una probabilidad.
export const MIN_MATCHES = 4;

// Ajustes de los mercados de estadísticas del fútbol (elegidos con la prueba
// retrospectiva de unos 15 000 partidos; ver README). k 1000: Poisson (los remates
// varían como una Poisson; las tarjetas y los córners, algo más).
//  shrink: partidos "virtuales" con el promedio típico (FOOTBALL_STATS.mean).
//  Por estadística (corners, cards, shots, shots_on) se pueden cambiar k
//  (dispersión), h1 (parte del 1.er tiempo), mean (promedio típico), ratio
//  (ventaja de local), shrink y shrinkH1 (el del 1.er tiempo); sin cambiar, los
//  de simulate.js.
export const STATS = {
  shrink: 3,
  corners: { shrinkH1: 6 },
  cards: { k: 20 },
  shots: { k: 1000, shrink: 2 },
  shots_on: { k: 1000 },
};

// Binomial negativa (k = dispersión; sin k, Poisson) hasta `max`.
function nbPmf(mean, k, max) {
  const p = new Array(max + 1).fill(0);
  if (!k || k > 200) {
    p[0] = Math.exp(-mean);
    for (let i = 1; i <= max; i++) p[i] = (p[i - 1] * mean) / i;
    return p;
  }
  const q = k / (k + mean);
  p[0] = q ** k;
  for (let i = 1; i <= max; i++) p[i] = (p[i - 1] * (k + i - 1) * (1 - q)) / i;
  return p;
}

// Más/Menos del total (t 'OU') o hándicap (t 'HCP', line = la del local) del
// partido (scope 'ft') o del 1.er tiempo ('h1'). spec: catalog.parseMarketId del
// mercado. Devuelve { p, n, home, away, mean, sd } (n: partidos con datos;
// home/away: medias usadas; mean/sd: del total, o de la diferencia local − visita
// en el hándicap) o null si faltan datos.
export function statProbability(sport, teamStats, spec, sel, line, opts = {}) {
  const o = { ...STATS, ...opts };
  const def = sport === 'football' && FOOTBALL_STATS[spec?.stat] ? { ...FOOTBALL_STATS[spec.stat], ...(o[spec.stat] || {}) } : null;
  if (!def || !['OU', 'HCP'].includes(spec.t) || spec.team || !['ft', 'h1'].includes(spec.scope) || !Number.isFinite(line)) return null;
  const hcp = spec.t === 'HCP';
  if (hcp ? !['home', 'away'].includes(sel) : !['over', 'under'].includes(sel)) return null;
  const shrink = (spec.scope === 'h1' ? def.shrinkH1 : null) ?? def.shrink ?? o.shrink;
  const prior = statPriors(sport, teamStats, { shrink, only: spec.stat, def })[spec.stat];
  if (!prior || prior.n < MIN_MATCHES) return null;
  const share = spec.scope === 'h1' ? def.h1 : 1;
  const mh = prior.h * share;
  const ma = prior.a * share;
  const max = (m) => Math.ceil(m + 8 * Math.sqrt(m * (1 + m / (def.k || 1e9))) + 5);
  const ph = nbPmf(mh, def.k, max(mh));
  const pa = nbPmf(ma, def.k, max(ma));
  // Más/Menos: total > línea. Hándicap: local + línea > visita (gana el local).
  let yes = 0;
  let total = 0;
  for (let i = 0; i < ph.length; i++) {
    for (let j = 0; j < pa.length; j++) {
      const w = ph[i] * pa[j];
      total += w;
      if (hcp ? i - j + line > 0 : i + j > line) yes += w;
    }
  }
  const pYes = yes / total;
  const variance = (m) => m + (def.k ? (m * m) / def.k : 0);
  const p = sel === 'under' || sel === 'away' ? 1 - pYes : pYes;
  return { p, n: prior.n, home: mh, away: ma, mean: hcp ? mh - ma : mh + ma, sd: Math.sqrt(variance(mh) + variance(ma)) };
}
