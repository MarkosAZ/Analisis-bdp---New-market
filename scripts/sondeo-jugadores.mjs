// SONDEO TEMPORAL (se borra antes de unir a main): estadísticas por jugador en Flashscore.
import { getSportDay, getMatchFeeds, getH2H } from '../extension/sources/flashscore.js';

const log = (...a) => console.log(...a);
const cut = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36' };

const done = [];
for (const day of [-1, -2]) {
  const { items } = await getSportDay({ sport: 'basketball', day });
  done.push(...items.filter((e) => e.state === 'finalizado'));
}
const pick = (re) => done.find((e) => re.test(`${e.category?.name} ${e.tournament?.name}`));
const sample = [pick(/nba/i), pick(/euroliga/i), pick(/endesa/i), pick(/superliga/i)].filter(Boolean);
for (const e of sample) {
  log(`\n--- ${e.category?.name} · ${e.tournament?.name}: ${e.home.name} vs ${e.away.name} (${e.id})`);
  const f = await getMatchFeeds({ fsId: e.id, kinds: ['psp', 'li'] });
  log('df_psp COMPLETO:', f.psp);
  const players = [...String(f.li || '').matchAll(/LP÷([^¬]+)¬LI÷([^¬]+)/g)].map((m) => `${m[1]}=${m[2]}`);
  log('jugadores en df_li:', players.length, players.slice(0, 6).join(' | '));
}

// Nombres de los feeds que usa la web del partido (en su JavaScript).
const e = sample[0];
if (e) {
  const id = e.id.replace('fs:', '');
  const url = `https://www.flashscore.pe/partido/${id}/#/resumen-del-partido/estadisticas-de-jugadores`;
  try {
    const html = await (await fetch(url, { headers: UA })).text();
    log('\nHTML', html.length, 'car.');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], 'https://www.flashscore.pe').href);
    log('scripts:', scripts.length, scripts.slice(0, 30).join(' '));
    const names = new Set();
    const ctx = [];
    for (const s of scripts.slice(0, 40)) {
      try {
        const js = await (await fetch(s, { headers: UA })).text();
        for (const m of js.matchAll(/["'`](d[a-z]_[a-z0-9]{1,8})_/g)) names.add(m[1]);
        for (const m of js.matchAll(/.{80}psp.{120}/g)) if (ctx.length < 12) ctx.push(`${s.split('/').pop()}: ${m[0]}`);
      } catch (err) {
        log('js', s, err.message);
      }
    }
    log('feeds en el JS:', [...names].sort().join(' '));
    log('contexto psp:\n' + ctx.join('\n'));
    for (const m of html.matchAll(/.{60}(feed_sign|x-fsign|fsign|environment).{80}/gi)) log('html:', cut(m[0], 200));
  } catch (err) {
    log('web', err.message);
  }
  // Prueba de nombres de feed candidatos para los datos de jugadores.
  const cands = ['psd', 'pss', 'psl', 'psg', 'psh', 'psm', 'pse', 'psa', 'psb', 'psc', 'pst', 'psi', 'psr', 'pspd', 'pspa', 'plp', 'pls', 'lps', 'lis', 'lip', 'ps1', 'psp1', 'psp_0'];
  const f = await getMatchFeeds({ fsId: e.id, kinds: cands });
  for (const k of cands) if (f[k] && f[k].length > 5) log(`df_${k}: ${f[k].length} car. ${cut(f[k], 1500)}`);
  // H2H de un partido próximo de la NBA: ids de sus últimos partidos.
  const { items: today } = await getSportDay({ sport: 'basketball', day: 0 });
  const next = today.find((x) => /nba/i.test(x.tournament?.name) && x.state === 'pendiente');
  if (next) {
    const h2h = await getH2H({ fsId: next.id.slice(3), homeId: next.home.id, awayId: next.away.id });
    log(`\nH2H ${next.home.name} vs ${next.away.name}: local ${h2h.lastHome.length} (${h2h.lastHome.slice(0, 3).map((m) => m.fsId).join(',')}), visita ${h2h.lastAway.length}`);
  }
}
