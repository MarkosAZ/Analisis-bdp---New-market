import assert from 'node:assert/strict';
import test from 'node:test';
import { labelOf, marketId, parseMarket, parseMarketId, swapSelection } from '../docs/js/analysis/catalog.js';
import { evaluate } from '../docs/js/analysis/outcomes.js';
import { AWAY, fixtureMarkets, HOME } from './catalog-fixture.mjs';

const keysOf = (r) => (r?.outcomes || []).map((o) => `${o.market}|${o.sel}|${o.line ?? ''}`);
const parse = (name, sels, sport = 'football', home = HOME, away = AWAY) =>
  parseMarket(
    name,
    sels.map((s, i) => (typeof s === 'string' ? { name: s, price: 1.5 + i / 10 } : s)),
    { sport, home, away },
  );

test('reconoce los mercados de Betano de todos los deportes (lista del Excel)', () => {
  const markets = fixtureMarkets();
  assert.equal(markets.length, 865);
  const counts = {};
  const unknown = [];
  for (const m of markets) {
    const r = parseMarket(m.name, m.selections, { sport: m.sport, home: HOME, away: AWAY });
    const kind = !r ? 'ignorado' : r.unsupported || 'ok';
    counts[kind] = (counts[kind] || 0) + 1;
    if (kind === 'unknown') unknown.push(m.rawName);
  }
  assert.ok(counts.ok >= 620, JSON.stringify(counts));
  // Sin reconocer solo queda uno cuyas selecciones no aparecen en el Excel.
  assert.deepEqual(unknown, ['Córners del Primer Tiempo - Triples']);
  // Los que no se modelan son mercados de jugador, de torneo o sucesos sin datos.
  assert.ok(counts.player >= 140 && counts.outright >= 25 && counts.special <= 70, JSON.stringify(counts));
});

test('mercados principales con las claves de siempre', () => {
  assert.deepEqual(keysOf(parse('Resultado del partido', ['1', 'X', '2'])), ['1X2|home|', '1X2|draw|', '1X2|away|']);
  assert.deepEqual(keysOf(parse('Goles totales Más/Menos', ['Más de 2.5', 'Menos 2.5'])), ['OU|over|2.5', 'OU|under|2.5']);
  assert.deepEqual(keysOf(parse('Doble oportunidad', ['1X', '12', '2X'])), ['DC|1X|', 'DC|12|', 'DC|X2|']);
  assert.deepEqual(keysOf(parse('Ambos equipos anotan', ['Sí', 'No'])), ['BTTS|yes|', 'BTTS|no|']);
  assert.equal(parse('Resultado del partido SuperCuotas', ['1']), null);
});

test('estadísticas, periodos y equipos', () => {
  assert.deepEqual(keysOf(parse('Más/Menos Córners', ['Más de 8.5', 'Menos 8.5'])), ['OU.corners|over|8.5', 'OU.corners|under|8.5']);
  assert.deepEqual(keysOf(parse(`${HOME} - Goles totales Más/Menos`, ['Más de 1.5', 'Menos 1.5'])), ['OU:home|over|1.5', 'OU:home|under|1.5']);
  assert.deepEqual(keysOf(parse(`Primer Tiempo ${AWAY} Más/Menos Córners`, ['Más de 2.5', 'Menos 2.5'])), ['OU.corners@h1:away|over|2.5', 'OU.corners@h1:away|under|2.5']);
  // Los totales de otras estadísticas ya no se confunden con goles.
  assert.deepEqual(keysOf(parse('Total de Faltas Cometidas', ['Más de 22.5', 'Menos 22.5'])), ['OU.fouls|over|22.5', 'OU.fouls|under|22.5']);
  assert.deepEqual(keysOf(parse('Total de rebotes en el partido', ['Más de 88.5', 'Menos 88.5'], 'basketball')), ['OU.reb|over|88.5', 'OU.reb|under|88.5']);
  assert.deepEqual(keysOf(parse('Total de Minutos de penalización', ['Más de 16.5', 'Menos 16.5'], 'ice-hockey')), ['OU.pim|over|16.5', 'OU.pim|under|16.5']);
  // Hockey: el resultado con empate es el del tiempo reglamentario.
  assert.deepEqual(keysOf(parse('Ganador', [HOME, 'Empate', AWAY], 'ice-hockey')), ['1X2@reg|home|', '1X2@reg|draw|', '1X2@reg|away|']);
  assert.deepEqual(keysOf(parse('5 entradas completas - Total de Runs', ['Más de 4.5', 'Menos 4.5'], 'baseball')), ['OU@i1-5|over|4.5', 'OU@i1-5|under|4.5']);
});

test('nombres de Apuesta Total', () => {
  assert.deepEqual(keysOf(parse('1ra mitad: 1x2', [HOME, 'Empate', AWAY])), ['1X2@h1|home|', '1X2@h1|draw|', '1X2@h1|away|']);
  assert.deepEqual(keysOf(parse(`${AWAY}: Total de goles`, ['Más de 1.5', 'Menos de 1.5'])), ['OU:away|over|1.5', 'OU:away|under|1.5']);
  assert.deepEqual(keysOf(parse(`${HOME}: Mantendrá portería a cero`, ['Sí', 'No'])), ['OU:away|under|0.5', 'OU:away|over|0.5']);
  assert.deepEqual(keysOf(parse('Goles exactos', ['No hay goles', '1 Gol', '2 Goles'])), ['CNT|0|', 'CNT|1|', 'CNT|2|']);
  assert.deepEqual(keysOf(parse('Total tiros de esquina (asiático)', ['Más de 9.25', 'Menos de 9.25'])), ['OU.corners|over|9.25', 'OU.corners|under|9.25']);
  assert.deepEqual(keysOf(parse('Mitad/Final', [`${HOME}/${HOME}`, `${HOME}/${AWAY}`])), ['AND|1X2@h1~home~+1X2~home~|', 'AND|1X2@h1~home~+1X2~away~|']);
  assert.deepEqual(keysOf(parse('1er set: Marcador exacto', [`${HOME} 6:1`, `${AWAY} 6:1`], 'tennis')), ['CS@s1|6-1|', 'CS@s1|1-6|']);
  assert.deepEqual(keysOf(parse('Ganador 1er Inning', [HOME, 'Empate', AWAY], 'baseball')), ['1X2@i1|home|', '1X2@i1|draw|', '1X2@i1|away|']);
  assert.deepEqual(keysOf(parse('Margen de victoria (incl. prórroga)', [`${HOME} gana por 1 a 2`, `${AWAY} gana por 3 a 6`], 'basketball')), ['MRG|home:1-2|', 'MRG|away:3-6|']);
});

test('equipos al revés: se da vuelta cada selección', () => {
  const sw = (m, s, l) => {
    const x = swapSelection(parseMarketId(m), s, l);
    return `${marketId(x.spec)}|${x.sel}|${x.line ?? ''}`;
  };
  assert.equal(sw('HCP', 'home', -1.5), 'HCP|away|1.5');
  assert.equal(sw('OU.corners:home', 'over', 4.5), 'OU.corners:away|over|4.5');
  assert.equal(sw('CS', 'home!1-0,2-1', null), 'CS|away!0-1,1-2|');
  assert.equal(sw('AND', '1X2@h1~home~+DC~1X~', null), 'AND|1X2@h1~away~+DC~X2~|');
  assert.equal(sw('MRG', 'home:3+', null), 'MRG|away:3+|');
});

// Partido de prueba: 2-1 (1-0 al descanso), córners 6-3, goles a los 20', 55' y 80'.
const REC = {
  sport: 'football',
  state: 'finalizado',
  per: [
    [1, 0],
    [1, 1],
  ],
  nReg: 2,
  final: [2, 1],
  events: [
    { k: 'goal', team: 'home', min: 20 },
    { k: 'card', team: 'away', min: 30 },
    { k: 'goal', team: 'away', min: 55 },
    { k: 'goal', team: 'home', min: 80 },
  ],
  stats: { corners: { ft: [6, 3], h1: [4, 1], h2: [2, 2] }, cards: { ft: [0, 1] } },
};

test('liquida con el registro del partido', () => {
  const ev = (m, s, l = null) => evaluate(m, s, l, REC);
  assert.equal(ev('1X2', 'home'), 'won');
  assert.equal(ev('OU', 'over', 2.5), 'won');
  assert.equal(ev('OU', 'under', 3.5), 'won');
  assert.equal(ev('OU', 'over', 3), 'void');
  assert.equal(ev('OU', 'over', 2.75), 'half_won');
  assert.equal(ev('HCP', 'home', -1), 'void');
  assert.equal(ev('HCP', 'home', -1.25), 'half_lost');
  assert.equal(ev('OU.corners', 'over', 8.5), 'won');
  assert.equal(ev('OU.corners@h1:home', 'over', 3.5), 'won');
  assert.equal(ev('1X2.corners', 'home'), 'won');
  assert.equal(ev('PMAX@halves', 'h2'), 'won');
  assert.equal(ev('AND', '1X2@h1~home~+1X2~home~'), 'won');
  assert.equal(ev('AND', '1X2@h1~home~+1X2~home~+OU~under~1.5'), 'lost');
  assert.equal(ev('OR', '!BTTS~yes~+OU~over~2.5'), 'lost');
  assert.equal(ev('CS', '2-1'), 'won');
  assert.equal(ev('CS', 'home!1-0,2-0'), 'won');
  assert.equal(ev('MRG', 'home:1'), 'won');
  assert.equal(ev('FIRST', 'home'), 'won');
  assert.equal(ev('LAST', 'home'), 'won');
  assert.equal(ev('FGT', '20-30'), 'won');
  assert.equal(ev('OU@m0-32', 'over', 0.5), 'won');
  assert.equal(ev('COMEBACK:away', 'yes'), 'lost');
  assert.equal(ev('SCOREALL@halves:home', 'yes'), 'won');
  assert.equal(ev('WINALL@halves:home', 'yes'), 'lost');
  assert.equal(ev('OU.shots', 'over', 10.5), null, 'sin datos de tiros no se liquida');
  assert.equal(evaluate('1X2', 'home', null, { ...REC, state: 'cancelado', voidable: true }), 'void');
});

test('etiquetas en español para cualquier mercado', () => {
  const names = { home: 'Universitario', away: 'Alianza' };
  assert.equal(labelOf('OU.corners@h1:home', 'over', 4.5, 'football', names), 'Más de 4.5 córners de Universitario (1.er tiempo)');
  assert.equal(labelOf('HCP', 'away', 1.5, 'football', names), 'Alianza -1.5 (hándicap)');
  assert.equal(labelOf('OU@i1-5', 'under', 4.5, 'baseball', names), 'Menos de 4.5 carreras (primeras 5 entradas)');
});

test('ganador con entradas extra, entradas extra Sí/No y puntos de tarjetas', () => {
  assert.deepEqual(keysOf(parse('Ganador (incl. entradas extra)', [HOME, AWAY], 'baseball')), ['ML|home|', 'ML|away|']);
  assert.deepEqual(keysOf(parse('Entradas Extra', ['Sí', 'No'], 'baseball')), ['OT|yes|', 'OT|no|']);
  // Puntos de tarjetas (amarilla 10, roja 25) no es la cantidad de tarjetas.
  assert.equal(parse('Puntos de Tarjetas', ['Más de 45.5', 'Menos de 45.5']).unsupported, 'special');
  assert.deepEqual(keysOf(parse('Tarjetas Totales Más/Menos', ['Más de 4.5', 'Menos de 4.5'])), ['OU.cards|over|4.5', 'OU.cards|under|4.5']);
});

test('hándicap de córners de Betano: el de dos opciones sí, el de tres (con empate) aparte', () => {
  const ctx = { sport: 'football', home: 'Barcelona', away: 'Real Madrid' };
  const parse = (name, sels) => parseMarket(name, sels.map((n) => ({ name: n, price: 1.9 })), ctx);
  const dobles = parse('Hándicap de Córners - Dobles', ['Barcelona -1.5', 'Real Madrid +1.5']);
  assert.deepEqual(dobles.outcomes.map((o) => [o.market, o.sel, o.line]), [['HCP.corners', 'home', -1.5], ['HCP.corners', 'away', -1.5]]);
  assert.equal(parse('Hándicap de Córners - Triples', ['Barcelona -2', 'Empate -2', 'Real Madrid +2']).outcomes[0].market, 'HCP3.corners');
  assert.equal(parse('Primer Tiempo Hándicap de Córners', ['Barcelona -0.5', 'Real Madrid +0.5']).outcomes[0].market, 'HCP.corners@h1');
  // Liquidación con los córners del partido (7 a 4).
  const rec = { sport: 'football', state: 'finalizado', final: [1, 0], stats: { corners: { ft: [7, 4] } } };
  assert.equal(evaluate('HCP.corners', 'home', -1.5, rec), 'won');
  assert.equal(evaluate('HCP.corners', 'home', -3.5, rec), 'lost');
  assert.equal(evaluate('HCP.corners', 'away', -3.5, rec), 'won');
  assert.equal(evaluate('HCP.corners', 'home', -1.5, { ...rec, stats: {} }), null, 'sin córners: pendiente');
});

test('"1ª parte", "primera parte" y "segunda parte" son mitades, no el partido completo', () => {
  const ctx = { sport: 'football', home: 'Barcelona', away: 'Real Madrid' };
  const ou = [{ name: 'Más de 1.5', price: 1.9 }, { name: 'Menos de 1.5', price: 1.9 }];
  const id = (name) => marketId(parseMarket(name, ou, ctx).spec);
  assert.equal(id('Total de goles - 1ª parte'), 'OU@h1');
  assert.equal(id('Total de goles - Primera parte'), 'OU@h1');
  assert.equal(id('Total de córners - 1a parte'), 'OU.corners@h1');
  assert.equal(id('Total de goles - 2ª parte'), 'OU@h2');
  assert.equal(id('Total de goles - Segunda parte'), 'OU@h2');
  assert.equal(id('Total de goles'), 'OU');
});

test('Apuesta Total: "disparos" son tiros al arco o remates, nunca goles', () => {
  const ctx = { sport: 'football', home: 'Arsenal', away: 'Chelsea' };
  const ou = [{ name: 'Más de 8.5', price: 1.9 }, { name: 'Menos de 8.5', price: 1.9 }];
  const id = (name) => {
    const r = parseMarket(name, ou, ctx);
    return r.unsupported ? `no:${r.unsupported}` : marketId(r.spec);
  };
  assert.equal(id('Disparos a puerta totales'), 'OU.shots_on');
  assert.equal(id('Disparos a puerta'), 'OU.shots_on');
  assert.equal(id('Total de disparos a puerta'), 'OU.shots_on');
  assert.equal(id('Disparos totales'), 'OU.shots');
  assert.equal(id('Total de disparos'), 'OU.shots');
  assert.equal(id('Arsenal Disparos a puerta'), 'OU.shots_on:home');
  // Una estadística que no se conoce no se lee como goles.
  assert.equal(id('Goles esperados'), 'no:special');
  assert.equal(id('Posesión'), 'no:special');
  // Los goles siguen igual.
  assert.equal(id('Total de goles'), 'OU');
  assert.equal(id('Total de goles asiático'), 'OU');
  assert.equal(id('1ra mitad: Total de goles'), 'OU@h1');
});

test('Apuesta Total: "en ambas mitades" y otros mercados que no son los de la lista', () => {
  const ctx = { sport: 'football', home: 'Viking', away: 'Bayern München' };
  const yn = [{ name: 'Sí', price: 1.49 }, { name: 'No', price: 2.36 }];
  const read = (name, sels = yn) => {
    const r = parseMarket(name, sels, ctx);
    return r.unsupported ? `no:${r.unsupported}` : r.outcomes.map((o) => o.market)[0];
  };
  // Nombres reales del sondeo de Apuesta Total: antes se leían como "Más/Menos 0.5 tarjetas",
  // "Más/Menos 0.5 goles", "Ambos equipos anotan" o goles del equipo.
  assert.equal(read('Tarjetas mostradas en ambas mitades'), 'no:special');
  assert.equal(read('Ambas mitades menos de 1.5'), 'no:special');
  assert.equal(read('Ambas mitades más de 0.5'), 'no:special');
  assert.equal(read('Ambos equipos anotan en ambas mitades'), 'no:special');
  assert.equal(read('Viking: Anotará en ambas mitades'), 'no:special');
  assert.equal(read('Viking: Total de entradas del equipo', [{ name: 'Más de 17.5', price: 2.05 }, { name: 'Menos de 17.5', price: 1.77 }]), 'no:special');
  assert.equal(read('1ra Mitad: Disparos a puerta', [{ name: 'Más de 5.5', price: 2.17 }, { name: 'Menos de 5.5', price: 1.69 }]), 'OU.shots_on@h1');
  // Los de "ambos tiempos" que sí se entienden siguen igual.
  assert.equal(read('Gol anotado en ambos tiempos'), 'SCOREALL@halves');
  assert.equal(read('Ambos equipos anotan'), 'BTTS');
});

test('Apuesta Total: jugadores de básquet (nombres reales del sondeo de la NBA)', () => {
  const ctx = { sport: 'basketball', home: 'Detroit Pistons', away: 'Boston Celtics' };
  const sels = (who, line) => [{ name: `${who} Más de ${line}`, price: 1.84, line: line * 100 }, { name: `${who} Menos de ${line}`, price: 1.79, line: -line * 100 }];
  const read = (name, s = sels('Cade Cunningham', 14.5)) => {
    const r = parseMarket(name, s, ctx);
    return r.unsupported ? `no:${r.unsupported}` : [...new Set(r.outcomes.map((o) => `${o.market} ${o.line}`))].join(', ');
  };
  // Combinadas en otro orden que "puntos, rebotes y asistencias".
  assert.equal(read('Jugador: Total de puntos, asistencias y rebotes'), 'OU.pl_pra#Cade Cunningham 14.5');
  assert.equal(read('Asistencias y rebotes del jugador (incl. Prórroga)'), 'OU.pl_ra#Cade Cunningham 14.5');
  assert.equal(read('Puntos y asistencias del jugador (incl. Prórroga)'), 'OU.pl_pa#Cade Cunningham 14.5');
  assert.equal(read('Puntos y rebotes del jugador (incl. Prórroga)'), 'OU.pl_pr#Cade Cunningham 14.5');
  // "por jugador" y "Sobrepasa los" no son el nombre del jugador.
  assert.equal(read('Tiros de 3 puntos anotados por jugador (incl. Prórroga)', sels('Jayson Tatum', 2.5)), 'OU.pl_3pm#Jayson Tatum 2.5');
  assert.equal(read('Jugador Sobrepasa los Puntos (incl. prórroga)', [{ name: 'Daniel Oturu Más de 9.5', price: 1.46, line: 950 }]), 'OU.pl_pts#Daniel Oturu 9.5');
  // La línea sale del nombre de la selección, no de QAParam1 (línea × 100).
  assert.equal(read('Rebotes del jugador (incl. Prórroga)', sels('Jayson Tatum', 8.5)), 'OU.pl_reb#Jayson Tatum 8.5');
});

test('básquet: nombres del 1.er tiempo ("1era", "1ª", "1.ª", "1°", "1T") nunca como el partido completo', () => {
  const ctx = { sport: 'basketball', home: 'Los Angeles Lakers', away: 'Boston Celtics' };
  const ou = [{ name: 'Más de 112.5', price: 1.9 }, { name: 'Menos de 112.5', price: 1.9 }];
  const hc = [{ name: 'Los Angeles Lakers -2.5', price: 1.9 }, { name: 'Boston Celtics +2.5', price: 1.9 }];
  const first = (name, sels = ou) => parseMarket(name, sels, ctx).outcomes[0].market;
  for (const n of ['1era Mitad - Total de Puntos', '1ª Mitad - Total de puntos', '1.ª mitad: total de puntos', '1° Mitad Total de Puntos', '1T Total de puntos', 'Total de Puntos 1era Mitad', 'Primera Mitad - Total de Puntos', '1er Tiempo - Total de Puntos'])
    assert.equal(first(n), 'OU@h1', n);
  for (const n of ['1era Mitad - Hándicap', 'Hándicap 1era mitad', 'Hándicap - 1° Mitad']) assert.equal(first(n, hc), 'HCP@h1', n);
  assert.equal(first('2ª mitad - total de puntos'), 'OU@h2');
  assert.equal(first('Total de puntos (incl. prórroga)'), 'OU');
});

test('fútbol: más formas del 1.er y 2.º tiempo, y "disparos" que no son el total', () => {
  const ctx = { sport: 'football', home: 'Arsenal', away: 'Lille' };
  const ou = [{ name: 'Más de 4.5', price: 1.9 }, { name: 'Menos de 4.5', price: 1.9 }];
  const read = (n) => {
    const r = parseMarket(n, ou, ctx);
    return r.unsupported ? `no:${r.unsupported}` : r.outcomes[0].market;
  };
  for (const n of ['1° Tiempo - Total de goles', '1.er tiempo: total de goles', '1er. tiempo total de goles', '1ra. Mitad Total de goles']) assert.equal(read(n), 'OU@h1', n);
  assert.equal(read('2° tiempo - total de goles'), 'OU@h2');
  for (const n of ['Disparos fuera', 'Disparos bloqueados', 'Disparos a portería']) assert.equal(read(n), 'no:special', n);
  assert.equal(read('Disparos al palo'), 'OU.woodwork');
  assert.equal(read('Disparos'), 'OU.shots');
});
