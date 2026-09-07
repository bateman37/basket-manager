// scripts/smoke-world-ui1.js
// WORLD-UI-1 (DESIGN.md 10.18) — smoke CORTO (sección 11 del prompt): la
// configuración por defecto de carrera → construcción de la carrera real
// (36 equipos) → recorrido Mundo → Europa → España/Andorra → ACB →
// primera parada válida de "Continuar". No simula una temporada completa
// ni cada club, no ejecuta Playwright. Convención del proyecto:
// identificadores en inglés, comentarios en español.

const assert = require('assert');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const CareerSetupService = require('../src/core/CareerSetupService.js');
const WorldNavigationService = require('../src/core/WorldNavigationService.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { CompetitionEngine, buildEditionId } = require('../src/core/CompetitionEngine.js');
const { CompetitionScheduleCatalog } = require('../src/core/CompetitionScheduleCatalog.js');
const { CompetitionScheduleService } = require('../src/core/CompetitionScheduleService.js');
const { WorldCalendar } = require('../src/core/WorldCalendar.js');
const {
  WorldCalendarCoordinator, WORLD_CALENDAR_STOP_TYPES, createCompetitionMatchSource,
} = require('../src/core/WorldCalendarCoordinator.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const {
  SPAIN_MANIFEST, SPAIN_SCHEDULE_IDS, SPAIN_TIME_ZONE_ID, registerSpainSchedules,
} = require('../data/world/spain-2026.1.js');
const { REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');

const startedAt = Date.now();
console.log('=== SMOKE WORLD-UI-1 (configuración por defecto → carrera real → navegación Mundo) ===\n');

// 1. Configuración de carrera por defecto (pantalla de configuración).
const MANIFESTS = [WORLD_CORE_MANIFEST, SPAIN_MANIFEST];
const MANIFESTS_BY_ID = new Map(MANIFESTS.map((m) => [m.id, m]));
const catalog = CareerSetupService.buildCatalog(MANIFESTS, CompetitionCatalog);
const defaultSeason = catalog.seasons.find((s) => s.isDefault);
const draft = CareerSetupService.buildDefaultDraft(catalog, {
  referenceDate: `${defaultSeason.seasonStartYear}-10-03`, careerSeed: null,
});
const USER_TEAM_ID = 'team-unicaja';
const club = catalog.clubs.find((c) => c.teamId === USER_TEAM_ID);
draft.controlledClubId = club.clubId;
draft.controlledTeamId = club.teamId;
draft.careerSeed = `${club.teamId}|${draft.seasonStartYear}`;
const { valid, errors } = CareerSetupService.validateDraft(catalog, MANIFESTS_BY_ID, draft);
assert.ok(valid, `el borrador por defecto + club debe validar: ${JSON.stringify(errors)}`);
const snapshot = CareerSetupService.buildSnapshot(catalog, MANIFESTS_BY_ID, draft, { idFactory: () => 'career:smoke-world-ui1' });
console.log(`OK  configuración por defecto válida — club controlado ${club.name} (${club.clubId})`);

// 2. Construcción de la carrera real (equivalente a startCareerFromSetup()).
function buildRealTeam(teamData) {
  const roster = teamData.roster.map((p) => new Player(p));
  return new Team({ ...teamData, roster });
}
const teamsByCompetitionId = {};
catalog.clubs.forEach((c) => {
  const team = buildRealTeam(REAL_DATA_TEAMS[c.teamId]);
  const key = c.initialCompetitionDefinitionId;
  if (!teamsByCompetitionId[key]) teamsByCompetitionId[key] = [];
  teamsByCompetitionId[key].push(team);
});
const simulationProfile = CareerSetupService.buildSimulationProfile(snapshot);
const startPlan = CareerSetupService.buildStartPlan(snapshot, MANIFESTS_BY_ID);
const world = WorldFactory.buildCareerWorld({
  id: `world:smoke-world-ui1:${snapshot.careerSeed}`,
  name: 'Mundo de la carrera (smoke WORLD-UI-1)',
  careerSeed: snapshot.careerSeed,
  createdAtGameDate: snapshot.createdAtGameDate,
  packs: startPlan.packs,
  context: { teamsByCompetitionId, seasonKey: snapshot.seasonKey, seasonStartDate: snapshot.createdAtGameDate },
  simulationProfile,
});
assert.strictEqual(world.registries.teams.all().length, 36, 'deben construirse los 36 equipos reales');
assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo recién construido debe validar sin errores');
console.log('OK  36 equipos/clubes reales construidos, mundo íntegro');

registerSpainSchedules();
const scheduleService = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
const acbSchedule = CompetitionScheduleCatalog.requireSchedule(SPAIN_SCHEDULE_IDS.ACB);
const seasonStartInstant = scheduleService.seasonStartInstant(acbSchedule, snapshot.seasonStartYear);
const seasonWindowStartInstant = scheduleService.seasonWindowStartInstant(acbSchedule, snapshot.seasonStartYear);
const calendar = new WorldCalendar({
  id: `calendar:smoke-world-ui1:${snapshot.careerSeed}`,
  defaultTimeZoneId: snapshot.timeZoneId,
  initialInstant: seasonWindowStartInstant,
});
calendar.registerSeason({
  seasonKey: snapshot.seasonKey,
  startInstant: seasonStartInstant,
  timeZoneId: snapshot.timeZoneId,
  scheduleIds: [SPAIN_SCHEDULE_IDS.ACB, SPAIN_SCHEDULE_IDS.PRIMERA_FEB, SPAIN_SCHEDULE_IDS.COPA_ACB],
});
world.setCalendar(calendar);

const engine = new CompetitionEngine({ world });
engine.setDateResolverProvider(scheduleService.buildDateResolverProvider({
  seasonStartYearForEdition: (edition) => LocalDate.seasonStartYear(edition.seasonKey),
}));
// WORLD-UI-1 (BUG-WORLDUI-03): Editions de arranque DERIVADAS del registro,
// nunca dos ids codificados.
world.registries.competitionEditions.forSeason(snapshot.seasonKey)
  .filter((edition) => edition.status !== 'completed' && edition.status !== 'cancelled')
  .forEach((edition) => engine.initializeEdition(edition.id));
console.log(`OK  ${world.registries.competitionEditions.forSeason(snapshot.seasonKey).length} Editions de arranque inicializadas (derivadas del registro)`);

// 3. Navegación Mundo → Europa → España/Andorra → ACB.
const registries = world.registries;
const worldBreadcrumb = WorldNavigationService.breadcrumbForArea(registries, 'area-world');
assert.strictEqual(worldBreadcrumb.length, 1);
const europeChildren = WorldNavigationService.childrenOfArea(registries, 'area-continent-europe');
assert.ok(europeChildren.some((a) => a.areaId === 'area-country-es'));
assert.ok(europeChildren.some((a) => a.areaId === 'area-country-ad'));
const spainClubs = WorldNavigationService.clubsForArea(registries, 'area-country-es');
assert.strictEqual(spainClubs.length, 35);
const andorraClubs = WorldNavigationService.clubsForArea(registries, 'area-country-ad');
assert.strictEqual(andorraClubs.length, 1);
const andorraExternal = WorldNavigationService.externalCompetitionsForAreaClubs(registries, 'area-country-ad');
assert.strictEqual(andorraExternal[0].competitionDefinitionId, CompetitionCatalog.COMPETITION_IDS.ACB);
const acbView = WorldNavigationService.competitionView(registries, CompetitionCatalog.COMPETITION_IDS.ACB, { engine, seasonKey: snapshot.seasonKey });
assert.strictEqual(acbView.participants.length, 18);
console.log('OK  Mundo → Europa → España (35 clubes) / Andorra (MoraBanc, participa en ACB) → ACB (18 participantes)');

// 4. "Continuar" hasta la primera parada válida del equipo controlado.
function resolveMatchByDescriptor({ stageId, matchId }) {
  engine.resolveMatch(stageId, matchId, {});
  engine.drainActivationEvents();
}
const coordinator = new WorldCalendarCoordinator({
  calendar,
  sources: [createCompetitionMatchSource({ engine, timeZoneId: snapshot.timeZoneId, resolveMatch: resolveMatchByDescriptor })],
  controlledTeamIds: [USER_TEAM_ID],
  controlledClubIds: [world.registries.teams.require(USER_TEAM_ID).clubId],
});
const stop = coordinator.advanceUntilNextUserStop();
assert.strictEqual(stop.type, WORLD_CALENDAR_STOP_TYPES.USER_MATCH, `la primera parada debe ser un partido del usuario (fue "${stop.type}")`);
assert.ok(
  stop.item.metadata.homeParticipantId === USER_TEAM_ID || stop.item.metadata.awayParticipantId === USER_TEAM_ID,
  'la parada debe involucrar al equipo controlado',
);
console.log(`OK  "Continuar" llega a la primera parada válida: partido del usuario (${stop.item.metadata.matchId})`);

console.log(`\nSMOKE TEST WORLD-UI-1: OK (36 equipos, configuración por defecto, navegación Mundo, 1 parada de usuario, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
