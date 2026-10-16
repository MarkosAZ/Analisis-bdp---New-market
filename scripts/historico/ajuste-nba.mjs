// Ajuste del análisis estadístico de la NBA con los partidos históricos: modelo de
// puntos (BASKETBALL en models.js) y Más/Menos de jugador (PLAYERS en players.js).
// Se ajusta con las temporadas 2023-24 y 2024-25 y se comprueba con la 2025-26.
// Uso: node scripts/historico/ajuste-nba.mjs
import { replayNba } from './repeticion/nba.mjs';
import { BASKETBALL, pointsModel } from '../../docs/js/analysis/models.js';
import { PLAYERS, playerProbability, statValue } from '../../docs/js/analysis/players.js';
import { sportOf } from '../../docs/js/sports.js';

const cfg = sportOf('basketball');
const bce = (p, y) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const SPLIT = Date.parse('2025-08-01');
const cases = [...replayNba({ cases: true })];
console.log(`partidos: ${cases.length}`);

// ---- Equipos: total y hándicap a las líneas de la casa ----
function teamLoss(list, opts) {
  let ou = 0;
  let hcp = 0;
  let n = 0;
  for (const c of list) {
    const lo = c.plan.find((p) => p.market === 'OU').line;
    const lh = c.plan.find((p) => p.market === 'HCP').line;
    const m = pointsModel(c.ev, c.d, cfg, { lines: { OU: [lo], HCP: [lh] } }, opts);
    if (!m) continue;
    const pO = m.candidates.find((x) => x.market === 'OU' && x.sel === 'over').p;
    const pH = m.candidates.find((x) => x.market === 'HCP' && x.sel === 'home').p;
    const [h, a] = c.g.g;
    ou += bce(pO, h + a > lo ? 1 : 0);
    hcp += bce(pH, h - a + lh > 0 ? 1 : 0);
    n++;
  }
  return { ou: ou / n, hcp: hcp / n, sum: (ou + hcp) / n, n };
}

// ---- Jugadores ----
const props = [];
for (const c of cases) {
  const box = new Map();
  for (const side of c.g.players) for (const p of side) if (p.min > 0) box.set(p.name, p);
  const roster = new Map([...c.d.players.home.players, ...c.d.players.away.players].map((p) => [p.name, p]));
  for (const pl of c.plan) {
    const m = /^OU\.(pl_[a-z0-9]+)#(.+)$/.exec(pl.market);
    if (!m) continue;
    const row = box.get(m[2]);
    const v = row ? statValue(row, m[1]) : null;
    if (v == null) continue;
    props.push({ t: c.g.t, code: m[1], games: roster.get(m[2]).games, line: pl.line, y: v > pl.line ? 1 : 0 });
  }
}
console.log(`selecciones de jugador: ${props.length}`);
function playerLoss(list, opts) {
  let ll = 0;
  let n = 0;
  const by = {};
  for (const x of list) {
    const r = playerProbability(x.games, x.code, 'over', x.line, opts);
    if (!r) continue;
    const l = bce(r.p, x.y);
    ll += l;
    n++;
    (by[x.code] ||= [0, 0]);
    by[x.code][0] += l;
    by[x.code][1]++;
  }
  return { ll: ll / n, n, by };
}

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
  return best;
}

const fit = cases.filter((c) => c.g.t < SPLIT);
const test = cases.filter((c) => c.g.t >= SPLIT);
const fmtT = (r) => `total ${r.ou.toFixed(4)} · hándicap ${r.hcp.toFixed(4)} (n ${r.n})`;
console.log('\n== Equipos ==');
console.log(`actual   ajuste ${fmtT(teamLoss(fit, {}))} | prueba ${fmtT(teamLoss(test, {}))}`);
const T = search({ ...BASKETBALL }, { sdMargin: [0.055, 0.06, 0.065, 0.07, 0.08, 0.1], sdTotal: [0.07, 0.08, 0.09, 0.1, 0.12], ha: [1, 1.5, 2, 2.5, 3, 3.5], marginShrink: [0, 2, 5, 10, 20], decay: [0.8, 0.85, 0.9, 0.95, 1], venue: [0, 0.2, 0.4] }, (o) => teamLoss(fit, o).sum);
console.log(`elegido ${JSON.stringify(T)}`);
console.log(`nuevo    ajuste ${fmtT(teamLoss(fit, T))} | prueba ${fmtT(teamLoss(test, T))}`);
const always = (list) => {
  // Referencia: siempre 50 % (la línea de la casa es pareja).
  return Math.log(2);
};
console.log(`referencia 50 %: ${always().toFixed(4)}`);

console.log('\n== Jugadores ==');
const pf = props.filter((x) => x.t < SPLIT);
const pt = props.filter((x) => x.t >= SPLIT);
const a = playerLoss(pt, {});
console.log(`actual   ajuste ${playerLoss(pf, {}).ll.toFixed(4)} | prueba ${a.ll.toFixed(4)} (${a.n})`);
const P = search({ ...PLAYERS }, { temp: [0.5, 0.6, 0.7, 0.8, 0.9, 1], varScale: [0.9, 1, 1.1, 1.2, 1.4, 1.7], shrink: [0, 2, 5, 10], decay: [0.8, 0.85, 0.9, 0.95, 1] }, (o) => playerLoss(pf, o).ll);
const b = playerLoss(pt, P);
console.log(`elegido ${JSON.stringify(P)}`);
console.log(`nuevo    ajuste ${playerLoss(pf, P).ll.toFixed(4)} | prueba ${b.ll.toFixed(4)}`);
console.log('por estadística (prueba): ' + Object.keys(b.by).sort().map((k) => `${k} ${(a.by[k][0] / a.by[k][1]).toFixed(4)}→${(b.by[k][0] / b.by[k][1]).toFixed(4)}`).join(' · '));
