// Sondeo temporal (16): collect-data apuntando a los días 6 y 7 (estreno de la
// temporada regular de la NBA) para probar la publicación de los jugadores (ESPN)
// y las cuotas de jugador de Apuesta Total, y cómo las analiza la página sin la extensión.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expandDay } from '../docs/js/data-format.js';
import { baseCandidates } from '../docs/js/analysis/engine.js';

const src = fs.readFileSync('scripts/collect-data.mjs', 'utf8');
const patched = src.replace('const AHEAD = [0, 1];', 'const AHEAD = [6, 7];').replace('const BACK = [-7, -6, -5, -4, -3, -2, -1];', 'const BACK = [-1];').replace('to: now + 54 * 3600000', 'to: now + 8 * 86400000');
if (patched === src) throw new Error('no se pudo ajustar collect-data');
fs.writeFileSync('scripts/_sondeo-collect.mjs', patched);
const OUT = path.resolve('sondeo-site');
const t0 = Date.now();
const run = spawnSync(process.execPath, ['scripts/_sondeo-collect.mjs', OUT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
console.log(run.stdout.split('\n').filter((l) => /Apuesta Total|Jugadores|H2H|Listo|basketball/i.test(l)).join('\n'));
if (run.status !== 0) console.log(`collect-data terminó con ${run.status}\n${run.stderr.slice(-3000)}`);
console.log(`collect-data: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const base = path.join(OUT, 'data/fuente');
for (const date of fs.readdirSync(base).filter((d) => /^\d{4}-/.test(d)).sort()) {
  const file = path.join(base, date, 'basketball.json');
  if (!fs.existsSync(file)) continue;
  const size = fs.statSync(file).size;
  const day = expandDay(JSON.parse(fs.readFileSync(file, 'utf8')));
  const nba = day.events.filter((e) => e.tournament.name === 'NBA');
  console.log(`\n==== ${date} básquet: ${day.events.length} partidos, ${day.offers.size} con cuotas, archivo ${(size / 1024).toFixed(0)} KB | NBA: ${nba.length}`);
  for (const e of nba) {
    const offers = day.offers.get(e.id) || [];
    const d = day.details.get(e.id);
    const by = (re) => offers.filter((o) => re.test(o.market)).length;
    const total = (list) => (list?.length ? (list.reduce((s, m) => s + m.gf + m.ga, 0) / list.length).toFixed(1) : '-');
    const pl = d?.players;
    console.log(`  ${e.home.name} vs ${e.away.name} | cuotas ${offers.length}: OU ${by(/^OU$/)} HCP ${by(/^HCP$/)} OU@h1 ${by(/^OU@h1$/)} HCP@h1 ${by(/^HCP@h1$/)} jugador ${by(/^OU\.pl_/)} | total medio últimos: ${total(d?.lastHome)} / ${total(d?.lastAway)} | jugadores ESPN: ${pl ? `${pl.home.players.length}+${pl.away.players.length} (${[...pl.home.players, ...pl.away.players].map((p) => `${p.name}:${p.games.length}`).join(', ')})` : 'no'}`);
    if (!offers.length) continue;
    // Como lo analiza la página sin la extensión (cuotas y jugadores publicados).
    const r = baseCandidates(e, d || {}, offers, {});
    const pl2 = r.candidates.filter((c) => /^OU\.pl_/.test(c.market));
    const team = r.candidates.filter((c) => !/^OU\.pl_/.test(c.market));
    console.log(`    análisis: ${team.length} selecciones de equipo (${[...new Set(team.map((c) => c.market))].join(', ')}), ${pl2.length} de jugador | ejemplos: ${pl2.slice(0, 4).map((c) => `${c.label} @${c.best.price} p=${c.pBase.toFixed(2)}`).join(' · ')} | sin línea .5: ${r.wholeOnly.join(', ') || '-'} | sin datos: ${r.noData.join(', ') || '-'}`);
  }
}
