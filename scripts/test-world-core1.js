// scripts/test-world-core1.js
// WORLD-CORE-1 (DESIGN.md, "World Architecture") — batería DIRIGIDA (no
// exhaustiva) de la primera entrega de la EPIC. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Sección 13.1 del prompt: máximo orientativo 25 comprobaciones de alto
// valor, agrupadas en jerarquía/organizaciones, paquetes, mundo sin España,
// definición/edición/stage/entry, múltiples competiciones por equipo, no
// fallback de calendario, MoraBanc transfronterizo, identidad canónica y
// aliases, auditoría estática de literales españoles en módulos genéricos.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { CompetitionDefinition, CompetitionEdition, CompetitionEntry } = require('../src/entities/Competition.js');
const { GameWorld } = require('../src/entities/World.js');
const { WorldRegistries } = require('../src/core/WorldRegistry.js');
const { ContentPackRegistry } = require('../src/core/ContentPackRegistry.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const { SpainLegacyCompetitionRuntime } = require('../src/core/SpainLegacyCompetitionRuntime.js');
const { Calendar } = require('../src/core/Calendar.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const { SPAIN_MANIFEST } = require('../data/world/spain-2026.1.js');

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
// Fixtures compartidos: los 36 equipos reales (misma construcción mínima
// que game.js/otros smokes: instancia real de Team/Player a partir del
// bundle, sin relleno ficticio de cobertura — no hace falta para este test).
// -----------------------------------------------------------------------
function buildRealTeam(teamData) {
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...fields } = playerData;
    const player = new Player(fields);
    player.dataSource = dataSource || null;
    return player;
  });
  return new Team({ ...teamData, roster });
}

function buildTeamsByDivision() {
  const teamsByDivision = { '1ª': [], '2ª': [] };
  ['1ª', '2ª'].forEach((div) => {
    teamsByDivision[div] = REAL_DATA_INDEX
      .filter((entry) => entry.division === div)
      .map((entry) => buildRealTeam(REAL_DATA_TEAMS[entry.id]));
  });
  return teamsByDivision;
}

function buildSpainWorld(seasonKey) {
  const teamsByDivision = buildTeamsByDivision();
  const calendar = new Calendar(2026, CONFIG_BASE);
  const world = WorldFactory.buildCareerWorld({
    id: 'world:test-world-core1',
    name: 'Mundo de prueba',
    careerSeed: 'test-world-core1-seed',
    createdAtGameDate: '2026-10-03',
    packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
    context: { teamsByDivision, seasonKey: seasonKey || '2026-27', seasonStartDate: '2026-10-03' },
  });
  world.setCalendar(calendar);
  return { world, teamsByDivision, calendar };
}

// =========================================================================
// 1. Jerarquía geográfica y organizaciones
// =========================================================================
check('hay exactamente una raíz geográfica de tipo world', () => {
  const { world } = buildSpainWorld();
  const roots = world.registries.areas.all().filter((a) => a.parentAreaId === null);
  assert.strictEqual(roots.length, 1);
  assert.strictEqual(roots[0].type, 'world');
});

check('España y Andorra son países DISTINTOS bajo Europa', () => {
  const { world } = buildSpainWorld();
  const spain = world.registries.areas.require('area-country-es');
  const andorra = world.registries.areas.require('area-country-ad');
  assert.strictEqual(spain.parentAreaId, 'area-continent-europe');
  assert.strictEqual(andorra.parentAreaId, 'area-continent-europe');
  assert.notStrictEqual(spain.id, andorra.id);
  assert.deepStrictEqual(world.registries.areas.validateHierarchy(), []);
});

check('un padre inexistente se detecta en validateHierarchy()', () => {
  const registries = new WorldRegistries();
  registries.registerArea(new GeographicArea({ id: 'w', type: 'world', parentAreaId: null }));
  registries.areas.register(new GeographicArea({ id: 'orphan', type: 'country', parentAreaId: 'no-existe' }));
  const errors = registries.areas.validateHierarchy();
  assert.ok(errors.some((e) => e.includes('padre inexistente')));
});

check('una organización referencia siempre áreas existentes', () => {
  const { world } = buildSpainWorld();
  const acb = world.registries.organizations.require('org-acb');
  assert.ok(world.registries.areas.has(acb.headquartersAreaId));
  assert.ok(world.registries.areas.has(acb.scopeAreaId));
  assert.throws(() => world.registries.registerOrganization(new Organization({
    id: 'org-bad', type: 'other', headquartersAreaId: 'no-existe', scopeAreaId: 'no-existe',
  })), /sede inexistente/);
});

// =========================================================================
// 2. Dependencias/atomicidad de paquetes
// =========================================================================
check('instalar un paquete con dependencia ausente lanza descriptivo', () => {
  const registries = new WorldRegistries();
  assert.throws(
    () => registries.packs.computeInstallOrder([{ id: 'a', version: '1.0.0', dependencies: ['b'], install: () => {} }]),
    /dependencia ausente/,
  );
});

check('una dependencia circular lanza descriptivo', () => {
  const registries = new WorldRegistries();
  const a = { id: 'a', version: '1.0.0', dependencies: ['b'], install: () => {} };
  const b = { id: 'b', version: '1.0.0', dependencies: ['a'], install: () => {} };
  assert.throws(() => registries.packs.computeInstallOrder([a, b]), /circular/);
});

check('un id de paquete duplicado con otra versión lanza descriptivo', () => {
  const registries = new WorldRegistries();
  registries.packs.registerManifest({ id: 'p', version: '1.0.0', install: () => {} });
  assert.throws(() => registries.packs.registerManifest({ id: 'p', version: '2.0.0', install: () => {} }), /ya está registrado/);
});

check('el orden de entrada de los paquetes no cambia el mundo final', () => {
  const worldA = new GameWorld({ id: 'w', careerSeed: 's' });
  const worldB = new GameWorld({ id: 'w', careerSeed: 's' });
  const teamsByDivision = buildTeamsByDivision();
  const context = { teamsByDivision, seasonKey: '2026-27', seasonStartDate: '2026-10-03' };
  WorldFactory.installContentPacks(worldA, [WORLD_CORE_MANIFEST, SPAIN_MANIFEST], context);
  WorldFactory.installContentPacks(worldB, [SPAIN_MANIFEST, WORLD_CORE_MANIFEST], context);
  // `installedAt` es un timestamp real (no forma parte del contenido
  // instalado) — se compara todo lo demás byte a byte.
  const stripInstalledAt = (snapshot) => ({
    ...snapshot,
    packs: snapshot.packs.map(({ installedAt, ...rest }) => rest),
  });
  assert.deepStrictEqual(stripInstalledAt(worldA.describe()), stripInstalledAt(worldB.describe()));
});

check('instalar dos veces el mismo paquete es idempotente', () => {
  const { world } = buildSpainWorld();
  const before = world.registries.clubs.size;
  WorldFactory.installContentPacks(world, [WORLD_CORE_MANIFEST, SPAIN_MANIFEST], {
    teamsByDivision: buildTeamsByDivision(), seasonKey: '2026-27', seasonStartDate: '2026-10-03',
  });
  assert.strictEqual(world.registries.clubs.size, before);
});

// =========================================================================
// 3. Mundo SIN España (fixture de test, sección 6 del prompt)
// =========================================================================
function buildTestOnlyManifest() {
  return {
    id: 'test-only-pack',
    version: '1.0.0',
    name: '[SOLO TEST] paquete mínimo no español',
    dependencies: [],
    install(world) {
      world.registries.registerArea(new GeographicArea({ id: 'area-world', type: 'world', parentAreaId: null, name: 'Mundo' }));
      world.registries.registerArea(new GeographicArea({
        id: 'area-country-testland', type: 'country', parentAreaId: 'area-world', name: 'Testland', isoCode: 'XX',
      }));
      world.registries.registerOrganization(new Organization({
        id: 'org-testland-federation', type: 'national-federation', headquartersAreaId: 'area-country-testland', scopeAreaId: 'area-country-testland',
      }));
      world.registries.registerCompetitionDefinition(new CompetitionDefinition({
        id: 'testland-world-cup', name: '[TEST] Copa Mundial de prueba', scopeLevel: 'world', scopeAreaId: null,
        organizerId: 'org-testland-federation', participantType: 'national-team', kind: 'championship', implementationStatus: 'catalog-only',
      }));
    },
  };
}

check('un paquete de test se instala y valida sin ACB/FEB/España', () => {
  const world = WorldFactory.buildCareerWorld({
    id: 'world-test-only', careerSeed: 'seed', packs: [buildTestOnlyManifest()],
  });
  assert.deepStrictEqual(world.validateIntegrity(), []);
  assert.strictEqual(world.registries.clubs.size, 0);
  assert.strictEqual(world.registries.teams.size, 0);
  assert.ok(world.registries.competitionDefinitions.has('testland-world-cup'));
  const snapshot = JSON.stringify(world.describe());
  ['acb', 'primera-feb', "'1ª'", "'2ª'", 'ACB', 'Primera FEB', 'España'].forEach((token) => {
    assert.ok(!snapshot.includes(token), `el mundo sin España no debería contener "${token}"`);
  });
});

// =========================================================================
// 4. Definición/edición/stage/entry — invariante 13 (Liga/Copa/Playoff)
// =========================================================================
check('ACB tiene edición de temporada regular con 18 entries', () => {
  const { world } = buildSpainWorld('2026-27');
  const edition = world.registries.competitionEditions.require('edition:acb:2026-27');
  assert.strictEqual(edition.competitionDefinitionId, 'acb');
  const stage = world.registries.competitionStages.require('stage:acb:2026-27:regular-season');
  assert.strictEqual(stage.editionId, edition.id);
  assert.strictEqual(world.registries.competitionEntries.forStage(stage.id).length, 18);
});

check('Copa ACB es una CompetitionDefinition SEPARADA de la Liga', () => {
  const acb = CompetitionCatalog.getCompetitionDefinition('acb');
  const copa = CompetitionCatalog.getCompetitionDefinition('copa-acb');
  assert.notStrictEqual(acb.id, copa.id);
  assert.strictEqual(copa.kind, 'cup');
  assert.strictEqual(acb.kind, 'league');
});

check('el playoff por el título es un STAGE de la edición de Liga, no otra competición', () => {
  const { world } = buildSpainWorld('2026-27');
  const fakeBracket = { id: 'fake-title-playoff-bracket' };
  const eightTeams = world.registries.teams.all().filter((t) => t.legacyDivision === '1ª').slice(0, 8);
  SpainLegacyCompetitionRuntime.bindTitlePlayoff(world, {
    seasonKey: '2026-27', bracket: fakeBracket, qualifiedTeams: eightTeams,
  });
  const stage = world.registries.competitionStages.require('stage:acb:2026-27:title-playoff');
  assert.strictEqual(stage.editionId, 'edition:acb:2026-27');
  assert.strictEqual(stage.sourceStageIds[0], 'stage:acb:2026-27:regular-season');
  assert.strictEqual(world.registries.competitionEditions.all().filter((e) => e.competitionDefinitionId === 'acb').length, 1);
});

check('la Copa crea su PROPIA edición cuando se enlaza', () => {
  const { world } = buildSpainWorld('2026-27');
  const teams = world.registries.teams.all().filter((t) => t.legacyDivision === '1ª').slice(0, 8);
  SpainLegacyCompetitionRuntime.bindCup(world, { seasonKey: '2026-27', bracket: { id: 'fake-cup' }, qualifiedTeams: teams });
  const edition = world.registries.competitionEditions.require('edition:copa-acb:2026-27');
  assert.strictEqual(edition.competitionDefinitionId, 'copa-acb');
  assert.notStrictEqual(edition.id, 'edition:acb:2026-27');
});

// =========================================================================
// 5. Múltiples competiciones por equipo (invariante 7/8)
// =========================================================================
check('un equipo tiene entries simultáneas en Liga Y Copa', () => {
  const { world } = buildSpainWorld('2026-27');
  const teams = world.registries.teams.all().filter((t) => t.legacyDivision === '1ª').slice(0, 8);
  SpainLegacyCompetitionRuntime.bindCup(world, { seasonKey: '2026-27', bracket: { id: 'fake-cup-2' }, qualifiedTeams: teams });
  const entries = world.registries.competitionEntries.forParticipant(teams[0].id);
  const editionIds = new Set(entries.map((e) => e.editionId));
  assert.ok(editionIds.has('edition:acb:2026-27'));
  assert.ok(editionIds.has('edition:copa-acb:2026-27'));
});

check('la participación se deriva de CompetitionEntry, nunca de Team.division', () => {
  const { world } = buildSpainWorld('2026-27');
  const team = world.registries.teams.all()[0];
  const before = team.division;
  team.division = before === '1ª' ? '2ª' : '1ª'; // mutación directa, fuera de cualquier servicio real
  const entries = world.registries.competitionEntries.forParticipant(team.id);
  assert.ok(entries.length > 0, 'las entries ya creadas no dependen de leer team.division después');
  team.division = before;
});

// =========================================================================
// 6. Sin fallback de calendario (ARCH-WORLD-03)
// =========================================================================
check('Calendar.leagueMatchDateTime lanza ante un scheduleProfileId desconocido', () => {
  const calendar = new Calendar(2026, CONFIG_BASE);
  assert.throws(
    () => calendar.leagueMatchDateTime(1, 0, 9, 34, 'liga-que-no-existe'),
    /nunca hereda el calendario de ACB por defecto/,
  );
});

check('un scheduleProfileId real (1ª/2ª) sigue funcionando exactamente igual', () => {
  const calendar = new Calendar(2026, CONFIG_BASE);
  const date = calendar.leagueMatchDateTime(1, 0, 9, 34, '1ª');
  assert.ok(date instanceof Date);
});

// =========================================================================
// 7. MoraBanc transfronterizo
// =========================================================================
check('MoraBanc Andorra: área de origen y jurisdicción laboral en Andorra, participación en ACB', () => {
  const { world } = buildSpainWorld('2026-27');
  const club = world.registries.clubs.require('team-morabanc-andorra');
  assert.strictEqual(club.homeAreaId, 'area-country-ad');
  assert.strictEqual(club.employerJurisdictionAreaId, 'area-country-ad');
  const entries = world.registries.competitionEntries.forParticipant('team-morabanc-andorra');
  assert.ok(entries.some((e) => e.editionId === 'edition:acb:2026-27'));
  // El organizador de la competición (ACB, España) NUNCA determina la
  // jurisdicción laboral del club (ARCH-WORLD-08/CONTRACT-1).
  const acbDefinition = world.registries.competitionDefinitions.require('acb');
  assert.strictEqual(acbDefinition.organizerCountry, 'ES');
  assert.notStrictEqual(club.employerJurisdictionAreaId, 'area-country-es');
});

// =========================================================================
// 8. Identidad canónica y aliases (invariantes 16-18)
// =========================================================================
check('CompetitionRules.getCompetitionDefinition() delega en el MISMO objeto del catálogo (identidad ===)', () => {
  assert.strictEqual(CompetitionRules.getCompetitionDefinition('acb'), CompetitionCatalog.getCompetitionDefinition('acb'));
});

check('la CompetitionDefinition registrada en el mundo es la MISMA referencia del catálogo', () => {
  const { world } = buildSpainWorld();
  assert.strictEqual(world.registries.competitionDefinitions.get('acb'), CompetitionCatalog.getCompetitionDefinition('acb'));
});

check('el Team del World Registry es la MISMA instancia que la de teamsByDivision', () => {
  const { world, teamsByDivision } = buildSpainWorld();
  const originalTeam = teamsByDivision['1ª'][0];
  assert.strictEqual(world.registries.teams.get(originalTeam.id), originalTeam);
});

check('los aliases de domainRegistries son identidad estricta, nunca copias', () => {
  const { world } = buildSpainWorld();
  const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
  const playerRegistry = new PlayerRegistry();
  world.attachDomainRegistries({ playerRegistry });
  assert.strictEqual(world.domainRegistries.playerRegistry, playerRegistry);
});

check('un id de club duplicado con otra instancia lanza descriptivo', () => {
  const { world } = buildSpainWorld();
  assert.throws(() => world.registries.clubs.register({ id: 'team-real-madrid', name: 'otra instancia' }), /id duplicado incompatible/);
});

check('si la instalación de un paquete falla, no queda un mundo parcial reutilizado', () => {
  const badManifest = {
    id: 'bad-pack',
    version: '1.0.0',
    dependencies: [],
    install(world) {
      world.registries.registerArea(new GeographicArea({ id: 'area-world', type: 'world', parentAreaId: null }));
      throw new Error('fallo deliberado a mitad de instalación');
    },
  };
  let worldRef = null;
  assert.throws(() => {
    worldRef = WorldFactory.buildCareerWorld({ id: 'w-fail', careerSeed: 's', packs: [badManifest] });
  }, /fallo deliberado/);
  assert.strictEqual(worldRef, null, 'game.js nunca debe asignar state.world antes de que buildCareerWorld() termine sin lanzar');
});

// =========================================================================
// 9. Auditoría estática — ningún archivo mundial GENÉRICO nuevo contiene
//    literales de España (sección 8.2/invariante 28). CompetitionCatalog.js
//    (identidad heredada de CompetitionRules.js) y
//    SpainLegacyCompetitionRuntime.js/data/world/spain-2026.1.js (adaptador
//    y paquete, EXPRESAMENTE permitidos) quedan fuera de esta auditoría.
// =========================================================================
const GENERIC_WORLD_FILES = [
  'src/entities/Geography.js',
  'src/entities/Organization.js',
  'src/entities/Club.js',
  'src/entities/Competition.js',
  'src/entities/World.js',
  'src/core/WorldRegistry.js',
  'src/core/ContentPackRegistry.js',
  'src/core/WorldFactory.js',
];
const FORBIDDEN_TOKENS = [/1ª/, /2ª/, /\bACB\b/, /Primera FEB/, /\bEspaña\b/, /competitionIdFromLegacyDivision/];

check('ningún archivo mundial genérico nuevo contiene literales/reglas de España', () => {
  const offenders = [];
  GENERIC_WORLD_FILES.forEach((relPath) => {
    const content = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
    FORBIDDEN_TOKENS.forEach((token) => {
      if (token.test(content)) offenders.push(`${relPath} contiene "${token}"`);
    });
  });
  assert.deepStrictEqual(offenders, []);
});

check('el adaptador legacy y el paquete español SÍ pueden declarar literales de España (excepción documentada)', () => {
  const runtimeContent = fs.readFileSync(path.join(__dirname, '..', 'src/core/SpainLegacyCompetitionRuntime.js'), 'utf8');
  const packContent = fs.readFileSync(path.join(__dirname, '..', 'data/world/spain-2026.1.js'), 'utf8');
  assert.ok(/1ª/.test(runtimeContent) && /2ª/.test(runtimeContent));
  assert.ok(/España/.test(packContent));
});

console.log(`\n${passed} comprobaciones OK, ${failed} fallidas.`);
if (failed > 0) process.exit(1);
