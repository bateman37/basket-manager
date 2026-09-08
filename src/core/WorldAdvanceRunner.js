// src/core/WorldAdvanceRunner.js
// SIM-CAL-1 — driver COOPERATIVO de una `WorldAdvanceSession`
// (`WorldCalendarCoordinator.js`). Única responsabilidad: repartir el
// generador de avance en slices acotados por tiempo/nº de items, cediendo el
// control al navegador entre cada slice, sin importar DOM ni `state` global
// (game.js es quien lo instancia con lo que necesite inyectado). Convención
// del proyecto: identificadores en inglés, comentarios en español.
//
// No introduce un Web Worker (sección 6 del prompt: fuera de alcance de esta
// entrega) ni `setInterval` (sección 6: solo se programa el SIGUIENTE slice
// después de que el anterior termine).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);

  const DEFAULT_SLICE_BUDGET_MS = 8;
  const DEFAULT_MAX_ITEMS_PER_SLICE = 200;

  const RUNNER_STATUS = {
    IDLE: 'idle',
    RUNNING: 'running',
  };

  class WorldAdvanceRunner {
    // `coordinator`: `WorldCalendarCoordinator` de la carrera activa.
    // `scheduler(callback)`: programa el SIGUIENTE slice — navegador real:
    // `(cb) => setTimeout(cb, 0)`; pruebas Node: driver síncrono/inmediato
    // inyectado, nunca temporizadores reales (sección 6 del prompt).
    // `now()`: reloj técnico monotónico (`performance.now()` o inyectado en
    // pruebas) — solo decide CUÁNDO ceder, nunca fechas/orden/RNG de dominio.
    constructor({
      coordinator, scheduler, now, sliceBudgetMs, maxItemsPerSlice,
    } = {}) {
      if (!coordinator) throw new Error('WorldAdvanceRunner: falta "coordinator" explícito.');
      this._coordinator = coordinator;
      this._scheduler = typeof scheduler === 'function' ? scheduler : (cb) => setTimeout(cb, 0);
      this._now = typeof now === 'function' ? now : () => Date.now();
      this._sliceBudgetMs = Number.isFinite(sliceBudgetMs) ? sliceBudgetMs : DEFAULT_SLICE_BUDGET_MS;
      this._maxItemsPerSlice = Number.isFinite(maxItemsPerSlice) ? maxItemsPerSlice : DEFAULT_MAX_ITEMS_PER_SLICE;
      this._status = RUNNER_STATUS.IDLE;
      this._session = null;
      this._onProgress = null;
      this._onTerminal = null;
    }

    isActive() { return this._status === RUNNER_STATUS.RUNNING; }

    // Protección de reentrada (sección 6 del prompt): un segundo `start()`
    // mientras ya hay una operación en curso NUNCA crea una segunda
    // simulación — se ignora y se devuelve `false`.
    start({ onProgress, onTerminal } = {}) {
      if (this._status === RUNNER_STATUS.RUNNING) return false;
      this._status = RUNNER_STATUS.RUNNING;
      this._onProgress = typeof onProgress === 'function' ? onProgress : null;
      this._onTerminal = typeof onTerminal === 'function' ? onTerminal : null;
      this._session = this._coordinator.createAdvanceSession({ now: this._now });
      this._scheduleSlice();
      return true;
    }

    // Cancelación cooperativa: solo marca la intención. La sesión decide
    // ella misma el próximo límite cronológico seguro para detenerse
    // (`WorldCalendarCoordinator._advanceGenerator`).
    cancel() {
      if (this._session) this._session.requestCancel();
    }

    getProgressReport() {
      return this._session ? this._session.getProgressReport() : null;
    }

    // Descarte explícito (sección 6: "dispose cleanly during career reset or
    // successful load") — una carrera nueva/cargada NUNCA hereda callbacks
    // ni progreso de la anterior.
    dispose() {
      this._status = RUNNER_STATUS.IDLE;
      if (this._session) { this._session.dispose(); this._session = null; }
      this._onProgress = null;
      this._onTerminal = null;
    }

    _scheduleSlice() {
      this._scheduler(() => this._runSlice());
    }

    _runSlice() {
      if (!this._session) return; // dispose() llamado mientras el slice estaba en cola.
      const deadline = this._now() + this._sliceBudgetMs;
      let itemsThisSlice = 0;
      let outcome = { done: false, terminal: null };
      try {
        // `do…while`: garantiza progreso real en CADA slice (al menos un
        // paso) aunque el presupuesto ya esté agotado al entrar — nunca un
        // slice vacío que reprograme el siguiente sin avanzar nada.
        do {
          outcome = this._session.runSteps(1);
          itemsThisSlice += 1;
          if (outcome.done) break;
        } while (itemsThisSlice < this._maxItemsPerSlice && this._now() < deadline);
      } catch (err) {
        // Sección 6 del prompt: "convert unexpected exceptions into the
        // existing visible failure flow while preserving the failed
        // calendar item" — cualquier excepción NO capturada ya dentro del
        // generador (esas se convierten en `resolution-failed` con su
        // propio item) es un fallo de infraestructura; se enruta con la
        // MISMA forma de parada para que game.js no necesite un camino
        // aparte.
        const session = this._session;
        this._status = RUNNER_STATUS.IDLE;
        this._session = null;
        if (session) session.dispose();
        const onTerminal = this._onTerminal;
        this._onProgress = null;
        this._onTerminal = null;
        if (onTerminal) {
          onTerminal({
            type: 'resolution-failed',
            instant: this._coordinator.calendar.currentInstant,
            items: [],
            error: err.message,
          });
        }
        return;
      }

      if (this._onProgress) this._onProgress(this._session.getProgressReport());

      if (outcome.done) {
        const session = this._session;
        const onTerminal = this._onTerminal;
        this._status = RUNNER_STATUS.IDLE;
        this._session = null;
        this._onProgress = null;
        this._onTerminal = null;
        session.dispose();
        if (onTerminal) onTerminal(outcome.terminal);
        return;
      }

      this._scheduleSlice();
    }
  }

  const exportsObj = { WorldAdvanceRunner };

  if (isNode) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
