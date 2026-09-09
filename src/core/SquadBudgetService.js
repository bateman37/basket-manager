// src/core/SquadBudgetService.js
// SQUAD-BUDGET-1 — servicio de dominio del presupuesto salarial de
// plantilla: crea asignaciones (apertura/revisión) sobre
// `SquadBudgetRegistry` y deriva la vista de lectura pura que consume la
// pantalla Finanzas y los validadores de mercado/ciclo. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Principios de esta entrega (ver docs/architecture/squad-budget.md):
//  - el límite es SOLO uno de sporting/salary budget del club, nunca caja,
//    ingresos ni beneficio — todo texto de aviso lo deja explícito;
//  - las fórmulas de "compatibilidad" (`computeMarketCompatibilityAmount`/
//    `computeCycleCompatibilityAmount`) son copias EXACTAS de las que ya
//    usaban MarketService.computeInternalBudgetLimit()/
//    CpuRosterPlanner.computeCycleBudget() antes de esta entrega — se
//    preservan tal cual para congelar la asignación de apertura, nunca se
//    promedian ni se inventan multiplicadores nuevos;
//  - nada aquí muta Club/Team/Contract — solo lee y solo escribe en
//    `SquadBudgetRegistry`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;
  const LoanCostServiceModule = isNode ? require('./LoanCostService.js') : global.BasketManager;
  const SquadBudgetEntities = isNode ? require('../entities/SquadBudget.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function CC() { return CycleConfigModule.CycleConfig; }
  function LoanCostSvc() { return LoanCostServiceModule.LoanCostService; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function financialOf(team) {
    return (team && team.reputation && team.reputation.financial !== undefined) ? team.reputation.financial : 50;
  }

  // ---------------------------------------------------------------------
  // 1. Fórmulas de COMPATIBILIDAD — congelan el comportamiento provisional
  //    ya existente antes de esta entrega, nunca lo recalculan en directo.
  // ---------------------------------------------------------------------
  const POLICY_VERSIONS = Object.freeze({
    MARKET_COMPAT: 'compatibility-market-budget-v1',
    CYCLE_COMPAT: 'compatibility-cycle-budget-v1',
    MIGRATION_BACKFILL: 'migration-backfill-v1',
  });

  // Copia EXACTA de `MarketService.computeInternalBudgetLimit()` (rango de
  // multiplicador [1.15, 2.0], suelo 20.000.000 céntimos) — MarketService
  // conserva su propia función como fallback de compatibilidad para
  // llamadores que no aporten un `SquadBudgetRegistry` (scripts/tests
  // antiguos); esta es la MISMA fórmula, usada aquí solo para CONGELAR la
  // asignación de apertura una vez, nunca para recalcular en cada consulta.
  const MARKET_COMPAT_FLOOR_MINOR = 20000000;
  function computeMarketCompatibilityAmount(params) {
    const { team, contractRegistry, seasonKey } = params;
    const payroll = ContractSvc().guaranteedPayrollForClub(contractRegistry, team.clubId, seasonKey);
    const financial = financialOf(team);
    const multiplier = 1.15 + (financial / 100) * 0.85;
    const base = Math.max(payroll.amountMinor, MARKET_COMPAT_FLOOR_MINOR);
    return {
      amountMinor: Math.round(base * multiplier),
      currency: payroll.currency,
      basisAmountMinor: payroll.amountMinor,
      multiplier,
      policyVersion: POLICY_VERSIONS.MARKET_COMPAT,
    };
  }

  // Copia EXACTA de `CpuRosterPlanner.computeCycleBudget()` (usa
  // directamente `CycleConfig.BUDGET`, nunca una segunda copia de sus
  // números) — la referencia de nómina de apertura llega YA congelada por
  // `AnnualCycleService.freezeSnapshot()` antes de que expire ningún
  // contrato.
  function computeCycleCompatibilityAmount(params) {
    const { team, openingPayrollReferenceMinor, currency } = params;
    const cfg = CC().BUDGET;
    const financial = financialOf(team);
    const multiplier = cfg.openingPayrollMultiplierMin
      + (financial / 100) * (cfg.openingPayrollMultiplierMax - cfg.openingPayrollMultiplierMin);
    const base = Math.max(openingPayrollReferenceMinor || 0, cfg.floorMinor);
    return {
      amountMinor: Math.round(base * multiplier),
      currency: currency || 'EUR',
      basisAmountMinor: openingPayrollReferenceMinor || 0,
      multiplier,
      policyVersion: POLICY_VERSIONS.CYCLE_COMPAT,
    };
  }

  // ---------------------------------------------------------------------
  // 2. Apertura/revisión — IDEMPOTENTE por club+temporada+moneda.
  // ---------------------------------------------------------------------
  function nextRevisionId(registry, clubId, seasonKey, currency) {
    const chain = registry.chainFor(clubId, seasonKey, currency);
    return `squad-budget:${clubId}:${seasonKey}:${currency}:v${chain.length + 1}`;
  }

  // Crea la asignación de apertura si la cadena club+temporada+moneda
  // todavía no existe; si ya existe, la devuelve tal cual (`created: false`)
  // — repetir bootstrap/sincronización/cierre de temporada nunca duplica ni
  // recalcula el límite ya congelado.
  function ensureOpeningAllocation(params) {
    const {
      registry, clubId, seasonKey, currency, effectiveDate, amountMinor,
      policyVersion, basisAmountMinor, multiplier, revisionKind, decisionAuthority, note,
      calculatedAtGameDate,
    } = params;
    const cur = M().requireCurrency(currency || 'EUR');
    if (registry.hasChain(clubId, seasonKey, cur)) {
      return { created: false, allocation: registry.effectiveAllocationFor(clubId, seasonKey, cur) };
    }
    const iso = toIso(effectiveDate);
    const allocation = new SquadBudgetEntities.SquadBudgetAllocation({
      id: nextRevisionId(registry, clubId, seasonKey, cur),
      clubId,
      seasonKey,
      currency: cur,
      amountMinor: M().requireAmountMinor(amountMinor, 'amountMinor'),
      effectiveDate: iso,
      createdAtGameDate: calculatedAtGameDate ? toIso(calculatedAtGameDate) : iso,
      revisionKind: revisionKind || 'opening-allocation',
      decisionAuthority: decisionAuthority || 'board-system-seed',
      predecessorId: null,
      provenance: {
        dataSource: 'simulated-squad-budget-v1', policyVersion, basisAmountMinor, multiplier, calculatedAtGameDate: calculatedAtGameDate ? toIso(calculatedAtGameDate) : iso, note,
      },
    });
    registry.registerAllocation(allocation);
    return { created: true, allocation };
  }

  // Revisión EXPLÍCITA y auditable sobre una cadena ya existente (o la
  // primera de una cadena nueva, si nadie la abrió todavía) — nunca edita
  // una asignación ya registrada, siempre encadena una nueva con
  // `predecessorId`. Sin UI jugable todavía (ver §4.3/§10 del prompt): este
  // mecanismo es el punto de entrada que usará la futura pantalla de
  // peticiones a la junta, no un atajo para el usuario hoy.
  function recordRevision(params) {
    const {
      registry, clubId, seasonKey, currency, effectiveDate, amountMinor,
      revisionKind, decisionAuthority, note, calculatedAtGameDate,
    } = params;
    const cur = M().requireCurrency(currency || 'EUR');
    const predecessor = registry.effectiveAllocationFor(clubId, seasonKey, cur);
    const iso = toIso(effectiveDate);
    const allocation = new SquadBudgetEntities.SquadBudgetAllocation({
      id: nextRevisionId(registry, clubId, seasonKey, cur),
      clubId,
      seasonKey,
      currency: cur,
      amountMinor: M().requireAmountMinor(amountMinor, 'amountMinor'),
      effectiveDate: iso,
      createdAtGameDate: calculatedAtGameDate ? toIso(calculatedAtGameDate) : iso,
      revisionKind: revisionKind || 'board-revision',
      decisionAuthority: decisionAuthority || 'board-manual',
      predecessorId: predecessor ? predecessor.id : null,
      provenance: {
        dataSource: 'simulated-squad-budget-v1',
        policyVersion: 'board-manual-revision-v1',
        basisAmountMinor: predecessor ? predecessor.amountMinor : null,
        multiplier: null,
        calculatedAtGameDate: calculatedAtGameDate ? toIso(calculatedAtGameDate) : iso,
        note,
      },
    });
    registry.registerAllocation(allocation);
    return allocation;
  }

  // ---------------------------------------------------------------------
  // 3. Lectura pura — nunca almacena nada, siempre deriva.
  // ---------------------------------------------------------------------
  // Coste salarial REAL de un club para una temporada, ajustado por cesiones
  // (LOAN-1, `LoanCostService`, nunca duplicado aquí): el propietario de un
  // cedido retiene solo su parte, el cesionario asume su parte, aunque el
  // contrato matriz siga contando entero en `guaranteedPayrollForClub()`
  // (su `clubId` sigue siendo el del propietario mientras dura la cesión).
  function adjustedCommittedForLoans(params) {
    const {
      clubId, seasonKey, contractRegistry, loanRegistry, atGameDate,
    } = params;
    const committed = ContractSvc().guaranteedPayrollForClub(contractRegistry, clubId, seasonKey);
    if (!loanRegistry) return { amountMinor: committed.amountMinor, currency: committed.currency, loanRows: [] };
    const iso = atGameDate ? toIso(atGameDate) : null;
    const relevant = new Set(['agreed', 'active']);
    const loanRows = [];
    let adjustment = 0;
    loanRegistry.agreementsForOwner(clubId).filter((a) => relevant.has(a.currentStatus())).forEach((agreement) => {
      const masterContract = contractRegistry.get(agreement.masterContractId);
      const alloc = LoanCostSvc().salaryAllocationForSeason(agreement, masterContract, seasonKey);
      if (alloc.borrowerAssumedMinor) {
        adjustment -= alloc.borrowerAssumedMinor;
        loanRows.push({
          playerId: masterContract.playerId, loanAgreementId: agreement.id, role: 'loaned-out', borrowerClubId: agreement.borrowerClubId, amountMinor: alloc.ownerRetainedMinor, currency: alloc.currency,
        });
      }
    });
    loanRegistry.agreementsForBorrower(clubId).filter((a) => relevant.has(a.currentStatus())).forEach((agreement) => {
      const masterContract = contractRegistry.get(agreement.masterContractId);
      const alloc = LoanCostSvc().salaryAllocationForSeason(agreement, masterContract, seasonKey);
      if (alloc.borrowerAssumedMinor) {
        adjustment += alloc.borrowerAssumedMinor;
        loanRows.push({
          playerId: masterContract.playerId, loanAgreementId: agreement.id, role: 'loaned-in', ownerClubId: agreement.ownerClubId, amountMinor: alloc.borrowerAssumedMinor, currency: alloc.currency,
        });
      }
    });
    void iso;
    return { amountMinor: committed.amountMinor + adjustment, currency: committed.currency, loanRows };
  }

  // Vista de lectura completa — item 6 del contrato canónico. Nunca
  // almacena ninguno de estos totales: siempre se recalculan al vuelo desde
  // ContractRegistry/MarketRegistry/LoanRegistry + la asignación efectiva.
  function deriveBudgetView(params) {
    const {
      registry, clubId, seasonKey, currency, atGameDate, contractRegistry, marketRegistry, loanRegistry,
    } = params;
    const cur = M().requireCurrency(currency || 'EUR');
    const allocation = registry ? registry.effectiveAllocationFor(clubId, seasonKey, cur, atGameDate) : null;
    const limitMinor = allocation ? allocation.amountMinor : 0;
    const committed = adjustedCommittedForLoans({
      clubId, seasonKey, contractRegistry, loanRegistry, atGameDate,
    });
    const reservedMinor = marketRegistry ? marketRegistry.reservedTotalForClubSeason(clubId, seasonKey) : 0;
    const availableMinor = Math.max(0, limitMinor - committed.amountMinor - reservedMinor);
    const overcommittedMinor = Math.max(0, (committed.amountMinor + reservedMinor) - limitMinor);
    const variableMax = ContractSvc().potentialVariableCompensationForClub(contractRegistry, clubId, seasonKey);
    const benefits = ContractSvc().benefitsValueForClub(contractRegistry, clubId, seasonKey);
    const agentCosts = ContractSvc().agentCostsForClub(contractRegistry, clubId, seasonKey);
    const playerRows = contractRegistry.forClubInSeason(clubId, seasonKey).map((contract) => {
      const breakdown = contract.breakdownForSeason(seasonKey);
      const loanRow = committed.loanRows.find((r) => r.playerId === contract.playerId && r.role === 'loaned-out');
      return {
        playerId: contract.playerId,
        contractId: contract.id,
        guaranteedTotalMinor: breakdown.guaranteedTotalMinor,
        variableMaxMinor: breakdown.variableMaxMinor,
        currency: breakdown.currency,
        loanBadge: loanRow ? 'loaned-out' : null,
        chargedToThisClubMinor: loanRow ? loanRow.amountMinor : breakdown.guaranteedTotalMinor,
        otherClubId: loanRow ? loanRow.borrowerClubId : null,
      };
    });
    committed.loanRows.filter((r) => r.role === 'loaned-in').forEach((r) => {
      playerRows.push({
        playerId: r.playerId,
        contractId: null,
        guaranteedTotalMinor: 0,
        variableMaxMinor: 0,
        currency: r.currency,
        loanBadge: 'loaned-in',
        chargedToThisClubMinor: r.amountMinor,
        otherClubId: r.ownerClubId,
      });
    });
    playerRows.sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
    return {
      clubId,
      seasonKey,
      currency: cur,
      hasAllocation: Boolean(allocation),
      allocation: allocation ? allocation.toJSON() : null,
      limitMinor,
      committedMinor: committed.amountMinor,
      reservedMinor,
      availableMinor,
      overcommittedMinor,
      percentageUsed: limitMinor > 0 ? Math.round(((committed.amountMinor + reservedMinor) / limitMinor) * 100) : null,
      variableMaxMinor: variableMax.amountMinor,
      benefitsValueMinor: benefits.amountMinor,
      agentCostsMinor: agentCosts.amountMinor,
      playerRows,
      warnings: [
        'Presupuesto salarial de plantilla (sporting salary budget) — no es caja del club, ingresos ni beneficio.',
        ...(allocation && allocation.revisionKind !== 'board-revision'
          ? ['Asignación estimada de compatibilidad para esta partida; no es un dato financiero real del club.'] : []),
      ],
    };
  }

  // ---------------------------------------------------------------------
  // 4. Validación de una operación de mercado contra el límite CANÓNICO —
  //    atómica por temporada: cualquier temporada cubierta que no quepa
  //    bloquea la operación entera, con detalle estructurado (nunca solo
  //    un string para que la UI lo parsee).
  // ---------------------------------------------------------------------
  function validateAdditionsAgainstBudget(params) {
    const {
      registry, clubId, currency, atGameDate, contractRegistry, marketRegistry, loanRegistry,
      additionsBySeasonKey, // { [seasonKey]: attemptedAdditionMinor }
    } = params;
    const shortfalls = [];
    const viewsBySeasonKey = {};
    Object.keys(additionsBySeasonKey || {}).forEach((seasonKey) => {
      const view = deriveBudgetView({
        registry, clubId, seasonKey, currency, atGameDate, contractRegistry, marketRegistry, loanRegistry,
      });
      viewsBySeasonKey[seasonKey] = view;
      const attemptedAdditionMinor = additionsBySeasonKey[seasonKey];
      if (attemptedAdditionMinor > view.availableMinor) {
        shortfalls.push({
          seasonKey,
          currency: view.currency,
          limitMinor: view.limitMinor,
          committedMinor: view.committedMinor,
          reservedMinor: view.reservedMinor,
          attemptedAdditionMinor,
          shortfallMinor: attemptedAdditionMinor - view.availableMinor,
        });
      }
    });
    return {
      ok: shortfalls.length === 0,
      shortfalls,
      viewsBySeasonKey,
      message: shortfalls.length
        ? 'La operación supera el presupuesto salarial disponible del club y no puede completarse; se necesitaría '
          + 'autorización de la junta para ampliar el límite. Las peticiones de ampliación de presupuesto a la junta '
          + 'no están disponibles todavía — llegarán en la próxima entrega de economía/junta.'
        : null,
    };
  }

  const exportsObj = {
    SquadBudgetService: {
      POLICY_VERSIONS,
      computeMarketCompatibilityAmount,
      computeCycleCompatibilityAmount,
      ensureOpeningAllocation,
      recordRevision,
      deriveBudgetView,
      validateAdditionsAgainstBudget,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
