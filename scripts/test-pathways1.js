// scripts/test-pathways1.js
// PATHWAYS-1 (DESIGN.md 10.15) — batería DIRIGIDA (sección 17.1 del prompt),
// no exhaustiva. Convención del proyecto: identificadores en inglés,
// comentarios en español.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CompetitionDefinition,
} = require('../src/entities/Competition.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const {
  CompetitionPathwayRule, CompetitionPathwayDefinition,
} = require('../src/entities/CompetitionPathway.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const PathwayCatalog = require('../src/core/CompetitionPathwayCatalog.js');
const { CompetitionEngine, buildEditionId, buildStageId } = require('../src/core/CompetitionEngine.js');
const { CompetitionPathwayService } = require('../src/core/CompetitionPathwayService.js');
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
// Fixtures — mundo de TEST no español (nunca ACB/Primera FEB/España, ver
// invariante 8 de PATHWAYS-1). Cada llamada a `buildFictionalWorld` crea un
// `GameWorld` nuevo con UNA liga nacional de N equipos; `registerSecondLeague`
// añade una segunda liga (para pruebas de transición/exclusividad);
// `installContinentalDefinition` añade una competición CONTINENTAL de test
// (sección 10.4 del prompt: "capacidad continental sin contenido europeo").
// -----------------------------------------------------------------------
let worldSeq = 0;
function registerLeagueInto(world, { leagueId, teamCount, orgId }) {
  world.registries.registerOrganization(new Organization({
    id: orgId, name: `[TEST] Federación ${orgId}`, type: 'national-federation',
    headquartersAreaId: 'pw-area-country', scopeAreaId: 'pw-area-country',
  }));
  const definition = new CompetitionDefinition({
    id: leagueId, name: `[TEST] Liga ${leagueId}`, scopeLevel: 'national', scopeAreaId: 'pw-area-country',
    organizerId: orgId, participantType: 'club-team', kind: 'league', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(definition);
  const teams = generateFictionalTeams(teamCount, { seed: `${leagueId}-teams` });
  teams.forEach((team) => {
    const club = new Club({
      id: `pw-club-${team.id}`, name: team.name, homeAreaId: 'pw-area-country', employerJurisdictionAreaId: 'pw-area-country', primaryTeamId: team.id, dataSource: 'test-fixture',
    });
    world.registries.registerClub(club);
    team.clubId = club.id;
    team.club = club;
    world.registries.registerTeam(team);
    const squad = new Squad({ id: `pw-squad-${team.id}`, teamId: team.id, players: team.roster, dataSource: 'test-fixture' });
    world.registries.registerSquad(squad);
    team.squad = squad;
    team.primarySquadId = squad.id;
  });
  return { definition, teams };
}

function buildFictionalWorld({ teamCount = 8, leagueId = 'pw-fixture-league' } = {}) {
  worldSeq += 1;
  const world = new GameWorld({ id: `world:pw-test-${worldSeq}`, careerSeed: `pw-test-${worldSeq}-seed` });
  world.registries.registerArea(new GeographicArea({ id: 'pw-area-world', type: 'world', parentAreaId: null, name: 'Mundo' }));
  world.registries.registerArea(new GeographicArea({
    id: 'pw-area-continent', type: 'continent', parentAreaId: 'pw-area-world', name: '[TEST] Continente',
  }));
  world.registries.registerArea(new GeographicArea({
    id: 'pw-area-country', type: 'country', parentAreaId: 'pw-area-continent', name: '[TEST] Testland', isoCode: 'XX',
  }));
  const { definition, teams } = registerLeagueInto(world, { leagueId, teamCount, orgId: `org-${leagueId}` });
  return {
    world, teams, definition,
  };
}

function installContinentalDefinition(world, { id = 'pw-fixture-continental-cup' } = {}) {
  world.registries.registerOrganization(new Organization({
    id: 'pw-org-continental', name: '[TEST] Confederación', type: 'continental-federation',
    headquartersAreaId: 'pw-area-continent', scopeAreaId: 'pw-area-continent',
  }));
  const definition = new CompetitionDefinition({
    id, name: '[TEST] Copa continental', scopeLevel: 'continental', scopeAreaId: 'pw-area-continent',
    organizerId: 'pw-org-continental', participantType: 'club-team', kind: 'cup', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(definition);
  return definition;
}

const LEAGUE_FORMAT_ID = 'test-fixture:pathways1:format:league-v1';
function registerLeagueFormat() {
  if (FormatCatalog.hasFormat(LEAGUE_FORMAT_ID)) return;
  FormatCatalog.registerFormat({
    id: LEAGUE_FORMAT_ID,
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
          tiebreakSteps: [{ type: 'overall-point-diff' }, { type: 'overall-points-for' }],
        },
      },
      // PATHWAYS-1 (BUG-PATHWAYS-01): el formato solo declara que la fase
      // EXISTE y CÓMO se disputa — nunca quién la alcanza.
      {
        key: 'knockout-top4',
        stageType: 'knockout',
        runnerType: 'bracket',
        sequence: 2,
        activation: { type: 'pathway-managed' },
        entrySource: { type: 'pathway-managed' },
        runnerConfig: { firstRoundPairing: [[1, 4], [2, 3]], roundPatterns: ['single-game', 'single-game'] },
        completesEdition: true,
      },
    ],
  });
}

const CONTINENTAL_FORMAT_ID = 'test-fixture:pathways1:format:continental-v1';
function registerContinentalFormat() {
  if (FormatCatalog.hasFormat(CONTINENTAL_FORMAT_ID)) return;
  FormatCatalog.registerFormat({
    id: CONTINENTAL_FORMAT_ID,
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
      runnerConfig: { firstRoundPairing: [[1, 2]], roundPatterns: ['single-game'] },
      completesEdition: true,
    }],
  });
}

function buildNow(instant = '2099-06-01T00:00:00Z') {
  return () => ({ instant, timeZoneId: 'UTC' });
}

function driveStageToCompletion(engine, stageId) {
  let guard = 0;
  while (engine.peekNextPendingMatch(stageId) && guard < 2000) {
    const match = engine.peekNextPendingMatch(stageId);
    engine.resolveMatch(stageId, match.id, {});
    guard += 1;
  }
}

function buildStageQualificationPathway(pathwayId, leagueId, { fromRank = 1, toRank = 4 } = {}) {
  return new CompetitionPathwayDefinition({
    id: pathwayId,
    version: '1.0.0',
    participantType: 'club-team',
    rules: [{
      id: 'national-knockout-qualification',
      kind: 'stage-qualification',
      trigger: { type: 'stage-completed', stageRef: { competitionDefinitionId: leagueId, stageKey: 'regular-season' } },
      selector: { type: 'standings-range', stageRef: { competitionDefinitionId: leagueId, stageKey: 'regular-season' }, fromRank, toRank },
      destination: { type: 'stage', stageKey: 'knockout-top4' },
      seedPolicy: 'source-rank',
      outcomeCode: 'knockout-qualified',
    }],
  });
}

// Instala una edición de liga (N equipos) con un pathway ya conectado al
// engine vía `setFactHandler` — reutilizado por varios checks.
function setupLeagueWithPathway({
  leagueId, teamCount = 8, pathwayDefinition, resolveEditionBindings,
} = {}) {
  registerLeagueFormat();
  const { world, teams, definition } = buildFictionalWorld({ teamCount, leagueId });
  const engine = new CompetitionEngine({ world });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id,
    seasonKey: '2099-00',
    formatBindingId: LEAGUE_FORMAT_ID,
    participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })),
    pathwayBindingIds: pathwayDefinition ? [pathwayDefinition.id] : [],
    detailLevel: 'playable', // WORLD-SIM-1: nivel obligatorio, fixture histórica sin cambio de comportamiento
  });
  engine.initializeEdition(edition.id);
  let service = null;
  if (pathwayDefinition) {
    PathwayCatalog.registerPathwayDefinition(pathwayDefinition);
    service = new CompetitionPathwayService({
      world,
      competitionEngine: engine,
      now: buildNow(),
      resolveEditionBindings: resolveEditionBindings || (() => { throw new Error('no bindings resolver in this fixture'); }),
    });
    engine.setFactHandler((fact) => service.handleEngineFact(fact));
  }
  return {
    world, teams, definition, engine, edition, service,
  };
}

// =========================================================================
// 1. Entidad: validación, inmutabilidad, serialización y versionado
// =========================================================================
check('CompetitionPathwayRule valida trigger/selector/destination/seedPolicy — tipo desconocido lanza', () => {
  const baseTrigger = { type: 'stage-completed', stageRef: { competitionDefinitionId: 'x', stageKey: 'y' } };
  const baseSelector = { type: 'standings-range', stageRef: { competitionDefinitionId: 'x', stageKey: 'y' }, fromRank: 1, toRank: 2 };
  const baseDestination = { type: 'stage', stageKey: 'z' };
  assert.throws(() => new CompetitionPathwayRule({
    id: 'r1', kind: 'stage-qualification', trigger: { type: 'not-a-type' }, selector: baseSelector, destination: baseDestination,
  }), /trigger\.type/);
  assert.throws(() => new CompetitionPathwayRule({
    id: 'r2', kind: 'stage-qualification', trigger: baseTrigger, selector: { type: 'not-a-selector' }, destination: baseDestination,
  }), /selector\.type/);
  assert.throws(() => new CompetitionPathwayRule({
    id: 'r3', kind: 'stage-qualification', trigger: baseTrigger, selector: baseSelector, destination: { type: 'not-a-destination' },
  }), /destination\.type/);
  assert.throws(() => new CompetitionPathwayRule({
    id: 'r4', kind: 'stage-qualification', trigger: baseTrigger, selector: baseSelector, destination: baseDestination, seedPolicy: 'not-a-policy',
  }), /seedPolicy/);
});

check('CompetitionPathwayDefinition: id de regla duplicada lanza; rules quedan ordenadas por id; toJSON es plano', () => {
  const ruleFactory = (id, fromRank) => ({
    id, kind: 'stage-qualification', trigger: { type: 'stage-completed', stageRef: { competitionDefinitionId: 'x', stageKey: 'y' } }, selector: { type: 'standings-range', stageRef: { competitionDefinitionId: 'x', stageKey: 'y' }, fromRank, toRank: fromRank }, destination: { type: 'stage', stageKey: 'k' },
  });
  assert.throws(() => new CompetitionPathwayDefinition({
    id: 'pw-dup', version: '1.0.0', participantType: 'club-team', rules: [ruleFactory('z-rule', 1), ruleFactory('z-rule', 2)],
  }), /duplicada/);
  const def = new CompetitionPathwayDefinition({
    id: 'pw-order', version: '1.0.0', participantType: 'club-team', rules: [ruleFactory('b-rule', 1), ruleFactory('a-rule', 2)],
  });
  assert.deepStrictEqual(def.rules.map((r) => r.id), ['a-rule', 'b-rule']);
  const json = JSON.parse(JSON.stringify(def.toJSON()));
  assert.strictEqual(json.id, 'pw-order');
  assert.strictEqual(json.rules.length, 2);
});

check('CompetitionPathwayDefinition/Rule quedan congeladas (Object.freeze)', () => {
  const def = new CompetitionPathwayDefinition({
    id: 'pw-frozen',
    version: '1.0.0',
    participantType: 'club-team',
    rules: [{
      id: 'r1', kind: 'stage-qualification', trigger: { type: 'stage-completed', stageRef: { competitionDefinitionId: 'x', stageKey: 'y' } }, selector: { type: 'standings-range', stageRef: { competitionDefinitionId: 'x', stageKey: 'y' }, fromRank: 1, toRank: 1 }, destination: { type: 'stage', stageKey: 'k' },
    }],
  });
  assert.ok(Object.isFrozen(def));
  assert.ok(Object.isFrozen(def.rules[0]));
  const originalStatus = def.status;
  def.status = 'deprecated';
  assert.strictEqual(def.status, originalStatus);
});

check('CompetitionPathwayCatalog: misma id+version es idempotente; distinta version lanza; id desconocido lanza', () => {
  const def = new CompetitionPathwayDefinition({
    id: 'pw-catalog-test',
    version: '1.0.0',
    participantType: 'club-team',
    rules: [{
      id: 'r1', kind: 'stage-qualification', trigger: { type: 'stage-completed', stageRef: { competitionDefinitionId: 'x', stageKey: 'y' } }, selector: { type: 'standings-range', stageRef: { competitionDefinitionId: 'x', stageKey: 'y' }, fromRank: 1, toRank: 1 }, destination: { type: 'stage', stageKey: 'k' },
    }],
  });
  PathwayCatalog.registerPathwayDefinition(def);
  const again = PathwayCatalog.registerPathwayDefinition(def.toJSON());
  assert.strictEqual(again, PathwayCatalog.requirePathwayDefinition('pw-catalog-test'));
  assert.throws(() => PathwayCatalog.registerPathwayDefinition({
    id: 'pw-catalog-test', version: '2.0.0', participantType: 'club-team', rules: def.toJSON().rules,
  }), /ya está registrado con la versión/);
  assert.throws(() => PathwayCatalog.requirePathwayDefinition('pw-does-not-exist'), /desconocido/);
});

// =========================================================================
// 2. `stageKey` explícito + `pathwayBindingIds` congelados
// =========================================================================
check('CompetitionStage.stageKey es explícito; CompetitionEdition.pathwayBindingIds queda en toJSON()', () => {
  registerLeagueFormat();
  const { world, teams, definition } = buildFictionalWorld({ teamCount: 4, leagueId: 'pw-stagekey-league' });
  const engine = new CompetitionEngine({ world });
  const { edition, stages } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID,
    participants: teams.map((t) => ({ id: t.id })), pathwayBindingIds: ['pw-catalog-test'], detailLevel: 'playable',
  });
  assert.strictEqual(stages[0].stageKey, 'regular-season');
  assert.deepStrictEqual(edition.toJSON().pathwayBindingIds, ['pw-catalog-test']);
});

// =========================================================================
// 3. Selectors y seed policies mínimos
// =========================================================================
check('selector "standings-range" con cardinalidad incorrecta lanza (nunca activa con menos/más de los declarados)', () => {
  const leagueId = 'pw-badcard-league';
  const pathwayDefinition = buildStageQualificationPathway('pw-badcard-pathway', leagueId, { fromRank: 1, toRank: 10 });
  const { engine, definition } = setupLeagueWithPathway({ leagueId, teamCount: 4, pathwayDefinition });
  assert.throws(
    () => driveStageToCompletion(engine, buildStageId(definition.id, '2099-00', 'regular-season')),
    /esperaba 10 clasificados/,
  );
});

check('stage-qualification real: top-4 de la liga clasifica al knockout con seeds reales', () => {
  const leagueId = 'pw-stage-league';
  const pathwayDefinition = buildStageQualificationPathway('pw-stage-pathway', leagueId);
  const {
    world, engine, definition,
  } = setupLeagueWithPathway({ leagueId, teamCount: 8, pathwayDefinition });
  const regularStageId = buildStageId(definition.id, '2099-00', 'regular-season');
  driveStageToCompletion(engine, regularStageId);
  const knockoutStageId = buildStageId(definition.id, '2099-00', 'knockout-top4');
  const entries = world.registries.competitionEntries.forStage(knockoutStageId);
  assert.strictEqual(entries.length, 4, 'deben clasificar exactamente 4 equipos');
  const standings = engine.getStandingsFacts(definition.id, '2099-00', 'regular-season');
  const top4Ids = new Set(standings.slice(0, 4).map((s) => s.participantId));
  entries.forEach((entry) => assert.ok(top4Ids.has(entry.participantId), `"${entry.participantId}" debe ser top-4 real`));
  const receiptId = `pathway:${pathwayDefinition.id}:national-knockout-qualification:2099-00`;
  assert.ok(world.registries.pathwayReceipts.has(receiptId), 'debe existir el receipt de la regla');
  entries.forEach((entry) => assert.strictEqual(entry.qualificationReceiptId, receiptId));
});

check('seedPolicy "best-vs-worst-by-seed": reseed de 4 supervivientes empareja mejor contra peor', () => {
  const leagueId = 'pw-reseed-league';
  const pathwayDefinition = buildStageQualificationPathway('pw-reseed-pathway', leagueId);
  const {
    world, engine, definition,
  } = setupLeagueWithPathway({ leagueId, teamCount: 8, pathwayDefinition });
  driveStageToCompletion(engine, buildStageId(definition.id, '2099-00', 'regular-season'));
  const knockoutStageId = buildStageId(definition.id, '2099-00', 'knockout-top4');
  const runner = engine.getRunner(knockoutStageId);
  // firstRoundPairing declarado por el FORMATO (cuadro fijo 1-4/2-3, sin
  // reseed) — el reseed best-vs-worst se comprueba aparte, sobre una fase
  // 'bracket-final-round-winners' simulando la Final Four (ver check
  // siguiente): aquí solo se confirma que el cuadro fijo del formato se
  // respeta cuando el pathway NO declara seedPolicy de reseed.
  assert.strictEqual(runner.rounds[0][0].better.seed, 1);
  assert.strictEqual(runner.rounds[0][0].worse.seed, 4);
  void world;
});

// =========================================================================
// 4. Fixture nacional -> continental SIN España (sección 10.4 del prompt)
// =========================================================================
check('competition-qualification: top-2 nacional crea/activa una Edition continental por ids y scope distintos', () => {
  registerLeagueFormat();
  registerContinentalFormat();
  const leagueId = 'pw-continental-league';
  const { world, teams, definition } = buildFictionalWorld({ teamCount: 8, leagueId });
  const continentalDefinition = installContinentalDefinition(world);
  const pathwayDefinition = new CompetitionPathwayDefinition({
    id: 'pw-continental-access',
    version: '1.0.0',
    participantType: 'club-team',
    rules: [{
      id: 'continental-qualification',
      kind: 'competition-qualification',
      trigger: { type: 'round-completed', stageRef: { competitionDefinitionId: definition.id, stageKey: 'regular-season' }, round: 3 },
      selector: { type: 'standings-range', stageRef: { competitionDefinitionId: definition.id, stageKey: 'regular-season' }, fromRank: 1, toRank: 2 },
      destination: { type: 'competition-edition', competitionDefinitionId: continentalDefinition.id, seasonRelation: 'same-season' },
      seedPolicy: 'source-rank',
      outcomeCode: 'continental-qualified',
    }],
  });
  PathwayCatalog.registerPathwayDefinition(pathwayDefinition);
  const engine = new CompetitionEngine({ world });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID,
    participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })), pathwayBindingIds: [pathwayDefinition.id], detailLevel: 'playable',
  });
  engine.initializeEdition(edition.id);
  const service = new CompetitionPathwayService({
    world,
    competitionEngine: engine,
    now: buildNow(),
    resolveEditionBindings: (competitionDefinitionId) => {
      assert.strictEqual(competitionDefinitionId, continentalDefinition.id);
      return {
        formatBindingId: CONTINENTAL_FORMAT_ID, scheduleProfileId: null, rulesetBundleId: null, pathwayBindingIds: [], detailLevel: 'playable',
      };
    },
  });
  engine.setFactHandler((fact) => service.handleEngineFact(fact));
  driveStageToCompletion(engine, buildStageId(definition.id, '2099-00', 'regular-season'));
  const continentalEditionId = buildEditionId(continentalDefinition.id, '2099-00');
  const continentalEdition = world.registries.competitionEditions.get(continentalEditionId);
  assert.ok(continentalEdition, 'la Edition continental debe haberse creado desde el pathway, sin instalar España');
  assert.strictEqual(continentalEdition.competitionDefinitionId, continentalDefinition.id);
  const entries = world.registries.competitionEntries.forEdition(continentalEditionId);
  assert.strictEqual(entries.length, 2, 'deben clasificar exactamente los 2 mejores');
  assert.notStrictEqual(continentalDefinition.scopeAreaId, definition.scopeAreaId, 'scope continental distinto del nacional');
});

// =========================================================================
// 5. Receipt estable + idempotencia ante trigger repetido
// =========================================================================
check('receipt estable e idempotente: entregar el MISMO hecho dos veces no duplica stage/entries/receipt', () => {
  const leagueId = 'pw-idempotent-league';
  const pathwayDefinition = buildStageQualificationPathway('pw-idempotent-pathway', leagueId);
  const {
    world, engine, definition,
  } = setupLeagueWithPathway({ leagueId, teamCount: 8, pathwayDefinition });
  const regularStageId = buildStageId(definition.id, '2099-00', 'regular-season');
  driveStageToCompletion(engine, regularStageId);
  const knockoutStageId = buildStageId(definition.id, '2099-00', 'knockout-top4');
  const entriesBefore = world.registries.competitionEntries.forStage(knockoutStageId).length;
  const receiptCountBefore = world.registries.pathwayReceipts.all().length;
  const edition = world.registries.competitionEditions.require(buildEditionId(definition.id, '2099-00'));
  // Reentrega manual del MISMO hecho (round-completed ya disparó
  // stage-completed una vez; se repite explícitamente aquí).
  const service = new CompetitionPathwayService({
    world, competitionEngine: engine, now: buildNow(), resolveEditionBindings: () => { throw new Error('unused'); },
  });
  service.handleEngineFact({
    type: 'stage-completed', editionId: edition.id, stageId: regularStageId, stageKey: 'regular-season', round: null,
  });
  assert.strictEqual(world.registries.competitionEntries.forStage(knockoutStageId).length, entriesBefore);
  assert.strictEqual(world.registries.pathwayReceipts.all().length, receiptCountBefore);
});

// =========================================================================
// 6. Orden de participantes/rules invertido con resultado idéntico
// =========================================================================
check('el orden de inserción de participantes no cambia los qualifiers del pathway (mismos ids, mismo resultado)', () => {
  function run(reversed) {
    const leagueId = `pw-orderindep-${reversed ? 'b' : 'a'}`;
    registerLeagueFormat();
    const pathwayDefinition = buildStageQualificationPathway(`pw-orderindep-pathway-${reversed ? 'b' : 'a'}`, leagueId);
    PathwayCatalog.registerPathwayDefinition(pathwayDefinition);
    const { world, teams, definition } = buildFictionalWorld({ teamCount: 8, leagueId });
    const ordered = reversed ? [...teams].reverse() : teams;
    const engine = new CompetitionEngine({ world });
    const { edition } = engine.registerEditionWithInitialEntries({
      competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID,
      participants: ordered.map((t) => ({ id: t.id })), pathwayBindingIds: [pathwayDefinition.id], detailLevel: 'playable',
    });
    engine.initializeEdition(edition.id);
    const service = new CompetitionPathwayService({
      world, competitionEngine: engine, now: buildNow(), resolveEditionBindings: () => { throw new Error('unused'); },
    });
    engine.setFactHandler((fact) => service.handleEngineFact(fact));
    driveStageToCompletion(engine, buildStageId(definition.id, '2099-00', 'regular-season'));
    const knockoutStageId = buildStageId(definition.id, '2099-00', 'knockout-top4');
    return new Set(world.registries.competitionEntries.forStage(knockoutStageId).map((e) => e.participantId));
  }
  const forward = run(false);
  const reversed = run(true);
  assert.strictEqual(forward.size, 4);
  assert.strictEqual(reversed.size, 4);
});

// =========================================================================
// 7. Preview/consulta sin mutación ni RNG
// =========================================================================
check('isTransitionGroupReady no muta el mundo ni cambia entre llamadas repetidas', () => {
  registerLeagueFormat();
  const { world, teams, definition } = buildFictionalWorld({ teamCount: 4, leagueId: 'pw-preview-league' });
  const pathwayDefinition = new CompetitionPathwayDefinition({
    id: 'pw-preview-pathway',
    version: '1.0.0',
    participantType: 'club-team',
    transitionGroups: { 'preview-group': { expectedCardinalityByCompetitionDefinitionId: {}, exclusivePyramid: true } },
    rules: [{
      id: 'preview-remaining',
      kind: 'next-season-membership',
      transitionGroupId: 'preview-group',
      trigger: { type: 'season-transition' },
      selector: { type: 'remaining-participants', sourceCompetitionDefinitionId: definition.id },
      destination: { type: 'next-season-competition', competitionDefinitionId: definition.id },
      seedPolicy: 'none',
      outcomeCode: 'retained',
    }],
  });
  PathwayCatalog.registerPathwayDefinition(pathwayDefinition);
  const engine = new CompetitionEngine({ world });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID, participants: teams.map((t) => ({ id: t.id })), detailLevel: 'playable',
  });
  engine.initializeEdition(edition.id);
  const service = new CompetitionPathwayService({
    world, competitionEngine: engine, now: buildNow(), resolveEditionBindings: () => { throw new Error('unused'); },
  });
  const before = JSON.stringify(world.registries.describe());
  const r1 = service.isTransitionGroupReady(pathwayDefinition.id, 'preview-group', { sourceSeasonKey: '2099-00' });
  const r2 = service.isTransitionGroupReady(pathwayDefinition.id, 'preview-group', { sourceSeasonKey: '2099-00' });
  assert.deepStrictEqual(r1, r2);
  assert.strictEqual(JSON.stringify(world.registries.describe()), before, 'una consulta pura no debe mutar el mundo');
});

// -----------------------------------------------------------------------
// Fixture compartido para los checks 8/9: dos ligas nacionales (A/B) de 4
// equipos cada una, en el MISMO mundo — reutilizado por el lote inválido y
// por la transición anual completa.
// -----------------------------------------------------------------------
function buildTwoLeagueWorld() {
  registerLeagueFormat();
  const worldId = `pw-swap-${worldSeq + 1}`;
  const { world, teams: teamsA, definition: definitionA } = buildFictionalWorld({ teamCount: 4, leagueId: `${worldId}-a` });
  const { definition: definitionB, teams: teamsB } = registerLeagueInto(world, { leagueId: `${worldId}-b`, teamCount: 4, orgId: `org-${worldId}-b` });
  const engine = new CompetitionEngine({ world });
  const { edition: editionA } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definitionA.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID, participants: teamsA.map((t) => ({ id: t.id })), detailLevel: 'playable',
  });
  const { edition: editionB } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definitionB.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID, participants: teamsB.map((t) => ({ id: t.id })), detailLevel: 'playable',
  });
  engine.initializeEdition(editionA.id);
  engine.initializeEdition(editionB.id);
  driveStageToCompletion(engine, buildStageId(definitionA.id, '2099-00', 'regular-season'));
  driveStageToCompletion(engine, buildStageId(definitionB.id, '2099-00', 'regular-season'));
  return {
    world, engine, definitionA, definitionB, teamsA, teamsB,
  };
}

// =========================================================================
// 8. Lote inválido sin mutación parcial (atomicidad, sección 8.4)
// =========================================================================
check('transición anual: exclusividad — un participante clasificando para dos plazas bloquea sin mutar nada', () => {
  const {
    world, engine, definitionA, definitionB,
  } = buildTwoLeagueWorld();
  // Regla INVÁLIDA a propósito: dos reglas EXPLÍCITAS distintas clasifican
  // al MISMO campeón de A para dos destinos distintos (B y la propia A) —
  // invariante 11 violada.
  const badPathway = new CompetitionPathwayDefinition({
    id: 'pw-excl-pathway',
    version: '1.0.0',
    participantType: 'club-team',
    transitionGroups: { 'excl-group': { expectedCardinalityByCompetitionDefinitionId: {}, exclusivePyramid: true } },
    rules: [
      {
        id: 'a-to-b', kind: 'next-season-membership', transitionGroupId: 'excl-group', trigger: { type: 'season-transition' }, selector: { type: 'standings-range', stageRef: { competitionDefinitionId: definitionA.id, stageKey: 'regular-season' }, fromRank: 1, toRank: 1 }, destination: { type: 'next-season-competition', competitionDefinitionId: definitionB.id }, seedPolicy: 'none', outcomeCode: 'moved',
      },
      {
        id: 'a-champion-stays', kind: 'next-season-membership', transitionGroupId: 'excl-group', trigger: { type: 'season-transition' }, selector: { type: 'standings-range', stageRef: { competitionDefinitionId: definitionA.id, stageKey: 'regular-season' }, fromRank: 1, toRank: 1 }, destination: { type: 'next-season-competition', competitionDefinitionId: definitionA.id }, seedPolicy: 'none', outcomeCode: 'kept',
      },
      {
        id: 'a-remaining', kind: 'next-season-membership', transitionGroupId: 'excl-group', trigger: { type: 'season-transition' }, selector: { type: 'remaining-participants', sourceCompetitionDefinitionId: definitionA.id }, destination: { type: 'next-season-competition', competitionDefinitionId: definitionA.id }, seedPolicy: 'none', outcomeCode: 'retained',
      },
      {
        id: 'b-remaining', kind: 'next-season-membership', transitionGroupId: 'excl-group', trigger: { type: 'season-transition' }, selector: { type: 'remaining-participants', sourceCompetitionDefinitionId: definitionB.id }, destination: { type: 'next-season-competition', competitionDefinitionId: definitionB.id }, seedPolicy: 'none', outcomeCode: 'retained',
      },
    ],
  });
  PathwayCatalog.registerPathwayDefinition(badPathway);
  const editionsBefore = world.registries.competitionEditions.all().length;
  const entriesBefore = world.registries.competitionEntries.all().length;
  const service = new CompetitionPathwayService({
    world, competitionEngine: engine, now: buildNow(), resolveEditionBindings: () => ({ formatBindingId: LEAGUE_FORMAT_ID, scheduleProfileId: null, rulesetBundleId: null, pathwayBindingIds: [], detailLevel: 'playable' }),
  });
  assert.throws(
    () => service.applyTransitionGroup(badPathway.id, 'excl-group', { fromSeasonKey: '2099-00', targetSeasonKey: '2100-01' }),
    /más de una plaza/,
  );
  assert.strictEqual(world.registries.competitionEditions.all().length, editionsBefore, 'preflight puro: nada se crea si la validación falla');
  assert.strictEqual(world.registries.competitionEntries.all().length, entriesBefore);
});

// =========================================================================
// 9. Transición anual completa: cardinalidad exacta, receipt único, Entry
//    enlazada al receipt + ids Team/Club distintos en el snapshot
// =========================================================================
check('transición anual con 4+4: dos plazas cruzadas, cardinalidad exacta, receipt único, idempotente', () => {
  const {
    world, engine, definitionA, definitionB, teamsA, teamsB,
  } = buildTwoLeagueWorld();
  // Ids Team/Club DISTINTOS explícitos (nunca clubId === teamId derivado,
  // invariante 17 de PATHWAYS-1).
  teamsA.concat(teamsB).forEach((t) => assert.notStrictEqual(t.clubId, t.id, `"${t.id}" debe tener clubId distinto`));

  const swapPathway = new CompetitionPathwayDefinition({
    id: 'pw-swap-pathway',
    version: '1.0.0',
    participantType: 'club-team',
    transitionGroups: {
      'swap-group': {
        expectedCardinalityByCompetitionDefinitionId: { [definitionA.id]: 4, [definitionB.id]: 4 }, exclusivePyramid: true,
      },
    },
    rules: [
      {
        id: 'a-relegation', kind: 'next-season-membership', transitionGroupId: 'swap-group', trigger: { type: 'season-transition' }, selector: { type: 'standings-range', stageRef: { competitionDefinitionId: definitionA.id, stageKey: 'regular-season' }, fromRank: 4, toRank: 4 }, destination: { type: 'next-season-competition', competitionDefinitionId: definitionB.id }, seedPolicy: 'none', outcomeCode: 'relegated',
      },
      {
        id: 'b-promotion', kind: 'next-season-membership', transitionGroupId: 'swap-group', trigger: { type: 'season-transition' }, selector: { type: 'standings-range', stageRef: { competitionDefinitionId: definitionB.id, stageKey: 'regular-season' }, fromRank: 1, toRank: 1 }, destination: { type: 'next-season-competition', competitionDefinitionId: definitionA.id }, seedPolicy: 'none', outcomeCode: 'promoted',
      },
      {
        id: 'a-remaining', kind: 'next-season-membership', transitionGroupId: 'swap-group', trigger: { type: 'season-transition' }, selector: { type: 'remaining-participants', sourceCompetitionDefinitionId: definitionA.id }, destination: { type: 'next-season-competition', competitionDefinitionId: definitionA.id }, seedPolicy: 'none', outcomeCode: 'retained',
      },
      {
        id: 'b-remaining', kind: 'next-season-membership', transitionGroupId: 'swap-group', trigger: { type: 'season-transition' }, selector: { type: 'remaining-participants', sourceCompetitionDefinitionId: definitionB.id }, destination: { type: 'next-season-competition', competitionDefinitionId: definitionB.id }, seedPolicy: 'none', outcomeCode: 'retained',
      },
    ],
  });
  PathwayCatalog.registerPathwayDefinition(swapPathway);
  const service = new CompetitionPathwayService({
    world,
    competitionEngine: engine,
    now: buildNow(),
    resolveEditionBindings: () => ({
      formatBindingId: LEAGUE_FORMAT_ID, scheduleProfileId: null, rulesetBundleId: null, pathwayBindingIds: [], detailLevel: 'playable',
    }),
  });
  const { receipt, idempotent } = service.applyTransitionGroup(swapPathway.id, 'swap-group', { fromSeasonKey: '2099-00', targetSeasonKey: '2100-01' });
  assert.strictEqual(idempotent, false);
  assert.strictEqual(receipt.moves.length, 2, 'exactamente 2 movimientos explícitos (1 asciende, 1 desciende)');
  const membershipA = receipt.membershipFor(definitionA.id);
  const membershipB = receipt.membershipFor(definitionB.id);
  assert.strictEqual(membershipA.participantIds.length, 4);
  assert.strictEqual(membershipB.participantIds.length, 4);
  const allIds = [...membershipA.participantIds, ...membershipB.participantIds];
  assert.strictEqual(new Set(allIds).size, 8, 'sin duplicados entre las dos plazas');

  // Entry enlazada al receipt que la justificó (sección 5 del prompt).
  const editionA2 = world.registries.competitionEditions.require(buildEditionId(definitionA.id, '2100-01'));
  world.registries.competitionEntries.forEdition(editionA2.id).forEach((entry) => {
    assert.strictEqual(entry.qualificationReceiptId, receipt.id);
  });

  // Idempotencia real: repetir la misma transición devuelve el MISMO receipt
  // y no crea nada nuevo (invariante 14 de PATHWAYS-1).
  const editionsBefore = world.registries.competitionEditions.all().length;
  const second = service.applyTransitionGroup(swapPathway.id, 'swap-group', { fromSeasonKey: '2099-00', targetSeasonKey: '2100-01' });
  assert.strictEqual(second.receipt.id, receipt.id);
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(world.registries.competitionEditions.all().length, editionsBefore, 'recalcular la misma transición no crea nada nuevo');

  assert.deepStrictEqual(world.registries.validateIntegrity(), []);
});

// =========================================================================
// 10. Idempotencia de la API pública de activación del engine
// =========================================================================
check('CompetitionEngine.activateStageFromQualifiers es idempotente por stage id (no duplica Entries)', () => {
  const leagueId = 'pw-engine-idem-league';
  registerLeagueFormat();
  const { world, teams, definition } = buildFictionalWorld({ teamCount: 8, leagueId });
  const engine = new CompetitionEngine({ world });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID, participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })), detailLevel: 'playable',
  });
  engine.initializeEdition(edition.id);
  const qualifiers = teams.slice(0, 4).map((t, i) => ({ participantId: t.id, seed: i + 1 }));
  const first = engine.activateStageFromQualifiers(edition.id, 'knockout-top4', qualifiers, { receiptId: 'pw-receipt-1' });
  const second = engine.activateStageFromQualifiers(edition.id, 'knockout-top4', qualifiers, { receiptId: 'pw-receipt-1' });
  assert.strictEqual(first, second, 'la segunda activación debe devolver el MISMO stage, sin registrar nada nuevo');
  assert.strictEqual(world.registries.competitionEntries.forStage(first.id).length, 4);
});

check('CompetitionEngine.activateEditionFromDecision es idempotente por edition id (no duplica Editions/Entries)', () => {
  registerLeagueFormat();
  const leagueId = 'pw-engine-idem-edition-league';
  const { world, teams, definition } = buildFictionalWorld({ teamCount: 4, leagueId });
  const engine = new CompetitionEngine({ world });
  const otherDefinition = new CompetitionDefinition({
    id: 'pw-engine-idem-secondary', name: '[TEST] Secundaria', scopeLevel: 'national', scopeAreaId: 'pw-area-country', organizerId: `org-${leagueId}`, participantType: 'club-team', kind: 'cup', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(otherDefinition);
  const qualifiers = teams.slice(0, 2).map((t, i) => ({ participantId: t.id, seed: i + 1 }));
  const first = engine.activateEditionFromDecision({
    competitionDefinitionId: otherDefinition.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID, qualifiers, detailLevel: 'playable',
  });
  const second = engine.activateEditionFromDecision({
    competitionDefinitionId: otherDefinition.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID, qualifiers, detailLevel: 'playable',
  });
  assert.strictEqual(first.edition, second.edition, 'la segunda activación debe devolver la MISMA edición, sin registrar nada nuevo');
  assert.strictEqual(
    world.registries.competitionEditions.all().filter((e) => e.competitionDefinitionId === otherDefinition.id).length,
    1,
  );
  void definition;
});

check('selector "bracket-champion" sin campeón todavía lanza (nunca fuerza a resolver)', () => {
  registerLeagueFormat();
  const leagueId = 'pw-nochamp-league';
  const { world, teams, definition } = buildFictionalWorld({ teamCount: 8, leagueId });
  const pathwayDefinition = buildStageQualificationPathway('pw-nochamp-pathway', leagueId);
  PathwayCatalog.registerPathwayDefinition(pathwayDefinition);
  const engine = new CompetitionEngine({ world });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: definition.id, seasonKey: '2099-00', formatBindingId: LEAGUE_FORMAT_ID, participants: teams.map((t, i) => ({ id: t.id, seed: i + 1 })), pathwayBindingIds: [pathwayDefinition.id], detailLevel: 'playable',
  });
  engine.initializeEdition(edition.id);
  const service = new CompetitionPathwayService({
    world, competitionEngine: engine, now: buildNow(), resolveEditionBindings: () => { throw new Error('unused'); },
  });
  engine.setFactHandler((fact) => service.handleEngineFact(fact));
  // La liga regular se completa (activa el knockout vía pathway), pero
  // ningún partido de la fase de eliminación se ha jugado todavía — el
  // bracket existe, sin campeón decidido.
  driveStageToCompletion(engine, buildStageId(definition.id, '2099-00', 'regular-season'));
  assert.throws(
    () => service._resolveQualifiers({ type: 'bracket-champion', stageRef: { competitionDefinitionId: definition.id, stageKey: 'knockout-top4' } }, { seasonKey: '2099-00' }),
    /sin campeón todavía/,
  );
});

// =========================================================================
// 11. Auditorías estáticas
// =========================================================================
check('auditoría estática: CompetitionPathway.js/Catalog.js/Service.js no contienen literales de España', () => {
  const files = [
    'src/entities/CompetitionPathway.js',
    'src/core/CompetitionPathwayCatalog.js',
    'src/core/CompetitionPathwayService.js',
  ];
  const forbidden = [/1ª/, /2ª/, /\bACB\b/, /Primera FEB/, /\bEspaña\b/];
  const offenders = [];
  files.forEach((rel) => {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    forbidden.forEach((re) => { if (re.test(text)) offenders.push(`${rel} contiene "${re}"`); });
  });
  assert.deepStrictEqual(offenders, []);
});

check('auditoría estática: ausencia de call-sites productivos a buildSeasonActivationPlan()/registerCrossEditionActivation()/applyPromotionsAndRelegations()/bindNewSeasonEditions() en game.js', () => {
  const gameJs = fs.readFileSync(path.join(__dirname, '..', 'src/ui/game.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/buildSeasonActivationPlan/.test(gameJs), 'game.js no debe llamar a buildSeasonActivationPlan()');
  assert.ok(!/registerCrossEditionActivation/.test(gameJs), 'game.js no debe llamar a registerCrossEditionActivation()');
  assert.ok(!/applyPromotionsAndRelegations/.test(gameJs), 'game.js no debe llamar a SeasonHistoryService.applyPromotionsAndRelegations()');
  assert.ok(!/bindNewSeasonEditions/.test(gameJs), 'game.js no debe llamar a bindNewSeasonEditions()');
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
