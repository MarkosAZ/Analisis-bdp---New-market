import assert from 'node:assert/strict';
import test from 'node:test';
import { findGame, inningsOf, parkRuns, relieversOf, sameTeam, startsFromGameLog } from '../extension/sources/mlb.js';
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
