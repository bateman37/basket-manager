// src/core/CareerSetupService.js
// WORLD-UI-1 (DESIGN.md 10.18) — servicio PURO de configuración de carrera:
// sin DOM, sin `state` global, sin construir ninguna instancia de
// `Team`/`Player` (esa construcción solo ocurre DESPUÉS de pulsar "Comenzar
// carrera", en `src/ui/game.js`). Lee metadatos PLANOS `careerSetup` que
// cada paquete de contenido declara (`data/world/*.js`) — nunca decide con
// literales de ningún país, liga o división concretos por sí mismo
// (auditado en `scripts/test-world-ui1.js`). Convención del proyecto:
// identificadores en inglés, comentarios en español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const ContentPackRegistryModule = dep('./ContentPackRegistry.js');
  const WorldSimulationModule = dep('../entities/WorldSimulation.js');
  const CareerSetupModule = dep('../entities/CareerSetup.js');

  function errorEntry(code, message, field) {
    return { code, message, field: field || null };
  }

  // Cierre de dependencias de los paquetes elegidos — reutiliza EXACTAMENTE
  // el mismo algoritmo que `WorldFactory.installContentPacks()` usará
  // después (`ContentPackRegistry.computeInstallOrder`), nunca una segunda
  // comprobación de dependencias que pudiera desincronizarse de esa.
  function computeInstallOrderSafe(manifests) {
    const registry = new ContentPackRegistryModule.ContentPackRegistry();
    try {
      return { order: registry.computeInstallOrder(manifests), error: null };
    } catch (err) {
      return { order: null, error: err.message };
    }
  }

  // ---------------------------------------------------------------------
  // Catálogo — construido SOLO desde metadatos planos (`manifest.careerSetup`)
  // y el `CompetitionCatalog` de identidad — nunca desde un índice crudo de
  // jugadores (invariante 5: "configurar/renderizar no construye Team/
  // Player, no rellena rosters, no consume RNG").
  // ---------------------------------------------------------------------
  function buildCatalog(manifests, competitionCatalog) {
    const packs = manifests.map((manifest) => ({
      id: manifest.id,
      name: manifest.name || manifest.id,
      version: manifest.version,
      dependencies: (manifest.dependencies || []).map((d) => (typeof d === 'string' ? d : d.id)),
      isRootRequired: Boolean(manifest.careerSetup && manifest.careerSetup.isRootRequired),
      hasCareerSetupContent: Boolean(manifest.careerSetup),
    }));

    const seasonsById = new Map();
    const timeZonesById = new Map();
    const competitionsById = new Map();
    const clubsById = new Map();

    manifests.forEach((manifest) => {
      const setup = manifest.careerSetup;
      if (!setup) return;
      (setup.seasons || []).forEach((season) => {
        seasonsById.set(season.seasonKey, {
          seasonKey: season.seasonKey,
          seasonStartYear: season.seasonStartYear,
          isDefault: Boolean(season.isDefault),
          packId: manifest.id,
        });
      });
      (setup.timeZones || []).forEach((tz) => {
        timeZonesById.set(tz.timeZoneId, {
          timeZoneId: tz.timeZoneId,
          isDefault: Boolean(tz.isDefault),
          packId: manifest.id,
        });
      });
      (setup.competitions || []).forEach((competition) => {
        const definition = competitionCatalog.getCompetitionDefinition(competition.competitionDefinitionId);
        competitionsById.set(competition.competitionDefinitionId, {
          competitionDefinitionId: competition.competitionDefinitionId,
          name: definition.name,
          shortName: definition.shortName,
          implementationStatus: definition.implementationStatus,
          recommendedDetailLevel: competition.recommendedDetailLevel || null,
          // `catalog-only` (invariante 9: nunca gana Edition/controles
          // falsos) declara "sin niveles seleccionables" — se ve deshabilitada
          // y explicada en la pantalla de configuración, nunca ejecutable.
          allowedDetailLevels: competition.recommendedDetailLevel
            ? [...(competition.allowedDetailLevels || [competition.recommendedDetailLevel])]
            : [],
          packId: manifest.id,
        });
      });
      (setup.clubs || []).forEach((club) => {
        clubsById.set(club.clubId, {
          clubId: club.clubId,
          teamId: club.teamId,
          name: club.name,
          city: club.city,
          rosterSize: club.rosterSize,
          dataCoverage: club.dataCoverage || 'unknown',
          initialCompetitionDefinitionId: club.initialCompetitionDefinitionId,
          packId: manifest.id,
        });
      });
    });

    return {
      packs,
      seasons: [...seasonsById.values()].sort((a, b) => (a.seasonKey < b.seasonKey ? -1 : (a.seasonKey > b.seasonKey ? 1 : 0))),
      timeZones: [...timeZonesById.values()].sort((a, b) => (a.timeZoneId < b.timeZoneId ? -1 : (a.timeZoneId > b.timeZoneId ? 1 : 0))),
      competitions: [...competitionsById.values()].sort((a, b) => (a.competitionDefinitionId < b.competitionDefinitionId ? -1 : (a.competitionDefinitionId > b.competitionDefinitionId ? 1 : 0))),
      clubs: [...clubsById.values()].sort((a, b) => (a.clubId < b.clubId ? -1 : (a.clubId > b.clubId ? 1 : 0))),
    };
  }

  // ---------------------------------------------------------------------
  // Borrador por defecto — MUTABLE mientras el usuario configura, deja de
  // ser autoridad en cuanto se construye el snapshot (sección 3.1 del
  // prompt). `referenceDate`/`careerSeed` llegan EXPLÍCITOS de quien llama
  // (nunca `new Date()`/RNG propios aquí dentro).
  // ---------------------------------------------------------------------
  function buildDefaultDraft(catalog, { referenceDate, careerSeed } = {}) {
    const rootPacks = catalog.packs.filter((p) => p.isRootRequired).map((p) => p.id);
    const selectablePacks = catalog.packs.filter((p) => p.hasCareerSetupContent && !p.isRootRequired).map((p) => p.id);
    const defaultSeason = catalog.seasons.find((s) => s.isDefault) || catalog.seasons[0] || null;
    const defaultTimeZone = catalog.timeZones.find((t) => t.isDefault) || catalog.timeZones[0] || null;
    const competitionSelections = {};
    catalog.competitions.forEach((c) => {
      // Competiciones `catalog-only` (sin `recommendedDetailLevel`) nunca
      // reciben una selección de nivel — invariante 9.
      if (!c.recommendedDetailLevel) return;
      competitionSelections[c.competitionDefinitionId] = c.recommendedDetailLevel;
    });

    return {
      selectedContentPackIds: [...rootPacks, ...selectablePacks],
      seasonKey: defaultSeason ? defaultSeason.seasonKey : null,
      seasonStartYear: defaultSeason ? defaultSeason.seasonStartYear : null,
      timeZoneId: defaultTimeZone ? defaultTimeZone.timeZoneId : null,
      defaultDetailLevel: 'abstract',
      competitionSelections,
      controlledClubId: null,
      controlledTeamId: null,
      careerSeed: careerSeed || null,
      createdAtGameDate: referenceDate || null,
    };
  }

  // Destinos alcanzables desde la competición ACTUAL de un club vía
  // pathway declarativo (sección 3.2 del prompt: "la competición actual del
  // club y destinos alcanzables por pathways deben permitir paradas de
  // usuario"). Alcance de esta entrega (documentado, no fabricado): solo
  // comprueba la competición inicial declarada — un grafo completo de
  // pathways multi-temporada queda para una entrega futura si hiciera
  // falta ampliarlo.
  function competitionAllowsUserStop(catalog, competitionDefinitionId, competitionSelections, defaultDetailLevel) {
    const declared = catalog.competitions.find((c) => c.competitionDefinitionId === competitionDefinitionId);
    if (!declared) return false;
    const chosenLevel = competitionSelections[competitionDefinitionId] || defaultDetailLevel;
    return WorldSimulationModule.capabilitiesForDetailLevel(chosenLevel).allowsUserMatchStop;
  }

  // ---------------------------------------------------------------------
  // Validación — nunca corrige en silencio, siempre códigos + mensajes
  // cualitativos (sección 3.2 del prompt).
  // ---------------------------------------------------------------------
  function validateDraft(catalog, manifestsById, draft) {
    const errors = [];
    const selectedIds = Array.isArray(draft.selectedContentPackIds) ? draft.selectedContentPackIds : [];

    const rootPacks = catalog.packs.filter((p) => p.isRootRequired);
    rootPacks.forEach((root) => {
      if (!selectedIds.includes(root.id)) {
        errors.push(errorEntry('MISSING_ROOT_PACK', `Falta el paquete raíz obligatorio "${root.name}".`, 'selectedContentPackIds'));
      }
    });

    const unknownPackId = selectedIds.find((id) => !manifestsById.has(id));
    if (unknownPackId) {
      errors.push(errorEntry('UNKNOWN_PACK', `El paquete "${unknownPackId}" no está disponible.`, 'selectedContentPackIds'));
    } else if (selectedIds.length) {
      const { error } = computeInstallOrderSafe(selectedIds.map((id) => manifestsById.get(id)));
      if (error) errors.push(errorEntry('MISSING_DEPENDENCY', error, 'selectedContentPackIds'));
    }

    if (!draft.seasonKey || !catalog.seasons.some((s) => s.seasonKey === draft.seasonKey)) {
      errors.push(errorEntry('UNKNOWN_SEASON', `La temporada "${draft.seasonKey}" no está disponible en los paquetes elegidos.`, 'seasonKey'));
    }
    if (!Number.isInteger(draft.seasonStartYear)) {
      errors.push(errorEntry('MISSING_SEASON_START_YEAR', 'Falta el año de inicio de temporada explícito.', 'seasonStartYear'));
    }
    if (!draft.timeZoneId || !catalog.timeZones.some((t) => t.timeZoneId === draft.timeZoneId)) {
      errors.push(errorEntry('UNKNOWN_TIME_ZONE', `El huso horario "${draft.timeZoneId}" no está disponible en los paquetes elegidos.`, 'timeZoneId'));
    }
    if (!WorldSimulationModule.DETAIL_LEVELS.includes(draft.defaultDetailLevel)) {
      errors.push(errorEntry('UNKNOWN_DETAIL_LEVEL', `El nivel de detalle por defecto "${draft.defaultDetailLevel}" no es válido.`, 'defaultDetailLevel'));
    }

    const competitionSelections = draft.competitionSelections || {};
    Object.keys(competitionSelections).forEach((competitionDefinitionId) => {
      const declared = catalog.competitions.find((c) => c.competitionDefinitionId === competitionDefinitionId);
      if (!declared) {
        errors.push(errorEntry('UNKNOWN_COMPETITION', `La competición "${competitionDefinitionId}" no está disponible en los paquetes elegidos.`, 'competitionSelections'));
        return;
      }
      const level = competitionSelections[competitionDefinitionId];
      if (!WorldSimulationModule.DETAIL_LEVELS.includes(level)) {
        errors.push(errorEntry('UNKNOWN_DETAIL_LEVEL', `Nivel de detalle "${level}" no válido para "${declared.name}".`, 'competitionSelections'));
      } else if (!declared.allowedDetailLevels.includes(level)) {
        errors.push(errorEntry(
          'DETAIL_LEVEL_NOT_ALLOWED',
          `"${declared.name}" no admite el nivel de detalle "${level}" — niveles permitidos: ${declared.allowedDetailLevels.join(', ')}.`,
          'competitionSelections',
        ));
      }
    });

    if (!draft.controlledClubId || !draft.controlledTeamId) {
      errors.push(errorEntry('MISSING_CONTROLLED_CLUB', 'Elige un club para controlar antes de comenzar.', 'controlledClubId'));
    } else {
      const club = catalog.clubs.find((c) => c.clubId === draft.controlledClubId && c.teamId === draft.controlledTeamId);
      if (!club) {
        errors.push(errorEntry('UNKNOWN_CLUB', `El club "${draft.controlledClubId}" no está disponible en los paquetes elegidos.`, 'controlledClubId'));
      } else if (!errors.length) {
        // Invariante 10: un club controlado no puede quedar en una
        // competición sin `allowsUserMatchStop` actual — bloquea "Comenzar"
        // y explica QUÉ competición debería ser jugable, nunca eleva el
        // nivel a escondidas.
        const allowsStop = competitionAllowsUserStop(
          catalog, club.initialCompetitionDefinitionId, competitionSelections, draft.defaultDetailLevel,
        );
        if (!allowsStop) {
          const declared = catalog.competitions.find((c) => c.competitionDefinitionId === club.initialCompetitionDefinitionId);
          const label = declared ? declared.name : club.initialCompetitionDefinitionId;
          errors.push(errorEntry(
            'CONTROLLED_CLUB_WITHOUT_USER_STOP',
            `"${label}" debe ser "playable" para poder controlar a ${club.name} — ajusta su nivel de detalle.`,
            'competitionSelections',
          ));
        }
      }
    }

    if (!draft.careerSeed) {
      errors.push(errorEntry('MISSING_CAREER_SEED', 'Falta la semilla de carrera explícita.', 'careerSeed'));
    }
    if (!draft.createdAtGameDate) {
      errors.push(errorEntry('MISSING_CREATED_AT_GAME_DATE', 'Falta la fecha de creación de la carrera explícita.', 'createdAtGameDate'));
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------
  // Producción de snapshot / perfil / plan — solo tras validar completo.
  // ---------------------------------------------------------------------
  function buildSnapshot(catalog, manifestsById, draft, { idFactory }) {
    const { valid, errors } = validateDraft(catalog, manifestsById, draft);
    if (!valid) {
      throw new Error(`CareerSetupService.buildSnapshot: borrador inválido — ${errors.map((e) => `[${e.code}] ${e.message}`).join(' / ')}`);
    }
    const simulationAssignments = Object.keys(draft.competitionSelections || {}).map((competitionDefinitionId) => ({
      scopeType: 'competition',
      scopeId: competitionDefinitionId,
      detailLevel: draft.competitionSelections[competitionDefinitionId],
    }));
    return new CareerSetupModule.CareerSetupSnapshot({
      id: idFactory(draft),
      seasonKey: draft.seasonKey,
      seasonStartYear: draft.seasonStartYear,
      timeZoneId: draft.timeZoneId,
      selectedContentPackIds: draft.selectedContentPackIds,
      controlledClubId: draft.controlledClubId,
      controlledTeamId: draft.controlledTeamId,
      careerSeed: draft.careerSeed,
      defaultDetailLevel: draft.defaultDetailLevel,
      simulationAssignments,
      createdAtGameDate: draft.createdAtGameDate,
      provenance: { status: 'design', notes: 'CareerSetupService.buildSnapshot (WORLD-UI-1).' },
    });
  }

  // El perfil de simulación se DERIVA del snapshot — nunca una segunda
  // preferencia editable ni una copia manual en `game.js` (sección 3.1).
  function buildSimulationProfile(snapshot) {
    return new WorldSimulationModule.WorldSimulationProfile({
      id: `simulation-profile:${snapshot.id}`,
      version: snapshot.schemaVersion,
      selectedAtGameDate: snapshot.createdAtGameDate,
      defaultDetailLevel: snapshot.defaultDetailLevel,
      assignments: snapshot.simulationAssignments,
      provenance: { status: 'design', notes: 'Derivado de CareerSetupSnapshot (WORLD-UI-1).' },
    });
  }

  // Plan de arranque — manifiestos YA RESUELTOS (nunca ids sueltos que
  // `game.js` tendría que volver a mapear) en el orden de dependencias real.
  function buildStartPlan(snapshot, manifestsById) {
    const manifests = snapshot.selectedContentPackIds.map((id) => {
      const manifest = manifestsById.get(id);
      if (!manifest) throw new Error(`CareerSetupService.buildStartPlan: paquete desconocido "${id}".`);
      return manifest;
    });
    const { order, error } = computeInstallOrderSafe(manifests);
    if (error) throw new Error(`CareerSetupService.buildStartPlan: ${error}`);
    return {
      packs: order,
      seasonKey: snapshot.seasonKey,
      seasonStartYear: snapshot.seasonStartYear,
      timeZoneId: snapshot.timeZoneId,
      controlledClubId: snapshot.controlledClubId,
      controlledTeamId: snapshot.controlledTeamId,
      careerSeed: snapshot.careerSeed,
      createdAtGameDate: snapshot.createdAtGameDate,
    };
  }

  const exportsObj = {
    buildCatalog,
    buildDefaultDraft,
    validateDraft,
    buildSnapshot,
    buildSimulationProfile,
    buildStartPlan,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
