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
//  - El partido del equipo del usuario en cada jornada se ve en una
//    pantalla de simulación con revelado progresivo por cuartos (el motor
//    no tiene punto de entrada por cuartos — MatchEngine.simulateMatch()
//    es monolítico, ver DESIGN.md 7.1 — así que se simula el partido
//    completo de una vez y la INTERFAZ revela quarterScores progresivamente,
//    no el motor).

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
    league: null, // instancia de League (1ª o 2ª según el equipo elegido)
    titlePlayoff: null, // Bracket | null (1ª división, tras jornada 34)
    cup: null, // Bracket | null (Copa, se crea automáticamente en jornada 17→18)
    promotionPlayoff: null, // PromotionPlayoff | null (2ª división, tras jornada 34)
    lastRoundMatches: null, // partidos de la última jornada simulada (para pantalla de inicio)
    pendingUserMatch: null, // { match } — partido del usuario de la jornada recién simulada, pendiente de revelar en pantalla de partido
    matchReveal: null, // estado de revelado progresivo por cuartos de la pantalla de partido
    statsCompetition: 'league', // 'league' | 'cup' | 'playoffs' — selector de la pantalla de estadísticas
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
    const { League, Calendar, CONFIG_BASE } = BM;
    const teams = getRealTeamsByDivision(division);
    state.division = division;
    state.userTeamId = teamId;
    state.seasonStartYear = new Date().getFullYear();
    state.calendar = new Calendar(state.seasonStartYear, CONFIG_BASE);
    state.league = new League(teams, (round) => state.calendar.leagueRoundDate(round));
    state.titlePlayoff = null;
    state.cup = null;
    state.promotionPlayoff = null;
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
    if (!state.league || !state.userTeamId) return null;
    return state.league.teams.find((t) => t.id === state.userTeamId) || null;
  }

  // ---------------------------------------------------------------------
  // Cierre de integración de Recovery.js (DESIGN.md 7.11.5): tras resolver
  // CUALQUIER partido de cualquiera de las 4 competiciones, aplica la
  // recuperación de Energía pendiente de cada jugador que jugó minutos, y
  // registra la fecha de este partido como su nuevo `lastMatchDate`.
  //
  // LIMITACIÓN REAL señalada explícitamente (no un olvido): `result.rotation`
  // (de dónde sale qué jugador jugó cuántos minutos) solo existe cuando ESE
  // lado del partido tuvo una alineación real (`options.home/awayLineup` a
  // MatchEngine.simulateMatch) — ver MatchEngine.js. Hoy
  // buildLineupMatchOptionsResolver() solo construye esa alineación para el
  // EQUIPO DEL USUARIO, nunca para el rival ni para el resto de partidos de
  // la jornada (equipos IA). Por tanto, esta integración solo puede
  // actualizar `lastMatchDate`/aplicar recuperación al equipo del usuario
  // cuando ha configurado alineación — el resto de la liga (los otros 17
  // equipos) no tiene manera de saber quién jugó cuántos minutos todavía,
  // así que sencillamente no se les toca nada (no se inventa un reparto de
  // minutos "quinteto titular fijo" ni parecido, que no pidió esta tarea).
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
  // `resolveMatchOptions` (opcional, DESIGN.md 7.11.6): callback que recibe
  // el `match` de liga y devuelve las `options` de MatchEngine para el
  // equipo del usuario si le toca jugar esta jornada — ver
  // buildLineupMatchOptionsResolver() más abajo. Sin argumento, la jornada
  // se juega exactamente igual que hasta ahora (sin alineación real).
  function simulateNextRound(resolveMatchOptions) {
    const {
      createTitlePlayoff, createCup, PromotionPlayoff, CUP_TRIGGER_ROUND,
      TITLE_PLAYOFF_ROUND_PATTERNS, PROMOTION_ROUND_PATTERNS,
    } = BM;
    const league = state.league;
    if (league.isSeasonComplete) return;

    const matches = league.simulateNextRound(undefined, resolveMatchOptions);
    state.lastRoundMatches = matches;

    // DESIGN.md 7.11.5 (cierre de integración): recuperación de Energía
    // para cada partido de la jornada recién jugada (no solo el del
    // usuario) — ver limitación real explicada arriba.
    matches.forEach((match) => {
      applyRecoveryForResolvedMatch(match.homeTeam, match.awayTeam, match.result, match.date);
    });

    // Copa: se dispara automáticamente justo al completar la jornada 17,
    // solo en 1ª división (DESIGN.md 3.2.2) — createCup() exige el valor
    // EXACTO de currentRound, así que solo puede llamarse aquí, en el
    // instante justo tras jugarla.
    if (state.division === '1ª' && league.currentRound === CUP_TRIGGER_ROUND + 1 && !state.cup) {
      const cupDates = state.calendar ? state.calendar.cupRoundDates() : undefined;
      state.cup = createCup(league, cupDates);
    }

    if (league.isSeasonComplete) {
      // DESIGN.md 3.3.3: startDate del playoff = fecha de la última jornada
      // de ESTA liga (1ª o 2ª, la que corresponda) + el hueco configurado —
      // "independiente" de la otra división simplemente porque cada una
      // calcula la suya a partir de SU PROPIO calendario, nunca del ajeno.
      const playoffStartDate = state.calendar
        ? state.calendar.titlePlayoffStartDate(state.calendar.leagueRoundDate(league.totalRounds))
        : undefined;
      if (state.division === '1ª') {
        const dateResolver = state.calendar
          ? state.calendar.buildBracketDateResolver(playoffStartDate, TITLE_PLAYOFF_ROUND_PATTERNS)
          : undefined;
        state.titlePlayoff = createTitlePlayoff(league, dateResolver);
      } else {
        const dateResolver = state.calendar
          ? state.calendar.buildBracketDateResolver(playoffStartDate, PROMOTION_ROUND_PATTERNS)
          : undefined;
        state.promotionPlayoff = new PromotionPlayoff(league, dateResolver);
      }
    }

    // Partido del equipo del usuario en esta jornada, si lo tenía —
    // se guarda para revelarlo en la pantalla de partido (progresivo por
    // cuartos), en vez de mostrar el resultado ya hecho en el calendario.
    const userMatch = matches.find(
      (m) => m.homeTeam.id === state.userTeamId || m.awayTeam.id === state.userTeamId,
    );
    state.pendingUserMatch = userMatch || null;

    // El avance partido a partido de Copa/Playoffs/Ascenso, una vez
    // creados, lo dispara el botón principal de Home (getActiveBracket()),
    // no esta función — aquí solo se crean en el instante justo.
  }

  // ---------------------------------------------------------------------
  // Bracket activo (Copa / Playoff por el título / Playoff de ascenso):
  // mientras haya uno sin terminar, manda sobre la liga regular en el
  // botón principal de Home — "el partido que toca ahora". Prioridad fija:
  // Copa > Playoff por el título (1ª) > Playoff de ascenso (2ª); null si
  // no hay ninguno activo (la liga regular manda, comportamiento normal).
  // ---------------------------------------------------------------------
  function getActiveBracketRoundLabel(bracket, labels) {
    const status = bracket.getStatus();
    const roundIndex = Math.min(status.rounds.length - 1, labels.length - 1);
    return labels[roundIndex] || `Ronda ${status.rounds.length}`;
  }

  function getActiveBracket() {
    if (state.cup && !state.cup.isComplete) {
      return {
        title: 'Copa',
        roundLabel: getActiveBracketRoundLabel(state.cup, ['Cuartos de final', 'Semifinales', 'Final']),
        bracket: state.cup,
      };
    }
    if (state.titlePlayoff && !state.titlePlayoff.isComplete) {
      return {
        title: 'Playoff por el título',
        roundLabel: getActiveBracketRoundLabel(state.titlePlayoff, ['Cuartos de final', 'Semifinales', 'Final']),
        bracket: state.titlePlayoff,
      };
    }
    if (state.promotionPlayoff && !state.promotionPlayoff.isComplete) {
      const promo = state.promotionPlayoff;
      let roundLabel = 'Cuartos de ascenso';
      if (promo.isQuarterFinalsComplete) {
        promo.ensureFinalFour();
        roundLabel = getActiveBracketRoundLabel(promo.finalFour, ['Semifinales (Final Four)', 'Final (Final Four)']);
      }
      return { title: 'Playoff de ascenso', roundLabel, bracket: promo };
    }
    return null;
  }

  // Puente entre el shape de Bracket/PromotionPlayoff.playNextGame()
  // ({ gameNumber, homeEntry, awayEntry, result }) y el shape que espera
  // startMatchReveal()/renderMatchScreen() ({ homeTeam, awayTeam, result }),
  // igual que ya se hace con state.pendingUserMatch para partidos de liga
  // — así todo partido de bracket se revela cuarto a cuarto igual que uno
  // de liga, sin tocar Bracket.js/Cup.js/Playoffs.js/Promotion.js.
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
    const league = state.league;
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

    // Mientras haya un bracket (Copa/Playoff/Ascenso) activo y sin
    // terminar, la tarjeta principal de Home se convierte en "el partido
    // que toca ahora" de ese bracket, en vez de la jornada de liga —
    // el usuario no tiene que ir a Competiciones a buscarlo.
    const primaryCardHtml = activeBracket
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

        <div class="gm-card">
          <h3>Última jornada</h3>
          ${lastResultHtml}
        </div>
      </div>
    `;

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
        simulateNextRound(buildLineupMatchOptionsResolver(team).resolveMatchOptions);
        if (state.pendingUserMatch) {
          goToScreen('match');
        } else {
          renderHomeScreen();
        }
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
    const league = state.league;
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
    const league = state.league;
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
      body = state.cup
        ? bracketHtml(state.cup.getStatus(), ['Cuartos de final', 'Semifinales', 'Final'])
        : '<p class="gm-muted">La Copa se disputa al llegar a la jornada 17 de liga regular. Todavía no se ha alcanzado.</p>';
      if (state.cup && !state.cup.isComplete) {
        body += `<button id="gm-advance-cup-btn" class="gm-btn">Jugar siguiente partido de la Copa</button>`;
      }
    } else if (activeTab === 'playoffs') {
      body = state.titlePlayoff
        ? bracketHtml(state.titlePlayoff.getStatus(), ['Cuartos de final', 'Semifinales', 'Final'])
        : '<p class="gm-muted">El playoff por el título se disputa al terminar la liga regular (jornada 34).</p>';
      if (state.titlePlayoff && !state.titlePlayoff.isComplete) {
        body += `<button id="gm-advance-playoff-btn" class="gm-btn">Jugar siguiente partido del playoff</button>`;
      }
    } else if (activeTab === 'promotion') {
      if (!state.promotionPlayoff) {
        body = '<p class="gm-muted">El playoff de ascenso se disputa al terminar la liga regular (jornada 34).</p>';
      } else {
        const status = state.promotionPlayoff.getStatus();
        body = `<p class="gm-champion">Asciende directo: ${status.directPromotion.team.fullName}</p>`
          + bracketHtml(status.quarterFinals, ['Cuartos de ascenso (mejor de 5)'])
          + (status.finalFour ? bracketHtml(status.finalFour, ['Semifinales (Final Four)', 'Final (Final Four)']) : '<p class="gm-muted">La Final Four se arma al completar los cuartos.</p>')
          + (status.secondPromotedEntry ? `<p class="gm-champion">🏀 2º ascendido: ${status.secondPromotedEntry.team.fullName}</p>` : '');
        if (!state.promotionPlayoff.isComplete) {
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
    if (cupBtn) cupBtn.addEventListener('click', () => advanceBracket(state.cup));

    const playoffBtn = byId('gm-advance-playoff-btn');
    if (playoffBtn) playoffBtn.addEventListener('click', () => advanceBracket(state.titlePlayoff));

    const promoBtn = byId('gm-advance-promotion-btn');
    if (promoBtn) promoBtn.addEventListener('click', () => advanceBracket(state.promotionPlayoff));
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

    function addLine(line, teamName) {
      const existing = totals.get(line.playerId) || {
        name: line.name,
        team: teamName,
        games: 0,
        points: 0,
        reboundsOffensive: 0,
        reboundsDefensive: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
      };
      existing.games += 1;
      existing.points += line.points;
      existing.reboundsOffensive += line.reboundsOffensive;
      existing.reboundsDefensive += line.reboundsDefensive;
      existing.steals += line.steals;
      existing.blocks += line.blocks;
      existing.turnovers += line.turnovers;
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

  // Los brackets (Copa/Playoffs/Ascenso) guardan sus partidos jugados
  // dentro de cada Series.games, no expuestos por getStatus() — se leen
  // directamente de la instancia del Bracket, no del status plano.
  function getBracketPlayedMatches(bracket) {
    if (!bracket) return [];
    return bracket.rounds.flatMap((round) => round.flatMap((series) => series.games.map((g) => ({
      homeTeam: g.homeEntry.team, awayTeam: g.awayEntry.team, result: g.result,
    }))));
  }

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

    let playedMatches = [];
    if (competition === 'league') playedMatches = state.league.schedule.filter((m) => m.status === 'played');
    else if (competition === 'cup') playedMatches = getBracketPlayedMatches(state.cup);
    else if (competition === 'playoffs') playedMatches = getBracketPlayedMatches(state.titlePlayoff);
    else if (competition === 'promotion') {
      playedMatches = state.promotionPlayoff
        ? [...getBracketPlayedMatches(state.promotionPlayoff.quarterFinals), ...getBracketPlayedMatches(state.promotionPlayoff.finalFour)]
        : [];
    }

    const playerStats = aggregatePlayerStats(playedMatches)
      .sort((a, b) => b.points - a.points)
      .slice(0, 30);

    const rows = playerStats.map((p) => `
      <tr>
        <td>${p.name}</td>
        <td>${p.team}</td>
        <td>${p.games}</td>
        <td>${(p.points / p.games).toFixed(1)}</td>
        <td>${((p.reboundsOffensive + p.reboundsDefensive) / p.games).toFixed(1)}</td>
        <td>${(p.steals / p.games).toFixed(1)}</td>
        <td>${(p.blocks / p.games).toFixed(1)}</td>
        <td>${(p.turnovers / p.games).toFixed(1)}</td>
      </tr>`).join('');

    const body = playerStats.length
      ? `<table class="gm-table">
          <thead><tr><th>Jugador</th><th>Equipo</th><th>PJ</th><th>Pts</th><th>Reb</th><th>Rob</th><th>Tap</th><th>Pér</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : '<p class="gm-muted">Todavía no hay partidos jugados en esta competición.</p>';

    container.innerHTML = `
      <div class="tabs">
        ${tabsAvailable.map((t) => `<button class="tabs__btn ${t.id === competition ? 'is-active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <p class="gm-muted gm-stats-note">Medias por partido, ordenadas por puntos. Top 30.</p>
      <div class="tabs__body">${body}</div>
    `;

    container.querySelectorAll('.tabs__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.statsCompetition = btn.dataset.tab;
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
        const nextMatches = state.league.isSeasonComplete ? [] : state.league.getCurrentRoundMatches();
        const userNextMatch = nextMatches.find((m) => m.homeTeam.id === team.id || m.awayTeam.id === team.id);
        return state.league.isSeasonComplete
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

  // Construye, a partir de la última alineación guardada por el usuario
  // (state.lineup), los dos resolvers de opciones de MatchEngine para su
  // lado del partido — punto único compartido por Home, la pantalla de
  // Alineación y los botones de bracket, para no duplicar esta lógica
  // (DESIGN.md 7.11.6). resolveMatchOptions tiene el shape que espera
  // League.simulateNextRound(match); resolveBracketOptions, el que espera
  // Bracket.playNextGame(homeEntry, awayEntry).
  function buildLineupMatchOptionsResolver(team) {
    const { squad, lineup } = buildUserSideOptions(team);
    return {
      resolveMatchOptions(match) {
        if (match.homeTeam.id === team.id) return { homeSquad: squad, homeLineup: lineup };
        if (match.awayTeam.id === team.id) return { awaySquad: squad, awayLineup: lineup };
        return undefined;
      },
      resolveBracketOptions(homeEntry, awayEntry) {
        if (homeEntry.team.id === team.id) return { homeSquad: squad, homeLineup: lineup };
        if (awayEntry.team.id === team.id) return { awaySquad: squad, awayLineup: lineup };
        return undefined;
      },
    };
  }

  function playNextMatchWithLineup(team) {
    if (!getLineupValidity(team).valid) return; // el botón ya está deshabilitado; defensa extra
    const activeBracket = getActiveBracket();
    const resolvers = buildLineupMatchOptionsResolver(team);

    if (activeBracket) {
      playBracketGameWithReveal(activeBracket.bracket, resolvers.resolveBracketOptions);
      return;
    }

    simulateNextRound(resolvers.resolveMatchOptions);
    if (state.pendingUserMatch) {
      goToScreen('match');
    } else {
      goToScreen('home');
    }
  }

  // ---------------------------------------------------------------------
  // Navegación entre pantallas
  // ---------------------------------------------------------------------
  const SCREENS = ['team-select', 'home', 'lineup', 'calendar', 'competitions', 'stats', 'match'];

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
    if (screen === 'calendar') renderCalendarScreen();
    if (screen === 'competitions') renderCompetitionsScreen();
    if (screen === 'stats') renderStatsScreen();
    if (screen === 'match') {
      if (state.pendingUserMatch && (!state.matchReveal || state.matchReveal.match !== state.pendingUserMatch)) {
        startMatchReveal(state.pendingUserMatch);
      }
      renderMatchScreen();
    }
  }

  function init() {
    byId('gm-nav').querySelectorAll('.gm-nav__btn').forEach((btn) => {
      btn.addEventListener('click', () => goToScreen(btn.dataset.screen));
    });
    byId('gm-back-to-team-select').addEventListener('click', () => {
      state.league = null;
      state.userTeamId = null;
      goToScreen('team-select');
    });
    renderTeamSelectScreen();
  }

  // ---------------------------------------------------------------------
  // Pantalla: simulación de partido — revelado progresivo por cuartos.
  // El motor (MatchEngine.simulateMatch) resuelve el partido entero de una
  // vez (no tiene punto de entrada por cuartos, ver DESIGN.md 7.1); esta
  // pantalla NO simula nada por su cuenta — solo va revelando, cuarto a
  // cuarto, los datos ya calculados en match.result.quarterScores. El
  // boxScore final (por jugador) solo se muestra al llegar al último
  // período disponible.
  // ---------------------------------------------------------------------
  function startMatchReveal(match) {
    const result = match.result;
    const totalPeriods = result.quarterScores.home.length; // incluye prórrogas si las hubo
    state.matchReveal = {
      match,
      period: 0, // nº de períodos ya revelados
      totalPeriods,
    };
  }

  function currentRevealScore() {
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

  function renderTeamBoxScore(lines) {
    const sorted = [...lines].sort((a, b) => b.points - a.points);
    const rows = sorted.map((line) => {
      const fg = line.fieldGoals;
      const madeAttempted = (obj) => `${obj.made}/${obj.attempted}`;
      return `
        <tr>
          <td>${line.name}</td>
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
        </tr>`;
    }).join('');
    return `
      <table class="gm-table gm-table--boxscore">
        <thead>
          <tr>
            <th>Jugador</th><th>Pts</th><th>T3</th><th>T2m</th><th>TI</th><th>Band</th><th>TL</th>
            <th>Reb</th><th>Rob</th><th>Tap</th><th>Pér</th><th>F</th>
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

    const { match } = reveal;
    const result = match.result;
    const totalRegularQuarters = 4; // DESIGN.md 7.1: FIBA/ACB, 4 cuartos siempre
    const score = currentRevealScore();
    const isFullyRevealed = reveal.period >= reveal.totalPeriods;

    const periodChips = [];
    for (let i = 0; i < reveal.totalPeriods; i++) {
      const revealed = i < reveal.period;
      periodChips.push(`
        <div class="period-chip ${revealed ? 'is-revealed' : ''}">
          <span class="period-chip__label">${periodLabel(i, totalRegularQuarters)}</span>
          <span class="period-chip__score">${revealed ? `${result.quarterScores.home[i]}-${result.quarterScores.away[i]}` : '–'}</span>
        </div>`);
    }

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
      <div class="period-chips">${periodChips.join('')}</div>
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

  function renderTeamTotals(result, match) {
    const sumLines = (lines, key) => lines.reduce((acc, l) => acc + l[key], 0);
    const row = (label, homeVal, awayVal) => `
      <tr><td>${homeVal}</td><td class="team-totals__label">${label}</td><td>${awayVal}</td></tr>`;
    const home = result.boxScore.home;
    const away = result.boxScore.away;
    return `
      <table class="gm-table gm-table--totals">
        <thead><tr><th>${match.homeTeam.name}</th><th></th><th>${match.awayTeam.name}</th></tr></thead>
        <tbody>
          ${row('Puntos', result.finalScore.home, result.finalScore.away)}
          ${row('Posesiones', result.possessionCount.home, result.possessionCount.away)}
          ${row('Rebotes', sumLines(home, 'reboundsOffensive') + sumLines(home, 'reboundsDefensive'), sumLines(away, 'reboundsOffensive') + sumLines(away, 'reboundsDefensive'))}
          ${row('Robos', sumLines(home, 'steals'), sumLines(away, 'steals'))}
          ${row('Tapones', sumLines(home, 'blocks'), sumLines(away, 'blocks'))}
          ${row('Pérdidas', sumLines(home, 'turnovers'), sumLines(away, 'turnovers'))}
        </tbody>
      </table>`;
  }

  global.BasketManagerGame = {
    state, init, goToScreen, getUserTeam, simulateNextRound, startSeason,
  };
})(typeof window !== 'undefined' ? window : globalThis);
