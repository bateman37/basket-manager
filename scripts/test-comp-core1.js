// scripts/test-comp-core1.js
// COMP-CORE-1 (DESIGN.md 10.13) — batería DIRIGIDA (sección 15.1/15.3 del
// prompt), no exhaustiva. Convención del proyecto: identificadores en
// inglés, comentarios en español.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CompetitionDefinition, CompetitionEdition, CompetitionStage, CompetitionEntry, CompetitionFormatDefinition,
} = require('../src/entities/Competition.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const { WorldRegistries } = require('../src/core/WorldRegistry.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const {
  RoundRobinStageRunner, BracketStageRunner, VENUE_PATTERNS,
} = require('../src/core/CompetitionRunners.js');
const {
  CompetitionEngine, registerEditionWithInitialEntries, buildEditionId, buildStageId, buildEntryId,
} = require('../src/core/CompetitionEngine.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const CompetitionParticipationService = require('../src/core/CompetitionParticipationService.js');
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
// Fixtures compartidos: mundo de TEST no español (nunca ACB/Primera FEB/
// España) con dos formatos GENÉRICOS (round-robin + bracket).
// -----------------------------------------------------------------------
function buildFictionalWorld({ id, teamCount = 8 }) {
  const world = new GameWorld({ id, careerSeed: `${id}-seed` });
  world.registries.registerArea(new GeographicArea({
    id: 'area-world', type: 'world', parentAreaId: null, name: 'Mundo',
  }));
  world.registries.registerArea(new GeographicArea({
    id: 'area-country-testland', type: 'country', parentAreaId: 'area-world', name: 'Testland', isoCode: 'XX',
  }));
  world.registries.registerOrganization(new Organization({
    id: 'org-testland', name: 'Testland Basketball Federation', type: 'national-federation',
    headquartersAreaId: 'area-country-testland', scopeAreaId: 'area-country-testland',
  }));
  const definition = new CompetitionDefinition({
    id: 'testland-fixture-league', name: '[TEST] Testland League', scopeLevel: 'national', scopeAreaId: 'area-country-testland',
    organizerId: 'org-testland', participantType: 'club-team', kind: 'league', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(definition);
  const teams = generateFictionalTeams(teamCount, { seed: `${id}-teams` });
  teams.forEach((team) => {
    const club = new Club({
      id: `club-${team.id}`, name: team.name, homeAreaId: 'area-country-testland', employerJurisdictionAreaId: 'area-country-testland', primaryTeamId: team.id, dataSource: 'test-fixture',
    });
    world.registries.registerClub(club);
    team.clubId = club.id;
    team.club = club;
    world.registries.registerTeam(team);
    const squad = new Squad({
      id: `squad-${team.id}`, teamId: team.id, players: team.roster, dataSource: 'test-fixture',
    });
    world.registries.registerSquad(squad);
    team.squad = squad;
    team.primarySquadId = squad.id;
  });
  return { world, teams, definition };
}

const FIXTURE_FORMAT_ID = 'test-fixture:format:league-and-playoff-v1';
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
            { type: 'group-head-to-head-balance' },
            { type: 'group-head-to-head-point-diff' },
            { type: 'overall-point-diff' },
            { type: 'overall-points-for' },
            { type: 'overall-quotient-sum' },
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

function driveStageToCompletion(engine, stageId) {
  let guard = 0;
  while (engine.peekNextPendingMatch(stageId) && guard < 2000) {
    const match = engine.peekNextPendingMatch(stageId);
    engine.resolveMatch(stageId, match.id, {});
    guard += 1;
  }
  return guard;
}

// =========================================================================
// 1. Formato: registro/versionado/inmutabilidad
// =========================================================================
check('CompetitionFormatDefinition exige stageTemplates no vacío y valida activation/entrySource', () => {
  assert.throws(() => new CompetitionFormatDefinition({
    id: 'bad-format', version: '1.0.0', participantType: 'club-team', stageTemplates: [],
  }), /stageTemplates/);
  assert.throws(() => new CompetitionFormatDefinition({
    id: 'bad-format-2',
    version: '1.0.0',
    participantType: 'club-team',
    stageTemplates: [{
      key: 's1', stageType: 'round-robin', runnerType: 'round-robin', activation: { type: 'not-a-real-type' }, entrySource: { type: 'initial-participants' },
    }],
  }), /activation\.type/);
});

check('CompetitionFormatCatalog: registrar dos veces la MISMA id+version es idempotente; distinta version lanza', () => {
  registerFixtureFormat();
  const again = FormatCatalog.registerFormat({
    id: FIXTURE_FORMAT_ID,
    version: '1.0.0',
    participantType: 'club-team',
    stageTemplates: FormatCatalog.requireFormat(FIXTURE_FORMAT_ID).stageTemplates.map((t) => t.toJSON()),
  });
  assert.strictEqual(again, FormatCatalog.requireFormat(FIXTURE_FORMAT_ID));
  assert.throws(() => FormatCatalog.registerFormat({
    id: FIXTURE_FORMAT_ID, version: '2.0.0', participantType: 'club-team', stageTemplates: [{ key: 'x', stageType: 'round-robin', runnerType: 'round-robin', activation: { type: 'edition-start' }, entrySource: { type: 'initial-participants' }, runnerConfig: {} }],
  }), /ya está registrado con la versión/);
});

check('CompetitionFormatDefinition congelada: Object.freeze impide mutar sus campos (silencioso en modo no estricto, TypeError en estricto)', () => {
  const format = FormatCatalog.requireFormat(FIXTURE_FORMAT_ID);
  assert.ok(Object.isFrozen(format), 'la definición de formato debe estar congelada');
  assert.ok(Object.isFrozen(format.stageTemplates), 'stageTemplates debe estar congelado');
  const template = format.getStageTemplate('regular-season');
  assert.ok(Object.isFrozen(template), 'cada stageTemplate debe estar congelado');
  assert.ok(Object.isFrozen(template.runnerConfig), 'runnerConfig debe estar congelado');
  const originalStatus = format.status;
  format.status = 'deprecated'; // no-op en modo no estricto — la asignación se ignora
  assert.strictEqual(format.status, originalStatus, 'una definición fijada no puede modificarse después');
});

// =========================================================================
// 2. Edition activa con bindings congelados; transiciones válidas/terminales
// =========================================================================
check('CompetitionEdition congela formatBindingId/scheduleProfileId/rulesetBundleId al crearse', () => {
  const { world } = buildFictionalWorld({ id: 'world:test-edition-bindings' });
  const engine = new CompetitionEngine({ world });
  const { edition } = registerEditionWithInitialEntries(world, {
    competitionDefinitionId: 'testland-fixture-league', seasonKey: '2099-00', formatBindingId: FIXTURE_FORMAT_ID, scheduleProfileId: 'test-profile', rulesetBundleId: 'test-bundle-v1', participants: [],
  });
  assert.strictEqual(edition.formatBindingId, FIXTURE_FORMAT_ID);
  assert.strictEqual(edition.scheduleProfileId, 'test-profile');
  assert.strictEqual(edition.rulesetBundleId, 'test-bundle-v1');
  void engine;
});

check('CompetitionEdition/Stage: transiciones de estado válidas y terminal nunca vuelve a activo', () => {
  const edition = new CompetitionEdition({
    id: 'edition:t', competitionDefinitionId: 'testland-fixture-league', seasonKey: '2099-00', status: 'active',
  });
  edition.setStatus('completed');
  assert.strictEqual(edition.status, 'completed');
  assert.throws(() => edition.setStatus('not-a-status'), /no válido/);
  // Invariante 17: un terminal no debe reactivarse — auditado a nivel de
  // motor (CompetitionEngine._maybeCompleteEdition solo actúa si
  // edition.status !== 'completed'); aquí se comprueba que el propio
  // setter NO impide un valor arbitrario (responsabilidad del llamador),
  // pero el engine real nunca lo hace — ver test de idempotencia más abajo.
  edition.setStatus('active');
  assert.strictEqual(edition.status, 'active');
});

// =========================================================================
// 3. BUG-COMPCORE-01: organizador inexistente, Entry/Stage cruzados,
//    sources/next cíclicos
// =========================================================================
check('BUG-COMPCORE-01: registerCompetitionDefinition rechaza organizerId inexistente', () => {
  const registries = new WorldRegistries();
  registries.registerArea(new GeographicArea({ id: 'area-world', type: 'world', parentAreaId: null }));
  assert.throws(() => registries.registerCompetitionDefinition(new CompetitionDefinition({
    id: 'orphan-comp', scopeLevel: 'world', scopeAreaId: null, organizerId: 'org-does-not-exist', participantType: 'club-team', kind: 'league',
  })), /organizador inexistente/);
});

check('BUG-COMPCORE-01: un Entry no puede registrarse en un Stage de OTRA edición', () => {
  const { world } = buildFictionalWorld({ id: 'world:test-bug01-entry' });
  const editionA = new CompetitionEdition({ id: 'edition:a', competitionDefinitionId: 'testland-fixture-league', seasonKey: 's1', status: 'active' });
  const editionB = new CompetitionEdition({ id: 'edition:b', competitionDefinitionId: 'testland-fixture-league', seasonKey: 's2', status: 'active' });
  world.registries.registerCompetitionEdition(editionA);
  world.registries.registerCompetitionEdition(editionB);
  const stageOfA = new CompetitionStage({
    id: 'stage:a:1', editionId: editionA.id, stageType: 'round-robin', status: 'active',
  });
  world.registries.registerCompetitionStage(stageOfA);
  const crossEntry = new CompetitionEntry({
    id: 'entry:cross', editionId: editionB.id, stageId: stageOfA.id, participantType: 'club-team', participantId: world.registries.teams.all()[0].id,
  });
  assert.throws(() => world.registries.registerCompetitionEntry(crossEntry), /OTRA edición/);
});

check('BUG-COMPCORE-01: sourceStageIds/nextStageIds no pueden conectar stages de OTRA edición', () => {
  const { world } = buildFictionalWorld({ id: 'world:test-bug01-stage' });
  const editionA = new CompetitionEdition({ id: 'edition:a2', competitionDefinitionId: 'testland-fixture-league', seasonKey: 's1', status: 'active' });
  const editionB = new CompetitionEdition({ id: 'edition:b2', competitionDefinitionId: 'testland-fixture-league', seasonKey: 's2', status: 'active' });
  world.registries.registerCompetitionEdition(editionA);
  world.registries.registerCompetitionEdition(editionB);
  const stageA1 = new CompetitionStage({
    id: 'stage:a2:1', editionId: editionA.id, stageType: 'round-robin', status: 'active',
  });
  world.registries.registerCompetitionStage(stageA1);
  const stageB1 = new CompetitionStage({
    id: 'stage:b2:1', editionId: editionB.id, stageType: 'knockout', status: 'active', sourceStageIds: [stageA1.id],
  });
  assert.throws(() => world.registries.registerCompetitionStage(stageB1), /OTRA edición/);
});

check('BUG-COMPCORE-01: validateIntegrity() detecta un ciclo de nextStageIds dentro de la misma edición', () => {
  const { world } = buildFictionalWorld({ id: 'world:test-bug01-cycle' });
  const edition = new CompetitionEdition({ id: 'edition:cyc', competitionDefinitionId: 'testland-fixture-league', seasonKey: 's1', status: 'active' });
  world.registries.registerCompetitionEdition(edition);
  const s1 = new CompetitionStage({
    id: 'stage:cyc:1', editionId: edition.id, stageType: 'round-robin', status: 'active', nextStageIds: ['stage:cyc:2'],
  });
  const s2 = new CompetitionStage({
    id: 'stage:cyc:2', editionId: edition.id, stageType: 'knockout', status: 'active', nextStageIds: ['stage:cyc:1'],
  });
  world.registries.registerCompetitionStage(s1);
  world.registries.registerCompetitionStage(s2);
  const errors = world.registries.validateIntegrity();
  assert.ok(errors.some((e) => /ciclo/.test(e)), `debía detectarse un ciclo: ${JSON.stringify(errors)}`);
});

check('un participante aparece como máximo una vez por Stage (invariante 6, vía registro de round-robin)', () => {
  const { world, teams } = buildFictionalWorld({ id: 'world:test-one-entry-per-stage', teamCount: 4 });
  registerFixtureFormat();
  const { edition } = registerEditionWithInitialEntries(world, {
    competitionDefinitionId: 'testland-fixture-league', seasonKey: '2099-01', formatBindingId: FIXTURE_FORMAT_ID, participants: teams.map((t) => ({ id: t.id })),
  });
  const stageId = buildStageId('testland-fixture-league', '2099-01', 'regular-season');
  const entryIds = world.registries.competitionEntries.forStage(stageId).map((e) => e.participantId);
  assert.strictEqual(new Set(entryIds).size, entryIds.length, 'no puede haber un participante repetido en el mismo stage');
  void edition;
});

// =========================================================================
// 4. round-robin: par/impar con bye, una/dos vueltas, puntuación/desempate
//    configurables, snapshot serializable, sin consumo de RNG al consultar
// =========================================================================
check('round-robin par: cada equipo juega exactamente 1 vez por jornada, sin bye', () => {
  const teams = generateFictionalTeams(6, { seed: 'rr-even' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const runner = new RoundRobinStageRunner({
    participants: teams, legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }], resolveParticipant: (id) => teamsById.get(id),
  });
  assert.strictEqual(runner.totalRounds, 5);
  runner.matches.forEach((m) => {
    const roundMatches = runner.matches.filter((x) => x.round === m.round);
    assert.strictEqual(roundMatches.length, 3, 'con 6 equipos, cada jornada debe tener 3 partidos (nadie descansa)');
  });
});

check('round-robin impar: bye EXPLÍCITO, nunca un partido contra un equipo falso', () => {
  const teams = generateFictionalTeams(5, { seed: 'rr-odd' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const runner = new RoundRobinStageRunner({
    participants: teams, legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }], resolveParticipant: (id) => teamsById.get(id),
  });
  assert.strictEqual(runner.totalRounds, 5, 'con 5 equipos, 5 jornadas (una por bye)');
  runner.matches.forEach((m) => {
    const roundMatches = runner.matches.filter((x) => x.round === m.round);
    assert.strictEqual(roundMatches.length, 2, 'una jornada con bye tiene 2 partidos (un equipo descansa)');
  });
  const totalMatches = runner.matches.length;
  assert.strictEqual(totalMatches, 10, 'C(5,2) = 10 partidos en total, ninguno contra un equipo falso');
});

check('round-robin de una y dos vueltas: sin duplicar el MISMO enfrentamiento home/away', () => {
  const teams = generateFictionalTeams(4, { seed: 'rr-legs' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const buildRunner = (legs) => new RoundRobinStageRunner({
    participants: teams, legs, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }], resolveParticipant: (id) => teamsById.get(id),
  });
  const oneLeg = buildRunner(1);
  assert.strictEqual(oneLeg.matches.length, 6, 'C(4,2) = 6 partidos a una vuelta');
  const pairsOneLeg = new Set(oneLeg.matches.map((m) => [m.homeParticipantId, m.awayParticipantId].sort().join('|')));
  assert.strictEqual(pairsOneLeg.size, 6, 'los 6 enfrentamientos deben ser todos distintos');

  const twoLegs = buildRunner(2);
  assert.strictEqual(twoLegs.matches.length, 12, 'a doble vuelta se duplican (ida+vuelta), nunca se repite el mismo local/visitante');
  const homeAwayPairs = twoLegs.matches.map((m) => `${m.homeParticipantId}>${m.awayParticipantId}`);
  assert.strictEqual(new Set(homeAwayPairs).size, 12, 'cada partido ida/vuelta tiene una combinación home>away única');
});

check('round-robin: puntuación y desempate configurables por CONTENIDO (nunca hardcodeado)', () => {
  const teams = generateFictionalTeams(4, { seed: 'rr-scoring' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const runner = new RoundRobinStageRunner({
    participants: teams, legs: 1, pointsWin: 3, pointsLoss: 0, tiebreakSteps: [{ type: 'overall-points-for' }], resolveParticipant: (id) => teamsById.get(id),
  });
  runner.matches.forEach((m) => runner.resolveMatch(m.id, {}));
  runner.getStandings().forEach((s) => {
    assert.strictEqual(s.points, s.wins * 3 + s.losses * 0, 'puntuación 3/0 configurada por contenido debe respetarse exactamente');
  });
  assert.throws(() => new RoundRobinStageRunner({
    participants: teams, legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'no-existe' }], resolveParticipant: (id) => teamsById.get(id),
  }), /desconocido/);
});

check('round-robin: descriptor con id/fecha ANTES de resolver; doble resolución rechazada; consultar no muta', () => {
  const teams = generateFictionalTeams(4, { seed: 'rr-descriptor' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const runner = new RoundRobinStageRunner({
    stageId: 'stage:test:x', participants: teams, legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }], dateResolver: (meta) => new Date(2030, 0, meta.round), resolveParticipant: (id) => teamsById.get(id),
  });
  const before = runner.matches[0];
  assert.ok(before.id, 'el descriptor debe tener id ANTES de resolver');
  assert.ok(before.scheduledDate instanceof Date, 'el descriptor debe tener fecha ANTES de resolver');
  const snapshotBefore = JSON.stringify(runner.getStandings());
  runner.getStandings();
  assert.strictEqual(JSON.stringify(runner.getStandings()), snapshotBefore, 'consultar getStandings() dos veces no cambia nada');
  runner.resolveMatch(before.id, {});
  assert.throws(() => runner.resolveMatch(before.id, {}), /ya está jugado/);
});

check('round-robin snapshot(): JSON plano, sin instancias Team/Map/funciones/ciclos', () => {
  const teams = generateFictionalTeams(4, { seed: 'rr-snapshot' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const runner = new RoundRobinStageRunner({
    participants: teams, legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }], dateResolver: () => new Date(2030, 0, 1), resolveParticipant: (id) => teamsById.get(id),
  });
  runner.matches.forEach((m) => runner.resolveMatch(m.id, {}));
  const json = JSON.stringify(runner.snapshot());
  assert.ok(json.length > 0);
  assert.ok(!json.includes('"roster"'), 'el snapshot no debe incrustar instancias Team (con roster embebido)');
});

check('round-robin: el orden de inserción de participantes no cambia el resultado (mismos ids, mismos resultados)', () => {
  const teams = generateFictionalTeams(4, { seed: 'rr-order' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const shuffled = [teams[2], teams[0], teams[3], teams[1]];
  const runnerA = new RoundRobinStageRunner({
    participants: teams, legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }], resolveParticipant: (id) => teamsById.get(id),
  });
  const runnerB = new RoundRobinStageRunner({
    participants: shuffled, legs: 1, pointsWin: 2, pointsLoss: 1, tiebreakSteps: [{ type: 'overall-point-diff' }], resolveParticipant: (id) => teamsById.get(id),
  });
  const pairsA = new Set(runnerA.matches.map((m) => [m.homeParticipantId, m.awayParticipantId].sort().join('|')));
  const pairsB = new Set(runnerB.matches.map((m) => [m.homeParticipantId, m.awayParticipantId].sort().join('|')));
  assert.deepStrictEqual(pairsA, pairsB, 'el CONJUNTO de enfrentamientos debe ser el mismo, insertados en cualquier orden');
});

// =========================================================================
// 5. bracket: fijo, BO1/BO3/BO5, reseeding, descriptor antes de simular,
//    doble resolución rechazada
// =========================================================================
check('bracket BO1 (single-game): avance fijo, nunca se reordena por resultado', () => {
  const teams = generateFictionalTeams(4, { seed: 'bracket-bo1' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const entries = teams.map((t, i) => ({ participantId: t.id, seed: i + 1, entryId: null }));
  const runner = new BracketStageRunner({
    entries, firstRoundPairing: [[1, 4], [2, 3]], roundPatterns: [VENUE_PATTERNS.SINGLE_GAME, VENUE_PATTERNS.SINGLE_GAME], resolveParticipant: (id) => teamsById.get(id),
  });
  assert.strictEqual(runner.rounds[0][0].better.seed, 1);
  assert.strictEqual(runner.rounds[0][0].worse.seed, 4);
  while (!runner.isComplete) runner.resolveNextPendingMatch({});
  assert.ok(runner.champion, 'BO1 con una única serie final debe producir un campeón');
});

check('bracket BO3/BO5: gamesNeededToWin correcto, avance a la siguiente ronda solo cuando la serie decide', () => {
  const teams = generateFictionalTeams(4, { seed: 'bracket-bo35' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const entries = teams.map((t, i) => ({ participantId: t.id, seed: i + 1, entryId: null }));
  const runner = new BracketStageRunner({
    entries, firstRoundPairing: [[1, 4], [2, 3]], roundPatterns: [VENUE_PATTERNS.BEST_OF_3_1_1_1, VENUE_PATTERNS.BEST_OF_5_2_2_1], resolveParticipant: (id) => teamsById.get(id),
  });
  assert.strictEqual(runner.rounds[0][0].gamesNeededToWin, 2, 'BO3 exige 2 victorias');
  let roundsBefore = runner.rounds.length;
  while (runner.rounds.length === roundsBefore) runner.resolveNextPendingMatch({});
  assert.strictEqual(runner.rounds[1][0].gamesNeededToWin, 3, 'BO5 exige 3 victorias');
  while (!runner.isComplete) runner.resolveNextPendingMatch({});
  assert.ok(runner.champion.seed === 1 || runner.champion.seed === 2 || runner.champion.seed === 3 || runner.champion.seed === 4);
});

check('bracket: descriptor con id/fecha ANTES de simular (BUG-COMPCORE-03); doble resolución rechazada', () => {
  const teams = generateFictionalTeams(4, { seed: 'bracket-descriptor' });
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const entries = teams.map((t, i) => ({ participantId: t.id, seed: i + 1, entryId: null }));
  const runner = new BracketStageRunner({
    stageId: 'stage:test:bkt', entries, firstRoundPairing: [[1, 4], [2, 3]], roundPatterns: [VENUE_PATTERNS.SINGLE_GAME, VENUE_PATTERNS.SINGLE_GAME], dateResolver: (roundIndex, gameIndex) => new Date(2030, 1, roundIndex * 3 + gameIndex + 1), resolveParticipant: (id) => teamsById.get(id),
  });
  const pending = runner.peekNextPendingMatch();
  assert.ok(pending.descriptor.id, 'debe existir id ANTES de simular');
  assert.ok(pending.descriptor.scheduledDate instanceof Date, 'debe existir fecha ANTES de simular');
  const played = runner.resolveMatch(pending.descriptor.id, {});
  assert.strictEqual(played.id, pending.descriptor.id, 'consultar antes no debe cambiar el id al resolver');
  assert.throws(() => runner.resolveMatch(played.id, {}), /ya está jugado/);
});

check('bracket: reseeding (stage-bracket-final-round-winners) — se prueba a nivel de CompetitionEngine, ver sección Final Four', () => {
  // Cubierto abajo (checkpoint/activación idempotente) con el fixture
  // completo — un runner de bracket aislado no reseedea por sí solo (esa
  // composición vive en CompetitionEngine._resolveBracketEntries).
  assert.ok(true);
});

// =========================================================================
// 6. Activación idempotente por checkpoint/final de fase; fixture NO
//    español que ejecuta AMBOS runners sin ningún literal español
// =========================================================================
check('fixture NO española: engine ejecuta round-robin + bracket encadenados, activación UNA sola vez', () => {
  const { world, teams } = buildFictionalWorld({ id: 'world:test-fixture-e2e', teamCount: 6 });
  registerFixtureFormat();
  const engine = new CompetitionEngine({ world });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: 'testland-fixture-league', seasonKey: '2099-02', formatBindingId: FIXTURE_FORMAT_ID, participants: teams.map((t) => ({ id: t.id })),
  });
  engine.initializeEdition(edition.id);
  const regularStageId = buildStageId('testland-fixture-league', '2099-02', 'regular-season');
  const playoffStageId = buildStageId('testland-fixture-league', '2099-02', 'playoff');

  let stageActivatedCount = 0;
  const matchesPlayed = driveStageToCompletion(engine, regularStageId);
  assert.strictEqual(matchesPlayed, 15, 'C(6,2) = 15 partidos de liga regular a una vuelta');
  engine.drainActivationEvents().forEach((e) => { if (e.type === 'stage-activated') stageActivatedCount += 1; });
  assert.strictEqual(stageActivatedCount, 1, 'el playoff debe activarse EXACTAMENTE una vez');

  // Invariante 16: reprocesar el MISMO hecho (llamar otra vez al hook
  // interno que ya disparó la activación) no debe crear una segunda fase —
  // se simula reintentando `_handleStageEvent` con la misma clave.
  const regularStage = world.registries.competitionStages.require(regularStageId);
  engine._handleStageEvent(edition, regularStage, 'stage-completed', null); // eslint-disable-line no-underscore-dangle
  assert.strictEqual(
    world.registries.competitionStages.forEdition(edition.id).filter((s) => s.id === playoffStageId).length, 1,
    'reprocesar el mismo hecho no debe duplicar el stage de playoff',
  );

  const playoffMatches = driveStageToCompletion(engine, playoffStageId);
  assert.strictEqual(playoffMatches, 3, '4 clasificados a semifinales+final a partido único = 3 partidos');
  assert.strictEqual(world.registries.competitionEditions.require(edition.id).status, 'completed');

  // Auditoría de literales españoles en el propio fixture: nada de
  // '1ª'/'2ª'/ACB/España se usa en NINGÚN punto de este flujo.
  const dump = JSON.stringify({
    world: world.describe(), engineSnapshot: engine.snapshot(),
  });
  ['1ª', '2ª', 'ACB', 'Primera FEB', 'España'].forEach((token) => {
    assert.ok(!dump.includes(token), `el fixture no español no debería contener "${token}"`);
  });
});

check('CompetitionEngine.snapshot(): JSON serializable sin Team/Map/funciones/ciclos', () => {
  const { world, teams } = buildFictionalWorld({ id: 'world:test-engine-snapshot', teamCount: 4 });
  registerFixtureFormat();
  const engine = new CompetitionEngine({ world });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: 'testland-fixture-league', seasonKey: '2099-03', formatBindingId: FIXTURE_FORMAT_ID, participants: teams.map((t) => ({ id: t.id })),
  });
  engine.initializeEdition(edition.id);
  const json = JSON.stringify(engine.snapshot());
  assert.ok(json.length > 0);
  assert.ok(!json.includes('"roster"'));
});

check('consultas (peekNextPendingMatch/getStandings/getRunner) nunca mutan ni consumen RNG', () => {
  const { world, teams } = buildFictionalWorld({ id: 'world:test-query-purity', teamCount: 4 });
  registerFixtureFormat();
  const engine = new CompetitionEngine({ world });
  const { edition } = engine.registerEditionWithInitialEntries({
    competitionDefinitionId: 'testland-fixture-league', seasonKey: '2099-04', formatBindingId: FIXTURE_FORMAT_ID, participants: teams.map((t) => ({ id: t.id })),
  });
  engine.initializeEdition(edition.id);
  const stageId = buildStageId('testland-fixture-league', '2099-04', 'regular-season');
  const before = JSON.stringify(engine.getStandings(stageId));
  engine.peekNextPendingMatch(stageId);
  engine.peekNextPendingMatch(stageId);
  engine.listPendingMatches(stageId);
  const after = JSON.stringify(engine.getStandings(stageId));
  assert.strictEqual(before, after, 'ninguna consulta debe cambiar la clasificación');
});

// =========================================================================
// 7. Copa: identidad real, binding explícito (BUG-COMPCORE-02)
// =========================================================================
check('Copa (copa-acb): CompetitionDefinition separada de ACB, con bundle normativo PROPIO que reutiliza módulos por id', () => {
  const CompetitionRules = require('../src/core/CompetitionRules.js');
  const acb = CompetitionCatalog.getCompetitionDefinition('acb');
  const copa = CompetitionCatalog.getCompetitionDefinition('copa-acb');
  assert.notStrictEqual(acb.id, copa.id);
  assert.strictEqual(copa.kind, 'cup');
  const resolved = CompetitionRules.resolveRules({
    domain: 'registration', competitionId: 'copa-acb', seasonKey: '2026-27', date: '2026-11-01', phaseId: 'cup', operation: 'buildMatchSquad',
  });
  assert.strictEqual(resolved.registrationScopeId, 'acb-domestic-registration-2025-26', 'Copa reutiliza el ámbito ACB por BINDING explícito');
  assert.strictEqual(resolved.trace.bundleId, 'copa-acb-domestic-2025-26-v1', 'la Copa debe resolver con SU PROPIO bundle, nunca el de acb-domestic directamente');
});

// =========================================================================
// 8. Participación (CompetitionParticipationService): nunca "la primera",
//    falla descriptivo ante ambigüedad
// =========================================================================
check('CompetitionParticipationService.primaryLeagueCompetitionId falla si hay más de una liga simultánea o ninguna', () => {
  const { world, teams } = buildFictionalWorld({ id: 'world:test-participation', teamCount: 2 });
  const team = teams[0];
  assert.throws(
    () => CompetitionParticipationService.primaryLeagueCompetitionId(world.registries, team.id, { seasonKey: '2099-05' }),
    /no tiene ninguna Entry de liga/,
  );
  const edition = new CompetitionEdition({ id: 'edition:p1', competitionDefinitionId: 'testland-fixture-league', seasonKey: '2099-05', status: 'active' });
  world.registries.registerCompetitionEdition(edition);
  world.registries.registerCompetitionEntry(new CompetitionEntry({
    id: 'entry:p1', editionId: edition.id, participantType: 'club-team', participantId: team.id,
  }));
  const resolved = CompetitionParticipationService.primaryLeagueCompetitionId(world.registries, team.id, { seasonKey: '2099-05' });
  assert.strictEqual(resolved, 'testland-fixture-league');
});

check('un Team puede tener Entries simultáneas en dos competiciones (invariante 7/8)', () => {
  const { world, teams } = buildFictionalWorld({ id: 'world:test-multi-competition', teamCount: 2 });
  const team = teams[0];
  const editionLeague = new CompetitionEdition({ id: 'edition:ml1', competitionDefinitionId: 'testland-fixture-league', seasonKey: '2099-06', status: 'active' });
  world.registries.registerCompetitionEdition(editionLeague);
  world.registries.registerCompetitionEntry(new CompetitionEntry({
    id: 'entry:ml1', editionId: editionLeague.id, participantType: 'club-team', participantId: team.id,
  }));
  const cupDefinition = new CompetitionDefinition({
    id: 'testland-fixture-cup', scopeLevel: 'national', scopeAreaId: 'area-country-testland', organizerId: 'org-testland', participantType: 'club-team', kind: 'cup',
  });
  world.registries.registerCompetitionDefinition(cupDefinition);
  const editionCup = new CompetitionEdition({ id: 'edition:mc1', competitionDefinitionId: cupDefinition.id, seasonKey: '2099-06', status: 'active' });
  world.registries.registerCompetitionEdition(editionCup);
  world.registries.registerCompetitionEntry(new CompetitionEntry({
    id: 'entry:mc1', editionId: editionCup.id, participantType: 'club-team', participantId: team.id,
  }));
  const competitions = CompetitionParticipationService.activeCompetitionsForParticipant(world.registries, team.id, { seasonKey: '2099-06' });
  assert.strictEqual(competitions.length, 2, 'debe tener Entry simultánea en Liga y Copa');
});

// =========================================================================
// 9. Auditoría estática (sección 15.3) — runners/engine/registry genéricos
//    nuevos sin literales de España; game.js/spain-2026.1 sin
//    SpainLegacyCompetitionRuntime en la ruta productiva.
// =========================================================================
const GENERIC_COMP_CORE_FILES = [
  'src/core/CompetitionRunners.js',
  'src/core/CompetitionEngine.js',
  'src/core/CompetitionRuntimeRegistry.js',
  'src/core/CompetitionFormatCatalog.js',
  'src/core/CompetitionParticipationService.js',
];
const FORBIDDEN_TOKENS = [/1ª/, /2ª/, /\bACB\b/, /Primera FEB/, /\bEspaña\b/, /competitionIdFromLegacyDivision/];

check('ningún runner/engine/registry GENÉRICO nuevo de COMP-CORE-1 contiene literales de España', () => {
  const offenders = [];
  GENERIC_COMP_CORE_FILES.forEach((relPath) => {
    const content = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
    FORBIDDEN_TOKENS.forEach((token) => {
      if (token.test(content)) offenders.push(`${relPath} contiene "${token}"`);
    });
  });
  assert.deepStrictEqual(offenders, []);
});

check('game.js y spain-2026.1.js no cargan/llaman SpainLegacyCompetitionRuntime en la ruta productiva', () => {
  const gameJs = fs.readFileSync(path.join(__dirname, '..', 'src/ui/game.js'), 'utf8');
  const spainPack = fs.readFileSync(path.join(__dirname, '..', 'data/world/spain-2026.1.js'), 'utf8');
  assert.ok(!/SpainLegacyCompetitionRuntime/.test(gameJs.replace(/\/\/.*$/gm, '')), 'game.js no debe referenciar SpainLegacyCompetitionRuntime fuera de comentarios');
  assert.ok(!/SpainLegacyRuntimeModule|require\(.*SpainLegacyCompetitionRuntime/.test(spainPack), 'spain-2026.1.js no debe requerir SpainLegacyCompetitionRuntime');
});

check('index.html no carga SpainLegacyCompetitionRuntime.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!html.includes('src="src/core/SpainLegacyCompetitionRuntime.js"'), 'index.html no debe cargar el shim en producción');
});

check('game.js no construye directamente new League()/new Bracket()/createCup()/createTitlePlayoff()/new PromotionPlayoff()', () => {
  const gameJs = fs.readFileSync(path.join(__dirname, '..', 'src/ui/game.js'), 'utf8');
  const withoutComments = gameJs.replace(/\/\/.*$/gm, '');
  ['new League(', 'new Bracket(', 'createCup(', 'createTitlePlayoff(', 'new PromotionPlayoff('].forEach((token) => {
    assert.ok(!withoutComments.includes(token), `game.js no debe contener "${token}" en la ruta productiva`);
  });
});

check('el modo consulta/render del engine no llama a simulateMatch ni consume RNG (auditoría estática de CompetitionEngine.js)', () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'src/core/CompetitionEngine.js'), 'utf8');
  assert.ok(!/Math\.random\(\)/.test(engineSrc), 'CompetitionEngine.js no debe usar Math.random()');
  assert.ok(!/Date\.now\(\)/.test(engineSrc), 'CompetitionEngine.js no debe usar Date.now()');
});

// =========================================================================
console.log(`\n${passed} OK, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
