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
        blocking: -4, stealing: 2,
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
      },
      physical: { topSpeed: 1, acceleration: 1, jumping: 2, balance: 1, stamina: 1 },
      mental: { consistency: 1, teamwork: 1 },
    },
    'Ala-pívot': {
      technical: {
        outsideShot: -2, midRangeShot: 1, insideShot: 3, layup: 3,
        ballHandling: -3, passing: -1, offensiveRebound: 4, defensiveRebound: 4,
        blocking: 3, stealing: -2, foulTendency: 1,
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

  // Elige 1 posición principal y, con un 30% de probabilidad, una segunda
  // posición adyacente (ej. Base+Escolta), para reflejar la polivalencia
  // real sin generar combinaciones poco realistas (ej. Base+Pívot).
  function pickPositions() {
    const primaryIndex = Math.floor(Math.random() * POSITIONS.length);
    const positions = [POSITIONS[primaryIndex]];
    if (Math.random() < 0.3) {
      const neighborOffsets = [-1, 1].filter((offset) => POSITIONS[primaryIndex + offset]);
      const offset = randomFrom(neighborOffsets);
      positions.push(POSITIONS[primaryIndex + offset]);
    }
    return positions;
  }

  // Promedia los deltas de perfil de todas las posiciones del jugador.
  function blendProfiles(positions) {
    const blended = { technical: {}, physical: {}, mental: {} };
    ['technical', 'physical', 'mental'].forEach((group) => {
      const keys = new Set();
      positions.forEach((pos) => Object.keys(POSITION_PROFILES[pos][group]).forEach((k) => keys.add(k)));
      keys.forEach((key) => {
        const total = positions.reduce((sum, pos) => sum + (POSITION_PROFILES[pos][group][key] || 0), 0);
        blended[group][key] = total / positions.length;
      });
    });
    return blended;
  }

  // Promedia el rango [min, max] de la dimensión (height/weight) de todas
  // las posiciones del jugador, igual que blendProfiles() hace con los
  // atributos — un jugador Base/Escolta usa un rango intermedio entre ambos.
  function blendBodyRange(positions, dimension) {
    const mins = positions.map((pos) => POSITION_BODY_PROFILES[pos][dimension][0]);
    const maxs = positions.map((pos) => POSITION_BODY_PROFILES[pos][dimension][1]);
    const min = mins.reduce((sum, value) => sum + value, 0) / mins.length;
    const max = maxs.reduce((sum, value) => sum + value, 0) / maxs.length;
    return [min, max];
  }

  // Datos Físicos Corporales (DESIGN.md 6.1) — reales, no en escala 1-20.
  function randomBodyMeasurements(positions) {
    const [heightMin, heightMax] = blendBodyRange(positions, 'height');
    const height = Math.round(heightMin + Math.random() * (heightMax - heightMin));

    const [weightMin, weightMax] = blendBodyRange(positions, 'weight');
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
  function generateFictionalPlayer(options = {}) {
    const minAge = options.minAge !== undefined ? options.minAge : 18;
    const maxAge = options.maxAge !== undefined ? options.maxAge : 36;
    const positions = pickPositions();
    const { firstName, lastName } = generateFictionalName();
    const birthDate = randomBirthDate(minAge, maxAge);
    const age = Core.calculateAge(birthDate);
    const blended = blendProfiles(positions);

    return new Player({
      firstName,
      lastName,
      birthDate,
      positions,
      bodyMeasurements: randomBodyMeasurements(positions),
      technical: generateAttributeGroup(TECHNICAL_ATTRIBUTES, blended.technical),
      physical: generateAttributeGroup(PHYSICAL_ATTRIBUTES, blended.physical),
      mental: generateAttributeGroup(MENTAL_ATTRIBUTES, blended.mental),
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
