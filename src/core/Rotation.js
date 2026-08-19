// src/core/Rotation.js
// Alineación/rotación de partido — ver DESIGN.md 7.11.1-7.11.3 (Bloque
// C.1/C.2/C.3 de la tarea de Alineaciones). Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Este módulo es DELIBERADAMENTE opcional para MatchEngine: si un equipo no
// aporta una alineación (lineup) construida aquí, MatchEngine sigue usando
// su placeholder de siempre (selectOnCourtFive, ponderado titulares/
// banquillo sin posición real). Solo cuando el usuario construye una
// alineación real (pantalla "Alineación", src/ui/game.js) entra en juego
// este sistema completo de cuotas por posición + sustitución automática +
// polivalencia de emergencia.

(function (global) {
  const PlayerCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;

  const { POSITIONS } = PlayerCore;

  function positionIndex(position) {
    return POSITIONS.indexOf(position);
  }

  function positionDistance(a, b) {
    return Math.abs(positionIndex(a) - positionIndex(b));
  }

  // --- C.1/C.2: construcción y validación de la alineación ---
  //
  // Shape de `lineup` (construido por la pantalla de Alineación):
  // {
  //   entries: {
  //     [playerId]: { declaredPosition: 'Base'|...|'Pívot', minutesQuota: number },
  //     ...
  //   },
  //   fixedSegments: [ // opcional, C.2 "quintetos fijos"
  //     { label: string, trigger: { fromPeriod, scoreCondition: 'ahead'|'behind'|'any' },
  //       five: { Base: playerId, Escolta: playerId, ... } },
  //   ],
  // }

  // Suma de minutos declarados por posición. Validación estricta (C.2): debe
  // cuadrar EXACTAMENTE con la duración total del partido (config.match.
  // durationMinutes, nunca 40 fijo en código) para cada una de las 5
  // posiciones — si no, se bloquea con el detalle de qué posiciones fallan
  // y en cuánto, sin normalizar automáticamente.
  function validateLineup(lineup, config) {
    const totalMinutes = config.match.durationMinutes;
    const sums = {};
    POSITIONS.forEach((pos) => { sums[pos] = 0; });
    Object.values(lineup.entries || {}).forEach((entry) => {
      sums[entry.declaredPosition] += entry.minutesQuota;
    });
    const errors = [];
    POSITIONS.forEach((pos) => {
      const diff = Math.round((sums[pos] - totalMinutes) * 100) / 100;
      if (Math.abs(diff) > 1e-6) {
        errors.push({ position: pos, sum: sums[pos], expected: totalMinutes, diff });
      }
    });
    return { valid: errors.length === 0, errors, sums, totalMinutes };
  }

  // Mensaje legible para la UI (C.6): qué posición(es) fallan y en cuánto.
  function describeValidationErrors(errors) {
    return errors.map(({ position, diff }) => {
      const sign = diff > 0 ? 'sobran' : 'faltan';
      return `${position}: ${sign} ${Math.abs(diff)} min (debe sumar exactamente la duración del partido)`;
    }).join(' · ');
  }

  // --- Estado de rotación en tiempo de ejecución (un partido) ---

  function buildRotationState(lineup, squad, config) {
    const players = new Map(squad.map((player) => [player.id, player]));
    const bySlot = {};
    POSITIONS.forEach((pos) => { bySlot[pos] = []; });
    const quotaSeconds = new Map();
    Object.entries(lineup.entries).forEach(([playerId, entry]) => {
      bySlot[entry.declaredPosition].push(playerId);
      quotaSeconds.set(playerId, entry.minutesQuota * 60);
    });
    const playedSeconds = new Map(squad.map((player) => [player.id, 0]));

    // Quinteto inicial: por cada posición, el convocado declarado en ella
    // con mayor cuota de minutos (asunción razonable de "titular" para esa
    // posición) — si una posición no tiene ningún declarado (convocatoria
    // corta/desequilibrada), se cubre igualmente vía polivalencia de
    // emergencia en la primera ventana de sustitución.
    const onCourt = {};
    POSITIONS.forEach((pos) => {
      const candidates = bySlot[pos];
      if (candidates.length === 0) { onCourt[pos] = null; return; }
      onCourt[pos] = candidates.reduce(
        (best, id) => (quotaSeconds.get(id) > quotaSeconds.get(best) ? id : best),
        candidates[0],
      );
    });

    return {
      lineup,
      config,
      players,
      bySlot,
      quotaSeconds,
      playedSeconds,
      onCourt,
      penalties: new Map(), // playerId -> penalización de rendimiento activa (C.3)
      fixedSegmentActive: null,
      totalGameSeconds: config.match.durationMinutes * 60,
    };
  }

  function getOnCourtFive(state) {
    return POSITIONS.map((pos) => state.players.get(state.onCourt[pos])).filter(Boolean);
  }

  // Acumula minutos jugados (segundos) para los 5 en pista tras resolver una
  // posesión — llamado desde MatchEngine junto a applyFatigueConsumption.
  function accumulatePlayedTime(state, seconds) {
    POSITIONS.forEach((pos) => {
      const id = state.onCourt[pos];
      if (!id) return;
      state.playedSeconds.set(id, (state.playedSeconds.get(id) || 0) + seconds);
    });
  }

  function expectedSecondsByNow(quota, elapsedSeconds, totalGameSeconds) {
    if (totalGameSeconds <= 0) return 0;
    return quota * (elapsedSeconds / totalGameSeconds);
  }

  // --- C.2: quintetos fijos opcionales por franja de partido ---
  // `matchState`: { period, scoreDiff } — scoreDiff positivo = el equipo de
  // esta alineación va ganando. Interpretación propia de "franja" (DESIGN.md
  // no fija una sintaxis exacta): a partir de un período dado, y opcionalmente
  // condicionado a ir ganando/perdiendo/cualquiera.
  function findActiveFixedSegment(lineup, matchState) {
    const segments = lineup.fixedSegments || [];
    return segments.find((segment) => {
      const trigger = segment.trigger || {};
      if (trigger.fromPeriod && matchState.period < trigger.fromPeriod) return false;
      if (trigger.scoreCondition === 'ahead' && !(matchState.scoreDiff > 0)) return false;
      if (trigger.scoreCondition === 'behind' && !(matchState.scoreDiff < 0)) return false;
      return true;
    }) || null;
  }

  // --- C.3: Polivalencia de emergencia ---
  // Candidato entre TODOS los convocados con minutos disponibles (no solo
  // los declarados en `slot`): mayor nivel en esa posición (mapa de 5,
  // C.0) combinado con menor distancia posicional; desempate por mayor
  // cuota de minutos restante.
  function chooseEmergencyCandidate(state, slot, excludeIds) {
    const config = state.config;
    const weight = config.emergencyVersatility.selectionDistanceWeight;
    let best = null;
    let bestScore = -Infinity;
    state.players.forEach((player, playerId) => {
      if (excludeIds.has(playerId)) return;
      const quota = state.quotaSeconds.get(playerId) || 0;
      const played = state.playedSeconds.get(playerId) || 0;
      const remaining = quota - played;
      if (remaining <= 0) return;
      const declaredPosition = state.lineup.entries[playerId]
        ? state.lineup.entries[playerId].declaredPosition
        : slot;
      const distance = positionDistance(slot, declaredPosition);
      const level = player.positionLevel(slot);
      const score = level - distance * weight;
      if (score > bestScore || (score === bestScore && remaining > (state.quotaSeconds.get(best) - state.playedSeconds.get(best)))) {
        best = playerId;
        bestScore = score;
      }
    });
    if (!best) return null;
    const declaredPosition = state.lineup.entries[best].declaredPosition;
    const distance = positionDistance(slot, declaredPosition);
    const level = state.players.get(best).positionLevel(slot);
    const penalty = config.emergencyVersatility.basePenaltyByDistance[distance] * (1 - level / 20);
    return { playerId: best, distance, level, penalty };
  }

  // Estudia si hace falta sustituir en UNA posición y ejecuta el cambio.
  // Devuelve una entrada de log ({position, outId, inId, emergency, penalty})
  // o null si no hubo cambio.
  function considerSlotSubstitution(state, slot, matchState) {
    const config = state.config;
    const currentId = state.onCourt[slot];
    const onCourtIds = new Set(POSITIONS.map((pos) => state.onCourt[pos]).filter(Boolean));

    if (!currentId) {
      // Slot sin cubrir desde el principio (convocatoria sin nadie
      // declarado ahí) — se resuelve directamente por polivalencia.
      const candidate = chooseEmergencyCandidate(state, slot, onCourtIds);
      if (!candidate) return null;
      state.onCourt[slot] = candidate.playerId;
      state.penalties.set(candidate.playerId, candidate.penalty);
      return { position: slot, outId: null, inId: candidate.playerId, emergency: true, penalty: candidate.penalty };
    }

    const quota = state.quotaSeconds.get(currentId) || 0;
    const played = state.playedSeconds.get(currentId) || 0;
    const expected = expectedSecondsByNow(quota, matchState.elapsedSeconds, state.totalGameSeconds);
    const overQuota = played >= quota;
    const overPace = (played - expected) > config.rotation.paceToleranceSeconds;
    if (!overQuota && !overPace) return null;

    // 1) Preferencia: otro convocado declarado en ESTA posición, con
    // minutos disponibles, priorizando al más "por debajo" de su ritmo.
    const ownSlotCandidates = state.bySlot[slot].filter((id) => {
      if (id === currentId || onCourtIds.has(id)) return false;
      return (state.playedSeconds.get(id) || 0) < (state.quotaSeconds.get(id) || 0);
    });
    if (ownSlotCandidates.length > 0) {
      const bestId = ownSlotCandidates.reduce((best, id) => {
        const deltaBest = (state.playedSeconds.get(best) || 0)
          - expectedSecondsByNow(state.quotaSeconds.get(best), matchState.elapsedSeconds, state.totalGameSeconds);
        const deltaId = (state.playedSeconds.get(id) || 0)
          - expectedSecondsByNow(state.quotaSeconds.get(id), matchState.elapsedSeconds, state.totalGameSeconds);
        return deltaId < deltaBest ? id : best;
      });
      state.onCourt[slot] = bestId;
      state.penalties.delete(bestId);
      if (!overQuota) return null; // dentro de tolerancia normal, cambio silencioso de ritmo
      return { position: slot, outId: currentId, inId: bestId, emergency: false, penalty: 0 };
    }

    // 2) Sin cobertura propia: C.3 polivalencia de emergencia.
    const excludeIds = new Set([...onCourtIds, currentId]);
    const candidate = chooseEmergencyCandidate(state, slot, excludeIds);
    if (!candidate) return null; // no hay nadie disponible: se queda quien está, aunque agote cuota
    state.onCourt[slot] = candidate.playerId;
    state.penalties.set(candidate.playerId, candidate.penalty);
    return { position: slot, outId: currentId, inId: candidate.playerId, emergency: true, penalty: candidate.penalty };
  }

  // --- Ventana de sustitución (C.2): solo se llama en fin de cuarto y en
  // paradas de juego (falta/violación) — nunca a mitad de una jugada viva.
  // `matchState`: { period, scoreDiff, elapsedSeconds }.
  function runSubstitutionWindow(state, matchState) {
    const activeSegment = findActiveFixedSegment(state.lineup, matchState);
    if (activeSegment) {
      state.fixedSegmentActive = activeSegment;
      POSITIONS.forEach((pos) => {
        const forcedId = activeSegment.five[pos];
        if (forcedId && state.onCourt[pos] !== forcedId) {
          state.onCourt[pos] = forcedId;
          state.penalties.delete(forcedId);
        }
      });
      return { substitutions: [], fixedSegmentLabel: activeSegment.label };
    }
    state.fixedSegmentActive = null;
    const substitutions = [];
    POSITIONS.forEach((pos) => {
      const change = considerSlotSubstitution(state, pos, matchState);
      if (change) substitutions.push(change);
    });
    return { substitutions, fixedSegmentLabel: null };
  }

  // Eventos de reglamento (Bloque B, 7.6) que representan una parada de
  // juego real — ventana válida de sustitución además del fin de cuarto.
  const DEAD_BALL_EVENT_TYPES = new Set([
    'defensiveFoul', 'shootingFoul', 'shootingFoulAndOne', 'technicalFoul', 'shotClockViolation',
  ]);

  function isDeadBallStoppage(events) {
    return events.some((event) => DEAD_BALL_EVENT_TYPES.has(event.type));
  }

  // Penalización de rendimiento activa (C.3) para un jugador en la jugada
  // actual, o 0 si no está cubriendo una posición de emergencia.
  function getPenalty(state, playerId) {
    return (state && state.penalties.get(playerId)) || 0;
  }

  const exportsObj = {
    validateLineup,
    describeValidationErrors,
    buildRotationState,
    getOnCourtFive,
    accumulatePlayedTime,
    runSubstitutionWindow,
    isDeadBallStoppage,
    getPenalty,
    positionDistance,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
