// src/utils/DeterministicRandom.js
// MARKET-1 (DESIGN.md 9.19, sección 9.6 del prompt) — hash/PRNG
// determinista compartido por NegotiationService/MarketSeeder. Mismo
// esquema FNV-1a que ya usa ContractSeeder.js (GENERATOR_VERSION propio,
// sin `Math.random`), extraído aquí porque MARKET-1 lo necesita en varios
// módulos nuevos — CONTRACT-1 no se toca (conserva su copia privada).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  function hash32(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  // [0,1) determinista — mismo fingerprint+discriminador siempre da el
  // mismo valor; discriminadores distintos son independientes entre sí.
  function unitFrom(fingerprint, discriminator) {
    return hash32(`${fingerprint}#${discriminator}`) / 0x100000000;
  }

  // Entero determinista en [min, max] inclusive.
  function intFrom(fingerprint, discriminator, min, max) {
    if (max < min) throw new Error('DeterministicRandom.intFrom: "max" no puede ser menor que "min".');
    return min + Math.round(unitFrom(fingerprint, discriminator) * (max - min));
  }

  // Elige un elemento de una lista de forma determinista.
  function pickFrom(fingerprint, discriminator, list) {
    if (!list.length) return undefined;
    const index = Math.floor(unitFrom(fingerprint, discriminator) * list.length);
    return list[Math.min(index, list.length - 1)];
  }

  const exportsObj = {
    DeterministicRandom: {
      hash32, unitFrom, intFrom, pickFrom,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
