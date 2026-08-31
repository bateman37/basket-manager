// scripts/smoke-world-core1.js
// WORLD-CORE-1 (sección 13.2 del prompt) — smoke CORTO: construye la carrera
// actual (world-core-2026.1 + spain-2026.1), verifica 1 mundo/Europa/España/
// Andorra/organizaciones/36 clubes/36 equipos/jugadores, juega UNA temporada
// completa de ambas competiciones domésticas con el runtime actual (Liga +
// Copa + Playoff por el título + Playoff de ascenso), comprueba que la
// evidencia usa edition/stage canónicos, ejecuta UNA transición anual
// completa reutilizando el arnés de CYCLE-1 y vuelve a validar integridad e
// identidad de instancias. Nunca 10 temporadas — eso es `smoke-cycle1.js`.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

const assert = require('assert');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { Calendar } = require('../src/core/Calendar.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
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
const { createCup, CUP_TRIGGER_ROUND } = require('../src/core/Cup.js');
const { createTitlePlayoff, TITLE_PLAYOFF_ROUND_PATTERNS } = require('../src/core/Playoffs.js');
const { PromotionPlayoff, PROMOTION_ROUND_PATTERNS } = require('../src/core/Promotion.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { padRosterToMinimum } = require('../src/utils/playerGenerator.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const { SPAIN_MANIFEST } = require('../data/world/spain-2026.1.js');
const { SpainLegacyCompetitionRuntime } = require('../src/core/SpainLegacyCompetitionRuntime.js');
const harness = require('./cycle1-harness.js');

const startedAt = Date.now();
const careerSeed = 'smoke-world-core1-seed-v1';
const seasonStartYear = 2026;

console.log('=== SMOKE WORLD-CORE-1 (1 temporada + 1 transición anual) ===\n');

// =========================================================================
// 1. Construcción de la carrera: 36 equipos reales + GameWorld canónico
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
  id: `world:smoke:${careerSeed}`,
  name: 'Mundo de la carrera (smoke)',
  careerSeed,
  createdAtGameDate: bootstrapIsoDate,
  packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
  context: { teamsByDivision, seasonKey, seasonStartDate: bootstrapIsoDate },
});
world.setCalendar(calendar);

assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo recién construido debe validar sin errores');
assert.strictEqual(world.registries.areas.all().filter((a) => a.type === 'world').length, 1);
assert.ok(world.registries.areas.has('area-continent-europe'));
assert.ok(world.registries.areas.has('area-country-es'));
assert.ok(world.registries.areas.has('area-country-ad'));
assert.ok(world.registries.organizations.has('org-feb') && world.registries.organizations.has('org-acb'));
assert.strictEqual(world.registries.clubs.size, 36, 'deben registrarse los 36 clubes reales');
assert.strictEqual(world.registries.teams.size, 36, 'deben registrarse los 36 equipos reales');
assert.strictEqual(
  playerRegistry.all().length,
  allTeams.reduce((sum, team) => sum + team.roster.length, 0),
  'todos los jugadores deben estar registrados exactamente una vez',
);
console.log(`OK  1 mundo · Europa · España · Andorra · 36 clubes · 36 equipos · ${playerRegistry.all().length} jugadores`);

// =========================================================================
// 2. Ligas reales, enlazadas con sus stages canónicos
// =========================================================================
function buildLeagueDateResolver(div) {
  return (round, matchIndexInRound, matchesInRound, totalRounds) => (
    calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
  );
}
let leagues = {
  '1ª': new League(teamsByDivision['1ª'], buildLeagueDateResolver('1ª')),
  '2ª': new League(teamsByDivision['2ª'], buildLeagueDateResolver('2ª')),
};
['1ª', '2ª'].forEach((div) => {
  SpainLegacyCompetitionRuntime.bindLeagueRuntime(world, { division: div, seasonKey, league: leagues[div] });
});

const acbEdition = world.registries.competitionEditions.require(`edition:acb:${seasonKey}`);
const febEdition = world.registries.competitionEditions.require(`edition:primera-feb:${seasonKey}`);
assert.strictEqual(world.registries.competitionEntries.forEdition(acbEdition.id).length, 18);
assert.strictEqual(world.registries.competitionEntries.forEdition(febEdition.id).length, 18);
assert.strictEqual(acbEdition.runtimeBinding, leagues['1ª'], 'la edición de ACB debe llevar la MISMA League como runtimeBinding');
console.log('OK  ediciones/stages/entries de ACB y Primera FEB (18+18) enlazados con sus League reales');

// =========================================================================
// 3. Registros de dominio (CONTRACT-1..CYCLE-1) — mismo bootstrap que el
//    resto de la EPIC, adjuntados al mundo por IDENTIDAD.
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
assert.strictEqual(world.domainRegistries.playerRegistry, playerRegistry, 'alias de identidad estricta');
assert.strictEqual(world.domainRegistries.contractRegistry, contractRegistry, 'alias de identidad estricta');

const bootstrapLegality = harness.ensureAllClubsLegalBeforeFirstMatch({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, config: CONFIG_BASE, careerSeed,
  annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry, loanRegistry, classificationCache,
});
assert.ok(bootstrapLegality.ready !== false, 'los 36 clubes deben poder construir una convocatoria legal antes del primer partido');
console.log('OK  registros de dominio (Contract/Registration/Market/Cycle) adjuntados por identidad, legalidad previa OK');

// =========================================================================
// 4. Una temporada COMPLETA (Liga + Copa + Playoff por el título + Playoff
//    de ascenso), enlazando cada bracket real con su stage canónico.
// =========================================================================
let brackets = { cup: null, titlePlayoff: null, promotionPlayoff: null };

function createBracketsIfDue(division, league) {
  if (division === '1ª' && league.currentRound === CUP_TRIGGER_ROUND + 1 && !brackets.cup) {
    const qualifiedTeams = league.getStandingsTable().slice(0, 8).map((s) => s.team);
    brackets.cup = createCup(league, calendar.cupRoundDates());
    SpainLegacyCompetitionRuntime.bindCup(world, { seasonKey, bracket: brackets.cup, qualifiedTeams });
  }
  if (!league.isSeasonComplete) return;
  const playoffStartDate = calendar.titlePlayoffStartDate(calendar.leagueRoundDate(league.totalRounds));
  if (division === '1ª') {
    if (brackets.titlePlayoff) return;
    const qualifiedTeams = league.getStandingsTable().slice(0, 8).map((s) => s.team);
    brackets.titlePlayoff = createTitlePlayoff(league, calendar.buildBracketDateResolver(playoffStartDate, TITLE_PLAYOFF_ROUND_PATTERNS));
    SpainLegacyCompetitionRuntime.bindTitlePlayoff(world, { seasonKey, bracket: brackets.titlePlayoff, qualifiedTeams });
  } else {
    if (brackets.promotionPlayoff) return;
    const qualifiedTeams = league.getStandingsTable().slice(0, 9).map((s) => s.team);
    brackets.promotionPlayoff = new PromotionPlayoff(league, calendar.buildBracketDateResolver(playoffStartDate, PROMOTION_ROUND_PATTERNS));
    SpainLegacyCompetitionRuntime.bindPromotionPlayoff(world, { seasonKey, bracket: brackets.promotionPlayoff, qualifiedTeams });
  }
}

['1ª', '2ª'].forEach((div) => recalculateSportingGoalsForDivision(teamsByDivision[div], CONFIG_BASE));

while (!leagues['1ª'].isSeasonComplete || !leagues['2ª'].isSeasonComplete) {
  ['1ª', '2ª'].forEach((div) => {
    const league = leagues[div];
    if (league.isSeasonComplete) return;
    league.simulateNextRound(CONFIG_BASE);
    createBracketsIfDue(div, league);
  });
}
while (brackets.cup && !brackets.cup.isComplete) brackets.cup.playNextGame(CONFIG_BASE);
while (brackets.titlePlayoff && !brackets.titlePlayoff.isComplete) brackets.titlePlayoff.playNextGame(CONFIG_BASE);
while (brackets.promotionPlayoff && !brackets.promotionPlayoff.isComplete) brackets.promotionPlayoff.playNextGame(CONFIG_BASE);

assert.ok(brackets.cup && brackets.cup.isComplete, 'la Copa debe haberse jugado hasta el final');
assert.ok(brackets.titlePlayoff && brackets.titlePlayoff.isComplete, 'el playoff por el título debe haberse jugado hasta el final');
assert.ok(brackets.promotionPlayoff && brackets.promotionPlayoff.isComplete, 'el playoff de ascenso debe haberse jugado hasta el final');
console.log('OK  temporada completa: Liga + Copa + Playoff por el título + Playoff de ascenso jugados hasta el final');

// =========================================================================
// 5. La evidencia usa edition/stage canónicos
// =========================================================================
const evidence = harness.collectSeasonEvidence({
  leagues: [leagues['1ª'], leagues['2ª']],
  brackets: [
    { bracket: brackets.cup, phaseId: 'cup' },
    { bracket: brackets.titlePlayoff, phaseId: 'title-playoff' },
    { bracket: brackets.promotionPlayoff, phaseId: 'promotion-playoff' },
  ],
});
const missingEvidence = evidence.missingClubIds(allTeams);
assert.strictEqual(missingEvidence.length, 0, `clubes sin evidencia de último partido oficial: ${missingEvidence.join(', ')}`);

// La propia evidencia usa `CompetitionRules.competitionIdFromLegacyDivision`
// (el único adaptador legacy) — se comprueba aquí que ese id coincide
// EXACTAMENTE con la CompetitionEdition/Stage canónicos ya creados arriba.
['1ª', '2ª'].forEach((div) => {
  const competitionId = CompetitionRules.competitionIdFromLegacyDivision(div);
  const edition = world.registries.competitionEditions.require(`edition:${competitionId}:${seasonKey}`);
  assert.strictEqual(edition.competitionDefinitionId, competitionId);
  const stage = world.registries.competitionStages.require(`stage:${competitionId}:${seasonKey}:regular-season`);
  assert.strictEqual(stage.editionId, edition.id);
});
const copaEdition = world.registries.competitionEditions.require(`edition:copa-acb:${seasonKey}`);
assert.strictEqual(copaEdition.competitionDefinitionId, 'copa-acb');
assert.notStrictEqual(copaEdition.id, acbEdition.id, 'invariante 13: la Copa es una edición SEPARADA de la Liga');
console.log('OK  evidencia de temporada resuelta contra edition/stage canónicos (Liga y Copa separadas, invariante 13)');

// =========================================================================
// 6. UNA transición anual completa (arnés real de CYCLE-1)
// =========================================================================
const targetSeasonKey = LocalDate.seasonKeyFromStartYear(seasonStartYear + 1);
const seasonEndDateTime = calendar.currentGameDateTime;
const transition = harness.runAnnualCycleTransition({
  annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry,
  marketRegistry, agentRegistry, transferRegistry, loanRegistry,
  teams: allTeams,
  leagueA: leagues['1ª'],
  leagueB: leagues['2ª'],
  cup: brackets.cup,
  titlePlayoff: brackets.titlePlayoff,
  promotionPlayoff: brackets.promotionPlayoff,
  fromSeasonKey: seasonKey,
  targetSeasonKey,
  evidence,
  seasonEndDateTime,
  config: CONFIG_BASE,
  careerSeed,
  classificationCache,
});
assert.strictEqual(transition.finalPhase, 'new-season-started', 'el ciclo debe completar sus 13 fases sin clubes NOT READY');
console.log(`OK  transición anual completa ${seasonKey} -> ${targetSeasonKey}: promocionan ${transition.summary.promoted.join(', ')}; descienden ${transition.summary.relegated.join(', ')}`);

// =========================================================================
// 7. Nueva temporada sobre el MISMO GameWorld — nunca se reconstruye
// =========================================================================
const newCalendar = new Calendar(seasonStartYear + 1, CONFIG_BASE);
const newTeamsByDivision = {
  '1ª': allTeams.filter((t) => t.division === '1ª'),
  '2ª': allTeams.filter((t) => t.division === '2ª'),
};
allTeams.forEach((team) => { team.legacyDivision = team.division; });
function newLeagueDateResolver(div) {
  return (round, matchIndexInRound, matchesInRound, totalRounds) => (
    newCalendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
  );
}
leagues = {
  '1ª': new League(newTeamsByDivision['1ª'], newLeagueDateResolver('1ª')),
  '2ª': new League(newTeamsByDivision['2ª'], newLeagueDateResolver('2ª')),
};
SpainLegacyCompetitionRuntime.bindNewSeason(world, {
  seasonKey: targetSeasonKey, teamsByDivision: newTeamsByDivision, startDate: LocalDate.fromJsDate(newCalendar.seasonStartDate),
});
['1ª', '2ª'].forEach((div) => {
  SpainLegacyCompetitionRuntime.bindLeagueRuntime(world, { division: div, seasonKey: targetSeasonKey, league: leagues[div] });
});
world.setCalendar(newCalendar);

const oldAcbEdition = world.registries.competitionEditions.require(acbEdition.id);
assert.strictEqual(oldAcbEdition.status, 'completed', 'la edición de la temporada anterior queda completed, nunca se borra');
const newAcbEdition = world.registries.competitionEditions.require(`edition:acb:${targetSeasonKey}`);
assert.strictEqual(newAcbEdition.status, 'active');
assert.notStrictEqual(newAcbEdition.id, oldAcbEdition.id);

// =========================================================================
// 8. Re-validación de integridad e identidad de instancias
// =========================================================================
const finalErrors = world.validateIntegrity();
assert.deepStrictEqual(finalErrors, [], `el mundo debe seguir válido tras la transición anual: ${JSON.stringify(finalErrors.slice(0, 5))}`);
assert.strictEqual(world.registries.teams.size, 36, 'siguen siendo 36 equipos — la transición nunca duplica ni destruye instancias');
allTeams.forEach((team) => {
  assert.strictEqual(world.registries.teams.get(team.id), team, `el equipo "${team.id}" debe seguir siendo la MISMA instancia tras la transición`);
});
assert.strictEqual(world.domainRegistries.playerRegistry, playerRegistry, 'el alias de playerRegistry sigue siendo identidad estricta');
console.log('OK  integridad e identidad de instancias tras la transición anual (36 equipos, mismos objetos, world.validateIntegrity() == [])');

console.log(`\nSMOKE TEST WORLD-CORE-1: OK (36 equipos, 1 temporada completa + 1 transición anual, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
