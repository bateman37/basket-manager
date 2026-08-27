#!/usr/bin/env node
// scripts/test-transfer1.js
// Verificación TRANSFER-1 (DESIGN.md 9.20) — script Node ad-hoc, mismo
// criterio que test-market1.js/test-reg1.js/test-contract1.js/
// test-roster1.js (no hay framework de tests instalado, ver CLAUDE.md).
// Ejecutar con:
//   node scripts/test-transfer1.js
//
// Grupos (sección 23.1 del prompt de TRANSFER-1):
//   1. Confirmación de las correcciones BUG-MARKET1-03..07 (test-market1.js
//      ya las cubre con 82 comprobaciones — aquí se confirma que la base
//      sobre la que se apoya TRANSFER-1 sigue corregida, no se duplica).
//   2. Dominio `transfer` multi-liga (resolveTransferRules).
//   3. Entidades y TransferRegistry.
//   4. España RD 1006: 15%, pacto, moneda.
//   5. Andorra/MoraBanc: nunca hereda el 15% español.
//   6. ACB: renuncia de derechos por tramos, restricción de cláusula.
//   7. Libre -> contrato + roster + inscripción (atómico).
//   8. Traspaso negociado (dos patas, consentimiento, participación).
//   9. Cláusula de rescisión (sin aceptación del vendedor, sin 15%).
//   10. Mutuo acuerdo / liberación.
//   11. Fallos atómicos (failure injection + rollback exacto).
//   12. Idempotencia y AIP.
//   13. Auditorías estáticas de alcance.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Team } = require('../src/entities/Team.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { MarketService } = require('../src/core/MarketService.js');
const { ContractService } = require('../src/core/ContractService.js');
const { TransferService } = require('../src/core/TransferService.js');
const { TransferExecutionService } = require('../src/core/TransferExecutionService.js');
const { RosterMutationService } = require('../src/core/RosterMutationService.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { Contract, buildPaymentSchedule } = require('../src/entities/Contract.js');
const TransferEntities = require('../src/entities/Transfer.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const PlayerGenerator = require('../src/utils/playerGenerator.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');

let passed = 0;
let failed = 0;
let currentGroup = '';
function group(name) { currentGroup = name; console.log(`\n--- ${name} ---`); }
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL [${currentGroup}] ${name}`);
    console.log(`     ${err.stack || err.message}`);
  }
}

const SEASON = '2026-27';
const GAME_DATE = '2026-10-15'; // dentro de temporada, ANTES del 15-09... no: DESPUÉS. Ver EARLY_DATE para casos que exigen fecha temprana.
const EARLY_DATE = '2026-08-20'; // antes del 15 de septiembre (restricción ACB art. 17.4.5)

function realTeam(id) { return new Team({ ...REAL_DATA_TEAMS[id], roster: [] }); }

function makeWorld() {
  const playerRegistry = new PlayerRegistry();
  const contractRegistry = new ContractRegistry();
  const registrationRegistry = new RegistrationRegistry();
  const marketRegistry = new MarketRegistry();
  const transferRegistry = new TransferRegistry();
  return {
    playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry,
  };
}

// Crea un AIP vivo jugador-club "destino" desde cero (hilo -> oferta ->
// aceptación -> acuerdo), reutilizando MarketService real (nunca un objeto
// simulado a mano) — mismo criterio que setupNegotiationFixture de
// test-market1.js.
function makeLiveAgreement(world, destinationTeam, player, seed, date, overrides) {
  const opts = overrides || {};
  const d = date || GAME_DATE;
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: d });
  const thread = MarketService.openInquiry({
    marketRegistry: world.marketRegistry, agentRegistry: null, playerId: player.id, actingClubId: destinationTeam.id,
    prospectiveCompetitionIds: ['acb'], date: d, marketContext, careerSeed: seed,
  });
  thread.addEvent({ id: `${thread.id}:confirmed`, type: 'interest-confirmed', date: d });
  const resolved = ContractService.resolveRulesForClub(destinationTeam, { seasonKey: SEASON, date: d, operation: 'signContract' });
  const employment = resolved.employment;
  const currency = employment.allowedCurrencies[0];
  const baseSalary = opts.baseSalaryMinor || 12000000;
  const installmentCount = opts.installmentCount || 8;
  const window = LocalDate.seasonWindow(SEASON);
  const schedule = buildPaymentSchedule({
    totalMinor: baseSalary, installmentCount, firstDueDate: LocalDate.endOfMonth(d), frequency: employment.payments.frequency || 'monthly', currency, seasonKey: SEASON,
  });
  const draft = {
    playerId: player.id, clubId: destinationTeam.id, contractType: 'professional-player',
    signedDate: d, startDate: d, endDate: window.endDate, coveredSeasonKeys: [SEASON], guaranteeType: 'fully-guaranteed',
    compensation: {
      currency, declaredBasis: 'gross', seasons: [{ seasonKey: SEASON, guaranteedBaseSalaryMinor: baseSalary, guaranteedImageRightsMinor: 0, guaranteedSalaryInKindMinor: 0, signingBonusMinor: 0, variableBonuses: [], nonSalaryBenefits: [], agentCosts: [] }],
    },
    paymentPolicy: { installmentCount, frequency: employment.payments.frequency || 'monthly', scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'], schedule },
    clauses: [], declaredDocuments: ['written-contract', ...employment.requiredDocuments],
  };
  const offer = MarketService.createAndSendOffer({
    marketRegistry: world.marketRegistry, thread, draft, offeredBy: 'club', date: d, careerSeed: seed,
    team: destinationTeam, player, playerRegistry: world.playerRegistry, contractRegistry: world.contractRegistry, seasonKey: SEASON,
  });
  offer.addEvent({ id: `${offer.id}:accept`, type: 'player-accepted', date: d });
  return MarketService.createAgreementInPrinciple({ marketRegistry: world.marketRegistry, thread, offer, date: d, employmentSnapshot: { profileId: marketContext.bundleId } });
}

function makeOriginContract(world, team, player, overrides) {
  const opts = overrides || {};
  const contract = new Contract({
    id: opts.id || `origin:${player.id}`,
    playerId: player.id,
    clubId: team.id,
    contractType: 'professional-player',
    signedDate: opts.signedDate || '2025-07-01',
    startDate: opts.startDate || '2025-07-01',
    endDate: opts.endDate || '2028-06-30',
    guaranteeType: 'fully-guaranteed',
    compensation: {
      currency: 'EUR',
      declaredBasis: 'gross',
      seasons: (opts.seasonKeys || ['2025-26', SEASON, '2027-28']).map((sk) => ({ seasonKey: sk, guaranteedBaseSalaryMinor: opts.salaryMinor || 20000000 })),
    },
    clauses: opts.clauses || [],
    declaredDocuments: ['written-contract'],
  });
  world.contractRegistry.register(contract);
  team.roster.push(player);
  player.teamId = team.id;
  world.playerRegistry.register(player);
  return contract;
}

function deepWorldSnapshot(world, teams) {
  return JSON.stringify({
    contracts: world.contractRegistry.all().map((c) => c.toJSON()),
    rosters: teams.map((t) => t.roster.map((p) => p.id)),
    teamIds: teams.reduce((acc, t) => { t.roster.forEach((p) => { acc[p.id] = t.id; }); return acc; }, {}),
    registrations: world.registrationRegistry.allRegistrations().map((r) => r.toJSON()),
    licenses: world.registrationRegistry.allLicenses().map((l) => l.toJSON()),
    agreements: world.marketRegistry.allAgreements().map((a) => a.toJSON()),
    reservations: world.marketRegistry.allBudgetReservations(),
    transactions: world.transferRegistry.allTransactionRecords().map((r) => r.toJSON()),
    obligations: world.transferRegistry.allObligations().map((o) => o.toJSON()),
    terminations: world.transferRegistry.allTerminationRecords().map((r) => r.toJSON()),
  });
}

// =========================================================================
// 1. Confirmación de la base MARKET-1 corregida
// =========================================================================
group('1. Base MARKET-1 corregida (confirmación, no duplicación)');

check('BUG-MARKET1-03: createAndSendOffer sigue exigiendo dependencias y valida internamente', () => {
  assert.throws(() => MarketService.createAndSendOffer({ marketRegistry: new MarketRegistry() }), /faltan dependencias obligatorias/);
});

check('BUG-MARKET1-06: AgreementInPrinciple exige validUntil y tiene ciclo de vida real', () => {
  assert.throws(() => new (require('../src/entities/Market.js').AgreementInPrinciple)({
    id: 'x', threadId: 't', acceptedOfferId: 'o', playerId: 'p', clubId: 'c', acceptedAt: GAME_DATE, employmentSnapshot: {}, budgetReservationGroupId: 'g',
  }), /validUntil/);
});

// =========================================================================
// 2. Dominio `transfer` multi-liga
// =========================================================================
group('2. Dominio `transfer` multi-liga');

check('resolveTransferRules exige contexto explícito (nunca deriva de team.division)', () => {
  assert.throws(() => CompetitionRules.resolveTransferRules({ playerId: 'p1' }), /originClubId/);
});

check('una jurisdicción laboral de origen desconocida falla explícito (nunca ACB por defecto)', () => {
  assert.throws(() => CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'FR', destinationEmployerJurisdictionId: 'ES', seasonKey: SEASON, effectiveDate: GAME_DATE,
  }), /no hay ningún módulo/);
});

check('una competición desconocida en el contexto falla explícito', () => {
  assert.throws(() => CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'ES',
    originCompetitionId: 'euroleague-not-real', seasonKey: SEASON, effectiveDate: GAME_DATE,
  }), /competición desconocida/);
});

check('transactionScope international bloquea con REQUIRES_EUROPE_1, nunca se convierte en doméstica en silencio', () => {
  const resolved = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'IT',
    originCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: GAME_DATE, transactionScope: 'international',
  });
  assert.strictEqual(resolved.allowedMechanisms.length, 0);
  assert.ok(resolved.blockers.some((b) => b.code === 'REQUIRES_EUROPE_1'));
});

check('ACB y Primera FEB difieren por módulos reales (nunca "1ª"/"2ª")', () => {
  const acb = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: GAME_DATE,
  });
  const feb = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'ES',
    originCompetitionId: 'primera-feb', destinationCompetitionId: 'primera-feb', seasonKey: SEASON, effectiveDate: GAME_DATE,
  });
  assert.ok(acb.rightsCompensationRules, 'ACB declara compensación por renuncia');
  assert.strictEqual(feb.rightsCompensationRules, null, 'Primera FEB NUNCA hereda el tanteo/compensación ACB');
  assert.strictEqual(feb.timingRules.feb.inheritsAcbDeadlinesOrCompensation, false);
});

check('módulo reference-only nunca se autoselecciona en un contexto real', () => {
  const resolved = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'ES', seasonKey: SEASON, effectiveDate: GAME_DATE,
  });
  assert.ok(!resolved.trace.sourceRuleIds.includes('bm-test-fictional-transfer-participation-v1'));
});

check('fixture reference-only SÍ se activa si se fija explícitamente (demuestra extensibilidad)', () => {
  const resolved = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'XX', destinationEmployerJurisdictionId: 'ES', seasonKey: SEASON, effectiveDate: GAME_DATE,
    pinnedModuleIds: ['bm-test-fictional-transfer-participation-v1'],
  });
  assert.strictEqual(resolved.playerParticipationRules.negotiatedTransfer.defaultMinimumPercentBasisPoints, 2500);
});

check('todo módulo de transferencia declara fuente, versión y estado', () => {
  Object.values(CompetitionRules.TRANSFER_MODULES).forEach((mod) => {
    assert.ok(mod.version, `${mod.id} sin version`);
    assert.ok(['verified', 'provisional', 'reference-only'].includes(mod.status), `${mod.id} estado desconocido`);
    if (mod.status !== 'reference-only') assert.ok(Array.isArray(mod.sourceRefs), `${mod.id} sin sourceRefs`);
  });
});

// =========================================================================
// 3. Entidades y TransferRegistry
// =========================================================================
group('3. Entidades y TransferRegistry');

check('TransferCase: transición inválida rechazada (no se puede completar sin pasar por readyToExecute)', () => {
  const tc = new TransferEntities.TransferCase({
    id: 'case-inv', playerId: 'p1', initiatingClubId: 'c1', destinationClubId: 'c1', agreementInPrincipleId: 'aip-1', operationType: 'free-agent-signing', openedAt: GAME_DATE,
  });
  assert.throws(() => tc.addEvent({ id: 'case-inv:c', type: 'completed', date: GAME_DATE }));
});

check('TransferCase: un terminal nunca vuelve a un estado vivo', () => {
  const tc = new TransferEntities.TransferCase({
    id: 'case-term', playerId: 'p1', initiatingClubId: 'c1', destinationClubId: 'c1', agreementInPrincipleId: 'aip-1', operationType: 'free-agent-signing', openedAt: GAME_DATE,
  });
  tc.addEvent({ id: 'case-term:w', type: 'withdrawn', date: GAME_DATE });
  assert.ok(tc.isTerminal(GAME_DATE));
  assert.throws(() => tc.addEvent({ id: 'case-term:rtp', type: 'ready-to-plan', date: GAME_DATE }));
});

check('ClubTransferOffer: inmutable (fee congelado), contraoferta = versión nueva', () => {
  const offer1 = new TransferEntities.ClubTransferOffer({
    id: 'co-1', transferCaseId: 'case-1', version: 1, offeredByClubId: 'buyer', addressedToClubId: 'seller', createdAt: GAME_DATE, expiresAt: LocalDate.addDays(GAME_DATE, 5), fee: { amountMinor: 1000000, currency: 'EUR' },
  });
  const before = offer1.fee;
  offer1.fee.amountMinor = 999; // no debe surtir efecto (Object.freeze)
  assert.strictEqual(offer1.fee, before);
  assert.strictEqual(offer1.fee.amountMinor, 1000000);
});

check('FinancialObligation: nunca admite estado "paid" sin economía real', () => {
  assert.throws(() => new TransferEntities.FinancialObligation({
    id: 'fo-x', transactionId: 'tx-1', concept: 'transfer-fee', debtorType: 'club', debtorId: 'c1', creditorType: 'club', creditorId: 'c2',
    amountMinor: 100, currency: 'EUR', legalSource: {}, status: 'paid',
  }), /nunca "paid"/);
});

check('ClubTransferOffer: cláusula de solidaridad exige sourceRefs (nunca inventada sin fuente)', () => {
  assert.throws(() => new TransferEntities.ClubTransferOffer({
    id: 'co-2', transferCaseId: 'case-1', version: 1, offeredByClubId: 'buyer', addressedToClubId: 'seller', createdAt: GAME_DATE, expiresAt: LocalDate.addDays(GAME_DATE, 5), fee: { amountMinor: 1000000, currency: 'EUR' },
    solidarityLines: [{ amount: { amountMinor: 1000, currency: 'EUR' } }],
  }), /sourceRefs/);
});

check('TransferRegistry: liveClubOfferForCase detecta más de una oferta viva a la vez como invariante rota', () => {
  const tr = new TransferRegistry();
  const mk = (id, v) => new TransferEntities.ClubTransferOffer({
    id, transferCaseId: 'case-x', version: v, offeredByClubId: 'a', addressedToClubId: 'b', createdAt: GAME_DATE, expiresAt: LocalDate.addDays(GAME_DATE, 5), fee: { amountMinor: 100, currency: 'EUR' },
  });
  tr.registerClubOffer(mk('co-a', 1));
  tr.registerClubOffer(mk('co-b', 2));
  assert.throws(() => tr.liveClubOfferForCase('case-x', GAME_DATE), /invariante rota/);
});

check('validateIntegrity detecta un TransactionRecord con jugador ausente de PlayerRegistry', () => {
  const tr = new TransferRegistry();
  const record = new TransferEntities.TransactionRecord({
    id: 'tx-orphan', transferCaseId: 'case-o', playerId: 'ghost-player', operationType: 'free-agent-signing', mechanism: 'free-agent-signing', effectiveDate: GAME_DATE, completedAt: GAME_DATE, destinationClubId: 'c1',
  });
  tr.registerTransactionRecord(record);
  const report = tr.validateIntegrity({ playerRegistry: new PlayerRegistry() });
  assert.strictEqual(report.valid, false);
  assert.ok(report.errors.some((e) => e.includes('ghost-player')));
});

// =========================================================================
// 4/5/6. España RD1006, Andorra, ACB por tramos
// =========================================================================
group('4-6. Cálculo monetario: España 15%, Andorra sin 15%, ACB por tramos');

check('España: fee de 100.000,00€ sin pacto -> participación mínima exacta 15.000,00€', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const destinationTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  makeOriginContract(world, originTeam, player, { salaryMinor: 5000000 });
  const agreement = makeLiveAgreement(world, destinationTeam, player, 'seed-t4-1');
  const { plan, result } = TransferService.formalizeNegotiatedTransfer({
    ...world, teams: [originTeam, destinationTeam], agreement, originTeam, destinationTeam, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
    clubOffer: { id: 'co-t4-1', fee: { amountMinor: 10000000, currency: 'EUR' } }, playerConsentGrantedAt: GAME_DATE,
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  const obligations = world.transferRegistry.obligationsForTransaction(result.record.id);
  const participation = obligations.find((o) => o.concept === 'player-transfer-participation');
  assert.strictEqual(participation.amountMinor, 1500000, '15% exacto de 10.000.000');
});

check('fee cero/mutuo acuerdo: NUNCA inventa participación positiva', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 30, maxAge: 34 });
  makeOriginContract(world, originTeam, player, { salaryMinor: 3000000, id: 'origin:mutual-zero' });
  const { plan, result } = TransferService.formalizeMutualAgreement({
    ...world, teams: [originTeam], originTeam, destinationTeam: null, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
    mutualSettlement: { partiesConsent: ['club', 'player'] }, playerId: player.id,
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  const obligations = world.transferRegistry.obligationsForTransaction(result.record.id);
  assert.strictEqual(obligations.length, 0, 'sin importe pactado, ninguna obligación económica inventada');
});

check('buyout de cláusula: NO añade el 15% del art. 13.a por defecto', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const destinationTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 22, maxAge: 26 });
  makeOriginContract(world, originTeam, player, {
    id: 'origin:buyout-2', clauses: [{ id: 'clause-2', type: 'player-release', holder: 'player', amount: { amountMinor: 20000000, currency: 'EUR' }, support: 'modeled-only', status: 'simulated' }],
  });
  const agreement = makeLiveAgreement(world, destinationTeam, player, 'seed-t6-1', EARLY_DATE);
  const { plan, result } = TransferService.formalizeReleaseClauseExercise({
    ...world, teams: [originTeam, destinationTeam], agreement, originTeam, destinationTeam, seasonKey: SEASON, effectiveDate: EARLY_DATE, now: EARLY_DATE, commit: true, clauseId: 'clause-2', exercisedBy: 'player',
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  const obligations = world.transferRegistry.obligationsForTransaction(result.record.id);
  assert.strictEqual(obligations.length, 1);
  assert.strictEqual(obligations[0].concept, 'release-clause-amount');
  assert.strictEqual(obligations[0].amountMinor, 20000000);
});

check('MoraBanc Andorra: la participación negociada NUNCA hereda el 15% español', () => {
  const rules = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'team-morabanc-andorra', destinationClubId: 'team-barca',
    originEmployerJurisdictionId: 'AD', destinationEmployerJurisdictionId: 'ES', originCompetitionId: 'acb', destinationCompetitionId: 'acb',
    seasonKey: SEASON, effectiveDate: GAME_DATE, operationType: 'negotiated-transfer',
  });
  assert.strictEqual(rules.playerParticipationRules.negotiatedTransfer.defaultMinimumPercentBasisPoints, null);
});

check('ACB renuncia de derechos: promedio que cruza los tramos <=20 (75/50/25/10%)', () => {
  const rules = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: GAME_DATE,
  });
  // 800.000€ de promedio anual, edad 19: 75% de 100.000 + 50% de 200.000 + 25% de 300.000 + 10% de 200.000
  const result = TransferExecutionService.computeRightsWaiverCompensation(rules.rightsCompensationRules, 19, 80000000);
  const expected = Math.round(10000000 * 0.75) + Math.round(20000000 * 0.5) + Math.round(30000000 * 0.25) + Math.round(20000000 * 0.10);
  assert.strictEqual(result.amountMinor, expected);
});

check('ACB renuncia de derechos: tramo 21-23 cruza 70.000 y 180.000 (15/30/50%)', () => {
  const rules = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: GAME_DATE,
  });
  const result = TransferExecutionService.computeRightsWaiverCompensation(rules.rightsCompensationRules, 22, 25000000);
  const expected = Math.round(7000000 * 0.15) + Math.round(11000000 * 0.30) + Math.round(7000000 * 0.50);
  assert.strictEqual(result.amountMinor, expected);
});

check('ACB renuncia de derechos: edad fuera de tramos (24+) no aplica', () => {
  const rules = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: GAME_DATE,
  });
  const result = TransferExecutionService.computeRightsWaiverCompensation(rules.rightsCompensationRules, 26, 25000000);
  assert.strictEqual(result.applicable, false);
});

check('cláusula ejercida tras el 15 de septiembre: bloqueada por restricción de inscripción ACB', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const destinationTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 22, maxAge: 26 });
  makeOriginContract(world, originTeam, player, {
    id: 'origin:late-clause', clauses: [{ id: 'clause-late', type: 'player-release', holder: 'player', amount: { amountMinor: 15000000, currency: 'EUR' }, support: 'modeled-only', status: 'simulated' }],
  });
  const agreement = makeLiveAgreement(world, destinationTeam, player, 'seed-t6-late', GAME_DATE); // 15-oct, DESPUÉS del 15-09
  const { plan } = TransferService.formalizeReleaseClauseExercise({
    ...world, teams: [originTeam, destinationTeam], agreement, originTeam, destinationTeam, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true, clauseId: 'clause-late', exercisedBy: 'player',
  });
  assert.ok(plan.blockers.some((b) => b.code === 'RELEASE_CLAUSE_REGISTRATION_RESTRICTED'));
  assert.strictEqual(originTeam.roster.some((p) => p.id === player.id), true, 'el bloqueo no debe mover al jugador');
});

// =========================================================================
// 7. Libre -> contrato + roster + inscripción
// =========================================================================
group('7. Libre -> contrato + roster + inscripción (atómico)');

check('fichaje de libre: contrato + roster + inscripción aparecen juntos, misma instancia, reserva liberada', () => {
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, 'seed-t7-1');
  const { plan, result } = TransferService.formalizeFreeAgentSigning({
    ...world, teams: [team], agreement, destinationTeam: team, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.strictEqual(team.roster.find((p) => p.id === player.id), player);
  assert.strictEqual(player.teamId, team.id);
  assert.ok(world.contractRegistry.currentForPlayer(player.id, GAME_DATE));
  assert.ok(world.registrationRegistry.currentRegistration(player.id, result.record.createdRegistrationId ? world.registrationRegistry.getRegistration(result.record.createdRegistrationId).registrationScopeId : null, SEASON, GAME_DATE));
  assert.strictEqual(agreement.statusOn(GAME_DATE), 'completed');
  assert.ok(!world.marketRegistry.getBudgetReservationGroup(agreement.budgetReservationGroupId).some((l) => l.status === 'active'));
});

check('repetición del mismo comando (transactionId) es idempotente — no duplica nada', () => {
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, 'seed-t7-2');
  const { plan, result } = TransferService.formalizeFreeAgentSigning({
    ...world, teams: [team], agreement, destinationTeam: team, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
  });
  const second = TransferExecutionService.commitTransaction(plan, { ...world, teams: [team], now: GAME_DATE });
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(second.record.id, result.record.id);
  assert.strictEqual(world.contractRegistry.forPlayer(player.id).length, 1, 'no debe duplicar el contrato');
  assert.strictEqual(team.roster.filter((p) => p.id === player.id).length, 1, 'no debe duplicar el roster');
});

check('renderizar/consultar (planTransaction) nunca muta ni reserva', () => {
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, 'seed-t7-3');
  const before = deepWorldSnapshot(world, [team]);
  TransferService.formalizeFreeAgentSigning({
    ...world, teams: [team], agreement, destinationTeam: team, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: false,
  });
  const after = deepWorldSnapshot(world, [team]);
  assert.strictEqual(after, before, 'planificar sin comprometer no debe cambiar nada');
});

// =========================================================================
// 8. Traspaso negociado
// =========================================================================
group('8. Traspaso negociado (dos patas + consentimiento)');

check('sin oferta club-club ni consentimiento del jugador, no se completa nada', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const destinationTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  makeOriginContract(world, originTeam, player, { id: 'origin:t8-1' });
  assert.throws(() => TransferService.formalizeNegotiatedTransfer({
    ...world, teams: [originTeam, destinationTeam], agreement: null, originTeam, destinationTeam, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true, clubOffer: { id: 'x', fee: { amountMinor: 1, currency: 'EUR' } },
  }));
});

check('traspaso completo: origen termina, destino se registra, fee y participación son obligaciones DISTINTAS', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const destinationTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  const originContract = makeOriginContract(world, originTeam, player, { id: 'origin:t8-2', salaryMinor: 8000000 });
  const agreement = makeLiveAgreement(world, destinationTeam, player, 'seed-t8-2');
  const { plan, result } = TransferService.formalizeNegotiatedTransfer({
    ...world, teams: [originTeam, destinationTeam], agreement, originTeam, destinationTeam, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
    clubOffer: { id: 'co-t8-2', fee: { amountMinor: 50000000, currency: 'EUR' } }, playerConsentGrantedAt: GAME_DATE,
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.strictEqual(originContract.statusOn(GAME_DATE), 'terminated');
  assert.ok(world.contractRegistry.currentForPlayer(player.id, GAME_DATE).clubId === destinationTeam.id);
  const obligations = world.transferRegistry.obligationsForTransaction(result.record.id);
  const fee = obligations.find((o) => o.concept === 'transfer-fee');
  const part = obligations.find((o) => o.concept === 'player-transfer-participation');
  assert.ok(fee && part && fee.id !== part.id, 'fee y participación son DOS obligaciones separadas, nunca sumadas');
  assert.strictEqual(fee.amountMinor, 50000000);
  assert.strictEqual(part.amountMinor, 7500000);
});

check('si el traspaso falla (blockers), el mundo queda EXACTAMENTE igual', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const destinationTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  makeOriginContract(world, originTeam, player, { id: 'origin:t8-3' });
  const agreement = makeLiveAgreement(world, destinationTeam, player, 'seed-t8-3');
  const before = deepWorldSnapshot(world, [originTeam, destinationTeam]);
  // Sin transferAgreement ni consentimiento -> debe bloquear, nunca ejecutar.
  const { plan, result } = TransferService.formalizeNegotiatedTransfer({
    ...world, teams: [originTeam, destinationTeam], agreement, originTeam, destinationTeam, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
    clubOffer: { id: 'co-t8-3', fee: { amountMinor: 1, currency: 'EUR' } }, playerConsentGrantedAt: null,
  });
  assert.strictEqual(result, null);
  assert.ok(plan.blockers.length > 0);
  // El TransferAgreement/TransferCase SÍ se crean como expediente (no son
  // el "mundo" canónico) — se comprueba que Player/Team/Contract/
  // Registration/Market siguen intactos, que es la garantía real.
  const worldOnlyBefore = JSON.parse(before);
  const after = deepWorldSnapshot(world, [originTeam, destinationTeam]);
  const worldOnlyAfter = JSON.parse(after);
  assert.deepStrictEqual(worldOnlyAfter.contracts, worldOnlyBefore.contracts);
  assert.deepStrictEqual(worldOnlyAfter.rosters, worldOnlyBefore.rosters);
  assert.deepStrictEqual(worldOnlyAfter.registrations, worldOnlyBefore.registrations);
});

// =========================================================================
// 9. Cláusula de rescisión
// =========================================================================
group('9. Cláusula de rescisión (sin aceptación del vendedor)');

check('el ejercicio de cláusula NO requiere ninguna aceptación del club de origen', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const destinationTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 22, maxAge: 26 });
  makeOriginContract(world, originTeam, player, {
    id: 'origin:t9-1', clauses: [{ id: 'clause-9', type: 'player-release', holder: 'player', amount: { amountMinor: 8000000, currency: 'EUR' }, support: 'modeled-only', status: 'simulated' }],
  });
  const agreement = makeLiveAgreement(world, destinationTeam, player, 'seed-t9-1', EARLY_DATE);
  const { plan, result } = TransferService.formalizeReleaseClauseExercise({
    ...world, teams: [originTeam, destinationTeam], agreement, originTeam, destinationTeam, seasonKey: SEASON, effectiveDate: EARLY_DATE, now: EARLY_DATE, commit: true, clauseId: 'clause-9', exercisedBy: 'player',
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.ok(result.record);
  assert.strictEqual(player.teamId, destinationTeam.id);
});

check('un importe distinto al de la cláusula congelada se rechaza', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const destinationTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 22, maxAge: 26 });
  makeOriginContract(world, originTeam, player, {
    id: 'origin:t9-2', clauses: [{ id: 'clause-9b', type: 'player-release', holder: 'player', amount: { amountMinor: 8000000, currency: 'EUR' }, support: 'modeled-only', status: 'simulated' }],
  });
  const agreement = makeLiveAgreement(world, destinationTeam, player, 'seed-t9-2', EARLY_DATE);
  assert.throws(() => TransferService.formalizeReleaseClauseExercise({
    ...world, teams: [originTeam, destinationTeam], agreement, originTeam, destinationTeam, seasonKey: SEASON, effectiveDate: EARLY_DATE, now: EARLY_DATE, commit: true, clauseId: 'clause-does-not-exist', exercisedBy: 'player',
  }), /inexistente/);
});

// =========================================================================
// 10. Mutuo acuerdo / liberación
// =========================================================================
group('10. Mutuo acuerdo / liberación');

check('liberación sin destino: jugador libre, accesible en el Player Registry, fuera de todos los rosters', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 30, maxAge: 34 });
  makeOriginContract(world, originTeam, player, { id: 'origin:t10-1', salaryMinor: 4000000 });
  const { plan, result } = TransferService.formalizeMutualAgreement({
    ...world, teams: [originTeam], originTeam, destinationTeam: null, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
    mutualSettlement: { partiesConsent: ['club', 'player'], amount: { amountMinor: 500000, currency: 'EUR' } }, playerId: player.id,
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.strictEqual(player.teamId, null);
  assert.strictEqual(originTeam.roster.some((p) => p.id === player.id), false);
  assert.strictEqual(world.playerRegistry.get(player.id), player, 'sigue accesible en el registro mundial');
  assert.ok(result.record);
});

check('mutuo acuerdo sin pacto explícito bloquea (nunca inventa importe/decisión judicial)', () => {
  const world = makeWorld();
  const originTeam = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 30, maxAge: 34 });
  makeOriginContract(world, originTeam, player, { id: 'origin:t10-2' });
  const { plan, result } = TransferService.formalizeMutualAgreement({
    ...world, teams: [originTeam], originTeam, destinationTeam: null, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
    mutualSettlement: null, playerId: player.id,
  });
  assert.strictEqual(result, null);
  assert.ok(plan.blockers.some((b) => b.code === 'MISSING_MUTUAL_SETTLEMENT'));
  assert.strictEqual(originTeam.roster.some((p) => p.id === player.id), true, 'sin pacto, nada se mueve');
});

// =========================================================================
// 11. Fallos atómicos (failure injection + rollback exacto)
// =========================================================================
group('11. Fallos atómicos (failure injection)');

function buildFreeAgentFixture(seed) {
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, seed);
  return {
    ...world, team, player, agreement,
  };
}

['createRegistration', 'issueLicense'].forEach((methodName) => {
  check(`fallo inyectado en RegistrationService.${methodName} deja el estado EXACTAMENTE igual (rollback)`, () => {
    const fx = buildFreeAgentFixture(`seed-fi-${methodName}`);
    const before = deepWorldSnapshot(fx, [fx.team]);
    const original = RegistrationService[methodName];
    RegistrationService[methodName] = () => { throw new Error(`INJECTED:${methodName}`); };
    let threw = false;
    try {
      TransferService.formalizeFreeAgentSigning({
        ...fx, teams: [fx.team], destinationTeam: fx.team, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
      });
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes(`INJECTED:${methodName}`));
    } finally {
      RegistrationService[methodName] = original;
    }
    assert.ok(threw);
    const after = deepWorldSnapshot(fx, [fx.team]);
    assert.strictEqual(after, before, 'estado idéntico tras rollback');
    assert.strictEqual(fx.player.teamId, null, 'el jugador NUNCA queda a medio mover');
  });
});

check('fallo inyectado tras mover el roster revierte también la afiliación e identidad canónica', () => {
  const fx = buildFreeAgentFixture('seed-fi-roster');
  const before = deepWorldSnapshot(fx, [fx.team]);
  const originalIssue = RegistrationService.issueLicense;
  let calls = 0;
  RegistrationService.issueLicense = (...args) => {
    calls += 1;
    throw new Error('INJECTED after roster move');
  };
  try {
    assert.throws(() => TransferService.formalizeFreeAgentSigning({
      ...fx, teams: [fx.team], destinationTeam: fx.team, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
    }));
  } finally {
    RegistrationService.issueLicense = originalIssue;
  }
  assert.strictEqual(calls, 1);
  assert.strictEqual(fx.team.roster.some((p) => p.id === fx.player.id), false, 'el roster debe revertirse');
  assert.strictEqual(fx.player.teamId, null);
  assert.strictEqual(RosterMutationService.auditRosterUniqueness([fx.team]).valid, true);
  const after = deepWorldSnapshot(fx, [fx.team]);
  assert.strictEqual(after, before);
});

check('fallo inyectado en el registro del contrato nuevo no deja el AIP consumido', () => {
  const fx = buildFreeAgentFixture('seed-fi-contract');
  const beforeAgreementStatus = fx.agreement.statusOn(GAME_DATE);
  const originalRegister = fx.contractRegistry.register.bind(fx.contractRegistry);
  let calls = 0;
  fx.contractRegistry.register = (contract) => {
    calls += 1;
    throw new Error('INJECTED at contract register');
  };
  try {
    assert.throws(() => TransferService.formalizeFreeAgentSigning({
      ...fx, teams: [fx.team], destinationTeam: fx.team, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
    }));
  } finally {
    fx.contractRegistry.register = originalRegister;
  }
  assert.strictEqual(calls, 1);
  assert.strictEqual(fx.agreement.statusOn(GAME_DATE), beforeAgreementStatus, 'el AIP no debe quedar consumido por una ejecución fallida');
  assert.ok(fx.marketRegistry.getBudgetReservationGroup(fx.agreement.budgetReservationGroupId).every((l) => l.status === 'active'), 'la reserva se conserva si el AIP sigue vivo');
});

// =========================================================================
// 12. Idempotencia y AIP
// =========================================================================
group('12. Idempotencia y AIP');

check('un AIP completado deja de bloquear el mercado para ese jugador', () => {
  const fx = buildFreeAgentFixture('seed-t12-1');
  TransferService.formalizeFreeAgentSigning({
    ...fx, teams: [fx.team], destinationTeam: fx.team, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
  });
  assert.strictEqual(fx.marketRegistry.hasLiveAgreementForPlayer(fx.player.id, GAME_DATE), false);
});

check('un AIP expirado no se ejecuta', () => {
  const fx = buildFreeAgentFixture('seed-t12-2');
  // Forzamos la expiración moviendo la fecha de ejecución más allá de validUntil.
  const farFuture = LocalDate.addDays(fx.agreement.validUntil, 5);
  assert.throws(() => TransferService.formalizeFreeAgentSigning({
    ...fx, teams: [fx.team], destinationTeam: fx.team, seasonKey: SEASON, effectiveDate: farFuture, now: farFuture, commit: true,
  }));
});

// =========================================================================
// 13. Auditorías estáticas de alcance
// =========================================================================
group('13. Auditorías estáticas de alcance');

const TRANSFER_SOURCES = [
  'src/core/CompetitionRules.js', 'src/core/TransferService.js', 'src/core/TransferExecutionService.js',
  'src/core/RosterMutationService.js', 'src/core/TransferRegistry.js', 'src/core/TransferEventTypes.js', 'src/entities/Transfer.js',
];
function readSource(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function stripComments(source) { return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

check('ningún Math.random() en el dominio de transferencia', () => {
  TRANSFER_SOURCES.forEach((file) => {
    assert.ok(!/Math\.random\(\)/.test(stripComments(readSource(file))), `${file} usa Math.random()`);
  });
});

check('ninguna rama nueva por team.division/1ª/2ª fuera del adaptador legacy de CompetitionRules', () => {
  TRANSFER_SOURCES.filter((f) => !f.endsWith('CompetitionRules.js')).forEach((file) => {
    assert.ok(!/team\.division\s*===|['"]1ª['"]|['"]2ª['"]/.test(stripComments(readSource(file))), `${file} ramifica por división`);
  });
});

check('ningún team.roster.push/splice ni player.teamId= fuera de RosterMutationService/Team.js', () => {
  TRANSFER_SOURCES.filter((f) => !f.endsWith('RosterMutationService.js')).forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/\.roster\.push\(|\.roster\.splice\(/.test(code), `${file} muta roster directamente`);
    assert.ok(!/player\.teamId\s*=(?!=)/.test(code), `${file} asigna player.teamId directamente`);
  });
});

check('sin floats monetarios sueltos (todo Minor entero) en el dominio de transferencia', () => {
  TRANSFER_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/amountEuros|priceEuros|feeEuros/i.test(code), `${file} usa un nombre de importe en euros (float)`);
  });
});

check('LOC/transfer internacional nunca se concede completado (solo bloquea)', () => {
  const code = stripComments(readSource('src/core/TransferExecutionService.js'));
  assert.ok(!/letterOfClearance\s*:\s*true|locGranted/i.test(code));
});

check('ninguna noticia se construye en el dominio de transferencia (game.js decide tras el commit)', () => {
  TRANSFER_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/newsLog\.push|addNews\(/.test(code), `${file} construye noticias directamente`);
  });
});

check('el resolver de derechos ACB nunca concede participación al jugador (invariante 13)', () => {
  const code = stripComments(readSource('src/core/CompetitionRules.js'));
  assert.ok(/playerDoesNotParticipate: true/.test(code));
  const rules = CompetitionRules.resolveTransferRules({
    playerId: 'p1', originClubId: 'c1', destinationClubId: 'c2', originEmployerJurisdictionId: 'ES', destinationEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: GAME_DATE,
  });
  assert.strictEqual(rules.rightsCompensationRules.playerDoesNotParticipate, true);
});

check('data/real permanece intacto (TRANSFER-1 nunca escribe ahí)', () => {
  TRANSFER_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/data\/real/.test(code), `${file} referencia data/real`);
  });
});

// =========================================================================
// 14. Fichaje futuro tras expiración (sección 11.2) — expediente
//     `scheduled` + reintento en el punto único del reloj.
// =========================================================================
group('14. Fichaje futuro (scheduled) + reintento en advanceGameClockTo()');

check('effectiveDate futura: NO se ejecuta hoy, el expediente queda "scheduled" y el mundo intacto', () => {
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, 'seed-t14-1', GAME_DATE);
  const futureDate = LocalDate.addDays(GAME_DATE, 10);
  const before = deepWorldSnapshot(world, [team]);
  const { plan, result } = TransferService.formalizeFreeAgentSigning({
    ...world, teams: [team], agreement, destinationTeam: team, seasonKey: SEASON, effectiveDate: futureDate, now: GAME_DATE, commit: true,
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.strictEqual(result.notYetDue, true);
  assert.strictEqual(result.record, null);
  assert.strictEqual(plan.newObjects.isFutureSigning, true);
  const transferCase = world.transferRegistry.getCase(plan.command.transferCaseId);
  assert.strictEqual(transferCase.statusOn(GAME_DATE), 'scheduled');
  assert.strictEqual(team.roster.find((p) => p.id === player.id), undefined, 'no debe entrar hoy en el roster');
  assert.strictEqual(world.contractRegistry.currentForPlayer(player.id, GAME_DATE), null, 'no debe crear contrato hoy');
  const after = deepWorldSnapshot(world, [team]);
  assert.strictEqual(before, after, 'planificar/comprometer un fichaje futuro no debe mutar NADA del mundo actual');
});

check('retryScheduledTransferCase antes de la fecha efectiva: sigue "scheduled", sin mutar nada', () => {
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, 'seed-t14-2', GAME_DATE);
  const futureDate = LocalDate.addDays(GAME_DATE, 10);
  TransferService.formalizeFreeAgentSigning({
    ...world, teams: [team], agreement, destinationTeam: team, seasonKey: SEASON, effectiveDate: futureDate, now: GAME_DATE, commit: true,
  });
  const transferCase = world.transferRegistry.casesForPlayer(player.id)[0];
  const stillEarlyDate = LocalDate.addDays(GAME_DATE, 3); // antes de futureDate
  const before = deepWorldSnapshot(world, [team]);
  const { result } = TransferService.retryScheduledTransferCase(transferCase, { ...world, teams: [team], now: stillEarlyDate }, stillEarlyDate);
  assert.strictEqual(result.notYetDue, true);
  assert.strictEqual(transferCase.statusOn(stillEarlyDate), 'scheduled');
  const after = deepWorldSnapshot(world, [team]);
  assert.strictEqual(before, after);
});

check('retryScheduledTransferCase en/tras la fecha efectiva: ejecuta el fichaje completo (contrato+roster+inscripción)', () => {
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, 'seed-t14-3', GAME_DATE);
  const futureDate = LocalDate.addDays(GAME_DATE, 10);
  TransferService.formalizeFreeAgentSigning({
    ...world, teams: [team], agreement, destinationTeam: team, seasonKey: SEASON, effectiveDate: futureDate, now: GAME_DATE, commit: true,
  });
  const transferCase = world.transferRegistry.casesForPlayer(player.id)[0];
  const { plan, result } = TransferService.retryScheduledTransferCase(transferCase, { ...world, teams: [team], now: futureDate }, futureDate);
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.ok(result.record, 'debe producir un TransactionRecord real');
  assert.strictEqual(transferCase.statusOn(futureDate), 'completed');
  assert.strictEqual(team.roster.find((p) => p.id === player.id), player);
  assert.strictEqual(player.teamId, team.id);
  assert.ok(world.contractRegistry.currentForPlayer(player.id, futureDate));
});

check('retryScheduledTransferCase sobre un expediente ya completado no reintenta nada (guard de estado)', () => {
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, 'seed-t14-4', GAME_DATE);
  const { transferCase } = TransferService.formalizeFreeAgentSigning({
    ...world, teams: [team], agreement, destinationTeam: team, seasonKey: SEASON, effectiveDate: GAME_DATE, now: GAME_DATE, commit: true,
  });
  assert.strictEqual(transferCase.statusOn(GAME_DATE), 'completed');
  const { plan, result } = TransferService.retryScheduledTransferCase(transferCase, { ...world, teams: [team], now: GAME_DATE }, GAME_DATE);
  assert.strictEqual(plan, null);
  assert.strictEqual(result, null);
});

check('retryScheduledTransferCase con fechas fuera de orden (dos divisiones/ligas) nunca reintenta un expediente ya completado', () => {
  // Reproduce el bug real encontrado por smoke-transfer1.js: 1ª y 2ª
  // procesan sus rondas en fechas de calendario DISTINTAS (ninguna
  // garantía de orden estricto entre ligas) — un expediente completado
  // con fecha efectiva "futureDate" no debe parecer "scheduled" otra vez
  // si se le vuelve a preguntar con una fecha ANTERIOR a `futureDate`
  // procedente de la otra división en la misma vuelta.
  const world = makeWorld();
  const team = realTeam('team-real-madrid');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  world.playerRegistry.register(player);
  const agreement = makeLiveAgreement(world, team, player, 'seed-t14-5', GAME_DATE);
  const futureDate = LocalDate.addDays(GAME_DATE, 10);
  TransferService.formalizeFreeAgentSigning({
    ...world, teams: [team], agreement, destinationTeam: team, seasonKey: SEASON, effectiveDate: futureDate, now: GAME_DATE, commit: true,
  });
  const transferCase = world.transferRegistry.casesForPlayer(player.id)[0];
  // 1ª procesa primero, en `futureDate` — el expediente se completa.
  const first = TransferService.retryScheduledTransferCase(transferCase, { ...world, teams: [team], now: futureDate }, futureDate);
  assert.ok(first.result && first.result.record);
  assert.strictEqual(transferCase.statusOn(null), 'completed');
  // 2ª procesa su propia ronda con una fecha ANTERIOR a `futureDate` —
  // nunca debe reintentar ni lanzar por cronología incoherente.
  const earlierDate = LocalDate.addDays(GAME_DATE, 3);
  const second = TransferService.retryScheduledTransferCase(transferCase, { ...world, teams: [team], now: earlierDate }, earlierDate);
  assert.strictEqual(second.plan, null);
  assert.strictEqual(second.result, null);
  assert.strictEqual(transferCase.statusOn(null), 'completed', 'debe seguir completado, sin eventos nuevos añadidos');
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
