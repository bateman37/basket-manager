#!/usr/bin/env node
// scripts/smoke-transfer1.js
// Prueba de humo TRANSFER-1 (DESIGN.md 9.20) contra la Liga real de 36
// equipos — reutiliza el MISMO motor de simulación de temporadas completas
// que smoke-market1.js/smoke-reg1.js (Liga+Copa+Playoffs+Ascenso+cantera,
// Player/Contract/Registration/Agent/Market Registry) y añade encima la
// vertical de traspasos: fichaje de agente libre, traspaso negociado (dos
// patas + consentimiento), ejercicio de cláusula de rescisión, mutuo
// acuerdo/liberación pura y un fichaje futuro programado (sección 11.2,
// reintentado por el mismo punto único del reloj que usa game.js).
//
// Ejecutar con:
//   node scripts/smoke-transfer1.js [temporadas]

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

const SEASONS_TO_SIMULATE = Number(process.argv[2] || 3);
const CAREER_SEED = 'smoke-transfer1-career-seed-v1';
// BUG-TRANSFER1-16 (DESIGN.md 9.21): planTransaction/commitTransaction
// exigen un contexto operacional EXPLÍCITO (¿hay un partido del usuario
// iniciado o pendiente de revelar?) — este smoke nunca simula un partido a
// medias del usuario, así que siempre es seguro declararlo explícitamente
// en falso (mismo criterio que smoke-loan1.js).
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
  const fallbackPlayers = padRosterToMinimum(roster, resolved.squadRules.min, { minAge: 18, maxAge: 34, referenceDate });
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

function validateAll(label, date) {
  const isoDate = LocalDate.fromJsDate(date);
  const playerCheck = playerRegistry.validateAgainstTeams(allTeams);
  assert.ok(playerCheck.valid, `[${label}] Player Registry roto: ${JSON.stringify(playerCheck.errors.slice(0, 5))}`);
  const contractCheck = contractRegistry.validateIntegrity({ playerRegistry, teams: allTeams, date: isoDate });
  assert.ok(contractCheck.valid, `[${label}] Contract Registry roto: ${JSON.stringify(contractCheck.errors.slice(0, 5))}`);
  const registrationCheck = registrationRegistry.validateIntegrity({ playerRegistry, contractRegistry, teams: allTeams, date: isoDate });
  assert.ok(registrationCheck.valid, `[${label}] Registration Registry roto: ${JSON.stringify(registrationCheck.errors.slice(0, 5))}`);
  const agentCheck = agentRegistry.validateIntegrity({ playerRegistry, teams: allTeams, date: isoDate });
  assert.ok(agentCheck.valid, `[${label}] Agent Registry roto: ${JSON.stringify(agentCheck.errors.slice(0, 5))}`);
  const marketCheck = marketRegistry.validateIntegrity({ playerRegistry, teams: allTeams, date: isoDate });
  assert.ok(marketCheck.valid, `[${label}] Market Registry roto: ${JSON.stringify(marketCheck.errors.slice(0, 5))}`);
  const transferCheck = transferRegistry.validateIntegrity({
    playerRegistry, teams: allTeams, contractRegistry, registrationRegistry, marketRegistry, date: isoDate,
  });
  assert.ok(transferCheck.valid, `[${label}] Transfer Registry roto: ${JSON.stringify(transferCheck.errors.slice(0, 5))}`);
  return {
    playerCheck, contractCheck, registrationCheck, agentCheck, marketCheck, transferCheck,
  };
}
validateAll('arranque', referenceDate);
console.log('OK: Player/Contract/Registration/Agent/Market/Transfer Registry íntegros al arranque.');

// =====================================================================
// Fixtures dirigidos TRANSFER-1 (sección 23.1 del prompt: "smoke con
// fixtures reales sobre los 36 equipos") — se ejecutan ANTES de la
// simulación de temporadas, sobre el mundo real recién sembrado.
// =====================================================================
function buildValidOfferDraft(team, player, isoDate, salaryMinor, seasons) {
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey, date: isoDate, operation: 'validateMarketOffer' });
  const employment = resolved.employment;
  const currency = employment.allowedCurrencies[0];
  const seasonKeys = [];
  let year = LocalDate.seasonStartYear(seasonKey);
  for (let i = 0; i < (seasons || 1); i += 1) seasonKeys.push(LocalDate.seasonKeyFromStartYear(year + i));
  // Mismo criterio que game.js (buildContractDraftFromOfferForm): un
  // acuerdo mid-season (habitual en TRANSFER-1: `isoDate` es la fecha real
  // de la operación, casi nunca el 1 de julio) arranca su vigencia en la
  // fecha real de la firma, NUNCA retrocedida al inicio de temporada —
  // Contract.js rechaza toda firma retroactiva, y un contrato de origen
  // que sigue vigente hasta esa misma fecha real solaparía con uno nuevo
  // fechado antes.
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

// Construye un AIP jugador-club vivo desde cero (inquiry -> oferta ->
// aceptación -> AIP), reutilizando MarketService real — mismo motor que
// game.js/test-transfer1.js, nunca un objeto simulado a mano.
function buildLiveAgreementForPlayer(team, player, isoDate, seed) {
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey, date: isoDate });
  const thread = MarketService.openInquiry({
    marketRegistry, agentRegistry, playerId: player.id, actingClubId: team.id, prospectiveCompetitionIds: ['acb'], date: isoDate, marketContext, careerSeed: seed,
  });
  thread.addEvent({ id: `${thread.id}:confirmed`, type: 'interest-confirmed', date: isoDate });
  // openInquiry() programa una respuesta de interés futura
  // (`${thread.id}:interest-response`) — como aquí se confirma el interés
  // a mano de forma determinista (sin esperar esa fecha), ese evento
  // programado debe marcarse procesado explícitamente: si no, sigue
  // "vencido" y el bucle de temporada (processDueMarketEventsToDate,
  // mismo criterio que game.js) lo reprocesaría más tarde contra un hilo
  // que ya avanzó de estado, rompiendo su máquina de eventos.
  marketRegistry.markEventProcessed(`${thread.id}:interest-response`);
  // 4 temporadas — el máximo real permitido (FIBA book3, 4 años), y por
  // encima del suelo de 3 que CONTRACT-1 aplica a todo contrato sembrado
  // (`MINIMUM_PLAYABLE_REMAINING_SEASONS`, puente de staging documentado
  // en CLAUDE.md): un contrato firmado en la temporada 1 de este smoke
  // test (que recorre 3 temporadas) sigue cubriendo la 4ª al cierre, sin
  // caer en el borde "no verificable" que CLAUDE.md reserva a CYCLE-1 (no
  // construido todavía).
  const draft = buildValidOfferDraft(team, player, isoDate, 12000000, 4);
  const offer = MarketService.createAndSendOffer({
    marketRegistry, thread, draft, offeredBy: 'club', date: isoDate, careerSeed: seed, marketContext,
    team, player, playerRegistry, contractRegistry, seasonKey,
  });
  offer.addEvent({ id: `${offer.id}:accept`, type: 'player-accepted', date: isoDate });
  return MarketService.createAgreementInPrinciple({ marketRegistry, thread, offer, date: isoDate, employmentSnapshot: { profileId: marketContext.bundleId } });
}

let freeAgentSigningChecked = false;
function runFreeAgentSigningFixture() {
  const team = allTeamsById.get('team-real-madrid');
  const player = initialFreeAgents[2];
  const isoDate = bootstrapIsoDate;
  const agreement = buildLiveAgreementForPlayer(team, player, isoDate, `${CAREER_SEED}|t1-free-agent`);
  const { plan, result } = TransferService.formalizeFreeAgentSigning({
    transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams: allTeams,
    agreement, destinationTeam: team, seasonKey, effectiveDate: isoDate, now: isoDate, commit: true,
    operationalContext: OPERATIONAL_CONTEXT,
  });
  assert.strictEqual(plan.blockers.length, 0, `fichaje de libre bloqueado: ${JSON.stringify(plan.blockers)}`);
  assert.ok(result.record, 'debe producir un TransactionRecord');
  assert.strictEqual(team.roster.find((p) => p.id === player.id), player);
  assert.strictEqual(player.teamId, team.id);
  assert.ok(contractRegistry.currentForPlayer(player.id, isoDate));
  freeAgentSigningChecked = true;
  console.log(`OK: fichaje de agente libre — "${player.fullName}" ficha por ${team.fullName} (contrato+roster+inscripción atómicos).`);
}
runFreeAgentSigningFixture();

let negotiatedTransferChecked = false;
function runNegotiatedTransferFixture() {
  const destinationTeam = allTeamsById.get('team-asisa-joventut');
  const originTeam = allTeams.find((t) => t.id !== destinationTeam.id && contractRegistry.forClub(t.id).length > 0);
  const originContract = contractRegistry.forClub(originTeam.id)[0];
  const player = playerRegistry.get(originContract.playerId);
  const isoDate = bootstrapIsoDate;
  const agreement = buildLiveAgreementForPlayer(destinationTeam, player, isoDate, `${CAREER_SEED}|t1-negotiated`);

  // Negociación club-club determinista — sube el importe hasta que el
  // vendedor CPU acepta (mismo patrón que la pantalla de Mercado >
  // Operaciones en game.js), acotado a un número razonable de rondas.
  let feeMinor = 30000000;
  let round = 0;
  let clubOffer = null;
  while (round < 12) {
    const proposedOffer = { id: `smoke-club-offer:${player.id}:${round}`, fee: { amountMinor: feeMinor, currency: 'EUR' } };
    const evaluation = TransferService.evaluateSellingClub({
      originTeam, player, originContract, offer: proposedOffer, careerSeed: CAREER_SEED, date: isoDate, seasonKey,
    });
    if (evaluation.decision === 'accept') { clubOffer = proposedOffer; break; }
    if (evaluation.decision === 'reject') { feeMinor = Math.round(feeMinor * 1.5); round += 1; continue; }
    feeMinor = TransferService.generateCounterFee({ originalFeeMinor: feeMinor, careerSeed: CAREER_SEED, offerId: proposedOffer.id, roundIndex: round });
    round += 1;
  }
  assert.ok(clubOffer, `el club vendedor "${originTeam.fullName}" nunca acepta un traspaso negociado tras ${round} rondas`);

  const { plan, result } = TransferService.formalizeNegotiatedTransfer({
    transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams: allTeams,
    agreement, originTeam, destinationTeam, seasonKey, effectiveDate: isoDate, now: isoDate, commit: true,
    clubOffer, playerConsentGrantedAt: isoDate,
    operationalContext: OPERATIONAL_CONTEXT,
  });
  assert.strictEqual(plan.blockers.length, 0, `traspaso negociado bloqueado: ${JSON.stringify(plan.blockers)}`);
  assert.ok(result.record, 'debe producir un TransactionRecord');
  assert.strictEqual(originTeam.roster.find((p) => p.id === player.id), undefined, 'el origen debe perder al jugador');
  assert.strictEqual(destinationTeam.roster.find((p) => p.id === player.id), player, 'el destino debe ganar al jugador');
  assert.strictEqual(player.teamId, destinationTeam.id);
  const obligations = transferRegistry.obligationsForTransaction(result.record.id);
  assert.ok(obligations.some((o) => o.concept === 'transfer-fee'), 'debe registrar el fee como obligación');
  negotiatedTransferChecked = true;
  console.log(`OK: traspaso negociado — "${player.fullName}" de ${originTeam.fullName} a ${destinationTeam.fullName} por ${(feeMinor / 100).toFixed(2)}€ (${round} rondas de negociación).`);
}
runNegotiatedTransferFixture();

// Añade un jugador SINTÉTICO con contrato+cláusula de rescisión a un club
// real (mismo patrón que test-transfer1.js: un contrato/cláusula real no
// existe todavía en los datos sembrados por ContractSeeder — CONTRACT-1
// nunca inventa cláusulas por defecto — así que se declara explícita para
// poder ejercitar el mecanismo de forma reproducible).
function attachSyntheticPlayerWithClause(team, id, releaseClauseAmountMinor) {
  const { generateFictionalPlayer } = require('../src/utils/playerGenerator.js');
  const player = generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  player.id = id;
  player.dataSource = 'simulated-smoke-fixture-v1';
  PD.ensureDevelopmentState(player, CONFIG_BASE, referenceDate);
  PC.ensureCareerHistory(player, CONFIG_BASE, referenceDate, { historyCompleteness: 'complete', seasonKey });
  const contractSeasonKeys = [seasonKey, PC.seasonKeyFromStartYear(seasonStartYear + 1), PC.seasonKeyFromStartYear(seasonStartYear + 2)];
  const contractStartDate = LocalDate.seasonWindow(seasonKey).startDate;
  const contractSalaryMinor = 15000000;
  const schedule = [];
  contractSeasonKeys.forEach((sk) => {
    const window = LocalDate.seasonWindow(sk);
    buildPaymentSchedule({
      totalMinor: contractSalaryMinor, installmentCount: 8, firstDueDate: LocalDate.endOfMonth(window.startDate), frequency: 'monthly', currency: 'EUR', seasonKey: sk,
    }).forEach((installment) => schedule.push(installment));
  });
  const contract = new Contract({
    id: `${id}:origin-contract`,
    playerId: player.id,
    clubId: team.id,
    contractType: 'professional-player',
    signedDate: contractStartDate,
    startDate: contractStartDate,
    endDate: LocalDate.seasonWindow(contractSeasonKeys[contractSeasonKeys.length - 1]).endDate,
    guaranteeType: 'fully-guaranteed',
    compensation: {
      currency: 'EUR', declaredBasis: 'gross',
      seasons: contractSeasonKeys.map((sk) => ({ seasonKey: sk, guaranteedBaseSalaryMinor: contractSalaryMinor })),
    },
    paymentPolicy: { installmentCount: 8, frequency: 'monthly', scheduledComponents: ['guaranteedBaseSalary'], schedule },
    clauses: [{
      id: `${id}:release-clause`, type: 'player-release', holder: 'player', amount: { amountMinor: releaseClauseAmountMinor, currency: 'EUR' }, status: 'active',
    }],
    declaredDocuments: ['written-contract'],
  });
  contractRegistry.register(contract);
  team.roster.push(player);
  player.teamId = team.id;
  playerRegistry.register(player);
  return { player, contract };
}

let releaseClauseChecked = false;
function runReleaseClauseExerciseFixture() {
  const originTeam = allTeamsById.get('team-kosner-baskonia');
  const destinationTeam = allTeamsById.get('team-unicaja');
  const { player, contract } = attachSyntheticPlayerWithClause(originTeam, 'smoke-t1-clause-player', 40000000);
  // ANTES del 15 de septiembre (restricción de inscripción ACB, art.
  // 17.4.5) — `bootstrapIsoDate` (inicio del calendario de partidos) cae
  // en octubre, después de esa restricción, así que este fixture concreto
  // exige una fecha temprana propia (mismo criterio que EARLY_DATE en
  // test-transfer1.js).
  const isoDate = LocalDate.addDays(LocalDate.seasonWindow(seasonKey).startDate, 50);
  const agreement = buildLiveAgreementForPlayer(destinationTeam, player, isoDate, `${CAREER_SEED}|t1-release-clause`);
  const clause = contract.clauses[0];
  const { plan, result } = TransferService.formalizeReleaseClauseExercise({
    transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams: allTeams,
    agreement, originTeam, destinationTeam, seasonKey, effectiveDate: isoDate, now: isoDate, commit: true,
    clauseId: clause.id, exercisedBy: 'player',
    operationalContext: OPERATIONAL_CONTEXT,
  });
  assert.strictEqual(plan.blockers.length, 0, `ejercicio de cláusula bloqueado: ${JSON.stringify(plan.blockers)}`);
  assert.ok(result.record, 'debe producir un TransactionRecord');
  assert.strictEqual(destinationTeam.roster.find((p) => p.id === player.id), player);
  assert.strictEqual(originTeam.roster.find((p) => p.id === player.id), undefined);
  const obligations = transferRegistry.obligationsForTransaction(result.record.id);
  assert.ok(obligations.some((o) => o.concept === 'release-clause-amount' && o.amountMinor === 40000000), 'el importe ejecutado debe coincidir EXACTO con la cláusula');
  assert.ok(!obligations.some((o) => o.concept === 'transfer-fee'), 'una cláusula ejercida nunca es un transfer-fee');
  releaseClauseChecked = true;
  console.log(`OK: ejercicio de cláusula de rescisión — "${player.fullName}" de ${originTeam.fullName} a ${destinationTeam.fullName} por 40.000,00€ (sin aceptación del vendedor).`);
}
runReleaseClauseExerciseFixture();

let mutualReleaseChecked = false;
function runMutualReleaseFixture() {
  const originTeam = allTeamsById.get('team-gran-canaria');
  const { player } = attachSyntheticPlayerWithClause(originTeam, 'smoke-t1-mutual-release-player', 1);
  const isoDate = bootstrapIsoDate;
  const rosterSizeBefore = originTeam.roster.length;
  const { plan, result } = TransferService.formalizeMutualAgreement({
    transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams: allTeams,
    originTeam, destinationTeam: null, playerId: player.id, seasonKey, effectiveDate: isoDate, now: isoDate, commit: true,
    mutualSettlement: { partiesConsent: ['club', 'player'], amount: { amountMinor: 2000000, currency: 'EUR' } },
    operationalContext: OPERATIONAL_CONTEXT,
  });
  assert.strictEqual(plan.blockers.length, 0, `liberación por mutuo acuerdo bloqueada: ${JSON.stringify(plan.blockers)}`);
  assert.ok(result.record, 'debe producir un TransactionRecord');
  assert.strictEqual(originTeam.roster.length, rosterSizeBefore - 1, 'el jugador debe salir del roster');
  assert.strictEqual(player.teamId, null, 'un jugador liberado nunca queda con teamId huérfano');
  assert.strictEqual(playerRegistry.get(player.id), player, 'sigue accesible en el Player Registry aunque esté libre');
  mutualReleaseChecked = true;
  console.log(`OK: liberación por mutuo acuerdo — "${player.fullName}" queda libre de ${originTeam.fullName}, accesible en el Player Registry.`);
}
runMutualReleaseFixture();

let scheduledFutureSigningChecked = false;
let scheduledCaseForRetry = null;
function runScheduledFutureSigningFixture() {
  const team = allTeamsById.get('team-kids-and-us-manresa');
  const player = initialFreeAgents[3];
  const isoDate = bootstrapIsoDate;
  const futureDate = LocalDate.addDays(isoDate, 12); // dentro de la vigencia del AIP (30 días por defecto)
  const agreement = buildLiveAgreementForPlayer(team, player, isoDate, `${CAREER_SEED}|t1-scheduled`);
  const { plan, result, transferCase } = TransferService.formalizeFreeAgentSigning({
    transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams: allTeams,
    agreement, destinationTeam: team, seasonKey, effectiveDate: futureDate, now: isoDate, commit: true,
    operationalContext: OPERATIONAL_CONTEXT,
  });
  assert.strictEqual(plan.blockers.length, 0, `fichaje futuro bloqueado: ${JSON.stringify(plan.blockers)}`);
  assert.strictEqual(result.notYetDue, true);
  assert.strictEqual(transferCase.statusOn(isoDate), 'scheduled', 'debe ser visible como "scheduled" HOY, no en el futuro');
  assert.strictEqual(team.roster.find((p) => p.id === player.id), undefined, 'no debe entrar hoy en el roster');
  scheduledCaseForRetry = { transferCase, futureDate };
  scheduledFutureSigningChecked = true;
  console.log(`OK: fichaje futuro programado — "${player.fullName}" ficha por ${team.fullName} con efecto el ${futureDate} (expediente "scheduled" hoy).`);
}
runScheduledFutureSigningFixture();

validateAll('tras fixtures de arranque TRANSFER-1', referenceDate);
console.log('OK: Registros íntegros tras los 5 fixtures dirigidos de TRANSFER-1.');

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

// TRANSFER-1 (DESIGN.md 9.20, sección 11.2 del prompt): "advanceGameClockTo()
// procesa esa fecha mediante el punto único del reloj" — reintenta
// cualquier expediente `scheduled` cuya fecha efectiva ya se ha alcanzado.
// Mismo criterio EXACTO que processDueScheduledTransfersToDate() en
// game.js, contra el mundo real de 36 equipos.
function processDueScheduledTransfers(date) {
  const isoDate = LocalDate.fromJsDate(date);
  const deps = {
    playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams: allTeams, now: isoDate,
    operationalContext: OPERATIONAL_CONTEXT,
  };
  transferRegistry.allCases()
    .filter((tCase) => tCase.statusOn(null) === 'scheduled' && tCase.effectiveDate && tCase.effectiveDate <= isoDate)
    .forEach((tCase) => TransferService.retryScheduledTransferCase(tCase, deps, isoDate));
}

let totalNewgens = 0;
let totalDeferredNewgenRegistrations = 0;

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
    // El fichaje futuro programado en el arranque (efecto 12 días después)
    // debe haberse completado durante la liga regular de la primera
    // temporada — lo confirmamos aquí, con el mundo real ya avanzado.
    assert.ok(scheduledCaseForRetry, 'fixture de fichaje futuro no se preparó');
    const { transferCase, futureDate } = scheduledCaseForRetry;
    // Estado REAL actual (sin filtrar por fecha): el reintento se dispara
    // en la primera ronda de calendario EN O DESPUÉS de `futureDate`, casi
    // nunca exactamente ESE día — `statusOn(futureDate)` filtrado
    // excluiría el evento "completed", fechado en la ronda real que lo
    // ejecutó.
    assert.strictEqual(transferCase.statusOn(null), 'completed', 'el fichaje futuro debe haberse ejecutado al alcanzar su fecha efectiva vía el reloj único');
    const team = allTeamsById.get('team-kids-and-us-manresa');
    const player = initialFreeAgents[3];
    assert.strictEqual(team.roster.find((p) => p.id === player.id), player, 'el jugador programado debe estar en el roster tras su fecha efectiva');
    console.log('OK: el fichaje futuro programado se completó automáticamente al llegar su fecha efectiva (punto único del reloj).');
  }

  validateAll(`fin de temporada ${seasonKey}`, calendar.currentGameDateTime);

  const leagueA = leagues['1ª'];
  const leagueB = leagues['2ª'];
  const seasonEndDateTime = calendar.currentGameDateTime;
  const seasonEndIso = LocalDate.fromJsDate(seasonEndDateTime);
  const prevSeasonKey = seasonKey;

  const divisionBeforeByTeamId = new Map();
  [...leagueA.teams, ...leagueB.teams].forEach((team) => divisionBeforeByTeamId.set(team.id, team.division));

  const standingsA = leagueA.getStandingsTable();
  const relegatedTeams = [standingsA[standingsA.length - 1].team, standingsA[standingsA.length - 2].team];
  relegatedTeams.forEach((team) => { team.division = '2ª'; });
  const promotedTeams = [promotionPlayoff.directPromotion.team, promotionPlayoff.secondPromotedEntry.team];
  promotedTeams.forEach((team) => { team.division = '1ª'; });

  allTeams = [...leagueA.teams, ...leagueB.teams];
  teamsByDivision = { '1ª': allTeams.filter((t) => t.division === '1ª'), '2ª': allTeams.filter((t) => t.division === '2ª') };
  allTeamsById = new Map(allTeams.map((t) => [t.id, t]));
  processDevelopmentToDateForTeams(allTeams, seasonEndDateTime);

  const nextSeasonKey = PC.seasonKeyFromStartYear(seasonStartYear + 1);

  const oldScopeIds = new Set([...leagueA.teams, ...leagueB.teams].map((team) => resolveRegistrationRulesForDivision(divisionBeforeByTeamId.get(team.id), prevSeasonKey, seasonEndDateTime).registrationScopeId));
  oldScopeIds.forEach((scopeId) => {
    registrationRegistry.registrationsForScope(scopeId)
      .filter((registration) => registration.seasonKey === prevSeasonKey && registration.statusOn(seasonEndIso) === 'active')
      .forEach((registration) => RegistrationService.advanceRegistrationEvent(registration, 'expired', seasonEndIso));
  });
  registrationRegistry.allLicenses()
    .filter((license) => license.seasonKey === prevSeasonKey && license.statusOn(seasonEndIso) === 'active')
    .forEach((license) => RegistrationService.advanceLicenseEvent(license, 'expired', seasonEndIso));

  const registrationTransition = RegistrationSeeder.seedRegistrationsForTeams({ teams: allTeams, seasonKey: nextSeasonKey, date: seasonEndIso, registrationRegistry, contractRegistry, config: CONFIG_BASE });

  const intakeCalibration = ContractSeeder.buildCompetitionCalibration(allTeams, CONFIG_BASE);
  allTeams.forEach((team) => {
    const resolvedForIntake = resolveRegistrationRulesForDivision(team.division, nextSeasonKey, seasonEndDateTime);
    const intakeClassification = RegistrationSeeder.classifyRosterForClub(team, resolvedForIntake, nextSeasonKey);
    const newPlayers = team.generateAcademyIntake(3, seasonEndDateTime);
    newPlayers.forEach((player) => PC.ensureCareerHistory(player, CONFIG_BASE, seasonEndDateTime, { historyCompleteness: 'complete', seasonKey: nextSeasonKey }));
    playerRegistry.registerMany(newPlayers);
    newPlayers.forEach((player) => {
      ContractSeeder.seedContractForNewPlayer({ player, team, seasonKey: nextSeasonKey, date: seasonEndIso, registry: contractRegistry, playerRegistry, config: CONFIG_BASE, calibration: intakeCalibration });
      const newgenReg = RegistrationSeeder.seedRegistrationForNewPlayer({
        player, team, seasonKey: nextSeasonKey, date: seasonEndIso, registrationRegistry, contractRegistry, config: CONFIG_BASE, existingClassification: intakeClassification,
      });
      if (!newgenReg.registration) totalDeferredNewgenRegistrations += 1;
      totalNewgens += 1;
    });
  });

  MarketService.expireDueOffers(marketRegistry, seasonEndIso);

  seasonStartYear += 1;
  calendar = new Calendar(seasonStartYear, CONFIG_BASE);
  calendarCtx.seasonStartDate = calendar.seasonStartDate;
  referenceDate = calendar.seasonStartDate;
  seasonKey = nextSeasonKey;
  bootstrapIsoDate = LocalDate.fromJsDate(referenceDate);

  validateAll(`tras cierre + cantera (${seasonKey})`, referenceDate);
  console.log(`Temporada cerrada. Ascendidos: ${promotedTeams.map((t) => t.fullName).join(', ')}. Descendidos: ${relegatedTeams.map((t) => t.fullName).join(', ')}.`);
  console.log(`Player Registry: ${playerRegistry.all().length} · Contratos: ${contractRegistry.size} · `
    + `Expedientes de traspaso: ${transferRegistry.allCases().length} · Transacciones: ${transferRegistry.allTransactionRecords().length} · `
    + `Obligaciones: ${transferRegistry.allObligations().length} (altas transición: ${registrationTransition.results.length}).`);
}

// =====================================================================
// Resumen final
// =====================================================================
const finalIso = LocalDate.fromJsDate(referenceDate);
const finalChecks = validateAll('final', referenceDate);

const completedCases = transferRegistry.allCases().filter((c) => c.statusOn(finalIso) === 'completed');
const mechanismCounts = {};
completedCases.forEach((c) => { mechanismCounts[c.mechanism] = (mechanismCounts[c.mechanism] || 0) + 1; });

console.log('\n=== RESUMEN TRANSFER-1 ===');
console.log(`Temporadas simuladas:                 ${SEASONS_TO_SIMULATE}`);
console.log(`Jugadores mundiales:                   ${playerRegistry.all().length}`);
console.log(`Contratos:                             ${contractRegistry.size}`);
console.log(`Expedientes de traspaso (total):        ${transferRegistry.allCases().length}`);
console.log(`  · completados por mecanismo:          ${JSON.stringify(mechanismCounts)}`);
console.log(`TransactionRecords:                     ${transferRegistry.allTransactionRecords().length}`);
console.log(`Obligaciones financieras:                ${transferRegistry.allObligations().length}`);
console.log(`Terminaciones de contrato:               ${transferRegistry.allTerminationRecords().length}`);
console.log(`Newgens contratados/inscritos:           ${totalNewgens} (inscripción diferida: ${totalDeferredNewgenRegistrations})`);
console.log(`Actas de partido registradas:            ${totalMatchActs} (infeasibilidad médica conocida: ${totalToleratedInfeasibleActs})`);
console.log(`Fichaje de agente libre:                 ${freeAgentSigningChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Traspaso negociado:                      ${negotiatedTransferChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Ejercicio de cláusula de rescisión:       ${releaseClauseChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Liberación por mutuo acuerdo:             ${mutualReleaseChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Fichaje futuro programado (scheduled):    ${scheduledFutureSigningChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Registros conjuntos íntegros:             ${Object.values(finalChecks).every((c) => c.valid)}`);
console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

assert.strictEqual(totalSquadValidationFailures, totalToleratedInfeasibleActs, 'toda acta inválida debe ser una infeasibilidad médica conocida y avisada');
assert.ok(freeAgentSigningChecked && negotiatedTransferChecked && releaseClauseChecked && mutualReleaseChecked && scheduledFutureSigningChecked, 'los 5 fixtures dirigidos de TRANSFER-1 deben ejecutarse');
assert.ok(Object.values(finalChecks).every((c) => c.valid), 'todos los registros deben quedar íntegros al final');

console.log(`\nSMOKE TEST TRANSFER-1: OK (36 equipos, ${SEASONS_TO_SIMULATE} temporadas completas con Liga+Copa+Playoffs+Ascenso+cantera+mercado+traspasos)`);
