import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from '../docs/js/analysis/outcomes.js';
import {
  basketballLeague,
  matchPlayer,
  normName,
  overProbability,
  PLAYER_STATS,
  playerProbability,
  playerValue,
  statValue,
} from '../docs/js/analysis/players.js';

// Fila de un partido en el formato normalizado del contrato (fga/tpa/fta: intentados).
const row = (o = {}) => ({ min: 34.5, pts: 27, reb: 8, ast: 9, tpm: 3, stl: 2, blk: 1, tov: 4, oreb: 1, dreb: 7, ftm: 5, fgm: 10, fga: 19, tpa: 7, fta: 6, ...o });
const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b}`);

test('códigos de estadística de jugador y su valor en un partido', () => {
  const codes = 'pl_2pa pl_2pm pl_3pa pl_3pm pl_ast pl_blk pl_dreb pl_fga pl_fgm pl_fta pl_ftm pl_oreb pl_pa pl_pr pl_pra pl_pts pl_ra pl_reb pl_sb pl_stl pl_tov';
  assert.deepEqual(Object.keys(PLAYER_STATS).sort(), codes.split(' '));
  assert.deepEqual(PLAYER_STATS.pl_fgm, ['fgm']);
  assert.deepEqual(PLAYER_STATS.pl_fga, ['fga']);
  assert.deepEqual(PLAYER_STATS.pl_3pa, ['tpa']);
  assert.deepEqual(PLAYER_STATS.pl_2pa, ['fga', '-tpa']);
  assert.deepEqual(PLAYER_STATS.pl_fta, ['fta']);
  const r = row();
  const expected = {
    pl_pts: 27, pl_reb: 8, pl_ast: 9, pl_3pm: 3, pl_stl: 2, pl_blk: 1, pl_tov: 4, pl_oreb: 1, pl_dreb: 7, pl_ftm: 5,
    pl_2pm: 7, pl_pra: 44, pl_pr: 35, pl_pa: 36, pl_ra: 17, pl_sb: 3,
    pl_fgm: 10, pl_fga: 19, pl_3pa: 7, pl_2pa: 12, pl_fta: 6,
  };
  for (const [code, v] of Object.entries(expected)) assert.equal(statValue(r, code), v, code);
  // Números como texto también sirven; ceros cuentan.
  assert.equal(statValue({ pts: '12', reb: '0', ast: 3 }, 'pl_pra'), 15);
  assert.equal(statValue({ fgm: 4, tpm: 4 }, 'pl_2pm'), 0);
  assert.equal(statValue({ fga: '15', tpa: '15' }, 'pl_2pa'), 0);
  assert.equal(statValue({ fga: 0, fgm: 0 }, 'pl_fga'), 0, 'no tiró: 0 intentos');
  // Intentos sin los anotados también valen.
  assert.equal(statValue({ fga: 15 }, 'pl_fga'), 15);
  assert.equal(statValue({ fta: 4, ftm: null }, 'pl_fta'), 4);
});

test('statValue de los intentos: sin el dato o con datos que se contradicen → null (no 0)', () => {
  // Fila de antes (sin intentos, como los registros ya publicados): solo valen las de siempre.
  const old = { min: 30, pts: 12, reb: 5, ast: 1, tpm: 2, stl: 0, blk: 0, tov: 1, oreb: 1, dreb: 4, ftm: 2, fgm: 4 };
  for (const code of ['pl_fga', 'pl_3pa', 'pl_2pa', 'pl_fta']) assert.equal(statValue(old, code), null, code);
  assert.equal(statValue(old, 'pl_fgm'), 4);
  assert.equal(statValue(old, 'pl_pts'), 12);
  assert.equal(statValue(row({ fga: null }), 'pl_fga'), null);
  assert.equal(statValue(row({ fga: null }), 'pl_2pa'), null);
  assert.equal(statValue(row({ tpa: undefined }), 'pl_2pa'), null, 'tiros de 2 intentados necesita los triples intentados');
  assert.equal(statValue(row({ fta: '' }), 'pl_fta'), null);
  assert.equal(statValue(row({ fgm: null }), 'pl_fgm'), null);
  // Menos intentos que anotados: el dato está roto.
  assert.equal(statValue(row({ fga: 8 }), 'pl_fga'), null, '8 intentos con 10 anotados');
  assert.equal(statValue(row({ fga: 8 }), 'pl_2pa'), null);
  assert.equal(statValue(row({ tpa: 2 }), 'pl_3pa'), null, '2 intentos con 3 triples');
  assert.equal(statValue(row({ fta: 4 }), 'pl_fta'), null, '4 intentos con 5 libres');
  // Negativos o restas negativas: null.
  assert.equal(statValue(row({ fga: 5, tpa: 7, fgm: 2 }), 'pl_2pa'), null);
  assert.equal(statValue({ fgm: 3, tpm: 4 }, 'pl_2pm'), null);
  assert.equal(statValue(row({ fga: -1 }), 'pl_fga'), null);
  assert.equal(statValue({ min: 0, dnp: true, fga: 10 }, 'pl_fga'), null);
});

test('statValue: null si falta una parte, si no jugó o si el código no existe', () => {
  assert.equal(statValue(row({ ast: null }), 'pl_pra'), null);
  assert.equal(statValue(row({ ast: undefined }), 'pl_pa'), null);
  assert.equal(statValue(row({ tpm: null }), 'pl_2pm'), null, 'tiros de 2 necesita los triples');
  assert.equal(statValue(row({ oreb: '' }), 'pl_oreb'), null);
  assert.equal(statValue(row({ pts: 'x' }), 'pl_pts'), null);
  assert.equal(statValue({ min: 0, dnp: true }, 'pl_pts'), null);
  assert.equal(statValue(null, 'pl_pts'), null);
  assert.equal(statValue(row(), 'pl_xyz'), null);
  assert.equal(statValue(row(), 'pts'), null);
  // El resto de partes no importa: puntos con rebotes nulos sigue valiendo.
  assert.equal(statValue(row({ reb: null }), 'pl_pts'), 27);
});

test('normName: minúsculas, sin tildes, puntos, guiones ni sufijos', () => {
  assert.equal(normName('Luka Dončić'), 'luka doncic');
  assert.equal(normName('Nikola Jokić'), 'nikola jokic');
  assert.equal(normName('Jaren Jackson Jr.'), 'jaren jackson');
  assert.equal(normName('Gary Payton II'), 'gary payton');
  assert.equal(normName('Tim Hardaway Jr'), 'tim hardaway');
  assert.equal(normName('Marcus Morris Sr.'), 'marcus morris');
  assert.equal(normName('Shai Gilgeous-Alexander'), 'shai gilgeous alexander');
  assert.equal(normName('P.J. Washington'), 'pj washington');
  assert.equal(normName('L. James'), 'l james');
  assert.equal(normName('L.James'), 'l james');
  assert.equal(normName("D'Angelo Russell"), 'dangelo russell');
  assert.equal(normName('De’Aaron Fox'), 'deaaron fox');
  assert.equal(normName('James, LeBron'), 'lebron james');
  assert.equal(normName('Jackson Jr., Jaren'), 'jaren jackson');
  assert.equal(normName('Jaren Jackson, Jr.'), 'jaren jackson');
  assert.equal(normName('Alperen Şengün'), 'alperen sengun');
  assert.equal(normName('Đorđe Đurić'), 'dorde duric');
  assert.equal(normName('  LEBRON   JAMES '), 'lebron james');
  assert.equal(normName(''), '');
  assert.equal(normName(null), '');
});

const ROSTER = [
  { name: 'LeBron James', short: 'L. James' },
  { name: 'Bronny James', short: 'B. James' },
  { name: 'Jalen Williams', short: 'J. Williams' },
  { name: 'Jaylin Williams', short: 'J. Williams' },
  { name: 'Shai Gilgeous-Alexander', short: 'S. Gilgeous-Alexander' },
  { name: 'Nickeil Alexander-Walker', short: 'N. Alexander-Walker' },
  { name: 'Karl-Anthony Towns', short: 'K. Towns' },
  { name: 'Luka Dončić', short: 'L. Dončić' },
  { name: 'Jaren Jackson Jr.', short: 'J. Jackson Jr.' },
  { name: 'P.J. Washington', short: 'P. Washington' },
  { name: 'Cameron Thomas', short: 'C. Thomas' },
  { name: 'Giannis Antetokounmpo', short: 'G. Antetokounmpo' },
  { name: 'Jrue Holiday', short: 'J. Holiday' },
  { name: 'Aaron Holiday', short: 'A. Holiday' },
];
const who = (q, list = ROSTER) => matchPlayer(q, list)?.name ?? null;

test('matchPlayer: igualdad, iniciales, "Apellido, Nombre", tildes y sufijos', () => {
  assert.equal(who('LeBron James'), 'LeBron James');
  assert.equal(who('lebron JAMES'), 'LeBron James');
  assert.equal(who('L. James'), 'LeBron James');
  assert.equal(who('James, LeBron'), 'LeBron James');
  assert.equal(who('James L.'), 'LeBron James');
  assert.equal(who('B. James'), 'Bronny James');
  assert.equal(who('Bronny James Jr.'), 'Bronny James');
  assert.equal(who('Luka Doncic'), 'Luka Dončić');
  assert.equal(who('Doncic, Luka'), 'Luka Dončić');
  assert.equal(who('Jaren Jackson'), 'Jaren Jackson Jr.');
  assert.equal(who('Jaren Jackson Jr'), 'Jaren Jackson Jr.');
  assert.equal(who('PJ Washington'), 'P.J. Washington');
  assert.equal(who('P. J. Washington'), 'P.J. Washington');
  assert.equal(who('Cam Thomas'), 'Cameron Thomas', 'nombre abreviado');
  assert.equal(who('Giannis Antetokoumpo'), 'Giannis Antetokounmpo', 'una letra de diferencia en el apellido');
  assert.equal(who('Jrue Holiday'), 'Jrue Holiday');
  assert.equal(who('Aaron Holiday'), 'Aaron Holiday');
  // Devuelve el objeto de la lista.
  assert.equal(matchPlayer('L. James', ROSTER), ROSTER[0]);
});

test('matchPlayer: apellidos y nombres compuestos', () => {
  assert.equal(who('Shai Gilgeous-Alexander'), 'Shai Gilgeous-Alexander');
  assert.equal(who('Shai Gilgeous Alexander'), 'Shai Gilgeous-Alexander');
  assert.equal(who('S. Gilgeous-Alexander'), 'Shai Gilgeous-Alexander');
  assert.equal(who('Gilgeous-Alexander'), 'Shai Gilgeous-Alexander');
  assert.equal(who('Nickeil Alexander-Walker'), 'Nickeil Alexander-Walker');
  assert.equal(who('N. Alexander Walker'), 'Nickeil Alexander-Walker');
  assert.equal(who('Karl-Anthony Towns'), 'Karl-Anthony Towns');
  assert.equal(who('Karl Anthony Towns'), 'Karl-Anthony Towns');
  assert.equal(who('KA Towns'), 'Karl-Anthony Towns');
  assert.equal(who('K. Towns'), 'Karl-Anthony Towns');
  assert.equal(who('Towns'), 'Karl-Anthony Towns', 'solo el apellido, si es único');
});

test('matchPlayer: ambiguos o sin candidato → null', () => {
  assert.equal(who('J. Williams'), null, 'Jalen y Jaylin');
  assert.equal(who('Williams'), null);
  assert.equal(who('J. Holiday'), 'Jrue Holiday', 'Aaron no empieza con J');
  assert.equal(who('J. Holiday', [...ROSTER, { name: 'Justin Holiday', short: 'J. Holiday' }]), null, 'Jrue y Justin');
  assert.equal(who('James'), null, 'LeBron y Bronny');
  assert.equal(who('Jalen Williams'), 'Jalen Williams', 'el nombre completo desempata');
  assert.equal(who('Jaylin Williams'), 'Jaylin Williams');
  assert.equal(who('Kevin Durant'), null);
  assert.equal(who('Lonnie Walker'), null, 'no confunde con Alexander-Walker');
  assert.equal(who('Marcus Thomas'), null, 'mismo apellido, otro nombre');
  assert.equal(who('LeBron'), null, 'solo el nombre de pila no alcanza');
  assert.equal(who('L.'), null);
  assert.equal(who(''), null);
  assert.equal(who(null), null);
  assert.equal(matchPlayer('LeBron James', []), null);
  assert.equal(matchPlayer('LeBron James', null), null);
  // Dos jugadores con el mismo nombre: ambiguo.
  assert.equal(matchPlayer('Chris Johnson', [{ name: 'Chris Johnson' }, { name: 'Chris Johnson' }]), null);
});

test('matchPlayer: lista de nombres (claves del box score) y jugadores sin "short"', () => {
  const keys = ['LeBron James', 'Austin Reaves', 'Luka Dončić', 'Dorian Finney-Smith'];
  assert.equal(matchPlayer('Luka Doncic', keys), 'Luka Dončić');
  assert.equal(matchPlayer('A. Reaves', keys), 'Austin Reaves');
  assert.equal(matchPlayer('Dorian Finney Smith', keys), 'Dorian Finney-Smith');
  assert.equal(matchPlayer('Rui Hachimura', keys), null);
  assert.equal(matchPlayer('Austin Reaves', [{ name: 'Austin Reaves' }, null, { short: 'L. James' }])?.name, 'Austin Reaves');
});

test('basketballLeague: NBA y WNBA, no otras ligas', () => {
  const ev = (t, c = 'USA', sport = 'basketball') => ({ sport, tournament: { name: t }, category: { name: c } });
  assert.equal(basketballLeague(ev('NBA')), 'nba');
  assert.equal(basketballLeague(ev('NBA - Pretemporada')), 'nba');
  assert.equal(basketballLeague(ev('NBA, Preseason')), 'nba');
  assert.equal(basketballLeague(ev('NBA Cup')), 'nba');
  assert.equal(basketballLeague(ev('Pretemporada', 'NBA')), 'nba', 'la liga puede venir en la categoría');
  assert.equal(basketballLeague(ev('WNBA')), 'wnba');
  assert.equal(basketballLeague(ev('WNBA - Playoffs')), 'wnba');
  assert.equal(basketballLeague(ev('NBL', 'Australia')), null);
  assert.equal(basketballLeague(ev('NBA G League')), null);
  assert.equal(basketballLeague(ev('G League')), null);
  assert.equal(basketballLeague(ev('NBA Summer League')), null);
  assert.equal(basketballLeague(ev('NBA - Liga de Verano')), null);
  assert.equal(basketballLeague(ev('PBA', 'Philippines')), null);
  assert.equal(basketballLeague(ev('NCAA')), null);
  assert.equal(basketballLeague(ev('Liga Nacional de Básquet', 'Argentina')), null);
  assert.equal(basketballLeague(ev('NBA', 'USA', 'esports')), null, 'otro deporte');
  assert.equal(basketballLeague({ tournament: { name: 'NBA' }, category: { name: 'USA' } }), 'nba', 'sin deporte');
  assert.equal(basketballLeague({ tournament: 'WNBA' }), 'wnba');
  assert.equal(basketballLeague(null), null);
  assert.equal(basketballLeague({}), null);
});

// ---- Probabilidad ----

const games = (values, extra = {}) => values.map((v, i) => row({ pts: v, start: Date.UTC(2026, 3, 30 - i), ...extra }));

// Binomial negativa por su fórmula (independiente de players.js).
function nbOver(m, variance, line) {
  const k = (m * m) / (variance - m);
  const q = k / (k + m);
  let p = q ** k;
  let cdf = p;
  for (let i = 1; i <= Math.floor(line); i++) {
    p *= ((k + i - 1) / i) * (1 - q);
    cdf += p;
  }
  return 1 - cdf;
}
function poissonOver(m, line) {
  let p = Math.exp(-m);
  let cdf = p;
  for (let i = 1; i <= Math.floor(line); i++) {
    p *= m / i;
    cdf += p;
  }
  return 1 - cdf;
}

test('playerProbability: sin dispersión usa Poisson con la media', () => {
  // Siempre 2 triples: Poisson(2), P(X > 2.5) = 1 − 5e⁻².
  const r = playerProbability(games(Array(10).fill(0)).map((g) => ({ ...g, tpm: 2 })), 'pl_3pm', 'over', 2.5);
  close(r.p, 1 - 5 * Math.exp(-2), 1e-12);
  assert.equal(r.mean, 2);
  close(r.sd, Math.sqrt(2), 1e-12, 'sd de la Poisson');
  assert.equal(r.n, 10);
  assert.equal(r.trend, 0);
  assert.equal(r.minutes, 34.5);
  const u = playerProbability(games(Array(10).fill(0)).map((g) => ({ ...g, tpm: 2 })), 'pl_3pm', 'under', 2.5);
  close(u.p, 5 * Math.exp(-2), 1e-12);
  // 20 puntos fijos.
  const pts = playerProbability(games(Array(10).fill(20)), 'pl_pts', 'over', 24.5);
  close(pts.p, poissonOver(20, 24.5), 1e-12);
  // Poca variación (varianza < media): también Poisson.
  const low = playerProbability(games([20, 21, 19, 20, 22, 18, 20, 21, 19, 20]), 'pl_pts', 'over', 24.5);
  close(low.p, poissonOver(low.mean, 24.5), 1e-12);
  close(low.sd, Math.sqrt(low.mean), 1e-12);
});

test('playerProbability: con más varianza que media usa binomial negativa (colas más gruesas)', () => {
  const r = playerProbability(games([32, 10, 30, 12, 31, 9, 28, 14, 30, 11]), 'pl_pts', 'over', 30.5);
  assert.ok(r.sd ** 2 > r.mean);
  close(r.p, nbOver(r.mean, r.sd ** 2, 30.5), 1e-9);
  assert.ok(r.p > poissonOver(r.mean, 30.5) + 0.1, 'más probable que con Poisson');
  const low = playerProbability(games([32, 10, 30, 12, 31, 9, 28, 14, 30, 11]), 'pl_pts', 'under', 10.5);
  close(low.p, 1 - nbOver(low.mean, low.sd ** 2, 10.5), 1e-9);
  assert.ok(low.p > 1 - poissonOver(low.mean, 10.5) + 0.1);
});

test('playerProbability: media y varianza ponderadas (lo reciente pesa más), con encogimiento leve', () => {
  const values = [30, 30, 30, 10, 10, 10, 10, 10, 10, 10];
  const r = playerProbability(games(values), 'pl_pts', 'over', 19.5);
  const w = values.map((_, k) => 0.9 ** k);
  const W = w.reduce((a, b) => a + b, 0);
  const W2 = w.reduce((a, b) => a + b * b, 0);
  const mw = values.reduce((s, x, k) => s + w[k] * x, 0) / W;
  const simple = 16;
  const m = (10 * mw + 2 * simple) / 12;
  close(r.mean, m, 1e-12, 'media');
  assert.ok(r.mean > simple && r.mean < mw);
  const v = values.reduce((s, x, k) => s + w[k] * (x - mw) ** 2, 0) / (W - W2 / W);
  close(r.sd, Math.sqrt(v * (1 + W2 / W ** 2)), 1e-12, 'sd con la incertidumbre de la media');
  close(r.trend, (30 - m) / r.sd, 1e-12, 'tendencia');
  assert.ok(r.trend > 0);
  // Al revés (mejoró hace tiempo): la media baja y la tendencia es negativa.
  const old = playerProbability(games([...values].reverse()), 'pl_pts', 'over', 19.5);
  assert.ok(old.mean < r.mean && old.trend < 0 && old.p < r.p);
});

test('playerProbability: solo los últimos maxGames jugados y con dato', () => {
  const recent = Array(10).fill(20);
  const a = playerProbability(games([...recent, 80, 90, 100]), 'pl_pts', 'over', 24.5);
  const b = playerProbability(games(recent), 'pl_pts', 'over', 24.5);
  assert.deepEqual(a, b, 'los partidos 11+ no cuentan');
  assert.equal(playerProbability(games([...recent, 80]), 'pl_pts', 'over', 24.5, { maxGames: 11 }).n, 11);
  // Partidos sin jugar o sin el dato se saltan (no cuentan como cero).
  const mixed = [
    { min: 0, dnp: true },
    row({ pts: 20, min: 0 }),
    row({ pts: 20, dnp: true }),
    row({ pts: null }),
    ...games([20, 20, 20, 20, 20]),
  ];
  const m = playerProbability(mixed, 'pl_pts', 'over', 24.5);
  assert.equal(m.n, 5);
  assert.equal(m.mean, 20);
  // Sin minutos en la fuente: minutes null, igual calcula.
  const noMin = playerProbability(games(Array(6).fill(20), { min: null }), 'pl_pts', 'over', 24.5);
  assert.equal(noMin.minutes, null);
  assert.equal(noMin.n, 6);
});

test('playerProbability de los intentos: partidos sin el dato se saltan (no son ceros)', () => {
  // 10 partidos: los 4 más recientes de una fuente sin intentos, los 6 siguientes con 20 intentos.
  const mixed = [
    ...games(Array(4).fill(25), { fga: null, tpa: null, fta: null }),
    ...games(Array(6).fill(25)).map((g) => ({ ...g, fga: 20, tpa: 8, fta: 6 })),
  ];
  const fga = playerProbability(mixed, 'pl_fga', 'over', 19.5);
  assert.equal(fga.n, 6);
  close(fga.mean, 20, 1e-9);
  close(fga.p, poissonOver(fga.mean, 19.5), 1e-12);
  const twos = playerProbability(mixed, 'pl_2pa', 'under', 12.5);
  close(twos.mean, 12, 1e-9, '20 − 8');
  close(twos.p, 1 - poissonOver(twos.mean, 12.5), 1e-12);
  close(playerProbability(mixed, 'pl_3pa', 'over', 7.5).mean, 8, 1e-9);
  assert.equal(playerProbability(mixed, 'pl_fta', 'over', 5.5).n, 6);
  // Los puntos usan los 10.
  assert.equal(playerProbability(mixed, 'pl_pts', 'over', 24.5).n, 10);
  // Con menos de 5 partidos con el dato no hay probabilidad (aunque haya 10 jugados).
  const few = [...games(Array(6).fill(25), { fga: null }), ...games(Array(4).fill(25))];
  assert.equal(playerProbability(few, 'pl_fga', 'over', 18.5), null);
  // Intentos más dispersos que la media: binomial negativa, igual que los anotados.
  const spread = games(Array(10).fill(25)).map((g, i) => ({ ...g, fga: [30, 12, 28, 10, 26, 14, 31, 9, 27, 13][i], fgm: 5 }));
  const r = playerProbability(spread, 'pl_fga', 'over', 22.5);
  assert.ok(r.sd ** 2 > r.mean);
  close(r.p, nbOver(r.mean, r.sd ** 2, 22.5), 1e-9);
});

test('playerProbability: null con pocos partidos o datos inválidos', () => {
  assert.equal(playerProbability(games([20, 20, 20, 20]), 'pl_pts', 'over', 24.5), null, 'menos de 5');
  assert.ok(playerProbability(games([20, 20, 20, 20, 20]), 'pl_pts', 'over', 24.5));
  assert.ok(playerProbability(games([20, 20, 20]), 'pl_pts', 'over', 24.5, { minGames: 3 }));
  assert.equal(playerProbability(games(Array(10).fill(20), { oreb: null }), 'pl_oreb', 'over', 0.5), null, 'la fuente no trae el dato');
  assert.equal(playerProbability(games(Array(10).fill(20)), 'pl_xyz', 'over', 24.5), null);
  assert.equal(playerProbability(games(Array(10).fill(20)), 'pl_pts', 'yes', 24.5), null);
  assert.equal(playerProbability(games(Array(10).fill(20)), 'pl_pts', 'over', null), null);
  assert.equal(playerProbability(games(Array(10).fill(20)), 'pl_pts', 'over', 'x'), null);
  assert.equal(playerProbability([], 'pl_pts', 'over', 24.5), null);
  assert.equal(playerProbability(null, 'pl_pts', 'over', 24.5), null);
  assert.equal(playerProbability([], 'pl_pts', 'over', 24.5, { minGames: 0 }), null);
});

test('playerProbability: complementarias, monótona en la línea y nunca 0 o 1', () => {
  const g = games([25, 31, 18, 22, 27, 35, 20, 24, 29, 16]);
  let prev = 1;
  for (const line of [5.5, 15.5, 20.5, 24.5, 28.5, 35.5, 60.5]) {
    const o = playerProbability(g, 'pl_pts', 'over', line);
    const u = playerProbability(g, 'pl_pts', 'under', line);
    close(o.p + u.p, 1, 1e-12, `línea ${line}`);
    assert.ok(o.p <= prev, `línea ${line}`);
    assert.ok(o.p >= 0.001 && o.p <= 0.999);
    prev = o.p;
  }
  // Línea en texto (como llega de la casa).
  assert.deepEqual(playerProbability(g, 'pl_pts', 'over', '24.5'), playerProbability(g, 'pl_pts', 'over', 24.5));
  // Nunca hizo un tapón: probabilidad baja, pero no cero.
  const blk = playerProbability(games(Array(10).fill(20), { blk: 0 }), 'pl_blk', 'over', 0.5);
  assert.ok(blk.p > 0.01 && blk.p < 0.1, String(blk.p));
  assert.equal(blk.trend, 0);
  // Estadísticas combinadas: PRA = 27 + 8 + 9 en cada partido.
  const pra = playerProbability(games(Array(10).fill(27)), 'pl_pra', 'over', 44.5);
  assert.equal(pra.mean, 44);
  close(pra.p, poissonOver(44, 44.5), 1e-12);
});

test('overProbability: Poisson y binomial negativa', () => {
  close(overProbability(2, 2, 2.5), 1 - 5 * Math.exp(-2), 1e-12);
  close(overProbability(2, 1, 2.5), 1 - 5 * Math.exp(-2), 1e-12, 'subdispersa: Poisson');
  close(overProbability(20, 60, 24.5), nbOver(20, 60, 24.5), 1e-12);
  close(overProbability(20, 20 + 1e-9, 24.5), poissonOver(20, 24.5), 1e-9, 'casi Poisson');
  close(overProbability(45, 400, 60.5), nbOver(45, 400, 60.5), 1e-9);
  assert.equal(overProbability(5, 5, -0.5), 1);
  assert.equal(overProbability(0, 0, 0.5), 0);
  close(overProbability(3, 3, 0), 1 - Math.exp(-3), 1e-12, 'línea entera: estrictamente mayor');
});

// ---- Liquidación ----

const REC = {
  sport: 'basketball',
  state: 'finalizado',
  final: [112, 108],
  per: [[30, 25], [28, 30], [26, 27], [28, 26]],
  nReg: 4,
  players: {
    'LeBron James': row({ pts: 27, reb: 8, ast: 9 }),
    'Luka Dončić': row({ pts: 35, reb: 10, ast: 11, tpm: 5, fgm: 12, fga: 24, tpa: 11, ftm: 6, fta: 9 }),
    'Jaren Jackson Jr.': row({ pts: 18, reb: 6, ast: 1, blk: 3 }),
    'Austin Reaves': { min: 0, dnp: true },
    'Gabe Vincent': row({ min: 0, pts: 0, reb: 1, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 }),
    'Jarred Vanderbilt': row({ oreb: null }),
    // Registro publicado antes de los intentos (12 campos).
    'Rui Hachimura': { min: 30, pts: 12, reb: 5, ast: 1, tpm: 2, stl: 0, blk: 0, tov: 1, oreb: 1, dreb: 4, ftm: 2, fgm: 4 },
  },
};

test('playerValue: valor, no jugó, pendiente', () => {
  assert.deepEqual(playerValue(REC, 'LeBron James', 'pl_pts'), { value: 27 });
  assert.deepEqual(playerValue(REC, 'LeBron James', 'pl_pra'), { value: 44 });
  assert.deepEqual(playerValue(REC, 'Luka Doncic', 'pl_2pm'), { value: 7 }, 'sin tilde en el mercado');
  assert.deepEqual(playerValue(REC, 'Jaren Jackson', 'pl_blk'), { value: 3 }, 'sin "Jr." en el mercado');
  assert.deepEqual(playerValue(REC, 'L. James', 'pl_reb'), { value: 8 });
  assert.deepEqual(playerValue(REC, 'Austin Reaves', 'pl_pts'), { dnp: true });
  assert.deepEqual(playerValue(REC, 'Gabe Vincent', 'pl_pts'), { value: 0 }, '0 minutos sin marcar como baja: jugó');
  assert.equal(playerValue(REC, 'Jarred Vanderbilt', 'pl_oreb'), null, 'sin el dato: pendiente');
  assert.equal(playerValue(REC, 'Anthony Davis', 'pl_pts'), null, 'no está en el box score');
  assert.equal(playerValue({ ...REC, players: undefined }, 'LeBron James', 'pl_pts'), null);
  assert.equal(playerValue({ ...REC, players: {} }, 'LeBron James', 'pl_pts'), null);
  assert.equal(playerValue(null, 'LeBron James', 'pl_pts'), null);
  assert.equal(playerValue(REC, null, 'pl_pts'), null);
  assert.equal(playerValue(REC, 'LeBron James', 'pl_xyz'), null);
});

test('evaluate: Más/Menos de jugador con el box score', () => {
  const e = (m, s, l) => evaluate(m, s, l, REC);
  assert.equal(e('OU.pl_pts#LeBron James', 'over', 24.5), 'won');
  assert.equal(e('OU.pl_pts#LeBron James', 'under', 24.5), 'lost');
  assert.equal(e('OU.pl_pts#LeBron James', 'over', 27.5), 'lost');
  assert.equal(e('OU.pl_pts#LeBron James', 'under', 27.5), 'won');
  assert.equal(e('OU.pl_pra#LeBron James', 'over', 43.5), 'won', '27 + 8 + 9 = 44');
  assert.equal(e('OU.pl_3pm#Luka Doncic', 'over', 4.5), 'won');
  assert.equal(e('OU.pl_2pm#Luka Dončić', 'under', 7.5), 'won', '12 − 5 = 7');
  assert.equal(e('OU.pl_blk#Jaren Jackson', 'over', 2.5), 'won');
  assert.equal(e('OU.pl_pts#LeBron James', 'over', '24.5'), 'won', 'línea en texto');
  // Línea entera: devolución; líneas asiáticas: media apuesta.
  assert.equal(e('OU.pl_pts#LeBron James', 'over', 27), 'void');
  assert.equal(e('OU.pl_pts#LeBron James', 'over', 27.25), 'half_lost');
  assert.equal(e('OU.pl_pts#LeBron James', 'under', 27.25), 'half_won');
  assert.equal(e('OU.pl_pts#LeBron James', 'over', 26.75), 'half_won');
  // No jugó: nula (la casa la anula), en ambos lados.
  assert.equal(e('OU.pl_pts#Austin Reaves', 'over', 10.5), 'void');
  assert.equal(e('OU.pl_pts#Austin Reaves', 'under', 10.5), 'void');
  assert.equal(e('OU.pl_reb#Gabe Vincent', 'under', 2.5), 'won', 'entró unos segundos: la apuesta vale');
  // Sin dato, jugador no encontrado o sin línea: pendiente.
  assert.equal(e('OU.pl_oreb#Jarred Vanderbilt', 'over', 0.5), null);
  assert.equal(e('OU.pl_pts#Anthony Davis', 'over', 20.5), null);
  assert.equal(e('OU.pl_pts#LeBron James', 'over', null), null);
  assert.equal(e('OU.pl_pts', 'over', 20.5), null, 'sin jugador');
  // El total del equipo/partido sigue igual.
  assert.equal(e('OU', 'over', 219.5), 'won');
  assert.equal(e('OU:home', 'under', 112.5), 'won');
  // Combinada con una pata de jugador.
  assert.equal(e('AND', 'OU.pl_pts#LeBron James~over~24.5+ML~home~'), 'won');
  assert.equal(e('AND', 'OU.pl_pts#LeBron James~over~30.5+ML~home~'), 'lost');
  assert.equal(e('AND', 'OU.pl_pts#Austin Reaves~over~10.5+ML~home~'), 'void');
  // Con el objeto del mercado en lugar del id.
  assert.equal(evaluate({ t: 'OU', stat: 'pl_ast', scope: 'ft', team: null, n: 'LeBron James' }, 'over', 8.5, REC), 'won');
});

test('liquidación de los intentos y los tiros de campo', () => {
  assert.deepEqual(playerValue(REC, 'Luka Doncic', 'pl_fga'), { value: 24 });
  assert.deepEqual(playerValue(REC, 'Luka Dončić', 'pl_fgm'), { value: 12 });
  assert.deepEqual(playerValue(REC, 'Luka Dončić', 'pl_3pa'), { value: 11 });
  assert.deepEqual(playerValue(REC, 'Luka Dončić', 'pl_2pa'), { value: 13 }, '24 − 11');
  assert.deepEqual(playerValue(REC, 'L. Dončić', 'pl_fta'), { value: 9 });
  assert.deepEqual(playerValue(REC, 'Gabe Vincent', 'pl_fga'), { value: 0 }, 'jugó y no tiró: 0');
  assert.deepEqual(playerValue(REC, 'Austin Reaves', 'pl_fga'), { dnp: true });
  // Registro sin intentos: queda pendiente (no se liquida como 0); lo demás sí.
  for (const code of ['pl_fga', 'pl_3pa', 'pl_2pa', 'pl_fta']) assert.equal(playerValue(REC, 'Rui Hachimura', code), null, code);
  assert.deepEqual(playerValue(REC, 'Rui Hachimura', 'pl_fgm'), { value: 4 });

  const e = (m, s, l) => evaluate(m, s, l, REC);
  assert.equal(e('OU.pl_fga#Luka Dončić', 'over', 22.5), 'won');
  assert.equal(e('OU.pl_fga#Luka Dončić', 'under', 22.5), 'lost');
  assert.equal(e('OU.pl_fgm#Luka Dončić', 'under', 12.5), 'won');
  assert.equal(e('OU.pl_3pa#Luka Doncic', 'over', 10.5), 'won');
  assert.equal(e('OU.pl_3pa#Luka Doncic', 'over', 11.5), 'lost');
  assert.equal(e('OU.pl_2pa#Luka Dončić', 'over', 12.5), 'won');
  assert.equal(e('OU.pl_fta#Luka Dončić', 'under', 8.5), 'lost');
  assert.equal(e('OU.pl_fta#Luka Dončić', 'over', 9), 'void', 'línea entera igual al valor');
  assert.equal(e('OU.pl_fga#Austin Reaves', 'over', 10.5), 'void');
  assert.equal(e('OU.pl_fga#Rui Hachimura', 'over', 8.5), null, 'sin el dato: pendiente');
  assert.equal(e('OU.pl_fgm#Rui Hachimura', 'over', 3.5), 'won');
});

test('evaluate: estado del partido y registros sin jugadores', () => {
  const m = 'OU.pl_pts#LeBron James';
  assert.equal(evaluate(m, 'over', 24.5, { ...REC, state: 'en_vivo' }), null);
  assert.equal(evaluate(m, 'over', 24.5, { ...REC, state: 'cancelado', voidable: true }), 'void');
  assert.equal(evaluate(m, 'over', 24.5, { ...REC, state: 'aplazado' }), null);
  assert.equal(evaluate(m, 'over', 24.5, { sport: 'basketball', state: 'finalizado', final: [100, 90] }), null, 'registro viejo sin players');
  assert.equal(evaluate(m, 'over', 24.5, null), null);
});
