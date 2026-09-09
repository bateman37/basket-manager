#!/usr/bin/env node
// scripts/test-economy-board1.js
// Verificación ECONOMY-BOARD-1 — script Node ad-hoc, mismo criterio que
// test-squad-budget1.js/test-loan1.js (no hay framework de tests
// instalado, ver CLAUDE.md). Ejecutar con:
//   node scripts/test-economy-board1.js
//
// Grupos (sección 15 del prompt de la Epic):
//   1. Semilla determinista de arquetipo/estilo fiscal.
//   2. Asignación exacta de categorías del plan + caja de apertura.
//   3. Tesorería derivada + resolución idempotente de un item fechado.
//   4. Ingreso mensual, un recibo de taquilla por matchId, pago salarial.
//   5. Liquidación atómica club-a-club.
//   6. Caja insuficiente -> impago -> liquidación posterior, sin negativos.
//   7. Proyección estable a 3 temporadas.
//   8. Asignación salarial futura canónica (forward-board-allocation).
//   9. Capacidad financiera dura bajo restricciones de caja/resultado/impago.
//   10. Empleo del manager y las 3 dimensiones de confianza.
//   11. Retraso de respuesta 1/2/3 días, una pendiente/cooldown compartido.
//   12. Decisión determinista total/parcial/rechazada con razones.
//   13. Revisiones multi-temporada atómicas, sin oferta persistida.
//   14. Calendario — sincronización repetida sin duplicar resolución.
//   15. Round-trip v3 + mecanismo de migración v1/v2 (sin impagos retroactivos).

const assert = require('assert');

const { Team } = require('../src/entities/Team.js');
const { Club } = require('../src/entities/Club.js');
const { Contract } = require('../src/entities/Contract.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const TransferEntities = require('../src/entities/Transfer.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { SquadBudgetAllocation } = require('../src/entities/SquadBudget.js');
const { SquadBudgetRegistry } = require('../src/core/SquadBudgetRegistry.js');
const { SquadBudgetService } = require('../src/core/SquadBudgetService.js');
const ClubFinanceEntities = require('../src/entities/ClubFinance.js');
const { ClubFinanceRegistry } = require('../src/core/ClubFinanceRegistry.js');
const { ClubFinanceService } = require('../src/core/ClubFinanceService.js');
const { FinancialCapacityService } = require('../src/core/FinancialCapacityService.js');
const ManagerBoardEntities = require('../src/entities/ManagerBoard.js');
const { ManagerBoardRegistry } = require('../src/core/ManagerBoardRegistry.js');
const { ManagerEmploymentService } = require('../src/core/ManagerEmploymentService.js');
const { BoardConfidenceService } = require('../src/core/BoardConfidenceService.js');
const BoardBudgetRequestEntities = require('../src/entities/BoardBudgetRequest.js');
const { BoardBudgetRequestRegistry } = require('../src/core/BoardBudgetRequestRegistry.js');
const { BoardBudgetRequestService } = require('../src/core/BoardBudgetRequestService.js');
const { WorldCalendar } = require('../src/core/WorldCalendar.js');
const { WorldCalendarCoordinator } = require('../src/core/WorldCalendarCoordinator.js');
const { Money } = require('../src/utils/Money.js');
const { LocalDate } = require('../src/utils/LocalDate.js');

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
const SEASON_2 = '2027-28';
const SEASON_3 = '2028-29';
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
    id: opts.id || `contract:${team.clubId}:${playerId}`,
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
      seasons: (opts.seasonKeys || [SEASON, SEASON_2]).map((sk) => ({
        seasonKey: sk,
        guaranteedBaseSalaryMinor: salaryMinor,
        variableBonuses: [],
        nonSalaryBenefits: [],
        agentCosts: [],
      })),
    },
    clauses: [],
    declaredDocuments: ['written-contract'],
    paymentPolicy: { scheduledComponents: [] },
  });
  contractRegistry.register(contract);
  return contract;
}

// Perfil + plan de apertura mínimos para un club, sin pasar por el hash de
// arquetipo (determinismo directo para las pruebas de aritmética).
function openClubFinance(params) {
  const {
    registry, squadBudgetRegistry, clubId, archetype, salaryAnchorMinor, expectedHomeGames,
  } = params;
  SquadBudgetService.ensureOpeningAllocation({
    registry: squadBudgetRegistry, clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE,
    amountMinor: salaryAnchorMinor, policyVersion: 'compatibility-market-budget-v1', basisAmountMinor: salaryAnchorMinor, multiplier: 1,
  });
  ClubFinanceService.ensureClubProfile({
    registry, clubId, currency: 'EUR', archetype, careerSeed: 'test-seed', calculatedAtGameDate: GAME_DATE,
  });
  return ClubFinanceService.buildSeasonPlan({
    registry, squadBudgetRegistry, clubId, seasonKey: SEASON, currency: 'EUR', calculatedAtGameDate: GAME_DATE,
    expectedHomeGames: expectedHomeGames || 17, isCareerOpening: true,
  }).plan;
}

// =========================================================================
group('1. Semilla determinista de arquetipo/estilo fiscal');
// =========================================================================

check('assignArchetypes reparte los 3 arquetipos entre 3 clubes, de forma determinista', () => {
  const clubIds = ['club-x', 'club-y', 'club-z'];
  const first = ClubFinanceService.assignArchetypes(clubIds, 'seed-A');
  const second = ClubFinanceService.assignArchetypes(clubIds, 'seed-A');
  clubIds.forEach((id) => assert.strictEqual(first.get(id), second.get(id), `misma semilla -> mismo arquetipo para ${id}`));
  const archetypesUsed = new Set(clubIds.map((id) => first.get(id)));
  assert.strictEqual(archetypesUsed.size, 3, 'con 3 clubes deben aparecer los 3 arquetipos (round-robin acotado)');
});

check('una semilla distinta puede repartir los arquetipos de otra forma (no siempre el mismo club->arquetipo)', () => {
  const clubIds = ['club-x', 'club-y', 'club-z'];
  const a = ClubFinanceService.assignArchetypes(clubIds, 'seed-A');
  const b = ClubFinanceService.assignArchetypes(clubIds, 'seed-B');
  const identical = clubIds.every((id) => a.get(id) === b.get(id));
  assert.strictEqual(identical, false, 'dos semillas distintas no deberían producir SIEMPRE el mismo reparto');
});

check('assignFiscalStyles es determinista y con 3 clubes cubre los 3 estilos', () => {
  const clubIds = ['club-x', 'club-y', 'club-z'];
  const styles = BoardConfidenceService.assignFiscalStyles(clubIds, 'seed-A');
  const stylesUsed = new Set(clubIds.map((id) => styles.get(id)));
  assert.strictEqual(stylesUsed.size, 3);
});

check('ClubFinanceProfile registra provenance simulada versionada', () => {
  const registry = new ClubFinanceRegistry();
  const { profile, created } = ClubFinanceService.ensureClubProfile({
    registry, clubId: 'club-p', currency: 'EUR', archetype: 'balanced', careerSeed: 'seed-A', calculatedAtGameDate: GAME_DATE,
  });
  assert.strictEqual(created, true);
  assert.strictEqual(profile.provenance.dataSource, 'simulated-club-finance-v1');
  assert.strictEqual(profile.provenance.isReal, false);
  const again = ClubFinanceService.ensureClubProfile({
    registry, clubId: 'club-p', currency: 'EUR', archetype: 'tight', careerSeed: 'seed-A', calculatedAtGameDate: GAME_DATE,
  });
  assert.strictEqual(again.created, false, 'idempotente — no reasigna arquetipo ya fijado');
  assert.strictEqual(again.profile.archetype, 'balanced');
});

// =========================================================================
group('2. Asignación exacta de categorías del plan + caja de apertura');
// =========================================================================

check('las categorías de ingreso suman EXACTAMENTE el ingreso planificado (balanced)', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  const plan = openClubFinance({
    registry, squadBudgetRegistry, clubId: 'club-bal', archetype: 'balanced', salaryAnchorMinor: 52000000, expectedHomeGames: 17,
  });
  assert.strictEqual(plan.salaryAnchorMinor, 52000000);
  // salaryShareBp balanced = 5200 -> plannedIncome = 52000000 * 10000/5200
  assert.strictEqual(plan.plannedIncomeMinor, Math.round((52000000 * 10000) / 5200));
  const incomeSum = Object.values(plan.incomeByCategoryMinor).reduce((a, b) => a + b, 0);
  assert.strictEqual(incomeSum, plan.plannedIncomeMinor, 'Money.allocateByWeights no pierde ni inventa céntimos');
  const nonSalarySum = plan.expenseByCategoryMinor.coachingStaffAggregate + plan.expenseByCategoryMinor.facilitiesMaintenance + plan.expenseByCategoryMinor.clubOperations;
  assert.strictEqual(nonSalarySum, plan.nonSalaryExpensePoolMinor);
  assert.strictEqual(plan.expenseByCategoryMinor.playerSalaries, plan.salaryAnchorMinor);
});

check('caja de apertura usa el colchón de meses del arquetipo, solo en el plan de apertura de carrera', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  const plan = openClubFinance({
    registry, squadBudgetRegistry, clubId: 'club-tight', archetype: 'tight', salaryAnchorMinor: 30000000, expectedHomeGames: 17,
  });
  const totalPlannedOutflow = plan.salaryAnchorMinor + plan.nonSalaryExpensePoolMinor;
  assert.strictEqual(plan.openingCashMinor, Math.round((totalPlannedOutflow * 2) / 12), 'tight = 2 meses de colchón');
  const balance = registry.treasuryBalance('club-tight', 'EUR');
  assert.strictEqual(balance, plan.openingCashMinor, 'la posting de apertura es la única fuente de la tesorería inicial');

  // Un segundo plan (apertura de temporada normal) NUNCA vuelve a sumar el colchón.
  const secondPlan = ClubFinanceService.buildSeasonPlan({
    registry, squadBudgetRegistry, clubId: 'club-tight', seasonKey: SEASON_2, currency: 'EUR', calculatedAtGameDate: GAME_DATE,
    expectedHomeGames: 17, isCareerOpening: false,
  }).plan;
  assert.strictEqual(secondPlan.openingCashMinor, null);
  assert.strictEqual(registry.treasuryBalance('club-tight', 'EUR'), plan.openingCashMinor, 'abrir otra temporada no añade una segunda posting de apertura');
});

// =========================================================================
group('3. Tesorería derivada + resolución idempotente');
// =========================================================================

check('resolver el mismo item fechado dos veces no duplica la posting ni la tesorería', () => {
  const registry = new ClubFinanceRegistry();
  const item = new ClubFinanceEntities.ScheduledCashFlowItem({
    id: 'item-1', clubId: 'club-r', currency: 'EUR', direction: 'inflow', category: 'mainSponsorship',
    amountMinor: 100000, dueDate: GAME_DATE, seasonKey: SEASON, createdAtGameDate: GAME_DATE,
  });
  registry.registerScheduledItem(item);
  ClubFinanceService.resolveScheduledItem({ registry, item, atGameDate: GAME_DATE });
  ClubFinanceService.resolveScheduledItem({ registry, item, atGameDate: GAME_DATE });
  assert.strictEqual(registry.treasuryBalance('club-r', 'EUR'), 100000);
  assert.strictEqual(registry.allPostings().length, 1);
});

// =========================================================================
group('4. Ingreso mensual, recibo de taquilla por matchId, pago salarial');
// =========================================================================

check('el plan mensual reparte el total en 12 cuotas sin perder céntimos', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  const plan = openClubFinance({
    registry, squadBudgetRegistry, clubId: 'club-m', archetype: 'balanced', salaryAnchorMinor: 40000000, expectedHomeGames: 17,
  });
  ClubFinanceService.ensureScheduledItemsForClubPlan({
    registry, clubId: 'club-m', plan, contractRegistry: new ContractRegistry(), transferRegistry: new TransferRegistry(),
  });
  const items = registry.scheduledItemsForClub('club-m').filter((i) => i.sourceRef.type === 'mainSponsorship-monthly');
  assert.strictEqual(items.length, 12);
  const sum = items.reduce((a, i) => a + i.amountMinor, 0);
  assert.strictEqual(sum, plan.incomeByCategoryMinor.mainSponsorship);
  // Llamar dos veces (mismo "ensure" del sync del calendario) no duplica items.
  ClubFinanceService.ensureScheduledItemsForClubPlan({
    registry, clubId: 'club-m', plan, contractRegistry: new ContractRegistry(), transferRegistry: new TransferRegistry(),
  });
  assert.strictEqual(registry.scheduledItemsForClub('club-m').filter((i) => i.sourceRef.type === 'mainSponsorship-monthly').length, 12);
});

check('un matchId genera A LO SUMO un recibo de taquilla', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  const plan = openClubFinance({
    registry, squadBudgetRegistry, clubId: 'club-tk', archetype: 'balanced', salaryAnchorMinor: 40000000, expectedHomeGames: 17,
  });
  const openingCash = plan.openingCashMinor;
  ClubFinanceService.recordHomeMatchTicketReceipt({
    registry, plan, clubId: 'club-tk', matchId: 'match-1', atGameDate: GAME_DATE,
  });
  ClubFinanceService.recordHomeMatchTicketReceipt({
    registry, plan, clubId: 'club-tk', matchId: 'match-1', atGameDate: GAME_DATE,
  });
  assert.strictEqual(registry.treasuryBalance('club-tk', 'EUR'), openingCash + plan.ticketBaselinePerGameMinor);
});

check('un contrato sin schedule real usa el backfill mensual etiquetado (nunca reescribe Contract)', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  const contractRegistry = new ContractRegistry();
  const team = makeTeam('sal', 50);
  const contract = makeContract(contractRegistry, team, 'p1', 1200000);
  const plan = openClubFinance({
    registry, squadBudgetRegistry, clubId: team.clubId, archetype: 'balanced', salaryAnchorMinor: 40000000, expectedHomeGames: 17,
  });
  ClubFinanceService.ensureScheduledItemsForClubPlan({
    registry, clubId: team.clubId, plan, contractRegistry, transferRegistry: new TransferRegistry(),
  });
  const salaryItems = registry.scheduledItemsForClub(team.clubId).filter((i) => i.sourceRef.type === 'salary-installment');
  assert.strictEqual(salaryItems.length, 12);
  assert.strictEqual(salaryItems[0].note, 'simulated-payment-schedule-backfill-v1');
  assert.strictEqual(contract.paymentPolicy.schedule.length, 0, 'nunca se reescribe Contract.paymentPolicy');
  const sum = salaryItems.reduce((a, i) => a + i.amountMinor, 0);
  assert.strictEqual(sum, 1200000);
});

// =========================================================================
group('5. Liquidación atómica club-a-club');
// =========================================================================

function makeObligation(transferRegistry, debtorClubId, creditorClubId, amountMinor, dueDate) {
  const obligation = new TransferEntities.FinancialObligation({
    id: `obl:${debtorClubId}:${creditorClubId}`,
    transactionId: 'tx-1',
    concept: 'transfer-fee',
    debtorType: 'club',
    debtorId: debtorClubId,
    creditorType: 'club',
    creditorId: creditorClubId,
    amountMinor,
    currency: 'EUR',
    dueDate,
    legalSource: { ruleModuleId: 'test', article: 'n/a' },
  });
  transferRegistry.registerObligation(obligation);
  return obligation;
}

check('con caja suficiente, la liquidación debita al deudor y credita al acreedor por el MISMO importe', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  const transferRegistry = new TransferRegistry();
  openClubFinance({ registry, squadBudgetRegistry, clubId: 'club-debtor', archetype: 'balanced', salaryAnchorMinor: 40000000 });
  ClubFinanceService.ensureClubProfile({ registry, clubId: 'club-creditor', currency: 'EUR', archetype: 'balanced', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  makeObligation(transferRegistry, 'club-debtor', 'club-creditor', 500000, GAME_DATE);
  ClubFinanceService.scheduleFinancialObligations ? null : null; // (usado indirectamente vía ensureScheduledItemsForClubPlan)
  const plan = registry.effectivePlanFor('club-debtor', SEASON, 'EUR');
  ClubFinanceService.ensureScheduledItemsForClubPlan({ registry, clubId: 'club-debtor', plan, transferRegistry });
  const item = registry.scheduledItemsForClub('club-debtor').find((i) => i.sourceRef.type === 'financial-obligation');
  assert.ok(item, 'el compromiso con fecha real genera un item fechado');
  const before = registry.treasuryBalance('club-debtor', 'EUR');
  ClubFinanceService.resolveScheduledItem({ registry, item, atGameDate: GAME_DATE });
  assert.strictEqual(registry.treasuryBalance('club-debtor', 'EUR'), before - 500000);
  assert.strictEqual(registry.treasuryBalance('club-creditor', 'EUR'), 500000);
});

check('sin caja suficiente, el deudor NO paga y el acreedor NO recibe nada (impago, nunca parcial)', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  const transferRegistry = new TransferRegistry();
  ClubFinanceService.ensureClubProfile({ registry, clubId: 'club-poor', currency: 'EUR', archetype: 'tight', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  SquadBudgetService.ensureOpeningAllocation({
    registry: squadBudgetRegistry, clubId: 'club-poor', seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 1000000,
  });
  const plan = ClubFinanceService.buildSeasonPlan({
    registry, squadBudgetRegistry, clubId: 'club-poor', seasonKey: SEASON, currency: 'EUR', calculatedAtGameDate: GAME_DATE, expectedHomeGames: 17, isCareerOpening: false,
  }).plan; // sin isCareerOpening -> caja inicial 0
  assert.strictEqual(registry.treasuryBalance('club-poor', 'EUR'), 0);
  ClubFinanceService.ensureClubProfile({ registry, clubId: 'club-rich-creditor', currency: 'EUR', archetype: 'balanced', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  makeObligation(transferRegistry, 'club-poor', 'club-rich-creditor', 9999999999, GAME_DATE);
  ClubFinanceService.ensureScheduledItemsForClubPlan({ registry, clubId: 'club-poor', plan, transferRegistry });
  const item = registry.scheduledItemsForClub('club-poor').find((i) => i.sourceRef.type === 'financial-obligation');
  const result = ClubFinanceService.resolveScheduledItem({ registry, item, atGameDate: GAME_DATE });
  assert.strictEqual(result.type, 'overdue-created');
  assert.strictEqual(registry.treasuryBalance('club-poor', 'EUR'), 0, 'nunca queda en negativo');
  assert.strictEqual(registry.treasuryBalance('club-rich-creditor', 'EUR'), 0, 'el acreedor no cobra nada de un impago');
});

// =========================================================================
group('6. Caja insuficiente -> impago -> liquidación posterior, sin negativos');
// =========================================================================

check('un impago se liquida más tarde cuando llega caja, sin reescribir la evidencia original', () => {
  const registry = new ClubFinanceRegistry();
  ClubFinanceService.ensureClubProfile({ registry, clubId: 'club-late', currency: 'EUR', archetype: 'tight', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  const bigOutflow = new ClubFinanceEntities.ScheduledCashFlowItem({
    id: 'out-1', clubId: 'club-late', currency: 'EUR', direction: 'outflow', category: 'playerSalaries',
    amountMinor: 500000, dueDate: GAME_DATE, seasonKey: SEASON, createdAtGameDate: GAME_DATE,
  });
  registry.registerScheduledItem(bigOutflow);
  const r1 = ClubFinanceService.resolveScheduledItem({ registry, item: bigOutflow, atGameDate: GAME_DATE });
  assert.strictEqual(r1.type, 'overdue-created');
  assert.strictEqual(bigOutflow.status, 'overdue');
  const overdueEvidenceId = bigOutflow.overduePostingId;
  assert.ok(registry.hasPosting(overdueEvidenceId));

  // Llega caja (un ingreso posterior).
  const income = new ClubFinanceEntities.ScheduledCashFlowItem({
    id: 'in-1', clubId: 'club-late', currency: 'EUR', direction: 'inflow', category: 'mainSponsorship',
    amountMinor: 700000, dueDate: '2026-11-01', seasonKey: SEASON, createdAtGameDate: GAME_DATE,
  });
  registry.registerScheduledItem(income);
  ClubFinanceService.resolveScheduledItem({ registry, item: income, atGameDate: '2026-11-01' });

  assert.strictEqual(bigOutflow.status, 'posted', 'el reintento liquida el impago en cuanto hay caja');
  assert.strictEqual(bigOutflow.resolvedOverdueAtGameDate, '2026-11-01');
  assert.ok(registry.hasPosting(overdueEvidenceId), 'la evidencia de impago original NUNCA se borra/reescribe');
  assert.strictEqual(registry.treasuryBalance('club-late', 'EUR'), 700000 - 500000);
  assert.ok(registry.treasuryBalance('club-late', 'EUR') >= 0);
});

// =========================================================================
group('7. Proyección estable a 3 temporadas');
// =========================================================================

check('buildRollingProjection es determinista y cubre exactamente 3 temporadas construidas', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry, squadBudgetRegistry, clubId: 'club-proj', archetype: 'balanced', salaryAnchorMinor: 40000000 });
  [SEASON_2, SEASON_3].forEach((sk) => {
    ClubFinanceService.buildSeasonPlan({
      registry, squadBudgetRegistry, clubId: 'club-proj', seasonKey: sk, currency: 'EUR', calculatedAtGameDate: GAME_DATE, expectedHomeGames: 17, isCareerOpening: false,
    });
  });
  const p1 = ClubFinanceService.buildRollingProjection({ registry, clubId: 'club-proj', currency: 'EUR', currentSeasonKey: SEASON });
  const p2 = ClubFinanceService.buildRollingProjection({ registry, clubId: 'club-proj', currency: 'EUR', currentSeasonKey: SEASON });
  assert.strictEqual(p1.seasons.length, 3);
  assert.deepStrictEqual(p1.seasons.map((s) => s.seasonKey), [SEASON, SEASON_2, SEASON_3]);
  assert.strictEqual(p1.cumulativeResultMinor, p2.cumulativeResultMinor, 'sin comandos de por medio, la proyección es estable');
});

// =========================================================================
group('8. Asignación salarial futura canónica (forward-board-allocation)');
// =========================================================================

check('una temporada futura sin límite propio traslada el límite anterior con crecimiento cero', () => {
  const squadBudgetRegistry = new SquadBudgetRegistry();
  SquadBudgetService.ensureOpeningAllocation({
    registry: squadBudgetRegistry, clubId: 'club-fwd', seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 40000000,
  });
  const { allocation, created } = ClubFinanceService.resolveSalaryAnchor({
    squadBudgetRegistry, clubId: 'club-fwd', seasonKey: SEASON_2, currency: 'EUR', atGameDate: GAME_DATE,
  });
  assert.strictEqual(created, true);
  assert.strictEqual(allocation.revisionKind, 'forward-board-allocation');
  assert.strictEqual(allocation.decisionAuthority, 'board-system');
  assert.strictEqual(allocation.amountMinor, 40000000, 'crecimiento cero — nunca la fórmula de compatibilidad en directo');

  const again = ClubFinanceService.resolveSalaryAnchor({
    squadBudgetRegistry, clubId: 'club-fwd', seasonKey: SEASON_2, currency: 'EUR', atGameDate: GAME_DATE,
  });
  assert.strictEqual(again.created, false, 'ya existe — nunca se crea una segunda forward allocation');
});

// =========================================================================
group('9. Capacidad financiera dura');
// =========================================================================

check('un impago obligatorio bloquea el headroom de TODAS las temporadas evaluadas', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry, squadBudgetRegistry, clubId: 'club-blocked', archetype: 'balanced', salaryAnchorMinor: 40000000 });
  const overdueItem = new ClubFinanceEntities.ScheduledCashFlowItem({
    id: 'ov-1', clubId: 'club-blocked', currency: 'EUR', direction: 'outflow', category: 'playerSalaries', amountMinor: 999999999999,
    dueDate: GAME_DATE, seasonKey: SEASON, createdAtGameDate: GAME_DATE,
  });
  registry.registerScheduledItem(overdueItem);
  ClubFinanceService.resolveScheduledItem({ registry, item: overdueItem, atGameDate: GAME_DATE });
  const capacity = FinancialCapacityService.evaluateFinancialCapacity({
    registry, clubId: 'club-blocked', currency: 'EUR', currentSeasonKey: SEASON, requestedSeasonKeys: [SEASON],
  });
  assert.ok(capacity.blockingOverdueIds.length > 0);
  assert.strictEqual(capacity.headroomMinorBySeasonKey[SEASON], 0);
  assert.deepStrictEqual(capacity.reasonCodesBySeasonKey[SEASON], [FinancialCapacityService.REASON_CODES.OVERDUE_PAYMENT_BLOCK]);
});

check('un club solvente sin impagos tiene headroom positivo', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry, squadBudgetRegistry, clubId: 'club-solvent', archetype: 'comfortable', salaryAnchorMinor: 40000000 });
  const capacity = FinancialCapacityService.evaluateFinancialCapacity({
    registry, clubId: 'club-solvent', currency: 'EUR', currentSeasonKey: SEASON, requestedSeasonKeys: [SEASON],
  });
  assert.strictEqual(capacity.blockingOverdueIds.length, 0);
  assert.ok(capacity.headroomMinorBySeasonKey[SEASON] > 0);
});

check('una temporada fuera del horizonte construido se marca FORECAST_HORIZON_UNAVAILABLE sin mutar nada', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry, squadBudgetRegistry, clubId: 'club-horizon', archetype: 'balanced', salaryAnchorMinor: 40000000 });
  const farSeasonKey = LocalDate.addSeasons(SEASON, 5);
  const capacity = FinancialCapacityService.evaluateFinancialCapacity({
    registry, clubId: 'club-horizon', currency: 'EUR', currentSeasonKey: SEASON, requestedSeasonKeys: [farSeasonKey],
  });
  assert.deepStrictEqual(capacity.reasonCodesBySeasonKey[farSeasonKey], [FinancialCapacityService.REASON_CODES.FORECAST_HORIZON_UNAVAILABLE]);
  assert.strictEqual(registry.hasPlan('club-horizon', farSeasonKey, 'EUR'), false);
});

// =========================================================================
group('10. Empleo del manager y confianza');
// =========================================================================

check('el manager y su spell activo se crean una única vez (idempotente)', () => {
  const registry = new ManagerBoardRegistry();
  const first = ManagerEmploymentService.ensureManagerAndActiveSpell({
    registry, careerSeed: 'seed-mgr', controlledClubId: 'club-mgr', startGameDate: GAME_DATE,
  });
  const second = ManagerEmploymentService.ensureManagerAndActiveSpell({
    registry, careerSeed: 'seed-mgr', controlledClubId: 'club-mgr', startGameDate: GAME_DATE,
  });
  assert.strictEqual(first.manager.id, second.manager.id);
  assert.strictEqual(first.spell.id, second.spell.id);
  assert.strictEqual(registry.allManagers().length, 1);
  assert.strictEqual(registry.allSpells().length, 1);
});

check('confianza deportiva es 50 sin partidos oficiales todavía', () => {
  const result = BoardConfidenceService.computeSportingConfidence({ hasOfficialGames: false });
  assert.strictEqual(result.value, 50);
});

check('confianza deportiva se regresa hacia 50 al principio de temporada (progreso bajo)', () => {
  const early = BoardConfidenceService.computeSportingConfidence({
    hasOfficialGames: true, sportingGoalText: 'Optar a playoffs', rank: 1, totalParticipants: 18, seasonProgressFraction: 0.05, recentFormDeltaRaw: 0,
  });
  const late = BoardConfidenceService.computeSportingConfidence({
    hasOfficialGames: true, sportingGoalText: 'Optar a playoffs', rank: 1, totalParticipants: 18, seasonProgressFraction: 1, recentFormDeltaRaw: 0,
  });
  assert.ok(Math.abs(early.value - 50) < Math.abs(late.value - 50), 'un partido no puede mover la confianza de golpe');
});

check('disciplina financiera cae a 0 con impago obligatorio bloqueante', () => {
  const result = BoardConfidenceService.computeFinancialDisciplineConfidence({ hasBlockingOverdue: true });
  assert.strictEqual(result.value, 0);
});

check('disciplina financiera aplica los modificadores exactos de la política v1', () => {
  const base = BoardConfidenceService.computeFinancialDisciplineConfidence({ hasBlockingOverdue: false, projectedSeasonResultBp: 0, belowRequiredReserve: false, committedPlusReservedExceedsAllocation: false });
  assert.strictEqual(base.value, 70);
  const withSurplus = BoardConfidenceService.computeFinancialDisciplineConfidence({ hasBlockingOverdue: false, projectedSeasonResultBp: 600, belowRequiredReserve: false, committedPlusReservedExceedsAllocation: false });
  assert.strictEqual(withSurplus.value, 80);
  const overcommitted = BoardConfidenceService.computeFinancialDisciplineConfidence({ hasBlockingOverdue: false, projectedSeasonResultBp: 0, belowRequiredReserve: true, committedPlusReservedExceedsAllocation: true });
  assert.strictEqual(overcommitted.value, 70 - 15 - 25);
});

check('relación/antigüedad arranca en 40 y suma hasta +24 por meses empleados', () => {
  const fresh = BoardConfidenceService.computeRelationshipConfidence({ completedEmploymentMonths: 0, seasonOutcomes: [] });
  assert.strictEqual(fresh.value, 40);
  const veteran = BoardConfidenceService.computeRelationshipConfidence({ completedEmploymentMonths: 100, seasonOutcomes: [] });
  assert.strictEqual(veteran.value, 40 + 24);
});

check('confianza global es la media ponderada exacta 45/35/20', () => {
  const overall = BoardConfidenceService.computeOverallConfidence({ sporting: 80, financialDiscipline: 60, relationship: 50 });
  assert.strictEqual(overall, Math.round((80 * 45 + 60 * 35 + 50 * 20) / 100));
});

// =========================================================================
group('11. Retraso de respuesta y una-pendiente/cooldown compartido');
// =========================================================================

function submitTestRequest(registry, clubFinanceRegistry, clubId, requestedIncreaseBySeasonKey, effectiveLimitBySeasonKey, source, submittedGameDate) {
  return BoardBudgetRequestService.submitRequest({
    registry,
    clubFinanceRegistry,
    managerId: 'manager-1',
    employmentSpellId: 'spell-1',
    clubId,
    source: source || 'finance-screen',
    requestedIncreaseBySeasonKey,
    currency: 'EUR',
    submittedGameDate,
    horizonSeasonKeys: [SEASON, SEASON_2, SEASON_3],
    effectiveLimitBySeasonKey,
    submittedConfidenceSnapshot: { overall: 60 },
  });
}

check('el retraso es 1/2/3 días según el ratio máximo solicitado', () => {
  const registry = new BoardBudgetRequestRegistry();
  const clubFinanceRegistry = new ClubFinanceRegistry();
  ClubFinanceService.ensureClubProfile({ registry: clubFinanceRegistry, clubId: 'club-delay-1', currency: 'EUR', archetype: 'balanced', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  const r1 = submitTestRequest(registry, clubFinanceRegistry, 'club-delay-1', { [SEASON]: 400000 }, { [SEASON]: 10000000 }, 'finance-screen', GAME_DATE);
  assert.strictEqual(r1.request.dueDateBasis.delayDays, 1, 'ratio 4% <= 5% -> 1 día');

  const registry2 = new BoardBudgetRequestRegistry();
  const cf2 = new ClubFinanceRegistry();
  ClubFinanceService.ensureClubProfile({ registry: cf2, clubId: 'club-delay-2', currency: 'EUR', archetype: 'balanced', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  const r2 = submitTestRequest(registry2, cf2, 'club-delay-2', { [SEASON]: 800000 }, { [SEASON]: 10000000 }, 'finance-screen', GAME_DATE);
  assert.strictEqual(r2.request.dueDateBasis.delayDays, 2, 'ratio 8% (>5% y <=10%) -> 2 días');

  const registry3 = new BoardBudgetRequestRegistry();
  const cf3 = new ClubFinanceRegistry();
  ClubFinanceService.ensureClubProfile({ registry: cf3, clubId: 'club-delay-3', currency: 'EUR', archetype: 'balanced', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  const r3 = submitTestRequest(registry3, cf3, 'club-delay-3', { [SEASON]: 1500000 }, { [SEASON]: 10000000 }, 'finance-screen', GAME_DATE);
  assert.strictEqual(r3.request.dueDateBasis.delayDays, 3, 'ratio 15% (>10%) -> 3 días');
  assert.strictEqual(r3.request.dueGameDate, LocalDate.addDays(GAME_DATE, 3));
});

check('un club con petición pendiente no puede enviar una segunda (REQUEST_PENDING)', () => {
  const registry = new BoardBudgetRequestRegistry();
  const clubFinanceRegistry = new ClubFinanceRegistry();
  ClubFinanceService.ensureClubProfile({ registry: clubFinanceRegistry, clubId: 'club-pending', currency: 'EUR', archetype: 'balanced', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  const first = submitTestRequest(registry, clubFinanceRegistry, 'club-pending', { [SEASON]: 100000 }, { [SEASON]: 10000000 }, 'finance-screen', GAME_DATE);
  assert.strictEqual(first.ok, true);
  const second = submitTestRequest(registry, clubFinanceRegistry, 'club-pending', { [SEASON]: 100000 }, { [SEASON]: 10000000 }, 'blocked-operation', GAME_DATE);
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reasonCode, BoardBudgetRequestService.REASON_CODES.REQUEST_PENDING);
});

check('el cooldown compartido bloquea Finanzas y Mercado por igual tras una resolución', () => {
  const registry = new BoardBudgetRequestRegistry();
  const clubFinanceRegistry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry: clubFinanceRegistry, squadBudgetRegistry, clubId: 'club-cd', archetype: 'comfortable', salaryAnchorMinor: 40000000 });
  const submitted = submitTestRequest(registry, clubFinanceRegistry, 'club-cd', { [SEASON]: 100000 }, { [SEASON]: 40000000 }, 'finance-screen', GAME_DATE);
  BoardBudgetRequestService.resolveRequest({
    registry, request: submitted.request, squadBudgetRegistry, clubFinanceRegistry, currentSeasonKey: SEASON,
    resolutionConfidenceSnapshot: { overall: 90 }, boardFiscalStyle: 'balanced', atGameDate: submitted.request.dueGameDate,
  });
  const cooldown = BoardBudgetRequestService.cooldownStatus({ registry, clubId: 'club-cd', atGameDate: submitted.request.dueGameDate });
  assert.strictEqual(cooldown.active, true);
  const afterFinance = submitTestRequest(registry, clubFinanceRegistry, 'club-cd', { [SEASON]: 50000 }, { [SEASON]: 40000000 }, 'finance-screen', submitted.request.dueGameDate);
  const afterMarket = submitTestRequest(registry, clubFinanceRegistry, 'club-cd', { [SEASON]: 50000 }, { [SEASON]: 40000000 }, 'blocked-operation', submitted.request.dueGameDate);
  assert.strictEqual(afterFinance.ok, false);
  assert.strictEqual(afterFinance.reasonCode, BoardBudgetRequestService.REASON_CODES.COOLDOWN_ACTIVE);
  assert.strictEqual(afterMarket.ok, false);
  assert.strictEqual(afterMarket.reasonCode, BoardBudgetRequestService.REASON_CODES.COOLDOWN_ACTIVE);
});

// =========================================================================
group('12. Decisión determinista total/parcial/rechazada');
// =========================================================================

function resolveTestRequest(registry, clubFinanceRegistry, squadBudgetRegistry, request, overallConfidence, fiscalStyle) {
  return BoardBudgetRequestService.resolveRequest({
    registry, request, squadBudgetRegistry, clubFinanceRegistry, currentSeasonKey: SEASON,
    resolutionConfidenceSnapshot: { overall: overallConfidence }, boardFiscalStyle: fiscalStyle || 'balanced', atGameDate: request.dueGameDate,
  });
}

check('petición pequeña con alta confianza y headroom amplio se aprueba íntegramente', () => {
  const registry = new BoardBudgetRequestRegistry();
  const clubFinanceRegistry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry: clubFinanceRegistry, squadBudgetRegistry, clubId: 'club-full', archetype: 'comfortable', salaryAnchorMinor: 40000000 });
  const allocation = squadBudgetRegistry.effectiveAllocationFor('club-full', SEASON, 'EUR');
  const requested = Math.round(allocation.amountMinor * 0.03); // 3% -> dentro del ceiling de 20% con confianza alta
  const submitted = submitTestRequest(registry, clubFinanceRegistry, 'club-full', { [SEASON]: requested }, { [SEASON]: allocation.amountMinor }, 'finance-screen', GAME_DATE);
  const { request } = resolveTestRequest(registry, clubFinanceRegistry, squadBudgetRegistry, submitted.request, 95, 'ambitious');
  assert.strictEqual(request.outcome, 'approved');
  assert.deepStrictEqual(request.reasonCodesBySeasonKey[SEASON], [BoardBudgetRequestService.REASON_CODES.APPROVED_WITHIN_LIMITS]);
  assert.strictEqual(request.approvedIncreaseBySeasonKey[SEASON], requested);
  const newAllocation = squadBudgetRegistry.effectiveAllocationFor('club-full', SEASON, 'EUR');
  assert.strictEqual(newAllocation.amountMinor, allocation.amountMinor + requested);
  assert.strictEqual(newAllocation.revisionKind, 'board-revision');
  assert.strictEqual(newAllocation.decisionAuthority, 'board-system');
});

check('petición grande con confianza baja se rechaza sin crear ninguna revisión', () => {
  const registry = new BoardBudgetRequestRegistry();
  const clubFinanceRegistry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry: clubFinanceRegistry, squadBudgetRegistry, clubId: 'club-reject', archetype: 'tight', salaryAnchorMinor: 40000000 });
  const allocation = squadBudgetRegistry.effectiveAllocationFor('club-reject', SEASON, 'EUR');
  const requested = Math.round(allocation.amountMinor * 0.5);
  const submitted = submitTestRequest(registry, clubFinanceRegistry, 'club-reject', { [SEASON]: requested }, { [SEASON]: allocation.amountMinor }, 'finance-screen', GAME_DATE);
  const chainLenBefore = squadBudgetRegistry.chainFor('club-reject', SEASON, 'EUR').length;
  const { request } = resolveTestRequest(registry, clubFinanceRegistry, squadBudgetRegistry, submitted.request, 20, 'conservative');
  assert.strictEqual(request.outcome, 'rejected');
  assert.strictEqual(Object.values(request.approvedIncreaseBySeasonKey).every((v) => v === 0), true);
  assert.strictEqual(squadBudgetRegistry.chainFor('club-reject', SEASON, 'EUR').length, chainLenBefore, 'un rechazo NUNCA crea una revisión');
});

check('petición que excede la disposición de la junta se aprueba parcialmente, redondeada a la baja a 1.000 EUR', () => {
  const registry = new BoardBudgetRequestRegistry();
  const clubFinanceRegistry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry: clubFinanceRegistry, squadBudgetRegistry, clubId: 'club-partial', archetype: 'comfortable', salaryAnchorMinor: 40000000 });
  const allocation = squadBudgetRegistry.effectiveAllocationFor('club-partial', SEASON, 'EUR');
  const requested = Math.round(allocation.amountMinor * 0.30); // por encima del ceiling máx. (20% + banda ambiciosa)
  const submitted = submitTestRequest(registry, clubFinanceRegistry, 'club-partial', { [SEASON]: requested }, { [SEASON]: allocation.amountMinor }, 'finance-screen', GAME_DATE);
  const { request } = resolveTestRequest(registry, clubFinanceRegistry, squadBudgetRegistry, submitted.request, 90, 'ambitious');
  assert.strictEqual(request.outcome, 'partially-approved');
  assert.ok(request.approvedIncreaseBySeasonKey[SEASON] > 0);
  assert.ok(request.approvedIncreaseBySeasonKey[SEASON] < requested);
  assert.strictEqual(request.approvedIncreaseBySeasonKey[SEASON] % 100000, 0, 'redondeo determinista a 1.000 EUR (100000 céntimos)');
});

// =========================================================================
group('13. Revisiones multi-temporada atómicas');
// =========================================================================

check('una petición de 2 temporadas aprobadas crea 2 revisiones (una por temporada), nunca una oferta', () => {
  const registry = new BoardBudgetRequestRegistry();
  const clubFinanceRegistry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry: clubFinanceRegistry, squadBudgetRegistry, clubId: 'club-multi', archetype: 'comfortable', salaryAnchorMinor: 40000000 });
  [SEASON_2].forEach((sk) => ClubFinanceService.buildSeasonPlan({
    registry: clubFinanceRegistry, squadBudgetRegistry, clubId: 'club-multi', seasonKey: sk, currency: 'EUR', calculatedAtGameDate: GAME_DATE, expectedHomeGames: 17, isCareerOpening: false,
  }));
  const allocS1 = squadBudgetRegistry.effectiveAllocationFor('club-multi', SEASON, 'EUR');
  const requested = { [SEASON]: Math.round(allocS1.amountMinor * 0.02), [SEASON_2]: Math.round(allocS1.amountMinor * 0.02) };
  const limits = { [SEASON]: allocS1.amountMinor, [SEASON_2]: allocS1.amountMinor };
  const submitted = submitTestRequest(registry, clubFinanceRegistry, 'club-multi', requested, limits, 'finance-screen', GAME_DATE);
  const { request } = resolveTestRequest(registry, clubFinanceRegistry, squadBudgetRegistry, submitted.request, 95, 'ambitious');
  assert.strictEqual(request.outcome, 'approved');
  assert.strictEqual(Object.keys(request.appliedAllocationRevisionIdsBySeasonKey).length, 2);
  assert.strictEqual(squadBudgetRegistry.chainFor('club-multi', SEASON, 'EUR').length, 2);
  assert.strictEqual(squadBudgetRegistry.chainFor('club-multi', SEASON_2, 'EUR').length, 2);
});

// =========================================================================
group('14. Calendario — sincronización repetida sin duplicar');
// =========================================================================

check('sincronizar dos veces la fuente club-finance-event no duplica items ni postings', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry, squadBudgetRegistry, clubId: 'club-cal', archetype: 'balanced', salaryAnchorMinor: 40000000 });
  const calendar = new WorldCalendar({ id: 'cal-1', defaultTimeZoneId: 'Europe/Madrid', initialInstant: '2026-08-01T00:00:00.000Z' });
  const source = ClubFinanceService.createClubFinanceEventSource({
    registry, listClubIds: () => ['club-cal'], timeZoneId: 'Europe/Madrid',
  });
  const coordinator = new WorldCalendarCoordinator({ calendar, sources: [source] });
  const firstCount = coordinator.sync();
  const secondCount = coordinator.sync();
  assert.strictEqual(firstCount, secondCount, 'idempotente — sincronizar dos veces no aumenta la cola');
});

check('sincronizar dos veces la fuente board-event no duplica peticiones pendientes', () => {
  const registry = new BoardBudgetRequestRegistry();
  const clubFinanceRegistry = new ClubFinanceRegistry();
  ClubFinanceService.ensureClubProfile({ registry: clubFinanceRegistry, clubId: 'club-boardcal', currency: 'EUR', archetype: 'balanced', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  submitTestRequest(registry, clubFinanceRegistry, 'club-boardcal', { [SEASON]: 100000 }, { [SEASON]: 40000000 }, 'finance-screen', GAME_DATE);
  const calendar = new WorldCalendar({ id: 'cal-2', defaultTimeZoneId: 'Europe/Madrid', initialInstant: '2026-08-01T00:00:00.000Z' });
  const source = BoardBudgetRequestService.createBoardEventSource({
    registry, timeZoneId: 'Europe/Madrid', resolveDueRequest: () => ({}),
  });
  const coordinator = new WorldCalendarCoordinator({ calendar, sources: [source] });
  coordinator.sync();
  const countAfterFirstSync = calendar.pendingItemsOrdered().length;
  coordinator.sync();
  assert.strictEqual(calendar.pendingItemsOrdered().length, countAfterFirstSync);
});

// =========================================================================
group('15. Round-trip v3 + mecanismo de migración v1/v2');
// =========================================================================

check('ClubFinanceRegistry.exportState()/restoreState() es un round-trip sin pérdida', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  openClubFinance({ registry, squadBudgetRegistry, clubId: 'club-rt', archetype: 'balanced', salaryAnchorMinor: 40000000 });
  const plan = registry.effectivePlanFor('club-rt', SEASON, 'EUR');
  ClubFinanceService.ensureScheduledItemsForClubPlan({ registry, clubId: 'club-rt', plan });
  const exported = registry.exportState();
  const restored = new ClubFinanceRegistry();
  restored.restoreState(exported, ClubFinanceEntities);
  assert.deepStrictEqual(restored.exportState(), exported);
  assert.strictEqual(restored.validateIntegrity().valid, true);
});

check('ManagerBoardRegistry y BoardBudgetRequestRegistry hacen round-trip sin pérdida', () => {
  const mbRegistry = new ManagerBoardRegistry();
  ManagerEmploymentService.ensureManagerAndActiveSpell({ registry: mbRegistry, careerSeed: 's', controlledClubId: 'club-rt2', startGameDate: GAME_DATE });
  ManagerEmploymentService.ensureBoardPolicyProfile({ registry: mbRegistry, clubId: 'club-rt2', fiscalStyle: 'balanced', careerSeed: 's', calculatedAtGameDate: GAME_DATE });
  const exportedMb = mbRegistry.exportState();
  const restoredMb = new ManagerBoardRegistry();
  restoredMb.restoreState(exportedMb, ManagerBoardEntities);
  assert.deepStrictEqual(restoredMb.exportState(), exportedMb);

  const brRegistry = new BoardBudgetRequestRegistry();
  submitTestRequest(brRegistry, new ClubFinanceRegistry(), 'club-rt3', { [SEASON]: 1000 }, { [SEASON]: 100000 }, 'finance-screen', GAME_DATE);
  const exportedBr = brRegistry.exportState();
  const restoredBr = new BoardBudgetRequestRegistry();
  restoredBr.restoreState(exportedBr, BoardBudgetRequestEntities);
  assert.deepStrictEqual(restoredBr.exportState(), exportedBr);
});

check('migración v1/v2: un club sin colección de finanzas recibe perfil+plan reconstruidos, sin caja negativa', () => {
  const registry = new ClubFinanceRegistry();
  const squadBudgetRegistry = new SquadBudgetRegistry();
  const contractRegistry = new ContractRegistry();
  const team = makeTeam('migclub', 50);
  makeContract(contractRegistry, team, 'p1', 4000000);
  SquadBudgetService.ensureOpeningAllocation({
    registry: squadBudgetRegistry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', effectiveDate: GAME_DATE, amountMinor: 40000000,
  });
  const archetypes = ClubFinanceService.assignArchetypes([team.clubId], 'migration-seed');
  ClubFinanceService.ensureClubProfile({
    registry, clubId: team.clubId, currency: 'EUR', archetype: archetypes.get(team.clubId), careerSeed: 'migration-seed', calculatedAtGameDate: GAME_DATE,
  });
  const { plan } = ClubFinanceService.buildSeasonPlan({
    registry, squadBudgetRegistry, clubId: team.clubId, seasonKey: SEASON, currency: 'EUR', calculatedAtGameDate: GAME_DATE, expectedHomeGames: 17, isCareerOpening: true,
  });
  assert.ok(plan.openingCashMinor > 0);
  assert.strictEqual(registry.treasuryBalance(team.clubId, 'EUR'), plan.openingCashMinor);

  // "notBeforeDate" = fecha de migración a mitad de temporada: NUNCA
  // programa retroactivamente un mes ya pasado (invariante de la sección
  // 11/14 del prompt: "save migration never creates retroactive arrears").
  const migrationDate = '2027-02-01'; // muy avanzada la temporada 2026-27
  ClubFinanceService.ensureScheduledItemsForClubPlan({
    registry, clubId: team.clubId, plan, contractRegistry, notBeforeDate: migrationDate,
  });
  const items = registry.scheduledItemsForClub(team.clubId);
  const retroactive = items.filter((i) => LocalDate.compare(i.dueDate, migrationDate) < 0);
  assert.strictEqual(retroactive.length, 0, 'ningún item queda fechado antes de la fecha de migración');
  assert.strictEqual(registry.overdueItemsForClub(team.clubId).length, 0, 'la migración nunca fabrica un impago histórico');
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
