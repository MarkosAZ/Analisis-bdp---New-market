import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURE_VERSION, FEATURES, upgradeFeatures } from '../docs/js/analysis/features.js';
import { Corrector, MIN_SAMPLES } from '../docs/js/analysis/neural.js';
import { NETWORKS, NetworkSet, networkOf, PLAYER_NETWORKS } from '../docs/js/analysis/networks.js';
import { MARKETS } from '../docs/js/analysis/picks.js';
import { rng } from '../docs/js/util.js';
import { dropReplaced, hasPlayerFields, mergeRows, playerFieldsOf, rowCandidates, trainingRows } from '../docs/js/history.js';
import { versionBefore } from '../docs/js/util.js';

const Z = FEATURES.indexOf('zLine');

// Filas donde la estadística dice 50 % pero el resultado depende de zLine:
// algo que la red puede aprender.
function rows(n, sport, market, seed = 3) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const z = r() * 2 - 1;
    const x = new Array(FEATURES.length).fill(0);
    x[Z] = z;
    return { sport, market, x, pBase: 0.5, y: r() < (z > 0 ? 0.85 : 0.15) ? 1 : 0, start: i, fv: FEATURE_VERSION };
  });
}

// Redes pedidas: una por mercado de la lista (14) y una por estadística de jugador (21).
const TEAM_NETS = {
  'football:OU': 'Football_Goals_Model',
  'football:BTTS': 'Football_BTTS_Model',
  'football:OU.corners': 'Football_Corners_Model',
  'football:OU.cards': 'Football_Cards_Model',
  'football:OU.shots_on': 'Football_ShotsOnTarget_Model',
  'football:OU.shots': 'Football_Shots_Model',
  'football:OU.corners@h1': 'Football_CornersH1_Model',
  'basketball:OU': 'Basketball_Totals_Model',
  'basketball:HCP': 'Basketball_Handicap_Model',
  'basketball:HCP@h1': 'Basketball_HandicapH1_Model',
  'basketball:OU@h1': 'Basketball_TotalsH1_Model',
  'baseball:ML': 'Baseball_Winner_Model',
  'baseball:HCP': 'Baseball_RunLine_Model',
  'baseball:OU': 'Baseball_Totals_Model',
};
const PLAYER_NETS = {
  pl_pts: 'Basketball_PlayerPoints_Model',
  pl_reb: 'Basketball_PlayerRebounds_Model',
  pl_ast: 'Basketball_PlayerAssists_Model',
  pl_3pm: 'Basketball_PlayerThreesMade_Model',
  pl_3pa: 'Basketball_PlayerThreesAttempted_Model',
  pl_fgm: 'Basketball_PlayerFieldGoalsMade_Model',
  pl_fga: 'Basketball_PlayerFieldGoalsAttempted_Model',
  pl_2pm: 'Basketball_PlayerTwosMade_Model',
  pl_2pa: 'Basketball_PlayerTwosAttempted_Model',
  pl_ftm: 'Basketball_PlayerFreeThrowsMade_Model',
  pl_fta: 'Basketball_PlayerFreeThrowsAttempted_Model',
  pl_stl: 'Basketball_PlayerSteals_Model',
  pl_blk: 'Basketball_PlayerBlocks_Model',
  pl_tov: 'Basketball_PlayerTurnovers_Model',
  pl_oreb: 'Basketball_PlayerOffensiveRebounds_Model',
  pl_dreb: 'Basketball_PlayerDefensiveRebounds_Model',
  pl_pra: 'Basketball_PlayerPtsRebAst_Model',
  pl_pr: 'Basketball_PlayerPtsReb_Model',
  pl_pa: 'Basketball_PlayerPtsAst_Model',
  pl_ra: 'Basketball_PlayerRebAst_Model',
  pl_sb: 'Basketball_PlayerStealsBlocks_Model',
};

test('una red por mercado y una por estadística de jugador, sin mezclar mercados', () => {
  const ids = NETWORKS.map((n) => n.id);
  assert.equal(NETWORKS.length, 35);
  assert.deepEqual(ids, [...Object.values(TEAM_NETS), ...Object.values(PLAYER_NETS)], 'las de mercado en el orden de MARKETS y después las de jugador');
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(NETWORKS.every((n) => n.name && n.sport && ['Fútbol', 'Básquet', 'Básquet: jugadores', 'Béisbol'].includes(n.group) && n.markets.length === 1), 'cada red corrige un solo mercado');
  assert.deepEqual(Object.fromEntries(Object.entries(PLAYER_NETWORKS).map(([code, n]) => [code, n.id])), PLAYER_NETS);
  assert.equal(NETWORKS.filter((n) => n.group === 'Básquet: jugadores').length, 21);
  // Cada mercado de la lista con su red (el de jugador se reparte por estadística).
  for (const m of MARKETS) assert.equal(m.net ?? null, TEAM_NETS[m.id] ?? null, m.id);
  assert.equal(MARKETS.find((m) => m.id === 'basketball:OU.player').net ?? null, null);
  // Ninguna red mezcla el primer tiempo con el partido completo.
  for (const n of NETWORKS) {
    const own = MARKETS.filter((m) => m.net === n.id);
    assert.ok(own.every((m) => m.market.includes('@h1')) || own.every((m) => !m.market.includes('@h1')), n.id);
  }
  assert.equal(networkOf('football', 'OU'), 'Football_Goals_Model');
  assert.equal(networkOf('football', 'OU.corners'), 'Football_Corners_Model');
  assert.equal(networkOf('football', 'OU.corners@h1'), 'Football_CornersH1_Model');
  assert.equal(networkOf('football', 'OU.shots_on'), 'Football_ShotsOnTarget_Model');
  assert.equal(networkOf('football', 'OU.shots'), 'Football_Shots_Model');
  assert.equal(networkOf('basketball', 'OU'), 'Basketball_Totals_Model');
  assert.equal(networkOf('basketball', 'OU@h1'), 'Basketball_TotalsH1_Model');
  assert.equal(networkOf('basketball', 'HCP'), 'Basketball_Handicap_Model');
  assert.equal(networkOf('basketball', 'HCP@h1'), 'Basketball_HandicapH1_Model');
  assert.equal(networkOf('baseball', 'OU'), 'Baseball_Totals_Model');
  assert.equal(networkOf('basketball', 'OU.pl_pts#LeBron James'), 'Basketball_PlayerPoints_Model');
  assert.equal(networkOf('basketball', 'OU.pl_fga#Nikola Jokic'), 'Basketball_PlayerFieldGoalsAttempted_Model');
  assert.equal(networkOf('basketball', 'OU.pl_pra#Nikola Jokic'), 'Basketball_PlayerPtsRebAst_Model');
  assert.equal(networkOf('basketball', 'OU.pl_3pa#Stephen Curry'), 'Basketball_PlayerThreesAttempted_Model');
  for (const [code, id] of Object.entries(PLAYER_NETS)) assert.equal(networkOf('basketball', `OU.${code}#X`), id, code);
  assert.equal(networkOf('basketball', 'OU.pl_xyz#X'), null, 'estadística sin red: queda la probabilidad estadística');
  assert.equal(networkOf('football', 'OU.pl_pts#X'), null, 'no hay Más/Menos de jugador en fútbol');
  assert.equal(networkOf('basketball', 'OU.player'), null);
  assert.equal(networkOf('football', '1X2'), null);
});

test('cada red aprende solo de su mercado y corrige solo con suficientes resultados', () => {
  const set = NetworkSet.train([...rows(600, 'football', 'OU'), ...rows(60, 'football', 'OU.corners', 5)]);
  const st = Object.fromEntries(set.status().map((n) => [n.id, n]));
  assert.equal(st.Football_Goals_Model.samples, 600);
  assert.ok(st.Football_Goals_Model.trained, 'con 600 resultados y señal clara debe corregir');
  assert.equal(st.Football_Corners_Model.samples, 60);
  assert.equal(st.Football_Corners_Model.trained, false, `menos de ${MIN_SAMPLES}: no corrige`);
  assert.equal(st.Football_CornersH1_Model.samples, 0, 'los córners del partido no entrenan la del primer tiempo');
  assert.equal(st.Basketball_PlayerPoints_Model.samples, 0);
  const x = new Array(FEATURES.length).fill(0);
  x[Z] = 0.9;
  const goals = { sport: 'football', market: 'OU', x, pBase: 0.5 };
  const corners = { sport: 'football', market: 'OU.corners', x, pBase: 0.5 };
  assert.ok(set.predict(goals) > 0.6, 'la red de goles corrige');
  assert.equal(set.predict(corners), 0.5, 'la de córners todavía no: queda la estadística');
  const s = set.summary();
  assert.equal(s.trained, 1);
  assert.equal(s.total, NETWORKS.length);
  // Se guarda y se lee igual.
  const copy = NetworkSet.fromJSON(JSON.parse(JSON.stringify(set.toJSON())));
  assert.ok(Math.abs(copy.predict(goals) - set.predict(goals)) < 1e-3);
  // Guardadas con otras variables: no se usan.
  assert.equal(NetworkSet.fromJSON({ ...set.toJSON(), featureVersion: FEATURE_VERSION - 1 }).summary().trained, 0);
});

test('mercados parecidos no comparten red: cada una aprende solo de su mercado', () => {
  const set = NetworkSet.train([
    ...rows(600, 'football', 'OU.corners', 11),
    ...rows(600, 'football', 'OU.shots_on', 12),
    ...rows(600, 'basketball', 'OU.pl_pts#Jugador', 13),
  ]);
  const st = Object.fromEntries(set.status().map((n) => [n.id, n]));
  assert.equal(st.Football_Corners_Model.samples, 600);
  assert.ok(st.Football_Corners_Model.trained);
  assert.equal(st.Football_CornersH1_Model.samples, 0, 'las filas de córners del partido no entrenan la del primer tiempo');
  assert.equal(st.Football_CornersH1_Model.trained, false);
  assert.equal(st.Football_ShotsOnTarget_Model.samples, 600);
  assert.equal(st.Football_Shots_Model.samples, 0, 'los tiros al arco no entrenan la de remates totales');
  assert.equal(st.Basketball_PlayerPoints_Model.samples, 600);
  assert.ok(st.Basketball_PlayerPoints_Model.trained);
  for (const n of set.status().filter((x) => x.code && x.code !== 'pl_pts')) assert.equal(n.samples, 0, `los puntos no entrenan ${n.id}`);
  const x = new Array(FEATURES.length).fill(0);
  x[Z] = 0.9;
  const c = (sport, market) => ({ sport, market, x, pBase: 0.5 });
  assert.ok(set.predict(c('football', 'OU.corners')) > 0.6);
  assert.equal(set.predict(c('football', 'OU.corners@h1')), 0.5, 'el primer tiempo queda con la estadística');
  assert.ok(set.predict(c('basketball', 'OU.pl_pts#LeBron James')) > 0.6, 'la de puntos corrige a cualquier jugador');
  assert.equal(set.predict(c('basketball', 'OU.pl_reb#LeBron James')), 0.5, 'la de rebotes todavía no');
  assert.equal(set.summary().total, 35);
});

test('pesos guardados: se ignoran las redes que ya no existen y las que mezclaban mercados', () => {
  const set = NetworkSet.train(rows(600, 'football', 'OU'));
  const trained = set.toJSON().nets.Football_Goals_Model;
  const saved = (version) => ({ ...set.toJSON(), version, nets: { Football_Goals_Model: trained, Football_Corners_Model: trained, Basketball_PlayerProps_Model: trained } });
  const ok = (s) => s.status().filter((n) => n.trained).map((n) => n.id);
  // Versión 1: los córners aprendían junto con los del primer tiempo.
  assert.deepEqual(ok(NetworkSet.fromJSON(saved(1))), ['Football_Goals_Model']);
  assert.deepEqual(ok(NetworkSet.fromJSON(saved(2))), ['Football_Goals_Model', 'Football_Corners_Model']);
  const loaded = NetworkSet.fromJSON(saved(2));
  assert.equal(loaded.nets.Basketball_PlayerProps_Model, undefined, 'la red de todos los jugadores juntos ya no existe');
  assert.equal(loaded.status().length, 35, 'las que faltan quedan sin entrenar');
  assert.equal(loaded.predict({ sport: 'basketball', market: 'OU.pl_pts#X', x: new Array(FEATURES.length).fill(0), pBase: 0.6 }), 0.6);
});

test('las filas de versiones anteriores (mezcladas con las cuotas) no se usan para entrenar', () => {
  assert.equal(upgradeFeatures(new Array(39).fill(0), 2), null);
  assert.equal(upgradeFeatures(new Array(27).fill(0), 1), null);
  assert.equal(upgradeFeatures(new Array(FEATURES.length).fill(0), FEATURE_VERSION).length, FEATURES.length);
});

test('sin señal (resultado al azar según la estadística) la red casi nunca se acepta', () => {
  let accepted = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(1000 + seed);
    const data = Array.from({ length: 220 }, (_, i) => {
      const pBase = 0.5 + r() * 0.45;
      const x = FEATURES.map((f, k) => (k % 3 === 0 ? r() * 2 - 1 : k % 3 === 1 ? (r() < 0.5 ? 1 : 0) : r() * 0.004));
      return { x, pBase, y: r() < pBase ? 1 : 0, start: i };
    });
    const net = new Corrector({ inputs: FEATURES.length });
    const meta = net.train(data);
    assert.equal(meta.test, 132, 'el 60 % más reciente, predicho sin haberlo visto');
    if (net.trained) accepted++;
  }
  assert.ok(accepted <= 2, `aceptadas por azar: ${accepted} de 40`);
});

test('variables casi constantes entran como 0 y los valores raros se recortan', () => {
  const net = new Corrector({ inputs: 3 });
  net.setNorm([{ x: [0, 5, 1] }, { x: [2, 5, 1.001] }, { x: [4, 5, 0.999] }]);
  assert.deepEqual(net.std.map((v) => v > 0), [true, false, false]);
  const xn = net.norm([1000, 9, 50]);
  assert.equal(xn[0], 5);
  assert.equal(xn[1], 0);
  assert.equal(xn[2], 0);
  assert.equal(net.norm([-1000, 5, 1])[0], -5);
});

// ---- Filas de entrenamiento ----

test('filas: una por mercado (el lado más probable), sin los dos lados de la línea', () => {
  const c = (eventId, market, sel, line, pBase) => ({ eventId, market, sel, line, pBase, key: `${market}|${sel}|${line ?? ''}` });
  const rows = rowCandidates([
    c(1, 'OU', 'over', 2.5, 0.62),
    c(1, 'OU', 'under', 2.5, 0.38),
    c(1, 'OU', 'over', 3.5, 0.41),
    c(1, 'OU', 'under', 3.5, 0.59),
    c(1, 'BTTS', 'yes', null, 0.98), // fuera de la zona útil
    c(1, 'BTTS', 'no', null, 0.02),
    c(2, 'OU', 'over', 2.5, 0.45),
    c(2, 'OU', 'under', 2.5, 0.55),
  ]);
  assert.deepEqual(
    rows.map((r) => `${r.eventId}|${r.market}|${r.sel}|${r.line}`).sort(),
    ['1|OU|over|2.5', '2|OU|under|2.5'],
  );
});

test('filas: hasta 8 de cada red de jugador por partido, repartidas entre todas las probabilidades', () => {
  const list = [];
  const p = (i, n) => 0.5 + (0.47 * i) / (n - 1);
  for (let i = 0; i < 30; i++) list.push({ eventId: 7, sport: 'basketball', market: `OU.pl_pts#Jugador ${i}`, sel: 'over', line: 10.5, pBase: p(i, 30) });
  for (let i = 0; i < 30; i++) list.push({ eventId: 7, sport: 'basketball', market: `OU.pl_reb#Jugador ${i}`, sel: 'over', line: 5.5, pBase: p(i, 30) });
  for (let i = 0; i < 5; i++) list.push({ eventId: 7, sport: 'basketball', market: `OU.pl_fga#Jugador ${i}`, sel: 'over', line: 12.5, pBase: p(i, 5) });
  for (let i = 0; i < 30; i++) list.push({ eventId: 8, sport: 'basketball', market: `OU.pl_pts#Otro ${i}`, sel: 'under', line: 20.5, pBase: p(i, 30) });
  list.push({ eventId: 7, sport: 'basketball', market: 'OU', sel: 'over', line: 220.5, pBase: 0.6 });
  list.push({ eventId: 7, sport: 'basketball', market: 'OU@h1', sel: 'over', line: 110.5, pBase: 0.62 });
  const rows = rowCandidates(list);
  const count = (eventId, code) => rows.filter((r) => r.eventId === eventId && r.market.startsWith(`OU.${code}#`));
  assert.equal(count(7, 'pl_pts').length, 8, 'tope por partido y red');
  assert.equal(count(7, 'pl_reb').length, 8, 'los rebotes tienen su propio tope');
  assert.equal(count(7, 'pl_fga').length, 5, 'menos que el tope: todas');
  assert.equal(count(8, 'pl_pts').length, 8, 'el tope es de cada partido');
  assert.equal(new Set(count(7, 'pl_pts').map((r) => r.market)).size, 8);
  const ps = count(7, 'pl_pts').map((r) => r.pBase);
  assert.ok(Math.min(...ps) < 0.52 && Math.max(...ps) > 0.9, 'de punta a punta, no solo las más altas');
  assert.ok(rows.some((r) => r.market === 'OU') && rows.some((r) => r.market === 'OU@h1'), 'los del equipo no tienen tope');
});

test('filas guardadas: la del último análisis hasta tener resultado', () => {
  const old = [
    { key: '1|OU', sel: 'over', line: 2.5, y: null },
    { key: '2|OU', sel: 'over', line: 2.5, y: 1 },
  ];
  const merged = mergeRows(old, [
    { key: '1|OU', sel: 'under', line: 3.5, y: null },
    { key: '2|OU', sel: 'under', line: 2.5, y: null },
    { key: '3|OU', sel: 'over', line: 1.5, y: null },
  ]);
  const by = Object.fromEntries(merged.map((r) => [r.key, r]));
  assert.deepEqual([by['1|OU'].sel, by['1|OU'].line], ['under', 3.5]);
  assert.deepEqual([by['2|OU'].sel, by['2|OU'].y], ['over', 1], 'con resultado no se cambia');
  assert.ok(by['3|OU']);
});

test('filas: si el partido se vuelve a analizar, el tope de 8 por red se sigue cumpliendo', () => {
  const cand = (i, pBase, code = 'pl_pts') => ({ eventId: 7, sport: 'basketball', market: `OU.${code}#Jugador ${i}`, key: `OU.${code}#Jugador ${i}|over|10.5`, sel: 'over', line: 10.5, pBase, x: [0], best: { price: 1.8 }, start: 1 });
  const result = (cands) => ({ date: '2026-10-13', events: { 7: {} }, candidates: cands });
  const first = trainingRows(result(Array.from({ length: 10 }, (_, i) => cand(i, 0.52 + i * 0.04))));
  // Más tarde hay 12 jugadores y otras líneas: spread elige otros 8.
  const later = trainingRows(result(Array.from({ length: 12 }, (_, i) => cand(i, 0.53 + ((i * 7) % 12) * 0.035))));
  assert.equal(first.length, 8);
  assert.equal(later.length, 8);
  // Uno del primer análisis ya tiene resultado: ese se queda (es un dato real).
  const settled = first.find((r) => !later.some((x) => x.key === r.key));
  assert.ok(settled, 'el segundo análisis eligió otros jugadores');
  settled.y = 1;
  const other = { ...first[0], key: '7|OU.pl_reb#Jugador 0', market: 'OU.pl_reb#Jugador 0' }; // otra red: no se toca
  const saved = mergeRows(dropReplaced([...first, other], later), later);
  const points = saved.filter((r) => r.market.startsWith('OU.pl_pts#'));
  assert.equal(points.filter((r) => r.y == null).length, 8, 'pendientes: solo los 8 del último análisis');
  assert.ok(points.some((r) => r.key === settled.key && r.y === 1));
  assert.ok(saved.some((r) => r.key === other.key), 'la red de rebotes no cambia');
  // Filas de equipo: no se quitan (se reemplazan por clave).
  const team = { key: '7|OU', eventId: 7, sport: 'basketball', market: 'OU', y: null };
  assert.equal(dropReplaced([team], later).length, 1);
});

test('liquidación de jugadores: qué campos pide cada mercado y si el registro los trae', () => {
  assert.deepEqual(playerFieldsOf('OU.pl_2pa#Jugador'), ['fga', 'tpa']);
  assert.deepEqual(playerFieldsOf('OU.pl_pra#Jugador'), ['pts', 'reb', 'ast']);
  assert.deepEqual(playerFieldsOf('OU'), []);
  const old = { A: { min: 30, pts: 20, fgm: 8, fga: null, tpa: null }, B: { min: 0, dnp: true } };
  const fresh = { A: { min: 30, pts: 20, fgm: 8, fga: 15, tpa: 4 } };
  assert.equal(hasPlayerFields(old, ['fga', 'tpa']), false, 'registro sin intentos: se vuelve a pedir');
  assert.equal(hasPlayerFields(fresh, ['fga', 'tpa']), true);
  assert.equal(hasPlayerFields(old, ['pts']), true);
  assert.equal(hasPlayerFields(undefined, ['pts']), false);
  assert.equal(hasPlayerFields({ B: { min: 0, dnp: true } }, []), false, 'solo jugadores que no jugaron: se vuelve a pedir');
});

test('versión de la extensión: compara mayor, menor y parche', () => {
  assert.equal(versionBefore('0.5.0', '0.5.1'), true);
  assert.equal(versionBefore('0.5', '0.5.1'), true);
  assert.equal(versionBefore('0.5.1', '0.5.1'), false);
  assert.equal(versionBefore('0.6', '0.5.1'), false);
  assert.equal(versionBefore('1.0.0', '0.5.1'), false);
  assert.equal(versionBefore('0.4.9', '0.5.1'), true);
  assert.equal(versionBefore('0.5.10', '0.5.9'), false);
});
