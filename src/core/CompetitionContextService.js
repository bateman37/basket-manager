// src/core/CompetitionContextService.js
// WORLD-CONTEXT-1 (DESIGN.md 10.20) — utilidad PURA de resolución de
// contexto competitivo. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Por qué existe (BUG-WORLD-CONTEXT-01): hasta esta entrega, nueve
// servicios profesionales (contratos, inscripciones, planificación CPU,
// clearinghouse, legalidad de plantilla, traspasos, cesiones, ciclo anual)
// resolvían "en qué competición está este equipo" traduciendo su división
// legacy con el adaptador de `CompetitionRules.js` (retirado por completo
// en WORLD-CLEANUP-1, DESIGN.md 10.21, junto con `Team.division`). Un
// equipo puede participar SIMULTÁNEAMENTE en liga, Copa y (en el futuro)
// Europa: no posee una única "división" universal, así que esa traducción
// era una suposición oculta, no un dato.
//
// A partir de aquí el contexto competitivo es SIEMPRE explícito:
//  - una operación sobre un solo equipo recibe `domesticCompetitionId`;
//  - una operación entre equipos recibe ids por PAPEL (`originCompetitionId`
//    /`destinationCompetitionId`/`ownerCompetitionId`/`borrowerCompetitionId`);
//  - una operación batch recibe un RESOLVER puro `competitionIdForTeam(team,
//    seasonKey)` (o una proyección plana `competitionIdByTeamId` construida
//    por el llamador);
//  - sin contexto suficiente se FALLA con diagnóstico (`teamId`,
//    `seasonKey`, operación) — nunca se aplica ACB ni ninguna competición
//    por defecto.
//
// Este módulo NO es un registro ni una caché durable: es una CONSULTA sobre
// las `CompetitionEntry` ya registradas (fuente canónica de participación,
// COMP-CORE-1/PATHWAYS-1). No muta nada y no consume aleatoriedad.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const ParticipationModule = isNode ? require('./CompetitionParticipationService.js') : global.BasketManager;

  function Participation() {
    return isNode ? ParticipationModule : global.BasketManager;
  }

  function describeContext(context) {
    const ctx = context || {};
    const parts = [];
    if (ctx.operation) parts.push(`operación "${ctx.operation}"`);
    if (ctx.teamId) parts.push(`equipo "${ctx.teamId}"`);
    if (ctx.clubId) parts.push(`club "${ctx.clubId}"`);
    if (ctx.seasonKey) parts.push(`temporada "${ctx.seasonKey}"`);
    if (ctx.role) parts.push(`papel "${ctx.role}"`);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }

  // Guarda de frontera: un `competitionId` ausente/vacío nunca se sustituye
  // por un valor por defecto.
  function requireCompetitionId(competitionId, context) {
    if (typeof competitionId === 'string' && competitionId.length > 0) return competitionId;
    throw new Error(
      `CompetitionContextService: falta el "competitionId" explícito${describeContext(context)} — WORLD-CONTEXT-1 `
      + 'exige contexto competitivo explícito; nunca se deriva de team.division ni se aplica una competición por defecto.',
    );
  }

  // Competición doméstica PRINCIPAL de un equipo materializado, resuelta
  // desde sus `CompetitionEntry` reales de esa temporada. Cero o varias
  // ligas primarias fallan de forma descriptiva (nunca "la primera").
  function resolveDomesticCompetitionId(registries, teamId, options) {
    const opts = options || {};
    if (!registries) {
      throw new Error(
        `CompetitionContextService.resolveDomesticCompetitionId: faltan los registros del mundo${describeContext({ ...opts, teamId })}.`,
      );
    }
    if (!opts.seasonKey) {
      throw new Error(
        `CompetitionContextService.resolveDomesticCompetitionId: falta "seasonKey" explícito${describeContext({ ...opts, teamId })}.`,
      );
    }
    try {
      return Participation().primaryLeagueCompetitionId(registries, teamId, { seasonKey: opts.seasonKey });
    } catch (error) {
      throw new Error(
        `CompetitionContextService.resolveDomesticCompetitionId${describeContext({ ...opts, teamId })}: ${error.message}`,
      );
    }
  }

  // Resolver PURO reutilizable por operaciones batch — el llamador lo
  // construye una vez y lo pasa explícitamente (`competitionIdForTeam`).
  function makeDomesticCompetitionResolver(registries, options) {
    const opts = options || {};
    return function competitionIdForTeam(team, seasonKey) {
      const effectiveSeasonKey = seasonKey || opts.seasonKey;
      const teamId = team && team.id ? team.id : team;
      return resolveDomesticCompetitionId(registries, teamId, {
        seasonKey: effectiveSeasonKey, operation: opts.operation || null,
      });
    };
  }

  // Aplica un resolver aportado por el llamador y VALIDA el resultado: un
  // resolver ausente, que no conozca al equipo o que devuelva vacío bloquea
  // la operación en vez de continuar con una competición supuesta.
  function competitionIdForTeamWith(competitionIdForTeam, team, options) {
    const opts = options || {};
    const teamId = team && team.id ? team.id : team;
    if (typeof competitionIdForTeam !== 'function') {
      throw new Error(
        `CompetitionContextService: falta el resolver obligatorio "competitionIdForTeam"${describeContext({ ...opts, teamId })} `
        + '— una operación batch nunca infiere la competición de cada equipo por su cuenta.',
      );
    }
    if (!opts.seasonKey) {
      throw new Error(
        `CompetitionContextService: falta "seasonKey" explícito para resolver la competición${describeContext({ ...opts, teamId })}.`,
      );
    }
    const resolved = competitionIdForTeam(team, opts.seasonKey);
    return requireCompetitionId(resolved, { ...opts, teamId });
  }

  // Proyección plana `{ teamId: competitionId }` con orden de claves
  // ESTABLE (por teamId) — dato serializable, nunca un registro nuevo.
  function projectCompetitionIdByTeamId(competitionIdForTeam, teams, options) {
    const opts = options || {};
    const projection = {};
    [...(teams || [])]
      .sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)))
      .forEach((team) => {
        projection[team.id] = competitionIdForTeamWith(competitionIdForTeam, team, opts);
      });
    return projection;
  }

  // Resolver a partir de una proyección plana ya construida (por ejemplo el
  // `initialCompetitionDefinitionId` del contenido materializado, ANTES de
  // que existan Entries) — nunca acepta un equipo desconocido.
  function resolverFromProjection(competitionIdByTeamId, options) {
    const opts = options || {};
    const lookup = competitionIdByTeamId instanceof Map
      ? (teamId) => competitionIdByTeamId.get(teamId)
      : (teamId) => (competitionIdByTeamId || {})[teamId];
    return function competitionIdForTeam(team, seasonKey) {
      const teamId = team && team.id ? team.id : team;
      const found = lookup(teamId);
      if (!found) {
        throw new Error(
          `CompetitionContextService: la proyección de competiciones no conoce al equipo "${teamId}"`
          + `${describeContext({ ...opts, seasonKey })} — nunca se supone una competición por defecto.`,
        );
      }
      return found;
    };
  }

  // La normativa laboral ya resuelta (`ContractService.resolveRulesForClub`)
  // CONGELA el contexto doméstico que le pasó su llamador: leerlo de ahí es
  // propagación explícita, nunca una inferencia nueva.
  function domesticCompetitionIdFromResolvedEmployment(resolved, options) {
    const requested = resolved && resolved.requestedContext ? resolved.requestedContext : null;
    return requireCompetitionId(requested ? requested.domesticCompetitionId : null, {
      ...(options || {}), role: 'resolved-employment-context',
    });
  }

  const exportsObj = {
    CompetitionContextService: {
      requireCompetitionId,
      resolveDomesticCompetitionId,
      makeDomesticCompetitionResolver,
      competitionIdForTeamWith,
      projectCompetitionIdByTeamId,
      resolverFromProjection,
      domesticCompetitionIdFromResolvedEmployment,
    },
  };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
