// src/core/CareerParticipantFactory.js
// WORLD-HARDEN-1 (DESIGN.md 10.19) — extracción PURA de la materialización
// de participantes de carrera: recorre los clubes seleccionables del
// catálogo (`manifest.careerSetup.clubs`, WORLD-UI-1), localiza su dato
// crudo por `teamId` y agrupa las instancias YA construidas por
// `initialCompetitionDefinitionId` real — nunca por `REAL_DATA_INDEX.division`
// ni por división legacy. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Este módulo NO construye `Team`/`Player` por sí mismo — esa
// responsabilidad sigue siendo de `game.js` (CLAUDE.md, "Interfaz de
// juego": instancias reales de Player/Team, dataSource fuera del
// constructor, revelado progresivo por cuartos son decisiones de esa
// capa). `buildTeam(rawTeamData, competitionDefinitionId)` es un callback
// INYECTADO — este archivo solo orquesta iteración/resolución/agrupación,
// nunca duda de qué es un jugador real.

(function (global) {
  function requireFn(fn, label) {
    if (typeof fn !== 'function') throw new Error(`CareerParticipantFactory: falta "${label}" (función explícita).`);
    return fn;
  }

  // clubEntries: array de metadatos planos `{ teamId, initialCompetitionDefinitionId, ... }`
  // (misma forma que `manifest.careerSetup.clubs`/`SPAIN_CLUB_CONTENT`).
  // resolveRawData(teamId) -> dato crudo del bundle (lanza si no existe).
  // buildTeam(rawTeamData, competitionDefinitionId) -> instancia REAL de Team
  // (con roster de instancias REALES de Player, ya construida por el
  // llamador).
  function materializeParticipants({ clubEntries, resolveRawData, buildTeam }) {
    const entries = clubEntries || [];
    const resolve = requireFn(resolveRawData, 'resolveRawData');
    const build = requireFn(buildTeam, 'buildTeam');

    const allTeams = [];
    const teamsByCompetitionId = {};
    entries.forEach((entry) => {
      if (!entry.initialCompetitionDefinitionId) {
        throw new Error(
          `CareerParticipantFactory: el club "${entry.teamId}" no declara "initialCompetitionDefinitionId" — `
          + 'nunca se deriva de una división legacy.',
        );
      }
      const rawData = resolve(entry.teamId);
      if (!rawData) {
        throw new Error(`CareerParticipantFactory: sin dato crudo para el equipo "${entry.teamId}".`);
      }
      const team = build(rawData, entry.initialCompetitionDefinitionId);
      allTeams.push(team);
      const key = entry.initialCompetitionDefinitionId;
      if (!teamsByCompetitionId[key]) teamsByCompetitionId[key] = [];
      teamsByCompetitionId[key].push(team);
    });
    return { allTeams, teamsByCompetitionId };
  }

  // Variante de solo AGRUPACIÓN — usada cuando los `Team` ya existen (mismas
  // instancias, nunca reconstruidas) y solo hace falta clasificarlos por
  // competición real declarada en el contenido, sin volver a construir nada.
  function groupTeamsByCompetitionId(teams, clubEntries) {
    const competitionIdByTeamId = new Map(
      (clubEntries || []).map((entry) => [entry.teamId, entry.initialCompetitionDefinitionId]),
    );
    const grouped = {};
    (teams || []).forEach((team) => {
      const competitionId = competitionIdByTeamId.get(team.id);
      if (!competitionId) return;
      if (!grouped[competitionId]) grouped[competitionId] = [];
      grouped[competitionId].push(team);
    });
    return grouped;
  }

  // Mapa directo teamId -> competitionDefinitionId inicial — usado para
  // resolver reglas de cobertura (`buildRealTeamFromData`) ANTES de que
  // exista `GameWorld`/`CompetitionEntry` real.
  function competitionIdByTeamIdFrom(clubEntries) {
    return new Map((clubEntries || []).map((entry) => [entry.teamId, entry.initialCompetitionDefinitionId]));
  }

  const exportsObj = {
    materializeParticipants,
    groupTeamsByCompetitionId,
    competitionIdByTeamIdFrom,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
    global.BasketManager.CareerParticipantFactory = exportsObj;
  }
})(typeof window !== 'undefined' ? window : globalThis);
