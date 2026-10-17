// Jugadores de las ligas de básquet que ESPN no cubre: la tabla de estadísticas de
// jugadores de Flashscore (df_psn) de los últimos partidos de cada equipo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { footballPlayersFromPMS, fsPlayerName, parseFsPlayers } from '../docs/js/analysis/records.js';
import { teamPlayersFromBox, teamPlayersFromPMS } from '../docs/js/analysis/players.js';
import { compactMatchData, expandMatchData } from '../docs/js/data-format.js';
import * as D from '../docs/js/datos.js';

// Barcelona 100 - 105 Olympiacos (Euroliga, 16-10-2026), tal como responde Flashscore.
const FEED = fs.readFileSync(new URL('./fixtures/flashscore/df_psn_euroliga.txt', import.meta.url), 'utf8');

test('tabla de jugadores de Flashscore: por equipo, con nombre completo y tiros de campo de 2 + 3', () => {
  const teams = parseFsPlayers(FEED);
  assert.deepEqual(teams.map((t) => [t.team, t.players.length]), [['Barcelona', 12], ['Olympiacos', 10]]);
  const martin = teams[0].players.find((p) => p.short === 'Martin T.');
  assert.deepEqual(martin, { id: 'SKPwJd7j', name: 'Tyrese Martin', short: 'Martin T.', pts: 17, reb: 7, ast: 2, min: 26.5, fgm: 7, fga: 12, tpm: 3, tpa: 6, ftm: 0, fta: 0, oreb: 1, dreb: 6, stl: 1, tov: 0, blk: 0 });
  // Los puntos cuadran con los tiros: 2 × 4 + 3 × 3 + 0.
  assert.equal(2 * (martin.fgm - martin.tpm) + 3 * martin.tpm + martin.ftm, martin.pts);
  assert.equal(fsPlayerName('Miller-McIntyre C.', '/jugador/miller-mcintyre-codi/GjA7yFRB/'), 'Codi Miller-McIntyre');
  assert.equal(fsPlayerName('Nenê', '/jugador/nene/abc/'), 'Nenê');
  // Sin la tabla (otra liga sin estadísticas): nada.
  assert.deepEqual(parseFsPlayers('A1÷¬~'), []);
});

test('jugadores de un equipo: su sección en cada partido, los de más minutos y los que ofrece la casa', () => {
  const teams = parseFsPlayers(FEED);
  // El mismo partido visto como dos partidos de Barcelona contra rivales distintos: su
  // equipo es la sección que se repite.
  const other = teams.map((t) => (t.team === 'Olympiacos' ? { ...t, team: 'Real Madrid' } : t));
  const matches = [
    { start: 2000, home: true, opp: 'Olympiacos', teams },
    { start: 1000, home: false, opp: 'Real Madrid', teams: other },
  ];
  const players = teamPlayersFromBox(matches, { top: 2, names: ['Kevin Punter'] });
  assert.deepEqual(players.map((p) => p.name), ['Joel Parra', 'Tyrese Martin', 'Kevin Punter']);
  assert.deepEqual(players[1].games.map((g) => [g.start, g.opp, g.home, g.pts]), [[2000, 'Olympiacos', true, 17], [1000, 'Real Madrid', false, 17]]);
  // Una serie contra el mismo rival (los dos equipos se repiten): nunca el rival, también
  // con su nombre largo.
  const series = [
    { start: 3000, home: false, opp: 'Barcelona', teams },
    { start: 2000, home: true, opp: 'FC Barcelona', teams },
  ];
  assert.ok(teamPlayersFromBox(series, { top: 20 }).every((p) => p.games.length === 2) && teamPlayersFromBox(series, { top: 20 }).some((p) => p.name === 'Aleksandar Vezenkov'));
  assert.ok(!teamPlayersFromBox(series, { top: 20 }).some((p) => p.name === 'Tyrese Martin'));
  // Un solo partido: la sección que no es el rival.
  assert.equal(teamPlayersFromBox([{ start: 1, home: false, opp: 'Barcelona', teams }], { top: 1 })[0].name, 'Codi Miller-McIntyre');
});

// Málaga 1 - 1 Espanyol (LaLiga, 2026): la API de "Estadísticas de jugadores" de
// Flashscore, reducida a 5 jugadores de cada equipo (arquero, 3 que más remataron y uno
// que no jugó).
const SSE = JSON.parse(fs.readFileSync(new URL('./fixtures/flashscore/futbol-jugadores-epmsse.json', import.meta.url), 'utf8'));
const SD = JSON.parse(fs.readFileSync(new URL('./fixtures/flashscore/futbol-jugadores-epmsd.json', import.meta.url), 'utf8'));

test('fútbol: remates y tiros al arco de cada jugador (solo los que jugaron)', () => {
  const data = footballPlayersFromPMS(SSE, SD);
  assert.deepEqual(data.teams, [{ id: '25tIqYiJ', name: 'Málaga', side: 'home' }, { id: 'QFfPdh1J', name: 'Espanyol', side: 'away' }]);
  assert.equal(data.players.length, 8, 'sin los suplentes que no entraron');
  const roberto = data.players.find((p) => p.name === 'Roberto Fernández');
  assert.deepEqual({ ...roberto }, { id: roberto.id, name: 'Roberto Fernández', teamId: 'QFfPdh1J', gk: false, min: 82, sh: 4, sot: 3, gl: 0, xg: 0.56 });
  assert.ok(data.players.some((p) => p.gk && p.name === 'Alfonso Herrero'));
  assert.equal(footballPlayersFromPMS(SSE, { data: { findEventPMSById: { stats: { entries: [] } } } }), null, 'partido sin la tabla');
});

test('fútbol: jugadores de un equipo (los que más rematan, sin arqueros) y el archivo del partido', () => {
  const data = footballPlayersFromPMS(SSE, SD);
  // Espanyol jugó de visita: sus jugadores; Málaga, de local.
  const espanyol = teamPlayersFromPMS([{ start: 2000, home: false, opp: 'Málaga', data }], { top: 2 });
  assert.deepEqual(espanyol.map((p) => p.name), ['Roberto Fernández', 'Edu Expósito']);
  const malaga = teamPlayersFromPMS([{ start: 2000, home: true, opp: 'Espanyol', data }], { top: 8 });
  assert.ok(malaga.every((p) => p.name !== 'Alfonso Herrero') && malaga.length === 3);
  assert.deepEqual(espanyol[0].games[0], { start: 2000, opp: 'Málaga', home: false, min: 82, sh: 4, sot: 3, gl: 0, xg: 0.56 });
  // Ida y vuelta del archivo del partido con los campos del fútbol.
  const d = { id: 'fs:x', sport: 'football', generated: 'g', home: { name: 'Espanyol', last: [] }, away: { name: 'Málaga', last: [] }, h2h: [], players: espanyol.map((p) => ({ side: 'home', ...p })), abbr: ['Espanyol', 'Málaga'] };
  const back = expandMatchData(JSON.parse(JSON.stringify(compactMatchData(d))));
  assert.deepEqual(back.players[0].games[0], espanyol[0].games[0]);
  // Barras: tiros al arco y remates.
  assert.deepEqual(D.playerSeries(back.players[0].games, 'fpl_sot').map((x) => x.value), [3]);
  assert.deepEqual(D.playerSeries(back.players[0].games, 'fpl_sh').map((x) => x.value), [4]);
  assert.equal(D.defaultPlayerStat('football'), 'fpl_sot');
  assert.deepEqual(D.playerGroups('football').map(([g]) => g), ['Remates', 'Otras']);
});
