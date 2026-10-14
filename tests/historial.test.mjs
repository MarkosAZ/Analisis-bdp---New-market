import assert from 'node:assert/strict';
import test from 'node:test';
import { daySummary, totals, withPlayers } from '../docs/js/history.js';
import { settle } from '../docs/js/analysis/markets.js';

const pick = (eventId, key, level, status, odds = 1.5) => ({ eventId, key, level, status, odds });
const combo = (status, odds, legs) => ({ source: 'apuestatotal', status, odds, legs: legs.map(([eventId, key]) => ({ eventId, key })) });

const day = {
  date: '2026-10-02',
  analyses: [
    {
      id: 'est-1',
      method: 'estadistico',
      created: '2026-10-02T10:00:00Z',
      picks: [pick(1, '1X2|home|', 'alta', 'won', 1.4), pick(2, 'OU|over|2.5', 'moderada', 'lost', 1.9)],
      combos: [combo('lost', 5.2, [[1, '1X2|home|'], [2, 'OU|over|2.5']])],
    },
    {
      id: 'rn-1',
      method: 'red_neuronal',
      created: '2026-10-02T10:00:00Z',
      picks: [pick(1, '1X2|home|', 'alta', 'won', 1.4), pick(3, 'DC|1X|', 'moderada_alta', 'pending', 1.3)],
      combos: [],
    },
    // El mismo partido analizado otra vez más tarde: cuenta una sola vez (el último).
    {
      id: 'est-2',
      method: 'estadistico',
      created: '2026-10-02T15:00:00Z',
      picks: [pick(2, 'OU|over|2.5', 'moderada_alta', 'lost', 1.9)],
      combos: [combo('lost', 5.2, [[2, 'OU|over|2.5'], [1, '1X2|home|']])],
    },
  ],
};

test('resumen del día por método, sin repetir picks ni combinadas', () => {
  const s = daySummary(day);
  const est = s.methods.estadistico;
  const rn = s.methods.red_neuronal;
  assert.equal(est.n, 2);
  assert.equal(est.won, 1);
  assert.equal(est.lost, 1);
  assert.equal(est.byLevel.alta.won, 1);
  assert.equal(est.byLevel.moderada_alta.lost, 1, 'vale el nivel del análisis más reciente');
  assert.equal(est.byLevel.moderada, undefined);
  assert.equal(est.combos.n, 1);
  assert.ok(Math.abs(est.profit - (0.4 - 1)) < 1e-9);
  assert.equal(rn.n, 2);
  assert.equal(rn.pending, 1);
  assert.equal(rn.combos.n, 0);
  assert.equal(s.pendingAll, 1);
});

test('totales de varios días por método', () => {
  const s = daySummary(day);
  const t = totals({ days: { '2026-10-02': s, '2026-10-03': s } });
  assert.equal(t.methods.estadistico.n, 4);
  assert.equal(t.methods.estadistico.byLevel.alta.won, 2);
  assert.equal(t.methods.estadistico.combos.lost, 2);
  assert.equal(t.methods.red_neuronal.pending, 2);
});

test('medias apuestas, combinadas con medias y apuestas sin datos', async () => {
  const { comboOdds, comboStatus, legStatus, needsRecord } = await import('../docs/js/history.js');
  const s = daySummary({
    analyses: [{ id: 'est-9', method: 'estadistico', created: 'x', picks: [pick(1, 'OU|over|2.25', 'alta', 'half_won', 2), pick(2, 'HCP|home|-0.25', 'alta', 'half_lost', 1.9)], combos: [] }],
  });
  const est = s.methods.estadistico;
  assert.equal(est.won, 1);
  assert.equal(est.lost, 1);
  assert.ok(Math.abs(est.profit - (0.5 - 0.5)) < 1e-9);
  const k = { legs: [{ status: 'won', price: 1.5 }, { status: 'half_won', price: 2 }, { status: 'void', price: 3 }] };
  assert.equal(comboStatus(k), 'won');
  assert.equal(comboOdds(k), 1.5 * 1.5);
  assert.equal(needsRecord('OU'), false);
  assert.equal(needsRecord('OU.corners'), true);
  assert.equal(needsRecord('1X2@h1'), true);
  assert.equal(needsRecord('AND'), true);
  // Partido terminado sin estadísticas de córners: pendiente y, pasados 4 días, nula.
  const leg = { market: 'OU.corners', sel: 'over', line: 8.5, sport: 'football', start: Date.parse('2026-10-01T20:00:00Z') };
  const res = { state: 'finalizado', score: { home: 2, away: 1 } };
  assert.equal(legStatus(leg, res, leg.start + 3 * 3600000), null);
  assert.deepEqual(legStatus(leg, res, leg.start + 5 * 86400000), { status: 'void', noData: true });
  // Con el registro completo se liquida.
  const withRecord = { ...res, record: { state: 'finalizado', final: [2, 1], stats: { corners: { ft: [6, 4] } } } };
  assert.deepEqual(legStatus(leg, withRecord, leg.start + 3 * 3600000), { status: 'won' });
});

test('nivel Baja: su propia fila, fuera de los totales, pero se sigue liquidando', () => {
  const s = daySummary({
    date: '2026-10-12',
    analyses: [
      {
        id: 'est-9',
        method: 'estadistico',
        created: '2026-10-12T10:00:00Z',
        picks: [pick(1, 'OU|over|2.5', 'alta', 'won', 1.9), pick(1, 'BTTS|no|', 'baja', 'lost', 1.9), pick(2, 'OU.corners|over|9.5', 'baja', 'pending', 1.88)],
        combos: [],
      },
    ],
  });
  const est = s.methods.estadistico;
  assert.equal(est.n, 1, 'el total no incluye Baja');
  assert.equal(est.won, 1);
  assert.equal(est.byLevel.baja.n, 2);
  assert.equal(est.byLevel.baja.lost, 1);
  assert.equal(est.byLevel.baja.pending, 1);
  assert.equal(s.pendingAll, 1, 'un día con solo Baja pendiente se vuelve a revisar');
});

test('el mismo mercado analizado otra vez con otro lado o línea cuenta una sola vez', () => {
  const s = daySummary({
    date: '2026-10-03',
    analyses: [
      { id: 'a', method: 'estadistico', created: '2026-10-03T10:00:00Z', picks: [pick(5, 'OU|over|2.5', 'moderada', 'lost', 1.8), pick(5, 'BTTS|yes|', 'alta', 'won', 1.5)], combos: [] },
      { id: 'b', method: 'estadistico', created: '2026-10-03T16:00:00Z', picks: [pick(5, 'OU|under|3.5', 'moderada_alta', 'won', 1.6)], combos: [] },
    ],
  });
  const est = s.methods.estadistico;
  assert.equal(est.n, 2, 'OU del partido 5 una vez (el último) y BTTS');
  assert.equal(est.won, 2);
  assert.equal(est.byLevel.moderada?.n || 0, 0);
  assert.equal(est.byLevel.moderada_alta.n, 1);
});

test('NBA: con las estadísticas de ESPN se siguen liquidando el 1.er tiempo y los cuartos', () => {
  // Resultado publicado por GitHub Actions: marcador y cuartos del feed del día, sin registro completo.
  const published = { state: 'finalizado', score: { home: 110, away: 104, homeNT: null, awayNT: null }, per: [[30, 25], [28, 27], [26, 30], [26, 22]] };
  const players = { 'Cade Cunningham': { min: 36, pts: 27, reb: 6, ast: 9, tpm: 2 } };
  const res = withPlayers(published, players, 'basketball');
  const c = (market, sel, line) => ({ market, sel, line });
  // 1.er tiempo: 58 – 52 (110 puntos).
  assert.equal(settle(c('OU@h1', 'over', 109.5), res, 'basketball'), 'won');
  assert.equal(settle(c('HCP@h1', 'home', -5.5), res, 'basketball'), 'won');
  assert.equal(settle(c('HCP@h1', 'away', -5.5), res, 'basketball'), 'lost'); // la línea es la del local
  assert.equal(settle(c('OU', 'under', 215.5), res, 'basketball'), 'won');
  assert.equal(settle(c('OU.pl_pts#Cade Cunningham', 'over', 24.5), res, 'basketball'), 'won');
  // Sin marcador publicado: solo se liquidan las de jugador (el resto espera el resultado).
  const early = withPlayers({}, players, 'basketball');
  assert.equal(settle(c('OU.pl_pts#Cade Cunningham', 'under', 24.5), early, 'basketball'), 'lost');
  assert.equal(settle(c('OU@h1', 'over', 109.5), early, 'basketball'), null);
});
