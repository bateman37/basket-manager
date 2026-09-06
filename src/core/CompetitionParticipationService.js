// src/core/CompetitionParticipationService.js
// COMP-CORE-1 (DESIGN.md 10.13, sección 12 del prompt) — servicio PURO de
// consulta de participación: resuelve por ids contra `WorldRegistries`,
// nunca contra `Team.division`/nacionalidad ni "la primera del array".
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Invariante 7/8 (DESIGN.md): un Team puede tener Entry simultánea en
// Liga, Copa y, en el futuro, Europa — por eso NUNCA se añade
// `team.competitionId` como fuente única, y ninguna función de aquí
// "elige la primera del array" ni asume ACB/la competición del próximo
// partido por defecto: si no hay coincidencia, o hay más de una cuando se
// pidió una sola, falla de forma descriptiva.
//
// Este servicio NO conoce runners/engine — solo lee `WorldRegistries`
// (Edition/Stage/Entry ya registrados). Nunca simula ni muta.

(function (global) {
  function activeEntriesForParticipant(registries, participantId, { seasonKey } = {}) {
    const entries = registries.competitionEntries.forParticipant(participantId)
      .filter((entry) => entry.entryStatus !== 'withdrawn');
    if (!seasonKey) return entries;
    return entries.filter((entry) => {
      const edition = registries.competitionEditions.get(entry.editionId);
      return edition && edition.seasonKey === seasonKey;
    });
  }

  // Todas las competiciones simultáneas de un Team en la temporada dada
  // (o en cualquier temporada, si no se pasa `seasonKey`) — invariante 8.
  function activeCompetitionsForParticipant(registries, participantId, options) {
    const entries = activeEntriesForParticipant(registries, participantId, options);
    const byDefinitionId = new Map();
    entries.forEach((entry) => {
      const edition = registries.competitionEditions.require(entry.editionId);
      if (!byDefinitionId.has(edition.competitionDefinitionId)) {
        byDefinitionId.set(edition.competitionDefinitionId, {
          competitionDefinitionId: edition.competitionDefinitionId, edition, entries: [],
        });
      }
      byDefinitionId.get(edition.competitionDefinitionId).entries.push(entry);
    });
    return [...byDefinitionId.values()];
  }

  // Liga doméstica PRINCIPAL de un Team — el llamador declara criterios
  // EXPLÍCITOS (`kind: 'league'`, `seasonKey`); si no hay ninguna
  // competición de liga o hay más de una, falla descriptivo (nunca elige
  // "la primera", ni la de tier menor, ni ACB por defecto).
  function primaryLeagueCompetitionId(registries, participantId, { seasonKey } = {}) {
    if (!seasonKey) throw new Error('CompetitionParticipationService.primaryLeagueCompetitionId: falta "seasonKey" explícito.');
    const competitions = activeCompetitionsForParticipant(registries, participantId, { seasonKey })
      .filter(({ competitionDefinitionId }) => registries.competitionDefinitions.require(competitionDefinitionId).kind === 'league');
    if (!competitions.length) {
      throw new Error(
        `CompetitionParticipationService: el participante "${participantId}" no tiene ninguna Entry de liga en la `
        + `temporada "${seasonKey}".`,
      );
    }
    if (competitions.length > 1) {
      throw new Error(
        `CompetitionParticipationService: el participante "${participantId}" tiene ${competitions.length} Entries `
        + `de liga simultáneas en la temporada "${seasonKey}" — el llamador debe desambiguar con más criterios `
        + '(nunca se elige la primera).',
      );
    }
    return competitions[0].competitionDefinitionId;
  }

  // Edición/fase correspondiente a un Entry concreto.
  function editionAndStageForEntry(registries, entryId) {
    const entry = registries.competitionEntries.require(entryId);
    const edition = registries.competitionEditions.require(entry.editionId);
    const stage = entry.stageId ? registries.competitionStages.get(entry.stageId) : null;
    return { entry, edition, stage };
  }

  // Participantes de un Stage, en orden de seed (los seedados antes) y
  // luego por id ESTABLE (nunca por orden de inserción del registry).
  function participantsForStage(registries, stageId) {
    const entries = registries.competitionEntries.forStage(stageId);
    return [...entries].sort((a, b) => {
      const seedA = a.seed !== null && a.seed !== undefined ? a.seed : Number.MAX_SAFE_INTEGER;
      const seedB = b.seed !== null && b.seed !== undefined ? b.seed : Number.MAX_SAFE_INTEGER;
      if (seedA !== seedB) return seedA - seedB;
      return a.participantId < b.participantId ? -1 : (a.participantId > b.participantId ? 1 : 0);
    });
  }

  const exportsObj = {
    activeEntriesForParticipant,
    activeCompetitionsForParticipant,
    primaryLeagueCompetitionId,
    editionAndStageForEntry,
    participantsForStage,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
