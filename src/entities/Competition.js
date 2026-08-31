// src/entities/Competition.js
// WORLD-CORE-1 (ARCH-WORLD-04/05/06) — identidad de competición separada de
// la normativa: `CompetitionDefinition` (identidad duradera),
// `CompetitionEdition` (instancia por temporada), `CompetitionStage` (fase
// dentro de una edición — Liga regular, Playoff por el título, Copa como
// eliminatoria propia...) y `CompetitionEntry` (fuente de verdad de
// participación). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Invariante 13 (DESIGN.md): Liga, Copa y playoff NO se confunden — la Copa
// es una `CompetitionDefinition` separada (con su propia `CompetitionEdition`
// cada temporada); el playoff por el título/de ascenso es un `CompetitionStage`
// DENTRO de la edición de Liga de esa temporada, nunca una competición aparte.
//
// Ningún runner genérico todavía (COMP-CORE-1 lo escribirá): estas entidades
// declaran identidad y relaciones; `League`/`Bracket`/`Cup`/`Playoffs`/
// `Promotion` siguen resolviendo los partidos de verdad.

(function (global) {
  const SCOPE_LEVELS = ['world', 'continental', 'national', 'regional'];
  const PARTICIPANT_TYPES = ['club-team', 'national-team'];
  const COMPETITION_KINDS = ['league', 'cup', 'supercup', 'championship', 'qualifier', 'other'];
  const IMPLEMENTATION_STATUSES = ['active-runtime', 'catalog-only', 'future'];

  const EDITION_STATUSES = ['planned', 'active', 'completed', 'cancelled'];
  const STAGE_TYPES = ['round-robin', 'knockout', 'series', 'group', 'final-four', 'other'];
  const STAGE_STATUSES = ['planned', 'active', 'completed', 'cancelled'];
  const ENTRY_STATUSES = ['invited', 'qualified', 'active', 'eliminated', 'withdrawn', 'completed'];

  function requireField(ownerLabel, data, field) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new Error(`${ownerLabel}: falta "${field}" explícito.`);
    }
    return data[field];
  }

  function requireOneOf(ownerLabel, field, value, allowed) {
    if (!allowed.includes(value)) {
      throw new Error(`${ownerLabel}: "${field}" = "${value}" no válido — debe ser uno de ${allowed.join(', ')}.`);
    }
    return value;
  }

  // ---------------------------------------------------------------------
  // CompetitionDefinition — identidad duradera, independiente de temporada
  // y de reglas. Vive en el catálogo mundial (`CompetitionCatalog.js`);
  // `CompetitionRules.js` sigue siendo la fuente de la normativa aplicable,
  // nunca de esta identidad (ARCH-WORLD-04).
  // ---------------------------------------------------------------------
  class CompetitionDefinition {
    constructor(data = {}) {
      const label = `CompetitionDefinition "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.name = data.name || this.id;
      this.shortName = data.shortName || this.name;
      this.scopeLevel = requireOneOf(label, 'scopeLevel', data.scopeLevel, SCOPE_LEVELS);
      // `scopeAreaId` puede ser null solo para `scopeLevel: 'world'`.
      if (data.scopeAreaId === undefined) throw new Error(`${label}: falta "scopeAreaId" explícito (usa null solo para scopeLevel "world").`);
      if (data.scopeAreaId === null && this.scopeLevel !== 'world') {
        throw new Error(`${label}: "scopeAreaId" solo puede ser null cuando scopeLevel es "world".`);
      }
      this.scopeAreaId = data.scopeAreaId;
      this.organizerId = requireField(label, data, 'organizerId');
      this.participantType = requireOneOf(label, 'participantType', data.participantType, PARTICIPANT_TYPES);
      this.category = data.category || null;
      this.kind = requireOneOf(label, 'kind', data.kind, COMPETITION_KINDS);
      this.recurrence = data.recurrence || 'annual';
      this.pyramidId = data.pyramidId !== undefined ? data.pyramidId : null;
      this.tier = data.tier !== undefined ? data.tier : null;
      this.implementationStatus = requireOneOf(
        label, 'implementationStatus', data.implementationStatus || 'catalog-only', IMPLEMENTATION_STATUSES,
      );
      // Bindings por ID a formato/calendario/reglas — nunca el algoritmo
      // incrustado aquí (ARCH-WORLD-04/05).
      this.bindings = { ...(data.bindings || {}) };
      this.provenance = data.provenance || null;

      // --- Compatibilidad legacy (ROSTER-1..CYCLE-1, ver CompetitionRules.js) ---
      // Estos tres campos existían ya en `CompetitionRules.COMPETITION_DEFINITIONS`
      // antes de esta entrega — se conservan en el MISMO objeto (nunca una
      // segunda fuente) para no romper ningún consumidor existente.
      this.organizerCountry = data.organizerCountry !== undefined ? data.organizerCountry : null;
      this.federationId = data.federationId !== undefined ? data.federationId : null;
      this.legacyDivision = data.legacyDivision !== undefined ? data.legacyDivision : null;
    }

    toJSON() {
      return {
        id: this.id,
        name: this.name,
        shortName: this.shortName,
        scopeLevel: this.scopeLevel,
        scopeAreaId: this.scopeAreaId,
        organizerId: this.organizerId,
        participantType: this.participantType,
        category: this.category,
        kind: this.kind,
        recurrence: this.recurrence,
        pyramidId: this.pyramidId,
        tier: this.tier,
        implementationStatus: this.implementationStatus,
        bindings: { ...this.bindings },
        provenance: this.provenance,
        organizerCountry: this.organizerCountry,
        federationId: this.federationId,
        legacyDivision: this.legacyDivision,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionEdition — instancia de una definición en un ciclo temporal.
  // `stageIds`/`entryIds` son mutados EXCLUSIVAMENTE por
  // `CompetitionStageRegistry`/`CompetitionEntryRegistry` (WorldRegistry.js)
  // al registrar un stage/entry con esta edición — nunca empujados a mano
  // desde otro sitio, para que nunca puedan desincronizarse del registro.
  // ---------------------------------------------------------------------
  class CompetitionEdition {
    constructor(data = {}) {
      const label = `CompetitionEdition "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.competitionDefinitionId = requireField(label, data, 'competitionDefinitionId');
      this.seasonKey = requireField(label, data, 'seasonKey');
      this.startDate = data.startDate || null;
      this.endDate = data.endDate !== undefined ? data.endDate : null;
      this.status = requireOneOf(label, 'status', data.status || 'planned', EDITION_STATUSES);
      this.stageIds = [];
      this.entryIds = [];
      // Ids/versiones CONGELADAS de formato/calendario/ruleset aplicable —
      // nunca el objeto de reglas incrustado (delega siempre en
      // `CompetitionRules.resolveRules()`).
      this.formatBindingId = data.formatBindingId !== undefined ? data.formatBindingId : null;
      this.scheduleProfileId = data.scheduleProfileId !== undefined ? data.scheduleProfileId : null;
      this.rulesetBundleId = data.rulesetBundleId !== undefined ? data.rulesetBundleId : null;
      // WORLD-SIM-1 (futuro): nivel de detalle de simulación de esta
      // edición. WORLD-CORE-1 solo declara el campo — todas las ediciones
      // reales de esta entrega son 'playable'.
      this.detailLevel = data.detailLevel || 'playable';
      // Enlace TRANSITORIO al runtime legacy (League/Bracket/Cup/Playoffs/
      // Promotion) — NUNCA debe aparecer en un snapshot/diagnóstico plano.
      this.runtimeBinding = data.runtimeBinding !== undefined ? data.runtimeBinding : null;
    }

    setStatus(status) {
      this.status = requireOneOf(`CompetitionEdition "${this.id}"`, 'status', status, EDITION_STATUSES);
    }

    // Representación serializable — EXCLUYE `runtimeBinding` (invariante 27:
    // ningún diagnóstico puede llevar una instancia viva de League/Bracket).
    toJSON() {
      return {
        id: this.id,
        competitionDefinitionId: this.competitionDefinitionId,
        seasonKey: this.seasonKey,
        startDate: this.startDate,
        endDate: this.endDate,
        status: this.status,
        stageIds: [...this.stageIds],
        entryIds: [...this.entryIds],
        formatBindingId: this.formatBindingId,
        scheduleProfileId: this.scheduleProfileId,
        rulesetBundleId: this.rulesetBundleId,
        detailLevel: this.detailLevel,
        hasRuntimeBinding: this.runtimeBinding !== null,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionStage — fase dentro de una edición (temporada regular,
  // playoff por el título, eliminatoria de Copa...).
  // ---------------------------------------------------------------------
  class CompetitionStage {
    constructor(data = {}) {
      const label = `CompetitionStage "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.editionId = requireField(label, data, 'editionId');
      this.name = data.name || this.id;
      this.sequence = data.sequence !== undefined ? data.sequence : 0;
      this.stageType = requireOneOf(label, 'stageType', data.stageType, STAGE_TYPES);
      this.status = requireOneOf(label, 'status', data.status || 'planned', STAGE_STATUSES);
      this.entryIds = [];
      this.sourceStageIds = Array.isArray(data.sourceStageIds) ? [...data.sourceStageIds] : [];
      this.nextStageIds = Array.isArray(data.nextStageIds) ? [...data.nextStageIds] : [];
      // Enlace TRANSITORIO al runtime legacy — excluido de cualquier snapshot.
      this.runtimeBinding = data.runtimeBinding !== undefined ? data.runtimeBinding : null;
    }

    setStatus(status) {
      this.status = requireOneOf(`CompetitionStage "${this.id}"`, 'status', status, STAGE_STATUSES);
    }

    toJSON() {
      return {
        id: this.id,
        editionId: this.editionId,
        name: this.name,
        sequence: this.sequence,
        stageType: this.stageType,
        status: this.status,
        entryIds: [...this.entryIds],
        sourceStageIds: [...this.sourceStageIds],
        nextStageIds: [...this.nextStageIds],
        hasRuntimeBinding: this.runtimeBinding !== null,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionEntry — fuente de verdad de participación (invariante 8:
  // nunca se deriva de nacionalidad ni de `Team.division`).
  // ---------------------------------------------------------------------
  class CompetitionEntry {
    constructor(data = {}) {
      const label = `CompetitionEntry "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.editionId = requireField(label, data, 'editionId');
      // Un entry puede asociarse además a un stage concreto (opcional) —
      // sin stage, representa la participación en la edición en general.
      this.stageId = data.stageId !== undefined ? data.stageId : null;
      this.participantType = requireOneOf(label, 'participantType', data.participantType, PARTICIPANT_TYPES);
      this.participantId = requireField(label, data, 'participantId');
      this.entryStatus = requireOneOf(label, 'entryStatus', data.entryStatus || 'active', ENTRY_STATUSES);
      this.seed = data.seed !== undefined ? data.seed : null;
      this.qualificationSource = data.qualificationSource !== undefined ? data.qualificationSource : null;
      this.validFrom = data.validFrom || null;
      this.validTo = data.validTo !== undefined ? data.validTo : null;
    }

    setStatus(status) {
      this.entryStatus = requireOneOf(`CompetitionEntry "${this.id}"`, 'entryStatus', status, ENTRY_STATUSES);
    }

    toJSON() {
      return {
        id: this.id,
        editionId: this.editionId,
        stageId: this.stageId,
        participantType: this.participantType,
        participantId: this.participantId,
        entryStatus: this.entryStatus,
        seed: this.seed,
        qualificationSource: this.qualificationSource,
        validFrom: this.validFrom,
        validTo: this.validTo,
      };
    }
  }

  const exportsObj = {
    CompetitionDefinition,
    CompetitionEdition,
    CompetitionStage,
    CompetitionEntry,
    SCOPE_LEVELS,
    PARTICIPANT_TYPES,
    COMPETITION_KINDS,
    IMPLEMENTATION_STATUSES,
    EDITION_STATUSES,
    STAGE_TYPES,
    STAGE_STATUSES,
    ENTRY_STATUSES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
