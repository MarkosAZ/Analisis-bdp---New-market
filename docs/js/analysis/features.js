// Variables que recibe la red neuronal por cada selección analizada. Se
// guardan junto al resultado real para que la red aprenda de sus errores.
// Si se cambia esta lista hay que subir FEATURE_VERSION (las filas antiguas
// con otra versión se ignoran al entrenar).
import { clamp, logit } from '../util.js';
import { sideOf } from './markets.js';
import { sentiment } from './news.js';

// 3: una red por mercado (networks.js) y probabilidad solo con la estadística.
// Las filas anteriores se calcularon mezclando el modelo con las cuotas: no se
// usan para entrenar (upgradeFeatures devuelve null).
// 4: análisis estadístico del fútbol ajustado con los partidos históricos (goles
// calibrados, dispersión de tarjetas y remates): la probabilidad base cambió.
export const FEATURE_VERSION = 4;

export const FEATURES = [
  'logitBase', // probabilidad del análisis estadístico (escala logit)
  'dMarket', // lo que dicen las cuotas respecto de la base (solo referencia)
  'hasMarket',
  'lnOdds', // log de la cuota
  'quality', // cantidad de partidos con datos (0 a 1)
  'zLine', // distancia de la línea a lo esperado, en desvíos, a favor de la selección
  'lnLine', // tamaño de la línea (log), p. ej. 9.5 córners o 24.5 puntos
  'side', // +1 Más / Sí / local, −1 Menos / No / visitante
  'isH1', // mercado del 1.er tiempo
  'isPlayer', // mercado de jugador
  'sideStrength', // fuerza relativa del lado elegido (hándicap y ganador)
  'sideForm', // forma reciente del lado elegido
  'sideH2H',
  'sideMissing', // bajas del rival menos bajas propias
  'sideVotes', // votos de los usuarios de Sofascore
  'trend', // últimos partidos frente al promedio (a favor de la selección)
  'minutes', // minutos por partido del jugador / 36
  'newsAvail', // hay noticias cargadas (Flashscore, ESPN, FotMob)
  'sideNewsMentions', // menciones del lado elegido frente al rival
  'sideNewsInjuries', // noticias de lesiones/sanciones del rival menos las propias
  'sideNewsSentiment', // tono de las noticias (positivo − negativo)
  'newsInjuriesTotal', // noticias de lesiones de ambos (para totales)
  'viaSim', // probabilidad por simulación
];

// Filas guardadas con otra versión: no se usan (otra forma de calcular la base).
export function upgradeFeatures(x, fv) {
  return fv === FEATURE_VERSION && x?.length === FEATURES.length ? x : null;
}

function votesFor(c, side, votes) {
  if (!votes) return null;
  if (c.market === '1X2' && c.sel === 'draw') return votes.draw;
  if (c.market === 'DC' && c.sel === '12') return votes.home + votes.away;
  if (side === 0 || !['1X2', 'ML', 'DC', 'HCP'].includes(c.market)) return null;
  const base = side > 0 ? votes.home : votes.away;
  return c.market === 'DC' ? base + votes.draw : base;
}

const SIDE = { over: 1, yes: 1, home: 1, under: -1, no: -1, away: -1 };

// c: { market, sel, line, pModel, pMarket, pBase, price, z, trend, minutes, via }
// ctx: { sport, cfg, model (salida de predict o null), details, spec, quality }
export function buildFeatures(c, ctx) {
  const side = sideOf(c.market, c.sel);
  const dir = SIDE[c.sel] ?? 0;
  const base = logit(c.pBase);
  const m = ctx.model;
  const d = ctx.details || {};
  const f = m?.form;
  const spec = ctx.spec;

  let sideForm = 0;
  if (f?.home && f?.away) {
    const diff = ctx.cfg?.model === 'goals' && ctx.cfg?.draw ? (f.home.ppg - f.away.ppg) / 3 : f.home.winRate - f.away.winRate;
    sideForm = side * diff;
  }
  const h = d.h2h;
  const h2h = h ? (h.homeWins - h.awayWins) / (h.homeWins + h.awayWins + h.draws + 2) : 0;
  const miss = d.missing ? (d.missing.away.length - d.missing.home.length) / 5 : 0;
  const pv = votesFor(c, side, d.votes);
  const votes = pv == null ? 0 : clamp(logit(clamp(pv, 0.02, 0.98)) / 3, -2, 2);
  const news = d.news || null;
  const nh = news?.home;
  const na = news?.away;
  const x = [
    clamp(base, -6, 6),
    c.pMarket != null ? clamp(logit(c.pMarket) - base, -4, 4) : 0,
    c.pMarket != null ? 1 : 0,
    clamp(Math.log(c.price || 1), 0, 3),
    ctx.quality ?? m?.quality ?? 0,
    clamp(c.z ?? 0, -4, 4),
    c.line != null ? clamp(Math.log1p(Math.abs(c.line)), 0, 6) : 0,
    dir,
    spec?.scope === 'h1' ? 1 : 0,
    spec?.n != null && /^pl_/.test(spec.stat) ? 1 : 0,
    side * clamp(m?.strength ?? 0, -3, 3),
    sideForm,
    side * h2h,
    side * clamp(miss, -2, 2),
    votes,
    clamp(c.trend ?? 0, -3, 3),
    clamp((c.minutes ?? 0) / 36, 0, 1.5),
    news ? 1 : 0,
    news ? side * clamp(Math.log1p(nh.n) - Math.log1p(na.n), -3, 3) : 0,
    news ? side * clamp((na.injuries - nh.injuries) / 2, -2, 2) : 0,
    news ? side * (sentiment(nh) - sentiment(na)) : 0,
    news ? clamp(Math.log1p(nh.injuries + na.injuries), 0, 3) : 0,
    c.via === 'simulación' ? 1 : 0,
  ];
  return x.map((v) => Math.round(v * 1000) / 1000);
}
