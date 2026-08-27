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
    screen: 'team-select', // 'team-select' | 'home' | 'lineup' | 'agenda' | 'news' | 'calendar' | 'competitions' | 'stats' | 'match'
    division: '1ª',
    userTeamId: null,
    // ROSTER-1 (DESIGN.md 9.16): instancia EXPLÍCITA del registro mundial
    // de jugadores de ESTA partida — `null` hasta `startSeason()` (nunca
    // un singleton global oculto: cada partida nueva construye la suya).
    // `Team.roster` sigue siendo la afiliación deportiva actual; este
    // registro es quien permite encontrar a un jugador aunque no esté en
    // ninguna plantilla (ficha universal, LIFE-4/BUG-LIFE4-03).
    playerRegistry: null,
    // CONTRACT-1 (DESIGN.md 9.17): instancia EXPLÍCITA del registro
    // CONTRACTUAL de ESTA partida — `null` hasta `startSeason()`, nunca un
    // singleton global oculto. Es la fuente CANÓNICA de contratos: ni
    // `Player` ni `Team` guardan una copia (`currentContract` duplicado) y
    // la nómina de la interfaz es siempre una consulta derivada de aquí.
    contractRegistry: null,
    // Warnings del bootstrap de contratos (calibración económica, fuentes
    // normativas provisionales) — se muestran en la pantalla Contratos, no
    // se esconden.
    contractBootstrapWarnings: [],
    // REG-1 (DESIGN.md 9.18): instancia EXPLÍCITA del registro de
    // inscripciones/licencias de ESTA partida — declarada aquí junto al
    // resto del estado canónico (BUG-REG1-06: antes se creaba de forma
    // dinámica solo en bootstrapRegistrationsForNewCareer() y nunca se
    // limpiaba al volver a selección de equipo, así que una carrera nueva
    // con el mismo playerId/competición/temporada podía heredar estado de
    // la anterior).
    registrationRegistry: null,
    registrationBootstrapWarnings: [],
    // BUG-REG1-06: caché de clasificación formación/no-comunitario por
    // CARRERA — antes se creaba perezosa y accidentalmente desde el
    // primer renderizador que la necesitara (RegulatoryClassificationService
    // consultado desde Alineación/Inscripciones/ficha), nunca declarada ni
    // limpiada, así que podía sobrevivir a un cambio de carrera y devolver
    // una clasificación calculada para OTRO perfil regulatorio si
    // coincidían playerId+competición+temporada+versión. Ahora se declara
    // aquí y se crea/limpia siempre junto al resto del registro
    // regulatorio (bootstrapRegistrationsForNewCareer() / "volver a
    // selección de equipo").
    registrationClassificationCache: null,
    // MARKET-1 (DESIGN.md 9.19): mismo principio aplicado desde el
    // principio a los registros nuevos de mercado — instancias EXPLÍCITAS
    // por carrera, nunca un singleton oculto, limpiadas junto al resto del
    // estado regulatorio/contractual al volver a selección de equipo.
    agentRegistry: null,
    marketRegistry: null,
    marketBootstrapWarnings: [],
    // Agenda de mercado (respuestas de interés, expiración de ofertas, fin
    // de autorización, ventanas de derechos, decisión de igualar...) — no
    // es reconstruible desde otro estado ya vivo (a diferencia de un
    // partido de liga/bracket), así que sigue el mismo patrón de
    // persistencia que `medicalAgendaLog` (ver buildAgendaEvents()).
    marketAgendaLog: [],
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
    // CAL-2 (DESIGN.md 3.5): fuente ÚNICA de eventos de tipo 'news',
    // consumida tanto por la pantalla Noticias (feed completo) como por el
    // resumen de alta prioridad de Home — se añade incrementalmente en
    // cada punto real de resolución (nunca se recalcula desde cero). Los
    // eventos de Agenda de tipo 'match'/'competition' NO se guardan aquí
    // — se derivan bajo demanda de `league.schedule`/brackets en cada
    // render (ver buildAgendaEvents()), porque son siempre reconstruibles
    // sin pérdida de información a partir del estado real ya existente;
    // las noticias de tipo 'standings'/'streak' sí necesitan una
    // comparación antes/después que solo existe en el instante en que
    // ocurre el hecho, por eso ESAS se registran aquí en cuanto pasan.
    newsLog: [],
    // LIFE-3 (DESIGN.md 9.14, sección 30): eventos de Agenda tipo
    // 'medical' (lesión/alta) — misma razón de persistencia que
    // `newsLog`, pero separado porque `renderNewsScreen()` ya asume que
    // `newsLog` contiene SOLO `type:'news'`.
    medicalAgendaLog: [],
    // CAL-2: fecha desde la que se centra la vista de Agenda — `null` usa
    // el reloj de mundo actual (siempre vuelve a "Hoy" al reabrir Agenda
    // tras avanzar con Continuar, no se queda anclada a donde se dejó).
    agendaAnchorDate: null,
    lastRoundMatches: null, // partidos de la última jornada simulada (para pantalla de inicio)
    pendingUserMatch: null, // { match } — partido del usuario de la jornada recién simulada, pendiente de revelar en pantalla de partido
    matchReveal: null, // estado de revelado progresivo por cuartos de la pantalla de partido
    statsCompetition: 'league', // 'league' | 'cup' | 'playoffs' — selector de la pantalla de estadísticas
    statsSortKey: 'points', // columna activa de ordenación en la tabla de medias (retoques de estadísticas)
    // DESIGN.md 7.12.25/7.12.32 (TAC-7): equipo elegido manualmente en el
    // selector de la sub-pestaña Rival — `null` deja que
    // renderTacticsRivalTab() elija automáticamente el próximo rival de
    // liga (getNextLeagueOpponent()) cuando se conoce.
    tacticsRivalTeamId: null,
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
    // LIFE-4 (DESIGN.md 9.15, sección 27/28): ficha universal de jugador —
    // pantalla CONTEXTUAL, nunca la pantalla "actual" en el sentido de
    // `state.screen`/SCREENS (no tiene botón propio en #gm-nav). `null`
    // cuando no hay ficha abierta. `returnScreen` es la única pieza de
    // estado que openPlayerProfile() necesita para volver — el resto del
    // estado de cada pantalla (sub-pestaña activa, convocatoria, plan de
    // entrenamiento, orden/filtro de Estadísticas...) ya vive de forma
    // duradera en su propio sitio (state.statsSortKey, team.trainingPlan,
    // container.dataset.activeTab...) y sobrevive por sí solo a navegar
    // aquí y volver, sin que esta pantalla tenga que restaurarlo.
    playerProfile: null, // { playerId, returnScreen, returnSubscreen, activeTab, developmentAttribute }
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
  // LIFE-4 (DESIGN.md 9.15, sección 17): "2026-27", nunca "Temporada 1" —
  // derivado del año real de inicio de la partida en curso (o del año de
  // la máquina en el instante de la llamada, para las tarjetas de
  // previsualización de selección de equipo, ANTES de que exista partida).
  function buildCareerSeasonKey() {
    return BM.seasonKeyFromStartYear(state.seasonStartYear || new Date().getFullYear());
  }

  // REG-1 (DESIGN.md 9.18): traduce la `competitionKey` de `getActiveBracket()`
  // ('cup'/'playoff'/'promotion') al `phaseId` usado por los RuleModule de
  // inscripción (ver CompetitionRules.js, `acb-playoff-window`) — único
  // punto de traducción, nunca repetido.
  const BRACKET_PHASE_IDS = { cup: 'cup', playoff: 'title-playoff', promotion: 'promotion' };

  // Identificador ESTABLE equivalente a `matchId` (sección 6.2 del prompt
  // de REG-1: "matchId o identificador estable equivalente") — los
  // partidos de `League.js` no llevan un `id` propio; ronda+enfrentamiento
  // ya es único dentro de una temporada/división.
  function matchStableId(match) {
    return `league:${match.round}:${match.homeTeam.id}:${match.awayTeam.id}`;
  }

  // ROSTER-1 (DESIGN.md 9.16) + REG-1 (DESIGN.md 9.18, BUG-CONTRACT1-02):
  // resuelve el `competitionId` real de una división legacy ('1ª'/'2ª') y
  // construye el CONTEXTO EXPLÍCITO de competición/ámbito/fecha/jornada
  // que exige `CompetitionRules.resolveRules()` — ÚNICO punto de game.js
  // que debe tocar el adaptador legacy `team.division` para esto, nunca
  // repetido a mano en otro sitio, y NUNCA leyendo `state.calendar.
  // currentGameDateTime` por su cuenta: la fecha SIEMPRE llega como
  // parámetro explícito de quien conoce el partido concreto.
  //
  // `options.phaseId`: 'league' | 'cup' | 'title-playoff' | 'promotion' —
  // ACB comparte el mismo `registrationScopeId` en las tres fases (Copa y
  // Playoff por el título se juegan bajo las mismas Normas Internas ACB,
  // declarado como DATO en el bundle, nunca deducido aquí); Primera FEB
  // usa su propio ámbito para liga + Playoff de ascenso.
  function buildMatchCompetitionContext(team, options) {
    const opts = options || {};
    if (!opts.date) {
      throw new Error(
        'buildMatchCompetitionContext: falta "date" — REG-1 (BUG-CONTRACT1-02) exige la fecha REAL del '
        + 'encuentro, nunca un reloj global leído dentro del resolver.',
      );
    }
    const competitionId = BM.competitionIdFromLegacyDivision(team.division);
    return {
      competitionId,
      // Sin competiciones estructuralmente distintas para Copa/Playoff en
      // este motor (Bracket.js reutiliza el mismo ACB/Primera FEB — ver
      // CLAUDE.md), `competitionInstanceId` coincide con `competitionId`;
      // documentado explícitamente, no un campo inventado sin uso.
      competitionInstanceId: competitionId,
      seasonKey: buildCareerSeasonKey(),
      date: opts.date,
      phaseId: opts.phaseId || 'league',
      roundId: opts.roundId || null,
      matchId: opts.matchId || null,
      operation: opts.operation || 'buildMatchSquad',
    };
  }

  // REG-1 (DESIGN.md 9.18): resolución COMPLETA (`domain: 'registration'`)
  // para un partido concreto — expone `resolved.registration` (cupos,
  // acta, no comunitarios, reglas en pista...) además de `squadRules`.
  function resolveRegistrationForMatch(team, options) {
    return BM.resolveRules(buildMatchCompetitionContext(team, options));
  }

  function resolveSquadRulesForMatch(team, options) {
    return resolveRegistrationForMatch(team, options).squadRules;
  }

  // Pool REGULADO de candidatos de `team` para un partido concreto (sección
  // 11.1 del prompt de REG-1): seniors afiliados + propios de categoría
  // inferior + vinculados autorizados — NUNCA solo `team.roster`. Cada
  // candidato llega YA evaluado por `EligibilityService` (el MISMO
  // servicio que usa la CPU y que valida al usuario). Devuelve `null` si la
  // partida todavía no tiene `state.registrationRegistry` (defensivo; tras
  // REG-1 siempre debería existir desde `startSeason()`).
  function buildEligiblePoolForMatch(team, context) {
    const registry = state.registrationRegistry;
    if (!registry) return null;
    const { getAvailability, CONFIG_BASE, EligibilityService } = BM;
    const medicalAvailability = CONFIG_BASE.medical.enabled ? new Map() : null;
    const classificationCache = getRegistrationClassificationCache();

    function evaluateFor(player, accessCategory, extraDeps) {
      if (medicalAvailability && !medicalAvailability.has(player.id)) {
        medicalAvailability.set(player.id, getAvailability(player, context.date, CONFIG_BASE, { team }));
      }
      const deps = {
        playerRegistry: state.playerRegistry,
        contractRegistry: state.contractRegistry,
        registrationRegistry: registry,
        medicalAvailability,
        classificationCache,
        ...extraDeps,
      };
      return { player, accessCategory, evaluation: EligibilityService.evaluateEligibility(player.id, team.id, context, deps) };
    }

    const pool = team.roster.map((player) => evaluateFor(player, 'senior'));

    registry.registrationsForClub(team.id)
      .filter((r) => r.accessCategory === 'own-lower-category' && r.seasonKey === context.seasonKey && r.isEffectiveOn(context.date))
      .forEach((r) => {
        const player = state.playerRegistry.get(r.playerId);
        if (player) pool.push(evaluateFor(player, 'own-lower-category'));
      });

    registry.linkAgreementsAsBeneficiary(team.id).forEach((agreement) => {
      const direction = agreement.upperClubId === team.id ? 'lowerToUpper' : 'upperToLower';
      const originClubId = direction === 'lowerToUpper' ? agreement.lowerClubId : agreement.upperClubId;
      const originTeam = getAllTeams().find((t) => t.id === originClubId);
      if (!originTeam) return;
      const lowerClubTeam = direction === 'lowerToUpper' ? originTeam : team;
      const upperClubTeam = direction === 'lowerToUpper' ? team : originTeam;
      agreement.lists[direction].forEach((playerId) => {
        const player = state.playerRegistry.get(playerId);
        if (!player) return;
        pool.push(evaluateFor(player, 'linked', {
          linkAgreement: agreement,
          linkDirection: direction,
          lowerClubCompetitionId: BM.competitionIdFromLegacyDivision(lowerClubTeam.division),
          upperClubCompetitionId: BM.competitionIdFromLegacyDivision(upperClubTeam.division),
        }));
      });
    });

    return pool;
  }

  // Contexto del PRÓXIMO partido real de `team` — usado por la pantalla de
  // Alineación (que no conoce todavía si el usuario va a pulsar "jugar"):
  // liga → fecha exacta programada del próximo partido pendiente; bracket
  // activo (Copa/Playoff/Ascenso) → todavía sin fecha programada de verdad
  // (Bracket.Series.playNextGame la calcula DESPUÉS de simular, igual que
  // ya asumía `resolveBracketOptions` antes de esta entrega) — se usa el
  // reloj de mundo como mejor aproximación disponible, pero SIEMPRE pasado
  // como parámetro explícito, nunca leído dentro del resolver de reglas.
  function resolveNextMatchContextForTeam(team) {
    const activeBracket = getActiveBracket();
    if (activeBracket) {
      return {
        date: state.calendar.currentGameDateTime,
        phaseId: BRACKET_PHASE_IDS[activeBracket.competitionKey] || activeBracket.competitionKey,
      };
    }
    const league = getUserLeague();
    const nextMatch = league && !league.isSeasonComplete ? findNextPendingMatchForTeam(league, team) : null;
    return {
      date: nextMatch ? nextMatch.date : state.calendar.currentGameDateTime,
      phaseId: 'league',
      roundId: nextMatch ? nextMatch.round : null,
      matchId: nextMatch ? matchStableId(nextMatch) : null,
    };
  }

  function resolveTeamSquadRules(team) {
    return resolveSquadRulesForMatch(team, resolveNextMatchContextForTeam(team));
  }

  // REG-1 (DESIGN.md 9.18): resolución COMPLETA + contexto del PRÓXIMO
  // partido de `team` — usado por la pantalla de Alineación para construir
  // el pool regulado y validar la convocatoria con los mismos servicios
  // que la CPU.
  function resolveNextMatchRegistration(team) {
    const context = buildMatchCompetitionContext(team, resolveNextMatchContextForTeam(team));
    return { context, resolved: BM.resolveRules(context) };
  }

  // Pool regulado + contexto + reglas del PRÓXIMO partido de `team`, listo
  // para la pantalla de Alineación (sección 11.2 del prompt de REG-1).
  function getLineupPool(team) {
    const { context, resolved } = resolveNextMatchRegistration(team);
    return { context, resolved, pool: buildEligiblePoolForMatch(team, context) || [] };
  }

  function buildRealTeamFromData(teamData) {
    const {
      Player, Team, ensureDevelopmentState, CONFIG_BASE, padRosterToMinimum,
    } = BM;
    const referenceDate = state.calendar ? state.calendar.currentGameDateTime : new Date();
    const roster = teamData.roster.map((playerData) => {
      const { dataSource, ...playerFields } = playerData;
      const player = new Player(playerFields);
      player.dataSource = dataSource || null;
      // LIFE-1 (DESIGN.md 9, sección 26): migra/inicializa developmentState
      // de cada jugador real EN MEMORIA, cada vez que se reconstruye desde
      // el bundle — nunca se reescriben los 414 JSON de data/real/. Idéntico
      // punto de integración que ya usa esta función para dataSource.
      ensureDevelopmentState(player, CONFIG_BASE, referenceDate);
      // LIFE-4 (DESIGN.md 9.15, sección 3/18): jugadores reales ya
      // existentes antes de esta partida — histórico `partial`, empieza en
      // el instante real de esta llamada (nunca inventa su pasado real).
      BM.ensureCareerHistory(
        player, CONFIG_BASE, referenceDate,
        { historyCompleteness: 'partial', seasonKey: buildCareerSeasonKey() },
      );
      return player;
    });

    // ROSTER-1 (DESIGN.md 9.16): puente de COBERTURA DE DATOS, no de
    // normativa — completa EN MEMORIA (nunca data/real/) hasta el mínimo
    // REAL de convocatoria de la competición de este equipo, cuando el
    // roster cargado se queda corto (hoy: varios clubes de Primera FEB con
    // menos jugadores en el bundle que el mínimo real de acta). El mínimo
    // objetivo lo decide SIEMPRE `CompetitionRules`, nunca un número fijo
    // aquí — esta necesidad desaparece sola en cuanto el dataset real
    // mejore, sin tocar ninguna regla de competición.
    const squadRules = resolveSquadRulesForMatch(
      { division: teamData.division }, { date: referenceDate, phaseId: 'league' },
    );
    const fallbackPlayers = padRosterToMinimum(
      roster, squadRules.min, { minAge: 18, maxAge: 34, referenceDate },
    );
    fallbackPlayers.forEach((player) => {
      // Histórico `complete` desde su creación en la partida (sin pasado
      // inventado) — mismo criterio que la cantera nueva
      // (`generateAcademyIntake()`). CONTRACT-1 (DESIGN.md 9.17): sí
      // reciben CONTRATO simulado como cualquier otro afiliado, pero se
      // crea aparte, vía ContractService, después de registrarlos en el
      // Player Registry (ver `bootstrapContractsForNewCareer()`), nunca
      // desde aquí. Licencia/inscripción (REG-1) y "jugador vinculado"
      // (REG-1, y LOAN-1 cuando exista una relación temporal) siguen sin
      // existir — corrección documental de ROSTER-1, que los atribuía a
      // CONTRACT-1.
      BM.ensureCareerHistory(
        player, CONFIG_BASE, referenceDate,
        { historyCompleteness: 'complete', seasonKey: buildCareerSeasonKey() },
      );
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
    const {
      League, Calendar, CONFIG_BASE, recalculateSportingGoalsForDivision, PlayerRegistry,
    } = BM;
    state.division = division;
    state.userTeamId = teamId;
    state.seasonStartYear = new Date().getFullYear();
    state.calendar = new Calendar(state.seasonStartYear, CONFIG_BASE);
    // ROSTER-1 (DESIGN.md 9.16): una carrera nueva construye su PROPIO
    // registro mundial — nunca un singleton compartido entre partidas.
    state.playerRegistry = new PlayerRegistry();

    // DESIGN.md 3.4.1: las DOS divisiones reales se construyen SIEMPRE,
    // no solo la del usuario — comparten el mismo Calendar de temporada.
    ['1ª', '2ª'].forEach((div) => {
      const teams = getRealTeamsByDivision(div);
      // ROSTER-1 (DESIGN.md 9.16): registra el universo completo de
      // jugadores de ESTE equipo (reales + relleno ficticio por cobertura
      // incompleta) en cuanto se construye — antes de cualquier otro
      // procesado de pretemporada.
      teams.forEach((team) => state.playerRegistry.registerMany(team.roster));
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
      // DESIGN.md 7.12.25 (TAC-7, alcance acotado — Construcción de
      // identidad CPU): se calcula UNA VEZ por equipo, aquí mismo, "arrancar
      // una partida nueva" es la pretemporada conceptual de esta primera
      // temporada (mismo criterio que sportingGoal, línea de arriba) — NO
      // se repite cada partido (`CpuLineup.js` decide quinteto/minutos
      // PARTIDO A PARTIDO reutilizando el `tacticalProfile` ya asignado
      // aquí, no vuelve a calcular identidad, ver CpuLineup.js sin tocar).
      // Persiste sola en `closeSeasonAndPrepareNext()`: esa función reutiliza
      // las MISMAS instancias de Team (nunca las reconstruye desde el
      // bundle), así que `team.tacticalProfile` sobrevive a cada cierre de
      // ciclo sin ningún enganche adicional. Nunca se toca el equipo del
      // usuario (`teamId`, el que está a punto de elegir esta llamada).
      teams.forEach((team) => {
        if (team.id === teamId) return;
        team.tacticalProfile = BM.buildCpuTacticalIdentity(team, CONFIG_BASE);
      });
      // CAL-1: dateResolver con la firma ampliada de League.generateSchedule
      // (round, matchIndexInRound, matchesInRound, totalRounds) — reparte
      // horario real por partido dentro de la jornada, no una única fecha
      // compartida (ver Calendar.leagueMatchDateTime/DESIGN.md 3.3.1).
      state.leagues[div] = new League(teams, (round, matchIndexInRound, matchesInRound, totalRounds) => (
        state.calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
      ));
    });

    // CONTRACT-1 (DESIGN.md 9.17, sección 11 del prompt): con los 36
    // equipos ya construidos y el Player Registry completo, se crea el
    // registro CONTRACTUAL de la partida, se valida que los 36 clubes
    // tienen contexto laboral explícito y se generan los contratos
    // bootstrap SIMULADOS de todos los jugadores afiliados. Nada de esto
    // toca `data/real/`.
    bootstrapContractsForNewCareer();
    // REG-1 (DESIGN.md 9.18, sección 10.4 del prompt): se ejecuta DESPUÉS
    // del registro contractual — licencia/inscripción son pasos separados
    // del contrato, nunca concedidos automáticamente por tenerlo.
    bootstrapRegistrationsForNewCareer();
    // MARKET-1 (DESIGN.md 9.19, sección 14 del prompt): se ejecuta AL
    // FINAL del arranque — el pool de libres/agentes no depende de
    // contrato/inscripción, pero reutiliza `state.playerRegistry` ya
    // completo de los 36 clubes.
    bootstrapMarketForNewCareer();

    state.brackets = {
      '1ª': { cup: null, titlePlayoff: null },
      '2ª': { promotionPlayoff: null },
    };
    state.seasonCloseSummary = null;
    state.newsLog = [];
    state.agendaAnchorDate = null;
    state.lastRoundMatches = null;
    state.pendingUserMatch = null;
    state.matchReveal = null;
    state.tacticsRivalTeamId = null;
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
  // CONTRACT-1 (DESIGN.md 9.17) — integración de la vertical contractual.
  //
  // Esta capa de UI NO contiene ninguna regla laboral propia: solo decide
  // CUÁNDO llamar a `ContractSeeder`/`ContractService` (arranque de
  // partida, incorporación de cantera) y muestra el resultado. Toda la
  // normativa vive en `CompetitionRules`/`ClubEmploymentContextCatalog`.
  // ---------------------------------------------------------------------
  function currentGameIsoDate() {
    return BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
  }

  // Nómina proyectada de los 36 clubes desde el registro contractual —
  // `team.finances.expenses.playerSalaries` deja de ser un valor editable y
  // pasa a ser esta proyección (nunca una segunda verdad).
  function refreshAllSalaryProjections(seasonKey) {
    if (!state.contractRegistry) return;
    getAllTeams().forEach((team) => {
      BM.ContractService.refreshTeamSalaryProjection(team, state.contractRegistry, seasonKey);
    });
  }

  function bootstrapContractsForNewCareer() {
    const { ContractRegistry, ContractSeeder, ClubEmploymentContextCatalog, CONFIG_BASE } = BM;
    state.contractRegistry = new ContractRegistry();
    state.contractBootstrapWarnings = [];

    const teams = getAllTeams();
    // Los 36 clubes deben tener contexto laboral EXPLÍCITO: un club
    // desconocido no hereda España, ACB ni ningún otro perfil.
    const catalogCheck = ClubEmploymentContextCatalog.validateCatalog(teams);
    if (!catalogCheck.valid) {
      throw new Error(`CONTRACT-1: contexto laboral de club incompleto — ${catalogCheck.errors.join(' | ')}`);
    }

    const seasonKey = buildCareerSeasonKey();
    const isoDate = currentGameIsoDate();
    const { warnings } = ContractSeeder.seedContractsForTeams({
      teams,
      seasonKey,
      date: isoDate,
      registry: state.contractRegistry,
      playerRegistry: state.playerRegistry,
      config: CONFIG_BASE,
    });
    state.contractBootstrapWarnings = warnings;
    refreshAllSalaryProjections(seasonKey);
  }

  // ---------------------------------------------------------------------
  // MARKET-1 (DESIGN.md 9.19, sección 9.6/14 del prompt) — semilla de
  // carrera ESTABLE (no `Math.random`, no reloj de sistema): misma
  // semilla+inputs siempre produce la misma negociación. No necesita ser
  // "aleatoria de verdad" — solo distinta entre carreras y constante
  // dentro de una misma carrera, cosa que `userTeamId+seasonStartYear` ya
  // garantiza.
  // ---------------------------------------------------------------------
  function buildMarketCareerSeed() {
    return `${state.userTeamId}|${state.seasonStartYear}`;
  }

  function bootstrapMarketForNewCareer() {
    const { AgentRegistry, MarketRegistry, MarketSeeder, CONFIG_BASE } = BM;
    state.agentRegistry = new AgentRegistry();
    state.marketRegistry = new MarketRegistry();
    state.marketBootstrapWarnings = [];
    state.marketAgendaLog = [];

    const careerSeed = buildMarketCareerSeed();
    const referenceDate = state.calendar.currentGameDateTime;
    const createdFreeAgents = MarketSeeder.seedFreeAgentPool({
      playerRegistry: state.playerRegistry, careerSeed, referenceDate, config: CONFIG_BASE,
    });
    const agentResult = MarketSeeder.seedAgentsAndMandates({
      playerRegistry: state.playerRegistry,
      agentRegistry: state.agentRegistry,
      careerSeed,
      referenceDate,
      players: createdFreeAgents,
    });
    state.marketBootstrapWarnings = [
      `Pool inicial de mercado: ${createdFreeAgents.length} jugadores libres ficticios (dataSource: `
      + `${MarketSeeder.SIMULATED_FREE_AGENT_DATA_SOURCE}) — no son datos reales.`,
      `Agentes simulados: ${agentResult.agents.length}, ${agentResult.playersWithAgent}/${agentResult.eligiblePlayers} `
      + 'jugadores del pool con representación (el resto, autorrepresentado).',
    ];
  }

  // Contrato de un jugador que se incorpora con la partida ya en marcha
  // (cantera). Usa SIEMPRE el contexto doméstico vigente DESPUÉS de
  // ascensos/descensos — y nunca reescribe los contratos ya firmados.
  function signContractsForNewPlayers(team, players, seasonKey, isoDate, calibration) {
    if (!state.contractRegistry) return;
    players.forEach((player) => {
      BM.ContractSeeder.seedContractForNewPlayer({
        player,
        team,
        seasonKey,
        date: isoDate,
        registry: state.contractRegistry,
        playerRegistry: state.playerRegistry,
        config: BM.CONFIG_BASE,
        calibration,
      });
    });
  }

  // ---------------------------------------------------------------------
  // REG-1 (DESIGN.md 9.18) — integración de la vertical de inscripción,
  // licencias y elegibilidad. Esta capa de UI NO contiene ninguna regla
  // regulatoria propia: solo decide CUÁNDO llamar a
  // `RegistrationSeeder`/`RegistrationService` (arranque de partida,
  // incorporación de cantera, transición de temporada) y muestra el
  // resultado. Toda la normativa vive en `CompetitionRules`.
  // Orden de inicialización (sección 10.4 del prompt de REG-1): jugadores
  // → PlayerRegistry → ContractRegistry → RegistrationRegistry → perfiles
  // → licencias/inscripciones → validación conjunta → lineup/pools.
  // ---------------------------------------------------------------------
  function bootstrapRegistrationsForNewCareer() {
    const { RegistrationRegistry, RegistrationSeeder, CONFIG_BASE } = BM;
    state.registrationRegistry = new RegistrationRegistry();
    state.registrationBootstrapWarnings = [];
    // BUG-REG1-06: la caché por carrera se crea aquí, en el ÚNICO punto de
    // arranque regulatorio — nunca de forma perezosa/accidental desde un
    // renderizador (ver getRegistrationClassificationCache() más abajo).
    state.registrationClassificationCache = new Map();

    const seasonKey = buildCareerSeasonKey();
    const isoDate = currentGameIsoDate();
    const { warnings } = RegistrationSeeder.seedRegistrationsForTeams({
      teams: getAllTeams(),
      seasonKey,
      date: isoDate,
      registrationRegistry: state.registrationRegistry,
      contractRegistry: state.contractRegistry,
      config: CONFIG_BASE,
    });
    state.registrationBootstrapWarnings = warnings;
  }

  // BUG-REG1-06 (DESIGN.md 9.19): único punto de lectura de la caché de
  // clasificación regulatoria — nunca `state.registrationClassificationCache
  // || (state.registrationClassificationCache = new Map())` repetido en
  // cada renderizador (ese patrón perezoso era justo lo que permitía que
  // sobreviviera sin limpiar entre carreras). La caché SIEMPRE existe ya
  // desde bootstrapRegistrationsForNewCareer(); este getter solo evita
  // duplicar el acceso, y de forma defensiva crea una vacía si se llama
  // antes de tiempo (nunca debería pasar en producción).
  function getRegistrationClassificationCache() {
    if (!state.registrationClassificationCache) state.registrationClassificationCache = new Map();
    return state.registrationClassificationCache;
  }

  // Licencia/inscripción de un jugador que se incorpora con la partida ya
  // en marcha (cantera) — sección 10.3: "reciben perfil, contrato ya
  // existente y alta regulatoria mediante servicios, nunca por estar en el
  // array". Se llama DESPUÉS de `signContractsForNewPlayers()` (CONTRACT-1
  // sigue creando el contrato; REG-1 se ejecuta después — tener contrato
  // no activa por sí solo la licencia).
  // `existingClassification` (BUG-REG1-02): OBLIGATORIA — calculada por
  // quien llama ANTES de que `Team.generateAcademyIntake()` añada a
  // `players` a `team.roster` (`RegistrationSeeder.classifyRosterForClub`
  // sobre el roster SENIOR previo, el mismo usado por
  // `bootstrapRegistrationsForSeasonTransition()` momentos antes para ese
  // club). Sin ella, cada newgen recalculaba su propia clasificación sobre
  // el roster YA AMPLIADO — un sorteo independiente de formación/no
  // comunitario que podía superar el cupo del club ya congelado en las
  // inscripciones senior recién creadas (softlock detectado por el smoke
  // de 3 temporadas: `NON_COMMUNITY_CAP_EXCEEDED` en jornada 1 de la
  // temporada siguiente al intake).
  function signRegistrationsForNewPlayers(team, players, seasonKey, isoDate, existingClassification) {
    if (!state.registrationRegistry) return;
    players.forEach((player) => {
      BM.RegistrationSeeder.seedRegistrationForNewPlayer({
        player,
        team,
        seasonKey,
        date: isoDate,
        registrationRegistry: state.registrationRegistry,
        contractRegistry: state.contractRegistry,
        config: BM.CONFIG_BASE,
        existingClassification,
      });
    });
  }

  // Cierre de ciclo (sección 12 del prompt de REG-1): las licencias/
  // inscripciones de la temporada que termina EXPIRAN mediante evento (no
  // se borran) — `teamsWithOldAffiliation`/`divisionBeforeByTeamId`:
  // plantilla y división EXACTAS con las que compitió cada equipo en la
  // temporada que se cierra (antes de aplicar ascensos/descensos).
  function expireRegistrationsForSeasonClose(teamsWithOldAffiliation, divisionBeforeByTeamId, prevSeasonKey, isoDate) {
    if (!state.registrationRegistry) return;
    const registry = state.registrationRegistry;
    // Recorrido por el REGISTRO, nunca por `team.roster` (BUG-REG1-01): un
    // propio de categoría inferior o un vinculado (sección 5.4) NUNCA
    // aparecen en `Team.roster` por diseño — iterar plantillas los dejaba
    // huérfanos, con la inscripción de la temporada anterior indefinidamente
    // "activa" mientras su licencia sí expiraba (detectado por
    // `RegistrationRegistry.validateIntegrity()` en el smoke test de 3
    // temporadas). Los ámbitos de inscripción posibles se derivan de las
    // divisiones REALES con las que compitieron los equipos esa temporada
    // (nunca un literal fijo de competición).
    const scopeIds = new Set();
    teamsWithOldAffiliation.forEach((team) => {
      const oldDivision = divisionBeforeByTeamId.get(team.id);
      const oldCompetitionId = BM.competitionIdFromLegacyDivision(oldDivision);
      const oldResolved = BM.resolveRules({
        domain: 'registration', competitionId: oldCompetitionId, seasonKey: prevSeasonKey, date: isoDate,
        phaseId: 'league', operation: 'bootstrap',
      });
      scopeIds.add(oldResolved.registrationScopeId);
    });
    scopeIds.forEach((scopeId) => {
      registry.registrationsForScope(scopeId)
        .filter((registration) => registration.seasonKey === prevSeasonKey && registration.statusOn(isoDate) === 'active')
        .forEach((registration) => BM.RegistrationService.advanceRegistrationEvent(registration, 'expired', isoDate));
    });
    registry.allLicenses()
      .filter((license) => license.seasonKey === prevSeasonKey && license.statusOn(isoDate) === 'active')
      .forEach((license) => BM.RegistrationService.advanceLicenseEvent(license, 'expired', isoDate));
  }

  // Nuevas licencias/inscripciones de TRANSICIÓN para el ámbito/temporada
  // NUEVO (sección 12: "se recalculan clasificación y cupos para el nuevo
  // ámbito, sin copiar la etiqueta de la liga anterior; el máximo
  // acumulado comienza en el ámbito/temporada nuevo") — se llama con la
  // plantilla YA en su división nueva pero ANTES del intake de cantera
  // (los newgens reciben la suya aparte, vía `signRegistrationsForNewPlayers`,
  // para no colisionar con esta re-siembra masiva).
  function bootstrapRegistrationsForSeasonTransition(allTeams, nextSeasonKey, closeIsoDate) {
    if (!state.registrationRegistry) return;
    const { warnings } = BM.RegistrationSeeder.seedRegistrationsForTeams({
      teams: allTeams,
      seasonKey: nextSeasonKey,
      date: closeIsoDate,
      registrationRegistry: state.registrationRegistry,
      contractRegistry: state.contractRegistry,
      config: BM.CONFIG_BASE,
    });
    state.registrationBootstrapWarnings = warnings;
  }

  // ---------------------------------------------------------------------
  // CAL-2 (DESIGN.md 3.5): Noticias — utilidades compartidas por todos los
  // puntos de resolución real que pueden generar una noticia. `Events.js`
  // (módulo puro) construye los objetos; aquí solo se decide CUÁNDO
  // llamarlo y se guarda el resultado en `state.newsLog` (fuente única,
  // ver comentario en `state`).
  // ---------------------------------------------------------------------
  const COMPETITION_LABELS = { league: null, cup: 'la Copa', playoff: 'el Playoff por el título', promotion: 'el Playoff de ascenso' };
  const NEWS_LOG_MAX = 300; // límite razonable de memoria en una sesión larga — no es una regla de diseño

  function pushNews(events) {
    (Array.isArray(events) ? events : [events]).forEach((event) => {
      if (!event) return;
      state.newsLog.push(event);
    });
    if (state.newsLog.length > NEWS_LOG_MAX) {
      state.newsLog.splice(0, state.newsLog.length - NEWS_LOG_MAX);
    }
  }

  // LIFE-3 (DESIGN.md 9.14, sección 30 del prompt de esa sesión): eventos
  // de Agenda tipo 'medical' — separados de `state.newsLog` (que sigue
  // siendo SOLO `type:'news'`, lo que ya asume `renderNewsScreen`) pero
  // con el mismo criterio de persistencia: "no son reconstruibles
  // únicamente desde el estado actual una vez cerrada una lesión".
  function pushMedicalAgenda(events) {
    (Array.isArray(events) ? events : [events]).forEach((event) => {
      if (!event) return;
      state.medicalAgendaLog.push(event);
    });
    if (state.medicalAgendaLog.length > NEWS_LOG_MAX) {
      state.medicalAgendaLog.splice(0, state.medicalAgendaLog.length - NEWS_LOG_MAX);
    }
  }

  // MARKET-1 (DESIGN.md 9.19, sección 15.3 del prompt): eventos de Agenda
  // tipo 'market' YA OCURRIDOS (aceptación/rechazo/resultado de derecho) —
  // mismo criterio de persistencia que `medicalAgendaLog`. Los eventos
  // FUTUROS (respuesta pendiente, vencimiento) NUNCA se guardan aquí —
  // `buildAgendaEvents()` los deriva bajo demanda de
  // `state.marketRegistry.allScheduledEvents()`, siempre reconstruibles
  // sin pérdida desde el propio registro.
  function pushMarketAgenda(events) {
    (Array.isArray(events) ? events : [events]).forEach((event) => {
      if (!event) return;
      state.marketAgendaLog.push(event);
    });
    if (state.marketAgendaLog.length > NEWS_LOG_MAX) {
      state.marketAgendaLog.splice(0, state.marketAgendaLog.length - NEWS_LOG_MAX);
    }
  }

  // Snapshot mínimo de identidad médica (id de lesión activa + longitud
  // del histórico) de toda la plantilla — permite detectar, por
  // diferencia, qué jugadores concretos acaban de lesionarse/recibir el
  // alta durante el procesado de Training/Medical de un tick, sin que
  // Training.js/Medical.js tengan que devolver un log de eventos por la
  // API genérica de ticks (PlayerDevelopment.processPlayerToDate).
  function snapshotMedicalIdentity(team) {
    const map = new Map();
    team.roster.forEach((player) => {
      map.set(player.id, {
        currentInjuryId: (player.medicalState && player.medicalState.currentInjury) ? player.medicalState.currentInjury.id : null,
        historyLength: player.medicalState ? player.medicalState.injuryHistory.length : 0,
      });
    });
    return map;
  }

  // Noticias/Agenda médicas SOLO para la división visible del usuario
  // (sección 30: "división de fondo: ninguna noticia médica") — comparado
  // contra el snapshot `before` de snapshotMedicalIdentity().
  function pushMedicalDiffEvents(team, before) {
    if (!BM.CONFIG_BASE.medical.enabled || team.division !== state.division) return;
    team.roster.forEach((player) => {
      const prev = before.get(player.id);
      if (!prev || !player.medicalState) return;
      const injury = player.medicalState.currentInjury;
      if (injury && injury.id !== prev.currentInjuryId) {
        pushMedicalAgenda(BM.buildInjuryAgendaEvent(player, team, injury));
        pushNews(BM.buildInjuryNewsEvent(player, team, injury, { userTeamId: state.userTeamId, relatedCompetition: 'league' }));
      }
      player.medicalState.injuryHistory.slice(prev.historyLength).forEach((entry) => {
        pushNews(BM.buildFullRecoveryNewsEvent(player, team, entry.daysUnavailable, {
          userTeamId: state.userTeamId, relatedCompetition: 'league', dateTime: state.calendar.currentGameDateTime,
        }));
      });
    });
  }

  // Lesiones EN DIRECTO durante un partido (MatchEngine.buildMatchResult
  // `.injuries`, sección 31) — dato ya construido por el motor, este
  // helper solo decide cuándo redactar Agenda/Noticias a partir de él.
  function pushMedicalMatchEvents(homeTeam, awayTeam, result, competitionKey) {
    if (!BM.CONFIG_BASE.medical.enabled || !result.injuries || !result.injuries.length) return;
    if (homeTeam.division !== state.division) return; // división de fondo: nunca noticia médica
    result.injuries.forEach((entry) => {
      const team = entry.teamId === homeTeam.id ? homeTeam : awayTeam;
      const player = team.roster.find((p) => p.id === entry.playerId);
      if (!player || !player.medicalState || !player.medicalState.currentInjury) return;
      const injury = player.medicalState.currentInjury;
      pushMedicalAgenda(BM.buildInjuryAgendaEvent(player, team, injury));
      pushNews(BM.buildInjuryNewsEvent(player, team, injury, {
        userTeamId: state.userTeamId, relatedCompetition: competitionKey || 'league',
      }));
    });
  }

  // Copia ligera de la clasificación en un instante dado — DELIBERADAMENTE
  // no guarda una referencia a los objetos `standing` originales, porque
  // `League.js` los muta in situ al resolver partidos (mismo objeto, no
  // uno nuevo por jornada); sin esta copia, un "antes" capturado antes de
  // resolver la jornada acabaría reflejando el "después" por referencia
  // compartida.
  function captureStandingsSnapshot(league) {
    return league.getStandingsTable().map((s) => ({ team: s.team, points: s.points }));
  }

  // Normaliza un partido de bracket ({ homeEntry, awayEntry, result, date })
  // al shape que esperan los builders de Events.js — mismo patrón que ya
  // usa `playBracketGameWithReveal` para `state.pendingUserMatch`.
  function normalizeBracketGame(game) {
    return { homeTeam: game.homeEntry.team, awayTeam: game.awayEntry.team, date: game.date, result: game.result, status: 'played' };
  }

  // Noticias de resultado/actuación/sorpresa para un lote de partidos de
  // LIGA ya resueltos — compartido entre `resolvePreUserMatches()` (los
  // anteriores al partido del usuario dentro de su jornada) y
  // `finishRoundBookkeeping()` (el resto), para no generar la noticia de
  // un mismo partido dos veces ni olvidarla en ninguno de los dos caminos.
  // `standingsBefore` (opcional): clasificación justo antes de que
  // arrancara la jornada — se usa como aproximación para TODOS los
  // partidos del lote (no se recalcula partido a partido dentro de la
  // misma jornada), suficiente para el criterio de "sorpresa" (3.5.2).
  function pushLeagueMatchNews(matches, standingsBefore) {
    matches.forEach((match) => {
      pushNews(BM.buildResultNewsEvent(match, { userTeamId: state.userTeamId, relatedCompetition: 'league' }));
      pushNews(BM.buildBigPerformanceNewsEvents(match, BM.CONFIG_BASE, { userTeamId: state.userTeamId, relatedCompetition: 'league' }));
      if (standingsBefore) {
        pushNews(BM.buildUpsetNewsEvent(match, standingsBefore, BM.CONFIG_BASE, { userTeamId: state.userTeamId, relatedCompetition: 'league' }));
      }
    });
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
  // LIFE-1 (DESIGN.md 9, sección 27): único punto que avanza
  // `state.calendar` — sustituye las llamadas directas a
  // `state.calendar.advanceTo(date)` repartidas por este archivo, para que
  // el procesado de desarrollo (ticks de 7 días, PlayerDevelopment.js) se
  // dispare exactamente donde dice el prompt ("cualquier punto donde
  // currentGameDateTime avance"), sin crear un segundo reloj ni tocar
  // Calendar.js. Procesa las 36 plantillas de ambas divisiones cada vez —
  // barato: solo hace trabajo real cuando ya se acumuló un tick completo
  // por jugador (ver PlayerDevelopment.processPlayerToDate, idempotente).
  function advanceGameClockTo(date) {
    if (!date) return;
    // MARKET-1 (DESIGN.md 9.19, sección 15.2/15.4 del prompt): punto ÚNICO
    // de avance del reloj — impide un salto POR ENCIMA de una atención de
    // mercado pendiente del club del usuario (invariante 20: "Continuar
    // no salta una atención de mercado"). Recomputado en cada llamada
    // desde el estado real (nunca cacheado): en cuanto la atención se
    // resuelve, deja de bloquear por sí solo. Lanza en vez de clampar en
    // silencio — cualquier llamador que llegue aquí con un salto real ya
    // debería haber comprobado getMarketAttentionForUser() antes (gating
    // de "Continuar" en Home).
    if (state.userTeamId && state.marketRegistry) {
      const { LocalDate } = BM;
      const targetIso = LocalDate.fromJsDate(date instanceof Date ? date : new Date(date));
      const attention = BM.MarketService.computeMarketAttentionForClub({
        marketRegistry: state.marketRegistry, clubId: state.userTeamId, date: targetIso,
      });
      if (attention && LocalDate.isAfter(targetIso, attention.dueDate)) {
        throw new Error(
          `advanceGameClockTo: hay una atención de mercado pendiente ("${attention.type}", jugador `
          + `"${attention.playerId}") con plazo ${attention.dueDate}, anterior a la fecha objetivo ${targetIso} `
          + '— "Continuar" debe detenerse en Mercado antes de avanzar (DESIGN.md 9.19, invariante 20).',
        );
      }
    }
    state.calendar.advanceTo(date);
    processDevelopmentToDateForTeams(getAllTeams(), date);
    // LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2, sección 26): revisa
    // el plan de entrenamiento CPU de los 35 clubes que no controla el
    // usuario, en el mismo punto único que ya dispara el resto del
    // desarrollo de carrera — nunca en un bucle propio por competición.
    reviewCpuTrainingForAllTeams(date);
    // MARKET-1 (DESIGN.md 9.19, sección 15.3 del prompt): procesa eventos
    // de mercado NO interactivos ya vencidos (respuesta de interés/oferta
    // del lado jugador-CPU, expiración de ofertas) — mismo punto único que
    // el resto del desarrollo de carrera.
    processDueMarketEventsToDate(date);
  }

  // MARKET-1 (DESIGN.md 9.19, sección 15.4 del prompt): primer punto que
  // exige una decisión REAL del usuario para su club — wrapper fino sobre
  // MarketService, usado tanto por el gating de "Continuar" como por la
  // aserción de advanceGameClockTo() de arriba.
  function getMarketAttentionForUser(throughDate) {
    if (!state.userTeamId || !state.marketRegistry) return null;
    return BM.MarketService.computeMarketAttentionForClub({
      marketRegistry: state.marketRegistry, clubId: state.userTeamId, date: throughDate || state.calendar.currentGameDateTime,
    });
  }

  // Procesa, para TODOS los clubes (usuario y CPU), los eventos de
  // mercado NO interactivos ya vencidos — respuesta de interés inicial,
  // respuesta CPU a una oferta enviada por el usuario, y expiración de
  // ofertas vivas. Idempotente (MarketRegistry.markEventProcessed +
  // ledger propio de cada entidad) — un render/avance repetido no
  // reprocesa nada dos veces.
  function processDueMarketEventsToDate(date) {
    if (!state.marketRegistry) return;
    const isoDate = currentGameIsoDate();
    const due = state.marketRegistry.eventsDueThrough(isoDate);
    const careerSeed = buildMarketCareerSeed();
    due.forEach((event) => {
      if (event.type === 'interest-response') {
        const { interest } = BM.MarketService.processInterestResponseEvent({
          marketRegistry: state.marketRegistry, playerRegistry: state.playerRegistry, event, date: event.dueDate, careerSeed,
        });
        const player = state.playerRegistry.get(event.playerId);
        if (interest.level === 'low') {
          pushMarketAgenda(BM.buildMarketAgendaEvent(
            { ...event, processed: true, payload: { playerId: event.playerId, playerName: player ? player.fullName : event.playerId } },
            { body: 'El jugador declina la consulta inicial.' },
          ));
        }
      } else if (event.type === 'offer-response') {
        const thread = state.marketRegistry.getThread(event.threadId);
        const offer = state.marketRegistry.getOffer(event.payload.offerId);
        if (thread && offer && offer.statusOn(event.dueDate) === 'sent') {
          const marketContext = thread.rulesSnapshot;
          BM.MarketService.processOfferResponse({
            marketRegistry: state.marketRegistry, playerRegistry: state.playerRegistry, thread, offer, date: event.dueDate, careerSeed, marketContext,
          });
        }
        state.marketRegistry.markEventProcessed(event.id);
      } else {
        state.marketRegistry.markEventProcessed(event.id);
      }
    });
    BM.MarketService.expireDueOffers(state.marketRegistry, isoDate);
  }

  function getAllTeams() {
    const teams = [];
    ['1ª', '2ª'].forEach((div) => {
      const league = getLeague(div);
      if (league) teams.push(...league.teams);
    });
    return teams;
  }

  // LIFE-2: contexto de calendario mínimo que Training.js/TrainingAI.js
  // necesitan (agnósticos de Calendar.js) — solo `seasonStartDate`, para
  // distinguir ticks de pretemporada (sección 24) de ticks de temporada
  // regular. Se reconstruye barato en cada llamada, nunca se guarda en
  // `state` (deriva siempre de `state.calendar`, la fuente real).
  function buildTrainingCalendarContext() {
    return { seasonStartDate: state.calendar ? state.calendar.seasonStartDate : null };
  }

  function processDevelopmentToDateForTeams(teams, date) {
    const { processTeamDevelopmentToDate, CONFIG_BASE } = BM;
    const calendarCtx = buildTrainingCalendarContext();
    teams.forEach((team) => {
      processTeamDevelopmentToDate(team, date, CONFIG_BASE, calendarCtx);
    });
  }

  // Partidos YA PROGRAMADOS (pendientes o resueltos, da igual) de `team` en
  // su propia liga dentro de los próximos `days` días desde `fromDate` —
  // usado SOLO para pasarle a TrainingAI un número real de "próximos
  // partidos" (sección 27: "usa el estado ya cargado en game.js/Calendar",
  // nunca inventar fechas ni hacer polling).
  function countUpcomingMatchesForTeam(team, fromDate, days) {
    const league = getLeague(team.division);
    if (!league) return 0;
    const windowEnd = new Date(fromDate.getTime() + days * 24 * 60 * 60 * 1000);
    return league.schedule.filter((m) => (m.homeTeam.id === team.id || m.awayTeam.id === team.id)
      && m.date >= fromDate && m.date < windowEnd).length;
  }

  // LIFE-2 (sección 26/29, invariante "user team nunca es sobrescrito por
  // TrainingAI"): revisa el plan CPU de TODOS los equipos salvo el del
  // usuario, cada vez que el reloj de mundo avanza — TrainingAI.reviewTeamIfDue
  // ya decide internamente si toca revisar (cadencias de 28/56 días).
  function reviewCpuTrainingForAllTeams(date) {
    const { reviewTeamIfDue, CONFIG_BASE } = BM;
    const calendarCtx = buildTrainingCalendarContext();
    getAllTeams().forEach((team) => {
      if (team.id === state.userTeamId) return;
      const matchesInNext7Days = countUpcomingMatchesForTeam(team, date, 7);
      reviewTeamIfDue(team, date, { matchesInNext7Days }, CONFIG_BASE, calendarCtx);
    });
  }

  // `competitionKey` (LIFE-1, DESIGN.md 9, sección 10 del prompt de esta
  // sesión): identifica la competición para `matchExposures` — valores
  // reales usados en el resto del código: 'league' (por defecto, liga
  // regular no lleva key explícita en ningún otro punto), 'cup', 'playoff',
  // 'promotion'. Opcional con default 'league' para no tener que tocar
  // ningún llamador que solo resuelva partidos de liga.
  // LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2, sección 9 del prompt
  // de esa sesión): la recuperación de Energía por descanso entre partidos
  // y el avance de `lastMatchDate` YA se resolvieron ANTES de simular este
  // partido (Training.prepareTeamForMatch, disparado desde
  // buildMatchOptionsResolver) — moverlo ahí corrige el orden temporal real
  // (antes de esta entrega, la recuperación del descanso se aplicaba
  // DESPUÉS de simular, así que el partido consumía la Energía sin
  // recuperar del hueco anterior). Esta función queda solo con lo que
  // depende del RESULTADO ya simulado (minutos reales jugados): exposición
  // competitiva y Experience.
  function applyRecoveryForResolvedMatch(homeTeam, awayTeam, result, date, competitionKey = 'league') {
    if (!date || !result.rotation) return;
    const { ensureDevelopmentState, recordMatchExposure, CONFIG_BASE } = BM;
    // LIFE-3 (DESIGN.md 9.14, sección 31): lesiones EN DIRECTO de este
    // partido ya resuelto — Agenda/Noticias, punto único (todo partido
    // resuelto de cualquier competición pasa por aquí).
    pushMedicalMatchEvents(homeTeam, awayTeam, result, competitionKey);
    // LIFE-4 (DESIGN.md 9.15, sección 11): clave estable del partido — mismo
    // `gameId` determinista de MatchEngine.createMatchState para ambos
    // lados, con fallback defensivo por fecha para caminos de modo prueba
    // que pudieran no traerlo.
    const matchKey = result.gameId || `match-${homeTeam.id}-${awayTeam.id}-${date.toISOString()}`;
    [
      { team: homeTeam, opponent: awayTeam, rotation: result.rotation.home, boxScore: result.boxScore.home },
      { team: awayTeam, opponent: homeTeam, rotation: result.rotation.away, boxScore: result.boxScore.away },
    ]
      .forEach(({ team, opponent, rotation, boxScore }) => {
        if (!rotation) return; // este lado no tenía alineación real — sin datos de minutos, no se toca
        team.roster.forEach((player) => {
          const playedSeconds = rotation.playedSeconds[player.id] || 0;
          if (playedSeconds <= 0) return; // convocado sin minutos o no convocado — no se actualiza (DESIGN.md 3.3.4)

          // LIFE-1 (DESIGN.md 9, sección 10): registra la exposición
          // competitiva real de este partido. `minutes` redondeado al
          // minuto entero más cercano (Math.round) — decisión de
          // redondeo simple, documentada en el CHANGELOG. LIFE-2 (sección
          // 17): extiende el registro con los minutos reales POR POSICIÓN
          // ocupada en pista (Rotation.js/MatchEngine.rotationSummary),
          // redondeados igual que el total.
          ensureDevelopmentState(player, CONFIG_BASE, date);
          const positionSeconds = (rotation.positionSecondsByPlayer && rotation.positionSecondsByPlayer[player.id]) || null;
          const positionMinutes = positionSeconds
            ? Object.fromEntries(Object.entries(positionSeconds).map(([pos, secs]) => [pos, Math.round(secs / 60)]))
            : undefined;
          recordMatchExposure(player, {
            date, minutes: Math.round(playedSeconds / 60), competition: competitionKey, division: team.division, positionMinutes,
          });

          // Sección 28 (Experience): conexión menor, no una fórmula nueva —
          // `addExperience()` existía sin ningún llamador real hasta ahora.
          // Un partido con minutos jugados suma 1 punto de experiencia.
          player.addExperience(1);

          // LIFE-4 (DESIGN.md 9.15): histórico de carrera — mismo punto
          // único de post-procesado que el resto de esta función (liga,
          // Copa, Playoff, Ascenso, usuario y CPU, visible y de fondo).
          if (player.careerHistory) {
            const line = boxScore.find((l) => l.playerId === player.id);
            if (line) {
              const isStarter = (rotation.starterIds || []).indexOf(player.id) !== -1;
              const careerResult = BM.recordResolvedMatch(player, {
                date,
                competition: competitionKey,
                team: { id: team.id, name: team.fullName, division: team.division },
                opponent: { id: opponent.id, name: opponent.fullName },
                boxScoreLine: line,
                isStarter,
                matchKey,
              }, CONFIG_BASE);
              pushCareerNewsForPlayer(player, team, careerResult, competitionKey);
            }
          }
        });
      });
  }

  // LIFE-4 (DESIGN.md 9.15, sección 41): solo el equipo del usuario genera
  // noticias de carrera (evita "fluff" de los otros 35 clubes) — los
  // hitos/récords en sí ya se registraron para CUALQUIER jugador (visible
  // o de fondo) dentro de `recordResolvedMatch`, esto solo decide si
  // ADEMÁS se redacta una noticia.
  function pushCareerNewsForPlayer(player, team, careerResult, competitionKey) {
    if (team.id !== state.userTeamId) return;
    const opts = { userTeamId: state.userTeamId, relatedCompetition: competitionKey };
    careerResult.newMilestones.forEach((milestone) => {
      pushNews(BM.buildCareerMilestoneNewsEvent(player, team, milestone, opts));
    });
    careerResult.newPersonalBests.forEach((milestone) => {
      pushNews(BM.buildPersonalBestNewsEvent(player, team, milestone, player.careerHistory.historyCompleteness, opts));
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
      // CAL-2 (DESIGN.md 3.5): noticia de competición SOLO si es la división
      // visible del usuario — la Copa de la división de fondo no genera
      // noticias (ver decisión documentada en finishRoundBookkeeping).
      if (division === state.division) {
        const qualified = brackets.cup.rounds[0].flatMap((s) => [s.betterEntry.team, s.worseEntry.team]);
        pushNews(BM.buildBracketCreatedNewsEvent(qualified, {
          competitionLabel: 'la Copa', relatedCompetition: 'cup', userTeamId: state.userTeamId, dateTime: state.calendar.currentGameDateTime,
        }));
      }
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

    // Camino defensivo (jornada sin partido para el usuario — no debería
    // ocurrir con 18 equipos/sin byes, ver League.js, pero se mantiene por
    // robustez): aquí SÍ se resuelve la jornada entera de golpe, así que
    // `matches` (recién resueltos) y "la jornada completa" son lo mismo.
    const roundNumber = league.currentRound;
    const standingsBefore = captureStandingsSnapshot(league);
    const matches = league.simulateNextRound(undefined, resolveMatchOptions);
    const fullRoundMatches = league.schedule.filter((m) => m.round === roundNumber);
    finishRoundBookkeeping(matches, fullRoundMatches, state.division, league, standingsBefore);
  }

  // Cola de cierre común a los caminos de terminar una jornada de liga: el
  // "bye" defensivo de arriba (jornada entera de golpe) y el de TAC-5/CAL-1
  // (finishUserLeagueMatch(), tras terminar el partido del usuario sobre el
  // motor pausable, con parte de la jornada ya resuelta de antemano) —
  // evita duplicar recuperación de Energía/creación de brackets/jornada de
  // fondo en dos sitios.
  //
  // `newlyResolvedMatches`: partidos que ACABAN de resolverse en esta
  // llamada (recuperación de Energía y reloj de mundo se aplican solo a
  // estos, nunca dos veces sobre un partido ya resuelto antes). `fullRound
  // Matches`: TODOS los partidos de la jornada (incluidos los resueltos
  // antes por CAL-1, ver resolvePreUserMatches) — lo que se muestra en
  // Home como "Última jornada" y de donde se busca el partido del usuario.
  function finishRoundBookkeeping(newlyResolvedMatches, fullRoundMatches, division, league, standingsBefore) {
    state.lastRoundMatches = fullRoundMatches;

    // DESIGN.md 7.11.5 (cierre de integración): recuperación de Energía
    // para cada partido recién resuelto (no solo el del usuario) — ver
    // limitación real explicada arriba. Solo los NUEVOS: los anteriores de
    // la jornada (resueltos por resolvePreUserMatches, CAL-1) ya la
    // aplicaron en su momento.
    newlyResolvedMatches.forEach((match) => {
      applyRecoveryForResolvedMatch(match.homeTeam, match.awayTeam, match.result, match.date);
    });
    // Reloj de mundo (DESIGN.md 3.3.5): avanza hasta el más tardío de los
    // partidos recién resueltos — nunca hacia atrás (Calendar.advanceTo).
    if (newlyResolvedMatches.length) {
      advanceGameClockTo(newlyResolvedMatches[newlyResolvedMatches.length - 1].date);
    }

    // CAL-2 (DESIGN.md 3.5): Noticias de liga — SOLO para la división
    // visible (`standingsBefore` únicamente se pasa desde ahí, ver
    // llamadas). La división de fondo (`simulateBackgroundRound`) no
    // genera noticias — es "ruido" que el usuario no tiene abierto, ver
    // decisión documentada en DESIGN.md.
    if (standingsBefore && division === state.division) {
      pushLeagueMatchNews(newlyResolvedMatches, standingsBefore);
      const userTeam = getUserTeam();
      if (userTeam) {
        pushNews(BM.buildStreakNewsEvent(league.schedule, userTeam, BM.CONFIG_BASE, { userTeamId: state.userTeamId, relatedCompetition: 'league' }));
      }
      pushNews(BM.buildStandingsNewsEvents(standingsBefore, league.getStandingsTable(), BM.CONFIG_BASE, {
        userTeamId: state.userTeamId, relatedCompetition: 'league', dateTime: state.calendar.currentGameDateTime,
      }));
    }

    createBracketsIfDue(division, league);

    // Partido del equipo del usuario en esta jornada, si lo tenía — se
    // busca en la jornada COMPLETA (fullRoundMatches), no solo en los
    // recién resueltos, para no perderlo si ya se había resuelto antes.
    const userMatch = fullRoundMatches.find(
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
      if (matches.length) advanceGameClockTo(matches[matches.length - 1].date);
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
    // LIFE-1: cada bracket necesita su propio competitionKey real para
    // matchExposures (ver applyRecoveryForResolvedMatch) — antes bastaba
    // recorrer los 3 sin distinguirlos porque nada dependía de cuál era.
    [
      { bracket: brackets.cup, competitionKey: 'cup' },
      { bracket: brackets.titlePlayoff, competitionKey: 'playoff' },
      { bracket: brackets.promotionPlayoff, competitionKey: 'promotion' },
    ].forEach(({ bracket, competitionKey }) => {
      if (!bracket) return;
      const phaseId = BRACKET_PHASE_IDS[competitionKey];
      while (!bracket.isComplete) {
        const game = bracket.playNextGame(undefined, resolver.resolveBracketOptionsFor(bracket, phaseId));
        applyRecoveryForResolvedMatch(game.homeEntry.team, game.awayEntry.team, game.result, game.date, competitionKey);
        if (game.date) advanceGameClockTo(game.date);
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
        competitionKey: 'cup',
      };
    }
    if (brackets.titlePlayoff && !brackets.titlePlayoff.isComplete) {
      return {
        title: 'Playoff por el título',
        roundLabel: getActiveBracketRoundLabel(brackets.titlePlayoff, ['Cuartos de final', 'Semifinales', 'Final']),
        bracket: brackets.titlePlayoff,
        competitionKey: 'playoff',
      };
    }
    if (brackets.promotionPlayoff && !brackets.promotionPlayoff.isComplete) {
      const promo = brackets.promotionPlayoff;
      let roundLabel = 'Cuartos de ascenso';
      if (promo.isQuarterFinalsComplete) {
        promo.ensureFinalFour();
        roundLabel = getActiveBracketRoundLabel(promo.finalFour, ['Semifinales (Final Four)', 'Final (Final Four)']);
      }
      return { title: 'Playoff de ascenso', roundLabel, bracket: promo, competitionKey: 'promotion' };
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

  // LIFE-4 (DESIGN.md 9.15, sección 25): honores reales de la temporada que
  // termina — hechos ya calculados por League.js/Bracket.js/Promotion.js
  // (nunca recalculados aquí), un código estable por equipo. "Honor !=
  // noticia individual" (invariante 23): esto NO genera ninguna noticia,
  // solo queda en la ficha de cada jugador de ese roster.
  function buildSeasonHonoursByTeamId(leagueA, leagueB, bracketsA, bracketsB, promotedTeams) {
    const map = new Map();
    function add(teamId, code) {
      if (!teamId) return;
      const list = map.get(teamId) || [];
      list.push(code);
      map.set(teamId, list);
    }
    const standingsB = leagueB.getStandingsTable();
    if (standingsB.length) add(standingsB[0].team.id, 'regularSeasonChampion2');
    if (bracketsA.cup && bracketsA.cup.champion) add(bracketsA.cup.champion.team.id, 'cupChampion');
    if (bracketsA.titlePlayoff && bracketsA.titlePlayoff.champion) add(bracketsA.titlePlayoff.champion.team.id, 'titlePlayoffChampion');
    if (promotedTeams[0]) add(promotedTeams[0].id, 'promotedDirect');
    if (promotedTeams[1]) add(promotedTeams[1].id, 'promotedPlayoff');
    return map;
  }

  // LIFE-4 (DESIGN.md 9.15, sección 10): rol asignado + familiaridad de ESE
  // rol al cierre de temporada — lee directamente `team.tacticalProfile`
  // (Tactics.js real, nunca recalculado aquí). Sin rol asignado, ambos
  // lados quedan `null` (mismo criterio neutro que ya usa Tactics.js).
  function buildRolesSnapshotForPlayer(player, team) {
    const profile = team.tacticalProfile;
    if (!profile) return { offense: null, defense: null };
    const assignment = (profile.roleAssignments && profile.roleAssignments[player.id]) || {};
    const fam = (profile.familiarity && profile.familiarity.byPlayerRole && profile.familiarity.byPlayerRole[player.id]) || {};
    return {
      offense: assignment.offensiveRole ? [assignment.offensiveRole, Math.round(fam.offensiveLevel || 0)] : null,
      defense: assignment.defensiveRole ? [assignment.defensiveRole, Math.round(fam.defensiveLevel || 0)] : null,
    };
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
    const bracketsA = getBrackets('1ª');
    const bracketsB = getBrackets('2ª');
    // CAL-2: instante real de cierre, capturado ANTES de sustituir
    // `state.calendar` por el de la temporada siguiente (paso 4 más abajo).
    const seasonEndDateTime = state.calendar.currentGameDateTime;

    // LIFE-4 (DESIGN.md 9.15, sección 16): división REAL de la temporada que
    // se está cerrando, capturada ANTES de aplicar ascensos/descensos (paso
    // 1 de abajo) — un ascendido/descendido debe cerrar su histórico con la
    // división en la que JUGÓ esta temporada, no con la nueva.
    const divisionBeforeByTeamId = new Map();
    [...leagueA.teams, ...leagueB.teams].forEach((team) => divisionBeforeByTeamId.set(team.id, team.division));

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

    // 2.5 (LIFE-1, DESIGN.md 9, sección 0.d/27 del prompt de esta sesión):
    // procesa el desarrollo de carrera de los 36 jugadores YA existentes
    // hasta el instante exacto de cierre de temporada, ANTES del intake de
    // cantera de abajo — un canterano recién generado arranca su
    // developmentState.lastProcessedDate en esa misma fecha (ver
    // generateAcademyIntake más abajo), así que procesar en este orden es
    // lo único que garantiza que no reciba progreso retroactivo
    // (invariante 36): si se hiciera después, `processDevelopmentToDateForTeams`
    // no le aplicaría ticks extra de todos modos (su lastProcessedDate ya
    // sería igual a `seasonEndDateTime`), pero el orden documentado aquí es
    // el que el prompt pide explícitamente, sin dejarlo a la casualidad.
    processDevelopmentToDateForTeams(allTeams, seasonEndDateTime);

    // 2.6 (LIFE-4, DESIGN.md 9.15, sección 16): cierra el histórico de
    // carrera de los 36 equipos YA existentes — ANTES del intake de
    // cantera de abajo, mismo motivo documentado en LIFE-1 (2.5) para el
    // orden de procesado: un canterano recién generado no debe recibir una
    // temporada cerrada que nunca jugó (invariante 15 del prompt de esta
    // sesión, "season no sobrescribe").
    const nextSeasonKey = BM.seasonKeyFromStartYear(state.seasonStartYear + 1);
    // REG-1 (DESIGN.md 9.18, sección 12 del prompt): las licencias/
    // inscripciones de la temporada que TERMINA expiran mediante evento
    // (nunca se borran) — con la plantilla y división EXACTAS de la
    // temporada que se cierra (`divisionBeforeByTeamId`, ya capturado
    // arriba antes de aplicar ascensos/descensos).
    const prevSeasonKey = buildCareerSeasonKey();
    const closeIsoDateForRegistrations = BM.LocalDate.fromJsDate(seasonEndDateTime);
    expireRegistrationsForSeasonClose(allTeams, divisionBeforeByTeamId, prevSeasonKey, closeIsoDateForRegistrations);
    // Nuevas licencias/inscripciones de TRANSICIÓN para el ámbito/temporada
    // NUEVO — con la plantilla YA en su división actualizada (paso 1), y
    // ANTES del intake de cantera (los newgens se registran aparte, más
    // abajo, para no colisionar con esta re-siembra masiva).
    bootstrapRegistrationsForSeasonTransition(allTeams, nextSeasonKey, closeIsoDateForRegistrations);
    const honoursByTeamId = buildSeasonHonoursByTeamId(leagueA, leagueB, bracketsA, bracketsB, promotedTeams);
    allTeams.forEach((team) => {
      const honours = honoursByTeamId.get(team.id) || [];
      team.roster.forEach((player) => {
        if (!player.careerHistory) return;
        honours.forEach((honourCode) => BM.registerHonour(player, honourCode));
        BM.closeSeason(player, {
          endDate: seasonEndDateTime,
          teamId: team.id,
          teamName: team.fullName,
          division: divisionBeforeByTeamId.get(team.id) || team.division,
          roles: buildRolesSnapshotForPlayer(player, team),
          honours,
          nextSeasonKey,
        }, CONFIG_BASE);
      });
    });

    // 3. Cantera/Academia de la nueva temporada (3.4.4 paso 2) — conecta
    // Team.generateAcademyIntake() tal cual (con la fecha real de cierre,
    // LIFE-1), sin ninguna otra regla nueva.
    //
    // CONTRACT-1 (DESIGN.md 9.17, sección 11): cada newgen firma un
    // contrato NUEVO con el contexto doméstico YA ACTUALIZADO (los
    // ascensos/descensos se aplicaron en el paso 1). Los contratos ya
    // firmados NO se recrean ni cambian su `signingContext`: un ascenso no
    // reescribe la ley histórica de un contrato anterior.
    const closeIsoDate = BM.LocalDate.fromJsDate(seasonEndDateTime);
    const intakeCalibration = state.contractRegistry
      ? BM.ContractSeeder.buildCompetitionCalibration(allTeams, CONFIG_BASE) : null;
    allTeams.forEach((team) => {
      // BUG-REG1-02: clasificación del club ANTES del intake, sobre el
      // MISMO roster senior que acaba de usar
      // `bootstrapRegistrationsForSeasonTransition()` — ver comentario de
      // `signRegistrationsForNewPlayers` más abajo.
      const intakeClassification = state.registrationRegistry ? (() => {
        const competitionId = BM.competitionIdFromLegacyDivision(team.division);
        const resolved = BM.resolveRules({
          domain: 'registration', competitionId, seasonKey: nextSeasonKey, date: closeIsoDate, phaseId: 'league', operation: 'bootstrap',
        });
        return BM.RegistrationSeeder.classifyRosterForClub(team, resolved, nextSeasonKey);
      })() : null;
      const newPlayers = team.generateAcademyIntake(3, seasonEndDateTime);
      // LIFE-4 (DESIGN.md 9.15, sección 19): cantera nueva = histórico
      // `complete` desde el instante real de su incorporación — nunca
      // recibe temporadas anteriores vacías (arranca directamente en la
      // temporada que viene, `nextSeasonKey`, ver cierre paso 4 más abajo).
      newPlayers.forEach((player) => {
        BM.ensureCareerHistory(player, CONFIG_BASE, seasonEndDateTime, {
          historyCompleteness: 'complete', seasonKey: nextSeasonKey,
        });
      });
      // ROSTER-1 (DESIGN.md 9.16): registra cada newgen en el registro
      // mundial en cuanto se crea — el intake de cantera nunca deja a un
      // jugador ilocalizable ni colisiona con ids existentes (PlayerRegistry
      // rechaza duplicados con error descriptivo).
      state.playerRegistry.registerMany(newPlayers);
      // CONTRACT-1: el contrato se crea DESPUÉS de registrar al jugador en
      // el registro mundial (nunca desde `Player`/`Team.addPlayer`), vía
      // ContractService, y ya con la competición doméstica nueva.
      signContractsForNewPlayers(team, newPlayers, nextSeasonKey, closeIsoDate, intakeCalibration);
      // REG-1: la licencia/inscripción del newgen se crea DESPUÉS de su
      // contrato (sección 10.3: "tener contrato no activa por sí solo la
      // licencia") — un newgen NO es automáticamente jugador de formación
      // senior por nacer en la cantera (RegistrationSeeder lo clasifica
      // igual que cualquier otro afiliado nuevo del club).
      signRegistrationsForNewPlayers(team, newPlayers, nextSeasonKey, closeIsoDate, intakeClassification);
    });

    // CONTRACT-1: la nómina proyectada de los 36 clubes se recalcula para
    // la temporada que entra, siempre desde el registro contractual.
    refreshAllSalaryProjections(nextSeasonKey);

    // 4. Nuevo Calendar (3.4.4 paso 3).
    state.seasonStartYear += 1;
    state.calendar = new Calendar(state.seasonStartYear, CONFIG_BASE);

    // 5. Nuevas League para 1ª y 2ª (3.4.4 paso 4) — standings a cero,
    // currentRound = 1, reutilizando League.js tal cual.
    function buildLeagueDateResolver(div) {
      return (round, matchIndexInRound, matchesInRound, totalRounds) => (
        state.calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
      );
    }
    state.leagues = {
      '1ª': new League(teamsByDivision['1ª'], buildLeagueDateResolver('1ª')),
      '2ª': new League(teamsByDivision['2ª'], buildLeagueDateResolver('2ª')),
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

    // CAL-2 (DESIGN.md 3.5): noticias de ascenso/descenso — reutiliza
    // exactamente `promotedTeams`/`relegatedTeams` ya calculados arriba
    // (Team reales, no recalculados aparte).
    pushNews(BM.buildPromotionRelegationNewsEvents(promotedTeams, relegatedTeams, {
      userTeamId: state.userTeamId, dateTime: seasonEndDateTime,
    }));

    state.lastRoundMatches = null;
    state.pendingUserMatch = null;
    state.matchReveal = null;
    state.agendaAnchorDate = null;
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
  // Busca la Series (de cualquier ronda YA jugada del bracket) que contiene
  // este `game` concreto — por identidad de objeto (`series.games`
  // conserva las mismas instancias que devuelve `playNextGame`), no por
  // índice de ronda (que puede haber avanzado ya al llamar aquí).
  function findSeriesForGame(bracketRounds, game) {
    for (const round of bracketRounds) {
      const series = round.find((s) => s.games.includes(game));
      if (series) return series;
    }
    return null;
  }

  function playBracketGameWithReveal(bracket, resolveOptions, competitionKey) {
    const roundCountBefore = bracket.rounds ? bracket.rounds.length : null;
    const game = bracket.playNextGame(undefined, resolveOptions);
    // DESIGN.md 7.11.5 (cierre de integración): igual que en simulateNextRound(),
    // recuperación de Energía para los dos equipos de este partido de bracket.
    applyRecoveryForResolvedMatch(game.homeEntry.team, game.awayEntry.team, game.result, game.date, competitionKey);
    if (game.date) advanceGameClockTo(game.date);

    // CAL-2 (DESIGN.md 3.5): noticias de este partido de bracket — solo
    // división visible (`playBracketGameWithReveal` nunca se llama para la
    // de fondo, ver drainBackgroundBrackets, decisión documentada).
    const competitionLabel = COMPETITION_LABELS[competitionKey];
    const normalized = normalizeBracketGame(game);
    pushNews(BM.buildResultNewsEvent(normalized, { userTeamId: state.userTeamId, relatedCompetition: competitionKey, competitionLabel }));
    pushNews(BM.buildBigPerformanceNewsEvents(normalized, BM.CONFIG_BASE, { userTeamId: state.userTeamId, relatedCompetition: competitionKey, competitionLabel }));
    // Campeón/eliminación: solo para Copa/Playoff por el título — el
    // Playoff de ascenso ya genera su propia noticia de ascenso al cerrar
    // temporada (buildPromotionRelegationNewsEvents), decisión de alcance
    // señalada explícitamente para no duplicar el mismo hecho dos veces.
    if (competitionKey === 'cup' || competitionKey === 'playoff') {
      const series = findSeriesForGame(bracket.rounds, game);
      if (series && series.isDecided) {
        if (series.loser.team.id === state.userTeamId) {
          pushNews(BM.buildEliminationNewsEvent(series.loser.team, {
            competitionLabel, relatedCompetition: competitionKey, userTeamId: state.userTeamId, dateTime: game.date,
          }));
        }
        const finalRound = bracket.rounds[bracket.rounds.length - 1];
        const isFinalSeries = finalRound.length === 1 && finalRound[0] === series;
        if (isFinalSeries && bracket.champion && series.winner === bracket.champion) {
          pushNews(BM.buildChampionNewsEvent(bracket.champion.team, {
            competitionLabel, relatedCompetition: competitionKey, userTeamId: state.userTeamId, dateTime: game.date,
          }));
        } else if (bracket.rounds.length > roundCountBefore) {
          // Se acaba de completar una ronda entera y arrancar la siguiente
          // (Bracket.advanceIfPossible, sin recalcular nada aquí) — noticia
          // de competición de baja prioridad, nunca la de campeón (esa ya
          // se generó arriba si corresponde).
          const roundLabel = getActiveBracketRoundLabel(bracket, ['Cuartos de final', 'Semifinales', 'Final']);
          pushNews(BM.buildBracketRoundReachedNewsEvent(roundLabel, {
            competitionLabel, relatedCompetition: competitionKey, dateTime: game.date,
            involvesUser: bracket.currentRound.some((s) => s.betterEntry.team.id === state.userTeamId || s.worseEntry.team.id === state.userTeamId),
          }));
        }
      }
    }

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

    // CAL-1: el próximo partido del usuario ya no es "el de la jornada
    // actual" a secas — se busca cronológicamente en todo el calendario
    // (mismo criterio que usa startUserLeagueMatch/findNextPendingMatchForTeam)
    // para poder mostrar su horario real.
    const userNextMatch = league.isSeasonComplete ? null : findNextPendingMatchForTeam(league, team);

    // CAL-2 (DESIGN.md 3.5): "Última jornada" (CAL-1) se sustituye aquí por
    // el resumen de Noticias de alta prioridad — decisión documentada en
    // DESIGN.md: los resultados de la última jornada ya aparecen como
    // noticia de resultado (siempre alta prioridad si involucran al
    // equipo del usuario), así que mantener las dos tarjetas duplicaba la
    // misma información con dos formatos distintos. `state.lastRoundMatches`
    // se sigue guardando (lo usa Agenda indirectamente al derivar eventos
    // de `league.schedule`, no hace falta un segundo camino), solo deja de
    // tener su propia tarjeta en Home.
    const topNews = [...state.newsLog].filter((e) => e.priority === 'alta').sort((a, b) => b.dateTime - a.dateTime).slice(0, 3);
    const topNewsHtml = topNews.length
      ? topNews.map(newsCardHtml).join('')
      : '<p class="gm-muted">Sin noticias destacadas todavía.</p>';

    const nextMatchHtml = league.isSeasonComplete
      ? '<p class="gm-muted">Liga regular terminada.</p>'
      : userNextMatch
        ? `<p>${matchLabel(userNextMatch, team.id)} <span class="gm-muted">— ${formatMatchDateTime(userNextMatch.date)}</span></p>`
        : '<p class="gm-muted">Tu equipo descansa esta jornada.</p>';

    // DESIGN.md 3.4.2/3.4: cuando las DOS divisiones han terminado su liga
    // regular y TODOS sus brackets, la tarjeta principal se convierte en
    // el aviso de cierre de ciclo — manda incluso sobre un bracket propio
    // ya terminado (activeBracket sería null en ese caso de todos modos,
    // ver getActiveBracket) y sobre la jornada de liga.
    const seasonReadyToClose = isSeasonFullyClosable();

    // MARKET-1 (DESIGN.md 9.19, sección 15.4 del prompt): una decisión de
    // mercado que vence antes del siguiente partido manda incluso sobre
    // el cierre de temporada — nunca se salta una contraoferta o un
    // derecho preferente por avanzar directamente.
    const marketAttention = getMarketAttentionForUser();
    const marketAttentionLabel = marketAttention && marketAttention.type === 'matching-decision-needed'
      ? 'Decidir tanteo' : 'Responder negociación';

    // Mientras haya un bracket (Copa/Playoff/Ascenso) activo y sin
    // terminar, la tarjeta principal de Home se convierte en "el partido
    // que toca ahora" de ese bracket, en vez de la jornada de liga —
    // el usuario no tiene que ir a Competiciones a buscarlo.
    const primaryCardHtml = marketAttention
      ? `
        <div class="gm-card">
          <h3>Mercado espera una decisión</h3>
          <p class="gm-muted">Hay una negociación o un derecho preferente con plazo antes de poder continuar (vence ${marketAttention.dueDate}).</p>
          <button id="gm-goto-market-btn" class="gm-btn gm-btn--primary">${marketAttentionLabel}</button>
        </div>`
      : seasonReadyToClose
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
          <button id="gm-play-bracket-btn" class="gm-btn gm-btn--primary">Continuar</button>
          <button id="gm-goto-lineup-btn" class="gm-btn">Configurar alineación</button>
        </div>`
        : `
        <div class="gm-card">
          <h3>Jornada ${Math.min(league.currentRound, league.totalRounds)} / ${league.totalRounds}</h3>
          ${nextMatchHtml}
          <button id="gm-play-round-btn" class="gm-btn gm-btn--primary" ${league.isSeasonComplete ? 'disabled' : ''}>
            ${league.isSeasonComplete ? 'Temporada regular terminada' : 'Continuar'}
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
      <div class="home-clock">
        <span class="home-clock__label">Hoy</span>
        <span class="home-clock__value">${formatMatchDateTime(state.calendar.currentGameDateTime)}</span>
      </div>
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
          <h3>Noticias destacadas</h3>
          ${topNewsHtml}
          <div class="home-quicklinks">
            <button id="gm-goto-agenda-btn" class="gm-btn" type="button">Ver Agenda</button>
            <button id="gm-goto-news-btn" class="gm-btn" type="button">Ver todas las noticias</button>
          </div>
        </div>
      </div>
    `;

    const goToMarketBtn = byId('gm-goto-market-btn');
    if (goToMarketBtn) {
      goToMarketBtn.addEventListener('click', () => goToScreen('market'));
    }

    const closeSeasonBtn = byId('gm-close-season-btn');
    if (closeSeasonBtn) {
      closeSeasonBtn.addEventListener('click', () => closeSeasonAndPrepareNext());
    }

    const bracketBtn = byId('gm-play-bracket-btn');
    if (bracketBtn) {
      bracketBtn.addEventListener('click', () => {
        if (!getLineupValidity(team).valid) { goToScreen('lineup'); return; }
        const bracketPhaseId = BRACKET_PHASE_IDS[activeBracket.competitionKey];
        playBracketGameWithReveal(
          activeBracket.bracket,
          buildLineupMatchOptionsResolver(team).resolveBracketOptionsFor(activeBracket.bracket, bracketPhaseId),
          activeBracket.competitionKey,
        );
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

    byId('gm-goto-agenda-btn').addEventListener('click', () => goToScreen('agenda'));
    byId('gm-goto-news-btn').addEventListener('click', () => goToScreen('news'));
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

  // ---------------------------------------------------------------------
  // Pantalla: calendario (próximos partidos y resultados pasados)
  // ---------------------------------------------------------------------
  // DESIGN.md 3.3 (Entidad Calendario): fecha real del partido, si la Liga
  // se construyó con un dateResolver de Calendar.js — '—' si no (siempre
  // debería haberlo desde startSeason(), pero se protege igual).
  function formatMatchDate(date) {
    return date ? date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—';
  }

  // CAL-1 (DESIGN.md 3.3.1): hora real de inicio del partido, además de la
  // fecha — antes de esta entrega no existía ninguna hora que mostrar.
  function formatMatchTime(date) {
    return date ? date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—';
  }

  // BUG-LIFE4-01 (ROSTER-1, DESIGN.md 9.16 — corrige LIFE-4, DESIGN.md
  // 9.15): formateador SEMÁNTICO propio para fechas de histórico/carrera
  // (lesiones cerradas, hitos, honores, inicio de histórico) — nunca
  // horarios de partido, que siguen usando `formatMatchTime` (HH:mm) tal
  // cual. Muestra SIEMPRE día/mes/año (nunca solo una hora, que es lo que
  // ocurría antes de esta corrección al reutilizar `formatMatchTime` para
  // estas fechas); ninguna de las tres categorías de fecha histórica tiene
  // hoy información real de hora del día que aportar, así que no se añade.
  function formatHistoryDate(date) {
    return date ? date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }

  function formatMatchDateTime(date) {
    if (!date) return '—';
    const weekday = date.toLocaleDateString('es-ES', { weekday: 'short' });
    return `${weekday} ${formatMatchDate(date)}, ${formatMatchTime(date)}`;
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
          <td>${formatMatchTime(m.date)}</td>
          <td>${venue}</td>
          <td>${opponent.fullName}</td>
          <td>${resultText}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <h2>Calendario — ${team.fullName}</h2>
      <table class="gm-table">
        <thead><tr><th>Jornada</th><th>Fecha</th><th>Hora</th><th>Sede</th><th>Rival</th><th>Resultado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ---------------------------------------------------------------------
  // CAL-2 (DESIGN.md 3.5): pantalla Agenda — "¿qué está pasando en mi vida
  // de manager?", no un renombrado de Calendario (que responde "¿cuándo
  // juego?"). Formato timeline/lista por día (no calendario mensual
  // clásico): pensado para móvil, donde una cuadrícula de mes es incómoda
  // de leer/tocar — decisión justificada en DESIGN.md.
  //
  // Fuente de eventos ÚNICA con Noticias (DESIGN.md, "no negociable"):
  // los de tipo 'match' se derivan bajo demanda de `league.schedule`/
  // brackets (siempre reconstruibles sin pérdida de información real); los
  // ya registrados en `state.newsLog` (noticias, competición) se
  // incorporan literalmente, sin recalcular nada.
  // ---------------------------------------------------------------------
  function addDaysLocal(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Clave de agrupación por día en hora LOCAL (no toISOString, que es UTC
  // y podría desplazar la fecha de un partido de madrugada al día
  // anterior según el huso horario del navegador).
  function dateKey(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }

  function formatAgendaDayHeader(date) {
    const text = date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Partidos de bracket ya jugados/próximos dentro de `[rangeStart,
  // rangeEnd]` — `peekNextGameDate` calcula la fecha del PRÓXIMO partido
  // de una Series sin jugarlo (`series.dateResolver` es una función pura
  // de `(gameIndexInSeries) => Date`, ya fijada por Calendar.
  // buildBracketDateResolver — Bracket.js/Series.js sin tocar).
  function collectBracketAgendaEvents(bracket, competitionKey, rangeStart, rangeEnd, events) {
    if (!bracket) return;
    bracket.rounds.forEach((round) => {
      round.forEach((series) => {
        series.games.forEach((game) => {
          if (!game.date || game.date < rangeStart || game.date > rangeEnd) return;
          events.push(BM.buildMatchAgendaEvent(normalizeBracketGame(game), { relatedCompetition: competitionKey }));
        });
        if (!series.isDecided && series.dateResolver) {
          const nextDate = series.dateResolver(series.games.length);
          if (nextDate && nextDate >= rangeStart && nextDate <= rangeEnd) {
            events.push(BM.makeEvent({
              id: `agenda-pending-${competitionKey}-${series.betterEntry.team.id}-${series.worseEntry.team.id}-${series.games.length}`,
              type: 'match',
              dateTime: nextDate,
              title: `${series.betterEntry.team.fullName} vs ${series.worseEntry.team.fullName}`,
              relatedCompetition: competitionKey,
              status: 'pending',
            }));
          }
        }
      });
    });
  }

  // Eventos de Agenda dentro de un rango de fechas — partidos de liga
  // (SOLO del equipo del usuario, "el foco principal es su propio
  // calendario", decisión de encaje explícita: la liga completa de 9
  // partidos por jornada ya tiene su propia pantalla, Calendario) +
  // partidos de Copa/Playoff/Ascenso de la división visible (todos, no
  // solo los del usuario — coherente con que el resto del juego ya trata
  // cada partido de bracket como parte del "viaje" de tu competición,
  // participe o no tu equipo en ese cruce concreto) + eventos ya
  // registrados en `state.newsLog` (misma fuente que Noticias). NO se
  // muestran partidos individuales de la división de fondo — decisión de
  // alcance documentada en DESIGN.md (ruido de baja relevancia).
  function buildAgendaEvents(rangeStart, rangeEnd) {
    const league = getUserLeague();
    const team = getUserTeam();
    const nextMatch = league.isSeasonComplete ? null : findNextPendingMatchForTeam(league, team);
    const events = [];

    league.schedule.forEach((match) => {
      if (match.homeTeam.id !== team.id && match.awayTeam.id !== team.id) return;
      if (!match.date || match.date < rangeStart || match.date > rangeEnd) return;
      events.push(BM.buildMatchAgendaEvent(match, { relatedCompetition: 'league', requiresAttention: match === nextMatch }));
    });

    const brackets = getBrackets(state.division);
    collectBracketAgendaEvents(brackets.cup, 'cup', rangeStart, rangeEnd, events);
    collectBracketAgendaEvents(brackets.titlePlayoff, 'playoff', rangeStart, rangeEnd, events);
    if (brackets.promotionPlayoff) {
      collectBracketAgendaEvents(brackets.promotionPlayoff.quarterFinals, 'promotion', rangeStart, rangeEnd, events);
      collectBracketAgendaEvents(brackets.promotionPlayoff.finalFour, 'promotion', rangeStart, rangeEnd, events);
    }

    state.newsLog.forEach((event) => {
      if (event.dateTime && event.dateTime >= rangeStart && event.dateTime <= rangeEnd) events.push(event);
    });
    // LIFE-3 (DESIGN.md 9.14, sección 30): eventos médicos (lesión/alta)
    // del equipo del usuario, misma fuente de persistencia que newsLog.
    state.medicalAgendaLog.forEach((event) => {
      if (event.dateTime && event.dateTime >= rangeStart && event.dateTime <= rangeEnd) events.push(event);
    });

    return events.sort((a, b) => a.dateTime - b.dateTime);
  }

  function agendaEventCardHtml(event) {
    const attentionClass = event.requiresAttention ? 'is-attention' : '';
    const pendingClass = event.status === 'pending' ? 'is-pending' : '';
    const priorityClass = event.priority ? `agenda-event--priority-${event.priority}` : '';
    const badge = event.requiresAttention ? '<span class="gm-badge gm-badge--attention">Tu partido</span>' : '';
    return `
      <div class="agenda-event ${attentionClass} ${pendingClass} ${priorityClass}">
        <span class="agenda-event__time">${formatMatchTime(event.dateTime)}</span>
        <span class="agenda-event__title">${event.title}</span>
        ${badge}
      </div>`;
  }

  function renderAgendaScreen() {
    const container = byId('gm-agenda');
    const anchor = state.agendaAnchorDate || state.calendar.currentGameDateTime;
    const rangeStart = addDaysLocal(anchor, -3);
    const rangeEnd = addDaysLocal(anchor, 10);
    const events = buildAgendaEvents(rangeStart, rangeEnd);
    const todayKey = dateKey(state.calendar.currentGameDateTime);

    const groups = new Map();
    events.forEach((event) => {
      const key = dateKey(event.dateTime);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    });
    const sortedKeys = [...groups.keys()].sort();

    const daysHtml = sortedKeys.map((key) => {
      const dayEvents = groups.get(key);
      const isToday = key === todayKey;
      return `
        <div class="agenda-day ${isToday ? 'is-today' : ''}">
          <div class="agenda-day__header">${formatAgendaDayHeader(dayEvents[0].dateTime)}${isToday ? ' <span class="gm-badge gm-badge--done">HOY</span>' : ''}</div>
          <div class="agenda-day__events">${dayEvents.map(agendaEventCardHtml).join('')}</div>
        </div>`;
    }).join('') || '<p class="gm-muted">No hay eventos en este rango de fechas.</p>';

    container.innerHTML = `
      <h2>Agenda</h2>
      <div class="agenda-nav">
        <button id="agenda-prev-btn" class="gm-btn" type="button">◂ Antes</button>
        <button id="agenda-today-btn" class="gm-btn" type="button">Hoy</button>
        <button id="agenda-next-btn" class="gm-btn" type="button">Después ▸</button>
      </div>
      <div class="agenda-timeline">${daysHtml}</div>
    `;

    byId('agenda-prev-btn').addEventListener('click', () => { state.agendaAnchorDate = addDaysLocal(anchor, -7); renderAgendaScreen(); });
    byId('agenda-next-btn').addEventListener('click', () => { state.agendaAnchorDate = addDaysLocal(anchor, 7); renderAgendaScreen(); });
    byId('agenda-today-btn').addEventListener('click', () => { state.agendaAnchorDate = null; renderAgendaScreen(); });
  }

  // ---------------------------------------------------------------------
  // CAL-2 (DESIGN.md 3.5): pantalla Noticias — feed completo de
  // `state.newsLog` (fuente única con Agenda, ver comentario en `state`),
  // más reciente primero. Cada noticia ya trae su categoría/prioridad
  // calculada por Events.js en el momento real en que ocurrió el hecho —
  // esta pantalla solo pinta, no decide nada.
  // ---------------------------------------------------------------------
  const NEWS_PRIORITY_LABELS = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  const NEWS_CATEGORY_LABELS = {
    result: 'Resultado', performance: 'Actuación', streak: 'Racha', standings: 'Clasificación',
    competition: 'Competición', tactical: 'Táctica', surprise: 'Sorpresa',
  };

  function newsCardHtml(event) {
    return `
      <div class="news-card news-card--priority-${event.priority || 'baja'}">
        <div class="news-card__meta">
          <span class="gm-badge news-card__priority">${NEWS_PRIORITY_LABELS[event.priority] || ''}</span>
          <span class="gm-muted news-card__category">${NEWS_CATEGORY_LABELS[event.newsCategory] || ''}</span>
          <span class="gm-muted news-card__date">${formatMatchDateTime(event.dateTime)}</span>
        </div>
        <h4 class="news-card__title">${event.title}</h4>
        ${event.body ? `<p class="gm-muted news-card__body">${event.body}</p>` : ''}
        ${event.relatedPlayer ? `<p class="news-card__player">${playerLinkHtmlById(event.relatedPlayer.id, event.relatedPlayer.fullName)}</p>` : ''}
      </div>`;
  }

  function renderNewsScreen() {
    const container = byId('gm-news');
    const feed = [...state.newsLog].sort((a, b) => b.dateTime - a.dateTime);
    const body = feed.length
      ? feed.map(newsCardHtml).join('')
      : '<p class="gm-muted">Todavía no hay noticias — juega alguna jornada desde Inicio.</p>';
    container.innerHTML = `
      <h2>Noticias</h2>
      <div class="news-feed">${body}</div>
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
    const advanceBracket = (bracket, competitionKey) => {
      if (!getLineupValidity(team).valid) { goToScreen('lineup'); return; }
      const bracketPhaseId = BRACKET_PHASE_IDS[competitionKey];
      playBracketGameWithReveal(
        bracket, buildLineupMatchOptionsResolver(team).resolveBracketOptionsFor(bracket, bracketPhaseId), competitionKey,
      );
    };

    const cupBtn = byId('gm-advance-cup-btn');
    if (cupBtn) cupBtn.addEventListener('click', () => advanceBracket(brackets.cup, 'cup'));

    const playoffBtn = byId('gm-advance-playoff-btn');
    if (playoffBtn) playoffBtn.addEventListener('click', () => advanceBracket(brackets.titlePlayoff, 'playoff'));

    const promoBtn = byId('gm-advance-promotion-btn');
    if (promoBtn) promoBtn.addEventListener('click', () => advanceBracket(brackets.promotionPlayoff, 'promotion'));
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
        playerId: line.playerId,
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
        <td>${playerLinkHtmlById(p.playerId, p.name)}</td>
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
  // resumen de minutos totales, desplegables de quinteto fijo). REG-1
  // (DESIGN.md 9.18): resuelve desde el POOL regulado (senior+propios+
  // vinculados), nunca solo `team.roster` — un vinculado convocado no
  // pertenece al roster del club beneficiario.
  function getConvocatedPlayers(team) {
    const { POSITIONS } = BM;
    const { pool } = getLineupPool(team);
    return state.lineup.squadIds
      .map((id) => { const entry = pool.find((p) => p.player.id === id); return entry ? entry.player : null; })
      .filter(Boolean)
      .sort((a, b) => POSITIONS.indexOf(a.primaryPosition) - POSITIONS.indexOf(b.primaryPosition));
  }

  // Suma de los 3 slots de una fila (posición) — usada por el contador en
  // vivo "35/40" de cada fila de la tabla.
  function rowMinutesSum(lineup, pos) {
    return SLOT_KEYS.reduce((acc, slotKey) => acc + ((lineup.entries[pos][slotKey] && lineup.entries[pos][slotKey].minutesQuota) || 0), 0);
  }

  // LIFE-3 (DESIGN.md 9.14, sección 22/23 del prompt de esa sesión): fecha
  // de referencia para Medical.getAvailability() al validar la Alineación
  // — se usa el reloj de mundo actual (el usuario edita la alineación
  // "ahora", el estado médico real en la fecha exacta del partido puede
  // variar ligeramente hasta jugarlo, igual que ya pasa con Energía).
  // REG-1: itera sobre el POOL regulado, no solo `team.roster`.
  function getLineupMedicalAvailability(team) {
    const { CONFIG_BASE, getAvailability } = BM;
    if (!CONFIG_BASE.medical.enabled) return null;
    const referenceDate = state.calendar.currentGameDateTime;
    const { pool } = getLineupPool(team);
    const map = new Map();
    pool.forEach((entry) => map.set(entry.player.id, getAvailability(entry.player, referenceDate, CONFIG_BASE, { team })));
    return map;
  }

  // Traducción de códigos de razón estables (EligibilityService/
  // SquadEligibilityService) a texto — SOLO en la capa de presentación,
  // nunca como clave de lógica (sección 6.6 del prompt de REG-1).
  const REASON_CODE_LABELS = {
    PLAYER_NOT_FOUND: 'jugador no encontrado',
    NO_VALID_FEDERATION_LICENSE: 'sin licencia federativa válida',
    LICENSE_SUSPENDED: 'licencia suspendida',
    NOT_REGISTERED_IN_SCOPE: 'sin inscripción en este ámbito',
    REGISTRATION_NOT_EFFECTIVE: 'inscripción no efectiva',
    REGISTRATION_SUSPENDED: 'inscripción suspendida',
    CONTRACT_NOT_ACTIVE: 'sin contrato vigente',
    MANDATORY_DOCUMENT_MISSING: 'falta documento imprescindible',
    PROVISIONAL_AUTHORIZATION_INVALID: 'autorización provisional inválida',
    INTERNATIONAL_CLEARANCE_REQUIRED: 'requiere autorización internacional',
    LINK_AGREEMENT_INVALID: 'acuerdo de vinculación inválido',
    LINKED_PLAYER_NOT_ON_LIST: 'vinculado fuera de la lista autorizada',
    LINKED_PLAYER_AGE_OR_CATEGORY_INVALID: 'edad/categoría no válida para vinculación',
    SAME_COMPETITION_LINK_INEFFECTIVE: 'vinculación ineficaz (misma competición)',
    ALREADY_ON_OTHER_ACT_SAME_ROUND: 'ya en otra acta esta jornada',
    MEDICALLY_UNAVAILABLE: 'no disponible por lesión',
    DISCIPLINARY_SUSPENSION: 'sanción disciplinaria',
    CLASSIFICATION_UNKNOWN: 'clasificación regulatoria desconocida',
  };

  function describeReasonCodes(codes) {
    return codes.map((code) => REASON_CODE_LABELS[code] || code).join(', ');
  }

  function describeSquadFinding(finding, pool) {
    switch (finding.code) {
      case 'SQUAD_SIZE_OUT_OF_RANGE':
        return `La convocatoria debe tener entre ${finding.params.min} y ${finding.params.max} jugadores (actual: ${finding.params.actual})`;
      case 'DUPLICATE_PLAYER_IN_SQUAD':
        return 'Hay un jugador repetido en la convocatoria';
      case 'INELIGIBLE_PLAYER_IN_SQUAD': {
        const details = finding.params.playerIds.map((id) => {
          const entry = pool.find((p) => p.player.id === id);
          const name = entry ? entry.player.fullName : id;
          const codes = entry ? entry.evaluation.reasons.filter((r) => r.severity === 'blocking').map((r) => r.code) : [];
          return `${name} (${describeReasonCodes(codes) || 'no elegible'})`;
        }).join('; ');
        return `No elegible para este partido: ${details}`;
      }
      case 'FORMATION_QUOTA_NOT_MET':
        return `Cupo de formación no cumplido (mínimo ${finding.params.required}, actual ${finding.params.actual})`;
      case 'NON_COMMUNITY_CAP_EXCEEDED':
        return `Supera el máximo de jugadores no comunitarios (máximo ${finding.params.max}, actual ${finding.params.actual})`;
      default:
        return finding.code;
    }
  }

  // REG-1 (sección 11.4 del prompt): adaptador de UI sobre
  // `Rotation.validateOnCourtFormationQuota()` (módulo PURO — ver
  // Rotation.js): construye el `Set` de formación desde el pool ya
  // evaluado y traduce el resultado a mensaje. ACB (sin esta capacidad) no
  // ejecuta ninguna comprobación.
  function validateOnCourtFormationQuota(lineup, pool, resolved) {
    const minRequired = resolved.registration && resolved.registration.onCourtConstraints
      && resolved.registration.onCourtConstraints.minFormationOnCourtAtAllTimes;
    if (!minRequired) return { valid: true, message: null };
    const formationQualifyingPlayerIds = new Set(
      pool.filter((entry) => entry.evaluation.classification.formation.status === 'qualifies').map((entry) => entry.player.id),
    );
    const result = BM.validateOnCourtFormationQuota(lineup, formationQualifyingPlayerIds, minRequired);
    if (result.valid) return { valid: true, message: null };
    return { valid: false, message: `Cupo de formación en pista no cumplido: ${BM.describeOnCourtFormationQuotaErrors(result.errors)}` };
  }

  // Validación completa (REG-1, DESIGN.md 9.18): conjunto de la
  // convocatoria vía `SquadEligibilityService.validateSquad()` — el MISMO
  // servicio que usa la CPU — sobre el POOL regulado, NUNCA solo el rango
  // 8-12/pertenencia a `team.roster` de antes de esta entrega. Se añaden
  // Rotation.validateLineup (cuotas de minutos), el tope médico de minutos
  // (LIFE-3) y el cupo de formación en pista (Primera FEB).
  function getLineupValidity(team) {
    const {
      CONFIG_BASE, validateLineup, describeValidationErrors, totalMinutesByPlayer, SquadEligibilityService,
      getAvailability, resolveEffectiveSquadMinimum,
    } = BM;
    const { resolved, pool } = getLineupPool(team);
    const evaluations = new Map(pool.map((entry) => [entry.player.id, entry.evaluation]));
    // Misma excepción médica de convocatoria que usa la CPU (DESIGN.md,
    // "Excepción médica de convocatoria") — el usuario no puede quedar
    // bloqueado exigiendo un mínimo normal que la plantilla, por escasez
    // médica real, no puede cumplir.
    const referenceDate = state.calendar.currentGameDateTime;
    const callableCount = pool.filter((entry) => (
      entry.evaluation.eligible && getAvailability(entry.player, referenceDate, CONFIG_BASE, { team }).status !== 'unavailable'
    )).length;
    const effectiveMin = resolveEffectiveSquadMinimum(resolved.squadRules.min, CONFIG_BASE, callableCount);
    const squadValidation = SquadEligibilityService.validateSquad(
      state.lineup.squadIds, evaluations, resolved, { effectiveMin },
    );
    if (!squadValidation.valid) {
      const messages = squadValidation.findings
        .filter((f) => f.severity !== 'informational')
        .map((f) => describeSquadFinding(f, pool));
      return { valid: false, message: messages.join(' · ') };
    }
    const validation = validateLineup(
      { entries: state.lineup.entries, fixedSegments: state.lineup.fixedSegments },
      CONFIG_BASE,
    );
    if (!validation.valid) {
      return { valid: false, message: describeValidationErrors(validation.errors) };
    }
    const availability = getLineupMedicalAvailability(team);
    if (availability) {
      const totals = totalMinutesByPlayer(state.lineup);
      const overCap = Object.keys(totals).filter((id) => {
        const info = availability.get(id);
        return info && info.status === 'limited' && totals[id] > info.minuteCap;
      });
      if (overCap.length) {
        const detail = overCap.map((id) => {
          const info = availability.get(id);
          const entry = pool.find((p) => p.player.id === id);
          const name = entry ? entry.player.fullName : id;
          return `${name} (máx. médico ${info.minuteCap} min)`;
        }).join(', ');
        return { valid: false, message: `Supera el máximo médico de minutos: ${detail}` };
      }
    }
    const onCourtCheck = validateOnCourtFormationQuota(state.lineup, pool, resolved);
    if (!onCourtCheck.valid) return onCourtCheck;
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

  // REG-1 (DESIGN.md 9.18, BUG-CONTRACT1-01): el máximo de selección ya NO
  // es un `12` oculto — procede SIEMPRE del contexto del partido concreto
  // (`resolveTeamSquadRules(team).max`), igual que la cabecera y la
  // validación posterior. Una competición fixture con máximo 9 (o el
  // acta 15 del perfil U22 de referencia) queda respetada aquí también.
  function toggleSquadMember(team, playerId) {
    const lineup = state.lineup;
    const idx = lineup.squadIds.indexOf(playerId);
    if (idx >= 0) {
      lineup.squadIds.splice(idx, 1);
      removePlayerFromAllSlots(playerId);
    } else {
      const { resolved, pool } = getLineupPool(team);
      if (lineup.squadIds.length >= resolved.squadRules.max) return; // máximo de convocatoria de ESTA competición/partido
      // REG-1 (DESIGN.md 9.18, sección 11.2 del prompt): un jugador
      // inelegible no puede AÑADIRSE a la convocatoria (defensa en
      // profundidad — el checkbox ya se deshabilita en el HTML, esto
      // protege también cambios de estado entre renders).
      const entry = pool.find((p) => p.player.id === playerId);
      if (entry && !entry.evaluation.eligible) return;
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
    body.innerHTML = renderPlayerTotalsRows(getConvocatedPlayers(team), team);
  }

  // LIFE-3 (DESIGN.md 9.14, sección 22): muestra el máximo médico junto al
  // total real de minutos de un jugador `limited` — nunca la fórmula ni la
  // probabilidad, solo el hecho ("Máximo médico: 18 min").
  function renderPlayerTotalsRows(convocated, team) {
    const totals = BM.totalMinutesByPlayer(state.lineup);
    if (convocated.length === 0) return '<tr><td colspan="2" class="gm-muted">Sin convocados todavía.</td></tr>';
    const availability = getLineupMedicalAvailability(team);
    return convocated.map((player) => {
      const total = totals[player.id] || 0;
      const info = availability && availability.get(player.id);
      let capHtml = '';
      if (info && info.status === 'limited') {
        const over = total > info.minuteCap;
        capHtml = ` <span class="${over ? 'lineup-medical-cap is-bad' : 'lineup-medical-cap'}">(máx. médico ${info.minuteCap} min)</span>`;
      }
      return `<tr><td>${player.fullName}</td><td>${total} min${capHtml}</td></tr>`;
    }).join('');
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
    // REG-1 (DESIGN.md 9.18): pool REGULADO (senior+propios+vinculados) +
    // reglas COMPLETAS del próximo partido — nunca el rango 8-12 universal
    // ni solo `team.roster` de antes de esta entrega (ROSTER-1 ya había
    // resuelto el rango real de convocatoria; REG-1 añade el pool, las
    // clasificaciones y los cupos colectivos).
    const { resolved, pool } = getLineupPool(team);
    const squadRules = resolved.squadRules;
    const evaluationsById = new Map(pool.map((entry) => [entry.player.id, entry.evaluation]));

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

    const sortedPool = [...pool].sort((a, b) => {
      const posDiff = POSITIONS.indexOf(a.player.primaryPosition) - POSITIONS.indexOf(b.player.primaryPosition);
      return posDiff !== 0 ? posDiff : a.player.fullName.localeCompare(b.player.fullName, 'es');
    });

    // Convocatoria: checkboxes con nombre, posición y valoraciones en
    // estrellas (DESIGN.md 7.11.6) — antes vivían en la tarjeta de
    // "Convocados" de abajo; se trasladan aquí porque esa tarjeta desaparece
    // (sustituida por la tabla de slots), y 7.11.6 exige mostrarlas para
    // cada convocado en algún sitio de esta pantalla. Ver nota en la
    // respuesta final: es un traslado del mismo bloque, no un rediseño del
    // mecanismo de checkboxes en sí.
    // LIFE-3 (DESIGN.md 9.14, sección 22): badge médico junto a cada
    // jugador — no bloquea el checkbox (el usuario puede desconvocarlo
    // libremente), la Alineación se invalida vía getLineupValidity().
    const lineupAvailability = getLineupMedicalAvailability(team);
    function medicalBadgeHtml(player) {
      const info = lineupAvailability && lineupAvailability.get(player.id);
      if (!info || info.status === 'available') return '';
      if (info.status === 'unavailable') return '<span class="gm-badge gm-badge--injury">No disponible por lesión</span>';
      return `<span class="gm-badge gm-badge--limited">Máximo médico: ${info.minuteCap} min</span>`;
    }
    // ROSTER-1 (DESIGN.md 9.16): un jugador generado como relleno de un
    // roster real con cobertura de datos incompleta (hoy: algunos clubes
    // de Primera FEB) nunca debe presentarse como jugador real — badge de
    // solo lectura, mismo patrón que `medicalBadgeHtml`.
    function fictionalFallbackBadgeHtml(player) {
      if (player.dataSource !== BM.FICTIONAL_FALLBACK_DATA_SOURCE) return '';
      return '<span class="gm-badge gm-badge--fictional" title="Jugador ficticio generado por cobertura de datos incompleta">Ficticio (relleno de plantilla)</span>';
    }
    // REG-1 (DESIGN.md 9.18, sección 11.2 del prompt): badges de acceso
    // (Senior/Propio/Vinculado), clasificación (Formación/No comunitario),
    // procedencia simulada y motivo de no-elegibilidad — texto además de
    // color (sección 13.3: accesibilidad).
    const ACCESS_CATEGORY_LABELS = {
      senior: 'Senior', 'own-lower-category': 'Propio', linked: 'Vinculado', 'additional-list': 'Lista adicional',
    };
    function accessCategoryBadgeHtml(entry) {
      const label = ACCESS_CATEGORY_LABELS[entry.accessCategory] || entry.accessCategory;
      return `<span class="gm-badge gm-badge--access-${entry.accessCategory}">${label}</span>`;
    }
    function classificationBadgesHtml(entry) {
      const c = entry.evaluation.classification;
      let html = '';
      if (c.formation.status === 'qualifies') html += '<span class="gm-badge gm-badge--formation">Formación</span>';
      if (c.formation.status === 'unknown') html += '<span class="gm-badge gm-badge--unknown">Formación: desconocida</span>';
      if (c.nonCommunitySlot.status === 'counts') html += '<span class="gm-badge gm-badge--noncommunity">No comunitario</span>';
      return html;
    }
    function simulatedRegistrationBadgeHtml() {
      return '<span class="gm-badge gm-badge--simulated" title="Inscripción y clasificación simuladas para esta partida; no son datos federativos reales.">Simulado</span>';
    }
    function eligibilityBadgeHtml(entry) {
      if (entry.evaluation.eligible) return '';
      const codes = entry.evaluation.reasons.filter((r) => r.severity === 'blocking').map((r) => r.code);
      return `<span class="gm-badge gm-badge--ineligible">No elegible: ${describeReasonCodes(codes)}</span>`;
    }
    // LIFE-4 (DESIGN.md 9.15, sección 45): nombre clicable sin activar el
    // checkbox — ya NO es un único <label> envolviendo todo la fila (eso
    // convertiría el nombre en "botón dentro de label ambiguo"): el
    // checkbox vive en su propio <label> pequeño, y el nombre es un botón
    // hermano fuera de él. REG-1: un jugador INELEGIBLE se muestra
    // deshabilitado con sus motivos (sección 11.2), nunca desaparece sin
    // explicación — solo se deshabilita si NO está ya convocado (para que
    // el usuario siempre pueda desconvocar a alguien que dejó de ser
    // elegible tras un cambio de contexto).
    const squadPickerHtml = sortedPool.map((entry) => {
      const { player } = entry;
      const isSelected = lineup.squadIds.includes(player.id);
      const disableCheckbox = !entry.evaluation.eligible && !isSelected;
      return `
      <div class="squad-picker__item ${entry.evaluation.eligible ? '' : 'squad-picker__item--ineligible'}">
        <label class="squad-picker__checkbox-wrap">
          <input type="checkbox" class="squad-checkbox" data-player-id="${player.id}"
            ${isSelected ? 'checked' : ''} ${disableCheckbox ? 'disabled' : ''}>
        </label>
        ${playerLinkHtml(player, { className: 'squad-picker__name' })}
        <span class="squad-picker__pos">${player.primaryPosition}</span>
        ${accessCategoryBadgeHtml(entry)}
        ${classificationBadgesHtml(entry)}
        ${simulatedRegistrationBadgeHtml()}
        ${medicalBadgeHtml(player)}
        ${fictionalFallbackBadgeHtml(player)}
        ${eligibilityBadgeHtml(entry)}
        <span class="squad-picker__ratings">
          <span>T ${player.technicalAverage.toFixed(1)}</span>
          <span>F ${player.physicalAverage.toFixed(1)}</span>
          <span>M ${player.mentalAverage.toFixed(1)}</span>
          <span>Resistencia ${player.physical.stamina}</span>
          <span>Energía ${Math.round(player.dynamicState.energy)}</span>
          <span class="squad-picker__form">Forma ${competitionRhythmToStars(player.dynamicState.competitionRhythm)}</span>
        </span>
      </div>`;
    }).join('');

    // REG-1 (sección 11.2 del prompt): contadores en vivo — seleccionados/
    // mínimo/máximo, formación requerida/actual, no comunitarios actual/
    // máximo y restricción en pista, si existe.
    // Misma excepción médica de convocatoria que valida `getLineupValidity`
    // — los contadores en vivo deben mostrar el mínimo REAL de este
    // partido, no el normal, si hay escasez médica genuina.
    const liveCallableCount = pool.filter((entry) => (
      entry.evaluation.eligible && BM.getAvailability(entry.player, state.calendar.currentGameDateTime, CONFIG_BASE, { team }).status !== 'unavailable'
    )).length;
    const liveEffectiveMin = BM.resolveEffectiveSquadMinimum(squadRules.min, CONFIG_BASE, liveCallableCount);
    const liveCounters = BM.SquadEligibilityService.buildLiveCounters(
      lineup.squadIds, evaluationsById, resolved, { effectiveMin: liveEffectiveMin },
    );
    const liveCountersHtml = `
      <p class="lineup-live-counters">
        Formación: ${liveCounters.formationCurrent}${liveCounters.formationRequired !== null ? `/${liveCounters.formationRequired} mínimo` : ''}
        · No comunitarios: ${liveCounters.nonCommunityCurrent}${liveCounters.nonCommunityMax !== null ? `/${liveCounters.nonCommunityMax} máximo` : ''}
        ${liveCounters.onCourtConstraint ? ` · Mínimo en pista: ${liveCounters.onCourtConstraint.minFormationOnCourtAtAllTimes} de formación` : ''}
      </p>`;

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
        <tbody id="lineup-player-totals-body">${renderPlayerTotalsRows(convocated, team)}</tbody>
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
        <h3>Convocatoria (${lineup.squadIds.length}/${squadRules.max}, mínimo ${squadRules.min})</h3>
        ${liveCountersHtml}
        <div class="squad-picker">${squadPickerHtml}</div>
      </div>

      <div class="gm-card">
        <h3>Alineación por posición</h3>
        ${convocated.length ? slotsTableHtml : `<p class="gm-muted">Selecciona al menos ${squadRules.min} jugadores en la convocatoria.</p>`}
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
  // Pantalla: Entrenamiento (LIFE-2, DESIGN.md 9, subsección normativa
  // LIFE-2) — capa de presentación pura sobre src/core/Training.js/
  // TrainingAI.js: no contiene ninguna regla de entrenamiento propia, solo
  // lee/escribe `team.trainingPlan` y llama a los helpers ya construidos
  // ahí (mismo criterio que Alineación es una capa sobre Rotation.js).
  // ---------------------------------------------------------------------
  const TRAINING_TEAM_FOCUS_LABELS = {
    balanced: 'Equilibrado', offense: 'Ataque', defense: 'Defensa', physical: 'Físico', tactical: 'Táctico',
  };
  const TRAINING_TEAM_FOCUS_INFO = {
    balanced: { favors: 'Desarrollo parejo de todos los atributos.', costs: 'Ninguna prioridad especial.' },
    offense: { favors: 'Tiro, manejo, pase y visión de juego.', costs: 'La mejora defensiva va más lenta.' },
    defense: { favors: 'Rebote, tapón, robo, defensa y anticipación.', costs: 'La mejora ofensiva va más lenta.' },
    physical: { favors: 'Velocidad, salto, fuerza, agilidad y resistencia.', costs: 'Lo técnico y lo mental van más lentos.' },
    tactical: { favors: 'Familiaridad con el sistema, las jugadas y los roles.', costs: 'El desarrollo general de atributos va más lento.' },
  };
  const TRAINING_INTENSITY_LABELS = {
    recovery: 'Recuperación', light: 'Suave', normal: 'Normal', high: 'Alta',
  };
  const TRAINING_INTENSITY_INFO = {
    recovery: 'Prioriza llegar descansado — desarrollo más lento, Energía sube más.',
    light: 'Ritmo suave — algo menos de desarrollo, cuida bastante la Energía.',
    normal: 'Ritmo estándar — ni favorece ni penaliza especialmente.',
    high: 'Exige más — más desarrollo, pero castiga la Energía y la recuperación.',
  };
  const TRAINING_FOCUS_TYPE_LABELS = {
    none: 'Ninguno', attribute: 'Atributo', position: 'Posición', role: 'Rol táctico',
  };
  // Mismas traducciones ya usadas como comentario en Player.js (TECHNICAL_
  // ATTRIBUTES/PHYSICAL_ATTRIBUTES/MENTAL_ATTRIBUTES) — no se inventa una
  // segunda nomenclatura para los mismos 29 atributos mutables.
  const TRAINING_ATTRIBUTE_LABELS = {
    outsideShot: 'Tiro exterior', midRangeShot: 'Tiro media distancia', insideShot: 'Tiro interior', freeThrows: 'Tiro libre',
    layup: 'Bandeja', passing: 'Pase', ballHandling: 'Manejo de balón', offensiveRebound: 'Rebote ofensivo',
    defensiveRebound: 'Rebote defensivo', blocking: 'Tapón', stealing: 'Robo', perimeterDefense: 'Defensa perimetral',
    interiorDefense: 'Defensa interior', topSpeed: 'Velocidad punta', acceleration: 'Aceleración', jumping: 'Salto',
    strength: 'Fuerza', agility: 'Agilidad', balance: 'Balance', stamina: 'Resistencia', recovery: 'Recuperación física',
    gameVision: 'Visión de juego', pressureDecisionMaking: 'Decisión bajo presión', concentration: 'Concentración',
    leadership: 'Liderazgo', teamwork: 'Trabajo en equipo', consistency: 'Consistencia', anticipation: 'Anticipación',
    positioning: 'Posicionamiento',
  };

  function trainingAttributeLabel(attr) { return TRAINING_ATTRIBUTE_LABELS[attr] || attr; }

  function renderTrainingPlanBlockHtml(team) {
    const { TEAM_FOCUS_OPTIONS, INTENSITY_OPTIONS } = BM;
    const focusOptionsHtml = TEAM_FOCUS_OPTIONS.map((f) => `
      <option value="${f}" ${team.trainingPlan.teamFocus === f ? 'selected' : ''}>${TRAINING_TEAM_FOCUS_LABELS[f]}</option>`).join('');
    const intensityOptionsHtml = INTENSITY_OPTIONS.map((i) => `
      <option value="${i}" ${team.trainingPlan.intensity === i ? 'selected' : ''}>${TRAINING_INTENSITY_LABELS[i]}</option>`).join('');
    const focusInfo = TRAINING_TEAM_FOCUS_INFO[team.trainingPlan.teamFocus] || TRAINING_TEAM_FOCUS_INFO.balanced;
    const intensityInfo = TRAINING_INTENSITY_INFO[team.trainingPlan.intensity] || TRAINING_INTENSITY_INFO.normal;
    return `
      <div class="gm-card">
        <h3>Plan de entrenamiento</h3>
        <label class="training-plan-field">Enfoque
          <select id="training-team-focus-select">${focusOptionsHtml}</select>
        </label>
        <p class="gm-muted">Favorece: ${focusInfo.favors}<br>Sacrifica: ${focusInfo.costs}</p>
        <label class="training-plan-field">Intensidad
          <select id="training-intensity-select">${intensityOptionsHtml}</select>
        </label>
        <p class="gm-muted">${intensityInfo}</p>
        <button id="training-save-plan-btn" class="gm-btn gm-btn--primary">Guardar plan</button>
        <span id="training-save-confirmation" class="gm-muted training-save-confirmation"></span>
      </div>`;
  }

  // Bloque B (sección 28): próximo microciclo — margen/carga vía el mismo
  // helper que usa el motor (Training.describeMicrocycle), nunca una
  // fórmula duplicada de UI; Energía estimada al próximo partido vía
  // Training.projectEnergyToDate (puro, no muta estado).
  function renderTrainingMicrocycleHtml(team) {
    const { describeMicrocycle, projectEnergyToDate, CONFIG_BASE } = BM;
    const activeBracket = getActiveBracket();
    let nextMatchDate = null;
    let nextMatchHtml;
    if (activeBracket) {
      nextMatchHtml = `<p>${activeBracket.title} — ${activeBracket.roundLabel}</p>`;
    } else {
      const league = getUserLeague();
      const nextMatches = league.isSeasonComplete ? [] : league.getCurrentRoundMatches();
      const userNextMatch = nextMatches.find((m) => m.homeTeam.id === team.id || m.awayTeam.id === team.id);
      nextMatchDate = userNextMatch ? userNextMatch.date : null;
      nextMatchHtml = league.isSeasonComplete
        ? '<p class="gm-muted">Liga regular terminada.</p>'
        : userNextMatch
          ? `<p>${matchLabel(userNextMatch, team.id)}</p>`
          : '<p class="gm-muted">Tu equipo descansa esta jornada.</p>';
    }

    const referenceNow = state.calendar.currentGameDateTime;
    const matchesInNext7Days = countUpcomingMatchesForTeam(team, referenceNow, 7);
    const micro = describeMicrocycle(team, matchesInNext7Days, CONFIG_BASE);

    let alertsHtml = '<p class="gm-muted">Sin próximo partido de liga programado.</p>';
    if (nextMatchDate) {
      const calendarCtx = buildTrainingCalendarContext();
      const alerts = team.roster
        .map((player) => ({ player, projected: projectEnergyToDate(player, team, nextMatchDate, CONFIG_BASE, calendarCtx) }))
        .filter((a) => a.projected < 70)
        .sort((a, b) => a.projected - b.projected);
      alertsHtml = alerts.length
        ? `<ul class="training-energy-alerts">${alerts.map((a) => `<li>${a.player.fullName}: Energía estimada ${Math.round(a.projected)}</li>`).join('')}</ul>`
        : '<p class="gm-muted">Ningún jugador proyecta llegar con Energía baja.</p>';
    }

    // LIFE-3 (DESIGN.md 9.14, sección 33 del prompt de esa sesión): resumen
    // de riesgo médico del microciclo — mismo helper real de Medical.js
    // (`describeRiskBand`), nunca una fórmula duplicada aquí.
    let medicalRiskHtml = '';
    if (CONFIG_BASE.medical.enabled) {
      const referenceDate = state.calendar.currentGameDateTime;
      const highRisk = team.roster.filter((p) => {
        const band = BM.describeRiskBand(p, referenceDate, CONFIG_BASE, team);
        return band === 'alto' || band === 'muyAlto';
      }).length;
      medicalRiskHtml = `<p>Jugadores con riesgo médico Alto/Muy alto: <strong>${highRisk}</strong></p>`;
    }

    return `
      <div class="gm-card">
        <h3>Próximo microciclo</h3>
        ${nextMatchHtml}
        <p>Partidos en los próximos 7 días: <strong>${matchesInNext7Days}</strong></p>
        <p>Margen de entrenamiento: <strong>${micro.marginLabel}</strong> · Carga prevista: <strong>${micro.loadLabel}</strong></p>
        ${medicalRiskHtml}
        <h4>Alertas de Energía baja al próximo partido</h4>
        ${alertsHtml}
      </div>`;
  }

  function renderTrainingFocusRow(player, team) {
    const {
      FOCUS_TYPES, getIndividualFocus, CONFIG_BASE, MUTABLE_TECHNICAL, MUTABLE_PHYSICAL, MUTABLE_MENTAL,
      POSITIONS, OFFENSIVE_ROLES, DEFENSIVE_ROLES,
    } = BM;
    const focus = getIndividualFocus(team, player.id, CONFIG_BASE);
    const typeOptionsHtml = FOCUS_TYPES.map((t) => `
      <option value="${t}" ${focus.type === t ? 'selected' : ''}>${TRAINING_FOCUS_TYPE_LABELS[t]}</option>`).join('');

    let targetHtml = '<span class="gm-muted">—</span>';
    if (focus.type === 'attribute') {
      const groupOptions = (attrs, label) => `<optgroup label="${label}">${attrs.map((a) => `
        <option value="${a}" ${focus.target === a ? 'selected' : ''}>${trainingAttributeLabel(a)}</option>`).join('')}</optgroup>`;
      targetHtml = `<select class="training-focus-target-select" data-player-id="${player.id}" data-type="attribute">
        ${groupOptions(MUTABLE_TECHNICAL, 'Técnico')}${groupOptions(MUTABLE_PHYSICAL, 'Físico')}${groupOptions(MUTABLE_MENTAL, 'Mental')}
      </select>`;
    } else if (focus.type === 'position') {
      const options = POSITIONS.map((pos) => `
        <option value="${pos}" ${focus.target === pos ? 'selected' : ''}>${pos} (nivel ${player.positionLevel(pos)})</option>`).join('');
      targetHtml = `<select class="training-focus-target-select" data-player-id="${player.id}" data-type="position">${options}</select>`;
    } else if (focus.type === 'role') {
      const currentValue = `${focus.side}:${focus.target}`;
      const offenseOptions = OFFENSIVE_ROLES.map((r) => `
        <option value="offense:${r.id}" ${currentValue === `offense:${r.id}` ? 'selected' : ''}>${r.label}</option>`).join('');
      const defenseOptions = DEFENSIVE_ROLES.map((r) => `
        <option value="defense:${r.id}" ${currentValue === `defense:${r.id}` ? 'selected' : ''}>${r.label}</option>`).join('');
      targetHtml = `<select class="training-focus-target-select" data-player-id="${player.id}" data-type="role">
        <optgroup label="Ataque">${offenseOptions}</optgroup>
        <optgroup label="Defensa">${defenseOptions}</optgroup>
      </select>`;
    }

    // LIFE-3 (DESIGN.md 9.14, sección 33 del prompt de esa sesión): badge
    // médico + aviso de foco "suspendido/reducido por rehabilitación" — sin
    // controles médicos propios en esta pantalla, solo lectura.
    let medicalHtml = '';
    if (CONFIG_BASE.medical.enabled) {
      const info = BM.getAvailability(player, state.calendar.currentGameDateTime, CONFIG_BASE, { team });
      if (info.status === 'unavailable') {
        medicalHtml = '<span class="gm-badge gm-badge--injury">Lesionado</span><br><span class="gm-muted">Foco suspendido por rehabilitación</span>';
      } else if (info.status === 'limited') {
        medicalHtml = `<span class="gm-badge gm-badge--limited">Retorno limitado</span><br><span class="gm-muted">Foco reducido por rehabilitación</span>`;
      }
    }

    return `
      <tr>
        <td>${playerLinkHtml(player)}${medicalHtml}</td>
        <td>${player.age}</td>
        <td>${Math.round(player.dynamicState.energy)}</td>
        <td><select class="training-focus-type-select" data-player-id="${player.id}">${typeOptionsHtml}</select></td>
        <td>${targetHtml}</td>
      </tr>`;
  }

  function renderTrainingScreen() {
    const container = byId('gm-training');
    const team = getUserTeam();
    if (!container) return;
    if (!team) { container.innerHTML = ''; return; }
    const {
      setPlan, setIndividualFocus, CONFIG_BASE, MUTABLE_TECHNICAL, POSITIONS, OFFENSIVE_ROLES,
    } = BM;

    const sortedRoster = [...team.roster].sort((a, b) => {
      const posDiff = POSITIONS.indexOf(a.primaryPosition) - POSITIONS.indexOf(b.primaryPosition);
      return posDiff !== 0 ? posDiff : a.fullName.localeCompare(b.fullName, 'es');
    });
    const rowsHtml = sortedRoster.map((player) => renderTrainingFocusRow(player, team)).join('');

    container.innerHTML = `
      <h2>Entrenamiento</h2>
      ${renderTrainingPlanBlockHtml(team)}
      ${renderTrainingMicrocycleHtml(team)}
      <div class="gm-card">
        <h3>Focos individuales</h3>
        <div class="gm-table-scroll">
          <table class="gm-table training-focus-table">
            <thead><tr><th>Jugador</th><th>Edad</th><th>Energía</th><th>Tipo de foco</th><th>Objetivo</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    const saveBtn = byId('training-save-plan-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const teamFocus = byId('training-team-focus-select').value;
        const intensity = byId('training-intensity-select').value;
        setPlan(team, { teamFocus, intensity }, state.calendar.currentGameDateTime, CONFIG_BASE, buildTrainingCalendarContext());
        const confirmation = byId('training-save-confirmation');
        if (confirmation) {
          confirmation.textContent = ' ✔ Plan guardado.';
          setTimeout(() => { if (confirmation.isConnected) confirmation.textContent = ''; }, 2500);
        }
      });
    }

    container.querySelectorAll('.training-focus-type-select').forEach((el) => {
      el.addEventListener('change', () => {
        const { playerId } = el.dataset;
        const type = el.value;
        let focus = { type: 'none' };
        if (type === 'attribute') focus = { type: 'attribute', target: MUTABLE_TECHNICAL[0] };
        else if (type === 'position') focus = { type: 'position', target: POSITIONS[0] };
        else if (type === 'role') focus = { type: 'role', side: 'offense', target: OFFENSIVE_ROLES[0].id };
        setIndividualFocus(team, playerId, focus, state.calendar.currentGameDateTime, CONFIG_BASE, buildTrainingCalendarContext());
        renderTrainingScreen();
      });
    });
    container.querySelectorAll('.training-focus-target-select').forEach((el) => {
      el.addEventListener('change', () => {
        const { playerId, type } = el.dataset;
        let focus;
        if (type === 'role') {
          const [side, roleId] = el.value.split(':');
          focus = { type: 'role', side, target: roleId };
        } else {
          focus = { type, target: el.value };
        }
        setIndividualFocus(team, playerId, focus, state.calendar.currentGameDateTime, CONFIG_BASE, buildTrainingCalendarContext());
        renderTrainingScreen();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Pantalla: Lesiones (LIFE-3, DESIGN.md 9.14, sección 32 del prompt de
  // esa sesión) — capa de presentación pura sobre src/core/Medical.js:
  // `riskBand`/`loadBand`/fases/rangos de vuelta salen SIEMPRE de sus
  // helpers reales, nunca recalculados aquí. Móvil primero (tabla con
  // scroll horizontal propio, mismo patrón que el resto de pantallas).
  // ---------------------------------------------------------------------
  const RISK_BAND_LABELS = { bajo: 'Bajo', normal: 'Normal', alto: 'Alto', muyAlto: 'Muy alto' };
  const LOAD_BAND_LABELS = { baja: 'Baja', normal: 'Normal', alta: 'Alta', muyAlta: 'Muy alta' };
  const MEDICAL_STATUS_LABELS = { available: 'Disponible', limited: 'Disponible con restricción', unavailable: 'Lesionado' };
  const MEDICAL_SEVERITY_LABELS = { minor: 'leve', moderate: 'moderada', major: 'grave', severe: 'muy grave' };

  function medicalHistoryRowsHtml(player, team, config) {
    const history = (player.medicalState && player.medicalState.injuryHistory) || [];
    if (!history.length) return '<p class="gm-muted">Sin historial médico.</p>';
    const rows = [...history].sort((a, b) => b.occurredAt - a.occurredAt).map((entry) => {
      const label = config.medical.catalog[entry.type] ? config.medical.catalog[entry.type].label : entry.type;
      const severity = MEDICAL_SEVERITY_LABELS[entry.severity] || entry.severity;
      const recurrence = entry.recurrenceOf ? ' · recurrencia' : '';
      const sequela = entry.sequela ? ' · con secuela' : '';
      return `<li>${formatMatchTime(entry.occurredAt)} — ${label} (${severity}), ${entry.daysUnavailable} días fuera${recurrence}${sequela}</li>`;
    }).join('');
    return `<ul class="medical-history-list">${rows}</ul>`;
  }

  function medicalPlayerRowHtml(player, team, config) {
    const referenceDate = state.calendar.currentGameDateTime;
    const info = BM.getAvailability(player, referenceDate, config, { team });
    const statusLabel = MEDICAL_STATUS_LABELS[info.status];
    const injuryLabel = info.injury ? (config.medical.catalog[info.injury.type] || {}).label || info.injury.type : '—';
    const returnRange = info.injury ? BM.getEstimatedReturnRange(player, referenceDate, config, team) : null;
    const minuteCapText = info.status === 'limited' ? `${info.minuteCap} min` : '—';
    const loadBand = BM.describeLoadBand(player, referenceDate, config);
    return `
      <tr class="medical-row medical-row--${info.status}">
        <td>${playerLinkHtml(player)}</td>
        <td>${player.age}</td>
        <td>${statusLabel}</td>
        <td>${injuryLabel}</td>
        <td>${returnRange ? returnRange.label : '—'}</td>
        <td>${minuteCapText}</td>
        <td>${Math.round(player.dynamicState.energy)}</td>
        <td>${LOAD_BAND_LABELS[loadBand]}</td>
        <td>${RISK_BAND_LABELS[info.riskBand]}</td>
        <td><button class="gm-btn gm-btn--small medical-history-toggle" data-player-id="${player.id}">Historial</button></td>
      </tr>
      <tr class="medical-history-row is-hidden" id="medical-history-${player.id}">
        <td colspan="10">${medicalHistoryRowsHtml(player, team, config)}</td>
      </tr>`;
  }

  function renderMedicalScreen() {
    const container = byId('gm-medical');
    const team = getUserTeam();
    if (!container) return;
    if (!team) { container.innerHTML = ''; return; }
    const { CONFIG_BASE, POSITIONS } = BM;

    if (!CONFIG_BASE.medical.enabled) {
      container.innerHTML = '<h2>Lesiones</h2><p class="gm-muted">Sistema médico desactivado.</p>';
      return;
    }

    const referenceDate = state.calendar.currentGameDateTime;
    const sortedRoster = [...team.roster].sort((a, b) => {
      const posDiff = POSITIONS.indexOf(a.primaryPosition) - POSITIONS.indexOf(b.primaryPosition);
      return posDiff !== 0 ? posDiff : a.fullName.localeCompare(b.fullName, 'es');
    });
    const infos = sortedRoster.map((player) => ({ player, info: BM.getAvailability(player, referenceDate, CONFIG_BASE, { team }) }));

    const summary = {
      available: infos.filter((e) => e.info.status === 'available').length,
      limited: infos.filter((e) => e.info.status === 'limited').length,
      unavailable: infos.filter((e) => e.info.status === 'unavailable').length,
      highRisk: infos.filter((e) => e.info.riskBand === 'alto' || e.info.riskBand === 'muyAlto').length,
    };

    const rowsHtml = sortedRoster.map((player) => medicalPlayerRowHtml(player, team, CONFIG_BASE)).join('');

    container.innerHTML = `
      <h2>Lesiones</h2>
      <div class="gm-card medical-summary">
        <div><strong>${summary.available}</strong><span>Disponibles</span></div>
        <div><strong>${summary.limited}</strong><span>Limitados</span></div>
        <div><strong>${summary.unavailable}</strong><span>Lesionados</span></div>
        <div><strong>${summary.highRisk}</strong><span>Riesgo Alto/Muy alto</span></div>
      </div>
      <div class="gm-card">
        <div class="gm-table-scroll">
          <table class="gm-table medical-table">
            <thead>
              <tr>
                <th>Jugador</th><th>Edad</th><th>Estado</th><th>Lesión actual</th><th>Vuelta estimada</th>
                <th>Máx. min.</th><th>Energía</th><th>Carga reciente</th><th>Riesgo</th><th></th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelectorAll('.medical-history-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = byId(`medical-history-${btn.dataset.playerId}`);
        if (row) row.classList.toggle('is-hidden');
      });
    });
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
    // TOOLTIP-1 (auditoría): TAC-7 (7.12.28) añadió estas 3 valoraciones a
    // Tactics.computeLineupRatings (transitionOffense/poaDefense/
    // tacticalExecution), pero nunca se añadieron aquí — la tabla de
    // Resumen itera TODAS las claves devueltas (Object.entries), así que
    // sin esta corrección esas 3 filas mostraban el label literal
    // "undefined". No es una decisión de diseño, es una etiqueta de
    // presentación que faltaba; se corrige aquí porque bloquea que estas
    // 3 filas puedan tener icono de ayuda coherente con su contenido.
    transitionOffense: 'Transition Offense', poaDefense: 'POA Defense', tacticalExecution: 'Tactical Execution',
  };
  // TAC-4 (7.12.13/7.12.14/7.12.15/7.12.19): etiquetas de la sub-pestaña Defensa.
  const BASE_SCHEME_LABELS = {
    'man-to-man': 'Hombre a hombre', '2-3': 'Zona 2-3', '3-2': 'Zona 3-2', '1-3-1': 'Zona 1-3-1',
  };
  const PRESS_TYPE_LABELS = { halfCourt: 'A 3/4 de pista', fullCourt: 'A toda pista' };
  const POST_DOUBLE_TEAM_RULE_LABELS = {
    never: 'Nunca', starOnly: 'Solo si supera claramente a su defensor', always: 'Siempre que reciba en el poste',
  };

  // -----------------------------------------------------------------------
  // TOOLTIP-1 (DESIGN.md 7.12.36): ayuda táctica contextual. Capa de
  // presentación sobre BM.TacticsHelp (fuente ÚNICA del contenido, src/ui/
  // TacticsHelp.js) — este bloque solo decide DÓNDE aparece un icono "ⓘ" y
  // CÓMO se abre/cierra, nunca el texto en sí.
  //
  // Estado de "qué tooltip está abierto ahora mismo": vive en
  // container.dataset.openHelpId (atributo del DOM del propio contenedor
  // #gm-tactics), mismo patrón ya usado por container.dataset.activeTab —
  // nunca dentro de `state` (no es un dato de partida guardable). Como
  // renderTacticsScreen() hace un `container.innerHTML = ...` completo en
  // cada cambio, este dataset es lo único que sobrevive intacto a ese
  // re-render (vive en el nodo contenedor, nunca sustituido por
  // innerHTML) — así abrir/cerrar un tooltip, o cualquier otro control que
  // dispare un re-render, nunca pierde qué tooltip estaba abierto (o
  // cerrado) en esa pestaña.
  // Nota de implementación (bug real encontrado en pruebas Playwright de
  // esta sesión): el panel y sus filas se construyen con <span> en vez de
  // <div>/<p> a propósito. Muchos de los sitios donde se llama a
  // helpIconHtml() están dentro de un <p> (ej. el párrafo "Spacing:" de
  // Resumen) o de un <label>/<h3>. Un <div>/<p> anidado ahí dentro NO es
  // solo "poco válido": el parser HTML5 CIERRA implícitamente el <p>
  // ancestro en cuanto encuentra el token de apertura de un <div> en
  // CUALQUIER profundidad de anidamiento (regla de "implied end tag" de
  // <p>), sacando el panel entero de dentro de .tactics-help-wrap en el
  // DOM real — rompe el posicionamiento (position:absolute pierde su
  // ancestro `position:relative`) y dispersa el resto del contenido.
  // <span> es "contenido de fraseo" y nunca dispara ese cierre implícito,
  // así que es válido anidarlo dentro de <p>/<label>/<h3> sin romper la
  // estructura — el bloque visual (una fila por campo) se consigue con
  // `display:block` en CSS, no con la etiqueta.
  function tacticsHelpBodyHtml(entry) {
    const rows = [
      ['Qué es', entry.what],
      ['Objetivo', entry.goal],
      ['Efecto real en el motor', entry.engineEffect],
    ];
    if (entry.whenUseful) rows.push(['Cuándo es útil', entry.whenUseful]);
    rows.push(['Riesgos', entry.risks]);
    if (entry.suitablePlayers) rows.push(['Jugadores adecuados', entry.suitablePlayers]);
    return rows.map(([label, text]) => `<span class="tactics-help-row"><strong>${label}:</strong> ${text}</span>`).join('');
  }

  // Icono "ⓘ" + panel desplegable para el concepto `id` (debe coincidir
  // EXACTAMENTE con un id de BM.TacticsHelp.ENTRIES). Si `id` no tiene
  // entrada de ayuda (ej. TELEMETRY_PLAY_TYPES incluye 'none', que no la
  // necesita por ser autoexplicativo), no se renderiza ningún icono —
  // nunca un icono "roto" sin contenido.
  function helpIconHtml(id) {
    const entry = BM.TacticsHelp && BM.TacticsHelp.getHelp(id);
    if (!entry) return '';
    const container = byId('gm-tactics');
    const isOpen = !!(container && container.dataset.openHelpId === id);
    const panelHtml = isOpen ? `
      <span class="tactics-help-panel" data-help-panel-id="${id}">
        <span class="tactics-help-panel__header">
          <strong>${entry.label}</strong>
          <button type="button" class="tactics-help-panel__close" data-help-id="${id}" aria-label="Cerrar ayuda">×</button>
        </span>
        ${tacticsHelpBodyHtml(entry)}
      </span>` : '';
    return `<span class="tactics-help-wrap"><button type="button" class="tactics-help-icon ${isOpen ? 'is-open' : ''}" data-help-id="${id}" aria-label="Ayuda: ${entry.label}">ⓘ</button>${panelHtml}</span>`;
  }

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
      <div class="tactics-identity-row"><span>${TACTICS_IDENTITY_LABELS[key]} ${helpIconHtml(key)}</span><strong>${Math.round(profile.identity[key] ?? 0)}</strong></div>`).join('');

    const ratingsHtml = five.length < 5
      ? '<p class="gm-muted">Completa el quinteto titular en la pantalla de Alineación para ver sus valoraciones.</p>'
      : `<table class="gm-table tactics-ratings-table"><tbody>${
        Object.entries(BM.computeLineupRatings(five, profile, CONFIG_BASE))
          .map(([key, r]) => `<tr><td>${LINEUP_RATING_LABELS[key]} ${helpIconHtml(key)}</td><td class="tactics-stars">${starsHtml(r.stars)}</td></tr>`)
          .join('')
      }</tbody></table>`;

    return `
      <div class="gm-card">
        <h3>Identidad</h3>
        <p><strong>Spacing:</strong> ${SPACING_LABELS[profile.spacing] || profile.spacing} ${helpIconHtml(profile.spacing)}</p>
        <p><strong>Cobertura de P&R por defecto:</strong> ${PNR_COVERAGE_LABELS[profile.pnrCoverage] || profile.pnrCoverage} ${helpIconHtml(profile.pnrCoverage)}</p>
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
  // defensiva global y las 2-3 familias/coberturas más USADAS HASTA AHORA.
  // TAC-6 solo tenía la aproximación por desviación de familiaridad (sin
  // contador de frecuencia real); **corregido en TAC-7**: con
  // `tacticsTelemetry` ya construido (7.12.27), "más usadas" se calcula
  // ahora con el CONTADOR REAL de posesiones por familia/cobertura, no una
  // aproximación — la nota de TAC-6/7.12.34 sobre esto queda cerrada, ver
  // CHANGELOG de esta entrega.
  function familiarityBarHtml(label, level, helpId) {
    const rounded = Math.round(level);
    return `
      <div class="tactics-familiarity-row">
        <span>${label} ${helpId ? helpIconHtml(helpId) : ''}</span>
        <div class="tactics-familiarity-bar"><div class="tactics-familiarity-bar-fill" style="width:${rounded}%"></div></div>
        <strong>${rounded}</strong>
      </div>`;
  }

  // TAC-7 (7.12.27): ordena por USO REAL (posesiones registradas en
  // `tacticsTelemetry`), no por desviación de familiaridad — `usageGroup`
  // es `tacticsTelemetry.offense.byPlayType`/`defense.byCoverage` (mismo
  // catálogo de claves que `familiarityGroup`, construidos juntos en
  // `TacticalProfile`).
  function topUsedFamiliarityEntries(familiarityGroup, usageGroup, labels, topN) {
    return Object.keys(familiarityGroup)
      .map((key) => ({ key, level: familiarityGroup[key], uses: (usageGroup[key] && usageGroup[key].possessions) || 0 }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, topN)
      .map((entry) => ({
        id: entry.key, label: labels[entry.key] || entry.key, level: entry.level, used: entry.uses > 0,
      }));
  }

  function renderFamiliaritySection(profile) {
    const fam = profile.familiarity;
    if (!fam) {
      // 7.12.34 (compatibilidad): perfil plano/legacy sin `familiarity` —
      // no debería ocurrir con `new TacticalProfile()`, pero esta pantalla
      // no debe romperse si algún día aparece uno.
      return '';
    }
    const telemetry = profile.tacticsTelemetry;
    const topFamilies = topUsedFamiliarityEntries(fam.byPlayFamily, telemetry.offense.byPlayType, FAMILIARITY_FAMILY_LABELS, 3);
    const topCoverages = topUsedFamiliarityEntries(fam.byCoverage, telemetry.defense.byCoverage, PNR_COVERAGE_LABELS, 3);
    const familiesHtml = topFamilies.some((e) => e.used)
      ? topFamilies.filter((e) => e.used).map((e) => familiarityBarHtml(e.label, e.level, e.id)).join('')
      : '<p class="gm-muted">Todavía sin partidos jugados con ninguna familia de jugada registrada.</p>';
    const coveragesHtml = topCoverages.some((e) => e.used)
      ? topCoverages.filter((e) => e.used).map((e) => familiarityBarHtml(e.label, e.level, e.id)).join('')
      : '<p class="gm-muted">Todavía sin partidos jugados contra ninguna cobertura rival registrada.</p>';

    return `
      <div class="gm-card">
        <h3>Familiaridad ${helpIconHtml('familiarity')}</h3>
        <p class="gm-muted">Cuánto domina el equipo la táctica declarada arriba — sube jugando partidos reales, no se edita aquí.</p>
        ${familiarityBarHtml('Sistema ofensivo', fam.offensiveSystem)}
        ${familiarityBarHtml('Sistema defensivo', fam.defensiveSystem)}
        <h4>Familias de jugada más usadas</h4>
        ${familiesHtml}
        <h4>Coberturas defensivas más usadas</h4>
        ${coveragesHtml}
      </div>`;
  }

  function renderTacticsAttackTab(team) {
    const profile = team.tacticalProfile;

    const spacingOptionsHtml = BM.SPACING_OPTIONS.map((opt) => `
      <option value="${opt}" ${profile.spacing === opt ? 'selected' : ''}>${SPACING_LABELS[opt] || opt}</option>`).join('');

    const identitySlidersHtml = Object.keys(TACTICS_IDENTITY_LABELS).map((key) => `
      <label class="tactics-slider-row">
        <span>${TACTICS_IDENTITY_LABELS[key]} ${helpIconHtml(key)}</span>
        <input type="range" min="0" max="100" step="5" class="tactics-identity-input" data-key="${key}" value="${profile.identity[key] ?? 50}">
        <span class="tactics-slider-value">${Math.round(profile.identity[key] ?? 50)}</span>
      </label>`).join('');

    const playTypeRowsHtml = Object.keys(PLAY_TYPE_LABELS).map((key) => `
      <label class="tactics-slider-row">
        <span>${PLAY_TYPE_LABELS[key]} ${helpIconHtml(key)}</span>
        <input type="range" min="0" max="100" step="5" class="tactics-playtype-input" data-key="${key}" value="${profile.playTypeWeights[key] ?? 0}">
        <span class="tactics-slider-value">${Math.round(profile.playTypeWeights[key] ?? 0)}</span>
      </label>`).join('');

    return `
      <div class="gm-card">
        <h3>Spacing ${helpIconHtml(profile.spacing)}</h3>
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
        <p class="gm-muted">Pick &amp; Roll, Isolation, Post Up y Transition tienen efecto real en el motor a través de estos pesos: deciden con qué frecuencia se intenta cada jugada y cuánto se explota cada ventana de contraataque. Handoff/DHO, Off Screen y Motion/Flow siguen siendo catálogo de jugadas sin motor propio todavía (ver pestaña Playbook).</p>
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

      const offFitHtml = assignment.offensiveRole
        ? `${starsHtml(BM.roleFit(player, assignment.offensiveRole, CONFIG_BASE).stars)} ${helpIconHtml(assignment.offensiveRole)}` : '—';
      const defFitHtml = assignment.defensiveRole
        ? `${starsHtml(BM.roleFit(player, assignment.defensiveRole, CONFIG_BASE).stars)} ${helpIconHtml(assignment.defensiveRole)}` : '—';

      const bestOffenseHtml = BM.bestRolesForPlayer(player, 'offensive', CONFIG_BASE, 3)
        .map((r) => `${r.label} ${starsHtml(r.stars)}`).join(' · ');
      const bestDefenseHtml = BM.bestRolesForPlayer(player, 'defensive', CONFIG_BASE, 3)
        .map((r) => `${r.label} ${starsHtml(r.stars)}`).join(' · ');

      return `
        <tr>
          <td>${playerLinkHtml(player)}</td>
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
        <h3>Roles ofensivos y defensivos ${helpIconHtml('roleFitStars')}</h3>
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
        ? ` <span class="gm-muted">(situacional: ${SITUATION_TYPE_LABELS[play.situationType] || play.situationType} ${helpIconHtml(play.situationType)})</span>` : '';
      return `
        <tr>
          <td>${play.name} ${helpIconHtml(play.id)}${situationalBadge}${hasRealEngine ? '' : ' <span class="gm-muted">(catálogo, sin motor propio todavía)</span>'}</td>
          <td>${familyLabel} ${helpIconHtml(play.family)}</td>
          <td>${participantsHtml}</td>
          <td>${spacingHtml}</td>
          <td>${play.complexity}</td>
          <td>${readsHtml}</td>
        </tr>`;
    }).join('');

    return `
      <div class="gm-card">
        <h3>Playbook</h3>
        <p class="gm-muted">Catálogo de jugadas disponibles. Pick &amp; Roll, Isolation y Post Up ya tienen comportamiento real en el motor según los pesos de play-type de la pestaña Ataque; Handoff/DHO, Off Screen y Motion/Flow quedan como catálogo de datos, sin motor propio todavía. La prioridad/peso de cada jugada individual dentro de una misma familia no es editable todavía — el motor elige automáticamente según el spacing declarado del equipo.</p>
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
        <h3>Esquema defensivo base ${helpIconHtml(scheme.baseScheme)}</h3>
        <select id="tactics-base-scheme-select">${baseSchemeOptionsHtml}</select>
        <p class="gm-muted">Hombre a hombre es la referencia principal. Una zona nunca da un +X%/-X% de tiro directo: cambia la vulnerabilidad real según el spacing del rival (se estira y sufre contra un quinteto con tiradores de verdad, se contrae sin coste contra uno sin amenaza exterior real) y, en menor medida, según el play-type que intente el rival (Post Up castiga más una 2-3, Pick &amp; Roll/Isolation explotan más una 1-3-1). Match-up Zone y Box-and-One quedan fuera de esta entrega.</p>
      </div>
      <div class="gm-card">
        <h3>Press ${helpIconHtml(scheme.press.type)}</h3>
        <label class="tactics-press-toggle"><input type="checkbox" id="tactics-press-active-checkbox" ${scheme.press.active ? 'checked' : ''}> Presionar el tramo inicial de la posesión rival</label>
        <select id="tactics-press-type-select">${pressTypeOptionsHtml}</select>
        <p class="gm-muted">Sube la probabilidad de pérdida temprana del rival y el tiempo que tarda en cruzar medio campo — castiga más a manejadores de balón débiles. El desgaste físico extra de presionar no está modelado todavía.</p>
      </div>
      <div class="gm-card">
        <h3>Doble equipo de poste ${helpIconHtml(scheme.postDoubleTeamRule)}</h3>
        <select id="tactics-post-double-team-select">${postRuleOptionsHtml}</select>
        <p class="gm-muted">Quién dobla lo decide el rol defensivo de cada jugador (pestaña Roles) — el ayudante más cercano (Low Man/Nail Helper/Roamer). El propio anotador posteado decide si encuentra el hueco según su Visión de Juego y Pase.</p>
      </div>
      <div class="gm-card">
        <h3>Matchups individuales ${helpIconHtml('matchupOverride')}</h3>
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
          ${SITUATION_TYPE_LABELS[situationType] || situationType} ${helpIconHtml(situationType)}
          <select class="tactics-situational-play-select" data-situation-type="${situationType}">
            <option value="">Elegir automáticamente</option>
            ${optionsHtml}
          </select>
        </label>`;
    }).join('');

    return `
      <div class="gm-card">
        <h3>Auto Timeouts ${helpIconHtml('autoTimeouts')}</h3>
        <label class="tactics-press-toggle">
          <input type="checkbox" id="tactics-auto-timeouts-checkbox" ${situations.autoTimeouts.enabled ? 'checked' : ''}>
          Pedir tiempo muerto automáticamente si el rival mete un parcial (${BM.CONFIG_BASE.match.timeouts.autoTriggerRunPoints}-0 sin respuesta)
        </label>
        <p class="gm-muted">Con esta opción activada, el asistente pide el tiempo muerto por ti en la primera parada de juego disponible — sin abrir la ventana de intervención. Un tiempo muerto NUNCA aplica un bonus mágico de acierto ni resetea la racha del rival; solo habilita los ajustes que verías igualmente si lo pidieras a mano.</p>
      </div>
      <div class="gm-card">
        <h3>Falta táctica intencionada ${helpIconHtml('tacticalFoul')}</h3>
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
        <p class="gm-muted">Jugada preferida del catálogo situacional para cada caso — sin garantía de tiro concreto, su eficacia depende de los jugadores y la cobertura rival. "Elegir automáticamente" sortea entre el catálogo disponible, igual que el resto del playbook.</p>
        ${preferredPlaysHtml}
      </div>`;
  }

  // --- DESIGN.md 7.12.25 (fase de scouting) / 7.12.32 (TAC-7): sub-pestaña
  // Rival — informe de scouting táctico. Séptima y última vista de la
  // pantalla de Tácticas (7.12.32 la describe como "GamePlan, matchups e
  // informe de scouting/análisis" — esta entrega cubre la parte de
  // informe/análisis; GamePlan/matchups de PARTIDO ya existen en la
  // ventana de intervención del partido en vivo, TAC-5, sin tocar aquí).
  const TELEMETRY_PLAY_TYPE_LABELS = { ...PLAY_TYPE_LABELS, none: 'Sin jugada táctica (1v1)' };

  // Próximo rival de LIGA del usuario (7.12.25: "el mismo informe... que
  // está disponible al usuario" se construye igual para cualquier rival,
  // pero esta pantalla necesita saber A QUIÉN mirar primero) —
  // `league.getCurrentRoundMatches()` es una consulta pura ya usada en
  // Home/Calendario (sin tocar League.js), devuelve los MISMOS objetos
  // Team en memoria que la liga, nunca una reconstrucción desde el bundle
  // (a diferencia de `getAllRealTeamsForMatchupTarget()`, que sí
  // reconstruye — no vale para esto, perdería toda la telemetría/perfil
  // real acumulado). `null` si el usuario descansa esta jornada o la liga
  // ya terminó — la pantalla cae a un selector manual (ver
  // renderTacticsRivalTab).
  function getNextLeagueOpponent(team) {
    const league = getUserLeague();
    if (!league || league.isSeasonComplete) return null;
    const match = league.getCurrentRoundMatches().find(
      (m) => m.homeTeam.id === team.id || m.awayTeam.id === team.id,
    );
    if (!match) return null;
    return match.homeTeam.id === team.id ? match.awayTeam : match.homeTeam;
  }

  // Mapeo INTERPRETATIVO rol ofensivo -> contraparte defensiva más
  // directa, señalado explícitamente como decisión de encaje propia
  // (7.12.34: 7.12.25/7.12.32 no cierran qué rol defensivo "responde" a
  // cada rol ofensivo) — usado SOLO para decidir QUÉ DOS valoraciones ya
  // calculadas por `Tactics.roleFit` se comparan en la tabla de
  // mismatches; el número en sí nunca se recalcula aquí, siempre viene de
  // `roleFit` (pedido explícito del prompt: "reutiliza roleFit... no
  // inventes un segundo cálculo de encaje").
  const OFFENSE_TO_DEFENSE_COUNTERPART = {
    primaryCreator: 'poaStopper', secondaryCreator: 'poaStopper', pnrHandler: 'poaStopper',
    isolationScorer: 'poaStopper', slasher: 'poaStopper',
    spotUpShooter: 'screenNavigator', movementShooter: 'screenNavigator', connector: 'nailHelper',
    postScorer: 'postAnchor', postHub: 'postAnchor', rollMan: 'rimProtector', shortRollPlaymaker: 'rimProtector',
    pickAndPopBig: 'switchDefender', primaryScreener: 'lowMan', offensiveRebounder: 'defensiveRebounder',
  };

  // Mismatches potenciales contra el quinteto propio (7.12.25): para cada
  // titular propio, su MEJOR rol ofensivo (bestRolesForPlayer, ya
  // existente) contra el mejor encaje rival en la contraparte defensiva
  // directa (roleFit, ya existente, sobre TODA la plantilla rival — el
  // rival puede defender con cualquiera de sus convocados, no solo un
  // quinteto fijo). "Posible ventaja" cuando la diferencia de estrellas es
  // de al menos 2 — umbral propio, pendiente de calibración/decisión
  // (7.12.34).
  function computeMismatchRows(ownFive, rivalTeam, config) {
    return ownFive.map((player) => {
      const bestOffense = BM.bestRolesForPlayer(player, 'offensive', config, 1)[0];
      const counterpartRoleId = OFFENSE_TO_DEFENSE_COUNTERPART[bestOffense.roleId] || 'poaStopper';
      let bestDefender = null;
      let bestDefenderFit = null;
      rivalTeam.roster.forEach((rivalPlayer) => {
        const fit = BM.roleFit(rivalPlayer, counterpartRoleId, config);
        if (!bestDefenderFit || fit.score > bestDefenderFit.score) { bestDefenderFit = fit; bestDefender = rivalPlayer; }
      });
      return {
        player, offenseRole: bestOffense, counterpartRoleId, defender: bestDefender, defenderFit: bestDefenderFit,
        advantage: bestOffense.stars - bestDefenderFit.stars >= 2,
      };
    });
  }

  function smallSampleBadgeHtml(n, config) {
    const cfg = config.tactics.telemetry;
    if (n >= cfg.minReliablePossessions) return '';
    return ` <span class="tactics-small-sample-badge">muestra pequeña (n=${n})${helpIconHtml('smallSample')}</span>`;
  }

  function pctHtml(value) {
    return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
  }
  function pppHtml(value) {
    return value === null || value === undefined ? '—' : value.toFixed(2);
  }

  function renderTacticsRivalTab(team) {
    const { CONFIG_BASE } = BM;
    const autoOpponent = getNextLeagueOpponent(team);
    const leagueTeams = (getUserLeague() ? getUserLeague().teams : []).filter((t) => t.id !== team.id);
    const selectedId = state.tacticsRivalTeamId || (autoOpponent ? autoOpponent.id : (leagueTeams[0] && leagueTeams[0].id));
    const rivalTeam = leagueTeams.find((t) => t.id === selectedId);

    const optionsHtml = leagueTeams.map((t) => `
      <option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${t.fullName}${autoOpponent && t.id === autoOpponent.id ? ' (próximo rival de liga)' : ''}</option>`).join('');

    const selectorHtml = `
      <div class="gm-card">
        <h3>Rival</h3>
        <select id="tactics-rival-select">${optionsHtml}</select>
        <p class="gm-muted">Informe estadístico objetivo del rival — la CPU rival ve de ti el mismo tipo de informe que tú ves de ella, para que ninguno de los dos lados juegue con ventaja de información. Se selecciona automáticamente tu próximo rival de liga cuando se conoce; puedes elegir otro equipo de tu división para explorarlo igual.</p>
      </div>`;

    if (!rivalTeam) {
      return `${selectorHtml}<div class="gm-card"><p class="gm-muted">No hay ningún otro equipo disponible en tu liga todavía.</p></div>`;
    }

    const summary = BM.summarizeTacticsTelemetry(rivalTeam.tacticalProfile, CONFIG_BASE);
    // DESIGN.md 7.12.27 ("no presentar 2 posesiones, 1.50 PPP como una
    // verdad táctica estable", cita literal): alerta de muestra pequeña
    // OBLIGATORIA a nivel de informe completo, además del badge por
    // métrica individual (`smallSampleBadgeHtml`) — un rival recién
    // ascendido o en las primeras jornadas de temporada no tiene historial
    // real todavía.
    const smallSampleBannerHtml = summary.smallSample
      ? `<div class="tactics-small-sample-banner">⚠ Muestra pequeña: ${summary.games} partido(s)/${summary.offense.possessions} posesiones registradas contra este rival. Los datos de abajo son una tendencia inicial, no una verdad táctica estable todavía — no tomes 1-2 partidos como un patrón fijo.</div>`
      : '';

    const playTypeRowsHtml = BM.TELEMETRY_PLAY_TYPES.map((key) => {
      const stats = summary.offense.byPlayType[key];
      return `<tr><td>${TELEMETRY_PLAY_TYPE_LABELS[key] || key} ${helpIconHtml(key)}</td><td>${pctHtml(stats.frequency)}</td><td>${pppHtml(stats.ppp)}${smallSampleBadgeHtml(stats.n, CONFIG_BASE)}</td></tr>`;
    }).join('');

    const coverageRowsHtml = BM.PNR_COVERAGES.map((coverage) => {
      const stats = summary.defense.byCoverage[coverage];
      return `<tr><td>${PNR_COVERAGE_LABELS[coverage] || coverage} ${helpIconHtml(coverage)}</td><td>${pctHtml(stats.frequency)}</td><td>${pppHtml(stats.pppAllowed)}${smallSampleBadgeHtml(stats.n, CONFIG_BASE)}</td></tr>`;
    }).join('');

    const shotZoneLabels = { rim: 'Cerca del aro', midRange: 'Media distancia', three: 'Triple' };
    const shotProfileRowsHtml = BM.SHOT_ZONES.map((zone) => {
      const own = summary.offense.shotProfile[zone];
      const allowed = summary.defense.shotProfileAllowed[zone];
      return `<tr><td>${shotZoneLabels[zone]}</td><td>${pctHtml(own.frequency)} (${pctHtml(own.fgPercent)} de acierto)</td><td>${pctHtml(allowed.frequency)} (${pctHtml(allowed.fgPercentAllowed)} de acierto permitido)</td></tr>`;
    }).join('');

    const ownFive = getStarterFive(team);
    const mismatchHtml = ownFive.length < 5
      ? '<p class="gm-muted">Completa tu quinteto titular en la pantalla de Alineación para ver mismatches potenciales.</p>'
      : `<table class="gm-table tactics-mismatch-table"><thead><tr><th>Tu jugador</th><th>Su mejor rol</th><th>Mejor defensor rival</th><th></th></tr></thead><tbody>${
        computeMismatchRows(ownFive, rivalTeam, CONFIG_BASE).map((row) => `
          <tr class="${row.advantage ? 'tactics-mismatch-advantage' : ''}">
            <td>${row.player.fullName}</td>
            <td>${row.offenseRole.label} ${helpIconHtml(row.offenseRole.roleId)} ${starsHtml(row.offenseRole.stars)}</td>
            <td>${row.defender.fullName} ${starsHtml(row.defenderFit.stars)}</td>
            <td>${row.advantage ? 'Posible ventaja' : ''}</td>
          </tr>`).join('')
      }</tbody></table>`;

    const bestLineup = summary.lineups[0];

    return `
      ${selectorHtml}
      ${smallSampleBannerHtml}
      <div class="gm-card">
        <h3>Play-types dominantes (ataque)</h3>
        <table class="gm-table"><thead><tr><th>Play-type</th><th>Frecuencia</th><th>PPP ${helpIconHtml('ppp')}</th></tr></thead><tbody>${playTypeRowsHtml}</tbody></table>
        <p class="gm-muted">Tiro exterior/interior asistido: ${pctHtml(summary.offense.assistedFgPercent)} · Pérdidas por posesión: ${pctHtml(summary.offense.turnoverRate)} · Calidad de tiro media (estimación a partir de las ventajas creadas durante el partido): ${summary.offense.averageShotQuality !== null ? summary.offense.averageShotQuality.toFixed(2) : '—'}${smallSampleBadgeHtml(summary.offense.shotQualityN, CONFIG_BASE)}</p>
      </div>
      <div class="gm-card">
        <h3>Coberturas habituales (defensa)</h3>
        <table class="gm-table"><thead><tr><th>Cobertura</th><th>Frecuencia</th><th>PPP concedido</th></tr></thead><tbody>${coverageRowsHtml}</tbody></table>
        <p class="gm-muted">Eficiencia de mismatch concedida (aproximada por PPP concedido en Switch): ${pppHtml(summary.defense.mismatchEfficiencyAllowed.pppAllowed)}${smallSampleBadgeHtml(summary.defense.mismatchEfficiencyAllowed.n, CONFIG_BASE)}</p>
      </div>
      <div class="gm-card">
        <h3>Shot profile — propio vs. permitido</h3>
        <table class="gm-table"><thead><tr><th>Zona</th><th>Cuando ataca</th><th>Cuando defiende</th></tr></thead><tbody>${shotProfileRowsHtml}</tbody></table>
      </div>
      <div class="gm-card">
        <h3>Mismatches potenciales contra tu quinteto titular</h3>
        ${mismatchHtml}
      </div>
      <div class="gm-card">
        <h3>Quinteto más usado (lineup)</h3>
        ${bestLineup
          ? `<p>ORtg ${helpIconHtml('offensiveRating')} ${bestLineup.offensiveRating !== null ? bestLineup.offensiveRating.toFixed(1) : '—'} · DRtg ${helpIconHtml('defensiveRating')} ${bestLineup.defensiveRating !== null ? bestLineup.defensiveRating.toFixed(1) : '—'} · Net ${helpIconHtml('netRating')} ${bestLineup.netRating !== null ? bestLineup.netRating.toFixed(1) : '—'}${smallSampleBadgeHtml(bestLineup.n, CONFIG_BASE)}</p>`
          : '<p class="gm-muted">Sin quintetos registrados todavía.</p>'}
      </div>`;
  }

  // TOOLTIP-1 (DESIGN.md 7.12.36, sección 6): Glosario como 8ª sub-pestaña
  // de TACTICS_TABS, reutilizando el mismo mecanismo de pestañas que el
  // resto de la pantalla (en vez de un botón/acceso aparte) — es la opción
  // más consistente con cómo ya funciona esta pantalla (7.12.32 ya la
  // describe como "siete vistas... sub-pestañas dentro de esa única
  // pantalla"), sin introducir un patrón de navegación nuevo.
  function renderTacticsGlossaryTab() {
    if (!BM.TacticsHelp) return '<div class="gm-card"><p class="gm-muted">Glosario no disponible.</p></div>';
    return BM.TacticsHelp.listByCategory().map((group) => `
      <div class="gm-card">
        <h3>${group.label}</h3>
        ${group.entries.map((entry) => `
          <div class="tactics-glossary-entry">
            <h4>${entry.label}</h4>
            ${tacticsHelpBodyHtml(entry)}
          </div>`).join('')}
      </div>`).join('');
  }

  const TACTICS_TABS = [
    { id: 'summary', label: 'Resumen' },
    { id: 'attack', label: 'Ataque' },
    { id: 'roles', label: 'Roles' },
    { id: 'playbook', label: 'Playbook' },
    { id: 'defense', label: 'Defensa' },
    { id: 'situations', label: 'Situaciones' },
    { id: 'rival', label: 'Rival' },
    { id: 'glossary', label: 'Glosario' },
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
    else if (activeTab === 'rival') body = renderTacticsRivalTab(team);
    else if (activeTab === 'glossary') body = renderTacticsGlossaryTab();

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
        // TOOLTIP-1: un tooltip abierto en la pestaña anterior no debe
        // sobrevivir a un cambio de pestaña (requisito UX explícito) —
        // nunca queda un tooltip fantasma de una pestaña distinta.
        container.dataset.openHelpId = '';
        renderTacticsScreen();
      });
    });

    // TOOLTIP-1: abrir/cerrar el tooltip de un concepto. Un solo click
    // funciona tanto con ratón (desktop) como con toque (touch) — un tap
    // en un botón real ya dispara un evento 'click' de forma nativa en
    // cualquier navegador moderno, sin necesitar un listener 'touchstart'
    // aparte. Vuelve a renderizar la pantalla ENTERA (mismo patrón que el
    // resto de controles de esta pantalla), pero el valor de cualquier
    // slider/select que el usuario acabara de tocar ya vive en
    // `team.tacticalProfile` (se mutó en su propio 'change'), así que
    // nunca se pierde por abrir/cerrar un tooltip.
    container.querySelectorAll('.tactics-help-icon, .tactics-help-panel__close').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.helpId;
        container.dataset.openHelpId = (container.dataset.openHelpId === id) ? '' : id;
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

    // DESIGN.md 7.12.25/7.12.32 (TAC-7): selector de rival — solo elige
    // A QUIÉN mirar (`state.tacticsRivalTeamId`), nunca muta ningún
    // `tacticalProfile` (a diferencia del resto de sub-pestañas de esta
    // pantalla, que sí editan la táctica propia) — informe de solo
    // lectura.
    if (activeTab === 'rival') {
      const rivalSelect = byId('tactics-rival-select');
      if (rivalSelect) {
        rivalSelect.addEventListener('change', () => {
          state.tacticsRivalTeamId = rivalSelect.value;
          renderTacticsScreen();
        });
      }
    }
  }

  // Construye el `{ homeSquad/awaySquad, homeLineup/awayLineup }` de
  // MatchEngine solo para el LADO del equipo del usuario, reenviando
  // `undefined` para el resto — así el rival (u otros partidos de la
  // jornada/bracket) siguen exactamente igual que hasta ahora.
  // REG-1 (DESIGN.md 9.18): resuelve la convocatoria desde el POOL
  // regulado (`getConvocatedPlayers`, senior+propios+vinculados) — nunca
  // `Team.buildMatchSquad()`, que solo conoce `team.roster` y rechazaría a
  // un vinculado de otro club. `getLineupValidity()` ya se comprobó ANTES
  // de llegar aquí (el botón de jugar está deshabilitado si no es válida).
  function buildUserSideOptions(team) {
    const squad = getConvocatedPlayers(team);
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
  // `date` (LIFE-3, DESIGN.md 9.14): fecha real del partido — CpuLineup la
  // necesita para Medical.getAvailability() (excluir lesionados, respetar
  // minuteCap).
  // `matchContext` (REG-1, BUG-CONTRACT1-02): `{ phaseId, roundId, matchId }`
  // del partido REAL — nunca se resuelve por `team.division` + reloj global.
  function buildCpuSideOptions(team, opponent, competition, league, date, matchContext) {
    const { buildCpuLineup, computeMatchImportance, CONFIG_BASE } = BM;
    const standingsTable = league.getStandingsTable();
    const matchImportance = computeMatchImportance(team, opponent, competition, standingsTable, CONFIG_BASE);
    // ROSTER-1 (DESIGN.md 9.16): la CPU consulta la MISMA fuente de reglas
    // que el usuario — nunca un rango universal aparte. REG-1: el rango se
    // resuelve para la FECHA REAL de este partido y su fase, nunca el
    // reloj global leído dentro del resolver.
    const context = buildMatchCompetitionContext(team, {
      date,
      phaseId: (matchContext && matchContext.phaseId) || competition,
      roundId: matchContext ? matchContext.roundId : null,
      matchId: matchContext ? matchContext.matchId : null,
    });
    const resolved = BM.resolveRules(context);
    // REG-1 (sección 11.3 del prompt): la CPU consulta EXACTAMENTE
    // EligibilityService/SquadEligibilityService sobre el pool REGULADO
    // (senior+propios+vinculados) — nunca un greedy "los 12 mejores" que
    // pueda dejar la plantilla sin cupo. `eligibility` es `null` solo si la
    // partida todavía no construyó `state.registrationRegistry` (defensivo).
    const pool = buildEligiblePoolForMatch(team, context);
    const eligibility = pool ? { pool, resolved } : null;
    return buildCpuLineup(team, matchImportance, CONFIG_BASE, date, resolved.squadRules, eligibility);
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
  // resolveBracketOptionsFor(bracket, phaseId), que devuelve el resolver
  // que espera Bracket.playNextGame(homeEntry, awayEntry).
  // LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2, secciones 9/32 del
  // prompt de esa sesión): procesa Training/PlayerDevelopment/Recovery de
  // AMBOS equipos hasta la fecha del partido — ANTES de construir
  // squad/lineup (que en el caso CPU sí usa Energía real,
  // CpuLineup.playerPositionScore) y ANTES de MatchEngine.simulateMatch.
  // Único punto de enganche: cubre liga visible, liga de fondo y brackets
  // por igual, usuario y CPU, sin duplicar la secuencia en ningún otro
  // sitio (nunca se llama desde MatchEngine.js).
  function prepareBothTeamsForMatch(homeTeam, awayTeam, matchDate) {
    const { prepareTeamForMatch, CONFIG_BASE } = BM;
    const calendarCtx = buildTrainingCalendarContext();
    // LIFE-3 (DESIGN.md 9.14, sección 30): snapshot ANTES de procesar —
    // Training.prepareTeamForMatch ya dispara aquí dentro las lesiones de
    // entrenamiento/rehabilitación de LIFE-3 (Medical.js), sin devolver un
    // log propio; se detectan por diferencia, ver pushMedicalDiffEvents.
    const beforeHome = snapshotMedicalIdentity(homeTeam);
    const beforeAway = snapshotMedicalIdentity(awayTeam);
    prepareTeamForMatch(homeTeam, matchDate, CONFIG_BASE, calendarCtx);
    prepareTeamForMatch(awayTeam, matchDate, CONFIG_BASE, calendarCtx);
    pushMedicalDiffEvents(homeTeam, beforeHome);
    pushMedicalDiffEvents(awayTeam, beforeAway);
  }

  // `matchContext.phaseId` (REG-1, BUG-CONTRACT1-02): fase real del
  // bracket en curso ('cup'/'title-playoff'/'promotion'), declarada
  // explícitamente por `resolveBracketOptionsFor(bracket, phaseId)` para
  // el bracket que realmente se está jugando en cada llamada — nunca
  // adivinada con el literal genérico 'bracket'.
  // REG-1 (DESIGN.md 9.18, sección 11.6 del prompt): `MatchActSnapshot`
  // INMUTABLE de un lado del partido, registrado de forma IDEMPOTENTE
  // justo antes de entregar la convocatoria a MatchEngine — nunca se
  // decide normativa dentro del motor. `matchContext.matchId` puede ser
  // `null` en bracket (fecha real desconocida hasta simular, ver
  // `resolveBracketOptionsFor` más abajo): se deriva un id estable con
  // fase+fecha aproximada+equipo, suficiente para idempotencia dentro de
  // esa misma llamada.
  function recordMatchActSnapshot(team, squad, date, matchContext) {
    if (!state.registrationRegistry) return;
    const context = buildMatchCompetitionContext(team, {
      date, phaseId: matchContext.phaseId, roundId: matchContext.roundId, matchId: matchContext.matchId,
    });
    const resolved = BM.resolveRules(context);
    const pool = buildEligiblePoolForMatch(team, context) || [];
    const evaluationsById = new Map(pool.map((entry) => [entry.player.id, entry.evaluation]));
    // Excepción médica de convocatoria (DESIGN.md, "Excepción médica de
    // convocatoria"): si la escasez REAL de disponibles cae por debajo del
    // mínimo normal, el acta no puede exigir un mínimo que la propia
    // plantilla no puede cumplir — mismo cálculo que usa CpuLineup.
    const { CONFIG_BASE, getAvailability, resolveEffectiveSquadMinimum } = BM;
    const callableCount = pool.filter((entry) => (
      entry.evaluation.eligible && getAvailability(entry.player, context.date, CONFIG_BASE, { team }).status !== 'unavailable'
    )).length;
    const effectiveMin = resolveEffectiveSquadMinimum(resolved.squadRules.min, CONFIG_BASE, callableCount);
    const validation = BM.SquadEligibilityService.validateSquad(
      squad.map((p) => p.id), evaluationsById, resolved, { effectiveMin },
    );
    const matchId = matchContext.matchId || `${context.phaseId}:${BM.LocalDate.fromJsDate(date instanceof Date ? date : new Date(date))}`;
    const selectedPlayers = squad.map((player) => {
      const entry = pool.find((p) => p.player.id === player.id);
      return {
        playerId: player.id,
        accessCategory: entry ? entry.accessCategory : 'senior',
        formation: entry ? entry.evaluation.classification.formation.status : 'unknown',
        nonCommunity: entry ? entry.evaluation.classification.nonCommunitySlot.status : 'unknown',
      };
    });
    const snapshot = new BM.MatchActSnapshot({
      id: `act:${matchId}:${team.id}`,
      matchId,
      roundId: matchContext.roundId,
      phaseId: matchContext.phaseId,
      competitionId: context.competitionId,
      competitionInstanceId: context.competitionInstanceId,
      registrationScopeId: resolved.registrationScopeId,
      seasonKey: context.seasonKey,
      teamId: team.id,
      matchDateTime: date instanceof Date ? date.toISOString() : date,
      selectedPlayers,
      squadValidation: { valid: validation.valid, counts: validation.counts },
      configuredAt: state.calendar ? state.calendar.currentGameDateTime.toISOString() : null,
      warnings: validation.findings.map((f) => f.code),
    });
    state.registrationRegistry.registerMatchAct(snapshot);
  }

  // REG-1 (DESIGN.md 9.18): índice de ronda REAL de un bracket en curso —
  // NUNCA `null` para actas (`RegistrationRegistry.validateIntegrity()`
  // agrupa "misma jornada" por `registrationScopeId|roundId`; con `null`
  // fijo, un mismo club que avanza de ronda -p.ej. cuartos y semis de la
  // misma Copa- fundía ambas rondas bajo la misma clave y una progresión
  // legítima se leía como "el mismo jugador en dos actas a la vez"). Se
  // lee de `bracket.rounds.length` EN EL MOMENTO de construir el acta —
  // `Bracket.playNextGame()` ya ejecutó `advanceIfPossible()` antes de
  // invocar este resolver, así que el valor ya refleja la ronda que se va
  // a jugar. `PromotionPlayoff` (Promotion.js) no expone `rounds` directo
  // (compone DOS Bracket internos, cuartos + Final Four reordenada) — se
  // distingue con un prefijo de sub-fase para no confundir "cuartos ronda
  // 1" con "Final Four ronda 1".
  // `phaseId` prefija la clave (Copa/Playoff por el título comparten
  // `registrationScopeId` ACB pero son brackets INDEPENDIENTES — sin el
  // prefijo, "ronda 1" de Copa y "ronda 1" del Playoff colisionarían en
  // `RegistrationRegistry.playerAlreadyOnActThisRound()`, marcando a los
  // mismos jugadores como "ya en otra acta esta jornada" entre dos
  // competiciones/jornadas reales distintas).
  function currentBracketRoundKey(phaseId, bracketLike) {
    if (bracketLike.quarterFinals) {
      return bracketLike.finalFour
        ? `${phaseId}:finalfour-${bracketLike.finalFour.rounds.length}`
        : `${phaseId}:quarterfinals-${bracketLike.quarterFinals.rounds.length}`;
    }
    return `${phaseId}:round-${bracketLike.rounds.length}`;
  }

  function buildMatchOptionsResolver(league, userTeam) {
    const userSide = userTeam ? buildUserSideOptions(userTeam) : null;

    function sideOptions(sideTeam, opponentTeam, isHome, competition, date, matchContext) {
      if (userSide && sideTeam.id === userTeam.id) {
        recordMatchActSnapshot(sideTeam, userSide.squad, date, matchContext);
        return isHome
          ? { homeSquad: userSide.squad, homeLineup: userSide.lineup }
          : { awaySquad: userSide.squad, awayLineup: userSide.lineup };
      }
      const cpu = buildCpuSideOptions(sideTeam, opponentTeam, competition, league, date, matchContext);
      recordMatchActSnapshot(sideTeam, cpu.squad, date, matchContext);
      return isHome ? { homeSquad: cpu.squad, homeLineup: cpu.lineup } : { awaySquad: cpu.squad, awayLineup: cpu.lineup };
    }

    return {
      resolveMatchOptions(match) {
        prepareBothTeamsForMatch(match.homeTeam, match.awayTeam, match.date);
        const matchContext = { phaseId: 'league', roundId: match.round, matchId: matchStableId(match) };
        return {
          matchDate: match.date, // LIFE-3 (DESIGN.md 9.14): ver MatchEngine.createMatchState
          ...sideOptions(match.homeTeam, match.awayTeam, true, 'league', match.date, matchContext),
          ...sideOptions(match.awayTeam, match.homeTeam, false, 'league', match.date, matchContext),
        };
      },
      // `bracket`/`phaseId`: declarados por quien conoce el bracket EN
      // CURSO en el momento de la llamada (nunca cerrados sobre un único
      // bracket/fase al construir el resolver) — `drainBackgroundBrackets`
      // reutiliza el MISMO resolver para Copa/Playoff/Ascenso de la
      // división de fondo, cada uno con su propio bracket y fase real.
      resolveBracketOptionsFor(bracket, phaseId) {
        return (homeEntry, awayEntry) => {
          // Bracket.Series.playNextGame (DESIGN.md 3.3, Bracket.js — no se
          // toca en esta entrega, §43) solo calcula la fecha real del
          // partido DESPUÉS de simularlo (`dateResolver(gameIndex)`), así
          // que aquí no hay una fecha exacta disponible todavía. Se usa el
          // reloj de mundo actual como referencia — aproximación razonable
          // (los partidos de una misma Series/ronda están separados solo
          // unos pocos días, `seriesGameGapDays`/`seriesRoundGapDays`), que
          // sigue corrigiendo lo importante: la recuperación/entrenamiento
          // se resuelve ANTES de simular, nunca después.
          const approxDate = state.calendar.currentGameDateTime;
          prepareBothTeamsForMatch(homeEntry.team, awayEntry.team, approxDate);
          const roundId = currentBracketRoundKey(phaseId, bracket);
          // Emparejamiento en orden CANÓNICO (ids ordenados), nunca
          // home/away — una Series a mejor de N (BEST_OF_5_2_2_1) ALTERNA
          // el equipo local entre partidos; con el orden home/away el
          // mismo partido cambiaría de `matchId` de un juego al siguiente,
          // rompiendo la exclusión de "esta misma acta" en
          // `RegistrationRegistry.playerAlreadyOnActThisRound()` y marcando
          // a la propia plantilla como si ya estuviera en OTRA acta.
          const matchId = `${phaseId}:${roundId}:${[homeEntry.team.id, awayEntry.team.id].sort().join('-')}`;
          const matchContext = { phaseId, roundId, matchId };
          return {
            matchDate: approxDate,
            ...sideOptions(homeEntry.team, awayEntry.team, true, phaseId, approxDate, matchContext),
            ...sideOptions(awayEntry.team, homeEntry.team, false, phaseId, approxDate, matchContext),
          };
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
  // división, así que no hay ningún `userTeam` que preservar. SÍ puede
  // tener brackets propios (Copa/Playoff de 1ª o Ascenso de 2ª, según cuál
  // de las dos sea la de fondo — `state.brackets` los guarda por división,
  // no solo para la visible) — `drainBackgroundBrackets` declara el
  // bracket y la fase real en cada llamada a `resolveBracketOptionsFor`.
  function buildCpuOnlyResolver(league) {
    return buildMatchOptionsResolver(league, null);
  }

  function playNextMatchWithLineup(team) {
    const v = getLineupValidity(team);
    console.log('DEBUG playNextMatchWithLineup validity', JSON.stringify(v));
    if (!v.valid) return; // el botón ya está deshabilitado; defensa extra
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
      const bracketPhaseId = BRACKET_PHASE_IDS[activeBracket.competitionKey];
      playBracketGameWithReveal(
        activeBracket.bracket, resolvers.resolveBracketOptionsFor(activeBracket.bracket, bracketPhaseId), activeBracket.competitionKey,
      );
      return;
    }

    startUserLeagueMatch(team, resolvers.resolveMatchOptions);
  }

  // Partido PENDIENTE más próximo cronológicamente de `team` en `league`
  // (busca en TODO el calendario, no solo en `currentRound` — con 18
  // equipos por división el round-robin no tiene jornadas de descanso, así
  // que en la práctica siempre cae en la jornada actual, pero no se asume).
  function findNextPendingMatchForTeam(league, team) {
    const pending = league.schedule.filter(
      (m) => m.status === 'pending' && (m.homeTeam.id === team.id || m.awayTeam.id === team.id),
    );
    if (!pending.length) return null;
    return pending.reduce((earliest, m) => (m.date < earliest.date ? m : earliest));
  }

  // CAL-1 (DESIGN.md 3.3, sección 4.1 "eventos obligatorios de parada"):
  // representación mínima de un punto de parada obligatoria — hoy solo
  // existe este tipo real (el partido del usuario), pero se modela como un
  // objeto con `requiresAttention` para que un futuro catálogo de eventos
  // (Agenda/Noticias) pueda ampliar este mecanismo sin rehacerlo desde
  // cero. No se persiste ni se consume desde ningún otro sitio todavía.
  function buildUserMatchStopEvent(match) {
    return { type: 'match', dateTime: match.date, requiresAttention: true, status: 'pending', match };
  }

  // CAL-1 (DESIGN.md sección 5, "cambio de orquestación más importante"):
  // resuelve, ANTES de que el usuario juegue el suyo, todos los partidos de
  // `league` con fecha anterior a la del partido del usuario — antes de
  // esta entrega era EXACTAMENTE al revés (el partido del usuario se jugaba
  // primero y el resto de la jornada se resolvía después). Aplica
  // recuperación de Energía y avanza el reloj de mundo por cada uno,
  // igual que el resto de puntos de resolución de partidos.
  // `standingsBefore` (opcional, CAL-2, DESIGN.md 3.5.2): clasificación
  // capturada antes de tocar nada de esta jornada — se reenvía a
  // `pushLeagueMatchNews` para que estos partidos (los primeros en
  // resolverse de la jornada) también generen su noticia de resultado/
  // actuación/sorpresa, exactamente igual que los que se resuelven
  // después del partido del usuario (finishRoundBookkeeping).
  function resolvePreUserMatches(league, userMatch, resolveMatchOptions, standingsBefore) {
    const resolved = league.resolveMatchesBefore(userMatch.date, undefined, resolveMatchOptions);
    resolved.forEach((match) => {
      applyRecoveryForResolvedMatch(match.homeTeam, match.awayTeam, match.result, match.date);
    });
    if (resolved.length) advanceGameClockTo(resolved[resolved.length - 1].date);
    pushLeagueMatchNews(resolved, standingsBefore);
    return resolved;
  }

  // --- DESIGN.md 7.12.24/7.12.33 (TAC-5) + CAL-1 (DESIGN.md 3.3, sección
  // 5): partido de liga del usuario jugado de verdad sobre el motor
  // pausable (MatchEngine.createMatchState/advanceMatch), en su horario
  // real dentro de la jornada — con todos los partidos anteriores de esa
  // jornada (en ambas divisiones) ya resueltos como resultado real antes de
  // empezar el suyo (antes de CAL-1, el partido del usuario se jugaba
  // SIEMPRE primero; ver resolvePreUserMatches). ---
  function startUserLeagueMatch(team, resolveMatchOptions) {
    const league = getUserLeague();
    if (league.isSeasonComplete) return;
    const userMatch = findNextPendingMatchForTeam(league, team);

    if (!userMatch) {
      // Defensivo: con 18 equipos por división el round-robin no tiene
      // jornadas de descanso, así que esto no debería alcanzarse nunca en
      // la práctica — se mantiene por robustez ante un futuro cambio de
      // tamaño de división. Comportamiento idéntico al de antes de esta
      // entrega: toda la jornada se resuelve de golpe, sin pantalla de
      // partido.
      simulateNextRound(resolveMatchOptions);
      goToScreen(state.pendingUserMatch ? 'match' : 'home');
      return;
    }

    const stopEvent = buildUserMatchStopEvent(userMatch); // ver comentario en buildUserMatchStopEvent
    // Instantánea ANTES de tocar nada de esta jornada (CAL-2, noticias de
    // clasificación) — resolvePreUserMatches ya muta la clasificación.
    const standingsBefore = captureStandingsSnapshot(league);
    pushTacticalTrendNewsIfAny(userMatch, team);
    resolvePreUserMatches(league, stopEvent.match, resolveMatchOptions, standingsBefore);

    const engineOptions = resolveMatchOptions(userMatch) || {};
    advanceGameClockTo(userMatch.date);
    startLiveMatch(userMatch.homeTeam, userMatch.awayTeam, engineOptions, (finalResult) => {
      finishUserLeagueMatch(league, userMatch, finalResult, resolveMatchOptions, standingsBefore);
    });
    goToScreen('match');
  }

  // CAL-2 (DESIGN.md 3.5, "con mucho cuidado"): noticia táctica ocasional
  // sobre el próximo rival de liga del usuario — SOLO si TAC-7 ya tiene
  // muestra suficiente (reutiliza literalmente `config.tactics.telemetry.
  // minReliablePossessions`, el mismo umbral que `smallSampleBadgeHtml`, ver
  // Events.buildTacticalTrendNewsEvent) y solo la cobertura de pick&roll
  // con PEOR eficiencia defensiva concedida — nunca el grueso del feed.
  function pushTacticalTrendNewsIfAny(userMatch, team) {
    const opponent = userMatch.homeTeam.id === team.id ? userMatch.awayTeam : userMatch.homeTeam;
    if (!opponent.tacticalProfile) return;
    const summary = BM.summarizeTacticsTelemetry(opponent.tacticalProfile, BM.CONFIG_BASE);
    if (!summary) return;
    const coverages = Object.entries(summary.defense.byCoverage)
      .filter(([, stats]) => stats.pppAllowed !== null)
      .sort((a, b) => b[1].pppAllowed - a[1].pppAllowed);
    if (!coverages.length) return;
    const [coverageKey, stats] = coverages[0];
    const label = PNR_COVERAGE_LABELS[coverageKey] || coverageKey;
    pushNews(BM.buildTacticalTrendNewsEvent(opponent, label, stats.pppAllowed, stats.n, BM.CONFIG_BASE, {
      relatedCompetition: 'league', dateTime: state.calendar.currentGameDateTime,
    }));
  }

  // Encaje con League.js (sin tocarlo): el partido del usuario YA se ha
  // simulado de verdad, posesión a posesión, con las ventanas de
  // intervención que el usuario haya usado — `options.precomputedResult`
  // (MatchEngine.simulateMatch, ver comentario allí) hace que
  // League.simulateNextRound() REUTILICE ese resultado exacto para ESE
  // partido en vez de volver a simularlo (que generaría un partido
  // DISTINTO, con otra secuencia aleatoria, y rompería la coherencia entre
  // lo que el usuario vio y lo que cuenta para la clasificación). El resto
  // de partidos de la jornada (los posteriores al del usuario, los
  // anteriores ya los resolvió resolvePreUserMatches) se resuelven de
  // golpe, igual que siempre.
  function finishUserLeagueMatch(league, userMatch, finalResult, resolveMatchOptions, standingsBefore) {
    state.seasonCloseSummary = null;
    const roundNumber = userMatch.round;
    const newlyResolved = league.simulateNextRound(undefined, (match) => {
      if (match === userMatch) return { precomputedResult: finalResult };
      return resolveMatchOptions(match);
    });
    const fullRoundMatches = league.schedule.filter((m) => m.round === roundNumber);
    finishRoundBookkeeping(newlyResolved, fullRoundMatches, state.division, league, standingsBefore);
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
  // Pantalla: ficha universal de jugador (LIFE-4, DESIGN.md 9.15).
  // Capa de presentación pura sobre PlayerCareer.js/PlayerDevelopment.js/
  // Tactics.js/Medical.js/Training.js — no contiene ninguna regla propia,
  // solo lee y (vía openPlayerProfile/closePlayerProfile) navega. Abrir/
  // cambiar de pestaña aquí NUNCA avanza el calendario ni procesa
  // Training/Medical/Development/roles/alineación (invariantes 2/3/30).
  // ---------------------------------------------------------------------
  const PLAYER_PROFILE_TABS = [
    { id: 'summary', label: 'Resumen' },
    { id: 'attributes', label: 'Atributos' },
    { id: 'positions', label: 'Posiciones y roles' },
    { id: 'development', label: 'Desarrollo' },
    { id: 'stats', label: 'Estadísticas' },
    { id: 'medical', label: 'Médico' },
    { id: 'career', label: 'Carrera' },
    // CONTRACT-1 (DESIGN.md 9.17, sección 10.2): pestaña de solo lectura —
    // abrirla NUNCA crea, muta ni renueva un contrato, ni avanza el reloj,
    // ni infiere licencia/elegibilidad (eso es REG-1).
    { id: 'contract', label: 'Contrato' },
    // REG-1 (DESIGN.md 9.18, sección 13.2 del prompt): licencia, inscripción
    // y elegibilidad — SOLO LECTURA, sin botones de alta/baja/vinculación.
    { id: 'registration', label: 'Licencia y elegibilidad' },
    // MARKET-1 (DESIGN.md 9.19, sección 16.8 del prompt): disponibilidad,
    // representación, hilos y derechos — SIGUE resolviendo al jugador
    // desde Player Registry, incluso libre y sin club. Puede crear un
    // Agreement in Principle desde Mercado, pero abrir esta pestaña nunca
    // muta roster/contrato/inscripción por sí sola.
    { id: 'market', label: 'Mercado y representación' },
  ];

  // BUG-LIFE4-03 (ROSTER-1, DESIGN.md 9.16): resuelve la instancia REAL
  // (viva) desde el Player Registry mundial de la partida — YA NO recorre
  // `Team.roster` de los equipos actuales como si fuera un directorio
  // global (dejaba de funcionar en cuanto un jugador quedara sin club,
  // algo que todavía no puede pasar en ROSTER-1 pero que sí podrá con
  // MARKET-1/TRANSFER-1). El equipo actual se resuelve aparte por
  // `player.teamId` (sección 76 original: nunca por el último stint
  // histórico) — `null` si el jugador no tiene club, sin inventar equipo
  // ni división (ficha universal degradada, ver renderPlayer*Tab).
  function findPlayerById(playerId) {
    if (!state.playerRegistry) return null;
    const player = state.playerRegistry.get(playerId);
    if (!player) return null;
    const team = player.teamId ? (getAllTeams().find((t) => t.id === player.teamId) || null) : null;
    return { player, team };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  // Sección 29: helper único de nombre clicable — botón semántico estilo
  // enlace, accesible por teclado (es un <button> real), texto escapado.
  function playerLinkHtmlById(playerId, fullName, options) {
    const opts = options || {};
    const cls = opts.className ? ` ${opts.className}` : '';
    return `<button type="button" class="player-link${cls}" data-player-link-id="${playerId}">${escapeHtml(fullName)}</button>`;
  }
  function playerLinkHtml(player, options) {
    return playerLinkHtmlById(player.id, player.fullName, options);
  }

  // Sección 28: API única de apertura — `returnContext.returnScreen` es la
  // pantalla a la que vuelve `← Volver` (el resto del estado de esa
  // pantalla ya es duradero por sí mismo, ver comentario en `state`).
  function openPlayerProfile(playerId, returnContext) {
    state.playerProfile = {
      playerId,
      returnScreen: (returnContext && returnContext.returnScreen) || state.screen,
      returnSubscreen: (returnContext && returnContext.returnSubscreen) || null,
      activeTab: 'summary',
      developmentAttribute: null,
    };
    goToScreen('player-profile');
  }

  function closePlayerProfile() {
    const ctx = state.playerProfile;
    state.playerProfile = null;
    goToScreen((ctx && ctx.returnScreen) || 'home');
  }

  function roleLabelById(roleId, side) {
    if (!roleId) return null;
    const catalog = side === 'offensive' ? BM.OFFENSIVE_ROLES : BM.DEFENSIVE_ROLES;
    const found = catalog.find((r) => r.id === roleId);
    return found ? found.label : roleId;
  }

  function attributeGroupLabel(group) {
    return group === 'technical' ? 'Técnico' : (group === 'physical' ? 'Físico' : 'Mental');
  }

  function attributesSnapshotLive(player) {
    return BM.ATTRIBUTE_SNAPSHOT_KEYS.map((attr) => player[BM.ATTRIBUTE_GROUP[attr]][attr]);
  }

  // Sección 63: tooltip TMB — texto verbatim del prompt de esta sesión.
  const TMB_TOOLTIP_TEXT = 'TMB mide la capacidad actual del jugador en escala 1–200 a partir de sus atributos '
    + 'y su perfil posicional. No es su potencial.';

  const SEASON_HONOUR_LABELS = {
    cupChampion: 'Campeón de Copa',
    titlePlayoffChampion: 'Campeón del Playoff por el título',
    regularSeasonChampion2: 'Campeón de la liga regular de 2ª',
    promotedDirect: 'Ascenso directo a 1ª división',
    promotedPlayoff: 'Ascenso vía playoff a 1ª división',
  };
  const PERSONAL_BEST_TAB_LABELS = {
    points: 'puntos', totalRebounds: 'rebotes', assists: 'asistencias', blocks: 'tapones', steals: 'robos', valoracion: 'valoración',
  };
  const MILESTONE_TIMELINE_LABELS = {
    debut: () => 'Debut',
    firstStart: () => 'Primera titularidad',
    games50: () => '50 partidos',
    games100: () => '100 partidos',
    games250: () => '250 partidos',
    games500: () => '500 partidos',
    minutes1000: () => '1.000 minutos',
    minutes5000: () => '5.000 minutos',
    minutes10000: () => '10.000 minutos',
    personalBest: (m) => `Récord: ${PERSONAL_BEST_TAB_LABELS[(m.metadata || {}).stat] || (m.metadata || {}).stat} (${m.value})`,
  };

  // Sección 62: gráfico SVG/CSS puro, sin dependencias — maneja 1 punto,
  // valores constantes (rango de fallback) y varias temporadas; tabla
  // accesible debajo SIEMPRE (sección 35/61, fallback textual).
  function buildSimpleLineChartSvg(points, options) {
    const opts = Object.assign({ width: 320, height: 130, min: null, max: null, padding: 26 }, options || {});
    if (!points.length) return '<p class="gm-muted">Sin datos suficientes.</p>';
    const values = points.map((p) => p.value);
    const min = opts.min !== null ? opts.min : Math.min(...values);
    const max = opts.max !== null ? opts.max : Math.max(...values);
    const range = (max - min) || 1;
    const innerW = opts.width - opts.padding * 2;
    const innerH = opts.height - opts.padding * 2;
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    const coords = points.map((p, i) => ({
      x: opts.padding + stepX * i,
      y: opts.padding + innerH - ((p.value - min) / range) * innerH,
      label: p.label,
      value: p.value,
    }));
    const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const dotsHtml = coords.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" class="chart-dot"></circle>`).join('');
    const labelsHtml = coords.map((c) => `<text x="${c.x.toFixed(1)}" y="${opts.height - 6}" class="chart-axis-label" text-anchor="middle">${escapeHtml(c.label)}</text>`).join('');
    const tableHtml = `<table class="chart-fallback-table gm-table"><thead><tr>${coords.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
      <tbody><tr>${coords.map((c) => `<td>${c.value}</td>`).join('')}</tr></tbody></table>`;
    return `
      <svg viewBox="0 0 ${opts.width} ${opts.height}" class="chart-svg" role="img" aria-label="Gráfico de evolución" preserveAspectRatio="xMidYMid meet">
        <polyline points="${polylinePoints}" class="chart-line" fill="none"></polyline>
        ${dotsHtml}
        ${labelsHtml}
      </svg>
      ${tableHtml}`;
  }

  // --- Sección 32: Resumen ---
  // `team` puede ser `null` (BUG-LIFE4-03, ROSTER-1 DESIGN.md 9.16):
  // jugador sin club actual — degrada cabecera/roles/entrenamiento sin
  // inventar equipo/división/plan, sin dejar de mostrar lo que sí depende
  // solo del jugador (TMB, estado, estadísticas de temporada).
  function renderPlayerSummaryTab(player, team, ch, config) {
    const tmb = BM.computeTmbRating(player, config);
    const cs = ch.currentSeason;
    const games = BM.statValue(cs.stats, 'games');
    const avg = (key) => (games > 0 ? BM.statValue(cs.stats, key) / games : 0);
    const minutesAvg = games > 0 ? BM.statValue(cs.stats, 'seconds') / games : null;

    let medicalLine = '—';
    if (config.medical.enabled) {
      // Medical.js ya tolera `team: null` (usa el contexto médico neutral
      // de `config.medical.staffContext`, nunca asume instalaciones de un
      // equipo) — ver Medical.js, sección "hook de Staff".
      const info = BM.getAvailability(player, state.calendar.currentGameDateTime, config, { team });
      medicalLine = info.status === 'available' ? 'Disponible'
        : info.status === 'limited' ? `Disponible con restricción (máx. ${info.minuteCap} min)`
          : 'Lesionado';
    }

    const completenessNoteHtml = ch.historyCompleteness === 'partial'
      ? '<p class="gm-muted">Histórico registrado desde el inicio de esta partida.</p>' : '';
    // ROSTER-1 (DESIGN.md 9.16): un jugador de relleno ficticio por
    // cobertura de datos incompleta nunca se presenta como jugador real.
    const fictionalFallbackNoteHtml = player.dataSource === BM.FICTIONAL_FALLBACK_DATA_SOURCE
      ? '<p class="gm-muted">Jugador ficticio generado para completar esta plantilla (cobertura de datos reales incompleta).</p>'
      : '';

    const headerSubtitle = team
      ? `${player.age ?? '—'} años · ${escapeHtml(team.fullName)} (${team.division}) · ${player.nominalPosition}`
      : `${player.age ?? '—'} años · Sin club · ${player.nominalPosition}`;

    let rolesCardHtml;
    if (team) {
      const rolesInfo = buildRolesSnapshotForPlayer(player, team);
      const offenseLabel = roleLabelById(rolesInfo.offense && rolesInfo.offense[0], 'offensive');
      const defenseLabel = roleLabelById(rolesInfo.defense && rolesInfo.defense[0], 'defensive');
      rolesCardHtml = `
      <div class="gm-card">
        <h4>Roles</h4>
        <p>Ofensivo: ${offenseLabel || '—'}${rolesInfo.offense ? ` (familiaridad ${rolesInfo.offense[1]}/100)` : ''}</p>
        <p>Defensivo: ${defenseLabel || '—'}${rolesInfo.defense ? ` (familiaridad ${rolesInfo.defense[1]}/100)` : ''}</p>
      </div>`;
    } else {
      rolesCardHtml = '<div class="gm-card"><h4>Roles</h4><p class="gm-muted">Sin rol de club actual.</p></div>';
    }

    let trainingCardHtml;
    if (team) {
      const focus = BM.getIndividualFocus(team, player.id, config);
      const focusLabel = focus.type === 'none' ? 'Ninguno'
        : focus.type === 'attribute' ? `Atributo: ${trainingAttributeLabel(focus.target)}`
          : focus.type === 'position' ? `Posición: ${focus.target}`
            : `Rol: ${roleLabelById(focus.target, focus.side === 'offense' ? 'offensive' : 'defensive')}`;
      trainingCardHtml = `
      <div class="gm-card">
        <h4>Entrenamiento</h4>
        <p>Foco individual: ${focusLabel}</p>
        <p class="gm-muted">Plan de equipo: ${TRAINING_TEAM_FOCUS_LABELS[team.trainingPlan.teamFocus]} · ${TRAINING_INTENSITY_LABELS[team.trainingPlan.intensity]}</p>
      </div>`;
    } else {
      trainingCardHtml = '<div class="gm-card"><h4>Entrenamiento</h4><p class="gm-muted">No disponible sin club.</p></div>';
    }

    return `
      <div class="gm-card player-profile__header">
        <h3>${escapeHtml(player.fullName)}</h3>
        <p class="gm-muted">${headerSubtitle}</p>
        <p class="gm-muted">${player.bodyMeasurements.height} cm · Envergadura ${player.bodyMeasurements.wingspan} cm · ${player.bodyMeasurements.weight} kg</p>
        <p class="player-profile__tmb" title="${escapeHtml(TMB_TOOLTIP_TEXT)}">TMB <strong>${tmb}</strong>/200 <span class="gm-muted">ⓘ</span></p>
        ${completenessNoteHtml}
        ${fictionalFallbackNoteHtml}
      </div>
      <div class="gm-card">
        <h4>Estado</h4>
        <p>Energía: <strong>${Math.round(player.dynamicState.energy)}</strong>/100</p>
        <p>Ritmo de competición: ${competitionRhythmToStars(player.dynamicState.competitionRhythm)}</p>
        <p>Disponibilidad médica: ${medicalLine}</p>
      </div>
      <div class="gm-card">
        <h4>Temporada ${escapeHtml(cs.seasonKey)}</h4>
        <div class="gm-table-scroll"><table class="gm-table gm-table--totals player-profile__season-summary">
          <thead><tr><th>PJ</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>Val</th></tr></thead>
          <tbody><tr>
            <td>${games}</td>
            <td>${formatMinutesSingle(minutesAvg)}</td>
            <td>${avg('points').toFixed(1)}</td>
            <td>${(avg('offensiveRebounds') + avg('defensiveRebounds')).toFixed(1)}</td>
            <td>${avg('assists').toFixed(1)}</td>
            <td>${avg('valoracion').toFixed(1)}</td>
          </tr></tbody>
        </table></div>
      </div>
      ${rolesCardHtml}
      ${trainingCardHtml}`;
  }

  // --- Sección 33: Atributos ---
  function renderPlayerAttributesTab(player, ch) {
    const previousSnapshot = ch.seasons.length ? ch.seasons[ch.seasons.length - 1].attributes : ch.baseline.attributes;
    const groups = [
      { key: 'technical', attrs: BM.MUTABLE_TECHNICAL },
      { key: 'physical', attrs: BM.MUTABLE_PHYSICAL },
      { key: 'mental', attrs: BM.MUTABLE_MENTAL },
    ];
    return groups.map((g) => {
      const rowsHtml = g.attrs.map((attr) => {
        const current = player[g.key][attr];
        const previous = BM.attributeAt(previousSnapshot, attr);
        const trend = BM.describeAttributeTrend(previous, current);
        const deltaText = trend.delta !== 0 ? ` ${trend.arrow} ${trend.delta > 0 ? '+' : ''}${trend.delta}` : ` ${trend.arrow}`;
        return `<tr><td>${trainingAttributeLabel(attr)}</td><td>${current}${deltaText}</td></tr>`;
      }).join('');
      return `<div class="gm-card"><h4>${attributeGroupLabel(g.key)}</h4>
        <div class="gm-table-scroll"><table class="gm-table player-profile__attributes-table"><tbody>${rowsHtml}</tbody></table></div></div>`;
    }).join('');
  }

  // --- Sección 34: Posiciones y roles ---
  // `team` puede ser `null` (BUG-LIFE4-03) — el encaje de roles
  // (`bestRolesForPlayer`/`roleFit`) es calculable SIN club (depende solo
  // del jugador) y se mantiene siempre; el rol ASIGNADO actual sí depende
  // de `team.tacticalProfile` y se degrada a "Sin club actual".
  function renderPlayerPositionsTab(player, team, config) {
    const { POSITIONS } = BM;
    const focusNote = team && BM.getIndividualFocus(team, player.id, config).type === 'position'
      ? `<p class="gm-muted">Entrenando: ${BM.getIndividualFocus(team, player.id, config).target}</p>` : '';
    const posRows = POSITIONS.map((pos) => {
      const level = player.positionLevel(pos);
      const tags = [];
      if (pos === player.nominalPosition) tags.push('Nominal');
      if (level === 20) tags.push('Dominada');
      return `<tr><td>${pos}</td><td>${level}/20</td><td>${tags.join(' · ')}</td></tr>`;
    }).join('');

    const bestOffense = BM.bestRolesForPlayer(player, 'offensive', config, 3).map((r) => `${r.label} ${starsHtml(r.stars)}`).join(' · ');
    const bestDefense = BM.bestRolesForPlayer(player, 'defensive', config, 3).map((r) => `${r.label} ${starsHtml(r.stars)}`).join(' · ');
    const rolesSnapshot = team ? buildRolesSnapshotForPlayer(player, team) : { offense: null, defense: null };
    const currentOffenseHtml = !team ? 'Sin club actual' : (rolesSnapshot.offense
      ? `${roleLabelById(rolesSnapshot.offense[0], 'offensive')} — familiaridad ${rolesSnapshot.offense[1]}/100, ${starsHtml(BM.roleFit(player, rolesSnapshot.offense[0], config).stars)}`
      : 'Sin rol asignado');
    const currentDefenseHtml = !team ? 'Sin club actual' : (rolesSnapshot.defense
      ? `${roleLabelById(rolesSnapshot.defense[0], 'defensive')} — familiaridad ${rolesSnapshot.defense[1]}/100, ${starsHtml(BM.roleFit(player, rolesSnapshot.defense[0], config).stars)}`
      : 'Sin rol asignado');

    return `
      <div class="gm-card">
        <h4>Posiciones</h4>
        ${focusNote}
        <div class="gm-table-scroll"><table class="gm-table"><thead><tr><th>Posición</th><th>Nivel</th><th></th></tr></thead><tbody>${posRows}</tbody></table></div>
      </div>
      <div class="gm-card">
        <h4>Roles</h4>
        <p>Ofensivo actual: ${currentOffenseHtml}</p>
        <p class="gm-muted">Mejor encaje ofensivo: ${bestOffense}</p>
        <p>Defensivo actual: ${currentDefenseHtml}</p>
        <p class="gm-muted">Mejor encaje defensivo: ${bestDefense}</p>
      </div>`;
  }

  // --- Sección 35/36: Desarrollo ---
  function renderPlayerDevelopmentTab(player, ch, config) {
    const seasonPoints = [{ label: 'Inicio', value: ch.baseline.tmb }];
    ch.seasons.forEach((s) => seasonPoints.push({ label: s.seasonKey, value: s.tmb }));
    seasonPoints.push({ label: 'Actual', value: BM.computeTmbRating(player, config) });
    const tmbChartHtml = buildSimpleLineChartSvg(seasonPoints, { min: 1, max: 200 });

    const selectedAttr = state.playerProfile.developmentAttribute || BM.ATTRIBUTE_SNAPSHOT_KEYS[0];
    const attrOptionsHtml = BM.ATTRIBUTE_SNAPSHOT_KEYS.map((attr) => `
      <option value="${attr}" ${attr === selectedAttr ? 'selected' : ''}>${trainingAttributeLabel(attr)}</option>`).join('');
    const attrPoints = [{ label: 'Inicio', value: BM.attributeAt(ch.baseline.attributes, selectedAttr) }];
    ch.seasons.forEach((s) => attrPoints.push({ label: s.seasonKey, value: BM.attributeAt(s.attributes, selectedAttr) }));
    attrPoints.push({ label: 'Actual', value: player[BM.ATTRIBUTE_GROUP[selectedAttr]][selectedAttr] });
    const attrChartHtml = buildSimpleLineChartSvg(attrPoints, { min: 1, max: 20 });

    const positionsSeasonsToShow = ch.seasons.filter((s, i) => (
      i === 0 || JSON.stringify(s.positions) !== JSON.stringify(ch.seasons[i - 1].positions)
    ));
    const posRows = positionsSeasonsToShow.map((s) => `
      <tr><td>${s.seasonKey}</td>${BM.POSITION_SNAPSHOT_KEYS.map((pos) => `<td>${BM.positionAt(s.positions, pos)}</td>`).join('')}</tr>`).join('');
    const currentPosRow = `<tr><td>Actual</td>${BM.POSITION_SNAPSHOT_KEYS.map((pos) => `<td>${player.positionLevel(pos)}</td>`).join('')}</tr>`;

    const lastAttributes = ch.seasons.length ? ch.seasons[ch.seasons.length - 1].attributes : ch.baseline.attributes;
    const lastTmb = ch.seasons.length ? ch.seasons[ch.seasons.length - 1].tmb : ch.baseline.tmb;
    const currentTmb = BM.computeTmbRating(player, config);
    const groupTrends = BM.summarizeGroupTrends(lastAttributes, attributesSnapshotLive(player));
    const tmbDelta = currentTmb - lastTmb;
    const autoText = [];
    autoText.push(tmbDelta !== 0
      ? `TMB ${tmbDelta > 0 ? '+' : ''}${tmbDelta} desde ${ch.seasons.length ? 'la temporada pasada' : 'el inicio'}.`
      : 'TMB se mantiene estable.');
    ['technical', 'physical', 'mental'].forEach((group) => {
      const t = groupTrends[group];
      if (t.direction !== 'stable') {
        autoText.push(`${attributeGroupLabel(group)} ${t.direction === 'up' ? 'mejora' : 'empeora'} (${t.delta > 0 ? '+' : ''}${t.delta.toFixed(2)}).`);
      }
    });

    return `
      <div class="gm-card">
        <h4>TMB por temporada</h4>
        ${tmbChartHtml}
      </div>
      <div class="gm-card">
        <h4>Atributo</h4>
        <select id="player-profile-attribute-select">${attrOptionsHtml}</select>
        ${attrChartHtml}
      </div>
      <div class="gm-card">
        <h4>Posiciones</h4>
        <div class="gm-table-scroll"><table class="gm-table"><thead><tr><th>Temporada</th>${BM.POSITION_SNAPSHOT_KEYS.map((p) => `<th>${p}</th>`).join('')}</tr></thead>
        <tbody>${posRows}${currentPosRow}</tbody></table></div>
      </div>
      <div class="gm-card">
        <h4>Lectura automática</h4>
        <ul>${autoText.map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>`;
  }

  // --- Sección 37: Estadísticas ---
  function renderPlayerSeasonStatsRow(seasonKey, stints, statsArray, isCurrent) {
    const games = BM.statValue(statsArray, 'games');
    const clubLabel = stints.length > 1 ? `${stints.length} equipos` : ((stints[0] && stints[0].teamName) || '—');
    const avg = (key) => (games > 0 ? BM.statValue(statsArray, key) / games : 0);
    return `<tr class="${isCurrent ? 'is-user-team' : ''}">
      <td>${escapeHtml(seasonKey)}</td>
      <td>${escapeHtml(clubLabel)}</td>
      <td>${games}</td>
      <td>${formatMinutesSingle(games > 0 ? BM.statValue(statsArray, 'seconds') / games : null)}</td>
      <td>${avg('points').toFixed(1)}</td>
      <td>${(avg('offensiveRebounds') + avg('defensiveRebounds')).toFixed(1)}</td>
      <td>${avg('assists').toFixed(1)}</td>
      <td>${avg('valoracion').toFixed(1)}</td>
    </tr>`;
  }

  function pctOrDash(made, attempted) {
    return attempted > 0 ? `${Math.round((made / attempted) * 100)}%` : '—';
  }

  function renderPlayerStatsTab(player, ch) {
    const rows = ch.seasons.map((s) => renderPlayerSeasonStatsRow(s.seasonKey, s.stints, s.stats, false));
    rows.push(renderPlayerSeasonStatsRow(ch.currentSeason.seasonKey, ch.currentSeason.teamStints, ch.currentSeason.stats, true));

    const totals = BM.computeCareerTotals(player);
    const totalsLabel = ch.historyCompleteness === 'complete' ? 'Carrera' : 'Registrado en esta partida';

    return `
      <div class="gm-card">
        <div class="gm-table-scroll"><table class="gm-table">
          <thead><tr><th>Temp</th><th>Club</th><th>PJ</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>Val</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table></div>
      </div>
      <div class="gm-card">
        <h4>${totalsLabel}</h4>
        <div class="gm-table-scroll"><table class="gm-table gm-table--totals">
          <thead><tr><th>PJ</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>Rob</th><th>Tap</th><th>Val</th><th>T2%</th><th>T3%</th><th>TL%</th><th>+/-</th></tr></thead>
          <tbody><tr>
            <td>${totals.games}</td>
            <td>${formatMinutesSingle(totals.seconds)}</td>
            <td>${totals.points}</td>
            <td>${totals.totalRebounds}</td>
            <td>${totals.assists}</td>
            <td>${totals.steals}</td>
            <td>${totals.blocks}</td>
            <td>${totals.valoracion.toFixed(0)}</td>
            <td>${pctOrDash(totals.fg2Made, totals.fg2Attempted)}</td>
            <td>${pctOrDash(totals.fg3Made, totals.fg3Attempted)}</td>
            <td>${pctOrDash(totals.ftMade, totals.ftAttempted)}</td>
            <td>${totals.plusMinus >= 0 ? '+' : ''}${totals.plusMinus}</td>
          </tr></tbody>
        </table></div>
      </div>`;
  }

  // --- Sección 38: Médico — reutiliza medicalState directamente, NUNCA
  // copiado a careerHistory (LIFE-3 sigue siendo la fuente).
  function renderPlayerMedicalHistoryTable(player, config) {
    const history = (player.medicalState && player.medicalState.injuryHistory) || [];
    if (!history.length) return '<p class="gm-muted">Sin lesiones con baja registradas en esta partida.</p>';
    const rows = [...history].sort((a, b) => b.occurredAt - a.occurredAt).map((entry) => {
      const label = config.medical.catalog[entry.type] ? config.medical.catalog[entry.type].label : entry.type;
      return `<tr>
        <td>${formatHistoryDate(entry.occurredAt)}</td>
        <td>${label}</td>
        <td>${MEDICAL_SEVERITY_LABELS[entry.severity] || entry.severity}</td>
        <td>${entry.daysUnavailable}</td>
        <td>${entry.recurrenceOf ? 'Sí' : 'No'}</td>
        <td>${entry.sequela ? 'Sí' : 'No'}</td>
      </tr>`;
    }).join('');
    return `<div class="gm-table-scroll"><table class="gm-table">
      <thead><tr><th>Fecha</th><th>Lesión</th><th>Gravedad</th><th>Días fuera</th><th>Recaída</th><th>Secuela</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function renderPlayerMedicalTab(player, team, config) {
    if (!config.medical.enabled) return '<p class="gm-muted">Sistema médico desactivado.</p>';
    const referenceDate = state.calendar.currentGameDateTime;
    const info = BM.getAvailability(player, referenceDate, config, { team });
    const activeHtml = info.injury ? `
      <div class="gm-card">
        <h4>Lesión activa</h4>
        <p>Diagnóstico: ${config.medical.catalog[info.injury.type] ? config.medical.catalog[info.injury.type].label : info.injury.type}</p>
        <p>Fase: ${info.phase}</p>
        <p>Gravedad: ${MEDICAL_SEVERITY_LABELS[info.injury.severity] || info.injury.severity}</p>
        <p>Vuelta estimada: ${(BM.getEstimatedReturnRange(player, referenceDate, config, team) || {}).label || '—'}</p>
        <p>Máximo médico: ${info.minuteCap !== null && info.minuteCap !== undefined ? `${info.minuteCap} min` : '—'}</p>
        <p>Recaídas: ${info.injury.setbackCount || 0}</p>
      </div>` : '';
    return `${activeHtml}
      <div class="gm-card">
        <h4>Historial médico</h4>
        ${renderPlayerMedicalHistoryTable(player, config)}
      </div>`;
  }

  // --- Sección 39: Carrera ---
  function buildCareerTimelineHtml(ch, includeCareerMilestones) {
    const honourEntries = [];
    ch.seasons.forEach((s) => {
      (s.honours || []).forEach((code) => honourEntries.push({ date: s.endDate, label: SEASON_HONOUR_LABELS[code] || code }));
    });
    const milestoneEntries = includeCareerMilestones
      ? ch.milestones.map((m) => ({ date: m.date, label: (MILESTONE_TIMELINE_LABELS[m.type] || (() => m.type))(m) }))
      : ch.milestones.filter((m) => m.type === 'personalBest').map((m) => ({
        date: m.date,
        label: `Mejor registro en esta partida: ${PERSONAL_BEST_TAB_LABELS[(m.metadata || {}).stat] || ''} (${m.value})`,
      }));
    const entries = [...honourEntries, ...milestoneEntries].sort((a, b) => b.date - a.date);
    if (!entries.length) return '<p class="gm-muted">Todavía no hay hitos registrados.</p>';
    return `<ul class="career-timeline">${entries.map((e) => `<li>${formatHistoryDate(e.date)} — ${e.label}</li>`).join('')}</ul>`;
  }

  function renderPlayerCareerTab(player, ch) {
    if (ch.historyCompleteness === 'partial') {
      return `
        <div class="gm-card">
          <p class="gm-muted">El histórico de Basket Manager comienza en ${formatHistoryDate(ch.historyStartDate)}. Los logros anteriores no están disponibles.</p>
        </div>
        <div class="gm-card"><h4>Timeline</h4>${buildCareerTimelineHtml(ch, false)}</div>`;
    }
    return `<div class="gm-card"><h4>Timeline de carrera</h4>${buildCareerTimelineHtml(ch, true)}</div>`;
  }

  // ---------------------------------------------------------------------
  // CONTRACT-1 (DESIGN.md 9.17) — presentación de contratos.
  //
  // Capa de solo lectura: NO hay ningún botón de renovar, fichar, liberar,
  // ejecutar cláusula, tantear ni ceder (eso es MARKET-1/TRANSFER-1/
  // LOAN-1). Todo lo que se muestra sale de `state.contractRegistry` y de
  // `CompetitionRules` — esta pantalla no calcula ninguna regla propia.
  // ---------------------------------------------------------------------
  const CONTRACT_STATUS_LABELS = {
    pending: 'Pendiente de inicio',
    active: 'Vigente',
    expired: 'Expirado',
    terminated: 'Terminado',
    void: 'Anulado',
  };

  const RULE_STATUS_LABELS = {
    verified: 'Verificada',
    provisional: 'Provisional',
    deprecated: 'Derogada',
    'reference-only': 'Solo referencia',
  };

  // REG-1 (DESIGN.md 9.18): vocabulario compartido entre la pantalla
  // Inscripciones y la pestaña "Licencia y elegibilidad" de la ficha.
  const ACCESS_CATEGORY_FULL_LABELS = {
    senior: 'Senior', 'own-lower-category': 'Propio de categoría inferior', linked: 'Vinculado', 'additional-list': 'Lista adicional',
  };
  const REGISTRATION_STATUS_LABELS = {
    submitted: 'Presentada', validated: 'Validada', provisional: 'Autorización provisional', active: 'Activa',
    suspended: 'Suspendida', deactivated: 'Dada de baja', rejected: 'Rechazada', expired: 'Expirada',
  };
  const LICENSE_CLASS_LABELS = {
    'professional-senior': 'Profesional senior', 'own-lower-category': 'Propio de categoría inferior', 'linked-player': 'Vinculado',
  };

  // Umbral de la etiqueta "expira pronto": es una etiqueta DE INTERFAZ
  // derivada, nunca un estado jurídico persistido en el contrato.
  const CONTRACT_EXPIRING_SOON_SEASONS = 1;

  function formatMoneyMinor(amountMinor, currency, options) {
    return BM.Money.format(amountMinor || 0, currency || 'EUR', options || { compact: true });
  }

  function formatIsoDateEs(iso) {
    return BM.LocalDate.formatEs(iso);
  }

  function simulatedContractNoticeHtml() {
    return `
      <p class="contract-notice" role="note">
        <span class="gm-badge gm-badge--simulated">Simulado</span>
        ${BM.ContractSeeder.SIMULATED_CONTRACT_WARNING}
      </p>`;
  }

  function ruleResolutionBadgeHtml(resolutionMode) {
    if (resolutionMode === 'provisionalCarryForward') {
      return '<span class="gm-badge gm-badge--provisional" title="Norma aplicada por continuidad provisional: no verificada para esta temporada">Continuidad provisional</span>';
    }
    if (resolutionMode === 'pinned') {
      return '<span class="gm-badge gm-badge--pinned" title="Versión normativa fijada (congelada) para este contrato">Versión fijada</span>';
    }
    return '<span class="gm-badge gm-badge--verified" title="Norma vigente y verificada para la temporada solicitada">Vigente verificada</span>';
  }

  function ruleModuleListHtml(moduleIds, ruleVersions) {
    return `<ul class="contract-modules">${moduleIds.map((moduleId) => {
      let module_ = null;
      try { module_ = BM.getEmploymentModule(moduleId); } catch (err) { module_ = null; }
      const status = module_ ? module_.status : 'desconocido';
      const version = (ruleVersions && ruleVersions[moduleId]) || (module_ ? module_.version : '?');
      const sources = module_ ? module_.sourceRefs.map((ref) => (
        `<li><a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener">${escapeHtml(ref.title)}</a>`
        + `<span class="gm-muted"> · consultado ${escapeHtml(ref.retrievedAt)}</span></li>`
      )).join('') : '';
      return `
        <li class="contract-module">
          <span class="contract-module__id">${escapeHtml(moduleId)}</span>
          <span class="gm-badge gm-badge--${status === 'verified' ? 'verified' : 'provisional'}">${escapeHtml(RULE_STATUS_LABELS[status] || status)}</span>
          <span class="gm-muted">v${escapeHtml(String(version))}</span>
          ${sources ? `<ul class="contract-sources">${sources}</ul>` : ''}
        </li>`;
    }).join('')}</ul>`;
  }

  function contractWarningsHtml(warnings, title) {
    if (!warnings || !warnings.length) return '';
    return `
      <details class="contract-warnings">
        <summary>${escapeHtml(title)} (${warnings.length})</summary>
        <ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      </details>`;
  }

  // --- Pestaña "Contrato" de la ficha universal --------------------------
  function renderPlayerContractTab(player, team) {
    if (!state.contractRegistry) {
      return '<div class="gm-card"><p class="gm-muted">Todavía no hay registro contractual en esta partida.</p></div>';
    }
    const isoDate = currentGameIsoDate();
    const history = state.contractRegistry.forPlayer(player.id);
    const current = state.contractRegistry.currentForPlayer(player.id, isoDate);
    if (!current) {
      return `
        <div class="gm-card">
          <h4>Contrato</h4>
          <p class="gm-muted">Sin contrato${team ? '' : ' · Sin club'}.</p>
          <p class="gm-muted">Un jugador puede existir sin club y sin contrato: contrato, afiliación y licencia son cosas distintas.</p>
        </div>
        ${history.length ? renderContractHistoryCard(history, isoDate) : ''}`;
    }

    const seasonKey = buildCareerSeasonKey();
    const breakdown = current.breakdownForSeason(
      current.coveredSeasonKeys.includes(seasonKey) ? seasonKey : current.coveredSeasonKeys[0],
    );
    const context = current.signingContext || {};
    const employerLabel = BM.ClubEmploymentContextCatalog.jurisdictionLabel(context.employerJurisdictionId);
    const status = current.statusOn(isoDate);
    const remaining = current.remainingSeasonKeys(seasonKey).length;
    const expiringSoon = remaining <= CONTRACT_EXPIRING_SOON_SEASONS && status !== 'expired';

    const seasonRows = current.coveredSeasonKeys.map((key) => {
      const b = current.breakdownForSeason(key);
      return `
        <tr>
          <th scope="row">${escapeHtml(key)}</th>
          <td>${formatMoneyMinor(b.guaranteedBaseSalaryMinor, b.currency)}</td>
          <td>${formatMoneyMinor(b.guaranteedImageRightsMinor, b.currency)}</td>
          <td>${formatMoneyMinor(b.guaranteedSalaryInKindMinor, b.currency)}</td>
          <td>${formatMoneyMinor(b.variableMaxMinor, b.currency)}</td>
          <td>${formatMoneyMinor(b.guaranteedTotalMinor, b.currency)}</td>
        </tr>`;
    }).join('');

    const scheduleRows = current.scheduleForSeason(breakdown.seasonKey).map((installment) => `
      <tr>
        <th scope="row">${installment.index}</th>
        <td>${escapeHtml(formatIsoDateEs(installment.dueDate))}</td>
        <td>${formatMoneyMinor(installment.amountMinor, installment.currency, { compact: false })}</td>
      </tr>`).join('');

    const clausesHtml = current.clauses.length
      ? `<ul class="contract-clauses">${current.clauses.map((clause) => {
        const definition = BM.CLAUSE_TYPE_DEFINITIONS[clause.type];
        return `
          <li>
            <strong>${escapeHtml(definition ? definition.label : clause.type)}</strong>
            ${clause.amount ? ` — ${formatMoneyMinor(clause.amount.amountMinor, clause.amount.currency)}` : ''}
            <span class="gm-badge gm-badge--simulated">Simulada</span>
            <span class="gm-badge gm-badge--modeled" title="Modelada, todavía no ejecutable (MARKET-1/TRANSFER-1)">No ejecutable</span>
          </li>`;
      }).join('')}</ul>`
      : '<p class="gm-muted">Sin cláusulas.</p>';

    const minorHtml = current.minorProtections ? `
      <div class="gm-card">
        <h4>Protección de menores</h4>
        <p>Edad al firmar: ${current.minorProtections.ageAtSigning} años.</p>
        <p>Marcadores exigidos por el perfil: ${current.minorProtections.markers.map((m) => escapeHtml(m)).join(', ')}
          <span class="gm-badge gm-badge--simulated">Simulados</span></p>
        <p class="gm-muted">${escapeHtml(current.minorProtections.note)}</p>
      </div>` : '';

    return `
      <div class="gm-card contract-card">
        <h4>Contrato actual</h4>
        ${simulatedContractNoticeHtml()}
        <dl class="contract-facts">
          <div><dt>Club empleador</dt><dd>${escapeHtml(team ? team.fullName : current.clubId)}</dd></div>
          <div><dt>Estado</dt><dd>${escapeHtml(CONTRACT_STATUS_LABELS[status])}${expiringSoon ? ' <span class="gm-badge gm-badge--warning">Expira pronto</span>' : ''}</dd></div>
          <div><dt>Vigencia</dt><dd>${escapeHtml(formatIsoDateEs(current.startDate))} → ${escapeHtml(formatIsoDateEs(current.endDate))}</dd></div>
          <div><dt>Temporadas restantes</dt><dd>${remaining}</dd></div>
          <div><dt>Garantía</dt><dd>${current.guaranteeType === 'fully-guaranteed' ? 'Totalmente garantizado' : escapeHtml(current.guaranteeType)}</dd></div>
          <div><dt>Jurisdicción laboral</dt><dd>${escapeHtml(employerLabel)}</dd></div>
          <div><dt>Perfil normativo</dt><dd>${escapeHtml(context.employmentProfileId || '—')} ${ruleResolutionBadgeHtml(context.resolutionMode)}</dd></div>
          <div><dt>Periodo de prueba</dt><dd>${current.probation.enabled
    ? `${current.probation.durationDays} días (${escapeHtml(formatIsoDateEs(current.probation.startDate))} → ${escapeHtml(formatIsoDateEs(current.probation.endDate))})`
    : 'No'}</dd></div>
        </dl>
      </div>

      <div class="gm-card">
        <h4>Desglose por temporada (${escapeHtml(breakdown.basis === 'gross' ? 'importes brutos' : breakdown.basis)})</h4>
        <div class="gm-table-scroll">
          <table class="gm-table contract-table">
            <thead><tr><th>Temporada</th><th>Salario base</th><th>Imagen</th><th>Especie</th><th>Variable máx.</th><th>Garantizado</th></tr></thead>
            <tbody>${seasonRows}</tbody>
          </table>
        </div>
      </div>

      <div class="gm-card">
        <h4>Calendario de pagos ${escapeHtml(breakdown.seasonKey)} (${current.paymentPolicy.installmentCount} cuotas)</h4>
        <div class="gm-table-scroll">
          <table class="gm-table contract-table">
            <thead><tr><th>Cuota</th><th>Vencimiento</th><th>Importe</th></tr></thead>
            <tbody>${scheduleRows}</tbody>
          </table>
        </div>
        <p class="gm-muted">Compromiso de pago previsto; el juego no simula pagos realizados, impagos ni tesorería.</p>
      </div>

      <div class="gm-card">
        <h4>Cláusulas</h4>
        ${clausesHtml}
      </div>
      ${minorHtml}

      <div class="gm-card">
        <h4>Normativa aplicada en la firma</h4>
        <p class="gm-muted">Módulos congelados el ${escapeHtml(formatIsoDateEs(current.signedDate))}: un ascenso o descenso posterior no reescribe la norma de un contrato ya firmado.</p>
        ${ruleModuleListHtml(context.ruleModuleIds || [], context.ruleVersions)}
        ${contractWarningsHtml(context.warnings, 'Advertencias normativas')}
        ${contractWarningsHtml(context.knownSourceInconsistencies, 'Inconsistencias conocidas de las fuentes')}
      </div>
      ${history.length > 1 ? renderContractHistoryCard(history, isoDate) : ''}`;
  }

  function renderContractHistoryCard(history, isoDate) {
    return `
      <div class="gm-card">
        <h4>Histórico contractual</h4>
        <div class="gm-table-scroll">
          <table class="gm-table contract-table">
            <thead><tr><th>Club</th><th>Desde</th><th>Hasta</th><th>Estado</th></tr></thead>
            <tbody>${history.map((contract) => {
    const club = getAllTeams().find((t) => t.id === contract.clubId);
    return `
              <tr>
                <td>${escapeHtml(club ? club.fullName : contract.clubId)}</td>
                <td>${escapeHtml(formatIsoDateEs(contract.startDate))}</td>
                <td>${escapeHtml(formatIsoDateEs(contract.endDate))}</td>
                <td>${escapeHtml(CONTRACT_STATUS_LABELS[contract.statusOn(isoDate)])}</td>
              </tr>`;
  }).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }

  // --- Pestaña "Licencia y elegibilidad" de la ficha universal (REG-1,
  // DESIGN.md 9.18, sección 13.2 del prompt) -----------------------------
  function simulatedRegistrationNoticeHtml() {
    return `
      <p class="contract-notice" role="note">
        <span class="gm-badge gm-badge--simulated">Simulado</span>
        ${escapeHtml(BM.RegistrationSeeder.SIMULATED_REGISTRATION_WARNING)}
      </p>`;
  }

  function classificationSnapshotBadgesHtml(snapshot) {
    if (!snapshot) return '—';
    const parts = [];
    if (snapshot.formation === 'qualifies') parts.push('<span class="gm-badge gm-badge--formation">Formación</span>');
    else if (snapshot.formation === 'unknown') parts.push('<span class="gm-badge gm-badge--unknown">Formación: desconocida</span>');
    if (snapshot.nonCommunity === 'counts') parts.push('<span class="gm-badge gm-badge--noncommunity">No comunitario</span>');
    return parts.join(' ') || '<span class="gm-muted">Sin marcas</span>';
  }

  // Jugador libre (sin club) sigue localizable desde PlayerRegistry y puede
  // mostrar histórico aunque no tenga licencia activa (sección 13.2).
  function renderPlayerRegistrationTab(player, team) {
    if (!state.registrationRegistry) {
      return '<div class="gm-card"><p class="gm-muted">Todavía no hay registro de inscripciones en esta partida.</p></div>';
    }
    const registry = state.registrationRegistry;
    const isoDate = currentGameIsoDate();
    const licenses = registry.licensesForPlayer(player.id);
    const currentLicense = registry.currentLicenseForPlayer(player.id, isoDate);
    const registrations = registry.registrationsForPlayer(player.id);

    const licenseHtml = currentLicense ? `
      <dl class="contract-facts">
        <div><dt>Federación</dt><dd>${escapeHtml(currentLicense.federationId)}</dd></div>
        <div><dt>Temporada</dt><dd>${escapeHtml(currentLicense.seasonKey)}</dd></div>
        <div><dt>Clase</dt><dd>${escapeHtml(LICENSE_CLASS_LABELS[currentLicense.licenseClass] || currentLicense.licenseClass)}</dd></div>
        <div><dt>Vigencia</dt><dd>${escapeHtml(formatIsoDateEs(currentLicense.validity.startDate))} → ${escapeHtml(formatIsoDateEs(currentLicense.validity.endDate))}</dd></div>
        <div><dt>Estado</dt><dd>${escapeHtml(REGISTRATION_STATUS_LABELS[currentLicense.statusOn(isoDate)] || currentLicense.statusOn(isoDate))}</dd></div>
      </dl>` : '<p class="gm-muted">Sin licencia federativa vigente.</p>';

    const registrationRows = registrations.map((reg) => {
      const status = reg.statusOn(isoDate);
      let competitionName = reg.competitionId;
      try { competitionName = BM.getCompetitionDefinition(reg.competitionId).name; } catch (err) { /* competición desconocida: se muestra el id crudo */ }
      const club = getAllTeams().find((t) => t.id === reg.teamId);
      return `
        <tr>
          <td>${escapeHtml(competitionName)}</td>
          <td>${escapeHtml(club ? club.fullName : reg.teamId)}</td>
          <td>${escapeHtml(reg.seasonKey)}</td>
          <td>${escapeHtml(ACCESS_CATEGORY_FULL_LABELS[reg.accessCategory] || reg.accessCategory)}</td>
          <td>${escapeHtml(REGISTRATION_STATUS_LABELS[status] || status)}</td>
          <td>${classificationSnapshotBadgesHtml(reg.classificationSnapshot)}</td>
        </tr>`;
    }).join('');

    // Elegibilidad para el PRÓXIMO partido, con motivos (sección 13.2).
    let eligibilityHtml = '<p class="gm-muted">Jugador libre: no hay próximo partido que evaluar.</p>';
    if (team) {
      const { context, resolved } = resolveNextMatchRegistration(team);
      const classificationCache = getRegistrationClassificationCache();
      const evaluation = BM.EligibilityService.evaluateEligibility(player.id, team.id, context, {
        playerRegistry: state.playerRegistry,
        contractRegistry: state.contractRegistry,
        registrationRegistry: registry,
        medicalAvailability: getLineupMedicalAvailability(team),
        classificationCache,
      });
      const reasonsHtml = evaluation.reasons.length
        ? `<ul>${evaluation.reasons.map((r) => `<li>${escapeHtml(describeReasonCodes([r.code]))} <span class="gm-muted">(${escapeHtml(r.severity)})</span></li>`).join('')}</ul>`
        : '<p class="gm-muted">Sin motivos que señalar.</p>';
      eligibilityHtml = `
        <p><strong>${evaluation.eligible ? '✔ Elegible' : '✖ No elegible'}</strong> para el ámbito
          "${escapeHtml(resolved.registrationScopeId || context.competitionId)}" (${escapeHtml(context.seasonKey)}).</p>
        ${reasonsHtml}`;
    }

    return `
      <div class="gm-card">
        <h4>Licencia federativa</h4>
        ${simulatedRegistrationNoticeHtml()}
        ${licenseHtml}
      </div>

      <div class="gm-card">
        <h4>Inscripciones (${registrations.length})</h4>
        <div class="gm-table-scroll">
          <table class="gm-table contract-table">
            <thead><tr><th>Competición</th><th>Club</th><th>Temporada</th><th>Categoría</th><th>Estado</th><th>Clasificación</th></tr></thead>
            <tbody>${registrationRows || '<tr><td colspan="6" class="gm-muted">Sin inscripciones.</td></tr>'}</tbody>
          </table>
        </div>
        <p class="gm-muted">La clasificación de formación/no comunitario es CONTEXTUAL: puede variar entre competiciones y no es un atributo universal del jugador.</p>
      </div>

      <div class="gm-card">
        <h4>Elegibilidad para el próximo partido</h4>
        ${eligibilityHtml}
      </div>
      ${licenses.length > 1 ? `
      <div class="gm-card">
        <h4>Histórico de licencias</h4>
        <div class="gm-table-scroll">
          <table class="gm-table contract-table">
            <thead><tr><th>Temporada</th><th>Clase</th><th>Vigencia</th><th>Estado</th></tr></thead>
            <tbody>${licenses.map((lic) => `
              <tr>
                <td>${escapeHtml(lic.seasonKey)}</td>
                <td>${escapeHtml(LICENSE_CLASS_LABELS[lic.licenseClass] || lic.licenseClass)}</td>
                <td>${escapeHtml(formatIsoDateEs(lic.validity.startDate))} → ${escapeHtml(formatIsoDateEs(lic.validity.endDate))}</td>
                <td>${escapeHtml(REGISTRATION_STATUS_LABELS[lic.statusOn(isoDate)] || lic.statusOn(isoDate))}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>` : ''}
      <p class="gm-muted contract-scope-note">Inscribir, dar de baja, vincular, tantear o solicitar autorización internacional todavía no
        existen como acciones del juego (MARKET-1 / TRANSFER-1 / LOAN-1 / EUROPE-1): esta pestaña es de consulta.</p>`;
  }

  // --- Pantalla "Contratos" ----------------------------------------------
  function renderContractsScreen() {
    const container = byId('gm-contracts');
    const team = getUserTeam();
    if (!container) return;
    if (!team || !state.contractRegistry) { container.innerHTML = ''; return; }

    const seasonKey = buildCareerSeasonKey();
    const isoDate = currentGameIsoDate();
    const registry = state.contractRegistry;
    const { ContractService } = BM;

    const resolved = ContractService.resolveRulesForClub(team, {
      seasonKey, date: isoDate, operation: 'validateContract',
    });
    const payroll = ContractService.guaranteedPayrollForClub(registry, team.id, seasonKey);
    const variable = ContractService.potentialVariableCompensationForClub(registry, team.id, seasonKey);
    const benefits = ContractService.benefitsValueForClub(registry, team.id, seasonKey);
    const agentCosts = ContractService.agentCostsForClub(registry, team.id, seasonKey);
    const commitments = ContractService.futureCommitmentsForClub(registry, team.id, seasonKey);
    const integrity = registry.validateIntegrity({ playerRegistry: state.playerRegistry, teams: getAllTeams(), date: isoDate });

    const maxCommitment = commitments.reduce((acc, c) => Math.max(acc, c.guaranteed.amountMinor), 0) || 1;
    const commitmentRows = commitments.map((commitment) => `
      <tr>
        <th scope="row">${escapeHtml(commitment.seasonKey)}</th>
        <td>
          <span class="contract-bar" style="--contract-bar-width:${Math.round((commitment.guaranteed.amountMinor / maxCommitment) * 100)}%"
            aria-hidden="true"></span>
          ${formatMoneyMinor(commitment.guaranteed.amountMinor, 'EUR')}
        </td>
        <td>${commitment.guaranteed.contracts}</td>
        <td>${formatMoneyMinor(commitment.variableMax.amountMinor, 'EUR')}</td>
      </tr>`).join('');

    const contracts = registry.forClubInSeason(team.id, seasonKey)
      .map((contract) => {
        const player = state.playerRegistry.get(contract.playerId);
        const breakdown = contract.breakdownForSeason(seasonKey);
        const status = contract.statusOn(isoDate);
        const remaining = contract.remainingSeasonKeys(seasonKey).length;
        const clauseLabels = contract.clauses.map((clause) => {
          const definition = BM.CLAUSE_TYPE_DEFINITIONS[clause.type];
          return definition ? definition.label : clause.type;
        });
        return { contract, player, breakdown, status, remaining, clauseLabels };
      })
      .sort((a, b) => b.breakdown.guaranteedTotalMinor - a.breakdown.guaranteedTotalMinor);

    const rosterRows = contracts.map((row) => `
      <tr>
        <td data-label="Jugador">${row.player ? playerLinkHtml(row.player) : escapeHtml(row.contract.playerId)}
          <span class="gm-badge gm-badge--simulated" title="${escapeHtml(BM.ContractSeeder.SIMULATED_CONTRACT_WARNING)}">Simulado</span></td>
        <td data-label="Estado">${escapeHtml(CONTRACT_STATUS_LABELS[row.status])}</td>
        <td data-label="Inicio">${escapeHtml(formatIsoDateEs(row.contract.startDate))}</td>
        <td data-label="Final">${escapeHtml(formatIsoDateEs(row.contract.endDate))}</td>
        <td data-label="Temporadas restantes">${row.remaining}</td>
        <td data-label="Garantía">${row.contract.guaranteeType === 'fully-guaranteed' ? 'Total' : escapeHtml(row.contract.guaranteeType)}</td>
        <td data-label="Salario base">${formatMoneyMinor(row.breakdown.guaranteedBaseSalaryMinor, row.breakdown.currency)}</td>
        <td data-label="Imagen/especie">${formatMoneyMinor(row.breakdown.guaranteedImageRightsMinor + row.breakdown.guaranteedSalaryInKindMinor, row.breakdown.currency)}</td>
        <td data-label="Cuotas">${row.contract.paymentPolicy.installmentCount}</td>
        <td data-label="Cláusulas">${row.clauseLabels.length ? escapeHtml(row.clauseLabels.join(', ')) : '—'}</td>
      </tr>`).join('');

    const minimum = resolved.employment.effectiveMinimumAnnual;

    container.innerHTML = `
      <h2>Contratos — ${escapeHtml(team.fullName)}</h2>
      ${simulatedContractNoticeHtml()}

      <div class="gm-card contract-profile">
        <h3>Marco laboral aplicable</h3>
        <dl class="contract-facts">
          <div><dt>Jurisdicción laboral del empleador</dt>
            <dd>${escapeHtml(BM.ClubEmploymentContextCatalog.jurisdictionLabel(resolved.requestedContext.employerJurisdictionId))}</dd></div>
          <div><dt>Competición doméstica</dt><dd>${escapeHtml(BM.getCompetitionDefinition(resolved.requestedContext.domesticCompetitionId).name)}</dd></div>
          <div><dt>Perfil</dt><dd>${escapeHtml(resolved.profileId)} ${ruleResolutionBadgeHtml(resolved.resolutionMode)}</dd></div>
          <div><dt>Duración máxima</dt><dd>${resolved.employment.maxTermYears} años</dd></div>
          <div><dt>Salario mínimo aplicado</dt>
            <dd>${minimum ? `${formatMoneyMinor(minimum.amountMinor, minimum.currency)} · ${escapeHtml(minimum.ruleModuleId)}
              <span class="gm-badge gm-badge--${minimum.status === 'verified' ? 'verified' : 'provisional'}">${escapeHtml(RULE_STATUS_LABELS[minimum.status] || minimum.status)}</span>` : '—'}</dd></div>
          <div><dt>Cuotas por temporada</dt><dd>${resolved.employment.payments.defaultInstallmentCount}
            (rango ${resolved.employment.payments.installmentRange.min}-${resolved.employment.payments.installmentRange.max})</dd></div>
          <div><dt>Periodo de prueba máximo</dt><dd>${resolved.employment.probation.maxDays} días</dd></div>
        </dl>
        ${ruleModuleListHtml(resolved.ruleModuleIds, resolved.ruleVersions)}
        ${contractWarningsHtml(resolved.warnings, 'Advertencias normativas')}
        ${contractWarningsHtml(resolved.knownSourceInconsistencies, 'Inconsistencias conocidas de las fuentes')}
        ${contractWarningsHtml(state.contractBootstrapWarnings, 'Avisos de calibración del bootstrap')}
      </div>

      <div class="gm-card">
        <h3>Resumen de ${escapeHtml(seasonKey)}</h3>
        <div class="contract-summary">
          <div class="contract-summary__item"><span class="contract-summary__label">Nómina garantizada</span>
            <strong>${formatMoneyMinor(payroll.amountMinor, 'EUR')}</strong>
            <span class="gm-muted">${payroll.contracts} contratos</span></div>
          <div class="contract-summary__item"><span class="contract-summary__label">Variable potencial máximo</span>
            <strong>${formatMoneyMinor(variable.amountMinor, 'EUR')}</strong></div>
          <div class="contract-summary__item"><span class="contract-summary__label">Beneficios valorados</span>
            <strong>${formatMoneyMinor(benefits.amountMinor, 'EUR')}</strong></div>
          <div class="contract-summary__item"><span class="contract-summary__label">Costes de agente</span>
            <strong>${formatMoneyMinor(agentCosts.amountMinor, 'EUR')}</strong></div>
        </div>
        <p class="gm-muted">Compromisos contractuales, no un presupuesto disponible: el juego todavía no simula tesorería, impuestos ni ingresos reales.</p>
      </div>

      <div class="gm-card">
        <h3>Compromisos por temporada</h3>
        <div class="gm-table-scroll">
          <table class="gm-table contract-table">
            <thead><tr><th>Temporada</th><th>Nómina garantizada</th><th>Contratos</th><th>Variable máx.</th></tr></thead>
            <tbody>${commitmentRows}</tbody>
          </table>
        </div>
      </div>

      <div class="gm-card">
        <h3>Plantilla contractual (${contracts.length})</h3>
        <div class="gm-table-scroll">
          <table class="gm-table contract-table contract-table--roster">
            <thead><tr>
              <th>Jugador</th><th>Estado</th><th>Inicio</th><th>Final</th><th>Temp. rest.</th>
              <th>Garantía</th><th>Salario base</th><th>Imagen/especie</th><th>Cuotas</th><th>Cláusulas</th>
            </tr></thead>
            <tbody>${rosterRows}</tbody>
          </table>
        </div>
      </div>

      ${integrity.valid ? '' : `
      <div class="gm-card contract-integrity">
        <h3>Alertas de integridad contractual</h3>
        <ul>${integrity.errors.slice(0, 20).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
      </div>`}

      <p class="gm-muted contract-scope-note">Renovar, fichar, liberar, ejecutar una cláusula, tantear o ceder todavía no
        existen como acciones del juego (MARKET-1 / TRANSFER-1 / LOAN-1): esta pantalla es de consulta.</p>`;
  }

  // ---------------------------------------------------------------------
  // Pantalla "Inscripciones" (REG-1, DESIGN.md 9.18, sección 13.1 del
  // prompt) — SOLO LECTURA: sin botones de alta/baja/suspensión/
  // vinculación/fichaje/renovación/cesión/tanteo/transfer.
  // ---------------------------------------------------------------------
  function renderRegistrationsScreen() {
    const container = byId('gm-registrations');
    const team = getUserTeam();
    if (!container) return;
    if (!team || !state.registrationRegistry) { container.innerHTML = ''; return; }

    const registry = state.registrationRegistry;
    const { context, resolved } = resolveNextMatchRegistration(team);
    const isoDate = currentGameIsoDate();
    const seasonKey = buildCareerSeasonKey();
    const reg = resolved.registration || {};

    const cumulativeCount = reg.cumulativeRegistrationCap
      ? registry.cumulativeCountForClub(team.id, resolved.registrationScopeId, seasonKey) : null;

    const quotaBandsHtml = (reg.quotaBands || []).map((band) => `
      <li>${band.rosterMin}-${band.rosterMax} jugadores → mínimo ${band.formationMinimum} de formación</li>`).join('') || '<li class="gm-muted">Sin bandas declaradas.</li>';

    const documentReqHtml = (reg.documentRequirements || []).map((code) => `<li>${escapeHtml(code)}</li>`).join('')
      || '<li class="gm-muted">Sin documentos declarados.</li>';

    const linkedRules = reg.linkedPlayerRules;
    const linkAgreements = registry.linkAgreementsForClub(team.id);
    const linkAgreementsHtml = linkAgreements.length ? `
      <ul class="contract-modules">${linkAgreements.map((agreement) => {
        const other = agreement.lowerClubId === team.id ? agreement.upperClubId : agreement.lowerClubId;
        const otherTeam = getAllTeams().find((t) => t.id === other);
        const direction = agreement.lowerClubId === team.id ? 'club inferior' : 'club superior';
        return `<li>Acuerdo con ${escapeHtml(otherTeam ? otherTeam.fullName : other)} (${escapeHtml(direction)}) —
          lowerToUpper: ${agreement.lists.lowerToUpper.length}/${agreement.limits.lowerToUpper},
          upperToLower: ${agreement.lists.upperToLower.length}/${agreement.limits.upperToLower}
          <span class="gm-badge gm-badge--${agreement.status === 'formalized' ? 'verified' : 'provisional'}">${escapeHtml(agreement.status)}</span></li>`;
      }).join('')}</ul>` : '<p class="gm-muted">Sin acuerdo activo.</p>';

    // Ficha por jugador (afiliación+contrato, licencia, inscripción,
    // formación/no-comunitario, procedencia, razones) — sección 13.1.
    const classificationCache = getRegistrationClassificationCache();
    const medicalAvailability = getLineupMedicalAvailability(team);
    const playerRowsHtml = [...team.roster]
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'))
      .map((player) => {
        const license = registry.currentLicenseForPlayer(player.id, isoDate);
        // `registrationForScopeSeason` (no `currentRegistration`, solo
        // activas): un jugador suspendido/desactivado debe mostrar su
        // estado REAL en esta pantalla, nunca confundirse con "sin
        // inscripción" — mismo motivo que EligibilityService.js.
        const registration = registry.registrationForScopeSeason(player.id, resolved.registrationScopeId, seasonKey);
        const contract = state.contractRegistry ? state.contractRegistry.currentForPlayer(player.id, isoDate) : null;
        const evaluation = BM.EligibilityService.evaluateEligibility(player.id, team.id, context, {
          playerRegistry: state.playerRegistry,
          contractRegistry: state.contractRegistry,
          registrationRegistry: registry,
          medicalAvailability,
          classificationCache,
        });
        const provenance = license ? (license.provenance.isReal ? 'Real' : 'Simulado') : 'Desconocido';
        const reasonsText = evaluation.reasons.filter((r) => r.severity === 'blocking').map((r) => r.code);
        return `
          <tr>
            <td data-label="Jugador">${playerLinkHtml(player)}</td>
            <td data-label="Contrato">${contract ? '✔' : '✖'}</td>
            <td data-label="Licencia">${license ? escapeHtml(REGISTRATION_STATUS_LABELS[license.statusOn(isoDate)] || license.statusOn(isoDate)) : '—'}</td>
            <td data-label="Inscripción">${registration ? escapeHtml(ACCESS_CATEGORY_FULL_LABELS[registration.accessCategory]) : '—'}</td>
            <td data-label="Estado">${registration ? escapeHtml(REGISTRATION_STATUS_LABELS[registration.statusOn(isoDate)] || registration.statusOn(isoDate)) : '—'}</td>
            <td data-label="Clasificación">${classificationSnapshotBadgesHtml(evaluation.classification)}</td>
            <td data-label="Procedencia"><span class="gm-badge gm-badge--${provenance === 'Simulado' ? 'simulated' : 'verified'}">${escapeHtml(provenance)}</span></td>
            <td data-label="Elegible">${evaluation.eligible ? '✔' : `✖ ${escapeHtml(describeReasonCodes(reasonsText))}`}</td>
          </tr>`;
      }).join('');

    // Cobertura verificada/simulada/desconocida (sección 13.1).
    const coverage = team.roster.reduce((acc, player) => {
      const license = registry.currentLicenseForPlayer(player.id, isoDate);
      const key = !license ? 'unknown' : (license.provenance.isReal ? 'verified' : 'simulated');
      acc[key] += 1;
      return acc;
    }, { verified: 0, simulated: 0, unknown: 0 });

    const integrity = registry.validateIntegrity({
      playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, teams: getAllTeams(), date: isoDate,
    });

    container.innerHTML = `
      <h2>Inscripciones — ${escapeHtml(team.fullName)}</h2>
      ${simulatedRegistrationNoticeHtml()}

      <div class="gm-card">
        <h3>Ámbito y normativa aplicable</h3>
        <dl class="contract-facts">
          <div><dt>Competición</dt><dd>${escapeHtml(BM.getCompetitionDefinition(context.competitionId).name)}</dd></div>
          <div><dt>Ámbito de inscripción</dt><dd>${escapeHtml(resolved.registrationScopeId || '—')}</dd></div>
          <div><dt>Temporada</dt><dd>${escapeHtml(seasonKey)}</dd></div>
          <div><dt>Estado normativo</dt><dd>${ruleResolutionBadgeHtml(resolved.resolutionMode)}</dd></div>
          <div><dt>Rango de plantilla activa</dt><dd>${reg.activeRosterRange ? `${reg.activeRosterRange.min}-${reg.activeRosterRange.max}` : '—'}</dd></div>
          <div><dt>Rango de acta</dt><dd>${reg.matchActRange ? `${reg.matchActRange.min}-${reg.matchActRange.max}` : '—'}</dd></div>
          <div><dt>Máximo no comunitarios</dt><dd>${reg.nonCommunityCap ? reg.nonCommunityCap.max : '—'}</dd></div>
          <div><dt>Regla en pista</dt><dd>${reg.onCourtConstraints ? `Mínimo ${reg.onCourtConstraints.minFormationOnCourtAtAllTimes} de formación en pista` : 'No aplica'}</dd></div>
        </dl>
        <h4>Bandas de cupo de formación</h4>
        <ul>${quotaBandsHtml}</ul>
        <h4>Documentos exigidos</h4>
        <ul>${documentReqHtml}</ul>
        ${ruleModuleListHtml([resolved.bundleId], { [resolved.bundleId]: resolved.version })}
        ${contractWarningsHtml(resolved.warnings, 'Advertencias normativas')}
        ${contractWarningsHtml(resolved.knownSourceInconsistencies, 'Inconsistencias conocidas de las fuentes')}
      </div>

      <div class="gm-card">
        <h3>Máximo acumulado de la temporada</h3>
        ${reg.cumulativeRegistrationCap ? `
          <p><strong>${cumulativeCount}</strong> / ${reg.cumulativeRegistrationCap.max} altas computadas.</p>
          <p class="gm-muted">No computan: ${(reg.cumulativeRegistrationCap.nonCountingCategories || []).map((c) => escapeHtml(ACCESS_CATEGORY_FULL_LABELS[c] || c)).join(', ') || 'ninguna categoría exenta declarada'}.</p>
        ` : '<p class="gm-muted">Sin máximo acumulado declarado para este ámbito.</p>'}
      </div>

      <div class="gm-card">
        <h3>Propios y vinculados</h3>
        <h4>Acuerdos de vinculación</h4>
        ${linkAgreementsHtml}
        ${linkedRules ? `<p class="gm-muted">Límites declarados: ${linkedRules.maxLinkedSeniorSubU22FromLowerClub || 0} sub-22 senior del club inferior
          ${linkedRules.maxLinkedJuniorOrCadeteFromUpperClub ? `· ${linkedRules.maxLinkedJuniorOrCadeteFromUpperClub} junior/cadete del club superior` : ''}.</p>` : ''}
      </div>

      <div class="gm-card">
        <h3>Jugadores (${team.roster.length})</h3>
        <div class="gm-table-scroll">
          <table class="gm-table contract-table">
            <thead><tr>
              <th>Jugador</th><th>Contrato</th><th>Licencia</th><th>Inscripción</th><th>Estado</th>
              <th>Clasificación</th><th>Procedencia</th><th>Elegible próximo partido</th>
            </tr></thead>
            <tbody>${playerRowsHtml}</tbody>
          </table>
        </div>
      </div>

      <div class="gm-card">
        <h3>Cobertura de datos</h3>
        <p>Verificados: ${coverage.verified} · Simulados: ${coverage.simulated} · Desconocidos: ${coverage.unknown}</p>
        <p class="gm-muted">Los datos regulatorios simulados nunca se presentan como reales — ver aviso al inicio de esta pantalla.</p>
      </div>

      ${integrity.valid ? '' : `
      <div class="gm-card contract-integrity">
        <h3>Alertas de integridad</h3>
        <ul>${integrity.errors.slice(0, 20).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
      </div>`}

      <p class="gm-muted contract-scope-note">Esta pantalla sigue siendo de SOLO CONSULTA: alta, baja, suspensión, vinculación,
        fichaje, renovación, cesión y transfer no existen aquí como acciones. Mercado (MARKET-1) ya permite tramitar el
        procedimiento de derecho preferente y alcanzar un Acuerdo en Principio, pero eso no concede licencia/inscripción por
        sí solo — la formalización sigue siendo TRANSFER-1 / LOAN-1 / EUROPE-1.</p>`;
  }

  // ---------------------------------------------------------------------
  // MARKET-1 (DESIGN.md 9.19, sección 16 del prompt) — pantalla Mercado.
  // Capa de presentación pura sobre MarketService/RightOfFirstRefusalService
  // — ninguna regla de mercado vive aquí. Nunca "Fichar" como CTA fijo: el
  // botón cambia según disponibilidad/estado real (sección 16.2).
  // ---------------------------------------------------------------------
  const MARKET_TABS = [
    { id: 'search', label: 'Buscar jugadores' },
    { id: 'watchlist', label: 'Seguimiento' },
    { id: 'negotiations', label: 'Negociaciones' },
    { id: 'agents', label: 'Agentes' },
    { id: 'rights', label: 'Derechos' },
  ];

  const MARKET_AVAILABILITY_LABELS = {
    free: 'Libre sin derechos conocidos',
    'free-subject-to-rights': 'Libre — sujeto a derecho preferente',
    'contract-expiring-soon': 'Contrato próximo a expirar',
    'under-contract': 'Bajo contrato',
    'agreement-in-principle': 'Acuerdo en principio con otro club',
    'not-found': 'No encontrado',
  };

  function marketSimulatedBadgeHtml(text) {
    return `<span class="gm-badge gm-badge--simulated" title="${escapeHtml(text || 'Dato simulado para esta partida; no es un dato real.')}">Simulado</span>`;
  }

  // Contexto normativo de mercado de la competición del club del usuario —
  // recalculado en cada render (nunca cacheado en `state`, sección 7.1).
  function buildMarketContextForTeam(team) {
    const seasonKey = buildCareerSeasonKey();
    const isoDate = currentGameIsoDate();
    const competitionId = BM.competitionIdFromLegacyDivision(team.division);
    return BM.MarketService.resolveMarketContext({
      domesticCompetitionId: competitionId, seasonKey, date: isoDate, operation: 'market-screen',
    });
  }

  function renderMarketScreen() {
    const container = byId('gm-market');
    const team = getUserTeam();
    if (!container) return;
    if (!team || !state.marketRegistry || !state.agentRegistry) { container.innerHTML = ''; return; }
    const marketContext = buildMarketContextForTeam(team);
    const rightsTabDisabled = !marketContext.capabilities.has('supportsRightOfFirstRefusal');
    let activeTab = container.dataset.activeTab || 'search';
    // Cambiar de club puede cambiar de competición (p. ej. ACB -> Primera
    // FEB): una pestaña "Derechos" activa que ya no aplica a la
    // competición actual nunca debe quedar "atascada" activa solo porque
    // el dataset del contenedor la conservaba de la club anterior.
    if (activeTab === 'rights' && rightsTabDisabled) activeTab = 'search';
    container.dataset.activeTab = activeTab;

    let body = '';
    if (activeTab === 'search') body = renderMarketSearchTab(team, marketContext);
    else if (activeTab === 'watchlist') body = renderMarketWatchlistTab(team);
    else if (activeTab === 'negotiations') body = renderMarketNegotiationsTab(team, marketContext);
    else if (activeTab === 'agents') body = renderMarketAgentsTab();
    else if (activeTab === 'rights') body = renderMarketRightsTab(team, marketContext);

    container.innerHTML = `
      <h2>Mercado — ${escapeHtml(team.fullName)}</h2>
      ${contractWarningsHtml(state.marketBootstrapWarnings, 'Avisos de bootstrap de mercado')}
      <div class="tabs">
        ${MARKET_TABS.map((t) => (
    (t.id === 'rights' && rightsTabDisabled)
      ? '' // sección 16.1: la pestaña Derechos solo aparece cuando la competición lo justifica, nunca por división visible
      : `<button class="tabs__btn ${t.id === activeTab ? 'is-active' : ''}" data-tab="${t.id}" type="button">${t.label}</button>`
  )).join('')}
      </div>
      <div class="tabs__body">${body}</div>
    `;

    container.querySelectorAll('.tabs__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.dataset.activeTab = btn.dataset.tab;
        renderMarketScreen();
      });
    });

    wireMarketScreenActions(container, team, marketContext);
  }

  function renderMarketSearchTab(team, marketContext) {
    const filterState = state.marketSearchFilter || { text: '', position: '', status: '' };
    state.marketSearchFilter = filterState;
    const isoDate = currentGameIsoDate();

    const rowsData = state.playerRegistry.all()
      .filter((p) => !filterState.text || p.fullName.toLowerCase().includes(filterState.text.toLowerCase()))
      .filter((p) => !filterState.position || p.nominalPosition === filterState.position)
      .map((player) => ({
        player,
        availability: BM.MarketService.resolveMarketAvailability({
          playerId: player.id, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, marketRegistry: state.marketRegistry, date: isoDate,
        }),
      }))
      .filter((row) => !filterState.status || row.availability.status === filterState.status)
      .sort((a, b) => a.player.fullName.localeCompare(b.player.fullName, 'es'));

    const shown = rowsData.slice(0, 200);
    const rows = shown.map(({ player, availability }) => {
      const isFictional = BM.MarketSeeder && player.dataSource === BM.MarketSeeder.SIMULATED_FREE_AGENT_DATA_SOURCE;
      const watched = state.marketRegistry.isWatched(team.id, player.id);
      const mandate = state.agentRegistry.actingMandateForTransaction({ playerId: player.id, date: isoDate });
      const existingThread = state.marketRegistry.threadsForClub(team.id).find((t) => t.playerId === player.id);
      const clubName = player.teamId ? (getAllTeams().find((t) => t.id === player.teamId) || { fullName: player.teamId }).fullName : 'Sin club';
      const isOwnPlayer = team.roster.some((p) => p.id === player.id);
      const canInquire = !existingThread && !isOwnPlayer && availability.status !== 'agreement-in-principle' && availability.status !== 'not-found';
      return `
        <tr>
          <td data-label="Jugador">${playerLinkHtml(player)} ${isFictional ? marketSimulatedBadgeHtml('Jugador ficticio generado para el mercado de esta partida; no es un dato real.') : ''}</td>
          <td data-label="Posición">${escapeHtml(player.nominalPosition)}</td>
          <td data-label="Club">${escapeHtml(clubName)}</td>
          <td data-label="Situación">${escapeHtml(MARKET_AVAILABILITY_LABELS[availability.status] || availability.status)}</td>
          <td data-label="Representación">${mandate ? `${escapeHtml(state.agentRegistry.getAgent(mandate.agentId).displayName)} ${marketSimulatedBadgeHtml()}` : 'Autorrepresentado'}</td>
          <td data-label="Acción">
            <button type="button" class="gm-btn gm-market-watch-btn" data-player-id="${player.id}">${watched ? 'Dejar de seguir' : 'Seguir'}</button>
            ${existingThread ? '<span class="gm-muted">Ya en negociación</span>' : (canInquire ? `<button type="button" class="gm-btn gm-btn--primary gm-market-inquiry-btn" data-player-id="${player.id}">Consultar</button>` : '')}
          </td>
        </tr>`;
    }).join('');

    return `
      <div class="gm-card">
        <form id="gm-market-search-form" class="market-search-form">
          <label>Nombre <input type="text" name="text" value="${escapeHtml(filterState.text)}"></label>
          <label>Posición <select name="position">
            <option value="">Todas</option>
            ${['Base', 'Escolta', 'Alero', 'Ala-pívot', 'Pívot'].map((p) => `<option value="${p}" ${filterState.position === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select></label>
          <label>Situación <select name="status">
            <option value="">Todas</option>
            ${Object.keys(MARKET_AVAILABILITY_LABELS).filter((s) => s !== 'not-found').map((s) => `<option value="${s}" ${filterState.status === s ? 'selected' : ''}>${escapeHtml(MARKET_AVAILABILITY_LABELS[s])}</option>`).join('')}
          </select></label>
          <button type="submit" class="gm-btn">Filtrar</button>
        </form>
      </div>
      <div class="gm-card">
        <div class="gm-table-wrapper">
          <table class="gm-table">
            <thead><tr><th>Jugador</th><th>Posición</th><th>Club</th><th>Situación</th><th>Representación</th><th>Acción</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="gm-muted">Sin resultados.</td></tr>'}</tbody>
          </table>
        </div>
        <p class="gm-muted">${shown.length} de ${rowsData.length} jugadores (Player Registry mundial completo — libres, con contrato y con derechos).</p>
        ${!marketContext.market.domesticProcedure ? '<p class="gm-muted">Esta competición no tiene procedimiento doméstico de derecho preferente codificado — ningún jugador aparecerá "sujeto a derecho preferente" aquí.</p>' : ''}
      </div>`;
  }

  function renderMarketWatchlistTab(team) {
    const isoDate = currentGameIsoDate();
    const watchedIds = state.marketRegistry.watchlistForClub(team.id);
    const rows = watchedIds.map((playerId) => {
      const player = state.playerRegistry.get(playerId);
      if (!player) return '';
      const availability = BM.MarketService.resolveMarketAvailability({
        playerId, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, marketRegistry: state.marketRegistry, date: isoDate,
      });
      return `
        <tr>
          <td data-label="Jugador">${playerLinkHtml(player)}</td>
          <td data-label="Situación">${escapeHtml(MARKET_AVAILABILITY_LABELS[availability.status] || availability.status)}</td>
          <td data-label="Acción"><button type="button" class="gm-btn gm-market-watch-btn" data-player-id="${playerId}">Dejar de seguir</button></td>
        </tr>`;
    }).join('');
    return `
      <div class="gm-card">
        <div class="gm-table-wrapper">
          <table class="gm-table">
            <thead><tr><th>Jugador</th><th>Situación</th><th>Acción</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" class="gm-muted">Sin jugadores en seguimiento — añade alguno desde "Buscar jugadores".</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  // Construye un borrador CONTRACT-1 válido a partir de los campos
  // mínimos que expone el constructor de oferta (sección 16.5) — reutiliza
  // ContractService.resolveRulesForClub para calendario/cuotas reales,
  // nunca inventa un mínimo/duración fuera de lo resuelto.
  function buildMarketOfferDraft(team, player, formData, isoDate) {
    const seasonKey = buildCareerSeasonKey();
    const resolved = BM.ContractService.resolveRulesForClub(team, { seasonKey, date: isoDate, operation: 'validateMarketOffer' });
    const employment = resolved.employment;
    const currency = employment.allowedCurrencies[0] || 'EUR';
    const seasonsCount = Math.max(1, Math.min(employment.maxTermYears || 5, formData.seasons));
    const seasonKeys = [];
    let cursorYear = BM.LocalDate.seasonStartYear(seasonKey);
    for (let i = 0; i < seasonsCount; i += 1) { seasonKeys.push(BM.LocalDate.seasonKeyFromStartYear(cursorYear + i)); }
    // Una firma de mercado casi nunca cae en el primer día de temporada:
    // Contract.js rechaza toda firma retroactiva (signedDate posterior a
    // startDate), así que la vigencia arranca en la fecha de firma real
    // cuando esta cae dentro de (o después de) la primera temporada
    // cubierta, nunca retrocedida al 1 de julio de esa temporada.
    const firstSeasonStart = BM.LocalDate.seasonWindow(seasonKeys[0]).startDate;
    const startDate = BM.LocalDate.isAfter(isoDate, firstSeasonStart) ? isoDate : firstSeasonStart;
    const endDate = BM.LocalDate.seasonWindow(seasonKeys[seasonKeys.length - 1]).endDate;
    const installmentCount = employment.payments.defaultInstallmentCount;
    const frequency = employment.payments.frequency || 'monthly';
    const monthStep = frequency === 'quarterly' ? 3 : 1;
    const schedule = [];
    seasonKeys.forEach((sk, index) => {
      const window = BM.LocalDate.seasonWindow(sk);
      // La primera temporada cubierta ancla su primera cuota en la vigencia
      // real del contrato (startDate ya corregido arriba), nunca en el
      // inicio natural de la temporada si la firma es posterior — de lo
      // contrario la cuota vencería antes de startDate y Contract.js la
      // rechazaría como fuera de vigencia.
      const anchorStartDate = index === 0 ? startDate : window.startDate;
      // El número de cuotas por defecto asume una temporada completa desde
      // julio: si la firma cae mid-season, ese mismo número de cuotas
      // mensuales/trimestrales desbordaría el fin de ESA temporada (fuera
      // de vigencia). Se acota al número de periodos que realmente caben
      // entre la firma y el fin de esa temporada — nunca se toca
      // `defaultInstallmentCount` en sí (CONTRACT-1), solo su aplicación
      // aquí para la temporada parcial.
      const [anchorYear, anchorMonth] = anchorStartDate.split('-').map(Number);
      const [endYear, endMonth] = window.endDate.split('-').map(Number);
      const periodsAvailable = Math.floor(((endYear - anchorYear) * 12 + (endMonth - anchorMonth)) / monthStep) + 1;
      const seasonInstallmentCount = Math.max(1, Math.min(installmentCount, periodsAvailable));
      BM.buildPaymentSchedule({
        totalMinor: formData.salaryMinor, installmentCount: seasonInstallmentCount, firstDueDate: BM.LocalDate.endOfMonth(anchorStartDate), frequency, currency, seasonKey: sk,
      }).forEach((installment) => schedule.push(installment));
    });
    return {
      playerId: player.id,
      clubId: team.id,
      signedDate: isoDate,
      startDate,
      endDate,
      coveredSeasonKeys: seasonKeys,
      guaranteeType: formData.guaranteeType || 'fully-guaranteed',
      compensation: {
        currency,
        declaredBasis: 'gross',
        seasons: seasonKeys.map((sk) => ({
          seasonKey: sk, guaranteedBaseSalaryMinor: formData.salaryMinor, guaranteedImageRightsMinor: 0, guaranteedSalaryInKindMinor: 0, signingBonusMinor: 0, variableBonuses: [], nonSalaryBenefits: [], agentCosts: [],
        })),
      },
      paymentPolicy: {
        installmentCount, frequency: employment.payments.frequency || 'monthly', scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'], schedule,
      },
      clauses: [],
      declaredDocuments: ['written-contract', ...employment.requiredDocuments],
      provenance: { dataSource: 'simulated-market-offer-v1', isReal: false },
    };
  }

  function renderMarketOfferFormHtml(threadId, mode) {
    return `
      <form class="gm-market-offer-form" data-thread-id="${threadId}" data-mode="${mode}">
        <label>Salario garantizado/temporada (€) <input type="number" name="salaryEuros" min="0" step="1000" required></label>
        <label>Temporadas <input type="number" name="seasons" min="1" max="5" value="1" required></label>
        <label>Rol prometido <select name="role">
          <option value="core">Core</option><option value="star">Star</option><option value="rotation">Rotation</option>
          <option value="development">Development</option><option value="depth">Depth</option>
        </select></label>
        <label>Garantía <select name="guaranteeType">
          <option value="fully-guaranteed">Totalmente garantizado</option>
          <option value="partially-guaranteed">Parcialmente garantizado</option>
          <option value="non-guaranteed">No garantizado</option>
        </select></label>
        <button type="submit" class="gm-btn gm-btn--primary">${mode === 'counter' ? 'Enviar contraoferta' : 'Enviar oferta'}</button>
        <div class="gm-market-offer-error gm-muted" role="alert"></div>
      </form>`;
  }

  function renderMarketNegotiationsTab(team, marketContext) {
    const isoDate = currentGameIsoDate();
    const threads = state.marketRegistry.threadsForClub(team.id);
    if (!threads.length) {
      return '<div class="gm-card"><p class="gm-muted">Sin negociaciones abiertas — inicia una consulta desde "Buscar jugadores".</p></div>';
    }
    const cards = threads.map((thread) => {
      const player = state.playerRegistry.get(thread.playerId);
      const status = thread.statusOn(isoDate);
      const offers = state.marketRegistry.offersForThread(thread.id);
      const liveOffer = state.marketRegistry.liveOfferForThread(thread.id, isoDate);
      const agreement = thread.agreementId ? state.marketRegistry.getAgreement(thread.agreementId) : null;

      let actionsHtml = '';
      if (status === 'thread-closed') {
        actionsHtml = '<p class="gm-muted">Hilo cerrado.</p>';
      } else if (agreement) {
        actionsHtml = `<p><strong>Acuerdo en principio alcanzado.</strong> La formalización del contrato, el movimiento de plantilla, la posible
          compensación/traspaso y la inscripción se ejecutarán en TRANSFER-1.</p>`;
      } else if (liveOffer && liveOffer.offeredBy === 'player-side') {
        actionsHtml = `
          <p>Contraoferta del jugador — vence ${escapeHtml(formatIsoDateEs(liveOffer.expiresAt))}.</p>
          <button type="button" class="gm-btn gm-btn--primary gm-market-accept-btn" data-thread-id="${thread.id}" data-offer-id="${liveOffer.id}">Aceptar</button>
          ${renderMarketOfferFormHtml(thread.id, 'counter')}`;
      } else if (liveOffer && liveOffer.offeredBy === 'club') {
        actionsHtml = `
          <p>Oferta enviada, esperando respuesta — vence ${escapeHtml(formatIsoDateEs(liveOffer.expiresAt))}.</p>
          <button type="button" class="gm-btn gm-market-withdraw-btn" data-thread-id="${thread.id}" data-offer-id="${liveOffer.id}">Retirar oferta</button>`;
      } else if (status === 'interest-confirmed' && !offers.length) {
        actionsHtml = renderMarketOfferFormHtml(thread.id, 'initial');
      } else if (status === 'interest-declined' || status === 'contact-permission-denied') {
        actionsHtml = '<p class="gm-muted">El jugador/club no ha mostrado interés en continuar.</p>';
      } else {
        actionsHtml = '<p class="gm-muted">Esperando respuesta.</p>';
      }

      const offersHtml = offers.length ? `
        <details class="market-offer-history">
          <summary>Historial de ofertas (${offers.length})</summary>
          <ul>${offers.map((o) => {
    const summary = BM.NegotiationService.summarizeOfferDraft(o.contractDraft);
    return `<li>v${o.version} · ${o.offeredBy === 'club' ? 'Club' : 'Jugador'} · ${formatMoneyMinor(summary.guaranteedTotalMinor, summary.currency || 'EUR')} total garantizado ·
      ${escapeHtml(o.statusOn(isoDate))}</li>`;
  }).join('')}</ul>
        </details>` : '';

      return `
        <div class="gm-card" data-negotiation-thread="${thread.id}">
          <h3>${player ? playerLinkHtml(player) : escapeHtml(thread.playerId)}</h3>
          <p class="gm-muted">Estado del hilo: ${escapeHtml(status)}</p>
          ${offersHtml}
          ${actionsHtml}
        </div>`;
    }).join('');
    return cards;
  }

  function renderMarketAgentsTab() {
    const isoDate = currentGameIsoDate();
    const agents = state.agentRegistry.allAgents();
    const rows = agents.map((agent) => {
      const mandates = state.agentRegistry.mandatesForAgent(agent.id).filter((m) => m.isActiveOn(isoDate));
      const credentialStatus = agent.credentialStatusOn('fiba-agent-license', isoDate);
      return `
        <tr>
          <td data-label="Agente">${escapeHtml(agent.displayName)} ${marketSimulatedBadgeHtml('Agente ficticio generado para esta partida; no es un dato real.')}</td>
          <td data-label="Agencia">${escapeHtml(agent.agencyName || '—')}</td>
          <td data-label="Licencia FIBA (simulada)">${escapeHtml(credentialStatus)}</td>
          <td data-label="Representados activos">${mandates.length}</td>
        </tr>`;
    }).join('');
    return `
      <div class="gm-card">
        <p class="gm-muted">Directorio SIMULADO — no es el directorio oficial FIBA. Referencia normativa:
          <a href="https://about.fiba.basketball/en/search/agents" target="_blank" rel="noopener">about.fiba.basketball/en/search/agents</a>.</p>
        <div class="gm-table-wrapper">
          <table class="gm-table">
            <thead><tr><th>Agente</th><th>Agencia</th><th>Licencia FIBA (simulada)</th><th>Representados activos</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" class="gm-muted">Sin agentes registrados.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderMarketRightsTab(team, marketContext) {
    if (!marketContext.capabilities.has('supportsRightOfFirstRefusal')) {
      return '<div class="gm-card"><p class="gm-muted">Esta competición no tiene procedimiento doméstico de derecho preferente codificado.</p></div>';
    }
    const cases = state.marketRegistry.rightsCasesForClub(team.id);
    const isoDate = currentGameIsoDate();
    if (!cases.length) {
      return `<div class="gm-card"><p class="gm-muted">Sin casos de derecho preferente abiertos para este club por ahora.</p>
        ${contractWarningsHtml(marketContext.knownSourceInconsistencies, 'Continuidad e inconsistencias conocidas de la fuente')}</div>`;
    }
    const cards = cases.map((rightsCase) => {
      const player = state.playerRegistry.get(rightsCase.playerId);
      const status = rightsCase.statusOn(isoDate);
      const isOrigin = rightsCase.originClubId === team.id;
      let decisionHtml = '';
      if (isOrigin && status === 'matching-window-open') {
        decisionHtml = `
          <p><strong>Decisión pendiente</strong> — plazo improrrogable: ${escapeHtml(formatIsoDateEs(rightsCase.deadlines.matchingWindow.closes))}.</p>
          <button type="button" class="gm-btn gm-btn--primary gm-rights-match-btn" data-case-id="${rightsCase.id}">Igualar</button>
          <button type="button" class="gm-btn gm-rights-waive-btn" data-case-id="${rightsCase.id}">No igualar</button>`;
      }
      return `
        <div class="gm-card">
          <h3>${player ? playerLinkHtml(player) : escapeHtml(rightsCase.playerId)} — ${escapeHtml(rightsCase.procedureType)}</h3>
          <p class="gm-muted">Estado: ${escapeHtml(status)} · Origen: ${escapeHtml(rightsCase.originClubId)} · Último partido oficial: ${escapeHtml(formatIsoDateEs(rightsCase.lastOfficialMatchDate))}</p>
          ${rightsCase.offerSheet ? `<p>Documento de oferta de "${escapeHtml(rightsCase.offerSheet.filedByClubId)}" trasladado el ${escapeHtml(formatIsoDateEs(rightsCase.offerSheet.forwardedAt))}.</p>` : ''}
          ${decisionHtml}
          <p class="gm-muted contract-scope-note">Procedimiento ACB con continuidad PROVISIONAL (el convenio formal expiró
            2022-06-30; ACB seguía aplicándolo operativamente en 2026) — ver fuentes en DESIGN.md 9.19.</p>
        </div>`;
    }).join('');
    return cards;
  }

  // ---------------------------------------------------------------------
  // Acciones de la pantalla Mercado — todas pasan por MarketService, nunca
  // mutan Team/Player/Contract/Registration directamente.
  // ---------------------------------------------------------------------
  function wireMarketScreenActions(container, team, marketContext) {
    const isoDate = currentGameIsoDate();
    const careerSeed = buildMarketCareerSeed();

    const searchForm = byId('gm-market-search-form');
    if (searchForm) {
      searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(searchForm);
        state.marketSearchFilter = { text: data.get('text') || '', position: data.get('position') || '', status: data.get('status') || '' };
        renderMarketScreen();
      });
    }

    container.querySelectorAll('.gm-market-watch-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.playerId;
        if (state.marketRegistry.isWatched(team.id, playerId)) BM.MarketService.removeWatch(state.marketRegistry, team.id, playerId);
        else BM.MarketService.addWatch(state.marketRegistry, team.id, playerId);
        renderMarketScreen();
      });
    });

    container.querySelectorAll('.gm-market-inquiry-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.playerId;
        BM.MarketService.openInquiry({
          marketRegistry: state.marketRegistry, agentRegistry: state.agentRegistry, playerId, actingClubId: team.id,
          prospectiveCompetitionIds: [BM.competitionIdFromLegacyDivision(team.division)], date: isoDate, marketContext, careerSeed,
        });
        container.dataset.activeTab = 'negotiations';
        renderMarketScreen();
      });
    });

    container.querySelectorAll('.gm-market-offer-form').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const threadId = form.dataset.threadId;
        const thread = state.marketRegistry.requireThread(threadId);
        const player = state.playerRegistry.get(thread.playerId);
        const errorEl = form.querySelector('.gm-market-offer-error');
        const data = new FormData(form);
        const salaryEuros = Number(data.get('salaryEuros'));
        const seasons = Number(data.get('seasons'));
        if (!salaryEuros || salaryEuros <= 0 || !seasons || seasons < 1) {
          errorEl.textContent = 'Introduce un salario y unas temporadas válidas.';
          return;
        }
        const formData = {
          salaryMinor: Math.round(salaryEuros * 100), seasons, role: data.get('role'), guaranteeType: data.get('guaranteeType'),
        };
        const draft = buildMarketOfferDraft(team, player, formData, isoDate);
        const validation = BM.MarketService.validateOfferBeforeSend({
          draft, team, player, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, marketRegistry: state.marketRegistry, seasonKey: buildCareerSeasonKey(), date: isoDate, marketContext,
        });
        if (!validation.valid) {
          errorEl.textContent = validation.errors.join(' · ');
          return;
        }
        if (form.dataset.mode === 'counter') {
          const liveOffer = state.marketRegistry.liveOfferForThread(threadId, isoDate);
          liveOffer.addEvent({ id: `${liveOffer.id}:club-countered`, type: 'offer-countered', date: isoDate });
          state.marketRegistry.releaseBudget(`res:${liveOffer.id}`);
          BM.MarketService.createAndSendOffer({
            marketRegistry: state.marketRegistry, thread, draft, offeredBy: 'club', rolePromise: { role: formData.role }, date: isoDate, careerSeed,
            employmentValidation: validation.employmentValidation, marketContext, validation, parentOfferId: liveOffer.id, version: liveOffer.version + 1,
          });
        } else {
          BM.MarketService.createAndSendOffer({
            marketRegistry: state.marketRegistry, thread, draft, offeredBy: 'club', rolePromise: { role: formData.role }, date: isoDate, careerSeed,
            employmentValidation: validation.employmentValidation, marketContext, validation,
          });
        }
        renderMarketScreen();
      });
    });

    container.querySelectorAll('.gm-market-accept-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const thread = state.marketRegistry.requireThread(btn.dataset.threadId);
        const offer = state.marketRegistry.requireOffer(btn.dataset.offerId);
        offer.addEvent({ id: `${offer.id}:user-accept`, type: 'player-accepted', date: isoDate });
        BM.MarketService.createAgreementInPrinciple({
          marketRegistry: state.marketRegistry, thread, offer, date: isoDate,
          employmentSnapshot: { profileId: marketContext.bundleId },
          marketRulesSnapshot: { bundleId: marketContext.bundleId },
        });
        renderMarketScreen();
      });
    });

    container.querySelectorAll('.gm-market-withdraw-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        BM.MarketService.withdrawOffer(state.marketRegistry, btn.dataset.offerId, isoDate);
        renderMarketScreen();
      });
    });

    container.querySelectorAll('.gm-rights-match-btn, .gm-rights-waive-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rightsCase = state.marketRegistry.getRightsCase(btn.dataset.caseId);
        if (!rightsCase) return;
        const decision = btn.classList.contains('gm-rights-match-btn') ? 'match' : 'waive';
        let matchProposalSummary = null;
        if (decision === 'match') {
          matchProposalSummary = rightsCase.offerSheet.contractDraftSummary;
        }
        try {
          BM.RightOfFirstRefusalService.decideMatching({
            rightsCase, decision, decidedBy: 'user', decidedAt: isoDate, matchProposalSummary,
          });
        } catch (err) {
          window.alert(err.message); // eslint-disable-line no-alert
        }
        renderMarketScreen();
      });
    });
  }

  function renderPlayerMarketTab(player, team) {
    if (!state.marketRegistry || !state.agentRegistry) return '<div class="gm-card"><p class="gm-muted">Mercado no disponible todavía.</p></div>';
    const isoDate = currentGameIsoDate();
    const availability = BM.MarketService.resolveMarketAvailability({
      playerId: player.id, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, marketRegistry: state.marketRegistry, date: isoDate,
    });
    const mandate = state.agentRegistry.actingMandateForTransaction({ playerId: player.id, date: isoDate });
    const agent = mandate ? state.agentRegistry.getAgent(mandate.agentId) : null;
    const threads = state.marketRegistry.threadsForPlayer(player.id);
    const rightsCases = state.marketRegistry.rightsCasesForPlayer(player.id);
    const isFictional = BM.MarketSeeder && player.dataSource === BM.MarketSeeder.SIMULATED_FREE_AGENT_DATA_SOURCE;

    return `
      <div class="gm-card">
        <h3>Disponibilidad de mercado</h3>
        <p>${escapeHtml(MARKET_AVAILABILITY_LABELS[availability.status] || availability.status)}
          ${isFictional ? marketSimulatedBadgeHtml('Jugador ficticio generado para el mercado de esta partida; no es un dato real.') : ''}</p>
      </div>
      <div class="gm-card">
        <h3>Representación</h3>
        ${agent ? `<p>${escapeHtml(agent.displayName)} (${escapeHtml(agent.agencyName || 'sin agencia')}) ${marketSimulatedBadgeHtml()}</p>
          <p class="gm-muted">Mandato ${mandate.exclusive ? 'exclusivo' : 'no exclusivo'}, ${escapeHtml(mandate.startDate)} — ${escapeHtml(mandate.endDate || 'sin fin declarado')}.</p>`
    : '<p class="gm-muted">Autorrepresentado.</p>'}
      </div>
      <div class="gm-card">
        <h3>Hilos con tu club</h3>
        ${threads.length ? `<ul>${threads.map((t) => `<li>${escapeHtml(t.statusOn(isoDate))} (abierto ${escapeHtml(formatIsoDateEs(t.openedAt))})</li>`).join('')}</ul>` : '<p class="gm-muted">Sin negociaciones abiertas.</p>'}
      </div>
      ${rightsCases.length ? `<div class="gm-card"><h3>Derechos</h3><ul>${rightsCases.map((c) => `<li>${escapeHtml(c.procedureType)}: ${escapeHtml(c.statusOn(isoDate))}</li>`).join('')}</ul></div>` : ''}
      <p class="gm-muted contract-scope-note">Esta pestaña sigue la ficha universal (Player Registry), incluso libre y sin club.</p>`;
  }

  function renderPlayerProfileScreen() {
    const container = byId('gm-player-profile');
    const ctx = state.playerProfile;
    if (!container || !ctx) { if (container) container.innerHTML = ''; return; }
    const found = findPlayerById(ctx.playerId);
    if (!found) {
      container.innerHTML = `
        <button id="player-profile-back-btn" class="gm-btn player-profile__back" type="button">← Volver</button>
        <p class="gm-muted">Jugador no encontrado.</p>`;
      byId('player-profile-back-btn').addEventListener('click', closePlayerProfile);
      return;
    }
    const { player, team } = found;
    const { CONFIG_BASE } = BM;
    // Legacy/defensivo (sección 5/54): cualquier jugador sin careerHistory
    // todavía (guardado anterior a esta entrega, o instancia que nunca
    // pasó por buildRealTeamFromData) lo recibe aquí mismo, sin inventar
    // pasado — baseline en el instante real de esta apertura de ficha.
    BM.ensureCareerHistory(player, CONFIG_BASE, state.calendar.currentGameDateTime, { seasonKey: buildCareerSeasonKey() });
    const ch = player.careerHistory;
    const activeTab = ctx.activeTab || 'summary';

    let body = '';
    if (activeTab === 'summary') body = renderPlayerSummaryTab(player, team, ch, CONFIG_BASE);
    else if (activeTab === 'attributes') body = renderPlayerAttributesTab(player, ch);
    else if (activeTab === 'positions') body = renderPlayerPositionsTab(player, team, CONFIG_BASE);
    else if (activeTab === 'development') body = renderPlayerDevelopmentTab(player, ch, CONFIG_BASE);
    else if (activeTab === 'stats') body = renderPlayerStatsTab(player, ch);
    else if (activeTab === 'medical') body = renderPlayerMedicalTab(player, team, CONFIG_BASE);
    else if (activeTab === 'career') body = renderPlayerCareerTab(player, ch);
    else if (activeTab === 'contract') body = renderPlayerContractTab(player, team);
    else if (activeTab === 'registration') body = renderPlayerRegistrationTab(player, team);
    else if (activeTab === 'market') body = renderPlayerMarketTab(player, team);

    container.innerHTML = `
      <button id="player-profile-back-btn" class="gm-btn player-profile__back" type="button">← Volver</button>
      <div class="tabs player-profile__tabs">
        ${PLAYER_PROFILE_TABS.map((t) => `<button class="tabs__btn ${t.id === activeTab ? 'is-active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="tabs__body player-profile__body">${body}</div>`;

    byId('player-profile-back-btn').addEventListener('click', closePlayerProfile);
    container.querySelectorAll('.player-profile__tabs .tabs__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.playerProfile.activeTab = btn.dataset.tab;
        renderPlayerProfileScreen();
      });
    });
    const attrSelect = byId('player-profile-attribute-select');
    if (attrSelect) {
      attrSelect.addEventListener('change', () => {
        state.playerProfile.developmentAttribute = attrSelect.value;
        renderPlayerProfileScreen();
      });
    }
  }

  // ---------------------------------------------------------------------
  // Navegación entre pantallas
  // ---------------------------------------------------------------------
  const SCREENS = [
    'team-select', 'home', 'lineup', 'tactics', 'training', 'medical', 'contracts', 'registrations', 'market', 'agenda', 'news', 'calendar', 'competitions', 'stats', 'match',
    'player-profile',
  ];

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
    if (screen === 'training') renderTrainingScreen();
    if (screen === 'medical') renderMedicalScreen();
    if (screen === 'contracts') renderContractsScreen();
    if (screen === 'registrations') renderRegistrationsScreen();
    if (screen === 'market') renderMarketScreen();
    if (screen === 'agenda') renderAgendaScreen();
    if (screen === 'news') renderNewsScreen();
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
    if (screen === 'player-profile') renderPlayerProfileScreen();
  }

  function init() {
    byId('gm-nav').querySelectorAll('.gm-nav__btn').forEach((btn) => {
      btn.addEventListener('click', () => goToScreen(btn.dataset.screen));
    });
    byId('gm-back-to-team-select').addEventListener('click', () => {
      state.leagues = { '1ª': null, '2ª': null };
      state.brackets = { '1ª': { cup: null, titlePlayoff: null }, '2ª': { promotionPlayoff: null } };
      state.userTeamId = null;
      // ROSTER-1 (DESIGN.md 9.16): la próxima partida construye su propio
      // registro — no queda un registro de la carrera anterior colgando.
      state.playerRegistry = null;
      // CONTRACT-1 (DESIGN.md 9.17): mismo criterio para el registro
      // contractual — los contratos pertenecen a UNA partida.
      state.contractRegistry = null;
      state.contractBootstrapWarnings = [];
      // BUG-REG1-06 (DESIGN.md 9.19): mismo criterio para el registro
      // regulatorio y su caché de clasificación — antes NINGUNO de los
      // tres se limpiaba aquí (ni siquiera estaban declarados en el
      // `state` canónico), así que una carrera nueva podía heredar
      // clasificaciones/inscripciones de la anterior.
      state.registrationRegistry = null;
      state.registrationBootstrapWarnings = [];
      state.registrationClassificationCache = null;
      // MARKET-1 (DESIGN.md 9.19): mismo criterio para los registros de
      // mercado — agentes/mandatos, hilos/ofertas/acuerdos/derechos y su
      // agenda pertenecen a UNA partida, nunca sobreviven a "Volver a
      // selección de equipo".
      state.agentRegistry = null;
      state.marketRegistry = null;
      state.marketBootstrapWarnings = [];
      state.marketAgendaLog = [];
      goToScreen('team-select');
    });
    // LIFE-4 (DESIGN.md 9.15, sección 27/29): un único listener delegado
    // para CUALQUIER nombre de jugador clicable de toda la app — evita
    // repetir el mismo `querySelectorAll` + `addEventListener` en cada
    // pantalla que ya (o en el futuro) muestre un `playerLinkHtml()`.
    // `state.screen` en el instante del click ya es la pantalla correcta
    // a la que volver (returnScreen), sin que cada llamador tenga que
    // indicarlo.
    byId('gm-app').addEventListener('click', (event) => {
      const link = event.target.closest('[data-player-link-id]');
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      openPlayerProfile(link.dataset.playerLinkId, { returnScreen: state.screen });
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
          <td>${playerLinkHtmlById(line.playerId, line.name)}</td>
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
          <p class="gm-muted">Pulsa Continuar desde Inicio para llegar a tu próximo partido.</p>
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
        <p class="gm-muted">Ajustes tácticos para este partido — se descartan al terminar salvo que los guardes como táctica base.</p>
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
