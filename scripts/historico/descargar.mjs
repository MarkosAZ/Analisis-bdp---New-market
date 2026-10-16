// Descarga de datos históricos para la prueba retrospectiva y el entrenamiento de la
// red (corre en GitHub Actions: .github/workflows/historico.yml).
// Uso: node scripts/historico/descargar.mjs [futbol] [nba] [mlb] [--solo=eng.1,per.1]
import { futbol } from './futbol.mjs';
import { nba } from './nba.mjs';
import { mlb } from './mlb.mjs';
import { log } from './comun.mjs';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--solo='))?.slice(7).split(',') || null;
const parts = args.filter((a) => !a.startsWith('--'));
const want = (p) => !parts.length || parts.includes(p);
const t0 = Date.now();
if (want('mlb')) await mlb().catch((e) => log(`MLB: ${e.stack || e.message}`));
if (want('nba')) await nba().catch((e) => log(`NBA: ${e.stack || e.message}`));
if (want('futbol')) await futbol({ only }).catch((e) => log(`Fútbol: ${e.stack || e.message}`));
log(`Listo en ${Math.round((Date.now() - t0) / 1000)} s`);
