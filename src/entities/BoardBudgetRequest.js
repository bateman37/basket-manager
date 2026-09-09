// src/entities/BoardBudgetRequest.js
// ECONOMY-BOARD-1 — petición jugable de ampliación de presupuesto
// salarial: expediente AUDITABLE con historial de eventos, snapshots de
// confianza/capacidad en el envío y en la resolución, y el resultado
// final (aprobación total/parcial/rechazo) con razones estructuradas.
// Nunca crea una oferta/AIP/reserva de mercado — solo revisa
// `SquadBudgetAllocation` a través de `SquadBudgetService.recordRevision()`
// (ver `BoardBudgetRequestService`). Convención del proyecto:
// identificadores en inglés, comentarios en español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }

  function requireId(value, label) {
    if (!value || typeof value !== 'string') {
      throw new Error(`BoardBudgetRequest: "${label}" debe ser un id string no vacío (recibido: ${JSON.stringify(value)}).`);
    }
    return value;
  }

  const SOURCES = Object.freeze(['blocked-operation', 'finance-screen']);
  const STATUSES = Object.freeze(['pending', 'resolved']);
  const OUTCOMES = Object.freeze(['approved', 'partially-approved', 'rejected']);

  function normalizeAmountBySeasonKey(map, label) {
    const out = {};
    Object.keys(map || {}).forEach((seasonKey) => {
      out[seasonKey] = M().requireAmountMinor(map[seasonKey], `${label}.${seasonKey}`);
    });
    return out;
  }

  class BoardBudgetRequest {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.managerId = requireId(data.managerId, 'managerId');
      this.employmentSpellId = requireId(data.employmentSpellId, 'employmentSpellId');
      this.clubId = requireId(data.clubId, 'clubId');
      this.source = data.source;
      if (!SOURCES.includes(this.source)) throw new Error(`BoardBudgetRequest: source desconocida "${this.source}".`);
      this.currency = M().requireCurrency(data.currency || 'EUR');
      this.requestedIncreaseBySeasonKey = normalizeAmountBySeasonKey(data.requestedIncreaseBySeasonKey, 'requestedIncreaseBySeasonKey');
      this.submittedGameDate = LD().requireIsoDate(data.submittedGameDate, 'submittedGameDate');
      this.dueGameDate = LD().requireIsoDate(data.dueGameDate, 'dueGameDate');
      this.dueDateBasis = data.dueDateBasis || null; // {maxRatioBp, delayDays}
      this.operationSnapshot = data.operationSnapshot || null; // {hash, shortfalls, note} — nunca una oferta viva
      this.submittedConfidenceSnapshot = data.submittedConfidenceSnapshot || null;
      this.resolutionConfidenceSnapshot = data.resolutionConfidenceSnapshot || null;
      this.status = data.status || 'pending';
      if (!STATUSES.includes(this.status)) throw new Error(`BoardBudgetRequest: status desconocido "${this.status}".`);
      this.outcome = data.outcome || null;
      if (this.outcome && !OUTCOMES.includes(this.outcome)) throw new Error(`BoardBudgetRequest: outcome desconocido "${this.outcome}".`);
      this.approvedIncreaseBySeasonKey = normalizeAmountBySeasonKey(data.approvedIncreaseBySeasonKey, 'approvedIncreaseBySeasonKey');
      this.reasonCodesBySeasonKey = data.reasonCodesBySeasonKey ? { ...data.reasonCodesBySeasonKey } : {};
      this.explanationEs = data.explanationEs || null;
      this.appliedAllocationRevisionIdsBySeasonKey = data.appliedAllocationRevisionIdsBySeasonKey
        ? { ...data.appliedAllocationRevisionIdsBySeasonKey } : {};
      this.resolvedAtGameDate = data.resolvedAtGameDate || null;
      this.events = Array.isArray(data.events) ? data.events.map((e) => ({ ...e })) : [];
      this.provenance = { dataSource: 'simulated-board-budget-request-v1', isReal: false };
    }

    addEvent(type, atGameDate, payload) {
      this.events.push({ type, atGameDate, payload: payload || null });
      return this;
    }

    get isPending() { return this.status === 'pending'; }

    toJSON() {
      return {
        id: this.id,
        managerId: this.managerId,
        employmentSpellId: this.employmentSpellId,
        clubId: this.clubId,
        source: this.source,
        currency: this.currency,
        requestedIncreaseBySeasonKey: { ...this.requestedIncreaseBySeasonKey },
        submittedGameDate: this.submittedGameDate,
        dueGameDate: this.dueGameDate,
        dueDateBasis: this.dueDateBasis,
        operationSnapshot: this.operationSnapshot,
        submittedConfidenceSnapshot: this.submittedConfidenceSnapshot,
        resolutionConfidenceSnapshot: this.resolutionConfidenceSnapshot,
        status: this.status,
        outcome: this.outcome,
        approvedIncreaseBySeasonKey: { ...this.approvedIncreaseBySeasonKey },
        reasonCodesBySeasonKey: { ...this.reasonCodesBySeasonKey },
        explanationEs: this.explanationEs,
        appliedAllocationRevisionIdsBySeasonKey: { ...this.appliedAllocationRevisionIdsBySeasonKey },
        resolvedAtGameDate: this.resolvedAtGameDate,
        events: this.events.map((e) => ({ ...e })),
        provenance: { ...this.provenance },
      };
    }
  }

  const exportsObj = {
    BoardBudgetRequest,
    BOARD_BUDGET_REQUEST_SOURCES: SOURCES,
    BOARD_BUDGET_REQUEST_STATUSES: STATUSES,
    BOARD_BUDGET_REQUEST_OUTCOMES: OUTCOMES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
