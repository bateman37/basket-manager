// src/utils/playerGenerator.js
// Generador de jugadores ficticios de prueba (data/fictional/), para poder
// probar el motor mientras se construye la base de datos real (DESIGN.md,
// sección 6). Los perfiles por posición de este archivo son una heurística
// de prueba, no una regla de diseño acordada en DESIGN.md.

(function (global) {
  const Core = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;

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

  const ATTRIBUTE_BASE = 10; // valor medio de partida antes de aplicar el perfil de posición
  const NOISE_SPREAD = 2.5; // variación aleatoria +/- sobre el valor del perfil
  const HIDDEN_NOISE_SPREAD = 6; // potencial/profesionalidad/ambición varían más (no dependen de posición)

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

  // Genera el mapa de 5 posiciones (DESIGN.md 6.1 actualizado): una
  // principal (nivel 20, `forcedPrimary` si se indica, si no al azar) y las
  // 4 restantes con un nivel que depende de la DISTANCIA a la principal
  // (Base=0, Escolta=1, Alero=2, Ala-pívot=3, Pívot=4 — índice del array
  // POSITIONS): adyacente (distancia 1) = competencia media con variación,
  // el resto = competencia baja. Heurística propia de este generador de
  // prueba, NO una regla de diseño acordada (DESIGN.md 6.1 solo exige que
  // las 5 claves existan siempre con nivel 1-20 y una única principal).
  const ADJACENT_LEVEL_BASE = 10;
  const ADJACENT_LEVEL_SPREAD = 6;
  const DISTANT_LEVEL_BASE = 3;
  const DISTANT_LEVEL_SPREAD = 2;

  function generatePositionMap(forcedPrimary) {
    const primaryIndex = forcedPrimary ? POSITIONS.indexOf(forcedPrimary) : Math.floor(Math.random() * POSITIONS.length);
    const map = {};
    POSITIONS.forEach((pos, index) => {
      if (index === primaryIndex) {
        map[pos] = ATTRIBUTE_MAX;
        return;
      }
      const distance = Math.abs(index - primaryIndex);
      const base = distance === 1 ? ADJACENT_LEVEL_BASE : DISTANT_LEVEL_BASE;
      const spread = distance === 1 ? ADJACENT_LEVEL_SPREAD : DISTANT_LEVEL_SPREAD;
      map[pos] = clamp(Math.round(base + randomNoise(spread)), ATTRIBUTE_MIN, ATTRIBUTE_MAX - 1);
    });
    return map;
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

  function generateAttributeGroup(keys, blendedDeltas) {
    const group = {};
    keys.forEach((key) => {
      const delta = blendedDeltas[key] || 0;
      group[key] = ATTRIBUTE_BASE + delta + randomNoise(NOISE_SPREAD);
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
  function generateSkewedAttributeGroup(keys, blendedDeltas, range) {
    const base = (range.min + range.max) / 2;
    const width = range.max - range.min;
    const fullScaleWidth = ATTRIBUTE_MAX - ATTRIBUTE_MIN;
    const deltaScale = width / fullScaleWidth;
    const noiseSpread = Math.max(0.5, width * 0.18);
    const group = {};
    keys.forEach((key) => {
      const delta = (blendedDeltas[key] || 0) * deltaScale;
      const raw = base + delta + randomNoise(noiseSpread);
      group[key] = clamp(Math.round(raw), range.min, range.max);
    });
    return group;
  }

  // Potencial/Profesionalidad/Ambición no dependen de la posición ni (por
  // ahora) de la edad — correlacionarlos con la edad es una decisión del
  // módulo de progresión, todavía pendiente (DESIGN.md sección 9).
  function randomHiddenAttributes() {
    return {
      potential: ATTRIBUTE_BASE + randomNoise(HIDDEN_NOISE_SPREAD),
      professionalism: ATTRIBUTE_BASE + randomNoise(HIDDEN_NOISE_SPREAD),
      ambition: ATTRIBUTE_BASE + randomNoise(HIDDEN_NOISE_SPREAD),
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
    const positions = generatePositionMap(options.primaryPosition);
    const { firstName, lastName } = generateFictionalName();
    const birthDate = randomBirthDate(minAge, maxAge);
    const age = Core.calculateAge(birthDate);
    const blended = blendProfiles(positions);

    const technical = attributeRange
      ? generateSkewedAttributeGroup(TECHNICAL_ATTRIBUTES, blended.technical, attributeRange)
      : generateAttributeGroup(TECHNICAL_ATTRIBUTES, blended.technical);
    const physical = attributeRange
      ? generateSkewedAttributeGroup(PHYSICAL_ATTRIBUTES, blended.physical, attributeRange)
      : generateAttributeGroup(PHYSICAL_ATTRIBUTES, blended.physical);
    const mental = attributeRange
      ? generateSkewedAttributeGroup(MENTAL_ATTRIBUTES, blended.mental, attributeRange)
      : generateAttributeGroup(MENTAL_ATTRIBUTES, blended.mental);

    return new Player({
      firstName,
      lastName,
      birthDate,
      positions,
      bodyMeasurements: randomBodyMeasurements(positions),
      technical,
      physical,
      mental,
      traits: randomTraits(),
      hidden: randomHiddenAttributes(),
      experience: estimateStartingExperience(age),
    });
  }

  function generateFictionalPlayers(count, options) {
    const players = [];
    for (let i = 0; i < count; i++) {
      players.push(generateFictionalPlayer(options));
    }
    return players;
  }

  const exportsObj = { generateFictionalPlayer, generateFictionalPlayers };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
