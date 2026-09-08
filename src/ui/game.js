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
    screen: 'team-select', // 'team-select' | 'home' | 'world' | 'lineup' | 'agenda' | 'news' | 'calendar' | 'competitions' | 'stats' | 'match'
    // WORLD-UI-1 (DESIGN.md 10.18): catálogo/borrador de configuración de
    // carrera, ANTES de pulsar "Comenzar" — `null` hasta que se visita la
    // pantalla de configuración. `careerSetupSnapshot` es el snapshot YA
    // congelado de la carrera EN CURSO (`state.careerSetupSnapshot`,
    // inmutable durante toda la carrera, nunca reeditado).
    careerSetupCatalog: null,
    careerSetupDraft: null,
    careerSetupSnapshot: null,
    // SAVE-LOAD-1: motivo del último autoguardado fallido (`null` si el
    // último intento fue bien o todavía no se ha intentado ninguno) — se
    // muestra de forma discreta en la pantalla "Partida", nunca bloquea.
    lastAutosaveError: null,
    // Estado de navegación del navegador Mundo — SOLO ids canónicos, nunca
    // nombres visibles ni `division` (sección 6 del prompt).
    worldView: {
      kind: 'area', areaId: null, competitionDefinitionId: null, editionId: null,
    },
    // WORLD-HARDEN-1 (DESIGN.md 10.19): `state.division` queda RETIRADO —
    // no tenía ninguna lectura productiva (solo se escribía, nunca se
    // consultaba como autoridad, ver CLAUDE.md/DESIGN.md 10.8).
    // WORLD-CLEANUP-1 (DESIGN.md 10.21): la propia entidad `Team` deja de
    // tener ninguna división/proyección legacy — participación se consulta
    // SIEMPRE por `CompetitionEntry`.
    userTeamId: null,
    // CLUB-CORE-1 (DESIGN.md sección 10): identidad INSTITUCIONAL del club
    // controlado — DISTINTA de `userTeamId` (identidad DEPORTIVA). Se
    // resuelve tras instalar el mundo (`startCareerFromSetup()`, `team.clubId` del
    // equipo elegido) — nunca se intercambian: pantallas institucionales
    // (contratos, mercado, planificación, academia) consultan `userClubId`;
    // pantallas deportivas (alineación, táctica, entrenamiento, partido,
    // inscripción) consultan `userTeamId`.
    userClubId: null,
    // WORLD-CORE-1 (DESIGN.md, "World Architecture"): `GameWorld` canónico
    // de ESTA partida — `null` hasta `startCareerFromSetup()`, nunca un singleton
    // oculto. `state.playerRegistry`/`contractRegistry`/etc. de abajo son
    // ALIASES de identidad estricta a `state.world.domainRegistries.*`
    // (misma instancia, nunca una copia) desde que se construye el mundo.
    world: null,
    // COMP-CORE-1 (DESIGN.md 10.13): instancia EXPLÍCITA por carrera del
    // motor genérico de competiciones — `null` hasta `startCareerFromSetup()`,
    // nunca un singleton (mismo criterio que el resto de registries de la
    // EPIC). Las vistas `League`/`Bracket` que consumen las pantallas
    // antiguas se construyen BAJO DEMANDA a partir de los runners que
    // vivan aquí — nunca un segundo estado sincronizado a mano
    // (WORLD-CALENDAR-1 retiró `state.leagues`/`state.brackets`).
    competitionEngine: null,
    // WORLD-SIM-1 (DESIGN.md 10.16): instancia EXPLÍCITA por carrera del
    // servicio de simulación — `null` hasta `startCareerFromSetup()`, mismo criterio
    // que `competitionEngine`.
    competitionSimulationService: null,
    // WORLD-CALENDAR-1 (DESIGN.md 10.14): FOCO DE INTERFAZ, no autoridad.
    // Antes se llamaban `activeCompetitionEditionId`/`activeStageId` y se
    // leían como "la competición activa" — un Team puede tener VARIAS
    // simultáneas (Liga + Copa + playoff), así que decidir el siguiente
    // partido desde un cache singular era parte de
    // BUG-WORLDCALENDAR-02. Hoy solo sirven para pintar la liga doméstica
    // principal del usuario en pantallas legacy; el "qué toca ahora" lo
    // decide SIEMPRE la cola mundial por FECHA.
    uiFocusCompetitionEditionId: null,
    uiFocusStageId: null,
    // WORLD-CALENDAR-1: coordinador temporal de la carrera (fuentes +
    // "Continuar"), instancia EXPLÍCITA creada en `startCareerFromSetup()` — nunca
    // un singleton. `state.calendar` (más abajo) es el `WorldCalendar`
    // único, la MISMA instancia que `state.world.calendar`.
    calendarCoordinator: null,
    scheduleService: null,
    // Última parada devuelta por el coordinador (`user-match`,
    // `market-attention`, `schedule-conflict`, `season-complete`,
    // `resolution-failed`) — lo que Home presenta. Nunca una segunda
    // verdad: siempre el objeto que devolvió `advanceUntilNextUserStop()`.
    pendingStop: null,
    // ROSTER-1 (DESIGN.md 9.16): instancia EXPLÍCITA del registro mundial
    // de jugadores de ESTA partida — `null` hasta `startCareerFromSetup()` (nunca
    // un singleton global oculto: cada partida nueva construye la suya).
    // `Team.roster` sigue siendo la afiliación deportiva actual; este
    // registro es quien permite encontrar a un jugador aunque no esté en
    // ninguna plantilla (ficha universal, LIFE-4/BUG-LIFE4-03).
    playerRegistry: null,
    // CONTRACT-1 (DESIGN.md 9.17): instancia EXPLÍCITA del registro
    // CONTRACTUAL de ESTA partida — `null` hasta `startCareerFromSetup()`, nunca un
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
    // llamar a startCareerFromSetup()), no un año fijo — así cada partida nueva
    // arranca en la temporada "actual" real en vez de quedar anclada a una
    // fecha de cuando se escribió este código.
    seasonStartYear: null,
    // WORLD-CALENDAR-1 (DESIGN.md 10.14): `WorldCalendar` ÚNICO de la
    // carrera (`src/core/WorldCalendar.js`), construido en `startCareerFromSetup()`
    // y NUNCA sustituido en el cierre de temporada (antes se creaba un
    // `Calendar` nuevo por temporada). Alias de identidad estricta de
    // `state.world.calendar`.
    calendar: null,
    // DESIGN.md 3.4.1 sigue vigente (las DOS divisiones reales están vivas
    // en paralelo desde que arranca la partida), pero WORLD-CALENDAR-1
    // retira `state.leagues`/`state.brackets` como MAPAS FIJOS de estado:
    // las vistas `League`/`Bracket` que necesitan las pantallas antiguas se
    // construyen BAJO DEMANDA desde el `stageId`/runner real del
    // `CompetitionEngine` (ver `getLeague()`/`getBrackets()`), así que ya
    // no hay un segundo estado que sincronizar ni una "otra división" que
    // simular por bloques.
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
    // LOAN-1 (DESIGN.md 9.21): registro canónico de cesiones — instancia
    // EXPLÍCITA por carrera, igual criterio que el resto de registries
    // (nunca un singleton), inicializada en bootstrapMarketForNewCareer() y
    // limpiada al volver a selección de equipo.
    loanRegistry: null,
    // BUG-TRANSFER1-18 (DESIGN.md 9.21): contador determinista por AIP para
    // el id de cada ronda de negociación club-club — nunca `Date.now()`
    // (rompía la determinación de `TransferService.generateCounterFee()`,
    // que usa `offerId` como parte de su semilla: la misma secuencia de
    // acciones del usuario podía producir una contraoferta DISTINTA en cada
    // partida, aunque el resto del estado fuera idéntico).
    transferNegotiationOfferSequence: {},
    // LOAN-1 (DESIGN.md 9.21) — mismo criterio: contador determinista por
    // (jugador, propietario, cesionario, fecha) para el id de cada intento
    // de negociación de cesión — un rechazo/contraoferta dentro de la MISMA
    // fecha de carrera no puede reutilizar el id del `LoanCase` anterior
    // (LoanRegistry.registerCase rechaza una segunda instancia con el mismo
    // id, aunque el expediente previo ya sea terminal).
    loanNegotiationAttemptSequence: {},
    // CYCLE-1 (DESIGN.md 9.22): registros canónicos del ciclo anual —
    // instancias EXPLÍCITAS por carrera, creadas en
    // `bootstrapCycleForNewCareer()` y limpiadas al volver a selección de
    // equipo (nunca singletons).
    annualCycleRegistry: null,
    academyRegistry: null,
    // NATIONAL-TEAMS-1 (DESIGN.md 10.17): registro canónico de decisiones/
    // ventanas/listas/convocatorias/apariciones nacionales — instancia
    // EXPLÍCITA por carrera, creada en `startCareerFromSetup()` y limpiada al volver
    // a selección de equipo (nunca singleton). Vacía en la partida
    // española (no se instala ninguna federación/selección real todavía).
    nationalTeamRegistry: null,
    // Evidencia del último partido oficial de CADA club: el ciclo abre los
    // plazos de verano desde la fecha REAL de cierre de cada club (un
    // eliminado en cuartos tiene más verano que el campeón), nunca desde una
    // única fecha común para los 36.
    lastOfficialMatchEvidence: null,
    // `AnnualRosterCycle` en curso (verano entre dos temporadas) — `null`
    // mientras la temporada está en juego.
    annualCycle: null,
    cycleWarnings: [],
    cycleLastTransition: null,
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
  // WORLD-HARDEN-1 (DESIGN.md 10.19): el antiguo puente de vista legacy
  // español por división (`getLeague(division)`/`getBrackets(division)`/
  // `competitionIdForDivision()`, introducido en WORLD-CALENDAR-1) queda
  // RETIRADO de la ruta productiva — sus dos únicos usos reales
  // (`closeSeasonAndPrepareNext()`/`publishActivationNews()`) ya resuelven
  // la competición real DIRECTAMENTE con los ids permitidos en esta capa
  // (`BM.CompetitionCatalog.COMPETITION_IDS.*`, CLAUDE.md), sin pasar por
  // ninguna división. Toda pantalla productiva usa
  // `getLeagueForTeam(team)`/`getUserLeague()`/`isUserInTopFlight()`/
  // `getUserBracketsReal()` (abajo), que resuelven SIEMPRE por
  // participación real (`CompetitionParticipationService`), nunca por
  // `team.division`/`state.division`.
  // ---------------------------------------------------------------------

  // WORLD-UI-1 (DESIGN.md 10.18, BUG-WORLDUI-04): competición de LIGA real
  // de UN equipo cualquiera — resuelta por su `CompetitionEntry` real de
  // la temporada (`CompetitionParticipationService`), nunca por
  // `team.division`/`state.division`. Punto ÚNICO que reemplaza, en toda
  // ruta productiva de pantalla/noticias, al antiguo `getLeague(team.division)`.
  function teamLeagueCompetitionId(team) {
    if (!team || !state.world) return null;
    return BM.CompetitionParticipationService.primaryLeagueCompetitionId(
      state.world.registries, team.id, { seasonKey: buildCareerSeasonKey() },
    );
  }

  function getLeagueForTeam(team) {
    if (!state.competitionEngine || !state.world) return null;
    const competitionId = teamLeagueCompetitionId(team);
    return competitionId ? buildLeagueFacadeForCompetition(competitionId, buildCareerSeasonKey()) : null;
  }

  function userLeagueCompetitionId() { return teamLeagueCompetitionId(getUserTeam()); }

  function isUserInTopFlight() { return userLeagueCompetitionId() === BM.CompetitionCatalog.COMPETITION_IDS.ACB; }

  // Sustituye a `getUserLeague()`/`getBrackets(state.division)` en toda
  // pantalla productiva (Inicio/Calendario/Competiciones/Estadísticas) —
  // la competición/brackets del usuario se resuelven SIEMPRE por su
  // participación real, nunca por `state.division` (BUG-WORLDUI-04).
  function getUserBracketsReal() {
    const seasonKey = buildCareerSeasonKey();
    if (!state.competitionEngine || !state.world) return { cup: null, titlePlayoff: null, promotionPlayoff: null };
    if (isUserInTopFlight()) {
      return {
        cup: buildBracketFacadeForStageKey(BM.CompetitionCatalog.COMPETITION_IDS.COPA_ACB, seasonKey, 'knockout'),
        titlePlayoff: buildBracketFacadeForStageKey(BM.CompetitionCatalog.COMPETITION_IDS.ACB, seasonKey, 'title-playoff'),
      };
    }
    return {
      promotionPlayoff: buildPromotionPlayoffCompatView(BM.CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey),
    };
  }

  function getUserLeague() { return getLeagueForTeam(getUserTeam()); }

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
  // derivado SIEMPRE del `seasonStartYear` explícito de la carrera en
  // curso. WORLD-UI-1 (BUG-WORLDUI-02): retira el fallback al año de la
  // máquina — la pantalla de configuración ya no construye equipos/
  // jugadores para previsualizar (BUG-WORLDUI-01), así que esta función
  // solo se llama con `state.seasonStartYear` ya explícito.
  function buildCareerSeasonKey() {
    if (!state.seasonStartYear) throw new Error('buildCareerSeasonKey: falta "state.seasonStartYear" — no hay ninguna carrera en curso.');
    return BM.seasonKeyFromStartYear(state.seasonStartYear);
  }

  // Identificador ESTABLE de partido (sección 6.2 del prompt de REG-1:
  // "matchId o identificador estable equivalente"; BUG-COMPCORE-03,
  // COMP-CORE-1): el descriptor canónico del runner YA trae un `id` global
  // estable (edition/stage/ronda/enfrentamiento) — se usa tal cual. El
  // fallback local solo cubre un `match` legacy sin ese campo (defensivo,
  // no debería darse ya en la ruta productiva).
  function matchStableId(match) {
    return match.id || `league:${match.round}:${match.homeTeam.id}:${match.awayTeam.id}`;
  }

  // ROSTER-1 (DESIGN.md 9.16) + REG-1 (DESIGN.md 9.18, BUG-CONTRACT1-02):
  // construye el CONTEXTO EXPLÍCITO de competición/ámbito/fecha/jornada que
  // exige `CompetitionRules.resolveRules()`. COMP-CORE-1 (BUG-COMPCORE-02):
  // `options.competitionId` es la competición REAL del partido concreto,
  // aportada por el descriptor canónico de quien conoce ese partido (liga,
  // Copa, playoff...) — nunca derivada de `team.division` (eso devolvía
  // SIEMPRE la Liga, incluso para un partido de Copa). Sin ese dato
  // (todavía no hay partido concreto — ver `resolveNextMatchContextForTeam`),
  // se resuelve la Liga doméstica PRINCIPAL del Team por participación real
  // (`CompetitionParticipationService`, nunca "la primera del array").
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
    const seasonKey = buildCareerSeasonKey();
    const competitionId = opts.competitionId
      || BM.CompetitionParticipationService.primaryLeagueCompetitionId(state.world.registries, team.id, { seasonKey });
    return {
      competitionId,
      // Sin competiciones estructuralmente distintas para Copa/Playoff en
      // este motor (Bracket.js reutiliza el mismo ACB/Primera FEB — ver
      // CLAUDE.md), `competitionInstanceId` coincide con `competitionId`;
      // documentado explícitamente, no un campo inventado sin uso.
      competitionInstanceId: competitionId,
      seasonKey,
      date: opts.date,
      phaseId: opts.phaseId || 'league',
      roundId: opts.roundId || null,
      matchId: opts.matchId || null,
      operation: opts.operation || 'buildMatchSquad',
      // LOAN-1 (DESIGN.md 9.21, sección 17.5 del prompt).
      opponentClubId: opts.opponentClubId || null,
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
  // REG-1 siempre debería existir desde `startCareerFromSetup()`).
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
        // LOAN-1 (DESIGN.md 9.21, sección 17.5 del prompt): habilita
        // "parent-club-match-eligibility" — usuario y CPU consultan el
        // MISMO servicio con el MISMO registro.
        loanRegistry: state.loanRegistry,
        // NATIONAL-TEAMS-1 (DESIGN.md 10.17, sección 6 del prompt):
        // habilita el reason code "NATIONAL_TEAM_DUTY" — usuario y CPU
        // consultan EXACTAMENTE el mismo registro (hoy vacío en la partida
        // española, sin efecto observable).
        nationalTeamRegistry: state.nationalTeamRegistry,
        clubId: team.clubId,
        ...extraDeps,
      };
      return { player, accessCategory, evaluation: EligibilityService.evaluateEligibility(player.id, team.id, context, deps) };
    }

    const pool = team.roster.map((player) => evaluateFor(player, 'senior'));

    registry.registrationsForTeam(team.id)
      .filter((r) => r.accessCategory === 'own-lower-category' && r.seasonKey === context.seasonKey && r.isEffectiveOn(context.date))
      .forEach((r) => {
        const player = state.playerRegistry.get(r.playerId);
        if (player) pool.push(evaluateFor(player, 'own-lower-category'));
      });

    registry.linkAgreementsAsBeneficiary(team.clubId).forEach((agreement) => {
      const direction = agreement.upperClubId === team.clubId ? 'lowerToUpper' : 'upperToLower';
      const originClubId = direction === 'lowerToUpper' ? agreement.lowerClubId : agreement.upperClubId;
      const originTeam = teamForClubId(originClubId);
      if (!originTeam) return;
      const lowerClubTeam = direction === 'lowerToUpper' ? originTeam : team;
      const upperClubTeam = direction === 'lowerToUpper' ? team : originTeam;
      agreement.lists[direction].forEach((playerId) => {
        const player = state.playerRegistry.get(playerId);
        if (!player) return;
        pool.push(evaluateFor(player, 'linked', {
          linkAgreement: agreement,
          linkDirection: direction,
          lowerClubCompetitionId: BM.CompetitionParticipationService.primaryLeagueCompetitionId(
            state.world.registries, lowerClubTeam.id, { seasonKey: context.seasonKey },
          ),
          upperClubCompetitionId: BM.CompetitionParticipationService.primaryLeagueCompetitionId(
            state.world.registries, upperClubTeam.id, { seasonKey: context.seasonKey },
          ),
        }));
      });
    });

    return pool;
  }

  // Contexto del PRÓXIMO partido real de `team` — usado por la pantalla de
  // Alineación, por el pool regulado (REG-1) y por el gating de mercado.
  //
  // WORLD-CALENDAR-1 (DESIGN.md 10.14): se resuelve SIEMPRE desde el
  // descriptor del próximo partido pendiente de ese equipo en CUALQUIER
  // competición, ordenado por FECHA. Antes preguntaba primero por "el
  // bracket activo de la división visible" (prioridad fija Copa > playoff
  // por el título > ascenso) y solo después por la liga, así que podía
  // devolver el contexto de un cruce en el que el equipo ni participaba
  // (BUG-WORLDCALENDAR-02).
  function resolveNextMatchContextForTeam(team) {
    const descriptor = state.competitionEngine
      ? state.competitionEngine.listAllPendingMatches().find(
        (d) => d.homeParticipantId === team.id || d.awayParticipantId === team.id,
      )
      : null;
    if (!descriptor) {
      return {
        date: state.calendar.currentGameDateTime,
        phaseId: 'league',
        roundId: null,
        matchId: null,
        competitionId: undefined,
        opponentClubId: null,
      };
    }
    const info = describeMatchDescriptor(descriptor);
    const opponent = descriptor.homeParticipantId === team.id ? info.awayTeam : info.homeTeam;
    return {
      date: descriptor.scheduledDate,
      phaseId: info.phaseId,
      roundId: info.roundId,
      matchId: info.matchId,
      competitionId: info.competitionId,
      // LOAN-1 (DESIGN.md 9.21): rival real del próximo partido — habilita
      // "parent-club-match-eligibility" en EligibilityService (usuario y
      // CPU consultan el mismo servicio).
      opponentClubId: opponent ? opponent.clubId : null,
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

  // WORLD-HARDEN-1 (DESIGN.md 10.19, sección 4 del prompt): recibe el
  // `competitionDefinitionId` EXPLÍCITO de este equipo (resuelto por el
  // llamador desde `SPAIN_CLUB_CONTENT`/el catálogo de contenido, nunca
  // adivinado aquí) para resolver el mínimo REAL de cobertura — antes se
  // construía un Team provisional `{division: teamData.division}` sin
  // `.id` y sin competitionId explícito, que dependía de
  // `state.world.registries` para resolverlo — inalcanzable en este punto
  // del arranque (el mundo todavía no existe, los 36 equipos se construyen
  // ANTES de `buildCareerWorld()`, ver `startCareerFromSetup`). Nunca
  // construye un Team provisional por división ni filtra
  // `REAL_DATA_INDEX.division` para nada que no sea "qué jugadores
  // construir" (ver `getRealTeamsByDivision`, más abajo).
  function buildRealTeamFromData(teamData, competitionDefinitionId) {
    const {
      Player, Team, ensureDevelopmentState, CONFIG_BASE, padRosterToMinimum,
    } = BM;
    if (!competitionDefinitionId) {
      throw new Error(`buildRealTeamFromData: falta "competitionDefinitionId" explícito para "${teamData.id}".`);
    }
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
      { id: teamData.id }, { date: referenceDate, phaseId: 'league', competitionId: competitionDefinitionId },
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


  // =======================================================================
  // WORLD-UI-1 (DESIGN.md 10.18) — configuración de carrera basada en
  // manifiestos. Sustituye la antigua selección por división por tres
  // pasos compactos en la MISMA pantalla (sección 5 del prompt): Mundo,
  // Competiciones, Club. Todo el trabajo real (catálogo, validación,
  // snapshot) vive en `CareerSetupService`/`CareerSetup.js` — esta sección
  // solo pinta el borrador y traduce clics, nunca decide una regla propia.
  // =======================================================================

  // WORLD-HARDEN-1 (DESIGN.md 10.19): los paquetes DISPONIBLES ya no se
  // listan a mano aquí — `data/world/content-pack-catalog.js` es el único
  // índice (sigue habiendo solo estos dos paquetes reales, sección 4 del
  // prompt). Añadir un paquete futuro es una entrada en ese catálogo, nunca
  // tocar esta función.
  function careerSetupManifests() { return BM.listAvailableContentPacks(); }
  function careerSetupManifestsById() { return new Map(careerSetupManifests().map((m) => [m.id, m])); }

  // `createdAtGameDate`/`careerSeed` del snapshot son EXPLÍCITOS (invariante
  // 7: nunca reloj del sistema) — se derivan del ancla de apertura de la
  // temporada elegida (mismo ancla que ya usaba `startCareerFromSetup()` para
  // arrancar el calendario), nunca de `new Date()`.
  function seasonAnchorIsoDate(seasonStartYear) {
    const anchor = BM.SPAIN_SEASON_ANCHOR;
    return `${seasonStartYear}-${String(anchor.month).padStart(2, '0')}-${String(anchor.day).padStart(2, '0')}`;
  }

  // Construye catálogo (memoizado) + borrador por defecto la primera vez
  // que se visita la pantalla — invariante 5: nunca construye Team/Player,
  // nunca consume RNG. Volver a esta pantalla conserva el borrador en
  // curso (nunca lo reinicia) salvo que la carrera anterior ya terminase
  // ("Volver a selección de equipo", que sí limpia `careerSetupDraft`).
  function ensureCareerSetupState() {
    if (!state.careerSetupCatalog) {
      state.careerSetupCatalog = BM.CareerSetupService.buildCatalog(careerSetupManifests(), BM.CompetitionCatalog);
    }
    if (!state.careerSetupDraft) {
      const defaultSeason = state.careerSetupCatalog.seasons.find((s) => s.isDefault) || state.careerSetupCatalog.seasons[0] || null;
      state.careerSetupDraft = BM.CareerSetupService.buildDefaultDraft(state.careerSetupCatalog, {
        referenceDate: defaultSeason ? seasonAnchorIsoDate(defaultSeason.seasonStartYear) : null,
        careerSeed: null,
      });
    }
  }

  function careerSetupValidation() {
    return BM.CareerSetupService.validateDraft(state.careerSetupCatalog, careerSetupManifestsById(), state.careerSetupDraft);
  }

  function renderCareerSetupWorldStep(container) {
    const { careerSetupCatalog: catalog, careerSetupDraft: draft } = state;
    const packsHtml = catalog.packs.map((pack) => `
      <li class="setup-pack ${draft.selectedContentPackIds.includes(pack.id) ? 'is-selected' : ''}">
        <span class="setup-pack__name">${escapeHtml(pack.name)} <span class="gm-muted">v${escapeHtml(pack.version)}</span></span>
        <span class="setup-pack__badge">${pack.isRootRequired ? 'Requerido' : 'Contenido jugable'}</span>
      </li>`).join('');
    const seasonsHtml = catalog.seasons.map((season) => `
      <button type="button" class="setup-choice ${draft.seasonKey === season.seasonKey ? 'is-active' : ''}" data-season-key="${season.seasonKey}">
        Temporada ${escapeHtml(season.seasonKey)}
      </button>`).join('');
    const timeZonesHtml = catalog.timeZones.map((tz) => `
      <button type="button" class="setup-choice ${draft.timeZoneId === tz.timeZoneId ? 'is-active' : ''}" data-time-zone-id="${escapeHtml(tz.timeZoneId)}">
        ${escapeHtml(tz.timeZoneId)}
      </button>`).join('');
    container.innerHTML = `
      <div class="gm-card">
        <h3>Paquetes de contenido</h3>
        <p class="gm-muted">España (ACB/Primera FEB) es el único contenido jugable disponible hoy — World Core es la raíz obligatoria de cualquier carrera.</p>
        <ul class="setup-pack-list">${packsHtml}</ul>
      </div>
      <div class="gm-card">
        <h3>Temporada</h3>
        <div class="setup-choice-row" data-role="season-choices">${seasonsHtml}</div>
      </div>
      <div class="gm-card">
        <h3>Huso horario</h3>
        <div class="setup-choice-row" data-role="timezone-choices">${timeZonesHtml}</div>
      </div>
    `;
    container.querySelectorAll('[data-season-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const season = catalog.seasons.find((s) => s.seasonKey === btn.dataset.seasonKey);
        draft.seasonKey = season.seasonKey;
        draft.seasonStartYear = season.seasonStartYear;
        draft.createdAtGameDate = seasonAnchorIsoDate(season.seasonStartYear);
        renderCareerSetupScreen();
      });
    });
    container.querySelectorAll('[data-time-zone-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.timeZoneId = btn.dataset.timeZoneId;
        renderCareerSetupScreen();
      });
    });
  }

  function renderCareerSetupCompetitionsStep(container) {
    const { careerSetupCatalog: catalog, careerSetupDraft: draft } = state;
    const rowsHtml = catalog.competitions.map((competition) => {
      const isCatalogOnly = competition.implementationStatus === 'catalog-only';
      const level = draft.competitionSelections[competition.competitionDefinitionId];
      const capabilities = level ? BM.capabilitiesForDetailLevel(level) : null;
      const levelOptionsHtml = competition.allowedDetailLevels.map((l) => `
        <option value="${l}" ${l === level ? 'selected' : ''}>${l}</option>`).join('');
      return `
        <li class="setup-competition ${isCatalogOnly ? 'is-catalog-only' : ''}">
          <div class="setup-competition__name">
            <strong>${escapeHtml(competition.name)}</strong>
            ${isCatalogOnly ? '<span class="setup-competition__badge">Catalogada, sin edición activa</span>' : ''}
          </div>
          ${isCatalogOnly
            ? '<p class="gm-muted">Identidad registrada para el navegador Mundo; no es seleccionable ni jugable en esta entrega.</p>'
            : `
            <label class="setup-competition__level">
              Nivel de detalle:
              <select data-competition-id="${competition.competitionDefinitionId}" ${competition.allowedDetailLevels.length <= 1 ? 'disabled' : ''}>${levelOptionsHtml}</select>
            </label>
            <p class="gm-muted">${capabilities ? describeDetailLevelCapabilities(capabilities) : ''}</p>`}
        </li>`;
    }).join('');
    container.innerHTML = `<div class="gm-card"><h3>Competiciones</h3><ul class="setup-competition-list">${rowsHtml}</ul></div>`;
    container.querySelectorAll('[data-competition-id]').forEach((select) => {
      select.addEventListener('change', () => {
        draft.competitionSelections[select.dataset.competitionId] = select.value;
        renderCareerSetupScreen();
      });
    });
  }

  // Descripción DERIVADA de las capacidades reales del nivel (sección 5.2
  // del prompt) — nunca un texto fijo por nombre de nivel que pudiera
  // desincronizarse de `capabilitiesForDetailLevel()`.
  function describeDetailLevelCapabilities(capabilities) {
    const stop = capabilities.allowsUserMatchStop ? 'permite parada del usuario' : 'nunca para al usuario';
    const unit = capabilities.temporalUnit === 'phase' ? 'se resuelve por fase completa' : 'se resuelve partido a partido';
    const resolution = { 'match-engine': 'motor de partido completo', 'compact-score': 'marcador compacto', 'aggregate-phase': 'resumen agregado' }[capabilities.resolutionKind];
    const coverage = capabilities.requiredRosterCoverage === 'complete' ? 'exige roster real completo' : 'no exige roster completo';
    return `${stop}; ${unit}; ${resolution}; ${coverage}.`;
  }

  function renderCareerSetupClubStep(container) {
    const { careerSetupCatalog: catalog, careerSetupDraft: draft } = state;
    const playableCompetitionIds = new Set(
      catalog.competitions
        .filter((c) => (draft.competitionSelections[c.competitionDefinitionId] || c.recommendedDetailLevel) === 'playable')
        .map((c) => c.competitionDefinitionId),
    );
    const byCompetition = new Map();
    catalog.clubs.forEach((club) => {
      if (!playableCompetitionIds.has(club.initialCompetitionDefinitionId)) return;
      if (!byCompetition.has(club.initialCompetitionDefinitionId)) byCompetition.set(club.initialCompetitionDefinitionId, []);
      byCompetition.get(club.initialCompetitionDefinitionId).push(club);
    });
    const groupsHtml = [...byCompetition.entries()].map(([competitionId, clubs]) => {
      const competition = catalog.competitions.find((c) => c.competitionDefinitionId === competitionId);
      const cardsHtml = [...clubs].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((club) => `
        <button type="button" class="team-card ${draft.controlledClubId === club.clubId ? 'is-selected' : ''}" data-club-id="${club.clubId}" data-team-id="${club.teamId}">
          <span class="team-card__name">${escapeHtml(club.name)}</span>
          <span class="team-card__city">${escapeHtml(club.city)}</span>
          <span class="team-card__roster">${club.rosterSize} jugadores · cobertura ${escapeHtml(club.dataCoverage)}</span>
        </button>`).join('');
      return `<div class="gm-card"><h3>${escapeHtml(competition ? competition.name : competitionId)}</h3><div class="team-grid">${cardsHtml}</div></div>`;
    }).join('') || '<p class="gm-muted">Ninguna competición jugable disponible con la configuración actual — vuelve a "Competiciones" y pon alguna en "playable".</p>';
    container.innerHTML = groupsHtml;
    container.querySelectorAll('.team-card').forEach((card) => {
      card.addEventListener('click', () => {
        draft.controlledClubId = card.dataset.clubId;
        draft.controlledTeamId = card.dataset.teamId;
        renderCareerSetupScreen();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Pantalla: configuración de carrera (WORLD-UI-1) — reemplaza la antigua
  // selección de equipo por división.
  // ---------------------------------------------------------------------
  function renderCareerSetupScreen() {
    ensureCareerSetupState();
    const container = byId('gm-team-select');
    const step = container.dataset.setupStep || '1';
    const validation = careerSetupValidation();

    const stepsHtml = `
      <div class="setup-steps" role="tablist">
        <button type="button" class="setup-steps__btn ${step === '1' ? 'is-active' : ''}" data-step="1">1. Mundo</button>
        <button type="button" class="setup-steps__btn ${step === '2' ? 'is-active' : ''}" data-step="2">2. Competiciones</button>
        <button type="button" class="setup-steps__btn ${step === '3' ? 'is-active' : ''}" data-step="3">3. Club</button>
      </div>`;
    const errorsHtml = validation.errors.length
      ? `<div class="gm-card setup-errors" role="alert"><ul>${validation.errors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join('')}</ul></div>`
      : '';
    container.innerHTML = `${stepsHtml}<div id="gm-setup-step-body"></div>${errorsHtml}
      <div class="setup-actions">
        <button type="button" id="gm-setup-start-btn" class="gm-btn gm-btn--primary" ${validation.valid ? '' : 'disabled'}>Comenzar carrera</button>
      </div>`;

    container.querySelectorAll('.setup-steps__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.dataset.setupStep = btn.dataset.step;
        renderCareerSetupScreen();
      });
    });

    const stepBody = byId('gm-setup-step-body');
    if (step === '1') renderCareerSetupWorldStep(stepBody);
    else if (step === '2') renderCareerSetupCompetitionsStep(stepBody);
    else renderCareerSetupClubStep(stepBody);

    const startBtn = byId('gm-setup-start-btn');
    if (startBtn && !startBtn.disabled) {
      startBtn.addEventListener('click', () => {
        const draft = state.careerSetupDraft;
        draft.careerSeed = draft.careerSeed || `${draft.controlledTeamId}|${draft.seasonStartYear}`;
        draft.createdAtGameDate = draft.createdAtGameDate || seasonAnchorIsoDate(draft.seasonStartYear);
        const snapshot = BM.CareerSetupService.buildSnapshot(
          state.careerSetupCatalog, careerSetupManifestsById(), draft,
          { idFactory: () => `career:${draft.controlledTeamId}:${draft.seasonStartYear}` },
        );
        startCareerFromSetup(snapshot);
      });
    }
  }

  // ---------------------------------------------------------------------
  // COMP-CORE-1 (DESIGN.md 10.13) — integración del motor genérico de
  // competiciones. `game.js` es la ÚNICA capa que conoce ACB/Primera
  // FEB/Copa como literales — el engine (`CompetitionEngine`/
  // `CompetitionRunners`) nunca los ve.
  // ---------------------------------------------------------------------

  // WORLD-HARDEN-1 (DESIGN.md 10.19): `competitionIdForDivision()` queda
  // RETIRADA — sus dos call-sites productivos (arranque y cierre de
  // temporada) ya resuelven la competición real directamente con
  // `BM.CompetitionCatalog.COMPETITION_IDS.*`, nunca traduciendo una
  // división. WORLD-CLEANUP-1 (DESIGN.md 10.21): el adaptador legacy de
  // división de `CompetitionRules.js` queda RETIRADO por completo (ya sin
  // ningún call-site productivo desde COMP-CORE-1).

  // WORLD-CALENDAR-1 (DESIGN.md 10.14) — proveedor de fechas del engine:
  // GENÉRICO, construido por `CompetitionScheduleService` a partir del
  // calendario que cada Edition tiene CONGELADO (`scheduleProfileId`) y de
  // la fase (`template.key`). Sustituye a la función anterior, que
  // ramificaba por Copa/`promotion-final-four`/nombre de competición para
  // elegir a mano un método de `Calendar.js`: ese `Calendar` ya no
  // participa en la ruta productiva. Un calendario/fase desconocido FALLA
  // de forma descriptiva; nunca hereda el perfil de otra competición.
  // SAVE-LOAD-1: acepta un `scheduleService` explícito opcional (por
  // defecto `state.scheduleService`) — `CareerHydrationService.hydrate()`
  // necesita construir el `dateResolverProvider` ANTES de que exista
  // `state.scheduleService` (todavía no hay carrera activa que sustituir),
  // así que reutiliza esta misma función pasándole el suyo propio, en vez
  // de duplicar esta lógica.
  function buildCompetitionDateResolverProvider(scheduleService) {
    const svc = scheduleService || state.scheduleService;
    return svc.buildDateResolverProvider({
      // El año de inicio de temporada llega de la CARRERA (nunca del reloj
      // del ordenador): se deriva de la `seasonKey` congelada en la propia
      // Edition, así que una Edition de una temporada anterior sigue
      // resolviendo sus fechas reales.
      seasonStartYearForEdition: (edition) => BM.LocalDate.seasonStartYear(edition.seasonKey),
    });
  }

  // Construye la Liga regular de `competitionId` a partir del runner que
  // el engine YA inicializó (`initializeEdition`) — vista legacy DERIVADA,
  // nunca un segundo estado (`League` delega en el MISMO runner que
  // consulta `state.competitionEngine`). `null` si esa fase no tiene
  // runtime todavía.
  function buildLeagueFacadeForCompetition(competitionId, seasonKey) {
    const stageId = BM.buildStageId(competitionId, seasonKey, 'regular-season');
    const runner = state.competitionEngine.getRunner(stageId);
    if (!runner) return null;
    const teams = runner.participantIds.map((id) => state.world.registries.teams.get(id)).filter(Boolean);
    return new BM.League(teams, null, { runner });
  }

  // Construye la vista legacy (`Bracket`-shaped) de un stage de tipo
  // bracket YA activado por el engine — `entries` se reconstruye desde
  // la PRIMERA ronda del runner real (nunca se recalcula la clasificación
  // que ya decidió el engine).
  function buildBracketFacadeForStage(stageId) {
    const runner = state.competitionEngine.getRunner(stageId);
    if (!runner) return null;
    const teamsById = new Map(getAllTeams().map((t) => [t.id, t]));
    const seen = new Set();
    const entries = [];
    runner.rounds[0].forEach((series) => {
      [series.better, series.worse].forEach((entry) => {
        if (seen.has(entry.participantId)) return;
        seen.add(entry.participantId);
        entries.push({ team: teamsById.get(entry.participantId), seed: entry.seed });
      });
    });
    return new BM.Bracket(entries, [], [], null, { runner });
  }

  function buildBracketFacadeForStageKey(competitionId, seasonKey, stageKey) {
    return buildBracketFacadeForStage(BM.buildStageId(competitionId, seasonKey, stageKey));
  }

  // Vista de compatibilidad de `PromotionPlayoff` (Promotion.js histórico)
  // COMPUESTA a partir de DOS stages/runners INDEPENDIENTES del engine
  // (`promotion-quarterfinals` + `promotion-final-four`, activados en
  // instantes distintos) — mismo shape exacto que consumen game.js/
  // SeasonHistoryService/cycle1-harness.js (`directPromotion`,
  // `quarterFinals`, `finalFour`, `isQuarterFinalsComplete`,
  // `secondPromotedEntry`, `isComplete`, `playNextGame`, `getStatus`).
  // `directPromotion` (DESIGN.md 3.2.3: "1º asciende directo, sin jugar
  // playoff") es una vista de solo lectura sobre la clasificación YA
  // decidida por el runner de liga regular — nunca una Entry/Stage nueva.
  // WORLD-CALENDAR-1: se construye BAJO DEMANDA (antes vivía en
  // `state.brackets`), así que `finalFour` se resuelve del engine en cada
  // llamada en vez de asignarse a mano al activarse.
  function buildPromotionPlayoffCompatView(competitionId, seasonKey) {
    const quarterfinals = buildBracketFacadeForStageKey(competitionId, seasonKey, 'promotion-quarterfinals');
    if (!quarterfinals) return null;
    const regularRunner = state.competitionEngine.getRunner(BM.buildStageId(competitionId, seasonKey, 'regular-season'));
    const standings = regularRunner.getStandings();
    const teamsById = new Map(getAllTeams().map((t) => [t.id, t]));
    const finalFour = buildBracketFacadeForStageKey(competitionId, seasonKey, 'promotion-final-four');
    const view = {
      directPromotion: { team: teamsById.get(standings[0].participantId), seed: 1 },
      quarterFinals: quarterfinals,
      finalFour,
      get isQuarterFinalsComplete() { return view.quarterFinals.isComplete; },
      // El engine ya activa la Final Four automáticamente en cuanto los
      // cuartos se completan (cascada intra-edición) — este método se
      // conserva por compatibilidad de forma (llamadas históricas a
      // `promo.ensureFinalFour()`), nunca construye nada por sí mismo.
      ensureFinalFour() {},
      get secondPromotedEntry() { return view.finalFour ? view.finalFour.champion : null; },
      get isComplete() { return view.secondPromotedEntry !== null; },
      playNextGame(config, resolveOptions) {
        if (!view.isQuarterFinalsComplete) return view.quarterFinals.playNextGame(config, resolveOptions);
        if (!view.finalFour) throw new Error('PromotionPlayoff: la Final Four todavía no está activada.');
        return view.finalFour.playNextGame(config, resolveOptions);
      },
      getStatus() {
        return {
          directPromotion: view.directPromotion,
          quarterFinals: view.quarterFinals.getStatus(),
          finalFour: view.finalFour ? view.finalFour.getStatus() : null,
          secondPromotedEntry: view.secondPromotedEntry,
          isComplete: view.isComplete,
        };
      },
    };
    return view;
  }

  // Refresca el FOCO DE INTERFAZ (`uiFocusCompetitionEditionId`/
  // `uiFocusStageId`) de la liga doméstica principal del usuario — SIEMPRE
  // desde `CompetitionParticipationService` (Entry real), nunca desde
  // `team.division`. WORLD-CALENDAR-1: es solo foco de pantalla; el
  // "siguiente partido" ya NO se deriva de aquí (un Team puede tener
  // varias competiciones activas a la vez).
  function refreshActiveCompetitionIdsForUser() {
    const userTeam = getUserTeam();
    if (!userTeam || !state.world) return;
    const seasonKey = buildCareerSeasonKey();
    const competitionId = BM.CompetitionParticipationService.primaryLeagueCompetitionId(
      state.world.registries, userTeam.id, { seasonKey },
    );
    const edition = state.competitionEngine.getActiveEdition(competitionId)
      || state.world.registries.competitionEditions.get(BM.buildEditionId(competitionId, seasonKey));
    state.uiFocusCompetitionEditionId = edition ? edition.id : null;
    const activeStage = edition ? state.competitionEngine.getActiveStage(edition.id) : null;
    state.uiFocusStageId = activeStage ? activeStage.id : null;
  }

  // Aplica los hechos de activación que el engine acaba de producir al
  // resolver un partido (sección 13.2 del prompt: "el engine procesa
  // round-completed/stage-completed; game.js publica noticias SOLO
  // después del commit real") — devuelve los eventos consumidos para que
  // el llamador decida qué noticia publicar (nunca antes de este punto).
  function drainCompetitionActivationEvents() {
    if (!state.competitionEngine) return [];
    const events = state.competitionEngine.drainActivationEvents();
    // WORLD-CALENDAR-1 (DESIGN.md 10.14): ya NO se construye aquí ninguna
    // vista `Bracket` en `state.brackets` (ese mapa fijo desapareció) —
    // `getBrackets()` la deriva bajo demanda del runner real. Este punto
    // solo refresca el foco de interfaz y DEVUELVE los hechos para que el
    // llamador publique su noticia DESPUÉS del commit real.
    refreshActiveCompetitionIdsForUser();
    return events;
  }

  // ---------------------------------------------------------------------
  // Arranque de carrera (WORLD-UI-1, DESIGN.md 10.18) — sustituye a la
  // antigua `startSeason(teamId, division)`. Recibe un `CareerSetupSnapshot`
  // YA VALIDADO e INMUTABLE (`renderCareerSetupScreen()`): ningún literal
  // de temporada/huso/nivel se decide aquí, todos llegan del snapshot.
  // ---------------------------------------------------------------------
  function startCareerFromSetup(snapshot) {
    const {
      CONFIG_BASE, recalculateSportingGoalsForCohort, PlayerRegistry,
    } = BM;
    const teamId = snapshot.controlledTeamId;
    state.userTeamId = teamId;
    state.seasonStartYear = snapshot.seasonStartYear;
    // Manifiestos YA resueltos (orden de dependencias real) — fuente única
    // para paquetes a instalar Y para los schedules que declaran (sección
    // 4 del prompt, pasos 2-3).
    const startPlan = BM.CareerSetupService.buildStartPlan(snapshot, careerSetupManifestsById());
    // WORLD-CALENDAR-1 (DESIGN.md 10.14): UN solo `WorldCalendar` por
    // carrera, con huso EXPLÍCITO del snapshot (WORLD-UI-1: ya no
    // `BM.SPAIN_TIME_ZONE_ID` fijo — el snapshot es quien lo declaró tras
    // validar contra los paquetes elegidos). Los perfiles de calendario se
    // registran al instalar el paquete; el servicio de schedules es la
    // única pieza que sabe programar fechas.
    // WORLD-HARDEN-1 (DESIGN.md 10.19, sección 4 del prompt): preparación
    // GENÉRICA de catálogos estáticos (formatos/schedules/pathways) de los
    // paquetes YA resueltos — necesaria ANTES de instalar el mundo porque
    // el `WorldCalendar` se construye antes que `GameWorld`. `game.js` ya
    // NO llama a `BM.registerSpainSchedules()` por nombre: cada paquete
    // declara sus propios hooks (`manifest.hooks`), invocados aquí en el
    // orden canónico de dependencias que ya trae `startPlan.packs` — un
    // paquete futuro solo necesita declarar sus propios hooks, nunca tocar
    // esta función. `state.contentPackLifecycle` y los paquetes resueltos
    // se conservan para el cierre de temporada (mismo criterio genérico,
    // nunca `SPAIN_SCHEDULE_IDS`/`SPAIN_PATHWAY_IDS` sueltos más abajo).
    state.contentPackLifecycle = new BM.ContentPackLifecycleService({ manifests: startPlan.packs });
    state.installedContentPacks = startPlan.packs;
    state.contentPackLifecycle.prepareCatalogs(startPlan.packs);
    state.scheduleService = new BM.CompetitionScheduleService({ catalog: BM.CompetitionScheduleCatalog });
    const careerTimeZoneId = snapshot.timeZoneId;
    const careerSeasonKeyAtStart = snapshot.seasonKey;
    // WORLD-UI-1 (DESIGN.md 10.18, BUG-WORLDUI-03, sección 4 del prompt,
    // paso 3): el inicio de temporada es el MÁS TEMPRANO entre los
    // schedules que declaran los paquetes YA resueltos por
    // `CareerSetupService.buildStartPlan()` — nunca el de ACB por defecto.
    const seasonScheduleIds = [...new Set(startPlan.packs.flatMap((pack) => (pack.provides && pack.provides.competitionSchedules) || []))];
    const seasonSchedules = seasonScheduleIds.map((id) => BM.CompetitionScheduleCatalog.requireSchedule(id));
    let seasonStartInstant = null;
    let seasonWindowStartInstant = null;
    seasonSchedules.forEach((schedule) => {
      const start = state.scheduleService.seasonStartInstant(schedule, state.seasonStartYear);
      const windowStart = state.scheduleService.seasonWindowStartInstant(schedule, state.seasonStartYear);
      if (!seasonStartInstant || BM.GameDateTime.compare(start, seasonStartInstant) < 0) seasonStartInstant = start;
      if (!seasonWindowStartInstant || BM.GameDateTime.compare(windowStart, seasonWindowStartInstant) < 0) seasonWindowStartInstant = windowStart;
    });
    state.calendar = new BM.WorldCalendar({
      id: `calendar:${teamId}:${state.seasonStartYear}`,
      defaultTimeZoneId: careerTimeZoneId,
      // El CURSOR arranca en el borde de la ventana de temporada (ancla
      // desplazada al `dayOffset` más temprano que declara el contenido),
      // no en el ancla: la jornada 1 puede tener partidos en viernes y un
      // cursor situado en el ancla los dejaría DETRÁS de él desde el minuto
      // cero (invariante 5). El ancla sigue siendo el "inicio de temporada"
      // que se registra y que usa el contexto de entrenamiento.
      initialInstant: seasonWindowStartInstant,
    });
    state.calendar.registerSeason({
      seasonKey: careerSeasonKeyAtStart,
      startInstant: seasonStartInstant,
      timeZoneId: careerTimeZoneId,
      scheduleIds: seasonScheduleIds,
    });
    state.pendingStop = null;
    // ROSTER-1 (DESIGN.md 9.16): una carrera nueva construye su PROPIO
    // registro mundial — nunca un singleton compartido entre partidas.
    state.playerRegistry = new PlayerRegistry();

    // WORLD-CLEANUP-1 (DESIGN.md 10.21, sección 5.3 del prompt): los 36
    // equipos reales se construyen TODOS a la vez, SIN agruparlos por
    // `['1ª','2ª']`/`getRealTeamsByDivision()` (retirados de la ruta
    // productiva) — `REAL_DATA_INDEX` se recorre entero y la afiliación
    // COMPETITIVA de cada equipo se resuelve por id estable
    // (`SPAIN_CLUB_CONTENT.initialCompetitionDefinitionId`, vía
    // `CareerParticipantFactory`), nunca por el campo crudo `division` del
    // bundle. `buildRealTeamFromData()` sigue exigiendo ese
    // `competitionDefinitionId` explícito para resolver el mínimo real de
    // cobertura.
    const { REAL_DATA_INDEX, REAL_DATA_TEAMS, CareerParticipantFactory } = BM;
    const competitionIdByTeamId = CareerParticipantFactory.competitionIdByTeamIdFrom(BM.SPAIN_CLUB_CONTENT);
    const allTeams = REAL_DATA_INDEX.map(
      (entry) => buildRealTeamFromData(REAL_DATA_TEAMS[entry.id], competitionIdByTeamId.get(entry.id)),
    );
    // ROSTER-1 (DESIGN.md 9.16): registra el universo completo de
    // jugadores de CADA equipo (reales + relleno ficticio por cobertura
    // incompleta) en cuanto se construye — antes de cualquier otro
    // procesado de pretemporada.
    allTeams.forEach((team) => state.playerRegistry.registerMany(team.roster));

    // WORLD-UI-1 (DESIGN.md 10.18, BUG-WORLDUI-09) / WORLD-HARDEN-1
    // (DESIGN.md 10.19, sección 4 del prompt: "agruparlos por
    // initialCompetitionDefinitionId"): agrupación por
    // `competitionDefinitionId` REAL — ya NO de `REAL_DATA_INDEX.division`.
    // `spain-2026.1.install()` recibe este contexto canónico, nunca
    // `teamsByDivision` (retirado de la ruta productiva; sigue existiendo
    // solo como shim de fixtures históricos). La agrupación en sí vive en
    // `CareerParticipantFactory` (módulo genérico y puro, sin literales de
    // país) — los Team YA existen (misma construcción de siempre), esta
    // llamada solo los clasifica. El MISMO cohorte por competición real se
    // reutiliza a continuación para sportingGoal/identidad CPU — nunca un
    // cohorte por división.
    const teamsByCompetitionId = CareerParticipantFactory.groupTeamsByCompetitionId(allTeams, BM.SPAIN_CLUB_CONTENT);
    Object.values(teamsByCompetitionId).forEach((cohort) => {
      // Decisión no pedida explícitamente por el prompt de esta sesión,
      // señalada aquí: se recalcula sportingGoal (Bloque 2, DESIGN.md
      // 3.4.3) también al ARRANCAR una partida nueva, no solo en el
      // cierre de ciclo entre temporadas — de lo contrario la primera
      // temporada de cualquier partida nueva arrancaría con el valor fijo
      // 'Permanencia' para los 36 equipos (el propio hueco que 3.4.3 dice
      // cerrar), dejando inerte CpuLineup.computeMatchImportance() hasta
      // el primer cierre de ciclo. Arrancar una partida es, conceptualmente,
      // también una "pretemporada" (antes de jugar ninguna jornada).
      recalculateSportingGoalsForCohort(cohort, CONFIG_BASE);
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
      cohort.forEach((team) => {
        if (team.id === teamId) return;
        // CYCLE-1 (BUG-CYCLE1-01): la identidad CPU se construye con la
        // fecha de CARRERA explícita (edad de rotación real), nunca con el
        // reloj del ordenador vía `player.age`.
        team.tacticalProfile = BM.buildCpuTacticalIdentity(team, CONFIG_BASE, state.calendar.currentGameDateTime);
      });
    });

    // WORLD-CORE-1 (DESIGN.md, "World Architecture") — `GameWorld` canónico
    // de la carrera: se construye AQUÍ (los 36 equipos ya existen, como
    // MISMAS instancias, nunca reconstruidas) e instala los paquetes YA
    // resueltos por `CareerSetupService.buildStartPlan()` — sección 13.1
    // del prompt de COMP-CORE-1, pasos 1-3: equipos ya construidos, mundo/
    // paquetes instalados (Editions/Stage de Liga regular/Entries YA
    // declarados por el contenido), TODAVÍA sin ningún runner vivo. Si la
    // instalación lanzara, `state.world` NUNCA llega a asignarse
    // (invariante 22: no debe quedar un mundo parcial utilizable) — el
    // error se propaga tal cual.
    const worldSeasonKey = snapshot.seasonKey;
    // WORLD-SIM-1 (DESIGN.md 10.16) / WORLD-UI-1 (DESIGN.md 10.18): el
    // perfil de simulación se DERIVA del snapshot YA validado — nunca una
    // segunda preferencia editable ni literales de ACB/Primera FEB/Copa
    // reconstruidos aquí (`CareerSetupService.buildSimulationProfile()`).
    // Se asigna al mundo ANTES de instalar ningún paquete
    // (`spain-2026.1.js` ya crea Editions dentro de `install()`).
    const simulationProfile = BM.CareerSetupService.buildSimulationProfile(snapshot);
    const world = BM.buildCareerWorld({
      id: `world:${teamId}:${state.seasonStartYear}`,
      name: 'Mundo de la carrera',
      careerSeed: snapshot.careerSeed,
      createdAtGameDate: snapshot.createdAtGameDate,
      packs: startPlan.packs,
      context: { teamsByCompetitionId, seasonKey: worldSeasonKey, seasonStartDate: snapshot.createdAtGameDate },
      simulationProfile,
    });
    state.world = world;
    // CLUB-CORE-1: `userClubId` se resuelve AQUÍ, con el mundo ya instalado
    // (el equipo elegido ya tiene `clubId` real enlazado por
    // `spain-2026.1.js`) — nunca antes, nunca igual a `teamId`.
    const userTeamEntity = state.world.registries.teams.require(teamId);
    state.userClubId = userTeamEntity.clubId;
    state.careerSetupSnapshot = snapshot;
    // El borrador deja de ser autoridad en cuanto existe una carrera —
    // se reconstruye limpio la próxima vez que se visite la pantalla de
    // configuración ("Volver a selección de equipo").
    state.careerSetupDraft = null;

    // WORLD-SIM-1: instancia EXPLÍCITA por carrera (nunca singleton) — hoy
    // inerte en la partida española (ACB/Primera FEB/Copa son "playable",
    // nunca construyen un runtime "standard"/"abstract"), pero disponible
    // para que `CompetitionEngine` la use en cuanto un paquete futuro
    // instale una competición no jugable.
    state.competitionSimulationService = new BM.CompetitionSimulationService({
      world: state.world,
      careerSeed: snapshot.careerSeed,
    });

    // COMP-CORE-1 (DESIGN.md 10.13, sección 13.1 del prompt, pasos 4-6):
    // UNA única instancia de `CompetitionEngine` por carrera, adjuntada al
    // MISMO `GameWorld` — inicializa los runners desde las Entries YA
    // registradas. `SpainLegacyCompetitionRuntime` NO participa en esta
    // ruta productiva (retirado, ver CLAUDE.md/DESIGN.md 10.8), y las
    // vistas `League`/`Bracket` que necesitan las pantallas antiguas se
    // construyen BAJO DEMANDA desde estos mismos runners
    // (WORLD-CALENDAR-1: `state.leagues`/`state.brackets` ya no existen).
    state.competitionEngine = new BM.CompetitionEngine({ world: state.world, simulationService: state.competitionSimulationService });
    state.competitionEngine.setDateResolverProvider(buildCompetitionDateResolverProvider());
    // WORLD-UI-1 (DESIGN.md 10.18, BUG-WORLDUI-03): las Editions de
    // arranque a inicializar se DERIVAN del registro (todas las que el
    // paquete instalado ya registró para esta temporada), nunca dos ids
    // ACB/Primera FEB codificados aquí — un paquete futuro con más
    // competiciones de arranque no necesitaría tocar esta función.
    state.world.registries.competitionEditions.forSeason(worldSeasonKey)
      .filter((edition) => edition.status !== 'completed' && edition.status !== 'cancelled')
      .forEach((edition) => state.competitionEngine.initializeEdition(edition.id));
    // PATHWAYS-1 (DESIGN.md 10.15): el pathway del paquete instalado
    // (playoff por el título, Copa en jornada 17, playoff de ascenso,
    // transición ACB<->Primera FEB para `spain-2026.1`) decide TODA la
    // progresión — ya NO se registra la activación cruzada legacy de Copa
    // (`buildSeasonActivationPlan()`/`registerCrossEditionActivation()`,
    // sin call-sites productivos desde esta entrega, BUG-PATHWAYS-01/02).
    // `CompetitionPathwayService` es una instancia EXPLÍCITA por carrera,
    // nunca un singleton. WORLD-HARDEN-1 (DESIGN.md 10.19): los pathways ya
    // quedaron registrados por `state.contentPackLifecycle.prepareCatalogs()`
    // más arriba (idempotente — no hace falta repetirlo aquí) y
    // `resolveEditionBindings` se resuelve por OWNERSHIP
    // (`manifest.provides.competitionDefinitions`), nunca llamando
    // `BM.resolveSpainEditionBindings` por nombre.
    state.pathwayService = new BM.CompetitionPathwayService({
      world: state.world,
      competitionEngine: state.competitionEngine,
      now: () => ({ instant: state.calendar.currentInstant, timeZoneId: state.calendar.defaultTimeZoneId }),
      resolveEditionBindings: (competitionId, world) => state.contentPackLifecycle.resolveEditionBindings(
        state.installedContentPacks, competitionId, world,
      ),
    });
    state.competitionEngine.setFactHandler((fact) => state.pathwayService.handleEngineFact(fact));

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
    // CYCLE-1 (DESIGN.md 9.22, sección 29 del prompt): se ejecuta AL FINAL
    // del arranque — el ciclo anual orquesta contratos, inscripciones,
    // mercado, traspasos y cesiones, así que necesita los cinco registros
    // anteriores ya creados. Inicializa además el ciclo de vida (desarrollo/
    // médico/carrera/perfil de longevidad) de TODOS los jugadores del mundo,
    // incluidos los libres del pool de mercado.
    bootstrapCycleForNewCareer();

    // NATIONAL-TEAMS-1 (DESIGN.md 10.17, sección 4.3 del prompt): instancia
    // EXPLÍCITA por carrera, nunca singleton — hoy vacía en la partida
    // española (no se instala ninguna federación/selección real, sección 2
    // del prompt: "no instales aún selecciones reales... en la partida
    // española"), pero disponible para que `EligibilityService`
    // (`NATIONAL_TEAM_DUTY`) y `RegulatoryClassificationService`
    // (excepción de formación por selección) la consulten como una
    // dependencia real más — nunca inerte por estar hardcodeada fuera.
    state.nationalTeamRegistry = new BM.NationalTeamRegistry();
    // WORLD-CORE-1 (sección 5.2 del prompt): adjunta por IDENTIDAD (nunca
    // copia) los registros de dominio ya creados arriba —
    // `state.world.domainRegistries.playerRegistry === state.playerRegistry`
    // es una comprobación de identidad estricta, no de contenido.
    state.world.attachDomainRegistries({
      playerRegistry: state.playerRegistry,
      contractRegistry: state.contractRegistry,
      registrationRegistry: state.registrationRegistry,
      agentRegistry: state.agentRegistry,
      marketRegistry: state.marketRegistry,
      transferRegistry: state.transferRegistry,
      loanRegistry: state.loanRegistry,
      annualCycleRegistry: state.annualCycleRegistry,
      academyRegistry: state.academyRegistry,
      nationalTeamRegistry: state.nationalTeamRegistry,
    });
    // WORLD-CALENDAR-1 (invariante 2): identidad estricta —
    // `state.calendar === state.world.calendar` durante TODA la carrera.
    state.world.setCalendar(state.calendar);

    // WORLD-CALENDAR-1: el coordinador temporal se construye AL FINAL del
    // arranque (necesita los registros de dominio ya creados) y con
    // dependencias EXPLÍCITAS — nunca lee `state` por dentro.
    state.calendarCoordinator = buildWorldCalendarCoordinator();
    state.calendarCoordinator.sync();

    refreshActiveCompetitionIdsForUser();
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
    // WORLD-UI-1 (DESIGN.md 10.18): el navegador Mundo arranca en la raíz
    // mundial — nunca en una división ni en el país del usuario por
    // defecto (invariante 1: navegación siempre por ids canónicos).
    state.worldView = {
      kind: 'area', areaId: BM.WORLD_CORE_AREA_IDS.WORLD, competitionDefinitionId: null, editionId: null,
    };

    // SAVE-LOAD-1 (checkpoint 1/3): autoguardado tras completar el
    // bootstrap de una carrera nueva — fire-and-forget, nunca bloquea.
    autoSaveCareer();
    goToScreen('home');
  }

  // WORLD-CALENDAR-1: se resuelve desde el registro MUNDIAL (misma
  // instancia), no recorriendo la liga visible — construir una vista de
  // liga solo para encontrar un equipo era gratuito y ataba el equipo del
  // usuario a `state.division`.
  function getUserTeam() {
    if (!state.userTeamId || !state.world) return null;
    return state.world.registries.teams.get(state.userTeamId) || null;
  }

  // ---------------------------------------------------------------------
  // CONTRACT-1 (DESIGN.md 9.17) — integración de la vertical contractual.
  //
  // Esta capa de UI NO contiene ninguna regla laboral propia: solo decide
  // CUÁNDO llamar a `ContractSeeder`/`ContractService` (arranque de
  // partida, incorporación de cantera) y muestra el resultado. Toda la
  // normativa vive en `CompetitionRules`/`ClubEmploymentContextCatalog`.
  // ---------------------------------------------------------------------
  // WORLD-CALENDAR-1 (BUG-WORLDCALENDAR-03): la fecha CIVIL del "ahora" de
  // la carrera se obtiene del instante UTC con el HUSO DECLARADO del
  // calendario — antes era `LocalDate.fromJsDate(state.calendar
  // .currentGameDateTime)`, que dependía del huso del ordenador (un partido
  // de las 21:00 en Madrid caía en el día siguiente con TZ=Asia/Tokyo, y
  // con él todos los plazos contractuales/de mercado de ese día).
  function currentGameIsoDate() {
    return state.calendar.currentLocalDate;
  }

  // CYCLE-1 (DESIGN.md 9.22, BUG-CYCLE1-01): punto ÚNICO de la interfaz para
  // la edad de un jugador — SIEMPRE contra la fecha de CARRERA, nunca el
  // getter legacy `player.age` (que lee el reloj real del ordenador y en una
  // carrera de 2036 mostraba la edad de 2026). Devuelve `null` si el jugador
  // no tiene fecha de nacimiento conocida.
  function careerAgeOf(player, referenceDate) {
    if (!state.calendar) return null;
    return BM.CareerAge.ageOnDate(player, referenceDate || state.calendar.currentGameDateTime);
  }

  // WORLD-CONTEXT-1 (DESIGN.md 10.20) — punto ÚNICO de la interfaz para el
  // contexto competitivo de un equipo: se resuelve SIEMPRE desde sus
  // `CompetitionEntry` reales de esa temporada (`CompetitionContextService`),
  // nunca de `team.division`. Los dominios profesionales (contratos,
  // inscripciones, mercado, traspasos, cesiones, ciclo anual) reciben el id
  // explícito o este resolver, según sean operaciones de un equipo, entre
  // equipos o batch.
  function domesticCompetitionIdForTeam(team, seasonKey, operation) {
    return BM.CompetitionContextService.resolveDomesticCompetitionId(state.world.registries, team.id, {
      seasonKey: seasonKey || buildCareerSeasonKey(),
      operation: operation || 'ui',
    });
  }

  // Resolver PURO `(team, seasonKey) => competitionId` para operaciones
  // batch (seeders, ciclo anual, planificación CPU).
  function buildDomesticCompetitionResolver(operation) {
    return BM.CompetitionContextService.makeDomesticCompetitionResolver(state.world.registries, {
      operation: operation || 'ui-batch',
    });
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

    const teams = interactiveCohortTeams();
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
      // WORLD-CONTEXT-1: resolver obligatorio por Entries reales.
      competitionIdForTeam: buildDomesticCompetitionResolver('bootstrapContracts'),
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
    const {
      AgentRegistry, MarketRegistry, MarketSeeder, TransferRegistry, LoanRegistry, CONFIG_BASE,
    } = BM;
    state.agentRegistry = new AgentRegistry();
    state.marketRegistry = new MarketRegistry();
    // TRANSFER-1 (DESIGN.md 9.20): instancia EXPLÍCITA por carrera, mismo
    // criterio que el resto de registros canónicos — nunca un singleton,
    // se limpia al volver a selección de equipo (ver más abajo).
    state.transferRegistry = new TransferRegistry();
    state.transferNegotiationOfferSequence = {};
    // LOAN-1 (DESIGN.md 9.21): mismo criterio.
    state.loanRegistry = new LoanRegistry();
    state.loanNegotiationAttemptSequence = {};
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

  // =====================================================================
  // CYCLE-1 (DESIGN.md 9.22) — registros del ciclo anual y ciclo de vida
  // =====================================================================
  // `state.annualCycleRegistry` y `state.academyRegistry` son instancias
  // EXPLÍCITAS por carrera (mismo criterio que `contractRegistry`/
  // `registrationRegistry`/`marketRegistry`/`transferRegistry`/
  // `loanRegistry`): nunca singletons, se limpian al volver a selección de
  // equipo. `state.lastOfficialMatchEvidence` recoge la fecha del ÚLTIMO
  // partido oficial de CADA club durante la temporada — sin ella el ciclo no
  // se abre (nunca se inventa una fecha de cierre común para los 36).
  function bootstrapCycleForNewCareer() {
    const {
      AnnualCycleRegistry, AcademyRegistry, SeasonHistoryService, WorldLifecycleService, RetirementService, CONFIG_BASE,
    } = BM;
    state.annualCycleRegistry = new AnnualCycleRegistry();
    state.academyRegistry = new AcademyRegistry();
    state.lastOfficialMatchEvidence = new SeasonHistoryService.LastOfficialMatchEvidenceCollector();
    state.annualCycle = null;
    state.cycleWarnings = [];
    state.cycleLastTransition = null;
    const isoDate = currentGameIsoDate();
    const seasonKey = buildCareerSeasonKey();
    // Un único COMANDO de inicialización por jugador (nunca repartido por
    // renderizadores): desarrollo + médico + histórico + perfil de longevidad.
    state.playerRegistry.all().forEach((player) => {
      WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, isoDate, {
        seasonKey,
        historyCompleteness: player.teamId ? 'partial' : 'complete',
        annualCycleRegistry: state.annualCycleRegistry,
        retirementService: RetirementService,
        careerSeed: buildCycleCareerSeed(),
      });
    });
  }

  // Semilla de carrera del ciclo — determinista y estable para toda la
  // partida (nunca `Math.random()`/`Date.now()`).
  function buildCycleCareerSeed() {
    return `cycle-1|${state.userTeamId || 'no-team'}|${state.seasonStartYear}`;
  }

  // Dependencias comunes que TODA llamada al ciclo necesita. Punto único:
  // ninguna pantalla arma su propio objeto de dependencias a mano.
  function buildCycleParams(extra) {
    return {
      annualCycleRegistry: state.annualCycleRegistry,
      academyRegistry: state.academyRegistry,
      cycle: state.annualCycle,
      teams: getAllTeams(),
      playerRegistry: state.playerRegistry,
      contractRegistry: state.contractRegistry,
      registrationRegistry: state.registrationRegistry,
      marketRegistry: state.marketRegistry,
      agentRegistry: state.agentRegistry,
      transferRegistry: state.transferRegistry,
      loanRegistry: state.loanRegistry,
      config: BM.CONFIG_BASE,
      careerSeed: buildCycleCareerSeed(),
      userClubId: state.userClubId,
      // WORLD-CONTEXT-1: el equipo del usuario es un id DISTINTO de su club
      // — la evidencia de último partido oficial es del EQUIPO.
      userTeamId: state.userTeamId,
      // WORLD-CONTEXT-1: resolver obligatorio del ciclo — cada fase lo
      // consulta con la temporada de ORIGEN o de DESTINO según su papel.
      competitionIdForTeam: buildDomesticCompetitionResolver('annualCycle'),
      lineup: state.lineup,
      operationalContext: currentTransferOperationalContext(),
      classificationCache: state.registrationClassificationCache,
      retirementService: BM.RetirementService,
      ...(extra || {}),
    };
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
        domesticCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'signContractsForNewPlayers'),
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
      teams: interactiveCohortTeams(),
      seasonKey,
      date: isoDate,
      registrationRegistry: state.registrationRegistry,
      contractRegistry: state.contractRegistry,
      config: CONFIG_BASE,
      competitionIdForTeam: buildDomesticCompetitionResolver('bootstrapRegistrations'),
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
        domesticCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'signRegistrationsForNewPlayers'),
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
    // COMP-CORE-1: la competición real con la que compitió cada equipo en
    // `prevSeasonKey` se resuelve por participación (Entry, aunque
    // `team.division` ya haya mutado por el ascenso/descenso de este
    // cierre) — `divisionBeforeByTeamId` se conserva por compatibilidad de
    // la firma, ya no se traduce a mano.
    teamsWithOldAffiliation.forEach((team) => {
      const oldCompetitionId = BM.CompetitionParticipationService.primaryLeagueCompetitionId(
        state.world.registries, team.id, { seasonKey: prevSeasonKey },
      );
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
      // Competición de DESTINO: el ámbito del curso NUEVO, ya comprometido
      // por el pathway (nunca la división del curso que termina).
      competitionIdForTeam: buildDomesticCompetitionResolver('registrationsForSeasonTransition'),
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
  // `buildAgendaEvents()` los deriva bajo demanda de la cola mundial, que
  // los lista desde `state.marketRegistry.allScheduledEvents()`.
  // BUG-WORLDCALENDAR-04 (corregido en esta entrega): ese contrato estaba
  // ROTO — `buildAgendaEvents()` no leía ni los eventos programados ni este
  // log, así que Agenda omitía a la vez los próximos vencimientos y los
  // hechos de mercado ya registrados. Ahora lee ambos, sin duplicarlos.
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

  // Noticias/Agenda médicas SOLO para la competición de liga REAL del
  // usuario (sección 30: "competición de fondo: ninguna noticia médica") —
  // WORLD-UI-1 (BUG-WORLDUI-07): identidad de participación real
  // (`teamLeagueCompetitionId`), nunca igualdad de `division` — comparado
  // contra el snapshot `before` de snapshotMedicalIdentity().
  function pushMedicalDiffEvents(team, before) {
    if (!BM.CONFIG_BASE.medical.enabled || teamLeagueCompetitionId(team) !== userLeagueCompetitionId()) return;
    team.roster.forEach((player) => {
      const prev = before.get(player.id);
      if (!prev || !player.medicalState) return;
      const injury = player.medicalState.currentInjury;
      if (injury && injury.id !== prev.currentInjuryId) {
        pushMedicalAgenda(BM.buildInjuryAgendaEvent(player, team, injury));
        pushNews(BM.buildInjuryNewsEvent(player, team, injury, {
          userTeamId: state.userTeamId, relatedCompetition: userLeagueCompetitionId(),
        }));
      }
      player.medicalState.injuryHistory.slice(prev.historyLength).forEach((entry) => {
        pushNews(BM.buildFullRecoveryNewsEvent(player, team, entry.daysUnavailable, {
          userTeamId: state.userTeamId, relatedCompetition: userLeagueCompetitionId(), dateTime: state.calendar.currentGameDateTime,
        }));
      });
    });
  }

  // Lesiones EN DIRECTO durante un partido (MatchEngine.buildMatchResult
  // `.injuries`, sección 31) — dato ya construido por el motor, este
  // helper solo decide cuándo redactar Agenda/Noticias a partir de él.
  function pushMedicalMatchEvents(homeTeam, awayTeam, result, competitionId) {
    if (!BM.CONFIG_BASE.medical.enabled || !result.injuries || !result.injuries.length) return;
    // WORLD-UI-1 (BUG-WORLDUI-07): identidad de participación real, nunca
    // igualdad de `division` — competición de fondo: nunca noticia médica.
    if (teamLeagueCompetitionId(homeTeam) !== userLeagueCompetitionId()) return;
    result.injuries.forEach((entry) => {
      const team = entry.teamId === homeTeam.id ? homeTeam : awayTeam;
      const player = team.roster.find((p) => p.id === entry.playerId);
      if (!player || !player.medicalState || !player.medicalState.currentInjury) return;
      const injury = player.medicalState.currentInjury;
      pushMedicalAgenda(BM.buildInjuryAgendaEvent(player, team, injury));
      pushNews(BM.buildInjuryNewsEvent(player, team, injury, {
        userTeamId: state.userTeamId, relatedCompetition: competitionId || null,
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

  // WORLD-CALENDAR-1 (DESIGN.md 10.14): `pushLeagueMatchNews()` (lote de
  // noticias "de la jornada") ha desaparecido — ya no hay jornadas que se
  // resuelvan en bloque. Cada partido publica sus noticias justo DESPUÉS de
  // su propio commit real (ver `pushMatchNewsAfterCommit`), conservando la
  // misma política de relevancia de CAL-2.

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
  // WORLD-CALENDAR-1 (DESIGN.md 10.14, sección 12 del prompt): el
  // `advanceGameClockTo()` anterior hacía DOS cosas muy distintas —
  // (a) avanzar el reloj y procesar desarrollo/entrenamiento/médico, y
  // (b) barrer de golpe TODOS los eventos vencidos de Market/Transfer/Loan
  // (`eventsDueThrough`) después de haber saltado a la fecha de un partido
  // posterior. Esta entrega lo parte:
  //  - el HOOK de avance continuo (esta función) mantiene (a);
  //  - los eventos DISCRETOS se despachan uno a uno desde sus propios items
  //    de la cola mundial (`market-event`/`transfer-event`/`loan-event`),
  //    exactamente en su fecha y nunca dos veces (idempotencia real de cada
  //    registro), en vez de un barrido opaco tras el salto;
  //  - el cursor lo mueve SIEMPRE el coordinador
  //    (`WorldCalendarCoordinator`), único punto que avanza
  //    `state.calendar`, y solo hasta el instante del grupo que va a
  //    resolver: ya no se puede adelantar por encima de una parada del
  //    usuario ni de un partido pendiente (BUG-WORLDCALENDAR-01).
  function applyClockAdvanceHook(instant) {
    const date = BM.GameDateTime.toJsDate(instant);
    processDevelopmentToDateForTeams(getAllTeams(), date);
    // LIFE-2: plan de entrenamiento CPU de los 35 clubes que no controla el
    // usuario, en el mismo punto único que el resto del desarrollo.
    reviewCpuTrainingForAllTeams(date);
  }

  // Avance del cursor común FUERA de la cola de partidos (fases fechadas
  // del ciclo anual, arranque de la temporada siguiente) — mismo hook
  // continuo, mismo calendario, nunca hacia atrás.
  function advanceWorldClockToInstant(instant) {
    if (!instant) return false;
    const moved = state.calendar.advanceTo(instant);
    if (moved) applyClockAdvanceHook(state.calendar.currentInstant);
    return moved;
  }

  function advanceWorldClockToLocalDate(localDate) {
    if (!localDate) return false;
    return advanceWorldClockToInstant(
      BM.GameDateTime.startOfLocalDay(localDate, state.calendar.defaultTimeZoneId),
    );
  }

  // MARKET-1 (DESIGN.md 9.19, sección 15.4 del prompt): primer punto que
  // exige una decisión REAL del usuario para su club — wrapper fino sobre
  // MarketService, usado tanto por el gating de "Continuar" como por la
  // aserción de advanceGameClockTo() de arriba.
  //
  // BUG-MARKET1-07 (DESIGN.md 9.20): antes, sin `throughDate` explícito,
  // caía en `state.calendar.currentGameDateTime` (HOY) — Home sustituía
  // "Continuar" por CUALQUIER atención viva, aunque venciera mucho después
  // del próximo partido. Ahora, sin `throughDate` explícito, se calcula la
  // fecha objetivo REAL de la siguiente acción con
  // `resolveNextMatchContextForTeam()` (la MISMA función que ya usa la
  // pantalla de Alineación) y solo devuelve la atención si de verdad
  // BLOQUEA esa fecha (`attentionBlocksThrough`, regla inclusiva
  // compartida con `advanceGameClockTo()`) — una atención posterior sigue
  // existiendo (Agenda/Mercado pueden mostrarla), pero deja de sustituir
  // el botón principal de Home antes de tiempo.
  function getMarketAttentionForUser(throughDate) {
    if (!state.userClubId || !state.marketRegistry) return null;
    const team = getUserTeam();
    const resolvedThroughDate = throughDate || (team ? resolveNextMatchContextForTeam(team).date : state.calendar.currentGameDateTime);
    const attention = BM.MarketService.computeMarketAttentionForClub({
      marketRegistry: state.marketRegistry, clubId: state.userClubId, date: resolvedThroughDate,
    });
    return BM.MarketService.attentionBlocksThrough(attention, resolvedThroughDate) ? attention : null;
  }

  // Procesa, para TODOS los clubes (usuario y CPU), los eventos de
  // mercado NO interactivos ya vencidos — respuesta de interés inicial,
  // respuesta CPU a una oferta enviada por el usuario, y expiración de
  // ofertas vivas. Idempotente (MarketRegistry.markEventProcessed +
  // ledger propio de cada entidad) — un render/avance repetido no
  // reprocesa nada dos veces.
  function resolveMarketScheduledEvent(event) {
    const careerSeed = buildMarketCareerSeed();
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
      return;
    }
    if (event.type === 'offer-response') {
      const thread = state.marketRegistry.getThread(event.threadId);
      const offer = state.marketRegistry.getOffer(event.payload.offerId);
      if (thread && offer && offer.statusOn(event.dueDate) === 'sent') {
        const marketContext = thread.rulesSnapshot;
        BM.MarketService.processOfferResponse({
          marketRegistry: state.marketRegistry, playerRegistry: state.playerRegistry, thread, offer, date: event.dueDate, careerSeed, marketContext,
        });
      }
      state.marketRegistry.markEventProcessed(event.id);
      return;
    }
    if (event.type === 'offer-expiry') {
      // La expiración de ofertas vivas la resuelve MarketService con su
      // propia regla (inclusiva) — aquí solo se dispara EN SU FECHA, no en
      // un barrido posterior.
      state.marketRegistry.markEventProcessed(event.id);
      BM.MarketService.expireDueOffers(state.marketRegistry, event.dueDate);
      return;
    }
    state.marketRegistry.markEventProcessed(event.id);
  }

  // TRANSFER-1 (DESIGN.md 9.20) — noticia de mercado tras un COMMIT real
  // (nunca antes: la auditoría estática de test-transfer1.js exige que
  // ningún archivo del dominio de transferencia construya noticias) de un
  // expediente de traspaso/fichaje. Reutilizada tanto por la formalización
  // interactiva (Mercado > Negociaciones) como por el reintento automático
  // de un fichaje futuro en advanceGameClockTo().
  function pushTransferCompletionNews(transferCase) {
    const player = state.playerRegistry.get(transferCase.playerId);
    const destinationTeam = teamForClubId(transferCase.destinationClubId);
    const originTeam = transferCase.originClubId ? teamForClubId(transferCase.originClubId) : null;
    if (!player || !destinationTeam) return;
    const isPureRelease = originTeam && originTeam.id === destinationTeam.id;
    const title = isPureRelease
      ? `${player.fullName} queda libre tras la rescisión de su contrato con ${originTeam.fullName}`
      : (originTeam
        ? `${player.fullName} ficha por ${destinationTeam.fullName}, procedente de ${originTeam.fullName}`
        : `${player.fullName} ficha por ${destinationTeam.fullName}`);
    const involvesUser = destinationTeam.clubId === state.userClubId || (originTeam && originTeam.clubId === state.userClubId);
    pushNews(BM.buildMarketNewsEvent({
      dateTime: state.calendar.currentGameDateTime,
      title,
      relatedTeam: isPureRelease ? originTeam : destinationTeam,
      relatedPlayer: { id: player.id, fullName: player.fullName },
      priority: involvesUser ? 'alta' : 'media',
    }));
  }

  // LOAN-1 (DESIGN.md 9.21, sección 19 del prompt) — noticia SOLO tras
  // commit real (nunca al proponer/negociar): "opción ejercida" nunca se
  // presenta como "fichado", un retorno pendiente de inscripción se explica
  // como tal, nunca como una cesión completada sin matices.
  function pushLoanNews(agreement, kind, extra) {
    const player = state.playerRegistry.get(agreement.playerId);
    const ownerTeam = teamForClubId(agreement.ownerClubId);
    const borrowerTeam = teamForClubId(agreement.borrowerClubId);
    if (!player || !ownerTeam || !borrowerTeam) return;
    const involvesUser = ownerTeam.clubId === state.userClubId || borrowerTeam.clubId === state.userClubId;
    let title;
    let relatedTeam;
    if (kind === 'activated') {
      title = `${player.fullName} sale cedido a ${borrowerTeam.fullName} procedente de ${ownerTeam.fullName}`;
      relatedTeam = borrowerTeam;
    } else if (kind === 'returned') {
      title = (extra && extra.registrationOutcome === 'pending-registration')
        ? `${player.fullName} regresa de su cesión en ${borrowerTeam.fullName} — pendiente de inscripción en ${ownerTeam.fullName}`
        : `${player.fullName} regresa de su cesión en ${borrowerTeam.fullName} a ${ownerTeam.fullName}`;
      relatedTeam = ownerTeam;
    } else if (kind === 'early-termination') {
      title = `La cesión de ${player.fullName} en ${borrowerTeam.fullName} termina anticipadamente — vuelve a ${ownerTeam.fullName}`;
      relatedTeam = ownerTeam;
    } else if (kind === 'option-exercised') {
      // Nunca "fichado" — la opción solo ABRE la vía de TRANSFER-1, el
      // jugador sigue cedido hasta que exista consentimiento/contrato real.
      title = `${extra && extra.beneficiaryTeamName} ejerce su opción de compra sobre ${player.fullName} — pendiente de acuerdo del jugador`;
      relatedTeam = borrowerTeam;
    } else {
      return;
    }
    pushNews(BM.buildMarketNewsEvent({
      dateTime: state.calendar.currentGameDateTime,
      title,
      relatedTeam,
      relatedPlayer: { id: player.id, fullName: player.fullName },
      priority: involvesUser ? 'alta' : 'media',
    }));
  }

  // LOAN-1 (DESIGN.md 9.21, sección 18 del prompt) — "un retorno efectivo
  // antes de un partido se procesa antes de construir convocatoria/acta":
  // mismo punto único del reloj que `processDueScheduledTransfersToDate()`,
  // revalida SIEMPRE desde cero (LoanExecutionService replanifica, nunca
  // ejecuta a ciegas un plan viejo).
  function resolveLoanReturn(agreement) {
    const isoDate = currentGameIsoDate();
    const teams = getAllTeams();
    const ownerTeam = teams.find((t) => t.clubId === agreement.ownerClubId);
    const borrowerTeam = teams.find((t) => t.clubId === agreement.borrowerClubId);
    if (!ownerTeam || !borrowerTeam) {
      throw new Error(
        `loan-event: la cesión "${agreement.id}" referencia clubes sin Team resoluble `
        + `(${agreement.ownerClubId} / ${agreement.borrowerClubId}).`,
      );
    }
    const { result } = BM.LoanService.returnLoan({
      playerRegistry: state.playerRegistry,
      contractRegistry: state.contractRegistry,
      registrationRegistry: state.registrationRegistry,
      transferRegistry: state.transferRegistry,
      loanRegistry: state.loanRegistry,
      teams,
      now: isoDate,
      operationalContext: currentTransferOperationalContext(),
      lineup: state.lineup,
      agreement,
      ownerTeam,
      borrowerTeam,
      // WORLD-CONTEXT-1: papel de propietario y de cesionario resueltos por
      // separado (pueden competir en competiciones distintas).
      ownerCompetitionId: domesticCompetitionIdForTeam(ownerTeam, buildCareerSeasonKey(), 'loan:return:owner'),
      borrowerCompetitionId: domesticCompetitionIdForTeam(borrowerTeam, buildCareerSeasonKey(), 'loan:return:borrower'),
      effectiveDate: agreement.returnEffectiveDate,
      seasonKey: buildCareerSeasonKey(),
      commit: true,
    });
    if (result && result.record) {
      cleanupSessionReferencesForPlayer(agreement.playerId);
      pushLoanNews(agreement, 'returned', { registrationOutcome: result.registrationOutcome });
    }
  }

  // TRANSFER-1 (DESIGN.md 9.20, sección 11.2 del prompt) — "fichaje futuro
  // tras expiración": reintenta cada expediente `scheduled` (contrato con
  // inicio posterior a la fecha en que se formalizó) cuya fecha efectiva ya
  // se ha alcanzado. Revalida SIEMPRE desde cero (TransferService.
  // retryScheduledTransferCase re-planifica, nunca ejecuta a ciegas un plan
  // viejo) — si algo dejó de ser cierto entretanto, el expediente queda
  // `blocked` con el motivo, nunca a medias.
  function resolveScheduledTransferCase(tCase) {
    const isoDate = currentGameIsoDate();
    const deps = {
      playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, registrationRegistry: state.registrationRegistry,
      marketRegistry: state.marketRegistry, transferRegistry: state.transferRegistry, teams: getAllTeams(), now: isoDate,
      operationalContext: currentTransferOperationalContext(), lineup: state.lineup,
    };
    const { result } = BM.TransferService.retryScheduledTransferCase(tCase, deps, isoDate);
    if (result && result.record) {
      cleanupSessionReferencesForPlayer(tCase.playerId);
      pushTransferCompletionNews(tCase);
    }
  }

  // WORLD-CORE-1 (sección 8.5 del prompt): fuente MUNDIAL — nunca "la lista
  // de clubes españoles" como única fuente posible. WORLD-HARDEN-1
  // (DESIGN.md 10.19): sin mundo todavía (ninguna carrera arrancada), no
  // hay ningún equipo que devolver — el antiguo fallback por
  // `getLeague('1ª'/'2ª')` está retirado de la ruta productiva junto con
  // esa función.
  function getAllTeams() {
    if (!state.world) return [];
    return state.world.registries.teams.all();
  }

  // WORLD-SIM-1 (DESIGN.md 10.16, BUG-WORLDSIM-06): cohorte INTERACTIVO —
  // los sistemas españoles que hoy aplican bootstrap/seeding a TODOS los
  // equipos (contratos, inscripción, ciclo anual) deben usar esto, nunca
  // `getAllTeams()` a secas. Instalar mañana un Team `standard`/`abstract`
  // no le aplicaría las reglas españolas por accidente. Para la partida
  // actual el cohorte contiene exactamente los mismos 36 equipos (ACB +
  // Primera FEB son "playable"), así que el comportamiento observable no
  // cambia. `getAllTeams()` SIGUE significando "todos los Teams
  // registrados" (búsquedas/diagnóstico) — su semántica no cambia.
  function interactiveCohortTeams() {
    if (!state.competitionSimulationService) return getAllTeams();
    const cohortIds = new Set(state.competitionSimulationService.interactiveCohortTeams(buildCareerSeasonKey()));
    if (!cohortIds.size) return getAllTeams();
    return getAllTeams().filter((team) => cohortIds.has(team.id));
  }

  // CLUB-CORE-1 (DESIGN.md sección 10): resuelve el Team principal de un
  // Club REAL (contratos/mercado/traspasos/cesiones/tanteo usan siempre
  // `clubId`, nunca `team.id`) — decisión explícita de la vertical actual
  // (sección 9.5 del prompt: "las operaciones de la UI se dirigen al Team
  // principal del Club"). `null` si no existe (nunca lanza: muchas de estas
  // pantallas ya toleraban un club/equipo ausente con `|| null`).
  function teamForClubId(clubId) {
    if (!clubId) return null;
    return getAllTeams().find((t) => t.clubId === clubId) || null;
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
  // WORLD-CALENDAR-1: se cuenta sobre los PARTIDOS PENDIENTES de TODAS las
  // competiciones del equipo (antes solo su liga), en una sola pasada por
  // el engine — nunca construyendo una vista `League` por equipo. Consulta
  // pura: no materializa partidos ni consume aleatoriedad.
  function buildUpcomingMatchCounts(fromDate, days) {
    const counts = new Map();
    if (!state.competitionEngine) return counts;
    const start = fromDate.getTime();
    const end = start + days * 24 * 60 * 60 * 1000;
    state.competitionEngine.listAllPendingMatches().forEach((descriptor) => {
      if (!descriptor.scheduledDate) return;
      const time = descriptor.scheduledDate.getTime();
      if (time < start || time >= end) return;
      [descriptor.homeParticipantId, descriptor.awayParticipantId].forEach((id) => {
        counts.set(id, (counts.get(id) || 0) + 1);
      });
    });
    return counts;
  }

  function countUpcomingMatchesForTeam(team, fromDate, days) {
    return buildUpcomingMatchCounts(fromDate, days).get(team.id) || 0;
  }

  // LIFE-2 (sección 26/29, invariante "user team nunca es sobrescrito por
  // TrainingAI"): revisa el plan CPU de TODOS los equipos salvo el del
  // usuario, cada vez que el reloj de mundo avanza — TrainingAI.reviewTeamIfDue
  // ya decide internamente si toca revisar (cadencias de 28/56 días).
  function reviewCpuTrainingForAllTeams(date) {
    const { reviewTeamIfDue, CONFIG_BASE } = BM;
    const calendarCtx = buildTrainingCalendarContext();
    // Una sola pasada por la cola de partidos pendientes para los 36
    // clubes (antes: una vista `League` por equipo, en cada avance de
    // reloj).
    const upcoming = buildUpcomingMatchCounts(date, 7);
    getAllTeams().forEach((team) => {
      if (team.id === state.userTeamId) return;
      reviewTeamIfDue(team, date, { matchesInNext7Days: upcoming.get(team.id) || 0 }, CONFIG_BASE, calendarCtx);
    });
  }

  // WORLD-CLEANUP-1 (DESIGN.md 10.21, sección 6 del prompt): el nivel
  // competitivo se lee de `CompetitionDefinition.tier` — nunca de un id de
  // ACB/FEB ni de una división. Sin tier declarado, se aplica la política
  // genérica neutra documentada (`defaultCompetitionTierWeight`).
  function competitionTierForId(competitionId) {
    if (!competitionId) return null;
    const definition = state.world.registries.competitionDefinitions.get(competitionId);
    return definition ? definition.tier : null;
  }

  // `matchContext` (WORLD-CLEANUP-1, DESIGN.md 10.21): descriptor canónico
  // de la competición REAL de este partido — `{ phaseId, competitionId,
  // stageId, competitionName, competitionShortName }` — nunca una clave de
  // UI (`'league'/'cup'/'playoff'/'promotion'`, retirada). Por defecto liga
  // doméstica sin más contexto, para no obligar a tocar un llamador que
  // solo resuelva partidos de liga.
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
  function applyRecoveryForResolvedMatch(homeTeam, awayTeam, result, date, matchContext = { phaseId: 'league' }) {
    if (!date || !result.rotation) return;
    const { ensureDevelopmentState, recordMatchExposure, CONFIG_BASE } = BM;
    const { phaseId } = matchContext;
    // BUG-COMPCORE-02 (COMP-CORE-1): un partido de Copa NUNCA debe
    // registrarse con el competitionId de la Liga — Copa es competición
    // SEPARADA (invariante 12). El descriptor YA trae el `competitionId`
    // REAL de este partido concreto — nunca se vuelve a adivinar por fase.
    const competitionId = matchContext.competitionId
      || BM.CompetitionParticipationService.primaryLeagueCompetitionId(
        state.world.registries, homeTeam.id, { seasonKey: buildCareerSeasonKey() },
      );
    // LIFE-3 (DESIGN.md 9.14, sección 31): lesiones EN DIRECTO de este
    // partido ya resuelto — Agenda/Noticias, punto único (todo partido
    // resuelto de cualquier competición pasa por aquí).
    pushMedicalMatchEvents(homeTeam, awayTeam, result, competitionId);
    // CYCLE-1 (DESIGN.md 9.22, sección 7 del prompt): PUNTO ÚNICO de
    // evidencia del último partido oficial de cada club — todo partido
    // resuelto de CUALQUIER competición (liga, Copa, playoff por el título,
    // playoff de ascenso) pasa por aquí, así que el ciclo anual abre los
    // plazos de verano desde la fecha REAL de cierre de cada club y nunca
    // desde la final para los 36. No se recorre el calendario a posteriori.
    if (state.lastOfficialMatchEvidence) {
      // WORLD-CONTEXT-1: un partido lo disputan EQUIPOS — se registran los
      // dos ids de cada lado (equipo y club institucional real).
      state.lastOfficialMatchEvidence.recordMatch({
        homeTeamId: homeTeam.id,
        homeClubId: homeTeam.clubId,
        awayTeamId: awayTeam.id,
        awayClubId: awayTeam.clubId,
        date,
        competitionId,
        phaseId,
        matchId: result.gameId || null,
      });
    }
    // LIFE-4 (DESIGN.md 9.15, sección 11): clave estable del partido — mismo
    // `gameId` determinista de MatchEngine.createMatchState para ambos
    // lados, con fallback defensivo por fecha para caminos de modo prueba
    // que pudieran no traerlo.
    const matchKey = result.gameId || `match-${homeTeam.id}-${awayTeam.id}-${date.toISOString()}`;
    const competitionTier = competitionTierForId(competitionId);
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
            date,
            minutes: Math.round(playedSeconds / 60),
            competitionDefinitionId: competitionId,
            competitionTier,
            stageId: matchContext.stageId || null,
            positionMinutes,
          }, CONFIG_BASE);

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
                competitionDefinitionId: competitionId,
                competitionName: matchContext.competitionName || null,
                competitionShortName: matchContext.competitionShortName || null,
                stageId: matchContext.stageId || null,
                team: {
                  id: team.id, name: team.fullName, clubId: team.clubId || null, clubName: (team.club && team.club.name) || null,
                },
                opponent: { id: opponent.id, name: opponent.fullName },
                boxScoreLine: line,
                isStarter,
                matchKey,
              }, CONFIG_BASE);
              pushCareerNewsForPlayer(player, team, careerResult, competitionId);
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
  function pushCareerNewsForPlayer(player, team, careerResult, competitionId) {
    if (team.id !== state.userTeamId) return;
    const opts = { userTeamId: state.userTeamId, relatedCompetition: competitionId };
    careerResult.newMilestones.forEach((milestone) => {
      pushNews(BM.buildCareerMilestoneNewsEvent(player, team, milestone, opts));
    });
    careerResult.newPersonalBests.forEach((milestone) => {
      pushNews(BM.buildPersonalBestNewsEvent(player, team, milestone, player.careerHistory.historyCompleteness, opts));
    });
  }

  // =====================================================================
  // WORLD-CALENDAR-1 (DESIGN.md 10.14) — ORQUESTACIÓN TEMPORAL
  //
  // Lo que había antes de esta entrega y ha desaparecido:
  //  - `simulateNextRound()` como unidad de avance global;
  //  - `getBackgroundDivision()`/`getBackgroundLeague()`/
  //    `simulateBackgroundRound()`, que jugaban "una jornada de la otra
  //    división" cada vez que el usuario cerraba la suya;
  //  - `drainBackgroundBrackets()`, que agotaba una eliminatoria COMPLETA
  //    en el mismo paso (BUG-WORLDCALENDAR-01: el reloj podía llegar a la
  //    final de ascenso antes de que el usuario jugase su propio playoff);
  //  - la prioridad fija `Copa > playoff por el título > playoff de
  //    ascenso` de `getActiveBracket()`, y tratar como parada del usuario
  //    un cruce CPU-vs-CPU (BUG-WORLDCALENDAR-02).
  //
  // Ahora hay UNA cola mundial (`state.calendar`, `WorldCalendar`) y UN
  // coordinador (`state.calendarCoordinator`): cada partido de cualquier
  // Edition/Stage activa y cada evento fechado de Market/Transfer/Loan se
  // resuelve EXACTAMENTE cuando le toca, y solo se detiene el juego cuando
  // el usuario debe actuar de verdad.
  // =====================================================================

  // REG-1 (BUG-REG1-03/04): `roundId` REAL de un partido de eliminatoria,
  // derivado del DESCRIPTOR (no de `bracket.rounds.length`) — mismo formato
  // de clave que antes de esta entrega, así que la detección de doble acta
  // entre rondas/series/temporadas no cambia de semántica. La sub-fase
  // (cuartos/Final Four de ascenso) se distingue por `stageKey`, nunca por
  // "qué bracket estaba abierto".
  function bracketRoundIdForDescriptor(descriptor, phaseId) {
    const roundNumber = (descriptor.roundIndex || 0) + 1;
    if (descriptor.stageKey === 'promotion-quarterfinals') return `${phaseId}:quarterfinals-${roundNumber}`;
    if (descriptor.stageKey === 'promotion-final-four') return `${phaseId}:finalfour-${roundNumber}`;
    return `${phaseId}:round-${roundNumber}`;
  }

  // Contexto normativo/de interfaz de UN descriptor de partido — punto
  // único, compartido por la resolución CPU, la del usuario, la Alineación
  // y las noticias. WORLD-CLEANUP-1 (DESIGN.md 10.21, sección 9 del
  // prompt): el descriptor canónico (`BM.describeCompetitionContext()`)
  // sustituye a los antiguos mapas fijos de traducción de fase de la UI
  // (retirados) — nombres y `rulesPhaseId` vienen SIEMPRE del catálogo/
  // Stage reales, nunca de un mapa fijo aquí. La detección de bracket usa
  // `stageType`, no una clave de UI.
  function describeMatchDescriptor(descriptor) {
    const ctx = BM.describeCompetitionContext(state.world.registries, descriptor.stageId);
    if (!ctx.rulesPhaseId) {
      throw new Error(`describeMatchDescriptor: el stage "${descriptor.stageId}" no declara "rulesPhaseId".`);
    }
    const isBracket = ctx.stageType !== 'round-robin';
    return {
      descriptor,
      isBracket,
      phaseId: ctx.rulesPhaseId,
      roundId: isBracket ? bracketRoundIdForDescriptor(descriptor, ctx.rulesPhaseId) : descriptor.round,
      matchId: descriptor.id,
      stageId: descriptor.stageId,
      stageKey: descriptor.stageKey,
      stageName: ctx.stageName,
      competitionId: descriptor.competitionDefinitionId,
      competitionName: ctx.competitionName,
      competitionShortName: ctx.competitionShortName,
      date: descriptor.scheduledDate,
      scheduledAt: descriptor.scheduledAt,
      homeTeam: state.world.registries.teams.get(descriptor.homeParticipantId) || null,
      awayTeam: state.world.registries.teams.get(descriptor.awayParticipantId) || null,
    };
  }

  // Etiquetas visibles de un partido: nombre CORTO de la competición real y
  // nombre de la fase real, leídos del catálogo de identidad/del Stage —
  // nunca de una lista fija por tipo de bracket.
  function describeMatchLabels(descriptor) {
    const definition = state.world.registries.competitionDefinitions.get(descriptor.competitionDefinitionId);
    const stage = state.world.registries.competitionStages.get(descriptor.stageId);
    const title = definition ? (definition.shortName || definition.name) : descriptor.competitionDefinitionId;
    let roundLabel = stage ? stage.name : descriptor.stageKey;
    if (descriptor.round !== undefined && descriptor.round !== null) {
      roundLabel = `${roundLabel} — jornada ${descriptor.round}`;
    } else if (descriptor.roundIndex !== undefined && descriptor.roundIndex !== null) {
      roundLabel = `${roundLabel} — ronda ${descriptor.roundIndex + 1}`;
      if (descriptor.gameNumber) roundLabel += `, partido ${descriptor.gameNumber}`;
    }
    return { title, roundLabel };
  }

  // Próximo partido PENDIENTE del equipo del usuario en CUALQUIER
  // competición, decidido por FECHA (BUG-WORLDCALENDAR-02: ya no hay
  // prioridad fija por tipo de bracket ni "la división visible"). Consulta
  // PURA sobre el engine: no sincroniza la cola, no materializa partidos y
  // no consume aleatoriedad (invariante 11).
  function peekNextUserMatchDescriptor() {
    if (!state.competitionEngine || !state.userTeamId) return null;
    return state.competitionEngine.listAllPendingMatches().find(
      (d) => d.homeParticipantId === state.userTeamId || d.awayParticipantId === state.userTeamId,
    ) || null;
  }

  // Vista de compatibilidad para las pantallas que antes preguntaban
  // "¿hay un bracket activo?" (Home, Alineación, Entrenamiento): devuelve
  // datos SOLO si el PRÓXIMO partido del usuario, por fecha, es de una
  // eliminatoria. Un cruce CPU-vs-CPU de Copa/playoff nunca aparece aquí.
  function getActiveBracket() {
    const descriptor = peekNextUserMatchDescriptor();
    if (!descriptor) return null;
    const info = describeMatchDescriptor(descriptor);
    if (!info.isBracket) return null;
    const labels = describeMatchLabels(descriptor);
    return {
      title: labels.title,
      roundLabel: labels.roundLabel,
      phaseId: info.phaseId,
      descriptor,
      info,
    };
  }

  // ---------------------------------------------------------------------
  // Fuentes + coordinador de la carrera (dependencias EXPLÍCITAS).
  // ---------------------------------------------------------------------
  function buildWorldCalendarCoordinator() {
    const timeZoneId = state.calendar.defaultTimeZoneId;
    const sources = [
      BM.createCompetitionMatchSource({
        engine: state.competitionEngine,
        timeZoneId,
        resolveMatch: ({ stageId, matchId }) => resolveCpuMatchByDescriptor(stageId, matchId),
      }),
      // WORLD-SIM-1 (DESIGN.md 10.16): hitos agregados "abstract" — hoy
      // siempre vacía (ACB/Primera FEB/Copa son "playable"), pero comparte
      // la MISMA cola cronológica que el resto de fuentes.
      BM.createCompetitionSimulationSource({
        engine: state.competitionEngine,
        timeZoneId,
        resolveMilestone: ({ stageId, milestoneId }) => resolveAbstractMilestoneEvent(stageId, milestoneId),
      }),
    ];
    if (state.marketRegistry) {
      sources.push(BM.createMarketEventSource({
        marketRegistry: state.marketRegistry, timeZoneId, resolveEvent: resolveMarketScheduledEvent,
      }));
    }
    if (state.transferRegistry) {
      sources.push(BM.createTransferEventSource({
        transferRegistry: state.transferRegistry, timeZoneId, resolveCase: resolveScheduledTransferCase,
      }));
    }
    if (state.loanRegistry) {
      sources.push(BM.createLoanEventSource({
        loanRegistry: state.loanRegistry, timeZoneId, resolveReturn: resolveLoanReturn,
      }));
    }
    return new BM.WorldCalendarCoordinator({
      calendar: state.calendar,
      sources,
      controlledTeamIds: state.userTeamId ? [state.userTeamId] : [],
      controlledClubIds: state.userClubId ? [state.userClubId] : [],
      onClockAdvanced: applyClockAdvanceHook,
    });
  }

  // ---------------------------------------------------------------------
  // Commit UNIFICADO de un partido calendarizado (sección 12 del prompt).
  // CPU: construye las alineaciones con el contexto REAL y resuelve el
  // descriptor exacto vía `CompetitionEngine.resolveMatch()`. Usuario: el
  // resultado ya calculado entra como `precomputedResult` en ESE MISMO
  // descriptor. Los efectos posteriores (recuperación, evidencia de último
  // partido, carrera, noticias, activaciones) SIEMPRE después del commit.
  // ---------------------------------------------------------------------
  function resolveMatchDescriptor(stageId, matchId, { precomputedResult } = {}) {
    const runner = state.competitionEngine.getRunner(stageId);
    if (!runner) throw new Error(`resolveMatchDescriptor: no hay runner activo para el stage "${stageId}".`);
    const descriptor = typeof runner.getMatchById === 'function'
      ? runner.getMatchById(matchId)
      : runner.getPendingMatches().find((d) => d.id === matchId);
    if (!descriptor) throw new Error(`resolveMatchDescriptor: partido desconocido "${matchId}" en "${stageId}".`);
    const info = describeMatchDescriptor(descriptor);
    if (!info.homeTeam || !info.awayTeam) {
      throw new Error(`resolveMatchDescriptor: el partido "${matchId}" referencia equipos no resolubles en el mundo.`);
    }
    const options = buildMatchEngineOptionsForDescriptor(info, { precomputedResult });
    state.competitionEngine.resolveMatch(stageId, matchId, {
      matchEngineConfig: BM.CONFIG_BASE, matchEngineOptions: options,
    });
    applyPostMatchEffects(info);
    return info;
  }

  function resolveCpuMatchByDescriptor(stageId, matchId) {
    return resolveMatchDescriptor(stageId, matchId, {});
  }

  // WORLD-SIM-1 (DESIGN.md 10.16, sección 13 del prompt) — commit de un
  // hito agregado "abstract": actualiza resumen de fase/Stage/Edition y
  // receipt (vía el engine) y publica SOLO activaciones de
  // fase/pathway ya reales — NUNCA una noticia de partido que jamás
  // existió (invariante: honestidad del resultado). Hoy sin call-sites
  // reales (ACB/Primera FEB/Copa son "playable").
  function resolveAbstractMilestoneEvent(stageId, milestoneId) {
    state.competitionEngine.resolveAbstractMilestone(stageId, milestoneId, {
      now: { instant: state.calendar.currentInstant },
    });
    const activationEvents = drainCompetitionActivationEvents();
    publishActivationNews(activationEvents);
  }

  // Efectos posteriores a un commit REAL: recuperación de Energía,
  // evidencia de último partido oficial, noticias y activaciones de
  // fase/edición que el engine acaba de producir. Nunca antes del commit.
  function applyPostMatchEffects(info) {
    const { descriptor } = info;
    applyRecoveryForResolvedMatch(info.homeTeam, info.awayTeam, descriptor.result, descriptor.scheduledDate, info);
    pushMatchNewsAfterCommit(info);
    const activationEvents = drainCompetitionActivationEvents();
    publishActivationNews(activationEvents);
  }

  // Noticias de un partido ya resuelto — se publican SOLO si el partido
  // es RELEVANTE para el usuario (su propio equipo, o su propia
  // competición), conservando la política de relevancia de CAL-2: nunca un
  // feed de todos los resultados mundiales.
  function pushMatchNewsAfterCommit(info) {
    const { descriptor, isBracket } = info;
    const involvesUser = descriptor.homeParticipantId === state.userTeamId || descriptor.awayParticipantId === state.userTeamId;
    const userCompetitionId = state.userTeamId ? userLeagueCompetitionId() : null;
    const relevant = involvesUser
      || descriptor.competitionDefinitionId === userCompetitionId
      // WORLD-UI-1 (BUG-WORLDUI-04): "¿el usuario compite en ACB?" se
      // decide por su competición REAL, nunca por `state.division`.
      || (isBracket && descriptor.competitionDefinitionId === BM.CompetitionCatalog.COMPETITION_IDS.COPA_ACB
        && userCompetitionId === BM.CompetitionCatalog.COMPETITION_IDS.ACB);
    if (!relevant) return;
    const normalized = {
      homeTeam: info.homeTeam, awayTeam: info.awayTeam, date: descriptor.scheduledDate, result: descriptor.result, status: 'played',
    };
    // WORLD-CLEANUP-1 (DESIGN.md 10.21): el texto visible usa el nombre REAL
    // de la fase/Stage — nunca una tabla fija de UI por tipo de bracket. Un
    // partido de liga no lleva prefijo (mismo criterio que antes).
    const competitionLabel = isBracket ? (info.stageName || info.competitionShortName) : null;
    const opts = { userTeamId: state.userTeamId, relatedCompetition: info.competitionId, competitionLabel };
    pushNews(BM.buildResultNewsEvent(normalized, opts));
    pushNews(BM.buildBigPerformanceNewsEvents(normalized, BM.CONFIG_BASE, opts));
    pushMedicalMatchEvents(info.homeTeam, info.awayTeam, descriptor.result, info.competitionId);
    if (!isBracket) {
      const league = getLeagueForTeam(info.homeTeam);
      const userTeam = getUserTeam();
      if (league && userTeam && involvesUser) {
        pushNews(BM.buildStreakNewsEvent(league.schedule, userTeam, BM.CONFIG_BASE, opts));
      }
    }
  }

  // Noticia de creación de bracket (Copa) / ronda alcanzada — publicada
  // DESPUÉS del commit que la activó, nunca antes. WORLD-CLEANUP-1
  // (DESIGN.md 10.21): nombres/relación de competición SIEMPRE del catálogo
  // real (`CompetitionDefinition`) — nunca los antiguos mapas fijos de la
  // UI (retirados). La detección de "es liga" usa `stageType`, no una clave
  // de UI.
  function publishActivationNews(events) {
    events.forEach((event) => {
      if (event.type === 'edition-activated' && event.competitionDefinitionId === BM.CompetitionCatalog.COMPETITION_IDS.COPA_ACB) {
        // WORLD-HARDEN-1 (DESIGN.md 10.19): facade directa por competición
        // real — nunca `getBrackets('1ª')` (retirado de la ruta productiva).
        const cup = buildBracketFacadeForStageKey(BM.CompetitionCatalog.COMPETITION_IDS.COPA_ACB, buildCareerSeasonKey(), 'knockout');
        if (!cup) return;
        const qualified = cup.rounds[0].flatMap((s) => [s.betterEntry.team, s.worseEntry.team]);
        pushNews(BM.buildBracketCreatedNewsEvent(qualified, {
          competitionLabel: competitionDisplayName(event.competitionDefinitionId),
          relatedCompetition: event.competitionDefinitionId,
          userTeamId: state.userTeamId,
          dateTime: state.calendar.currentGameDateTime,
        }));
        return;
      }
      if (event.type !== 'stage-activated') return;
      const stage = state.world.registries.competitionStages.get(event.stageId);
      const involvesUser = state.world.registries.competitionEntries.forStage(event.stageId)
        .some((entry) => entry.participantId === state.userTeamId);
      if (!stage || !involvesUser) return;
      if (stage.stageType === 'round-robin') return;
      const edition = state.world.registries.competitionEditions.get(event.editionId);
      const competitionId = edition ? edition.competitionDefinitionId : null;
      pushNews(BM.buildBracketRoundReachedNewsEvent(stage.name, {
        competitionLabel: competitionId ? competitionDisplayName(competitionId) : null,
        relatedCompetition: competitionId,
        dateTime: state.calendar.currentGameDateTime,
        involvesUser: true,
      }));
    });
  }

  // ---------------------------------------------------------------------
  // "Continuar": ÚNICA ruta productiva de avance. Delega por completo en
  // el coordinador temporal — no queda ningún camino paralelo que resuelva
  // "una jornada" ni que drene un bracket.
  // ---------------------------------------------------------------------
  function advanceWorldUntilNextUserStop() {
    state.seasonCloseSummary = null;
    const stop = state.calendarCoordinator.advanceUntilNextUserStop();
    state.pendingStop = stop;
    return stop;
  }

  // Tras el commit del partido del usuario: se resuelven los CPU-vs-CPU
  // del MISMO instante (invariante 15: no se revelan antes) y se retira su
  // propio item de la cola.
  function finishUserMatchCommit(item) {
    if (item) state.calendarCoordinator.completeUserItem(item.id);
    if (item) state.calendarCoordinator.resolveSimultaneousAfterUserCommit(item.orderingInstant);
    state.calendarCoordinator.sync();
    state.pendingStop = null;
  }

  // WORLD-UI-1 (DESIGN.md 10.18, sección 7.3 del prompt): la condición de
  // cierre de temporada ya NO pregunta "¿han terminado 1ª y 2ª?" — se
  // deriva de las Editions `active-runtime` de club de la temporada
  // seleccionada (ACB/Primera FEB, cualesquiera que sean sus
  // `competitionDefinitionId` reales) y su estado real, nunca de un mapa
  // fijo de dos divisiones.
  function activeClubLeagueCompetitionIds() {
    return state.world.registries.competitionDefinitions.all()
      .filter((definition) => definition.participantType === 'club-team'
        && definition.implementationStatus === 'active-runtime' && definition.kind === 'league')
      .map((definition) => definition.id);
  }

  // ¿Ha terminado esta competición de LIGA del todo (liga regular + TODOS
  // sus brackets asociados)? — DESIGN.md 3.4.2. Los brackets de Copa/
  // playoff por el título/playoff de ascenso siguen siendo estructura
  // ESPAÑOLA conocida (ACB siempre lleva Copa+playoff por el título,
  // Primera FEB siempre lleva playoff de ascenso) — literal permitido en
  // esta capa (CLAUDE.md: "game.js es la ÚNICA capa que conoce ACB/Primera
  // FEB/Copa como literales"), nunca decidido por `state.division`.
  function isCompetitionFullyDone(competitionId) {
    const seasonKey = buildCareerSeasonKey();
    const league = buildLeagueFacadeForCompetition(competitionId, seasonKey);
    if (!league || !league.isSeasonComplete) return false;
    if (competitionId === BM.CompetitionCatalog.COMPETITION_IDS.ACB) {
      const cup = buildBracketFacadeForStageKey(BM.CompetitionCatalog.COMPETITION_IDS.COPA_ACB, seasonKey, 'knockout');
      const titlePlayoff = buildBracketFacadeForStageKey(competitionId, seasonKey, 'title-playoff');
      return !!(cup && cup.isComplete && titlePlayoff && titlePlayoff.isComplete);
    }
    if (competitionId === BM.CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB) {
      const promotionPlayoff = buildPromotionPlayoffCompatView(competitionId, seasonKey);
      return !!(promotionPlayoff && promotionPlayoff.isComplete);
    }
    return true;
  }

  function isSeasonFullyClosable() {
    return activeClubLeagueCompetitionIds().every((competitionId) => isCompetitionFullyDone(competitionId));
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
  // =====================================================================
  // CYCLE-1 (DESIGN.md 9.22) — cierre de temporada = CICLO ANUAL completo
  // =====================================================================
  // Antes de CYCLE-1 esta función era un monolito que aplicaba ascensos,
  // expiraba/re-sembraba inscripciones y generaba 3 canteranos por club de
  // golpe (`Team.generateAcademyIntake(3)`). Ese atajo desaparece: ahora
  // ejecuta el CICLO ANUAL real (las fases de `AnnualCycleService`), y el
  // cierre DEPORTIVO (ascensos/descensos/honores/histórico) vive en
  // `SeasonHistoryService`, compartido con los scripts de humo — la interfaz
  // no reimplementa ninguna regla.
  //
  // Ninguna regla de juego nueva se decide aquí: la interfaz solo aporta el
  // rol táctico real de cada jugador para el histórico (`rolesSnapshotFor`) y
  // publica noticias DESPUÉS de cada commit real.
  // WORLD-HARDEN-1 (DESIGN.md 10.19, sección 5 del prompt): descubre el
  // ÚNICO transition group LISTO de la temporada que termina, leyendo los
  // `pathwayBindingIds` YA CONGELADOS en sus Editions (nunca
  // `SPAIN_PATHWAY_IDS.DOMESTIC_CLUB`/`SPAIN_DOMESTIC_TRANSITION_GROUP_ID`
  // sueltos) — el mismo resultado de siempre (hoy solo existe un pathway
  // doméstico con un único transition group), pero derivado de datos
  // congelados en vez de un literal de España. Ante cero o más de un grupo
  // listo, bloquea con diagnóstico — nunca asume "el de España".
  function discoverReadyTransitionGroup(seasonKey) {
    const editions = state.world.registries.competitionEditions.forSeason(seasonKey);
    const pathwayIds = new Set();
    editions.forEach((edition) => (edition.pathwayBindingIds || []).forEach((id) => pathwayIds.add(id)));
    const candidates = [];
    [...pathwayIds].sort().forEach((pathwayId) => {
      const definition = BM.requirePathwayDefinition(pathwayId);
      Object.keys(definition.transitionGroups).sort().forEach((groupId) => {
        const readiness = state.pathwayService.isTransitionGroupReady(pathwayId, groupId, { sourceSeasonKey: seasonKey });
        if (readiness.ready) candidates.push({ pathwayId, groupId });
      });
    });
    if (candidates.length === 0) {
      throw new Error(`discoverReadyTransitionGroup: ningún transition group listo para cerrar la temporada "${seasonKey}".`);
    }
    if (candidates.length > 1) {
      throw new Error(
        `discoverReadyTransitionGroup: ${candidates.length} transition groups listos a la vez para la temporada `
        + `"${seasonKey}" (${candidates.map((c) => `${c.pathwayId}:${c.groupId}`).join(', ')}) — el llamador debe `
        + 'desambiguar, nunca se elige el primero.',
      );
    }
    return candidates[0];
  }

  function closeSeasonAndPrepareNext() {
    const {
      CONFIG_BASE, recalculateSportingGoalsForCohort,
      SeasonHistoryService, AnnualCycleService, WorldLifecycleService, CycleConfig,
    } = BM;

    // PATHWAYS-1 (DESIGN.md 10.15): `leagueB`/`bracketsA` sobreviven SOLO
    // para leer honores YA decididos por el motor (campeón regular de
    // Primera FEB, campeón de Copa/playoff por el título) — la
    // clasificación a Copa/playoff/ascenso y los ascensos/descensos reales
    // YA NO se leen de estas vistas legacy (BUG-PATHWAYS-01/03/04): los
    // decide `state.pathwayService`. WORLD-HARDEN-1 (DESIGN.md 10.19):
    // resueltas con los ids de competición REALES directamente (permitido
    // en esta capa, CLAUDE.md), nunca con `getLeague('2ª')`/`getBrackets('1ª')`
    // (retirados de la ruta productiva).
    const preCloseSeasonKey = buildCareerSeasonKey();
    const leagueB = buildLeagueFacadeForCompetition(BM.CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, preCloseSeasonKey);
    const bracketsA = {
      cup: buildBracketFacadeForStageKey(BM.CompetitionCatalog.COMPETITION_IDS.COPA_ACB, preCloseSeasonKey, 'knockout'),
      titlePlayoff: buildBracketFacadeForStageKey(BM.CompetitionCatalog.COMPETITION_IDS.ACB, preCloseSeasonKey, 'title-playoff'),
    };
    // CAL-2: instante real de cierre, capturado ANTES de sustituir
    // `state.calendar` por el de la temporada siguiente.
    const seasonEndDateTime = state.calendar.currentGameDateTime;
    const seasonEndIso = state.calendar.currentLocalDate;
    const fromSeasonKey = buildCareerSeasonKey();
    const targetSeasonKey = BM.seasonKeyFromStartYear(state.seasonStartYear + 1);
    // WORLD-CORE-1 (sección 8.5 del prompt): mismas instancias que
    // `getAllTeams()` — desde el World Registry, no desde una lista fija de
    // clubes españoles. WORLD-SIM-1 (BUG-WORLDSIM-06): el ciclo anual solo
    // procesa el cohorte INTERACTIVO — hoy son los mismos 36 equipos.
    const teams = interactiveCohortTeams();

    // Sin evidencia de último partido oficial de CADA club no se abre el
    // ciclo — nunca se inventa una fecha común. Si faltara algún club (una
    // competición no jugada), se declara y se aborta con un aviso visible en
    // vez de continuar con un dato falso.
    const missing = state.lastOfficialMatchEvidence
      ? state.lastOfficialMatchEvidence.missingTeamIds(teams) : teams.map((team) => team.id);
    if (missing.length) {
      state.cycleWarnings = [
        `No se puede abrir el ciclo anual: ${missing.length} equipo(s) sin evidencia de último partido oficial `
        + `(${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}). El verano abre los plazos desde la `
        + 'fecha REAL de cierre de cada club, nunca desde una fecha inventada.',
      ];
      goToScreen('cycle');
      return;
    }

    // Confirma el transition group listo (hoy: el doméstico ACB<->Primera
    // FEB, descubierto arriba desde los `pathwayBindingIds` congelados —
    // WORLD-HARDEN-1, nunca `SPAIN_PATHWAY_IDS.DOMESTIC_CLUB`/
    // `SPAIN_DOMESTIC_TRANSITION_GROUP_ID` sueltos): receipt canónico,
    // Editions/Stages/Entries de `targetSeasonKey` creadas de forma
    // ATÓMICA (18+18, sin duplicados/ausencias) — el pathway CONSTRUYE y
    // VALIDA la composición de la temporada siguiente (WORLD-CLEANUP-1,
    // DESIGN.md 10.21: ya no hay ninguna proyección de división que hacer
    // "después" — la composición real vive SOLO en las Entries).
    state.competitionEngine.setDateResolverProvider(buildCompetitionDateResolverProvider());
    const readyGroup = discoverReadyTransitionGroup(fromSeasonKey);
    const { receipt: transitionReceipt } = state.pathwayService.applyTransitionGroup(
      readyGroup.pathwayId,
      readyGroup.groupId,
      { fromSeasonKey, targetSeasonKey },
    );
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const { promotedTeams, relegatedTeams } = SeasonHistoryService.deriveSeasonMovesFromTransitionReceipt(
      transitionReceipt, teamsById,
    );

    const { cycle } = AnnualCycleService.openCycle({
      annualCycleRegistry: state.annualCycleRegistry,
      teams,
      fromSeasonKey,
      targetSeasonKey,
      evidence: state.lastOfficialMatchEvidence.toArray(),
      date: seasonEndIso,
      playerRegistry: state.playerRegistry,
      contractRegistry: state.contractRegistry,
      // WORLD-CONTEXT-1: la instantánea competitiva de APERTURA se resuelve
      // con las Entries de la temporada que TERMINA.
      competitionIdForTeam: buildDomesticCompetitionResolver('openCycle'),
    });
    state.annualCycle = cycle;

    const summary = { promoted: [], relegated: [], userPrimaryCompetitionId: null };
    const hooks = {
      // Cierre DEPORTIVO: honores + histórico de carrera, ahora en
      // `SeasonHistoryService` (compartido con los smokes) — los
      // ascensos/descensos ya llegan RESUELTOS por el pathway (arriba),
      // este hook ya NUNCA los recalcula ni muta ninguna división.
      closeSeasonHistory() {
        const honoursByTeamId = SeasonHistoryService.buildSeasonHonoursByTeamId({
          leagueB, cup: bracketsA.cup, titlePlayoff: bracketsA.titlePlayoff, promotedTeams,
        });
        // LIFE-1: el desarrollo mundial se procesa hasta el instante exacto
        // de cierre ANTES de cerrar el histórico y ANTES de cualquier alta de
        // cantera del ciclo — un newgen nunca recibe progreso retroactivo.
        WorldLifecycleService.processWorldToDate({
          playerRegistry: state.playerRegistry,
          teams,
          annualCycleRegistry: state.annualCycleRegistry,
          academyRegistry: state.academyRegistry,
        }, seasonEndDateTime, CONFIG_BASE, { seasonStartDate: state.calendar.seasonStartDate });
        SeasonHistoryService.closeCareerHistories({
          teams,
          honoursByTeamId,
          seasonEndDateTime,
          nextSeasonKey: targetSeasonKey,
          config: CONFIG_BASE,
          rolesSnapshotFor: (player, team) => buildRolesSnapshotForPlayer(player, team),
        });
        // WORLD-CLEANUP-1 (DESIGN.md 10.21): cohortes agrupados por Entries
        // REALES de la temporada de DESTINO (competitionDefinitionId) — el
        // pathway ya comprometió la composición real de `targetSeasonKey`
        // arriba, nunca `team.division` (retirado de la entidad).
        const teamsByCompetitionId = new Map();
        teams.forEach((team) => {
          const competitionId = domesticCompetitionIdForTeam(team, targetSeasonKey, 'season-goals');
          if (!teamsByCompetitionId.has(competitionId)) teamsByCompetitionId.set(competitionId, []);
          teamsByCompetitionId.get(competitionId).push(team);
        });
        [...teamsByCompetitionId.values()].forEach((cohort) => {
          recalculateSportingGoalsForCohort(cohort, CONFIG_BASE);
        });
        summary.promoted = promotedTeams.map((team) => team.fullName);
        summary.relegated = relegatedTeams.map((team) => team.fullName);
        // CAL-2 (DESIGN.md 3.5): noticias de ascenso/descenso — reutiliza los
        // MISMOS Team ya resueltos, nunca recalculados aparte.
        pushNews(BM.buildPromotionRelegationNewsEvents(promotedTeams, relegatedTeams, {
          userTeamId: state.userTeamId, dateTime: seasonEndDateTime,
        }));
        return summary;
      },
    };

    // Las fases del verano, cada una en SU fecha programada (el ciclo decide
    // las fechas desde la evidencia real; la interfaz no las inventa).
    const phaseResults = [];
    const notReadyClubs = [];
    let aborted = null;
    CycleConfig.CYCLE_PHASES.slice(1).forEach((phaseId) => {
      if (aborted) return;
      const phaseDate = phaseId === 'new-season-started'
        ? cycle.scheduledDateForPhase('preseason-ready')
        : cycle.scheduledDateForPhase(phaseId);
      // WORLD-CALENDAR-1 (DESIGN.md 10.14, sección 13): cada fase YA
      // FECHADA del ciclo avanza el CURSOR COMÚN antes de ejecutar su hook
      // — el mismo `WorldCalendar` atraviesa el verano, no se crea otro
      // reloj ni se exponen las fases una a una en la interfaz (eso no
      // entra en esta entrega). El cursor nunca retrocede.
      advanceWorldClockToLocalDate(phaseDate);
      const result = AnnualCycleService.runPhase(buildCycleParams({
        // Sección 15 del prompt de CYCLE-1: el club del usuario NUNCA recibe
        // una medida de emergencia automática — solo tras una acción
        // explícita ("Delegar medidas de emergencia" en Planificación). Si
        // el club queda `not-ready` por esto, el aborto de más abajo lo
        // redirige a esa pantalla en vez de decidir por él.
        cycle,
        phaseId,
        date: phaseDate,
        targetSeasonKey,
        hooks,
        delegateEmergencyForUserClub: false,
        // PATHWAYS-1 (BUG-PATHWAYS-04): el ciclo anual recibe la competición
        // de destino desde la membership YA comprometida (`CompetitionEntry`
        // real de `targetSeasonKey`) — nunca de una traducción de
        // `team.division` (ver `AnnualCycleService.closeSeasonHistory()`).
        targetCompetitionIdForTeam: (team) => BM.CompetitionParticipationService.primaryLeagueCompetitionId(
          state.world.registries, team.id, { seasonKey: targetSeasonKey },
        ),
      }));
      phaseResults.push({ phaseId, date: phaseDate, result });
      if (result && result.ready === false) {
        aborted = phaseId;
        (result.audit && result.audit.notReady ? result.audit.notReady : []).forEach((entry) => notReadyClubs.push(entry));
      }
    });

    state.cycleLastTransition = {
      fromSeasonKey, targetSeasonKey, phaseResults, notReadyClubs, aborted,
    };
    if (aborted) {
      state.cycleWarnings = [
        `El ciclo anual se detuvo en la fase "${aborted}": ${notReadyClubs.length} club(es) no pueden construir una `
        + 'convocatoria legal. Ninguna temporada empieza con un club ilegal — revisa "Planificación".',
      ];
      goToScreen('cycle');
      return;
    }
    state.cycleWarnings = [];

    // CONTRACT-1: la nómina proyectada de los 36 clubes se recalcula para la
    // temporada que entra, siempre desde el registro contractual.
    refreshAllSalaryProjections(targetSeasonKey);

    // WORLD-CALENDAR-1 (DESIGN.md 10.14, invariante 3): NO se crea ningún
    // calendario nuevo — el MISMO `WorldCalendar` de la carrera registra la
    // temporada siguiente (su instante de inicio debe ser posterior al de
    // la anterior, el propio agregado lo valida) y el cursor no se
    // reinicia. Antes de esta entrega, `closeSeasonAndPrepareNext()`
    // sustituía `state.calendar` por otra instancia de `Calendar`, así que
    // el reloj de carrera "empezaba de cero" cada verano.
    state.seasonStartYear += 1;
    // WORLD-HARDEN-1 (DESIGN.md 10.19, sección 5 del prompt): el schedule
    // que fija el arranque de la temporada siguiente se lee del
    // `scheduleProfileId` YA CONGELADO en la Edition de Liga principal real
    // (recién creada, arriba, por `applyTransitionGroup()`) — nunca de
    // `SPAIN_SCHEDULE_IDS.ACB` suelto. Mismo criterio y mismo resultado que
    // antes (la Liga principal es quien fija el arranque de temporada).
    const nextMainLeagueEdition = state.world.registries.competitionEditions.require(
      BM.buildEditionId(BM.CompetitionCatalog.COMPETITION_IDS.ACB, targetSeasonKey),
    );
    const nextCareerSchedule = BM.CompetitionScheduleCatalog.requireSchedule(nextMainLeagueEdition.scheduleProfileId);
    const nextSeasonStartInstant = state.scheduleService.seasonStartInstant(nextCareerSchedule, state.seasonStartYear);
    const nextSeasonWindowStartInstant = state.scheduleService.seasonWindowStartInstant(nextCareerSchedule, state.seasonStartYear);
    // Unión de los `competitionSchedules` de los paquetes YA instalados —
    // mismo criterio genérico que ya usa `startCareerFromSetup()`, nunca
    // `SPAIN_SCHEDULE_IDS` sueltos.
    const nextSeasonScheduleIds = BM.ContentPackLifecycleService.unionScheduleIds(state.installedContentPacks);
    state.calendar.registerSeason({
      seasonKey: targetSeasonKey,
      startInstant: nextSeasonStartInstant,
      timeZoneId: state.calendar.defaultTimeZoneId,
      scheduleIds: nextSeasonScheduleIds,
    });
    // El índice operativo no debe convertirse en otro histórico infinito de
    // partidos: los resultados/históricos/noticias ya viven en sus fuentes.
    state.calendar.retireLedger();

    // PATHWAYS-1 (DESIGN.md 10.15, BUG-PATHWAYS-03/04): las Editions/Stages/
    // Entries de `targetSeasonKey` (ACB + Primera FEB, 18+18) YA quedaron
    // creadas y con su runtime inicializado al confirmar el transition group
    // más arriba (`state.pathwayService.applyTransitionGroup()` ->
    // `CompetitionEngine.activateEditionFromDecision()`) — `game.js` ya NO
    // reconstruye la composición de la temporada siguiente aquí ni vuelve a
    // llamar a `bindNewSeasonEditions()`/`buildSeasonActivationPlan()` (sin
    // call-sites productivos desde esta entrega).
    // El cursor entra en la temporada nueva por su instante de arranque
    // (siempre hacia adelante) y las fuentes se resincronizan sobre la
    // MISMA instancia de calendario.
    advanceWorldClockToInstant(nextSeasonWindowStartInstant);
    state.calendarCoordinator.sync();
    state.pendingStop = null;
    refreshActiveCompetitionIdsForUser();

    // La evidencia de último partido oficial se reinicia para la temporada
    // que empieza — la del verano ya consumido queda en el ciclo cerrado.
    state.lastOfficialMatchEvidence = new SeasonHistoryService.LastOfficialMatchEvidenceCollector();
    state.annualCycle = null;

    // state.userTeamId NO cambia; el resumen de cierre resuelve la
    // competición REAL de destino del equipo del usuario por Entries
    // (WORLD-CLEANUP-1, DESIGN.md 10.21) — `state.division`/`team.division`
    // quedan RETIRADOS.
    const userTeam = teams.find((team) => team.id === state.userTeamId);
    summary.userPrimaryCompetitionId = userTeam
      ? domesticCompetitionIdForTeam(userTeam, targetSeasonKey, 'season-close-summary') : null;

    state.lastRoundMatches = null;
    state.pendingUserMatch = null;
    state.matchReveal = null;
    state.agendaAnchorDate = null;
    state.seasonCloseSummary = summary;

    // SAVE-LOAD-1 (checkpoint 3/3): autoguardado tras el cierre/preparación
    // de temporada — el runtime ya está en una frontera estable (nuevo
    // ciclo/ediciones registrados, ningún partido pendiente de commit).
    autoSaveCareer();
    goToScreen('home');
  }

  // WORLD-CALENDAR-1 (DESIGN.md 10.14): `findSeriesForGame()` y
  // `playBracketGameWithReveal()` han desaparecido. Un partido de
  // eliminatoria del usuario ya NO se juega llamando a
  // `bracket.playNextGame()` sobre "el bracket que estaba abierto" (eso
  // resolvía el primer cruce pendiente del array, participase o no su
  // equipo — BUG-WORLDCALENDAR-02): se resuelve por `stageId`/`matchId`
  // REAL del descriptor que la cola mundial devolvió como parada, con el
  // mismo reveal por cuartos de antes (ver `playUserBracketMatchWithReveal`).

  // ---------------------------------------------------------------------
  // Pantalla: inicio (Home)
  // ---------------------------------------------------------------------
  // WORLD-CORE-1 (sección 9 del prompt): bloque técnico discreto (plegado
  // por defecto) con los paquetes instalados y la jerarquía geográfica —
  // España deja de ser el alcance del motor y pasa a ser el primer
  // contenido instalado sobre `GameWorld`. Solo lectura de
  // `state.world.describe()` — nunca muta el mundo.
  function buildWorldDetailHtml() {
    if (!state.world) return '';
    const snapshot = state.world.describe();
    const areaName = (id) => {
      const area = snapshot.areas.find((a) => a.id === id);
      return area ? area.name : id;
    };
    const geographyLine = snapshot.areas
      .filter((a) => a.type !== 'world')
      .sort((a, b) => (a.type === b.type ? 0 : a.type === 'continent' ? -1 : 1))
      .map((a) => (a.type === 'continent' ? a.name : `${areaName(a.parentAreaId)} › ${a.name}`))
      .filter((label, index, arr) => arr.indexOf(label) === index)
      .join(', ');
    const packsLine = snapshot.packs.map((p) => `${p.name} (${p.version})`).join(', ');
    return `
      <details class="gm-card gm-world-detail">
        <summary>Mundo de la carrera</summary>
        <p class="gm-muted">Paquetes instalados: ${escapeHtml(packsLine)}</p>
        <p class="gm-muted">Geografía: Mundo › ${escapeHtml(geographyLine)}</p>
        <p class="gm-muted">${snapshot.clubs.length} clubes · ${snapshot.competitionDefinitions.length} competiciones registradas</p>
      </details>`;
  }

  // CLUB-CORE-1 (DESIGN.md sección 10, apartado 11 del prompt) — vertical
  // visible mínima, de solo lectura: nombre institucional, primer equipo
  // controlado, equipos/secciones registrados, squad activo, pool de
  // academia (si ya está inicializado) y jurisdicción/afiliación con
  // etiquetas comprensibles. Nunca ids técnicos como información
  // principal (van en el `<details>` plegado); nunca inventa filial/
  // cantera competitiva donde no existe (el paquete español actual solo
  // registra el primer equipo — ver `data/world/spain-2026.1.js`).
  const TEAM_ROLE_LABELS = {
    'first-team': 'Primer equipo',
    reserve: 'Filial/reserva',
    youth: 'Juvenil',
    other: 'Otra sección',
  };

  function buildClubStructureHtml(team) {
    if (!state.world || !team.club) return '';
    const club = team.club;
    const registries = state.world.registries;
    const teamsOfClub = registries.teams.forClub(club.id);
    const activeSquad = registries.squads.activeForTeam(team.id);
    const jurisdictionArea = registries.areas.get(club.employerJurisdictionAreaId);
    const federationNames = club.federationMembershipOrganizationIds
      .map((orgId) => {
        const org = registries.organizations.get(orgId);
        return org ? org.name : orgId;
      })
      .join(', ');
    const academyCount = state.academyRegistry
      ? state.academyRegistry.activePoolForClub(club.id, currentGameIsoDate()).length
      : null;
    const sectionsHtml = teamsOfClub
      .map((t) => `<li>${escapeHtml(t.fullName)} — ${escapeHtml(TEAM_ROLE_LABELS[t.role] || t.role)}${t.id === team.id ? ' <span class="gm-badge">Controlado</span>' : ''}</li>`)
      .join('');
    return `
      <div class="gm-card gm-club-structure">
        <h3>Club y estructura deportiva</h3>
        <dl class="contract-facts">
          <div><dt>Club</dt><dd>${escapeHtml(club.name)}</dd></div>
          <div><dt>Primer equipo controlado</dt><dd>${escapeHtml(team.fullName)}</dd></div>
          <div><dt>Jurisdicción laboral</dt><dd>${escapeHtml(jurisdictionArea ? jurisdictionArea.name : club.employerJurisdictionAreaId)}</dd></div>
          <div><dt>Afiliación federativa</dt><dd>${escapeHtml(federationNames || '—')}</dd></div>
          <div><dt>Squad activo</dt><dd>${activeSquad ? `${escapeHtml(activeSquad.name)} — ${activeSquad.players.length} jugadores` : 'Sin squad activo'}</dd></div>
          ${academyCount !== null ? `<div><dt>Cantera/Academia</dt><dd>${academyCount} jugador(es) en el pool</dd></div>` : ''}
        </dl>
        <p class="gm-muted">Equipos/secciones registrados para este club (${teamsOfClub.length}):</p>
        <ul>${sectionsHtml}</ul>
        <details class="gm-muted">
          <summary>Detalle técnico</summary>
          <p>clubId: ${escapeHtml(club.id)} · teamId: ${escapeHtml(team.id)} · squadId: ${activeSquad ? escapeHtml(activeSquad.id) : '—'}</p>
        </details>
      </div>`;
  }

  // WORLD-CLEANUP-1 (DESIGN.md 10.21): nombre visible de una competición
  // real, leído SIEMPRE del catálogo de identidad — nunca de un mapa de UI
  // ni de una división legacy.
  function competitionDisplayName(competitionId) {
    const definition = state.world.registries.competitionDefinitions.get(competitionId);
    return definition ? definition.name : competitionId;
  }

  function renderHomeScreen() {
    const container = byId('gm-home');
    const league = getUserLeague();
    const team = getUserTeam();
    // WORLD-UI-1 (DESIGN.md 10.18, BUG-WORLDUI-04): nombre de la liga
    // principal real del club, vía `CompetitionParticipationService` — no
    // `${state.division} División`.
    const userLeagueName = competitionDisplayName(userLeagueCompetitionId());
    const standings = league.getStandingsTable();
    const userRank = standings.findIndex((s) => s.team.id === team.id) + 1;
    const userStanding = standings[userRank - 1];
    // WORLD-CALENDAR-1 (DESIGN.md 10.14): Home muestra el próximo EVENTO
    // QUE REQUIERE AL USUARIO, no "la jornada de su división". El
    // descriptor sale de la cola mundial (por FECHA, con nombre de
    // competición/fase reales), así que Liga y Copa conviven sin ninguna
    // prioridad hardcodeada y un cruce CPU-vs-CPU nunca aparece aquí.
    const nextUserDescriptor = peekNextUserMatchDescriptor();
    const nextUserInfo = nextUserDescriptor ? describeMatchDescriptor(nextUserDescriptor) : null;
    const nextUserLabels = nextUserDescriptor ? describeMatchLabels(nextUserDescriptor) : null;

    // CAL-2 (DESIGN.md 3.5): "Última jornada" (CAL-1) se sustituye aquí por
    // el resumen de Noticias de alta prioridad — decisión documentada en
    // DESIGN.md: los resultados de la última jornada ya aparecen como
    // noticia de resultado (siempre alta prioridad si involucran al
    // equipo del usuario), así que mantener las dos tarjetas duplicaba la
    // misma información con dos formatos distintos.
    const topNews = [...state.newsLog].filter((e) => e.priority === 'alta').sort((a, b) => b.dateTime - a.dateTime).slice(0, 3);
    const topNewsHtml = topNews.length
      ? topNews.map(newsCardHtml).join('')
      : '<p class="gm-muted">Sin noticias destacadas todavía.</p>';

    const nextMatchHtml = nextUserInfo
      ? `<p>${matchLabel({
        homeTeam: nextUserInfo.homeTeam, awayTeam: nextUserInfo.awayTeam, status: 'pending',
      }, team.id)} <span class="gm-muted">— ${formatMatchDateTime(nextUserDescriptor.scheduledDate)}</span></p>`
      : '<p class="gm-muted">No queda ningún partido pendiente de tu equipo.</p>';

    // DESIGN.md 3.4.2/3.4: cuando las DOS divisiones han terminado su liga
    // regular y TODOS sus brackets, la tarjeta principal se convierte en
    // el aviso de cierre de ciclo.
    const seasonReadyToClose = isSeasonFullyClosable();

    // MARKET-1 (DESIGN.md 9.19): una decisión de mercado con plazo antes
    // del siguiente partido manda incluso sobre el cierre de temporada —
    // la cola mundial ya la ordena antes (una fecha civil se ordena al
    // inicio de su día, así que bloquea antes del partido de ese día).
    const marketAttention = getMarketAttentionForUser();
    const marketAttentionLabel = marketAttention && marketAttention.type === 'matching-decision-needed'
      ? 'Decidir tanteo' : 'Responder negociación';

    // WORLD-CALENDAR-1: dos partidos del MISMO equipo controlado en el
    // MISMO instante son un CONFLICTO explícito — no se elige por id, no se
    // simula ninguno y "Continuar" queda bloqueado hasta que Dennis decida
    // qué hacer (no se inventa ninguna reprogramación, sección 19 del
    // prompt: solo detección/bloqueo).
    const conflictStop = state.pendingStop && state.pendingStop.type === BM.WORLD_CALENDAR_STOP_TYPES.SCHEDULE_CONFLICT
      ? state.pendingStop : null;
    const failureStop = state.pendingStop && state.pendingStop.type === BM.WORLD_CALENDAR_STOP_TYPES.RESOLUTION_FAILED
      ? state.pendingStop : null;

    const conflictCardHtml = conflictStop
      ? `
        <div class="gm-card">
          <h3>Conflicto de calendario</h3>
          <p class="gm-muted">Tu equipo tiene DOS partidos programados en el mismo instante (${formatMatchDateTime(BM.GameDateTime.toJsDate(conflictStop.instant))}):</p>
          <ul>${conflictStop.items.map((item) => `<li>${escapeHtml(item.metadata.competitionDefinitionId)} · ${escapeHtml(item.metadata.stageKey)} — ${escapeHtml(item.metadata.matchId)}</li>`).join('')}</ul>
          <p class="gm-muted">El juego no elige por ti ni reprograma nada: hace falta una decisión de diseño (aplazamientos/prioridades quedan fuera de esta entrega).</p>
        </div>`
      : '';

    const failureCardHtml = failureStop
      ? `
        <div class="gm-card">
          <h3>Un evento no se pudo resolver</h3>
          <p class="gm-muted">${escapeHtml(failureStop.error || 'error desconocido')}</p>
          <p class="gm-muted">El evento sigue pendiente y el reloj no ha avanzado por encima de él.</p>
        </div>`
      : '';

    const primaryCardHtml = conflictStop
      ? ''
      : marketAttention
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
          : `
        <div class="gm-card">
          <h3>${nextUserLabels ? `${escapeHtml(nextUserLabels.title)} — ${escapeHtml(nextUserLabels.roundLabel)}` : 'Sin partidos pendientes'}</h3>
          ${nextMatchHtml}
          <button id="gm-play-round-btn" class="gm-btn gm-btn--primary">Continuar</button>
          ${nextUserInfo ? '<button id="gm-goto-lineup-btn" class="gm-btn">Configurar alineación</button>' : ''}
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
          ${state.seasonCloseSummary.userPrimaryCompetitionId ? `<p>Tu equipo, ${team.fullName}, juega ahora en <strong>${escapeHtml(competitionDisplayName(state.seasonCloseSummary.userPrimaryCompetitionId))}</strong>.</p>` : ''}
        </div>`
      : '';

    // WORLD-CORE-1 (sección 9 del prompt): detalle técnico DISCRETO — solo
    // para poder verificar el bootstrap del mundo (paquetes instalados,
    // jerarquía Mundo > Europa > España/Andorra). Nunca muta ni consume
    // aleatoriedad; es una lectura de `state.world.describe()`.
    const worldDetailHtml = buildWorldDetailHtml();
    const clubStructureHtml = buildClubStructureHtml(team);

    container.innerHTML = `
      <div class="home-clock">
        <span class="home-clock__label">Hoy</span>
        <span class="home-clock__value">${formatMatchDateTime(state.calendar.currentGameDateTime)}</span>
      </div>
      <div class="home-hero">
        <div class="home-hero__team">
          <span class="home-hero__label">Tu club</span>
          <h2>${team.fullName}</h2>
          <span class="home-hero__division">${escapeHtml(userLeagueName)} <a href="#" id="gm-home-goto-world" class="home-hero__world-link">Ver en Mundo</a></span>
        </div>
        <div class="home-hero__standing">
          <span class="home-hero__rank">${userRank}</span>
          <span class="home-hero__rank-label">posición</span>
          <span class="home-hero__record">${userStanding.wins}V - ${userStanding.losses}D · ${userStanding.points} pts</span>
        </div>
      </div>

      <div class="home-grid">
        ${conflictCardHtml}
        ${failureCardHtml}
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
      ${clubStructureHtml}
      ${worldDetailHtml}
    `;

    const goToMarketBtn = byId('gm-goto-market-btn');
    if (goToMarketBtn) {
      goToMarketBtn.addEventListener('click', () => goToScreen('market'));
    }

    const closeSeasonBtn = byId('gm-close-season-btn');
    if (closeSeasonBtn) {
      closeSeasonBtn.addEventListener('click', () => closeSeasonAndPrepareNext());
    }

    const playBtn = byId('gm-play-round-btn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        // WORLD-CALENDAR-1: un único botón "Continuar" para TODO (Liga,
        // Copa, playoff, o simplemente dejar que el mundo complete de
        // fondo lo pendiente hasta la próxima parada o el cierre de
        // temporada). Antes había dos (`gm-play-round-btn` para la liga y
        // `gm-play-bracket-btn` para "el bracket activo").
        if (nextUserInfo && !getLineupValidity(team).valid) { goToScreen('lineup'); return; }
        playNextMatchWithLineup(team);
      });
    }

    const gotoLineupBtn = byId('gm-goto-lineup-btn');
    if (gotoLineupBtn) {
      gotoLineupBtn.addEventListener('click', () => goToScreen('lineup'));
    }

    byId('gm-goto-agenda-btn').addEventListener('click', () => goToScreen('agenda'));
    byId('gm-goto-news-btn').addEventListener('click', () => goToScreen('news'));
    const gotoWorldLink = byId('gm-home-goto-world');
    if (gotoWorldLink) {
      gotoWorldLink.addEventListener('click', (event) => {
        event.preventDefault();
        focusWorldViewOnCompetition(userLeagueCompetitionId());
        goToScreen('world');
      });
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

  // =======================================================================
  // WORLD-UI-1 (DESIGN.md 10.18) — pantalla Mundo: navegador de solo
  // lectura Mundo → continente → país/territorio → competición, por ids
  // canónicos (`state.worldView`), vía `WorldNavigationService.js`
  // (BUG-WORLDUI-08). Nunca muta el mundo ni consume aleatoriedad.
  // =======================================================================
  function focusWorldViewOnCompetition(competitionDefinitionId) {
    const definition = state.world.registries.competitionDefinitions.get(competitionDefinitionId);
    state.worldView = {
      kind: 'competition',
      areaId: definition ? definition.scopeAreaId : state.worldView.areaId,
      competitionDefinitionId,
      editionId: null,
    };
  }

  function focusWorldViewOnArea(areaId) {
    state.worldView = {
      kind: 'area', areaId, competitionDefinitionId: null, editionId: null,
    };
  }

  function worldOrgListHtml(orgs) {
    if (!orgs.length) return '<p class="gm-muted">Ninguna.</p>';
    return `<ul class="world-list">${orgs.map((o) => `<li>${escapeHtml(o.name)} <span class="gm-muted">(${escapeHtml(o.type)})</span></li>`).join('')}</ul>`;
  }

  function worldResultHtml(result) {
    if (!result || result.kind === 'not-available') return '<p class="gm-muted">Sin resultado disponible todavía.</p>';
    if (result.kind === 'standings' || result.kind === 'standings-compact') {
      const rows = result.standings.slice(0, 8).map((s) => {
        const team = state.world.registries.teams.get(s.participantId);
        const name = team ? (team.fullName || team.name) : s.participantId;
        return `<tr><td>${escapeHtml(name)}</td><td>${s.wins}-${s.losses}</td></tr>`;
      }).join('');
      const compactNote = result.kind === 'standings-compact' ? '<p class="gm-muted">Este nivel no conserva detalle individual (marcador compacto).</p>' : '';
      return `<div class="gm-table-scroll"><table class="gm-table"><tbody>${rows}</tbody></table></div>${compactNote}`;
    }
    const championTeam = result.champion ? state.world.registries.teams.get(result.champion.participantId) : null;
    const championLabel = championTeam ? escapeHtml(championTeam.fullName || championTeam.name) : 'Sin campeón todavía';
    const compactNote = result.kind === 'bracket-compact' ? '<p class="gm-muted">Este nivel no conserva detalle individual (resumen agregado).</p>' : '';
    return `<p class="gm-champion">🏆 ${championLabel}</p>${compactNote}`;
  }

  function renderWorldAreaView(container, areaId) {
    const registries = state.world.registries;
    const breadcrumb = BM.breadcrumbForArea(registries, areaId);
    const children = BM.childrenOfArea(registries, areaId);
    const orgs = BM.organizationsForArea(registries, areaId);
    const clubs = BM.clubsForArea(registries, areaId);
    const competitions = BM.competitionsForArea(registries, areaId);
    const external = BM.externalCompetitionsForAreaClubs(registries, areaId);

    const breadcrumbHtml = breadcrumb.map((a) => `<button type="button" class="world-breadcrumb__btn" data-area-id="${a.areaId}">${escapeHtml(a.name)}</button>`).join(' <span class="gm-muted">›</span> ');
    const childrenHtml = children.length
      ? `<ul class="world-list">${children.map((a) => `<li><button type="button" class="world-list__btn" data-area-id="${a.areaId}">${escapeHtml(a.name)}</button></li>`).join('')}</ul>`
      : '<p class="gm-muted">Sin subáreas registradas.</p>';
    const clubsHtml = clubs.length
      ? `<ul class="world-list">${clubs.map((c) => `<li>${escapeHtml(c.name)} <span class="gm-muted">— ${escapeHtml(c.primaryTeamName || '')}</span></li>`).join('')}</ul>`
      : '<p class="gm-muted">Sin clubes con sede en esta área.</p>';
    const competitionsHtml = competitions.length
      ? `<ul class="world-list">${competitions.map((c) => `<li><button type="button" class="world-list__btn" data-competition-id="${c.competitionDefinitionId}">${escapeHtml(c.name)} <span class="gm-muted">(${escapeHtml(c.implementationStatus)})</span></button></li>`).join('')}</ul>`
      : '<p class="gm-muted">Sin competiciones con ámbito en esta área.</p>';
    const externalHtml = external.map((c) => `
      <li><button type="button" class="world-list__btn" data-competition-id="${c.competitionDefinitionId}">${escapeHtml(c.name)}</button>
      <span class="gm-muted">— participa fuera de su área (${c.localParticipantTeamIds.length} equipo(s) local(es))</span></li>`).join('');

    container.innerHTML = `
      <div class="world-breadcrumb">${breadcrumbHtml}</div>
      <div class="gm-card"><h3>Subáreas</h3>${childrenHtml}</div>
      <div class="gm-card">
        <h3>Organizaciones</h3>
        <h4>Con sede aquí</h4>${worldOrgListHtml(orgs.headquartered)}
        <h4>Con ámbito aquí</h4>${worldOrgListHtml(orgs.scoped)}
      </div>
      <div class="gm-card"><h3>Clubes</h3>${clubsHtml}</div>
      <div class="gm-card"><h3>Competiciones</h3>${competitionsHtml}</div>
      ${external.length ? `<div class="gm-card"><h3>Participa fuera de su área</h3><ul class="world-list">${externalHtml}</ul></div>` : ''}
    `;

    container.querySelectorAll('[data-area-id]').forEach((btn) => {
      btn.addEventListener('click', () => { focusWorldViewOnArea(btn.dataset.areaId); renderWorldScreen(); });
    });
    container.querySelectorAll('[data-competition-id]').forEach((btn) => {
      btn.addEventListener('click', () => { focusWorldViewOnCompetition(btn.dataset.competitionId); renderWorldScreen(); });
    });
  }

  function renderWorldCompetitionView(container, competitionDefinitionId) {
    const view = BM.competitionView(state.world.registries, competitionDefinitionId, {
      engine: state.competitionEngine, seasonKey: buildCareerSeasonKey(),
    });
    const backAreaId = view.scopeAreaId || state.worldView.areaId;
    const stagesHtml = view.stages.length
      ? view.stages.map((stage) => `
        <div class="world-stage">
          <h4>${escapeHtml(stage.name)} <span class="gm-muted">(${escapeHtml(stage.status)})</span></h4>
          ${worldResultHtml(stage.result)}
        </div>`).join('')
      : '<p class="gm-muted">Sin fases todavía.</p>';
    const participantsHtml = view.participants.length
      ? `<ul class="world-list">${view.participants.map((p) => `<li>${p.seed ? `${p.seed}. ` : ''}${escapeHtml(p.name)}</li>`).join('')}</ul>`
      : '<p class="gm-muted">Sin participantes todavía.</p>';

    container.innerHTML = `
      <div class="world-breadcrumb"><button type="button" class="world-breadcrumb__btn" data-back-area-id="${backAreaId}">← Volver al área</button></div>
      <div class="gm-card">
        <h3>${escapeHtml(view.name)} <span class="gm-muted">(${escapeHtml(view.implementationStatus)})</span></h3>
        <p class="gm-muted">Organiza: ${escapeHtml(view.organizer.name)}</p>
        ${view.catalogOnly
          ? '<p class="gm-muted">Catalogada, sin edición activa.</p>'
          : (view.edition
            ? `<p class="gm-muted">Temporada ${escapeHtml(view.edition.seasonKey)} — nivel de detalle: ${escapeHtml(view.edition.detailLevel)}</p>`
            : '<p class="gm-muted">Todavía no hay edición registrada para esta temporada.</p>')}
      </div>
      ${!view.catalogOnly ? `
        <div class="gm-card"><h3>Fases</h3>${stagesHtml}</div>
        <div class="gm-card"><h3>Participantes</h3>${participantsHtml}</div>` : ''}
    `;
    container.querySelectorAll('[data-back-area-id]').forEach((btn) => {
      btn.addEventListener('click', () => { focusWorldViewOnArea(btn.dataset.backAreaId); renderWorldScreen(); });
    });
  }

  function renderWorldScreen() {
    const container = byId('gm-world');
    if (!state.world) { container.innerHTML = '<p class="gm-muted">Todavía no hay ninguna carrera en curso.</p>'; return; }
    const view = state.worldView;
    if (view.kind === 'competition' && view.competitionDefinitionId) {
      renderWorldCompetitionView(container, view.competitionDefinitionId);
      return;
    }
    renderWorldAreaView(container, view.areaId || (BM.WORLD_CORE_AREA_IDS && BM.WORLD_CORE_AREA_IDS.WORLD));
  }

  // ---------------------------------------------------------------------
  // Pantalla: calendario (próximos partidos y resultados pasados)
  // ---------------------------------------------------------------------
  // DESIGN.md 3.3 (Entidad Calendario): fecha real del partido, si la Liga
  // se construyó con un dateResolver de Calendar.js — '—' si no (siempre
  // debería haberlo desde startCareerFromSetup(), pero se protege igual).
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

  // =====================================================================
  // WORLD-CALENDAR-1 (DESIGN.md 10.14) — Agenda es una PROYECCIÓN de la
  // cronología mundial, no un recorrido de mapas fijos.
  //
  // Antes de esta entrega:
  //  - los partidos se derivaban de `league.schedule` de la división
  //    visible + `state.brackets[state.division]`, así que un partido del
  //    usuario en otra competición podía no aparecer;
  //  - `collectBracketAgendaEvents()` intentaba proyectar el siguiente
  //    partido pendiente de una serie con `series.dateResolver`, un campo
  //    que la vista legacy de `Bracket` nunca ha expuesto: esa rama estaba
  //    MUERTA y ningún partido de eliminatoria futuro llegaba a Agenda;
  //  - BUG-WORLDCALENDAR-04: el comentario de `pushMarketAgenda()` afirmaba
  //    que esta función incorporaba los eventos futuros de
  //    `marketRegistry.allScheduledEvents()` y `state.marketAgendaLog`, y
  //    no leía ni lo uno ni lo otro. Agenda omitía tanto los próximos
  //    vencimientos como los hechos de mercado ya registrados.
  //
  // Ahora: partidos del equipo del usuario de TODAS sus competiciones
  // (pendientes y jugados) desde la cronología/engine, más los eventos
  // futuros de mercado/traspaso/cesión relevantes a su club desde la MISMA
  // cola, más el `marketAgendaLog` histórico — sin duplicados (los
  // pendientes se identifican por el id estable del item, los históricos
  // por el id del evento de mercado).
  // =====================================================================

  // Un evento de Agenda de fecha CIVIL (plazo de mercado, fecha efectiva de
  // un traspaso, retorno de cesión) conserva su fecha: para ordenarlo y
  // agruparlo con los partidos se usa el inicio de su día en el huso
  // declarado, nunca una hora inventada (invariante 10).
  function agendaDateTimeForItem(item) {
    return BM.GameDateTime.toJsDate(item.orderingInstant);
  }

  const AGENDA_ITEM_TITLES = {
    'transfer-event': (metadata, playerName) => `Fecha efectiva del traspaso de ${playerName || metadata.playerId}`,
    'loan-return': (metadata, playerName) => `Fin de la cesión de ${playerName || metadata.playerId}`,
  };

  function buildAgendaEventsFromCalendar(rangeStart, rangeEnd, team) {
    const events = [];
    if (!state.calendar || !state.calendarCoordinator) return events;
    const fromInstant = BM.GameDateTime.fromJsDate(rangeStart);
    const toInstant = BM.GameDateTime.fromJsDate(rangeEnd);
    const nextUserDescriptor = peekNextUserMatchDescriptor();

    // Partidos del equipo del usuario de TODAS sus competiciones —
    // pendientes (desde la cola) y ya jugados (desde el ledger acotado).
    state.calendar.itemsForTeam(team.id, { fromInstant, toInstant }).forEach((entry) => {
      if (entry.sourceType !== BM.WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH) return;
      const homeTeam = state.world.registries.teams.get(entry.metadata.homeParticipantId);
      const awayTeam = state.world.registries.teams.get(entry.metadata.awayParticipantId);
      if (!homeTeam || !awayTeam) return;
      const played = entry.status === 'completed';
      const runner = state.competitionEngine.getRunner(entry.metadata.stageId);
      const descriptor = runner && runner.getMatchById ? runner.getMatchById(entry.metadata.matchId) : null;
      events.push(BM.buildMatchAgendaEvent({
        homeTeam,
        awayTeam,
        date: agendaDateTimeForItem(entry),
        status: played ? 'played' : 'pending',
        result: descriptor ? descriptor.result : null,
      }, {
        id: `agenda-item:${entry.id}`,
        relatedCompetition: entry.metadata.competitionDefinitionId,
        requiresAttention: !!nextUserDescriptor && nextUserDescriptor.id === entry.metadata.matchId,
      }));
    });

    // Eventos FUTUROS de mercado/traspaso/cesión relevantes al club del
    // usuario — leídos de la misma cola, nunca reimplementando su regla.
    if (state.userClubId) {
      state.calendar.itemsForClub(state.userClubId, { fromInstant, toInstant }).forEach((entry) => {
        if (entry.sourceType === BM.WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH) return;
        const player = entry.metadata.playerId && state.playerRegistry ? state.playerRegistry.get(entry.metadata.playerId) : null;
        const playerName = player ? player.fullName : null;
        if (entry.sourceType === BM.WORLD_CALENDAR_SOURCE_TYPES.MARKET_EVENT) {
          const scheduled = state.marketRegistry ? state.marketRegistry.getScheduledEvent(entry.sourceId) : null;
          if (!scheduled) return;
          events.push(BM.buildMarketAgendaEvent(scheduled, { relatedPlayer: player ? { id: player.id, fullName: player.fullName } : null }));
          return;
        }
        const titleFn = AGENDA_ITEM_TITLES[entry.metadata.kind];
        if (!titleFn) return;
        events.push(BM.makeEvent({
          id: `agenda-item:${entry.id}`,
          type: 'market',
          dateTime: agendaDateTimeForItem(entry),
          title: titleFn(entry.metadata, playerName),
          status: entry.status === 'completed' ? 'resolved' : 'pending',
          requiresAttention: false,
        }));
      });
    }
    return events;
  }

  function buildAgendaEvents(rangeStart, rangeEnd) {
    const team = getUserTeam();
    const events = buildAgendaEventsFromCalendar(rangeStart, rangeEnd, team);
    const seenIds = new Set(events.map((event) => event.id));

    function pushUnique(event) {
      if (!event || seenIds.has(event.id)) return;
      seenIds.add(event.id);
      events.push(event);
    }

    state.newsLog.forEach((event) => {
      if (event.dateTime && event.dateTime >= rangeStart && event.dateTime <= rangeEnd) pushUnique(event);
    });
    // LIFE-3 (DESIGN.md 9.14, sección 30): eventos médicos (lesión/alta)
    // del equipo del usuario, misma fuente de persistencia que newsLog.
    state.medicalAgendaLog.forEach((event) => {
      if (event.dateTime && event.dateTime >= rangeStart && event.dateTime <= rangeEnd) pushUnique(event);
    });
    // MARKET-1 (DESIGN.md 9.19): hechos de mercado YA OCURRIDOS
    // (`state.marketAgendaLog`) — BUG-WORLDCALENDAR-04: Agenda nunca los
    // leía. `dateTime` de estos eventos es una fecha CIVIL (`YYYY-MM-DD`,
    // lo que produce `buildMarketAgendaEvent`), así que se normaliza al
    // inicio de su día en el huso declarado para poder compararla y
    // agruparla con los partidos.
    state.marketAgendaLog.forEach((event) => {
      const dateTime = typeof event.dateTime === 'string'
        ? BM.GameDateTime.toJsDate(BM.GameDateTime.startOfLocalDay(event.dateTime, state.calendar.defaultTimeZoneId))
        : event.dateTime;
      if (!dateTime || dateTime < rangeStart || dateTime > rangeEnd) return;
      pushUnique({ ...event, dateTime });
    });

    return events
      .map((event) => (typeof event.dateTime === 'string'
        ? {
          ...event,
          dateTime: BM.GameDateTime.toJsDate(BM.GameDateTime.startOfLocalDay(event.dateTime, state.calendar.defaultTimeZoneId)),
        }
        : event))
      .sort((a, b) => {
        const diff = a.dateTime - b.dateTime;
        return diff !== 0 ? diff : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
      });
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
    // WORLD-UI-1 (DESIGN.md 10.18, BUG-WORLDUI-04/05): las pestañas se
    // derivan de la participación REAL del usuario (`isUserInTopFlight()`,
    // resuelta por Entry real), nunca de `state.division`.
    const brackets = getUserBracketsReal();
    const team = getUserTeam();
    const activeTab = container.dataset.activeTab || 'league';

    const tabsAvailable = [
      { id: 'league', label: 'Liga regular' },
    ];
    if (isUserInTopFlight()) {
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

    // WORLD-CALENDAR-1 (DESIGN.md 10.14): estos botones ya NO resuelven
    // "el siguiente partido de este bracket" (eso jugaba un cruce
    // CPU-vs-CPU si el usuario no estaba en el primero pendiente,
    // BUG-WORLDCALENDAR-02). Ahora avanzan el MUNDO hasta la próxima
    // parada real del usuario, exactamente igual que "Continuar" en Home:
    // un único camino de avance, gobernado por la fecha.
    const advanceBracket = () => {
      if (!getLineupValidity(team).valid) { goToScreen('lineup'); return; }
      playNextMatchWithLineup(team);
    };

    const cupBtn = byId('gm-advance-cup-btn');
    if (cupBtn) cupBtn.addEventListener('click', () => advanceBracket());

    const playoffBtn = byId('gm-advance-playoff-btn');
    if (playoffBtn) playoffBtn.addEventListener('click', () => advanceBracket());

    const promoBtn = byId('gm-advance-promotion-btn');
    if (promoBtn) promoBtn.addEventListener('click', () => advanceBracket());
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
      // WORLD-SIM-1/WORLD-UI-1 (BUG-WORLDUI-06): un resultado `standard`/
      // `abstract` (`!BM.hasIndividualMatchDetail(result)`) nunca lleva
      // `boxScore` por jugador — se excluye de las medias en vez de
      // fallar o fabricar ceros (invariante 15: ausencia de detalle nunca
      // se confunde con cero).
      if (!result || !result.boxScore || !BM.hasIndividualMatchDetail(result)) return;
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
    // WORLD-UI-1 (BUG-WORLDUI-04/05): participación real, nunca `state.division`.
    if (isUserInTopFlight()) {
      tabsAvailable.push({ id: 'cup', label: 'Copa' });
      tabsAvailable.push({ id: 'playoffs', label: 'Playoff' });
    } else {
      tabsAvailable.push({ id: 'promotion', label: 'Ascenso' });
    }

    const brackets = getUserBracketsReal();
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
        <td>${careerAgeOf(player) ?? '—'}</td>
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
        <td>${careerAgeOf(player, referenceDate) ?? '—'}</td>
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

  // TAC-4 (7.12.17): TODOS los equipos reales (36 clubes), agrupados por
  // equipo — solo para el selector de "jugador rival a marcar" de un
  // matchup declarado (esta pantalla no tiene un rival fijo de partido, ver
  // Tactics.TacticalProfile.matchupOverrides). Instancias reales de
  // Team/Player reconstruidas por id estable (WORLD-CLEANUP-1, DESIGN.md
  // 10.21) — nunca por división ni datos planos en la UI (CLAUDE.md,
  // "Interfaz de juego").
  function getAllRealTeamsForMatchupTarget() {
    const { REAL_DATA_INDEX, REAL_DATA_TEAMS, CareerParticipantFactory } = BM;
    const competitionIdByTeamId = CareerParticipantFactory.competitionIdByTeamIdFrom(BM.SPAIN_CLUB_CONTENT);
    return REAL_DATA_INDEX.map(
      (entry) => buildRealTeamFromData(REAL_DATA_TEAMS[entry.id], competitionIdByTeamId.get(entry.id)),
    );
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
  // WORLD-CALENDAR-1: recibe la CLASIFICACIÓN ya resuelta de la liga
  // doméstica real de `team` (antes recibía la `League` de "su división",
  // asumiendo que ambos lados compartían liga visible/de fondo) — un
  // partido de Copa entre dos clubes evalúa importancia con la
  // clasificación real de cada uno.
  function buildCpuSideOptions(team, opponent, competition, standingsTable, date, matchContext) {
    const { buildCpuLineup, computeMatchImportance, CONFIG_BASE } = BM;
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
      competitionId: matchContext ? matchContext.competitionId : undefined,
      opponentClubId: opponent.clubId,
    });
    const resolved = BM.resolveRules(context);
    // REG-1 (sección 11.3 del prompt): la CPU consulta EXACTAMENTE
    // EligibilityService/SquadEligibilityService sobre el pool REGULADO
    // (senior+propios+vinculados) — nunca un greedy "los 12 mejores" que
    // pueda dejar la plantilla sin cupo. `eligibility` es `null` solo si la
    // partida todavía no construyó `state.registrationRegistry` (defensivo).
    const pool = buildEligiblePoolForMatch(team, context);
    const eligibility = pool ? { pool, resolved } : null;
    const built = buildCpuLineup(team, matchImportance, CONFIG_BASE, date, resolved.squadRules, eligibility);
    // BUG-LOAN1-01 (CYCLE-1, DESIGN.md 9.22): una imposibilidad
    // reglamentaria NUNCA cae a un selector no regulado, y el motor no
    // juega un partido con acta ilegal — se detiene con el diagnóstico
    // estructurado que el usuario ve tal cual. Resolverlo ANTES del primer
    // partido es responsabilidad de la fase de legalidad del ciclo anual
    // (`RosterLegalityService`, escalera de emergencia incluida).
    if (built.outcome === 'infeasible') {
      throw new Error(
        `Convocatoria reglamentariamente IMPOSIBLE para "${built.diagnostic.teamName}" `
        + `(${built.diagnostic.code}): pool regulado ${built.diagnostic.poolSize}, elegibles y disponibles `
        + `${built.diagnostic.eligibleAndAvailable}, mínimo efectivo ${built.diagnostic.effectiveMin}. `
        + 'El partido no se juega con un acta ilegal (CYCLE-1, BUG-LOAN1-01).',
      );
    }
    return built;
  }

  // LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2, secciones 9/32 del
  // prompt de esa sesión): procesa Training/PlayerDevelopment/Recovery de
  // AMBOS equipos hasta la fecha del partido — ANTES de construir
  // squad/lineup (que en el caso CPU sí usa Energía real,
  // CpuLineup.playerPositionScore) y ANTES de MatchEngine.simulateMatch.
  // Único punto de enganche: cubre CUALQUIER partido de CUALQUIER
  // competición, usuario y CPU, sin duplicar la secuencia en ningún otro
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
      date,
      phaseId: matchContext.phaseId,
      roundId: matchContext.roundId,
      matchId: matchContext.matchId,
      competitionId: matchContext.competitionId,
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

  // ---------------------------------------------------------------------
  // WORLD-CALENDAR-1 (DESIGN.md 10.14, sección 12) — ruta de COMMIT
  // UNIFICADA: un único constructor de `options` de MatchEngine para
  // CUALQUIER descriptor de partido (Liga, Copa, playoff por el título,
  // ascenso), de cualquier competición y cualquiera de los 36 clubes.
  //
  // Sustituye a `buildMatchOptionsResolver(league, userTeam)` +
  // `resolveMatchOptions(match)` + `resolveBracketOptionsFor(bracket,
  // phaseId)` + `buildCpuOnlyResolver(league)`: había un resolver "de la
  // liga visible" y otro "de la división de fondo", y el de bracket
  // necesitaba que el llamador supiera qué bracket estaba abierto. Ahora el
  // descriptor ya trae fase, ronda, competición, ids y fecha REALES, así
  // que no hay nada que adivinar ni un segundo camino que mantener.
  //
  // `precomputedResult` (DESIGN.md 7.12.24, TAC-5): el partido del usuario
  // se juega de verdad sobre el motor pausable y su resultado exacto entra
  // como `precomputedResult` en ESTE MISMO descriptor — nunca se vuelve a
  // simular (daría un partido distinto del que el usuario vio).
  // ---------------------------------------------------------------------

  // Clasificación de la liga doméstica REAL del equipo (para
  // `computeMatchImportance`) — resuelta por participación
  // (`CompetitionParticipationService`), nunca por "la liga visible" ni por
  // `team.division`. `null` si su liga aún no tiene runtime.
  function domesticStandingsTableForTeam(team) {
    const seasonKey = buildCareerSeasonKey();
    const competitionId = BM.CompetitionParticipationService.primaryLeagueCompetitionId(
      state.world.registries, team.id, { seasonKey },
    );
    const runner = state.competitionEngine.getRunner(BM.buildStageId(competitionId, seasonKey, 'regular-season'));
    if (!runner) return [];
    const teamsById = new Map(getAllTeams().map((t) => [t.id, t]));
    return runner.getStandings().map((s) => ({ ...s, team: teamsById.get(s.participantId) }));
  }

  function buildMatchEngineOptionsForDescriptor(info, { precomputedResult } = {}) {
    const { descriptor, isBracket, homeTeam, awayTeam } = info;
    const matchDate = descriptor.scheduledDate;
    prepareBothTeamsForMatch(homeTeam, awayTeam, matchDate);
    const matchContext = {
      phaseId: info.phaseId, roundId: info.roundId, matchId: info.matchId, competitionId: info.competitionId,
    };
    const userTeamId = state.userTeamId;

    function sideOptions(sideTeam, opponentTeam, isHome) {
      if (userTeamId && sideTeam.id === userTeamId) {
        const userSide = buildUserSideOptions(sideTeam);
        recordMatchActSnapshot(sideTeam, userSide.squad, matchDate, matchContext);
        return isHome
          ? { homeSquad: userSide.squad, homeLineup: userSide.lineup }
          : { awaySquad: userSide.squad, awayLineup: userSide.lineup };
      }
      // CpuLineup.computeMatchImportance solo distingue 'league' de
      // cualquier otro valor (siempre partido clave fuera de liga) — ver
      // CpuLineup.js, sin dependencia de la clave de UI retirada.
      const cpu = buildCpuSideOptions(
        sideTeam, opponentTeam, isBracket ? 'bracket' : 'league', domesticStandingsTableForTeam(sideTeam), matchDate, matchContext,
      );
      recordMatchActSnapshot(sideTeam, cpu.squad, matchDate, matchContext);
      return isHome ? { homeSquad: cpu.squad, homeLineup: cpu.lineup } : { awaySquad: cpu.squad, awayLineup: cpu.lineup };
    }

    return {
      matchDate, // LIFE-3 (DESIGN.md 9.14): ver MatchEngine.createMatchState
      ...(precomputedResult ? { precomputedResult } : {}),
      ...sideOptions(homeTeam, awayTeam, true),
      ...sideOptions(awayTeam, homeTeam, false),
    };
  }

  // ---------------------------------------------------------------------
  // WORLD-CALENDAR-1 (DESIGN.md 10.14): "Continuar" desde Home/Alineación.
  // Avanza el mundo con el coordinador hasta la próxima parada REAL del
  // usuario y actúa según su tipo. No queda ningún camino que resuelva
  // "la jornada" ni que drene una eliminatoria.
  // ---------------------------------------------------------------------
  function playNextMatchWithLineup(team) {
    if (!getLineupValidity(team).valid) { goToScreen('lineup'); return; }
    const stop = advanceWorldUntilNextUserStop();
    if (stop.type === BM.WORLD_CALENDAR_STOP_TYPES.USER_MATCH) {
      startUserMatchFromStop(team, stop);
      return;
    }
    // Cualquier otra parada (atención de mercado, conflicto horario, fin de
    // temporada, fallo de resolución) la presenta Home tal cual.
    goToScreen('home');
  }

  // Partido del usuario en su instante real: el descriptor exacto de la
  // parada. Liga -> motor PAUSABLE (TAC-5) con ventanas de intervención
  // reales. Eliminatoria -> se conserva el reveal por cuartos existente
  // (decisión de encaje de TAC-5, ampliarlo sigue siendo trabajo pendiente
  // señalado), pero resolviendo por stage/matchId REAL.
  function startUserMatchFromStop(team, stop) {
    const { stageId, matchId } = stop.item.metadata;
    const runner = state.competitionEngine.getRunner(stageId);
    const descriptor = runner.getMatchById
      ? runner.getMatchById(matchId)
      : runner.getPendingMatches().find((d) => d.id === matchId);
    const info = describeMatchDescriptor(descriptor);
    if (!info.isBracket) {
      pushTacticalTrendNewsIfAny({ homeTeam: info.homeTeam, awayTeam: info.awayTeam }, team);
      const standingsBefore = captureStandingsSnapshot(getLeagueForTeam(info.homeTeam));
      const engineOptions = buildMatchEngineOptionsForDescriptor(info, {});
      startLiveMatch(info.homeTeam, info.awayTeam, engineOptions, (finalResult) => {
        finishUserLiveMatch(stop, info, finalResult, standingsBefore);
      });
      goToScreen('match');
      return;
    }
    playUserBracketMatchWithReveal(stop, info);
  }

  // Cierre del partido de liga del usuario: el resultado EXACTO que vio se
  // registra como `precomputedResult` en ESE MISMO descriptor (nunca se
  // re-simula), y después se resuelven los CPU simultáneos.
  function finishUserLiveMatch(stop, info, finalResult, standingsBefore) {
    resolveMatchDescriptor(info.stageId, info.matchId, { precomputedResult: finalResult });
    publishStandingsNewsAfterUserMatch(info, standingsBefore);
    state.pendingUserMatch = {
      homeTeam: info.homeTeam, awayTeam: info.awayTeam, date: info.descriptor.scheduledDate, result: info.descriptor.result, status: 'played',
    };
    state.lastRoundMatches = lastRoundMatchesForUser(info);
    finishUserMatchCommit(stop.item);
  }

  // Partido de eliminatoria del usuario: se resuelve de golpe y se revela
  // por cuartos, igual que antes de esta entrega.
  function playUserBracketMatchWithReveal(stop, info) {
    resolveMatchDescriptor(info.stageId, info.matchId, {});
    publishBracketOutcomeNews(info);
    state.pendingUserMatch = {
      homeTeam: info.homeTeam, awayTeam: info.awayTeam, result: info.descriptor.result,
    };
    finishUserMatchCommit(stop.item);
    goToScreen('match');
  }

  // Noticias de clasificación/sorpresa del partido del usuario — necesitan
  // la comparación antes/después que solo existe en este instante.
  function publishStandingsNewsAfterUserMatch(info, standingsBefore) {
    if (!standingsBefore) return;
    const league = getLeagueForTeam(info.homeTeam);
    if (!league) return;
    const normalized = {
      homeTeam: info.homeTeam, awayTeam: info.awayTeam, date: info.descriptor.scheduledDate, result: info.descriptor.result, status: 'played',
    };
    pushNews(BM.buildUpsetNewsEvent(normalized, standingsBefore, BM.CONFIG_BASE, {
      userTeamId: state.userTeamId, relatedCompetition: info.competitionId,
    }));
    pushNews(BM.buildStandingsNewsEvents(standingsBefore, league.getStandingsTable(), BM.CONFIG_BASE, {
      userTeamId: state.userTeamId, relatedCompetition: info.competitionId, dateTime: state.calendar.currentGameDateTime,
    }));
  }

  // Eliminación/campeón tras un partido de eliminatoria del usuario — se
  // leen del runner REAL ya comiteado, nunca se recalculan.
  function publishBracketOutcomeNews(info) {
    // Solo Copa/Playoff por el título publican elimininación/campeón aquí —
    // el Playoff de ascenso resuelve sus propias noticias de ascenso al
    // cierre de temporada (`buildPromotionRelegationNewsEvents`), mismo
    // criterio que antes de esta entrega.
    const { phaseId } = info;
    if (phaseId !== 'cup' && phaseId !== 'title-playoff') return;
    const runner = state.competitionEngine.getRunner(info.stageId);
    const series = runner.rounds.flat().find((s) => s.games.some((g) => g && g.id === info.matchId));
    if (!series) return;
    const decided = series.wins.better >= series.gamesNeededToWin || series.wins.worse >= series.gamesNeededToWin;
    if (!decided) return;
    const teamsById = new Map(getAllTeams().map((t) => [t.id, t]));
    const winnerEntry = series.wins.better > series.wins.worse ? series.better : series.worse;
    const loserEntry = series.wins.better > series.wins.worse ? series.worse : series.better;
    const competitionLabel = info.stageName || info.competitionShortName;
    if (loserEntry.participantId === state.userTeamId) {
      pushNews(BM.buildEliminationNewsEvent(teamsById.get(loserEntry.participantId), {
        competitionLabel, relatedCompetition: info.competitionId, userTeamId: state.userTeamId, dateTime: info.descriptor.scheduledDate,
      }));
    }
    const champion = runner.champion;
    if (champion && champion.participantId === winnerEntry.participantId) {
      pushNews(BM.buildChampionNewsEvent(teamsById.get(champion.participantId), {
        competitionLabel, relatedCompetition: info.competitionId, userTeamId: state.userTeamId, dateTime: info.descriptor.scheduledDate,
      }));
    }
  }

  // "Última jornada" de Home: los partidos de la jornada del usuario en su
  // propia liga (vista derivada, nunca un estado guardado aparte).
  function lastRoundMatchesForUser(info) {
    if (info.isBracket) return state.lastRoundMatches;
    const league = getLeagueForTeam(info.homeTeam);
    if (!league) return state.lastRoundMatches;
    return league.schedule.filter((m) => m.round === info.descriptor.round);
  }

  // Partido PENDIENTE más próximo cronológicamente de `team` en `league`
  // (vista legacy para Agenda/pantallas de liga — el "qué toca ahora"
  // global lo decide la cola mundial, ver `peekNextUserMatchDescriptor`).
  function findNextPendingMatchForTeam(league, team) {
    const pending = league.schedule.filter(
      (m) => m.status === 'pending' && (m.homeTeam.id === team.id || m.awayTeam.id === team.id),
    );
    if (!pending.length) return null;
    return pending.reduce((earliest, m) => (m.date < earliest.date ? m : earliest));
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
      relatedCompetition: userLeagueCompetitionId(), dateTime: state.calendar.currentGameDateTime,
    }));
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

    // WORLD-CLEANUP-1 (DESIGN.md 10.21): nombre de la competición REAL del
    // equipo (por Entries), nunca `team.division` (retirado de la entidad).
    const teamCompetitionId = team ? teamLeagueCompetitionId(team) : null;
    const headerSubtitle = team
      ? `${careerAgeOf(player) ?? '—'} años · ${escapeHtml(team.fullName)}${teamCompetitionId ? ` (${escapeHtml(competitionDisplayName(teamCompetitionId))})` : ''} · ${player.nominalPosition}`
      : `${careerAgeOf(player) ?? '—'} años · Sin club · ${player.nominalPosition}`;

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
          <div><dt>Club empleador</dt><dd>${escapeHtml((() => {
            const employerTeam = teamForClubId(current.clubId);
            return employerTeam ? employerTeam.fullName : current.clubId;
          })())}</dd></div>
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
    const club = teamForClubId(contract.clubId);
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
        nationalTeamRegistry: state.nationalTeamRegistry,
        clubId: team.clubId,
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

  // --- Pantalla "Planificación" / "Ciclo anual" (CYCLE-1, DESIGN.md 9.22) -
  // ÚNICA pantalla con acciones de renovación/opción y de decisión de
  // academia — Contratos e Inscripciones siguen de solo lectura tal cual
  // documentan CONTRACT-1/REG-1. Consolida en una sola pantalla las cuatro
  // áreas de la sección 20 del prompt (estado del ciclo, Contratos,
  // Academia, Mercado/retiradas) — decisión de producto documentada en
  // DESIGN.md/CLAUDE.md.
  function runRenewalNegotiation(team, contract) {
    const { RenewalService, CycleConfig: CC, LocalDate: LD } = BM;
    const isoDate = currentGameIsoDate();
    const seasonKey = buildCareerSeasonKey();
    const player = state.playerRegistry.get(contract.playerId);
    if (!player) return { outcome: 'failed', reason: 'PLAYER_NOT_FOUND' };
    const eligibility = RenewalService.isRenewable({
      contract, annualCycleRegistry: state.annualCycleRegistry, contractRegistry: state.contractRegistry, date: isoDate,
    });
    if (!eligibility.renewable) return { outcome: 'failed', reason: eligibility.reason };
    const resolved = BM.ContractService.resolveRulesForClub(team, {
      seasonKey, date: isoDate, operation: 'validateContract',
      domesticCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'cycleRenewal'),
    });
    const cycleId = state.annualCycle ? state.annualCycle.id : `season:${seasonKey}`;
    const renewalCase = RenewalService.openRenewalCase({
      annualCycleRegistry: state.annualCycleRegistry, cycle: { id: cycleId }, player, team, expiringContract: contract, date: isoDate, seasonKey,
      domesticCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'openRenewalCase'),
    });
    const marketContext = BM.MarketService.resolveMarketContext({
      domesticCompetitionId: BM.CompetitionParticipationService.primaryLeagueCompetitionId(state.world.registries, team.id, { seasonKey }),
      seasonKey,
      date: isoDate,
    });
    let round = 0;
    let outcome = null;
    let salaryOverrideMinor = null;
    while (round < CC.RENEWAL.maxOfferRounds) {
      const result = RenewalService.sendRenewalOfferAndResolve({
        annualCycleRegistry: state.annualCycleRegistry, marketRegistry: state.marketRegistry, playerRegistry: state.playerRegistry,
        contractRegistry: state.contractRegistry, agentRegistry: state.agentRegistry,
        renewalCase, player, team, expiringContract: contract, resolved, seasonKey, date: isoDate,
        careerSeed: buildCycleCareerSeed(), marketContext, salaryOverrideMinor,
      });
      outcome = result.outcome;
      if (outcome === 'countered' && result.counterRequestMinor) {
        salaryOverrideMinor = result.counterRequestMinor;
        round += 1;
        continue;
      }
      break;
    }
    if (outcome !== 'agreement-in-principle') return { outcome: outcome || 'rejected', player, renewalCase };
    const { contract: newContract } = RenewalService.commitRenewal({
      annualCycleRegistry: state.annualCycleRegistry, marketRegistry: state.marketRegistry, contractRegistry: state.contractRegistry,
      playerRegistry: state.playerRegistry, renewalCase, player, team, resolved, seasonKey, date: isoDate, teams: getAllTeams(),
    });
    pushNews(BM.buildMarketNewsEvent({
      dateTime: state.calendar.currentGameDateTime,
      title: `${player.fullName} renueva su contrato con ${team.fullName}`,
      relatedTeam: team,
      relatedPlayer: { id: player.id, fullName: player.fullName },
      priority: 'alta',
    }));
    void LD;
    return { outcome: 'accepted', player, contract: newContract };
  }

  function cycleContractsExpiringHtml(team, isoDate) {
    const { RenewalService } = BM;
    // WORLD-CONTEXT-1: los contratos se agregan por el CLUB institucional
    // (`team.clubId`) — con `team.id` esta lista salía SIEMPRE vacía desde
    // CLUB-CORE-1.
    const contracts = state.contractRegistry.forClub(team.clubId).filter((c) => c.isCurrentOn(isoDate));
    if (!contracts.length) return '<p class="gm-muted">No hay contratos vigentes.</p>';
    const rows = contracts.map((contract) => {
      const player = state.playerRegistry.get(contract.playerId);
      if (!player) return '';
      const eligibility = RenewalService.isRenewable({
        contract, annualCycleRegistry: state.annualCycleRegistry, contractRegistry: state.contractRegistry, date: isoDate,
      });
      const alreadyRenewed = state.contractRegistry.forPlayer(contract.playerId)
        .some((other) => other.id !== contract.id && BM.LocalDate.isAfter(other.startDate, contract.endDate));
      const action = alreadyRenewed
        ? '<span class="gm-tag gm-tag--ok">Continuidad ya acordada</span>'
        : eligibility.renewable
          ? `<button class="gm-btn gm-btn--sm cycle-renew-btn" data-contract-id="${escapeHtml(contract.id)}" type="button">Proponer renovación</button>`
          : `<span class="gm-muted">${eligibility.reason === 'OUTSIDE_RENEWAL_WINDOW' ? 'Fuera de ventana de renovación' : 'No renovable ahora'}</span>`;
      return `<tr>
        <td>${escapeHtml(player.fullName)}</td>
        <td>${escapeHtml(formatIsoDateEs(contract.endDate))}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
    return `<div class="gm-table-scroll"><table class="gm-table"><thead><tr><th>Jugador</th><th>Fin de contrato</th><th>Acción</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function cycleAcademyHtml(team, isoDate) {
    if (!state.academyRegistry) return '';
    const { CareerAge, CycleConfig: CC } = BM;
    // WORLD-CONTEXT-1: la cantera pertenece al CLUB (`team.clubId`).
    const pool = state.academyRegistry.activePoolForClub(team.clubId, isoDate);
    if (!pool.length) return '<p class="gm-muted">Sin jugadores de academia activos.</p>';
    const rows = pool.map((membership) => {
      const player = state.playerRegistry.get(membership.playerId);
      if (!player) return '';
      const age = CareerAge.ageOnDate(player, isoDate);
      const canPromote = age !== null && age <= CC.ACADEMY.maxAgeInclusive + 2;
      return `<tr>
        <td>${escapeHtml(player.fullName)}</td>
        <td>${escapeHtml(player.nominalPosition || '')}</td>
        <td>${age !== null ? age : '—'}</td>
        <td>${canPromote ? `<button class="gm-btn gm-btn--sm cycle-promote-btn" data-player-id="${escapeHtml(player.id)}" type="button">Promocionar</button>` : '<span class="gm-muted">—</span>'}</td>
      </tr>`;
    }).join('');
    return `<div class="gm-table-scroll"><table class="gm-table"><thead><tr><th>Jugador</th><th>Posición</th><th>Edad</th><th>Acción</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="gm-muted">Continuar/liberar/abandonar la vía profesional se decide una vez al año, en el ciclo de verano.</p>`;
  }

  function cycleRetirementsHtml(team, isoDate) {
    if (!state.annualCycleRegistry) return '';
    const rows = team.roster.flatMap((player) => (
      state.annualCycleRegistry.retirementAnnouncementsForPlayer(player.id).map((a) => ({ player, announcement: a }))
    )).filter(({ announcement }) => announcement.currentStatus() === 'announced');
    if (!rows.length) return '<p class="gm-muted">Sin anuncios de retirada en tu plantilla.</p>';
    return `<ul class="gm-list">${rows.map(({ player, announcement }) => (
      `<li>${escapeHtml(player.fullName)} anuncia su retirada, efectiva el ${escapeHtml(formatIsoDateEs(announcement.effectiveDate))}.</li>`
    )).join('')}</ul>`;
  }

  function cycleLegalityHtml(team, isoDate) {
    const { RosterLegalityService } = BM;
    const report = RosterLegalityService.buildReport({
      team,
      seasonKey: buildCareerSeasonKey(),
      // WORLD-CONTEXT-1: competición EXPLÍCITA del equipo auditado.
      competitionId: domesticCompetitionIdForTeam(team, buildCareerSeasonKey(), 'cycleLegalityHtml'),
      competitionIdForTeam: buildDomesticCompetitionResolver('cycleLegalityHtml'),
      date: isoDate,
      phaseId: 'league',
      cycleId: null,
      config: BM.CONFIG_BASE,
      playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, registrationRegistry: state.registrationRegistry,
      loanRegistry: state.loanRegistry, teams: getAllTeams(), classificationCache: state.classificationCache || new Map(),
    });
    if (report.isLegal) return '<p class="gm-tag gm-tag--ok">Plantilla legal para el próximo partido.</p>';
    const gaps = report.gaps.filter((g) => g.severity === 'blocking').map((g) => g.code).join(', ');
    return `<p class="gm-tag gm-tag--warn">Plantilla NO legal (${escapeHtml(gaps)}).</p>
      <button class="gm-btn cycle-emergency-btn" type="button">Delegar medidas de emergencia</button>`;
  }

  function renderCycleScreen() {
    const container = byId('gm-cycle');
    const team = getUserTeam();
    if (!container) return;
    if (!team || !state.annualCycleRegistry) { container.innerHTML = ''; return; }
    const isoDate = currentGameIsoDate();
    const cyclePhaseLabel = state.annualCycle ? state.annualCycle.currentPhase() : 'Temporada en curso';
    const warningsHtml = (state.cycleWarnings || []).length
      ? `<div class="gm-card gm-card--warn">${state.cycleWarnings.map((w) => `<p>${escapeHtml(w)}</p>`).join('')}</div>` : '';
    container.innerHTML = `
      <h2>Planificación — ${escapeHtml(team.fullName)}</h2>
      <p class="gm-muted">Temporada ${escapeHtml(buildCareerSeasonKey())} · Fecha del mundo: ${escapeHtml(formatIsoDateEs(isoDate))} · Fase: ${escapeHtml(cyclePhaseLabel)}</p>
      ${warningsHtml}
      <div class="gm-card">
        <h3>Legalidad de la plantilla</h3>
        ${cycleLegalityHtml(team, isoDate)}
      </div>
      <div class="gm-card">
        <h3>Contratos que vencen — renovación</h3>
        ${cycleContractsExpiringHtml(team, isoDate)}
      </div>
      <div class="gm-card">
        <h3>Academia</h3>
        ${cycleAcademyHtml(team, isoDate)}
      </div>
      <div class="gm-card">
        <h3>Retiradas anunciadas</h3>
        ${cycleRetirementsHtml(team, isoDate)}
      </div>
      <p class="gm-muted contract-scope-note">Opciones contractuales, tanteo y equilibrio de mercado se resuelven
        orgánicamente durante el ciclo anual — esta pantalla es la única con acciones de renovación/academia.</p>`;
    wireCycleScreenActions(container, team);
  }

  function wireCycleScreenActions(container, team) {
    container.querySelectorAll('.cycle-renew-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const contract = state.contractRegistry.get(btn.dataset.contractId);
        if (!contract) return;
        const result = runRenewalNegotiation(team, contract);
        const label = result.outcome === 'accepted' ? 'Renovación acordada.'
          : result.outcome === 'rejected' ? 'El jugador rechaza la renovación por ahora.'
            : `No se pudo renovar (${result.reason || result.outcome}).`;
        window.alert(label); // eslint-disable-line no-alert
        renderCycleScreen();
      });
    });
    container.querySelectorAll('.cycle-promote-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const membership = state.academyRegistry.membershipsForClub(team.clubId)
          .find((m) => m.playerId === btn.dataset.playerId && m.currentStatus() === 'active');
        if (!membership) return;
        const isoDate = currentGameIsoDate();
        const seasonKey = buildCareerSeasonKey();
        const resolved = BM.RegistrationService.resolveRegistrationRules({
          competitionId: BM.CompetitionParticipationService.primaryLeagueCompetitionId(state.world.registries, team.id, { seasonKey }),
          seasonKey,
          date: isoDate,
          phaseId: 'league',
        });
        const calibration = BM.ContractSeeder.buildCompetitionCalibration(getAllTeams(), BM.CONFIG_BASE, {
          seasonKey, competitionIdForTeam: buildDomesticCompetitionResolver('cyclePromote:calibration'),
        });
        const player = state.playerRegistry.get(membership.playerId);
        try {
          BM.AcademyService.promoteToFirstTeam({
            academyRegistry: state.academyRegistry, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry,
            registrationRegistry: state.registrationRegistry, teams: getAllTeams(), membership, team, date: isoDate, seasonKey,
            domesticCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'cyclePromote'),
            config: BM.CONFIG_BASE, calibration, lineup: state.lineup, existingClassification: resolved.classification || null,
          });
          if (player) {
            pushNews(BM.buildMarketNewsEvent({
              dateTime: state.calendar.currentGameDateTime,
              title: `${player.fullName} promociona al primer equipo de ${team.fullName}`,
              relatedTeam: team,
              relatedPlayer: { id: player.id, fullName: player.fullName },
              priority: 'alta',
            }));
          }
          window.alert('Promoción completada.'); // eslint-disable-line no-alert
        } catch (err) {
          window.alert(`No se pudo promocionar: ${err.message}`); // eslint-disable-line no-alert
        }
        renderCycleScreen();
      });
    });
    const emergencyBtn = container.querySelector('.cycle-emergency-btn');
    if (emergencyBtn) {
      emergencyBtn.addEventListener('click', () => {
        const isoDate = currentGameIsoDate();
        const seasonKey = buildCareerSeasonKey();
        const report = BM.RosterLegalityService.buildReport({
          team,
          seasonKey,
          competitionId: domesticCompetitionIdForTeam(team, seasonKey, 'cycleEmergencyButton'),
          competitionIdForTeam: buildDomesticCompetitionResolver('cycleEmergencyButton'),
          date: isoDate,
          phaseId: 'league',
          cycleId: state.annualCycle ? state.annualCycle.id : null,
          config: BM.CONFIG_BASE,
          playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, registrationRegistry: state.registrationRegistry,
          loanRegistry: state.loanRegistry, teams: getAllTeams(), classificationCache: state.classificationCache || new Map(),
        });
        BM.RosterLegalityService.applyEmergencyLadder({
          report, team, date: isoDate, seasonKey, config: BM.CONFIG_BASE, cycle: state.annualCycle, careerSeed: buildCycleCareerSeed(),
          competitionIdForTeam: buildDomesticCompetitionResolver('cycleEmergency'),
          delegatedByUser: true,
          deps: {
            academyRegistry: state.academyRegistry, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry,
            registrationRegistry: state.registrationRegistry, annualCycleRegistry: state.annualCycleRegistry, teams: getAllTeams(),
            lineup: state.lineup,
            calibration: BM.ContractSeeder.buildCompetitionCalibration(getAllTeams(), BM.CONFIG_BASE, {
              seasonKey, competitionIdForTeam: buildDomesticCompetitionResolver('cycleEmergency:calibration'),
            }),
          },
        });
        renderCycleScreen();
      });
    }
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
      domesticCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'renderContractsScreen'),
    });
    // WORLD-CONTEXT-1: nómina/compromisos/comisiones son del CLUB
    // institucional (`team.clubId`) — con `team.id` la pantalla Contratos
    // mostraba 0 desde CLUB-CORE-1.
    const payroll = ContractService.guaranteedPayrollForClub(registry, team.clubId, seasonKey);
    const variable = ContractService.potentialVariableCompensationForClub(registry, team.clubId, seasonKey);
    const benefits = ContractService.benefitsValueForClub(registry, team.clubId, seasonKey);
    const agentCosts = ContractService.agentCostsForClub(registry, team.clubId, seasonKey);
    const commitments = ContractService.futureCommitmentsForClub(registry, team.clubId, seasonKey);
    const integrity = registry.validateIntegrity({
      playerRegistry: state.playerRegistry, teams: getAllTeams(), date: isoDate, loanRegistry: state.loanRegistry,
    });

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

    // LOAN-1 (DESIGN.md 9.21, sección 20.3 del prompt) — un cedido FUERA
    // conserva su contrato aquí (Contract.clubId sigue siendo este club),
    // pero NUNCA se reinserta en el roster operativo: se marca con badge,
    // nunca se oculta ni se confunde con la plantilla activa.
    const outboundLoansByPlayer = new Map();
    if (state.loanRegistry) {
      state.loanRegistry.agreementsForOwner(team.clubId).filter((a) => a.currentStatus() === 'active').forEach((a) => {
        outboundLoansByPlayer.set(a.playerId, a);
      });
    }
    const rosterRows = contracts.map((row) => {
      const outboundLoan = outboundLoansByPlayer.get(row.contract.playerId);
      const borrowerTeam = outboundLoan ? teamForClubId(outboundLoan.borrowerClubId) : null;
      return `
      <tr>
        <td data-label="Jugador">${row.player ? playerLinkHtml(row.player) : escapeHtml(row.contract.playerId)}
          <span class="gm-badge gm-badge--simulated" title="${escapeHtml(BM.ContractSeeder.SIMULATED_CONTRACT_WARNING)}">Simulado</span>
          ${outboundLoan ? ` <span class="gm-badge" title="Cedido a ${escapeHtml(borrowerTeam ? borrowerTeam.fullName : outboundLoan.borrowerClubId)} hasta ${escapeHtml(formatIsoDateEs(outboundLoan.returnEffectiveDate))}">Cedido fuera</span>` : ''}</td>
        <td data-label="Estado">${escapeHtml(CONTRACT_STATUS_LABELS[row.status])}</td>
        <td data-label="Inicio">${escapeHtml(formatIsoDateEs(row.contract.startDate))}</td>
        <td data-label="Final">${escapeHtml(formatIsoDateEs(row.contract.endDate))}</td>
        <td data-label="Temporadas restantes">${row.remaining}</td>
        <td data-label="Garantía">${row.contract.guaranteeType === 'fully-guaranteed' ? 'Total' : escapeHtml(row.contract.guaranteeType)}</td>
        <td data-label="Salario base">${formatMoneyMinor(row.breakdown.guaranteedBaseSalaryMinor, row.breakdown.currency)}</td>
        <td data-label="Imagen/especie">${formatMoneyMinor(row.breakdown.guaranteedImageRightsMinor + row.breakdown.guaranteedSalaryInKindMinor, row.breakdown.currency)}</td>
        <td data-label="Cuotas">${row.contract.paymentPolicy.installmentCount}</td>
        <td data-label="Cláusulas">${row.clauseLabels.length ? escapeHtml(row.clauseLabels.join(', ')) : '—'}</td>
      </tr>`;
    }).join('');

    // LOAN-1 (DESIGN.md 9.21, sección 20.3 del prompt) — cesionario: badge
    // "Cedido", propietario, retorno, coste asumido; el contrato de un
    // cedido IN nunca aparece en la tabla de arriba (Contract.clubId sigue
    // siendo del propietario), así que necesita su propia sección.
    const inboundLoans = state.loanRegistry ? state.loanRegistry.agreementsForBorrower(team.clubId).filter((a) => a.currentStatus() === 'active') : [];
    const inboundLoansHtml = inboundLoans.length ? `
      <div class="gm-card">
        <h3>Jugadores cedidos que refuerzan tu plantilla (${inboundLoans.length})</h3>
        <div class="gm-table-scroll">
          <table class="gm-table">
            <thead><tr><th>Jugador</th><th>Propietario</th><th>Retorno</th><th>Coste asumido (${seasonKey})</th></tr></thead>
            <tbody>${inboundLoans.map((a) => {
    const p = state.playerRegistry.get(a.playerId);
    const owner = teamForClubId(a.ownerClubId);
    const masterContract = registry.get(a.masterContractId);
    const exposure = BM.LoanCostService.loanExposureForAgreement({ agreement: a, masterContract, seasonKey });
    return `<tr>
              <td data-label="Jugador">${p ? playerLinkHtml(p) : escapeHtml(a.playerId)} <span class="gm-badge">Cedido</span></td>
              <td data-label="Propietario">${owner ? escapeHtml(owner.fullName) : '—'}</td>
              <td data-label="Retorno">${escapeHtml(formatIsoDateEs(a.returnEffectiveDate))}</td>
              <td data-label="Coste asumido">${formatMoneyMinor(exposure.salary.borrowerAssumedMinor, exposure.currency)}</td>
            </tr>`;
  }).join('')}</tbody>
          </table>
        </div>
      </div>` : '';

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

      ${inboundLoansHtml}

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
      ? registry.cumulativeCountForTeam(team.id, resolved.registrationScopeId, seasonKey) : null;

    const quotaBandsHtml = (reg.quotaBands || []).map((band) => `
      <li>${band.rosterMin}-${band.rosterMax} jugadores → mínimo ${band.formationMinimum} de formación</li>`).join('') || '<li class="gm-muted">Sin bandas declaradas.</li>';

    const documentReqHtml = (reg.documentRequirements || []).map((code) => `<li>${escapeHtml(code)}</li>`).join('')
      || '<li class="gm-muted">Sin documentos declarados.</li>';

    const linkedRules = reg.linkedPlayerRules;
    const linkAgreements = registry.linkAgreementsForClub(team.clubId);
    const linkAgreementsHtml = linkAgreements.length ? `
      <ul class="contract-modules">${linkAgreements.map((agreement) => {
        const other = agreement.lowerClubId === team.clubId ? agreement.upperClubId : agreement.lowerClubId;
        const otherTeam = teamForClubId(other);
        const direction = agreement.lowerClubId === team.clubId ? 'club inferior' : 'club superior';
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
          nationalTeamRegistry: state.nationalTeamRegistry,
          clubId: team.clubId,
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
    { id: 'operations', label: 'Operaciones' },
    // LOAN-1 (DESIGN.md 9.21, sección 20.1 del prompt).
    { id: 'loans', label: 'Cesiones' },
  ];

  const LOAN_CASE_STATUS_LABELS = {
    draft: 'Borrador', proposed: 'Propuesta enviada', countered: 'Contraoferta', awaitingOwnerConsent: 'Esperando consentimiento del propietario',
    awaitingBorrowerConsent: 'Esperando consentimiento del cesionario', awaitingPlayerConsent: 'Esperando consentimiento del jugador',
    agreed: 'Acordada', pendingDocuments: 'Pendiente de documentos', pendingRegistration: 'Pendiente de inscripción', scheduled: 'Programada',
    active: 'Activa', returnScheduled: 'Retorno programado', returned: 'Finalizada (retorno)', rejected: 'Rechazada', withdrawn: 'Retirada',
    expired: 'Expirada', blocked: 'Bloqueada', failed: 'Fallida', terminatedEarly: 'Terminada anticipadamente', convertedToPermanentTransfer: 'Convertida en traspaso definitivo',
  };

  // TRANSFER-1 (DESIGN.md 9.20) — etiquetas de estado de TransferCase para
  // Mercado > Operaciones (sección 20.3 del prompt).
  const TRANSFER_CASE_STATUS_LABELS = {
    draft: 'Borrador', awaitingOriginClub: 'Esperando club de origen', awaitingPlayerConsent: 'Esperando consentimiento',
    awaitingConditions: 'Esperando condiciones', readyToPlan: 'Lista para planificar', planned: 'Planificada', scheduled: 'Programada',
    readyToExecute: 'Lista para ejecutar', completed: 'Completada', rejected: 'Rechazada', withdrawn: 'Retirada', expired: 'Expirada', blocked: 'Bloqueada', failed: 'Fallida',
  };

  const MARKET_AVAILABILITY_LABELS = {
    free: 'Libre sin derechos conocidos',
    'free-subject-to-rights': 'Libre — sujeto a derecho preferente',
    'contract-expiring-soon': 'Contrato próximo a expirar',
    'under-contract': 'Bajo contrato',
    'agreement-in-principle': 'Acuerdo en principio con otro club',
    'affiliated-contract-unknown': 'Afiliado — contrato no cargado en este nivel de detalle',
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
    const competitionId = BM.CompetitionParticipationService.primaryLeagueCompetitionId(state.world.registries, team.id, { seasonKey });
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
    else if (activeTab === 'operations') body = renderMarketOperationsTab(team);
    else if (activeTab === 'loans') body = renderMarketLoansTab(team);

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
          playerId: player.id, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, marketRegistry: state.marketRegistry, date: isoDate, teamRegistry: state.world.registries.teams,
        }),
      }))
      .filter((row) => !filterState.status || row.availability.status === filterState.status)
      .sort((a, b) => a.player.fullName.localeCompare(b.player.fullName, 'es'));

    const shown = rowsData.slice(0, 200);
    const rows = shown.map(({ player, availability }) => {
      const isFictional = BM.MarketSeeder && player.dataSource === BM.MarketSeeder.SIMULATED_FREE_AGENT_DATA_SOURCE;
      // WORLD-CONTEXT-1: la lista de seguimiento y los hilos de negociación
      // se guardan por CLUB (`actingClubId`) — leerlos por `team.id` los
      // dejaba siempre vacíos.
      const watched = state.marketRegistry.isWatched(team.clubId, player.id);
      const mandate = state.agentRegistry.actingMandateForTransaction({ playerId: player.id, date: isoDate });
      const existingThread = state.marketRegistry.threadsForClub(team.clubId).find((t) => t.playerId === player.id);
      const clubName = player.teamId ? (getAllTeams().find((t) => t.id === player.teamId) || { fullName: player.teamId }).fullName : 'Sin club';
      const isOwnPlayer = team.roster.some((p) => p.id === player.id);
      // WORLD-SIM-1 (DESIGN.md 10.16, BUG-WORLDSIM-05): un afiliado sin
      // contrato cargado ("affiliated-contract-unknown") nunca abre
      // negociación — su cobertura contractual no existe en este nivel de
      // detalle, no es libertad contractual real.
      const canInquire = !existingThread && !isOwnPlayer
        && availability.status !== 'agreement-in-principle'
        && availability.status !== 'not-found'
        && availability.status !== 'affiliated-contract-unknown';
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
    const watchedIds = state.marketRegistry.watchlistForClub(team.clubId);
    const rows = watchedIds.map((playerId) => {
      const player = state.playerRegistry.get(playerId);
      if (!player) return '';
      const availability = BM.MarketService.resolveMarketAvailability({
        playerId, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, marketRegistry: state.marketRegistry, date: isoDate, teamRegistry: state.world.registries.teams,
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
    const resolved = BM.ContractService.resolveRulesForClub(team, {
      seasonKey, date: isoDate, operation: 'validateMarketOffer',
      domesticCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'buildMarketOfferDraft'),
    });
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
      clubId: team.clubId,
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

  // ---------------------------------------------------------------------
  // TRANSFER-1 (DESIGN.md 9.20, sección 20.1/20.2 del prompt) — asistente
  // de formalización COMPACTO: vía derivada, resumen previo, confirmar.
  // Nunca una barra de "probabilidad de fichaje" — solo razones
  // cualitativas y el mecanismo real que aplica a ESTE AIP. La UI solo
  // llama a TransferService/TransferExecutionService; nunca escribe en
  // ContractRegistry/RegistrationRegistry/Team.roster/player.teamId.
  // ---------------------------------------------------------------------
  function determineTransferMechanism(team, agreement, isoDate) {
    const originContract = state.contractRegistry.currentForPlayer(agreement.playerId, isoDate);
    if (!originContract) return { mechanism: 'free-agent-signing', originContract: null, clause: null };
    if (originContract.clubId === team.clubId) return { mechanism: 'free-agent-signing', originContract, clause: null };
    const clause = originContract.clauses.find((c) => c.type === 'player-release' && c.amount);
    if (clause) return { mechanism: 'release-clause-exercise', originContract, clause };
    return { mechanism: 'negotiated-transfer', originContract, clause: null };
  }

  function renderAgreementFormalizationHtml(team, agreement, isoDate, threadId) {
    if (!agreement.isLiveOn(isoDate)) {
      return `<p class="gm-muted">Este acuerdo en principio ya no está vivo (estado: ${escapeHtml(agreement.statusOn(isoDate))}).</p>`;
    }
    const player = state.playerRegistry.get(agreement.playerId);
    const { mechanism, originContract, clause } = determineTransferMechanism(team, agreement, isoDate);
    const pendingCase = state.transferRegistry.casesForPlayer(agreement.playerId).find((c) => !c.isTerminal(isoDate) && c.agreementInPrincipleId === agreement.id);
    const blockedInfo = pendingCase && pendingCase.statusOn(isoDate) === 'blocked' ? '<p class="gm-market-formalize-error gm-muted" role="alert">Expediente bloqueado — revisa los motivos abajo.</p>' : '';

    let mechanismLabel;
    let body;
    if (mechanism === 'free-agent-signing') {
      mechanismLabel = 'Fichaje de agente libre';
      body = `
        <p>Contrato nuevo con <strong>${escapeHtml(team.fullName)}</strong>, inscripción y licencia se crean juntos al confirmar.</p>
        <button type="button" class="gm-btn gm-btn--primary gm-transfer-formalize-btn" data-mechanism="free-agent-signing" data-agreement-id="${agreement.id}">Formalizar operación</button>`;
    } else if (mechanism === 'release-clause-exercise') {
      mechanismLabel = 'Ejercicio de cláusula de rescisión';
      body = `
        <p>Cláusula congelada del contrato con <strong>${escapeHtml((teamForClubId(originContract.clubId) || {}).fullName || originContract.clubId)}</strong>:
          <strong>${formatMoneyMinor(clause.amount.amountMinor, clause.amount.currency)}</strong>. No exige aceptación del club de origen.</p>
        <button type="button" class="gm-btn gm-btn--primary gm-transfer-formalize-btn" data-mechanism="release-clause-exercise" data-agreement-id="${agreement.id}" data-clause-id="${clause.id}">Ejercitar cláusula y formalizar</button>`;
    } else {
      mechanismLabel = 'Traspaso definitivo negociado';
      const originTeam = teamForClubId(originContract.clubId);
      body = `
        <p>${escapeHtml(player ? player.fullName : agreement.playerId)} sigue bajo contrato con <strong>${escapeHtml(originTeam ? originTeam.fullName : originContract.clubId)}</strong>
          sin cláusula de rescisión ejecutable — negocia un traspaso club-club antes de poder formalizar.</p>
        <form class="gm-transfer-offer-form" data-agreement-id="${agreement.id}">
          <label>Importe del traspaso (€) <input type="number" name="feeEuros" min="0" step="1000" required></label>
          <label><input type="checkbox" name="playerConsent" required> El jugador consiente el traspaso y la extinción de su contrato actual</label>
          <button type="submit" class="gm-btn gm-btn--primary">Proponer al club de origen</button>
        </form>
        <div class="gm-transfer-offer-result gm-muted" role="status"></div>`;
    }
    return `
      <div class="gm-transfer-formalize">
        <p class="gm-muted">Mecanismo: <strong>${escapeHtml(mechanismLabel)}</strong>${clause ? ' · restricción de inscripción ACB tras el 15-09 si aplica' : ''}</p>
        ${blockedInfo}
        ${body}
        <div class="gm-transfer-formalize-error gm-muted" role="alert"></div>
      </div>`;
  }

  function renderMarketNegotiationsTab(team, marketContext) {
    const isoDate = currentGameIsoDate();
    const threads = state.marketRegistry.threadsForClub(team.clubId);
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
        actionsHtml = renderAgreementFormalizationHtml(team, agreement, isoDate, thread.id);
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

  // TRANSFER-1 (DESIGN.md 9.20, sección 20.3 del prompt) — expedientes
  // activos/programados/completados/fallidos-bloqueados de este club
  // (como origen o destino), con motivo cuando aplica. Solo LECTURA —
  // ninguna acción de esta pestaña muta nada directamente.
  function renderMarketOperationsTab(team) {
    if (!state.transferRegistry) return '<div class="gm-card"><p class="gm-muted">Sin expedientes todavía.</p></div>';
    const isoDate = currentGameIsoDate();
    const cases = state.transferRegistry.casesForClub(team.clubId);
    if (!cases.length) {
      return '<div class="gm-card"><p class="gm-muted">Sin expedientes de traspaso/fichaje para este club — se crean al formalizar un Acuerdo en Principio desde Negociaciones.</p></div>';
    }
    const rows = cases.map((tCase) => {
      const player = state.playerRegistry.get(tCase.playerId);
      const status = tCase.statusOn(isoDate);
      const originTeam = tCase.originClubId ? teamForClubId(tCase.originClubId) : null;
      const destinationTeam = teamForClubId(tCase.destinationClubId);
      const record = tCase.transactionId ? state.transferRegistry.getTransactionRecord(tCase.transactionId) : null;
      const blockersText = status === 'blocked' && tCase.lastBlockers ? tCase.lastBlockers.map((b) => b.message).join(' · ') : '';
      return `
        <tr>
          <td data-label="Jugador">${player ? playerLinkHtml(player) : escapeHtml(tCase.playerId)}</td>
          <td data-label="Mecanismo">${escapeHtml(tCase.operationType)}</td>
          <td data-label="Origen">${originTeam ? escapeHtml(originTeam.fullName) : '—'}</td>
          <td data-label="Destino">${destinationTeam ? escapeHtml(destinationTeam.fullName) : '—'}</td>
          <td data-label="Estado">${escapeHtml(TRANSFER_CASE_STATUS_LABELS[status] || status)}${blockersText ? ` <span class="gm-muted">(${escapeHtml(blockersText)})</span>` : ''}</td>
          <td data-label="Fecha efectiva">${tCase.effectiveDate ? escapeHtml(formatIsoDateEs(tCase.effectiveDate)) : (record ? escapeHtml(formatIsoDateEs(record.effectiveDate)) : '—')}</td>
        </tr>`;
    }).join('');
    return `
      <div class="gm-card">
        <div class="gm-table-wrapper">
          <table class="gm-table">
            <thead><tr><th>Jugador</th><th>Mecanismo</th><th>Origen</th><th>Destino</th><th>Estado</th><th>Fecha efectiva</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="gm-muted">${cases.length} expediente(s) — completados/fallidos se conservan como historial, nunca se borran.</p>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // LOAN-1 (DESIGN.md 9.21, sección 20.1 del prompt) — Mercado > Cesiones.
  // Capa de presentación pura sobre LoanService/LoanExecutionService/
  // LoanCostService — ninguna regla de cesión vive aquí.
  // ---------------------------------------------------------------------
  function loanCedibleCandidates(excludeTeamId, includeTeamId) {
    const isoDate = currentGameIsoDate();
    const out = [];
    getAllTeams().forEach((t) => {
      if (excludeTeamId && t.id === excludeTeamId) return;
      if (includeTeamId && t.id !== includeTeamId) return;
      t.roster.forEach((player) => {
        const contract = state.contractRegistry.currentForPlayer(player.id, isoDate);
        if (!contract || contract.clubId !== t.clubId || !contract.isActiveOn(isoDate)) return;
        if (state.loanRegistry.activeAgreementForPlayer(player.id, isoDate)) return;
        if (state.loanRegistry.liveCasesForPlayer(player.id, isoDate).length) return;
        out.push({
          player, team: t, contract,
        });
      });
    });
    return out.sort((a, b) => a.player.fullName.localeCompare(b.player.fullName, 'es')).slice(0, 300);
  }

  function loanCaseRowHtml(loanCase, team) {
    const isoDate = currentGameIsoDate();
    const player = state.playerRegistry.get(loanCase.playerId);
    const ownerTeam = teamForClubId(loanCase.ownerClubId);
    const borrowerTeam = teamForClubId(loanCase.borrowerClubId);
    const status = loanCase.statusOn(isoDate);
    const agreement = loanCase.agreementId ? state.loanRegistry.getAgreement(loanCase.agreementId) : null;
    const counterpart = loanCase.ownerClubId === team.clubId ? borrowerTeam : ownerTeam;
    const role = loanCase.ownerClubId === team.clubId ? 'Cedes' : 'Recibes';
    let actionsHtml = '';
    if (agreement && agreement.currentStatus() === 'active') {
      const recallClause = agreement.clauses.find((c) => c.type === 'recall-right' && c.holderClubId === 'owner');
      const canRecall = loanCase.ownerClubId === team.clubId && recallClause
        && recallClause.windows.some((w) => !BM.LocalDate.isBefore(isoDate, w.startDate) && !BM.LocalDate.isAfter(isoDate, w.endDate));
      const earlyTerminationClause = agreement.clauses.find((c) => c.type === 'early-termination');
      if (canRecall) actionsHtml += `<button type="button" class="gm-btn gm-loan-recall-btn" data-agreement-id="${agreement.id}" data-recall-clause-id="${recallClause.id}">Ejercer recall</button> `;
      if (earlyTerminationClause) actionsHtml += `<button type="button" class="gm-btn gm-loan-early-term-btn" data-agreement-id="${agreement.id}" data-clause-id="${earlyTerminationClause.id}">Terminar anticipadamente</button>`;
      const purchaseClause = agreement.clauses.find((c) => (c.type === 'purchase-option' || c.type === 'purchase-obligation')
        && (c.beneficiaryClubId === 'owner' ? loanCase.ownerClubId : loanCase.borrowerClubId) === team.clubId);
      if (purchaseClause && !BM.LocalDate.isBefore(isoDate, purchaseClause.windowStart) && !BM.LocalDate.isAfter(isoDate, purchaseClause.windowEnd)) {
        actionsHtml += ` <button type="button" class="gm-btn gm-loan-exercise-option-btn" data-agreement-id="${agreement.id}" data-clause-id="${purchaseClause.id}">Ejercer ${escapeHtml(formatMoneyMinor(purchaseClause.price.amountMinor, purchaseClause.price.currency))}</button>`;
      }
    }
    const blockersText = loanCase.lastBlockers && loanCase.lastBlockers.length ? loanCase.lastBlockers.map((b) => b.message).join(' · ') : '';
    return `
      <tr>
        <td data-label="Jugador">${player ? playerLinkHtml(player) : escapeHtml(loanCase.playerId)}</td>
        <td data-label="Rol">${role}</td>
        <td data-label="Contraparte">${counterpart ? escapeHtml(counterpart.fullName) : '—'}</td>
        <td data-label="Estado">${escapeHtml(LOAN_CASE_STATUS_LABELS[status] || status)}${blockersText ? ` <span class="gm-muted">(${escapeHtml(blockersText)})</span>` : ''}</td>
        <td data-label="Retorno">${agreement ? escapeHtml(formatIsoDateEs(agreement.returnEffectiveDate)) : '—'}</td>
        <td data-label="Acciones">${actionsHtml || '—'}</td>
      </tr>`;
  }

  function renderMarketLoansTab(team) {
    if (!state.loanRegistry) return '<div class="gm-card"><p class="gm-muted">Cesiones no disponibles todavía.</p></div>';
    const isoDate = currentGameIsoDate();
    const ownCases = state.loanRegistry.casesForOwner(team.clubId);
    const inCases = state.loanRegistry.casesForBorrower(team.clubId);
    const allCases = [...ownCases, ...inCases].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const casesHtml = allCases.length
      ? `<div class="gm-table-scroll"><table class="gm-table">
          <thead><tr><th>Jugador</th><th>Rol</th><th>Contraparte</th><th>Estado</th><th>Retorno</th><th>Acciones</th></tr></thead>
          <tbody>${allCases.map((c) => loanCaseRowHtml(c, team)).join('')}</tbody>
        </table></div>`
      : '<p class="gm-muted">Sin expedientes de cesión para este club por ahora.</p>';

    const ownCandidates = loanCedibleCandidates(null, team.id);
    const otherCandidates = loanCedibleCandidates(team.id, null);
    const otherTeams = getAllTeams().filter((t) => t.id !== team.id).sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));

    const ownPlayerOptions = ownCandidates.map(({ player }) => `<option value="${player.id}">${escapeHtml(player.fullName)}</option>`).join('');
    const otherTeamOptions = otherTeams.map((t) => `<option value="${t.id}">${escapeHtml(t.fullName)}</option>`).join('');
    const otherPlayerOptions = otherCandidates.map(({ player, team: t }) => `<option value="${player.id}">${escapeHtml(player.fullName)} — ${escapeHtml(t.fullName)}</option>`).join('');

    return `
      <div class="gm-card">
        <h3>Cesiones activas y pendientes</h3>
        ${casesHtml}
      </div>
      <div class="gm-card">
        <h3>Ceder un jugador propio</h3>
        ${ownPlayerOptions ? `
        <form id="gm-loan-out-form" class="gm-loan-form">
          <label>Jugador <select name="playerId" required>${ownPlayerOptions}</select></label>
          <label>Club cesionario <select name="counterpartTeamId" required>${otherTeamOptions}</select></label>
          <label>Inicio de servicio <input type="date" name="serviceStartDate" value="${isoDate}" required></label>
          <label>Fecha de retorno <input type="date" name="returnEffectiveDate" required></label>
          <label>Canon (€) <input type="number" name="loanFeeEuros" min="0" step="1000" value="0"></label>
          <label>% de salario que retiene tu club <input type="number" name="ownerSharePercent" min="0" max="100" value="50"></label>
          <label><input type="checkbox" name="recallRight"> Reservar cláusula de recall (con preaviso de 7 días)</label>
          <label><input type="checkbox" name="purchaseOption"> Ofrecer opción de compra al cesionario</label>
          <label>Precio de la opción (€) <input type="number" name="purchaseOptionPriceEuros" min="0" step="1000" value="0"></label>
          <button type="submit" class="gm-btn gm-btn--primary">Proponer cesión</button>
        </form>
        <div class="gm-loan-out-result gm-muted"></div>` : '<p class="gm-muted">Ningún jugador propio cedible ahora mismo.</p>'}
      </div>
      <div class="gm-card">
        <h3>Solicitar la cesión de un jugador de otro club</h3>
        ${otherPlayerOptions ? `
        <form id="gm-loan-in-form" class="gm-loan-form">
          <label>Jugador <select name="playerId" required>${otherPlayerOptions}</select></label>
          <label>Inicio de servicio <input type="date" name="serviceStartDate" value="${isoDate}" required></label>
          <label>Fecha de retorno <input type="date" name="returnEffectiveDate" required></label>
          <label>Canon (€) <input type="number" name="loanFeeEuros" min="0" step="1000" value="0"></label>
          <label>% de salario que asumes <input type="number" name="borrowerSharePercent" min="0" max="100" value="50"></label>
          <button type="submit" class="gm-btn gm-btn--primary">Solicitar cesión</button>
        </form>
        <div class="gm-loan-in-result gm-muted"></div>` : '<p class="gm-muted">Ningún jugador cedible disponible en otros clubes ahora mismo.</p>'}
      </div>`;
  }

  function renderMarketRightsTab(team, marketContext) {
    if (!marketContext.capabilities.has('supportsRightOfFirstRefusal')) {
      return '<div class="gm-card"><p class="gm-muted">Esta competición no tiene procedimiento doméstico de derecho preferente codificado.</p></div>';
    }
    const cases = state.marketRegistry.rightsCasesForClub(team.clubId);
    const isoDate = currentGameIsoDate();
    if (!cases.length) {
      return `<div class="gm-card"><p class="gm-muted">Sin casos de derecho preferente abiertos para este club por ahora.</p>
        ${contractWarningsHtml(marketContext.knownSourceInconsistencies, 'Continuidad e inconsistencias conocidas de la fuente')}</div>`;
    }
    const cards = cases.map((rightsCase) => {
      const player = state.playerRegistry.get(rightsCase.playerId);
      const status = rightsCase.statusOn(isoDate);
      const isOrigin = rightsCase.originClubId === team.clubId;
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
        if (state.marketRegistry.isWatched(team.clubId, playerId)) BM.MarketService.removeWatch(state.marketRegistry, team.clubId, playerId);
        else BM.MarketService.addWatch(state.marketRegistry, team.clubId, playerId);
        renderMarketScreen();
      });
    });

    container.querySelectorAll('.gm-market-inquiry-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.playerId;
        BM.MarketService.openInquiry({
          marketRegistry: state.marketRegistry, agentRegistry: state.agentRegistry, playerId, actingClubId: team.clubId,
          prospectiveCompetitionIds: [BM.CompetitionParticipationService.primaryLeagueCompetitionId(state.world.registries, team.id, { seasonKey: buildCareerSeasonKey() })],
          date: isoDate,
          marketContext,
          careerSeed,
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
        // BUG-MARKET1-03 (DESIGN.md 9.20): `createAndSendOffer()` valida
        // SIEMPRE internamente — la UI ya no puede pasar un `validation`
        // ajeno para saltarse la comprobación; se pasan las dependencias
        // completas (team/player/playerRegistry/contractRegistry) para que
        // el comando revalide él mismo el borrador exacto.
        const commonOfferParams = {
          marketRegistry: state.marketRegistry, thread, draft, offeredBy: 'club', rolePromise: { role: formData.role }, date: isoDate, careerSeed,
          marketContext, team, player, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, seasonKey: buildCareerSeasonKey(),
        };
        if (form.dataset.mode === 'counter') {
          const liveOffer = state.marketRegistry.liveOfferForThread(threadId, isoDate);
          liveOffer.addEvent({ id: `${liveOffer.id}:club-countered`, type: 'offer-countered', date: isoDate });
          state.marketRegistry.releaseBudgetGroup(`res:${liveOffer.id}`);
          BM.MarketService.createAndSendOffer({
            ...commonOfferParams, parentOfferId: liveOffer.id, version: liveOffer.version + 1,
          });
        } else {
          BM.MarketService.createAndSendOffer(commonOfferParams);
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

    // -----------------------------------------------------------------
    // TRANSFER-1 (DESIGN.md 9.20) — formalización desde un AIP vivo.
    // Siempre pasa por TransferService/TransferExecutionService; nunca
    // escribe en ContractRegistry/RegistrationRegistry/Team.roster/
    // player.teamId directamente. Un blocker se muestra tal cual, sin
    // "arreglar" nada por su cuenta.
    // -----------------------------------------------------------------
    container.querySelectorAll('.gm-transfer-formalize-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const agreement = state.marketRegistry.getAgreement(btn.dataset.agreementId);
        if (!agreement) return;
        const errorEl = btn.closest('.gm-transfer-formalize').querySelector('.gm-transfer-formalize-error');
        const deps = {
          transferRegistry: state.transferRegistry, marketRegistry: state.marketRegistry, registrationRegistry: state.registrationRegistry,
          contractRegistry: state.contractRegistry, playerRegistry: state.playerRegistry, teams: getAllTeams(),
          operationalContext: currentTransferOperationalContext(), lineup: state.lineup,
        };
        const seasonKey = buildCareerSeasonKey();
        try {
          let outcome;
          if (btn.dataset.mechanism === 'free-agent-signing') {
            outcome = BM.TransferService.formalizeFreeAgentSigning({
              ...deps, agreement, destinationTeam: team, seasonKey, effectiveDate: isoDate, now: isoDate, commit: true,
              // WORLD-CONTEXT-1: contexto competitivo por PAPEL.
              destinationCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'formalizeFreeAgentSigning'),
            });
          } else if (btn.dataset.mechanism === 'release-clause-exercise') {
            const originContract = state.contractRegistry.currentForPlayer(agreement.playerId, isoDate);
            const originTeam = teamForClubId(originContract.clubId);
            outcome = BM.TransferService.formalizeReleaseClauseExercise({
              ...deps, agreement, originTeam, destinationTeam: team, seasonKey, effectiveDate: isoDate, now: isoDate, commit: true,
              originCompetitionId: domesticCompetitionIdForTeam(originTeam, seasonKey, 'formalizeReleaseClause:origin'),
              destinationCompetitionId: domesticCompetitionIdForTeam(team, seasonKey, 'formalizeReleaseClause:destination'),
              clauseId: btn.dataset.clauseId, exercisedBy: 'player',
            });
          }
          if (outcome.plan.blockers.length) {
            errorEl.textContent = outcome.plan.blockers.map((b) => b.message).join(' · ');
            return;
          }
          cleanupSessionReferencesForPlayer(agreement.playerId);
          if (outcome.result && outcome.result.record) pushTransferCompletionNews(outcome.transferCase);
          renderMarketScreen();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    });

    container.querySelectorAll('.gm-transfer-offer-form').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const agreement = state.marketRegistry.getAgreement(form.dataset.agreementId);
        if (!agreement) return;
        const resultEl = form.parentElement.querySelector('.gm-transfer-offer-result');
        const data = new FormData(form);
        const feeEuros = Number(data.get('feeEuros'));
        const playerConsent = Boolean(data.get('playerConsent'));
        if (!feeEuros || feeEuros <= 0) { resultEl.textContent = 'Introduce un importe válido.'; return; }
        const originContract = state.contractRegistry.currentForPlayer(agreement.playerId, isoDate);
        const originTeam = teamForClubId(originContract.clubId);
        const player = state.playerRegistry.get(agreement.playerId);
        const feeMinor = Math.round(feeEuros * 100);
        // BUG-TRANSFER1-18 (DESIGN.md 9.21): id determinista por ronda de
        // negociación (nunca `Date.now()` — ver comentario de
        // `state.transferNegotiationOfferSequence` más arriba).
        state.transferNegotiationOfferSequence[agreement.id] = (state.transferNegotiationOfferSequence[agreement.id] || 0) + 1;
        const offerRound = state.transferNegotiationOfferSequence[agreement.id];
        const proposedOffer = { id: `ui-offer:${agreement.id}:${offerRound}`, fee: { amountMinor: feeMinor, currency: 'EUR' } };
        const evaluation = BM.TransferService.evaluateSellingClub({
          originTeam, player, originContract, offer: proposedOffer, careerSeed, date: isoDate, seasonKey: buildCareerSeasonKey(),
        });
        if (evaluation.decision === 'reject') {
          resultEl.textContent = `${escapeHtml(originTeam.fullName)} rechaza la propuesta: ${evaluation.reasons.join(' ')}`;
          return;
        }
        if (evaluation.decision === 'counter') {
          const counterFeeMinor = BM.TransferService.generateCounterFee({ originalFeeMinor: feeMinor, careerSeed, offerId: proposedOffer.id, roundIndex: 0 });
          resultEl.textContent = `${escapeHtml(originTeam.fullName)} contraoferta: ${formatMoneyMinor(counterFeeMinor, 'EUR')} (${evaluation.reasons.join(' ')})`;
          // El campo declara step="1000" (renderAgreementFormalizationHtml)
          // — un importe sugerido que no cayera en un múltiplo de 1000
          // bloquearía en silencio el siguiente envío (validación nativa
          // del formulario, sin disparar 'submit' ni mostrar error propio)
          // si el usuario reenvía tal cual el valor sugerido.
          form.querySelector('input[name=feeEuros]').value = Math.round(counterFeeMinor / 100 / 1000) * 1000;
          return;
        }
        if (!playerConsent) {
          resultEl.textContent = `${escapeHtml(originTeam.fullName)} acepta ${formatMoneyMinor(feeMinor, 'EUR')} — falta el consentimiento del jugador para formalizar.`;
          return;
        }
        try {
          const outcome = BM.TransferService.formalizeNegotiatedTransfer({
            transferRegistry: state.transferRegistry, marketRegistry: state.marketRegistry, registrationRegistry: state.registrationRegistry,
            contractRegistry: state.contractRegistry, playerRegistry: state.playerRegistry, teams: getAllTeams(),
            agreement, originTeam, destinationTeam: team, seasonKey: buildCareerSeasonKey(), effectiveDate: isoDate, now: isoDate, commit: true,
            originCompetitionId: domesticCompetitionIdForTeam(originTeam, buildCareerSeasonKey(), 'formalizeNegotiatedTransfer:origin'),
            destinationCompetitionId: domesticCompetitionIdForTeam(team, buildCareerSeasonKey(), 'formalizeNegotiatedTransfer:destination'),
            clubOffer: proposedOffer, playerConsentGrantedAt: isoDate,
            operationalContext: currentTransferOperationalContext(), lineup: state.lineup,
          });
          if (outcome.plan.blockers.length) {
            resultEl.textContent = outcome.plan.blockers.map((b) => b.message).join(' · ');
            return;
          }
          cleanupSessionReferencesForPlayer(agreement.playerId);
          if (outcome.result && outcome.result.record) pushTransferCompletionNews(outcome.transferCase);
          renderMarketScreen();
        } catch (err) {
          resultEl.textContent = err.message;
        }
      });
    });

    wireMarketLoansTabActions(container, team, isoDate, careerSeed);
  }

  // ---------------------------------------------------------------------
  // LOAN-1 (DESIGN.md 9.21, sección 20.1/20.2 del prompt) — negociación
  // tripartita resuelta en un único envío (mismo patrón UX que el
  // formulario de oferta club-club de TRANSFER-1): propone -> el club CPU
  // evalúa determinísticamente -> si acepta, el jugador reacciona -> si las
  // tres partes consienten sobre la MISMA versión, se forma el acuerdo y se
  // activa de inmediato (la UI solo admite cesiones que empiezan HOY —
  // simplificación de producto explícita, documentada en DESIGN.md 9.21;
  // una cesión programada para el futuro queda fuera de esta entrega).
  // ---------------------------------------------------------------------
  function buildLoanClausesFromForm(data) {
    const clauses = [];
    if (data.get('recallRight')) {
      clauses.push({
        type: 'recall-right', holderClubId: 'owner', noticeDays: 7,
        windows: [{ startDate: data.get('serviceStartDate'), endDate: data.get('returnEffectiveDate') }],
      });
    }
    if (data.get('purchaseOption')) {
      const priceEuros = Number(data.get('purchaseOptionPriceEuros'));
      if (priceEuros > 0) {
        clauses.push({
          type: 'purchase-option', beneficiaryClubId: 'borrower', price: { amountMinor: Math.round(priceEuros * 100), currency: 'EUR' },
          windowStart: data.get('serviceStartDate'), windowEnd: data.get('returnEffectiveDate'),
        });
      }
    }
    return clauses;
  }

  function runLoanNegotiation(params) {
    const {
      loanRegistry, contractRegistry, teams, ownerTeam, borrowerTeam, playerId, initiatingClubId, now, seasonKey,
      serviceStartDate, returnEffectiveDate, loanFee, salaryAllocation, clauses, careerSeed, operationalContext, resultEl,
    } = params;
    // BUG-TRANSFER1-18 (DESIGN.md 9.21, mismo criterio aplicado a LOAN-1):
    // id determinista por intento — nunca `Date.now()`, y nunca reutiliza
    // el id de un expediente anterior (aunque ya sea terminal) para la
    // MISMA combinación jugador/propietario/cesionario/fecha.
    const attemptKey = `${playerId}:${ownerTeam.id}:${borrowerTeam.id}:${serviceStartDate}`;
    state.loanNegotiationAttemptSequence[attemptKey] = (state.loanNegotiationAttemptSequence[attemptKey] || 0) + 1;
    const attempt = state.loanNegotiationAttemptSequence[attemptKey];
    // WORLD-CONTEXT-1: competiciones de PROPIETARIO y CESIONARIO resueltas
    // por separado desde sus Entries reales de esta temporada.
    const ownerCompetitionId = domesticCompetitionIdForTeam(ownerTeam, seasonKey, 'loan:owner');
    const borrowerCompetitionId = domesticCompetitionIdForTeam(borrowerTeam, seasonKey, 'loan:borrower');
    const { loanCase, proposal, resolvedRules } = BM.LoanService.openCaseAndPropose({
      loanRegistry, contractRegistry, ownerTeam, borrowerTeam, playerId, initiatingClubId, now, seasonKey,
      ownerCompetitionId, borrowerCompetitionId,
      serviceStartDate, returnEffectiveDate, loanFee, salaryAllocation, clauses,
      medicalResponsibility: { responsibleParty: 'borrower' }, insuranceResponsibility: { responsibleParty: 'shared' },
      documentsRequired: [], expiresAt: now,
      id: `loan-case:${attemptKey}:${attempt}`,
    });
    if (resolvedRules.blockers.length) {
      loanCase.addEvent({ id: `${loanCase.id}:blocked`, type: 'blocked', date: now });
      resultEl.textContent = resolvedRules.blockers.map((b) => b.message).join(' · ');
      return;
    }
    const initiatingIsOwner = initiatingClubId === ownerTeam.clubId;
    BM.LoanService.grantConsent({
      loanRegistry, loanCase, partyType: initiatingIsOwner ? 'ownerClub' : 'borrowerClub', partyId: initiatingClubId, now, grantedBy: 'gm',
    });
    const player = state.playerRegistry.get(playerId);
    const masterContract = contractRegistry.get(loanCase.masterContractId);
    const counterpartEvaluation = initiatingIsOwner
      ? BM.LoanService.evaluateBorrowerClub({
        borrowerTeam, player, proposal, careerSeed, date: now,
      })
      : BM.LoanService.evaluateOwnerClub({
        ownerTeam, player, masterContract, proposal, careerSeed, date: now,
      });
    if (counterpartEvaluation.decision !== 'accept') {
      loanCase.addEvent({ id: `${loanCase.id}:${counterpartEvaluation.decision === 'counter' ? 'countered' : 'rejected'}`, type: counterpartEvaluation.decision === 'counter' ? 'countered' : 'rejected', date: now });
      resultEl.textContent = `${initiatingIsOwner ? borrowerTeam.fullName : ownerTeam.fullName} ${counterpartEvaluation.decision === 'counter' ? 'pide mejorar las condiciones' : 'rechaza la propuesta'}: ${counterpartEvaluation.reasons.join(' ')}`;
      return;
    }
    BM.LoanService.grantConsent({
      loanRegistry, loanCase, partyType: initiatingIsOwner ? 'borrowerClub' : 'ownerClub', partyId: initiatingIsOwner ? borrowerTeam.clubId : ownerTeam.clubId, now, grantedBy: 'gm',
    });
    const playerEvaluation = BM.LoanService.evaluatePlayerReaction({
      player, proposal, borrowerTeam, careerSeed, date: now, borrowerCompetitionId,
    });
    if (playerEvaluation.decision !== 'accept') {
      loanCase.addEvent({ id: `${loanCase.id}:rejected`, type: 'rejected', date: now });
      resultEl.textContent = `${player.fullName} no acepta la cesión: ${playerEvaluation.reasons.join(' ')}`;
      return;
    }
    BM.LoanService.grantConsent({
      loanRegistry, loanCase, partyType: 'player', partyId: playerId, now, grantedBy: playerId,
    });
    const agreement = BM.LoanService.formAgreement({
      loanRegistry, contractRegistry, loanCase, now, resolvedRules,
    });
    const { plan, result } = BM.LoanService.activateLoan({
      loanRegistry,
      playerRegistry: state.playerRegistry,
      contractRegistry,
      registrationRegistry: state.registrationRegistry,
      transferRegistry: state.transferRegistry,
      teams,
      agreement,
      ownerTeam,
      borrowerTeam,
      ownerCompetitionId,
      borrowerCompetitionId,
      now,
      effectiveDate: serviceStartDate,
      seasonKey,
      operationalContext,
      lineup: state.lineup,
      commit: true,
    });
    if (plan.blockers.length) {
      resultEl.textContent = plan.blockers.map((b) => b.message).join(' · ');
      return;
    }
    if (result && result.record) {
      cleanupSessionReferencesForPlayer(playerId);
      pushLoanNews(agreement, 'activated');
    }
    renderMarketScreen();
  }

  function wireMarketLoansTabActions(container, team, isoDate, careerSeed) {
    const outForm = byId('gm-loan-out-form');
    if (outForm) {
      outForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const resultEl = container.querySelector('.gm-loan-out-result');
        const data = new FormData(outForm);
        const counterpartTeam = getAllTeams().find((t) => t.id === data.get('counterpartTeamId'));
        if (!counterpartTeam) return;
        const feeEuros = Number(data.get('loanFeeEuros')) || 0;
        const ownerShare = Math.round(Number(data.get('ownerSharePercent')) * 100);
        try {
          runLoanNegotiation({
            loanRegistry: state.loanRegistry, contractRegistry: state.contractRegistry, teams: getAllTeams(),
            ownerTeam: team, borrowerTeam: counterpartTeam, playerId: data.get('playerId'), initiatingClubId: team.clubId,
            now: isoDate, seasonKey: buildCareerSeasonKey(), serviceStartDate: data.get('serviceStartDate'), returnEffectiveDate: data.get('returnEffectiveDate'),
            loanFee: feeEuros > 0 ? { amountMinor: Math.round(feeEuros * 100), currency: 'EUR' } : null,
            salaryAllocation: { ownerShareBasisPoints: ownerShare, borrowerShareBasisPoints: 10000 - ownerShare },
            clauses: buildLoanClausesFromForm(data), careerSeed, operationalContext: currentTransferOperationalContext(), resultEl,
          });
        } catch (err) {
          resultEl.textContent = err.message;
        }
      });
    }

    const inForm = byId('gm-loan-in-form');
    if (inForm) {
      inForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const resultEl = container.querySelector('.gm-loan-in-result');
        const data = new FormData(inForm);
        const playerId = data.get('playerId');
        const sourceContract = state.contractRegistry.currentForPlayer(playerId, isoDate);
        const ownerTeam = sourceContract ? teamForClubId(sourceContract.clubId) : null;
        if (!ownerTeam) { resultEl.textContent = 'El jugador seleccionado ya no está disponible.'; return; }
        const feeEuros = Number(data.get('loanFeeEuros')) || 0;
        const borrowerShare = Math.round(Number(data.get('borrowerSharePercent')) * 100);
        try {
          runLoanNegotiation({
            loanRegistry: state.loanRegistry, contractRegistry: state.contractRegistry, teams: getAllTeams(),
            ownerTeam, borrowerTeam: team, playerId, initiatingClubId: team.clubId,
            now: isoDate, seasonKey: buildCareerSeasonKey(), serviceStartDate: data.get('serviceStartDate'), returnEffectiveDate: data.get('returnEffectiveDate'),
            loanFee: feeEuros > 0 ? { amountMinor: Math.round(feeEuros * 100), currency: 'EUR' } : null,
            salaryAllocation: { ownerShareBasisPoints: 10000 - borrowerShare, borrowerShareBasisPoints: borrowerShare },
            clauses: [], careerSeed, operationalContext: currentTransferOperationalContext(), resultEl,
          });
        } catch (err) {
          resultEl.textContent = err.message;
        }
      });
    }

    container.querySelectorAll('.gm-loan-recall-btn, .gm-loan-early-term-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const agreement = state.loanRegistry.getAgreement(btn.dataset.agreementId);
        if (!agreement) return;
        const ownerTeam = teamForClubId(agreement.ownerClubId);
        const borrowerTeam = teamForClubId(agreement.borrowerClubId);
        const isRecall = btn.classList.contains('gm-loan-recall-btn');
        try {
          const { plan, result } = isRecall
            ? BM.LoanService.recallLoan({
              loanRegistry: state.loanRegistry, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry,
              registrationRegistry: state.registrationRegistry, transferRegistry: state.transferRegistry, teams: getAllTeams(),
              agreement, ownerTeam, borrowerTeam, now: isoDate, effectiveDate: isoDate, seasonKey: buildCareerSeasonKey(),
              ownerCompetitionId: domesticCompetitionIdForTeam(ownerTeam, buildCareerSeasonKey(), 'loan:recall:owner'),
              borrowerCompetitionId: domesticCompetitionIdForTeam(borrowerTeam, buildCareerSeasonKey(), 'loan:recall:borrower'),
              operationalContext: currentTransferOperationalContext(), lineup: state.lineup, commit: true, recallClauseId: btn.dataset.recallClauseId,
            })
            : BM.LoanService.earlyTerminateLoan({
              loanRegistry: state.loanRegistry, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry,
              registrationRegistry: state.registrationRegistry, transferRegistry: state.transferRegistry, teams: getAllTeams(),
              agreement, ownerTeam, borrowerTeam, now: isoDate, effectiveDate: isoDate, seasonKey: buildCareerSeasonKey(),
              ownerCompetitionId: domesticCompetitionIdForTeam(ownerTeam, buildCareerSeasonKey(), 'loan:early-term:owner'),
              borrowerCompetitionId: domesticCompetitionIdForTeam(borrowerTeam, buildCareerSeasonKey(), 'loan:early-term:borrower'),
              operationalContext: currentTransferOperationalContext(), lineup: state.lineup, commit: true,
              earlyTerminationClauseId: btn.dataset.clauseId, earlyTerminationConsents: ['ownerClub', 'borrowerClub', 'player'],
            });
          if (plan.blockers.length) { window.alert(plan.blockers.map((b) => b.message).join(' · ')); return; }
          if (result && result.record) {
            cleanupSessionReferencesForPlayer(agreement.playerId);
            pushLoanNews(agreement, isRecall ? 'returned' : 'early-termination', { registrationOutcome: result.registrationOutcome });
          }
          renderMarketScreen();
        } catch (err) {
          window.alert(err.message);
        }
      });
    });

    container.querySelectorAll('.gm-loan-exercise-option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const agreement = state.loanRegistry.getAgreement(btn.dataset.agreementId);
        if (!agreement) return;
        try {
          const exercise = BM.LoanService.exercisePurchaseOption({
            loanRegistry: state.loanRegistry, agreement, clauseId: btn.dataset.clauseId, exercisedAt: isoDate,
          });
          const beneficiaryTeam = teamForClubId(exercise.beneficiaryClubId);
          pushLoanNews(agreement, 'option-exercised', { beneficiaryTeamName: beneficiaryTeam ? beneficiaryTeam.fullName : '' });
          window.alert('Opción ejercida — el propietario queda obligado a vender según los términos pactados. La operación definitiva se formaliza como un traspaso normal en Mercado > Buscar jugadores / Negociaciones una vez el jugador dé su consentimiento.');
          renderMarketScreen();
        } catch (err) {
          window.alert(err.message);
        }
      });
    });
  }

  // TRANSFER-1 (DESIGN.md 9.20, sección 15.3 del prompt) — limpieza de
  // referencias operativas de SESIÓN que solo viven en `state` (nunca en
  // Team, que ya limpia RosterMutationService): un jugador que acaba de
  // salir de la plantilla del usuario no debe seguir "convocado" en la
  // alineación en curso ni con un foco de entrenamiento/rol táctico
  // fantasma. Se llama SIEMPRE después de un commit de TRANSFER-1 que
  // haya podido mover a un jugador dentro o fuera del roster del usuario.
  // BUG-TRANSFER1-16 (DESIGN.md 9.21): contexto operacional EXPLÍCITO que
  // `TransferExecutionService.planTransaction()`/`commitTransaction()`
  // exigen desde ahora como dependencia obligatoria — antes ningún llamador
  // real de la UI lo pasaba nunca (el parámetro opcional
  // `pendingUserMatchBlocks` se leía siempre como "falso" por ausencia), así
  // que la protección de "hay un partido del usuario en curso o pendiente
  // de revelar" solo funcionaba en fixtures de test. `state.matchReveal`
  // (revelado progresivo por cuartos, sección "Interfaz de juego" de
  // CLAUDE.md) es no-null exactamente mientras esa pantalla está activa.
  function currentTransferOperationalContext() {
    return { pendingUserMatchBlocks: Boolean(state.matchReveal) };
  }

  function cleanupSessionReferencesForPlayer(playerId) {
    if (state.lineup) {
      state.lineup.squadIds = (state.lineup.squadIds || []).filter((id) => id !== playerId);
      if (state.lineup.entries) {
        Object.keys(state.lineup.entries).forEach((positionKey) => {
          const row = state.lineup.entries[positionKey] || {};
          Object.keys(row).forEach((slotKey) => {
            const slot = row[slotKey];
            if (slot && slot.playerId === playerId) slot.playerId = null;
          });
        });
      }
      if (Array.isArray(state.lineup.fixedSegments)) {
        state.lineup.fixedSegments = state.lineup.fixedSegments.filter((seg) => seg.playerId !== playerId);
      }
    }
  }

  function renderPlayerMarketTab(player, team) {
    if (!state.marketRegistry || !state.agentRegistry) return '<div class="gm-card"><p class="gm-muted">Mercado no disponible todavía.</p></div>';
    const isoDate = currentGameIsoDate();
    const availability = BM.MarketService.resolveMarketAvailability({
      playerId: player.id, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, marketRegistry: state.marketRegistry, date: isoDate, teamRegistry: state.world.registries.teams,
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
      ${renderPlayerTransferHistoryHtml(player, isoDate)}
      <p class="gm-muted contract-scope-note">Esta pestaña sigue la ficha universal (Player Registry), incluso libre y sin club.</p>`;
  }

  // TRANSFER-1 (DESIGN.md 9.20, sección 20.5 del prompt) — "AIP y
  // expediente activo; mecanismo y fecha efectiva; traspasos/liberaciones
  // históricos; derechos y compensaciones" de la ficha universal. Resuelve
  // SIEMPRE desde `state.transferRegistry` (Player Registry como ancla),
  // nunca desde `Team.roster` — un jugador libre en pleno expediente sigue
  // mostrando su historial. Solo lectura: no hay ninguna acción aquí.
  function renderPlayerTransferHistoryHtml(player, isoDate) {
    if (!state.transferRegistry) return '';
    const cases = state.transferRegistry.casesForPlayer(player.id);
    if (!cases.length) return '';
    const activeCase = cases.find((c) => !c.isTerminal(isoDate));
    const completed = cases.filter((c) => c.statusOn(isoDate) === 'completed').sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));

    let activeHtml = '';
    if (activeCase) {
      const status = activeCase.statusOn(isoDate);
      const blockersText = status === 'blocked' && activeCase.lastBlockers ? activeCase.lastBlockers.map((b) => b.message).join(' · ') : '';
      activeHtml = `
        <div class="gm-card">
          <h3>Expediente activo</h3>
          <p>Mecanismo: <strong>${escapeHtml(activeCase.mechanism)}</strong> · Estado: ${escapeHtml(TRANSFER_CASE_STATUS_LABELS[status] || status)}
            ${activeCase.effectiveDate ? ` · Fecha efectiva: ${escapeHtml(formatIsoDateEs(activeCase.effectiveDate))}` : ''}</p>
          ${blockersText ? `<p class="gm-muted">${escapeHtml(blockersText)}</p>` : ''}
        </div>`;
    }

    let historyHtml = '';
    if (completed.length) {
      const rows = completed.map((tCase) => {
        const record = tCase.transactionId ? state.transferRegistry.getTransactionRecord(tCase.transactionId) : null;
        const originTeam = tCase.originClubId ? teamForClubId(tCase.originClubId) : null;
        const destinationTeam = teamForClubId(tCase.destinationClubId);
        const obligations = record ? state.transferRegistry.obligationsForTransaction(record.id) : [];
        const compensationText = obligations.length
          ? obligations.map((o) => `${escapeHtml(o.concept)}: ${formatMoneyMinor(o.amountMinor, o.currency)}`).join(' · ')
          : 'sin compensación registrada';
        return `<li>${escapeHtml(formatIsoDateEs(tCase.effectiveDate))} — ${escapeHtml(tCase.mechanism)}:
          ${originTeam ? escapeHtml(originTeam.fullName) : 'agente libre'} → ${destinationTeam ? escapeHtml(destinationTeam.fullName) : '—'}
          <span class="gm-muted">(${compensationText})</span></li>`;
      }).join('');
      historyHtml = `<div class="gm-card"><h3>Traspasos y liberaciones históricos</h3><ul>${rows}</ul></div>`;
    }
    return activeHtml + historyHtml;
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
    // CYCLE-1 (DESIGN.md 9.22, BUG-CYCLE1-03) — CORREGIDO: este render llamaba
    // a `ensureCareerHistory()` (un COMANDO que inicializa/normaliza) en cada
    // apertura de ficha, mutando al jugador solo por consultarlo. Ahora TODO
    // punto que crea o registra un jugador (bootstrapCycleForNewCareer() al
    // arrancar la carrera, AcademyService.runAnnualIntake(),
    // RosterLegalityService's emergencia) llama a
    // `WorldLifecycleService.initializePlayerLifecycle()` una sola vez, así
    // que al llegar aquí `careerHistory` YA existe siempre — el render solo
    // LEE. Si algún jugador legacy llegara sin ella, se muestra diagnóstico
    // en vez de inicializar durante la consulta.
    const ch = player.careerHistory;
    if (!ch) {
      container.innerHTML = `
        <button id="player-profile-back-btn" class="gm-btn player-profile__back" type="button">← Volver</button>
        <p class="gm-muted">Ficha no disponible: este jugador no tiene historial de carrera inicializado.</p>`;
      byId('player-profile-back-btn').addEventListener('click', closePlayerProfile);
      return;
    }
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
    'team-select', 'home', 'world', 'lineup', 'tactics', 'training', 'medical', 'contracts', 'registrations', 'market', 'cycle', 'agenda', 'news', 'calendar', 'competitions', 'stats', 'match',
    'save-load',
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

    if (screen === 'team-select') renderCareerSetupScreen();
    if (screen === 'home') renderHomeScreen();
    if (screen === 'world') renderWorldScreen();
    if (screen === 'lineup') renderLineupScreen();
    if (screen === 'tactics') renderTacticsScreen();
    if (screen === 'training') renderTrainingScreen();
    if (screen === 'medical') renderMedicalScreen();
    if (screen === 'contracts') renderContractsScreen();
    if (screen === 'registrations') renderRegistrationsScreen();
    if (screen === 'market') renderMarketScreen();
    if (screen === 'cycle') renderCycleScreen();
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
    if (screen === 'save-load') renderSaveLoadScreen();
    if (screen === 'player-profile') renderPlayerProfileScreen();
  }

  // SAVE-LOAD-1 (sección 6 del prompt: "extrae, si hace falta, un
  // resetCareerState() reutilizable"): extraído tal cual del botón "Volver
  // a selección de equipo" — sin cambios de comportamiento. Reutilizado
  // también ANTES de hidratar una carrera guardada (`loadCareerFromSlot()`)
  // para que una carga nunca mezcle registros de la sesión anterior con
  // los del guardado.
  function resetCareerState() {
    {
      // WORLD-CALENDAR-1 (DESIGN.md 10.14): mismo criterio que el resto de
      // agregados por carrera — el calendario mundial, su coordinador y el
      // servicio de schedules pertenecen a UNA partida y nunca sobreviven a
      // "Volver a selección de equipo".
      state.calendar = null;
      state.calendarCoordinator = null;
      state.scheduleService = null;
      state.pendingStop = null;
      state.competitionEngine = null;
      // WORLD-SIM-1: mismo criterio — instancia por carrera, nunca sobrevive.
      state.competitionSimulationService = null;
      state.uiFocusCompetitionEditionId = null;
      state.uiFocusStageId = null;
      state.userTeamId = null;
      state.userClubId = null;
      // WORLD-CORE-1: mismo criterio que el resto de registros de esta
      // sección — el mundo pertenece a UNA partida, nunca sobrevive a
      // "Volver a selección de equipo".
      state.world = null;
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
      // TRANSFER-1 (DESIGN.md 9.20): mismo criterio — expedientes/
      // ofertas club-club/obligaciones/TransactionRecords pertenecen a
      // UNA partida, nunca sobreviven a "Volver a selección de equipo".
      state.transferRegistry = null;
      state.transferNegotiationOfferSequence = {};
      // LOAN-1 (DESIGN.md 9.21): mismo criterio — expedientes/propuestas/
      // consentimientos/acuerdos de cesión pertenecen a UNA partida, nunca
      // sobreviven a "Volver a selección de equipo".
      state.loanRegistry = null;
      state.loanNegotiationAttemptSequence = {};
      // CYCLE-1 (DESIGN.md 9.22): mismo criterio — ciclos anuales,
      // expedientes de club, renovaciones, retiradas, academia y evidencia
      // de último partido oficial pertenecen a UNA partida.
      state.annualCycleRegistry = null;
      state.academyRegistry = null;
      state.lastOfficialMatchEvidence = null;
      state.annualCycle = null;
      state.cycleWarnings = [];
      state.cycleLastTransition = null;
      // NATIONAL-TEAMS-1 (DESIGN.md 10.17): mismo criterio — el registro
      // nacional pertenece a UNA partida, nunca sobrevive a "Volver a
      // selección de equipo".
      state.nationalTeamRegistry = null;
      // WORLD-UI-1 (DESIGN.md 10.18): mismo criterio — snapshot/borrador de
      // configuración y proyección legacy de división pertenecen a UNA
      // partida; el catálogo (dato estático de los paquetes) puede
      // reutilizarse tal cual.
      state.careerSetupSnapshot = null;
      state.careerSetupDraft = null;
      state.installedContentPacks = null;
      state.contentPackLifecycle = null;
      state.worldView = {
        kind: 'area', areaId: null, competitionDefinitionId: null, editionId: null,
      };
      // SAVE-LOAD-1: los logs/estado de interfaz no reconstruibles y la
      // alineación en curso tampoco deben sobrevivir a "Volver a selección
      // de equipo" — mismo criterio que el resto de este bloque.
      state.newsLog = [];
      state.medicalAgendaLog = [];
      state.marketAgendaLog = [];
      state.lineup = null;
      state.lastAutosaveError = null;
    }
  }

  let uiHandlersWired = false;
  // SAVE-LOAD-1: separado de `init()` para poder inicializar la "carcasa"
  // de la interfaz (nav, botón de volver, delegación de fichas de
  // jugador) sin renderizar TAMBIÉN la pantalla de configuración de
  // carrera — "Continuar"/"Cargar partida" desde la landing necesitan la
  // carcasa lista pero van directas a `Home` con la carrera ya hidratada,
  // nunca pasan por la pantalla de selección de equipo. Idempotente.
  function ensureUiHandlersWired() {
    if (uiHandlersWired) return;
    uiHandlersWired = true;
    byId('gm-nav').querySelectorAll('.gm-nav__btn').forEach((btn) => {
      btn.addEventListener('click', () => goToScreen(btn.dataset.screen));
    });
    byId('gm-back-to-team-select').addEventListener('click', () => {
      resetCareerState();
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
  }

  function init() {
    ensureUiHandlersWired();
    renderCareerSetupScreen();
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
        // SAVE-LOAD-1 (checkpoint 2/3): autoguardado tras confirmar el
        // partido del usuario ya resuelto y revelado por completo (modo
        // 'replay').
        autoSaveCareer();
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
        // SAVE-LOAD-1 (checkpoint 2/3): autoguardado tras confirmar el
        // partido del usuario ya resuelto (modo 'live', motor pausable).
        autoSaveCareer();
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

  // =========================================================================
  // SAVE-LOAD-1 (persistencia real de partidas) — orquestación de la capa
  // UI: decide CUÁNDO guardar/cargar y ensambla el runtime/metadata que
  // `CareerPersistenceBoundary`/`CareerHydrationService` necesitan de forma
  // EXPLÍCITA. Nunca contiene serialización profunda, validación de
  // fingerprint/schema ni acceso directo a IndexedDB (eso vive en
  // `CareerPersistenceBoundary.js`/`CareerHydrationService.js`/
  // `src/storage/IndexedDbCareerSaveRepository.js`).
  // =========================================================================

  const SAVE_FORMAT = 'basket-manager-career-save';
  const SAVE_SCHEMA_VERSION = 1;
  const AUTOSAVE_SLOT_ID = 'autosave';

  // Runtime EXPLÍCITO para `CareerPersistenceBoundary.project()`/
  // `canSave()` — mismas dependencias que ya usa `buildWorldCalendarCoordinator()`
  // (`state.*`), nunca leídas por el boundary/hidratador por su cuenta.
  function buildCareerSaveRuntime() {
    return {
      careerSetupSnapshot: state.careerSetupSnapshot,
      world: state.world,
      calendar: state.calendar,
      registries: {
        playerRegistry: state.playerRegistry,
        contractRegistry: state.contractRegistry,
        registrationRegistry: state.registrationRegistry,
        agentRegistry: state.agentRegistry,
        marketRegistry: state.marketRegistry,
        transferRegistry: state.transferRegistry,
        loanRegistry: state.loanRegistry,
        annualCycleRegistry: state.annualCycleRegistry,
        academyRegistry: state.academyRegistry,
        nationalTeamRegistry: state.nationalTeamRegistry,
      },
      installedContentPacks: state.installedContentPacks,
      competitionEngine: state.competitionEngine,
      uiState: {
        newsLog: state.newsLog,
        medicalAgendaLog: state.medicalAgendaLog,
        marketAgendaLog: state.marketAgendaLog,
        lineup: state.lineup,
        negotiationSequences: {
          transferNegotiationOfferSequence: state.transferNegotiationOfferSequence,
          loanNegotiationAttemptSequence: state.loanNegotiationAttemptSequence,
        },
      },
      // Sección 7 del prompt: "no permitas guardar mientras exista
      // resolución/revelado activo de un partido" — `state.matchReveal` es
      // el estado compartido de revelado tanto en modo 'live' como
      // 'replay' (ver renderMatchScreen); no nulo == partido en pantalla
      // sin confirmar todavía.
      activeMatchInProgress: !!state.matchReveal,
    };
  }

  function describeCareerSaveMetadata(saveKind) {
    const userTeam = getUserTeam();
    return {
      careerId: state.world ? state.world.id : null,
      userTeamId: state.userTeamId,
      userClubId: state.userClubId,
      teamName: userTeam ? userTeam.fullName : null,
      clubName: userTeam && userTeam.club ? userTeam.club.name : null,
      seasonKey: state.calendar ? state.calendar.currentSeasonKey : null,
      gameDate: state.calendar ? state.calendar.currentLocalDate : null,
      saveKind: saveKind || 'manual',
    };
  }

  // Guarda en una ranura — nunca lanza síncronamente (los llamadores
  // fire-and-forget de autoguardado dependen de eso): cualquier fallo llega
  // por rechazo de la promesa devuelta.
  function saveCareerToSlot(slotId, saveKind) {
    if (!state.world || !state.calendar) return Promise.reject(new Error('No hay ninguna carrera activa que guardar.'));
    const runtime = buildCareerSaveRuntime();
    const blockers = BM.CareerPersistenceBoundary.describeSaveBlockers(runtime);
    if (blockers.length) return Promise.reject(new Error(blockers.join(' ')));
    return BM.IndexedDbCareerSaveRepository.readSlot(slotId).then((existing) => {
      const innerEnvelope = BM.CareerPersistenceBoundary.project(runtime, { snapshotAtGameDate: state.calendar.currentLocalDate });
      const withoutFingerprint = {
        format: SAVE_FORMAT,
        schemaVersion: SAVE_SCHEMA_VERSION,
        slotId,
        revision: existing && existing.envelope && Number.isFinite(existing.envelope.revision) ? existing.envelope.revision + 1 : 1,
        savedAtUtc: new Date().toISOString(),
        metadata: describeCareerSaveMetadata(saveKind),
        contentPacks: innerEnvelope.world.installedContentPacks.map((p) => ({ id: p.id, version: p.version })),
        payload: innerEnvelope,
      };
      const envelope = { ...withoutFingerprint, fingerprint: BM.CareerPersistenceBoundary.computeFingerprint(withoutFingerprint) };
      return BM.IndexedDbCareerSaveRepository.writeSlot(slotId, envelope);
    });
  }

  // Autoguardado en los checkpoints seguros (sección 7 del prompt): fin del
  // bootstrap de una carrera nueva, partido del usuario confirmado, cierre
  // de temporada. Nunca bloquea la UI ni lanza — un fallo se registra
  // (consola + `state.lastAutosaveError`, mostrado de forma discreta por
  // `renderSaveLoadScreen()`) y la partida sigue jugándose con normalidad.
  function autoSaveCareer() {
    if (!state.world) return;
    saveCareerToSlot(AUTOSAVE_SLOT_ID, 'autosave').then(() => {
      state.lastAutosaveError = null;
    }).catch((error) => {
      console.warn('[SAVE-LOAD-1] Autoguardado no completado:', error.message);
      state.lastAutosaveError = error.message;
    });
  }

  function listCareerSaveSlots() {
    return BM.IndexedDbCareerSaveRepository.listSlots();
  }

  function deleteCareerSaveSlot(slotId) {
    return BM.IndexedDbCareerSaveRepository.deleteSlot(slotId);
  }

  // Carga en DOS fases (sección 6 del prompt): 1) `CareerHydrationService.
  // hydrate()` reconstruye y valida TODO en un runtime aislado, sin tocar
  // `state`; 2) solo si tiene éxito, se sustituye `state.*` de una sola vez
  // (síncrono — el propio bucle de eventos de JS lo hace atómico). Un
  // fallo en la fase 1 nunca deja la carrera activa a medias:
  // `resetCareerState()` solo se llama DESPUÉS de que `hydrate()` ya
  // devolvió con éxito.
  function loadCareerFromSlot(slotId) {
    return BM.IndexedDbCareerSaveRepository.readSlot(slotId).then((record) => {
      if (!record) throw new Error(`No hay ninguna partida guardada en la ranura "${slotId}".`);
      const hydrated = BM.CareerHydrationService.hydrate(record.envelope, {
        availableContentPacks: BM.listAvailableContentPacks(),
        buildDateResolverProvider: (scheduleService) => buildCompetitionDateResolverProvider(scheduleService),
      });

      // --- Fase 2: sustitución atómica de la carrera activa --------------
      resetCareerState();
      state.world = hydrated.world;
      state.calendar = hydrated.calendar;
      state.playerRegistry = hydrated.playerRegistry;
      state.contractRegistry = hydrated.contractRegistry;
      state.registrationRegistry = hydrated.registrationRegistry;
      state.agentRegistry = hydrated.agentRegistry;
      state.marketRegistry = hydrated.marketRegistry;
      state.transferRegistry = hydrated.transferRegistry;
      state.loanRegistry = hydrated.loanRegistry;
      state.annualCycleRegistry = hydrated.annualCycleRegistry;
      state.academyRegistry = hydrated.academyRegistry;
      state.nationalTeamRegistry = hydrated.nationalTeamRegistry;
      state.competitionEngine = hydrated.competitionEngine;
      state.competitionSimulationService = hydrated.competitionSimulationService;
      state.scheduleService = hydrated.scheduleService;
      state.contentPackLifecycle = hydrated.contentPackLifecycle;
      state.installedContentPacks = hydrated.installedContentPackManifests;
      state.careerSetupSnapshot = hydrated.careerSetupSnapshot;
      state.careerSetupDraft = null;
      state.userTeamId = hydrated.userTeamId;
      state.userClubId = hydrated.userClubId;
      state.seasonStartYear = hydrated.seasonStartYear;
      state.newsLog = hydrated.uiState.newsLog;
      state.medicalAgendaLog = hydrated.uiState.medicalAgendaLog;
      state.marketAgendaLog = hydrated.uiState.marketAgendaLog;
      state.lineup = hydrated.uiState.lineup || {
        squadIds: [], entries: buildEmptyLineupEntries(), fixedSegments: [], segmentDraft: null, garbageTime: { enabled: false },
      };
      state.transferNegotiationOfferSequence = (hydrated.uiState.negotiationSequences && hydrated.uiState.negotiationSequences.transferNegotiationOfferSequence) || {};
      state.loanNegotiationAttemptSequence = (hydrated.uiState.negotiationSequences && hydrated.uiState.negotiationSequences.loanNegotiationAttemptSequence) || {};
      state.pendingStop = null;
      state.seasonCloseSummary = null;
      state.lastRoundMatches = null;
      state.pendingUserMatch = null;
      state.matchReveal = null;
      state.lastAutosaveError = null;
      state.worldView = { kind: 'area', areaId: BM.WORLD_CORE_AREA_IDS.WORLD, competitionDefinitionId: null, editionId: null };

      // Re-adjunta por IDENTIDAD (nunca copia) y reconstruye los servicios/
      // coordinadores derivados — mismo patrón EXACTO que el tramo final de
      // `startCareerFromSetup()` (nunca su bootstrap/seed, solo esta
      // "conexión a la sesión en vivo").
      state.world.attachDomainRegistries({
        playerRegistry: state.playerRegistry,
        contractRegistry: state.contractRegistry,
        registrationRegistry: state.registrationRegistry,
        agentRegistry: state.agentRegistry,
        marketRegistry: state.marketRegistry,
        transferRegistry: state.transferRegistry,
        loanRegistry: state.loanRegistry,
        annualCycleRegistry: state.annualCycleRegistry,
        academyRegistry: state.academyRegistry,
        nationalTeamRegistry: state.nationalTeamRegistry,
      });
      state.world.setCalendar(state.calendar);
      state.pathwayService = new BM.CompetitionPathwayService({
        world: state.world,
        competitionEngine: state.competitionEngine,
        now: () => ({ instant: state.calendar.currentInstant, timeZoneId: state.calendar.defaultTimeZoneId }),
        resolveEditionBindings: (competitionId, world) => state.contentPackLifecycle.resolveEditionBindings(
          state.installedContentPacks, competitionId, world,
        ),
      });
      state.competitionEngine.setFactHandler((fact) => state.pathwayService.handleEngineFact(fact));
      state.calendarCoordinator = buildWorldCalendarCoordinator();
      // Sincroniza las fuentes reales SOBRE los pendientes ya sembrados por
      // `CareerHydrationService` (`calendar.restorePendingItems()`) — un
      // item `awaiting-user`/`failed` ya existente conserva su estado
      // (`WorldCalendar.syncSource()`), nunca se resetea a 'scheduled'.
      state.calendarCoordinator.sync();
      refreshActiveCompetitionIdsForUser();
      ensureUiHandlersWired();
      // Requisito 12 de la sección 6 del prompt: "mostrar Home en la misma
      // fecha de juego, sin ejecutar automáticamente ningún comando de
      // simulación".
      goToScreen('home');
    });
  }

  const SAVE_SLOT_LABELS = {
    'manual-1': 'Ranura manual 1', 'manual-2': 'Ranura manual 2', 'manual-3': 'Ranura manual 3', autosave: 'Autoguardado',
  };

  function formatSaveTimestamp(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return iso; }
  }

  // Comprobación LIGERA de si una ranura se puede cargar sin de verdad
  // hidratar la carrera completa (eso solo se hace al pulsar "Cargar") —
  // formato/fingerprint (barato) + compatibilidad de content packs contra
  // el catálogo real (sección 8 del prompt: "si sólo hay partidas
  // incompatibles o corruptas, no las cargues silenciosamente: muéstralas
  // con su estado/error útil").
  function describeSlotHealth(envelope) {
    try {
      BM.CareerHydrationService.verifyEnvelopeIntegrity(envelope);
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    const available = new Map(BM.listAvailableContentPacks().map((m) => [m.id, m.version]));
    const incompatible = (envelope.contentPacks || []).find((p) => available.get(p.id) !== p.version);
    if (incompatible) {
      return {
        ok: false,
        reason: available.has(incompatible.id)
          ? `Content pack "${incompatible.id}" guardado en versión ${incompatible.version}, esta versión del juego tiene ${available.get(incompatible.id)}.`
          : `Content pack "${incompatible.id}" ya no está disponible en esta versión del juego.`,
      };
    }
    return { ok: true, reason: null };
  }

  function renderSaveSlotCardHtml(slotId, record) {
    const label = SAVE_SLOT_LABELS[slotId];
    const isAutosave = slotId === AUTOSAVE_SLOT_ID;
    const hasActiveCareer = !!state.world;
    const saveBlockers = hasActiveCareer ? BM.CareerPersistenceBoundary.describeSaveBlockers(buildCareerSaveRuntime()) : [];
    if (!record) {
      const canSaveHere = hasActiveCareer && !isAutosave && !saveBlockers.length;
      return `
        <div class="gm-card gm-save-slot">
          <h3>${label}</h3>
          <p class="gm-muted">Ranura vacía.</p>
          ${!isAutosave && hasActiveCareer ? `<button class="gm-btn gm-btn--small" data-save-slot="${slotId}" ${canSaveHere ? '' : 'disabled'}>Guardar aquí</button>` : ''}
          ${!isAutosave && hasActiveCareer && saveBlockers.length ? `<p class="gm-hint">${saveBlockers.join(' ')}</p>` : ''}
        </div>`;
    }
    const health = describeSlotHealth(record.envelope);
    const meta = record.envelope.metadata || {};
    const canOverwrite = hasActiveCareer && !isAutosave && !saveBlockers.length;
    return `
      <div class="gm-card gm-save-slot">
        <h3>${label}${isAutosave ? ' <span class="gm-badge">automático</span>' : ''}</h3>
        ${health.ok ? `
          <p><strong>${meta.clubName || meta.teamName || '(club desconocido)'}</strong></p>
          <p class="gm-muted">Temporada ${meta.seasonKey || '—'} · fecha de juego ${meta.gameDate || '—'}</p>
          <p class="gm-muted">Guardado el ${formatSaveTimestamp(record.envelope.savedAtUtc)}</p>
        ` : `<p class="gm-error">Partida no cargable: ${health.reason}</p>`}
        <div class="gm-save-slot__actions">
          <button class="gm-btn gm-btn--primary gm-btn--small" data-load-slot="${slotId}" ${health.ok ? '' : 'disabled'}>Cargar</button>
          ${!isAutosave && hasActiveCareer ? `<button class="gm-btn gm-btn--small" data-save-slot="${slotId}" ${canOverwrite ? '' : 'disabled'}>Sobrescribir</button>` : ''}
          <button class="gm-btn gm-btn--small gm-btn--danger" data-delete-slot="${slotId}">Eliminar</button>
        </div>
        ${!isAutosave && hasActiveCareer && saveBlockers.length ? `<p class="gm-hint">${saveBlockers.join(' ')}</p>` : ''}
      </div>`;
  }

  // SAVE-LOAD-1 (sección 8 del prompt): sección/pantalla compacta de
  // "Partida" — ver las 4 ranuras, guardar en una manual, cargar,
  // sobrescribir y eliminar (ambas últimas con confirmación), autoguardado
  // claramente distinguido. Funciona TANTO dentro de una carrera activa
  // (menú "Partida") COMO desde la landing sin ninguna carrera todavía
  // ("Cargar partida") — las acciones de guardar se ocultan solas cuando
  // `state.world` es `null`.
  function renderSaveLoadScreen() {
    const container = byId('gm-save-load');
    if (!container) return;
    container.innerHTML = '<p class="gm-muted">Consultando partidas guardadas…</p>';
    BM.listCareerSaveSlots().then((slots) => {
      const bySlotId = new Map(slots.map((s) => [s.slotId, s.record]));
      const autosaveError = state.lastAutosaveError
        ? `<p class="gm-error">El último autoguardado no se completó: ${state.lastAutosaveError}</p>` : '';
      container.innerHTML = `
        ${autosaveError}
        ${!state.world ? '<p class="gm-muted">No hay ninguna carrera abierta — solo puedes cargar o eliminar ranuras existentes.</p>' : ''}
        <div class="gm-save-slots">
          ${['manual-1', 'manual-2', 'manual-3', AUTOSAVE_SLOT_ID].map((slotId) => renderSaveSlotCardHtml(slotId, bySlotId.get(slotId))).join('')}
        </div>
      `;

      container.querySelectorAll('[data-save-slot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const slotId = btn.dataset.saveSlot;
          const record = bySlotId.get(slotId);
          if (record && !window.confirm(`¿Sobrescribir "${SAVE_SLOT_LABELS[slotId]}" con la partida actual?`)) return;
          saveCareerToSlot(slotId, 'manual').then(() => renderSaveLoadScreen()).catch((error) => {
            window.alert(`No se ha podido guardar: ${error.message}`);
          });
        });
      });
      container.querySelectorAll('[data-load-slot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const slotId = btn.dataset.loadSlot;
          if (!window.confirm('Cargar esta partida sustituye la carrera actualmente abierta (si hay alguna). ¿Continuar?')) return;
          loadCareerFromSlot(slotId).catch((error) => {
            window.alert(`No se ha podido cargar la partida: ${error.message}`);
            renderSaveLoadScreen();
          });
        });
      });
      container.querySelectorAll('[data-delete-slot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const slotId = btn.dataset.deleteSlot;
          if (!window.confirm(`¿Eliminar "${SAVE_SLOT_LABELS[slotId]}"? Esta acción no se puede deshacer.`)) return;
          deleteCareerSaveSlot(slotId).then(() => renderSaveLoadScreen()).catch((error) => {
            window.alert(`No se ha podido eliminar: ${error.message}`);
          });
        });
      });
    }).catch((error) => {
      container.innerHTML = `<p class="gm-error">No se ha podido acceder al almacenamiento local: ${error.message}</p>`;
    });
  }

  global.BasketManagerGame = {
    state, init, goToScreen, getUserTeam, startCareerFromSetup,
    // SAVE-LOAD-1: API mínima de persistencia consumida desde el script
    // inline de `index.html` (landing) y desde `renderSaveLoadScreen()`.
    ensureUiHandlersWired,
    saveCareerToSlot,
    loadCareerFromSlot,
    listCareerSaveSlots,
    deleteCareerSaveSlot,
    canSaveCareerNow: () => BM.CareerPersistenceBoundary.canSave(buildCareerSaveRuntime()),
    describeSaveBlockers: () => BM.CareerPersistenceBoundary.describeSaveBlockers(buildCareerSaveRuntime()),
    // WORLD-CALENDAR-1 (DESIGN.md 10.14): `simulateNextRound`,
    // `simulateBackgroundRound`, `drainBackgroundBrackets` y
    // `buildCpuOnlyResolver` han DESAPARECIDO — no había forma de
    // conservarlos sin conservar también la orquestación por bloques que
    // esta entrega corrige (BUG-WORLDCALENDAR-01/02). Lo que se expone en
    // su lugar es la MISMA ruta productiva de avance:
    // `advanceWorldUntilNextUserStop()` (un descriptor cada vez, cursor
    // monotónico), más las vistas legacy derivadas.
    //
    // Consecuencia conocida y declarada: `scripts/verify-*-playwright.js`
    // usaban `simulateBackgroundRound`/`drainBackgroundBrackets` para
    // avanzar una carrera sin reveals y necesitan migrarse a
    // `advanceWorldUntilNextUserStop()`. No se han tocado ni ejecutado en
    // esta entrega (el presupuesto de pruebas prohíbe Playwright);
    // propietario de la migración: la primera sesión que vuelva a
    // ejecutarlos.
    advanceWorldUntilNextUserStop,
    peekNextUserMatchDescriptor,
    // WORLD-HARDEN-1 (DESIGN.md 10.19): `getLeague(division)`/
    // `getBrackets(division)` quedan RETIRADAS (ver el bloque de
    // comentario donde vivían, cerca de `getLeagueForTeam`) — nada externo
    // las consumía (auditado: ni `index.html` ni `scripts/*.js` referencian
    // `BasketManagerGame.getLeague`/`.getBrackets`).
  };
})(typeof window !== 'undefined' ? window : globalThis);
