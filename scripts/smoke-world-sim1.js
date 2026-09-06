// scripts/smoke-world-sim1.js
// WORLD-SIM-1 (DESIGN.md 10.16) — smoke SINTÉTICO y corto (sección 18.2 del
// prompt): instala solo `world-core-2026.1` + un fixture ficticio propio de
// este script (nunca España/ACB/FEB), con CUATRO Editions pequeñas — una
// por nivel de detalle — compartiendo la MISMA cola cronológica. Objetivo:
// segundos, no minutos. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Checklist (sección 18.2):
//  1. Clubs/Teams/Squads normales + 4 Editions (playable/full/standard/abstract);
//  2. una única parada humana, para "playable";
//  3. "full" se resuelve automáticamente con resultado completo;
//  4. "standard" produce marcadores compactos y clasificación;
//  5. "abstract" produce un solo hito/receipt y cero partidos;
//  6. toda la cola termina en orden y queda íntegra;
//  7. PATHWAYS consume un resultado de fase abstracta;
//  8. Player afiliado abstracto (sección 15 del prompt);
//  9. determinismo con orden de registro invertido (solo la parte
//     determinista, no el smoke entero).

const assert = require('assert');

const { CompetitionDefinition } = require('../src/entities/Competition.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const {
  WorldSimulationProfile, hasIndividualMatchDetail,
} = require('../src/entities/WorldSimulation.js');
const { CompetitionPathwayRule, CompetitionPathwayDefinition } = require('../src/entities/CompetitionPathway.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WORLD_CORE_MANIFEST, WORLD_CORE_AREA_IDS } = require('../data/world/world-core-2026.1.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const PathwayCatalog = require('../src/core/CompetitionPathwayCatalog.js');
const { CompetitionEngine, buildEditionId, buildStageId } = require('../src/core/CompetitionEngine.js');
const { CompetitionSimulationService } = require('../src/core/CompetitionSimulationService.js');
const { CompetitionPathwayService } = require('../src/core/CompetitionPathwayService.js');
const { WorldCalendar } = require('../src/core/WorldCalendar.js');
const {
  WorldCalendarCoordinator, WORLD_CALENDAR_STOP_TYPES, createCompetitionMatchSource, createCompetitionSimulationSource,
} = require('../src/core/WorldCalendarCoordinator.js');
const { WorldLifecycleService } = require('../src/core/WorldLifecycleService.js');
const { MarketService } = require('../src/core/MarketService.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { generateFictionalTeams } = require('../src/utils/teamGenerator.js');

const startedAt = Date.now();
console.log('=== SMOKE WORLD-SIM-1 (fixture sintético, 4 Editions — un nivel de detalle cada una) ===\n');

const AREA_ID = 'ws-smoke-area-country';
const ROUND_ROBIN_FORMAT_ID = 'test-fixture:world-sim1-smoke:format:round-robin-v1';
if (!FormatCatalog.hasFormat(ROUND_ROBIN_FORMAT_ID)) {
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

// -----------------------------------------------------------------------
// 1. Mundo + una liga por nivel de detalle (4 equipos cada una).
// -----------------------------------------------------------------------
const LEAGUE_IDS = {
  playable: 'ws-smoke-league-playable',
  full: 'ws-smoke-league-full',
  standard: 'ws-smoke-league-standard',
  abstract: 'ws-smoke-league-abstract',
};
const HOF_COMPETITION_ID = 'ws-smoke-hall-of-fame';

const simulationProfile = new WorldSimulationProfile({
  id: 'ws-smoke-profile',
  version: '1.0.0',
  defaultDetailLevel: 'abstract',
  assignments: Object.entries(LEAGUE_IDS).map(([level, id]) => ({ scopeType: 'competition', scopeId: id, detailLevel: level })),
  provenance: { status: 'design', notes: 'Perfil sintético de smoke — nunca dato real.' },
});

const world = WorldFactory.buildCareerWorld({
  id: 'world:smoke-world-sim1',
  name: 'Mundo de smoke WORLD-SIM-1',
  careerSeed: 'smoke-world-sim1-seed',
  packs: [WORLD_CORE_MANIFEST],
  simulationProfile,
});

const { GeographicArea } = require('../src/entities/Geography.js');
world.registries.registerArea(new GeographicArea({
  id: AREA_ID, type: 'country', parentAreaId: WORLD_CORE_AREA_IDS.EUROPE, name: '[TEST] Smokeland', isoCode: 'XX',
}));

function registerLeague(leagueId, teamCount) {
  const orgId = `org-${leagueId}`;
  world.registries.registerOrganization(new Organization({
    id: orgId, name: `[TEST] Federación ${leagueId}`, type: 'national-federation', headquartersAreaId: AREA_ID, scopeAreaId: AREA_ID,
  }));
  const definition = new CompetitionDefinition({
    id: leagueId, name: `[TEST] Liga ${leagueId}`, scopeLevel: 'national', scopeAreaId: AREA_ID,
    organizerId: orgId, participantType: 'club-team', kind: 'league', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(definition);
  const teams = generateFictionalTeams(teamCount, { seed: `${leagueId}-teams` });
  teams.forEach((team) => {
    const club = new Club({
      id: `ws-smoke-club-${team.id}`, name: team.name, homeAreaId: AREA_ID, employerJurisdictionAreaId: AREA_ID, primaryTeamId: team.id, dataSource: 'test-fixture',
    });
    world.registries.registerClub(club);
    team.clubId = club.id;
    team.club = club;
    world.registries.registerTeam(team);
    const squad = new Squad({ id: `ws-smoke-squad-${team.id}`, teamId: team.id, players: team.roster, dataSource: 'test-fixture' });
    world.registries.registerSquad(squad);
    team.squad = squad;
    team.primarySquadId = squad.id;
  });
  return { definition, teams };
}

const leagues = {};
Object.entries(LEAGUE_IDS).forEach(([level, leagueId]) => { leagues[level] = registerLeague(leagueId, 4); });
console.log(`OK  1 GameWorld + world-core-2026.1 instalado + 4 ligas ficticias (4 equipos cada una): ${Object.values(LEAGUE_IDS).join(', ')}`);

// Competición destino del pathway (2 equipos, alimentada por el top-2 de la
// liga "abstract") — también resuelta en abstracto.
world.registries.registerCompetitionDefinition(new CompetitionDefinition({
  id: HOF_COMPETITION_ID, name: '[TEST] Torneo de honor', scopeLevel: 'national', scopeAreaId: AREA_ID,
  organizerId: `org-${LEAGUE_IDS.abstract}`, participantType: 'club-team', kind: 'championship', implementationStatus: 'active-runtime', bindings: {},
}));

const USER_TEAM_ID = leagues.playable.teams[0].id;

// -----------------------------------------------------------------------
// 2. Servicio de simulación + snapshots (solo standard/abstract/HOF).
// -----------------------------------------------------------------------
const simulationService = new CompetitionSimulationService({ world, careerSeed: 'smoke-world-sim1-seed' });
[...leagues.standard.teams, ...leagues.abstract.teams].forEach((team, index) => {
  simulationService.registerSnapshot({
    teamId: team.id,
    seasonKey: '2099-00',
    effectiveDetailLevel: 'standard',
    rosterCoverage: 'aggregate',
    materializedPlayerIds: [],
    estimatedRosterSize: 12,
    strength: { overall: 45 + index * 8, offense: 45 + index * 8, defense: 45 + index * 8 },
    strengthSource: 'smoke-fixture-explicit',
    generatedAtGameDate: '2026-09-01',
    provenance: { status: 'design', notes: 'Fixture de smoke — nunca dato real.' },
  });
});

// -----------------------------------------------------------------------
// 3. Motor + calendario de fechas: cada liga tiene su propia franja
//    horaria (para demostrar que la cola mundial las intercala por FECHA,
//    no por competición) — el hito "abstract"/torneo de honor resuelve
//    DESPUÉS de que las ligas por partido hayan terminado.
// -----------------------------------------------------------------------
const engine = new CompetitionEngine({ world, simulationService });
const OFFSET_DAYS_BY_LEAGUE = {
  [LEAGUE_IDS.playable]: 0, [LEAGUE_IDS.full]: 1, [LEAGUE_IDS.standard]: 2,
};
function isoDateAtDayOffset(dayOffset) {
  const date = new Date(Date.UTC(2026, 8, 1 + dayOffset, 18, 0, 0));
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
engine.setDateResolverProvider(({ edition }) => {
  if (edition.detailLevel === 'abstract') {
    return () => ({ scheduledAt: isoDateAtDayOffset(30), timeZoneId: 'UTC' });
  }
  const offsetDays = OFFSET_DAYS_BY_LEAGUE[edition.competitionDefinitionId] || 0;
  return (meta) => ({ scheduledAt: isoDateAtDayOffset(offsetDays + (meta.round - 1) * 3), timeZoneId: 'UTC' });
});

const editionByLevel = {};
Object.entries(leagues).forEach(([level, { definition, teams }]) => {
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id,
    seasonKey: '2099-00',
    formatBindingId: ROUND_ROBIN_FORMAT_ID,
    participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })),
    detailLevel: level,
  });
  editionByLevel[level] = edition;
  engine.initializeEdition(edition.id);
});
console.log('OK  4 Editions inicializadas — cada una congela EXACTAMENTE el detailLevel de su assignment (nunca "playable" por defecto)');
assert.strictEqual(engine.listAllPendingMatches().every((d) => d.competitionDefinitionId !== LEAGUE_IDS.abstract), true, 'invariante 9: "abstract" nunca aparece como partido individual');

// -----------------------------------------------------------------------
// 4. PATHWAYS-1 consumiendo un resultado "abstract": top-2 de la liga
//    abstracta clasifica al Torneo de honor (también resuelto en abstracto).
// -----------------------------------------------------------------------
const PATHWAY_ID = 'ws-smoke-pathway';
PathwayCatalog.registerPathwayDefinition(new CompetitionPathwayDefinition({
  id: PATHWAY_ID,
  version: '1.0.0',
  participantType: 'club-team',
  rules: [new CompetitionPathwayRule({
    id: 'abstract-top2-to-hof',
    kind: 'competition-qualification',
    trigger: { type: 'stage-completed', stageRef: { competitionDefinitionId: LEAGUE_IDS.abstract, stageKey: 'regular-season' } },
    selector: { type: 'standings-range', stageRef: { competitionDefinitionId: LEAGUE_IDS.abstract, stageKey: 'regular-season' }, fromRank: 1, toRank: 2 },
    destination: { type: 'competition-edition', competitionDefinitionId: HOF_COMPETITION_ID, seasonRelation: 'same-season' },
    seedPolicy: 'source-rank',
    outcomeCode: 'hall-of-fame-qualified',
  })],
}));
// `pathwayBindingIds` es un array plano leído en el MOMENTO del hecho
// (nunca cacheado antes) — añadirlo aquí, después de crear la Edition, es
// equivalente a haberlo declarado en `registerEditionWithInitialEntries()`.
editionByLevel.abstract.pathwayBindingIds.push(PATHWAY_ID);
const pathwayService = new CompetitionPathwayService({
  world,
  competitionEngine: engine,
  now: () => ({ instant: isoDateAtDayOffset(30), timeZoneId: 'UTC' }),
  resolveEditionBindings: (competitionDefinitionId) => {
    assert.strictEqual(competitionDefinitionId, HOF_COMPETITION_ID);
    return {
      formatBindingId: ROUND_ROBIN_FORMAT_ID, scheduleProfileId: null, rulesetBundleId: null, pathwayBindingIds: [], detailLevel: 'abstract',
    };
  },
});
engine.setFactHandler((fact) => pathwayService.handleEngineFact(fact));

// -----------------------------------------------------------------------
// 5. Cola mundial: "competition-match" + "competition-simulation" —
//    ningún equipo controlado fuera de la liga "playable".
// -----------------------------------------------------------------------
const calendar = new WorldCalendar({ id: 'calendar:smoke-world-sim1', defaultTimeZoneId: 'UTC', initialInstant: isoDateAtDayOffset(-1) });
calendar.registerSeason({ seasonKey: '2099-00', startInstant: isoDateAtDayOffset(-1), timeZoneId: 'UTC', scheduleIds: [] });
const coordinator = new WorldCalendarCoordinator({
  calendar,
  sources: [
    createCompetitionMatchSource({
      engine, timeZoneId: 'UTC', resolveMatch: ({ stageId, matchId }) => engine.resolveMatch(stageId, matchId, {}),
    }),
    createCompetitionSimulationSource({
      engine,
      timeZoneId: 'UTC',
      resolveMilestone: ({ stageId, milestoneId }) => engine.resolveAbstractMilestone(stageId, milestoneId, {
        now: { instant: isoDateAtDayOffset(30), timeZoneId: 'UTC' },
      }),
    }),
  ],
  controlledTeamIds: [USER_TEAM_ID],
});

let userStops = 0;
let iterations = 0;
for (;;) {
  iterations += 1;
  assert.ok(iterations < 1000, 'la cola no progresa — posible bucle infinito');
  const stop = coordinator.advanceUntilNextUserStop();
  if (stop.type === WORLD_CALENDAR_STOP_TYPES.SEASON_COMPLETE) break;
  assert.strictEqual(stop.type, WORLD_CALENDAR_STOP_TYPES.USER_MATCH, `parada inesperada: ${stop.type} (${JSON.stringify(stop.items)})`);
  userStops += 1;
  engine.resolveMatch(stop.item.metadata.stageId, stop.item.metadata.matchId, {});
  coordinator.completeUserItem(stop.item.id);
  coordinator.resolveSimultaneousAfterUserCommit(stop.item.orderingInstant);
}
assert.strictEqual(userStops, 3, 'la liga "playable" tiene 4 equipos a una vuelta -> 3 jornadas, TODAS paradas del usuario (única con control humano)');
console.log(`OK  "Continuar" resolvió toda la cola con ${userStops} paradas del usuario (todas de la liga "playable"), sin bloqueos ni conflictos`);

// -----------------------------------------------------------------------
// 6. Integridad de la cola y honestidad por nivel.
// -----------------------------------------------------------------------
assert.strictEqual(coordinator.sync(), 0, 'no debe quedar ningún item pendiente tras "Continuar" hasta el final');

function stageIdFor(level) { return buildStageId(LEAGUE_IDS[level], '2099-00', 'regular-season'); }

const fullRunner = engine.getRunner(stageIdFor('full'));
assert.strictEqual(fullRunner.isComplete, true);
fullRunner.matches.forEach((m) => assert.strictEqual(hasIndividualMatchDetail(m.result), true, '"full" sigue usando el MatchEngine real'));
console.log('OK  "full" se resolvió ENTERAMENTE automático (nunca fue parada) con resultado COMPLETO (hasIndividualMatchDetail = true)');

const standardRunner = engine.getRunner(stageIdFor('standard'));
assert.strictEqual(standardRunner.isComplete, true);
standardRunner.matches.forEach((m) => {
  assert.strictEqual(hasIndividualMatchDetail(m.result), false, '"standard" nunca fabrica detalle individual');
  assert.strictEqual(m.result.quarterScores, null);
  assert.notStrictEqual(m.result.finalScore.home, m.result.finalScore.away, '"standard" nunca deja empate');
});
console.log('OK  "standard" produjo marcadores COMPACTOS deterministas (sin empates, sin quarterScores) y clasificación real');

const abstractReceipts = world.registries.competitionSimulationReceipts.forEdition(editionByLevel.abstract.id);
assert.strictEqual(abstractReceipts.length, 1, '"abstract" deja EXACTAMENTE un receipt para su fase');
assert.strictEqual(abstractReceipts[0].result.type, 'standings');
assert.strictEqual(engine.getRunner(stageIdFor('abstract')).getPendingMatches().length, 0);
console.log('OK  "abstract" resolvió la liga en UN solo hito/receipt — cero descriptors de partido individuales');

const hofEdition = world.registries.competitionEditions.get(buildEditionId(HOF_COMPETITION_ID, '2099-00'));
assert.ok(hofEdition, 'PATHWAYS debe haber activado la Edition del Torneo de honor desde el top-2 abstracto');
assert.strictEqual(hofEdition.detailLevel, 'abstract', 'el destino resuelve su PROPIO nivel — nunca copiado de la Edition fuente');
const hofReceipts = world.registries.competitionSimulationReceipts.forEdition(hofEdition.id);
assert.strictEqual(hofReceipts.length, 1, 'el Torneo de honor (2 equipos, 1 ronda) también resuelve en un único hito');
console.log('OK  PATHWAYS-1 consumió el resultado de la fase abstracta (top-2) y activó una Edition nueva, con su PROPIO nivel de detalle');

const finalIntegrityErrors = world.registries.validateIntegrity();
assert.deepStrictEqual(finalIntegrityErrors, []);
console.log('OK  integridad World/Competition/Calendar íntegra al final del smoke');

// -----------------------------------------------------------------------
// 7. Player afiliado a un Team "abstract" — nunca agente libre, nunca
//    "external-abstract" (sección 15/BUG-WORLDSIM-05/04 del prompt).
// -----------------------------------------------------------------------
const abstractTeam = leagues.abstract.teams[0];
const affiliatedPlayer = abstractTeam.roster[0];
const smokePlayerRegistry = new PlayerRegistry();
smokePlayerRegistry.register(affiliatedPlayer);
const availability = MarketService.resolveMarketAvailability({
  playerId: affiliatedPlayer.id,
  playerRegistry: smokePlayerRegistry,
  contractRegistry: new ContractRegistry(),
  marketRegistry: new MarketRegistry(),
  date: '2026-09-01',
  teamRegistry: world.registries.teams,
});
assert.strictEqual(availability.status, 'affiliated-contract-unknown');
assert.strictEqual(availability.clubId, abstractTeam.clubId);
const classification = WorldLifecycleService.classifyWorld({ playerRegistry: smokePlayerRegistry, teams: [abstractTeam] }, '2026-09-01');
assert.strictEqual(classification.byPlayerId.get(affiliatedPlayer.id).category, 'senior-service-roster');
assert.ok(!WorldLifecycleService.CATEGORIES.includes('external-abstract'));
console.log('OK  jugador afiliado a un Team "abstract": Club/Team/Squad normales, "affiliated-contract-unknown" (nunca libre), "senior-service-roster" (nunca "external-abstract")');

// -----------------------------------------------------------------------
// 8. Determinismo: orden de registro invertido no cambia el resultado
//    (solo la parte determinista — nunca el smoke completo repetido).
// -----------------------------------------------------------------------
const { AbstractCompetitionStageRuntime } = require('../src/core/AbstractCompetitionStageRuntime.js');
const { CompetitionSimulationReceipt } = require('../src/entities/WorldSimulation.js');
const strengthByParticipantId = { 'smoke-p1': 40, 'smoke-p2': 55, 'smoke-p3': 70, 'smoke-p4': 85 };
const baseEntries = Object.keys(strengthByParticipantId).map((participantId, i) => ({ participantId, seed: i + 1 }));
function resolveStandingsWithEntries(entries) {
  let receipt = null;
  const runtime = new AbstractCompetitionStageRuntime({
    stageId: 'stage:ws-smoke-determinism',
    competitionDefinitionId: 'ws-smoke-determinism-def',
    competitionEditionId: 'edition:ws-smoke-determinism',
    stageKey: 'regular-season',
    entries,
    runnerType: 'round-robin',
    dateResolver: () => ({ scheduledAt: isoDateAtDayOffset(30), timeZoneId: 'UTC' }),
    resolveStrength: (participantId) => ({ overall: strengthByParticipantId[participantId], offense: strengthByParticipantId[participantId], defense: strengthByParticipantId[participantId] }),
    careerSeed: 'smoke-world-sim1-seed',
    registerReceipt: (data) => { receipt = new CompetitionSimulationReceipt(data); return receipt; },
  });
  runtime.resolveMilestone(runtime.getPendingMilestones()[0].id, {});
  return receipt.result.standings;
}
const standingsForward = resolveStandingsWithEntries(baseEntries);
const standingsReversed = resolveStandingsWithEntries([...baseEntries].reverse());
assert.deepStrictEqual(standingsForward, standingsReversed, 'invertir el orden de registro de las entries no cambia la clasificación agregada');
console.log('OK  determinismo verificado con orden de registro invertido: misma clasificación agregada (invariante 10)');

console.log(`\nSMOKE TEST WORLD-SIM-1: OK (4 Editions ficticias, 4 niveles de detalle, 1 transición de pathway abstracta, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
