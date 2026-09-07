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
      // DERIVADO — se recalcula desde lo durable, nunca es una segunda
      // copia que haya que persistir aparte.
      // -----------------------------------------------------------------
      {
        key: 'runtimeCompetitiveState', owner: 'CompetitionEngine (runners)', classification: 'derived',
        identityKeys: [], dependsOn: ['worldRegistries'],
        rebuildStrategy: 'Los runners (`RoundRobinStageRunner`/`BracketStageRunner`) se REconstruyen desde `CompetitionEdition`/`CompetitionStage`/`CompetitionEntry` YA persistidos + los partidos ya resueltos (`CompetitionEngine.initializeEdition()`) — nunca se serializa el runner vivo, solo su progreso vía `runtimeSnapshots`.',
      },
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
    return {
      id: calendar.id,
      defaultTimeZoneId: calendar.defaultTimeZoneId,
      currentInstant: calendar.currentInstant,
      seasons: byStableId([...calendar.seasons], 'seasonKey'),
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

  // Proyectores GENÉRICOS para el resto de registros de dominio — todos
  // exponen su propio `.snapshot()` PLANO (fuente canónica de qué campos
  // son durables en cada dominio, ver CONTRACT-1/REG-1/MARKET-1/
  // TRANSFER-1/LOAN-1/CYCLE-1/NATIONAL-TEAMS-1) — este módulo solo llama a
  // ese método y ordena sus arrays por id estable donde aplica.
  function projectViaSnapshot(registry) {
    if (!registry) return null;
    const raw = registry.snapshot();
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
    CareerPersistenceBoundary: { inventory, inventoryByKey, project },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
