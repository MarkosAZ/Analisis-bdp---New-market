// Extensión simulada para la prueba de punta a punta: se inyecta en la página
// y responde a los mismos pedidos que extension/bridge.js, con datos
// inventados pero con la forma real de cada fuente.
(() => {
  const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  const LIMA_MIDNIGHT = Date.parse(`${DAY}T05:00:00Z`);
  const at = (h) => LIMA_MIDNIGHT + h * 3600000;

  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const poisson = (l) => {
    let k = 0;
    let p = Math.exp(-l);
    let s = p;
    const u = rand();
    while (u > s && k < 20) {
      k++;
      p *= l / k;
      s += p;
    }
    return k;
  };

  // [id, sofascore, apuesta total, ataque, defensa]
  const T = (id, name, atName, att, def, extra = {}) => ({ id, name, atName, att, def, ...extra });
  const football = [
    { t: { id: 17, name: 'Premier League', priority: 900 }, c: { name: 'England', alpha2: 'EN' }, games: [
      [T(1, 'Arsenal', 'Arsenal', 2.0, 0.8), T(2, 'Chelsea', 'Chelsea FC', 1.3, 1.2), 13],
      [T(3, 'Manchester United', 'Manchester Utd', 1.2, 1.3), T(4, 'Liverpool', 'Liverpool FC', 2.1, 0.9), 15],
      [T(5, 'Everton', 'Everton', 0.8, 1.4), T(6, 'Tottenham Hotspur', 'Tottenham Hotspur', 1.5, 1.3), 15],
      [T(7, 'Brighton & Hove Albion', 'Brighton', 1.6, 1.1), T(8, 'Leeds United', 'Leeds United', 0.9, 1.6), 17],
    ] },
    { t: { id: 406, name: 'Liga 1', priority: 500 }, c: { name: 'Peru', alpha2: 'PE' }, games: [
      [T(11, 'Universitario', 'Club Universitario de Deportes', 1.9, 0.7), T(12, 'Alianza Lima', 'Club Alianza Lima', 1.5, 0.9), 19],
      [T(13, 'Sporting Cristal', 'Sporting Cristal', 1.8, 0.9), T(14, 'Cienciano', 'Cienciano del Cusco', 1.0, 1.5), 15],
      [T(15, 'Melgar', 'FBC Melgar', 1.4, 1.0), T(16, 'ADT', 'AD Tarma', 0.9, 1.3), 20],
    ] },
  ];
  const basketball = [
    { t: { id: 132, name: 'NBA', priority: 800 }, c: { name: 'USA', alpha2: 'US' }, games: [
      [T(21, 'Los Angeles Lakers', 'LA Lakers', 114, 109), T(22, 'Boston Celtics', 'Boston Celtics', 117, 106), 20],
      [T(23, 'Golden State Warriors', 'Golden State Warriors', 115, 110), T(24, 'Miami Heat', 'Miami Heat', 108, 107), 21],
    ] },
  ];
  const baseball = [
    { t: { id: 11205, name: 'MLB', priority: 700 }, c: { name: 'USA', alpha2: 'US' }, games: [
      [T(31, 'New York Yankees', 'New York Yankees', 5.4, 3.7), T(32, 'Boston Red Sox', 'Boston Red Sox', 4.0, 4.9), 18],
      [T(33, 'Los Angeles Dodgers', 'LA Dodgers', 5.6, 3.5), T(34, 'Colorado Rockies', 'Colorado Rockies', 3.7, 5.8), 21],
    ] },
  ];
  const SPORTS = { football, basketball, baseball };
  const teamById = new Map();
  const events = [];
  let nextId = 1000;
  for (const [sport, leagues] of Object.entries(SPORTS)) {
    for (const lg of leagues) {
      for (const [home, away, hour] of lg.games) {
        teamById.set(home.id, { ...home, sport });
        teamById.set(away.id, { ...away, sport });
        events.push({ id: nextId++, sport, lg, home, away, start: at(hour) });
      }
    }
  }
  // Partidos ya jugados o en juego (solo para mostrar).
  const serieA = { t: { id: 23, name: 'Serie A', priority: 850 }, c: { name: 'Italy', alpha2: 'IT' } };
  const shown = [
    { id: 2001, sport: 'football', lg: serieA, home: T(41, 'Inter', 'Inter', 1.8, 0.9), away: T(42, 'Milan', 'AC Milan', 1.6, 1.0), start: at(9), state: 'finalizado', score: [2, 1] },
    { id: 2002, sport: 'football', lg: serieA, home: T(43, 'Juventus', 'Juventus', 1.5, 0.8), away: T(44, 'Roma', 'AS Roma', 1.4, 1.0), start: at(11), state: 'en_vivo', score: [1, 0] },
  ];

  const team = (t) => ({ id: t.id, name: t.name, short: t.name, alpha2: null, ranking: t.ranking ?? null, national: false });
  const toEvent = (e) => ({
    id: e.id,
    sport: e.sport,
    start: e.start,
    tournament: { id: e.lg.t.id, name: e.lg.t.name, priority: e.lg.t.priority },
    category: { id: 1, name: e.lg.c.name, alpha2: e.lg.c.alpha2 },
    home: team(e.home),
    away: team(e.away),
    state: e.state || 'pendiente',
    statusText: '',
    score: e.score ? { home: e.score[0], away: e.score[1], homeNT: e.score[0], awayNT: e.score[1] } : null,
    winner: null,
    url: `https://www.sofascore.com/x-y/abc#id:${e.id}`,
  });

  // Goles/puntos/carreras esperados del local y del visitante.
  function expected(e) {
    if (e.sport === 'basketball') return [(e.home.att + e.away.def) / 2 + 2, (e.away.att + e.home.def) / 2 - 2];
    return [((e.home.att + e.away.def) / 2) * 1.1, ((e.away.att + e.home.def) / 2) / 1.1];
  }

  function lastMatches(t, start) {
    const out = [];
    for (let i = 0; i < 12; i++) {
      let gf;
      let ga;
      if (t.sport === 'basketball') {
        gf = Math.round(t.att + (rand() - 0.5) * 20);
        ga = Math.round(t.def + (rand() - 0.5) * 20);
      } else {
        gf = poisson(t.att);
        ga = poisson(t.def);
      }
      out.push({ start: start - (i + 1) * 5 * 86400000, home: i % 2 === 0, gf, ga, r: gf > ga ? 'W' : gf < ga ? 'L' : 'D', opp: 'Rival', league: '' });
    }
    return out;
  }

  // Probabilidades justas para generar cuotas coherentes.
  function fairFootball(e) {
    const [lh, la] = expected(e);
    const pmf = (l) => Array.from({ length: 11 }, (_, k) => (Math.exp(-l) * l ** k) / [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800][k]);
    const ph = pmf(lh);
    const pa = pmf(la);
    let h = 0;
    let d = 0;
    let a = 0;
    const tot = [];
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const p = ph[i] * pa[j];
        if (i > j) h += p;
        else if (i === j) d += p;
        else a += p;
        tot[i + j] = (tot[i + j] || 0) + p;
      }
    const over = (L) => tot.reduce((s, p, k) => (k > L ? s + p : s), 0);
    const btts = (1 - ph[0]) * (1 - pa[0]);
    return { h, d, a, over, btts };
  }
  const odd = (p, margin = 1.06) => Math.max(1.01, Math.round((1 / (p * margin)) * 100) / 100);

  function sofascoreOdds(e) {
    if (e.sport === 'football') {
      const f = fairFootball(e);
      return [
        { name: 'Full time', group: null, live: false, choices: [{ name: '1', price: odd(f.h) }, { name: 'X', price: odd(f.d) }, { name: '2', price: odd(f.a) }] },
        { name: 'Match goals', group: '2.5', live: false, choices: [{ name: 'Over', price: odd(f.over(2.5)) }, { name: 'Under', price: odd(1 - f.over(2.5)) }] },
      ];
    }
    const pHome = 0.5 + (expected(e)[0] - expected(e)[1]) / (e.sport === 'basketball' ? 30 : 10);
    return [{ name: 'Home/Away', group: null, live: false, choices: [{ name: '1', price: odd(pHome) }, { name: '2', price: odd(1 - pHome) }] }];
  }

  // Jugadores de la NBA: [nombre, equipo (id), puntos, rebotes, asistencias, triples] promedio.
  const PLAYERS = [
    ['LeBron James', 21, 30, 7.5, 8, 2.2],
    ['Anthony Davis', 21, 24, 11.5, 3.5, 0.5],
    ['Jayson Tatum', 22, 27, 8.4, 4.6, 3.1],
    ['Jaylen Brown', 22, 22, 5.5, 3.5, 2.2],
    ['Stephen Curry', 23, 26, 4.5, 6, 4.8],
    ['Jimmy Butler', 24, 20, 5.5, 5, 0.8],
  ];
  const vary = (m, sd) => Math.max(0, Math.round(m + sd * (rand() + rand() + rand() - 1.5) * 1.15));
  // Los intentos salen de otra secuencia para no cambiar el resto de los datos simulados.
  let seed2 = 11;
  const rand2 = () => ((seed2 = (seed2 * 16807) % 2147483647) / 2147483647);
  const missed = (m, sd) => Math.max(0, Math.round(m + sd * (rand2() + rand2() + rand2() - 1.5) * 1.15));
  // Un partido de un jugador en el formato del contrato (ESPN/Sofascore normalizado);
  // fga/tpa/fta: intentados (anotados + fallados).
  const gameRow = ([, , pts, reb, ast, tpm], start) => {
    const t = vary(tpm, 1.4);
    const p = Math.max(vary(pts, 6), 3 * t);
    const r = {
      start, min: vary(34, 4), pts: p, reb: vary(reb, 2.5), ast: vary(ast, 2), tpm: t, stl: vary(1.2, 1), blk: vary(0.8, 0.8), tov: vary(2.5, 1.2),
      oreb: vary(reb * 0.25, 1), dreb: vary(reb * 0.75, 2), ftm: vary(4, 2), fgm: vary((p - t) / 2.2, 2),
    };
    const tpa = r.tpm + missed(tpm * 1.7, 1.5);
    return { ...r, fga: Math.max(r.fgm + missed(r.fgm * 1.05, 2.5), tpa), tpa, fta: r.ftm + missed(1.2, 1) };
  };
  // Línea de tiros de campo intentados de cada jugador (anotados promedio / 0.48).
  const fgaLine = ([, , pts, , , tpm]) => Math.floor((pts - tpm) / 2.2 / 0.48) + 0.5;
  const teamOf = (name) => events.find((e) => e.sport === 'basketball' && (e.home.name === name || e.away.name === name));
  const playerLogs = (teamName, start) => {
    const t = [...teamById.values()].find((x) => x.name === teamName);
    const players = PLAYERS.filter((p) => p[1] === t?.id).map((p) => ({
      name: p[0],
      short: `${p[0][0]}. ${p[0].split(' ').slice(1).join(' ')}`,
      out: false,
      games: Array.from({ length: 10 }, (_, i) => gameRow(p, start - (i + 1) * 2 * 86400000)),
    }));
    return { teamGames: 10, players };
  };
  const boxCache = new Map();
  const boxScore = (e) => {
    if (!boxCache.has(e.id)) boxCache.set(e.id, Object.fromEntries(PLAYERS.filter((p) => p[1] === e.home.id || p[1] === e.away.id).map((p) => [p[0], gameRow(p, e.start)])));
    return boxCache.get(e.id);
  };

  // Betano en la NBA: Más/Menos de jugador (el jugador va en el nombre del mercado).
  function betanoBasketball(e) {
    const ou = (name, line, over, under) => ({ name, selections: [{ name: `Más de ${line}`, price: over }, { name: `Menos de ${line}`, price: under }] });
    const list = [];
    for (const p of PLAYERS) {
      const [name, team] = p;
      if (team !== e.home.id && team !== e.away.id) continue;
      list.push(ou(`Total de Puntos ${name}`, 24.5, 1.87, 1.87), ou(`Total de rebotes ${name}`, 7.5, 1.9, 1.85), ou(`${name} Total de Puntos, Rebotes y Asistencias`, 39.5, 1.85, 1.95));
      // Intentos: tiros de campo intentados (red y probabilidad propias, no los anotados).
      list.push(ou(`Total de tiros de campo intentados ${name}`, fgaLine(p), 1.87, 1.87));
      list.push({ name: `Double-double ${name}`, selections: [{ name: 'Sí', price: 2.4 }, { name: 'No', price: 1.55 }] });
    }
    list.push(ou('Total de Tiros de tres puntos anotados Stephen Curry', 4.5, 1.8, 2.0));
    list.push(ou('Total de tiros de 3 puntos intentados Stephen Curry', 12.5, 1.85, 1.9), ou('Total de tiros libres intentados Stephen Curry', 4.5, 1.9, 1.85));
    return list.filter((m) => !m.name.includes('Stephen Curry') || e.home.id === 23 || e.away.id === 23);
  }

  // Mercados de Betano de la página del partido (nombres reales de Betano).
  function betanoMarkets(e) {
    if (e.sport === 'basketball') return betanoBasketball(e);
    const f = fairFootball(e);
    const h1 = { h: f.h * 0.75, d: 0.42, a: f.a * 0.75 };
    const n = h1.h + h1.d + h1.a;
    return [
      { name: 'Resultado Final', selections: [{ name: '1', price: odd(f.h, 1.05) }, { name: 'X', price: odd(f.d, 1.05) }, { name: '2', price: odd(f.a, 1.05) }] },
      { name: 'Total de Córners', selections: [{ name: 'Más de 9.5', price: 1.88 }, { name: 'Menos de 9.5', price: 1.88 }, { name: 'Más de 11.5', price: 2.6 }, { name: 'Menos de 11.5', price: 1.45 }] },
      { name: 'Córners en Primer Tiempo Más/Menos', selections: [{ name: 'Más de 4.5', price: 1.9 }, { name: 'Menos de 4.5', price: 1.85 }] },
      { name: 'Hándicap de Córners - Dobles', selections: [{ name: `${e.home.name} -1.5`, price: 1.9 }, { name: `${e.away.name} +1.5`, price: 1.86 }, { name: `${e.home.name} +0.5`, price: 1.45 }, { name: `${e.away.name} -0.5`, price: 2.6 }] },
      { name: 'Hándicap de Córners - Triples', selections: [{ name: `${e.home.name} -2`, price: 2.4 }, { name: 'Empate -2', price: 4.2 }, { name: `${e.away.name} +2`, price: 2.2 }] },
      { name: 'Tiros al Arco', selections: [{ name: 'Más de 8.5', price: 1.87 }, { name: 'Menos de 8.5', price: 1.87 }] },
      { name: 'Remates totales', selections: [{ name: 'Más de 22.5', price: 1.85 }, { name: 'Menos de 22.5', price: 1.9 }] },
      { name: 'Primer Tiempo - Resultado', selections: ['h', 'd', 'a'].map((k, i) => ({ name: ['1', 'X', '2'][i], price: odd(h1[k] / n, 1.06) })) },
      { name: 'Descanso/Final', selections: [{ name: '1/1', price: odd(f.h * 0.55, 1.2) }, { name: 'X/X', price: odd(f.d * 0.6, 1.2) }, { name: '2/2', price: odd(f.a * 0.55, 1.2) }] },
      { name: 'Total de tarjetas', selections: [{ name: 'Más de 4.5', price: 1.9 }, { name: 'Menos de 4.5', price: 1.86 }] },
      { name: 'Goleador en cualquier momento', selections: [{ name: 'Jugador Y', price: 3.1 }] },
    ];
  }

  function atMarkets(e) {
    const H = e.home.atName;
    const A = e.away.atName;
    if (e.sport === 'football') {
      const f = fairFootball(e);
      const ou = [1.5, 2.5, 3.5].flatMap((L) => [
        { name: `Más de ${L}`, price: odd(f.over(L), 1.05) },
        { name: `Menos de ${L}`, price: odd(1 - f.over(L), 1.05) },
      ]);
      return [
        { name: 'Resultado del partido (1X2)', type: 'ML0', selections: [{ name: 'Empate', price: odd(f.d, 1.05) }, { name: H, price: odd(f.h, 1.05) }, { name: A, price: odd(f.a, 1.05) }] },
        { name: 'Total de goles', type: 'OU200', selections: ou },
        { name: 'Ambos equipos anotan', type: 'QA158', selections: [{ name: 'Sí', price: odd(f.btts, 1.05) }, { name: 'No', price: odd(1 - f.btts, 1.05) }] },
        { name: 'Doble Oportunidad', type: 'QA61', selections: [{ name: `${H} o Empate`, price: odd(f.h + f.d, 1.03) }, { name: `Empate o ${A}`, price: odd(f.d + f.a, 1.03) }, { name: `${H} o ${A}`, price: odd(f.h + f.a, 1.03) }] },
      ];
    }
    if (e.sport === 'basketball') {
      const [h, a] = expected(e);
      const total = Math.floor(h + a) + 0.5;
      // 1.er tiempo como en la NBA: la línea principal entera y las extra con .5.
      const h1 = Math.round((h + a) / 2);
      const d1 = Math.max(1, Math.round((h - a) / 2));
      const sel = (name, price) => ({ name, price });
      // Jugadores de Apuesta Total: el nombre va en cada selección ("LeBron James Más de 2.5").
      const ou = (name, line, over = 1.9, under = 1.88) => [sel(`${name} Más de ${line}`, over), sel(`${name} Menos de ${line}`, under)];
      const players = PLAYERS.filter((p) => p[1] === e.home.id || p[1] === e.away.id);
      return [
        { name: 'Ganador (incl. prórroga)', type: 'ML0', selections: [{ name: H, price: odd(0.5 + (h - a) / 30, 1.05) }, { name: A, price: odd(0.5 - (h - a) / 30, 1.05) }] },
        { name: 'Total de puntos', type: 'OU0', selections: [{ name: `Más de ${total}`, price: 1.9 }, { name: `Menos de ${total}`, price: 1.9 }, { name: `Más de ${total + 6}`, price: 2.45 }, { name: `Menos de ${total + 6}`, price: 1.52 }] },
        { name: 'Hándicap', type: 'HC0', selections: [{ name: `${H} (${-Math.round(h - a) - 0.5})`, price: 1.9 }, { name: `${A} (+${Math.round(h - a) + 0.5})`, price: 1.9 }] },
        { name: '1ra Mitad Puntos Asiáticos', type: 'OU623', selections: [sel(`Más de ${h1}`, 1.85), sel(`Menos de ${h1}`, 1.85)] },
        { name: '1ra Mitad Total de Puntos (extra)', type: 'OU2125', selections: [sel(`Más de ${h1 - 0.5}`, 1.8), sel(`Menos de ${h1 - 0.5}`, 1.92), sel(`Más de ${h1 + 3.5}`, 2.3), sel(`Menos de ${h1 + 3.5}`, 1.58)] },
        { name: 'Hándicap - 1° Mitad', type: 'HC623', selections: [sel(`${H} -${d1}`, 1.85), sel(`${A} +${d1}`, 1.85)] },
        { name: '1ra Mitad - Hándicap (extra)', type: 'HC2125', selections: [sel(`${H} -${d1 - 0.5}`, 1.8), sel(`${A} +${d1 - 0.5}`, 1.95)] },
        { name: 'Asistencias del jugador (incl. Prórroga)', type: 'QA4402', selections: players.flatMap((p) => ou(p[0], Math.floor(p[4]) + 0.5)) },
        { name: 'Tiros de 3 puntos anotados por jugador (incl. Prórroga)', type: 'QA4872', selections: players.flatMap((p) => ou(p[0], Math.floor(p[5]) + 0.5, 1.95, 1.83)) },
      ];
    }
    if (e.sport === 'baseball') {
      const [h, a] = expected(e);
      const total = Math.round(h + a) + 0.5;
      const pHome = 0.5 + (h - a) / 10;
      return [
        { name: 'Ganador (incl. entradas extra)', type: 'ML0', selections: [{ name: H, price: odd(pHome, 1.05) }, { name: A, price: odd(1 - pHome, 1.05) }] },
        { name: 'Línea de carreras', type: 'HC0', selections: [{ name: `${H} -1.5`, price: 2.1 }, { name: `${A} +1.5`, price: 1.75 }] },
        { name: 'Total de carreras', type: 'OU0', selections: [{ name: `Más de ${total}`, price: 1.9 }, { name: `Menos de ${total}`, price: 1.9 }, { name: `Más de ${total - 1}`, price: 1.6 }, { name: `Menos de ${total - 1}`, price: 2.3 }] },
      ];
    }
    return [];
  }

  function result(e) {
    if (e.sport === 'basketball') {
      const [h, a] = expected(e);
      const sh = Math.round(h + (rand() - 0.5) * 24);
      let sa = Math.round(a + (rand() - 0.5) * 24);
      if (sa === sh) sa++;
      return { home: sh, away: sa };
    }
    const [lh, la] = expected(e);
    const h = poisson(lh);
    let a = poisson(la);
    if (e.sport === 'baseball' && a === h) a++; // en béisbol no hay empate
    return { home: h, away: a, homeNT: h, awayNT: a };
  }
  const finalScore = (e) => {
    if (!fixedResults.has(e.id)) fixedResults.set(e.id, result(e));
    return fixedResults.get(e.id);
  };
  // Estadísticas del partido terminado (feed df_st de Flashscore): partido y 1.er tiempo.
  const statsCache = new Map();
  const finishedStats = (e) => statsCache.get(e.id) || statsCache.set(e.id, makeStats()).get(e.id);
  function makeStats() {
    const sec = (name, c, y, sh, so) =>
      `SE÷${name}¬~SG÷Remates totales¬SH÷${sh[0]}¬SI÷${sh[1]}¬~SG÷Remates a puerta¬SH÷${so[0]}¬SI÷${so[1]}¬~SG÷Córneres¬SH÷${c[0]}¬SI÷${c[1]}¬~SG÷Tarjetas amarillas¬SH÷${y[0]}¬SI÷${y[1]}¬~SG÷Tarjetas rojas¬SH÷0¬SI÷0¬~`;
    const r = (lo, n) => lo + Math.floor(rand() * n);
    const h1c = [r(1, 5), r(1, 4)];
    const c = [h1c[0] + r(1, 5), h1c[1] + r(1, 4)];
    const h1y = [r(0, 2), r(0, 2)];
    const y = [h1y[0] + r(0, 3), h1y[1] + r(0, 3)];
    const so = [r(2, 7), r(1, 6)];
    const sh = [so[0] + r(5, 8), so[1] + r(5, 8)];
    const half = (x) => x.map((v) => Math.floor(v / 2));
    return sec('Partido', c, y, sh, so) + sec('1.er tiempo', h1c, h1y, half(sh), half(so));
  }

  const all = [...events, ...shown];
  const byId = new Map(all.map((e) => [e.id, e]));
  const fixedResults = new Map();
  const files = new Map(); // simulación de GitHub (no se usa: modo navegador)
  window.__BDP_MOCK_LOG__ = [];

  const handlers = {
    'github.status': () => ({ configured: false, repo: 'MarkosAZ/Analisis-bdp---New-market', branch: 'x' }),
    'github.getFile': ({ path }) => (files.has(path) ? { text: files.get(path), sha: 'x' } : null),
    'sofascore.getSportEvents': ({ sport, date }) => ({
      mode: 'direct',
      items: date === DAY ? all.filter((e) => e.sport === sport).map(toEvent) : [],
    }),
    'sofascore.getEventDetails': ({ events: list }) => {
      const items = {};
      for (const { id } of list) {
        const e = byId.get(id);
        items[id] = {
          form: null,
          h2h: { homeWins: 2, draws: 1, awayWins: 1 },
          missing: { home: [], away: [{ player: 'Jugador X', position: 'F', type: 'missing', reason: 'Lesión' }], confirmed: false },
          odds: sofascoreOdds(e),
          votes: { home: 0.55, draw: 0.2, away: 0.25, total: 1000 },
          lastHome: lastMatches({ ...e.home, sport: e.sport }, e.start),
          lastAway: lastMatches({ ...e.away, sport: e.sport }, e.start),
        };
      }
      return { mode: 'direct', items, failed: 0, requests: list.length * 7 };
    },
    'sofascore.getEventResults': ({ ids, detail = [] }) => {
      const items = {};
      // Marcador por cuartos (para el 1.er tiempo del básquet), como el evento de Sofascore.
      const quarters = (pts) => {
        const q = [Math.round(pts * 0.26), Math.round(pts * 0.25), Math.round(pts * 0.25)];
        return [...q, pts - q[0] - q[1] - q[2]];
      };
      const sideScore = (pts) => ({ current: pts, ...Object.fromEntries(quarters(pts).map((v, i) => [`period${i + 1}`, v])) });
      for (const id of ids) {
        const e = byId.get(id);
        if (!e) continue;
        const score = finalScore(e);
        items[id] = { state: 'finalizado', score, winner: null };
        if (e.sport === 'basketball' && detail.includes(id)) items[id].raw = { event: { status: { type: 'finished' }, homeScore: sideScore(score.home), awayScore: sideScore(score.away) } };
      }
      return { mode: 'direct', items };
    },
    'apuestatotal.getEventList': ({ sport }) => ({
      mode: 'direct',
      items: events.filter((e) => e.sport === sport).map((e) => ({ eventId: `at${e.id}`, start: e.start, league: e.lg.t.name, country: '', home: e.home.atName, away: e.away.atName, live: false })),
    }),
    'apuestatotal.getMarkets': ({ eventIds }) => ({
      items: Object.fromEntries(eventIds.map((id) => [id, atMarkets(byId.get(Number(id.slice(2))))])),
      errors: [],
    }),
    // Betano: solo fútbol (en los otros deportes falla, para probar que no rompe
    // el análisis). La lista trae el resultado; la página de cada partido, todo.
    'betano.getOdds': ({ sport }) => {
      if (sport !== 'football' && sport !== 'basketball') throw new Error('No se encontraron cuotas en Betano');
      return {
        mode: 'tab',
        items: events
          .filter((e) => e.sport === sport)
          .map((e) => ({ eventId: `b${e.id}`, start: e.start, home: e.home.name, away: e.away.name, url: `https://www.betano.pe/cuotas-de-partido/x/${e.id}/`, markets: betanoMarkets(e).slice(0, 1) })),
      };
    },
    'betano.getEventMarkets': ({ urls }) => ({
      mode: 'tab',
      items: Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, betanoMarkets(byId.get(Number(url.match(/(\d+)\/$/)[1])))])),
      notes: [],
    }),
    // ESPN (NBA y WNBA): últimos partidos de cada jugador y estadísticas al terminar.
    'espn.getPlayerLogs': ({ home, away, start }) => ({ mode: 'direct', home: playerLogs(home, start), away: playerLogs(away, start) }),
    'espn.getBoxScore': ({ home }) => {
      const e = teamOf(home);
      if (!e) return null;
      const done = Date.now() > e.start + 3 * 3600000;
      return { state: done ? 'finalizado' : 'pendiente', players: done ? boxScore(e) : {} };
    },
    // Flashscore (con la extensión): los mismos partidos, para sumar estadísticas de equipo.
    'flashscore.getSportDay': ({ sport }) => ({
      mode: 'direct',
      items: events
        .filter((e) => e.sport === sport)
        .map((e) => {
          const done = Date.now() > e.start + 3 * 3600000;
          return { id: `fs:m${e.id}`, sport, start: e.start, state: done ? 'finalizado' : 'pendiente', home: { id: `t${e.home.id}`, name: e.home.name }, away: { id: `t${e.away.id}`, name: e.away.name }, score: done ? finalScore(e) : null };
        }),
    }),
    'flashscore.getMatchFeeds': ({ fsId }) => ({ st: finishedStats(byId.get(Number(String(fsId).replace('fs:m', '')))) }),
    'flashscore.getTeamFeeds': () => {
      const st = (c1, c2) => `SE÷Partido¬~SG÷Remates totales¬SH÷14¬SI÷11¬~SG÷Remates a puerta¬SH÷5¬SI÷4¬~SG÷Córneres¬SH÷${c1}¬SI÷${c2}¬~SG÷Tarjetas amarillas¬SH÷2¬SI÷3¬~SG÷Tarjetas rojas¬SH÷0¬SI÷0¬~`;
      const last = (k) => Array.from({ length: 6 }, (_, i) => ({ fsId: `x${k}${i}`, home: i % 2 === 0, start: Date.now() - (i + 1) * 7 * 864e5, gf: 1, ga: 1, r: 'D' }));
      const ids = [...last('h'), ...last('a')].map((m) => m.fsId);
      return { lastHome: last('h'), lastAway: last('a'), h2h: null, st: Object.fromEntries(ids.map((id, i) => [id, st(7 + (i % 4), 5 + (i % 3))])) };
    },
    // MLB (API oficial): abridores con sus últimas aperturas, bullpen, estadio y clima.
    'mlb.getGameContext': ({ home, away, start }) => {
      const e = events.find((x) => x.sport === 'baseball' && x.home.name === home && x.away.name === away);
      if (!e) return null;
      const starts = (ip, r, k, bb, hr) => Array.from({ length: 8 }, (_, i) => ({ start: start - (i + 1) * 5 * 864e5, ip, r, er: r, h: 5, bb, k, hr, hbp: 0, opp: 'Rival' }));
      return {
        source: 'mlb',
        gamePk: `g${e.id}`,
        venue: `${home} Park`,
        weather: { condition: 'Clear', temp: 78, wind: '8 mph, Out To CF' },
        series: null,
        park: { factor: 1.04, n: 320 },
        home: { team: home, pitcher: { id: `p${e.id}h`, name: 'Gerrit Cole', hand: 'R', starts: starts(6.33, 1, 8, 1, 0) }, bullpen: { ip: 6, np: 95, games: 2 } },
        away: { team: away, pitcher: { id: `p${e.id}a`, name: 'Kyle Freeland', hand: 'L', starts: starts(4.67, 4, 3, 3, 1) }, bullpen: { ip: 13, np: 210, games: 3 } },
      };
    },
    // Noticias (solo para la red neuronal).
    'flashscore.getNews': () => ({ mode: 'direct', items: [{ source: 'flashscore', title: 'Arsenal pierde a su capitán por lesión', summary: '', published: new Date(Date.now() - 3600000).toISOString() }] }),
    'espn.getAllNews': () => ({ mode: 'direct', items: [{ source: 'espn', title: 'Liverpool llega en racha y con su plantel completo', summary: '', published: new Date(Date.now() - 7200000).toISOString() }], errors: [] }),
    'fotmob.getNews': () => ({ mode: 'direct', items: [{ source: 'fotmob', title: 'Universitario recupera a su goleador', summary: '', published: new Date(Date.now() - 5400000).toISOString() }] }),
    'understat.getTeamStrength': ({ league }) => ({
      mode: 'direct',
      items:
        league === 'EPL'
          ? football[0].games.flatMap(([h, a]) => [h, a]).map((t) => ({ team: t.name, xgFor: t.att * 0.95, xgAgainst: t.def * 1.05, matches: 6 }))
          : [],
    }),
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.bdp !== 'request') return;
    if (msg.action === 'ping') return window.postMessage({ bdp: 'ready', version: '9.9.9-prueba' }, '*');
    const { source, fn, args } = msg.params || {};
    window.__BDP_MOCK_LOG__.push(`${source}.${fn}`);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const handler = handlers[`${source}.${fn}`];
      if (!handler) throw new Error(`Función no disponible: ${source}.${fn}`);
      window.postMessage({ bdp: 'response', id: msg.id, ok: true, data: handler(args || {}) }, '*');
    } catch (e) {
      window.postMessage({ bdp: 'response', id: msg.id, ok: false, error: e.message }, '*');
    }
  });
  window.postMessage({ bdp: 'ready', version: '9.9.9-prueba' }, '*');
})();
