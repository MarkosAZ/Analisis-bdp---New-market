// Pestaña Datos: lista de enfrentamientos de Flashscore, formato del archivo de cada
// partido y los cálculos de las barras (últimos N, local/visita, línea, resumen).
import assert from 'node:assert/strict';
import test from 'node:test';
import { h2hData, parseH2H } from '../extension/sources/flashscore.js';
import { compactDay, compactMatchData, compactMatchStats, expandDay, expandMatchData } from '../docs/js/data-format.js';
import * as D from '../docs/js/datos.js';

const rec = (fields) => Object.entries(fields).map(([k, v]) => `${k}÷${v}`).join('¬') + '¬~';
const row = (t, homeId, awayId, hs, as, id, league = 'Liga') => rec({ KC: t, UQ: homeId, UO: awayId, KJ: `Equipo ${homeId}`, KK: `Equipo ${awayId}`, KU: hs, KT: as, KP: id, KF: league });

test('H2H de Flashscore: lista de enfrentamientos con su id y quién fue local (sin exhibiciones)', () => {
  const feed = [
    rec({ KA: 'General' }),
    rec({ KB: 'Últimos partidos: A' }),
    row(1000, 'A', 'B', 3, 0, 'm1'),
    rec({ KB: 'Últimos partidos: B' }),
    row(1000, 'A', 'B', 3, 0, 'm1'),
    rec({ KB: 'Enfrentamientos' }),
    row(400, 'B', 'A', 1, 0, 'm3'),
    row(1000, 'A', 'B', 3, 0, 'm1'),
    row(700, 'B', 'A', 2, 2, 'm2', 'NBA Las Vegas Summer League'),
  ].join('');
  const d = h2hData(parseH2H(feed), 'A', 'B');
  assert.deepEqual(
    d.h2hList.map((m) => [m.start, m.fsId, m.homeId, m.hs, m.as]),
    [
      [1000000, 'm1', 'A', 3, 0],
      [400000, 'm3', 'B', 1, 0],
    ],
  );
  assert.equal(d.h2hList[0].home, 'Equipo A');
});

test('archivo de un partido: estadísticas orientadas y ida y vuelta (jugadores y abridores)', () => {
  const stats = { corners: { ft: [7, 3], h1: [4, 1] }, yellows: { ft: [2, 1] }, xg: { ft: [1.234, 0.5] }, passes: { ft: [400, 300] } };
  assert.deepEqual(compactMatchStats(stats), { c: [7, 3], c1: [4, 1], y: [2, 1], x: [1.23, 0.5] });
  // Visto desde la visita: [a favor, en contra] se dan vuelta.
  assert.deepEqual(compactMatchStats(stats, true).c, [3, 7]);
  assert.equal(compactMatchStats({ passes: { ft: [1, 2] } }), null);
  const d = {
    id: 'fs:x1',
    sport: 'basketball',
    generated: '2026-10-16T18:00:00.000Z',
    home: { name: 'Knicks', last: [{ start: 1_790_000_000_000, home: false, opp: 'Cavaliers', gf: 110, ga: 102, league: 'NBA', stats: compactMatchStats({ reb: { ft: [40, 44] } }, true) }] },
    away: { name: 'Cavaliers', last: [] },
    h2h: [{ start: 1_780_000_000_000, home: true, gf: 99, ga: 101, league: 'NBA', stats: null }],
    abbr: ['NY', 'CLE'],
    players: [{ side: 'home', name: 'Mitchell Robinson', games: [{ start: 1_790_000_000_000, opp: 'CLE', home: false, min: 30, pts: 8, reb: 12, ast: 2 }] }],
    pitchers: null,
  };
  const back = expandMatchData(JSON.parse(JSON.stringify(compactMatchData(d))));
  assert.equal(back.home.last[0].opp, 'Cavaliers');
  assert.deepEqual(back.home.last[0].stats, { reb: [44, 40] });
  assert.equal(back.h2h[0].league, 'NBA');
  assert.deepEqual(back.abbr, ['NY', 'CLE']);
  assert.equal(back.players[0].games[0].reb, 12);
  assert.equal(back.players[0].games[0].home, false);
  assert.equal(back.players[0].games[0].stl, null);
  const mlb = expandMatchData(JSON.parse(JSON.stringify(compactMatchData({ ...d, sport: 'baseball', players: [], pitchers: { home: { name: 'Jeffrey Springs', starts: [{ start: 1_790_000_000_000, opp: 'Seattle Mariners', ip: 5.333333, h: 4, er: 2, bb: 1, k: 7, hr: 0 }] }, away: null } }))));
  assert.deepEqual(mlb.pitchers.home.starts[0], { start: 1_790_000_000_000, opp: 'Seattle Mariners', ip: 5.333, h: 4, er: 2, bb: 1, k: 7, hr: 0 });
  assert.equal(mlb.pitchers.away, null);
});

test('archivo del día: qué partidos tienen su archivo de datos (en los de antes, los que tienen detalles)', () => {
  const ev = (id) => ({ id, sport: 'football', start: 1_790_000_000_000, tournament: { id: 't', name: 'Liga 1', priority: 0 }, category: { name: 'PERÚ', alpha2: 'PE' }, home: { id: 'h', name: 'A' }, away: { id: 'a', name: 'B' }, state: 'pendiente', score: null });
  const base = { date: '2026-10-16', sport: 'football', generated: '2026-10-16T18:00:00.000Z', events: [ev('fs:a'), ev('fs:b')], details: { 'fs:b': { lastHome: [], lastAway: [], h2h: null } } };
  assert.deepEqual([...expandDay(JSON.parse(JSON.stringify(compactDay({ ...base, datos: ['fs:a', 'fs:b'] })))).datos], ['fs:a', 'fs:b']);
  assert.deepEqual([...expandDay(JSON.parse(JSON.stringify(compactDay(base)))).datos], ['fs:b']);
});

// Últimos partidos de un equipo, del más reciente al más viejo.
const m = (day, home, gf, ga, c) => ({ start: Date.UTC(2026, 9, day), home, opp: `Rival ${day}`, gf, ga, league: 'Liga', stats: c ? { corners: c } : null });
const LAST = [m(15, true, 2, 1, [6, 4]), m(12, false, 0, 0, [3, 5]), m(9, true, 3, 2, null), m(6, false, 1, 2, [2, 8]), m(3, true, 1, 0, [7, 2])];
const GOALS = D.statById('football', 'goals');
const CORNERS = D.statById('football', 'corners');

test('barras: últimos N, solo de local o de visita, y el más reciente a la derecha', () => {
  assert.deepEqual(D.pickMatches(LAST, { n: 3 }).map((x) => x.start), LAST.slice(0, 3).map((x) => x.start));
  assert.deepEqual(D.pickMatches(LAST, { n: 2, venue: 'home' }).map((x) => x.gf), [2, 3]);
  assert.deepEqual(D.pickMatches(LAST, { n: 10, venue: 'away' }).map((x) => x.gf), [0, 1]);
  // Goles del partido, a favor y en contra; del más viejo al más reciente.
  assert.deepEqual(D.seriesOf(LAST, GOALS, 'total').map((x) => x.value), [1, 3, 5, 0, 3]);
  assert.deepEqual(D.seriesOf(LAST, GOALS, 'for').map((x) => x.value), [1, 1, 3, 0, 2]);
  assert.deepEqual(D.seriesOf(LAST, GOALS, 'against').map((x) => x.value), [0, 2, 2, 0, 1]);
  // Un partido sin córners no cuenta como 0.
  assert.deepEqual(D.seriesOf(LAST, CORNERS, 'total').map((x) => x.value), [9, 10, 8, 10]);
});

test('barras: resumen frente a la línea (justo en la línea no cuenta) y línea por defecto', () => {
  const s = D.summarize([1, 3, 5, 0, 3], 2.5);
  assert.deepEqual(s, { n: 5, avg: 2.4, median: 3, over: 3, under: 2, push: 0, pct: 0.6 });
  const w = D.summarize([9, 10, 8, 10], 10);
  assert.deepEqual([w.over, w.under, w.push, w.pct, w.median], [0, 2, 2, 0, 9.5]);
  assert.equal(D.summarize([], 2.5).avg, null);
  assert.equal(D.defaultLine([1, 3, 5, 0, 3]), 1.5);
  assert.equal(D.defaultLine([9, 10, 8, 10]), 8.5);
  assert.equal(D.defaultLine([], null), 0.5);
  assert.equal(D.defaultLine([9, 10], 9.5), 9.5);
  // Diferencia (a favor menos en contra, para el hándicap): puede ser negativa.
  assert.equal(D.valueOf([3, 5], 'diff'), -2);
  assert.deepEqual(D.seriesOf(LAST, GOALS, 'diff').map((x) => x.value), [1, -1, 1, 0, 1]);
  assert.equal(D.defaultLine([-4, -6], null, { min: -Infinity }), -5.5);
  assert.equal(D.defaultLine([-4, -6]), 0.5);
});

test('barras: la línea de la casa es la más pareja (la entera solo si no hay .5)', () => {
  const o = (market, sel, line, price) => ({ source: 'apuestatotal', market, sel, line, price });
  const offers = [o('OU', 'over', 2.5, 1.9), o('OU', 'under', 2.5, 1.9), o('OU', 'over', 3.5, 2.9), o('OU', 'under', 3.5, 1.4), o('OU.corners', 'over', 9, 1.85), o('OU.corners', 'under', 9, 1.95)];
  assert.equal(D.offeredLine(offers, 'OU'), 2.5);
  assert.equal(D.offeredLine(offers, 'OU.corners'), 9);
  assert.equal(D.offeredLine(offers, 'OU.cards'), null);
  assert.equal(D.offeredLine(offers, null), null);
});

test('barras: forma, goles y enfrentamientos de un equipo', () => {
  const r = D.record(LAST);
  assert.deepEqual([r.n, r.w, r.d, r.l, r.form], [5, 3, 1, 1, 'GEGPG']);
  assert.equal(r.gf, 7 / 5);
  assert.equal(r.over25, 3 / 5);
  assert.equal(r.btts, 3 / 5);
  assert.deepEqual(D.averagePair(LAST, CORNERS), { n: 4, for: 4.5, against: 4.75 });
  assert.deepEqual(D.h2hRecord([{ gf: 1, ga: 0 }, { gf: 2, ga: 2 }, { gf: 0, ga: 3 }, { gf: 4, ga: 1 }]), { n: 4, home: 2, draw: 1, away: 1 });
});

test('barras: jugadores (últimos N o contra el rival) y abridores', () => {
  const g = (day, opp, pts, reb, ast) => ({ start: Date.UTC(2026, 3, day), opp, home: day % 2 === 0, pts, reb, ast });
  const player = { name: 'Mitchell Robinson', games: [g(20, 'CLE', 5, 4, 2), g(18, 'BOS', 9, 10, 1), g(15, 'CLE', 8, 12, 2), g(10, 'MIA', 6, 7, 0)] };
  assert.deepEqual(D.playerGames(player, { n: 2 }).map((x) => x.opp), ['CLE', 'BOS']);
  assert.deepEqual(D.playerGames(player, { vs: 'CLE' }).map((x) => x.pts), [5, 8]);
  // Puntos + rebotes + asistencias, del más viejo al más reciente.
  assert.deepEqual(D.playerSeries(D.playerGames(player, { vs: 'CLE' }), 'pl_pra').map((x) => x.value), [22, 11]);
  const match = (a, b) => a.toLowerCase() === b.toLowerCase();
  const o = (market, sel, line, price) => ({ source: 'apuestatotal', market, sel, line, price });
  const lines = D.playerLines([o('OU.pl_pra#mitchell robinson', 'over', 11.5, 1.85), o('OU.pl_pra#mitchell robinson', 'under', 11.5, 1.95), o('OU.pl_pts#Otro', 'over', 20.5, 1.9), o('OU.pl_pts#Otro', 'under', 20.5, 1.9)], 'Mitchell Robinson', match);
  assert.deepEqual(lines, { pl_pra: 11.5 });
  const starts = [{ k: 7, ip: 6 }, { k: 4, ip: 5 }, { k: null, ip: 2 }];
  assert.deepEqual(D.pitcherSeries(starts, 'k').map((x) => x.value), [4, 7]);
});

test('barras: siglas de los rivales', () => {
  assert.equal(D.shortName('Deportivo de A Coruña'), 'COR');
  assert.equal(D.shortName('Real Madrid'), 'MAD');
  assert.equal(D.shortName('Levante'), 'LEV');
  assert.equal(D.shortName('Atlético de Madrid'), 'MAD');
  assert.equal(D.shortName(''), '?');
});
