// src/core/SquadBudgetRegistry.js
// SQUAD-BUDGET-1 — registro CANÓNICO del presupuesto salarial de plantilla:
// cadenas de `SquadBudgetAllocation` por club+temporada+moneda. Instancia
// EXPLÍCITA por carrera (`state.squadBudgetRegistry`), nunca un singleton —
// mismo criterio que ContractRegistry/MarketRegistry/AnnualCycleRegistry.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Invariante central: "a lo sumo un límite EFECTIVO por club+temporada+
// moneda en un punto de revisión dado" — nunca se guarda un total derivado
// aquí, solo la cadena de revisiones; `SquadBudgetService` deriva el resto.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function chainKey(clubId, seasonKey, currency) { return `${clubId}|${seasonKey}|${currency}`; }

  function byId(list) { return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)); }

  class SquadBudgetRegistry {
    constructor() {
      this._allocations = new Map(); // id -> SquadBudgetAllocation
      // chainKey -> [allocationId...] en orden de creación real (== orden
      // de revisión: cada nueva revisión se crea DESPUÉS de leer la
      // efectiva anterior, nunca se reordena).
      this._chains = new Map();
    }

    // Idempotente por id — repetir el bootstrap/sincronización/cierre de
    // temporada nunca duplica una asignación ya registrada.
    registerAllocation(allocation) {
      if (!allocation || !allocation.id) throw new Error('SquadBudgetRegistry.registerAllocation: falta una asignación con "id".');
      if (this._allocations.has(allocation.id)) return this._allocations.get(allocation.id);
      this._allocations.set(allocation.id, allocation);
      const key = chainKey(allocation.clubId, allocation.seasonKey, allocation.currency);
      const chain = this._chains.get(key) || [];
      chain.push(allocation.id);
      this._chains.set(key, chain);
      return allocation;
    }

    has(id) { return this._allocations.has(id); }

    get(id) {
      const a = this._allocations.get(id);
      if (!a) throw new Error(`SquadBudgetRegistry.get: no existe la asignación "${id}".`);
      return a;
    }

    hasChain(clubId, seasonKey, currency) {
      const chain = this._chains.get(chainKey(clubId, seasonKey, currency));
      return Boolean(chain && chain.length);
    }

    // Cadena completa, en orden de revisión (la primera es la apertura).
    chainFor(clubId, seasonKey, currency) {
      const ids = this._chains.get(chainKey(clubId, seasonKey, currency)) || [];
      return ids.map((id) => this._allocations.get(id));
    }

    // Asignación EFECTIVA en una fecha de mundo dada — la última revisión
    // cuyo `effectiveDate` no es posterior a `atGameDate`. Sin fecha,
    // devuelve la revisión más reciente de la cadena (uso de lectura
    // "estado actual"). `null` si la cadena no existe o si ninguna revisión
    // es todavía efectiva en esa fecha (nunca se inventa un valor previo).
    effectiveAllocationFor(clubId, seasonKey, currency, atGameDate) {
      const chain = this.chainFor(clubId, seasonKey, currency);
      if (!chain.length) return null;
      if (atGameDate === undefined || atGameDate === null) return chain[chain.length - 1];
      const iso = toIso(atGameDate);
      let effective = null;
      chain.forEach((allocation) => {
        if (LD().compare(allocation.effectiveDate, iso) <= 0) effective = allocation;
      });
      return effective;
    }

    allocationsForClub(clubId) {
      return byId([...this._allocations.values()].filter((a) => a.clubId === clubId));
    }

    // Todas las temporadas con al menos una asignación para un club —
    // orden estable por `seasonKey`.
    seasonKeysForClub(clubId) {
      const keys = new Set();
      this._allocations.forEach((a) => { if (a.clubId === clubId) keys.add(a.seasonKey); });
      return [...keys].sort((a, b) => LD().compareSeasonKeys(a, b));
    }

    all() { return byId([...this._allocations.values()]); }

    validateIntegrity() {
      const errors = [];
      this._allocations.forEach((allocation) => {
        if (allocation.predecessorId) {
          if (!this._allocations.has(allocation.predecessorId)) {
            errors.push(`La asignación "${allocation.id}" referencia el predecesor "${allocation.predecessorId}", inexistente.`);
            return;
          }
          const predecessor = this._allocations.get(allocation.predecessorId);
          if (predecessor.clubId !== allocation.clubId || predecessor.seasonKey !== allocation.seasonKey
            || predecessor.currency !== allocation.currency) {
            errors.push(`La asignación "${allocation.id}" referencia un predecesor "${allocation.predecessorId}" de otro club/temporada/moneda.`);
          }
        }
      });
      this._chains.forEach((ids, key) => {
        const seen = new Set();
        ids.forEach((id) => {
          if (seen.has(id)) errors.push(`La cadena "${key}" contiene el id "${id}" duplicado.`);
          seen.add(id);
        });
      });
      return { valid: errors.length === 0, errors };
    }

    // Contrato completo sin pérdida (mismo criterio que Loan/NationalTeam
    // Registry — nunca un resumen diagnóstico).
    exportState() {
      return {
        allocations: [...this._allocations.values()].map((a) => a.toJSON()),
      };
    }

    // `entities`: `{SquadBudgetAllocation}`. Orden de restauración = orden
    // de creación real ya reflejado en el propio array guardado (proyectado
    // por id estable, no por cadena — `registerAllocation` reconstruye la
    // cadena a partir del `predecessorId`/`effectiveDate` de cada una, así
    // que el orden de entrada no importa siempre que cada predecesor exista
    // ya cuando se registra su sucesor; se restaura en dos pasadas para
    // garantizarlo sin asumir un orden concreto en el JSON).
    restoreState(state, entities) {
      const raw = (state && state.allocations) || [];
      const byIdMap = new Map(raw.map((j) => [j.id, j]));
      const registered = new Set();
      const registerWithPredecessorsFirst = (json) => {
        if (registered.has(json.id)) return;
        if (json.predecessorId && byIdMap.has(json.predecessorId) && !registered.has(json.predecessorId)) {
          registerWithPredecessorsFirst(byIdMap.get(json.predecessorId));
        }
        this.registerAllocation(new entities.SquadBudgetAllocation(json));
        registered.add(json.id);
      };
      raw.forEach((json) => registerWithPredecessorsFirst(json));
    }

    snapshot() {
      return {
        allocations: this._allocations.size,
        chains: this._chains.size,
      };
    }

    describe() { return this.snapshot(); }
  }

  const exportsObj = { SquadBudgetRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
