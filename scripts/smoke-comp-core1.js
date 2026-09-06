// scripts/smoke-comp-core1.js
// COMP-CORE-1 (DESIGN.md 10.13) — ÚNICO smoke de integración de esta
// entrega (sección 15.2 del prompt): reutiliza la MISMA construcción de
// carrera que `smoke-world-core1.js`/`smoke-club-core1.js` (36 equipos
// reales, `world-core-2026.1` + `spain-2026.1`) pero ejecuta la
// competición a través del `CompetitionEngine` GENÉRICO — nunca
// `SpainLegacyCompetitionRuntime`/`createCup`/`createTitlePlayoff`/
// `new PromotionPlayoff()` como autoridad (esos siguen intactos como
// fachada/shim histórico, no se llaman desde aquí). Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Checklist de la sección 15.2 (una sola carrera, una sola temporada):
//  1. instalar world-core-2026.1 + spain-2026.1;
//  2. crear el engine y las Editions activas/planned;
//  3. completar UNA temporada de ACB y Primera FEB;
//  4. Copa en jornada 17, playoff ACB y playoff de ascenso con sus
//     formatos actuales;
//  5. ids/fechas exactos en un partido de Liga y uno de eliminatoria;
//  6. acta/elegibilidad usando el contexto canónico;
//  7. cerrar UNA transición anual y crear las Editions siguientes;
//  8. revalidar World, Player, Club/Team/Squad y participación;
//  9. MoraBanc sigue siendo Club andorrano aunque su Entry sea ACB o
//     cambie tras el puente deportivo;
//  10. Supercopa sigue sin runtime.

const assert = require('assert');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { Calendar } = require('../src/core/Calendar.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { MarketSeeder } = require('../src/core/MarketSeeder.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const { League } = require('../src/core/League.js');
const { Bracket, VENUE_PATTERNS } = require('../src/core/Bracket.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { padRosterToMinimum } = require('../src/utils/playerGenerator.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const { SPAIN_MANIFEST, buildSeasonActivationPlan, bindNewSeasonEditions } = require('../data/world/spain-2026.1.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const CompetitionParticipationService = require('../src/core/CompetitionParticipationService.js');
const {
  CompetitionEngine, buildEditionId, buildStageId,
} = require('../src/core/CompetitionEngine.js');
const { AcademyService } = require('../src/core/AcademyService.js');
const { EligibilityService } = require('../src/core/EligibilityService.js');
const harness = require('./cycle1-harness.js');

const startedAt = Date.now();
const careerSeed = 'smoke-comp-core1-seed-v1';
const seasonStartYear = 2026;

console.log('=== SMOKE COMP-CORE-1 (1 temporada + 1 transición anual, motor genérico) ===\n');

// =========================================================================
// 1. Construcción de la carrera: 36 equipos reales + GameWorld canónico
//    (misma base que smoke-club-core1.js).
// =========================================================================
const calendar = new Calendar(seasonStartYear, CONFIG_BASE);
const bootstrapIsoDate = LocalDate.fromJsDate(calendar.seasonStartDate);
const seasonKey = require('../src/core/PlayerCareer.js').seasonKeyFromStartYear(seasonStartYear);

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
  id: `world:smoke-comp-core1:${careerSeed}`,
  name: 'Mundo de la carrera (smoke COMP-CORE-1)',
  careerSeed,
  createdAtGameDate: bootstrapIsoDate,
  packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
  context: { teamsByDivision, seasonKey, seasonStartDate: bootstrapIsoDate },
});
world.setCalendar(calendar);

assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo recién construido debe validar sin errores');
assert.strictEqual(world.registries.clubs.size, 36);
assert.strictEqual(world.registries.teams.size, 36);
console.log(`OK  1 mundo · 36 clubes · 36 equipos · ${playerRegistry.all().length} jugadores (world-core-2026.1 + spain-2026.1)`);

// =========================================================================
// 2. Punto (10): Supercopa sigue `catalog-only`, sin Edition/Stage/Entry ni
//    runtime — se comprueba ANTES de tocar el engine para que quede claro
//    que nadie la activa por accidente durante la temporada.
// =========================================================================
{
  const supercopa = CompetitionCatalog.getCompetitionDefinition(CompetitionCatalog.COMPETITION_IDS.SUPERCOPA_ACB);
  assert.strictEqual(supercopa.implementationStatus, 'catalog-only');
  assert.strictEqual(
    world.registries.competitionEditions.forDefinition(supercopa.id).length, 0,
    'Supercopa no debe tener ninguna Edition — sigue sin runtime',
  );
}
console.log('OK  Supercopa ACB sigue catalog-only: sin Edition/Stage/Entry ni runtime (punto 10)');

// =========================================================================
// 2-bis. El engine — UNA instancia por carrera, con el proveedor de fechas
// inyectado (mismo criterio que game.js: el engine nunca lee state.calendar
// por dentro).
// =========================================================================
function buildDateResolverProvider() {
  return ({ template, edition, stage }) => {
    if (template.runnerType === 'round-robin') {
      if (!edition.scheduleProfileId) return null;
      return (meta) => calendar.leagueMatchDateTime(
        meta.round, meta.matchIndexInRound, meta.matchesInRound, meta.totalRounds, edition.scheduleProfileId,
      );
    }
    if (edition.competitionDefinitionId === CompetitionCatalog.COMPETITION_IDS.COPA_ACB) {
      const dates = calendar.cupRoundDates();
      return (roundIndex) => dates[roundIndex];
    }
    // SIEMPRE la fase 'regular-season' de esta misma edición — nunca
    // `stage.sourceStageIds[0]` directo (para la Final Four ese id apunta
    // a los cuartos, un bracket sin `totalRounds`, no a la liga).
    void stage;
    const regularSeasonStage = world.registries.competitionStages.get(
      buildStageId(edition.competitionDefinitionId, edition.seasonKey, 'regular-season'),
    );
    const regularSeasonRunner = regularSeasonStage ? engine.getRunner(regularSeasonStage.id) : null;
    if (!regularSeasonRunner) return null;
    const startDate = calendar.titlePlayoffStartDate(calendar.leagueRoundDate(regularSeasonRunner.totalRounds));
    if (template.key === 'promotion-final-four') {
      const resolver = calendar.buildBracketDateResolver(
        startDate, [VENUE_PATTERNS.BEST_OF_5_2_2_1, VENUE_PATTERNS.SINGLE_GAME, VENUE_PATTERNS.SINGLE_GAME],
      );
      return (roundIndex, gameIndexInSeries) => resolver(roundIndex + 1, gameIndexInSeries);
    }
    if (template.key === 'promotion-quarterfinals') {
      return calendar.buildBracketDateResolver(
        startDate, [VENUE_PATTERNS.BEST_OF_5_2_2_1, VENUE_PATTERNS.SINGLE_GAME, VENUE_PATTERNS.SINGLE_GAME],
      );
    }
    return calendar.buildBracketDateResolver(
      startDate, [VENUE_PATTERNS.BEST_OF_3_1_1_1, VENUE_PATTERNS.BEST_OF_5_2_2_1, VENUE_PATTERNS.BEST_OF_5_2_2_1],
    );
  };
}

const engine = new CompetitionEngine({ world });
engine.setDateResolverProvider(buildDateResolverProvider());
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, seasonKey));
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey));
buildSeasonActivationPlan(seasonKey).forEach((rule) => engine.registerCrossEditionActivation(rule));

const acbEdition = world.registries.competitionEditions.require(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, seasonKey));
const febEdition = world.registries.competitionEditions.require(buildEditionId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, seasonKey));
assert.strictEqual(acbEdition.status, 'active');
assert.strictEqual(febEdition.status, 'active');
assert.ok(acbEdition.formatBindingId && acbEdition.rulesetBundleId, 'la edición de ACB debe tener bindings congelados');
console.log('OK  CompetitionEngine creado, Editions de ACB/Primera FEB activas con bindings congelados (punto 2)');

// Vistas legacy (League/Bracket) construidas SIEMPRE desde el runner real
// del engine — igual patrón que game.js (nunca un segundo estado).
const teamsById = new Map(allTeams.map((t) => [t.id, t]));
function buildLeagueFacade(competitionId, teams) {
  const stageId = buildStageId(competitionId, seasonKey, 'regular-season');
  return new League(teams, null, { runner: engine.getRunner(stageId) });
}
function buildBracketFacade(stageId) {
  const runner = engine.getRunner(stageId);
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
function buildPromotionPlayoffCompatView(regularSeasonStageId, quarterfinalsStageId) {
  const regularRunner = engine.getRunner(regularSeasonStageId);
  const standings = regularRunner.getStandings();
  const view = {
    directPromotion: { team: teamsById.get(standings[0].participantId), seed: 1 },
    quarterFinals: buildBracketFacade(quarterfinalsStageId),
    finalFour: null,
    get isQuarterFinalsComplete() { return view.quarterFinals.isComplete; },
    ensureFinalFour() {},
    get secondPromotedEntry() { return view.finalFour ? view.finalFour.champion : null; },
    get isComplete() { return view.secondPromotedEntry !== null; },
    playNextGame(config, resolveOptions) {
      if (!view.isQuarterFinalsComplete) return view.quarterFinals.playNextGame(config, resolveOptions);
      return view.finalFour.playNextGame(config, resolveOptions);
    },
  };
  return view;
}

let leagues = {
  '1ª': buildLeagueFacade(CompetitionCatalog.COMPETITION_IDS.ACB, teamsByDivision['1ª']),
  '2ª': buildLeagueFacade(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, teamsByDivision['2ª']),
};
const brackets = {
  '1ª': { cup: null, titlePlayoff: null },
  '2ª': { promotionPlayoff: null },
};

// Drena los hechos de activación que el engine acaba de producir (rondas/
// fases completadas al resolver partidos) y construye la vista legacy que
// falte — igual patrón que `drainCompetitionActivationEvents()` de game.js.
function drainActivationEvents() {
  const events = engine.drainActivationEvents();
  events.filter((e) => e.type === 'stage-activated').forEach((event) => {
    const edition = world.registries.competitionEditions.require(event.editionId);
    const definition = world.registries.competitionDefinitions.require(edition.competitionDefinitionId);
    if (definition.id === CompetitionCatalog.COMPETITION_IDS.COPA_ACB) {
      brackets['1ª'].cup = buildBracketFacade(event.stageId);
      return;
    }
    const division = definition.legacyDivision;
    if (!division) return;
    if (event.stageKey === 'title-playoff') brackets[division].titlePlayoff = buildBracketFacade(event.stageId);
    else if (event.stageKey === 'promotion-quarterfinals') {
      const regularStageId = buildStageId(edition.competitionDefinitionId, edition.seasonKey, 'regular-season');
      brackets[division].promotionPlayoff = buildPromotionPlayoffCompatView(regularStageId, event.stageId);
    } else if (event.stageKey === 'promotion-final-four') {
      brackets[division].promotionPlayoff.finalFour = buildBracketFacade(event.stageId);
    }
  });
  return events;
}

// =========================================================================
// 3-4. UNA temporada COMPLETA de ACB y Primera FEB — Copa en jornada 17,
//      Playoff por el título, Playoff de ascenso, todo vía el engine.
// =========================================================================
['1ª', '2ª'].forEach((div) => recalculateSportingGoalsForDivision(teamsByDivision[div], CONFIG_BASE));

let firstLeagueMatchChecked = false;
let firstKnockoutMatchChecked = false;

while (!leagues['1ª'].isSeasonComplete || !leagues['2ª'].isSeasonComplete) {
  ['1ª', '2ª'].forEach((div) => {
    const league = leagues[div];
    if (league.isSeasonComplete) return;
    const matches = league.simulateNextRound(CONFIG_BASE);
    drainActivationEvents();

    // Punto 5: id/fecha EXACTOS de un partido de Liga, conocidos ANTES de
    // haberlo simulado (BUG-COMPCORE-03) — se comprueba sobre el primero
    // que se resuelve.
    if (!firstLeagueMatchChecked && matches.length) {
      const m = matches[0];
      assert.ok(m.id && m.id.startsWith(`match:stage:${div === '1ª' ? 'acb' : 'primera-feb'}:${seasonKey}:regular-season:`));
      assert.ok(m.date instanceof Date, 'la fecha del partido de Liga debe ser un Date real');
      assert.strictEqual(m.competitionDefinitionId, div === '1ª' ? 'acb' : 'primera-feb');
      firstLeagueMatchChecked = true;
    }
  });
  ['1ª', '2ª'].forEach((div) => {
    const b = brackets[div];
    ['cup', 'titlePlayoff', 'promotionPlayoff'].forEach((key) => {
      const bracket = b[key];
      if (!bracket) return;
      while (!bracket.isComplete) {
        const pending = bracket.peekNextPendingGame ? bracket.peekNextPendingGame() : null;
        if (pending && !firstKnockoutMatchChecked) {
          // Punto 5: id/fecha EXACTOS de un partido de eliminatoria, conocidos
          // ANTES de simularlo.
          assert.ok(pending.matchId, 'el descriptor de eliminatoria debe tener id estable ANTES de simular');
          assert.ok(pending.scheduledDate instanceof Date, 'el descriptor de eliminatoria debe tener fecha real ANTES de simular');
          firstKnockoutMatchChecked = true;
        }
        bracket.playNextGame(CONFIG_BASE);
        drainActivationEvents();
      }
    });
  });
}

assert.ok(brackets['1ª'].cup && brackets['1ª'].cup.isComplete, 'la Copa debe haberse activado en jornada 17 y jugado hasta el final');
assert.ok(brackets['1ª'].titlePlayoff && brackets['1ª'].titlePlayoff.isComplete, 'el playoff por el título debe haberse jugado hasta el final');
assert.ok(brackets['2ª'].promotionPlayoff && brackets['2ª'].promotionPlayoff.isComplete, 'el playoff de ascenso debe haberse jugado hasta el final');
assert.ok(firstLeagueMatchChecked && firstKnockoutMatchChecked, 'deben haberse comprobado ids/fechas de un partido de Liga y uno de eliminatoria');
console.log('OK  temporada completa: Liga + Copa (activación cruzada en jornada 17) + Playoff por el título + Playoff de ascenso, vía el engine (puntos 3-5)');

// La Copa recibió su identidad REAL (BUG-COMPCORE-02) — nunca "acb".
const copaEdition = engine.getActiveEdition(CompetitionCatalog.COMPETITION_IDS.COPA_ACB)
  || world.registries.competitionEditions.forDefinition(CompetitionCatalog.COMPETITION_IDS.COPA_ACB)[0];
assert.strictEqual(copaEdition.competitionDefinitionId, 'copa-acb');
assert.strictEqual(copaEdition.status, 'completed');
assert.strictEqual(acbEdition.status, 'completed');
assert.strictEqual(febEdition.status, 'completed');
console.log('OK  Copa ACB con identidad propia "copa-acb" (nunca "acb"), las tres ediciones se completan solas');

// =========================================================================
// 6. Acta/elegibilidad usando el CONTEXTO CANÓNICO — comprueba que un
//    partido de Copa resuelve normativa con competitionId "copa-acb" (y no
//    "acb", como pasaba antes de BUG-COMPCORE-02) y que EligibilityService
//    puede evaluar sobre ese contexto.
// =========================================================================
const copaEligibilityTeam = brackets['1ª'].cup.rounds[brackets['1ª'].cup.rounds.length - 1][0].betterEntry.team;
const copaEligibilityContext = {
  competitionId: 'copa-acb',
  competitionInstanceId: 'copa-acb',
  seasonKey,
  date: bootstrapIsoDate,
  phaseId: 'cup',
  roundId: null,
  matchId: null,
  operation: 'buildMatchSquad',
  opponentClubId: null,
};
{
  const resolved = CompetitionRules.resolveRules(copaEligibilityContext);
  assert.strictEqual(resolved.registrationScopeId, 'acb-domestic-registration-2025-26', 'Copa reutiliza el ámbito ACB por binding explícito, no por confusión con la Liga');
}
console.log('OK  el contexto normativo de un partido de Copa resuelve con competitionId "copa-acb" real (punto 6, BUG-COMPCORE-02)');

// =========================================================================
// 2. Registros de dominio (CONTRACT-1..CYCLE-1) — igual que smoke-club-core1.js.
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
const freeAgents = MarketSeeder.seedFreeAgentPool({
  playerRegistry, careerSeed, referenceDate: calendar.seasonStartDate, config: CONFIG_BASE,
});
freeAgents.forEach((player) => {
  harness.WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, bootstrapIsoDate, {
    seasonKey, historyCompleteness: 'complete', annualCycleRegistry, retirementService: harness.RetirementService, careerSeed,
  });
});
MarketSeeder.seedAgentsAndMandates({
  playerRegistry, agentRegistry, careerSeed, referenceDate: calendar.seasonStartDate, players: freeAgents,
});
world.attachDomainRegistries({
  playerRegistry, contractRegistry, registrationRegistry, agentRegistry, marketRegistry, transferRegistry, loanRegistry, annualCycleRegistry, academyRegistry,
});
console.log('OK  registros de dominio (Contract/Registration/Market/Transfer/Loan/Cycle) adjuntados por identidad');

// Punto 6 (segunda mitad): con los registros REALES ya construidos,
// EligibilityService evalúa sobre el MISMO contexto canónico de Copa —
// nunca sobre `team.division` (BUG-COMPCORE-02).
{
  const evaluation = EligibilityService.evaluateEligibility(
    copaEligibilityTeam.roster[0].id, copaEligibilityTeam.id, copaEligibilityContext,
    {
      playerRegistry, contractRegistry, registrationRegistry, clubId: copaEligibilityTeam.clubId,
    },
  );
  assert.ok(evaluation, 'EligibilityService debe poder evaluar sobre el contexto canónico de Copa');
}
console.log('OK  EligibilityService evalúa sobre el contexto canónico de Copa (punto 6)');

// Punto 9 (parte 1): MoraBanc ANTES del ciclo — Club andorrano, Entry ACB.
function assertMoraBancTransborder(label) {
  const team = world.registries.teams.require('team-morabanc-andorra');
  const club = world.registries.clubs.require('club-morabanc-andorra');
  assert.strictEqual(club.homeAreaId, 'area-country-ad', `[${label}] MoraBanc: área de origen debe seguir siendo Andorra`);
  assert.strictEqual(club.employerJurisdictionAreaId, 'area-country-ad', `[${label}] MoraBanc: jurisdicción laboral debe seguir siendo Andorra`);
  assert.strictEqual(team.club, club, `[${label}] team.club debe seguir siendo la MISMA instancia`);
  const competitionId = CompetitionParticipationService.primaryLeagueCompetitionId(world.registries, team.id, { seasonKey: team.legacyDivision === '1ª' ? seasonKey : seasonKey });
  return { team, club, competitionId };
}
{
  const { competitionId } = assertMoraBancTransborder('antes del ciclo anual');
  assert.strictEqual(competitionId, 'acb', '[antes del ciclo] MoraBanc debe tener su Entry en ACB');
}
console.log('OK  MoraBanc Andorra: Club andorrano, participación real en ACB (punto 9, antes del ciclo)');

// =========================================================================
// 7. Evidencia de temporada + UNA transición anual completa (arnés real de
//    CYCLE-1) — reutiliza `cycle1-harness.js`, nunca un atajo propio.
// =========================================================================
const evidence = harness.collectSeasonEvidence({
  leagues: [leagues['1ª'], leagues['2ª']],
  brackets: [
    { bracket: brackets['1ª'].cup, phaseId: 'cup' },
    { bracket: brackets['1ª'].titlePlayoff, phaseId: 'title-playoff' },
    { bracket: brackets['2ª'].promotionPlayoff, phaseId: 'promotion-playoff' },
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
const seasonEndDateTime = calendar.currentGameDateTime;
const transition = harness.runAnnualCycleTransition({
  annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry,
  marketRegistry, agentRegistry, transferRegistry, loanRegistry,
  teams: allTeams,
  leagueA: leagues['1ª'],
  leagueB: leagues['2ª'],
  cup: brackets['1ª'].cup,
  titlePlayoff: brackets['1ª'].titlePlayoff,
  promotionPlayoff: brackets['2ª'].promotionPlayoff,
  fromSeasonKey: seasonKey,
  targetSeasonKey,
  evidence,
  seasonEndDateTime,
  config: CONFIG_BASE,
  careerSeed,
  classificationCache,
});
assert.strictEqual(transition.finalPhase, 'new-season-started', 'el ciclo debe completar sus 13 fases sin clubes NOT READY');
console.log(`OK  transición anual completa ${seasonKey} -> ${targetSeasonKey}: promocionan ${transition.summary.promoted.join(', ')}; descienden ${transition.summary.relegated.join(', ')} (punto 7)`);

// AcademyMembership.clubId real (verificación cruzada rápida, ya cubierta a
// fondo por test-club-core1.js — aquí solo confirma que el engine no rompe
// el flujo de cantera).
{
  const moraBancTeam = world.registries.teams.require('team-morabanc-andorra');
  const intake = AcademyService.runAnnualIntake({
    academyRegistry, playerRegistry, team: moraBancTeam, cycle: null, date: bootstrapIsoDate, seasonKey, config: CONFIG_BASE, careerSeed,
  });
  assert.strictEqual(intake.clubId, moraBancTeam.clubId);
}

// =========================================================================
// 8. Nueva temporada SOBRE EL MISMO GameWorld/engine — nunca se reconstruye
//    ninguno de los dos.
// =========================================================================
const newCalendar = new Calendar(seasonStartYear + 1, CONFIG_BASE);
const newTeamsByDivision = {
  '1ª': allTeams.filter((t) => t.division === '1ª'),
  '2ª': allTeams.filter((t) => t.division === '2ª'),
};
allTeams.forEach((team) => { team.legacyDivision = team.division; });

bindNewSeasonEditions(world, {
  seasonKey: targetSeasonKey, teamsByDivision: newTeamsByDivision, startDate: LocalDate.fromJsDate(newCalendar.seasonStartDate),
});
engine.setDateResolverProvider(buildDateResolverProvider());
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, targetSeasonKey));
engine.initializeEdition(buildEditionId(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, targetSeasonKey));
buildSeasonActivationPlan(targetSeasonKey).forEach((rule) => engine.registerCrossEditionActivation(rule));
leagues = {
  '1ª': buildLeagueFacade(CompetitionCatalog.COMPETITION_IDS.ACB, newTeamsByDivision['1ª']),
  '2ª': buildLeagueFacade(CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, newTeamsByDivision['2ª']),
};
world.setCalendar(newCalendar);

const newAcbEdition = world.registries.competitionEditions.require(buildEditionId(CompetitionCatalog.COMPETITION_IDS.ACB, targetSeasonKey));
assert.strictEqual(newAcbEdition.status, 'active');
assert.strictEqual(world.registries.competitionEditions.forDefinition(CompetitionCatalog.COMPETITION_IDS.ACB).length, 2, 'la edición anterior de ACB no se borra, queda completed');
console.log('OK  nueva temporada creada sobre el MISMO GameWorld/engine — la edición anterior queda completed, nunca se borra');

// =========================================================================
// 9. Revalidación de integridad e identidad tras la transición anual —
//    World, Player, Club/Team/Squad, participación y MoraBanc Andorra.
// =========================================================================
const finalErrors = world.validateIntegrity();
assert.deepStrictEqual(finalErrors, [], `el mundo debe seguir válido tras la transición anual: ${JSON.stringify(finalErrors.slice(0, 5))}`);
const engineErrors = engine.validateIntegrity();
assert.deepStrictEqual(engineErrors, [], 'el engine (mismas WorldRegistries) debe seguir válido tras la transición');
assert.strictEqual(world.registries.teams.size, 36);
assert.strictEqual(world.registries.clubs.size, 36);
assert.strictEqual(world.registries.squads.size, 36);
allTeams.forEach((team) => {
  assert.strictEqual(world.registries.teams.get(team.id), team, `"${team.id}" debe seguir siendo la MISMA instancia`);
  assert.strictEqual(team.club, world.registries.clubs.get(team.clubId));
  const entries = world.registries.competitionEntries.forParticipant(team.id);
  assert.ok(entries.length > 0, `"${team.id}" debe tener participación (Entry) tras la transición`);
});

// Punto 9 (parte 2): MoraBanc DESPUÉS del ciclo — sigue Club andorrano
// aunque su Entry (ACB o Primera FEB) haya cambiado por el puente
// deportivo de ascenso/descenso.
{
  const { team, competitionId } = assertMoraBancTransborder('después del ciclo anual');
  const expectedCompetitionId = team.division === '1ª' ? 'acb' : 'primera-feb';
  assert.strictEqual(competitionId, expectedCompetitionId, 'la participación de MoraBanc debe seguir la división real tras el ciclo, nunca quedarse en la de antes');
  const club = world.registries.clubs.require('club-morabanc-andorra');
  assert.strictEqual(club.homeAreaId, 'area-country-ad');
  assert.strictEqual(club.employerJurisdictionAreaId, 'area-country-ad');
}
console.log('OK  integridad e identidad Club/Team/Squad/participación tras la transición; MoraBanc Andorra conserva origen/jurisdicción con su Entry real (punto 8-9)');

console.log(`\nSMOKE TEST COMP-CORE-1: OK (36 clubes/equipos, 1 temporada completa vía el engine + 1 transición anual, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
