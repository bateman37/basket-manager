// src/utils/RegistryIndexAudit.js
// BUG-TRANSFER1-14 (DESIGN.md 9.21) — auditoría genérica y compartida de un
// índice secundario (Map: clave -> [id]) contra su Map primario (id ->
// entidad), reutilizada por ContractRegistry/RegistrationRegistry/
// TransferRegistry/LoanRegistry. Un `unregister...` mal implementado (o un
// rollback que solo borra el Map primario) deja ids colgantes o duplicados
// aquí, invisibles si solo se mira el tamaño del Map — por eso
// `validateIntegrity()` de cada registro llama a esto, nunca reimplementa
// la comprobación por su cuenta. Convención del proyecto: identificadores
// en inglés, comentarios en español.
//
// Módulo puro: no lee DOM, ni `state`, ni variables globales.

(function (global) {
  function auditIndexSymmetry(indexName, indexMap, primaryMap) {
    const errors = [];
    indexMap.forEach((ids, key) => {
      const seenInList = new Set();
      ids.forEach((id) => {
        if (!primaryMap.has(id)) {
          errors.push(`Índice "${indexName}" (clave "${key}") referencia el id "${id}", ausente del Map primario — índice colgante.`);
        }
        if (seenInList.has(id)) {
          errors.push(`Índice "${indexName}" (clave "${key}") contiene el id "${id}" más de una vez.`);
        }
        seenInList.add(id);
      });
    });
    return errors;
  }

  const exportsObj = { RegistryIndexAudit: { auditIndexSymmetry } };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
