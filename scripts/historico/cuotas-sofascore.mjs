// Cuotas reales de Sofascore (las del cierre, de su casa de referencia) de los partidos
// históricos: se guardan en cada partido como k = { mercado: [[línea, cuota A, cuota B], ...] }
// (A/B: Más/Menos, local/visita, sí/no). Sofascore trae goles en todas las líneas, ambos
// anotan, tarjetas y córners desde 2024-25 más o menos (antes solo el 1X2) y, en el
// básquet, total y hándicap. Fútbol de Sofascore y de ESPN (este, buscando su partido
// en Sofascore) y básquet de Sofascore (Euroliga, Liga ACB).
// Sofascore no responde desde GitHub Actions: se corre desde una sesión con internet.
// Uso: NODE_USE_ENV_PROXY=1 node scripts/historico/cuotas-sofascore.mjs [--desde=2024-07-01] [--solo=eng.2,euroliga]
import { readJson, writeJson } from './comun.mjs';
import { listDir } from './repeticion/comun.mjs';
import { API, SOFA, findEvent, get, log, pool, sofaEvents } from './sofa.mjs';

const DAY = 86400000;
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const FROM = Date.parse(arg('desde') || '2024-07-01');
const only = arg('solo')?.split(',') || null;

const decimal = (f) => {
  const [a, b] = String(f || '').split('/').map(Number);
  return a > 0 && b > 0 ? Math.round((a / b + 1) * 100) / 100 : null;
};
const lineOf = (s) => (s == null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s));
const signed = (name) => lineOf(String(name).match(/^\(([+-]?[\d.]+)\)/)?.[1]);

// Mercados de Sofascore → k.
export function oddsOf(j) {
  const k = {};
  const add = (market, line, a, b) => {
    if (!(a > 1) || !(b > 1)) return;
    (k[market] ||= []).push([line, a, b]);
  };
  for (const m of j?.markets || []) {
    const c = m.choices || [];
    const by = (n) => decimal(c.find((x) => x.name === n)?.fractionalValue);
    const name = m.marketName;
    if (name === 'Full time') {
      if (c.length === 3) k['1X2'] = [[null, by('1'), by('X'), by('2')]];
      else add('ML', null, by('1'), by('2'));
    } else if (/^(Match goals|Game total|Total runs|Total)$/.test(name)) add('OU', lineOf(m.choiceGroup), by('Over'), by('Under'));
    else if (name === 'Both teams to score') add('BTTS', null, by('Yes'), by('No'));
    else if (name === 'Cards in match') add('OU.cards', lineOf(m.choiceGroup), by('Over'), by('Under'));
    else if (name === 'Corners 2-Way') add('OU.corners', lineOf(m.choiceGroup), by('Over'), by('Under'));
    else if (name === 'Asian handicap' || name === 'Point spread' || name === 'Run line') {
      // "(−0.5) Local" / "(+0.5) Visita": la línea del local.
      if (c.length === 2) add('HCP', signed(c[0].name), decimal(c[0].fractionalValue), decimal(c[1].fractionalValue));
    }
  }
  return k;
}

// Cuotas de una lista de { m, id } (id de Sofascore); devuelve cuántos partidos tienen.
async function fill(list) {
  let n = 0;
  await pool(
    list,
    async ({ m, id }) => {
      const j = await get(`${API}/event/${id}/odds/1/all`);
      const k = j ? oddsOf(j) : {};
      if (Object.keys(k).length) {
        m.k = k;
        n++;
      }
    },
    10,
  );
  return n;
}

// Partidos de un archivo que faltan (desde FROM y después de lo ya revisado).
const pending = (d, items) => items.filter((m) => m.t * 1000 >= FROM && m.t > (d.kAt || 0) && !m.k);
const ended = (items) => Math.max(0, ...items.filter((m) => m.t * 1000 < Date.now() - DAY).map((m) => m.t));

// Si los 12 más nuevos no tienen goles/total, la temporada tampoco (ligas sin cuotas en Sofascore).
async function season(rel, d, items, idOf, want) {
  const todo = pending(d, items).sort((a, b) => b.t - a.t);
  if (!todo.length) return null;
  const head = (await Promise.all(todo.slice(0, 12).map(async (m) => ({ m, id: await idOf(m) })))).filter((x) => x.id);
  const n1 = await fill(head);
  const rich = head.some(({ m }) => m.k && want.some((w) => m.k[w]));
  let n2 = 0;
  if (rich) {
    const rest = (await pool(todo.slice(12), async (m) => ({ m, id: await idOf(m) }), 10)).filter((x) => x.id);
    n2 = await fill(rest);
  }
  d.kAt = ended(items);
  writeJson(rel, d);
  return { total: todo.length, with: n1 + n2, rich };
}

const total = { files: 0, matches: 0, with: 0 };
const report = (code, f, r) => {
  if (!r) return;
  total.files++;
  total.matches += r.total;
  total.with += r.with;
  log(`${code} ${f}: ${r.with} de ${r.total} con cuotas${r.rich ? '' : ' (sin goles/total: no se piden más)'}`);
};

// Fútbol de Sofascore.
for (const code of listDir('futbol/sofascore').filter((c) => !c.endsWith('.json') && (!only || only.includes(c)))) {
  await pool(
    listDir(`futbol/sofascore/${code}`).filter((f) => Number(f.slice(0, 4)) >= new Date(FROM).getUTCFullYear() - 1),
    async (f) => {
      const rel = `futbol/sofascore/${code}/${f}`;
      const d = readJson(rel);
      report(code, f, await season(rel, d, d.matches, async (m) => m.id.slice(3), ['OU']).catch((e) => log(`${code} ${f}: ${e.message}`)));
    },
    2,
  );
}

// Fútbol de ESPN: su partido en Sofascore (sf, o buscado por día, marcador y nombres).
for (const [code, ut] of Object.entries(SOFA).filter(([c]) => !only || only.includes(c))) {
  for (const f of listDir(`futbol/espn/${code}`).filter((f) => Number(f.slice(0, 4)) >= new Date(FROM).getUTCFullYear() - 1)) {
    const rel = `futbol/espn/${code}/${f}`;
    const d = readJson(rel);
    const todo = pending(d, d.matches.filter((m) => Array.isArray(m.g)));
    if (!todo.length) continue;
    const events = await sofaEvents(ut, Math.min(...todo.map((m) => m.t)) * 1000 - 2 * DAY, Math.max(...todo.map((m) => m.t)) * 1000 + 2 * DAY);
    const idOf = async (m) => {
      if (m.sf) return m.sf;
      const hit = findEvent(m, events);
      return hit && !hit.swapped ? String(hit.e.id) : null;
    };
    report(code, f, await season(rel, d, d.matches.filter((m) => Array.isArray(m.g)), idOf, ['OU']).catch((e) => log(`${code} ${f}: ${e.message}`)));
  }
}

// Básquet de Sofascore.
for (const code of listDir('basquet').filter((c) => !only || only.includes(c))) {
  for (const f of listDir(`basquet/${code}`).filter((f) => Number(f.slice(0, 4)) >= new Date(FROM).getUTCFullYear() - 1)) {
    const rel = `basquet/${code}/${f}`;
    const d = readJson(rel);
    report(code, f, await season(rel, d, d.games, async (g) => g.id.slice(3), ['OU', 'HCP']).catch((e) => log(`${code} ${f}: ${e.message}`)));
  }
}
log(`Listo: ${total.with} de ${total.matches} partidos con cuotas en ${total.files} archivos`);
