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
