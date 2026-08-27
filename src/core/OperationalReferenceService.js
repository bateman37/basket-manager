// src/core/OperationalReferenceService.js
// BUG-TRANSFER1-15 (DESIGN.md 9.21) — frontera EXPLÍCITA para capturar,
// limpiar y restaurar referencias OPERATIVAS de sesión que dejan de ser
// válidas cuando un jugador sale de la plantilla operativa de un club (vía
// TRANSFER-1 o LOAN-1). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Nunca borra histórico (actas, box scores, estadísticas, noticias,
// careerHistory, teamStints) — solo estado OPERATIVO factual que dejaría
// de tener sentido para ese club/esa sesión. Módulo puro: no lee `state`
// global ni el DOM — el estado de sesión (p.ej. `state.lineup`) se recibe
// SIEMPRE explícito desde el llamador (game.js), nunca se adivina.
//
// Cada `captureAndClean...` devuelve un snapshot EXACTO (deep clone, no
// solo "lo que se tocó") para que `restore...` pueda deshacer byte a byte,
// incluso si la limpieza tocó más de un campo o un campo no anticipado por
// esta versión del servicio.

(function (global) {
  function deepClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  // ---------------------------------------------------------------------
  // Nivel Team (sección 15 del prompt de LOAN-1): foco de entrenamiento
  // individual y asignaciones tácticas de rol/matchup — viven en el propio
  // `Team`, nunca en `state` de sesión.
  //
  // BUG-TRANSFER1-15: `tacticalProfile.matchupOverrides` es un OBJETO
  // `{ defenderId: targetId }` (ver Tactics.js), nunca un array — la
  // implementación anterior comprobaba `Array.isArray(...)` y por tanto
  // NUNCA limpiaba nada aquí: un jugador saliente que fuera defensor o
  // rival objetivo de un matchup dejaba una referencia colgante.
  // ---------------------------------------------------------------------
  function captureAndCleanTeamState(team, playerId) {
    const snapshot = {
      playerId,
      hadIndividualFocus: false,
      individualFocus: null,
      hadRoleAssignment: false,
      roleAssignment: null,
      removedMatchupOverrides: [], // [[defenderId, targetId], ...]
    };
    const focuses = team.trainingPlan && team.trainingPlan.individualFocuses;
    if (focuses && Object.prototype.hasOwnProperty.call(focuses, playerId)) {
      snapshot.hadIndividualFocus = true;
      snapshot.individualFocus = deepClone(focuses[playerId]);
      delete focuses[playerId];
    }
    const tactical = team.tacticalProfile;
    if (tactical && tactical.roleAssignments && Object.prototype.hasOwnProperty.call(tactical.roleAssignments, playerId)) {
      snapshot.hadRoleAssignment = true;
      snapshot.roleAssignment = deepClone(tactical.roleAssignments[playerId]);
      delete tactical.roleAssignments[playerId];
    }
    if (tactical && tactical.matchupOverrides && typeof tactical.matchupOverrides === 'object') {
      Object.entries(tactical.matchupOverrides).forEach(([defenderId, targetId]) => {
        if (defenderId === playerId || targetId === playerId) {
          snapshot.removedMatchupOverrides.push([defenderId, targetId]);
        }
      });
      snapshot.removedMatchupOverrides.forEach(([defenderId]) => { delete tactical.matchupOverrides[defenderId]; });
    }
    return snapshot;
  }

  function restoreTeamState(team, snapshot) {
    if (!snapshot) return;
    if (snapshot.hadIndividualFocus && team.trainingPlan) {
      team.trainingPlan.individualFocuses = team.trainingPlan.individualFocuses || {};
      team.trainingPlan.individualFocuses[snapshot.playerId] = snapshot.individualFocus;
    }
    if (snapshot.hadRoleAssignment && team.tacticalProfile) {
      team.tacticalProfile.roleAssignments = team.tacticalProfile.roleAssignments || {};
      team.tacticalProfile.roleAssignments[snapshot.playerId] = snapshot.roleAssignment;
    }
    if (snapshot.removedMatchupOverrides.length && team.tacticalProfile) {
      team.tacticalProfile.matchupOverrides = team.tacticalProfile.matchupOverrides || {};
      snapshot.removedMatchupOverrides.forEach(([defenderId, targetId]) => {
        team.tacticalProfile.matchupOverrides[defenderId] = targetId;
      });
    }
  }

  // ---------------------------------------------------------------------
  // Nivel sesión (game.js): convocatoria/alineación por slots — el ÚNICO
  // contenedor de sesión que TRANSFER-1/LOAN-1 conocen hoy es
  // `state.lineup` (sección 15.3: "state.lineup.squadIds, rotación,
  // convocatoria en curso"), recibido EXPLÍCITO como `lineup` — nunca leído
  // de un `state` global. Snapshot completo (deep clone) para restaurar
  // "byte a byte", no solo los campos que esta versión sabe limpiar.
  // ---------------------------------------------------------------------
  function captureAndCleanLineupState(lineup, playerId) {
    if (!lineup) return null;
    const snapshot = deepClone(lineup);
    lineup.squadIds = (lineup.squadIds || []).filter((id) => id !== playerId);
    if (lineup.entries) {
      Object.keys(lineup.entries).forEach((positionKey) => {
        const row = lineup.entries[positionKey] || {};
        Object.keys(row).forEach((slotKey) => {
          const slot = row[slotKey];
          if (slot && slot.playerId === playerId) slot.playerId = null;
        });
      });
    }
    if (Array.isArray(lineup.fixedSegments)) {
      lineup.fixedSegments = lineup.fixedSegments.filter((seg) => seg.playerId !== playerId);
    }
    return snapshot;
  }

  function restoreLineupState(lineup, snapshot) {
    if (!lineup || snapshot === null || snapshot === undefined) return;
    Object.keys(lineup).forEach((key) => { delete lineup[key]; });
    Object.assign(lineup, snapshot);
  }

  // ---------------------------------------------------------------------
  // Fachada única para el motor atómico (TransferExecutionService/
  // LoanExecutionService, sección 14 del prompt de LOAN-1): captura+limpia
  // TODAS las referencias operativas conocidas de un jugador saliente de
  // UN club (equipo + sesión, si se pasa `lineup`), y devuelve un cierre
  // `restore()` listo para `registerUndo()` — el llamador no reconstruye
  // el snapshot a mano.
  // ---------------------------------------------------------------------
  function captureAndClean(params) {
    const { team, playerId, lineup } = params || {};
    if (!team) throw new Error('OperationalReferenceService.captureAndClean: falta "team".');
    const teamSnapshot = captureAndCleanTeamState(team, playerId);
    const lineupSnapshot = lineup ? captureAndCleanLineupState(lineup, playerId) : undefined;
    return {
      restore() {
        restoreTeamState(team, teamSnapshot);
        if (lineup) restoreLineupState(lineup, lineupSnapshot);
      },
    };
  }

  const exportsObj = {
    OperationalReferenceService: {
      captureAndCleanTeamState,
      restoreTeamState,
      captureAndCleanLineupState,
      restoreLineupState,
      captureAndClean,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
