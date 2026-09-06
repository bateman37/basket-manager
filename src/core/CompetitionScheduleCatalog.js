// src/core/CompetitionScheduleCatalog.js
// WORLD-CALENDAR-1 (DESIGN.md 10.14) — catálogo CANÓNICO de
// `CompetitionScheduleDefinition`, con el MISMO contrato que
// `CompetitionFormatCatalog.js` (COMP-CORE-1): un calendario es CONTENIDO
// estático, registrado por los paquetes (`data/world/*.js`), idempotente
// para la misma id+version y con error descriptivo ante contenido
// distinto. Convención del proyecto: identificadores en inglés, comentarios
// en español.
//
// Este archivo NO conoce ningún país/liga/competición concretos — ningún
// literal de España/ACB/FEB/`1ª`/`2ª` (auditado en
// `scripts/test-world-calendar1.js`).

(function (global) {
  const ScheduleEntities = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/CompetitionSchedule.js')
    : global.BasketManager;

  function Entities() { return ScheduleEntities; }

  const SCHEDULES_BY_ID = new Map();

  function canonicalContent(definition) {
    return JSON.stringify(definition.toJSON());
  }

  // Registra una definición (instancia ya construida o dato plano).
  //  - misma id + misma version + MISMO contenido -> idempotente;
  //  - misma id + otra version -> error (un calendario activo no se
  //    modifica después de quedar congelado en una Edition);
  //  - misma id + misma version + contenido DISTINTO -> error.
  function registerSchedule(data) {
    const definition = (data instanceof Entities().CompetitionScheduleDefinition)
      ? data
      : new (Entities().CompetitionScheduleDefinition)(data);
    const existing = SCHEDULES_BY_ID.get(definition.id);
    if (existing) {
      if (existing.version !== definition.version) {
        throw new Error(
          `CompetitionScheduleCatalog: el calendario "${definition.id}" ya está registrado con la versión `
          + `"${existing.version}" — no se puede volver a registrar con "${definition.version}" (un calendario `
          + 'activo queda congelado por Edition).',
        );
      }
      if (canonicalContent(existing) !== canonicalContent(definition)) {
        throw new Error(
          `CompetitionScheduleCatalog: el calendario "${definition.id}" versión "${definition.version}" ya está `
          + 'registrado con un CONTENIDO distinto — dos paquetes no pueden declarar el mismo id/versión con '
          + 'planes diferentes.',
        );
      }
      return existing;
    }
    SCHEDULES_BY_ID.set(definition.id, definition);
    return definition;
  }

  function hasSchedule(scheduleId) { return SCHEDULES_BY_ID.has(scheduleId); }

  function getSchedule(scheduleId) { return SCHEDULES_BY_ID.get(scheduleId) || null; }

  function requireSchedule(scheduleId) {
    const definition = getSchedule(scheduleId);
    if (!definition) {
      throw new Error(
        `CompetitionScheduleCatalog: calendario desconocido "${scheduleId}" — no existe ninguna `
        + 'CompetitionScheduleDefinition registrada. Un calendario desconocido FALLA; nunca hereda el perfil '
        + 'de otra competición (invariante 23 de WORLD-CALENDAR-1).',
      );
    }
    return definition;
  }

  // Orden ESTABLE por id (nunca orden de inserción de `Map`).
  function allSchedules() {
    return [...SCHEDULES_BY_ID.values()].sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
  }

  function describe() {
    return { schedules: allSchedules().map((s) => ({ id: s.id, version: s.version, status: s.status, timeZoneId: s.timeZoneId, plans: s.planKeys.slice() })) };
  }

  const exportsObj = {
    CompetitionScheduleCatalog: {
      registerSchedule, hasSchedule, getSchedule, requireSchedule, allSchedules, describe,
    },
    registerSchedule,
    hasSchedule,
    getSchedule,
    requireSchedule,
    allSchedules,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    global.BasketManager.CompetitionScheduleCatalog = exportsObj.CompetitionScheduleCatalog;
  }
})(typeof window !== 'undefined' ? window : globalThis);
