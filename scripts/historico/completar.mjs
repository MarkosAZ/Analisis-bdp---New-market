// Completa los partidos de fútbol de ESPN (data/historico/futbol/espn) con Sofascore:
// córners, tarjetas, remates, tiros al arco y faltas del partido y córners del 1.er
// tiempo que ESPN no trae (Bélgica, Noruega, Suecia y Perú sin relato, amistosos,
// eliminatorias...). Solo rellena lo que falta; no cambia lo de ESPN. Cada partido
// completado guarda el id de Sofascore (sf) y qué se rellenó (fill).
// Sofascore no responde desde GitHub Actions: se corre desde una sesión con internet.
// Uso: NODE_USE_ENV_PROXY=1 node scripts/historico/completar.mjs [--solo=per.1,bel.1]
import fs from 'node:fs';
import path from 'node:path';
import { API, SOFA, findEvent, get, log, pool, sofaEvents, statsOf } from './sofa.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../data/historico/futbol/espn');

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
