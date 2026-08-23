// src/utils/playerGenerator.js
// Generador de jugadores ficticios de prueba (data/fictional/), para poder
// probar el motor mientras se construye la base de datos real (DESIGN.md,
// sección 6). Los perfiles por posición de este archivo son una heurística
// de prueba, no una regla de diseño acordada en DESIGN.md.

(function (global) {
  const Core = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;
  // MatchConfig.js (config.positions.wingspanBiasThresholdCm, Modelo B de
  // 7.4/mini-EPIC POS) — en Node se puede requerir aquí sin más; en
  // navegador MatchConfig.js carga DESPUÉS que este archivo (ver
  // index.html), así que se lee de global.BasketManager en tiempo de
  // llamada (getPositionsConfig()), nunca desestructurado en la carga del
  // propio IIFE.
  const MatchConfigCore = (typeof module !== 'undefined' && module.exports)
    ? require('../core/MatchConfig.js')
    : null;

  // LIFE-1 (DESIGN.md 9): acceso perezoso a PlayerDevelopment.js, mismo
  // patrón que MatchConfigCore de arriba — evita depender del orden de
  // carga de <script> en el navegador.
  function getPlayerDevelopment() {
    return (typeof module !== 'undefined' && module.exports)
      ? require('../core/PlayerDevelopment.js')
      : global.BasketManager;
  }

  const {
    Player,
    POSITIONS,
    TRAITS,
    TECHNICAL_ATTRIBUTES,
    PHYSICAL_ATTRIBUTES,
    MENTAL_ATTRIBUTES,
    ATTRIBUTE_MIN,
    ATTRIBUTE_MAX,
  } = Core;

  function getPositionsConfig() {
    const base = MatchConfigCore ? MatchConfigCore.CONFIG_BASE : global.BasketManager.CONFIG_BASE;
    return base.positions;
  }

  const ATTRIBUTE_BASE = 10; // valor medio de partida antes de aplicar el perfil de posición
  const NOISE_SPREAD = 2.5; // variación aleatoria +/- sobre el valor del perfil
  const HIDDEN_NOISE_SPREAD = 6; // profesionalidad/ambición varían más (no dependen de posición)
  // LIFE-1 (DESIGN.md 9): Potencial ya no vive en escala 1-20 — se genera
  // con más dispersión que profesionalidad/ambición para cubrir bien el
  // rango 1-200 en la población ficticia (decisión de calibración propia de
  // esta sesión, sin validar por playtesting). El resultado es solo un
  // PUNTO DE PARTIDA: PlayerDevelopment.ensureDevelopmentState() lo eleva
  // si hiciera falta para que nunca quede por debajo del TMB inicial ya
  // calculado a partir de los atributos recién generados (invariante 13).
  const POTENTIAL_NOISE_SPREAD = 9;

  // Nombres claramente ficticios (no corresponden a jugadores reales) para
  // no mezclar datos inventados con la base de datos real de data/real/.
  const FIRST_NAMES = [
    'Javier', 'Carlos', 'Alberto', 'Diego', 'Marcos', 'Sergio', 'Adrián',
    'Rubén', 'Pablo', 'Iván', 'Álvaro', 'Hugo', 'Mario', 'Raúl', 'Óscar',
    'Nicolás', 'Gonzalo', 'Bruno', 'Emilio', 'Tomás',
  ];
  const LAST_NAMES = [
    'Molina', 'Vidal', 'Serrano', 'Cortés', 'Reyes', 'Aguilar', 'Peña',
    'Bravo', 'Campos', 'Guerrero', 'Lozano', 'Nieto', 'Ortega', 'Pardo',
    'Rincón', 'Salinas', 'Tapia', 'Ugarte', 'Vega', 'Yuste',
  ];

  // Deltas sobre ATTRIBUTE_BASE por posición. Solo se listan los atributos
  // donde una posición debería destacar o flojear claramente (ej. un Base
  // con más Pase/Manejo de balón, un Pívot con más Rebote/Tapón); el resto
  // de atributos se queda en el valor base +/- ruido aleatorio.
  const POSITION_PROFILES = {
    'Base': {
      technical: {
        ballHandling: 6, passing: 6, outsideShot: 3, midRangeShot: 2,
        freeThrows: 2, insideShot: -3, layup: -1, offensiveRebound: -4,
        defensiveRebound: -3, blocking: -5, stealing: 4, foulTendency: -1,
        perimeterDefense: 3, interiorDefense: -5,
      },
      physical: {
        topSpeed: 4, acceleration: 4, jumping: 1, strength: -3,
        agility: 4, stamina: 2, recovery: 1,
      },
      mental: {
        gameVision: 4, pressureDecisionMaking: 2, leadership: 2,
        positioning: 1, anticipation: 2,
      },
    },
    'Escolta': {
      technical: {
        outsideShot: 5, midRangeShot: 4, freeThrows: 3, ballHandling: 2,
        insideShot: -1, layup: 1, offensiveRebound: -3, defensiveRebound: -2,
        blocking: -4, stealing: 2, perimeterDefense: 2, interiorDefense: -4,
      },
      physical: {
        topSpeed: 3, acceleration: 3, jumping: 2, strength: -2,
        agility: 3, stamina: 1,
      },
      mental: { aggressiveness: 1, concentration: 1 },
    },
    'Alero': {
      technical: {
        outsideShot: 2, midRangeShot: 2, freeThrows: 2, insideShot: 1,
        layup: 2, ballHandling: 1, defensiveRebound: 1, blocking: -1, stealing: 1,
        perimeterDefense: 1, interiorDefense: 1,
      },
      physical: { topSpeed: 1, acceleration: 1, jumping: 2, balance: 1, stamina: 1 },
      mental: { consistency: 1, teamwork: 1 },
    },
    'Ala-pívot': {
      technical: {
        outsideShot: -2, midRangeShot: 1, insideShot: 3, layup: 3,
        ballHandling: -3, passing: -1, offensiveRebound: 4, defensiveRebound: 4,
        blocking: 3, stealing: -2, foulTendency: 1,
        perimeterDefense: -2, interiorDefense: 3,
      },
      physical: {
        topSpeed: -2, acceleration: -2, jumping: 2, strength: 4,
        agility: -1, balance: 2, recovery: -1, durability: 1,
      },
      mental: { workRate: 1, teamwork: 1 },
    },
    'Pívot': {
      technical: {
        outsideShot: -5, midRangeShot: -2, insideShot: 2, layup: 4,
        freeThrows: -1, ballHandling: -5, passing: -2, offensiveRebound: 6,
        defensiveRebound: 6, blocking: 5, stealing: -3, foulTendency: 2,
        perimeterDefense: -4, interiorDefense: 5,
      },
      physical: {
        topSpeed: -4, acceleration: -4, jumping: 1, strength: 6,
        agility: -3, balance: 2, stamina: -1, recovery: -1, durability: 1,
      },
      mental: { workRate: 1 },
    },
  };

  // Rangos de Altura/Peso por posición — DESIGN.md 6.1 solo fija dos
  // referencias explícitas (Base 178-195cm, Pívot 195-215cm); el resto son
  // interpolaciones razonables entre esos extremos, con solape deliberado
  // entre posiciones vecinas (un Ala-pívot puede ser más alto que un Pívot
  // "pequeño"), reflejando que la posición no es un compartimento estanco
  // de altura en el baloncesto real. El peso no tiene ninguna referencia de
  // Dennis todavía: es una aproximación propia, escalada con la altura
  // típica de cada posición (más altura/fuerza esperada → más peso medio).
  const POSITION_BODY_PROFILES = {
    'Base': { height: [178, 195], weight: [75, 90] },
    'Escolta': { height: [185, 198], weight: [80, 95] },
    'Alero': { height: [193, 205], weight: [88, 100] },
    'Ala-pívot': { height: [198, 210], weight: [95, 110] },
    'Pívot': { height: [195, 215], weight: [100, 120] },
  };

  function randomFrom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomNoise(spread) {
    return (Math.random() * 2 - 1) * spread;
  }

  function generateFictionalName() {
    const firstName = randomFrom(FIRST_NAMES);
    const lastName = `${randomFrom(LAST_NAMES)} ${randomFrom(LAST_NAMES)}`;
    return { firstName, lastName };
  }

  function randomBirthDate(minAge, maxAge) {
    const age = minAge + Math.floor(Math.random() * (maxAge - minAge + 1));
    const now = new Date();
    const year = now.getFullYear() - age;
    const month = Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 28);
    return new Date(year, month, day);
  }

  // Genera el mapa de 5 posiciones (DESIGN.md 6.1, revisión mini-EPIC POS):
  // decide una posición NOMINAL explícita (ancla, `forcedPrimary` si se
  // indica, si no al azar) y un arquetipo de polivalencia; las posiciones
  // no elevadas a nivel alto se rellenan según la DISTANCIA a la ancla más
  // cercana (Base=0, Escolta=1, Alero=2, Ala-pívot=3, Pívot=4 — índice del
  // array POSITIONS): adyacente (distancia 1) = competencia media con
  // variación, el resto = competencia baja. Heurística propia de este
  // generador de prueba, NO una regla de diseño acordada (DESIGN.md 6.1
  // solo exige que las 5 claves existan siempre con nivel 1-20; el shape ya
  // no exige una única posición en 20).
  const ADJACENT_LEVEL_BASE = 10;
  const ADJACENT_LEVEL_SPREAD = 6;
  const DISTANT_LEVEL_BASE = 3;
  const DISTANT_LEVEL_SPREAD = 2;

  // Pesos de arquetipo de polivalencia (mini-EPIC POS) — heurística de
  // generación, no regla de diseño cerrada (mismo criterio que el
  // comentario de POSITION_PROFILES): especialista puro (mayoritario),
  // combo/polivalente moderado, y positionless (raro).
  const POSITION_ARCHETYPE_WEIGHTS = {
    specialist: 0.6,
    combo: 0.3,
    positionless: 0.1,
  };

  function pickPositionArchetype() {
    const entries = Object.entries(POSITION_ARCHETYPE_WEIGHTS);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = Math.random() * total;
    for (const [key, weight] of entries) {
      if (roll < weight) return key;
      roll -= weight;
    }
    return entries[entries.length - 1][0];
  }

  function fillRemainingByDistance(map, anchorIndices) {
    POSITIONS.forEach((pos, index) => {
      if (map[pos] !== undefined) return;
      const distance = Math.min(...anchorIndices.map((anchorIndex) => Math.abs(index - anchorIndex)));
      const base = distance === 1 ? ADJACENT_LEVEL_BASE : DISTANT_LEVEL_BASE;
      const spread = distance === 1 ? ADJACENT_LEVEL_SPREAD : DISTANT_LEVEL_SPREAD;
      map[pos] = clamp(Math.round(base + randomNoise(spread)), ATTRIBUTE_MIN, ATTRIBUTE_MAX - 1);
    });
  }

  // Fisher-Yates simple, usado solo para barajar índices de posición al
  // elegir el arquetipo positionless (no necesita ser criptográfico).
  function shuffleIndices(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Devuelve `{ map, nominalPosition }` (DESIGN.md 6.1, mini-EPIC POS): el
  // mapa de 5 posiciones y la posición nominal decidida (ancla), que
  // `generateFictionalPlayer` pasa tal cual al `Player` que construye.
  function generatePositionMap(forcedPrimary) {
    const nominalPosition = forcedPrimary || randomFrom(POSITIONS);
    const primaryIndex = POSITIONS.indexOf(nominalPosition);
    const archetype = pickPositionArchetype();
    const map = {};

    if (archetype === 'combo') {
      // Combo/polivalente moderado: la ancla + una vecina ADYACENTE en el
      // array POSITIONS, ambas en 20 — el resto por distancia a la más
      // cercana de las dos.
      const neighborIndices = [primaryIndex - 1, primaryIndex + 1]
        .filter((index) => index >= 0 && index < POSITIONS.length);
      const comboIndex = randomFrom(neighborIndices);
      map[nominalPosition] = ATTRIBUTE_MAX;
      map[POSITIONS[comboIndex]] = ATTRIBUTE_MAX;
      fillRemainingByDistance(map, [primaryIndex, comboIndex]);
    } else if (archetype === 'positionless') {
      // Polivalente amplio/positionless (raro): 3 o 4 posiciones en total
      // (incluida la ancla) en niveles altos 17-20, no necesariamente todas
      // exactamente 20 — el resto por distancia a la más cercana de ellas.
      const otherIndices = shuffleIndices(
        POSITIONS.map((_, index) => index).filter((index) => index !== primaryIndex),
      );
      const extraCount = 2 + Math.floor(Math.random() * 2); // 2 o 3 extra -> 3 o 4 posiciones altas en total
      const highIndices = [primaryIndex, ...otherIndices.slice(0, extraCount)];
      map[nominalPosition] = ATTRIBUTE_MAX;
      highIndices.slice(1).forEach((index) => {
        map[POSITIONS[index]] = clamp(Math.round(17 + Math.random() * 3), 17, ATTRIBUTE_MAX);
      });
      fillRemainingByDistance(map, highIndices);
    } else {
      // Especialista (mayoritario): comportamiento ya existente, una sola
      // posición en 20.
      map[nominalPosition] = ATTRIBUTE_MAX;
      fillRemainingByDistance(map, [primaryIndex]);
    }

    return { map, nominalPosition };
  }

  // Promedia los deltas de perfil de las 5 posiciones, PONDERADO por el
  // nivel de cada una en el mapa de posiciones (en vez de una lista plana de
  // 1-2 posiciones "activas") — un jugador Base(20)/Escolta(14) pesa sobre
  // todo como Base, pero con influencia real de Escolta, igual con el resto
  // de posiciones de nivel bajo (su peso residual es pequeño, no nulo).
  function blendProfiles(positionMap) {
    const blended = { technical: {}, physical: {}, mental: {} };
    const totalWeight = POSITIONS.reduce((sum, pos) => sum + positionMap[pos], 0);
    ['technical', 'physical', 'mental'].forEach((group) => {
      const keys = new Set();
      POSITIONS.forEach((pos) => Object.keys(POSITION_PROFILES[pos][group]).forEach((k) => keys.add(k)));
      keys.forEach((key) => {
        const total = POSITIONS.reduce(
          (sum, pos) => sum + (POSITION_PROFILES[pos][group][key] || 0) * positionMap[pos], 0,
        );
        blended[group][key] = total / totalWeight;
      });
    });
    return blended;
  }

  // Promedia el rango [min, max] de la dimensión (height/weight) de las 5
  // posiciones, ponderado igual que blendProfiles() por el nivel de cada
  // posición en el mapa.
  function blendBodyRange(positionMap, dimension) {
    const totalWeight = POSITIONS.reduce((sum, pos) => sum + positionMap[pos], 0);
    const weightedSum = (bound) => POSITIONS.reduce(
      (sum, pos) => sum + POSITION_BODY_PROFILES[pos][dimension][bound] * positionMap[pos], 0,
    );
    return [weightedSum(0) / totalWeight, weightedSum(1) / totalWeight];
  }

  // Datos Físicos Corporales (DESIGN.md 6.1) — reales, no en escala 1-20.
  function randomBodyMeasurements(positionMap) {
    const [heightMin, heightMax] = blendBodyRange(positionMap, 'height');
    const height = Math.round(heightMin + Math.random() * (heightMax - heightMin));

    const [weightMin, weightMax] = blendBodyRange(positionMap, 'weight');
    const weight = Math.round(weightMin + Math.random() * (weightMax - weightMin));

    // Envergadura: no hay fórmula validada con Dennis todavía — aproximación
    // de diseño propia, no un dato acordado. Se genera como la altura más
    // una variación aleatoria en el rango [-3, +15] cm, con más recorrido
    // hacia el lado positivo que hacia el negativo, para que la envergadura
    // supere a la altura la mayoría de las veces (como ocurre en la
    // realidad) sin impedir el caso contrario, menos frecuente.
    const wingspanDelta = -3 + Math.random() * 18;
    const wingspan = Math.round(height + wingspanDelta);

    return { height, weight, wingspan };
  }

  // Modelo B de envergadura relativa (DESIGN.md 7.4, mini-EPIC POS): SOLO
  // en generación, nunca en tiempo de partido. Envergadura relativa alta
  // (wingspan-height por encima de config.positions.wingspanBiasThresholdCm)
  // sesga levemente y de forma NO determinista la distribución de partida:
  // a la baja en outsideShot, al alza en interiorDefense/blocking/rebote —
  // nunca una resta/suma fija, y nunca impide que un jugador de brazos
  // largos siga generándose con outsideShot=20 (el sesgo es aleatorio 0-2,
  // puede salir ~0). `bodyMeasurements` ausente (grupos Físico/Mental, que
  // no tienen estas claves) desactiva el sesgo sin más.
  const WINGSPAN_BIAS_MAX = 2;
  const WINGSPAN_BENEFIT_ATTRIBUTES = ['interiorDefense', 'blocking', 'offensiveRebound', 'defensiveRebound'];

  function wingspanBias(bodyMeasurements) {
    if (!bodyMeasurements) return null;
    const threshold = getPositionsConfig().wingspanBiasThresholdCm;
    const relativeWingspan = bodyMeasurements.wingspan - bodyMeasurements.height;
    if (relativeWingspan <= threshold) return null;
    return { penalty: Math.random() * WINGSPAN_BIAS_MAX, bonus: Math.random() * WINGSPAN_BIAS_MAX };
  }

  function generateAttributeGroup(keys, blendedDeltas, bodyMeasurements) {
    const bias = wingspanBias(bodyMeasurements);
    const group = {};
    keys.forEach((key) => {
      const delta = blendedDeltas[key] || 0;
      let value = ATTRIBUTE_BASE + delta + randomNoise(NOISE_SPREAD);
      if (bias && key === 'outsideShot') value -= bias.penalty;
      else if (bias && WINGSPAN_BENEFIT_ATTRIBUTES.includes(key)) value += bias.bonus;
      group[key] = value;
    });
    return group;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Herramienta de prueba de estrés del motor (no una regla de diseño):
  // genera el mismo perfil relativo por posición que generateAttributeGroup,
  // pero comprimido dentro de `range` ({min,max} en escala 1-20) en vez del
  // rango habitual (ATTRIBUTE_BASE ± ruido) — para equipos "sesgados" (ej.
  // un "súper equipo" 16-20, uno "flojo" 3-8). Los deltas de posición se
  // escalan proporcionalmente al ancho de `range` para que un rango
  // estrecho no empuje los valores fuera de él (un Pívot "súper" sigue
  // reboteando relativamente mejor que un Base "súper", solo que ambos
  // quedan comprimidos dentro del mismo rango estrecho).
  function generateSkewedAttributeGroup(keys, blendedDeltas, range, bodyMeasurements) {
    const base = (range.min + range.max) / 2;
    const width = range.max - range.min;
    const fullScaleWidth = ATTRIBUTE_MAX - ATTRIBUTE_MIN;
    const deltaScale = width / fullScaleWidth;
    const noiseSpread = Math.max(0.5, width * 0.18);
    // Sesgo de envergadura (ver wingspanBias arriba) escalado igual que el
    // resto de deltas de posición, para que un rango estrecho no lo empuje
    // fuera de proporción.
    const bias = wingspanBias(bodyMeasurements);
    const group = {};
    keys.forEach((key) => {
      const delta = (blendedDeltas[key] || 0) * deltaScale;
      let raw = base + delta + randomNoise(noiseSpread);
      if (bias && key === 'outsideShot') raw -= bias.penalty * deltaScale;
      else if (bias && WINGSPAN_BENEFIT_ATTRIBUTES.includes(key)) raw += bias.bonus * deltaScale;
      group[key] = clamp(Math.round(raw), range.min, range.max);
    });
    return group;
  }

  // Potencial/Profesionalidad/Ambición no dependen de la posición ni (por
  // ahora) de la edad — correlacionarlos con la edad excedería el alcance
  // de LIFE-1 (DESIGN.md 9: "no correlacionarlos automáticamente con PA").
  // learningRate/learningPersistence NO se generan aquí (a diferencia de
  // potential/professionalism/ambition): quedan en `null` hasta que
  // PlayerDevelopment.ensureDevelopmentState() los genera de forma
  // determinista a partir del `developmentSeed` del jugador (sección 6) —
  // ver generateFictionalPlayer() más abajo, que llama a esa función justo
  // después de construir el Player.
  function randomHiddenAttributes() {
    return {
      // Ya en escala 1-200 (LIFE-1) — ver POTENTIAL_NOISE_SPREAD arriba.
      potential: clamp(Math.round((ATTRIBUTE_BASE + randomNoise(POTENTIAL_NOISE_SPREAD)) * 10), 10, 200),
      professionalism: ATTRIBUTE_BASE + randomNoise(HIDDEN_NOISE_SPREAD),
      ambition: ATTRIBUTE_BASE + randomNoise(HIDDEN_NOISE_SPREAD),
      learningRate: null,
      learningPersistence: null,
    };
  }

  function randomTraits() {
    const count = Math.floor(Math.random() * 3); // 0, 1 o 2 rasgos
    const pool = [...TRAITS];
    const selected = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const index = Math.floor(Math.random() * pool.length);
      selected.push(pool.splice(index, 1)[0]);
    }
    return selected;
  }

  // Placeholder para que los jugadores de prueba tengan veteranía razonable.
  // La fórmula real (partidos jugados, peso extra por playoffs/Copa/Europa,
  // ver DESIGN.md 6.1 "Experiencia") llegará con el motor de calendario.
  function estimateStartingExperience(age) {
    const yearsAsPro = Math.max(0, age - 18);
    const avgGamesPerYear = 30;
    return Math.round(yearsAsPro * avgGamesPerYear * (0.5 + Math.random() * 0.5));
  }

  // `options.minAge`/`options.maxAge` permiten generar perfiles de edad
  // distintos (ej. jóvenes de cantera, ver Equipo.generateAcademyIntake());
  // por defecto genera jugadores de plantilla habituales (18-36 años).
  // `options.attributeRange` ({min,max} en escala 1-20) es una herramienta
  // de prueba de estrés del motor: si se indica, los atributos Técnicos/
  // Físicos/Mentales se generan comprimidos dentro de ese rango (ver
  // generateSkewedAttributeGroup) en vez del rango habitual. Los atributos
  // ocultos (potencial/profesionalidad/ambición) NO se ven afectados por
  // `attributeRange` — no forman parte de "Técnicos/Físicos/Mentales".
  // `options.primaryPosition` fuerza la posición PRINCIPAL del jugador (nivel
  // 20) en vez de sortearla al azar — usado por el script de importación de
  // datos reales (scripts/import-real-data.js) para completar de forma
  // dirigida las posiciones que le falten a una plantilla incompleta.
  function generateFictionalPlayer(options = {}) {
    const minAge = options.minAge !== undefined ? options.minAge : 18;
    const maxAge = options.maxAge !== undefined ? options.maxAge : 36;
    const { attributeRange } = options;
    const { map: positions, nominalPosition } = generatePositionMap(options.primaryPosition);
    const { firstName, lastName } = generateFictionalName();
    const birthDate = randomBirthDate(minAge, maxAge);
    const age = Core.calculateAge(birthDate);
    const blended = blendProfiles(positions);
    // Envergadura relativa (Modelo B, 7.4) calculada ANTES que los atributos
    // Técnicos para poder sesgar outsideShot/interiorDefense/blocking/
    // rebote en su generación — ver wingspanBias().
    const bodyMeasurements = randomBodyMeasurements(positions);

    const technical = attributeRange
      ? generateSkewedAttributeGroup(TECHNICAL_ATTRIBUTES, blended.technical, attributeRange, bodyMeasurements)
      : generateAttributeGroup(TECHNICAL_ATTRIBUTES, blended.technical, bodyMeasurements);
    const physical = attributeRange
      ? generateSkewedAttributeGroup(PHYSICAL_ATTRIBUTES, blended.physical, attributeRange)
      : generateAttributeGroup(PHYSICAL_ATTRIBUTES, blended.physical);
    const mental = attributeRange
      ? generateSkewedAttributeGroup(MENTAL_ATTRIBUTES, blended.mental, attributeRange)
      : generateAttributeGroup(MENTAL_ATTRIBUTES, blended.mental);

    const player = new Player({
      firstName,
      lastName,
      birthDate,
      positions,
      nominalPosition,
      bodyMeasurements,
      technical,
      physical,
      mental,
      traits: randomTraits(),
      hidden: randomHiddenAttributes(),
      experience: estimateStartingExperience(age),
    });

    // LIFE-1 (DESIGN.md 9, sección 25): inicializa developmentState
    // completo del jugador nuevo (seed, agingOffsetYears, residuales,
    // matchExposures vacío, lastProcessedDate = fecha de creación) y
    // genera learningRate/learningPersistence — reutiliza EXACTAMENTE la
    // misma función que migra/inicializa jugadores reales legacy (sección
    // 26), no se duplica la lógica aquí. `options.referenceDate` permite a
    // Team.generateAcademyIntake() pasar la fecha real de la partida en
    // curso en vez de "ahora" (reloj real de la máquina).
    const config = MatchConfigCore ? MatchConfigCore.CONFIG_BASE : global.BasketManager.CONFIG_BASE;
    getPlayerDevelopment().ensureDevelopmentState(player, config, options.referenceDate || new Date());

    return player;
  }

  function generateFictionalPlayers(count, options) {
    const players = [];
    for (let i = 0; i < count; i++) {
      players.push(generateFictionalPlayer(options));
    }
    return players;
  }

  const exportsObj = { generateFictionalPlayer, generateFictionalPlayers, POSITION_PROFILES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
