// src/core/FinancialCapacityService.js
// ECONOMY-BOARD-1 — puerta DURA de capacidad financiera (sección 6.2 del
// prompt de la Epic): cuánto podría absorber un club en salario adicional
// sin dejar la caja por debajo de la reserva mínima ni superar el déficit
// simulado máximo a tres temporadas. Independiente de la confianza de
// junta — la confianza/personalidad puede RECORTAR una aprobación, nunca
// ampliarla por encima de este límite. Módulo de LECTURA pura: nunca muta
// `ClubFinanceRegistry`/`SquadBudgetRegistry`. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// El umbral del 5% es una salvaguarda de SIMULACIÓN interna inspirada en
// el control económico de la ACB — nunca una certificación de ese
// reglamento real (aviso explícito también en la UI).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const ClubFinancePolicyModule = isNode ? require('./ClubFinancePolicy.js') : global.BasketManager;
  const ClubFinanceServiceModule = isNode ? require('./ClubFinanceService.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function Policy() { return ClubFinancePolicyModule.ClubFinancePolicy; }
  function FinanceSvc() { return ClubFinanceServiceModule.ClubFinanceService; }

  const REASON_CODES = Object.freeze({
    OVERDUE_PAYMENT_BLOCK: 'OVERDUE_PAYMENT_BLOCK',
    NO_FINANCIAL_HEADROOM: 'NO_FINANCIAL_HEADROOM',
    PARTIAL_FINANCIAL_CAPACITY: 'PARTIAL_FINANCIAL_CAPACITY',
    FORECAST_HORIZON_UNAVAILABLE: 'FORECAST_HORIZON_UNAVAILABLE',
    APPROVED_WITHIN_LIMITS: 'APPROVED_WITHIN_LIMITS',
  });

  // Minuto a minuto NO — pero sí en orden real (`dueDate` + inflow-antes-
  // que-outflow) para la temporada ACTUAL (única con datos mensuales reales
  // ya fechados). Las dos temporadas siguientes usan granularidad ANUAL,
  // tal y como pide la sección 6.1 del prompt ("next two seasons: annual
  // planned income/expense... projected closing cash").
  function minimumCashPointForCurrentSeason(registry, clubId, currency, seasonKey) {
    const items = registry.scheduledItemsForClub(clubId)
      .filter((i) => i.currency === currency && i.seasonKey === seasonKey && (i.status === 'scheduled' || i.status === 'overdue'))
      .sort((a, b) => LD().compare(a.dueDate, b.dueDate) || (a.direction === 'inflow' ? -1 : 1) || (a.id < b.id ? -1 : 1));
    let balance = registry.treasuryBalance(clubId, currency);
    let minBalance = balance;
    items.forEach((item) => {
      balance += item.direction === 'inflow' ? item.amountMinor : -item.amountMinor;
      if (balance < minBalance) minBalance = balance;
    });
    return minBalance;
  }

  function blockingOverdueIdsForClub(registry, clubId, currency) {
    return registry.overdueItemsForClub(clubId)
      .filter((i) => i.currency === currency && i.mandatory)
      .map((i) => i.id);
  }

  // Devuelve el headroom (0..N) por temporada del horizonte YA construido
  // (actual + 2 siguientes), más el detalle necesario para auditar la
  // decisión. `requestedSeasonKeys` es opcional: si se pasa, se valida que
  // cada una esté dentro del horizonte (si no, se marca
  // FORECAST_HORIZON_UNAVAILABLE para esa temporada, sin mutar nada).
  function evaluateFinancialCapacity(params) {
    const {
      registry, clubId, currency, currentSeasonKey, transferRegistry, requestedSeasonKeys,
    } = params;
    const policy = Policy().FINANCIAL_CAPACITY_POLICY;
    const projection = FinanceSvc().buildRollingProjection({
      registry, clubId, currency, currentSeasonKey, transferRegistry,
    });
    const horizonSeasonKeys = projection.seasons.map((s) => s.seasonKey);
    const blockingOverdueIds = blockingOverdueIdsForClub(registry, clubId, currency);
    const hasOverdueBlock = blockingOverdueIds.length > 0;

    const allowedNegativeMinor = Math.floor((projection.baselineIncomeMinor * policy.maxRollingDeficitBpOfBaselineIncome) / 10000);
    const remainingRollingCapacityMinor = Math.max(0, allowedNegativeMinor + projection.cumulativeResultMinor);

    const headroomMinorBySeasonKey = {};
    const projectedMinCashBySeasonKey = {};
    const reasonCodesBySeasonKey = {};
    const seasonsToEvaluate = requestedSeasonKeys && requestedSeasonKeys.length ? requestedSeasonKeys : horizonSeasonKeys;

    seasonsToEvaluate.forEach((seasonKey) => {
      if (!horizonSeasonKeys.includes(seasonKey)) {
        headroomMinorBySeasonKey[seasonKey] = 0;
        reasonCodesBySeasonKey[seasonKey] = [REASON_CODES.FORECAST_HORIZON_UNAVAILABLE];
        return;
      }
      const season = projection.seasons.find((s) => s.seasonKey === seasonKey);
      let localCapMinor;
      let minCashMinor;
      if (seasonKey === currentSeasonKey) {
        minCashMinor = minimumCashPointForCurrentSeason(registry, clubId, currency, seasonKey);
        localCapMinor = Math.max(0, minCashMinor - season.requiredMonthlyReserveMinor * policy.minMonthlyReserveMonthsOfMandatoryOutflow);
      } else {
        minCashMinor = season.projectedClosingCashMinor;
        localCapMinor = Math.max(0, minCashMinor - season.requiredMonthlyReserveMinor * policy.minMonthlyReserveMonthsOfMandatoryOutflow);
      }
      projectedMinCashBySeasonKey[seasonKey] = minCashMinor;
      if (hasOverdueBlock) {
        headroomMinorBySeasonKey[seasonKey] = 0;
        reasonCodesBySeasonKey[seasonKey] = [REASON_CODES.OVERDUE_PAYMENT_BLOCK];
        return;
      }
      const headroom = Math.min(localCapMinor, remainingRollingCapacityMinor);
      headroomMinorBySeasonKey[seasonKey] = headroom;
      reasonCodesBySeasonKey[seasonKey] = headroom > 0
        ? [REASON_CODES.APPROVED_WITHIN_LIMITS] : [REASON_CODES.NO_FINANCIAL_HEADROOM];
    });

    return {
      clubId,
      currency,
      policyVersion: Policy().POLICY_VERSION,
      headroomMinorBySeasonKey,
      projectedMinCashBySeasonKey,
      projectedSeasonResultBySeasonKey: Object.fromEntries(
        projection.seasons.map((s) => [s.seasonKey, s.plannedIncomeMinor - s.plannedExpenseMinor]),
      ),
      rollingCumulativeResultMinor: projection.cumulativeResultMinor,
      remainingRollingCapacityMinor,
      blockingOverdueIds,
      reasonCodesBySeasonKey,
      horizonSeasonKeys,
    };
  }

  const exportsObj = {
    FinancialCapacityService: {
      REASON_CODES,
      evaluateFinancialCapacity,
      minimumCashPointForCurrentSeason,
      blockingOverdueIdsForClub,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
