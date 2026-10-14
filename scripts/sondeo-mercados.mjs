// Sondeo temporal (13): proporción de puntos del 1.er tiempo (y de cada cuarto) y
// peso de la prórroga en la NBA y la WNBA (marcadores por cuarto de ESPN) y en las
// ligas de Flashscore (últimos 7 días).
import { getSportDay } from '../extension/sources/flashscore.js';
import { periodsFromRow } from '../docs/js/analysis/records.js';

const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball';
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
function summary(name, games) {
  const q = [0, 0, 0, 0];
  let reg = 0;
  let fin = 0;
  let ot = 0;
  let otPts = 0;
  for (const per of games) {
    for (let i = 0; i < 4; i++) q[i] += per[i][0] + per[i][1];
    const r = per.slice(0, 4).reduce((s, p) => s + p[0] + p[1], 0);
    const f = per.reduce((s, p) => s + p[0] + p[1], 0);
    reg += r;
    fin += f;
    if (per.length > 4) (ot++, (otPts += f - r));
  }
  const n = games.length;
  if (!n) return console.log(`${name}: sin partidos`);
  const share = (q[0] + q[1]) / reg;
  // Desvío del total del 1.er tiempo y del partido.
  const h1 = games.map((p) => p[0][0] + p[0][1] + p[1][0] + p[1][1]);
  const ft = games.map((p) => p.reduce((s, x) => s + x[0] + x[1], 0));
  const sd = (xs) => Math.sqrt(xs.reduce((s, x) => s + (x - xs.reduce((a, b) => a + b, 0) / xs.length) ** 2, 0) / xs.length);
  console.log(`${name}: ${n} partidos | cuartos ${q.map((x) => (x / n).toFixed(1)).join(' / ')} | 1.er tiempo ${(share * 100).toFixed(2)}% del reglamentario | final medio ${(fin / n).toFixed(1)} reglamentario ${(reg / n).toFixed(1)} | prórroga ${ot} (${((ot / n) * 100).toFixed(1)}%, +${ot ? (otPts / ot).toFixed(1) : 0} pts) | sd 1T ${sd(h1).toFixed(1)} sd partido ${sd(ft).toFixed(1)} | 1T/final ${((h1.reduce((a, b) => a + b, 0) / ft.reduce((a, b) => a + b, 0)) * 100).toFixed(2)}%`);
}
async function espn(league, from, to, step) {
  const games = [];
  for (let d = new Date(from); d <= new Date(to); d = new Date(d.getTime() + step * 86400000)) {
    try {
      const r = await fetch(`${API}/${league}/scoreboard?dates=${ymd(d)}`, { signal: AbortSignal.timeout(20000) });
      const data = await r.json();
      for (const e of data.events || []) {
        const c = e.competitions?.[0];
        if (!c?.status?.type?.completed || Number(e.season?.type) !== 2) continue;
        const [a, b] = c.competitors || [];
        const la = (a?.linescores || []).map((x) => Number(x.value));
        const lb = (b?.linescores || []).map((x) => Number(x.value));
        if (la.length >= 4 && la.length === lb.length) games.push(la.map((v, i) => [v, lb[i]]));
      }
    } catch (e) {
      console.log(`${league} ${ymd(d)}: ${e.message}`);
    }
  }
  return games;
}
summary('NBA 2025-26 (temporada regular)', await espn('nba', '2025-10-22', '2026-04-12', 3));
summary('WNBA 2026 (temporada regular)', await espn('wnba', '2026-05-16', '2026-09-12', 3));

const byLeague = new Map();
for (const day of [-1, -2, -3, -4, -5, -6, -7]) {
  try {
    const { items } = await getSportDay({ sport: 'basketball', day });
    for (const e of items) {
      if (e.state !== 'finalizado' || !e.fsRow) continue;
      const per = periodsFromRow(e.fsRow, 'basketball');
      if (!per || per.length < 4 || per.some((p) => p.some((x) => typeof x !== 'number'))) continue;
      const k = `${e.category.name} · ${e.tournament.name}`;
      (byLeague.get(k) || byLeague.set(k, []).get(k)).push(per);
    }
  } catch (e) {
    console.log(`Flashscore día ${day}: ${e.message}`);
  }
}
const all = [];
for (const [k, list] of [...byLeague].sort((a, b) => b[1].length - a[1].length)) {
  all.push(...list);
  if (list.length >= 6) summary(`Flashscore ${k}`, list);
}
summary('Flashscore: todas las ligas (7 días)', all);
