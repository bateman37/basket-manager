// src/core/WorldNavigationService.js
// WORLD-UI-1 (DESIGN.md 10.18) — proyector PURO de solo lectura sobre
// `GameWorld`/`WorldRegistries`/`CompetitionEngine`/`WorldCalendar`: nunca
// muta ningún registro, nunca construye `Team`/`Player`, nunca consume
// aleatoriedad. Devuelve SIEMPRE view models planos (objetos/arrays/
// strings/números/booleanos) — nunca HTML ni instancias vivas; `game.js` es
// quien decide cómo pintarlos. Toda navegación se resuelve por ids
// canónicos (`AreaRegistry`/`OrganizationRegistry`/`ClubRegistry`/
// `CompetitionDefinitionRegistry`/...), nunca por nombre visible ni por
// `division`. Convención del proyecto: identificadores en inglés,
// comentarios en español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const WorldSimulationModule = dep('../entities/WorldSimulation.js');

  function byName(a, b) {
    const nameA = a.name || a.id;
    const nameB = b.name || b.id;
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  function areaViewModel(area) {
    return {
      areaId: area.id, name: area.name, shortName: area.shortName, type: area.type, isoCode: area.isoCode,
    };
  }

  function organizationViewModel(org) {
    return {
      organizationId: org.id,
      name: org.name,
      type: org.type,
      headquartersAreaId: org.headquartersAreaId,
      scopeAreaId: org.scopeAreaId,
      parentOrganizationId: org.parentOrganizationId,
    };
  }

  function clubViewModel(registries, club) {
    const primaryTeam = club.primaryTeamId ? registries.teams.get(club.primaryTeamId) : null;
    return {
      clubId: club.id,
      name: club.name,
      shortName: club.shortName,
      homeAreaId: club.homeAreaId,
      employerJurisdictionAreaId: club.employerJurisdictionAreaId,
      primaryTeamId: club.primaryTeamId,
      primaryTeamName: primaryTeam ? (primaryTeam.fullName || primaryTeam.name) : null,
    };
  }

  function competitionDefinitionViewModel(definition) {
    return {
      competitionDefinitionId: definition.id,
      name: definition.name,
      shortName: definition.shortName,
      scopeLevel: definition.scopeLevel,
      scopeAreaId: definition.scopeAreaId,
      organizerId: definition.organizerId,
      participantType: definition.participantType,
      kind: definition.kind,
      implementationStatus: definition.implementationStatus,
    };
  }

  // ---------------------------------------------------------------------
  // Jerarquía de áreas
  // ---------------------------------------------------------------------

  // Breadcrumb de la raíz al área dada (invariante 12: orden estable).
  function breadcrumbForArea(registries, areaId) {
    const chain = [];
    let cursor = registries.areas.require(areaId);
    const seen = new Set();
    while (cursor) {
      if (seen.has(cursor.id)) break;
      seen.add(cursor.id);
      chain.unshift(areaViewModel(cursor));
      cursor = cursor.parentAreaId ? registries.areas.get(cursor.parentAreaId) : null;
    }
    return chain;
  }

  function childrenOfArea(registries, areaId) {
    registries.areas.require(areaId);
    return registries.areas.all()
      .filter((area) => area.parentAreaId === areaId)
      .map(areaViewModel)
      .sort(byName);
  }

  // Organizaciones con SEDE en el área frente a con ÁMBITO en el área —
  // relaciones DISTINTAS (sección 10.3 del prompt de WORLD-CORE-1, 10.2
  // DESIGN.md), nunca colapsadas en una sola lista.
  function organizationsForArea(registries, areaId) {
    registries.areas.require(areaId);
    const headquartered = registries.organizations.all()
      .filter((org) => org.headquartersAreaId === areaId).map(organizationViewModel).sort(byName);
    const scoped = registries.organizations.all()
      .filter((org) => org.scopeAreaId === areaId).map(organizationViewModel).sort(byName);
    return { headquartered, scoped };
  }

  function clubsForArea(registries, areaId) {
    registries.areas.require(areaId);
    return registries.clubs.all()
      .filter((club) => club.homeAreaId === areaId)
      .map((club) => clubViewModel(registries, club))
      .sort(byName);
  }

  // Competiciones cuyo `scopeAreaId` ES esta área — invariante 4: una
  // competición conserva un único `scopeAreaId`, la participación de un
  // club de otra área nunca lo cambia.
  function competitionsForArea(registries, areaId) {
    registries.areas.require(areaId);
    return registries.competitionDefinitions.all()
      .filter((definition) => definition.scopeAreaId === areaId)
      .map(competitionDefinitionViewModel)
      .sort(byName);
  }

  // Competiciones EXTERNAS (scopeAreaId distinto) en las que participa un
  // equipo de un club LOCAL de esta área — ej. un club de un territorio
  // fronterizo que compite en la liga del país vecino. Nunca convierte la
  // competición en "de esta área" (su `scopeAreaId` real no cambia).
  function externalCompetitionsForAreaClubs(registries, areaId) {
    registries.areas.require(areaId);
    const localTeamIds = new Set(
      registries.clubs.all()
        .filter((club) => club.homeAreaId === areaId)
        .flatMap((club) => registries.teams.forClub(club.id).map((team) => team.id)),
    );
    const byDefinition = new Map();
    registries.competitionEntries.all().forEach((entry) => {
      if (!localTeamIds.has(entry.participantId)) return;
      const edition = registries.competitionEditions.get(entry.editionId);
      if (!edition) return;
      const definition = registries.competitionDefinitions.get(edition.competitionDefinitionId);
      if (!definition || definition.scopeAreaId === areaId) return;
      if (!byDefinition.has(definition.id)) {
        byDefinition.set(definition.id, { definition, teamIds: new Set() });
      }
      byDefinition.get(definition.id).teamIds.add(entry.participantId);
    });
    return [...byDefinition.values()]
      .map(({ definition, teamIds }) => ({
        ...competitionDefinitionViewModel(definition),
        localParticipantTeamIds: [...teamIds].sort(),
      }))
      .sort(byName);
  }

  // ---------------------------------------------------------------------
  // Vista de una competición: identidad + edición vigente + fases +
  // participantes + resultado disponible por tipo.
  // ---------------------------------------------------------------------
  function editionViewModel(edition) {
    return {
      editionId: edition.id,
      seasonKey: edition.seasonKey,
      status: edition.status,
      detailLevel: edition.detailLevel,
      startDate: edition.startDate,
      endDate: edition.endDate,
    };
  }

  function stageViewModel(stage) {
    return {
      stageId: stage.id,
      stageKey: stage.stageKey,
      name: stage.name,
      sequence: stage.sequence,
      stageType: stage.stageType,
      status: stage.status,
    };
  }

  // Resultado disponible de un stage — nunca confunde AUSENCIA de detalle
  // (nivel `standard`/`abstract`) con datos a cero (invariante 15). Envuelto
  // en try/catch: un stage sin runner vivo todavía (recién declarado, sin
  // activar) debe leerse como "not-available", nunca lanzar hacia la UI.
  function resultViewForStage(engine, definition, edition, stage) {
    if (!engine || !edition || !stage) return { kind: 'not-available' };
    const capabilities = WorldSimulationModule.capabilitiesForDetailLevel(edition.detailLevel);
    try {
      const isCompleted = engine.isStageCompleted(definition.id, edition.seasonKey, stage.stageKey);
      if (stage.stageType === 'round-robin' || stage.stageType === 'group') {
        const standings = engine.getStandingsFacts(definition.id, edition.seasonKey, stage.stageKey);
        if (!standings || !standings.length) return { kind: 'not-available' };
        return {
          kind: capabilities.hasIndividualMatchDetail ? 'standings' : 'standings-compact',
          standings,
          isCompleted: Boolean(isCompleted),
        };
      }
      const champion = engine.getBracketChampion(definition.id, edition.seasonKey, stage.stageKey);
      const finalRoundWinners = engine.getBracketFinalRoundWinners(definition.id, edition.seasonKey, stage.stageKey);
      if (!champion && (!finalRoundWinners || !finalRoundWinners.length)) return { kind: 'not-available' };
      return {
        kind: capabilities.hasIndividualMatchDetail ? 'bracket' : 'bracket-compact',
        champion: champion || null,
        finalRoundWinners: finalRoundWinners || [],
        isCompleted: Boolean(isCompleted),
      };
    } catch (err) {
      return { kind: 'not-available' };
    }
  }

  // `engine`/`seasonKey` opcionales: sin ellos (competición `catalog-only`
  // o mundo sin engine todavía) la vista sigue siendo honesta — nunca
  // fabrica una Edition/participantes falsos (invariante 9).
  function competitionView(registries, competitionDefinitionId, { engine, seasonKey } = {}) {
    const definition = registries.competitionDefinitions.require(competitionDefinitionId);
    if (definition.implementationStatus === 'catalog-only') {
      return {
        ...competitionDefinitionViewModel(definition),
        organizer: organizationViewModel(registries.organizations.require(definition.organizerId)),
        edition: null,
        stages: [],
        participants: [],
        catalogOnly: true,
      };
    }
    const editions = registries.competitionEditions.forDefinition(competitionDefinitionId)
      .filter((edition) => !seasonKey || edition.seasonKey === seasonKey)
      .sort((a, b) => (a.seasonKey < b.seasonKey ? 1 : (a.seasonKey > b.seasonKey ? -1 : 0)));
    const edition = editions[0] || null;
    let stages = [];
    let participants = [];
    if (edition) {
      stages = registries.competitionStages.forEdition(edition.id)
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((stage) => ({
          ...stageViewModel(stage),
          result: resultViewForStage(engine, definition, edition, stage),
        }));
      participants = registries.competitionEntries.forEdition(edition.id)
        .map((entry) => {
          const team = registries.teams.get(entry.participantId);
          return {
            participantId: entry.participantId,
            name: team ? (team.fullName || team.name) : entry.participantId,
            seed: entry.seed,
            entryStatus: entry.entryStatus,
          };
        })
        .sort((a, b) => (a.seed || Number.MAX_SAFE_INTEGER) - (b.seed || Number.MAX_SAFE_INTEGER) || byName(a, b));
    }
    return {
      ...competitionDefinitionViewModel(definition),
      organizer: organizationViewModel(registries.organizations.require(definition.organizerId)),
      edition: edition ? editionViewModel(edition) : null,
      stages,
      participants,
      catalogOnly: false,
    };
  }

  const exportsObj = {
    breadcrumbForArea,
    childrenOfArea,
    organizationsForArea,
    clubsForArea,
    competitionsForArea,
    externalCompetitionsForAreaClubs,
    competitionView,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
