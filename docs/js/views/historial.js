// Pestaña "Historial": seguimiento por separado del análisis estadístico y del
// de red neuronal (aciertos, ganancia y ROI por nivel y de las combinadas),
// apuestas guardadas por día y estado de las redes especializadas.
import { MIN_SAMPLES } from '../analysis/neural.js';
import { BOOKMAKERS, LEVELS, MAIN_LEVELS } from '../analysis/picks.js';
import { emptyMethodStats, hitRate, roi, totals } from '../history.js';
import { sportOf } from '../sports.js';
import { fmtDateTime, fmtDay, fmtTime, groupBy, h, pct } from '../util.js';

const STATUS = { won: 'Ganada', lost: 'Perdida', void: 'Nula', pending: 'Pendiente', half_won: 'Medio ganada', half_lost: 'Medio perdida' };
const LEVEL_NAME = Object.fromEntries(LEVELS.map((l) => [l.id, l.name]));
const METHODS = [
  ['estadistico', 'Análisis estadístico', 'Estadístico'],
  ['red_neuronal', 'Análisis con red neuronal', 'Red neuronal'],
];
const SHORT = Object.fromEntries(METHODS.map(([id, , short]) => [id, short]));
const ZERO = { won: 0, lost: 0, pending: 0, staked: 0, profit: 0 };

const LEVEL_SHORT = { alta: 'Alta', moderada_alta: 'Mod-alta', moderada: 'Moderada', baja: 'Baja' };
const LEVEL_COLOR = { alta: 'alta', moderada_alta: 'modalta', moderada: 'mod', baja: 'baja' };

// Filas por nivel: los tres principales, combinadas, total (sin Baja) y Baja aparte.
const levelRows = (m) => [
  ...MAIN_LEVELS.map((l) => statsRow(l.name, m.byLevel?.[l.id] || ZERO)),
  statsRow('Combinadas', m.combos || ZERO),
  statsRow('Total picks', m, 'total'),
  statsRow('Baja (aparte)', m.byLevel?.baja || ZERO, 'aparte'),
];

// Aciertos de un día por nivel de confianza: "Alta 3/4" (acertadas / resueltas).
function levelChips(m) {
  const items = [...LEVELS.map((l) => [l.id, LEVEL_SHORT[l.id] || l.name, m.byLevel?.[l.id]]), ['combo', 'Combinadas', m.combos]];
  return items
    .filter(([, , st]) => st?.n)
    .map(([id, name, st]) => {
      const resolved = st.won + st.lost;
      const title = `${name}: ${st.won} acertadas de ${resolved} resueltas${st.pending ? `, ${st.pending} pendientes` : ''}${st.void ? `, ${st.void} nulas` : ''}`;
      return h('span', { class: `chip lvl lvl-${id}`, title }, h('span', { class: 'lvl-name' }, name), ` ${st.won}/${resolved}`, st.pending ? h('span', { class: 'note' }, ` +${st.pending}`) : null);
    });
}

// Tabla del día por nivel (al abrir el día).
function dayTables(s, filter) {
  if (!s?.methods) return null;
  const list = METHODS.filter(([id]) => s.methods[id] && (filter === 'ambos' || filter === id));
  if (!list.length) return null;
  return h(
    'div',
    { class: 'day-tables' },
    list.map(([id]) => {
      const m = s.methods[id];
      return h(
        'div',
        { class: 'day-table' },
        h('h4', {}, `${SHORT[id]}: aciertos del día por nivel`),
        statsTable(levelRows(m)),
      );
    }),
  );
}

const money = (x) => h('span', { class: x > 0 ? 'pos' : x < 0 ? 'neg' : '' }, `${x > 0 ? '+' : ''}${x.toFixed(2)} u`);
const pill = (status) => h('span', { class: `status-pill ${status}` }, STATUS[status] || status);

function statsRow(name, s, cls = '') {
  const hr = hitRate(s);
  const r = roi(s);
  return h(
    'tr',
    { class: cls },
    h('td', {}, name),
    h('td', { class: 'num' }, `${s.won + s.lost}`),
    h('td', { class: 'num' }, hr == null ? '–' : pct(hr)),
    h('td', { class: 'num' }, s.staked ? money(s.profit) : '–'),
    h('td', { class: 'num' }, r == null ? '–' : `${r > 0 ? '+' : ''}${Math.round(r * 100)}%`),
    h('td', { class: 'num hide-sm' }, `${s.pending}`),
  );
}

function statsTable(rows) {
  return h('div', { class: 'table-wrap' }, statsTableInner(rows));
}

function statsTableInner(rows) {
  return h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, ''),
        h('th', { class: 'num' }, 'Resueltas'),
        h('th', { class: 'num' }, 'Aciertos'),
        h('th', { class: 'num' }, 'Ganancia'),
        h('th', { class: 'num' }, 'ROI'),
        h('th', { class: 'num hide-sm' }, 'Pendientes'),
      ),
    ),
    h('tbody', {}, rows),
  );
}

// Resultados de un método: por nivel, combinadas y total de picks.
function methodPanel(title, m = emptyMethodStats()) {
  return h(
    'div',
    { class: 'panel' },
    h('h3', {}, title),
    statsTable(levelRows(m)),
  );
}

function storageBanner(app) {
  const { mode, info, tokenError } = app.storage;
  if (mode === 'github-web' || mode === 'github')
    return h(
      'div',
      { class: 'banner' },
      h('b', {}, 'Guardando en GitHub: '),
      `${info.repo} (rama ${info.branch}). Lo ves desde cualquier dispositivo donde hayas pegado tu token.`,
    );
  const settings = h('button', { class: 'btn small', onclick: () => document.querySelector('#open-settings').click() }, '⚙ Pegar token');
  if (mode === 'local')
    return h(
      'div',
      { class: 'banner warn' },
      h('b', {}, tokenError ? `El token de GitHub no funciona (${tokenError}). ` : 'Guardando solo en este navegador. '),
      'Para verlo en el celular y en la PC y no perderlo, pega tu token de GitHub en Ajustes. ',
      settings,
    );
  return h('div', { class: 'banner warn' }, h('b', {}, 'Este navegador no permite guardar datos '), '(¿modo incógnito?). Pega tu token de GitHub para guardar en el repositorio. ', settings);
}

// Id de la red con puntos de corte (tras "_" y entre palabras) para que quepa en el celular.
const breakable = (id) => id.split(/(?<=_)|(?<=[a-z])(?=[A-Z])/).flatMap((part, i) => (i ? [h('wbr'), part] : [part]));

// Estado de cada red especializada (una por mercado y una por estadística de
// jugador), agrupadas: resultados, si corrige y cuánto mejora. Dos tablas (las de
// mercado y las de jugador): lado a lado en la PC, una debajo de otra en el celular.
function networkPanel(app) {
  const list = app.state.network?.status?.() || [];
  const row = (n) => {
    const m = n.meta || {};
    const better = n.trained && m.baseLoss ? ((m.baseLoss - m.nnLoss) / m.baseLoss) * 100 : null;
    const state = n.trained ? 'Corrige' : n.samples >= MIN_SAMPLES ? 'Aún no mejora' : `${n.samples}/${MIN_SAMPLES}`;
    return h(
      'tr',
      { title: n.markets.join(' · ') },
      h('td', { class: 'net-id' }, h('code', {}, breakable(n.id)), h('div', { class: 'note' }, n.name)),
      h('td', { class: 'num' }, `${n.samples}`),
      h('td', { class: n.trained ? 'pos' : '' }, state, better == null ? null : h('div', { class: 'note net-gain-sm' }, `${better.toFixed(1)}% menos error`)),
      h('td', { class: 'num hide-sm' }, better == null ? '–' : `${better.toFixed(1)}%`),
    );
  };
  const groupHead = (group, nets) => {
    const on = nets.filter((n) => n.trained).length;
    const count = `${nets.length} ${nets.length === 1 ? 'red' : 'redes'}${on ? `, ${on} ${on === 1 ? 'corrige' : 'corrigen'}` : ''}`;
    return h('tr', { class: 'net-group' }, h('th', { colspan: 4, scope: 'colgroup' }, group, h('span', { class: 'note' }, ` · ${count}`)));
  };
  const table = (nets) =>
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'nets-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Red'), h('th', { class: 'num' }, 'Resultados'), h('th', {}, 'Estado'), h('th', { class: 'num hide-sm' }, 'Menos error'))),
        h('tbody', {}, [...groupBy(nets, (n) => n.group || '').entries()].map(([group, same]) => [groupHead(group, same), same.map(row)])),
      ),
    );
  const blocks = [list.filter((n) => !n.code), list.filter((n) => n.code)].filter((b) => b.length);
  const on = list.filter((n) => n.trained).length;
  return h(
    'div',
    { class: 'panel nets-panel' },
    h('h3', {}, 'Redes especializadas'),
    h(
      'p',
      { class: 'note' },
      `Una red por mercado y, en los Más/Menos de jugador, una por estadística (puntos, rebotes, asistencias, triples, tiros de campo intentados...): ninguna aprende de otro mercado. Cada una empieza a corregir con ${MIN_SAMPLES} resultados de su mercado y solo si mejora en los partidos más recientes, que no usó para entrenar; mientras tanto, su mercado usa la probabilidad estadística.`,
      list.length ? ` Corrigen ${on} de ${list.length}.` : '',
    ),
    h('div', { class: 'nets-tables' }, blocks.map(table)),
    app.storage.mode !== 'lectura' ? h('button', { class: 'btn small', onclick: () => app.retrain() }, 'Reentrenar ahora') : null,
  );
}

function legLine(l, extra = []) {
  const sport = sportOf(l.sport);
  const score = l.score ? ` · ${l.score.homeNT ?? l.score.home}-${l.score.awayNT ?? l.score.away}` : '';
  return h(
    'li',
    {},
    pill(l.status),
    ...extra,
    h('span', {}, `${sport.icon} ${l.match} (${fmtTime(l.start)}): `),
    h('b', {}, l.label),
    h('span', { class: 'note' }, score),
    l.noData ? h('span', { class: 'note' }, ' · sin datos para liquidarla') : null,
  );
}

function dayBody(day, filter) {
  if (!day) return h('div', { class: 'note' }, 'No se encontró el detalle de este día.');
  const list = day.analyses.filter((a) => filter === 'ambos' || a.method === filter);
  if (!list.length) return h('div', { class: 'note' }, `Sin análisis ${SHORT[filter]?.toLowerCase() || ''} este día.`);
  return list
    .slice()
    .reverse()
    .map((a) =>
      h(
        'div',
        { class: 'analysis-block' },
        h(
          'h4',
          {},
          h('span', { class: `method-tag ${a.method}` }, SHORT[a.method] || a.method),
          ` ${fmtDateTime(Date.parse(a.created))} · ${Object.keys(a.events || {}).length} partidos`,
        ),
        a.picks.length
          ? h(
              'ul',
              { class: 'leg-list' },
              a.picks.map((p) =>
                legLine(p, [
                  h('span', { class: 'lvl', style: `color:var(--${LEVEL_COLOR[p.level] || 'mod'})` }, LEVEL_NAME[p.level]),
                  h('span', { class: 'note' }, `@ ${p.odds.toFixed(2)} ${BOOKMAKERS[p.source]} · ${pct(p.p)}`),
                ]),
              ),
            )
          : h('div', { class: 'note' }, 'Sin picks.'),
        (a.combos || []).map((k) =>
          h(
            'div',
            {},
            h('div', { class: 'note' }, pill(k.status), ` Combinada ${BOOKMAKERS[k.source]} · cuota ${k.odds.toFixed(2)} · prob. ${pct(k.p)}`),
            h('ul', { class: 'leg-list' }, k.legs.map((l) => legLine(l, [h('span', { class: 'note' }, `@ ${l.price.toFixed(2)}`)]))),
          ),
        ),
      ),
    );
}

export function renderHistorial(root, app) {
  const { state } = app;
  root.replaceChildren();
  root.append(storageBanner(app));
  const actions = h(
    'div',
    { class: 'toolbar' },
    h('button', { class: 'btn primary', disabled: app.storage.mode === 'lectura', onclick: () => app.updateResults() }, 'Actualizar resultados'),
    app.storage.mode.startsWith('github') && state.localFiles > 0
      ? h('button', { class: 'btn', onclick: () => app.uploadLocal() }, `Subir a GitHub lo guardado en el navegador (${state.localFiles})`)
      : null,
    h('button', { class: 'btn small ghost', onclick: () => app.reloadHistory() }, '↻'),
  );
  root.append(actions);

  const index = state.index || { days: {} };
  const t = totals(index);
  root.append(
    h(
      'div',
      { class: 'grid2' },
      METHODS.map(([id, title]) => methodPanel(title, t.methods[id])),
      networkPanel(app),
    ),
  );

  const dates = Object.keys(index.days).sort().reverse();
  if (!dates.length) {
    root.append(h('div', { class: 'empty' }, 'Todavía no hay análisis guardados. Cada análisis que hagas se guarda aquí con sus resultados.'));
    return;
  }
  const filter = state.histMethod || 'ambos';
  root.append(
    h(
      'div',
      { class: 'toolbar' },
      h('span', { class: 'note' }, 'Detalle de cada día:'),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Análisis a mostrar en cada día' },
        [['ambos', 'Ambos'], ...METHODS.map(([id, , short]) => [id, short])].map(([id, name]) =>
          h('button', { class: id === filter ? 'active' : '', onclick: () => app.setHistMethod(id) }, name),
        ),
      ),
    ),
  );
  for (const date of dates) {
    const s = index.days[date];
    const open = state.openDays.has(date);
    const lines = s.methods ? METHODS.filter(([id]) => s.methods[id] && (filter === 'ambos' || filter === id)).map(([id]) => [SHORT[id], s.methods[id]]) : [['', s]];
    const head = h(
      'button',
      { class: 'day-head', onclick: () => app.toggleDay(date) },
      h('span', { class: 'date' }, fmtDay(date)),
      h(
        'span',
        { class: 'day-lines' },
        lines.map(([name, m]) =>
          h(
            'span',
            { class: 'day-line' },
            name ? h('b', {}, name) : null,
            h('span', { class: 'chip' }, `${m.n} picks`),
            m.won + m.lost ? h('span', { class: m.won >= m.lost ? 'chip ok' : 'chip err', title: 'Acertadas de las resueltas' }, `${m.won}/${m.won + m.lost} aciertos`) : null,
            ...levelChips(m),
            m.pending ? h('span', { class: 'chip' }, `${m.pending} pendientes`) : null,
            m.staked ? money(m.profit) : null,
          ),
        ),
      ),
    );
    const box = h('div', { class: 'day' }, head);
    if (open) box.append(h('div', { class: 'day-body' }, dayTables(s, filter), state.dayCache.has(date) ? dayBody(state.dayCache.get(date), filter) : h('div', { class: 'note' }, 'Cargando…')));
    root.append(box);
  }
}
