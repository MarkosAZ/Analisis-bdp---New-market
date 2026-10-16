// Redes especializadas: una red neuronal por mercado de la lista
// (Football_Goals_Model, Football_CornersH1_Model...) y, en los Más/Menos de
// jugador, una por estadística (Basketball_PlayerPoints_Model,
// Basketball_PlayerRebounds_Model...). Ninguna mezcla mercados: los córners del
// primer tiempo no aprenden de los del partido, ni los rebotes de los puntos.
// Cada una aprende solo de los resultados de su mercado y corrige la
// probabilidad estadística únicamente cuando mejora en partidos que no usó para
// entrenar; mientras no tenga suficientes resultados (neural.MIN_SAMPLES), su
// mercado queda con la probabilidad estadística.
import { FEATURE_VERSION, FEATURES } from './features.js';
import { Corrector, isResult } from './neural.js';
import { isPlayerMarket, MARKETS, marketInfo } from './picks.js';

// Nombre de cada red de mercado (su id está en picks.MARKETS: net).
const NAMES = {
  Football_Goals_Model: 'Fútbol: goles totales',
  Football_BTTS_Model: 'Fútbol: ambos anotan',
  Football_Corners_Model: 'Fútbol: córners',
  Football_CornersHandicap_Model: 'Fútbol: hándicap de córners',
  Football_Cards_Model: 'Fútbol: tarjetas',
  Football_ShotsOnTarget_Model: 'Fútbol: tiros al arco',
  Football_Shots_Model: 'Fútbol: remates totales',
  Football_CornersH1_Model: 'Fútbol: córners del primer tiempo',
  Basketball_Totals_Model: 'Básquet: total de puntos',
  Basketball_Handicap_Model: 'Básquet: hándicap',
  Basketball_HandicapH1_Model: 'Básquet: hándicap del primer tiempo',
  Basketball_TotalsH1_Model: 'Básquet: total del primer tiempo',
  Baseball_Winner_Model: 'Béisbol: ganador',
  Baseball_RunLine_Model: 'Béisbol: hándicap (run line)',
  Baseball_Totals_Model: 'Béisbol: total de carreras',
};
const GROUPS = { football: 'Fútbol', basketball: 'Básquet', baseball: 'Béisbol' };
export const PLAYER_GROUP = 'Básquet: jugadores';

// Más/Menos de jugador (OU.pl_<código>#Nombre): una red por estadística. No
// depende de players.PLAYER_STATS: un código sin red se analiza igual, con la
// probabilidad estadística.
export const PLAYER_NETWORKS = {
  pl_pts: { id: 'Basketball_PlayerPoints_Model', name: 'Jugador: puntos' },
  pl_reb: { id: 'Basketball_PlayerRebounds_Model', name: 'Jugador: rebotes' },
  pl_ast: { id: 'Basketball_PlayerAssists_Model', name: 'Jugador: asistencias' },
  pl_3pm: { id: 'Basketball_PlayerThreesMade_Model', name: 'Jugador: triples anotados' },
  pl_3pa: { id: 'Basketball_PlayerThreesAttempted_Model', name: 'Jugador: triples intentados' },
  pl_fgm: { id: 'Basketball_PlayerFieldGoalsMade_Model', name: 'Jugador: tiros de campo anotados' },
  pl_fga: { id: 'Basketball_PlayerFieldGoalsAttempted_Model', name: 'Jugador: tiros de campo intentados' },
  pl_2pm: { id: 'Basketball_PlayerTwosMade_Model', name: 'Jugador: tiros de 2 anotados' },
  pl_2pa: { id: 'Basketball_PlayerTwosAttempted_Model', name: 'Jugador: tiros de 2 intentados' },
  pl_ftm: { id: 'Basketball_PlayerFreeThrowsMade_Model', name: 'Jugador: tiros libres anotados' },
  pl_fta: { id: 'Basketball_PlayerFreeThrowsAttempted_Model', name: 'Jugador: tiros libres intentados' },
  pl_stl: { id: 'Basketball_PlayerSteals_Model', name: 'Jugador: robos' },
  pl_blk: { id: 'Basketball_PlayerBlocks_Model', name: 'Jugador: tapones' },
  pl_tov: { id: 'Basketball_PlayerTurnovers_Model', name: 'Jugador: pérdidas' },
  pl_oreb: { id: 'Basketball_PlayerOffensiveRebounds_Model', name: 'Jugador: rebotes ofensivos' },
  pl_dreb: { id: 'Basketball_PlayerDefensiveRebounds_Model', name: 'Jugador: rebotes defensivos' },
  pl_pra: { id: 'Basketball_PlayerPtsRebAst_Model', name: 'Jugador: puntos + rebotes + asistencias' },
  pl_pr: { id: 'Basketball_PlayerPtsReb_Model', name: 'Jugador: puntos + rebotes' },
  pl_pa: { id: 'Basketball_PlayerPtsAst_Model', name: 'Jugador: puntos + asistencias' },
  pl_ra: { id: 'Basketball_PlayerRebAst_Model', name: 'Jugador: rebotes + asistencias' },
  pl_sb: { id: 'Basketball_PlayerStealsBlocks_Model', name: 'Jugador: robos + tapones' },
};

// [{ id, name, sport, group, markets: [nombres de los mercados que corrige] }]: las de
// mercado en el orden de MARKETS y después las de jugador (con su código: code).
export const NETWORKS = [];
for (const m of MARKETS.filter((x) => x.net)) {
  let net = NETWORKS.find((n) => n.id === m.net);
  if (!net) NETWORKS.push((net = { id: m.net, name: NAMES[m.net] || m.net, sport: m.sport, group: GROUPS[m.sport] || m.sport, markets: [] }));
  net.markets.push(m.name);
}
for (const [code, n] of Object.entries(PLAYER_NETWORKS)) {
  const market = `Más/Menos de ${n.name.replace(/^Jugador: /, '')} de cada jugador`;
  NETWORKS.push({ id: n.id, name: n.name, sport: 'basketball', group: PLAYER_GROUP, code, markets: [market] });
}
const IDS = new Set(NETWORKS.map((n) => n.id));

// Versión del archivo de pesos. En la 1 estas redes aprendían de dos mercados a la
// vez (córners con los del primer tiempo, tiros al arco con remates, básquet con su
// primer tiempo): sus pesos guardados no se usan hasta reentrenarlas.
const VERSION = 2;
const MIXED_V1 = new Set(['Football_Corners_Model', 'Football_Shots_Model', 'Basketball_Totals_Model', 'Basketball_Handicap_Model']);

// Estadística de un Más/Menos de jugador del partido: 'OU.pl_pts#LeBron James' → 'pl_pts'.
export const playerStatOf = (market) => /^OU\.(pl_[a-z0-9]+)#/.exec(String(market))?.[1] || null;

// Red que corrige un mercado (null: queda con la probabilidad estadística). Los
// de jugador, la de su estadística; los demás, la de su mercado de la lista.
export function networkOf(sport, market) {
  const info = marketInfo(sport, market);
  if (!info) return null;
  if (!isPlayerMarket(market)) return info.net || null;
  const code = playerStatOf(market);
  return code && Object.hasOwn(PLAYER_NETWORKS, code) ? PLAYER_NETWORKS[code].id : null;
}

export class NetworkSet {
  // info: de dónde salió el entrenamiento ({ trainedAt, source, rows: { real, imported } }).
  constructor(nets = {}, info = null) {
    this.nets = nets; // id -> Corrector
    this.info = info;
  }

  forCandidate(c) {
    const id = networkOf(c.sport, c.market);
    return id ? this.nets[id] || null : null;
  }

  // Probabilidad con la corrección de la red de ese mercado (sin red entrenada, la estadística).
  predict(c) {
    const net = this.forCandidate(c);
    return net ? net.predict(c.x, c.pBase) : c.pBase;
  }

  // Estado de cada red: { id, name, group, markets, trained, samples, meta }.
  status() {
    return NETWORKS.map((n) => {
      const net = this.nets[n.id];
      return { ...n, trained: Boolean(net?.trained), samples: net?.meta?.samples || 0, meta: net?.meta || {} };
    });
  }

  // Resumen que se guarda con cada análisis.
  summary() {
    const st = this.status();
    return {
      trained: st.filter((n) => n.trained).length,
      total: st.length,
      samples: st.reduce((s, n) => s + n.samples, 0),
      nets: Object.fromEntries(st.map((n) => [n.id, { trained: n.trained, samples: n.samples }])),
    };
  }

  toJSON() {
    return { version: VERSION, featureVersion: FEATURE_VERSION, inputs: FEATURES.length, ...(this.info ? { info: this.info } : {}), nets: Object.fromEntries(Object.entries(this.nets).map(([id, net]) => [id, net.toJSON()])) };
  }

  // Redes guardadas con otras variables no se usan (se reentrenan con las filas
  // nuevas). Se ignoran las de ids que ya no existen y las que en la versión 1
  // aprendían de dos mercados juntos; las que faltan quedan sin entrenar.
  static fromJSON(o) {
    if (!o || o.featureVersion !== FEATURE_VERSION || o.inputs !== FEATURES.length) return new NetworkSet();
    const keep = (id) => IDS.has(id) && !((o.version || 1) < 2 && MIXED_V1.has(id));
    return new NetworkSet(Object.fromEntries(Object.entries(o.nets || {}).filter(([id]) => keep(id)).map(([id, n]) => [id, Corrector.fromJSON(n)])), o.info || null);
  }

  // rows: [{ sport, market, x, pBase, y, start }] (filas de entrenamiento con resultado).
  static train(rows) {
    const byNet = new Map(NETWORKS.map((n) => [n.id, []]));
    for (const r of rows) {
      const id = networkOf(r.sport, r.market);
      if (id && isResult(r.y)) byNet.get(id)?.push(r);
    }
    const nets = {};
    for (const [id, list] of byNet) {
      const net = new Corrector({ inputs: FEATURES.length });
      net.train(list.map((r) => ({ x: r.x, pBase: r.pBase, y: r.y, start: r.start })));
      nets[id] = net;
    }
    return new NetworkSet(nets);
  }
}
