// scripts/test-save-load1.js
// SAVE-LOAD-1 — batería DIRIGIDA (10-12 bloques, sección 10 del prompt):
// round-trip canónico completo de una carrera de prueba (mundo FICTICIO,
// nunca español) a través de `CareerPersistenceBoundary.project()` →
// `CareerHydrationService.hydrate()` → `project()` otra vez. Convención
// del proyecto: identificadores en inglés, comentarios en español.

const assert = require('assert');

const {
  CompetitionDefinition, CompetitionEdition, CompetitionStage, CompetitionEntry,
} = require('../src/entities/Competition.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const { Contract } = require('../src/entities/Contract.js');
const { FederationLicense, CompetitionRegistration } = require('../src/entities/Registration.js');
const { Agent, RepresentationMandate } = require('../src/entities/Agent.js');
const { NegotiationThread, ContractOffer } = require('../src/entities/Market.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const { CompetitionEngine } = require('../src/core/CompetitionEngine.js');
const { CompetitionSimulationService } = require('../src/core/CompetitionSimulationService.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const { AnnualCycleRegistry } = require('../src/core/AnnualCycleRegistry.js');
const { AcademyRegistry } = require('../src/core/AcademyRegistry.js');
const { NationalTeamRegistry } = require('../src/core/NationalTeamRegistry.js');
const { WorldCalendar } = require('../src/core/WorldCalendar.js');
const { CareerPersistenceBoundary } = require('../src/core/CareerPersistenceBoundary.js');
const { CareerHydrationService } = require('../src/core/CareerHydrationService.js');
const { generateFictionalTeams } = require('../src/utils/teamGenerator.js');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`OK  ${label}`);
}

console.log('=== TEST SAVE-LOAD-1 ===\n');

// ---------------------------------------------------------------------
// Fixture: mundo FICTICIO de prueba (nunca español) — 4 equipos, Liga
// regular round-robin + playoff bracket (mismo formato de prueba que
// `scripts/test-comp-core1.js`, reutilizado sin literales de país nuevos).
// ---------------------------------------------------------------------
const TEST_PACK_ID = 'test-fixture:save-load1';
const TEST_MANIFEST = {
  id: TEST_PACK_ID,
  version: '1.0.0',
  name: '[TEST] SAVE-LOAD-1 fixture pack',
  dependencies: [],
  provides: { competitionDefinitions: ['sl1-fixture-league'] },
  dataSource: TEST_PACK_ID,
  provenance: { dataSource: TEST_PACK_ID, status: 'fictional-test' },
  install: () => { throw new Error('El fixture de SAVE-LOAD-1 nunca debe llamar a install() durante la hidratación.'); },
};

const FIXTURE_FORMAT_ID = 'test-fixture:save-load1:format-v1';
function registerFixtureFormat() {
  if (FormatCatalog.hasFormat(FIXTURE_FORMAT_ID)) return;
  FormatCatalog.registerFormat({
    id: FIXTURE_FORMAT_ID,
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
        runnerConfig: {
          legs: 1,
          pointsWin: 2,
          pointsLoss: 1,
          tiebreakSteps: [
            { type: 'overall-point-diff' },
            { type: 'overall-points-for' },
          ],
        },
      },
      {
        key: 'playoff',
        stageType: 'knockout',
        runnerType: 'bracket',
        sequence: 2,
        activation: { type: 'stage-completed', sourceStageKey: 'regular-season' },
        entrySource: {
          type: 'stage-standings-range', sourceStageKey: 'regular-season', fromRank: 1, toRank: 4, sourceScope: 'same-edition',
        },
        runnerConfig: { firstRoundPairing: [[1, 4], [2, 3]], roundPatterns: ['single-game', 'single-game'] },
        completesEdition: true,
      },
    ],
  });
}

function buildTestCareer() {
  registerFixtureFormat();
  const world = new GameWorld({ id: 'world:sl1-test', careerSeed: 'sl1-test-seed', createdAtGameDate: '2026-09-01' });
  world.registries.registerArea(new GeographicArea({ id: 'area-world', type: 'world', parentAreaId: null, name: 'Mundo' }));
  world.registries.registerArea(new GeographicArea({
    id: 'area-country-sl1', type: 'country', parentAreaId: 'area-world', name: 'SL1-Land', isoCode: 'ZZ',
  }));
  world.registries.registerOrganization(new Organization({
    id: 'org-sl1', name: '[TEST] SL1 Federation', type: 'national-federation',
    headquartersAreaId: 'area-country-sl1', scopeAreaId: 'area-country-sl1',
  }));
  const definition = new CompetitionDefinition({
    id: 'sl1-fixture-league', name: '[TEST] SL1 League', scopeLevel: 'national', scopeAreaId: 'area-country-sl1',
    organizerId: 'org-sl1', participantType: 'club-team', kind: 'league', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(definition);

  const playerRegistry = new PlayerRegistry();
  const teams = generateFictionalTeams(4, { seed: 'sl1-teams' });
  teams.forEach((team) => {
    const club = new Club({
      id: `club-${team.id}`, name: team.name, homeAreaId: 'area-country-sl1', employerJurisdictionAreaId: 'area-country-sl1',
      primaryTeamId: team.id, dataSource: TEST_PACK_ID, foundationYear: 1950, budget: 1000000,
    });
    world.registries.registerClub(club);
    team.clubId = club.id;
    team.club = club;
    playerRegistry.registerMany(team.roster);
    const roster = team.roster;
    team._legacyRoster = [];
    world.registries.registerTeam(team);
    const squad = new Squad({
      id: `squad-${team.id}`, teamId: team.id, players: roster, dataSource: TEST_PACK_ID,
    });
    world.registries.registerSquad(squad);
    team.squad = squad;
    team.primarySquadId = squad.id;
  });

  const seasonKey = '2026-27';
  const edition = new CompetitionEdition({
    id: 'edition:sl1-fixture-league:2026-27', competitionDefinitionId: definition.id, seasonKey,
    startDate: '2026-09-01', status: 'active', formatBindingId: FIXTURE_FORMAT_ID, detailLevel: 'playable',
  });
  world.registries.registerCompetitionEdition(edition);
  const regularStage = new CompetitionStage({
    id: 'stage:sl1-fixture-league:2026-27:regular-season', editionId: edition.id, stageType: 'round-robin',
    status: 'active', stageKey: 'regular-season', sequence: 1,
  });
  world.registries.registerCompetitionStage(regularStage);
  teams.forEach((team, i) => {
    world.registries.registerCompetitionEntry(new CompetitionEntry({
      id: `entry:sl1-fixture-league:2026-27:regular-season:${team.id}`, editionId: edition.id, stageId: regularStage.id,
      participantType: 'club-team', participantId: team.id, seed: i + 1,
    }));
  });

  world.registries.packs.registerManifest(TEST_MANIFEST);
  world.registries.packs.markInstalled(TEST_MANIFEST, '2026-09-01');

  const calendar = new WorldCalendar({ id: 'calendar:sl1-test', defaultTimeZoneId: 'UTC', initialInstant: '2026-09-01T00:00:00.000Z' });
  calendar.registerSeason({ seasonKey, startInstant: '2026-09-01T00:00:00.000Z', timeZoneId: 'UTC', scheduleIds: [] });
  calendar.advanceTo('2026-10-15T00:00:00.000Z');
  world.setCalendar(calendar);

  const simulationService = new CompetitionSimulationService({ world, careerSeed: world.careerSeed });
  const competitionEngine = new CompetitionEngine({ world, simulationService });
  competitionEngine.initializeEdition(edition.id);

  // Contratos + inscripciones mínimas para dos jugadores (round-trip real,
  // no toda la vertical de negocio de CONTRACT-1/REG-1, ya cubierta por
  // sus propias baterías).
  const contractRegistry = new ContractRegistry();
  const registrationRegistry = new RegistrationRegistry();
  const captainA = teams[0].roster[0];
  const captainB = teams[1].roster[0];
  [[captainA, teams[0]], [captainB, teams[1]]].forEach(([player, team]) => {
    const contract = new Contract({
      id: `contract:${player.id}`, playerId: player.id, clubId: team.clubId,
      signedDate: '2026-07-01', startDate: '2026-07-01', endDate: '2028-06-30',
      coveredSeasonKeys: ['2026-27', '2027-28'],
      compensation: {
        seasons: [
          { seasonKey: '2026-27', guaranteedBaseSalaryMinor: 5000000 },
          { seasonKey: '2027-28', guaranteedBaseSalaryMinor: 5500000 },
        ],
      },
    });
    contractRegistry.register(contract);
    const license = new FederationLicense({
      id: `license:${player.id}`, playerId: player.id, clubId: team.clubId, federationId: 'org-sl1', seasonKey,
      validity: { startDate: '2026-09-01', endDate: '2027-06-30' },
    });
    registrationRegistry.registerLicense(license);
    registrationRegistry.registerRegistration(new CompetitionRegistration({
      id: `registration:${player.id}`, playerId: player.id, licenseId: license.id, teamId: team.id,
      competitionId: definition.id, registrationScopeId: definition.id, seasonKey, accessCategory: 'senior', contractId: contract.id,
    }));
  });

  // Agente + mandato, y un hilo de negociación con una oferta viva —
  // ejercita MarketRegistry/AgentRegistry sin resolver el fichaje (fuera
  // de alcance de esta Epic).
  const agentRegistry = new AgentRegistry();
  const marketRegistry = new MarketRegistry();
  const freeAgent = teams[2].roster[1];
  const agent = new Agent({ id: 'agent:sl1-1', displayName: '[TEST] Agente SL1', licenseStatus: 'domestic-only' });
  agentRegistry.registerAgent(agent);
  agentRegistry.registerMandate(new RepresentationMandate({
    id: 'mandate:sl1-1', agentId: agent.id, clientType: 'player', clientId: freeAgent.id, startDate: '2026-08-01',
    feePayerClientId: freeAgent.id, commissionBasisPoints: 500,
  }));
  const thread = new NegotiationThread({
    id: 'thread:sl1-1', playerId: freeAgent.id, actingClubId: teams[3].clubId, openedAt: '2026-09-05',
  });
  marketRegistry.registerThread(thread);
  const offer = new ContractOffer({
    id: 'offer:sl1-1', threadId: thread.id, version: 1, offeredBy: 'club', createdAt: '2026-09-06', expiresAt: '2026-09-20',
    playerId: freeAgent.id, clubId: teams[3].clubId,
    contractDraft: {
      startDate: '2026-09-15', endDate: '2027-06-30', compensation: { seasons: [{ seasonKey, guaranteedBaseSalaryMinor: 2000000 }] },
    },
  });
  marketRegistry.registerOffer(offer);
  thread.addOfferId(offer.id);

  const transferRegistry = new TransferRegistry();
  const loanRegistry = new LoanRegistry();
  const annualCycleRegistry = new AnnualCycleRegistry();
  const academyRegistry = new AcademyRegistry();
  const nationalTeamRegistry = new NationalTeamRegistry();

  world.attachDomainRegistries({
    playerRegistry, contractRegistry, registrationRegistry, agentRegistry, marketRegistry,
    transferRegistry, loanRegistry, annualCycleRegistry, academyRegistry, nationalTeamRegistry,
  });

  return {
    world, calendar, competitionEngine, simulationService, teams, edition, regularStage,
    registries: {
      playerRegistry, contractRegistry, registrationRegistry, agentRegistry, marketRegistry,
      transferRegistry, loanRegistry, annualCycleRegistry, academyRegistry, nationalTeamRegistry,
    },
  };
}

function playSomeRegularSeasonMatches(career, count) {
  const runner = career.competitionEngine.getRunner(career.regularStage.id);
  for (let i = 0; i < count; i += 1) {
    const pending = runner.getPendingMatches();
    if (!pending.length) break;
    career.competitionEngine.resolveMatch(career.regularStage.id, pending[0].id, {});
  }
}

function buildRuntime(career, uiState) {
  return {
    careerSetupSnapshot: null,
    world: career.world,
    calendar: career.calendar,
    registries: career.registries,
    installedContentPacks: [TEST_MANIFEST],
    competitionEngine: career.competitionEngine,
    uiState: uiState || { newsLog: [], medicalAgendaLog: [], marketAgendaLog: [], lineup: null, negotiationSequences: {} },
    activeMatchInProgress: false,
  };
}

function noopDateResolverProvider() { return () => null; }

function wrapAsCareerSave(innerEnvelope, { slotId, revision, metadata }) {
  const withoutFingerprint = {
    format: 'basket-manager-career-save',
    schemaVersion: 1,
    slotId,
    revision,
    savedAtUtc: '2026-10-15T12:00:00.000Z',
    metadata,
    contentPacks: innerEnvelope.world.installedContentPacks.map((p) => ({ id: p.id, version: p.version })),
    payload: innerEnvelope,
  };
  const fingerprint = CareerPersistenceBoundary.computeFingerprint(withoutFingerprint);
  return { ...withoutFingerprint, fingerprint };
}

function hydrateFrom(outerEnvelope) {
  return CareerHydrationService.hydrate(outerEnvelope, {
    availableContentPacks: [TEST_MANIFEST],
    buildDateResolverProvider: noopDateResolverProvider,
  });
}

function runtimeFromHydrated(hydrated) {
  return {
    careerSetupSnapshot: hydrated.careerSetupSnapshot,
    world: hydrated.world,
    calendar: hydrated.calendar,
    registries: {
      playerRegistry: hydrated.playerRegistry,
      contractRegistry: hydrated.contractRegistry,
      registrationRegistry: hydrated.registrationRegistry,
      agentRegistry: hydrated.agentRegistry,
      marketRegistry: hydrated.marketRegistry,
      transferRegistry: hydrated.transferRegistry,
      loanRegistry: hydrated.loanRegistry,
      annualCycleRegistry: hydrated.annualCycleRegistry,
      academyRegistry: hydrated.academyRegistry,
      nationalTeamRegistry: hydrated.nationalTeamRegistry,
    },
    installedContentPacks: hydrated.installedContentPackManifests,
    competitionEngine: hydrated.competitionEngine,
    uiState: hydrated.uiState,
    activeMatchInProgress: false,
  };
}

const career = buildTestCareer();
playSomeRegularSeasonMatches(career, 3); // liga de 4 equipos a una vuelta = 6 partidos totales; deja algunos pendientes.
const snapshotAtGameDate = '2026-10-15';

// ===========================================================================
// 1. Proyección completa de colecciones durables (no solo contadores).
// ===========================================================================
const envelopeA = CareerPersistenceBoundary.project(buildRuntime(career), { snapshotAtGameDate });
check('1. project() proyecta teams/competitionRuntime/uiState (colecciones nuevas de SAVE-LOAD-1)', () => {
  assert.ok(Array.isArray(envelopeA.collections.teams) && envelopeA.collections.teams.length === 4);
  assert.ok(envelopeA.collections.teams[0].tacticalProfile, 'un Team persistido debe llevar su perfil táctico');
  assert.ok(envelopeA.world.registries.squads.every((s) => Array.isArray(s.playerIds) && s.playerIds.length > 0));
  assert.ok(Array.isArray(envelopeA.collections.competitionRuntime) && envelopeA.collections.competitionRuntime.length === 1);
  assert.strictEqual(envelopeA.collections.competitionRuntime[0].playedMatches.length, 3);
  assert.ok(envelopeA.collections.contracts.length === 2 && envelopeA.collections.contracts[0].compensation, 'los contratos deben llevar remuneración completa, no solo fechas');
});

// ===========================================================================
// 2. Round-trip canónico y fingerprint estable.
// ===========================================================================
const outerSave = wrapAsCareerSave(envelopeA, {
  slotId: 'manual-1', revision: 1, metadata: { userTeamId: career.teams[0].id, userClubId: career.teams[0].clubId, seasonKey: '2026-27' },
});
const hydrated = hydrateFrom(outerSave);
const envelopeB = CareerPersistenceBoundary.project(runtimeFromHydrated(hydrated), { snapshotAtGameDate });
check('2. proyectar(A) -> hidratar -> proyectar(B) produce el MISMO fingerprint canónico', () => {
  assert.strictEqual(envelopeB.fingerprint, envelopeA.fingerprint);
  assert.strictEqual(
    CareerPersistenceBoundary.canonicalStringify(envelopeA),
    CareerPersistenceBoundary.canonicalStringify(envelopeB),
  );
});

// ===========================================================================
// 3. Identidad exacta de jugadores entre registry, roster y squad.
// ===========================================================================
check('3. identidad de Player compartida entre PlayerRegistry, Team.roster y Squad tras hidratar', () => {
  const team = hydrated.world.registries.teams.get(career.teams[0].id);
  const squad = hydrated.world.registries.squads.get(team.primarySquadId);
  assert.strictEqual(team.squad, squad, 'Team.squad debe ser la MISMA instancia que el Squad registrado');
  team.roster.forEach((player) => {
    assert.strictEqual(hydrated.playerRegistry.get(player.id), player, `jugador "${player.id}" debe ser la MISMA instancia en el registry mundial`);
  });
  assert.strictEqual(team.roster.length, squad.players.length);
});

// ===========================================================================
// 4. Igualdad del cursor y datos del calendario.
// ===========================================================================
check('4. calendario: cursor/temporadas/pendientes restaurados exactamente', () => {
  assert.strictEqual(hydrated.calendar.currentInstant, career.calendar.currentInstant);
  assert.strictEqual(hydrated.calendar.currentSeasonKey, career.calendar.currentSeasonKey);
  assert.strictEqual(hydrated.world.calendar, hydrated.calendar, 'invariante state.calendar === state.world.calendar');
});

// ===========================================================================
// 5. Igualdad de partidos, resultados y standings.
// ===========================================================================
check('5. partidos jugados, resultados y standings idénticos tras hidratar', () => {
  const originalRunner = career.competitionEngine.getRunner(career.regularStage.id);
  const hydratedRunner = hydrated.competitionEngine.getRunner(career.regularStage.id);
  assert.strictEqual(hydratedRunner.currentRoundPointer, originalRunner.currentRoundPointer);
  assert.deepStrictEqual(hydratedRunner.getStandings(), originalRunner.getStandings());
  const originalPlayed = originalRunner.listPlayedMatchesInReplayOrder();
  const hydratedPlayed = hydratedRunner.listPlayedMatchesInReplayOrder();
  assert.strictEqual(hydratedPlayed.length, originalPlayed.length);
  originalPlayed.forEach((m, i) => {
    assert.strictEqual(hydratedPlayed[i].id, m.id);
    assert.deepStrictEqual(hydratedPlayed[i].result.finalScore, m.result.finalScore);
  });
  assert.strictEqual(hydratedRunner.getPendingMatches().length, originalRunner.getPendingMatches().length);
});

// ===========================================================================
// 6. Integridad de registries e IDs posteriores a la carga.
// ===========================================================================
check('6. WorldRegistries pasa su propia validateIntegrity() tras hidratar, sin colisión de ids', () => {
  const errors = hydrated.world.registries.validateIntegrity();
  assert.deepStrictEqual(errors, []);
  const newPlayerId = `player:${Date.now()}-post-load`;
  assert.strictEqual(hydrated.playerRegistry.get(newPlayerId), null, 'un id nuevo nunca debe colisionar con uno restaurado');
  assert.strictEqual(hydrated.contractRegistry.all().length, 2);
  assert.strictEqual(hydrated.registrationRegistry.allLicenses().length, 2);
  assert.strictEqual(hydrated.agentRegistry.allAgents().length, 1);
  assert.strictEqual(hydrated.marketRegistry.allThreads().length, 1);
});

// ===========================================================================
// 7. Igualdad de una siguiente acción determinista (original vs hidratado).
// ===========================================================================
check('7. la siguiente acción determinista (aplicar el MISMO resultado ya conocido al próximo partido pendiente) produce el MISMO estado observable en A y en B', () => {
  // `MatchEngine.simulateMatch` sin `precomputedResult` usa RNG real
  // (variación deliberada entre partidos, DESIGN.md 7) — no es la "acción
  // determinista" que exige el criterio de aceptación. La acción
  // determinista real es: dado el MISMO resultado externo ya conocido
  // (p.ej. el que ya vio el usuario en pantalla), aplicarlo produce el
  // MISMO efecto sobre standings/puntero en el runtime original y en el
  // hidratado.
  const originalRunner = career.competitionEngine.getRunner(career.regularStage.id);
  const hydratedRunner = hydrated.competitionEngine.getRunner(career.regularStage.id);
  const nextOriginal = originalRunner.getPendingMatches()[0];
  const nextHydrated = hydratedRunner.getPendingMatches()[0];
  assert.strictEqual(nextHydrated.id, nextOriginal.id);
  const fixedResult = { finalScore: { home: 88, away: 74 }, quarterScores: [], boxScore: null };
  const infoOriginal = career.competitionEngine.resolveMatch(career.regularStage.id, nextOriginal.id, { matchEngineOptions: { precomputedResult: fixedResult } });
  const infoHydrated = hydrated.competitionEngine.resolveMatch(career.regularStage.id, nextHydrated.id, { matchEngineOptions: { precomputedResult: fixedResult } });
  assert.deepStrictEqual(infoHydrated.result.finalScore, infoOriginal.result.finalScore);
  assert.deepStrictEqual(hydratedRunner.getStandings(), originalRunner.getStandings());
  assert.strictEqual(hydratedRunner.currentRoundPointer, originalRunner.currentRoundPointer);
});

// ===========================================================================
// 8. Rechazo de fingerprint corrupto antes del commit.
// ===========================================================================
check('8. un fingerprint manipulado se rechaza ANTES de tocar ninguna entidad', () => {
  const tampered = { ...outerSave, fingerprint: `${outerSave.fingerprint}0` };
  assert.throws(() => hydrateFrom(tampered), /fingerprint/i);
});

// ===========================================================================
// 9. Rechazo de schema/content pack incompatible.
// ===========================================================================
check('9. schemaVersion futura y content pack de versión distinta se rechazan explícitos', () => {
  const futureBase = wrapAsCareerSave(envelopeA, { slotId: 'manual-1', revision: 1, metadata: {} });
  // SQUAD-BUDGET-1 elevó SUPPORTED_SCHEMA_VERSION a 2, y ECONOMY-BOARD-1 la
  // eleva de nuevo a 3 (v1/v2 -> v3 son migraciones reales, no un rechazo) —
  // "futura" aquí debe superar la versión soportada actual, así que se usa 4.
  futureBase.schemaVersion = 4;
  const { fingerprint: _drop, ...futureWithoutFingerprint } = futureBase;
  const futureSchema = { ...futureWithoutFingerprint, fingerprint: CareerPersistenceBoundary.computeFingerprint(futureWithoutFingerprint) };
  assert.throws(() => hydrateFrom(futureSchema), /versión de guardado más reciente/i);

  assert.throws(() => CareerHydrationService.hydrate(outerSave, {
    availableContentPacks: [{ ...TEST_MANIFEST, version: '2.0.0' }],
    buildDateResolverProvider: noopDateResolverProvider,
  }), /versión incompatible/i);
});

// ===========================================================================
// 10. Bloqueo del guardado durante un partido activo.
// ===========================================================================
check('10. CareerPersistenceBoundary.canSave() bloquea mientras hay un partido en curso/revelándose', () => {
  assert.strictEqual(CareerPersistenceBoundary.canSave(buildRuntime(career)), true);
  const runtimeMidMatch = buildRuntime(career);
  runtimeMidMatch.activeMatchInProgress = true;
  assert.strictEqual(CareerPersistenceBoundary.canSave(runtimeMidMatch), false);
  assert.strictEqual(CareerPersistenceBoundary.describeSaveBlockers(runtimeMidMatch).length, 1);
});

// ===========================================================================
// 11. Una carga inválida no destruye la carrera activa (nunca se lanza a
//     medias — `hydrate()` no muta nada del llamador, ni siquiera parcial).
// ===========================================================================
check('11. hydrate() nunca deja un runtime a medias — falla entero y de una vez', () => {
  const originalTeamCountBefore = career.world.registries.teams.size;
  try {
    hydrateFrom({ ...outerSave, fingerprint: 'corrupt' });
    assert.fail('debía lanzar');
  } catch (e) { /* esperado */ }
  assert.strictEqual(career.world.registries.teams.size, originalTeamCountBefore, 'la carrera activa original no debe verse alterada por un intento de carga fallido');
});

// ===========================================================================
// 12. Reproducción de un playoff (bracket) tras completar la Liga regular.
// ===========================================================================
check('12. bracket de playoff activado tras completar la Liga se reproduce sin RNG ni callbacks duplicados', () => {
  const career2 = buildTestCareer();
  const runner = career2.competitionEngine.getRunner(career2.regularStage.id);
  let guard = 0;
  while (runner.getPendingMatches().length && guard < 50) {
    career2.competitionEngine.resolveMatch(career2.regularStage.id, runner.getPendingMatches()[0].id, {});
    guard += 1;
  }
  const playoffStageId = 'stage:sl1-fixture-league:2026-27:playoff';
  const playoffRunner = career2.competitionEngine.getRunner(playoffStageId);
  assert.ok(playoffRunner, 'el playoff debe haberse activado automáticamente al completar la Liga regular');
  const firstPlayoffMatch = playoffRunner.getPendingMatches()[0];
  career2.competitionEngine.resolveMatch(playoffStageId, firstPlayoffMatch.id, {});

  const envelope2 = CareerPersistenceBoundary.project(buildRuntime(career2), { snapshotAtGameDate });
  const outer2 = wrapAsCareerSave(envelope2, { slotId: 'manual-2', revision: 1, metadata: {} });
  const hydrated2 = hydrateFrom(outer2);
  const hydratedPlayoffRunner = hydrated2.competitionEngine.getRunner(playoffStageId);
  assert.ok(hydratedPlayoffRunner, 'el runner del playoff debe reconstruirse aunque la Liga regular ya esté "completed"');
  assert.strictEqual(hydratedPlayoffRunner.listPlayedMatchesInReplayOrder().length, 1);
  const hydratedRegularRunner = hydrated2.competitionEngine.getRunner(career2.regularStage.id);
  assert.deepStrictEqual(hydratedRegularRunner.getStandings(), runner.getStandings());
  const envelope2B = CareerPersistenceBoundary.project(runtimeFromHydrated(hydrated2), { snapshotAtGameDate });
  assert.strictEqual(envelope2B.fingerprint, envelope2.fingerprint);
});

console.log(`\nTEST SAVE-LOAD-1: OK (${passed} comprobaciones)`);
