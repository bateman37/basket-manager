// scripts/test-world-sim1.js
// WORLD-SIM-1 (DESIGN.md 10.16) — batería DIRIGIDA (sección 18.1 del
// prompt), no exhaustiva. Convención del proyecto: identificadores en
// inglés, comentarios en español. Reutiliza el patrón de fixture de
// `scripts/test-pathways1.js` (mundo ficticio no español), sin copiarlo
// entero.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { CompetitionDefinition } = require('../src/entities/Competition.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const {
  DETAIL_LEVELS, capabilitiesForDetailLevel, hasIndividualMatchDetail, resolveAreaChain,
  WorldSimulationProfile, TeamSimulationSnapshot, CompetitionSimulationReceipt,
} = require('../src/entities/WorldSimulation.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const { CompetitionEngine, buildEditionId, buildStageId } = require('../src/core/CompetitionEngine.js');
const { CompetitionSimulationService } = require('../src/core/CompetitionSimulationService.js');
const { AbstractCompetitionStageRuntime } = require('../src/core/AbstractCompetitionStageRuntime.js');
const { WorldLifecycleService } = require('../src/core/WorldLifecycleService.js');
const { MarketService } = require('../src/core/MarketService.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { Player } = require('../src/entities/Player.js');
const { generateFictionalTeams } = require('../src/utils/teamGenerator.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${err.message}`);
  }
}

// -----------------------------------------------------------------------
// Fixtures — mundo de TEST no español, con área Mundo->Continente->País.
// -----------------------------------------------------------------------
let worldSeq = 0;
function buildWorld() {
  worldSeq += 1;
  const world = new GameWorld({ id: `world:ws-test-${worldSeq}`, careerSeed: `ws-test-${worldSeq}-seed` });
  world.registries.registerArea(new GeographicArea({ id: 'ws-area-world', type: 'world', parentAreaId: null, name: 'Mundo' }));
  world.registries.registerArea(new GeographicArea({
    id: 'ws-area-continent', type: 'continent', parentAreaId: 'ws-area-world', name: '[TEST] Continente',
  }));
  world.registries.registerArea(new GeographicArea({
    id: 'ws-area-country', type: 'country', parentAreaId: 'ws-area-continent', name: '[TEST] Testland', isoCode: 'XX',
  }));
  return world;
}

function registerLeagueInto(world, {
  leagueId, teamCount, orgId = `org-${leagueId}`, areaId = 'ws-area-country',
}) {
  world.registries.registerOrganization(new Organization({
    id: orgId, name: `[TEST] Federación ${orgId}`, type: 'national-federation', headquartersAreaId: areaId, scopeAreaId: areaId,
  }));
  const definition = new CompetitionDefinition({
    id: leagueId, name: `[TEST] Liga ${leagueId}`, scopeLevel: 'national', scopeAreaId: areaId,
    organizerId: orgId, participantType: 'club-team', kind: 'league', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(definition);
  const teams = generateFictionalTeams(teamCount, { seed: `${leagueId}-teams` });
  teams.forEach((team) => {
    const club = new Club({
      id: `ws-club-${team.id}`, name: team.name, homeAreaId: areaId, employerJurisdictionAreaId: areaId, primaryTeamId: team.id, dataSource: 'test-fixture',
    });
    world.registries.registerClub(club);
    team.clubId = club.id;
    team.club = club;
    world.registries.registerTeam(team);
    const squad = new Squad({ id: `ws-squad-${team.id}`, teamId: team.id, players: team.roster, dataSource: 'test-fixture' });
    world.registries.registerSquad(squad);
    team.squad = squad;
    team.primarySquadId = squad.id;
  });
  return { definition, teams };
}

const ROUND_ROBIN_FORMAT_ID = 'test-fixture:world-sim1:format:round-robin-v1';
function registerRoundRobinFormat() {
  if (FormatCatalog.hasFormat(ROUND_ROBIN_FORMAT_ID)) return;
  FormatCatalog.registerFormat({
    id: ROUND_ROBIN_FORMAT_ID,
    version: '1.0.0',
    status: 'fictional-test',
    participantType: 'club-team',
    stageTemplates: [{
      key: 'regular-season',
      stageType: 'round-robin',
      runnerType: 'round-robin',
      sequence: 1,
      activation: { type: 'edition-start' },
      entrySource: { type: 'initial-participants' },
      runnerConfig: {
        legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }],
      },
      completesEdition: true,
    }],
  });
}

const BRACKET_FORMAT_ID = 'test-fixture:world-sim1:format:bracket-v1';
function registerBracketFormat() {
  if (FormatCatalog.hasFormat(BRACKET_FORMAT_ID)) return;
  FormatCatalog.registerFormat({
    id: BRACKET_FORMAT_ID,
    version: '1.0.0',
    status: 'fictional-test',
    participantType: 'club-team',
    stageTemplates: [{
      key: 'knockout',
      stageType: 'knockout',
      runnerType: 'bracket',
      sequence: 1,
      activation: { type: 'edition-start' },
      entrySource: { type: 'initial-participants' },
      runnerConfig: { firstRoundPairing: [[1, 4], [2, 3]], roundPatterns: ['single-game', 'single-game'] },
      completesEdition: true,
    }],
  });
}

// Formato MULTI-fase (nunca soportado por "abstract" — sección 6 del
// prompt, límite consciente).
const MULTI_STAGE_FORMAT_ID = 'test-fixture:world-sim1:format:multi-stage-v1';
function registerMultiStageFormat() {
  if (FormatCatalog.hasFormat(MULTI_STAGE_FORMAT_ID)) return;
  FormatCatalog.registerFormat({
    id: MULTI_STAGE_FORMAT_ID,
    version: '1.0.0',
    status: 'fictional-test',
    participantType: 'club-team',
    stageTemplates: [
      {
        key: 'regular-season',
        stageType: 'round-robin',
        runnerType: 'round-robin',
        sequence: 1,
        activation: { type: 'edition-start' },
        entrySource: { type: 'initial-participants' },
        runnerConfig: { legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }] },
      },
      {
        key: 'knockout-top2',
        stageType: 'knockout',
        runnerType: 'bracket',
        sequence: 2,
        activation: { type: 'pathway-managed' },
        entrySource: { type: 'pathway-managed' },
        runnerConfig: { firstRoundPairing: [[1, 2]], roundPatterns: ['single-game'] },
        completesEdition: true,
      },
    ],
  });
}

function registerSnapshotsForTeams(service, teams, seasonKey, { effectiveDetailLevel = 'standard', overallByTeamId } = {}) {
  teams.forEach((team, index) => {
    service.registerSnapshot({
      teamId: team.id,
      seasonKey,
      effectiveDetailLevel,
      rosterCoverage: 'aggregate',
      materializedPlayerIds: [],
      estimatedRosterSize: 12,
      strength: {
        overall: overallByTeamId ? overallByTeamId[team.id] : 50 + index,
        offense: overallByTeamId ? overallByTeamId[team.id] : 50 + index,
        defense: overallByTeamId ? overallByTeamId[team.id] : 50 + index,
      },
      strengthSource: 'test-fixture-explicit',
      generatedAtGameDate: '2026-09-01',
      provenance: { status: 'design', notes: 'Fixture de prueba — nunca dato real.' },
    });
  });
}

const NOW = () => ({ instant: '2026-09-01T00:00:00Z', timeZoneId: 'UTC' });
// Fecha/huso EXPLÍCITOS del hito de resolución "abstract" (nunca el reloj
// del sistema) — en producción llegaría del calendario del contenido
// (`CompetitionScheduleService`); aquí basta un valor fijo por fixture.
// `setDateResolverProvider(fn)` espera `fn(activationContext) -> (meta) ->
// scheduling` (mismo contrato que el resolver real de contenido) — nunca
// la fecha directa, para no enmascarar un mal uso de ese punto de encaje.
function abstractDateResolverProvider() { return () => () => ({ scheduledAt: '2099-09-01T00:00:00Z', timeZoneId: 'UTC' }); }

// =========================================================================
// 1. Vocabulario cerrado, serialización e inmutabilidad del profile
// =========================================================================
check('vocabulario cerrado de detailLevel; capabilitiesForDetailLevel lanza ante nivel desconocido y nunca guarda booleanos sueltos', () => {
  assert.deepStrictEqual(DETAIL_LEVELS, ['playable', 'full', 'standard', 'abstract']);
  assert.throws(() => capabilitiesForDetailLevel('legendary'), /no válido/);
  const caps = capabilitiesForDetailLevel('playable');
  assert.strictEqual(caps.allowsUserMatchStop, true);
  assert.strictEqual(capabilitiesForDetailLevel('full').allowsUserMatchStop, false);
  assert.strictEqual(capabilitiesForDetailLevel('standard').allowsUserMatchStop, false);
  assert.strictEqual(capabilitiesForDetailLevel('abstract').allowsUserMatchStop, false);
  assert.ok(Object.isFrozen(caps));
});

check('WorldSimulationProfile: serializable, congelado, y assignments congelados', () => {
  const profile = new WorldSimulationProfile({
    id: 'ws-profile-1', version: '1.0.0', defaultDetailLevel: 'abstract', selectedAtGameDate: '2026-09-01',
    assignments: [{ scopeType: 'competition', scopeId: 'league-x', detailLevel: 'playable' }],
  });
  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.assignments));
  assert.ok(Object.isFrozen(profile.assignments[0]));
  const json = profile.toJSON();
  assert.strictEqual(json.defaultDetailLevel, 'abstract');
  assert.strictEqual(JSON.stringify(json), JSON.stringify(JSON.parse(JSON.stringify(json))));
});

// =========================================================================
// 2. Precedencia competition -> área más cercana -> default explícito
// =========================================================================
check('WorldSimulationProfile.resolveDetailLevel: competición exacta > área más cercana > default explícito', () => {
  const profile = new WorldSimulationProfile({
    id: 'ws-profile-2',
    version: '1.0.0',
    defaultDetailLevel: 'abstract',
    assignments: [
      { scopeType: 'area', scopeId: 'ws-area-continent', detailLevel: 'standard' },
      { scopeType: 'area', scopeId: 'ws-area-country', detailLevel: 'full' },
      { scopeType: 'competition', scopeId: 'league-exact', detailLevel: 'playable' },
    ],
  });
  // Competición exacta gana aunque la cadena de área también resolviera.
  assert.strictEqual(profile.resolveDetailLevel({ competitionDefinitionId: 'league-exact', areaChain: ['ws-area-country', 'ws-area-continent'] }), 'playable');
  // Sin assignment exacto: el área MÁS CERCANA (country) gana sobre la más lejana (continent).
  assert.strictEqual(profile.resolveDetailLevel({ competitionDefinitionId: 'league-other', areaChain: ['ws-area-country', 'ws-area-continent'] }), 'full');
  // Cadena sin ningún área con assignment: cae al default explícito.
  assert.strictEqual(profile.resolveDetailLevel({ competitionDefinitionId: 'league-other', areaChain: ['ws-area-unknown'] }), 'abstract');
  // Competición mundial (areaChain vacía): default explícito.
  assert.strictEqual(profile.resolveDetailLevel({ competitionDefinitionId: 'league-world', areaChain: [] }), 'abstract');
});

// =========================================================================
// 3. Conflicto de assignments y nivel desconocido
// =========================================================================
check('WorldSimulationProfile: dos assignments incompatibles para el mismo scope lanzan; nivel desconocido lanza; nunca se desempata por orden de array', () => {
  assert.throws(() => new WorldSimulationProfile({
    id: 'ws-profile-3', version: '1.0.0', defaultDetailLevel: 'abstract',
    assignments: [
      { scopeType: 'competition', scopeId: 'dup', detailLevel: 'playable' },
      { scopeType: 'competition', scopeId: 'dup', detailLevel: 'standard' },
    ],
  }), /incompatibles/);
  assert.throws(() => new WorldSimulationProfile({
    id: 'ws-profile-4', version: '1.0.0', defaultDetailLevel: 'legendary',
  }), /no válido/);
  assert.throws(() => new WorldSimulationProfile({
    id: 'ws-profile-5', version: '1.0.0', defaultDetailLevel: 'abstract',
    assignments: [{ scopeType: 'competition', scopeId: 'x', detailLevel: 'legendary' }],
  }), /no válido/);
  // El MISMO nivel repetido para el mismo scope es idempotente, nunca error.
  const idempotentProfile = new WorldSimulationProfile({
    id: 'ws-profile-6', version: '1.0.0', defaultDetailLevel: 'abstract',
    assignments: [
      { scopeType: 'competition', scopeId: 'same', detailLevel: 'playable' },
      { scopeType: 'competition', scopeId: 'same', detailLevel: 'playable' },
    ],
  });
  assert.strictEqual(idempotentProfile.resolveDetailLevel({ competitionDefinitionId: 'same' }), 'playable');
});

// =========================================================================
// 4. Edition con nivel obligatorio/congelado
// =========================================================================
check('CompetitionEdition: "detailLevel" es obligatorio y validado; queda en toJSON(); ningún setter permite reescribirlo', () => {
  const { CompetitionEdition } = require('../src/entities/Competition.js');
  assert.throws(() => new CompetitionEdition({ id: 'e1', competitionDefinitionId: 'c1', seasonKey: 's1' }), /detailLevel/);
  assert.throws(() => new CompetitionEdition({
    id: 'e1', competitionDefinitionId: 'c1', seasonKey: 's1', detailLevel: 'legendary',
  }), /no válido/);
  const edition = new CompetitionEdition({
    id: 'e1', competitionDefinitionId: 'c1', seasonKey: 's1', detailLevel: 'abstract',
  });
  assert.strictEqual(edition.toJSON().detailLevel, 'abstract');
  assert.strictEqual(typeof edition.setDetailLevel, 'undefined', 'no debe existir ningún setter de detailLevel');
});

// =========================================================================
// 5. Snapshots e integridad de referencias
// =========================================================================
check('TeamSimulationSnapshot: campos numéricos de fuerza obligatorios (nunca 50 por defecto); registro exige Team existente', () => {
  registerRoundRobinFormat();
  const world = buildWorld();
  const { teams } = registerLeagueInto(world, { leagueId: 'ws-snap-league', teamCount: 4 });
  assert.throws(() => new TeamSimulationSnapshot({
    teamId: teams[0].id, seasonKey: 's1', effectiveDetailLevel: 'standard', rosterCoverage: 'aggregate', estimatedRosterSize: 12, strengthSource: 'x',
  }), /strength\.overall/);
  assert.throws(() => world.registries.registerTeamSimulationSnapshot(new TeamSimulationSnapshot({
    teamId: 'unknown-team', seasonKey: 's1', effectiveDetailLevel: 'standard', rosterCoverage: 'aggregate', estimatedRosterSize: 12,
    strength: { overall: 50, offense: 50, defense: 50 }, strengthSource: 'x',
  })), /equipo inexistente/);
  const snapshot = new TeamSimulationSnapshot({
    teamId: teams[0].id, seasonKey: 's1', effectiveDetailLevel: 'standard', rosterCoverage: 'aggregate', estimatedRosterSize: 12,
    strength: { overall: 61, offense: 60, defense: 62 }, strengthSource: 'x',
  });
  world.registries.registerTeamSimulationSnapshot(snapshot);
  assert.strictEqual(world.registries.teamSimulationSnapshots.forTeamSeason(teams[0].id, 's1').strength.overall, 61);
});

// =========================================================================
// 6. "standard" determinista, sin empate y sin detalle individual falso
// =========================================================================
check('"standard": mismo fingerprint da el mismo marcador; nunca empate; sin quarterScores/boxScore; hasIndividualMatchDetail() lo detecta', () => {
  registerRoundRobinFormat();
  const world = buildWorld();
  const { definition, teams } = registerLeagueInto(world, { leagueId: 'ws-standard-league', teamCount: 4 });
  world.setSimulationProfile(new WorldSimulationProfile({
    id: 'ws-standard-profile', version: '1.0.0', defaultDetailLevel: 'abstract',
    assignments: [{ scopeType: 'competition', scopeId: definition.id, detailLevel: 'standard' }],
  }));
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-standard-seed' });
  registerSnapshotsForTeams(service, teams, '2099-00');
  const engine = new CompetitionEngine({ world, simulationService: service });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: ROUND_ROBIN_FORMAT_ID,
    participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })), detailLevel: service.resolveDetailLevelForCompetition(definition.id),
  });
  engine.initializeEdition(edition.id);
  const stageId = buildStageId(definition.id, '2099-00', 'regular-season');
  const pending = engine.listPendingMatches(stageId);
  assert.ok(pending.length > 0);
  const matchId = pending[0].id;
  const resultA = service.computeStandardResult({
    homeParticipantId: pending[0].homeParticipantId, awayParticipantId: pending[0].awayParticipantId, editionId: edition.id, stageId, matchId, seasonKey: '2099-00',
  });
  const resultB = service.computeStandardResult({
    homeParticipantId: pending[0].homeParticipantId, awayParticipantId: pending[0].awayParticipantId, editionId: edition.id, stageId, matchId, seasonKey: '2099-00',
  });
  assert.deepStrictEqual(resultA, resultB, 'mismo fingerprint -> mismo marcador');
  assert.notStrictEqual(resultA.finalScore.home, resultA.finalScore.away, '"standard" nunca deja empate');
  assert.strictEqual(resultA.quarterScores, null);
  assert.strictEqual(resultA.boxScore, null);
  assert.strictEqual(hasIndividualMatchDetail(resultA), false);
  assert.strictEqual(hasIndividualMatchDetail({ finalScore: { home: 80, away: 70 } }), true, 'un resultado sin "simulation.kind" se considera completo');
  // El motor real resuelve el partido inyectando ese marcador compacto.
  const descriptor = engine.resolveMatch(stageId, matchId, {});
  assert.deepStrictEqual(descriptor.result.finalScore, resultA.finalScore);
});

// =========================================================================
// 7/8. "abstract": sin descriptors de partido, receipt plano e idempotente
//      (round-robin) y consultas PATHWAYS sobre un bracket ya resuelto
// =========================================================================
function buildAbstractRoundRobinFixture() {
  registerRoundRobinFormat();
  const world = buildWorld();
  const { definition, teams } = registerLeagueInto(world, { leagueId: 'ws-abstract-league', teamCount: 4 });
  world.setSimulationProfile(new WorldSimulationProfile({
    id: 'ws-abstract-profile', version: '1.0.0', defaultDetailLevel: 'abstract',
  }));
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-abstract-seed' });
  registerSnapshotsForTeams(service, teams, '2099-00', { overallByTeamId: Object.fromEntries(teams.map((t, i) => [t.id, 40 + i * 10])) });
  const engine = new CompetitionEngine({ world, simulationService: service });
  engine.setDateResolverProvider(abstractDateResolverProvider());
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: ROUND_ROBIN_FORMAT_ID,
    participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })), detailLevel: 'abstract',
  });
  return {
    world, definition, teams, service, engine, edition,
  };
}

check('"abstract" (round-robin): initializeEdition no crea partidos; hito único; resolver dos veces es idempotente (mismo receipt, sin duplicar)', () => {
  const {
    world, definition, engine, edition,
  } = buildAbstractRoundRobinFixture();
  engine.initializeEdition(edition.id);
  const stageId = buildStageId(definition.id, '2099-00', 'regular-season');
  assert.strictEqual(engine.getRunner(stageId).getPendingMatches().length, 0);
  assert.strictEqual(engine.listAllPendingMatches().length, 0, 'invariante 9: "abstract" nunca aparece como partido');
  const milestones = engine.listAllPendingAbstractMilestones();
  assert.strictEqual(milestones.length, 1);
  const receiptsBefore = world.registries.competitionSimulationReceipts.all().length;
  const firstReceipt = engine.resolveAbstractMilestone(stageId, milestones[0].id, {});
  const secondReceipt = engine.resolveAbstractMilestone(stageId, milestones[0].id, {});
  assert.strictEqual(firstReceipt.id, secondReceipt.id);
  assert.strictEqual(world.registries.competitionSimulationReceipts.all().length, receiptsBefore + 1, 'repetir no duplica el receipt');
  assert.strictEqual(engine.listAllPendingAbstractMilestones().length, 0);
  assert.strictEqual(firstReceipt.result.type, 'standings');
  assert.strictEqual(firstReceipt.result.standings.length, 4);
  assert.strictEqual(engine.isStageCompleted(definition.id, '2099-00', 'regular-season'), true);
  // Plano y serializable (invariante 13/27) — nunca Map/funciones.
  const plain = JSON.parse(JSON.stringify(firstReceipt.toJSON()));
  assert.strictEqual(plain.detailLevel, 'abstract');
  assert.strictEqual(plain.provenance, 'estimated');
});

check('"abstract" (bracket): PATHWAYS puede leer campeón/ganadores de última ronda de una fase abstracta ya resuelta', () => {
  registerBracketFormat();
  const world = buildWorld();
  const { definition, teams } = registerLeagueInto(world, { leagueId: 'ws-abstract-cup', teamCount: 4 });
  world.setSimulationProfile(new WorldSimulationProfile({ id: 'ws-abstract-cup-profile', version: '1.0.0', defaultDetailLevel: 'abstract' }));
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-abstract-cup-seed' });
  registerSnapshotsForTeams(service, teams, '2099-00', { overallByTeamId: Object.fromEntries(teams.map((t, i) => [t.id, 30 + i * 20])) });
  const engine = new CompetitionEngine({ world, simulationService: service });
  engine.setDateResolverProvider(abstractDateResolverProvider());
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: BRACKET_FORMAT_ID,
    participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })), detailLevel: 'abstract',
  });
  engine.initializeEdition(edition.id);
  const stageId = buildStageId(definition.id, '2099-00', 'knockout');
  const [milestone] = engine.listAllPendingAbstractMilestones();
  engine.resolveAbstractMilestone(stageId, milestone.id, { now: NOW() });
  const champion = engine.getBracketChampion(definition.id, '2099-00', 'knockout');
  assert.ok(champion && teams.some((t) => t.id === champion.participantId));
  const finalWinners = engine.getBracketFinalRoundWinners(definition.id, '2099-00', 'knockout');
  assert.deepStrictEqual(finalWinners, [champion]);
  assert.strictEqual(engine.isStageCompleted(definition.id, '2099-00', 'knockout'), true);
});

// =========================================================================
// 9. Configuración abstracta no soportada falla ANTES de mutar
// =========================================================================
check('"abstract" con formato multi-fase falla al inicializar, sin registrar ningún runtime', () => {
  registerMultiStageFormat();
  const world = buildWorld();
  const { definition, teams } = registerLeagueInto(world, { leagueId: 'ws-abstract-unsupported', teamCount: 4 });
  world.setSimulationProfile(new WorldSimulationProfile({ id: 'ws-unsupported-profile', version: '1.0.0', defaultDetailLevel: 'abstract' }));
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-unsupported-seed' });
  registerSnapshotsForTeams(service, teams, '2099-00');
  const engine = new CompetitionEngine({ world, simulationService: service });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: MULTI_STAGE_FORMAT_ID,
    participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })), detailLevel: 'abstract',
  });
  assert.throws(() => engine.initializeEdition(edition.id), /una sola fase resoluble/);
  const stageId = buildStageId(definition.id, '2099-00', 'regular-season');
  assert.strictEqual(engine.getRunner(stageId), null, 'no debe quedar ningún runtime registrado tras el fallo');
});

check('"abstract" con bracket de tamaño no potencia de 2 falla explícito (límite consciente de esta entrega)', () => {
  registerBracketFormat();
  const world = buildWorld();
  const { definition, teams } = registerLeagueInto(world, { leagueId: 'ws-abstract-odd', teamCount: 6 });
  world.setSimulationProfile(new WorldSimulationProfile({ id: 'ws-odd-profile', version: '1.0.0', defaultDetailLevel: 'abstract' }));
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-odd-seed' });
  registerSnapshotsForTeams(service, teams, '2099-00');
  const engine = new CompetitionEngine({ world, simulationService: service });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: BRACKET_FORMAT_ID,
    participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })), detailLevel: 'abstract',
  });
  assert.throws(() => engine.initializeEdition(edition.id), /potencia de 2/);
});

// =========================================================================
// 10. Cobertura exigida por nivel — nunca completa en silencio
// =========================================================================
check('validateCoverageForEdition: "playable" exige roster real completo; "standard" exige snapshot explícita', () => {
  registerRoundRobinFormat();
  const world = buildWorld();
  const { definition, teams } = registerLeagueInto(world, { leagueId: 'ws-coverage-league', teamCount: 4 });
  world.setSimulationProfile(new WorldSimulationProfile({ id: 'ws-coverage-profile', version: '1.0.0', defaultDetailLevel: 'standard' }));
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-coverage-seed' });
  const engine = new CompetitionEngine({ world, simulationService: service });
  const { edition: editionStandard } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: ROUND_ROBIN_FORMAT_ID,
    participants: teams.map((t) => ({ id: t.id })), detailLevel: 'standard',
  });
  // Sin snapshots registradas todavía — debe bloquear la Edition.
  assert.throws(() => engine.initializeEdition(editionStandard.id), /TeamSimulationSnapshot explícita/);
  registerSnapshotsForTeams(service, teams, '2099-00');
  engine.initializeEdition(editionStandard.id); // ahora sí resuelve.
  assert.ok(engine.getRunner(buildStageId(definition.id, '2099-00', 'regular-season')));
});

// =========================================================================
// 11. Registro/orden de Teams invertido no cambia resultados
// =========================================================================
check('orden de registro de participantes invertido no cambia el marcador "standard" ni el campeón "abstract"', () => {
  registerRoundRobinFormat();
  registerBracketFormat();
  const world = buildWorld();
  const { teams } = registerLeagueInto(world, { leagueId: 'ws-order-league', teamCount: 4 });
  world.setSimulationProfile(new WorldSimulationProfile({ id: 'ws-order-profile', version: '1.0.0', defaultDetailLevel: 'abstract' }));
  const overallByTeamId = Object.fromEntries(teams.map((t, i) => [t.id, 40 + i * 10]));
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-order-seed' });
  registerSnapshotsForTeams(service, teams, '2099-00', { overallByTeamId });
  const compactA = service.computeStandardResult({
    homeParticipantId: teams[0].id, awayParticipantId: teams[1].id, editionId: 'edition:x', stageId: 'stage:x', matchId: 'match:x', seasonKey: '2099-00',
  });
  const compactB = service.computeStandardResult({
    homeParticipantId: teams[0].id, awayParticipantId: teams[1].id, editionId: 'edition:x', stageId: 'stage:x', matchId: 'match:x', seasonKey: '2099-00',
  });
  assert.deepStrictEqual(compactA, compactB);

  // Bracket abstracto: el algoritmo PURO (`AbstractCompetitionStageRuntime`)
  // recibe las MISMAS entries (mismos participantId/seed/strength) en
  // ARRAY ORDER directo e invertido — el campeón debe ser idéntico, porque
  // el runtime ordena SIEMPRE por seed antes de resolver, nunca por orden
  // de registro/inserción.
  const strengthByParticipantId = { p1: 40, p2: 50, p3: 60, p4: 70 };
  const baseEntries = [
    { participantId: 'p1', seed: 1 }, { participantId: 'p2', seed: 2 }, { participantId: 'p3', seed: 3 }, { participantId: 'p4', seed: 4 },
  ];
  function resolveChampionWithEntries(entries) {
    let receipt = null;
    const runtime = new AbstractCompetitionStageRuntime({
      stageId: 'stage:ws-order-cup',
      competitionDefinitionId: 'ws-order-cup-definition',
      competitionEditionId: 'edition:ws-order-cup',
      stageKey: 'knockout',
      entries,
      runnerType: 'bracket',
      dateResolver: () => ({ scheduledAt: '2099-09-01T00:00:00Z', timeZoneId: 'UTC' }),
      resolveStrength: (participantId) => ({
        overall: strengthByParticipantId[participantId], offense: strengthByParticipantId[participantId], defense: strengthByParticipantId[participantId],
      }),
      careerSeed: 'ws-order-cup-seed',
      registerReceipt: (data) => { receipt = new CompetitionSimulationReceipt(data); return receipt; },
    });
    runtime.resolveMilestone(runtime.getPendingMilestones()[0].id, {});
    return receipt.result.bracketSummary.champion;
  }
  const championForward = resolveChampionWithEntries(baseEntries);
  const championReversed = resolveChampionWithEntries([...baseEntries].reverse());
  assert.deepStrictEqual(championForward, championReversed, 'el orden de registro de las entries no puede cambiar el campeón');
});

// =========================================================================
// 12. Consultar/renderizar no muta ni consume aleatoriedad
// =========================================================================
check('consultar hitos/marcador "standard" repetidamente no muta el mundo ni cambia el resultado', () => {
  const {
    world, engine, edition, definition,
  } = buildAbstractRoundRobinFixture();
  engine.initializeEdition(edition.id);
  const stageId = buildStageId(definition.id, '2099-00', 'regular-season');
  const before = JSON.stringify(world.registries.describe());
  const milestonesA = engine.listAllPendingAbstractMilestones();
  const milestonesB = engine.listAllPendingAbstractMilestones();
  assert.deepStrictEqual(milestonesA, milestonesB);
  const after = JSON.stringify(world.registries.describe());
  assert.strictEqual(before, after, 'consultar no debe mutar ningún registro');
});

// =========================================================================
// 13/14. Player exterior materializado usa Club/Team/Squad normales; sin
//        categoría/hook "external-abstract"
// =========================================================================
check('un Player en el Squad de un Team abstracto clasifica "senior-service-roster" — nunca "external-abstract" (categoría retirada)', () => {
  registerRoundRobinFormat();
  const world = buildWorld();
  const { teams } = registerLeagueInto(world, { leagueId: 'ws-lifecycle-league', teamCount: 1 });
  const [team] = teams;
  const playerRegistry = new PlayerRegistry();
  team.roster.forEach((p) => playerRegistry.register(p));
  assert.ok(!WorldLifecycleService.CATEGORIES.includes('external-abstract'));
  const classification = WorldLifecycleService.classifyWorld({ playerRegistry, teams: [team] }, '2026-09-01');
  team.roster.forEach((player) => {
    const entry = classification.byPlayerId.get(player.id);
    assert.strictEqual(entry.category, 'senior-service-roster');
    assert.strictEqual(entry.serviceClubId, team.clubId, 'el club de servicio es SIEMPRE el Club real, nunca team.id');
  });
});

// =========================================================================
// 15. Afiliado sin cobertura contractual nunca se presenta como libre
// =========================================================================
check('MarketService.resolveMarketAvailability: afiliado a un Squad sin contrato materializado -> "affiliated-contract-unknown", nunca "free"', () => {
  registerRoundRobinFormat();
  const world = buildWorld();
  const { teams } = registerLeagueInto(world, { leagueId: 'ws-market-league', teamCount: 1 });
  const [team] = teams;
  const positions = {
    Base: 15, Escolta: 5, Alero: 5, 'Ala-pívot': 5, Pívot: 5,
  };
  const affiliatedPlayer = new Player({
    id: 'ws-market-affiliated', nominalPosition: 'Base', teamId: team.id, positions,
  });
  const freePlayer = new Player({
    id: 'ws-market-free', nominalPosition: 'Base', teamId: null, positions,
  });
  const playerRegistry = new PlayerRegistry();
  playerRegistry.register(affiliatedPlayer);
  playerRegistry.register(freePlayer);
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const affiliatedAvailability = MarketService.resolveMarketAvailability({
    playerId: affiliatedPlayer.id, playerRegistry, contractRegistry, marketRegistry, date: '2026-09-01', teamRegistry: world.registries.teams,
  });
  assert.strictEqual(affiliatedAvailability.status, 'affiliated-contract-unknown');
  assert.strictEqual(affiliatedAvailability.clubId, team.clubId);
  const freeAvailability = MarketService.resolveMarketAvailability({
    playerId: freePlayer.id, playerRegistry, contractRegistry, marketRegistry, date: '2026-09-01', teamRegistry: world.registries.teams,
  });
  assert.strictEqual(freeAvailability.status, 'free');
});

// =========================================================================
// 16. Cohorte interactivo excluye Teams no playable
// =========================================================================
check('CompetitionSimulationService.interactiveCohortTeams() solo incluye equipos de Editions "playable"', () => {
  registerRoundRobinFormat();
  const world = buildWorld();
  const { definition: playableDef, teams: playableTeams } = registerLeagueInto(world, { leagueId: 'ws-cohort-playable', teamCount: 4 });
  const { definition: abstractDef, teams: abstractTeams } = registerLeagueInto(world, { leagueId: 'ws-cohort-abstract', teamCount: 4, orgId: 'org-ws-cohort-abstract' });
  world.setSimulationProfile(new WorldSimulationProfile({
    id: 'ws-cohort-profile', version: '1.0.0', defaultDetailLevel: 'abstract',
    assignments: [{ scopeType: 'competition', scopeId: playableDef.id, detailLevel: 'playable' }],
  }));
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-cohort-seed' });
  registerSnapshotsForTeams(service, abstractTeams, '2099-00');
  const engine = new CompetitionEngine({ world, simulationService: service });
  engine.registerEditionWithInitialEntries({
    competitionDefinitionId: playableDef.id, seasonKey: '2099-00', formatBindingId: ROUND_ROBIN_FORMAT_ID,
    participants: playableTeams.map((t) => ({ id: t.id })), detailLevel: service.resolveDetailLevelForCompetition(playableDef.id),
  });
  engine.registerEditionWithInitialEntries({
    competitionDefinitionId: abstractDef.id, seasonKey: '2099-00', formatBindingId: ROUND_ROBIN_FORMAT_ID,
    participants: abstractTeams.map((t) => ({ id: t.id })), detailLevel: service.resolveDetailLevelForCompetition(abstractDef.id),
  });
  const cohort = new Set(service.interactiveCohortTeams('2099-00'));
  playableTeams.forEach((t) => assert.ok(cohort.has(t.id)));
  abstractTeams.forEach((t) => assert.ok(!cohort.has(t.id)));
});

// =========================================================================
// 17. Módulos genéricos nuevos sin literales España/ACB/FEB/1ª/2ª
// =========================================================================
check('auditoría estática: los módulos genéricos nuevos de WORLD-SIM-1 no contienen literales de España', () => {
  const forbidden = /\bACB\b|\bFEB\b|España|España|'1ª'|'2ª'|MoraBanc|Andorra/i;
  const genericFiles = [
    'src/entities/WorldSimulation.js',
    'src/core/CompetitionSimulationService.js',
    'src/core/AbstractCompetitionStageRuntime.js',
  ];
  genericFiles.forEach((relative) => {
    const content = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    assert.ok(!forbidden.test(content), `${relative} no debe contener literales de España/ACB/FEB`);
  });
});

// =========================================================================
// 18. GameWorld.describe() — vista plana del profile + contadores por nivel
// =========================================================================
check('GameWorld.describe(): incluye el profile y contadores de Editions/Teams por nivel, serializable sin Map/funciones', () => {
  registerRoundRobinFormat();
  const world = buildWorld();
  const { definition, teams } = registerLeagueInto(world, { leagueId: 'ws-describe-league', teamCount: 4 });
  const profile = new WorldSimulationProfile({
    id: 'ws-describe-profile', version: '1.0.0', defaultDetailLevel: 'abstract',
    assignments: [{ scopeType: 'competition', scopeId: definition.id, detailLevel: 'playable' }],
  });
  world.setSimulationProfile(profile);
  const service = new CompetitionSimulationService({ world, careerSeed: 'ws-describe-seed' });
  const engine = new CompetitionEngine({ world, simulationService: service });
  engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: ROUND_ROBIN_FORMAT_ID,
    participants: teams.map((t) => ({ id: t.id })), detailLevel: 'playable',
  });
  const snapshot = world.describe();
  assert.strictEqual(snapshot.simulationProfile.id, 'ws-describe-profile');
  assert.strictEqual(snapshot.simulationLevelCounters.editionsByLevel.playable, 1);
  assert.strictEqual(snapshot.simulationLevelCounters.teamsByLevel.playable, 4);
  assert.strictEqual(JSON.stringify(snapshot), JSON.stringify(JSON.parse(JSON.stringify(snapshot))), 'debe ser JSON plano (invariante 27)');
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
