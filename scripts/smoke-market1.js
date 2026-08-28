#!/usr/bin/env node
// scripts/smoke-market1.js
// Prueba de humo MARKET-1 (DESIGN.md 9.19) contra la Liga real de 36
// equipos — reutiliza el MISMO motor de simulación de temporadas completas
// que smoke-reg1.js (Liga+Copa+Playoffs+Ascenso+cantera, Player/Contract/
// Registration Registry) y añade encima la vertical de mercado: pool de
// libres/agentes por carrera, un flujo completo libre (inquiry -> counter
// -> AIP), un rechazo, una oferta a jugador bajo contrato (condicionada a
// TRANSFER-1), y fixtures dirigidos de derecho de tanteo (igualado, no
// igualado, origen = "usuario"), inscripción preferente y retorno.
//
// Ejecutar con:
//   node scripts/smoke-market1.js [temporadas]

const assert = require('assert');
const Medical = require('../src/core/Medical.js');
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
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { EligibilityService } = require('../src/core/EligibilityService.js');
const { SquadEligibilityService } = require('../src/core/SquadEligibilityService.js');
const Rotation = require('../src/core/Rotation.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { buildPaymentSchedule } = require('../src/entities/Contract.js');
const { buildCpuLineup, computeMatchImportance } = require('../src/core/CpuLineup.js');
const { createCup, CUP_TRIGGER_ROUND } = require('../src/core/Cup.js');
const { createTitlePlayoff } = require('../src/core/Playoffs.js');
const { PromotionPlayoff } = require('../src/core/Promotion.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { padRosterToMinimum, generateFictionalPlayer } = require('../src/utils/playerGenerator.js');

const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { MarketService } = require('../src/core/MarketService.js');
const { NegotiationService } = require('../src/core/NegotiationService.js');
const { MarketSeeder } = require('../src/core/MarketSeeder.js');
const { RightOfFirstRefusalService } = require('../src/core/RightOfFirstRefusalService.js');
const { NegotiationThread } = require('../src/entities/Market.js');

const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');

// CYCLE-1 (DESIGN.md 9.22, sección 26 del prompt) — harness compartido: la
// auditoría de legalidad de plantilla + escalera de emergencia son las MISMAS
// que usa una carrera real, nunca una copia local en este script.
const cycle1 = require('./cycle1-harness.js');

const SEASONS_TO_SIMULATE = Number(process.argv[2] || 3);
const CAREER_SEED = 'smoke-market1-career-seed-v1';
const startedAt = Date.now();

function resolveRegistrationRulesForDivision(division, seasonKey, date, phaseId) {
  const competitionId = CompetitionRules.competitionIdFromLegacyDivision(division);
  return RegistrationService.resolveRegistrationRules({
    competitionId, seasonKey, date, phaseId: phaseId || 'league',
  });
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
  const resolved = resolveRegistrationRulesForDivision(teamData.division, seasonKey, referenceDate);
  const fallbackPlayers = padRosterToMinimum(roster, resolved.squadRules.min, {
    minAge: 18,
    maxAge: 34,
    referenceDate,
    // CYCLE-1 (BUG-CYCLE1-02): relleno DETERMINISTA. Este `padRosterToMinimum`
    // usaba `Math.random()`, así que CADA ejecución del smoke construía un
    // mundo distinto: por eso BUG-LOAN1-01 solo aparecía "de vez en cuando".
    // Con semilla e id explícitos el mundo es reproducible y un fallo se puede
    // volver a provocar.
    seed: `smoke-market1|roster-fill|${teamData.id}`,
    id: `roster-fill:${teamData.id}`,
  });
  fallbackPlayers.forEach((player) => {
    PC.ensureCareerHistory(player, CONFIG_BASE, referenceDate, { historyCompleteness: 'complete', seasonKey });
  });
  return new Team({ ...teamData, roster });
}

function buildEligiblePool(team, context, deps) {
  const { registrationRegistry, playerRegistry, contractRegistry, allTeamsById } = deps;
  const medicalAvailability = new Map();
  const classificationCache = deps.classificationCache;

  function evaluateFor(player, accessCategory, extraDeps) {
    if (CONFIG_BASE.medical.enabled && !medicalAvailability.has(player.id)) {
      medicalAvailability.set(player.id, Medical.getAvailability(player, context.date, CONFIG_BASE, { team }));
    }
    const evaluation = EligibilityService.evaluateEligibility(player.id, team.id, context, {
      playerRegistry, contractRegistry, registrationRegistry,
      medicalAvailability: CONFIG_BASE.medical.enabled ? medicalAvailability : null,
      classificationCache, ...extraDeps,
    });
    return { player, accessCategory, evaluation };
  }

  const pool = team.roster.map((player) => evaluateFor(player, 'senior'));
  registrationRegistry.registrationsForClub(team.id)
    .filter((r) => r.accessCategory === 'own-lower-category' && r.seasonKey === context.seasonKey && r.isEffectiveOn(context.date))
    .forEach((r) => {
      const player = playerRegistry.get(r.playerId);
      if (player) pool.push(evaluateFor(player, 'own-lower-category'));
    });
  registrationRegistry.linkAgreementsAsBeneficiary(team.id).forEach((agreement) => {
    const direction = agreement.upperClubId === team.id ? 'lowerToUpper' : 'upperToLower';
    const originClubId = direction === 'lowerToUpper' ? agreement.lowerClubId : agreement.upperClubId;
    const originTeam = allTeamsById.get(originClubId);
    if (!originTeam) return;
    const lowerClubTeam = direction === 'lowerToUpper' ? originTeam : team;
    const upperClubTeam = direction === 'lowerToUpper' ? team : originTeam;
    agreement.lists[direction].forEach((playerId) => {
      const player = playerRegistry.get(playerId);
      if (!player) return;
      pool.push(evaluateFor(player, 'linked', {
        linkAgreement: agreement, linkDirection: direction,
        lowerClubCompetitionId: CompetitionRules.competitionIdFromLegacyDivision(lowerClubTeam.division),
        upperClubCompetitionId: CompetitionRules.competitionIdFromLegacyDivision(upperClubTeam.division),
      }));
    });
  });
  return pool;
}

const TOLERATED_INFEASIBLE_FINDING_CODES = new Set(['FORMATION_QUOTA_NOT_MET', 'NON_COMMUNITY_CAP_EXCEEDED']);
let totalToleratedInfeasibleActs = 0;

function assertActValid(matchId, team, validation, built, pool) {
  if (validation.valid) {
    const evaluationsById = new Map(pool.map((entry) => [entry.player.id, entry.evaluation]));
    built.squad.forEach((player) => {
      const evaluation = evaluationsById.get(player.id);
      assert.ok(evaluation && evaluation.eligible, `[${matchId}] ${player.fullName} en acta sin ser individualmente elegible`);
    });
    return;
  }
  const blockingCodes = validation.findings.filter((f) => f.severity === 'blocking').map((f) => f.code);
  const isKnownTolerated = built.warnings.length > 0 && blockingCodes.every((code) => TOLERATED_INFEASIBLE_FINDING_CODES.has(code));
  assert.ok(isKnownTolerated, `[${matchId}] acta inválida para ${team.fullName} sin ser una infeasibilidad conocida/avisada`);
  totalToleratedInfeasibleActs += 1;
}

function recordMatchActSnapshot(team, squad, context, resolved, pool, registrationRegistry, configuredAt) {
  const evaluationsById = new Map(pool.map((entry) => [entry.player.id, entry.evaluation]));
  const callableCount = pool.filter((entry) => (
    entry.evaluation.eligible && Medical.getAvailability(entry.player, context.date, CONFIG_BASE, { team }).status !== 'unavailable'
  )).length;
  const effectiveMin = Medical.resolveEffectiveSquadMinimum(resolved.squadRules.min, CONFIG_BASE, callableCount);
  const validation = SquadEligibilityService.validateSquad(squad.map((p) => p.id), evaluationsById, resolved, { effectiveMin });
  const selectedPlayers = squad.map((player) => {
    const entry = pool.find((p) => p.player.id === player.id);
    return {
      playerId: player.id, accessCategory: entry ? entry.accessCategory : 'senior',
      formation: entry ? entry.evaluation.classification.formation.status : 'unknown',
      nonCommunity: entry ? entry.evaluation.classification.nonCommunitySlot.status : 'unknown',
    };
  });
  const { MatchActSnapshot } = require('../src/entities/Registration.js');
  const snapshot = new MatchActSnapshot({
    id: `act:${context.matchId}:${team.id}`, matchId: context.matchId, roundId: context.roundId, phaseId: context.phaseId,
    competitionId: context.competitionId, competitionInstanceId: context.competitionInstanceId, registrationScopeId: resolved.registrationScopeId,
    seasonKey: context.seasonKey, teamId: team.id, matchDateTime: LocalDate.fromJsDate(context.date), selectedPlayers,
    squadValidation: { valid: validation.valid, counts: validation.counts }, configuredAt: LocalDate.fromJsDate(configuredAt),
    warnings: validation.findings.map((f) => f.code),
  });
  registrationRegistry.registerMatchAct(snapshot);
  return { snapshot, validation };
}

// =====================================================================
// 1. Arranque
// =====================================================================
console.log('Construyendo 36 equipos reales (1ª+2ª), Player/Contract/Registration Registry...');
let seasonStartYear = 2026;
let calendar = new Calendar(seasonStartYear, CONFIG_BASE);
const calendarCtx = { seasonStartDate: calendar.seasonStartDate };
let referenceDate = calendar.seasonStartDate;
let seasonKey = PC.seasonKeyFromStartYear(seasonStartYear);

const playerRegistry = new PlayerRegistry();
let teamsByDivision = {};
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div).map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id], referenceDate, seasonKey));
});
let allTeams = teamsByDivision['1ª'].concat(teamsByDivision['2ª']);
allTeams.forEach((team) => playerRegistry.registerMany(team.roster));
let allTeamsById = new Map(allTeams.map((t) => [t.id, t]));

assert.ok(ClubEmploymentContextCatalog.validateCatalog(allTeams).valid, 'contexto laboral incompleto');

const contractRegistry = new ContractRegistry();
let bootstrapIsoDate = LocalDate.fromJsDate(referenceDate);
ContractSeeder.seedContractsForTeams({ teams: allTeams, seasonKey, date: bootstrapIsoDate, registry: contractRegistry, playerRegistry, config: CONFIG_BASE });

const registrationRegistry = new RegistrationRegistry();
RegistrationSeeder.seedRegistrationsForTeams({ teams: allTeams, seasonKey, date: bootstrapIsoDate, registrationRegistry, contractRegistry, config: CONFIG_BASE });

// --- MARKET-1: registros y bootstrap de mercado, por CARRERA -----------
let agentRegistry = new AgentRegistry();
let marketRegistry = new MarketRegistry();
const initialFreeAgents = MarketSeeder.seedFreeAgentPool({ playerRegistry, careerSeed: CAREER_SEED, referenceDate, config: CONFIG_BASE });
const agentBootstrap = MarketSeeder.seedAgentsAndMandates({
  playerRegistry, agentRegistry, careerSeed: CAREER_SEED, referenceDate, players: initialFreeAgents,
});
console.log(`OK: pool de mercado sembrado — ${initialFreeAgents.length} libres ficticios, ${agentBootstrap.agents.length} agentes, `
  + `${agentBootstrap.playersWithAgent}/${agentBootstrap.eligiblePlayers} con representación.`);

// TRANSFER-1/LOAN-1: registros EXPLÍCITOS por carrera (nunca singleton) —
// mismo criterio que agentRegistry/marketRegistry. Este script no ejerce
// fixtures propios de traspasos/cesiones, pero `cycle1.runAnnualCycleTransition`
// los necesita para completar el ciclo anual real (misma vertical de
// mundo que una carrera de verdad).
const transferRegistry = new TransferRegistry();
const loanRegistry = new LoanRegistry();

// CYCLE-1 (DESIGN.md 9.22, sección 26 del prompt): registros nuevos del
// ciclo anual, mismo criterio que smoke-loan1.js — nunca singletons.
const { annualCycleRegistry: cycleRegistryForLegality, academyRegistry: academyRegistryForLegality } = cycle1.createCycleRegistries();
let totalStartupEmergencyActions = 0;

function validateAll(label, date) {
  const isoDate = LocalDate.fromJsDate(date);
  const playerCheck = playerRegistry.validateAgainstTeams(allTeams);
  assert.ok(playerCheck.valid, `[${label}] Player Registry roto: ${JSON.stringify(playerCheck.errors.slice(0, 5))}`);
  const contractCheck = contractRegistry.validateIntegrity({
    playerRegistry, teams: allTeams, date: isoDate, loanRegistry,
  });
  assert.ok(contractCheck.valid, `[${label}] Contract Registry roto: ${JSON.stringify(contractCheck.errors.slice(0, 5))}`);
  const registrationCheck = registrationRegistry.validateIntegrity({ playerRegistry, contractRegistry, teams: allTeams, date: isoDate });
  assert.ok(registrationCheck.valid, `[${label}] Registration Registry roto: ${JSON.stringify(registrationCheck.errors.slice(0, 5))}`);
  const agentCheck = agentRegistry.validateIntegrity({ playerRegistry, teams: allTeams, date: isoDate });
  assert.ok(agentCheck.valid, `[${label}] Agent Registry roto: ${JSON.stringify(agentCheck.errors.slice(0, 5))}`);
  const marketCheck = marketRegistry.validateIntegrity({ playerRegistry, teams: allTeams, date: isoDate });
  assert.ok(marketCheck.valid, `[${label}] Market Registry roto: ${JSON.stringify(marketCheck.errors.slice(0, 5))}`);
  // TRANSFER-1/LOAN-1: registros presentes desde CYCLE-1 (necesarios para
  // completar el ciclo anual real) — se validan igual que el resto, aunque
  // este script no ejerza fixtures propios de traspasos/cesiones.
  const transferCheck = transferRegistry.validateIntegrity({
    playerRegistry, teams: allTeams, contractRegistry, registrationRegistry, marketRegistry, loanRegistry, date: isoDate,
  });
  assert.ok(transferCheck.valid, `[${label}] Transfer Registry roto: ${JSON.stringify(transferCheck.errors.slice(0, 5))}`);
  const loanCheck = loanRegistry.validateIntegrity({
    playerRegistry, teams: allTeams, contractRegistry, transferRegistry, date: isoDate,
  });
  assert.ok(loanCheck.valid, `[${label}] Loan Registry roto: ${JSON.stringify(loanCheck.errors.slice(0, 5))}`);
  return {
    playerCheck, contractCheck, registrationCheck, agentCheck, marketCheck, transferCheck, loanCheck,
  };
}
validateAll('arranque', referenceDate);
console.log('OK: Player/Contract/Registration/Agent/Market/Transfer/Loan Registry íntegros al arranque.');

// =====================================================================
// Fixtures dirigidos de mercado (sección 19.2 del prompt)
// =====================================================================
function buildValidOfferDraft(team, player, isoDate, salaryMinor, seasons) {
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey, date: isoDate, operation: 'validateMarketOffer' });
  const employment = resolved.employment;
  const currency = employment.allowedCurrencies[0];
  const seasonKeys = [];
  let year = LocalDate.seasonStartYear(seasonKey);
  for (let i = 0; i < (seasons || 1); i += 1) seasonKeys.push(LocalDate.seasonKeyFromStartYear(year + i));
  const startDate = LocalDate.seasonWindow(seasonKeys[0]).startDate;
  const endDate = LocalDate.seasonWindow(seasonKeys[seasonKeys.length - 1]).endDate;
  const installmentCount = employment.payments.defaultInstallmentCount;
  const schedule = [];
  seasonKeys.forEach((sk) => {
    const window = LocalDate.seasonWindow(sk);
    buildPaymentSchedule({
      totalMinor: salaryMinor, installmentCount, firstDueDate: LocalDate.endOfMonth(window.startDate), frequency: employment.payments.frequency || 'monthly', currency, seasonKey: sk,
    }).forEach((installment) => schedule.push(installment));
  });
  return {
    playerId: player.id, clubId: team.id, signedDate: startDate, startDate, endDate, coveredSeasonKeys: seasonKeys,
    guaranteeType: 'fully-guaranteed',
    compensation: {
      currency, declaredBasis: 'gross',
      seasons: seasonKeys.map((sk) => ({
        seasonKey: sk, guaranteedBaseSalaryMinor: salaryMinor, guaranteedImageRightsMinor: 0, guaranteedSalaryInKindMinor: 0, signingBonusMinor: 0, variableBonuses: [], nonSalaryBenefits: [], agentCosts: [],
      })),
    },
    paymentPolicy: { installmentCount, frequency: employment.payments.frequency || 'monthly', scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'], schedule },
    clauses: [], declaredDocuments: ['written-contract', ...employment.requiredDocuments],
    provenance: { dataSource: 'simulated-market-offer-v1', isReal: false },
  };
}

let freeAgentFlowChecked = false;
function runFreeAgentInquiryToAgreementFixture() {
  const team = allTeamsById.get('team-real-madrid');
  const player = initialFreeAgents[0];
  const isoDate = bootstrapIsoDate;
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey, date: isoDate, operation: 'openInquiry' });
  const thread = MarketService.openInquiry({
    marketRegistry, agentRegistry, playerId: player.id, actingClubId: team.id, prospectiveCompetitionIds: ['acb'], date: isoDate, marketContext, careerSeed: CAREER_SEED,
  });
  const dueEvent = marketRegistry.eventsDueThrough(LocalDate.addDays(isoDate, 5))[0];
  assert.ok(dueEvent, 'debe haber una respuesta de interés programada');
  MarketService.processInterestResponseEvent({ marketRegistry, playerRegistry, event: dueEvent, date: dueEvent.dueDate, careerSeed: CAREER_SEED });
  if (thread.statusOn(dueEvent.dueDate) !== 'interest-confirmed') {
    console.log(`(fixture libre: "${player.fullName}" declinó el interés inicial — determinista para esta semilla, se documenta sin forzar.)`);
    freeAgentFlowChecked = true;
    return;
  }
  const target = NegotiationService.targetGuaranteedMinor(player);
  const draft = buildValidOfferDraft(team, player, dueEvent.dueDate, Math.round(target * 0.75), 2);
  const validation = MarketService.validateOfferBeforeSend({
    draft, team, player, playerRegistry, contractRegistry, marketRegistry, seasonKey, date: dueEvent.dueDate, marketContext,
  });
  assert.ok(validation.valid, `oferta inicial inválida: ${validation.errors.join(' | ')}`);
  let offer = MarketService.createAndSendOffer({
    marketRegistry, thread, draft, offeredBy: 'club', rolePromise: { role: 'core' }, date: dueEvent.dueDate, careerSeed: CAREER_SEED, marketContext,
    team, player, playerRegistry, contractRegistry, seasonKey,
  });
  let round = 0;
  let outcome = null;
  while (round < 6) {
    const responseDate = LocalDate.addDays(offer.createdAt, 1);
    const result = MarketService.processOfferResponse({
      marketRegistry, playerRegistry, thread, offer, date: responseDate, careerSeed: CAREER_SEED, marketContext,
      team, contractRegistry, seasonKey,
    });
    if (result.outcome !== 'countered') { outcome = result; break; }
    offer = result.counterOffer;
    round += 1;
  }
  if (outcome && outcome.outcome === 'accepted') {
    const agreement = MarketService.createAgreementInPrinciple({
      marketRegistry, thread, offer: outcome.offer, date: LocalDate.addDays(offer.createdAt, 1), employmentSnapshot: { profileId: marketContext.bundleId },
    });
    assert.strictEqual(agreement.statusOn(LocalDate.addDays(offer.createdAt, 1)), 'pendingExecution');
    assert.strictEqual(contractRegistry.currentForPlayer(player.id, LocalDate.addDays(offer.createdAt, 1)), null, 'un AIP nunca registra contrato');
    assert.strictEqual(player.teamId, null, 'un AIP nunca mueve teamId');
    console.log(`OK: fixture libre completo — inquiry -> counter (${round} rondas) -> AIP con "${player.fullName}" (${team.fullName}).`);
  } else {
    console.log(`OK: fixture libre completo — inquiry -> negociación resuelta sin acuerdo (${outcome ? outcome.outcome : 'sin resolver'}) con "${player.fullName}".`);
  }
  freeAgentFlowChecked = true;
}
runFreeAgentInquiryToAgreementFixture();

let rejectionFlowChecked = false;
function runLowballRejectionFixture() {
  const team = allTeamsById.get('team-real-madrid');
  const player = initialFreeAgents[1];
  const isoDate = bootstrapIsoDate;
  const thread = new NegotiationThread({ id: 'smoke-rejection-thread', playerId: player.id, actingClubId: team.id, openedAt: isoDate });
  marketRegistry.registerThread(thread);
  thread.addEvent({ id: 'smoke-rejection:contacted', type: 'player-side-contacted', date: isoDate });
  thread.addEvent({ id: 'smoke-rejection:scheduled', type: 'interest-response-scheduled', date: isoDate });
  thread.addEvent({ id: 'smoke-rejection:confirmed', type: 'interest-confirmed', date: isoDate });
  // BUG-MARKET1-03 (DESIGN.md 9.20): createAndSendOffer valida SIEMPRE
  // internamente contra el mínimo legal/convenio real — un importe por
  // debajo de ese mínimo (100.000 minor/1.000€, el valor original de este
  // fixture) ya no llega a enviarse: es inválido de por sí, no solo
  // "lowball". Se sube al mínimo ACB exacto (28.000€/año) para que la
  // oferta SÍ sea legal-válida pero siga siendo económicamente
  // insultante frente al objetivo simulado del jugador (evaluado por
  // NegotiationService, nunca por el mínimo legal).
  const draft = buildValidOfferDraft(team, player, isoDate, 2800000, 1); // 28.000 € — mínimo legal, insultante para el jugador
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey, date: isoDate });
  const offer = MarketService.createAndSendOffer({
    marketRegistry, thread, draft, offeredBy: 'club', date: isoDate, careerSeed: CAREER_SEED, marketContext,
    team, player, playerRegistry, contractRegistry, seasonKey,
  });
  const result = MarketService.processOfferResponse({
    marketRegistry, playerRegistry, thread, offer, date: LocalDate.addDays(isoDate, 1), careerSeed: CAREER_SEED, marketContext,
    team, contractRegistry, seasonKey,
  });
  assert.strictEqual(result.outcome, 'rejected', 'una oferta insultantemente baja debe rechazarse');
  assert.ok(marketRegistry.getBudgetReservationGroup(`res:${offer.id}`).every((line) => line.status === 'released'));
  rejectionFlowChecked = true;
  console.log(`OK: fixture de rechazo — oferta insuficiente a "${player.fullName}" rechazada, reserva liberada.`);
}
runLowballRejectionFixture();

let contractedPlayerFlowChecked = false;
function runContractedPlayerTransferConditionFixture() {
  const team = allTeamsById.get('team-real-madrid');
  const otherTeam = allTeams.find((t) => t.id !== team.id && contractRegistry.forClub(t.id).length > 0);
  const targetContract = contractRegistry.forClub(otherTeam.id)[0];
  const player = playerRegistry.get(targetContract.playerId);
  const isoDate = bootstrapIsoDate;
  const draft = buildValidOfferDraft(team, player, isoDate, 10000000, 1);
  const validation = ContractService.validateDraft({
    draft, team, player, playerRegistry, contractRegistry, seasonKey, date: isoDate,
  });
  assert.strictEqual(validation.requiresTransferResolution, true, 'una oferta a jugador bajo contrato de OTRO club debe marcar requiresTransferResolution');
  assert.strictEqual(contractRegistry.currentForPlayer(player.id, isoDate).clubId, otherTeam.id, 'el contrato original no se toca');
  contractedPlayerFlowChecked = true;
  console.log(`OK: fixture de jugador bajo contrato — oferta a "${player.fullName}" (bajo contrato con ${otherTeam.fullName}) condicionada a TRANSFER-1, contrato original intacto.`);
}
runContractedPlayerTransferConditionFixture();

let acbTanteoMatchedChecked = false;
let acbTanteoUnmatchedChecked = false;
let acbUserOriginChecked = false;
function runAcbTanteoFixtures() {
  const originTeam = allTeamsById.get('team-real-madrid');
  const player = originTeam.roster[0];
  const lastMatchDate = LocalDate.fromJsDate(referenceDate);
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey, date: lastMatchDate });

  // Caso 1: origen (CPU) IGUALA.
  const rcMatched = RightOfFirstRefusalService.openCase({
    marketRegistry, playerId: player.id, originClubId: originTeam.id, lastOfficialMatchDate: lastMatchDate, marketContext, id: 'smoke-rights-matched',
  });
  RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rcMatched, filedByClubId: originTeam.id, filedAt: rcMatched.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR', lastContract: { coveredSeasonKeys: [seasonKey], breakdownForSeason: () => ({ guaranteedTotalMinor: 4000000 }) }, ageOnJuly1: 26, consecutiveExerciseCount: 0,
  });
  const summary = {
    duration: '2 years', grossAnnualRemunerationPerSeason: 6000000, fixedComponents: 6000000, inKindValuation: 0, imageRights: 0, unilateralTerminationClause: 0, agentFees: 0,
    economicTotalMinor: 12000000, inKindValuationMinor: 0, agentFeesMinor: 0, terminationClauseMinor: 0, durationSeasons: 2, installmentCount: 12, currency: 'EUR', seasonKey,
  };
  const sheetM = RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rcMatched, marketRegistry, filedByClubId: 'team-morabanc-andorra', filedAt: rcMatched.deadlines.thirdPartyOfferWindow.opens, contractDraftSummary: summary, playerSignedMarker: true, clubSignedMarker: true,
  });
  const costPlan = MarketService.computeSquadCostPlan({ team: originTeam, contractRegistry, marketRegistry, seasonKey });
  const decisionM = RightOfFirstRefusalService.decideMatchingDeterministic({
    rightsCase: rcMatched, costPlan, matchProposalSummary: { ...summary, installmentCount: 10 }, fingerprint: `${CAREER_SEED}|matched-forced`,
  });
  RightOfFirstRefusalService.decideMatching({
    rightsCase: rcMatched, decision: 'match', decidedBy: 'cpu', decidedAt: sheetM.matchingWindow.opens, matchProposalSummary: { ...summary, installmentCount: 10 },
  });
  assert.strictEqual(rcMatched.statusOn(sheetM.matchingWindow.opens), 'contract-deposit-pending');
  RightOfFirstRefusalService.resolveProcedure(rcMatched, rcMatched.deadlines.depositDeadline);
  assert.strictEqual(rcMatched.statusOn(rcMatched.deadlines.depositDeadline), 'procedure-resolved');
  assert.strictEqual(contractRegistry.currentForPlayer(player.id, rcMatched.deadlines.depositDeadline).clubId, originTeam.id, 'MARKET-1 nunca ejecuta el traspaso — el contrato original sigue con el origen');
  acbTanteoMatchedChecked = true;

  // Caso 2: origen NO iguala (deuda/insuficiencia económica forzada por fixture).
  const player2 = originTeam.roster[1];
  const rcUnmatched = RightOfFirstRefusalService.openCase({
    marketRegistry, playerId: player2.id, originClubId: originTeam.id, lastOfficialMatchDate: lastMatchDate, marketContext, id: 'smoke-rights-unmatched',
  });
  RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rcUnmatched, filedByClubId: originTeam.id, filedAt: rcUnmatched.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR', lastContract: { coveredSeasonKeys: [seasonKey], breakdownForSeason: () => ({ guaranteedTotalMinor: 4000000 }) }, ageOnJuly1: 26, consecutiveExerciseCount: 0,
  });
  const sheetU = RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rcUnmatched, marketRegistry, filedByClubId: 'team-morabanc-andorra', filedAt: rcUnmatched.deadlines.thirdPartyOfferWindow.opens, contractDraftSummary: summary, playerSignedMarker: true, clubSignedMarker: true,
  });
  RightOfFirstRefusalService.decideMatching({ rightsCase: rcUnmatched, decision: 'waive', decidedBy: 'cpu', decidedAt: sheetU.matchingWindow.opens });
  assert.strictEqual(rcUnmatched.deadlines.depositDeadline, LocalDate.addDays(sheetU.matchingWindow.opens, 10));
  RightOfFirstRefusalService.resolveProcedure(rcUnmatched, rcUnmatched.deadlines.depositDeadline);
  assert.strictEqual(rcUnmatched.statusOn(rcUnmatched.deadlines.depositDeadline), 'procedure-resolved');
  acbTanteoUnmatchedChecked = true;

  // Caso 3: "usuario" (decidedBy: 'user') como club de origen.
  const player3 = originTeam.roster[2];
  const rcUser = RightOfFirstRefusalService.openCase({
    marketRegistry, playerId: player3.id, originClubId: originTeam.id, lastOfficialMatchDate: lastMatchDate, marketContext, id: 'smoke-rights-user-origin',
  });
  RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rcUser, filedByClubId: originTeam.id, filedAt: rcUser.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR', lastContract: { coveredSeasonKeys: [seasonKey], breakdownForSeason: () => ({ guaranteedTotalMinor: 4000000 }) }, ageOnJuly1: 26, consecutiveExerciseCount: 0,
  });
  const sheetUser = RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rcUser, marketRegistry, filedByClubId: 'team-morabanc-andorra', filedAt: rcUser.deadlines.thirdPartyOfferWindow.opens, contractDraftSummary: summary, playerSignedMarker: true, clubSignedMarker: true,
  });
  const attention = MarketService.computeMarketAttentionForClub({ marketRegistry, clubId: originTeam.id, date: sheetUser.matchingWindow.opens });
  assert.ok(attention && attention.type === 'matching-decision-needed', 'el club de origen (simulando al usuario) debe recibir una atención de mercado');
  RightOfFirstRefusalService.decideMatching({
    rightsCase: rcUser, decision: 'match', decidedBy: 'user', decidedAt: sheetUser.matchingWindow.opens, matchProposalSummary: { ...summary, installmentCount: 10 },
  });
  assert.strictEqual(rcUser.matchingDecision.decidedBy, 'user');
  acbUserOriginChecked = true;
  console.log('OK: fixtures dirigidos de tanteo ACB — igualado (CPU), no igualado (CPU), y origen tratado como usuario (decisión propia).');
}
runAcbTanteoFixtures();

let preferredRegistrationChecked = false;
let returnRightsChecked = false;
function runPreferredRegistrationAndReturnFixtures() {
  const originTeam = allTeamsById.get('team-real-madrid');
  const lastMatchDate = LocalDate.fromJsDate(referenceDate);
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey, date: lastMatchDate });
  const rc = RightOfFirstRefusalService.openCase({
    marketRegistry, playerId: 'smoke-preferred-reg-player', originClubId: originTeam.id, lastOfficialMatchDate: lastMatchDate, procedureType: 'preferred-registration', marketContext, id: 'smoke-preferred-registration',
  });
  assert.strictEqual(rc.procedureRules.thirdPartyOfferSheetDaysOverride, 12);
  assert.strictEqual(rc.procedureRules.maxAgeInclusive, 21);
  preferredRegistrationChecked = true;

  const rr = RightOfFirstRefusalService.openReturnRightsCase({
    marketRegistry, playerId: 'smoke-return-player', originClubId: originTeam.id, lastOfficialMatchDate: lastMatchDate, id: 'smoke-return-case',
  });
  RightOfFirstRefusalService.decideReturnRightsOption(rr, 'wait-for-third-party-offer', LocalDate.addDays(lastMatchDate, 1), 10);
  assert.strictEqual(rr.matchingSurchargePercent, 10);
  returnRightsChecked = true;
  console.log('OK: fixtures dirigidos de inscripción preferente (12 días, edad<=21) y retorno (opción 3, recargo 10%).');
}
runPreferredRegistrationAndReturnFixtures();

// =====================================================================
// Simulación de temporadas completas (motor idéntico a smoke-reg1.js)
// =====================================================================
const classificationCache = new Map();
let totalMatchActs = 0;
let totalSquadValidationFailures = 0;

function buildResolver(league) {
  return (match) => {
    Training.prepareTeamForMatch(match.homeTeam, match.date, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(match.awayTeam, match.date, CONFIG_BASE, calendarCtx);
    const standingsTable = league.getStandingsTable();
    const homeImportance = computeMatchImportance(match.homeTeam, match.awayTeam, 'league', standingsTable, CONFIG_BASE);
    const awayImportance = computeMatchImportance(match.awayTeam, match.homeTeam, 'league', standingsTable, CONFIG_BASE);
    const matchId = `league:${match.round}:${match.homeTeam.id}:${match.awayTeam.id}`;
    const sides = [
      { team: match.homeTeam, opponent: match.awayTeam, importance: homeImportance },
      { team: match.awayTeam, opponent: match.homeTeam, importance: awayImportance },
    ].map(({ team, importance }) => {
      const resolved = resolveRegistrationRulesForDivision(team.division, seasonKey, match.date);
      const context = {
        competitionId: resolved.competitionId, competitionInstanceId: resolved.competitionInstanceId, seasonKey, date: match.date, phaseId: 'league', roundId: match.round, matchId,
      };
      const pool = buildEligiblePool(team, context, { registrationRegistry, playerRegistry, contractRegistry, allTeamsById, classificationCache });
      const built = buildCpuLineup(team, importance, CONFIG_BASE, match.date, resolved.squadRules, { pool, resolved });
      const { validation } = recordMatchActSnapshot(team, built.squad, context, resolved, pool, registrationRegistry, match.date);
      totalMatchActs += 1;
      if (!validation.valid) totalSquadValidationFailures += 1;
      assertActValid(matchId, team, validation, built, pool);
      return built;
    });
    return {
      homeSquad: sides[0].squad, homeLineup: sides[0].lineup, awaySquad: sides[1].squad, awayLineup: sides[1].lineup, matchDate: match.date,
    };
  };
}

function currentBracketRoundKey(phaseId, bracketLike) {
  if (bracketLike.quarterFinals) {
    return bracketLike.finalFour ? `${phaseId}:finalfour-${bracketLike.finalFour.rounds.length}` : `${phaseId}:quarterfinals-${bracketLike.quarterFinals.rounds.length}`;
  }
  return `${phaseId}:round-${bracketLike.rounds.length}`;
}

function bracketResolver(bracketDate, phaseId, bracket) {
  return (homeEntry, awayEntry) => {
    Training.prepareTeamForMatch(homeEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(awayEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    const roundKey = currentBracketRoundKey(phaseId, bracket);
    const matchId = `${roundKey}:${[homeEntry.team.id, awayEntry.team.id].sort().join('-')}`;
    const sides = [homeEntry.team, awayEntry.team].map((team) => {
      const resolved = resolveRegistrationRulesForDivision(team.division, seasonKey, bracketDate, phaseId);
      const context = {
        competitionId: resolved.competitionId, competitionInstanceId: resolved.competitionInstanceId, seasonKey, date: bracketDate, phaseId, roundId: roundKey, matchId,
      };
      const pool = buildEligiblePool(team, context, { registrationRegistry, playerRegistry, contractRegistry, allTeamsById, classificationCache });
      const built = buildCpuLineup(team, true, CONFIG_BASE, bracketDate, resolved.squadRules, { pool, resolved });
      const { validation } = recordMatchActSnapshot(team, built.squad, context, resolved, pool, registrationRegistry, bracketDate);
      totalMatchActs += 1;
      if (!validation.valid) totalSquadValidationFailures += 1;
      assertActValid(matchId, team, validation, built, pool);
      return built;
    });
    return {
      homeSquad: sides[0].squad, homeLineup: sides[0].lineup, awaySquad: sides[1].squad, awayLineup: sides[1].lineup, matchDate: bracketDate,
    };
  };
}

function processDevelopmentToDateForTeams(teams, date) { teams.forEach((team) => Training.processTeamDevelopmentToDate(team, date, CONFIG_BASE, calendarCtx)); }
function reviewCpu(teams, date) { teams.forEach((team) => TrainingAI.reviewTeamIfDue(team, date, { matchesInNext7Days: 1 }, CONFIG_BASE, calendarCtx)); }

// CYCLE-1 (DESIGN.md 9.22, sección 26 del prompt): ninguna plantilla arranca
// una temporada sin poder construir un acta legal — misma auditoría +
// escalera de emergencia compartidas que usa una carrera real
// (`cycle1-harness`), nunca una comprobación local relajada. Mismo criterio
// EXACTO que smoke-loan1.js.
function ensureLegalRostersBeforeMatches(label, date) {
  const audit = cycle1.ensureAllClubsLegalBeforeFirstMatch({
    teams: allTeams,
    seasonKey,
    date,
    config: CONFIG_BASE,
    careerSeed: `smoke-market1|${seasonKey}`,
    annualCycleRegistry: cycleRegistryForLegality,
    academyRegistry: academyRegistryForLegality,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    loanRegistry,
    classificationCache,
    userClubId: null,
  });
  totalStartupEmergencyActions += audit.emergencyActions.length;
  const stillIllegal = audit.reports.filter((report) => !report.isLegal)
    .map((report) => `${report.clubId}: ${report.gaps.filter((g) => g.severity === 'blocking').map((g) => g.code).join(',')}`);
  assert.strictEqual(
    stillIllegal.length, 0,
    `[${label}] ${stillIllegal.length} club(es) siguen sin poder construir un acta legal: ${stillIllegal.slice(0, 5).join(' | ')}`,
  );
  return audit;
}

ensureLegalRostersBeforeMatches('antes de la jornada 1', referenceDate);

let ascendedFebNeverInheritsAcbChecked = false;

for (let seasonIndex = 0; seasonIndex < SEASONS_TO_SIMULATE; seasonIndex += 1) {
  console.log(`\n=== Temporada ${seasonIndex + 1}/${SEASONS_TO_SIMULATE} (${seasonKey}) ===`);
  ['1ª', '2ª'].forEach((div) => recalculateSportingGoalsForDivision(teamsByDivision[div], CONFIG_BASE));

  const leagueDateResolver = (div) => (round, matchIndexInRound, matchesInRound, totalRounds) => calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div);
  const leagues = {
    '1ª': new League(teamsByDivision['1ª'], leagueDateResolver('1ª')),
    '2ª': new League(teamsByDivision['2ª'], leagueDateResolver('2ª')),
  };

  let cup = null;
  for (let r = 0; r < 34; r += 1) {
    ['1ª', '2ª'].forEach((div) => {
      const league = leagues[div];
      if (league.isSeasonComplete) return;
      const matches = league.simulateNextRound(undefined, buildResolver(league));
      if (matches.length) {
        const lastDate = matches[matches.length - 1].date;
        calendar.advanceTo(lastDate);
        processDevelopmentToDateForTeams(teamsByDivision[div], lastDate);
        reviewCpu(teamsByDivision[div], lastDate);
        // MARKET-1: procesa eventos de mercado no interactivos vencidos en
        // el mismo punto que development/CPU training — mismo criterio que
        // advanceGameClockTo() en game.js.
        marketRegistry.eventsDueThrough(LocalDate.fromJsDate(lastDate)).forEach((event) => {
          if (event.type === 'interest-response') {
            MarketService.processInterestResponseEvent({ marketRegistry, playerRegistry, event, date: event.dueDate, careerSeed: CAREER_SEED });
          } else {
            marketRegistry.markEventProcessed(event.id);
          }
        });
        MarketService.expireDueOffers(marketRegistry, LocalDate.fromJsDate(lastDate));
      }
      if (div === '1ª' && league.currentRound === CUP_TRIGGER_ROUND + 1 && !cup) cup = createCup(league, calendar.cupRoundDates());
    });
  }
  console.log(`Liga regular completa. Copa creada: ${!!cup}.`);
  if (cup) {
    const cupDate = calendar.currentGameDateTime;
    while (!cup.isComplete) cup.playNextGame(CONFIG_BASE, bracketResolver(cupDate, 'cup', cup));
  }

  const titlePlayoff = createTitlePlayoff(leagues['1ª']);
  const promotionPlayoff = new PromotionPlayoff(leagues['2ª']);
  { const date = calendar.currentGameDateTime; while (!titlePlayoff.isComplete) titlePlayoff.playNextGame(CONFIG_BASE, bracketResolver(date, 'title-playoff', titlePlayoff)); }
  { const date = calendar.currentGameDateTime; while (!promotionPlayoff.isComplete) promotionPlayoff.playNextGame(CONFIG_BASE, bracketResolver(date, 'promotion', promotionPlayoff)); }
  console.log(`Playoffs completados. Campeón: ${titlePlayoff.champion ? titlePlayoff.champion.team.fullName : '(sin resolver)'}`);

  validateAll(`fin de temporada ${seasonKey}`, calendar.currentGameDateTime);

  const leagueA = leagues['1ª'];
  const leagueB = leagues['2ª'];
  const seasonEndDateTime = calendar.currentGameDateTime;
  const prevSeasonKey = seasonKey;
  const nextSeasonKey = PC.seasonKeyFromStartYear(seasonStartYear + 1);

  // CYCLE-1 (DESIGN.md 9.22, sección 26 del prompt): el cierre de temporada
  // YA NO es el monolito directo (ascender/descender -> expirar+resembrar
  // inscripciones -> generateAcademyIntake(3) a los 36 -> reemplazar
  // calendario) — ese comportamiento está RETIRADO (BUG-CYCLE1-05). Este
  // smoke consume el MISMO ciclo anual real que una carrera de verdad, vía
  // el harness compartido — nunca una copia local del motor del ciclo.
  const evidence = cycle1.collectSeasonEvidence({
    leagues: [leagueA, leagueB],
    brackets: [
      { bracket: cup, phaseId: 'cup' },
      { bracket: titlePlayoff, phaseId: 'title-playoff' },
      { bracket: promotionPlayoff, phaseId: 'promotion' },
    ],
  });
  const { cycle, summary } = cycle1.runAnnualCycleTransition({
    annualCycleRegistry: cycleRegistryForLegality,
    academyRegistry: academyRegistryForLegality,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    marketRegistry,
    agentRegistry,
    transferRegistry,
    loanRegistry,
    teams: allTeams,
    leagueA,
    leagueB,
    cup,
    titlePlayoff,
    promotionPlayoff,
    fromSeasonKey: prevSeasonKey,
    targetSeasonKey: nextSeasonKey,
    evidence,
    seasonEndDateTime,
    config: CONFIG_BASE,
    careerSeed: `smoke-market1|${prevSeasonKey}`,
    classificationCache,
  });
  void cycle;
  const promotedTeams = (summary.promotedIds || []).map((id) => allTeamsById.get(id)).filter(Boolean);
  const relegatedTeams = (summary.relegatedIds || []).map((id) => allTeamsById.get(id)).filter(Boolean);

  // --- MARKET-1: ascenso/descenso nunca activa ACB sobre un club FEB que
  // acaba de subir NI reescribe casos ya congelados (sección invariante 21).
  // (Genérico por competición — no depende de qué equipo concreto asciende,
  // por eso se comprueba en cuanto el ciclo devuelve algún ascendido.)
  if (promotedTeams.length) {
    const promotedResolved = MarketService.resolveMarketContext({
      domesticCompetitionId: CompetitionRules.competitionIdFromLegacyDivision('2ª'), seasonKey: prevSeasonKey, date: LocalDate.fromJsDate(seasonEndDateTime),
    });
    assert.strictEqual(promotedResolved.market.domesticProcedure, null, 'un club en Primera FEB (antes de ascender) nunca resuelve tanteo ACB');
  }
  assert.deepStrictEqual(JSON.parse(JSON.stringify(marketRegistry.getRightsCase('smoke-rights-matched').procedureRules)), marketRegistry.getRightsCase('smoke-rights-matched').procedureRules, 'las reglas congeladas de un caso no cambian');
  ascendedFebNeverInheritsAcbChecked = true;

  allTeams = [...leagueA.teams, ...leagueB.teams];
  teamsByDivision = { '1ª': allTeams.filter((t) => t.division === '1ª'), '2ª': allTeams.filter((t) => t.division === '2ª') };
  allTeamsById = new Map(allTeams.map((t) => [t.id, t]));

  // --- MARKET-1: offseason mínima — expira ofertas vivas que no llegaron a
  // resolverse durante la temporada (sección 15.5: "resuelve o conserva
  // como pendiente todo caso antes de sustituir temporada/bundle").
  MarketService.expireDueOffers(marketRegistry, LocalDate.fromJsDate(seasonEndDateTime));

  seasonStartYear += 1;
  calendar = new Calendar(seasonStartYear, CONFIG_BASE);
  calendarCtx.seasonStartDate = calendar.seasonStartDate;
  referenceDate = calendar.seasonStartDate;
  seasonKey = nextSeasonKey;
  bootstrapIsoDate = LocalDate.fromJsDate(referenceDate);

  validateAll(`tras cierre + cantera (${seasonKey})`, referenceDate);
  // Misma garantía tras el cierre: ninguna plantilla arranca la temporada
  // siguiente sin poder construir un acta legal.
  ensureLegalRostersBeforeMatches(`antes de la jornada 1 de ${seasonKey}`, referenceDate);
  console.log(`Temporada cerrada. Ascendidos: ${promotedTeams.map((t) => t.fullName).join(', ')}. Descendidos: ${relegatedTeams.map((t) => t.fullName).join(', ')}.`);
  console.log(`Player Registry: ${playerRegistry.all().length} · Contratos: ${contractRegistry.size} · Licencias: ${registrationRegistry.allLicenses().length} · `
    + `Inscripciones: ${registrationRegistry.allRegistrations().length} · `
    + `Agentes: ${agentRegistry.allAgents().length} · Mandatos: ${agentRegistry.allMandates().length} · `
    + `Hilos: ${marketRegistry.allThreads().length} · Acuerdos: ${marketRegistry.allAgreements().length} · Casos de derechos: ${marketRegistry.allRightsCases().length}.`);
}

// =====================================================================
// Determinismo — misma semilla debe reproducir el MISMO pool de mercado.
// =====================================================================
const detPr = new PlayerRegistry();
const detA = MarketSeeder.seedFreeAgentPool({ playerRegistry: detPr, careerSeed: CAREER_SEED, referenceDate: calendar.seasonStartDate, config: CONFIG_BASE });
const detPr2 = new PlayerRegistry();
const detB = MarketSeeder.seedFreeAgentPool({ playerRegistry: detPr2, careerSeed: CAREER_SEED, referenceDate: calendar.seasonStartDate, config: CONFIG_BASE });
const deterministic = detA.every((p, i) => p.id === detB[i].id && p.fullName === detB[i].fullName);
assert.ok(deterministic, 'la misma semilla debe reproducir el mismo pool de mercado tras varias temporadas de desarrollo');

// =====================================================================
// Resumen final
// =====================================================================
const finalIso = LocalDate.fromJsDate(referenceDate);
const finalChecks = validateAll('final', referenceDate);

let totalMarketEvents = 0;
marketRegistry.allThreads().forEach((t) => { totalMarketEvents += t.events.length; });
marketRegistry.allRightsCases().forEach((c) => { totalMarketEvents += c.events.length; });
let totalOfferVersions = 0;
marketRegistry.allThreads().forEach((t) => { totalOfferVersions += marketRegistry.offersForThread(t.id).length; });

console.log('\n=== RESUMEN MARKET-1 ===');
console.log(`Temporadas simuladas:                ${SEASONS_TO_SIMULATE}`);
console.log(`Jugadores mundiales:                  ${playerRegistry.all().length} (libres ficticios del pool: ${initialFreeAgents.length})`);
console.log(`Contratos:                            ${contractRegistry.size}`);
console.log(`Licencias/Inscripciones:              ${registrationRegistry.allLicenses().length} / ${registrationRegistry.allRegistrations().length}`);
console.log(`Agentes / Mandatos:                    ${agentRegistry.allAgents().length} / ${agentRegistry.allMandates().length}`);
console.log(`Hilos de negociación:                  ${marketRegistry.allThreads().length}`);
console.log(`Ofertas (todas las versiones):         ${totalOfferVersions}`);
console.log(`Acuerdos en principio:                 ${marketRegistry.allAgreements().length}`);
console.log(`Reservas de presupuesto:               ${marketRegistry.allBudgetReservations().length}`);
console.log(`Casos de derecho preferente:            ${marketRegistry.allRightsCases().length}`);
console.log(`Casos de retorno:                       ${marketRegistry.allReturnRightsCases().length}`);
console.log(`Eventos de mercado totales:             ${totalMarketEvents}`);
// CYCLE-1: la cantera ya no entra directamente al primer equipo (sustituye
// al antiguo generateAcademyIntake(3) manual de este script) — se resuelve
// siempre desde academyRegistryForLegality, nunca con un contador propio.
console.log(`Pertenencias de academia (histórico):   ${academyRegistryForLegality.allMemberships().length} (decisiones anuales: ${academyRegistryForLegality.allDecisions().length})`);
console.log(`Altas de emergencia para garantizar legalidad: ${totalStartupEmergencyActions}`);
console.log(`Actas de partido registradas:           ${totalMatchActs} (infeasibilidad médica conocida: ${totalToleratedInfeasibleActs})`);
console.log(`Determinismo (misma semilla):           ${deterministic}`);
console.log(`Fixture libre completo (inquiry->AIP):  ${freeAgentFlowChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Fixture de rechazo:                     ${rejectionFlowChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Fixture bajo contrato (transferCond.):   ${contractedPlayerFlowChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Fixtures tanteo ACB (igualado/no/user):  ${acbTanteoMatchedChecked && acbTanteoUnmatchedChecked && acbUserOriginChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Fixtures preferente/retorno:             ${preferredRegistrationChecked && returnRightsChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Ascenso/descenso no hereda ACB en FEB:    ${ascendedFebNeverInheritsAcbChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Registros conjuntos íntegros:             ${Object.values(finalChecks).every((c) => c.valid)}`);
console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

assert.strictEqual(totalSquadValidationFailures, totalToleratedInfeasibleActs, 'toda acta inválida debe ser una infeasibilidad médica conocida y avisada');
assert.ok(freeAgentFlowChecked && rejectionFlowChecked && contractedPlayerFlowChecked, 'los fixtures de negociación deben ejecutarse');
assert.ok(acbTanteoMatchedChecked && acbTanteoUnmatchedChecked && acbUserOriginChecked, 'los fixtures de tanteo deben ejecutarse');
assert.ok(preferredRegistrationChecked && returnRightsChecked, 'los fixtures de preferente/retorno deben ejecutarse');
assert.ok(deterministic, 'el pool de mercado debe ser reproducible con la misma semilla');
assert.ok(Object.values(finalChecks).every((c) => c.valid), 'todos los registros deben quedar íntegros al final');

console.log(`\nSMOKE TEST MARKET-1: OK (36 equipos, ${SEASONS_TO_SIMULATE} temporadas completas con Liga+Copa+Playoffs+Ascenso+cantera+mercado)`);
