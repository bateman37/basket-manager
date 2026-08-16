// src/core/MatchEngine.js
// Motor de simulación de partidos — FASE 1 + FASE 2 (ver DESIGN.md sección 7).
// Convención del proyecto: identificadores en inglés, comentarios en español.
//
// FASE 1: bucle de posesión (7.1) + Bloque A (10 acciones base) + Bloque B
// (3 caminos de reglamento). Lee SIEMPRE sus fórmulas desde MatchConfig.js.
//
// FASE 2 (esta entrega): Modificador de Altura/Envergadura/Peso (7.4),
// Presión de Momento (7.5), Consistencia y Fatiga (7.5-bis), y el Bloque C
// completo (7.6: contraataque, tapón con mate, tiro sobre bocina de
// posesión/cuarto, ritmo de posesión, últimos segundos, parcial de
// anotación, falta técnica).
//
// NO incluido todavía (fases futuras, no tocado aquí): sistema de selección
// y presentación de eventos destacados/notabilidad (7.7 — varias piezas del
// Bloque C solo MARCAN el momento con un flag/tipo de evento, ver comentarios
// "TODO Fase 3"), factor cancha (7.8), mecánica completa de Racha más allá
// del uso simplificado que se le da aquí al parcial de anotación (7.9).

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

  // --- 7.5-bis Fatiga: atributos con impacto leve (tiro) y pesado (físicos
  // puros + los técnicos "físicos" que sostienen Rebote/Robo/Defensa, ya
  // que DESIGN.md habla de esas ACCIONES viéndose muy afectadas, y ninguna
  // de ellas usa un atributo suelto de Agilidad/Velocidad en su mezcla). ---
  const FATIGUE_LIGHT_ATTRIBUTES = ['outsideShot', 'midRangeShot', 'insideShot', 'layup'];
  const FATIGUE_HEAVY_ATTRIBUTES = [
    'jumping', 'topSpeed', 'acceleration', 'agility', 'strength', 'balance',
    'offensiveRebound', 'defensiveRebound', 'stealing', 'perimeterDefense', 'interiorDefense', 'blocking',
  ];

  // Nivel de fatiga 0 (fresco) a 1 (agotado), a partir de dynamicState.energy.
  function fatigueLevel(player) {
    return (100 - player.dynamicState.energy) / 100;
  }

  // Aplica la Fatiga sobre el valor de UN atributo concreto. foulTendency es
  // el único que SUBE con la fatiga (un jugador cansado comete más faltas,
  // 7.5-bis "Conexión con Falta defensiva"); el resto de atributos con
  // impacto definido BAJAN, nunca por debajo de 1 (mínimo de la escala).
  function applyFatigueToValue(rawValue, attrName, player, config) {
    const level = fatigueLevel(player);
    if (attrName === 'foulTendency') {
      return rawValue + level * config.fatigue.foulTendencyBonusMax;
    }
    if (FATIGUE_LIGHT_ATTRIBUTES.indexOf(attrName) !== -1) {
      return Math.max(1, rawValue - level * config.fatigue.lightImpactMax);
    }
    if (FATIGUE_HEAVY_ATTRIBUTES.indexOf(attrName) !== -1) {
      return Math.max(1, rawValue - level * config.fatigue.heavyImpactMax);
    }
    return rawValue;
  }

  // Consumo de Energía por los 10 jugadores en pista en esta iteración,
  // modulado por Resistencia (7.5-bis). Recuperación entre partidos queda
  // fuera de esta tarea (pertenece al ciclo de calendario/temporada).
  function applyFatigueConsumption(players, config) {
    players.forEach((player) => {
      const stamina = getAttribute(player, 'stamina');
      const consumption = config.fatigue.baseEnergyPerPossession * (NEUTRAL_ATTRIBUTE / Math.max(stamina, 1));
      player.adjustEnergy(-consumption);
    });
  }

  // --- 7.5: Presión de Momento ---
  // Mentales que de verdad aparecen como peso en alguna mezcla de 7.6 (ver
  // nota en MatchConfig.js: Temperamento y Consistencia no son peso de
  // ninguna mezcla, así que la reponderación de Presión no les afecta aquí).
  const PRESSURE_MENTALS = ['pressureDecisionMaking', 'concentration'];

  // presión = f(tiempo_restante, diferencia_marcador), 0 a 1. Fórmula propia
  // (DESIGN.md deja la fórmula exacta a decidir): producto de dos factores
  // 0-1 — solo es alta cuando AMBOS son altos (partido ajustado Y en su
  // recta final), tal como piden los ejemplos de DESIGN.md 7.5 ("no es lo
  // mismo faltar 5 min ganando de 30 que ganando de 4").
  function computePressure(totalGameSecondsRemaining, scoreDiff, config) {
    const timeFactor = clamp(1 - totalGameSecondsRemaining / config.pressure.timeHorizonSeconds, 0, 1);
    const scoreFactor = clamp(1 - scoreDiff / config.pressure.scoreHorizonPoints, 0, 1);
    return clamp(timeFactor * scoreFactor, 0, 1);
  }

  // Rating ponderado de una mezcla de atributos (2-5 atributos, pesos que
  // suman 1 — DESIGN.md 7.3), aplicando ANTES de ponderar: Fatiga (sobre el
  // valor de cada atributo) y Presión (reponderación de mentales relevantes
  // + bonus de Experiencia acotado). `overrides` permite sustituir en
  // tiempo de ejecución una clave "comodín" del mix (ej. 'shotAttribute').
  function computeMixRating(player, mix, config, pressure, overrides) {
    let weightedSum = 0;
    let weightTotal = 0;
    Object.entries(mix).forEach(([attrName, baseWeight]) => {
      const resolvedName = (overrides && overrides[attrName]) || attrName;
      let value = applyFatigueToValue(getAttribute(player, resolvedName), resolvedName, player, config);
      let weight = baseWeight;

      if (pressure > 0 && PRESSURE_MENTALS.indexOf(resolvedName) !== -1) {
        weight = baseWeight * (1 + config.pressure.mentalWeightBoost * pressure);
        const experienceBonus = Math.min(
          config.pressure.maxExperienceBonus,
          (player.experience / config.pressure.experienceBonusDivisor) * pressure,
        );
        value += experienceBonus;
      } else if (pressure > 0) {
        weight = baseWeight * Math.max(0, 1 - config.pressure.technicalWeightPenalty * pressure);
      }

      weightedSum += value * weight;
      weightTotal += weight;
    });
    return weightTotal > 0 ? weightedSum / weightTotal : NEUTRAL_ATTRIBUTE;
  }

  // --- 7.4: Modificador de Altura/Envergadura/Peso ---
  // Eje 1 (envergadura relativa, wingspan-height): bono/malus acotado sobre
  // el RATING del lado marcado en la acción (no sobre un atributo suelto),
  // porque DESIGN.md lo describe como un efecto sobre el resultado de la
  // acción en su conjunto ("beneficia a Tiro interior", no a un atributo
  // concreto dentro de esa mezcla).
  //
  // Eje 2 (altura/peso vs agilidad): DESIGN.md dice que "resta del propio
  // atributo Agilidad/Velocidad", pero ninguna mezcla de 7.6 usa un atributo
  // suelto de agilidad/velocidad — el efecto descrito (peor Defensa
  // perimetral, peor Pérdida de balón en transición del atacante alto) se
  // implementa aquí como una resta directa sobre el RATING del lado
  // marcado, con la misma magnitud acotada, en vez de sobre un atributo
  // aislado que no existe en esas mezclas. Es una interpretación de
  // implementación, no una cifra o mecanismo validado con Dennis.
  function applyHeightAxisModifiers(rating, player, action, side, config) {
    let adjusted = rating;
    const axis1Direction = action.heightAxis1 && action.heightAxis1[side];
    if (axis1Direction) {
      const diff = player.bodyMeasurements.wingspan - player.bodyMeasurements.height;
      let bonus = clamp(
        diff * config.heightModifiers.axis1BonusPerCm,
        -config.heightModifiers.axis1MaxBonus,
        config.heightModifiers.axis1MaxBonus,
      );
      if (action.heightAxis1Multiplier) bonus *= action.heightAxis1Multiplier;
      adjusted += axis1Direction === 'penalize' ? -bonus : bonus;
    }
    if (action.heightAxis2 && action.heightAxis2[side]) {
      const excessCm = player.bodyMeasurements.height - config.heightModifiers.axis2ThresholdCm;
      if (excessCm > 0) {
        adjusted -= Math.min(excessCm * config.heightModifiers.axis2TaxPerCm, config.heightModifiers.axis2MaxTax);
      }
    }
    return adjusted;
  }

  // --- 7.5-bis: Consistencia (ruido transversal) ---
  // Genera ruido gaussiano simple (Box-Muller) en vez de uniforme, para que
  // la mayoría de las variaciones sean pequeñas y las extremas sean raras
  // — más fiel a "varianza" que un ruido uniforme.
  function gaussianRandom() {
    const u1 = Math.max(Math.random(), 1e-9);
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // Aplica el ruido de Consistencia del jugador PROTAGONISTA de la acción
  // (siempre `primary`, ver convención de MatchConfig) a una probabilidad
  // ya calculada — "todas las probabilidades de ese jugador, en todas las
  // acciones" (DESIGN.md 7.5-bis).
  function applyConsistencyNoise(probability, protagonist, config, clampFn) {
    const consistency = getAttribute(protagonist, 'consistency');
    const sigma = config.consistency.maxSigma * (1 - (consistency - 1) / 19);
    const noisy = probability + gaussianRandom() * sigma;
    return clampFn(noisy);
  }

  // Método "resta" (7.3): tiros. Aplica modificadores de altura tras la
  // mezcla base, y ruido de Consistencia sobre el resultado final.
  function subtractProbability(action, primaryPlayer, secondaryPlayer, config, pressure, extraAdjustment) {
    let primaryRating = computeMixRating(primaryPlayer, action.primary, config, pressure);
    primaryRating = applyHeightAxisModifiers(primaryRating, primaryPlayer, action, 'primary', config);
    let secondaryRating = computeMixRating(secondaryPlayer, action.secondary, config, pressure);
    secondaryRating = applyHeightAxisModifiers(secondaryRating, secondaryPlayer, action, 'secondary', config);
    const base = action.intercept + action.sensitivity * (primaryRating - secondaryRating) + (extraAdjustment || 0);
    return applyConsistencyNoise(clampShotProbability(base), primaryPlayer, config, clampShotProbability);
  }

  // Tiro libre: sin defensor, referencia el rating neutro de la escala 1-20.
  function directProbability(action, player, config, pressure) {
    const primaryRating = computeMixRating(player, action.primary, config, pressure);
    const base = action.intercept + action.sensitivity * (primaryRating - NEUTRAL_ATTRIBUTE);
    return applyConsistencyNoise(clampShotProbability(base), player, config, clampShotProbability);
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
  // lados corresponde al suceso que se está preguntando.
  function computeEventProbability(action, primaryPlayer, secondaryPlayer, config, pressure, overrides, extraAdjustment) {
    let primaryRating = computeMixRating(primaryPlayer, action.primary, config, pressure, overrides && overrides.primary);
    primaryRating = applyHeightAxisModifiers(primaryRating, primaryPlayer, action, 'primary', config);
    let secondaryRating = computeMixRating(secondaryPlayer, action.secondary, config, pressure, overrides && overrides.secondary);
    secondaryRating = applyHeightAxisModifiers(secondaryRating, secondaryPlayer, action, 'secondary', config);

    const primaryShare = primaryRating / (primaryRating + secondaryRating);
    const favoredShare = action.favors === 'secondary' ? (1 - primaryShare) : primaryShare;
    const base = action.baseProbability === undefined
      ? favoredShare
      : action.baseProbability * (favoredShare / 0.5);
    const withAdjustment = base + (extraAdjustment || 0);
    const clampFn = action.baseProbability === undefined ? clampShotProbability : clampEventProbability;
    return applyConsistencyNoise(clampFn(withAdjustment), primaryPlayer, config, clampFn);
  }

  // --- Selección de jugadores en pista (placeholder de Fase 1) ---
  // NO es un sistema de rotaciones/tácticas: solo pondera a los 5 primeros
  // de la convocatoria (titulares) con más probabilidad de estar en pista
  // que el resto (banquillo).
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
  // Peor VisiónJuego media del quinteto atacante → más probable agotar el
  // reloj (violación, acción 13). `tempoBias` (7.6.18, ligado al ADN de
  // Club) acorta el paso medio para equipos de ritmo rápido y lo alarga
  // para equipos pausados.
  // `fastBreakWindow`: cuando la posesión viene de una transición elegible
  // (7.6.14), el primer paso se sortea en un rango más corto y con un suelo
  // más bajo (1s en vez de 3s) — de otro modo el suelo normal (3s) coincide
  // justo con el umbral de la ventana de contraataque (<3s) y esta casi
  // nunca llega a activarse (probado por simulación: con el suelo de 3s la
  // ventana solo se solapaba en el borde exacto, prácticamente nunca).
  function pickPossessionStepSeconds(shotClockRemaining, avgGameVision, tempoBias, config, fastBreakWindow) {
    if (fastBreakWindow) {
      const min = 1;
      const max = Math.min(8, shotClockRemaining);
      return min + Math.random() * Math.max(1, max - min);
    }
    const visionFactor = NEUTRAL_ATTRIBUTE / Math.max(avgGameVision, 1);
    const tempoFactor = 1 - tempoBias * config.tempo.stepReductionFactor;
    const baseMax = 18 * tempoFactor;
    const adjustedMax = Math.max(4, Math.min(baseMax * visionFactor, shotClockRemaining + 6));
    const min = 3;
    return min + Math.random() * (Math.max(min + 1, adjustedMax) - min);
  }

  function getTempoBias(team, config) {
    const bias = config.tempo.dnaBias[team.clubDNA];
    return bias === undefined ? config.tempo.defaultBias : bias;
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
        technicalFouls: 0,
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
  function recordTechnicalFoul(boxScore, player) { getStatLine(boxScore, player).technicalFouls += 1; }

  // --- Bloque A: acciones individuales ---

  function rollTurnover(ballHandler, defender, config, pressure) {
    const action = config.actions.turnover;
    return Math.random() < computeEventProbability(action, ballHandler, defender, config, pressure);
  }

  function rollSteal(defender, ballHandler, config, pressure) {
    const action = config.actions.steal;
    return Math.random() < computeEventProbability(action, defender, ballHandler, config, pressure);
  }

  function rollBlock(blocker, shooter, shotType, config, pressure) {
    const action = config.actions.block;
    const p = computeEventProbability(action, blocker, shooter, config, pressure, { secondary: { shotAttribute: shotType } });
    return Math.random() < p;
  }

  // 8/10. Rebote y Lucha por balón suelto comparten los mismos dos
  // candidatos (reboteador ofensivo/defensivo); una pequeña probabilidad de
  // que la disputa se resuelva como balón suelto en vez de rebote normal.
  // También clasifica el rebote defensivo como "largo" o no (7.6.14,
  // criterio propio: DESIGN.md no da una regla exacta, solo la idea de
  // "se aleja del aro" — aquí se aproxima como una probabilidad fija).
  function resolveReboundContest(offenseFive, defenseFive, boxScore, config, pressure) {
    const offRebounder = pickWeighted(offenseFive, (p) => getAttribute(p, 'offensiveRebound')
      + getAttribute(p, 'jumping') * 0.5 + getAttribute(p, 'strength') * 0.5 + 1);
    const defRebounder = pickWeighted(defenseFive, (p) => getAttribute(p, 'defensiveRebound')
      + getAttribute(p, 'jumping') * 0.5 + getAttribute(p, 'positioning') * 0.5 + 1);

    const looseBallAction = config.actions.looseBall;
    let offenseWins;
    if (Math.random() < looseBallAction.triggerProbability) {
      offenseWins = Math.random() < computeEventProbability(looseBallAction, offRebounder, defRebounder, config, pressure);
    } else {
      offenseWins = Math.random() < computeEventProbability(config.actions.rebound, offRebounder, defRebounder, config, pressure);
    }

    if (offenseWins) {
      recordRebound(boxScore, offRebounder, 'offensive');
      return { offensiveRebound: true, isLongRebound: false };
    }
    recordRebound(boxScore, defRebounder, 'defensive');
    const isLongRebound = Math.random() < config.fastBreak.longReboundProbability;
    return { offensiveRebound: false, isLongRebound };
  }

  // --- Bloque B: caminos de reglamento ---

  // 11. Falta defensiva (fuera de tiro). Sin mezcla secundaria (no depende
  // del atacante) — se escala directamente por foulTendency (ya con Fatiga
  // aplicada dentro de computeMixRating) respecto al valor neutro.
  function rollDefensiveFoul(defender, config, pressure) {
    const action = config.actions.defensiveFoul;
    const rating = computeMixRating(defender, action.primary, config, pressure);
    const scaled = action.baseProbability * (rating / NEUTRAL_ATTRIBUTE);
    return Math.random() < clampEventProbability(scaled);
  }

  function rollShootingFoul(defender, attacker, config, pressure) {
    const action = config.actions.shootingFoul;
    return Math.random() < computeEventProbability(action, defender, attacker, config, pressure);
  }

  // Tiros libres en cadena (bonus, and-one, o falta en tiro con 2/3 tl).
  function resolveFreeThrowsSequence(shooter, count, boxScore, config, pressure) {
    const action = config.actions.freeThrow;
    let pointsMade = 0;
    let lastMade = false;
    for (let i = 0; i < count; i++) {
      const made = Math.random() < directProbability(action, shooter, config, pressure);
      recordFreeThrowAttempt(boxScore, shooter, made);
      if (made) pointsMade += 1;
      lastMade = made;
    }
    return { pointsMade, lastMade, timeSpent: count * 2 }; // ~2s por tiro libre, aproximación simple
  }

  // Tras cualquier secuencia de tiros libres: si el último entra, la
  // posesión cambia; si falla, se disputa un rebote (regla real: solo el
  // último libre está "vivo" para rebote).
  function handleFreeThrowSequence(shooter, count, offenseFive, defenseFive, boxScore, config, pressure) {
    const ft = resolveFreeThrowsSequence(shooter, count, boxScore, config, pressure);
    if (ft.lastMade) {
      return { pointsMade: ft.pointsMade, timeSpent: ft.timeSpent, possessionContinues: false };
    }
    const rebound = resolveReboundContest(offenseFive, defenseFive, boxScore, config, pressure);
    return {
      pointsMade: ft.pointsMade,
      timeSpent: ft.timeSpent,
      possessionContinues: rebound.offensiveRebound,
      isLongRebound: rebound.isLongRebound,
    };
  }

  // --- Bloque C: acciones especiales (moduladores contextuales) ---

  // 21. Falta técnica/antideportiva: ligada a Temperamento muy bajo bajo
  // Presión muy alta. Solo la probabilidad de que ocurra — el escalado a
  // expulsión queda pendiente (DESIGN.md lo marca explícitamente sin
  // definir), no se implementa aquí.
  function rollTechnicalFoul(player, pressure, config) {
    if (pressure < config.technicalFoul.pressureThreshold) return false;
    const temperament = getAttribute(player, 'temperament');
    if (temperament >= config.technicalFoul.temperamentThreshold) return false;
    const severity = (config.technicalFoul.temperamentThreshold - temperament) / config.technicalFoul.temperamentThreshold;
    const probability = config.technicalFoul.baseProbability * (1 + severity) * pressure;
    return Math.random() < probability;
  }

  // Resuelve una falta técnica: 1 tiro libre para el equipo rival (elegido
  // por el mismo criterio de "uso" que el resto del motor) y el juego
  // continúa con la misma posesión (no cambia el turno) — regla real FIBA.
  function handleTechnicalFoul(offender, opposingFive, boxScore, config, pressure) {
    recordPersonalFoul(boxScore, offender);
    recordTechnicalFoul(boxScore, offender);
    const shooter = pickWeighted(opposingFive, usageWeight);
    const made = Math.random() < directProbability(config.actions.freeThrow, shooter, config, pressure);
    recordFreeThrowAttempt(boxScore, shooter, made);
    return made ? 1 : 0;
  }

  // --- Una posesión completa (puede encadenar varios intentos si hay
  // rebote ofensivo o falta defensiva sin bonus) ---
  const MAX_POSSESSION_ITERATIONS = 12; // guarda de seguridad anti-bucle-infinito

  // `context`: { pressure, quarterClockRemaining, fastBreakEligible,
  // offenseTempoBias, scoringRunActiveSide, offenseSide, defenseSide }.
  function simulatePossession(offenseTeam, defenseTeam, offenseSquad, defenseSquad, teamFouls, config, boxScore, context) {
    let shotClock = config.match.shotClockSeconds;
    let elapsedTotal = 0;
    let pointsScored = 0;
    let defensePoints = 0; // puntos para el equipo defensor (solo vía falta técnica del atacante)
    const events = [];
    const { pressure } = context;

    for (let iteration = 0; iteration < MAX_POSSESSION_ITERATIONS; iteration++) {
      const offenseFive = selectOnCourtFive(offenseSquad);
      const defenseFive = selectOnCourtFive(defenseSquad);
      applyFatigueConsumption(offenseFive.concat(defenseFive), config); // 7.5-bis: consumo de Energía

      const ballHandler = pickWeighted(offenseFive, usageWeight);
      const onBallDefender = pickWeighted(defenseFive, onBallDefenderWeight);

      // 7.6.19: últimos segundos de cuarto sin tiempo de jugada completa —
      // fuerza un paso corto (no da tiempo a desarrollar la jugada normal).
      const quarterClockAtIterationStart = context.quarterClockRemaining - elapsedTotal;
      const noFullPlayTime = quarterClockAtIterationStart < config.lateClock.noFullPlayThresholdSeconds;

      const fastBreakWindow = context.fastBreakEligible && iteration === 0;
      let step = pickPossessionStepSeconds(
        shotClock, averageAttribute(offenseFive, 'gameVision'), context.offenseTempoBias, config, fastBreakWindow,
      );
      if (noFullPlayTime) step = Math.min(step, Math.max(1, quarterClockAtIterationStart * 0.6));

      if (step >= shotClock) {
        // 13. Violación de reloj de posesión — se agota el reloj sin tiro.
        elapsedTotal += shotClock;
        recordTurnover(boxScore, ballHandler);
        events.push({ type: 'shotClockViolation', playerId: ballHandler.id });
        return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: true };
      }
      elapsedTotal += step;
      shotClock -= step;

      // 21. Falta técnica (Bloque C) — no cambia el turno, se comprueba
      // sobre los dos jugadores más "en la jugada" de esta iteración.
      if (rollTechnicalFoul(onBallDefender, pressure, config)) {
        teamFouls[defenseTeam.id] = (teamFouls[defenseTeam.id] || 0) + 1;
        pointsScored += handleTechnicalFoul(onBallDefender, offenseFive, boxScore, config, pressure);
        events.push({ type: 'technicalFoul', playerId: onBallDefender.id });
      } else if (rollTechnicalFoul(ballHandler, pressure, config)) {
        teamFouls[offenseTeam.id] = (teamFouls[offenseTeam.id] || 0) + 1;
        defensePoints += handleTechnicalFoul(ballHandler, defenseFive, boxScore, config, pressure);
        events.push({ type: 'technicalFoul', playerId: ballHandler.id });
      }

      // 11. Falta defensiva (fuera de tiro)
      if (rollDefensiveFoul(onBallDefender, config, pressure)) {
        teamFouls[defenseTeam.id] = (teamFouls[defenseTeam.id] || 0) + 1;
        recordPersonalFoul(boxScore, onBallDefender);
        events.push({ type: 'defensiveFoul', playerId: onBallDefender.id });

        if (teamFouls[defenseTeam.id] >= config.match.teamFoulBonusThreshold) {
          const result = handleFreeThrowSequence(ballHandler, 2, offenseFive, defenseFive, boxScore, config, pressure);
          pointsScored += result.pointsMade;
          elapsedTotal += result.timeSpent;
          if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
          return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false };
        }
        // Sin bonus: saque de banda, la posesión sigue con el mismo equipo
        // y el mismo reloj restante (simplificación: FIBA resetea a 14s si
        // quedaban menos de 14s, no modelado aquí).
        continue;
      }

      // 6. Pérdida de balón (+ 7. Robo, sub-tirada)
      if (rollTurnover(ballHandler, onBallDefender, config, pressure)) {
        if (rollSteal(onBallDefender, ballHandler, config, pressure)) {
          recordSteal(boxScore, onBallDefender);
          events.push({ type: 'steal', playerId: onBallDefender.id });
        } else {
          events.push({ type: 'turnover', playerId: ballHandler.id });
        }
        recordTurnover(boxScore, ballHandler);
        return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: true };
      }

      // Selección de tiro (heurística de Fase 1: ponderada por el propio
      // atributo de tiro del jugador, no un sistema de tácticas de ataque).
      const shotType = pickShotType(ballHandler);
      const isPerimeterShot = shotType === 'threePointShot' || shotType === 'midRangeShot';
      const shotDefender = isPerimeterShot
        ? pickWeighted(defenseFive, (p) => getAttribute(p, 'perimeterDefense') + 1)
        : pickWeighted(defenseFive, (p) => getAttribute(p, 'interiorDefense') + 1);

      // 7.6.14: Contraataque — solo en la primera iteración de una posesión
      // nueva elegible, dentro de la ventana de segundos configurada.
      const isFastBreakWindow = context.fastBreakEligible && iteration === 0
        && elapsedTotal <= config.fastBreak.windowSeconds;

      // 7.6.16/17: tiro sobre la bocina de posesión/cuarto-partido.
      const isPossessionBuzzer = shotClock < config.pressure.shotClockBuzzerSeconds;
      const isGameBuzzer = (quarterClockAtIterationStart - step) < config.pressure.buzzerBeaterSecondsThreshold;
      let shotPressure = pressure;
      if (isGameBuzzer) {
        shotPressure = 1; // 7.6.17: presión al máximo
        events.push({ type: 'buzzerBeaterAttempt', playerId: ballHandler.id }); // TODO Fase 3: notabilidad (7.7)
      } else if (isPossessionBuzzer) {
        shotPressure = clamp(pressure + 0.3, 0, 1); // 7.6.16: sube la presión local
      }

      let shotAdjustment = 0;
      if (isPossessionBuzzer || isGameBuzzer || noFullPlayTime) {
        shotAdjustment -= config.pressure.forcedShotPenalty; // tiro forzado
      }
      if (isFastBreakWindow && shotType === 'layup') {
        shotAdjustment += (getAttribute(ballHandler, 'acceleration') / 20) * config.fastBreak.maxBonus;
        events.push({ type: 'fastBreak', playerId: ballHandler.id });
      }
      if (context.scoringRunActiveSide === context.offenseSide) {
        shotAdjustment += config.scoringRun.probabilityEffect;
      } else if (context.scoringRunActiveSide === context.defenseSide) {
        shotAdjustment -= config.scoringRun.probabilityEffect;
      }

      // 12. Falta en tiro (se decide antes de resolver el tiro, para saber
      // si cabe tapón o el contacto ya se resuelve como falta)
      const hasShootingFoul = rollShootingFoul(shotDefender, ballHandler, config, shotPressure);

      let blocked = false;
      if (!hasShootingFoul && !isPerimeterShot) {
        // 9. Tapón (solo Tiro interior/Bandeja)
        blocked = rollBlock(shotDefender, ballHandler, shotType, config, shotPressure);
        if (blocked) {
          // 7.6.15: Tapón con mate — margen amplio del compuesto = evento de
          // alta notabilidad, sin cambiar la fórmula. Aproximación: compara
          // el rating del taponador contra el del finalizador; si la
          // diferencia es grande, se marca. TODO Fase 3: sistema real de
          // notabilidad (7.7), esto solo deja el flag preparado.
          const blockerRating = computeMixRating(shotDefender, config.actions.block.primary, config, shotPressure);
          const shooterRating = computeMixRating(ballHandler, config.actions.block.secondary, config, shotPressure, { shotAttribute: shotType });
          if (blockerRating - shooterRating > config.dunkBlock.ratingMargin) {
            events.push({ type: 'dunkBlock', playerId: shotDefender.id }); // TODO Fase 3: notabilidad
          }
        }
      }

      const shotAction = config.actions[shotType];
      const made = !blocked && Math.random() < subtractProbability(shotAction, ballHandler, shotDefender, config, shotPressure, shotAdjustment);
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
          const result = handleFreeThrowSequence(ballHandler, 1, offenseFive, defenseFive, boxScore, config, pressure);
          pointsScored += result.pointsMade;
          elapsedTotal += result.timeSpent;
          events.push({ type: 'shootingFoulAndOne', playerId: ballHandler.id });
          if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
          return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false };
        }
        const result = handleFreeThrowSequence(ballHandler, isThree ? 3 : 2, offenseFive, defenseFive, boxScore, config, pressure);
        pointsScored += result.pointsMade;
        elapsedTotal += result.timeSpent;
        events.push({ type: 'shootingFoul', playerId: ballHandler.id });
        if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
        return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false };
      }

      if (made) {
        pointsScored += shotType === 'threePointShot' ? 3 : 2;
        events.push({ type: 'fieldGoalMade', playerId: ballHandler.id, shotType });
        return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false };
      }

      // Fallo (limpio o taponado): se disputa el rebote.
      events.push({ type: 'fieldGoalMiss', playerId: ballHandler.id, shotType });
      const rebound = resolveReboundContest(offenseFive, defenseFive, boxScore, config, pressure);
      if (rebound.offensiveRebound) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
      return {
        elapsed: elapsedTotal,
        points: pointsScored,
        defensePoints,
        events,
        fastBreakTrigger: blocked || rebound.isLongRebound,
      };
    }

    // Guarda de seguridad: si tras MAX_POSSESSION_ITERATIONS no se resolvió
    // (caso extremo, no debería ocurrir con las probabilidades base), se
    // corta la posesión aquí para no bucle infinito.
    events.push({ type: 'possessionSafetyGuard' });
    return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false };
  }

  // Toma hasta 12 jugadores de la plantilla como convocatoria de partido
  // por defecto (reutiliza Team.buildMatchSquad, que valida 8-12).
  function defaultMatchSquad(team) {
    const count = Math.min(12, team.roster.length);
    const ids = team.roster.slice(0, count).map((player) => player.id);
    return team.buildMatchSquad(ids);
  }

  // 7.6.20: Parcial de anotación — ventana deslizante simplificada (no es el
  // sistema completo de eventos/notabilidad de 7.7, solo la detección y el
  // modificador de equipo). Sigue la racha de puntos consecutivos SIN
  // respuesta del rival; en cuanto un equipo distinto anota, la racha se
  // reinicia a su favor. `activeSide` queda marcado mientras el total
  // acumulado supere el umbral.
  function updateScoringRun(scoringRun, side, pointsScored, config) {
    if (pointsScored <= 0) return; // una posesión sin canasta no rompe ni construye el parcial
    if (scoringRun.side === side) {
      scoringRun.points += pointsScored;
    } else {
      scoringRun.side = side;
      scoringRun.points = pointsScored;
    }
    scoringRun.activeSide = scoringRun.points >= config.scoringRun.threshold ? scoringRun.side : null;
  }

  // --- Partido completo ---
  function simulateMatch(homeTeam, awayTeam, config = CONFIG_BASE) {
    const homeSquad = defaultMatchSquad(homeTeam);
    const awaySquad = defaultMatchSquad(awayTeam);
    const boxScore = new Map();
    const quarterScores = { home: [], away: [] };
    const runningScore = { home: 0, away: 0 };
    // 7.6.20: en vez de tocar dynamicState.momentum de jugadores concretos
    // (requeriría exponer qué cinco están en pista fuera de
    // simulatePossession, que los re-elige cada iteración), el parcial de
    // equipo se modela como un modificador de equipo aparte y más simple —
    // decisión explícita permitida por la tarea ("o un modificador de
    // equipo si te parece más limpio").
    const scoringRun = { side: null, points: 0, activeSide: null };
    let fastBreakEligible = false;
    const eventLog = [];

    // Simplificación de Fase 1: no se modela el salto inicial (jump ball);
    // el equipo local empieza siempre con la posesión del primer cuarto.
    let offenseSide = 'home';

    const quarterLength = (config.match.durationMinutes * 60) / config.match.quarters;

    for (let quarter = 1; quarter <= config.match.quarters; quarter++) {
      const teamFouls = { [homeTeam.id]: 0, [awayTeam.id]: 0 };
      let clockRemaining = quarterLength;
      const quarterPoints = { home: 0, away: 0 };

      while (clockRemaining > 0) {
        const offenseTeam = offenseSide === 'home' ? homeTeam : awayTeam;
        const defenseTeam = offenseSide === 'home' ? awayTeam : homeTeam;
        const offenseSquad = offenseSide === 'home' ? homeSquad : awaySquad;
        const defenseSquad = offenseSide === 'home' ? awaySquad : homeSquad;
        const defenseSide = offenseSide === 'home' ? 'away' : 'home';

        // 7.5: presión, calculada UNA vez por posesión (tiempo total
        // restante de PARTIDO, no solo del cuarto, y diferencia absoluta
        // de marcador en curso).
        const quartersRemainingAfterThis = config.match.quarters - quarter;
        const totalGameSecondsRemaining = clockRemaining + quartersRemainingAfterThis * quarterLength;
        const scoreDiff = Math.abs(runningScore.home - runningScore.away);
        const pressure = computePressure(totalGameSecondsRemaining, scoreDiff, config);

        const context = {
          pressure,
          quarterClockRemaining: clockRemaining,
          fastBreakEligible,
          offenseTempoBias: getTempoBias(offenseTeam, config),
          scoringRunActiveSide: scoringRun.activeSide,
          offenseSide,
          defenseSide,
        };

        const result = simulatePossession(
          offenseTeam, defenseTeam, offenseSquad, defenseSquad, teamFouls, config, boxScore, context,
        );

        // Simplificación de Fase 1: el final de cuarto solo se comprueba
        // ENTRE posesiones, no dentro de una posesión en curso.
        clockRemaining -= result.elapsed;
        quarterPoints[offenseSide] += result.points;
        quarterPoints[defenseSide] += result.defensePoints;
        runningScore[offenseSide] += result.points;
        runningScore[defenseSide] += result.defensePoints;

        updateScoringRun(scoringRun, offenseSide, result.points, config);
        if (result.defensePoints > 0) updateScoringRun(scoringRun, defenseSide, result.defensePoints, config);
        fastBreakEligible = result.fastBreakTrigger;

        // Log interno de eventos (Bloque C incluido) con contexto de cuándo
        // ocurrieron — sirve para verificar los sistemas de esta fase
        // (contraataques, parciales, tapones con mate...) y de base para el
        // futuro sistema de selección de eventos destacados (7.7, Fase 3):
        // aquí solo se ACUMULA el log completo, no se filtra ni presenta.
        result.events.forEach((event) => {
          eventLog.push({ ...event, quarter, offenseSide });
        });

        offenseSide = defenseSide;
      }

      quarterScores.home.push(quarterPoints.home);
      quarterScores.away.push(quarterPoints.away);
    }

    return {
      finalScore: runningScore,
      quarterScores,
      boxScore: {
        home: homeSquad.map((player) => getStatLine(boxScore, player)),
        away: awaySquad.map((player) => getStatLine(boxScore, player)),
      },
      eventLog,
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
