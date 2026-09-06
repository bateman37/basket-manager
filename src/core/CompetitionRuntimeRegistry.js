// src/core/CompetitionRuntimeRegistry.js
// COMP-CORE-1 (DESIGN.md 10.13) — estado OPERATIVO (en memoria, no
// serializable directamente) de una carrera: qué `RoundRobinStageRunner`/
// `BracketStageRunner` está vivo para cada `CompetitionStage.id`, y qué
// activaciones cruzadas de edición ya se han disparado (idempotencia,
// invariante 16). Instancia EXPLÍCITA por carrera (creada por
// `CompetitionEngine`), nunca un singleton — mismo criterio que el resto de
// registries de la EPIC. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// La identidad/relaciones DURADERAS (Edition/Stage/Entry) siguen viviendo
// SOLO en `WorldRegistries` — este registro es la pieza TRANSITORIA
// (runners vivos, referencias a Team resueltas en la frontera) que nunca
// debe aparecer en un snapshot plano sin pasar antes por `runner.snapshot()`.

(function (global) {
  class CompetitionRuntimeRegistry {
    constructor() {
      this._runnersByStageId = new Map();
      this._formatIdByEditionId = new Map();
      this._firedActivationIds = new Set();
    }

    registerRunner(stageId, runner) {
      if (!stageId) throw new Error('CompetitionRuntimeRegistry.registerRunner: falta "stageId".');
      this._runnersByStageId.set(stageId, runner);
      return runner;
    }

    hasRunner(stageId) { return this._runnersByStageId.has(stageId); }

    getRunner(stageId) { return this._runnersByStageId.get(stageId) || null; }

    requireRunner(stageId) {
      const runner = this.getRunner(stageId);
      if (!runner) throw new Error(`CompetitionRuntimeRegistry: no hay runner activo para el stage "${stageId}".`);
      return runner;
    }

    registerEditionFormat(editionId, formatId) { this._formatIdByEditionId.set(editionId, formatId); }

    formatIdForEdition(editionId) { return this._formatIdByEditionId.get(editionId) || null; }

    // Idempotencia de activaciones (invariante 16: procesar dos veces el
    // mismo hecho no crea otra fase/edición) — devuelve `true` la PRIMERA
    // vez que se marca una clave, `false` en cualquier repetición posterior.
    markActivationFired(activationKey) {
      if (this._firedActivationIds.has(activationKey)) return false;
      this._firedActivationIds.add(activationKey);
      return true;
    }

    hasActivationFired(activationKey) { return this._firedActivationIds.has(activationKey); }

    allStageIds() { return [...this._runnersByStageId.keys()]; }

    // Snapshot serializable de TODOS los runners vivos — nunca instancias
    // Team/Map/funciones (invariante 27), usado por `CompetitionEngine.
    // snapshot()`/diagnóstico.
    snapshot() {
      const stages = {};
      this._runnersByStageId.forEach((runner, stageId) => { stages[stageId] = runner.snapshot(); });
      return { stages };
    }
  }

  const exportsObj = { CompetitionRuntimeRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
