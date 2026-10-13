// Pestaña "Análisis": el último análisis estadístico y el último con red
// neuronal, comparados. Cada partido muestra todos sus mercados con su nivel de
// confianza (también Baja); los de jugador van aparte; después, las combinadas.
import { MIN_SAMPLES } from '../analysis/neural.js';
import { NETWORKS } from '../analysis/networks.js';
import { BOOKMAKERS, isPlayerMarket, LEVELS, marketInfo } from '../analysis/picks.js';
import { sportOf } from '../sports.js';
import { fmtDateTime, fmtTime, groupBy, h, pct } from '../util.js';

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

// Tarjeta de un partido con todos sus mercados (los de jugador, ordenados por probabilidad).
function matchCard(picks, ev, method) {
  const sport = sportOf(picks[0].sport);
  const team = picks.filter((p) => !isPlayerMarket(p.market));
  const players = picks.filter((p) => isPlayerMarket(p.market)).sort((a, b) => b.p - a.p);
  return h(
    'div',
    { class: 'match-card' },
    h('div', { class: 'meta' }, `${sport.icon} ${ev?.league || ''} · ${fmtTime(picks[0].start)}`),
    h('div', { class: 'teams' }, ev ? `${ev.home} vs ${ev.away}` : ''),
    team.map((p) => marketRow(p, method)),
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

// Texto para copiar y compartir (WhatsApp, notas...): por partido, cada mercado con su nivel.
export function analysisText(a, filter = 'todos') {
  const lines = [`${methodTitle(a.method)} · ${a.date}`];
  for (const picks of groupBy(a.picks.filter((p) => filter === 'todos' || p.level === filter), (p) => p.eventId).values()) {
    const ev = a.events[picks[0].eventId];
    lines.push('', `${ev.home} vs ${ev.away} (${fmtTime(picks[0].start)})`);
    for (const p of picks) lines.push(`• ${p.label} @ ${p.best.price.toFixed(2)} ${BOOKMAKERS[p.best.source]} · ${pct(p.p)} (${LEVEL_NAME[p.level]})`);
  }
  if (a.combos.length) {
    lines.push('', 'Combinadas');
    const byKey = new Map(a.candidates.map((c) => [`${c.eventId}|${c.key}`, c]));
    for (const k of a.combos) {
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
  return h(
    'div',
    { class: 'segmented levels', role: 'group', 'aria-label': 'Nivel de confianza a mostrar' },
    btn('todos', 'Todos', a.picks.length, 'Todos los mercados'),
    LEVELS.map((l) => btn(l.id, l.name, a.picks.filter((p) => p.level === l.id).length, `Confianza ${l.name.toLowerCase()}: ${ranges[l.id]}`)),
  );
}

// Estado de las redes especializadas en un análisis con red neuronal.
function networksBanner(net) {
  if (!net?.nets) return h('div', { class: 'banner warn' }, 'Sin redes especializadas cargadas: las probabilidades son las del análisis estadístico.');
  const trained = NETWORKS.filter((n) => net.nets[n.id]?.trained);
  return h(
    'div',
    { class: `banner${trained.length ? '' : ' warn'}` },
    trained.length
      ? `Corrigen ${trained.length} de ${NETWORKS.length} redes especializadas: ${trained.map((n) => n.id).join(', ')}. En los demás mercados la probabilidad es la del análisis estadístico.`
      : `Ninguna red especializada corrige todavía: cada una necesita ${MIN_SAMPLES} resultados de su mercado y mejorar en partidos que no usó para entrenar. Por ahora las probabilidades son las del análisis estadístico.`,
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
  const shown = a.picks.filter((p) => filter === 'todos' || p.level === filter);
  const groups = [...groupBy(shown, (p) => p.eventId).values()];
  root.append(
    groups.length
      ? h('div', { class: 'match-cards' }, groups.map((picks) => matchCard(picks, a.events[picks[0].eventId], a.method)))
      : a.picks.length
        ? h('div', { class: 'note' }, `Sin mercados de nivel ${LEVEL_NAME[filter]?.toLowerCase()} en este análisis.`)
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
    a.combos.length
      ? h('div', { class: 'cards' }, a.combos.map((k) => comboCard(k, a)))
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
