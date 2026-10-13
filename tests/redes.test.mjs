import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURE_VERSION, FEATURES, upgradeFeatures } from '../docs/js/analysis/features.js';
import { Corrector, MIN_SAMPLES } from '../docs/js/analysis/neural.js';
import { NETWORKS, NetworkSet, networkOf } from '../docs/js/analysis/networks.js';
import { MARKETS } from '../docs/js/analysis/picks.js';
import { rng } from '../docs/js/util.js';
import { mergeRows, rowCandidates } from '../docs/js/history.js';

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

test('sin señal (resultado al azar según la estadística) la red casi nunca se acepta', () => {
  let accepted = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(1000 + seed);
    const data = Array.from({ length: 220 }, (_, i) => {
      const pBase = 0.5 + r() * 0.45;
      const x = FEATURES.map((f, k) => (k % 3 === 0 ? r() * 2 - 1 : k % 3 === 1 ? (r() < 0.5 ? 1 : 0) : r() * 0.004));
      return { x, pBase, y: r() < pBase ? 1 : 0, start: i };
    });
    const net = new Corrector({ inputs: FEATURES.length });
    const meta = net.train(data);
    assert.equal(meta.test, 132, 'el 60 % más reciente, predicho sin haberlo visto');
    if (net.trained) accepted++;
  }
  assert.ok(accepted <= 2, `aceptadas por azar: ${accepted} de 40`);
});

test('variables casi constantes entran como 0 y los valores raros se recortan', () => {
  const net = new Corrector({ inputs: 3 });
  net.setNorm([{ x: [0, 5, 1] }, { x: [2, 5, 1.001] }, { x: [4, 5, 0.999] }]);
  assert.deepEqual(net.std.map((v) => v > 0), [true, false, false]);
  const xn = net.norm([1000, 9, 50]);
  assert.equal(xn[0], 5);
  assert.equal(xn[1], 0);
  assert.equal(xn[2], 0);
  assert.equal(net.norm([-1000, 5, 1])[0], -5);
});

// ---- Filas de entrenamiento ----

test('filas: una por mercado (el lado más probable), sin los dos lados de la línea', () => {
  const c = (eventId, market, sel, line, pBase) => ({ eventId, market, sel, line, pBase, key: `${market}|${sel}|${line ?? ''}` });
  const rows = rowCandidates([
    c(1, 'OU', 'over', 2.5, 0.62),
    c(1, 'OU', 'under', 2.5, 0.38),
    c(1, 'OU', 'over', 3.5, 0.41),
    c(1, 'OU', 'under', 3.5, 0.59),
    c(1, 'BTTS', 'yes', null, 0.98), // fuera de la zona útil
    c(1, 'BTTS', 'no', null, 0.02),
    c(2, 'OU', 'over', 2.5, 0.45),
    c(2, 'OU', 'under', 2.5, 0.55),
  ]);
  assert.deepEqual(
    rows.map((r) => `${r.eventId}|${r.market}|${r.sel}|${r.line}`).sort(),
    ['1|OU|over|2.5', '2|OU|under|2.5'],
  );
});

test('filas: hasta 40 de jugador por partido, repartidas entre todas las probabilidades', () => {
  const list = [];
  for (let i = 0; i < 100; i++) list.push({ eventId: 7, market: `OU.pl_pts#Jugador ${i}`, sel: 'over', line: 10.5, pBase: 0.5 + (0.47 * i) / 99 });
  list.push({ eventId: 7, market: 'OU', sel: 'over', line: 220.5, pBase: 0.6 });
  const rows = rowCandidates(list);
  const players = rows.filter((r) => r.market.startsWith('OU.pl_'));
  assert.equal(players.length, 40);
  assert.equal(new Set(players.map((r) => r.market)).size, 40);
  const ps = players.map((r) => r.pBase);
  assert.ok(Math.min(...ps) < 0.52 && Math.max(...ps) > 0.94, 'de punta a punta, no solo las más altas');
  assert.ok(rows.some((r) => r.market === 'OU'), 'los del equipo no cuentan para el tope');
});

test('filas guardadas: la del último análisis hasta tener resultado', () => {
  const old = [
    { key: '1|OU', sel: 'over', line: 2.5, y: null },
    { key: '2|OU', sel: 'over', line: 2.5, y: 1 },
  ];
  const merged = mergeRows(old, [
    { key: '1|OU', sel: 'under', line: 3.5, y: null },
    { key: '2|OU', sel: 'under', line: 2.5, y: null },
    { key: '3|OU', sel: 'over', line: 1.5, y: null },
  ]);
  const by = Object.fromEntries(merged.map((r) => [r.key, r]));
  assert.deepEqual([by['1|OU'].sel, by['1|OU'].line], ['under', 3.5]);
  assert.deepEqual([by['2|OU'].sel, by['2|OU'].y], ['over', 1], 'con resultado no se cambia');
  assert.ok(by['3|OU']);
});
