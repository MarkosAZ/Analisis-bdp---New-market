// MLB: partidos de statsapi con los abridores probables (sus aperturas anteriores),
// el estadio (temporada anterior y la actual hasta el día) y el clima. Sin bullpen.
import { parkRuns } from '../../../extension/sources/mlb.js';
import { analyzeReplay, countLine, finished, listDir, log, mean, readJson, rowsOf, withReal } from './comun.mjs';

const HOUR = 3600000;

function load() {
  const all = [];
  for (const f of listDir('mlb/partidos')) for (const g of readJson(`mlb/partidos/${f}`).games) all.push({ ...g, t: g.t * 1000, season: Number(f.slice(0, 4)) });
  // Un partido suspendido aparece dos veces (inicio y reanudación) con el marcador
  // final en ambas: se deja fuera (su resultado se sabría antes de tiempo).
  const count = new Map();
  for (const g of all) count.set(g.pk, (count.get(g.pk) || 0) + 1);
  const games = all.filter((g) => count.get(g.pk) === 1);
  const logs = {};
  for (const f of listDir('mlb/lanzadores')) {
    const d = readJson(`mlb/lanzadores/${f}`);
    for (const [id, list] of Object.entries(d.logs)) (logs[id] ||= []).push(...list.map(([st, ip, r, er, h, bb, k, hr, hbp]) => ({ start: st * 1000, ip, r, er, h, bb, k, hr, hbp })));
  }
  for (const list of Object.values(logs)) list.sort((a, b) => b.start - a.start);
  return { games: games.sort((a, b) => a.t - b.t), logs };
}

const lastN = (list, t0, n) => {
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < n; i--) if (list[i].t < t0 - 3 * HOUR) out.push(list[i]);
  return out;
};
const view = (g, teamId) => {
  const home = g.h[0] === teamId;
  const gf = home ? g.g[0] : g.g[1];
  const ga = home ? g.g[1] : g.g[0];
  return { start: g.t, home, gf, ga, r: gf > ga ? 'W' : 'L' };
};

export function* replayMlb({ from = 0, to = Infinity } = {}) {
  const { games, logs } = load();
  log(`MLB: ${games.length} partidos`);
  const byTeam = new Map();
  for (const g of games) for (const id of [g.h[0], g.a[0]]) (byTeam.get(id) || byTeam.set(id, []).get(id)).push(g);
  const regular = (season) => games.filter((g) => g.season === season && g.ty === 'R');
  for (const g of games) {
    if (g.t < from || g.t >= to) continue;
    const H = lastN(byTeam.get(g.h[0]), g.t, 30);
    const A = lastN(byTeam.get(g.a[0]), g.t, 30);
    if (H.length < 4 || A.length < 4) continue;
    // Estadio: temporada anterior completa y la actual hasta el día (≥ 20 de local y de visita).
    const prior = [...regular(g.season - 1), ...regular(g.season).filter((x) => x.t < g.t - 3 * HOUR)].map((x) => ({ status: { abstractGameState: 'Final' }, teams: { home: { team: { id: x.h[0] }, score: x.g[0] }, away: { team: { id: x.a[0] }, score: x.g[1] } } }));
    const pr = parkRuns(prior, g.h[0]);
    const park = pr.nHome >= 20 && pr.nAway >= 20 ? { factor: Math.round((pr.home / pr.away) * 1000) / 1000, n: pr.nHome + pr.nAway } : null;
    const side = (i) => {
      const id = g.pp[i];
      if (!id) return { team: g[i ? 'a' : 'h'][1], pitcher: null, bullpen: null };
      // El registro trae solo la fecha: las de las 30 horas anteriores no cuentan.
      const starts = (logs[id] || []).filter((s) => s.start < g.t - 30 * HOUR).slice(0, 10);
      return { team: g[i ? 'a' : 'h'][1], pitcher: { id: String(id), name: g.pn[i] || '', hand: null, starts }, bullpen: null };
    };
    const meet = lastN(byTeam.get(g.h[0]).filter((x) => x.h[0] === g.a[0] || x.a[0] === g.a[0]), g.t, 10);
    const d = {
      lastHome: H.map((x) => view(x, g.h[0])),
      lastAway: A.map((x) => view(x, g.a[0])),
      h2h: meet.length ? { homeWins: meet.filter((x) => view(x, g.h[0]).r === 'W').length, draws: 0, awayWins: meet.filter((x) => view(x, g.h[0]).r === 'L').length } : null,
      h2hGames: meet.map((x) => ({ start: x.t, gf: view(x, g.h[0]).gf, ga: view(x, g.h[0]).ga, home: x.h[0] === g.h[0] })),
      mlb: { source: 'mlb', gamePk: String(g.pk), venue: g.v, weather: g.w, series: null, park, home: side(0), away: side(1) },
      news: { home: { n: 0, injuries: 0, pos: 0, neg: 0 }, away: { n: 0, injuries: 0, pos: 0, neg: 0 }, total: 1 },
    };
    const total = mean([...H.slice(0, 20).map((x) => x.g[0] + x.g[1]), ...A.slice(0, 20).map((x) => x.g[0] + x.g[1])]);
    const plan = [
      { market: 'ML', sels: ['home', 'away'], line: null },
      { market: 'OU', sels: ['over', 'under'], line: countLine(total) },
    ];
    const ev = { id: `h:mlb:${g.pk}`, sport: 'baseball', start: g.t, state: 'pendiente', tournament: { name: 'MLB' }, category: { name: 'USA' }, home: { id: String(g.h[0]), name: g.h[1] }, away: { id: String(g.a[0]), name: g.a[1] }, url: null };
    // Run line: −1.5 para el favorito del modelo (como lo ofrece la casa).
    const first = analyzeReplay(ev, d, plan, {});
    const pHome = first.candidates.find((c) => c.market === 'ML' && c.sel === 'home')?.pModel;
    if (pHome == null) continue;
    plan.push({ market: 'HCP', sels: ['home', 'away'], line: pHome >= 0.5 ? -1.5 : 1.5 });
    // Cuotas reales (Flashscore) donde las hay; el resto, sintéticas.
    const { real, plan: synthetic } = withReal(ev, plan, g.k);
    const { candidates } = analyzeReplay(ev, d, synthetic, { real });
    yield { ev, rows: rowsOf(ev, candidates, finished(g.g), { src: 'mlb', comp: g.ty === 'R' ? 'mlb' : 'mlb-playoffs' }, new Set(synthetic.map((p) => p.market))), candidates };
  }
}
