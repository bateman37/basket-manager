// src/entities/CareerSetup.js
// WORLD-UI-1 (DESIGN.md 10.18) — `CareerSetupSnapshot`: configuración de
// carrera EXPLÍCITA, plana y serializable, congelada al construirse. Es la
// autoridad de arranque (`startCareerFromSetup()`, `src/ui/game.js`) — antes
// de esta entrega `startSeason(teamId, division)` decidía paquetes, huso,
// temporada y niveles con literales fijos dentro de `game.js`. El borrador
// de la pantalla de configuración puede ser mutable; en cuanto se construye
// este snapshot deja de serlo (invariante 7 del prompt: "el snapshot de
// carrera es explícito, inmutable, serializable y no usa fecha de máquina").
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const WorldSimulationModule = dep('./WorldSimulation.js');

  const SCHEMA_VERSION = 'world-ui-1';
  const SCOPE_TYPES = ['competition', 'area'];

  function requireField(label, data, field) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new Error(`${label}: falta "${field}" explícito.`);
    }
    return data[field];
  }

  function requireNonEmptyStringArray(label, field, value) {
    if (!Array.isArray(value) || !value.length) {
      throw new Error(`${label}: "${field}" debe ser un array no vacío de ids explícitos.`);
    }
    value.forEach((item) => {
      if (typeof item !== 'string' || !item) {
        throw new Error(`${label}: "${field}" contiene un id no válido "${item}".`);
      }
    });
    return value;
  }

  // Orden CANÓNICO por id (nunca el orden accidental en que la interfaz
  // registró los clics) — invariante 12 del prompt ("Mundo/áreas/
  // organizaciones/clubes/competiciones se ordenan de forma estable").
  function normalizedUniqueIds(ids) {
    return [...new Set(ids)].sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  }

  // Reutiliza EXACTAMENTE la misma regla de conflicto que
  // `WorldSimulationProfile` (WORLD-SIM-1, DESIGN.md 10.16) — nunca una
  // segunda implementación que pueda desincronizarse de esa (sección 3.1
  // del prompt: "dos assignments incompatibles para el mismo scope
  // bloquean"). Construir un perfil temporal desechable es la forma más
  // segura de garantizar EXACTAMENTE el mismo criterio de conflicto.
  function validateAndNormalizeAssignments(label, rawAssignments) {
    const list = Array.isArray(rawAssignments) ? rawAssignments : [];
    list.forEach((raw) => {
      if (!raw || typeof raw !== 'object') {
        throw new Error(`${label}: "simulationAssignments" contiene una entrada no válida.`);
      }
      if (!SCOPE_TYPES.includes(raw.scopeType)) {
        throw new Error(`${label}: "simulationAssignments" declara scopeType "${raw.scopeType}" no válido — debe ser una de ${SCOPE_TYPES.join(', ')}.`);
      }
      requireField(label, raw, 'scopeId');
      if (!WorldSimulationModule.DETAIL_LEVELS.includes(raw.detailLevel)) {
        throw new Error(`${label}: "simulationAssignments" declara detailLevel "${raw.detailLevel}" no válido.`);
      }
    });
    // Delegar la detección de conflicto en `WorldSimulationProfile` — lanza
    // con el mismo mensaje/criterio que el perfil real construirá después.
    // eslint-disable-next-line no-new
    new WorldSimulationModule.WorldSimulationProfile({
      id: `${label}:assignments-check`,
      version: '0',
      defaultDetailLevel: 'abstract',
      assignments: list,
    });
    return [...list]
      .map((a) => Object.freeze({ scopeType: a.scopeType, scopeId: a.scopeId, detailLevel: a.detailLevel }))
      .sort((a, b) => {
        const keyA = `${a.scopeType}:${a.scopeId}`;
        const keyB = `${b.scopeType}:${b.scopeId}`;
        return keyA < keyB ? -1 : (keyA > keyB ? 1 : 0);
      });
  }

  // ---------------------------------------------------------------------
  // CareerSetupSnapshot — ver sección 3.1 del prompt. Todo dato temporal
  // (temporada, huso, fecha de creación) llega EXPLÍCITO desde quien
  // construye el snapshot (`CareerSetupService`) — nunca `new Date()`/
  // `Date.now()` aquí dentro (invariante 7).
  // ---------------------------------------------------------------------
  class CareerSetupSnapshot {
    constructor(data = {}) {
      const label = `CareerSetupSnapshot "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.schemaVersion = SCHEMA_VERSION;
      this.seasonKey = requireField(label, data, 'seasonKey');
      if (!Number.isInteger(data.seasonStartYear)) {
        throw new Error(`${label}: falta "seasonStartYear" entero explícito.`);
      }
      this.seasonStartYear = data.seasonStartYear;
      this.timeZoneId = requireField(label, data, 'timeZoneId');
      this.selectedContentPackIds = normalizedUniqueIds(
        requireNonEmptyStringArray(label, 'selectedContentPackIds', data.selectedContentPackIds),
      );
      this.controlledClubId = requireField(label, data, 'controlledClubId');
      this.controlledTeamId = requireField(label, data, 'controlledTeamId');
      this.careerSeed = requireField(label, data, 'careerSeed');
      if (!WorldSimulationModule.DETAIL_LEVELS.includes(data.defaultDetailLevel)) {
        throw new Error(`${label}: "defaultDetailLevel" = "${data.defaultDetailLevel}" no válido.`);
      }
      this.defaultDetailLevel = data.defaultDetailLevel;
      this.simulationAssignments = validateAndNormalizeAssignments(label, data.simulationAssignments);
      this.createdAtGameDate = requireField(label, data, 'createdAtGameDate');
      this.provenance = data.provenance || null;

      Object.freeze(this.selectedContentPackIds);
      Object.freeze(this.simulationAssignments);
      Object.freeze(this);
    }

    // Serializable puro (invariante 7 del prompt) — solo objetos/arrays/
    // strings/números/booleanos, nunca Map/funciones/instancias vivas.
    toJSON() {
      return {
        id: this.id,
        schemaVersion: this.schemaVersion,
        seasonKey: this.seasonKey,
        seasonStartYear: this.seasonStartYear,
        timeZoneId: this.timeZoneId,
        selectedContentPackIds: [...this.selectedContentPackIds],
        controlledClubId: this.controlledClubId,
        controlledTeamId: this.controlledTeamId,
        careerSeed: this.careerSeed,
        defaultDetailLevel: this.defaultDetailLevel,
        simulationAssignments: this.simulationAssignments.map((a) => ({ ...a })),
        createdAtGameDate: this.createdAtGameDate,
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = { CareerSetupSnapshot, CAREER_SETUP_SCHEMA_VERSION: SCHEMA_VERSION };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
