// src/core/SpainLegacyCompetitionRuntime.js
// WORLD-CORE-1 (sección 8.2 del prompt) — adaptador de compatibilidad
// EXPLÍCITAMENTE aislado: enlaza el runtime fijo español (`League`/
// `Bracket`/`Cup`/`Playoffs`/`Promotion`, sin tocarlos) con su
// `CompetitionEdition`/`CompetitionStage`/`CompetitionEntry` canónicos.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Este archivo, junto con `data/world/spain-2026.1.js`, es uno de los DOS
// sitios permitidos para literales de España ('1ª'/'2ª'/ACB/Primera FEB)
// fuera del catálogo de identidad (`CompetitionCatalog.js`, que los conserva
// por continuidad — ver DESIGN.md, migración legacy). Ningún archivo mundial
// GENÉRICO nuevo (`Geography.js`, `Organization.js`, `Club.js`,
// `Competition.js`, `World.js`, `WorldRegistry.js`, `ContentPackRegistry.js`,
// `WorldFactory.js`) puede contenerlos — auditado en `scripts/test-world-core1.js`.
//
// Destino de eliminación explícito (invariante de deuda, DESIGN.md): este
// adaptador desaparece cuando COMP-CORE-1 (motor genérico de
// `CompetitionEdition -> Stage -> Entry`) y WORLD-CALENDAR-1 (calendario
// mundial único) sustituyan a `League`/`Bracket`/`Cup`/`Playoffs`/
// `Promotion` por un runner genérico. Hasta entonces:
//  - NO registra ninguna regla normativa nueva (eso sigue en
//    `CompetitionRules.js`);
//  - NO se usa desde ningún paquete que no sea `spain-2026.1`;
//  - SOLO crea identidad (edición/stage/entry) y enlaza `runtimeBinding`
//    (transitorio, excluido de cualquier snapshot — ver `Competition.js`).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const CompetitionEntitiesModule = isNode ? require('../entities/Competition.js') : global.BasketManager;
  const CompetitionCatalogModule = isNode ? require('./CompetitionCatalog.js') : global.BasketManager;

  function Entities() { return CompetitionEntitiesModule; }
  function Catalog() { return CompetitionCatalogModule; }

  // Único adaptador de frontera de ESTE archivo — deliberadamente propio
  // (no importa `CompetitionRules.competitionIdFromLegacyDivision`, para no
  // acoplar el módulo de REGLAS al de identidad/runtime): mismo criterio
  // (nunca asume ACB por defecto), mismo literal '1ª'/'2ª' que ya usa el
  // resto del runtime español.
  function competitionIdForDivision(division) {
    if (division === '1ª') return Catalog().COMPETITION_IDS.ACB;
    if (division === '2ª') return Catalog().COMPETITION_IDS.PRIMERA_FEB;
    throw new Error(`SpainLegacyCompetitionRuntime: división legacy desconocida "${division}".`);
  }

  function editionId(competitionId, seasonKey) { return `edition:${competitionId}:${seasonKey}`; }
  function stageId(competitionId, seasonKey, stageKey) { return `stage:${competitionId}:${seasonKey}:${stageKey}`; }
  function entryId(competitionId, seasonKey, stageKey, participantId) {
    return `entry:${competitionId}:${seasonKey}:${stageKey}:${participantId}`;
  }

  function regularSeasonStageId(competitionId, seasonKey) { return stageId(competitionId, seasonKey, 'regular-season'); }

  // Marca 'completed' cualquier edición/stage previamente ACTIVOS de esa
  // competición — se llama antes de abrir la edición de una temporada
  // nueva (`rebindNewSeason`), nunca los borra (mismo criterio que el resto
  // del proyecto: nada desaparece, todo queda localizable en su registro).
  function completePreviousEditions(world, competitionId) {
    world.registries.competitionEditions.forDefinition(competitionId).forEach((edition) => {
      if (edition.status === 'active') edition.setStatus('completed');
      world.registries.competitionStages.forEdition(edition.id).forEach((stage) => {
        if (stage.status === 'active') stage.setStatus('completed');
      });
    });
  }

  // Crea la edición de temporada regular de UNA división (ACB o Primera
  // FEB) + su stage de temporada regular + un entry por equipo.
  // `runtimeBinding` (la instancia REAL de `League`) todavía no existe en
  // este punto del arranque (game.js construye equipos+mundo antes que la
  // `League`, ver DESIGN.md) — se enlaza después con `bindLeagueRuntime()`.
  function bindDomesticDivision(world, {
    division, seasonKey, teams, startDate,
  }) {
    const competitionId = competitionIdForDivision(division);
    const definition = world.registries.competitionDefinitions.require(competitionId);

    const edition = new (Entities().CompetitionEdition)({
      id: editionId(competitionId, seasonKey),
      competitionDefinitionId: competitionId,
      seasonKey,
      startDate: startDate || null,
      status: 'active',
      scheduleProfileId: definition.bindings.scheduleProfileId || null,
      rulesetBundleId: definition.bindings.rulesetBundleId || null,
    });
    world.registries.registerCompetitionEdition(edition);

    const stage = new (Entities().CompetitionStage)({
      id: regularSeasonStageId(competitionId, seasonKey),
      editionId: edition.id,
      name: 'Temporada regular',
      sequence: 1,
      stageType: 'round-robin',
      status: 'active',
    });
    world.registries.registerCompetitionStage(stage);

    teams.forEach((team) => {
      const entry = new (Entities().CompetitionEntry)({
        id: entryId(competitionId, seasonKey, 'regular-season', team.id),
        editionId: edition.id,
        stageId: stage.id,
        participantType: 'club-team',
        participantId: team.id,
        entryStatus: 'active',
        validFrom: startDate || null,
      });
      world.registries.registerCompetitionEntry(entry);
    });

    return { competitionId, edition, stage };
  }

  // Arranque de carrera (`startSeason()`): ACB + Primera FEB a la vez.
  function bindCareerStart(world, { seasonKey, teamsByDivision, startDate }) {
    const result = {};
    ['1ª', '2ª'].forEach((division) => {
      result[division] = bindDomesticDivision(world, {
        division, seasonKey, teams: teamsByDivision[division], startDate,
      });
    });
    return result;
  }

  // Cierre de temporada (`closeSeasonAndPrepareNext()`): cierra las
  // ediciones/stages de la temporada anterior y abre las de la nueva —
  // nunca las reescribe, cada temporada tiene su propia edición.
  function bindNewSeason(world, { seasonKey, teamsByDivision, startDate }) {
    ['1ª', '2ª'].forEach((division) => {
      completePreviousEditions(world, competitionIdForDivision(division));
    });
    return bindCareerStart(world, { seasonKey, teamsByDivision, startDate });
  }

  // Enlaza la instancia REAL de `League` ya construida con la edición/stage
  // de temporada regular ya creados (`bindCareerStart`/`bindNewSeason`) —
  // paso 8 del arranque de carrera (DESIGN.md, sección 8.1): "enlazar cada
  // League/bracket actual con su stage canónico". `runtimeBinding` es
  // TRANSITORIO (excluido de cualquier snapshot, ver `Competition.js`).
  function bindLeagueRuntime(world, { division, seasonKey, league }) {
    const competitionId = competitionIdForDivision(division);
    const edition = world.registries.competitionEditions.require(editionId(competitionId, seasonKey));
    const stage = world.registries.competitionStages.require(regularSeasonStageId(competitionId, seasonKey));
    edition.runtimeBinding = league;
    stage.runtimeBinding = league;
    return { edition, stage };
  }

  // Copa ACB (jornada 17→18, DESIGN.md 3.2.4): competición SEPARADA de la
  // Liga (invariante 13) — edición propia por temporada, una única fase de
  // eliminatoria directa. `qualifiedTeams`: los 8 equipos clasificados EN
  // ESE MOMENTO (foto de la jornada 17, nunca recalculados después).
  function bindCup(world, { seasonKey, bracket, qualifiedTeams }) {
    const competitionId = Catalog().COMPETITION_IDS.COPA_ACB;
    const edition = new (Entities().CompetitionEdition)({
      id: editionId(competitionId, seasonKey),
      competitionDefinitionId: competitionId,
      seasonKey,
      status: 'active',
      runtimeBinding: bracket,
    });
    world.registries.registerCompetitionEdition(edition);

    const stage = new (Entities().CompetitionStage)({
      id: stageId(competitionId, seasonKey, 'knockout'),
      editionId: edition.id,
      name: 'Eliminatoria de Copa',
      sequence: 1,
      stageType: 'knockout',
      status: 'active',
      runtimeBinding: bracket,
    });
    world.registries.registerCompetitionStage(stage);

    qualifiedTeams.forEach((team, index) => {
      world.registries.registerCompetitionEntry(new (Entities().CompetitionEntry)({
        id: entryId(competitionId, seasonKey, 'knockout', team.id),
        editionId: edition.id,
        stageId: stage.id,
        participantType: 'club-team',
        participantId: team.id,
        entryStatus: 'qualified',
        seed: index + 1,
        qualificationSource: 'acb-regular-season-round-17',
      }));
    });

    return { competitionId, edition, stage };
  }

  // Playoff por el título (1ª división) / de ascenso (2ª división):
  // invariante 13 — STAGE de la edición de Liga de esa temporada, NUNCA una
  // competición aparte. La edición debe existir ya (creada por
  // `bindCareerStart`/`bindNewSeason` al arrancar la temporada).
  function bindLeaguePlayoffStage(world, {
    division, seasonKey, stageKey, name, bracket, qualifiedTeams, qualificationSource,
  }) {
    const competitionId = competitionIdForDivision(division);
    const edition = world.registries.competitionEditions.require(editionId(competitionId, seasonKey));
    const stage = new (Entities().CompetitionStage)({
      id: stageId(competitionId, seasonKey, stageKey),
      editionId: edition.id,
      name,
      sequence: 2,
      stageType: 'series',
      status: 'active',
      sourceStageIds: [regularSeasonStageId(competitionId, seasonKey)],
      runtimeBinding: bracket,
    });
    world.registries.registerCompetitionStage(stage);

    qualifiedTeams.forEach((team, index) => {
      world.registries.registerCompetitionEntry(new (Entities().CompetitionEntry)({
        id: entryId(competitionId, seasonKey, stageKey, team.id),
        editionId: edition.id,
        stageId: stage.id,
        participantType: 'club-team',
        participantId: team.id,
        entryStatus: 'qualified',
        seed: index + 1,
        qualificationSource: qualificationSource || null,
      }));
    });

    return { competitionId, edition, stage };
  }

  function bindTitlePlayoff(world, { seasonKey, bracket, qualifiedTeams }) {
    return bindLeaguePlayoffStage(world, {
      division: '1ª',
      seasonKey,
      stageKey: 'title-playoff',
      name: 'Playoff por el título',
      bracket,
      qualifiedTeams,
      qualificationSource: 'acb-regular-season-top-8',
    });
  }

  function bindPromotionPlayoff(world, { seasonKey, bracket, qualifiedTeams }) {
    return bindLeaguePlayoffStage(world, {
      division: '2ª',
      seasonKey,
      stageKey: 'promotion-playoff',
      name: 'Playoff de ascenso',
      bracket,
      qualifiedTeams,
      qualificationSource: 'primera-feb-regular-season-2nd-to-9th',
    });
  }

  // Proyección legacy mínima para la interfaz (sección 9 del prompt): qué
  // ediciones/stages están activos ahora mismo, sin exponer `runtimeBinding`.
  function describeActiveEditions(world) {
    return world.registries.competitionEditions.all()
      .filter((edition) => edition.status === 'active')
      .map((edition) => ({
        competitionId: edition.competitionDefinitionId,
        competitionName: world.registries.competitionDefinitions.require(edition.competitionDefinitionId).name,
        seasonKey: edition.seasonKey,
        stages: world.registries.competitionStages.forEdition(edition.id).map((stage) => ({
          id: stage.id, name: stage.name, status: stage.status, entryCount: stage.entryIds.length,
        })),
      }));
  }

  const exportsObj = {
    SpainLegacyCompetitionRuntime: {
      competitionIdForDivision,
      bindCareerStart,
      bindNewSeason,
      bindLeagueRuntime,
      bindCup,
      bindTitlePlayoff,
      bindPromotionPlayoff,
      describeActiveEditions,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
