// src/storage/IndexedDbCareerSaveRepository.js
// SAVE-LOAD-1 — repositorio de persistencia AISLADO de la UI: la única
// pieza del sistema que toca IndexedDB directamente. `src/ui/game.js`
// nunca abre una transacción ni conoce el nombre de la base de datos —
// solo llama a `listSlots()`/`readSlot()`/`writeSlot()`/`deleteSlot()`.
// Sin dependencias externas (IndexedDB nativo del navegador).
//
// Base de datos `basket-manager`, object store `career-saves`
// (`keyPath: 'slotId'`), cuatro ranuras fijas: `manual-1`, `manual-2`,
// `manual-3`, `autosave`. Cada escritura es UNA transacción `readwrite`
// con un único `put()` — IndexedDB garantiza que una transacción que no
// completa (error/abort, p.ej. cuota excedida) no deja nada escrito: el
// valor anterior de la ranura sobrevive intacto (sección 4.1 del prompt:
// "un error de cuota, serialización o transacción no puede destruir el
// guardado anterior ni dejar un registro parcial").
//
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  const DB_NAME = 'basket-manager';
  const DB_VERSION = 1;
  const STORE_NAME = 'career-saves';
  const SLOT_IDS = ['manual-1', 'manual-2', 'manual-3', 'autosave'];

  function resolveIndexedDb() {
    if (typeof indexedDB !== 'undefined') return indexedDB;
    if (global && global.indexedDB) return global.indexedDB;
    return null;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const idb = resolveIndexedDb();
      if (!idb) {
        reject(new Error('IndexedDbCareerSaveRepository: IndexedDB no está disponible en este entorno.'));
        return;
      }
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slotId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDbCareerSaveRepository: fallo al abrir la base de datos.'));
    });
  }

  // Ejecuta `fn(store)` dentro de UNA transacción — resuelve solo cuando la
  // transacción COMPLETA de verdad (nunca en el `onsuccess` de la request
  // individual), así que un fallo posterior en la misma transacción sigue
  // pudiendo abortarla antes de que el llamador crea que ya se guardó.
  function runInStore(mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      let tx;
      let opResult;
      try {
        tx = db.transaction(STORE_NAME, mode);
      } catch (error) {
        reject(error);
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      try {
        opResult = fn(store, tx);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(opResult);
      tx.onerror = () => reject(tx.error || new Error('IndexedDbCareerSaveRepository: transacción con error.'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDbCareerSaveRepository: transacción abortada (p.ej. cuota excedida) — la ranura anterior no se ha tocado.'));
    }));
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function isValidSlotId(slotId) {
    return SLOT_IDS.indexOf(slotId) !== -1;
  }

  function requireValidSlotId(slotId) {
    if (!isValidSlotId(slotId)) {
      throw new Error(`IndexedDbCareerSaveRepository: ranura desconocida "${slotId}" — debe ser una de ${SLOT_IDS.join(', ')}.`);
    }
  }

  // Metadatos de las 4 ranuras (una entrada por ranura, `record: null` si
  // está vacía) — para la pantalla "Cargar partida"/"Continuar" sin tener
  // que leer el envelope completo de cada una.
  function listSlots() {
    return runInStore('readonly', (store) => Promise.all(
      SLOT_IDS.map((slotId) => requestToPromise(store.get(slotId))),
    )).then((records) => SLOT_IDS.map((slotId, i) => ({ slotId, record: records[i] || null })));
  }

  function readSlot(slotId) {
    requireValidSlotId(slotId);
    return runInStore('readonly', (store) => requestToPromise(store.get(slotId)))
      .then((record) => record || null);
  }

  // `record`: `{ slotId, envelope, updatedAtUtc }` — `envelope` es el
  // objeto COMPLETO ya producido por `game.js` (formato
  // `basket-manager-career-save`, fingerprint incluido). Este repositorio
  // no valida su contenido — eso es responsabilidad de
  // `CareerHydrationService`/`CareerPersistenceBoundary` en la frontera de
  // lectura, nunca aquí (esta capa es solo almacenamiento).
  function writeSlot(slotId, envelope) {
    requireValidSlotId(slotId);
    if (!envelope) throw new Error('IndexedDbCareerSaveRepository.writeSlot: falta "envelope".');
    const record = { slotId, envelope, updatedAtUtc: new Date().toISOString() };
    return runInStore('readwrite', (store) => {
      store.put(record);
      return record;
    });
  }

  function deleteSlot(slotId) {
    requireValidSlotId(slotId);
    return runInStore('readwrite', (store) => {
      store.delete(slotId);
      return true;
    });
  }

  const exportsObj = {
    IndexedDbCareerSaveRepository: {
      SLOT_IDS,
      DB_NAME,
      STORE_NAME,
      listSlots,
      readSlot,
      writeSlot,
      deleteSlot,
      isValidSlotId,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
