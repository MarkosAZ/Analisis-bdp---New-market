// Más/Menos de jugador (básquet). Con los últimos partidos de cada jugador
// (ESPN o Sofascore) se estima la probabilidad de pasar la línea, y con el box
// score del partido terminado (rec.players) se liquida la apuesta. Los nombres
// cambian entre fuentes ("L. James", "James, LeBron", "Luka Dončić",
// "Jaren Jackson Jr."), así que se comparan normalizados y por partes.
import { clamp, mean, sum } from '../util.js';

// Campos del partido que suma cada estadística (con '-' delante se restan).
export const PLAYER_STATS = {
  pl_pts: ['pts'],
  pl_reb: ['reb'],
  pl_ast: ['ast'],
  pl_3pm: ['tpm'],
  pl_stl: ['stl'],
  pl_blk: ['blk'],
  pl_tov: ['tov'],
  pl_oreb: ['oreb'],
  pl_dreb: ['dreb'],
  pl_ftm: ['ftm'],
  pl_2pm: ['fgm', '-tpm'],
  pl_pra: ['pts', 'reb', 'ast'],
  pl_pr: ['pts', 'reb'],
  pl_pa: ['pts', 'ast'],
  pl_ra: ['reb', 'ast'],
  pl_sb: ['stl', 'blk'],
};

const toNum = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));

// Valor de una estadística en la fila de un partido, o null si falta alguna parte.
export function statValue(row, code) {
  const parts = PLAYER_STATS[code];
  if (!row || !parts || row.dnp) return null;
  let v = 0;
  for (const part of parts) {
    const neg = part.startsWith('-');
    const x = toNum(row[neg ? part.slice(1) : part]);
    if (x == null) return null;
    v += neg ? -x : x;
  }
  return v;
}

// ---- Nombres ----

const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
// Letras que NFD no separa de su marca.
const LETTERS = { đ: 'd', ð: 'd', ł: 'l', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i', þ: 'th' };

function words(s) {
  return String(s ?? '')
    .replace(/\.(?=\p{Lu}\p{Ll})/gu, ' ') // "L.James" → "L James" ("P.J." queda "PJ")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[đðłøßæœıþ]/g, (c) => LETTERS[c])
    .replace(/['’`´.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !SUFFIX.has(w));
}

// "Jaren Jackson Jr." → "jaren jackson"; "James, LeBron" → "lebron james"; "Dončić" → "doncic".
export function normName(s) {
  const parts = String(s ?? '')
    .split(',')
    .map(words)
    .filter((p) => p.length);
  return (parts.length === 2 ? [...parts[1], ...parts[0]] : parts.flat()).join(' ');
}

const tokens = (s) => (s ? normName(s).split(' ').filter(Boolean) : []);

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Dos nombres de pila: iguales (3), abreviatura "Cam" = "Cameron" (2), inicial "L." = "LeBron" (1).
function givenWord(x, y) {
  if (x === y) return 3;
  if (x.length === 1 || y.length === 1) return x[0] === y[0] ? 1 : 0;
  return Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x)) ? 2 : 0;
}

// Lo que queda antes del apellido. Cada palabra de la lista más corta debe ir, en orden,
// con una de la otra (puede sobrar un segundo nombre), y la primera con la primera.
// Sin nombre de pila en alguno de los dos: 0 (solo apellido). Incompatibles: -1.
function givenScore(ra, rb) {
  if (!ra.length || !rb.length) return 0;
  const [short, long] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  if (short.join('') === long.join('')) return 3 * long.length; // "PJ" = "P J"
  if (short.length === 1 && long.length > 1 && short[0] === long.map((w) => w[0]).join('')) return 1; // "KA" = Karl-Anthony
  let j = 0;
  let total = 0;
  for (let i = 0; i < short.length; i++) {
    let s = 0;
    for (; j < long.length && !s; j++) {
      s = givenWord(short[i], long[j]);
      if (!s && i === 0) return -1;
    }
    if (!s) return -1;
    total += s;
  }
  return total;
}

// Parecido entre dos nombres ya separados en palabras: a = el buscado, b = el
// candidato. 0: no es el mismo; −1: mismo apellido pero se contradicen (otro
// nombre de pila, o el buscado trae palabras que el candidato no tiene, como
// "intentados Stephen Curry" o "LeBron James y Jayson Tatum"). El apellido (las
// últimas palabras) suma 10 por palabra (8 con un error de tipeo), más lo que
// sumen los nombres de pila. Mismo nombre: 100.
function nameScore(a, b) {
  if (!a.length || !b.length) return 0;
  if (a.join('') === b.join('')) return 100;
  if (a.length > 1 && [...a].reverse().join('') === b.join('')) return 90; // "Yang Hansen" = "Hansen Yang"
  let i = a.length - 1;
  let j = b.length - 1;
  let sur = 0;
  while (i >= 0 && j >= 0) {
    if (a[i] === b[j]) sur += 10;
    else if (!sur && Math.min(a[i].length, b[j].length) >= 6 && levenshtein(a[i], b[j]) <= 1) sur += 8;
    else break;
    i--;
    j--;
  }
  if (!sur) return 0;
  if (i >= 0 && j < 0 && b.length > 1) return -1; // palabras de más en el buscado
  const given = givenScore(a.slice(0, i + 1), b.slice(0, j + 1));
  return given < 0 ? -1 : sur + given;
}

// Jugador de `players` ([{ name, short }] o nombres) que corresponde a `name`, o null si
// ninguno o si dos empatan (p. ej. "J. Williams" con Jalen y Jaylin Williams).
export function matchPlayer(name, players = []) {
  const a = tokens(name);
  if (!a.length) return null;
  const queries = [a];
  if (a.length > 1 && a[a.length - 1].length === 1) queries.push([a[a.length - 1], ...a.slice(0, -1)]); // "James L."
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const p of players || []) {
    if (!p) continue;
    const full = tokens(typeof p === 'string' ? p : p.name);
    // Si el nombre completo contradice al buscado ("Jalen" frente a "Jaylin"
    // Williams), el corto ("J. Williams") no lo salva: es otro jugador.
    const scores = queries.map((q) => nameScore(q, full));
    if (scores.every((x) => x < 0)) continue;
    let score = Math.max(0, ...scores);
    if (typeof p !== 'string' && p.short) for (const q of queries) score = Math.max(score, nameScore(q, tokens(p.short)));
    if (score > bestScore) {
      best = p;
      bestScore = score;
      tie = false;
    } else if (score && score === bestScore) tie = true;
  }
  return tie ? null : best;
}

// ---- Liga (para pedir los datos a ESPN) ----

// Torneos con "NBA" en el nombre que ESPN no tiene como NBA: G League, Liga de Verano, NBA 2K...
const NOT_LEAGUE = new Set(['g', 'summer', 'verano', 'development', 'dleague', '2k', 'esports', 'ebasketball']);

// 'nba' | 'wnba' | null según el torneo y la categoría del partido.
export function basketballLeague(ev) {
  if (!ev || (ev.sport && ev.sport !== 'basketball')) return null;
  const nameOf = (x) => (typeof x === 'string' ? x : x?.name);
  const w = [nameOf(ev.tournament), nameOf(ev.category), ev.league].flatMap(words);
  if (w.some((x) => NOT_LEAGUE.has(x))) return null;
  if (w.includes('wnba')) return 'wnba';
  if (w.includes('nba')) return 'nba';
  return null;
}

// ---- Probabilidad ----

const DECAY = 0.9; // peso de cada partido anterior respecto del siguiente
const SHRINK = 2; // partidos "virtuales" con la media simple (encogimiento leve)
const MIN_MEAN = 0.05; // nunca se descarta del todo que sume (p. ej. 0 tapones en 10 partidos)

// P(X > línea) con media y varianza dadas: binomial negativa si la varianza supera a
// la media; si no, Poisson. Se suma en logaritmos para no perder precisión.
export function overProbability(m, variance, line) {
  if (line < 0) return 1;
  if (!(m > 0)) return 0;
  const k = variance > m ? (m * m) / (variance - m) : Infinity;
  const poisson = !(k < 1e7);
  const r = poisson ? 0 : m / (k + m); // 1 - q de la binomial negativa
  let logP = poisson ? -m : k * Math.log1p(-r);
  let cdf = Math.exp(logP);
  for (let i = 1; i <= Math.floor(line); i++) {
    logP += poisson ? Math.log(m / i) : Math.log(((k + i - 1) * r) / i);
    cdf += Math.exp(logP);
  }
  return clamp(1 - cdf, 0, 1);
}

// Probabilidad de una selección ('over' | 'under') de un Más/Menos de jugador con sus
// últimos partidos jugados (`games`, del más reciente al más antiguo). Usa los últimos
// `maxGames` con dato; los recientes pesan más (0.9 por partido). La media ponderada se
// acerca un poco a la simple (2 partidos virtuales: con pocos partidos pesa más) y la
// varianza ponderada suma la incertidumbre de la media (v / n efectivo).
// Devuelve { p, mean, sd, n, trend, minutes } o null con menos de `minGames` partidos.
//   sd: desviación de la distribución usada; trend: (media de los 3 últimos − media) / sd;
//   minutes: media simple de minutos (null si la fuente no los trae).
export function playerProbability(games, code, sel, line, { minGames = 5, maxGames = 10 } = {}) {
  const L = line == null || line === '' ? NaN : Number(line);
  if (!PLAYER_STATS[code] || (sel !== 'over' && sel !== 'under') || !Number.isFinite(L)) return null;
  const list = (games || [])
    .filter((g) => g && !g.dnp && !(toNum(g.min) != null && toNum(g.min) <= 0))
    .map((g) => ({ v: statValue(g, code), min: g.min }))
    .filter((g) => g.v != null)
    .slice(0, maxGames);
  const n = list.length;
  if (!n || n < minGames) return null;
  const xs = list.map((g) => g.v);
  const w = xs.map((_, k) => DECAY ** k);
  const W = sum(w);
  const W2 = sum(w.map((x) => x * x));
  const mw = sum(xs.map((x, k) => w[k] * x)) / W;
  const m0 = (n * mw + SHRINK * mean(xs)) / (n + SHRINK);
  const m = Math.max(MIN_MEAN, m0);
  const v = n > 1 ? sum(xs.map((x, k) => w[k] * (x - mw) ** 2)) / (W - W2 / W) : 0;
  const variance = v * (1 + W2 / (W * W));
  const sd = Math.sqrt(Math.max(variance, m));
  const pOver = overProbability(m, variance, L);
  const mins = list.map((g) => toNum(g.min)).filter((x) => x != null);
  return {
    p: clamp(sel === 'over' ? pOver : 1 - pOver, 0.001, 0.999),
    mean: m,
    sd,
    n,
    trend: sd > 0 ? clamp((mean(xs.slice(0, 3)) - m0) / sd, -3, 3) : 0,
    minutes: mean(mins),
  };
}

// ---- Liquidación ----

// Valor del jugador en el partido terminado: { value } | { dnp: true } (no jugó: la casa
// anula) | null (sin box score o jugador no encontrado: queda pendiente).
export function playerValue(rec, name, code) {
  const players = rec?.players;
  if (!players || typeof players !== 'object' || name == null) return null;
  let key = Object.hasOwn(players, String(name)) ? String(name) : null;
  if (key == null) key = matchPlayer(String(name), Object.keys(players));
  const row = key == null ? null : players[key];
  if (!row) return null;
  // Solo la fuente dice si no jugó: con 0 minutos redondeados pudo entrar unos
  // segundos (para la casa jugó y la apuesta vale).
  if (row.dnp) return { dnp: true };
  const value = statValue(row, code);
  return value == null ? null : { value };
}
