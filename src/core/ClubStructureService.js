// src/core/ClubStructureService.js
// CLUB-CORE-1 (DESIGN.md sección 10) — frontera PURA que resuelve
// relaciones entre `Club`, `Team` y `Squad`. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Reglas de este servicio (sección 7 del prompt de CLUB-CORE-1):
//  - nunca lee `state` de game.js ni el DOM — recibe siempre `registries`
//    (una instancia de `WorldRegistries`, normalmente `state.world.
//    registries`) explícita;
//  - nunca decide nada por nombre visible ni por división/legacyDivision;
//  - nunca asume `clubId === teamId` — toda relación se resuelve por las
//    referencias YA registradas (`team.clubId`, `club.primaryTeamId`,
//    `squad.teamId`), nunca comparando ids entre sí ni sustituyendo
//    prefijos;
//  - falla descriptivamente ante una referencia ausente o ambigua, nunca
//    devuelve `null` en silencio para un id que el llamador pasó explícito
//    (un squad ACTIVO ausente sí puede ser un estado legítimo — ver
//    `activeSquadForTeam`, que devuelve `null` en ese caso concreto).

(function (global) {
  class ClubStructureServiceError extends Error {}

  function requireRegistries(registries, callerName) {
    if (!registries || typeof registries.clubs === 'undefined' || typeof registries.teams === 'undefined') {
      throw new ClubStructureServiceError(`ClubStructureService.${callerName}: falta "registries" (instancia de WorldRegistries).`);
    }
    return registries;
  }

  // --- Resoluciones directas por id ---------------------------------------

  function resolveClub(registries, clubId) {
    requireRegistries(registries, 'resolveClub');
    if (!clubId) throw new ClubStructureServiceError('ClubStructureService.resolveClub: falta "clubId".');
    return registries.clubs.require(clubId);
  }

  function resolveTeam(registries, teamId) {
    requireRegistries(registries, 'resolveTeam');
    if (!teamId) throw new ClubStructureServiceError('ClubStructureService.resolveTeam: falta "teamId".');
    return registries.teams.require(teamId);
  }

  // --- Relaciones Club <-> Team --------------------------------------------

  // Resuelve el Club de un Team — vía `team.clubId` (referencia registrada),
  // nunca comparando `team.id` con nada.
  function resolveClubForTeam(registries, teamId) {
    const team = resolveTeam(registries, teamId);
    if (!team.clubId) {
      throw new ClubStructureServiceError(`ClubStructureService.resolveClubForTeam: el equipo "${teamId}" no tiene "clubId" asignado.`);
    }
    return resolveClub(registries, team.clubId);
  }

  // Resuelve el Team principal de un Club — vía `club.primaryTeamId`.
  function resolvePrimaryTeamForClub(registries, clubId) {
    const club = resolveClub(registries, clubId);
    if (!club.primaryTeamId) {
      throw new ClubStructureServiceError(`ClubStructureService.resolvePrimaryTeamForClub: el club "${clubId}" no tiene "primaryTeamId" asignado.`);
    }
    return resolveTeam(registries, club.primaryTeamId);
  }

  // Lista TODOS los equipos/secciones de un Club (invariante 6 del prompt:
  // "un club puede tener varios equipos en el modelo") — falla si el Club no
  // existe, aunque no tenga ningún equipo todavía.
  function listTeamsForClub(registries, clubId) {
    resolveClub(registries, clubId);
    return registries.teams.forClub(clubId);
  }

  // --- Relaciones Team <-> Squad -------------------------------------------

  // Squad ACTIVO de un equipo, o `null` si todavía no tiene ninguno (estado
  // legítimo — un Team recién creado puede no tener squad enlazado aún).
  function activeSquadForTeam(registries, teamId) {
    requireRegistries(registries, 'activeSquadForTeam');
    resolveTeam(registries, teamId);
    return registries.squads.activeForTeam(teamId);
  }

  // Igual que `activeSquadForTeam`, pero EXIGE que exista (falla
  // descriptivo) — para código que asume que un equipo activo siempre tiene
  // squad operativo.
  function requireActiveSquadForTeam(registries, teamId) {
    const squad = activeSquadForTeam(registries, teamId);
    if (!squad) {
      throw new ClubStructureServiceError(`ClubStructureService.requireActiveSquadForTeam: el equipo "${teamId}" no tiene squad activo.`);
    }
    return squad;
  }

  // Squad ACTIVO que contiene ahora mismo a un jugador (o `null`) — un
  // jugador puede legítimamente no estar en ningún squad activo (libre,
  // cantera sin promocionar, retirado...).
  function activeSquadForPlayer(registries, playerId) {
    requireRegistries(registries, 'activeSquadForPlayer');
    if (!playerId) throw new ClubStructureServiceError('ClubStructureService.activeSquadForPlayer: falta "playerId".');
    return registries.squads.activeSquadForPlayer(playerId);
  }

  // --- Contexto coherente {club, team, squad} ------------------------------

  // Construye un contexto {club, team, squad} coherente a partir de
  // "clubId" y/o "teamId" (al menos uno de los dos es obligatorio) — el que
  // falte se DERIVA del que se dio (nunca inventado), y ambos se validan
  // cruzados entre sí (`team.clubId === club.id`) para no devolver nunca un
  // contexto incoherente en silencio. `squad` es el squad ACTIVO del Team
  // resuelto, o `null` si todavía no tiene uno.
  function buildContext(registries, { clubId, teamId } = {}) {
    requireRegistries(registries, 'buildContext');
    if (!clubId && !teamId) {
      throw new ClubStructureServiceError('ClubStructureService.buildContext: hace falta "clubId" y/o "teamId" explícito.');
    }
    const club = clubId ? resolveClub(registries, clubId) : resolveClubForTeam(registries, teamId);
    const team = teamId ? resolveTeam(registries, teamId) : resolvePrimaryTeamForClub(registries, clubId);
    if (team.clubId !== club.id) {
      throw new ClubStructureServiceError(
        `ClubStructureService.buildContext: el equipo "${team.id}" pertenece al club "${team.clubId}", `
        + `no al club "${club.id}" pasado explícito — referencia incoherente.`,
      );
    }
    return { club, team, squad: registries.squads.activeForTeam(team.id) };
  }

  const exportsObj = {
    ClubStructureService: {
      ClubStructureServiceError,
      resolveClub,
      resolveTeam,
      resolveClubForTeam,
      resolvePrimaryTeamForClub,
      listTeamsForClub,
      activeSquadForTeam,
      requireActiveSquadForTeam,
      activeSquadForPlayer,
      buildContext,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
