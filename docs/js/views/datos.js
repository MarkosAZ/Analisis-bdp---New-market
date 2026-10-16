// Pestaña "Datos": lo que se sabe de cada partido, en barras (como bettingpros).
// A la izquierda (arriba en el celular) todos los partidos del día con datos
// publicados, por liga (o solo los que tienen cuotas); al tocar uno, sus datos:
//  - últimos 5, 10 o 15 partidos de cada equipo (todos, o el local solo de local y
//    la visita solo de visita), con goles, córners, tarjetas, remates... de cada
//    partido frente a una línea (la de Apuesta Total o una elegida con − y +);
//  - los enfrentamientos entre ambos y un resumen de cada equipo;
//  - básquet (NBA y WNBA): cada jugador ofrecido, sus últimos partidos o los que jugó
//    contra el rival de hoy; béisbol (MLB): las últimas aperturas de cada abridor.
// Los datos los publica GitHub Actions (data/fuente/datos/<id>.json), así que sirve
// en el celular sin la extensión; cubre hoy y mañana.
import * as provider from '../provider.js';
import { activeSports } from '../sports.js';
import { addDays, flag, fmtDay, fmtTime, groupBy, h, limaDateOf, limaToday } from '../util.js';
import { basicNorm } from '../analysis/matching.js';
import { STAT_NAME } from '../analysis/catalog.js';
import { matchPlayer } from '../analysis/players.js';
import * as D from '../datos.js';
import { barChart, fmtNum } from './barras.js';

const NS = [5, 10, 15];
const PLAYER_NS = [5, 10, 15, 20];
const PITCHER_NS = [5, 10, 20];
const VENUES = { all: 'Todos', split: 'Local / Visita' };
const OPEN_LEAGUES = 6; // ligas abiertas al entrar (las más importantes)

const fmtDate = (ms) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(ms));
const pctText = (p) => (p == null ? '–' : `${Math.round(p * 100)}%`);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Botones de una opción (segmentado).
function segmented(options, value, onPick, label) {
  return h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': label },
    options.map(([v, text]) => h('button', { type: 'button', class: v === value ? 'active' : '', 'aria-pressed': String(v === value), onclick: () => v !== value && onPick(v) }, text)),
  );
}

// Línea con − y +: `source` dice de dónde salió (la casa o elegida).
function lineControl(line, step, source, onChange) {
  return h(
    'div',
    { class: 'line-ctl' },
    h('span', { class: 'note' }, 'Línea'),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bajar la línea', onclick: () => onChange(Math.max(0.5, line - step)) }, '−'),
    h('b', { class: 'line-val' }, fmtNum(line)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Subir la línea', onclick: () => onChange(line + step) }, '+'),
    h('span', { class: 'note' }, source),
  );
}

// Promedio, mediana y cuántas veces quedó por encima de la línea.
function summaryRow(s, line) {
  if (!s.n) return h('p', { class: 'note' }, 'Sin datos de esta estadística en estos partidos.');
  const lean = s.pct == null ? null : s.pct > 0.5 ? 'over' : s.pct < 0.5 ? 'under' : 'even';
  return h(
    'div',
    { class: 'stat-row' },
    h('span', { class: 'chip' }, 'Prom. ', h('b', {}, fmtNum(s.avg))),
    h('span', { class: 'chip' }, 'Mediana ', h('b', {}, fmtNum(s.median))),
    h('span', { class: `chip lean ${lean || ''}` }, `Más de ${fmtNum(line)}: `, h('b', {}, `${s.over} de ${s.n}`), s.pct != null ? ` (${pctText(s.pct)})` : '', s.push ? ` · ${s.push} justo en la línea` : ''),
  );
}

export class DatosView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.day = null; // { key, data, status }
    this.match = null; // { id, data, status }
  }

  get st() {
    return this.app.state.datos;
  }

  set(patch) {
    Object.assign(this.st, patch);
    this.render();
  }

  // Partidos del día publicados (hoy y mañana), del deporte elegido.
  async loadDay() {
    const { date, sport } = this.app.state;
    const key = `${date}|${sport}`;
    if (this.day?.key === key && this.day.status !== 'error') return;
    this.day = { key, status: 'loading' };
    try {
      const data = await provider.loadDay(date, sport);
      if (this.day.key !== key) return;
      this.day = { key, status: data ? 'ok' : 'nodata', data };
    } catch (e) {
      if (this.day.key === key) this.day = { key, status: 'error', error: e.message };
    }
    if (this.app.state.tab === 'datos') this.render();
  }

  async loadMatch(id) {
    if (this.match?.id === id && this.match.status !== 'error') return;
    this.match = { id, status: 'loading' };
    try {
      const data = await provider.loadMatchData(id);
      if (this.match.id !== id) return;
      this.match = { id, status: data ? 'ok' : 'nodata', data };
    } catch (e) {
      if (this.match.id === id) this.match = { id, status: 'error', error: e.message };
    }
    if (this.app.state.tab === 'datos') this.render();
  }

  open(id) {
    this.set({ id, line: {}, player: null, playerStat: null, playerVs: false });
    window.scrollTo?.({ top: 0 });
  }

  render() {
    const { state } = this.app;
    const key = `${state.date}|${state.sport}`;
    if (this.day?.key !== key) {
      this.loadDay();
      if (this.st.id && !this.day?.data?.events?.some((e) => e.id === this.st.id)) this.st.id = null;
    }
    const ev = this.day?.data?.events?.find((e) => e.id === this.st.id) || null;
    if (ev && this.match?.id !== ev.id) this.loadMatch(ev.id);
    this.root.replaceChildren(
      this.sportChips(),
      h('div', { class: `datos-layout${ev ? ' open' : ''}` }, h('div', { class: 'datos-list' }, this.list()), h('div', { class: 'datos-detail' }, ev ? this.detail(ev) : this.placeholder())),
    );
  }

  sportChips() {
    const { app } = this;
    const published = provider.cachedIndex()?.days?.[app.state.date];
    const sports = published ? activeSports().filter((s) => published[s.slug] || s.slug === app.state.sport) : activeSports();
    return h(
      'div',
      { class: 'sports', role: 'tablist' },
      sports.map((s) =>
        h(
          'button',
          { class: `sport${s.slug === app.state.sport ? ' active' : ''}`, onclick: () => s.slug !== app.state.sport && (this.st.id = null, app.loadSport(s.slug)) },
          `${s.icon} ${s.name}`,
          published?.[s.slug] ? h('span', { class: 'n' }, this.st.onlyOdds ? published[s.slug].withOdds : published[s.slug].datos ?? published[s.slug].withOdds) : null,
        ),
      ),
    );
  }

  placeholder() {
    return h('div', { class: 'empty' }, 'Elige un partido para ver sus datos: últimos partidos, enfrentamientos y cómo le fue frente a cada línea.');
  }

  // Lista de los partidos con datos, por liga.
  list() {
    const { app } = this;
    const day = this.day;
    if (!day || day.status === 'loading') return h('div', { class: 'empty' }, 'Cargando partidos…');
    if (day.status === 'error') return h('div', { class: 'banner warn' }, h('b', {}, 'No se pudieron cargar los partidos. '), day.error);
    if (day.status === 'nodata') {
      const today = limaToday();
      return h(
        'div',
        { class: 'empty' },
        'Los datos publicados cubren hoy y mañana.',
        h('div', { class: 'toolbar', style: 'justify-content:center;margin-top:10px' }, [today, addDays(today, 1)].map((d) => h('button', { class: 'btn small', onclick: () => app.setDate(d) }, d === today ? 'Hoy' : 'Mañana'))),
      );
    }
    const search = h('input', {
      type: 'search',
      placeholder: 'Buscar equipo o liga',
      value: this.st.search || '',
      'aria-label': 'Buscar equipo o liga',
      oninput: (e) => {
        this.st.search = e.target.value;
        this.refreshGroups();
      },
    });
    const onlyOdds = h(
      'label',
      { title: 'Solo los partidos con cuotas de Apuesta Total' },
      h('input', { type: 'checkbox', checked: this.st.onlyOdds, onchange: (e) => this.set({ onlyOdds: e.target.checked }) }),
      'Solo con cuotas',
    );
    return [h('div', { class: 'toolbar' }, search, onlyOdds), this.groups(this.filtered())];
  }

  refreshGroups() {
    this.root.querySelector('.datos-groups')?.replaceWith(this.groups(this.filtered()));
  }

  // Partidos del día con datos (todos o solo los que tienen cuotas), con la búsqueda.
  filtered() {
    const q = basicNorm(this.st.search || '');
    const data = this.day?.data;
    if (!data) return [];
    return data.events.filter(
      (e) => data.datos.has(e.id) && (!this.st.onlyOdds || data.offers.has(e.id)) && (!q || basicNorm(`${e.home.name} ${e.away.name} ${e.tournament.name} ${e.category.name}`).includes(q)),
    );
  }

  // Por liga, las más importantes primero; abiertas las primeras, las que tienen el
  // partido elegido y, al buscar, todas (cada liga se abre o se cierra al tocarla).
  groups(items) {
    const data = this.day?.data;
    // Partidos por jugar que todavía no tienen su archivo (se completan cada 2 horas).
    const waiting = data && !this.st.search ? data.events.filter((e) => e.state === 'pendiente' && !data.datos.has(e.id) && (!this.st.onlyOdds || data.offers.has(e.id))).length : 0;
    const note = waiting ? h('p', { class: 'note datos-waiting' }, `${waiting} ${waiting === 1 ? 'partido por jugar todavía no tiene' : 'partidos por jugar todavía no tienen'} datos: se completan en las próximas actualizaciones (cada 2 horas).`) : null;
    if (!items?.length) return h('div', { class: 'datos-groups' }, h('div', { class: 'empty' }, this.st.search ? 'Nada coincide con la búsqueda.' : 'Ningún partido de este día tiene datos publicados todavía.'), note);
    const groups = [...groupBy(items, (e) => `${e.category.name}|${e.tournament.id}`).entries()].sort(
      ([, a], [, b]) => (b[0].tournament.priority || 0) - (a[0].tournament.priority || 0) || a[0].category.name.localeCompare(b[0].category.name) || a[0].tournament.name.localeCompare(b[0].tournament.name),
    );
    const searching = Boolean(this.st.search?.trim());
    return h(
      'div',
      { class: 'datos-groups' },
      groups.map(([key, list], i) => {
        const open = searching || (this.st.open[key] ?? (i < OPEN_LEAGUES || list.some((e) => e.id === this.st.id)));
        const toggle = () => {
          this.st.open[key] = !open;
          this.refreshGroups();
        };
        return h(
          'div',
          { class: 'league' },
          h(
            'div',
            { class: 'league-head' },
            h(
              'button',
              { type: 'button', class: 'league-title', 'aria-expanded': String(open), onclick: toggle },
              h('span', {}, flag(list[0].category.alpha2)),
              h('span', { class: 'country' }, list[0].category.name),
              h('span', { class: 'name' }, list[0].tournament.name),
            ),
            h('span', { class: 'count' }, list.length),
          ),
          open
            ? h(
                'div',
                { class: 'matches' },
                list.sort((a, b) => a.start - b.start).map((e) => this.matchRow(e, data)),
              )
            : null,
        );
      }),
      note,
    );
  }

  matchRow(e, data) {
    const state = e.state === 'en_vivo' ? h('span', { class: 'state live' }, 'EN VIVO') : e.state === 'finalizado' ? h('span', { class: 'state' }, 'Final') : data?.offers.has(e.id) ? h('span', { class: 'odds-badge', title: 'Tiene cuotas de Apuesta Total' }, 'cuotas') : h('span');
    return h(
      'button',
      { type: 'button', class: `match datos-match${e.id === this.st.id ? ' selected' : ''}`, onclick: () => this.open(e.id) },
      h('span', { class: 'time' }, fmtTime(e.start)),
      h('span', { class: 'teams' }, h('span', {}, e.home.name), h('span', {}, e.away.name)),
      state,
      h('span', { class: 'go', 'aria-hidden': 'true' }, '›'),
    );
  }

  // ---- Detalle de un partido ----

  detail(ev) {
    const m = this.match;
    const head = h(
      'div',
      { class: 'panel datos-head' },
      h('button', { type: 'button', class: 'btn small ghost back', onclick: () => this.set({ id: null }) }, '‹ Volver a la lista'),
      h('div', { class: 'meta' }, `${ev.category.name} · ${ev.tournament.name} · ${fmtDay(limaDateOf(ev.start))} ${fmtTime(ev.start)}`),
      h('h2', {}, `${ev.home.name} vs ${ev.away.name}`),
    );
    if (!m || m.status === 'loading') return [head, h('div', { class: 'empty' }, 'Cargando datos del partido…')];
    if (m.status === 'error') return [head, h('div', { class: 'banner warn' }, h('b', {}, 'No se pudieron leer los datos. '), m.error, ' ', h('button', { class: 'btn small', onclick: () => ((this.match = null), this.render()) }, 'Reintentar'))];
    if (m.status === 'nodata') return [head, h('div', { class: 'banner' }, 'Este partido todavía no tiene datos publicados. GitHub Actions los actualiza cada 2 horas.')];
    const data = m.data;
    const offers = this.day?.data?.offers?.get(ev.id) || [];
    const form = (list) => D.record(list.slice(0, 5)).form.split('').map((r) => h('span', { class: `form-chip ${r}` }, r));
    head.append(
      h('div', { class: 'forms' }, h('span', {}, h('b', {}, ev.home.name), ' ', form(data.home.last)), h('span', {}, h('b', {}, ev.away.name), ' ', form(data.away.last))),
      h('p', { class: 'note' }, `Datos de Flashscore${data.players?.length ? ' y ESPN' : ''}${data.pitchers ? ' y de la MLB' : ''}, actualizados ${this.app.ago(data.generated)}. G: ganó · E: empató · P: perdió (últimos 5, el más reciente primero).`),
    );
    const ctx = this.context(ev, data, offers);
    return [head, this.filters(ctx), this.teamCharts(ev, ctx), this.h2hSection(ev, data, ctx), this.summaryTable(ev, data), ...this.playersSection(ev, data, offers), ...this.pitchersSection(ev, data)];
  }

  // Estadística, de quién, partidos elegidos de cada equipo y la línea (la misma para
  // los gráficos de los dos equipos y el de los enfrentamientos).
  context(ev, data, offers) {
    const { st } = this;
    const all = [...data.home.last, ...data.away.last];
    const stats = D.statsOf(ev.sport).filter((s) => all.some((m) => s.of(m)));
    const stat = stats.find((s) => s.id === st.stat) || stats[0] || D.statsOf(ev.sport)[0];
    const who = st.who;
    const venueHome = st.venue === 'split' ? 'home' : 'all';
    const venueAway = st.venue === 'split' ? 'away' : 'all';
    const home = D.pickMatches(data.home.last, { n: st.n, venue: venueHome });
    const away = D.pickMatches(data.away.last, { n: st.n, venue: venueAway });
    const sh = D.seriesOf(home, stat, who);
    const sa = D.seriesOf(away, stat, who);
    const key = `${stat.id}|${who}`;
    const offered = who === 'total' ? D.offeredLine(offers, stat.market) : null;
    return { stats, stat, who, home, away, sh, sa, key, venueHome, venueAway, ...this.lineFor(key, [...sh, ...sa].map((x) => x.value), offered) };
  }

  // Línea de la estadística elegida: la guardada (elegida con − y +), la de la casa o una cerca del promedio.
  lineFor(key, values, offered) {
    if (Number.isFinite(this.st.line[key])) return { line: this.st.line[key], source: Number.isFinite(offered) ? 'elegida (la de Apuesta Total es ' + fmtNum(offered) + ')' : 'elegida' };
    if (Number.isFinite(offered)) return { line: offered, source: 'de Apuesta Total' };
    return { line: D.defaultLine(values), source: 'cerca del promedio' };
  }

  // Filtros de una fila sobre todos los gráficos de equipo y de enfrentamientos.
  filters({ stats, stat, who, key, line, source }) {
    const { st } = this;
    return h(
      'div',
      { class: 'panel datos-filters' },
      h(
        'div',
        { class: 'filter-row' },
        segmented(NS.map((n) => [n, `Últimos ${n}`]), st.n, (n) => this.set({ n }), 'Cuántos partidos'),
        segmented(Object.entries(VENUES), st.venue, (venue) => this.set({ venue }), 'Partidos de local o de visita'),
        segmented(Object.entries(D.WHO), who, (w) => this.set({ who: w }), 'De quién'),
      ),
      h('div', { class: 'stat-chips', role: 'group', 'aria-label': 'Estadística' }, stats.map((s) => h('button', { type: 'button', class: `chip-btn${s.id === stat.id ? ' active' : ''}`, 'aria-pressed': String(s.id === stat.id), onclick: () => this.set({ stat: s.id }) }, s.name))),
      lineControl(line, stat.step, source, (v) => this.set({ line: { ...st.line, [key]: v } })),
    );
  }

  teamCharts(ev, { stat, who, home, away, sh, sa, line, venueHome, venueAway }) {
    const card = (name, matches, series, where) =>
      h(
        'div',
        { class: 'panel chart-card' },
        h('h3', {}, name, h('span', { class: 'note' }, ` · últimos ${matches.length}${where}`)),
        h('p', { class: 'note' }, `${stat.name} ${who === 'total' ? 'del partido' : who === 'for' ? `de ${name}` : `en contra de ${name}`}, partido a partido (el más reciente a la derecha).`),
        summaryRow(D.summarize(series.map((x) => x.value), line), line),
        barChart({
          name: `${stat.name}: ${name}`,
          line,
          items: series.map(({ value, match }) => ({
            value,
            label: `${match.home ? '' : '@'}${D.shortName(match.opp)}`,
            title: `${fmtDate(match.start)} · ${match.home ? 'local vs' : 'visita en'} ${match.opp} · ${match.gf}-${match.ga} · ${stat.name}: ${fmtNum(value)}${match.league ? ` · ${match.league}` : ''}`,
          })),
        }),
        this.matchTable(matches, stat, who),
      );
    return h('div', { class: 'chart-grid' }, card(ev.home.name, home, sh, venueHome === 'home' ? ' de local' : ''), card(ev.away.name, away, sa, venueAway === 'away' ? ' de visita' : ''));
  }

  // Tabla de los partidos (la misma información de las barras, sin tocarlas).
  matchTable(matches, stat, who) {
    return h(
      'details',
      { class: 'match-table' },
      h('summary', {}, 'Ver los partidos'),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Rival'), h('th', { class: 'num' }, 'Res.'), h('th', { class: 'num' }, stat.name))),
          h(
            'tbody',
            {},
            matches.map((m) => h('tr', {}, h('td', {}, fmtDate(m.start)), h('td', {}, `${m.home ? '' : '@ '}${m.opp}`), h('td', { class: 'num' }, `${m.gf}-${m.ga}`), h('td', { class: 'num' }, fmtNum(D.valueOf(stat.of(m), who))))),
          ),
        ),
      ),
    );
  }

  h2hSection(ev, data, { stat, who, line }) {
    const { st } = this;
    const list = data.h2h.slice(0, st.n);
    if (!list.length) return h('div', { class: 'panel' }, h('h3', {}, 'Enfrentamientos'), h('p', { class: 'note' }, 'No hay enfrentamientos anteriores entre ambos en los datos.'));
    // En los enfrentamientos "a favor" es del local de hoy y "en contra", de la visita de hoy.
    const series = D.seriesOf(list, stat, who);
    const rec = D.h2hRecord(list);
    // Etiqueta: mes/año; si dos caen en el mismo mes (una serie de playoffs), día/mes.
    const monthYear = series.map(({ match }) => fmtDate(match.start).slice(3));
    const label = new Set(monthYear).size < monthYear.length ? (ms) => fmtDate(ms).slice(0, 5) : (ms) => fmtDate(ms).slice(3);
    const whoText = who === 'total' ? 'del partido' : who === 'for' ? `de ${ev.home.name}` : `de ${ev.away.name}`;
    return h(
      'div',
      { class: 'panel chart-card' },
      h('h3', {}, 'Enfrentamientos', h('span', { class: 'note' }, ` · últimos ${list.length}${data.h2h.length > list.length ? ` de ${data.h2h.length}` : ''}`)),
      h(
        'div',
        { class: 'stat-row' },
        h('span', { class: 'chip' }, `Ganó ${ev.home.name}: `, h('b', {}, rec.home)),
        ev.sport === 'football' ? h('span', { class: 'chip' }, 'Empates: ', h('b', {}, rec.draw)) : null,
        h('span', { class: 'chip' }, `Ganó ${ev.away.name}: `, h('b', {}, rec.away)),
      ),
      h('p', { class: 'note' }, `${stat.name} ${whoText} en cada enfrentamiento (el más reciente a la derecha).`),
      summaryRow(D.summarize(series.map((x) => x.value), line), line),
      barChart({
        name: `${stat.name}: enfrentamientos`,
        line,
        items: series.map(({ value, match }) => ({
          value,
          label: label(match.start),
          title: `${fmtDate(match.start)} · ${match.home ? `${ev.home.name} ${match.gf}-${match.ga} ${ev.away.name}` : `${ev.away.name} ${match.ga}-${match.gf} ${ev.home.name}`} · ${stat.name}: ${fmtNum(value)}${match.league ? ` · ${match.league}` : ''}`,
        })),
      }),
      h(
        'details',
        { class: 'match-table' },
        h('summary', {}, 'Ver los enfrentamientos'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Partido'), h('th', { class: 'num' }, stat.name))),
            h(
              'tbody',
              {},
              list.map((m) =>
                h(
                  'tr',
                  {},
                  h('td', {}, fmtDate(m.start)),
                  h('td', {}, m.home ? `${ev.home.name} ${m.gf}-${m.ga} ${ev.away.name}` : `${ev.away.name} ${m.ga}-${m.gf} ${ev.home.name}`),
                  h('td', { class: 'num' }, fmtNum(D.valueOf(stat.of(m), who))),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // Resumen de cada equipo en los partidos elegidos (mismo filtro que las barras).
  summaryTable(ev, data) {
    const { st } = this;
    const home = D.pickMatches(data.home.last, { n: st.n, venue: st.venue === 'split' ? 'home' : 'all' });
    const away = D.pickMatches(data.away.last, { n: st.n, venue: st.venue === 'split' ? 'away' : 'all' });
    const rh = D.record(home);
    const ra = D.record(away);
    const goals = ev.sport === 'football' ? 'Goles' : ev.sport === 'baseball' ? 'Carreras' : 'Puntos';
    const rows = [
      ['Partidos', rh.n, ra.n],
      ['Ganados - empatados - perdidos', `${rh.w}-${rh.d}-${rh.l}`, `${ra.w}-${ra.d}-${ra.l}`],
      [`${goals} a favor (prom.)`, fmtNum(rh.gf), fmtNum(ra.gf)],
      [`${goals} en contra (prom.)`, fmtNum(rh.ga), fmtNum(ra.ga)],
    ];
    if (ev.sport === 'football') rows.push(['Más de 2.5 goles', pctText(rh.over25), pctText(ra.over25)], ['Ambos marcan', pctText(rh.btts), pctText(ra.btts)]);
    for (const stat of D.statsOf(ev.sport).slice(1)) {
      const ph = D.averagePair(home, stat);
      const pa = D.averagePair(away, stat);
      if (!ph && !pa) continue;
      const cell = (p) => (p ? `${fmtNum(p.for)} / ${fmtNum(p.against)}` : '–');
      rows.push([`${stat.name} a favor / en contra`, cell(ph), cell(pa)]);
    }
    return h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'Resumen', h('span', { class: 'note' }, ` · últimos ${st.n}${st.venue === 'split' ? ' (local de local, visita de visita)' : ''}`)),
      h(
        'div',
        { class: 'table-wrap' },
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, ev.home.name), h('th', { class: 'num' }, ev.away.name))), h('tbody', {}, rows.map(([label, a, b]) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, a), h('td', { class: 'num' }, b))))),
      ),
    );
  }

  // ---- Básquet: jugadores ----

  playersSection(ev, data, offers) {
    const players = data.players || [];
    if (!players.length) return [];
    const { st } = this;
    const same = (a, b) => Boolean(matchPlayer(a, [{ name: b }]));
    const linesOf = new Map(players.map((p) => [p, D.playerLines(offers, p.name, same)]));
    const hasLines = (p) => Object.keys(linesOf.get(p)).length > 0;
    // Por defecto, el primero que ofrece la casa (o el de más minutos del local).
    const player = players.find((p) => p.name === st.player) || players.find(hasLines) || players[0];
    const lines = linesOf.get(player);
    // Las que tienen datos en sus partidos o línea en la casa.
    const available = (c) => lines[c] != null || D.playerSeries(player.games, c).length > 0;
    const fallback = Object.keys(lines)[0] || 'pl_pra';
    const code = st.playerStat && D.PLAYER_CHART_STATS.includes(st.playerStat) && available(st.playerStat) ? st.playerStat : fallback;
    const teamName = player.side === 'home' ? ev.home.name : ev.away.name;
    const rivalAbbr = data.abbr ? data.abbr[player.side === 'home' ? 1 : 0] : null;
    const rivalName = player.side === 'home' ? ev.away.name : ev.home.name;
    const vs = st.playerVs && rivalAbbr ? rivalAbbr : null;
    const games = D.playerGames(player, { n: st.playerN, vs });
    const series = D.playerSeries(games, code);
    const key = `p|${player.name}|${code}`;
    const { line, source } = this.lineFor(key, series.map((x) => x.value), lines[code]);
    const statName = code === 'min' ? 'Minutos' : capital(STAT_NAME[code] || code);
    const pick = (patch) => this.set(patch);
    return [
      h(
        'div',
        { class: 'panel chart-card players' },
        h('h3', {}, 'Jugadores', h('span', { class: 'note' }, ' · los de más minutos de cada equipo (registro de ESPN); con • los que tienen línea en Apuesta Total')),
        ['home', 'away'].map((side) => {
          const list = players.filter((p) => p.side === side);
          const name = side === 'home' ? ev.home.name : ev.away.name;
          return list.length
            ? h(
                'div',
                { class: 'player-team' },
                h('span', { class: 'note' }, name),
                h(
                  'div',
                  { class: 'stat-chips', role: 'group', 'aria-label': `Jugadores de ${name}` },
                  list.map((p) =>
                    h('button', { type: 'button', class: `chip-btn${p === player ? ' active' : ''}`, 'aria-pressed': String(p === player), title: hasLines(p) ? 'Tiene línea en Apuesta Total' : '', onclick: () => pick({ player: p.name, playerStat: null }) }, p.name, hasLines(p) ? h('small', {}, ' •') : null),
                  ),
                ),
              )
            : null;
        }),
        h('h4', {}, `${player.name} · ${teamName}`),
        D.PLAYER_CHART_GROUPS.map(([group, list]) => {
          const shown = list.filter(([c]) => available(c));
          return shown.length
            ? h(
                'div',
                { class: 'stat-group' },
                h('span', { class: 'note' }, group),
                h(
                  'div',
                  { class: 'stat-chips', role: 'group', 'aria-label': `Estadísticas del jugador: ${group}` },
                  shown.map(([c, label]) =>
                    h(
                      'button',
                      { type: 'button', class: `chip-btn${c === code ? ' active' : ''}${lines[c] != null ? ' offered' : ''}`, 'aria-pressed': String(c === code), title: `${c === 'min' ? 'Minutos' : capital(STAT_NAME[c] || c)}${lines[c] != null ? ` · Apuesta Total: línea ${fmtNum(lines[c])}` : ''}`, onclick: () => pick({ playerStat: c }) },
                      label,
                      lines[c] != null ? h('small', {}, ` ${fmtNum(lines[c])}`) : null,
                    ),
                  ),
                ),
              )
            : null;
        }),
        h('p', { class: 'note' }, `${statName} de ${player.name}, partido a partido (el más reciente a la derecha).`),
        h(
          'div',
          { class: 'filter-row' },
          segmented([...PLAYER_NS.map((n) => [`n${n}`, `Últimos ${n}`]), ...(rivalAbbr ? [['vs', `vs ${rivalName}`]] : [])], vs ? 'vs' : `n${st.playerN}`, (v) => (v === 'vs' ? pick({ playerVs: true }) : pick({ playerVs: false, playerN: Number(v.slice(1)) })), 'Partidos del jugador'),
          lineControl(line, 1, source, (v) => this.set({ line: { ...st.line, [key]: v } })),
        ),
        summaryRow(D.summarize(series.map((x) => x.value), line), line),
        series.length
          ? barChart({
              name: `${statName}: ${player.name}`,
              line,
              items: series.map(({ value, game }) => ({
                value,
                label: `${game.home === false ? '@' : ''}${game.opp || '?'}`,
                title: `${fmtDate(game.start)} · ${game.home === false ? 'visita en' : 'vs'} ${game.opp || '?'} · ${statName}: ${fmtNum(value)}${Number.isFinite(game.min) ? ` · ${game.min} min` : ''}`,
              })),
            })
          : h('p', { class: 'note' }, vs ? `No jugó contra ${rivalName} en las dos últimas temporadas.` : 'Sin partidos con esta estadística.'),
      ),
    ];
  }

  // ---- Béisbol: abridores ----

  pitchersSection(ev, data) {
    const p = data.pitchers;
    if (!p?.home && !p?.away) return [];
    const { st } = this;
    const stat = D.PITCHER_STATS.find((s) => s.id === st.pitcherStat) || D.PITCHER_STATS[0];
    const card = (side, pitcher) => {
      if (!pitcher) return h('div', { class: 'panel' }, h('h3', {}, side === 'home' ? ev.home.name : ev.away.name), h('p', { class: 'note' }, 'Sin abridor anunciado o sin aperturas.'));
      const starts = (pitcher.starts || []).slice(0, st.pitcherN);
      const series = D.pitcherSeries(starts, stat.id);
      const key = `sp|${pitcher.name}|${stat.id}`;
      const { line, source } = this.lineFor(key, series.map((x) => x.value), null);
      return h(
        'div',
        { class: 'panel chart-card' },
        h('h3', {}, pitcher.name, h('span', { class: 'note' }, ` · ${side === 'home' ? ev.home.name : ev.away.name} · últimas ${starts.length} aperturas`)),
        lineControl(line, 1, source, (v) => this.set({ line: { ...st.line, [key]: v } })),
        summaryRow(D.summarize(series.map((x) => x.value), line), line),
        barChart({
          name: `${stat.name}: ${pitcher.name}`,
          line,
          items: series.map(({ value, start }) => ({
            value,
            label: D.shortName(start.opp || '?'),
            title: `${fmtDate(start.start)} · vs ${start.opp || '?'} · ${stat.name}: ${fmtNum(value)} · ${fmtNum(start.ip)} entradas, ${start.k} ponches, ${start.er} carreras limpias`,
          })),
        }),
      );
    };
    return [
      h(
        'div',
        { class: 'panel datos-filters' },
        h('h3', {}, 'Abridores', h('span', { class: 'note' }, ' · últimas aperturas (API oficial de la MLB)')),
        h('div', { class: 'stat-chips', role: 'group', 'aria-label': 'Estadística del abridor' }, D.PITCHER_STATS.map((s) => h('button', { type: 'button', class: `chip-btn${s.id === stat.id ? ' active' : ''}`, 'aria-pressed': String(s.id === stat.id), onclick: () => this.set({ pitcherStat: s.id }) }, s.name))),
        segmented(PITCHER_NS.map((n) => [n, `Últimas ${n}`]), st.pitcherN, (n) => this.set({ pitcherN: n }), 'Cuántas aperturas'),
      ),
      h('div', { class: 'chart-grid' }, card('home', p.home), card('away', p.away)),
    ];
  }
}

