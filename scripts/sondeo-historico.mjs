// Sondeo temporal: qué fuentes tienen partidos pasados con las estadísticas de cada
// mercado (fútbol, NBA, MLB), vistas desde GitHub Actions. Se borra antes de unir a main.
const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', accept: 'application/json,text/plain,*/*' };
async function get(url, { as = 'json', headers = {} } = {}) {
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    let body = t;
    if (as === 'json') {
      try {
        body = JSON.parse(t);
      } catch {
        body = null;
      }
    }
    return { status: r.status, body, len: t.length, text: as === 'json' ? '' : t };
  } catch (e) {
    return { status: 0, body: null, len: 0, error: String(e.message || e) };
  }
}
const short = (v, n = 300) => JSON.stringify(v)?.slice(0, n);
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

// ---- Fútbol en ESPN ----
const LEAGUES = [
  ['eng.1', '20250308'],
  ['per.1', '20250510'],
  ['usa.1', '20250510'],
  ['bra.1', '20250510'],
  ['nor.1', '20250511'],
  ['swe.1', '20250511'],
  ['bel.1', '20250308'],
  ['por.1', '20250308'],
  ['uefa.champions', '20250311'],
  ['uefa.europa', '20250313'],
  ['uefa.europa.conf', '20250313'],
  ['uefa.nations', '20250320'],
  ['fifa.world', '20221203'],
  ['fifa.friendly', '20250606'],
  ['fifa.worldq.uefa', '20250906'],
  ['fifa.worldq.conmebol', '20250904'],
  ['conmebol.libertadores', '20250507'],
];

async function espnSoccer() {
  console.log('\n===== ESPN fútbol =====');
  // Formas de pedir el calendario.
  for (const q of ['dates=20250308', 'dates=20250301-20250331', 'dates=20250301-20250307', 'limit=100&dates=20250308', 'dates=202503']) {
    const r = await get(`${ESPN}/soccer/eng.1/scoreboard?${q}`);
    console.log(`eng.1 ?${q}: HTTP ${r.status} · partidos ${r.body?.events?.length} · ${r.status >= 400 ? short(r.body, 200) : ''}`);
  }
  const core = await get('https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events?dates=20250301-20250331&limit=100');
  console.log(`core eng.1 marzo: HTTP ${core.status} · count ${core.body?.count} · items ${core.body?.items?.length} · ${short(core.body?.items?.[0], 150)}`);
  const sched = await get(`${ESPN}/soccer/eng.1/teams/359/schedule?season=2024`);
  console.log(`calendario de un equipo (Arsenal 2024): HTTP ${sched.status} · partidos ${sched.body?.events?.length} · ${short(sched.body?.events?.[0]?.competitions?.[0]?.competitors?.map((c) => [c.team?.displayName, c.score]), 200)}`);
  let samples = 0;
  for (const [lg, date] of LEAGUES) {
    const r = await get(`${ESPN}/soccer/${lg}/scoreboard?dates=${date}`);
    const evs = r.body?.events || [];
    const done = evs.filter((e) => e.status?.type?.completed);
    const e = done[0];
    const comp = e?.competitions?.[0];
    const stats = comp?.competitors?.[0]?.statistics?.map((s) => `${s.name}=${s.displayValue}`) || [];
    const details = comp?.details || [];
    const types = [...new Set(details.map((d) => d.type?.text))];
    console.log(`${lg} ${date}: HTTP ${r.status} · partidos ${evs.length} (terminados ${done.length}) · stats [${stats.join(', ')}] · detalles ${details.length} ${short(types, 200)} · linescores ${short(comp?.competitors?.map((c) => c.linescores), 120)} · odds ${short(comp?.odds?.[0], 200)}`);
    for (const y of ['2023', '2024']) {
      const back = lg === 'fifa.world' ? '20181203' : date.replace(/^2025/, y);
      const rb = await get(`${ESPN}/soccer/${lg}/scoreboard?dates=${back}`);
      const eb = rb.body?.events || [];
      const sb = eb.find((x) => x.status?.type?.completed)?.competitions?.[0]?.competitors?.[0]?.statistics?.length || 0;
      console.log(`   ${back}: HTTP ${rb.status} · partidos ${eb.length}, stats por equipo ${sb}`);
    }
    if (e && samples < 3 && ['eng.1', 'per.1', 'uefa.champions'].includes(lg)) {
      samples++;
      const s = await get(`${ESPN}/soccer/${lg}/summary?event=${e.id}`);
      const b = s.body || {};
      console.log(`   summary ${e.id}: HTTP ${s.status} · claves ${Object.keys(b).join(',')}`);
      for (const t of b.boxscore?.teams || []) console.log(`   boxscore ${t.team?.displayName}: ${(t.statistics || []).map((x) => `${x.name}=${x.displayValue}`).join(', ')}`);
      const com = b.commentary || [];
      const corners = com.filter((c) => /corner/i.test(c.text || ''));
      console.log(`   commentary ${com.length} · córners ${corners.length} · ejemplos ${short(corners.slice(0, 3).map((c) => [c.time?.displayValue, c.text]), 400)}`);
      const ke = b.keyEvents || [];
      console.log(`   keyEvents ${ke.length} · tipos ${short([...new Set(ke.map((k) => k.type?.text))], 400)}`);
      console.log(`   plays ${b.plays?.length} · tipos ${short([...new Set((b.plays || []).map((k) => k.type?.text))], 400)}`);
      console.log(`   odds/pickcenter ${short(b.pickcenter, 300)} | ${short(b.odds, 300)}`);
      console.log(`   header linescores ${short(b.header?.competitions?.[0]?.competitors?.map((c) => c.linescores), 200)}`);
    }
  }
}

// ---- football-data.co.uk ----
async function footballData() {
  console.log('\n===== football-data.co.uk =====');
  for (const code of ['E0', 'D1', 'I1', 'SP1', 'F1', 'P1', 'B1']) {
    for (const season of ['2324', '2425', '2526']) {
      const r = await get(`https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`, { as: 'text' });
      const lines = (r.text || '').split(/\r?\n/).filter(Boolean);
      console.log(`${code} ${season}: HTTP ${r.status} · filas ${Math.max(0, lines.length - 1)}${season === '2425' ? ` · columnas ${lines[0]?.slice(0, 900)}` : ''}`);
    }
  }
  for (const code of ['BRA', 'NOR', 'SWE', 'USA']) {
    const r = await get(`https://www.football-data.co.uk/new/${code}.csv`, { as: 'text' });
    const lines = (r.text || '').split(/\r?\n/).filter(Boolean);
    console.log(`${code}: HTTP ${r.status} · filas ${Math.max(0, lines.length - 1)} · columnas ${lines[0]?.slice(0, 400)} · última ${lines.at(-1)?.slice(0, 200)}`);
  }
}

// ---- Understat (xG) ----
async function understat() {
  console.log('\n===== Understat =====');
  for (const season of ['2023', '2024']) {
    const r = await get(`https://understat.com/getLeagueData/EPL/${season}`, { headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://understat.com/league/EPL' } });
    const dates = r.body?.dates || [];
    console.log(`EPL ${season}: HTTP ${r.status} · claves ${Object.keys(r.body || {}).join(',')} · partidos ${dates.length} · ejemplo ${short(dates[0], 300)}`);
  }
}

// ---- NBA en ESPN ----
async function nba() {
  console.log('\n===== ESPN NBA =====');
  for (const d of ['20230115', '20240115', '20250115']) {
    const r = await get(`${ESPN}/basketball/nba/scoreboard?dates=${d}`);
    const evs = r.body?.events || [];
    const e = evs[0];
    const c = e?.competitions?.[0];
    console.log(`${d}: partidos ${evs.length} · linescores ${short(c?.competitors?.map((x) => x.linescores?.map((l) => l.value)), 120)} · odds ${short(c?.odds?.[0], 250)}`);
    if (e && d === '20240115') {
      const s = await get(`${ESPN}/basketball/nba/summary?event=${e.id}`);
      const b = s.body || {};
      const pl = b.boxscore?.players?.[0]?.statistics?.[0];
      console.log(`   summary: claves ${Object.keys(b).join(',')} · labels ${short(pl?.labels, 200)} · atletas ${pl?.athletes?.length} · ejemplo ${short(pl?.athletes?.[0]?.stats, 150)}`);
      console.log(`   pickcenter ${short(b.pickcenter, 500)}`);
    }
  }
  // Rango de fechas en una llamada.
  const r = await get(`${ESPN}/basketball/nba/scoreboard?dates=20250101-20250131&limit=500`);
  console.log(`rango enero 2025: partidos ${r.body?.events?.length}`);
}

// ---- MLB ----
async function mlb() {
  console.log('\n===== MLB =====');
  const r = await get('https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2024&gameType=R&hydrate=probablePitcher,linescore');
  const games = (r.body?.dates || []).flatMap((d) => d.games || []);
  console.log(`2024: partidos ${games.length} · ejemplo ${short({ pk: games[0]?.gamePk, gameType: games[0]?.gameType, officialDate: games[0]?.officialDate, pp: games[0]?.teams?.home?.probablePitcher, ls: games[0]?.linescore?.innings?.length }, 300)}`);
  const e = await get(`${ESPN}/baseball/mlb/scoreboard?dates=20240715`);
  const ev = e.body?.events?.[0];
  console.log(`ESPN MLB 2024-07-15: partidos ${e.body?.events?.length} · odds ${short(ev?.competitions?.[0]?.odds?.[0], 300)}`);
  if (ev) {
    const s = await get(`${ESPN}/baseball/mlb/summary?event=${ev.id}`);
    console.log(`   pickcenter ${short(s.body?.pickcenter, 500)}`);
  }
}

await espnSoccer();
