// Ajuste del análisis estadístico del fútbol con los partidos históricos: busca los
// ajustes del modelo de goles (FOOTBALL en models.js) y de los mercados de
// estadísticas (STATS en stats.js) que bajan la pérdida logarítmica. Se ajusta con
// los partidos hasta junio de 2025 y se comprueba con los posteriores.
// Uso: node scripts/historico/ajuste-futbol.mjs
import { footballCases } from './repeticion/futbol.mjs';
import { FOOTBALL, goalsModel } from '../../docs/js/analysis/models.js';
import { STATS, statProbability } from '../../docs/js/analysis/stats.js';
import { FOOTBALL_STATS } from '../../docs/js/analysis/simulate.js';
import { parseMarketId } from '../../docs/js/analysis/catalog.js';
import { sportOf } from '../../docs/js/sports.js';

const cfg = sportOf('football');
const bce = (p, y) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const SPLIT = Date.parse('2025-07-01');
const cases = [...footballCases()];
const fit = cases.filter((c) => c.m.t < SPLIT);
const test = cases.filter((c) => c.m.t >= SPLIT);
console.log(`partidos: ${cases.length} (ajuste ${fit.length}, prueba ${test.length})`);

// ---- Goles: Más/Menos (línea de la casa o la real 2.5) y ambos anotan ----
function goalsLoss(list, opts) {
  let ou = 0;
  let btts = 0;
  let n = 0;
  let mkt = 0;
  let mod = 0;
  let nm = 0;
  for (const c of list) {
    const line = c.real.length ? 2.5 : c.plan.find((p) => p.market === 'OU')?.line;
    const m = goalsModel(c.ev, c.d, cfg, { xg: c.xg, lines: { OU: [line] } }, opts);
    if (!m || Math.min(m.form.home.n, m.form.away.n) < 4) continue;
    const pOver = m.candidates.find((x) => x.market === 'OU' && x.sel === 'over' && x.line === line).p;
    const pYes = m.candidates.find((x) => x.market === 'BTTS' && x.sel === 'yes').p;
    const [h, a] = c.m.ft;
    const yOver = h + a > line ? 1 : 0;
    ou += bce(pOver, yOver);
    btts += bce(pYes, h > 0 && a > 0 ? 1 : 0);
    n++;
    if (c.real.length) {
      const o = c.real.find((x) => x.sel === 'over').price;
      const u = c.real.find((x) => x.sel === 'under').price;
      mkt += bce(1 / o / (1 / o + 1 / u), yOver);
      mod += bce(pOver, yOver);
      nm++;
    }
  }
  return { ou: ou / n, btts: btts / n, sum: (ou + btts) / n, n, mkt: mkt / nm, mod: mod / nm, nm };
}

// ---- Estadísticas ----
const STAT_MARKETS = { corners: ['OU.corners', 'HCP.corners', 'OU.corners@h1'], cards: ['OU.cards'], shots: ['OU.shots'], shots_on: ['OU.shots_on'] };
const outcome = (c, market, line) => {
  const spec = parseMarketId(market);
  const v = c.m.stats?.[spec.stat]?.[spec.scope];
  if (!v) return null;
  if (spec.t === 'HCP') return v[0] - v[1] + line > 0 ? 1 : 0;
  return v[0] + v[1] > line ? 1 : 0;
};
function statLoss(list, stat, opts) {
  const out = {};
  for (const market of STAT_MARKETS[stat]) {
    let ll = 0;
    let n = 0;
    const spec = parseMarketId(market);
    for (const c of list) {
      const plan = c.plan.find((p) => p.market === market);
      if (!plan || !c.d.teamStats) continue;
      const y = outcome(c, market, plan.line);
      if (y == null) continue;
      const r = statProbability('football', c.d.teamStats, spec, spec.t === 'HCP' ? 'home' : 'over', plan.line, opts);
      if (!r) continue;
      ll += bce(r.p, y);
      n++;
    }
    out[market] = { ll: ll / n, n };
  }
  out.sum = Object.values(out).reduce((s, x) => s + x.ll, 0);
  return out;
}

// Búsqueda por coordenadas: cada ajuste en su grilla, manteniendo los demás.
function search(start, grid, loss) {
  let best = { ...start };
  let bestLoss = loss(best);
  for (let round = 0; round < 2; round++) {
    for (const [k, values] of Object.entries(grid)) {
      for (const v of values) {
        const cand = { ...best, [k]: v };
        const l = loss(cand);
        if (l < bestLoss - 1e-6) {
          bestLoss = l;
          best = cand;
        }
      }
    }
  }
  return { best, bestLoss };
}

// Ajustes anteriores (para comparar).
const OLD_GOALS = { prior: 3, ha: 1.2, xgWeight: 0.5, rho: -0.08, venue: 0.4, decay: 0.85, stretch: 1, totalScale: 1, ouT: 1, bttsT: 1, bttsShift: 0 };
const OLD_STATS = { shrink: 3, corners: {}, cards: {}, shots: {}, shots_on: {} };
const fmtG = (r) => `Más/Menos ${r.ou.toFixed(4)} · ambos anotan ${r.btts.toFixed(4)} · suma ${r.sum.toFixed(4)} (n ${r.n}; con cuotas reales ${r.nm}: casa ${r.mkt.toFixed(4)} vs análisis ${r.mod.toFixed(4)})`;
console.log('\n== Goles ==');
console.log(`anterior ajuste: ${fmtG(goalsLoss(fit, OLD_GOALS))}\n         prueba: ${fmtG(goalsLoss(test, OLD_GOALS))}`);
const G = search({ ...FOOTBALL }, { ouT: [0.5, 0.6, 0.7, 0.8, 0.9, 1], bttsT: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1], bttsShift: [-0.2, -0.15, -0.1, -0.05, 0, 0.05], prior: [3, 6, 10, 15, 25, 40], ha: [1.1, 1.15, 1.2, 1.25, 1.3], xgWeight: [0, 0.3, 0.5, 0.7, 0.85], rho: [-0.12, -0.08, -0.04, 0], venue: [0, 0.2, 0.4], decay: [0.8, 0.85, 0.9, 0.95, 1], stretch: [0.8, 0.9, 1, 1.1, 1.2], totalScale: [0.96, 1, 1.04] }, (o) => goalsLoss(fit, o).sum);
console.log(`elegido ${JSON.stringify(G.best)}`);
console.log(`nuevo   ajuste: ${fmtG(goalsLoss(fit, G.best))}\n        prueba: ${fmtG(goalsLoss(test, G.best))}`);

console.log('\n== Estadísticas ==');
const fmtS = (r) => Object.entries(r).filter(([k]) => k !== 'sum').map(([k, v]) => `${k} ${v.ll.toFixed(4)} (${v.n})`).join(' · ');
const chosen = {};
for (const stat of Object.keys(STAT_MARKETS)) {
  const def = FOOTBALL_STATS[stat];
  const base = { k: def.k, h1: def.h1, mean: def.mean, shrink: STATS.shrink, ...(STATS[stat] || {}) };
  // La ventaja de local solo la mide el hándicap (en un total casi no cambia nada).
  const grid = { shrink: [1, 2, 3, 6, 10, 15], k: [4, 6, 8, 12, 20, 40, 1000], mean: [def.mean * 0.9, def.mean, def.mean * 1.1] };
  if (stat === 'corners') Object.assign(grid, { ratio: [1, 1.1, 1.25, 1.4, 1.6], h1: [0.41, 0.43, 0.45, 0.47, 0.49], shrinkH1: [1, 2, 3, 6] });
  const loss = (o) => statLoss(fit, stat, { [stat]: o }).sum;
  const S = search(base, grid, loss);
  chosen[stat] = S.best;
  console.log(`${stat}: anterior ajuste ${fmtS(statLoss(fit, stat, OLD_STATS))} | prueba ${fmtS(statLoss(test, stat, OLD_STATS))}`);
  console.log(`${stat}: elegido ${JSON.stringify(S.best)}`);
  console.log(`${stat}: nuevo   ajuste ${fmtS(statLoss(fit, stat, { [stat]: S.best }))} | prueba ${fmtS(statLoss(test, stat, { [stat]: S.best }))}`);
}
console.log(`\nSTATS elegidos: ${JSON.stringify(chosen)}`);

// Por periodos (que el ajuste no dependa de unos meses).
const PERIODS = { 'hasta jun 2024': (t) => t < Date.parse('2024-07-01'), 'jul 2024 - jun 2025': (t) => t >= Date.parse('2024-07-01') && t < SPLIT, 'desde jul 2025': (t) => t >= SPLIT };
console.log('\n== Por periodos ==');
for (const [name, f] of Object.entries(PERIODS)) {
  const list = cases.filter((c) => f(c.m.t));
  const a = goalsLoss(list, OLD_GOALS);
  const b = goalsLoss(list, G.best);
  const sa = Object.keys(STAT_MARKETS).reduce((s, k) => s + statLoss(list, k, OLD_STATS).sum, 0);
  const sb = Object.keys(STAT_MARKETS).reduce((s, k) => s + statLoss(list, k, { [k]: chosen[k] }).sum, 0);
  console.log(`${name}: goles ${a.sum.toFixed(4)} → ${b.sum.toFixed(4)} · estadísticas (suma de 6 mercados) ${sa.toFixed(4)} → ${sb.toFixed(4)} (${list.length} partidos)`);
}
