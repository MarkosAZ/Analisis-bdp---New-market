// Prueba retrospectiva del análisis estadístico con los datos históricos: por mercado,
// la pérdida logarítmica de la probabilidad del análisis (pBase) frente a usar siempre
// la frecuencia del mercado y, donde hay cuotas reales, frente a la casa al cierre.
// Uso: node scripts/historico/prueba.mjs [futbol] [nba|basquet] [mlb] [--filas=archivo.ndjson] [--desde=2024-01-01]
import fs from 'node:fs';
import { replayFootball } from './repeticion/futbol.mjs';
import { replayNba } from './repeticion/nba.mjs';
import { replayMlb } from './repeticion/mlb.mjs';
import { log } from './repeticion/comun.mjs';

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const parts = args.filter((a) => !a.startsWith('--'));
const want = (p) => !parts.length || parts.includes(p);
const from = opt('desde') ? Date.parse(opt('desde')) : 0;
const out = opt('filas') ? fs.createWriteStream(opt('filas')) : null;

const bce = (p, y) => {
  const q = Math.min(1 - 1e-7, Math.max(1e-7, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const BASKET = { nba: 'NBA', euroliga: 'Euroliga', acb: 'Liga ACB' };
const groupOf = (r) => {
  const m = r.market.replace(/#.*/, '');
  const league = BASKET[r.comp] || r.comp;
  return r.sport === 'basketball' && /^OU\.pl_/.test(m) ? `${league} jugadores` : `${r.sport === 'football' ? 'Fútbol' : r.sport === 'basketball' ? league : 'MLB'} ${m}`;
};

const stats = new Map();
function add(key, r, pMarket) {
  const s = stats.get(key) || stats.set(key, { n: 0, y: 0, p: 0, ll: 0, br: 0, rows: [], mkt: { n: 0, ll: 0, llModel: 0 } }).get(key);
  s.n++;
  s.y += r.y;
  s.p += r.pBase;
  s.ll += bce(r.pBase, r.y);
  s.br += (r.pBase - r.y) ** 2;
  s.rows.push([r.pBase, r.y]);
  if (pMarket != null) {
    s.mkt.n++;
    s.mkt.ll += bce(pMarket, r.y);
    s.mkt.llModel += bce(r.pBase, r.y);
  }
}

const t0 = Date.now();
let total = 0;
const gens = [];
if (want('futbol')) gens.push(['fútbol', replayFootball({ from })]);
if (want('mlb')) gens.push(['MLB', replayMlb({ from })]);
if (want('nba') || want('basquet')) gens.push(['básquet', replayNba({ from })]);
for (const [name, gen] of gens) {
  let n = 0;
  for (const { rows } of gen) {
    n++;
    for (const r of rows) {
      if (!(r.y >= 0 && r.y <= 1)) continue;
      total++;
      const real = r.realOdds && r.x[2] === 1 ? sigmoid(r.x[0] + r.x[1]) : null;
      add(groupOf(r), r, real);
      if (r.sport === 'football') add(`Fútbol ${r.market} · ${r.comp}`, r, real);
      if (out) out.write(`${JSON.stringify({ s: r.sport, m: r.market, c: r.comp, t: r.start, sel: r.sel, l: r.line, p: r.pBase, y: r.y, x: r.x, o: r.odds, ro: r.realOdds || 0 })}\n`);
    }
    if (n % 2000 === 0) log(`${name}: ${n} partidos`);
  }
  log(`${name}: ${n} partidos`);
}
out?.end();

// Calibración: por tramos de pBase.
const BUCKETS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1.01];
const calib = (rows) =>
  BUCKETS.slice(0, -1)
    .map((lo, i) => {
      const xs = rows.filter(([p]) => p >= lo && p < BUCKETS[i + 1]);
      return xs.length >= 30 ? `${Math.round(lo * 100)}-${Math.round(BUCKETS[i + 1] * 100)}%: ${(xs.reduce((s, [, y]) => s + y, 0) / xs.length * 100).toFixed(0)}% (${xs.length})` : null;
    })
    .filter(Boolean)
    .join(' · ');

const lines = [];
for (const [key, s] of [...stats].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (s.n < 100) continue;
  const rate = s.y / s.n;
  const llConst = s.rows.reduce((a, [, y]) => a + bce(rate, y), 0) / s.n;
  const mkt = s.mkt.n >= 100 ? ` · con cuotas reales (${s.mkt.n}): casa ${(s.mkt.ll / s.mkt.n).toFixed(4)} vs análisis ${(s.mkt.llModel / s.mkt.n).toFixed(4)}` : '';
  lines.push(`${key}: n ${s.n} · acierto ${(rate * 100).toFixed(1)}% (esperado ${(s.p / s.n * 100).toFixed(1)}%) · pérdida ${(s.ll / s.n).toFixed(4)} vs frecuencia fija ${llConst.toFixed(4)} (${((1 - s.ll / s.n / llConst) * 100).toFixed(1)}%)${mkt}`);
  if (!key.includes(' · ')) lines.push(`    calibración ${calib(s.rows)}`);
}
console.log(`\n${total} selecciones en ${Math.round((Date.now() - t0) / 1000)} s\n${lines.join('\n')}`);
