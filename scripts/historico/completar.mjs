// Completa los partidos de fútbol de ESPN (data/historico/futbol/espn) con Sofascore:
// córners, tarjetas, remates, tiros al arco y faltas del partido y córners del 1.er
// tiempo que ESPN no trae (Bélgica, Noruega, Suecia y Perú sin relato, amistosos,
// eliminatorias...). Solo rellena lo que falta; no cambia lo de ESPN. Cada partido
// completado guarda el id de Sofascore (sf) y qué se rellenó (fill).
// Sofascore no responde desde GitHub Actions: se corre desde una sesión con internet.
// Uso: NODE_USE_ENV_PROXY=1 node scripts/historico/completar.mjs [--solo=per.1,bel.1]
import fs from 'node:fs';
import path from 'node:path';
import { similar } from './repeticion/futbol.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../data/historico/futbol/espn');
const API = 'https://api.sofascore.com/api/v1';
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', referer: 'https://www.sofascore.com/', accept: 'application/json' };
// Competición de ESPN → torneo de Sofascore.
const SOFA = {
  'eng.1': 17, 'esp.1': 8, 'ger.1': 35, 'ita.1': 23, 'fra.1': 34, 'por.1': 238, 'bel.1': 38, 'usa.1': 242, 'bra.1': 325, 'nor.1': 20, 'swe.1': 40, 'per.1': 406,
  'uefa.champions': 7, 'uefa.europa': 679, 'uefa.europa.conf': 17015, 'conmebol.libertadores': 384, 'conmebol.sudamericana': 480,
  'uefa.nations': 10783, 'uefa.euro': 1, 'conmebol.america': 133, 'fifa.world': 16, 'fifa.friendly': 851,
  'fifa.worldq.uefa': 11, 'fifa.worldq.conmebol': 295, 'fifa.worldq.concacaf': 14, 'fifa.worldq.caf': 13, 'fifa.worldq.afc': 308,
};
// Estadística de Sofascore → código del archivo de ESPN.
const KEYS = { 'Corner kicks': 'c', 'Total shots': 's', 'Shots on target': 't', Fouls: 'f', 'Yellow cards': 'y', 'Red cards': 'r' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
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
async function pool(items, fn, n = 4) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ¿Qué le falta a un partido? (0-0 en córners, remates o tiros al arco es dato que falta.)
const zero = (v) => !Array.isArray(v) || v[0] + v[1] === 0;
function missing(m) {
  const out = [];
  const extra = /AET|PEN/i.test(m.st || '');
  if (!extra) {
    for (const k of ['c', 's', 't']) if (zero(m.s?.[k])) out.push(k);
    for (const k of ['f', 'y', 'r']) if (!Array.isArray(m.s?.[k])) out.push(k);
  }
  if (!m.c1) out.push('c1');
  return out;
}

// Partidos terminados de un torneo de Sofascore entre dos fechas (todas las temporadas que tocan).
const seasonCache = new Map();
async function sofaEvents(ut, from, to) {
  const seasons = (await get(`${API}/unique-tournament/${ut}/seasons`))?.seasons || [];
  const out = [];
  for (const s of seasons) {
    const key = `${ut}|${s.id}`;
    if (!seasonCache.has(key)) {
      const list = [];
      for (let p = 0; p < 60; p++) {
        const j = await get(`${API}/unique-tournament/${ut}/season/${s.id}/events/last/${p}`);
        if (!j?.events?.length) break;
        list.push(...j.events.filter((e) => e.status?.type === 'finished'));
        if (!j.hasNextPage || j.events.every((e) => e.startTimestamp * 1000 < from)) break;
      }
      seasonCache.set(key, list);
    }
    const list = seasonCache.get(key);
    out.push(...list.filter((e) => e.startTimestamp * 1000 >= from && e.startTimestamp * 1000 <= to));
    // Las temporadas vienen de la más nueva a la más vieja: si esta ya es anterior, basta.
    if (list.length && Math.max(...list.map((e) => e.startTimestamp * 1000)) < from) break;
  }
  return out;
}

// El partido de Sofascore de un partido de ESPN: mismo día (±36 h), mismo marcador y nombres parecidos.
function findEvent(m, events) {
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

function statsOf(j, swapped) {
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

const only = process.argv.find((a) => a.startsWith('--solo='))?.slice(7).split(',') || null;
const total = { matches: 0, need: 0, found: 0, filled: {} };
for (const code of Object.keys(SOFA).filter((c) => !only || only.includes(c))) {
  if (!fs.existsSync(path.join(ROOT, code))) continue;
  for (const f of fs.readdirSync(path.join(ROOT, code)).sort()) {
    const file = path.join(ROOT, code, f);
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const need = d.matches.filter((m) => !m.sf && missing(m).length);
    total.matches += d.matches.length;
    if (!need.length) continue;
    total.need += need.length;
    const from = Math.min(...need.map((m) => m.t)) * 1000 - 2 * 86400000;
    const to = Math.max(...need.map((m) => m.t)) * 1000 + 2 * 86400000;
    const events = await sofaEvents(SOFA[code], from, to);
    let found = 0;
    const filled = {};
    await pool(need, async (m) => {
      const hit = findEvent(m, events);
      if (!hit) return;
      const per = statsOf(await get(`${API}/event/${hit.e.id}/statistics`), hit.swapped);
      const all = per.ALL || {};
      const fill = [];
      for (const k of missing(m)) {
        if (k === 'c1') {
          const c = per['1ST']?.c;
          if (c) (m.c1 = [c[0], c[1], c[0] + c[1]]), fill.push('c1');
        } else if (all[k] && !(['c', 's', 't'].includes(k) && all[k][0] + all[k][1] === 0)) {
          (m.s ||= {})[k] = all[k];
          fill.push(k);
        }
      }
      m.sf = String(hit.e.id);
      if (fill.length) m.fill = fill;
      found++;
      for (const k of fill) filled[k] = (filled[k] || 0) + 1;
    });
    fs.writeFileSync(file, JSON.stringify(d));
    total.found += found;
    for (const [k, v] of Object.entries(filled)) total.filled[k] = (total.filled[k] || 0) + v;
    log(`${code} ${f.slice(0, 4)}: ${need.length} con datos faltantes · ${events.length} partidos en Sofascore · encontrados ${found} · rellenado ${JSON.stringify(filled)}`);
  }
}
log(`Listo: ${total.need} partidos con datos faltantes de ${total.matches}; encontrados en Sofascore ${total.found}; rellenado ${JSON.stringify(total.filled)}`);
