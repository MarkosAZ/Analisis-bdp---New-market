// Pestaña Errores de cuota: la línea más pareja de la casa frente al promedio de los
// datos del partido (últimos partidos de cada equipo o del jugador).
import assert from 'node:assert/strict';
import test from 'node:test';
import * as E from '../docs/js/errores.js';

// Últimos partidos de un equipo (del más reciente al más viejo) con [goles a favor, en contra].
const team = (scores, corners = null) =>
  scores.map(([gf, ga], i) => ({ start: Date.UTC(2026, 9, 30 - i), home: i % 2 === 0, opp: `Rival ${i}`, gf, ga, league: 'Liga', stats: corners ? { corners: corners[i] } : null }));
const data = (home, away, players = [], h2h = [], abbr = null) => ({ home: { name: 'Local', last: home }, away: { name: 'Visita', last: away }, h2h, players, abbr });
const o = (market, sel, line, price, source = 'apuestatotal') => ({ market, sel, line, source, price, label: `${market} ${sel} ${line}` });
const analysis = (lines, sport = 'football') => ({ run: 'r1', events: { 'fs:a': { id: 'fs:a', sport, home: 'Local', away: 'Visita', start: 0 } }, lines: { 'fs:a': lines }, candidates: [] });

// Partidos con 3 y 4 goles (promedio 3.5) y con 1 y 2 (promedio 1.5).
const HIGH = team(Array.from({ length: 10 }, (_, i) => (i % 2 ? [2, 2] : [2, 1])));
const LOW = team(Array.from({ length: 10 }, (_, i) => (i % 2 ? [1, 1] : [1, 0])));

test('errores de cuota: los ejemplos (promedio 3.5 frente a 2.5 → Más; 1.5 frente a 3.5 → Menos)', () => {
  const over = E.findErrors(analysis([o('OU', 'over', 2.5, 1.85), o('OU', 'under', 2.5, 1.9)]), () => data(HIGH, HIGH));
  assert.equal(over.length, 1);
  assert.deepEqual([over[0].sel, over[0].line, over[0].price, over[0].avg, over[0].hits, over[0].n], ['over', 2.5, 1.85, 3.5, 20, 20]);
  assert.equal(over[0].other.price, 1.9);
  const under = E.findErrors(analysis([o('OU', 'over', 3.5, 1.88), o('OU', 'under', 3.5, 1.95)]), () => data(LOW, LOW));
  assert.deepEqual([under[0].sel, under[0].price, under[0].avg], ['under', 1.95, 1.5]);
  // Promedio cerca de la línea: no es error.
  assert.deepEqual(E.findErrors(analysis([o('OU', 'over', 2.5, 1.85), o('OU', 'under', 2.5, 1.9)]), () => data(HIGH, LOW)), []);
});

test('errores de cuota: la diferencia se mide con lo que varía cada mercado y la exigencia', () => {
  // Mismo +1 sobre la línea: en partidos parejos es mucho; con mucha variación, poco.
  const steady = E.evaluate([3, 4, 3, 4, 3, 4], 2.5);
  const noisy = E.evaluate([0, 7, 1, 6, 0, 7], 2.5);
  assert.equal(steady.gap, 1);
  assert.equal(noisy.gap, 1);
  assert.ok(steady.z > 1.5 && noisy.z < 0.4, `${steady.z} ${noisy.z}`);
  // Moderada: pasa con exigencia baja y media, no con alta.
  // Totales 3, 3, 4, 1, 3, 5, 2, 3, 4, 2: promedio 3.0 (+0.5), desviación 1.15, 7 de 10 por encima.
  const mid = team([[2, 1], [1, 2], [3, 1], [1, 0], [2, 1], [3, 2], [1, 1], [2, 1], [2, 2], [1, 1]]);
  const lines = [o('OU', 'over', 2.5, 1.85), o('OU', 'under', 2.5, 1.9)];
  const at = (level) => E.findErrors(analysis(lines), () => data(mid, mid), { level }).length;
  assert.deepEqual([at('baja'), at('media'), at('alta')], [1, 1, 0]);
});

test('errores de cuota: hándicap (diferencia del local frente a su línea), jugador y mejor cuota', () => {
  // El local gana por 3 y la visita pierde por 3: diferencia esperada +6 frente a −2.5.
  const strong = team(Array.from({ length: 10 }, () => [4, 1]));
  const weak = team(Array.from({ length: 10 }, () => [1, 4]));
  const hcp = E.findErrors(analysis([o('HCP', 'home', -2.5, 1.9), o('HCP', 'away', -2.5, 1.9)], 'basketball'), () => data(strong, weak));
  assert.deepEqual([hcp[0].sel, hcp[0].kind, hcp[0].avg, hcp[0].hits], ['home', 'margin', 6, 10]);
  // Jugador: su promedio de puntos + rebotes + asistencias frente a la línea.
  const games = Array.from({ length: 10 }, (_, i) => ({ start: Date.UTC(2026, 3, 30 - i), opp: 'BOS', home: true, pts: 20, reb: 8, ast: 6 + (i % 2) }));
  const pl = E.findErrors(analysis([o('OU.pl_pra#LeBron James', 'over', 28.5, 1.87), o('OU.pl_pra#LeBron James', 'under', 28.5, 1.93)], 'basketball'), () => data([], [], [{ side: 'home', name: 'LeBron James', games }]));
  assert.deepEqual([pl[0].sel, pl[0].player, pl[0].avg, pl[0].price], ['over', 'LeBron James', 34.5, 1.87]);
  // Dos casas con la misma línea: la mejor cuota de cada opción; sin datos del partido, nada.
  const groups = E.lineGroups([o('OU', 'over', 2.5, 1.85), o('OU', 'over', 2.5, 1.92, 'betano'), o('OU', 'under', 2.5, 1.9)]);
  assert.deepEqual([groups.length, groups[0].sides.over.price, groups[0].sides.over.source], [1, 1.92, 'betano']);
  assert.deepEqual(E.findErrors(analysis([o('OU', 'over', 2.5, 1.85)]), () => null), []);
});

test('errores de cuota: córners, local/visita y uno por mercado (el más fuerte)', () => {
  const corners = Array.from({ length: 10 }, () => [7, 5]);
  const c = team(Array.from({ length: 10 }, () => [1, 1]), corners);
  const lines = [o('OU.corners', 'over', 8.5, 1.85), o('OU.corners', 'under', 8.5, 1.9), o('OU.corners', 'over', 9.5, 1.95, 'betano'), o('OU.corners', 'under', 9.5, 1.85, 'betano')];
  const r = E.findErrors(analysis(lines), () => data(c, c));
  assert.equal(r.length, 1, 'un solo error por mercado');
  assert.deepEqual([r[0].line, r[0].stat, r[0].avg], [8.5, 'corners', 12]);
  // Solo de local (los partidos 0, 2, 4...) y de visita: 5 de cada uno.
  const split = E.findErrors(analysis(lines), () => data(c, c), { venue: 'split' });
  assert.equal(split[0].n, 10);
  assert.equal(E.strengthName(1.2), 'muy grande');
  assert.equal(E.strengthName(-0.7), 'grande');
});

test('errores de cuota: los enfrentamientos tienen que decir lo mismo (Everton vs Chelsea)', () => {
  // Sus últimos 10: Everton con 2.2 goles por partido y Chelsea con 4.6 (promedio 3.4,
  // 12 de 20 con más de 2.5); pero en sus últimos 10 enfrentamientos, 2.2 y solo 3 de 10.
  const everton = team([[2, 2], [1, 0], [1, 0], [0, 0], [2, 2], [1, 1], [4, 0], [2, 0], [1, 1], [1, 1]]);
  const chelsea = team([[5, 1], [0, 3], [2, 2], [6, 3], [1, 2], [4, 3], [2, 0], [3, 2], [3, 1], [2, 1]]);
  const h2h = team([[0, 3], [0, 2], [0, 1], [0, 0], [0, 6], [2, 0], [2, 2], [0, 1], [1, 0], [1, 1]]);
  const lines = [o('OU', 'over', 2.5, 1.67), o('OU', 'under', 2.5, 2.2)];
  const form = E.findErrors(analysis(lines), () => data(everton, chelsea));
  assert.deepEqual([form.length, form[0].sel, form[0].avg, form[0].hits, form[0].h2h], [1, 'over', 3.4, 12, null], 'sin enfrentamientos: solo los últimos partidos');
  assert.deepEqual(E.findErrors(analysis(lines), () => data(everton, chelsea, [], h2h)), [], 'los enfrentamientos dicen lo contrario');
  // Con menos de 3 enfrentamientos no cuentan; si dicen lo mismo, van con el error.
  assert.equal(E.findErrors(analysis(lines), () => data(everton, chelsea, [], h2h.slice(0, 2))).length, 1);
  const agree = team([[2, 2], [3, 1], [1, 2], [2, 1], [0, 1]]);
  const [e] = E.findErrors(analysis(lines), () => data(everton, chelsea, [], agree));
  assert.deepEqual([e.sel, e.h2h], ['over', { n: 5, avg: 3, hits: 4 }]);
  assert.deepEqual(E.trackedErrors([e])[0].h2h, { avg: 3, hits: 4, of: 5 });
  // Promedio de los enfrentamientos del lado del error pero menos de la mitad de ese lado: tampoco.
  const skewed = team([[0, 6], [1, 0], [1, 1], [0, 1], [2, 0]]);
  assert.deepEqual(E.findErrors(analysis(lines), () => data(everton, chelsea, [], skewed)), []);
  // Solo los últimos `n` enfrentamientos (como en la pestaña Datos).
  const [last5] = E.findErrors(analysis(lines), () => data(everton, chelsea, [], [...agree, ...h2h]), { n: 5, level: 'baja' });
  assert.deepEqual(last5.h2h, { n: 5, avg: 3, hits: 4 });

  // Hándicap: la diferencia del local de hoy en cada enfrentamiento.
  const strong = team(Array.from({ length: 10 }, () => [4, 1]));
  const weak = team(Array.from({ length: 10 }, () => [1, 4]));
  const hcp = [o('HCP', 'home', -2.5, 1.9), o('HCP', 'away', -2.5, 1.9)];
  const won = E.findErrors(analysis(hcp, 'basketball'), () => data(strong, weak, [], team([[3, 1], [2, 1], [1, 2]])));
  assert.deepEqual(won, [], 'el local ganó los enfrentamientos por poco');
  const [m] = E.findErrors(analysis(hcp, 'basketball'), () => data(strong, weak, [], team([[5, 1], [4, 0], [3, 2]])));
  assert.deepEqual([m.sel, m.h2h], ['home', { n: 3, avg: 3, hits: 2 }]);

  // Jugador: sus partidos contra el rival de hoy (la sigla de data.abbr).
  const games = Array.from({ length: 10 }, (_, i) => ({ start: Date.UTC(2026, 3, 30 - i), opp: i < 3 ? 'BOS' : 'NYK', home: true, pts: i < 3 ? 12 : 20, reb: 8, ast: 6 }));
  const pl = [o('OU.pl_pra#LeBron James', 'over', 28.5, 1.87), o('OU.pl_pra#LeBron James', 'under', 28.5, 1.93)];
  const player = [{ side: 'home', name: 'LeBron James', games }];
  assert.deepEqual(E.findErrors(analysis(pl, 'basketball'), () => data([], [], player, [], ['LAL', 'BOS'])), [], 'contra BOS promedia 26');
  const [p] = E.findErrors(analysis(pl, 'basketball'), () => data([], [], player, [], ['LAL', 'MIA']));
  assert.deepEqual([p.sel, p.h2h, p.side], ['over', null, 'home']);
});

test('errores de cuota en el seguimiento: se guardan como apuestas, se reemplazan al reanalizar y suman aparte', async () => {
  const { daySummary, totals } = await import('../docs/js/history.js');
  const errs = E.findErrors(analysis([o('OU', 'over', 2.5, 1.85), o('OU', 'under', 2.5, 1.9)]), () => data(HIGH, HIGH));
  const [t] = E.trackedErrors(errs, { n: 10, venue: 'all', level: 'media', run: 'r1', created: 'c1' });
  assert.deepEqual([t.key, t.eventId, t.market, t.sel, t.line, t.odds, t.status, t.avg, t.hits, t.of, t.settings.level], ['OU|over|2.5', 'fs:a', 'OU', 'over', 2.5, 1.85, 'pending', 3.5, 20, 20, 'media']);
  // Reanalizar el partido reemplaza su error pendiente; los ya liquidados y los de otros partidos quedan.
  const old = [{ ...t, label: 'viejo' }, { ...t, eventId: 'fs:b' }, { ...t, eventId: 'fs:c', status: 'won' }];
  assert.deepEqual(E.mergeTracked(old, [t], ['fs:a', 'fs:c']).map((e) => [e.eventId, e.label === 'viejo']), [['fs:b', false], ['fs:c', false], ['fs:a', false]]);
  // Resumen del día: aparte de los métodos y por deporte; cuenta en lo pendiente.
  const day = { analyses: [], errores: [{ ...t, status: 'won' }, { ...t, eventId: 'fs:b', sport: 'basketball', status: 'lost' }, { ...t, eventId: 'fs:c', status: 'pending' }] };
  const s = daySummary(day);
  assert.deepEqual([s.errores.won, s.errores.lost, s.errores.pending, s.errores.bySport.football.won, s.errores.bySport.basketball.lost, s.n, s.pendingAll], [1, 1, 1, 1, 1, 0, 1]);
  assert.equal(Math.round(s.errores.profit * 100) / 100, -0.15);
  const all = totals({ days: { d1: s, d2: s } });
  assert.deepEqual([all.errores.won, all.errores.bySport.basketball.lost, all.all.n], [2, 2, 0]);
});
