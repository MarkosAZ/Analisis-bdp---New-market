// NBA histórica (ESPN): marcador por cuarto y estadísticas de cada jugador por partido.
// Un archivo por temporada en data/historico/nba.
import { DAY, get, log, num, pool, readJson, writeJson } from './comun.mjs';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
// Un día de cada temporada desde 2010-11 (2011-12 y 2020-21 empezaron en diciembre).
const ANCHORS = ['20101105', '20120105', '20121105', '20131105', '20141105', '20151105', '20161105', '20171105', '20181105', '20191105', '20210105', '20211105', '20221105', '20231105', '20241105', '20251105', '20261025'];
// Mismo orden que PLAYER_FIELDS de docs/js/data-format.js.
export const FIELDS = ['min', 'pts', 'reb', 'ast', 'tpm', 'stl', 'blk', 'tov', 'oreb', 'dreb', 'ftm', 'fgm', 'fga', 'tpa', 'fta'];

const made = (v) => num(String(v ?? '').split('-')[0]);
const att = (v) => num(String(v ?? '').split('-')[1]);

// Jugadores de un equipo en el box score: [id, nombre, titular, ...FIELDS].
function playersOf(block) {
  const st = block?.statistics?.[0];
  const labels = st?.labels || [];
  const ix = (k) => labels.indexOf(k);
  return (st?.athletes || [])
    .filter((a) => !a.didNotPlay && a.stats?.length)
    .map((a) => {
      const v = (k) => a.stats[ix(k)];
      const row = { min: num(v('MIN')), pts: num(v('PTS')), reb: num(v('REB')), ast: num(v('AST')), tpm: made(v('3PT')), stl: num(v('STL')), blk: num(v('BLK')), tov: num(v('TO')), oreb: num(v('OREB')), dreb: num(v('DREB')), ftm: made(v('FT')), fgm: made(v('FG')), fga: att(v('FG')), tpa: att(v('3PT')), fta: att(v('FT')) };
      return [String(a.athlete?.id || ''), a.athlete?.displayName || '', a.starter ? 1 : 0, ...FIELDS.map((f) => row[f])];
    });
}

async function gameOf(ev) {
  const comp = ev.competitions?.[0];
  const hc = comp?.competitors?.find((c) => c.homeAway === 'home');
  const ac = comp?.competitors?.find((c) => c.homeAway === 'away');
  if (!hc || !ac) return null;
  const s = await get(`${ESPN}/summary?event=${ev.id}`).catch(() => null);
  const box = s?.boxscore?.players || [];
  const pl = (c) => playersOf(box.find((b) => String(b.team?.id) === String(c.team?.id)));
  return {
    id: String(ev.id),
    t: Math.round(Date.parse(ev.date) / 1000),
    ty: ev.season?.type ?? null,
    h: [String(hc.team?.id), hc.team?.abbreviation, hc.team?.displayName],
    a: [String(ac.team?.id), ac.team?.abbreviation, ac.team?.displayName],
    g: [num(hc.score), num(ac.score)],
    q: [(hc.linescores || []).map((l) => num(l.value)), (ac.linescores || []).map((l) => num(l.value))],
    p: [pl(hc), pl(ac)],
  };
}

export async function nba({ now = Date.now() } = {}) {
  for (const anchor of ANCHORS) {
    const sb = await get(`${ESPN}/scoreboard?dates=${anchor}`).catch(() => null);
    const L = sb?.leagues?.[0];
    if (!L?.season) continue;
    const year = L.season.year;
    const rel = `nba/${year}.json`;
    const old = readJson(rel);
    if (old?.complete) {
      log(`NBA ${year}: ya descargada (${old.games.length})`);
      continue;
    }
    const end = Date.parse(L.season.endDate);
    const have = new Map((old?.games || []).map((g) => [g.id, g]));
    const days = (L.calendar || []).map((d) => String(d).slice(0, 10).replace(/-/g, '')).filter((d) => Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`) < now - DAY);
    const events = new Map();
    await pool(
      days,
      async (d) => {
        const r = await get(`${ESPN}/scoreboard?dates=${d}`).catch(() => null);
        // Temporada regular (2), playoffs (3) y play-in (5); sin pretemporada ni Juego de Estrellas.
        for (const ev of r?.events || []) if (ev.status?.type?.completed && [2, 3, 5].includes(ev.season?.type) && !have.has(String(ev.id))) events.set(String(ev.id), ev);
      },
      6,
    );
    const fresh = (await pool([...events.values()], (ev) => gameOf(ev).catch(() => null), 6)).filter(Boolean);
    const games = [...have.values(), ...fresh].sort((a, b) => a.t - b.t);
    const bytes = writeJson(rel, { year, name: L.season.displayName, complete: end < now - 3 * DAY, fields: FIELDS, games });
    log(`NBA ${year} (${L.season.displayName}): ${games.length} partidos (+${fresh.length}) · con jugadores ${games.filter((g) => g.p[0].length && g.p[1].length).length} · ${Math.round(bytes / 1024)} KB`);
  }
}
