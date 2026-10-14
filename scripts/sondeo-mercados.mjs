// Sondeo temporal (15): corrida completa de collect-data con los cambios de la rama y
// revisión de lo publicado para el básquet (cuotas de jugador, 1.er tiempo, jugadores
// de ESPN y forma sin la Summer League).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expandDay } from '../docs/js/data-format.js';

const OUT = path.resolve('sondeo-site');
const t0 = Date.now();
const run = spawnSync(process.execPath, ['scripts/collect-data.mjs', OUT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
console.log(run.stdout.split('\n').filter((l) => /Apuesta Total|Jugadores|H2H|Registros|Listo|basketball|básquet|Error|error/i.test(l)).join('\n'));
if (run.status !== 0) console.log(`collect-data terminó con ${run.status}\n${run.stderr.slice(-3000)}`);
console.log(`collect-data: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const base = path.join(OUT, 'data/fuente');
for (const date of fs.readdirSync(base).filter((d) => /^\d{4}-/.test(d)).sort()) {
  const file = path.join(base, date, 'basketball.json');
  if (!fs.existsSync(file)) continue;
  const size = fs.statSync(file).size;
  const day = expandDay(JSON.parse(fs.readFileSync(file, 'utf8')));
  const nba = day.events.filter((e) => /NBA/.test(e.tournament.name));
  console.log(`\n==== ${date} básquet: ${day.events.length} partidos, ${day.offers.size} con cuotas, archivo ${(size / 1024).toFixed(0)} KB | NBA: ${nba.length}`);
  for (const e of nba) {
    const offers = day.offers.get(e.id) || [];
    const d = day.details.get(e.id);
    const by = (re) => offers.filter((o) => re.test(o.market)).length;
    const total = (list) => (list?.length ? (list.reduce((s, m) => s + m.gf + m.ga, 0) / list.length).toFixed(1) : '-');
    const pl = d?.players;
    console.log(`  ${e.home.name} vs ${e.away.name} [${e.tournament.name}] | cuotas ${offers.length}: OU ${by(/^OU$/)} HCP ${by(/^HCP$/)} OU@h1 ${by(/^OU@h1$/)} HCP@h1 ${by(/^HCP@h1$/)} jugador ${by(/^OU\.pl_/)} | total medio últimos: ${total(d?.lastHome)} / ${total(d?.lastAway)} | jugadores ESPN: ${pl ? `${pl.home.players.length}+${pl.away.players.length} (${[...pl.home.players, ...pl.away.players].map((p) => `${p.name}:${p.games.length}`).join(', ')})` : 'no'}`);
  }
}
