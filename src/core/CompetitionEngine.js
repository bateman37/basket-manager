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
//  - llama a un reloj de sistema (fecha "ahora") ni a un generador de
//    aleatoriedad propio;
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
    // PATHWAYS-1 (DESIGN.md 10.15): ids congelados por la Edition + receipt
    // de clasificación opcional (Copa/temporada siguiente activadas por un
    // pathway) — `null` para el arranque de carrera (participantes
    // aportados al bootstrap, sin ninguna decisión de clasificación previa).
    pathwayBindingIds, qualificationReceiptId,
    // WORLD-SIM-1 (DESIGN.md 10.16): nivel de detalle OBLIGATORIO,
    // resuelto SIEMPRE por quien llama desde el perfil de simulación de la
    // carrera (`CompetitionSimulationService.resolveDetailLevelForCompetition()`)
    // — nunca deducido aquí ni heredado de otra Edition (invariante 2/3).
    detailLevel,
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
      pathwayBindingIds: pathwayBindingIds || [],
      detailLevel,
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
        stageKey: template.key,
        rulesPhaseId: template.rulesPhaseId,
        presentationRole: template.presentationRole,
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
          qualificationSource: qualificationReceiptId ? 'pathway' : null,
          qualificationReceiptId: qualificationReceiptId || null,
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
    // WORLD-SIM-1 (DESIGN.md 10.16): `simulationService` (opcional, nunca
    // requerido) es la única pieza que sabe producir un marcador
    // "standard"/resolver un hito "abstract" — sin él, el engine sigue
    // funcionando exactamente igual que antes de esta entrega para
    // Editions `playable`/`full` (todos los fixtures/scripts históricos que
    // no lo inyectan nunca construyen una Edition "standard"/"abstract").
    constructor({ world, participantResolver, simulationService } = {}) {
      if (!world) throw new Error('CompetitionEngine: falta "world" explícito.');
      this.world = world;
      this.runtimeRegistry = new (CompetitionRuntimeRegistryModule.CompetitionRuntimeRegistry)();
      this._participantResolver = participantResolver || ((id) => world.registries.teams.require(id));
      this._simulationService = simulationService || null;
      // Proveedor de fechas — INYECTADO una vez (nunca `state.calendar`
      // leído por dentro): `(activationContext) => dateResolver` con la
      // firma que exige el runnerType de la fase que se está activando.
      // Por defecto no asigna fecha (comportamiento histórico sin
      // Calendar: `date: null`) — game.js inyecta el proveedor real.
      this._dateResolverProvider = () => null;
      this._crossEditionRules = [];
      this._activationEvents = [];
      // PATHWAYS-1 (DESIGN.md 10.15, sección 9.2 del prompt): handler
      // GENÉRICO invocado con el hecho plano `{ type, editionId, stageId,
      // stageKey, round }` justo al cerrarse una ronda/fase — ANTES de la
      // cascada legacy de `activation`/`entrySource` (que sigue viva solo
      // para fixtures/tests históricos que aún declaran esos tipos). El
      // engine nunca decide aquí qué significa el hecho — delega siempre en
      // el handler inyectado (`CompetitionPathwayService`).
      this._factHandler = null;
    }

    setDateResolverProvider(fn) { this._dateResolverProvider = typeof fn === 'function' ? fn : () => null; }

    setFactHandler(fn) { this._factHandler = typeof fn === 'function' ? fn : null; }

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
    // `triggerRound`, nunca "si es esta competición concreta").
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
    //
    // SAVE-LOAD-1: `options.includeStatuses` (por defecto `['active']`, el
    // comportamiento de siempre) permite ampliar el filtro a `'completed'`
    // durante la HIDRATACIÓN de una carrera guardada — una fase ya
    // terminada (ej. Liga regular con un playoff posterior todavía activo)
    // sigue necesitando su runner vivo para poder reaplicar sus partidos
    // jugados y exponer su clasificación/histórico. En una carrera EN VIVO
    // esto nunca hace falta (el runner de una fase completada ya sigue
    // vivo en `runtimeRegistry` desde que se construyó la primera vez).
    initializeEdition(editionId, options = {}) {
      const includeStatuses = options.includeStatuses || ['active'];
      const edition = this.world.registries.competitionEditions.require(editionId);
      if (!edition.formatBindingId) {
        throw new Error(`CompetitionEngine.initializeEdition: la edición "${editionId}" no tiene "formatBindingId" congelado.`);
      }
      const format = FormatCatalog().requireFormat(edition.formatBindingId);
      this.runtimeRegistry.registerEditionFormat(edition.id, format.id);
      // WORLD-SIM-1 (DESIGN.md 10.16, sección 9 del prompt): cobertura
      // exigida por el nivel de detalle — solo si hay `simulationService`
      // inyectado (fixtures/tests históricos sin él se comportan como
      // siempre). Nunca completa en silencio ni cambia de nivel para
      // sortear una cobertura insuficiente.
      if (this._simulationService) {
        const participantIds = this.world.registries.competitionEntries.forEdition(edition.id)
          .map((entry) => entry.participantId);
        this._simulationService.validateCoverageForEdition(edition, participantIds);
      }
      this.world.registries.competitionStages.forEdition(edition.id)
        .filter((stage) => includeStatuses.indexOf(stage.status) !== -1 && !this.runtimeRegistry.hasRunner(stage.id))
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

    // WORLD-SIM-1 (DESIGN.md 10.16, sección 6 del prompt, "límite
    // consciente"): un formato "abstract" solo puede resolverse como UNA
    // sola fase — nunca varias fases dependientes, nunca un trigger
    // `round-completed` intermedio. Bloquea ANTES de mutar nada.
    _validateAbstractFormatSupported(edition, format) {
      if (format.stageTemplates.length !== 1) {
        throw new Error(
          `CompetitionEngine: la edición "${edition.id}" es "abstract" pero su formato "${format.id}" declara `
          + `${format.stageTemplates.length} fases — WORLD-SIM-1 solo soporta formatos de una sola fase resoluble `
          + '(usa "standard"/"full"/"playable" para formatos multi-fase).',
        );
      }
    }

    // Entries de una fase en el shape uniforme {participantId, seed,
    // entryId} — reutiliza `_resolveBracketEntries` para bracket (mismo
    // cálculo que ya usa el runner detallado) y un mapeo directo para
    // round-robin. Usado tanto por el runner real como por el runtime
    // agregado "abstract" (misma fuente de participantes en ambos casos).
    _resolveParticipantEntriesForStage(edition, template, entries, entriesByParticipantId) {
      if (template.runnerType === 'bracket') {
        return this._resolveBracketEntries(edition, template, entries, entriesByParticipantId).entries;
      }
      return entries.map((e) => ({ participantId: e.participantId, seed: e.seed, entryId: e.id }));
    }

    _buildRunnerForStage(edition, format, template, stage, options = {}) {
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
      if (edition.detailLevel === 'abstract') {
        if (!this._simulationService) {
          throw new Error(`CompetitionEngine: la edición "${edition.id}" es "abstract" pero el engine no tiene "simulationService" inyectado.`);
        }
        this._validateAbstractFormatSupported(edition, format);
        const participantEntries = this._resolveParticipantEntriesForStage(edition, template, entries, entriesByParticipantId);
        const firstRoundPairing = options.firstRoundPairing || template.runnerConfig.firstRoundPairing || null;
        // `_dateResolverProvider(activationContext)` devuelve, igual que
        // para round-robin/bracket, un resolver POR PARTIDO — un hito
        // agregado no tiene ronda/índice real, así que se invoca UNA vez
        // con una `meta` sintética mínima para obtener su fecha final.
        const perMatchDateResolver = this._dateResolverProvider({
          template, edition, stage, triggerType: template.activation.type, triggerRound: template.activation.round,
        }) || null;
        const runtime = this._simulationService.buildAbstractRuntime({
          stageId: stage.id,
          competitionDefinitionId: edition.competitionDefinitionId,
          competitionEditionId: edition.id,
          stageKey: template.key,
          entries: participantEntries,
          runnerType: template.runnerType,
          firstRoundPairing,
          dateResolver: () => (perMatchDateResolver ? perMatchDateResolver({
            round: 1, matchIndexInRound: 0, matchesInRound: 1, totalRounds: 1,
          }) : null),
          onStageCompleted: commonHooks.onStageCompleted,
        });
        this.runtimeRegistry.registerRunner(stage.id, runtime);
        return runtime;
      }
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
        // PATHWAYS-1: `options.firstRoundPairing` (reseed ya resuelto por un
        // pathway, ej. Final Four best-vs-worst) tiene prioridad sobre
        // cualquier pairing legacy derivado/declarado en el formato.
        const firstRoundPairing = options.firstRoundPairing || derivedFirstRoundPairing || template.runnerConfig.firstRoundPairing;
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
    // tipos/ids — nunca decide "porque es esta competición concreta" (invariante 11).
    _handleStageEvent(edition, stage, eventType, round) {
      const stageKey = stage.stageKey || this._stageKeyFromId(stage.id, edition);
      // PATHWAYS-1 (DESIGN.md 10.15, sección 9.2 del prompt): el hecho
      // GENÉRICO se emite PRIMERO, antes de la cascada legacy — el handler
      // (PathwayService) decide y aplica sus propias reglas de forma
      // completamente independiente de `activation`/`entrySource`.
      if (this._factHandler) {
        this._factHandler({
          type: eventType, editionId: edition.id, stageId: stage.id, stageKey, round: round || null,
        });
      }
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
        stageKey: template.key,
        rulesPhaseId: template.rulesPhaseId,
        presentationRole: template.presentationRole,
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
      const { edition, stages } = registerEditionWithInitialEntries(this.world, {
        competitionDefinitionId: action.competitionDefinitionId,
        seasonKey: action.seasonKey,
        startDate: action.startDate || null,
        formatBindingId: action.formatBindingId,
        participants: entries.map((e) => ({ id: e.participantId, seed: e.seed })),
        // WORLD-CALENDAR-1: la edición activada por una regla cruzada
        // CONGELA también su calendario y su ruleset (antes solo el
        // formato) — una Copa con runtime fechado ya no puede tener
        // `scheduleProfileId: null`. La regla los transporta como DATO
        // plano; el engine nunca sabe de qué competición se trata.
        scheduleProfileId: action.scheduleProfileId || null,
        rulesetBundleId: action.rulesetBundleId || null,
        // WORLD-SIM-1: la regla legacy transporta el nivel como dato plano
        // igual que el resto de bindings — este mecanismo solo sobrevive
        // para fixtures/tests históricos (BUG-PATHWAYS-01/02 lo retiraron
        // de la ruta productiva).
        detailLevel: action.detailLevel,
      });
      this.initializeEdition(edition.id);
      this._activationEvents.push({ type: 'edition-activated', editionId: edition.id, competitionDefinitionId: action.competitionDefinitionId });
      // El adaptador de UI (game.js) necesita también el/los stage(s)
      // 'edition-start' recién creados para construir su vista legacy —
      // misma información que ya recibe una activación intra-edición
      // normal (ver `_activateStageFromTemplate`).
      stages.forEach((stage) => {
        this._activationEvents.push({
          type: 'stage-activated', editionId: edition.id, stageId: stage.id, stageKey: this._stageKeyFromId(stage.id, edition),
        });
      });
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

    // Partidos PENDIENTES ya materializados de una fase concreta, en orden
    // estable — WORLD-CALENDAR-1: para round-robin es TODO el calendario
    // pendiente (no solo la jornada actual: la cola mundial ordena por
    // fecha, no por puntero de jornada) y para bracket es un descriptor por
    // CADA serie viva de la ronda. PURO: no materializa ni consume RNG.
    listPendingMatches(stageId) {
      return this.runtimeRegistry.requireRunner(stageId).getPendingMatches();
    }

    // Partidos pendientes de TODOS los runners activos, con orden TOTAL
    // estable (instante, id) independiente del orden de inserción de
    // Editions/Stages/`Map` (invariante 12). Fuente `competition-match` de
    // la cola mundial.
    listAllPendingMatches() {
      const all = [];
      this.runtimeRegistry.allStageIds().forEach((stageId) => {
        this.runtimeRegistry.requireRunner(stageId).getPendingMatches().forEach((descriptor) => all.push(descriptor));
      });
      return all.sort((a, b) => {
        const ia = a.scheduledAt || '';
        const ib = b.scheduledAt || '';
        if (ia !== ib) return ia < ib ? -1 : 1;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
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

    // WORLD-SIM-1 (DESIGN.md 10.16): nivel de detalle de la Edition dueña
    // de `stageId` — SIEMPRE por identidad (`Stage -> Edition`), nunca
    // supuesto desde el nombre de la competición.
    _detailLevelForStage(stageId) {
      const stage = this.world.registries.competitionStages.require(stageId);
      return this.world.registries.competitionEditions.require(stage.editionId).detailLevel;
    }

    // WORLD-SIM-1: para una Edition "standard", el resultado lo produce
    // SIEMPRE `CompetitionSimulationService.computeStandardResult()` — se
    // inyecta como `precomputedResult` reutilizando el mismo punto de
    // encaje que ya existía para el partido del usuario (TAC-5,
    // `MatchEngine.options.precomputedResult`), sin duplicar `_recordResult`
    // ni el avance de ronda/bracket de `CompetitionRunners.js`. "playable"/
    // "full" nunca pasan por aquí (comportamiento IDÉNTICO a antes de esta
    // entrega).
    resolveMatch(stageId, matchId, options = {}) {
      const runner = this.runtimeRegistry.requireRunner(stageId);
      const detailLevel = this._detailLevelForStage(stageId);
      const alreadyPrecomputed = options.matchEngineOptions && options.matchEngineOptions.precomputedResult;
      if (detailLevel === 'standard' && !alreadyPrecomputed) {
        if (!this._simulationService) {
          throw new Error(`CompetitionEngine.resolveMatch: el stage "${stageId}" es "standard" pero el engine no tiene "simulationService" inyectado.`);
        }
        const edition = this.world.registries.competitionEditions.require(this.world.registries.competitionStages.require(stageId).editionId);
        const descriptor = runner.getPendingMatches().find((d) => d.id === matchId);
        if (!descriptor) throw new Error(`CompetitionEngine.resolveMatch: partido desconocido/no pendiente "${matchId}" en "${stageId}".`);
        const compactResult = this._simulationService.computeStandardResult({
          homeParticipantId: descriptor.homeParticipantId,
          awayParticipantId: descriptor.awayParticipantId,
          editionId: edition.id,
          stageId,
          matchId,
          seasonKey: edition.seasonKey,
        });
        return runner.resolveMatch(matchId, {
          ...options,
          matchEngineOptions: { ...(options.matchEngineOptions || {}), precomputedResult: compactResult },
        });
      }
      return runner.resolveMatch(matchId, options);
    }

    // -----------------------------------------------------------------
    // WORLD-SIM-1 — hitos agregados "abstract" (fuente `competition-
    // simulation` del calendario mundial, ver `WorldCalendarCoordinator.js`).
    // Nunca disfrazados de partidos `home vs away` (invariante 9).
    // -----------------------------------------------------------------
    listAllPendingAbstractMilestones() {
      const all = [];
      this.runtimeRegistry.allStageIds().forEach((stageId) => {
        const runner = this.runtimeRegistry.requireRunner(stageId);
        if (typeof runner.getPendingMilestones === 'function') all.push(...runner.getPendingMilestones());
      });
      return all.sort((a, b) => {
        const ia = a.scheduledAt || ''; const ib = b.scheduledAt || '';
        if (ia !== ib) return ia < ib ? -1 : 1;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
    }

    resolveAbstractMilestone(stageId, milestoneId, options) {
      const runner = this.runtimeRegistry.requireRunner(stageId);
      if (typeof runner.resolveMilestone !== 'function') {
        throw new Error(`CompetitionEngine.resolveAbstractMilestone: el stage "${stageId}" no es un runtime "abstract".`);
      }
      return runner.resolveMilestone(milestoneId, options);
    }

    getStandings(stageId) { return this.runtimeRegistry.requireRunner(stageId).getStandings(); }

    // -----------------------------------------------------------------
    // PATHWAYS-1 (DESIGN.md 10.15, sección 9.2 del prompt) — hechos
    // deportivos PUROS que necesitan los selectors de un pathway: nunca
    // mutan, nunca consumen RNG, nunca saben por qué un rango de puestos
    // importa. `stageKey` es opcional — si se aporta, se resuelve el stage
    // real de esa edición/competición antes de ir al runner.
    // -----------------------------------------------------------------
    _resolveStageId(competitionDefinitionId, seasonKey, stageKey) {
      return buildStageId(competitionDefinitionId, seasonKey, stageKey);
    }

    getStandingsFacts(competitionDefinitionId, seasonKey, stageKey) {
      return this.getStandings(this._resolveStageId(competitionDefinitionId, seasonKey, stageKey));
    }

    // Ganadores de la ÚLTIMA ronda de un bracket — `null` si el runner
    // todavía no alcanzó su última ronda (nunca se fuerza a resolver nada).
    getBracketFinalRoundWinners(competitionDefinitionId, seasonKey, stageKey) {
      const runner = this.runtimeRegistry.requireRunner(this._resolveStageId(competitionDefinitionId, seasonKey, stageKey));
      // WORLD-SIM-1: un runtime "abstract" (nunca tiene `.rounds`) expone su
      // propio equivalente agregado — mismo contrato de retorno.
      if (typeof runner.getFinalRoundWinners === 'function') return runner.getFinalRoundWinners();
      const finalRound = runner.rounds[runner.rounds.length - 1];
      if (!finalRound.every((series) => series.wins.better >= series.gamesNeededToWin || series.wins.worse >= series.gamesNeededToWin)) {
        return null;
      }
      return finalRound.map((series) => {
        const winner = series.wins.better > series.wins.worse ? series.better : series.worse;
        return { participantId: winner.participantId, seed: winner.seed };
      });
    }

    // Campeón de un bracket que converge a una única serie final — `null`
    // sin campeón todavía (nunca confundir con `isComplete`, ver
    // CompetitionRunners.js).
    getBracketChampion(competitionDefinitionId, seasonKey, stageKey) {
      const runner = this.runtimeRegistry.requireRunner(this._resolveStageId(competitionDefinitionId, seasonKey, stageKey));
      return runner.champion;
    }

    isStageCompleted(competitionDefinitionId, seasonKey, stageKey) {
      const stageId = this._resolveStageId(competitionDefinitionId, seasonKey, stageKey);
      const stage = this.world.registries.competitionStages.get(stageId);
      return Boolean(stage && stage.status === 'completed');
    }

    // -----------------------------------------------------------------
    // PATHWAYS-1 — API pública de ACTIVACIÓN: el engine construye/registra,
    // pero es SIEMPRE `CompetitionPathwayService` quien decide qué
    // qualifiers/destino le pasa — el engine nunca interpreta por qué un
    // conjunto de participantes clasifica (invariante 7 de PATHWAYS-1).
    // -----------------------------------------------------------------

    // Activa una fase 'pathway-managed' YA declarada por el formato de
    // `editionId`, con los qualifiers [{ participantId, seed }] que el
    // pathway ya resolvió y validó. Idempotente por stage id: si la fase ya
    // existe (activación repetida del mismo hecho), la devuelve tal cual sin
    // registrar nada de nuevo (invariante 3 de PATHWAYS-1: un trigger se
    // aplica como máximo una vez).
    activateStageFromQualifiers(editionId, stageKey, qualifiers, options = {}) {
      const edition = this.world.registries.competitionEditions.require(editionId);
      const existingStageId = buildStageId(edition.competitionDefinitionId, edition.seasonKey, stageKey);
      const existingStage = this.world.registries.competitionStages.get(existingStageId);
      if (existingStage) return existingStage;
      const format = FormatCatalog().requireFormat(edition.formatBindingId);
      const template = format.getStageTemplate(stageKey);
      const stage = new (Entities().CompetitionStage)({
        id: existingStageId,
        editionId: edition.id,
        name: template.name,
        sequence: template.sequence,
        stageType: template.stageType,
        status: 'active',
        stageKey,
        sourceStageIds: options.sourceStageId ? [options.sourceStageId] : [],
      });
      this.world.registries.registerCompetitionStage(stage);
      const definition = this.world.registries.competitionDefinitions.require(edition.competitionDefinitionId);
      qualifiers.forEach((qualifier, index) => {
        this.world.registries.registerCompetitionEntry(new (Entities().CompetitionEntry)({
          id: buildEntryId(edition.competitionDefinitionId, edition.seasonKey, stageKey, qualifier.participantId),
          editionId: edition.id,
          stageId: stage.id,
          participantType: definition.participantType,
          participantId: qualifier.participantId,
          entryStatus: 'qualified',
          seed: qualifier.seed !== undefined && qualifier.seed !== null ? qualifier.seed : index + 1,
          qualificationSource: 'pathway',
          qualificationReceiptId: options.receiptId || null,
        }));
      });
      this._buildRunnerForStage(edition, format, template, stage, { firstRoundPairing: options.firstRoundPairing || null });
      this._activationEvents.push({
        type: 'stage-activated', editionId: edition.id, stageId: stage.id, stageKey,
      });
      return stage;
    }

    // Crea/activa una Edition de OTRA competición desde una decisión YA
    // resuelta (qualifiers + seeds) — mismo resultado que
    // `_fireCrossEditionRule()` legacy, pero sin computar el entrySource por
    // sí mismo: lo recibe ya calculado del pathway. Idempotente por edition
    // id.
    activateEditionFromDecision({
      competitionDefinitionId, seasonKey, startDate, formatBindingId, scheduleProfileId, rulesetBundleId,
      pathwayBindingIds, qualifiers, receiptId, detailLevel,
    }) {
      const existingEditionId = buildEditionId(competitionDefinitionId, seasonKey);
      const existingEdition = this.world.registries.competitionEditions.get(existingEditionId);
      if (existingEdition) return { edition: existingEdition, stages: this.world.registries.competitionStages.forEdition(existingEdition.id) };
      // WORLD-SIM-1 (DESIGN.md 10.16, sección 8 del prompt):
      // `CompetitionPathwayService` NUNCA copia el nivel de la Edition
      // fuente — el destino resuelve su PROPIO nivel (competición+perfil),
      // así que `detailLevel` llega siempre explícito desde quien invoca
      // esta activación (nunca deducido aquí).
      const { edition, stages } = registerEditionWithInitialEntries(this.world, {
        competitionDefinitionId,
        seasonKey,
        startDate: startDate || null,
        formatBindingId,
        participants: qualifiers.map((q) => ({ id: q.participantId, seed: q.seed })),
        scheduleProfileId: scheduleProfileId || null,
        rulesetBundleId: rulesetBundleId || null,
        pathwayBindingIds: pathwayBindingIds || [],
        qualificationReceiptId: receiptId || null,
        detailLevel,
      });
      this.initializeEdition(edition.id);
      this._activationEvents.push({ type: 'edition-activated', editionId: edition.id, competitionDefinitionId });
      stages.forEach((stage) => {
        this._activationEvents.push({
          type: 'stage-activated', editionId: edition.id, stageId: stage.id, stageKey: stage.stageKey,
        });
      });
      return { edition, stages };
    }

    validateIntegrity() { return this.world.registries.validateIntegrity(); }

    snapshot() { return this.runtimeRegistry.snapshot(); }
  }

  // WORLD-CLEANUP-1 (DESIGN.md 10.21, sección 9.2 del prompt) — consulta
  // PURA del descriptor canónico de un stage: nombres desde
  // `CompetitionDefinition`/`CompetitionStage`, nunca desde un mapa fijo en
  // la UI (los antiguos mapas de traducción stageKey -> clave de interfaz,
  // retirados de `src/ui/game.js`).
  function describeCompetitionContext(registries, stageId) {
    const stage = registries.competitionStages.require(stageId);
    const edition = registries.competitionEditions.require(stage.editionId);
    const definition = registries.competitionDefinitions.require(edition.competitionDefinitionId);
    return {
      competitionDefinitionId: definition.id,
      competitionName: definition.name,
      competitionShortName: definition.shortName,
      editionId: edition.id,
      stageId: stage.id,
      stageKey: stage.stageKey,
      stageName: stage.name,
      stageType: stage.stageType,
      rulesPhaseId: stage.rulesPhaseId,
    };
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
    describeCompetitionContext,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
