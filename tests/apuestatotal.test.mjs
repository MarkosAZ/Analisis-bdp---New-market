import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarket } from '../docs/js/analysis/catalog.js';
import { getMarkets } from '../extension/sources/apuestatotal.js';

// Respuesta de /api/eventlist/eu/markets/all con los dos mercados de disparos
// (nombres y tipos reales del sondeo de un partido de Apuesta Total).
const shotMarkets = (eventId) => [
  { EventId: eventId, _id: 'm1', Name: 'Disparos a puerta totales', MarketType: { _id: 'OU121', Name: 'Shots On Target O/U' }, Selections: [
    { Name: 'Más de 8.5', BetslipLine: 'Más de 8.5', DisplayOdds: { Decimal: 1.9 } },
    { Name: 'Menos de 8.5', BetslipLine: 'Menos de 8.5', DisplayOdds: { Decimal: 1.85 } },
  ] },
  { EventId: eventId, _id: 'm2', Name: 'Disparos totales', MarketType: { _id: 'OU2083', Name: 'Total Match Shots O/U' }, Selections: [
    { Name: 'Más de 29.5', BetslipLine: 'Más de 29.5', DisplayOdds: { Decimal: 1.95 } },
    { Name: 'Menos de 29.5', BetslipLine: 'Menos de 29.5', DisplayOdds: { Decimal: 1.8 } },
  ] },
];

test('Apuesta Total: pide los disparos de fútbol (OU121 y OU2083) y se leen como tiros al arco y remates', async (t) => {
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (!u.includes('/api/eventlist/')) return new Response('', { status: 200 });
    const query = decodeURIComponent(new URL(u).searchParams.get('markets'));
    const types = query.split(':')[1].split('|');
    asked.push(...types);
    return Response.json(types.includes('OU121') ? shotMarkets(77) : []);
  });
  const { items, errors } = await getMarkets({ eventIds: ['77'], sport: 'football' });
  assert.deepEqual(errors, []);
  assert.ok(asked.includes('OU121'), 'pide "Disparos a puerta totales"');
  assert.ok(asked.includes('OU2083'), 'pide "Disparos totales"');
  const read = items['77'].map((m) => {
    const r = parseMarket(m.name, m.selections, { sport: 'football', home: 'Local', away: 'Visita' });
    return r.outcomes.map((o) => `${o.market} ${o.sel} ${o.line} ${o.price}`);
  });
  assert.deepEqual(read, [
    ['OU.shots_on over 8.5 1.9', 'OU.shots_on under 8.5 1.85'],
    ['OU.shots over 29.5 1.95', 'OU.shots under 29.5 1.8'],
  ]);
});

// Selección de jugador como la manda Apuesta Total: QAParam1 es la línea × 100 (negativa en Menos de).
const playerSel = (who, side, line, price) => ({
  Name: `${who} ${side} ${line}`, BetslipLine: `${who} ${side} ${line}`, QAParam1: (side === 'Más de' ? 100 : -100) * line, QAParam2: 1, DisplayOdds: { Decimal: price },
});
const basketMarkets = (eventId) => [
  // La línea principal del primer tiempo a veces es entera (88, +1); las extra traen las .5.
  { EventId: eventId, _id: 'b1', Name: '1ra Mitad Puntos Asiáticos', MarketType: { _id: 'OU623' }, Selections: [
    { Name: 'Más de', BetslipLine: 'Más de 88', QAParam1: 0, DisplayOdds: { Decimal: 1.81 } },
    { Name: 'Menos de', BetslipLine: 'Menos de 88', QAParam1: 0, DisplayOdds: { Decimal: 1.86 } },
  ] },
  { EventId: eventId, _id: 'b2', Name: '1ra Mitad Total de Puntos (extra)', MarketType: { _id: 'OU2125' }, Selections: [
    { Name: 'Más de', BetslipLine: 'Más de 87.5', QAParam1: 0, DisplayOdds: { Decimal: 1.78 } },
    { Name: 'Menos de', BetslipLine: 'Menos de 87.5', QAParam1: 0, DisplayOdds: { Decimal: 1.9 } },
  ] },
  { EventId: eventId, _id: 'b3', Name: '1ra Mitad - Hándicap (extra)', MarketType: { _id: 'HC2125' }, Selections: [
    { Name: 'Detroit Pistons', BetslipLine: 'Detroit Pistons -2.5', QAParam1: 0, DisplayOdds: { Decimal: 1.85 } },
    { Name: 'Boston Celtics', BetslipLine: 'Boston Celtics +2.5', QAParam1: 0, DisplayOdds: { Decimal: 1.85 } },
  ] },
  { EventId: eventId, _id: 'b4', Name: 'Puntos del jugador (incl. prórroga)', MarketType: { _id: 'QA4400' }, Selections: [
    playerSel('Cade Cunningham', 'Más de', 24.5, 1.85), playerSel('Cade Cunningham', 'Menos de', 24.5, 1.8),
  ] },
  { EventId: eventId, _id: 'b5', Name: 'Tiros de 3 puntos anotados por jugador (incl. Prórroga)', MarketType: { _id: 'QA4872' }, Selections: [
    playerSel('Jayson Tatum', 'Más de', 2.5, 1.67), playerSel('Jayson Tatum', 'Menos de', 2.5, 1.99),
  ] },
  { EventId: eventId, _id: 'b6', Name: 'Jugador: Total de puntos, asistencias y rebotes', MarketType: { _id: 'QA4407' }, Selections: [
    playerSel('Jayson Tatum', 'Más de', 42.5, 1.87), playerSel('Jayson Tatum', 'Menos de', 42.5, 1.77),
  ] },
];

test('Apuesta Total: básquet pide primer tiempo extra y jugadores, y se leen con el nombre de cada jugador', async (t) => {
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (!u.includes('/api/eventlist/')) return new Response('', { status: 200 });
    const types = decodeURIComponent(new URL(u).searchParams.get('markets')).split(':')[1].split('|');
    asked.push(...types);
    return Response.json(types.includes('QA4400') ? basketMarkets(88) : []);
  });
  const { items } = await getMarkets({ eventIds: ['88'], sport: 'basketball' });
  for (const type of ['OU2125', 'HC2125', 'QA4400', 'QA4402', 'QA4403', 'QA4872', 'QA4407']) assert.ok(asked.includes(type), `pide ${type}`);
  const read = items['88'].map((m) => {
    const r = parseMarket(m.name, m.selections, { sport: 'basketball', home: 'Detroit Pistons', away: 'Boston Celtics' });
    return r.outcomes.map((o) => `${o.market} ${o.sel} ${o.line}`).join(', ');
  });
  assert.deepEqual(read, [
    'OU@h1 over 88, OU@h1 under 88',
    'OU@h1 over 87.5, OU@h1 under 87.5',
    'HCP@h1 home -2.5, HCP@h1 away -2.5',
    'OU.pl_pts#Cade Cunningham over 24.5, OU.pl_pts#Cade Cunningham under 24.5',
    // Antes: "OU.pl_3pm#por" (el "por" de "por jugador" se tomaba como el nombre).
    'OU.pl_3pm#Jayson Tatum over 2.5, OU.pl_3pm#Jayson Tatum under 2.5',
    'OU.pl_pra#Jayson Tatum over 42.5, OU.pl_pra#Jayson Tatum under 42.5',
  ]);
});
