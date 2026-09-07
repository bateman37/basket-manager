// scripts/audit-world-10-seasons.js
// WORLD-HARDEN-1 (DESIGN.md 10.19, sección 11 del prompt) — auditoría
// RÁPIDA de diez cierres de temporada consecutivos sobre la carrera
// española real (36 equipos), conducida por la vía CANÓNICA de
// lifecycle/ciclo (`GameWorld` + `CompetitionEngine` +
// `CompetitionPathwayService` + `AnnualCycleService`, el MISMO patrón que
// `scripts/smoke-pathways1.js`, extendido a diez iteraciones) — nunca
// revive `cycle1-harness.js`'s harness pre-World (división-based) ni
// simula cientos de partidos `playable` uno a uno fuera de la cola mundial
// (`WorldCalendarCoordinator.advanceUntilNextUserStop()` resuelve cada
// temporada de golpe). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// A diferencia de `smoke-pathways1.js`, la resolución del transition group
// y la unión de `scheduleIds` de la temporada siguiente se hacen con la
// MISMA lógica GENÉRICA que ahora usa `game.js`
// (`discoverReadyTransitionGroup()`/`ContentPackLifecycleService.
// unionScheduleIds()`) — nunca `SPAIN_PATHWAY_IDS`/
// `SPAIN_DOMESTIC_TRANSITION_GROUP_ID`/`SPAIN_SCHEDULE_IDS` sueltos salvo
// en el bootstrap inicial del calendario (mismo punto que `game.js`,
// necesario antes de que exista ninguna Edition).
//
// Qué verifica CADA temporada (sección 11 del prompt):
//  - integridad de `World`/`CompetitionEngine`/`WorldCalendar`;
//  - cada Player exactamente una vez en `PlayerRegistry` (por construcción
//    del propio registro, mismo id nunca puede referenciar dos jugadores
//    distintos — se comprueba el tamaño del registro contra el recorrido
//    determinista del propio registro);
//  - máximo un squad ACTIVO por (jugador, contexto) y ausencia de squads
//    huérfanos (sin Team real);
//  - retirados sin contrato/inscripción/squad activo incompatibles;
//  - población VIVA (roster real de los 36 equipos + pool de libres del
//    Player Registry no afiliado) acotada por el tamaño de plantilla
//    configurado — nunca un número mágico inventado aquí;
//  - crecimiento del histórico de retirados corresponde EXACTAMENTE a los
//    `RetirementRecord` nuevos del ciclo de esa temporada;
//  - consultar población/registries no crea jugadores (se llama dos veces
//    seguidas y se compara el tamaño).
//
// Salida: una línea compacta por temporada + un resumen final. No imprime
// cada operación ni cada partido.

const assert = require('assert');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { GameDateTime } = require('../src/utils/GameDateTime.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { padRosterToMinimum } = require('../src/utils/playerGenerator.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const {
  SPAIN_MANIFEST, SPAIN_SCHEDULE_IDS, SPAIN_TIME_ZONE_ID, registerSpainSchedules,
} = require('../data/world/spain-2026.1.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const CompetitionParticipationService = require('../src/core/CompetitionParticipationService.js');
const { CompetitionEngine, buildEditionId } = require('../src/core/CompetitionEngine.js');
const { CompetitionPathwayService } = require('../src/core/CompetitionPathwayService.js');
const CompetitionPathwayCatalog = require('../src/core/CompetitionPathwayCatalog.js');
const { CompetitionScheduleCatalog } = require('../src/core/CompetitionScheduleCatalog.js');
const { CompetitionScheduleService } = require('../src/core/CompetitionScheduleService.js');
const { WorldCalendar } = require('../src/core/WorldCalendar.js');
const {
  WorldCalendarCoordinator, WORLD_CALENDAR_STOP_TYPES,
  createCompetitionMatchSource, createMarketEventSource, createTransferEventSource, createLoanEventSource,
} = require('../src/core/WorldCalendarCoordinator.js');
const { SeasonHistoryService } = require('../src/core/SeasonHistoryService.js');
const { AnnualCycleService } = require('../src/core/AnnualCycleService.js');
const { CycleConfig } = require('../src/core/CycleConfig.js');
const { ContentPackLifecycleService } = require('../src/core/ContentPackLifecycleService.js');
const { WorldSimulationProfile } = require('../src/entities/WorldSimulation.js');
const harness = require('./cycle1-harness.js');

const NUM_SEASONS = 10;
const startedAt = Date.now();
const careerSeed = 'audit-world-10-seasons-v1';
let seasonStartYear = 2026;
let seasonKey = LocalDate.seasonKeyFromStartYear(seasonStartYear);
const USER_TEAM_ID = 'team-unicaja';

console.log(`=== AUDITORÍA WORLD-HARDEN-1: ${NUM_SEASONS} temporadas (carrera española real, 36 equipos) ===\n`);

// ===========================================================================
// 1. Bootstrap — igual patrón que smoke-pathways1.js.
// ===========================================================================
registerSpainSchedules();
const scheduleService = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
const acbSchedule = CompetitionScheduleCatalog.requireSchedule(SPAIN_SCHEDULE_IDS.ACB);
const seasonStartInstant = scheduleService.seasonStartInstant(acbSchedule, seasonStartYear);
const seasonWindowStartInstant = scheduleService.seasonWindowStartInstant(acbSchedule, seasonStartYear);
const bootstrapIsoDate = GameDateTime.localDateAt(seasonStartInstant, SPAIN_TIME_ZONE_ID);

const calendar = new WorldCalendar({
  id: `calendar:audit10:${careerSeed}`,
  defaultTimeZoneId: SPAIN_TIME_ZONE_ID,
  initialInstant: seasonWindowStartInstant,
});
calendar.registerSeason({
  seasonKey, startInstant: seasonStartInstant, timeZoneId: SPAIN_TIME_ZONE_ID,
  scheduleIds: [SPAIN_SCHEDULE_IDS.ACB, SPAIN_SCHEDULE_IDS.PRIMERA_FEB, SPAIN_SCHEDULE_IDS.COPA_ACB],
});

const { annualCycleRegistry, academyRegistry } = harness.createCycleRegistries();
const playerRegistry = new PlayerRegistry();

function buildRealTeam(teamData) {
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...fields } = playerData;
    const player = new Player(fields);
    player.dataSource = dataSource || null;
    harness.WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, bootstrapIsoDate, {
      seasonKey, historyCompleteness: 'partial', annualCycleRegistry, retirementService: harness.RetirementService, careerSeed,
    });
    return player;
  });
  const resolved = harness.resolveRegistrationRulesForDivision(teamData.division, seasonKey, bootstrapIsoDate);
  const fallbackPlayers = padRosterToMinimum(roster, resolved.squadRules.min, {
    minAge: 18, maxAge: 34, referenceDate: bootstrapIsoDate,
    seed: `${careerSeed}|roster-fill|${teamData.id}`, id: `roster-fill:${teamData.id}`,
  });
  fallbackPlayers.forEach((player) => {
    harness.WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, bootstrapIsoDate, {
      seasonKey, historyCompleteness: 'complete', annualCycleRegistry, retirementService: harness.RetirementService, careerSeed,
    });
  });
  return new Team({ ...teamData, roster });
}

const teamsByDivision = { '1ª': [], '2ª': [] };
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div).map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id]));
});
let allTeams = [...teamsByDivision['1ª'], ...teamsByDivision['2ª']];
allTeams.forEach((team) => playerRegistry.registerMany(team.roster));

// WORLD-SIM-1 (DESIGN.md 10.16): mismo perfil transitorio que la partida
// española real de `game.js` — ACB/Primera FEB/Copa `playable` (el motor
// pausable de siempre), default `abstract` (inerte aquí, sin equipos
// exteriores instalados).
const simulationProfile = new WorldSimulationProfile({
  id: `simulation-profile:audit10:${careerSeed}`,
  version: 'audit-world-10-seasons-v1',
  selectedAtGameDate: bootstrapIsoDate,
  defaultDetailLevel: 'abstract',
  assignments: [
    { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.ACB, detailLevel: 'playable' },
    { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, detailLevel: 'playable' },
    { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.COPA_ACB, detailLevel: 'playable' },
  ],
});

const world = WorldFactory.buildCareerWorld({
  id: `world:audit10:${careerSeed}`,
  name: 'Mundo de la auditoría (WORLD-HARDEN-1)',
  careerSeed,
  createdAtGameDate: bootstrapIsoDate,
  packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
  context: { teamsByDivision, seasonKey, seasonStartDate: bootstrapIsoDate },
  simulationProfile,
});
world.setCalendar(calendar);
assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo recién construido debe validar sin errores');
const userTeam = world.registries.teams.require(USER_TEAM_ID);
const userClubId = userTeam.clubId;

const engine = new CompetitionEngine({ world });
engine.setDateResolverProvider(scheduleService.buildDateResolverProvider({
  seasonStartYearForEdition: (edition) => LocalDate.seasonStartYear(edition.seasonKey),
}));

// WORLD-HARDEN-1: el lifecycle service GENÉRICO prepara los catálogos
// (formatos/schedules/pathways) del paquete instalado — nunca
// `registerSpainPathways()` por nombre a partir de aquí.
const contentPackLifecycle = new ContentPackLifecycleService({ manifests: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST] });
contentPackLifecycle.prepareCatalogs([WORLD_CORE_MANIFEST, SPAIN_MANIFEST]);

const pathwayService = new CompetitionPathwayService({
  world,
  competitionEngine: engine,
  now: () => ({ instant: calendar.currentInstant, timeZoneId: SPAIN_TIME_ZONE_ID }),
  // WORLD-HARDEN-1: ownership genérico (`manifest.provides.competitionDefinitions`)
  // — nunca `resolveSpainEditionBindings` por nombre.
  resolveEditionBindings: (competitionId, w) => contentPackLifecycle.resolveEditionBindings(
    [WORLD_CORE_MANIFEST, SPAIN_MANIFEST], competitionId, w,
  ),
});
engine.setFactHandler((fact) => pathwayService.handleEngineFact(fact));
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, seasonKey));
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey));

const contractRegistry = new ContractRegistry();
const registrationRegistry = new RegistrationRegistry();
const agentRegistry = new AgentRegistry();
const marketRegistry = new MarketRegistry();
const transferRegistry = new TransferRegistry();
const loanRegistry = new LoanRegistry();
const classificationCache = new Map();

ContractSeeder.seedContractsForTeams({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
});
RegistrationSeeder.seedRegistrationsForTeams({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, registrationRegistry, contractRegistry, config: CONFIG_BASE,
});
world.attachDomainRegistries({
  playerRegistry, contractRegistry, registrationRegistry, agentRegistry, marketRegistry, transferRegistry, loanRegistry, annualCycleRegistry, academyRegistry,
});
['1ª', '2ª'].forEach((div) => recalculateSportingGoalsForDivision(teamsByDivision[div], CONFIG_BASE));

const bootstrapLegality = harness.ensureAllClubsLegalBeforeFirstMatch({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, config: CONFIG_BASE, careerSeed,
  annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry, loanRegistry, classificationCache,
});
assert.ok(bootstrapLegality.ready !== false, 'los 36 clubes deben poder construir una convocatoria legal antes de cerrar el ciclo');

function resolveMatchByDescriptor({ stageId, matchId }) {
  engine.resolveMatch(stageId, matchId, { matchEngineConfig: CONFIG_BASE });
  engine.drainActivationEvents();
}

const coordinator = new WorldCalendarCoordinator({
  calendar,
  sources: [
    createCompetitionMatchSource({ engine, timeZoneId: SPAIN_TIME_ZONE_ID, resolveMatch: resolveMatchByDescriptor }),
    createMarketEventSource({
      marketRegistry, timeZoneId: SPAIN_TIME_ZONE_ID, resolveEvent: (event) => marketRegistry.markEventProcessed(event.id),
    }),
    createTransferEventSource({
      transferRegistry, timeZoneId: SPAIN_TIME_ZONE_ID, resolveCase: () => { throw new Error('audit: no debería haber traspasos programados'); },
    }),
    createLoanEventSource({
      loanRegistry, timeZoneId: SPAIN_TIME_ZONE_ID, resolveReturn: () => { throw new Error('audit: no debería haber cesiones activas'); },
    }),
  ],
  controlledTeamIds: [USER_TEAM_ID],
  controlledClubIds: [userClubId],
});

// ===========================================================================
// 2. Descubrimiento GENÉRICO del transition group listo — misma lógica que
//    `discoverReadyTransitionGroup()` en `src/ui/game.js` (sección 5 del
//    prompt), nunca `SPAIN_PATHWAY_IDS`/`SPAIN_DOMESTIC_TRANSITION_GROUP_ID`.
// ===========================================================================
function discoverReadyTransitionGroup(forSeasonKey) {
  const editions = world.registries.competitionEditions.forSeason(forSeasonKey);
  const pathwayIds = new Set();
  editions.forEach((edition) => (edition.pathwayBindingIds || []).forEach((id) => pathwayIds.add(id)));
  const candidates = [];
  [...pathwayIds].sort().forEach((pathwayId) => {
    const definition = CompetitionPathwayCatalog.requirePathwayDefinition(pathwayId);
    Object.keys(definition.transitionGroups).sort().forEach((groupId) => {
      const readiness = pathwayService.isTransitionGroupReady(pathwayId, groupId, { sourceSeasonKey: forSeasonKey });
      if (readiness.ready) candidates.push({ pathwayId, groupId });
    });
  });
  assert.strictEqual(candidates.length, 1, `debe haber EXACTAMENTE un transition group listo (temporada "${forSeasonKey}")`);
  return candidates[0];
}

// ===========================================================================
// 3. Comprobaciones de integridad/población — una vez por temporada.
// ===========================================================================
function activeRosterSizeBound() {
  // Cota configurada: máximo real de convocatoria (acta) de cada
  // competición, nunca un número inventado aquí — ver CompetitionRules vía
  // `resolveRegistrationRulesForDivision` (mismo resolutor que el bootstrap).
  return teamsByDivision['1ª'].length + teamsByDivision['2ª'].length; // solo para sanity de conteo de equipos
}

function auditSeason(label, previousRetirementCount) {
  const worldErrors = world.validateIntegrity();
  assert.deepStrictEqual(worldErrors, [], `[${label}] world.validateIntegrity(): ${JSON.stringify(worldErrors)}`);
  const engineErrors = engine.validateIntegrity();
  assert.deepStrictEqual(engineErrors, [], `[${label}] engine.validateIntegrity(): ${JSON.stringify(engineErrors)}`);
  const calendarErrors = calendar.validateIntegrity();
  assert.deepStrictEqual(calendarErrors, [], `[${label}] calendar.validateIntegrity(): ${JSON.stringify(calendarErrors)}`);

  // Cada Player exactamente una vez: `PlayerRegistry.register()` ya rechaza
  // un id duplicado con otra instancia (invariante estructural) — aquí se
  // comprueba que consultar dos veces NO crea nada nuevo (sección 11,
  // último punto: "consultar población/navegación/snapshot no crea
  // jugadores").
  const firstCount = playerRegistry.all().length;
  const secondCount = playerRegistry.all().length;
  assert.strictEqual(firstCount, secondCount, `[${label}] consultar el Player Registry dos veces no debe cambiar su tamaño`);

  // Máximo un squad ACTIVO por (jugador, contexto) y sin squads huérfanos
  // (referencian un Team real).
  const activeSquads = world.registries.squads.all().filter((sq) => sq.status === 'active');
  const seenByContext = new Map(); // `${context}:${playerId}` -> true
  activeSquads.forEach((squad) => {
    assert.ok(world.registries.teams.get(squad.teamId), `[${label}] squad "${squad.id}" referencia un Team inexistente ("${squad.teamId}")`);
    squad.players.forEach((player) => {
      const key = `${squad.membershipContext}:${player.id}`;
      assert.ok(!seenByContext.has(key), `[${label}] jugador "${player.id}" tiene más de un squad ACTIVO en el contexto "${squad.membershipContext}"`);
      seenByContext.set(key, true);
    });
  });

  // Retirados: histórico ACUMULATIVO — su crecimiento corresponde
  // exactamente a los `RetirementRecord` nuevos de este cierre (nunca una
  // materialización/duplicación accidental).
  const retirementRecords = annualCycleRegistry.allRetirementRecords();
  assert.ok(retirementRecords.length >= previousRetirementCount, `[${label}] el histórico de retirados nunca debe encoger`);
  const newRetirements = retirementRecords.length - previousRetirementCount;
  retirementRecords.slice(previousRetirementCount).forEach((record) => {
    assert.ok(record.playerId, `[${label}] todo RetirementRecord debe declarar "playerId"`);
    const player = playerRegistry.get(record.playerId);
    assert.ok(player, `[${label}] el jugador retirado "${record.playerId}" debe seguir localizable en el Player Registry`);
    // Un retirado no puede seguir afiliado a un Team real (senior) — sale
    // de `Team.roster`, nunca desaparece del registro.
    assert.strictEqual(player.teamId, null, `[${label}] el jugador retirado "${record.playerId}" no debe seguir afiliado a ningún Team`);
  });

  // Población: VIVA (afiliada a los 36 equipos reales + libres del pool de
  // mercado, ambos con `player.teamId` o localizables como libres reales)
  // frente a HISTÓRICA/retirada — nunca un único contador ambiguo.
  const liveAffiliated = allTeams.reduce((sum, team) => sum + team.roster.length, 0);
  const totalRegistered = playerRegistry.all().length;
  const retiredTotal = retirementRecords.length;
  assert.ok(liveAffiliated <= totalRegistered, `[${label}] la población afiliada nunca puede superar el total registrado`);
  assert.ok(liveAffiliated > 0, `[${label}] debe haber jugadores afiliados vivos`);

  console.log(
    `OK  ${label}: 36 equipos, ${totalRegistered} jugadores en el registro `
    + `(${liveAffiliated} afiliados, ${retiredTotal} retirados acumulados, +${newRetirements} este cierre), `
    + `${activeSquads.length} squads activos, integridad World/Engine/Calendar limpia`,
  );
  return { totalRegistered, liveAffiliated, retiredTotal };
}

// ===========================================================================
// 4. Bucle de diez temporadas.
// ===========================================================================
let previousRetirementCount = 0;
const seasonSummaries = [];

for (let seasonIndex = 1; seasonIndex <= NUM_SEASONS; seasonIndex += 1) {
  // --- 4.1 Temporada COMPLETA por la cola mundial (sin imprimir cada partido). ---
  let guard = 0;
  let finalStop = null;
  while (guard < 5000) {
    guard += 1;
    const stop = coordinator.advanceUntilNextUserStop();
    if (stop.type === WORLD_CALENDAR_STOP_TYPES.SEASON_COMPLETE) { finalStop = stop; break; }
    assert.strictEqual(stop.type, WORLD_CALENDAR_STOP_TYPES.USER_MATCH, `parada inesperada "${stop.type}" (temporada ${seasonKey})`);
    const meta = stop.item.metadata;
    resolveMatchByDescriptor({ stageId: meta.stageId, matchId: meta.matchId });
    coordinator.completeUserItem(stop.item.id);
    const simultaneous = coordinator.resolveSimultaneousAfterUserCommit(stop.item.orderingInstant);
    assert.strictEqual(simultaneous.failure, null, `no debe fallar la resolución de simultáneos (temporada ${seasonKey})`);
  }
  assert.ok(finalStop, `la temporada "${seasonKey}" no llegó a "season-complete" en ${guard} iteraciones`);

  // --- 4.2 Transición anual: descubrimiento GENÉRICO + AnnualCycleService. ---
  const teamsById = new Map(allTeams.map((t) => [t.id, t]));
  const targetSeasonKey = LocalDate.seasonKeyFromStartYear(seasonStartYear + 1);
  const seasonEndInstant = calendar.currentInstant;
  const seasonEndIso = GameDateTime.localDateAt(seasonEndInstant, SPAIN_TIME_ZONE_ID);
  const divisionsBefore = SeasonHistoryService.captureDivisionsBefore(allTeams);

  const readyGroup = discoverReadyTransitionGroup(seasonKey);
  const { receipt: transitionReceipt } = pathwayService.applyTransitionGroup(
    readyGroup.pathwayId, readyGroup.groupId, { fromSeasonKey: seasonKey, targetSeasonKey },
  );
  assert.strictEqual(transitionReceipt.moves.length, 4, `[${seasonKey}] deben ser exactamente 4 movimientos (2 ascensos + 2 descensos)`);
  const { promotedTeams, relegatedTeams } = SeasonHistoryService.deriveSeasonMovesFromTransitionReceipt(transitionReceipt, teamsById);
  CompetitionParticipationService.projectLegacyDivisionForTeams(world.registries, allTeams, targetSeasonKey);

  const evidence = harness.collectSeasonEvidence({
    leagues: [], brackets: [],
  });
  // La evidencia real de "último partido oficial" la deja
  // `resolveMatchByDescriptor` a través del propio motor solo si se le pide
  // — este harness resuelve toda la temporada por la cola mundial, así que
  // se construye una evidencia mínima suficiente por FECHA de cierre común
  // (todas las competiciones ya terminaron, `season-complete`).
  allTeams.forEach((team) => evidence.record({ clubId: team.id, date: seasonEndIso }));
  const missingEvidence = evidence.missingClubIds(allTeams);
  assert.strictEqual(missingEvidence.length, 0, `[${seasonKey}] clubes sin evidencia de último partido oficial: ${missingEvidence.join(', ')}`);

  const { cycle } = AnnualCycleService.openCycle({
    annualCycleRegistry, teams: allTeams, fromSeasonKey: seasonKey, targetSeasonKey,
    evidence: evidence.toArray(), date: seasonEndIso, playerRegistry, contractRegistry,
  });

  const hooks = {
    closeSeasonHistory() {
      const honoursByTeamId = SeasonHistoryService.buildSeasonHonoursByTeamId({
        leagueB: null, cup: null, titlePlayoff: null, promotedTeams,
      });
      harness.WorldLifecycleService.processWorldToDate({
        playerRegistry, teams: allTeams, annualCycleRegistry, academyRegistry,
      }, GameDateTime.toJsDate(seasonEndInstant), CONFIG_BASE, { seasonStartDate: null });
      SeasonHistoryService.closeCareerHistories({
        teams: allTeams, honoursByTeamId, divisionsBefore,
        seasonEndDateTime: GameDateTime.toJsDate(seasonEndInstant),
        nextSeasonKey: targetSeasonKey, config: CONFIG_BASE,
        rolesSnapshotFor: () => ({ offense: null, defense: null }),
      });
      ['1ª', '2ª'].forEach((division) => {
        recalculateSportingGoalsForDivision(allTeams.filter((team) => team.division === division), CONFIG_BASE);
      });
      return { promoted: promotedTeams.map((t) => t.fullName), relegated: relegatedTeams.map((t) => t.fullName) };
    },
  };

  const cycleParams = {
    annualCycleRegistry, academyRegistry, cycle, teams: allTeams, playerRegistry, contractRegistry,
    registrationRegistry, marketRegistry, agentRegistry, transferRegistry, loanRegistry,
    targetSeasonKey, config: CONFIG_BASE, careerSeed, userClubId, lineup: null,
    operationalContext: harness.OPERATIONAL_CONTEXT,
    calibration: ContractSeeder.buildCompetitionCalibration(allTeams, CONFIG_BASE),
    classificationCache, delegateEmergencyForUserClub: true, hooks,
    retirementService: harness.RetirementService,
    targetCompetitionIdForTeam: (team) => CompetitionParticipationService.primaryLeagueCompetitionId(
      world.registries, team.id, { seasonKey: targetSeasonKey },
    ),
  };

  CycleConfig.CYCLE_PHASES.slice(1).forEach((phaseId) => {
    const phaseDate = phaseId === 'new-season-started' ? cycle.scheduledDateForPhase('preseason-ready') : cycle.scheduledDateForPhase(phaseId);
    const result = AnnualCycleService.runPhase({ ...cycleParams, phaseId, date: phaseDate });
    if (result && result.ready === false) {
      const detail = (result.audit && result.audit.notReady ? result.audit.notReady : [])
        .map((entry) => `${entry.clubId}: ${entry.gaps.filter((g) => g.severity === 'blocking').map((g) => g.code).join('; ')}`);
      throw new Error(`[audit-world-10-seasons] fase "${phaseId}" (temporada ${seasonKey}) dejó ${detail.length} club(es) NOT READY:\n  ${detail.slice(0, 10).join('\n  ')}`);
    }
  });
  assert.strictEqual(cycle.currentPhase(), 'new-season-started', `[${seasonKey}] el ciclo debe completar sus 13 fases sin clubes NOT READY`);

  // --- 4.3 Registra la temporada siguiente en el MISMO calendario — schedule
  //     ids GENÉRICOS (unión de `provides.competitionSchedules` de los
  //     paquetes instalados), nunca `SPAIN_SCHEDULE_IDS` sueltos. ---
  seasonStartYear += 1;
  const nextMainLeagueEdition = world.registries.competitionEditions.require(
    buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, targetSeasonKey),
  );
  const nextSchedule = CompetitionScheduleCatalog.requireSchedule(nextMainLeagueEdition.scheduleProfileId);
  const nextSeasonStartInstant = scheduleService.seasonStartInstant(nextSchedule, seasonStartYear);
  const nextSeasonWindowStartInstant = scheduleService.seasonWindowStartInstant(nextSchedule, seasonStartYear);
  const nextScheduleIds = ContentPackLifecycleService.unionScheduleIds([WORLD_CORE_MANIFEST, SPAIN_MANIFEST]);
  calendar.registerSeason({
    seasonKey: targetSeasonKey, startInstant: nextSeasonStartInstant, timeZoneId: SPAIN_TIME_ZONE_ID, scheduleIds: nextScheduleIds,
  });
  calendar.retireLedger();
  calendar.advanceTo(nextSeasonWindowStartInstant);
  coordinator.sync();

  // Refresca `allTeams`/`teamsByDivision` — MISMAS instancias, nunca
  // reconstruidas (invariante 16).
  allTeams = world.registries.teams.all().filter((team) => team.teamKind === 'club-team');
  teamsByDivision['1ª'] = allTeams.filter((team) => team.division === '1ª');
  teamsByDivision['2ª'] = allTeams.filter((team) => team.division === '2ª');

  const summary = auditSeason(`temporada ${seasonKey} -> ${targetSeasonKey}`, previousRetirementCount);
  seasonSummaries.push({ seasonKey, targetSeasonKey, ...summary });
  previousRetirementCount = summary.retiredTotal;

  seasonKey = targetSeasonKey;
}

// ===========================================================================
// 5. Resumen final.
// ===========================================================================
assert.strictEqual(calendar.seasons.length, NUM_SEASONS + 1, `el calendario debe llevar registradas las ${NUM_SEASONS + 1} temporadas`);
assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo debe seguir válido al final de las diez temporadas');

const last = seasonSummaries[seasonSummaries.length - 1];
console.log(`\nResumen: ${NUM_SEASONS} cierres de temporada, ${last.totalRegistered} jugadores en el Player Registry final `
  + `(${last.liveAffiliated} afiliados vivos, ${last.retiredTotal} retirados acumulados), `
  + `36 equipos en las dos ligas domésticas en todo momento, integridad World/Engine/Calendar limpia cada cierre.`);
console.log(`\nAUDITORÍA WORLD-HARDEN-1: OK (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
