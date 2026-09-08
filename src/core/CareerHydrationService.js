// src/core/CareerHydrationService.js
// SAVE-LOAD-1 — hidratador de una carrera guardada: reconstruye un runtime
// de carrera COMPLETO y validado desde el envelope que produce
// `CareerPersistenceBoundary.project()` (extendido por esta misma Epic).
// Módulo PURO: recibe dependencias EXPLÍCITAS (nunca lee `state`/DOM/reloj
// de sistema/aleatoriedad propia), mismo criterio que
// `CareerPersistenceBoundary.js`/`CompetitionEngine.js`.
//
// Dos fases obligatorias (sección 6 del prompt de la Epic):
//   1. `hydrate(envelope, deps)` reconstruye TODO en un runtime aislado y
//      ejecuta TODAS las validaciones — si algo falla, lanza y no devuelve
//      nada (la carrera activa de quien llama nunca se ve tocada, porque
//      este módulo nunca escribe en `state`).
//   2. Solo cuando `hydrate()` devuelve con éxito, el llamador (`game.js`)
//      sustituye `state.*` de una sola vez (asignación síncrona — JS de un
//      solo hilo hace esa sustitución atómica de por sí).
//
// Este módulo NUNCA reutiliza el bootstrap de una carrera nueva
// (`startCareerFromSetup`/`ContentPackManifest.install()`/
// `ContractSeeder`/`RegistrationSeeder`/`MarketSeeder`) como fuente
// autoritativa — construye cada entidad EXCLUSIVAMENTE desde el payload
// guardado, vía su propio constructor `(data = {})` (el mismo patrón de
// round-trip que ya usan `Team`/`Club`/`Squad`/`Player`/`Contract`/...) y
// la registra con las APIs públicas de cada registro (nunca escribe un
// campo interno `_xxx` directamente, salvo donde el propio registro ya lo
// hace así en su `restoreState()`).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const { GameWorld } = dep('../entities/World.js');
  const { CareerSetupSnapshot } = dep('../entities/CareerSetup.js');
  const { GeographicArea } = dep('../entities/Geography.js');
  const { Organization } = dep('../entities/Organization.js');
  const { Club } = dep('../entities/Club.js');
  const { Team } = dep('../entities/Team.js');
  const { Squad } = dep('../entities/Squad.js');
  const CompetitionEntities = dep('../entities/Competition.js');
  const { CompetitionPathwayReceipt, CompetitionSeasonTransitionReceipt } = dep('../entities/CompetitionPathway.js');
  const { Player } = dep('../entities/Player.js');
  const { Contract } = dep('../entities/Contract.js');
  const RegistrationEntities = dep('../entities/Registration.js');
  const AgentEntities = dep('../entities/Agent.js');
  const MarketEntities = dep('../entities/Market.js');
  const TransferEntities = dep('../entities/Transfer.js');
  const LoanEntities = dep('../entities/Loan.js');
  const CycleEntities = dep('../entities/Cycle.js');
  const NationalTeamEntities = dep('../entities/NationalTeam.js');
  const { WorldSimulationProfile, TeamSimulationSnapshot, CompetitionSimulationReceipt } = dep('../entities/WorldSimulation.js');
  const { WorldRegistries } = dep('./WorldRegistry.js');
  const { WorldCalendar } = dep('./WorldCalendar.js');
  const { PlayerRegistry } = dep('./PlayerRegistry.js');
  const { ContractRegistry } = dep('./ContractRegistry.js');
  const { RegistrationRegistry } = dep('./RegistrationRegistry.js');
  const { AgentRegistry } = dep('./AgentRegistry.js');
  const { MarketRegistry } = dep('./MarketRegistry.js');
  const { TransferRegistry } = dep('./TransferRegistry.js');
  const { LoanRegistry } = dep('./LoanRegistry.js');
  const { AnnualCycleRegistry } = dep('./AnnualCycleRegistry.js');
  const { AcademyRegistry } = dep('./AcademyRegistry.js');
  const { NationalTeamRegistry } = dep('./NationalTeamRegistry.js');
  const { ContentPackLifecycleService } = dep('./ContentPackLifecycleService.js');
  const { CompetitionEngine } = dep('./CompetitionEngine.js');
  const { CompetitionSimulationService } = dep('./CompetitionSimulationService.js');
  const { CompetitionScheduleService } = dep('./CompetitionScheduleService.js');
  const { CompetitionScheduleCatalog } = dep('./CompetitionScheduleCatalog.js');
  const Events = dep('./Events.js');
  const { CareerPersistenceBoundary } = dep('./CareerPersistenceBoundary.js');

  const SUPPORTED_SCHEMA_VERSION = 1;
  const SUPPORTED_FORMAT = 'basket-manager-career-save';

  function fail(reason, detail) {
    const error = new Error(`CareerHydrationService: ${reason}${detail ? ` — ${detail}` : ''}`);
    error.hydrationReason = reason;
    throw error;
  }

  // ---------------------------------------------------------------------
  // 1. Validaciones de sobre (formato/schema/fingerprint) — ANTES de tocar
  //    ninguna entidad. Nunca hidrata un envelope corrupto o incompatible.
  // ---------------------------------------------------------------------
  function verifyEnvelopeIntegrity(envelope) {
    if (!envelope || typeof envelope !== 'object') fail('el envelope no es un objeto');
    if (envelope.format !== SUPPORTED_FORMAT) {
      fail('formato de guardado desconocido', `"${envelope.format}" (esperado "${SUPPORTED_FORMAT}")`);
    }
    if (envelope.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
      fail(
        'versión de guardado más reciente que esta versión del juego',
        `schemaVersion ${envelope.schemaVersion} > ${SUPPORTED_SCHEMA_VERSION} soportado`,
      );
    }
    if (envelope.schemaVersion < SUPPORTED_SCHEMA_VERSION) {
      // v1 es la única versión existente — este bloque es el punto de
      // entrada EXPLÍCITO para una migración futura (sección 4.2 del
      // prompt: "crea un punto explícito para futuras migraciones de
      // schema, aunque en v1 no haya ninguna migración real").
      fail('versión de guardado anterior sin ruta de migración registrada', `schemaVersion ${envelope.schemaVersion}`);
    }
    if (!envelope.fingerprint) fail('el guardado no lleva fingerprint');
    const { fingerprint, ...withoutFingerprint } = envelope;
    const recomputed = CareerPersistenceBoundary.computeFingerprint(withoutFingerprint);
    if (recomputed !== fingerprint) {
      fail('fingerprint no coincide — el guardado parece corrupto o manipulado', `esperado ${fingerprint}, recalculado ${recomputed}`);
    }
    if (!envelope.payload) fail('el guardado no lleva "payload"');
  }

  // ---------------------------------------------------------------------
  // 2. Content packs — EXACTOS por id+version, nunca reinstalados (nunca
  //    se llama a `manifest.install()`, que regeneraría contenido nuevo).
  // ---------------------------------------------------------------------
  function resolveExactContentPacks(payload, availableContentPacks) {
    const byId = new Map((availableContentPacks || []).map((m) => [m.id, m]));
    return (payload.world.installedContentPacks || []).map((saved) => {
      const manifest = byId.get(saved.id);
      if (!manifest) fail('content pack instalado ya no está disponible en esta versión del juego', saved.id);
      if (manifest.version !== saved.version) {
        fail(
          'content pack con versión incompatible',
          `"${saved.id}" guardado en versión ${saved.version}, disponible ${manifest.version}`,
        );
      }
      return { manifest, saved };
    });
  }

  // ---------------------------------------------------------------------
  // 3. World + WorldRegistries — reconstrucción por id, respetando el orden
  //    de `stageIds`/`entryIds` original de cada Edition/Stage (esos campos
  //    los reconstruye el propio registro al registrar cada stage/entry —
  //    nunca se empujan a mano — así que el ORDEN de registro debe
  //    reproducir el ORDEN original, o el fingerprint de una carga
  //    posterior no coincidiría con el de una carga anterior).
  // ---------------------------------------------------------------------
  function rebuildWorldRegistries(world, worldRegistriesJson) {
    const registries = world.registries;
    (worldRegistriesJson.areas || []).forEach((j) => registries.registerArea(new GeographicArea(j)));
    (worldRegistriesJson.organizations || []).forEach((j) => registries.registerOrganization(new Organization(j)));
    (worldRegistriesJson.clubs || []).forEach((j) => registries.registerClub(new Club(j)));

    // Teams — SIN roster (lo aporta el Squad más abajo). Reconstruidos
    // desde la colección `teams` extendida por SAVE-LOAD-1 (institucional/
    // táctico/entrenamiento) cuando existe; degrada al bare `teamIds` de
    // `worldRegistries` si un guardado viejo no la tuviera (nunca debería
    // ocurrir en v1, pero evita un fallo confuso).
    const teamsJsonById = new Map((worldRegistriesJson.__teamsFull || []).map((j) => [j.id, j]));
    (worldRegistriesJson.teamIds || []).forEach((teamId) => {
      const teamJson = teamsJsonById.get(teamId);
      if (!teamJson) fail('falta el estado completo de un equipo en el guardado', teamId);
      const team = new Team(teamJson);
      team.clubId = teamJson.clubId;
      registries.registerTeam(team);
    });
    (worldRegistriesJson.clubs || []).forEach((clubJson) => {
      if (!clubJson.primaryTeamId) return;
      const club = registries.clubs.get(clubJson.id);
      const team = registries.teams.get(clubJson.primaryTeamId);
      if (club && team) team.club = club;
    });

    (worldRegistriesJson.squads || []).forEach((squadJson) => {
      const players = squadJson.playerIds.map((id) => world.domainRegistries.playerRegistry.require(id));
      const squad = new Squad({ ...squadJson, players });
      registries.registerSquad(squad);
      const team = registries.teams.get(squad.teamId);
      if (team && squad.status === 'active' && squad.squadType === 'first-team-senior') {
        team.primarySquadId = squad.id;
        team.squad = squad;
      }
    });

    (worldRegistriesJson.competitionDefinitions || []).forEach((j) => registries.registerCompetitionDefinition(new CompetitionEntities.CompetitionDefinition(j)));

    const stagesById = new Map((worldRegistriesJson.competitionStages || []).map((j) => [j.id, j]));
    const entriesById = new Map((worldRegistriesJson.competitionEntries || []).map((j) => [j.id, j]));

    (worldRegistriesJson.competitionEditions || []).forEach((editionJson) => {
      const edition = new CompetitionEntities.CompetitionEdition(editionJson);
      registries.registerCompetitionEdition(edition);
      (editionJson.stageIds || []).forEach((stageId) => {
        const stageJson = stagesById.get(stageId);
        if (!stageJson) fail('la Edition referencia un Stage que no está en el guardado', stageId);
        registries.registerCompetitionStage(new CompetitionEntities.CompetitionStage(stageJson));
      });
      (editionJson.entryIds || []).forEach((entryId) => {
        const entryJson = entriesById.get(entryId);
        if (!entryJson) fail('la Edition referencia un Entry que no está en el guardado', entryId);
        registries.registerCompetitionEntry(new CompetitionEntities.CompetitionEntry(entryJson));
      });
    });

    (worldRegistriesJson.pathwayReceipts || []).forEach((j) => registries.pathwayReceipts.register(new CompetitionPathwayReceipt(j)));
    (worldRegistriesJson.seasonTransitionReceipts || []).forEach((j) => registries.seasonTransitionReceipts.register(new CompetitionSeasonTransitionReceipt(j)));
    (worldRegistriesJson.teamSimulationSnapshots || []).forEach((j) => registries.teamSimulationSnapshots.register(new TeamSimulationSnapshot(j)));
    (worldRegistriesJson.competitionSimulationReceipts || []).forEach((j) => registries.competitionSimulationReceipts.register(new CompetitionSimulationReceipt(j)));
  }

  // ---------------------------------------------------------------------
  // 4. Runtime competitivo — reconstruye cada runner con
  //    `CompetitionEngine.initializeEdition()` (mismo código que una
  //    carrera nueva, determinista desde las Entries YA restauradas) y
  //    REAPLICA cada resultado ya conocido en silencio (sin RNG, sin
  //    repetir callbacks) — ver `CompetitionRunners.js` (SAVE-LOAD-1).
  // ---------------------------------------------------------------------
  function rebuildCompetitionRuntime(world, competitionEngine, competitionRuntimeJson) {
    // `includeStatuses: ['active', 'completed']` — una fase YA terminada
    // (ej. Liga regular con un playoff posterior todavía en curso) sigue
    // necesitando su runner vivo para reaplicar sus partidos y exponer su
    // clasificación/histórico (ver comentario de
    // `CompetitionEngine.initializeEdition()`, SAVE-LOAD-1). Ediciones
    // `cancelled` nunca tuvieron runner y no lo necesitan.
    world.registries.competitionEditions.all()
      .filter((edition) => edition.status !== 'cancelled')
      .forEach((edition) => competitionEngine.initializeEdition(edition.id, { includeStatuses: ['active', 'completed'] }));

    (competitionRuntimeJson || []).forEach(({ stageId, playedMatches }) => {
      const runner = competitionEngine.getRunner(stageId);
      if (!runner) fail('el guardado tiene partidos jugados para un stage sin runner reconstruible', stageId);
      (playedMatches || []).forEach(({ id, result }) => {
        competitionEngine.resolveMatch(stageId, id, { silent: true, matchEngineOptions: { precomputedResult: result } });
      });
    });
  }

  // ---------------------------------------------------------------------
  // 5. Contrato principal.
  // ---------------------------------------------------------------------
  // `deps`:
  //   - `availableContentPacks`: manifests REALES disponibles en esta
  //     versión del juego (`listAvailableContentPacks()`), con sus
  //     `hooks`/`install` intactos.
  //   - `buildDateResolverProvider(scheduleService)`: función que construye
  //     el `dateResolverProvider` del `CompetitionEngine` — el mismo
  //     patrón que `buildCompetitionDateResolverProvider()` de `game.js`
  //     (aportado por el llamador para no duplicar esa lógica ni acoplar
  //     este módulo a la UI).
  function hydrate(envelope, deps = {}) {
    verifyEnvelopeIntegrity(envelope);
    const { availableContentPacks, buildDateResolverProvider } = deps;
    if (!Array.isArray(availableContentPacks)) fail('faltan "availableContentPacks" explícitos');
    if (typeof buildDateResolverProvider !== 'function') fail('falta "buildDateResolverProvider" explícito');

    const payload = envelope.payload;
    const resolvedPackPairs = resolveExactContentPacks(payload, availableContentPacks);
    const resolvedPacks = resolvedPackPairs.map((p) => p.manifest);

    // --- Mundo (identidad + perfil de simulación) ------------------------
    const identity = payload.world.identity;
    if (!identity) fail('falta la identidad del mundo en el guardado');
    const world = new GameWorld({
      id: identity.id,
      name: identity.name,
      careerSeed: identity.careerSeed,
      createdAtGameDate: identity.createdAtGameDate,
      schemaVersion: identity.schemaVersion,
    });
    if (payload.world.simulationProfile) {
      world.setSimulationProfile(new WorldSimulationProfile(payload.world.simulationProfile));
    }

    // --- Content packs: SOLO metadato de instalación, nunca `install()` --
    resolvedPackPairs.forEach(({ manifest, saved }) => {
      world.registries.packs.registerManifest(manifest);
      world.registries.packs.markInstalled(manifest, saved.installedAt !== undefined ? saved.installedAt : identity.createdAtGameDate);
    });
    // Catálogos ESTÁTICOS (formato/calendario/pathway) — hooks puros,
    // nunca tocan el mundo (mismo `prepareCatalogs()` que una carrera
    // nueva, necesario para que `CompetitionEngine`/`CompetitionSchedule
    // Service`/`CompetitionPathwayService` resuelvan sus catálogos).
    const contentPackLifecycle = new ContentPackLifecycleService({ manifests: resolvedPacks });
    contentPackLifecycle.prepareCatalogs(resolvedPacks);

    // --- Player Registry (UNA instancia por jugador, nunca duplicada) ----
    const playerRegistry = new PlayerRegistry();
    (payload.collections.players || []).forEach((j) => playerRegistry.register(new Player(j)));
    world.attachDomainRegistries({ playerRegistry });

    // --- WorldRegistries (áreas/orgs/clubes/equipos/squads/competición) --
    const worldRegistriesJson = { ...payload.world.registries, __teamsFull: payload.collections.teams };
    rebuildWorldRegistries(world, worldRegistriesJson);

    // --- Registros de dominio profesional --------------------------------
    const contractRegistry = new ContractRegistry();
    contractRegistry.restoreState(payload.collections.contracts, Contract);

    const registrationRegistry = new RegistrationRegistry();
    registrationRegistry.restoreState(payload.collections.registrations || {}, RegistrationEntities);

    const agentRegistry = new AgentRegistry();
    agentRegistry.restoreState(payload.collections.agents || {}, AgentEntities);

    const marketRegistry = new MarketRegistry();
    marketRegistry.restoreState(payload.collections.market || {}, MarketEntities);

    const transferRegistry = new TransferRegistry();
    transferRegistry.restoreState(payload.collections.transfers || {}, TransferEntities);

    const loanRegistry = new LoanRegistry();
    loanRegistry.restoreState(payload.collections.loans || {}, LoanEntities);

    const annualCycleRegistry = new AnnualCycleRegistry();
    annualCycleRegistry.restoreState(payload.collections.annualCycle || {}, CycleEntities);

    const academyRegistry = new AcademyRegistry();
    academyRegistry.restoreState(payload.collections.academy || {}, CycleEntities);

    const nationalTeamRegistry = new NationalTeamRegistry();
    nationalTeamRegistry.restoreState(payload.collections.nationalTeams || {}, NationalTeamEntities);

    world.attachDomainRegistries({
      contractRegistry, registrationRegistry, agentRegistry, marketRegistry,
      transferRegistry, loanRegistry, annualCycleRegistry, academyRegistry, nationalTeamRegistry,
    });

    // --- Calendario (UN solo WorldCalendar, cursor+temporadas+pendientes) -
    const calendarJson = payload.world.calendar;
    if (!calendarJson) fail('falta el calendario en el guardado');
    const calendar = new WorldCalendar({
      id: calendarJson.id,
      defaultTimeZoneId: calendarJson.defaultTimeZoneId,
      initialInstant: calendarJson.currentInstant,
    });
    (calendarJson.seasons || []).forEach((season) => calendar.registerSeason(season));
    world.setCalendar(calendar);

    // --- Motor de competiciones + simulación ------------------------------
    const simulationService = new CompetitionSimulationService({ world, careerSeed: world.careerSeed });
    const competitionEngine = new CompetitionEngine({ world, simulationService });
    const scheduleService = new CompetitionScheduleService({ catalog: CompetitionScheduleCatalog });
    competitionEngine.setDateResolverProvider(buildDateResolverProvider(scheduleService));
    rebuildCompetitionRuntime(world, competitionEngine, payload.collections.competitionRuntime);

    // Items pendientes/ledger del calendario — SIEMBRA directa (nunca
    // `syncSource()`, que perdería un `awaiting-user`/`failed` ya
    // existente) ANTES de que el llamador vuelva a sincronizar las
    // fuentes reales (`WorldCalendarCoordinator.sync()`), que sí preserva
    // el estado de un item YA existente.
    calendar.restorePendingItems(calendarJson.pendingItems);
    calendar.restoreLedger(calendarJson.ledger);

    // --- Career setup + identidad del usuario -----------------------------
    // `userTeamId`/`userClubId` viven en `envelope.metadata` (metadato de
    // ranura, fuera de `payload`) — se validan aquí contra el mundo YA
    // reconstruido, nunca se asumen ciegamente.
    const careerSetupSnapshot = payload.careerSetup ? new CareerSetupSnapshot(payload.careerSetup) : null;
    const userTeamId = envelope.metadata ? envelope.metadata.userTeamId : null;
    const userClubId = envelope.metadata ? envelope.metadata.userClubId : null;
    if (userTeamId && !world.registries.teams.has(userTeamId)) {
      fail('el equipo del usuario del guardado no existe en el mundo reconstruido', userTeamId);
    }

    // --- Estado de interfaz no derivable (noticias/agenda/alineación) -----
    const uiState = payload.collections.uiState || {};
    if (Events && typeof Events.ensureEventIdCounterAtLeast === 'function') {
      const maxSuffix = (list) => (list || []).reduce((max, event) => {
        const match = /-(\d+)$/.exec(event && event.id || '');
        return match ? Math.max(max, parseInt(match[1], 10)) : max;
      }, 0);
      Events.ensureEventIdCounterAtLeast(Math.max(
        maxSuffix(uiState.newsLog), maxSuffix(uiState.medicalAgendaLog), maxSuffix(uiState.marketAgendaLog),
      ));
    }

    // --- Validaciones finales — antes de devolver nada al llamador --------
    const integrityErrors = world.registries.validateIntegrity();
    if (integrityErrors && integrityErrors.length) {
      fail('WorldRegistries no pasa su propia validación de integridad', integrityErrors.join('; '));
    }
    if (world.domainRegistries.playerRegistry !== playerRegistry) fail('alias de playerRegistry desincronizado tras hidratar');
    if (world.calendar !== calendar) fail('alias de calendario desincronizado tras hidratar');

    return {
      world,
      calendar,
      playerRegistry,
      contractRegistry,
      registrationRegistry,
      agentRegistry,
      marketRegistry,
      transferRegistry,
      loanRegistry,
      annualCycleRegistry,
      academyRegistry,
      nationalTeamRegistry,
      competitionEngine,
      competitionSimulationService: simulationService,
      scheduleService,
      contentPackLifecycle,
      installedContentPackManifests: resolvedPacks,
      careerSetupSnapshot,
      userTeamId,
      userClubId,
      seasonStartYear: careerSetupSnapshot ? careerSetupSnapshot.seasonStartYear : null,
      uiState: {
        newsLog: [...(uiState.newsLog || [])],
        medicalAgendaLog: [...(uiState.medicalAgendaLog || [])],
        marketAgendaLog: [...(uiState.marketAgendaLog || [])],
        lineup: uiState.lineup || null,
        negotiationSequences: uiState.negotiationSequences || {
          transferNegotiationOfferSequence: {}, loanNegotiationAttemptSequence: {},
        },
      },
    };
  }

  const exportsObj = {
    CareerHydrationService: {
      hydrate, verifyEnvelopeIntegrity, SUPPORTED_SCHEMA_VERSION, SUPPORTED_FORMAT,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
