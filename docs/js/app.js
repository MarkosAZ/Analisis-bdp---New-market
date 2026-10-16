// Página principal: une la extensión, las vistas, el análisis y el historial.
import * as ext from './ext.js';
import * as gh from './github.js';
import * as provider from './provider.js';
import * as store from './storage.js';
import * as history from './history.js';
import { analyzeMany } from './analysis/engine.js';
import { DEFAULT_SETTINGS, MARKETS } from './analysis/picks.js';
import { isActiveSport, sportOf } from './sports.js';
import { addDays, h, limaToday, versionBefore } from './util.js';
import { PartidosView } from './views/partidos.js';
import { DatosView } from './views/datos.js';
import { analysisText, renderAnalisis, viewSport } from './views/analisis.js';
import { renderHistorial } from './views/historial.js';

const $ = (sel) => document.querySelector(sel);
const LS = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // sin almacenamiento local: solo se pierde la preferencia
    }
  },
};

// Ajustes guardados. Antes se guardaban los mercados encendidos (`markets`, sin
// el de jugador); ahora los apagados, así un mercado nuevo sale encendido.
function savedSettings() {
  const { marketGroups, markets, ...saved } = LS.get('bdp:ajustes', {}) || {};
  if (Array.isArray(markets) && !saved.marketsOff) saved.marketsOff = MARKETS.filter((m) => m.id !== 'basketball:OU.player' && !markets.includes(m.id)).map((m) => m.id);
  return { ...DEFAULT_SETTINGS, ...saved };
}

const app = {
  extOk: false,
  storage: { mode: 'lectura', info: null },
  state: {
    date: limaToday(),
    sport: isActiveSport(LS.get('bdp:deporte', 'football')) ? LS.get('bdp:deporte', 'football') : 'football',
    source: LS.get('bdp:fuente', null), // 'auto' (datos publicados) o 'sofascore' (extensión)
    events: new Map(), // "fuente|fecha|deporte" -> { status, items, error, withOdds, generated }
    onlyOdds: LS.get('bdp:solo-cuotas', true),
    pinned: new Set(LS.get('bdp:fijadas', [])), // ligas fijadas arriba en Partidos (ver PartidosView.pinKey)
    selected: new Map(), // id -> evento (del día elegido)
    search: '',
    onlyPending: true,
    expanded: new Set(),
    analyses: { estadistico: null, red_neuronal: null }, // último análisis de cada método
    analysisView: 'estadistico', // método que se ve en la pestaña Análisis
    levelFilter: 'todos', // nivel de confianza que se ve en la pestaña Análisis
    sportFilter: 'todos', // deporte que se ve en Análisis y en el detalle de cada día del Historial
    histMethod: 'ambos', // detalle de cada día en Historial: 'ambos' o un método
    index: null,
    network: null,
    openDays: new Set(),
    dayCache: new Map(),
    localFiles: 0,
    tab: 'partidos',
    // Pestaña Datos: partido abierto, cuántos partidos, local/visita, estadística, de
    // quién y líneas elegidas con − y +; jugadores (básquet) y abridores (béisbol).
    datos: { id: null, n: 10, venue: 'all', stat: null, who: 'total', line: {}, search: '', onlyOdds: false, open: {}, player: null, playerStat: null, playerN: 10, playerVs: false, pitcherStat: 'k', pitcherN: 10 },
    settings: savedSettings(),
  },
};

// ---- Utilidades de interfaz ----

let toastTimer;
function toast(text, ms = 3500) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function busy(title, text = '', fraction = 0) {
  $('#busy').hidden = false;
  $('#busy-title').textContent = title;
  $('#busy-text').textContent = text;
  $('#busy-bar').style.width = `${Math.round(fraction * 100)}%`;
}
const idle = () => ($('#busy').hidden = true);

const views = {};

// Antigüedad de los datos automáticos ("hace 35 min").
app.ago = (iso) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!(min >= 0)) return '';
  if (min < 60) return `hace ${min} min`;
  const hours = Math.floor(min / 60);
  return hours < 24 ? `hace ${hours} h ${min % 60} min` : `hace ${Math.floor(hours / 24)} d`;
};

// Sin la extensión solo se pueden analizar los partidos automáticos.
app.canAnalyze = () => {
  const sel = [...app.state.selected.values()];
  return sel.length > 0 && (app.extOk || sel.every((e) => provider.isAuto(e.id)));
};

function chip(cls, text, title) {
  const el = document.createElement('span');
  el.className = `chip ${cls}`;
  el.textContent = text;
  el.title = title;
  return el;
}

// Versión de la extensión con todos los mercados de Betano y Flashscore.
const EXT_LATEST = '0.5.3';
// Compara mayor, menor y parche (0.5.2 < 0.5.3: la 0.5.3 pide los disparos y los jugadores de básquet de Apuesta Total y el registro de jugadores de ESPN).
const extOutdated = (v) => Boolean(v) && !/prueba/.test(v) && versionBefore(v, EXT_LATEST);

function renderHeader() {
  const n = app.state.selected.size;
  $('#sel-count').textContent = `${n} ${n === 1 ? 'partido marcado' : 'partidos marcados'}`;
  for (const id of ['#run-stats', '#run-nn', '#run-both']) $(id).disabled = !app.canAnalyze();
  $('#date').value = app.state.date;
  const { mode } = app.storage;
  $('#ext-status').replaceChildren(
    ...[
      store.isGithub()
        ? chip('ok', 'GitHub ✓', 'El historial se guarda en el repositorio')
        : chip(
            mode === 'local' ? '' : 'warn',
            mode === 'local' ? 'Navegador' : 'Solo lectura',
            'El historial se guarda solo en este navegador. Pega tu token de GitHub en ⚙ Ajustes para verlo en cualquier dispositivo.',
          ),
      app.extOk
        ? extOutdated(app.extVersion)
          ? chip('warn', 'Extensión: actualizar', `Conector v${app.extVersion}: actualízalo (versión ${EXT_LATEST}) para leer todos los mercados de Betano, los disparos y los jugadores de básquet de Apuesta Total, las estadísticas de Flashscore y las de los jugadores (ESPN y Sofascore). Ver extension/README.md`)
          : chip('ok', 'Extensión ✓', `Análisis BDP - Conector v${app.extVersion}: suma Sofascore y Betano`)
        : null,
    ].filter(Boolean),
  );
}

function render() {
  renderHeader();
  if (app.state.tab === 'partidos') views.partidos.render();
  if (app.state.tab === 'datos') views.datos.render();
  if (app.state.tab === 'analisis') renderAnalisis($('#tab-analisis'), app);
  if (app.state.tab === 'historial') renderHistorial($('#tab-historial'), app);
}

function showTab(tab) {
  app.state.tab = tab;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  // Sin la sección (un index.html anterior todavía en la caché del navegador), se salta.
  for (const t of ['partidos', 'datos', 'analisis', 'historial']) if ($(`#tab-${t}`)) $(`#tab-${t}`).hidden = t !== tab;
  render();
}

// ---- Partidos y selección ----

const selectionKey = () => `bdp:seleccion:${app.state.date}`;

function loadSelection() {
  app.state.selected = new Map(LS.get(selectionKey(), []).filter((e) => isActiveSport(e.sport)).map((e) => [e.id, e]));
}

function saveSelection() {
  LS.set(selectionKey(), [...app.state.selected.values()]);
}

app.toggle = (events, checked) => {
  for (const e of events) checked ? app.state.selected.set(e.id, e) : app.state.selected.delete(e.id);
  saveSelection();
  renderHeader();
  views.partidos.renderChips();
  views.partidos.renderList();
};

app.clearSelection = () => {
  app.state.selected.clear();
  saveSelection();
  render();
};

app.eventsKey = (sport = app.state.sport) => `${app.state.source}|${app.state.date}|${sport}`;

app.setSource = (source) => {
  app.state.source = source;
  LS.set('bdp:fuente', source);
  app.loadSport(app.state.sport);
};

app.setOnlyOdds = (on) => {
  app.state.onlyOdds = on;
  LS.set('bdp:solo-cuotas', on);
};

app.togglePin = (key) => {
  const { pinned } = app.state;
  pinned.has(key) ? pinned.delete(key) : pinned.add(key);
  LS.set('bdp:fijadas', [...pinned]);
};

// Partidos automáticos (publicados cada 2 horas): hoy y mañana.
async function loadAuto(sport, force) {
  const day = await provider.loadDay(app.state.date, sport, { force });
  if (!day) {
    const index = provider.cachedIndex();
    return { status: 'nodata', index };
  }
  return { status: 'ok', items: day.events, withOdds: new Set(day.offers.keys()), generated: day.generated };
}

app.loadSport = async (sport, { force = false } = {}) => {
  const { state } = app;
  state.sport = sport;
  LS.set('bdp:deporte', sport);
  const key = app.eventsKey(sport);
  if (state.source === 'sofascore' && !app.extOk) return render();
  if (!force && state.events.get(key)?.status === 'ok') return render();
  state.events.set(key, { status: 'loading' });
  render();
  try {
    if (state.source === 'auto') {
      if (force) await provider.loadIndex({ force: true });
      state.events.set(key, await loadAuto(sport, force));
    } else {
      const { items } = await ext.call('sofascore', 'getSportEvents', { sport, date: state.date }, { timeout: 150000 });
      state.events.set(key, { status: 'ok', items });
    }
    // Actualiza los datos de los partidos ya marcados (estado, marcador).
    for (const e of state.events.get(key).items || []) if (state.selected.has(e.id)) state.selected.set(e.id, e);
    saveSelection();
  } catch (e) {
    state.events.set(key, { status: 'error', error: e.message });
  }
  if (state.sport === sport) render();
};

function setDate(date) {
  app.state.date = date;
  app.state.expanded.clear();
  loadSelection();
  app.loadSport(app.state.sport);
}
app.setDate = setDate;

// ---- Análisis ----

app.canSave = () => store.canWrite();

// Guarda en el historial los análisis que aún no se guardaron.
app.saveAnalyses = async (list = Object.values(app.state.analyses)) => {
  const pending = list.filter((a) => a && !a.saved && a.candidates.length);
  if (!pending.length || !store.canWrite()) return;
  try {
    await history.saveAnalysis(pending);
    for (const a of pending) a.saved = true;
    app.state.index = await history.loadIndex();
    const { date } = pending[0];
    app.state.dayCache.delete(date);
    if (app.state.openDays.has(date)) loadDay(date); // el día abierto en Historial se vuelve a leer
    const what = pending.length > 1 ? 'Análisis estadístico y de red neuronal guardados' : 'Análisis guardado';
    toast(`${what} ${store.isGithub() ? 'en GitHub' : 'en este navegador'}`);
  } catch (e) {
    toast(`No se pudo guardar: ${e.message}`, 6000);
  }
  render();
};

const RUN_TITLE = { estadistico: 'Análisis estadístico', red_neuronal: 'Análisis con red neuronal', ambos: 'Análisis estadístico y con red neuronal' };

// methods: ['estadistico'], ['red_neuronal'] o ambos. Los datos se piden una
// sola vez y cada método se guarda por separado en el historial.
async function runAnalysis(methods) {
  const events = [...app.state.selected.values()];
  if (!events.length) return;
  const title = RUN_TITLE[methods.length > 1 ? 'ambos' : methods[0]];
  busy(title, 'Preparando…', 0);
  try {
    if (methods.includes('red_neuronal') && !app.state.network) app.state.network = await history.loadNetwork();
    const results = await analyzeMany(events, {
      methods,
      settings: app.state.settings,
      network: app.state.network,
      onProgress: (text, fraction) => busy(title, text, fraction),
    });
    Object.assign(app.state.analyses, results);
    app.state.analysisView = methods[0];
    idle();
    showTab('analisis');
    if (store.canWrite()) {
      busy('Guardando en el historial…', '', 1);
      await app.saveAnalyses(Object.values(results));
    }
  } catch (e) {
    toast(`El análisis falló: ${e.message}`, 7000);
  } finally {
    idle();
  }
}

app.setHistMethod = (method) => {
  app.state.histMethod = method;
  render();
};

app.setLevelFilter = (level) => {
  app.state.levelFilter = level;
  render();
};

app.setSportFilter = (sport) => {
  app.state.sportFilter = sport;
  render();
};

app.setAnalysisView = (method) => {
  app.state.analysisView = method;
  render();
};

app.copyAnalysis = async () => {
  try {
    const a = app.state.analyses[app.state.analysisView];
    await navigator.clipboard.writeText(analysisText(a, app.state.levelFilter, viewSport(app, a)));
    toast('Picks copiados');
  } catch {
    toast('No se pudo copiar');
  }
};

// ---- Historial ----

app.reloadHistory = async () => {
  try {
    app.state.index = await history.loadIndex({ upgrade: true });
    app.state.network = await history.loadNetwork();
    app.state.dayCache.clear();
    if (store.isGithub()) {
      const paths = await store.localPaths();
      app.state.localFiles = paths.filter((p) => p.startsWith('data/historial/2') || p.startsWith('data/entrenamiento/')).length;
    }
  } catch (e) {
    toast(`No se pudo leer el historial: ${e.message}`, 6000);
  }
  for (const date of app.state.openDays) loadDay(date);
  render();
};

async function loadDay(date) {
  try {
    app.state.dayCache.set(date, await store.read(history.dayPath(date)));
  } catch (e) {
    app.state.dayCache.set(date, null);
    toast(e.message);
  }
  if (app.state.tab === 'historial') render();
}

app.toggleDay = (date) => {
  const { openDays, dayCache } = app.state;
  if (openDays.has(date)) openDays.delete(date);
  else {
    openDays.add(date);
    if (!dayCache.has(date)) loadDay(date);
  }
  render();
};

app.updateResults = async () => {
  busy('Actualizando resultados', 'Preparando…', 0);
  try {
    const r = await history.updateResults({ onProgress: (text, f) => busy('Actualizando resultados', text, f) });
    await app.reloadHistory();
    const parts = [
      r.checked ? `Resultados: ${r.resolved} apuestas liquidadas` : 'No hay partidos terminados pendientes de liquidar',
      r.skipped ? `${r.skipped} partidos de Sofascore esperan a la extensión` : '',
    ];
    toast(parts.filter(Boolean).join(' · '), 7000);
  } catch (e) {
    toast(`No se pudieron actualizar: ${e.message}`, 7000);
  } finally {
    idle();
  }
};

app.uploadLocal = async () => {
  busy('Subiendo a GitHub', '', 0);
  try {
    const r = await history.uploadLocalToGithub({ onProgress: (text, f) => busy('Subiendo a GitHub', text, f) });
    toast(`${r.files} archivos subidos a GitHub`);
    await app.reloadHistory();
  } catch (e) {
    toast(e.message, 6000);
  } finally {
    idle();
  }
};

// ---- Ajustes ----

function openSettings() {
  const s = app.state.settings;
  const f = $('#settings-form');
  f.alta.value = Math.round(s.alta * 100);
  f.moderadaAlta.value = Math.round(s.moderadaAlta * 100);
  f.moderada.value = Math.round(s.moderada * 100);
  f.minOdds.value = s.minOdds;
  f.comboTargets.value = s.comboTargets.join(', ');
  f.comboMinProb.value = Math.round(s.comboMinProb * 100);
  f.comboMaxLegs.value = s.comboMaxLegs;
  const off = s.marketsOff || [];
  const sports = [...new Set(MARKETS.map((m) => m.sport))];
  $('#market-groups').replaceChildren(
    ...sports.map((sport) =>
      h(
        'div',
        { class: 'market-sport' },
        h('b', {}, `${sportOf(sport).icon} ${sportOf(sport).name}`),
        ...MARKETS.filter((m) => m.sport === sport).map((m) =>
          h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'market', value: m.id, checked: !off.includes(m.id) }), ` ${m.name}`),
        ),
      ),
    ),
  );
  f.betanoAllMarkets.checked = s.betanoAllMarkets !== false;
  f.ghToken.value = '';
  renderGithubStatus();
  $('#settings').showModal();
}

// ---- Token de GitHub en el navegador ----

function renderGithubStatus(text) {
  const el = $('#gh-status');
  const { mode, info, tokenError } = app.storage;
  el.className = 'note';
  if (text) el.textContent = text;
  else if (mode === 'github-web') {
    el.textContent = `Conectado a ${info.repo} (rama ${info.branch}). El historial se guarda en GitHub.`;
    el.className = 'note ok';
  } else if (tokenError) {
    el.textContent = `El token guardado no funciona: ${tokenError}.`;
    el.className = 'note err';
  } else if (mode === 'github') el.textContent = 'Guardando en GitHub con el token de la extensión. Pega aquí un token para usarlo también en el celular.';
  else el.textContent = 'Sin token: el historial se guarda solo en este navegador.';
  $('#gh-forget').hidden = !gh.hasToken();
}

async function saveToken() {
  const input = $('#settings-form').ghToken;
  const token = input.value.trim();
  if (!token) return renderGithubStatus('Pega el token primero.');
  renderGithubStatus('Probando el token…');
  try {
    gh.setConfig({ token });
  } catch (e) {
    return renderGithubStatus(e.message);
  }
  app.storage = await store.init();
  input.value = '';
  renderGithubStatus();
  if (app.storage.mode === 'github-web') toast('Token guardado: el historial se guarda en GitHub');
  await app.reloadHistory();
}

async function forgetToken() {
  gh.forget();
  app.storage = await store.init();
  renderGithubStatus();
  toast('Token borrado de este navegador');
  await app.reloadHistory();
}

function closeSettings(action) {
  const f = $('#settings-form');
  if (action === 'reset') app.state.settings = { ...DEFAULT_SETTINGS };
  if (action === 'save') {
    const targets = f.comboTargets.value
      .split(/[,;\s]+/)
      .map(Number)
      .filter((x) => x > 1);
    const next = {
      alta: Number(f.alta.value) / 100,
      moderadaAlta: Number(f.moderadaAlta.value) / 100,
      moderada: Number(f.moderada.value) / 100,
      minOdds: Number(f.minOdds.value),
      comboTargets: targets.length ? targets : DEFAULT_SETTINGS.comboTargets,
      comboMinProb: Number(f.comboMinProb.value) / 100,
      comboMaxLegs: Math.round(Number(f.comboMaxLegs.value)),
      marketsOff: [...f.querySelectorAll('input[name=market]:not(:checked)')].map((x) => x.value),
      betanoAllMarkets: f.betanoAllMarkets.checked,
    };
    if (next.marketsOff.length === MARKETS.length) {
      toast('Elige al menos un mercado para los picks', 6000);
      return;
    }
    if (!(next.alta > next.moderadaAlta && next.moderadaAlta > next.moderada)) {
      toast('Los niveles deben ir de mayor a menor: alta > moderada-alta > moderada', 6000);
      return;
    }
    app.state.settings = next;
  }
  LS.set('bdp:ajustes', app.state.settings);
  if (action !== 'cancel') toast('Ajustes guardados. Se aplican en el próximo análisis.');
}

// ---- Inicio ----

async function init() {
  views.partidos = new PartidosView($('#tab-partidos'), app);
  views.datos = new DatosView($('#tab-datos'), app);
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  $('#date').addEventListener('change', (e) => e.target.value && setDate(e.target.value));
  $('#prev-day').addEventListener('click', () => setDate(addDays(app.state.date, -1)));
  $('#next-day').addEventListener('click', () => setDate(addDays(app.state.date, 1)));
  $('#today').addEventListener('click', () => setDate(limaToday()));
  $('#run-stats').addEventListener('click', () => runAnalysis(['estadistico']));
  $('#run-nn').addEventListener('click', () => runAnalysis(['red_neuronal']));
  $('#run-both').addEventListener('click', () => runAnalysis(['estadistico', 'red_neuronal']));
  $('#open-settings').addEventListener('click', openSettings);
  $('#settings').addEventListener('close', () => closeSettings($('#settings').returnValue));

  $('#gh-save').addEventListener('click', saveToken);
  $('#gh-forget').addEventListener('click', forgetToken);

  loadSelection();
  renderHeader();
  const info = await ext.detect();
  app.extOk = Boolean(info);
  app.extVersion = info?.version;
  // Sin extensión (p. ej. en el celular) se usan los datos automáticos.
  if (!app.state.source) app.state.source = app.extOk ? 'sofascore' : 'auto';
  if (app.state.source === 'sofascore' && !app.extOk) app.state.source = 'auto';
  app.storage = await store.init();
  if (app.storage.tokenError) toast(`El token de GitHub no funciona: ${app.storage.tokenError}. Revísalo en ⚙ Ajustes.`, 8000);
  render();
  app.loadSport(app.state.sport);
  await app.reloadHistory();
}

init();
