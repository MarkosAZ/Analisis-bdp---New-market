// Pestaña "Análisis": el último análisis estadístico y el último con red
// neuronal, comparados. Los partidos van por deporte y, dentro, por liga; cada
// partido muestra todos los mercados de la lista con su nivel de confianza
// (también Baja) o, si no se pudo apostar, el motivo; los de jugador van aparte;
// después, las combinadas.
import { MIN_SAMPLES } from '../analysis/neural.js';
import { NETWORKS } from '../analysis/networks.js';
import { BOOKMAKERS, isPlayerMarket, LEVELS, marketInfo, MARKETS } from '../analysis/picks.js';
import { sportOf } from '../sports.js';
import { fmtDateTime, fmtTime, groupBy, h, pct } from '../util.js';
import { bySportAndLeague } from './grupos.js';

const SOURCE_NAMES = { sofascore: 'Sofascore', flashscore: 'Flashscore', apuestatotal: 'Apuesta Total', betano: 'Betano', understat: 'Understat', jugadores: 'Jugadores', simulacion: 'Simulación', noticias: 'Noticias' };
const UNITS = { simulacion: 'selecciones', noticias: 'noticias' };
const LEVEL_NAME = Object.fromEntries(LEVELS.map((l) => [l.id, l.name]));
const TITLES = {
  simulacion: 'Primer tiempo del básquet: estimado simulando el partido con lo esperado del modelo',
  noticias: 'Noticias de Flashscore, ESPN y FotMob: solo las usa la red neuronal',
  jugadores: 'Últimos partidos de cada jugador (ESPN en la NBA y la WNBA; Sofascore en las demás ligas) para los Más/Menos de jugador de Betano',
};
const MODE = { 'direct-api': 'directo', direct: 'directo', tab: 'pestaña', navigate: 'navegando' };
const PRICE_SHORT = { apuestatotal: 'AT', betano: 'Betano', sofascore: 'Sofascore' };

export const methodTitle = (m) => (m === 'red_neuronal' ? 'Análisis con red neuronal' : 'Análisis estadístico');
const METHODS = [
  ['estadistico', 'Estadístico'],
  ['red_neuronal', 'Red neuronal'],
];

function sourceChip(id, s) {
  if (!s) return null;
  if (!s.ok) return h('span', { class: 'chip err', title: s.error || '' }, `${SOURCE_NAMES[id]}: error`);
  const extra = s.matched != null ? ` · ${s.matched} ${UNITS[id] || 'partidos'}` : s.mode ? ` · ${MODE[s.mode] || s.mode}` : '';
  let title = TITLES[id] || (s.published ? 'Cuotas publicadas por GitHub Actions (cada 2 horas)' : s.generated ? `Datos publicados el ${fmtDateTime(Date.parse(s.generated))}` : '');
  // Casas: cuántos mercados se leyeron y cuántos no se analizan (de jugador, de torneo...).
  const m = s.markets;
  if (m) {
    const parts = [[m.ok, 'analizados'], [m.player, 'de jugador'], [m.outright, 'de torneo'], [m.special, 'especiales sin datos'], [m.unknown, 'sin reconocer']].filter(([n]) => n);
    title = `Mercados: ${parts.map(([n, t]) => `${n} ${t}`).join(' · ')}${s.pages ? ` · páginas de partido abiertas: ${s.pages}` : ''}`;
  }
  // Por deporte (Betano): cuántos partidos trae su lista, cuántos se emparejaron y de qué ligas.
  const bySport = Object.entries(s.bySport || {}).map(([sport, x]) =>
    x.error ? `${sportOf(sport).name}: ${x.error}` : `${sportOf(sport).name}: ${x.matched} de ${x.of} emparejados (${x.listed} en su lista${x.leagues?.length ? `: ${x.leagues.join(', ')}` : ''})`,
  );
  if (bySport.length) title += `${title ? '\n' : ''}${bySport.join('\n')}`;
  if (s.partial?.length) title += `${title ? '\n' : ''}Con error: ${s.partial.join(' | ')}`;
  return h('span', { class: 'chip ok', title }, `${SOURCE_NAMES[id]}${extra}${s.published ? ' (publicadas)' : ''}`);
}

// Una fila por mercado: selección, cuota, probabilidad, nivel y (al abrir) los datos.
function marketRow(p, method) {
  const others = Object.entries(p.prices || {})
    .filter(([src]) => src !== p.best.source)
    .map(([src, price]) => `${PRICE_SHORT[src] || src} ${price.toFixed(2)}`);
  const name = isPlayerMarket(p.market) ? 'Jugador' : marketInfo(p.sport, p.market)?.name || p.market;
  const nn = method === 'red_neuronal' && Math.abs(p.p - p.pBase) >= 0.005;
  return h(
    'div',
    { class: `mrow ${p.level}` },
    h('div', { class: 'mrow-head' }, h('span', {}, name), h('span', { class: `lvl-badge ${p.level}` }, LEVEL_NAME[p.level])),
    h(
      'div',
      { class: 'mrow-pick' },
      h('b', {}, p.label),
      h('span', { class: 'odds' }, p.best.price.toFixed(2)),
      h('span', { class: 'meta' }, BOOKMAKERS[p.best.source]),
      h('span', { class: 'prob' }, `Prob. ${pct(p.p)}`),
      p.ev > 0.01 ? h('span', { class: 'value' }, `+${Math.round(p.ev * 100)}% de valor`) : null,
    ),
    h('div', { class: 'meter' }, h('span', { style: `width:${Math.round(p.p * 100)}%` })),
    nn ? h('div', { class: 'meta' }, `Estadístico ${pct(p.pBase)} → ${p.net || 'red'} ${pct(p.p)}`) : null,
    p.factors?.length || others.length
      ? h('details', {}, h('summary', {}, 'Datos'), h('ul', {}, [...(p.factors || []), ...(others.length ? [`Otras cuotas: ${others.join(' · ')}`] : [])].map((f) => h('li', {}, f))))
      : null,
  );
}

// Mercado de la lista sin apuesta en este partido, con el motivo.
function missingRow(m, ev) {
  const why = !Array.isArray(ev?.noData)
    ? 'Sin apuesta: sin línea .5 en las casas o sin datos suficientes.'
    : ev.noData.includes(m.market)
      ? 'Sin datos suficientes de los equipos para calcularlo.'
      : ev.wholeOnly?.includes(m.market)
        ? 'Las casas solo tienen líneas enteras o asiáticas de este mercado (sin .5): no se apuesta.'
        : 'Ni Apuesta Total ni Betano tienen una línea .5 de este mercado.';
  return h('div', { class: 'mrow missing' }, h('div', { class: 'mrow-head' }, h('span', {}, m.name), h('span', { class: 'lvl-badge none' }, 'Sin apuesta')), h('div', { class: 'meta' }, why));
}

// Tarjeta de un partido: los mercados de la lista en su orden (con su apuesta o,
// si se muestran todos, el motivo por el que no hay) y los de jugador, ordenados
// por probabilidad.
function matchCard(picks, ev, method, { all = false, marketsOff = [] } = {}) {
  const team = new Map(picks.filter((p) => !isPlayerMarket(p.market)).map((p) => [p.market, p]));
  const players = picks.filter((p) => isPlayerMarket(p.market)).sort((a, b) => b.p - a.p);
  const list = MARKETS.filter((m) => m.sport === ev.sport && m.market !== 'OU.player' && !marketsOff.includes(m.id));
  const rows = list.map((m) => (team.has(m.market) ? marketRow(team.get(m.market), method) : all ? missingRow(m, ev) : null));
  // Mercados guardados con otro nombre de lista (análisis antiguos): al final.
  const known = new Set(list.map((m) => m.market));
  const extra = [...team.values()].filter((p) => !known.has(p.market)).map((p) => marketRow(p, method));
  return h(
    'div',
    { class: 'match-card' },
    h('div', { class: 'meta' }, fmtTime(ev.start)),
    h('div', { class: 'teams' }, `${ev.home} vs ${ev.away}`),
    rows,
    extra,
    players.length ? [h('h4', {}, `Jugadores (${players.length})`), ...players.map((p) => marketRow(p, method))] : null,
  );
}

function comboCard(k, analysis) {
  const byKey = new Map(analysis.candidates.map((c) => [`${c.eventId}|${c.key}`, c]));
  return h(
    'div',
    { class: 'card combo' },
    h('div', { class: 'meta' }, `${BOOKMAKERS[k.source]} · objetivo cuota ${k.target}+`),
    h(
      'div',
      { class: 'nums' },
      h('span', { class: 'odds' }, k.odds.toFixed(2)),
      h('span', { class: 'prob' }, `Prob. estimada ${pct(k.p)}`),
      h('span', { class: 'meta' }, `${k.legs.length} selecciones`),
    ),
    h('div', { class: 'meter' }, h('span', { style: `width:${Math.round(k.p * 100)}%` })),
    h(
      'ol',
      {},
      k.legs.map((leg) => {
        const c = byKey.get(`${leg.eventId}|${leg.key}`);
        const ev = analysis.events[leg.eventId];
        return h('li', {}, `${ev ? `${ev.home} vs ${ev.away}` : ''}: `, h('b', {}, c?.label || leg.key), ` @ ${leg.price.toFixed(2)} (${pct(leg.p)})`);
      }),
    ),
  );
}

// Deporte que se ve: el elegido si el análisis tiene partidos de ese deporte; si
// no (p. ej. se eligió en el Historial o en otro análisis), todos.
export function viewSport(app, a) {
  const s = app.state.sportFilter || 'todos';
  return Object.values(a?.events || {}).some((e) => e.sport === s) ? s : 'todos';
}
// Combinadas con alguna selección del deporte (las selecciones recién hechas no
// guardan el deporte: sale del partido).
const combosOf = (a, sport) => (a.combos || []).filter((k) => sport === 'todos' || k.legs.some((l) => (l.sport || a.events[l.eventId]?.sport) === sport));

// Texto para copiar y compartir (WhatsApp, notas...): por deporte y liga, cada
// partido con sus mercados y su nivel.
export function analysisText(a, filter = 'todos', sport = 'todos') {
  const lines = [`${methodTitle(a.method)} · ${a.date}`];
  const picks = a.picks.filter((p) => (filter === 'todos' || p.level === filter) && (sport === 'todos' || p.sport === sport));
  const byEvent = groupBy(picks, (p) => String(p.eventId));
  const events = [...byEvent.keys()].map((id) => ({ ...a.events[id], id, start: a.events[id]?.start ?? byEvent.get(id)[0].start, sport: a.events[id]?.sport || byEvent.get(id)[0].sport }));
  for (const g of bySportAndLeague(events)) {
    lines.push('', `${sportOf(g.sport).icon} ${sportOf(g.sport).name}`);
    for (const l of g.leagues) {
      lines.push(`— ${l.name}`);
      for (const ev of l.events) {
        lines.push(`${ev.home} vs ${ev.away} (${fmtTime(ev.start)})`);
        for (const p of byEvent.get(ev.id)) lines.push(`• ${p.label} @ ${p.best.price.toFixed(2)} ${BOOKMAKERS[p.best.source]} · ${pct(p.p)} (${LEVEL_NAME[p.level]})`);
      }
    }
  }
  const combos = combosOf(a, sport);
  if (combos.length) {
    lines.push('', 'Combinadas');
    const byKey = new Map(a.candidates.map((c) => [`${c.eventId}|${c.key}`, c]));
    for (const k of combos) {
      lines.push(`${BOOKMAKERS[k.source]} · cuota ${k.odds.toFixed(2)} · prob. ${pct(k.p)}`);
      for (const leg of k.legs) {
        const ev = a.events[leg.eventId];
        lines.push(`   - ${ev.home} vs ${ev.away}: ${byKey.get(`${leg.eventId}|${leg.key}`)?.label} @ ${leg.price.toFixed(2)}`);
      }
    }
  }
  return lines.join('\n');
}

// Cuántos picks de cada nivel y combinadas dio cada método, y cuántos coinciden.
function comparison(app) {
  const { estadistico: est, red_neuronal: rn } = app.state.analyses;
  if (!est || !rn) return null;
  const count = (a, level) => a.picks.filter((p) => p.level === level).length;
  const keys = (a) => new Set(a.picks.map((p) => `${p.eventId}|${p.key}`));
  const ke = keys(est);
  const kr = keys(rn);
  const both = [...ke].filter((k) => kr.has(k)).length;
  const row = (name, a, b) => h('tr', {}, h('td', {}, name), h('td', { class: 'num' }, a), h('td', { class: 'num' }, b));
  const sameRun = est.run && est.run === rn.run;
  const net = rn.network;
  return h(
    'div',
    { class: 'panel compare' },
    h('h3', {}, 'Comparación'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'Estadístico'), h('th', { class: 'num' }, 'Red neuronal'))),
        h(
          'tbody',
          {},
          LEVELS.map((l) => row(l.name, count(est, l.id), count(rn, l.id))),
          row('Combinadas', est.combos.length, rn.combos.length),
          row('Partidos', Object.keys(est.events).length, Object.keys(rn.events).length),
        ),
      ),
    ),
    h(
      'p',
      { class: 'note' },
      sameRun
        ? `Mismos partidos (${fmtDateTime(Date.parse(est.created))}). Coinciden ${both} picks; ${ke.size - both} solo en el estadístico y ${kr.size - both} solo en la red neuronal.`
        : `Hechos por separado: estadístico ${fmtDateTime(Date.parse(est.created))}, red neuronal ${fmtDateTime(Date.parse(rn.created))}.`,
      net ? ` Redes especializadas que corrigen: ${net.trained || 0} de ${net.total || NETWORKS.length}; en los demás mercados la red neuronal da lo mismo que el estadístico.` : '',
    ),
  );
}

function methodSwitch(app) {
  const { analyses, analysisView } = app.state;
  return h(
    'div',
    { class: 'segmented wide', role: 'group', 'aria-label': 'Análisis a mostrar' },
    METHODS.map(([id, name]) =>
      h(
        'button',
        { class: id === analysisView ? 'active' : '', title: analyses[id] ? `${analyses[id].picks.length} picks` : 'Sin hacer', onclick: () => app.setAnalysisView(id) },
        name,
        h('span', { class: 'n' }, analyses[id] ? ` ${analyses[id].picks.length}` : ' –'),
      ),
    ),
  );
}

export function renderAnalisis(root, app) {
  const { analyses, analysisView } = app.state;
  root.replaceChildren();
  if (!analyses.estadistico && !analyses.red_neuronal) {
    root.append(
      h(
        'div',
        { class: 'empty' },
        'Marca partidos o ligas en la pestaña Partidos y pulsa ',
        h('b', {}, 'Análisis estadístico'),
        ', ',
        h('b', {}, 'Análisis red neuronal'),
        ' o ',
        h('b', {}, 'Ambos análisis'),
        '. Cada uno se guarda por separado en el historial.',
      ),
    );
    return;
  }
  root.append(...[comparison(app), methodSwitch(app)].filter(Boolean));
  const a = analyses[analysisView];
  if (!a) {
    root.append(
      h(
        'div',
        { class: 'empty' },
        `Todavía no hiciste el ${methodTitle(analysisView).toLowerCase()} con estos partidos. Pulsa `,
        h('b', {}, analysisView === 'red_neuronal' ? 'Análisis red neuronal' : 'Análisis estadístico'),
        ' o ',
        h('b', {}, 'Ambos análisis'),
        '.',
      ),
    );
    return;
  }
  renderMethod(root, app, a);
}

// Filtro por nivel: Todos, Alta, Moderada-alta, Moderada o Baja (con cuántos hay de cada uno).
function levelFilter(app, a) {
  const current = app.state.levelFilter || 'todos';
  const s = a.settings;
  const ranges = { alta: `≥ ${pct(s.alta)}`, moderada_alta: `${pct(s.moderadaAlta)}–${pct(s.alta)}`, moderada: `${pct(s.moderada)}–${pct(s.moderadaAlta)}`, baja: `< ${pct(s.moderada)}` };
  const btn = (id, name, n, title) => h('button', { class: id === current ? 'active' : '', title, onclick: () => app.setLevelFilter(id) }, name, h('span', { class: 'n' }, ` ${n}`));
  // Cuenta solo los del deporte que se está viendo.
  const sport = viewSport(app, a);
  const picks = a.picks.filter((p) => sport === 'todos' || p.sport === sport);
  return h(
    'div',
    { class: 'segmented levels', role: 'group', 'aria-label': 'Nivel de confianza a mostrar' },
    btn('todos', 'Todos', picks.length, 'Todos los mercados'),
    LEVELS.map((l) => btn(l.id, l.name, picks.filter((p) => p.level === l.id).length, `Confianza ${l.name.toLowerCase()}: ${ranges[l.id]}`)),
  );
}

// Filtro por deporte: Todos y cada deporte del análisis (con cuántos partidos tiene).
function sportFilter(app, a) {
  const current = viewSport(app, a);
  const events = Object.values(a.events || {});
  const sports = bySportAndLeague(events).map((g) => g.sport);
  const btn = (id, name, n) => h('button', { class: id === current ? 'active' : '', title: `${n} partidos`, onclick: () => app.setSportFilter(id) }, name, h('span', { class: 'n' }, ` ${n}`));
  return h(
    'div',
    { class: 'segmented levels sports', role: 'group', 'aria-label': 'Deporte a mostrar' },
    btn('todos', 'Todos', events.length),
    sports.map((id) => btn(id, `${sportOf(id).icon} ${sportOf(id).name}`, events.filter((e) => e.sport === id).length)),
  );
}

// Estado de las redes especializadas en un análisis con red neuronal (el resumen
// guardado con el análisis: las redes que había cuando se hizo).
function networksBanner(net) {
  if (!net?.nets) return h('div', { class: 'banner warn' }, 'Sin redes especializadas cargadas: las probabilidades son las del análisis estadístico.');
  const order = new Map(NETWORKS.map((n, i) => [n.id, i]));
  const trained = Object.keys(net.nets)
    .filter((id) => net.nets[id]?.trained)
    .sort((a, b) => (order.get(a) ?? order.size) - (order.get(b) ?? order.size));
  const total = net.total || Object.keys(net.nets).length || NETWORKS.length;
  return h(
    'div',
    { class: `banner nets-banner${trained.length ? '' : ' warn'}` },
    `Redes especializadas que corrigen: ${trained.length} de ${total}`,
    trained.length
      ? ` (${trained.join(', ')}). En los demás mercados la probabilidad es la del análisis estadístico.`
      : `. Cada una necesita ${MIN_SAMPLES} resultados de su mercado y mejorar en partidos que no usó para entrenar; por ahora las probabilidades son las del análisis estadístico.`,
  );
}

function renderMethod(root, app, a) {
  const analyzed = Object.keys(a.events).length;
  const net = a.network;
  const summary = h(
    'div',
    { class: 'summary' },
    h('h2', {}, methodTitle(a.method)),
    h(
      'div',
      { class: 'row note' },
      `${analyzed} partidos analizados · ${a.picks.length} picks · ${a.combos.length} combinadas · ${fmtDateTime(Date.parse(a.created))}`,
      a.skipped ? ` · ${a.skipped} omitidos (ya empezaron)` : '',
    ),
    h('div', { class: 'row' }, ['sofascore', 'flashscore', 'apuestatotal', 'betano', 'understat', 'jugadores', 'simulacion', ...(a.method === 'red_neuronal' ? ['noticias'] : [])].map((id) => sourceChip(id, a.sources[id]))),
    levelFilter(app, a),
    sportFilter(app, a),
    a.method === 'red_neuronal' ? networksBanner(net) : null,
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn small', onclick: () => app.copyAnalysis() }, 'Copiar picks'),
      a.saved
        ? h('span', { class: 'chip ok' }, 'Guardado en el historial')
        : app.canSave() && a.candidates.length
          ? h('button', { class: 'btn small', onclick: () => app.saveAnalyses([a]) }, 'Guardar en historial')
          : h('span', { class: 'chip warn' }, 'Sin guardar'),
    ),
  );
  root.append(summary);

  if (!a.picks.length && !a.combos.length) {
    root.append(
      h(
        'div',
        { class: 'banner' },
        'No hubo mercados para mostrar. Solo se analiza la línea .5 más pareja de cada mercado de la lista (⚙ Ajustes), con cuota de Apuesta Total o Betano, y hacen falta al menos 4 partidos con datos de cada equipo (5 de cada jugador). Prueba con más partidos.',
      ),
    );
  }
  const s = a.settings;
  const filter = app.state.levelFilter || 'todos';
  const sport = viewSport(app, a);
  const all = filter === 'todos';
  const shown = a.picks.filter((p) => all || p.level === filter);
  const byEvent = groupBy(shown, (p) => String(p.eventId));
  // Con "Todos" se ven todos los partidos analizados (también los que no tuvieron
  // ninguna apuesta); con un nivel, solo los que tienen mercados de ese nivel.
  const events = Object.entries(a.events || {})
    .map(([id, ev]) => ({ ...ev, id }))
    .filter((ev) => (sport === 'todos' || ev.sport === sport) && (all || byEvent.has(ev.id)));
  const groups = bySportAndLeague(events);
  const opts = { all, marketsOff: s.marketsOff || [] };
  root.append(
    groups.length
      ? h(
          'div',
          { class: 'sport-groups' },
          groups.map((g) =>
            h(
              'section',
              { class: 'sport-group' },
              h('h3', { class: 'grp-sport' }, `${sportOf(g.sport).icon} ${sportOf(g.sport).name}`, h('span', { class: 'note' }, ` ${g.leagues.reduce((n, l) => n + l.events.length, 0)} partidos`)),
              g.leagues.map((l) =>
                h(
                  'div',
                  { class: 'league-group' },
                  h('h4', { class: 'grp-league' }, l.name, h('span', { class: 'note' }, ` · ${l.events.length}`)),
                  h('div', { class: 'match-cards' }, l.events.map((ev) => matchCard(byEvent.get(ev.id) || [], ev, a.method, opts))),
                ),
              ),
            ),
          ),
        )
      : a.picks.length
        ? h('div', { class: 'note' }, `Sin mercados ${all ? '' : `de nivel ${LEVEL_NAME[filter]?.toLowerCase()} `}${sport === 'todos' ? '' : `de ${sportOf(sport).name.toLowerCase()} `}en este análisis.`)
        : null,
  );
  root.append(
    h(
      'div',
      { class: 'level' },
      h('span', { class: 'bar', style: 'background:var(--nn)' }),
      h('h3', {}, 'Combinadas'),
      h('span', { class: 'note' }, `cuota ${s.comboTargets.join(' y ')} o más`),
    ),
  );
  root.append(
    combosOf(a, sport).length
      ? h('div', { class: 'cards' }, combosOf(a, sport).map((k) => comboCard(k, a)))
      : h('div', { class: 'note' }, 'No se pudo armar una combinada: hacen falta más selecciones con cuota en la misma casa.'),
  );
  root.append(
    h(
      'p',
      { class: 'note' },
      'Las probabilidades salen de la estadística de los equipos (no de las cuotas) y son estimaciones, no garantías. Una combinada de cuota 5 tiene, según el propio mercado, alrededor de 20% de probabilidad: la página busca la combinación con la mayor probabilidad estimada para esa cuota. Apuesta solo lo que estés dispuesto a perder.',
    ),
  );
}
