// Reproducción histórica: cada partido pasado se analiza con el mismo código de la
// página (analyzeEvent) usando solo lo que se sabía antes de que empezara, y se
// liquida con el mismo código (legStatus). Salen filas de entrenamiento iguales a
// las que guarda la página (trainingRows) más el resultado real.
//
// Cuotas: donde hay cuotas reales (Más/Menos 2.5 goles de football-data.co.uk) se
// usan. En el resto, la línea es la que pondría una casa con un cálculo simple (la
// media reciente de ambos equipos o del jugador) y el precio sale de la propia
// probabilidad del modelo con un margen del 5 %. En esas filas las variables de
// cuotas (dMarket, hasMarket, lnOdds) quedan fijas: el precio sintético repite la
// probabilidad del modelo y la red aprendería a leer la cuota como si fuera ella
// (en la página, con cuotas reales, inflaría las selecciones de cuota larga). Una
// variable fija en el entrenamiento la red no la usa (neural.js, MIN_STD).
import fs from 'node:fs';
import path from 'node:path';
import { analyzeEvent } from '../../../docs/js/analysis/engine.js';
import { legStatus, trainingRows, yOf } from '../../../docs/js/history.js';
import { limaDateOf } from '../../../docs/js/util.js';
import { FEATURES } from '../../../docs/js/analysis/features.js';

export const DATA = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../data/historico');
export const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
export const listDir = (rel) => (fs.existsSync(path.join(DATA, rel)) ? fs.readdirSync(path.join(DATA, rel)).sort() : []);

export const MARGIN = 1.05;
// Variables de cuotas fijas de las filas con cuotas sintéticas: mercado parejo (50 %) con el margen.
const MARKET_X = { dMarket: 0, hasMarket: 1, lnOdds: Math.round(Math.log(1 / (0.5 * MARGIN)) * 1000) / 1000 };
const SOURCE = 'apuestatotal';

// Media línea más cercana a un valor (una casa pone la línea cerca de lo esperado).
export const halfLine = (x) => Math.floor(x) + 0.5;
// Línea pareja de un conteo con media `m`: algo por debajo de la media (la mediana de
// un conteo sesgado queda por debajo de su media).
export const countLine = (m) => Math.max(0.5, halfLine(m - 0.2));
export const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Ofertas de un par de selecciones a una línea con un precio provisional.
const pair = (market, [a, b], line, pa = 1.95, pb = 1.95) => [
  { source: SOURCE, market, sel: a, line, price: pa },
  { source: SOURCE, market, sel: b, line, price: pb },
];

// plan: [{ market, sels: [a, b], line }] mercados con cuotas sintéticas;
// real: ofertas reales (se usan tal cual).
// 1.º pasada: probabilidad del modelo en cada línea; 2.ª: precios con esa
// probabilidad y el margen (sin precio válido, el mercado no se ofrece).
// (La 1.ª pasada simula menos partidos: solo da el precio, y un error de un punto en
// él apenas mueve dMarket.)
export function analyzeReplay(ev, d, plan, { real = [], xg, simulations } = {}) {
  const first = analyzeEvent(ev, d, [...real, ...plan.flatMap((p) => pair(p.market, p.sels, p.line))], { xg, simulations: simulations ? Math.min(simulations, 2000) : simulations });
  const pOf = new Map(first.candidates.map((c) => [`${c.market}|${c.sel}|${c.line ?? ''}`, c.pModel]));
  const offers = [...real];
  for (const p of plan) {
    const pa = pOf.get(`${p.market}|${p.sels[0]}|${p.line ?? ''}`);
    const pb = pOf.get(`${p.market}|${p.sels[1]}|${p.line ?? ''}`);
    if (!(pa > 0) || !(pb > 0)) continue;
    const a = 1 / (pa * MARGIN);
    const b = 1 / (pb * MARGIN);
    if (a < 1.02 || b < 1.02) continue;
    offers.push(...pair(p.market, p.sels, p.line, Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000));
  }
  return analyzeEvent(ev, d, offers, { xg, simulations });
}

// Filas de entrenamiento de un partido con su resultado (y: 1, 0, 0.75, 0.25; -1 nula).
// synthetic: mercados con cuotas sintéticas (sus variables de cuotas quedan fijas).
export function rowsOf(ev, candidates, res, extra = {}, synthetic = new Set()) {
  const rows = trainingRows({ date: limaDateOf(ev.start), candidates, events: { [ev.id]: { url: null } } });
  const now = ev.start + 30 * 86400000;
  for (const r of rows) {
    const st = legStatus(r, res, now);
    r.y = st ? yOf(st.status) : -1;
    if (synthetic.has(r.market)) {
      r.x = [...r.x];
      for (const [name, v] of Object.entries(MARKET_X)) r.x[FEATURES.indexOf(name)] = v;
    }
    Object.assign(r, extra);
  }
  return rows;
}

// Resultado de un partido (lo que leería la página tras el partido).
export const finished = (score, record = null) => ({ state: 'finalizado', score: { home: score[0], away: score[1] }, ...(record ? { record: { state: 'finalizado', ...record } } : {}) });

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
