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

  const { LocalDate } = dep('../utils/LocalDate.js');
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
  const SquadBudgetEntities = dep('../entities/SquadBudget.js');
  const { SquadBudgetRegistry } = dep('./SquadBudgetRegistry.js');
  const { SquadBudgetService } = dep('./SquadBudgetService.js');
  const ClubFinanceEntities = dep('../entities/ClubFinance.js');
  const { ClubFinanceRegistry } = dep('./ClubFinanceRegistry.js');
  const { ClubFinanceService } = dep('./ClubFinanceService.js');
  const ManagerBoardEntities = dep('../entities/ManagerBoard.js');
  const { ManagerBoardRegistry } = dep('./ManagerBoardRegistry.js');
  const { ManagerEmploymentService } = dep('./ManagerEmploymentService.js');
  const { BoardConfidenceService } = dep('./BoardConfidenceService.js');
  const BoardBudgetRequestEntities = dep('../entities/BoardBudgetRequest.js');
  const { BoardBudgetRequestRegistry } = dep('./BoardBudgetRequestRegistry.js');
  const { ContentPackLifecycleService } = dep('./ContentPackLifecycleService.js');
  const { CompetitionEngine, buildEditionId } = dep('./CompetitionEngine.js');
  const { CompetitionSimulationService } = dep('./CompetitionSimulationService.js');
  const { CompetitionScheduleService } = dep('./CompetitionScheduleService.js');
  const { CompetitionScheduleCatalog } = dep('./CompetitionScheduleCatalog.js');
  const { CompetitionContextService } = dep('./CompetitionContextService.js');
  const Events = dep('./Events.js');
  const { CareerPersistenceBoundary } = dep('./CareerPersistenceBoundary.js');

  // ECONOMY-BOARD-1: v3 añade las colecciones durables `clubFinance`/
  // `managerBoard`/`boardBudgetRequests`. v1/v2 siguen siendo versiones de
  // guardado LEGIBLES (ver `MIGRATABLE_SCHEMA_VERSIONS` más abajo) — un
  // guardado anterior a esta entrega nunca se vuelve inservible en
  // silencio.
  const SUPPORTED_SCHEMA_VERSION = 3;
  const MIGRATABLE_SCHEMA_VERSIONS = [1, 2];
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
    if (envelope.schemaVersion < SUPPORTED_SCHEMA_VERSION && !MIGRATABLE_SCHEMA_VERSIONS.includes(envelope.schemaVersion)) {
      // Punto de entrada EXPLÍCITO para migraciones de schema (sección 4.2
      // del prompt original de SAVE-LOAD-1) — SQUAD-BUDGET-1 registra aquí
      // la primera migración real (v1 -> v2, ver `migrateSquadBudgetV1toV2()`
      // más abajo). Una versión sin ruta de migración registrada sigue
      // fallando explícito, nunca se hidrata a medias.
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

    // SQUAD-BUDGET-1: se crea VACÍO aquí (para poder adjuntarlo junto al
    // resto de registros de dominio) y se rellena más abajo, una vez
    // reconstruido el calendario — un guardado v1 (sin esta colección) se
    // migra con la fecha/temporada REALES del calendario restaurado, nunca
    // con una fecha inventada.
    const squadBudgetRegistry = new SquadBudgetRegistry();

    // ECONOMY-BOARD-1: mismo criterio — VACÍOS aquí, rellenados más abajo
    // una vez reconstruidos calendario/careerSetup/usuario (la migración
    // v1/v2 necesita la fecha real del calendario y el club controlado).
    const clubFinanceRegistry = new ClubFinanceRegistry();
    const managerBoardRegistry = new ManagerBoardRegistry();
    const boardBudgetRequestRegistry = new BoardBudgetRequestRegistry();

    world.attachDomainRegistries({
      contractRegistry, registrationRegistry, agentRegistry, marketRegistry,
      transferRegistry, loanRegistry, annualCycleRegistry, academyRegistry, nationalTeamRegistry, squadBudgetRegistry,
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

    // --- SQUAD-BUDGET-1: presupuesto salarial de plantilla -----------------
    // v2: restauración sin pérdida desde la colección ya guardada. v1
    // (migración, sección 8 del prompt): el fingerprint/formato/content
    // packs YA se validaron arriba (`verifyEnvelopeIntegrity()`) antes de
    // reconstruir ninguna entidad — aquí se construyen las asignaciones de
    // APERTURA que faltan a partir de los contratos/reservas y la fecha de
    // calendario YA restaurados, con la MISMA política de compatibilidad
    // que usa el bootstrap de una carrera nueva — nunca una fórmula
    // distinta ni una fecha inventada. Idempotente: si esta misma carrera
    // ya se migró y se vuelve a cargar (guardado v2 con la colección ya
    // poblada), este bloque no se ejecuta.
    if (payload.collections.squadBudget) {
      squadBudgetRegistry.restoreState(payload.collections.squadBudget, SquadBudgetEntities);
    } else {
      const seasonKey = calendar.currentSeasonKey;
      const isoDate = calendar.currentLocalDate;
      world.registries.teams.all().forEach((team) => {
        const compat = SquadBudgetService.computeMarketCompatibilityAmount({ team, contractRegistry, seasonKey });
        SquadBudgetService.ensureOpeningAllocation({
          registry: squadBudgetRegistry,
          clubId: team.clubId,
          seasonKey,
          currency: compat.currency,
          effectiveDate: isoDate,
          amountMinor: compat.amountMinor,
          policyVersion: compat.policyVersion,
          basisAmountMinor: compat.basisAmountMinor,
          multiplier: compat.multiplier,
          revisionKind: 'migration-backfill',
          decisionAuthority: 'migration',
          calculatedAtGameDate: isoDate,
          note: `Reconstruida al migrar un guardado v1 sin presupuesto salarial — estimación de compatibilidad `
            + `para ${seasonKey} a partir de los contratos/reservas ya restaurados.`,
        });
      });
    }

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

    // --- ECONOMY-BOARD-1: economía real del club --------------------------
    // v3: restauración sin pérdida. v1/v2 (migración, sección 11 del
    // prompt): se inicializa la economía EN LA FECHA del guardado — los
    // contratos/ingresos anteriores quedan como evidencia
    // "migration-assumed-settled" (implícita en la caja de apertura, nunca
    // una posting retroactiva) y solo se programan items fechados a partir
    // de esa fecha (`notBeforeDate`, ver `ClubFinanceService`).
    if (payload.collections.clubFinance) {
      clubFinanceRegistry.restoreState(payload.collections.clubFinance, ClubFinanceEntities);
    } else {
      const seasonKey = calendar.currentSeasonKey;
      const isoDate = calendar.currentLocalDate;
      const clubIds = world.registries.teams.all().map((team) => team.clubId);
      const archetypes = ClubFinanceService.assignArchetypes(clubIds, world.careerSeed);
      world.registries.teams.all().forEach((team) => {
        ClubFinanceService.ensureClubProfile({
          registry: clubFinanceRegistry,
          clubId: team.clubId,
          currency: 'EUR',
          archetype: archetypes.get(team.clubId),
          careerSeed: world.careerSeed,
          calculatedAtGameDate: isoDate,
        });
        // Sección 5.4 del prompt: horizonte de 3 temporadas también en la
        // migración — actual + 2 siguientes, con el ancla trasladada sin
        // crecimiento para las que todavía no tienen límite propio.
        [0, 1, 2].forEach((offset) => {
          const horizonSeasonKey = LocalDate.addSeasons(seasonKey, offset);
          let expectedHomeGames = 17;
          try {
            const competitionId = CompetitionContextService.resolveDomesticCompetitionId(world.registries, team.id, {
              seasonKey: horizonSeasonKey, operation: 'club-finance-migration',
            });
            const edition = world.registries.competitionEditions.get(buildEditionId(competitionId, horizonSeasonKey));
            if (edition) {
              expectedHomeGames = Math.max(1, world.registries.competitionEntries.forEdition(edition.id).length - 1);
            }
          } catch (e) {
            // Sin competición doméstica resoluble todavía (club sin Entry en
            // esta temporada) — se conserva el valor por defecto, nunca falla
            // la migración completa por esto.
          }
          ClubFinanceService.buildSeasonPlan({
            registry: clubFinanceRegistry,
            squadBudgetRegistry,
            clubId: team.clubId,
            seasonKey: horizonSeasonKey,
            currency: 'EUR',
            calculatedAtGameDate: isoDate,
            expectedHomeGames,
            isCareerOpening: offset === 0,
          });
        });
      });
    }

    // --- ECONOMY-BOARD-1: manager/junta -----------------------------------
    // v3: restauración sin pérdida. v1/v2: crea el manager humano + spell
    // activo desde `careerSetup.createdAtGameDate` y el club controlado del
    // guardado (nunca el reloj de sistema) y el perfil de política de junta
    // por club — nunca peticiones históricas ni evaluaciones de temporada
    // retroactivas.
    if (payload.collections.managerBoard) {
      managerBoardRegistry.restoreState(payload.collections.managerBoard, ManagerBoardEntities);
    } else {
      const clubIds = world.registries.teams.all().map((team) => team.clubId);
      const fiscalStyles = BoardConfidenceService.assignFiscalStyles(clubIds, world.careerSeed);
      world.registries.teams.all().forEach((team) => {
        ManagerEmploymentService.ensureBoardPolicyProfile({
          registry: managerBoardRegistry,
          clubId: team.clubId,
          fiscalStyle: fiscalStyles.get(team.clubId),
          careerSeed: world.careerSeed,
          calculatedAtGameDate: calendar.currentLocalDate,
        });
      });
      if (userClubId) {
        const managerStartDate = (careerSetupSnapshot && careerSetupSnapshot.createdAtGameDate) || calendar.currentLocalDate;
        ManagerEmploymentService.ensureManagerAndActiveSpell({
          registry: managerBoardRegistry,
          careerSeed: world.careerSeed,
          controlledClubId: userClubId,
          startGameDate: managerStartDate,
        });
      }
    }

    // --- ECONOMY-BOARD-1: peticiones de ampliación de presupuesto ---------
    // v3: restauración sin pérdida. v1/v2: ninguna petición histórica
    // (sección 11 del prompt) — el registro queda vacío.
    if (payload.collections.boardBudgetRequests) {
      boardBudgetRequestRegistry.restoreState(payload.collections.boardBudgetRequests, BoardBudgetRequestEntities);
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
      squadBudgetRegistry,
      clubFinanceRegistry,
      managerBoardRegistry,
      boardBudgetRequestRegistry,
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
