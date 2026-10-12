import assert from 'node:assert/strict';
import test from 'node:test';
import { bestCombo, buildCombos, DEFAULT_SETTINGS, levelOf, selectPicks } from '../docs/js/analysis/picks.js';
import { rng } from '../docs/js/util.js';

const cand = (eventId, key, p, price, prices = { apuestatotal: price }, sport = 'football') => ({ eventId, key, sport, market: key.split('|')[0], p, best: { price, source: 'apuestatotal' }, prices });

test('niveles de confianza', () => {
  assert.equal(levelOf(0.85), 'alta');
  assert.equal(levelOf(0.75), 'moderada_alta');
  assert.equal(levelOf(0.65), 'moderada');
  assert.equal(levelOf(0.55), 'baja');
});

test('todos los mercados de cada partido, cada uno con su nivel (también Baja)', () => {
  const picks = selectPicks([
    cand(1, 'OU|over|2.5', 0.82, 1.85),
    cand(1, 'OU|under|2.5', 0.18, 1.95),
    cand(1, 'OU.corners|over|9.5', 0.74, 1.88),
    cand(1, 'OU.corners|under|9.5', 0.26, 1.88),
    cand(1, 'BTTS|yes|', 0.45, 1.9),
    cand(1, 'BTTS|no|', 0.55, 1.9),
    cand(1, 'OU.cards|over|0.5', 0.97, 1.02), // su mejor cuota está debajo de la mínima: no sale
    cand(1, 'OU.cards|under|0.5', 0.03, 12),
    cand(2, 'HCP|home|-4.5', 0.62, 1.7, undefined, 'basketball'),
    cand(2, 'HCP|away|-4.5', 0.38, 2.1, undefined, 'basketball'),
    cand(2, 'OU.pl_pts#LeBron James|over|24.5', 0.71, 1.87, undefined, 'basketball'),
    cand(2, 'OU.pl_pts#LeBron James|under|24.5', 0.29, 1.87, undefined, 'basketball'),
  ]);
  const got = picks.map((p) => [p.eventId, p.key, p.level]);
  for (const x of [
    [1, 'OU|over|2.5', 'alta'],
    [1, 'OU.corners|over|9.5', 'moderada_alta'],
    [1, 'BTTS|no|', 'baja'],
    [2, 'HCP|home|-4.5', 'moderada'],
    [2, 'OU.pl_pts#LeBron James|over|24.5', 'moderada_alta'],
  ])
    assert.ok(got.some((g) => g.join() === x.join()), `falta ${x.join()}`);
  assert.ok(!got.some((g) => g[1].startsWith('OU.cards')), 'cuota debajo de la mínima');
  assert.equal(new Set(picks.map((p) => `${p.eventId}|${p.market}`)).size, picks.length, 'un pick por mercado');
});

function bruteForce(options, target, maxLegs) {
  let best = null;
  const n = options.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const legs = options.filter((_, i) => mask & (1 << i));
    if (legs.length > maxLegs || new Set(legs.map((o) => o.eventId)).size !== legs.length) continue;
    const odds = legs.reduce((x, o) => x * o.price, 1);
    const p = legs.reduce((x, o) => x * o.p, 1);
    if (odds >= target && (!best || p > best.p)) best = { p, legs };
  }
  return best;
}

test('la combinada óptima coincide con la búsqueda exhaustiva', () => {
  const r = rng(42);
  for (let t = 0; t < 30; t++) {
    const options = Array.from({ length: 10 }, (_, i) => {
      const p = 0.62 + 0.33 * r();
      return { key: `k${i}`, eventId: Math.floor(i / 2), p, price: Math.round((1 / p) * (0.9 + 0.25 * r()) * 100) / 100 + 0.05 };
    });
    const dp = bestCombo(options, 5, 6);
    // Toda combinada con cuota >= 5 * 1.013 es alcanzable pese al redondeo hacia abajo.
    const bf = bruteForce(options, 5 * 1.013, 6);
    if (dp) assert.ok(dp.reduce((x, o) => x * o.price, 1) >= 5, 'nunca por debajo del objetivo');
    if (!bf) continue;
    const pDp = dp.reduce((x, o) => x * o.p, 1);
    assert.ok(pDp >= bf.p - 1e-12, `combinada subóptima: ${pDp} vs ${bf.p}`);
  }
});

test('combinadas por casa, cuota objetivo y sin repetir partido', () => {
  const candidates = [];
  for (let e = 0; e < 8; e++) {
    candidates.push(cand(e, 'OU.corners|over|8.5', 0.86, 1.3, { apuestatotal: 1.3, betano: 1.28 }));
    candidates.push(cand(e, 'OU|over|1.5', 0.78, 1.45, { apuestatotal: 1.45 }));
  }
  const combos = buildCombos(candidates, DEFAULT_SETTINGS);
  assert.ok(combos.length >= 2);
  for (const k of combos) {
    assert.ok(k.odds >= k.target, `cuota ${k.odds} < ${k.target}`);
    assert.equal(new Set(k.legs.map((l) => l.eventId)).size, k.legs.length);
    for (const l of k.legs) assert.ok(l.price > 1);
  }
  assert.ok(combos.some((k) => k.source === 'betano'));
});

test('los ajustes eligen cuáles de los mercados de la lista pueden salir en picks y combinadas', async () => {
  const { MARKETS, marketKey, acceptsOffer } = await import('../docs/js/analysis/picks.js');
  assert.equal(new Set(MARKETS.map((m) => m.id)).size, MARKETS.length);
  assert.ok(MARKETS.every((m) => m.net), 'cada mercado tiene su red especializada');
  assert.deepEqual(DEFAULT_SETTINGS.marketsOff, []);
  assert.equal(marketKey('basketball', 'OU.pl_reb#Jayson Tatum'), 'basketball:OU.player');
  assert.equal(marketKey('football', 'OU.corners@h1'), 'football:OU.corners@h1');
  // Líneas imposibles para el mercado: son de otro mercado mal leído.
  assert.ok(acceptsOffer('basketball', 'OU', 220.5) && !acceptsOffer('basketball', 'OU', 24.5));
  assert.ok(acceptsOffer('basketball', 'OU.pl_pts#X', 24.5) && !acceptsOffer('football', 'OU.pl_pts#X', 24.5));
  const list = [cand(1, 'OU.corners|over|8.5', 0.85, 1.4), cand(1, 'BTTS|yes|', 0.82, 1.3), cand(2, 'OU|over|1.5', 0.8, 1.35)];
  assert.equal(selectPicks(list).length, 3);
  const s = { ...DEFAULT_SETTINGS, marketsOff: ['football:OU.corners'] };
  assert.deepEqual(selectPicks(list, s).map((p) => p.key).sort(), ['BTTS|yes|', 'OU|over|1.5']);
  for (const k of buildCombos(list, { ...s, comboTargets: [1.5] })) assert.ok(k.legs.every((l) => !l.key.includes('corners')));
  // El mismo mercado en otro deporte es otro mercado: apagar los goles no apaga el total del básquet.
  const off = { ...DEFAULT_SETTINGS, marketsOff: ['football:OU'] };
  assert.equal(selectPicks([cand(3, 'OU|over|214.5', 0.7, 1.9, undefined, 'basketball'), cand(4, 'OU|over|2.5', 0.7, 1.9)], off).map((p) => p.eventId).join(), '3');
  // Apagar los de jugador.
  const noPlayers = { ...DEFAULT_SETTINGS, marketsOff: ['basketball:OU.player'] };
  assert.equal(selectPicks([cand(5, 'OU.pl_pts#X|over|20.5', 0.7, 1.9, undefined, 'basketball')], noPlayers).length, 0);
});
