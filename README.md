# Análisis BDP

Página web para analizar partidos de fútbol, básquet y béisbol, encontrar las
mejores cuotas de Apuesta Total y Betano por nivel de confianza y llevar el
historial de resultados. Funciona en el **celular y en la PC**:
<https://markosaz.github.io/Analisis-bdp---New-market/>

- **Partidos**: fútbol, básquet y béisbol, agrupados por país y liga. Marca
  ligas completas o partidos sueltos. Dos fuentes:
  - **Automático** (celular y PC, sin instalar nada): partidos de hoy y mañana de
    Flashscore con los mercados analizados de Apuesta Total, últimos partidos, H2H
    y estadísticas promedio de cada equipo (córners, tarjetas, tiros...) y xG de
    Understat/Flashscore. GitHub Actions los actualiza **cada 2
    horas**. Los partidos con cuotas llevan la marca *cuotas*.
  - **Sofascore** (PC con la extensión): cualquier día, con forma, bajas y votos
    de Sofascore. Al analizar, la extensión suma las estadísticas de equipo de
    Sofascore **y** de Flashscore, todos los mercados de Betano (abre la página
    de cada partido) y los de Apuesta Total en vivo.
- **Mercados analizados** (solo estos):
  - Fútbol: goles totales Más/Menos, ambos equipos anotan, Más/Menos córners,
    **hándicap de córners** (el de dos opciones; el de tres, con empate, no),
    total de tarjetas, tiros al arco, remates totales y córners del primer tiempo
    (siempre el total del partido, no los de cada equipo).
  - Básquet: total de puntos, hándicap, hándicap y total de puntos del primer
    tiempo y los **Más/Menos de jugador** (puntos, rebotes, asistencias, robos,
    tapones, pérdidas, rebotes ofensivos y defensivos; triples, tiros de campo,
    tiros de 2 y tiros libres, anotados **e intentados**; y los combinados
    P+R+A, P+R, P+A, R+A y robos+tapones). Sus cuotas son de **Apuesta Total**
    (puntos, rebotes, asistencias, triples y sus combinados; también en el
    celular, sin la extensión) y de **Betano** (con la extensión, en la PC). Los
    intentados (tiros de campo, triples, de 2 y libres) solo si alguna casa los
    ofrece. Los últimos partidos de cada jugador salen de **ESPN** en la NBA y
    la WNBA (si con su equipo tiene menos de 10, p. ej. un traspasado o al
    comenzar la temporada, se completan con su registro de partidos, también
    los que jugó con otro equipo) y de **Sofascore** en las demás ligas.
    Primer tiempo: Apuesta Total publica sus líneas pocas horas antes del
    partido y la principal a veces es entera (88, +1): se usan sus líneas
    "extra" con .5; si solo hay enteras, el partido lo dice.
  - Béisbol: ganador, hándicap (run line) y total de carreras.
- **Una línea por mercado**: solo líneas .5 (sin enteras ni asiáticas, así solo
  hay dos resultados posibles y nunca devolución) y, en cada casa por separado,
  la línea con **menos diferencia entre sus dos cuotas**. Ejemplo: Más 2.5 @1.75 /
  Menos 2.5 @1.80 (diferencia 0.05) gana a Más 3.5 @1.90 / Menos 3.5 @2.05
  (0.15). Si las dos casas eligen la misma línea, el pick muestra la mejor cuota.
- **Análisis estadístico** (datos de Sofascore y Flashscore, sin noticias): la
  probabilidad sale **solo de la estadística**, las cuotas no la cambian. Goles,
  ambos marcan y béisbol: modelo de Poisson con la forma reciente, H2H y xG;
  básquet: modelo de puntos (sin los partidos de la Summer League, que duran 40
  minutos); córners (total y hándicap), tarjetas y tiros:
  promedios de cada equipo (lo que hace y lo que le permite el rival); primer
  tiempo del básquet: partido
  simulado miles de veces. Hacen falta al menos 4 partidos con datos de cada
  equipo. Jugadores: sus últimos 10 partidos (los más recientes pesan más; al
  menos 5 jugados). Si figura como baja, no se analiza. La probabilidad que dan
  las cuotas se muestra solo como referencia.
- **Análisis con red neuronal**: **36 redes especializadas** y ninguna mezcla
  mercados (los córners del primer tiempo no aprenden de los del partido, ni los
  tiros al arco de los remates, ni los rebotes de un jugador de sus puntos):
  - Una por mercado de la lista (15): `Football_Goals_Model` (goles totales),
    `Football_BTTS_Model` (ambos anotan), `Football_Corners_Model` (córners),
    `Football_CornersHandicap_Model` (hándicap de córners),
    `Football_Cards_Model` (tarjetas), `Football_ShotsOnTarget_Model` (tiros al
    arco), `Football_Shots_Model` (remates totales), `Football_CornersH1_Model`
    (córners del primer tiempo), `Basketball_Totals_Model` (total de puntos),
    `Basketball_Handicap_Model` (hándicap), `Basketball_HandicapH1_Model`
    (hándicap del primer tiempo), `Basketball_TotalsH1_Model` (total del primer
    tiempo), `Baseball_Winner_Model` (ganador), `Baseball_RunLine_Model`
    (run line) y `Baseball_Totals_Model` (total de carreras).
  - Una por estadística de los Más/Menos de jugador (21):
    `Basketball_PlayerPoints_Model` (puntos), `Basketball_PlayerRebounds_Model`
    (rebotes), `Basketball_PlayerAssists_Model` (asistencias),
    `Basketball_PlayerThreesMade_Model` (triples anotados),
    `Basketball_PlayerThreesAttempted_Model` (triples intentados),
    `Basketball_PlayerFieldGoalsMade_Model` (tiros de campo anotados),
    `Basketball_PlayerFieldGoalsAttempted_Model` (tiros de campo intentados),
    `Basketball_PlayerTwosMade_Model` (tiros de 2 anotados),
    `Basketball_PlayerTwosAttempted_Model` (tiros de 2 intentados),
    `Basketball_PlayerFreeThrowsMade_Model` (tiros libres anotados),
    `Basketball_PlayerFreeThrowsAttempted_Model` (tiros libres intentados),
    `Basketball_PlayerSteals_Model` (robos), `Basketball_PlayerBlocks_Model`
    (tapones), `Basketball_PlayerTurnovers_Model` (pérdidas),
    `Basketball_PlayerOffensiveRebounds_Model` (rebotes ofensivos),
    `Basketball_PlayerDefensiveRebounds_Model` (rebotes defensivos),
    `Basketball_PlayerPtsRebAst_Model` (P+R+A), `Basketball_PlayerPtsReb_Model`
    (P+R), `Basketball_PlayerPtsAst_Model` (P+A), `Basketball_PlayerRebAst_Model`
    (R+A) y `Basketball_PlayerStealsBlocks_Model` (robos + tapones). Las de
    intentos (tiros de campo, triples, tiros de 2 y tiros libres intentados) y
    la de tiros de campo anotados son de los Más/Menos de jugador nuevos.

  Cada una aprende solo de los resultados de su mercado (con los datos del
  partido, la distancia de la línea a lo esperado y las noticias de Flashscore,
  ESPN y FotMob) y corrige la probabilidad estadística solo cuando tiene 200
  resultados de su mercado y mejora en partidos que no usó para entrenar
  (validación en el tiempo: cada tramo reciente se predice con lo aprendido
  antes; la mejora debe ser de al menos 1 % y no explicarse por azar); mientras
  tanto, su mercado queda con la probabilidad estadística. Aprenden de la
  apuesta de cada mercado de cada partido (el lado más probable, también si no
  tiene valor o su probabilidad es muy alta); en las de jugador, hasta 8
  jugadores por partido en cada red. Se reentrenan al
  actualizar resultados; el Historial muestra el estado de cada una, agrupadas
  por deporte.
- **Todos los mercados de cada partido con su nivel de confianza**: alta
  (≥ 80 %), moderada-alta (70–80 %), moderada (60–70 %) y **baja** (menos de
  60 %), con la mejor cuota entre Apuesta Total y Betano. Cada mercado tiene su
  apuesta aunque no tenga valor o su cuota sea muy baja; si no se pudo apostar,
  el partido lo muestra igual con el motivo (ninguna casa tiene línea .5, o
  faltan datos de los equipos). La pestaña Análisis muestra los partidos **por
  deporte y, dentro, por liga** (los de jugador aparte en su partido), con un
  filtro por nivel y otro por deporte; el detalle de cada día del Historial va
  en el mismo orden y también se filtra por deporte.
- **Combinadas** de cuota 5 o más (y 10 o más) en una misma casa, con la mayor
  probabilidad estimada posible.
- **Ambos análisis**: hace el estadístico y el de red neuronal con los mismos
  partidos (los datos se piden una sola vez). La pestaña Análisis los compara
  (picks por nivel, cuántos coinciden) y deja ver el detalle de cada uno.
- **Historial**: cada análisis se guarda con sus picks y se sigue **por
  separado**: el botón *Actualizar resultados* los marca como ganados o
  perdidos (o medio ganados/perdidos en líneas asiáticas) y calcula aciertos,
  ganancia y ROI por nivel y de las combinadas para el análisis estadístico y
  para el de red neuronal. El nivel Baja tiene su propia fila y no se suma al
  total. Se liquidan con el registro completo del partido (marcador por
  periodo, goles con minuto, tarjetas y estadísticas de Flashscore y Sofascore;
  las de jugador, con su estadística en el partido: ESPN o Sofascore; si no
  jugó, la apuesta queda nula). Si un mismo pick sale en dos análisis del mismo día
  y método, cuenta una sola vez; una apuesta cuyo dato no publica ninguna
  fuente queda nula a los 4 días.

Los niveles, la cuota mínima de las selecciones de las combinadas, las cuotas
objetivo de las combinadas, **cuáles
de los mercados analizados pueden salir como pick** (también los de jugador),
si se abre la página de cada partido en Betano y el token de GitHub se cambian
en **⚙ Ajustes**.

## Cómo se usa

1. Abre <https://markosaz.github.io/Analisis-bdp---New-market/> en el celular o en la PC.
2. Pega tu token de GitHub en **⚙ Ajustes** (una vez en cada dispositivo; ver
   abajo) para que el historial se guarde en el repositorio.
3. Marca partidos o ligas y pulsa **Análisis estadístico**, **Análisis red
   neuronal** o **Ambos análisis**. Cada análisis se guarda solo en el historial.
4. Al día siguiente, en **Historial**, pulsa **Actualizar resultados**. Los
   partidos automáticos se liquidan con los resultados publicados (cada 2 horas);
   los de Sofascore necesitan la extensión.

### Guardar en GitHub

Sin token, el historial y la red neuronal se guardan solo en ese navegador. Con
el token se guardan en `docs/data/` del repositorio y los ves igual en el
celular y en la PC:

1. En GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**. Acceso solo a este repositorio,
   permiso **Contents: Read and write**.
2. En la página: **⚙ Ajustes → Guardar el historial en GitHub** → pega el token →
   **Guardar y probar**. Repite en cada dispositivo.
3. Si ya tenías datos en el navegador, en Historial aparece el botón para
   subirlos.

El token se guarda solo en ese navegador (lo pueden leer las páginas de
`markosaz.github.io`, que son tuyas) y la página solo lo usa para escribir
archivos JSON dentro de `docs/data/`. Para quitarlo: **Olvidar token**. El
repositorio es público, así que el historial también lo es. En la PC también
puedes guardar el token en la extensión (clic en su ícono → Guardar en GitHub).

### Extensión (opcional, solo PC)

Sofascore y Betano solo responden desde tu navegador en Perú. Con la extensión
la página suma Sofascore (cualquier día) y Betano. Instrucciones en
[`extension/README.md`](extension/README.md).

## Publicar la página

En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. El workflow **Página** (`.github/workflows/pagina.yml`) publica
`docs/` junto con los datos automáticos cada 2 horas y cada vez que cambia la
página en `main`. Para publicar en el momento: **Actions → Página → Run
workflow**.

## Estructura

```
docs/                 página web (GitHub Pages)
  index.html, css/    interfaz
  js/app.js           une todo
  js/views/           pestañas Partidos, Análisis e Historial
  js/analysis/        modelos, cuotas y línea más pareja, emparejamiento, picks, combinadas, red neuronal
    catalog.js        traduce los mercados de Betano y Apuesta Total a un formato común
    outcomes.js       liquida cualquier mercado con el registro del partido
    simulate.js       simula partidos (primer tiempo del básquet)
    stats.js          córners, tarjetas y tiros con los promedios de cada equipo
    players.js        Más/Menos de jugador: modelo, nombres y liquidación
    networks.js       redes especializadas (una por mercado y una por estadística de jugador)
    records.js        registro del partido con datos de Flashscore y Sofascore
    teamstats.js      estadísticas promedio de cada equipo
    news.js           señales de las noticias para la red neuronal
  js/flashscore-link.js  partidos de Sofascore + datos de Flashscore (con la extensión)
  js/provider.js      lee los datos automáticos (data/fuente/)
  js/data-format.js   formato compacto de esos datos
  js/github.js        guardar en GitHub con el token del navegador
  js/history.js       guardar, liquidar resultados, entrenar la red
  data/               historial y redes especializadas (cuando se guarda en GitHub)
extension/            extensión de Chrome (Sofascore, Betano) y conectores de las fuentes
scripts/              recolección de datos y prueba de las fuentes (GitHub Actions)
tests/                pruebas unitarias y de punta a punta
```

## Pruebas

```
node --test tests/*.test.mjs                 # cálculo: modelos, cuotas, combinadas, red
node tests/e2e/run.cjs                       # página completa, con y sin extensión (requiere Playwright)
node scripts/collect-data.mjs site           # recolecta los datos automáticos en site/data/fuente/
```

Las probabilidades son estimaciones, no garantías. Apuesta solo lo que estés
dispuesto a perder.
