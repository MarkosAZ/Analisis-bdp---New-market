import assert from 'node:assert/strict';
import test from 'node:test';
import { RETRY_MS, bullpenDates, findGame, getGameContext, inningsOf, lastStarts, parkRuns, relieversOf, sameTeam, startsFromGameLog } from '../extension/sources/mlb.js';
import { analyzeEvent, mergeMlb, weatherText } from '../docs/js/analysis/engine.js';
import { baseballModel, bullpenFactor, h2hRuns, isMlb, nbPmf, runsOutcomes, starterProfile, weatherFactor } from '../docs/js/analysis/baseball.js';
import { predict } from '../docs/js/analysis/models.js';
import { compactDay, expandDay } from '../docs/js/data-format.js';
import { sportOf } from '../docs/js/sports.js';

const cfg = sportOf('baseball');
const DAY = 864e5;

// ---- API de la MLB (forma real del sondeo del 14-10-2026) ----

const team = (id, name, teamName, shortName) => ({ id, name, teamName, shortName, locationName: name.replace(` ${teamName}`, ''), clubName: teamName });
const LAD = team(119, 'Los Angeles Dodgers', 'Dodgers', 'LA Dodgers');
const MIL = team(158, 'Milwaukee Brewers', 'Brewers', 'Milwaukee');
const BOS = team(111, 'Boston Red Sox', 'Red Sox', 'Boston');
const CWS = team(145, 'Chicago White Sox', 'White Sox', 'Chi White Sox');

test('MLB: entradas "5.2" y nombres de equipo de otras fuentes', () => {
  assert.equal(inningsOf('5.2'), 5 + 2 / 3);
  assert.equal(inningsOf('6.0'), 6);
  assert.equal(inningsOf(''), null);
  assert.ok(sameTeam('Los Angeles Dodgers', LAD));
  assert.ok(sameTeam('LA Dodgers', LAD));
  assert.ok(sameTeam('Dodgers', LAD));
  assert.ok(sameTeam('Boston Red Sox', BOS));
  assert.ok(!sameTeam('Boston Red Sox', CWS), 'Red Sox no es White Sox');
  assert.ok(!sameTeam('Milwaukee Brewers', LAD));
});

test('MLB: el partido por equipos y hora (no el de otra fecha de la serie)', () => {
  const g = (pk, date, home, away) => ({ gamePk: pk, gameDate: date, teams: { home: { team: home }, away: { team: away } } });
  const games = [g(1, '2026-10-15T00:00:00Z', LAD, MIL), g(2, '2026-10-16T01:00:00Z', LAD, MIL), g(3, '2026-10-15T22:00:00Z', BOS, CWS)];
  assert.equal(findGame(games, 'Los Angeles Dodgers', 'Milwaukee Brewers', Date.parse('2026-10-16T01:05:00Z'))?.gamePk, 2);
  assert.equal(findGame(games, 'Milwaukee Brewers', 'Los Angeles Dodgers', Date.parse('2026-10-15T00:00:00Z')), null, 'local y visita al revés');
  assert.equal(findGame(games, 'Los Angeles Dodgers', 'Milwaukee Brewers', Date.parse('2026-10-18T00:00:00Z')), null);
});

test('MLB: aperturas del registro (sin las salidas como relevista), relevistas y estadio', () => {
  const split = (date, gs, ip, r, extra = {}) => ({ date, opponent: { name: 'Houston Astros' }, stat: { gamesStarted: gs, inningsPitched: ip, runs: r, earnedRuns: r, hits: 4, baseOnBalls: 2, strikeOuts: 6, homeRuns: 1, hitBatsmen: 0, ...extra } });
  const starts = startsFromGameLog({ stats: [{ splits: [split('2026-09-13', 1, '5.0', 0), split('2026-09-16', 0, '1.0', 0), split('2026-09-19', 1, '5.2', 1)] }] });
  assert.deepEqual(
    starts.map((s) => [new Date(s.start).toISOString().slice(0, 10), Math.round(s.ip * 100) / 100, s.r, s.opp]),
    [
      ['2026-09-19', 5.67, 1, 'Houston Astros'],
      ['2026-09-13', 5, 0, 'Houston Astros'],
    ],
  );
  // Box score: el primer lanzador es el abridor; el resto, el bullpen.
  const box = { teams: { home: { team: { id: 119 }, pitchers: [1, 2, 3], players: { ID1: { stats: { pitching: { inningsPitched: '6.0', numberOfPitches: 95 } } }, ID2: { stats: { pitching: { inningsPitched: '2.1', numberOfPitches: 30 } } }, ID3: { stats: { pitching: { inningsPitched: '0.2', numberOfPitches: 12 } } } } }, away: { team: { id: 158 }, pitchers: [] } } };
  assert.deepEqual(relieversOf(box, 119), { ip: 3, np: 42 });
  assert.equal(relieversOf(box, 999), null);
  // Estadio: carreras por partido de local frente a visita.
  const game = (home, away, hs, as) => ({ status: { abstractGameState: 'Final' }, teams: { home: { team: { id: home }, score: hs }, away: { team: { id: away }, score: as } } });
  assert.deepEqual(parkRuns([game(119, 158, 5, 4), game(119, 158, 6, 5), game(158, 119, 2, 2), { status: { abstractGameState: 'Preview' }, teams: { home: { team: { id: 119 } }, away: { team: { id: 1 } } } }], 119), { home: 10, away: 4, nHome: 2, nAway: 1 });
});

// ---- Modelo ----

const games = (gf, ga, n = 10) => Array.from({ length: n }, (_, i) => ({ start: Date.parse('2026-10-10') - i * DAY, home: i % 2 === 0, gf, ga, r: gf > ga ? 'W' : 'L' }));
const base = { lastHome: games(4.5, 4.0), lastAway: games(4.3, 4.2) };
const ev = { sport: 'baseball', start: Date.parse('2026-10-15T00:00Z'), tournament: { name: 'MLB - Playoffs' } };
const startsOf = (ip, r, k, bb, hr) => Array.from({ length: 8 }, (_, i) => ({ start: Date.parse('2026-10-01') - i * 5 * DAY, ip, r, er: r, h: 5, bb, k, hr, hbp: 0 }));
const ACE = startsOf(6.33, 1, 8, 1, 0);
const BAD = startsOf(4.67, 4, 3, 3, 1);
const mlb = (home, away, extra = {}) => ({ source: 'mlb', home: { pitcher: { name: 'Local', starts: home }, bullpen: { ip: 5, np: 80, games: 2 } }, away: { pitcher: { name: 'Visita', starts: away }, bullpen: { ip: 5, np: 80, games: 2 } }, ...extra });
const p = (m, market, sel, line = null) => m.candidates.find((c) => c.market === market && c.sel === sel && c.line === line).p;

test('béisbol: carreras de un equipo con binomial negativa (desvío ~3 como en la MLB)', () => {
  const pm = nbPmf(4.4);
  const mean = pm.reduce((s, x, k) => s + x * k, 0);
  const sd = Math.sqrt(pm.reduce((s, x, k) => s + x * (k - mean) ** 2, 0));
  assert.ok(Math.abs(mean - 4.4) < 0.01);
  assert.ok(sd > 2.9 && sd < 3.2, `desvío ${sd}`);
  // Parejos: el empate tras 9 entradas se resuelve en extra (el local gana un poco más).
  const o = runsOutcomes(4.4, 4.4);
  assert.ok(Math.abs(o.home + o.away - 1) < 1e-9);
  assert.ok(o.home > 0.5 && o.home < 0.51);
  assert.ok(o.tie > 0.08 && o.tie < 0.12);
  // Run line: el local casi nunca gana por 2+ en extra (walk-off), la visita a veces sí.
  assert.ok(o.handicap(-1.5) < 0.4 && o.handicap(1.5) > 0.6);
  assert.ok(Math.abs(o.over(8.5) - 0.5) < 0.03);
});

test('béisbol: el abridor manda — un as baja las carreras del rival y sube al ganador', () => {
  const ace = starterProfile(ACE);
  const bad = starterProfile(BAD);
  assert.ok(ace.ra9 < 3.5 && bad.ra9 > 5, `${ace.ra9} / ${bad.ra9}`);
  assert.ok(ace.ip > 5.8 && bad.ip < 5, 'entradas por apertura');
  // Pocas aperturas: cerca de la media de la liga.
  assert.ok(Math.abs(starterProfile(ACE.slice(0, 1)).ra9 - 4.4) < Math.abs(ace.ra9 - 4.4));
  const none = baseballModel(ev, base, cfg, {});
  const good = baseballModel(ev, { ...base, mlb: mlb(ACE, BAD) }, cfg, {});
  const worse = baseballModel(ev, { ...base, mlb: mlb(BAD, ACE) }, cfg, {});
  assert.ok(p(good, 'ML', 'home') > p(none, 'ML', 'home') + 0.08, 'as local contra abridor flojo');
  assert.ok(p(worse, 'ML', 'home') < p(none, 'ML', 'home') - 0.08);
  assert.ok(good.expected.away < none.expected.away && good.expected.home > none.expected.home);
  // Sin abridor anunciado de un lado: solo cuenta el otro.
  const half = baseballModel(ev, { ...base, mlb: mlb(null, BAD) }, cfg, {});
  assert.ok(half.expected.home > none.expected.home && Math.abs(half.expected.away - none.expected.away) < 0.3);
  assert.equal(predict(ev, { ...base, mlb: mlb(ACE, BAD) }, cfg, {}).baseball.home.name, 'Local', 'predict usa el modelo del béisbol');
});

test('béisbol: contexto — bullpen cansado, estadio, clima y enfrentamientos', () => {
  assert.equal(bullpenFactor({ ip: 13, games: 3 }), 1.06);
  assert.equal(bullpenFactor({ ip: 2, games: 1 }), 0.98);
  assert.equal(bullpenFactor(null), 1);
  assert.equal(weatherFactor({ condition: 'Dome', temp: 95, wind: '15 mph, Out To CF' }), 1, 'techado: sin clima');
  assert.ok(weatherFactor({ condition: 'Sunny', temp: 90, wind: '12 mph, Out To CF' }) > 1.05);
  assert.ok(weatherFactor({ condition: 'Cloudy', temp: 50, wind: '15 mph, In From LF' }) < 0.92);
  assert.equal(weatherFactor({ condition: 'Clear', temp: 70, wind: '5 mph, L To R' }), 1);
  // Enfrentamientos: solo los de los 2 últimos años y con al menos 3.
  const now = Date.parse('2026-10-15');
  const h2h = [6, 7, 5].map((gf, i) => ({ start: now - (i + 1) * 30 * DAY, gf, ga: 2 }));
  assert.equal(h2hRuns(h2h.slice(0, 2), now), null);
  assert.ok(h2hRuns(h2h, now).home > 5);
  assert.equal(h2hRuns(h2h.map((g) => ({ ...g, start: g.start - 800 * DAY })), now), null);
  const plain = baseballModel(ev, base, cfg, {});
  const tired = baseballModel(ev, { ...base, mlb: { ...mlb(null, null), away: { pitcher: null, bullpen: { ip: 14, games: 3 } } } }, cfg, {});
  assert.ok(tired.expected.home > plain.expected.home, 'bullpen rival cansado: más carreras');
  const coors = baseballModel(ev, { ...base, mlb: { ...mlb(null, null), park: { factor: 1.25, n: 300 }, weather: { condition: 'Sunny', temp: 88, wind: '10 mph, Out To CF' } } }, cfg, { lines: { OU: [8.5] } });
  assert.ok(p(coors, 'OU', 'over', 8.5) > p(baseballModel(ev, base, cfg, { lines: { OU: [8.5] } }), 'OU', 'over', 8.5) + 0.08);
  const rivals = baseballModel(ev, { ...base, h2hGames: h2h }, cfg, {});
  assert.ok(rivals.expected.home > plain.expected.home, 'el local le anota mucho a este rival');
  assert.ok(isMlb(ev) && !isMlb({ ...ev, tournament: { name: 'NPB - Playoffs' } }) && !isMlb({ ...ev, sport: 'football' }));
});

test('formato publicado: contexto de la MLB y enfrentamientos con carreras', () => {
  const event = { id: 'fs:mlb1', sport: 'baseball', start: Date.parse('2026-10-15T00:00Z'), tournament: { id: 'mlb', name: 'MLB - Playoffs', priority: 1 }, category: { name: 'Estados Unidos', alpha2: 'US' }, home: { id: 'h', name: 'Los Angeles Dodgers' }, away: { id: 'a', name: 'Milwaukee Brewers' }, state: 'pendiente' };
  const ctx = {
    source: 'mlb',
    gamePk: '823500',
    venue: 'Dodger Stadium',
    weather: { condition: 'Clear', temp: 72, wind: '6 mph, Out To CF' },
    series: 'NL Championship Series',
    park: { factor: 0.97, n: 320 },
    home: { team: 'Los Angeles Dodgers', pitcher: { id: '605483', name: 'Blake Snell', hand: 'L', starts: [{ start: Date.parse('2026-10-08T00:00Z'), ip: 6 + 1 / 3, r: 1, er: 1, h: 3, bb: 2, k: 9, hr: 0, hbp: 0, opp: 'Atlanta Braves' }] }, bullpen: { ip: 7.3, np: 120, games: 2 } },
    away: { team: 'Milwaukee Brewers', pitcher: null, bullpen: null },
  };
  const h2hGames = [{ start: Date.parse('2026-10-12T00:00Z'), gf: 4, ga: 7, home: false }];
  const day = expandDay(JSON.parse(JSON.stringify(compactDay({ date: '2026-10-14', sport: 'baseball', generated: 'g', events: [event], details: { [event.id]: { lastHome: [], lastAway: [], h2h: null, h2hGames, mlb: ctx } } }))));
  const d = day.details.get(event.id);
  assert.deepEqual(d.h2hGames, h2hGames);
  assert.equal(d.mlb.home.pitcher.name, 'Blake Snell');
  assert.ok(Math.abs(d.mlb.home.pitcher.starts[0].ip - ctx.home.pitcher.starts[0].ip) < 1e-3);
  assert.deepEqual({ ...d.mlb.home.pitcher.starts[0], ip: 0 }, { ...ctx.home.pitcher.starts[0], ip: 0 });
  assert.deepEqual([d.mlb.venue, d.mlb.weather, d.mlb.series, d.mlb.park, d.mlb.away.pitcher, d.mlb.home.bullpen], [ctx.venue, ctx.weather, ctx.series, ctx.park, null, ctx.home.bullpen]);
});

// ---- API de la MLB con fetch simulado ----

const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const logOf = (dates) => ({ stats: [{ splits: dates.map((date) => ({ date, opponent: { name: 'Rival' }, stat: { gamesStarted: 1, inningsPitched: '6.0', runs: 2, earnedRuns: 2, hits: 5, baseOnBalls: 1, strikeOuts: 7, homeRuns: 1, hitBatsmen: 0 } })) }] });
// Responde según la URL (season y gameType del registro); guarda las URLs pedidas.
async function withFetch(route, fn) {
  const saved = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const r = route(new URL(url));
    return r || json({ error: 'sin ruta' }, 404);
  };
  try {
    return { value: await fn(), urls };
  } finally {
    globalThis.fetch = saved;
  }
}
const logRoute = (table) => (u) => {
  const key = `${u.pathname.match(/people\/(\d+)/)?.[1]}|${u.searchParams.get('season')}|${u.searchParams.get('gameType')}`;
  const v = table[key];
  return v === undefined ? null : typeof v === 'number' ? json({ message: 'error' }, v) : json(logOf(v));
};
const BEFORE = Date.parse('2026-10-15T00:10:00Z');
const sept = (n) => Array.from({ length: n }, (_, i) => `2025-09-${String(28 - i * 2).padStart(2, '0')}`);

RETRY_MS.value = 0; // sin espera entre el intento y el reintento
const days = (r) => r.starts.map((x) => new Date(x.start).toISOString().slice(0, 10));
const regular = { postseason: false };

test('MLB: registro del abridor que falla — error o las más recientes (nunca las viejas como últimas)', async () => {
  // Falla la temporada regular de este año (también al reintentar): error, no la anterior.
  const failed = await withFetch(logRoute({ '9001|2026|R': 503, '9001|2025|R': sept(12) }), () => lastStarts(9001, 2026, BEFORE, regular).then(() => 'ok', (e) => e));
  assert.ok(failed.value instanceof Error && /503/.test(failed.value.message), String(failed.value));
  assert.equal(failed.urls.filter((u) => u.includes('people/9001') && u.includes('season=2026')).length, 2, 'un reintento');
  assert.ok(!failed.urls.some((u) => u.includes('season=2026&gameType=P')), 'en temporada regular no se piden los playoffs de este año');
  // Partido de playoffs: los playoffs se leen y la temporada regular falla → solo las de playoffs, con aviso.
  const post = await withFetch(logRoute({ '9005|2026|P': ['2026-10-07'], '9005|2026|R': 503 }), () => lastStarts(9005, 2026, BEFORE));
  assert.deepEqual(days(post.value), ['2026-10-07']);
  assert.match(post.value.incomplete, /503/);
  // 404 = sin registro (un novato sin playoffs): no es un error.
  const rookie = await withFetch(logRoute({ '9002|2026|R': ['2026-09-20', '2026-09-26'], '9002|2026|P': 404, '9002|2025|R': 404, '9002|2025|P': 404 }), () => lastStarts(9002, 2026, BEFORE));
  assert.deepEqual([rookie.value.starts.length, rookie.value.incomplete], [2, null]);
  // Temporada anterior sin leer: las de esta (son las más recientes), con aviso.
  const partial = await withFetch(logRoute({ '9003|2026|R': ['2026-09-20'], '9003|2025|P': [], '9003|2025|R': 503 }), () => lastStarts(9003, 2026, BEFORE, regular));
  assert.deepEqual(days(partial.value), ['2026-09-20']);
  assert.match(partial.value.incomplete, /503/);
  // Día inaugural (sin aperturas este año) y la temporada anterior sin leer: error, no "sin aperturas".
  const opener = await withFetch(logRoute({ '9006|2027|R': [], '9006|2026|P': 429, '9006|2026|R': sept(12) }), () => lastStarts(9006, 2027, Date.parse('2027-03-26T20:00:00Z'), regular).then(() => 'ok', (e) => e));
  assert.ok(opener.value instanceof Error, String(opener.value));
  // Un error pasajero: el reintento lo resuelve.
  let calls = 0;
  const flaky = await withFetch((u) => (u.pathname.includes('people/9007') && u.searchParams.get('season') === '2026' ? (++calls === 1 ? json({}, 503) : json(logOf(['2026-09-20']))) : null), () => lastStarts(9007, 2026, BEFORE, regular));
  assert.deepEqual([days(flaky.value), flaky.value.incomplete], [['2026-09-20'], null]);
});

test('MLB: a principio de temporada cuentan los playoffs de la temporada anterior', async () => {
  const { value } = await withFetch(
    logRoute({ '9004|2026|R': ['2026-04-10', '2026-04-04'], '9004|2025|R': sept(12), '9004|2025|P': ['2025-10-20', '2025-10-12', '2025-10-05'] }),
    () => lastStarts(9004, 2026, Date.parse('2026-04-15T23:00:00Z'), regular),
  );
  assert.deepEqual(days(value).slice(0, 6), ['2026-04-10', '2026-04-04', '2025-10-20', '2025-10-12', '2025-10-05', '2025-09-28']);
  assert.equal(value.starts.length, 10);
});

test('MLB: bullpen de los 3 días anteriores según la fecha local del partido (no la de UTC)', () => {
  // 7:10 pm en Milwaukee = 00:10 UTC del día siguiente: igual cuentan el 11, 12 y 13.
  assert.deepEqual(bullpenDates('2026-10-14', BEFORE), { from: '2026-10-11', to: '2026-10-14' });
  assert.deepEqual(bullpenDates('2026-10-14', Date.parse('2026-10-14T17:05:00Z')), { from: '2026-10-11', to: '2026-10-14' });
  assert.deepEqual(bullpenDates(null, Date.parse('2026-10-15T02:10:00Z')), { from: '2026-10-11', to: '2026-10-14' });
});

test('MLB: contexto con un registro que falla — avisa y no lo publica como "sin aperturas"', async () => {
  const game = {
    gamePk: 1,
    gameType: 'L',
    gameDate: '2026-10-15T00:10:00Z',
    officialDate: '2026-10-14',
    season: '2026',
    teams: { home: { team: MIL, probablePitcher: { id: 9101, fullName: 'Freddy Peralta' } }, away: { team: LAD, probablePitcher: { id: 9102, fullName: 'Blake Snell' } } },
  };
  const route = (u) => {
    if (u.pathname.endsWith('/schedule') && !u.searchParams.get('teamId')) return json({ dates: [{ games: [game] }] });
    if (u.pathname.endsWith('/schedule')) return json({ dates: [] });
    return logRoute({ '9101|2026|R': 503, '9102|2026|R': ['2026-10-08'], '9102|2026|P': [], '9102|2025|R': sept(12), '9102|2025|P': [] })(u);
  };
  const { value: ctx, urls } = await withFetch(route, () => getGameContext({ home: 'Milwaukee Brewers', away: 'Los Angeles Dodgers', start: BEFORE }));
  assert.equal(ctx.home.pitcher.starts, null, 'registro sin leer');
  assert.ok(ctx.away.pitcher.starts.length > 0);
  assert.deepEqual(
    ctx.partial.map((p) => [p.side, p.part]),
    [['home', 'starts']],
  );
  assert.match(ctx.partial[0].text, /^sin aperturas de Freddy Peralta: /);
  assert.ok(urls.some((u) => u.includes('teamId=158') && u.includes('startDate=2026-10-11') && u.includes('endDate=2026-10-14')), 'bullpen por fecha local');
  // Se publica como "sin leer" (null) y la tarjeta lo dice.
  const event = { id: 'fs:mlb2', sport: 'baseball', start: BEFORE, tournament: { id: 'mlb', name: 'MLB - Playoffs', priority: 1 }, category: { name: 'Estados Unidos', alpha2: 'US' }, home: { id: 'h', name: 'Milwaukee Brewers' }, away: { id: 'a', name: 'Los Angeles Dodgers' }, state: 'pendiente' };
  const day = expandDay(JSON.parse(JSON.stringify(compactDay({ date: '2026-10-14', sport: 'baseball', generated: 'g', events: [event], details: { [event.id]: { lastHome: [], lastAway: [], h2h: null, mlb: ctx } } }))));
  assert.equal(day.details.get(event.id).mlb.home.pitcher.starts, null);
  const m = baseballModel(ev, { ...base, mlb: day.details.get(event.id).mlb }, cfg, {});
  assert.ok(m.baseball.home.unread && !m.baseball.away.unread);
  // En la página: lo que falló en vivo sale del contexto publicado (mismo abridor).
  const published = { ...ctx, partial: undefined, home: { ...ctx.home, pitcher: { ...ctx.home.pitcher, starts: ctx.away.pitcher.starts }, bullpen: { ip: 4, np: 60, games: 2 } } };
  const merged = mergeMlb({ ...ctx, home: { ...ctx.home, bullpen: null }, partial: [...ctx.partial, { side: 'home', part: 'bullpen', text: 'sin bullpen de Milwaukee Brewers: HTTP 503' }] }, published);
  assert.equal(merged.partial, undefined);
  assert.equal(merged.home.pitcher.starts.length, ctx.away.pitcher.starts.length);
  assert.deepEqual(merged.home.bullpen, { ip: 4, np: 60, games: 2 });
  assert.equal(ctx.home.pitcher.starts, null, 'sin cambiar el contexto en vivo');
  const other = { ...published, home: { ...published.home, pitcher: { ...published.home.pitcher, id: '1' } } };
  assert.equal(mergeMlb(ctx, other).home.pitcher.starts, null, 'otro abridor: no se usan sus aperturas');
  assert.equal(mergeMlb(ctx, other).partial.length, 1);
  assert.equal(mergeMlb(ctx, null), ctx);
});

test('MLB: el bullpen no cuenta la pretemporada', async () => {
  const done = (pk, date, gameType) => ({ gamePk: pk, gameType, gameDate: date, status: { abstractGameState: 'Final', detailedState: 'Final' } });
  const opener = { gamePk: 50, gameType: 'R', gameDate: '2027-03-26T20:10:00Z', officialDate: '2027-03-26', season: '2027', teams: { home: { team: MIL }, away: { team: LAD } } };
  const box = { teams: { home: { team: { id: 158 }, pitchers: [1, 2], players: { ID1: { stats: { pitching: { inningsPitched: '2.0' } } }, ID2: { stats: { pitching: { inningsPitched: '7.0', numberOfPitches: 100 } } } } }, away: { team: { id: 1 }, pitchers: [] } } };
  const route = (u) => {
    if (u.pathname.endsWith('/schedule') && !u.searchParams.get('teamId')) return json({ dates: [{ games: [opener] }] });
    if (u.pathname.endsWith('/schedule') && !u.searchParams.get('season')) return json({ dates: [{ games: [done(41, '2027-03-24T17:05:00Z', 'S'), done(42, '2027-03-25T17:05:00Z', 'E')] }] });
    if (u.pathname.endsWith('/schedule')) return json({ dates: [] });
    if (u.pathname.includes('/boxscore')) return json(box);
    return null;
  };
  const { value: ctx } = await withFetch(route, () => getGameContext({ home: 'Milwaukee Brewers', away: 'Los Angeles Dodgers', start: Date.parse(opener.gameDate) }));
  assert.deepEqual(ctx.home.bullpen, { ip: 0, np: 0, games: 0 });
});

test('béisbol: la tarjeta — abridores solo con datos de la MLB, clima en castellano, empates', () => {
  const ml = [
    { source: 'apuestatotal', market: 'ML', sel: 'home', line: null, price: 1.9, group: 'apuestatotal|ml' },
    { source: 'apuestatotal', market: 'ML', sel: 'away', line: null, price: 1.9, group: 'apuestatotal|ml' },
  ];
  const team = (name) => ({ id: name, name });
  const kbo = { ...ev, id: 'kbo', home: team('LG Twins'), away: team('Hanwha Eagles'), tournament: { name: 'KBO - Play Offs' } };
  const tie = (list) => [{ ...list[0], gf: 3, ga: 3, r: 'D' }, ...list.slice(1)];
  const factors = (e, d) => analyzeEvent(e, d, ml, {}).candidates.flatMap((c) => c.factors);
  const kboFactors = factors(kbo, { lastHome: tie(base.lastHome), lastAway: base.lastAway });
  assert.ok(!kboFactors.some((f) => f.startsWith('Abridores')), 'sin datos de abridores fuera de la MLB');
  assert.ok(kboFactors.some((f) => /^Forma: LG Twins EG/.test(f)), kboFactors.find((f) => f.startsWith('Forma')));
  const mlbEv = { ...ev, id: 'mlb', home: team('Milwaukee Brewers'), away: team('Los Angeles Dodgers') };
  assert.ok(factors(mlbEv, base).includes('Abridores: sin datos de la MLB para este partido'));
  const withCtx = factors(mlbEv, { ...base, mlb: mlb(ACE, null) });
  assert.ok(withCtx.some((f) => f.startsWith('Abridores: Milwaukee Brewers: Local — ')));
  assert.equal(weatherText({ condition: 'Partly Cloudy', temp: 71, wind: '7 mph, R To L' }), 'parcialmente nublado, 22 °C, viento de 11 km/h cruzado');
  assert.equal(weatherText({ condition: 'Sunny', temp: 88, wind: '10 mph, Out To CF' }), 'soleado, 31 °C, viento de 16 km/h hacia el jardín central');
  assert.equal(weatherText({ condition: 'Roof Closed', temp: 72, wind: '0 mph, None' }), 'techado, 22 °C, sin viento');
  assert.equal(weatherText({ condition: 'Cloudy', temp: null, wind: '12 mph, In From LF' }), 'nublado, viento de 19 km/h desde el jardín izquierdo');
});

test('béisbol: sin abridor, el bullpen cansado pesa solo en las entradas de los relevistas', () => {
  const pen = (ip) => ({ ...mlb(null, null), away: { pitcher: null, bullpen: { ip, games: 3 } } });
  const rested = baseballModel(ev, { ...base, mlb: pen(6) }, cfg, {});
  const tired = baseballModel(ev, { ...base, mlb: pen(14) }, cfg, {});
  const withSp = (ip) => ({ ...pen(ip), away: { pitcher: { name: 'Visita', starts: startsOf(5.2, 2, 6, 2, 1) }, bullpen: { ip, games: 3 } } });
  const ratioNone = tired.expected.home / rested.expected.home;
  const ratioSp = baseballModel(ev, { ...base, mlb: withSp(14) }, cfg, {}).expected.home / baseballModel(ev, { ...base, mlb: withSp(6) }, cfg, {}).expected.home;
  assert.ok(ratioNone > 1 && ratioNone < 1.04, `${ratioNone}`);
  assert.ok(Math.abs(ratioNone - ratioSp) < 0.01, `${ratioNone} vs ${ratioSp}`);
});
