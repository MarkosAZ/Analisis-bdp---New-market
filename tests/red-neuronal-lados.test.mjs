// Red neuronal: los dos lados de una línea suman lo mismo que antes de corregir. La
// red aprendió con el lado más probable según la estadística; el otro es lo que falta.
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMethod } from '../docs/js/analysis/engine.js';
import { selectPicks } from '../docs/js/analysis/picks.js';

const cand = (sel, pBase, line = 2.5, extra = {}) => ({ key: `OU|${sel}|${line}`, eventId: 'e1', sport: 'football', start: 0, market: 'OU', sel, line, pBase, x: [1], best: { price: 1.9, source: 'apuestatotal' }, ...extra });
// Red de prueba: le resta 10 puntos a lo que le pasen (a cada lado por separado, como antes).
const network = { forCandidate: () => ({ trained: true, predict: (x, p) => p - 0.1 }) };

test('red neuronal: el otro lado de la línea es lo que falta para 100 %', () => {
  const out = applyMethod([cand('over', 0.52), cand('under', 0.48)], 'red_neuronal', network);
  const [over, under] = out;
  assert.equal(Math.round(over.p * 100) / 100, 0.42, 'corrige el lado más probable según la estadística');
  assert.equal(Math.round(under.p * 100) / 100, 0.58, 'y el otro es 1 − p (antes daba 0.38: los dos por debajo de 50 %)');
  assert.equal(Math.round(under.ev * 1000) / 1000, Math.round((0.58 * 1.9 - 1) * 1000) / 1000);
  // El pick del mercado pasa a ser el otro lado, por encima de 50 %.
  const [pick] = selectPicks(out);
  assert.deepEqual([pick.sel, pick.p > 0.5], ['under', true]);
});

test('red neuronal: en una línea entera se respeta la probabilidad de que se devuelva', () => {
  // Más 50 % y Menos 40 %: 10 % de que quede justo en la línea.
  const [over, under] = applyMethod([cand('over', 0.5, 3), cand('under', 0.4, 3)], 'red_neuronal', network);
  assert.equal(Math.round(over.p * 100) / 100, 0.4);
  assert.equal(Math.round(under.p * 100) / 100, 0.5);
});

test('red neuronal: sin red entrenada o con el estadístico, nada cambia', () => {
  const base = [cand('over', 0.52), cand('under', 0.48)];
  assert.deepEqual(applyMethod(base, 'estadistico', network).map((c) => c.p), [0.52, 0.48]);
  const untrained = { forCandidate: () => null };
  assert.deepEqual(applyMethod(base, 'red_neuronal', untrained).map((c) => c.p), [0.52, 0.48]);
});
