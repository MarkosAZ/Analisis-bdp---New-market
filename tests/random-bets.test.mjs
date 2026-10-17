// Random Bets (Historial): sorteo entre todas las apuestas del día (picks de los dos
// métodos y errores de cuota), guardado y liquidado como las demás.
import assert from 'node:assert/strict';
import test from 'node:test';
import { daySummary, drawRandom, randomInt, randomPool, totals } from '../docs/js/history.js';

const NOW = Date.UTC(2026, 9, 17, 12);
const LATER = NOW + 3 * 3600000;
const bet = (eventId, market, sel, line, odds, extra = {}) => ({ key: `${market}|${sel}|${line ?? ''}`, eventId, sport: 'football', start: LATER, match: `Local ${eventId} vs Visita ${eventId}`, market, sel, line, label: `${market} ${sel} ${line}`, status: 'pending', odds, source: 'apuestatotal', ...extra });
const analysis = (id, method, created, picks) => ({ id, method, created, events: {}, picks: picks.map((p) => ({ level: 'moderada', p: 0.6, ...p })), combos: [] });

const day = {
  date: '2026-10-17',
  analyses: [
    analysis('est-1', 'estadistico', '2026-10-17T10:00:00Z', [bet('e1', 'OU', 'over', 2.5, 1.8), bet('e2', '1X2', 'home', null, 2.1), bet('e3', 'BTTS', 'yes', null, 1.9)]),
    analysis('rn-1', 'red_neuronal', '2026-10-17T10:00:00Z', [bet('e1', 'OU', 'over', 2.5, 1.85, { source: 'betano' }), bet('e4', 'OU', 'under', 3.5, 1.6)]),
    // e3 se volvió a analizar: vale lo último (otra selección) y lo de antes no se sortea.
    analysis('est-2', 'estadistico', '2026-10-17T11:00:00Z', [bet('e3', 'BTTS', 'no', null, 1.95)]),
  ],
  errores: [bet('e1', 'OU', 'over', 2.5, 1.8), bet('e5', 'OU.corners', 'over', 8.5, 1.9), bet('e6', 'OU', 'under', 2.5, 2), bet('e7', 'OU', 'over', 1.5, 1.4, { start: NOW - 60000 }), bet('e8', 'OU', 'over', 1.5, 1.4, { status: 'won' })],
};

test('Random Bets: entran los picks de los dos métodos y los errores de cuota, una vez cada uno', () => {
  const pool = randomPool(day, NOW);
  const by = Object.fromEntries(pool.map((b) => [`${b.eventId}|${b.market}|${b.sel}`, b]));
  assert.deepEqual(Object.keys(by).sort(), ['e1|OU|over', 'e2|1X2|home', 'e3|BTTS|no', 'e4|OU|under', 'e5|OU.corners|over', 'e6|OU|under']);
  // La misma apuesta del estadístico, de la red y de un error de cuota: una sola, con la mejor cuota.
  assert.deepEqual([by['e1|OU|over'].from, by['e1|OU|over'].odds, by['e1|OU|over'].source], [['estadistico', 'red_neuronal', 'errores'], 1.85, 'betano']);
  assert.deepEqual([by['e5|OU.corners|over'].from, by['e5|OU.corners|over'].status], [['errores'], 'pending']);
  // Ni los partidos que ya empezaron ni las liquidadas; sin el día, nada.
  assert.ok(!pool.some((b) => b.eventId === 'e7' || b.eventId === 'e8'));
  assert.deepEqual(randomPool(null, NOW), []);
  assert.deepEqual(randomPool(day, LATER + 1), [], 'cuando todos empezaron');
});

test('Random Bets: el sorteo da las que se piden, distintas y sin dos del mismo mercado de un partido', () => {
  const pool = [...randomPool(day, NOW), { ...bet('e2', '1X2', 'away', null, 3.4), from: ['estadistico'] }];
  for (let i = 0; i < 200; i++) {
    const out = drawRandom(pool, 4);
    assert.equal(out.length, 4);
    assert.equal(new Set(out.map((b) => `${b.eventId}|${b.market}`)).size, 4);
  }
  // Más de las que hay: todas las de mercados distintos (6 de 7).
  assert.equal(drawRandom(pool, 50).length, 6);
  // Con un sorteo fijo: Fisher-Yates intercambia el último con el elegido.
  const fixed = drawRandom(['a', 'b', 'c'].map((id) => ({ eventId: id, market: 'OU', from: ['errores'] })), 3, (n) => n - 1);
  assert.deepEqual(fixed.map((b) => b.eventId), ['a', 'b', 'c']);
  const first = drawRandom(['a', 'b', 'c'].map((id) => ({ eventId: id, market: 'OU', from: ['errores'] })), 1, () => 0);
  assert.deepEqual(first.map((b) => b.eventId), ['b']);
});

test('Random Bets: cada apuesta tiene la misma probabilidad (generador criptográfico)', () => {
  for (const n of [1, 2, 3, 7, 1000]) {
    for (let i = 0; i < 200; i++) {
      const x = randomInt(n);
      assert.ok(Number.isInteger(x) && x >= 0 && x < n, `${x} de ${n}`);
    }
  }
  // 12 000 sorteos de 1 entre 6 apuestas: cada una sale cerca de 2000 veces.
  const pool = randomPool(day, NOW);
  const count = new Map();
  for (let i = 0; i < 12000; i++) {
    const [b] = drawRandom(pool, 1);
    count.set(b.eventId, (count.get(b.eventId) || 0) + 1);
  }
  assert.equal(count.size, 6);
  for (const [id, c] of count) assert.ok(c > 1750 && c < 2250, `${id}: ${c}`);
});

test('Random Bets: cada mercado tiene la misma probabilidad aunque los análisis manden dos opciones', () => {
  // A: Más y Menos de 2.5 (del estadístico y de la red); B y C: una opción cada uno.
  const pool = [
    { ...bet('A', 'OU', 'over', 2.5, 1.9), from: ['estadistico'] },
    { ...bet('A', 'OU', 'under', 2.5, 1.9), from: ['red_neuronal'] },
    { ...bet('B', '1X2', 'home', null, 2), from: ['estadistico'] },
    { ...bet('C', 'BTTS', 'yes', null, 1.8), from: ['errores'] },
  ];
  const one = new Map();
  const two = new Map();
  const N = 12000;
  for (let i = 0; i < N; i++) {
    const [b] = drawRandom(pool, 1);
    one.set(`${b.eventId}|${b.sel}`, (one.get(`${b.eventId}|${b.sel}`) || 0) + 1);
    for (const x of drawRandom(pool, 2)) two.set(x.eventId, (two.get(x.eventId) || 0) + 1);
  }
  // Una: cada mercado 1/3; en A, cada opción 1/6.
  for (const [k, share] of [['A|over', 1 / 6], ['A|under', 1 / 6], ['B|home', 1 / 3], ['C|yes', 1 / 3]]) assert.ok(Math.abs(one.get(k) / N - share) < 0.02, `${k}: ${one.get(k)}`);
  // Dos: cada mercado sale en 2 de cada 3 sorteos (B no sale siempre).
  for (const id of ['A', 'B', 'C']) assert.ok(Math.abs(two.get(id) / N - 2 / 3) < 0.02, `${id}: ${two.get(id)}`);
});

test('Random Bets: en el resumen del día y en los totales, aparte de los métodos', () => {
  const draws = [
    { id: 'rb-1', created: '2026-10-17T11:30:00Z', asked: 2, pool: 6, bets: [{ ...bet('e1', 'OU', 'over', 2.5, 1.85), status: 'won', from: ['estadistico'] }, { ...bet('e9', 'ML', 'home', null, 1.5, { sport: 'basketball' }), status: 'lost', from: ['errores'] }] },
    { id: 'rb-2', created: '2026-10-17T11:40:00Z', asked: 1, pool: 6, bets: [{ ...bet('e4', 'OU', 'under', 3.5, 1.6), from: ['red_neuronal'] }] },
  ];
  const s = daySummary({ ...day, random: draws });
  assert.deepEqual([s.random.n, s.random.won, s.random.lost, s.random.pending, s.random.draws], [3, 1, 1, 1, 2]);
  assert.deepEqual([s.random.bySport.football.won, s.random.bySport.basketball.lost], [1, 1]);
  assert.equal(Math.round(s.random.profit * 100) / 100, -0.15);
  assert.equal(s.pendingAll, s.pending + (s.byLevel.baja?.pending || 0) + s.errores.pending + 1, 'lo pendiente de los sorteos también se busca al actualizar');
  assert.equal(daySummary(day).random, undefined);
  const t = totals({ days: { a: s, b: s, c: daySummary(day) } });
  assert.deepEqual([t.random.won, t.random.lost, t.random.bySport.basketball.lost, t.all.n], [2, 2, 2, 2 * s.n + daySummary(day).n]);
});
