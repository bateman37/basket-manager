// src/core/MatchEngine.js
// Motor de simulación de partidos — FASE 1 (ver DESIGN.md sección 7).
// Convención del proyecto: identificadores en inglés, comentarios en español.
//
// Alcance de esta fase: bucle de posesión (7.1) + Bloque A, 10 acciones
// base (7.6) + Bloque B, 3 caminos de reglamento (7.6). Lee SIEMPRE sus
// fórmulas desde MatchConfig.js, nunca hardcodeadas aquí.
//
// NO incluido en esta fase (llega en fases futuras del motor, no tocado):
// Bloque C (contraataque, tiro sobre bocina, ritmo de posesión, parcial de
// anotación, falta técnica...), Presión de Momento (7.5), Consistencia y
// Fatiga (7.5-bis), modificador de Altura/Envergadura/Peso (7.4), eventos
// destacados/notabilidad (7.7), factor cancha (7.8), racha (7.9).

(function (global) {
  const PlayerCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;
  const ConfigCore = (typeof module !== 'undefined' && module.exports)
    ? require('./MatchConfig.js')
    : global.BasketManager;

  const { TECHNICAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, MENTAL_ATTRIBUTES } = PlayerCore;
  const { CONFIG_BASE, NEUTRAL_ATTRIBUTE } = ConfigCore;

  // --- Lectura de atributos: cada nombre de MatchConfig se busca en el
  // grupo (technical/physical/mental) al que pertenece en Player.js, sin
  // que MatchConfig tenga que saber en cuál vive cada uno. ---
  const ATTRIBUTE_GROUP = {};
  TECHNICAL_ATTRIBUTES.forEach((name) => { ATTRIBUTE_GROUP[name] = 'technical'; });
  PHYSICAL_ATTRIBUTES.forEach((name) => { ATTRIBUTE_GROUP[name] = 'physical'; });
  MENTAL_ATTRIBUTES.forEach((name) => { ATTRIBUTE_GROUP[name] = 'mental'; });

  function getAttribute(player, name) {
    const group = ATTRIBUTE_GROUP[name];
    if (!group) {
      throw new Error(`MatchEngine: atributo desconocido "${name}" (revisar MatchConfig.js)`);
    }
    return player[group][name];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Probabilidad de tiro (subtract/direct): acotada para que ningún tiro
  // sea 100% seguro ni 100% imposible, aunque las diferencias de rating
  // sean extremas.
  function clampShotProbability(p) {
    return clamp(p, 0.05, 0.95);
  }

  // Probabilidad de sucesos de reglamento (faltas/violación): rango propio,
  // más bajo, porque son sucesos poco frecuentes por posesión.
  function clampEventProbability(p) {
    return clamp(p, 0.01, 0.6);
  }

  // Rating ponderado de una mezcla de atributos (2-5 atributos, pesos que
  // suman 1 — DESIGN.md 7.3). `overrides` permite sustituir en tiempo de
  // ejecución una clave "comodín" del mix (ej. 'shotAttribute' del Tapón,
  // que se resuelve a insideShot o layup según qué tiro se está taponando).
  function computeMixRating(player, mix, overrides) {
    let weightedSum = 0;
    let weightTotal = 0;
    Object.entries(mix).forEach(([attrName, weight]) => {
      const resolvedName = (overrides && overrides[attrName]) || attrName;
      weightedSum += getAttribute(player, resolvedName) * weight;
      weightTotal += weight;
    });
    return weightTotal > 0 ? weightedSum / weightTotal : NEUTRAL_ATTRIBUTE;
  }

  // Método "resta" (7.3): tiros. probabilidad = intercepto + sensibilidad *
  // (rating ofensivo - rating defensivo).
  function subtractProbability(action, primaryPlayer, secondaryPlayer) {
    const primaryRating = computeMixRating(primaryPlayer, action.primary);
    const secondaryRating = computeMixRating(secondaryPlayer, action.secondary);
    return clampShotProbability(action.intercept + action.sensitivity * (primaryRating - secondaryRating));
  }

  // Tiro libre: sin defensor, referencia el rating neutro de la escala 1-20.
  function directProbability(action, player) {
    const primaryRating = computeMixRating(player, action.primary);
    return clampShotProbability(action.intercept + action.sensitivity * (primaryRating - NEUTRAL_ATTRIBUTE));
  }

  // Método "cociente" (7.3): pérdidas/robos/rebotes/tapón/balón suelto.
  // Cociente crudo primaryRating/(primaryRating+secondaryRating) — sin más,
  // esto da ~50% siempre que los dos ratings son parecidos, lo cual vale
  // para sucesos genuinamente parejos (robo condicionado, balón suelto),
  // pero es demasiado alto para sucesos raros por posesión (pérdida,
  // rebote ofensivo, tapón: ~13%/28%/10% reales). Cuando la acción define
  // `baseProbability`, se usa como ancla de calibración: con ratings
  // exactamente parejos (cociente=0.5) la probabilidad final ES
  // baseProbability, y escala proporcionalmente por encima/debajo según la
  // ventaja de atributos de cada lado. `favors` indica cuál de los dos
  // lados corresponde al suceso que se está preguntando (ej. en Pérdida de
  // balón, favors:'secondary' porque el suceso "hay pérdida" ocurre cuando
  // gana el defensor, no el manejador).
  function computeEventProbability(action, primaryPlayer, secondaryPlayer, overrides) {
    const primaryRating = computeMixRating(primaryPlayer, action.primary, overrides && overrides.primary);
    const secondaryRating = computeMixRating(secondaryPlayer, action.secondary, overrides && overrides.secondary);
    const primaryShare = primaryRating / (primaryRating + secondaryRating);
    const favoredShare = action.favors === 'secondary' ? (1 - primaryShare) : primaryShare;
    if (action.baseProbability === undefined) {
      // Sin ancla: suceso ya razonablemente parejo (robo condicionado,
      // balón suelto) — se acota igual que un tiro, para que nunca sea 100%
      // seguro ni 100% imposible.
      return clampShotProbability(favoredShare);
    }
    return clampEventProbability(action.baseProbability * (favoredShare / 0.5));
  }

  // --- Selección de jugadores en pista (placeholder de Fase 1) ---
  // NO es un sistema de rotaciones/tácticas: solo pondera a los 5 primeros
  // de la convocatoria (titulares) con más probabilidad de estar en pista
  // que el resto (banquillo), tal como pide la Parte 2 de la tarea.
  const STARTER_COUNT = 5;
  const STARTER_WEIGHT = 3;
  const BENCH_WEIGHT = 1;

  function pickWeighted(items, weightFn) {
    const weights = items.map(weightFn);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      if (roll < weights[i]) return items[i];
      roll -= weights[i];
    }
    return items[items.length - 1];
  }

  function selectOnCourtFive(squad) {
    const pool = squad.map((player, index) => ({
      player,
      weight: index < STARTER_COUNT ? STARTER_WEIGHT : BENCH_WEIGHT,
    }));
    const chosen = [];
    while (chosen.length < 5 && pool.length > 0) {
      const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
      let roll = Math.random() * totalWeight;
      let pickedIndex = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        if (roll < pool[i].weight) { pickedIndex = i; break; }
        roll -= pool[i].weight;
      }
      chosen.push(pool[pickedIndex].player);
      pool.splice(pickedIndex, 1);
    }
    return chosen;
  }

  // "Quién lleva el balón": ponderado por manejo/visión/tiro — placeholder
  // de uso (usage), no un sistema de tácticas de reparto de balón.
  function usageWeight(player) {
    return getAttribute(player, 'ballHandling') + getAttribute(player, 'gameVision')
      + getAttribute(player, 'outsideShot') + getAttribute(player, 'midRangeShot')
      + getAttribute(player, 'insideShot') + getAttribute(player, 'layup') + 1;
  }

  // "Quién defiende de cerca": ponderado por atributos defensivos —
  // placeholder de emparejamiento, no un sistema de asignaciones tácticas.
  function onBallDefenderWeight(player) {
    return getAttribute(player, 'perimeterDefense') + getAttribute(player, 'interiorDefense')
      + getAttribute(player, 'stealing') + 1;
  }

  function averageAttribute(players, name) {
    return players.reduce((sum, p) => sum + getAttribute(p, name), 0) / players.length;
  }

  // --- Reloj de posesión (7.1) ---
  // Duración de "paso" hasta el siguiente suceso decisivo de la posesión.
  // Sustituye aquí a "Ritmo de posesión" (acción 18, Bloque C, no
  // implementada todavía): peor VisiónJuego media del quinteto atacante →
  // más probable que el paso se alargue y agote el reloj (violación,
  // acción 13). No es una fórmula de DESIGN.md, es la forma elegida de
  // hacer que la duración de posesión no sea fija (7.1) sin necesitar el
  // sistema de ritmo completo.
  function pickPossessionStepSeconds(shotClockRemaining, avgGameVision) {
    const baseMax = 18;
    const visionFactor = NEUTRAL_ATTRIBUTE / Math.max(avgGameVision, 1);
    const adjustedMax = Math.max(4, Math.min(baseMax * visionFactor, shotClockRemaining + 6));
    const min = 3;
    return min + Math.random() * (adjustedMax - min);
  }

  function pickShotType(player) {
    const weights = {
      threePointShot: getAttribute(player, 'outsideShot') + 1,
      midRangeShot: getAttribute(player, 'midRangeShot') + 1,
      insideShot: getAttribute(player, 'insideShot') + 1,
      layup: getAttribute(player, 'layup') + 1,
    };
    const entries = Object.entries(weights);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [key, w] of entries) {
      if (roll < w) return key;
      roll -= w;
    }
    return entries[entries.length - 1][0];
  }

  // --- Box score ---
  function getStatLine(boxScore, player) {
    if (!boxScore.has(player.id)) {
      boxScore.set(player.id, {
        playerId: player.id,
        name: player.fullName,
        points: 0,
        fieldGoals: {
          threePointShot: { made: 0, attempted: 0 },
          midRangeShot: { made: 0, attempted: 0 },
          insideShot: { made: 0, attempted: 0 },
          layup: { made: 0, attempted: 0 },
        },
        freeThrows: { made: 0, attempted: 0 },
        reboundsOffensive: 0,
        reboundsDefensive: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        personalFouls: 0,
      });
    }
    return boxScore.get(player.id);
  }

  function recordFieldGoalAttempt(boxScore, player, shotType, made) {
    const stat = getStatLine(boxScore, player);
    stat.fieldGoals[shotType].attempted += 1;
    if (made) {
      stat.fieldGoals[shotType].made += 1;
      stat.points += shotType === 'threePointShot' ? 3 : 2;
    }
  }

  function recordFreeThrowAttempt(boxScore, player, made) {
    const stat = getStatLine(boxScore, player);
    stat.freeThrows.attempted += 1;
    if (made) {
      stat.freeThrows.made += 1;
      stat.points += 1;
    }
  }

  function recordRebound(boxScore, player, type) {
    const stat = getStatLine(boxScore, player);
    if (type === 'offensive') stat.reboundsOffensive += 1;
    else stat.reboundsDefensive += 1;
  }

  function recordSteal(boxScore, player) { getStatLine(boxScore, player).steals += 1; }
  function recordBlock(boxScore, player) { getStatLine(boxScore, player).blocks += 1; }
  function recordTurnover(boxScore, player) { getStatLine(boxScore, player).turnovers += 1; }
  function recordPersonalFoul(boxScore, player) { getStatLine(boxScore, player).personalFouls += 1; }

  // --- Bloque A: acciones individuales ---

  // 6. Pérdida de balón — computeEventProbability ya aplica favors +
  // baseProbability (ancla ~13%, ver MatchConfig).
  function rollTurnover(ballHandler, defender, config) {
    const action = config.actions.turnover;
    return Math.random() < computeEventProbability(action, ballHandler, defender);
  }

  // 7. Robo de balón — sub-tirada, solo si ya hay pérdida (acción 6): decide
  // si se acredita como robo del defensor o pérdida genérica sin robo.
  function rollSteal(defender, ballHandler, config) {
    const action = config.actions.steal;
    return Math.random() < computeEventProbability(action, defender, ballHandler);
  }

  // 9. Tapón — solo se tira en Tiro interior/Bandeja (7.3-bis: únicos con
  // mezcla de resistencia definida). 'shotAttribute' se resuelve al tiro
  // concreto que se está intentando. baseProbability ancla ~10%.
  function rollBlock(blocker, shooter, shotType, config) {
    const action = config.actions.block;
    const p = computeEventProbability(action, blocker, shooter, { secondary: { shotAttribute: shotType } });
    return Math.random() < p;
  }

  // 8/10. Rebote y Lucha por balón suelto comparten los mismos dos
  // candidatos (reboteador ofensivo/defensivo); una pequeña probabilidad de
  // que la disputa se resuelva como balón suelto en vez de rebote normal.
  function resolveReboundContest(offenseFive, defenseFive, boxScore, config) {
    const offRebounder = pickWeighted(offenseFive, (p) => getAttribute(p, 'offensiveRebound')
      + getAttribute(p, 'jumping') * 0.5 + getAttribute(p, 'strength') * 0.5 + 1);
    const defRebounder = pickWeighted(defenseFive, (p) => getAttribute(p, 'defensiveRebound')
      + getAttribute(p, 'jumping') * 0.5 + getAttribute(p, 'positioning') * 0.5 + 1);

    const looseBallAction = config.actions.looseBall;
    let offenseWins;
    if (Math.random() < looseBallAction.triggerProbability) {
      offenseWins = Math.random() < computeEventProbability(looseBallAction, offRebounder, defRebounder);
    } else {
      offenseWins = Math.random() < computeEventProbability(config.actions.rebound, offRebounder, defRebounder);
    }

    if (offenseWins) {
      recordRebound(boxScore, offRebounder, 'offensive');
      return { offensiveRebound: true };
    }
    recordRebound(boxScore, defRebounder, 'defensive');
    return { offensiveRebound: false };
  }

  // --- Bloque B: caminos de reglamento ---

  // 11. Falta defensiva (fuera de tiro). Sin mezcla secundaria (no depende
  // del atacante) — se escala directamente por foulTendency respecto al
  // valor neutro. Fatiga(defensor) queda fuera de esta fase (7.5-bis no
  // implementado) — TODO: sumarla cuando llegue.
  function rollDefensiveFoul(defender, config) {
    const action = config.actions.defensiveFoul;
    const rating = computeMixRating(defender, action.primary);
    const scaled = action.baseProbability * (rating / NEUTRAL_ATTRIBUTE);
    return Math.random() < clampEventProbability(scaled);
  }

  // 12. Falta en tiro: cociente TendenciaAFalta(defensor) vs
  // Fuerza+Agresividad(atacante), anclado a baseProbability (~18%).
  function rollShootingFoul(defender, attacker, config) {
    const action = config.actions.shootingFoul;
    return Math.random() < computeEventProbability(action, defender, attacker);
  }

  // Tiros libres en cadena (bonus, and-one, o falta en tiro con 2/3 tl).
  function resolveFreeThrowsSequence(shooter, count, boxScore, config) {
    const action = config.actions.freeThrow;
    let pointsMade = 0;
    let lastMade = false;
    for (let i = 0; i < count; i++) {
      const made = Math.random() < directProbability(action, shooter);
      recordFreeThrowAttempt(boxScore, shooter, made);
      if (made) pointsMade += 1;
      lastMade = made;
    }
    return { pointsMade, lastMade, timeSpent: count * 2 }; // ~2s por tiro libre, aproximación simple
  }

  // Tras cualquier secuencia de tiros libres: si el último entra, la
  // posesión cambia; si falla, se disputa un rebote (regla real: solo el
  // último libre está "vivo" para rebote).
  function handleFreeThrowSequence(shooter, count, offenseFive, defenseFive, boxScore, config) {
    const ft = resolveFreeThrowsSequence(shooter, count, boxScore, config);
    if (ft.lastMade) {
      return { pointsMade: ft.pointsMade, timeSpent: ft.timeSpent, possessionContinues: false };
    }
    const rebound = resolveReboundContest(offenseFive, defenseFive, boxScore, config);
    return {
      pointsMade: ft.pointsMade,
      timeSpent: ft.timeSpent,
      possessionContinues: rebound.offensiveRebound,
    };
  }

  // --- Una posesión completa (puede encadenar varios intentos si hay
  // rebote ofensivo o falta defensiva sin bonus) ---
  const MAX_POSSESSION_ITERATIONS = 12; // guarda de seguridad anti-bucle-infinito

  function simulatePossession(offenseTeam, defenseTeam, offenseSquad, defenseSquad, teamFouls, config, boxScore) {
    let shotClock = config.match.shotClockSeconds;
    let elapsedTotal = 0;
    let pointsScored = 0;
    const events = [];

    for (let iteration = 0; iteration < MAX_POSSESSION_ITERATIONS; iteration++) {
      const offenseFive = selectOnCourtFive(offenseSquad);
      const defenseFive = selectOnCourtFive(defenseSquad);
      const ballHandler = pickWeighted(offenseFive, usageWeight);
      const onBallDefender = pickWeighted(defenseFive, onBallDefenderWeight);

      const step = pickPossessionStepSeconds(shotClock, averageAttribute(offenseFive, 'gameVision'));
      if (step >= shotClock) {
        // 13. Violación de reloj de posesión — se agota el reloj sin tiro.
        elapsedTotal += shotClock;
        recordTurnover(boxScore, ballHandler);
        events.push({ type: 'shotClockViolation', playerId: ballHandler.id });
        return { elapsed: elapsedTotal, points: pointsScored, events };
      }
      elapsedTotal += step;
      shotClock -= step;

      // 11. Falta defensiva (fuera de tiro)
      if (rollDefensiveFoul(onBallDefender, config)) {
        teamFouls[defenseTeam.id] = (teamFouls[defenseTeam.id] || 0) + 1;
        recordPersonalFoul(boxScore, onBallDefender);
        events.push({ type: 'defensiveFoul', playerId: onBallDefender.id });

        if (teamFouls[defenseTeam.id] >= config.match.teamFoulBonusThreshold) {
          const result = handleFreeThrowSequence(ballHandler, 2, offenseFive, defenseFive, boxScore, config);
          pointsScored += result.pointsMade;
          elapsedTotal += result.timeSpent;
          if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
          return { elapsed: elapsedTotal, points: pointsScored, events };
        }
        // Sin bonus: saque de banda, la posesión sigue con el mismo equipo
        // y el mismo reloj restante (simplificación: FIBA resetea a 14s si
        // quedaban menos de 14s, no modelado aquí).
        continue;
      }

      // 6. Pérdida de balón (+ 7. Robo, sub-tirada)
      if (rollTurnover(ballHandler, onBallDefender, config)) {
        if (rollSteal(onBallDefender, ballHandler, config)) {
          recordSteal(boxScore, onBallDefender);
          events.push({ type: 'steal', playerId: onBallDefender.id });
        } else {
          events.push({ type: 'turnover', playerId: ballHandler.id });
        }
        recordTurnover(boxScore, ballHandler);
        return { elapsed: elapsedTotal, points: pointsScored, events };
      }

      // Selección de tiro (heurística de Fase 1: ponderada por el propio
      // atributo de tiro del jugador, no un sistema de tácticas de ataque).
      const shotType = pickShotType(ballHandler);
      const isPerimeterShot = shotType === 'threePointShot' || shotType === 'midRangeShot';
      const shotDefender = isPerimeterShot
        ? pickWeighted(defenseFive, (p) => getAttribute(p, 'perimeterDefense') + 1)
        : pickWeighted(defenseFive, (p) => getAttribute(p, 'interiorDefense') + 1);

      // 12. Falta en tiro (se decide antes de resolver el tiro, para saber
      // si cabe tapón o el contacto ya se resuelve como falta)
      const hasShootingFoul = rollShootingFoul(shotDefender, ballHandler, config);

      let blocked = false;
      if (!hasShootingFoul && !isPerimeterShot) {
        // 9. Tapón (solo Tiro interior/Bandeja)
        blocked = rollBlock(shotDefender, ballHandler, shotType, config);
      }

      const shotAction = config.actions[shotType];
      const made = !blocked && Math.random() < subtractProbability(shotAction, ballHandler, shotDefender);
      recordFieldGoalAttempt(boxScore, ballHandler, shotType, made);
      if (blocked) {
        recordBlock(boxScore, shotDefender);
        events.push({ type: 'blockedShot', playerId: ballHandler.id, defenderId: shotDefender.id, shotType });
      }

      if (hasShootingFoul) {
        recordPersonalFoul(boxScore, shotDefender);
        // Las faltas en tiro también cuentan para el total de faltas de
        // equipo (aunque ya den tiros libres por sí mismas, siempre) —
        // regla real FIBA/ACB: toda falta personal suma al contador que
        // activa el bonus para las FUTURAS faltas defensivas del cuarto.
        teamFouls[defenseTeam.id] = (teamFouls[defenseTeam.id] || 0) + 1;
        const isThree = shotType === 'threePointShot';
        if (made) {
          // "And-one": la canasta sube y se añade 1 tiro libre extra.
          pointsScored += isThree ? 3 : 2;
          const result = handleFreeThrowSequence(ballHandler, 1, offenseFive, defenseFive, boxScore, config);
          pointsScored += result.pointsMade;
          elapsedTotal += result.timeSpent;
          events.push({ type: 'shootingFoulAndOne', playerId: ballHandler.id });
          if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
          return { elapsed: elapsedTotal, points: pointsScored, events };
        }
        const result = handleFreeThrowSequence(ballHandler, isThree ? 3 : 2, offenseFive, defenseFive, boxScore, config);
        pointsScored += result.pointsMade;
        elapsedTotal += result.timeSpent;
        events.push({ type: 'shootingFoul', playerId: ballHandler.id });
        if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
        return { elapsed: elapsedTotal, points: pointsScored, events };
      }

      if (made) {
        pointsScored += shotType === 'threePointShot' ? 3 : 2;
        events.push({ type: 'fieldGoalMade', playerId: ballHandler.id, shotType });
        return { elapsed: elapsedTotal, points: pointsScored, events };
      }

      // Fallo (limpio o taponado): se disputa el rebote.
      events.push({ type: 'fieldGoalMiss', playerId: ballHandler.id, shotType });
      const rebound = resolveReboundContest(offenseFive, defenseFive, boxScore, config);
      if (rebound.offensiveRebound) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
      return { elapsed: elapsedTotal, points: pointsScored, events };
    }

    // Guarda de seguridad: si tras MAX_POSSESSION_ITERATIONS no se resolvió
    // (caso extremo, no debería ocurrir con las probabilidades base), se
    // corta la posesión aquí para no bucle infinito.
    events.push({ type: 'possessionSafetyGuard' });
    return { elapsed: elapsedTotal, points: pointsScored, events };
  }

  // Toma hasta 12 jugadores de la plantilla como convocatoria de partido
  // por defecto (reutiliza Team.buildMatchSquad, que valida 8-12).
  function defaultMatchSquad(team) {
    const count = Math.min(12, team.roster.length);
    const ids = team.roster.slice(0, count).map((player) => player.id);
    return team.buildMatchSquad(ids);
  }

  // --- Partido completo ---
  function simulateMatch(homeTeam, awayTeam, config = CONFIG_BASE) {
    const homeSquad = defaultMatchSquad(homeTeam);
    const awaySquad = defaultMatchSquad(awayTeam);
    const boxScore = new Map();
    const quarterScores = { home: [], away: [] };
    const finalScore = { home: 0, away: 0 };

    // Simplificación de Fase 1: no se modela el salto inicial (jump ball);
    // el equipo local empieza siempre con la posesión del primer cuarto.
    let offenseSide = 'home';

    for (let quarter = 1; quarter <= config.match.quarters; quarter++) {
      const teamFouls = { [homeTeam.id]: 0, [awayTeam.id]: 0 };
      let clockRemaining = (config.match.durationMinutes * 60) / config.match.quarters;
      const quarterPoints = { home: 0, away: 0 };

      while (clockRemaining > 0) {
        const offenseTeam = offenseSide === 'home' ? homeTeam : awayTeam;
        const defenseTeam = offenseSide === 'home' ? awayTeam : homeTeam;
        const offenseSquad = offenseSide === 'home' ? homeSquad : awaySquad;
        const defenseSquad = offenseSide === 'home' ? awaySquad : homeSquad;

        const result = simulatePossession(
          offenseTeam, defenseTeam, offenseSquad, defenseSquad, teamFouls, config, boxScore,
        );

        // Simplificación de Fase 1: el final de cuarto solo se comprueba
        // ENTRE posesiones, no dentro de una posesión en curso — una
        // posesión que empieza justo antes de la bocina se resuelve entera.
        clockRemaining -= result.elapsed;
        quarterPoints[offenseSide] += result.points;
        offenseSide = offenseSide === 'home' ? 'away' : 'home';
      }

      quarterScores.home.push(quarterPoints.home);
      quarterScores.away.push(quarterPoints.away);
      finalScore.home += quarterPoints.home;
      finalScore.away += quarterPoints.away;
    }

    return {
      finalScore,
      quarterScores,
      boxScore: {
        home: homeSquad.map((player) => getStatLine(boxScore, player)),
        away: awaySquad.map((player) => getStatLine(boxScore, player)),
      },
    };
  }

  const exportsObj = { simulateMatch, defaultMatchSquad };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
