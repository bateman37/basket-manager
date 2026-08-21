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
  const RotationCore = (typeof module !== 'undefined' && module.exports)
    ? require('./Rotation.js')
    : global.BasketManager;
  // DESIGN.md 7.12 (Sistema táctico, TAC-1): punto de enganche mínimo
  // hacia el nuevo módulo — MatchEngine.js importa de Tactics.js, nunca al
  // revés (7.12.2). Ver planPnrPossession() más abajo, único punto donde
  // se le pregunta algo a este módulo.
  const TacticsCore = (typeof module !== 'undefined' && module.exports)
    ? require('./Tactics.js')
    : global.BasketManager;

  const { TECHNICAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, MENTAL_ATTRIBUTES, POSITIONS } = PlayerCore;
  const { CONFIG_BASE, NEUTRAL_ATTRIBUTE } = ConfigCore;
  const {
    validateLineup, describeValidationErrors, buildRotationState, getOnCourtFive, accumulatePlayedTime,
    runSubstitutionWindow, isDeadBallStoppage, getPenalty,
  } = RotationCore;
  // DESIGN.md 7.12 (TAC-3): la producción deja de llamar a
  // planPnrPossession directamente y usa planTacticalPossession (playbook +
  // selección real de play-type + continuidad, 7.12.8/7.12.10/7.12.11) —
  // planPnrPossession sigue existiendo en Tactics.js tal cual para tests
  // dirigidos de TAC-1/TAC-2, ver Tactics.js.
  // DESIGN.md 7.12 (TAC-4): defensa avanzada — matchups individuales
  // (resolveMatchupOverride, 7.12.17), press (computePressEffect, 7.12.15)
  // y transición defensiva (computeTransitionDefenseAdjustment, 7.12.20).
  // Zona (7.12.14) y doble equipo completo de poste (7.12.19) NO necesitan
  // un punto de enganche nuevo aquí — viven enteramente dentro de
  // Tactics.planTacticalPossession, que ya recibía defenseTacticalProfile.
  const {
    planTacticalPossession, resolveTransitionAttempt,
    resolveMatchupOverride, computePressEffect, computeTransitionDefenseAdjustment,
    // DESIGN.md 7.12 (TAC-5): motor pausable/GamePlan/situaciones —
    // effectiveTacticalProfile() fusiona TacticalProfile+GamePlan sin que
    // el resto de este archivo (ni de Tactics.js) tenga que enterarse de
    // que existe un GamePlan; resolveSituationType/planSituationalPossession
    // son el punto de enganche del sub-playbook de ATO/BLOB/SLOB/Late
    // Clock/Last Possession (7.12.24).
    effectiveTacticalProfile, resolveSituationType, planSituationalPossession,
    // DESIGN.md 7.12.22 (TAC-6): Familiaridad Táctica — único punto de
    // enganche de producción que necesita este archivo. El resto de la
    // mecánica de tacticalExecution (misread/turnover/defensa) vive
    // ENTERAMENTE dentro de Tactics.planTacticalPossession/
    // planSituationalPossession (ver `tacticalPlan.turnoverExecutionMultiplier`
    // más abajo) — MatchEngine.js no calcula tacticalExecution por su
    // cuenta, solo lo consume y hace crecer la familiaridad al terminar
    // cada posesión.
    updateFamiliarityAfterPossession,
  } = TacticsCore;

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

  // factor_resistencia (7.11.4): acotado por debajo de 1 (config.fatigue.
  // resistanceFactorMax) para que el desgaste nunca llegue a cero, ni con
  // Resistencia (stamina) máxima.
  function resistanceFactor(player, config) {
    const stamina = getAttribute(player, 'stamina');
    return ((stamina - 1) / 19) * config.fatigue.resistanceFactorMax;
  }

  // Consumo GENERAL de Energía (componente mayor, 7.11.4) por los 10
  // jugadores en pista en esta posesión, modulado por Resistencia y — SOLO
  // cuando hay una alineación real (Rotation.js) que sabe qué posición
  // ocupa cada jugador en esta jugada — por un multiplicador según esa
  // posición (más exterior desgasta más). Sin alineación (equipos IA sin
  // lineup, comportamiento de siempre), `positionLookup` es null y el
  // multiplicador queda neutro (1). Recuperación entre partidos queda fuera
  // de esta función (ver Recovery.js, ciclo de calendario/temporada).
  function applyFatigueConsumption(players, config, positionLookup) {
    players.forEach((player) => {
      const slot = positionLookup ? positionLookup(player.id) : null;
      const positionMultiplier = (slot && config.fatigue.positionWearMultiplier[slot] !== undefined)
        ? config.fatigue.positionWearMultiplier[slot] : 1;
      const wear = config.fatigue.baseEnergyPerPossession * positionMultiplier * (1 - resistanceFactor(player, config));
      player.adjustEnergy(-wear);
    });
  }

  // Consumo por INTERVENCIÓN (componente menor, 7.11.4): extra solo para
  // los jugadores que son atributo directo en la acción resuelta esa
  // posesión (ballHandler/onBallDefender siempre; shotDefender y
  // reboteadores cuando aplican — ver simulatePossession).
  function applyInterventionWear(participantIds, playersById, config) {
    participantIds.forEach((id) => {
      const player = playersById.get(id);
      if (!player) return;
      const wear = config.fatigue.baseEnergyPerPossession * config.fatigue.interventionWearMultiplier
        * (1 - resistanceFactor(player, config));
      player.adjustEnergy(-wear);
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
  // `penalty` (7.11.3, C.3): puntos de rating restados al final — jugador
  // cubriendo una posición de emergencia (Rotation.js); 0 si no aplica.
  function computeMixRating(player, mix, config, pressure, overrides, penalty) {
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
    const rating = weightTotal > 0 ? weightedSum / weightTotal : NEUTRAL_ATTRIBUTE;
    return rating - (penalty || 0);
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
  // `penalties` (7.11.3, opcional): { primary, secondary } en puntos de
  // rating, para jugadores cubriendo una posición de emergencia.
  function subtractProbability(action, primaryPlayer, secondaryPlayer, config, pressure, extraAdjustment, penalties) {
    let primaryRating = computeMixRating(primaryPlayer, action.primary, config, pressure, undefined, penalties && penalties.primary);
    primaryRating = applyHeightAxisModifiers(primaryRating, primaryPlayer, action, 'primary', config);
    let secondaryRating = computeMixRating(secondaryPlayer, action.secondary, config, pressure, undefined, penalties && penalties.secondary);
    secondaryRating = applyHeightAxisModifiers(secondaryRating, secondaryPlayer, action, 'secondary', config);
    const base = action.intercept + action.sensitivity * (primaryRating - secondaryRating) + (extraAdjustment || 0);
    return applyConsistencyNoise(clampShotProbability(base), primaryPlayer, config, clampShotProbability);
  }

  // Tiro libre: sin defensor, referencia el rating neutro de la escala 1-20.
  function directProbability(action, player, config, pressure, penalty) {
    const primaryRating = computeMixRating(player, action.primary, config, pressure, undefined, penalty);
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
  function computeEventProbability(action, primaryPlayer, secondaryPlayer, config, pressure, overrides, extraAdjustment, penalties) {
    let primaryRating = computeMixRating(primaryPlayer, action.primary, config, pressure, overrides && overrides.primary, penalties && penalties.primary);
    primaryRating = applyHeightAxisModifiers(primaryRating, primaryPlayer, action, 'primary', config);
    let secondaryRating = computeMixRating(secondaryPlayer, action.secondary, config, pressure, overrides && overrides.secondary, penalties && penalties.secondary);
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

  // --- 7.6 Bloque D (22): Asistencia — estadística simplificada, ver
  // DESIGN.md. Probabilidades de partida como constantes heurísticas
  // locales del motor (no en MatchConfig.js — el prompt de esta sesión
  // pide explícitamente no tocar ese archivo), mismo patrón que
  // STARTER_WEIGHT/BENCH_WEIGHT arriba. Pendientes de calibración.
  const ASSIST_PROBABILITY_BY_SHOT_TYPE = {
    layup: 0.55,
    insideShot: 0.5,
    threePointShot: 0.35,
    midRangeShot: 0.3,
  };

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

  // Traduce el `onCourt` de un RotationState (Rotation.js) a un lookup
  // playerId -> posición ocupada EN ESA JUGADA (7.11.4, C.4) — null si el
  // equipo no tiene alineación real (placeholder de siempre, sin rotación).
  function buildPositionLookup(rotationState) {
    if (!rotationState) return null;
    const map = new Map();
    POSITIONS.forEach((pos) => {
      const id = rotationState.onCourt[pos];
      if (id) map.set(id, pos);
    });
    return (playerId) => map.get(playerId);
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
    const baseMax = config.tempo.stepBaseMaxSeconds * tempoFactor;
    const min = config.tempo.stepMinSeconds;
    const adjustedMax = Math.max(min + 1, Math.min(baseMax * visionFactor, shotClockRemaining + 6));
    return min + Math.random() * (adjustedMax - min);
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
        assists: 0,
        steals: 0,
        blocks: 0,
        blockedAttempts: 0,
        turnovers: 0,
        personalFouls: 0,
        technicalFouls: 0,
        foulsDrawn: 0,
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
  // Tapón recibido (por el lanzador, no el taponador) — necesario aparte
  // para la Valoración (PIR), que penaliza al que se queda sin canasta por
  // tapón de forma distinta a una pérdida normal.
  function recordBlockedAttempt(boxScore, player) { getStatLine(boxScore, player).blockedAttempts += 1; }
  function recordTurnover(boxScore, player) { getStatLine(boxScore, player).turnovers += 1; }
  function recordPersonalFoul(boxScore, player) { getStatLine(boxScore, player).personalFouls += 1; }
  function recordTechnicalFoul(boxScore, player) { getStatLine(boxScore, player).technicalFouls += 1; }
  // Falta recibida (por quien la sufre, simétrico a recordPersonalFoul) —
  // solo en falta en tiro/defensiva (no en técnica, que no tiene un
  // "atacante" claro que la reciba).
  function recordFoulDrawn(boxScore, player) { getStatLine(boxScore, player).foulsDrawn += 1; }
  function recordAssist(boxScore, player) { getStatLine(boxScore, player).assists += 1; }

  // Elige a quién se le apunta la asistencia (Bloque D, 22): ponderado por
  // VisiónJuego + Pase entre los 4 compañeros del anotador en pista, no
  // aleatorio uniforme — así bases/organizadores acumulan más asistencias
  // que pívots, como en la realidad.
  function resolveAssist(offenseFive, scorer, shotType, boxScore) {
    const probability = ASSIST_PROBABILITY_BY_SHOT_TYPE[shotType];
    if (Math.random() >= probability) return;
    const candidates = offenseFive.filter((p) => p.id !== scorer.id);
    if (candidates.length === 0) return;
    const assister = pickWeighted(candidates, (p) => getAttribute(p, 'gameVision') + getAttribute(p, 'passing') + 1);
    recordAssist(boxScore, assister);
  }

  // DESIGN.md 7.12.5 (TAC-3): asistencia causal — sustituye la asignación
  // post-hoc de resolveAssist() SOLO para posesiones con play-type táctico
  // real (tacticalPlan no nulo, ver simulatePossession). `assistCandidate`
  // ya viene resuelto por Tactics.js (quién mantuvo/generó la ventaja
  // pasando el balón antes del tiro) — null si el propio tirador creó su
  // tiro sin pase (Isolation puro, P&R con lectura baja sin continuidad...).
  // A diferencia de resolveAssist(), esto NO es un pickWeighted entre
  // candidatos: el creador ya es un dato conocido de la jugada, no un
  // sorteo entre los 4 compañeros. El bonus de probabilidad por buen
  // pasador (VisiónJuego+Pase+DecisiónBajoPresión, "regla dura" de 7.12.5)
  // decide SI se acredita la asistencia, nunca A QUIÉN.
  function resolveTacticalAssist(assistCandidate, shotType, boxScore, config) {
    if (!assistCandidate) return;
    const baseProbability = ASSIST_PROBABILITY_BY_SHOT_TYPE[shotType];
    const rating = (getAttribute(assistCandidate, 'gameVision') + getAttribute(assistCandidate, 'passing')
      + getAttribute(assistCandidate, 'pressureDecisionMaking')) / 3;
    const boost = config.tactics.assist.playmakingBoostMax * clamp((rating - NEUTRAL_ATTRIBUTE) / NEUTRAL_ATTRIBUTE, -1, 1);
    const probability = clamp(baseProbability + boost, 0.05, 0.98);
    if (Math.random() >= probability) return;
    recordAssist(boxScore, assistCandidate);
  }

  // Índice de Valoración (PIR, DESIGN.md 7.6/Bloque D): función pura sobre
  // una línea de boxScore ya enriquecida con assists/foulsDrawn/
  // blockedAttempts. `personalFouls` ya incluye las técnicas (ver
  // handleTechnicalFoul: incrementa ambos contadores) — se usa solo este
  // campo para no contar las técnicas dos veces.
  function computeValoracion(stat) {
    const missedFieldGoals = ['threePointShot', 'midRangeShot', 'insideShot', 'layup']
      .reduce((sum, shotType) => sum + (stat.fieldGoals[shotType].attempted - stat.fieldGoals[shotType].made), 0);
    const missedFreeThrows = stat.freeThrows.attempted - stat.freeThrows.made;
    const totalRebounds = stat.reboundsOffensive + stat.reboundsDefensive;
    return stat.points + totalRebounds + stat.assists + stat.steals + stat.blocks + stat.foulsDrawn
      - missedFieldGoals - missedFreeThrows - stat.turnovers - stat.blockedAttempts - stat.personalFouls;
  }

  // --- Bloque A: acciones individuales ---

  // `pressProbabilityMultiplier` (DESIGN.md 7.12.15, TAC-4, opcional):
  // MODULA la probabilidad de este mismo resolver cuando el equipo
  // defensor presiona el tramo inicial de la posesión — nunca un
  // resolver de pérdida nuevo (pedido explícito del prompt). 1 = sin
  // press (comportamiento idéntico a TAC-1/TAC-2/TAC-3). Se re-acota con
  // clampEventProbability tras aplicar el multiplicador porque
  // computeEventProbability ya devuelve un valor acotado a
  // [0.01, 0.6] — multiplicar por encima de 1 podría superar ese techo.
  function rollTurnover(ballHandler, defender, config, pressure, penalties, pressProbabilityMultiplier = 1) {
    const action = config.actions.turnover;
    const probability = computeEventProbability(action, ballHandler, defender, config, pressure, undefined, undefined, penalties)
      * pressProbabilityMultiplier;
    return Math.random() < clampEventProbability(probability);
  }

  function rollSteal(defender, ballHandler, config, pressure, penalties) {
    const action = config.actions.steal;
    return Math.random() < computeEventProbability(action, defender, ballHandler, config, pressure, undefined, undefined, penalties);
  }

  function rollBlock(blocker, shooter, shotType, config, pressure, penalties) {
    const action = config.actions.block;
    const p = computeEventProbability(
      action, blocker, shooter, config, pressure, { secondary: { shotAttribute: shotType } }, undefined, penalties,
    );
    return Math.random() < p;
  }

  // 8/10. Rebote y Lucha por balón suelto comparten los mismos dos
  // candidatos (reboteador ofensivo/defensivo); una pequeña probabilidad de
  // que la disputa se resuelva como balón suelto en vez de rebote normal.
  // También clasifica el rebote defensivo como "largo" o no (7.6.14,
  // criterio propio: DESIGN.md no da una regla exacta, solo la idea de
  // "se aleja del aro" — aquí se aproxima como una probabilidad fija).
  // `offenseRotationState`/`defenseRotationState` (7.11.3, opcionales): cada
  // reboteador se penaliza según SU PROPIO equipo/estado — no basta una sola
  // función de penalización, offRebounder y defRebounder pertenecen a
  // rotaciones distintas.
  function resolveReboundContest(offenseFive, defenseFive, boxScore, config, pressure, offenseRotationState, defenseRotationState) {
    const offRebounder = pickWeighted(offenseFive, (p) => getAttribute(p, 'offensiveRebound')
      + getAttribute(p, 'jumping') * 0.5 + getAttribute(p, 'strength') * 0.5 + 1);
    const defRebounder = pickWeighted(defenseFive, (p) => getAttribute(p, 'defensiveRebound')
      + getAttribute(p, 'jumping') * 0.5 + getAttribute(p, 'positioning') * 0.5 + 1);
    const penalties = (offenseRotationState || defenseRotationState)
      ? { primary: getPenalty(offenseRotationState, offRebounder.id), secondary: getPenalty(defenseRotationState, defRebounder.id) }
      : undefined;

    const looseBallAction = config.actions.looseBall;
    let offenseWins;
    if (Math.random() < looseBallAction.triggerProbability) {
      offenseWins = Math.random() < computeEventProbability(looseBallAction, offRebounder, defRebounder, config, pressure, undefined, undefined, penalties);
    } else {
      offenseWins = Math.random() < computeEventProbability(config.actions.rebound, offRebounder, defRebounder, config, pressure, undefined, undefined, penalties);
    }

    if (offenseWins) {
      recordRebound(boxScore, offRebounder, 'offensive');
      return { offensiveRebound: true, isLongRebound: false, participantIds: [offRebounder.id, defRebounder.id] };
    }
    recordRebound(boxScore, defRebounder, 'defensive');
    const isLongRebound = Math.random() < config.fastBreak.longReboundProbability;
    return { offensiveRebound: false, isLongRebound, participantIds: [offRebounder.id, defRebounder.id] };
  }

  // --- Bloque B: caminos de reglamento ---

  // 11. Falta defensiva (fuera de tiro). Sin mezcla secundaria (no depende
  // del atacante) — se escala directamente por foulTendency (ya con Fatiga
  // aplicada dentro de computeMixRating) respecto al valor neutro.
  function rollDefensiveFoul(defender, config, pressure, penalty) {
    const action = config.actions.defensiveFoul;
    const rating = computeMixRating(defender, action.primary, config, pressure, undefined, penalty);
    const scaled = action.baseProbability * (rating / NEUTRAL_ATTRIBUTE);
    return Math.random() < clampEventProbability(scaled);
  }

  function rollShootingFoul(defender, attacker, config, pressure, penalties) {
    const action = config.actions.shootingFoul;
    return Math.random() < computeEventProbability(action, defender, attacker, config, pressure, undefined, undefined, penalties);
  }

  // Tiros libres en cadena (bonus, and-one, o falta en tiro con 2/3 tl).
  // `penalty` (7.11.3, opcional): el tirador cubriendo una posición de
  // emergencia también tira sus libres penalizado.
  function resolveFreeThrowsSequence(shooter, count, boxScore, config, pressure, penalty) {
    const action = config.actions.freeThrow;
    let pointsMade = 0;
    let lastMade = false;
    for (let i = 0; i < count; i++) {
      const made = Math.random() < directProbability(action, shooter, config, pressure, penalty);
      recordFreeThrowAttempt(boxScore, shooter, made);
      if (made) pointsMade += 1;
      lastMade = made;
    }
    return { pointsMade, lastMade, timeSpent: count * 2 }; // ~2s por tiro libre, aproximación simple
  }

  // Tras cualquier secuencia de tiros libres: si el último entra, la
  // posesión cambia; si falla, se disputa un rebote (regla real: solo el
  // último libre está "vivo" para rebote). `shooterPenalty`/rotationStates
  // (7.11.3, opcionales): se reenvían tal cual a los tiros libres y al
  // rebote consiguiente.
  function handleFreeThrowSequence(
    shooter, count, offenseFive, defenseFive, boxScore, config, pressure,
    shooterPenalty, offenseRotationState, defenseRotationState,
  ) {
    const ft = resolveFreeThrowsSequence(shooter, count, boxScore, config, pressure, shooterPenalty);
    if (ft.lastMade) {
      return { pointsMade: ft.pointsMade, timeSpent: ft.timeSpent, possessionContinues: false };
    }
    const rebound = resolveReboundContest(offenseFive, defenseFive, boxScore, config, pressure, offenseRotationState, defenseRotationState);
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

  // --- DESIGN.md 7.12.24 (TAC-5): falta táctica intencionada ---
  // Decisión de SI el equipo defensor busca activamente una falta esta
  // posesión — NUNCA un resolver de falta nuevo (pedido explícito del
  // prompt de esta sesión): si decide que sí, la falta se registra
  // directamente en simulatePossession() reutilizando exactamente el mismo
  // camino que ya existe para una falta defensiva sin bonus/con bonus
  // (recordPersonalFoul/handleFreeThrowSequence), solo que con el
  // committer/objetivo elegidos aquí en vez de onBallDefender/ballHandler
  // genéricos. La CPU usa las mismas reglas (7.12.24, "regla dura") porque
  // esta función solo lee `defenseTacticalProfile.situations.tacticalFoul`
  // — no distingue si ese perfil es de un equipo gestionado por el usuario
  // o por la CPU. Reglas configurables (Tactics.js, sub-pestaña
  // Situaciones, 7.12.32): desactivada por defecto (7.12.34, regresión).
  //
  // Decisión de encaje señalada explícitamente (7.12.34, pendiente de
  // calibración): solo se evalúa en el último período regular o en
  // prórroga (`period >= quartersTotal`) — hacer falta táctica para
  // detener el reloj en un cuarto intermedio no tiene sentido real
  // (sobra tiempo de sobra para remontar de forma normal), DESIGN.md 7.12.24
  // no lo prohíbe ni lo exige explícitamente.
  function evaluateIntentionalFoul(
    offenseFive, defenseFive, defenseTacticalProfile, boxScore, config,
    period, quartersTotal, quarterClockRemaining, offenseScore, defenseScore,
  ) {
    const rules = defenseTacticalProfile && defenseTacticalProfile.situations && defenseTacticalProfile.situations.tacticalFoul;
    if (!rules || !rules.enabled) return null;
    if (period < quartersTotal) return null;
    if (quarterClockRemaining > rules.secondsRemaining) return null;
    if (offenseScore === undefined || defenseScore === undefined) return null;
    const trailingBy = offenseScore - defenseScore; // >0 si la defensa (quien haría la falta) va perdiendo
    if (trailingBy <= 0 || trailingBy > rules.marginPoints) return null;

    // 7.12.24: "priorizar receptor/objetivo con peor TiroLibre cuando sea
    // posible" — el rival con peor TiroLibre EN PISTA, no de toda la
    // plantilla (solo esos 5 pueden recibir la falta esta posesión).
    const target = offenseFive.reduce(
      (worst, p) => (getAttribute(p, 'freeThrows') < getAttribute(worst, 'freeThrows') ? p : worst),
      offenseFive[0],
    );
    // 7.12.24: "evitar que el jugador propio con 4 faltas personales sea
    // quien comete la falta si existe alternativa razonable" — se excluye
    // del pool salvo que sea el único disponible (sin alternativa).
    const withoutFourFouls = defenseFive.filter((p) => getStatLine(boxScore, p).personalFouls < 4);
    const pool = withoutFourFouls.length > 0 ? withoutFourFouls : defenseFive;
    const fouler = pickWeighted(pool, onBallDefenderWeight);
    return { target, fouler };
  }

  // --- Una posesión completa (puede encadenar varios intentos si hay
  // rebote ofensivo o falta defensiva sin bonus) ---
  const MAX_POSSESSION_ITERATIONS = 12; // guarda de seguridad anti-bucle-infinito

  // DESIGN.md 7.12.22 (TAC-6): resumen mínimo de USO táctico de una
  // posesión, expuesto en `result.tacticalUsage` para que
  // `simulateOnePossessionStep` pueda hacer crecer la familiaridad
  // correspondiente sin que este archivo tenga que conocer el shape
  // interno completo del `tacticalPlan` de Tactics.js. `null` si la
  // posesión no tuvo play-type táctico real (7.12.34, compatibilidad: esas
  // posesiones no alimentan ninguna familiaridad).
  function buildTacticalUsage(plan) {
    if (!plan) return null;
    return {
      playType: plan.playType,
      playDefinitionId: plan.playDefinitionId,
      coverage: plan.coverage || null,
      offenseParticipantIds: plan.offenseParticipantIds || [],
      defenseParticipantIds: plan.defenseParticipantIds || [],
    };
  }

  // `context`: { pressure, quarterClockRemaining, fastBreakEligible,
  // offenseTempoBias, scoringRunActiveSide, offenseSide, defenseSide,
  // offenseRotationState, defenseRotationState, runningScore, period,
  // isOvertime, situational }. Las dos de rotación (7.11, opcionales): si
  // un equipo no aporta alineación real (Rotation.js), su rotationState es
  // `null` y el comportamiento es el de siempre (selectOnCourtFive
  // placeholder, sin penalización de polivalencia). `runningScore`/
  // `period`/`isOvertime`/`situational` (TAC-5, 7.12.24): snapshot de solo
  // lectura del estado de partido, usado por la falta táctica intencionada
  // y por la resolución de situaciones especiales (ver más abajo) — nunca
  // mutados desde aquí, el motor de partido (advanceMatch) es la única
  // fuente de verdad de ese estado.
  function simulatePossession(offenseTeam, defenseTeam, offenseSquad, defenseSquad, teamFouls, config, boxScore, context) {
    let shotClock = config.match.shotClockSeconds;
    let elapsedTotal = 0;
    let pointsScored = 0;
    let defensePoints = 0; // puntos para el equipo defensor (solo vía falta técnica del atacante)
    const events = [];
    const {
      pressure, offenseRotationState, defenseRotationState, offenseTacticalProfile, defenseTacticalProfile,
      runningScore, period, situational,
      // DESIGN.md 7.12.22/7.12.23 (TAC-6): ver GamePlan.tacticalExecutionOverride
      // (Tactics.js) — `undefined` si ninguno de los dos lados tiene
      // GamePlan asignado este partido (7.12.34, compatibilidad).
      offenseTacticalExecutionOverride, defenseTacticalExecutionOverride,
    } = context;
    // DESIGN.md 7.12.22 (TAC-6): la posesión resuelta con play-type táctico
    // real de la PRIMERA iteración (única que puede tener `tacticalPlan`,
    // ver más abajo) — capturada en una variable de ámbito de función
    // porque `tacticalPlan` en sí es una `const` declarada DENTRO del
    // bucle (se pierde en la siguiente iteración tras un rebote ofensivo/
    // falta sin bonus). `updateFamiliarityAfterPossession`
    // (MatchEngine.simulateOnePossessionStep) necesita conocerla en
    // CUALQUIER punto de retorno de esta función, no solo el que coincide
    // con la iteración en que se calculó.
    let resolvedTacticalPlan = null;

    for (let iteration = 0; iteration < MAX_POSSESSION_ITERATIONS; iteration++) {
      const offenseFive = offenseRotationState ? getOnCourtFive(offenseRotationState) : selectOnCourtFive(offenseSquad);
      const defenseFive = defenseRotationState ? getOnCourtFive(defenseRotationState) : selectOnCourtFive(defenseSquad);
      // 7.11.4 (C.4): desgaste GENERAL de los 5 en pista, con jerarquía por
      // posición ocupada EN ESTA JUGADA cuando hay alineación real; sin ella,
      // multiplicador neutro (comportamiento de siempre, 7.5-bis).
      applyFatigueConsumption(offenseFive, config, buildPositionLookup(offenseRotationState));
      applyFatigueConsumption(defenseFive, config, buildPositionLookup(defenseRotationState));

      // Elección de siempre (placeholder de uso/emparejamiento, sin
      // cambios) — se calcula ANTES de preguntar a Tactics.js porque
      // DefensivePlan la necesita de todos modos para construir la
      // cobertura, y así se evita un segundo sorteo redundante cuando la
      // posesión termina no siendo táctica (ver más abajo).
      const defaultOnBallDefender = pickWeighted(defenseFive, onBallDefenderWeight);

      // DESIGN.md 7.12.24 (TAC-5): falta táctica intencionada — decisión
      // que se evalúa AQUÍ, en el punto donde ya se van a elegir los
      // protagonistas de la posesión, ANTES de cualquier planificación
      // táctica normal (si el equipo defensor va a buscar la falta
      // deliberadamente, no tiene sentido gastar el sorteo de play-type de
      // una jugada que no se va a completar). Solo en la primera iteración
      // (mismo criterio de gating que tacticalPlan/pressEffect): una falta
      // táctica es una decisión de "esta posesión", no de cada rebote
      // ofensivo posterior. `null` si las reglas de
      // `defenseTacticalProfile.situations.tacticalFoul` no están
      // activadas o no se cumplen las condiciones (7.12.34, compatibilidad:
      // desactivada por defecto, ver Tactics.js).
      const intentionalFoulPlan = iteration === 0 ? evaluateIntentionalFoul(
        offenseFive, defenseFive, defenseTacticalProfile, boxScore, config,
        period, config.match.quarters, context.quarterClockRemaining,
        runningScore ? runningScore[context.offenseSide] : undefined,
        runningScore ? runningScore[context.defenseSide] : undefined,
      ) : null;

      if (intentionalFoulPlan) {
        const { target, fouler } = intentionalFoulPlan;
        teamFouls[defenseTeam.id] = (teamFouls[defenseTeam.id] || 0) + 1;
        recordPersonalFoul(boxScore, fouler);
        recordFoulDrawn(boxScore, target);
        events.push({ type: 'defensiveFoul', playerId: fouler.id, intentional: true });
        elapsedTotal += 1; // tiempo breve del contacto/parada, cifra propia (no hay jugada de tiro que resolver)
        applyInterventionWear([fouler.id, target.id], new Map(offenseFive.concat(defenseFive).map((p) => [p.id, p])), config);
        if (teamFouls[defenseTeam.id] >= config.match.teamFoulBonusThreshold) {
          const targetPenalty = getPenalty(offenseRotationState, target.id);
          const result = handleFreeThrowSequence(
            target, 2, offenseFive, defenseFive, boxScore, config, pressure,
            targetPenalty, offenseRotationState, defenseRotationState,
          );
          pointsScored += result.pointsMade;
          elapsedTotal += result.timeSpent;
          if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
          return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false, tacticalUsage: buildTacticalUsage(resolvedTacticalPlan) };
        }
        // Sin bonus: saque de banda, la posesión sigue con el mismo equipo
        // (misma simplificación que la falta defensiva normal sin bonus).
        continue;
      }

      // DESIGN.md 7.12 (TAC-1, ampliado en TAC-3): SOLO en la primera
      // iteración de la posesión se decide el play-type táctico (7.12.3, la
      // capa táctica se resuelve antes del bucle 1v1, no en cada rebote
      // ofensivo posterior — una segunda oportunidad tras un rebote es ya
      // un scramble, no la misma jugada). `null` si el equipo ofensivo no
      // tiene TacticalProfile o el sorteo de play-type (Pick & Roll/
      // Isolation/Post Up, 7.12.8) cae en "ninguno" — en ese caso
      // ballHandler/onBallDefender se eligen EXACTAMENTE como antes de
      // TAC-1 (7.12.34, compatibilidad).
      //
      // DESIGN.md 7.12.24 (TAC-5): si `resolveSituationType` identifica
      // ATO/BLOB/SLOB/Late Clock/Last Possession para esta posesión
      // concreta, `planSituationalPossession` sustituye a
      // `planTacticalPossession` como punto de entrada — reutiliza los
      // mismos 3 motores de play-type (7.12.8/7.12.10), nunca un selector
      // paralelo (ver Tactics.js).
      const situationType = iteration === 0 ? resolveSituationType(situational, config) : null;
      const tacticalPossessionParams = {
        offenseTacticalProfile, defenseTacticalProfile, offenseFive, defenseFive,
        onBallDefender: defaultOnBallDefender,
        config, pressure, computeMixRating, getAttribute, usageWeight,
        offenseRotationState, defenseRotationState,
        offenseSpacing: offenseTacticalProfile && offenseTacticalProfile.spacing,
        shotClockRemaining: shotClock,
        offenseTacticalExecutionOverride, defenseTacticalExecutionOverride,
      };
      const tacticalPlan = iteration === 0
        ? (situationType
          ? planSituationalPossession(tacticalPossessionParams, situationType)
          : planTacticalPossession(tacticalPossessionParams))
        : null;
      // DESIGN.md 7.12.22 (TAC-6): ver nota de `resolvedTacticalPlan` arriba.
      if (tacticalPlan) resolvedTacticalPlan = tacticalPlan;

      let ballHandler = tacticalPlan ? tacticalPlan.initialHandler : pickWeighted(offenseFive, usageWeight);
      let onBallDefender = tacticalPlan ? tacticalPlan.initialOnBallDefender : defaultOnBallDefender;
      // DESIGN.md 7.12.17 (TAC-4): matchup individual declarado por el
      // equipo defensor — prioridad sobre la selección ponderada genérica
      // SOLO para el jugador objetivo (7.12.17: "el motor respeta esa
      // intención... salvo que una rotación/cambio defensivo obligue
      // temporalmente a otro matchup"). Se aplica aquí, ANTES de que
      // cualquier cobertura/rotación de Tactics.js pueda reasignar el
      // defensor final más adelante (Switch, doble equipo de poste...) —
      // esa reasignación posterior SÍ tiene prioridad sobre el matchup,
      // que es precisamente la excepción que el propio 7.12.17 reconoce.
      onBallDefender = resolveMatchupOverride(defenseFive, defenseTacticalProfile, ballHandler.id, onBallDefender);
      // 7.11.3 (C.3): penalización activa de cada uno si está cubriendo una
      // posición de emergencia — 0 si no hay alineación o no aplica.
      let ballHandlerPenalty = getPenalty(offenseRotationState, ballHandler.id);
      const onBallDefenderPenalty = getPenalty(defenseRotationState, onBallDefender.id);
      const playersById = new Map(offenseFive.concat(defenseFive).map((p) => [p.id, p]));
      // DESIGN.md 7.12.15 (TAC-4): efecto del press del equipo defensor
      // sobre el tramo inicial de la posesión — SOLO en la primera
      // iteración (cruzar medio campo ocurre una vez por posesión, no en
      // cada rebote ofensivo posterior, mismo criterio de gating que
      // tacticalPlan arriba). Neutro {turnoverMultiplier: 1, clockCost: 0}
      // sin press activo (7.12.34, compatibilidad).
      const pressEffect = iteration === 0
        ? computePressEffect(offenseFive, defenseTacticalProfile, config, getAttribute)
        : { turnoverMultiplier: 1, clockCost: 0 };

      // 7.6.19: últimos segundos de cuarto sin tiempo de jugada completa —
      // fuerza un paso corto (no da tiempo a desarrollar la jugada normal).
      const quarterClockAtIterationStart = context.quarterClockRemaining - elapsedTotal;
      const noFullPlayTime = quarterClockAtIterationStart < config.lateClock.noFullPlayThresholdSeconds;

      // DESIGN.md 7.12.12 (TAC-3): la ventana de contraataque (7.6 acción
      // 14) sigue igual, pero AHORA el equipo decide cuánto la explota
      // según `playTypeWeights.transition` (Tactics.resolveTransitionAttempt)
      // — con perfil por defecto siempre la intenta (7.12.34, idéntico al
      // comportamiento de antes de esta entrega).
      const fastBreakWindow = context.fastBreakEligible && iteration === 0;
      const fastBreakAttempt = fastBreakWindow && resolveTransitionAttempt(offenseTacticalProfile, config);
      let step = pickPossessionStepSeconds(
        shotClock, averageAttribute(offenseFive, 'gameVision'), context.offenseTempoBias, config, fastBreakAttempt,
      );
      // DESIGN.md 7.12.11 (TAC-3): una segunda acción de la cadena de
      // continuidad consume reloj de posesión adicional (reutiliza el
      // MISMO reloj, no uno paralelo) — si eso agota el reloj, la
      // violación de posesión de más abajo se dispara igual que con
      // cualquier paso largo.
      if (tacticalPlan && tacticalPlan.clockCost) step += tacticalPlan.clockCost;
      // DESIGN.md 7.12.15 (TAC-4): cruzar medio campo contra un press
      // consume reloj adicional — ver comentario de pressEffect arriba.
      if (pressEffect.clockCost) step += pressEffect.clockCost;
      if (noFullPlayTime) step = Math.min(step, Math.max(1, quarterClockAtIterationStart * 0.6));

      if (step >= shotClock) {
        // 13. Violación de reloj de posesión — se agota el reloj sin tiro.
        elapsedTotal += shotClock;
        recordTurnover(boxScore, ballHandler);
        events.push({ type: 'shotClockViolation', playerId: ballHandler.id });
        applyInterventionWear([ballHandler.id], playersById, config);
        return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: true, tacticalUsage: buildTacticalUsage(resolvedTacticalPlan) };
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
      if (rollDefensiveFoul(onBallDefender, config, pressure, onBallDefenderPenalty)) {
        teamFouls[defenseTeam.id] = (teamFouls[defenseTeam.id] || 0) + 1;
        recordPersonalFoul(boxScore, onBallDefender);
        recordFoulDrawn(boxScore, ballHandler);
        events.push({ type: 'defensiveFoul', playerId: onBallDefender.id });

        if (teamFouls[defenseTeam.id] >= config.match.teamFoulBonusThreshold) {
          const result = handleFreeThrowSequence(
            ballHandler, 2, offenseFive, defenseFive, boxScore, config, pressure,
            ballHandlerPenalty, offenseRotationState, defenseRotationState,
          );
          pointsScored += result.pointsMade;
          elapsedTotal += result.timeSpent;
          if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
          return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false, tacticalUsage: buildTacticalUsage(resolvedTacticalPlan) };
        }
        // Sin bonus: saque de banda, la posesión sigue con el mismo equipo
        // y el mismo reloj restante (simplificación: FIBA resetea a 14s si
        // quedaban menos de 14s, no modelado aquí).
        continue;
      }

      // 6. Pérdida de balón (+ 7. Robo, sub-tirada) — DESIGN.md 7.12.15
      // (TAC-4): `pressEffect.turnoverMultiplier` modula la probabilidad
      // de ESTE resolver ya existente (1 = sin press, comportamiento
      // idéntico a antes de esta entrega). DESIGN.md 7.12.22 (TAC-6,
      // "pérdida ofensiva de sistema"): `tacticalPlan.turnoverExecutionMultiplier`
      // se combina con el de press (ambos multiplican la misma probabilidad
      // base, nunca un segundo resolver) — 1 sin play-type táctico esta
      // posesión (7.12.34, compatibilidad).
      const turnoverExecutionMultiplier = tacticalPlan ? tacticalPlan.turnoverExecutionMultiplier : 1;
      if (rollTurnover(
        ballHandler, onBallDefender, config, pressure,
        { primary: ballHandlerPenalty, secondary: onBallDefenderPenalty },
        pressEffect.turnoverMultiplier * turnoverExecutionMultiplier,
      )) {
        if (rollSteal(onBallDefender, ballHandler, config, pressure, { primary: onBallDefenderPenalty, secondary: ballHandlerPenalty })) {
          recordSteal(boxScore, onBallDefender);
          events.push({ type: 'steal', playerId: onBallDefender.id });
        } else {
          events.push({ type: 'turnover', playerId: ballHandler.id });
        }
        recordTurnover(boxScore, ballHandler);
        applyInterventionWear([ballHandler.id, onBallDefender.id], playersById, config);
        return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: true, tacticalUsage: buildTacticalUsage(resolvedTacticalPlan) };
      }

      // DESIGN.md 7.12.4/7.12.11 (TAC-1, generalizado en TAC-3 a los 3
      // play-types con motor real): resultado de la jugada, según el
      // AdvantageState/continuidad ya resueltos en `tacticalPlan` (forma
      // unificada, ver Tactics.planTacticalPossession). Regla dura de
      // 7.12.3: la capa táctica NO decide si el tiro entra, solo QUIÉN
      // tira, CONTRA QUIÉN y con QUÉ PENALIZACIÓN/AJUSTE de contexto — el
      // catálogo de 7.6 (más abajo) sigue siendo idéntico. Sin tacticalPlan
      // (posesión no táctica, o iteración > 0 tras un rebote ofensivo),
      // ninguna de estas variables cambia de su valor de siempre.
      let tacticalShotDefenderOverride = null;
      let tacticalExtraShotDefenderPenalty = 0;
      let tacticalForcedShotType = null;
      let tacticalShotAdjustment = 0;
      if (tacticalPlan) {
        // El balón puede haber cambiado de manos (roller/kick-out/mismatch)
        // entre el handler inicial y quien finalmente tira — reasigna
        // `ballHandler` para que todo lo que viene después (registro de
        // tiro, asistencia, desgaste, tiros libres) atribuya correctamente
        // la jugada a quien tira de verdad, sin duplicar ningún resolver.
        ballHandler = tacticalPlan.shooter;
        ballHandlerPenalty = getPenalty(offenseRotationState, ballHandler.id);
        tacticalShotDefenderOverride = tacticalPlan.shotDefender;
        tacticalExtraShotDefenderPenalty = tacticalPlan.shotDefenderPenalty || 0;
        tacticalForcedShotType = tacticalPlan.forcedShotType; // solo insideShot|layup en la rama de roller, ver Tactics.js
        tacticalShotAdjustment = tacticalPlan.shotAdjustment || 0;
      }

      // Selección de tiro (heurística de Fase 1: ponderada por el propio
      // atributo de tiro del jugador, no un sistema de tácticas de ataque;
      // `tacticalForcedShotType` la sustituye solo en la rama de ventaja
      // clara de un P&R, ver arriba).
      const shotType = tacticalForcedShotType || pickShotType(ballHandler);
      const isPerimeterShot = shotType === 'threePointShot' || shotType === 'midRangeShot';
      const genericShotDefender = isPerimeterShot
        ? pickWeighted(defenseFive, (p) => getAttribute(p, 'perimeterDefense') + 1)
        : pickWeighted(defenseFive, (p) => getAttribute(p, 'interiorDefense') + 1);
      // DESIGN.md 7.12.17 (TAC-4): el matchup declarado solo sustituye a la
      // selección ponderada GENÉRICA (`genericShotDefender`) — si Tactics.js
      // YA reasignó el defensor por una cobertura/rotación concreta
      // (`tacticalShotDefenderOverride`, ej. Switch, roller, doble equipo),
      // esa reasignación tiene prioridad, tal como reconoce el propio
      // 7.12.17 ("salvo que una rotación/cambio defensivo obligue
      // temporalmente a otro matchup").
      const shotDefender = tacticalShotDefenderOverride
        || resolveMatchupOverride(defenseFive, defenseTacticalProfile, ballHandler.id, genericShotDefender);
      const shotDefenderPenalty = getPenalty(defenseRotationState, shotDefender.id) + tacticalExtraShotDefenderPenalty;

      // 7.6.14: Contraataque — solo si el equipo REALMENTE lo intentó esta
      // posesión (fastBreakAttempt, 7.12.12 TAC-3) y dentro de la ventana
      // de segundos configurada.
      const isFastBreakWindow = fastBreakAttempt && elapsedTotal <= config.fastBreak.windowSeconds;

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

      let shotAdjustment = tacticalShotAdjustment;
      if (isPossessionBuzzer || isGameBuzzer || noFullPlayTime) {
        shotAdjustment -= config.pressure.forcedShotPenalty; // tiro forzado
      }
      // DESIGN.md 7.12.20 (TAC-4): modificador DENTRO de la ventana de
      // contraataque ya existente (nunca la ventana en sí) — un repliegue
      // defensivo malo amplía la ventaja de contraataque en CUALQUIER tipo
      // de tiro intentado en transición, no solo bandejas (a diferencia del
      // bono de aceleración de más abajo, que sí es específico de bandeja).
      if (isFastBreakWindow) {
        shotAdjustment += computeTransitionDefenseAdjustment(defenseFive, config, getAttribute);
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
      const shootingFoulPenalties = { primary: shotDefenderPenalty, secondary: ballHandlerPenalty };
      const hasShootingFoul = rollShootingFoul(shotDefender, ballHandler, config, shotPressure, shootingFoulPenalties);

      let blocked = false;
      if (!hasShootingFoul && !isPerimeterShot) {
        // 9. Tapón (solo Tiro interior/Bandeja)
        blocked = rollBlock(shotDefender, ballHandler, shotType, config, shotPressure, shootingFoulPenalties);
        if (blocked) {
          // 7.6.15: Tapón con mate — margen amplio del compuesto = evento de
          // alta notabilidad, sin cambiar la fórmula. Aproximación: compara
          // el rating del taponador contra el del finalizador; si la
          // diferencia es grande, se marca. TODO Fase 3: sistema real de
          // notabilidad (7.7), esto solo deja el flag preparado.
          const blockerRating = computeMixRating(shotDefender, config.actions.block.primary, config, shotPressure, undefined, shotDefenderPenalty);
          const shooterRating = computeMixRating(ballHandler, config.actions.block.secondary, config, shotPressure, { shotAttribute: shotType }, ballHandlerPenalty);
          if (blockerRating - shooterRating > config.dunkBlock.ratingMargin) {
            events.push({ type: 'dunkBlock', playerId: shotDefender.id }); // TODO Fase 3: notabilidad
          }
        }
      }

      const shotAction = config.actions[shotType];
      const shotPenalties = { primary: ballHandlerPenalty, secondary: shotDefenderPenalty };
      const made = !blocked && Math.random() < subtractProbability(shotAction, ballHandler, shotDefender, config, shotPressure, shotAdjustment, shotPenalties);
      recordFieldGoalAttempt(boxScore, ballHandler, shotType, made);
      if (made) {
        // Bloque D (22) / DESIGN.md 7.12.5 (TAC-3): Asistencia — tiro de
        // campo anotado (con o sin falta y-uno, ambos casos llegan aquí con
        // made=true); nunca en tiros libres, que no pasan por
        // recordFieldGoalAttempt. Con play-type táctico real, la cadena
        // causal (assistCandidate ya resuelto por Tactics.js) sustituye a
        // la asignación post-hoc; sin él, resolveAssist() sigue tal cual
        // (7.12.5, compatibilidad explícita).
        if (tacticalPlan) {
          resolveTacticalAssist(tacticalPlan.assistCandidate, shotType, boxScore, config);
        } else {
          resolveAssist(offenseFive, ballHandler, shotType, boxScore);
        }
      }
      if (blocked) {
        recordBlock(boxScore, shotDefender);
        recordBlockedAttempt(boxScore, ballHandler);
        events.push({ type: 'blockedShot', playerId: ballHandler.id, defenderId: shotDefender.id, shotType });
      }
      applyInterventionWear([ballHandler.id, shotDefender.id], playersById, config);

      if (hasShootingFoul) {
        recordPersonalFoul(boxScore, shotDefender);
        recordFoulDrawn(boxScore, ballHandler);
        // Las faltas en tiro también cuentan para el total de faltas de
        // equipo (aunque ya den tiros libres por sí mismas, siempre) —
        // regla real FIBA/ACB: toda falta personal suma al contador que
        // activa el bonus para las FUTURAS faltas defensivas del cuarto.
        teamFouls[defenseTeam.id] = (teamFouls[defenseTeam.id] || 0) + 1;
        const isThree = shotType === 'threePointShot';
        if (made) {
          // "And-one": la canasta sube y se añade 1 tiro libre extra.
          pointsScored += isThree ? 3 : 2;
          const result = handleFreeThrowSequence(
            ballHandler, 1, offenseFive, defenseFive, boxScore, config, pressure,
            ballHandlerPenalty, offenseRotationState, defenseRotationState,
          );
          pointsScored += result.pointsMade;
          elapsedTotal += result.timeSpent;
          events.push({ type: 'shootingFoulAndOne', playerId: ballHandler.id });
          if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
          return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false, tacticalUsage: buildTacticalUsage(resolvedTacticalPlan) };
        }
        const result = handleFreeThrowSequence(
          ballHandler, isThree ? 3 : 2, offenseFive, defenseFive, boxScore, config, pressure,
          ballHandlerPenalty, offenseRotationState, defenseRotationState,
        );
        pointsScored += result.pointsMade;
        elapsedTotal += result.timeSpent;
        events.push({ type: 'shootingFoul', playerId: ballHandler.id });
        if (result.possessionContinues) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
        return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false, tacticalUsage: buildTacticalUsage(resolvedTacticalPlan) };
      }

      if (made) {
        pointsScored += shotType === 'threePointShot' ? 3 : 2;
        events.push({ type: 'fieldGoalMade', playerId: ballHandler.id, shotType });
        return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false, tacticalUsage: buildTacticalUsage(resolvedTacticalPlan) };
      }

      // Fallo (limpio o taponado): se disputa el rebote.
      events.push({ type: 'fieldGoalMiss', playerId: ballHandler.id, shotType });
      const rebound = resolveReboundContest(offenseFive, defenseFive, boxScore, config, pressure, offenseRotationState, defenseRotationState);
      if (rebound.offensiveRebound) { shotClock = config.match.offensiveReboundShotClockSeconds; continue; }
      return {
        elapsed: elapsedTotal,
        points: pointsScored,
        defensePoints,
        events,
        fastBreakTrigger: blocked || rebound.isLongRebound,
        tacticalUsage: buildTacticalUsage(resolvedTacticalPlan),
      };
    }

    // Guarda de seguridad: si tras MAX_POSSESSION_ITERATIONS no se resolvió
    // (caso extremo, no debería ocurrir con las probabilidades base), se
    // corta la posesión aquí para no bucle infinito.
    events.push({ type: 'possessionSafetyGuard' });
    return { elapsed: elapsedTotal, points: pointsScored, defensePoints, events, fastBreakTrigger: false, tacticalUsage: buildTacticalUsage(resolvedTacticalPlan) };
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

  // Enriquecimiento final de una línea de boxScore (retoques de
  // estadísticas): minutos jugados, +/- y Valoración, calculados como
  // paso posterior a la simulación en vez de dentro del bucle de posesión
  // — igual que rotationSummary(), es lectura de datos ya generados, no
  // una fórmula nueva de simulación. `minutesPlayed` queda en `null` (no
  // en 0) cuando ese lado no tuvo alineación real, para poder distinguir
  // "no disponible" de "0 minutos jugados" en la UI.
  function enrichStatLine(stat, rotationState, plusMinusMap) {
    stat.minutesPlayed = rotationState ? (rotationState.playedSeconds.get(stat.playerId) || 0) : null;
    stat.plusMinus = plusMinusMap.get(stat.playerId) || 0;
    stat.valoracion = computeValoracion(stat);
    return stat;
  }

  // Resumen de rotación expuesto en el resultado (7.11, solo informativo/
  // verificación): minutos jugados por jugador y quinteto en pista al
  // terminar el partido. `null` si el equipo no aportó alineación real.
  function rotationSummary(rotationState) {
    if (!rotationState) return null;
    return {
      playedSeconds: Object.fromEntries(rotationState.playedSeconds),
      onCourt: { ...rotationState.onCourt },
    };
  }

  // =========================================================================
  // DESIGN.md 7.12.24/7.12.33 (TAC-5): motor de partido REALMENTE pausable
  // y reanudable. Todo el estado mutable que antes vivía como variables
  // locales dentro de un único `simulateMatch()` monolítico (boxScore,
  // plusMinus, quarterScores, runningScore, scoringRun, fastBreakEligible,
  // eventLog, possessionCount, offenseSide, period, isOvertime, teamFouls,
  // clockRemaining, periodPoints, totalElapsedSeconds, home/
  // awayRotationState — ver CHANGELOG de esta entrega) se extrae a un
  // objeto `MatchState` serializable (createMatchState). `advanceMatch`
  // avanza esa simulación hasta el siguiente punto de corte configurado
  // (`options.stopAt`): 'possession' (unidad mínima) | 'quarterEnd' |
  // 'timeoutTrigger' | 'matchEnd' (por defecto).
  //
  // Requisito de equivalencia (no negociable, ver DESIGN.md/CHANGELOG):
  // simular un partido de una sola llamada (`stopAt: 'matchEnd'`) y
  // simular el MISMO partido cortando en cada posesión
  // (`stopAt: 'possession'`, llamando repetidamente hasta `matchEnd`) con
  // la misma semilla aleatoria deben dar el resultado EXACTO — el punto de
  // corte solo decide CUÁNDO `advanceMatch` devuelve el control, nunca
  // cambia qué se calcula ni en qué orden (cada llamada, sea la que sea,
  // ejecuta exactamente las mismas `simulateOnePossessionStep` en la misma
  // secuencia; verificado en `scripts/verify-tac5-invariants.js`).
  // `simulateMatch()` (más abajo) es ahora un wrapper de compatibilidad:
  // construye el estado inicial, llama a `advanceMatch` con
  // `stopAt: 'matchEnd'` (que internamente NO se detiene hasta terminar) y
  // adapta el resultado al MISMO shape que consumían
  // League.js/Bracket.js/Playoffs.js/Cup.js/Promotion.js antes de esta
  // entrega — ninguno de esos archivos necesita ningún cambio.
  // =========================================================================

  // --- 7.12.24: tiempos muertos — seguimiento de uso (config.match.
  // timeouts, MatchConfig.js) ---
  // Segmento de partido para las reglas de tiempos muertos: 'firstHalf'/
  // 'secondHalf' para los períodos regulares, o 'overtime<N>' para la
  // N-ésima prórroga — cada prórroga tiene su propio cupo independiente
  // (7.12.24: "1 por prórroga").
  function currentTimeoutSegment(period, quartersTotal) {
    const half = Math.ceil(quartersTotal / 2);
    if (period <= half) return 'firstHalf';
    if (period <= quartersTotal) return 'secondHalf';
    return `overtime${period - quartersTotal}`;
  }

  function timeoutsUsedInSegment(record, segment) {
    if (segment.indexOf('overtime') === 0) return record.overtime[segment] || 0;
    return record[segment] || 0;
  }

  // ¿Puede `side` ('home'|'away') pedir un tiempo muerto AHORA MISMO con el
  // estado actual de `state`? Exportada además para que game.js pueda
  // deshabilitar el botón de "pedir tiempo muerto" sin duplicar esta
  // lógica de validación.
  function canCallTimeout(state, side) {
    const config = state.config;
    const team = side === 'home' ? state.homeTeam : state.awayTeam;
    const cfg = config.match.timeouts;
    const segment = currentTimeoutSegment(state.period, config.match.quarters);
    const record = state.timeouts[team.id];
    const used = timeoutsUsedInSegment(record, segment);
    let max;
    if (segment === 'firstHalf') max = cfg.perHalf.first;
    else if (segment === 'secondHalf') max = cfg.perHalf.second;
    else max = cfg.perOvertime;
    if (used >= max) return false;
    // 7.12.24: restricción de los últimos 2 minutos del 4º cuarto — tope
    // adicional independiente del cupo de la segunda mitad.
    if (segment === 'secondHalf' && state.period === config.match.quarters
      && state.clockRemaining <= cfg.lastMinutesThresholdSeconds
      && (record.usedInLastMinutesOfFourthQuarter || 0) >= cfg.maxInLastMinutesOfFourthQuarter) {
      return false;
    }
    return true;
  }

  function consumeTimeout(state, side) {
    const config = state.config;
    const team = side === 'home' ? state.homeTeam : state.awayTeam;
    const cfg = config.match.timeouts;
    const segment = currentTimeoutSegment(state.period, config.match.quarters);
    const record = state.timeouts[team.id];
    if (segment.indexOf('overtime') === 0) record.overtime[segment] = (record.overtime[segment] || 0) + 1;
    else record[segment] += 1;
    if (segment === 'secondHalf' && state.period === config.match.quarters
      && state.clockRemaining <= cfg.lastMinutesThresholdSeconds) {
      record.usedInLastMinutesOfFourthQuarter = (record.usedInLastMinutesOfFourthQuarter || 0) + 1;
    }
    // 7.12.24: la siguiente posesión EN ATAQUE de este equipo es su ATO —
    // ver simulateOnePossessionStep, se consume una sola vez.
    state.pendingAto[side] = true;
  }

  // Pide un tiempo muerto AHORA MISMO, sin esperar a que `advanceMatch`
  // simule otra posesión para comprobarlo — pensado para la ventana de
  // intervención de game.js entre cuartos/tras un tiempo muerto ya
  // disparado, donde el partido YA está pausado en un punto válido y no
  // tiene sentido obligar a jugar una posesión más solo para conceder el
  // tiempo muerto. Devuelve `false` sin consumir nada si `side` no puede
  // pedirlo ahora (ver canCallTimeout).
  function requestTimeoutNow(state, side) {
    if (!canCallTimeout(state, side)) return false;
    consumeTimeout(state, side);
    state.lastTimeoutSide = side;
    state.lastTimeoutReason = 'manual';
    return true;
  }

  // ¿Hay una decisión de pedir tiempo muerto pendiente AHORA? `manual`
  // (petición explícita del usuario, game.js) tiene prioridad sobre
  // `auto` si ambas aplicaran a la vez. `options.timeoutRequest`:
  // 'home'|'away'|null — se consume en cuanto se concede, quien la pide
  // debe volver a pedirla para otro tiempo muerto. `options.autoTimeouts`:
  // { home, away } — 1-2 reglas mínimas de IA asistente (7.12.24): "pedir
  // tiempo muerto si el rival mete un parcial de N-0" reutilizando
  // LITERALMENTE `state.scoringRun` (7.6.20, ya trackeado), sin
  // reimplementar un segundo contador de racha.
  function decideTimeoutRequest(state, options) {
    const config = state.config;
    const manualSide = options.timeoutRequest;
    if (manualSide && canCallTimeout(state, manualSide)) {
      return { side: manualSide, reason: 'manual' };
    }
    const autoRules = options.autoTimeouts || {};
    const sides = ['home', 'away'];
    for (let i = 0; i < sides.length; i += 1) {
      const side = sides[i];
      if (!autoRules[side]) continue;
      const opponentSide = side === 'home' ? 'away' : 'home';
      if (state.scoringRun.activeSide === opponentSide
        && state.scoringRun.points >= config.match.timeouts.autoTriggerRunPoints
        && canCallTimeout(state, side)) {
        return { side, reason: 'auto' };
      }
    }
    return null;
  }

  // Un tiempo muerto solo puede pedirse en una parada de juego real —
  // reutiliza LITERALMENTE `isDeadBallStoppage` (mismo criterio que ya usan
  // las ventanas de sustitución automática, 7.11.2), en vez de inventar un
  // segundo concepto de "parada de juego" paralelo. Si se concede, lo
  // consume (`consumeTimeout`) inmediatamente — no hay una decisión
  // separada de "aceptar" tras pausar: pedirlo YA es tomarlo.
  function evaluateTimeoutStop(state, options) {
    if (!state.lastPossessionWasDeadBall) return false;
    const decision = decideTimeoutRequest(state, options);
    if (!decision) return false;
    consumeTimeout(state, decision.side);
    state.lastTimeoutSide = decision.side;
    state.lastTimeoutReason = decision.reason;
    return true;
  }

  // --- Gestión de períodos (extraída del `do{}while()` + `while
  // (clockRemaining>0)` monolítico de antes de esta entrega) ---
  function periodDurationSeconds(state) {
    const config = state.config;
    return state.isOvertime ? config.match.overtimeMinutes * 60 : (config.match.durationMinutes * 60) / config.match.quarters;
  }

  function startNextPeriod(state) {
    const config = state.config;
    state.period += 1;
    state.isOvertime = state.period > config.match.quarters;
    // Las faltas personales (`boxScore`, por jugador) NO se reinician
    // entre períodos porque `boxScore` es el mismo Map durante todo el
    // partido; solo `teamFouls` (faltas de EQUIPO, para el bonus) se
    // reinicia al empezar cada período, cuarto o prórroga por igual.
    state.teamFouls = { [state.homeTeam.id]: 0, [state.awayTeam.id]: 0 };
    state.clockRemaining = periodDurationSeconds(state);
    state.periodPoints = { home: 0, away: 0 };
    state.phase = 'inPeriod';
  }

  // Misma condición que el `while (period < quarters || home === away)` de
  // antes de esta entrega, invertida (aquí se pregunta "¿YA terminó?"): un
  // partido real nunca termina en empate (7.10), así que sigue habiendo
  // prórrogas mientras el marcador esté igualado tras jugar los 4 cuartos.
  function isMatchOver(state) {
    const config = state.config;
    return !(state.period < config.match.quarters || state.runningScore.home === state.runningScore.away);
  }

  function finishCurrentPeriod(state) {
    // 7.11.2 (C.2): ventana de sustitución de fin de cuarto — punto de
    // corte natural del partido real, además de las paradas de juego que
    // ya se evalúan posesión a posesión (ver simulateOnePossessionStep).
    const homeScoreDiffAtPeriodEnd = state.runningScore.home - state.runningScore.away;
    if (state.homeRotationState) {
      runSubstitutionWindow(state.homeRotationState, { period: state.period, scoreDiff: homeScoreDiffAtPeriodEnd, elapsedSeconds: state.totalElapsedSeconds });
    }
    if (state.awayRotationState) {
      runSubstitutionWindow(state.awayRotationState, { period: state.period, scoreDiff: -homeScoreDiffAtPeriodEnd, elapsedSeconds: state.totalElapsedSeconds });
    }
    state.quarterScores.home.push(state.periodPoints.home);
    state.quarterScores.away.push(state.periodPoints.away);
  }

  // --- Una posesión (extraída del cuerpo del `while(clockRemaining>0)` de
  // antes de esta entrega) — muta `state` in situ y avanza el turno. ---
  function simulateOnePossessionStep(state) {
    const config = state.config;
    const offenseTeam = state.offenseSide === 'home' ? state.homeTeam : state.awayTeam;
    const defenseTeam = state.offenseSide === 'home' ? state.awayTeam : state.homeTeam;
    const offenseSquad = state.offenseSide === 'home' ? state.homeSquad : state.awaySquad;
    const defenseSquad = state.offenseSide === 'home' ? state.awaySquad : state.homeSquad;
    const defenseSide = state.offenseSide === 'home' ? 'away' : 'home';

    // 7.5: presión, calculada UNA vez por posesión. En prórroga no hay
    // "cuartos restantes" que sumar (es un período de muerte súbita
    // acumulativa) — se usa solo el reloj restante de la propia prórroga
    // como tiempo restante de partido.
    const quarterLength = (config.match.durationMinutes * 60) / config.match.quarters;
    const quartersRemainingAfterThis = state.isOvertime ? 0 : config.match.quarters - state.period;
    const totalGameSecondsRemaining = state.clockRemaining + quartersRemainingAfterThis * quarterLength;
    const scoreDiff = Math.abs(state.runningScore.home - state.runningScore.away);
    const pressure = computePressure(totalGameSecondsRemaining, scoreDiff, config);

    const offenseBaseProfile = state.offenseSide === 'home' ? state.homeTacticalProfile : state.awayTacticalProfile;
    const defenseBaseProfile = state.offenseSide === 'home' ? state.awayTacticalProfile : state.homeTacticalProfile;
    const offenseGamePlan = state.offenseSide === 'home' ? state.homeGamePlan : state.awayGamePlan;
    const defenseGamePlan = state.offenseSide === 'home' ? state.awayGamePlan : state.homeGamePlan;

    // 7.12.24: ¿esta posesión en ataque es el ATO de este equipo? Se
    // consume aquí (una sola vez, la primera vez que ataca tras su propio
    // tiempo muerto) sin importar cuántas posesiones defensivas jugara
    // entre medias (ver consumeTimeout).
    const afterTimeout = !!state.pendingAto[state.offenseSide];
    if (afterTimeout) state.pendingAto[state.offenseSide] = false;

    const context = {
      pressure,
      quarterClockRemaining: state.clockRemaining,
      fastBreakEligible: state.fastBreakEligible,
      offenseTempoBias: getTempoBias(offenseTeam, config),
      scoringRunActiveSide: state.scoringRun.activeSide,
      offenseSide: state.offenseSide,
      defenseSide,
      offenseRotationState: state.offenseSide === 'home' ? state.homeRotationState : state.awayRotationState,
      defenseRotationState: state.offenseSide === 'home' ? state.awayRotationState : state.homeRotationState,
      // DESIGN.md 7.12.23 (TAC-5): vista EFECTIVA de cada perfil, ya
      // fusionada con el GamePlan de partido de ese lado si lo hay — el
      // resto del motor (simulatePossession/Tactics.js) sigue leyendo
      // `offenseTacticalProfile`/`defenseTacticalProfile` exactamente
      // igual que antes de esta entrega, sin saber que puede haber un
      // GamePlan detrás (7.12.34, compatibilidad: sin GamePlan asignado,
      // `effectiveTacticalProfile` devuelve el perfil base tal cual).
      offenseTacticalProfile: effectiveTacticalProfile(offenseBaseProfile, offenseGamePlan),
      defenseTacticalProfile: effectiveTacticalProfile(defenseBaseProfile, defenseGamePlan),
      runningScore: { home: state.runningScore.home, away: state.runningScore.away },
      period: state.period,
      isOvertime: state.isOvertime,
      situational: {
        afterTimeout,
        quarterClockRemaining: state.clockRemaining,
        period: state.period,
        quartersTotal: config.match.quarters,
        scoreDiffAbs: Math.abs(state.runningScore.home - state.runningScore.away),
        inboundType: state.previousPossessionInboundType,
      },
      // DESIGN.md 7.12.22/7.12.23 (TAC-6): ver GamePlan.tacticalExecutionOverride
      // (Tactics.js) — `null` sin GamePlan asignado este partido para ese
      // lado (7.12.34, compatibilidad: sin efecto, tacticalExecution se
      // calcula con normalidad).
      offenseTacticalExecutionOverride: offenseGamePlan ? offenseGamePlan.tacticalExecutionOverride : null,
      defenseTacticalExecutionOverride: defenseGamePlan ? defenseGamePlan.tacticalExecutionOverride : null,
    };

    const result = simulatePossession(
      offenseTeam, defenseTeam, offenseSquad, defenseSquad, state.teamFouls, config, state.boxScore, context,
    );

    // DESIGN.md 7.12.22 (TAC-6): la familiaridad crece sobre los perfiles
    // PERSISTENTES (`offenseBaseProfile`/`defenseBaseProfile` —
    // `team.tacticalProfile` en sí, nunca la vista EFECTIVA fusionada con
    // el GamePlan de este partido, que se descarta al terminar por
    // 7.12.23) — mutación in situ, mismo patrón que el resto de esta
    // pantalla (roleAssignments/matchupOverrides ya se editan igual desde
    // game.js). `result.tacticalUsage` es `null` si la posesión no tuvo
    // play-type táctico real (no crece nada, 7.12.34).
    updateFamiliarityAfterPossession(offenseBaseProfile, defenseBaseProfile, result.tacticalUsage, config);

    // Simplificación de Fase 1 (sin cambios): el final de período solo se
    // comprueba ENTRE posesiones, no dentro de una posesión en curso.
    state.clockRemaining -= result.elapsed;
    state.totalElapsedSeconds += result.elapsed;
    state.periodPoints[state.offenseSide] += result.points;
    state.periodPoints[defenseSide] += result.defensePoints;
    state.runningScore[state.offenseSide] += result.points;
    state.runningScore[defenseSide] += result.defensePoints;
    state.possessionCount[state.offenseSide] += 1;

    // +/- (retoques de estadísticas): quinteto en pista de cada lado
    // DURANTE esta posesión.
    const plusMinusDiff = result.points - result.defensePoints;
    const offenseFiveForPlusMinus = context.offenseRotationState
      ? getOnCourtFive(context.offenseRotationState) : selectOnCourtFive(offenseSquad);
    const defenseFiveForPlusMinus = context.defenseRotationState
      ? getOnCourtFive(context.defenseRotationState) : selectOnCourtFive(defenseSquad);
    offenseFiveForPlusMinus.forEach((p) => state.plusMinus.set(p.id, state.plusMinus.get(p.id) + plusMinusDiff));
    defenseFiveForPlusMinus.forEach((p) => state.plusMinus.set(p.id, state.plusMinus.get(p.id) - plusMinusDiff));

    // 7.11.2 (C.2): minutos acumulados del quinteto que estuvo en pista.
    if (state.homeRotationState) accumulatePlayedTime(state.homeRotationState, result.elapsed);
    if (state.awayRotationState) accumulatePlayedTime(state.awayRotationState, result.elapsed);

    updateScoringRun(state.scoringRun, state.offenseSide, result.points, config);
    if (result.defensePoints > 0) updateScoringRun(state.scoringRun, defenseSide, result.defensePoints, config);
    state.fastBreakEligible = result.fastBreakTrigger;

    // Log interno de eventos (Bloque C incluido) con contexto de cuándo
    // ocurrieron.
    result.events.forEach((event) => {
      state.eventLog.push({ ...event, period: state.period, offenseSide: state.offenseSide });
    });

    // 7.11.2 (C.2): ventana de sustitución automática — SOLO en paradas de
    // juego reales (falta/violación, nunca a mitad de jugada viva).
    const deadBall = isDeadBallStoppage(result.events);
    if (deadBall) {
      const homeScoreDiff = state.runningScore.home - state.runningScore.away;
      if (state.homeRotationState) {
        runSubstitutionWindow(state.homeRotationState, { period: state.period, scoreDiff: homeScoreDiff, elapsedSeconds: state.totalElapsedSeconds });
      }
      if (state.awayRotationState) {
        runSubstitutionWindow(state.awayRotationState, { period: state.period, scoreDiff: -homeScoreDiff, elapsedSeconds: state.totalElapsedSeconds });
      }
    }

    // DESIGN.md 7.12.24 (TAC-5): BLOB/SLOB — aproximación deliberada,
    // pendiente de calibración (7.12.34): este motor no modela el saque de
    // banda/fondo como un suceso propio, así que se infiere del ÚLTIMO
    // evento de la posesión que acaba de terminar — canasta de campo
    // anotada = saque de FONDO (BLOB) para quien la recibe; cualquier otro
    // final (pérdida, tapón, violación de reloj, falta sin/con tiros
    // libres) se trata como saque de BANDA (SLOB), aunque en la realidad
    // un último tiro libre anotado también sería BLOB — este motor no
    // distingue ese matiz dentro de una secuencia de tiros libres.
    const lastEvent = result.events.length > 0 ? result.events[result.events.length - 1] : null;
    state.previousPossessionInboundType = (lastEvent && lastEvent.type === 'fieldGoalMade') ? 'BLOB' : 'SLOB';
    state.lastPossessionWasDeadBall = deadBall;

    state.offenseSide = defenseSide;
  }

  // options: { stopAt: 'possession'|'quarterEnd'|'timeoutTrigger'|
  // 'matchEnd' (por defecto 'matchEnd'), timeoutRequest: 'home'|'away'|
  // null, autoTimeouts: { home, away } }. Devuelve { state, stoppedReason }
  // — `state` es el MISMO objeto mutado in situ (no una copia): se sigue
  // usando la misma referencia para la siguiente llamada. Idempotente una
  // vez terminado el partido (`state.phase === 'finished'`): llamar de más
  // no hace nada raro, solo devuelve 'matchEnd' de nuevo.
  function advanceMatch(state, options = {}) {
    const stopAt = options.stopAt || 'matchEnd';
    if (state.phase === 'finished') return { state, stoppedReason: 'matchEnd' };

    for (;;) {
      if (state.phase === 'beforePeriod') {
        startNextPeriod(state);
      }

      simulateOnePossessionStep(state);

      if (state.clockRemaining <= 0) {
        finishCurrentPeriod(state);
        if (isMatchOver(state)) {
          state.phase = 'finished';
          return { state, stoppedReason: 'matchEnd' };
        }
        state.phase = 'beforePeriod';
        // Cualquier granularidad que no sea "de golpe" se detiene en el
        // límite de cuarto — el corte más grueso pedido explícitamente
        // por el prompt de esta sesión además de posesión/timeoutTrigger.
        if (stopAt !== 'matchEnd') {
          return { state, stoppedReason: 'quarterEnd' };
        }
        continue;
      }

      if (stopAt === 'possession') {
        return { state, stoppedReason: 'possession' };
      }
      if (stopAt === 'timeoutTrigger' && evaluateTimeoutStop(state, options)) {
        return { state, stoppedReason: 'timeoutTrigger' };
      }
    }
  }

  // Construye el `MatchState` inicial — ver comentario del bloque TAC-5
  // arriba para la lista completa de campos y su procedencia.
  // `options.homeSquad`/`options.awaySquad`/`options.homeLineup`/
  // `options.awayLineup`/`options.homeTacticalProfile`/
  // `options.awayTacticalProfile`: EXACTAMENTE los mismos overrides que ya
  // aceptaba `simulateMatch()` antes de esta entrega (ver comentarios
  // originales, sin cambios de comportamiento). `options.homeGamePlan`/
  // `options.awayGamePlan` (7.12.23, TAC-5, nuevos): instancia de
  // `Tactics.GamePlan` para ese lado — `null` por defecto (sin ajustes
  // este partido, comportamiento idéntico al de antes de esta entrega).
  function createMatchState(homeTeam, awayTeam, config = CONFIG_BASE, options = {}) {
    const homeSquad = options.homeSquad || defaultMatchSquad(homeTeam);
    const awaySquad = options.awaySquad || defaultMatchSquad(awayTeam);
    const homeTacticalProfile = options.homeTacticalProfile || homeTeam.tacticalProfile || null;
    const awayTacticalProfile = options.awayTacticalProfile || awayTeam.tacticalProfile || null;

    [
      { lineup: options.homeLineup, label: `local (${homeTeam.fullName})` },
      { lineup: options.awayLineup, label: `visitante (${awayTeam.fullName})` },
    ].forEach(({ lineup, label }) => {
      if (!lineup) return;
      const validation = validateLineup(lineup, config);
      if (!validation.valid) {
        throw new Error(`Alineación del equipo ${label} inválida: ${describeValidationErrors(validation.errors)}`);
      }
    });
    const homeRotationState = options.homeLineup ? buildRotationState(options.homeLineup, homeSquad, config) : null;
    const awayRotationState = options.awayLineup ? buildRotationState(options.awayLineup, awaySquad, config) : null;

    const boxScore = new Map();
    // +/- por jugador (retoques de estadísticas, no forma parte de 7.6):
    // inicializado a 0 para toda la convocatoria, se acumula posesión a
    // posesión, y se enriquece en cada línea de boxScore al pedir el
    // resultado (ver buildMatchResult).
    const plusMinus = new Map();
    homeSquad.concat(awaySquad).forEach((player) => plusMinus.set(player.id, 0));

    return {
      config, homeTeam, awayTeam, homeSquad, awaySquad,
      homeTacticalProfile, awayTacticalProfile,
      homeRotationState, awayRotationState,
      // 7.12.23 (TAC-5): GamePlan de partido de cada lado — mutable EN
      // CUALQUIER MOMENTO entre llamadas a advanceMatch() (game.js asigna/
      // reasigna `state.homeGamePlan`/`state.awayGamePlan` directamente);
      // la siguiente posesión ya lo refleja, ver simulateOnePossessionStep.
      homeGamePlan: options.homeGamePlan || null,
      awayGamePlan: options.awayGamePlan || null,
      totalElapsedSeconds: 0,
      boxScore,
      plusMinus,
      quarterScores: { home: [], away: [] },
      runningScore: { home: 0, away: 0 },
      // 7.6.20: modificador de equipo (no toca dynamicState.momentum de
      // jugadores concretos), sin cambios respecto a antes de esta entrega.
      scoringRun: { side: null, points: 0, activeSide: null },
      fastBreakEligible: false,
      eventLog: [],
      possessionCount: { home: 0, away: 0 },
      // Simplificación de Fase 1 (sin cambios): el equipo local empieza
      // siempre con la posesión del primer cuarto y de cada prórroga.
      offenseSide: 'home',
      period: 0,
      isOvertime: false,
      teamFouls: null,
      clockRemaining: 0,
      periodPoints: null,
      // 7.12.24 (TAC-5): tiempos muertos consumidos por equipo/segmento
      // (config.match.timeouts) — ver currentTimeoutSegment/
      // canCallTimeout/consumeTimeout.
      timeouts: {
        [homeTeam.id]: { firstHalf: 0, secondHalf: 0, overtime: {}, usedInLastMinutesOfFourthQuarter: 0 },
        [awayTeam.id]: { firstHalf: 0, secondHalf: 0, overtime: {}, usedInLastMinutesOfFourthQuarter: 0 },
      },
      // 7.12.24: ATO pendiente por lado — se marca al conceder un tiempo
      // muerto y se consume en la siguiente posesión EN ATAQUE de ese
      // equipo (ver simulateOnePossessionStep).
      pendingAto: { home: false, away: false },
      lastTimeoutSide: null,
      lastTimeoutReason: null,
      lastPossessionWasDeadBall: false,
      previousPossessionInboundType: null,
      // Motor de estados mínimo del partido: 'beforePeriod' (toca empezar
      // el siguiente período) | 'inPeriod' (dentro de un período en curso)
      // | 'finished' (partido resuelto, advanceMatch ya no hace nada).
      phase: 'beforePeriod',
    };
  }

  // Resultado con el MISMO shape que consumía cualquier llamador de
  // `simulateMatch()` antes de esta entrega (League.js/Bracket.js/
  // Playoffs.js/Cup.js/Promotion.js no necesitan ningún cambio) — puede
  // llamarse en CUALQUIER punto de `state`, terminado o en pausa: los
  // campos ya acumulados (boxScore/plusMinus/quarterScores/eventLog/...)
  // son válidos en cualquier instante; `quarterScores` solo incluye los
  // períodos ya cerrados (el período en curso vive en
  // `state.periodPoints`, no incluido aquí a propósito — game.js construye
  // su propio resumen agregado "hasta este instante" para la ventana de
  // intervención, más simple que este shape completo de fin de partido).
  function buildMatchResult(state) {
    return {
      finalScore: state.runningScore,
      quarterScores: state.quarterScores,
      wentToOvertime: state.period > state.config.match.quarters,
      overtimePeriods: Math.max(0, state.period - state.config.match.quarters),
      possessionCount: state.possessionCount,
      boxScore: {
        home: state.homeSquad.map((player) => enrichStatLine(getStatLine(state.boxScore, player), state.homeRotationState, state.plusMinus)),
        away: state.awaySquad.map((player) => enrichStatLine(getStatLine(state.boxScore, player), state.awayRotationState, state.plusMinus)),
      },
      eventLog: state.eventLog,
      rotation: { home: rotationSummary(state.homeRotationState), away: rotationSummary(state.awayRotationState) },
    };
  }

  // --- Partido completo: wrapper de compatibilidad sobre el motor por
  // tramos de arriba — MISMA firma, MISMAS `options`, MISMO shape de
  // resultado que antes de esta entrega (ver comentarios de
  // createMatchState/buildMatchResult para el detalle de cada campo).
  // `options.homeTacticalProfile`/`awayTacticalProfile` (DESIGN.md 7.12,
  // TAC-1): con PRIORIDAD sobre `homeTeam.tacticalProfile`/
  // `awayTeam.tacticalProfile` si ambos están presentes, igual que
  // siempre. Un partido sin timeouts solicitados, sin GamePlan y sin Auto
  // Timeouts (los tres por defecto en `options`/`TacticalProfile`) da el
  // MISMO resultado, posesión por posesión, que antes de esta entrega
  // (7.12.34, regresión exacta) — el motor de posesión en sí
  // (`simulatePossession`) no cambia, solo se hace pausable.
  function simulateMatch(homeTeam, awayTeam, config = CONFIG_BASE, options = {}) {
    // DESIGN.md 7.12.24 (TAC-5): `options.precomputedResult` — encaje con
    // game.js sin tocar League.js/Bracket.js/Playoffs.js/Cup.js/
    // Promotion.js: cuando el partido del usuario ya se jugó de verdad,
    // posesión a posesión, sobre `createMatchState`/`advanceMatch` en la
    // pantalla de partido (con las ventanas de intervención que haya
    // usado), game.js pasa aquí ese resultado YA RESUELTO en vez de dejar
    // que este wrapper lo vuelva a simular — volver a simularlo generaría
    // un partido DISTINTO (otra secuencia aleatoria), no el que el
    // usuario acaba de ver. Sin este campo, comportamiento idéntico al de
    // siempre (simula de verdad, wrapper de compatibilidad).
    if (options.precomputedResult) return options.precomputedResult;
    const state = createMatchState(homeTeam, awayTeam, config, options);
    advanceMatch(state, { stopAt: 'matchEnd' });
    return buildMatchResult(state);
  }

  // `computeMixRating`/`getAttribute` se exportan además de
  // `simulateMatch`/`defaultMatchSquad` únicamente para poder verificar en
  // aislamiento los invariantes de balance de DESIGN.md 7.12.31 (Tactics.js,
  // TAC-1) con un script Node dedicado, sin depender del ruido de simular
  // partidos completos — no cambian de comportamiento, ni se usan desde
  // ningún sitio nuevo de producción; MatchEngine.simulateMatch les sigue
  // llamando exactamente igual que antes.
  //
  // TAC-5 (7.12.33): `createMatchState`/`advanceMatch`/`buildMatchResult`
  // son el motor pausable en sí — game.js los usa directamente para la
  // pantalla de partido (ventanas de intervención reales entre cuartos y
  // en tiempo muerto); `canCallTimeout` se expone para que la UI pueda
  // deshabilitar el botón de pedir tiempo muerto sin duplicar la validación.
  const exportsObj = {
    simulateMatch, defaultMatchSquad, computeMixRating, getAttribute,
    createMatchState, advanceMatch, buildMatchResult, canCallTimeout, requestTimeoutNow,
    // `simulatePossession` se expone únicamente para poder verificar en
    // aislamiento la falta táctica intencionada (7.12.24) con un script
    // Node dedicado, sin depender del ruido de simular partidos completos
    // — mismo criterio que computeMixRating/getAttribute más arriba.
    simulatePossession,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
