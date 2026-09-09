// src/entities/ClubFinance.js
// ECONOMY-BOARD-1 — entidades del plan financiero y la tesorería
// canónica del club: `ClubFinanceProfile` (arquetipo/moneda por club,
// asignado una vez por carrera), `SeasonFinancialPlan` (plan anual
// INMUTABLE por club+temporada+moneda, revisiones encadenadas igual que
// `SquadBudgetAllocation`), `ScheduledCashFlowItem` (movimiento de caja
// FECHADO todavía no liquidado) y `FinancePosting` (evidencia INMUTABLE
// de un movimiento de caja ya resuelto — débito/crédito/liquidación/
// impago/cancelación). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Separaciones que este archivo respeta (nunca las difumina):
//  - `planned` (SeasonFinancialPlan) != `committed` (contratos/
//    obligaciones reales) != `due` (ScheduledCashFlowItem) != `paid`
//    (FinancePosting);
//  - una asignación salarial (SquadBudgetAllocation) no es caja;
//  - la tesorería NUNCA se guarda como total mutable — siempre se deriva
//    sumando `FinancePosting` (ver `ClubFinanceRegistry.treasuryBalance`).
//
// Este archivo no conoce Club/Team/Contract como clases (duck typing
// sobre ids), no lee el DOM y no toca ningún registro.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }

  function requireId(value, label) {
    if (!value || typeof value !== 'string') {
      throw new Error(`ClubFinance: "${label}" debe ser un id string no vacío (recibido: ${JSON.stringify(value)}).`);
    }
    return value;
  }

  const ARCHETYPES = Object.freeze(['tight', 'balanced', 'comfortable']);

  const INCOME_CATEGORIES = Object.freeze([
    'mainSponsorship', 'secondarySponsorship', 'tvRights', 'leagueRevenueShare',
    'europeanCompetition', 'ticketSales', 'merchandising',
  ]);

  const EXPENSE_CATEGORIES = Object.freeze([
    'playerSalaries', 'coachingStaffAggregate', 'facilitiesMaintenance',
    'clubOperations', 'transferAndLoanObligations', 'agentAndSettlementObligations',
  ]);

  function zeroedCategoryMap(categories) {
    const map = {};
    categories.forEach((key) => { map[key] = 0; });
    return map;
  }

  function normalizeCategoryMap(source, categories, label) {
    const map = zeroedCategoryMap(categories);
    categories.forEach((key) => {
      if (source && source[key] !== undefined) {
        map[key] = M().requireAmountMinor(source[key], `${label}.${key}`);
      }
    });
    return map;
  }

  // -----------------------------------------------------------------------
  // ClubFinanceProfile — arquetipo/moneda del club, fijado UNA vez por
  // carrera (nunca cambia de temporada en temporada).
  // -----------------------------------------------------------------------
  class ClubFinanceProfile {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.clubId = requireId(data.clubId, 'clubId');
      this.currency = M().requireCurrency(data.currency || 'EUR');
      this.archetype = data.archetype;
      if (!ARCHETYPES.includes(this.archetype)) {
        throw new Error(`ClubFinanceProfile: arquetipo desconocido "${this.archetype}".`);
      }
      this.provenance = {
        dataSource: (data.provenance && data.provenance.dataSource) || 'simulated-club-finance-v1',
        isReal: false,
        policyVersion: (data.provenance && data.provenance.policyVersion) || null,
        careerSeed: (data.provenance && data.provenance.careerSeed) || null,
        calculatedAtGameDate: data.provenance && data.provenance.calculatedAtGameDate
          ? LD().requireIsoDate(data.provenance.calculatedAtGameDate, 'provenance.calculatedAtGameDate') : null,
      };
    }

    toJSON() {
      return {
        id: this.id, clubId: this.clubId, currency: this.currency, archetype: this.archetype, provenance: { ...this.provenance },
      };
    }
  }

  // -----------------------------------------------------------------------
  // SeasonFinancialPlan — plan anual INMUTABLE por club+temporada+moneda.
  // Una revisión nueva siempre es una instancia nueva encadenada por
  // `predecessorId` (mismo patrón que `SquadBudgetAllocation`) — nunca se
  // edita un campo de un plan ya registrado. Una revisión NUNCA recalcula
  // `plannedIncomeMinor`/`openingCashMinor` a partir de un cambio de
  // presupuesto salarial (invariante explícita del prompt).
  // -----------------------------------------------------------------------
  const PLAN_REVISION_KINDS = Object.freeze(['opening-plan', 'season-opening-plan', 'forward-plan-extension']);

  class SeasonFinancialPlan {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.clubId = requireId(data.clubId, 'clubId');
      this.seasonKey = data.seasonKey;
      if (!LD().isValidSeasonKey(this.seasonKey)) {
        throw new Error(`SeasonFinancialPlan: seasonKey inválida "${this.seasonKey}".`);
      }
      this.currency = M().requireCurrency(data.currency || 'EUR');
      this.revisionKind = data.revisionKind || 'opening-plan';
      if (!PLAN_REVISION_KINDS.includes(this.revisionKind)) {
        throw new Error(`SeasonFinancialPlan: revisionKind desconocido "${this.revisionKind}".`);
      }
      this.predecessorId = data.predecessorId || null;
      this.archetype = data.archetype;
      if (!ARCHETYPES.includes(this.archetype)) {
        throw new Error(`SeasonFinancialPlan: arquetipo desconocido "${this.archetype}".`);
      }
      this.salaryAnchorMinor = M().requireAmountMinor(data.salaryAnchorMinor, 'salaryAnchorMinor');
      this.plannedIncomeMinor = M().requireAmountMinor(data.plannedIncomeMinor, 'plannedIncomeMinor');
      this.targetMarginMinor = M().requireAmountMinor(data.targetMarginMinor, 'targetMarginMinor');
      this.nonSalaryExpensePoolMinor = M().requireAmountMinor(data.nonSalaryExpensePoolMinor, 'nonSalaryExpensePoolMinor');
      this.incomeByCategoryMinor = normalizeCategoryMap(data.incomeByCategoryMinor, INCOME_CATEGORIES, 'incomeByCategoryMinor');
      this.expenseByCategoryMinor = normalizeCategoryMap(data.expenseByCategoryMinor, EXPENSE_CATEGORIES, 'expenseByCategoryMinor');
      // Cuota mensual esperada de taquilla por partido en casa (sección
      // 5.5) — solo referencia de planificación, nunca autoridad de aforo.
      this.expectedHomeGames = Number.isFinite(data.expectedHomeGames) ? data.expectedHomeGames : 0;
      this.ticketBaselinePerGameMinor = M().requireAmountMinor(data.ticketBaselinePerGameMinor || 0, 'ticketBaselinePerGameMinor');
      // Caja de apertura — SOLO en el plan de apertura de carrera (o la
      // migración v3) de CADA club; `null` en cualquier otro plan (nunca se
      // vuelve a sumar el colchón en una apertura de temporada posterior).
      this.openingCashMinor = data.openingCashMinor !== undefined && data.openingCashMinor !== null
        ? M().requireAmountMinor(data.openingCashMinor, 'openingCashMinor') : null;
      this.createdAtGameDate = LD().requireIsoDate(data.createdAtGameDate, 'createdAtGameDate');
      this.provenance = {
        dataSource: (data.provenance && data.provenance.dataSource) || 'simulated-club-finance-v1',
        isReal: false,
        policyVersion: (data.provenance && data.provenance.policyVersion) || null,
        note: (data.provenance && data.provenance.note) || null,
      };
    }

    toJSON() {
      return {
        id: this.id,
        clubId: this.clubId,
        seasonKey: this.seasonKey,
        currency: this.currency,
        revisionKind: this.revisionKind,
        predecessorId: this.predecessorId,
        archetype: this.archetype,
        salaryAnchorMinor: this.salaryAnchorMinor,
        plannedIncomeMinor: this.plannedIncomeMinor,
        targetMarginMinor: this.targetMarginMinor,
        nonSalaryExpensePoolMinor: this.nonSalaryExpensePoolMinor,
        incomeByCategoryMinor: { ...this.incomeByCategoryMinor },
        expenseByCategoryMinor: { ...this.expenseByCategoryMinor },
        expectedHomeGames: this.expectedHomeGames,
        ticketBaselinePerGameMinor: this.ticketBaselinePerGameMinor,
        openingCashMinor: this.openingCashMinor,
        createdAtGameDate: this.createdAtGameDate,
        provenance: { ...this.provenance },
      };
    }
  }

  // -----------------------------------------------------------------------
  // ScheduledCashFlowItem — movimiento de caja FECHADO todavía no
  // liquidado. `sourceRef` es la clave de idempotencia (nunca se crea dos
  // veces el mismo item para la misma referencia de origen).
  // -----------------------------------------------------------------------
  const CASH_FLOW_DIRECTIONS = Object.freeze(['inflow', 'outflow']);
  const CASH_FLOW_STATUSES = Object.freeze(['scheduled', 'posted', 'overdue', 'cancelled']);

  class ScheduledCashFlowItem {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.clubId = requireId(data.clubId, 'clubId');
      this.currency = M().requireCurrency(data.currency || 'EUR');
      this.direction = data.direction;
      if (!CASH_FLOW_DIRECTIONS.includes(this.direction)) {
        throw new Error(`ScheduledCashFlowItem: direction desconocida "${this.direction}".`);
      }
      const categories = this.direction === 'inflow' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      if (!categories.includes(data.category)) {
        throw new Error(`ScheduledCashFlowItem: categoría "${data.category}" no válida para direction "${this.direction}".`);
      }
      this.category = data.category;
      this.amountMinor = M().requireAmountMinor(data.amountMinor, 'amountMinor');
      this.dueDate = LD().requireIsoDate(data.dueDate, 'dueDate');
      this.seasonKey = data.seasonKey || null;
      this.mandatory = data.mandatory !== undefined ? Boolean(data.mandatory) : this.direction === 'outflow';
      // Referencia de origen — clave de idempotencia real (nunca un
      // contador). `type`: 'salary-installment' | 'sponsorship-monthly' |
      // 'merchandising-monthly' | 'tv-tranche' | 'league-tranche' |
      // 'matchday-ticket' | 'facility-maintenance' | 'coaching-aggregate' |
      // 'club-operations' | 'transfer-obligation' | 'loan-obligation' |
      // 'agent-obligation' | 'opening-cash'.
      this.sourceRef = {
        type: (data.sourceRef && data.sourceRef.type) || null,
        id: (data.sourceRef && data.sourceRef.id) || null,
      };
      this.counterpartyClubId = data.counterpartyClubId || null;
      this.status = data.status || 'scheduled';
      if (!CASH_FLOW_STATUSES.includes(this.status)) {
        throw new Error(`ScheduledCashFlowItem: status desconocido "${this.status}".`);
      }
      this.postingId = data.postingId || null;
      this.overduePostingId = data.overduePostingId || null;
      this.resolvedOverdueAtGameDate = data.resolvedOverdueAtGameDate || null;
      this.createdAtGameDate = LD().requireIsoDate(data.createdAtGameDate, 'createdAtGameDate');
      this.note = data.note || null;
    }

    markPosted(postingId, atGameDate) {
      this.status = 'posted';
      this.postingId = postingId;
      if (this.overduePostingId) this.resolvedOverdueAtGameDate = atGameDate;
      return this;
    }

    markOverdue(overduePostingId) {
      this.status = 'overdue';
      this.overduePostingId = overduePostingId;
      return this;
    }

    markCancelled() { this.status = 'cancelled'; return this; }

    toJSON() {
      return {
        id: this.id,
        clubId: this.clubId,
        currency: this.currency,
        direction: this.direction,
        category: this.category,
        amountMinor: this.amountMinor,
        dueDate: this.dueDate,
        seasonKey: this.seasonKey,
        mandatory: this.mandatory,
        sourceRef: { ...this.sourceRef },
        counterpartyClubId: this.counterpartyClubId,
        status: this.status,
        postingId: this.postingId,
        overduePostingId: this.overduePostingId,
        resolvedOverdueAtGameDate: this.resolvedOverdueAtGameDate,
        createdAtGameDate: this.createdAtGameDate,
        note: this.note,
      };
    }
  }

  // -----------------------------------------------------------------------
  // FinancePosting — evidencia INMUTABLE de un movimiento de caja ya
  // resuelto. Nunca se edita: una corrección posterior es una posting
  // NUEVA con su propia correlación.
  // -----------------------------------------------------------------------
  const POSTING_KINDS = Object.freeze(['opening-balance', 'credit', 'debit', 'overdue-evidence', 'cancellation']);

  class FinancePosting {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.clubId = requireId(data.clubId, 'clubId');
      this.currency = M().requireCurrency(data.currency || 'EUR');
      this.kind = data.kind;
      if (!POSTING_KINDS.includes(this.kind)) {
        throw new Error(`FinancePosting: kind desconocido "${this.kind}".`);
      }
      // Un `overdue-evidence`/`cancellation` no mueve caja — solo deja
      // rastro; su `amountMinor` es informativo (el importe pendiente),
      // nunca se suma a la tesorería.
      this.amountMinor = M().requireAmountMinor(data.amountMinor, 'amountMinor');
      this.category = data.category || null;
      this.scheduledItemId = data.scheduledItemId || null;
      this.correlationId = data.correlationId || null;
      this.counterpartyClubId = data.counterpartyClubId || null;
      this.gameDate = LD().requireIsoDate(data.gameDate, 'gameDate');
      this.note = data.note || null;
      this.provenance = { dataSource: 'simulated-club-finance-v1', isReal: false };
    }

    get movesCash() { return this.kind === 'opening-balance' || this.kind === 'credit' || this.kind === 'debit'; }

    get signedAmountMinor() {
      if (this.kind === 'debit') return -this.amountMinor;
      if (this.kind === 'opening-balance' || this.kind === 'credit') return this.amountMinor;
      return 0;
    }

    toJSON() {
      return {
        id: this.id,
        clubId: this.clubId,
        currency: this.currency,
        kind: this.kind,
        amountMinor: this.amountMinor,
        category: this.category,
        scheduledItemId: this.scheduledItemId,
        correlationId: this.correlationId,
        counterpartyClubId: this.counterpartyClubId,
        gameDate: this.gameDate,
        note: this.note,
        provenance: { ...this.provenance },
      };
    }
  }

  const exportsObj = {
    ClubFinanceProfile,
    SeasonFinancialPlan,
    ScheduledCashFlowItem,
    FinancePosting,
    CLUB_FINANCE_ARCHETYPES: ARCHETYPES,
    CLUB_FINANCE_INCOME_CATEGORIES: INCOME_CATEGORIES,
    CLUB_FINANCE_EXPENSE_CATEGORIES: EXPENSE_CATEGORIES,
    CLUB_FINANCE_PLAN_REVISION_KINDS: PLAN_REVISION_KINDS,
    CLUB_FINANCE_CASH_FLOW_STATUSES: CASH_FLOW_STATUSES,
    CLUB_FINANCE_POSTING_KINDS: POSTING_KINDS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
