// Gráfico de barras de la pestaña Datos (como el de bettingpros): una barra por
// partido con su valor, la línea punteada y el promedio como línea continua. Por
// encima de la línea, azul; por debajo, rojo; justo en la línea (se devuelve), gris.
// La posición frente a la línea ya lo dice; el color lo refuerza (par validado para
// daltonismo). Tocar, enfocar o pasar por una barra muestra su partido debajo; la
// tabla con todos los partidos va aparte (la arma quien usa el gráfico).
// Totales grandes (los puntos del básquet: 200 y pico frente a una línea de 218.5):
// desde cero todas las barras se verían iguales, así que salen desde la línea, hacia
// arriba o hacia abajo según cuánto se pasó o le faltó (con su valor en la punta).
import { h } from '../util.js';

export const fmtNum = (x, d = 1) => (Number.isFinite(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(d).replace(/\.0$/, '')) : '–');

// ¿Barras desde la línea? Solo con una línea grande y todos los valores lejos de cero.
export const fromLine = (values, line) => Number.isFinite(line) && line >= 50 && values.length > 0 && Math.min(...values) > 0.6 * line;

// items: [{ value, label (debajo de la barra, corta), title (el partido completo) }],
// del más viejo al más reciente. line: línea (o null). Devuelve el elemento.
export function barChart({ items, line = null, name = '' }) {
  const values = items.map((x) => x.value);
  const avg = values.length ? values.reduce((s, x) => s + x, 0) / values.length : null;
  const hasLine = Number.isFinite(line);
  const diverging = fromLine(values, line);
  // Escala: fracción de la altura desde abajo (con negativos, p. ej. la diferencia,
  // el cero queda más arriba y esas barras bajan desde él).
  let lo = Math.min(0, ...values, hasLine ? line : 0) * 1.1;
  let hi = Math.max(1, ...values, hasLine ? line : 0) * 1.08;
  if (diverging) {
    lo = line - Math.max(1, ...values.map((v) => line - v)) * 1.1;
    hi = line + Math.max(1, ...values.map((v) => v - line)) * 1.1;
  }
  const y = (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const pc = (f) => `${(f * 100).toFixed(2)}%`;
  const base = diverging ? line : 0;
  const caption = h('p', { class: 'bars-caption', 'aria-live': 'polite' }, items.length ? 'Toca una barra para ver su partido.' : '');
  const show = (x) => (caption.textContent = x.title);
  const sideOf = (v) => (!hasLine ? '' : v > line ? 'over' : v < line ? 'under' : 'push');
  const cols = items.map((x) => {
    const a = y(Math.min(base, x.value));
    const b = y(Math.max(base, x.value));
    const down = diverging ? x.value < line : x.value < 0;
    return h(
      'button',
      { type: 'button', class: `col ${sideOf(x.value)}${down ? ' down' : ''}`, title: x.title, 'aria-label': x.title, onmouseenter: () => show(x), onfocus: () => show(x), onclick: () => show(x) },
      h('span', { class: 'bar', style: `bottom:${pc(a)};height:${pc(b - a)}` }),
      // El valor en la punta: arriba de la barra o, si baja desde la línea, debajo.
      h('span', { class: `val${down ? ' down' : ''}`, style: down ? `top:${pc(1 - a)}` : `bottom:${pc(b)}` }, fmtNum(x.value)),
    );
  });
  // Las dos líneas sin texto encima (taparía el valor de una barra): las nombra la leyenda.
  const marks = [];
  if (lo < 0 && !diverging) marks.push(h('div', { class: 'zero', style: `bottom:${pc(y(0))}` }));
  if (hasLine) marks.push(h('div', { class: 'thr', style: `bottom:${pc(y(line))}` }));
  if (Number.isFinite(avg)) marks.push(h('div', { class: 'avg', style: `bottom:${pc(y(avg))}` }));
  const legend = items.length
    ? h(
        'div',
        { class: 'bars-legend' },
        hasLine ? h('span', {}, h('i', { class: 'sw over' }), `Más de ${fmtNum(line)}`) : null,
        hasLine ? h('span', {}, h('i', { class: 'sw under' }), `Menos de ${fmtNum(line)}`) : null,
        hasLine && items.some((x) => x.value === line) ? h('span', {}, h('i', { class: 'sw push' }), 'Justo en la línea') : null,
        hasLine ? h('span', {}, h('i', { class: 'key k-line' }), `Línea ${fmtNum(line)}`) : null,
        h('span', {}, h('i', { class: 'key k-avg' }), `Promedio ${fmtNum(avg)}`),
        diverging ? h('span', {}, 'Las barras salen de la línea: cuánto se pasó o le faltó') : null,
      )
    : null;
  return h(
    'div',
    { class: `bars${diverging ? ' diverging' : ''}`, role: 'group', 'aria-label': name },
    h('div', { class: 'plot' }, h('div', { class: 'area' }, ...marks, h('div', { class: 'cols' }, ...cols))),
    // Muchas barras: letra más chica y, en poco ancho, una etiqueta de cada dos (CSS).
    h('div', { class: `xlabels${items.length > 8 ? ' dense' : ''}${items.length > 12 ? ' many' : ''}` }, ...items.map((x) => h('span', { title: x.title }, x.label))),
    legend,
    caption,
  );
}
