// Utilidades de la API de Sofascore para completar.mjs y sofascore.mjs.
// Sofascore no responde desde GitHub Actions: estos scripts se corren desde una sesión
// con internet (NODE_USE_ENV_PROXY=1 si hay proxy).
import { similar } from './repeticion/futbol.mjs';
export { pool } from './comun.mjs';

export const API = 'https://api.sofascore.com/api/v1';
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', referer: 'https://www.sofascore.com/', accept: 'application/json' };

// Competición de ESPN → torneo de Sofascore.
export const SOFA = {
  'eng.1': 17, 'esp.1': 8, 'ger.1': 35, 'ita.1': 23, 'fra.1': 34, 'por.1': 238, 'bel.1': 38, 'usa.1': 242, 'bra.1': 325, 'nor.1': 20, 'swe.1': 40, 'per.1': 406,
  'uefa.champions': 7, 'uefa.europa': 679, 'uefa.europa.conf': 17015, 'conmebol.libertadores': 384, 'conmebol.sudamericana': 480,
  'uefa.nations': 10783, 'uefa.euro': 1, 'conmebol.america': 133, 'fifa.world': 16, 'fifa.friendly': 851,
  'fifa.worldq.uefa': 11, 'fifa.worldq.conmebol': 295, 'fifa.worldq.concacaf': 14, 'fifa.worldq.caf': 13, 'fifa.worldq.afc': 308,
};
// Estadística de Sofascore → código de los archivos de partidos.
export const KEYS = { 'Corner kicks': 'c', 'Total shots': 's', 'Shots on target': 't', Fouls: 'f', 'Yellow cards': 'y', 'Red cards': 'r', 'Ball possession': 'p', Offsides: 'o', 'Goalkeeper saves': 'v', 'Expected goals': 'x' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// GET con reintentos; 404 → null; null también si no responde tras los reintentos.
export async function get(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (r.ok) return r.json();
      if (r.status === 404) return null;
    } catch {
      // red: reintento
    }
    await sleep(1500 * 2 ** i);
  }
  return null;
}

// Año en que empieza una temporada de Sofascore ("25/26" → 2025, "2026" → 2026).
export function seasonStart(year) {
  const m = String(year || '').match(/^(\d{2,4})/);
  if (!m) return null;
  return m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
}

// Partidos terminados de una temporada, del más nuevo al más viejo.
export async function seasonEvents(ut, seasonId, { maxPages = 60, from = 0 } = {}) {
  const list = [];
  for (let p = 0; p < maxPages; p++) {
    const j = await get(`${API}/unique-tournament/${ut}/season/${seasonId}/events/last/${p}`);
    if (!j?.events?.length) break;
    list.push(...j.events.filter((e) => e.status?.type === 'finished'));
    if (!j.hasNextPage || j.events.every((e) => e.startTimestamp * 1000 < from)) break;
  }
  return list;
}

// Partidos terminados de un torneo entre dos fechas (todas las temporadas que tocan).
const seasonCache = new Map();
export async function sofaEvents(ut, from, to) {
  const seasons = (await get(`${API}/unique-tournament/${ut}/seasons`))?.seasons || [];
  const out = [];
  for (const s of seasons) {
    const key = `${ut}|${s.id}`;
    if (!seasonCache.has(key)) seasonCache.set(key, await seasonEvents(ut, s.id, { from }));
    const list = seasonCache.get(key);
    out.push(...list.filter((e) => e.startTimestamp * 1000 >= from && e.startTimestamp * 1000 <= to));
    // Las temporadas vienen de la más nueva a la más vieja: si esta ya es anterior, basta.
    if (list.length && Math.max(...list.map((e) => e.startTimestamp * 1000)) < from) break;
  }
  return out;
}

// El partido de Sofascore de un partido de ESPN: mismo día (±36 h), mismo marcador y nombres parecidos.
export function findEvent(m, events) {
  let best = null;
  for (const e of events) {
    if (Math.abs(e.startTimestamp - m.t) > 36 * 3600) continue;
    const hs = e.homeScore?.current;
    const as = e.awayScore?.current;
    for (const swapped of [false, true]) {
      const [h, a] = swapped ? [e.awayTeam.name, e.homeTeam.name] : [e.homeTeam.name, e.awayTeam.name];
      const [gh, ga] = swapped ? [as, hs] : [hs, as];
      if (gh !== m.g[0] || ga !== m.g[1]) continue;
      const s = similar(m.h[1], h) + similar(m.a[1], a);
      if (s >= 1 && (!best || s > best.s)) best = { e, swapped, s };
    }
  }
  return best;
}

// Estadísticas por periodo (ALL, 1ST, 2ND) de /event/{id}/statistics.
export function statsOf(j, swapped = false) {
  const per = {};
  for (const p of j?.statistics || []) {
    const out = {};
    for (const it of p.groups.flatMap((g) => g.statisticsItems)) {
      const k = KEYS[it.name];
      if (!k || out[k]) continue;
      const h = Number(it.homeValue ?? it.home);
      const a = Number(it.awayValue ?? it.away);
      if (Number.isFinite(h) && Number.isFinite(a)) out[k] = swapped ? [a, h] : [h, a];
    }
    per[p.period] = out;
  }
  return per;
}
