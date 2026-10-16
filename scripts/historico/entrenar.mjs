// Entrena las 36 redes especializadas con los resultados de los análisis guardados
// (docs/data/entrenamiento) y las selecciones de la reproducción histórica
// (data/historico), y guarda docs/data/modelo/redes.json. Corre cada día en GitHub
// Actions (.github/workflows/entrenar.yml); la página solo lee el archivo.
// Las filas históricas son de partidos anteriores al primer resultado guardado: así
// un partido no entra dos veces y, a medida que hay resultados propios, estos pasan
// a ser los más recientes (cada red usa los 15 000 más recientes).
// Uso: node scripts/historico/entrenar.mjs [--salida=docs/data/modelo/redes.json]
import fs from 'node:fs';
import path from 'node:path';
import { FEATURE_VERSION, FEATURES } from '../../docs/js/analysis/features.js';
import { isResult } from '../../docs/js/analysis/neural.js';
import { NetworkSet, networkOf } from '../../docs/js/analysis/networks.js';
import { replayFootball } from './repeticion/futbol.mjs';
import { replayNba } from './repeticion/nba.mjs';
import { replayMlb } from './repeticion/mlb.mjs';
import { log } from './repeticion/comun.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = process.argv.find((a) => a.startsWith('--salida='))?.slice(9) || path.join(ROOT, 'docs/data/modelo/redes.json');
const CAP = 15000; // filas por red (Corrector.train usa las 15 000 más recientes)

// Resultados de los análisis guardados: una fila por clave, la del mes más reciente.
const dir = path.join(ROOT, 'docs/data/entrenamiento');
const saved = (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).rows || []).filter((r) => r.fv === FEATURE_VERSION && r.x?.length === FEATURES.length);
const byKey = new Map();
for (const r of saved) if (isResult(r.y)) byKey.set(r.key, r);
const real = [...byKey.values()];
const cutoff = Math.min(Date.now() - 86400000, ...saved.map((r) => r.start).filter(Number.isFinite));
const pending = saved.length;
log(`resultados propios: ${real.length} (de ${pending} filas guardadas) · partidos históricos hasta ${new Date(cutoff).toISOString().slice(0, 10)}`);

// Filas históricas: por red, las más recientes (las viejas no las usaría el entrenamiento).
const buffers = new Map();
const bySport = {};
let imported = 0;
for (const [sport, gen] of [
  ['futbol', replayFootball({ to: cutoff })],
  ['mlb', replayMlb({ to: cutoff })],
  ['nba', replayNba({ to: cutoff })],
]) {
  let n = 0;
  for (const { rows } of gen) {
    for (const r of rows) {
      if (!isResult(r.y)) continue;
      const id = networkOf(r.sport, r.market);
      if (!id) continue;
      const list = buffers.get(id) || buffers.set(id, []).get(id);
      list.push({ sport: r.sport, market: r.market, x: r.x, pBase: r.pBase, y: r.y, start: r.start });
      if (list.length > 2 * CAP) list.splice(0, list.length - CAP);
      n++;
    }
  }
  bySport[sport] = n;
  imported += n;
  log(`${sport}: ${n} selecciones históricas`);
}

const rows = [...[...buffers.values()].flat(), ...real];
log(`entrenando con ${rows.length} filas (${real.length} propias)`);
const set = NetworkSet.train(rows);
set.info = { trainedAt: new Date().toISOString(), source: 'GitHub Actions', rows: { real: real.length, imported, bySport }, cutoff: new Date(cutoff).toISOString() };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(set.toJSON()));
const s = set.summary();
for (const n of set.status()) {
  const m = n.meta || {};
  log(`${n.id.padEnd(46)} ${n.trained ? 'corrige' : 'no     '} · ${String(n.samples).padStart(5)} filas${m.baseLoss ? ` · error ${m.baseLoss.toFixed(4)} → ${(m.testLoss ?? m.baseLoss).toFixed(4)}` : ''}${m.reason ? ` · ${m.reason}` : ''}`);
}
log(`Redes: ${s.trained} de ${s.total} corrigen · ${out}`);
