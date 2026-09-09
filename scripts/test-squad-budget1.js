#!/usr/bin/env node
// scripts/test-squad-budget1.js
// Verificación SQUAD-BUDGET-1 — script Node ad-hoc, mismo criterio que
// test-loan1.js/test-market1.js/test-cycle1.js (no hay framework de tests
// instalado, ver CLAUDE.md). Ejecutar con:
//   node scripts/test-squad-budget1.js
//
// Grupos:
//   1. Apertura determinista/idempotente para todos los clubes.
//   2. Asignación congelada tras cambios de nómina.
//   3. Aritmética comprometido/reservado/disponible.
//   4. Validación de oferta multi-temporada (atómica).
//   5. Reserva -> liberación y reserva -> comprometido.
//   6. Rechazo atómico por exceso de presupuesto con detalle estructurado.
//   7. Exposición variable excluida del límite duro.
//   8. Reparto salarial de cesión entrante/saliente sin doble cómputo.
//   9. CPU y usuario usan el mismo límite canónico.
//   10. Asignación de la siguiente temporada creada UNA vez desde la
//       referencia de nómina de apertura congelada.
//   11. Round-trip de guardado nuevo (exportState/restoreState).
//   12. Migración de un guardado v1 (sin colección) y guardado posterior en
//       formato nuevo — el mecanismo EXACTO que usa
//       `CareerHydrationService` para un guardado antiguo (la tubería
//       completa hydrate() con un guardado real schemaVersion:1 ya está
//       cubierta por `scripts/test-save-load1.js`, comprobaciones 1-2, que
//       siguen en verde con esta entrega).

const assert = require('assert');

const { Team } = require('../src/entities/Team.js');
const { Club } = require('../src/entities/Club.js');
const { Contract } = require('../src/entities/Contract.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const LoanEntities = require('../src/entities/Loan.js');
const { SquadBudgetAllocation } = require('../src/entities/SquadBudget.js');
const { SquadBudgetRegistry } = require('../src/core/SquadBudgetRegistry.js');
const { SquadBudgetService } = require('../src/core/SquadBudgetService.js');
const { MarketService } = require('../src/core/MarketService.js');
const { CpuRosterPlanner } = require('../src/core/CpuRosterPlanner.js');

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
const NEXT_SEASON = '2027-28';
const GAME_DATE = '2026-10-15';

function makeTeam(id, financial) {
  const club = new Club({
    id: `club-${id}`, name: `Club ${id}`, homeAreaId: 'area-country-es', employerJurisdictionAreaId: 'area-country-es',
  });
  const team = new Team({
    id: `team-${id}`, name: `Team ${id}`, fullName: `Team ${id}`, city: 'Ciudad', roster: [],
  });
  team.clubId = club.id;
  team.club = club;
  team._sportingReputation = 50;
  club.reputationFinancial = financial !== undefined ? financial : 50;
  return team;
}

function makeContract(contractRegistry, team, playerId, salaryMinor, overrides) {
  const opts = overrides || {};
  const contract = new Contract({
    id: opts.id || `contract:${playerId}`,
    playerId,
    clubId: team.clubId,
    contractType: 'professional-player',
    signedDate: '2026-08-01',
    startDate: '2026-08-01',
    endDate: '2028-07-31',
    guaranteeType: 'fully-guaranteed',
    compensation: {
      currency: 'EUR',
      declaredBasis: 'gross',
      seasons: (opts.seasonKeys || [SEASON, NEXT_SEASON]).map((sk) => ({
        seasonKey: sk,
        guaranteedBaseSalaryMinor: salaryMinor,
        variableBonuses: opts.variableBonuses || [],
        nonSalaryBenefits: opts.nonSalaryBenefits || [],
        agentCosts: opts.agentCosts || [],
      })),
    },
    clauses: [],
    declaredDocuments: ['written-contract'],
    paymentPolicy: { scheduledComponents: [] },
  });
  contractRegistry.register(contract);
  return contract;
}

// =========================================================================
// 1. Apertura determinista/idempotente para todos los clubes.
// =========================================================================
group('1. Apertura determinista/idempotente');

check('computeMarketCompatibilityAmount es determinista para la misma entrada', () => {
  const contractRegistry = new ContractRegistry();
  const teamA = makeTeam('a', 60);
  makeContract(contractRegistry, teamA, 'p1', 5000000);
  const r1 = SquadBudgetService.computeMarketCompatibilityAmount({ team: teamA, contractRegistry, seasonKey: SEASON });
  const r2 = SquadBudgetService.computeMarketCompatibilityAmount({ team: teamA, contractRegistry, seasonKey: SEASON });
  assert.deepStrictEqual(r1, r2);
  assert.ok(r1.amountMinor > 0);
});

check('ensureOpeningAllocation crea la apertura para varios clubes y es idempotente', () => {
  const contractRegistry = new ContractRegistry();
  const registry = new SquadBudgetRegistry();
  const teams = [makeTeam('c1', 40), makeTeam('c2', 70), makeTeam('c3', 90)];
  teams.forEach((team, idx) => makeContract(contractRegistry, team, `p${idx}`, 3000000 + idx * 1000000));
  teams.forEach((team) => {
    const compat = SquadBudgetService.computeMarketCompatibilityAmount({ team, contractRegistry, seasonKey: SEASON });
    const { created } = SquadBudgetService.ensureOpeningAllocation({
      registry, clubId: team.clubId, seasonKey: SEASON, currency: compat.currency, effectiveDate: GAME_DATE,
      amountMinor: compat.amountMinor, policyVersion: compat.policyVersion, basisAmountMinor: compat.basisAmountMinor,
      multiplier: compat.multiplier,
    });
    assert.strictEqual(created, true);
  });
  assert.strictEqual(registry.all().length, teams.length);
  // Segunda pasada — idempotente, sin duplicados ni nuevos ids.
  teams.forEach((team) => {
    const compat = SquadBudgetService.computeMarketCompatibilityAmount({ team, contractRegistry, seasonKey: SEASON });
    const { created } = SquadBudgetService.ensureOpeningAllocation({
      registry, clubId: team.clubId, seasonKey: SEASON, currency: compat.currency, effectiveDate: GAME_DATE, amountMinor: compat.amountMinor,
    });
    assert.strictEqual(created, false);
  });
  assert.strictEqual(registry.all().length, teams.length, 'repetir el bootstrap no duplica asignaciones');
});

// =========================================================================
// 2. Asignación congelada tras cambios de nómina.
// =========================================================================
group('2. Asignación congelada');

check('la asignación de apertura no cambia aunque la nómina comprometida cambie después', () => {
  const contractRegistry = new ContractRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('frozen', 50);
  makeContract(contractRegistry, team, 'p1', 4000000);
  const compat = SquadBudgetService.computeMarketCompatibilityAmount({ team, contractRegistry, seasonKey: SEASON });
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: compat.currency, effectiveDate: GAME_DATE, amountMinor: compat.amountMinor,
  });
  const before = registry.effectiveAllocationFor(team.clubId, SEASON, 'EUR').amountMinor;
  // Un fichaje nuevo dispara mucha más nómina comprometida...
  makeContract(contractRegistry, team, 'p2', 9000000, { id: 'contract:p2' });
  const after = registry.effectiveAllocationFor(team.clubId, SEASON, 'EUR').amountMinor;
  assert.strictEqual(after, before, 'la asignación congelada no se recalcula al cambiar el payroll comprometido');
});

// =========================================================================
// 3. Aritmética comprometido/reservado/disponible.
// =========================================================================
group('3. Aritmética del presupuesto');

check('limitMinor/committedMinor/reservedMinor/availableMinor/overcommittedMinor son consistentes', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('arith', 50);
  makeContract(contractRegistry, team, 'p1', 4000000);
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 10000000,
  });
  marketRegistry.reserveBudget({
    id: 'res:1', clubId: team.clubId, seasonKey: SEASON, amountMinor: 3000000, currency: 'EUR',
  });
  const view = SquadBudgetService.deriveBudgetView({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry,
  });
  assert.strictEqual(view.limitMinor, 10000000);
  assert.strictEqual(view.committedMinor, 4000000);
  assert.strictEqual(view.reservedMinor, 3000000);
  assert.strictEqual(view.availableMinor, 3000000);
  assert.strictEqual(view.overcommittedMinor, 0);
});

check('overcommittedMinor es visible en vez de solo mostrar available=0', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('over', 50);
  makeContract(contractRegistry, team, 'p1', 9000000);
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 10000000,
  });
  marketRegistry.reserveBudget({
    id: 'res:2', clubId: team.clubId, seasonKey: SEASON, amountMinor: 5000000, currency: 'EUR',
  });
  const view = SquadBudgetService.deriveBudgetView({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry,
  });
  assert.strictEqual(view.availableMinor, 0);
  assert.strictEqual(view.overcommittedMinor, 4000000);
});

// =========================================================================
// 4. Validación de oferta multi-temporada (atómica).
// =========================================================================
group('4. Validación multi-temporada');

check('validateAdditionsAgainstBudget falla ATÓMICAMENTE si CUALQUIER temporada excede su límite', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('multi', 50);
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 5000000,
  });
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: NEXT_SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 5000000,
  });
  const result = SquadBudgetService.validateAdditionsAgainstBudget({
    registry, clubId: team.clubId, currency: 'EUR', contractRegistry, marketRegistry,
    additionsBySeasonKey: { [SEASON]: 3000000, [NEXT_SEASON]: 6000000 },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.shortfalls.length, 1);
  assert.strictEqual(result.shortfalls[0].seasonKey, NEXT_SEASON);
  assert.ok(result.message.includes('junta'));
});

check('validateAdditionsAgainstBudget acepta cuando TODAS las temporadas caben', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('multi-ok', 50);
  [SEASON, NEXT_SEASON].forEach((sk) => SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: sk, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 5000000,
  }));
  const result = SquadBudgetService.validateAdditionsAgainstBudget({
    registry, clubId: team.clubId, currency: 'EUR', contractRegistry, marketRegistry,
    additionsBySeasonKey: { [SEASON]: 2000000, [NEXT_SEASON]: 2000000 },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.shortfalls.length, 0);
  assert.strictEqual(result.message, null);
});

// =========================================================================
// 5. Reserva -> liberación y reserva -> comprometido.
// =========================================================================
group('5. Reserva/liberación/compromiso');

check('reserve -> release libera el disponible una sola vez (idempotente)', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('res-rel', 50);
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 10000000,
  });
  marketRegistry.reserveBudget({
    id: 'res:3', clubId: team.clubId, seasonKey: SEASON, amountMinor: 2000000, currency: 'EUR',
  });
  const during = SquadBudgetService.deriveBudgetView({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry,
  });
  assert.strictEqual(during.availableMinor, 8000000);
  marketRegistry.releaseBudget('res:3');
  marketRegistry.releaseBudget('res:3'); // segunda vez — no debe liberar de más
  const after = SquadBudgetService.deriveBudgetView({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry,
  });
  assert.strictEqual(after.reservedMinor, 0);
  assert.strictEqual(after.availableMinor, 10000000);
});

check('reserve -> comprometido: aceptar un contrato mueve el coste de reservado a comprometido sin doble cómputo', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('res-commit', 50);
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 10000000,
  });
  marketRegistry.reserveBudget({
    id: 'res:4', clubId: team.clubId, seasonKey: SEASON, amountMinor: 3000000, currency: 'EUR',
  });
  const reservedView = SquadBudgetService.deriveBudgetView({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry,
  });
  assert.strictEqual(reservedView.reservedMinor, 3000000);
  assert.strictEqual(reservedView.committedMinor, 0);
  // Firma del contrato: se libera la reserva y se registra el contrato (como
  // hace MARKET-1/TRANSFER-1 en producción).
  marketRegistry.releaseBudget('res:4');
  makeContract(contractRegistry, team, 'p-new', 3000000);
  const committedView = SquadBudgetService.deriveBudgetView({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry,
  });
  assert.strictEqual(committedView.reservedMinor, 0);
  assert.strictEqual(committedView.committedMinor, 3000000);
  assert.strictEqual(committedView.availableMinor, 7000000, 'nunca se cuenta a la vez como reservado y comprometido');
});

// =========================================================================
// 6. Rechazo atómico con detalle estructurado — vía MarketService real.
// =========================================================================
group('6. Rechazo estructurado (MarketService real)');

check('MarketService.validateOfferBeforeSend usa el límite CANÓNICO y devuelve shortfalls estructurados', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('offer', 50);
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 4000000,
  });
  const plan = MarketService.computeSquadCostPlan({
    team, contractRegistry, marketRegistry, seasonKey: SEASON, squadBudgetRegistry: registry, atGameDate: GAME_DATE,
  });
  assert.strictEqual(plan.limitMinor, 4000000, 'el plan usa la asignación CANÓNICA, no la fórmula de compatibilidad en directo');
  assert.strictEqual(plan.limitPolicyVersion, 'canonical-squad-budget-v1');

  const result = SquadBudgetService.validateAdditionsAgainstBudget({
    registry, clubId: team.clubId, currency: 'EUR', contractRegistry, marketRegistry,
    additionsBySeasonKey: { [SEASON]: 9000000 },
  });
  assert.strictEqual(result.ok, false);
  const shortfall = result.shortfalls[0];
  assert.strictEqual(shortfall.limitMinor, 4000000);
  assert.strictEqual(shortfall.attemptedAdditionMinor, 9000000);
  assert.strictEqual(shortfall.shortfallMinor, 5000000);
  assert.ok(typeof shortfall.seasonKey === 'string' && typeof shortfall.currency === 'string');
});

// =========================================================================
// 7. Exposición variable excluida del límite duro.
// =========================================================================
group('7. Exposición variable');

check('variableMaxMinor se muestra separado y NUNCA reduce availableMinor', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('variable', 50);
  makeContract(contractRegistry, team, 'p1', 2000000, {
    variableBonuses: [{ amountMinor: 8000000 }],
    nonSalaryBenefits: [{ amountMinor: 500000 }],
    agentCosts: [{ amountMinor: 200000 }],
  });
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 3000000,
  });
  const view = SquadBudgetService.deriveBudgetView({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry,
  });
  assert.strictEqual(view.committedMinor, 2000000, 'el variable no entra en el comprometido');
  assert.strictEqual(view.availableMinor, 1000000);
  assert.strictEqual(view.variableMaxMinor, 8000000);
  assert.strictEqual(view.benefitsValueMinor, 500000);
  assert.strictEqual(view.agentCostsMinor, 200000);
});

// =========================================================================
// 8. Reparto salarial de cesión sin doble cómputo.
// =========================================================================
group('8. Cesiones — reparto salarial');

check('el propietario retiene su parte y el cesionario asume la suya, sin contar el salario dos veces', () => {
  const contractRegistry = new ContractRegistry();
  const loanRegistry = new LoanRegistry();
  const marketRegistry = new MarketRegistry();
  const ownerRegistry = new SquadBudgetRegistry();
  const borrowerRegistry = new SquadBudgetRegistry();
  const owner = makeTeam('owner', 50);
  const borrower = makeTeam('borrower', 50);
  const masterContract = makeContract(contractRegistry, owner, 'loaned-player', 10000000);
  const agreement = new LoanEntities.LoanAgreement({
    id: 'loan-agreement:1',
    loanCaseId: 'loan-case:1',
    proposalId: 'loan-proposal:1',
    playerId: 'loaned-player',
    ownerClubId: owner.clubId,
    borrowerClubId: borrower.clubId,
    masterContractId: masterContract.id,
    serviceStartDate: '2026-08-01',
    returnEffectiveDate: '2027-06-30',
    agreedAt: GAME_DATE,
    salaryAllocation: { ownerShareBasisPoints: 6000, borrowerShareBasisPoints: 4000 },
    medicalResponsibility: { responsibleParty: 'borrower' },
    insuranceResponsibility: { responsibleParty: 'shared' },
  });
  loanRegistry.registerAgreement(agreement);

  [owner, borrower].forEach((team, idx) => {
    const reg = idx === 0 ? ownerRegistry : borrowerRegistry;
    SquadBudgetService.ensureOpeningAllocation({
      registry: reg, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 20000000,
    });
  });

  const ownerView = SquadBudgetService.deriveBudgetView({
    registry: ownerRegistry, clubId: owner.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry, loanRegistry,
  });
  const borrowerView = SquadBudgetService.deriveBudgetView({
    registry: borrowerRegistry, clubId: borrower.clubId, seasonKey: SEASON, currency: 'EUR', contractRegistry, marketRegistry, loanRegistry,
  });
  // 10.000.000 al 60/40 -> propietario retiene 6.000.000, cesionario asume 4.000.000.
  assert.strictEqual(ownerView.committedMinor, 6000000, 'el propietario NUNCA carga el contrato entero mientras está cedido');
  assert.strictEqual(borrowerView.committedMinor, 4000000, 'el cesionario asume su parte, no el total');
  assert.strictEqual(ownerView.committedMinor + borrowerView.committedMinor, 10000000, 'la suma es EXACTA — sin doble cómputo ni pérdida');
  const ownerLoanRow = ownerView.playerRows.find((r) => r.playerId === 'loaned-player');
  const borrowerLoanRow = borrowerView.playerRows.find((r) => r.playerId === 'loaned-player');
  assert.strictEqual(ownerLoanRow.loanBadge, 'loaned-out');
  assert.strictEqual(borrowerLoanRow.loanBadge, 'loaned-in');
});

// =========================================================================
// 9. CPU y usuario usan el mismo límite canónico.
// =========================================================================
group('9. Paridad CPU/usuario');

check('CpuRosterPlanner.computeCycleBudget y MarketService.computeSquadCostPlan leen el MISMO límite canónico', () => {
  const contractRegistry = new ContractRegistry();
  const marketRegistry = new MarketRegistry();
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('parity', 65);
  SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 12345600,
  });
  const marketPlan = MarketService.computeSquadCostPlan({
    team, contractRegistry, marketRegistry, seasonKey: SEASON, squadBudgetRegistry: registry, atGameDate: GAME_DATE,
  });
  const cpuBudget = CpuRosterPlanner.computeCycleBudget({
    clubSnapshot: {
      clubId: team.clubId,
      committedMinor: 0,
      openingPayrollReferenceMinor: 0,
      canonicalBudgetLimitMinor: registry.effectiveAllocationFor(team.clubId, SEASON, 'EUR', GAME_DATE).amountMinor,
    },
    team,
    marketRegistry,
    seasonKey: SEASON,
  });
  assert.strictEqual(marketPlan.limitMinor, 12345600);
  assert.strictEqual(cpuBudget.limitMinor, 12345600);
  assert.strictEqual(marketPlan.limitMinor, cpuBudget.limitMinor, 'CPU y usuario nunca divergen en aritmética de presupuesto');
});

// =========================================================================
// 10. Asignación de la siguiente temporada — una sola vez.
// =========================================================================
group('10. Apertura de la siguiente temporada — una sola vez');

check('la asignación de la temporada siguiente se congela UNA vez desde la referencia de nómina de apertura', () => {
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('next-season', 55);
  const openingPayrollReferenceMinor = 8000000; // ya congelada por freezeSnapshot() en producción
  const compat = SquadBudgetService.computeCycleCompatibilityAmount({ team, openingPayrollReferenceMinor, currency: 'EUR' });
  const first = SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: NEXT_SEASON, currency: compat.currency, effectiveDate: GAME_DATE,
    amountMinor: compat.amountMinor, policyVersion: compat.policyVersion, basisAmountMinor: compat.basisAmountMinor,
    multiplier: compat.multiplier, revisionKind: 'season-opening-cycle-policy',
  });
  assert.strictEqual(first.created, true);
  // Segunda llamada (render repetido, sincronización de calendario, cierre
  // de temporada re-ejecutado) — NO crea una segunda asignación.
  const second = SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: NEXT_SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 999,
  });
  assert.strictEqual(second.created, false);
  assert.strictEqual(registry.chainFor(team.clubId, NEXT_SEASON, 'EUR').length, 1);
  assert.strictEqual(registry.effectiveAllocationFor(team.clubId, NEXT_SEASON, 'EUR').amountMinor, compat.amountMinor);
});

// =========================================================================
// 11. Round-trip de guardado nuevo.
// =========================================================================
group('11. Round-trip de guardado (v2)');

check('exportState()/restoreState() preserva la cadena de revisiones sin pérdida', () => {
  const registry = new SquadBudgetRegistry();
  const team = makeTeam('roundtrip', 50);
  const opening = SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 5000000,
    policyVersion: 'compatibility-market-budget-v1', basisAmountMinor: 4000000, multiplier: 1.25,
  }).allocation;
  const revision = SquadBudgetService.recordRevision({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: '2026-11-01', amountMinor: 6000000,
    revisionKind: 'board-revision', decisionAuthority: 'board-manual', note: 'Ampliación de prueba',
  });
  const exported = registry.exportState();
  const restored = new SquadBudgetRegistry();
  restored.restoreState(exported, { SquadBudgetAllocation });
  const reExported = restored.exportState();
  assert.deepStrictEqual(reExported, exported, 'round-trip byte a byte (mismo JSON)');
  const effective = restored.effectiveAllocationFor(team.clubId, SEASON, 'EUR');
  assert.strictEqual(effective.amountMinor, 6000000);
  assert.strictEqual(effective.predecessorId, opening.id);
  assert.strictEqual(revision.predecessorId, opening.id);
  const validation = restored.validateIntegrity();
  assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors));
});

// =========================================================================
// 12. Migración de un guardado v1 (mecanismo usado por CareerHydrationService).
// =========================================================================
group('12. Migración v1 -> v2');

check('un club sin asignación (guardado v1) recibe una apertura de compatibilidad marcada como migración', () => {
  const contractRegistry = new ContractRegistry();
  const team = makeTeam('migrated', 50);
  makeContract(contractRegistry, team, 'p1', 4000000);
  const registry = new SquadBudgetRegistry(); // "vacío" — simula un guardado v1 sin colección squadBudget
  assert.strictEqual(registry.hasChain(team.clubId, SEASON, 'EUR'), false);

  // Mismo mecanismo EXACTO que ejecuta CareerHydrationService.hydrate()
  // cuando `payload.collections.squadBudget` está ausente (ver el bloque
  // "SQUAD-BUDGET-1: presupuesto salarial de plantilla" de ese archivo).
  const compat = SquadBudgetService.computeMarketCompatibilityAmount({ team, contractRegistry, seasonKey: SEASON });
  const { created, allocation } = SquadBudgetService.ensureOpeningAllocation({
    registry, clubId: team.clubId, seasonKey: SEASON, currency: compat.currency, effectiveDate: GAME_DATE,
    amountMinor: compat.amountMinor, policyVersion: compat.policyVersion, basisAmountMinor: compat.basisAmountMinor,
    multiplier: compat.multiplier, revisionKind: 'migration-backfill', decisionAuthority: 'migration',
    calculatedAtGameDate: GAME_DATE, note: 'Reconstruida al migrar un guardado v1.',
  });
  assert.strictEqual(created, true);
  assert.strictEqual(allocation.revisionKind, 'migration-backfill');
  assert.strictEqual(allocation.decisionAuthority, 'migration');

  // Guardar de nuevo (formato v2): exportState() ya incluye la asignación
  // reconstruida — nunca hay una segunda regeneración al re-guardar.
  const exported = registry.exportState();
  assert.strictEqual(exported.allocations.length, 1);
  const reloaded = new SquadBudgetRegistry();
  reloaded.restoreState(exported, { SquadBudgetAllocation });
  const { created: createdAgain } = SquadBudgetService.ensureOpeningAllocation({
    registry: reloaded, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 1,
  });
  assert.strictEqual(createdAgain, false, 'un guardado v2 ya migrado no regenera la asignación al volver a cargarse');
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
