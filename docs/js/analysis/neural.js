// Red neuronal que aprende de los errores del análisis estadístico.
//
// No predice desde cero: toma la probabilidad del análisis estadístico y le
// suma una corrección (en escala logit) que calcula una red pequeña
// (entrada -> 10 neuronas tanh -> 1, más un camino lineal directo). Al inicio
// la corrección es 0, así que la red da lo mismo que el análisis estadístico.
// Cada vez que se actualizan los resultados se reentrena con todas las
// selecciones ya resueltas; solo aplica la corrección si mejora en partidos que
// no usó para entrenar ni para elegir cuánto entrenar, y por más que el azar.
import { logit, rng, sigmoid } from '../util.js';
import { FEATURE_VERSION } from './features.js';

// Resultado real de una fila: 1 ganó, 0 perdió, 0.75 / 0.25 medias apuestas.
// Ojo: null >= 0 es verdadero en JavaScript; las pendientes (null) no cuentan.
export const isResult = (y) => typeof y === 'number' && y >= 0 && y <= 1;

export const MIN_SAMPLES = 200; // resultados mínimos para empezar a corregir
const MIN_GAIN = 0.01; // la corrección debe bajar el error al menos un 1 %
const MIN_T = 1.65; // y con confianza (prueba t pareada, una cola, ~5 %)
const MIN_STD = 1e-2; // variable casi constante en el entrenamiento: entra como 0
const CLIP = 5; // entradas normalizadas entre -5 y 5 (valores raros no disparan la red)
const CUTS = [0.4, 0.6, 0.8]; // cortes de la validación en el tiempo

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

function bce(p, y) {
  const q = Math.min(1 - 1e-7, Math.max(1e-7, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

export class Corrector {
  constructor({ inputs, hidden = 10, seed = 7 } = {}) {
    this.inputs = inputs;
    this.hidden = hidden;
    this.seed = seed;
    this.reset();
    this.mean = new Array(inputs).fill(0);
    this.std = new Array(inputs).fill(1);
    this.scale = 0;
    this.trained = false;
    this.meta = {};
  }

  reset() {
    const r = rng(this.seed);
    const randn = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    this.W1 = Array.from({ length: this.hidden }, () => Array.from({ length: this.inputs }, () => randn() / Math.sqrt(this.inputs)));
    this.b1 = new Array(this.hidden).fill(0);
    this.W2 = new Array(this.hidden).fill(0); // salida en 0: sin corrección al inicio
    this.V = new Array(this.inputs).fill(0); // camino lineal directo (entrada -> salida)
    this.b2 = 0;
  }

  norm(x) {
    return x.map((v, i) => (this.std[i] > 0 ? Math.max(-CLIP, Math.min(CLIP, (v - this.mean[i]) / this.std[i])) : 0));
  }

  forward(xn) {
    const h = this.W1.map((w, j) => Math.tanh(dot(w, xn) + this.b1[j]));
    return { h, out: dot(this.W2, h) + dot(this.V, xn) + this.b2 };
  }

  correction(x) {
    if (!this.trained || !x || x.length !== this.inputs) return 0;
    return this.scale * this.forward(this.norm(x)).out;
  }

  predict(x, pBase) {
    const d = this.correction(x);
    return d ? sigmoid(logit(pBase) + d) : pBase; // sin corrección, exactamente la del estadístico
  }

  // Pérdida media (log loss) con la corrección multiplicada por `scale`.
  loss(rows, scale = 1) {
    let s = 0;
    for (const r of rows) s += bce(sigmoid(r.b + scale * this.forward(r.xn).out), r.y);
    return rows.length ? s / rows.length : 0;
  }

  // Descenso de gradiente (Adam) sobre todas las filas a la vez.
  fit(rows, { epochs, lr, l2, val = null, patience = 40 }) {
    const H = this.hidden;
    const I = this.inputs;
    const state = { mW1: this.W1.map((r) => r.map(() => 0)), vW1: this.W1.map((r) => r.map(() => 0)), mb1: new Array(H).fill(0), vb1: new Array(H).fill(0), mW2: new Array(H).fill(0), vW2: new Array(H).fill(0), mV: new Array(I).fill(0), vV: new Array(I).fill(0), mb2: 0, vb2: 0 };
    const b1 = 0.9;
    const b2 = 0.999;
    const eps = 1e-8;
    const snapshot = () => ({ W1: this.W1.map((r) => r.slice()), b1: this.b1.slice(), W2: this.W2.slice(), V: this.V.slice(), b2: this.b2 });
    let best = val ? { loss: this.loss(val), params: snapshot(), epoch: 0 } : null;
    const N = rows.length;
    let epoch = 0;
    for (epoch = 1; epoch <= epochs; epoch++) {
      const gW1 = this.W1.map((r) => r.map(() => 0));
      const gb1 = new Array(H).fill(0);
      const gW2 = new Array(H).fill(0);
      const gV = new Array(I).fill(0);
      let gb2 = 0;
      for (const r of rows) {
        const { h, out } = this.forward(r.xn);
        const dz = (sigmoid(r.b + out) - r.y) / N;
        gb2 += dz;
        for (let k = 0; k < I; k++) gV[k] += dz * r.xn[k];
        for (let j = 0; j < H; j++) {
          gW2[j] += dz * h[j];
          const dpre = dz * this.W2[j] * (1 - h[j] * h[j]);
          if (dpre === 0) continue;
          gb1[j] += dpre;
          const row = gW1[j];
          for (let k = 0; k < I; k++) row[k] += dpre * r.xn[k];
        }
      }
      const t = epoch;
      const step = (param, grad, m, v) => {
        const mm = b1 * m + (1 - b1) * grad;
        const vv = b2 * v + (1 - b2) * grad * grad;
        const upd = (lr * (mm / (1 - b1 ** t))) / (Math.sqrt(vv / (1 - b2 ** t)) + eps);
        return [param - upd, mm, vv];
      };
      for (let j = 0; j < H; j++) {
        for (let k = 0; k < I; k++) {
          const g = gW1[j][k] + 2 * l2 * this.W1[j][k];
          [this.W1[j][k], state.mW1[j][k], state.vW1[j][k]] = step(this.W1[j][k], g, state.mW1[j][k], state.vW1[j][k]);
        }
        [this.b1[j], state.mb1[j], state.vb1[j]] = step(this.b1[j], gb1[j], state.mb1[j], state.vb1[j]);
        [this.W2[j], state.mW2[j], state.vW2[j]] = step(this.W2[j], gW2[j] + 2 * l2 * this.W2[j], state.mW2[j], state.vW2[j]);
      }
      for (let k = 0; k < I; k++) [this.V[k], state.mV[k], state.vV[k]] = step(this.V[k], gV[k] + 2 * l2 * this.V[k], state.mV[k], state.vV[k]);
      [this.b2, state.mb2, state.vb2] = step(this.b2, gb2, state.mb2, state.vb2);
      if (val) {
        const l = this.loss(val);
        if (l < best.loss - 1e-6) best = { loss: l, params: snapshot(), epoch };
        else if (epoch - best.epoch > patience) break;
      }
    }
    if (best) Object.assign(this, best.params);
    return best ? best.epoch : epoch - 1;
  }

  // rows: [{ x, pBase, y (0/1), start }]. Devuelve métricas del entrenamiento.
  // Validación en el tiempo: en cada corte (40 %, 60 % y 80 % de los datos en
  // orden cronológico) entrena solo con lo anterior y predice el bloque
  // siguiente, que no vio. La corrección se aplica si en esos bloques juntos (el
  // 60 % más reciente) baja el error al menos un 1 % y la mejora no se explica
  // por azar. El modelo final se entrena con todo.
  train(rows, { epochs = 300, lr = 0.01, l2 = 0.003, patience = 40 } = {}) {
    const data = rows
      .filter((r) => isResult(r.y) && r.x?.length === this.inputs && r.pBase > 0 && r.pBase < 1)
      .sort((a, b) => (a.start || 0) - (b.start || 0))
      .slice(-15000);
    if (data.length < MIN_SAMPLES) {
      this.trained = false;
      this.scale = 0;
      this.meta = { trainedAt: new Date().toISOString(), samples: data.length, reason: `Faltan resultados: ${data.length} de ${MIN_SAMPLES}` };
      return this.meta;
    }
    const opts = { epochs, lr, l2, patience };
    const cuts = [...CUTS.map((f) => Math.round(data.length * f)), data.length];
    const diffs = [];
    let baseSum = 0;
    let nnSum = 0;
    let baseHits = 0;
    let nnHits = 0;
    const folds = [];
    for (let i = 0; i < CUTS.length; i++) {
      const fold = this.fitPast(data.slice(0, cuts[i]), opts);
      folds.push(fold);
      for (const r of data.slice(cuts[i], cuts[i + 1]).map((x) => this.prep(x))) {
        const pb = sigmoid(r.b);
        const pn = sigmoid(r.b + fold.scale * this.forward(r.xn).out);
        diffs.push(bce(pb, r.y) - bce(pn, r.y));
        baseSum += bce(pb, r.y);
        nnSum += bce(pn, r.y);
        baseHits += (pb >= 0.5 ? 1 : 0) === r.y ? 1 : 0;
        nnHits += (pn >= 0.5 ? 1 : 0) === r.y ? 1 : 0;
      }
    }
    const n = diffs.length;
    const baseLoss = baseSum / n;
    const testLoss = nnSum / n;
    const t = tStat(diffs);
    const scale = median(folds.map((f) => f.scale));
    const bestEpoch = Math.round(median(folds.map((f) => f.epoch)));
    const accepted = scale > 0 && testLoss <= baseLoss * (1 - MIN_GAIN) && t >= MIN_T;
    const metrics = {
      baseLoss,
      nnLoss: accepted ? testLoss : baseLoss,
      testLoss,
      t,
      baseAccuracy: baseHits / n,
      nnAccuracy: (accepted ? nnHits : baseHits) / n,
      test: n,
    };

    // Modelo final con todos los datos (incluidos los más recientes).
    if (accepted) {
      this.setNorm(data);
      this.reset();
      this.fit(data.map((x) => this.prep(x)), { epochs: bestEpoch, lr, l2 });
    }
    this.scale = accepted ? scale : 0;
    this.trained = accepted;
    this.meta = { trainedAt: new Date().toISOString(), samples: data.length, epochs: bestEpoch, scale: this.scale, ...roundAll(metrics) };
    return this.meta;
  }

  prep(r) {
    return { xn: this.norm(r.x), b: logit(r.pBase), y: r.y };
  }

  // Entrena con `past`: el 80 % más antiguo para aprender y el resto para
  // elegir cuántas vueltas y cuánta corrección (0 si no mejora).
  fitPast(past, opts) {
    const nVal = Math.max(20, Math.round(past.length * 0.2));
    const older = past.slice(0, -nVal);
    this.setNorm(older);
    const val = past.slice(-nVal).map((x) => this.prep(x));
    this.reset();
    const epoch = Math.max(5, this.fit(older.map((x) => this.prep(x)), { ...opts, val }));
    let scale = 0;
    let best = this.loss(val, 0);
    for (const s of [0.25, 0.5, 0.75, 1]) {
      const l = this.loss(val, s);
      if (l < best - 1e-6) [scale, best] = [s, l];
    }
    return { epoch, scale };
  }

  setNorm(data) {
    this.mean = new Array(this.inputs).fill(0);
    const v = new Array(this.inputs).fill(0);
    for (const r of data) r.x.forEach((x, i) => (this.mean[i] += x / data.length));
    for (const r of data) r.x.forEach((x, i) => (v[i] += (x - this.mean[i]) ** 2 / data.length));
    this.std = v.map((x) => (Math.sqrt(x) < MIN_STD ? 0 : Math.sqrt(x)));
  }

  toJSON() {
    const r = (v) => Math.round(v * 1e5) / 1e5;
    return {
      version: 1,
      featureVersion: FEATURE_VERSION,
      inputs: this.inputs,
      hidden: this.hidden,
      W1: this.W1.map((row) => row.map(r)),
      b1: this.b1.map(r),
      W2: this.W2.map(r),
      V: this.V.map(r),
      b2: r(this.b2),
      mean: this.mean.map(r),
      std: this.std.map(r),
      scale: this.scale,
      trained: this.trained,
      meta: this.meta,
    };
  }

  static fromJSON(o) {
    const net = new Corrector({ inputs: o.inputs, hidden: o.hidden });
    Object.assign(net, { W1: o.W1, b1: o.b1, W2: o.W2, V: o.V || new Array(o.inputs).fill(0), b2: o.b2, mean: o.mean, std: o.std, scale: o.scale, trained: o.trained, meta: o.meta || {} });
    if (o.featureVersion !== FEATURE_VERSION) net.trained = false; // variables distintas: no aplicar
    return net;
  }
}

// t de la media de las diferencias (mejora por fila): media / error estándar.
function tStat(d) {
  const n = d.length;
  if (n < 2) return 0;
  const m = d.reduce((a, b) => a + b, 0) / n;
  const v = d.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  return v > 0 ? m / Math.sqrt(v / n) : m > 0 ? Infinity : 0;
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function roundAll(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v]));
}
