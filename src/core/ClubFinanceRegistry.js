// src/core/ClubFinanceRegistry.js
// ECONOMY-BOARD-1 — registro CANÓNICO de la economía real del club:
// perfiles, planes anuales, movimientos de caja fechados y el ledger de
// postings ya resueltos. Instancia EXPLÍCITA por carrera
// (`state.clubFinanceRegistry`), nunca un singleton — mismo criterio que
// `SquadBudgetRegistry`. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Invariante central: la tesorería NUNCA es un total mutable guardado
// aquí — siempre se deriva sumando `FinancePosting.signedAmountMinor` de
// las postings ya registradas (ver `treasuryBalance()`).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function byId(list) { return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)); }

  function planChainKey(clubId, seasonKey, currency) { return `${clubId}|${seasonKey}|${currency}`; }

  class ClubFinanceRegistry {
    constructor() {
      this._profiles = new Map(); // clubId -> ClubFinanceProfile
      this._plans = new Map(); // id -> SeasonFinancialPlan
      this._planChains = new Map(); // planChainKey -> [planId...] orden de creación
      this._scheduledItems = new Map(); // id -> ScheduledCashFlowItem
      this._postings = new Map(); // id -> FinancePosting
      this._postingOrder = []; // ids en orden de creación real (ledger append-only)
    }

    // --- Perfiles -----------------------------------------------------
    registerProfile(profile) {
      if (!profile || !profile.clubId) throw new Error('ClubFinanceRegistry.registerProfile: falta un perfil con "clubId".');
      if (this._profiles.has(profile.clubId)) return this._profiles.get(profile.clubId);
      this._profiles.set(profile.clubId, profile);
      return profile;
    }

    hasProfile(clubId) { return this._profiles.has(clubId); }

    profileFor(clubId) { return this._profiles.get(clubId) || null; }

    allProfiles() { return byId([...this._profiles.values()]); }

    // --- Planes ---------------------------------------------------------
    registerPlan(plan) {
      if (!plan || !plan.id) throw new Error('ClubFinanceRegistry.registerPlan: falta un plan con "id".');
      if (this._plans.has(plan.id)) return this._plans.get(plan.id);
      this._plans.set(plan.id, plan);
      const key = planChainKey(plan.clubId, plan.seasonKey, plan.currency);
      const chain = this._planChains.get(key) || [];
      chain.push(plan.id);
      this._planChains.set(key, chain);
      return plan;
    }

    hasPlan(clubId, seasonKey, currency) {
      const chain = this._planChains.get(planChainKey(clubId, seasonKey, currency));
      return Boolean(chain && chain.length);
    }

    planChainFor(clubId, seasonKey, currency) {
      const ids = this._planChains.get(planChainKey(clubId, seasonKey, currency)) || [];
      return ids.map((id) => this._plans.get(id));
    }

    // Plan EFECTIVO (última revisión de la cadena) — un plan no tiene
    // fecha de efectividad como SquadBudgetAllocation, siempre es "el más
    // reciente de esa temporada".
    effectivePlanFor(clubId, seasonKey, currency) {
      const chain = this.planChainFor(clubId, seasonKey, currency);
      return chain.length ? chain[chain.length - 1] : null;
    }

    plansForClub(clubId) { return byId([...this._plans.values()].filter((p) => p.clubId === clubId)); }

    seasonKeysWithPlanForClub(clubId) {
      const keys = new Set();
      this._plans.forEach((p) => { if (p.clubId === clubId) keys.add(p.seasonKey); });
      return [...keys].sort((a, b) => LD().compareSeasonKeys(a, b));
    }

    // --- Movimientos fechados -------------------------------------------
    registerScheduledItem(item) {
      if (!item || !item.id) throw new Error('ClubFinanceRegistry.registerScheduledItem: falta un item con "id".');
      if (this._scheduledItems.has(item.id)) return this._scheduledItems.get(item.id);
      this._scheduledItems.set(item.id, item);
      return item;
    }

    hasScheduledItem(id) { return this._scheduledItems.has(id); }

    getScheduledItem(id) { return this._scheduledItems.get(id) || null; }

    scheduledItemsForClub(clubId) { return byId([...this._scheduledItems.values()].filter((i) => i.clubId === clubId)); }

    pendingScheduledItemsForClub(clubId) {
      return this.scheduledItemsForClub(clubId)
        .filter((i) => i.status === 'scheduled' || i.status === 'overdue')
        .sort((a, b) => LD().compare(a.dueDate, b.dueDate) || (a.id < b.id ? -1 : 1));
    }

    overdueItemsForClub(clubId) {
      return this.pendingScheduledItemsForClub(clubId).filter((i) => i.status === 'overdue');
    }

    allScheduledItems() { return byId([...this._scheduledItems.values()]); }

    // --- Ledger de postings -----------------------------------------------
    registerPosting(posting) {
      if (!posting || !posting.id) throw new Error('ClubFinanceRegistry.registerPosting: falta una posting con "id".');
      if (this._postings.has(posting.id)) return this._postings.get(posting.id);
      this._postings.set(posting.id, posting);
      this._postingOrder.push(posting.id);
      return posting;
    }

    hasPosting(id) { return this._postings.has(id); }

    getPosting(id) { return this._postings.get(id) || null; }

    postingsForClub(clubId) {
      return this._postingOrder
        .map((id) => this._postings.get(id))
        .filter((p) => p.clubId === clubId);
    }

    // Tesorería DERIVADA — nunca un total mutable guardado.
    treasuryBalance(clubId, currency) {
      return this.postingsForClub(clubId)
        .filter((p) => p.currency === currency)
        .reduce((sum, p) => sum + p.signedAmountMinor, 0);
    }

    allPostings() { return this._postingOrder.map((id) => this._postings.get(id)); }

    validateIntegrity() {
      const errors = [];
      this._plans.forEach((plan) => {
        if (plan.predecessorId && !this._plans.has(plan.predecessorId)) {
          errors.push(`El plan "${plan.id}" referencia el predecesor "${plan.predecessorId}", inexistente.`);
        }
      });
      this._scheduledItems.forEach((item) => {
        if (item.postingId && !this._postings.has(item.postingId)) {
          errors.push(`El item "${item.id}" referencia la posting "${item.postingId}", inexistente.`);
        }
        if (item.overduePostingId && !this._postings.has(item.overduePostingId)) {
          errors.push(`El item "${item.id}" referencia la posting de impago "${item.overduePostingId}", inexistente.`);
        }
      });
      return { valid: errors.length === 0, errors };
    }

    // Contrato completo sin pérdida (mismo criterio que SquadBudgetRegistry).
    exportState() {
      return {
        profiles: [...this._profiles.values()].map((p) => p.toJSON()),
        plans: [...this._plans.values()].map((p) => p.toJSON()),
        scheduledItems: [...this._scheduledItems.values()].map((i) => i.toJSON()),
        postings: this._postingOrder.map((id) => this._postings.get(id).toJSON()),
      };
    }

    // `entities`: `{ClubFinanceProfile, SeasonFinancialPlan,
    // ScheduledCashFlowItem, FinancePosting}`. El orden real de postings se
    // reconstruye desde el propio array guardado (ya en orden de
    // creación — `_postingOrder` no se serializa aparte, es derivado del
    // orden del array).
    restoreState(state, entities) {
      const raw = state || {};
      (raw.profiles || []).forEach((j) => this.registerProfile(new entities.ClubFinanceProfile(j)));
      const plansById = new Map((raw.plans || []).map((j) => [j.id, j]));
      const registeredPlans = new Set();
      const registerPlanWithPredecessorsFirst = (json) => {
        if (registeredPlans.has(json.id)) return;
        if (json.predecessorId && plansById.has(json.predecessorId) && !registeredPlans.has(json.predecessorId)) {
          registerPlanWithPredecessorsFirst(plansById.get(json.predecessorId));
        }
        this.registerPlan(new entities.SeasonFinancialPlan(json));
        registeredPlans.add(json.id);
      };
      (raw.plans || []).forEach((json) => registerPlanWithPredecessorsFirst(json));
      (raw.scheduledItems || []).forEach((j) => this.registerScheduledItem(new entities.ScheduledCashFlowItem(j)));
      (raw.postings || []).forEach((j) => this.registerPosting(new entities.FinancePosting(j)));
    }

    snapshot() {
      return {
        profiles: this._profiles.size,
        plans: this._plans.size,
        scheduledItems: this._scheduledItems.size,
        postings: this._postingOrder.length,
      };
    }

    describe() { return this.snapshot(); }
  }

  const exportsObj = { ClubFinanceRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
