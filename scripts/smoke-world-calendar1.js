// scripts/smoke-world-calendar1.js
// WORLD-CALENDAR-1 (DESIGN.md 10.14) — ÚNICO smoke de integración de esta
// entrega (sección 17.2 del prompt): UNA carrera con los 36 equipos reales,
// UNA temporada completa + UNA transición anual, conducida ENTERAMENTE por
// la cola mundial (`WorldCalendar` + `WorldCalendarCoordinator`) — nunca
// "jornada visible + otra división", nunca drenando un bracket.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Checklist de la sección 17.2:
//  1. ACB y Primera FEB mezcladas cronológicamente;
//  2. Copa activada en su checkpoint (jornada 17) con partidos intercalados;
//  3. playoff por el título y de ascenso resueltos partido a partido;
//  4. un solo equipo controlado: SOLO sus encuentros son paradas;
//  5. ninguna fecha resuelta queda detrás del cursor;
//  6. no se drena un bracket de golpe al terminar una jornada;
//  7. cierre anual y nueva temporada sobre la MISMA instancia de calendario;
//  8. integridad World/Competition/Calendar y MoraBanc Andorra;
//  9. Supercopa sin Edition/runtime.
//
// No simula una segunda temporada (basta comprobar que queda registrada y
// que su primer evento es posterior), no ejecuta Playwright y no toca
// `data/real/*`.

const assert = require('assert');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { GameDateTime } = require('../src/utils/GameDateTime.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const { League } = require('../src/core/League.js');
const { Bracket } = require('../src/core/Bracket.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { padRosterToMinimum } = require('../src/utils/playerGenerator.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const {
  SPAIN_MANIFEST, buildSeasonActivationPlan, bindNewSeasonEditions,
  SPAIN_SCHEDULE_IDS, SPAIN_TIME_ZONE_ID, registerSpainSchedules,
} = require('../data/world/spain-2026.1.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const CompetitionParticipationService = require('../src/core/CompetitionParticipationService.js');
const { CompetitionEngine, buildEditionId, buildStageId } = require('../src/core/CompetitionEngine.js');
const { CompetitionScheduleCatalog } = require('../src/core/CompetitionScheduleCatalog.js');
const { CompetitionScheduleService } = require('../src/core/CompetitionScheduleService.js');
const { WorldCalendar } = require('../src/core/WorldCalendar.js');
const {
  WorldCalendarCoordinator, WORLD_CALENDAR_STOP_TYPES, WORLD_CALENDAR_SOURCE_TYPES,
  createCompetitionMatchSource, createMarketEventSource, createTransferEventSource, createLoanEventSource,
} = require('../src/core/WorldCalendarCoordinator.js');
const harness = require('./cycle1-harness.js');

const startedAt = Date.now();
const careerSeed = 'smoke-world-calendar1-seed-v1';
const seasonStartYear = 2026;
const seasonKey = LocalDate.seasonKeyFromStartYear(seasonStartYear);
const USER_TEAM_ID = 'team-unicaja';

console.log('=== SMOKE WORLD-CALENDAR-1 (1 temporada + 1 transición, cola mundial única) ===\n');

// =========================================================================
// 1. Calendarios como contenido + `WorldCalendar` único de la carrera.
// =========================================================================
registerSpainSchedules();
const scheduleService = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
const acbSchedule = CompetitionScheduleCatalog.requireSchedule(SPAIN_SCHEDULE_IDS.ACB);
const seasonStartInstant = scheduleService.seasonStartInstant(acbSchedule, seasonStartYear);
// El CURSOR arranca en el borde de la ventana de temporada (el ancla
// desplazada al `dayOffset` más temprano del contenido), no en el ancla: la
// jornada 1 puede tener partidos en viernes y un cursor en el ancla los
// dejaría detrás de él desde el minuto cero.
const seasonWindowStartInstant = scheduleService.seasonWindowStartInstant(acbSchedule, seasonStartYear);
const bootstrapIsoDate = GameDateTime.localDateAt(seasonStartInstant, SPAIN_TIME_ZONE_ID);

const calendar = new WorldCalendar({
  id: `calendar:smoke-world-calendar1:${careerSeed}`,
  defaultTimeZoneId: SPAIN_TIME_ZONE_ID,
  initialInstant: seasonWindowStartInstant,
});
calendar.registerSeason({
  seasonKey, startInstant: seasonStartInstant, timeZoneId: SPAIN_TIME_ZONE_ID,
  scheduleIds: [SPAIN_SCHEDULE_IDS.ACB, SPAIN_SCHEDULE_IDS.PRIMERA_FEB, SPAIN_SCHEDULE_IDS.COPA_ACB],
});
const calendarIdentityAtStart = calendar;
console.log(`OK  1 WorldCalendar (${SPAIN_TIME_ZONE_ID}) · arranque ${seasonStartInstant} (${bootstrapIsoDate})`);

// =========================================================================
// 2. Construcción de la carrera: 36 equipos reales + GameWorld canónico
//    (misma base que smoke-comp-core1.js).
// =========================================================================
const { annualCycleRegistry, academyRegistry } = harness.createCycleRegistries();
const playerRegistry = new PlayerRegistry();

function buildRealTeam(teamData) {
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...fields } = playerData;
    const player = new Player(fields);
    player.dataSource = dataSource || null;
    harness.WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, bootstrapIsoDate, {
      seasonKey, historyCompleteness: 'partial', annualCycleRegistry, retirementService: harness.RetirementService, careerSeed,
    });
    return player;
  });
  const resolved = harness.resolveRegistrationRulesForDivision(teamData.division, seasonKey, bootstrapIsoDate);
  const fallbackPlayers = padRosterToMinimum(roster, resolved.squadRules.min, {
    minAge: 18, maxAge: 34, referenceDate: bootstrapIsoDate,
    seed: `${careerSeed}|roster-fill|${teamData.id}`, id: `roster-fill:${teamData.id}`,
  });
  fallbackPlayers.forEach((player) => {
    harness.WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, bootstrapIsoDate, {
      seasonKey, historyCompleteness: 'complete', annualCycleRegistry, retirementService: harness.RetirementService, careerSeed,
    });
  });
  return new Team({ ...teamData, roster });
}

const teamsByDivision = { '1ª': [], '2ª': [] };
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div).map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id]));
});
const allTeams = [...teamsByDivision['1ª'], ...teamsByDivision['2ª']];
allTeams.forEach((team) => playerRegistry.registerMany(team.roster));

const world = WorldFactory.buildCareerWorld({
  id: `world:smoke-world-calendar1:${careerSeed}`,
  name: 'Mundo de la carrera (smoke WORLD-CALENDAR-1)',
  careerSeed,
  createdAtGameDate: bootstrapIsoDate,
  packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
  context: { teamsByDivision, seasonKey, seasonStartDate: bootstrapIsoDate },
});
world.setCalendar(calendar);
assert.strictEqual(world.calendar, calendar, 'world.calendar debe ser la MISMA instancia que el calendario de la carrera');
assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo recién construido debe validar sin errores');
const userTeam = world.registries.teams.require(USER_TEAM_ID);
const userClubId = userTeam.clubId;
console.log(`OK  36 clubes/equipos · ${playerRegistry.all().length} jugadores · equipo controlado ${userTeam.fullName} (club ${userClubId})`);

// Punto (9): Supercopa sigue catalog-only, antes de tocar el engine.
{
  const supercopa = CompetitionCatalog.getCompetitionDefinition(CompetitionCatalog.COMPETITION_IDS.SUPERCOPA_ACB);
  assert.strictEqual(supercopa.implementationStatus, 'catalog-only');
  assert.strictEqual(world.registries.competitionEditions.forDefinition(supercopa.id).length, 0);
}
console.log('OK  Supercopa ACB sigue catalog-only: sin Edition/Stage/Entry ni runtime (punto 9)');

// =========================================================================
// 3. Engine con el proveedor de fechas GENÉRICO del servicio de schedules.
// =========================================================================
const engine = new CompetitionEngine({ world });
function installDateResolverProvider() {
  engine.setDateResolverProvider(scheduleService.buildDateResolverProvider({
    seasonStartYearForEdition: (edition) => LocalDate.seasonStartYear(edition.seasonKey),
  }));
}
installDateResolverProvider();
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, seasonKey));
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey));
buildSeasonActivationPlan(seasonKey).forEach((rule) => engine.registerCrossEditionActivation(rule));

// Todo partido productivo tiene `scheduledAt` UTC + `timeZoneId` explícito.
{
  const pending = engine.listAllPendingMatches();
  assert.ok(pending.length > 0, 'debe haber partidos materializados tras inicializar las ediciones');
  pending.forEach((descriptor) => {
    assert.ok(GameDateTime.isInstant(descriptor.scheduledAt), `el partido "${descriptor.id}" debe tener scheduledAt UTC`);
    assert.strictEqual(descriptor.timeZoneId, SPAIN_TIME_ZONE_ID, `el partido "${descriptor.id}" debe declarar su huso`);
  });
  console.log(`OK  ${pending.length} partidos materializados con scheduledAt UTC + timeZoneId explícito (invariante 8)`);
}

// =========================================================================
// 4. Registros de dominio (CONTRACT-1..CYCLE-1) — igual que smoke-comp-core1.
// =========================================================================
const contractRegistry = new ContractRegistry();
const registrationRegistry = new RegistrationRegistry();
const agentRegistry = new AgentRegistry();
const marketRegistry = new MarketRegistry();
const transferRegistry = new TransferRegistry();
const loanRegistry = new LoanRegistry();
const classificationCache = new Map();

ContractSeeder.seedContractsForTeams({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
});
RegistrationSeeder.seedRegistrationsForTeams({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, registrationRegistry, contractRegistry, config: CONFIG_BASE,
});
world.attachDomainRegistries({
  playerRegistry, contractRegistry, registrationRegistry, agentRegistry, marketRegistry, transferRegistry, loanRegistry, annualCycleRegistry, academyRegistry,
});
['1ª', '2ª'].forEach((div) => recalculateSportingGoalsForDivision(teamsByDivision[div], CONFIG_BASE));

// =========================================================================
// 5. Cola mundial: fuentes + coordinador (dependencias explícitas).
// =========================================================================
const resolvedLog = [];
let clockAdvances = 0;

function resolveMatchByDescriptor({ stageId, matchId }) {
  const runner = engine.getRunner(stageId);
  const descriptor = runner.getMatchById ? runner.getMatchById(matchId) : runner.getPendingMatches().find((d) => d.id === matchId);
  assert.ok(descriptor, `resolveMatchByDescriptor: descriptor desconocido "${matchId}"`);
  engine.resolveMatch(stageId, matchId, { matchEngineConfig: CONFIG_BASE });
  resolvedLog.push({
    matchId,
    stageId,
    stageKey: descriptor.stageKey,
    round: descriptor.round === undefined ? null : descriptor.round,
    competitionDefinitionId: descriptor.competitionDefinitionId,
    scheduledAt: descriptor.scheduledAt,
    cursorAfter: null, // se rellena abajo, tras el avance del coordinador
    home: descriptor.homeParticipantId,
    away: descriptor.awayParticipantId,
  });
  // Invariante 5/17: al resolverlo, su instante no puede ser ANTERIOR al
  // cursor (el coordinador avanza el reloj hasta el grupo antes de
  // resolverlo, nunca por encima).
  assert.ok(
    GameDateTime.compare(descriptor.scheduledAt, calendar.currentInstant) <= 0,
    `el partido "${matchId}" (${descriptor.scheduledAt}) se resolvió con el cursor en ${calendar.currentInstant}`,
  );
  resolvedLog[resolvedLog.length - 1].cursorAfter = calendar.currentInstant;
  engine.drainActivationEvents();
  return descriptor;
}

const coordinator = new WorldCalendarCoordinator({
  calendar,
  sources: [
    createCompetitionMatchSource({ engine, timeZoneId: SPAIN_TIME_ZONE_ID, resolveMatch: resolveMatchByDescriptor }),
    createMarketEventSource({
      marketRegistry, timeZoneId: SPAIN_TIME_ZONE_ID, resolveEvent: (event) => marketRegistry.markEventProcessed(event.id),
    }),
    createTransferEventSource({
      transferRegistry, timeZoneId: SPAIN_TIME_ZONE_ID, resolveCase: () => { throw new Error('smoke: no debería haber traspasos programados'); },
    }),
    createLoanEventSource({
      loanRegistry, timeZoneId: SPAIN_TIME_ZONE_ID, resolveReturn: () => { throw new Error('smoke: no debería haber cesiones activas'); },
    }),
  ],
  controlledTeamIds: [USER_TEAM_ID],
  controlledClubIds: [userClubId],
  onClockAdvanced: () => { clockAdvances += 1; },
});

// =========================================================================
// 6. UNA temporada COMPLETA conducida por "Continuar" (puntos 1-6).
// =========================================================================
let userMatchStops = 0;
let cursorBefore = calendar.currentInstant;
let guard = 0;
let finalStop = null;
const cursorTrace = [];

while (guard < 5000) {
  guard += 1;
  const stop = coordinator.advanceUntilNextUserStop();
  // El cursor NUNCA retrocede (invariante 4).
  assert.ok(
    GameDateTime.compare(calendar.currentInstant, cursorBefore) >= 0,
    `el cursor retrocedió: ${cursorBefore} -> ${calendar.currentInstant}`,
  );
  cursorBefore = calendar.currentInstant;
  cursorTrace.push(calendar.currentInstant);

  if (stop.type === WORLD_CALENDAR_STOP_TYPES.SEASON_COMPLETE) { finalStop = stop; break; }
  assert.strictEqual(
    stop.type, WORLD_CALENDAR_STOP_TYPES.USER_MATCH,
    `parada inesperada "${stop.type}" (${JSON.stringify(stop.items && stop.items[0] && stop.items[0].metadata)})`,
  );
  // Punto (4): SOLO los partidos del equipo controlado son parada.
  const meta = stop.item.metadata;
  assert.ok(
    meta.homeParticipantId === USER_TEAM_ID || meta.awayParticipantId === USER_TEAM_ID,
    `una parada de tipo user-match debe incluir al equipo controlado (${meta.matchId})`,
  );
  // Invariante 15: los CPU simultáneos NO se han resuelto todavía.
  stop.simultaneous.forEach((other) => {
    const runner = engine.getRunner(other.metadata.stageId);
    const descriptor = runner.getMatchById ? runner.getMatchById(other.metadata.matchId) : null;
    if (descriptor) {
      assert.strictEqual(
        descriptor.status, 'pending',
        `el partido simultáneo "${other.metadata.matchId}" no debe estar resuelto antes del del usuario`,
      );
    }
  });
  // Commit del partido del usuario + los CPU de su MISMO instante.
  resolveMatchByDescriptor({ stageId: meta.stageId, matchId: meta.matchId });
  coordinator.completeUserItem(stop.item.id);
  const simultaneous = coordinator.resolveSimultaneousAfterUserCommit(stop.item.orderingInstant);
  assert.strictEqual(simultaneous.failure, null, 'no debe fallar la resolución de los simultáneos');
  // Tras resolver el instante del usuario, el cursor no se ha ido más allá.
  assert.strictEqual(calendar.currentInstant, stop.instant, 'el commit de los simultáneos no debe adelantar el cursor');
  userMatchStops += 1;
}
assert.ok(finalStop, `la temporada no llegó a "season-complete" en ${guard} iteraciones`);
console.log(`OK  temporada completa por la cola mundial: ${resolvedLog.length} partidos resueltos, ${userMatchStops} paradas del usuario, ${clockAdvances} avances de reloj (puntos 1-6)`);

// Punto (4-bis): ninguna parada fue un CPU-vs-CPU (invariante 13).
assert.strictEqual(userMatchStops, resolvedLog.filter((r) => r.home === USER_TEAM_ID || r.away === USER_TEAM_ID).length,
  'el nº de paradas debe coincidir EXACTAMENTE con el nº de partidos del equipo controlado');

// Punto (5): ninguna fecha resuelta quedó detrás del cursor del momento —
// ya se comprueba partido a partido arriba; aquí se confirma que el orden de
// resolución fue MONOTÓNICO en el instante programado.
for (let i = 1; i < resolvedLog.length; i++) {
  assert.ok(
    GameDateTime.compare(resolvedLog[i].scheduledAt, resolvedLog[i - 1].scheduledAt) >= 0,
    `orden no cronológico: ${resolvedLog[i - 1].matchId} (${resolvedLog[i - 1].scheduledAt}) antes de `
    + `${resolvedLog[i].matchId} (${resolvedLog[i].scheduledAt})`,
  );
}
console.log('OK  ninguna resolución quedó detrás del cursor y el orden global fue estrictamente cronológico (punto 5, BUG-WORLDCALENDAR-01)');

// Punto (1): ACB y Primera FEB MEZCLADAS cronológicamente — ninguna de las
// dos se resuelve en bloque: sus partidos ocupan un tramo de la cola MUCHO
// más ancho que su propio número de partidos, y hay alternancias reales.
{
  const competitions = resolvedLog.map((r) => r.competitionDefinitionId);
  let alternations = 0;
  for (let i = 1; i < competitions.length; i++) if (competitions[i] !== competitions[i - 1]) alternations += 1;
  assert.ok(alternations > 30, `ACB y Primera FEB deben alternarse en la cola (alternancias: ${alternations})`);
  ['acb', 'primera-feb'].forEach((competitionId) => {
    const idx = competitions.map((c, i) => (c === competitionId ? i : -1)).filter((i) => i >= 0);
    const span = idx[idx.length - 1] - idx[0] + 1;
    assert.ok(
      span > idx.length * 1.5,
      `"${competitionId}" no debe resolverse en bloque: ${idx.length} partidos en un tramo de ${span} posiciones`,
    );
  });
  console.log(`OK  ACB / Primera FEB / Copa / playoffs intercalados cronológicamente: ${alternations} alternancias de competición (punto 1)`);
}

// Punto (2): Copa activada en su checkpoint (jornada 17) y jugada DENTRO
// del hueco real entre la jornada 17 y la 18 de la Liga ACB — sus 3 rondas
// se resuelven en 3 fechas DISTINTAS, nunca drenadas de golpe al activarse.
{
  const copaEdition = world.registries.competitionEditions.forDefinition(CompetitionCatalog.COMPETITION_IDS.COPA_ACB)[0];
  assert.ok(copaEdition, 'la Copa debe haberse activado por su checkpoint de jornada 17');
  assert.strictEqual(copaEdition.scheduleProfileId, SPAIN_SCHEDULE_IDS.COPA_ACB, 'la Copa debe congelar su calendario propio en la Edition');
  const cupMatches = resolvedLog.filter((r) => r.competitionDefinitionId === CompetitionCatalog.COMPETITION_IDS.COPA_ACB);
  assert.strictEqual(cupMatches.length, 7, `la Copa debe jugar 7 partidos (4 cuartos + 2 semis + 1 final), jugó ${cupMatches.length}`);
  const cupDates = new Set(cupMatches.map((r) => GameDateTime.localDateAt(r.scheduledAt, SPAIN_TIME_ZONE_ID)));
  assert.strictEqual(cupDates.size, 3, `las 3 rondas de Copa deben caer en 3 fechas distintas, no en una (fechas: ${[...cupDates].join(', ')})`);
  // La Copa INTERRUMPE la liga (DESIGN.md 3.3.2): sus partidos van después
  // del último de la jornada 17 de ACB y antes del primero de la 18.
  const acbRegular = resolvedLog.filter((r) => r.competitionDefinitionId === 'acb' && r.stageKey === 'regular-season');
  const round17 = acbRegular.filter((r) => r.round === 17);
  const round18 = acbRegular.filter((r) => r.round === 18);
  const lastRound17 = round17.reduce((max, r) => (GameDateTime.compare(r.scheduledAt, max) > 0 ? r.scheduledAt : max), round17[0].scheduledAt);
  const firstRound18 = round18.reduce((min, r) => (GameDateTime.compare(r.scheduledAt, min) < 0 ? r.scheduledAt : min), round18[0].scheduledAt);
  cupMatches.forEach((r) => {
    assert.ok(GameDateTime.compare(r.scheduledAt, lastRound17) > 0, `el partido de Copa ${r.matchId} debe ir después de la jornada 17`);
    assert.ok(GameDateTime.compare(r.scheduledAt, firstRound18) < 0, `el partido de Copa ${r.matchId} debe ir antes de la jornada 18`);
  });
  console.log(`OK  Copa activada en jornada 17 y jugada en el hueco real hacia la 18, en 3 fechas distintas: ${[...cupDates].join(', ')} (punto 2/6)`);
}

// Punto (3/6): playoff por el título y de ascenso resueltos PARTIDO A
// PARTIDO y ENTRELAZADOS entre sí — antes, terminar la liga drenaba el
// bracket de la división de fondo hasta su final (BUG-WORLDCALENDAR-01).
{
  const titleIdx = resolvedLog.map((r, i) => (r.stageKey === 'title-playoff' ? i : -1)).filter((i) => i >= 0);
  const promoIdx = resolvedLog.map((r, i) => (r.stageKey === 'promotion-quarterfinals' || r.stageKey === 'promotion-final-four' ? i : -1)).filter((i) => i >= 0);
  assert.ok(titleIdx.length >= 11, `el playoff por el título debe jugar al menos 11 partidos, jugó ${titleIdx.length}`);
  assert.ok(promoIdx.length >= 12, `el playoff de ascenso debe jugar al menos 12 partidos, jugó ${promoIdx.length}`);
  const interleaved = titleIdx.some((i) => promoIdx.some((j) => j > i)) && promoIdx.some((j) => titleIdx.some((i) => i > j));
  assert.ok(interleaved, 'playoff por el título y playoff de ascenso deben entrelazarse en la cola, no drenarse uno tras otro');
  console.log(`OK  playoff por el título (${titleIdx.length}) y de ascenso (${promoIdx.length}) resueltos partido a partido y entrelazados (puntos 3/6)`);
}

// Integridad del calendario y de las ediciones al cerrar la temporada.
assert.deepStrictEqual(calendar.validateIntegrity(), [], 'el calendario mundial debe validar al cerrar la temporada');
assert.strictEqual(calendar.pendingItemsOrdered().length, 0, 'no debe quedar ningún item pendiente al terminar la temporada');
['acb', 'primera-feb', 'copa-acb'].forEach((competitionId) => {
  const editions = world.registries.competitionEditions.forDefinition(competitionId);
  assert.ok(editions.length && editions.every((e) => e.status === 'completed'), `la edición de "${competitionId}" debe quedar completed`);
});
console.log('OK  las tres ediciones (ACB, Primera FEB, Copa) se completan solas; calendario íntegro y cola vacía');

// =========================================================================
// 7. Transición anual sobre la MISMA instancia de calendario (punto 7).
// =========================================================================
const teamsById = new Map(allTeams.map((t) => [t.id, t]));
function buildLeagueFacade(competitionId) {
  const runner = engine.getRunner(buildStageId(competitionId, seasonKey, 'regular-season'));
  return new League(runner.participantIds.map((id) => teamsById.get(id)), null, { runner });
}
function buildBracketFacade(stageId) {
  const runner = engine.getRunner(stageId);
  if (!runner) return null;
  const seen = new Set();
  const entries = [];
  runner.rounds[0].forEach((series) => {
    [series.better, series.worse].forEach((e) => {
      if (seen.has(e.participantId)) return;
      seen.add(e.participantId);
      entries.push({ team: teamsById.get(e.participantId), seed: e.seed });
    });
  });
  return new Bracket(entries, [], [], null, { runner });
}
const leagues = {
  '1ª': buildLeagueFacade(CompetitionCatalog.COMPETITION_IDS.ACB),
  '2ª': buildLeagueFacade(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB),
};
const cupView = buildBracketFacade(buildStageId(CompetitionCatalog.COMPETITION_IDS.COPA_ACB, seasonKey, 'knockout'));
const titlePlayoffView = buildBracketFacade(buildStageId(CompetitionCatalog.COMPETITION_IDS.ACB, seasonKey, 'title-playoff'));
const promotionQfView = buildBracketFacade(buildStageId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey, 'promotion-quarterfinals'));
const promotionFfView = buildBracketFacade(buildStageId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey, 'promotion-final-four'));
const promotionView = {
  directPromotion: { team: teamsById.get(leagues['2ª'].getStandingsTable()[0].team.id), seed: 1 },
  quarterFinals: promotionQfView,
  finalFour: promotionFfView,
  get isQuarterFinalsComplete() { return promotionQfView.isComplete; },
  ensureFinalFour() {},
  get secondPromotedEntry() { return promotionFfView ? promotionFfView.champion : null; },
  get isComplete() { return this.secondPromotedEntry !== null; },
};
assert.ok(leagues['1ª'].isSeasonComplete && leagues['2ª'].isSeasonComplete, 'ambas ligas regulares deben estar completas');
assert.ok(cupView.isComplete && titlePlayoffView.isComplete && promotionView.isComplete, 'Copa, playoff por el título y ascenso deben estar completos');

const evidence = harness.collectSeasonEvidence({
  leagues: [leagues['1ª'], leagues['2ª']],
  brackets: [
    { bracket: cupView, phaseId: 'cup' },
    { bracket: titlePlayoffView, phaseId: 'title-playoff' },
    { bracket: promotionView, phaseId: 'promotion-playoff' },
  ],
});
const missingEvidence = evidence.missingClubIds(allTeams);
assert.strictEqual(missingEvidence.length, 0, `clubes sin evidencia de último partido oficial: ${missingEvidence.join(', ')}`);

const bootstrapLegality = harness.ensureAllClubsLegalBeforeFirstMatch({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, config: CONFIG_BASE, careerSeed,
  annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry, loanRegistry, classificationCache,
});
assert.ok(bootstrapLegality.ready !== false, 'los 36 clubes deben poder construir una convocatoria legal antes de cerrar el ciclo');

const targetSeasonKey = LocalDate.seasonKeyFromStartYear(seasonStartYear + 1);
const seasonEndInstant = calendar.currentInstant;
const transition = harness.runAnnualCycleTransition({
  annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry,
  marketRegistry, agentRegistry, transferRegistry, loanRegistry,
  teams: allTeams,
  leagueA: leagues['1ª'],
  leagueB: leagues['2ª'],
  cup: cupView,
  titlePlayoff: titlePlayoffView,
  promotionPlayoff: promotionView,
  fromSeasonKey: seasonKey,
  targetSeasonKey,
  evidence,
  seasonEndDateTime: GameDateTime.toJsDate(seasonEndInstant),
  config: CONFIG_BASE,
  careerSeed,
  classificationCache,
});
assert.strictEqual(transition.finalPhase, 'new-season-started', 'el ciclo debe completar sus 13 fases sin clubes NOT READY');
console.log(`OK  transición anual ${seasonKey} -> ${targetSeasonKey}: ascienden ${transition.summary.promoted.join(', ')}; descienden ${transition.summary.relegated.join(', ')}`);

// La temporada nueva se registra en el MISMO calendario (nunca otra
// instancia) y su instante de arranque es POSTERIOR al último de la anterior.
const nextSeasonStartInstant = scheduleService.seasonStartInstant(acbSchedule, seasonStartYear + 1);
const nextSeasonWindowStartInstant = scheduleService.seasonWindowStartInstant(acbSchedule, seasonStartYear + 1);
calendar.registerSeason({
  seasonKey: targetSeasonKey, startInstant: nextSeasonStartInstant, timeZoneId: SPAIN_TIME_ZONE_ID,
  scheduleIds: [SPAIN_SCHEDULE_IDS.ACB, SPAIN_SCHEDULE_IDS.PRIMERA_FEB, SPAIN_SCHEDULE_IDS.COPA_ACB],
});
calendar.retireLedger();
assert.ok(GameDateTime.compare(nextSeasonStartInstant, seasonEndInstant) > 0, 'la temporada nueva debe arrancar después del último instante de la anterior');

allTeams.forEach((team) => { team.legacyDivision = team.division; });
bindNewSeasonEditions(world, {
  seasonKey: targetSeasonKey,
  teamsByDivision: { '1ª': allTeams.filter((t) => t.division === '1ª'), '2ª': allTeams.filter((t) => t.division === '2ª') },
  startDate: GameDateTime.localDateAt(nextSeasonStartInstant, SPAIN_TIME_ZONE_ID),
});
installDateResolverProvider();
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, targetSeasonKey));
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, targetSeasonKey));
buildSeasonActivationPlan(targetSeasonKey).forEach((rule) => engine.registerCrossEditionActivation(rule));
calendar.advanceTo(nextSeasonWindowStartInstant);
coordinator.sync();

// Identidad: MISMA instancia de calendario antes y después de la transición.
assert.strictEqual(calendar, calendarIdentityAtStart, 'el cambio de temporada NO debe reemplazar el calendario (invariante 3)');
assert.strictEqual(world.calendar, calendar, 'world.calendar debe seguir siendo la MISMA instancia (invariante 2)');
assert.strictEqual(calendar.seasons.length, 2, 'el calendario debe tener registradas las DOS temporadas');
assert.strictEqual(calendar.currentSeasonKey, targetSeasonKey);

// El primer evento pendiente de la temporada nueva es POSTERIOR al último
// instante de la anterior (no se simula la segunda temporada).
{
  const pending = calendar.pendingItemsOrdered();
  assert.ok(pending.length > 0, 'la temporada nueva debe dejar partidos pendientes en la cola');
  assert.ok(
    GameDateTime.compare(pending[0].orderingInstant, seasonEndInstant) > 0,
    `el primer evento de ${targetSeasonKey} (${pending[0].orderingInstant}) debe ser posterior al cierre de ${seasonKey} (${seasonEndInstant})`,
  );
  assert.deepStrictEqual(calendar.validateIntegrity(), [], 'el calendario debe validar tras la transición anual');
  console.log(`OK  misma instancia de calendario a través de la transición; primer evento de ${targetSeasonKey} en ${pending[0].orderingInstant} (punto 7)`);
}

// =========================================================================
// 8. Integridad final World/Competition/Calendar + MoraBanc Andorra.
// =========================================================================
assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo debe seguir válido tras la transición anual');
assert.deepStrictEqual(engine.validateIntegrity(), [], 'el engine debe seguir válido tras la transición');
assert.strictEqual(world.registries.teams.size, 36);
assert.strictEqual(world.registries.clubs.size, 36);
assert.strictEqual(world.registries.squads.size, 36);
{
  const team = world.registries.teams.require('team-morabanc-andorra');
  const club = world.registries.clubs.require('club-morabanc-andorra');
  assert.strictEqual(club.homeAreaId, 'area-country-ad');
  assert.strictEqual(club.employerJurisdictionAreaId, 'area-country-ad');
  assert.strictEqual(team.club, club);
  const competitionId = CompetitionParticipationService.primaryLeagueCompetitionId(world.registries, team.id, { seasonKey: targetSeasonKey });
  assert.strictEqual(competitionId, team.division === '1ª' ? 'acb' : 'primera-feb');
  // El calendario de su competición sigue siendo el del ORGANIZADOR
  // (España), y su jurisdicción laboral sigue siendo Andorra: dos ejes
  // distintos, nunca colapsados.
  const edition = world.registries.competitionEditions.require(buildEditionId(competitionId, targetSeasonKey));
  assert.ok([SPAIN_SCHEDULE_IDS.ACB, SPAIN_SCHEDULE_IDS.PRIMERA_FEB].includes(edition.scheduleProfileId));
}
console.log('OK  integridad World/Competition/Calendar y MoraBanc Andorra (Club andorrano, participación española) tras la transición (punto 8)');

// Supercopa sigue sin runtime también después del ciclo.
assert.strictEqual(
  world.registries.competitionEditions.forDefinition(CompetitionCatalog.COMPETITION_IDS.SUPERCOPA_ACB).length, 0,
  'Supercopa nunca recibe Edition/runtime',
);
assert.strictEqual(coordinator.sourceTypes.length, 4, 'las cuatro fuentes temporales deben seguir registradas');
assert.deepStrictEqual(coordinator.sourceTypes, [
  WORLD_CALENDAR_SOURCE_TYPES.COMPETITION_MATCH,
  WORLD_CALENDAR_SOURCE_TYPES.LOAN_EVENT,
  WORLD_CALENDAR_SOURCE_TYPES.MARKET_EVENT,
  WORLD_CALENDAR_SOURCE_TYPES.TRANSFER_EVENT,
].sort());

console.log(`\nSMOKE TEST WORLD-CALENDAR-1: OK (36 clubes, 1 temporada completa por la cola mundial + 1 transición anual, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
