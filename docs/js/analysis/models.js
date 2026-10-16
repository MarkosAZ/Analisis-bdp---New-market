// Modelos estadísticos. A partir de los últimos partidos de cada equipo
// (Sofascore) estiman la probabilidad de cada selección:
//  - goals: goles esperados de cada equipo y distribución de Poisson
//    (fútbol, hockey, béisbol, balonmano...). En las 5 grandes ligas se
//    combina con el xG de Understat.
//  - points: margen y total esperados con distribución normal (básquet...).
//  - tennis: ranking, forma reciente y H2H.
//  - generic: forma reciente y H2H.
import { clamp, logit, normCdf, sigmoid } from '../util.js';
import { isHalfLine } from './markets.js';
import { baseballModel } from './baseball.js';

const DECAY = 0.85; // peso de cada partido anterior respecto del siguiente

// Resumen ponderado (más peso a lo reciente) de los últimos `n` partidos.
export function teamForm(matches = [], { n = 10, home = null, decay = DECAY } = {}) {
  const list = matches.filter((m) => m.gf != null && m.ga != null && (home == null || m.home === home)).slice(0, n);
  if (!list.length) return null;
  let w = 0;
  let gf = 0;
  let ga = 0;
  let pts = 0;
  let wins = 0;
  list.forEach((m, k) => {
    const wk = decay ** k;
    w += wk;
    gf += wk * m.gf;
    ga += wk * m.ga;
    pts += wk * (m.r === 'W' ? 3 : m.r === 'D' ? 1 : 0);
    wins += wk * (m.r === 'W' ? 1 : 0);
  });
  return { n: list.length, gf: gf / w, ga: ga / w, ppg: pts / w, winRate: wins / w, last5: list.slice(0, 5).map((m) => m.r) };
}

// Forma general mezclada con la de local (o de visitante) si hay datos.
// weight: peso de los partidos de local (o de visita).
function venueForm(matches, isHome, { decay = DECAY, venue: weight = 0.4 } = {}) {
  const all = teamForm(matches, { decay });
  if (!all) return null;
  const venue = teamForm(matches, { home: isHome, decay });
  if (!venue || venue.n < 3 || !weight) return all;
  return { ...all, gf: (1 - weight) * all.gf + weight * venue.gf, ga: (1 - weight) * all.ga + weight * venue.ga };
}

const quality = (fh, fa) => (fh && fa ? Math.min(1, Math.min(fh.n, fa.n) / 10) : 0);

// ---- Goles: Poisson ----

function poisson(lambda, max) {
  const p = new Array(max + 1);
  p[0] = Math.exp(-lambda);
  for (let k = 1; k <= max; k++) p[k] = (p[k - 1] * lambda) / k;
  return p;
}

// Probabilidad de cada marcador. En fútbol se corrigen los marcadores bajos
// (Dixon-Coles), que la Poisson simple subestima.
export function scoreMatrix(lh, la, { dixonColes = false, rho = -0.08 } = {}) {
  const max = Math.ceil(Math.max(lh, la) + 8 * Math.sqrt(Math.max(lh, la)) + 3);
  const ph = poisson(lh, max);
  const pa = poisson(la, max);
  const m = ph.map((x) => pa.map((y) => x * y));
  if (dixonColes) {
    m[0][0] *= 1 - lh * la * rho;
    m[0][1] *= 1 + lh * rho;
    m[1][0] *= 1 + la * rho;
    m[1][1] *= 1 - rho;
  }
  const total = m.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  return m.map((row) => row.map((x) => x / total));
}

export function scoreOutcomes(m) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let homeZero = 0;
  let awayZero = 0;
  const totals = [];
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
      if (i === 0) homeZero += p;
      if (j === 0) awayZero += p;
      totals[i + j] = (totals[i + j] || 0) + p;
    }
  }
  const btts = 1 - homeZero - awayZero + m[0][0];
  const over = (line) => totals.reduce((s, p, k) => (k > line ? s + p : s), 0);
  const handicap = (line) => {
    let p = 0;
    for (let i = 0; i < m.length; i++) for (let j = 0; j < m[i].length; j++) if (i - j + line > 0) p += m[i][j];
    return p;
  };
  return { home, draw, away, btts, over, handicap };
}

// Ajustes del modelo de goles del fútbol (los demás deportes de goles usan GOALS y
// la ventaja de local de sports.js).
//  prior: partidos "virtuales" con la media de ambos equipos (con pocos partidos,
//    acercar a la media).
//  ha: ventaja de local (goles esperados del local / de la visita).
//  xgWeight: peso del xG de Understat (5 grandes ligas).
//  rho: corrección de Dixon-Coles de los marcadores bajos.
//  venue / decay: peso de los partidos de local (o de visita) en la forma y de cada
//    partido anterior respecto del siguiente.
//  stretch: separa (>1) o junta (<1) los goles de los dos equipos sin cambiar el total.
//  totalScale: corrige el total esperado.
//  ouT / bttsT: calibración final del Más/Menos y de ambos anotan en escala logit
//    (<1 acerca al 50 %: el modelo se pasaba de seguro); bttsShift: corrección del
//    nivel de ambos anotan.
// Elegidos con la prueba retrospectiva de unos 15 000 partidos (ver README).
export const FOOTBALL = { prior: 3, ha: 1.3, xgWeight: 0.7, rho: -0.12, venue: 0.2, decay: 0.95, stretch: 1.1, totalScale: 1, ouT: 0.7, bttsT: 0.5, bttsShift: 0.05 };
const GOALS = { prior: 3, xgWeight: 0.5, rho: -0.08, venue: 0.4, decay: DECAY, stretch: 1, totalScale: 1, ouT: 1, bttsT: 1, bttsShift: 0 };
const calibrate = (p, t = 1, shift = 0) => (t === 1 && !shift ? p : sigmoid(t * logit(clamp(p, 1e-6, 1 - 1e-6)) + shift));

export function goalsModel(ev, d, cfg, ctx = {}, opts = {}) {
  const o = ev.sport === 'football' ? { ...FOOTBALL, ...opts } : { ...GOALS, ha: cfg.ha || 1.08, ...opts };
  const fh = venueForm(d.lastHome || [], true, o);
  const fa = venueForm(d.lastAway || [], false, o);
  if (!fh || !fa) return null;
  const n = Math.min(fh.n, fa.n);
  // Goles promedio por equipo en los partidos de ambos: referencia de la liga.
  const mu = clamp((fh.gf + fh.ga + fa.gf + fa.ga) / 4, 0.2, 60);
  const ha = cfg.neutral ? 1 : o.ha;
  const shrink = (x) => (n * x + o.prior * mu) / (n + o.prior); // con pocos partidos, acercar a la media
  let lh = (shrink(fh.gf) * shrink(fa.ga)) / mu;
  let la = (shrink(fa.gf) * shrink(fh.ga)) / mu;
  lh *= Math.sqrt(ha);
  la /= Math.sqrt(ha);
  let usedXg = false;
  if (ctx.xg?.home?.xgFor != null && ctx.xg?.away?.xgFor != null && o.xgWeight > 0) {
    const xh = ((ctx.xg.home.xgFor + ctx.xg.away.xgAgainst) / 2) * 1.05;
    const xa = ((ctx.xg.away.xgFor + ctx.xg.home.xgAgainst) / 2) / 1.05;
    lh = (1 - o.xgWeight) * lh + o.xgWeight * xh;
    la = (1 - o.xgWeight) * la + o.xgWeight * xa;
    usedXg = true;
  }
  lh *= o.totalScale;
  la *= o.totalScale;
  if (o.stretch !== 1) {
    const g = Math.sqrt(lh * la);
    lh = g * (lh / g) ** o.stretch;
    la = g * (la / g) ** o.stretch;
  }
  lh = clamp(lh, 0.05, mu * 4);
  la = clamp(la, 0.05, mu * 4);
  const o2 = scoreOutcomes(scoreMatrix(lh, la, { dixonColes: ev.sport === 'football', rho: o.rho }));
  const c = [];
  if (cfg.draw) {
    c.push(['1X2', 'home', null, o2.home], ['1X2', 'draw', null, o2.draw], ['1X2', 'away', null, o2.away]);
    if (cfg.dc) c.push(['DC', '1X', null, o2.home + o2.draw], ['DC', 'X2', null, o2.draw + o2.away], ['DC', '12', null, o2.home + o2.away]);
  } else {
    // Sin empate (prórroga o extra innings): el empate se reparte casi a medias.
    const share = cfg.neutral ? 0.5 : 0.53;
    c.push(['ML', 'home', null, o2.home + share * o2.draw], ['ML', 'away', null, o2.away + (1 - share) * o2.draw]);
  }
  for (const line of new Set([...(cfg.lines || []), ...(ctx.lines?.OU || [])])) {
    if (!isHalfLine(line) || line <= 0) continue;
    const p = calibrate(o2.over(line), o.ouT);
    c.push(['OU', 'over', line, p], ['OU', 'under', line, 1 - p]);
  }
  if (cfg.btts) {
    const p = calibrate(o2.btts, o.bttsT, o.bttsShift);
    c.push(['BTTS', 'yes', null, p], ['BTTS', 'no', null, 1 - p]);
  }
  for (const line of ctx.lines?.HCP || []) {
    if (!isHalfLine(line)) continue;
    const p = o2.handicap(line);
    c.push(['HCP', 'home', line, p], ['HCP', 'away', line, 1 - p]);
  }
  return {
    kind: 'goals',
    quality: quality(fh, fa),
    form: { home: fh, away: fa },
    expected: { home: lh, away: la, total: lh + la, sdTotal: Math.sqrt(lh + la), margin: lh - la, sdMargin: Math.sqrt(lh + la), xg: usedXg },
    strength: (fh.gf - fh.ga - (fa.gf - fa.ga)) / (2 * mu),
    candidates: c.map(([market, sel, line, p]) => ({ market, sel, line, p: clamp(p, 0.001, 0.999) })),
  };
}

// ---- Puntos: normal ----

// Ajustes del modelo de puntos del básquet (los demás deportes de puntos usan los
// de sports.js).
//  marginShrink: partidos "virtuales" con margen 0 (acerca el margen a 0).
//  sdMargin / sdTotal: desvío del margen y del total, como fracción del total.
//  ha: ventaja de local en puntos. venue / decay: como en el fútbol.
// Elegidos con la prueba retrospectiva de 3 temporadas de la NBA (ver README): frente
// a líneas puestas con la media reciente el modelo casi no tiene ventaja, así que
// los desvíos son amplios (no inventa ventajas).
export const BASKETBALL = { decay: 0.9, venue: 0.2, marginShrink: 0, ha: 1.5, sdMargin: 0.1, sdTotal: 0.12 };

export function pointsModel(ev, d, cfg, ctx = {}, opts = {}) {
  const o = ev.sport === 'basketball' ? { ...BASKETBALL, ...opts } : { decay: DECAY, venue: 0.4, marginShrink: 2, ha: cfg.ha || 0, sdMargin: cfg.sdMargin || 0.055, sdTotal: cfg.sdTotal || 0.08, ...opts };
  const fh = venueForm(d.lastHome || [], true, o);
  const fa = venueForm(d.lastAway || [], false, o);
  if (!fh || !fa) return null;
  const n = Math.min(fh.n, fa.n);
  const total = (fh.gf + fa.ga) / 2 + (fa.gf + fh.ga) / 2;
  const margin = (((fh.gf - fh.ga) - (fa.gf - fa.ga)) / 2) * (n / (n + o.marginShrink)) + (cfg.neutral ? 0 : o.ha);
  const sdM = cfg.sdMarginAbs || Math.max(4, o.sdMargin * total);
  const sdT = cfg.sdTotalAbs || Math.max(5, o.sdTotal * total);
  const pHome = normCdf(margin / sdM);
  const c = [
    ['ML', 'home', null, pHome],
    ['ML', 'away', null, 1 - pHome],
  ];
  for (const line of ctx.lines?.OU || []) {
    if (!isHalfLine(line)) continue;
    const p = 1 - normCdf((line - total) / sdT);
    c.push(['OU', 'over', line, p], ['OU', 'under', line, 1 - p]);
  }
  for (const line of ctx.lines?.HCP || []) {
    if (!isHalfLine(line)) continue;
    const p = normCdf((margin + line) / sdM);
    c.push(['HCP', 'home', line, p], ['HCP', 'away', line, 1 - p]);
  }
  return {
    kind: 'points',
    quality: quality(fh, fa),
    form: { home: fh, away: fa },
    expected: { home: (total + margin) / 2, away: (total - margin) / 2, total, sdTotal: sdT, margin, sdMargin: sdM },
    strength: margin / sdM,
    candidates: c.map(([market, sel, line, p]) => ({ market, sel, line, p: clamp(p, 0.001, 0.999) })),
  };
}

// ---- Tenis y resto: ganador ----

function smoothedWinRate(f) {
  return f ? (f.winRate * f.n + 1) / (f.n + 2) : null;
}

function winnerModel(ev, d, cfg, { useRanking }) {
  const parts = []; // [logit a favor del local, peso]
  if (useRanking && ev.home?.ranking && ev.away?.ranking) {
    parts.push([0.75 * (Math.log(ev.away.ranking) - Math.log(ev.home.ranking)), 0.6]);
  }
  const fh = teamForm(d.lastHome || []);
  const fa = teamForm(d.lastAway || []);
  if (fh && fa) parts.push([logit(smoothedWinRate(fh)) - logit(smoothedWinRate(fa)), 0.4]);
  const h2h = d.h2h;
  if (h2h && h2h.homeWins + h2h.awayWins >= 2) parts.push([Math.log((h2h.homeWins + 1) / (h2h.awayWins + 1)), 0.2]);
  if (!parts.length) return null;
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  let z = parts.reduce((s, [l, w]) => s + l * w, 0) / weight;
  if (!cfg.neutral) z += 0.15; // ventaja de local
  const pHome = sigmoid(clamp(z, -4, 4));
  return {
    kind: useRanking ? 'tennis' : 'generic',
    quality: fh && fa ? Math.min(1, Math.min(fh.n, fa.n) / 10) * (useRanking && ev.home?.ranking ? 1 : 0.7) : 0.3,
    form: { home: fh, away: fa },
    expected: null,
    strength: z,
    candidates: [
      { market: 'ML', sel: 'home', line: null, p: clamp(pHome, 0.001, 0.999) },
      { market: 'ML', sel: 'away', line: null, p: clamp(1 - pHome, 0.001, 0.999) },
    ],
  };
}

export const tennisModel = (ev, d, cfg) => winnerModel(ev, d, cfg, { useRanking: true });
export const genericModel = (ev, d, cfg) => winnerModel(ev, d, cfg, { useRanking: false });

export function predict(ev, details, cfg, ctx) {
  const d = details || {};
  // Béisbol: carreras con los abridores, el bullpen y el contexto (baseball.js).
  if (ev.sport === 'baseball') return baseballModel(ev, d, cfg, ctx);
  switch (cfg.model) {
    case 'goals':
      return goalsModel(ev, d, cfg, ctx);
    case 'points':
      return pointsModel(ev, d, cfg, ctx);
    case 'tennis':
      return tennisModel(ev, d, cfg);
    default:
      return genericModel(ev, d, cfg);
  }
}
