// src/core/CompetitionEngine.js
// COMP-CORE-1 (DESIGN.md 10.13) — fachada/orquestador GENÉRICO que ejecuta
// competiciones reales sobre `CompetitionEdition -> CompetitionStage ->
// CompetitionEntry` (WORLD-CORE-1) usando los runners de
// `CompetitionRunners.js` y el catálogo de `CompetitionFormatCatalog.js`.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Instancia EXPLÍCITA por carrera (nunca singleton, nunca lee `state`/DOM/
// variables globales — sección 8 del prompt). El motor NUNCA:
//  - busca por nombre visible ni decide por país/división/competición
//    concreta (todo lo hace por `competitionDefinitionId`/`stageKey` que
//    aporta el contenido);
//  - lee `state.calendar` por dentro — toda fecha llega de un
//    `dateResolverProvider` inyectado UNA vez al construir el engine;
//  - llama a `Date.now()`/`Math.random()`;
//  - muta roster/contrato/licencia/Club;
//  - recalcula una clasificación para fabricar otro resultado independiente
//    (consultar nunca simula).
//
// Ningún literal de país/competición aparece en este archivo — auditado en
// `scripts/test-comp-core1.js`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const CompetitionEntitiesModule = dep('../entities/Competition.js');
  const CompetitionFormatCatalogModule = dep('./CompetitionFormatCatalog.js');
  const CompetitionRunnersModule = dep('./CompetitionRunners.js');
  const CompetitionRuntimeRegistryModule = dep('./CompetitionRuntimeRegistry.js');

  function Entities() { return CompetitionEntitiesModule; }
  function FormatCatalog() { return CompetitionFormatCatalogModule; }
  function Runners() { return CompetitionRunnersModule; }

  // ---------------------------------------------------------------------
  // Esquema de ids GENÉRICO y ESTABLE (nunca depende de nombre visible ni
  // orden de inserción) — reutilizado por cualquier competición/edición,
  // no solo por el contenido español. `editionId`/`stageId`/`entryId` son
  // deterministas a partir de competitionDefinitionId+seasonKey(+stageKey)
  // (+participantId), así que el mismo emparejamiento nunca colisiona entre
  // temporadas (BUG-COMPCORE-03).
  // ---------------------------------------------------------------------
  function buildEditionId(competitionDefinitionId, seasonKey) {
    return `edition:${competitionDefinitionId}:${seasonKey}`;
  }
  function buildStageId(competitionDefinitionId, seasonKey, stageKey) {
    return `stage:${competitionDefinitionId}:${seasonKey}:${stageKey}`;
  }
  function buildEntryId(competitionDefinitionId, seasonKey, stageKey, participantId) {
    return `entry:${competitionDefinitionId}:${seasonKey}:${stageKey}:${participantId}`;
  }

  // Nombres GENÉRICOS de patrón de campo (ver CompetitionRunners.js) — el
  // contenido declara el patrón por NOMBRE (dato plano, serializable); el
  // engine lo resuelve al array real que exige `BracketStageRunner`.
  const VENUE_PATTERN_NAMES = {
    'single-game': () => Runners().VENUE_PATTERNS.SINGLE_GAME,
    'best-of-3-1-1-1': () => Runners().VENUE_PATTERNS.BEST_OF_3_1_1_1,
    'best-of-5-2-2-1': () => Runners().VENUE_PATTERNS.BEST_OF_5_2_2_1,
  };

  function resolveVenuePattern(name) {
    const resolver = VENUE_PATTERN_NAMES[name];
    if (!resolver) throw new Error(`CompetitionEngine: patrón de campo desconocido "${name}".`);
    return resolver();
  }

  // ---------------------------------------------------------------------
  // Registro de entidades DECLARATIVAS (Edition + stage(s) de
  // 'edition-start' + Entries iniciales) — función ESTÁTICA y genérica:
  // la usa CUALQUIER paquete de contenido (español o no) al instalar una
  // edición nueva, ANTES de que exista ninguna instancia de
  // `CompetitionEngine` (sección 13.1 del prompt, pasos 2-3 preceden al 4).
  // No construye ningún runner todavía — eso lo hace `initializeEdition()`
  // una vez el engine existe.
  // ---------------------------------------------------------------------
  function registerEditionWithInitialEntries(world, {
    competitionDefinitionId, seasonKey, startDate, formatBindingId, participants, scheduleProfileId, rulesetBundleId,
  }) {
    const format = FormatCatalog().requireFormat(formatBindingId);
    const definition = world.registries.competitionDefinitions.require(competitionDefinitionId);
    const edition = new (Entities().CompetitionEdition)({
      id: buildEditionId(competitionDefinitionId, seasonKey),
      competitionDefinitionId,
      seasonKey,
      startDate: startDate || null,
      status: 'active',
      formatBindingId,
      scheduleProfileId: scheduleProfileId || definition.bindings.scheduleProfileId || null,
      rulesetBundleId: rulesetBundleId || definition.bindings.rulesetBundleId || null,
    });
    world.registries.registerCompetitionEdition(edition);

    const editionStartTemplates = format.stageTemplatesWithActivation('edition-start');
    if (!editionStartTemplates.length) {
      throw new Error(`CompetitionEngine: el formato "${formatBindingId}" no declara ninguna fase "edition-start".`);
    }
    const stages = editionStartTemplates.map((template) => {
      if (template.entrySource.type !== 'initial-participants') {
        throw new Error(
          `CompetitionEngine: la fase "${template.key}" ("edition-start") debe declarar entrySource `
          + '"initial-participants".',
        );
      }
      const stage = new (Entities().CompetitionStage)({
        id: buildStageId(competitionDefinitionId, seasonKey, template.key),
        editionId: edition.id,
        name: template.name,
        sequence: template.sequence,
        stageType: template.stageType,
        status: 'active',
      });
      world.registries.registerCompetitionStage(stage);
      (participants || []).forEach((participant, index) => {
        const entry = new (Entities().CompetitionEntry)({
          id: buildEntryId(competitionDefinitionId, seasonKey, template.key, participant.id),
          editionId: edition.id,
          stageId: stage.id,
          participantType: definition.participantType,
          participantId: participant.id,
          entryStatus: 'active',
          seed: participant.seed !== undefined ? participant.seed : (index + 1),
          validFrom: startDate || null,
        });
        world.registries.registerCompetitionEntry(entry);
      });
      return stage;
    });

    return { edition, stages };
  }

  // Marca 'completed' cualquier edición/stage previamente ACTIVOS de esta
  // competición — mismo comportamiento que el histórico
  // `SpainLegacyCompetitionRuntime.completePreviousEditions`, generalizado:
  // se llama antes de abrir la edición de una temporada nueva. Nunca borra
  // nada (los estados anteriores quedan localizables, sección 13.3).
  function completePreviousEditions(world, competitionDefinitionId) {
    world.registries.competitionEditions.forDefinition(competitionDefinitionId).forEach((edition) => {
      if (edition.status === 'active') edition.setStatus('completed');
      world.registries.competitionStages.forEdition(edition.id).forEach((stage) => {
        if (stage.status === 'active') stage.setStatus('completed');
      });
    });
  }

  class CompetitionEngine {
    // `world`: `GameWorld` de la carrera. `participantResolver` (opcional):
    // `(participantId) => instancia real` — por defecto resuelve equipos
    // reales desde `world.registries.teams` (el único `participantType` que
    // esta entrega ejecuta de verdad, `club-team`); un paquete futuro de
    // selecciones inyectaría su propio resolver, nunca una rama nueva aquí.
    constructor({ world, participantResolver } = {}) {
      if (!world) throw new Error('CompetitionEngine: falta "world" explícito.');
      this.world = world;
      this.runtimeRegistry = new (CompetitionRuntimeRegistryModule.CompetitionRuntimeRegistry)();
      this._participantResolver = participantResolver || ((id) => world.registries.teams.require(id));
      // Proveedor de fechas — INYECTADO una vez (nunca `state.calendar`
      // leído por dentro): `(activationContext) => dateResolver` con la
      // firma que exige el runnerType de la fase que se está activando.
      // Por defecto no asigna fecha (comportamiento histórico sin
      // Calendar: `date: null`) — game.js inyecta el proveedor real.
      this._dateResolverProvider = () => null;
      this._crossEditionRules = [];
      this._activationEvents = [];
    }

    setDateResolverProvider(fn) { this._dateResolverProvider = typeof fn === 'function' ? fn : () => null; }

    // Ver `registerEditionWithInitialEntries` arriba — expuesto también
    // como método de instancia por conveniencia (misma firma, mismo mundo).
    registerEditionWithInitialEntries(options) {
      return registerEditionWithInitialEntries(this.world, options);
    }

    completePreviousEditions(competitionDefinitionId) {
      completePreviousEditions(this.world, competitionDefinitionId);
    }

    // ---------------------------------------------------------------------
    // Activaciones cruzadas de EDICIÓN (ej. Copa: nueva Definition/Edition
    // disparada por un checkpoint de OTRA edición) — declaradas por
    // CONTENIDO como datos (nunca funciones), procesadas aquí de forma
    // GENÉRICA (el engine solo compara `triggerType`/`triggerStageId`/
    // `triggerRound`, nunca "si es ACB").
    //
    // `rule`: {
    //   id,                          // único, estable para esta temporada
    //   triggerStageId,               // stage YA registrado que dispara la regla
    //   triggerType: 'round-completed'|'stage-completed',
    //   triggerRound: number|null,    // solo si triggerType es 'round-completed'
    //   action: {
    //     competitionDefinitionId, seasonKey, formatBindingId, startDate,
    //     entrySource: { ...mismo shape que CompetitionStageTemplate.entrySource,
    //                    con sourceScope 'external' resuelto contra
    //                    triggerStageId },
    //   },
    // }
    // ---------------------------------------------------------------------
    registerCrossEditionActivation(rule) {
      if (!rule || !rule.id || !rule.triggerStageId || !rule.action) {
        throw new Error('CompetitionEngine.registerCrossEditionActivation: regla incompleta.');
      }
      this._crossEditionRules.push(rule);
    }

    // Inicializa (o reanuda) el runtime de una Edition YA registrada (con
    // sus Entries de 'edition-start' ya presentes) — sección 8.1: "inicializar
    // una edición desde su formato y Entries ya registrados". Construye un
    // runner por cada Stage 'active' de la edición cuyo runnerType conozca.
    initializeEdition(editionId) {
      const edition = this.world.registries.competitionEditions.require(editionId);
      if (!edition.formatBindingId) {
        throw new Error(`CompetitionEngine.initializeEdition: la edición "${editionId}" no tiene "formatBindingId" congelado.`);
      }
      const format = FormatCatalog().requireFormat(edition.formatBindingId);
      this.runtimeRegistry.registerEditionFormat(edition.id, format.id);
      this.world.registries.competitionStages.forEdition(edition.id)
        .filter((stage) => stage.status === 'active' && !this.runtimeRegistry.hasRunner(stage.id))
        .forEach((stage) => {
          const template = format.getStageTemplate(this._stageKeyFromId(stage.id, edition));
          this._buildRunnerForStage(edition, format, template, stage);
        });
      return edition;
    }

    // El id de stage es determinista (`stage:{cid}:{season}:{key}`) — se
    // deriva la key sin necesitar guardarla aparte en la entidad Stage.
    _stageKeyFromId(stageId, edition) {
      const prefix = `stage:${edition.competitionDefinitionId}:${edition.seasonKey}:`;
      if (!stageId.startsWith(prefix)) throw new Error(`CompetitionEngine: stageId "${stageId}" no sigue el esquema esperado.`);
      return stageId.slice(prefix.length);
    }

    _entriesByParticipantIdForStage(stage) {
      const map = new Map();
      this.world.registries.competitionEntries.forStage(stage.id).forEach((entry) => map.set(entry.participantId, entry.id));
      return map;
    }

    _buildRunnerForStage(edition, format, template, stage) {
      const entries = this.world.registries.competitionEntries.forStage(stage.id);
      const entriesByParticipantId = this._entriesByParticipantIdForStage(stage);
      const commonHooks = {
        onRoundCompleted: (round) => this._handleStageEvent(edition, stage, 'round-completed', round),
        onStageCompleted: () => {
          if (stage.status !== 'completed') stage.setStatus('completed');
          this._handleStageEvent(edition, stage, 'stage-completed', null);
          this._maybeCompleteEdition(edition, format);
        },
      };
      if (template.runnerType === 'round-robin') {
        const dateResolver = this._dateResolverProvider({
          template, edition, stage, triggerType: 'edition-start', triggerRound: null,
        }) || null;
        const runner = new (Runners().RoundRobinStageRunner)({
          stageId: stage.id,
          competitionDefinitionId: edition.competitionDefinitionId,
          competitionEditionId: edition.id,
          stageKey: template.key,
          participants: entries.map((e) => ({ id: e.participantId })),
          entriesByParticipantId,
          legs: template.runnerConfig.legs,
          pointsWin: template.runnerConfig.pointsWin,
          pointsLoss: template.runnerConfig.pointsLoss,
          tiebreakSteps: template.runnerConfig.tiebreakSteps,
          requireExactParticipantCount: template.runnerConfig.requireExactParticipantCount || null,
          dateResolver,
          resolveParticipant: this._participantResolver,
          onRoundCompleted: commonHooks.onRoundCompleted,
          onStageCompleted: commonHooks.onStageCompleted,
        });
        this.runtimeRegistry.registerRunner(stage.id, runner);
        return runner;
      }
      if (template.runnerType === 'bracket') {
        const { entries: bracketEntries, derivedFirstRoundPairing } = this._resolveBracketEntries(edition, template, entries, entriesByParticipantId);
        const firstRoundPairing = derivedFirstRoundPairing || template.runnerConfig.firstRoundPairing;
        const roundPatterns = template.runnerConfig.roundPatterns.map(resolveVenuePattern);
        const dateResolver = this._dateResolverProvider({
          template, edition, stage, triggerType: template.activation.type, triggerRound: template.activation.round,
        }) || null;
        const runner = new (Runners().BracketStageRunner)({
          stageId: stage.id,
          competitionDefinitionId: edition.competitionDefinitionId,
          competitionEditionId: edition.id,
          stageKey: template.key,
          entries: bracketEntries,
          firstRoundPairing,
          roundPatterns,
          dateResolver,
          resolveParticipant: this._participantResolver,
          onSeriesDecided: null,
          onRoundAdvanced: null,
          onStageCompleted: commonHooks.onStageCompleted,
        });
        this.runtimeRegistry.registerRunner(stage.id, runner);
        return runner;
      }
      throw new Error(`CompetitionEngine: runnerType desconocido "${template.runnerType}".`);
    }

    // Entradas de un stage de tipo bracket, en el shape que exige
    // `BracketStageRunner` ({participantId, seed, entryId}) — si el
    // entrySource de la plantilla es un reseed de la fase anterior, calcula
    // TAMBIÉN el emparejamiento derivado (nunca declarado por contenido,
    // porque depende de quién sobrevivió).
    _resolveBracketEntries(edition, template, alreadyRegisteredEntries, entriesByParticipantId) {
      if (template.entrySource.type === 'stage-bracket-final-round-winners') {
        const sourceStage = this.world.registries.competitionStages.require(
          buildStageId(edition.competitionDefinitionId, edition.seasonKey, template.entrySource.sourceStageKey),
        );
        const sourceRunner = this.runtimeRegistry.requireRunner(sourceStage.id);
        const finalRound = sourceRunner.rounds[sourceRunner.rounds.length - 1];
        const winners = finalRound.map((series) => (series.wins.better > series.wins.worse ? series.better : series.worse));
        const bySeedAscending = [...winners].sort((a, b) => a.seed - b.seed);
        const pairing = [];
        for (let i = 0; i < Math.floor(bySeedAscending.length / 2); i++) {
          pairing.push([bySeedAscending[i].seed, bySeedAscending[bySeedAscending.length - 1 - i].seed]);
        }
        const entries = bySeedAscending.map((w) => ({
          participantId: w.participantId, seed: w.seed, entryId: entriesByParticipantId.get(w.participantId) || null,
        }));
        return { entries, derivedFirstRoundPairing: pairing };
      }
      // 'stage-standings-range' (misma edición o externa) ya dejó las
      // Entries REGISTRADAS con su seed real (ver `_activateStageFromTemplate`)
      // — se leen tal cual, nunca se recalculan aquí.
      const entries = alreadyRegisteredEntries.map((e) => ({
        participantId: e.participantId, seed: e.seed, entryId: e.id,
      }));
      return { entries, derivedFirstRoundPairing: null };
    }

    // Procesa un hecho GENÉRICO (`round-completed`/`stage-completed`) de
    // `stage`: activa como mucho UNA vez cada fase declarada (misma edición
    // o edición externa) cuya activación coincida. El core solo compara
    // tipos/ids — nunca decide "porque es ACB" (invariante 11).
    _handleStageEvent(edition, stage, eventType, round) {
      const stageKey = this._stageKeyFromId(stage.id, edition);
      const format = FormatCatalog().requireFormat(edition.formatBindingId);

      // (a) Cascada DENTRO de la misma edición — siguiente stageTemplate
      // cuya activación referencia esta fase.
      format.stageTemplates
        .filter((template) => template.activation.type === eventType && template.activation.sourceStageKey === stageKey)
        .filter((template) => eventType !== 'round-completed' || template.activation.round === round)
        .forEach((template) => {
          const activationKey = `stage-activation:${edition.id}:${template.key}`;
          if (!this.runtimeRegistry.markActivationFired(activationKey)) return; // invariante 16
          this._activateStageFromTemplate(edition, format, template);
        });

      // (b) Cascada CRUZADA de edición (ej. Copa) — reglas declaradas por
      // contenido, evaluadas genéricamente.
      this._crossEditionRules
        .filter((rule) => rule.triggerStageId === stage.id && rule.triggerType === eventType)
        .filter((rule) => eventType !== 'round-completed' || rule.triggerRound === round)
        .forEach((rule) => {
          if (!this.runtimeRegistry.markActivationFired(`cross-edition:${rule.id}`)) return;
          this._fireCrossEditionRule(rule, stage);
        });
    }

    _activateStageFromTemplate(edition, format, template) {
      const stage = new (Entities().CompetitionStage)({
        id: buildStageId(edition.competitionDefinitionId, edition.seasonKey, template.key),
        editionId: edition.id,
        name: template.name,
        sequence: template.sequence,
        stageType: template.stageType,
        status: 'active',
        sourceStageIds: template.activation.sourceStageKey
          ? [buildStageId(edition.competitionDefinitionId, edition.seasonKey, template.activation.sourceStageKey)]
          : [],
      });
      this.world.registries.registerCompetitionStage(stage);

      const entries = this._computeEntrySourceEntries(edition, template.entrySource);
      const definition = this.world.registries.competitionDefinitions.require(edition.competitionDefinitionId);
      entries.forEach((entry) => {
        this.world.registries.registerCompetitionEntry(new (Entities().CompetitionEntry)({
          id: buildEntryId(edition.competitionDefinitionId, edition.seasonKey, template.key, entry.participantId),
          editionId: edition.id,
          stageId: stage.id,
          participantType: definition.participantType,
          participantId: entry.participantId,
          entryStatus: 'qualified',
          seed: entry.seed,
          qualificationSource: template.entrySource.type,
        }));
      });

      this._buildRunnerForStage(edition, format, template, stage);
      this._activationEvents.push({ type: 'stage-activated', editionId: edition.id, stageId: stage.id, stageKey: template.key });
      return stage;
    }

    // Resuelve `entrySource` de tipo 'stage-standings-range' (misma edición
    // o externa) — 'stage-bracket-final-round-winners' se resuelve en
    // `_resolveBracketEntries` (necesita construirse en el mismo paso que el
    // pairing derivado).
    _computeEntrySourceEntries(edition, entrySource) {
      if (entrySource.type === 'stage-bracket-final-round-winners') {
        // Ya resuelto por `_buildRunnerForStage` -> `_resolveBracketEntries`;
        // aquí solo hace falta la LISTA de participantes para registrar
        // Entry (sin instanciar el runner todavía en ese punto) — se
        // recalcula de forma barata a partir del stage/runner fuente.
        const sourceStage = this.world.registries.competitionStages.require(
          buildStageId(edition.competitionDefinitionId, edition.seasonKey, entrySource.sourceStageKey),
        );
        const sourceRunner = this.runtimeRegistry.requireRunner(sourceStage.id);
        const finalRound = sourceRunner.rounds[sourceRunner.rounds.length - 1];
        return finalRound.map((series) => {
          const winner = series.wins.better > series.wins.worse ? series.better : series.worse;
          return { participantId: winner.participantId, seed: winner.seed };
        });
      }
      if (entrySource.type === 'stage-standings-range') {
        const targetCompetitionDefinitionId = entrySource.sourceScope === 'external'
          ? entrySource.externalCompetitionDefinitionId
          : edition.competitionDefinitionId;
        const sourceStageId = buildStageId(targetCompetitionDefinitionId, edition.seasonKey, entrySource.sourceStageKey);
        const sourceStage = this.world.registries.competitionStages.require(sourceStageId);
        const sourceRunner = this.runtimeRegistry.requireRunner(sourceStage.id);
        const standings = sourceRunner.getStandings();
        const slice = standings.slice(entrySource.fromRank - 1, entrySource.toRank);
        return slice.map((standing, index) => ({
          participantId: standing.participantId, seed: entrySource.fromRank + index,
        }));
      }
      throw new Error(`CompetitionEngine: entrySource "${entrySource.type}" no resoluble fuera de una fase 'edition-start'.`);
    }

    // Dispara una regla de activación CRUZADA (Copa): crea la edición nueva
    // (con su(s) stage(s) 'edition-start') usando las Entries calculadas
    // desde el entrySource de la regla, e inicializa su runtime de
    // inmediato — invariante 12 (Copa es Definition/Edition separada).
    _fireCrossEditionRule(rule, triggerStage) {
      const { action } = rule;
      // `CompetitionStage` no guarda `competitionDefinitionId` directo — se
      // deriva de su propia Edition (la del disparador, ej. la Liga cuyo
      // checkpoint activa la Copa).
      const triggerEdition = this.world.registries.competitionEditions.require(triggerStage.editionId);
      const entries = this._computeEntrySourceEntries(
        { competitionDefinitionId: action.competitionDefinitionId, seasonKey: action.seasonKey },
        {
          ...action.entrySource,
          sourceScope: 'external',
          externalCompetitionDefinitionId: triggerEdition.competitionDefinitionId,
        },
      );
      const { edition } = registerEditionWithInitialEntries(this.world, {
        competitionDefinitionId: action.competitionDefinitionId,
        seasonKey: action.seasonKey,
        startDate: action.startDate || null,
        formatBindingId: action.formatBindingId,
        participants: entries.map((e) => ({ id: e.participantId, seed: e.seed })),
      });
      this.initializeEdition(edition.id);
      this._activationEvents.push({ type: 'edition-activated', editionId: edition.id, competitionDefinitionId: action.competitionDefinitionId });
    }

    _maybeCompleteEdition(edition, format) {
      const policy = format.editionCompletionPolicy;
      if (policy.type !== 'all-completes-edition-stages-completed') return;
      const requiredKeys = format.stageTemplates.filter((t) => t.completesEdition).map((t) => t.key);
      if (!requiredKeys.length) return;
      const stages = this.world.registries.competitionStages.forEdition(edition.id);
      const allDone = requiredKeys.every((key) => {
        const stageId = buildStageId(edition.competitionDefinitionId, edition.seasonKey, key);
        const stage = stages.find((s) => s.id === stageId);
        return stage && stage.status === 'completed';
      });
      if (allDone && edition.status !== 'completed') {
        edition.setStatus('completed');
        this._activationEvents.push({ type: 'edition-completed', editionId: edition.id });
      }
    }

    // Drena (y limpia) la cola de hechos de activación producidos por la
    // última tanda de resoluciones — game.js la consulta DESPUÉS de cada
    // resolución real para saber qué construir/anunciar (vista legacy,
    // noticias) — nunca antes del commit real (sección 13.2).
    drainActivationEvents() {
      const events = this._activationEvents;
      this._activationEvents = [];
      return events;
    }

    // ---------------------------------------------------------------------
    // Consultas/operaciones de un stage concreto — delegan en su runner.
    // ---------------------------------------------------------------------
    getRunner(stageId) { return this.runtimeRegistry.getRunner(stageId); }

    getActiveEdition(competitionDefinitionId) {
      return this.world.registries.competitionEditions.forDefinition(competitionDefinitionId)
        .find((e) => e.status === 'active') || null;
    }

    getActiveStage(editionId) {
      return this.world.registries.competitionStages.forEdition(editionId)
        .find((s) => s.status === 'active') || null;
    }

    listPendingMatches(stageId) {
      const runner = this.runtimeRegistry.requireRunner(stageId);
      if (typeof runner.getCurrentRoundMatches === 'function') {
        return runner.getCurrentRoundMatches().filter((m) => m.status === 'pending');
      }
      return runner.getPendingMatches();
    }

    peekNextPendingMatch(stageId) {
      const runner = this.runtimeRegistry.requireRunner(stageId);
      if (typeof runner.peekNextPendingMatch === 'function') {
        const pending = runner.peekNextPendingMatch();
        return pending ? pending.descriptor : null;
      }
      const pending = this.listPendingMatches(stageId);
      return pending.length ? pending[0] : null;
    }

    resolveMatch(stageId, matchId, options) {
      const runner = this.runtimeRegistry.requireRunner(stageId);
      return runner.resolveMatch(matchId, options);
    }

    getStandings(stageId) { return this.runtimeRegistry.requireRunner(stageId).getStandings(); }

    validateIntegrity() { return this.world.registries.validateIntegrity(); }

    snapshot() { return this.runtimeRegistry.snapshot(); }
  }

  const exportsObj = {
    CompetitionEngine,
    registerEditionWithInitialEntries,
    completePreviousEditions,
    buildEditionId,
    buildStageId,
    buildEntryId,
    resolveVenuePattern,
    VENUE_PATTERN_NAMES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
