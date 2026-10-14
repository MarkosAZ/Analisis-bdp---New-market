// Prueba de punta a punta de la página: con la extensión simulada (PC) y sin
// extensión, con datos automáticos y token de GitHub simulados (celular).
// Uso: NODE_PATH=$(npm root -g) node tests/e2e/run.cjs [carpeta-capturas]
// Requiere Playwright (con Chromium) y Python 3 para servir docs/.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'tests/e2e/capturas'));
const PORT = 8123;
const URL = `http://localhost:${PORT}/`;
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-extension.js'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'OK ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- Datos automáticos (data/fuente) y API de GitHub simulados ----

async function fixtures() {
  const { compactDay, compactResult } = await import(pathToFileURL(path.join(ROOT, 'docs/js/data-format.js')).href);
  const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  const next = new Date(`${DAY}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const TOMORROW = next.toISOString().slice(0, 10);
  const at = (h) => Date.parse(`${DAY}T05:00:00Z`) + h * 3600000;
  const ev = (id, league, country, alpha2, priority, home, away, hour) => ({
    id: `fs:${id}`,
    sport: 'football',
    start: at(hour),
    tournament: { id: league.toLowerCase().replace(/\W+/g, '-'), name: league, priority },
    category: { name: country, alpha2 },
    home: { id: `${id}h`, name: home },
    away: { id: `${id}a`, name: away },
    state: 'pendiente',
    score: null,
  });
  const events = [
    ev('e1', 'Liga 1', 'PERÚ', 'PE', 990, 'Alianza Lima', 'Sporting Cristal', 13),
    ev('e2', 'Liga 1', 'PERÚ', 'PE', 990, 'Universitario', 'Melgar', 15),
    ev('e3', 'Liga 1', 'PERÚ', 'PE', 990, 'Cienciano', 'ADT', 18),
    ev('e4', 'Premier League', 'INGLATERRA', 'EN', 1000, 'Arsenal', 'Chelsea', 11),
  ];
  const last = (goals) => goals.map(([gf, ga], i) => ({ start: at(-24 * (i + 3)), home: i % 2 === 0, gf, ga, r: gf > ga ? 'W' : gf < ga ? 'L' : 'D' }));
  const strong = last([[3, 0], [2, 1], [2, 0], [1, 1], [3, 1], [2, 0], [1, 0], [2, 2], [4, 1], [2, 1]]);
  const weak = last([[0, 2], [1, 1], [0, 1], [1, 3], [0, 0], [1, 2], [0, 2], [2, 2], [0, 1], [1, 2]]);
  const o = (market, sel, line, price) => ({ source: 'apuestatotal', market, sel, line, price });
  // 1X2 y doble oportunidad no se analizan; de goles se usa la 2.5 (la más pareja).
  const book = (h, d, a) => [o('1X2', 'home', null, h), o('1X2', 'draw', null, d), o('1X2', 'away', null, a), o('DC', '1X', null, 1.08), o('OU', 'over', 2.5, 1.8), o('OU', 'under', 2.5, 1.95), o('OU', 'over', 1.5, 1.25), o('OU', 'under', 1.5, 3.6), o('BTTS', 'yes', null, 1.95), o('BTTS', 'no', null, 1.85)];
  const football = compactDay({
    date: DAY,
    sport: 'football',
    generated: new Date(Date.now() - 35 * 60000).toISOString(),
    events,
    offers: { 'fs:e1': book(1.35, 4.8, 8.5), 'fs:e2': book(1.5, 4.0, 6.5), 'fs:e4': book(1.45, 4.5, 6.8) },
    details: Object.fromEntries(['e1', 'e2', 'e4'].map((id) => [`fs:${id}`, { lastHome: strong, lastAway: weak, h2h: { homeWins: 4, draws: 1, awayWins: 1 } }])),
  });
  const generated = football.generated;
  const files = {
    'indice.json': { generated, today: DAY, days: { [DAY]: { football: { events: 4, withOdds: 3 }, basketball: { events: 1, withOdds: 0 } }, [TOMORROW]: {} } },
    [`${DAY}/football.json`]: football,
    [`${DAY}/basketball.json`]: compactDay({
      date: DAY,
      sport: 'basketball',
      generated,
      events: [{ ...ev('b1', 'NBA', 'EE. UU.', 'US', 1000, 'Lakers', 'Celtics', 20), sport: 'basketball' }],
    }),
    'noticias.json': {
      generated,
      items: [
        ['espn', 'Alianza Lima pierde a su arquero por lesión', '', Math.round(at(-10) / 1000), 'soccer'],
        ['flashscore', 'Universitario recupera a dos titulares', '', Math.round(at(-5) / 1000), 'soccer'],
      ],
    },
    [`resultados/${DAY}.json`]: {
      'fs:e1': compactResult({ state: 'finalizado', score: { home: 2, away: 0 } }),
      'fs:e2': compactResult({ state: 'finalizado', score: { home: 0, away: 1 } }),
      'fs:e4': compactResult({ state: 'finalizado', score: { home: 3, away: 1 } }),
    },
  };
  return { DAY, files };
}

// API de contenidos de GitHub en memoria.
const BIG_FILE = 3000; // en la prueba, los archivos de más de 3 KB se tratan como los de más de 1 MB
function githubMock(context) {
  const files = new Map();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS' };
  let sha = 0;
  context.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new globalThis.URL(req.url());
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers().authorization !== 'Bearer github_pat_prueba') return json(401, { message: 'Bad credentials' });
    if (url.pathname === '/repos/MarkosAZ/Analisis-bdp---New-market') return json(200, { permissions: { push: true } });
    const blob = url.pathname.match(/^\/repos\/MarkosAZ\/Analisis-bdp---New-market\/git\/blobs\/(.+)$/);
    if (blob) {
      const f = [...files.values()].find((x) => x.sha === blob[1]);
      return f ? json(200, { content: Buffer.from(f.text).toString('base64'), encoding: 'base64', sha: f.sha }) : json(404, { message: 'Not Found' });
    }
    const m = url.pathname.match(/^\/repos\/MarkosAZ\/Analisis-bdp---New-market\/contents\/(.+)$/);
    if (!m) return json(404, {});
    const file = decodeURIComponent(m[1]);
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      files.set(file, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `s${++sha}` });
      return json(200, { content: { sha: files.get(file).sha } });
    }
    const f = files.get(file);
    if (!f) return json(404, { message: 'Not Found' });
    // Como GitHub con los archivos de más de 1 MB: sin contenido; se lee el blob.
    if (f.text.length > BIG_FILE) return json(200, { content: '', encoding: 'none', sha: f.sha, size: f.text.length });
    return json(200, { content: Buffer.from(f.text).toString('base64'), encoding: 'base64', sha: f.sha });
  });
  return files;
}

async function withoutExtension(browser, errors) {
  const { DAY, files } = await fixtures();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-PE', timezoneId: 'America/Lima', isMobile: true, hasTouch: true });
  await context.route('**/data/fuente/**', (route) => {
    const rel = new globalThis.URL(route.request().url()).pathname.split('/data/fuente/')[1];
    return files[rel] ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(files[rel]) }) : route.fulfill({ status: 404, body: '' });
  });
  const repo = githubMock(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`(sin extensión) ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && !m.text().includes('401') && errors.push(`(sin extensión) ${m.text()}`));

  await page.goto(URL);
  await page.waitForSelector('.league');
  check('sin extensión usa los datos automáticos', (await page.textContent('.segmented button.active')) === 'Automático');
  check('sin extensión la fuente Sofascore está desactivada', await page.$eval('.segmented button:has-text("Sofascore")', (b) => b.disabled));
  check('muestra cuándo se actualizaron los datos', (await page.textContent('.source-bar')).includes('hace 35 min'), await page.textContent('.source-bar'));
  const leagues = await page.$$eval('.league .name', (els) => els.map((e) => e.textContent));
  check('ligas automáticas ordenadas por importancia', leagues.join(',') === 'Premier League,Liga 1', leagues.join(', '));
  await page.click('.league:has-text("Liga 1") .league-title');
  const shown = await page.$$eval('.league:has-text("Liga 1") .match', (els) => els.length);
  check('"Solo con cuotas" oculta los partidos sin cuotas', shown === 2 && (await page.$$('.odds-badge')).length === 2, `${shown} partidos`);
  const chips = await page.$$eval('.sport', (els) => els.map((e) => e.textContent));
  check('solo muestra los deportes publicados', chips.length === 2 && chips[0].includes('Fútbol'), chips.join(' | '));
  await page.screenshot({ path: path.join(OUT, '6-celular-automatico.png'), fullPage: false });

  // Token de GitHub en Ajustes
  await page.click('#open-settings');
  await page.fill('input[name="ghToken"]', 'github_pat_prueba');
  await page.click('#gh-save');
  await page.waitForFunction(() => document.querySelector('#gh-status').textContent.includes('Conectado'), null, { timeout: 10000 });
  check('el token de GitHub se guarda y se prueba', true);
  await page.click('#settings button[value="cancel"]');
  check('indica que guarda en GitHub', (await page.textContent('#ext-status')).includes('GitHub'));

  // Análisis sin extensión
  await page.click('.league:has-text("Premier League") .league-head input');
  await page.click('.league:has-text("Liga 1") .league-head input');
  check('sin extensión se puede analizar', !(await page.$eval('#run-both', (b) => b.disabled)));
  check('en el celular los botones usan nombres cortos', (await page.innerText('#run-both')).trim() === 'Ambos');
  await page.click('#run-both');
  await page.waitForSelector('#tab-analisis .summary h2', { timeout: 30000 });
  await page.waitForSelector('.chip:has-text("Guardado en el historial")', { timeout: 30000 });
  const summary = await page.textContent('#tab-analisis .summary');
  check('analiza con estadísticas y cuotas publicadas', summary.includes('3 partidos analizados') && /Flashscore · 3 partidos/.test(summary) && /Apuesta Total · 3 partidos \(publicadas\)/.test(summary), summary.slice(0, 200));
  const cards = await page.$$('#tab-analisis .mrow');
  check('hay picks con datos automáticos', cards.length > 0, `${cards.length} mercados`);
  check('guarda el análisis en GitHub', repo.has(`docs/data/historial/${DAY}.json`) && repo.has('docs/data/historial/index.json'), [...repo.keys()].join(', '));
  const saved = JSON.parse(repo.get(`docs/data/historial/${DAY}.json`).text).analyses.map((a) => a.method);
  check('"Ambos" guarda los dos análisis por separado', saved.sort().join() === 'estadistico,red_neuronal', saved.join(', '));
  check('"Ambos" compara los dos con los mismos partidos', (await page.textContent('#tab-analisis .compare')).includes('Coinciden'));
  await page.click('#tab-analisis .segmented button:has-text("Red neuronal")');
  check('muestra el análisis con red neuronal', (await page.textContent('#tab-analisis .summary h2')) === 'Análisis con red neuronal');
  await page.screenshot({ path: path.join(OUT, '7-celular-analisis.png'), fullPage: false });

  // Liquidación con los resultados publicados
  await page.click('.tabs button[data-tab="historial"]');
  await page.waitForSelector('.day');
  check('el historial muestra que guarda en GitHub', (await page.textContent('#tab-historial .banner')).includes('Guardando en GitHub'));
  await page.evaluate(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + 36 * 3600000;
  });
  await page.click('text=Actualizar resultados');
  await page.waitForFunction(() => /Resultados:|No hay partidos|No se pudieron/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 });
  const toast = await page.textContent('#toast');
  check('liquida con los resultados publicados', /Resultados: [1-9]\d* apuestas liquidadas/.test(toast), toast);
  await page.waitForTimeout(500);
  await page.click('.day-head');
  await page.waitForSelector('.day-body .status-pill');
  const pills = await page.$$eval('.day-body .status-pill', (els) => els.map((e) => e.textContent));
  check('sin apuestas pendientes tras liquidar', pills.length > 0 && !pills.includes('Pendiente'), pills.join(', '));
  const bigFiles = [...repo.entries()].filter(([, f]) => f.text.length > BIG_FILE).map(([p]) => p);
  const trainRows = JSON.parse(repo.get(`docs/data/entrenamiento/${DAY.slice(0, 7)}.json`).text).rows;
  check('los archivos grandes se leen completos (sin perder filas)', bigFiles.length > 0 && trainRows.length > 0 && trainRows.some((r) => r.y != null), `${bigFiles.join(', ')} · ${trainRows.length} filas`);
  check('los resultados quedan en GitHub', JSON.parse(repo.get(`docs/data/historial/${DAY}.json`).text).analyses.every((a) => a.picks.every((p) => p.status !== 'pending')));
  const index = JSON.parse(repo.get('docs/data/historial/index.json').text).days[DAY];
  check('el resumen guarda los resultados de cada método', index.methods.estadistico.won + index.methods.estadistico.lost > 0 && index.methods.red_neuronal.won + index.methods.red_neuronal.lost > 0, JSON.stringify(index.methods).slice(0, 160));
  await page.click('#tab-historial .segmented button:has-text("Red neuronal")');
  check('el detalle del día se filtra por método', (await page.$$('.day-body .method-tag.estadistico')).length === 0 && (await page.$$('.day-body .method-tag.red_neuronal')).length === 1);
  // Aciertos del día por nivel de confianza: en la cabecera y en la tabla del día abierto.
  const levelChips = await page.$$eval('.day-line .chip.lvl', (els) => els.map((e) => e.textContent.trim()));
  check('cada día cuenta los aciertos por nivel', levelChips.length > 0 && levelChips.every((t) => /^(Alta|Mod-alta|Moderada|Baja|Combinadas) \d+\/\d+/.test(t)), levelChips.join(' | '));
  const dayTable = await page.textContent('.day-body .day-table');
  check('el día abierto muestra la tabla por nivel', /Red neuronal: aciertos del día por nivel/.test(dayTable) && /Total picks/.test(dayTable), dayTable.replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: path.join(OUT, '8-celular-historial.png'), fullPage: false });
  await page.click('.tabs button[data-tab="partidos"]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('sin desplazamiento horizontal (automático, celular)', !overflow);
  await context.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', path.join(ROOT, 'docs')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-PE', timezoneId: 'America/Lima' });
    await context.addInitScript(MOCK);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text())); // 404: datos publicados que no existen en la prueba

    // 1) Partidos
    await page.goto(URL);
    await page.waitForSelector('.league');
    check('detecta la extensión', (await page.getAttribute('#ext-status .chip:has-text("Extensión")', 'title')).includes('9.9.9'));
    check('con la extensión empieza con Sofascore', (await page.textContent('.segmented button.active')) === 'Sofascore');
    const leagues = await page.$$eval('.league .name', (els) => els.map((e) => e.textContent));
    check('muestra las ligas de fútbol ordenadas por importancia', leagues.join(',') === 'Premier League,Serie A,Liga 1', leagues.join(', '));
    const times = await page.$$eval('.league:has-text("Liga 1") .match .time', (els) => els.map((e) => e.textContent));
    check('partidos de cada liga ordenados por hora', times.join() === [...times].sort().join(), times.join(' '));
    await page.click('.league:has-text("Premier League") .league-head input');
    await page.click('.league:has-text("Liga 1") .league-head input');
    await page.click('.sport:has-text("Básquet")');
    await page.waitForSelector('.league:has-text("NBA")');
    await page.click('.league:has-text("NBA") .league-head input');
    const sportChips = await page.$$eval('.sport', (els) => els.map((e) => e.textContent));
    check('solo fútbol, básquet y béisbol', sportChips.length === 3 && ['Fútbol', 'Básquet', 'Béisbol'].every((n, i) => sportChips[i].includes(n)), sportChips.join(' | '));
    await page.click('.sport:has-text("Béisbol")');
    await page.waitForSelector('.league:has-text("MLB")');
    await page.click('.league:has-text("MLB") .league-head input');
    await page.click('.sport:has-text("Fútbol")');
    await page.waitForSelector('.match');
    const count = await page.textContent('#sel-count');
    check('marca ligas completas de varios deportes', count.startsWith('11 '), count);
    check('no deja marcar partidos ya empezados', await page.$eval('.league:has-text("Serie A") .league-head input', (el) => el.disabled));
    await page.screenshot({ path: path.join(OUT, '1-partidos.png'), fullPage: true });

    // 2) Análisis estadístico
    await page.click('#run-stats');
    await page.waitForSelector('#tab-analisis .summary h2', { timeout: 60000 });
    await page.waitForSelector('.chip:has-text("Guardado en el historial")', { timeout: 30000 });
    const summary = await page.textContent('#tab-analisis .summary');
    check('analiza los 11 partidos', summary.includes('11 partidos analizados'), summary.slice(0, 120));
    check('Apuesta Total emparejada', /Apuesta Total · \d+ partidos/.test(summary), summary.match(/Apuesta Total[^A-Z]*/)?.[0]);
    check('Betano emparejada aunque falle en otros deportes', /Betano · \d+ partidos/.test(summary), summary.match(/Betano[^A-Z]*/)?.[0]);
    const log = await page.evaluate(() => window.__BDP_MOCK_LOG__);
    check('abre la página de cada partido de Betano (todos los mercados)', log.includes('betano.getEventMarkets'));
    check('suma las estadísticas de equipo de Flashscore a los partidos de Sofascore', log.includes('flashscore.getTeamFeeds') && /Flashscore · \d+ partidos/.test(summary), summary.match(/Flashscore[^A-Z]*/)?.[0]);
    // Filas de entrenamiento guardadas en el navegador: solo los mercados de la lista.
    const rowMarkets = await page.evaluate(async () => {
      const st = await import(new URL('js/storage.js', location.href).href);
      const out = new Set();
      for (const p of await st.localPaths()) if (p.includes('entrenamiento')) for (const r of (await st.read(p))?.rows || []) out.add(r.market);
      return [...out];
    });
    const LIST = ['OU', 'BTTS', 'OU.corners', 'HCP.corners', 'OU.cards', 'OU.shots_on', 'OU.shots', 'OU.corners@h1', 'HCP', 'HCP@h1', 'OU@h1', 'ML'];
    check(
      'solo analiza los mercados de la lista (goles, córners, hándicap de córners, tarjetas, tiros, hándicap, ganador, jugador)',
      ['OU', 'OU.corners', 'HCP.corners', 'OU.cards', 'OU.shots_on', 'HCP', 'ML'].every((m) => rowMarkets.includes(m)) && rowMarkets.every((m) => LIST.includes(m) || /^OU\.pl_/.test(m)),
      rowMarkets.join(' '),
    );
    check('analiza los Más/Menos de jugador de Betano con los datos de ESPN', rowMarkets.some((m) => m.startsWith('OU.pl_pts#LeBron James')) && rowMarkets.some((m) => m.startsWith('OU.pl_pra#')), rowMarkets.filter((m) => m.startsWith('OU.pl_')).join(' '));
    check('analiza los jugadores de Apuesta Total (asistencias y triples)', rowMarkets.some((m) => m.startsWith('OU.pl_ast#')) && rowMarkets.some((m) => m.startsWith('OU.pl_3pm#') && !m.endsWith('#por')), rowMarkets.filter((m) => /^OU\.pl_(ast|3pm)#/.test(m)).join(' '));
    check('básquet: 1.er tiempo con las líneas extra .5 de Apuesta Total (la principal es entera)', rowMarkets.includes('OU@h1') && rowMarkets.includes('HCP@h1'), rowMarkets.filter((m) => m.includes('@h1')).join(' '));
    check('"Double-double" no se analiza como Más/Menos', !rowMarkets.some((m) => /double/i.test(m)));
    const levels = await page.$$eval('#tab-analisis .mrow', (rows) => rows.map((c) => c.className));
    const combos = await page.$$('#tab-analisis .card.combo');
    const matchCards = await page.$$('#tab-analisis .match-card');
    check(
      'cada partido con todos sus mercados y su nivel (también Baja), y combinadas',
      levels.some((c) => / alta$/.test(c)) && levels.some((c) => c.includes('baja')) && combos.length > 0 && matchCards.length > 0,
      `${matchCards.length} partidos · ${levels.length} mercados · ${combos.length} combinadas`,
    );
    // Por deporte y, dentro, por liga (en orden alfabético).
    const sportHeads = await page.$$eval('#tab-analisis .grp-sport', (els) => els.map((e) => e.firstChild.textContent.trim()));
    const leagueHeads = await page.$$eval('#tab-analisis .sport-group', (gs) => gs.map((g) => [...g.querySelectorAll('.grp-league')].map((e) => e.firstChild.textContent.trim())));
    const sortedOk = leagueHeads.every((ls) => ls.join('|') === [...ls].sort((a, b) => a.localeCompare(b, 'es')).join('|'));
    check('partidos por deporte y, dentro, por liga en orden', sportHeads[0] === '⚽ Fútbol' && sportHeads.length >= 2 && sortedOk && leagueHeads[0].length >= 2, `${sportHeads.join(', ')} · ${leagueHeads.map((l) => l.join(' / ')).join(' || ')}`);
    // Cada partido de fútbol con los 8 mercados de la lista (con su apuesta o el motivo por el que no hay).
    const footballRows = await page.$$eval('#tab-analisis .sport-group:first-child .match-card', (cards) => cards.map((c) => [...c.children].filter((e) => e.classList.contains('mrow')).length));
    const missing = await page.$$eval('#tab-analisis .mrow.missing .meta', (els) => els.map((e) => e.textContent));
    check('cada partido de fútbol muestra los 8 mercados de la lista', footballRows.length > 0 && footballRows.every((n) => n === 8), footballRows.join(', '));
    check('los mercados sin apuesta dicen por qué', missing.length > 0 && missing.every((t) => /línea \.5|sin \.5|datos suficientes/.test(t)), [...new Set(missing)].join(' | '));
    await page.click('#tab-analisis .segmented.sports button:has-text("Básquet")');
    const onlyBasket = await page.$$eval('#tab-analisis .grp-sport', (els) => els.map((e) => e.firstChild.textContent.trim()));
    check('el filtro por deporte muestra solo ese deporte', onlyBasket.join() === '🏀 Básquet', onlyBasket.join(', '));
    await page.screenshot({ path: path.join(OUT, '2b-analisis-basquet.png'), fullPage: false });
    await page.click('#tab-analisis .segmented.sports button:has-text("Todos")');
    const playerRows = await page.$$eval('.match-card h4', (els) => els.map((e) => e.textContent));
    check('los mercados de jugador van aparte en su partido', playerRows.some((t) => /^Jugadores \(\d+\)$/.test(t)), playerRows.join(' | '));
    await page.click('#tab-analisis .segmented.levels:not(.sports) button:has-text("Baja")');
    const onlyLow = await page.$$eval('#tab-analisis .mrow', (rows) => rows.map((c) => c.className));
    check('el filtro por nivel muestra solo ese nivel', onlyLow.length > 0 && onlyLow.every((c) => c.includes('baja')), `${onlyLow.length} filas`);
    await page.click('#tab-analisis .segmented.levels:not(.sports) button:has-text("Todos")');
    const comboText = await page.$$eval('.card.combo .odds', (els) => els.map((e) => Number(e.textContent)));
    check('las combinadas alcanzan la cuota objetivo', comboText.length > 0 && comboText.every((o) => o >= 5), comboText.join(', '));
    await page.screenshot({ path: path.join(OUT, '2-analisis.png'), fullPage: true });
    await page.click('text=Copiar picks');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check('copia los picks como texto, por deporte y liga', / vs /.test(copied) && copied.includes('@') && /\((Alta|Moderada-alta|Moderada|Baja)\)/.test(copied) && copied.includes('⚽ Fútbol') && /\n— /.test(copied), copied.split('\n').slice(0, 5).join(' | '));

    // 3) Historial
    await page.click('.tabs button[data-tab="historial"]');
    await page.waitForSelector('.day');
    check('el historial guarda el día con picks pendientes', (await page.textContent('.day')).includes('pendientes'));
    check('avisa que se guarda solo en el navegador', (await page.textContent('#tab-historial .banner')).includes('solo en este navegador'));

    // 4) Actualizar resultados (se adelanta el reloj para que los partidos hayan terminado)
    await page.evaluate(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 36 * 3600000;
    });
    await page.click('text=Actualizar resultados');
    await page.waitForFunction(() => /Resultados:|No hay partidos|No se pudieron/.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const toast = await page.textContent('#toast');
    check('liquida las apuestas con los resultados', /Resultados: \d+ apuestas liquidadas/.test(toast), toast);
    await page.waitForTimeout(500);
    await page.click('.day-head');
    await page.waitForSelector('.day-body .status-pill.won, .day-body .status-pill.lost');
    const pills = await page.$$eval('.day-body .status-pill', (els) => els.map((e) => e.textContent));
    check('marca ganadas y perdidas', pills.includes('Ganada') && pills.includes('Perdida') && !pills.includes('Pendiente'), `${pills.length} apuestas`);
    // Detalle del día por deporte y liga, con filtro por deporte.
    const [histSports, histLeagues] = await page.$eval('.day-body .analysis-block', (b) => [
      [...b.querySelectorAll('.grp-sport')].map((e) => e.textContent.trim()),
      [...b.querySelector('.hist-sport').querySelectorAll('.grp-league')].map((e) => e.textContent.trim()),
    ]);
    check('el detalle del día va por deporte y liga', histSports[0] === '⚽ Fútbol' && histSports.length >= 2 && histLeagues.length >= 2 && histLeagues.join('|') === [...histLeagues].sort((a, b) => a.localeCompare(b, 'es')).join('|'), `${histSports.join(', ')} · ${histLeagues.join(' / ')}`);
    await page.click('#tab-historial .segmented.sports button:has-text("Béisbol")');
    const histBaseball = await page.$$eval('.day-body .grp-sport', (els) => [...new Set(els.map((e) => e.textContent.trim()))]);
    check('el detalle del día se filtra por deporte', histBaseball.join() === '⚾ Béisbol', histBaseball.join(', '));
    await page.screenshot({ path: path.join(OUT, '3e-historial-beisbol.png'), fullPage: false });
    await page.click('#tab-historial .segmented.sports button:has-text("Todos")');
    const table = await page.textContent('.panel table');
    check('calcula aciertos y ganancia por nivel', /%/.test(table), table.replace(/\s+/g, ' ').slice(0, 160));
    const netPanel = await page.textContent('.panel:has(h3:text-is("Redes especializadas"))');
    const netIds = ['Football_Goals_Model', 'Football_Corners_Model', 'Football_CornersH1_Model', 'Football_ShotsOnTarget_Model', 'Basketball_TotalsH1_Model', 'Basketball_PlayerPoints_Model', 'Basketball_PlayerFieldGoalsAttempted_Model', 'Baseball_Totals_Model'];
    check(
      'las redes especializadas registran los resultados de su mercado',
      netIds.every((id) => netPanel.includes(id)) && !netPanel.includes('Basketball_PlayerProps_Model') && /[1-9]\d*\/200/.test(netPanel),
      netPanel.replace(/\s+/g, ' ').slice(0, 260),
    );
    const netRows = await page.$$eval('.nets-table tbody tr:not(.net-group)', (els) => els.length);
    const netGroups = await page.$$eval('.nets-table tr.net-group th', (els) => els.map((e) => e.firstChild.textContent.trim()));
    check('36 redes (15 de mercado y 21 de jugador), agrupadas', netRows === 36 && netGroups.join() === 'Fútbol,Básquet,Béisbol,Básquet: jugadores', `${netRows} redes · ${netGroups.join(', ')}`);
    await page.screenshot({ path: path.join(OUT, '3-historial.png'), fullPage: true });
    await (await page.$('.nets-panel')).screenshot({ path: path.join(OUT, '3d-redes.png') });

    // 5) Análisis con red neuronal
    await page.click('#run-nn');
    await page.waitForSelector('#tab-analisis .summary h2:has-text("red neuronal")', { timeout: 60000 });
    const nnBanner = await page.textContent('#tab-analisis .summary .banner');
    check('el análisis con red neuronal explica el estado de las redes especializadas', /Redes especializadas que corrigen: \d+ de 36/.test(nnBanner), nnBanner.slice(0, 160));
    const nnSummary = await page.textContent('#tab-analisis .summary');
    check('la red neuronal usa noticias de Flashscore, ESPN y FotMob', /Noticias · \d+ noticias/.test(nnSummary), nnSummary.match(/Noticias[^A-Z]*/)?.[0]);
    const compare = await page.textContent('#tab-analisis .compare');
    check('compara el análisis estadístico con el de red neuronal', compare.includes('Estadístico') && compare.includes('Red neuronal') && /por separado/.test(compare), compare.replace(/\s+/g, ' ').slice(0, 200));
    await page.click('#tab-analisis .segmented button:has-text("Estadístico")');
    check('se puede volver a ver el análisis estadístico', (await page.textContent('#tab-analisis .summary h2')) === 'Análisis estadístico');
    await page.screenshot({ path: path.join(OUT, '3b-comparacion.png'), fullPage: false });
    await page.click('.tabs button[data-tab="historial"]');
    await page.waitForSelector('.day-line');
    const lines = await page.$$eval('.day-line b', (els) => els.map((e) => e.textContent));
    check('el historial sigue cada método por separado', lines.join(',') === 'Estadístico,Red neuronal', lines.join(', '));
    await page.waitForSelector('.day-body .method-tag'); // el día quedó abierto desde el paso 4
    await page.screenshot({ path: path.join(OUT, '3c-historial-metodos.png'), fullPage: true });
    const panels = await page.$$eval('#tab-historial .panel h3', (els) => els.map((e) => e.textContent));
    check('resultados por nivel de cada método', panels.includes('Análisis estadístico') && panels.includes('Análisis con red neuronal'), panels.join(', '));
    const tableOverflow = await page.evaluate(() => [...document.querySelectorAll('.panel')].some((p) => p.scrollWidth > p.clientWidth + 1));
    check('las tablas del historial caben en su panel', !tableOverflow);

    // 6) Celular
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('.tabs button[data-tab="analisis"]');
    await page.waitForSelector('#tab-analisis .segmented.levels');
    await page.screenshot({ path: path.join(OUT, '4-celular-analisis.png'), fullPage: false });
    const levelsFit = await page.evaluate(() => {
      const el = document.querySelector('#tab-analisis .segmented.levels');
      const r = el.getBoundingClientRect();
      return r.right <= window.innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1;
    });
    check('el filtro por nivel cabe en el celular', levelsFit);
    await (await page.$('#tab-analisis .segmented.levels')).screenshot({ path: path.join(OUT, '4b-celular-niveles.png') });
    const sportsFit = await page.$eval('#tab-analisis .segmented.sports', (el) => el.getBoundingClientRect().right <= window.innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1);
    check('el filtro por deporte cabe en el celular', sportsFit);
    await (await page.$('#tab-analisis .segmented.sports')).screenshot({ path: path.join(OUT, '4d-celular-deportes.png') });
    await page.$eval('#tab-analisis .league-group', (el) => el.scrollIntoView());
    await page.screenshot({ path: path.join(OUT, '4e-celular-partido.png'), fullPage: false });
    const analysisOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('sin desplazamiento horizontal en el análisis (celular)', !analysisOverflow);
    await page.click('.tabs button[data-tab="historial"]');
    await page.waitForSelector('.nets-table');
    await (await page.$('.nets-panel')).screenshot({ path: path.join(OUT, '4c-celular-redes.png') });
    const netsFit = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth <= window.innerWidth + 1,
      tables: [...document.querySelectorAll('.nets-panel .table-wrap')].every((w) => w.scrollWidth <= w.clientWidth + 1),
    }));
    check('las redes caben en el celular (sin desplazamiento horizontal)', netsFit.page && netsFit.tables, JSON.stringify(netsFit));
    await page.click('.tabs button[data-tab="partidos"]');
    await page.screenshot({ path: path.join(OUT, '5-celular-partidos.png'), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('sin desplazamiento horizontal en celular', !overflow);

    // 7) Sin extensión (celular): datos automáticos y token de GitHub en el navegador
    await withoutExtension(browser, errors);
  } finally {
    check('sin errores de JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
    server.kill();
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} comprobaciones correctas. Capturas en ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
})();
