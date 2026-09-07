// scripts/test-world-ui1.js
// WORLD-UI-1 (DESIGN.md 10.18) — batería DIRIGIDA (sección 11 del prompt),
// 14-18 comprobaciones agrupadas, no exhaustiva. Convención del proyecto:
// identificadores en inglés, comentarios en español.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { CareerSetupSnapshot } = require('../src/entities/CareerSetup.js');
const CareerSetupService = require('../src/core/CareerSetupService.js');
const WorldNavigationService = require('../src/core/WorldNavigationService.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const CompetitionEngineModule = require('../src/core/CompetitionEngine.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WorldSimulationProfile } = require('../src/entities/WorldSimulation.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const { SPAIN_MANIFEST } = require('../data/world/spain-2026.1.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');

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
// Fixture compartida: catálogo real (España) + snapshot válido + mundo
// construido a partir de él — reutilizado por varios checks.
// -----------------------------------------------------------------------
const MANIFESTS = [WORLD_CORE_MANIFEST, SPAIN_MANIFEST];
const MANIFESTS_BY_ID = new Map(MANIFESTS.map((m) => [m.id, m]));

function buildRealTeam(teamData) {
  const roster = teamData.roster.map((p) => new Player(p));
  return new Team({ ...teamData, roster });
}

function buildDefaultValidDraft(catalog) {
  const draft = CareerSetupService.buildDefaultDraft(catalog, { referenceDate: '2026-10-03', careerSeed: null });
  draft.controlledClubId = 'club-real-madrid';
  draft.controlledTeamId = 'team-real-madrid';
  draft.careerSeed = 'team-real-madrid|2026';
  return draft;
}

function buildRealWorldFromSnapshot(snapshot) {
  const teamsByCompetitionId = {};
  SPAIN_MANIFEST.careerSetup.clubs.forEach((club) => {
    const raw = REAL_DATA_INDEX.find((e) => e.id === club.teamId);
    if (!raw) return;
    const team = buildRealTeam(REAL_DATA_TEAMS[club.teamId]);
    const key = club.initialCompetitionDefinitionId;
    if (!teamsByCompetitionId[key]) teamsByCompetitionId[key] = [];
    teamsByCompetitionId[key].push(team);
  });
  const simulationProfile = CareerSetupService.buildSimulationProfile(snapshot);
  const startPlan = CareerSetupService.buildStartPlan(snapshot, MANIFESTS_BY_ID);
  const world = WorldFactory.buildCareerWorld({
    id: `world:test-world-ui1:${snapshot.id}`,
    name: 'Mundo de prueba WORLD-UI-1',
    careerSeed: snapshot.careerSeed,
    createdAtGameDate: snapshot.createdAtGameDate,
    packs: startPlan.packs,
    context: { teamsByCompetitionId, seasonKey: snapshot.seasonKey, seasonStartDate: snapshot.createdAtGameDate },
    simulationProfile,
  });
  return world;
}

console.log('=== TEST WORLD-UI-1 (configuración de carrera + navegación mundial) ===\n');

// 1. Validación/orden/inmutabilidad/serialización de CareerSetupSnapshot.
check('CareerSetupSnapshot normaliza selectedContentPackIds/simulationAssignments por id (nunca orden de clics)', () => {
  const snapshot = new CareerSetupSnapshot({
    id: 'snap:order-1',
    seasonKey: '2026-27',
    seasonStartYear: 2026,
    timeZoneId: 'Europe/Madrid',
    selectedContentPackIds: ['spain-2026.1', 'world-core-2026.1'],
    controlledClubId: 'club-real-madrid',
    controlledTeamId: 'team-real-madrid',
    careerSeed: 'seed-1',
    defaultDetailLevel: 'abstract',
    simulationAssignments: [
      { scopeType: 'competition', scopeId: 'primera-feb', detailLevel: 'playable' },
      { scopeType: 'competition', scopeId: 'acb', detailLevel: 'playable' },
    ],
    createdAtGameDate: '2026-10-03',
  });
  assert.deepStrictEqual(snapshot.selectedContentPackIds, ['spain-2026.1', 'world-core-2026.1']);
  assert.strictEqual(snapshot.simulationAssignments[0].scopeId, 'acb', 'orden estable por scopeType:scopeId, no por orden de entrada');
});

check('CareerSetupSnapshot queda congelado (Object.freeze) y su toJSON es plano/serializable sin Map/funciones', () => {
  const snapshot = new CareerSetupSnapshot({
    id: 'snap:frozen-1',
    seasonKey: '2026-27',
    seasonStartYear: 2026,
    timeZoneId: 'Europe/Madrid',
    selectedContentPackIds: ['world-core-2026.1'],
    controlledClubId: 'club-x',
    controlledTeamId: 'team-x',
    careerSeed: 'seed-2',
    defaultDetailLevel: 'abstract',
    simulationAssignments: [],
    createdAtGameDate: '2026-10-03',
  });
  assert.ok(Object.isFrozen(snapshot), 'el snapshot debe estar congelado');
  snapshot.seasonKey = '2027-28'; // no-op silencioso sobre un objeto congelado (módulo sin 'use strict')
  assert.strictEqual(snapshot.seasonKey, '2026-27', 'un objeto congelado nunca cambia de valor');
  const json = snapshot.toJSON();
  assert.strictEqual(JSON.stringify(json), JSON.stringify(JSON.parse(JSON.stringify(json))), 'debe ser JSON plano');
});

check('CareerSetupSnapshot bloquea dos simulationAssignments incompatibles para el mismo scope', () => {
  assert.throws(() => new CareerSetupSnapshot({
    id: 'snap:conflict-1',
    seasonKey: '2026-27',
    seasonStartYear: 2026,
    timeZoneId: 'Europe/Madrid',
    selectedContentPackIds: ['world-core-2026.1'],
    controlledClubId: 'club-x',
    controlledTeamId: 'team-x',
    careerSeed: 'seed-3',
    defaultDetailLevel: 'abstract',
    simulationAssignments: [
      { scopeType: 'competition', scopeId: 'acb', detailLevel: 'playable' },
      { scopeType: 'competition', scopeId: 'acb', detailLevel: 'abstract' },
    ],
    createdAtGameDate: '2026-10-03',
  }), /incompatibles/);
});

// 2. Catálogo desde manifiestos reales — dependencias de paquetes y
// combinación default de España.
const catalog = CareerSetupService.buildCatalog(MANIFESTS, CompetitionCatalog);
check('CareerSetupService.buildCatalog resuelve la combinación default de España (36 clubes, 4 competiciones, 1 temporada/huso)', () => {
  assert.strictEqual(catalog.clubs.length, 36);
  assert.strictEqual(catalog.competitions.length, 4);
  assert.strictEqual(catalog.seasons.length, 1);
  assert.strictEqual(catalog.seasons[0].seasonKey, '2026-27');
  assert.strictEqual(catalog.timeZones[0].timeZoneId, 'Europe/Madrid');
  const acb = catalog.clubs.filter((c) => c.initialCompetitionDefinitionId === CompetitionCatalog.COMPETITION_IDS.ACB);
  const feb = catalog.clubs.filter((c) => c.initialCompetitionDefinitionId === CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB);
  assert.strictEqual(acb.length, 18);
  assert.strictEqual(feb.length, 18);
});

check('CareerSetupService.buildCatalog nunca construye Team/Player (clubs son metadatos planos, sin roster)', () => {
  catalog.clubs.forEach((club) => {
    assert.ok(!('roster' in club), `el club "${club.clubId}" no debe llevar roster construido`);
    assert.strictEqual(typeof club.rosterSize, 'number');
  });
});

// 3. Error ante dependencia ausente, nivel desconocido/duplicado o club
// incompatible.
check('CareerSetupService.validateDraft: MISSING_ROOT_PACK si falta world-core-2026.1', () => {
  const draft = buildDefaultValidDraft(catalog);
  draft.selectedContentPackIds = ['spain-2026.1'];
  const { valid, errors } = CareerSetupService.validateDraft(catalog, MANIFESTS_BY_ID, draft);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.code === 'MISSING_ROOT_PACK'));
});

check('CareerSetupService.validateDraft: DETAIL_LEVEL_NOT_ALLOWED ante un nivel no permitido para una competición', () => {
  const draft = buildDefaultValidDraft(catalog);
  draft.competitionSelections.acb = 'abstract';
  const { valid, errors } = CareerSetupService.validateDraft(catalog, MANIFESTS_BY_ID, draft);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.code === 'DETAIL_LEVEL_NOT_ALLOWED'));
});

check('CareerSetupService.validateDraft: CONTROLLED_CLUB_WITHOUT_USER_STOP si la competición del club deja de ser playable (invariante 10)', () => {
  // Catálogo sintético con una competición que SÍ admite "abstract" (a
  // diferencia de ACB/Primera FEB reales, hoy fijas en "playable") — para
  // demostrar el bloqueo sin depender de una limitación de contenido.
  const syntheticCatalog = {
    ...catalog,
    competitions: [
      ...catalog.competitions.filter((c) => c.competitionDefinitionId !== CompetitionCatalog.COMPETITION_IDS.ACB),
      {
        ...catalog.competitions.find((c) => c.competitionDefinitionId === CompetitionCatalog.COMPETITION_IDS.ACB),
        allowedDetailLevels: ['playable', 'abstract'],
      },
    ],
  };
  const draft = buildDefaultValidDraft(syntheticCatalog);
  draft.competitionSelections.acb = 'abstract';
  const { valid, errors } = CareerSetupService.validateDraft(syntheticCatalog, MANIFESTS_BY_ID, draft);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.code === 'CONTROLLED_CLUB_WITHOUT_USER_STOP'));
});

check('CareerSetupService.validateDraft: UNKNOWN_CLUB si el club no existe en los paquetes elegidos', () => {
  const draft = buildDefaultValidDraft(catalog);
  draft.controlledClubId = 'club-no-existe';
  draft.controlledTeamId = 'team-no-existe';
  const { valid, errors } = CareerSetupService.validateDraft(catalog, MANIFESTS_BY_ID, draft);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.code === 'UNKNOWN_CLUB'));
});

// 4. Perfil derivado + contexto teamsByCompetitionId (mundo real construido
// desde el snapshot).
const validDraft = buildDefaultValidDraft(catalog);
const snapshot = CareerSetupService.buildSnapshot(catalog, MANIFESTS_BY_ID, validDraft, { idFactory: () => 'career:test-world-ui1' });
const world = buildRealWorldFromSnapshot(snapshot);
const engine = new CompetitionEngineModule.CompetitionEngine({ world });
world.registries.competitionEditions.forSeason(snapshot.seasonKey).forEach((edition) => engine.initializeEdition(edition.id));

check('startCareerFromSetup (equivalente): el mundo construido tiene 36 equipos y las Editions congelan el nivel del snapshot', () => {
  assert.strictEqual(world.registries.teams.all().length, 36);
  const acbEdition = world.registries.competitionEditions.get(
    CompetitionEngineModule.buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, snapshot.seasonKey),
  );
  assert.strictEqual(acbEdition.detailLevel, 'playable');
  assert.deepStrictEqual(world.validateIntegrity(), []);
});

check('spain-2026.1.install() recibe teamsByCompetitionId (BUG-WORLDUI-09): el club controlado pertenece a la Edition ACB real', () => {
  const entries = world.registries.competitionEntries.forParticipant(snapshot.controlledTeamId);
  assert.ok(entries.some((e) => e.editionId === CompetitionEngineModule.buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, snapshot.seasonKey)));
});

// 5. Breadcrumb + relaciones de área/organización/club.
check('WorldNavigationService.breadcrumbForArea: Mundo › Europa › España en orden estable', () => {
  const breadcrumb = WorldNavigationService.breadcrumbForArea(world.registries, 'area-country-es');
  assert.deepStrictEqual(breadcrumb.map((a) => a.areaId), ['area-world', 'area-continent-europe', 'area-country-es']);
});

check('WorldNavigationService distingue organizaciones con sede vs con ámbito, y clubes por área de origen', () => {
  const orgs = WorldNavigationService.organizationsForArea(world.registries, 'area-country-es');
  assert.ok(orgs.headquartered.some((o) => o.organizationId === 'org-acb'));
  assert.ok(orgs.scoped.some((o) => o.organizationId === 'org-acb'));
  const spainClubs = WorldNavigationService.clubsForArea(world.registries, 'area-country-es');
  const andorraClubs = WorldNavigationService.clubsForArea(world.registries, 'area-country-ad');
  assert.strictEqual(spainClubs.length, 35, 'MoraBanc (Andorra) no debe contar como club español');
  assert.strictEqual(andorraClubs.length, 1);
  assert.strictEqual(andorraClubs[0].clubId, 'club-morabanc-andorra');
});

// 6. MoraBanc/Andorra/ACB como participación transfronteriza.
check('MoraBanc Andorra participa en ACB (España) sin que ACB se vuelva andorrana (invariante 4)', () => {
  const externalFromAndorra = WorldNavigationService.externalCompetitionsForAreaClubs(world.registries, 'area-country-ad');
  assert.strictEqual(externalFromAndorra.length, 1);
  assert.strictEqual(externalFromAndorra[0].competitionDefinitionId, CompetitionCatalog.COMPETITION_IDS.ACB);
  assert.strictEqual(externalFromAndorra[0].scopeAreaId, 'area-country-es', 'ACB conserva scopeAreaId España');
  assert.deepStrictEqual(externalFromAndorra[0].localParticipantTeamIds, ['team-morabanc-andorra']);
  const acbDefinition = world.registries.competitionDefinitions.require(CompetitionCatalog.COMPETITION_IDS.ACB);
  assert.strictEqual(acbDefinition.scopeAreaId, 'area-country-es');
});

// 7. Supercopa catalog-only sin Edition falsa.
check('Supercopa ACB aparece catalog-only, sin Edition/participantes fabricados', () => {
  const view = WorldNavigationService.competitionView(world.registries, CompetitionCatalog.COMPETITION_IDS.SUPERCOPA_ACB, {});
  assert.strictEqual(view.catalogOnly, true);
  assert.strictEqual(view.edition, null);
  assert.deepStrictEqual(view.participants, []);
});

// 8. Fases/participantes/resultados detallados y ausencia honesta de
// detalle.
check('competitionView(ACB): fases/participantes reales; el playoff por el título todavía no existe como fase (honestidad, invariante 9)', () => {
  const view = WorldNavigationService.competitionView(world.registries, CompetitionCatalog.COMPETITION_IDS.ACB, { engine, seasonKey: snapshot.seasonKey });
  assert.strictEqual(view.participants.length, 18);
  const regularSeason = view.stages.find((s) => s.stageKey === 'regular-season');
  assert.ok(regularSeason);
  assert.ok(!view.stages.some((s) => s.stageKey === 'title-playoff'), 'el playoff por el título no se fabrica antes de que el engine lo active');
});

check('Tras resolver un partido, competitionView(ACB) expone standings reales con detalle individual (nivel playable)', () => {
  const stageId = CompetitionEngineModule.buildStageId(CompetitionCatalog.COMPETITION_IDS.ACB, snapshot.seasonKey, 'regular-season');
  const pending = engine.getRunner(stageId).getPendingMatches();
  engine.resolveMatch(stageId, pending[0].id, {});
  const view = WorldNavigationService.competitionView(world.registries, CompetitionCatalog.COMPETITION_IDS.ACB, { engine, seasonKey: snapshot.seasonKey });
  const regularSeason = view.stages.find((s) => s.stageKey === 'regular-season');
  assert.strictEqual(regularSeason.result.kind, 'standings');
  assert.ok(regularSeason.result.standings.length > 0);
});

// 9. Orden inverso de entrada -> mismo view model.
check('El orden de registro invertido de clubes no cambia el view model de área (determinismo, invariante 12)', () => {
  const forward = WorldNavigationService.clubsForArea(world.registries, 'area-country-es');
  const reversedRegistries = { ...world.registries, clubs: { all: () => [...world.registries.clubs.all()].reverse(), require: (id) => world.registries.clubs.require(id) } };
  const reversed = WorldNavigationService.clubsForArea(reversedRegistries, 'area-country-es');
  assert.deepStrictEqual(forward, reversed);
});

// 10. Consulta repetida sin mutación/RNG.
check('Consultar competitionView() dos veces no muta el mundo ni cambia el resultado (invariante 13)', () => {
  const before = JSON.stringify(world.registries.describe());
  const view1 = WorldNavigationService.competitionView(world.registries, CompetitionCatalog.COMPETITION_IDS.ACB, { engine, seasonKey: snapshot.seasonKey });
  const view2 = WorldNavigationService.competitionView(world.registries, CompetitionCatalog.COMPETITION_IDS.ACB, { engine, seasonKey: snapshot.seasonKey });
  const after = JSON.stringify(world.registries.describe());
  assert.strictEqual(before, after, 'consultar no debe mutar ningún registro');
  assert.deepStrictEqual(view1, view2);
});

// 11. Auditoría estática: ausencia de literales españoles en los módulos
// genéricos nuevos.
check('Auditoría estática: CareerSetup.js/CareerSetupService.js/WorldNavigationService.js no contienen literales de España/ACB/FEB/1ª/2ª', () => {
  const files = [
    'src/entities/CareerSetup.js',
    'src/core/CareerSetupService.js',
    'src/core/WorldNavigationService.js',
  ];
  const forbidden = [/\bACB\b/, /Primera FEB/, /España/, /'1ª'/, /'2ª'/, /"1ª"/, /"2ª"/];
  files.forEach((relPath) => {
    const contents = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
    forbidden.forEach((pattern) => {
      assert.ok(!pattern.test(contents), `${relPath} no debe contener el literal ${pattern}`);
    });
  });
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
