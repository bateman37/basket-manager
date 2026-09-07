// scripts/smoke-national-teams1.js
// NATIONAL-TEAMS-1 (DESIGN.md 10.17) — smoke SINTÉTICO y corto (sección 10
// del prompt): un mundo ficticio pequeño (nunca instalado en producción)
// con dos clubes de origen, CUATRO selecciones nacionales, una ventana
// FIBA, una competición continental "standard" y una mundial "abstract",
// comprobando convocatoria -> incorporación -> simulación -> liberación,
// integridad mundial y determinismo. Objetivo: segundos, no minutos.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

const assert = require('assert');

const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Team } = require('../src/entities/Team.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const { CompetitionDefinition } = require('../src/entities/Competition.js');
const { WorldSimulationProfile, hasIndividualMatchDetail } = require('../src/entities/WorldSimulation.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const { CompetitionEngine, buildStageId } = require('../src/core/CompetitionEngine.js');
const { CompetitionSimulationService } = require('../src/core/CompetitionSimulationService.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { EligibilityService } = require('../src/core/EligibilityService.js');
const { generateFictionalTeams } = require('../src/utils/teamGenerator.js');
const { COMPETITION_IDS } = require('../src/core/CompetitionCatalog.js');

const { NationalStatusDecision } = require('../src/entities/NationalTeam.js');
const { NationalTeamRegistry } = require('../src/core/NationalTeamRegistry.js');
const { NationalTeamEligibilityService } = require('../src/core/NationalTeamEligibilityService.js');
const { NationalTeamService } = require('../src/core/NationalTeamService.js');
const NationalTeamRules = require('../src/core/NationalTeamRules.js');

const startedAt = Date.now();
console.log('=== SMOKE NATIONAL-TEAMS-1 (fixture sintético, 4 selecciones — continental "standard" + mundial "abstract") ===\n');

const RULESET_ID = NationalTeamRules.FICTIONAL_TEST_RULESET_ID;
const SEASON_KEY = '2026-27';
const ROUND_ROBIN_FORMAT_ID = 'test-fixture:national-teams1-smoke:format:round-robin-v1';
if (!FormatCatalog.hasFormat(ROUND_ROBIN_FORMAT_ID)) {
  FormatCatalog.registerFormat({
    id: ROUND_ROBIN_FORMAT_ID,
    version: '1.0.0',
    status: 'fictional-test',
    participantType: 'national-team',
    stageTemplates: [{
      key: 'group',
      stageType: 'round-robin',
      runnerType: 'round-robin',
      sequence: 1,
      activation: { type: 'edition-start' },
      entrySource: { type: 'initial-participants' },
      runnerConfig: { legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }] },
      completesEdition: true,
    }],
  });
}

// -----------------------------------------------------------------------
// 1. Mundo: raíz + continente + país; dos clubes de origen (con roster
//    real) + cuatro federaciones/selecciones nacionales.
// -----------------------------------------------------------------------
const world = new GameWorld({ id: 'world:smoke-national-teams1', careerSeed: 'smoke-national-teams1-seed' });
world.registries.registerArea(new GeographicArea({ id: 'nt-smoke-area-world', type: 'world', parentAreaId: null, name: 'Mundo' }));
world.registries.registerArea(new GeographicArea({
  id: 'nt-smoke-area-continent', type: 'continent', parentAreaId: 'nt-smoke-area-world', name: '[TEST] Continente',
}));
world.registries.registerArea(new GeographicArea({
  id: 'nt-smoke-area-country', type: 'country', parentAreaId: 'nt-smoke-area-continent', name: '[TEST] Smokeland', isoCode: 'XX',
}));

world.registries.registerOrganization(new Organization({
  id: 'nt-smoke-domestic-fed', name: '[TEST] Federación doméstica', type: 'national-federation', headquartersAreaId: 'nt-smoke-area-country', scopeAreaId: 'nt-smoke-area-country',
}));

const clubs = generateFictionalTeams(2).map((team, index) => {
  const club = new Club({
    id: `nt-smoke-club-${index}`, name: team.name, homeAreaId: 'nt-smoke-area-country', employerJurisdictionAreaId: 'nt-smoke-area-country', primaryTeamId: team.id, dataSource: 'test-fixture',
  });
  world.registries.registerClub(club);
  team.clubId = club.id;
  team.club = club;
  world.registries.registerTeam(team);
  const squad = new Squad({ id: `nt-smoke-club-squad-${index}`, teamId: team.id, players: team.roster, dataSource: 'test-fixture' });
  world.registries.registerSquad(squad);
  team.squad = squad;
  team.primarySquadId = squad.id;
  return { club, team, squad };
});
const playerPool = clubs.flatMap((c) => c.team.roster);
assert.ok(playerPool.length >= 20, 'el fixture necesita un pool de jugadores suficiente para 4 selecciones x 5');
console.log(`OK  1 GameWorld + 2 clubes ficticios de origen (${playerPool.length} jugadores en el pool)`);

const NATIONAL_TEAM_IDS = ['nt-smoke-team-a', 'nt-smoke-team-b', 'nt-smoke-team-c', 'nt-smoke-team-d'];
NATIONAL_TEAM_IDS.forEach((id, index) => {
  const fedId = `${id}-fed`;
  world.registries.registerOrganization(new Organization({
    id: fedId, name: `[TEST] Federación Nacional ${id}`, type: 'national-federation', headquartersAreaId: 'nt-smoke-area-country', scopeAreaId: 'nt-smoke-area-country',
  }));
  const nationalTeam = new Team({
    id, name: `[TEST] Selección ${id}`, teamKind: 'national-team', federationOrganizationId: fedId, representedAreaId: 'nt-smoke-area-country',
    category: { gender: 'men', ageTier: 'senior' },
  });
  world.registries.registerTeam(nationalTeam);
});
console.log(`OK  4 equipos "national-team" registrados (${NATIONAL_TEAM_IDS.join(', ')}) — mismo motor, sin Club, con federación/área reales`);

const playerRegistry = new PlayerRegistry();
playerPool.forEach((p) => playerRegistry.register(p));
const registrationRegistry = new RegistrationRegistry();
const nationalTeamRegistry = new NationalTeamRegistry();
world.attachDomainRegistries({ playerRegistry, registrationRegistry, nationalTeamRegistry });

// -----------------------------------------------------------------------
// 2. Competiciones de selecciones sobre el MISMO motor genérico:
//    continental "standard" + mundial "abstract".
// -----------------------------------------------------------------------
const simulationProfile = new WorldSimulationProfile({
  id: 'nt-smoke-profile', version: '1.0.0', defaultDetailLevel: 'abstract',
  assignments: [
    { scopeType: 'competition', scopeId: 'nt-smoke-continental-cup', detailLevel: 'standard' },
    { scopeType: 'competition', scopeId: 'nt-smoke-world-cup', detailLevel: 'abstract' },
  ],
  provenance: { status: 'design', notes: 'Perfil sintético de smoke — nunca dato real.' },
});
world.setSimulationProfile(simulationProfile);

world.registries.registerCompetitionDefinition(new CompetitionDefinition({
  id: 'nt-smoke-continental-cup', name: '[TEST] Copa Continental', scopeLevel: 'continental', scopeAreaId: 'nt-smoke-area-continent',
  organizerId: 'nt-smoke-team-a-fed', participantType: 'national-team', kind: 'championship', implementationStatus: 'active-runtime', bindings: {},
}));
world.registries.registerCompetitionDefinition(new CompetitionDefinition({
  id: 'nt-smoke-world-cup', name: '[TEST] Mundial', scopeLevel: 'world', scopeAreaId: null,
  organizerId: 'nt-smoke-team-a-fed', participantType: 'national-team', kind: 'championship', implementationStatus: 'active-runtime', bindings: {},
}));

const simulationService = new CompetitionSimulationService({ world, careerSeed: 'smoke-national-teams1-seed' });
NATIONAL_TEAM_IDS.forEach((id, index) => {
  simulationService.registerSnapshot({
    teamId: id,
    seasonKey: SEASON_KEY,
    effectiveDetailLevel: 'standard',
    rosterCoverage: 'aggregate',
    materializedPlayerIds: [],
    estimatedRosterSize: 5,
    strength: { overall: 50 + index * 6, offense: 50 + index * 6, defense: 50 + index * 6 },
    strengthSource: 'smoke-fixture-explicit',
    generatedAtGameDate: '2026-06-01',
    provenance: { status: 'design', notes: 'Fixture de smoke — nunca dato real.' },
  });
});

const engine = new CompetitionEngine({ world, simulationService });
function isoDateAtDayOffset(dayOffset) {
  return new Date(Date.UTC(2026, 6, 1 + dayOffset, 18, 0, 0)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
engine.setDateResolverProvider(({ edition }) => {
  if (edition.detailLevel === 'abstract') return () => ({ scheduledAt: isoDateAtDayOffset(20), timeZoneId: 'UTC' });
  return (meta) => ({ scheduledAt: isoDateAtDayOffset((meta.round - 1) * 2), timeZoneId: 'UTC' });
});

const { edition: continentalEdition } = engine.registerEditionWithInitialEntries({
  competitionDefinitionId: 'nt-smoke-continental-cup', seasonKey: SEASON_KEY, formatBindingId: ROUND_ROBIN_FORMAT_ID,
  participants: NATIONAL_TEAM_IDS.map((id, i) => ({ id, seed: i + 1 })), detailLevel: 'standard',
});
engine.initializeEdition(continentalEdition.id);
const { edition: worldEdition } = engine.registerEditionWithInitialEntries({
  competitionDefinitionId: 'nt-smoke-world-cup', seasonKey: SEASON_KEY, formatBindingId: ROUND_ROBIN_FORMAT_ID,
  participants: NATIONAL_TEAM_IDS.map((id, i) => ({ id, seed: i + 1 })), detailLevel: 'abstract',
});
engine.initializeEdition(worldEdition.id);
console.log('OK  Copa Continental ("standard") + Mundial ("abstract") inicializadas — CompetitionDefinition/Edition/Stage/Entry, MISMO CompetitionEngine que un club-team');

// -----------------------------------------------------------------------
// 3. Ventana FIBA + convocatoria -> incorporación (NationalTeamService).
// -----------------------------------------------------------------------
const service = new NationalTeamService({ nationalTeamRegistry, world, playerRegistry, rulesetBundleId: RULESET_ID });
const window = service.openWindow({
  id: 'nt-smoke-window', seasonKey: SEASON_KEY, windowKind: 'continental-championship', organizerOrganizationId: 'nt-smoke-team-a-fed',
  competitionDefinitionId: 'nt-smoke-continental-cup', competitionEditionId: continentalEdition.id, timeZoneId: 'UTC',
  noticeDueAt: isoDateAtDayOffset(-30), preliminaryRosterDueAt: isoDateAtDayOffset(-20), finalRosterDueAt: isoDateAtDayOffset(-10),
  dutyStartsAt: isoDateAtDayOffset(-1), dutyEndsAt: isoDateAtDayOffset(25),
});

let poolCursor = 0;
function nextPlayers(count) {
  const slice = playerPool.slice(poolCursor, poolCursor + count);
  poolCursor += count;
  return slice;
}

const callUpsByTeam = {};
NATIONAL_TEAM_IDS.forEach((nationalTeamId, index) => {
  const preliminary = nextPlayers(6);
  // Decisión de nacionalidad APROBADA para cada convocado — el primer
  // equipo demuestra el caso "restricted" (máximo 1 permitido).
  preliminary.forEach((player, i) => {
    nationalTeamRegistry.registerDecision(new NationalStatusDecision({
      id: `nt-smoke-decision-${nationalTeamId}-${player.id}`,
      playerId: player.id,
      federationOrganizationId: `${nationalTeamId}-fed`,
      representedAreaId: 'nt-smoke-area-country',
      status: (index === 0 && i === 0) ? 'approved-restricted' : 'approved-unrestricted',
      decidedAtGameDate: '2026-05-15',
      rulesetBundleId: RULESET_ID,
      validFrom: '2026-05-15',
    }));
  });
  const selection = service.createSelection({
    id: `nt-smoke-selection-${nationalTeamId}`, nationalTeamId, windowId: window.id, seasonKey: SEASON_KEY,
  });
  service.savePreliminaryList(selection.id, preliminary.map((p) => p.id));
  const evaluateFor = (playerId) => NationalTeamEligibilityService.evaluateNationalEligibility(
    { playerId, federationOrganizationId: `${nationalTeamId}-fed`, representedAreaId: 'nt-smoke-area-country', date: '2026-06-20' },
    { playerRegistry, registrationRegistry, nationalTeamRegistry, rulesetBundleId: RULESET_ID },
  );
  const finalList = preliminary.slice(0, 5).map((p) => p.id);
  service.finalizeList(selection.id, finalList, evaluateFor);
  const callUps = service.notifyCallUps(selection.id);
  callUpsByTeam[nationalTeamId] = callUps;
});
console.log('OK  4 listas preliminares (6) -> finales (5, una con 1 "restricted") -> convocatorias notificadas, todo vía NationalTeamEligibilityService (nunca elegido por overall/reputación)');

service.setWindowStatus(window.id, 'open');
service.startInternationalService(window.id);
NATIONAL_TEAM_IDS.forEach((nationalTeamId) => {
  const squad = world.registries.squads.forTeam(nationalTeamId).find((s) => s.status === 'active' && s.membershipContext === 'national-team-duty');
  assert.ok(squad, `falta squad "national-team-duty" activo para "${nationalTeamId}"`);
  assert.strictEqual(squad.players.length, 5);
});
console.log('OK  incorporación: 4 squads "national-team-duty" activos (20 jugadores), MISMAS instancias que sus clubes de origen');

// Doble pertenencia + Player.teamId intacto (invariantes 2-4).
const sampleTeamId = NATIONAL_TEAM_IDS[0];
const samplePlayer = callUpsByTeam[sampleTeamId][0];
const sampleOriginalTeamId = playerRegistry.get(samplePlayer.playerId).teamId;
assert.ok(world.registries.squads.activeClubSquadForPlayer(samplePlayer.playerId), 'el convocado sigue en su squad de club');
assert.ok(world.registries.squads.activeNationalTeamSquadForPlayer(samplePlayer.playerId), 'el convocado tiene squad nacional activo');
assert.strictEqual(
  world.registries.squads.activeClubSquadForPlayer(samplePlayer.playerId).players.find((p) => p.id === samplePlayer.playerId),
  world.registries.squads.activeNationalTeamSquadForPlayer(samplePlayer.playerId).players.find((p) => p.id === samplePlayer.playerId),
  'identidad ESTRICTA de Player entre club y selección',
);
assert.strictEqual(playerRegistry.get(samplePlayer.playerId).teamId, sampleOriginalTeamId, 'Player.teamId nunca lo toca una convocatoria');

// Indisponibilidad de club durante la ventana + recuperación automática.
const originClub = clubs.find((c) => c.team.roster.some((p) => p.id === samplePlayer.playerId)).club;
const originTeam = clubs.find((c) => c.club.id === originClub.id).team;
function evaluateDomestic(dateIso) {
  return EligibilityService.evaluateEligibility(samplePlayer.playerId, originTeam.id, {
    competitionId: COMPETITION_IDS.TEST_FICTIONAL, seasonKey: SEASON_KEY, date: dateIso, operation: 'buildMatchSquad',
  }, {
    playerRegistry, registrationRegistry, nationalTeamRegistry, clubId: originClub.id,
  });
}
assert.ok(evaluateDomestic(isoDateAtDayOffset(10).slice(0, 10)).reasons.some((r) => r.code === 'NATIONAL_TEAM_DUTY'), 'debe bloquear al club DURANTE el servicio');
assert.ok(!evaluateDomestic(isoDateAtDayOffset(30).slice(0, 10)).reasons.some((r) => r.code === 'NATIONAL_TEAM_DUTY'), 'debe recuperar disponibilidad automáticamente tras la ventana');
console.log('OK  duty: NATIONAL_TEAM_DUTY bloquea al club durante el servicio y desaparece solo después — el jugador nunca salió de su club');

// -----------------------------------------------------------------------
// 4. Simulación: continental "standard" (marcadores compactos) + mundial
//    "abstract" (un único hito/receipt).
// -----------------------------------------------------------------------
const continentalStageId = buildStageId('nt-smoke-continental-cup', SEASON_KEY, 'group');
let guard = 0;
while (engine.listPendingMatches(continentalStageId).length && guard < 50) {
  const next = engine.listPendingMatches(continentalStageId)[0];
  engine.resolveMatch(continentalStageId, next.id, {});
  guard += 1;
}
const continentalRunner = engine.getRunner(continentalStageId);
assert.strictEqual(continentalRunner.isComplete, true);
continentalRunner.matches.forEach((m) => {
  assert.strictEqual(hasIndividualMatchDetail(m.result), false, '"standard" nunca fabrica detalle individual');
  assert.notStrictEqual(m.result.finalScore.home, m.result.finalScore.away, '"standard" nunca deja empate');
});
console.log(`OK  Copa Continental "standard" resuelta (${continentalRunner.matches.length} partidos, marcadores compactos, sin empates)`);

const worldStageId = buildStageId('nt-smoke-world-cup', SEASON_KEY, 'group');
const milestones = engine.listAllPendingAbstractMilestones().filter((m) => m.stageId === worldStageId);
assert.strictEqual(milestones.length, 1, '"abstract" deja EXACTAMENTE un hito por fase');
engine.resolveAbstractMilestone(worldStageId, milestones[0].id, {});
const worldReceipts = world.registries.competitionSimulationReceipts.forStage(worldStageId);
assert.strictEqual(worldReceipts.length, 1);
assert.strictEqual(engine.getRunner(worldStageId).getPendingMatches().length, 0, '"abstract" nunca crea partidos individuales');
console.log('OK  Mundial "abstract" resuelto en UN solo hito/receipt — cero partidos individuales');

// Invariante 15: ningún resultado standard/abstract fabrica una aparición
// individual por sí solo — nada en este smoke llamó a
// `service.registerAppearance()`, así que el registro sigue vacío.
assert.strictEqual(nationalTeamRegistry.allAppearances().length, 0, 'un resultado standard/abstract nunca crea NationalTeamAppearanceReceipt por sí solo');
console.log('OK  invariante 15 confirmada: cero apariciones individuales fabricadas por resultados standard/abstract');

// -----------------------------------------------------------------------
// 5. Liberación.
// -----------------------------------------------------------------------
service.endInternationalService(window.id);
NATIONAL_TEAM_IDS.forEach((nationalTeamId) => {
  const releasedCallUps = nationalTeamRegistry.callUpsForWindow(window.id).filter((c) => c.nationalTeamId === nationalTeamId);
  releasedCallUps.forEach((c) => assert.strictEqual(c.status, 'released'));
  const squad = world.registries.squads.forTeam(nationalTeamId).find((s) => s.membershipContext === 'national-team-duty');
  assert.strictEqual(squad.status, 'historical');
});
assert.strictEqual(world.registries.squads.activeNationalTeamSquadForPlayer(samplePlayer.playerId), null, 'sin squad nacional activo tras liberar');
assert.ok(world.registries.squads.activeClubSquadForPlayer(samplePlayer.playerId), 'el squad de club sigue intacto tras liberar');
console.log('OK  liberación: convocatorias "released", squads nacionales históricos — plantilla de club intacta');

// -----------------------------------------------------------------------
// 6. Integridad mundial completa.
// -----------------------------------------------------------------------
assert.deepStrictEqual(world.registries.validateIntegrity(), []);
const ntIntegrity = nationalTeamRegistry.validateIntegrity({
  playerRegistry, teams: world.registries.teams.all(), organizations: world.registries.organizations,
});
assert.strictEqual(ntIntegrity.valid, true, ntIntegrity.errors.join(' | '));
console.log('OK  integridad World/Competition/NationalTeamRegistry limpia al final del smoke');

// -----------------------------------------------------------------------
// 7. Determinismo — orden de registro invertido no cambia el resultado.
// -----------------------------------------------------------------------
function buildDecisionsRegistry(order) {
  const registry = new NationalTeamRegistry();
  const decisions = NATIONAL_TEAM_IDS.map((nationalTeamId, i) => new NationalStatusDecision({
    id: `det-decision-${nationalTeamId}`, playerId: `det-player-${i}`, federationOrganizationId: `${nationalTeamId}-fed`,
    representedAreaId: 'nt-smoke-area-country', status: 'approved-unrestricted', decidedAtGameDate: '2026-05-01', rulesetBundleId: RULESET_ID,
  }));
  (order === 'reverse' ? [...decisions].reverse() : decisions).forEach((d) => registry.registerDecision(d));
  return registry.allDecisions().map((d) => d.id);
}
assert.deepStrictEqual(buildDecisionsRegistry('forward'), buildDecisionsRegistry('reverse'));
console.log('OK  determinismo verificado con orden de registro invertido: mismo resultado (NationalTeamRegistry.allDecisions())');

console.log(`\nSMOKE TEST NATIONAL-TEAMS-1: OK (4 selecciones, 1 ventana FIBA, 1 competición "standard" + 1 "abstract", ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
