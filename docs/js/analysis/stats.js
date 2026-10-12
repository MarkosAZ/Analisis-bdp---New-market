// Mercados de estadísticas de fútbol (córners, tarjetas, tiros al arco,
// remates): probabilidad del Más/Menos con los promedios de cada equipo en sus
// últimos partidos (lo que hace y lo que le permite el rival). Cada equipo
// sigue una binomial negativa (más dispersa que Poisson) con su media; las
// cuotas no intervienen.
import { FOOTBALL_STATS, statPriors } from './simulate.js';

// Partidos con datos de cada equipo para dar una probabilidad.
export const MIN_MATCHES = 4;

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

// Más/Menos del total del partido (scope 'ft') o del 1.er tiempo ('h1').
// spec: catalog.parseMarketId del mercado. Devuelve { p, n, home, away } (n:
// partidos con datos; home/away: medias usadas) o null si faltan datos.
export function statProbability(sport, teamStats, spec, sel, line) {
  const def = sport === 'football' ? FOOTBALL_STATS[spec?.stat] : null;
  if (!def || spec.t !== 'OU' || spec.team || !['ft', 'h1'].includes(spec.scope) || !Number.isFinite(line)) return null;
  const prior = statPriors(sport, teamStats, { shrink: 3 })[spec.stat];
  if (!prior || prior.n < MIN_MATCHES) return null;
  const share = spec.scope === 'h1' ? def.h1 : 1;
  const mh = prior.h * share;
  const ma = prior.a * share;
  const max = (m) => Math.ceil(m + 8 * Math.sqrt(m * (1 + m / (def.k || 1e9))) + 5);
  const ph = nbPmf(mh, def.k, max(mh));
  const pa = nbPmf(ma, def.k, max(ma));
  let over = 0;
  let total = 0;
  for (let i = 0; i < ph.length; i++) {
    for (let j = 0; j < pa.length; j++) {
      const w = ph[i] * pa[j];
      total += w;
      if (i + j > line) over += w;
    }
  }
  const pOver = over / total;
  return { p: sel === 'under' ? 1 - pOver : pOver, n: prior.n, home: mh, away: ma };
}
