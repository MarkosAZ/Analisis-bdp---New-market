// Sondeo temporal (18): béisbol.
// (1) Prueba retrospectiva con la MLB 2026 (agosto y septiembre): modelo anterior
//     (Poisson con la forma) frente al nuevo (binomial negativa, abridores, estadio,
//     clima y enfrentamientos), solo con datos anteriores a cada partido.
// (2) Contexto real de los próximos partidos de la MLB (getGameContext).
import { goalsModel } from '../docs/js/analysis/models.js';
import { baseballModel } from '../docs/js/analysis/baseball.js';
import { sportOf } from '../docs/js/sports.js';
import { getGameContext, parkRuns, startsFromGameLog } from '../extension/sources/mlb.js';

const API = 'https://statsapi.mlb.com/api/v1';
const get = async (url) => (await fetch(url, { signal: AbortSignal.timeout(60000) })).json();
const cfg = sportOf('baseball');
const ms = (d) => Date.parse(d);

const all = (await get(`${API}/schedule?sportId=1&startDate=2026-03-20&endDate=2026-09-30&gameType=R&hydrate=probablePitcher,team,weather,venue`)).dates.flatMap((d) => d.games);
const done = all.filter((g) => g.status?.abstractGameState === 'Final' && g.teams.home.score != null);
console.log(`MLB 2026: ${done.length} partidos terminados`);
const prev = (await get(`${API}/schedule?sportId=1&season=2025&gameType=R`)).dates.flatMap((d) => d.games);
const parks = {};
for (const t of new Set(done.map((g) => g.teams.home.team.id))) {
  const r = parkRuns(prev, t);
  if (r.nHome >= 20 && r.nAway >= 20) parks[t] = { factor: r.home / r.away, n: r.nHome + r.nAway };
}
// Partidos de cada equipo (para su forma y los enfrentamientos).
const byTeam = new Map();
for (const g of done) for (const side of ['home', 'away']) {
  const id = g.teams[side].team.id;
  const other = side === 'home' ? 'away' : 'home';
  const gf = g.teams[side].score;
  const ga = g.teams[other].score;
  (byTeam.get(id) || byTeam.set(id, []).get(id)).push({ start: ms(g.gameDate), home: side === 'home', gf, ga, r: gf > ga ? 'W' : 'L', opp: g.teams[other].team.id });
}
for (const list of byTeam.values()) list.sort((a, b) => b.start - a.start);
const logs = new Map();
async function starts(id) {
  if (!logs.has(id)) {
    const [a, b] = await Promise.all([2026, 2025].map((y) => get(`${API}/people/${id}/stats?stats=gameLog&group=pitching&season=${y}&gameType=R`).then(startsFromGameLog).catch(() => [])));
    logs.set(id, [...a, ...b].sort((x, y) => y.start - x.start));
  }
  return logs.get(id);
}
const targets = done.filter((g) => ms(g.gameDate) >= ms('2026-08-01') && ms(g.gameDate) < ms('2026-09-29'));
const pitcherIds = [...new Set(targets.flatMap((g) => [g.teams.home.probablePitcher?.id, g.teams.away.probablePitcher?.id]).filter(Boolean))];
for (let i = 0; i < pitcherIds.length; i += 8) await Promise.all(pitcherIds.slice(i, i + 8).map(starts));
console.log(`partidos a evaluar: ${targets.length} · abridores: ${pitcherIds.length}`);

const ll = (p, y) => -Math.log(Math.min(0.999, Math.max(0.001, y ? p : 1 - p)));
const acc = {};
const add = (name, key, p, y) => {
  const a = (acc[name] ||= {});
  const b = (a[key] ||= { n: 0, ll: 0, brier: 0 });
  b.n++;
  b.ll += ll(p, y);
  b.brier += (p - (y ? 1 : 0)) ** 2;
};
let used = 0;
const totals = [];
for (const g of targets) {
  const t0 = ms(g.gameDate);
  const H = g.teams.home.team.id;
  const A = g.teams.away.team.id;
  const before = (id) => (byTeam.get(id) || []).filter((m) => m.start < t0 - 3600000);
  const lastHome = before(H).slice(0, 10);
  const lastAway = before(A).slice(0, 10);
  if (lastHome.length < 8 || lastAway.length < 8) continue;
  const h2hGames = before(H).filter((m) => m.opp === A).slice(0, 10);
  const ev = { sport: 'baseball', start: t0, tournament: { name: 'MLB' } };
  const side = async (key) => {
    const p = g.teams[key].probablePitcher;
    return { team: g.teams[key].team.name, pitcher: p ? { id: p.id, name: p.fullName, starts: (await starts(p.id)).filter((s) => s.start < t0 - 3600000).slice(0, 10) } : null, bullpen: null };
  };
  const w = g.weather || {};
  const mlb = { source: 'mlb', park: parks[H] || null, weather: w.temp ? { condition: w.condition, temp: Number(w.temp), wind: w.wind } : null, home: await side('home'), away: await side('away') };
  const hs = g.teams.home.score;
  const as = g.teams.away.score;
  const lines = { OU: [7.5, 8.5, 9.5], HCP: [-1.5, 1.5] };
  const models = {
    anterior: goalsModel(ev, { lastHome, lastAway }, cfg, { lines }),
    'nuevo sin contexto MLB': baseballModel(ev, { lastHome, lastAway, h2hGames }, cfg, { lines }),
    'nuevo con abridores y contexto': baseballModel(ev, { lastHome, lastAway, h2hGames, mlb }, cfg, { lines }),
    'nuevo solo abridores': baseballModel(ev, { lastHome, lastAway, mlb: { ...mlb, park: null, weather: null } }, cfg, { lines }),
  };
  used++;
  totals.push(hs + as);
  for (const [name, m] of Object.entries(models)) {
    if (!m) continue;
    const p = (market, sel, line = null) => m.candidates.find((c) => c.market === market && c.sel === sel && c.line === line)?.p;
    add(name, 'Ganador (local)', p('ML', 'home'), hs > as);
    for (const L of [7.5, 8.5, 9.5]) add(name, `Más de ${L}`, p('OU', 'over', L), hs + as > L);
    add(name, 'Local −1.5', p('HCP', 'home', -1.5), hs - as > 1.5);
  }
}
console.log(`\nEvaluados: ${used} partidos · total medio real ${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(2)}`);
const base = Object.fromEntries(Object.entries(acc.anterior).map(([k, v]) => [k, v.ll / v.n]));
for (const [name, a] of Object.entries(acc)) {
  console.log(`\n${name}`);
  for (const [k, v] of Object.entries(a)) console.log(`  ${k.padEnd(18)} log-loss ${(v.ll / v.n).toFixed(4)} (${((v.ll / v.n - base[k]) * 1000).toFixed(1)} milésimas vs anterior) · Brier ${(v.brier / v.n).toFixed(4)} · n ${v.n}`);
}

// (2) Contexto real de los próximos partidos.
const next = all.length ? (await get(`${API}/schedule?sportId=1&startDate=${new Date().toISOString().slice(0, 10)}&endDate=${new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10)}&hydrate=team`)).dates.flatMap((d) => d.games).filter((g) => g.status?.abstractGameState !== 'Final') : [];
for (const g of next.slice(0, 3)) {
  const ctx = await getGameContext({ home: g.teams.home.team.name, away: g.teams.away.team.name, start: g.gameDate });
  const s = (x) => (x?.pitcher ? `${x.pitcher.name} (${x.pitcher.starts.length} aperturas, última ${new Date(x.pitcher.starts[0]?.start).toISOString().slice(0, 10)} vs ${x.pitcher.starts[0]?.opp})` : 'sin abridor');
  console.log(`\nContexto ${g.teams.away.team.name} @ ${g.teams.home.team.name}: ${s(ctx?.home)} vs ${s(ctx?.away)} | bullpen ${JSON.stringify(ctx?.home?.bullpen)} / ${JSON.stringify(ctx?.away?.bullpen)} | estadio ${JSON.stringify(ctx?.park)} | clima ${JSON.stringify(ctx?.weather)} | serie ${ctx?.series}`);
}
