// Ligas de fútbol que ESPN no tiene, de Sofascore (lista de "Ligas apostables"):
// data/historico/futbol/sofascore/<código>/<año>.json con el mismo formato de partido que
// ESPN (g, ls, s, c1) más el xG de Sofascore (s.x). Los equipos son ids de Sofascore;
// equipos.json une cada uno con su id de ESPN cuando el equipo también juega en una
// competición de ESPN, para que la historia del equipo sea una sola.
// Sofascore no responde desde GitHub Actions: se corre desde una sesión con internet.
// Uso: NODE_USE_ENV_PROXY=1 node scripts/historico/sofascore.mjs [--solo=eng.2,ger.2] [--equipos] [--amistosos]
// (sin opciones: todas las ligas, después los equipos y después los amistosos de clubes)
import { readJson, writeJson } from './comun.mjs';
import { listDir } from './repeticion/comun.mjs';
import { API, SOFA, findEvent, get, log, pool, seasonEvents, seasonStart, sofaEvents, statsOf } from './sofa.mjs';

const DAY = 86400000;
// Desde cuándo: como ESPN (temporada 2023-24).
const FROM = Date.UTC(2023, 6, 1);
// Terminado (100), tras prórroga (110) o tras penales (120).
const ENDED = new Set([100, 110, 120]);

// code: carpeta; ut: torneo de Sofascore; neutral: se juega en sede neutral.
export const LIGAS = [
  // Internacionales
  { code: 'uefa.euroq', ut: 27, name: 'Eliminatorias de la Eurocopa' },
  { code: 'conmebol.recopa', ut: 490, name: 'Recopa Sudamericana' },
  { code: 'concacaf.champions', ut: 498, name: 'Concacaf Champions Cup' },
  { code: 'concacaf.leagues', ut: 13783, name: 'Leagues Cup' },
  { code: 'concacaf.nations', ut: 14100, name: 'Concacaf Nations League' },
  { code: 'concacaf.gold', ut: 140, name: 'Copa Oro', neutral: true },
  { code: 'afc.champions', ut: 463, name: 'AFC Champions League Elite' },
  { code: 'afc.cl2', ut: 668, name: 'AFC Champions League Two' },
  { code: 'afc.asian', ut: 246, name: 'Copa Asiática', neutral: true },
  { code: 'caf.champions', ut: 1054, name: 'CAF Champions League' },
  { code: 'caf.confed', ut: 1115, name: 'CAF Confederation Cup' },
  { code: 'caf.nations', ut: 270, name: 'Copa Africana de Naciones', neutral: true },
  { code: 'fifa.cwc', ut: 357, name: 'Mundial de Clubes', neutral: true },
  { code: 'fifa.worldq.ic', ut: 10618, name: 'Repechaje intercontinental', neutral: true },
  // Sudamérica
  { code: 'arg.1', ut: 155, name: 'Liga Profesional (Argentina)' },
  { code: 'arg.copa_liga', ut: 13475, name: 'Copa de la Liga Profesional (Argentina)' },
  { code: 'arg.2', ut: 703, name: 'Primera Nacional (Argentina)' },
  { code: 'arg.3', ut: 1347, name: 'Primera B Metropolitana (Argentina)' },
  { code: 'arg.copa', ut: 1024, name: 'Copa Argentina' },
  { code: 'bol.1', ut: 16736, name: 'División Profesional (Bolivia)' },
  { code: 'bra.2', ut: 390, name: 'Brasileirão Série B' },
  { code: 'bra.3', ut: 1281, name: 'Brasileirão Série C' },
  { code: 'bra.copa', ut: 373, name: 'Copa do Brasil' },
  { code: 'bra.nordeste', ut: 1596, name: 'Copa do Nordeste' },
  { code: 'bra.paulista', ut: 372, name: 'Paulista' },
  { code: 'bra.carioca', ut: 92, name: 'Carioca' },
  { code: 'bra.gaucho', ut: 377, name: 'Gaúcho' },
  { code: 'bra.mineiro', ut: 379, name: 'Mineiro' },
  { code: 'bra.paranaense', ut: 382, name: 'Paranaense' },
  { code: 'bra.pernambucano', ut: 380, name: 'Pernambucano' },
  { code: 'bra.cearense', ut: 378, name: 'Cearense' },
  { code: 'bra.baiano', ut: 374, name: 'Baiano' },
  { code: 'bra.goiano', ut: 381, name: 'Goiano' },
  { code: 'bra.catarinense', ut: 376, name: 'Catarinense' },
  { code: 'chi.1', ut: 11653, name: 'Liga de Primera (Chile)' },
  { code: 'chi.2', ut: 1240, name: 'Liga de Ascenso (Chile)' },
  { code: 'chi.copa', ut: 1221, name: 'Copa Chile' },
  { code: 'col.1', ut: 11539, name: 'Primera A, Apertura (Colombia)' },
  { code: 'col.1f', ut: 11536, name: 'Primera A, Finalización (Colombia)' },
  { code: 'col.2', ut: 1238, name: 'Primera B (Colombia)' },
  { code: 'col.copa', ut: 1335, name: 'Copa Colombia' },
  { code: 'ecu.1', ut: 240, name: 'LigaPro Serie A (Ecuador)' },
  { code: 'ecu.2', ut: 10240, name: 'LigaPro Serie B (Ecuador)' },
  { code: 'ecu.copa', ut: 13684, name: 'Copa Ecuador' },
  { code: 'par.1', ut: 11541, name: 'División de Honor, Clausura (Paraguay)' },
  { code: 'par.1a', ut: 11540, name: 'División de Honor, Apertura (Paraguay)' },
  { code: 'par.copa', ut: 13614, name: 'Copa Paraguay' },
  { code: 'per.2', ut: 10297, name: 'Liga 2 (Perú)' },
  { code: 'per.copa', ut: 35067, name: 'Copa de la Liga (Perú)' },
  { code: 'uru.1', ut: 278, name: 'Primera División (Uruguay)' },
  { code: 'uru.2', ut: 1908, name: 'Segunda División (Uruguay)' },
  { code: 'uru.copa', ut: 18877, name: 'Copa AUF Uruguay' },
  { code: 'ven.1', ut: 231, name: 'Liga FUTVE (Venezuela)' },
  // Norte y Centroamérica
  { code: 'mex.1a', ut: 11621, name: 'Liga MX, Apertura' },
  { code: 'mex.1c', ut: 11620, name: 'Liga MX, Clausura' },
  { code: 'mex.2a', ut: 11611, name: 'Liga de Expansión MX, Apertura' },
  { code: 'mex.2c', ut: 11612, name: 'Liga de Expansión MX, Clausura' },
  { code: 'mex.w.a', ut: 13593, name: 'Liga MX Femenil, Apertura' },
  { code: 'mex.w.c', ut: 13592, name: 'Liga MX Femenil, Clausura' },
  { code: 'usa.usl', ut: 13363, name: 'USL Championship' },
  { code: 'usa.usl1', ut: 13362, name: 'USL League One' },
  { code: 'usa.open', ut: 495, name: 'US Open Cup' },
  { code: 'usa.nwsl', ut: 1690, name: 'NWSL' },
  { code: 'can.1', ut: 13470, name: 'Canadian Premier League' },
  { code: 'crc.1a', ut: 11535, name: 'Primera División, Apertura (Costa Rica)' },
  { code: 'crc.1c', ut: 11542, name: 'Primera División, Clausura (Costa Rica)' },
  { code: 'gua.1a', ut: 11619, name: 'Liga Nacional, Apertura (Guatemala)' },
  { code: 'gua.1c', ut: 11615, name: 'Liga Nacional, Clausura (Guatemala)' },
  { code: 'hon.1a', ut: 11613, name: 'Liga Nacional, Apertura (Honduras)' },
  { code: 'hon.1c', ut: 11614, name: 'Liga Nacional, Clausura (Honduras)' },
  { code: 'slv.1a', ut: 11537, name: 'Primera División, Apertura (El Salvador)' },
  { code: 'slv.1c', ut: 11532, name: 'Primera División, Clausura (El Salvador)' },
  { code: 'pan.1a', ut: 11534, name: 'LPF, Apertura (Panamá)' },
  { code: 'pan.1c', ut: 11533, name: 'LPF, Clausura (Panamá)' },
  // Europa
  { code: 'eng.2', ut: 18, name: 'Championship' },
  { code: 'eng.3', ut: 24, name: 'League One' },
  { code: 'eng.4', ut: 25, name: 'League Two' },
  { code: 'eng.5', ut: 173, name: 'National League' },
  { code: 'eng.6n', ut: 176, name: 'National League North' },
  { code: 'eng.6s', ut: 174, name: 'National League South' },
  { code: 'eng.fa', ut: 19, name: 'FA Cup' },
  { code: 'eng.league_cup', ut: 21, name: 'EFL Cup' },
  { code: 'eng.trophy', ut: 334, name: 'EFL Trophy' },
  { code: 'eng.w.1', ut: 1044, name: "Women's Super League" },
  { code: 'esp.2', ut: 54, name: 'LaLiga Hypermotion' },
  { code: 'esp.3', ut: 17073, name: 'Primera Federación' },
  { code: 'esp.copa', ut: 329, name: 'Copa del Rey' },
  { code: 'esp.w.1', ut: 1127, name: 'Liga F' },
  { code: 'ita.2', ut: 53, name: 'Serie B' },
  { code: 'ita.3a', ut: 11445, name: 'Serie C, Grupo A' },
  { code: 'ita.3b', ut: 11447, name: 'Serie C, Grupo B' },
  { code: 'ita.3c', ut: 11446, name: 'Serie C, Grupo C' },
  { code: 'ita.copa', ut: 328, name: 'Coppa Italia' },
  { code: 'ger.2', ut: 44, name: '2. Bundesliga' },
  { code: 'ger.3', ut: 491, name: '3. Liga' },
  { code: 'ger.4no', ut: 1083, name: 'Regionalliga Nordost' },
  { code: 'ger.4n', ut: 42, name: 'Regionalliga Nord' },
  { code: 'ger.4w', ut: 493, name: 'Regionalliga West' },
  { code: 'ger.4b', ut: 1085, name: 'Regionalliga Bayern' },
  { code: 'ger.4sw', ut: 1079, name: 'Regionalliga Südwest' },
  { code: 'ger.pokal', ut: 217, name: 'DFB-Pokal' },
  { code: 'ger.w.1', ut: 232, name: 'Frauen-Bundesliga' },
  { code: 'fra.2', ut: 182, name: 'Ligue 2' },
  { code: 'fra.3', ut: 183, name: 'National (Francia)' },
  { code: 'fra.copa', ut: 335, name: 'Coupe de France' },
  { code: 'fra.w.1', ut: 1139, name: 'Première Ligue' },
  { code: 'por.2', ut: 239, name: 'Liga Portugal 2' },
  { code: 'por.taca', ut: 336, name: 'Taça de Portugal' },
  { code: 'por.liga_cup', ut: 327, name: 'Taça da Liga' },
  { code: 'ned.1', ut: 37, name: 'Eredivisie' },
  { code: 'ned.2', ut: 131, name: 'Eerste Divisie' },
  { code: 'ned.copa', ut: 330, name: 'KNVB Beker' },
  { code: 'bel.2', ut: 9, name: 'Challenger Pro League' },
  { code: 'bel.copa', ut: 326, name: 'Copa de Bélgica' },
  { code: 'tur.1', ut: 52, name: 'Süper Lig' },
  { code: 'tur.2', ut: 98, name: '1. Lig (Turquía)' },
  { code: 'tur.copa', ut: 96, name: 'Copa de Turquía' },
  { code: 'sco.1', ut: 36, name: 'Premiership (Escocia)' },
  { code: 'sco.2', ut: 206, name: 'Championship (Escocia)' },
  { code: 'sco.3', ut: 207, name: 'League One (Escocia)' },
  { code: 'sco.4', ut: 209, name: 'League Two (Escocia)' },
  { code: 'sco.copa', ut: 347, name: 'Scottish Cup' },
  { code: 'sco.league_cup', ut: 332, name: 'Scottish League Cup' },
  { code: 'aut.1', ut: 45, name: 'Bundesliga (Austria)' },
  { code: 'aut.2', ut: 135, name: '2. Liga (Austria)' },
  { code: 'aut.copa', ut: 445, name: 'ÖFB-Cup' },
  { code: 'sui.1', ut: 215, name: 'Super League (Suiza)' },
  { code: 'sui.2', ut: 216, name: 'Challenge League (Suiza)' },
  { code: 'sui.copa', ut: 399, name: 'Copa Suiza' },
  { code: 'gre.1', ut: 185, name: 'Super League (Grecia)' },
  { code: 'gre.copa', ut: 375, name: 'Copa de Grecia' },
  { code: 'den.1', ut: 39, name: 'Superliga (Dinamarca)' },
  { code: 'den.2', ut: 47, name: '1st Division (Dinamarca)' },
  { code: 'den.copa', ut: 76, name: 'Copa de Dinamarca' },
  { code: 'swe.2', ut: 46, name: 'Superettan' },
  { code: 'swe.copa', ut: 80, name: 'Svenska Cupen' },
  { code: 'nor.2', ut: 22, name: '1. divisjon (Noruega)' },
  { code: 'nor.copa', ut: 29, name: 'Copa de Noruega' },
  { code: 'fin.1', ut: 41, name: 'Veikkausliiga' },
  { code: 'fin.2', ut: 55, name: 'Ykkösliiga' },
  { code: 'isl.1', ut: 188, name: 'Besta deild' },
  { code: 'pol.1', ut: 202, name: 'Ekstraklasa' },
  { code: 'pol.2', ut: 229, name: 'I Liga (Polonia)' },
  { code: 'pol.copa', ut: 281, name: 'Copa de Polonia' },
  { code: 'cze.1', ut: 172, name: '1. Liga (Chequia)' },
  { code: 'cze.2', ut: 205, name: 'FNL (Chequia)' },
  { code: 'cze.copa', ut: 282, name: 'Copa de Chequia' },
  { code: 'svk.1', ut: 211, name: 'Niké liga (Eslovaquia)' },
  { code: 'hun.1', ut: 187, name: 'NB I (Hungría)' },
  { code: 'rou.1', ut: 152, name: 'SuperLiga (Rumanía)' },
  { code: 'rou.2', ut: 562, name: 'Liga 2 (Rumanía)' },
  { code: 'rou.copa', ut: 355, name: 'Copa de Rumanía' },
  { code: 'bul.1', ut: 247, name: 'Parva Liga (Bulgaria)' },
  { code: 'cro.1', ut: 170, name: 'HNL (Croacia)' },
  { code: 'srb.1', ut: 210, name: 'Superliga (Serbia)' },
  { code: 'svn.1', ut: 212, name: 'PrvaLiga (Eslovenia)' },
  { code: 'bih.1', ut: 222, name: 'Premijer Liga (Bosnia y Herzegovina)' },
  { code: 'cyp.1', ut: 171, name: 'First Division (Chipre)' },
  { code: 'isr.1', ut: 266, name: "Ligat ha'Al (Israel)" },
  { code: 'irl.1', ut: 192, name: 'Premier Division (Irlanda)' },
  { code: 'irl.2', ut: 193, name: 'First Division (Irlanda)' },
  { code: 'nir.1', ut: 200, name: 'Premiership (Irlanda del Norte)' },
  { code: 'wal.1', ut: 254, name: 'Cymru Premier' },
  { code: 'ukr.1', ut: 218, name: 'Premier League (Ucrania)' },
  // Asia y Oceanía
  { code: 'jpn.1', ut: 196, name: 'J1 League' },
  { code: 'jpn.2', ut: 402, name: 'J2 League' },
  { code: 'jpn.3', ut: 2293, name: 'J3 League' },
  { code: 'jpn.copa', ut: 323, name: 'Copa del Emperador' },
  { code: 'jpn.liga_cup', ut: 101, name: 'J.League Cup' },
  { code: 'kor.1', ut: 410, name: 'K League 1' },
  { code: 'kor.2', ut: 777, name: 'K League 2' },
  { code: 'chn.1', ut: 649, name: 'Super League (China)' },
  { code: 'ksa.1', ut: 955, name: 'Saudi Pro League' },
  { code: 'ksa.copa', ut: 2058, name: "King's Cup (Arabia Saudí)" },
  { code: 'qat.1', ut: 825, name: 'Stars League (Qatar)' },
  { code: 'uae.1', ut: 971, name: 'Pro League (Emiratos Árabes)' },
  { code: 'ind.1', ut: 1900, name: 'Indian Super League' },
  { code: 'idn.1', ut: 1015, name: 'Super League (Indonesia)' },
  { code: 'tha.1', ut: 1032, name: 'Thai League 1' },
  { code: 'vie.1', ut: 626, name: 'V-League 1 (Vietnam)' },
  { code: 'mas.1', ut: 1000, name: 'Super League (Malasia)' },
  { code: 'aus.1', ut: 136, name: 'A-League Men' },
  { code: 'aus.w.1', ut: 1894, name: 'A-League Women' },
  { code: 'aus.copa', ut: 1786, name: 'Australia Cup' },
  // África
  { code: 'egy.1', ut: 808, name: 'Premier League (Egipto)' },
  { code: 'mar.1', ut: 937, name: 'Botola Pro (Marruecos)' },
  { code: 'alg.1', ut: 841, name: 'Ligue 1 (Argelia)' },
  { code: 'tun.1', ut: 984, name: 'Ligue 1 (Túnez)' },
  { code: 'rsa.1', ut: 358, name: 'Premiership (Sudáfrica)' },
  { code: 'rsa.copa', ut: 1020, name: 'Nedbank Cup' },
];
// Amistosos de clubes: solo los de equipos que juegan alguna de las ligas.
const AMISTOSOS = { code: 'club.friendly', ut: 853, name: 'Amistosos de clubes' };

const pair = (S, k) => (Number.isFinite(S.home[k]) && Number.isFinite(S.away[k]) ? [S.home[k], S.away[k]] : null);
const team = (t) => [String(t.id), t.name, t.nameCode || t.shortName || ''];

// Un partido de Sofascore en el formato de ESPN.
async function matchOf(e, neutral) {
  const S = { home: e.homeScore || {}, away: e.awayScore || {} };
  // Tras penales sin prórroga (ida y vuelta, Leagues Cup...) los 90 minutos son el final.
  const extra = e.status.code === 110 || (e.status.code === 120 && S.home.extra1 !== undefined);
  let ls = [pair(S, 'period1'), pair(S, 'period2')];
  if (extra) ls.push(pair(S, 'extra1') || [0, 0], pair(S, 'extra2') || [0, 0]);
  if (ls.some((p) => !p)) ls = null;
  const g = extra ? (ls ? ls.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]) : pair(S, 'display')) : pair(S, 'normaltime') || pair(S, 'display');
  if (!g) return null;
  const m = { id: `sf:${e.id}`, t: e.startTimestamp, st: extra ? (e.status.code === 120 ? 'PEN' : 'AET') : 'FT', n: neutral ? 1 : 0, h: team(e.homeTeam), a: team(e.awayTeam), g };
  if (ls) m.ls = ls;
  const per = statsOf(await get(`${API}/event/${e.id}/statistics`));
  const all = per.ALL || {};
  if (Object.keys(all).length) {
    // Sofascore no lista las tarjetas cuando no hubo: con el resto de las estadísticas, son 0.
    if (all.f && all.s) {
      all.y ||= [0, 0];
      all.r ||= [0, 0];
    }
    if (all.x) all.x = all.x.map((v) => Math.round(v * 100) / 100);
    m.s = all;
  }
  const c = per['1ST']?.c;
  if (c) m.c1 = [c[0], c[1], c[0] + c[1]];
  return m;
}

// Temporadas desde FROM de un torneo; keep(e) filtra los partidos antes de pedir sus estadísticas.
async function download(L, { keep = () => true, maxPages = 60, concurrency = 8 } = {}) {
  const seasons = ((await get(`${API}/unique-tournament/${L.ut}/seasons`))?.seasons || []).filter((s) => seasonStart(s.year) >= 2023);
  const summary = [];
  for (const s of seasons) {
    const rel = `futbol/sofascore/${L.code}/${seasonStart(s.year)}${seasons.filter((x) => seasonStart(x.year) === seasonStart(s.year)).length > 1 ? `-${s.id}` : ''}.json`;
    const old = readJson(rel);
    if (old?.complete) continue;
    const have = new Map((old?.matches || []).map((m) => [m.id, m]));
    const events = (await seasonEvents(L.ut, s.id, { maxPages, from: FROM })).filter((e) => ENDED.has(e.status.code) && e.startTimestamp * 1000 >= FROM && e.homeTeam && e.awayTeam);
    const fresh = events.filter((e) => !have.has(`sf:${e.id}`) && keep(e));
    await pool(
      fresh,
      async (e) => {
        const m = await matchOf(e, L.neutral);
        if (m) have.set(m.id, m);
      },
      concurrency,
    );
    if (!have.size) continue;
    const next = await get(`${API}/unique-tournament/${L.ut}/season/${s.id}/events/next/0`);
    const last = Math.max(...[...have.values()].map((m) => m.t)) * 1000;
    const complete = !next?.events?.length && Date.now() - last > 3 * DAY;
    const matches = [...have.values()].sort((a, b) => a.t - b.t);
    const bytes = writeJson(rel, { source: 'sofascore', code: L.code, ut: L.ut, name: L.name, season: { id: s.id, name: s.name, year: s.year }, complete, updated: new Date().toISOString(), matches });
    summary.push(`${s.year}: ${matches.length} (${matches.filter((m) => m.s?.c).length} con córners, ${(bytes / 1024).toFixed(0)} kB)`);
  }
  log(`${L.code} ${L.name}: ${summary.join(' · ') || 'sin temporadas nuevas'}`);
}

// Equipo de Sofascore → equipo de ESPN, por los partidos de ESPN que están en Sofascore.
async function teams() {
  const votes = new Map();
  const vote = (sofa, espn, name) => {
    const v = votes.get(sofa) || votes.set(sofa, new Map()).get(sofa);
    const k = `${espn}|${name}`;
    v.set(k, (v.get(k) || 0) + 1);
  };
  for (const [code, ut] of Object.entries(SOFA)) {
    let found = 0;
    let total = 0;
    for (const f of listDir(`futbol/espn/${code}`)) {
      const ms = readJson(`futbol/espn/${code}/${f}`).matches.filter((m) => Array.isArray(m.g));
      if (!ms.length) continue;
      const from = Math.min(...ms.map((m) => m.t)) * 1000 - 2 * DAY;
      const to = Math.max(...ms.map((m) => m.t)) * 1000 + 2 * DAY;
      const events = await sofaEvents(ut, from, to);
      for (const m of ms) {
        total++;
        const hit = findEvent(m, events);
        if (!hit) continue;
        found++;
        const [h, a] = hit.swapped ? [hit.e.awayTeam, hit.e.homeTeam] : [hit.e.homeTeam, hit.e.awayTeam];
        vote(String(h.id), m.h[0], m.h[1]);
        vote(String(a.id), m.a[0], m.a[1]);
      }
    }
    log(`equipos ${code}: ${found} de ${total} partidos de ESPN encontrados en Sofascore`);
  }
  const out = {};
  for (const [sofa, v] of votes) {
    const [[best, n]] = [...v].sort((a, b) => b[1] - a[1]);
    const all = [...v.values()].reduce((s, x) => s + x, 0);
    if (n >= 2 && n / all >= 0.8) {
      const [espn, name] = best.split('|');
      out[sofa] = [espn, name];
    }
  }
  writeJson('futbol/sofascore/equipos.json', { updated: new Date().toISOString(), teams: out });
  log(`equipos: ${Object.keys(out).length} equipos de Sofascore unidos con ESPN`);
  return out;
}

// Ids de Sofascore de los equipos que juegan alguna liga (de Sofascore o de ESPN).
function knownTeams() {
  const ids = new Set(Object.keys(readJson('futbol/sofascore/equipos.json')?.teams || {}));
  for (const L of LIGAS) for (const f of listDir(`futbol/sofascore/${L.code}`)) for (const m of readJson(`futbol/sofascore/${L.code}/${f}`).matches) ids.add(m.h[0]).add(m.a[0]);
  return ids;
}

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}`));
const only = arg('solo=')?.slice(7).split(',') || null;
const all = !only && !arg('equipos') && !arg('amistosos');
if (only || all) await pool(LIGAS.filter((L) => !only || only.includes(L.code)), (L) => download(L).catch((e) => log(`${L.code}: ${e.message}`)), 3);
if (all || arg('equipos')) await teams();
if (all || arg('amistosos')) {
  const known = knownTeams();
  await download(AMISTOSOS, { keep: (e) => known.has(String(e.homeTeam.id)) && known.has(String(e.awayTeam.id)), maxPages: 2000 });
}
