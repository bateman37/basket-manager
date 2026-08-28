#!/usr/bin/env node
// scripts/smoke-loan1.js
// Prueba de humo LOAN-1 (DESIGN.md 9.21) contra la Liga real de 36 equipos
// — reutiliza el MISMO motor de simulación de temporadas completas que
// smoke-transfer1.js (Liga+Copa+Playoffs+Ascenso+cantera, Player/Contract/
// Registration/Agent/Market/Transfer Registry) y añade encima la vertical
// de cesiones: activación, retorno programado vía el punto único del
// reloj, recall pactado/no pactado, terminación anticipada, opción de
// compra sin/con consentimiento, cesión ACB↔Primera FEB y bloqueo
// MoraBanc/internacional.
//
// Ejecutar con:
//   node scripts/smoke-loan1.js [temporadas]

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
const { ContractService } = require('../src/core/ContractService.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { EligibilityService } = require('../src/core/EligibilityService.js');
const { SquadEligibilityService } = require('../src/core/SquadEligibilityService.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { Contract, buildPaymentSchedule } = require('../src/entities/Contract.js');
const { buildCpuLineup, computeMatchImportance } = require('../src/core/CpuLineup.js');
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
const { LoanExecutionService } = require('../src/core/LoanExecutionService.js');
const { LoanCostService } = require('../src/core/LoanCostService.js');

// CYCLE-1 (DESIGN.md 9.22, sección 26 del prompt) — harness compartido: la
// auditoría de legalidad de plantilla + escalera de emergencia son las MISMAS
// que usa una carrera real, nunca una copia local en este script.
const cycle1 = require('./cycle1-harness.js');

const SEASONS_TO_SIMULATE = Number(process.argv[2] || 3);
const CAREER_SEED = 'smoke-loan1-career-seed-v1';
const OPERATIONAL_CONTEXT = { pendingUserMatchBlocks: false };
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
    seed: `smoke-loan1|roster-fill|${teamData.id}`,
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

// CYCLE-1 (BUG-LOAN1-01): un acta solo puede quedar INVÁLIDA cuando el
// partido se juega bajo EXCEPCIÓN MÉDICA de convocatoria (mínimo reducido por
// escasez médica real) y el incumplimiento es de un cupo COLECTIVO que esa
// escasez hace inevitable. Antes bastaba con que `built.warnings` no estuviera
// vacío — y el selector legacy de `CpuLineup` producía warnings al caer fuera
// del pool regulado, así que un acta ILEGAL por imposibilidad reglamentaria
// pasaba por "infeasibilidad médica conocida". Ahora se exige el resultado
// TIPADO `medical-exception`: una imposibilidad reglamentaria (`infeasible`)
// nunca llega hasta aquí, se corta antes de jugar.
const TOLERATED_INFEASIBLE_FINDING_CODES = new Set(['FORMATION_QUOTA_NOT_MET', 'NON_COMMUNITY_CAP_EXCEEDED']);
let totalToleratedInfeasibleActs = 0;

// El motor NUNCA juega un partido con una convocatoria reglamentariamente
// imposible: se detiene con diagnóstico en vez de caer al selector no
// regulado (ese fallback silencioso ERA la causa raíz de BUG-LOAN1-01). Antes
// de rendirse, reintenta la MISMA escalera de emergencia del arranque de
// temporada (`cycle1.selfHealClubLegality`) — una plantilla legal en la
// jornada 1 puede dejar de serlo más tarde (p.ej. la clasificación de
// formación es contextual por fecha) sin que ningún traspaso/cesión nuevo la
// haya tocado.
function buildSquadWithSelfHeal(team, context, resolved, importance, matchId) {
  const buildOnce = () => {
    const pool = buildEligiblePool(team, context, {
      registrationRegistry, playerRegistry, contractRegistry, allTeamsById, classificationCache,
    });
    const built = buildCpuLineup(team, importance, CONFIG_BASE, context.date, resolved.squadRules, { pool, resolved });
    return { pool, built };
  };
  let { pool, built } = buildOnce();
  if (built.outcome === 'infeasible') {
    const healed = cycle1.selfHealClubLegality({
      team,
      context,
      seasonKey,
      config: CONFIG_BASE,
      annualCycleRegistry: cycleRegistryForLegality,
      academyRegistry: academyRegistryForLegality,
      playerRegistry,
      contractRegistry,
      registrationRegistry,
      loanRegistry,
      teams: allTeams,
      classificationCache,
      careerSeed: `smoke-loan1|${seasonKey}`,
    });
    if (healed) totalStartupEmergencyActions += healed.actions.filter((a) => a.succeeded).length;
    if (healed && healed.resolved) {
      ({ pool, built } = buildOnce());
    }
  }
  requireFeasibleCpuSquad(matchId, team, built);
  return { pool, built };
}

function requireFeasibleCpuSquad(matchId, team, built) {
  assert.notStrictEqual(
    built.outcome, 'infeasible',
    `[${matchId}] convocatoria reglamentariamente IMPOSIBLE para ${team.fullName}: `
    + `${JSON.stringify(built.diagnostic)} — el motor no puede jugar con un acta ilegal `
    + 'ni caer al selector legacy (BUG-LOAN1-01), ni siquiera tras reintentar la escalera de emergencia mid-temporada.',
  );
  return built;
}

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
  const isKnownTolerated = built.outcome === 'medical-exception'
    && blockingCodes.every((code) => TOLERATED_INFEASIBLE_FINDING_CODES.has(code));
  assert.ok(
    isKnownTolerated,
    `[${matchId}] acta inválida para ${team.fullName} sin ser una infeasibilidad médica conocida `
    + `(outcome=${built.outcome}, bloqueos=${blockingCodes.join(',')})`,
  );
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
console.log('Construyendo 36 equipos reales (1ª+2ª), Player/Contract/Registration/Agent/Market/Transfer Registry...');
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

let agentRegistry = new AgentRegistry();
let marketRegistry = new MarketRegistry();
const initialFreeAgents = MarketSeeder.seedFreeAgentPool({ playerRegistry, careerSeed: CAREER_SEED, referenceDate, config: CONFIG_BASE });
MarketSeeder.seedAgentsAndMandates({ playerRegistry, agentRegistry, careerSeed: CAREER_SEED, referenceDate, players: initialFreeAgents });
console.log(`OK: pool de mercado sembrado — ${initialFreeAgents.length} libres ficticios.`);

// TRANSFER-1: registro EXPLÍCITO por carrera (nunca singleton) — mismo
// criterio que agentRegistry/marketRegistry.
let transferRegistry = new TransferRegistry();
// LOAN-1 (DESIGN.md 9.21): mismo criterio.
let loanRegistry = new LoanRegistry();

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
// Fixtures dirigidos TRANSFER-1 (sección 23.1 del prompt: "smoke con
// fixtures reales sobre los 36 equipos") — se ejecutan ANTES de la
// simulación de temporadas, sobre el mundo real recién sembrado.
// =====================================================================
// Helpers reutilizados de TRANSFER-1 (mismo motor MarketService real, nunca
// un AIP simulado a mano) — necesarios para el fixture de "opción de
// compra ejercida + consentimiento del jugador -> handoff atómico".
function buildValidOfferDraft(team, player, isoDate, salaryMinor, seasons) {
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey, date: isoDate, operation: 'validateMarketOffer' });
  const employment = resolved.employment;
  const currency = employment.allowedCurrencies[0];
  const seasonKeys = [];
  let year = LocalDate.seasonStartYear(seasonKey);
  for (let i = 0; i < (seasons || 1); i += 1) seasonKeys.push(LocalDate.seasonKeyFromStartYear(year + i));
  const firstSeasonStart = LocalDate.seasonWindow(seasonKeys[0]).startDate;
  const startDate = LocalDate.isAfter(isoDate, firstSeasonStart) ? isoDate : firstSeasonStart;
  const endDate = LocalDate.seasonWindow(seasonKeys[seasonKeys.length - 1]).endDate;
  const installmentCount = employment.payments.defaultInstallmentCount;
  const frequency = employment.payments.frequency || 'monthly';
  const monthStep = frequency === 'quarterly' ? 3 : 1;
  const schedule = [];
  seasonKeys.forEach((sk, index) => {
    const window = LocalDate.seasonWindow(sk);
    const anchorStartDate = index === 0 ? startDate : window.startDate;
    const [anchorYear, anchorMonth] = anchorStartDate.split('-').map(Number);
    const [endYear, endMonth] = window.endDate.split('-').map(Number);
    const periodsAvailable = Math.floor(((endYear - anchorYear) * 12 + (endMonth - anchorMonth)) / monthStep) + 1;
    const seasonInstallmentCount = Math.max(1, Math.min(installmentCount, periodsAvailable));
    buildPaymentSchedule({
      totalMinor: salaryMinor, installmentCount: seasonInstallmentCount, firstDueDate: LocalDate.endOfMonth(anchorStartDate), frequency, currency, seasonKey: sk,
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

function buildLiveAgreementForPlayer(team, player, isoDate, seed) {
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey, date: isoDate });
  const thread = MarketService.openInquiry({
    marketRegistry, agentRegistry, playerId: player.id, actingClubId: team.id, prospectiveCompetitionIds: ['acb'], date: isoDate, marketContext, careerSeed: seed,
  });
  thread.addEvent({ id: `${thread.id}:confirmed`, type: 'interest-confirmed', date: isoDate });
  marketRegistry.markEventProcessed(`${thread.id}:interest-response`);
  const draft = buildValidOfferDraft(team, player, isoDate, 12000000, 4);
  const offer = MarketService.createAndSendOffer({
    marketRegistry, thread, draft, offeredBy: 'club', date: isoDate, careerSeed: seed, marketContext,
    team, player, playerRegistry, contractRegistry, seasonKey,
  });
  offer.addEvent({ id: `${offer.id}:accept`, type: 'player-accepted', date: isoDate });
  return MarketService.createAgreementInPrinciple({ marketRegistry, thread, offer, date: isoDate, employmentSnapshot: { profileId: marketContext.bundleId } });
}

// =====================================================================
// Fixtures dirigidos LOAN-1 (sección 25 del prompt) — se ejecutan ANTES de
// la simulación de temporadas, sobre el mundo real recién sembrado.
// =====================================================================
function negotiateAndAgreeLoan(params) {
  const {
    ownerTeam, borrowerTeam, player, seedSuffix, serviceStartDate, returnEffectiveDate, loanFee, salaryAllocation, clauses, now,
  } = params;
  const masterContract = contractRegistry.currentForPlayer(player.id, now);
  assert.ok(masterContract, `[${seedSuffix}] el jugador no tiene contrato matriz vigente`);
  const { loanCase, resolvedRules } = LoanService.openCaseAndPropose({
    loanRegistry, contractRegistry, ownerTeam, borrowerTeam, playerId: player.id, initiatingClubId: ownerTeam.id, now,
    seasonKey, serviceStartDate, returnEffectiveDate, loanFee, salaryAllocation: salaryAllocation || { ownerShareBasisPoints: 6000, borrowerShareBasisPoints: 4000 },
    clauses: clauses || [], medicalResponsibility: { responsibleParty: 'borrower' }, insuranceResponsibility: { responsibleParty: 'shared' },
    documentsRequired: [], expiresAt: now, id: `loan-case:${seedSuffix}`,
  });
  assert.strictEqual(resolvedRules.blockers.length, 0, `[${seedSuffix}] reglas de cesión bloqueadas: ${JSON.stringify(resolvedRules.blockers)}`);
  ['ownerClub', 'borrowerClub', 'player'].forEach((partyType) => {
    LoanService.grantConsent({
      loanRegistry, loanCase, partyType,
      partyId: partyType === 'ownerClub' ? ownerTeam.id : partyType === 'borrowerClub' ? borrowerTeam.id : player.id,
      now, grantedBy: partyType === 'player' ? player.id : 'gm',
    });
  });
  assert.strictEqual(LoanService.isReadyToAgree(loanRegistry, loanCase, now), true, `[${seedSuffix}] debería estar listo para acordarse tras los 3 consentimientos`);
  const agreement = LoanService.formAgreement({
    loanRegistry, contractRegistry, loanCase, now, resolvedRules,
  });
  return {
    loanCase, agreement, masterContract, resolvedRules,
  };
}

function activateLoanFixture(params) {
  const {
    ownerTeam, borrowerTeam, agreement, effectiveDate, seedSuffix,
  } = params;
  const { plan, result } = LoanService.activateLoan({
    loanRegistry, playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams: allTeams,
    agreement, ownerTeam, borrowerTeam, now: effectiveDate, effectiveDate, seasonKey, operationalContext: OPERATIONAL_CONTEXT, commit: true,
  });
  assert.strictEqual(plan.blockers.length, 0, `[${seedSuffix}] activación bloqueada: ${JSON.stringify(plan.blockers)}`);
  assert.ok(result.record, `[${seedSuffix}] la activación debe producir un TransactionRecord`);
  return { plan, result };
}

let acbLoanChecked = false;
let acbLoanAgreement = null;
let acbLoanPlayer = null;
function runAcbLoanWithFeeFixture() {
  const ownerTeam = allTeamsById.get('team-real-madrid');
  const borrowerTeam = allTeamsById.get('team-barca');
  const player = ownerTeam.roster[0];
  const now = bootstrapIsoDate;
  const serviceStartDate = LocalDate.addDays(now, 5);
  const returnEffectiveDate = LocalDate.addDays(now, 65); // vence DENTRO de la temporada 1 — fixture de retorno programado.
  const { agreement, masterContract } = negotiateAndAgreeLoan({
    ownerTeam, borrowerTeam, player, seedSuffix: 't1-acb-fee', serviceStartDate, returnEffectiveDate, now,
    loanFee: { amountMinor: 2500000, currency: 'EUR' },
  });
  assert.strictEqual(agreement.playerParticipation.amountMinor, Math.round(2500000 * 0.15), 'participación 15% exacta sobre el canon (art. 11.3)');
  activateLoanFixture({
    ownerTeam, borrowerTeam, agreement, effectiveDate: serviceStartDate, seedSuffix: 't1-acb-fee',
  });
  assert.strictEqual(agreement.currentStatus(), 'active');
  assert.strictEqual(ownerTeam.roster.some((p) => p.id === player.id), false, 'el propietario pierde al jugador del roster OPERATIVO');
  assert.strictEqual(borrowerTeam.roster.some((p) => p.id === player.id), true);
  assert.strictEqual(player.teamId, borrowerTeam.id);
  assert.strictEqual(contractRegistry.currentForPlayer(player.id, serviceStartDate).clubId, ownerTeam.id, 'el contrato matriz sigue con el propietario');
  const exposure = LoanCostService.loanExposureForAgreement({ agreement, masterContract, seasonKey });
  assert.ok(exposure.salary.ownerRetainedMinor > 0 && exposure.salary.borrowerAssumedMinor > 0);
  acbLoanChecked = true;
  acbLoanAgreement = agreement;
  acbLoanPlayer = player;
  console.log(`OK: cesión ACB↔ACB con canon — "${player.fullName}" de ${ownerTeam.fullName} a ${borrowerTeam.fullName} (canon 25.000,00€, participación 15% = ${(agreement.playerParticipation.amountMinor / 100).toFixed(2)}€).`);
}
runAcbLoanWithFeeFixture();

let crossCompetitionLoanChecked = false;
function runCrossCompetitionLoanFixture() {
  const ownerTeam = allTeamsById.get('team-alimerka-oviedo'); // Primera FEB (2ª)
  const borrowerTeam = allTeamsById.get('team-casademont-zaragoza'); // ACB (1ª)
  const player = ownerTeam.roster[0];
  const now = bootstrapIsoDate;
  const serviceStartDate = LocalDate.addDays(now, 3);
  const returnEffectiveDate = LocalDate.addDays(now, 200);
  const { agreement, resolvedRules } = negotiateAndAgreeLoan({
    ownerTeam, borrowerTeam, player, seedSuffix: 't1-cross-competition', serviceStartDate, returnEffectiveDate, now, loanFee: null,
  });
  assert.notStrictEqual(resolvedRules.destinationRegistrationRules, null);
  activateLoanFixture({
    ownerTeam, borrowerTeam, agreement, effectiveDate: serviceStartDate, seedSuffix: 't1-cross-competition',
  });
  assert.strictEqual(borrowerTeam.roster.some((p) => p.id === player.id), true);
  assert.strictEqual(agreement.playerParticipation, null, 'sin canon, nunca inventa participación');
  crossCompetitionLoanChecked = true;
  console.log(`OK: cesión Primera FEB→ACB (reglas administrativas distintas) — "${player.fullName}" de ${ownerTeam.fullName} a ${borrowerTeam.fullName}.`);
}
runCrossCompetitionLoanFixture();

let recallValidChecked = false;
function runRecallValidFixture() {
  const ownerTeam = allTeamsById.get('team-kosner-baskonia');
  const borrowerTeam = allTeamsById.get('team-unicaja');
  const player = ownerTeam.roster[1];
  const now = bootstrapIsoDate;
  const serviceStartDate = LocalDate.addDays(now, 2);
  const returnEffectiveDate = LocalDate.addDays(now, 250);
  const recallWindowStart = LocalDate.addDays(now, 40);
  const recallWindowEnd = LocalDate.addDays(now, 55);
  const { agreement } = negotiateAndAgreeLoan({
    ownerTeam, borrowerTeam, player, seedSuffix: 't1-recall-valid', serviceStartDate, returnEffectiveDate, now, loanFee: null,
    clauses: [{ type: 'recall-right', holderClubId: 'owner', windows: [{ startDate: recallWindowStart, endDate: recallWindowEnd }], noticeDays: 0 }],
  });
  activateLoanFixture({
    ownerTeam, borrowerTeam, agreement, effectiveDate: serviceStartDate, seedSuffix: 't1-recall-valid',
  });
  const recallDate = LocalDate.addDays(now, 45);
  const { plan, result } = LoanService.recallLoan({
    loanRegistry, playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams: allTeams,
    agreement, ownerTeam, borrowerTeam, now: recallDate, effectiveDate: recallDate, seasonKey, operationalContext: OPERATIONAL_CONTEXT, commit: true,
    recallClauseId: agreement.clauses[0].id,
  });
  assert.strictEqual(plan.blockers.length, 0, `recall bloqueado: ${JSON.stringify(plan.blockers)}`);
  assert.ok(result.record);
  assert.strictEqual(agreement.currentStatus(), 'returned');
  assert.strictEqual(ownerTeam.roster.some((p) => p.id === player.id), true);
  recallValidChecked = true;
  console.log(`OK: recall pactado y ejercido en ventana — "${player.fullName}" vuelve a ${ownerTeam.fullName} antes de lo programado.`);
}
runRecallValidFixture();

let recallBlockedChecked = false;
function runRecallNotPactadoBlockedFixture() {
  const ownerTeam = allTeamsById.get('team-fiatc-girona');
  const borrowerTeam = allTeamsById.get('team-ilerna-lleida');
  const player = ownerTeam.roster[1];
  const now = bootstrapIsoDate;
  const serviceStartDate = LocalDate.addDays(now, 2);
  const returnEffectiveDate = LocalDate.addDays(now, 220);
  const { agreement } = negotiateAndAgreeLoan({
    ownerTeam, borrowerTeam, player, seedSuffix: 't1-recall-blocked', serviceStartDate, returnEffectiveDate, now, loanFee: null,
  });
  activateLoanFixture({
    ownerTeam, borrowerTeam, agreement, effectiveDate: serviceStartDate, seedSuffix: 't1-recall-blocked',
  });
  const recallDate = LocalDate.addDays(now, 30);
  const { plan } = LoanService.recallLoan({
    loanRegistry, playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams: allTeams,
    agreement, ownerTeam, borrowerTeam, now: recallDate, effectiveDate: recallDate, seasonKey, operationalContext: OPERATIONAL_CONTEXT, commit: true,
    recallClauseId: 'nonexistent-clause',
  });
  assert.ok(plan.blockers.some((b) => b.code === 'RECALL_CLAUSE_NOT_FOUND'), 'sin cláusula pactada, el recall debe bloquear');
  assert.strictEqual(agreement.currentStatus(), 'active', 'sigue activa: el intento bloqueado nunca mueve nada');
  assert.strictEqual(borrowerTeam.roster.some((p) => p.id === player.id), true);
  recallBlockedChecked = true;
  console.log(`OK: recall SIN cláusula pactada bloquea explícito — "${player.fullName}" sigue cedido en ${borrowerTeam.fullName}.`);
}
runRecallNotPactadoBlockedFixture();

let injuryDuringLoanChecked = false;
function runInjuryDuringLoanFixture() {
  const ownerTeam = allTeamsById.get('team-la-laguna-tenerife');
  const borrowerTeam = allTeamsById.get('team-kids-and-us-manresa');
  const player = ownerTeam.roster[1];
  const now = bootstrapIsoDate;
  const serviceStartDate = LocalDate.addDays(now, 4);
  const returnEffectiveDate = LocalDate.addDays(now, 230);
  const { agreement, masterContract } = negotiateAndAgreeLoan({
    ownerTeam, borrowerTeam, player, seedSuffix: 't1-injury', serviceStartDate, returnEffectiveDate, now, loanFee: null,
  });
  activateLoanFixture({
    ownerTeam, borrowerTeam, agreement, effectiveDate: serviceStartDate, seedSuffix: 't1-injury',
  });
  const beforeCareerHistoryLength = player.careerHistory ? player.careerHistory.length : 0;
  const availability = Medical.getAvailability(player, LocalDate.toJsDate(LocalDate.addDays(serviceStartDate, 10)), CONFIG_BASE, { team: borrowerTeam });
  assert.ok(availability, 'Medical.getAvailability debe seguir funcionando con normalidad sobre un jugador cedido');
  // Sección 17.6/19: una lesión no extingue la cesión ni el contrato matriz
  // por sí sola — la cesión sigue activa y el historial de carrera intacto.
  assert.strictEqual(agreement.currentStatus(), 'active');
  assert.strictEqual(contractRegistry.currentForPlayer(player.id, serviceStartDate).id, masterContract.id);
  assert.strictEqual(player.careerHistory ? player.careerHistory.length : 0, beforeCareerHistoryLength, 'la cesión nunca reinicializa careerHistory');
  injuryDuringLoanChecked = true;
  console.log(`OK: Medical/cesión coexisten — "${player.fullName}" sigue cedido y con contrato matriz intacto tras consultar disponibilidad médica.`);
}
runInjuryDuringLoanFixture();

let parentClubRestrictionChecked = false;
function runParentClubRestrictionFixture() {
  const ownerTeam = allTeamsById.get('team-casademont-zaragoza');
  const borrowerTeam = allTeamsById.get('team-alimerka-oviedo');
  const player = ownerTeam.roster[2];
  const now = bootstrapIsoDate;
  const serviceStartDate = LocalDate.addDays(now, 6);
  const returnEffectiveDate = LocalDate.addDays(now, 210);
  const { agreement } = negotiateAndAgreeLoan({
    ownerTeam, borrowerTeam, player, seedSuffix: 't1-parent-club', serviceStartDate, returnEffectiveDate, now, loanFee: null,
    clauses: [{
      type: 'parent-club-match-eligibility', scope: 'competition', prohibited: true, reason: 'Cláusula pactada — no puede jugar contra su exequipo.',
    }],
  });
  activateLoanFixture({
    ownerTeam, borrowerTeam, agreement, effectiveDate: serviceStartDate, seedSuffix: 't1-parent-club',
  });
  const evalVsOwner = EligibilityService.evaluateEligibility(player.id, borrowerTeam.id, {
    competitionId: 'primera-feb', competitionInstanceId: 'primera-feb', seasonKey, date: serviceStartDate, phaseId: 'league', opponentClubId: ownerTeam.id,
  }, {
    playerRegistry, contractRegistry, registrationRegistry, loanRegistry,
  });
  assert.strictEqual(evalVsOwner.eligible, false);
  assert.ok(evalVsOwner.reasons.some((r) => r.code === 'PARENT_CLUB_MATCH_RESTRICTED'));
  const evalVsOther = EligibilityService.evaluateEligibility(player.id, borrowerTeam.id, {
    competitionId: 'primera-feb', competitionInstanceId: 'primera-feb', seasonKey, date: serviceStartDate, phaseId: 'league', opponentClubId: 'team-bueno-arenas-albacete',
  }, {
    playerRegistry, contractRegistry, registrationRegistry, loanRegistry,
  });
  assert.strictEqual(evalVsOther.eligible, true, JSON.stringify(evalVsOther.reasons));
  parentClubRestrictionChecked = true;
  console.log(`OK: cláusula "no jugar contra el propietario" — "${player.fullName}" no elegible vs ${ownerTeam.fullName}, sí vs cualquier otro rival.`);
}
runParentClubRestrictionFixture();

let purchaseOptionNoConsentChecked = false;
let purchaseOptionHandoffChecked = false;
function runPurchaseOptionFixtures() {
  const ownerTeam = allTeamsById.get('team-grupo-alega-cantabria');
  const borrowerTeam = allTeamsById.get('team-caja-rural-cb-zamora');
  const player = ownerTeam.roster[1];
  const now = bootstrapIsoDate;
  const serviceStartDate = LocalDate.addDays(now, 3);
  const returnEffectiveDate = LocalDate.addDays(now, 240);
  const optionWindowStart = LocalDate.addDays(now, 30);
  const optionWindowEnd = LocalDate.addDays(now, 200);
  const { agreement } = negotiateAndAgreeLoan({
    ownerTeam, borrowerTeam, player, seedSuffix: 't1-purchase-option', serviceStartDate, returnEffectiveDate, now, loanFee: null,
    clauses: [{
      type: 'purchase-option', beneficiaryClubId: 'borrower', price: { amountMinor: 8000000, currency: 'EUR' }, windowStart: optionWindowStart, windowEnd: optionWindowEnd,
    }],
  });
  activateLoanFixture({
    ownerTeam, borrowerTeam, agreement, effectiveDate: serviceStartDate, seedSuffix: 't1-purchase-option',
  });
  const exerciseDate = LocalDate.addDays(now, 40);
  const rosterBefore = borrowerTeam.roster.map((p) => p.id);
  const contractBefore = contractRegistry.currentForPlayer(player.id, exerciseDate).id;
  const exercise = LoanService.exercisePurchaseOption({
    loanRegistry, agreement, clauseId: agreement.clauses[0].id, exercisedAt: exerciseDate,
  });
  assert.strictEqual(exercise.statusOn(null), 'notified');
  assert.deepStrictEqual(borrowerTeam.roster.map((p) => p.id), rosterBefore, 'ejercer la opción NUNCA mueve roster por sí solo');
  assert.strictEqual(contractRegistry.currentForPlayer(player.id, exerciseDate).id, contractBefore, 'NUNCA crea el contrato nuevo por sí solo');
  purchaseOptionNoConsentChecked = true;
  console.log(`OK: opción de compra ejercida — "${player.fullName}" sigue cedido, sin mover roster ni contrato (pendiente de consentimiento/AIP real).`);

  // Handoff definitivo (sección 17.2 del prompt): una vez el jugador
  // consiente, TRANSFER-1 ejecuta el traspaso real — el precio pactado en
  // la cláusula es el fee del traspaso. LOAN-1 no auto-abre este AIP (el
  // consentimiento del jugador es un hecho de negociación real, no
  // automático). El comprador es el PROPIO cesionario: la instancia YA
  // está en su roster operativo, así que TRANSFER-1 (que asume que el club
  // de ORIGEN tiene físicamente al jugador) no puede aplicarse
  // directamente sin más — primero se ejecuta el RETORNO real (misma
  // instancia, vuelve al propietario), y ACTO SEGUIDO el traspaso
  // definitivo normal propietario->cesionario. Dos pasos atómicos
  // ENCADENADOS, cada uno con su propio rollback exacto — nunca "quita y
  // vuelve a añadir la instancia" con lógica ad-hoc fuera de los motores.
  const { plan: returnPlan, result: returnResult } = LoanService.returnLoan({
    loanRegistry, playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams: allTeams,
    agreement, ownerTeam, borrowerTeam, now: exerciseDate, effectiveDate: exerciseDate, seasonKey, operationalContext: OPERATIONAL_CONTEXT, commit: true,
  });
  assert.strictEqual(returnPlan.blockers.length, 0, `retorno previo al handoff bloqueado: ${JSON.stringify(returnPlan.blockers)}`);
  assert.ok(returnResult.record);
  assert.strictEqual(ownerTeam.roster.some((p) => p.id === player.id), true, 'el retorno debe devolver la MISMA instancia al propietario antes del traspaso');

  const aipAgreement = buildLiveAgreementForPlayer(borrowerTeam, player, exerciseDate, `${CAREER_SEED}|t1-purchase-handoff`);
  const { plan, result } = TransferService.formalizeNegotiatedTransfer({
    transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams: allTeams,
    agreement: aipAgreement, originTeam: ownerTeam, destinationTeam: borrowerTeam, seasonKey, effectiveDate: exerciseDate, now: exerciseDate, commit: true,
    clubOffer: { id: `smoke-purchase-option-offer:${player.id}`, fee: exercise.price }, playerConsentGrantedAt: exerciseDate,
    operationalContext: OPERATIONAL_CONTEXT,
  });
  assert.strictEqual(plan.blockers.length, 0, `handoff definitivo bloqueado: ${JSON.stringify(plan.blockers)}`);
  assert.ok(result.record);
  // El acuerdo de cesión referencia el TransferCase resultante — el jugador
  // ya no está "cedido", está TRASPASADO (LoanAgreement histórico).
  agreement.convertedTransferCaseId = result.record.transferCaseId;
  assert.strictEqual(agreement.currentStatus(), 'convertedToPermanentTransfer');
  assert.strictEqual(borrowerTeam.roster.some((p) => p.id === player.id), true, 'ahora SÍ es de la plantilla del cesionario, como traspaso definitivo');
  assert.strictEqual(contractRegistry.currentForPlayer(player.id, exerciseDate).clubId, borrowerTeam.id, 'nuevo contrato real con el excesionario');
  purchaseOptionHandoffChecked = true;
  console.log('OK: opción de compra + consentimiento del jugador — retorno + traspaso definitivo TRANSFER-1 completados (LoanAgreement -> convertedToPermanentTransfer).');
}
runPurchaseOptionFixtures();

let moraBancBlockedChecked = false;
function runMoraBancInternationalBlockedFixture() {
  const ownerTeam = allTeamsById.get('team-morabanc-andorra');
  const borrowerTeam = allTeamsById.get('team-la-laguna-tenerife');
  if (!ownerTeam) { console.log('AVISO: team-morabanc-andorra no está en el bundle real cargado — fixture MoraBanc omitido.'); return; }
  const player = ownerTeam.roster[0];
  const now = bootstrapIsoDate;
  const rules = LoanService.resolveLoanRules({
    playerId: player.id, ownerTeam, borrowerTeam, seasonKey, effectiveDate: LocalDate.addDays(now, 5), returnEffectiveDate: LocalDate.addDays(now, 200), operation: 'activation',
  });
  assert.ok(rules.blockers.some((b) => b.code === 'AD_NO_LOAN_REGIME_SOURCED'), 'MoraBanc/Andorra debe bloquear el régimen de cesión, nunca heredar ACB/España por defecto');
  assert.strictEqual(ownerTeam.roster.some((p) => p.id === player.id), true, 'nada se mueve: el bloqueo ocurre en la resolución de reglas, antes de cualquier ejecución');
  moraBancBlockedChecked = true;
  console.log(`OK: MoraBanc Andorra bloquea el régimen de cesión explícito (test transfronterizo obligatorio) — "${player.fullName}" no se mueve.`);
}
runMoraBancInternationalBlockedFixture();

let rollbackChecked = false;
function runRollbackOnFailureFixture() {
  const ownerTeam = allTeamsById.get('team-bueno-arenas-albacete');
  const borrowerTeam = allTeamsById.get('team-grupo-ureta-tizona-burgos');
  const player = ownerTeam.roster[1];
  const now = bootstrapIsoDate;
  const serviceStartDate = LocalDate.addDays(now, 4);
  const returnEffectiveDate = LocalDate.addDays(now, 200);
  const { agreement } = negotiateAndAgreeLoan({
    ownerTeam, borrowerTeam, player, seedSuffix: 't1-rollback', serviceStartDate, returnEffectiveDate, now, loanFee: { amountMinor: 1000000, currency: 'EUR' },
  });
  const original = RegistrationService.issueLicense;
  RegistrationService.issueLicense = () => { throw new Error('INJECTED smoke rollback'); };
  let threw = false;
  try {
    LoanService.activateLoan({
      loanRegistry, playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams: allTeams,
      agreement, ownerTeam, borrowerTeam, now: serviceStartDate, effectiveDate: serviceStartDate, seasonKey, operationalContext: OPERATIONAL_CONTEXT, commit: true,
    });
  } catch (err) { threw = true; } finally { RegistrationService.issueLicense = original; }
  assert.ok(threw);
  assert.strictEqual(ownerTeam.roster.some((p) => p.id === player.id), true, 'rollback: sigue en el propietario');
  assert.strictEqual(borrowerTeam.roster.some((p) => p.id === player.id), false);
  assert.strictEqual(agreement.currentStatus(), 'agreed', 'nunca queda "a medias" activa');
  rollbackChecked = true;
  console.log('OK: fallo inyectado durante la activación revierte roster/inscripción/afiliación EXACTAMENTE (sobre los 36 equipos reales).');
}
runRollbackOnFailureFixture();

let determinismChecked = false;
function runDeterminismFixture() {
  const ownerTeam = allTeamsById.get('team-asisa-joventut');
  const borrowerTeam = allTeamsById.get('team-fiatc-girona');
  const player = ownerTeam.roster[3];
  const now = bootstrapIsoDate;
  const proposalLike = { id: 'determinism-check', loanFee: { amountMinor: 2000000, currency: 'EUR' } };
  const evalA = LoanService.evaluateOwnerClub({
    ownerTeam, player, masterContract: contractRegistry.currentForPlayer(player.id, now), proposal: proposalLike, careerSeed: CAREER_SEED, date: now, seasonKey,
  });
  const evalB = LoanService.evaluateOwnerClub({
    ownerTeam, player, masterContract: contractRegistry.currentForPlayer(player.id, now), proposal: proposalLike, careerSeed: CAREER_SEED, date: now, seasonKey,
  });
  assert.deepStrictEqual(evalA, evalB, 'misma semilla/snapshot/propuesta debe producir la MISMA decisión — nunca aleatoriedad no seedeada');
  determinismChecked = true;
  console.log('OK: misma semilla/propuesta -> misma decisión CPU determinista (dos ejecuciones idénticas).');
}
runDeterminismFixture();

// A diferencia de TRANSFER-1 (efecto inmediato), varios fixtures de LOAN-1
// activan la cesión con serviceStartDate posterior a bootstrapIsoDate (el
// movimiento de roster ocurre YA, en el momento de la activación — nunca
// esperando al reloj de partida) — la integridad debe comprobarse en una
// fecha dentro de TODAS las ventanas [serviceStartDate, returnEffectiveDate)
// todavía activas al llegar aquí Y en/después del exerciseDate del handoff
// de opción de compra (+40d, contrato definitivo nuevo desde esa fecha) —
// mínimo returnEffectiveDate usado por una cesión aún activa = +65d — nunca
// en el referenceDate original (anterior a cualquier serviceStartDate).
validateAll('tras fixtures de arranque LOAN-1', LocalDate.toJsDate(LocalDate.addDays(bootstrapIsoDate, 50)));
console.log('OK: Registros íntegros tras los fixtures dirigidos de LOAN-1.');

// =====================================================================
// Simulación de temporadas completas (motor idéntico a smoke-market1.js)
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
      const { pool, built } = buildSquadWithSelfHeal(team, context, resolved, importance, matchId);
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
      const { pool, built } = buildSquadWithSelfHeal(team, context, resolved, true, matchId);
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

// TRANSFER-1 (DESIGN.md 9.20, sección 11.2 del prompt): "advanceGameClockTo()
// procesa esa fecha mediante el punto único del reloj" — reintenta
// cualquier expediente `scheduled` cuya fecha efectiva ya se ha alcanzado.
// Mismo criterio EXACTO que processDueScheduledTransfersToDate() en
// game.js, contra el mundo real de 36 equipos.
function processDueScheduledTransfers(date) {
  const isoDate = LocalDate.fromJsDate(date);
  const deps = {
    playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams: allTeams, now: isoDate,
  };
  transferRegistry.allCases()
    .filter((tCase) => tCase.statusOn(null) === 'scheduled' && tCase.effectiveDate && tCase.effectiveDate <= isoDate)
    .forEach((tCase) => TransferService.retryScheduledTransferCase(tCase, deps, isoDate));
}

// LOAN-1 (DESIGN.md 9.21, sección 18 del prompt): mismo punto único del
// reloj — un retorno de cesión efectivo antes del próximo partido se
// procesa aquí, mismo criterio EXACTO que processDueLoanReturnsToDate() en
// game.js.
let loanReturnsProcessed = 0;
function processDueLoanReturns(date) {
  const isoDate = LocalDate.fromJsDate(date);
  const deps = {
    playerRegistry, contractRegistry, registrationRegistry, transferRegistry, loanRegistry, teams: allTeams, now: isoDate, operationalContext: OPERATIONAL_CONTEXT,
  };
  loanRegistry.allAgreements()
    .filter((agreement) => agreement.currentStatus() === 'active' && !LocalDate.isAfter(agreement.returnEffectiveDate, isoDate))
    .forEach((agreement) => {
      const ownerTeam = allTeamsById.get(agreement.ownerClubId);
      const borrowerTeam = allTeamsById.get(agreement.borrowerClubId);
      if (!ownerTeam || !borrowerTeam) return;
      const { result } = LoanService.returnLoan({
        ...deps, agreement, ownerTeam, borrowerTeam, effectiveDate: agreement.returnEffectiveDate, seasonKey, commit: true,
      });
      if (result && result.record) loanReturnsProcessed += 1;
    });
}

// CYCLE-1 (DESIGN.md 9.22): la cantera ya no entra directamente al primer
// equipo (BUG-CYCLE1-05, retirado) — se resuelve siempre desde
// `academyRegistryForLegality`, nunca con un contador propio.

// CYCLE-1 (BUG-LOAN1-01): los fixtures dirigidos de arriba sacan jugadores de
// clubes que YA estaban en su suelo reglamentario (una cesión de un jugador de
// formación deja al propietario por debajo del cupo). Antes de CYCLE-1 el
// motor no se enteraba: `CpuLineup` caía en silencio al selector NO regulado y
// el partido se jugaba con un acta ilegal. Ahora se detiene, así que la
// legalidad de los 36 clubes se GARANTIZA con la auditoría + escalera de
// emergencia compartidas (`cycle1-harness`), exactamente igual que en una
// carrera real — nunca relajando la comprobación del acta.
const { annualCycleRegistry: cycleRegistryForLegality, academyRegistry: academyRegistryForLegality } = cycle1.createCycleRegistries();
let totalStartupEmergencyActions = 0;

function ensureLegalRostersBeforeMatches(label, date) {
  const audit = cycle1.ensureAllClubsLegalBeforeFirstMatch({
    teams: allTeams,
    seasonKey,
    date,
    config: CONFIG_BASE,
    careerSeed: `smoke-loan1|${seasonKey}`,
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
        marketRegistry.eventsDueThrough(LocalDate.fromJsDate(lastDate)).forEach((event) => {
          if (event.type === 'interest-response') {
            MarketService.processInterestResponseEvent({ marketRegistry, playerRegistry, event, date: event.dueDate, careerSeed: CAREER_SEED });
          } else {
            marketRegistry.markEventProcessed(event.id);
          }
        });
        MarketService.expireDueOffers(marketRegistry, LocalDate.fromJsDate(lastDate));
        // Punto único del reloj para TRANSFER-1 — mismo criterio que
        // advanceGameClockTo() en game.js.
        processDueScheduledTransfers(lastDate);
        processDueLoanReturns(lastDate);
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

  if (seasonIndex === 0) {
    // El retorno programado de la cesión ACB↔ACB (fixture 1, returnEffectiveDate
    // = arranque + 65 días) debe haberse completado durante la liga regular
    // de la primera temporada — vía el punto único del reloj, nunca un
    // control manual repartido por la simulación.
    assert.ok(acbLoanChecked && acbLoanAgreement, 'fixture de cesión ACB con canon no se preparó');
    assert.strictEqual(acbLoanAgreement.currentStatus(), 'returned', 'el retorno programado debe haberse ejecutado al alcanzar su fecha efectiva vía el reloj único');
    const ownerTeam = allTeamsById.get('team-real-madrid');
    assert.strictEqual(ownerTeam.roster.find((p) => p.id === acbLoanPlayer.id), acbLoanPlayer, 'el jugador cedido debe volver al roster del propietario tras su fecha de retorno');
    console.log(`OK: el retorno programado de la cesión se completó automáticamente al llegar su fecha efectiva (punto único del reloj, ${loanReturnsProcessed} retorno(s) procesados hasta ahora).`);
  }

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
    careerSeed: `smoke-loan1|${prevSeasonKey}`,
    classificationCache,
  });
  void cycle;
  const promotedTeams = (summary.promotedIds || []).map((id) => allTeamsById.get(id)).filter(Boolean);
  const relegatedTeams = (summary.relegatedIds || []).map((id) => allTeamsById.get(id)).filter(Boolean);

  allTeams = [...leagueA.teams, ...leagueB.teams];
  teamsByDivision = { '1ª': allTeams.filter((t) => t.division === '1ª'), '2ª': allTeams.filter((t) => t.division === '2ª') };
  allTeamsById = new Map(allTeams.map((t) => [t.id, t]));

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
  console.log(`Player Registry: ${playerRegistry.all().length} · Contratos: ${contractRegistry.size} · `
    + `Expedientes de traspaso: ${transferRegistry.allCases().length} · Transacciones: ${transferRegistry.allTransactionRecords().length} · `
    + `Obligaciones: ${transferRegistry.allObligations().length}.`);
}

// =====================================================================
// Resumen final
// =====================================================================
const finalIso = LocalDate.fromJsDate(referenceDate);
const finalChecks = validateAll('final', referenceDate);

const completedLoanAgreements = loanRegistry.allAgreements();
const loanStatusCounts = {};
completedLoanAgreements.forEach((a) => { loanStatusCounts[a.currentStatus()] = (loanStatusCounts[a.currentStatus()] || 0) + 1; });

console.log('\n=== RESUMEN LOAN-1 ===');
console.log(`Temporadas simuladas:                    ${SEASONS_TO_SIMULATE}`);
console.log(`Jugadores mundiales:                     ${playerRegistry.all().length}`);
console.log(`Contratos:                                ${contractRegistry.size}`);
console.log(`Expedientes de cesión (total):            ${loanRegistry.allCases().length}`);
console.log(`Acuerdos de cesión (total):               ${completedLoanAgreements.length}`);
console.log(`  · por estado:                           ${JSON.stringify(loanStatusCounts)}`);
console.log(`Retornos procesados vía el reloj único:    ${loanReturnsProcessed}`);
console.log(`Pertenencias de academia (histórico):     ${academyRegistryForLegality.allMemberships().length} · `
  + `Decisiones anuales:                       ${academyRegistryForLegality.allDecisions().length}`);
console.log(`Actas de partido registradas:             ${totalMatchActs} (infeasibilidad médica conocida: ${totalToleratedInfeasibleActs})`);
console.log(`Altas de emergencia para garantizar legalidad: ${totalStartupEmergencyActions}`);
console.log(`Cesión ACB↔ACB con canon + 15%:            ${acbLoanChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Cesión Primera FEB→ACB:                   ${crossCompetitionLoanChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Recall pactado y ejercido en ventana:      ${recallValidChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Recall SIN pactar bloqueado:               ${recallBlockedChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Medical + cesión coexisten:                ${injuryDuringLoanChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Prohibición pactada contra el propietario: ${parentClubRestrictionChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Opción de compra ejercida sin mover roster: ${purchaseOptionNoConsentChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Opción + consentimiento -> handoff TRANSFER-1: ${purchaseOptionHandoffChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`MoraBanc/Andorra bloqueado:                ${moraBancBlockedChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Rollback tras fallo inyectado:              ${rollbackChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Determinismo (misma semilla -> misma decisión): ${determinismChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Registros conjuntos íntegros:              ${Object.values(finalChecks).every((c) => c.valid)}`);
console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

assert.strictEqual(totalSquadValidationFailures, totalToleratedInfeasibleActs, 'toda acta inválida debe ser una infeasibilidad médica conocida y avisada');
assert.ok(
  acbLoanChecked && crossCompetitionLoanChecked && recallValidChecked && recallBlockedChecked && injuryDuringLoanChecked
  && parentClubRestrictionChecked && purchaseOptionNoConsentChecked && purchaseOptionHandoffChecked
  && moraBancBlockedChecked && rollbackChecked && determinismChecked,
  'los fixtures dirigidos de LOAN-1 deben ejecutarse',
);
assert.ok(Object.values(finalChecks).every((c) => c.valid), 'todos los registros deben quedar íntegros al final');

console.log(`\nSMOKE TEST LOAN-1: OK (36 equipos, ${SEASONS_TO_SIMULATE} temporadas completas con Liga+Copa+Playoffs+Ascenso+cantera+mercado+traspasos+cesiones)`);
