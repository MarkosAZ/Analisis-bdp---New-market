// Redes especializadas: una red neuronal por tipo de mercado
// (Football_Goals_Model, Basketball_PlayerProps_Model...). Cada una aprende solo
// de los resultados de sus mercados y corrige la probabilidad estadística
// únicamente cuando mejora en partidos que no usó para entrenar; mientras no
// tenga suficientes resultados (neural.MIN_SAMPLES), sus mercados quedan con la
// probabilidad estadística.
import { FEATURE_VERSION, FEATURES } from './features.js';
import { Corrector, isResult } from './neural.js';
import { MARKETS, marketInfo } from './picks.js';

const NAMES = {
  Football_Goals_Model: 'Fútbol: goles',
  Football_BTTS_Model: 'Fútbol: ambos anotan',
  Football_Corners_Model: 'Fútbol: córners',
  Football_Cards_Model: 'Fútbol: tarjetas',
  Football_Shots_Model: 'Fútbol: tiros y remates',
  Basketball_Totals_Model: 'Básquet: total de puntos',
  Basketball_Handicap_Model: 'Básquet: hándicap',
  Basketball_PlayerProps_Model: 'Básquet: jugadores',
  Baseball_Winner_Model: 'Béisbol: ganador',
  Baseball_RunLine_Model: 'Béisbol: run line',
  Baseball_Totals_Model: 'Béisbol: total de carreras',
};

// [{ id, name, sport, markets: [nombres de los mercados que corrige] }], en el orden de MARKETS.
export const NETWORKS = [];
for (const m of MARKETS) {
  let net = NETWORKS.find((n) => n.id === m.net);
  if (!net) NETWORKS.push((net = { id: m.net, name: NAMES[m.net] || m.net, sport: m.sport, markets: [] }));
  net.markets.push(m.name);
}

export const networkOf = (sport, market) => marketInfo(sport, market)?.net || null;

export class NetworkSet {
  constructor(nets = {}) {
    this.nets = nets; // id -> Corrector
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

  // Estado de cada red: { id, name, markets, trained, samples, meta }.
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
    return { version: 1, featureVersion: FEATURE_VERSION, inputs: FEATURES.length, nets: Object.fromEntries(Object.entries(this.nets).map(([id, net]) => [id, net.toJSON()])) };
  }

  // Redes guardadas con otras variables no se usan (se reentrenan con las filas nuevas).
  static fromJSON(o) {
    if (!o || o.featureVersion !== FEATURE_VERSION || o.inputs !== FEATURES.length) return new NetworkSet();
    return new NetworkSet(Object.fromEntries(Object.entries(o.nets || {}).map(([id, n]) => [id, Corrector.fromJSON(n)])));
  }

  // rows: [{ sport, market, x, pBase, y, start }] (filas de entrenamiento con resultado).
  static train(rows) {
    const byNet = new Map(NETWORKS.map((n) => [n.id, []]));
    for (const r of rows) {
      const id = networkOf(r.sport, r.market);
      if (id && isResult(r.y)) byNet.get(id).push(r);
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
