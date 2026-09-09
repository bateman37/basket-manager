// src/core/BoardBudgetRequestRegistry.js
// ECONOMY-BOARD-1 — registro CANÓNICO de peticiones de ampliación de
// presupuesto salarial. Instancia EXPLÍCITA por carrera
// (`state.boardBudgetRequestRegistry`), nunca un singleton. Convención
// del proyecto: identificadores en inglés, comentarios en español.
//
// Invariante central: a lo sumo UNA petición sin resolver por club — se
// comprueba aquí (`hasUnresolvedForClub`), nunca confiando en que el
// llamador no repita el comando.

(function (global) {
  function byId(list) { return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)); }

  class BoardBudgetRequestRegistry {
    constructor() {
      this._requests = new Map(); // id -> BoardBudgetRequest
      this._byClub = new Map(); // clubId -> [requestId...] orden de creación
    }

    registerRequest(request) {
      if (!request || !request.id) throw new Error('BoardBudgetRequestRegistry.registerRequest: falta una petición con "id".');
      if (this._requests.has(request.id)) return this._requests.get(request.id);
      this._requests.set(request.id, request);
      const list = this._byClub.get(request.clubId) || [];
      list.push(request.id);
      this._byClub.set(request.clubId, list);
      return request;
    }

    getRequest(id) { return this._requests.get(id) || null; }

    requestsForClub(clubId) { return (this._byClub.get(clubId) || []).map((id) => this._requests.get(id)); }

    hasUnresolvedForClub(clubId) { return this.requestsForClub(clubId).some((r) => r.isPending); }

    unresolvedForClub(clubId) { return this.requestsForClub(clubId).find((r) => r.isPending) || null; }

    // Última petición RESUELTA de un club (por fecha de resolución, y a
    // igualdad de fecha por id) — usada para calcular el cooldown
    // compartido (sección 8.3/invariante 4.5 del prompt).
    latestResolvedForClub(clubId) {
      const resolved = this.requestsForClub(clubId).filter((r) => r.status === 'resolved');
      if (!resolved.length) return null;
      return resolved.reduce((latest, r) => {
        if (!latest) return r;
        if (r.resolvedAtGameDate > latest.resolvedAtGameDate) return r;
        if (r.resolvedAtGameDate === latest.resolvedAtGameDate && r.id > latest.id) return r;
        return latest;
      }, null);
    }

    allPendingRequests() {
      return byId([...this._requests.values()].filter((r) => r.isPending));
    }

    allRequests() { return byId([...this._requests.values()]); }

    validateIntegrity() {
      const errors = [];
      this._byClub.forEach((ids, clubId) => {
        const pendingCount = ids.map((id) => this._requests.get(id)).filter((r) => r.isPending).length;
        if (pendingCount > 1) errors.push(`El club "${clubId}" tiene ${pendingCount} peticiones sin resolver — a lo sumo 1 permitida.`);
      });
      return { valid: errors.length === 0, errors };
    }

    exportState() {
      return { requests: [...this._requests.values()].map((r) => r.toJSON()) };
    }

    restoreState(state, entities) {
      const raw = state || {};
      (raw.requests || []).forEach((j) => this.registerRequest(new entities.BoardBudgetRequest(j)));
    }

    snapshot() { return { requests: this._requests.size, clubs: this._byClub.size }; }

    describe() { return this.snapshot(); }
  }

  const exportsObj = { BoardBudgetRequestRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
