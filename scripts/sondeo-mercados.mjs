// Sondeo temporal (12): (a) ligas de los últimos partidos de los equipos de la NBA
// en Flashscore (¿Summer League?), (b) plantel y registro de partidos de un jugador en
// ESPN (para los traspasados y novatos al empezar la temporada).
import { getH2H, getSportDay } from '../extension/sources/flashscore.js';

const NBA = /^NBA/i;
for (const day of [0, 1, 2, 7]) {
  const { items } = await getSportDay({ sport: 'basketball', day });
  const nba = items.filter((e) => NBA.test(e.tournament.name) && e.category.name.match(/ESTADOS UNIDOS|USA/i));
  console.log(`\n==== día ${day}: ${items.length} partidos de básquet, NBA: ${nba.length} | ligas NBA: ${[...new Set(nba.map((e) => e.tournament.name))].join(', ')}`);
  for (const ev of nba.slice(0, day === 0 ? 3 : 1)) {
    try {
      const d = await getH2H({ fsId: ev.id.replace(/^fs:/, ''), homeId: ev.home.id, awayId: ev.away.id });
      for (const [side, list] of [['local', d.lastHome], ['visita', d.lastAway]]) {
        console.log(`  ${ev.home.name} vs ${ev.away.name} [${ev.tournament.name}] · ${side}: ${list.length} partidos`);
        for (const m of list.slice(0, 14)) console.log(`     ${new Date(m.start).toISOString().slice(0, 10)} | ${m.league} | ${m.home ? 'L' : 'V'} vs ${m.opp} | ${m.gf}-${m.ga} (total ${m.gf + m.ga})`);
      }
    } catch (e) {
      console.log(`  H2H ${ev.home.name}: ${e.message}`);
    }
  }
}

const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';
const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, text };
};
const teams = (await get(`${API}/teams`)).data?.sports?.[0]?.leagues?.[0]?.teams?.map((x) => x.team) || [];
const team = teams.find((t) => /Lakers/.test(t.displayName)) || teams[0];
console.log(`\n==== ESPN: ${teams.length} equipos; ${team?.displayName} id ${team?.id}`);
const roster = await get(`${API}/teams/${team.id}/roster`);
const athletes = roster.data?.athletes || [];
console.log(`plantel HTTP ${roster.status} | claves: ${Object.keys(roster.data || {}).join(',')} | atletas: ${athletes.length} | forma: ${Array.isArray(athletes[0]?.items) ? 'agrupado' : 'lista'}`);
const flat = athletes.flatMap((a) => (Array.isArray(a.items) ? a.items : [a]));
console.log(`  ejemplo: ${JSON.stringify(flat.slice(0, 2).map((a) => ({ id: a.id, displayName: a.displayName, shortName: a.shortName, position: a.position?.abbreviation, experience: a.experience?.years, injuries: a.injuries?.length, status: a.status?.type })))}`);
const sched = await get(`${API}/teams/${team.id}/schedule`);
console.log(`calendario por defecto: season ${JSON.stringify(sched.data?.season)} requestedSeason ${JSON.stringify(sched.data?.requestedSeason)} | partidos ${sched.data?.events?.length}`);
const star = flat.find((a) => /LeBron|Luka|Reaves/.test(a.displayName)) || flat[0];
for (const season of ['', '?season=2026', '?season=2027', '?season=2026&seasontype=2']) {
  const g = await get(`${WEB}/athletes/${star.id}/gamelog${season}`);
  const d = g.data || {};
  console.log(`\n---- gamelog ${star.displayName} ${season || '(por defecto)'} | HTTP ${g.status} | claves: ${Object.keys(d).join(',')}`);
  if (!g.data) { console.log(g.text.slice(0, 300)); continue; }
  console.log(`  labels: ${JSON.stringify(d.labels)} | names: ${JSON.stringify(d.names)}`);
  const evIds = Object.keys(d.events || {});
  console.log(`  events (mapa): ${evIds.length} | ejemplo: ${JSON.stringify(d.events?.[evIds[0]] || null).slice(0, 600)}`);
  for (const st of (d.seasonTypes || []).slice(0, 3)) {
    console.log(`  seasonType: ${st.displayName} | categorías: ${(st.categories || []).map((c) => `${c.displayName || c.type}(${c.events?.length ?? 0})`).join(', ')}`);
    const c = (st.categories || []).find((x) => x.events?.length);
    if (c) console.log(`    ejemplo fila: ${JSON.stringify(c.events[0]).slice(0, 400)}`);
  }
  console.log(`  filtros: ${JSON.stringify(d.filters || null).slice(0, 400)}`);
}
