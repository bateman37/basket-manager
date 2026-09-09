// src/core/ClubFinanceService.js
// ECONOMY-BOARD-1 — servicio de dominio de la economía real del club:
// arquetipo, plan anual, calendario de cobros/pagos, tesorería derivada,
// impagos/reintentos y proyección a tres temporadas. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Nada aquí muta Club/Team/Contract — solo lee y solo escribe en
// `ClubFinanceRegistry`. `SquadBudgetRegistry` es una dependencia de
// LECTURA (el ancla salarial) salvo por `resolveSalaryAnchor()`, que puede
// crear una asignación `forward-board-allocation` cuando falta el límite
// canónico de una temporada futura dentro del horizonte — nunca recalcula
// ni sobrescribe la asignación EFECTIVA ya existente.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;
  const ClubFinanceEntities = isNode ? require('../entities/ClubFinance.js') : global.BasketManager;
  const ClubFinancePolicyModule = isNode ? require('./ClubFinancePolicy.js') : global.BasketManager;
  const SquadBudgetServiceModule = isNode ? require('./SquadBudgetService.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }
  function DR() { return DeterministicRandomModule.DeterministicRandom; }
  function Policy() { return ClubFinancePolicyModule.ClubFinancePolicy; }
  function SquadBudgetSvc() { return SquadBudgetServiceModule.SquadBudgetService; }

  const {
    ClubFinanceProfile, SeasonFinancialPlan, ScheduledCashFlowItem, FinancePosting,
    CLUB_FINANCE_INCOME_CATEGORIES: INCOME_CATEGORIES,
  } = ClubFinanceEntities;

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // =========================================================================
  // 1. Arquetipo — determinista por careerSeed+clubId, sin `Math.random()`.
  //    Round-robin ACOTADO por tercios sobre el orden de hash estable, para
  //    que una carrera no pueda sembrar accidentalmente el mismo arquetipo
  //    a los 36 clubes (sección 5.3 del prompt).
  // =========================================================================
  const ARCHETYPE_ORDER = ['tight', 'balanced', 'comfortable'];

  function assignArchetypes(clubIds, careerSeed) {
    const withHash = [...clubIds].map((clubId) => ({
      clubId, hash: DR().hash32(`${careerSeed}#club-finance-archetype#${clubId}`),
    }));
    withHash.sort((a, b) => (a.hash - b.hash) || (a.clubId < b.clubId ? -1 : 1));
    const byClubId = new Map();
    withHash.forEach((entry, index) => byClubId.set(entry.clubId, ARCHETYPE_ORDER[index % 3]));
    return byClubId;
  }

  // =========================================================================
  // 2. Perfil — fijado UNA vez por carrera, nunca reasignado en temporadas
  //    posteriores.
  // =========================================================================
  function ensureClubProfile(params) {
    const {
      registry, clubId, currency, archetype, careerSeed, calculatedAtGameDate,
    } = params;
    if (registry.hasProfile(clubId)) return { created: false, profile: registry.profileFor(clubId) };
    const profile = new ClubFinanceProfile({
      id: `club-finance-profile:${clubId}`,
      clubId,
      currency: M().requireCurrency(currency || 'EUR'),
      archetype,
      provenance: {
        dataSource: 'simulated-club-finance-v1',
        policyVersion: Policy().POLICY_VERSION,
        careerSeed,
        calculatedAtGameDate: toIso(calculatedAtGameDate),
      },
    });
    registry.registerProfile(profile);
    return { created: true, profile };
  }

  // =========================================================================
  // 3. Ancla salarial — asignación EFECTIVA canónica, o `forward-board-
  //    allocation` cuando una temporada futura del horizonte todavía no
  //    tiene límite propio (sección 5.4). Nunca usa la fórmula de
  //    compatibilidad en directo para una temporada futura del horizonte.
  // =========================================================================
  function resolveSalaryAnchor(params) {
    const {
      squadBudgetRegistry, clubId, seasonKey, currency, atGameDate,
    } = params;
    const cur = M().requireCurrency(currency || 'EUR');
    const existing = squadBudgetRegistry.effectiveAllocationFor(clubId, seasonKey, cur, atGameDate);
    if (existing) return { allocation: existing, created: false };
    // Temporada futura sin límite propio: se traslada el límite canónico de
    // la temporada INMEDIATAMENTE anterior con crecimiento cero — nunca la
    // fórmula de compatibilidad en directo para una temporada futura dentro
    // del horizonte (invariante explícita del prompt).
    const previousSeasonKey = LD().addSeasons(seasonKey, -1);
    const previous = squadBudgetRegistry.effectiveAllocationFor(clubId, previousSeasonKey, cur);
    if (!previous) {
      throw new Error(
        `ClubFinanceService.resolveSalaryAnchor: el club "${clubId}" no tiene asignación salarial canónica ni para `
        + `"${seasonKey}" ni para la temporada anterior "${previousSeasonKey}" — no se puede construir un plan `
        + 'financiero sin un ancla salarial real.',
      );
    }
    const allocation = SquadBudgetSvc().recordRevision({
      registry: squadBudgetRegistry,
      clubId,
      seasonKey,
      currency: cur,
      effectiveDate: toIso(atGameDate),
      amountMinor: previous.amountMinor,
      revisionKind: 'forward-board-allocation',
      decisionAuthority: 'board-system',
      calculatedAtGameDate: toIso(atGameDate),
      note: `Trasladado sin crecimiento desde "${previousSeasonKey}" (${previous.amountMinor} ${cur}) al construir el `
        + `plan financiero de "${seasonKey}" dentro del horizonte de proyección.`,
    });
    return { allocation, created: true };
  }

  // =========================================================================
  // 4. Plan anual — construcción IDEMPOTENTE (una vez por club+temporada+
  //    moneda; una revisión posterior nunca recalcula ingreso/caja de
  //    apertura ya fijados).
  // =========================================================================
  function buildSeasonPlan(params) {
    const {
      registry, squadBudgetRegistry, clubId, seasonKey, currency, calculatedAtGameDate,
      expectedHomeGames, revisionKind, isCareerOpening,
    } = params;
    const cur = M().requireCurrency(currency || 'EUR');
    if (registry.hasPlan(clubId, seasonKey, cur)) {
      return { created: false, plan: registry.effectivePlanFor(clubId, seasonKey, cur) };
    }
    const profile = registry.profileFor(clubId);
    if (!profile) {
      throw new Error(`ClubFinanceService.buildSeasonPlan: el club "${clubId}" no tiene ClubFinanceProfile todavía.`);
    }
    const archetypePolicy = Policy().requireArchetype(profile.archetype);
    const { allocation } = resolveSalaryAnchor({
      squadBudgetRegistry, clubId, seasonKey, currency: cur, atGameDate: calculatedAtGameDate,
    });
    const salaryAnchorMinor = allocation.amountMinor;
    // plannedIncome = salaryAnchor / salaryShare — inversa exacta de la
    // fórmula de la tabla del prompt (sección 5.3).
    const plannedIncomeMinor = Math.round((salaryAnchorMinor * 10000) / archetypePolicy.salaryShareBp);
    const targetMarginMinor = Math.round((plannedIncomeMinor * archetypePolicy.targetMarginBp) / 10000);
    const nonSalaryExpensePoolMinor = Math.max(0, plannedIncomeMinor - salaryAnchorMinor - targetMarginMinor);

    const incomeWeights = INCOME_CATEGORIES.map((key) => Policy().INCOME_MIX_BP[key]);
    const incomeParts = M().allocateByWeights(plannedIncomeMinor, incomeWeights);
    const incomeByCategoryMinor = {};
    INCOME_CATEGORIES.forEach((key, index) => { incomeByCategoryMinor[key] = incomeParts[index]; });

    const nonSalaryKeys = ['coachingStaffAggregate', 'facilitiesMaintenance', 'clubOperations'];
    const nonSalaryWeights = nonSalaryKeys.map((key) => Policy().NON_SALARY_EXPENSE_SPLIT_BP[key]);
    const nonSalaryParts = M().allocateByWeights(nonSalaryExpensePoolMinor, nonSalaryWeights);
    const expenseByCategoryMinor = {
      playerSalaries: salaryAnchorMinor,
      coachingStaffAggregate: nonSalaryParts[0],
      facilitiesMaintenance: nonSalaryParts[1],
      clubOperations: nonSalaryParts[2],
      transferAndLoanObligations: 0,
      agentAndSettlementObligations: 0,
    };

    const games = Number.isFinite(expectedHomeGames) && expectedHomeGames > 0 ? expectedHomeGames : 1;
    const ticketBaselinePerGameMinor = Math.floor(incomeByCategoryMinor.ticketSales / games);

    let openingCashMinor = null;
    if (isCareerOpening) {
      const totalPlannedAnnualOutflowMinor = salaryAnchorMinor + nonSalaryExpensePoolMinor;
      openingCashMinor = Math.round((totalPlannedAnnualOutflowMinor * archetypePolicy.openingCashBufferMonths) / 12);
    }

    const chainLength = registry.planChainFor(clubId, seasonKey, cur).length;
    const plan = new SeasonFinancialPlan({
      id: `club-finance-plan:${clubId}:${seasonKey}:${cur}:v${chainLength + 1}`,
      clubId,
      seasonKey,
      currency: cur,
      revisionKind: revisionKind || (isCareerOpening ? 'opening-plan' : 'season-opening-plan'),
      predecessorId: null,
      archetype: profile.archetype,
      salaryAnchorMinor,
      plannedIncomeMinor,
      targetMarginMinor,
      nonSalaryExpensePoolMinor,
      incomeByCategoryMinor,
      expenseByCategoryMinor,
      expectedHomeGames: games,
      ticketBaselinePerGameMinor,
      openingCashMinor,
      createdAtGameDate: toIso(calculatedAtGameDate),
      provenance: {
        dataSource: 'simulated-club-finance-v1',
        policyVersion: Policy().POLICY_VERSION,
        note: `Ancla salarial ${salaryAnchorMinor} ${cur} (arquetipo "${profile.archetype}").`,
      },
    });
    registry.registerPlan(plan);

    if (openingCashMinor !== null) {
      const posting = new FinancePosting({
        id: `posting:club-finance-opening:${clubId}:${cur}`,
        clubId,
        currency: cur,
        kind: 'opening-balance',
        amountMinor: openingCashMinor,
        category: null,
        scheduledItemId: null,
        gameDate: toIso(calculatedAtGameDate),
        note: `Colchón de apertura: ${archetypePolicy.openingCashBufferMonths} meses de gasto anual planificado.`,
      });
      registry.registerPosting(posting);
    }

    return { created: true, plan };
  }

  // =========================================================================
  // 5. Calendario de cobros/pagos — creación IDEMPOTENTE de items fechados
  //    a partir del plan/contratos/obligaciones YA conocidos. Los ids se
  //    construyen para que, a igualdad de fecha, un `inflow` ordene siempre
  //    ANTES que un `outflow` del mismo club (sección 5.6: "se procesan
  //    inflows antes que outflows en la misma fecha").
  // =========================================================================
  function itemId(clubId, dueDate, direction, discriminator) {
    return `finance:${clubId}:${dueDate}:${direction === 'inflow' ? '0' : '1'}:${discriminator}`;
  }

  // `notBeforeDate` (sección 11 del prompt — migración v1/v2): un guardado
  // migrado a mitad de temporada nunca programa retroactivamente un mes ya
  // pasado — los contratos/ingresos anteriores a la fecha de migración
  // quedan como evidencia "migration-assumed-settled" (implícita en la
  // caja de apertura), nunca como una posting inventada.
  function isBeforeFloor(dueDate, notBeforeDate) {
    return Boolean(notBeforeDate) && LD().compare(dueDate, notBeforeDate) < 0;
  }

  function scheduleMonthlyCategory(params) {
    const {
      registry, clubId, currency, seasonKey, direction, category, totalMinor, seasonStartDate, discriminatorPrefix, notBeforeDate,
    } = params;
    if (totalMinor <= 0) return;
    const parts = M().allocate(totalMinor, 12);
    for (let i = 0; i < 12; i += 1) {
      const dueDate = LD().addMonths(seasonStartDate, i);
      if (isBeforeFloor(dueDate, notBeforeDate)) continue;
      const id = itemId(clubId, dueDate, direction, `${discriminatorPrefix}:${i}`);
      if (registry.hasScheduledItem(id)) continue;
      registry.registerScheduledItem(new ScheduledCashFlowItem({
        id,
        clubId,
        currency,
        direction,
        category,
        amountMinor: parts[i],
        dueDate,
        seasonKey,
        sourceRef: { type: `${discriminatorPrefix}-monthly`, id: `${clubId}:${seasonKey}:${discriminatorPrefix}:${i}` },
        createdAtGameDate: seasonStartDate,
      }));
    }
  }

  // Cadena de pago en efectivo de un contrato — usa `paymentPolicy.schedule`
  // real cuando existe para esa temporada; si el contrato cubre la
  // temporada pero no trae calendario usable, deriva uno mensual SOLO para
  // finanzas (nunca reescribe `Contract`), etiquetado como backfill
  // (sección 5.6).
  function resolveContractCashSchedule(contract, seasonKey) {
    const real = (contract.paymentPolicy.schedule || []).filter((i) => i.seasonKey === seasonKey);
    if (real.length) {
      return { installments: real, backfilled: false };
    }
    const season = contract.compensation.seasons.find((s) => s.seasonKey === seasonKey);
    if (!season) return { installments: [], backfilled: false };
    const cashMinor = season.guaranteedBaseSalaryMinor + season.guaranteedImageRightsMinor;
    if (cashMinor <= 0) return { installments: [], backfilled: false };
    const window = LD().seasonWindow(seasonKey);
    const parts = M().allocate(cashMinor, 12);
    const installments = parts.map((amountMinor, index) => ({
      seasonKey, index, dueDate: LD().addMonths(window.startDate, index), amountMinor, currency: contract.compensation.currency,
    }));
    return { installments, backfilled: true };
  }

  function scheduleContractSalaries(params) {
    const {
      registry, clubId, currency, seasonKey, contractRegistry, notBeforeDate,
    } = params;
    contractRegistry.forClubInSeason(clubId, seasonKey).forEach((contract) => {
      const { installments, backfilled } = resolveContractCashSchedule(contract, seasonKey);
      installments.forEach((installment) => {
        if (isBeforeFloor(installment.dueDate, notBeforeDate)) return;
        const id = itemId(clubId, installment.dueDate, 'outflow', `salary:${contract.id}:${installment.index}`);
        if (registry.hasScheduledItem(id)) return;
        registry.registerScheduledItem(new ScheduledCashFlowItem({
          id,
          clubId,
          currency,
          direction: 'outflow',
          category: 'playerSalaries',
          amountMinor: installment.amountMinor,
          dueDate: installment.dueDate,
          seasonKey,
          sourceRef: { type: 'salary-installment', id: `${contract.id}:${installment.index}` },
          createdAtGameDate: installment.dueDate,
          note: backfilled ? 'simulated-payment-schedule-backfill-v1' : null,
        }));
      });
    });
  }

  const OBLIGATION_TO_EXPENSE_CATEGORY = {
    'transfer-fee': 'transferAndLoanObligations',
    'player-transfer-participation': 'transferAndLoanObligations',
    'release-clause-amount': 'transferAndLoanObligations',
    'mutual-termination-settlement': 'transferAndLoanObligations',
    'employer-termination-compensation': 'transferAndLoanObligations',
    'rights-waiver-compensation': 'transferAndLoanObligations',
    'loan-fee': 'transferAndLoanObligations',
    'player-loan-participation': 'transferAndLoanObligations',
    'salary-reimbursement': 'transferAndLoanObligations',
    'reciprocal-loan-player-minimum': 'transferAndLoanObligations',
    'early-return-settlement': 'transferAndLoanObligations',
    'purchase-option-price': 'transferAndLoanObligations',
    'purchase-obligation-price': 'transferAndLoanObligations',
    'agent-fee': 'agentAndSettlementObligations',
  };

  // Compromisos de traspaso/cesión/agente con fecha real conocida
  // (`dueDate` o `schedule[]`) — los que no tienen ninguna fecha quedan
  // como exposición NO programada (ver `unscheduledExposureForClub()`),
  // nunca con una fecha inventada.
  function scheduleFinancialObligations(params) {
    const {
      registry, clubId, seasonKey, transferRegistry, notBeforeDate,
    } = params;
    if (!transferRegistry) return;
    const window = LD().seasonWindow(seasonKey);
    transferRegistry.allObligations()
      .filter((o) => o.status === 'committed' && o.debtorType === 'club' && o.debtorId === clubId)
      .forEach((obligation) => {
        const category = OBLIGATION_TO_EXPENSE_CATEGORY[obligation.concept] || 'transferAndLoanObligations';
        const lines = obligation.schedule && obligation.schedule.length
          ? obligation.schedule
          : (obligation.dueDate ? [{ dueDate: obligation.dueDate, amountMinor: obligation.amountMinor, currency: obligation.currency }] : []);
        lines.forEach((line, index) => {
          if (!LD().isWithinInclusive(line.dueDate, window.startDate, window.endDate)) return;
          if (isBeforeFloor(line.dueDate, notBeforeDate)) return;
          const id = itemId(clubId, line.dueDate, 'outflow', `obligation:${obligation.id}:${index}`);
          if (registry.hasScheduledItem(id)) return;
          registry.registerScheduledItem(new ScheduledCashFlowItem({
            id,
            clubId,
            currency: line.currency || obligation.currency,
            direction: 'outflow',
            category,
            amountMinor: line.amountMinor,
            dueDate: line.dueDate,
            seasonKey,
            mandatory: true,
            counterpartyClubId: obligation.creditorType === 'club' ? obligation.creditorId : null,
            sourceRef: { type: 'financial-obligation', id: `${obligation.id}:${index}` },
            createdAtGameDate: line.dueDate,
          }));
        });
      });
  }

  // Compromisos SIN ninguna fecha resoluble — visibles como exposición
  // comprometida, nunca fechados artificialmente (sección 5.6).
  function unscheduledExposureForClub(clubId, transferRegistry) {
    if (!transferRegistry) return [];
    return transferRegistry.allObligations()
      .filter((o) => o.status === 'committed' && o.debtorType === 'club' && o.debtorId === clubId
        && !o.dueDate && (!o.schedule || !o.schedule.length))
      .map((o) => ({
        id: o.id, concept: o.concept, amountMinor: o.amountMinor, currency: o.currency,
      }));
  }

  // Asegura (idempotente) que TODOS los items fechados conocidos de un plan
  // ya construido existan en el registro — llamado en cada sincronización
  // del calendario (ver `createClubFinanceEventSource`), nunca crea una
  // fecha nueva para lo que ya no tiene fecha real.
  function ensureScheduledItemsForClubPlan(params) {
    const {
      registry, clubId, plan, contractRegistry, transferRegistry, notBeforeDate,
    } = params;
    const window = LD().seasonWindow(plan.seasonKey);
    scheduleMonthlyCategory({
      registry, clubId, currency: plan.currency, seasonKey: plan.seasonKey, direction: 'inflow',
      category: 'mainSponsorship', totalMinor: plan.incomeByCategoryMinor.mainSponsorship,
      seasonStartDate: window.startDate, discriminatorPrefix: 'mainSponsorship', notBeforeDate,
    });
    scheduleMonthlyCategory({
      registry, clubId, currency: plan.currency, seasonKey: plan.seasonKey, direction: 'inflow',
      category: 'secondarySponsorship', totalMinor: plan.incomeByCategoryMinor.secondarySponsorship,
      seasonStartDate: window.startDate, discriminatorPrefix: 'secondarySponsorship', notBeforeDate,
    });
    scheduleMonthlyCategory({
      registry, clubId, currency: plan.currency, seasonKey: plan.seasonKey, direction: 'inflow',
      category: 'merchandising', totalMinor: plan.incomeByCategoryMinor.merchandising,
      seasonStartDate: window.startDate, discriminatorPrefix: 'merchandising', notBeforeDate,
    });
    // TV/reparto de liga — tres tramos iguales (apertura/mitad/cierre de
    // temporada) en v1; el ajuste por méritos deportivos del tramo de
    // cierre queda como refinamiento explícito pendiente (ver docs).
    [['tvRights', 'tv'], ['leagueRevenueShare', 'league']].forEach(([category, prefix]) => {
      const total = plan.incomeByCategoryMinor[category];
      if (total <= 0) return;
      const parts = M().allocate(total, 3);
      const dueDates = [window.startDate, LD().addMonths(window.startDate, 6), window.endDate];
      dueDates.forEach((dueDate, index) => {
        if (isBeforeFloor(dueDate, notBeforeDate)) return;
        const id = itemId(clubId, dueDate, 'inflow', `${prefix}-tranche:${index}`);
        if (registry.hasScheduledItem(id)) return;
        registry.registerScheduledItem(new ScheduledCashFlowItem({
          id,
          clubId,
          currency: plan.currency,
          direction: 'inflow',
          category,
          amountMinor: parts[index],
          dueDate,
          seasonKey: plan.seasonKey,
          sourceRef: { type: `${prefix}-tranche`, id: `${clubId}:${plan.seasonKey}:${index}` },
          createdAtGameDate: window.startDate,
        }));
      });
    });
    scheduleMonthlyCategory({
      registry, clubId, currency: plan.currency, seasonKey: plan.seasonKey, direction: 'outflow',
      category: 'coachingStaffAggregate', totalMinor: plan.expenseByCategoryMinor.coachingStaffAggregate,
      seasonStartDate: window.startDate, discriminatorPrefix: 'coachingStaffAggregate', notBeforeDate,
    });
    scheduleMonthlyCategory({
      registry, clubId, currency: plan.currency, seasonKey: plan.seasonKey, direction: 'outflow',
      category: 'facilitiesMaintenance', totalMinor: plan.expenseByCategoryMinor.facilitiesMaintenance,
      seasonStartDate: window.startDate, discriminatorPrefix: 'facilitiesMaintenance', notBeforeDate,
    });
    scheduleMonthlyCategory({
      registry, clubId, currency: plan.currency, seasonKey: plan.seasonKey, direction: 'outflow',
      category: 'clubOperations', totalMinor: plan.expenseByCategoryMinor.clubOperations,
      seasonStartDate: window.startDate, discriminatorPrefix: 'clubOperations', notBeforeDate,
    });
    if (contractRegistry) {
      scheduleContractSalaries({
        registry, clubId, currency: plan.currency, seasonKey: plan.seasonKey, contractRegistry, notBeforeDate,
      });
    }
    if (transferRegistry) {
      scheduleFinancialObligations({
        registry, clubId, seasonKey: plan.seasonKey, transferRegistry, notBeforeDate,
      });
    }
  }

  function ensureScheduledItemsForAllPlans(params) {
    const {
      registry, clubIds, contractRegistry, transferRegistry, notBeforeDate,
    } = params;
    clubIds.forEach((clubId) => {
      registry.plansForClub(clubId).forEach((plan) => {
        ensureScheduledItemsForClubPlan({
          registry, clubId, plan, contractRegistry, transferRegistry, notBeforeDate,
        });
      });
    });
  }

  // =========================================================================
  // 6. Resolución de un item fechado — nunca deja la caja en negativo; un
  //    pago que no cabe se convierte en UN impago durable (nunca parcial).
  //    Tras resolver, reintenta (en orden estable) los impagos del mismo
  //    club que ahora SÍ quepan (sección 4.4).
  // =========================================================================
  function settleClubToClub(registry, item, atGameDate) {
    const debitId = `posting:${item.id}`;
    if (!registry.hasPosting(debitId)) {
      registry.registerPosting(new FinancePosting({
        id: debitId,
        clubId: item.clubId,
        currency: item.currency,
        kind: 'debit',
        amountMinor: item.amountMinor,
        category: item.category,
        scheduledItemId: item.id,
        counterpartyClubId: item.counterpartyClubId,
        gameDate: atGameDate,
        correlationId: item.id,
      }));
    }
    if (item.counterpartyClubId) {
      const creditId = `posting:${item.id}:credit`;
      if (!registry.hasPosting(creditId)) {
        registry.registerPosting(new FinancePosting({
          id: creditId,
          clubId: item.counterpartyClubId,
          currency: item.currency,
          kind: 'credit',
          amountMinor: item.amountMinor,
          category: item.category,
          scheduledItemId: item.id,
          counterpartyClubId: item.clubId,
          gameDate: atGameDate,
          correlationId: item.id,
        }));
      }
    }
    item.markPosted(debitId, atGameDate);
  }

  function retryOverdueForClub(registry, clubId, currency, atGameDate) {
    const settled = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      const overdue = registry.overdueItemsForClub(clubId).filter((i) => i.currency === currency);
      for (let idx = 0; idx < overdue.length; idx += 1) {
        const item = overdue[idx];
        const balance = registry.treasuryBalance(clubId, currency);
        if (balance >= item.amountMinor) {
          settleClubToClub(registry, item, atGameDate);
          settled.push(item);
          progressed = true;
          break;
        }
      }
    }
    return settled;
  }

  function resolveScheduledItem(params) {
    const { registry, item, atGameDate } = params;
    if (item.status === 'posted' || item.status === 'cancelled') return { type: 'noop', item };
    if (item.direction === 'inflow') {
      const postingId = `posting:${item.id}`;
      if (!registry.hasPosting(postingId)) {
        registry.registerPosting(new FinancePosting({
          id: postingId,
          clubId: item.clubId,
          currency: item.currency,
          kind: 'credit',
          amountMinor: item.amountMinor,
          category: item.category,
          scheduledItemId: item.id,
          gameDate: atGameDate,
        }));
      }
      item.markPosted(postingId, atGameDate);
      const settledOverdue = retryOverdueForClub(registry, item.clubId, item.currency, atGameDate);
      return { type: 'posted', item, settledOverdue };
    }
    // outflow
    const balance = registry.treasuryBalance(item.clubId, item.currency);
    if (balance >= item.amountMinor) {
      settleClubToClub(registry, item, atGameDate);
      const settledOverdue = retryOverdueForClub(registry, item.clubId, item.currency, atGameDate);
      return { type: 'posted', item, settledOverdue };
    }
    if (item.status !== 'overdue') {
      const overduePostingId = `posting:${item.id}:overdue`;
      if (!registry.hasPosting(overduePostingId)) {
        registry.registerPosting(new FinancePosting({
          id: overduePostingId,
          clubId: item.clubId,
          currency: item.currency,
          kind: 'overdue-evidence',
          amountMinor: item.amountMinor,
          category: item.category,
          scheduledItemId: item.id,
          gameDate: atGameDate,
        }));
      }
      item.markOverdue(overduePostingId);
      return { type: 'overdue-created', item };
    }
    return { type: 'still-overdue', item };
  }

  // Un `matchId` genera A LO SUMO un recibo — idempotente por diseño de id.
  function recordHomeMatchTicketReceipt(params) {
    const {
      registry, plan, clubId, matchId, atGameDate,
    } = params;
    if (!plan || plan.ticketBaselinePerGameMinor <= 0) return null;
    const id = `finance-ticket:${clubId}:${matchId}`;
    if (registry.hasPosting(id)) return registry.getPosting(id);
    const posting = new FinancePosting({
      id,
      clubId,
      currency: plan.currency,
      kind: 'credit',
      amountMinor: plan.ticketBaselinePerGameMinor,
      category: 'ticketSales',
      scheduledItemId: null,
      gameDate: atGameDate,
      note: `Recibo de taquilla del partido "${matchId}" (baseline del plan de ${plan.seasonKey}).`,
    });
    registry.registerPosting(posting);
    retryOverdueForClub(registry, clubId, plan.currency, atGameDate);
    return posting;
  }

  // =========================================================================
  // 7. Fuente de calendario mundial — `club-finance-event`. `listPendingItems`
  //    hace un paso "ensure" idempotente (crea lo que falte desde los planes
  //    YA construidos) y devuelve los items todavía no liquidados/cancelados.
  //    Nunca es parada del usuario (mismo criterio que transfer-event/
  //    loan-event): el aviso al usuario llega por noticias, vía
  //    `onOverdueCreated`/`onOverdueSettled`, nunca deteniendo "Continuar".
  // =========================================================================
  function createClubFinanceEventSource(params) {
    const {
      registry, listClubIds, contractRegistry, transferRegistry, timeZoneId, onOverdueCreated, onOverdueSettled,
      notBeforeDate,
    } = params;
    if (!registry) throw new Error('createClubFinanceEventSource: falta "registry".');
    return {
      sourceType: 'club-finance-event',
      listPendingItems() {
        ensureScheduledItemsForAllPlans({
          registry, clubIds: listClubIds(), contractRegistry, transferRegistry, notBeforeDate,
        });
        return registry.allScheduledItems()
          .filter((item) => item.status === 'scheduled' || item.status === 'overdue')
          .map((item) => ({
            sourceId: item.id,
            moment: { precision: 'date', localDate: item.dueDate, timeZoneId },
            attentionScope: { teamIds: [], clubIds: [item.clubId] },
            metadata: { kind: 'club-finance-event', itemId: item.id, clubId: item.clubId },
          }));
      },
      resolveItem(descriptor) {
        const item = registry.getScheduledItem(descriptor.metadata.itemId);
        if (!item) throw new Error(`club-finance-event: el item "${descriptor.metadata.itemId}" ya no existe.`);
        const wasOverdue = item.status === 'overdue';
        const result = resolveScheduledItem({ registry, item, atGameDate: descriptor.localDate });
        if (result.type === 'overdue-created' && onOverdueCreated) onOverdueCreated(item);
        if (wasOverdue && result.type === 'posted' && onOverdueSettled) onOverdueSettled(item);
        if (result.settledOverdue && result.settledOverdue.length && onOverdueSettled) {
          result.settledOverdue.forEach((settledItem) => onOverdueSettled(settledItem));
        }
        return result;
      },
    };
  }

  // =========================================================================
  // 8. Proyección — modelo de lectura PURO a tres temporadas (sección 6.1).
  // =========================================================================
  function projectSeason(params) {
    const {
      registry, clubId, seasonKey, currency, openingCashMinor, transferRegistry,
    } = params;
    const plan = registry.effectivePlanFor(clubId, seasonKey, currency);
    if (!plan) return null;
    const items = registry.scheduledItemsForClub(clubId).filter((i) => i.seasonKey === seasonKey && i.currency === currency);
    const postedInflow = items.filter((i) => i.direction === 'inflow' && i.status === 'posted')
      .reduce((sum, i) => sum + i.amountMinor, 0);
    const postedOutflow = items.filter((i) => i.direction === 'outflow' && i.status === 'posted')
      .reduce((sum, i) => sum + i.amountMinor, 0);
    const scheduledRemainingInflow = items.filter((i) => i.direction === 'inflow' && i.status === 'scheduled')
      .reduce((sum, i) => sum + i.amountMinor, 0);
    const scheduledRemainingOutflow = items.filter((i) => (i.direction === 'outflow') && (i.status === 'scheduled' || i.status === 'overdue'))
      .reduce((sum, i) => sum + i.amountMinor, 0);
    const projectedClosingCashMinor = openingCashMinor + scheduledRemainingInflow - scheduledRemainingOutflow
      + (postedInflow - postedOutflow) * 0; // lo ya liquidado ya está incluido en `openingCashMinor` (tesorería actual)
    const knownCommitmentsMinor = items
      .filter((i) => i.category === 'transferAndLoanObligations' || i.category === 'agentAndSettlementObligations')
      .reduce((sum, i) => sum + i.amountMinor, 0);
    return {
      seasonKey,
      currency,
      archetype: plan.archetype,
      plannedIncomeMinor: plan.plannedIncomeMinor,
      plannedExpenseMinor: plan.salaryAnchorMinor + plan.nonSalaryExpensePoolMinor,
      salaryAnchorMinor: plan.salaryAnchorMinor,
      openingCashMinor,
      postedInflowMinor: postedInflow,
      postedOutflowMinor: postedOutflow,
      scheduledRemainingInflowMinor: scheduledRemainingInflow,
      scheduledRemainingOutflowMinor: scheduledRemainingOutflow,
      projectedClosingCashMinor,
      knownCommitmentsMinor,
      unscheduledExposure: unscheduledExposureForClub(clubId, transferRegistry)
        .filter(() => true),
      requiredMonthlyReserveMinor: Math.round((plan.salaryAnchorMinor + plan.nonSalaryExpensePoolMinor) / 12),
    };
  }

  // Proyección a tres temporadas (actual + 2 siguientes dentro del
  // horizonte YA construido) — encadena la caja de cierre proyectada de
  // cada temporada como apertura de la siguiente. Nunca persiste el
  // resultado — se recalcula siempre.
  function buildRollingProjection(params) {
    const {
      registry, clubId, currency, currentSeasonKey, transferRegistry,
    } = params;
    const horizon = [
      currentSeasonKey,
      LD().addSeasons(currentSeasonKey, 1),
      LD().addSeasons(currentSeasonKey, 2),
    ];
    const seasons = [];
    let openingCash = registry.treasuryBalance(clubId, currency);
    horizon.forEach((seasonKey) => {
      const season = projectSeason({
        registry, clubId, seasonKey, currency, openingCashMinor: openingCash, transferRegistry,
      });
      if (!season) return;
      seasons.push(season);
      openingCash = season.projectedClosingCashMinor;
    });
    const cumulativeResultMinor = seasons.reduce(
      (sum, s) => sum + (s.plannedIncomeMinor - s.plannedExpenseMinor), 0,
    );
    const baselineIncomeMinor = seasons.reduce((sum, s) => sum + s.plannedIncomeMinor, 0);
    return {
      clubId, currency, seasons, cumulativeResultMinor, baselineIncomeMinor,
    };
  }

  const exportsObj = {
    ClubFinanceService: {
      assignArchetypes,
      ensureClubProfile,
      resolveSalaryAnchor,
      buildSeasonPlan,
      ensureScheduledItemsForClubPlan,
      ensureScheduledItemsForAllPlans,
      resolveScheduledItem,
      retryOverdueForClub,
      recordHomeMatchTicketReceipt,
      unscheduledExposureForClub,
      createClubFinanceEventSource,
      projectSeason,
      buildRollingProjection,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
