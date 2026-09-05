// scripts/smoke-club-core1.js
// CLUB-CORE-1 (DESIGN.md sección 10) — smoke CORTO: reutiliza EXACTAMENTE
// la misma construcción de carrera que `smoke-world-core1.js` (36 equipos
// reales, `world-core-2026.1` + `spain-2026.1`, registros de dominio
// CONTRACT-1..CYCLE-1, una temporada completa de Liga+Copa+Playoffs, una
// transición anual completa con el arnés de CYCLE-1) y añade las
// comprobaciones ESPECÍFICAS de esta entrega: 36 Club/Team/Squad con ids
// TODOS distintos, Contract/License con clubId real y Registration con
// teamId real, AcademyMembership con clubId real, y el caso transfronterizo
// de MoraBanc Andorra verificado tanto ANTES como DESPUÉS de la transición
// (siga o no en la misma división). Nunca 10 temporadas — eso es
// `smoke-cycle1.js`. Convención del proyecto: identificadores en inglés,
// comentarios en español.

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
const { AcademyService } = require('../src/core/AcademyService.js');
const harness = require('./cycle1-harness.js');

const startedAt = Date.now();
const careerSeed = 'smoke-club-core1-seed-v1';
const seasonStartYear = 2026;

console.log('=== SMOKE CLUB-CORE-1 (1 temporada + 1 transición anual) ===\n');

// =========================================================================
// 1. Construcción de la carrera: 36 equipos reales + GameWorld canónico
//    (misma base que smoke-world-core1.js)
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
  id: `world:smoke-club-core1:${careerSeed}`,
  name: 'Mundo de la carrera (smoke CLUB-CORE-1)',
  careerSeed,
  createdAtGameDate: bootstrapIsoDate,
  packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
  context: { teamsByDivision, seasonKey, seasonStartDate: bootstrapIsoDate },
});
world.setCalendar(calendar);

assert.deepStrictEqual(world.validateIntegrity(), [], 'el mundo recién construido debe validar sin errores');
assert.strictEqual(world.registries.clubs.size, 36, 'deben registrarse los 36 clubes reales');
assert.strictEqual(world.registries.teams.size, 36, 'deben registrarse los 36 equipos reales');
console.log(`OK  1 mundo · 36 clubes · 36 equipos · ${playerRegistry.all().length} jugadores`);

// -------------------------------------------------------------------------
// 1-bis. CLUB-CORE-1: los 36 Club/Team/Squad tienen ids TODOS distintos, y
// cada Team tiene EXACTAMENTE un Squad activo cuyo roster es la MISMA
// referencia que team.roster (invariante 7, DESIGN.md sección 10).
// -------------------------------------------------------------------------
assert.strictEqual(world.registries.squads.size, 36, 'un squad activo por equipo, ni uno más ni uno menos');
const allClubIds = new Set();
const allTeamIds = new Set();
allTeams.forEach((team) => {
  assert.ok(team.clubId, `el equipo "${team.id}" debe tener clubId asignado`);
  assert.notStrictEqual(team.clubId, team.id, `"${team.id}": clubId nunca debe coincidir con teamId en spain-2026.1`);
  assert.ok(team.club, `el equipo "${team.id}" debe tener una instancia REAL de Club enlazada`);
  assert.strictEqual(team.club, world.registries.clubs.get(team.clubId), 'team.club debe ser la MISMA instancia que el registro');
  const squad = world.registries.squads.activeForTeam(team.id);
  assert.ok(squad, `el equipo "${team.id}" debe tener un squad activo`);
  assert.strictEqual(squad.teamId, team.id);
  assert.strictEqual(team.roster, squad.players, 'team.roster debe ser la MISMA referencia que squad.players');
  allClubIds.add(team.clubId);
  allTeamIds.add(team.id);
});
assert.strictEqual(allClubIds.size, 36, '36 clubId distintos');
assert.strictEqual(allTeamIds.size, 36, '36 teamId distintos');
const intersection = [...allClubIds].filter((id) => allTeamIds.has(id));
assert.deepStrictEqual(intersection, [], 'ningún clubId real debe coincidir con ningún teamId real');
console.log('OK  36 Club/Team/Squad con ids TODOS distintos, cada Team con su Squad activo real (misma referencia de roster)');

// -------------------------------------------------------------------------
// 1-ter. MoraBanc Andorra ANTES de jugar — el test transfronterizo
// obligatorio de toda la EPIC: organizador ACB/España, empleador Andorra,
// clubId real distinto de teamId.
// -------------------------------------------------------------------------
function assertMoraBancIdentity(label) {
  const team = world.registries.teams.require('team-morabanc-andorra');
  assert.strictEqual(team.clubId, 'club-morabanc-andorra', `[${label}] clubId de MoraBanc debe seguir siendo "club-morabanc-andorra"`);
  const club = world.registries.clubs.require('club-morabanc-andorra');
  assert.strictEqual(club.homeAreaId, 'area-country-ad', `[${label}] MoraBanc: área de origen debe seguir siendo Andorra`);
  assert.strictEqual(club.employerJurisdictionAreaId, 'area-country-ad', `[${label}] MoraBanc: jurisdicción laboral debe seguir siendo Andorra`);
  assert.strictEqual(team.club, club, `[${label}] team.club debe seguir siendo la MISMA instancia`);
  const squad = world.registries.squads.activeForTeam(team.id);
  assert.ok(squad, `[${label}] MoraBanc debe seguir teniendo squad activo`);
  assert.strictEqual(squad.teamId, team.id);
  return { team, club };
}
assertMoraBancIdentity('antes de la temporada');
console.log('OK  MoraBanc Andorra: clubId/teamId distintos, jurisdicción Andorra, organizador ACB/España (antes de jugar)');

// =========================================================================
// 2. Ligas reales, enlazadas con sus stages canónicos (igual que
//    smoke-world-core1.js)
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
console.log('OK  ediciones/stages/entries de ACB y Primera FEB enlazados con sus League reales');

// =========================================================================
// 3. Registros de dominio (CONTRACT-1..CYCLE-1) — mismo bootstrap que
//    smoke-world-core1.js, con las comprobaciones de identidad Club/Team
//    de CLUB-CORE-1 añadidas.
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

// -------------------------------------------------------------------------
// CLUB-CORE-1: Contract.clubId / License.clubId son SIEMPRE Club ids reales
// (nunca teamId); CompetitionRegistration.teamId es SIEMPRE un Team id.
// Comprobado sobre TODOS los equipos (no solo una muestra) — barato, ya
// están todos sembrados.
// -------------------------------------------------------------------------
allTeams.forEach((team) => {
  const contract = contractRegistry.currentForPlayer(team.roster[0].id, bootstrapIsoDate);
  assert.ok(contract, `debe existir contrato sembrado para un jugador de "${team.id}"`);
  assert.strictEqual(contract.clubId, team.clubId, `Contract.clubId de "${team.id}" debe ser su clubId real`);
  const registration = registrationRegistry.registrationsForPlayer(team.roster[0].id)
    .find((r) => r.statusOn(bootstrapIsoDate) === 'active');
  assert.ok(registration, `debe existir inscripción activa para un jugador de "${team.id}"`);
  assert.strictEqual(registration.teamId, team.id, `CompetitionRegistration.teamId de "${team.id}" debe ser su teamId real`);
  const license = registrationRegistry.licensesForPlayer(team.roster[0].id)[0];
  assert.ok(license, `debe existir licencia federativa para un jugador de "${team.id}"`);
  assert.strictEqual(license.clubId, team.clubId, `FederationLicense.clubId de "${team.id}" debe ser su clubId real`);
});
assert.deepStrictEqual(
  contractRegistry.validateIntegrity({ playerRegistry, teams: allTeams, date: bootstrapIsoDate, loanRegistry }).errors, [],
);
assert.deepStrictEqual(
  registrationRegistry.validateIntegrity({ playerRegistry, contractRegistry, teams: allTeams, date: bootstrapIsoDate }).errors, [],
);
console.log('OK  Contract.clubId / License.clubId (Club real) y Registration.teamId (Team real) correctos en los 36 clubes, sin errores de integridad');

const bootstrapLegality = harness.ensureAllClubsLegalBeforeFirstMatch({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, config: CONFIG_BASE, careerSeed,
  annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry, loanRegistry, classificationCache,
});
assert.ok(bootstrapLegality.ready !== false, 'los 36 clubes deben poder construir una convocatoria legal antes del primer partido');
console.log('OK  registros de dominio adjuntados por identidad, legalidad previa OK');

// -------------------------------------------------------------------------
// CLUB-CORE-1: AcademyMembership.clubId es SIEMPRE el clubId real del club
// (nunca team.id) — probado con un intake dirigido sobre MoraBanc (el
// mismo caso transfronterizo).
// -------------------------------------------------------------------------
{
  const { team: moraBancTeam } = assertMoraBancIdentity('antes del intake de cantera dirigido');
  const intake = AcademyService.runAnnualIntake({
    academyRegistry, playerRegistry, team: moraBancTeam, cycle: null, date: bootstrapIsoDate, seasonKey, config: CONFIG_BASE, careerSeed,
  });
  assert.strictEqual(intake.clubId, moraBancTeam.clubId, 'AcademyService.runAnnualIntake debe devolver el clubId real, nunca el teamId');
  if (intake.created.length > 0) {
    assert.strictEqual(intake.created[0].membership.clubId, moraBancTeam.clubId);
  }
  const pool = academyRegistry.activePoolForClub(moraBancTeam.clubId, bootstrapIsoDate);
  assert.ok(pool.length >= intake.created.length, 'el pool de cantera de MoraBanc debe resolverse por su clubId real');
}
console.log('OK  AcademyMembership.clubId resuelto con el clubId real (probado sobre MoraBanc Andorra)');

// =========================================================================
// 4. Una temporada COMPLETA (Liga + Copa + Playoff por el título + Playoff
//    de ascenso) — idéntico a smoke-world-core1.js.
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
// 5. Evidencia de temporada (para el cierre) — igual que smoke-world-core1.js
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
console.log('OK  evidencia de última jornada oficial de los 36 clubes recogida');

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

// =========================================================================
// 8. Re-validación de integridad e identidad tras la transición anual —
//    incluye MoraBanc Andorra, promocione/descienda o no esta temporada.
// =========================================================================
const finalErrors = world.validateIntegrity();
assert.deepStrictEqual(finalErrors, [], `el mundo debe seguir válido tras la transición anual: ${JSON.stringify(finalErrors.slice(0, 5))}`);
assert.strictEqual(world.registries.teams.size, 36, 'siguen siendo 36 equipos');
assert.strictEqual(world.registries.clubs.size, 36, 'siguen siendo 36 clubes — la transición nunca crea/destruye Club');
assert.strictEqual(world.registries.squads.size, 36, 'sigue habiendo 36 squads (uno activo por equipo)');

allTeams.forEach((team) => {
  assert.strictEqual(world.registries.teams.get(team.id), team, `el equipo "${team.id}" debe seguir siendo la MISMA instancia`);
  assert.strictEqual(team.club, world.registries.clubs.get(team.clubId), `el Club de "${team.id}" debe seguir siendo la MISMA instancia`);
  const squad = world.registries.squads.activeForTeam(team.id);
  assert.ok(squad, `"${team.id}" debe seguir teniendo squad activo tras la transición`);
  assert.strictEqual(team.roster, squad.players, `"${team.id}": team.roster sigue siendo la vista del squad activo`);
});

assertMoraBancIdentity('después de la transición anual');
const moraBancDivisionChange = transition.summary.promotedIds.includes('team-morabanc-andorra')
  ? 'promocionado' : (transition.summary.relegatedIds.includes('team-morabanc-andorra') ? 'descendido' : 'sin cambio de división');
console.log(`OK  integridad e identidad Club/Team/Squad tras la transición (36+36+36, MoraBanc Andorra ${moraBancDivisionChange})`);

console.log(`\nSMOKE TEST CLUB-CORE-1: OK (36 clubes/equipos/squads, 1 temporada completa + 1 transición anual, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
