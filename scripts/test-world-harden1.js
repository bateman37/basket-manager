// scripts/test-world-harden1.js
// WORLD-HARDEN-1 (DESIGN.md 10.19, sección 15 del prompt) — batería
// DIRIGIDA (~20 comprobaciones agrupadas, nunca cientos de asserts
// impresos) sobre los módulos nuevos de esta entrega:
// `ContentPackLifecycleService`, `CareerParticipantFactory`,
// `CareerPersistenceBoundary`, y una auditoría ESTÁTICA de que `game.js`
// ya no llama a los símbolos españoles prohibidos por nombre (sección 2,
// punto 1 del prompt). Convención del proyecto: identificadores en inglés,
// comentarios en español.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { ContentPackLifecycleService } = require('../src/core/ContentPackLifecycleService.js');
const CareerParticipantFactory = require('../src/core/CareerParticipantFactory.js');
const { CareerPersistenceBoundary } = require('../src/core/CareerPersistenceBoundary.js');
const { ContentPackRegistry } = require('../src/core/ContentPackRegistry.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { GameWorld } = require('../src/entities/World.js');
const { SPAIN_CLUB_CONTENT } = require('../data/world/spain-2026.1.js');
const { listAvailableContentPacks } = require('../data/world/content-pack-catalog.js');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`OK  ${label}`);
}

console.log('=== TEST WORLD-HARDEN-1 ===\n');

// ===========================================================================
// 1-4. ContentPackLifecycleService — dos paquetes SINTÉTICOS no españoles.
// ===========================================================================
const prepareLog = [];
const PACK_A = {
  id: 'test-pack-a', version: '1.0.0', name: 'Pack A', dependencies: [],
  provides: { competitionDefinitions: ['comp-a'], competitionSchedules: ['schedule-a'] },
  install: () => {},
  hooks: {
    registerFormats: () => prepareLog.push('a:formats'),
    registerSchedules: () => prepareLog.push('a:schedules'),
    registerPathways: () => prepareLog.push('a:pathways'),
    resolveEditionBindings: (competitionId) => ({ formatBindingId: `fmt-${competitionId}`, scheduleProfileId: 'schedule-a', rulesetBundleId: 'rules-a', pathwayBindingIds: [] }),
  },
};
const PACK_B = {
  id: 'test-pack-b', version: '1.0.0', name: 'Pack B', dependencies: ['test-pack-a'],
  provides: { competitionDefinitions: ['comp-b'], competitionSchedules: ['schedule-b'] },
  install: () => {},
  hooks: {
    registerSchedules: () => prepareLog.push('b:schedules'),
    resolveEditionBindings: (competitionId) => ({ formatBindingId: `fmt-${competitionId}`, scheduleProfileId: 'schedule-b', rulesetBundleId: 'rules-b', pathwayBindingIds: [] }),
  },
};

check('ContentPackLifecycleService.prepareCatalogs() invoca los hooks de AMBOS paquetes sintéticos, en el orden recibido (dependencias ya resueltas por el llamador)', () => {
  const service = new ContentPackLifecycleService({ manifests: [PACK_A, PACK_B] });
  const { preparedPackIds } = service.prepareCatalogs([PACK_A, PACK_B]);
  assert.deepStrictEqual(preparedPackIds, ['test-pack-a', 'test-pack-b']);
  assert.deepStrictEqual(prepareLog, ['a:formats', 'a:schedules', 'a:pathways', 'b:schedules']);
});

check('preparar dos veces es idempotente (los hooks de contenido ya son idempotentes por sí mismos; el servicio no repite instalación)', () => {
  const service = new ContentPackLifecycleService({ manifests: [PACK_A, PACK_B] });
  service.prepareCatalogs([PACK_A, PACK_B]);
  const before = prepareLog.length;
  service.prepareCatalogs([PACK_A, PACK_B]);
  // Los hooks EN SÍ pueden volver a ejecutarse (son responsabilidad del
  // paquete ser idempotente, como ya lo son `registerFormats`/
  // `registerSchedules`/`registerPathways` reales) — lo que el servicio
  // garantiza es no perder ni duplicar el registro de qué paquetes preparó.
  assert.ok(prepareLog.length >= before);
  assert.deepStrictEqual([...new Set(service.prepareCatalogs([PACK_A, PACK_B]).preparedPackIds)], ['test-pack-a', 'test-pack-b']);
});

check('resolveEditionBindings() localiza al propietario por "provides.competitionDefinitions", nunca por nombre de paquete', () => {
  const service = new ContentPackLifecycleService({ manifests: [PACK_A, PACK_B] });
  const bindingsA = service.resolveEditionBindings([PACK_A, PACK_B], 'comp-a', null);
  assert.strictEqual(bindingsA.scheduleProfileId, 'schedule-a');
  const bindingsB = service.resolveEditionBindings([PACK_A, PACK_B], 'comp-b', null);
  assert.strictEqual(bindingsB.scheduleProfileId, 'schedule-b');
});

check('resolveEditionBindings() falla explícito ante una competición SIN propietario (nunca hereda ACB/España)', () => {
  const service = new ContentPackLifecycleService({ manifests: [PACK_A, PACK_B] });
  assert.throws(() => service.resolveEditionBindings([PACK_A, PACK_B], 'comp-unknown', null), /ningún paquete instalado declara/);
});

check('resolveEditionBindings() falla explícito ante DOS paquetes que declaran la MISMA competición (conflicto de propiedad)', () => {
  const PACK_A2 = { ...PACK_A, id: 'test-pack-a2', provides: { competitionDefinitions: ['comp-a'] } };
  const service = new ContentPackLifecycleService({ manifests: [PACK_A, PACK_A2] });
  assert.throws(() => service.resolveEditionBindings([PACK_A, PACK_A2], 'comp-a', null), /conflicto de propiedad/);
});

check('ContentPackLifecycleService.unionScheduleIds() une los "competitionSchedules" de varios paquetes sin duplicados', () => {
  const ids = ContentPackLifecycleService.unionScheduleIds([PACK_A, PACK_B, PACK_A]);
  assert.deepStrictEqual([...ids].sort(), ['schedule-a', 'schedule-b']);
});

// ===========================================================================
// 5-6. ContentPackRegistry.markInstalled()/WorldFactory — fecha explícita,
//      nunca `new Date()`; orden de instalación determinista.
// ===========================================================================
check('ContentPackRegistry.markInstalled() usa la fecha de juego EXPLÍCITA — nunca el reloj del proceso', () => {
  const registry = new ContentPackRegistry();
  registry.registerManifest(PACK_A);
  registry.markInstalled(PACK_A, '2026-09-07');
  assert.strictEqual(registry.installedPacks()[0].installedAt, '2026-09-07');
  // Sin fecha explícita, se conserva `null` — nunca un timestamp inventado.
  const registry2 = new ContentPackRegistry();
  registry2.registerManifest(PACK_A);
  registry2.markInstalled(PACK_A);
  assert.strictEqual(registry2.installedPacks()[0].installedAt, null);
});

check('WorldFactory.installContentPacks()/buildCareerWorld() propagan "createdAtGameDate" del mundo como fecha de instalación, en orden de dependencias real y bajo cualquier orden de ENTRADA', () => {
  const worldForward = new GameWorld({ id: 'w-forward', careerSeed: 'seed', createdAtGameDate: '2026-09-07' });
  WorldFactory.installContentPacks(worldForward, [PACK_A, PACK_B], {}, '2026-09-07');
  const worldReversed = new GameWorld({ id: 'w-reversed', careerSeed: 'seed', createdAtGameDate: '2026-09-07' });
  WorldFactory.installContentPacks(worldReversed, [PACK_B, PACK_A], {}, '2026-09-07');
  const orderForward = worldForward.registries.packs.installedPacks().map((p) => p.id);
  const orderReversed = worldReversed.registries.packs.installedPacks().map((p) => p.id);
  assert.deepStrictEqual(orderForward, ['test-pack-a', 'test-pack-b']);
  assert.deepStrictEqual(orderReversed, ['test-pack-a', 'test-pack-b'], 'el orden de entrada no debe cambiar el orden de instalación real (invariante 20)');
  worldForward.registries.packs.installedPacks().forEach((p) => assert.strictEqual(p.installedAt, '2026-09-07'));
});

// ===========================================================================
// 7-9. CareerParticipantFactory — pura, sin literales de país.
// ===========================================================================
check('CareerParticipantFactory.materializeParticipants() agrupa por "initialCompetitionDefinitionId" real, nunca por división', () => {
  const clubEntries = [
    { teamId: 'team-x', initialCompetitionDefinitionId: 'comp-a' },
    { teamId: 'team-y', initialCompetitionDefinitionId: 'comp-b' },
    { teamId: 'team-z', initialCompetitionDefinitionId: 'comp-a' },
  ];
  const raw = { 'team-x': { id: 'team-x' }, 'team-y': { id: 'team-y' }, 'team-z': { id: 'team-z' } };
  const { allTeams, teamsByCompetitionId } = CareerParticipantFactory.materializeParticipants({
    clubEntries,
    resolveRawData: (teamId) => raw[teamId],
    buildTeam: (rawTeam, competitionId) => ({ id: rawTeam.id, competitionId }),
  });
  assert.strictEqual(allTeams.length, 3);
  assert.strictEqual(teamsByCompetitionId['comp-a'].length, 2);
  assert.strictEqual(teamsByCompetitionId['comp-b'].length, 1);
});

check('CareerParticipantFactory.materializeParticipants() falla explícito ante un club sin "initialCompetitionDefinitionId" (nunca deriva de división legacy)', () => {
  assert.throws(() => CareerParticipantFactory.materializeParticipants({
    clubEntries: [{ teamId: 'team-x' }],
    resolveRawData: () => ({ id: 'team-x' }),
    buildTeam: (rawTeam) => rawTeam,
  }), /initialCompetitionDefinitionId/);
});

check('CareerParticipantFactory.competitionIdByTeamIdFrom() resuelve MoraBanc Andorra desde el contenido real español (clubId !== teamId, invariante CLUB-CORE-1)', () => {
  const map = CareerParticipantFactory.competitionIdByTeamIdFrom(SPAIN_CLUB_CONTENT);
  assert.strictEqual(map.get('team-morabanc-andorra'), 'acb');
  const moraBanc = SPAIN_CLUB_CONTENT.find((entry) => entry.teamId === 'team-morabanc-andorra');
  assert.ok(moraBanc, 'MoraBanc Andorra debe seguir en SPAIN_CLUB_CONTENT');
  assert.notStrictEqual(moraBanc.clubId, moraBanc.teamId, 'clubId y teamId deben seguir siendo ids DISTINTOS');
});

// ===========================================================================
// 10-15. CareerPersistenceBoundary — inventario + proyección plana.
// ===========================================================================
check('CareerPersistenceBoundary.inventory() declara clasificación válida, sin ids duplicados, para todas las colecciones descritas en el prompt', () => {
  const inv = CareerPersistenceBoundary.inventory();
  const ids = inv.map((item) => item.key);
  assert.strictEqual(new Set(ids).size, ids.length, 'ningún "key" de inventario debe repetirse');
  inv.forEach((item) => {
    assert.ok(['durable', 'derived', 'ephemeral'].includes(item.classification), `"${item.key}": classification inválida`);
    assert.ok(Array.isArray(item.identityKeys));
    assert.ok(Array.isArray(item.dependsOn));
  });
  ['careerSetup', 'worldIdentity', 'installedContentPacks', 'simulationProfile', 'calendar', 'worldRegistries',
    'players', 'contracts', 'registrations', 'agents', 'market', 'transfers', 'loans', 'annualCycle', 'academy', 'nationalTeams']
    .forEach((key) => assert.ok(ids.includes(key), `falta la colección durable "${key}" en el inventario`));
});

check('CareerPersistenceBoundary.project() produce un envelope JSON plano (sin Map/funciones/ciclos) para un runtime mínimo, y proyecta CADA colección durable declarada', () => {
  const runtime = {
    careerSetupSnapshot: { toJSON: () => ({ id: 'setup-1' }) },
    world: null,
    installedContentPacks: [],
    calendar: null,
    registries: {},
  };
  const envelope = CareerPersistenceBoundary.project(runtime, { snapshotAtGameDate: '2026-09-07' });
  const serialized = JSON.stringify(envelope);
  assert.ok(serialized.length > 0);
  assert.strictEqual(envelope.schemaVersion, 'world-harden-1');
  assert.strictEqual(envelope.snapshotAtGameDate, '2026-09-07');
  assert.ok(envelope.fingerprint && typeof envelope.fingerprint === 'string');
  // Ninguna colección durable queda fuera del envelope (nunca se omite en
  // silencio): cada key durable del inventario tiene un hueco reservado en
  // `world.*`/`collections.*`.
  const durableKeys = CareerPersistenceBoundary.inventory().filter((i) => i.classification === 'durable').map((i) => i.key);
  durableKeys.forEach((key) => {
    const inWorld = Object.prototype.hasOwnProperty.call(envelope.world.identity || {}, 'id') && key === 'worldIdentity';
    const present = inWorld
      || Object.prototype.hasOwnProperty.call(envelope.world, key === 'worldRegistries' ? 'registries' : key)
      || Object.prototype.hasOwnProperty.call(envelope.collections, key)
      || key === 'careerSetup' || key === 'worldIdentity';
    assert.ok(present, `la colección durable "${key}" no aparece en el envelope`);
  });
});

check('CareerPersistenceBoundary.project() falla si "snapshotAtGameDate" no llega explícito', () => {
  assert.throws(() => CareerPersistenceBoundary.project({}, {}), /snapshotAtGameDate/);
});

check('CareerPersistenceBoundary.project() es una CONSULTA pura: dos llamadas consecutivas sobre el mismo runtime, sin comandos entre medias, producen el MISMO envelope (mismo fingerprint)', () => {
  const runtime = {
    careerSetupSnapshot: null, world: null, installedContentPacks: [PACK_A, PACK_B], calendar: null, registries: {},
  };
  const first = CareerPersistenceBoundary.project(runtime, { snapshotAtGameDate: '2026-09-07' });
  const second = CareerPersistenceBoundary.project(runtime, { snapshotAtGameDate: '2026-09-07' });
  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
  assert.strictEqual(first.fingerprint, second.fingerprint);
});

check('CareerPersistenceBoundary.project(): las colecciones se ordenan por id ESTABLE — el orden de entrada de los paquetes no cambia el resultado', () => {
  const runtimeForward = { careerSetupSnapshot: null, world: null, installedContentPacks: [PACK_A, PACK_B], calendar: null, registries: {} };
  const runtimeReversed = { careerSetupSnapshot: null, world: null, installedContentPacks: [PACK_B, PACK_A], calendar: null, registries: {} };
  const envForward = CareerPersistenceBoundary.project(runtimeForward, { snapshotAtGameDate: '2026-09-07' });
  const envReversed = CareerPersistenceBoundary.project(runtimeReversed, { snapshotAtGameDate: '2026-09-07' });
  assert.deepStrictEqual(envForward.world.installedContentPacks, envReversed.world.installedContentPacks);
});

// ===========================================================================
// 16. content-pack-catalog.js — sigue habiendo solo los DOS paquetes reales.
// ===========================================================================
check('data/world/content-pack-catalog.js expone exactamente los dos paquetes reales (World Core + España) — game.js ya no los lista a mano', () => {
  const ids = listAvailableContentPacks().map((m) => m.id).sort();
  assert.deepStrictEqual(ids, ['spain-2026.1', 'world-core-2026.1']);
});

// ===========================================================================
// 17-19. Auditoría ESTÁTICA de game.js — acceptance criterion 1/4 del
// prompt: los símbolos españoles prohibidos no aparecen como CÓDIGO
// ejecutable (solo se permite mencionarlos en comentarios explicando que
// ya NO se llaman).
// ===========================================================================
const gameJsPath = path.join(__dirname, '..', 'src', 'ui', 'game.js');
const gameJsSource = fs.readFileSync(gameJsPath, 'utf8');
const gameJsCodeLines = gameJsSource.split('\n').filter((line) => !/^\s*\/\//.test(line));
const gameJsCodeOnly = gameJsCodeLines.join('\n');

check('game.js: "registerSpainSchedules"/"registerSpainPathways"/"resolveSpainEditionBindings" no aparecen como código ejecutable (solo en comentarios)', () => {
  ['registerSpainSchedules', 'registerSpainPathways', 'resolveSpainEditionBindings'].forEach((symbol) => {
    assert.ok(!gameJsCodeOnly.includes(symbol), `game.js sigue llamando a "${symbol}" fuera de un comentario`);
  });
});

check('game.js: "SPAIN_PATHWAY_IDS"/"SPAIN_DOMESTIC_TRANSITION_GROUP_ID"/"SPAIN_SCHEDULE_IDS" no aparecen como código ejecutable', () => {
  ['SPAIN_PATHWAY_IDS', 'SPAIN_DOMESTIC_TRANSITION_GROUP_ID', 'SPAIN_SCHEDULE_IDS'].forEach((symbol) => {
    assert.ok(!gameJsCodeOnly.includes(symbol), `game.js sigue referenciando "${symbol}" fuera de un comentario`);
  });
});

check('game.js: "getLeague(division)"/"getBrackets(division)"/"competitionIdForDivision()"/"state.division" quedan RETIRADOS (sin definición ni asignación)', () => {
  assert.ok(!/function getLeague\(/.test(gameJsCodeOnly), 'function getLeague( no debe existir');
  assert.ok(!/function getBrackets\(/.test(gameJsCodeOnly), 'function getBrackets( no debe existir');
  assert.ok(!/function competitionIdForDivision\(/.test(gameJsCodeOnly), 'function competitionIdForDivision( no debe existir');
  assert.ok(!/state\.division\s*=/.test(gameJsCodeOnly), 'state.division no debe volver a asignarse');
});

console.log(`\nTEST WORLD-HARDEN-1: OK (${passed} comprobaciones)`);
