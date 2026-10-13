import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boxScoreFromLineups,
  getEventResults,
  getPlayerLogs,
  playerRow,
  playersFromLineups,
  reduceLineups,
  teamPlayerLogs,
} from '../extension/sources/sofascore.js';

// ---- Datos con la forma de /event/{id}/lineups de Sofascore (básquet) ----

const stats = (o = {}) => ({
  secondsPlayed: 2160,
  points: 27,
  rebounds: 8,
  assists: 9,
  threePointsMade: 3,
  threePointAttempts: 7,
  twoPointsMade: 7,
  twoPointAttempts: 12,
  fieldGoalsMade: 10,
  fieldGoalAttempts: 19,
  freeThrowsMade: 4,
  freeThrowAttempts: 5,
  offensiveRebounds: 1,
  defensiveRebounds: 7,
  steals: 2,
  blocks: 1,
  turnovers: 4,
  personalFouls: 2,
  plusMinusValue: 5,
  ...o,
});
const pl = (name, shortName, id, statistics, extra = {}) => ({
  player: { name, shortName, slug: name.toLowerCase().replace(/\s+/g, '-'), id, position: 'F' },
  teamId: extra.teamId ?? null,
  shirtNumber: 1,
  substitute: false,
  ...(statistics === undefined ? {} : { statistics }),
  ...extra,
});
const miss = (name, id, type = 'missing', description = 'Lesión de rodilla') => ({ player: { name, shortName: name, id }, type, reason: 1, description });
const lineups = (home, away, { homeMissing = [], awayMissing = [] } = {}) => ({
  confirmed: true,
  home: { players: home, supportStaff: [], missingPlayers: homeMissing },
  away: { players: away, supportStaff: [], missingPlayers: awayMissing },
});
const ROW = { min: 36, pts: 27, reb: 8, ast: 9, tpm: 3, stl: 2, blk: 1, tov: 4, oreb: 1, dreb: 7, ftm: 4, fgm: 10 };
const DNP = { min: 0, dnp: true };

// ---- playerRow ----

test('playerRow: claves de Sofascore al formato común', () => {
  assert.deepEqual(playerRow(stats()), ROW);
  // Minutos con decimales (2 cifras).
  assert.equal(playerRow(stats({ secondsPlayed: 1234 })).min, 20.57);
  // Ceros son datos, no faltantes.
  assert.deepEqual(playerRow(stats({ points: 0, threePointsMade: 0, steals: 0 })), { ...ROW, pts: 0, tpm: 0, stl: 0 });
  // Números como texto.
  assert.deepEqual(playerRow({ secondsPlayed: '600', points: '12', assists: '3' }), {
    min: 10, pts: 12, reb: null, ast: 3, tpm: null, stl: null, blk: null, tov: null, oreb: null, dreb: null, ftm: null, fgm: null,
  });
});

test('playerRow: alias de rebotes, triples, tapones, tiros de campo y minutos', () => {
  const base = { secondsPlayed: 1200, points: 10 };
  // Rebotes: rebounds, totalRebounds o la suma de ofensivos y defensivos.
  assert.equal(playerRow({ ...base, totalRebounds: 6 }).reb, 6);
  assert.equal(playerRow({ ...base, offensiveRebounds: 2, defensiveRebounds: 5 }).reb, 7);
  assert.equal(playerRow({ ...base, offensiveRebounds: 2 }).reb, null, 'sin defensivos no se puede sumar');
  assert.equal(playerRow({ ...base, rebounds: 9, totalRebounds: 4 }).reb, 9, 'rebounds manda');
  // Triples.
  assert.equal(playerRow({ ...base, threePointersMade: 4 }).tpm, 4);
  assert.equal(playerRow({ ...base, threePointFieldGoalsMade: 2 }).tpm, 2);
  // Tapones.
  assert.equal(playerRow({ ...base, blockedShots: 3 }).blk, 3);
  // Tiros de campo: fieldGoalsMade o dobles + triples.
  assert.equal(playerRow({ ...base, twoPointsMade: 5, threePointsMade: 2 }).fgm, 7);
  assert.equal(playerRow({ ...base, twoPointsMade: 5, threePointersMade: 1 }).fgm, 6);
  assert.equal(playerRow({ ...base, twoPointsMade: 5 }).fgm, null, 'sin triples no se puede sumar');
  assert.equal(playerRow({ ...base, fieldGoalsMade: 8, twoPointsMade: 5, threePointsMade: 2 }).fgm, 8, 'fieldGoalsMade manda');
  // Minutos: minutesPlayed (número o "MM:SS") si no hay segundos.
  assert.equal(playerRow({ minutesPlayed: 31.5, points: 4 }).min, 31.5);
  assert.equal(playerRow({ minutesPlayed: '24:30', points: 4 }).min, 24.5);
  assert.equal(playerRow({ minutesPlayed: '24:xx', points: 4 }).min, null);
  assert.equal(playerRow({ secondsPlayed: 90, minutesPlayed: 40, points: 4 }).min, 1.5, 'secondsPlayed manda');
});

test('playerRow: no jugó (sin estadísticas, 0 segundos o todo en cero sin minutos)', () => {
  assert.deepEqual(playerRow(undefined), DNP);
  assert.deepEqual(playerRow(null), DNP);
  assert.deepEqual(playerRow({}), DNP);
  assert.deepEqual(playerRow('x'), DNP);
  assert.deepEqual(playerRow(stats({ secondsPlayed: 0 })), DNP, '0 segundos aunque traiga números');
  assert.deepEqual(playerRow({ minutesPlayed: 0, points: 0 }), DNP);
  assert.deepEqual(playerRow({ minutesPlayed: '0:00' }), DNP);
  assert.deepEqual(playerRow({ secondsPlayed: 0.1, points: 0 }), DNP, 'menos de un centésimo de minuto');
  assert.deepEqual(playerRow({ points: 0, rebounds: 0, assists: 0 }), DNP, 'sin minutos y todo en cero');
  assert.deepEqual(playerRow({ rating: 6.8 }), DNP, 'sin ningún dato del formato');
  // Sin minutos pero con números: jugó (minutos desconocidos).
  const r = playerRow({ points: 8, rebounds: 0 });
  assert.equal(r.dnp, undefined);
  assert.equal(r.min, null);
  assert.equal(r.pts, 8);
  // Con minutos y sin ningún otro dato: jugó.
  const empty = { pts: null, reb: null, ast: null, tpm: null, stl: null, blk: null, tov: null, oreb: null, dreb: null, ftm: null, fgm: null };
  assert.deepEqual(playerRow({ secondsPlayed: 300 }), { min: 5, ...empty });
});

// ---- playersFromLineups ----

test('playersFromLineups: jugadores de cada lado con su fila', () => {
  const lu = lineups(
    [pl('LeBron James', 'L. James', 817181, stats()), pl('Bronny James', 'B. James', 1, undefined, { substitute: true })],
    [pl('Luka Dončić', 'L. Dončić', 2, stats({ secondsPlayed: 2400, points: 35 }))],
  );
  assert.deepEqual(playersFromLineups(lu, 'home'), [
    { id: 817181, name: 'LeBron James', short: 'L. James', row: ROW },
    { id: 1, name: 'Bronny James', short: 'B. James', row: DNP },
  ]);
  const away = playersFromLineups(lu, 'away');
  assert.equal(away.length, 1);
  assert.equal(away[0].name, 'Luka Dončić', 'conserva las tildes');
  assert.equal(away[0].row.min, 40);
  assert.equal(away[0].row.pts, 35);
});

test('playersFromLineups: bordes', () => {
  assert.deepEqual(playersFromLineups(null, 'home'), []);
  assert.deepEqual(playersFromLineups({}, 'home'), []);
  assert.deepEqual(playersFromLineups({ home: {} }, 'home'), []);
  assert.deepEqual(playersFromLineups(lineups([pl('A B', 'A. B', 1, stats())], []), 'local'), [], 'lado inválido');
  const lu = lineups(
    [
      pl('Same Name', 'Same Name', 5, stats()), // shortName igual al nombre → short null
      pl('Same Name', 'S. Name', 5, stats()), // repetido (mismo id)
      { player: { shortName: 'J. Doe', id: 6 }, statistics: stats() }, // sin name: usa shortName
      { player: { id: 7 }, statistics: stats() }, // sin nombre: se omite
      { statistics: stats() }, // sin jugador: se omite
      null,
      pl('Sin Id', 'S. Id', undefined, stats()),
    ],
    [],
  );
  assert.deepEqual(
    playersFromLineups(lu, 'home').map((p) => [p.id, p.name, p.short]),
    [
      [5, 'Same Name', null],
      [6, 'J. Doe', null],
      [null, 'Sin Id', 'S. Id'],
    ],
  );
});

// ---- boxScoreFromLineups ----

test('boxScoreFromLineups: ambos equipos, bajas como no jugados', () => {
  const lu = lineups(
    [pl('LeBron James', 'L. James', 1, stats()), pl('Gabe Vincent', 'G. Vincent', 2, { secondsPlayed: 0 })],
    [pl('Jayson Tatum', 'J. Tatum', 3, stats({ points: 31 }))],
    { homeMissing: [miss('Anthony Davis', 4)], awayMissing: [miss('Jrue Holiday', 5, 'doubtful'), miss('Jayson Tatum', 3)] },
  );
  assert.deepEqual(boxScoreFromLineups(lu), {
    'LeBron James': ROW,
    'Gabe Vincent': DNP,
    'Anthony Davis': DNP,
    'Jayson Tatum': { ...ROW, pts: 31 }, // figura en la lista: manda su fila
    'Jrue Holiday': DNP,
  });
});

test('boxScoreFromLineups: un lado sin estadísticas no cuenta (no son bajas)', () => {
  const lu = lineups(
    [pl('A Uno', 'A. Uno', 1, stats())],
    [pl('B Dos', 'B. Dos', 2, undefined), pl('B Tres', 'B. Tres', 3, {})],
    { awayMissing: [miss('B Cuatro', 4)] },
  );
  assert.deepEqual(boxScoreFromLineups(lu), { 'A Uno': ROW });
  assert.deepEqual(boxScoreFromLineups(lineups([pl('X', 'X', 1)], [pl('Y', 'Y', 2)])), {}, 'liga sin box score');
  assert.deepEqual(boxScoreFromLineups(null), {});
  assert.deepEqual(boxScoreFromLineups({}), {});
  // Mismo nombre en los dos equipos: gana el que jugó.
  const twin = lineups([pl('Ana Pérez', 'A. Pérez', 1, { secondsPlayed: 0 }), pl('Otra', 'O', 9, stats())], [pl('Ana Pérez', 'A. Pérez', 2, stats())]);
  assert.deepEqual(boxScoreFromLineups(twin)['Ana Pérez'], ROW);
});

// ---- teamPlayerLogs ----

const H = 1000; // id del equipo
const idOf = (name) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1e9, 7); // id fijo de cada jugador
const D = 86400000;
// Alineación de un partido del equipo H: `side` es su lado; `rows` = { nombre: estadísticas | undefined }.
function gameLineups(side, rows, { otherRows = { Rival: stats() } } = {}) {
  const list = (o, teamId) => Object.entries(o).map(([name, st]) => pl(name, `${name[0]}. ${name.split(' ').at(-1)}`, idOf(name), st, { teamId }));
  const mine = list(rows, H);
  const other = list(otherRows, 2000);
  return side === 'home' ? lineups(mine, other) : lineups(other, mine);
}

test('teamPlayerLogs: lado del equipo, solo partidos jugados, del más reciente al más antiguo', () => {
  const t0 = Date.UTC(2026, 9, 1);
  const byId = {
    11: reduceLineups(gameLineups('home', { 'Ana Gómez': stats({ points: 10 }), 'Bea Ruiz': stats({ secondsPlayed: 600, points: 2 }) })),
    12: reduceLineups(gameLineups('away', { 'Ana Gómez': stats({ points: 20 }), 'Bea Ruiz': { secondsPlayed: 0 } })),
    13: reduceLineups(gameLineups('home', { 'Ana Gómez': stats({ points: 30 }), 'Bea Ruiz': stats({ secondsPlayed: 900, points: 4 }) })),
  };
  // Entrada desordenada: se ordena por fecha.
  const games = [
    { id: 12, home: false, start: t0 + D },
    { id: 11, home: true, start: t0 },
    { id: 13, home: true, start: t0 + 2 * D },
  ];
  const r = teamPlayerLogs(games, (id) => byId[id], { teamId: H });
  assert.equal(r.teamGames, 3);
  assert.deepEqual(r.players.map((p) => p.name), ['Ana Gómez', 'Bea Ruiz'], 'por minutos promedio');
  const [ana, bea] = r.players;
  assert.deepEqual(ana.games.map((g) => g.pts), [30, 20, 10]);
  assert.deepEqual(ana.games.map((g) => g.start), [t0 + 2 * D, t0 + D, t0]);
  assert.deepEqual(ana.games[0], { start: t0 + 2 * D, ...ROW, pts: 30 });
  assert.equal(ana.short, 'A. Gómez');
  assert.equal(ana.out, false);
  assert.equal(ana.doubtful, false);
  assert.deepEqual(bea.games.map((g) => [g.min, g.pts]), [[15, 4], [10, 2]], 'no cuenta el partido sin jugar');
  // Nunca toma al rival.
  assert.ok(!r.players.some((p) => p.name === 'Rival'));
});

test('teamPlayerLogs: bajas, dudas, límite n, sin fecha y lado por id del equipo', () => {
  const byId = {
    21: reduceLineups(gameLineups('home', { 'Luka Dončić': stats(), 'Kyrie Irving': stats({ secondsPlayed: 1800 }), 'Dereck Lively': stats({ secondsPlayed: 600 }) })),
    22: reduceLineups(gameLineups('away', { 'Luka Dončić': stats(), 'Kyrie Irving': stats({ secondsPlayed: 1800 }), 'Dereck Lively': stats({ secondsPlayed: 600 }) })),
    23: reduceLineups(gameLineups('home', { 'Luka Dončić': stats() })),
  };
  const lukaId = byId[21].home.find((p) => p.name === 'Luka Dončić').id;
  const missing = [
    { player: { name: 'Luka Doncic', id: lukaId }, type: 'missing', description: 'Tobillo' }, // por id
    { player: { name: 'KYRIE IRVING', id: 999 }, type: 'doubtful' }, // por nombre (sin tildes ni mayúsculas)
    { player: { name: 'Dereck Lively' } }, // sin tipo: baja
  ];
  // Sin fechas: se respeta el orden; n = 2 deja afuera el 23. Sin `home`: lado por teamId.
  const games = [{ id: 21, home: true }, { id: 22 }, { id: 23, home: true }];
  const r = teamPlayerLogs(games, (id) => byId[id], { teamId: H, missing, n: 2 });
  assert.equal(r.teamGames, 2);
  const by = Object.fromEntries(r.players.map((p) => [p.name, p]));
  assert.equal(by['Luka Dončić'].games.length, 2);
  assert.equal(by['Luka Dončić'].games[0].start, null);
  assert.equal(by['Luka Dončić'].out, true);
  assert.equal(by['Kyrie Irving'].out, false);
  assert.equal(by['Kyrie Irving'].doubtful, true);
  assert.equal(by['Dereck Lively'].out, true);
  // Sin `home` ni teamId no se sabe el lado: el partido no cuenta.
  assert.equal(teamPlayerLogs([{ id: 22 }], (id) => byId[id]).teamGames, 0);
});

test('teamPlayerLogs: partidos sin alineación o sin estadísticas no cuentan', () => {
  const byId = {
    31: reduceLineups(gameLineups('home', { 'Uno Solo': stats() })),
    32: reduceLineups(gameLineups('home', { 'Uno Solo': undefined, 'Otro Más': {} })), // liga sin box score
    33: null, // 404
  };
  const r = teamPlayerLogs([{ id: 31, home: true }, { id: 32, home: true }, { id: 33, home: true }, { id: 34, home: true }, { home: true }], (id) => byId[id] ?? null);
  assert.equal(r.teamGames, 1);
  assert.deepEqual(r.players.map((p) => [p.name, p.games.length]), [['Uno Solo', 1]]);
  assert.deepEqual(teamPlayerLogs([], () => null), { teamGames: 0, players: [] });
  assert.deepEqual(teamPlayerLogs(undefined, () => null), { teamGames: 0, players: [] });
});

test('teamPlayerLogs: orden por minutos promedio en los partidos del equipo', () => {
  // Titular que jugó 1 de 3 partidos (40 min) contra suplente de 3 de 3 (20 min): 13.3 < 20.
  const byId = {
    41: reduceLineups(gameLineups('home', { 'Titular Lesionado': stats({ secondsPlayed: 2400 }), 'Suplente Fijo': stats({ secondsPlayed: 1200 }) })),
    42: reduceLineups(gameLineups('home', { 'Titular Lesionado': undefined, 'Suplente Fijo': stats({ secondsPlayed: 1200 }) })),
    43: reduceLineups(gameLineups('home', { 'Titular Lesionado': undefined, 'Suplente Fijo': stats({ secondsPlayed: 1200 }) })),
  };
  const r = teamPlayerLogs([41, 42, 43].map((id) => ({ id, home: true })), (id) => byId[id]);
  assert.deepEqual(r.players.map((p) => p.name), ['Suplente Fijo', 'Titular Lesionado']);
  // Sin minutos: desempata la cantidad de partidos.
  const noMin = {
    51: reduceLineups(gameLineups('home', { 'Poco Juego': { points: 2 }, 'Mucho Juego': { points: 10 } })),
    52: reduceLineups(gameLineups('home', { 'Mucho Juego': { points: 12 } })),
  };
  const r2 = teamPlayerLogs([51, 52].map((id) => ({ id, home: true })), (id) => noMin[id]);
  assert.deepEqual(r2.players.map((p) => [p.name, p.games.length, p.games[0].min]), [['Mucho Juego', 2, null], ['Poco Juego', 1, null]]);
});

// ---- Pedidos (fetch y chrome simulados) ----

// Sofascore simulado: rutas → respuesta (objeto = 200, número = estado de error).
function mockSofascore(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.replace(/^\/api\/v1/, '');
    calls.push(`${new URL(url).hostname}${path}`);
    const r = routes[path];
    if (r === undefined) return new Response('{"error":{"code":404}}', { status: 404 });
    if (typeof r === 'number') return new Response('{}', { status: r });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  globalThis.chrome = { storage: { session: { get: async () => ({}), set: async () => {} } } };
  return calls;
}

test('getPlayerLogs: pide las alineaciones, arma ambos equipos y marca las bajas', async () => {
  const HOME = 3427;
  const AWAY = 3422;
  const t0 = Date.UTC(2026, 9, 1);
  const lu = (homeTeam, homeRows, awayTeam, awayRows) => {
    const list = (o, teamId) => Object.entries(o).map(([name, st], i) => pl(name, null, `${teamId}-${name}`, st, { teamId }));
    return lineups(list(homeRows, homeTeam), list(awayRows, awayTeam));
  };
  const calls = mockSofascore({
    '/event/9001/lineups': lu(HOME, { 'Local Uno': stats({ points: 20 }), 'Local Dos': stats({ secondsPlayed: 1200, points: 8 }) }, 77, { 'Otro A': stats() }),
    '/event/9002/lineups': lu(78, { 'Otro B': stats() }, HOME, { 'Local Uno': stats({ points: 25 }), 'Local Dos': { secondsPlayed: 0 } }),
    '/event/9003/lineups': lu(AWAY, { 'Visita Uno': stats({ points: 15 }) }, 79, { 'Otro C': stats() }),
    // 9004: sin alineación (404).
    '/event/9100/lineups': {
      confirmed: false,
      home: { players: [], missingPlayers: [miss('Local Dos', `${HOME}-Local Dos`)] },
      away: { players: [], missingPlayers: [miss('Visita Uno', 0, 'doubtful')] },
    },
  });
  const ev = {
    id: 9100,
    homeId: HOME,
    awayId: AWAY,
    start: t0 + 10 * D,
    lastHome: [
      { id: 9001, home: true, start: t0 + D },
      { id: 9002, home: false, start: t0 + 2 * D },
    ],
    lastAway: [
      { id: 9003, home: true, start: t0 + 3 * D },
      { id: 9004, home: false, start: t0 },
    ],
  };
  const r = await getPlayerLogs({ events: [ev], n: 10 });
  assert.equal(r.mode, 'direct');
  assert.deepEqual(calls.sort(), ['9001', '9002', '9003', '9004', '9100'].map((id) => `api.sofascore.com/event/${id}/lineups`));
  const { home, away } = r.items[9100];
  assert.equal(home.teamGames, 2);
  assert.deepEqual(home.players.map((p) => [p.name, p.games.map((g) => g.pts), p.out]), [
    ['Local Uno', [25, 20], false],
    ['Local Dos', [8], true],
  ]);
  assert.equal(home.players[0].games[0].start, t0 + 2 * D);
  assert.equal(home.players[0].short, null);
  assert.equal(away.teamGames, 1, 'el partido sin alineación no cuenta');
  assert.deepEqual(away.players.map((p) => [p.name, p.out, p.doubtful]), [['Visita Uno', false, true]]);

  // Segunda vez: los partidos terminados salen de la caché (también el 404); el partido a analizar se vuelve a pedir.
  calls.length = 0;
  const again = await getPlayerLogs({ events: [ev] });
  assert.deepEqual(calls, ['api.sofascore.com/event/9100/lineups']);
  assert.deepEqual(again.items[9100], r.items[9100]);
});

test('getPlayerLogs: límite n, partido a analizar sin alineación y lista vacía', async () => {
  const calls = mockSofascore({
    '/event/9201/lineups': lineups([pl('Solo Uno', 'S. Uno', 1, stats(), { teamId: 1 })], [pl('Rival', 'R', 2, stats(), { teamId: 2 })]),
    '/event/9202/lineups': lineups([pl('Solo Uno', 'S. Uno', 1, stats(), { teamId: 1 })], [pl('Rival', 'R', 2, stats(), { teamId: 2 })]),
  });
  const ev = { id: 9300, homeId: 1, awayId: 2, lastHome: [{ id: 9201, home: true }, { id: 9202, home: true }], lastAway: [{ id: 9201, home: false }] };
  const r = await getPlayerLogs({ events: [ev], n: 1 });
  assert.ok(!calls.includes('api.sofascore.com/event/9202/lineups'), 'n = 1: solo el último partido');
  assert.equal(calls.filter((c) => c.endsWith('/9201/lineups')).length, 1, 'un partido compartido se pide una vez');
  assert.equal(r.items[9300].home.teamGames, 1);
  assert.equal(r.items[9300].home.players[0].out, false, 'sin alineación del partido a analizar: nadie de baja');
  assert.deepEqual(r.items[9300].away.players.map((p) => p.name), ['Rival']);
  assert.deepEqual(await getPlayerLogs({ events: [] }), { mode: null, items: {}, notes: [] });
  assert.deepEqual(await getPlayerLogs(), { mode: null, items: {}, notes: [] });
});

test('getPlayerLogs: liga sin alineaciones (todo 404): no prueba otra vía y queda en caché', async () => {
  const calls = mockSofascore({});
  const ev = { id: 9700, homeId: 1, awayId: 2, lastHome: [{ id: 9601, home: true }, { id: 9602, home: false }], lastAway: [{ id: 9603, home: true }] };
  const r = await getPlayerLogs({ events: [ev] });
  assert.ok(calls.every((c) => c.startsWith('api.sofascore.com')), `sin www ni pestaña: ${calls.join(', ')}`);
  assert.deepEqual(r.items[9700], { home: { teamGames: 0, players: [] }, away: { teamGames: 0, players: [] } });
  calls.length = 0;
  await getPlayerLogs({ events: [ev] });
  assert.deepEqual(calls, ['api.sofascore.com/event/9700/lineups'], 'los 404 de partidos terminados quedan en caché');
});

test('getPlayerLogs: si Sofascore no responde, error con los intentos', async () => {
  mockSofascore({ '/event/9401/lineups': 403, '/event/9402/lineups': 403, '/event/9500/lineups': 403 });
  // Sin chrome.tabs la vía "pestaña" también falla (como si no se pudiera abrir).
  const ev = { id: 9500, homeId: 1, awayId: 2, lastHome: [{ id: 9401, home: true }], lastAway: [{ id: 9402, home: false }] };
  await assert.rejects(getPlayerLogs({ events: [ev] }), /Sofascore no devolvió alineaciones/);
  // Los fallos no quedan en caché: si después responde, se vuelven a pedir.
  const calls = mockSofascore({ '/event/9401/lineups': lineups([pl('Vuelve Bien', 'V. Bien', 1, stats())], []) });
  const r = await getPlayerLogs({ events: [ev] });
  assert.ok(calls.includes('api.sofascore.com/event/9401/lineups'));
  assert.deepEqual(r.items[9500].home.players.map((p) => p.name), ['Vuelve Bien']);
  assert.equal(r.items[9500].away.teamGames, 0);
});

test('getEventResults: box score de los jugadores solo de los terminados pedidos', async () => {
  const event = (id, type) => ({
    id,
    startTimestamp: 1791800000,
    status: { type, description: type },
    homeTeam: { id: 1, name: 'Local' },
    awayTeam: { id: 2, name: 'Visita' },
    homeScore: { current: 101 },
    awayScore: { current: 99 },
    winnerCode: 1,
    tournament: { name: 'Liga', category: { sport: { slug: 'basketball' } } },
  });
  const box = lineups([pl('Ana Gómez', 'A. Gómez', 1, stats())], [pl('Bea Ruiz', 'B. Ruiz', 2, { secondsPlayed: 0 }), pl('Eva Sanz', 'E. Sanz', 4, stats())], {
    homeMissing: [miss('Cata Díaz', 3)],
  });
  const calls = mockSofascore({
    '/event/9601': { event: event(9601, 'finished') },
    '/event/9602': { event: event(9602, 'inprogress') },
    '/event/9603': { event: event(9603, 'finished') },
    '/event/9601/lineups': box,
    '/event/9602/lineups': box,
    '/event/9603/lineups': box,
  });
  const r = await getEventResults({ ids: [9601, 9602, 9603], players: [9601, '9602'] });
  assert.equal(r.items[9601].state, 'finalizado');
  assert.deepEqual(r.items[9601].players, { 'Ana Gómez': ROW, 'Cata Díaz': DNP, 'Bea Ruiz': DNP, 'Eva Sanz': ROW });
  assert.equal(r.items[9602].players, undefined, 'en vivo: sin box score');
  assert.equal(r.items[9603].players, undefined, 'no se pidió');
  assert.deepEqual(calls.filter((c) => c.endsWith('/lineups')), ['api.sofascore.com/event/9601/lineups']);
});

test('getEventResults: sin `players` no pide alineaciones; sin estadísticas no hay box score', async () => {
  const event = {
    id: 9701,
    startTimestamp: 1791800000,
    status: { type: 'finished' },
    homeTeam: { id: 1, name: 'A' },
    awayTeam: { id: 2, name: 'B' },
    homeScore: { current: 80 },
    awayScore: { current: 70 },
    winnerCode: 1,
  };
  const calls = mockSofascore({
    '/event/9701': { event },
    '/event/9701/lineups': lineups([pl('Sin Datos', 'S. Datos', 1)], [pl('Tampoco', 'T', 2, {})]),
  });
  const r = await getEventResults({ ids: [9701] });
  assert.deepEqual(r.items[9701], { state: 'finalizado', score: { home: 80, away: 70, homeNT: null, awayNT: null }, winner: 1 });
  assert.deepEqual(calls, ['api.sofascore.com/event/9701']);
  const r2 = await getEventResults({ ids: [9701], players: [9701] });
  assert.equal(r2.items[9701].players, undefined);
  // Alineación que no llega (404): sin box score, sin error.
  mockSofascore({ '/event/9701': { event } });
  const r3 = await getEventResults({ ids: [9701], players: [9701] });
  assert.equal(r3.items[9701].state, 'finalizado');
  assert.equal(r3.items[9701].players, undefined);
});
