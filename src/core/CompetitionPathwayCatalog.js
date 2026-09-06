// src/core/CompetitionPathwayCatalog.js
// PATHWAYS-1 (DESIGN.md 10.15) — catálogo CANÓNICO de
// `CompetitionPathwayDefinition`, mismo contrato que `CompetitionFormatCatalog.js`/
// `CompetitionScheduleCatalog.js`: contenido estático, cargado una sola vez,
// compartido entre Node y navegador. Convención del proyecto: identificadores
// en inglés, comentarios en español.
//
// Este catálogo NO conoce ningún país/liga/competición concretos — los
// paquetes de contenido (`data/world/spain-2026.1.js`, o un fixture de
// prueba) registran aquí sus propias definiciones vía
// `registerPathwayDefinition()`. Ningún literal de país/competición aparece
// en este archivo.

(function (global) {
  const CompetitionPathwayEntities = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/CompetitionPathway.js')
    : global.BasketManager;

  function Entities() { return CompetitionPathwayEntities; }

  const PATHWAYS_BY_ID = new Map();

  // Registra una definición de pathway (instancia ya construida o dato
  // plano) — misma idempotencia que `CompetitionFormatCatalog.registerFormat()`:
  // misma id+version es un no-op; otra versión con la misma id lanza
  // descriptivo (una definición activa no puede modificarse en caliente).
  function registerPathwayDefinition(data) {
    const definition = (data instanceof Entities().CompetitionPathwayDefinition)
      ? data
      : new (Entities().CompetitionPathwayDefinition)(data);
    const existing = PATHWAYS_BY_ID.get(definition.id);
    if (existing) {
      if (existing.version !== definition.version) {
        throw new Error(
          `CompetitionPathwayCatalog: el pathway "${definition.id}" ya está registrado con la versión `
          + `"${existing.version}" — no se puede volver a registrar con la versión "${definition.version}".`,
        );
      }
      return existing;
    }
    PATHWAYS_BY_ID.set(definition.id, definition);
    return definition;
  }

  function hasPathwayDefinition(id) { return PATHWAYS_BY_ID.has(id); }

  function getPathwayDefinition(id) { return PATHWAYS_BY_ID.get(id) || null; }

  function requirePathwayDefinition(id) {
    const found = getPathwayDefinition(id);
    if (!found) {
      throw new Error(
        `CompetitionPathwayCatalog: pathway desconocido "${id}" — no existe CompetitionPathwayDefinition `
        + 'registrada (nunca se aplica un pathway por defecto).',
      );
    }
    return found;
  }

  // Orden estable por id — nunca el orden de inserción accidental.
  function allPathwayDefinitions() {
    return [...PATHWAYS_BY_ID.values()].sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
  }

  const exportsObj = {
    registerPathwayDefinition,
    hasPathwayDefinition,
    getPathwayDefinition,
    requirePathwayDefinition,
    allPathwayDefinitions,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
