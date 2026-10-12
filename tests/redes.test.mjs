import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURE_VERSION, FEATURES, upgradeFeatures } from '../docs/js/analysis/features.js';
import { MIN_SAMPLES } from '../docs/js/analysis/neural.js';
import { NETWORKS, NetworkSet, networkOf } from '../docs/js/analysis/networks.js';
import { MARKETS } from '../docs/js/analysis/picks.js';
import { rng } from '../docs/js/util.js';

const Z = FEATURES.indexOf('zLine');

// Filas donde la estadística dice 50 % pero el resultado depende de zLine:
// algo que la red puede aprender.
function rows(n, sport, market, seed = 3) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const z = r() * 2 - 1;
    const x = new Array(FEATURES.length).fill(0);
    x[Z] = z;
    return { sport, market, x, pBase: 0.5, y: r() < (z > 0 ? 0.85 : 0.15) ? 1 : 0, start: i, fv: FEATURE_VERSION };
  });
}

test('una red por tipo de mercado, con los nombres pedidos', () => {
  const ids = NETWORKS.map((n) => n.id);
  for (const id of ['Football_Goals_Model', 'Football_Corners_Model', 'Football_Cards_Model', 'Basketball_Totals_Model', 'Basketball_PlayerProps_Model', 'Baseball_Totals_Model']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(MARKETS.every((m) => ids.includes(m.net)));
  assert.equal(networkOf('football', 'OU.corners@h1'), 'Football_Corners_Model');
  assert.equal(networkOf('basketball', 'OU.pl_pra#Nikola Jokic'), 'Basketball_PlayerProps_Model');
  assert.equal(networkOf('basketball', 'OU'), 'Basketball_Totals_Model');
  assert.equal(networkOf('baseball', 'OU'), 'Baseball_Totals_Model');
  assert.equal(networkOf('football', '1X2'), null);
});

test('cada red aprende solo de sus mercados y corrige solo con suficientes resultados', () => {
  const set = NetworkSet.train([...rows(600, 'football', 'OU'), ...rows(60, 'football', 'OU.corners', 5)]);
  const st = Object.fromEntries(set.status().map((n) => [n.id, n]));
  assert.equal(st.Football_Goals_Model.samples, 600);
  assert.ok(st.Football_Goals_Model.trained, 'con 600 resultados y señal clara debe corregir');
  assert.equal(st.Football_Corners_Model.samples, 60);
  assert.equal(st.Football_Corners_Model.trained, false, `menos de ${MIN_SAMPLES}: no corrige`);
  assert.equal(st.Basketball_PlayerProps_Model.samples, 0);
  const x = new Array(FEATURES.length).fill(0);
  x[Z] = 0.9;
  const goals = { sport: 'football', market: 'OU', x, pBase: 0.5 };
  const corners = { sport: 'football', market: 'OU.corners', x, pBase: 0.5 };
  assert.ok(set.predict(goals) > 0.6, 'la red de goles corrige');
  assert.equal(set.predict(corners), 0.5, 'la de córners todavía no: queda la estadística');
  const s = set.summary();
  assert.equal(s.trained, 1);
  assert.equal(s.total, NETWORKS.length);
  // Se guarda y se lee igual.
  const copy = NetworkSet.fromJSON(JSON.parse(JSON.stringify(set.toJSON())));
  assert.ok(Math.abs(copy.predict(goals) - set.predict(goals)) < 1e-3);
  // Guardadas con otras variables: no se usan.
  assert.equal(NetworkSet.fromJSON({ ...set.toJSON(), featureVersion: FEATURE_VERSION - 1 }).summary().trained, 0);
});

test('las filas de versiones anteriores (mezcladas con las cuotas) no se usan para entrenar', () => {
  assert.equal(upgradeFeatures(new Array(39).fill(0), 2), null);
  assert.equal(upgradeFeatures(new Array(27).fill(0), 1), null);
  assert.equal(upgradeFeatures(new Array(FEATURES.length).fill(0), FEATURE_VERSION).length, FEATURES.length);
});
