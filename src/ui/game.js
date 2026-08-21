// src/ui/game.js
// Interfaz de "Empezar temporada" — front sencillo sobre el motor existente
// (src/core/*, src/entities/*), sin tocar ninguno de esos ficheros. Ver
// DESIGN.md secciones 3, 6 y 7. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Alcance de esta primera versión (confirmado con Dennis):
//  - Selección de equipo SOLO entre los datos reales del bundle (ACB 1ª +
//    Primera FEB 2ª división, data/real/real-data-bundle.js).
//  - 1ª división: Liga + Playoff por el título + Copa (Fase 2 completa).
//  - 2ª división: Liga real (18 equipos FEB) + Playoff de ascenso
//    (Promotion.js, agnóstico de si los equipos son reales o ficticios —
//    ver comentario en Promotion.js, solo exige una League con la
//    temporada regular completa).
//  - Se avanza jornada a jornada con un botón ("jugar siguiente jornada").
//  - El partido de LIGA del equipo del usuario se juega de verdad sobre el
//    motor pausable de DESIGN.md 7.12.24/7.12.33 (TAC-5):
//    MatchEngine.createMatchState/advanceMatch se detienen de verdad en
//    fin de cuarto y en cada tiempo muerto disparado, con ventanas de
//    intervención reales (GamePlan/tiempos muertos) — ver
//    startLiveMatch()/advanceLiveMatch()/renderLiveMatchScreen() más abajo.
//    Los partidos de Copa/Playoff/Ascenso (Bracket.js/Playoffs.js/Cup.js/
//    Promotion.js, sin tocar en esta entrega) siguen resolviéndose de
//    golpe con MatchEngine.simulateMatch() y esta pantalla solo revela
//    quarterScores progresivamente (modo 'replay', decisión de encaje
//    señalada explícitamente — ver playNextMatchWithLineup()).

(function (global) {
  const BM = global.BasketManager;

  // ---------------------------------------------------------------------
  // Estado de la partida en memoria — no hay persistencia todavía
  // (CLAUDE.md: localStorage llegará más adelante, no es parte de esto).
  // ---------------------------------------------------------------------
  const state = {
    screen: 'team-select', // 'team-select' | 'home' | 'lineup' | 'calendar' | 'competitions' | 'stats' | 'match'
    division: '1ª',
    userTeamId: null,
    // Año real de inicio de temporada (DESIGN.md 3.3, Entidad Calendario) —
    // no existía ningún concepto de fecha real en el estado de partida
    // antes de esto. Decisión NO fijada en DESIGN.md, señalada aquí: se usa
    // el año en curso en el momento de empezar la partida (new Date() al
    // llamar a startSeason()), no un año fijo — así cada partida nueva
    // arranca en la temporada "actual" real en vez de quedar anclada a una
    // fecha de cuando se escribió este código.
    seasonStartYear: null,
    calendar: null, // instancia de Calendar (ver Calendar.js), construida en startSeason()
    // DESIGN.md 3.4.1: las DOS divisiones reales están vivas siempre en
    // paralelo desde que arranca la partida, no solo la del usuario — antes
    // de este cierre de ciclo solo existía `state.league` (una sola). La
    // que el usuario "tiene abierta" es `state.leagues[state.division]`
    // (ver getUserLeague()); la otra se simula de fondo (ver
    // simulateBackgroundRound()) sin reveal, cada vez que el usuario juega
    // su propia jornada — nunca queda rezagada ni hay que abrirla aparte.
    leagues: { '1ª': null, '2ª': null },
    // Brackets indexados por división en vez de un solo juego de
    // cup/titlePlayoff/promotionPlayoff (antes solo existían para "la"
    // liga) — Copa y Playoff por el título solo aplican a 1ª, Playoff de
    // ascenso solo a 2ª (ver getBrackets()).
    brackets: {
      '1ª': { cup: null, titlePlayoff: null },
      '2ª': { promotionPlayoff: null },
    },
    // Resumen del último cierre de temporada (DESIGN.md 3.4.2), para
    // mostrarlo una vez en Inicio ("el usuario debe ver que ha pasado
    // algo") — se limpia al jugar la siguiente jornada visible.
    seasonCloseSummary: null,
    lastRoundMatches: null, // partidos de la última jornada simulada (para pantalla de inicio)
    pendingUserMatch: null, // { match } — partido del usuario de la jornada recién simulada, pendiente de revelar en pantalla de partido
    matchReveal: null, // estado de revelado progresivo por cuartos de la pantalla de partido
    statsCompetition: 'league', // 'league' | 'cup' | 'playoffs' — selector de la pantalla de estadísticas
    statsSortKey: 'points', // columna activa de ordenación en la tabla de medias (retoques de estadísticas)
    // Alineación (DESIGN.md 7.11.6) — construida por el usuario en la pantalla
    // "Alineación", opcional: si se deja vacía/incompleta, el partido se juega
    // igual que hasta ahora (placeholder sin lineup real, ver MatchEngine.js).
    // Decisión de producto NO fijada en DESIGN.md, señalada aquí: la
    // alineación persiste entre jornadas (no se resetea tras cada partido)
    // para no obligar a reconstruirla partido a partido — el usuario puede
    // volver a esta pantalla y ajustarla cuando quiera.
    lineup: {
      squadIds: [], // ids de convocados (8-12)
      entries: buildEmptyLineupEntries(), // pos -> { starter, sub1, sub2 } (ver Rotation.js)
      fixedSegments: [], // opcional, C.2
      segmentDraft: null, // formulario en curso de un quinteto fijo nuevo
      garbageTime: { enabled: false }, // DESIGN.md 7.11.2-bis, opción por partido
    },
  };

  function byId(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------------
  // Accesores de las dos ligas/brackets en paralelo (DESIGN.md 3.4.1) —
  // punto único de lectura para no repetir `state.leagues[...]` con la
  // clave equivocada en ningún sitio.
  // ---------------------------------------------------------------------
  function getLeague(division) { return state.leagues[division]; }
  function getUserLeague() { return state.leagues[state.division]; }
  function getBackgroundDivision() { return state.division === '1ª' ? '2ª' : '1ª'; }
  function getBackgroundLeague() { return state.leagues[getBackgroundDivision()]; }
  function getBrackets(division) { return state.brackets[division]; }

  // Shape por defecto de `lineup.entries` (Rotation.js): 5 posiciones, cada
  // una con 3 slots (titular + 2 suplentes) vacíos.
  function buildEmptyLineupEntries() {
    const entries = {};
    BM.POSITIONS.forEach((pos) => {
      entries[pos] = {
        starter: { playerId: null, minutesQuota: 0 },
        sub1: { playerId: null, minutesQuota: 0 },
        sub2: { playerId: null, minutesQuota: 0 },
      };
    });
    return entries;
  }

  const SLOT_KEYS = BM.SLOT_KEYS;
  const SLOT_LABELS = { starter: 'Titular', sub1: 'Suplente 1', sub2: 'Suplente 2' };

  // -----------------------------------------------------------------
  // Arranque: construye equipos reales (instancias de verdad de
  // Player/Team, con toda su validación) a partir del bundle —
  // reconstrucción idéntica a la que hace scripts/import-real-data.js
  // al leer de disco, ver DESIGN.md/CLAUDE.md "Datos reales".
  // -----------------------------------------------------------------
  function buildRealTeamFromData(teamData) {
    const { Player, Team } = BM;
    const roster = teamData.roster.map((playerData) => {
      const { dataSource, ...playerFields } = playerData;
      const player = new Player(playerFields);
      player.dataSource = dataSource || null;
      return player;
    });
    return new Team({ ...teamData, roster });
  }

  function getRealTeamsByDivision(division) {
    const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = BM;
    return REAL_DATA_INDEX
      .filter((entry) => entry.division === division)
      .map((entry) => buildRealTeamFromData(REAL_DATA_TEAMS[entry.id]));
  }

  // ---------------------------------------------------------------------
  // Pantalla: selección de equipo
  // ---------------------------------------------------------------------
  function renderTeamSelectScreen() {
    const container = byId('gm-team-select');
    const division = state.division;
    const teams = getRealTeamsByDivision(division)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));

    const cards = teams.map((team) => {
      const bestPlayers = [...team.roster]
        .sort((a, b) => (b.technical.outsideShot + b.technical.insideShot) - (a.technical.outsideShot + a.technical.insideShot))
        .slice(0, 3)
        .map((p) => p.fullName)
        .join(', ');
      return `
        <button class="team-card" data-team-id="${team.id}" data-division="${division}">
          <span class="team-card__name">${team.name}</span>
          <span class="team-card__city">${team.city}</span>
          <span class="team-card__roster">${team.roster.length} jugadores</span>
          <span class="team-card__stars">${bestPlayers}</span>
        </button>`;
    }).join('');

    container.innerHTML = `
      <div class="division-toggle" role="tablist">
        <button class="division-toggle__btn ${division === '1ª' ? 'is-active' : ''}" data-division="1ª">1ª División</button>
        <button class="division-toggle__btn ${division === '2ª' ? 'is-active' : ''}" data-division="2ª">2ª División</button>
      </div>
      <div class="team-grid">${cards}</div>
    `;

    container.querySelectorAll('.division-toggle__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.division = btn.dataset.division;
        renderTeamSelectScreen();
      });
    });

    container.querySelectorAll('.team-card').forEach((card) => {
      card.addEventListener('click', () => startSeason(card.dataset.teamId, card.dataset.division));
    });
  }

  // ---------------------------------------------------------------------
  // Arranque de temporada
  // ---------------------------------------------------------------------
  function startSeason(teamId, division) {
    const { League, Calendar, CONFIG_BASE, recalculateSportingGoalsForDivision } = BM;
    state.division = division;
    state.userTeamId = teamId;
    state.seasonStartYear = new Date().getFullYear();
    state.calendar = new Calendar(state.seasonStartYear, CONFIG_BASE);

    // DESIGN.md 3.4.1: las DOS divisiones reales se construyen SIEMPRE,
    // no solo la del usuario — comparten el mismo Calendar de temporada.
    ['1ª', '2ª'].forEach((div) => {
      const teams = getRealTeamsByDivision(div);
      // Decisión no pedida explícitamente por el prompt de esta sesión,
      // señalada aquí: se recalcula sportingGoal (Bloque 2, DESIGN.md
      // 3.4.3) también al ARRANCAR una partida nueva, no solo en el
      // cierre de ciclo entre temporadas — de lo contrario la primera
      // temporada de cualquier partida nueva arrancaría con el valor fijo
      // 'Permanencia' para los 36 equipos (el propio hueco que 3.4.3 dice
      // cerrar), dejando inerte CpuLineup.computeMatchImportance() hasta
      // el primer cierre de ciclo. Arrancar una partida es, conceptualmente,
      // también una "pretemporada" (antes de jugar ninguna jornada).
      recalculateSportingGoalsForDivision(teams, CONFIG_BASE);
      state.leagues[div] = new League(teams, (round) => state.calendar.leagueRoundDate(round));
    });

    state.brackets = {
      '1ª': { cup: null, titlePlayoff: null },
      '2ª': { promotionPlayoff: null },
    };
    state.seasonCloseSummary = null;
    state.lastRoundMatches = null;
    state.pendingUserMatch = null;
    state.matchReveal = null;
    state.lineup = {
      squadIds: [],
      entries: buildEmptyLineupEntries(),
      fixedSegments: [],
      segmentDraft: null,
      garbageTime: { enabled: false },
    };

    goToScreen('home');
  }

  function getUserTeam() {
    const league = getUserLeague();
    if (!league || !state.userTeamId) return null;
    return league.teams.find((t) => t.id === state.userTeamId) || null;
  }

  // ---------------------------------------------------------------------
  // Cierre de integración de Recovery.js (DESIGN.md 7.11.5): tras resolver
  // CUALQUIER partido de cualquiera de las 4 competiciones, aplica la
  // recuperación de Energía pendiente de cada jugador que jugó minutos, y
  // registra la fecha de este partido como su nuevo `lastMatchDate`.
  //
  // `result.rotation` (de dónde sale qué jugador jugó cuántos minutos)
  // solo existe cuando ESE lado del partido tuvo una alineación real
  // (`options.home/awayLineup` a MatchEngine.simulateMatch) — ver
  // MatchEngine.js. LIMITACIÓN REAL ya cerrada (DESIGN.md 7.11.7,
  // CpuLineup.js): antes, buildLineupMatchOptionsResolver() solo
  // construía esa alineación para el EQUIPO DEL USUARIO, así que esta
  // función nunca podía tocar al resto de la liga. Ahora
  // buildLineupMatchOptionsResolver() construye una alineación real (CPU
  // o de usuario) para AMBOS lados de CUALQUIER partido, así que esta
  // función se aplica igual a los 36 equipos. El único `if (!rotation)`
  // que queda abajo es defensivo, para los puntos del "modo prueba" que
  // sigan llamando a simulateMatch sin ninguna alineación (ver CLAUDE.md).
  function applyRecoveryForResolvedMatch(homeTeam, awayTeam, result, date) {
    if (!date || !result.rotation) return;
    const { applyRestRecovery, CONFIG_BASE } = BM;
    [{ team: homeTeam, rotation: result.rotation.home }, { team: awayTeam, rotation: result.rotation.away }]
      .forEach(({ team, rotation }) => {
        if (!rotation) return; // este lado no tenía alineación real — sin datos de minutos, no se toca
        team.roster.forEach((player) => {
          const playedSeconds = rotation.playedSeconds[player.id] || 0;
          if (playedSeconds <= 0) return; // convocado sin minutos o no convocado — no se actualiza (DESIGN.md 3.3.4)
          if (player.dynamicState.lastMatchDate) {
            const days = Math.round((date - player.dynamicState.lastMatchDate) / (1000 * 60 * 60 * 24));
            if (days > 0) applyRestRecovery([player], days, CONFIG_BASE);
          }
          player.recordMatchDate(date);
        });
      });
  }

  // ---------------------------------------------------------------------
  // Progresión de temporada: simular jornada, disparar Copa (jornada
  // 17→18, solo 1ª división) y construir playoffs al terminar la liga
  // regular (título en 1ª, ascenso en 2ª) — todo reutilizando Playoffs.js/
  // Cup.js/Promotion.js tal cual, sin tocarlos.
  // ---------------------------------------------------------------------

  // Construye Copa/Playoff/Ascenso para UNA división cuando corresponda
  // (jornada 17→18 para la Copa, fin de jornada 34 para playoff/ascenso)
  // — compartido entre la liga visible (más abajo) y la de fondo
  // (simulateBackgroundRound): DESIGN.md 3.4.1, "no dupliques esa lógica,
  // extrae la parte de construir brackets a una función compartida". Solo
  // CONSTRUYE — cómo se avanzan después (botón con reveal para la visible,
  // de golpe sin reveal para la de fondo) vive en cada camino por separado.
  // Idempotente (comprueba que no exista ya) para poder llamarse en cada
  // jornada sin recrear nada.
  function createBracketsIfDue(division, league) {
    const {
      createTitlePlayoff, createCup, PromotionPlayoff, CUP_TRIGGER_ROUND,
      TITLE_PLAYOFF_ROUND_PATTERNS, PROMOTION_ROUND_PATTERNS,
    } = BM;
    const brackets = getBrackets(division);

    // Copa: solo 1ª división, justo al completar la jornada 17 (DESIGN.md
    // 3.2.2) — createCup() exige el valor EXACTO de currentRound.
    if (division === '1ª' && league.currentRound === CUP_TRIGGER_ROUND + 1 && !brackets.cup) {
      const cupDates = state.calendar ? state.calendar.cupRoundDates() : undefined;
      brackets.cup = createCup(league, cupDates);
    }

    if (!league.isSeasonComplete) return;

    // DESIGN.md 3.3.3: startDate del playoff = fecha de la última jornada
    // de ESTA liga (1ª o 2ª) + el hueco configurado — "independiente" de
    // la otra división simplemente porque cada una calcula la suya a
    // partir de SU PROPIO calendario, nunca del ajeno.
    const playoffStartDate = state.calendar
      ? state.calendar.titlePlayoffStartDate(state.calendar.leagueRoundDate(league.totalRounds))
      : undefined;
    if (division === '1ª') {
      if (brackets.titlePlayoff) return;
      const dateResolver = state.calendar
        ? state.calendar.buildBracketDateResolver(playoffStartDate, TITLE_PLAYOFF_ROUND_PATTERNS)
        : undefined;
      brackets.titlePlayoff = createTitlePlayoff(league, dateResolver);
    } else {
      if (brackets.promotionPlayoff) return;
      const dateResolver = state.calendar
        ? state.calendar.buildBracketDateResolver(playoffStartDate, PROMOTION_ROUND_PATTERNS)
        : undefined;
      brackets.promotionPlayoff = new PromotionPlayoff(league, dateResolver);
    }
  }

  // `resolveMatchOptions` (opcional, DESIGN.md 7.11.6): callback que recibe
  // el `match` de liga y devuelve las `options` de MatchEngine para el
  // equipo del usuario si le toca jugar esta jornada — ver
  // buildLineupMatchOptionsResolver() más abajo. Sin argumento, la jornada
  // se juega exactamente igual que hasta ahora (sin alineación real).
  function simulateNextRound(resolveMatchOptions) {
    const league = getUserLeague();
    if (league.isSeasonComplete) return;

    // Se limpia aquí (no en closeSeasonAndPrepareNext) para que el aviso
    // de cierre de temporada se vea "hasta que el usuario siga jugando",
    // igual que "Última jornada" se sustituye jornada a jornada.
    state.seasonCloseSummary = null;

    const matches = league.simulateNextRound(undefined, resolveMatchOptions);
    finishRoundBookkeeping(matches, state.division, league);
  }

  // Cola de cierre común a AMBOS caminos de jugar una jornada de liga: el
  // de siempre (simulateNextRound(), toda la jornada de golpe — sigue
  // usándose cuando el equipo del usuario no juega esta jornada) y el
  // nuevo de TAC-5 (finishUserLeagueMatch(), tras terminar el partido del
  // usuario sobre el motor pausable) — evita duplicar recuperación de
  // Energía/creación de brackets/jornada de fondo en dos sitios.
  function finishRoundBookkeeping(matches, division, league) {
    state.lastRoundMatches = matches;

    // DESIGN.md 7.11.5 (cierre de integración): recuperación de Energía
    // para cada partido de la jornada recién jugada (no solo el del
    // usuario) — ver limitación real explicada arriba.
    matches.forEach((match) => {
      applyRecoveryForResolvedMatch(match.homeTeam, match.awayTeam, match.result, match.date);
    });

    createBracketsIfDue(division, league);

    // Partido del equipo del usuario en esta jornada, si lo tenía — para
    // partidos jugados sobre el motor pausable (TAC-5) esto ya está
    // resuelto (ver finishUserLeagueMatch), pero se recalcula igual para
    // no duplicar el criterio de búsqueda en dos sitios.
    const userMatch = matches.find(
      (m) => m.homeTeam.id === state.userTeamId || m.awayTeam.id === state.userTeamId,
    );
    state.pendingUserMatch = userMatch || null;

    // El avance partido a partido de Copa/Playoffs/Ascenso, una vez
    // creados, lo dispara el botón principal de Home (getActiveBracket()),
    // no esta función — aquí solo se crean en el instante justo.

    // DESIGN.md 3.4.1: cada jornada visible dispara también una jornada de
    // fondo en la división que el usuario no tiene abierta — nunca se le
    // pide que la simule aparte ni queda rezagada.
    simulateBackgroundRound(getBackgroundDivision());
  }

  // Resuelve la jornada de la división que el usuario NO tiene abierta —
  // sin reveal, sin pantalla de partido, con CpuLineup en AMBOS lados de
  // cada partido (DESIGN.md 3.4.1). Si esa liga ya terminó su temporada
  // regular, no hay jornada que jugar, pero sus brackets (si quedan
  // incompletos) se siguen resolviendo de golpe más abajo.
  function simulateBackgroundRound(division) {
    const league = getLeague(division);
    const resolver = buildCpuOnlyResolver(league);

    if (!league.isSeasonComplete) {
      const matches = league.simulateNextRound(undefined, resolver.resolveMatchOptions);
      matches.forEach((match) => {
        applyRecoveryForResolvedMatch(match.homeTeam, match.awayTeam, match.result, match.date);
      });
      createBracketsIfDue(division, league);
    }

    drainBackgroundBrackets(division, resolver);
  }

  // Copa/Playoff/Ascenso de la división de fondo se juegan DE GOLPE, sin
  // reveal (DESIGN.md 3.4.1) — a diferencia de la liga visible (un
  // partido por click de usuario, ver getActiveBracket()/
  // playBracketGameWithReveal()), aquí no hay nadie que vaya a volver a
  // avanzarlo más tarde, así que se agota en el mismo instante en que se
  // crea (o se retoma, si por lo que fuera quedó incompleto).
  function drainBackgroundBrackets(division, resolver) {
    const brackets = getBrackets(division);
    [brackets.cup, brackets.titlePlayoff, brackets.promotionPlayoff].forEach((bracket) => {
      if (!bracket) return;
      while (!bracket.isComplete) {
        const game = bracket.playNextGame(undefined, resolver.resolveBracketOptions);
        applyRecoveryForResolvedMatch(game.homeEntry.team, game.awayEntry.team, game.result, game.date);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Bracket activo (Copa / Playoff por el título / Playoff de ascenso) DE
  // LA DIVISIÓN VISIBLE: mientras haya uno sin terminar, manda sobre la
  // liga regular en el botón principal de Home — "el partido que toca
  // ahora". Prioridad fija: Copa > Playoff por el título (1ª) > Playoff
  // de ascenso (2ª); null si no hay ninguno activo (la liga regular
  // manda, comportamiento normal).
  // ---------------------------------------------------------------------
  function getActiveBracketRoundLabel(bracket, labels) {
    const status = bracket.getStatus();
    const roundIndex = Math.min(status.rounds.length - 1, labels.length - 1);
    return labels[roundIndex] || `Ronda ${status.rounds.length}`;
  }

  function getActiveBracket() {
    const brackets = getBrackets(state.division);
    if (brackets.cup && !brackets.cup.isComplete) {
      return {
        title: 'Copa',
        roundLabel: getActiveBracketRoundLabel(brackets.cup, ['Cuartos de final', 'Semifinales', 'Final']),
        bracket: brackets.cup,
      };
    }
    if (brackets.titlePlayoff && !brackets.titlePlayoff.isComplete) {
      return {
        title: 'Playoff por el título',
        roundLabel: getActiveBracketRoundLabel(brackets.titlePlayoff, ['Cuartos de final', 'Semifinales', 'Final']),
        bracket: brackets.titlePlayoff,
      };
    }
    if (brackets.promotionPlayoff && !brackets.promotionPlayoff.isComplete) {
      const promo = brackets.promotionPlayoff;
      let roundLabel = 'Cuartos de ascenso';
      if (promo.isQuarterFinalsComplete) {
        promo.ensureFinalFour();
        roundLabel = getActiveBracketRoundLabel(promo.finalFour, ['Semifinales (Final Four)', 'Final (Final Four)']);
      }
      return { title: 'Playoff de ascenso', roundLabel, bracket: promo };
    }
    return null;
  }

  // ¿Ha terminado esta división del todo (liga regular + TODOS sus
  // brackets)? DESIGN.md 3.4.2: condición para poder cerrar el ciclo de
  // temporada — necesita cumplirse en AMBAS divisiones a la vez.
  function isDivisionFullyDone(division) {
    const league = getLeague(division);
    if (!league || !league.isSeasonComplete) return false;
    const brackets = getBrackets(division);
    if (division === '1ª') {
      return !!(brackets.cup && brackets.cup.isComplete && brackets.titlePlayoff && brackets.titlePlayoff.isComplete);
    }
    return !!(brackets.promotionPlayoff && brackets.promotionPlayoff.isComplete);
  }

  function isSeasonFullyClosable() {
    return isDivisionFullyDone('1ª') && isDivisionFullyDone('2ª');
  }

  // ---------------------------------------------------------------------
  // Cierre de ciclo de temporada y pretemporada (DESIGN.md 3.4.2/3.4.4).
  // Disparado explícitamente por el usuario (botón "Cerrar temporada",
  // ver renderHomeScreen) cuando isSeasonFullyClosable() — nunca
  // automático ni oculto.
  // ---------------------------------------------------------------------
  function closeSeasonAndPrepareNext() {
    const { League, Calendar, CONFIG_BASE, recalculateSportingGoalsForDivision } = BM;

    const leagueA = getLeague('1ª');
    const leagueB = getLeague('2ª');
    const bracketsB = getBrackets('2ª');

    // 1. Ascensos/descensos reales (DESIGN.md 3.4.2) — SOLO team.division
    // cambia; ningún otro campo de jugador/equipo se toca (decisión
    // explícita, no un descuido: un ascendido puede conservar overall
    // bajo, y viceversa).
    const standingsA = leagueA.getStandingsTable();
    const relegatedTeams = [
      standingsA[standingsA.length - 1].team,
      standingsA[standingsA.length - 2].team,
    ];
    relegatedTeams.forEach((team) => { team.division = '2ª'; });

    // Reutiliza directPromotion/secondPromotedEntry ya calculados por
    // PromotionPlayoff (Promotion.js) en vez de recalcular el campeón de
    // liga regular de 2ª por nuestra cuenta — es literalmente el mismo
    // dato (standings[0] de la liga regular de 2ª, ya completa).
    const promotedTeams = [
      bracketsB.promotionPlayoff.directPromotion.team,
      bracketsB.promotionPlayoff.secondPromotedEntry.team,
    ];
    promotedTeams.forEach((team) => { team.division = '1ª'; });

    // Composición de las dos divisiones YA actualizada (18+18), para
    // todos los pasos siguientes — un recién ascendido/descendido calcula
    // su sportingGoal y juega la siguiente liga ya en su división nueva.
    const allTeams = [...leagueA.teams, ...leagueB.teams];
    const teamsByDivision = {
      '1ª': allTeams.filter((team) => team.division === '1ª'),
      '2ª': allTeams.filter((team) => team.division === '2ª'),
    };

    // 2. Recalcula sportingGoal de los 36 equipos (DESIGN.md 3.4.3/3.4.4
    // paso 1), con la composición de división YA actualizada.
    recalculateSportingGoalsForDivision(teamsByDivision['1ª'], CONFIG_BASE);
    recalculateSportingGoalsForDivision(teamsByDivision['2ª'], CONFIG_BASE);

    // 3. Cantera/Academia de la nueva temporada (3.4.4 paso 2) — conecta
    // Team.generateAcademyIntake() tal cual, sin ninguna regla nueva.
    allTeams.forEach((team) => team.generateAcademyIntake());

    // 4. Nuevo Calendar (3.4.4 paso 3).
    state.seasonStartYear += 1;
    state.calendar = new Calendar(state.seasonStartYear, CONFIG_BASE);

    // 5. Nuevas League para 1ª y 2ª (3.4.4 paso 4) — standings a cero,
    // currentRound = 1, reutilizando League.js tal cual.
    state.leagues = {
      '1ª': new League(teamsByDivision['1ª'], (round) => state.calendar.leagueRoundDate(round)),
      '2ª': new League(teamsByDivision['2ª'], (round) => state.calendar.leagueRoundDate(round)),
    };

    // 6. Reset de brackets de ambas divisiones (3.4.4 paso 5).
    state.brackets = {
      '1ª': { cup: null, titlePlayoff: null },
      '2ª': { promotionPlayoff: null },
    };

    // 7. state.userTeamId NO cambia (sigue siendo su mismo equipo); si
    // ascendió/descendió, state.division le sigue para que "su" liga
    // siga siendo la visible (3.4.2 punto 4).
    const userTeam = allTeams.find((team) => team.id === state.userTeamId);
    const summary = {
      promoted: promotedTeams.map((team) => team.fullName),
      relegated: relegatedTeams.map((team) => team.fullName),
      userTeamDivision: userTeam ? userTeam.division : null,
    };
    if (userTeam) state.division = userTeam.division;

    state.lastRoundMatches = null;
    state.pendingUserMatch = null;
    state.matchReveal = null;
    state.seasonCloseSummary = summary;

    goToScreen('home');
  }

  // Puente entre el shape de Bracket/PromotionPlayoff.playNextGame()
  // ({ gameNumber, homeEntry, awayEntry, result }) y el shape que espera
  // startReplayMatchReveal()/renderMatchScreen() ({ homeTeam, awayTeam,
  // result }), igual que ya se hace con state.pendingUserMatch para
  // partidos de liga — así todo partido de bracket se revela cuarto a
  // cuarto igual que antes de TAC-5, sin tocar Bracket.js/Cup.js/
  // Playoffs.js/Promotion.js (decisión de encaje explícita, ver
  // playNextMatchWithLineup()/DESIGN.md 7.12.24-bis).
  // `resolveOptions` (opcional, DESIGN.md 7.11.6): ver
  // buildLineupMatchOptionsResolver() más abajo — se reenvía tal cual a
  // Bracket.playNextGame(). Sin argumento, comportamiento idéntico a antes.
  function playBracketGameWithReveal(bracket, resolveOptions) {
    const game = bracket.playNextGame(undefined, resolveOptions);
    // DESIGN.md 7.11.5 (cierre de integración): igual que en simulateNextRound(),
    // recuperación de Energía para los dos equipos de este partido de bracket.
    applyRecoveryForResolvedMatch(game.homeEntry.team, game.awayEntry.team, game.result, game.date);
    state.pendingUserMatch = {
      homeTeam: game.homeEntry.team,
      awayTeam: game.awayEntry.team,
      result: game.result,
    };
    goToScreen('match');
  }

  // ---------------------------------------------------------------------
  // Pantalla: inicio (Home)
  // ---------------------------------------------------------------------
  function renderHomeScreen() {
    const container = byId('gm-home');
    const league = getUserLeague();
    const team = getUserTeam();
    const standings = league.getStandingsTable();
    const userRank = standings.findIndex((s) => s.team.id === team.id) + 1;
    const userStanding = standings[userRank - 1];
    const activeBracket = getActiveBracket();

    const nextMatches = league.isSeasonComplete ? [] : league.getCurrentRoundMatches();
    const userNextMatch = nextMatches.find(
      (m) => m.homeTeam.id === team.id || m.awayTeam.id === team.id,
    );

    const lastResultHtml = state.lastRoundMatches
      ? renderMatchList(state.lastRoundMatches, team.id)
      : '<p class="gm-muted">Todavía no se ha jugado ninguna jornada.</p>';

    const nextMatchHtml = league.isSeasonComplete
      ? '<p class="gm-muted">Liga regular terminada.</p>'
      : userNextMatch
        ? `<p>${matchLabel(userNextMatch, team.id)}</p>`
        : '<p class="gm-muted">Tu equipo descansa esta jornada.</p>';

    // DESIGN.md 3.4.2/3.4: cuando las DOS divisiones han terminado su liga
    // regular y TODOS sus brackets, la tarjeta principal se convierte en
    // el aviso de cierre de ciclo — manda incluso sobre un bracket propio
    // ya terminado (activeBracket sería null en ese caso de todos modos,
    // ver getActiveBracket) y sobre la jornada de liga.
    const seasonReadyToClose = isSeasonFullyClosable();

    // Mientras haya un bracket (Copa/Playoff/Ascenso) activo y sin
    // terminar, la tarjeta principal de Home se convierte en "el partido
    // que toca ahora" de ese bracket, en vez de la jornada de liga —
    // el usuario no tiene que ir a Competiciones a buscarlo.
    const primaryCardHtml = seasonReadyToClose
      ? `
        <div class="gm-card">
          <h3>Temporada terminada</h3>
          <p class="gm-muted">1ª y 2ª división han terminado su liga regular y sus competiciones. Cierra la temporada para aplicar ascensos/descensos reales y empezar la siguiente.</p>
          <button id="gm-close-season-btn" class="gm-btn gm-btn--primary">Cerrar temporada y empezar la siguiente</button>
        </div>`
      : activeBracket
        ? `
        <div class="gm-card">
          <h3>${activeBracket.title} — ${activeBracket.roundLabel}</h3>
          <p class="gm-muted">Competición en marcha. La liga regular espera a que termine.</p>
          <button id="gm-play-bracket-btn" class="gm-btn gm-btn--primary">Jugar siguiente partido</button>
          <button id="gm-goto-lineup-btn" class="gm-btn">Configurar alineación</button>
        </div>`
        : `
        <div class="gm-card">
          <h3>Jornada ${Math.min(league.currentRound, league.totalRounds)} / ${league.totalRounds}</h3>
          ${nextMatchHtml}
          <button id="gm-play-round-btn" class="gm-btn gm-btn--primary" ${league.isSeasonComplete ? 'disabled' : ''}>
            ${league.isSeasonComplete ? 'Temporada regular terminada' : 'Jugar siguiente jornada'}
          </button>
          ${league.isSeasonComplete ? '' : '<button id="gm-goto-lineup-btn" class="gm-btn">Configurar alineación</button>'}
        </div>`;

    // Resumen del último cierre de temporada (DESIGN.md 3.4: "el usuario
    // debe ver que ha pasado algo") — visible hasta que juegue la
    // siguiente jornada (se limpia en simulateNextRound()).
    const seasonCloseSummaryHtml = state.seasonCloseSummary
      ? `
        <div class="gm-card">
          <h3>Resumen del cierre de temporada</h3>
          <p><strong>Ascienden a 1ª:</strong> ${state.seasonCloseSummary.promoted.join(', ')}</p>
          <p><strong>Descienden a 2ª:</strong> ${state.seasonCloseSummary.relegated.join(', ')}</p>
          ${state.seasonCloseSummary.userTeamDivision ? `<p>Tu equipo, ${team.fullName}, juega ahora en <strong>${state.seasonCloseSummary.userTeamDivision} división</strong>.</p>` : ''}
        </div>`
      : '';

    container.innerHTML = `
      <div class="home-hero">
        <div class="home-hero__team">
          <span class="home-hero__label">Tu club</span>
          <h2>${team.fullName}</h2>
          <span class="home-hero__division">${state.division} División</span>
        </div>
        <div class="home-hero__standing">
          <span class="home-hero__rank">${userRank}</span>
          <span class="home-hero__rank-label">posición</span>
          <span class="home-hero__record">${userStanding.wins}V - ${userStanding.losses}D · ${userStanding.points} pts</span>
        </div>
      </div>

      <div class="home-grid">
        ${primaryCardHtml}
        ${seasonCloseSummaryHtml}

        <div class="gm-card">
          <h3>Última jornada</h3>
          ${lastResultHtml}
        </div>
      </div>
    `;

    const closeSeasonBtn = byId('gm-close-season-btn');
    if (closeSeasonBtn) {
      closeSeasonBtn.addEventListener('click', () => closeSeasonAndPrepareNext());
    }

    const bracketBtn = byId('gm-play-bracket-btn');
    if (bracketBtn) {
      bracketBtn.addEventListener('click', () => {
        if (!getLineupValidity(team).valid) { goToScreen('lineup'); return; }
        playBracketGameWithReveal(activeBracket.bracket, buildLineupMatchOptionsResolver(team).resolveBracketOptions);
      });
    }

    const playBtn = byId('gm-play-round-btn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (!getLineupValidity(team).valid) { goToScreen('lineup'); return; }
        // DESIGN.md 7.12.24 (TAC-5): unificado con playNextMatchWithLineup()
        // — el partido del usuario ahora se juega de verdad sobre el motor
        // pausable (ventanas de intervención reales), no solo se revela un
        // resultado ya calculado de antemano.
        playNextMatchWithLineup(team);
      });
    }

    const gotoLineupBtn = byId('gm-goto-lineup-btn');
    if (gotoLineupBtn) {
      gotoLineupBtn.addEventListener('click', () => goToScreen('lineup'));
    }
  }

  function matchLabel(match, highlightTeamId) {
    const home = match.homeTeam.fullName;
    const away = match.awayTeam.fullName;
    const homeMarker = match.homeTeam.id === highlightTeamId ? '<strong>' + home + '</strong>' : home;
    const awayMarker = match.awayTeam.id === highlightTeamId ? '<strong>' + away + '</strong>' : away;
    if (match.status === 'played') {
      return `${homeMarker} ${match.result.finalScore.home} — ${match.result.finalScore.away} ${awayMarker}`;
    }
    return `${homeMarker} vs ${awayMarker}`;
  }

  function renderMatchList(matches, highlightTeamId) {
    const rows = matches.map((m) => `<li>${matchLabel(m, highlightTeamId)}</li>`).join('');
    return `<ul class="match-list">${rows}</ul>`;
  }

  // ---------------------------------------------------------------------
  // Pantalla: calendario (próximos partidos y resultados pasados)
  // ---------------------------------------------------------------------
  // DESIGN.md 3.3 (Entidad Calendario): fecha real del partido, si la Liga
  // se construyó con un dateResolver de Calendar.js — '—' si no (siempre
  // debería haberlo desde startSeason(), pero se protege igual).
  function formatMatchDate(date) {
    return date ? date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—';
  }

  function renderCalendarScreen() {
    const container = byId('gm-calendar');
    const league = getUserLeague();
    const team = getUserTeam();

    const teamMatches = league.schedule
      .filter((m) => m.homeTeam.id === team.id || m.awayTeam.id === team.id)
      .sort((a, b) => a.round - b.round);

    const rows = teamMatches.map((m) => {
      const played = m.status === 'played';
      const opponent = m.homeTeam.id === team.id ? m.awayTeam : m.homeTeam;
      const venue = m.homeTeam.id === team.id ? 'Casa' : 'Fuera';
      const resultText = played
        ? `${m.result.finalScore.home} - ${m.result.finalScore.away}`
        : '—';
      const outcomeClass = played
        ? ((m.homeTeam.id === team.id ? m.result.finalScore.home > m.result.finalScore.away
          : m.result.finalScore.away > m.result.finalScore.home) ? 'is-win' : 'is-loss')
        : '';
      return `
        <tr class="${outcomeClass}">
          <td>${m.round}</td>
          <td>${formatMatchDate(m.date)}</td>
          <td>${venue}</td>
          <td>${opponent.fullName}</td>
          <td>${resultText}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <h2>Calendario — ${team.fullName}</h2>
      <table class="gm-table">
        <thead><tr><th>Jornada</th><th>Fecha</th><th>Sede</th><th>Rival</th><th>Resultado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ---------------------------------------------------------------------
  // Pantalla: competiciones (clasificación de liga, Copa, playoffs)
  // ---------------------------------------------------------------------
  function renderStandingsTable(league, highlightTeamId) {
    const rows = league.getStandingsTable().map((s, i) => `
      <tr class="${s.team.id === highlightTeamId ? 'is-user-team' : ''}">
        <td>${i + 1}</td>
        <td>${s.team.fullName}</td>
        <td>${s.played}</td>
        <td>${s.wins}</td>
        <td>${s.losses}</td>
        <td>${s.points}</td>
        <td>${s.pointsFor}</td>
        <td>${s.pointsAgainst}</td>
        <td>${s.pointDifference}</td>
      </tr>`).join('');
    return `
      <table class="gm-table gm-table--standings">
        <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>V</th><th>D</th><th>Pts</th><th>PF</th><th>PC</th><th>Dif</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function seriesLine(series) {
    const label = `${series.betterEntry.team.fullName} <span class="gm-seed">(${series.betterEntry.seed})</span>`
      + ` vs ${series.worseEntry.team.fullName} <span class="gm-seed">(${series.worseEntry.seed})</span>`;
    const score = `${series.wins.better}-${series.wins.worse}`;
    const state_ = series.isDecided
      ? `<span class="gm-badge gm-badge--done">Gana ${series.winner.team.fullName}</span>`
      : `<span class="gm-badge">${series.gamesPlayed} jugado(s) · a ${series.gamesNeededToWin} victorias</span>`;
    return `<div class="series-line"><span class="series-line__matchup">${label}</span><span class="series-line__score">${score}</span>${state_}</div>`;
  }

  function bracketHtml(bracketStatus, roundLabels) {
    return bracketStatus.rounds.map((round, i) => `
      <div class="bracket-round">
        <h4>${roundLabels[i] || `Ronda ${i + 1}`}</h4>
        ${round.map(seriesLine).join('')}
      </div>`).join('')
      + (bracketStatus.champion
        ? `<p class="gm-champion">🏆 Campeón: ${bracketStatus.champion.team.fullName}</p>`
        : '');
  }

  function renderCompetitionsScreen() {
    const container = byId('gm-competitions');
    const league = getUserLeague();
    const brackets = getBrackets(state.division);
    const team = getUserTeam();
    const activeTab = container.dataset.activeTab || 'league';

    const tabsAvailable = [
      { id: 'league', label: 'Liga regular' },
    ];
    if (state.division === '1ª') {
      tabsAvailable.push({ id: 'cup', label: 'Copa' });
      tabsAvailable.push({ id: 'playoffs', label: 'Playoff por el título' });
    } else {
      tabsAvailable.push({ id: 'promotion', label: 'Playoff de ascenso' });
    }

    let body = '';
    if (activeTab === 'league') {
      body = renderStandingsTable(league, team.id);
    } else if (activeTab === 'cup') {
      body = brackets.cup
        ? bracketHtml(brackets.cup.getStatus(), ['Cuartos de final', 'Semifinales', 'Final'])
        : '<p class="gm-muted">La Copa se disputa al llegar a la jornada 17 de liga regular. Todavía no se ha alcanzado.</p>';
      if (brackets.cup && !brackets.cup.isComplete) {
        body += `<button id="gm-advance-cup-btn" class="gm-btn">Jugar siguiente partido de la Copa</button>`;
      }
    } else if (activeTab === 'playoffs') {
      body = brackets.titlePlayoff
        ? bracketHtml(brackets.titlePlayoff.getStatus(), ['Cuartos de final', 'Semifinales', 'Final'])
        : '<p class="gm-muted">El playoff por el título se disputa al terminar la liga regular (jornada 34).</p>';
      if (brackets.titlePlayoff && !brackets.titlePlayoff.isComplete) {
        body += `<button id="gm-advance-playoff-btn" class="gm-btn">Jugar siguiente partido del playoff</button>`;
      }
    } else if (activeTab === 'promotion') {
      if (!brackets.promotionPlayoff) {
        body = '<p class="gm-muted">El playoff de ascenso se disputa al terminar la liga regular (jornada 34).</p>';
      } else {
        const status = brackets.promotionPlayoff.getStatus();
        body = `<p class="gm-champion">Asciende directo: ${status.directPromotion.team.fullName}</p>`
          + bracketHtml(status.quarterFinals, ['Cuartos de ascenso (mejor de 5)'])
          + (status.finalFour ? bracketHtml(status.finalFour, ['Semifinales (Final Four)', 'Final (Final Four)']) : '<p class="gm-muted">La Final Four se arma al completar los cuartos.</p>')
          + (status.secondPromotedEntry ? `<p class="gm-champion">🏀 2º ascendido: ${status.secondPromotedEntry.team.fullName}</p>` : '');
        if (!brackets.promotionPlayoff.isComplete) {
          body += `<button id="gm-advance-promotion-btn" class="gm-btn">Jugar siguiente partido del ascenso</button>`;
        }
      }
    }

    container.innerHTML = `
      <div class="tabs">
        ${tabsAvailable.map((t) => `<button class="tabs__btn ${t.id === activeTab ? 'is-active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="tabs__body">${body}</div>
    `;

    container.querySelectorAll('.tabs__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.dataset.activeTab = btn.dataset.tab;
        renderCompetitionsScreen();
      });
    });

    // Mismo puente de revelado por cuartos que usa el botón principal de
    // Home (playBracketGameWithReveal) — un único camino para jugar un
    // partido de bracket, nunca uno con reveal y otro sin él.
    const advanceBracket = (bracket) => {
      if (!getLineupValidity(team).valid) { goToScreen('lineup'); return; }
      playBracketGameWithReveal(bracket, buildLineupMatchOptionsResolver(team).resolveBracketOptions);
    };

    const cupBtn = byId('gm-advance-cup-btn');
    if (cupBtn) cupBtn.addEventListener('click', () => advanceBracket(brackets.cup));

    const playoffBtn = byId('gm-advance-playoff-btn');
    if (playoffBtn) playoffBtn.addEventListener('click', () => advanceBracket(brackets.titlePlayoff));

    const promoBtn = byId('gm-advance-promotion-btn');
    if (promoBtn) promoBtn.addEventListener('click', () => advanceBracket(brackets.promotionPlayoff));
  }

  // ---------------------------------------------------------------------
  // Pantalla: estadísticas de temporada (por jugador, según competición)
  // ---------------------------------------------------------------------
  // Agrega el boxScore de todos los partidos JUGADOS de una lista de
  // partidos (schedule de League, o los games de un Bracket) en totales
  // por jugador. No modifica ningún dato del motor, solo lee resultados
  // ya calculados.
  function aggregatePlayerStats(playedMatches) {
    const totals = new Map(); // playerId -> acumulado

    // `?? 0` en los campos nuevos (minutesPlayed/assists/valoracion/
    // plusMinus/los desgloses de tiro): manejo defensivo para partidos
    // guardados ANTES de la sesión de retoques de estadísticas, cuyo
    // `result` persistido no tiene estos campos en absoluto.
    function addLine(line, teamName) {
      const existing = totals.get(line.playerId) || {
        name: line.name,
        team: teamName,
        games: 0,
        points: 0,
        minutesPlayed: 0,
        reboundsOffensive: 0,
        reboundsDefensive: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        valoracion: 0,
        plusMinus: 0,
        fg2Made: 0,
        fg2Attempted: 0,
        fg3Made: 0,
        fg3Attempted: 0,
        ftMade: 0,
        ftAttempted: 0,
      };
      existing.games += 1;
      existing.points += line.points;
      existing.minutesPlayed += line.minutesPlayed ?? 0;
      existing.reboundsOffensive += line.reboundsOffensive;
      existing.reboundsDefensive += line.reboundsDefensive;
      existing.assists += line.assists ?? 0;
      existing.steals += line.steals;
      existing.blocks += line.blocks;
      existing.turnovers += line.turnovers;
      existing.valoracion += line.valoracion ?? 0;
      existing.plusMinus += line.plusMinus ?? 0;
      const fg = line.fieldGoals || {};
      ['midRangeShot', 'insideShot', 'layup'].forEach((shotType) => {
        existing.fg2Made += (fg[shotType] && fg[shotType].made) || 0;
        existing.fg2Attempted += (fg[shotType] && fg[shotType].attempted) || 0;
      });
      existing.fg3Made += (fg.threePointShot && fg.threePointShot.made) || 0;
      existing.fg3Attempted += (fg.threePointShot && fg.threePointShot.attempted) || 0;
      existing.ftMade += (line.freeThrows && line.freeThrows.made) || 0;
      existing.ftAttempted += (line.freeThrows && line.freeThrows.attempted) || 0;
      totals.set(line.playerId, existing);
    }

    playedMatches.forEach((match) => {
      const result = match.result;
      if (!result) return;
      result.boxScore.home.forEach((line) => addLine(line, match.homeTeam.fullName));
      result.boxScore.away.forEach((line) => addLine(line, match.awayTeam.fullName));
    });

    return [...totals.values()];
  }

  // Formato de minutos jugados: MM:SS (ej. "32:24") — decisión de Dennis,
  // sustituye al formato decimal (ej. "32.4") que había quedado pendiente
  // de confirmar en la sesión de retoques de estadísticas. Los datos de
  // origen (segundos, `boxScore[].minutesPlayed`) no cambian, solo el
  // formateo aquí. Usado tanto en el boxScore de partido como en las
  // medias de temporada (ambos pasan por formatMinutesSingle) — un único
  // punto a tocar si el formato cambia otra vez.
  function formatMinutesMMSS(totalSeconds) {
    const wholeSeconds = Math.round(totalSeconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const seconds = wholeSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  // `null` (sin alineación real ese lado) se muestra como "—" en vez de
  // "0:00" para no confundir "no disponible" con "0 minutos jugados"
  // (DESIGN.md, retoques de estadísticas, punto 1).
  function formatMinutesSingle(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    return formatMinutesMMSS(seconds);
  }

  // Los brackets (Copa/Playoffs/Ascenso) guardan sus partidos jugados
  // dentro de cada Series.games, no expuestos por getStatus() — se leen
  // directamente de la instancia del Bracket, no del status plano.
  function getBracketPlayedMatches(bracket) {
    if (!bracket) return [];
    return bracket.rounds.flatMap((round) => round.flatMap((series) => series.games.map((g) => ({
      homeTeam: g.homeEntry.team, awayTeam: g.awayEntry.team, result: g.result,
    }))));
  }

  // Columnas de la tabla de medias de temporada (retoques de estadísticas)
  // — cada una sabe ordenarse (`sortValue`) y mostrarse (`display`) por sí
  // misma, para no repetir la lógica en dos sitios. Los tres porcentajes
  // se ordenan por el valor porcentual YA CALCULADO sobre los acumulados
  // de temporada (nunca como media de porcentajes partido a partido) —
  // DESIGN.md 7.6/7.11, mismo criterio que el resto de medias de esta
  // tabla (acumulado / partidos jugados, no media de medias).
  function statAverage(p, key) { return p.games > 0 ? p[key] / p.games : 0; }
  function statPct(p, madeKey, attemptedKey) { return p[attemptedKey] > 0 ? p[madeKey] / p[attemptedKey] : null; }

  const STATS_COLUMNS = [
    { key: 'points', label: 'Pts', sortValue: (p) => statAverage(p, 'points'), display: (p) => statAverage(p, 'points').toFixed(1) },
    { key: 'minutesPlayed', label: 'Min', sortValue: (p) => statAverage(p, 'minutesPlayed'), display: (p) => formatMinutesSingle(p.games > 0 ? p.minutesPlayed / p.games : null) },
    { key: 'reboundsOffensive', label: 'Reb Of', sortValue: (p) => statAverage(p, 'reboundsOffensive'), display: (p) => statAverage(p, 'reboundsOffensive').toFixed(1) },
    { key: 'reboundsDefensive', label: 'Reb Def', sortValue: (p) => statAverage(p, 'reboundsDefensive'), display: (p) => statAverage(p, 'reboundsDefensive').toFixed(1) },
    {
      key: 'reboundsTotal', label: 'Reb Tot',
      sortValue: (p) => (p.games > 0 ? (p.reboundsOffensive + p.reboundsDefensive) / p.games : 0),
      display: (p) => ((p.games > 0 ? (p.reboundsOffensive + p.reboundsDefensive) / p.games : 0)).toFixed(1),
    },
    { key: 'assists', label: 'Ast', sortValue: (p) => statAverage(p, 'assists'), display: (p) => statAverage(p, 'assists').toFixed(1) },
    { key: 'steals', label: 'Rob', sortValue: (p) => statAverage(p, 'steals'), display: (p) => statAverage(p, 'steals').toFixed(1) },
    { key: 'blocks', label: 'Tap', sortValue: (p) => statAverage(p, 'blocks'), display: (p) => statAverage(p, 'blocks').toFixed(1) },
    { key: 'turnovers', label: 'Pér', sortValue: (p) => statAverage(p, 'turnovers'), display: (p) => statAverage(p, 'turnovers').toFixed(1) },
    {
      key: 'fg2Pct', label: 'T2%',
      sortValue: (p) => statPct(p, 'fg2Made', 'fg2Attempted') ?? -Infinity,
      display: (p) => { const pct = statPct(p, 'fg2Made', 'fg2Attempted'); return pct === null ? '—' : `${Math.round(pct * 100)}%`; },
    },
    {
      key: 'fg3Pct', label: 'T3%',
      sortValue: (p) => statPct(p, 'fg3Made', 'fg3Attempted') ?? -Infinity,
      display: (p) => { const pct = statPct(p, 'fg3Made', 'fg3Attempted'); return pct === null ? '—' : `${Math.round(pct * 100)}%`; },
    },
    {
      key: 'ftPct', label: 'TL%',
      sortValue: (p) => statPct(p, 'ftMade', 'ftAttempted') ?? -Infinity,
      display: (p) => { const pct = statPct(p, 'ftMade', 'ftAttempted'); return pct === null ? '—' : `${Math.round(pct * 100)}%`; },
    },
    { key: 'valoracion', label: 'Val', sortValue: (p) => statAverage(p, 'valoracion'), display: (p) => statAverage(p, 'valoracion').toFixed(1) },
    {
      key: 'plusMinus', label: '+/-',
      sortValue: (p) => statAverage(p, 'plusMinus'),
      display: (p) => { const avg = statAverage(p, 'plusMinus'); return `${avg >= 0 ? '+' : ''}${avg.toFixed(1)}`; },
    },
  ];

  function renderStatsScreen() {
    const container = byId('gm-stats');
    const competition = state.statsCompetition;

    const tabsAvailable = [{ id: 'league', label: 'Liga regular' }];
    if (state.division === '1ª') {
      tabsAvailable.push({ id: 'cup', label: 'Copa' });
      tabsAvailable.push({ id: 'playoffs', label: 'Playoff' });
    } else {
      tabsAvailable.push({ id: 'promotion', label: 'Ascenso' });
    }

    const brackets = getBrackets(state.division);
    let playedMatches = [];
    if (competition === 'league') playedMatches = getUserLeague().schedule.filter((m) => m.status === 'played');
    else if (competition === 'cup') playedMatches = getBracketPlayedMatches(brackets.cup);
    else if (competition === 'playoffs') playedMatches = getBracketPlayedMatches(brackets.titlePlayoff);
    else if (competition === 'promotion') {
      playedMatches = brackets.promotionPlayoff
        ? [...getBracketPlayedMatches(brackets.promotionPlayoff.quarterFinals), ...getBracketPlayedMatches(brackets.promotionPlayoff.finalFour)]
        : [];
    }

    const activeSortKey = state.statsSortKey;
    const activeColumn = STATS_COLUMNS.find((c) => c.key === activeSortKey) || STATS_COLUMNS[0];
    // Top 20 (antes 30): el ranking siempre refleja la columna activa —
    // ordenar ANTES de recortar, no al revés.
    const playerStats = aggregatePlayerStats(playedMatches)
      .sort((a, b) => activeColumn.sortValue(b) - activeColumn.sortValue(a))
      .slice(0, 20);

    const headerCellsHtml = STATS_COLUMNS.map((col) => `
      <th class="stats-sortable ${col.key === activeSortKey ? 'is-active-sort' : ''}" data-sort-key="${col.key}">${col.label}</th>
    `).join('');

    const rows = playerStats.map((p) => `
      <tr>
        <td>${p.name}</td>
        <td>${p.team}</td>
        <td>${p.games}</td>
        ${STATS_COLUMNS.map((col) => `<td>${col.display(p)}</td>`).join('')}
      </tr>`).join('');

    const body = playerStats.length
      ? `<div class="gm-table-scroll"><table class="gm-table">
          <thead><tr><th>Jugador</th><th>Equipo</th><th>PJ</th>${headerCellsHtml}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
      : '<p class="gm-muted">Todavía no hay partidos jugados en esta competición.</p>';

    container.innerHTML = `
      <div class="tabs">
        ${tabsAvailable.map((t) => `<button class="tabs__btn ${t.id === competition ? 'is-active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <p class="gm-muted gm-stats-note">Medias por partido, ordenadas por ${activeColumn.label} (clic en una cabecera para cambiar). Top 20.</p>
      <div class="tabs__body">${body}</div>
    `;

    container.querySelectorAll('.tabs__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.statsCompetition = btn.dataset.tab;
        renderStatsScreen();
      });
    });
    container.querySelectorAll('.stats-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        state.statsSortKey = th.dataset.sortKey;
        renderStatsScreen();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Pantalla: Alineación (DESIGN.md 7.11.6) — capa de presentación pura
  // sobre src/core/Rotation.js: esta pantalla NO decide nada de rotación
  // por sí misma, solo construye el objeto `lineup` con el shape exacto
  // que espera Rotation.js y lo valida con Rotation.validateLineup() antes
  // de permitir jugar. El quinteto titular es el slot "starter" de cada
  // fila, tal cual lo declara el usuario — Rotation.buildRotationState()
  // usa ese mismo slot para el quinteto inicial real, así que esta pantalla
  // no necesita inferir nada, solo reflejar lo que hay en `lineup.entries`.
  // ---------------------------------------------------------------------

  // Ritmo de competición (0-100, semi-visible según DESIGN.md 6.1) traducido
  // a 1-5 estrellas — excepción explícita de 7.11.6, solo para esta
  // pantalla. Nunca se expone el número crudo en ningún sitio de aquí.
  function competitionRhythmToStars(rhythm) {
    const stars = Math.max(1, Math.min(5, Math.ceil(rhythm / 20)));
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  }

  // Lista de convocados (instancias reales de Player), en el mismo orden
  // que usa la pantalla de Alineación en varios sitios (tabla de slots,
  // resumen de minutos totales, desplegables de quinteto fijo).
  function getConvocatedPlayers(team) {
    const { POSITIONS } = BM;
    return state.lineup.squadIds
      .map((id) => team.roster.find((p) => p.id === id))
      .filter(Boolean)
      .sort((a, b) => POSITIONS.indexOf(a.primaryPosition) - POSITIONS.indexOf(b.primaryPosition));
  }

  // Suma de los 3 slots de una fila (posición) — usada por el contador en
  // vivo "35/40" de cada fila de la tabla.
  function rowMinutesSum(lineup, pos) {
    return SLOT_KEYS.reduce((acc, slotKey) => acc + ((lineup.entries[pos][slotKey] && lineup.entries[pos][slotKey].minutesQuota) || 0), 0);
  }

  // Validación completa: tamaño de convocatoria (reutiliza
  // Team.buildMatchSquad(), que ya valida 8-12 y pertenencia a plantilla —
  // DESIGN.md 6.2) + Rotation.validateLineup (cuotas de minutos por
  // posición). Ambas deben cumplirse para poder jugar/guardar.
  function getLineupValidity(team) {
    const { CONFIG_BASE, validateLineup, describeValidationErrors } = BM;
    try {
      team.buildMatchSquad(state.lineup.squadIds);
    } catch (err) {
      return { valid: false, message: err.message };
    }
    const validation = validateLineup(
      { entries: state.lineup.entries, fixedSegments: state.lineup.fixedSegments },
      CONFIG_BASE,
    );
    if (!validation.valid) {
      return { valid: false, message: describeValidationErrors(validation.errors) };
    }
    return { valid: true, message: null };
  }

  // Quita a un jugador de cualquier slot (de cualquier posición) en el que
  // estuviera asignado — se llama al desconvocarlo, para no dejar
  // referencias colgantes a un jugador que ya no está en la convocatoria.
  function removePlayerFromAllSlots(playerId) {
    BM.POSITIONS.forEach((pos) => {
      SLOT_KEYS.forEach((slotKey) => {
        const slot = state.lineup.entries[pos][slotKey];
        if (slot.playerId === playerId) {
          slot.playerId = null;
          slot.minutesQuota = 0;
        }
      });
    });
  }

  function toggleSquadMember(team, playerId) {
    const lineup = state.lineup;
    const idx = lineup.squadIds.indexOf(playerId);
    if (idx >= 0) {
      lineup.squadIds.splice(idx, 1);
      removePlayerFromAllSlots(playerId);
    } else {
      if (lineup.squadIds.length >= 12) return; // máximo de convocatoria (6.2)
      lineup.squadIds.push(playerId);
    }
    renderLineupScreen();
  }

  // Cambio de jugador en un slot (desplegable) — los desplegables de una
  // fila no se excluyen entre sí ni con otras filas, un jugador puede
  // repetirse en varios slots sin restricción (Rotation.js ya lo admite).
  function updateSlotPlayer(position, slotKey, playerId) {
    state.lineup.entries[position][slotKey].playerId = playerId || null;
    renderLineupScreen();
  }

  // Commit final de los minutos de un slot al perder el foco (evento
  // 'change'): clampa 0..duración del partido y vuelve a renderizar entero,
  // igual que el resto de controles de esta pantalla.
  function updateSlotMinutes(position, slotKey, minutes, durationMinutes) {
    const clamped = Math.max(0, Math.min(durationMinutes, Number(minutes) || 0));
    state.lineup.entries[position][slotKey].minutesQuota = clamped;
    renderLineupScreen();
  }

  // Actualización EN VIVO (evento 'input', cada pulsación) del contador
  // "35/40" de una fila y del resumen de minutos totales por jugador — sin
  // esperar al 'change'/blur ni a un renderizado completo (que perdería el
  // foco del campo mientras se escribe). El valor se guarda sin clampar
  // todavía (el clamp definitivo lo hace updateSlotMinutes en 'change');
  // esto es solo para que el contador se vea reaccionar al momento.
  function onSlotMinutesLiveInput(position, slotKey, rawValue) {
    const value = Number(rawValue);
    state.lineup.entries[position][slotKey].minutesQuota = Number.isFinite(value) ? value : 0;
    updateRowTotalBadge(position);
    updatePlayerTotalsSummary();
  }

  function updateRowTotalBadge(position) {
    const cell = byId(`lineup-row-total-${position}`);
    if (!cell) return;
    const { CONFIG_BASE } = BM;
    const durationMinutes = CONFIG_BASE.match.durationMinutes;
    const sum = rowMinutesSum(state.lineup, position);
    const isOk = sum === durationMinutes;
    cell.textContent = `${sum}/${durationMinutes}`;
    cell.classList.toggle('is-ok', isOk);
    cell.classList.toggle('is-bad', !isOk);
  }

  function updatePlayerTotalsSummary() {
    const body = byId('lineup-player-totals-body');
    if (!body) return;
    const team = getUserTeam();
    if (!team) return;
    body.innerHTML = renderPlayerTotalsRows(getConvocatedPlayers(team));
  }

  function renderPlayerTotalsRows(convocated) {
    const totals = BM.totalMinutesByPlayer(state.lineup);
    if (convocated.length === 0) return '<tr><td colspan="2" class="gm-muted">Sin convocados todavía.</td></tr>';
    return convocated.map((player) => `
      <tr><td>${player.fullName}</td><td>${totals[player.id] || 0} min</td></tr>`).join('');
  }

  function addFixedSegment(team) {
    const draft = state.lineup.segmentDraft;
    const five = {};
    BM.POSITIONS.forEach((pos) => {
      if (draft.five[pos]) five[pos] = draft.five[pos];
    });
    state.lineup.fixedSegments.push({
      label: draft.label.trim() || `Quinteto fijo ${state.lineup.fixedSegments.length + 1}`,
      trigger: { fromPeriod: draft.fromPeriod, scoreCondition: draft.scoreCondition },
      five,
    });
    state.lineup.segmentDraft = null;
    renderLineupScreen();
  }

  function removeFixedSegment(index) {
    state.lineup.fixedSegments.splice(index, 1);
    renderLineupScreen();
  }

  function renderLineupScreen() {
    const container = byId('gm-lineup');
    const team = getUserTeam();
    if (!team) { container.innerHTML = ''; return; }

    const { CONFIG_BASE, POSITIONS } = BM;
    const durationMinutes = CONFIG_BASE.match.durationMinutes;
    const lineup = state.lineup;
    const activeBracket = getActiveBracket();

    // Mismo criterio que Home para identificar "el próximo partido" — ver
    // getActiveBracket() (Bloque B), reutilizado tal cual.
    const nextMatchHtml = activeBracket
      ? `<p>${activeBracket.title} — ${activeBracket.roundLabel}</p>`
      : (() => {
        const league = getUserLeague();
        const nextMatches = league.isSeasonComplete ? [] : league.getCurrentRoundMatches();
        const userNextMatch = nextMatches.find((m) => m.homeTeam.id === team.id || m.awayTeam.id === team.id);
        return league.isSeasonComplete
          ? '<p class="gm-muted">Liga regular terminada.</p>'
          : userNextMatch
            ? `<p>${matchLabel(userNextMatch, team.id)}</p>`
            : '<p class="gm-muted">Tu equipo descansa esta jornada.</p>';
      })();

    const sortedRoster = [...team.roster].sort((a, b) => {
      const posDiff = POSITIONS.indexOf(a.primaryPosition) - POSITIONS.indexOf(b.primaryPosition);
      return posDiff !== 0 ? posDiff : a.fullName.localeCompare(b.fullName, 'es');
    });

    // Convocatoria: checkboxes con nombre, posición y valoraciones en
    // estrellas (DESIGN.md 7.11.6) — antes vivían en la tarjeta de
    // "Convocados" de abajo; se trasladan aquí porque esa tarjeta desaparece
    // (sustituida por la tabla de slots), y 7.11.6 exige mostrarlas para
    // cada convocado en algún sitio de esta pantalla. Ver nota en la
    // respuesta final: es un traslado del mismo bloque, no un rediseño del
    // mecanismo de checkboxes en sí.
    const squadPickerHtml = sortedRoster.map((player) => `
      <label class="squad-picker__item">
        <input type="checkbox" class="squad-checkbox" data-player-id="${player.id}"
          ${lineup.squadIds.includes(player.id) ? 'checked' : ''}>
        <span class="squad-picker__name">${player.fullName}</span>
        <span class="squad-picker__pos">${player.primaryPosition}</span>
        <span class="squad-picker__ratings">
          <span>T ${player.technicalAverage.toFixed(1)}</span>
          <span>F ${player.physicalAverage.toFixed(1)}</span>
          <span>M ${player.mentalAverage.toFixed(1)}</span>
          <span>Resistencia ${player.physical.stamina}</span>
          <span>Energía ${Math.round(player.dynamicState.energy)}</span>
          <span class="squad-picker__form">Forma ${competitionRhythmToStars(player.dynamicState.competitionRhythm)}</span>
        </span>
      </label>`).join('');

    const convocated = getConvocatedPlayers(team);

    // Tabla de 5 filas (una por posición) × 3 columnas de slot (Titular,
    // Suplente 1, Suplente 2) — cada slot es un desplegable de convocado +
    // minutos, sin exclusión entre desplegables (un jugador puede
    // repetirse). Contador en vivo "35/40" por fila, actualizado por
    // updateRowTotalBadge()/onSlotMinutesLiveInput() sin esperar a guardar.
    const slotsTableRowsHtml = POSITIONS.map((pos) => {
      const row = lineup.entries[pos];
      const sum = rowMinutesSum(lineup, pos);
      const isOk = sum === durationMinutes;
      const slotCellsHtml = SLOT_KEYS.map((slotKey) => {
        const slot = row[slotKey];
        const optionsHtml = convocated.map((p) => `
          <option value="${p.id}" ${slot.playerId === p.id ? 'selected' : ''}>${p.fullName}</option>`).join('');
        return `
          <td class="lineup-slot-cell">
            <select class="lineup-slot-player" data-position="${pos}" data-slot="${slotKey}">
              <option value="">—</option>
              ${optionsHtml}
            </select>
            <input type="number" class="lineup-slot-minutes" data-position="${pos}" data-slot="${slotKey}"
              min="0" max="${durationMinutes}" step="1" value="${slot.minutesQuota}">
          </td>`;
      }).join('');
      return `
        <tr>
          <th>${pos}</th>
          ${slotCellsHtml}
          <td id="lineup-row-total-${pos}" class="lineup-slot-total ${isOk ? 'is-ok' : 'is-bad'}">${sum}/${durationMinutes}</td>
        </tr>`;
    }).join('');

    const slotsTableHtml = `
      <table class="gm-table lineup-slots-table">
        <thead>
          <tr><th>Posición</th><th>Titular</th><th>Suplente 1</th><th>Suplente 2</th><th>Min.</th></tr>
        </thead>
        <tbody>${slotsTableRowsHtml}</tbody>
      </table>`;

    const playerTotalsHtml = `
      <table class="gm-table lineup-player-totals">
        <thead><tr><th>Jugador</th><th>Minutos totales</th></tr></thead>
        <tbody id="lineup-player-totals-body">${renderPlayerTotalsRows(convocated)}</tbody>
      </table>`;

    const validity = getLineupValidity(team);

    const draft = lineup.segmentDraft;
    const segmentFormHtml = draft ? `
      <div class="segment-form">
        <label>Etiqueta <input type="text" id="segment-label-input" value="${draft.label}" placeholder="Quinteto de cierre"></label>
        <label>Desde el período <input type="number" id="segment-period-input" min="1" value="${draft.fromPeriod}"></label>
        <label>Condición
          <select id="segment-condition-select">
            <option value="any" ${draft.scoreCondition === 'any' ? 'selected' : ''}>Cualquiera</option>
            <option value="ahead" ${draft.scoreCondition === 'ahead' ? 'selected' : ''}>Si vamos ganando</option>
            <option value="behind" ${draft.scoreCondition === 'behind' ? 'selected' : ''}>Si vamos perdiendo</option>
          </select>
        </label>
        <div class="segment-form__five">
          ${POSITIONS.map((pos) => `
            <label>${pos}
              <select class="segment-five-select" data-position="${pos}">
                <option value="">— sin fijar —</option>
                ${convocated.map((p) => `<option value="${p.id}" ${draft.five[pos] === p.id ? 'selected' : ''}>${p.fullName}</option>`).join('')}
              </select>
            </label>`).join('')}
        </div>
        <button id="segment-confirm-btn" class="gm-btn gm-btn--primary" ${convocated.length === 0 ? 'disabled' : ''}>Añadir quinteto fijo</button>
        <button id="segment-cancel-btn" class="gm-btn">Cancelar</button>
      </div>`
      : `<button id="segment-start-btn" class="gm-btn" ${convocated.length === 0 ? 'disabled' : ''}>+ Añadir quinteto fijo</button>`;

    const segmentsListHtml = lineup.fixedSegments.map((segment, index) => {
      const fiveText = POSITIONS
        .filter((pos) => segment.five[pos])
        .map((pos) => `${pos}: ${(team.roster.find((p) => p.id === segment.five[pos]) || {}).fullName || '?'}`)
        .join(' · ') || 'sin jugadores fijados';
      const conditionText = { any: 'siempre', ahead: 'ganando', behind: 'perdiendo' }[segment.trigger.scoreCondition];
      return `
        <div class="segment-line">
          <div>
            <strong>${segment.label}</strong>
            <span class="gm-muted">— desde período ${segment.trigger.fromPeriod}, ${conditionText}</span>
            <div class="gm-muted">${fiveText}</div>
          </div>
          <button class="gm-btn segment-remove-btn" data-index="${index}">Quitar</button>
        </div>`;
    }).join('');

    container.innerHTML = `
      <h2>Alineación</h2>
      <div class="gm-card">${nextMatchHtml}</div>

      <div class="gm-card">
        <h3>Convocatoria (${lineup.squadIds.length}/12, mínimo 8)</h3>
        <div class="squad-picker">${squadPickerHtml}</div>
      </div>

      <div class="gm-card">
        <h3>Alineación por posición</h3>
        ${convocated.length ? slotsTableHtml : '<p class="gm-muted">Selecciona al menos 8 jugadores en la convocatoria.</p>'}
        ${convocated.length ? `<div class="lineup-player-totals-wrap"><h4>Minutos totales por jugador</h4>${playerTotalsHtml}</div>` : ''}
        <label class="gm-checkbox lineup-garbage-time-toggle">
          <input type="checkbox" id="lineup-garbage-time-checkbox" ${lineup.garbageTime.enabled ? 'checked' : ''}>
          Permitir minutos de la basura
        </label>
      </div>

      <div class="gm-card">
        <h3>Quintetos fijos (opcional)</h3>
        ${segmentsListHtml}
        ${segmentFormHtml}
      </div>

      <div class="gm-card">
        <p class="${validity.valid ? 'lineup-status lineup-status--ok' : 'lineup-status lineup-status--error'}">
          ${validity.valid ? '✔ Alineación válida.' : `✖ ${validity.message}`}
        </p>
        <button id="gm-play-with-lineup-btn" class="gm-btn gm-btn--primary" ${validity.valid ? '' : 'disabled'}>
          Jugar partido con esta alineación
        </button>
      </div>
    `;

    container.querySelectorAll('.squad-checkbox').forEach((el) => {
      el.addEventListener('change', () => toggleSquadMember(team, el.dataset.playerId));
    });
    container.querySelectorAll('.lineup-slot-player').forEach((el) => {
      el.addEventListener('change', () => updateSlotPlayer(el.dataset.position, el.dataset.slot, el.value));
    });
    container.querySelectorAll('.lineup-slot-minutes').forEach((el) => {
      // 'input' (cada pulsación): actualiza el contador de la fila y el
      // resumen de totales EN VIVO, sin renderizar toda la pantalla (se
      // perdería el foco mientras se escribe). 'change' (al perder el
      // foco): clampa el valor final y sí renderiza entero, para refrescar
      // la validez global y el botón de jugar.
      el.addEventListener('input', () => onSlotMinutesLiveInput(el.dataset.position, el.dataset.slot, el.value));
      el.addEventListener('change', () => updateSlotMinutes(el.dataset.position, el.dataset.slot, el.value, durationMinutes));
    });
    const garbageTimeCheckbox = byId('lineup-garbage-time-checkbox');
    if (garbageTimeCheckbox) {
      garbageTimeCheckbox.addEventListener('change', () => {
        state.lineup.garbageTime.enabled = garbageTimeCheckbox.checked;
      });
    }

    const segmentStartBtn = byId('segment-start-btn');
    if (segmentStartBtn) {
      segmentStartBtn.addEventListener('click', () => {
        state.lineup.segmentDraft = { label: '', fromPeriod: 4, scoreCondition: 'any', five: {} };
        renderLineupScreen();
      });
    }
    const segmentCancelBtn = byId('segment-cancel-btn');
    if (segmentCancelBtn) {
      segmentCancelBtn.addEventListener('click', () => { state.lineup.segmentDraft = null; renderLineupScreen(); });
    }
    const segmentConfirmBtn = byId('segment-confirm-btn');
    if (segmentConfirmBtn) {
      segmentConfirmBtn.addEventListener('click', () => addFixedSegment(team));
    }
    const labelInput = byId('segment-label-input');
    if (labelInput) labelInput.addEventListener('change', () => { state.lineup.segmentDraft.label = labelInput.value; });
    const periodInput = byId('segment-period-input');
    if (periodInput) periodInput.addEventListener('change', () => { state.lineup.segmentDraft.fromPeriod = Number(periodInput.value) || 1; });
    const conditionSelect = byId('segment-condition-select');
    if (conditionSelect) conditionSelect.addEventListener('change', () => { state.lineup.segmentDraft.scoreCondition = conditionSelect.value; });
    container.querySelectorAll('.segment-five-select').forEach((el) => {
      el.addEventListener('change', () => { state.lineup.segmentDraft.five[el.dataset.position] = el.value || null; });
    });
    container.querySelectorAll('.segment-remove-btn').forEach((el) => {
      el.addEventListener('click', () => removeFixedSegment(Number(el.dataset.index)));
    });

    const playBtn = byId('gm-play-with-lineup-btn');
    if (playBtn) playBtn.addEventListener('click', () => playNextMatchWithLineup(team));
  }

  // ---------------------------------------------------------------------
  // Pantalla: Tácticas (DESIGN.md 7.12.32) — TAC-2: subset de 3 de las 7
  // vistas (Resumen/Ataque/Roles); Defensa/Playbook/Situaciones/Rival son
  // TAC-3/TAC-4/TAC-5/TAC-7, no se adelantan aquí. Capa de presentación
  // pura sobre src/core/Tactics.js — igual que Alineación es una capa sobre
  // Rotation.js (7.11.6): esta pantalla no decide ninguna regla táctica
  // propia, solo lee/escribe `team.tacticalProfile` (persistido en Team.js
  // desde esta entrega) y llama a funciones ya construidas en Tactics.js
  // (effectiveSpacing/roleFit/computeLineupRatings vía computeLineupRatings
  // y bestRolesForPlayer).
  // ---------------------------------------------------------------------

  function starsHtml(stars) {
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  }

  const SPACING_LABELS = {
    '5-out': '5-Out', '4-out-1-in': '4-Out 1-In', '3-out-2-in': '3-Out 2-In', dynamic: 'Dynamic',
  };
  const PNR_COVERAGE_LABELS = { drop: 'Drop', under: 'Under', switch: 'Switch', hedge: 'Hedge', blitz: 'Blitz' };
  const TACTICS_IDENTITY_LABELS = {
    pace: 'Ritmo', earlyOffense: 'Early offense', ballMovement: 'Movimiento de balón', pickAndRollUsage: 'Uso de Pick & Roll',
    // TAC-6 (7.12.7/7.12.22): primer eje de identidad con efecto real en el
    // motor (tacticalExecution) desde que se declaró en TAC-2 — 0 = Read &
    // React puro, 100 = Rigidez pura.
    rigidity: 'Rigidez ↔ Read & React',
  };
  // TAC-6 (7.12.22): etiquetas de la sección "Familiaridad" de Resumen —
  // solo lectura, mismas familias que PLAY_FAMILY_LABELS/PNR_COVERAGE_LABELS
  // ya usan en Playbook/Defensa.
  const FAMILIARITY_FAMILY_LABELS = {
    pickAndRoll: 'Pick & Roll', isolation: 'Isolation', postUp: 'Post Up',
    handoff: 'Handoff / DHO', offScreen: 'Off Screen', motionFlow: 'Motion / Flow',
  };
  const PLAY_TYPE_LABELS = { pickAndRoll: 'Pick & Roll', isolation: 'Isolation', postUp: 'Post Up', transition: 'Transition' };
  // TAC-3 (7.12.10): etiquetas de familia para las 3 que ya tienen catálogo
  // de PlayDefinition pero no coinciden 1:1 con PLAY_TYPE_LABELS de arriba
  // (handoff/offScreen/motionFlow no tienen slider de peso propio todavía,
  // solo catálogo de datos).
  const PLAY_FAMILY_LABELS = {
    ...PLAY_TYPE_LABELS,
    handoff: 'Handoff / DHO', offScreen: 'Off Screen', motionFlow: 'Motion / Flow',
  };
  const LINEUP_RATING_LABELS = {
    creation: 'Creación', spacing: 'Spacing', outsideShooting: 'Tiro exterior',
    insideFinishing: 'Finalización interior', offensiveRebound: 'Rebote ofensivo', defensiveRebound: 'Rebote defensivo',
    // TAC-4 (7.12.28): completadas esta entrega — ver Tactics.computeLineupRatings.
    switchability: 'Switchability', rimProtection: 'Rim Protection', transitionDefense: 'Transition Defense',
  };
  // TAC-4 (7.12.13/7.12.14/7.12.15/7.12.19): etiquetas de la sub-pestaña Defensa.
  const BASE_SCHEME_LABELS = {
    'man-to-man': 'Hombre a hombre', '2-3': 'Zona 2-3', '3-2': 'Zona 3-2', '1-3-1': 'Zona 1-3-1',
  };
  const PRESS_TYPE_LABELS = { halfCourt: 'A 3/4 de pista', fullCourt: 'A toda pista' };
  const POST_DOUBLE_TEAM_RULE_LABELS = {
    never: 'Nunca', starOnly: 'Solo si supera claramente a su defensor', always: 'Siempre que reciba en el poste',
  };

  // Quinteto titular actual (7.12.32, vista "Resumen"): mismo criterio que
  // Rotation.buildRotationState usa para el onCourt inicial de un
  // partido — el slot "starter" de cada posición en `state.lineup.entries`,
  // sin necesitar una alineación real en curso ni tocar Rotation.js
  // (7.12.1 deja la capa de identidad fuera del motor de partido en TAC-2).
  // Reutiliza `state.lineup`, la misma fuente que ya usa la pantalla de
  // Alineación — no reinventa cómo se sabe "quién está en pista" (pedido
  // explícito del prompt de esta sesión).
  function getStarterFive(team) {
    return BM.POSITIONS.map((pos) => {
      const row = state.lineup.entries[pos];
      const playerId = row && row.starter && row.starter.playerId;
      return playerId ? team.roster.find((p) => p.id === playerId) : null;
    }).filter(Boolean);
  }

  function renderTacticsSummaryTab(team) {
    const { CONFIG_BASE } = BM;
    const profile = team.tacticalProfile;
    const five = getStarterFive(team);

    const identityRowsHtml = Object.keys(TACTICS_IDENTITY_LABELS).map((key) => `
      <div class="tactics-identity-row"><span>${TACTICS_IDENTITY_LABELS[key]}</span><strong>${Math.round(profile.identity[key] ?? 0)}</strong></div>`).join('');

    const ratingsHtml = five.length < 5
      ? '<p class="gm-muted">Completa el quinteto titular en la pantalla de Alineación para ver sus valoraciones.</p>'
      : `<table class="gm-table tactics-ratings-table"><tbody>${
        Object.entries(BM.computeLineupRatings(five, profile, CONFIG_BASE))
          .map(([key, r]) => `<tr><td>${LINEUP_RATING_LABELS[key]}</td><td class="tactics-stars">${starsHtml(r.stars)}</td></tr>`)
          .join('')
      }</tbody></table>`;

    return `
      <div class="gm-card">
        <h3>Identidad</h3>
        <p><strong>Spacing:</strong> ${SPACING_LABELS[profile.spacing] || profile.spacing}</p>
        <p><strong>Cobertura de P&R por defecto:</strong> ${PNR_COVERAGE_LABELS[profile.pnrCoverage] || profile.pnrCoverage}</p>
        <div class="tactics-identity-grid">${identityRowsHtml}</div>
      </div>
      <div class="gm-card">
        <h3>Valoraciones del quinteto titular</h3>
        ${ratingsHtml}
      </div>
      ${renderFamiliaritySection(profile)}`;
  }

  // TAC-6 (7.12.22/7.12.32): sección de solo lectura — la familiaridad NO
  // se declara, se gana jugando partidos reales (nunca un editor aquí,
  // pedido explícito de esta entrega). Muestra familiaridad ofensiva/
  // defensiva global y las 2-3 familias/coberturas más usadas HASTA AHORA
  // — como no se registra un contador de uso aparte (7.12.34, decisión de
  // encaje: no se guarda telemetría de frecuencia todavía, eso es TAC-7/
  // Data Hub), se aproxima con la MAYOR desviación absoluta respecto al
  // valor de partida (`FAMILIARITY_DEFAULT`) — una familia/cobertura que
  // nunca se ha usado se queda exactamente en ese valor de partida, así
  // que cualquier desviación real solo puede venir de haberla jugado.
  function familiarityBarHtml(label, level) {
    const rounded = Math.round(level);
    return `
      <div class="tactics-familiarity-row">
        <span>${label}</span>
        <div class="tactics-familiarity-bar"><div class="tactics-familiarity-bar-fill" style="width:${rounded}%"></div></div>
        <strong>${rounded}</strong>
      </div>`;
  }

  function topFamiliarityEntries(group, labels, defaultValue, topN) {
    return Object.keys(group)
      .map((key) => ({ key, level: group[key], deviation: Math.abs(group[key] - defaultValue) }))
      .sort((a, b) => b.deviation - a.deviation)
      .slice(0, topN)
      .map((entry) => ({ label: labels[entry.key] || entry.key, level: entry.level, used: entry.deviation > 0.5 }));
  }

  function renderFamiliaritySection(profile) {
    const fam = profile.familiarity;
    if (!fam) {
      // 7.12.34 (compatibilidad): perfil plano/legacy sin `familiarity` —
      // no debería ocurrir con `new TacticalProfile()`, pero esta pantalla
      // no debe romperse si algún día aparece uno.
      return '';
    }
    const topFamilies = topFamiliarityEntries(fam.byPlayFamily, FAMILIARITY_FAMILY_LABELS, BM.FAMILIARITY_DEFAULT, 3);
    const topCoverages = topFamiliarityEntries(fam.byCoverage, PNR_COVERAGE_LABELS, BM.FAMILIARITY_DEFAULT, 3);
    const familiesHtml = topFamilies.some((e) => e.used)
      ? topFamilies.filter((e) => e.used).map((e) => familiarityBarHtml(e.label, e.level)).join('')
      : '<p class="gm-muted">Todavía sin partidos jugados con ninguna familia de jugada por encima del punto de partida.</p>';
    const coveragesHtml = topCoverages.some((e) => e.used)
      ? topCoverages.filter((e) => e.used).map((e) => familiarityBarHtml(e.label, e.level)).join('')
      : '<p class="gm-muted">Todavía sin partidos jugados contra ninguna cobertura rival por encima del punto de partida.</p>';

    return `
      <div class="gm-card">
        <h3>Familiaridad</h3>
        <p class="gm-muted">Cuánto domina el equipo la táctica declarada arriba — sube jugando partidos reales, no se edita aquí (DESIGN.md 7.12.22).</p>
        ${familiarityBarHtml('Sistema ofensivo', fam.offensiveSystem)}
        ${familiarityBarHtml('Sistema defensivo', fam.defensiveSystem)}
        <h4>Familias de jugada más entrenadas</h4>
        ${familiesHtml}
        <h4>Coberturas defensivas más entrenadas</h4>
        ${coveragesHtml}
      </div>`;
  }

  function renderTacticsAttackTab(team) {
    const profile = team.tacticalProfile;

    const spacingOptionsHtml = BM.SPACING_OPTIONS.map((opt) => `
      <option value="${opt}" ${profile.spacing === opt ? 'selected' : ''}>${SPACING_LABELS[opt] || opt}</option>`).join('');

    const identitySlidersHtml = Object.keys(TACTICS_IDENTITY_LABELS).map((key) => `
      <label class="tactics-slider-row">
        <span>${TACTICS_IDENTITY_LABELS[key]}</span>
        <input type="range" min="0" max="100" step="5" class="tactics-identity-input" data-key="${key}" value="${profile.identity[key] ?? 50}">
        <span class="tactics-slider-value">${Math.round(profile.identity[key] ?? 50)}</span>
      </label>`).join('');

    const playTypeRowsHtml = Object.keys(PLAY_TYPE_LABELS).map((key) => `
      <label class="tactics-slider-row">
        <span>${PLAY_TYPE_LABELS[key]}${key === 'pickAndRoll' ? ' <span class="gm-muted">(único con efecto real en el motor por ahora)</span>' : ''}</span>
        <input type="range" min="0" max="100" step="5" class="tactics-playtype-input" data-key="${key}" value="${profile.playTypeWeights[key] ?? 0}">
        <span class="tactics-slider-value">${Math.round(profile.playTypeWeights[key] ?? 0)}</span>
      </label>`).join('');

    return `
      <div class="gm-card">
        <h3>Spacing</h3>
        <select id="tactics-spacing-select">${spacingOptionsHtml}</select>
        <p class="gm-muted">5-Out separa al máximo la pintura; 3-Out 2-In prioriza rebote/poste sobre espacio de penetración. El spacing EFECTIVO depende de qué jugadores estén realmente en pista (ver Resumen) — elegir un spacing no lo garantiza por sí solo.</p>
      </div>
      <div class="gm-card">
        <h3>Ejes de identidad ofensiva</h3>
        ${identitySlidersHtml}
      </div>
      <div class="gm-card">
        <h3>Pesos de play-type</h3>
        ${playTypeRowsHtml}
        <p class="gm-muted">El resto del catálogo de play-types (Post Up avanzado, Transition, Isolation con generación real de tiro...) se guarda ya, pero el motor todavía solo usa Pick & Roll — llegará con una entrega futura del sistema táctico.</p>
      </div>`;
  }

  function renderTacticsRolesTab(team) {
    const { CONFIG_BASE } = BM;
    const convocated = getConvocatedPlayers(team);
    if (convocated.length === 0) {
      return '<div class="gm-card"><p class="gm-muted">Convoca jugadores en la pantalla de Alineación para poder asignarles un rol.</p></div>';
    }
    const profile = team.tacticalProfile;

    const rowsHtml = convocated.map((player) => {
      const assignment = profile.roleAssignments[player.id] || {};
      const offensiveOptionsHtml = BM.OFFENSIVE_ROLES.map((r) => `
        <option value="${r.id}" ${assignment.offensiveRole === r.id ? 'selected' : ''}>${r.label}</option>`).join('');
      const defensiveOptionsHtml = BM.DEFENSIVE_ROLES.map((r) => `
        <option value="${r.id}" ${assignment.defensiveRole === r.id ? 'selected' : ''}>${r.label}</option>`).join('');

      const offFitHtml = assignment.offensiveRole ? starsHtml(BM.roleFit(player, assignment.offensiveRole, CONFIG_BASE).stars) : '—';
      const defFitHtml = assignment.defensiveRole ? starsHtml(BM.roleFit(player, assignment.defensiveRole, CONFIG_BASE).stars) : '—';

      const bestOffenseHtml = BM.bestRolesForPlayer(player, 'offensive', CONFIG_BASE, 3)
        .map((r) => `${r.label} ${starsHtml(r.stars)}`).join(' · ');
      const bestDefenseHtml = BM.bestRolesForPlayer(player, 'defensive', CONFIG_BASE, 3)
        .map((r) => `${r.label} ${starsHtml(r.stars)}`).join(' · ');

      return `
        <tr>
          <td>${player.fullName}</td>
          <td>${player.primaryPosition}</td>
          <td>
            <select class="tactics-role-select" data-player-id="${player.id}" data-side="offensive">
              <option value="">— sin rol —</option>${offensiveOptionsHtml}
            </select>
            <div class="tactics-role-fit">${offFitHtml}</div>
          </td>
          <td class="gm-muted tactics-best-roles">${bestOffenseHtml}</td>
          <td>
            <select class="tactics-role-select" data-player-id="${player.id}" data-side="defensive">
              <option value="">— sin rol —</option>${defensiveOptionsHtml}
            </select>
            <div class="tactics-role-fit">${defFitHtml}</div>
          </td>
          <td class="gm-muted tactics-best-roles">${bestDefenseHtml}</td>
        </tr>`;
    }).join('');

    return `
      <div class="gm-card">
        <h3>Roles ofensivos y defensivos</h3>
        <div class="gm-table-scroll">
          <table class="gm-table tactics-roles-table">
            <thead>
              <tr><th>Jugador</th><th>Pos.</th><th>Rol ofensivo</th><th>Mejor encaje (of.)</th><th>Rol defensivo</th><th>Mejor encaje (def.)</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  // TAC-3 (7.12.32, sub-pestaña Playbook): capa de presentación pura sobre
  // el catálogo de datos de Tactics.PLAY_DEFINITIONS (7.12.10) — igual que
  // el resto de esta pantalla, no decide ninguna regla táctica propia.
  // Contenido mínimo (punto 6 del prompt de esta sesión): lista de jugadas
  // con familia/participantes/spacing compatible/complejidad/lecturas
  // principales. Prioridad/peso editable POR JUGADA (dentro de una misma
  // familia) queda deliberadamente fuera de esta entrega — el motor ya
  // elige automáticamente entre las jugadas de una familia según el
  // spacing declarado (Tactics.choosePlayDefinition); un editor de
  // prioridad es mejora de una entrega futura.
  function renderTacticsPlaybookTab() {
    const rowsHtml = BM.PLAY_DEFINITIONS.map((play) => {
      const familyLabel = PLAY_FAMILY_LABELS[play.family] || play.family;
      const hasRealEngine = BM.REAL_PLAY_FAMILIES.indexOf(play.family) !== -1;
      const spacingHtml = play.compatibleSpacing.map((s) => SPACING_LABELS[s] || s).join(', ');
      const participantsHtml = play.participants.length > 0 ? play.participants.join(', ') : '—';
      const readsHtml = play.reads
        .map((r) => `${r.label} <span class="gm-muted">(vs ${r.vs.map((c) => PNR_COVERAGE_LABELS[c] || c).join('/')})</span>`)
        .join('<br>');
      const situationalBadge = play.situationType
        ? ` <span class="gm-muted">(situacional: ${SITUATION_TYPE_LABELS[play.situationType] || play.situationType})</span>` : '';
      return `
        <tr>
          <td>${play.name}${situationalBadge}${hasRealEngine ? '' : ' <span class="gm-muted">(catálogo, sin motor propio todavía)</span>'}</td>
          <td>${familyLabel}</td>
          <td>${participantsHtml}</td>
          <td>${spacingHtml}</td>
          <td>${play.complexity}</td>
          <td>${readsHtml}</td>
        </tr>`;
    }).join('');

    return `
      <div class="gm-card">
        <h3>Playbook</h3>
        <p class="gm-muted">Catálogo de jugadas disponibles (DESIGN.md 7.12.10). Pick &amp; Roll, Isolation y Post Up ya tienen comportamiento real en el motor según los pesos de play-type de la pestaña Ataque; Handoff/DHO, Off Screen y Motion/Flow quedan como catálogo de datos, sin motor propio todavía. La prioridad/peso de cada jugada individual dentro de una misma familia no es editable todavía — el motor elige automáticamente según el spacing declarado del equipo.</p>
        <div class="gm-table-scroll">
          <table class="gm-table playbook-table">
            <thead>
              <tr><th>Jugada</th><th>Familia</th><th>Participantes</th><th>Spacing compatible</th><th>Complejidad</th><th>Lecturas principales</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  // TAC-4 (7.12.17): TODOS los jugadores reales de ambas divisiones,
  // agrupados por equipo — solo para el selector de "jugador rival a
  // marcar" de un matchup declarado (esta pantalla no tiene un rival fijo
  // de partido, ver Tactics.TacticalProfile.matchupOverrides). Reutiliza
  // getRealTeamsByDivision (instancias reales de Team/Player ya
  // reconstruidas, nunca datos planos en la UI — CLAUDE.md, "Interfaz de
  // juego").
  function getAllRealTeamsForMatchupTarget() {
    return ['1ª', '2ª'].flatMap((div) => getRealTeamsByDivision(div));
  }

  // TAC-4 (7.12.32, sub-pestaña Defensa): capa de presentación pura sobre
  // `team.tacticalProfile.defensiveScheme`/`matchupOverrides` — igual que
  // el resto de esta pantalla, no decide ninguna regla táctica propia.
  function renderTacticsDefenseTab(team) {
    const profile = team.tacticalProfile;
    const scheme = profile.defensiveScheme;

    const baseSchemeOptionsHtml = BM.BASE_SCHEMES.map((s) => `
      <option value="${s}" ${scheme.baseScheme === s ? 'selected' : ''}>${BASE_SCHEME_LABELS[s] || s}</option>`).join('');
    const pressTypeOptionsHtml = BM.PRESS_TYPES.map((t) => `
      <option value="${t}" ${scheme.press.type === t ? 'selected' : ''}>${PRESS_TYPE_LABELS[t] || t}</option>`).join('');
    const postRuleOptionsHtml = BM.POST_DOUBLE_TEAM_RULES.map((r) => `
      <option value="${r}" ${scheme.postDoubleTeamRule === r ? 'selected' : ''}>${POST_DOUBLE_TEAM_RULE_LABELS[r] || r}</option>`).join('');

    const convocated = getConvocatedPlayers(team);
    const defenderOptionsHtml = convocated.map((p) => `<option value="${p.id}">${p.fullName}</option>`).join('');
    const rivalTeams = getAllRealTeamsForMatchupTarget();
    const rivalOptionsHtml = rivalTeams
      .filter((rivalTeam) => rivalTeam.id !== team.id)
      .map((rivalTeam) => `<optgroup label="${rivalTeam.name}">${
        rivalTeam.roster.map((p) => `<option value="${p.id}">${p.fullName}</option>`).join('')
      }</optgroup>`).join('');

    const playerNameById = (id) => {
      const own = team.roster.find((p) => p.id === id);
      if (own) return own.fullName;
      const rival = rivalTeams.flatMap((t) => t.roster).find((p) => p.id === id);
      return rival ? rival.fullName : id;
    };

    const overridesHtml = Object.keys(profile.matchupOverrides).length === 0
      ? '<p class="gm-muted">Sin matchups declarados.</p>'
      : `<ul class="tactics-matchup-list">${
        Object.entries(profile.matchupOverrides).map(([defenderId, targetId]) => `
          <li>${playerNameById(defenderId)} marca a ${playerNameById(targetId)}
            <button class="tactics-matchup-remove-btn" data-defender-id="${defenderId}" type="button">Quitar</button>
          </li>`).join('')
      }</ul>`;

    return `
      <div class="gm-card">
        <h3>Esquema defensivo base</h3>
        <select id="tactics-base-scheme-select">${baseSchemeOptionsHtml}</select>
        <p class="gm-muted">Hombre a hombre es la referencia principal. Una zona nunca da un +X%/-X% de tiro directo: cambia la vulnerabilidad real según el spacing del rival (se estira y sufre contra un quinteto con tiradores de verdad, se contrae sin coste contra uno sin amenaza exterior real) y, en menor medida, según el play-type que intente el rival (Post Up castiga más una 2-3, Pick &amp; Roll/Isolation explotan más una 1-3-1). Match-up Zone y Box-and-One quedan fuera de esta entrega.</p>
      </div>
      <div class="gm-card">
        <h3>Press</h3>
        <label class="tactics-press-toggle"><input type="checkbox" id="tactics-press-active-checkbox" ${scheme.press.active ? 'checked' : ''}> Presionar el tramo inicial de la posesión rival</label>
        <select id="tactics-press-type-select">${pressTypeOptionsHtml}</select>
        <p class="gm-muted">Sube la probabilidad de pérdida temprana del rival y el tiempo que tarda en cruzar medio campo — castiga más a manejadores de balón débiles. El desgaste físico extra de presionar no está modelado todavía.</p>
      </div>
      <div class="gm-card">
        <h3>Doble equipo de poste</h3>
        <select id="tactics-post-double-team-select">${postRuleOptionsHtml}</select>
        <p class="gm-muted">Quién dobla lo decide el rol defensivo de cada jugador (pestaña Roles) — el ayudante más cercano (Low Man/Nail Helper/Roamer). El propio anotador posteado decide si encuentra el hueco según su Visión de Juego y Pase.</p>
      </div>
      <div class="gm-card">
        <h3>Matchups individuales</h3>
        <p class="gm-muted">Asigna a un defensor propio la marca fija de un jugador rival concreto — tiene prioridad sobre la elección automática del motor para ese jugador, salvo que una cobertura o rotación (Switch, doble equipo...) obligue temporalmente a otra. Se declara por jugador real: solo tiene efecto los partidos en los que ese rival concreto aparezca en pista.</p>
        ${overridesHtml}
        <div class="tactics-matchup-form">
          <select id="tactics-matchup-defender-select"><option value="">Mi defensor…</option>${defenderOptionsHtml}</select>
          <select id="tactics-matchup-target-select"><option value="">Jugador rival…</option>${rivalOptionsHtml}</select>
          <button id="tactics-matchup-add-btn" type="button">Añadir matchup</button>
        </div>
      </div>`;
  }

  // --- DESIGN.md 7.12.24/7.12.32 (TAC-5): sub-pestaña Situaciones ---
  // Reglas de Auto Timeouts, prioridad de jugadas ATO/BLOB/SLOB/Late
  // Clock/Last Possession y reglas de falta táctica intencionada — TODAS
  // viven en `team.tacticalProfile.situations` (persistente, "GamePlan
  // base" que cita 7.12.32), mismo patrón de mutación directa que el
  // resto de sub-pestañas (Defensa, por ejemplo). Un GamePlan de partido
  // concreto puede sobreescribir SOLO `preferredPlays` para ese partido
  // (ver Tactics.GamePlan/effectiveTacticalProfile), nunca desde aquí.
  const SITUATION_TYPE_LABELS = {
    ATO: 'ATO (tras tiempo muerto)',
    BLOB: 'BLOB (saque de fondo)',
    SLOB: 'SLOB (saque de banda)',
    lateClock: 'Late Clock (pocos segundos de posesión)',
    lastPossession: 'Last Possession (última posesión)',
  };

  function renderTacticsSituationsTab(team) {
    const { situations } = team.tacticalProfile;

    const preferredPlaysHtml = BM.SITUATION_TYPES.map((situationType) => {
      const candidates = BM.PLAY_DEFINITIONS.filter((p) => p.situationType === situationType);
      const current = situations.preferredPlays[situationType] || '';
      const optionsHtml = candidates.map((p) => `
        <option value="${p.id}" ${current === p.id ? 'selected' : ''}>${p.name}</option>`).join('');
      return `
        <label class="tactics-situational-play">
          ${SITUATION_TYPE_LABELS[situationType] || situationType}
          <select class="tactics-situational-play-select" data-situation-type="${situationType}">
            <option value="">Elegir automáticamente</option>
            ${optionsHtml}
          </select>
        </label>`;
    }).join('');

    return `
      <div class="gm-card">
        <h3>Auto Timeouts</h3>
        <label class="tactics-press-toggle">
          <input type="checkbox" id="tactics-auto-timeouts-checkbox" ${situations.autoTimeouts.enabled ? 'checked' : ''}>
          Pedir tiempo muerto automáticamente si el rival mete un parcial (${BM.CONFIG_BASE.match.timeouts.autoTriggerRunPoints}-0 sin respuesta)
        </label>
        <p class="gm-muted">Con esta opción activada, el asistente pide el tiempo muerto por ti en la primera parada de juego disponible — sin abrir la ventana de intervención. Un tiempo muerto NUNCA aplica un bonus mágico de acierto ni resetea la racha del rival (7.12.24); solo habilita los ajustes que verías igualmente si lo pidieras a mano.</p>
      </div>
      <div class="gm-card">
        <h3>Falta táctica intencionada</h3>
        <label class="tactics-press-toggle">
          <input type="checkbox" id="tactics-tactical-foul-checkbox" ${situations.tacticalFoul.enabled ? 'checked' : ''}>
          Activar falta táctica intencionada en el último cuarto/prórroga
        </label>
        <label>Margen de puntos (perdiendo por esto o menos)
          <input type="number" id="tactics-tactical-foul-margin-input" min="1" max="30" value="${situations.tacticalFoul.marginPoints}">
        </label>
        <label>Segundos restantes de partido
          <input type="number" id="tactics-tactical-foul-seconds-input" min="1" max="120" value="${situations.tacticalFoul.secondsRemaining}">
        </label>
        <p class="gm-muted">El objetivo es siempre el rival en pista con peor Tiro Libre; el jugador propio con 4 faltas personales nunca comete la falta si hay alternativa. La CPU usa exactamente esta misma regla cuando la tiene activada.</p>
      </div>
      <div class="gm-card">
        <h3>Jugadas preparadas — ATO/BLOB/SLOB/Late Clock/Last Possession</h3>
        <p class="gm-muted">Jugada preferida del catálogo situacional para cada caso (7.12.24) — sin garantía de tiro concreto, su eficacia depende de los jugadores y la cobertura rival. "Elegir automáticamente" sortea entre el catálogo disponible, igual que el resto del playbook.</p>
        ${preferredPlaysHtml}
      </div>`;
  }

  const TACTICS_TABS = [
    { id: 'summary', label: 'Resumen' },
    { id: 'attack', label: 'Ataque' },
    { id: 'roles', label: 'Roles' },
    { id: 'playbook', label: 'Playbook' },
    { id: 'defense', label: 'Defensa' },
    { id: 'situations', label: 'Situaciones' },
  ];

  function renderTacticsScreen() {
    const container = byId('gm-tactics');
    const team = getUserTeam();
    if (!team) { container.innerHTML = ''; return; }
    const activeTab = container.dataset.activeTab || 'summary';

    let body = '';
    if (activeTab === 'summary') body = renderTacticsSummaryTab(team);
    else if (activeTab === 'attack') body = renderTacticsAttackTab(team);
    else if (activeTab === 'roles') body = renderTacticsRolesTab(team);
    else if (activeTab === 'playbook') body = renderTacticsPlaybookTab();
    else if (activeTab === 'defense') body = renderTacticsDefenseTab(team);
    else if (activeTab === 'situations') body = renderTacticsSituationsTab(team);

    container.innerHTML = `
      <h2>Tácticas</h2>
      <div class="tabs">
        ${TACTICS_TABS.map((t) => `<button class="tabs__btn ${t.id === activeTab ? 'is-active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="tabs__body">${body}</div>
    `;

    container.querySelectorAll('.tabs__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.dataset.activeTab = btn.dataset.tab;
        renderTacticsScreen();
      });
    });

    if (activeTab === 'attack') {
      const spacingSelect = byId('tactics-spacing-select');
      if (spacingSelect) {
        spacingSelect.addEventListener('change', () => {
          team.tacticalProfile.spacing = spacingSelect.value;
          renderTacticsScreen();
        });
      }
      // 'input' (cada pulsación del slider): solo refresca la etiqueta
      // numérica en vivo, igual que el patrón ya usado en la pantalla de
      // Alineación para los minutos de cada slot. 'change' (al soltar el
      // slider): sí muta `team.tacticalProfile` y renderiza entero (para
      // que Resumen/Roles reflejen el nuevo valor si el usuario vuelve).
      container.querySelectorAll('.tactics-identity-input').forEach((el) => {
        el.addEventListener('input', () => {
          const valueEl = el.parentElement.querySelector('.tactics-slider-value');
          if (valueEl) valueEl.textContent = el.value;
        });
        el.addEventListener('change', () => {
          team.tacticalProfile.identity[el.dataset.key] = Number(el.value);
          renderTacticsScreen();
        });
      });
      container.querySelectorAll('.tactics-playtype-input').forEach((el) => {
        el.addEventListener('input', () => {
          const valueEl = el.parentElement.querySelector('.tactics-slider-value');
          if (valueEl) valueEl.textContent = el.value;
        });
        el.addEventListener('change', () => {
          team.tacticalProfile.playTypeWeights[el.dataset.key] = Number(el.value);
          renderTacticsScreen();
        });
      });
    }

    if (activeTab === 'roles') {
      container.querySelectorAll('.tactics-role-select').forEach((el) => {
        el.addEventListener('change', () => {
          const { playerId, side } = el.dataset;
          const assignments = team.tacticalProfile.roleAssignments;
          const entry = { ...(assignments[playerId] || {}) };
          const field = side === 'offensive' ? 'offensiveRole' : 'defensiveRole';
          if (el.value) entry[field] = el.value; else delete entry[field];
          if (Object.keys(entry).length === 0) delete assignments[playerId];
          else assignments[playerId] = entry;
          renderTacticsScreen();
        });
      });
    }

    // TAC-4 (7.12.32, sub-pestaña Defensa): mutación directa de
    // `team.tacticalProfile.defensiveScheme`/`matchupOverrides` — mismo
    // patrón que la pestaña Ataque (sin re-validación al mutar, solo el
    // constructor de TacticalProfile valida el catálogo).
    if (activeTab === 'defense') {
      const baseSchemeSelect = byId('tactics-base-scheme-select');
      if (baseSchemeSelect) {
        baseSchemeSelect.addEventListener('change', () => {
          team.tacticalProfile.defensiveScheme.baseScheme = baseSchemeSelect.value;
          renderTacticsScreen();
        });
      }
      const pressActiveCheckbox = byId('tactics-press-active-checkbox');
      if (pressActiveCheckbox) {
        pressActiveCheckbox.addEventListener('change', () => {
          team.tacticalProfile.defensiveScheme.press.active = pressActiveCheckbox.checked;
          renderTacticsScreen();
        });
      }
      const pressTypeSelect = byId('tactics-press-type-select');
      if (pressTypeSelect) {
        pressTypeSelect.addEventListener('change', () => {
          team.tacticalProfile.defensiveScheme.press.type = pressTypeSelect.value;
          renderTacticsScreen();
        });
      }
      const postDoubleTeamSelect = byId('tactics-post-double-team-select');
      if (postDoubleTeamSelect) {
        postDoubleTeamSelect.addEventListener('change', () => {
          team.tacticalProfile.defensiveScheme.postDoubleTeamRule = postDoubleTeamSelect.value;
          renderTacticsScreen();
        });
      }
      const addMatchupBtn = byId('tactics-matchup-add-btn');
      if (addMatchupBtn) {
        addMatchupBtn.addEventListener('click', () => {
          const defenderId = byId('tactics-matchup-defender-select').value;
          const targetId = byId('tactics-matchup-target-select').value;
          if (!defenderId || !targetId) return;
          team.tacticalProfile.matchupOverrides[defenderId] = targetId;
          renderTacticsScreen();
        });
      }
      container.querySelectorAll('.tactics-matchup-remove-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          delete team.tacticalProfile.matchupOverrides[btn.dataset.defenderId];
          renderTacticsScreen();
        });
      });
    }

    if (activeTab === 'situations') {
      const autoTimeoutsCheckbox = byId('tactics-auto-timeouts-checkbox');
      if (autoTimeoutsCheckbox) {
        autoTimeoutsCheckbox.addEventListener('change', () => {
          team.tacticalProfile.situations.autoTimeouts.enabled = autoTimeoutsCheckbox.checked;
          renderTacticsScreen();
        });
      }
      const tacticalFoulCheckbox = byId('tactics-tactical-foul-checkbox');
      if (tacticalFoulCheckbox) {
        tacticalFoulCheckbox.addEventListener('change', () => {
          team.tacticalProfile.situations.tacticalFoul.enabled = tacticalFoulCheckbox.checked;
          renderTacticsScreen();
        });
      }
      const marginInput = byId('tactics-tactical-foul-margin-input');
      if (marginInput) {
        marginInput.addEventListener('change', () => {
          team.tacticalProfile.situations.tacticalFoul.marginPoints = Number(marginInput.value);
          renderTacticsScreen();
        });
      }
      const secondsInput = byId('tactics-tactical-foul-seconds-input');
      if (secondsInput) {
        secondsInput.addEventListener('change', () => {
          team.tacticalProfile.situations.tacticalFoul.secondsRemaining = Number(secondsInput.value);
          renderTacticsScreen();
        });
      }
      container.querySelectorAll('.tactics-situational-play-select').forEach((select) => {
        select.addEventListener('change', () => {
          const { situationType } = select.dataset;
          if (select.value) team.tacticalProfile.situations.preferredPlays[situationType] = select.value;
          else delete team.tacticalProfile.situations.preferredPlays[situationType];
          renderTacticsScreen();
        });
      });
    }
  }

  // Construye el `{ homeSquad/awaySquad, homeLineup/awayLineup }` de
  // MatchEngine solo para el LADO del equipo del usuario, reenviando
  // `undefined` para el resto — así el rival (u otros partidos de la
  // jornada/bracket) siguen exactamente igual que hasta ahora.
  function buildUserSideOptions(team) {
    const squad = team.buildMatchSquad(state.lineup.squadIds);
    const lineup = {
      entries: state.lineup.entries,
      fixedSegments: state.lineup.fixedSegments,
      garbageTime: state.lineup.garbageTime,
    };
    return { squad, lineup };
  }

  // Construye la alineación real de un equipo CPU para UN partido concreto
  // (DESIGN.md 7.11.7) — cierra el hueco que dejaba explícitamente 7.11.5:
  // sin esto, cualquier lado del partido que no fuera el equipo del usuario
  // caía en `selectOnCourtFive` (sin reparto de minutos por jugador), así
  // que Recovery.js nunca podía actualizar su `lastMatchDate`. `opponent`
  // es siempre el OTRO equipo del partido, desde la perspectiva de `team`
  // (cada lado calcula su propia importancia de partido, pueden diferir).
  // `competition`: 'league' evalúa objetivo de temporada/clasificación;
  // cualquier otro valor ('bracket', usado abajo) es siempre clave. `league`
  // (DESIGN.md 3.4.1): la de la división de ESE partido — la visible o la
  // de fondo, nunca asumida como "state.league" a secas (ya no existe).
  function buildCpuSideOptions(team, opponent, competition, league) {
    const { buildCpuLineup, computeMatchImportance, CONFIG_BASE } = BM;
    const standingsTable = league.getStandingsTable();
    const matchImportance = computeMatchImportance(team, opponent, competition, standingsTable, CONFIG_BASE);
    return buildCpuLineup(team, matchImportance, CONFIG_BASE);
  }

  // Resolver de opciones de MatchEngine compartido por CUALQUIER partido
  // de CUALQUIER división (DESIGN.md 3.4.1) — punto único, no uno para la
  // liga visible y otro para la de fondo. `userTeam` (opcional): si se
  // pasa, ESE lado usa siempre la alineación guardada por el usuario
  // (`state.lineup`); cualquier otro lado (el rival directo, cualquier
  // otro partido de la misma jornada/bracket, o AMBOS lados si `userTeam`
  // se omite — la división de fondo, que el usuario no juega) usa
  // `CpuLineup.buildCpuLineup` (DESIGN.md 7.11.7). resolveMatchOptions
  // tiene el shape que espera League.simulateNextRound(match);
  // resolveBracketOptions, el que espera Bracket.playNextGame(homeEntry, awayEntry).
  function buildMatchOptionsResolver(league, userTeam) {
    const userSide = userTeam ? buildUserSideOptions(userTeam) : null;

    function sideOptions(sideTeam, opponentTeam, isHome, competition) {
      if (userSide && sideTeam.id === userTeam.id) {
        return isHome
          ? { homeSquad: userSide.squad, homeLineup: userSide.lineup }
          : { awaySquad: userSide.squad, awayLineup: userSide.lineup };
      }
      const cpu = buildCpuSideOptions(sideTeam, opponentTeam, competition, league);
      return isHome ? { homeSquad: cpu.squad, homeLineup: cpu.lineup } : { awaySquad: cpu.squad, awayLineup: cpu.lineup };
    }

    return {
      resolveMatchOptions(match) {
        return {
          ...sideOptions(match.homeTeam, match.awayTeam, true, 'league'),
          ...sideOptions(match.awayTeam, match.homeTeam, false, 'league'),
        };
      },
      resolveBracketOptions(homeEntry, awayEntry) {
        return {
          ...sideOptions(homeEntry.team, awayEntry.team, true, 'bracket'),
          ...sideOptions(awayEntry.team, homeEntry.team, false, 'bracket'),
        };
      },
    };
  }

  // Resolver para la división visible: el lado de `team` (equipo del
  // usuario) usa su alineación guardada, cualquier otro lado usa CPU.
  function buildLineupMatchOptionsResolver(team) {
    return buildMatchOptionsResolver(getUserLeague(), team);
  }

  // Resolver para la división de fondo (simulateBackgroundRound): AMBOS
  // lados de CUALQUIER partido usan CpuLineup — el usuario no juega esta
  // división, así que no hay ningún `userTeam` que preservar.
  function buildCpuOnlyResolver(league) {
    return buildMatchOptionsResolver(league, null);
  }

  function playNextMatchWithLineup(team) {
    if (!getLineupValidity(team).valid) return; // el botón ya está deshabilitado; defensa extra
    const activeBracket = getActiveBracket();
    const resolvers = buildLineupMatchOptionsResolver(team);

    if (activeBracket) {
      // DESIGN.md 7.12.24 (TAC-5): decisión de encaje explícita — los
      // partidos de Copa/Playoff/Ascenso siguen resolviéndose de golpe
      // (Bracket.js/Playoffs.js/Cup.js/Promotion.js no se tocan en esta
      // entrega) y revelándose por cuartos como ANTES de esta entrega
      // (`renderMatchScreen` modo 'replay' más abajo) — el motor
      // REALMENTE pausable de esta entrega se expone solo para el partido
      // de liga del usuario (el flujo con más volumen de juego). Ampliar
      // esto a bracket es trabajo pendiente señalado explícitamente
      // (CHANGELOG de esta entrega), no un olvido.
      playBracketGameWithReveal(activeBracket.bracket, resolvers.resolveBracketOptions);
      return;
    }

    startUserLeagueMatch(team, resolvers.resolveMatchOptions);
  }

  // --- DESIGN.md 7.12.24/7.12.33 (TAC-5): partido de liga del usuario
  // jugado de verdad sobre el motor pausable (MatchEngine.createMatchState/
  // advanceMatch), con ventanas de intervención reales entre cuartos y en
  // cada tiempo muerto disparado — sustituye al "reveal" cosmético de
  // antes de esta entrega (que solo reproducía un resultado ya calculado
  // de antemano por League.simulateNextRound()). ---
  //
  // `league.getCurrentRoundMatches()` es una consulta pura (no avanza
  // `currentRound` ni muta nada, ver League.js) — se usa aquí para saber
  // SI el equipo del usuario juega esta jornada y contra quién ANTES de
  // pedirle a League.js que resuelva la jornada, sin tocar League.js.
  function startUserLeagueMatch(team, resolveMatchOptions) {
    const league = getUserLeague();
    if (league.isSeasonComplete) return;
    const roundMatches = league.getCurrentRoundMatches();
    const userMatch = roundMatches.find((m) => m.homeTeam.id === team.id || m.awayTeam.id === team.id);

    if (!userMatch) {
      // Jornada con nº impar de equipos: el equipo del usuario descansa.
      // Comportamiento idéntico al de antes de esta entrega — toda la
      // jornada se resuelve de golpe, sin pantalla de partido.
      simulateNextRound(resolveMatchOptions);
      goToScreen(state.pendingUserMatch ? 'match' : 'home');
      return;
    }

    const engineOptions = resolveMatchOptions(userMatch) || {};
    startLiveMatch(userMatch.homeTeam, userMatch.awayTeam, engineOptions, (finalResult) => {
      finishUserLeagueMatch(league, userMatch, finalResult, resolveMatchOptions);
    });
    goToScreen('match');
  }

  // Encaje con League.js (sin tocarlo): el partido del usuario YA se ha
  // simulado de verdad, posesión a posesión, con las ventanas de
  // intervención que el usuario haya usado — `options.precomputedResult`
  // (MatchEngine.simulateMatch, ver comentario allí) hace que
  // League.simulateNextRound() REUTILICE ese resultado exacto para ESE
  // partido en vez de volver a simularlo (que generaría un partido
  // DISTINTO, con otra secuencia aleatoria, y rompería la coherencia entre
  // lo que el usuario vio y lo que cuenta para la clasificación). El resto
  // de partidos de la jornada se resuelven de golpe, igual que siempre.
  function finishUserLeagueMatch(league, userMatch, finalResult, resolveMatchOptions) {
    state.seasonCloseSummary = null;
    const matches = league.simulateNextRound(undefined, (match) => {
      if (match === userMatch) return { precomputedResult: finalResult };
      return resolveMatchOptions(match);
    });
    finishRoundBookkeeping(matches, state.division, league);
  }

  // --- Motor de partido en vivo (TAC-5): envoltorio mínimo de
  // MatchEngine.createMatchState/advanceMatch para la pantalla de
  // partido. `engineOptions`: mismo shape que ya aceptaba
  // MatchEngine.simulateMatch (homeSquad/homeLineup/homeTacticalProfile,
  // etc.) — se le añade aquí un GamePlan de partido inicial (sin
  // overrides todavía, 7.12.23) para cada lado, así que la ventana de
  // intervención siempre tiene un GamePlan real que mutar en vez de tener
  // que crear uno la primera vez que el usuario toca algo.
  function startLiveMatch(homeTeam, awayTeam, engineOptions, onFinished) {
    const options = {
      ...engineOptions,
      homeGamePlan: engineOptions.homeGamePlan || new BM.GamePlan(homeTeam.tacticalProfile),
      awayGamePlan: engineOptions.awayGamePlan || new BM.GamePlan(awayTeam.tacticalProfile),
    };
    const matchState = BM.createMatchState(homeTeam, awayTeam, BM.CONFIG_BASE, options);
    state.matchReveal = {
      mode: 'live',
      matchState,
      stoppedReason: null,
      homeTeam,
      awayTeam,
      onFinished,
    };
    advanceLiveMatch();
  }

  // Avanza el partido en vivo hasta la siguiente ventana de intervención
  // real (fin de cuarto o tiempo muerto disparado) o hasta el final —
  // `Auto Timeouts` (7.12.24, sub-pestaña Situaciones) se lee de
  // `TacticalProfile.situations.autoTimeouts.enabled` de cada equipo en
  // el momento de avanzar (no una vez al principio), así que un cambio en
  // la pestaña Situaciones ya se refleja en la siguiente llamada.
  function advanceLiveMatch() {
    const reveal = state.matchReveal;
    if (!reveal || reveal.mode !== 'live' || reveal.matchState.phase === 'finished') return;
    const { matchState, homeTeam, awayTeam } = reveal;
    const autoTimeouts = {
      home: homeTeam.tacticalProfile.situations.autoTimeouts.enabled,
      away: awayTeam.tacticalProfile.situations.autoTimeouts.enabled,
    };
    const { stoppedReason } = BM.advanceMatch(matchState, { stopAt: 'timeoutTrigger', autoTimeouts });
    reveal.stoppedReason = stoppedReason;
    if (stoppedReason === 'matchEnd' && reveal.onFinished) {
      reveal.onFinished(BM.buildMatchResult(matchState));
    }
  }

  // ---------------------------------------------------------------------
  // Navegación entre pantallas
  // ---------------------------------------------------------------------
  const SCREENS = ['team-select', 'home', 'lineup', 'tactics', 'calendar', 'competitions', 'stats', 'match'];

  function goToScreen(screen) {
    state.screen = screen;
    SCREENS.forEach((s) => {
      byId(`gm-screen-${s}`).classList.toggle('is-active', s === screen);
    });
    byId('gm-nav').classList.toggle('is-hidden', screen === 'team-select');
    byId('gm-nav').querySelectorAll('.gm-nav__btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.screen === screen);
    });

    if (screen === 'home') renderHomeScreen();
    if (screen === 'lineup') renderLineupScreen();
    if (screen === 'tactics') renderTacticsScreen();
    if (screen === 'calendar') renderCalendarScreen();
    if (screen === 'competitions') renderCompetitionsScreen();
    if (screen === 'stats') renderStatsScreen();
    if (screen === 'match') {
      // DESIGN.md 7.12.24 (TAC-5): el modo 'live' (partido de liga del
      // usuario sobre el motor pausable) ya deja `state.matchReveal`
      // preparado ANTES de navegar aquí (ver startLiveMatch) — este
      // guardia solo arranca el modo 'replay' de siempre (partidos de
      // bracket, ya resueltos de golpe por Bracket.js/Playoffs.js/etc.,
      // sin tocar esos archivos en esta entrega).
      const isLiveReveal = state.matchReveal && state.matchReveal.mode === 'live';
      if (!isLiveReveal && state.pendingUserMatch
        && (!state.matchReveal || state.matchReveal.match !== state.pendingUserMatch)) {
        startReplayMatchReveal(state.pendingUserMatch);
      }
      renderMatchScreen();
    }
  }

  function init() {
    byId('gm-nav').querySelectorAll('.gm-nav__btn').forEach((btn) => {
      btn.addEventListener('click', () => goToScreen(btn.dataset.screen));
    });
    byId('gm-back-to-team-select').addEventListener('click', () => {
      state.leagues = { '1ª': null, '2ª': null };
      state.brackets = { '1ª': { cup: null, titlePlayoff: null }, '2ª': { promotionPlayoff: null } };
      state.userTeamId = null;
      goToScreen('team-select');
    });
    renderTeamSelectScreen();
  }

  // ---------------------------------------------------------------------
  // Pantalla: simulación de partido.
  //
  // DESIGN.md 7.12.24 (TAC-5): dos modos de revelado, ver
  // `state.matchReveal.mode`:
  //
  // - 'live' (partido de LIGA del usuario, el camino nuevo de esta
  //   entrega): el motor (MatchEngine.createMatchState/advanceMatch) SÍ
  //   pausa de verdad entre cuartos y en cada tiempo muerto disparado —
  //   startLiveMatch()/advanceLiveMatch() (más arriba) ya dejan
  //   `state.matchReveal` listo antes de entrar a esta pantalla.
  // - 'replay' (partidos de Copa/Playoff/Ascenso, decisión de encaje
  //   señalada explícitamente en playNextMatchWithLineup): el motor
  //   resuelve el partido entero de una vez (Bracket.js/Playoffs.js/
  //   Cup.js/Promotion.js, sin tocar) y esta pantalla solo va revelando,
  //   cuarto a cuarto, los datos ya calculados en match.result.
  //   quarterScores — comportamiento idéntico al de antes de esta
  //   entrega.
  // ---------------------------------------------------------------------
  function startReplayMatchReveal(match) {
    const result = match.result;
    const totalPeriods = result.quarterScores.home.length; // incluye prórrogas si las hubo
    state.matchReveal = {
      mode: 'replay',
      match,
      period: 0, // nº de períodos ya revelados
      totalPeriods,
    };
  }

  function currentReplayScore() {
    const { match, period } = state.matchReveal;
    const qs = match.result.quarterScores;
    let home = 0; let away = 0;
    for (let i = 0; i < period; i++) { home += qs.home[i]; away += qs.away[i]; }
    return { home, away };
  }

  function periodLabel(index, totalRegularQuarters) {
    if (index < totalRegularQuarters) return `C${index + 1}`;
    return `P${index - totalRegularQuarters + 1}`;
  }

  // `line.minutesPlayed`/`line.valoracion`/`line.plusMinus` pueden faltar
  // en partidos guardados ANTES de la sesión de retoques de estadísticas
  // (manejo defensivo, ver CHANGELOG.md).
  function renderTeamBoxScore(lines) {
    const sorted = [...lines].sort((a, b) => b.points - a.points);
    const rows = sorted.map((line) => {
      const fg = line.fieldGoals;
      const madeAttempted = (obj) => `${obj.made}/${obj.attempted}`;
      const plusMinus = line.plusMinus ?? 0;
      const plusMinusClass = plusMinus > 0 ? 'is-plus' : (plusMinus < 0 ? 'is-minus' : '');
      const plusMinusLabel = `${plusMinus > 0 ? '+' : ''}${plusMinus}`;
      return `
        <tr>
          <td>${line.name}</td>
          <td>${formatMinutesSingle(line.minutesPlayed ?? null)}</td>
          <td>${line.points}</td>
          <td>${madeAttempted(fg.threePointShot)}</td>
          <td>${madeAttempted(fg.midRangeShot)}</td>
          <td>${madeAttempted(fg.insideShot)}</td>
          <td>${madeAttempted(fg.layup)}</td>
          <td>${madeAttempted(line.freeThrows)}</td>
          <td>${line.reboundsOffensive + line.reboundsDefensive}</td>
          <td>${line.steals}</td>
          <td>${line.blocks}</td>
          <td>${line.turnovers}</td>
          <td>${line.personalFouls}</td>
          <td>${line.valoracion ?? '—'}</td>
          <td class="boxscore-plusminus ${plusMinusClass}">${plusMinusLabel}</td>
        </tr>`;
    }).join('');
    return `
      <table class="gm-table gm-table--boxscore">
        <thead>
          <tr>
            <th>Jugador</th><th>Min</th><th>Pts</th><th>T3</th><th>T2m</th><th>TI</th><th>Band</th><th>TL</th>
            <th>Reb</th><th>Rob</th><th>Tap</th><th>Pér</th><th>F</th><th>Val</th><th>+/-</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderMatchScreen() {
    const container = byId('gm-match');
    const reveal = state.matchReveal;

    if (!reveal) {
      // Sin partido pendiente de revelar: pantalla de espera, con acceso
      // directo a jugar la siguiente jornada si el usuario llega aquí
      // navegando manualmente en vez de desde la pantalla de inicio.
      container.innerHTML = `
        <div class="gm-card gm-match-empty">
          <p>No hay ningún partido en curso.</p>
          <p class="gm-muted">Juega la siguiente jornada desde Inicio para ver aquí tu partido.</p>
        </div>`;
      return;
    }

    if (reveal.mode === 'live') { renderLiveMatchScreen(container, reveal); return; }
    renderReplayMatchScreen(container, reveal);
  }

  function renderPeriodChips(quarterScoresHome, quarterScoresAway, revealedCount, totalPeriods, totalRegularQuarters) {
    const chips = [];
    for (let i = 0; i < totalPeriods; i += 1) {
      const revealed = i < revealedCount;
      chips.push(`
        <div class="period-chip ${revealed ? 'is-revealed' : ''}">
          <span class="period-chip__label">${periodLabel(i, totalRegularQuarters)}</span>
          <span class="period-chip__score">${revealed ? `${quarterScoresHome[i]}-${quarterScoresAway[i]}` : '–'}</span>
        </div>`);
    }
    return chips.join('');
  }

  // Modo 'replay' (Copa/Playoff/Ascenso, ver comentario del bloque
  // anterior) — comportamiento idéntico al de antes de esta entrega.
  function renderReplayMatchScreen(container, reveal) {
    const { match } = reveal;
    const result = match.result;
    const totalRegularQuarters = 4; // DESIGN.md 7.1: FIBA/ACB, 4 cuartos siempre
    const score = currentReplayScore();
    const isFullyRevealed = reveal.period >= reveal.totalPeriods;

    const periodChipsHtml = renderPeriodChips(result.quarterScores.home, result.quarterScores.away, reveal.period, reveal.totalPeriods, totalRegularQuarters);

    const overtimeNote = isFullyRevealed && result.wentToOvertime
      ? `<p class="gm-muted">Partido resuelto en prórroga (${result.overtimePeriods}).</p>` : '';

    const boxScoreSection = isFullyRevealed ? `
      <div class="boxscore-grid">
        <div>
          <h3>${match.homeTeam.fullName}</h3>
          ${renderTeamBoxScore(result.boxScore.home)}
        </div>
        <div>
          <h3>${match.awayTeam.fullName}</h3>
          ${renderTeamBoxScore(result.boxScore.away)}
        </div>
      </div>
      <div class="gm-card team-totals">
        ${renderTeamTotals(result, match)}
      </div>
    ` : '<p class="gm-muted">El resumen de estadísticas por jugador aparece al terminar el partido.</p>';

    const advanceBtnLabel = isFullyRevealed ? 'Volver a Inicio' : 'Siguiente cuarto ▸';

    container.innerHTML = `
      <div class="scoreboard">
        <div class="scoreboard__team">
          <span class="scoreboard__name">${match.homeTeam.name}</span>
          <span class="scoreboard__score">${score.home}</span>
        </div>
        <div class="scoreboard__vs">—</div>
        <div class="scoreboard__team">
          <span class="scoreboard__score">${score.away}</span>
          <span class="scoreboard__name">${match.awayTeam.name}</span>
        </div>
      </div>
      <div class="period-chips">${periodChipsHtml}</div>
      ${overtimeNote}
      <button id="gm-advance-match-btn" class="gm-btn gm-btn--primary">${advanceBtnLabel}</button>
      ${boxScoreSection}
    `;

    byId('gm-advance-match-btn').addEventListener('click', () => {
      if (isFullyRevealed) {
        state.matchReveal = null;
        state.pendingUserMatch = null;
        goToScreen('home');
        return;
      }
      reveal.period = Math.min(reveal.period + 1, reveal.totalPeriods);
      renderMatchScreen();
    });
  }

  const STOPPED_REASON_LABELS = {
    quarterEnd: 'Descanso entre cuartos',
    timeoutTrigger: 'Tiempo muerto',
    possession: 'Pausa',
  };

  // Modo 'live' (TAC-5): partido de liga del usuario sobre el motor
  // REALMENTE pausable — la ventana de intervención (7.12.24) se muestra
  // siempre que `matchState.phase !== 'finished'` (el motor ya se ha
  // detenido de verdad en fin de cuarto o en un tiempo muerto disparado,
  // no hay nada más que revelar de golpe). El reveal sigue mostrándose
  // por cuartos/eventos destacados, nunca posesión a posesión (7.12.24:
  // "no convierte el juego en narración jugada a jugada").
  function renderLiveMatchScreen(container, reveal) {
    const { matchState, homeTeam, awayTeam } = reveal;
    const config = BM.CONFIG_BASE;
    const totalRegularQuarters = config.match.quarters;
    const isFinished = matchState.phase === 'finished';
    const result = BM.buildMatchResult(matchState);

    const score = matchState.runningScore;
    const revealedPeriods = matchState.quarterScores.home.length;
    const totalPeriodsSoFar = isFinished ? revealedPeriods : Math.max(revealedPeriods, matchState.period);
    const periodChipsHtml = renderPeriodChips(matchState.quarterScores.home, matchState.quarterScores.away, revealedPeriods, totalPeriodsSoFar, totalRegularQuarters);

    const overtimeNote = isFinished && result.wentToOvertime
      ? `<p class="gm-muted">Partido resuelto en prórroga (${result.overtimePeriods}).</p>` : '';

    const boxScoreSection = isFinished ? `
      <div class="boxscore-grid">
        <div>
          <h3>${homeTeam.fullName}</h3>
          ${renderTeamBoxScore(result.boxScore.home)}
        </div>
        <div>
          <h3>${awayTeam.fullName}</h3>
          ${renderTeamBoxScore(result.boxScore.away)}
        </div>
      </div>
      <div class="gm-card team-totals">
        ${renderTeamTotals(result, { homeTeam, awayTeam })}
      </div>
    ` : '<p class="gm-muted">El resumen de estadísticas por jugador aparece al terminar el partido.</p>';

    const advanceBtnLabel = isFinished ? 'Volver a Inicio' : (matchState.period >= totalRegularQuarters ? 'Continuar ▸' : 'Siguiente cuarto ▸');

    const interventionHtml = isFinished ? '' : renderMatchInterventionPanel(reveal);

    container.innerHTML = `
      <div class="scoreboard">
        <div class="scoreboard__team">
          <span class="scoreboard__name">${homeTeam.name}</span>
          <span class="scoreboard__score">${score.home}</span>
        </div>
        <div class="scoreboard__vs">—</div>
        <div class="scoreboard__team">
          <span class="scoreboard__score">${score.away}</span>
          <span class="scoreboard__name">${awayTeam.name}</span>
        </div>
      </div>
      <div class="period-chips">${periodChipsHtml}</div>
      ${overtimeNote}
      ${interventionHtml}
      <button id="gm-advance-match-btn" class="gm-btn gm-btn--primary">${advanceBtnLabel}</button>
      ${boxScoreSection}
    `;

    byId('gm-advance-match-btn').addEventListener('click', () => {
      if (isFinished) {
        state.matchReveal = null;
        state.pendingUserMatch = null;
        goToScreen('home');
        return;
      }
      advanceLiveMatch();
      renderMatchScreen();
    });

    wireMatchInterventionPanel(container, reveal);
  }

  // Ventana de intervención real (DESIGN.md 7.12.24): resumen agregado
  // hasta este instante + ajustes disponibles del GamePlan (7.12.23) del
  // equipo del usuario + pedir tiempo muerto — SOLO el lado del usuario
  // tiene controles (el rival, gestionado por CPU, usa Auto
  // Timeouts/falta táctica igual que cualquier equipo, sin pantalla).
  function renderMatchInterventionPanel(reveal) {
    const { matchState, homeTeam, awayTeam, stoppedReason } = reveal;
    const userTeam = getUserTeam();
    const userSide = userTeam && userTeam.id === homeTeam.id ? 'home' : (userTeam && userTeam.id === awayTeam.id ? 'away' : null);
    const reasonLabel = STOPPED_REASON_LABELS[stoppedReason] || 'Pausa';
    let reasonDetail = '';
    if (stoppedReason === 'timeoutTrigger' && matchState.lastTimeoutSide) {
      const teamName = matchState.lastTimeoutSide === 'home' ? homeTeam.name : awayTeam.name;
      const reasonWord = matchState.lastTimeoutReason === 'auto' ? 'automático (Auto Timeouts)' : 'solicitado';
      reasonDetail = ` — ${teamName}, ${reasonWord}`;
    }

    if (!userSide) {
      return `<div class="gm-card intervention-panel"><p class="gm-muted">${reasonLabel}${reasonDetail}.</p></div>`;
    }

    const userGamePlan = userSide === 'home' ? matchState.homeGamePlan : matchState.awayGamePlan;
    const canTimeout = BM.canCallTimeout(matchState, userSide);
    const coverageOptionsHtml = BM.PNR_COVERAGES.map((c) => `
      <option value="${c}" ${userGamePlan.pnrCoverage === c ? 'selected' : ''}>${PNR_COVERAGE_LABELS[c] || c}</option>`).join('');

    return `
      <div class="gm-card intervention-panel">
        <h3>${reasonLabel}${reasonDetail}</h3>
        <p class="gm-muted">Ajustes de GamePlan para este partido — se descartan al terminar salvo que los guardes como táctica base.</p>
        <div class="intervention-panel__controls">
          <label>Cobertura de P&amp;R
            <select id="intervention-coverage-select">${coverageOptionsHtml}</select>
          </label>
          <label>Peso de Isolation
            <input type="range" id="intervention-isolation-input" min="0" max="100" value="${userGamePlan.playTypeWeights.isolation}">
            <span class="tactics-slider-value">${userGamePlan.playTypeWeights.isolation}</span>
          </label>
        </div>
        <div class="intervention-panel__actions">
          <button id="intervention-timeout-btn" type="button" class="gm-btn" ${canTimeout ? '' : 'disabled'}>Pedir tiempo muerto</button>
          <button id="intervention-save-gameplan-btn" type="button" class="gm-btn">Guardar cambios como táctica base</button>
        </div>
      </div>`;
  }

  function wireMatchInterventionPanel(container, reveal) {
    const { matchState, homeTeam, awayTeam } = reveal;
    const userTeam = getUserTeam();
    const userSide = userTeam && userTeam.id === homeTeam.id ? 'home' : (userTeam && userTeam.id === awayTeam.id ? 'away' : null);
    if (!userSide) return;
    const userGamePlan = userSide === 'home' ? matchState.homeGamePlan : matchState.awayGamePlan;

    const coverageSelect = byId('intervention-coverage-select');
    if (coverageSelect) {
      coverageSelect.addEventListener('change', () => {
        userGamePlan.pnrCoverage = coverageSelect.value;
      });
    }
    const isolationInput = byId('intervention-isolation-input');
    if (isolationInput) {
      isolationInput.addEventListener('input', () => {
        const valueEl = isolationInput.parentElement.querySelector('.tactics-slider-value');
        if (valueEl) valueEl.textContent = isolationInput.value;
      });
      isolationInput.addEventListener('change', () => {
        userGamePlan.playTypeWeights.isolation = Number(isolationInput.value);
      });
    }
    const timeoutBtn = byId('intervention-timeout-btn');
    if (timeoutBtn) {
      timeoutBtn.addEventListener('click', () => {
        BM.requestTimeoutNow(matchState, userSide);
        renderMatchScreen();
      });
    }
    const saveGamePlanBtn = byId('intervention-save-gameplan-btn');
    if (saveGamePlanBtn) {
      saveGamePlanBtn.addEventListener('click', () => {
        BM.applyGamePlanToProfile(userTeam.tacticalProfile, userGamePlan);
        renderMatchScreen();
      });
    }
  }

  // `?? 0` en sumLines: manejo defensivo para partidos guardados ANTES de
  // la sesión de retoques de estadísticas (assists/valoracion no
  // existían todavía en esas líneas de boxScore).
  function renderTeamTotals(result, match) {
    const sumLines = (lines, key) => lines.reduce((acc, l) => acc + (l[key] ?? 0), 0);
    const row = (label, homeVal, awayVal) => `
      <tr><td>${homeVal}</td><td class="team-totals__label">${label}</td><td>${awayVal}</td></tr>`;
    const home = result.boxScore.home;
    const away = result.boxScore.away;

    // Made/attempted de un grupo de tipos de tiro (T2 = midRange+inside+
    // layup, T3 = solo threePointShot) sumado de todas las líneas del
    // equipo.
    function sumFieldGoalGroup(lines, shotTypes) {
      return lines.reduce((acc, line) => {
        shotTypes.forEach((shotType) => {
          acc.made += line.fieldGoals[shotType].made;
          acc.attempted += line.fieldGoals[shotType].attempted;
        });
        return acc;
      }, { made: 0, attempted: 0 });
    }
    function sumFreeThrows(lines) {
      return lines.reduce((acc, line) => {
        acc.made += line.freeThrows.made;
        acc.attempted += line.freeThrows.attempted;
        return acc;
      }, { made: 0, attempted: 0 });
    }
    function formatShotLine({ made, attempted }) {
      if (attempted === 0) return '0/0 (—)';
      return `${made}/${attempted} (${Math.round((made / attempted) * 100)}%)`;
    }

    const home2 = sumFieldGoalGroup(home, ['midRangeShot', 'insideShot', 'layup']);
    const away2 = sumFieldGoalGroup(away, ['midRangeShot', 'insideShot', 'layup']);
    const home3 = sumFieldGoalGroup(home, ['threePointShot']);
    const away3 = sumFieldGoalGroup(away, ['threePointShot']);
    const homeFt = sumFreeThrows(home);
    const awayFt = sumFreeThrows(away);

    return `
      <table class="gm-table gm-table--totals">
        <thead><tr><th>${match.homeTeam.name}</th><th></th><th>${match.awayTeam.name}</th></tr></thead>
        <tbody>
          ${row('Puntos', result.finalScore.home, result.finalScore.away)}
          ${row('Posesiones', result.possessionCount.home, result.possessionCount.away)}
          ${row('Rebotes ofensivos', sumLines(home, 'reboundsOffensive'), sumLines(away, 'reboundsOffensive'))}
          ${row('Rebotes defensivos', sumLines(home, 'reboundsDefensive'), sumLines(away, 'reboundsDefensive'))}
          ${row('Rebotes totales', sumLines(home, 'reboundsOffensive') + sumLines(home, 'reboundsDefensive'), sumLines(away, 'reboundsOffensive') + sumLines(away, 'reboundsDefensive'))}
          ${row('T2', formatShotLine(home2), formatShotLine(away2))}
          ${row('T3', formatShotLine(home3), formatShotLine(away3))}
          ${row('TL', formatShotLine(homeFt), formatShotLine(awayFt))}
          ${row('Asistencias', sumLines(home, 'assists'), sumLines(away, 'assists'))}
          ${row('Robos', sumLines(home, 'steals'), sumLines(away, 'steals'))}
          ${row('Tapones', sumLines(home, 'blocks'), sumLines(away, 'blocks'))}
          ${row('Pérdidas', sumLines(home, 'turnovers'), sumLines(away, 'turnovers'))}
          ${row('Valoración', sumLines(home, 'valoracion'), sumLines(away, 'valoracion'))}
        </tbody>
      </table>`;
  }

  global.BasketManagerGame = {
    state, init, goToScreen, getUserTeam, simulateNextRound, startSeason,
  };
})(typeof window !== 'undefined' ? window : globalThis);
