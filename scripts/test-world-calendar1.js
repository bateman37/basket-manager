// scripts/test-world-calendar1.js
// WORLD-CALENDAR-1 (DESIGN.md 10.14) — batería DIRIGIDA (sección 17.1 del
// prompt), ~25 checks rápidos, no exhaustiva. Reutiliza el fixture de mundo
// ficticio de `test-comp-core1.js` (nunca España) para todo lo que no sea
// específicamente la migración del contenido español. Convención del
// proyecto: identificadores en inglés, comentarios en español.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { GameDateTime } = require('../src/utils/GameDateTime.js');
const { CompetitionScheduleDefinition } = require('../src/entities/CompetitionSchedule.js');
const { CompetitionScheduleCatalog } = require('../src/core/CompetitionScheduleCatalog.js');
const { CompetitionScheduleService } = require('../src/core/CompetitionScheduleService.js');
const { WorldCalendar, WorldCalendarItem } = require('../src/core/WorldCalendar.js');
const {
  WorldCalendarCoordinator, WORLD_CALENDAR_STOP_TYPES, WORLD_CALENDAR_SOURCE_TYPES,
  createCompetitionMatchSource,
} = require('../src/core/WorldCalendarCoordinator.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const { CompetitionDefinition } = require('../src/entities/Competition.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const { CompetitionEngine, buildEditionId, buildStageId } = require('../src/core/CompetitionEngine.js');
const { BracketStageRunner, VENUE_PATTERNS } = require('../src/core/CompetitionRunners.js');
const { generateFictionalTeams } = require('../src/utils/teamGenerator.js');

// La auditoría de literales se hace sobre CÓDIGO, nunca sobre comentarios:
// la documentación de esta entrega sí nombra ACB/Primera FEB/España para
// explicar qué se migró (mismo criterio que `test-comp-core1.js`).
function stripComments(source) {
  // Primero los comentarios de LÍNEA y solo después los de bloque: hay
  // comentarios de línea que contienen `/*` (rutas tipo `src/core/*`), y
  // quitar bloques antes se comía medio archivo.
  return source
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

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

const TZ_TEST = 'Europe/Madrid';
const TZ_OTHER = 'America/New_York';

// =========================================================================
// 1. `GameDateTime` — instante canónico, husos y frontera DST
// =========================================================================
check('GameDateTime: instante canónico ISO UTC, validación descriptiva y comparación por instante', () => {
  assert.strictEqual(GameDateTime.requireInstant('2026-10-03T19:00:00Z'), '2026-10-03T19:00:00Z');
  assert.strictEqual(GameDateTime.requireInstant(new Date('2026-10-03T19:00:00.000Z')), '2026-10-03T19:00:00Z');
  assert.throws(() => GameDateTime.requireInstant('2026-10-03 19:00'), /no es un instante ISO 8601 UTC/);
  assert.throws(() => GameDateTime.requireInstant('2026-10-03T19:00:00+02:00'), /terminado en "Z"/);
  assert.throws(() => GameDateTime.requireTimeZoneId('Europe/Atlantis'), /huso horario IANA inválido/);
  assert.strictEqual(GameDateTime.compare('2026-10-03T19:00:00Z', '2026-10-03T21:00:00Z'), -1);
  assert.strictEqual(GameDateTime.compare('2026-10-03T19:00:00Z', '2026-10-03T19:00:00Z'), 0);
  // 21:00 en Madrid y 15:00 en Nueva York son el MISMO instante: la
  // comparación es por instante, nunca por fecha civil.
  assert.strictEqual(
    GameDateTime.fromZonedParts({ year: 2026, month: 10, day: 3, hour: 21 }, TZ_TEST),
    GameDateTime.fromZonedParts({ year: 2026, month: 10, day: 3, hour: 15 }, TZ_OTHER),
  );
});

check('GameDateTime: día normal vs frontera de cambio horario (mismo horario civil, instante distinto)', () => {
  // Europe/Madrid pasa de UTC+2 a UTC+1 en la madrugada del 25/10/2026.
  const beforeDst = GameDateTime.fromZonedParts({ year: 2026, month: 10, day: 24, hour: 21 }, TZ_TEST);
  const afterDst = GameDateTime.fromZonedParts({ year: 2026, month: 10, day: 25, hour: 21 }, TZ_TEST);
  assert.strictEqual(beforeDst, '2026-10-24T19:00:00Z');
  assert.strictEqual(afterDst, '2026-10-25T20:00:00Z');
  // Sumar UN DÍA DE CALENDARIO conserva la hora civil (no son 24h ciegas):
  // el día del cambio tiene 25 horas reales.
  assert.strictEqual(GameDateTime.addLocalDays(beforeDst, 1, TZ_TEST), afterDst);
  assert.notStrictEqual(new Date(afterDst).getTime() - new Date(beforeDst).getTime(), 24 * 3600 * 1000);
  // Un día normal sí son 24h.
  const d1 = GameDateTime.fromZonedParts({ year: 2027, month: 1, day: 15, hour: 21 }, TZ_TEST);
  assert.strictEqual(
    new Date(GameDateTime.addLocalDays(d1, 1, TZ_TEST)).getTime() - new Date(d1).getTime(), 24 * 3600 * 1000,
  );
  // Fecha civil e inicio de día se resuelven con el huso DECLARADO.
  assert.strictEqual(GameDateTime.localDateAt('2026-10-03T22:30:00Z', TZ_TEST), '2026-10-04');
  assert.strictEqual(GameDateTime.localDateAt('2026-10-03T22:30:00Z', TZ_OTHER), '2026-10-03');
  assert.strictEqual(GameDateTime.startOfLocalDay('2026-10-03', TZ_TEST), '2026-10-02T22:00:00Z');
});

// =========================================================================
// 2. Determinismo entre husos del PROCESO (BUG-WORLDCALENDAR-03)
// =========================================================================
check('el mismo contenido produce el MISMO calendario bajo dos variables TZ distintas del proceso', () => {
  const script = `
    const { CompetitionScheduleCatalog } = require('${path.resolve(__dirname, '../src/core/CompetitionScheduleCatalog.js')}');
    const { CompetitionScheduleService } = require('${path.resolve(__dirname, '../src/core/CompetitionScheduleService.js')}');
    const spain = require('${path.resolve(__dirname, '../data/world/spain-2026.1.js')}');
    spain.registerSpainSchedules();
    const svc = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
    const out = [];
    ['spain-2026.1:schedule:1a', 'spain-2026.1:schedule:2a'].forEach((id) => {
      const def = CompetitionScheduleCatalog.requireSchedule(id);
      const rr = svc.buildRoundRobinResolver(def, 'regular-season', { seasonStartYear: 2026 });
      [1, 8, 16, 17, 18, 34].forEach((round) => {
        for (let i = 0; i < 9; i++) out.push(rr({ round, matchIndexInRound: i, matchesInRound: 9, totalRounds: 34 }).scheduledAt);
      });
    });
    const cup = svc.buildBracketResolver(CompetitionScheduleCatalog.requireSchedule('spain-2026.1:schedule:copa-acb'), 'knockout', { seasonStartYear: 2026 });
    [0, 1, 2].forEach((r) => out.push(cup(r, 0).scheduledAt));
    const po = svc.buildBracketResolver(CompetitionScheduleCatalog.requireSchedule('spain-2026.1:schedule:1a'), 'title-playoff', { seasonStartYear: 2026 });
    [0, 1, 2].forEach((r) => { for (let g = 0; g < 5; g++) out.push(po(r, g).scheduledAt); });
    process.stdout.write(JSON.stringify(out));
  `;
  const run = (tz) => execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz } }).toString();
  const utc = run('UTC');
  const madrid = run('Europe/Madrid');
  const tokyo = run('Asia/Tokyo');
  assert.strictEqual(utc, madrid, 'el calendario debe ser idéntico con TZ=UTC y TZ=Europe/Madrid');
  assert.strictEqual(utc, tokyo, 'el calendario debe ser idéntico con TZ=UTC y TZ=Asia/Tokyo');
  assert.ok(JSON.parse(utc).length > 100);
});

check('el calendario español migrado reproduce EXACTAMENTE el de `Calendar.js` (mismo resultado observable)', () => {
  // Se ejecuta en un proceso con TZ=Europe/Madrid: `Calendar.js` legacy
  // construye con el huso del proceso, así que solo ahí son comparables —
  // esa es precisamente la diferencia que corrige BUG-WORLDCALENDAR-03.
  const script = `
    const { Calendar } = require('${path.resolve(__dirname, '../src/core/Calendar.js')}');
    const { CONFIG_BASE } = require('${path.resolve(__dirname, '../src/core/MatchConfig.js')}');
    const { CompetitionScheduleCatalog } = require('${path.resolve(__dirname, '../src/core/CompetitionScheduleCatalog.js')}');
    const { CompetitionScheduleService } = require('${path.resolve(__dirname, '../src/core/CompetitionScheduleService.js')}');
    const spain = require('${path.resolve(__dirname, '../data/world/spain-2026.1.js')}');
    spain.registerSpainSchedules();
    const svc = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
    const cal = new Calendar(2026, CONFIG_BASE);
    let diffs = 0; let checked = 0;
    ['spain-2026.1:schedule:1a', 'spain-2026.1:schedule:2a'].forEach((id) => {
      const rr = svc.buildRoundRobinResolver(CompetitionScheduleCatalog.requireSchedule(id), 'regular-season', { seasonStartYear: 2026 });
      for (let round = 1; round <= 34; round++) {
        for (let i = 0; i < 9; i++) {
          checked += 1;
          const legacy = cal.leagueMatchDateTime(round, i, 9, 34, id).getTime();
          if (legacy !== rr({ round, matchIndexInRound: i, matchesInRound: 9, totalRounds: 34 }).scheduledDate.getTime()) diffs += 1;
        }
      }
    });
    const cupLegacy = cal.cupRoundDates();
    const cup = svc.buildBracketResolver(CompetitionScheduleCatalog.requireSchedule('spain-2026.1:schedule:copa-acb'), 'knockout', { seasonStartYear: 2026 });
    [0, 1, 2].forEach((r) => { checked += 1; if (cupLegacy[r].getTime() !== cup(r, 0).scheduledDate.getTime()) diffs += 1; });
    const start = cal.titlePlayoffStartDate(cal.leagueRoundDate(34));
    const poLegacy = cal.buildBracketDateResolver(start, [['b','w','b'], ['b','b','w','w','b'], ['b','b','w','w','b']]);
    const po = svc.buildBracketResolver(CompetitionScheduleCatalog.requireSchedule('spain-2026.1:schedule:1a'), 'title-playoff', { seasonStartYear: 2026 });
    for (let r = 0; r < 3; r++) for (let g = 0; g < 5; g++) { checked += 1; if (poLegacy(r, g).getTime() !== po(r, g).scheduledDate.getTime()) diffs += 1; }
    const promoLegacy = cal.buildBracketDateResolver(start, [['b','b','w','w','b'], ['b'], ['b']]);
    const qf = svc.buildBracketResolver(CompetitionScheduleCatalog.requireSchedule('spain-2026.1:schedule:2a'), 'promotion-quarterfinals', { seasonStartYear: 2026 });
    const ff = svc.buildBracketResolver(CompetitionScheduleCatalog.requireSchedule('spain-2026.1:schedule:2a'), 'promotion-final-four', { seasonStartYear: 2026 });
    for (let g = 0; g < 5; g++) { checked += 1; if (promoLegacy(0, g).getTime() !== qf(0, g).scheduledDate.getTime()) diffs += 1; }
    for (let r = 0; r < 2; r++) { checked += 1; if (promoLegacy(r + 1, 0).getTime() !== ff(r, 0).scheduledDate.getTime()) diffs += 1; }
    process.stdout.write(JSON.stringify({ checked, diffs }));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'Europe/Madrid' } }).toString());
  assert.ok(out.checked > 600, `se esperaban más de 600 fechas comparadas, hubo ${out.checked}`);
  assert.strictEqual(out.diffs, 0, `${out.diffs} fechas difieren del calendario histórico`);
});

// =========================================================================
// 3. Schedules como contenido versionado
// =========================================================================
const FIXTURE_TZ = 'Europe/Lisbon';
function fixtureScheduleData(id, { version = '1.0.0', roundsCount = 6 } = {}) {
  return {
    id,
    version,
    status: 'fictional-test',
    timeZoneId: FIXTURE_TZ,
    seasonAnchor: { month: 9, day: 5 },
    provenance: { dataSource: 'test-fixture', status: 'design' },
    plans: {
      'regular-season': {
        strategy: 'round-robin-cadence',
        params: {
          roundsCount,
          daysBetweenRounds: 7,
          weekendSlots: [{ dayOffset: 0, hour: 18, minute: 0, weight: 1 }],
          midweek: null,
          lastRoundSlot: { dayOffset: 0, hour: 20, minute: 0 },
        },
      },
      playoff: {
        strategy: 'bracket-offsets',
        params: {
          anchor: {
            type: 'round-robin-round', planKey: 'regular-season', round: 'last', offsetDays: 4,
          },
          offsetPolicy: 'series-cadence',
          roundPatternLengths: [1, 1],
          seriesGameGapDays: 2,
          seriesRoundGapDays: 3,
          kickoff: { hour: 19, minute: 30 },
        },
      },
    },
  };
}

check('CompetitionScheduleDefinition: inmutable, serializable y con procedencia honesta (no oficial)', () => {
  const def = new CompetitionScheduleDefinition(fixtureScheduleData('test:schedule:a'));
  // Congelada: una asignación no cambia nada (en modo no estricto falla en
  // silencio, así que se comprueba el VALOR, no la excepción).
  def.timeZoneId = 'UTC';
  def.plans['regular-season'].params.daysBetweenRounds = 3;
  assert.strictEqual(def.timeZoneId, FIXTURE_TZ);
  assert.strictEqual(def.plans['regular-season'].params.daysBetweenRounds, 7);
  assert.ok(Object.isFrozen(def) && Object.isFrozen(def.plans) && Object.isFrozen(def.plans['regular-season'].params));
  const json = def.toJSON();
  assert.strictEqual(JSON.stringify(json).includes('"isReal":false'), true);
  assert.ok(/no es el calendario oficial/i.test(json.provenance.notes));
  assert.deepStrictEqual(Object.keys(json.plans).sort(), ['playoff', 'regular-season']);
  // Serializable sin Map/funciones/ciclos.
  assert.strictEqual(typeof JSON.parse(JSON.stringify(json)), 'object');
  // Una fase sin plan FALLA de forma descriptiva; nunca hereda otro perfil.
  assert.throws(() => def.getPlan('cup'), /no declara plan de calendario para la fase "cup"/);
  assert.throws(
    () => new CompetitionScheduleDefinition({ ...fixtureScheduleData('test:schedule:bad'), plans: { x: { strategy: 'magic', params: {} } } }),
    /estrategia desconocida/,
  );
});

check('CompetitionScheduleCatalog: idempotente por id+version, error ante otra versión o contenido distinto', () => {
  CompetitionScheduleCatalog.registerSchedule(fixtureScheduleData('test:schedule:catalog'));
  // Mismo id + misma version + mismo contenido -> idempotente.
  const again = CompetitionScheduleCatalog.registerSchedule(fixtureScheduleData('test:schedule:catalog'));
  assert.strictEqual(again, CompetitionScheduleCatalog.requireSchedule('test:schedule:catalog'));
  assert.throws(
    () => CompetitionScheduleCatalog.registerSchedule(fixtureScheduleData('test:schedule:catalog', { version: '2.0.0' })),
    /ya está registrado con la versión/,
  );
  assert.throws(
    () => CompetitionScheduleCatalog.registerSchedule(fixtureScheduleData('test:schedule:catalog', { roundsCount: 10 })),
    /con un CONTENIDO distinto/,
  );
  assert.throws(
    () => CompetitionScheduleCatalog.requireSchedule('test:schedule:nope'),
    /calendario desconocido "test:schedule:nope"/,
  );
  // Orden estable por id (nunca inserción de Map).
  const ids = CompetitionScheduleCatalog.allSchedules().map((s) => s.id);
  assert.deepStrictEqual(ids, [...ids].sort());
});

check('CompetitionScheduleService: cadencia round-robin y offsets de bracket con ancla PLANA a otro plan', () => {
  const svc = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
  const def = CompetitionScheduleCatalog.requireSchedule('test:schedule:catalog');
  const rr = svc.buildRoundRobinResolver(def, 'regular-season', { seasonStartYear: 2030 });
  const r1 = rr({ round: 1, matchIndexInRound: 0, matchesInRound: 2, totalRounds: 6 });
  assert.strictEqual(r1.scheduledLocalDate, '2030-09-05');
  assert.strictEqual(r1.timeZoneId, FIXTURE_TZ);
  assert.strictEqual(rr({ round: 3, matchIndexInRound: 0, matchesInRound: 2, totalRounds: 6 }).scheduledLocalDate, '2030-09-19');
  // Última jornada: franja unificada declarada por el contenido.
  assert.strictEqual(rr({ round: 6, matchIndexInRound: 0, matchesInRound: 2, totalRounds: 6 }).scheduledLocalTime, '20:00');
  // Un formato que genere otro nº de jornadas que el declarado FALLA.
  assert.throws(
    () => rr({ round: 1, matchIndexInRound: 0, matchesInRound: 2, totalRounds: 8 }),
    /calendario y formato deben coincidir/,
  );
  // Bracket: ancla = última jornada (6) + 4 días -> 2030-10-14.
  const br = svc.buildBracketResolver(def, 'playoff', { seasonStartYear: 2030 });
  assert.strictEqual(br(0, 0).scheduledLocalDate, '2030-10-14');
  assert.strictEqual(br(0, 0).scheduledLocalTime, '19:30');
  assert.strictEqual(br(1, 0).scheduledLocalDate, '2030-10-17'); // +seriesRoundGapDays
  assert.throws(() => br(5, 0), /no declara offset para la ronda/);
});

// =========================================================================
// 4. `WorldCalendarItem` / `WorldCalendar` — id estable, orden total
// =========================================================================
function matchItemData(id, instant, teamIds) {
  return {
    sourceType: WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH,
    sourceId: id,
    moment: { precision: 'instant', instant, timeZoneId: TZ_TEST },
    attentionScope: { teamIds, clubIds: [] },
    metadata: { kind: 'match', matchId: id },
  };
}

check('WorldCalendarItem: id estable derivado de la fuente, precisión explícita y serializable', () => {
  const a = new WorldCalendarItem(matchItemData('match:x', '2026-10-03T19:00:00Z', ['t1', 't2']));
  assert.strictEqual(a.id, 'competition-match:match:x');
  assert.strictEqual(a.orderingInstant, '2026-10-03T19:00:00Z');
  assert.ok(a.involvesTeam('t1') && !a.involvesTeam('t9'));
  // Una fecha CIVIL conserva su precisión y se ordena al INICIO de su día
  // en el huso declarado (nunca se le inventa una hora persistida).
  const b = new WorldCalendarItem({
    sourceType: WORLD_CALENDAR_SOURCE_TYPES.MARKET_EVENT,
    sourceId: 'ev1',
    moment: { precision: 'date', localDate: '2026-10-03', timeZoneId: TZ_TEST },
    metadata: { requiresAttention: true },
  });
  assert.strictEqual(b.momentPrecision, 'date');
  assert.strictEqual(b.instant, null);
  assert.strictEqual(b.localDate, '2026-10-03');
  assert.strictEqual(b.orderingInstant, '2026-10-02T22:00:00Z');
  assert.strictEqual(typeof JSON.parse(JSON.stringify(b.toJSON())), 'object');
  assert.throws(() => new WorldCalendarItem({ sourceType: 's', sourceId: '1', moment: { precision: 'week' } }), /moment.precision/);
});

check('WorldCalendar: orden TOTAL estable e independiente del orden de inserción', () => {
  const build = (order) => {
    const cal = new WorldCalendar({ id: 'cal', defaultTimeZoneId: TZ_TEST, initialInstant: '2026-01-01T00:00:00Z' });
    cal.syncSource(WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH, order.map((o) => matchItemData(o[0], o[1], ['t1'])));
    return cal.pendingItemsOrdered().map((i) => i.id);
  };
  const rows = [
    ['m:c', '2026-10-03T19:00:00Z'],
    ['m:a', '2026-10-03T19:00:00Z'],
    ['m:b', '2026-10-02T19:00:00Z'],
  ];
  const forward = build(rows);
  const reversed = build([...rows].reverse());
  const shuffled = build([rows[1], rows[2], rows[0]]);
  assert.deepStrictEqual(forward, ['competition-match:m:b', 'competition-match:m:a', 'competition-match:m:c']);
  assert.deepStrictEqual(forward, reversed);
  assert.deepStrictEqual(forward, shuffled);
});

check('WorldCalendar: cursor monotónico, temporadas encadenadas y `validateIntegrity` detecta pendientes detrás del cursor', () => {
  const cal = new WorldCalendar({ id: 'cal', defaultTimeZoneId: TZ_TEST, initialInstant: '2026-09-01T00:00:00Z' });
  assert.strictEqual(cal.advanceTo('2026-10-03T19:00:00Z'), true);
  assert.strictEqual(cal.advanceTo('2026-09-15T19:00:00Z'), false, 'el cursor nunca retrocede');
  assert.strictEqual(cal.currentInstant, '2026-10-03T19:00:00Z');
  cal.registerSeason({ seasonKey: '2026-27', startInstant: '2026-09-01T00:00:00Z', timeZoneId: TZ_TEST });
  cal.registerSeason({ seasonKey: '2027-28', startInstant: '2027-09-01T00:00:00Z', timeZoneId: TZ_TEST });
  assert.strictEqual(cal.currentSeasonKey, '2027-28');
  assert.throws(
    () => cal.registerSeason({ seasonKey: '2025-26', startInstant: '2025-09-01T00:00:00Z', timeZoneId: TZ_TEST }),
    /el calendario nunca retrocede/,
  );
  assert.deepStrictEqual(cal.validateIntegrity(), []);
  // Un pendiente fechado ANTES del cursor es un error de integridad.
  cal.syncSource(WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH, [matchItemData('m:old', '2026-09-20T19:00:00Z', ['t1'])]);
  const errors = cal.validateIntegrity();
  assert.strictEqual(errors.length, 1);
  assert.ok(/ANTES del cursor/.test(errors[0]));
});

check('WorldCalendar: `syncSource` idempotente, ledger acotado y snapshot plano', () => {
  const cal = new WorldCalendar({
    id: 'cal', defaultTimeZoneId: TZ_TEST, initialInstant: '2026-01-01T00:00:00Z', ledgerMax: 2,
  });
  const rows = [matchItemData('m:1', '2026-10-03T19:00:00Z', ['t1']), matchItemData('m:2', '2026-10-04T19:00:00Z', ['t2'])];
  cal.syncSource(WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH, rows);
  const first = cal.getItem('competition-match:m:1');
  cal.syncSource(WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH, rows);
  assert.strictEqual(cal.getItem('competition-match:m:1'), first, 'sincronizar dos veces no duplica ni recrea el item');
  assert.strictEqual(cal.pendingItemsOrdered().length, 2);
  // Lo que la fuente deja de listar deja de estar pendiente.
  cal.syncSource(WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH, [rows[1]]);
  assert.strictEqual(cal.pendingItemsOrdered().length, 1);
  cal.markCompleted('competition-match:m:2');
  assert.strictEqual(cal.pendingItemsOrdered().length, 0);
  assert.strictEqual(cal.ledger.length, 1);
  const snap = cal.snapshot();
  assert.strictEqual(typeof JSON.parse(JSON.stringify(snap)), 'object');
  assert.strictEqual(snap.defaultTimeZoneId, TZ_TEST);
  assert.strictEqual(cal.retireLedger(), 1);
  assert.strictEqual(cal.ledger.length, 0);
  assert.throws(() => new WorldCalendar({ id: 'x' }), /defaultTimeZoneId/);
});

// =========================================================================
// 5. Coordinador: dos competiciones ficticias simultáneas (sin España)
// =========================================================================
function buildFictionalWorld({ id, teamCount = 4 }) {
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
  const teams = generateFictionalTeams(teamCount, { seed: `${id}-teams` });
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
  return { world, teams };
}

const TWO_COMPETITION_FORMAT = 'test-worldcal:format:single-round-robin';
function registerTwoCompetitionFixtures() {
  if (!FormatCatalog.hasFormat(TWO_COMPETITION_FORMAT)) {
    FormatCatalog.registerFormat({
      id: TWO_COMPETITION_FORMAT,
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
          legs: 1,
          pointsWin: 2,
          pointsLoss: 1,
          tiebreakSteps: [{ type: 'overall-point-diff' }],
        },
        completesEdition: true,
      }],
    });
  }
  // DOS calendarios ficticios distintos, con anclas separadas un día: la
  // cola global los mezcla por FECHA, sin ningún literal español.
  [['test-worldcal:schedule:alpha', 5], ['test-worldcal:schedule:beta', 6]].forEach(([scheduleId, day]) => {
    if (CompetitionScheduleCatalog.hasSchedule(scheduleId)) return;
    CompetitionScheduleCatalog.registerSchedule({
      id: scheduleId,
      version: '1.0.0',
      status: 'fictional-test',
      timeZoneId: FIXTURE_TZ,
      seasonAnchor: { month: 9, day },
      provenance: { dataSource: 'test-fixture', status: 'design' },
      plans: {
        'regular-season': {
          strategy: 'round-robin-cadence',
          params: {
            roundsCount: 3,
            daysBetweenRounds: 7,
            weekendSlots: [{ dayOffset: 0, hour: 18, minute: 0, weight: 1 }],
            midweek: null,
            lastRoundSlot: { dayOffset: 0, hour: 18, minute: 0 },
          },
        },
      },
    });
  });
}

function buildTwoCompetitionCareer({ controlledTeamIndex = null } = {}) {
  registerTwoCompetitionFixtures();
  const { world, teams } = buildFictionalWorld({ id: `world-worldcal-${Math.random().toString(36).slice(2)}` });
  const controlledTeamIds = controlledTeamIndex === null ? [] : [teams[controlledTeamIndex].id];
  ['alpha', 'beta'].forEach((key) => {
    world.registries.registerCompetitionDefinition(new CompetitionDefinition({
      id: `testland-${key}`,
      name: `[TEST] Testland ${key}`,
      scopeLevel: 'national',
      scopeAreaId: 'area-country-testland',
      organizerId: 'org-testland',
      participantType: 'club-team',
      kind: 'league',
      implementationStatus: 'active-runtime',
      bindings: { scheduleProfileId: `test-worldcal:schedule:${key}` },
    }));
  });
  const svc = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
  const engine = new CompetitionEngine({ world });
  engine.setDateResolverProvider(svc.buildDateResolverProvider({ seasonStartYearForEdition: () => 2030 }));
  ['alpha', 'beta'].forEach((key) => {
    engine.registerEditionWithInitialEntries({
      competitionDefinitionId: `testland-${key}`,
      seasonKey: '2030-31',
      formatBindingId: TWO_COMPETITION_FORMAT,
      participants: teams.map((t) => ({ id: t.id })),
      detailLevel: 'playable', // WORLD-SIM-1: nivel obligatorio, fixture histórica sin cambio de comportamiento
    });
    engine.initializeEdition(buildEditionId(`testland-${key}`, '2030-31'));
  });
  const calendar = new WorldCalendar({
    id: 'cal-worldcal', defaultTimeZoneId: FIXTURE_TZ, initialInstant: '2030-09-01T00:00:00Z',
  });
  calendar.registerSeason({ seasonKey: '2030-31', startInstant: '2030-09-01T00:00:00Z', timeZoneId: FIXTURE_TZ });
  const resolved = [];
  const coordinator = new WorldCalendarCoordinator({
    calendar,
    sources: [createCompetitionMatchSource({
      engine,
      timeZoneId: FIXTURE_TZ,
      resolveMatch: ({ stageId, matchId }) => {
        engine.resolveMatch(stageId, matchId, {});
        resolved.push(matchId);
      },
    })],
    controlledTeamIds,
    controlledClubIds: [],
  });
  return {
    world, teams, engine, calendar, coordinator, resolved,
  };
}

check('un Team participa en DOS competiciones simultáneas y la cola las mezcla por FECHA (sin España)', () => {
  const career = buildTwoCompetitionCareer({});
  career.coordinator.sync();
  const pending = career.calendar.pendingItemsOrdered();
  const alphaDates = pending.filter((i) => i.metadata.competitionDefinitionId === 'testland-alpha').map((i) => i.localDate);
  const betaDates = pending.filter((i) => i.metadata.competitionDefinitionId === 'testland-beta').map((i) => i.localDate);
  assert.ok(alphaDates.length && betaDates.length, 'ambas competiciones deben aportar partidos');
  // Anclas separadas un día -> la cola alterna alpha/beta, jamás "primero
  // toda una competición y después la otra".
  const sequence = pending.map((i) => i.metadata.competitionDefinitionId);
  let alternations = 0;
  for (let i = 1; i < sequence.length; i++) if (sequence[i] !== sequence[i - 1]) alternations += 1;
  assert.ok(alternations >= 2, `las dos competiciones deben intercalarse (alternancias: ${alternations})`);
  // Un mismo Team tiene Entries en las dos.
  const entries = career.world.registries.competitionEntries.forParticipant(career.teams[0].id);
  assert.strictEqual(new Set(entries.map((e) => e.editionId)).size, 2);
});

check('Continuar: los CPU anteriores se resuelven solos, el partido del usuario es parada y no se auto-resuelve', () => {
  // Sin ningún equipo controlado, TODO es automático: "Continuar" completa
  // la temporada sola y nunca pide intervención (invariante 13: un
  // CPU-vs-CPU nunca exige al usuario).
  const career = buildTwoCompetitionCareer({});
  const stop = career.coordinator.advanceUntilNextUserStop();
  assert.strictEqual(stop.type, WORLD_CALENDAR_STOP_TYPES.SEASON_COMPLETE);
  assert.strictEqual(career.calendar.pendingItemsOrdered().length, 0);
  assert.ok(career.resolved.length >= 12, `debe haber resuelto los partidos de las dos competiciones (${career.resolved.length})`);

  // Con un equipo controlado real: se detiene EXACTAMENTE en su partido.
  const career3 = buildTwoCompetitionCareer({ controlledTeamIndex: 0 });
  const controlled = career3.teams[0].id;
  const stop3 = career3.coordinator.advanceUntilNextUserStop();
  assert.strictEqual(stop3.type, WORLD_CALENDAR_STOP_TYPES.USER_MATCH);
  assert.ok(
    stop3.item.metadata.homeParticipantId === controlled || stop3.item.metadata.awayParticipantId === controlled,
    'la parada debe ser un partido del equipo controlado',
  );
  // El partido del usuario NO se ha resuelto (invariante 14).
  assert.ok(!career3.resolved.includes(stop3.item.metadata.matchId));
  const runner = career3.engine.getRunner(stop3.item.metadata.stageId);
  assert.strictEqual(runner.getMatchById(stop3.item.metadata.matchId).status, 'pending');
  // Los CPU del MISMO instante tampoco (invariante 15: no se revelan antes).
  stop3.simultaneous.forEach((other) => {
    const otherRunner = career3.engine.getRunner(other.metadata.stageId);
    assert.strictEqual(otherRunner.getMatchById(other.metadata.matchId).status, 'pending');
  });
  // Tras el commit del usuario, los CPU simultáneos SÍ se resuelven, sin
  // que el cursor pase de ese instante.
  const instant = stop3.item.orderingInstant;
  career3.engine.resolveMatch(stop3.item.metadata.stageId, stop3.item.metadata.matchId, {});
  career3.coordinator.completeUserItem(stop3.item.id);
  const after = career3.coordinator.resolveSimultaneousAfterUserCommit(instant);
  assert.strictEqual(after.failure, null);
  assert.strictEqual(career3.calendar.currentInstant, instant, 'el cursor no debe adelantarse al resolver los simultáneos');
  assert.strictEqual(career3.calendar.pendingItemsAt(instant).length, 0);
});

check('conflicto: dos partidos del MISMO equipo controlado en el MISMO instante bloquean con aviso explícito', () => {
  registerTwoCompetitionFixtures();
  // Mismo ancla en los dos calendarios -> los dos partidos del equipo
  // controlado caen en el MISMO instante.
  if (!CompetitionScheduleCatalog.hasSchedule('test-worldcal:schedule:clash')) {
    CompetitionScheduleCatalog.registerSchedule({
      id: 'test-worldcal:schedule:clash',
      version: '1.0.0',
      status: 'fictional-test',
      timeZoneId: FIXTURE_TZ,
      seasonAnchor: { month: 9, day: 5 },
      provenance: { dataSource: 'test-fixture', status: 'design' },
      plans: {
        'regular-season': {
          strategy: 'round-robin-cadence',
          params: {
            roundsCount: 3,
            daysBetweenRounds: 7,
            weekendSlots: [{ dayOffset: 0, hour: 18, minute: 0, weight: 1 }],
            midweek: null,
            lastRoundSlot: { dayOffset: 0, hour: 18, minute: 0 },
          },
        },
      },
    });
  }
  const { world, teams } = buildFictionalWorld({ id: `world-clash-${Math.random().toString(36).slice(2)}` });
  ['alpha', 'clash'].forEach((key) => {
    world.registries.registerCompetitionDefinition(new CompetitionDefinition({
      id: `clashland-${key}`,
      name: `[TEST] Clashland ${key}`,
      scopeLevel: 'national',
      scopeAreaId: 'area-country-testland',
      organizerId: 'org-testland',
      participantType: 'club-team',
      kind: 'league',
      implementationStatus: 'active-runtime',
      bindings: { scheduleProfileId: key === 'alpha' ? 'test-worldcal:schedule:clash' : 'test-worldcal:schedule:clash' },
    }));
  });
  const svc = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
  const engine = new CompetitionEngine({ world });
  engine.setDateResolverProvider(svc.buildDateResolverProvider({ seasonStartYearForEdition: () => 2030 }));
  ['alpha', 'clash'].forEach((key) => {
    engine.registerEditionWithInitialEntries({
      competitionDefinitionId: `clashland-${key}`,
      seasonKey: '2030-31',
      formatBindingId: TWO_COMPETITION_FORMAT,
      participants: teams.map((t) => ({ id: t.id })),
      detailLevel: 'playable',
    });
    engine.initializeEdition(buildEditionId(`clashland-${key}`, '2030-31'));
  });
  const calendar = new WorldCalendar({
    id: 'cal-clash', defaultTimeZoneId: FIXTURE_TZ, initialInstant: '2030-09-01T00:00:00Z',
  });
  const controlled = teams[0].id;
  const coordinator = new WorldCalendarCoordinator({
    calendar,
    sources: [createCompetitionMatchSource({
      engine, timeZoneId: FIXTURE_TZ, resolveMatch: ({ stageId, matchId }) => engine.resolveMatch(stageId, matchId, {}),
    })],
    controlledTeamIds: [controlled],
  });
  const stop = coordinator.advanceUntilNextUserStop();
  assert.strictEqual(stop.type, WORLD_CALENDAR_STOP_TYPES.SCHEDULE_CONFLICT);
  assert.strictEqual(stop.teamId, controlled);
  assert.strictEqual(stop.items.length, 2, 'el conflicto debe declarar los DOS partidos');
  assert.strictEqual(new Set(stop.items.map((i) => i.metadata.competitionDefinitionId)).size, 2, 'y sus dos competiciones');
  // No se simula ninguno de los dos.
  stop.items.forEach((item) => {
    const runner = engine.getRunner(item.metadata.stageId);
    assert.strictEqual(runner.getMatchById(item.metadata.matchId).status, 'pending');
  });
  // Y no se avanza más allá: volver a llamar devuelve el MISMO conflicto.
  assert.strictEqual(coordinator.advanceUntilNextUserStop().type, WORLD_CALENDAR_STOP_TYPES.SCHEDULE_CONFLICT);
});

check('una atención de FECHA CIVIL del mismo día se resuelve ANTES del partido de ese día', () => {
  const career = buildTwoCompetitionCareer({});
  career.coordinator.sync();
  const firstMatch = career.calendar.pendingItemsOrdered()[0];
  const matchLocalDate = firstMatch.localDate;
  // Fuente de eventos con fecha CIVIL en el MISMO día del partido.
  const dispatched = [];
  career.coordinator.registerSource({
    sourceType: WORLD_CALENDAR_SOURCE_TYPES.MARKET_EVENT,
    listPendingItems() {
      return dispatched.length ? [] : [{
        sourceId: 'deadline-1',
        moment: { precision: 'date', localDate: matchLocalDate, timeZoneId: FIXTURE_TZ },
        attentionScope: { teamIds: [], clubIds: ['club-x'] },
        metadata: { kind: 'market-event', requiresAttention: false },
      }];
    },
    resolveItem(item) { dispatched.push(item.sourceId); },
  });
  career.coordinator.sync();
  const ordered = career.calendar.pendingItemsOrdered();
  assert.strictEqual(ordered[0].sourceType, WORLD_CALENDAR_SOURCE_TYPES.MARKET_EVENT, 'la fecha civil se ordena al inicio de su día, antes del partido');
  assert.strictEqual(ordered[0].instant, null, 'una fecha civil NO recibe una hora inventada');
  career.coordinator.advanceUntilNextUserStop();
  assert.deepStrictEqual(dispatched, ['deadline-1'], 'el evento de fecha civil debe despacharse exactamente una vez');
});

check('un fallo de resolución deja el item pendiente/failed y NO adelanta el cursor por encima de él', () => {
  const career = buildTwoCompetitionCareer({});
  career.coordinator.sync();
  const target = career.calendar.pendingItemsOrdered()[0];
  const laterInstant = career.calendar.pendingItemsOrdered().slice(-1)[0].orderingInstant;
  // Fuente que SIEMPRE falla, fechada antes que todo lo demás.
  career.coordinator.registerSource({
    sourceType: WORLD_CALENDAR_SOURCE_TYPES.TRANSFER_EVENT,
    listPendingItems() {
      return [{
        sourceId: 'broken-1',
        moment: { precision: 'instant', instant: '2030-09-02T10:00:00Z', timeZoneId: FIXTURE_TZ },
        attentionScope: { teamIds: [], clubIds: [] },
        metadata: { kind: 'transfer-event' },
      }];
    },
    resolveItem() { throw new Error('servicio de dominio caído'); },
  });
  const stop = career.coordinator.advanceUntilNextUserStop();
  assert.strictEqual(stop.type, WORLD_CALENDAR_STOP_TYPES.RESOLUTION_FAILED);
  assert.ok(/servicio de dominio caído/.test(stop.error));
  const item = career.calendar.getItem('transfer-event:broken-1');
  assert.ok(item, 'el item NO desaparece');
  assert.strictEqual(item.status, 'failed');
  assert.strictEqual(career.calendar.currentInstant, '2030-09-02T10:00:00Z', 'el cursor se queda en el item que falló');
  assert.ok(GameDateTime.compare(career.calendar.currentInstant, laterInstant) < 0, 'y nunca lo salta');
  assert.ok(!career.resolved.length, 'no se resolvió ningún partido posterior');
  void target;
});

check('consultar/renderizar no muta, no materializa partidos y no consume aleatoriedad', () => {
  const career = buildTwoCompetitionCareer({});
  const originalRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => { randomCalls += 1; return originalRandom(); };
  try {
    const before = JSON.stringify(career.engine.snapshot());
    for (let i = 0; i < 3; i++) {
      career.engine.listAllPendingMatches();
      career.calendar.pendingItemsOrdered();
      career.coordinator.peekNextUserStopItem();
      career.coordinator.peekNextUserMatchItem();
      career.engine.listAllPendingMatches().forEach((d) => career.engine.listPendingMatches(d.stageId));
    }
    assert.strictEqual(JSON.stringify(career.engine.snapshot()), before, 'consultar no debe cambiar el estado del engine');
    assert.strictEqual(randomCalls, 0, 'consultar no debe consumir aleatoriedad');
  } finally {
    Math.random = originalRandom;
  }
});

// =========================================================================
// 6. Bracket: un pendiente por CADA serie viva, sin mutar al consultar
// =========================================================================
check('BracketStageRunner: expone un pendiente por CADA serie viva de la ronda, sin materializar al consultar', () => {
  const bracketTeams = generateFictionalTeams(4, { seed: 'worldcal-bracket-fixture' });
  const bracketTeamsById = new Map(bracketTeams.map((t) => [t.id, t]));
  const entries = bracketTeams.map((team, index) => ({ participantId: team.id, seed: index + 1, entryId: `e${index + 1}` }));
  const runner = new BracketStageRunner({
    stageId: 'stage:test:bracket',
    entries,
    firstRoundPairing: [[1, 4], [2, 3]],
    roundPatterns: [VENUE_PATTERNS.BEST_OF_3_1_1_1, VENUE_PATTERNS.SINGLE_GAME],
    dateResolver: (roundIndex, gameIndex) => ({
      scheduledAt: GameDateTime.fromZonedParts({
        year: 2030, month: 5, day: 1 + roundIndex * 7 + gameIndex * 2, hour: 20,
      }, TZ_TEST),
      timeZoneId: TZ_TEST,
    }),
    resolveParticipant: (id) => bracketTeamsById.get(id),
  });
  // Antes de esta entrega solo se exponía el PRIMER cruce del array.
  const pending = runner.listPendingMatches();
  assert.strictEqual(pending.length, 2, 'las DOS series vivas de la ronda deben aportar su pendiente');
  assert.strictEqual(new Set(pending.map((d) => d.seriesId)).size, 2);
  pending.forEach((d) => {
    assert.ok(GameDateTime.isInstant(d.scheduledAt));
    assert.strictEqual(d.timeZoneId, TZ_TEST);
  });
  // Consultar N veces no crea objetos nuevos ni avanza rondas.
  const snapshotBefore = JSON.stringify(runner.snapshot());
  for (let i = 0; i < 5; i++) { runner.listPendingMatches(); runner.peekNextPendingMatch(); }
  assert.strictEqual(JSON.stringify(runner.snapshot()), snapshotBefore);
  assert.strictEqual(runner.rounds.length, 1);
  // Al resolver un partido de una serie que continúa, el SIGUIENTE de esa
  // serie queda materializado ahí mismo.
  runner.resolveMatch(pending[0].id, {});
  const afterOne = runner.listPendingMatches();
  assert.strictEqual(afterOne.length, 2, 'la serie que continúa ya tiene su siguiente partido materializado');
  assert.ok(afterOne.some((d) => d.seriesId === pending[0].seriesId && d.gameNumber === 2));
  // Doble resolución sigue rechazada.
  assert.throws(() => runner.resolveMatch(pending[0].id, {}), /ya está jugado/);
});

check('CompetitionRuntimeRegistry/Engine: agregados ordenados por id, nunca por inserción de Map', () => {
  const career = buildTwoCompetitionCareer({});
  const stageIds = career.engine.runtimeRegistry.allStageIds();
  assert.deepStrictEqual(stageIds, [...stageIds].sort());
  const pending = career.engine.listAllPendingMatches();
  for (let i = 1; i < pending.length; i++) {
    const prev = pending[i - 1];
    const cur = pending[i];
    assert.ok(
      prev.scheduledAt < cur.scheduledAt || (prev.scheduledAt === cur.scheduledAt && prev.id <= cur.id),
      'el listado global debe estar ordenado por (instante, id)',
    );
  }
  assert.deepStrictEqual(
    Object.keys(career.engine.snapshot().stages),
    [...Object.keys(career.engine.snapshot().stages)].sort(),
  );
});

// =========================================================================
// 7. Una sola instancia de calendario entre dos temporadas
// =========================================================================
check('el cambio de temporada NO reemplaza el calendario: misma instancia y cursor que no retrocede', () => {
  const career = buildTwoCompetitionCareer({});
  const calendarRef = career.calendar;
  career.coordinator.advanceUntilNextUserStop();
  const endOfSeason = career.calendar.currentInstant;
  // Temporada siguiente sobre el MISMO calendario y el MISMO engine.
  ['alpha', 'beta'].forEach((key) => {
    career.engine.completePreviousEditions(`testland-${key}`);
    career.engine.registerEditionWithInitialEntries({
      competitionDefinitionId: `testland-${key}`,
      seasonKey: '2031-32',
      formatBindingId: TWO_COMPETITION_FORMAT,
      participants: career.teams.map((t) => ({ id: t.id })),
      detailLevel: 'playable',
    });
  });
  const svc = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
  career.engine.setDateResolverProvider(svc.buildDateResolverProvider({ seasonStartYearForEdition: () => 2031 }));
  ['alpha', 'beta'].forEach((key) => career.engine.initializeEdition(buildEditionId(`testland-${key}`, '2031-32')));
  career.calendar.registerSeason({ seasonKey: '2031-32', startInstant: '2031-09-01T00:00:00Z', timeZoneId: FIXTURE_TZ });
  career.calendar.retireLedger();
  career.coordinator.sync();
  assert.strictEqual(career.calendar, calendarRef, 'debe ser la MISMA instancia (invariante 3)');
  assert.strictEqual(career.calendar.seasons.length, 2);
  const pending = career.calendar.pendingItemsOrdered();
  assert.ok(pending.length > 0);
  assert.ok(
    GameDateTime.compare(pending[0].orderingInstant, endOfSeason) > 0,
    'el primer evento de la temporada nueva debe ser posterior al último de la anterior',
  );
  assert.deepStrictEqual(career.calendar.validateIntegrity(), []);
  assert.ok(GameDateTime.compare(career.calendar.currentInstant, endOfSeason) >= 0, 'el cursor no retrocede entre temporadas');
});

// =========================================================================
// 8. Auditoría ESTÁTICA: los módulos genéricos nuevos no conocen España
// =========================================================================
check('auditoría estática: ningún módulo genérico nuevo contiene literales de España/ACB/FEB/1ª/2ª', () => {
  const files = [
    'src/utils/GameDateTime.js',
    'src/entities/CompetitionSchedule.js',
    'src/core/CompetitionScheduleCatalog.js',
    'src/core/CompetitionScheduleService.js',
    'src/core/WorldCalendar.js',
    'src/core/WorldCalendarCoordinator.js',
  ];
  // `Europe/Madrid` es un huso IANA de contenido, no debe aparecer tampoco.
  const forbidden = [/\bACB\b/, /Primera FEB/i, /\bFEB\b/, /España/i, /Espana/i, /'1ª'/, /'2ª'/, /Europe\/Madrid/, /\bcopa\b/i, /spain/i];
  const offenders = [];
  files.forEach((relative) => {
    const content = stripComments(fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8'));
    forbidden.forEach((pattern) => {
      if (pattern.test(content)) offenders.push(`${relative}: ${pattern}`);
    });
  });
  assert.deepStrictEqual(offenders, [], `literales de contenido español en módulos genéricos: ${offenders.join(', ')}`);
});

check('auditoría estática: la orquestación productiva ya no usa jornada de fondo, drenaje de brackets ni `new Calendar`', () => {
  const gameJs = fs.readFileSync(path.resolve(__dirname, '../src/ui/game.js'), 'utf8');
  // Se ignoran los comentarios: la documentación del cambio SÍ nombra las
  // funciones retiradas.
  const code = stripComments(gameJs);
  [
    /function\s+simulateBackgroundRound/,
    /function\s+drainBackgroundBrackets/,
    /function\s+getBackgroundDivision/,
    /function\s+getBackgroundLeague/,
    /function\s+finishRoundBookkeeping/,
    /new\s+Calendar\s*\(/,
    /state\.leagues\s*=/,
    /state\.brackets\s*=/,
    /state\.calendar\.leagueMatchDateTime/,
    /state\.calendar\.cupRoundDates/,
    /state\.calendar\.buildBracketDateResolver/,
    /state\.calendar\.titlePlayoffStartDate/,
  ].forEach((pattern) => {
    assert.ok(!pattern.test(code), `la ruta productiva de game.js todavía contiene ${pattern}`);
  });
  // Y "Continuar" pasa exclusivamente por el coordinador.
  assert.ok(/state\.calendarCoordinator\.advanceUntilNextUserStop\(\)/.test(code));
  // `index.html` carga los módulos nuevos.
  const indexHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  ['GameDateTime.js', 'CompetitionSchedule.js', 'CompetitionScheduleCatalog.js', 'CompetitionScheduleService.js', 'WorldCalendar.js', 'WorldCalendarCoordinator.js']
    .forEach((file) => assert.ok(indexHtml.includes(file), `index.html debe cargar ${file}`));
});

check('auditoría estática: `Calendar.js` sigue existiendo como shim standalone, fuera de la ruta productiva', () => {
  const indexHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  // Se conserva cargado para el "modo prueba" técnico de index.html, pero
  // `game.js` ya no construye ninguno (comprobado arriba) y ningún módulo
  // nuevo lo importa.
  assert.ok(indexHtml.includes('src/core/Calendar.js'));
  ['src/core/WorldCalendar.js', 'src/core/WorldCalendarCoordinator.js', 'src/core/CompetitionScheduleService.js'].forEach((relative) => {
    const content = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.ok(!/require\(['"].*\/Calendar\.js['"]\)/.test(content), `${relative} no debe importar el Calendar legacy`);
  });
});

check('el contenido español declara sus calendarios (ids estables) y la Copa congela el suyo en la Edition', () => {
  const spain = require('../data/world/spain-2026.1.js');
  spain.registerSpainSchedules();
  assert.deepStrictEqual(Object.keys(spain.SPAIN_SCHEDULE_IDS).sort(), ['ACB', 'COPA_ACB', 'PRIMERA_FEB']);
  assert.strictEqual(spain.SPAIN_SCHEDULE_IDS.ACB, 'spain-2026.1:schedule:1a');
  assert.strictEqual(spain.SPAIN_SCHEDULE_IDS.PRIMERA_FEB, 'spain-2026.1:schedule:2a');
  assert.strictEqual(spain.SPAIN_TIME_ZONE_ID, 'Europe/Madrid');
  const acb = CompetitionScheduleCatalog.requireSchedule(spain.SPAIN_SCHEDULE_IDS.ACB);
  assert.deepStrictEqual(acb.planKeys.slice().sort(), ['regular-season', 'title-playoff']);
  const feb = CompetitionScheduleCatalog.requireSchedule(spain.SPAIN_SCHEDULE_IDS.PRIMERA_FEB);
  assert.deepStrictEqual(feb.planKeys.slice().sort(), ['promotion-final-four', 'promotion-quarterfinals', 'regular-season']);
  const copa = CompetitionScheduleCatalog.requireSchedule(spain.SPAIN_SCHEDULE_IDS.COPA_ACB);
  assert.deepStrictEqual(copa.planKeys.slice(), ['knockout']);
  // La ventana de Copa ancla en la jornada disparadora de OTRA definición,
  // por referencia PLANA (el scheduler no conoce ACB).
  const cupPlan = copa.getPlan('knockout');
  assert.strictEqual(cupPlan.params.anchor.scheduleId, spain.SPAIN_SCHEDULE_IDS.ACB);
  assert.strictEqual(cupPlan.params.anchor.round, spain.SPAIN_CUP_TRIGGER_ROUND);
  assert.strictEqual(cupPlan.params.offsetPolicy, 'compressed-window');
  // La regla de activación cruzada transporta el calendario a congelar.
  const plan = spain.buildSeasonActivationPlan('2026-27');
  assert.strictEqual(plan[0].action.scheduleProfileId, spain.SPAIN_SCHEDULE_IDS.COPA_ACB);
  assert.strictEqual(plan[0].action.triggerReference.round, spain.SPAIN_CUP_TRIGGER_ROUND);
  // La Copa ya no puede tener `scheduleProfileId: null` en el catálogo.
  const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
  assert.strictEqual(
    CompetitionCatalog.getCompetitionDefinition(CompetitionCatalog.COMPETITION_IDS.COPA_ACB).bindings.scheduleProfileId,
    spain.SPAIN_SCHEDULE_IDS.COPA_ACB,
  );
});

check('un calendario desconocido FALLA, nunca hereda el perfil de otra competición', () => {
  const svc = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
  assert.throws(
    () => svc.buildResolver({
      scheduleId: 'unknown:schedule:zzz', planKey: 'regular-season', runnerType: 'round-robin', seasonStartYear: 2030,
    }),
    /calendario desconocido/,
  );
  const provider = svc.buildDateResolverProvider({ seasonStartYearForEdition: () => 2030 });
  // Una Edition sin calendario declarado NO recibe fechas (nunca hereda).
  assert.strictEqual(provider({ template: { key: 'regular-season', runnerType: 'round-robin' }, edition: { scheduleProfileId: null } }), null);
  // Una fase sin plan en un calendario existente FALLA.
  assert.throws(
    () => provider({
      template: { key: 'inexistent-phase', runnerType: 'bracket' },
      edition: { scheduleProfileId: 'test-worldcal:schedule:alpha', seasonKey: '2030-31' },
    }),
    /no declara plan de calendario para la fase/,
  );
  assert.throws(
    () => svc.buildDateResolverProvider({}),
    /seasonStartYearForEdition/,
  );
});

console.log(`\n${passed} OK, ${failed} FAIL`);
if (failed) process.exit(1);
