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
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  // WORLD-SIM-1 (DESIGN.md 10.16) — vocabulario CERRADO de nivel de
  // detalle, definido UNA sola vez en `WorldSimulation.js`.
  const WorldSimulationModule = dep('./WorldSimulation.js');

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
      // PATHWAYS-1 (DESIGN.md 10.15): ids ESTABLES de `CompetitionPathwayDefinition`
      // congelados por esta edición al crearse — nunca reescritos después
      // (mismo criterio que formatBindingId/scheduleProfileId/rulesetBundleId).
      this.pathwayBindingIds = Array.isArray(data.pathwayBindingIds) ? [...data.pathwayBindingIds] : [];
      // WORLD-SIM-1 (DESIGN.md 10.16, BUG-WORLDSIM-01): "detailLevel" es
      // OBLIGATORIO y validado contra el vocabulario cerrado — ninguna
      // Edition productiva cae en 'playable' por omisión. Se congela aquí
      // y nunca se reescribe después de crearse (invariante 3).
      if (data.detailLevel === undefined || data.detailLevel === null) {
        throw new Error(`${label}: falta "detailLevel" explícito (playable|full|standard|abstract) — ningún nivel se infiere por defecto.`);
      }
      if (!WorldSimulationModule.DETAIL_LEVELS.includes(data.detailLevel)) {
        throw new Error(`${label}: "detailLevel" = "${data.detailLevel}" no válido — debe ser uno de ${WorldSimulationModule.DETAIL_LEVELS.join(', ')}.`);
      }
      this.detailLevel = data.detailLevel;
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
        pathwayBindingIds: [...this.pathwayBindingIds],
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
      // PATHWAYS-1 (DESIGN.md 10.15): `stageKey` EXPLÍCITO — el core nuevo
      // nunca deduce la semántica cortando strings de `stage.id`
      // (`_stageKeyFromId()` sigue viva en CompetitionEngine.js SOLO como
      // shim de compatibilidad para stages legacy sin este campo).
      this.stageKey = data.stageKey !== undefined ? data.stageKey : null;
      // WORLD-CLEANUP-1 (DESIGN.md 10.21) — copiados desde el
      // `CompetitionStageTemplate` de contenido al crear la Stage; nunca
      // decididos por la UI a partir de `stageKey` (ver `CLAUDE.md`).
      this.rulesPhaseId = data.rulesPhaseId !== undefined ? data.rulesPhaseId : null;
      this.presentationRole = data.presentationRole !== undefined ? data.presentationRole : null;
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
        stageKey: this.stageKey,
        rulesPhaseId: this.rulesPhaseId,
        presentationRole: this.presentationRole,
        entryIds: [...this.entryIds],
        sourceStageIds: [...this.sourceStageIds],
        nextStageIds: [...this.nextStageIds],
        hasRuntimeBinding: this.runtimeBinding !== null,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionEntry — fuente de verdad de participación (invariante 8:
  // nunca se deriva de nacionalidad ni de una división legacy).
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
      // PATHWAYS-1 (DESIGN.md 10.15): referencia EXPLÍCITA al
      // `CompetitionPathwayReceipt`/`CompetitionSeasonTransitionReceipt` que
      // justificó esta clasificación — `qualificationSource` se conserva
      // solo por compatibilidad con consumidores anteriores a esta entrega.
      this.qualificationReceiptId = data.qualificationReceiptId !== undefined ? data.qualificationReceiptId : null;
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
        qualificationReceiptId: this.qualificationReceiptId,
        validFrom: this.validFrom,
        validTo: this.validTo,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionFormatDefinition / CompetitionStageTemplate — COMP-CORE-1
  // (DESIGN.md 10.13). El formato es la definición VERSIONADA, SERIALIZABLE
  // de "qué fases tiene una competición y con qué algoritmo se ejecuta cada
  // una" — puro dato de contenido, nunca funciones/instancias Team/Map ni
  // objetos de `CompetitionRules` incrustados (sección 7 del prompt). Los
  // resolvers vivos (runners, MatchEngine, Calendar) se inyectan en
  // `CompetitionEngine`; el formato solo guarda ids/config planos.
  //
  // Cada `stageTemplate` declara:
  //  - `activation`: cuándo se activa la fase —
  //      { type: 'edition-start' }
  //      { type: 'stage-completed', sourceStageKey }
  //      { type: 'round-completed', sourceStageKey, round }
  //    Los tres tipos son GENÉRICOS (nunca "cuando la liga llegue a una
  //    jornada concreta de una competición fija") — el contenido declara
  //    sourceStageKey/round, el core solo evalúa el tipo.
  //  - `entrySource`: de dónde salen los participantes de la fase —
  //      { type: 'initial-participants' } (aportados por quien inicializa
  //        la edición, ver `CompetitionEngine.registerEditionWithInitialEntries`)
  //      { type: 'stage-standings-range', sourceStageKey, fromRank, toRank,
  //        sourceScope: 'same-edition'|'external',
  //        externalCompetitionDefinitionId? } (top-N / rango de la
  //        clasificación de OTRA fase, de la MISMA edición o de una
  //        edición EXTERNA de otra competición — ej. la foto de Copa)
  //      { type: 'stage-bracket-final-round-winners', sourceStageKey,
  //        reseedStrategy: 'best-vs-worst-by-seed' } (ganadores de la
  //        última ronda de un bracket previo, reseedeados — ej. Final Four)
  //  - `runnerConfig`: configuración VALIDADA por el runner correspondiente
  //    (round-robin o bracket) — nunca un literal de país/competición.
  // ---------------------------------------------------------------------
  const FORMAT_STATUSES = ['active', 'provisional', 'deprecated', 'fictional-test'];
  const RUNNER_TYPES = ['round-robin', 'bracket'];
  // PATHWAYS-1 (DESIGN.md 10.15, BUG-PATHWAYS-01): 'pathway-managed' marca
  // una fase cuya ACTIVACIÓN/clasificación real decide una
  // `CompetitionPathwayDefinition` — el formato solo declara que la fase
  // EXISTE (stageType/runnerConfig), nunca quién la alcanza ni cuándo. El
  // engine nunca autoactiva una fase con esta marca por su cascada interna
  // (`activation.type`/`entrySource.type` no coinciden nunca con un hecho
  // 'round-completed'/'stage-completed' real) — solo
  // `CompetitionEngine.activateStageFromQualifiers()`, invocado por
  // `CompetitionPathwayService`, la construye.
  const ACTIVATION_TYPES = ['edition-start', 'stage-completed', 'round-completed', 'pathway-managed'];
  const ENTRY_SOURCE_TYPES = [
    'initial-participants',
    'stage-standings-range',
    'stage-bracket-final-round-winners',
    'pathway-managed',
  ];
  const ENTRY_SOURCE_SCOPES = ['same-edition', 'external'];

  function validateActivation(ownerLabel, activation) {
    if (!activation || typeof activation !== 'object') {
      throw new Error(`${ownerLabel}: falta "activation" explícita.`);
    }
    requireOneOf(ownerLabel, 'activation.type', activation.type, ACTIVATION_TYPES);
    if (activation.type === 'stage-completed' && !activation.sourceStageKey) {
      throw new Error(`${ownerLabel}: activation "stage-completed" exige "sourceStageKey".`);
    }
    if (activation.type === 'round-completed') {
      if (!activation.sourceStageKey) throw new Error(`${ownerLabel}: activation "round-completed" exige "sourceStageKey".`);
      if (!Number.isInteger(activation.round) || activation.round <= 0) {
        throw new Error(`${ownerLabel}: activation "round-completed" exige "round" entero positivo.`);
      }
    }
    return {
      type: activation.type,
      sourceStageKey: activation.sourceStageKey || null,
      round: activation.round !== undefined ? activation.round : null,
    };
  }

  function validateEntrySource(ownerLabel, entrySource) {
    if (!entrySource || typeof entrySource !== 'object') {
      throw new Error(`${ownerLabel}: falta "entrySource" explícita.`);
    }
    requireOneOf(ownerLabel, 'entrySource.type', entrySource.type, ENTRY_SOURCE_TYPES);
    const result = { type: entrySource.type };
    if (entrySource.type === 'stage-standings-range') {
      if (!entrySource.sourceStageKey) throw new Error(`${ownerLabel}: entrySource "stage-standings-range" exige "sourceStageKey".`);
      if (!Number.isInteger(entrySource.fromRank) || !Number.isInteger(entrySource.toRank)) {
        throw new Error(`${ownerLabel}: entrySource "stage-standings-range" exige "fromRank"/"toRank" enteros.`);
      }
      result.sourceStageKey = entrySource.sourceStageKey;
      result.fromRank = entrySource.fromRank;
      result.toRank = entrySource.toRank;
      result.sourceScope = requireOneOf(ownerLabel, 'entrySource.sourceScope', entrySource.sourceScope || 'same-edition', ENTRY_SOURCE_SCOPES);
      if (result.sourceScope === 'external') {
        if (!entrySource.externalCompetitionDefinitionId) {
          throw new Error(`${ownerLabel}: entrySource externo exige "externalCompetitionDefinitionId".`);
        }
        result.externalCompetitionDefinitionId = entrySource.externalCompetitionDefinitionId;
      }
    } else if (entrySource.type === 'stage-bracket-final-round-winners') {
      if (!entrySource.sourceStageKey) throw new Error(`${ownerLabel}: entrySource "stage-bracket-final-round-winners" exige "sourceStageKey".`);
      result.sourceStageKey = entrySource.sourceStageKey;
      result.reseedStrategy = entrySource.reseedStrategy || 'best-vs-worst-by-seed';
    }
    return result;
  }

  class CompetitionStageTemplate {
    constructor(data = {}) {
      const label = `CompetitionStageTemplate "${data.key || '?'}"`;
      this.key = requireField(label, data, 'key');
      this.name = data.name || this.key;
      this.stageType = requireOneOf(label, 'stageType', data.stageType, STAGE_TYPES);
      this.runnerType = requireOneOf(label, 'runnerType', data.runnerType, RUNNER_TYPES);
      this.sequence = data.sequence !== undefined ? data.sequence : 0;
      this.activation = validateActivation(label, data.activation);
      this.entrySource = validateEntrySource(label, data.entrySource);
      // Config VALIDADA por el runner correspondiente (RoundRobinStageRunner/
      // BracketStageRunner) — dato plano, nunca funciones/instancias vivas.
      this.runnerConfig = JSON.parse(JSON.stringify(data.runnerConfig || {}));
      this.completesEdition = Boolean(data.completesEdition);
      // WORLD-CLEANUP-1 (DESIGN.md 10.21, sección 9.1 del prompt) —
      // metadatos DECLARADOS por el contenido, copiados a la `CompetitionStage`
      // real al crearse. `rulesPhaseId`: string opaco que un ruleset puede
      // usar para distinguir fase (p.ej. una regla de convocatoria); NUNCA un
      // enum mundial cerrado de "liga/copa/playoff/promoción" — el contenido
      // puede acuñar la fase que quiera. `presentationRole` es opcional, solo
      // para agrupar/presentar cuando existe un consumidor real (p.ej. la
      // pantalla española).
      this.rulesPhaseId = data.rulesPhaseId !== undefined ? data.rulesPhaseId : null;
      this.presentationRole = data.presentationRole !== undefined ? data.presentationRole : null;
      Object.freeze(this.runnerConfig);
      Object.freeze(this.activation);
      Object.freeze(this.entrySource);
      Object.freeze(this);
    }

    toJSON() {
      return {
        key: this.key,
        name: this.name,
        stageType: this.stageType,
        runnerType: this.runnerType,
        sequence: this.sequence,
        activation: { ...this.activation },
        entrySource: { ...this.entrySource },
        runnerConfig: JSON.parse(JSON.stringify(this.runnerConfig)),
        completesEdition: this.completesEdition,
        rulesPhaseId: this.rulesPhaseId,
        presentationRole: this.presentationRole,
      };
    }
  }

  class CompetitionFormatDefinition {
    constructor(data = {}) {
      const label = `CompetitionFormatDefinition "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.version = requireField(label, data, 'version');
      this.status = requireOneOf(label, 'status', data.status || 'active', FORMAT_STATUSES);
      this.participantType = requireOneOf(label, 'participantType', data.participantType, PARTICIPANT_TYPES);
      const templates = Array.isArray(data.stageTemplates) ? data.stageTemplates : [];
      if (!templates.length) throw new Error(`${label}: "stageTemplates" no puede estar vacío.`);
      this.stageTemplates = templates
        .map((t) => (t instanceof CompetitionStageTemplate ? t : new CompetitionStageTemplate(t)))
        .sort((a, b) => a.sequence - b.sequence);
      const keys = new Set();
      this.stageTemplates.forEach((t) => {
        if (keys.has(t.key)) throw new Error(`${label}: "key" de stageTemplate duplicada "${t.key}".`);
        keys.add(t.key);
      });
      // Política de finalización de la edición — puro dato: por defecto,
      // la edición se completa cuando TODAS las fases marcadas
      // `completesEdition` están completadas.
      this.editionCompletionPolicy = data.editionCompletionPolicy
        ? { ...data.editionCompletionPolicy }
        : { type: 'all-completes-edition-stages-completed' };
      this.provenance = data.provenance || null;
      Object.freeze(this.stageTemplates);
      Object.freeze(this.editionCompletionPolicy);
      Object.freeze(this);
    }

    getStageTemplate(key) {
      const found = this.stageTemplates.find((t) => t.key === key);
      if (!found) throw new Error(`CompetitionFormatDefinition "${this.id}": no existe stageTemplate "${key}".`);
      return found;
    }

    stageTemplatesWithActivation(type) {
      return this.stageTemplates.filter((t) => t.activation.type === type);
    }

    toJSON() {
      return {
        id: this.id,
        version: this.version,
        status: this.status,
        participantType: this.participantType,
        stageTemplates: this.stageTemplates.map((t) => t.toJSON()),
        editionCompletionPolicy: { ...this.editionCompletionPolicy },
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = {
    CompetitionDefinition,
    CompetitionEdition,
    CompetitionStage,
    CompetitionEntry,
    CompetitionFormatDefinition,
    CompetitionStageTemplate,
    SCOPE_LEVELS,
    PARTICIPANT_TYPES,
    COMPETITION_KINDS,
    IMPLEMENTATION_STATUSES,
    EDITION_STATUSES,
    STAGE_TYPES,
    STAGE_STATUSES,
    ENTRY_STATUSES,
    FORMAT_STATUSES,
    RUNNER_TYPES,
    ACTIVATION_TYPES,
    ENTRY_SOURCE_TYPES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
