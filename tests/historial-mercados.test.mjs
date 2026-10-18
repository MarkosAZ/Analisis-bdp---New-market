// Historial por tipo de mercado: las apuestas del día (los dos métodos y los errores
// de cuota, una vez cada una) agrupadas por tipo, y sus resultados de todos los días.
import assert from 'node:assert/strict';
import test from 'node:test';
import { byMarketType, daySummary, marketBets, marketTypeOf, marketTypeOfKey, sortedMarketTypes, statsOf, totals } from '../docs/js/history.js';

const bet = (eventId, sport, market, sel, line, status, odds, extra = {}) => ({ key: `${market}|${sel}|${line ?? ''}`, eventId, sport, start: Date.UTC(2026, 9, 17, 18), match: `Local ${eventId} vs Visita ${eventId}`, market, sel, line, label: `${market} ${sel} ${line ?? ''}`, status, odds, source: 'apuestatotal', ...extra });
const analysis = (id, method, created, picks) => ({ id, method, created, events: {}, picks, combos: [] });

const day = {
  date: '2026-10-17',
  analyses: [
    analysis('est-1', 'estadistico', '2026-10-17T10:00:00Z', [
      bet('e1', 'football', 'OU', 'over', 2.5, 'won', 1.9, { level: 'baja' }),
      bet('e1', 'football', 'OU.corners', 'under', 9.5, 'lost', 1.8, { level: 'moderada' }),
      bet('e2', 'basketball', 'OU.pl_pts#LeBron James', 'over', 24.5, 'won', 1.85, { level: 'baja' }),
      bet('e2', 'basketball', 'OU.pl_reb#LeBron James', 'under', 7.5, 'pending', 1.9, { level: 'baja' }),
    ]),
    analysis('rn-1', 'red_neuronal', '2026-10-17T10:00:00Z', [
      bet('e1', 'football', 'OU', 'over', 2.5, 'won', 1.9, { level: 'moderada' }),
      bet('e3', 'football', 'HCP3', 'away', -1, 'lost', 4.88, { level: 'alta' }),
    ]),
  ],
  errores: [bet('e1', 'football', 'OU.corners', 'over', 8.5, 'won', 1.85), bet('e4', 'football', 'OU', 'over', 2.5, 'pending', 1.7)],
  random: [{ id: 'rb-1', created: '2026-10-17T11:00:00Z', asked: 1, pool: 5, bets: [{ ...bet('e1', 'football', 'OU', 'over', 2.5, 'won', 1.9), from: ['estadistico'] }] }],
};

test('Por tipo de mercado: nombre y orden de cada tipo', () => {
  assert.deepEqual([marketTypeOf('football', 'OU').name, marketTypeOf('football', 'OU').key], ['Goles totales Más/Menos', 'football|OU']);
  assert.equal(marketTypeOf('football', 'OU.corners@h1').name, 'Córners en el primer tiempo Más/Menos');
  // Los de jugador, uno por estadística (sin el nombre del jugador).
  assert.deepEqual([marketTypeOf('basketball', 'OU.pl_pts#LeBron James').key, marketTypeOf('basketball', 'OU.pl_pts#Stephen Curry').name], ['basketball|OU.pl_pts', 'Jugador: puntos']);
  // Los de versiones anteriores, con el nombre del catálogo; del resumen guardado, igual.
  assert.equal(marketTypeOf('football', 'HCP3').name, 'Hándicap con empate');
  assert.deepEqual(marketTypeOfKey('basketball|OU.pl_pts'), marketTypeOf('basketball', 'OU.pl_pts#X'));
});

test('Por tipo de mercado: las apuestas del día una vez cada una, agrupadas en el orden de la lista', () => {
  const bets = marketBets(day);
  // Más de 2.5 de e1: del estadístico, de la red y no de Random Bets (es copia); con el nivel del primero.
  const over = bets.filter((b) => b.eventId === 'e1' && b.market === 'OU');
  assert.deepEqual([over.length, over[0].from, over[0].level], [1, ['estadistico', 'red_neuronal'], 'baja']);
  // El error de cuota de córners es otra apuesta (otro lado y otra línea) del mismo tipo.
  assert.equal(bets.length, 7);
  const groups = byMarketType(bets);
  assert.deepEqual(
    groups.map((g) => [g.name, g.bets.length]),
    [
      ['Goles totales Más/Menos', 2],
      ['Más/Menos córners', 2],
      ['Hándicap con empate', 1],
      ['Jugador: puntos', 1],
      ['Jugador: rebotes', 1],
    ],
  );
  // Córners: ganó el error de cuota (+0.85) y perdió el pick (−1).
  const corners = statsOf(groups[1].bets);
  assert.deepEqual([corners.won, corners.lost, corners.staked, Math.round(corners.profit * 100) / 100], [1, 1, 2, -0.15]);
  assert.deepEqual(marketBets(null), []);
});

test('Por tipo de mercado: en el resumen del día y en los totales de todos los días', () => {
  const s = daySummary(day);
  // El hándicap con empate ya no se analiza: se ve en su día pero no cuenta.
  assert.deepEqual(Object.keys(s.byMarket).sort(), ['basketball|OU.pl_pts', 'basketball|OU.pl_reb', 'football|OU', 'football|OU.corners']);
  assert.deepEqual([s.byMarket['football|OU'].won, s.byMarket['football|OU'].pending], [1, 1]);
  assert.equal(s.methods.red_neuronal.lost, 0, 'ni en los totales del método');
  // Sumar por tipo no cambia lo de cada método ni lo pendiente.
  assert.equal(s.pendingAll, daySummary({ ...day, analyses: day.analyses }).pendingAll);
  const t = totals({ days: { a: s, b: s, c: daySummary({ date: 'x', analyses: [] }) } });
  assert.deepEqual([t.byMarket['football|OU'].won, t.byMarket['basketball|OU.pl_pts'].won], [2, 2]);
  assert.deepEqual(
    sortedMarketTypes(t.byMarket).map((x) => x.name),
    ['Goles totales Más/Menos', 'Más/Menos córners', 'Jugador: puntos', 'Jugador: rebotes'],
  );
  // Desde una fecha: solo los días desde esa fecha.
  assert.deepEqual(Object.keys(totals({ days: { '2026-10-16': s, '2026-10-17': s } }, { from: '2026-10-17' }).byMarket).length, 4);
  assert.equal(totals({ days: { '2026-10-16': s, '2026-10-17': s } }, { from: '2026-10-17' }).byMarket['football|OU'].won, 1);
});
