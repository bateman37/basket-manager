// src/core/CompetitionFormatCatalog.js
// COMP-CORE-1 (DESIGN.md 10.13) — catálogo CANÓNICO de
// `CompetitionFormatDefinition`, mismo criterio que `CompetitionCatalog.js`
// con las `CompetitionDefinition`: un formato es CONTENIDO estático, tan
// disponible en Node como en el navegador, cargado una sola vez. Convención
// del proyecto: identificadores en inglés, comentarios en español.
//
// Este catálogo NO conoce ningún país/liga/competición concretos — los paquetes de contenido
// (`data/world/spain-2026.1.js`) registran aquí sus propios formatos vía
// `registerFormat()`. Ningún literal de país/competición aparece en este
// archivo.

(function (global) {
  const CompetitionEntities = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Competition.js')
    : global.BasketManager;

  function Entities() { return CompetitionEntities; }

  const FORMATS_BY_ID = new Map();

  // Registra una definición de formato (instancia ya construida o dato
  // plano) — id+version incompatible con lo ya registrado lanza de forma
  // descriptiva. Una definición ya registrada con la MISMA id+version es
  // idempotente (permite recargar el mismo módulo de contenido varias
  // veces sin duplicar el catálogo).
  function registerFormat(data) {
    const format = (data instanceof Entities().CompetitionFormatDefinition)
      ? data
      : new (Entities().CompetitionFormatDefinition)(data);
    const existing = FORMATS_BY_ID.get(format.id);
    if (existing) {
      if (existing.version !== format.version) {
        throw new Error(
          `CompetitionFormatCatalog: el formato "${format.id}" ya está registrado con la versión `
          + `"${existing.version}" — no se puede volver a registrar con la versión "${format.version}" `
          + '(una definición activa no puede modificarse tras fijarse en una edición).',
        );
      }
      return existing;
    }
    FORMATS_BY_ID.set(format.id, format);
    return format;
  }

  function hasFormat(formatId) { return FORMATS_BY_ID.has(formatId); }

  function getFormat(formatId) { return FORMATS_BY_ID.get(formatId) || null; }

  function requireFormat(formatId) {
    const format = getFormat(formatId);
    if (!format) {
      throw new Error(
        `CompetitionFormatCatalog: formato desconocido "${formatId}" — no existe `
        + 'CompetitionFormatDefinition registrada (nunca se aplica un formato por defecto).',
      );
    }
    return format;
  }

  function allFormats() { return [...FORMATS_BY_ID.values()]; }

  const exportsObj = {
    registerFormat, hasFormat, getFormat, requireFormat, allFormats,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
