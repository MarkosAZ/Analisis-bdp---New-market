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

// ---- Fútbol en ESPN: calendario de la temporada, medio tiempo y córners por tiempo ----
async function espnSoccer() {
  console.log('\n===== ESPN fútbol: calendario y resumen =====');
  for (const [lg, date] of [['eng.1', '20231007'], ['per.1', '20240414'], ['usa.1', '20240518'], ['uefa.champions', '20231024'], ['nor.1', '20240512'], ['fifa.world', '20260620'], ['uefa.euro', '20240620'], ['conmebol.america', '20240625']]) {
    const t0 = Date.now();
    const r = await get(`${ESPN}/soccer/${lg}/scoreboard?dates=${date}`);
    const ms = Date.now() - t0;
    const L = r.body?.leagues?.[0];
    const cal = L?.calendar || [];
    console.log(`${lg} ${date}: HTTP ${r.status} (${ms} ms) · partidos ${r.body?.events?.length} · temporada ${short(L?.season, 200)} · calendario ${cal.length} ${short(cal.slice(0, 3), 200)} … ${short(cal.slice(-2), 120)} · calendarType ${L?.calendarType}`);
    const e = (r.body?.events || []).find((x) => x.status?.type?.completed);
    if (!e) continue;
    const c = e.competitions[0];
    console.log(`   evento ${e.id} ${e.date} · ${c.competitors.map((x) => `${x.homeAway}:${x.team?.id}:${x.team?.displayName}:${x.score}`).join(' | ')} · detalles ${short(c.details?.slice(0, 2).map((d) => ({ type: d.type?.text, clock: d.clock, team: d.team?.id, red: d.redCard, yellow: d.yellowCard, own: d.ownGoal, pen: d.penaltyKick })), 400)}`);
    const s = await get(`${ESPN}/soccer/${lg}/summary?event=${e.id}`);
    const b = s.body || {};
    const com = b.commentary || [];
    const ht = com.findIndex((x) => /first half ends|half-time|halftime/i.test(x.text || ''));
    const corners = com.filter((x) => /^corner,/i.test(x.text || ''));
    const h1 = ht >= 0 ? com.slice(0, ht).filter((x) => /^corner,/i.test(x.text || '')).length : null;
    console.log(`   resumen: linescores ${short(b.header?.competitions?.[0]?.competitors?.map((x) => [x.homeAway, x.linescores?.map((l) => l.displayValue)]), 150)} · commentary ${com.length} (orden ${short(com.slice(0, 2).map((x) => [x.sequence, x.time?.displayValue]), 120)}) · fin 1T idx ${ht} ${short(com[ht]?.text, 80)} · córners ${corners.length} (1T ${h1}) · boxscore ${short(b.boxscore?.teams?.map((t) => t.statistics?.filter((x) => ['wonCorners', 'yellowCards', 'redCards'].includes(x.name)).map((x) => `${x.name}=${x.displayValue}`)), 300)}`);
    console.log(`   gameInfo ${short(b.gameInfo, 200)} · odds ${short(b.odds?.[0], 300)}`);
  }
  // NBA: calendario de la temporada.
  const n = await get(`${ESPN}/basketball/nba/scoreboard?dates=20241105`);
  const NL = n.body?.leagues?.[0];
  console.log(`NBA calendario ${NL?.calendar?.length} ${short(NL?.calendar?.slice?.(0, 3), 200)} · temporada ${short(NL?.season, 200)}`);
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
