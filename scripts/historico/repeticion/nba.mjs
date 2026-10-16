// Básquet: partidos de la NBA (ESPN) y de la Euroliga y la Liga ACB (Sofascore) con el
// marcador por cuarto y los jugadores. Para cada partido: los últimos 10 de cada
// equipo y, de los jugadores de la rotación, sus últimos 10 partidos jugados (en
// cualquier equipo de la misma fuente) antes del partido.
import { PLAYER_STATS, statValue } from '../../../docs/js/analysis/players.js';
import { withPlayers } from '../../../docs/js/history.js';
import { analyzeReplay, countLine, finished, halfLine, listDir, log, mean, readJson, rowsOf, withReal } from './comun.mjs';

const HOUR = 3600000;
const CODES = Object.keys(PLAYER_STATS);

// NBA (ESPN, data/historico/nba) y otras ligas (Sofascore, data/historico/basquet/<liga>:
// Euroliga, Liga ACB), con equipos y jugadores "sf:<id>".
function loadGames() {
  const games = [];
  const files = [...listDir('nba').map((f) => ['nba', `nba/${f}`]), ...listDir('basquet').flatMap((code) => listDir(`basquet/${code}`).map((f) => [code, `basquet/${code}/${f}`]))];
  for (const [league, rel] of files) {
    const d = readJson(rel);
    const fields = d.fields;
    for (const g of d.games) {
      if (!g.g.every(Number.isFinite)) continue;
      const players = g.p.map((side) =>
        side.map(([id, name, starter, ...v]) => ({ id, name, starter: Boolean(starter), ...Object.fromEntries(fields.map((k, i) => [k, v[i]])) })),
      );
      games.push({ id: g.id, league, name: d.name || 'NBA', t: g.t * 1000, h: { id: g.h[0], abbr: g.h[1], name: g.h[2] }, a: { id: g.a[0], abbr: g.a[1], name: g.a[2] }, g: g.g, q: g.q, players, k: g.k || null });
    }
  }
  return games.sort((a, b) => a.t - b.t);
}

const lastN = (list, t0, n) => {
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < n; i--) if (list[i].t < t0 - 3 * HOUR) out.push(list[i]);
  return out;
};
const view = (g, teamId) => {
  const home = g.h.id === teamId;
  const gf = home ? g.g[0] : g.g[1];
  const ga = home ? g.g[1] : g.g[0];
  return { start: g.t, home, gf, ga, r: gf > ga ? 'W' : 'L' };
};

// cases: solo lo que se sabía antes de cada partido ({ g, ev, d, plan }), sin analizar.
export function* replayNba({ from = 0, to = Infinity, players: withProps = true, cases = false } = {}) {
  const games = loadGames();
  log(`básquet: ${games.length} partidos (${Object.entries(games.reduce((s, g) => ({ ...s, [g.league]: (s[g.league] || 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  const byTeam = new Map();
  const byPlayer = new Map(); // id → [{ t, row }]
  for (const g of games) {
    for (const id of [g.h.id, g.a.id]) (byTeam.get(id) || byTeam.set(id, []).get(id)).push(g);
    for (const side of g.players) for (const p of side) if (p.min > 0) (byPlayer.get(p.id) || byPlayer.set(p.id, []).get(p.id)).push({ t: g.t, row: p });
  }
  for (const g of games) {
    if (g.t < from || g.t >= to) continue;
    const H = lastN(byTeam.get(g.h.id), g.t, 10);
    const A = lastN(byTeam.get(g.a.id), g.t, 10);
    if (H.length < 4 || A.length < 4) continue;
    const meet = lastN(byTeam.get(g.h.id).filter((x) => x.h.id === g.a.id || x.a.id === g.a.id), g.t, 10);
    const d = {
      lastHome: H.map((x) => view(x, g.h.id)),
      lastAway: A.map((x) => view(x, g.a.id)),
      h2h: meet.length ? { homeWins: meet.filter((x) => view(x, g.h.id).r === 'W').length, draws: 0, awayWins: meet.filter((x) => view(x, g.h.id).r === 'L').length } : null,
      missing: null,
      news: { home: { n: 0, injuries: 0, pos: 0, neg: 0 }, away: { n: 0, injuries: 0, pos: 0, neg: 0 }, total: 1 },
    };
    // Jugadores: los que jugaron en los últimos 10 del equipo con 20+ minutos de media
    // (los que suele ofrecer la casa), con sus últimos 10 partidos jugados.
    const plan = [];
    if (withProps) {
      d.players = { source: g.league === 'nba' ? 'espn' : 'sofascore' };
      [H, A].forEach((list, s) => {
        const teamId = s ? g.a.id : g.h.id;
        const ids = new Set();
        for (const x of list) for (const p of x.players[x.h.id === teamId ? 0 : 1]) ids.add(p.id);
        const roster = [];
        for (const id of ids) {
          const log10 = lastN(byPlayer.get(id) || [], g.t, 10);
          if (log10.length < 5) continue;
          const minutes = mean(log10.map((x) => x.row.min));
          if (minutes < 20) continue;
          const name = log10[0].row.name;
          roster.push({ name, short: null, out: false, games: log10.map((x) => ({ start: x.t, ...Object.fromEntries(['min', 'pts', 'reb', 'ast', 'tpm', 'stl', 'blk', 'tov', 'oreb', 'dreb', 'ftm', 'fgm', 'fga', 'tpa', 'fta'].map((k) => [k, x.row[k]])) })) });
          for (const code of CODES) {
            const vals = log10.map((x) => statValue(x.row, code)).filter((v) => v != null);
            if (vals.length < 5) continue;
            plan.push({ market: `OU.${code}#${name}`, sels: ['over', 'under'], line: countLine(mean(vals)) });
          }
        }
        d.players[s ? 'away' : 'home'] = { teamGames: list.length, players: roster };
      });
    }
    // Líneas de la casa: total y margen de las medias recientes.
    const total = mean([...H.map((x) => x.g[0] + x.g[1]), ...A.map((x) => x.g[0] + x.g[1])]);
    const margin = mean(H.map((x) => view(x, g.h.id).gf - view(x, g.h.id).ga)) / 2 - mean(A.map((x) => view(x, g.a.id).gf - view(x, g.a.id).ga)) / 2 + 2.5;
    plan.push({ market: 'OU', sels: ['over', 'under'], line: halfLine(total) });
    plan.push({ market: 'HCP', sels: ['home', 'away'], line: halfLine(-margin) });
    plan.push({ market: 'OU@h1', sels: ['over', 'under'], line: halfLine(total / 2) });
    plan.push({ market: 'HCP@h1', sels: ['home', 'away'], line: halfLine(-margin / 2) });
    const ev = { id: g.league === 'nba' ? `h:nba:${g.id}` : `h:${g.id}`, sport: 'basketball', start: g.t, state: 'pendiente', tournament: { name: g.league === 'nba' ? 'NBA' : g.name }, category: { name: g.league === 'nba' ? 'USA' : '' }, home: { id: g.h.id, name: g.h.name }, away: { id: g.a.id, name: g.a.name }, url: null };
    if (cases) {
      yield { g, ev, d, plan };
      continue;
    }
    // Cuotas reales (Sofascore o Flashscore) donde las hay; el resto, sintéticas.
    const { real, plan: synthetic } = withReal(ev, plan, g.k);
    const { candidates } = analyzeReplay(ev, d, synthetic, { real, simulations: 10000 });
    if (!candidates.length) continue;
    const per = g.q[0].length >= 4 && g.q[0].length === g.q[1].length ? g.q[0].map((v, i) => [v, g.q[1][i]]) : null;
    const box = {};
    for (const side of g.players) for (const p of side) box[p.name] = p.min > 0 ? p : { min: 0, dnp: true };
    const base = finished(g.g);
    const res = withPlayers(per ? { ...base, per } : base, box, 'basketball');
    yield { ev, rows: rowsOf(ev, candidates, res, { src: g.league === 'nba' ? 'espn' : 'sofascore', comp: g.league }, new Set(synthetic.map((p) => p.market))), candidates };
  }
}
