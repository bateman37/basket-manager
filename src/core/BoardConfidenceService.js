// src/core/BoardConfidenceService.js
// ECONOMY-BOARD-1 — política de confianza de junta (sección 7 del prompt
// de la Epic): tres dimensiones (deportiva/disciplina financiera/
// relación-antigüedad) + confianza global, estilo fiscal simulado por
// club y el objetivo financiero ESTRUCTURADO (nunca la prosa de
// `Club.board.financialGoal`, que pasa a ser solo texto derivado). Módulo
// de LECTURA/CÁLCULO puro: recibe hechos ya resueltos por el llamador
// (standings reales, vista de presupuesto, proyección financiera) y nunca
// lee `state`/DOM ni decide competición por texto de UI. Convención del
// proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;

  function DR() { return DeterministicRandomModule.DeterministicRandom; }

  const POLICY_VERSION = 'board-confidence-policy-v1';

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  // -----------------------------------------------------------------------
  // Estilo fiscal — determinista por careerSeed+clubId, mismo criterio de
  // hash+round-robin acotado que `ClubFinanceService.assignArchetypes()`,
  // en un ESPACIO de hash independiente (nunca el mismo valor que el
  // arquetipo financiero para el mismo club).
  // -----------------------------------------------------------------------
  const FISCAL_STYLE_ORDER = ['conservative', 'balanced', 'ambitious'];

  function assignFiscalStyles(clubIds, careerSeed) {
    const withHash = [...clubIds].map((clubId) => ({
      clubId, hash: DR().hash32(`${careerSeed}#board-fiscal-style#${clubId}`),
    }));
    withHash.sort((a, b) => (a.hash - b.hash) || (a.clubId < b.clubId ? -1 : 1));
    const byClubId = new Map();
    withHash.forEach((entry, index) => byClubId.set(entry.clubId, FISCAL_STYLE_ORDER[index % 3]));
    return byClubId;
  }

  // Ceiling base de disposición (% del límite salarial efectivo) por
  // confianza global — tabla exacta de la sección 8.3 del prompt. Ajuste
  // de estilo fiscal (una banda de 5 puntos) vive en
  // `BoardBudgetRequestService`, que es quien la consume.
  function willingnessBaseCeilingBp(overallConfidence) {
    if (overallConfidence < 35) return 0;
    if (overallConfidence < 50) return 500;
    if (overallConfidence < 65) return 1000;
    if (overallConfidence < 80) return 1500;
    return 2000;
  }

  // -----------------------------------------------------------------------
  // Objetivo financiero ESTRUCTURADO — la única autoridad; el texto en
  // español se GENERA desde aquí, nunca al revés.
  // -----------------------------------------------------------------------
  function structuredFinancialGoal(financialCapacityPolicy) {
    return {
      requiresNoBlockingArrears: true,
      minMonthlyReserveMonths: financialCapacityPolicy.minMonthlyReserveMonthsOfMandatoryOutflow,
      maxRollingDeficitBp: financialCapacityPolicy.maxRollingDeficitBpOfBaselineIncome,
    };
  }

  function describeFinancialGoalEs(goal) {
    return `Sin impagos pendientes, al menos ${goal.minMonthlyReserveMonths} mes(es) de gasto obligatorio en caja de `
      + `reserva y sin superar un déficit acumulado simulado del ${(goal.maxRollingDeficitBp / 100).toFixed(1)}% a tres `
      + 'temporadas (salvaguarda interna de simulación, no una certificación del reglamento económico real).';
  }

  // -----------------------------------------------------------------------
  // Confianza DEPORTIVA (sección 7.2, política v1).
  // -----------------------------------------------------------------------
  // Bandas objetivo normalizadas — mapean el texto YA existente de
  // `Club.board.sportingGoal` (`SeasonGoals.computeSportingGoal()`) a un
  // percentil mínimo esperado dentro de su propio cohorte de competición
  // (1 = mejor posición posible, 0 = peor). Nunca se hardcodea una liga
  // concreta: el llamador ya resolvió el cohorte real por Entries.
  const SPORTING_GOAL_TARGET_PERCENTILE = {
    'Pelear por el título': 0.85, // top ~15%
    'Optar a playoffs': 0.55, // top ~45%
    'Consolidarse en la categoría': 0.25, // por encima del 25% inferior
    'Evitar el descenso': 0.10, // por encima del 10% inferior
  };

  function computeSportingConfidence(params) {
    const {
      hasOfficialGames, sportingGoalText, rank, totalParticipants, seasonProgressFraction, recentFormDeltaRaw,
    } = params;
    if (!hasOfficialGames || !totalParticipants || totalParticipants < 2) {
      return {
        value: 50, breakdown: { reason: 'no-official-games-yet', targetPercentile: null, actualPercentile: null },
      };
    }
    const targetPercentile = SPORTING_GOAL_TARGET_PERCENTILE[sportingGoalText] !== undefined
      ? SPORTING_GOAL_TARGET_PERCENTILE[sportingGoalText] : 0.25;
    const actualPercentile = clamp(1 - ((rank - 1) / (totalParticipants - 1)), 0, 1);
    const rawScore = actualPercentile >= targetPercentile
      ? 50 + ((actualPercentile - targetPercentile) / Math.max(0.0001, 1 - targetPercentile)) * 50
      : (actualPercentile / Math.max(0.0001, targetPercentile)) * 50;
    const progress = clamp(seasonProgressFraction !== undefined ? seasonProgressFraction : 1, 0, 1);
    // Regresión hacia 50 según progreso de temporada — un partido no puede
    // mover la confianza de golpe (sección 7.2).
    const regressed = 50 + (rawScore - 50) * progress;
    const recentFormDelta = clamp(recentFormDeltaRaw || 0, -10, 10);
    const value = clamp(Math.round(regressed + recentFormDelta), 0, 100);
    return {
      value,
      breakdown: {
        targetPercentile, actualPercentile, rawScore, seasonProgressFraction: progress, recentFormDelta,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Disciplina FINANCIERA (sección 7.2, política v1).
  // -----------------------------------------------------------------------
  function computeFinancialDisciplineConfidence(params) {
    const {
      hasBlockingOverdue, projectedSeasonResultBp, belowRequiredReserve, committedPlusReservedExceedsAllocation,
    } = params;
    if (hasBlockingOverdue) {
      return { value: 0, breakdown: { reason: 'blocking-overdue-payment' } };
    }
    let value = 70;
    const reasons = ['base-70-within-budget-no-arrears'];
    if ((projectedSeasonResultBp || 0) >= 500) { value += 10; reasons.push('projected-surplus-bonus'); }
    if (belowRequiredReserve) { value -= 15; reasons.push('below-required-cash-reserve'); }
    if (committedPlusReservedExceedsAllocation) { value -= 25; reasons.push('committed-exceeds-canonical-allocation'); }
    value = clamp(value, 0, 100);
    return { value, breakdown: { reasons } };
  }

  // -----------------------------------------------------------------------
  // Relación/antigüedad (sección 7.2, política v1).
  // -----------------------------------------------------------------------
  function computeRelationshipConfidence(params) {
    const { completedEmploymentMonths, seasonOutcomes } = params;
    const monthsBonus = clamp(completedEmploymentMonths || 0, 0, 24);
    let seasonAdjustment = 0;
    (seasonOutcomes || []).forEach((outcome) => {
      if (outcome === 'exceeded') seasonAdjustment += 10;
      else if (outcome === 'met') seasonAdjustment += 5;
      else if (outcome === 'failed') seasonAdjustment -= 10;
    });
    seasonAdjustment = clamp(seasonAdjustment, -25, 25);
    const value = clamp(40 + monthsBonus + seasonAdjustment, 0, 100);
    return { value, breakdown: { monthsBonus, seasonAdjustment } };
  }

  // -----------------------------------------------------------------------
  // Confianza global — media ponderada exacta de la sección 7.2.
  // -----------------------------------------------------------------------
  function computeOverallConfidence({ sporting, financialDiscipline, relationship }) {
    return clamp(Math.round((sporting * 45 + financialDiscipline * 35 + relationship * 20) / 100), 0, 100);
  }

  function computeAllDimensions(params) {
    const sporting = computeSportingConfidence(params.sporting);
    const financialDiscipline = computeFinancialDisciplineConfidence(params.financialDiscipline);
    const relationship = computeRelationshipConfidence(params.relationship);
    const overall = computeOverallConfidence({
      sporting: sporting.value, financialDiscipline: financialDiscipline.value, relationship: relationship.value,
    });
    return {
      policyVersion: POLICY_VERSION,
      overall,
      sporting,
      financialDiscipline,
      relationship,
    };
  }

  const exportsObj = {
    BoardConfidenceService: {
      POLICY_VERSION,
      assignFiscalStyles,
      willingnessBaseCeilingBp,
      structuredFinancialGoal,
      describeFinancialGoalEs,
      computeSportingConfidence,
      computeFinancialDisciplineConfidence,
      computeRelationshipConfidence,
      computeOverallConfidence,
      computeAllDimensions,
      SPORTING_GOAL_TARGET_PERCENTILE,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
