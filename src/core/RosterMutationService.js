// src/core/RosterMutationService.js
// TRANSFER-1 (DESIGN.md 9.20, sección 15 del prompt) — ÚNICA frontera
// autorizada para mover la afiliación de un jugador entre plantillas o
// liberarlo. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Invariantes que este módulo protege (sección 15.1/15.2 del prompt):
//  - el movimiento usa SIEMPRE la instancia exacta de
//    `state.playerRegistry.get(playerId)` — nunca `new Player()` ni un
//    clon desde JSON;
//  - ningún jugador aparece en dos rosters senior a la vez;
//  - ningún roster contiene dos referencias al mismo id;
//  - `player.teamId` queda sincronizado como espejo de la afiliación
//    ACTUAL — nunca sustituye al contrato como fuente de verdad laboral;
//  - un libre queda en el registro con `teamId === null`, fuera de todos
//    los rosters.
//
// Este módulo NO conoce `state` de game.js ni el DOM: solo Player/Team/
// PlayerRegistry, recibidos explícitos. La limpieza de referencias
// operativas de SESIÓN (state.lineup.squadIds, rotación, convocatoria en
// curso) vive en game.js (capa UI/orquestación) — este servicio limpia lo
// que SÍ puede limpiar sin `state` (foco de entrenamiento y rol táctico,
// que viven en el propio `Team`) y siempre devuelve un informe con lo que
// todavía necesita limpieza a nivel de sesión, para que el llamador no lo
// olvide.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const OperationalReferenceServiceModule = isNode ? require('./OperationalReferenceService.js') : global.BasketManager;

  function OpRefSvc() { return OperationalReferenceServiceModule.OperationalReferenceService; }

  class RosterMutationServiceError extends Error {}

  function findTeamContaining(teams, playerId) {
    return (teams || []).filter((t) => t.roster.some((p) => p.id === playerId));
  }

  function assertNoDuplicateReference(team, playerId) {
    const count = team.roster.filter((p) => p.id === playerId).length;
    if (count > 1) {
      throw new RosterMutationServiceError(
        `RosterMutationService: la plantilla de "${team.id}" contiene ${count} referencias al jugador `
        + `"${playerId}" antes de mover — estado inconsistente previo a esta operación.`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // transferPlayer — mueve la MISMA instancia de un roster a otro (o
  // incorpora a un libre, `fromTeamId: null`).
  // ---------------------------------------------------------------------
  function transferPlayer(params) {
    const {
      playerRegistry, teams, playerId, fromTeamId, toTeamId, lineup,
    } = params || {};
    if (!playerRegistry) throw new RosterMutationServiceError('RosterMutationService.transferPlayer: falta "playerRegistry".');
    if (!toTeamId) throw new RosterMutationServiceError('RosterMutationService.transferPlayer: falta "toTeamId".');
    const player = playerRegistry.require(playerId);

    const toTeam = (teams || []).find((t) => t.id === toTeamId);
    if (!toTeam) throw new RosterMutationServiceError(`RosterMutationService.transferPlayer: no existe el club de destino "${toTeamId}" entre los equipos vivos.`);

    const currentTeams = findTeamContaining(teams, playerId);
    if (currentTeams.length > 1) {
      throw new RosterMutationServiceError(
        `RosterMutationService.transferPlayer: el jugador "${playerId}" aparece en más de una plantilla `
        + `(${currentTeams.map((t) => t.id).join(', ')}) antes de mover — estado inconsistente previo a esta operación.`,
      );
    }
    const fromTeam = fromTeamId ? (teams || []).find((t) => t.id === fromTeamId) : null;
    if (fromTeamId && !fromTeam) {
      throw new RosterMutationServiceError(`RosterMutationService.transferPlayer: no existe el club de origen "${fromTeamId}" entre los equipos vivos.`);
    }
    if (fromTeam) {
      assertNoDuplicateReference(fromTeam, playerId);
      if (!fromTeam.roster.some((p) => p.id === playerId)) {
        throw new RosterMutationServiceError(`RosterMutationService.transferPlayer: "${playerId}" no está en la plantilla declarada de origen "${fromTeamId}".`);
      }
    }
    if (toTeam.roster.some((p) => p.id === playerId)) {
      throw new RosterMutationServiceError(`RosterMutationService.transferPlayer: "${playerId}" ya está en la plantilla de destino "${toTeamId}".`);
    }

    // BUG-TRANSFER1-15 (DESIGN.md 9.21): la captura SIEMPRE ocurre ANTES de
    // `Team.removePlayer()` — este último ya borra `trainingPlan.
    // individualFocuses[playerId]` por su cuenta (LIFE-2), así que capturar
    // DESPUÉS nunca vería ese campo y el rollback no podría restaurarlo.
    const opSnapshot = fromTeam ? OpRefSvc().captureAndCleanTeamState(fromTeam, playerId) : null;
    const lineupSnapshot = lineup ? OpRefSvc().captureAndCleanLineupState(lineup, playerId) : null;
    if (fromTeam) {
      // Misma instancia (`player`, la del registro) — se retira SIN clonar.
      fromTeam.removePlayer(playerId);
    }
    // `Team.addPlayer` añade la MISMA instancia y sincroniza `teamId` —
    // frontera única (sección 15.2): ningún otro código de TRANSFER-1/
    // LOAN-1 debe llamar a `team.roster.push`/`player.teamId =` directamente.
    toTeam.addPlayer(player);
    playerRegistry.setAffiliation(playerId, toTeamId);

    return {
      playerId,
      fromTeamId: fromTeamId || null,
      toTeamId,
      instance: player,
      // Cierre reversible EXACTO (sección 15 del prompt de LOAN-1: "el
      // rollback restaura byte a byte la forma previa") — el llamador lo
      // registra en su propio `registerUndo()`, dentro del MISMO batch
      // atómico que movió el roster, nunca fuera de él ni después del
      // commit.
      restoreOperationalReferences() {
        if (fromTeam) OpRefSvc().restoreTeamState(fromTeam, opSnapshot);
        if (lineup) OpRefSvc().restoreLineupState(lineup, lineupSnapshot);
      },
    };
  }

  // ---------------------------------------------------------------------
  // releasePlayer — deja al jugador LIBRE (fuera de todos los rosters),
  // accesible en el Player Registry con `teamId: null`.
  // ---------------------------------------------------------------------
  function releasePlayer(params) {
    const {
      playerRegistry, teams, playerId, fromTeamId, lineup,
    } = params || {};
    if (!playerRegistry) throw new RosterMutationServiceError('RosterMutationService.releasePlayer: falta "playerRegistry".');
    const player = playerRegistry.require(playerId);
    const currentTeams = findTeamContaining(teams, playerId);
    if (currentTeams.length > 1) {
      throw new RosterMutationServiceError(`RosterMutationService.releasePlayer: "${playerId}" aparece en más de una plantilla — estado inconsistente.`);
    }
    const fromTeam = fromTeamId
      ? (teams || []).find((t) => t.id === fromTeamId)
      : currentTeams[0] || null;
    if (fromTeamId && !fromTeam) {
      throw new RosterMutationServiceError(`RosterMutationService.releasePlayer: no existe el club de origen "${fromTeamId}" entre los equipos vivos.`);
    }
    // BUG-TRANSFER1-15 (DESIGN.md 9.21): captura SIEMPRE antes de
    // `Team.removePlayer()` — ver el mismo comentario en `transferPlayer`.
    const opSnapshot = fromTeam ? OpRefSvc().captureAndCleanTeamState(fromTeam, playerId) : null;
    const lineupSnapshot = lineup ? OpRefSvc().captureAndCleanLineupState(lineup, playerId) : null;
    if (fromTeam) {
      assertNoDuplicateReference(fromTeam, playerId);
      fromTeam.removePlayer(playerId);
    }
    playerRegistry.setAffiliation(playerId, null);
    return {
      playerId,
      fromTeamId: fromTeam ? fromTeam.id : null,
      toTeamId: null,
      instance: player,
      restoreOperationalReferences() {
        if (fromTeam) OpRefSvc().restoreTeamState(fromTeam, opSnapshot);
        if (lineup) OpRefSvc().restoreLineupState(lineup, lineupSnapshot);
      },
    };
  }

  // Verificación de invariantes globales (para tests/smoke) — nunca lanza
  // por sí sola.
  function auditRosterUniqueness(teams) {
    const errors = [];
    const seen = new Map();
    (teams || []).forEach((team) => {
      const idsInTeam = new Set();
      team.roster.forEach((player) => {
        if (idsInTeam.has(player.id)) {
          errors.push(`El jugador "${player.id}" aparece dos veces en la plantilla de "${team.id}".`);
        }
        idsInTeam.add(player.id);
        if (seen.has(player.id) && seen.get(player.id) !== team.id) {
          errors.push(`El jugador "${player.id}" aparece en más de una plantilla: "${seen.get(player.id)}" y "${team.id}".`);
        }
        seen.set(player.id, team.id);
      });
    });
    return { valid: errors.length === 0, errors };
  }

  const exportsObj = {
    RosterMutationService: {
      RosterMutationServiceError,
      transferPlayer,
      releasePlayer,
      auditRosterUniqueness,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
