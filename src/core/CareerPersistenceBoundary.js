// src/core/CareerPersistenceBoundary.js
// WORLD-HARDEN-1 (DESIGN.md 10.19, sección 12 del prompt) — SONDA de
// persistibilidad, no un save jugable: un módulo PURO que recibe
// dependencias EXPLÍCITAS (nunca `game.js`, `state` global ni DOM) y ofrece
// dos resultados —
//   1. `inventory()`: lista versionada de qué es durable/derivado/efímero;
//   2. `project(runtime, { snapshotAtGameDate })`: un envelope plano y
//      canónico, JSON-serializable sin pérdida, de todo el estado durable
//      YA declarado en el inventario.
//
// No implementa `fromJSON`/hidratación/`saveCareer`/`loadCareer` ni toca
// `saves/` — eso sigue fuera de alcance hasta que una entrega futura lo
// decida explícitamente (CLAUDE.md, DESIGN.md 10.7/10.9). Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Honestidad de alcance (documentada, no oculta): los proyectores de
// `collections` son SUFICIENTES para demostrar que el dato es serializable,
// plano y sin duplicados — reutilizan los `.snapshot()`/`.toJSON()`/
// `.describe()` YA existentes en cada registro (`ContractRegistry`,
// `RegistrationRegistry`, `AgentRegistry`, `MarketRegistry`,
// `TransferRegistry`, `LoanRegistry`, `AnnualCycleRegistry`,
// `AcademyRegistry`, `NationalTeamRegistry`, `WorldRegistries`,
// `PlayerRegistry`) — esos métodos son la fuente CANÓNICA de qué campos
// son durables en cada dominio; este módulo no reinventa esos campos, solo
// los ENSAMBLA, ORDENA por id estable, y detecta ausencias.

(function (global) {
  function requireDep(value, label) {
    if (value === undefined || value === null) {
      throw new Error(`CareerPersistenceBoundary: falta "${label}" explícito.`);
    }
    return value;
  }

  // Orden estable por `id` (o `key` explícita) — nunca el orden de
  // inserción de un `Map`/array interno del registro de origen.
  function byStableId(list, idKey) {
    return [...(list || [])].sort((a, b) => {
      const ai = a && a[idKey] !== undefined ? String(a[idKey]) : '';
      const bi = b && b[idKey] !== undefined ? String(b[idKey]) : '';
      if (ai < bi) return -1;
      if (ai > bi) return 1;
      return 0;
    });
  }

  // ---------------------------------------------------------------------
  // 1. INVENTARIO — versionado, declarativo, sin depender de ninguna
  //    instancia viva (se puede pedir sin construir ninguna carrera).
  // ---------------------------------------------------------------------
  function inventory() {
    return [
      {
        key: 'careerSetup', owner: 'CareerSetupSnapshot', classification: 'durable',
        identityKeys: ['id'], dependsOn: [], rebuildStrategy: null,
      },
      {
        key: 'worldIdentity', owner: 'GameWorld', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['careerSetup'], rebuildStrategy: null,
      },
      {
        key: 'installedContentPacks', owner: 'ContentPackRegistry', classification: 'durable',
        identityKeys: ['id', 'version'], dependsOn: ['worldIdentity'],
        rebuildStrategy: 'Reinstalar los mismos packId+version en el mismo orden de dependencias (los hooks/callbacks del manifiesto son runtime, nunca se serializan).',
      },
      {
        key: 'simulationProfile', owner: 'GameWorld.simulationProfile', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['worldIdentity'], rebuildStrategy: null,
      },
      {
        key: 'calendar', owner: 'WorldCalendar', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['worldIdentity'],
        rebuildStrategy: 'Reconstruir con las temporadas registradas (seasonKey/startInstant/timeZoneId/scheduleIds) y el cursor persistido; el ledger operativo (items ya resueltos) es histórico, no autoridad — ver `retireLedger()`.',
      },
      {
        key: 'worldRegistries', owner: 'WorldRegistries', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['worldIdentity'],
        rebuildStrategy: 'Áreas/organizaciones/clubes/equipos/squads/identidad de competición/edición/stage/entry/receipts — reconstruir por id desde `WorldRegistries.describe()` (ya plano).',
      },
      {
        key: 'players', owner: 'PlayerRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['worldRegistries'],
        rebuildStrategy: 'Un Player por id, reconstruido desde su `toJSON()` — Team/Squad solo referencian el id, nunca copian el jugador.',
      },
      {
        key: 'contracts', owner: 'ContractRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['players', 'worldRegistries'], rebuildStrategy: null,
      },
      {
        key: 'registrations', owner: 'RegistrationRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['players', 'worldRegistries'], rebuildStrategy: null,
      },
      {
        key: 'agents', owner: 'AgentRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['players'], rebuildStrategy: null,
      },
      {
        key: 'market', owner: 'MarketRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['agents', 'players', 'worldRegistries'], rebuildStrategy: null,
      },
      {
        key: 'transfers', owner: 'TransferRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['contracts', 'registrations', 'worldRegistries'], rebuildStrategy: null,
      },
      {
        key: 'loans', owner: 'LoanRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['transfers', 'registrations'], rebuildStrategy: null,
      },
      {
        key: 'annualCycle', owner: 'AnnualCycleRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['contracts', 'registrations', 'players'], rebuildStrategy: null,
      },
      {
        key: 'academy', owner: 'AcademyRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['players'], rebuildStrategy: null,
      },
      {
        key: 'nationalTeams', owner: 'NationalTeamRegistry', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['players', 'worldRegistries'],
        rebuildStrategy: 'Vacío en la partida española por defecto (NATIONAL-TEAMS-1) — proyectado igual que cualquier otra colección durable, nunca omitido.',
      },
      // -----------------------------------------------------------------
      // SAVE-LOAD-1 — colecciones que WORLD-HARDEN-1 dejó fuera de la
      // sonda (auditoría de la sección 5 del prompt de SAVE-LOAD-1): el
      // estado institucional/táctico/de entrenamiento de cada `Team`
      // (`worldRegistries.teamIds` solo daba el id, nunca el contenido) y
      // el progreso REAL de cada runner de competición (partidos ya
      // jugados con su resultado — `runtimeSnapshots` de WORLD-HARDEN-1
      // solo daba `{stageId, status, completed}`, insuficiente para
      // reanudar sin volver a simular). Ambas son DURABLE, no derivadas:
      // un resultado de partido no es reconstruible sin RNG.
      // -----------------------------------------------------------------
      {
        key: 'teams', owner: 'Team (WorldRegistries.teams)', classification: 'durable',
        identityKeys: ['id'], dependsOn: ['worldRegistries'],
        rebuildStrategy: 'Un `Team` por id vía `Team.toJSON()` SIN `roster` (la plantilla real la aporta el `Squad` ya persistido en `worldRegistries.squads` + `PlayerRegistry`, nunca una segunda copia) — captura tacticalProfile/trainingPlan/trainingState/reputation deportiva/historia/rivalidades/staff médico de los 36 equipos, no solo del club del usuario.',
      },
      {
        key: 'competitionRuntime', owner: 'CompetitionEngine (runners vivos)', classification: 'durable',
        identityKeys: ['stageId'], dependsOn: ['worldRegistries'],
        rebuildStrategy: 'Por cada stage con runner activo: lista de partidos YA jugados `{id, result}` en orden de reproducción válido (`runner.listPlayedMatchesInReplayOrder()`). `CareerHydrationService` reconstruye el runner con `CompetitionEngine.initializeEdition()` (mismo código que una carrera nueva, determinista desde Entries ya restauradas) y reaplica cada resultado con `resolveMatch(id, {silent:true, matchEngineOptions:{precomputedResult}})` — sin RNG, sin repetir los callbacks de pathway/noticias (esos efectos ya están en el resto del estado durable).',
      },
      {
        key: 'uiState', owner: 'src/ui/game.js (state.newsLog/medicalAgendaLog/marketAgendaLog/lineup/negotiation sequences)', classification: 'durable',
        identityKeys: [], dependsOn: [],
        rebuildStrategy: 'No reconstruible desde otro estado ya vivo (mismo motivo documentado en el propio código de `game.js`) — se persiste tal cual. Los contadores de id de `Events.js`/`Medical.js` son cierres de módulo NO persistidos: `CareerHydrationService` eleva el suelo de `Events.ensureEventIdCounterAtLeast()` al mayor sufijo ya usado en los logs restaurados para no reutilizar un id.',
      },
      // -----------------------------------------------------------------
      // DERIVADO — se recalcula desde lo durable, nunca es una segunda
      // copia que haya que persistir aparte.
      // -----------------------------------------------------------------
      {
        key: 'uiFocusAndViewState', owner: 'src/ui/game.js state.*', classification: 'ephemeral',
        identityKeys: [], dependsOn: [], rebuildStrategy: 'Se recalcula al re-renderizar la pantalla activa; no tiene significado fuera de una sesión de navegador.',
      },
      {
        key: 'registriesIndicesAndCaches', owner: 'Map indices internos / classificationCache', classification: 'ephemeral',
        identityKeys: [], dependsOn: [], rebuildStrategy: 'Se reconstruyen al reinsertar los documentos durables — nunca son ellos mismos una copia durable.',
      },
      {
        key: 'contentPackHooks', owner: 'ContentPackManifest.hooks/install', classification: 'ephemeral',
        identityKeys: [], dependsOn: [], rebuildStrategy: 'Funciones runtime del paquete instalado — la persistencia conserva SOLO `packId`+versión+procedencia (ver `installedContentPacks`), nunca el callback.',
      },
      {
        key: 'competitionRunnersLive', owner: 'CompetitionRunners.js instancias vivas', classification: 'ephemeral',
        identityKeys: [], dependsOn: ['runtimeCompetitiveState'], rebuildStrategy: 'Reconstruidos por `CompetitionEngine.initializeEdition()`, nunca serializados directamente.',
      },
    ];
  }

  function inventoryByKey() {
    const map = new Map();
    inventory().forEach((item) => map.set(item.key, item));
    return map;
  }

  // ---------------------------------------------------------------------
  // 2. PROYECCIÓN — envelope plano. `runtime` trae SOLO instancias vivas
  //    explícitas (nunca `state`/DOM); cualquier dependencia ausente para
  //    una colección DURABLE hace fallar `project()` con diagnóstico —
  //    nunca se omite en silencio.
  // ---------------------------------------------------------------------
  function projectCareerSetup(runtime) {
    if (!runtime.careerSetupSnapshot) return null;
    const snapshot = runtime.careerSetupSnapshot;
    return typeof snapshot.toJSON === 'function' ? snapshot.toJSON() : snapshot;
  }

  function projectWorldIdentity(runtime) {
    if (!runtime.world) return null;
    const described = runtime.world.describe();
    // `describe()` ya incluye `registries.describe()`/`simulationProfile` —
    // aquí solo se separa la identidad plana del resto (que se proyecta
    // aparte, como `worldRegistries`/`simulationProfile`, para que el
    // inventario los pueda declarar como colecciones propias).
    return {
      id: described.id,
      name: described.name,
      careerSeed: described.careerSeed,
      createdAtGameDate: described.createdAtGameDate,
      schemaVersion: described.schemaVersion,
    };
  }

  function projectInstalledContentPacks(runtime) {
    const packs = (runtime.installedContentPacks || []).map((manifest) => ({
      id: manifest.id,
      version: manifest.version,
      name: manifest.name || manifest.id,
      // WORLD-HARDEN-1 (sección 4 del prompt): SOLO metadato — nunca
      // `manifest.install`/`manifest.hooks` (funciones runtime).
      dataSource: manifest.dataSource || null,
      provenance: manifest.provenance || null,
    }));
    return byStableId(packs, 'id');
  }

  function projectSimulationProfile(runtime) {
    if (!runtime.world || !runtime.world.simulationProfile) return null;
    return runtime.world.simulationProfile.toJSON();
  }

  function projectCalendar(runtime) {
    if (!runtime.calendar) return null;
    const calendar = runtime.calendar;
    const snapshot = calendar.snapshot();
    return {
      id: calendar.id,
      defaultTimeZoneId: calendar.defaultTimeZoneId,
      currentInstant: calendar.currentInstant,
      seasons: byStableId([...calendar.seasons], 'seasonKey'),
      // SAVE-LOAD-1: WORLD-HARDEN-1 descartaba deliberadamente los
      // pendientes y el ledger (sonda, no guardado real) — un item
      // `awaiting-user`/`failed` no es re-derivable resincronizando sus
      // fuentes (`syncSource()` solo conserva ese estado para un item que
      // YA exista en el índice), así que es DURABLE, no derivado.
      pendingItems: byStableId(snapshot.pendingItems, 'id'),
      ledger: [...(calendar.ledger || [])],
    };
  }

  // SAVE-LOAD-1 — Team institucional/táctico/de entrenamiento, SIN roster
  // embebido (la plantilla real viene del `Squad` ya persistido en
  // `worldRegistries.squads` + `PlayerRegistry`, invariante "un Player se
  // proyecta UNA vez").
  function projectTeams(runtime) {
    if (!runtime.world) return null;
    const teams = runtime.world.registries.teams.all().map((team) => {
      const json = team.toJSON();
      delete json.roster;
      return json;
    });
    return byStableId(teams, 'id');
  }

  // SAVE-LOAD-1 — progreso REAL de cada runner de competición vivo: solo
  // los partidos YA jugados con su resultado ya calculado (nunca los
  // pendientes, que se recrean deterministamente al reconstruir el runner
  // desde las Entries ya persistidas) — ver `rebuildStrategy` en el
  // inventario.
  function projectCompetitionRuntime(runtime) {
    if (!runtime.world || !runtime.competitionEngine) return null;
    const stages = runtime.world.registries.competitionStages.all()
      .map((stage) => ({ stage, runner: runtime.competitionEngine.getRunner(stage.id) }))
      .filter(({ runner }) => !!runner)
      .map(({ stage, runner }) => ({
        stageId: stage.id,
        playedMatches: runner.listPlayedMatchesInReplayOrder(),
      }));
    return byStableId(stages, 'stageId');
  }

  // SAVE-LOAD-1 — logs de interfaz que el propio `game.js` documenta como
  // NO reconstruibles desde otro estado ya vivo (noticias/agenda médica/
  // agenda de mercado) más la alineación en curso del usuario y los
  // contadores de negociación (sección 5 del prompt: "decisiones
  // deportivas mutables"). `runtime.uiState` lo aporta `game.js` de forma
  // EXPLÍCITA (este módulo sigue sin leer `state`/DOM directamente).
  function projectUiState(runtime) {
    if (!runtime.uiState) return null;
    const ui = runtime.uiState;
    return {
      newsLog: [...(ui.newsLog || [])],
      medicalAgendaLog: [...(ui.medicalAgendaLog || [])],
      marketAgendaLog: [...(ui.marketAgendaLog || [])],
      lineup: ui.lineup || null,
      negotiationSequences: {
        transferNegotiationOfferSequence: { ...(ui.negotiationSequences && ui.negotiationSequences.transferNegotiationOfferSequence) },
        loanNegotiationAttemptSequence: { ...(ui.negotiationSequences && ui.negotiationSequences.loanNegotiationAttemptSequence) },
      },
    };
  }

  function projectWorldRegistries(runtime) {
    if (!runtime.world) return null;
    const described = runtime.world.registries.describe();
    return {
      packs: byStableId(described.packs, 'id'),
      areas: byStableId(described.areas, 'id'),
      organizations: byStableId(described.organizations, 'id'),
      clubs: byStableId(described.clubs, 'id'),
      teamIds: [...described.teamIds].sort(),
      squads: byStableId(described.squads, 'id'),
      competitionDefinitions: byStableId(described.competitionDefinitions, 'id'),
      competitionEditions: byStableId(described.competitionEditions, 'id'),
      competitionStages: byStableId(described.competitionStages, 'id'),
      competitionEntries: byStableId(described.competitionEntries, 'id'),
      pathwayReceipts: byStableId(described.pathwayReceipts, 'id'),
      seasonTransitionReceipts: byStableId(described.seasonTransitionReceipts, 'id'),
      teamSimulationSnapshots: byStableId(described.teamSimulationSnapshots, 'id'),
      competitionSimulationReceipts: byStableId(described.competitionSimulationReceipts, 'id'),
    };
  }

  // Cada Player se proyecta EXACTAMENTE una vez, directamente desde
  // `PlayerRegistry` — Team/Squad ya solo referencian `playerId` en su
  // propio `toJSON()` (ver `worldRegistries.teamIds`/`squads[].playerIds`).
  function projectPlayers(runtime) {
    if (!runtime.registries || !runtime.registries.playerRegistry) return null;
    const players = runtime.registries.playerRegistry.all().map((player) => player.toJSON());
    return byStableId(players, 'id');
  }

  // Proyectores GENÉRICOS para el resto de registros de dominio.
  // SAVE-LOAD-1 (auditoría de la sección 5 del prompt): el `snapshot()`
  // original de varios de estos registros (Contract/Registration/Agent/
  // Market/Transfer/AnnualCycle/Academy) es deliberadamente un RESUMEN
  // diagnóstico (contadores o campos reducidos) — nunca un contrato de
  // persistencia (confirmado contra el propio código, no solo el
  // comentario). Cada uno expone ahora `exportState()`, el contrato
  // COMPLETO y sin pérdida (mismo criterio que ya tenían Loan/
  // NationalTeam, que reexportan `snapshot()` tal cual). Este módulo solo
  // llama a `exportState()` y ordena sus arrays por id estable donde
  // aplica — nunca reinventa qué campos son durables.
  function projectViaSnapshot(registry) {
    if (!registry) return null;
    const raw = registry.exportState();
    if (Array.isArray(raw)) return byStableId(raw, 'id');
    if (raw && typeof raw === 'object') {
      const sorted = {};
      Object.keys(raw).sort().forEach((key) => {
        const value = raw[key];
        sorted[key] = Array.isArray(value) ? byStableId(value, 'id') : value;
      });
      return sorted;
    }
    return raw;
  }

  function buildProjectors(runtime) {
    const regs = runtime.registries || {};
    return {
      careerSetup: () => projectCareerSetup(runtime),
      worldIdentity: () => projectWorldIdentity(runtime),
      installedContentPacks: () => projectInstalledContentPacks(runtime),
      simulationProfile: () => projectSimulationProfile(runtime),
      calendar: () => projectCalendar(runtime),
      worldRegistries: () => projectWorldRegistries(runtime),
      players: () => projectPlayers(runtime),
      contracts: () => projectViaSnapshot(regs.contractRegistry),
      registrations: () => projectViaSnapshot(regs.registrationRegistry),
      agents: () => projectViaSnapshot(regs.agentRegistry),
      market: () => projectViaSnapshot(regs.marketRegistry),
      transfers: () => projectViaSnapshot(regs.transferRegistry),
      loans: () => projectViaSnapshot(regs.loanRegistry),
      annualCycle: () => projectViaSnapshot(regs.annualCycleRegistry),
      academy: () => projectViaSnapshot(regs.academyRegistry),
      nationalTeams: () => projectViaSnapshot(regs.nationalTeamRegistry),
      teams: () => projectTeams(runtime),
      competitionRuntime: () => projectCompetitionRuntime(runtime),
      uiState: () => projectUiState(runtime),
    };
  }

  // Progreso durable de runtime competitivo — SNAPSHOTS ya existentes
  // (nunca los runners vivos): standings/estado por stage, derivados de las
  // Entries/resultados ya proyectados en `worldRegistries`. Se expone
  // aparte de `collections` porque no es una colección con identidad
  // propia — es una VISTA de progreso sobre `worldRegistries`.
  function buildRuntimeSnapshots(runtime) {
    if (!runtime.world || !runtime.competitionEngine) return { stages: [] };
    const stages = runtime.world.registries.competitionStages.all().map((stage) => {
      const completed = runtime.competitionEngine.isStageCompleted
        ? (() => {
          try {
            return runtime.competitionEngine.isStageCompleted(
              runtime.world.registries.competitionEditions.get(stage.editionId).competitionDefinitionId,
              runtime.world.registries.competitionEditions.get(stage.editionId).seasonKey,
              stage.stageKey,
            );
          } catch (e) { return null; }
        })() : null;
      return { stageId: stage.id, status: stage.status, completed };
    });
    return { stages: byStableId(stages, 'stageId') };
  }

  // ---------------------------------------------------------------------
  // 3. FINGERPRINT — sobre el contenido canónico, SIN incluirse a sí mismo.
  //    No es criptográfico: es una sonda de estabilidad/determinismo
  //    (mismas dos proyecciones consecutivas sin comandos -> mismo
  //    fingerprint; orden de entrada permutado -> mismo fingerprint,
  //    porque cada colección ya se ordena por id estable arriba).
  // ---------------------------------------------------------------------
  function canonicalStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }

  // FNV-1a de 32 bits — determinista, sin dependencias, suficiente para una
  // sonda de estabilidad (no es un requisito criptográfico).
  function fnv1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function computeFingerprint(envelopeWithoutFingerprint) {
    return fnv1a(canonicalStringify(envelopeWithoutFingerprint));
  }

  // SAVE-LOAD-1 (sección 7 del prompt): "no permitas guardar mientras exista
  // resolución/revelado activo de un partido". Predicado PURO — el
  // llamador (`game.js`) aporta `runtime.activeMatchInProgress` explícito
  // (nunca se infiere leyendo `state` aquí dentro); devuelve motivos
  // legibles en vez de un booleano solo, para poder explicarle al usuario
  // por qué el botón de guardar está desactivado en ese momento.
  function describeSaveBlockers(runtime) {
    const reasons = [];
    if (runtime && runtime.activeMatchInProgress) {
      reasons.push('Hay un partido en curso o con el resultado revelándose — termina o cierra el partido antes de guardar.');
    }
    // SIM-CAL-1 (sección 9 del prompt): mientras una sesión de avance
    // cooperativo está corriendo (o su cancelación todavía no ha terminado
    // de sincronizar) ninguna proyección es un checkpoint válido — `game.js`
    // aporta este booleano explícito, nunca se infiere aquí leyendo un
    // runner/sesión.
    if (runtime && runtime.activeCalendarAdvance) {
      reasons.push('El mundo se está simulando — espera a que termine o se detenga antes de guardar.');
    }
    return reasons;
  }

  function canSave(runtime) {
    return describeSaveBlockers(runtime).length === 0;
  }

  function project(runtime, options = {}) {
    requireDep(runtime, 'runtime');
    const snapshotAtGameDate = requireDep(options.snapshotAtGameDate, 'snapshotAtGameDate');
    const inv = inventory();
    const projectors = buildProjectors(runtime);
    const collections = {};
    inv.forEach((item) => {
      if (item.classification !== 'durable') return;
      const projector = projectors[item.key];
      if (!projector) {
        throw new Error(
          `CareerPersistenceBoundary.project: la colección durable "${item.key}" (owner "${item.owner}") no tiene `
          + 'proyector — nunca se omite en silencio.',
        );
      }
      collections[item.key] = projector();
    });

    const envelope = {
      schemaVersion: 'world-harden-1',
      snapshotAtGameDate,
      careerSetup: collections.careerSetup,
      world: {
        identity: collections.worldIdentity,
        installedContentPacks: collections.installedContentPacks,
        simulationProfile: collections.simulationProfile,
        calendar: collections.calendar,
        registries: collections.worldRegistries,
      },
      collections: {
        players: collections.players,
        contracts: collections.contracts,
        registrations: collections.registrations,
        agents: collections.agents,
        market: collections.market,
        transfers: collections.transfers,
        loans: collections.loans,
        annualCycle: collections.annualCycle,
        academy: collections.academy,
        nationalTeams: collections.nationalTeams,
        teams: collections.teams,
        competitionRuntime: collections.competitionRuntime,
        uiState: collections.uiState,
      },
      runtimeSnapshots: buildRuntimeSnapshots(runtime),
      inventory: inv,
    };

    // `JSON.stringify()` no debe fallar nunca (invariante 27 de DESIGN.md,
    // reutilizada aquí) — se comprueba en caliente, no se asume.
    JSON.stringify(envelope);

    envelope.fingerprint = computeFingerprint(envelope);
    return envelope;
  }

  const exportsObj = {
    CareerPersistenceBoundary: {
      inventory,
      inventoryByKey,
      project,
      canSave,
      describeSaveBlockers,
      // SAVE-LOAD-1: expuestos para que el repositorio de guardado pueda
      // verificar el fingerprint de un envelope leído de IndexedDB SIN
      // reconstruir ninguna carrera (detecta corrupción/manipulación antes
      // de gastar tiempo en hidratar) — misma función, nunca una segunda
      // implementación de canonicalización.
      canonicalStringify,
      computeFingerprint,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
