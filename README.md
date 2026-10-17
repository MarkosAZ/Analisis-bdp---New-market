# Análisis BDP

Página web para analizar partidos de fútbol, básquet y béisbol, encontrar las
mejores cuotas de Apuesta Total y Betano por nivel de confianza y llevar el
historial de resultados. Funciona en el **celular y en la PC**:
<https://markosaz.github.io/Analisis-bdp---New-market/>

- **Partidos**: fútbol, básquet y béisbol, agrupados por país y liga, con los
  países de la A a la Z (en cada país, la liga más importante primero). El pin 📌
  de cada liga la fija arriba (se recuerda en ese navegador). Marca ligas
  completas o partidos sueltos. Dos fuentes:
  - **Automático** (celular y PC, sin instalar nada): partidos de hoy y mañana de
    Flashscore con los mercados analizados de Apuesta Total, últimos partidos, H2H
    y estadísticas promedio de cada equipo (córners, tarjetas, tiros...) y xG de
    Understat/Flashscore. GitHub Actions los actualiza **cada 2
    horas**. Los partidos con cuotas llevan la marca *cuotas*.
  - **Sofascore** (PC con la extensión): cualquier día, con forma, bajas y votos
    de Sofascore. Al analizar, la extensión suma las estadísticas de equipo de
    Sofascore **y** de Flashscore, todos los mercados de Betano (abre la página
    de cada partido) y los de Apuesta Total en vivo.
- **Datos** (entre Partidos y Análisis): todos los partidos de hoy y mañana con
  datos publicados, por liga (o solo los que tienen cuotas). Al tocar uno se ven
  sus números en **barras, como en bettingpros**: una barra por partido con su
  valor, la línea punteada (la de Apuesta Total o una elegida con − y +) y el
  promedio como línea continua; azul si pasó la línea, rojo si quedó por debajo y
  gris si quedó justo en ella. Arriba de cada gráfico, el promedio, la mediana y
  cuántas veces pasó la línea; debajo, la tabla con los partidos. Tocar una barra
  muestra su partido.
  - **Cada equipo**: sus últimos 5, 10 o 15 partidos, todos o solo el local de
    local y la visita de visita; del partido, a favor o en contra. Fútbol: goles,
    córners, tarjetas, remates, tiros al arco, córners del 1.er tiempo y faltas;
    básquet: puntos, rebotes, asistencias y triples (los totales de puntos salen
    desde la línea, hacia arriba o hacia abajo, para que se note la diferencia);
    béisbol: carreras.
  - **Enfrentamientos**: los últimos entre ambos (hasta 10, los que da
    Flashscore), quién ganó cada uno y la misma estadística en cada uno; y un
    resumen de los dos equipos (ganados, goles, más de 2.5, ambos marcan, córners
    y tarjetas a favor y en contra).
  - **Jugadores de la NBA y la WNBA** (ESPN): en cada partido por jugar, los 8
    de cada equipo con más minutos en sus últimos 30 partidos y los que ofrece la
    casa (aunque no ofrezca a nadie, p. ej. en la pretemporada): sus últimos 5, 10,
    15 o 20 partidos o todos los que jugó contra el rival de hoy en las dos
    últimas temporadas, en puntos, rebotes, asistencias y los combinados (P+R+A,
    P+R, P+A, R+A); tiros de campo, triples, de 2 y libres, anotados e intentados;
    robos, tapones, robos+tapones, pérdidas y minutos. Con la línea de la casa si
    la ofrece (si no, una cerca del promedio).
  - **Abridores de la MLB**: sus últimas 5, 10 o 20 aperturas en ponches, hits
    y carreras limpias permitidos, bases por bolas y entradas lanzadas.
  - Cada partido es un archivo `data/fuente/datos/<id>.json` (unos 4 KB) que la
    página baja al tocarlo. Primero se arman los partidos con cuotas y después los
    demás; las estadísticas de cada partido (córners, tarjetas...) se piden a
    Flashscore de a poco y quedan en caché, así que en las primeras
    actualizaciones algunos partidos salen solo con el marcador y los que todavía
    no tienen archivo se completan en las siguientes (la lista dice cuántos
    faltan).
- **Errores de cuota** (después de Datos): tras lanzar el análisis (estadístico,
  red neuronal o ambos), la línea más pareja de cada casa frente a los datos del
  partido (los de la pestaña Datos). Si el promedio de los últimos 5, 10 o 15
  partidos de cada equipo (todos o local de local y visita de visita), o del
  jugador, queda lejos de la línea y lo confirma cuántas veces la pasaron, la opción
  que favorecen los datos aparece como error de cuota, con su cuota, la de la otra
  opción y la probabilidad del análisis. Ejemplo: promedio de 3.5 goles con la línea
  en 2.5 → "Más de 2.5". Qué tan lejos depende de cuánto varía cada mercado (la
  diferencia se mide en desviaciones de esos partidos: un gol pesa lo que varios
  puntos en el básquet) y de la exigencia elegida:
  - baja: 0.25 desviaciones y 55 % de los partidos de ese lado;
  - media (por defecto): 0.4 y 60 %;
  - alta: 0.6 y 70 %.
  Cubre los totales y los hándicaps (en el hándicap, lo que suele sacar cada equipo
  frente a la línea del local) y los Más/Menos de jugador; no ambos marcan, el
  ganador ni el 1.er tiempo del básquet. "Ver en Datos" abre el partido en Datos
  con esa estadística y esa línea. Solo partidos con datos publicados (hoy y
  mañana, de Flashscore).
  **Seguimiento:** los errores que hay al lanzar el análisis (con los partidos,
  local/visita y exigencia elegidos en la pestaña) se guardan en el historial del
  día, aparte de los métodos (son los mismos en el estadístico y en el de red
  neuronal), y se liquidan con los mismos resultados que los picks. En Historial,
  el panel "Errores de cuota" da resueltas, aciertos, ganancia y ROI (a 1 u cada
  uno), en total y por deporte, y cada día muestra los suyos. Si se vuelve a
  analizar un partido, sus errores pendientes se reemplazan por los nuevos.
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
    "extra" con .5 y, si solo hay enteras, la entera más pareja (si el
    resultado queda justo en la línea, se devuelve; la probabilidad es sin
    contar ese empate y la tarjeta lo avisa).
  - Béisbol: ganador, hándicap (run line) y total de carreras.
- **Una línea por mercado**: solo líneas .5 (sin enteras ni asiáticas, así solo
  hay dos resultados posibles y nunca devolución; la excepción es el 1.er tiempo
  del básquet sin .5) y, en cada casa por separado,
  la línea con **menos diferencia entre sus dos cuotas**. Ejemplo: Más 2.5 @1.75 /
  Menos 2.5 @1.80 (diferencia 0.05) gana a Más 3.5 @1.90 / Menos 3.5 @2.05
  (0.15). Si las dos casas eligen la misma línea, el pick muestra la mejor cuota.
- **Análisis estadístico** (datos de Sofascore y Flashscore, sin noticias): la
  probabilidad sale **solo de la estadística**, las cuotas no la cambian. Goles y
  ambos marcan: modelo de Poisson con la forma reciente, H2H y xG; béisbol: ver
  abajo (abridores);
  básquet: modelo de puntos (sin los partidos de la Summer League, que duran 40
  minutos); córners (total y hándicap), tarjetas y tiros:
  promedios de cada equipo (lo que hace y lo que le permite el rival); primer
  tiempo del básquet: partido
  simulado miles de veces. Hacen falta al menos 4 partidos con datos de cada
  equipo. Jugadores: sus últimos 10 partidos (los más recientes pesan más; al
  menos 5 jugados). Si figura como baja, no se analiza. La probabilidad que dan
  las cuotas se muestra solo como referencia.
- **Béisbol: gira en torno a los abridores.** Carreras esperadas de cada equipo
  con su ofensiva (últimos partidos, muy acercados a la media de la liga: en
  béisbol la forma reciente es casi ruido) frente al pitcheo del rival: su
  **abridor** en las entradas que suele lanzar (carreras por 9 entradas y FIP de
  sus últimas aperturas, de la API oficial de la MLB) y su **bullpen** en el resto
  (peor si lanzó mucho en los 3 días anteriores). **Contexto**: localía, estadio
  (carreras de local frente a visita), clima (temperatura y viento) y serie de
  playoffs; los **enfrentamientos** recientes entre ambos (últimos 2 años) se
  muestran y pesan poco. Binomial negativa (las carreras varían más que una
  Poisson) y entradas extra para el ganador, el total y el run line. Sin datos de
  abridores (Japón, Corea, ligas de invierno) se usa lo mismo sin el abridor.
  Los ajustes salen de una prueba retrospectiva con los 2176 partidos de la MLB
  2026 (abril a septiembre, cada partido solo con lo que se sabía antes de
  jugarse), revisada por periodos para no ajustarse a unos meses. Pérdida
  logarítmica (menos es mejor):

  | | Ganador | Total | Run line |
  |---|---|---|---|
  | Modelo anterior | 0.838 | 0.750 | 0.804 |
  | Siempre la frecuencia de la liga | 0.692 | 0.683 | 0.652 |
  | Sin abridores | 0.690 | 0.682 | 0.651 |
  | **Actual** | **0.684** | **0.673** | **0.645** |

  El ganador de un partido de béisbol es difícil de anticipar: la mejora sobre
  la frecuencia de la liga es chica (lo normal en este deporte) y viene sobre
  todo de los abridores; la ventaja frente a la casa suele ser pequeña.
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
  jugadores por partido en cada red. Se reentrenan **cada día en GitHub
  Actions** con los resultados guardados y los partidos históricos (ver
  *Datos históricos*); la página solo lee `docs/data/modelo/redes.json`. El
  Historial muestra el estado de cada una, agrupadas por deporte.
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

## Datos históricos y prueba retrospectiva

Para ajustar el análisis estadístico y entrenar las redes sin esperar meses de
resultados propios, `data/historico/` guarda partidos pasados (se descargan en
GitHub Actions con el flujo *Datos históricos*):

Todo va desde 2010 (unos 200 MB):

- **Fútbol** (ESPN, unos 17 000 partidos desde 2023-24): Premier League, LaLiga,
  Bundesliga, Serie A, Ligue 1, Portugal, Bélgica, MLS, Brasil, Noruega,
  Suecia, Liga 1 de Perú, Champions, Europa League, Conference League,
  Libertadores, Sudamericana, Liga de Naciones, Eurocopa, Copa América,
  Mundiales, eliminatorias y amistosos. Con córners, tarjetas, remates, tiros
  al arco, goles por tiempo y córners del 1.er tiempo. Más las cuotas de cierre
  de football-data.co.uk (desde 2010-11; hasta 2018-19 es el promedio previo
  al partido, no el cierre; también en 15 ligas de Sofascore: Championship,
  League One y Two, National League, Escocia, 2. Bundesliga, Serie B, LaLiga
  Hypermotion, Ligue 2, Eredivisie, Süper Lig y Grecia) y el xG de Understat
  (desde 2014-15). Lo que ESPN no trae (córners del
  1.er tiempo de Bélgica, Noruega, Suecia y Perú, estadísticas de la Liga 1 2024,
  de eliminatorias y amistosos...) se completa con Sofascore
  (`scripts/historico/completar.mjs`, desde una sesión con internet: Sofascore
  no responde a GitHub Actions); solo faltan algunos amistosos y eliminatorias
  que Sofascore tampoco tiene.
- **Fútbol, resto de ligas apostables** (Sofascore, unos 633 000 partidos de
  191 torneos desde 2010, en `data/historico/futbol/sofascore/`, más las
  temporadas 2010 a 2023 de las competiciones de ESPN): segundas y
  terceras divisiones (Championship, LaLiga Hypermotion, 2. Bundesliga, Serie
  B, Ligue 2...), Eredivisie, Süper Lig, Escocia, Austria, Suiza, Grecia,
  Dinamarca, Polonia, Chequia y el resto de Europa; Argentina, Colombia, Chile,
  Ecuador, Uruguay, Paraguay, Bolivia, Venezuela, Liga 2 de Perú, Série B y C y
  estaduales de Brasil; Liga MX, USL, Centroamérica; Japón, Corea, China,
  Arabia Saudí, Australia...; Egipto, Marruecos, Sudáfrica...; copas
  nacionales; ligas femeninas; Concacaf, AFC, CAF, Mundial de Clubes y
  amistosos de clubes (estos, desde 2023). Mismo formato que ESPN. Sofascore
  tiene estadísticas de las ligas principales desde 2010 y córners del 1.er
  tiempo desde 2015 más o menos; de las ligas chicas, en los años viejos, solo
  el resultado (277 000 partidos con córners, 162 000 con los del 1.er tiempo) (`scripts/historico/sofascore.mjs`, también desde
  una sesión con internet). `equipos.json` une 698 equipos de Sofascore con su
  id de ESPN para que, por ejemplo, un equipo de la Premier tenga en su
  historia también la FA Cup y la EFL Cup.
- **NBA** (ESPN, desde 2010-11, 16 temporadas): cuartos y estadísticas de
  cada jugador.
- **Euroliga y Liga ACB** (Sofascore, desde 2010-11, en `data/historico/basquet/`;
  `scripts/historico/basquet.mjs`): cuartos y, desde 2016-17 en la Euroliga y
  2021-22 en la ACB, estadísticas de cada jugador.
- **MLB** (statsapi, 2010 a 2026): abridores probables y sus aperturas.

Cada red usa sus 15 000 filas más recientes, así que el entrenamiento diario
solo reproduce los últimos 3 años de fútbol, 2 de jugadores de la NBA y 8 de
los mercados de equipo de la NBA (cada partido se simula y más no entra en el
tiempo de GitHub Actions); la MLB usa todas las temporadas. Los años viejos
sirven para la historia de cada equipo (forma, enfrentamientos directos) y para
la prueba retrospectiva.

Otras fuentes de fútbol revisadas (guardadas por si hacen falta; hoy no se usan
porque Sofascore, ESPN, football-data y Understat ya cubren lo mismo):

| Página | Qué tiene | Estado |
|---|---|---|
| [FotMob](https://www.fotmob.com/) | estadísticas y xG por partido | su API cambió; solo por la página |
| [WhoScored](https://www.whoscored.com/) | estadísticas de Opta por partido | bloquea los pedidos automáticos (403) |
| [FBref](https://fbref.com/) | estadísticas por temporada y partido | bloquea los pedidos automáticos (403) |
| [dataref](https://dataref.net/) | estadísticas de jugadores argentinos en el exterior | accesible; no aporta a los mercados |
| [Understat](https://understat.com/) | xG de las 5 grandes ligas desde 2014 | ya se usa |
| [Flashscore](https://www.flashscore.com/) | cuotas de varias casas por partido | se usa para las cuotas de NBA, MLB, Euroliga y ACB |
| [Oddspedia](https://oddspedia.com/) | cuotas por partido | bloquea los pedidos automáticos (403) |

`scripts/historico/repeticion/` analiza cada partido **con el mismo código de
la página y solo con lo que se sabía antes de que empezara** (últimos
partidos, estadísticas, enfrentamientos, xG, abridores) y lo liquida igual que
la página. Las cuotas son las reales del cierre donde las hay (`k` en cada
partido): en el fútbol, de Sofascore desde 2024-25 (goles en todas las líneas,
ambos anotan, tarjetas y córners; `scripts/historico/cuotas-sofascore.mjs`) y,
antes, Más/Menos 2.5 de football-data en 22 ligas; en la NBA, la MLB, la
Euroliga y la Liga ACB, de Flashscore (total, hándicap y ganador, y en el
básquet también el 1.er tiempo; promedio de las casas,
`scripts/historico/cuotas-flashscore.mjs`). En el resto, la línea la pone una
casa simulada con la media reciente y las variables de cuotas quedan fijas, para
que la red no aprenda de una cuota inventada.

Con esa prueba (pérdida logarítmica: menos es mejor; 0.693 es tirar una
moneda) se ajustó el análisis estadístico con los partidos hasta junio de
2025 y se comprobó con los posteriores:

| Mercado (prueba: jul 2025 – oct 2026) | Antes | Ahora |
|---|---|---|
| Fútbol: goles Más/Menos | 0.6900 | 0.6839 |
| Fútbol: ambos anotan | 0.6942 | 0.6865 |
| Fútbol: remates totales | 0.6935 | 0.6899 |
| Fútbol: tiros al arco | 0.6894 | 0.6877 |
| Fútbol: tarjetas | 0.6811 | 0.6802 |
| Fútbol: córners del 1.er tiempo | 0.6834 | 0.6824 |
| Fútbol: córners (total y hándicap) | sin cambios | |
| NBA: hándicap (temporada 2025-26) | 0.7055 | 0.6923 |
| NBA: total | 0.6923 | 0.6909 |
| NBA: jugadores | 0.6810 | 0.6782 |

- **Fútbol**: el modelo de goles se pasaba de seguro (decía 58 % y acertaba
  55 %) y ambos anotan era peor que la frecuencia fija; ahora se calibran. En
  los partidos con cuotas reales la casa al cierre sigue siendo mejor (0.666
  contra 0.682): la ventaja frente a la casa es chica. Con las ligas de
  Sofascore (61 000 partidos de prueba en vez de 7 000) los mismos ajustes
  siguen ganando a la frecuencia fija en todos los mercados (goles 0.6850
  contra 0.6875, ambos anotan 0.6863, córners 0.6839, tarjetas 0.6835).
- **NBA**: frente a una línea puesta con la media reciente el modelo casi no
  tiene ventaja, así que sus desvíos se ampliaron: ya no inventa ventajas.
- **MLB**: el modelo (ajustado con 2026) también gana a la frecuencia fija en
  los 40 000 partidos de 2010 a 2026 (ganador 0.6861 contra 0.6886, run line
  0.6700 contra 0.6721, total 0.6803 contra 0.6846) y está calibrado.

**Frente a las líneas reales de la casa** (las que usa la página: la más pareja
de cada mercado) el análisis se pasaba de seguro: una línea puesta con la media
reciente es fácil de ganar, la de la casa no. Se calibró con las cuotas reales de
2024-25 (fútbol) y 2023-2025 (básquet; MLB 2021-2024) y se comprobó con lo
posterior:

| Frente a la línea real (prueba posterior) | Antes | Calibrado | Casa al cierre |
|---|---|---|---|
| Fútbol: goles Más/Menos | 0.6941 | 0.6895 | 0.6812 |
| Fútbol: tarjetas | 0.7112 | 0.6890 | 0.6879 |
| Fútbol: córners | 0.6934 | 0.6906 | 0.6901 |
| Fútbol: ambos anotan | 0.6869 | sin cambio | 0.6805 |
| Básquet: total | 0.7078 | 0.6935 | 0.6931 |
| Básquet: hándicap | 0.7060 | 0.6925 | 0.6935 |
| Básquet: 1.er tiempo (total y hándicap) | 0.70 | 0.693 | 0.693 |
| MLB: total de carreras | 0.6979 | 0.6926 | 0.6912 |
| MLB: ganador | 0.6869 | sin cambio | 0.6781 |

- Antes, en tarjetas un 70–80 % acertaba 62 %, y en el básquet un 60 % acertaba
  50 %. Ahora las probabilidades son honestas, pero más cerca del 50 %: salen
  menos picks altos (en el básquet, casi ninguno en total y hándicap).
- Las líneas de la casa en el básquet y en el total de la MLB son muy eficientes:
  el modelo casi no tiene información que la casa no tenga. Donde hay algo es en
  el fútbol (goles, ambos anotan) y el ganador de la MLB, pero ahí la casa al
  cierre sigue siendo mejor.
- Las redes se entrenan ahora con esas cuotas reales (variables de cuotas de
  verdad, no fijas), así que pueden aprender cuándo la casa sabe más.

```
NODE_USE_ENV_PROXY=1 node scripts/historico/sofascore.mjs          # actualiza las ligas de fútbol de Sofascore (sesión con internet)
NODE_USE_ENV_PROXY=1 node scripts/historico/basquet.mjs            # Euroliga y Liga ACB
NODE_USE_ENV_PROXY=1 node scripts/historico/cuotas-sofascore.mjs   # cuotas reales de Sofascore (fútbol, básquet)
NODE_USE_ENV_PROXY=1 node scripts/historico/cuotas-flashscore.mjs  # cuotas reales de Flashscore (NBA, MLB, Euroliga, ACB)
node scripts/historico/prueba.mjs [futbol] [nba] [mlb]   # prueba retrospectiva por mercado (nba: también Euroliga y ACB)
node scripts/historico/ajuste-futbol.mjs                 # busca los ajustes del fútbol
node scripts/historico/ajuste-nba.mjs                    # y los de la NBA
node scripts/historico/entrenar.mjs                      # entrena las 36 redes (docs/data/modelo/redes.json)
```

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

Sin token, el historial se guarda solo en ese navegador (y sus resultados no
entrenan la red hasta subirlos a GitHub). Con el token se guarda en `docs/data/`
del repositorio y lo ves igual en el celular y en la PC:

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
  js/views/           pestañas Partidos, Datos, Errores de cuota, Análisis e Historial (barras.js: gráfico de barras)
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
  js/datos.js         cálculos de la pestaña Datos (últimos N, local/visita, línea, resumen)
  js/errores.js       cálculos de la pestaña Errores de cuota (línea de la casa frente a los datos)
  js/github.js        guardar en GitHub con el token del navegador
  js/history.js       guardar y liquidar resultados, filas de entrenamiento de la red
  data/               historial, filas de entrenamiento y redes especializadas
data/historico/       partidos históricos (fútbol, NBA, MLB) para la prueba y la red
extension/            extensión de Chrome (Sofascore, Betano) y conectores de las fuentes
scripts/              recolección de datos y prueba de las fuentes (GitHub Actions)
  historico/          descarga de partidos históricos, reproducción, ajustes y entrenamiento
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
