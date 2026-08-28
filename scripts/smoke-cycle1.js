#!/usr/bin/env node
// scripts/smoke-cycle1.js
// Prueba de humo CYCLE-1 (DESIGN.md 9.22) contra los 36 equipos reales
// (ACB + Primera FEB) — DIEZ temporadas completas con semilla fija,
// recorriendo Liga, Copa, playoff por el título, playoff de ascenso,
// ascensos/descensos, cierres de historia, cesiones/retornos ya existentes,
// expiraciones orgánicas REALES desde la temporada 1, renovaciones CPU,
// libres y fichajes, tanteo cuando aplica, opciones soportadas, retiros
// anunciados/efectivos, academia (intake/promoción/salidas), rondas de
// clearing, legalidad de los 36 clubes antes de cada primer partido,
// desarrollo/médico mundial y equilibrio de población.
//
// Ejecutar con:
//   node scripts/smoke-cycle1.js [temporadas] [temporadasDeterminismo]
//
// El ciclo anual NO se reimplementa aquí: se consume el harness compartido
// `scripts/cycle1-harness.js` (sección 26 del prompt de CYCLE-1).

const assert = require('assert');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const PC = require('../src/core/PlayerCareer.js');
const Training = require('../src/core/Training.js');
const TrainingAI = require('../src/core/TrainingAI.js');
const Medical = require('../src/core/Medical.js');
const { League } = require('../src/core/League.js');
const { Calendar } = require('../src/core/Calendar.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { ClubEmploymentContextCatalog } = require('../src/core/ClubEmploymentContextCatalog.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { CareerAge } = require('../src/utils/CareerAge.js');
const { CanonicalHash } = require('../src/utils/CanonicalHash.js');
const { CpuRosterPlanner } = require('../src/core/CpuRosterPlanner.js');
const { AcademyService } = require('../src/core/AcademyService.js');
const { computeMatchImportance } = require('../src/core/CpuLineup.js');
const { createCup, CUP_TRIGGER_ROUND } = require('../src/core/Cup.js');
const { createTitlePlayoff } = require('../src/core/Playoffs.js');
const { PromotionPlayoff } = require('../src/core/Promotion.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { padRosterToMinimum } = require('../src/utils/playerGenerator.js');

const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { MarketService } = require('../src/core/MarketService.js');
const { MarketSeeder } = require('../src/core/MarketSeeder.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { TransferService } = require('../src/core/TransferService.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const { LoanService } = require('../src/core/LoanService.js');

const harness = require('./cycle1-harness.js');
const { MatchActSnapshot } = require('../src/entities/Registration.js');

const SEASONS_TO_SIMULATE = Number(process.argv[2] || 10);
const startedAt = Date.now();

// =====================================================================
// Construcción de un MUNDO completo (aislado y reproducible)
// =====================================================================
function buildWorld(options) {
  const opts = options || {};
  const careerSeed = opts.careerSeed || 'smoke-cycle1-career-seed-v1';
  const seasonStartYear = opts.seasonStartYear || 2026;
  const shuffle = opts.shuffle || null;

  let calendar = new Calendar(seasonStartYear, CONFIG_BASE);
  const referenceDate = calendar.seasonStartDate;
  const seasonKey = PC.seasonKeyFromStartYear(seasonStartYear);
  const bootstrapIsoDate = LocalDate.fromJsDate(referenceDate);

  const playerRegistry = new PlayerRegistry();
  const contractRegistry = new ContractRegistry();
  const registrationRegistry = new RegistrationRegistry();
  const agentRegistry = new AgentRegistry();
  const marketRegistry = new MarketRegistry();
  const transferRegistry = new TransferRegistry();
  const loanRegistry = new LoanRegistry();
  const { annualCycleRegistry, academyRegistry } = harness.createCycleRegistries();
  const classificationCache = new Map();

  function buildRealTeam(teamData) {
    const roster = teamData.roster.map((playerData) => {
      const { dataSource, ...playerFields } = playerData;
      const player = new Player(playerFields);
      player.dataSource = dataSource || null;
      // CYCLE-1 (BUG-CYCLE1-03): inicialización EXPLÍCITA de carrera/
      // desarrollo/médico/perfil de ciclo al IMPORTAR al jugador — ningún
      // render la hace después.
      harness.WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, bootstrapIsoDate, {
        seasonKey, historyCompleteness: 'partial', annualCycleRegistry, retirementService: harness.RetirementService, careerSeed,
      });
      return player;
    });
    const resolved = harness.resolveRegistrationRulesForDivision(teamData.division, seasonKey, bootstrapIsoDate);
    // BUG-CYCLE1-02: relleno DETERMINISTA con fecha de carrera obligatoria.
    const fallbackPlayers = padRosterToMinimum(roster, resolved.squadRules.min, {
      minAge: 18,
      maxAge: 34,
      referenceDate: bootstrapIsoDate,
      seed: `${careerSeed}|roster-fill|${teamData.id}`,
      id: `roster-fill:${teamData.id}`,
    });
    fallbackPlayers.forEach((player) => {
      harness.WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, bootstrapIsoDate, {
        seasonKey, historyCompleteness: 'complete', annualCycleRegistry, retirementService: harness.RetirementService, careerSeed,
      });
    });
    return new Team({ ...teamData, roster });
  }

  let teamsByDivision = {};
  ['1ª', '2ª'].forEach((div) => {
    let entries = REAL_DATA_INDEX.filter((e) => e.division === div);
    if (shuffle) entries = shuffle(entries, `teams|${div}`);
    teamsByDivision[div] = entries.map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id]));
  });
  let allTeams = teamsByDivision['1ª'].concat(teamsByDivision['2ª']);
  allTeams.forEach((team) => {
    let roster = team.roster;
    if (shuffle) {
      roster = shuffle(roster, `roster|${team.id}`);
      team.roster = roster;
    }
    playerRegistry.registerMany(roster);
  });

  assert.ok(ClubEmploymentContextCatalog.validateCatalog(allTeams).valid, 'contexto laboral incompleto');

  ContractSeeder.seedContractsForTeams({
    teams: allTeams, seasonKey, date: bootstrapIsoDate, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
  });
  RegistrationSeeder.seedRegistrationsForTeams({
    teams: allTeams, seasonKey, date: bootstrapIsoDate, registrationRegistry, contractRegistry, config: CONFIG_BASE,
  });

  const initialFreeAgents = MarketSeeder.seedFreeAgentPool({
    playerRegistry, careerSeed, referenceDate, config: CONFIG_BASE,
  });
  initialFreeAgents.forEach((player) => {
    harness.WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, bootstrapIsoDate, {
      seasonKey, historyCompleteness: 'complete', annualCycleRegistry, retirementService: harness.RetirementService, careerSeed,
    });
  });
  MarketSeeder.seedAgentsAndMandates({
    playerRegistry, agentRegistry, careerSeed, referenceDate, players: initialFreeAgents,
  });

  const world = {
    careerSeed,
    seasonStartYear,
    seasonKey,
    calendar,
    calendarCtx: { seasonStartDate: calendar.seasonStartDate },
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    agentRegistry,
    marketRegistry,
    transferRegistry,
    loanRegistry,
    annualCycleRegistry,
    academyRegistry,
    classificationCache,
    teamsByDivision,
    allTeams,
    allTeamsById: new Map(allTeams.map((t) => [t.id, t])),
    initialFreeAgentCount: initialFreeAgents.length,
    stats: {
      matchActs: 0,
      expirations: 0,
      renewalsCommitted: 0,
      freeAgentSignings: 0,
      academyIntake: 0,
      academyPromotions: 0,
      academyExits: 0,
      retirementAnnouncements: 0,
      retirementsEffective: 0,
      rightsCases: 0,
      emergencyActions: 0,
      prunedFreeAgents: 0,
      optionDecisions: 0,
      optionsExercised: 0,
      loanReturns: 0,
    },
    perSeason: [],
  };

  // Legalidad ANTES del primer partido de la carrera (invariante 26).
  const bootstrapLegality = harness.ensureAllClubsLegalBeforeFirstMatch({
    teams: allTeams,
    seasonKey,
    date: bootstrapIsoDate,
    config: CONFIG_BASE,
    careerSeed,
    annualCycleRegistry,
    academyRegistry,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    loanRegistry,
    classificationCache,
  });
  world.stats.emergencyActions += bootstrapLegality.emergencyActions.length;
  world.bootstrapLegality = bootstrapLegality;
  return world;
}

// =====================================================================
// Resolución de partidos con pool REGULADO y acta registrada
// =====================================================================
function buildMatchSides(world, params) {
  const {
    sides, date, phaseId, roundId, matchId, evidence, competitionKeyForEvidence,
  } = params;
  return sides.map(({ team, importance }) => {
    const resolved = harness.resolveRegistrationRulesForDivision(team.division, world.seasonKey, date, phaseId);
    const context = {
      competitionId: resolved.competitionId,
      competitionInstanceId: resolved.competitionInstanceId || resolved.competitionId,
      seasonKey: world.seasonKey,
      date,
      phaseId,
      roundId,
      matchId,
    };
    const pool = harness.buildRegulatedPool({
      team,
      context,
      playerRegistry: world.playerRegistry,
      contractRegistry: world.contractRegistry,
      registrationRegistry: world.registrationRegistry,
      loanRegistry: world.loanRegistry,
      teams: world.allTeams,
      classificationCache: world.classificationCache,
    });
    const built = harness.buildCpuSquadForMatch({
      team, context, resolved, matchImportance: importance, pool, config: CONFIG_BASE,
      annualCycleRegistry: world.annualCycleRegistry,
      academyRegistry: world.academyRegistry,
      playerRegistry: world.playerRegistry,
      contractRegistry: world.contractRegistry,
      registrationRegistry: world.registrationRegistry,
      loanRegistry: world.loanRegistry,
      teams: world.allTeams,
      classificationCache: world.classificationCache,
      careerSeed: world.careerSeed,
      seasonKey: world.seasonKey,
    });
    recordAct(world, {
      team, squad: built.squad, context, resolved, pool, effectiveMin: built.effectiveMin,
    });
    if (evidence) {
      evidence.record({
        clubId: team.id,
        date,
        competitionId: resolved.competitionId,
        phaseId: competitionKeyForEvidence || phaseId,
        matchId,
      });
    }
    return built;
  });
}

function recordAct(world, params) {
  const {
    team, squad, context, resolved, pool, effectiveMin,
  } = params;
  const evaluationsById = new Map(pool.map((entry) => [entry.player.id, entry.evaluation]));
  const validation = harness.SquadEligibilityService.validateSquad(
    squad.map((p) => p.id), evaluationsById, resolved, { effectiveMin },
  );
  // BUG-LOAN1-01: un acta INVÁLIDA es un fallo del smoke, nunca una
  // "infeasibilidad tolerada" — la legalidad se garantiza antes del partido.
  assert.ok(
    validation.valid,
    `[${context.matchId}] acta ILEGAL para ${team.fullName}: `
    + `${JSON.stringify(validation.findings.filter((f) => f.severity === 'blocking'))}`,
  );
  const snapshot = new MatchActSnapshot({
    id: `act:${context.matchId}:${team.id}`,
    matchId: context.matchId,
    roundId: context.roundId,
    phaseId: context.phaseId,
    competitionId: context.competitionId,
    competitionInstanceId: context.competitionInstanceId,
    registrationScopeId: resolved.registrationScopeId,
    seasonKey: context.seasonKey,
    teamId: team.id,
    matchDateTime: LocalDate.fromJsDate(context.date),
    selectedPlayers: squad.map((player) => {
      const entry = pool.find((p) => p.player.id === player.id);
      return {
        playerId: player.id,
        accessCategory: entry ? entry.accessCategory : 'senior',
        formation: entry ? entry.evaluation.classification.formation.status : 'unknown',
        nonCommunity: entry ? entry.evaluation.classification.nonCommunitySlot.status : 'unknown',
      };
    }),
    squadValidation: { valid: validation.valid, counts: validation.counts },
    configuredAt: LocalDate.fromJsDate(context.date),
    warnings: validation.findings.map((f) => f.code),
  });
  world.registrationRegistry.registerMatchAct(snapshot);
  world.stats.matchActs += 1;
}

// Punto ÚNICO del reloj del mundo (equivalente a `advanceGameClockTo()`).
function advanceWorldClock(world, date) {
  if (!date) return;
  world.calendar.advanceTo(date);
  const receipt = harness.WorldLifecycleService.processWorldToDate({
    playerRegistry: world.playerRegistry,
    teams: world.allTeams,
    annualCycleRegistry: world.annualCycleRegistry,
    academyRegistry: world.academyRegistry,
  }, date, CONFIG_BASE, world.calendarCtx);
  assert.ok(
    receipt.valid,
    `[lifecycle] exclusividad de procesado rota: ${JSON.stringify(receipt.exclusivityErrors.slice(0, 3))}`,
  );
  world.allTeams.forEach((team) => {
    TrainingAI.reviewTeamIfDue(team, date, { matchesInNext7Days: 1 }, CONFIG_BASE, world.calendarCtx);
  });
  const isoDate = LocalDate.fromJsDate(date);
  world.marketRegistry.eventsDueThrough(isoDate).forEach((event) => {
    if (event.type === 'interest-response') {
      MarketService.processInterestResponseEvent({
        marketRegistry: world.marketRegistry, playerRegistry: world.playerRegistry, event, date: event.dueDate, careerSeed: world.careerSeed,
      });
    } else {
      world.marketRegistry.markEventProcessed(event.id);
    }
  });
  MarketService.expireDueOffers(world.marketRegistry, isoDate);
  // TRANSFER-1/LOAN-1: mismos puntos únicos ya existentes.
  const deps = {
    playerRegistry: world.playerRegistry,
    contractRegistry: world.contractRegistry,
    registrationRegistry: world.registrationRegistry,
    marketRegistry: world.marketRegistry,
    transferRegistry: world.transferRegistry,
    loanRegistry: world.loanRegistry,
    teams: world.allTeams,
    now: isoDate,
    operationalContext: harness.OPERATIONAL_CONTEXT,
  };
  world.transferRegistry.allCases()
    .filter((tCase) => tCase.statusOn(null) === 'scheduled' && tCase.effectiveDate && tCase.effectiveDate <= isoDate)
    .forEach((tCase) => TransferService.retryScheduledTransferCase(tCase, deps, isoDate));
  world.loanRegistry.allAgreements()
    .filter((agreement) => agreement.currentStatus() === 'active' && !LocalDate.isAfter(agreement.returnEffectiveDate, isoDate))
    .forEach((agreement) => {
      const ownerTeam = world.allTeamsById.get(agreement.ownerClubId);
      const borrowerTeam = world.allTeamsById.get(agreement.borrowerClubId);
      if (!ownerTeam || !borrowerTeam) return;
      const { result } = LoanService.returnLoan({
        ...deps, agreement, ownerTeam, borrowerTeam, effectiveDate: agreement.returnEffectiveDate, seasonKey: world.seasonKey, commit: true,
      });
      if (result && result.record) world.stats.loanReturns += 1;
    });
}

// =====================================================================
// Una temporada COMPLETA
// =====================================================================
function simulateSeason(world, seasonIndex) {
  const evidence = new harness.SeasonHistoryService.LastOfficialMatchEvidenceCollector();
  ['1ª', '2ª'].forEach((div) => recalculateSportingGoalsForDivision(world.teamsByDivision[div], CONFIG_BASE));

  const leagueDateResolver = (div) => (round, matchIndexInRound, matchesInRound, totalRounds) => (
    world.calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
  );
  const leagues = {
    '1ª': new League(world.teamsByDivision['1ª'], leagueDateResolver('1ª')),
    '2ª': new League(world.teamsByDivision['2ª'], leagueDateResolver('2ª')),
  };

  function leagueResolver(league) {
    return (match) => {
      Training.prepareTeamForMatch(match.homeTeam, match.date, CONFIG_BASE, world.calendarCtx);
      Training.prepareTeamForMatch(match.awayTeam, match.date, CONFIG_BASE, world.calendarCtx);
      const standingsTable = league.getStandingsTable();
      const matchId = `league:${match.round}:${match.homeTeam.id}:${match.awayTeam.id}`;
      const sides = buildMatchSides(world, {
        sides: [
          { team: match.homeTeam, importance: computeMatchImportance(match.homeTeam, match.awayTeam, 'league', standingsTable, CONFIG_BASE) },
          { team: match.awayTeam, importance: computeMatchImportance(match.awayTeam, match.homeTeam, 'league', standingsTable, CONFIG_BASE) },
        ],
        date: match.date,
        phaseId: 'league',
        roundId: match.round,
        matchId,
        evidence,
      });
      return {
        homeSquad: sides[0].squad, homeLineup: sides[0].lineup, awaySquad: sides[1].squad, awayLineup: sides[1].lineup, matchDate: match.date,
      };
    };
  }

  function currentBracketRoundKey(phaseId, bracketLike) {
    if (bracketLike.quarterFinals) {
      return bracketLike.finalFour
        ? `${phaseId}:finalfour-${bracketLike.finalFour.rounds.length}`
        : `${phaseId}:quarterfinals-${bracketLike.quarterFinals.rounds.length}`;
    }
    return `${phaseId}:round-${bracketLike.rounds.length}`;
  }

  function bracketResolver(bracketDate, phaseId, bracket) {
    return (homeEntry, awayEntry) => {
      Training.prepareTeamForMatch(homeEntry.team, bracketDate, CONFIG_BASE, world.calendarCtx);
      Training.prepareTeamForMatch(awayEntry.team, bracketDate, CONFIG_BASE, world.calendarCtx);
      const roundKey = currentBracketRoundKey(phaseId, bracket);
      const matchId = `${roundKey}:${[homeEntry.team.id, awayEntry.team.id].sort().join('-')}`;
      const sides = buildMatchSides(world, {
        sides: [{ team: homeEntry.team, importance: true }, { team: awayEntry.team, importance: true }],
        date: bracketDate,
        phaseId,
        roundId: roundKey,
        matchId,
        evidence,
      });
      return {
        homeSquad: sides[0].squad, homeLineup: sides[0].lineup, awaySquad: sides[1].squad, awayLineup: sides[1].lineup, matchDate: bracketDate,
      };
    };
  }

  let cup = null;
  for (let r = 0; r < 34; r += 1) {
    ['1ª', '2ª'].forEach((div) => {
      const league = leagues[div];
      if (league.isSeasonComplete) return;
      const matches = league.simulateNextRound(undefined, leagueResolver(league));
      if (matches.length) advanceWorldClock(world, matches[matches.length - 1].date);
      if (div === '1ª' && league.currentRound === CUP_TRIGGER_ROUND + 1 && !cup) {
        cup = createCup(league, world.calendar.cupRoundDates());
      }
    });
  }
  if (cup) {
    const cupDate = world.calendar.currentGameDateTime;
    while (!cup.isComplete) cup.playNextGame(CONFIG_BASE, bracketResolver(cupDate, 'cup', cup));
    advanceWorldClock(world, cupDate);
  }

  const titlePlayoff = createTitlePlayoff(leagues['1ª']);
  const promotionPlayoff = new PromotionPlayoff(leagues['2ª']);
  {
    const date = world.calendar.currentGameDateTime;
    while (!titlePlayoff.isComplete) titlePlayoff.playNextGame(CONFIG_BASE, bracketResolver(date, 'title-playoff', titlePlayoff));
    advanceWorldClock(world, date);
  }
  {
    const date = world.calendar.currentGameDateTime;
    while (!promotionPlayoff.isComplete) promotionPlayoff.playNextGame(CONFIG_BASE, bracketResolver(date, 'promotion', promotionPlayoff));
    advanceWorldClock(world, date);
  }

  void seasonIndex;
  return {
    leagues, cup, titlePlayoff, promotionPlayoff, evidence,
  };
}

// =====================================================================
// Aserciones anuales
// =====================================================================
function validateAll(world, label, date) {
  const isoDate = typeof date === 'string' ? date : LocalDate.fromJsDate(date);
  const playerCheck = world.playerRegistry.validateAgainstTeams(world.allTeams);
  assert.ok(playerCheck.valid, `[${label}] Player Registry roto: ${JSON.stringify(playerCheck.errors.slice(0, 5))}`);
  const contractCheck = world.contractRegistry.validateIntegrity({
    playerRegistry: world.playerRegistry, teams: world.allTeams, date: isoDate, loanRegistry: world.loanRegistry,
  });
  assert.ok(contractCheck.valid, `[${label}] Contract Registry roto: ${JSON.stringify(contractCheck.errors.slice(0, 5))}`);
  const registrationCheck = world.registrationRegistry.validateIntegrity({
    playerRegistry: world.playerRegistry, contractRegistry: world.contractRegistry, teams: world.allTeams, date: isoDate,
  });
  assert.ok(registrationCheck.valid, `[${label}] Registration Registry roto: ${JSON.stringify(registrationCheck.errors.slice(0, 5))}`);
  const marketCheck = world.marketRegistry.validateIntegrity({
    playerRegistry: world.playerRegistry, teams: world.allTeams, date: isoDate,
  });
  assert.ok(marketCheck.valid, `[${label}] Market Registry roto: ${JSON.stringify(marketCheck.errors.slice(0, 5))}`);
  const transferCheck = world.transferRegistry.validateIntegrity({
    playerRegistry: world.playerRegistry,
    teams: world.allTeams,
    contractRegistry: world.contractRegistry,
    registrationRegistry: world.registrationRegistry,
    marketRegistry: world.marketRegistry,
    loanRegistry: world.loanRegistry,
    date: isoDate,
  });
  assert.ok(transferCheck.valid, `[${label}] Transfer Registry roto: ${JSON.stringify(transferCheck.errors.slice(0, 5))}`);
  const loanCheck = world.loanRegistry.validateIntegrity({
    playerRegistry: world.playerRegistry, teams: world.allTeams, contractRegistry: world.contractRegistry, transferRegistry: world.transferRegistry, date: isoDate,
  });
  assert.ok(loanCheck.valid, `[${label}] Loan Registry roto: ${JSON.stringify(loanCheck.errors.slice(0, 5))}`);
  harness.validateCycleRegistries({
    annualCycleRegistry: world.annualCycleRegistry,
    academyRegistry: world.academyRegistry,
    playerRegistry: world.playerRegistry,
    contractRegistry: world.contractRegistry,
    teams: world.allTeams,
    date: isoDate,
    label,
  });

  // Ningún id duplicado y la MISMA instancia canónica en roster/registry.
  const seen = new Set();
  world.playerRegistry.all().forEach((player) => {
    assert.ok(!seen.has(player.id), `[${label}] id duplicado en PlayerRegistry: ${player.id}`);
    seen.add(player.id);
  });
  world.allTeams.forEach((team) => {
    team.roster.forEach((player) => {
      assert.strictEqual(
        world.playerRegistry.get(player.id), player,
        `[${label}] la instancia de "${player.id}" en el roster de ${team.id} no es la canónica`,
      );
    });
  });

  // Academia bajo cap, libres bajo hard max, población activa acotada.
  const cfg = harness.CycleConfig;
  world.allTeams.forEach((team) => {
    const pool = world.academyRegistry.activePoolForClub(team.id, isoDate);
    assert.ok(
      pool.length <= cfg.ACADEMY.poolMaxPerClub,
      `[${label}] la academia de ${team.id} tiene ${pool.length} miembros (cap ${cfg.ACADEMY.poolMaxPerClub})`,
    );
    pool.forEach((membership) => {
      const player = world.playerRegistry.get(membership.playerId);
      assert.strictEqual(player.teamId, null, `[${label}] el canterano ${membership.playerId} tiene teamId no nulo`);
      assert.ok(
        !team.roster.some((p) => p.id === membership.playerId),
        `[${label}] el canterano ${membership.playerId} está en el roster senior sin promoción`,
      );
    });
  });

  const seniorMaxByClub = {};
  world.allTeams.forEach((team) => {
    const resolved = harness.resolveRegistrationRulesForDivision(team.division, world.seasonKey, isoDate);
    // Cota por club: máximo de plantilla ACTIVA declarado por su
    // competición (nunca un 12 global).
    const activeRange = (resolved.registration && resolved.registration.activeRosterRange) || resolved.squadRules;
    seniorMaxByClub[team.id] = activeRange.max + 8; // margen de plantilla total sobre el acta
  });
  const population = harness.WorldLifecycleService.describePopulation({
    playerRegistry: world.playerRegistry,
    teams: world.allTeams,
    annualCycleRegistry: world.annualCycleRegistry,
    academyRegistry: world.academyRegistry,
  }, isoDate, cfg, seniorMaxByClub);
  assert.ok(
    population.withinBound,
    `[${label}] población ACTIVA fuera de cota: ${population.activeTotal} > ${population.activeBound}`,
  );

  // Retirados: localizables y NO en ningún roster.
  world.annualCycleRegistry.allRetirementRecords().forEach((record) => {
    assert.ok(
      world.playerRegistry.has(record.playerId),
      `[${label}] el retirado ${record.playerId} ya no está en PlayerRegistry`,
    );
    assert.ok(
      !world.allTeams.some((team) => team.roster.some((p) => p.id === record.playerId)),
      `[${label}] el retirado ${record.playerId} sigue en un roster`,
    );
  });

  return { population };
}

// =====================================================================
// Ejecución principal
// =====================================================================
function runCareer(options) {
  const world = buildWorld(options);
  const seasons = options.seasons;
  console.log(
    `Mundo construido: ${world.allTeams.length} equipos, ${world.playerRegistry.all().length} jugadores `
    + `(${world.initialFreeAgentCount} libres iniciales), ${world.contractRegistry.size} contratos. `
    + `Emergencias de arranque: ${world.bootstrapLegality.emergencyActions.length}.`,
  );
  validateAll(world, 'arranque', LocalDate.fromJsDate(world.calendar.seasonStartDate));

  for (let seasonIndex = 0; seasonIndex < seasons; seasonIndex += 1) {
    const seasonStartedAt = Date.now();
    const fromSeasonKey = world.seasonKey;
    if (!options.quiet) console.log(`\n=== Temporada ${seasonIndex + 1}/${seasons} (${fromSeasonKey}) ===`);
    const played = simulateSeason(world, seasonIndex);
    const seasonEndDateTime = world.calendar.currentGameDateTime;
    validateAll(world, `fin de temporada ${fromSeasonKey}`, LocalDate.fromJsDate(seasonEndDateTime));

    const targetSeasonKey = PC.seasonKeyFromStartYear(world.seasonStartYear + 1);
    const before = {
      retirementAnnouncements: world.annualCycleRegistry.allRetirementAnnouncements().length,
      retirementRecords: world.annualCycleRegistry.allRetirementRecords().length,
      expiryRecords: world.annualCycleRegistry.allExpiryRecords().length,
      emergencyActions: world.annualCycleRegistry.allEmergencyActions().length,
      pathwayExits: world.annualCycleRegistry.allPathwayExits().length,
      optionDecisions: world.annualCycleRegistry.allOptionDecisions().length,
      academyMemberships: world.academyRegistry.allMemberships().length,
    };

    const transition = harness.runAnnualCycleTransition({
      annualCycleRegistry: world.annualCycleRegistry,
      academyRegistry: world.academyRegistry,
      playerRegistry: world.playerRegistry,
      contractRegistry: world.contractRegistry,
      registrationRegistry: world.registrationRegistry,
      marketRegistry: world.marketRegistry,
      agentRegistry: world.agentRegistry,
      transferRegistry: world.transferRegistry,
      loanRegistry: world.loanRegistry,
      teams: world.allTeams,
      leagueA: played.leagues['1ª'],
      leagueB: played.leagues['2ª'],
      cup: played.cup,
      titlePlayoff: played.titlePlayoff,
      promotionPlayoff: played.promotionPlayoff,
      fromSeasonKey,
      targetSeasonKey,
      evidence: played.evidence,
      seasonEndDateTime,
      config: CONFIG_BASE,
      careerSeed: world.careerSeed,
      classificationCache: world.classificationCache,
    });
    assert.strictEqual(
      transition.finalPhase, 'new-season-started',
      `[${fromSeasonKey}] el ciclo anual no llegó a "new-season-started" (quedó en "${transition.finalPhase}")`,
    );

    // Métricas reales del ciclo de esta temporada.
    const after = {
      retirementAnnouncements: world.annualCycleRegistry.allRetirementAnnouncements().length,
      retirementRecords: world.annualCycleRegistry.allRetirementRecords().length,
      expiryRecords: world.annualCycleRegistry.allExpiryRecords().length,
      emergencyActions: world.annualCycleRegistry.allEmergencyActions().length,
      pathwayExits: world.annualCycleRegistry.allPathwayExits().length,
      optionDecisions: world.annualCycleRegistry.allOptionDecisions().length,
      academyMemberships: world.academyRegistry.allMemberships().length,
    };
    const renewalsCommitted = world.annualCycleRegistry.allRenewalCases()
      .filter((entry) => entry.currentStatus() === 'committed').length;
    const clearingCommitted = world.annualCycleRegistry.allClearingRounds()
      .reduce((sum, round) => sum + round.committedTransactionIds.length, 0);
    const rightsCases = world.marketRegistry.allRightsCases().length;

    world.stats.expirations = after.expiryRecords;
    world.stats.retirementAnnouncements = after.retirementAnnouncements;
    world.stats.retirementsEffective = after.retirementRecords;
    world.stats.emergencyActions = after.emergencyActions;
    world.stats.academyExits = after.pathwayExits;
    world.stats.optionDecisions = after.optionDecisions;
    world.stats.renewalsCommitted = renewalsCommitted;
    world.stats.rightsCases = rightsCases;
    world.stats.academyIntake = after.academyMemberships;

    // Nuevo calendario y nueva temporada — SOLO después de `preseason-ready`.
    world.seasonStartYear += 1;
    world.calendar = new Calendar(world.seasonStartYear, CONFIG_BASE);
    world.calendarCtx.seasonStartDate = world.calendar.seasonStartDate;
    world.seasonKey = targetSeasonKey;
    world.teamsByDivision = {
      '1ª': world.allTeams.filter((team) => team.division === '1ª'),
      '2ª': world.allTeams.filter((team) => team.division === '2ª'),
    };
    world.allTeamsById = new Map(world.allTeams.map((t) => [t.id, t]));

    const seasonReport = validateAll(world, `tras el ciclo anual (${world.seasonKey})`, LocalDate.fromJsDate(world.calendar.seasonStartDate));
    harness.assertAllClubsCanBuildLegalSquad({
      teams: world.allTeams,
      seasonKey: world.seasonKey,
      date: LocalDate.fromJsDate(world.calendar.seasonStartDate),
      config: CONFIG_BASE,
      label: `primer partido de ${world.seasonKey}`,
      playerRegistry: world.playerRegistry,
      contractRegistry: world.contractRegistry,
      registrationRegistry: world.registrationRegistry,
      loanRegistry: world.loanRegistry,
      classificationCache: world.classificationCache,
    });

    // Newgens de cantera: edad EXACTA en su fecha de alta (BUG-CYCLE1-02),
    // también en la temporada 10.
    world.academyRegistry.allMemberships()
      .filter((membership) => membership.cohortSeasonKey === world.seasonKey)
      .forEach((membership) => {
        const player = world.playerRegistry.get(membership.playerId);
        const ageAtJoin = CareerAge.ageOn(player.birthDate, membership.joinedAt);
        assert.ok(
          ageAtJoin >= harness.CycleConfig.ACADEMY.intakeAgeMin && ageAtJoin <= harness.CycleConfig.ACADEMY.intakeAgeMax,
          `[${world.seasonKey}] newgen ${player.id} con edad ${ageAtJoin} en su alta (${membership.joinedAt}) fuera de 16-19`,
        );
      });

    const activeFreeAgents = harness.WorldLifecycleService.classifyWorld({
      playerRegistry: world.playerRegistry,
      teams: world.allTeams,
      annualCycleRegistry: world.annualCycleRegistry,
      academyRegistry: world.academyRegistry,
    }, LocalDate.fromJsDate(world.calendar.seasonStartDate));
    assert.ok(
      activeFreeAgents.counts['free-agent'] <= harness.CycleConfig.POPULATION.freeAgentHardMax,
      `[${world.seasonKey}] libres activos ${activeFreeAgents.counts['free-agent']} > hard max `
      + `${harness.CycleConfig.POPULATION.freeAgentHardMax}`,
    );

    world.perSeason.push({
      seasonKey: fromSeasonKey,
      targetSeasonKey,
      promoted: transition.summary.promoted,
      relegated: transition.summary.relegated,
      players: world.playerRegistry.all().length,
      contracts: world.contractRegistry.size,
      expirationsThisSeason: after.expiryRecords - before.expiryRecords,
      renewalsCommitted,
      clearingCommitted,
      retirementAnnouncementsThisSeason: after.retirementAnnouncements - before.retirementAnnouncements,
      retirementsEffectiveThisSeason: after.retirementRecords - before.retirementRecords,
      emergencyThisSeason: after.emergencyActions - before.emergencyActions,
      pathwayExitsThisSeason: after.pathwayExits - before.pathwayExits,
      optionDecisionsThisSeason: after.optionDecisions - before.optionDecisions,
      academyMemberships: after.academyMemberships,
      activeCounts: activeFreeAgents.counts,
      activeTotal: seasonReport.population.activeTotal,
      activeBound: seasonReport.population.activeBound,
      seconds: Number(((Date.now() - seasonStartedAt) / 1000).toFixed(1)),
    });
    if (!options.quiet) {
      const row = world.perSeason[world.perSeason.length - 1];
      console.log(
        `Ciclo anual completo. Ascendidos: ${row.promoted.join(', ')}. Descendidos: ${row.relegated.join(', ')}.`,
      );
      console.log(
        `  Expiraciones: ${row.expirationsThisSeason} · Renovaciones acumuladas: ${row.renewalsCommitted} · `
        + `Commits de clearing: ${row.clearingCommitted} · Retiradas anunciadas/efectivas: `
        + `${row.retirementAnnouncementsThisSeason}/${row.retirementsEffectiveThisSeason} · Emergencias: ${row.emergencyThisSeason}`,
      );
      console.log(
        `  Jugadores mundiales: ${row.players} · Activos: ${row.activeTotal}/${row.activeBound} · `
        + `Academia: ${row.activeCounts.academy} · Libres: ${row.activeCounts['free-agent']} · `
        + `Retirados: ${row.activeCounts.retired} · Fuera de vía: ${row.activeCounts['left-professional-pathway']} · `
        + `${row.seconds}s`,
      );
    }
  }
  return world;
}

// =====================================================================
// Determinismo (sección 24 del prompt)
// =====================================================================
// QUÉ se compara y POR QUÉ no se comparan dos carreras completas byte a byte:
// `MatchEngine.js` es ESTOCÁSTICO por diseño desde la primera entrega
// (DESIGN.md 3.3: dos simulaciones del mismo partido no deben dar el mismo
// resultado), y de él dependen ascensos, descensos y por tanto la composición
// de las plantillas. Comparar dos carreras enteras mediría el motor de
// partido, no el ciclo — y para "arreglarlo" habría que sembrar
// `Math.random()` globalmente, justo el tipo de truco que esconde un no
// determinismo real en vez de demostrarlo.
//
// Lo que CYCLE-1 garantiza, y lo que se verifica aquí, es que TODA decisión
// del ciclo es función DETERMINISTA de sus entradas explícitas: mismas
// entradas -> mismo resultado, y el ORDEN de los arrays de clubes/jugadores
// no cambia nada. La sonda recorre la superficie de decisión COMPLETA del
// ciclo sobre un mundo real ya construido, sin mutarlo:
//   · calendario de verano (`CycleConfig.buildSummerSchedule`)
//   · longevidad/retirada de CADA jugador (`RetirementService`)
//   · índice de calidad de academia (`AcademyService`)
//   · duración de contrato del seeder (`CycleConfig.resolveInitialContractSeasons`)
//   · snapshot, presupuesto, planes y propuestas de la CPU
//     (`CpuRosterPlanner`), incluida su huella `CanonicalHash`
//   · informe de legalidad de los 36 clubes (`RosterLegalityService`)
// Son las MISMAS funciones que ejecuta el ciclo real; ninguna se reimplementa.
function determinismProbe(world, shuffle) {
  const iso = LocalDate.fromJsDate(world.calendar.seasonStartDate);
  const order = (list) => (shuffle ? shuffle([...list], 'determinism-probe') : [...list]);

  const summerSchedules = ['2027-05-23', '2027-07-01', '2028-06-15'].map((lastMatchDate) => ({
    lastMatchDate,
    schedule: harness.CycleConfig.buildSummerSchedule(lastMatchDate, world.seasonKey),
  }));

  const retirement = order(world.playerRegistry.all()).map((player) => {
    const intent = harness.RetirementService.evaluateRetirementIntent({
      player,
      date: iso,
      seasonKey: world.seasonKey,
      config: CONFIG_BASE,
      careerSeed: world.careerSeed,
      contractRegistry: world.contractRegistry,
      annualCycleRegistry: world.annualCycleRegistry,
      teams: order(world.allTeams),
    });
    return {
      playerId: player.id,
      impliedRetirementAge: intent.profile ? intent.profile.impliedRetirementAge : null,
      shouldRetire: intent.shouldRetire === true,
    };
  }).sort((a, b) => (a.playerId < b.playerId ? -1 : 1));

  const academy = order(world.allTeams).map((team) => {
    const pool = order(world.academyRegistry.activePoolForClub(team.id, iso));
    const qualityIndex = AcademyService.buildPoolQualityIndex(pool, world.playerRegistry, CONFIG_BASE);
    return {
      clubId: team.id,
      pool: pool.map((membership) => ({ id: membership.id, quality: qualityIndex[membership.id] || 0 }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    };
  }).sort((a, b) => (a.clubId < b.clubId ? -1 : 1));

  const contractDurations = order(world.playerRegistry.all()).map((player) => ({
    playerId: player.id,
    seasons: harness.CycleConfig.resolveInitialContractSeasons(`${player.id}|${world.seasonKey}`),
  })).sort((a, b) => (a.playerId < b.playerId ? -1 : 1)).slice(0, 80);

  const snapshot = CpuRosterPlanner.buildSnapshot({
    teams: order(world.allTeams),
    playerRegistry: world.playerRegistry,
    contractRegistry: world.contractRegistry,
    registrationRegistry: world.registrationRegistry,
    loanRegistry: world.loanRegistry,
    academyRegistry: world.academyRegistry,
    annualCycleRegistry: world.annualCycleRegistry,
    date: iso,
    seasonKey: world.seasonKey,
    config: CONFIG_BASE,
  });

  const plans = CpuRosterPlanner.buildAllPlans({
    snapshot,
    teams: order(world.allTeams),
    cycle: { id: 'determinism-probe-cycle' },
    roundIndex: 0,
    marketRegistry: world.marketRegistry,
    careerSeed: world.careerSeed,
  }).map((plan) => ({
    clubId: plan.clubId,
    snapshotFingerprint: plan.snapshotFingerprint,
    positionDepth: plan.positionDepth,
    quotaNeeds: plan.quotaNeeds,
    retain: [...plan.retain].sort(),
    renew: [...plan.renew].sort(),
    release: [...plan.release].sort(),
    loanOut: [...plan.loanOut].sort(),
    listenToOffers: [...plan.listenToOffers].sort(),
    sign: [...plan.sign].sort(),
    promoteFromAcademy: [...plan.promoteFromAcademy].sort(),
    budgetLimitMinor: plan.budgetLimitMinor,
    budgetAvailableMinor: plan.budgetAvailableMinor,
    reasons: [...plan.reasons].sort(),
  })).sort((a, b) => (a.clubId < b.clubId ? -1 : 1));

  const proposals = CpuRosterPlanner.buildProposals({
    plans: CpuRosterPlanner.buildAllPlans({
      snapshot,
      teams: order(world.allTeams),
      cycle: { id: 'determinism-probe-cycle' },
      roundIndex: 0,
      marketRegistry: world.marketRegistry,
      careerSeed: world.careerSeed,
    }),
    snapshot,
    careerSeed: world.careerSeed,
  }).map((proposal) => ({
    id: proposal.id, clubId: proposal.clubId, playerId: proposal.playerId, kind: proposal.kind || proposal.type || null,
  })).sort((a, b) => (a.id < b.id ? -1 : 1));

  const legality = order(world.allTeams).map((team) => {
    const report = harness.RosterLegalityService.buildReport({
      team,
      seasonKey: world.seasonKey,
      date: iso,
      phaseId: 'league',
      cycleId: null,
      config: CONFIG_BASE,
      playerRegistry: world.playerRegistry,
      contractRegistry: world.contractRegistry,
      registrationRegistry: world.registrationRegistry,
      loanRegistry: world.loanRegistry,
      teams: order(world.allTeams),
      classificationCache: new Map(),
    });
    return {
      clubId: team.id,
      counts: report.counts,
      legal: report.isLegal,
      sample: [...report.legalSquadSample].sort(),
      gaps: report.gaps.map((gap) => gap.code).sort(),
    };
  }).sort((a, b) => (a.clubId < b.clubId ? -1 : 1));

  return CanonicalHash.canonicalStringify({
    summerSchedules,
    retirement,
    academy,
    contractDurations,
    snapshotFingerprint: snapshot.fingerprint,
    plans,
    proposals,
    legality,
  });
}

// Baraja DETERMINISTA y conocida: invierte el array y rota — nunca
// `Math.random()`. Sirve para comprobar independencia de ORDEN.
function knownShuffle(list, key) {
  const copy = [...list].reverse();
  const offset = key.length % Math.max(1, copy.length);
  return copy.slice(offset).concat(copy.slice(0, offset));
}

console.log(`CYCLE-1 smoke: ${SEASONS_TO_SIMULATE} temporada(s) principales.`);
const mainWorld = runCareer({ seasons: SEASONS_TO_SIMULATE });

console.log('\n=== Determinismo de las decisiones del ciclo ===');
const probeWorldA = buildWorld({ seasons: 0, careerSeed: 'determinism-seed-A', quiet: true });
const probeWorldB = buildWorld({ seasons: 0, careerSeed: 'determinism-seed-B', quiet: true });
const probeA1 = determinismProbe(probeWorldA, null);
const probeA2 = determinismProbe(probeWorldA, knownShuffle);
const probeA3 = determinismProbe(probeWorldA, null);
const probeB = determinismProbe(probeWorldB, null);

const identical13 = probeA1 === probeA3;
const equivalent12 = probeA1 === probeA2;
const seedBDiffers = probeB !== probeA1;
console.log(`Mismas entradas, repetición de la llamada:                  ${identical13 ? 'IDÉNTICOS' : 'DISTINTOS'}`);
console.log(`Mismas entradas, arrays de clubes/jugadores barajados:      ${equivalent12 ? 'EQUIVALENTES' : 'DISTINTOS'}`);
console.log(`Semilla de carrera distinta -> decisiones distintas:        ${seedBDiffers ? 'sí' : 'no'}`);

// =====================================================================
// Resumen final
// =====================================================================
console.log('\n=== RESUMEN CYCLE-1 ===');
console.log(`Temporadas simuladas:                     ${SEASONS_TO_SIMULATE}`);
console.log(`Jugadores mundiales (histórico):          ${mainWorld.playerRegistry.all().length}`);
console.log(`Contratos (histórico):                    ${mainWorld.contractRegistry.size}`);
console.log(`Actas de partido registradas:             ${mainWorld.stats.matchActs}`);
console.log(`Expiraciones orgánicas de contrato:       ${mainWorld.stats.expirations}`);
console.log(`Renovaciones comprometidas:               ${mainWorld.stats.renewalsCommitted}`);
console.log(`Decisiones de opción registradas:         ${mainWorld.stats.optionDecisions}`);
console.log(`Casos de tanteo abiertos orgánicamente:   ${mainWorld.stats.rightsCases}`);
console.log(`Retiradas anunciadas / efectivas:         ${mainWorld.stats.retirementAnnouncements} / ${mainWorld.stats.retirementsEffective}`);
console.log(`Pertenencias de academia (histórico):     ${mainWorld.stats.academyIntake}`);
console.log(`Salidas de la vía profesional:            ${mainWorld.stats.academyExits}`);
console.log(`Acciones de emergencia de plantilla:      ${mainWorld.stats.emergencyActions}`);
console.log(`Retornos de cesión vía el reloj único:    ${mainWorld.stats.loanReturns}`);
const last = mainWorld.perSeason[mainWorld.perSeason.length - 1];
if (last) {
  console.log(`Población ACTIVA final:                    ${last.activeTotal} (cota ${last.activeBound})`);
  console.log(`  · por categoría:                        ${JSON.stringify(last.activeCounts)}`);
}
console.log('\nMétricas por temporada:');
mainWorld.perSeason.forEach((row) => {
  console.log(
    `  ${row.seasonKey} -> ${row.targetSeasonKey}: jugadores ${row.players}, contratos ${row.contracts}, `
    + `expiraciones ${row.expirationsThisSeason}, retiradas ${row.retirementsEffectiveThisSeason}, `
    + `academia ${row.academyMemberships}, activos ${row.activeTotal}/${row.activeBound}, ${row.seconds}s`,
  );
});
console.log(`\nTiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

assert.ok(identical13, 'DETERMINISMO ROTO: las mismas entradas deben producir EXACTAMENTE las mismas decisiones.');
assert.ok(equivalent12, 'DETERMINISMO ROTO: barajar los arrays de clubes/jugadores no debe cambiar ninguna decisión.');
assert.ok(seedBDiffers, 'la semilla de carrera no influye: el ciclo no puede ser insensible a su semilla.');
assert.ok(mainWorld.stats.expirations > 0, 'ninguna expiración orgánica de contrato en toda la simulación');
assert.ok(mainWorld.stats.matchActs > 0, 'ninguna acta de partido registrada');

console.log(`\nSMOKE TEST CYCLE-1: OK (36 equipos, ${SEASONS_TO_SIMULATE} temporadas con ciclo anual completo)`);
