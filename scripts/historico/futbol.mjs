// Fútbol histórico: partidos de ESPN (estadísticas, tarjetas, goles por tiempo y
// córners del 1.er tiempo del relato), cuotas de cierre de football-data.co.uk y xG
// de Understat. Un archivo por competición y temporada en data/historico/futbol.
import { DAY, get, log, num, pool, readJson, writeJson, ymd } from './comun.mjs';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const EU = ['20231015', '20241015', '20251015', '20261010']; // temporadas de agosto a mayo
const CAL = ['20240601', '20250601', '20260601']; // temporadas de año calendario

// Competiciones de ESPN: código y fechas "ancla" (una por temporada).
export const COMPETITIONS = [
  { code: 'eng.1', anchors: EU, fd: 'E0', us: 'EPL' },
  { code: 'esp.1', anchors: EU, fd: 'SP1', us: 'La_liga' },
  { code: 'ger.1', anchors: EU, fd: 'D1', us: 'Bundesliga' },
  { code: 'ita.1', anchors: EU, fd: 'I1', us: 'Serie_A' },
  { code: 'fra.1', anchors: EU, fd: 'F1', us: 'Ligue_1' },
  { code: 'por.1', anchors: EU, fd: 'P1' },
  { code: 'bel.1', anchors: EU, fd: 'B1' },
  { code: 'usa.1', anchors: CAL, fdNew: 'USA' },
  { code: 'bra.1', anchors: CAL, fdNew: 'BRA' },
  { code: 'nor.1', anchors: CAL, fdNew: 'NOR' },
  { code: 'swe.1', anchors: CAL, fdNew: 'SWE' },
  { code: 'per.1', anchors: CAL },
  { code: 'uefa.champions', anchors: EU },
  { code: 'uefa.europa', anchors: EU },
  { code: 'uefa.europa.conf', anchors: EU },
  { code: 'conmebol.libertadores', anchors: CAL },
  { code: 'conmebol.sudamericana', anchors: CAL },
  { code: 'uefa.nations', anchors: ['20241015', '20250320', '20261010'] },
  { code: 'uefa.euro', anchors: ['20240620'] },
  { code: 'conmebol.america', anchors: ['20240625'] },
  { code: 'fifa.world', anchors: ['20221203', '20260620'] },
  { code: 'fifa.worldq.uefa', anchors: ['20250906'] },
  { code: 'fifa.worldq.conmebol', anchors: ['20240910', '20250904'] },
  { code: 'fifa.worldq.concacaf', anchors: ['20250906'] },
  { code: 'fifa.worldq.caf', anchors: ['20250906'] },
  { code: 'fifa.worldq.afc', anchors: ['20250906'] },
  { code: 'fifa.friendly', anchors: ['20240601', '20250601', '20260601'] },
];

const STAT = { wonCorners: 'c', totalShots: 's', shotsOnTarget: 't', foulsCommitted: 'f', yellowCards: 'y', redCards: 'r', possessionPct: 'p', offsides: 'o', saves: 'v' };

// Días con partidos de una temporada (del calendario de ESPN o día por día).
async function seasonDays(code, anchor, now) {
  const sb = await get(`${ESPN}/${code}/scoreboard?dates=${anchor}`);
  const L = sb?.leagues?.[0];
  if (!L?.season) return null;
  const start = Date.parse(L.season.startDate);
  const end = Math.min(Date.parse(L.season.endDate), now - DAY);
  let days;
  if (L.calendarType === 'day' && Array.isArray(L.calendar) && typeof L.calendar[0] === 'string') days = L.calendar.map((d) => d.slice(0, 10).replace(/-/g, ''));
  else {
    days = [];
    for (let t = start; t <= end; t += DAY) days.push(ymd(t));
  }
  return { year: L.season.year, name: L.season.displayName, start, end: Date.parse(L.season.endDate), days: [...new Set(days)].filter((d) => d <= ymd(end)) };
}

// Córners del relato: total y de cada equipo antes de "First Half ends".
function cornersH1(commentary = [], home, away) {
  if (!commentary.length) return null;
  const ht = commentary.findIndex((c) => /^first half ends/i.test(c.text || ''));
  if (ht < 0) return null;
  const all = commentary.filter((c) => /^corner,/i.test(c.text || ''));
  if (!all.length) return null;
  const side = (c) => {
    const id = String(c.play?.team?.id || '');
    if (id && id === home.id) return 0;
    if (id && id === away.id) return 1;
    const who = (c.text.match(/^corner,\s*([^.]+)\./i)?.[1] || '').toLowerCase();
    const is = (t) => [t.name, t.short, t.abbr].filter(Boolean).some((n) => who.includes(n.toLowerCase()) || n.toLowerCase().includes(who));
    return is(home) && !is(away) ? 0 : is(away) && !is(home) ? 1 : -1;
  };
  const h1 = commentary.slice(0, ht).filter((c) => /^corner,/i.test(c.text || ''));
  const out = [0, 0, h1.length];
  let unknown = 0;
  for (const c of h1) {
    const s = side(c);
    if (s < 0) unknown++;
    else out[s]++;
  }
  // [local, visita, total]; sin poder separar, solo el total.
  return unknown ? [null, null, h1.length] : out;
}

function teamOf(c) {
  return { id: String(c.team?.id || c.id || ''), name: c.team?.displayName || '', short: c.team?.shortDisplayName || '', abbr: c.team?.abbreviation || '' };
}

// Un partido terminado con su resumen.
async function matchOf(code, ev) {
  const comp = ev.competitions?.[0];
  const cs = comp?.competitors || [];
  const hc = cs.find((c) => c.homeAway === 'home');
  const ac = cs.find((c) => c.homeAway === 'away');
  if (!hc || !ac) return null;
  const home = teamOf(hc);
  const away = teamOf(ac);
  const s = await get(`${ESPN}/${code}/summary?event=${ev.id}`).catch(() => null);
  const hdr = s?.header?.competitions?.[0]?.competitors || [];
  const lsOf = (id) => (hdr.find((c) => String(c.id || c.team?.id) === id)?.linescores || []).map((l) => num(l.displayValue));
  const lh = lsOf(home.id);
  const la = lsOf(away.id);
  const ls = lh.length && lh.length === la.length ? lh.map((v, i) => [v, la[i]]) : null;
  // Estadísticas: del resumen (boxscore) o, si no, del calendario.
  const stats = {};
  const put = (side, list = []) => {
    for (const x of list) {
      const k = STAT[x.name];
      const v = num(x.displayValue);
      if (!k || v == null) continue;
      (stats[k] ||= [null, null])[side] = v;
    }
  };
  for (const t of s?.boxscore?.teams || []) {
    const id = String(t.team?.id || '');
    put(id === home.id ? 0 : id === away.id ? 1 : -1, t.statistics);
  }
  if (!Object.keys(stats).length) {
    put(0, hc.statistics);
    put(1, ac.statistics);
  }
  // Tarjetas de las incidencias si el resumen no las trae.
  if (!stats.y && comp.details?.length) {
    const y = [0, 0];
    const r = [0, 0];
    for (const d of comp.details) {
      const i = String(d.team?.id) === home.id ? 0 : String(d.team?.id) === away.id ? 1 : -1;
      if (i < 0) continue;
      if (d.yellowCard) y[i]++;
      if (d.redCard) r[i]++;
    }
    stats.y = y;
    stats.r = r;
    stats.cardsFrom = 'incidencias';
  }
  for (const k of Object.keys(stats)) if (Array.isArray(stats[k]) && stats[k].some((v) => v == null)) delete stats[k];
  // Cuotas del resumen (DraftKings / ESPN BET en algunas competiciones).
  const o = (s?.odds || []).find((x) => x.overUnder != null || x.moneyline);
  const odds = o
    ? {
        by: o.provider?.name || null,
        ou: num(o.overUnder),
        over: num(o.overOdds),
        under: num(o.underOdds),
        spread: num(o.spread),
        h: num(o.homeTeamOdds?.moneyLine ?? o.moneyline?.home?.close?.odds),
        a: num(o.awayTeamOdds?.moneyLine ?? o.moneyline?.away?.close?.odds),
        d: num(o.drawOdds?.moneyLine ?? o.moneyline?.draw?.close?.odds),
      }
    : null;
  return {
    id: String(ev.id),
    t: Math.round(Date.parse(ev.date) / 1000),
    st: ev.status?.type?.name || null,
    n: comp.neutralSite ? 1 : 0,
    h: [home.id, home.name, home.abbr],
    a: [away.id, away.name, away.abbr],
    g: [num(hc.score), num(ac.score)],
    ...(ls ? { ls } : {}),
    s: stats,
    ...(cornersH1(s?.commentary, home, away) ? { c1: cornersH1(s?.commentary, home, away) } : {}),
    ...(odds ? { o: odds } : {}),
  };
}

async function competitionSeason(c, anchor, now) {
  const info = await seasonDays(c.code, anchor, now);
  if (!info) {
    log(`${c.code} ${anchor}: sin temporada`);
    return;
  }
  const rel = `futbol/espn/${c.code}/${info.year}.json`;
  const old = readJson(rel);
  const complete = info.end < now - 3 * DAY;
  if (old?.complete) {
    log(`${c.code} ${info.year}: ya descargada (${old.matches.length} partidos)`);
    return;
  }
  const have = new Map((old?.matches || []).map((m) => [m.id, m]));
  const lastDay = old?.matches?.length ? ymd(Math.max(...old.matches.map((m) => m.t * 1000)) - 2 * DAY) : '00000000';
  const days = info.days.filter((d) => d >= lastDay);
  const events = new Map();
  await pool(
    days,
    async (d) => {
      const sb = await get(`${ESPN}/${c.code}/scoreboard?dates=${d}`).catch((e) => {
        log(`${c.code} ${d}: ${e.message}`);
        return null;
      });
      for (const ev of sb?.events || []) if (ev.status?.type?.completed && !have.has(String(ev.id))) events.set(String(ev.id), ev);
    },
    6,
  );
  const fresh = (await pool([...events.values()], (ev) => matchOf(c.code, ev).catch((e) => (log(`${c.code} ${ev.id}: ${e.message}`), null)), 6)).filter(Boolean);
  const matches = [...have.values(), ...fresh].sort((a, b) => a.t - b.t);
  const bytes = writeJson(rel, { code: c.code, year: info.year, name: info.name, complete, updated: new Date(now).toISOString(), matches });
  const withStats = matches.filter((m) => m.s?.c).length;
  const withH1 = matches.filter((m) => m.c1).length;
  log(`${c.code} ${info.year} (${info.name}): ${matches.length} partidos (+${fresh.length}) · con córners ${withStats} · córners 1T ${withH1} · ${Math.round(bytes / 1024)} KB`);
}

// ---- Cuotas de cierre (football-data.co.uk) ----
const FD_COLS = ['Date', 'Time', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'HTHG', 'HTAG', 'HS', 'AS', 'HST', 'AST', 'HF', 'AF', 'HC', 'AC', 'HY', 'AY', 'HR', 'AR', 'AvgCH', 'AvgCD', 'AvgCA', 'AvgC>2.5', 'AvgC<2.5', 'AHCh', 'AvgCAHH', 'AvgCAHA', 'AvgH', 'AvgD', 'AvgA', 'Avg>2.5', 'Avg<2.5'];
const NEW_COLS = ['Date', 'Time', 'Home', 'Away', 'HG', 'AG', 'AvgCH', 'AvgCD', 'AvgCA', 'Season'];

function csv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head = lines.shift()?.split(',') || [];
  return lines.map((l) => {
    const v = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, v[i]]));
  });
}

async function footballData(c, now) {
  if (c.fd) {
    for (const season of ['2324', '2425', '2526', '2627']) {
      const rel = `futbol/cuotas/${c.fd}/${season}.json`;
      const old = readJson(rel);
      if (old?.complete) continue;
      const text = await get(`https://www.football-data.co.uk/mmz4281/${season}/${c.fd}.csv`, { as: 'text' }).catch(() => null);
      if (!text) continue;
      const rows = csv(text).filter((r) => r.HomeTeam);
      const endYear = 2000 + Number(season.slice(2));
      writeJson(rel, { fd: c.fd, season, complete: Date.UTC(endYear, 6, 1) < now, cols: FD_COLS, rows: rows.map((r) => FD_COLS.map((k) => (num(r[k]) ?? r[k] ?? null))) });
      log(`football-data ${c.fd} ${season}: ${rows.length} partidos`);
    }
  }
  if (c.fdNew) {
    const text = await get(`https://www.football-data.co.uk/new/${c.fdNew}.csv`, { as: 'text' }).catch(() => null);
    if (!text) return;
    const rows = csv(text).filter((r) => Number(r.Season) >= 2023 || /^202[3-9]/.test(r.Season || ''));
    writeJson(`futbol/cuotas/${c.fdNew}/todas.json`, { fd: c.fdNew, cols: NEW_COLS, rows: rows.map((r) => NEW_COLS.map((k) => (num(r[k]) ?? r[k] ?? null))) });
    log(`football-data ${c.fdNew}: ${rows.length} partidos desde 2023`);
  }
}

// ---- xG (Understat) ----
async function understat(c, now) {
  if (!c.us) return;
  for (const season of [2023, 2024, 2025, 2026]) {
    const rel = `futbol/xg/${c.us}/${season}.json`;
    const old = readJson(rel);
    if (old?.complete) continue;
    const data = await get(`https://understat.com/getLeagueData/${c.us}/${season}`, { headers: { 'x-requested-with': 'XMLHttpRequest', referer: `https://understat.com/league/${c.us}` } }).catch(() => null);
    const list = (data?.dates || []).filter((d) => d.isResult);
    if (!list.length) continue;
    writeJson(rel, {
      league: c.us,
      season,
      complete: Date.UTC(season + 1, 6, 1) < now,
      matches: list.map((d) => [d.datetime, d.h?.title, d.a?.title, num(d.goals?.h), num(d.goals?.a), num(d.xG?.h), num(d.xG?.a)]),
    });
    log(`Understat ${c.us} ${season}: ${list.length} partidos`);
  }
}

export async function futbol({ only = null, now = Date.now() } = {}) {
  for (const c of COMPETITIONS.filter((x) => !only || only.includes(x.code))) {
    for (const anchor of c.anchors) {
      try {
        await competitionSeason(c, anchor, now);
      } catch (e) {
        log(`${c.code} ${anchor}: ${e.message}`);
      }
    }
    await footballData(c, now).catch((e) => log(`football-data ${c.code}: ${e.message}`));
    await understat(c, now).catch((e) => log(`Understat ${c.code}: ${e.message}`));
  }
}
