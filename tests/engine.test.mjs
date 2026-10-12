import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeEvent } from '../docs/js/analysis/engine.js';
import { FEATURES } from '../docs/js/analysis/features.js';
import { offersFromApuestaTotal, offersFromBetano, offersFromSofascore } from '../docs/js/analysis/markets.js';
import { Corrector } from '../docs/js/analysis/neural.js';
import { buildCombos, DEFAULT_SETTINGS, marketsOf, selectPicks } from '../docs/js/analysis/picks.js';
import { compactAnalysis, daySummary, trainingRows } from '../docs/js/history.js';

const last = (pairs, start = Date.parse('2026-09-28T12:00:00Z')) =>
  pairs.map(([gf, ga], i) => ({ start: start - i * 7 * 864e5, home: i % 2 === 0, gf, ga, r: gf > ga ? 'W' : gf < ga ? 'L' : 'D' }));

const ev = {
  id: 101,
  sport: 'football',
  start: Date.parse('2026-10-02T18:45:00Z'),
  tournament: { id: 10783, name: 'UEFA Nations League' },
  category: { name: 'Europe' },
  home: { id: 1, name: 'Belgium', short: 'Belgium' },
  away: { id: 2, name: 'Türkiye', short: 'Türkiye' },
  state: 'pendiente',
};

const details = {
  lastHome: last([[3, 1], [2, 0], [1, 1], [4, 0], [2, 1], [0, 1], [3, 0], [2, 2], [1, 0], [2, 0]]),
  lastAway: last([[1, 1], [0, 2], [2, 1], [1, 3], [0, 0], [1, 2], [2, 2], [0, 1], [1, 1], [3, 2]]),
  h2h: { homeWins: 3, draws: 1, awayWins: 1 },
  missing: { home: [], away: [{ player: 'X' }, { player: 'Y' }] },
  votes: { home: 0.68, draw: 0.17, away: 0.15 },
  odds: [
    { name: 'Full time', group: null, choices: [{ name: '1', price: 1.5 }, { name: 'X', price: 4.4 }, { name: '2', price: 6 }] },
    { name: 'Match goals', group: '2.5', choices: [{ name: 'Over', price: 1.45 }, { name: 'Under', price: 2.7 }] },
  ],
};

const goals = (lines) => ({ name: 'Total de goles', type: 'OU200', selections: lines.flatMap(([l, over, under]) => [{ name: `Más de ${l}`, price: over }, { name: `Menos de ${l}`, price: under }]) });
const atMarkets = [
  { name: 'Resultado del partido (1X2)', type: 'ML0', selections: [{ name: 'Empate', price: 4.55 }, { name: 'Bélgica', price: 1.52 }, { name: 'Turquía', price: 5.3 }] },
  goals([[1.5, 1.13, 5.9], [2.5, 1.75, 1.8], [3.5, 1.9, 2.05], [2.25, 1.6, 2.3], [3, 1.85, 1.85]]),
  { name: 'Ambos equipos anotan', type: 'QA158', selections: [{ name: 'Sí', price: 1.56 }, { name: 'No', price: 2.37 }] },
  { name: 'Doble Oportunidad', type: 'QA61', selections: [{ name: 'Bélgica o Empate', price: 1.17 }, { name: 'Empate o Turquía', price: 2.47 }, { name: 'Bélgica o Turquía', price: 1.21 }] },
];
const AT_TEAMS = { home: 'Bélgica', away: 'Turquía' };

function offers(markets = atMarkets) {
  return [...offersFromSofascore(details.odds, ev), ...offersFromApuestaTotal(markets, AT_TEAMS, ev)];
}
const byKey = (candidates) => Object.fromEntries(candidates.map((c) => [c.key, c]));

test('solo los mercados de la lista, con la línea .5 más pareja de cada casa', () => {
  const { model, candidates } = analyzeEvent(ev, details, offers(), {});
  assert.ok(model, 'debe haber modelo con 10 partidos por equipo');
  // Más 2.5 @1.75 / Menos 2.5 @1.80 (diferencia 0.05) gana a 3.5 (0.15), a 1.5
  // y a las líneas entera (3) y asiática (2.25), que no se analizan.
  assert.deepEqual(candidates.map((c) => c.key).sort(), ['BTTS|no|', 'BTTS|yes|', 'OU|over|2.5', 'OU|under|2.5']);
  const allowed = marketsOf('football');
  for (const c of candidates) {
    assert.ok(allowed.has(c.market));
    assert.equal(c.x.length, FEATURES.length);
    assert.ok(c.x.every(Number.isFinite));
    assert.ok(c.p > 0 && c.p < 1);
    assert.equal(c.p, c.pBase, 'el análisis estadístico usa la probabilidad base');
    assert.equal(c.pBase, c.pModel, 'la probabilidad es la de la estadística');
    assert.deepEqual(Object.keys(c.prices), ['apuestatotal'], 'Sofascore es solo de referencia');
  }
  const by = byKey(candidates);
  assert.equal(by['OU|over|2.5'].best.price, 1.75);
  assert.equal(by['OU|over|2.5'].label, 'Más de 2.5 goles');
  assert.ok(Math.abs(by['OU|over|2.5'].p + by['OU|under|2.5'].p - 1) < 1e-9, 'solo pasa una de las dos');
  assert.ok(by['OU|over|2.5'].factors.some((f) => f === 'Línea más pareja: Apuesta Total Más 1.75 / Menos 1.80'));
});

test('la probabilidad sale de la estadística: las cuotas no la cambian', () => {
  const a = byKey(analyzeEvent(ev, details, offers([goals([[2.5, 1.43, 2.79]])]), {}).candidates);
  const b = byKey(analyzeEvent(ev, details, offers([goals([[2.5, 2.2, 1.65]])]), {}).candidates);
  assert.equal(a['OU|over|2.5'].p, b['OU|over|2.5'].p);
  assert.ok(a['OU|over|2.5'].pMarket > 0.6 && b['OU|over|2.5'].pMarket < 0.45, 'lo que dicen las cuotas queda solo como referencia');
});

test('cada casa elige su línea por separado; si coinciden, se compara la cuota', () => {
  const betano = [
    { name: 'Goles totales Más/Menos', selections: [{ name: 'Más de 2.5', price: 1.5 }, { name: 'Menos de 2.5', price: 2.6 }, { name: 'Más de 3.5', price: 1.95 }, { name: 'Menos de 3.5', price: 1.85 }] },
    { name: 'Ambos equipos anotan', selections: [{ name: 'Sí', price: 1.6 }, { name: 'No', price: 2.3 }] },
  ];
  const all = [...offers(), ...offersFromBetano(betano, { home: 'Belgium', away: 'Türkiye' }, ev)];
  const by = byKey(analyzeEvent(ev, details, all, {}).candidates);
  assert.deepEqual(by['OU|over|2.5'].prices, { apuestatotal: 1.75 }, 'Betano no usa la 2.5 (su línea pareja es 3.5)');
  assert.deepEqual(by['OU|over|3.5'].prices, { betano: 1.95 });
  assert.deepEqual(by['BTTS|yes|'].prices, { apuestatotal: 1.56, betano: 1.6 });
  assert.equal(by['BTTS|yes|'].best.source, 'betano');
});

test('sin líneas .5 no hay candidatos de ese mercado', () => {
  const { candidates } = analyzeEvent(ev, details, offers([goals([[2.25, 1.9, 1.9], [3, 1.85, 1.95]])]), {});
  assert.equal(candidates.length, 0);
});

test('con menos de 4 partidos de algún equipo no se da probabilidad', () => {
  const few = { ...details, lastAway: details.lastAway.slice(0, 3) };
  assert.equal(analyzeEvent(ev, few, offers(), {}).candidates.length, 0);
});

// Córners, tarjetas y tiros: promedios de los equipos (sin mirar las cuotas).
const betanoStats = [
  { name: 'Más/Menos Córners', selections: [{ name: 'Más de 9.5', price: 1.85 }, { name: 'Menos de 9.5', price: 1.9 }, { name: 'Más de 10.5', price: 2.3 }, { name: 'Menos de 10.5', price: 1.55 }] },
  { name: 'Córners en Primer Tiempo Más/Menos', selections: [{ name: 'Más de 4.5', price: 1.95 }, { name: 'Menos de 4.5', price: 1.8 }] },
  { name: 'Tarjetas Totales Más/Menos', selections: [{ name: 'Más de 4.5', price: 1.9 }, { name: 'Menos de 4.5', price: 1.86 }] },
  { name: 'Puntos de Tarjetas', selections: [{ name: 'Más de 45.5', price: 1.9 }, { name: 'Menos de 45.5', price: 1.9 }] },
  { name: 'Tiros al Arco', selections: [{ name: 'Más de 8.5', price: 1.87 }, { name: 'Menos de 8.5', price: 1.87 }] },
  { name: 'Remates totales', selections: [{ name: 'Más de 24.5', price: 1.83 }, { name: 'Menos de 24.5', price: 1.91 }] },
  { name: 'Local Más/Menos Córners', selections: [{ name: 'Más de 5.5', price: 1.9 }, { name: 'Menos de 5.5', price: 1.9 }] },
];
const teamStats = {
  home: { corners: { for: 6.8, against: 3.6, n: 8 }, cards: { for: 1.6, against: 1.9, n: 8 }, shots_on: { for: 6.1, against: 3.2, n: 8 }, shots: { for: 15.2, against: 9.8, n: 8 } },
  away: { corners: { for: 4.4, against: 5.9, n: 8 }, cards: { for: 1.8, against: 2.1, n: 8 }, shots_on: { for: 3.9, against: 4.8, n: 8 }, shots: { for: 11.1, against: 13.4, n: 8 } },
};

test('córners, tarjetas, tiros al arco y remates: con los promedios de cada equipo', () => {
  const list = offersFromBetano(betanoStats, { home: 'Belgium', away: 'Türkiye' }, ev);
  const by = byKey(analyzeEvent(ev, { ...details, teamStats }, list, {}).candidates);
  const keys = ['OU.corners|over|9.5', 'OU.corners@h1|over|4.5', 'OU.cards|over|4.5', 'OU.shots_on|over|8.5', 'OU.shots|over|24.5'];
  for (const k of keys) {
    assert.ok(by[k], `falta ${k}`);
    assert.equal(by[k].via, 'estadísticas');
    const under = by[k.replace('over', 'under')];
    assert.ok(Math.abs(by[k].p + under.p - 1) < 1e-9);
  }
  // Equipos de muchos córners: más de 9.5 es lo probable (el local promedia 6.8 y el rival recibe 5.9).
  assert.ok(by['OU.corners|over|9.5'].p > 0.5, `${by['OU.corners|over|9.5'].p}`);
  // Con promedios más altos sube la probabilidad del Más.
  const more = { home: { ...teamStats.home, corners: { for: 8.5, against: 3.6, n: 8 } }, away: teamStats.away };
  const higher = byKey(analyzeEvent(ev, { ...details, teamStats: more }, list, {}).candidates)['OU.corners|over|9.5'].p;
  assert.ok(higher > by['OU.corners|over|9.5'].p);
  // Pocas tarjetas: menos de 4.5.
  assert.ok(by['OU.cards|under|4.5'].p > 0.55, `${by['OU.cards|under|4.5'].p}`);
  assert.equal(by['OU.corners|over|9.5'].label, 'Más de 9.5 córners');
  assert.equal(by['OU.corners@h1|over|4.5'].label, 'Más de 4.5 córners (1.er tiempo)');
  // Fuera de la lista: córners de un equipo y puntos de tarjetas (no son la cantidad de tarjetas).
  assert.ok(!Object.keys(by).some((k) => k.includes(':home') || k.includes('|45.5')));
  // Sin promedios de los equipos no se inventa una probabilidad.
  assert.equal(analyzeEvent(ev, details, list, {}).candidates.length, 0);
});

const basketEv = { ...ev, id: 201, sport: 'basketball', home: { id: 5, name: 'Lakers' }, away: { id: 6, name: 'Celtics' } };
const basketDetails = {
  lastHome: last([[118, 104], [112, 109], [121, 99], [108, 111], [115, 102], [119, 107], [110, 104], [123, 112]]),
  lastAway: last([[101, 110], [99, 104], [108, 112], [104, 101], [97, 108], [106, 115], [102, 99], [100, 111]]),
};
const basketAt = [
  { name: 'Total de puntos', type: 'OU0', selections: [{ name: 'Más de 214.5', price: 1.9 }, { name: 'Menos de 214.5', price: 1.9 }, { name: 'Más de 220.5', price: 2.4 }, { name: 'Menos de 220.5', price: 1.55 }, { name: 'Más de 215', price: 1.95 }, { name: 'Menos de 215', price: 1.85 }] },
  { name: 'Hándicap', type: 'HC0', selections: [{ name: 'Lakers (-6.5)', price: 1.88 }, { name: 'Celtics (+6.5)', price: 1.92 }, { name: 'Lakers (-9.5)', price: 2.3 }, { name: 'Celtics (+9.5)', price: 1.6 }] },
  { name: '1ra mitad - Total de puntos', type: 'OU623', selections: [{ name: 'Más de 107.5', price: 1.87 }, { name: 'Menos de 107.5', price: 1.93 }] },
  { name: '1ra Mitad - Hándicap', type: 'HC623', selections: [{ name: 'Lakers (-3.5)', price: 1.9 }, { name: 'Celtics (+3.5)', price: 1.9 }] },
  { name: 'Ganador (incl. prórroga)', type: 'ML0', selections: [{ name: 'Lakers', price: 1.4 }, { name: 'Celtics', price: 3 }] },
];

test('básquet: total y hándicap con el modelo de puntos; el 1.er tiempo, simulado', () => {
  const list = offersFromApuestaTotal(basketAt, { home: 'Lakers', away: 'Celtics' }, basketEv);
  const { candidates } = analyzeEvent(basketEv, basketDetails, list, {});
  const by = byKey(candidates);
  assert.deepEqual(
    candidates.map((c) => c.key).sort(),
    ['HCP@h1|away|-3.5', 'HCP@h1|home|-3.5', 'HCP|away|-6.5', 'HCP|home|-6.5', 'OU@h1|over|107.5', 'OU@h1|under|107.5', 'OU|over|214.5', 'OU|under|214.5'],
  );
  assert.equal(by['OU|over|214.5'].via, 'modelo');
  assert.equal(by['HCP@h1|home|-3.5'].via, 'simulación');
  assert.ok(Math.abs(by['HCP@h1|home|-3.5'].p + by['HCP@h1|away|-3.5'].p - 1) < 1e-9);
  // El local gana por ~10 de promedio: cubre el -6.5 más de la mitad de las veces.
  assert.ok(by['HCP|home|-6.5'].p > 0.5);
  assert.equal(by['HCP|home|-6.5'].label, 'Lakers -6.5 (hándicap)');
});

test('béisbol: ganador (incl. entradas extra), run line y total', () => {
  const bbEv = { ...ev, id: 301, sport: 'baseball', home: { id: 7, name: 'Yankees' }, away: { id: 8, name: 'Red Sox' } };
  const bbDetails = {
    lastHome: last([[6, 3], [5, 4], [7, 2], [3, 4], [8, 5], [4, 1], [5, 6], [6, 2]]),
    lastAway: last([[3, 5], [4, 6], [2, 3], [5, 4], [3, 7], [4, 4], [2, 5], [6, 3]]),
  };
  const bbAt = [
    { name: 'Ganador (incl. entradas extra)', type: 'ML0', selections: [{ name: 'Yankees', price: 1.62 }, { name: 'Red Sox', price: 2.35 }] },
    { name: 'Línea de carreras', type: 'HC0', selections: [{ name: 'Yankees -1.5', price: 2.3 }, { name: 'Red Sox +1.5', price: 1.62 }, { name: 'Yankees -1', price: 1.9 }, { name: 'Red Sox +1', price: 1.9 }] },
    { name: 'Total de carreras', type: 'OU0', selections: [{ name: 'Más de 8.5', price: 1.92 }, { name: 'Menos de 8.5', price: 1.88 }, { name: 'Más de 7.5', price: 1.6 }, { name: 'Menos de 7.5', price: 2.3 }] },
  ];
  const { candidates } = analyzeEvent(bbEv, bbDetails, offersFromApuestaTotal(bbAt, { home: 'Yankees', away: 'Red Sox' }, bbEv), {});
  assert.deepEqual(candidates.map((c) => c.key).sort(), ['HCP|away|-1.5', 'HCP|home|-1.5', 'ML|away|', 'ML|home|', 'OU|over|8.5', 'OU|under|8.5']);
  const by = byKey(candidates);
  assert.ok(by['ML|home|'].p > 0.5);
  assert.equal(by['ML|home|'].label, 'Gana Yankees');
});

test('la red sin entrenar da lo mismo que el análisis estadístico', () => {
  const net = new Corrector({ inputs: FEATURES.length });
  const est = analyzeEvent(ev, details, offers(), {}).candidates;
  const rn = analyzeEvent(ev, details, offers(), { network: net, method: 'red_neuronal' }).candidates;
  assert.deepEqual(
    rn.map((c) => c.p),
    est.map((c) => c.p),
  );
});

test('del análisis al historial: picks, combinadas, filas de entrenamiento y resumen', () => {
  const { candidates } = analyzeEvent(ev, { ...details, teamStats }, [...offers(), ...offersFromBetano(betanoStats, { home: 'Belgium', away: 'Türkiye' }, ev)], {});
  const second = { ...ev, id: 102, home: { id: 3, name: 'France' }, away: { id: 4, name: 'Italy' } };
  const at2 = [goals([[2.5, 1.95, 1.85]])];
  const more = analyzeEvent(second, details, offersFromApuestaTotal(at2, { home: 'Francia', away: 'Italia' }, second), {}).candidates;
  const all = [...candidates, ...more];
  const settings = { ...DEFAULT_SETTINGS, comboTargets: [3], comboMinProb: 0.5 };
  const result = {
    id: 'est-1',
    method: 'estadistico',
    created: new Date().toISOString(),
    date: '2026-10-02',
    settings,
    network: null,
    sources: {},
    events: { 101: { home: 'Belgium', away: 'Türkiye' }, 102: { home: 'France', away: 'Italy' } },
    candidates: all,
    picks: selectPicks(all, settings),
    combos: buildCombos(all, settings),
  };
  assert.ok(result.picks.length > 0);
  assert.ok(result.combos.length > 0);
  const stored = compactAnalysis(result);
  assert.equal(stored.picks.length, result.picks.length);
  assert.ok(stored.picks.every((p) => p.status === 'pending' && p.match && p.odds > 1));
  for (const k of stored.combos) assert.ok(k.legs.every((l) => l.market && l.match));
  const rows = trainingRows(result);
  // Solo las selecciones en la zona de los picks (40 % a 97 %).
  assert.equal(rows.length, all.filter((c) => c.pBase >= 0.4 && c.pBase <= 0.97).length);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.y === null && r.x.length === FEATURES.length));
  const s = daySummary({ analyses: [stored] });
  assert.equal(s.n, stored.picks.length);
  assert.equal(s.pending, stored.picks.length);
});

test('el mismo partido da siempre las mismas probabilidades simuladas', () => {
  const list = offersFromApuestaTotal(basketAt, { home: 'Lakers', away: 'Celtics' }, basketEv);
  const a = analyzeEvent(basketEv, basketDetails, list, {}).candidates.map((c) => c.p);
  const b = analyzeEvent(basketEv, basketDetails, list, {}).candidates.map((c) => c.p);
  assert.deepEqual(a, b);
});
