// Pestaña "Errores de cuota": después del análisis (estadístico, red neuronal o ambos),
// las líneas más parejas de cada casa que no cuadran con los datos del partido (los de
// la pestaña Datos): si el promedio de los últimos partidos queda lejos de la línea, la
// opción que favorecen los datos, con su cuota. "Ver en Datos" abre ese partido en la
// pestaña Datos con la estadística y la línea. Solo partidos con datos publicados
// (Flashscore: los automáticos y los de Sofascore enlazados con Flashscore).
import * as provider from '../provider.js';
import { sportOf } from '../sports.js';
import { fmtDay, fmtTime, h, limaDateOf } from '../util.js';
import { STAT_NAME } from '../analysis/catalog.js';
import * as D from '../datos.js';
import * as E from '../errores.js';
import { fmtNum } from './barras.js';

const NS = [5, 10, 15];
const VENUES = { all: 'Todos', split: 'Local / Visita' };
const SOURCE = { apuestatotal: 'Apuesta Total', betano: 'Betano' };
const METHOD = { estadistico: 'Estadístico', red_neuronal: 'Red neuronal' };
const pctText = (p) => `${Math.round(p * 100)}%`;
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmtNum(Math.abs(x))}`;

function segmented(options, value, onPick, label) {
  return h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': label },
    options.map(([v, text]) => h('button', { type: 'button', class: v === value ? 'active' : '', 'aria-pressed': String(v === value), onclick: () => v !== value && onPick(v) }, text)),
  );
}

// Id de los datos publicados del partido (Flashscore), o null.
export const dataIdOf = (eventId, ev) => (ev?.fsId ? `fs:${String(ev.fsId).replace(/^fs:/, '')}` : String(eventId).startsWith('fs:') ? String(eventId) : null);

export class ErroresView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.data = new Map(); // eventId -> datos del partido (o null)
    this.loadedRun = null;
    this.preparing = null; // { run, promise } mientras lee los datos
  }

  get st() {
    return this.app.state.errores;
  }

  set(patch) {
    Object.assign(this.st, patch);
    this.updateBadge();
    this.render();
  }

  // El análisis a usar (las líneas y cuotas son las mismas en los dos métodos).
  analysis() {
    const a = this.app.state.analyses;
    return a[this.app.state.analysisView] || a.estadistico || a.red_neuronal || null;
  }

  // Lee los datos publicados de los partidos del análisis (una vez por análisis).
  prepare() {
    const a = this.analysis();
    if (!a || this.loadedRun === a.run) return Promise.resolve();
    if (this.preparing?.run === a.run) return this.preparing.promise;
    const promise = this.load(a);
    this.preparing = { run: a.run, promise };
    return promise;
  }

  async load(a) {
    const run = a.run;
    const ids = Object.keys(a.lines || {});
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(6, ids.length) }, async () => {
        while (next < ids.length) {
          const id = ids[next++];
          const dataId = dataIdOf(id, a.events?.[id]);
          let data = null;
          try {
            data = dataId ? await provider.loadMatchData(dataId) : null;
          } catch {
            // sin datos de ese partido
          }
          this.data.set(id, data);
        }
      }),
    );
    this.preparing = null;
    this.loadedRun = run;
    this.updateBadge();
    if (this.app.state.tab === 'errores') this.render();
  }

  // Errores de este análisis para el seguimiento (Historial), con lo elegido en la
  // pestaña (partidos, local/visita y exigencia).
  async track() {
    const settings = { ...this.st }; // los de ahora: se pueden cambiar mientras lee los datos
    await this.prepare();
    const a = this.analysis();
    return a ? E.trackedErrors(this.errors(settings), { ...settings, run: a.run, created: a.created }) : [];
  }

  errors(settings = this.st) {
    const a = this.analysis();
    if (!a || this.loadedRun !== a.run) return [];
    return E.findErrors(a, (id) => this.data.get(id) || null, settings);
  }

  updateBadge() {
    const badge = document.querySelector('.tabs button[data-tab="errores"] .n');
    if (!badge) return;
    const n = this.errors().length;
    badge.textContent = n ? String(n) : '';
    badge.hidden = !n;
  }

  render() {
    const a = this.analysis();
    if (!a) {
      this.root.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('p', {}, 'Lanza el análisis estadístico, el de red neuronal o ambos, y aquí aparecen las cuotas que no cuadran con los datos de cada partido.'),
          h('p', { class: 'note' }, 'Por ejemplo: si los dos equipos promedian 3.5 goles y la línea más pareja es Más/Menos de 2.5, "Más de 2.5" es un error de cuota. Se guardan en el Historial y se liquidan como los picks.'),
          h('button', { type: 'button', class: 'btn small', onclick: () => this.app.showTab('partidos') }, 'Elegir partidos'),
        ),
      );
      return;
    }
    if (this.loadedRun !== a.run) {
      this.prepare();
      this.root.replaceChildren(h('div', { class: 'empty' }, `Leyendo los datos de ${Object.keys(a.lines || {}).length} partidos…`));
      return;
    }
    const list = this.errors();
    const ids = Object.keys(a.lines || {});
    const withData = ids.filter((id) => this.data.get(id)).length;
    const head = h(
      'div',
      { class: 'panel errores-head' },
      h('h2', {}, 'Errores de cuota'),
      h(
        'p',
        { class: 'note' },
        'La línea más pareja de cada casa frente a los datos del partido: el promedio de los últimos partidos de cada equipo (o del jugador) y cuántas veces pasaron esa línea. Cuando quedan lejos, la opción que favorecen los datos aparece aquí, siempre que los enfrentamientos entre ambos (o los partidos del jugador contra el rival) digan lo mismo. Qué tan lejos depende de cuánto varía cada mercado: un gol de diferencia pesa lo que varios puntos en el básquet.',
      ),
      h(
        'div',
        { class: 'filter-row' },
        segmented(NS.map((n) => [n, `Últimos ${n}`]), this.st.n, (n) => this.set({ n }), 'Cuántos partidos'),
        segmented(Object.entries(VENUES), this.st.venue, (venue) => this.set({ venue }), 'Partidos de local o de visita'),
        h('div', { class: 'seg-labeled' }, h('span', { class: 'note' }, 'Exigencia'), segmented(Object.entries(E.LEVELS).map(([k, v]) => [k, v.name]), this.st.level, (level) => this.set({ level }), 'Exigencia')),
      ),
      h(
        'p',
        { class: 'note' },
        `${list.length} ${list.length === 1 ? 'error' : 'errores'} en ${withData} de ${ids.length} partidos con datos publicados.`,
        withData < ids.length ? ' Los demás no tienen datos en la pestaña Datos (solo hoy y mañana, de Flashscore).' : '',
        ' El Historial sigue los errores que había al lanzar el análisis (con lo elegido entonces).',
      ),
    );
    const body = list.length
      ? h('div', { class: 'error-list' }, list.map((e) => this.card(e, a)))
      : h('div', { class: 'empty' }, withData ? 'Ninguna línea queda lejos de los datos con esta exigencia.' : 'Ningún partido del análisis tiene datos publicados.');
    const foot = h('p', { class: 'note' }, 'No se revisan ambos marcan, el ganador ni el 1.er tiempo del básquet: los datos no traen esos números de cada partido.');
    this.root.replaceChildren(head, body, foot);
  }

  card(e, a) {
    const ev = e.ev;
    const sport = sportOf(ev.sport);
    const what = e.player ? STAT_NAME[e.stat] || e.stat : D.statById(ev.sport, e.stat).name.toLowerCase();
    const up = e.sel === 'over' || e.sel === 'home';
    // Probabilidad del análisis para esta opción (si la calculó).
    const probs = Object.entries(this.app.state.analyses)
      .filter(([, x]) => x?.run === a.run)
      .map(([method, x]) => [method, x.candidates.find((c) => String(c.eventId) === String(e.eventId) && c.market === e.market && c.sel === e.sel && c.line === e.line)])
      .filter(([, c]) => c);
    const range = e.player ? `Sus últimos ${this.st.n}` : `Últimos ${this.st.n} de cada equipo${this.st.venue === 'split' ? ' (local de local, visita de visita)' : ''}`;
    const evidence =
      e.kind === 'margin'
        ? [
            Math.abs(e.avg) < 0.05
              ? `Según los datos, ${ev.home} y ${ev.away} quedan parejos (hándicap del local ${signed(e.line)})`
              : `Según los datos, ${e.avg > 0 ? ev.home : ev.away} le saca unos ${fmtNum(Math.abs(e.avg))} ${what} a ${e.avg > 0 ? ev.away : ev.home} (hándicap del local ${signed(e.line)})`,
            `Con este hándicap, ${up ? ev.home : ev.away} habría ganado ${e.hits} de ${e.n} cruces (${pctText(e.hits / e.n)})`,
          ]
        : [
            `${e.player ? `Promedio de ${e.player}` : 'Promedio del partido'}: ${fmtNum(e.avg)} ${what} · línea ${fmtNum(e.line)} (${signed(e.gap)})`,
            `${up ? 'Pasó' : 'Quedó por debajo de'} la línea en ${e.hits} de ${e.n} (${pctText(e.hits / e.n)})`,
          ];
    // Lo que dicen los enfrentamientos (o los partidos del jugador contra este rival).
    const rival = e.side === 'home' ? ev.away : ev.home;
    const hh = e.h2h;
    evidence.push(
      !hh
        ? e.player
          ? `Menos de 3 partidos contra ${rival} en los datos: solo cuentan sus últimos partidos`
          : `Menos de 3 enfrentamientos con ${what} en los datos: solo cuentan los últimos partidos`
        : e.kind === 'margin'
          ? `En los enfrentamientos, ${ev.home} sacó en promedio ${signed(hh.avg)}; con este hándicap, ${up ? ev.home : ev.away} habría ganado ${hh.hits} de ${hh.n}`
          : `${e.player ? `Contra ${rival}` : 'En los enfrentamientos'}: promedio ${fmtNum(hh.avg)} · ${up ? 'pasó' : 'quedó por debajo de'} la línea en ${hh.hits} de ${hh.n}`,
    );
    return h(
      'div',
      { class: 'panel error-card' },
      h('div', { class: 'meta' }, `${sport.icon} ${ev.country || ''} · ${ev.league || ''} · ${fmtDay(limaDateOf(ev.start))} ${fmtTime(ev.start)}`),
      h('h3', {}, `${ev.home} vs ${ev.away}`),
      h(
        'div',
        { class: 'err-pick' },
        h('span', { class: 'err-label' }, e.kind === 'total' ? h('span', { class: 'err-dir', 'aria-hidden': 'true' }, up ? '▲' : '▼') : null, e.label),
        h('span', { class: 'err-odds' }, `@${fmtNum(e.price, 2)}`, h('small', {}, ` ${SOURCE[e.source] || e.source}`)),
      ),
      h('ul', { class: 'err-evidence' }, evidence.map((t) => h('li', {}, t))),
      h(
        'div',
        { class: 'stat-row' },
        h('span', { class: 'chip' }, `Diferencia ${E.strengthName(e.z)}`),
        h('span', { class: 'chip' }, range),
        e.other ? h('span', { class: 'chip' }, `La otra: ${e.other.label} @${fmtNum(e.other.price, 2)}`) : null,
        ...probs.map(([method, c]) => h('span', { class: 'chip' }, `${METHOD[method]}: ${pctText(c.p)}`)),
      ),
      h('button', { type: 'button', class: 'btn small', onclick: () => this.openInDatos(e) }, 'Ver en Datos'),
    );
  }

  // Abre el partido en Datos con la estadística, los partidos y la línea de este error.
  openInDatos(e) {
    const ev = e.ev;
    const id = dataIdOf(e.eventId, ev);
    const st = this.app.state.datos;
    const patch = { id, n: this.st.n, venue: this.st.venue, line: { ...st.line } };
    if (e.player) Object.assign(patch, { player: e.player, playerStat: e.stat, playerN: [5, 10, 15, 20].includes(this.st.n) ? this.st.n : 10, playerVs: false, line: { ...patch.line, [`p|${e.player}|${e.stat}`]: e.line } });
    // Hándicap: la diferencia de cada equipo (a favor menos en contra) en sus partidos.
    else Object.assign(patch, { stat: e.stat, who: e.kind === 'margin' ? 'diff' : 'total', ...(e.kind === 'total' ? { line: { ...patch.line, [`${e.stat}|total`]: e.line } } : {}) });
    this.app.openDatos(patch, { date: limaDateOf(ev.start), sport: ev.sport });
  }
}
