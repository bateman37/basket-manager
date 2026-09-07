// data/world/content-pack-catalog.js
// WORLD-HARDEN-1 (DESIGN.md 10.19) — índice de paquetes de contenido
// DISPONIBLES para una carrera. Antes de esta entrega `game.js` construía a
// mano `[WORLD_CORE_MANIFEST, SPAIN_MANIFEST]` en dos sitios distintos
// (`careerSetupManifestsById()` y el arranque real) — ahora hay una única
// fuente, para que añadir un paquete nuevo sea registrar su entrada aquí,
// nunca tocar `game.js`. Sigue habiendo solo estos dos paquetes reales
// (CLAUDE.md/DESIGN.md 10.7: no se añade contenido nuevo en esta entrega).
//
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const { WORLD_CORE_MANIFEST } = dep('./world-core-2026.1.js');
  const { SPAIN_MANIFEST } = dep('./spain-2026.1.js');

  // Orden de declaración irrelevante — `ContentPackRegistry.computeInstallOrder()`
  // deriva SIEMPRE el orden real de las dependencias (invariante 20).
  const AVAILABLE_CONTENT_PACKS = [WORLD_CORE_MANIFEST, SPAIN_MANIFEST];

  function listAvailableContentPacks() {
    return [...AVAILABLE_CONTENT_PACKS];
  }

  function availableContentPacksById() {
    const byId = {};
    AVAILABLE_CONTENT_PACKS.forEach((manifest) => { byId[manifest.id] = manifest; });
    return byId;
  }

  const exportsObj = {
    AVAILABLE_CONTENT_PACKS,
    listAvailableContentPacks,
    availableContentPacksById,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
