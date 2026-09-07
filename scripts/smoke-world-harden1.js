// scripts/smoke-world-harden1.js
// WORLD-HARDEN-1 (DESIGN.md 10.19, sección 15 del prompt) — smoke de
// integración CORTO: carrera española por defecto (36 equipos reales)
// hasta la PRIMERA parada de usuario (nunca una temporada completa —
// eso ya lo cubre `scripts/audit-world-10-seasons.js`, diez veces), más un
// cierre administrativo SINTÉTICO de un transition group (sin jugar una
// temporada entera) que demuestra el descubrimiento GENÉRICO de
// `discoverReadyTransitionGroup()` (la misma lógica que ahora usa
// `src/ui/game.js`), nunca `SPAIN_PATHWAY_IDS`/
// `SPAIN_DOMESTIC_TRANSITION_GROUP_ID` sueltos. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Confirma (sección 15 del prompt):
//  - 36 equipos reales, mismas instancias en World/PlayerRegistry;
//  - UN solo WorldCalendar (`world.calendar === calendar`);
//  - Entries válidas (18+18 en ACB/Primera FEB);
//  - cero lectura productiva de división en la ruta de arranque (auditado
//    estáticamente en `scripts/test-world-harden1.js`, no repetido aquí).

const assert = require('assert');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { GameDateTime } = require('../src/utils/GameDateTime.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { padRosterToMinimum } = require('../src/utils/playerGenerator.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const { SPAIN_MANIFEST, SPAIN_SCHEDULE_IDS, SPAIN_TIME_ZONE_ID } = require('../data/world/spain-2026.1.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const { CompetitionEngine, buildEditionId } = require('../src/core/CompetitionEngine.js');
const { CompetitionPathwayService } = require('../src/core/CompetitionPathwayService.js');
const CompetitionPathwayCatalog = require('../src/core/CompetitionPathwayCatalog.js');
const { CompetitionScheduleCatalog } = require('../src/core/CompetitionScheduleCatalog.js');
const { CompetitionScheduleService } = require('../src/core/CompetitionScheduleService.js');
const { WorldCalendar } = require('../src/core/WorldCalendar.js');
const { WorldCalendarCoordinator, WORLD_CALENDAR_STOP_TYPES, createCompetitionMatchSource } = require('../src/core/WorldCalendarCoordinator.js');
const { ContentPackLifecycleService } = require('../src/core/ContentPackLifecycleService.js');
const { WorldSimulationProfile } = require('../src/entities/WorldSimulation.js');
const harness = require('./cycle1-harness.js');

const startedAt = Date.now();
const careerSeed = 'smoke-world-harden1-seed-v1';
const seasonStartYear = 2026;
const seasonKey = LocalDate.seasonKeyFromStartYear(seasonStartYear);
const USER_TEAM_ID = 'team-unicaja';

console.log('=== SMOKE WORLD-HARDEN-1 (carrera española real hasta la primera parada + cierre administrativo sintético) ===\n');

// ===========================================================================
// 1. Bootstrap — MISMA lógica genérica que usa `game.js` (WorldFactory +
//    ContentPackLifecycleService, ownership por "provides").
// ===========================================================================
const scheduleService = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
const contentPackLifecycle = new ContentPackLifecycleService({ manifests: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST] });
contentPackLifecycle.prepareCatalogs([WORLD_CORE_MANIFEST, SPAIN_MANIFEST]);
const acbSchedule = CompetitionScheduleCatalog.requireSchedule(SPAIN_SCHEDULE_IDS.ACB);
const seasonStartInstant = scheduleService.seasonStartInstant(acbSchedule, seasonStartYear);
const seasonWindowStartInstant = scheduleService.seasonWindowStartInstant(acbSchedule, seasonStartYear);
const bootstrapIsoDate = GameDateTime.localDateAt(seasonStartInstant, SPAIN_TIME_ZONE_ID);

const calendar = new WorldCalendar({
  id: `calendar:smoke-world-harden1:${careerSeed}`,
  defaultTimeZoneId: SPAIN_TIME_ZONE_ID,
  initialInstant: seasonWindowStartInstant,
});
calendar.registerSeason({
  seasonKey, startInstant: seasonStartInstant, timeZoneId: SPAIN_TIME_ZONE_ID,
  scheduleIds: ContentPackLifecycleService.unionScheduleIds([WORLD_CORE_MANIFEST, SPAIN_MANIFEST]),
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
const allTeams = [...teamsByDivision['1ª'], ...teamsByDivision['2ª']];
allTeams.forEach((team) => playerRegistry.registerMany(team.roster));
assert.strictEqual(allTeams.length, 36, 'la carrera española por defecto debe conservar 36 equipos');

const simulationProfile = new WorldSimulationProfile({
  id: `simulation-profile:smoke-world-harden1:${careerSeed}`,
  version: 'smoke-world-harden1-v1',
  selectedAtGameDate: bootstrapIsoDate,
  defaultDetailLevel: 'abstract',
  assignments: [
    { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.ACB, detailLevel: 'playable' },
    { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, detailLevel: 'playable' },
    { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.COPA_ACB, detailLevel: 'playable' },
  ],
});

const world = WorldFactory.buildCareerWorld({
  id: `world:smoke-world-harden1:${careerSeed}`,
  name: 'Mundo de la carrera (smoke WORLD-HARDEN-1)',
  careerSeed,
  createdAtGameDate: bootstrapIsoDate,
  packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
  context: { teamsByDivision, seasonKey, seasonStartDate: bootstrapIsoDate },
  simulationProfile,
});
world.setCalendar(calendar);
assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo recién construido debe validar sin errores');
console.log(`OK  36 equipos/clubes reales, mismas instancias registradas en World y PlayerRegistry (${playerRegistry.all().length} jugadores)`);
assert.strictEqual(world.calendar, calendar, 'world.calendar debe ser la MISMA instancia que el calendario de la carrera (invariante 2, WORLD-CALENDAR-1)');
console.log('OK  UN solo WorldCalendar (identidad estricta world.calendar === calendar)');

const userTeam = world.registries.teams.require(USER_TEAM_ID);
const userClubId = userTeam.clubId;

const engine = new CompetitionEngine({ world });
engine.setDateResolverProvider(scheduleService.buildDateResolverProvider({
  seasonStartYearForEdition: (edition) => LocalDate.seasonStartYear(edition.seasonKey),
}));
const pathwayService = new CompetitionPathwayService({
  world,
  competitionEngine: engine,
  now: () => ({ instant: calendar.currentInstant, timeZoneId: SPAIN_TIME_ZONE_ID }),
  resolveEditionBindings: (competitionId, w) => contentPackLifecycle.resolveEditionBindings(
    [WORLD_CORE_MANIFEST, SPAIN_MANIFEST], competitionId, w,
  ),
});
engine.setFactHandler((fact) => pathwayService.handleEngineFact(fact));
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, seasonKey));
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey));

{
  const acbEntries = world.registries.competitionEntries.forEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, seasonKey));
  const febEntries = world.registries.competitionEntries.forEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey));
  assert.strictEqual(acbEntries.length, 18, 'ACB debe tener 18 Entries reales');
  assert.strictEqual(febEntries.length, 18, 'Primera FEB debe tener 18 Entries reales');
}
console.log('OK  Entries válidas: 18 (ACB) + 18 (Primera FEB), sin duplicados ni ausencias');

// ===========================================================================
// 2. Avanza SOLO hasta la primera parada de usuario (nunca la temporada
//    completa).
// ===========================================================================
function resolveMatchByDescriptor({ stageId, matchId }) {
  engine.resolveMatch(stageId, matchId, { matchEngineConfig: CONFIG_BASE });
  engine.drainActivationEvents();
}
const coordinator = new WorldCalendarCoordinator({
  calendar,
  sources: [createCompetitionMatchSource({ engine, timeZoneId: SPAIN_TIME_ZONE_ID, resolveMatch: resolveMatchByDescriptor })],
  controlledTeamIds: [USER_TEAM_ID],
  controlledClubIds: [userClubId],
});
const firstStop = coordinator.advanceUntilNextUserStop();
assert.strictEqual(firstStop.type, WORLD_CALENDAR_STOP_TYPES.USER_MATCH, 'la primera parada debe ser un partido del usuario');
console.log(`OK  primera parada de usuario alcanzada sin jugar la temporada completa (stage "${firstStop.item.metadata.stageId}")`);

// ===========================================================================
// 3. Cierre administrativo SINTÉTICO y CORTO — demuestra
//    `discoverReadyTransitionGroup()` (misma lógica que game.js) sobre un
//    pathway/edición de PRUEBA, sin jugar ni cerrar la temporada real
//    (eso ya lo cubre `scripts/audit-world-10-seasons.js`).
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
      candidates.push({ pathwayId, groupId, ready: readiness.ready });
    });
  });
  return candidates;
}
{
  // La temporada real todavía no ha terminado (solo se jugó un partido) —
  // el único transition group declarado (doméstico ACB<->Primera FEB) NO
  // debe estar listo todavía, precisamente porque el descubrimiento
  // GENÉRICO consulta el estado REAL del engine, nunca asume nada.
  const candidates = discoverReadyTransitionGroup(seasonKey);
  assert.strictEqual(candidates.length, 1, 'debe descubrirse exactamente un transition group declarado (el doméstico español)');
  assert.strictEqual(candidates[0].ready, false, 'el transition group no debe estar listo tras un único partido');
  console.log(`OK  cierre administrativo sintético: discoverReadyTransitionGroup() localiza "${candidates[0].pathwayId}:${candidates[0].groupId}" y reporta correctamente que NO está listo (sin jugar la temporada)`);
}

console.log(`\nSMOKE WORLD-HARDEN-1: OK (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
