// Fútbol: partidos de ESPN y de Sofascore (todas las competiciones descargadas) con las
// cuotas de cierre de football-data.co.uk (Más/Menos 2.5 goles) y el xG de Understat.
import { teamStatsFrom } from '../../../docs/js/analysis/teamstats.js';
import { acceptsOffer } from '../../../docs/js/analysis/picks.js';
import { FD_SOFA } from '../futbol.mjs';
import { analyzeReplay, countLine, finished, halfLine, listDir, log, mean, readJson, rowsOf, withReal } from './comun.mjs';

const UNDERSTAT = { 'eng.1': 'EPL', 'esp.1': 'La_liga', 'ger.1': 'Bundesliga', 'ita.1': 'Serie_A', 'fra.1': 'Ligue_1' };
const FD = { 'eng.1': 'E0', 'esp.1': 'SP1', 'ger.1': 'D1', 'ita.1': 'I1', 'fra.1': 'F1', 'por.1': 'P1', 'bel.1': 'B1', ...FD_SOFA };
// Id de Understat para la página (engine.js UNDERSTAT_LEAGUES usa el id del torneo).
const NAMES = { 'eng.1': 'Premier League', 'esp.1': 'LaLiga', 'ger.1': 'Bundesliga', 'ita.1': 'Serie A', 'fra.1': 'Ligue 1', 'por.1': 'Liga Portugal', 'bel.1': 'Jupiler Pro League', 'usa.1': 'MLS', 'bra.1': 'Brasileirão', 'nor.1': 'Eliteserien', 'swe.1': 'Allsvenskan', 'per.1': 'Liga 1' };
const HOUR = 3600000;
const DAY = 24 * HOUR;

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|cd|ud|sd|rc|ss|as|ssc|us|vfb|vfl|tsg|sv|fsv|1\.|de|la|le|club|calcio|real|olympique|stade|sporting)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export const similar = (a, b) => {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2));
  const B = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return norm(a).slice(0, 4) === norm(b).slice(0, 4) ? 0.5 : 0;
  let k = 0;
  for (const w of A) if ([...B].some((x) => x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4)))) k++;
  return k / Math.min(A.size, B.size);
};

// ---- Partidos ----

const STATS = { c: 'corners', s: 'shots', t: 'shots_on', f: 'fouls', y: 'yellows', r: 'reds' };

const sumOf = (periods) => periods.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

function matchOf(m, code) {
  const t = m.t * 1000;
  const extra = /AET|PEN/i.test(m.st || '');
  const ok = Array.isArray(m.ls) && m.ls.length >= 2 && m.ls.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  // Los tiempos valen solo si suman el marcador (ESPN a veces deja 0-0 de relleno):
  // a los 90 minutos, los dos tiempos; con prórroga, los cuatro periodos suman el
  // marcador final y los 90 minutos son los dos primeros.
  const ls = ok && (extra ? m.ls.length >= 4 && same(sumOf(m.ls.slice(0, 4)), m.g) : same(sumOf(m.ls), m.g)) ? m.ls : null;
  const ft = ls ? sumOf(ls.slice(0, 2)) : extra ? null : m.g;
  if (!ft || !ft.every(Number.isFinite)) return null;
  const stats = {};
  // Con prórroga las estadísticas son de 120 minutos (la casa liquida a los 90): no valen.
  if (!extra) for (const [k, code2] of Object.entries(STATS)) if (Array.isArray(m.s?.[k]) && m.s[k].every(Number.isFinite)) stats[code2] = { ft: m.s[k] };
  // 0 y 0 en remates, tiros al arco o córners: ESPN no tiene el dato (pasa en
  // amistosos y eliminatorias); sin remates, tampoco valen las tarjetas.
  const zero = (k) => stats[k] && stats[k].ft[0] + stats[k].ft[1] === 0;
  if (zero('shots')) for (const k of ['shots', 'shots_on', 'corners', 'yellows', 'reds']) delete stats[k];
  for (const k of ['shots_on', 'corners']) if (zero(k)) delete stats[k];
  if (stats.yellows && stats.reds) stats.cards = { ft: [stats.yellows.ft[0] + stats.reds.ft[0], stats.yellows.ft[1] + stats.reds.ft[1]] };
  if (Array.isArray(m.c1)) {
    const [h, a, total] = m.c1;
    // Solo el total del 1.er tiempo (no hay hándicap de córners del 1.er tiempo en la lista).
    stats.corners = { ...(stats.corners || {}), h1: Number.isFinite(h) && Number.isFinite(a) ? [h, a] : [total, 0] };
  }
  return { id: m.id, code, t, neutral: Boolean(m.n), h: { id: m.h[0], name: m.h[1] }, a: { id: m.a[0], name: m.a[1] }, ft, ls: ls ? ls.slice(0, 2) : null, stats, k: m.k || null };
}

// Partidos de ESPN y de Sofascore (ligas que ESPN no tiene). Los equipos de Sofascore
// unidos con ESPN (equipos.json) usan el id de ESPN; el resto, "sf:<id>". Un partido de
// Sofascore que ya está en ESPN (mismo día y mismos equipos) se descarta.
function loadMatches() {
  const byId = new Map();
  for (const code of listDir('futbol/espn')) {
    for (const f of listDir(`futbol/espn/${code}`)) {
      for (const m of readJson(`futbol/espn/${code}/${f}`).matches) {
        const x = matchOf(m, code);
        if (x && !byId.has(x.id)) byId.set(x.id, { ...x, season: Number(f.slice(0, 4)) });
      }
    }
  }
  const map = listDir('futbol/sofascore').includes('equipos.json') ? readJson('futbol/sofascore/equipos.json').teams : {};
  const teamId = (id) => map[id]?.[0] || `sf:${id}`;
  const day = (m) => Math.floor(m.t / DAY);
  const seen = new Set([...byId.values()].flatMap((m) => [-1, 0, 1].map((k) => `${day(m) + k}|${m.h.id}|${m.a.id}`)));
  for (const code of listDir('futbol/sofascore')) {
    if (code.endsWith('.json')) continue;
    for (const f of listDir(`futbol/sofascore/${code}`)) {
      const file = readJson(`futbol/sofascore/${code}/${f}`);
      for (const m of file.matches) {
        const x = matchOf({ ...m, h: [teamId(m.h[0]), m.h[1]], a: [teamId(m.a[0]), m.a[1]] }, code);
        if (!x || byId.has(x.id) || seen.has(`${day(x)}|${x.h.id}|${x.a.id}`)) continue;
        byId.set(x.id, { ...x, season: Number(f.slice(0, 4)), name: file.name });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.t - b.t);
}

// ---- Cuotas de cierre y xG ----

function fdRows(code) {
  const fd = FD[code];
  if (!fd) return [];
  const out = [];
  for (const f of listDir(`futbol/cuotas/${fd}`)) {
    const d = readJson(`futbol/cuotas/${fd}/${f}`);
    const ix = Object.fromEntries(d.cols.map((c, i) => [c, i]));
    for (const r of d.rows) {
      const [dd, mm, yy] = String(r[ix.Date]).split('/');
      const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
      out.push({ day: Date.UTC(year, Number(mm) - 1, Number(dd)), home: r[ix.HomeTeam], away: r[ix.AwayTeam], g: [r[ix.FTHG], r[ix.FTAG]], over: r[ix['AvgC>2.5']] ?? r[ix['BbAv>2.5']], under: r[ix['AvgC<2.5']] ?? r[ix['BbAv<2.5']], hc: [r[ix.HC], r[ix.AC]], hy: [r[ix.HY], r[ix.AY]], hr: [r[ix.HR], r[ix.AR]], hs: [r[ix.HS], r[ix.AS]], hst: [r[ix.HST], r[ix.AST]] });
    }
  }
  return out;
}

// Une las filas de otra fuente a los partidos de ESPN: mismo día (±1), mismos goles y nombres parecidos.
function link(matches, rows, { day, home, away, goals }) {
  const byDay = new Map();
  for (const r of rows) for (const k of [-1, 0, 1]) (byDay.get(day(r) + k * DAY) || byDay.set(day(r) + k * DAY, []).get(day(r) + k * DAY)).push(r);
  const out = new Map();
  for (const m of matches) {
    const d0 = Date.UTC(new Date(m.t).getUTCFullYear(), new Date(m.t).getUTCMonth(), new Date(m.t).getUTCDate());
    let best = null;
    for (const r of byDay.get(d0) || []) {
      const g = goals(r);
      if (g && (g[0] !== m.ft[0] || g[1] !== m.ft[1])) continue;
      const s = similar(m.h.name, home(r)) + similar(m.a.name, away(r));
      if (s >= 1 && (!best || s > best.s)) best = { r, s };
    }
    if (best) out.set(m.id, best.r);
  }
  return out;
}

function understatRows(code) {
  const us = UNDERSTAT[code];
  if (!us) return [];
  const out = [];
  for (const f of listDir(`futbol/xg/${us}`)) {
    for (const [dt, h, a, hg, ag, xh, xa] of readJson(`futbol/xg/${us}/${f}`).matches) out.push({ t: Date.parse(`${dt.replace(' ', 'T')}Z`), season: Number(f.slice(0, 4)), home: h, away: a, g: [hg, ag], xg: [xh, xa] });
  }
  return out;
}

// ---- Reproducción ----

const lastN = (list, t0, n) => {
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < n; i--) if (list[i].t < t0 - 3 * HOUR) out.push(list[i]);
  return out;
};
const result = (gf, ga) => (gf > ga ? 'W' : gf < ga ? 'L' : 'D');
const view = (m, teamId) => {
  const home = m.h.id === teamId;
  const gf = home ? m.ft[0] : m.ft[1];
  const ga = home ? m.ft[1] : m.ft[0];
  return { start: m.t, home, gf, ga, r: result(gf, ga) };
};

// Media de una estadística por partido (ambos equipos) en los partidos de un equipo.
const totalMean = (list, code) => mean(list.filter((m) => m.stats[code]?.ft).map((m) => m.stats[code].ft[0] + m.stats[code].ft[1]));

// Cada partido con lo que se sabía antes de empezar: { m, ev, d, xg, plan, real }.
export function* footballCases({ from = 0, to = Infinity } = {}) {
  const matches = loadMatches();
  log(`fútbol: ${matches.length} partidos`);
  const byTeam = new Map();
  for (const m of matches) for (const id of [m.h.id, m.a.id]) (byTeam.get(id) || byTeam.set(id, []).get(id)).push(m);
  // Cuotas de cierre y xG por partido.
  const fd = new Map();
  const usByMatch = new Map();
  const usTeam = new Map(); // id de ESPN → nombre en Understat
  const usHistory = new Map(); // `${liga}|${temporada}|${equipo}` → partidos de Understat
  for (const code of Object.keys(FD)) {
    const ms = matches.filter((m) => m.code === code);
    for (const [id, r] of link(ms, fdRows(code), { day: (r) => r.day, home: (r) => r.home, away: (r) => r.away, goals: (r) => r.g })) fd.set(id, r);
    const ur = understatRows(code);
    for (const [id, r] of link(ms, ur, { day: (r) => Date.UTC(new Date(r.t).getUTCFullYear(), new Date(r.t).getUTCMonth(), new Date(r.t).getUTCDate()), home: (r) => r.home, away: (r) => r.away, goals: (r) => r.g })) {
      usByMatch.set(id, r);
      const m = ms.find((x) => x.id === id);
      usTeam.set(m.h.id, r.home);
      usTeam.set(m.a.id, r.away);
    }
    for (const r of ur) {
      for (const [team, xf, xa] of [
        [r.home, r.xg[0], r.xg[1]],
        [r.away, r.xg[1], r.xg[0]],
      ]) {
        const k = `${code}|${r.season}|${team}`;
        (usHistory.get(k) || usHistory.set(k, []).get(k)).push({ t: r.t, xgFor: xf, xgAgainst: xa });
      }
    }
  }
  for (const list of usHistory.values()) list.sort((a, b) => a.t - b.t);
  log(`cuotas de cierre unidas: ${fd.size} · xG: ${usByMatch.size} partidos, ${usTeam.size} equipos`);

  // Fuerza en xG de Understat: últimos 6 partidos de la temporada (como getTeamStrength).
  const strength = (code, season, teamId, t0) => {
    const name = usTeam.get(teamId);
    const list = name ? usHistory.get(`${code}|${season}|${name}`) || [] : [];
    const recent = lastN(list, t0, 6);
    if (!recent.length) return null;
    return { xgFor: mean(recent.map((x) => x.xgFor)), xgAgainst: mean(recent.map((x) => x.xgAgainst)) };
  };

  for (const m of matches) {
    if (m.t < from || m.t >= to) continue;
    const H = byTeam.get(m.h.id);
    const A = byTeam.get(m.a.id);
    const ph = lastN(H, m.t, 10);
    const pa = lastN(A, m.t, 10);
    if (ph.length < 4 || pa.length < 4) continue;
    // Estadísticas: últimos 8 partidos con datos de cada equipo (como collect-data).
    const withStats = (x) => Object.values(x.stats).some((v) => v.ft);
    const sh = lastN(H.filter(withStats), m.t, 8);
    const sa = lastN(A.filter(withStats), m.t, 8);
    const tsH = teamStatsFrom(sh.map((x) => ({ home: x.h.id === m.h.id, stats: x.stats })));
    const tsA = teamStatsFrom(sa.map((x) => ({ home: x.h.id === m.a.id, stats: x.stats })));
    const teamStats = Object.keys(tsH).length && Object.keys(tsA).length ? { home: tsH, away: tsA } : null;
    const meet = lastN(H.filter((x) => x.h.id === m.a.id || x.a.id === m.a.id), m.t, 10);
    const h2h = meet.length ? { homeWins: meet.filter((x) => view(x, m.h.id).r === 'W').length, draws: meet.filter((x) => view(x, m.h.id).r === 'D').length, awayWins: meet.filter((x) => view(x, m.h.id).r === 'L').length } : null;
    const d = {
      lastHome: ph.map((x) => view(x, m.h.id)),
      lastAway: pa.map((x) => view(x, m.a.id)),
      h2h,
      missing: null,
      votes: null,
      odds: null,
      teamStats,
      news: { home: { n: 0, injuries: 0, pos: 0, neg: 0 }, away: { n: 0, injuries: 0, pos: 0, neg: 0 }, total: 1 },
    };
    let xg;
    if (UNDERSTAT[m.code]) {
      const xh = strength(m.code, m.season, m.h.id, m.t);
      const xa = strength(m.code, m.season, m.a.id, m.t);
      if (xh && xa) xg = { home: xh, away: xa };
    }
    const ev = { id: m.id.startsWith('sf:') ? `h:${m.id}` : `h:espn:${m.id}`, sport: 'football', start: m.t, state: 'pendiente', tournament: { id: m.code, name: NAMES[m.code] || m.name || m.code }, category: { name: '' }, home: { id: m.h.id, name: m.h.name }, away: { id: m.a.id, name: m.a.name }, url: null };

    // Líneas de una casa: la media reciente de ambos equipos. Donde hay cuotas reales
    // (Sofascore o, en goles, football-data) se usan esas.
    const plan = [];
    const k = { ...(m.k || {}) };
    const odds = fd.get(m.id);
    if (!k.OU && odds && odds.over > 1 && odds.under > 1) k.OU = [[2.5, odds.over, odds.under]];
    const g = mean([...ph.map((x) => x.ft[0] + x.ft[1]), ...pa.map((x) => x.ft[0] + x.ft[1])]);
    plan.push({ market: 'OU', sels: ['over', 'under'], line: countLine(g) });
    plan.push({ market: 'BTTS', sels: ['yes', 'no'], line: null });
    const both = (code) => totalMean(sh, code) != null && totalMean(sa, code) != null && sh.filter((x) => x.stats[code]?.ft).length >= 4 && sa.filter((x) => x.stats[code]?.ft).length >= 4;
    const avg = (code) => (totalMean(sh, code) + totalMean(sa, code)) / 2;
    if (both('corners')) {
      const c = avg('corners');
      plan.push({ market: 'OU.corners', sels: ['over', 'under'], line: countLine(c) });
      const diff = (tsH.corners.for + tsA.corners.against) / 2 - (tsA.corners.for + tsH.corners.against) / 2;
      plan.push({ market: 'HCP.corners', sels: ['home', 'away'], line: halfLine(-diff) });
      plan.push({ market: 'OU.corners@h1', sels: ['over', 'under'], line: countLine(c * 0.47) });
    }
    if (both('cards')) plan.push({ market: 'OU.cards', sels: ['over', 'under'], line: countLine(avg('cards')) });
    if (both('shots_on')) plan.push({ market: 'OU.shots_on', sels: ['over', 'under'], line: countLine(avg('shots_on')) });
    if (both('shots')) plan.push({ market: 'OU.shots', sels: ['over', 'under'], line: countLine(avg('shots')) });

    // Como en la página: solo las líneas posibles de cada mercado.
    // plan: todos los mercados con la línea de la casa simulada; synthetic: los que no
    // tienen cuotas reales (real).
    const all = plan.filter((p) => acceptsOffer('football', p.market, p.line));
    const { real, plan: synthetic } = withReal(ev, all, k);
    yield { m, ev, d, xg, plan: all, real, synthetic };
  }
}

export function* replayFootball(range = {}) {
  for (const { m, ev, d, xg, real, synthetic } of footballCases(range)) {
    const { candidates } = analyzeReplay(ev, d, synthetic, { real, xg });
    if (!candidates.length) continue;
    const record = { per: m.ls || undefined, nReg: 2, final: m.ft, stats: m.stats };
    if (!m.ls) delete record.per;
    const res = finished(m.ft, record);
    const rows = rowsOf(ev, candidates, res, { src: m.id.startsWith('sf:') ? 'sofascore' : 'espn', comp: m.code }, new Set(synthetic.map((p) => p.market)));
    yield { ev, rows, candidates };
  }
}
