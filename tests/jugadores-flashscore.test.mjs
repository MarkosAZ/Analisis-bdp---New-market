// Jugadores de las ligas de básquet que ESPN no cubre: la tabla de estadísticas de
// jugadores de Flashscore (df_psn) de los últimos partidos de cada equipo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fsPlayerName, parseFsPlayers } from '../docs/js/analysis/records.js';
import { teamPlayersFromBox } from '../docs/js/analysis/players.js';

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
  // Un solo partido: la sección que no es el rival.
  assert.equal(teamPlayersFromBox([{ start: 1, home: false, opp: 'Barcelona', teams }], { top: 1 })[0].name, 'Codi Miller-McIntyre');
});
