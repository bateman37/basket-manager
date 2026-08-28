// src/core/CycleTransaction.js
// CYCLE-1 (DESIGN.md 9.22, secciones 9/12/13 del prompt) — saga atómica
// COMPARTIDA por las operaciones del ciclo anual (expiración de contrato,
// retirada efectiva, promoción de academia, emergencia de plantilla).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Reutiliza EXACTAMENTE el patrón ya probado en
// `TransferExecutionService.commitTransaction()`/`LoanExecutionService`
// (BUG-TRANSFER1-14/15, DESIGN.md 9.21), extraído aquí para no escribir un
// tercer motor de saga:
//
//   - cada paso muta primero y ACTO SEGUIDO **almacena** su cierre de
//     reversión con `registerUndo()` — `registerUndo` NUNCA ejecuta el
//     cierre (si lo hiciera, deshacería el paso que se acaba de aplicar en
//     vez de guardarlo para un fallo POSTERIOR);
//   - si un paso posterior falla, se deshace en orden INVERSO y el mundo
//     queda EXACTAMENTE como estaba;
//   - un fallo dentro de un `undo` no interrumpe el resto del rollback: se
//     acumula y se adjunta al error final (nunca se traga en silencio).
//
// Módulo puro: no conoce Player/Team/registro alguno, ni el DOM, ni `state`.

(function (global) {
  class CycleDomainError extends Error {
    constructor(message, code, details) {
      super(message);
      this.name = 'CycleDomainError';
      this.code = code || 'CYCLE_ERROR';
      this.details = details || null;
    }
  }

  // `body(ctx)` recibe `{ registerUndo }`. Devuelve lo que devuelva `body`.
  function runAtomic(label, body) {
    const undoStack = [];
    const ctx = {
      registerUndo(fn) {
        if (typeof fn !== 'function') {
          throw new CycleDomainError(`${label}: registerUndo espera una función de reversión.`, 'INVALID_UNDO');
        }
        undoStack.push(fn);
      },
      get undoDepth() { return undoStack.length; },
    };
    try {
      return body(ctx);
    } catch (err) {
      const rollbackFailures = [];
      for (let i = undoStack.length - 1; i >= 0; i -= 1) {
        try {
          undoStack[i]();
        } catch (undoErr) {
          rollbackFailures.push(undoErr.message);
        }
      }
      const suffix = rollbackFailures.length
        ? ` [ATENCIÓN: ${rollbackFailures.length} paso(s) de reversión fallaron: ${rollbackFailures.join(' | ')}]`
        : ' [mundo restaurado exactamente al estado previo]';
      const wrapped = new CycleDomainError(
        `${label}: la operación falló y se revirtió — ${err.message}${suffix}`,
        err.code || 'CYCLE_TRANSACTION_FAILED',
        { originalMessage: err.message, rollbackFailures, undoSteps: undoStack.length },
      );
      wrapped.cause = err;
      throw wrapped;
    }
  }

  const exportsObj = {
    CycleTransaction: { runAtomic, CycleDomainError },
  };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
