// src/core/PlayerDevelopment.js
// LIFE-1 (DESIGN.md 9): Carrera, TMB Rating, Potencial, desarrollo y declive.
// Concentra TODAS las reglas de progresión — Player.js solo guarda datos/
// estado, MatchConfig.js solo guarda coeficientes/curvas, game.js solo
// orquesta (llama a las funciones de aquí en los puntos de integración ya
// existentes: applyRecoveryForResolvedMatch y closeSeasonAndPrepareNext).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  const PlayerCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;

  const {
    TECHNICAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, MENTAL_ATTRIBUTES,
    ATTRIBUTE_MIN, ATTRIBUTE_MAX,
  } = PlayerCore;

  // playerGenerator.js (POSITION_PROFILES, sección 4.2) — acceso perezoso
  // (nunca desestructurado en la carga del IIFE) porque en navegador
  // playerGenerator.js puede cargar antes O después de este archivo según
  // el orden de <script> de index.html; en Node no hay ese problema pero se
  // mantiene el mismo patrón por consistencia (mismo criterio que
  // MatchConfigCore en playerGenerator.js/TacticsCore en Team.js).
  function getPlayerGenerator() {
    return (typeof module !== 'undefined' && module.exports)
      ? require('../utils/playerGenerator.js')
      : global.BasketManager;
  }

  // --- Sección 8: atributos mutables en LIFE-1 (29 en total) ---
  // Se derivan de las listas YA existentes en Player.js, excluyendo los
  // fijos no mutables de cada grupo (foulTendency/durability/aggressiveness/
  // temperament/workRate) — no se duplica un catálogo nuevo desde cero.
  const NON_MUTABLE_TECHNICAL = new Set(['foulTendency']);
  const NON_MUTABLE_PHYSICAL = new Set(['durability']);
  const NON_MUTABLE_MENTAL = new Set(['aggressiveness', 'temperament', 'workRate']);

  const MUTABLE_TECHNICAL = TECHNICAL_ATTRIBUTES.filter((a) => !NON_MUTABLE_TECHNICAL.has(a));
  const MUTABLE_PHYSICAL = PHYSICAL_ATTRIBUTES.filter((a) => !NON_MUTABLE_PHYSICAL.has(a));
  const MUTABLE_MENTAL = MENTAL_ATTRIBUTES.filter((a) => !NON_MUTABLE_MENTAL.has(a));
  const ALL_MUTABLE_ATTRIBUTES = [...MUTABLE_TECHNICAL, ...MUTABLE_PHYSICAL, ...MUTABLE_MENTAL];

  if (ALL_MUTABLE_ATTRIBUTES.length !== 29) {
    throw new Error(
      `PlayerDevelopment: se esperaban 29 atributos mutables (sección 8), hay ${ALL_MUTABLE_ATTRIBUTES.length}. `
      + 'Revisa NON_MUTABLE_* o las listas de Player.js.',
    );
  }

  // Grupo (technical/physical/mental) de cada atributo mutable — para leer/
  // escribir player[group][attr] sin repetir un switch en cada función.
  const ATTRIBUTE_GROUP = {};
  MUTABLE_TECHNICAL.forEach((a) => { ATTRIBUTE_GROUP[a] = 'technical'; });
  MUTABLE_PHYSICAL.forEach((a) => { ATTRIBUTE_GROUP[a] = 'physical'; });
  MUTABLE_MENTAL.forEach((a) => { ATTRIBUTE_GROUP[a] = 'mental'; });

  // --- Sección 16: categoría de cada atributo mutable para las curvas de
  // aprendizaje/declive — construida a partir de config.playerDevelopment.
  // attributeCategories (CONFIG, no hardcodeada aquí) la primera vez que se
  // necesita, cacheada por objeto config (normalmente hay un único
  // CONFIG_BASE vivo en toda la sesión).
  const categoryMapCache = new WeakMap();
  function getAttributeCategoryMap(config) {
    let map = categoryMapCache.get(config);
    if (map) return map;
    map = {};
    const categories = config.playerDevelopment.attributeCategories;
    Object.keys(categories).forEach((category) => {
      categories[category].forEach((attr) => { map[attr] = category; });
    });
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
      if (!map[attr]) {
        throw new Error(`PlayerDevelopment: el atributo mutable "${attr}" no tiene categoría en CONFIG (sección 16).`);
      }
    });
    categoryMapCache.set(config, map);
    return map;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampAttributeInt(value) {
    return clamp(Math.round(value), ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  }

  // --- Ruido determinista (sección 24) ---
  // Hash FNV-1a de una clave de texto a [0,1) — MISMO patrón/algoritmo que
  // Calendar.hashToUnitInterval() (Calendar.js no lo exporta, así que no se
  // puede reutilizar por import; se reimplementa aquí en vez de escribir un
  // segundo generador determinista con otro criterio).
  function hashToUnitInterval(key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function deterministicUnit(...keyParts) {
    return hashToUnitInterval(keyParts.join('|'));
  }

  // Variable con forma "triangular" (suma de 2 uniformes), pico en el
  // centro del rango, menos extremos que una uniforme plana — usada para
  // learningRate/learningPersistence/agingOffsetYears (secciones 6 y 15,
  // "distribución centrada, pocos extremos, no uniforme plana").
  function deterministicTriangularUnit(...keyParts) {
    const u1 = deterministicUnit(...keyParts, 'a');
    const u2 = deterministicUnit(...keyParts, 'b');
    return (u1 + u2) / 2; // en [0,1), pico en 0.5
  }

  function linearMap(value, inMin, inMax, outMin, outMax) {
    const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
    return outMin + t * (outMax - outMin);
  }

  // --- Sección 11: edad continua (nunca cliff de cumpleaños) ---
  // Reutiliza `birthDate` directamente (no duplica calculateAge(): esa
  // función de Player.js redondea a entero por año cumplido a propósito
  // para el getter `player.age`, que la UI sigue usando tal cual).
  function ageAt(player, date) {
    if (!player.birthDate) return null;
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    return (date.getTime() - player.birthDate.getTime()) / msPerYear;
  }

  // --- Interpolación lineal por puntos [edad, factor] (secciones 14/15) —
  // fuera de rango usa el valor extremo, nunca extrapola.
  function interpolateCurve(points, x) {
    if (x <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      if (x >= x0 && x <= x1) {
        const t = (x - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    return last[1];
  }

  // --- Sección 4.2: pesos de relevancia posicional para TMB ---
  // Rango global de deltas observado en TODO el catálogo POSITION_PROFILES
  // (solo para los 29 atributos mutables — los deltas de atributos no
  // mutables como foulTendency/durability/aggressiveness no forman parte
  // de la fórmula de TMB, así que no participan del rango de normalización)
  // — mismo rango para las 5 posiciones, para que un delta idéntico
  // produzca siempre el mismo peso donde sea que aparezca (documentado en
  // sección 4.2 del prompt de esta sesión).
  let cachedDeltaRange = null;
  function getGlobalDeltaRange() {
    if (cachedDeltaRange) return cachedDeltaRange;
    const { POSITION_PROFILES } = getPlayerGenerator();
    let min = Infinity;
    let max = -Infinity;
    Object.keys(POSITION_PROFILES).forEach((pos) => {
      const profile = POSITION_PROFILES[pos];
      ['technical', 'physical', 'mental'].forEach((group) => {
        Object.keys(profile[group]).forEach((attr) => {
          if (!ATTRIBUTE_GROUP[attr]) return; // no mutable, fuera del rango de TMB
          const delta = profile[group][attr];
          if (delta < min) min = delta;
          if (delta > max) max = delta;
        });
      });
    });
    cachedDeltaRange = { min, max };
    return cachedDeltaRange;
  }

  const positionWeightsCache = new Map();
  function getPositionWeights(nominalPosition, config) {
    const cacheKey = nominalPosition;
    if (positionWeightsCache.has(cacheKey)) return positionWeightsCache.get(cacheKey);
    const { POSITION_PROFILES } = getPlayerGenerator();
    const profile = POSITION_PROFILES[nominalPosition];
    const { relevanceFloor, relevanceCeiling } = config.playerDevelopment.tmb;
    const { min, max } = getGlobalDeltaRange();
    const weights = {};
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
      const group = ATTRIBUTE_GROUP[attr];
      const delta = profile[group][attr];
      if (delta === undefined) {
        weights[attr] = relevanceFloor;
        return;
      }
      const normalized = max === min ? 1 : clamp((delta - min) / (max - min), 0, 1);
      weights[attr] = relevanceFloor + normalized * (relevanceCeiling - relevanceFloor);
    });
    positionWeightsCache.set(cacheKey, weights);
    return weights;
  }

  // --- Sección 9: precisión interna (residual decimal) ---
  function getEffectiveAttribute(player, attr) {
    const group = ATTRIBUTE_GROUP[attr];
    const residual = (player.developmentState && player.developmentState.attributeProgress[attr]) || 0;
    return player[group][attr] + residual;
  }

  // Aplica un delta (+ o -) al residual de un atributo, cruzando el entero
  // visible cuando corresponda (sección 9: residual normalmente en
  // [-0.5,+0.5); >= +0.5 -> visible+1/residual-1; < -0.5 -> visible-1/
  // residual+1). Clampa el visible 1-20 (nunca el residual, que puede
  // quedar fuera de [-0.5,0.5) un instante si el visible ya está en el
  // límite y sigue "empujando" en esa dirección — se resuelve solo en
  // cuanto el visible pueda volver a moverse).
  function applyResidualDelta(player, attr, delta) {
    const group = ATTRIBUTE_GROUP[attr];
    const progress = player.developmentState.attributeProgress;
    let residual = (progress[attr] || 0) + delta;
    let visible = player[group][attr];
    while (residual >= 0.5 && visible < ATTRIBUTE_MAX) {
      visible += 1;
      residual -= 1;
    }
    while (residual < -0.5 && visible > ATTRIBUTE_MIN) {
      visible -= 1;
      residual += 1;
    }
    player[group][attr] = clampAttributeInt(visible);
    progress[attr] = residual;
  }

  // --- Sección 3.3/4: TMB Rating ---
  function computeUncappedTmb(player, config) {
    const weights = getPositionWeights(player.nominalPosition, config);
    let sumWeight = 0;
    let sumWeightedAttr = 0;
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
      const w = weights[attr];
      sumWeight += w;
      sumWeightedAttr += w * getEffectiveAttribute(player, attr);
    });
    const weightedAverage = sumWeightedAttr / sumWeight;
    if (weightedAverage <= 1) return 1;
    const { eliteWeightedAverage } = config.playerDevelopment.tmb;
    return 1 + 199 * ((weightedAverage - 1) / (eliteWeightedAverage - 1));
  }

  function computeTmbRating(player, config) {
    const { min, max } = config.playerDevelopment.tmb;
    return clamp(Math.round(computeUncappedTmb(player, config)), min, max);
  }

  // --- Sección 7: mindset/learning factors ---
  function computeMindsetFactor(player, config) {
    const { professionalismFactor, ambitionFactor } = config.playerDevelopment.mindset;
    const pf = linearMap(player.hidden.professionalism, 1, 20, professionalismFactor.at1, professionalismFactor.at20);
    const af = linearMap(player.hidden.ambition, 1, 20, ambitionFactor.at1, ambitionFactor.at20);
    return (pf + af) / 2;
  }

  function computeLearningFactor(player, config) {
    const { learningRateFactor } = config.playerDevelopment.mindset;
    const lrf = linearMap(player.hidden.learningRate, 1, 20, learningRateFactor.at1, learningRateFactor.at20);
    return lrf * computeMindsetFactor(player, config);
  }

  // --- Sección 19: exposición competitiva (minutos, rendimientos
  // decrecientes) ---
  function computeExposureFactor(player, tickDate, config) {
    const { windowDays, referenceWeeklyMinutes, zeroMinutesFactor, divisionWeight } = config.playerDevelopment.exposure;
    const exposures = player.developmentState.matchExposures || [];
    const windowStart = tickDate.getTime() - windowDays * 24 * 60 * 60 * 1000;
    let weightedMinutes = 0;
    exposures.forEach((exp) => {
      const expDate = exp.date instanceof Date ? exp.date : new Date(exp.date);
      if (expDate.getTime() < windowStart || expDate.getTime() > tickDate.getTime()) return;
      const weight = divisionWeight[exp.division] !== undefined ? divisionWeight[exp.division] : 1;
      weightedMinutes += exp.minutes * weight;
    });
    const weeklyMinutes = weightedMinutes / (windowDays / 7);
    return zeroMinutesFactor + (1 - zeroMinutesFactor) * Math.sqrt(Math.max(0, weeklyMinutes) / referenceWeeklyMinutes);
  }

  // Elimina del estado las exposiciones que ya han salido de la ventana (no
  // volverán a contar en ningún tick futuro) — evita que matchExposures
  // crezca indefinidamente (sección 10).
  function pruneOldExposures(player, tickDate, config) {
    const { windowDays } = config.playerDevelopment.exposure;
    const windowStart = tickDate.getTime() - windowDays * 24 * 60 * 60 * 1000;
    player.developmentState.matchExposures = (player.developmentState.matchExposures || [])
      .filter((exp) => {
        const expDate = exp.date instanceof Date ? exp.date : new Date(exp.date);
        return expDate.getTime() >= windowStart;
      });
  }

  // --- Sección 20: instalaciones del club ---
  // Mapping 1-20 -> factor compartido (extraído para que LIFE-2 pueda
  // reutilizar EXACTAMENTE el mismo mapping para `staffContext`, sección
  // 3-bis del prompt LIFE-2, sin copiar los números ni inventar otro
  // mapping — "replique el mismo mapping 1–20 → factor que ya usa
  // computeFacilityFactor").
  function mapLevelToFactor(level, minLevel, maxLevel, minFactor, maxFactor, neutralLevel) {
    const resolved = level === undefined || level === null ? neutralLevel : level;
    return linearMap(resolved, minLevel, maxLevel, minFactor, maxFactor);
  }

  function computeFacilityFactor(facilityLevel, config) {
    const { minLevel, maxLevel, minFactor, maxFactor, neutralLevelWhenNoTeam } = config.playerDevelopment.facility;
    return mapLevelToFactor(facilityLevel, minLevel, maxLevel, minFactor, maxFactor, neutralLevelWhenNoTeam);
  }

  // --- LIFE-2 (prompt de esta sesión, sección 3-bis): `staffContext` —
  // construcción NUEVA de LIFE-2, no heredada de LIFE-1 (ver corrección de
  // la sección 0 de ese prompt: LIFE-1 no dejó ningún objeto `staffContext`
  // preparado). Reutiliza el MISMO mapping 1-20 -> factor de
  // `computeFacilityFactor` de arriba (mismo rango 0.9-1.1,
  // `playerDevelopment.facility.minLevel/maxLevel/minFactor/maxFactor`) —
  // rating=10 (neutro mientras no exista Staff real) da un factor cercano
  // a 1.0, igual que facilityLevel=10. Usado SOLO por los sistemas nuevos
  // de LIFE-2 que lo piden explícitamente (posición/rol táctico) — nunca
  // por el crecimiento general de atributos, que sigue usando
  // `playerDevelopment.staffFactor` (LIFE-1, escalar plano) tal cual.
  function staffRatingToFactor(rating, config) {
    const { minLevel, maxLevel, minFactor, maxFactor, neutralLevelWhenNoTeam } = config.playerDevelopment.facility;
    return mapLevelToFactor(rating, minLevel, maxLevel, minFactor, maxFactor, neutralLevelWhenNoTeam);
  }

  // --- Sección 15: longevidad individual (agingOffsetYears) ---
  function generateAgingOffsetYears(seed, config) {
    const { min, max } = config.playerDevelopment.agingOffset;
    const triangular = deterministicTriangularUnit(seed, 'agingOffset');
    const centered = (triangular - 0.5) * 2; // en [-1,1), pico en 0
    return centered < 0 ? centered * -min : centered * max;
  }

  // --- Sección 6: learningRate/learningPersistence (distribución centrada
  // 10-11, pocos extremos) ---
  function generateLearningAttribute(seed, key) {
    const triangular = deterministicTriangularUnit(seed, key); // pico en 0.5 -> valor central 10.5
    return clampAttributeInt(1 + triangular * (ATTRIBUTE_MAX - ATTRIBUTE_MIN));
  }

  // --- Sección 21: declive por edad ---
  function computeDeclineFactorDamping(player, category, config) {
    if (category !== 'technical' && category !== 'cognitive' && category !== 'social') return 1;
    const { at1, at20 } = config.playerDevelopment.learningPersistenceDeclineDamping;
    return linearMap(player.hidden.learningPersistence, 1, 20, at1, at20);
  }

  // --- Sección 10: developmentState — inicialización idempotente ---
  // Se llama en cada punto de integración (generador de nuevos jugadores,
  // reconstrucción de jugadores reales, antes de procesar ticks) — si ya
  // existe, no hace nada salvo comprobar/reforzar el suelo de Potencial
  // (sección 5, invariante 13: "PA migrado nunca < TMB actual").
  function ensureDevelopmentState(player, config, referenceDate) {
    const refDate = referenceDate || new Date();
    if (!player.developmentState) {
      const seed = player.id;
      player.developmentState = {
        developmentSeed: seed,
        lastProcessedDate: new Date(refDate),
        attributeProgress: {},
        matchExposures: [],
        agingOffsetYears: generateAgingOffsetYears(seed, config),
      };
      ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
        const spread = config.playerDevelopment.noise.residualInitSpread;
        player.developmentState.attributeProgress[attr] = (deterministicUnit(seed, 'residual', attr) * 2 - 1) * spread;
      });
    } else if (!(player.developmentState.lastProcessedDate instanceof Date)) {
      // Reconstrucción desde JSON (fechas serializadas como string ISO).
      player.developmentState.lastProcessedDate = new Date(player.developmentState.lastProcessedDate);
    }
    const ds = player.developmentState;
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
      if (ds.attributeProgress[attr] === undefined) {
        const spread = config.playerDevelopment.noise.residualInitSpread;
        ds.attributeProgress[attr] = (deterministicUnit(ds.developmentSeed, 'residual', attr) * 2 - 1) * spread;
      }
    });
    if (ds.agingOffsetYears === undefined || ds.agingOffsetYears === null) {
      ds.agingOffsetYears = generateAgingOffsetYears(ds.developmentSeed, config);
    }
    if (!ds.matchExposures) ds.matchExposures = [];

    // Sección 6: learningRate/learningPersistence — Player.js los deja en
    // `null` cuando no vienen informados en los datos (ver Player.js,
    // desviación documentada en CHANGELOG); se generan aquí UNA sola vez y
    // se persisten en `player.hidden`, nunca en developmentState.
    if (player.hidden.learningRate === null || player.hidden.learningRate === undefined) {
      player.hidden.learningRate = generateLearningAttribute(ds.developmentSeed, 'learningRate');
    }
    if (player.hidden.learningPersistence === null || player.hidden.learningPersistence === undefined) {
      player.hidden.learningPersistence = generateLearningAttribute(ds.developmentSeed, 'learningPersistence');
    }

    // Sección 5 (invariante 13): el suelo de Potencial se reafirma cada vez
    // — nunca puede quedar por debajo del TMB actual, ni siquiera si un
    // guardado antiguo lo dejó justo al límite y el jugador mejoró desde
    // entonces por otra vía.
    if (player.birthDate) {
      const uncapped = computeUncappedTmb(player, config);
      const floor = Math.ceil(clamp(uncapped, 1, config.playerDevelopment.tmb.max));
      if (player.hidden.potential < floor) player.hidden.potential = clamp(floor, 1, config.playerDevelopment.tmb.max);
    }
    return ds;
  }

  // --- Sección 10: registrar exposición de partido ---
  // `minutes` ya viene calculado por el llamador (game.js,
  // applyRecoveryForResolvedMatch) como playedSeconds/60 redondeado.
  // `positionMinutes` (LIFE-2, DESIGN.md 9, sección 17 del prompt de esa
  // sesión): opcional, `{ [position]: minutes }` — minutos REALES por
  // posición ocupada en pista (Rotation.js/MatchEngine.rotationSummary),
  // nunca inferidos de `nominalPosition`. Campo canónico nuevo del mismo
  // registro de exposición, no una estructura paralela.
  function recordMatchExposure(player, {
    date, minutes, competition, division, positionMinutes,
  }) {
    if (!minutes || minutes <= 0) return;
    if (!player.developmentState) return; // defensivo: se inicializa en ensureDevelopmentState antes de esto
    player.developmentState.matchExposures.push({
      date, minutes, competition, division, positionMinutes: positionMinutes || undefined,
    });
  }

  // --- Sección 23: orden de aplicación de un tick completo ---
  function processOneTick(player, tickDate, config, context) {
    const categoryMap = getAttributeCategoryMap(config);
    const age = ageAt(player, tickDate);
    const ds = player.developmentState;
    const effectiveDeclineAge = age - ds.agingOffsetYears;

    const before = {};
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => { before[attr] = getEffectiveAttribute(player, attr); });

    // 1-3: declive por edad (independiente del crecimiento, sección 13/21).
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
      const category = categoryMap[attr];
      const declineFactor = interpolateCurve(config.playerDevelopment.declineCurves[category], effectiveDeclineAge);
      if (declineFactor <= 0) return;
      const damping = computeDeclineFactorDamping(player, category, config);
      const declineDelta = config.playerDevelopment.baseDeclineRate * declineFactor * damping;
      applyResidualDelta(player, attr, -declineDelta);
    });

    // 4: recalcula TMB/headroom tras el declive.
    const uncappedAfterDecline = computeUncappedTmb(player, config);
    const potential = player.hidden.potential;
    const headroom = Math.max(0, potential - uncappedAfterDecline);

    // 5-6: crecimiento positivo, limitado por headroom de PA (sección 22).
    pruneOldExposures(player, tickDate, config);
    const exposureFactor = computeExposureFactor(player, tickDate, config);
    const facilityFactor = computeFacilityFactor(context && context.facilityLevel, config);
    const staffFactor = config.playerDevelopment.staffFactor;
    const learningFactor = computeLearningFactor(player, config);
    const weights = getPositionWeights(player.nominalPosition, config);
    let sumWeight = 0;
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => { sumWeight += weights[attr]; });
    const { eliteWeightedAverage } = config.playerDevelopment.tmb;
    const tmbPerWeightedAvgPoint = 199 / (eliteWeightedAverage - 1);

    // LIFE-2 (prompt de esta sesión, sección 3-bis): `context.stimulusByAttribute`
    // — hook NUEVO, no existía en LIFE-1 (ver corrección de la sección 0 de
    // ese prompt). Mapa opcional atributo -> multiplicador (ausente o sin
    // `context.stimulusByAttribute` = 1.00 para todos, comportamiento
    // idéntico a antes de LIFE-2). Se multiplica ENCIMA de los factores ya
    // existentes, nunca los sustituye — es la única vía por la que
    // Training influye en QUÉ atributo crece más, dejando edad/PA/
    // headroom/ruido exactamente como en LIFE-1. No se aplica a
    // `declineDelta` (sección 1-3 de arriba): el trade-off de intensidad
    // de Training vive en Energy, no en frenar el declive.
    const stimulusByAttribute = context && context.stimulusByAttribute;
    const rawGrowthDeltas = {};
    let rawDeltaUncappedTmb = 0;
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
      const category = categoryMap[attr];
      const categoryFactor = interpolateCurve(config.playerDevelopment.growthCurves[category], age);
      if (categoryFactor <= 0) { rawGrowthDeltas[attr] = 0; return; }
      const trainability = config.playerDevelopment.trainability[attr];
      const noiseSpread = config.playerDevelopment.noise.growthNoiseSpread;
      const noiseFactor = 1 + (deterministicUnit(ds.developmentSeed, 'growth', attr, ds.lastProcessedDate.toISOString()) * 2 - 1) * noiseSpread;
      const stimulusFactor = (stimulusByAttribute && stimulusByAttribute[attr] !== undefined) ? stimulusByAttribute[attr] : 1.00;
      const growthDelta = config.playerDevelopment.baseGrowthRate
        * categoryFactor * trainability * learningFactor * exposureFactor * facilityFactor * staffFactor * noiseFactor
        * stimulusFactor;
      rawGrowthDeltas[attr] = growthDelta;
      rawDeltaUncappedTmb += (growthDelta * weights[attr]) / sumWeight * tmbPerWeightedAvgPoint;
    });

    let scale = 1;
    if (rawDeltaUncappedTmb > headroom && rawDeltaUncappedTmb > 0) {
      scale = headroom / rawDeltaUncappedTmb;
    }
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
      const delta = rawGrowthDeltas[attr] * scale;
      if (delta !== 0) applyResidualDelta(player, attr, delta);
    });

    ds.lastProcessedDate = new Date(tickDate);

    const after = {};
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => { after[attr] = getEffectiveAttribute(player, attr); });
    return {
      date: new Date(tickDate), age, effectiveDeclineAge, headroom, growthScale: scale,
      tmbBefore: computeTmbRatingFromWeightedInputs(before, weights, sumWeight, config),
      tmbAfter: computeTmbRating(player, config),
      changes: ALL_MUTABLE_ATTRIBUTES.reduce((acc, attr) => {
        const delta = after[attr] - before[attr];
        if (Math.abs(delta) > 1e-9) acc[attr] = delta;
        return acc;
      }, {}),
    };
  }

  function computeTmbRatingFromWeightedInputs(effectiveMap, weights, sumWeight, config) {
    let sumWeightedAttr = 0;
    ALL_MUTABLE_ATTRIBUTES.forEach((attr) => { sumWeightedAttr += weights[attr] * effectiveMap[attr]; });
    const weightedAverage = sumWeightedAttr / sumWeight;
    const { eliteWeightedAverage, min, max } = config.playerDevelopment.tmb;
    if (weightedAverage <= 1) return 1;
    const uncapped = 1 + 199 * ((weightedAverage - 1) / (eliteWeightedAverage - 1));
    return clamp(Math.round(uncapped), min, max);
  }

  // --- Sección 12: procesamiento hasta una fecha, con remanente ---
  // `context` (LIFE-2, prompt de esta sesión): además del objeto plano de
  // siempre, admite una FUNCIÓN `(tickDate) => context` — necesario porque
  // Training.js calcula `stimulusByAttribute`/densidad competitiva por
  // SEMANA (pueden cambiar tick a tick dentro de una misma llamada que
  // recupera varias semanas de golpe), mientras que un objeto plano se
  // aplicaría igual a todos los ticks de esta llamada. Un objeto plano
  // sigue funcionando exactamente igual que antes (compatibilidad total
  // con los llamadores existentes, ej. scripts/test-life1.js).
  function resolveTickContext(context, tickDate) {
    return typeof context === 'function' ? context(tickDate) : context;
  }

  function processPlayerToDate(player, targetDate, config, context) {
    ensureDevelopmentState(player, config, targetDate);
    if (!player.birthDate) {
      return { skipped: true, reason: 'no-birthdate', ticks: 0, changes: [] };
    }
    const ds = player.developmentState;
    const tickMs = config.playerDevelopment.tickDays * 24 * 60 * 60 * 1000;
    let cursor = ds.lastProcessedDate.getTime();
    const targetMs = targetDate.getTime();
    const changes = [];
    while (targetMs - cursor >= tickMs) {
      cursor += tickMs;
      const tickDate = new Date(cursor);
      changes.push(processOneTick(player, tickDate, config, resolveTickContext(context, tickDate)));
    }
    return { skipped: false, ticks: changes.length, changes };
  }

  function processTeamToDate(team, targetDate, config, context) {
    const facilityLevel = context && context.facilityLevel !== undefined
      ? context.facilityLevel
      : (team.facilities && team.facilities[config.playerDevelopment.facility.key]
        ? team.facilities[config.playerDevelopment.facility.key].level
        : undefined);
    const teamContext = { ...context, facilityLevel };
    return team.roster.map((player) => ({
      player,
      result: processPlayerToDate(player, targetDate, config, teamContext),
    }));
  }

  const exportsObj = {
    MUTABLE_TECHNICAL,
    MUTABLE_PHYSICAL,
    MUTABLE_MENTAL,
    ALL_MUTABLE_ATTRIBUTES,
    ageAt,
    getEffectiveAttribute,
    // LIFE-3 (DESIGN.md 9.14, sección 27 del prompt de esa sesión): expuesta
    // para que Medical.js aplique secuelas de lesión a través del MISMO
    // mecanismo de residuales/clamps que usa el crecimiento normal — nunca
    // un bypass que edite `player[group][attr]` directamente.
    applyResidualDelta,
    computeUncappedTmb,
    computeTmbRating,
    computeMindsetFactor,
    computeLearningFactor,
    computeExposureFactor,
    computeFacilityFactor,
    staffRatingToFactor,
    ensureDevelopmentState,
    recordMatchExposure,
    processPlayerToDate,
    processTeamToDate,
    getPositionWeights,
    // Expuestas para el modo prueba (sección 29) y para tests dirigidos.
    hashToUnitInterval,
    deterministicUnit,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
