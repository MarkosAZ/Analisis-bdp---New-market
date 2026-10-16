import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisText, viewSport } from '../docs/js/views/analisis.js';
import { bySportAndLeague, leagueName } from '../docs/js/views/grupos.js';

const events = {
  1: { id: 1, sport: 'football', home: 'Arsenal', away: 'Chelsea', league: 'Premier League', country: 'Inglaterra', start: 3 },
  2: { id: 2, sport: 'basketball', home: 'Lakers', away: 'Celtics', league: 'NBA', country: 'EE. UU.', start: 1 },
  3: { id: 3, sport: 'football', home: 'Alianza', away: 'Universitario', league: 'Liga 1', country: 'Perú', start: 1 },
  4: { id: 4, sport: 'football', home: 'Barcelona', away: 'Real Madrid', league: 'LaLiga', country: 'España', start: 2 },
  5: { id: 5, sport: 'football', home: 'Aston Villa', away: 'Everton', league: 'Premier League', country: 'Inglaterra', start: 1 },
};

test('por deporte (fútbol, básquet, béisbol) y, dentro, por liga en orden alfabético y por hora', () => {
  const g = bySportAndLeague(Object.values(events));
  assert.deepEqual(g.map((x) => x.sport), ['football', 'basketball']);
  assert.deepEqual(g[0].leagues.map((l) => l.name), ['España · LaLiga', 'Inglaterra · Premier League', 'Perú · Liga 1']);
  assert.deepEqual(g[0].leagues[1].events.map((e) => e.id), [5, 1], 'en cada liga, por hora');
  assert.equal(leagueName({}), 'Sin liga');
  assert.equal(bySportAndLeague([{ sport: 'football', start: 1 }, { sport: 'football', league: 'Z', start: 2 }])[0].leagues.at(-1).name, 'Sin liga', 'sin liga al final');
});

test('el deporte elegido en otro lado y que el análisis no tiene: se ven todos', () => {
  const a = { events };
  assert.equal(viewSport({ state: { sportFilter: 'basketball' } }, a), 'basketball');
  assert.equal(viewSport({ state: { sportFilter: 'baseball' } }, a), 'todos');
  assert.equal(viewSport({ state: {} }, a), 'todos');
});

test('copiar: por deporte y liga; con un deporte, solo sus picks y sus combinadas', () => {
  const pick = (eventId, sport, label, level) => ({ eventId, sport, key: `k${eventId}`, label, level, p: 0.7, best: { price: 1.8, source: 'betano' }, start: events[eventId].start });
  const a = {
    method: 'estadistico',
    date: '2026-10-13',
    events,
    picks: [pick(2, 'basketball', 'Más de 220.5 puntos', 'moderada'), pick(1, 'football', 'Más de 2.5 goles', 'alta'), pick(3, 'football', 'Menos de 9.5 córners', 'baja')],
    candidates: [],
    combos: [
      { source: 'betano', odds: 5.1, p: 0.3, legs: [{ eventId: 1, key: 'k1', price: 1.8 }, { eventId: 3, key: 'k3', price: 2.9 }] },
      { source: 'betano', odds: 6.2, p: 0.2, legs: [{ eventId: 2, key: 'k2', price: 1.9 }, { eventId: 1, key: 'k1', price: 3.3 }] },
    ],
  };
  const all = analysisText(a);
  assert.ok(all.indexOf('⚽ Fútbol') < all.indexOf('🏀 Básquet'));
  assert.ok(all.indexOf('— Inglaterra · Premier League') < all.indexOf('— Perú · Liga 1'));
  const basket = analysisText(a, 'todos', 'basketball');
  assert.ok(!basket.includes('Fútbol') && basket.includes('Lakers vs Celtics'));
  assert.equal((basket.match(/cuota \d/g) || []).length, 1, 'solo la combinada con un partido de básquet');
});
