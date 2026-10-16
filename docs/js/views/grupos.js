// Orden común de Análisis e Historial: por deporte (en el orden de la página)
// y, dentro de cada uno, por liga (país · liga, en orden alfabético); en cada
// liga, los partidos por hora.
import { ACTIVE_SPORTS } from '../sports.js';
import { groupBy } from '../util.js';

export const leagueName = (e) => [e?.country, e?.league].filter(Boolean).join(' · ') || 'Sin liga';

// events: [{ sport, start, home, league, country, ... }] → [{ sport, leagues: [{ name, events }] }]
export function bySportAndLeague(events) {
  const sports = [];
  const others = [...new Set(events.map((e) => e.sport).filter((x) => !ACTIVE_SPORTS.includes(x)))];
  for (const sport of [...ACTIVE_SPORTS, ...others]) {
    const list = events.filter((e) => e.sport === sport);
    if (!list.length) continue;
    const leagues = [...groupBy(list, leagueName).entries()]
      .map(([name, evs]) => ({ name, events: evs.sort((a, b) => (a.start || 0) - (b.start || 0) || String(a.home).localeCompare(String(b.home))) }))
      .sort((a, b) => (a.name === 'Sin liga') - (b.name === 'Sin liga') || a.name.localeCompare(b.name, 'es'));
    sports.push({ sport, leagues });
  }
  return sports;
}
