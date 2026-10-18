// Pestaña "Historial": seguimiento por separado del análisis estadístico y del
// de red neuronal (aciertos, ganancia y ROI por nivel y de las combinadas), de los
// errores de cuota (aparte: son los mismos en los dos métodos), de Random Bets (sorteos
// entre todas las apuestas del día), apuestas guardadas por día (por método, por tipo
// de mercado o los sorteos) y estado de las redes especializadas.
import { MIN_SAMPLES } from '../analysis/neural.js';
import { BOOKMAKERS, LEVELS, MAIN_LEVELS } from '../analysis/picks.js';
import { byMarketType, emptyMethodStats, hitRate, marketBets, RANDOM_ORIGINS, randomPool, roi, sortedMarketTypes, statsOf, totals } from '../history.js';
import { ACTIVE_SPORTS, sportOf } from '../sports.js';
import { fmtDateTime, fmtDay, fmtTime, groupBy, h, pct } from '../util.js';
import { bySportAndLeague } from './grupos.js';

const STATUS = { won: 'Ganada', lost: 'Perdida', void: 'Nula', pending: 'Pendiente', half_won: 'Medio ganada', half_lost: 'Medio perdida' };
const LEVEL_NAME = Object.fromEntries(LEVELS.map((l) => [l.id, l.name]));
const METHODS = [
  ['estadistico', 'Análisis estadístico', 'Estadístico'],
  ['red_neuronal', 'Análisis con red neuronal', 'Red neuronal'],
];
const SHORT = Object.fromEntries(METHODS.map(([id, , short]) => [id, short]));
// Qué muestra cada día: los dos métodos, uno, las apuestas por tipo de mercado o los sorteos de Random Bets.
const DAY_VIEWS = [['ambos', 'Ambos'], ...METHODS.map(([id, , short]) => [id, short]), ['mercado', 'Por tipo de mercado'], ['random', 'Random Bets']];
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

// Porcentaje de acierto (acertadas de las resueltas), o nada si no hay resueltas.
const hitPct = (st) => (st.won + st.lost ? h('span', { class: 'lvl-pct' }, ` · ${pct(st.won / (st.won + st.lost))}`) : null);

// Aciertos de un día por nivel de confianza: "Alta 3/4 · 75%" (acertadas / resueltas).
function levelChips(m) {
  const items = [...LEVELS.map((l) => [l.id, LEVEL_SHORT[l.id] || l.name, m.byLevel?.[l.id]]), ['combo', 'Combinadas', m.combos]];
  return items
    .filter(([, , st]) => st?.n)
    .map(([id, name, st]) => {
      const resolved = st.won + st.lost;
      const title = `${name}: ${st.won} acertadas de ${resolved} resueltas${st.pending ? `, ${st.pending} pendientes` : ''}${st.void ? `, ${st.void} nulas` : ''}`;
      return h('span', { class: `chip lvl lvl-${id}`, title }, h('span', { class: 'lvl-name' }, name), ` ${st.won}/${resolved}`, hitPct(st), st.pending ? h('span', { class: 'note' }, ` +${st.pending}`) : null);
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

// Errores de cuota: todos y por deporte.
function erroresPanel(s = ZERO) {
  const rows = [statsRow('Todos', s, 'total'), ...ACTIVE_SPORTS.filter((id) => s.bySport?.[id]?.n).map((id) => statsRow(`${sportOf(id).icon} ${sportOf(id).name}`, s.bySport[id]))];
  return h(
    'div',
    { class: 'panel' },
    h('h3', {}, 'Errores de cuota'),
    h('p', { class: 'note' }, 'La opción que favorecen los datos cuando la línea más pareja de la casa queda lejos de ellos (pestaña Errores de cuota), a 1 u cada una.'),
    statsTable(rows),
  );
}

// Errores de cuota guardados del día (de cualquier método).
function erroresBody(day, sport = 'todos') {
  const list = (day?.errores || []).filter((e) => sport === 'todos' || e.sport === sport);
  if (!list.length) return null;
  return h(
    'div',
    { class: 'analysis-block' },
    h('h4', {}, h('span', { class: 'method-tag errores' }, 'Errores de cuota'), ` ${list.length} ${list.length === 1 ? 'apuesta' : 'apuestas'}`),
    h(
      'ul',
      { class: 'leg-list' },
      list
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((e) =>
          legLine(e, [
            h('span', { class: 'note' }, `@ ${e.odds.toFixed(2)} ${BOOKMAKERS[e.source] || e.source} · `),
            h('span', { class: 'note' }, e.kind === 'margin' ? `diferencia ${e.avg > 0 ? '+' : ''}${e.avg} · ` : `prom. ${e.avg} · `),
            h('span', { class: 'note' }, `${e.hits} de ${e.of} · `),
            e.h2h ? h('span', { class: 'note' }, `enfrent. ${e.kind === 'margin' && e.h2h.avg > 0 ? '+' : ''}${e.h2h.avg} (${e.h2h.hits} de ${e.h2h.of}) · `) : null,
          ]),
        ),
    ),
  );
}

// Random Bets: resultados de todos los sorteos, en total y por deporte.
function randomPanel(s = ZERO) {
  const rows = [statsRow('Todas', s, 'total'), ...ACTIVE_SPORTS.filter((id) => s.bySport?.[id]?.n).map((id) => statsRow(`${sportOf(id).icon} ${sportOf(id).name}`, s.bySport[id]))];
  return h('div', { class: 'panel' }, h('h3', {}, 'Random Bets'), h('p', { class: 'note' }, 'Las apuestas de todos los sorteos, a 1 u cada una.'), statsTable(rows));
}

// De dónde salió una apuesta (uno o varios métodos, o un error de cuota) y su cuota.
const originTags = (from = []) => from.map((f) => h('span', { class: `origin-tag o-${f}` }, RANDOM_ORIGINS[f] || f));
const oddsNote = (b) => h('span', { class: 'note' }, Number.isFinite(b.odds) ? `@ ${b.odds.toFixed(2)} ${BOOKMAKERS[b.source] || b.source || ''}` : '');
const randomLine = (b) => legLine(b, [], [oddsNote(b), ...originTags(b.from)]);
const byStart = (list) => list.slice().sort((a, b) => a.start - b.start);

// El sorteo: cuántas (las elige el usuario) entre las apuestas por jugar del día
// elegido arriba, y el último sorteo de ese día.
function randomDrawPanel(app) {
  const { state } = app;
  const date = state.date;
  const loaded = state.dayCache.has(date);
  if (!loaded) app.ensureDay(date);
  const day = state.dayCache.get(date);
  const pool = loaded ? randomPool(day) : [];
  const dayName = fmtDay(date).toLowerCase();
  const input = h('input', { type: 'number', class: 'random-n', min: 1, max: 99, step: 1, value: String(state.randomN), inputmode: 'numeric', onchange: (e) => app.setRandomN(e.target.value) });
  const count = (id) => pool.filter((b) => b.from.includes(id)).length;
  const origins = [
    [count('estadistico'), (n) => `${n} del estadístico`],
    [count('red_neuronal'), (n) => `${n} de la red neuronal`],
    [count('errores'), (n) => `${n} ${n === 1 ? 'error' : 'errores'} de cuota`],
  ]
    .filter(([n]) => n)
    .map(([n, text]) => text(n))
    .join(' · ');
  const status = !loaded
    ? 'Leyendo las apuestas del día…'
    : pool.length
      ? `${pool.length} ${pool.length === 1 ? 'apuesta' : 'apuestas'} por jugar del ${dayName} (${origins}).`
      : day?.analyses?.length || day?.errores?.length
        ? `Ya no quedan apuestas por jugar del ${dayName}: sus partidos empezaron o ya se liquidaron.`
        : `No hay análisis guardados del ${dayName}: lanza el análisis o elige otra fecha arriba.`;
  const last = day?.random?.at(-1);
  return h(
    'div',
    { class: 'panel random-panel' },
    h(
      'div',
      { class: 'random-head' },
      h('h3', {}, 'Random Bets'),
      h('label', { class: 'random-count' }, 'Cuántas', input),
      h('button', { class: 'btn primary', disabled: !app.canSave() || !pool.length, onclick: () => app.randomBets(input.value) }, h('span', { 'aria-hidden': 'true' }, '🎲 '), 'Random Bets'),
    ),
    h(
      'p',
      { class: 'note' },
      'Sortea las que elijas entre todas las apuestas que mandó el análisis del día elegido arriba: estadístico, red neuronal y errores de cuota. Cada mercado de cada partido tiene la misma probabilidad de salir (con el generador criptográfico del navegador); si los análisis mandaron dos opciones del mismo mercado, sale una de ellas, al azar. Solo las de partidos que todavía no empiezan. Cada sorteo se guarda en el historial del día y se liquida como las demás.',
    ),
    h('p', { class: 'note random-pool' }, status),
    last
      ? h(
          'div',
          { class: 'random-last' },
          h('h4', {}, `Último sorteo: ${fmtDateTime(Date.parse(last.created))} · ${last.bets.length} de ${last.pool} ${last.pool === 1 ? 'apuesta' : 'apuestas'}`),
          h('ul', { class: 'leg-list' }, byStart(last.bets).map(randomLine)),
        )
      : null,
  );
}

// Sorteos de Random Bets del día, del más reciente al más viejo.
function randomBody(day, sport = 'todos') {
  const draws = (day?.random || []).filter((r) => r.bets.some((b) => sport === 'todos' || b.sport === sport));
  if (!draws.length) return null;
  return draws
    .slice()
    .reverse()
    .map((r) =>
      h(
        'div',
        { class: 'analysis-block' },
        h('h4', {}, h('span', { class: 'method-tag random' }, 'Random Bets'), ` ${fmtDateTime(Date.parse(r.created))} · ${r.bets.length} de ${r.pool} ${r.pool === 1 ? 'apuesta' : 'apuestas'}`),
        h('ul', { class: 'leg-list' }, byStart(r.bets.filter((b) => sport === 'todos' || b.sport === sport)).map(randomLine)),
      ),
    );
}

// Por tipo de mercado: resultados de todos los días (cada apuesta una vez, de
// cualquier método o error de cuota, de todos los niveles).
function marketPanel(byMarket, sport = 'todos') {
  const types = sortedMarketTypes(byMarket).filter((t) => sport === 'todos' || t.sport === sport);
  return h(
    'div',
    { class: 'panel market-panel' },
    h('h3', {}, 'Por tipo de mercado'),
    h('p', { class: 'note' }, 'Todas las apuestas de cada día: las del estadístico, las de la red neuronal y los errores de cuota, de todos los niveles (también Baja), una vez cada una y a 1 u. Las de Random Bets van en su pestaña.'),
    types.length ? statsTable(types.map((t) => statsRow(`${sportOf(t.sport).icon} ${t.name}`, t.stats))) : h('p', { class: 'note' }, 'Todavía no hay apuestas guardadas.'),
  );
}

// Aciertos, pendientes y ganancia de un grupo de apuestas (cabecera de cada tipo de mercado).
function statChips(st) {
  return [
    st.won + st.lost ? h('span', { class: st.won >= st.lost ? 'chip ok' : 'chip err', title: 'Acertadas de las resueltas' }, `${st.won}/${st.won + st.lost}`, hitPct(st)) : null,
    st.pending ? h('span', { class: 'chip' }, `${st.pending} ${st.pending === 1 ? 'pendiente' : 'pendientes'}`) : null,
    st.staked ? money(st.profit) : null,
  ];
}

// Apuesta dentro de su tipo de mercado: partido, selección, cuota, nivel y de dónde salió.
const marketLine = (b) =>
  legLine(b, [], [oddsNote(b), b.level ? h('span', { class: 'lvl', style: `color:var(--${LEVEL_COLOR[b.level] || 'mod'})` }, LEVEL_NAME[b.level]) : null, ...originTags(b.from)]);

// Apuestas del día ordenadas por tipo de mercado (en el orden de la lista), cada tipo con sus resultados.
function marketDayBody(day, sport = 'todos') {
  if (!day) return h('div', { class: 'note' }, 'No se encontró el detalle de este día.');
  const groups = byMarketType(marketBets(day).filter((b) => sport === 'todos' || b.sport === sport));
  if (!groups.length) return h('div', { class: 'note' }, sport === 'todos' ? 'Sin apuestas este día.' : `Sin apuestas de ${sportOf(sport).name.toLowerCase()} este día.`);
  return groups.map((g) =>
    h(
      'div',
      { class: 'analysis-block market-group' },
      h('h4', {}, `${sportOf(g.sport).icon} ${g.name}`, h('span', { class: 'note' }, ` · ${g.bets.length} ${g.bets.length === 1 ? 'apuesta' : 'apuestas'}`)),
      h('div', { class: 'day-line market-stats' }, statChips(statsOf(g.bets))),
      h('ul', { class: 'leg-list' }, byStart(g.bets).map(marketLine)),
    ),
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
const fmtInt = (n) => Number(n || 0).toLocaleString('es-PE');

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
  const info = app.state.network?.info;
  const when = info?.trainedAt ? new Date(info.trainedAt).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  // Los resultados guardados en GitHub (en modo local, los de este navegador no cuentan hasta subirlos).
  const own = app.storage.mode === 'local' ? 'resultados guardados en GitHub (los de este navegador cuentan al subirlos con «Subir a GitHub lo guardado en el navegador»)' : 'resultados de tus análisis';
  const origin = info?.rows
    ? ` Última vez: ${when}, con ${fmtInt(info.rows.used ?? info.rows.imported + info.rows.real)} selecciones: ${fmtInt(info.rows.real)} ${own} y el resto de partidos históricos de fútbol, NBA y MLB (cada red usa las 15 000 más recientes de su mercado).`
    : '';
  return h(
    'div',
    { class: 'panel nets-panel' },
    h('h3', {}, 'Redes especializadas'),
    h(
      'p',
      { class: 'note' },
      `Una red por mercado y, en los Más/Menos de jugador, una por estadística (puntos, rebotes, asistencias, triples, tiros de campo intentados...): ninguna aprende de otro mercado. Cada una empieza a corregir con ${MIN_SAMPLES} resultados de su mercado y solo si mejora en los partidos más recientes, que no usó para entrenar; mientras tanto, su mercado usa la probabilidad estadística. Se reentrenan cada día en GitHub Actions con los resultados de tus análisis y los partidos históricos.`,
      origin,
      list.length ? ` Corrigen ${on} de ${list.length}.` : '',
    ),
    h('div', { class: 'nets-tables' }, blocks.map(table)),
  );
}

function legLine(l, extra = [], after = []) {
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
    ...after,
    l.noData ? h('span', { class: 'note' }, ' · sin datos para liquidarla') : null,
  );
}

// Apuesta de un mercado dentro de su partido: resultado, nivel, selección, cuota y probabilidad.
function pickLine(p) {
  return h(
    'li',
    {},
    pill(p.status),
    h('span', { class: 'lvl', style: `color:var(--${LEVEL_COLOR[p.level] || 'mod'})` }, LEVEL_NAME[p.level]),
    h('b', {}, p.label),
    h('span', { class: 'note' }, ` @ ${p.odds.toFixed(2)} ${BOOKMAKERS[p.source]} · ${pct(p.p)}`),
    p.noData ? h('span', { class: 'note' }, ' · sin datos para liquidarla') : null,
  );
}

// Picks de un análisis por deporte y liga, y dentro de cada partido sus mercados.
function picksBySport(a, sport) {
  const picks = a.picks.filter((p) => sport === 'todos' || p.sport === sport);
  if (!picks.length) return h('div', { class: 'note' }, sport === 'todos' ? 'Sin picks.' : `Sin picks de ${sportOf(sport).name.toLowerCase()}.`);
  const byEvent = groupBy(picks, (p) => String(p.eventId));
  const events = [...byEvent.entries()].map(([id, list]) => {
    const ev = a.events?.[id] || {};
    const [home, away] = String(list[0].match || '').split(' vs ');
    return { id, sport: list[0].sport, start: list[0].start, home: ev.home || home, away: ev.away || away, league: ev.league, country: ev.country };
  });
  return bySportAndLeague(events).map((g) =>
    h(
      'div',
      { class: 'hist-sport' },
      h('h5', { class: 'grp-sport' }, `${sportOf(g.sport).icon} ${sportOf(g.sport).name}`),
      g.leagues.map((l) =>
        h(
          'div',
          { class: 'hist-league' },
          h('div', { class: 'grp-league' }, l.name),
          l.events.map((ev) => {
            const list = byEvent.get(ev.id);
            const sc = list.find((p) => p.score)?.score;
            const score = sc ? ` · ${sc.homeNT ?? sc.home}-${sc.awayNT ?? sc.away}` : '';
            return h(
              'div',
              { class: 'hist-match' },
              h('div', { class: 'hist-match-head' }, h('b', {}, `${ev.home} vs ${ev.away}`), h('span', { class: 'note' }, ` ${fmtTime(ev.start)}${score}`)),
              h('ul', { class: 'leg-list' }, list.map(pickLine)),
            );
          }),
        ),
      ),
    ),
  );
}

function dayBody(day, filter, sport = 'todos') {
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
        picksBySport(a, sport),
        (a.combos || [])
          .filter((k) => sport === 'todos' || k.legs.some((l) => l.sport === sport))
          .map((k) =>
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

// Filtro por deporte del detalle de cada día.
function sportSwitch(app) {
  const current = app.state.sportFilter || 'todos';
  const sports = ['todos', ...ACTIVE_SPORTS];
  return h(
    'div',
    { class: 'segmented levels sports', role: 'group', 'aria-label': 'Deporte a mostrar en cada día' },
    sports.map((id) => h('button', { class: id === current ? 'active' : '', onclick: () => app.setSportFilter(id) }, id === 'todos' ? 'Todos' : `${sportOf(id).icon} ${sportOf(id).name}`)),
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
  root.append(randomDrawPanel(app));

  const index = state.index || { days: {} };
  const t = totals(index);
  root.append(
    h(
      'div',
      { class: 'grid2' },
      METHODS.map(([id, title]) => methodPanel(title, t.methods[id])),
      erroresPanel(t.errores),
      randomPanel(t.random),
      networkPanel(app),
    ),
  );

  const dates = Object.keys(index.days).sort().reverse();
  if (!dates.length) {
    root.append(h('div', { class: 'empty' }, 'Todavía no hay análisis guardados. Cada análisis que hagas se guarda aquí con sus resultados.'));
    return;
  }
  const filter = state.histMethod || 'ambos';
  const sport = state.sportFilter || 'todos';
  root.append(
    h(
      'div',
      { class: 'toolbar' },
      h('span', { class: 'note' }, 'Detalle de cada día:'),
      h(
        'div',
        { class: 'segmented levels day-views', role: 'group', 'aria-label': 'Qué mostrar en cada día' },
        DAY_VIEWS.map(([id, name]) => h('button', { class: id === filter ? 'active' : '', 'aria-pressed': String(id === filter), onclick: () => app.setHistMethod(id) }, name)),
      ),
    ),
    sportSwitch(app),
  );
  if (filter === 'mercado') root.append(marketPanel(t.byMarket, sport));
  // Random Bets: solo los días con sorteos.
  const shown = filter === 'random' ? dates.filter((d) => index.days[d].random?.n) : dates;
  if (!shown.length) root.append(h('div', { class: 'empty' }, 'Todavía no hay sorteos de Random Bets: hazlos con el botón Random Bets de arriba.'));
  for (const date of shown) {
    const s = index.days[date];
    const open = state.openDays.has(date);
    const byMethod = filter === 'ambos' || filter === 'mercado' ? () => true : (id) => filter === id;
    const lines = filter === 'random' ? [] : s.methods ? METHODS.filter(([id]) => s.methods[id] && byMethod(id)).map(([id]) => [SHORT[id], s.methods[id]]) : [['', s]];
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
        s.errores?.n && filter !== 'random'
          ? h(
              'span',
              { class: 'day-line' },
              h('b', {}, 'Errores de cuota'),
              h('span', { class: 'chip', title: 'Acertados de los resueltos' }, `${s.errores.won}/${s.errores.won + s.errores.lost}`, hitPct(s.errores)),
              s.errores.pending ? h('span', { class: 'chip' }, `${s.errores.pending} pendientes`) : null,
              s.errores.staked ? money(s.errores.profit) : null,
            )
          : null,
        s.random?.n && filter === 'random'
          ? h(
              'span',
              { class: 'day-line' },
              h('b', {}, 'Random Bets'),
              s.random.draws ? h('span', { class: 'chip' }, `${s.random.draws} ${s.random.draws === 1 ? 'sorteo' : 'sorteos'}`) : null,
              h('span', { class: 'chip', title: 'Acertadas de las resueltas' }, `${s.random.won}/${s.random.won + s.random.lost}`, hitPct(s.random)),
              s.random.pending ? h('span', { class: 'chip' }, `${s.random.pending} pendientes`) : null,
              s.random.staked ? money(s.random.profit) : null,
            )
          : null,
      ),
    );
    const box = h('div', { class: 'day' }, head);
    if (open) {
      const day = state.dayCache.get(date);
      const loading = h('div', { class: 'note' }, 'Cargando…');
      const body =
        filter === 'random'
          ? [state.dayCache.has(date) ? randomBody(day, sport) || h('div', { class: 'note' }, sport === 'todos' ? 'Sin Random Bets este día.' : `Sin Random Bets de ${sportOf(sport).name.toLowerCase()} este día.`) : loading]
          : filter === 'mercado'
            ? [state.dayCache.has(date) ? marketDayBody(day, sport) : loading]
            : [dayTables(s, filter), state.dayCache.has(date) ? [erroresBody(day, sport), dayBody(day, filter, sport)] : loading];
      box.append(h('div', { class: 'day-body' }, body));
    }
    root.append(box);
  }
}
