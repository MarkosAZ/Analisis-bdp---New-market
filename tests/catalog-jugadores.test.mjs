// Más/Menos de jugador en básquet (Betano): nombre del mercado → { t: 'OU', stat: 'pl_*', n: jugador }.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  familyOf,
  isPlayerStat,
  labelOf,
  marketId,
  parseMarket,
  parseMarketId,
  PLAYER_STAT_CODES,
  selectionKey,
  STAT_NAME,
  swapSelection,
} from '../docs/js/analysis/catalog.js';

const HOME = 'Los Angeles Lakers';
const AWAY = 'Boston Celtics';
const keysOf = (r) => (r?.outcomes || []).map((o) => `${o.market}|${o.sel}|${o.line ?? ''}`);
const sels = (list) => list.map((s, i) => (typeof s === 'string' ? { name: s, price: Math.round((1.8 + i / 10) * 100) / 100 } : s));
const parse = (name, list = ['Más de 24.5', 'Menos de 24.5'], ctx = {}) => parseMarket(name, sels(list), { sport: 'basketball', home: HOME, away: AWAY, ...ctx });
const hasPlayer = (r) => (r?.outcomes || []).some((o) => isPlayerStat(o.spec.stat));

test('códigos de estadística de jugador y sus textos', () => {
  assert.deepEqual(PLAYER_STAT_CODES, [
    'pl_pts', 'pl_reb', 'pl_ast', 'pl_3pm', 'pl_stl', 'pl_blk', 'pl_tov', 'pl_oreb', 'pl_dreb', 'pl_ftm', 'pl_2pm', 'pl_pra', 'pl_pr', 'pl_pa', 'pl_ra', 'pl_sb',
    'pl_fgm', 'pl_fga', 'pl_3pa', 'pl_2pa', 'pl_fta',
  ]);
  const texts = {
    pl_pts: 'puntos', pl_reb: 'rebotes', pl_ast: 'asistencias', pl_3pm: 'triples anotados', pl_stl: 'robos', pl_blk: 'tapones', pl_tov: 'pérdidas',
    pl_oreb: 'rebotes ofensivos', pl_dreb: 'rebotes defensivos', pl_ftm: 'tiros libres anotados', pl_2pm: 'tiros de 2 anotados',
    pl_pra: 'puntos + rebotes + asistencias', pl_pr: 'puntos + rebotes', pl_pa: 'puntos + asistencias', pl_ra: 'rebotes + asistencias', pl_sb: 'robos + tapones',
    pl_fgm: 'tiros de campo anotados', pl_fga: 'tiros de campo intentados', pl_3pa: 'triples intentados', pl_2pa: 'tiros de 2 intentados',
    pl_fta: 'tiros libres intentados',
  };
  assert.equal(new Set(PLAYER_STAT_CODES).size, 21);
  for (const code of PLAYER_STAT_CODES) assert.equal(STAT_NAME[code], texts[code], code);
  // Las estadísticas de equipo no cambian.
  assert.equal(STAT_NAME.reb, 'rebotes');
  assert.equal(STAT_NAME.threes, 'triples');
  for (const code of PLAYER_STAT_CODES) assert.equal(isPlayerStat(code), true, code);
  for (const x of ['reb', 'score', 'corners', 'pts', '', null, undefined, 42, 'xpl_pts']) assert.equal(isPlayerStat(x), false, String(x));
});

test('nombres reales de Betano: el jugador antes o después de la estadística', () => {
  const cases = [
    ['Total de Puntos LeBron James', 'pl_pts', 'LeBron James'],
    ['LeBron James Total de Puntos, Rebotes y Asistencias', 'pl_pra', 'LeBron James'],
    ['Total de Puntos, Rebotes y Asistencias LeBron James', 'pl_pra', 'LeBron James'],
    ['Total de rebotes Jayson Tatum', 'pl_reb', 'Jayson Tatum'],
    ['Asistencias totales Luka Doncic', 'pl_ast', 'Luka Doncic'],
    ['Total de Tiros de tres puntos anotados Stephen Curry', 'pl_3pm', 'Stephen Curry'],
    ['Total de Rebotes Ofensivos Anthony Davis', 'pl_oreb', 'Anthony Davis'],
    ['Total de Rebotes Defensivos Anthony Davis', 'pl_dreb', 'Anthony Davis'],
    ['Total de tiros de 2 puntos anotados Austin Reaves', 'pl_2pm', 'Austin Reaves'],
    ['Total de tiros libres anotados Austin Reaves', 'pl_ftm', 'Austin Reaves'],
    ['Total de Rebotes y asistencias Jrue Holiday', 'pl_ra', 'Jrue Holiday'],
    ['Jrue Holiday Total de Rebotes y asistencias', 'pl_ra', 'Jrue Holiday'],
    ['Total de Puntos y Rebotes Jaylen Brown', 'pl_pr', 'Jaylen Brown'],
    ['Total de puntos y asistencias Jaylen Brown', 'pl_pa', 'Jaylen Brown'],
    // Otras formas de escribir las mismas estadísticas.
    ['Total de Robos Derrick White', 'pl_stl', 'Derrick White'],
    ['Total de Tapones Derrick White', 'pl_blk', 'Derrick White'],
    ['Total de Pérdidas de balón Derrick White', 'pl_tov', 'Derrick White'],
    ['Total de Robos y Tapones Derrick White', 'pl_sb', 'Derrick White'],
    ['Total de Puntos + Rebotes + Asistencias Derrick White', 'pl_pra', 'Derrick White'],
    ['Triples anotados Derrick White', 'pl_3pm', 'Derrick White'],
  ];
  for (const [name, code, who] of cases) {
    const r = parse(name);
    const id = `OU.${code}#${who}`;
    assert.deepEqual(keysOf(r), [`${id}|over|24.5`, `${id}|under|24.5`], name);
    assert.deepEqual(r.spec, { t: 'OU', stat: code, scope: 'ft', team: null, n: who }, name);
    assert.deepEqual(r.outcomes.map((o) => o.price), [1.8, 1.9], name);
  }
});

test('intentos y tiros de campo: cada uno con su código (los intentos no son los anotados)', () => {
  const cases = [
    // Tiros de campo intentados.
    ['Total de tiros de campo intentados LeBron James', 'pl_fga'],
    ['Tiros de campo intentados LeBron James', 'pl_fga'],
    ['LeBron James Total de tiros de campo intentados', 'pl_fga'],
    ['LeBron James - Tiros de campo intentados', 'pl_fga'],
    ['Total de lanzamientos de campo intentados LeBron James', 'pl_fga'],
    ['Total de intentos de tiros de campo LeBron James', 'pl_fga'],
    ['Intentos de tiros de campo LeBron James', 'pl_fga'],
    ['Total de tiros intentados LeBron James', 'pl_fga'],
    ['Tiros de campo intentados totales LeBron James', 'pl_fga'],
    // Tiros de campo anotados.
    ['Total de tiros de campo anotados LeBron James', 'pl_fgm'],
    ['Tiros de campo anotados LeBron James', 'pl_fgm'],
    ['LeBron James Total de tiros de campo anotados', 'pl_fgm'],
    ['Total de canastas de campo anotadas LeBron James', 'pl_fgm'],
    // Triples intentados: antes "tiros de 3 puntos" se comía el comienzo y quedaba "intentados LeBron James".
    ['Total de tiros de 3 puntos intentados LeBron James', 'pl_3pa'],
    ['Total de Tiros de tres puntos intentados LeBron James', 'pl_3pa'],
    ['Triples intentados LeBron James', 'pl_3pa'],
    ['LeBron James Triples intentados', 'pl_3pa'],
    ['Total de lanzamientos de 3 puntos intentados LeBron James', 'pl_3pa'],
    ['Intentos de triples LeBron James', 'pl_3pa'],
    ['Total de intentos de tiros de 3 puntos LeBron James', 'pl_3pa'],
    ['Total de triples lanzados LeBron James', 'pl_3pa'],
    // Tiros de 2 intentados.
    ['Total de tiros de 2 puntos intentados LeBron James', 'pl_2pa'],
    ['Total de tiros de dos puntos intentados LeBron James', 'pl_2pa'],
    ['LeBron James Total de tiros de 2 puntos intentados', 'pl_2pa'],
    // Tiros libres intentados.
    ['Total de tiros libres intentados LeBron James', 'pl_fta'],
    ['Tiros libres intentados LeBron James', 'pl_fta'],
    ['LeBron James: Total de tiros libres intentados', 'pl_fta'],
    ['Total de lanzamientos libres intentados LeBron James', 'pl_fta'],
    ['Intentos de tiros libres LeBron James', 'pl_fta'],
    // Los anotados siguen igual.
    ['Total de tiros de 3 puntos anotados LeBron James', 'pl_3pm'],
    ['Total de tiros de 3 puntos LeBron James', 'pl_3pm'],
    ['Triples LeBron James', 'pl_3pm'],
    ['Total de tiros de 2 puntos anotados LeBron James', 'pl_2pm'],
    ['Total de tiros libres anotados LeBron James', 'pl_ftm'],
    ['Tiros libres LeBron James', 'pl_ftm'],
  ];
  for (const [name, code] of cases) {
    const r = parse(name, ['Más de 8.5', 'Menos de 8.5']);
    const id = `OU.${code}#LeBron James`;
    assert.deepEqual(keysOf(r), [`${id}|over|8.5`, `${id}|under|8.5`], name);
  }
  // Con el jugador en la selección.
  assert.deepEqual(keysOf(parse('Tiros de campo intentados', ['LeBron James Más de 19.5', 'LeBron James Menos de 19.5'])), [
    'OU.pl_fga#LeBron James|over|19.5',
    'OU.pl_fga#LeBron James|under|19.5',
  ]);
  assert.deepEqual(keysOf(parse('Total de tiros de 3 puntos intentados', ['Stephen Curry - Más de 11.5', 'Stephen Curry - Menos de 11.5'])), [
    'OU.pl_3pa#Stephen Curry|over|11.5',
    'OU.pl_3pa#Stephen Curry|under|11.5',
  ]);
});

test('intentos que no son el Más/Menos de un jugador', () => {
  const unsupported = (name, list = ['Más de 8.5', 'Menos de 8.5']) => parse(name, list)?.unsupported;
  // De un periodo, con marcador de prueba o porcentajes: no se modelan.
  assert.equal(unsupported('1er Periodo - Total de tiros de campo intentados LeBron James'), 'player');
  assert.equal(unsupported('Total de tiros de 3 puntos intentados [Jugador]'), 'player');
  assert.equal(unsupported('Porcentaje de tiros de campo LeBron James'), 'player');
  assert.equal(unsupported('Porcentaje de tiros de 3 puntos LeBron James'), 'player');
  assert.equal(unsupported('Más tiros de 3 puntos intentados', ['LeBron James', 'Jayson Tatum']), 'player');
  assert.equal(unsupported('Triple-double Nikola Jokić', ['Sí', 'No']), 'player');
  // De equipo: sin datos para liquidarlos (antes se leían como el total de puntos o los libres anotados).
  for (const name of [
    'Total de tiros de campo intentados - Local',
    'Total de tiros de 3 puntos intentados - Local',
    'Total de tiros libres intentados - Visitante',
    'Total de tiros de campo - Local',
    'Tiros de campo anotados - Local',
    'Total de tiros de campo intentados',
  ]) assert.equal(unsupported(name, ['Más de 40.5', 'Menos de 40.5']), 'special', name);
  // Un jugador con un dato que no es de tiros de campo ("tiros anotados"): no es el total del partido.
  assert.equal(unsupported('Total de tiros anotados LeBron James'), 'special');
  // Los triples anotados del equipo siguen igual.
  assert.deepEqual(keysOf(parse('Tiros de tres puntos anotados - Local', ['Más de 12.5', 'Menos de 12.5'])), ['OU.threes:home|over|12.5', 'OU.threes:home|under|12.5']);
  // En fútbol no cambia nada ("intentos" no es de básquet).
  const r = parseMarket('Tiros al arco', sels(['Más de 8.5', 'Menos de 8.5']), { sport: 'football', home: 'Arsenal', away: 'Chelsea' });
  assert.deepEqual(keysOf(r), ['OU.shots_on|over|8.5', 'OU.shots_on|under|8.5']);
});

test('el nombre conserva mayúsculas, tildes, apóstrofos, guiones y "Jr."', () => {
  const who = (name, ctx) => parse(name, undefined, ctx)?.spec?.n;
  assert.equal(who('Asistencias totales Luka Dončić'), 'Luka Dončić');
  assert.equal(who('Total de Puntos Nikola Jokić'), 'Nikola Jokić');
  assert.equal(who('Total de Puntos Shai Gilgeous-Alexander'), 'Shai Gilgeous-Alexander');
  assert.equal(who("Total de Puntos De'Aaron Fox"), "De'Aaron Fox");
  assert.equal(who('Total de Puntos Jaren Jackson Jr.'), 'Jaren Jackson Jr.');
  assert.equal(who('Total de Puntos Alperen Şengün'), 'Alperen Şengün');
  assert.equal(who('Total de Puntos L. James'), 'L. James');
  assert.equal(who('Total de Puntos James, LeBron'), 'James, LeBron');
  // Sin equipos en el contexto también funciona.
  assert.equal(parseMarket('Total de Puntos LeBron James', sels(['Más de 24.5', 'Menos de 24.5']), { sport: 'basketball' }).spec.n, 'LeBron James');
});

test('separadores y relleno alrededor del nombre', () => {
  const id = 'OU.pl_pts#LeBron James';
  const expected = [`${id}|over|24.5`, `${id}|under|24.5`];
  for (const name of [
    'Total de Puntos - LeBron James',
    'LeBron James - Total de Puntos',
    'Total de Puntos: LeBron James',
    'LeBron James: Total de Puntos',
    'Total de Puntos | LeBron James',
    'Total de Puntos (LeBron James)',
    'Total de Puntos LeBron James (incl. prórroga)',
    'Total de Puntos LeBron James Más/Menos',
    'Puntos totales del jugador - LeBron James',
    'Total de Puntos LeBron James (Los Angeles Lakers)',
    'Total de Puntos LeBron James (Lakers)',
    'Total de Puntos LeBron James (LAL)',
    'LeBron James (LAL) - Total de Puntos',
    '  Total   de Puntos   LeBron   James  ',
  ]) assert.deepEqual(keysOf(parse(name)), expected, name);
});

test('selecciones: sin "de", con la línea aparte, con coma, en el nombre del mercado o con el jugador', () => {
  const id = 'OU.pl_pts#LeBron James';
  assert.deepEqual(keysOf(parse('Total de Puntos LeBron James', ['Más 27.5', 'Menos 27.5'])), [`${id}|over|27.5`, `${id}|under|27.5`]);
  assert.deepEqual(keysOf(parse('Total de Puntos LeBron James', ['Más de 27,5', 'Menos de 27,5'])), [`${id}|over|27.5`, `${id}|under|27.5`]);
  assert.deepEqual(
    keysOf(parse('Total de Puntos LeBron James', [{ name: 'Más', price: 1.8, line: 26.5 }, { name: 'Menos', price: 1.95, line: '26.5' }])),
    [`${id}|over|26.5`, `${id}|under|26.5`],
  );
  // Línea en el nombre del mercado.
  assert.deepEqual(keysOf(parse('Total de Puntos LeBron James (25.5)', ['Más', 'Menos'])), [`${id}|over|25.5`, `${id}|under|25.5`]);
  // La selección repite el jugador: manda el nombre del mercado.
  assert.deepEqual(keysOf(parse('Total de Puntos LeBron James', ['LeBron James Más de 24.5', 'LeBron James Menos de 24.5'])), [`${id}|over|24.5`, `${id}|under|24.5`]);
  // Varias líneas en un mismo mercado.
  assert.deepEqual(keysOf(parse('Total de Puntos LeBron James', ['Más de 22.5', 'Menos de 22.5', 'Más de 24.5', 'Menos de 24.5'])), [
    `${id}|over|22.5`,
    `${id}|under|22.5`,
    `${id}|over|24.5`,
    `${id}|under|24.5`,
  ]);
  // "25+" es "Más de 24.5".
  assert.deepEqual(keysOf(parse('Total de Puntos LeBron James', ['25+'])), [`${id}|over|24.5`]);
});

test('variante con el jugador en la selección ("Puntos del jugador")', () => {
  const r = parse('Puntos del jugador', ['LeBron James Más de 24.5', 'LeBron James Menos de 24.5', 'Jayson Tatum Más 27.5', 'Jayson Tatum Menos 27.5']);
  assert.deepEqual(keysOf(r), [
    'OU.pl_pts#LeBron James|over|24.5',
    'OU.pl_pts#LeBron James|under|24.5',
    'OU.pl_pts#Jayson Tatum|over|27.5',
    'OU.pl_pts#Jayson Tatum|under|27.5',
  ]);
  assert.equal(r.outcomes[2].spec.n, 'Jayson Tatum');
  assert.deepEqual(keysOf(parse('Rebotes', ['Luka Dončić - Más de 8.5', 'Luka Dončić - Menos de 8.5'])), ['OU.pl_reb#Luka Dončić|over|8.5', 'OU.pl_reb#Luka Dončić|under|8.5']);
  // Selecciones con el nombre de un equipo no son de jugador.
  assert.equal(hasPlayer(parse('Total de Puntos', ['Los Angeles Lakers Más de 110.5', 'Los Angeles Lakers Menos de 110.5'])), false);
  assert.equal(hasPlayer(parse('Total de Puntos', ['Local Más de 110.5', 'Local Menos de 110.5'])), false);
});

test('no son Más/Menos de jugador: siguen como no soportados', () => {
  const unsupported = (name, list) => parse(name, list)?.unsupported;
  assert.equal(unsupported('Double-double LeBron James', ['Sí', 'No']), 'player');
  assert.equal(unsupported('Triple-double Nikola Jokić', ['Sí', 'No']), 'player');
  assert.equal(unsupported('Total de Puntos H2H LeBron James', ['LeBron James', 'Jayson Tatum']), 'player');
  assert.equal(unsupported('Total de rebotes H2H LeBron James', ['Más de 1.5', 'Menos de 1.5']), 'player');
  assert.equal(unsupported('Más puntos en el partido', ['LeBron James', 'Jayson Tatum']), 'player');
  assert.equal(unsupported('Más rebotes en el partido', ['LeBron James', 'Jayson Tatum']), 'player');
  assert.equal(unsupported('Más asistencias en un partido', ['LeBron James', 'Jayson Tatum']), 'player');
  assert.equal(unsupported('Más tiros de 3 puntos anotados', ['LeBron James', 'Jayson Tatum']), 'player');
  assert.equal(unsupported('Mejor anotador de Tiros Libres en un partido', ['LeBron James', 'Jayson Tatum']), 'player');
  assert.equal(unsupported('Mejor anotador de Tiros de Dos Puntos en un partido', ['LeBron James', 'Jayson Tatum']), 'player');
  // Nombres de prueba con el marcador "[Jugador]", sin selecciones o con selecciones inventadas.
  assert.equal(unsupported('Total de Puntos [Jugador]', []), 'player');
  assert.equal(unsupported('Total de Puntos [Jugador]', ['Más de 2.5', 'Menos 2.5']), 'player');
  assert.equal(unsupported('[Jugador] Total de Puntos, Rebotes y Asistencias', []), 'player');
  // De un periodo: no se modela, pero tampoco se confunde con el total del periodo.
  assert.equal(unsupported('1er Periodo - Total de Puntos LeBron James'), 'player');
  assert.equal(unsupported('Total de Puntos LeBron James - Primer Tiempo'), 'player');
  // Con el jugador en el nombre pero sin líneas válidas: no cae al total del partido.
  assert.equal(unsupported('Total de Puntos LeBron James', ['Más', 'Menos']), 'player');
  assert.equal(unsupported('Total de Puntos LeBron James', ['Exactamente 24', 'Sí']), 'player');
});

test('mercados de equipo y del partido no se vuelven de jugador', () => {
  assert.deepEqual(keysOf(parse('Local Total de puntos', ['Más de 110.5', 'Menos de 110.5'])), ['OU:home|over|110.5', 'OU:home|under|110.5']);
  assert.deepEqual(keysOf(parse('Total de Puntos Local', ['Más de 110.5', 'Menos de 110.5'])), ['OU:home|over|110.5', 'OU:home|under|110.5']);
  assert.deepEqual(keysOf(parse('Total de Puntos Visitante', ['Más de 108.5', 'Menos de 108.5'])), ['OU:away|over|108.5', 'OU:away|under|108.5']);
  assert.deepEqual(keysOf(parse(`Total de Puntos ${HOME}`, ['Más de 110.5', 'Menos de 110.5'])), ['OU:home|over|110.5', 'OU:home|under|110.5']);
  assert.deepEqual(keysOf(parse(`${AWAY}: Total de puntos`, ['Más de 108.5', 'Menos de 108.5'])), ['OU:away|over|108.5', 'OU:away|under|108.5']);
  assert.deepEqual(keysOf(parse('Total de Puntos', ['Más de 220.5', 'Menos de 220.5'])), ['OU|over|220.5', 'OU|under|220.5']);
  assert.deepEqual(keysOf(parse('Total de puntos (incl. prórroga)', ['Más de 220.5', 'Menos de 220.5'])), ['OU|over|220.5', 'OU|under|220.5']);
  assert.deepEqual(keysOf(parse('Primer Tiempo - Total de Puntos', ['Más de 110.5', 'Menos de 110.5'])), ['OU@h1|over|110.5', 'OU@h1|under|110.5']);
  assert.deepEqual(keysOf(parse('1er Periodo - Total de Puntos Local', ['Más de 55.5', 'Menos de 55.5'])), ['OU@p1:home|over|55.5', 'OU@p1:home|under|55.5']);
  assert.deepEqual(keysOf(parse('Total de rebotes en el partido', ['Más de 88.5', 'Menos de 88.5'])), ['OU.reb|over|88.5', 'OU.reb|under|88.5']);
  assert.deepEqual(keysOf(parse('Total de rebotes del equipo - Visitante', ['Más de 44.5', 'Menos de 44.5'])), ['OU.reb:away|over|44.5', 'OU.reb:away|under|44.5']);
  assert.deepEqual(keysOf(parse('Tiros de tres puntos anotados - Local', ['Más de 12.5', 'Menos de 12.5'])), ['OU.threes:home|over|12.5', 'OU.threes:home|under|12.5']);
  assert.deepEqual(keysOf(parse('Total de Puntos - Impar/Par', ['Impar', 'Par'])), ['OE|odd|', 'OE|even|']);
  assert.deepEqual(keysOf(parse('Medio tiempo con más puntos anotados', ['Primer Tiempo', 'Empate', 'Segundo Tiempo'])), ['PMAX@halves|h1|', 'PMAX@halves|tie|', 'PMAX@halves|h2|']);
  assert.equal(parse('Carrera a X Puntos (Punto X)', ['Local', 'Visitante']).unsupported, 'special');
  for (const [name, list] of [
    ['Rango total de puntos 3-way (166 - 179)', ['0 - 165', '166 - 179', '180+']],
    ['Ganador del partido y Más/Menos', ['Local y Más de 172.5', 'Visitante y Menos 172.5']],
    ['Total de puntos asiático', ['Más de 220.25', 'Menos de 220.25']],
    ['Equipo con más turnovers (Pérdidas de balón)', ['Local', 'Empate', 'Visitante']],
    ['Total de Lanzamientos libres anotados por el Equipo - Local', ['Más de 18.5', 'Menos de 18.5']],
  ]) assert.equal(hasPlayer(parse(name, list)), false, name);
});

test('un jugador puede compartir una palabra con el nombre de un equipo', () => {
  const ctx = { home: 'Orlando Magic', away: AWAY };
  assert.deepEqual(keysOf(parse('Total de Puntos Orlando Robinson', undefined, ctx)), ['OU.pl_pts#Orlando Robinson|over|24.5', 'OU.pl_pts#Orlando Robinson|under|24.5']);
  // Pero el equipo solo (completo o por su palabra distintiva) es de equipo.
  assert.deepEqual(keysOf(parse('Total de Puntos Orlando Magic', ['Más de 110.5', 'Menos de 110.5'], ctx)), ['OU:home|over|110.5', 'OU:home|under|110.5']);
  assert.deepEqual(keysOf(parse('Total de Puntos Magic', ['Más de 110.5', 'Menos de 110.5'], ctx)), ['OU:home|over|110.5', 'OU:home|under|110.5']);
});

test('solo en básquet y solo con cuotas válidas', () => {
  // En otros deportes no se interpretan como de jugador.
  for (const sport of ['football', 'american-football', 'volleyball']) {
    const r = parseMarket('Asistencias totales Lionel Messi', sels(['Más de 0.5', 'Menos de 0.5']), { sport, home: 'Inter Miami', away: 'LA Galaxy' });
    assert.equal(hasPlayer(r), false, sport);
  }
  // Cuotas de 1 o menos se ignoran.
  const r = parse('Total de Puntos LeBron James', [{ name: 'Más de 24.5', price: 1 }, { name: 'Menos de 24.5', price: 1.9 }]);
  assert.deepEqual(keysOf(r), ['OU.pl_pts#LeBron James|under|24.5']);
  // Sin selecciones con cuota: nada que analizar.
  assert.equal(parse('Total de Puntos LeBron James', []), null);
  assert.equal(parse('Total de Puntos LeBron James', [{ name: 'Más de 24.5', price: 0 }]), null);
});

test('identificador, clave, etiqueta, familia y equipos al revés', () => {
  const spec = { t: 'OU', stat: 'pl_pts', scope: 'ft', team: null, n: 'LeBron James' };
  assert.equal(marketId(spec), 'OU.pl_pts#LeBron James');
  assert.deepEqual(parseMarketId('OU.pl_pts#LeBron James'), spec);
  assert.deepEqual(parseMarketId('OU.pl_pra#Jaren Jackson Jr.'), { ...spec, stat: 'pl_pra', n: 'Jaren Jackson Jr.' });
  assert.deepEqual(parseMarketId("OU.pl_3pm#De'Aaron Fox").n, "De'Aaron Fox");
  assert.equal(selectionKey(spec, 'over', 24.5), 'OU.pl_pts#LeBron James|over|24.5');
  // La clave de cada selección del mercado es la misma que arma selectionKey.
  const r = parse('Total de Puntos LeBron James');
  assert.deepEqual(keysOf(r), [selectionKey(spec, 'over', 24.5), selectionKey(spec, 'under', 24.5)]);

  const names = { home: HOME, away: AWAY };
  assert.equal(labelOf('OU.pl_pts#LeBron James', 'over', 24.5, 'basketball', names), 'LeBron James: Más de 24.5 puntos');
  assert.equal(labelOf('OU.pl_pra#LeBron James', 'under', 24.5, 'basketball', names), 'LeBron James: Menos de 24.5 puntos + rebotes + asistencias');
  assert.equal(labelOf({ ...spec, stat: 'pl_3pm', n: 'Stephen Curry' }, 'over', 3.5, 'basketball'), 'Stephen Curry: Más de 3.5 triples anotados');
  assert.equal(labelOf('OU.pl_2pm#Luka Dončić', 'under', 6.5, 'basketball'), 'Luka Dončić: Menos de 6.5 tiros de 2 anotados');
  assert.equal(labelOf('OU.pl_fga#LeBron James', 'over', 19.5, 'basketball'), 'LeBron James: Más de 19.5 tiros de campo intentados');
  assert.equal(labelOf('OU.pl_3pa#Stephen Curry', 'under', 11.5, 'basketball'), 'Stephen Curry: Menos de 11.5 triples intentados');
  assert.deepEqual(parseMarketId('OU.pl_fta#Jaren Jackson Jr.'), { ...spec, stat: 'pl_fta', n: 'Jaren Jackson Jr.' });
  assert.equal(familyOf(parseMarketId('OU.pl_2pa#LeBron James')), 'pl_2pa');
  // Las etiquetas de equipo no cambian.
  assert.equal(labelOf('OU.reb:home', 'over', 44.5, 'basketball', names), `Más de 44.5 rebotes de ${HOME}`);
  assert.equal(labelOf('OU', 'over', 220.5, 'basketball', names), 'Más de 220.5 puntos');

  assert.equal(familyOf(spec), 'pl_pts');
  // Con los equipos al revés la selección de jugador no cambia.
  const x = swapSelection(spec, 'over', 24.5);
  assert.deepEqual(x, { spec, sel: 'over', line: 24.5 });
});
