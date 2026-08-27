// src/utils/CanonicalHash.js
// TRANSFER-1/LOAN-1 (DESIGN.md 9.20/9.21) — serialización canónica
// recursiva y hash determinista compartidos por TransferExecutionService.js
// y LoanExecutionService.js (BUG-TRANSFER1-17: la versión anterior de
// `stableHash()` vivía duplicada dentro de TransferExecutionService.js con
// `JSON.stringify(value, Object.keys(value).sort())`, que solo ordena las
// claves del nivel SUPERIOR — dos objetos lógicamente iguales con
// propiedades anidadas insertadas en distinto orden producían hashes
// DISTINTOS). Módulo puro: nunca criptográfico, solo para detectar que un
// fingerprint de contenido cambió entre planificar y comprometer.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  function canonicalStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }

  function stableHash(value) {
    const s = canonicalStringify(value);
    let hash = 0;
    for (let i = 0; i < s.length; i += 1) {
      hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
    }
    return `h${(hash >>> 0).toString(36)}`;
  }

  const exportsObj = {
    CanonicalHash: { canonicalStringify, stableHash },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
