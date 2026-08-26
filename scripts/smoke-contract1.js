#!/usr/bin/env node
// scripts/smoke-contract1.js
// Prueba de humo CONTRACT-1 (DESIGN.md 9.17) contra la Liga real de 36
// equipos — replica en Node el camino real de game.js (mismo patrón que
// smoke-roster1.js) añadiendo la vertical contractual completa: catálogo de
// contexto laboral por club, registro contractual explícito, contratos
// bootstrap simulados, nómina derivada, cierre de temporada con ascensos/
// descensos y cantera contratada con el contexto YA actualizado.
//
// Ejecutar con:
//   node scripts/smoke-contract1.js [temporadas]

const assert = require('assert');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const PC = require('../src/core/PlayerCareer.js');
const Training = require('../src/core/Training.js');
const TrainingAI = require('../src/core/TrainingAI.js');
const { League } = require('../src/core/League.js');
const { Calendar } = require('../src/core/Calendar.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { ClubEmploymentContextCatalog } = require('../src/core/ClubEmploymentContextCatalog.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractService } = require('../src/core/ContractService.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { Money } = require('../src/utils/Money.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { buildCpuLineup, computeMatchImportance } = require('../src/core/CpuLineup.js');
const { createCup, CUP_TRIGGER_ROUND } = require('../src/core/Cup.js');
const { createTitlePlayoff } = require('../src/core/Playoffs.js');
const { PromotionPlayoff } = require('../src/core/Promotion.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { padRosterToMinimum, FICTIONAL_FALLBACK_DATA_SOURCE } = require('../src/utils/playerGenerator.js');

const SEASONS_TO_SIMULATE = Number(process.argv[2] || 3);

function resolveSquadRulesForDivision(division, seasonKey, date) {
  const competitionId = CompetitionRules.competitionIdFromLegacyDivision(division);
  return CompetitionRules.resolveRules({
    competitionId, seasonKey, date, operation: 'buildMatchSquad',
  }).squadRules;
}

function buildRealTeam(teamData, referenceDate, seasonKey) {
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...playerFields } = playerData;
    const player = new Player(playerFields);
    player.dataSource = dataSource || null;
    PD.ensureDevelopmentState(player, CONFIG_BASE, referenceDate);
    PC.ensureCareerHistory(player, CONFIG_BASE, referenceDate, { historyCompleteness: 'partial', seasonKey });
    return player;
  });
  const squadRules = resolveSquadRulesForDivision(teamData.division, seasonKey, referenceDate);
  const fallbackPlayers = padRosterToMinimum(roster, squadRules.min, { minAge: 18, maxAge: 34, referenceDate });
  fallbackPlayers.forEach((player) => {
    PC.ensureCareerHistory(player, CONFIG_BASE, referenceDate, { historyCompleteness: 'complete', seasonKey });
  });
  return new Team({ ...teamData, roster });
}

// =====================================================================
// 1. Arranque completo (equivalente a startSeason() en game.js)
// =====================================================================
console.log('Construyendo 36 equipos reales (1ª+2ª), Player Registry y Contract Registry...');
let seasonStartYear = 2026;
let calendar = new Calendar(seasonStartYear, CONFIG_BASE);
const calendarCtx = { seasonStartDate: calendar.seasonStartDate };
let referenceDate = calendar.seasonStartDate;
let seasonKey = PC.seasonKeyFromStartYear(seasonStartYear);

const playerRegistry = new PlayerRegistry();
let teamsByDivision = {};
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div)
    .map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id], referenceDate, seasonKey));
});
let allTeams = teamsByDivision['1ª'].concat(teamsByDivision['2ª']);
allTeams.forEach((team) => playerRegistry.registerMany(team.roster));

// --- 2. Contexto laboral EXPLÍCITO de los 36 clubes -------------------
const catalogCheck = ClubEmploymentContextCatalog.validateCatalog(allTeams);
assert.ok(catalogCheck.valid, `contexto laboral incompleto: ${JSON.stringify(catalogCheck.errors)}`);
const jurisdictionCounts = allTeams.reduce((acc, team) => {
  const context = ClubEmploymentContextCatalog.requireClubEmploymentContext(team.id);
  acc[context.employerJurisdictionId] = (acc[context.employerJurisdictionId] || 0) + 1;
  return acc;
}, {});
console.log(`OK: ${allTeams.length} clubes con contexto laboral explícito — ${JSON.stringify(jurisdictionCounts)}.`);
assert.strictEqual(jurisdictionCounts.ES, 35);
assert.strictEqual(jurisdictionCounts.AD, 1);

// --- 3. Contratos bootstrap simulados --------------------------------
const contractRegistry = new ContractRegistry();
let bootstrapIsoDate = LocalDate.fromJsDate(referenceDate);
const bootstrap = ContractSeeder.seedContractsForTeams({
  teams: allTeams,
  seasonKey,
  date: bootstrapIsoDate,
  registry: contractRegistry,
  playerRegistry,
  config: CONFIG_BASE,
});
const provisionalWarnings = new Set();
allTeams.forEach((team) => {
  ContractService.resolveRulesForClub(team, { seasonKey, date: bootstrapIsoDate })
    .warnings.forEach((warning) => provisionalWarnings.add(warning));
});

const totalRosterPlayers = allTeams.reduce((n, t) => n + t.roster.length, 0);
const totalFallbackPlayers = allTeams.reduce(
  (n, t) => n + t.roster.filter((p) => p.dataSource === FICTIONAL_FALLBACK_DATA_SOURCE).length, 0,
);
console.log(`OK: ${contractRegistry.size} contratos simulados para ${totalRosterPlayers} jugadores en plantilla `
  + `(${totalFallbackPlayers} de relleno ficticio por cobertura incompleta de Primera FEB).`);
assert.strictEqual(contractRegistry.size, totalRosterPlayers, 'todo afiliado debe tener contrato');

function validateAll(label, date) {
  const isoDate = LocalDate.fromJsDate(date);
  const playerCheck = playerRegistry.validateAgainstTeams(allTeams);
  assert.ok(playerCheck.valid, `[${label}] Player Registry roto: ${JSON.stringify(playerCheck.errors.slice(0, 5))}`);
  const contractCheck = contractRegistry.validateIntegrity({ playerRegistry, teams: allTeams, date: isoDate });
  assert.ok(contractCheck.valid, `[${label}] Contract Registry roto: ${JSON.stringify(contractCheck.errors.slice(0, 5))}`);
  // Nómina derivada == registro contractual (nunca dos verdades).
  allTeams.forEach((team) => {
    const payroll = ContractService.refreshTeamSalaryProjection(team, contractRegistry, seasonKey);
    assert.strictEqual(
      team.finances.expenses.playerSalaries,
      Money.toMajorUnits(payroll.amountMinor, 'EUR'),
      `[${label}] la nómina proyectada de ${team.fullName} no coincide con el registro`,
    );
  });
  return contractCheck;
}
validateAll('arranque', referenceDate);
console.log('OK: Player Registry + Contract Registry íntegros al arranque; nómina derivada del registro.');

// --- 4. MoraBanc: jurisdicción andorrana ------------------------------
{
  const morabanc = allTeams.find((t) => t.id === 'team-morabanc-andorra');
  const resolved = ContractService.resolveRulesForClub(morabanc, { seasonKey, date: bootstrapIsoDate });
  assert.strictEqual(resolved.requestedContext.employerJurisdictionId, 'AD');
  assert.ok(!resolved.ruleModuleIds.includes('es-rd1006-1985-v1'));
  assert.ok(!resolved.ruleModuleIds.includes('es-smi-2026-v1'));
  contractRegistry.forClub(morabanc.id).forEach((contract) => {
    assert.strictEqual(contract.signingContext.employerJurisdictionId, 'AD');
    assert.strictEqual(contract.paymentPolicy.installmentCount, 12);
  });
  console.log(`OK: ${morabanc.fullName} compite en ACB pero contrata bajo legislación ANDORRANA `
    + `(${resolved.ruleModuleIds.join(', ')}), con 12 mensualidades.`);
}

// --- 5. Cuotas y calendario coherentes --------------------------------
{
  let scheduledTotal = 0;
  contractRegistry.all().forEach((contract) => {
    const report = contract.validatePaymentScheduleIntegrity();
    assert.ok(report.valid, `calendario de pagos incoherente: ${JSON.stringify(report.errors)}`);
    scheduledTotal += contract.scheduleForSeason(seasonKey).reduce((acc, i) => acc + i.amountMinor, 0);
  });
  console.log(`OK: calendarios de pago cuadrados al céntimo (${Money.format(scheduledTotal, 'EUR', { compact: true })} `
    + `comprometidos en cuotas en ${seasonKey}).`);
}

// --- 6. Liberación/reincorporación dirigida ---------------------------
// Un jugador liberado conserva identidad, histórico Y contrato: el contrato
// NO se clona ni cambia sin una operación explícita (que CONTRACT-1 no
// implementa todavía — rescisión/traspaso son TRANSFER-1).
{
  const team = allTeams[0];
  const targetPlayer = team.roster[0];
  const targetId = targetPlayer.id;
  const contractBefore = contractRegistry.currentForPlayer(targetId, bootstrapIsoDate);
  const snapshotBefore = JSON.stringify(contractBefore.toJSON());
  targetPlayer.careerHistory = targetPlayer.careerHistory || {};
  targetPlayer.careerHistory.__smokeMarker = 'kept-through-release-cycle';

  team.removePlayer(targetId);
  playerRegistry.setAffiliation(targetId, null);
  assert.strictEqual(playerRegistry.get(targetId).teamId, null);
  const releasedContract = contractRegistry.currentForPlayer(targetId, bootstrapIsoDate);
  assert.strictEqual(releasedContract, contractBefore, 'el contrato sigue siendo la MISMA instancia');
  assert.strictEqual(JSON.stringify(releasedContract.toJSON()), snapshotBefore, 'el contrato no cambia por sí solo');
  assert.strictEqual(contractRegistry.size, totalRosterPlayers, 'quitar a un jugador de la plantilla no borra su contrato');

  team.addPlayer(targetPlayer);
  playerRegistry.setAffiliation(targetId, team.id);
  assert.strictEqual(playerRegistry.get(targetId).careerHistory.__smokeMarker, 'kept-through-release-cycle');
  assert.strictEqual(contractRegistry.currentForPlayer(targetId, bootstrapIsoDate), contractBefore);
  validateAll('tras liberación/reincorporación', referenceDate);
  console.log('OK: liberación + reincorporación dirigida conserva identidad, histórico y contrato sin clonarlo.');
}

// =====================================================================
// Simulación de temporadas completas
// =====================================================================
function buildResolver(league, division) {
  return (match) => {
    Training.prepareTeamForMatch(match.homeTeam, match.date, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(match.awayTeam, match.date, CONFIG_BASE, calendarCtx);
    const standingsTable = league.getStandingsTable();
    const homeImportance = computeMatchImportance(match.homeTeam, match.awayTeam, 'league', standingsTable, CONFIG_BASE);
    const awayImportance = computeMatchImportance(match.awayTeam, match.homeTeam, 'league', standingsTable, CONFIG_BASE);
    const homeRules = resolveSquadRulesForDivision(match.homeTeam.division, seasonKey, match.date);
    const awayRules = resolveSquadRulesForDivision(match.awayTeam.division, seasonKey, match.date);
    const home = buildCpuLineup(match.homeTeam, homeImportance, CONFIG_BASE, match.date, homeRules);
    const away = buildCpuLineup(match.awayTeam, awayImportance, CONFIG_BASE, match.date, awayRules);
    void division;
    return {
      homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup, matchDate: match.date,
    };
  };
}

function bracketResolver(bracketDate) {
  return (homeEntry, awayEntry) => {
    Training.prepareTeamForMatch(homeEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(awayEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    const homeRules = resolveSquadRulesForDivision(homeEntry.team.division, seasonKey, bracketDate);
    const awayRules = resolveSquadRulesForDivision(awayEntry.team.division, seasonKey, bracketDate);
    const home = buildCpuLineup(homeEntry.team, true, CONFIG_BASE, bracketDate, homeRules);
    const away = buildCpuLineup(awayEntry.team, true, CONFIG_BASE, bracketDate, awayRules);
    return {
      homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup, matchDate: bracketDate,
    };
  };
}

function processDevelopmentToDateForTeams(teams, date) {
  teams.forEach((team) => Training.processTeamDevelopmentToDate(team, date, CONFIG_BASE, calendarCtx));
}

function reviewCpu(teams, date) {
  teams.forEach((team) => TrainingAI.reviewTeamIfDue(team, date, { matchesInNext7Days: 1 }, CONFIG_BASE, calendarCtx));
}

let totalNewgens = 0;
let totalNewgenMinors = 0;

for (let seasonIndex = 0; seasonIndex < SEASONS_TO_SIMULATE; seasonIndex += 1) {
  console.log(`\n=== Temporada ${seasonIndex + 1}/${SEASONS_TO_SIMULATE} (${seasonKey}) ===`);
  ['1ª', '2ª'].forEach((div) => recalculateSportingGoalsForDivision(teamsByDivision[div], CONFIG_BASE));

  const leagueDateResolver = (div) => (round, matchIndexInRound, matchesInRound, totalRounds) => (
    calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
  );
  const leagues = {
    '1ª': new League(teamsByDivision['1ª'], leagueDateResolver('1ª')),
    '2ª': new League(teamsByDivision['2ª'], leagueDateResolver('2ª')),
  };

  let cup = null;
  for (let r = 0; r < 34; r += 1) {
    ['1ª', '2ª'].forEach((div) => {
      const league = leagues[div];
      if (league.isSeasonComplete) return;
      const matches = league.simulateNextRound(undefined, buildResolver(league, div));
      if (matches.length) {
        const lastDate = matches[matches.length - 1].date;
        calendar.advanceTo(lastDate);
        processDevelopmentToDateForTeams(teamsByDivision[div], lastDate);
        reviewCpu(teamsByDivision[div], lastDate);
      }
      if (div === '1ª' && league.currentRound === CUP_TRIGGER_ROUND + 1 && !cup) {
        cup = createCup(league, calendar.cupRoundDates());
      }
    });
  }
  console.log(`Liga regular completa. Copa creada: ${!!cup}.`);
  if (cup) {
    const cupDate = calendar.currentGameDateTime;
    while (!cup.isComplete) cup.playNextGame(CONFIG_BASE, bracketResolver(cupDate));
  }

  const titlePlayoff = createTitlePlayoff(leagues['1ª']);
  const promotionPlayoff = new PromotionPlayoff(leagues['2ª']);
  [titlePlayoff, promotionPlayoff].forEach((bracket) => {
    const date = calendar.currentGameDateTime;
    while (!bracket.isComplete) bracket.playNextGame(CONFIG_BASE, bracketResolver(date));
  });
  console.log(`Playoffs completados. Campeón: ${titlePlayoff.champion ? titlePlayoff.champion.team.fullName : '(sin resolver)'}`);

  // --- Comprobación en mitad de la temporada ya jugada ---
  validateAll(`fin de temporada ${seasonKey}`, calendar.currentGameDateTime);

  const leagueA = leagues['1ª'];
  const leagueB = leagues['2ª'];
  const seasonEndDateTime = calendar.currentGameDateTime;
  const seasonEndIso = LocalDate.fromJsDate(seasonEndDateTime);

  // --- Ascensos/descensos ---
  const standingsA = leagueA.getStandingsTable();
  const relegatedTeams = [standingsA[standingsA.length - 1].team, standingsA[standingsA.length - 2].team];
  relegatedTeams.forEach((team) => { team.division = '2ª'; });
  const promotedTeams = [promotionPlayoff.directPromotion.team, promotionPlayoff.secondPromotedEntry.team];
  promotedTeams.forEach((team) => { team.division = '1ª'; });

  // Un contrato ya firmado NO cambia su normativa por un ascenso/descenso.
  const promotedContract = contractRegistry.forClub(promotedTeams[0].id)[0];
  const frozenModules = [...promotedContract.signingContext.ruleModuleIds];

  allTeams = [...leagueA.teams, ...leagueB.teams];
  teamsByDivision = {
    '1ª': allTeams.filter((t) => t.division === '1ª'),
    '2ª': allTeams.filter((t) => t.division === '2ª'),
  };
  processDevelopmentToDateForTeams(allTeams, seasonEndDateTime);

  const nextSeasonKey = PC.seasonKeyFromStartYear(seasonStartYear + 1);

  // --- Cantera: registrada Y contratada con el contexto YA actualizado ---
  const intakeCalibration = ContractSeeder.buildCompetitionCalibration(allTeams, CONFIG_BASE);
  allTeams.forEach((team) => {
    const newPlayers = team.generateAcademyIntake(3, seasonEndDateTime);
    newPlayers.forEach((player) => {
      PC.ensureCareerHistory(player, CONFIG_BASE, seasonEndDateTime, { historyCompleteness: 'complete', seasonKey: nextSeasonKey });
    });
    playerRegistry.registerMany(newPlayers);
    newPlayers.forEach((player) => {
      const { contract } = ContractSeeder.seedContractForNewPlayer({
        player,
        team,
        seasonKey: nextSeasonKey,
        date: seasonEndIso,
        registry: contractRegistry,
        playerRegistry,
        config: CONFIG_BASE,
        calibration: intakeCalibration,
      });
      totalNewgens += 1;
      if (contract.minorProtections) totalNewgenMinors += 1;
    });
  });

  assert.deepStrictEqual(
    [...promotedContract.signingContext.ruleModuleIds], frozenModules,
    'un ascenso no puede reescribir la normativa congelada de un contrato ya firmado',
  );

  seasonStartYear += 1;
  calendar = new Calendar(seasonStartYear, CONFIG_BASE);
  calendarCtx.seasonStartDate = calendar.seasonStartDate;
  referenceDate = calendar.seasonStartDate;
  seasonKey = nextSeasonKey;
  bootstrapIsoDate = LocalDate.fromJsDate(referenceDate);

  validateAll(`tras cierre + cantera (${seasonKey})`, referenceDate);
  console.log(`Temporada cerrada. Ascendidos: ${promotedTeams.map((t) => t.fullName).join(', ')}. `
    + `Descendidos: ${relegatedTeams.map((t) => t.fullName).join(', ')}.`);
  console.log(`Player Registry: ${playerRegistry.all().length} jugadores · Contract Registry: ${contractRegistry.size} contratos.`);

  // --- Puente temporal: NO hay renovaciones automáticas ---
  const stillCovered = contractRegistry.all().filter((c) => c.coveredSeasonKeys.includes(seasonKey)).length;
  assert.ok(stillCovered > 0, 'el puente temporal debe mantener contratos vivos en la temporada siguiente');
}

// =====================================================================
// Resumen final
// =====================================================================
const finalIso = LocalDate.fromJsDate(referenceDate);
const finalCheck = validateAll('final', referenceDate);
assert.ok(finalCheck.valid);

const statusCounts = contractRegistry.countByStatus(finalIso);
const simulatedCount = contractRegistry.all().filter((c) => c.provenance.dataSource === 'simulated-contract-v1').length;
const byJurisdiction = {};
const byProfile = {};
contractRegistry.all().forEach((contract) => {
  const jurisdiction = contract.signingContext.employerJurisdictionId;
  const profile = contract.signingContext.employmentProfileId;
  byJurisdiction[jurisdiction] = (byJurisdiction[jurisdiction] || 0) + 1;
  byProfile[profile] = (byProfile[profile] || 0) + 1;
});

const payrollByCompetition = {};
allTeams.forEach((team) => {
  const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
  const payroll = ContractService.guaranteedPayrollForClub(contractRegistry, team.id, seasonKey).amountMinor;
  payrollByCompetition[competitionId] = payrollByCompetition[competitionId] || [];
  payrollByCompetition[competitionId].push(payroll);
});

console.log('\n=== RESUMEN CONTRACT-1 ===');
console.log(`Temporadas simuladas:        ${SEASONS_TO_SIMULATE}`);
console.log(`Jugadores mundiales:         ${playerRegistry.all().length}`);
console.log(`Contratos en el registro:    ${contractRegistry.size}`);
console.log(`Contratos por estado:        ${JSON.stringify(statusCounts)}`);
console.log(`Contratos simulados:         ${simulatedCount}/${contractRegistry.size} (100% deben serlo: no hay contratos reales)`);
console.log(`Contratos por jurisdicción:  ${JSON.stringify(byJurisdiction)}`);
console.log(`Contratos por perfil:        ${JSON.stringify(byProfile)}`);
Object.entries(payrollByCompetition).forEach(([competitionId, payrolls]) => {
  const min = Math.min(...payrolls);
  const max = Math.max(...payrolls);
  const avg = Math.round(payrolls.reduce((acc, v) => acc + v, 0) / payrolls.length);
  console.log(`Nómina ${competitionId.padEnd(12)} min ${Money.format(min, 'EUR', { compact: true })} · `
    + `media ${Money.format(avg, 'EUR', { compact: true })} · máx ${Money.format(max, 'EUR', { compact: true })}`);
});
console.log(`Newgens contratados:         ${totalNewgens} (${totalNewgenMinors} menores con marcadores de consentimiento simulados)`);
console.log(`Warnings normativos provisionales (${provisionalWarnings.size}):`);
[...provisionalWarnings].forEach((warning) => console.log(`  - ${warning}`));
console.log(`Avisos de calibración del bootstrap: ${bootstrap.warnings.length}`);
bootstrap.warnings.slice(0, 5).forEach((warning) => console.log(`  - ${warning}`));

assert.strictEqual(simulatedCount, contractRegistry.size, 'ningún contrato puede presentarse como real');
assert.ok(byJurisdiction.AD > 0, 'MoraBanc debe aportar contratos bajo jurisdicción andorrana');

console.log(`\nSMOKE TEST CONTRACT-1: OK (36 equipos, ${SEASONS_TO_SIMULATE} temporadas completas con Copa+Playoffs+Ascenso+cantera, `
  + 'contratos simulados íntegros, sin renovaciones automáticas y sin save/load).');
