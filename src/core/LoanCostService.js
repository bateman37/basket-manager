// src/core/LoanCostService.js
// LOAN-1 (DESIGN.md 9.21, sección 16 del prompt) — proyecciones de
// EXPOSICIÓN económica de una cesión. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// `ContractService.guaranteedPayrollForClub()` sigue siendo la ÚNICA
// fuente de la obligación contractual BRUTA de un club (nunca se reescribe
// ni se reduce aquí — la responsabilidad solidaria española del art. 11.3
// no se reduce por el reparto interno pactado). Este servicio añade una
// vista SEPARADA — "cuánto retiene el propietario, cuánto asume el
// cesionario" — derivada SIEMPRE de `ContractRegistry` + `LoanRegistry` en
// el momento de la consulta, nunca guardada como una segunda verdad ni
// escrita en `team.finances.expenses.playerSalaries`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function M() { return MoneyModule.Money; }
  function LD() { return LocalDateModule.LocalDate; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // ---------------------------------------------------------------------
  // Reparto del coste SALARIAL bruto de un jugador cedido para UNA
  // temporada, según `salaryAllocation` del acuerdo — sección 8.5: la
  // distribución interna NUNCA altera el total del contrato matriz, solo
  // reparte quién lo "retiene" internamente. `Money.allocateByWeights`
  // garantiza que la suma cuadra exactamente al céntimo.
  // ---------------------------------------------------------------------
  function salaryAllocationForSeason(agreement, masterContract, seasonKey) {
    if (!masterContract || !masterContract.coveredSeasonKeys.includes(seasonKey)) {
      return { ownerRetainedMinor: 0, borrowerAssumedMinor: 0, currency: masterContract ? masterContract.compensation.currency : 'EUR' };
    }
    const breakdown = masterContract.breakdownForSeason(seasonKey);
    const [ownerRetainedMinor, borrowerAssumedMinor] = M().allocateByWeights(
      breakdown.guaranteedTotalMinor,
      [agreement.salaryAllocation.ownerShareBasisPoints, agreement.salaryAllocation.borrowerShareBasisPoints],
    );
    return { ownerRetainedMinor, borrowerAssumedMinor, currency: breakdown.currency };
  }

  // Exposición COMPLETA de un acuerdo — canon, participación y reparto
  // salarial, conceptos SEPARADOS (sección 16: "nunca sumados entre sí").
  function loanExposureForAgreement(params) {
    const { agreement, masterContract, seasonKey } = params;
    const salary = salaryAllocationForSeason(agreement, masterContract, seasonKey);
    return {
      loanAgreementId: agreement.id,
      seasonKey,
      currency: salary.currency,
      salary,
      loanFeeMinor: agreement.loanFee ? agreement.loanFee.amountMinor : 0,
      playerParticipationMinor: agreement.playerParticipation ? agreement.playerParticipation.amountMinor : 0,
      jointAndSeveralLiability: agreement.jointAndSeveralLiability || null,
      status: agreement.currentStatus(),
    };
  }

  // Agregado por CLUB (sección 16: "coste retenido del propietario, coste
  // asumido por cesionario, canon, participación, compromisos futuros") —
  // considera acuerdos ACTIVOS o AGREED (compromiso futuro ya pactado) del
  // club, tanto como propietario como cesionario, en la temporada dada.
  function loanExposureForClub(params) {
    const {
      clubId, loanRegistry, contractRegistry, seasonKey, date,
    } = params;
    const iso = date ? toIso(date) : null;
    const relevantStatuses = new Set(['agreed', 'active']);
    const asOwner = loanRegistry.agreementsForOwner(clubId).filter((a) => relevantStatuses.has(a.currentStatus()));
    const asBorrower = loanRegistry.agreementsForBorrower(clubId).filter((a) => relevantStatuses.has(a.currentStatus()));

    let retainedFromLoansOutMinor = 0;
    let assumedFromLoansInMinor = 0;
    let feeReceivableMinor = 0;
    let feePayableMinor = 0;
    let participationPayableMinor = 0;
    let currency = null;

    asOwner.forEach((agreement) => {
      const masterContract = contractRegistry.get(agreement.masterContractId);
      const exposure = loanExposureForAgreement({ agreement, masterContract, seasonKey });
      retainedFromLoansOutMinor += exposure.salary.ownerRetainedMinor;
      feeReceivableMinor += exposure.loanFeeMinor;
      participationPayableMinor += exposure.playerParticipationMinor;
      currency = currency || exposure.currency;
    });
    asBorrower.forEach((agreement) => {
      const masterContract = contractRegistry.get(agreement.masterContractId);
      const exposure = loanExposureForAgreement({ agreement, masterContract, seasonKey });
      assumedFromLoansInMinor += exposure.salary.borrowerAssumedMinor;
      feePayableMinor += exposure.loanFeeMinor;
      currency = currency || exposure.currency;
    });

    return {
      clubId,
      seasonKey,
      date: iso,
      currency: currency || 'EUR',
      retainedFromLoansOutMinor,
      assumedFromLoansInMinor,
      feeReceivableMinor,
      feePayableMinor,
      participationPayableMinor,
      loansOutCount: asOwner.length,
      loansInCount: asBorrower.length,
      // Recordatorio explícito (sección 16 del prompt): el reparto interno
      // NUNCA reduce la responsabilidad solidaria española frente al
      // jugador/Seguridad Social cuando aplica — esta cifra es una
      // proyección de EXPOSICIÓN, no un límite de responsabilidad legal.
      note: 'La responsabilidad solidaria (cuando aplica) no se reduce por este reparto interno.',
    };
  }

  const exportsObj = {
    LoanCostService: {
      salaryAllocationForSeason,
      loanExposureForAgreement,
      loanExposureForClub,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
