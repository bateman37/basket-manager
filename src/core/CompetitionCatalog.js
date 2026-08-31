// src/core/CompetitionCatalog.js
// WORLD-CORE-1 (ARCH-WORLD-04) — catálogo CANÓNICO de `CompetitionDefinition`
// (identidad de competición). Antes de esta entrega, `CompetitionRules.js`
// mantenía su propia tabla `COMPETITION_DEFINITIONS` — esa era la segunda
// fuente que WORLD-CORE-1 elimina: `CompetitionRules.js` ahora importa este
// catálogo y reexporta LOS MISMOS objetos (identidad `===`, nunca una copia).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Este módulo NO conoce reglas normativas (eso sigue en `CompetitionRules.js`
// / `CompetitionRules` domains) ni el mundo de una carrera concreta (eso es
// `WorldRegistry.js`/`CompetitionEdition`/`CompetitionStage`/`CompetitionEntry`,
// por carrera). Es un catálogo ESTÁTICO, igual de disponible en Node que en
// el navegador, cargado una sola vez — igual que `CompetitionRules.js` ya lo
// era antes de esta entrega.
//
// IDs de área/organización usados aquí (`area-country-es`, `org-acb`, ...)
// son los MISMOS literales que registra `data/world/spain-2026.1.js` — se
// duplican como string estable entre ambos archivos (mismo criterio ya
// aceptado en el proyecto para `Calendar.CUP_TRIGGER_ROUND`, ver su propio
// comentario), nunca se infieren de un nombre visible.

(function (global) {
  const CompetitionEntities = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Competition.js')
    : global.BasketManager;

  function Entities() { return CompetitionEntities; }

  const COMPETITION_IDS = {
    ACB: 'acb',
    PRIMERA_FEB: 'primera-feb',
    COPA_ACB: 'copa-acb',
    // catalog-only (sección 6 del prompt de WORLD-CORE-1): capacidad
    // declarada, sin edición jugable — no hay participantes/calendario/
    // reglas reales de Supercopa todavía, no se fabrica una edición falsa.
    SUPERCOPA_ACB: 'supercopa-acb',
    // Perfil SOLO DE TEST (ya existía en CompetitionRules antes de esta
    // entrega) — nunca usar en una partida real.
    TEST_FICTIONAL: 'bm-test-fictional-league',
  };

  // IDs de área estables usados por `spain-2026.1` (ver comentario de
  // cabecera). `null` para el fixture de test, que no pertenece a ninguna
  // geografía real registrada por world-core/spain.
  const SPAIN_AREA_ID = 'area-country-es';

  const COMPETITION_DEFINITIONS = {};

  function buildAndRegister(data) {
    const definition = new (Entities().CompetitionDefinition)(data);
    if (COMPETITION_DEFINITIONS[definition.id]) {
      throw new Error(`CompetitionCatalog: id de competición duplicado "${definition.id}".`);
    }
    COMPETITION_DEFINITIONS[definition.id] = definition;
    return definition;
  }

  buildAndRegister({
    id: COMPETITION_IDS.ACB,
    name: 'Liga ACB',
    shortName: 'ACB',
    scopeLevel: 'national',
    scopeAreaId: SPAIN_AREA_ID,
    organizerId: 'org-acb',
    participantType: 'club-team',
    category: { gender: 'men', ageGroup: 'senior' },
    kind: 'league',
    recurrence: 'annual',
    tier: 1,
    implementationStatus: 'active-runtime',
    bindings: { scheduleProfileId: 'spain-2026.1:schedule:1a' },
    provenance: { dataSource: 'spain-2026.1', status: 'verified' },
    // Compatibilidad legacy — ver Competition.js.
    organizerCountry: 'ES',
    federationId: 'feb-general',
    legacyDivision: '1ª',
  });

  buildAndRegister({
    id: COMPETITION_IDS.PRIMERA_FEB,
    name: 'Primera FEB',
    shortName: 'Primera FEB',
    scopeLevel: 'national',
    scopeAreaId: SPAIN_AREA_ID,
    organizerId: 'org-feb',
    participantType: 'club-team',
    category: { gender: 'men', ageGroup: 'senior' },
    kind: 'league',
    recurrence: 'annual',
    tier: 2,
    implementationStatus: 'active-runtime',
    bindings: { scheduleProfileId: 'spain-2026.1:schedule:2a' },
    provenance: { dataSource: 'spain-2026.1', status: 'verified' },
    organizerCountry: 'ES',
    federationId: 'feb-general',
    legacyDivision: '2ª',
  });

  buildAndRegister({
    id: COMPETITION_IDS.COPA_ACB,
    name: 'Copa ACB',
    shortName: 'Copa',
    scopeLevel: 'national',
    scopeAreaId: SPAIN_AREA_ID,
    organizerId: 'org-acb',
    participantType: 'club-team',
    category: { gender: 'men', ageGroup: 'senior' },
    kind: 'cup',
    recurrence: 'annual',
    tier: null,
    implementationStatus: 'active-runtime',
    bindings: {},
    provenance: { dataSource: 'spain-2026.1', status: 'verified' },
    organizerCountry: 'ES',
    federationId: 'feb-general',
    legacyDivision: null,
  });

  buildAndRegister({
    id: COMPETITION_IDS.SUPERCOPA_ACB,
    name: 'Supercopa ACB',
    shortName: 'Supercopa',
    scopeLevel: 'national',
    scopeAreaId: SPAIN_AREA_ID,
    organizerId: 'org-acb',
    participantType: 'club-team',
    category: { gender: 'men', ageGroup: 'senior' },
    kind: 'supercup',
    recurrence: 'annual',
    tier: null,
    // catalog-only: identidad declarada, sin edición ni entries — no hay
    // participantes/formato/calendario reales todavía (ver DESIGN.md 3.2.4
    // y el prompt de WORLD-CORE-1, sección 6/15). Entrega de contenido
    // futura la activará con datos reales.
    implementationStatus: 'catalog-only',
    bindings: {},
    provenance: { dataSource: 'spain-2026.1', status: 'provisional' },
    organizerCountry: 'ES',
    federationId: 'feb-general',
    legacyDivision: null,
  });

  buildAndRegister({
    id: COMPETITION_IDS.TEST_FICTIONAL,
    name: '[SOLO TEST] Liga ficticia de prueba',
    shortName: '[TEST]',
    scopeLevel: 'national',
    scopeAreaId: 'area-country-test-xx',
    organizerId: 'org-bm-test',
    participantType: 'club-team',
    category: { gender: 'men', ageGroup: 'senior' },
    kind: 'league',
    recurrence: 'annual',
    tier: null,
    implementationStatus: 'catalog-only',
    bindings: {},
    provenance: { dataSource: 'test-fixture', status: 'provisional' },
    organizerCountry: 'XX',
    federationId: null,
    legacyDivision: null,
  });

  function getCompetitionDefinition(competitionId) {
    const definition = COMPETITION_DEFINITIONS[competitionId];
    if (!definition) {
      throw new Error(
        `CompetitionCatalog: competición desconocida "${competitionId}" — no existe CompetitionDefinition `
        + 'registrada (nunca se aplica ACB por defecto).',
      );
    }
    return definition;
  }

  function listCompetitions() {
    return Object.values(COMPETITION_DEFINITIONS);
  }

  // Punto de extensión para packs de contenido futuros (EUROPE-CONTENT-1 y
  // siguientes) — nunca usado por `spain-2026.1`/`world-core-2026.1`
  // (registran referencias a los ya construidos arriba, no crean los suyos).
  function registerCompetitionDefinition(data) {
    if (COMPETITION_DEFINITIONS[data.id]) {
      throw new Error(`CompetitionCatalog: id de competición duplicado "${data.id}" al registrar una nueva definición.`);
    }
    return buildAndRegister(data);
  }

  const exportsObj = {
    COMPETITION_IDS,
    COMPETITION_DEFINITIONS,
    getCompetitionDefinition,
    listCompetitions,
    registerCompetitionDefinition,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
