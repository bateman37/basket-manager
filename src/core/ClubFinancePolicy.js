// src/core/ClubFinancePolicy.js
// ECONOMY-BOARD-1 — política de simulación v1 CONGELADA y versionada:
// arquetipos, reparto de ingresos/gastos y umbrales de capacidad
// financiera. Objeto puro/frozen — ningún cálculo vive aquí, solo los
// NÚMEROS de la política (sección 5.3/5.6/6.2 del prompt de la Epic).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Basis points (bp) enteros — nunca floats de euros. Un club/carrera
// nunca lee estos números directamente para "inventar" otra fórmula: solo
// `ClubFinanceService`/`FinancialCapacityService` los consumen.

(function (global) {
  const POLICY_VERSION = 'simulated-club-finance-v1';

  // Arquetipo -> {cuota salarial sobre ingreso planificado, margen
  // operativo objetivo, colchón de caja de apertura en MESES de gasto
  // anual planificado}. Sección 5.3, tabla exacta del prompt.
  const ARCHETYPE_POLICY = Object.freeze({
    tight: Object.freeze({ salaryShareBp: 5600, targetMarginBp: 100, openingCashBufferMonths: 2 }),
    balanced: Object.freeze({ salaryShareBp: 5200, targetMarginBp: 300, openingCashBufferMonths: 3 }),
    comfortable: Object.freeze({ salaryShareBp: 4800, targetMarginBp: 500, openingCashBufferMonths: 4 }),
  });

  // Mezcla de ingresos por defecto, en basis points del ingreso
  // planificado — suma 10000 (sección 5.3). `europeanCompetition` es 0 en
  // v1: solo se cobra desde un evento/política real de competición
  // europea (sección 5.5), nunca un baseline inventado.
  const INCOME_MIX_BP = Object.freeze({
    mainSponsorship: 3200,
    secondarySponsorship: 1300,
    tvRights: 1200,
    leagueRevenueShare: 1300,
    ticketSales: 2000,
    merchandising: 1000,
    europeanCompetition: 0,
  });

  // Reparto del pool no-salarial (sección 5.3) — suma 10000.
  const NON_SALARY_EXPENSE_SPLIT_BP = Object.freeze({
    coachingStaffAggregate: 3000,
    facilitiesMaintenance: 2000,
    clubOperations: 5000,
  });

  // Capacidad financiera dura (sección 6.2) — guarda explícita: el 5% es
  // una salvaguarda de SIMULACIÓN interna inspirada en el control
  // económico ACB, nunca una certificación de ese reglamento real.
  const FINANCIAL_CAPACITY_POLICY = Object.freeze({
    horizonSeasons: 3,
    minMonthlyReserveMonthsOfMandatoryOutflow: 1,
    maxRollingDeficitBpOfBaselineIncome: 500, // 5%
  });

  // Backfill de calendario de pago simulado (sección 5.6) cuando un
  // contrato real no trae `paymentPolicy.schedule` usable — NUNCA reescribe
  // el `Contract`, solo etiqueta la fuente para que la UI la distinga.
  const PAYMENT_SCHEDULE_BACKFILL_POLICY_VERSION = 'simulated-payment-schedule-backfill-v1';

  function requireArchetype(archetype) {
    if (!ARCHETYPE_POLICY[archetype]) {
      throw new Error(`ClubFinancePolicy: arquetipo desconocido "${archetype}".`);
    }
    return ARCHETYPE_POLICY[archetype];
  }

  const exportsObj = {
    ClubFinancePolicy: {
      POLICY_VERSION,
      ARCHETYPE_POLICY,
      INCOME_MIX_BP,
      NON_SALARY_EXPENSE_SPLIT_BP,
      FINANCIAL_CAPACITY_POLICY,
      PAYMENT_SCHEDULE_BACKFILL_POLICY_VERSION,
      requireArchetype,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
