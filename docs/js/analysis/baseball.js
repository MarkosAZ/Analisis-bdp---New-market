// Béisbol: carreras esperadas de cada equipo a partir de
//  - la ofensiva reciente del equipo (carreras anotadas en sus últimos partidos),
//  - el pitcheo del rival: su abridor (sus últimas aperturas: carreras por 9
//    entradas y FIP, y cuántas entradas suele lanzar) y, en el resto del partido,
//    su bullpen (lo que permite el equipo en sus últimos partidos, peor si los
//    relevistas lanzaron mucho en los 3 días anteriores),
//  - el contexto: localía, estadio (carreras de local frente a visita), clima
//    (temperatura y viento) y los últimos enfrentamientos entre ambos.
// Las carreras de un equipo varían más que una Poisson: binomial negativa
// (tamaño 4, como en la MLB: media ~4.4 y desvío ~3.1 por equipo y partido).
import { clamp } from '../util.js';
import { isHalfLine } from './markets.js';
import { scoreOutcomes, teamForm } from './models.js';

export const MLB_RA9 = 4.4; // carreras por equipo y partido (9 entradas) en la MLB

// ¿Partido de la MLB? (sus abridores y contexto salen de la API oficial de la MLB).
export const isMlb = (ev) => ev?.sport === 'baseball' && /\bmlb\b/i.test([ev.tournament?.name, ev.category?.name, ev.league].filter(Boolean).join(' '));
const NB_SIZE = 4;
const START_DECAY = 0.85; // peso de cada apertura anterior respecto de la siguiente
const PRIOR_IP = 30; // entradas "virtuales" con la media de la liga (pocas aperturas → cerca de la media)
const FIP_CONST = 3.15; // constante del FIP (escala de carreras limpias)
const RA_PER_ER = 1.08; // carreras totales por carrera limpia

// Forma general mezclada con la de local (o de visitante) si hay datos.
function venueForm(matches, isHome) {
  const all = teamForm(matches);
  if (!all) return null;
  const venue = teamForm(matches, { home: isHome });
  if (!venue || venue.n < 3) return all;
  return { ...all, gf: 0.6 * all.gf + 0.4 * venue.gf, ga: 0.6 * all.ga + 0.4 * venue.ga };
}

// Perfil del abridor con sus últimas aperturas (más recientes primero):
// { ra9, rawRa9, fip, ip, n } — ra9: carreras que se esperan por 9 entradas (la mitad
// carreras reales y la mitad FIP, acercadas a la media de la liga según las entradas
// lanzadas); ip: entradas que suele lanzar por apertura.
export function starterProfile(starts = [], lgRa9 = MLB_RA9) {
  const list = (starts || []).filter((s) => s && s.ip > 0).slice(0, 10);
  if (!list.length) return null;
  let w = 0;
  let ip = 0;
  let r = 0;
  let fipNum = 0;
  list.forEach((s, k) => {
    const wk = START_DECAY ** k;
    w += wk;
    ip += wk * s.ip;
    r += wk * (s.r ?? 0);
    fipNum += wk * (13 * (s.hr ?? 0) + 3 * ((s.bb ?? 0) + (s.hbp ?? 0)) - 2 * (s.k ?? 0));
  });
  const rawRa9 = (9 * r) / ip;
  const fip = (fipNum / ip + FIP_CONST) * RA_PER_ER;
  const raw = 0.5 * rawRa9 + 0.5 * Math.max(0, fip);
  const ra9 = (raw * ip + lgRa9 * PRIOR_IP) / (ip + PRIOR_IP);
  const perStart = ip / w;
  const n = list.length;
  return { ra9, rawRa9, fip, ip: clamp((perStart * n + 5.2 * 2) / (n + 2), 3.5, 7.5), n };
}

// Bullpen cansado (muchas entradas de los relevistas en los 3 días anteriores) o descansado.
export function bullpenFactor(pen) {
  if (!pen || !(pen.games >= 0)) return 1;
  if (pen.ip >= 12) return 1.06;
  if (pen.ip >= 9) return 1.03;
  if (pen.games === 0 || pen.ip <= 3) return 0.98;
  return 1;
}

// Clima al aire libre: más calor y viento hacia afuera → más carreras.
// weather: { condition, temp (°F), wind ("10 mph, Out To CF") }.
export function weatherFactor(weather) {
  if (!weather || /dome|roof closed|techo cerrado/i.test(weather.condition || '')) return 1;
  let f = 1;
  if (Number.isFinite(weather.temp)) f *= clamp(1 + 0.002 * (weather.temp - 70), 0.95, 1.05);
  const m = String(weather.wind || '').match(/(\d+)\s*mph,\s*(out to|in from)/i);
  if (m) {
    const mph = Number(m[1]);
    f *= /out/i.test(m[2]) ? Math.min(1.06, 1 + 0.004 * mph) : Math.max(0.94, 1 - 0.004 * mph);
  }
  return f;
}

// Últimos enfrentamientos (hasta 8, de los 2 últimos años): carreras promedio de cada
// uno (los recientes pesan más) → { n, home, away } o null con menos de 3.
export function h2hRuns(games = [], now = Date.now()) {
  const list = (games || []).filter((g) => g.gf != null && g.ga != null && now - g.start < 730 * 86400000 && g.start < now).slice(0, 8);
  if (list.length < 3) return null;
  let w = 0;
  let h = 0;
  let a = 0;
  list.forEach((g, k) => {
    const wk = 0.85 ** k;
    w += wk;
    h += wk * g.gf;
    a += wk * g.ga;
  });
  return { n: list.length, home: h / w, away: a / w };
}

// Probabilidad de 0..max carreras con una binomial negativa de media `mean`.
export function nbPmf(mean, size = NB_SIZE, max = 30) {
  const p = new Array(max + 1).fill(0);
  if (!(mean > 0)) {
    p[0] = 1;
    return p;
  }
  const q = mean / (size + mean);
  p[0] = (size / (size + mean)) ** size;
  for (let k = 1; k <= max; k++) p[k] = (p[k - 1] * (k - 1 + size) * q) / k;
  const s = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / s);
}

// Entradas extra (empate tras 9): el local gana el 52 % (casi siempre por 1, con
// walk-off); la visita a veces por más. Margen (local − visita) y carreras que se suman.
const EXTRA = [
  { m: 1, t: 1, p: 0.44 },
  { m: 2, t: 2, p: 0.05 },
  { m: 1, t: 3, p: 0.03 },
  { m: -1, t: 1, p: 0.2 },
  { m: -1, t: 3, p: 0.08 },
  { m: -2, t: 2, p: 0.12 },
  { m: -3, t: 3, p: 0.08 },
];

// ML, Más/Menos y run line con las carreras esperadas de cada equipo (9 entradas)
// y las entradas extra si empatan.
export function runsOutcomes(lh, la) {
  const ph = nbPmf(lh);
  const pa = nbPmf(la);
  const m = ph.map((x) => pa.map((y) => x * y));
  const o = scoreOutcomes(m);
  const tie = o.draw;
  const over = (line) => {
    let p = o.over(line);
    // Empates: el total final es el de 9 entradas más lo de las extra.
    for (let i = 0; i < m.length; i++) {
      const pt = m[i][i];
      if (!pt) continue;
      const T = 2 * i;
      for (const e of EXTRA) if (T <= line && T + e.t > line) p += pt * e.p;
    }
    return p;
  };
  const handicap = (line) => {
    let p = 0;
    for (let i = 0; i < m.length; i++) for (let j = 0; j < m[i].length; j++) if (i !== j && i - j + line > 0) p += m[i][j];
    for (const e of EXTRA) if (e.m + line > 0) p += tie * e.p;
    return p;
  };
  const homeExtra = EXTRA.filter((e) => e.m > 0).reduce((s, e) => s + e.p, 0);
  return { home: o.home + tie * homeExtra, away: o.away + tie * (1 - homeExtra), tie, over, handicap };
}

// Modelo del béisbol: devuelve lo mismo que goalsModel (models.js) y, además,
// `baseball` con lo usado (abridores, bullpen, estadio, clima, enfrentamientos).
export function baseballModel(ev, d, cfg, ctx = {}) {
  const fh = venueForm(d.lastHome || [], true);
  const fa = venueForm(d.lastAway || [], false);
  if (!fh || !fa) return null;
  const n = Math.min(fh.n, fa.n);
  // Carreras por equipo y partido de estos equipos: referencia (en la MLB, junto a la de la liga).
  const mlb = d.mlb || null;
  const teamsMu = clamp((fh.gf + fh.ga + fa.gf + fa.ga) / 4, 1.5, 12);
  const mu = mlb ? 0.5 * teamsMu + 0.5 * MLB_RA9 : teamsMu;
  const shrink = (x) => (n * x + 3 * mu) / (n + 3);
  const lg = mlb ? MLB_RA9 : mu;
  // Pitcheo que enfrenta cada ofensiva: abridor del rival en sus entradas y bullpen en el resto.
  const pitching = (side, teamAllowed) => {
    const sp = starterProfile(mlb?.[side]?.pitcher?.starts, lg);
    const pen = bullpenFactor(mlb?.[side]?.bullpen);
    const bullpen = teamAllowed * pen;
    const allowed = sp ? (sp.ip / 9) * sp.ra9 + (1 - sp.ip / 9) * bullpen : bullpen;
    return { starter: sp, name: mlb?.[side]?.pitcher?.name || null, penFactor: pen, bullpenIp: mlb?.[side]?.bullpen?.ip ?? null, allowed };
  };
  const homeP = pitching('home', shrink(fh.ga));
  const awayP = pitching('away', shrink(fa.ga));
  const ha = cfg.neutral ? 1 : cfg.ha || 1.04;
  let lh = (shrink(fh.gf) * awayP.allowed) / mu;
  let la = (shrink(fa.gf) * homeP.allowed) / mu;
  lh *= Math.sqrt(ha);
  la /= Math.sqrt(ha);
  // Últimos enfrentamientos: un poco de peso a lo que anotó cada uno contra el otro.
  const h2h = h2hRuns(d.h2hGames, ev.start || Date.now());
  if (h2h) {
    const w = 0.15 * Math.min(1, h2h.n / 6);
    lh = (1 - w) * lh + w * shrink(h2h.home);
    la = (1 - w) * la + w * shrink(h2h.away);
  }
  // Estadio (la forma de local ya trae una parte) y clima.
  const pf = mlb?.park?.factor;
  const park = Number.isFinite(pf) ? 1 + 0.5 * (clamp(pf, 0.8, 1.3) - 1) : 1;
  const weather = weatherFactor(mlb?.weather);
  lh = clamp(lh * park * weather, 0.3, 15);
  la = clamp(la * park * weather, 0.3, 15);

  const o = runsOutcomes(lh, la);
  const c = [
    ['ML', 'home', null, o.home],
    ['ML', 'away', null, o.away],
  ];
  for (const line of new Set([...(cfg.lines || []), ...(ctx.lines?.OU || [])])) {
    if (!isHalfLine(line) || line <= 0) continue;
    const p = o.over(line);
    c.push(['OU', 'over', line, p], ['OU', 'under', line, 1 - p]);
  }
  for (const line of ctx.lines?.HCP || []) {
    if (!isHalfLine(line)) continue;
    const p = o.handicap(line);
    c.push(['HCP', 'home', line, p], ['HCP', 'away', line, 1 - p]);
  }
  const variance = (x) => x + (x * x) / NB_SIZE;
  const sd = Math.sqrt(variance(lh) + variance(la));
  const starters = Number(Boolean(homeP.starter)) + Number(Boolean(awayP.starter));
  return {
    kind: 'goals',
    quality: Math.min(1, n / 10) * (mlb ? 0.85 + 0.075 * starters : 0.85),
    form: { home: fh, away: fa },
    expected: { home: lh, away: la, total: lh + la, sdTotal: sd, margin: lh - la, sdMargin: sd },
    strength: (lh - la) / sd,
    baseball: { home: homeP, away: awayP, park: Number.isFinite(pf) ? { factor: pf, n: mlb.park.n } : null, weather: mlb?.weather || null, weatherFactor: weather, h2h, series: mlb?.series || null, venue: mlb?.venue || null },
    candidates: c.map(([market, sel, line, p]) => ({ market, sel, line, p: clamp(p, 0.001, 0.999) })),
  };
}
