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
  const { compactDay, compactResult, compactMatchData, compactMatchStats } = await import(pathToFileURL(path.join(ROOT, 'docs/js/data-format.js')).href);
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
    // e1 también con córners y tarjetas lejos de sus datos (pestaña Errores de cuota):
    // promedio de córners cerca de 9.7 frente a 6.5 y de tarjetas cerca de 4 frente a 7.5.
    offers: {
      'fs:e1': [...book(1.35, 4.8, 8.5), o('OU.corners', 'over', 6.5, 1.85), o('OU.corners', 'under', 6.5, 1.9), o('OU.cards', 'over', 7.5, 1.9), o('OU.cards', 'under', 7.5, 1.88)],
      'fs:e2': book(1.5, 4.0, 6.5),
      'fs:e4': book(1.45, 4.5, 6.8),
    },
    details: Object.fromEntries(['e1', 'e2', 'e4'].map((id) => [`fs:${id}`, { lastHome: strong, lastAway: weak, h2h: { homeWins: 4, draws: 1, awayWins: 1 } }])),
    // Pestaña Datos: también los partidos sin cuotas (e3); e2 y e4 todavía sin su archivo.
    datos: ['fs:e1', 'fs:e3'],
  });
  const generated = football.generated;
  // Pestaña Datos: últimos 12 de cada equipo (córners y tarjetas en cada uno), 6
  // enfrentamientos y, en el básquet, un jugador con su línea de P+R+A.
  const lastOf = (seed) =>
    Array.from({ length: 12 }, (_, i) => ({
      start: at(-24 * (3 + 4 * i)),
      home: i % 2 === 0,
      opp: ['Melgar', 'Cienciano', 'ADT', 'Sport Huancayo', 'Cusco FC', 'Los Chankas'][(i + seed) % 6],
      gf: (i * seed) % 4,
      ga: (i + seed) % 3,
      league: 'Liga 1',
      stats: compactMatchStats({ corners: { ft: [3 + ((i * 7 + seed) % 6), 2 + ((i + seed) % 5)], h1: [2, 1] }, yellows: { ft: [1 + (i % 3), 2] } }, i % 2 === 1),
    }));
  const datos = {
    id: 'fs:e1',
    sport: 'football',
    generated,
    home: { name: 'Alianza Lima', last: lastOf(1) },
    away: { name: 'Sporting Cristal', last: lastOf(2) },
    h2h: Array.from({ length: 6 }, (_, i) => ({ start: at(-24 * (40 + 60 * i)), home: i % 2 === 0, gf: i % 3, ga: (i + 1) % 2, league: 'Liga 1', stats: compactMatchStats({ corners: { ft: [5 + i, 4] } }, i % 2 === 1) })),
  };
  const nba = { ...ev('b2', 'NBA', 'EE. UU.', 'US', 1000, 'New York Knicks', 'Cleveland Cavaliers', 21), sport: 'basketball' };
  // Como el registro de ESPN: tiros anotados e intentados, sin rebotes ofensivos ni defensivos.
  const game = (i, opp, pts, reb, ast) => ({ start: at(-24 * (2 + 3 * i)), opp, home: i % 2 === 0, min: 28, pts, reb, ast, tpm: 0, stl: 1, blk: 1, tov: 1, fgm: Math.floor(pts / 2), fga: pts, tpa: 2, ftm: pts % 2, fta: 2 });
  const robinson = [game(0, 'BOS', 8, 10, 1), game(1, 'CLE', 12, 9, 2), game(2, 'MIA', 6, 7, 0), game(3, 'PHI', 10, 11, 2), game(4, 'CLE', 15, 13, 1), game(5, 'ATL', 4, 6, 1), game(30, 'CLE', 9, 6, 0)];
  const pra = [o('OU.pl_pra#Mitchell Robinson', 'over', 11.5, 1.87), o('OU.pl_pra#Mitchell Robinson', 'under', 11.5, 1.93), o('OU', 'over', 220.5, 1.9), o('OU', 'under', 220.5, 1.9)];
  const nbaLast = (k) => Array.from({ length: 10 }, (_, i) => ({ start: at(-24 * (2 + i)), home: i % 2 === 0, gf: 105 + ((i * k) % 15), ga: 100 + ((i + k) % 12), r: 'W' }));
  const files = {
    'indice.json': { generated, today: DAY, days: { [DAY]: { football: { events: 4, withOdds: 3, datos: 2 }, basketball: { events: 2, withOdds: 1 } }, [TOMORROW]: {} } },
    [`${DAY}/football.json`]: football,
    [`${DAY}/basketball.json`]: compactDay({
      date: DAY,
      sport: 'basketball',
      generated,
      events: [{ ...ev('b1', 'NBA', 'EE. UU.', 'US', 1000, 'Lakers', 'Celtics', 20), sport: 'basketball' }, nba],
      offers: { 'fs:b2': pra },
      details: { 'fs:b2': { lastHome: nbaLast(3), lastAway: nbaLast(5), h2h: null } },
    }),
    'datos/e1.json': compactMatchData(datos),
    'datos/e3.json': compactMatchData({ id: 'fs:e3', sport: 'football', generated, home: { name: 'Cienciano', last: lastOf(3) }, away: { name: 'ADT', last: lastOf(4) }, h2h: [] }),
    'datos/b2.json': compactMatchData({
      id: 'fs:b2',
      sport: 'basketball',
      generated,
      home: { name: 'New York Knicks', last: nbaLast(3).map((m) => ({ ...m, opp: 'Boston Celtics', league: 'NBA', stats: null })) },
      away: { name: 'Cleveland Cavaliers', last: nbaLast(5).map((m) => ({ ...m, opp: 'Miami Heat', league: 'NBA', stats: null })) },
      h2h: [],
      abbr: ['NY', 'CLE'],
      // De más a menos minutos; solo Robinson tiene línea en la casa.
      players: [
        { side: 'home', name: 'Jalen Brunson', games: robinson.map((g) => ({ ...g, min: 35, pts: g.pts + 15 })) },
        { side: 'home', name: 'Mitchell Robinson', games: robinson },
        { side: 'away', name: 'Donovan Mitchell', games: robinson.map((g) => ({ ...g, opp: 'NY', pts: g.pts + 20 })) },
      ],
    }),
    'noticias.json': {
      generated,
      items: [
        ['espn', 'Alianza Lima pierde a su arquero por lesión', '', Math.round(at(-10) / 1000), 'soccer'],
        ['flashscore', 'Universitario recupera a dos titulares', '', Math.round(at(-5) / 1000), 'soccer'],
      ],
    },
    [`resultados/${DAY}.json`]: {
      // Con córners (11) y tarjetas (3): liquidan los errores de cuota de ese partido.
      'fs:e1': compactResult({ state: 'finalizado', score: { home: 2, away: 0 } }, { record: { final: [2, 0], stats: { corners: { ft: [7, 4] }, cards: { ft: [1, 2] } } } }),
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

// Umbrales más bajos que los de fábrica: con el análisis calibrado (probabilidades
// cerca del 50 % frente a líneas parejas) los datos de prueba no llegan a 80 % ni a
// 70 % por selección, y así se prueba igual que la página muestre cada nivel y las
// combinadas (y que los ajustes guardados se respeten).
const LOW_THRESHOLDS = () => {
  if (localStorage.getItem('bdp:ajustes') == null) localStorage.setItem('bdp:ajustes', JSON.stringify({ alta: 0.6, moderadaAlta: 0.57, moderada: 0.54, comboMinProb: 0.55 }));
};

async function withoutExtension(browser, errors) {
  const { DAY, files } = await fixtures();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-PE', timezoneId: 'America/Lima', isMobile: true, hasTouch: true });
  await context.addInitScript(LOW_THRESHOLDS);
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
  check('ligas automáticas ordenadas por país', leagues.join(',') === 'Premier League,Liga 1', leagues.join(', '));
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

  // Pestaña Datos: todos los partidos con datos (también sin cuotas), por liga.
  await page.click('.tabs button[data-tab="datos"]');
  await page.click('#tab-datos .sport:has-text("Fútbol")');
  await page.waitForSelector('.datos-match');
  const datosRows = () => page.$$eval('.datos-match', (rows) => rows.map((r) => `${r.querySelector('.teams').textContent}${r.querySelector('.odds-badge') ? ' (cuotas)' : ''}`));
  const allRows = await datosRows();
  const waiting = await page.textContent('.datos-waiting');
  await page.check('#tab-datos .toolbar input[type="checkbox"]');
  const oddsRows = await datosRows();
  await page.uncheck('#tab-datos .toolbar input[type="checkbox"]');
  check('Datos: todos los partidos con datos (también sin cuotas) y "Solo con cuotas"', JSON.stringify(allRows) === '["Alianza LimaSporting Cristal (cuotas)","CiencianoADT"]' && /^2 partidos por jugar/.test(waiting) && JSON.stringify(oddsRows) === '["Alianza LimaSporting Cristal (cuotas)"]', `${JSON.stringify(allRows)} · ${waiting} · ${JSON.stringify(oddsRows)}`);
  await page.click('#tab-datos .league-title:has-text("Liga 1")');
  const closed = await page.$$eval('.datos-match', (rows) => rows.length);
  await page.click('#tab-datos .league-title:has-text("Liga 1")');
  check('Datos: cada liga se cierra y se abre al tocarla', closed === 0 && (await page.$$eval('.datos-match', (rows) => rows.length)) === 2, `${closed}`);
  await page.click('.datos-match:has-text("Alianza Lima")');
  await page.waitForSelector('.chart-card .bars .col');
  const barsOf = () => page.$$eval('.chart-grid .chart-card', (cards) => cards.map((c) => c.querySelectorAll('.bars .col').length));
  const lineText = () => page.textContent('.datos-filters .line-ctl');
  check('Datos: los últimos 10 de cada equipo en barras, con la línea de Apuesta Total', JSON.stringify(await barsOf()) === '[10,10]' && /2\.5/.test(await lineText()) && /Apuesta Total/.test(await lineText()), `${JSON.stringify(await barsOf())} · ${await lineText()}`);
  await page.click('.stat-chips .chip-btn:text-is("Córners")');
  const before = await lineText();
  await page.click('.datos-filters .line-ctl button[aria-label="Subir la línea"]');
  const after = await lineText();
  const leanChip = await page.textContent('.chart-grid .chart-card .chip.lean');
  check('Datos: córners con una línea que se sube con +', /de Apuesta Total/.test(before) && /elegida \(la de Apuesta Total es 6\.5\)/.test(after) && Number(after.match(/(\d+(\.\d)?)/)[1]) === Number(before.match(/(\d+(\.\d)?)/)[1]) + 1 && leanChip.includes('de 10'), `${before} → ${after} · ${leanChip}`);
  await page.click('.datos-filters .segmented button:has-text("Últimos 15")');
  await page.click('.datos-filters .segmented button:has-text("Local / Visita")');
  check('Datos: últimos 15 y solo de local o de visita', JSON.stringify(await barsOf()) === '[6,6]', JSON.stringify(await barsOf()));
  await page.click('.chart-grid .chart-card .bars .col');
  const caption = await page.textContent('.chart-grid .chart-card .bars-caption');
  const h2h = await page.textContent('#tab-datos .chart-card:has(h3:text("Enfrentamientos"))');
  check('Datos: cada barra muestra su partido y están los enfrentamientos', /local vs|visita en/.test(caption) && /Ganó Alianza Lima/.test(h2h), `${caption} · ${h2h.slice(0, 80)}`);
  await page.screenshot({ path: path.join(OUT, '9-celular-datos.png'), fullPage: true });
  check('Datos: sin desplazamiento horizontal en el celular', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  // Diferencia (a favor menos en contra): barras hacia abajo desde el cero cuando perdió.
  await page.click('.datos-filters .segmented button:has-text("Diferencia")');
  const diffDown = await page.$$eval('.chart-grid .chart-card .bars .col.down', (cols) => cols.length);
  const diffZero = await page.$$eval('.chart-grid .chart-card .bars .zero', (z) => z.length);
  check('Datos: la diferencia muestra barras negativas desde el cero', diffDown > 0 && diffZero === 2 && !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${diffDown} barras abajo · ${diffZero} ceros`);
  await page.click('.datos-filters .segmented button:has-text("Del partido")');
  // Básquet: el jugador ofrecido con su línea de P+R+A y sus partidos contra el rival de hoy.
  await page.click('#tab-datos .sport:has-text("Básquet")');
  await page.click('.datos-match:has-text("Knicks")');
  await page.waitForSelector('.players .bars .col');
  const teams = await page.$$eval('.players .player-team', (els) => els.map((e) => `${e.querySelector('.note').textContent}: ${[...e.querySelectorAll('.chip-btn')].map((b) => b.textContent).join(', ')}`));
  check('Datos: jugadores de los dos equipos; por defecto, el que tiene línea', JSON.stringify(teams) === '["New York Knicks: Jalen Brunson, Mitchell Robinson •","Cleveland Cavaliers: Donovan Mitchell"]' && (await page.textContent('.players .player-team .chip-btn.active')) === 'Mitchell Robinson •', JSON.stringify(teams));
  const playerLine = await page.textContent('.players .line-ctl');
  const offered = await page.textContent('.players .chip-btn.active.offered');
  await page.click('.players .segmented button:has-text("vs Cleveland")');
  const vs = await page.$$eval('.players .bars .col', (cols) => cols.map((c) => c.querySelector('.val').textContent));
  check('Datos: jugadores con la línea de la casa y sus partidos contra el rival', /11\.5/.test(playerLine) && offered === 'P+R+A 11.5' && JSON.stringify(vs) === '["15","29","23"]', `${playerLine} · ${offered} · ${JSON.stringify(vs)}`);
  // Tiros: de campo intentados contra el rival (rebotes, sin separar en ofensivos y defensivos).
  const groups = await page.$$eval('.players .stat-group', (els) => els.map((e) => `${e.querySelector('.note').textContent}: ${e.querySelectorAll('.chip-btn').length}`));
  await page.click('.players .stat-group .chip-btn:text-is("De campo intentados")');
  const fga = await page.$$eval('.players .bars .col', (cols) => cols.map((c) => c.querySelector('.val').textContent));
  check('Datos: tiros de campo, triples y libres (anotados e intentados) y minutos', JSON.stringify(groups) === '["Principales: 7","Tiros: 8","Otras: 5"]' && JSON.stringify(fga) === '["9","15","12"]' && !(await page.$('.players .chip-btn:text-is("Rebotes ofensivos")')), `${JSON.stringify(groups)} · ${JSON.stringify(fga)}`);
  // Uno sin línea: P+R+A con una línea cerca del promedio.
  await page.click('.players .chip-btn:has-text("Donovan Mitchell")');
  const noLine = await page.textContent('.players .line-ctl');
  check('Datos: un jugador sin línea de la casa usa una cerca del promedio', /cerca del promedio/.test(noLine) && (await page.textContent('.players .stat-group .chip-btn.active')) === 'P+R+A', noLine);
  await page.click('#tab-datos .sport:has-text("Fútbol")');

  // Errores de cuota: las líneas del análisis frente a los datos del partido.
  check('Errores de cuota: la pestaña cuenta los errores', (await page.textContent('.tabs button[data-tab="errores"] .n')) === '2', await page.textContent('.tabs button[data-tab="errores"]'));
  await page.click('.tabs button[data-tab="errores"]');
  await page.waitForSelector('.error-card');
  const errorCards = await page.$$eval('.error-card', (cards) => cards.map((c) => `${c.querySelector('h3').textContent} | ${c.querySelector('.err-label').textContent} | ${c.querySelector('.err-odds').textContent}`));
  const errorNote = await page.textContent('.errores-head');
  check(
    'Errores de cuota: córners por encima y tarjetas por debajo de su línea (los goles, no)',
    errorCards.length === 2 && errorCards.every((c) => c.startsWith('Alianza Lima vs Sporting Cristal')) && errorCards.some((c) => /Más de 6\.5 córners.*@1\.85 Apuesta Total/.test(c)) && errorCards.some((c) => /Menos de 7\.5 tarjetas.*@1\.88 Apuesta Total/.test(c)) && /en 1 de 3 partidos con datos/.test(errorNote),
    `${errorCards.join(' / ')} · ${errorNote.slice(-120)}`,
  );
  await page.screenshot({ path: path.join(OUT, '10-celular-errores.png'), fullPage: true });
  const savedErrors = JSON.parse(repo.get(`docs/data/historial/${DAY}.json`).text).errores || [];
  check('Errores de cuota: se guardan en el historial con su cuota', savedErrors.length === 2 && savedErrors.every((e) => e.status === 'pending' && e.odds > 1 && e.settings.level === 'media'), JSON.stringify(savedErrors.map((e) => [e.label, e.odds, e.status])));
  check('Errores de cuota: sin desplazamiento horizontal en el celular', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  // "Ver en Datos": el partido en Datos con los córners y la línea de la casa.
  await page.click('.error-card:has-text("córners") button:has-text("Ver en Datos")');
  await page.waitForSelector('#tab-datos .chart-card .bars .col');
  const datosLine = await page.textContent('#tab-datos .datos-filters .line-ctl');
  check('Errores de cuota: "Ver en Datos" abre el partido con la estadística y la línea', (await page.textContent('#tab-datos .datos-head h2')) === 'Alianza Lima vs Sporting Cristal' && (await page.textContent('#tab-datos .stat-chips .chip-btn.active')) === 'Córners' && /6\.5.*de Apuesta Total/.test(datosLine), datosLine);
  await page.click('#tab-datos .datos-head .back');

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
  // Errores de cuota: liquidados con los córners y las tarjetas del partido, aparte de los métodos.
  const settledErrors = JSON.parse(repo.get(`docs/data/historial/${DAY}.json`).text).errores.map((e) => `${e.label}: ${e.status}`);
  const errorsPanel = await page.textContent('#tab-historial .panel:has(h3:text("Errores de cuota"))');
  const errorsLine = await page.textContent('.day-line:has(b:text("Errores de cuota"))');
  check(
    'Errores de cuota: se liquidan y tienen su seguimiento',
    JSON.stringify(settledErrors.sort()) === '["Menos de 7.5 tarjetas: won","Más de 6.5 córners: won"]' && /Todos2100%/.test(errorsPanel.replace(/\s+/g, '')) && /2\/2 · 100%/.test(errorsLine) && (await page.$$('.day-body .method-tag.errores')).length === 1,
    `${settledErrors.join(', ')} · ${errorsPanel.replace(/\s+/g, ' ').slice(-90)} · ${errorsLine}`,
  );
  const index = JSON.parse(repo.get('docs/data/historial/index.json').text).days[DAY];
  check('el resumen guarda los resultados de cada método', index.methods.estadistico.won + index.methods.estadistico.lost > 0 && index.methods.red_neuronal.won + index.methods.red_neuronal.lost > 0, JSON.stringify(index.methods).slice(0, 160));
  await page.click('#tab-historial .segmented button:has-text("Red neuronal")');
  check('el detalle del día se filtra por método', (await page.$$('.day-body .method-tag.estadistico')).length === 0 && (await page.$$('.day-body .method-tag.red_neuronal')).length === 1);
  // Aciertos del día por nivel de confianza: en la cabecera y en la tabla del día abierto.
  const levelChips = await page.$$eval('.day-line .chip.lvl', (els) => els.map((e) => e.textContent.trim()));
  // "Mod-alta 2/3 · 67%": acertadas de las resueltas y su porcentaje (sin resueltas, sin porcentaje).
  const chipOk = (t) => {
    const m = t.match(/^(Alta|Mod-alta|Moderada|Baja|Combinadas) (\d+)\/(\d+)(?: · (\d+)%)?/);
    return Boolean(m) && (Number(m[3]) ? Number(m[4]) === Math.round((100 * Number(m[2])) / Number(m[3])) : m[4] == null);
  };
  check('cada día cuenta los aciertos por nivel, con su porcentaje', levelChips.length > 0 && levelChips.every(chipOk) && levelChips.some((t) => /%/.test(t)), levelChips.join(' | '));
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
    await context.addInitScript(LOW_THRESHOLDS);
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
    check('muestra las ligas de fútbol ordenadas por país (no por importancia)', leagues.join(',') === 'Premier League,Serie A,Liga 1', leagues.join(', '));
    // Pin: Liga 1 fijada arriba, también al volver a abrir la página; al quitarla vuelve a su lugar.
    await page.click('.league:has-text("Liga 1") .pin-btn');
    const pinnedOrder = await page.$$eval('.league .name', (els) => els.map((e) => e.textContent).join(','));
    await page.reload();
    await page.waitForSelector('.league');
    const afterReload = await page.$$eval('.league .name', (els) => els.map((e) => e.textContent).join(','));
    const pressed = await page.getAttribute('.league:has-text("Liga 1") .pin-btn', 'aria-pressed');
    await page.click('.league:has-text("Liga 1") .pin-btn');
    const unpinned = await page.$$eval('.league .name', (els) => els.map((e) => e.textContent).join(','));
    check('el pin fija una liga arriba y se recuerda', pinnedOrder === 'Liga 1,Premier League,Serie A' && afterReload === pinnedOrder && pressed === 'true' && unpinned === 'Premier League,Serie A,Liga 1', `${pinnedOrder} · ${afterReload} · ${unpinned}`);
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
    // Béisbol: el análisis gira en torno a los abridores (y el contexto) de la MLB.
    const baseballFactors = await page.evaluate(async () => {
      const st = await import(new URL('js/storage.js', location.href).href);
      const out = [];
      for (const p of await st.localPaths()) if (p.includes('historial/2')) for (const a of (await st.read(p))?.analyses || []) for (const k of a.picks || []) if (k.sport === 'baseball') out.push(...(k.factors || []));
      return out;
    });
    check(
      'béisbol: abridores, bullpen, estadio y clima en los datos de cada pick',
      ['Abridores: ', 'Bullpen en los 3 días anteriores', 'Estadio', 'Clima: '].every((t) => baseballFactors.some((f) => f.startsWith(t))) && baseballFactors.some((f) => f.includes('Gerrit Cole')),
      [...new Set(baseballFactors.filter((f) => /Abridores|Bullpen|Estadio|Clima/.test(f)))].slice(0, 4).join(' | '),
    );
    check('fuente MLB en el análisis', /MLB · \d+ partidos/.test(summary), summary.match(/MLB[^A-Z]*/)?.[0]);
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
      'las redes especializadas: una por mercado, entrenadas en GitHub Actions (la página no reentrena)',
      netIds.every((id) => netPanel.includes(id)) && !netPanel.includes('Basketball_PlayerProps_Model') && /GitHub Actions/.test(netPanel) && !(await page.$('text=Reentrenar ahora')),
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
