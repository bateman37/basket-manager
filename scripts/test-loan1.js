#!/usr/bin/env node
// scripts/test-loan1.js
// Verificación LOAN-1 (DESIGN.md 9.21) — script Node ad-hoc, mismo criterio
// que test-transfer1.js/test-market1.js/test-reg1.js/test-contract1.js/
// test-roster1.js (no hay framework de tests instalado, ver CLAUDE.md).
// Ejecutar con:
//   node scripts/test-loan1.js
//
// Grupos (sección 24 del prompt de LOAN-1):
//   1. Reglas (dominio `loan` multi-liga).
//   2. Entidades/Registry.
//   3. Fechas (sección 7).
//   4. Contrato/inscripción (base laboral temporal).
//   5. Dinero (reparto, 15%, exposición).
//   6. Cláusulas.
//   7. Ejecución atómica (activación/retorno/rollback/idempotencia/stale).
//   8. Auditorías estáticas.
// Los bugs BUG-TRANSFER1-13..19 (motor compartido) tienen su reproducción y
// regresión completas en scripts/test-transfer1.js (sección 15) — LOAN-1
// reutiliza el MISMO motor ya corregido (RosterMutationService/
// OperationalReferenceService/CanonicalHash/replan-at-commit/
// operationalContext obligatorio), así que aquí se verifica que
// LoanExecutionService hereda esas mismas garantías, no se duplica la
// reproducción de los 7 bugs originales.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Team } = require('../src/entities/Team.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const { LoanService } = require('../src/core/LoanService.js');
const { LoanExecutionService } = require('../src/core/LoanExecutionService.js');
const { LoanCostService } = require('../src/core/LoanCostService.js');
const { RosterMutationService } = require('../src/core/RosterMutationService.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { Contract } = require('../src/entities/Contract.js');
const LoanEntities = require('../src/entities/Loan.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const PlayerGenerator = require('../src/utils/playerGenerator.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');
const EligibilityService = require('../src/core/EligibilityService.js').EligibilityService;

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
const GAME_DATE = '2026-10-15';
const SERVICE_START = '2026-10-20';
const RETURN_DATE = '2027-07-31';

function realTeam(id) { return new Team({ ...REAL_DATA_TEAMS[id], roster: [] }); }

function makeWorld() {
  const playerRegistry = new PlayerRegistry();
  const contractRegistry = new ContractRegistry();
  const registrationRegistry = new RegistrationRegistry();
  const transferRegistry = new TransferRegistry();
  const loanRegistry = new LoanRegistry();
  return {
    playerRegistry, contractRegistry, registrationRegistry, transferRegistry, loanRegistry,
    operationalContext: { pendingUserMatchBlocks: false },
  };
}

function makeMasterContract(world, ownerTeam, player, overrides) {
  const opts = overrides || {};
  const contract = new Contract({
    id: opts.id || `mc:${player.id}`,
    playerId: player.id,
    clubId: ownerTeam.id,
    contractType: 'professional-player',
    // CYCLE-1 (BUG-CYCLE1-06): ventana civil de temporada 1-ago .. 31-jul
    // (LocalDate.seasonWindow) — mismo contrato de 2025-26 a 2027-28.
    signedDate: opts.signedDate || '2025-08-01',
    startDate: opts.startDate || '2025-08-01',
    endDate: opts.endDate || '2028-07-31',
    guaranteeType: 'fully-guaranteed',
    compensation: {
      currency: 'EUR',
      declaredBasis: 'gross',
      seasons: (opts.seasonKeys || ['2025-26', SEASON, '2027-28']).map((sk) => ({ seasonKey: sk, guaranteedBaseSalaryMinor: opts.salaryMinor || 10000000 })),
    },
    clauses: [],
    declaredDocuments: ['written-contract'],
    paymentPolicy: { scheduledComponents: [] },
  });
  world.contractRegistry.register(contract);
  ownerTeam.roster.push(player);
  player.teamId = ownerTeam.id;
  world.playerRegistry.register(player);
  return contract;
}

function fullyNegotiatedFixture(seedSuffix, overrides) {
  const opts = overrides || {};
  const world = makeWorld();
  const ownerTeam = realTeam(opts.ownerTeamId || 'team-real-madrid');
  const borrowerTeam = realTeam(opts.borrowerTeamId || 'team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 20, maxAge: 23 });
  const masterContract = makeMasterContract(world, ownerTeam, player, { id: `mc:${seedSuffix}` });
  const { loanCase, proposal, resolvedRules } = LoanService.openCaseAndPropose({
    loanRegistry: world.loanRegistry, contractRegistry: world.contractRegistry, ownerTeam, borrowerTeam,
    playerId: player.id, initiatingClubId: ownerTeam.id, now: GAME_DATE, seasonKey: SEASON,
    serviceStartDate: SERVICE_START, returnEffectiveDate: RETURN_DATE,
    loanFee: opts.loanFee !== undefined ? opts.loanFee : { amountMinor: 2000000, currency: 'EUR' },
    salaryAllocation: opts.salaryAllocation || { ownerShareBasisPoints: 6000, borrowerShareBasisPoints: 4000 },
    clauses: opts.clauses || [],
    medicalResponsibility: { responsibleParty: 'borrower' },
    insuranceResponsibility: { responsibleParty: 'shared' },
    documentsRequired: [],
    expiresAt: GAME_DATE,
    id: `loan-case:${seedSuffix}`,
  });
  ['ownerClub', 'borrowerClub', 'player'].forEach((partyType) => {
    LoanService.grantConsent({
      loanRegistry: world.loanRegistry, loanCase, partyType,
      partyId: partyType === 'ownerClub' ? ownerTeam.id : partyType === 'borrowerClub' ? borrowerTeam.id : player.id,
      now: GAME_DATE, grantedBy: partyType === 'player' ? player.id : 'gm',
    });
  });
  const agreement = LoanService.formAgreement({
    loanRegistry: world.loanRegistry, contractRegistry: world.contractRegistry, loanCase, now: GAME_DATE, resolvedRules,
  });
  return {
    world, ownerTeam, borrowerTeam, player, masterContract, loanCase, proposal, agreement, resolvedRules,
  };
}

function activateFixture(seedSuffix, overrides) {
  const fx = fullyNegotiatedFixture(seedSuffix, overrides);
  const teams = [fx.ownerTeam, fx.borrowerTeam];
  const { plan, result } = LoanService.activateLoan({
    loanRegistry: fx.world.loanRegistry, playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry,
    registrationRegistry: fx.world.registrationRegistry, transferRegistry: fx.world.transferRegistry, teams,
    agreement: fx.agreement, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, now: SERVICE_START, effectiveDate: SERVICE_START,
    seasonKey: SEASON, operationalContext: fx.world.operationalContext, commit: true,
  });
  return {
    ...fx, teams, activationPlan: plan, activationResult: result,
  };
}

// =========================================================================
// 1. Reglas (dominio `loan` multi-liga)
// =========================================================================
group('1. Reglas de cesión multi-liga');

check('España RD 1006 art. 11: consentimiento/subrogación/15% resueltos sin blockers', () => {
  const rules = CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'team-real-madrid', borrowerClubId: 'team-barca', ownerEmployerJurisdictionId: 'ES', borrowerEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: SERVICE_START, operation: 'activation',
  });
  assert.strictEqual(rules.blockers.length, 0, JSON.stringify(rules.blockers));
  assert.strictEqual(rules.ownerEmploymentLawRules.playerConsentRequired, true);
  assert.strictEqual(rules.ownerEmploymentLawRules.subrogationApplies, true);
  assert.strictEqual(rules.ownerEmploymentLawRules.playerParticipationOnFee.defaultMinimumPercentBasisPoints, 1500);
  assert.strictEqual(rules.ownerEmploymentLawRules.playerParticipationOnFee.overridableByExplicitPact, false, 'inderogable a la baja (art. 11.4)');
});

check('el 15% de cesión (art. 11.3) nunca se confunde con el 15% de traspaso (art. 13.a)', () => {
  const loanRules = CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'team-real-madrid', borrowerClubId: 'team-barca', ownerEmployerJurisdictionId: 'ES', borrowerEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: SERVICE_START, operation: 'activation',
  });
  assert.strictEqual(loanRules.ownerEmploymentLawRules.playerParticipationOnFee.sourceArticle, 'art. 11.3');
});

check('MoraBanc/Andorra: sin régimen de cesión sourceado, bloquea explícito (nunca ACB por defecto)', () => {
  const rules = CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'team-morabanc-andorra', borrowerClubId: 'team-barca', ownerEmployerJurisdictionId: 'AD', borrowerEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: SERVICE_START, operation: 'activation',
  });
  assert.ok(rules.blockers.some((b) => b.code === 'AD_NO_LOAN_REGIME_SOURCED'));
});

check('transactionScope international bloquea con REQUIRES_EUROPE_1, nunca se completa', () => {
  const rules = CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'team-real-madrid', borrowerClubId: 'team-barca', ownerEmployerJurisdictionId: 'ES', borrowerEmployerJurisdictionId: 'ES',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: SERVICE_START, operation: 'activation', transactionScope: 'international',
  });
  assert.ok(rules.blockers.some((b) => b.code === 'REQUIRES_EUROPE_1'));
});

check('federaciones distintas en origen/destino bloquean como internacional aunque transactionScope no se declare', () => {
  const rules = CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'team-real-madrid', borrowerClubId: 'team-x', ownerEmployerJurisdictionId: 'ES', borrowerEmployerJurisdictionId: 'FR',
    originCompetitionId: 'acb', destinationCompetitionId: 'acb', originFederationId: 'feb-general', destinationFederationId: 'fff-general',
    seasonKey: SEASON, effectiveDate: SERVICE_START, operation: 'activation',
  });
  assert.ok(rules.blockers.some((b) => b.code === 'REQUIRES_EUROPE_1'));
});

check('una jurisdicción laboral del propietario desconocida falla explícito (nunca España por defecto)', () => {
  assert.throws(() => CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'x', borrowerClubId: 'y', ownerEmployerJurisdictionId: 'ZZ', originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: SERVICE_START,
  }));
});

check('el módulo reference-only nunca se autoselecciona; solo se activa fijado explícitamente', () => {
  assert.throws(() => CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'x', borrowerClubId: 'y', ownerEmployerJurisdictionId: 'XX', originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: SERVICE_START,
  }));
  const pinned = CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'x', borrowerClubId: 'y', ownerEmployerJurisdictionId: 'XX', originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: SERVICE_START,
    pinnedModuleIds: ['bm-test-fictional-loan-employment-law-v1'],
  });
  assert.strictEqual(pinned.blockers.length, 0);
});

check('ACB y Primera FEB resuelven módulos administrativos DISTINTOS (nunca "1ª"/"2ª")', () => {
  const acb = CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'x', borrowerClubId: 'y', ownerEmployerJurisdictionId: 'ES', originCompetitionId: 'acb', destinationCompetitionId: 'acb', seasonKey: SEASON, effectiveDate: SERVICE_START,
  });
  const feb = CompetitionRules.resolveLoanRules({
    playerId: 'p1', ownerClubId: 'x', borrowerClubId: 'y', ownerEmployerJurisdictionId: 'ES', originCompetitionId: 'primera-feb', destinationCompetitionId: 'primera-feb', seasonKey: SEASON, effectiveDate: SERVICE_START,
  });
  assert.notStrictEqual(acb.destinationRegistrationRules, feb.destinationRegistrationRules);
});

check('toda regla del dominio loan declara fuente, versión y estado', () => {
  Object.values(CompetitionRules.LOAN_MODULES).forEach((mod) => {
    assert.ok(mod.version >= 1, mod.id);
    assert.ok(['verified', 'provisional', 'reference-only'].includes(mod.status), mod.id);
    if (mod.status !== 'reference-only') assert.ok(Array.isArray(mod.sourceRefs), mod.id);
  });
});

// =========================================================================
// 2. Entidades / Registry
// =========================================================================
group('2. Entidades y LoanRegistry');

check('LoanProposal: cambiar términos cambia termsHash (invalida aceptaciones previas)', () => {
  const world = makeWorld();
  const ownerTeam = realTeam('team-real-madrid');
  const borrowerTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 20, maxAge: 23 });
  makeMasterContract(world, ownerTeam, player, { id: 'mc:t2-1' });
  const { loanCase, proposal } = LoanService.openCaseAndPropose({
    loanRegistry: world.loanRegistry, contractRegistry: world.contractRegistry, ownerTeam, borrowerTeam, playerId: player.id, initiatingClubId: ownerTeam.id,
    now: GAME_DATE, seasonKey: SEASON, serviceStartDate: SERVICE_START, returnEffectiveDate: RETURN_DATE, loanFee: { amountMinor: 2000000, currency: 'EUR' },
    salaryAllocation: { ownerShareBasisPoints: 6000, borrowerShareBasisPoints: 4000 }, clauses: [],
    medicalResponsibility: { responsibleParty: 'borrower' }, insuranceResponsibility: { responsibleParty: 'shared' }, documentsRequired: [], expiresAt: GAME_DATE, id: 'loan-case:t2-1',
  });
  const proposal2 = LoanService.counterPropose({
    loanRegistry: world.loanRegistry, loanCase, authorClubId: borrowerTeam.id, now: GAME_DATE,
    serviceStartDate: SERVICE_START, returnEffectiveDate: RETURN_DATE, expiresAt: GAME_DATE,
    loanFee: { amountMinor: 3000000, currency: 'EUR' }, salaryAllocation: proposal.salaryAllocation, clauses: [],
    medicalResponsibility: proposal.medicalResponsibility, insuranceResponsibility: proposal.insuranceResponsibility, documentsRequired: [],
  });
  assert.notStrictEqual(proposal2.termsHash, proposal.termsHash);
});

check('una contraoferta NUNCA muta la propuesta anterior (versión nueva, inmutable)', () => {
  const world = makeWorld();
  const ownerTeam = realTeam('team-real-madrid');
  const borrowerTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 20, maxAge: 23 });
  makeMasterContract(world, ownerTeam, player, { id: 'mc:t2-2' });
  const { loanCase, proposal } = LoanService.openCaseAndPropose({
    loanRegistry: world.loanRegistry, contractRegistry: world.contractRegistry, ownerTeam, borrowerTeam, playerId: player.id, initiatingClubId: ownerTeam.id,
    now: GAME_DATE, seasonKey: SEASON, serviceStartDate: SERVICE_START, returnEffectiveDate: RETURN_DATE, loanFee: null,
    salaryAllocation: { ownerShareBasisPoints: 5000, borrowerShareBasisPoints: 5000 }, clauses: [],
    medicalResponsibility: { responsibleParty: 'owner' }, insuranceResponsibility: { responsibleParty: 'owner' }, documentsRequired: [], expiresAt: GAME_DATE, id: 'loan-case:t2-2',
  });
  const before = { id: proposal.id, version: proposal.version, termsHash: proposal.termsHash };
  LoanService.counterPropose({
    loanRegistry: world.loanRegistry, loanCase, authorClubId: borrowerTeam.id, now: GAME_DATE, serviceStartDate: SERVICE_START, returnEffectiveDate: RETURN_DATE, expiresAt: GAME_DATE,
    loanFee: { amountMinor: 1000000, currency: 'EUR' }, salaryAllocation: { ownerShareBasisPoints: 5000, borrowerShareBasisPoints: 5000 }, clauses: [],
    medicalResponsibility: { responsibleParty: 'owner' }, insuranceResponsibility: { responsibleParty: 'owner' }, documentsRequired: [],
  });
  assert.deepStrictEqual({ id: proposal.id, version: proposal.version, termsHash: proposal.termsHash }, before);
});

check('LoanRegistry: máximo una versión "viva" por expediente a la vez', () => {
  const fx = fullyNegotiatedFixture('t2-3');
  const live = fx.world.loanRegistry.liveProposalForCase(fx.loanCase.id, GAME_DATE);
  assert.strictEqual(live.id, fx.proposal.id);
});

check('LoanRegistry: unregisterCase/unregisterAgreement revierten los índices simétricamente', () => {
  const fx = activateFixture('t2-4');
  fx.world.loanRegistry.unregisterAgreement(fx.agreement.id);
  assert.strictEqual(fx.world.loanRegistry.getAgreement(fx.agreement.id), null);
  assert.strictEqual(fx.world.loanRegistry.agreementsForPlayer(fx.player.id).length, 0, 'índice _agreementsByPlayer debe quedar limpio');
  assert.strictEqual(fx.world.loanRegistry.agreementsForOwner(fx.ownerTeam.id).length, 0);
  fx.world.loanRegistry.unregisterCase(fx.loanCase.id);
  assert.strictEqual(fx.world.loanRegistry.getCase(fx.loanCase.id), null);
  assert.strictEqual(fx.world.loanRegistry.casesForPlayer(fx.player.id).length, 0);
});

check('LoanRegistry.validateIntegrity: expediente/acuerdo consistentes no arrojan errores', () => {
  const fx = activateFixture('t2-5');
  const report = fx.world.loanRegistry.validateIntegrity({
    playerRegistry: fx.world.playerRegistry, teams: fx.teams, contractRegistry: fx.world.contractRegistry, transferRegistry: fx.world.transferRegistry, date: SERVICE_START,
  });
  assert.strictEqual(report.valid, true, JSON.stringify(report.errors));
});

check('LoanRegistry.activeAgreementForPlayer: dos acuerdos activos a la vez para el mismo jugador es invariante rota', () => {
  const fx = activateFixture('t2-6');
  const dup = new LoanEntities.LoanAgreement({
    id: 'la-dup', loanCaseId: fx.loanCase.id, proposalId: fx.proposal.id, playerId: fx.player.id, ownerClubId: fx.ownerTeam.id, borrowerClubId: fx.borrowerTeam.id,
    masterContractId: fx.masterContract.id, serviceStartDate: SERVICE_START, returnEffectiveDate: RETURN_DATE, agreedAt: GAME_DATE,
    salaryAllocation: { ownerShareBasisPoints: 5000, borrowerShareBasisPoints: 5000 },
  });
  dup.outboundTransactionId = 'fake-tx';
  fx.world.loanRegistry.registerAgreement(dup);
  assert.throws(() => fx.world.loanRegistry.activeAgreementForPlayer(fx.player.id, SERVICE_START));
});

// =========================================================================
// 3. Fechas (sección 7 del prompt)
// =========================================================================
group('3. Fechas — intervalo semiabierto, límite del contrato, zero-day');

check('LoanProposal rechaza cesión de cero días (serviceStartDate === returnEffectiveDate)', () => {
  assert.throws(() => new LoanEntities.LoanProposal({
    id: 'p-zero', loanCaseId: 'lc', version: 1, authorClubId: 'x', createdAt: GAME_DATE, serviceStartDate: '2026-10-20', returnEffectiveDate: '2026-10-20', expiresAt: GAME_DATE,
    salaryAllocation: { ownerShareBasisPoints: 10000, borrowerShareBasisPoints: 0 },
  }));
});

check('openCaseAndPropose bloquea si returnEffectiveDate excede la vigencia del contrato matriz', () => {
  const world = makeWorld();
  const ownerTeam = realTeam('team-real-madrid');
  const borrowerTeam = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 20, maxAge: 23 });
  makeMasterContract(world, ownerTeam, player, { id: 'mc:t3-2', endDate: '2027-07-31', seasonKeys: ['2025-26', SEASON] });
  assert.throws(() => LoanService.openCaseAndPropose({
    loanRegistry: world.loanRegistry, contractRegistry: world.contractRegistry, ownerTeam, borrowerTeam, playerId: player.id, initiatingClubId: ownerTeam.id,
    now: GAME_DATE, seasonKey: SEASON, serviceStartDate: SERVICE_START, returnEffectiveDate: '2028-08-31', loanFee: null,
    salaryAllocation: { ownerShareBasisPoints: 5000, borrowerShareBasisPoints: 5000 }, clauses: [], medicalResponsibility: { responsibleParty: 'owner' },
    insuranceResponsibility: { responsibleParty: 'owner' }, documentsRequired: [], expiresAt: GAME_DATE,
  }), /vigencia del contrato matriz/);
});

check('el intervalo de servicio es semiabierto: activo en serviceStartDate, YA NO activo en returnEffectiveDate', () => {
  const fx = activateFixture('t3-3');
  assert.strictEqual(fx.agreement.isActiveOn(SERVICE_START), true);
  assert.strictEqual(fx.agreement.isActiveOn(RETURN_DATE), false, 'returnEffectiveDate es el primer día que YA NO presta servicio');
  assert.strictEqual(fx.agreement.isActiveOn(LocalDate.addDays(RETURN_DATE, -1)), true);
});

// =========================================================================
// 4. Contrato/inscripción — base laboral temporal
// =========================================================================
group('4. Contrato matriz e inscripción temporal');

check('durante la cesión: UN solo contrato activo, sigue siendo con el propietario, sin evento "terminated"', () => {
  const fx = activateFixture('t4-1');
  const current = fx.world.contractRegistry.currentForPlayer(fx.player.id, SERVICE_START);
  assert.strictEqual(current.id, fx.masterContract.id);
  assert.strictEqual(current.clubId, fx.ownerTeam.id);
  assert.strictEqual(current.statusOn(SERVICE_START), 'active');
  assert.strictEqual(fx.world.contractRegistry.forPlayer(fx.player.id).length, 1, 'nunca un segundo contrato con el cesionario');
});

check('ContractRegistry.validateIntegrity acepta contrato≠roster SOLO con un LoanAgreement activo que lo explique', () => {
  const fx = activateFixture('t4-2');
  const report = fx.world.contractRegistry.validateIntegrity({
    playerRegistry: fx.world.playerRegistry, teams: fx.teams, date: SERVICE_START, loanRegistry: fx.world.loanRegistry,
  });
  assert.strictEqual(report.valid, true, JSON.stringify(report.errors));
});

check('ContractRegistry.validateIntegrity SIGUE fallando ante un roster ajeno sin cesión real (nunca desactivada globalmente)', () => {
  const world = makeWorld();
  const teamA = realTeam('team-real-madrid');
  const teamB = realTeam('team-barca');
  const player = PlayerGenerator.generateFictionalPlayer({ minAge: 20, maxAge: 23 });
  makeMasterContract(world, teamA, player, { id: 'mc:t4-3' });
  // Mueve el jugador al roster de OTRO club sin ningún LoanAgreement real.
  teamA.roster = teamA.roster.filter((p) => p.id !== player.id);
  teamB.roster.push(player);
  player.teamId = teamB.id;
  const report = world.contractRegistry.validateIntegrity({
    playerRegistry: world.playerRegistry, teams: [teamA, teamB], date: GAME_DATE, loanRegistry: world.loanRegistry,
  });
  assert.strictEqual(report.valid, false);
});

check('inscripción del cesionario: employmentBasis "temporary-assignment" resuelto y verificable', () => {
  const fx = activateFixture('t4-4');
  const reg = fx.world.registrationRegistry.currentRegistration(fx.player.id, fx.activationResult.record ? undefined : undefined, SEASON, SERVICE_START)
    || fx.world.registrationRegistry.allRegistrations().find((r) => r.playerId === fx.player.id && r.teamId === fx.borrowerTeam.id);
  assert.ok(reg, 'debe existir una inscripción del cesionario');
  assert.strictEqual(reg.employmentBasis.type, 'temporary-assignment');
  assert.strictEqual(reg.employmentBasis.employerClubId, fx.ownerTeam.id);
  assert.strictEqual(reg.employmentBasis.serviceClubId, fx.borrowerTeam.id);
  assert.strictEqual(reg.employmentBasis.loanAgreementId, fx.agreement.id);
});

check('EligibilityService: el cedido es elegible por el CESIONARIO (base laboral temporal verificada)', () => {
  const fx = activateFixture('t4-5');
  const evalResult = EligibilityService.evaluateEligibility(fx.player.id, fx.borrowerTeam.id, {
    date: SERVICE_START, seasonKey: SEASON, competitionId: 'acb', phaseId: 'league',
  }, {
    playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry, registrationRegistry: fx.world.registrationRegistry,
  });
  assert.strictEqual(evalResult.eligible, true, JSON.stringify(evalResult.reasons));
});

check('el cedido NO aparece en el roster operativo del propietario (no elegible por él durante la cesión)', () => {
  const fx = activateFixture('t4-6');
  assert.strictEqual(fx.ownerTeam.roster.some((p) => p.id === fx.player.id), false);
});

// =========================================================================
// 5. Dinero — reparto, 15%, exposición, conceptos separados
// =========================================================================
group('5. Dinero — reparto/15%/exposición');

check('salaryAllocation exige suma EXACTA 10000 basis points', () => {
  assert.throws(() => LoanEntities.validateSalaryAllocation({ ownerShareBasisPoints: 6000, borrowerShareBasisPoints: 3000 }));
});

check('canon positivo (España): participación del jugador = 15% EXACTO del canon, nunca del salario', () => {
  const fx = fullyNegotiatedFixture('t5-2', { loanFee: { amountMinor: 4000000, currency: 'EUR' } });
  assert.strictEqual(fx.agreement.playerParticipation.amountMinor, Math.round(4000000 * 0.15));
});

check('cesión sin canon: NUNCA inventa participación positiva', () => {
  const fx = fullyNegotiatedFixture('t5-3', { loanFee: null });
  assert.strictEqual(fx.agreement.playerParticipation, null);
});

check('LoanCostService: el reparto salarial cuadra EXACTO al céntimo (Money.allocateByWeights)', () => {
  const fx = activateFixture('t5-4', { salaryAllocation: { ownerShareBasisPoints: 3333, borrowerShareBasisPoints: 6667 } });
  const exposure = LoanCostService.loanExposureForAgreement({ agreement: fx.agreement, masterContract: fx.masterContract, seasonKey: SEASON });
  const breakdown = fx.masterContract.breakdownForSeason(SEASON);
  assert.strictEqual(exposure.salary.ownerRetainedMinor + exposure.salary.borrowerAssumedMinor, breakdown.guaranteedTotalMinor);
});

check('canon y participación son obligaciones SEPARADAS, nunca sumadas', () => {
  const fx = activateFixture('t5-5', { loanFee: { amountMinor: 5000000, currency: 'EUR' } });
  const record = fx.world.transferRegistry.getTransactionRecord(fx.activationResult.record.id);
  const obligations = record.obligationIds.map((id) => fx.world.transferRegistry.getObligation(id));
  const fee = obligations.find((o) => o.concept === 'loan-fee');
  const participation = obligations.find((o) => o.concept === 'player-loan-participation');
  assert.ok(fee && participation && fee.id !== participation.id);
  assert.strictEqual(fee.amountMinor, 5000000);
  assert.strictEqual(participation.amountMinor, 750000);
});

check('LoanCostService.loanExposureForClub agrega retenido/asumido/canon por separado', () => {
  const fx = activateFixture('t5-6');
  const ownerExposure = LoanCostService.loanExposureForClub({
    clubId: fx.ownerTeam.id, loanRegistry: fx.world.loanRegistry, contractRegistry: fx.world.contractRegistry, seasonKey: SEASON, date: SERVICE_START,
  });
  assert.strictEqual(ownerExposure.loansOutCount, 1);
  assert.ok(ownerExposure.retainedFromLoansOutMinor > 0);
  const borrowerExposure = LoanCostService.loanExposureForClub({
    clubId: fx.borrowerTeam.id, loanRegistry: fx.world.loanRegistry, contractRegistry: fx.world.contractRegistry, seasonKey: SEASON, date: SERVICE_START,
  });
  assert.strictEqual(borrowerExposure.loansInCount, 1);
  assert.ok(borrowerExposure.assumedFromLoansInMinor > 0);
});

// =========================================================================
// 6. Cláusulas
// =========================================================================
group('6. Cláusulas tipadas');

check('un tipo de cláusula desconocido se rechaza (unión discriminada, nunca texto libre ejecutable)', () => {
  assert.throws(() => LoanEntities.validateLoanClause({ type: 'free-text-magic' }, 'test'));
});

check('recall-right exige ventana — sin cláusula, LoanExecutionService rechaza el recall', () => {
  const fx = activateFixture('t6-2');
  const teams = fx.teams;
  const command = {
    transactionId: 'tx-recall-t6-2', movementType: 'return', loanCaseId: fx.loanCase.id, loanAgreementId: fx.agreement.id, playerId: fx.player.id,
    fromClubId: fx.borrowerTeam.id, toClubId: fx.ownerTeam.id, effectiveDate: '2026-11-01', seasonKey: SEASON,
    ownerEmployerJurisdictionId: 'ES', borrowerEmployerJurisdictionId: 'ES', fromCompetitionId: 'acb', toCompetitionId: 'acb', transactionScope: 'domestic',
    recallClauseId: 'nonexistent-clause',
  };
  const deps = {
    playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry, registrationRegistry: fx.world.registrationRegistry,
    transferRegistry: fx.world.transferRegistry, loanRegistry: fx.world.loanRegistry, teams, operationalContext: fx.world.operationalContext,
  };
  const plan = LoanExecutionService.planTransaction(command, deps);
  assert.ok(plan.blockers.some((b) => b.code === 'RECALL_CLAUSE_NOT_FOUND'));
});

check('recall-right pactado y en ventana: el retorno anticipado se ejecuta atómico', () => {
  const fx = activateFixture('t6-3', {
    clauses: [{ type: 'recall-right', holderClubId: 'owner', windows: [{ startDate: '2026-11-01', endDate: '2026-11-30' }], noticeDays: 0 }],
  });
  const { plan, result } = LoanService.recallLoan({
    loanRegistry: fx.world.loanRegistry, playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry,
    registrationRegistry: fx.world.registrationRegistry, transferRegistry: fx.world.transferRegistry, teams: fx.teams,
    agreement: fx.agreement, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, now: '2026-11-10', effectiveDate: '2026-11-10', seasonKey: SEASON,
    operationalContext: fx.world.operationalContext, commit: true, recallClauseId: fx.agreement.clauses[0].id,
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.ok(result.record);
  assert.strictEqual(fx.agreement.currentStatus(), 'returned');
  assert.strictEqual(fx.ownerTeam.roster.some((p) => p.id === fx.player.id), true);
});

check('ejercer una opción de compra NUNCA mueve roster ni crea contrato', () => {
  const fx = activateFixture('t6-4', {
    clauses: [{
      type: 'purchase-option', beneficiaryClubId: 'borrower', price: { amountMinor: 15000000, currency: 'EUR' }, windowStart: SERVICE_START, windowEnd: RETURN_DATE,
    }],
  });
  const rosterBefore = fx.borrowerTeam.roster.map((p) => p.id);
  const contractCountBefore = fx.world.contractRegistry.forPlayer(fx.player.id).length;
  const exercise = LoanService.exercisePurchaseOption({
    loanRegistry: fx.world.loanRegistry, agreement: fx.agreement, clauseId: fx.agreement.clauses[0].id, exercisedAt: '2027-01-15',
  });
  assert.strictEqual(exercise.statusOn(null), 'notified');
  assert.deepStrictEqual(fx.borrowerTeam.roster.map((p) => p.id), rosterBefore);
  assert.strictEqual(fx.world.contractRegistry.forPlayer(fx.player.id).length, contractCountBefore);
  assert.strictEqual(fx.player.teamId, fx.borrowerTeam.id, 'sigue cedido, no traspasado');
});

check('parent-club-match-eligibility: prohíbe jugar contra el propietario con razón estable, usuario y CPU comparten el mismo servicio', () => {
  const fx = activateFixture('t6-5', {
    clauses: [{
      type: 'parent-club-match-eligibility', scope: 'competition', prohibited: true, reason: 'Cláusula pactada en la cesión',
    }],
  });
  const evalResult = EligibilityService.evaluateEligibility(fx.player.id, fx.borrowerTeam.id, {
    date: SERVICE_START, seasonKey: SEASON, competitionId: 'acb', phaseId: 'league', opponentClubId: fx.ownerTeam.id,
  }, {
    playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry, registrationRegistry: fx.world.registrationRegistry, loanRegistry: fx.world.loanRegistry,
  });
  assert.strictEqual(evalResult.eligible, false);
  assert.ok(evalResult.reasons.some((r) => r.code === 'PARENT_CLUB_MATCH_RESTRICTED'));
  const evalVsOther = EligibilityService.evaluateEligibility(fx.player.id, fx.borrowerTeam.id, {
    date: SERVICE_START, seasonKey: SEASON, competitionId: 'acb', phaseId: 'league', opponentClubId: 'team-unicaja',
  }, {
    playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry, registrationRegistry: fx.world.registrationRegistry, loanRegistry: fx.world.loanRegistry,
  });
  assert.strictEqual(evalVsOther.eligible, true, JSON.stringify(evalVsOther.reasons));
});

check('rol/minutos prometidos son promesas NO ejecutables (nunca fuerzan Rotation/MatchEngine)', () => {
  const clause = LoanEntities.validateLoanClause({ type: 'promised-role', roleDescription: 'Titular indiscutible' }, 'test');
  assert.strictEqual(clause.executable, false);
});

// =========================================================================
// 7. Ejecución atómica
// =========================================================================
group('7. Ejecución atómica — activación/retorno/rollback/idempotencia/stale');

check('activación: misma instancia de Player, roster/teamId/inscripción coherentes de una vez', () => {
  const fx = activateFixture('t7-1');
  assert.strictEqual(fx.activationPlan.blockers.length, 0, JSON.stringify(fx.activationPlan.blockers));
  assert.ok(fx.activationResult.record);
  assert.strictEqual(fx.world.playerRegistry.get(fx.player.id), fx.player, 'misma instancia');
  assert.strictEqual(fx.player.teamId, fx.borrowerTeam.id);
});

check('repetir el mismo comando de activación (transactionId) es idempotente — no duplica nada', () => {
  const fx = activateFixture('t7-2');
  const command = fx.activationPlan.command;
  const deps = {
    playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry, registrationRegistry: fx.world.registrationRegistry,
    transferRegistry: fx.world.transferRegistry, loanRegistry: fx.world.loanRegistry, teams: fx.teams, operationalContext: fx.world.operationalContext,
  };
  const plan2 = LoanExecutionService.planTransaction(command, deps);
  const result2 = LoanExecutionService.commitTransaction(plan2, deps);
  assert.strictEqual(result2.idempotent, true);
  assert.strictEqual(result2.record.id, fx.activationResult.record.id);
  assert.strictEqual(fx.borrowerTeam.roster.filter((p) => p.id === fx.player.id).length, 1, 'nunca duplica la afiliación');
});

check('un plan de activación obsoleto (roster de destino cambió de CONTENIDO) se rechaza, nunca se ejecuta a ciegas', () => {
  const fx = fullyNegotiatedFixture('t7-3');
  const teams = [fx.ownerTeam, fx.borrowerTeam];
  const rulesCtx = LoanService.buildLoanRulesContext({
    playerId: fx.player.id, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, seasonKey: SEASON, effectiveDate: SERVICE_START, returnEffectiveDate: RETURN_DATE, operation: 'activation',
  });
  const toRegistration = require('../src/core/TransferService.js').TransferService.buildDestinationRegistrationCommand({
    destinationTeam: fx.borrowerTeam, seasonKey: SEASON, date: SERVICE_START, registrationRegistry: fx.world.registrationRegistry,
  });
  const command = {
    transactionId: 'tx-stale-t7-3', movementType: 'activation', loanCaseId: fx.loanCase.id, loanAgreementId: fx.agreement.id, playerId: fx.player.id,
    fromClubId: fx.ownerTeam.id, toClubId: fx.borrowerTeam.id, effectiveDate: SERVICE_START, seasonKey: SEASON,
    ownerEmployerJurisdictionId: rulesCtx.ownerEmployerJurisdictionId, borrowerEmployerJurisdictionId: rulesCtx.borrowerEmployerJurisdictionId,
    fromCompetitionId: rulesCtx.originCompetitionId, toCompetitionId: rulesCtx.destinationCompetitionId, transactionScope: 'domestic',
    fromRegistrationScopeId: require('../src/core/TransferService.js').TransferService.resolveOriginRegistrationScope(fx.ownerTeam, SEASON, SERVICE_START),
    toRegistration,
    obligations: fx.agreement.loanFee ? [{
      concept: 'loan-fee', debtorType: 'club', debtorId: fx.borrowerTeam.id, creditorType: 'club', creditorId: fx.ownerTeam.id, amountMinor: fx.agreement.loanFee.amountMinor, currency: fx.agreement.loanFee.currency, legalSource: { ruleModuleId: 'loan-agreement', article: null },
    }] : [],
  };
  const deps = {
    playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry, registrationRegistry: fx.world.registrationRegistry,
    transferRegistry: fx.world.transferRegistry, loanRegistry: fx.world.loanRegistry, teams, operationalContext: fx.world.operationalContext,
  };
  const plan = LoanExecutionService.planTransaction(command, deps);
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  // Sustituye, AL MISMO TAMAÑO, un jugador del roster de destino.
  const extra = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  fx.borrowerTeam.roster.push(extra);
  extra.teamId = fx.borrowerTeam.id;
  fx.world.playerRegistry.register(extra);
  const replacement = PlayerGenerator.generateFictionalPlayer({ minAge: 24, maxAge: 28 });
  fx.borrowerTeam.roster = fx.borrowerTeam.roster.filter((p) => p.id !== extra.id);
  fx.borrowerTeam.roster.push(replacement);
  replacement.teamId = fx.borrowerTeam.id;
  fx.world.playerRegistry.register(replacement);
  assert.throws(
    () => LoanExecutionService.commitTransaction(plan, deps),
    (err) => err.code === 'PLAN_STALE_CONTENT',
  );
});

check('partido del usuario pendiente bloquea la activación (operationalContext obligatorio)', () => {
  const fx = fullyNegotiatedFixture('t7-4');
  const teams = [fx.ownerTeam, fx.borrowerTeam];
  const { plan } = LoanService.activateLoan({
    loanRegistry: fx.world.loanRegistry, playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry,
    registrationRegistry: fx.world.registrationRegistry, transferRegistry: fx.world.transferRegistry, teams,
    agreement: fx.agreement, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, now: SERVICE_START, effectiveDate: SERVICE_START, seasonKey: SEASON,
    operationalContext: { pendingUserMatchBlocks: true }, commit: true,
  });
  assert.ok(plan.blockers.some((b) => b.code === 'PENDING_USER_MATCH'));
});

check('un fallo inyectado durante la activación revierte roster/inscripción/afiliación EXACTAMENTE', () => {
  const fx = fullyNegotiatedFixture('t7-5');
  const teams = [fx.ownerTeam, fx.borrowerTeam];
  const original = RegistrationService.issueLicense;
  RegistrationService.issueLicense = () => { throw new Error('INJECTED'); };
  let threw = false;
  try {
    LoanService.activateLoan({
      loanRegistry: fx.world.loanRegistry, playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry,
      registrationRegistry: fx.world.registrationRegistry, transferRegistry: fx.world.transferRegistry, teams,
      agreement: fx.agreement, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, now: SERVICE_START, effectiveDate: SERVICE_START, seasonKey: SEASON,
      operationalContext: fx.world.operationalContext, commit: true,
    });
  } catch (err) { threw = true; assert.ok(err.message.includes('INJECTED')); } finally { RegistrationService.issueLicense = original; }
  assert.ok(threw);
  assert.strictEqual(fx.ownerTeam.roster.some((p) => p.id === fx.player.id), true, 'rollback: sigue en el propietario');
  assert.strictEqual(fx.borrowerTeam.roster.some((p) => p.id === fx.player.id), false);
  assert.strictEqual(fx.player.teamId, fx.ownerTeam.id);
  assert.strictEqual(fx.agreement.currentStatus(), 'agreed', 'el acuerdo no debe quedar activo');
  assert.strictEqual(RosterMutationService.auditRosterUniqueness(teams).valid, true);
});

check('retorno programado: recibo reutiliza TransactionRecord (mechanism "loan-return"), agreement queda "returned"', () => {
  const fx = activateFixture('t7-6');
  const { plan, result } = LoanService.returnLoan({
    loanRegistry: fx.world.loanRegistry, playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry,
    registrationRegistry: fx.world.registrationRegistry, transferRegistry: fx.world.transferRegistry, teams: fx.teams,
    agreement: fx.agreement, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, now: RETURN_DATE, effectiveDate: RETURN_DATE, seasonKey: SEASON,
    operationalContext: fx.world.operationalContext, commit: true,
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.strictEqual(result.record.mechanism, 'loan-return');
  assert.strictEqual(fx.agreement.currentStatus(), 'returned');
  assert.strictEqual(fx.ownerTeam.roster.some((p) => p.id === fx.player.id), true);
  assert.strictEqual(fx.player.teamId, fx.ownerTeam.id);
});

check('retorno con alta del propietario bloqueada: "returned-pending-registration" — roster SÍ vuelve, nunca se queda en el cesionario', () => {
  const fx = activateFixture('t7-7');
  const original = RegistrationService.issueLicense;
  RegistrationService.issueLicense = () => { throw new Error('INJECTED registration failure'); };
  let result;
  try {
    ({ result } = LoanService.returnLoan({
      loanRegistry: fx.world.loanRegistry, playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry,
      registrationRegistry: fx.world.registrationRegistry, transferRegistry: fx.world.transferRegistry, teams: fx.teams,
      agreement: fx.agreement, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, now: RETURN_DATE, effectiveDate: RETURN_DATE, seasonKey: SEASON,
      operationalContext: fx.world.operationalContext, commit: true,
    }));
  } finally { RegistrationService.issueLicense = original; }
  assert.strictEqual(result.registrationOutcome, 'pending-registration');
  assert.ok(result.record, 'el movimiento roster/baja SÍ es atómico, aunque el alta del propietario falle');
  assert.strictEqual(fx.ownerTeam.roster.some((p) => p.id === fx.player.id), true);
  assert.strictEqual(fx.borrowerTeam.roster.some((p) => p.id === fx.player.id), false);
  assert.strictEqual(fx.agreement.currentStatus(), 'returned');
});

check('terminación anticipada exige cláusula/consentimiento — sin base, bloquea', () => {
  const fx = activateFixture('t7-8');
  const { plan } = LoanService.earlyTerminateLoan({
    loanRegistry: fx.world.loanRegistry, playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry,
    registrationRegistry: fx.world.registrationRegistry, transferRegistry: fx.world.transferRegistry, teams: fx.teams,
    agreement: fx.agreement, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, now: '2026-12-01', effectiveDate: '2026-12-01', seasonKey: SEASON,
    operationalContext: fx.world.operationalContext, commit: true, earlyTerminationConsents: [],
  });
  assert.ok(plan.blockers.some((b) => b.code === 'MISSING_EARLY_TERMINATION_BASIS'));
});

check('terminación anticipada con consentimiento mutuo explícito de las tres partes: ejecuta y marca terminatedEarly', () => {
  const fx = activateFixture('t7-9');
  const { plan, result } = LoanService.earlyTerminateLoan({
    loanRegistry: fx.world.loanRegistry, playerRegistry: fx.world.playerRegistry, contractRegistry: fx.world.contractRegistry,
    registrationRegistry: fx.world.registrationRegistry, transferRegistry: fx.world.transferRegistry, teams: fx.teams,
    agreement: fx.agreement, ownerTeam: fx.ownerTeam, borrowerTeam: fx.borrowerTeam, now: '2026-12-01', effectiveDate: '2026-12-01', seasonKey: SEASON,
    operationalContext: fx.world.operationalContext, commit: true, earlyTerminationConsents: ['ownerClub', 'borrowerClub', 'player'],
  });
  assert.strictEqual(plan.blockers.length, 0, JSON.stringify(plan.blockers));
  assert.ok(result.record);
  assert.strictEqual(fx.agreement.currentStatus(), 'terminatedEarly');
  assert.strictEqual(fx.ownerTeam.roster.some((p) => p.id === fx.player.id), true);
});

// =========================================================================
// 8. Auditorías estáticas
// =========================================================================
group('8. Auditorías estáticas de alcance');

const LOAN_SOURCES = [
  'src/core/CompetitionRules.js', 'src/core/LoanEventTypes.js', 'src/entities/Loan.js', 'src/core/LoanRegistry.js',
  'src/core/LoanService.js', 'src/core/LoanExecutionService.js', 'src/core/LoanCostService.js',
];
function readSource(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function stripComments(source) { return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

check('ningún Math.random()/Date.now()/new Date() en el core de loan', () => {
  ['src/core/LoanService.js', 'src/core/LoanExecutionService.js', 'src/core/LoanRegistry.js', 'src/core/LoanCostService.js', 'src/entities/Loan.js', 'src/core/LoanEventTypes.js'].forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/Math\.random\(\)/.test(code), `${file} usa Math.random()`);
    assert.ok(!/Date\.now\(\)/.test(code), `${file} usa Date.now()`);
    assert.ok(!/new Date\(\)/.test(code), `${file} usa new Date()`);
  });
});

check('LoanExecutionService/LoanService nunca tocan mapas privados de un registry (_xxx) desde fuera', () => {
  ['src/core/LoanExecutionService.js', 'src/core/LoanService.js'].forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/(loanRegistry|contractRegistry|registrationRegistry|transferRegistry)\._[a-zA-Z]/.test(code), `${file} toca un mapa privado de un registry`);
  });
});

check('ningún team.roster.push/splice ni player.teamId= fuera de RosterMutationService/Team.js', () => {
  LOAN_SOURCES.filter((f) => !f.includes('CompetitionRules.js')).forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/team\.roster\.(push|splice)/.test(code), `${file} muta team.roster directamente`);
    assert.ok(!/player\.teamId\s*=/.test(code), `${file} asigna player.teamId directamente`);
  });
});

check('el dominio de cesión nunca publica noticias (game.js decide tras el commit)', () => {
  ['src/core/LoanExecutionService.js', 'src/core/LoanService.js'].forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/pushNews|pushLoanNews/.test(code), `${file} publica una noticia desde el dominio`);
  });
});

check('data/real permanece intacto (LOAN-1 nunca escribe ahí)', () => {
  LOAN_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/data\/real/.test(code), `${file} referencia data/real`);
  });
});

check('no hay "hasTanteo"/booleanos de cesión prohibidos (player.isLoaned y equivalentes)', () => {
  LOAN_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/player\.isLoaned/.test(code), `${file} usa player.isLoaned`);
  });
});

check('ninguna rama nueva por team.division/1ª/2ª fuera del adaptador legacy de CompetitionRules', () => {
  LOAN_SOURCES.filter((f) => !f.endsWith('CompetitionRules.js')).forEach((file) => {
    assert.ok(!/team\.division\s*===|['"]1ª['"]|['"]2ª['"]/.test(stripComments(readSource(file))), `${file} ramifica por división`);
  });
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
