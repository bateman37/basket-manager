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

  // Slots por posición (Bloque de tarea "Alineación por slots + Minutos de
  // la basura"): cada una de las 5 posiciones tiene un slot de titular y dos
  // de suplente. Un mismo playerId puede repetirse en varios slots/filas sin
  // bloquearlo — sustituye al modelo anterior de "una entrada por jugador",
  // que no podía representar a un jugador ocupando dos slots a la vez con
  // minutos independientes que se suman a su total.
  const SLOT_KEYS = ['starter', 'sub1', 'sub2'];

  // --- C.1/C.2: construcción y validación de la alineación ---
  //
  // Shape de `lineup` (construido por la pantalla de Alineación):
  // {
  //   entries: {
  //     Base: {
  //       starter: { playerId: string|null, minutesQuota: number },
  //       sub1: { playerId: string|null, minutesQuota: number },
  //       sub2: { playerId: string|null, minutesQuota: number },
  //     },
  //     Escolta: { ... }, Alero: { ... }, 'Ala-pívot': { ... }, Pívot: { ... },
  //   },
  //   fixedSegments: [ // opcional, C.2 "quintetos fijos"
  //     { label: string, trigger: { fromPeriod, scoreCondition: 'ahead'|'behind'|'any' },
  //       five: { Base: playerId, Escolta: playerId, ... } },
  //   ],
  //   garbageTime: { enabled: boolean }, // opcional, DESIGN.md 7.11.2-bis — por partido, no global
  // }

  // Recorre los 3 slots de las 5 posiciones y suma los minutos totales de
  // cada jugador (todas sus apariciones, en la misma fila o en varias) —
  // hace falta para el consumo de Energía (minutos reales en pista) y para
  // mostrarlo de un vistazo en la pantalla de Alineación.
  function totalMinutesByPlayer(lineup) {
    const totals = {};
    POSITIONS.forEach((pos) => {
      const row = (lineup.entries && lineup.entries[pos]) || {};
      SLOT_KEYS.forEach((slotKey) => {
        const slot = row[slotKey];
        if (!slot || !slot.playerId) return;
        totals[slot.playerId] = (totals[slot.playerId] || 0) + (slot.minutesQuota || 0);
      });
    });
    return totals;
  }

  // Suma de minutos declarados por posición (los 3 slots de cada fila).
  // Validación estricta (C.2): debe cuadrar EXACTAMENTE con la duración
  // total del partido (config.match.durationMinutes, nunca 40 fijo en
  // código) para cada una de las 5 posiciones — si no, se bloquea con el
  // detalle de qué posiciones fallan y en cuánto, sin normalizar
  // automáticamente.
  function validateLineup(lineup, config) {
    const totalMinutes = config.match.durationMinutes;
    const sums = {};
    POSITIONS.forEach((pos) => {
      const row = (lineup.entries && lineup.entries[pos]) || {};
      sums[pos] = SLOT_KEYS.reduce((acc, slotKey) => acc + ((row[slotKey] && row[slotKey].minutesQuota) || 0), 0);
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

  // LIFE-3 (DESIGN.md 9.14, sección 21 del prompt de esa sesión):
  // `medicalAvailability` — Map opcional `playerId -> { status, minuteCap }`
  // (mismo shape que devuelve `Medical.getAvailability()`), calculada por
  // quien construye el MatchState (MatchEngine.createMatchState) para toda
  // la convocatoria. `undefined`/`null` reproduce el comportamiento HEAD
  // previo a esta entrega (ninguna restricción médica) — Rotation.js NUNCA
  // llama a Medical.js directamente, solo consume el mapa ya resuelto.
  function buildRotationState(lineup, squad, config, medicalAvailability) {
    const players = new Map(squad.map((player) => [player.id, player]));

    // Jugadores médicamente no disponibles YA al construir el estado
    // (debería ser raro: la convocatoria/CpuLineup ya deberían haberlos
    // excluido, pero se protege por robustez — invariante 10).
    const unavailablePlayerIds = new Set();
    if (medicalAvailability) {
      medicalAvailability.forEach((info, playerId) => {
        if (info.status === 'unavailable') unavailablePlayerIds.add(playerId);
      });
    }

    // bySlot: lista plana de playerIds declarados en cada posición (los 3
    // slots de la fila), para "cobertura propia" en considerSlotSubstitution
    // — no necesita distinguir de qué slot viene cada id, solo si tiene
    // minutos declarados en esa fila. Los no disponibles quedan fuera de
    // "cobertura propia" desde el principio (invariante 9: la sustitución
    // forzada nunca los vuelve a considerar).
    const bySlot = {};
    POSITIONS.forEach((pos) => {
      const row = (lineup.entries && lineup.entries[pos]) || {};
      bySlot[pos] = SLOT_KEYS.map((slotKey) => row[slotKey] && row[slotKey].playerId)
        .filter((id) => id && !unavailablePlayerIds.has(id));
    });

    // quotaSeconds sigue siendo por jugador (no por slot): si un jugador
    // aparece en varios slots/filas, su cuota es la SUMA de todas ellas —
    // ver totalMinutesByPlayer(). LIFE-3 (sección 16 del prompt de esa
    // sesión): un jugador `limited` nunca puede acumular más que su
    // `minuteCap` médico entre TODOS sus slots — se recorta aquí, en la
    // propia cuota que ya rige la sustitución por ritmo/agotamiento, sin
    // inventar un segundo mecanismo de tope.
    const totalsMinutes = totalMinutesByPlayer(lineup);
    const quotaSeconds = new Map(Object.entries(totalsMinutes).map(([id, minutes]) => {
      const info = medicalAvailability && medicalAvailability.get(id);
      const capMinutes = info && info.status === 'limited' && info.minuteCap !== null && info.minuteCap !== undefined
        ? info.minuteCap : null;
      const effectiveMinutes = capMinutes !== null ? Math.min(minutes, capMinutes) : minutes;
      return [id, effectiveMinutes * 60];
    }));

    const playedSeconds = new Map(squad.map((player) => [player.id, 0]));

    // LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2, sección 17 del
    // prompt de esta sesión): minutos REALES por jugador Y posición
    // ocupada en pista — necesario para acelerar el aprendizaje posicional
    // con minutos reales en la posición entrenada (no inferidos de
    // `nominalPosition`). Tracking puramente factual, no cambia ninguna
    // regla de sustitución/penalización POS ya existente.
    const positionSeconds = new Map(squad.map((player) => [player.id, {}]));

    // Quinteto inicial: usa directamente el slot "starter" de cada fila (ya
    // no hace falta inferirlo por mayor cuota, el modelo de slots lo declara
    // explícitamente) — si el starter de una posición está vacío, se cubre
    // igualmente vía polivalencia de emergencia en la primera ventana de
    // sustitución.
    const onCourt = {};
    POSITIONS.forEach((pos) => {
      const row = (lineup.entries && lineup.entries[pos]) || {};
      const starterId = (row.starter && row.starter.playerId) || null;
      onCourt[pos] = (starterId && !unavailablePlayerIds.has(starterId)) ? starterId : null;
    });

    // LIFE-4 (DESIGN.md 9.4, sección 13 del prompt de esa sesión): "starts"
    // factual — el quinteto inicial REAL (slot "starter" de cada fila, ya
    // disponible médicamente), fotografiado una sola vez aquí, antes de
    // cualquier sustitución. Nunca se infiere titularidad por minutos en
    // ningún otro punto del código — esto NO cambia selección/sustitución,
    // solo la registra para consumo posterior (PlayerCareer.js).
    const starterIds = POSITIONS.map((pos) => onCourt[pos]).filter(Boolean);

    return {
      lineup,
      config,
      players,
      bySlot,
      quotaSeconds,
      playedSeconds,
      positionSeconds,
      onCourt,
      starterIds,
      penalties: new Map(), // playerId -> penalización de rendimiento activa (C.3)
      fixedSegmentActive: null,
      totalGameSeconds: config.match.durationMinutes * 60,
      // DESIGN.md 7.11.2-bis: activo/inactivo, evaluado en cada ventana de
      // sustitución (updateGarbageTimeState) de forma independiente por equipo.
      garbageTimeActive: false,
      // LIFE-3 (DESIGN.md 9.14, sección 21): jugadores médicamente NO
      // disponibles para este partido — bloqueados globalmente en
      // cualquier slot/posición, incluidos los que se lesionan EN DIRECTO
      // durante el propio partido (ver markPlayerUnavailable() más abajo).
      unavailablePlayerIds,
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
      // LIFE-2: mismos segundos, desglosados también por la posición
      // concreta que el jugador ocupaba en pista en este instante.
      const byPosition = state.positionSeconds.get(id) || {};
      byPosition[pos] = (byPosition[pos] || 0) + seconds;
      state.positionSeconds.set(id, byPosition);
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
  // los declarados en `slot`) — DESIGN.md 7.11.3, revisión mini-EPIC POS:
  // el mayor nivel REAL de competencia en esa posición (mapa de 5, C.0) es
  // toda la información necesaria para elegir; la distancia posicional
  // geométrica ya no interviene (contabilizaría dos veces la misma idea
  // una vez existe un mapa 1-20 explícito y siempre presente). Desempate
  // por mayor cuota de minutos restante.
  // `forceIgnoreQuota` (LIFE-3, sección 21 del prompt de esa sesión):
  // sustitución médica forzada — "no exige cuota restante". Sigue
  // excluyendo siempre a `state.unavailablePlayerIds` (invariante 9: un
  // jugador lesionado nunca vuelve a pista aunque aparezca en otros slots).
  function chooseEmergencyCandidate(state, slot, excludeIds, forceIgnoreQuota) {
    const config = state.config;
    let best = null;
    let bestScore = -Infinity;
    state.players.forEach((player, playerId) => {
      if (excludeIds.has(playerId) || state.unavailablePlayerIds.has(playerId)) return;
      const quota = state.quotaSeconds.get(playerId) || 0;
      const played = state.playedSeconds.get(playerId) || 0;
      const remaining = quota - played;
      if (remaining <= 0 && !forceIgnoreQuota) return;
      const score = player.positionLevel(slot);
      if (score > bestScore || (score === bestScore && remaining > (state.quotaSeconds.get(best) - state.playedSeconds.get(best)))) {
        best = playerId;
        bestScore = score;
      }
    });
    if (!best) return null;
    const level = state.players.get(best).positionLevel(slot);
    // Penalización diferenciada por tipo de atributo (DESIGN.md 7.11.3,
    // mini-EPIC POS): los atributos de "responsabilidad posicional"
    // reciben la penalización COMPLETA de la curva no lineal;
    // "habilidad pura" recibe solo una fracción reducida
    // (config.positions.pureSkillPenaltyFraction) — MatchEngine.
    // computeMixRating aplica cada una según
    // config.positions.attributeCategory.
    const basePenalty = config.emergencyVersatility.basePenalty
      * Math.pow(1 - level / 20, config.positions.competencePenaltyExponent);
    const penalty = {
      responsibilityPenalty: basePenalty,
      pureSkillPenalty: basePenalty * config.positions.pureSkillPenaltyFraction,
    };
    return { playerId: best, level, penalty };
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
      if (id === currentId || onCourtIds.has(id) || state.unavailablePlayerIds.has(id)) return false;
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
      return {
        position: slot, outId: currentId, inId: bestId, emergency: false,
        penalty: { responsibilityPenalty: 0, pureSkillPenalty: 0 },
      };
    }

    // 2) Sin cobertura propia: C.3 polivalencia de emergencia.
    const excludeIds = new Set([...onCourtIds, currentId]);
    const candidate = chooseEmergencyCandidate(state, slot, excludeIds);
    if (!candidate) return null; // no hay nadie disponible: se queda quien está, aunque agote cuota
    state.onCourt[slot] = candidate.playerId;
    state.penalties.set(candidate.playerId, candidate.penalty);
    return { position: slot, outId: currentId, inId: candidate.playerId, emergency: true, penalty: candidate.penalty };
  }

  // --- DESIGN.md 7.11.2-bis: "Minutos de la basura" ---
  //
  // Umbrales de tiempo de partido a partir de los que cada margen empieza a
  // evaluarse: "desde la mitad del 3er cuarto" / "desde la mitad del 4º
  // cuarto", expresados como segundos totales transcurridos de partido (no
  // dependen del número de período en curso, así que siguen siendo válidos
  // sin cambios si el partido llega a prórroga).
  function garbageTimeThresholds(config) {
    const quarterLength = (config.match.durationMinutes * 60) / config.match.quarters;
    return {
      midThirdQuarterSeconds: 2.5 * quarterLength,
      midFourthQuarterSeconds: 3.5 * quarterLength,
    };
  }

  // Evaluado de forma independiente para CADA equipo (se llama una vez por
  // cada `state` — uno por equipo — en cada ventana de sustitución).
  // `matchState.scoreDiff` positivo = este equipo va ganando.
  function updateGarbageTimeState(state, matchState) {
    const config = state.config;
    const gtLineupConfig = state.lineup.garbageTime;
    const gtConfig = config.garbageTime;
    if (!gtLineupConfig || !gtLineupConfig.enabled || !gtConfig) {
      state.garbageTimeActive = false;
      return;
    }
    const diff = matchState.scoreDiff;
    if (state.garbageTimeActive) {
      // Se mantiene activo aunque la diferencia fluctúe, hasta bajar al
      // margen de salida o menos.
      if (Math.abs(diff) <= gtConfig.marginToExit) {
        state.garbageTimeActive = false;
      }
      return;
    }
    const { midThirdQuarterSeconds, midFourthQuarterSeconds } = garbageTimeThresholds(config);
    if (diff > 0 && matchState.elapsedSeconds >= midThirdQuarterSeconds && diff >= gtConfig.marginToEnter) {
      state.garbageTimeActive = true;
    } else if (diff < 0 && matchState.elapsedSeconds >= midFourthQuarterSeconds && -diff >= gtConfig.marginToEnter) {
      state.garbageTimeActive = true;
    }
  }

  // Sustitución de "minutos de la basura" para UNA posición: deja de exigir
  // cuota y mete banquillo con orden fijo Suplente 2 > Suplente 1 > Titular.
  // LIFE-3 (DESIGN.md 9.14, sección 21): cada candidato de esa cadena se
  // salta si está médicamente no disponible — si los tres lo están, cae en
  // la polivalencia de emergencia normal (ignorando cuota, igual que el
  // resto de minutos de la basura).
  function considerGarbageTimeSubstitution(state, slot) {
    const row = state.lineup.entries[slot] || {};
    const chain = [row.sub2 && row.sub2.playerId, row.sub1 && row.sub1.playerId, row.starter && row.starter.playerId];
    let desiredId = chain.find((id) => id && !state.unavailablePlayerIds.has(id)) || null;
    const currentId = state.onCourt[slot];
    if (!desiredId || desiredId === currentId) {
      if (!desiredId) {
        const onCourtIds = new Set(POSITIONS.map((pos) => state.onCourt[pos]).filter(Boolean));
        const excludeIds = new Set([...onCourtIds, currentId].filter(Boolean));
        const candidate = chooseEmergencyCandidate(state, slot, excludeIds, true);
        if (candidate) desiredId = candidate.playerId;
      }
      if (!desiredId || desiredId === currentId) return null;
    }
    state.onCourt[slot] = desiredId;
    state.penalties.delete(desiredId);
    return {
      position: slot, outId: currentId, inId: desiredId, emergency: false,
      penalty: { responsibilityPenalty: 0, pureSkillPenalty: 0 }, garbageTime: true,
    };
  }

  // LIFE-3 (DESIGN.md 9.14, secciones 20/21 del prompt de esa sesión):
  // lesión EN DIRECTO durante el partido — retira al jugador DE VERDAD.
  // Bloquea globalmente cualquier slot/posición donde apareciera (no solo
  // la que ocupaba en pista) y fuerza sustitución INMEDIATA, ignorando
  // cuota restante — la salud manda sobre fixed segments/cuota/garbage
  // time (sección 20). Devuelve la entrada de sustitución para el
  // `eventLog` del partido, o `null` si el jugador ni siquiera estaba en
  // pista (convocado con 0 minutos, se marca no disponible igualmente).
  function markPlayerUnavailable(state, playerId) {
    state.unavailablePlayerIds.add(playerId);
    state.penalties.delete(playerId);
    const occupiedPosition = POSITIONS.find((pos) => state.onCourt[pos] === playerId);
    if (!occupiedPosition) return null;
    state.onCourt[occupiedPosition] = null;
    const onCourtIds = new Set(POSITIONS.map((pos) => state.onCourt[pos]).filter(Boolean));
    const candidate = chooseEmergencyCandidate(state, occupiedPosition, onCourtIds, true);
    if (!candidate) return { position: occupiedPosition, outId: playerId, inId: null, emergency: true, medical: true };
    state.onCourt[occupiedPosition] = candidate.playerId;
    state.penalties.set(candidate.playerId, candidate.penalty);
    return {
      position: occupiedPosition, outId: playerId, inId: candidate.playerId,
      emergency: true, medical: true, penalty: candidate.penalty,
    };
  }

  // --- Ventana de sustitución (C.2): solo se llama en fin de cuarto y en
  // paradas de juego (falta/violación) — nunca a mitad de una jugada viva.
  // `matchState`: { period, scoreDiff, elapsedSeconds }.
  function runSubstitutionWindow(state, matchState) {
    // El estado de "minutos de la basura" se actualiza SIEMPRE (incluso
    // dentro de una franja fija), para que la marca no se quede desfasada;
    // pero un quinteto fijo activo sigue mandando sobre la sustitución en sí
    // — decisión de implementación no fijada en DESIGN.md (que no dice cómo
    // interactúan ambos sistemas): un quinteto de cierre que el usuario fijó
    // a propósito no debería deshacerse solo porque se activen minutos de
    // la basura.
    updateGarbageTimeState(state, matchState);

    const activeSegment = findActiveFixedSegment(state.lineup, matchState);
    if (activeSegment) {
      state.fixedSegmentActive = activeSegment;
      POSITIONS.forEach((pos) => {
        const forcedId = activeSegment.five[pos];
        // LIFE-3 (DESIGN.md 9.14, sección 20): la salud manda incluso
        // sobre un quinteto fijo — un jugador lesionado nunca vuelve a
        // pista aunque el usuario lo hubiera fijado de cierre.
        if (forcedId && !state.unavailablePlayerIds.has(forcedId) && state.onCourt[pos] !== forcedId) {
          state.onCourt[pos] = forcedId;
          state.penalties.delete(forcedId);
        }
      });
      return { substitutions: [], fixedSegmentLabel: activeSegment.label };
    }
    state.fixedSegmentActive = null;
    const substitutions = [];
    POSITIONS.forEach((pos) => {
      const change = state.garbageTimeActive
        ? considerGarbageTimeSubstitution(state, pos)
        : considerSlotSubstitution(state, pos, matchState);
      if (change) substitutions.push(change);
    });
    return { substitutions, fixedSegmentLabel: null, garbageTimeActive: state.garbageTimeActive };
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
  // actual — objeto { responsibilityPenalty, pureSkillPenalty } (DESIGN.md
  // 7.11.3, mini-EPIC POS), ambos 0 si no está cubriendo una posición de
  // emergencia.
  function getPenalty(state, playerId) {
    return (state && state.penalties.get(playerId))
      || { responsibilityPenalty: 0, pureSkillPenalty: 0 };
  }

  const exportsObj = {
    SLOT_KEYS,
    validateLineup,
    describeValidationErrors,
    totalMinutesByPlayer,
    buildRotationState,
    getOnCourtFive,
    accumulatePlayedTime,
    runSubstitutionWindow,
    isDeadBallStoppage,
    getPenalty,
    markPlayerUnavailable,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
