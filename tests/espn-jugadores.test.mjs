import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  boxFromSummary,
  eventsFromScoreboard,
  findGame,
  finishedGames,
  gamesFromGamelog,
  getBoxScore,
  getPlayerHistory,
  getPlayerLogs,
  getScoreboard,
  matchEspnTeam,
  outFromSummary,
  playersFromSummary,
  sameAthlete,
  teamLogs,
  teamPlayersFromSummary,
} from '../extension/sources/espn.js';
import { compactRecord, expandRecord } from '../docs/js/analysis/records.js';
import { compactResult, expandResult } from '../docs/js/data-format.js';

// ---- Objetos con la forma real de site.api.espn.com (sondeo del 12-10-2026) ----

const NAMES = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
const KEYS = [
  'minutes',
  'points',
  'fieldGoalsMade-fieldGoalsAttempted',
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  'freeThrowsMade-freeThrowsAttempted',
  'rebounds',
  'assists',
  'turnovers',
  'steals',
  'blocks',
  'offensiveRebounds',
  'defensiveRebounds',
  'fouls',
  'plusMinus',
];

// Equipo como en /teams y en los competidores del marcador.
const team = (id, location, name, abbreviation, displayName = `${location} ${name}`) => ({
  id,
  uid: `s:40~l:46~t:${id}`,
  slug: displayName.toLowerCase().replace(/ /g, '-'),
  abbreviation,
  displayName,
  shortDisplayName: name,
  name,
  location,
  isActive: true,
});
const DAL = team('6', 'Dallas', 'Mavericks', 'DAL');
const HOU = team('10', 'Houston', 'Rockets', 'HOU');
const NBA_TEAMS = [
  DAL,
  HOU,
  team('12', 'LA', 'Clippers', 'LAC', 'LA Clippers'),
  team('13', 'Los Angeles', 'Lakers', 'LAL'),
  team('18', 'New York', 'Knicks', 'NY'),
  team('20', 'Philadelphia', '76ers', 'PHI'),
  team('22', 'Portland', 'Trail Blazers', 'POR'),
  team('23', 'Sacramento', 'Kings', 'SAC'),
];

// Jugador del box score. stats en el orden de `keys` (por defecto el de NAMES).
const athlete = (id, displayName, shortName, stats, extra = {}) => ({
  active: true,
  athlete: { id, uid: `s:40~l:46~a:${id}`, displayName, shortName, jersey: '1', position: { abbreviation: 'G' } },
  starter: false,
  didNotPlay: false,
  reason: '',
  ejected: false,
  stats,
  ...extra,
});
const block = (t, athletes, keys = KEYS) => {
  const names = keys.map((k) => NAMES[KEYS.indexOf(k)]);
  return { team: { id: t.id, displayName: t.displayName, abbreviation: t.abbreviation }, statistics: [{ names, keys, labels: names, athletes }] };
};
// Estadísticas por clave → arreglo en el orden de `keys`.
const line = (keys, s) => keys.map((k) => s[k] ?? '0');
const stat = (min, pts, fg, tp, ft, reb, ast, to, stl, blk, oreb, dreb) => ({
  minutes: String(min),
  points: String(pts),
  'fieldGoalsMade-fieldGoalsAttempted': fg,
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted': tp,
  'freeThrowsMade-freeThrowsAttempted': ft,
  rebounds: String(reb),
  assists: String(ast),
  turnovers: String(to),
  steals: String(stl),
  blocks: String(blk),
  offensiveRebounds: String(oreb),
  defensiveRebounds: String(dreb),
  fouls: '2',
  plusMinus: '-3',
});

// Rockets con las columnas en otro orden: hay que ubicarlas por `keys`.
const SHUFFLED = [...KEYS].reverse();
const SUMMARY = {
  header: { id: '401700500' },
  boxscore: {
    teams: [],
    players: [
      block(DAL, [
        athlete('4278049', 'Daniel Gafford', 'D. Gafford', ['15', '9', '3-3', '0-0', '3-3', '4', '0', '1', '0', '0', '2', '2', '2', '-12'], { starter: true }),
        athlete('6442', 'Kyrie Irving', 'K. Irving', ['36', '28', '10-20', '4-9', '4-4', '5', '7', '3', '2', '0', '1', '4', '2', '+5'], { starter: true }),
        athlete('4432816', 'Dereck Lively II', 'D. Lively II', [], { didNotPlay: true, reason: "DNP-COACH'S DECISION" }),
        athlete('4397136', 'Brandon Williams', 'B. Williams', ['0', '0', '0-0', '0-0', '0-0', '0', '0', '0', '0', '0', '0', '0', '0', '0']),
      ]),
      block(
        HOU,
        [
          athlete('4871144', 'Alperen Şengün', 'A. Şengün', line(SHUFFLED, { ...stat('34:30', 22, '9-17', '1-3', '3-4', 12, 6, 4, 1, 2, 3, 9) })),
          athlete('4684742', 'Amen Thompson', 'A. Thompson', line(SHUFFLED, { ...stat(31, 14, '6-10', '0-1', '2-2', 8, 5, 2, 2, 1, 2, 6), blocks: '--' })),
          athlete('2991230', 'Fred VanVleet', 'F. VanVleet', [], { didNotPlay: true, reason: 'INJURY' }),
        ],
        SHUFFLED,
      ),
    ],
  },
  injuries: [],
};

test('box score de ESPN: filas por clave, "x-y" anotados-intentados, DNP y 0 minutos', () => {
  const p = playersFromSummary(SUMMARY);
  assert.deepEqual(Object.keys(p), ['Daniel Gafford', 'Kyrie Irving', 'Dereck Lively II', 'Brandon Williams', 'Alperen Şengün', 'Amen Thompson', 'Fred VanVleet']);
  assert.deepEqual(p['Daniel Gafford'], { min: 15, pts: 9, reb: 4, ast: 0, tpm: 0, stl: 0, blk: 0, tov: 1, oreb: 2, dreb: 2, ftm: 3, fgm: 3, fga: 3, tpa: 0, fta: 3 });
  assert.deepEqual(p['Kyrie Irving'], { min: 36, pts: 28, reb: 5, ast: 7, tpm: 4, stl: 2, blk: 0, tov: 3, oreb: 1, dreb: 4, ftm: 4, fgm: 10, fga: 20, tpa: 9, fta: 4 });
  assert.deepEqual(p['Dereck Lively II'], { min: 0, dnp: true }, 'didNotPlay');
  assert.deepEqual(p['Brandon Williams'], { min: 0, dnp: true }, '0 minutos y nada más');
  // Columnas en otro orden, minutos "mm:ss" y un dato que falta ("--").
  assert.deepEqual(p['Alperen Şengün'], { min: 34.5, pts: 22, reb: 12, ast: 6, tpm: 1, stl: 1, blk: 2, tov: 4, oreb: 3, dreb: 9, ftm: 3, fgm: 9, fga: 17, tpa: 3, fta: 4 });
  assert.equal(p['Amen Thompson'].blk, null);
  assert.equal(p['Amen Thompson'].fgm, 6);
  assert.equal(p['Amen Thompson'].fga, 10);
  assert.deepEqual(p['Fred VanVleet'], { min: 0, dnp: true });
});

test('box score de ESPN: intentos del "x-y", de columnas propias o sin dato', () => {
  // "9-15": 9 anotados y 15 intentados.
  const one = (stats, keys = KEYS, names) => {
    const b = { names: names || keys.map((k) => NAMES[KEYS.indexOf(k)] ?? k), keys, athletes: [athlete('1', 'X Y', 'X. Y', stats)] };
    return playersFromSummary({ boxscore: { players: [{ team: { id: '6' }, statistics: [b] }] } })['X Y'];
  };
  const r = one(line(KEYS, stat(30, 21, '9-15', '2-6', '1-2', 5, 3, 1, 0, 0, 1, 4)));
  assert.deepEqual([r.fgm, r.fga, r.tpm, r.tpa, r.ftm, r.fta], [9, 15, 2, 6, 1, 2]);
  // "0-4": no metió ninguno en 4 intentos.
  const miss = one(line(KEYS, stat(12, 0, '0-4', '0-3', '0-0', 1, 0, 0, 0, 0, 0, 1)));
  assert.deepEqual([miss.fgm, miss.fga, miss.tpm, miss.tpa, miss.ftm, miss.fta], [0, 4, 0, 3, 0, 0]);
  // Columnas aparte de anotados e intentados (FGM / FGA, 3PM / 3PA, FTM / FTA).
  const keys = ['minutes', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointFieldGoalsMade', 'threePointFieldGoalsAttempted', 'freeThrowsMade', 'freeThrowsAttempted'];
  const names = ['MIN', 'PTS', 'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA'];
  const own = one(['28', '17', '7', '13', '1', '4', '2', '3'], keys, names);
  assert.deepEqual([own.fgm, own.fga, own.tpm, own.tpa, own.ftm, own.fta], [7, 13, 1, 4, 2, 3]);
  // Solo con nombres (sin claves).
  const nameBlock = { names, athletes: [athlete('2', 'A B', 'A. B', ['28', '17', '7', '13', '1', '4', '2', '3'])] };
  const byName = playersFromSummary({ boxscore: { players: [{ team: { id: '6' }, statistics: [nameBlock] }] } })['A B'];
  assert.deepEqual([byName.fga, byName.tpa, byName.fta], [13, 4, 3]);
  // Solo anotados (un número, sin columna de intentos): los intentos quedan sin dato, no en 0.
  const made = one(['28', '17', '7', '1', '2'], ['minutes', 'points', 'fieldGoalsMade', 'threePointFieldGoalsMade', 'freeThrowsMade'], ['MIN', 'PTS', 'FGM', '3PM', 'FTM']);
  assert.deepEqual([made.fgm, made.fga, made.tpm, made.tpa, made.ftm, made.fta], [7, null, 1, null, 2, null]);
  // "--" o intentos menores que anotados (dato roto): sin dato.
  const broken = one(line(KEYS, { ...stat(30, 21, '--', '5-3', '1-2', 5, 3, 1, 0, 0, 1, 4) }));
  assert.deepEqual([broken.fgm, broken.fga, broken.tpm, broken.tpa, broken.fta], [null, null, 5, null, 2]);
});

test('box score de ESPN: un equipo y resúmenes vacíos o raros', () => {
  const hou = teamPlayersFromSummary(SUMMARY, 10);
  assert.deepEqual(
    hou.map((x) => [x.id, x.name, x.short]),
    [
      ['4871144', 'Alperen Şengün', 'A. Şengün'],
      ['4684742', 'Amen Thompson', 'A. Thompson'],
      ['2991230', 'Fred VanVleet', 'F. VanVleet'],
    ],
  );
  assert.equal(teamPlayersFromSummary(SUMMARY, '6').length, 4);
  assert.deepEqual(teamPlayersFromSummary(SUMMARY, '999'), []);
  assert.deepEqual(playersFromSummary({}), {});
  assert.deepEqual(playersFromSummary(null), {});
  assert.deepEqual(boxFromSummary({ boxscore: { players: [{ team: { id: '6' }, statistics: [] }] } }), { 6: [] });
  // Solo con `names` (sin `keys`) también se ubican las columnas.
  const onlyNames = { boxscore: { players: [{ team: { id: '6' }, statistics: [{ names: NAMES, athletes: [athlete('1', 'X Y', 'X. Y', ['20', '11', '4-8', '1-2', '2-2', '3', '2', '1', '0', '1', '1', '2', '1', '0'])] }] }] } };
  assert.deepEqual(playersFromSummary(onlyNames)['X Y'], { min: 20, pts: 11, reb: 3, ast: 2, tpm: 1, stl: 0, blk: 1, tov: 1, oreb: 1, dreb: 2, ftm: 2, fgm: 4, fga: 8, tpa: 2, fta: 2 });
});

test('bajas del partido por jugar: Out y suspensión sí; Day-To-Day no', () => {
  const summary = {
    injuries: [
      {
        team: { id: '10', displayName: 'Houston Rockets' },
        injuries: [
          { status: 'Out', athlete: { id: '2991230', displayName: 'Fred VanVleet' }, type: { name: 'INJURY_STATUS_OUT', description: 'out' }, details: { fantasyStatus: { description: 'OUT' } } },
          { status: 'Day-To-Day', athlete: { id: '1', displayName: 'Jabari Smith Jr.' }, type: { name: 'INJURY_STATUS_DAYTODAY', description: 'day-to-day' } },
          { status: 'Questionable', athlete: { id: '2', displayName: 'Tari Eason' } },
          { status: 'Suspension', athlete: { id: '3', displayName: 'Steven Adams' } },
        ],
      },
      { team: { id: '6' }, injuries: [{ status: 'Out', athlete: { id: '6442', displayName: 'Kyrie Irving' } }] },
    ],
  };
  assert.deepEqual(outFromSummary(summary, '10'), [
    { id: '2991230', name: 'Fred VanVleet' },
    { id: '3', name: 'Steven Adams' },
  ]);
  assert.deepEqual(outFromSummary(summary, 6), [{ id: '6442', name: 'Kyrie Irving' }]);
  assert.deepEqual(outFromSummary(summary, '13'), []);
  assert.deepEqual(outFromSummary({}, '10'), []);
});

test('equipos de ESPN por nombre: completo, sin tildes, LA = Los Angeles, apodo y abreviatura', () => {
  const id = (name, teams = NBA_TEAMS) => matchEspnTeam(name, teams)?.id ?? null;
  assert.equal(id('Los Angeles Clippers'), '12');
  assert.equal(id('L.A. Clippers'), '12');
  assert.equal(id('LA Clippers'), '12');
  assert.equal(id('LA Lakers'), '13');
  assert.equal(id('Los Ángeles Lakers'), '13');
  assert.equal(id('lakers'), '13');
  assert.equal(id('PHILADELPHIA 76ERS'), '20');
  assert.equal(id('Portland Trailblazers'), '22');
  assert.equal(id('NY Knicks'), '18');
  assert.equal(id('LAL'), '13');
  assert.equal(id('Houston Rockets'), '10');
  // Equipos femeninos como los nombra Flashscore ("... F").
  const wnba = [team('20', 'Atlanta', 'Dream', 'ATL'), team('129689', 'Golden State', 'Valkyries', 'GS')];
  assert.equal(id('Atlanta Dream F', wnba), '20');
  assert.equal(id('Golden State Valkyries F', wnba), '129689');
  // Solo la ciudad (dos equipos), otra liga u otro deporte: nada.
  assert.equal(id('Los Angeles'), null);
  assert.equal(id('Sydney Kings'), null, 'NBL: mismo apodo, otra ciudad');
  assert.equal(id('Real Madrid'), null);
  assert.equal(id(''), null);
  assert.equal(id('Lakers', []), null);
  // Dos equipos con el mismo apodo: ambiguo.
  assert.equal(id('Kings', [team('23', 'Sacramento', 'Kings', 'SAC'), team('99', 'Kansas City', 'Kings', 'KC')]), null);
  assert.equal(id('Sacramento Kings', [team('23', 'Sacramento', 'Kings', 'SAC'), team('99', 'Kansas City', 'Kings', 'KC')]), '23');
});

// Marcador del día: "Dallas Mavericks at Houston Rockets".
const scoreEvent = (id, date, home, away, state = 'post', completed = state === 'post', name = 'STATUS_FINAL') => ({
  id,
  name: `${away.displayName} at ${home.displayName}`,
  date,
  status: { type: { state, completed, name } },
  competitions: [
    {
      competitors: [
        { homeAway: 'home', team: home, score: '110' },
        { homeAway: 'away', team: away, score: '102' },
      ],
    },
  ],
});

test('marcador: estados, partido por nombres (también invertidos) y hora más cercana', () => {
  const events = eventsFromScoreboard({
    events: [
      scoreEvent('1', '2026-10-11T00:30Z', HOU, DAL),
      scoreEvent('2', '2026-10-11T02:00Z', NBA_TEAMS[3], NBA_TEAMS[2], 'in'),
      scoreEvent('3', '2026-10-11T03:00Z', NBA_TEAMS[4], NBA_TEAMS[5], 'pre'),
      scoreEvent('4', '2026-10-11T03:00Z', NBA_TEAMS[6], NBA_TEAMS[7], 'post', false, 'STATUS_POSTPONED'),
      scoreEvent('5', '2026-10-12T00:30Z', HOU, DAL, 'pre'),
    ],
  });
  assert.deepEqual(
    events.map((e) => [e.id, e.state, e.home.id, e.away.id]),
    [
      ['1', 'finalizado', '10', '6'],
      ['2', 'en_vivo', '13', '12'],
      ['3', 'pendiente', '18', '20'],
      ['4', 'aplazado', '22', '23'],
      ['5', 'pendiente', '10', '6'],
    ],
  );
  assert.equal(events[0].start, Date.parse('2026-10-11T00:30Z'));
  const start = Date.parse('2026-10-11T00:00Z');
  assert.equal(findGame(events, 'Houston Rockets', 'Dallas Mavericks', start)?.id, '1');
  assert.equal(findGame(events, 'Dallas Mavericks', 'Houston Rockets', start)?.id, '1', 'local y visita invertidos');
  assert.equal(findGame(events, 'Houston Rockets', 'Dallas Mavericks', Date.parse('2026-10-12T01:00Z'))?.id, '5', 'el más cercano');
  assert.equal(findGame(events, 'Houston Rockets', 'Dallas Mavericks', Date.parse('2026-10-14T00:00Z')), null, 'a más de 12 horas');
  assert.equal(findGame(events, 'Los Angeles Lakers', 'Los Angeles Clippers', start)?.id, '2');
  assert.equal(findGame(events, 'Houston Rockets', 'Los Angeles Lakers', start), null);
  assert.equal(findGame([], 'Houston Rockets', 'Dallas Mavericks', start), null);
  assert.deepEqual(eventsFromScoreboard({}), []);
});

const scheduleEvent = (id, date, completed = true) => ({ id, date, name: 'x', competitions: [{ status: { type: { completed, state: completed ? 'post' : 'pre' } } }] });

test('calendario: solo terminados antes del partido, del más reciente al más antiguo', () => {
  const schedule = {
    season: { year: 2027, type: 1 },
    events: [
      scheduleEvent('a', '2026-10-05T23:00Z'),
      scheduleEvent('b', '2026-10-09T23:00Z'),
      scheduleEvent('c', '2026-10-12T23:00Z', false),
      scheduleEvent('d', '2026-10-20T23:00Z'),
      { id: 'e', date: '2026-10-07T23:00Z', status: { type: { completed: true } } },
    ],
  };
  assert.deepEqual(finishedGames(schedule, Date.parse('2026-10-15T00:00Z')), [
    { id: 'b', start: Date.parse('2026-10-09T23:00Z') },
    { id: 'e', start: Date.parse('2026-10-07T23:00Z') },
    { id: 'a', start: Date.parse('2026-10-05T23:00Z') },
  ]);
  assert.equal(finishedGames(schedule).length, 4);
  assert.deepEqual(finishedGames({}), []);
});

test('últimos partidos de un equipo: solo los jugados, orden por minutos y bajas', () => {
  const row = (min, pts) => ({ min, pts, reb: 1, ast: 1, tpm: 0, stl: 0, blk: 0, tov: 0, oreb: 0, dreb: 1, ftm: 0, fgm: 2 });
  const box = (rows) => ({ 6: rows, 10: [{ id: '9', name: 'Otro', short: null, row: row(40, 40) }] });
  const games = [
    { start: 100, box: box([{ id: '1', name: 'A Uno', short: 'A. Uno', row: row(30, 10) }, { id: '2', name: 'B Dos', short: 'B. Dos', row: { min: 0, dnp: true } }]) },
    { start: 300, box: box([{ id: '1', name: 'A Uno', short: 'A. Uno', row: row(32, 12) }, { id: '2', name: 'B Dos', short: 'B. Dos', row: row(40, 30) }]) },
    { start: 200, box: { 10: [] } }, // el equipo no está en ese box score
    { start: 250, box: box([{ id: '3', name: 'C Tres', short: null, row: { min: 0, dnp: true } }, { id: '1', name: 'A Uno', short: 'A. Uno', row: row(28, 8) }]) },
  ];
  const r = teamLogs(games, '6', [{ id: null, name: 'B DOS' }]);
  assert.equal(r.teamGames, 3);
  assert.deepEqual(
    r.players.map((p) => [p.name, p.short, p.games.length, p.out]),
    [
      ['A Uno', 'A. Uno', 3, false],
      ['B Dos', 'B. Dos', 1, true],
    ],
    'C Tres no jugó ninguno; B Dos de baja (por nombre)',
  );
  assert.deepEqual(
    r.players[0].games.map((g) => [g.start, g.min, g.pts]),
    [
      [300, 32, 12],
      [250, 28, 8],
      [100, 30, 10],
    ],
  );
  assert.deepEqual(Object.keys(r.players[0].games[0]), ['start', 'min', 'pts', 'reb', 'ast', 'tpm', 'stl', 'blk', 'tov', 'oreb', 'dreb', 'ftm', 'fgm', 'fga', 'tpa', 'fta']);
  // La fila no trae intentos: quedan null (no 0).
  assert.deepEqual([r.players[0].games[0].fga, r.players[0].games[0].tpa, r.players[0].games[0].fta], [null, null, null]);
  assert.deepEqual(teamLogs([], '6'), { teamGames: 0, players: [] });
});

// ---- Pedidos (fetch simulado con las URL reales de ESPN) ----

const NBA = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const routes = new Map();
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  const r = routes.get(u);
  const body = typeof r === 'function' ? r() : r;
  if (body === undefined) return new Response('{"code":404,"message":"Not Found"}', { status: 404 });
  if (typeof body === 'number') return new Response('error', { status: body });
  return new Response(JSON.stringify(body), { status: 200 });
};
after(() => {
  globalThis.fetch = realFetch;
});
const countCalls = (part) => calls.filter((u) => u.includes(part)).length;

routes.set(`${NBA}/teams`, { sports: [{ leagues: [{ teams: NBA_TEAMS.map((t) => ({ team: t })) }] }] });

// Partido a analizar: Mavericks en Houston el 15-10-2026 a las 19:00 de Lima.
const START = Date.parse('2026-10-16T00:00:00Z');
routes.set(`${NBA}/scoreboard?dates=20261015`, { events: [scoreEvent('401800001', '2026-10-16T00:00Z', HOU, DAL, 'pre')] });
routes.set(`${NBA}/summary?event=401800001`, {
  boxscore: { players: [] },
  injuries: [
    { team: { id: '6' }, injuries: [{ status: 'Out', athlete: { id: '6442', displayName: 'Kyrie Irving' }, type: { name: 'INJURY_STATUS_OUT' } }] },
    { team: { id: '10' }, injuries: [{ status: 'Out', athlete: { displayName: 'Fred VanVleet' } }] },
  ],
});

// Mavericks: pretemporada 2027 con 2 terminados antes del partido; la temporada
// regular 2027 sin jugar; se completa con la regular 2026.
const day = (iso, k) => new Date(Date.parse(iso) - k * 2 * 86400000).toISOString();
routes.set(`${NBA}/teams/6/schedule`, {
  season: { year: 2027, type: 1, name: 'Preseason' },
  requestedSeason: { year: 2027, type: 1, name: 'Preseason' },
  events: [
    scheduleEvent('401800010', '2026-10-08T00:00Z'),
    scheduleEvent('401800011', '2026-10-11T00:00Z'),
    scheduleEvent('401800012', '2026-10-14T00:00Z', false),
    scheduleEvent('401800013', '2026-10-18T00:00Z'),
  ],
});
routes.set(`${NBA}/teams/6/schedule?season=2027&seasontype=2`, { season: { year: 2027, type: 2 }, events: [scheduleEvent('401810000', '2026-10-22T00:00Z', false)] });
routes.set(`${NBA}/teams/6/schedule?season=2026&seasontype=2`, {
  season: { year: 2026, type: 2 },
  events: Array.from({ length: 12 }, (_, k) => scheduleEvent(`40170${String(k).padStart(2, '0')}`, day('2026-04-12T23:30Z', k))),
});
// Rockets: calendario sin temporada informada (se deduce 2027); la regular 2027
// no responde y la 2026 tiene 12 partidos.
routes.set(`${NBA}/teams/10/schedule`, { events: [] });
routes.set(`${NBA}/teams/10/schedule?season=2027&seasontype=2`, 500);
routes.set(`${NBA}/teams/10/schedule?season=2026&seasontype=2`, {
  events: Array.from({ length: 12 }, (_, k) => scheduleEvent(`40175${String(k).padStart(2, '0')}`, day('2026-04-13T00:00Z', k))),
});

const OPP = team('99', 'Somewhere', 'Opponents', 'OPP');
const dalSummary = (k) => ({
  boxscore: {
    players: [
      block(DAL, [
        athlete('6442', 'Kyrie Irving', 'K. Irving', line(KEYS, stat(36, 20 + k, '8-16', '3-7', '1-1', 4, 6, 2, 1, 0, 1, 3))),
        athlete('3', 'Klay Thompson', 'K. Thompson', line(KEYS, stat(30, 15, '5-12', '4-9', '1-1', 3, 2, 1, 1, 0, 0, 3))),
        athlete('4278049', 'Daniel Gafford', 'D. Gafford', line(KEYS, stat(20, 10, '5-6', '0-0', '0-1', 7, 1, 1, 0, 2, 3, 4))),
        k % 2 ? athlete('4432816', 'Dereck Lively II', 'D. Lively II', line(KEYS, stat(18, 6, '3-4', '0-0', '0-0', 8, 1, 0, 1, 1, 3, 5))) : athlete('4432816', 'Dereck Lively II', 'D. Lively II', [], { didNotPlay: true }),
      ]),
      block(OPP, [athlete('77', 'Rival', 'R. Rival', line(KEYS, stat(40, 40, '15-20', '5-5', '5-5', 5, 5, 1, 1, 1, 1, 4)))]),
    ],
  },
});
const houSummary = () => ({
  boxscore: {
    players: [
      block(OPP, []),
      block(HOU, [
        athlete('4871144', 'Alperen Şengün', 'A. Şengün', line(KEYS, stat(34, 21, '9-15', '0-1', '3-4', 10, 5, 3, 1, 1, 3, 7))),
        athlete('2991230', 'Fred VanVleet', 'F. VanVleet', line(KEYS, stat(33, 16, '5-13', '3-8', '3-3', 3, 7, 2, 2, 0, 0, 3))),
      ]),
    ],
  },
});
const dalIds = ['401800010', '401800011', ...Array.from({ length: 12 }, (_, k) => `40170${String(k).padStart(2, '0')}`)];
dalIds.forEach((id, k) => routes.set(`${NBA}/summary?event=${id}`, dalSummary(k)));
for (let k = 0; k < 12; k++) routes.set(`${NBA}/summary?event=40175${String(k).padStart(2, '0')}`, houSummary());
// Un box score de los Rockets falla la primera vez.
let flaky = 0;
routes.set(`${NBA}/summary?event=4017503`, () => (flaky++ ? houSummary() : 500));

test('getPlayerLogs: pretemporada + temporada regular anterior, box scores y bajas', async () => {
  const r = await getPlayerLogs({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START, n: 10 });
  assert.equal(r.mode, 'direct');
  assert.equal(r.away.team, 'Dallas Mavericks');
  assert.equal(r.away.teamGames, 10);
  assert.deepEqual(
    r.away.players.map((p) => [p.name, p.games.length, p.out]),
    [
      ['Kyrie Irving', 10, true],
      ['Klay Thompson', 10, false],
      ['Daniel Gafford', 10, false],
      ['Dereck Lively II', 5, false],
    ],
    'por minutos promedio; Kyrie de baja; Lively solo los que jugó; el rival no aparece',
  );
  const gafford = r.away.players[2];
  assert.equal(gafford.short, 'D. Gafford');
  assert.deepEqual(
    gafford.games.slice(0, 3).map((g) => g.start),
    [Date.parse('2026-10-11T00:00Z'), Date.parse('2026-10-08T00:00Z'), Date.parse('2026-04-12T23:30Z')],
    'pretemporada primero, luego la regular 2026; nada posterior al partido',
  );
  assert.deepEqual(gafford.games[0], {
    start: Date.parse('2026-10-11T00:00Z'), min: 20, pts: 10, reb: 7, ast: 1, tpm: 0, stl: 0, blk: 2, tov: 1, oreb: 3, dreb: 4, ftm: 0, fgm: 5, fga: 6, tpa: 0, fta: 1,
  });
  // Şengün: "9-15" → 9 anotados y 15 intentados en cada partido.
  assert.deepEqual([r.home.players[0].games[0].fgm, r.home.players[0].games[0].fga], [9, 15]);
  assert.equal(r.away.players[0].games[0].pts, 21, 'Kyrie en el partido más reciente (k = 1)');
  // Rockets: un box score falló (se omite) y VanVleet de baja por nombre.
  assert.equal(r.home.team, 'Houston Rockets');
  assert.equal(r.home.teamGames, 9);
  assert.deepEqual(
    r.home.players.map((p) => [p.name, p.out]),
    [
      ['Alperen Şengün', false],
      ['Fred VanVleet', true],
    ],
  );
  assert.equal(countCalls('/teams/6/schedule?season=2026&seasontype=2'), 1);
  assert.equal(countCalls('/teams/10/schedule?season=2027&seasontype=2'), 1);
  assert.equal(countCalls('/summary?event=401800013'), 0, 'partido posterior: no se pide');
  assert.equal(countCalls('/summary?event=4017010'), 0, 'solo los 10 más recientes');

  // Segunda vez: los box scores quedan en caché (salvo el que falló).
  const before = countCalls('/summary?event=4017');
  const r2 = await getPlayerLogs({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START });
  assert.equal(r2.home.teamGames, 10);
  assert.equal(countCalls('/summary?event=4017') - before, 1, 'solo se repite el que falló');
  assert.equal(calls.filter((u) => u === `${NBA}/teams`).length, 1, 'equipos en caché');
});

// Registro de un jugador (gamelog) con la forma real de site.web.api.espn.com (sondeo del 14-10-2026).
const LOG_NAMES = ['minutes', 'fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointPct', 'freeThrowsMade-freeThrowsAttempted', 'freeThrowPct', 'totalRebounds', 'assists', 'blocks', 'steals', 'fouls', 'turnovers', 'points'];
const LOG_LABELS = ['MIN', 'FG', 'FG%', '3PT', '3P%', 'FT', 'FT%', 'REB', 'AST', 'BLK', 'STL', 'PF', 'TO', 'PTS'];
const gamelog = (regular, pre = []) => {
  const row = (g) => ({ eventId: g.id, stats: [String(g.min), '8-16', '50.0', '2-6', '33.3', '5-6', '83.3', String(g.reb), '7', '0', '1', '3', '2', String(g.pts)] });
  return {
    labels: LOG_LABELS,
    names: LOG_NAMES,
    events: Object.fromEntries([...regular, ...pre].map((g) => [g.id, { id: g.id, gameDate: g.date, ...(g.opp ? { opponent: { abbreviation: g.opp }, atVs: g.at } : {}) }])),
    seasonTypes: [
      ...(regular.length ? [{ displayName: '2025-26 Regular Season', categories: [{ displayName: 'april', events: regular.map(row) }] }] : []),
      ...(pre.length ? [{ displayName: '2026-27 Preseason', categories: [{ displayName: 'Preseason', events: pre.map(row) }] }] : []),
    ],
  };
};
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';

test('registro de un jugador: temporada regular sin la pretemporada, intentos y sin rebotes ofensivos', () => {
  const games = gamesFromGamelog(gamelog([{ id: 'a', date: '2026-04-10T23:30Z', min: 36, pts: 30, reb: 9, opp: 'CLE', at: '@' }], [{ id: 'c', date: '2026-10-08T00:00Z', min: 20, pts: 12, reb: 3 }]));
  // Con el rival (sigla) y si jugó de local, para la pestaña Datos.
  assert.deepEqual(games, [{ start: Date.parse('2026-04-10T23:30Z'), min: 36, pts: 30, reb: 9, ast: 7, tpm: 2, stl: 1, blk: 0, tov: 2, oreb: null, dreb: null, ftm: 5, fgm: 8, fga: 16, tpa: 6, fta: 6, opp: 'CLE', home: false }]);
  assert.deepEqual(gamesFromGamelog({}), []);
});

test('nombres de jugador de la casa frente a ESPN', () => {
  const luka = { displayName: 'Luka Dončić' };
  assert.equal(sameAthlete('Luka Doncic', luka), true);
  assert.equal(sameAthlete('L. Doncic', luka), true);
  assert.equal(sameAthlete('Doncic L.', luka), true);
  assert.equal(sameAthlete('Dereck Lively', { displayName: 'Dereck Lively II' }), true);
  assert.equal(sameAthlete('Jalen Williams', { displayName: 'Jaylin Williams' }), false);
  assert.equal(sameAthlete('J. Williams', { displayName: 'Luka Dončić' }), false);
});

test('getPlayerLogs: los jugadores ofrecidos con pocos partidos en el equipo se completan con su registro', async () => {
  // Plantel actual de Dallas: Lively (5 partidos en los del equipo), un traspasado que
  // nunca jugó con Dallas y un novato sin partidos en la NBA.
  routes.set(`${NBA}/teams/6/roster`, {
    athletes: [
      { id: '4432816', displayName: 'Dereck Lively II', shortName: 'D. Lively II' },
      { id: '6583', displayName: 'Anthony Davis', shortName: 'A. Davis' },
      { id: '5000', displayName: 'Cooper Flagg', shortName: 'C. Flagg' },
      { id: '3', displayName: 'Klay Thompson', shortName: 'K. Thompson' },
    ],
  });
  // Davis: esta temporada solo la pretemporada (no cuenta); la anterior, 12 partidos con otro equipo.
  routes.set(`${WEB}/athletes/6583/gamelog?season=2027`, gamelog([], [{ id: 'p1', date: '2026-10-10T00:00Z', min: 22, pts: 14, reb: 6 }]));
  routes.set(`${WEB}/athletes/6583/gamelog?season=2026`, gamelog(Array.from({ length: 12 }, (_, k) => ({ id: `d${k}`, date: day('2026-04-12T23:30Z', k), min: 35, pts: 25 + k, reb: 11 }))));
  // Lively: el registro de la anterior repite sus partidos con Dallas y suma los que faltan.
  routes.set(`${WEB}/athletes/4432816/gamelog?season=2026`, gamelog(Array.from({ length: 12 }, (_, k) => ({ id: `l${k}`, date: day('2026-04-12T23:30Z', k), min: 18, pts: 6, reb: 8 }))));
  const r = await getPlayerLogs({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START, n: 10, names: ['Anthony Davis', 'D. Lively', 'Cooper Flagg', 'Klay Thompson', 'Alperen Sengun'] });
  const by = Object.fromEntries(r.away.players.map((p) => [p.name, p]));
  assert.equal(by['Anthony Davis'].games.length, 10, 'traspasado: sus partidos con el otro equipo');
  assert.equal(by['Anthony Davis'].games[0].pts, 25);
  assert.equal(by['Anthony Davis'].short, 'A. Davis');
  assert.equal(by['Dereck Lively II'].games.length, 10, 'los 5 con Dallas y 5 del registro, sin repetir partidos');
  assert.ok(!by['Cooper Flagg'], 'novato sin partidos: no se inventa');
  assert.equal(countCalls('/athletes/3/gamelog'), 0, 'Klay ya tiene 10 partidos con el equipo');
  assert.equal(countCalls('/athletes/4432816/gamelog?season=2027'), 1);
  // Houston sin plantel en ESPN (404): quedan sus partidos con el equipo.
  assert.equal(r.home.players.length, 2);
  // Sin nombres no se piden planteles ni registros.
  const plain = await getPlayerLogs({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START, n: 10 });
  assert.ok(!plain.away.players.some((p) => p.name === 'Anthony Davis'));
});

// Usa el plantel y los registros de Dallas de la prueba anterior.
test('getPlayerHistory (pestaña Datos): los de más minutos de cada equipo y los ofrecidos', async () => {
  const names = (r) => r.away.players.map((p) => p.name);
  // Sin nada ofrecido: el de más minutos (Davis 12 × 35 frente a Lively 12 × 18); sin la pretemporada.
  const top1 = await getPlayerHistory({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START, top: 1 });
  assert.deepEqual(names(top1), ['Anthony Davis']);
  assert.equal(top1.away.players[0].games.length, 12);
  assert.equal(top1.away.abbr, 'DAL');
  assert.deepEqual(top1.home.players, [], 'Houston sin plantel en ESPN');
  // Un ofrecido entra aunque no esté entre los de más minutos; uno sin partidos (Klay, sin registro), no.
  const offered = await getPlayerHistory({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START, top: 1, names: ['D. Lively', 'Klay Thompson'] });
  assert.deepEqual(names(offered), ['Anthony Davis', 'Dereck Lively II']);
  // Sin top: solo los ofrecidos.
  const only = await getPlayerHistory({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START, names: ['D. Lively'] });
  assert.deepEqual(names(only), ['Dereck Lively II']);
});

test('getPlayerLogs: un traspasado que enfrenta a su equipo anterior queda solo en su equipo actual', async () => {
  // Gafford pasó de Dallas a Houston: está en los partidos de Dallas y en el plantel de Houston.
  routes.set(`${NBA}/teams/10/roster`, { athletes: [{ id: '4278049', displayName: 'Daniel Gafford', shortName: 'D. Gafford' }, { id: '2991230', displayName: 'Fred VanVleet', shortName: 'F. VanVleet' }] });
  routes.set(`${WEB}/athletes/4278049/gamelog?season=2026`, gamelog(Array.from({ length: 10 }, (_, k) => ({ id: `g${k}`, date: day('2026-04-12T23:30Z', k), min: 22, pts: 11, reb: 7 }))));
  const r = await getPlayerLogs({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START, n: 10, names: ['Daniel Gafford'] });
  assert.ok(!r.away.players.some((p) => p.name === 'Daniel Gafford'), 'ya no es de Dallas');
  const g = r.home.players.find((p) => p.name === 'Daniel Gafford');
  assert.equal(g?.games.length, 10, 'en Houston, con su registro');
  assert.ok(r.away.players.some((p) => p.name === 'Klay Thompson'), 'los demás no cambian');
});

test('getPlayerLogs: en la temporada regular no cuenta la pretemporada aunque ESPN todavía la muestre', async () => {
  const r = await getPlayerLogs({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: START, n: 10, regular: true });
  const gafford = r.away.players.find((p) => p.name === 'Daniel Gafford');
  assert.equal(r.away.teamGames, 10);
  assert.equal(gafford.games[0].start, Date.parse('2026-04-12T23:30Z'), 'el más reciente es de la regular 2026, no la pretemporada de octubre');
});

test('getPlayerLogs: si ESPN falla con un equipo, el otro conserva sus jugadores y el error queda anotado', async () => {
  routes.set(`${NBA}/teams/18/schedule`, 503);
  const r = await getPlayerLogs({ league: 'nba', home: 'Houston Rockets', away: 'New York Knicks', start: START, n: 10 });
  assert.ok(r.home.players.length > 0);
  assert.equal(r.home.error, undefined);
  assert.deepEqual([r.away.team, r.away.players.length], ['New York Knicks', 0]);
  assert.match(r.away.error, /503/);
});

test('getPlayerLogs: errores claros con liga o equipo desconocidos', async () => {
  await assert.rejects(getPlayerLogs({ league: 'euroleague', home: 'Real Madrid', away: 'Barcelona', start: START }), /no soportada/);
  await assert.rejects(getPlayerLogs({ league: 'nba', home: 'Real Madrid', away: 'Barcelona', start: START }), /no se encontraron los equipos Real Madrid y Barcelona/);
});

test('getPlayerLogs: un equipo que ESPN no tiene (amistoso con un club de otra liga) queda sin jugadores', async () => {
  const r = await getPlayerLogs({ league: 'nba', home: 'London Lions', away: 'Dallas Mavericks', start: START });
  assert.deepEqual(r.home, { team: 'London Lions', teamGames: 0, players: [] });
  assert.ok(r.away.players.length > 0);
});

// Box scores de partidos terminados.
routes.set(`${NBA}/scoreboard?dates=20261010`, { events: [scoreEvent('401700500', '2026-10-11T00:30Z', HOU, DAL), scoreEvent('401700501', '2026-10-11T02:00Z', NBA_TEAMS[3], NBA_TEAMS[2], 'in')] });
routes.set(`${NBA}/summary?event=401700500`, SUMMARY);
routes.set(`${NBA}/scoreboard?dates=20261011`, { events: [] });
routes.set(`${NBA}/scoreboard?dates=20261012`, { events: [] });
routes.set(`${NBA}/scoreboard?dates=20261013`, { events: [scoreEvent('401700600', '2026-10-13T04:30Z', NBA_TEAMS[2], NBA_TEAMS[7])] });
routes.set(`${NBA}/summary?event=401700600`, { boxscore: { players: [] } });
routes.set(`${NBA}/scoreboard?dates=20261020`, 503);

test('getBoxScore: terminado, en vivo, al día siguiente, invertido y no encontrado', async () => {
  const box = await getBoxScore({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: Date.parse('2026-10-11T00:30Z') });
  assert.equal(box.state, 'finalizado');
  assert.equal(box.id, '401700500');
  assert.deepEqual(box.players, playersFromSummary(SUMMARY));
  assert.deepEqual(box.score, { home: 110, away: 102 });
  // Nombres invertidos y la hora en segundos.
  const swapped = await getBoxScore({ league: 'nba', home: 'Dallas Mavericks', away: 'Houston Rockets', start: Date.parse('2026-10-11T00:30Z') / 1000 });
  assert.equal(swapped.id, '401700500');
  assert.deepEqual(swapped.score, { home: 102, away: 110 }, 'el marcador se da vuelta con los equipos');
  // En vivo: sin jugadores y sin pedir el resumen.
  const live = await getBoxScore({ league: 'nba', home: 'Los Angeles Lakers', away: 'LA Clippers', start: Date.parse('2026-10-11T02:00Z') });
  assert.equal(live.id, '401700501');
  assert.equal(live.state, 'en_vivo');
  assert.equal(live.players, null);
  assert.equal(countCalls('/summary?event=401700501'), 0);
  // 23:30 de Lima del 12: ESPN lo lista el 13. Box score vacío → players null.
  const late = await getBoxScore({ league: 'nba', home: 'Los Angeles Clippers', away: 'Sacramento Kings', start: Date.parse('2026-10-13T04:30Z') });
  assert.equal(late.id, '401700600');
  assert.equal(late.state, 'finalizado');
  assert.equal(late.players, null);
  // No está (otro partido del día o liga sin ese partido).
  assert.equal(await getBoxScore({ league: 'nba', home: 'Houston Rockets', away: 'Los Angeles Lakers', start: Date.parse('2026-10-11T00:30Z') }), null);
  await assert.rejects(getBoxScore({ league: 'nba', home: 'A', away: 'B' }), /hora de inicio/);
  await assert.rejects(getBoxScore({ league: 'nbl', home: 'A', away: 'B', start: 1 }), /no soportada/);
  // El marcador del día queda en caché (por liga y fecha).
  assert.equal(calls.filter((u) => u === `${NBA}/scoreboard?dates=20261010`).length, 1);
  assert.equal(calls.filter((u) => u === `${NBA}/summary?event=401700500`).length, 1, 'box score terminado en caché');
});

test('getScoreboard: caché con maxAgeMs; los errores, solo un minuto', async () => {
  const n0 = calls.length;
  const box = () => getBoxScore({ league: 'nba', home: 'Houston Rockets', away: 'Dallas Mavericks', start: Date.parse('2026-10-20T23:00Z'), maxAgeMs: Infinity });
  await assert.rejects(box(), /HTTP 503/);
  await assert.rejects(box(), /HTTP 503/);
  assert.equal(calls.length - n0, 1, 'el error queda en caché');
  const realNow = Date.now;
  const t = realNow();
  Date.now = () => t + 61000;
  try {
    await assert.rejects(box(), /HTTP 503/);
  } finally {
    Date.now = realNow;
  }
  assert.equal(calls.length - n0, 2, 'pasado un minuto se reintenta aunque maxAgeMs sea Infinity');
  await getScoreboard({ league: 'nba', date: '2026-10-10' });
  assert.equal(calls.length - n0, 2, 'dentro de maxAgeMs no se vuelve a pedir');
  const sb = await getScoreboard({ league: 'nba', date: '20261010', maxAgeMs: 0 });
  assert.equal(calls.length - n0, 3, 'con maxAgeMs 0 se pide de nuevo');
  assert.equal(sb.events.length, 2);
});

// ---- Formato publicado ----

test('registro compacto con jugadores: ida y vuelta, DNP como 0 o [0]', () => {
  const players = { ...playersFromSummary(SUMMARY), 'Sofa Player': { min: 23.456789, pts: 7, reb: null, ast: 1, tpm: 1, stl: 0, blk: 0, tov: 2, oreb: null, dreb: null, ftm: 0, fgm: 3 } };
  const rec = { sport: 'basketball', state: 'finalizado', final: [110, 102], per: [[30, 25], [28, 27], [26, 25], [26, 25]], nReg: 4, players };
  const c = JSON.parse(JSON.stringify(compactRecord(rec)));
  // [min, pts, reb, ast, tpm, stl, blk, tov, oreb, dreb, ftm, fgm, fga, tpa, fta]
  assert.deepEqual(c.j['Daniel Gafford'], [15, 9, 4, 0, 0, 0, 0, 1, 2, 2, 3, 3, 3, 0, 3]);
  assert.deepEqual(c.j['Kyrie Irving'], [36, 28, 5, 7, 4, 2, 0, 3, 1, 4, 4, 10, 20, 9, 4]);
  assert.deepEqual(c.j['Sofa Player'], [23.46, 7, null, 1, 1, 0, 0, 2, null, null, 0, 3], 'sin intentos: los null del final no se escriben');
  assert.equal(c.j['Dereck Lively II'], 0);
  assert.equal(c.j['Brandon Williams'], 0);
  const back = expandRecord(c, 'basketball', 'finalizado');
  assert.deepEqual(back.players['Daniel Gafford'], players['Daniel Gafford']);
  assert.deepEqual(back.players['Kyrie Irving'], players['Kyrie Irving']);
  assert.deepEqual(back.players['Alperen Şengün'], players['Alperen Şengün']);
  assert.deepEqual(back.players['Fred VanVleet'], { min: 0, dnp: true });
  assert.deepEqual(back.players['Sofa Player'], { ...players['Sofa Player'], min: 23.46, fga: null, tpa: null, fta: null });
  assert.deepEqual(back.per, rec.per);
  // [0] también es "no jugó".
  assert.deepEqual(expandRecord({ j: { X: [0], Y: 0 } }, 'basketball', 'finalizado').players, { X: { min: 0, dnp: true }, Y: { min: 0, dnp: true } });
  // Registros publicados antes de los intentos (12 campos) se siguen leyendo: intentos null.
  const before = expandRecord({ j: { 'Kyrie Irving': [36, 28, 5, 7, 4, 2, 0, 3, 1, 4, 4, 10], Corto: [20, 8] } }, 'basketball', 'finalizado').players;
  assert.deepEqual(before['Kyrie Irving'], { min: 36, pts: 28, reb: 5, ast: 7, tpm: 4, stl: 2, blk: 0, tov: 3, oreb: 1, dreb: 4, ftm: 4, fgm: 10, fga: null, tpa: null, fta: null });
  assert.deepEqual(before.Corto, {
    min: 20, pts: 8, reb: null, ast: null, tpm: null, stl: null, blk: null, tov: null, oreb: null, dreb: null, ftm: null, fgm: null, fga: null, tpa: null, fta: null,
  });
  // Solo algunos intentos: se guarda hasta el último con dato.
  const some = compactRecord({ players: { Z: { min: 30, pts: 10, fga: 12 } } }).j.Z;
  assert.deepEqual(some, [30, 10, null, null, null, null, null, null, null, null, null, null, 12]);
  assert.deepEqual(expandRecord({ j: { Z: some } }).players.Z.fga, 12);
  // Sin ningún dato además de los minutos: igual son 2 valores (uno solo es "no jugó").
  assert.deepEqual(compactRecord({ players: { W: { min: 3 } } }).j.W, [3, null]);
  assert.deepEqual(expandRecord({ j: { W: [3, null] } }).players.W.dnp, undefined);
  // Registros viejos (sin jugadores) siguen igual.
  const old = expandRecord({ f: [2, 1], s: { corners: { ft: [5, 3] } } }, 'football', 'finalizado');
  assert.equal('players' in old, false);
  assert.equal('j' in compactRecord({ sport: 'football', final: [1, 0] }), false);
  assert.equal('j' in compactRecord({ sport: 'basketball', final: [1, 0], players: {} }), false);
});

test('resultado publicado con jugadores (sin registro de Flashscore)', () => {
  const ev = { id: 'fs:abc', state: 'finalizado', score: { home: 110, away: 102 } };
  const record = { sport: 'basketball', state: 'finalizado', final: [110, 102], players: playersFromSummary(SUMMARY) };
  const raw = JSON.parse(JSON.stringify(compactResult(ev, { record })));
  assert.equal(raw[3], null, 'sin periodos');
  const res = expandResult(raw, 'basketball');
  assert.deepEqual(res.record.final, [110, 102]);
  assert.deepEqual(res.record.players['Kyrie Irving'], { min: 36, pts: 28, reb: 5, ast: 7, tpm: 4, stl: 2, blk: 0, tov: 3, oreb: 1, dreb: 4, ftm: 4, fgm: 10, fga: 20, tpa: 9, fta: 4 });
  assert.deepEqual(res.record.players['Dereck Lively II'], { min: 0, dnp: true });
});
