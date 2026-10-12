// SONDEO TEMPORAL (se borra antes de unir a main): formatos reales de los
// mercados de jugador de Apuesta Total y de las estadísticas por jugador de
// Flashscore y ESPN, que solo responden desde servidores con acceso.
import { getSportDay, getMatchFeeds } from '../extension/sources/flashscore.js';

const AT = 'https://prod20392.kmianko.com';
const cut = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
const log = (...a) => console.log(...a);

async function json(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', ...headers }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// ---------------- Apuesta Total ----------------
async function apuestaTotal() {
  log('\n======== APUESTA TOTAL ========');
  const page = await fetch(`${AT}/es-pe/spbkv3?operatorToken=logout`, { signal: AbortSignal.timeout(25000) });
  const jar = {};
  for (const c of page.headers.getSetCookie()) {
    const pair = c.split(';')[0];
    jar[pair.slice(0, pair.indexOf('='))] = pair.slice(pair.indexOf('=') + 1);
  }
  const headers = { 'time-area': '01', ...(jar.authorization ? { authorization: jar.authorization, session: jar.session } : {}) };
  const snap = await json(`${AT}/api/pulse/snapshot/events?lang=ES-PE&t=hPNl`);
  const now = Date.now();
  const basket = snap.filter((e) => e.Type === 'Fixture' && /baloncesto/i.test(e.SportName || '') && e.StartEventDate > now && e.StartEventDate < now + 4 * 86400000);
  const byLeague = {};
  for (const e of basket) byLeague[`${e.RegionName} | ${e.LeagueName}`] = (byLeague[`${e.RegionName} | ${e.LeagueName}`] || 0) + 1;
  log('Básquet próximos 4 días por liga:', JSON.stringify(byLeague));
  if (basket[0]) log('Campos de un evento:', Object.keys(basket[0]).join(', '), '\nEjemplo:', cut(JSON.stringify(basket[0]), 1500));
  const prefer = (e) => (/nba|wnba/i.test(e.LeagueName) ? 0 : /euroliga|euroleague|acb|liga endesa/i.test(e.LeagueName) ? 1 : 2);
  const chosen = [];
  const leagues = new Set();
  for (const e of basket.sort((a, b) => prefer(a) - prefer(b) || (b.MarketsCount || 0) - (a.MarketsCount || 0))) {
    if (leagues.has(e.LeagueName)) continue;
    leagues.add(e.LeagueName);
    chosen.push(e);
    if (chosen.length >= 3) break;
  }
  const types = [];
  for (const p of ['ML', 'OU', 'HC', 'QA']) for (let i = 0; i < 1000; i++) types.push(`${p}${i}`);
  for (const e of chosen) {
    log(`\n--- ${e.LeagueName} (${e.RegionName}): ${e.Participants?.map((x) => x.Name).join(' vs ')} · id ${e._id}`);
    const found = new Map();
    for (let j = 0; j < types.length; j += 60) {
      const q = encodeURIComponent(`${e._id}:${types.slice(j, j + 60).join('|')}`);
      try {
        const data = await json(`${AT}/api/eventlist/eu/markets/all?markets=${q}`, headers);
        for (const m of Array.isArray(data) ? data : []) {
          const key = `${m.MarketType?._id}|${m.Name}`;
          if (!found.has(key)) found.set(key, m);
        }
      } catch (err) {
        log('error', err.message);
      }
    }
    log(`Mercados distintos: ${found.size}`);
    for (const [key, m] of [...found].sort()) {
      const sels = (m.Selections || []).slice(0, 4).map((s) => `{Name:${cut(s.Name, 60)} | Betslip:${cut(s.BetslipLine, 60)} | QA1:${s.QAParam1 ?? ''} | QA2:${s.QAParam2 ?? ''} | Out:${s.OutcomeType ?? ''} | Side:${s.Side ?? ''} | ${s.DisplayOdds?.Decimal ?? s.TrueOdds}}`);
      log(`${key} [${(m.Selections || []).length} sel] ${sels.join(' ')}`);
    }
    const sample = [...found.values()].find((m) => /jugador|player|puntos de|rebotes de|asistencias de/i.test(`${m.Name} ${m.MarketType?.Name}`));
    if (sample) log('Mercado de jugador completo:', cut(JSON.stringify(sample), 3000));
  }
}

// ---------------- Flashscore ----------------
async function flashscore() {
  log('\n======== FLASHSCORE ========');
  const done = [];
  for (const day of [-1, -2, -3]) {
    try {
      const { items } = await getSportDay({ sport: 'basketball', day });
      const fin = items.filter((e) => e.state === 'finalizado');
      const leagues = {};
      for (const e of fin) leagues[e.tournament?.name || '?'] = (leagues[e.tournament?.name || '?'] || 0) + 1;
      log(`Día ${day}: ${fin.length} terminados`, cut(JSON.stringify(leagues), 800));
      done.push(...fin);
    } catch (err) {
      log('día', day, err.message);
    }
  }
  const pickBy = (re) => done.find((e) => re.test(`${e.category?.name} ${e.tournament?.name}`));
  const sample = [pickBy(/nba|wnba/i), pickBy(/euroliga|euroleague/i), pickBy(/espa|acb/i), done[0]].filter(Boolean);
  const kinds = ['st', 'sui', 'li', 'lu', 'ps', 'pst', 'plst', 'ls', 'lsp', 'pl', 'psp', 'tps', 'sp', 'ss', 'hp', 'dps'];
  for (const e of [...new Set(sample)].slice(0, 3)) {
    log(`\n--- ${e.category?.name} · ${e.tournament?.name}: ${e.home.name} vs ${e.away.name} (${e.id})`);
    const f = await getMatchFeeds({ fsId: e.id, kinds });
    for (const k of kinds) log(`df_${k}: ${f[k] == null ? 'null' : `${f[k].length} car. ${cut(f[k], k === 'li' || k === 'ps' || k === 'lu' ? 1500 : 300)}`}`);
  }
}

// ---------------- ESPN ----------------
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball';
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
async function espn() {
  log('\n======== ESPN ========');
  for (const league of ['nba', 'wnba']) {
    let game = null;
    for (let back = 0; back < 220 && !game; back += back < 14 ? 1 : 7) {
      const d = new Date(Date.now() - back * 86400000);
      try {
        const sb = await json(`${ESPN}/${league}/scoreboard?dates=${ymd(d)}`);
        const evs = sb.events || [];
        if (back === 0) log(`${league} hoy: ${evs.length} partidos`, cut(evs.map((x) => `${x.name} [${x.status?.type?.name}] ${x.season?.type}`).join(' | '), 600));
        game = evs.find((x) => x.status?.type?.completed);
        if (game) log(`${league}: último terminado ${ymd(d)} ${game.name} id ${game.id}`);
      } catch (err) {
        log(league, err.message);
        break;
      }
    }
    if (!game) continue;
    const sum = await json(`${ESPN}/${league}/summary?event=${game.id}`);
    log('summary keys:', Object.keys(sum).join(', '));
    const p = sum.boxscore?.players?.[0];
    if (p) {
      log('team:', cut(JSON.stringify(p.team), 300));
      const st = p.statistics?.[0];
      log('statistics keys:', Object.keys(st || {}).join(', '));
      log('names:', JSON.stringify(st?.names), '\nkeys:', JSON.stringify(st?.keys), '\nlabels:', JSON.stringify(st?.labels));
      for (const a of (st?.athletes || []).slice(0, 2)) log('athlete:', cut(JSON.stringify(a), 900));
    }
    const team = sum.boxscore?.teams?.[0]?.team;
    if (team?.id) {
      for (const q of ['', '?seasontype=2', '?seasontype=1']) {
        try {
          const sch = await json(`${ESPN}/${league}/teams/${team.id}/schedule${q}`);
          const evs = sch.events || [];
          log(`schedule ${team.displayName}${q}: ${evs.length} partidos; temporada ${cut(JSON.stringify(sch.season || sch.requestedSeason), 200)}; último: ${cut(JSON.stringify(evs.filter((x) => x.competitions?.[0]?.status?.type?.completed).slice(-1)[0]), 700)}`);
        } catch (err) {
          log('schedule', q, err.message);
        }
      }
      try {
        const roster = await json(`${ESPN}/${league}/teams/${team.id}/roster`);
        log('roster:', cut(JSON.stringify((roster.athletes || []).slice(0, 2)), 800));
      } catch (err) {
        log('roster', err.message);
      }
    }
    const aid = p?.statistics?.[0]?.athletes?.[0]?.athlete?.id;
    if (aid) {
      try {
        const gl = await json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/${league}/athletes/${aid}/gamelog`);
        log('gamelog keys:', Object.keys(gl).join(', '), '\nnames:', JSON.stringify(gl.names || gl.labels), '\n', cut(JSON.stringify(gl.seasonTypes?.[0]), 900));
      } catch (err) {
        log('gamelog', err.message);
      }
    }
  }
}

for (const [name, fn] of [['Apuesta Total', apuestaTotal], ['Flashscore', flashscore], ['ESPN', espn]]) {
  try {
    await fn();
  } catch (err) {
    log(`${name} ERROR: ${err.stack || err.message}`);
  }
}
