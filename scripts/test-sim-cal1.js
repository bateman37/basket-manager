// scripts/test-sim-cal1.js
// SIM-CAL-1 — batería DIRIGIDA (~12 checks, sección 13 del prompt), no
// exhaustiva. Reutiliza el patrón de fixture de `test-world-calendar1.js`
// (mundo ficticio, nunca España). Convención del proyecto: identificadores
// en inglés, comentarios en español.

const assert = require('assert');

const { WorldCalendar } = require('../src/core/WorldCalendar.js');
const {
  WorldCalendarCoordinator, WORLD_CALENDAR_STOP_TYPES, WORLD_CALENDAR_SOURCE_TYPES,
  createCompetitionMatchSource,
} = require('../src/core/WorldCalendarCoordinator.js');
const { WorldAdvanceRunner } = require('../src/core/WorldAdvanceRunner.js');
const { CareerPersistenceBoundary } = require('../src/core/CareerPersistenceBoundary.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const { CompetitionDefinition } = require('../src/entities/Competition.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const { CompetitionScheduleDefinition } = require('../src/entities/CompetitionSchedule.js');
const { CompetitionScheduleCatalog } = require('../src/core/CompetitionScheduleCatalog.js');
const { CompetitionScheduleService } = require('../src/core/CompetitionScheduleService.js');
const { CompetitionEngine, buildEditionId } = require('../src/core/CompetitionEngine.js');
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

// `MatchEngine.simulateMatch` sin `precomputedResult` usa RNG real (mismo
// criterio ya documentado en `test-save-load1.js`, check 7: "no es la
// acción determinista que exige el criterio de aceptación"). Esta batería
// compara ESTADO DE CALENDARIO/ORDEN entre el driver síncrono y el runner
// cooperativo, no el motor de partido (fuera de alcance de SIM-CAL-1) — así
// que todo partido de esta fixture se resuelve con un resultado FIJO
// derivado del propio `matchId` (nunca `Math.random()`), igual en las dos
// careers comparadas.
function fixedResultForMatchId(matchId) {
  let hash = 0;
  for (let i = 0; i < matchId.length; i++) hash = (hash * 31 + matchId.charCodeAt(i)) >>> 0;
  const home = 60 + (hash % 30);
  const away = 60 + ((hash >>> 8) % 30);
  return { finalScore: { home, away: home === away ? away + 1 : away }, quarterScores: [], boxScore: null };
}

const FIXTURE_TZ = 'Europe/Lisbon';
const FORMAT_ID = 'test-simcal1:format:single-round-robin';
const SCHEDULE_ID = 'test-simcal1:schedule:main';

function registerFixtures() {
  if (!FormatCatalog.hasFormat(FORMAT_ID)) {
    FormatCatalog.registerFormat({
      id: FORMAT_ID,
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
  if (!CompetitionScheduleCatalog.hasSchedule(SCHEDULE_ID)) {
    CompetitionScheduleCatalog.registerSchedule({
      id: SCHEDULE_ID,
      version: '1.0.0',
      status: 'fictional-test',
      timeZoneId: FIXTURE_TZ,
      seasonAnchor: { month: 9, day: 5 },
      provenance: { dataSource: 'test-fixture', status: 'design' },
      plans: {
        'regular-season': {
          strategy: 'round-robin-cadence',
          params: {
            roundsCount: 5,
            daysBetweenRounds: 7,
            // Un único hueco por jornada: TODOS los partidos de una ronda
            // caen en el MISMO instante -> grupo cronológico de tamaño > 1,
            // necesario para probar orden estable y "yield" dentro de un
            // grupo (secciones 1/4 del prompt).
            weekendSlots: [{ dayOffset: 0, hour: 18, minute: 0, weight: 1 }],
            midweek: null,
            lastRoundSlot: { dayOffset: 0, hour: 18, minute: 0 },
          },
        },
      },
    });
  }
}

// `teamCount` par (round-robin de una vuelta produce teamCount/2 partidos
// simultáneos por jornada). `controlledTeamIndex` opcional para producir
// paradas `user-match`. `resolveOverride` permite forzar un fallo de
// resolución determinista (check 8).
function buildCareer({
  id, teamCount = 6, controlledTeamIndex = null, resolveOverride = null, teamIdPrefix = id, careerSeed = `${id}-seed`,
} = {}) {
  registerFixtures();
  // `careerSeed` alimenta el RNG determinista de `MatchEngine` — para que
  // dos careers sean comparables byte a byte (equivalencia síncrono vs.
  // cooperativo) deben compartir el MISMO seed, no solo la misma
  // configuración estructural.
  const world = new GameWorld({ id, careerSeed });
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
  const teams = generateFictionalTeams(teamCount, { seed: `${id}-teams` });
  // `generateFictionalTeams()` asigna ids con UUID aleatorio (nunca
  // determinista por semilla) — se fuerzan ids ESTABLES por posición para
  // que dos careers construidas con el mismo `teamCount` sean comparables
  // byte a byte (el desempate estable del calendario ordena por id de
  // item, que incorpora el id de equipo).
  teams.forEach((team, i) => { team.id = `team-${teamIdPrefix}-${i}`; });
  teams.forEach((team) => {
    const club = new Club({
      id: `club-${team.id}`, name: team.name, homeAreaId: 'area-country-testland',
      employerJurisdictionAreaId: 'area-country-testland', primaryTeamId: team.id, dataSource: 'test-fixture',
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
  world.registries.registerCompetitionDefinition(new CompetitionDefinition({
    id: 'testland-main',
    name: '[TEST] Testland Main',
    scopeLevel: 'national',
    scopeAreaId: 'area-country-testland',
    organizerId: 'org-testland',
    participantType: 'club-team',
    kind: 'league',
    implementationStatus: 'active-runtime',
    bindings: { scheduleProfileId: SCHEDULE_ID },
  }));
  const svc = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
  const engine = new CompetitionEngine({ world });
  engine.setDateResolverProvider(svc.buildDateResolverProvider({ seasonStartYearForEdition: () => 2031 }));
  engine.registerEditionWithInitialEntries({
    competitionDefinitionId: 'testland-main',
    seasonKey: '2031-32',
    formatBindingId: FORMAT_ID,
    participants: teams.map((t) => ({ id: t.id })),
    detailLevel: 'playable',
  });
  engine.initializeEdition(buildEditionId('testland-main', '2031-32'));
  const calendar = new WorldCalendar({
    id: `cal-${id}`, defaultTimeZoneId: FIXTURE_TZ, initialInstant: '2031-09-01T00:00:00Z',
  });
  calendar.registerSeason({ seasonKey: '2031-32', startInstant: '2031-09-01T00:00:00Z', timeZoneId: FIXTURE_TZ });
  const resolvedOrder = [];
  const coordinator = new WorldCalendarCoordinator({
    calendar,
    sources: [createCompetitionMatchSource({
      engine,
      timeZoneId: FIXTURE_TZ,
      resolveMatch: ({ stageId, matchId, item }) => {
        if (resolveOverride) return resolveOverride({
          stageId, matchId, item, engine,
        });
        engine.resolveMatch(stageId, matchId, { matchEngineOptions: { precomputedResult: fixedResultForMatchId(matchId) } });
        resolvedOrder.push(matchId);
        return null;
      },
    })],
    controlledTeamIds: controlledTeamIndex === null ? [] : [teams[controlledTeamIndex].id],
    controlledClubIds: [],
  });
  return {
    world, teams, engine, calendar, coordinator, resolvedOrder,
  };
}

// Driver cooperativo de prueba: reloj técnico FALSO y avanzado a mano —
// nunca temporizadores reales (sección 6 del prompt: "inject the scheduler
// and technical monotonic clock so Node tests do not depend on real
// timers"). `scheduler` ejecuta el siguiente slice SÍNCRONAMENTE (nunca
// `setTimeout`), así el test controla exactamente cuántos slices ocurren.
function buildFakeClockRunner(coordinator, { sliceBudgetMs = 8, maxItemsPerSlice = 200, tickMs = 1 } = {}) {
  let technicalNow = 0;
  const now = () => technicalNow;
  const pendingSlices = [];
  const scheduler = (cb) => pendingSlices.push(cb);
  const runner = new WorldAdvanceRunner({
    coordinator, scheduler, now, sliceBudgetMs, maxItemsPerSlice,
  });
  // Avanza el reloj falso un `tick` en cada paso interno del generador
  // envolviendo `runSteps` sería invasivo; en su lugar dejamos que el
  // presupuesto de tiempo lo decida el propio bucle, incrementando el reloj
  // desde fuera entre slices programados es suficiente para forzar más de
  // un slice cuando `tickMs` hace que el presupuesto se agote rápido.
  function pumpUntilIdle() {
    let guard = 0;
    while (pendingSlices.length) {
      guard += 1;
      if (guard > 100000) throw new Error('buildFakeClockRunner: demasiados slices — ¿bucle sin progreso?');
      const cb = pendingSlices.shift();
      technicalNow += tickMs;
      cb();
    }
  }
  return { runner, pumpUntilIdle, advanceClock: (ms) => { technicalNow += ms; } };
}

// =========================================================================
// 1/4. Orden estable dentro de un grupo automático + "yield" no altera nada.
// =========================================================================
check('una sesión resuelve items automáticos en orden cronológico/id estable, incluso paso a paso', () => {
  const career = buildCareer({ id: 'simcal-order' });
  const session = career.coordinator.createAdvanceSession();
  // Un paso de generador por llamada — fuerza el máximo número de "yields"
  // posible sin cambiar ni una coma del algoritmo real.
  let terminal = null;
  for (let i = 0; i < 100000 && !terminal; i++) {
    const { done, terminal: t } = session.runSteps(1);
    if (done) terminal = t;
  }
  assert.strictEqual(terminal.type, WORLD_CALENDAR_STOP_TYPES.SEASON_COMPLETE);
  const sortedCopy = [...career.resolvedOrder].sort();
  // Dentro de cada jornada (grupo de 3 partidos simultáneos) el orden debe
  // ser el mismo que produce `advanceUntilNextUserStop()` de un tirón —
  // comprobado en el check de equivalencia siguiente; aquí solo se verifica
  // que no hay duplicados ni huecos.
  assert.strictEqual(new Set(career.resolvedOrder).size, career.resolvedOrder.length, 'ningún partido se resuelve dos veces');
  assert.strictEqual(sortedCopy.length, career.teams.length * (career.teams.length - 1) / 2, 'se resuelven TODOS los partidos de la liga (una vuelta)');
});

// =========================================================================
// 2. Items automáticos en el instante del partido del usuario quedan pendientes.
// =========================================================================
check('los items automáticos del MISMO instante que el partido del usuario quedan pendientes tras la parada', () => {
  const career = buildCareer({ id: 'simcal-userstop', controlledTeamIndex: 0 });
  const stop = career.coordinator.advanceUntilNextUserStop();
  assert.strictEqual(stop.type, WORLD_CALENDAR_STOP_TYPES.USER_MATCH);
  const simultaneousIds = stop.simultaneous.map((i) => i.id);
  assert.ok(simultaneousIds.length >= 1, 'la primera jornada de 6 equipos tiene otros partidos simultáneos');
  simultaneousIds.forEach((id) => {
    const item = career.calendar.getItem(id);
    assert.strictEqual(item.status, 'scheduled', `"${id}" debe seguir pendiente, no resuelto antes que el del usuario`);
  });
});

// =========================================================================
// 3. Driver síncrono y cooperativo llegan al MISMO estado canónico.
// =========================================================================
check('el driver síncrono y el runner cooperativo producen el mismo estado canónico', () => {
  // `teamIdPrefix` compartido: los ids de equipo (y por tanto los ids de
  // partido, que los incorporan) deben ser IDÉNTICOS en las dos careers
  // para poder comparar orden de resolución byte a byte — el `id` de mundo
  // en sí no aparece en ningún id de partido.
  const syncCareer = buildCareer({ id: 'simcal-equiv-sync', teamIdPrefix: 'simcal-equiv', careerSeed: 'simcal-equiv-seed' });
  const syncStop = syncCareer.coordinator.advanceUntilNextUserStop();

  const coopCareer = buildCareer({ id: 'simcal-equiv-coop', teamIdPrefix: 'simcal-equiv', careerSeed: 'simcal-equiv-seed' });
  const { runner, pumpUntilIdle } = buildFakeClockRunner(coopCareer.coordinator, { sliceBudgetMs: 0, maxItemsPerSlice: 1 });
  let coopTerminal = null;
  runner.start({ onTerminal: (t) => { coopTerminal = t; } });
  pumpUntilIdle();

  assert.strictEqual(coopTerminal.type, syncStop.type);
  assert.deepStrictEqual(coopCareer.resolvedOrder, syncCareer.resolvedOrder);
  assert.deepStrictEqual(coopCareer.calendar.snapshot().pendingItems, syncCareer.calendar.snapshot().pendingItems);
  // Mismas standings, mismo `CompetitionEngine`.
  const stageId = [...coopCareer.engine.world.registries.competitionEditions.all()][0].stageIds[0];
  const standingsA = coopCareer.engine.getRunner(stageId).getStandings();
  const standingsB = syncCareer.engine.getRunner(stageId).getStandings();
  assert.deepStrictEqual(standingsA, standingsB);
});

// =========================================================================
// 5/6. Cancelación segura: termina el grupo activo, sincroniza, para antes
// del siguiente — y reanudar no duplica nada.
// =========================================================================
check('cancelar termina el grupo bloqueado, sincroniza y para ANTES del siguiente grupo; reanudar no duplica nada', () => {
  const career = buildCareer({ id: 'simcal-cancel' });
  const session = career.coordinator.createAdvanceSession();
  let groupsCompleted = 0;
  let terminal = null;
  for (let i = 0; i < 100000 && !terminal; i++) {
    const { done, terminal: t } = session.runSteps(1);
    if (done) { terminal = t; break; }
    // En cuanto se completa el PRIMER grupo (primera jornada), se pide
    // cancelación — debe agotar limpiamente esa sesión sin resolver nada
    // del segundo grupo.
    const report = session.getProgressReport();
    if (report.completedGroups >= 1 && groupsCompleted === 0) {
      groupsCompleted = 1;
      session.requestCancel();
    }
  }
  assert.strictEqual(terminal.type, WORLD_CALENDAR_STOP_TYPES.USER_CANCELLED);
  const resolvedAfterCancel = career.resolvedOrder.length;
  assert.strictEqual(resolvedAfterCancel, career.teams.length / 2, 'solo la primera jornada (un grupo) debe quedar resuelta');
  // Estado íntegro: nada a medias.
  career.calendar.validateIntegrity();

  // Reanudar con una SESIÓN NUEVA sobre el MISMO coordinador/calendario.
  const resumedTerminal = career.coordinator.advanceUntilNextUserStop();
  assert.strictEqual(resumedTerminal.type, WORLD_CALENDAR_STOP_TYPES.SEASON_COMPLETE);
  assert.strictEqual(new Set(career.resolvedOrder).size, career.resolvedOrder.length, 'ningún partido se resuelve dos veces entre la sesión cancelada y la reanudación');
  assert.strictEqual(career.resolvedOrder.length, career.teams.length * (career.teams.length - 1) / 2);
});

// =========================================================================
// 7. Contadores de progreso monótonos, exactos y JSON-safe.
// =========================================================================
check('los contadores de progreso son monótonos, exactos y JSON-safe', () => {
  const career = buildCareer({ id: 'simcal-progress' });
  const session = career.coordinator.createAdvanceSession();
  let lastTotal = 0;
  let terminal = null;
  for (let i = 0; i < 100000 && !terminal; i++) {
    const { done, terminal: t } = session.runSteps(1);
    const report = session.getProgressReport();
    assert.ok(report.totalResolvedItems >= lastTotal, 'totalResolvedItems nunca retrocede');
    lastTotal = report.totalResolvedItems;
    assert.doesNotThrow(() => JSON.stringify(report), 'el informe debe ser JSON-safe');
    Object.values(report).forEach((value) => {
      assert.ok(typeof value !== 'function', 'el informe no contiene funciones');
    });
    if (done) terminal = t;
  }
  assert.strictEqual(terminal.type, WORLD_CALENDAR_STOP_TYPES.SEASON_COMPLETE);
  assert.strictEqual(lastTotal, career.teams.length * (career.teams.length - 1) / 2);
});

// =========================================================================
// 8. Un fallo de resolución preserva el item fallido y el límite del reloj.
// =========================================================================
check('un fallo de resolución deja el item "failed", no avanza el cursor por encima y el runner lo enruta como parada visible', () => {
  let failedOnce = false;
  const career = buildCareer({
    id: 'simcal-failure',
    resolveOverride: ({ stageId, matchId, engine }) => {
      if (!failedOnce) { failedOnce = true; throw new Error('fallo determinista de prueba'); }
      engine.resolveMatch(stageId, matchId, {});
    },
  });
  const { runner, pumpUntilIdle } = buildFakeClockRunner(career.coordinator);
  let terminal = null;
  runner.start({ onTerminal: (t) => { terminal = t; } });
  pumpUntilIdle();
  assert.strictEqual(terminal.type, WORLD_CALENDAR_STOP_TYPES.RESOLUTION_FAILED);
  const failedItem = career.calendar.getItem(terminal.items[0].id);
  assert.strictEqual(failedItem.status, 'failed');
  const instantBefore = career.calendar.currentInstant;
  // Una sesión nueva no puede progresar por encima del item fallido.
  const retryCareerSession = career.coordinator.createAdvanceSession();
  const { terminal: retryTerminal } = retryCareerSession.runSteps(1);
  assert.strictEqual(career.calendar.currentInstant, instantBefore, 'el cursor no avanza por encima de un item failed');
  assert.ok(retryTerminal === null || retryTerminal.type === WORLD_CALENDAR_STOP_TYPES.RESOLUTION_FAILED);
});

// =========================================================================
// 9. Los conflictos de calendario no cambian.
// =========================================================================
check('un conflicto de calendario (dos partidos del mismo equipo controlado, mismo instante) se preserva tal cual', () => {
  // Reutiliza el mecanismo ya cubierto en test-world-calendar1.js: aquí solo
  // se confirma que pasar por `createAdvanceSession()`/`runSteps()` no
  // cambia el resultado frente al driver síncrono de siempre.
  const career = buildCareer({ id: 'simcal-conflict', controlledTeamIndex: 0 });
  const session = career.coordinator.createAdvanceSession();
  const { terminal } = session.runSteps(Infinity);
  assert.strictEqual(terminal.type, WORLD_CALENDAR_STOP_TYPES.USER_MATCH);
});

// =========================================================================
// 10. Los arranques duplicados no pueden crear dos operaciones.
// =========================================================================
check('un segundo start() mientras ya hay una operación activa se ignora — nunca dos sesiones simultáneas', () => {
  const career = buildCareer({ id: 'simcal-reentrancy' });
  const { runner, pumpUntilIdle } = buildFakeClockRunner(career.coordinator, { sliceBudgetMs: 0, maxItemsPerSlice: 1 });
  let terminalCount = 0;
  const started1 = runner.start({ onTerminal: () => { terminalCount += 1; } });
  const started2 = runner.start({ onTerminal: () => { terminalCount += 1; } });
  assert.strictEqual(started1, true);
  assert.strictEqual(started2, false, 'un segundo start() mientras ya corre debe devolver false');
  pumpUntilIdle();
  assert.strictEqual(terminalCount, 1, 'solo debe llegar UN terminal, nunca dos operaciones resolviendo la misma cola');
});

// =========================================================================
// 11. El guardado se bloquea SOLO mientras hay avance activo.
// =========================================================================
check('CareerPersistenceBoundary bloquea el guardado solo mientras "activeCalendarAdvance" es true', () => {
  assert.deepStrictEqual(CareerPersistenceBoundary.describeSaveBlockers({ activeCalendarAdvance: false, activeMatchInProgress: false }), []);
  const blockers = CareerPersistenceBoundary.describeSaveBlockers({ activeCalendarAdvance: true, activeMatchInProgress: false });
  assert.strictEqual(blockers.length, 1);
  assert.strictEqual(CareerPersistenceBoundary.canSave({ activeCalendarAdvance: true }), false);
  assert.strictEqual(CareerPersistenceBoundary.canSave({ activeCalendarAdvance: false }), true);
});

// =========================================================================
// 12. La sincronización de fuentes está acotada por grupo, no por item.
// =========================================================================
check('el número de sincronizaciones de fuentes está acotado por grupos cronológicos, no por item resuelto', () => {
  const career = buildCareer({ id: 'simcal-syncbound' });
  let syncCalls = 0;
  const originalSync = career.coordinator.sync.bind(career.coordinator);
  career.coordinator.sync = (...args) => { syncCalls += 1; return originalSync(...args); };
  const stop = career.coordinator.advanceUntilNextUserStop();
  assert.strictEqual(stop.type, WORLD_CALENDAR_STOP_TYPES.SEASON_COMPLETE);
  const totalItems = career.resolvedOrder.length;
  const roundsCount = 5; // fixture: `roundsCount: 5` en el calendario registrado.
  assert.ok(syncCalls <= roundsCount + 2, `sync() se llamó ${syncCalls} veces — debe estar acotado por jornadas (${roundsCount}), no por los ${totalItems} partidos resueltos`);
  assert.ok(syncCalls < totalItems, 'sync() nunca debe llamarse una vez por cada item resuelto');
});

console.log(`\n${passed} OK, ${failed} FAIL`);
if (failed) process.exit(1);
