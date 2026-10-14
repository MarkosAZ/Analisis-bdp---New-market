// Sondeo temporal (22): comparación de configuraciones del béisbol en tres periodos de la MLB 2026 del modelo de béisbol con la MLB 2026. Se ajusta con
// junio y julio y se comprueba con agosto y septiembre (solo datos anteriores a cada
// partido). Error: log-loss (menos es mejor; 0.693 = tirar una moneda).
import { goalsModel } from '../docs/js/analysis/models.js';
import { BASEBALL, baseballModel } from '../docs/js/analysis/baseball.js';
import { sportOf } from '../docs/js/sports.js';
import { parkRuns, startsFromGameLog } from '../extension/sources/mlb.js';

const API = 'https://statsapi.mlb.com/api/v1';
const get = async (url) => (await fetch(url, { signal: AbortSignal.timeout(60000) })).json();
const cfg = sportOf('baseball');
const ms = (d) => Date.parse(d);
const all = (await get(`${API}/schedule?sportId=1&startDate=2026-03-20&endDate=2026-09-30&gameType=R&hydrate=probablePitcher,team,weather`)).dates.flatMap((d) => d.games);
const done = all.filter((g) => g.status?.abstractGameState === 'Final' && g.teams.home.score != null);
const prev = (await get(`${API}/schedule?sportId=1&season=2025&gameType=R`)).dates.flatMap((d) => d.games);
const parks = {};
for (const t of new Set(done.map((g) => g.teams.home.team.id))) {
  const r = parkRuns(prev, t);
  if (r.nHome >= 20 && r.nAway >= 20) parks[t] = { factor: r.home / r.away, n: r.nHome + r.nAway };
}
// Últimos partidos de 2025 para los primeros meses (como haría Flashscore: los últimos 50).
const byTeam = new Map();
for (const g of [...prev.filter((x) => x.status?.abstractGameState === 'Final' && x.teams.home.score != null), ...done])
  for (const side of ['home', 'away']) {
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
const targets = done.filter((g) => ms(g.gameDate) >= ms('2026-04-15') && ms(g.gameDate) < ms('2026-09-29'));
const pids = [...new Set(targets.flatMap((g) => [g.teams.home.probablePitcher?.id, g.teams.away.probablePitcher?.id]).filter(Boolean))];
for (let i = 0; i < pids.length; i += 10) await Promise.all(pids.slice(i, i + 10).map(starts));
// Datos de cada partido (solo lo anterior a su inicio).
const cases = [];
for (const g of targets) {
  const t0 = ms(g.gameDate) - 3600000;
  const H = g.teams.home.team.id;
  const A = g.teams.away.team.id;
  const before = (id) => (byTeam.get(id) || []).filter((m) => m.start < t0);
  const lastHome = before(H).slice(0, 60);
  const lastAway = before(A).slice(0, 60);
  if (lastHome.length < 20 || lastAway.length < 20) continue;
  const side = async (key) => {
    const p = g.teams[key].probablePitcher;
    // El registro trae solo la fecha: las de las 30 horas anteriores no cuentan (sería este partido).
    return { pitcher: p ? { name: p.fullName, starts: (await starts(p.id)).filter((s) => s.start < t0 - 30 * 3600000).slice(0, 10) } : null, bullpen: null };
  };
  const w = g.weather || {};
  const mlb = { source: 'mlb', park: parks[H] || null, weather: w.temp ? { condition: w.condition, temp: Number(w.temp), wind: w.wind } : null, home: await side('home'), away: await side('away') };
  cases.push({ month: new Date(g.gameDate).getUTCMonth() + 1, ev: { sport: 'baseball', start: t0 + 3600000 }, d: { lastHome, lastAway, h2hGames: lastHome.filter((m) => m.opp === A).slice(0, 10), mlb }, hs: g.teams.home.score, as: g.teams.away.score });
}
const train = cases.filter((c) => c.month <= 7);
const testSet = cases.filter((c) => c.month >= 8);
console.log(`partidos: ${cases.length} (ajuste jun-jul ${train.length}, prueba ago-sep ${testSet.length}) · abridores ${pids.length}`);

const ll = (p, y) => -Math.log(Math.min(0.999, Math.max(0.001, y ? p : 1 - p)));
const lines = { OU: [7.5, 8.5, 9.5], HCP: [-1.5] };
function score(list, fn) {
  const s = { ml: 0, ou: 0, hcp: 0, n: 0 };
  for (const c of list) {
    const m = fn(c);
    if (!m) continue;
    const p = (market, sel, line = null) => m.candidates.find((x) => x.market === market && x.sel === sel && x.line === line).p;
    s.ml += ll(p('ML', 'home'), c.hs > c.as);
    s.ou += (ll(p('OU', 'over', 7.5), c.hs + c.as > 7.5) + ll(p('OU', 'over', 8.5), c.hs + c.as > 8.5) + ll(p('OU', 'over', 9.5), c.hs + c.as > 9.5)) / 3;
    s.hcp += ll(p('HCP', 'home', -1.5), c.hs - c.as > 1.5);
    s.n++;
  }
  return { ml: s.ml / s.n, ou: s.ou / s.n, hcp: s.hcp / s.n, sum: (s.ml + s.ou + s.hcp) / s.n, n: s.n };
}
const fmt = (r) => `ganador ${r.ml.toFixed(4)} · totales ${r.ou.toFixed(4)} · run line ${r.hcp.toFixed(4)} · suma ${r.sum.toFixed(4)}`;
const model = (opts) => (c) => baseballModel(c.ev, c.d, cfg, { lines }, opts);

// Referencias: siempre 53.5 % local; el modelo anterior; el nuevo con los ajustes de hoy.
const homeRate = train.filter((c) => c.hs > c.as).length / train.length;
const constant = (list) => list.reduce((s, c) => s + ll(homeRate, c.hs > c.as), 0) / list.length;
console.log(`\nSiempre ${(homeRate * 100).toFixed(1)} % local: ganador ajuste ${constant(train).toFixed(4)} · prueba ${constant(testSet).toFixed(4)}`);
const old = (c) => goalsModel(c.ev, { lastHome: c.d.lastHome.slice(0, 10), lastAway: c.d.lastAway.slice(0, 10) }, cfg, { lines });
console.log(`Anterior: ajuste ${fmt(score(train, old))}\n          prueba ${fmt(score(testSet, old))}`);
console.log(`Nuevo (ajustes actuales): ajuste ${fmt(score(train, model({})))}\n          prueba ${fmt(score(testSet, model({})))}`);

// Referencias por mercado: la frecuencia del ajuste como probabilidad fija.
const rate = (f) => train.filter(f).length / train.length;
const fixed = { ml: rate((c) => c.hs > c.as), o75: rate((c) => c.hs + c.as > 7.5), o85: rate((c) => c.hs + c.as > 8.5), o95: rate((c) => c.hs + c.as > 9.5), rl: rate((c) => c.hs - c.as > 1.5) };
const fixedScore = (list) => {
  const n = list.length;
  const ml = list.reduce((s, c) => s + ll(fixed.ml, c.hs > c.as), 0) / n;
  const ou = list.reduce((s, c) => s + (ll(fixed.o75, c.hs + c.as > 7.5) + ll(fixed.o85, c.hs + c.as > 8.5) + ll(fixed.o95, c.hs + c.as > 9.5)) / 3, 0) / n;
  const hcp = list.reduce((s, c) => s + ll(fixed.rl, c.hs - c.as > 1.5), 0) / n;
  return { ml, ou, hcp, sum: ml + ou + hcp, n };
};
console.log(`Frecuencias fijas: ajuste ${fmt(fixedScore(train))}\n          prueba ${fmt(fixedScore(testSet))}`);

// Configuraciones razonables (la búsqueda del sondeo 20 generalizó mejor que la 21,
// que se sobreajustó a junio y julio): se comparan en tres periodos.
const A = { formN: 20, formDecay: 1, formPrior: 100, venueWeight: 0.4, spPriorIp: 30, spRawWeight: 0.75, ha: 1, h2hWeight: 0, nbSize: 3, parkWeight: 0.5, stretch: 1, totalScale: 1 };
const configs = {
  A,
  'A localía 1.02': { ...A, ha: 1.02 },
  'A localía 1.04': { ...A, ha: 1.04 },
  'A separación 1.15': { ...A, stretch: 1.15 },
  'A dispersión 4': { ...A, nbSize: 4 },
  'A enfrentamientos 0.1': { ...A, h2hWeight: 0.1 },
  'A forma 200': { ...A, formPrior: 200 },
  'A forma 30 partidos': { ...A, formN: 30 },
  'A abridor 0.5 real': { ...A, spRawWeight: 0.5 },
  'A estadio 1': { ...A, parkWeight: 1 },
  'A sin local/visita': { ...A, venueWeight: 0 },
  'A localía 1.02 + separación 1.15 + dispersión 4': { ...A, ha: 1.02, stretch: 1.15, nbSize: 4 },
};
const periods = { 'abr-may': cases.filter((c) => c.month <= 5), 'jun-jul': cases.filter((c) => c.month >= 6 && c.month <= 7), 'ago-sep': cases.filter((c) => c.month >= 8), todo: cases };
console.log('\n' + Object.entries(periods).map(([k, v]) => `${k}: ${v.length}`).join(' · '));
for (const [k, list] of Object.entries(periods)) console.log(`Frecuencias fijas ${k}: suma ${fixedScore(list).sum.toFixed(4)} · ganador ${fixedScore(list).ml.toFixed(4)}`);
for (const [name, opts] of Object.entries(configs)) {
  const r = Object.fromEntries(Object.entries(periods).map(([k, list]) => [k, score(list, model(opts))]));
  console.log(`\n${name}\n` + Object.entries(r).map(([k, v]) => `  ${k.padEnd(8)} ${fmt(v)}`).join('\n'));
}
const nopitch = (opts) => (c) => baseballModel(c.ev, { ...c.d, mlb: null }, cfg, { lines }, opts);
console.log(`\nA sin abridores: todo ${fmt(score(cases, nopitch(A)))}`);
console.log(`Anterior: todo ${fmt(score(cases, old))}`);
