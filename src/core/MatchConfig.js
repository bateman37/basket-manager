// src/core/MatchConfig.js
// CONFIG del motor de simulación de partidos — ver DESIGN.md sección 7,
// especialmente 7.2 ("el CONFIG es una entidad propia, no una lista suelta
// de constantes"), 7.3/7.3-bis (estructura de las fórmulas) y 7.6 (catálogo
// de acciones). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// FASE 1: Bloque A (10 acciones base) y Bloque B (3 caminos de reglamento).
// FASE 2 (esta entrega): añade el modificador de Altura/Envergadura/Peso
// (7.4, flags `heightAxis1`/`heightAxis2` en cada acción), Presión de
// Momento (7.5, sección `pressure`), Consistencia/Fatiga (7.5-bis,
// secciones `consistency`/`fatigue`), y los parámetros del Bloque C (7.6):
// contraataque, ritmo de posesión (ligado a ADN de Club), últimos segundos,
// parcial de anotación y falta técnica. NO incluye el sistema de selección
// de eventos destacados/notabilidad (7.7 — eso es Fase 3), factor cancha
// (7.8), ni la mecánica completa de Racha (7.9, más allá de que el campo ya
// existe en Player.js y aquí se usa de forma simplificada, ver `scoringRun`).
//
// Cada acción define: `method` ('subtract' | 'ratio' | 'direct'),
// `intercept`/`sensitivity` (solo tiros), y dos mezclas de atributos,
// `primary`/`secondary` (pesos que suman 1). Se llaman `primary`/`secondary`
// y NO `offense`/`defense` a propósito: DESIGN.md 7.6 rotula cada mezcla
// como "ofensiva"/"defensiva" siguiendo el protagonismo DENTRO de esa
// acción concreta (ej. en Robo, la "ofensiva" es el defensor que intenta
// robar) y no siempre coincide con qué equipo tiene la posesión — cada
// entrada de acción aclara en su comentario a qué jugador corresponde cada
// lado. Los pesos y sensibilidades numéricas son un punto de partida propio
// para poder simular ya (DESIGN.md 7.6 dice explícitamente que los pesos
// finales están pendientes de calibración tras pruebas masivas) — no son
// cifras validadas con Dennis, solo la ESTRUCTURA (qué atributos, en qué
// lado, con qué método) sí sigue 7.6 al pie de la letra.
//
// `heightAxis1`/`heightAxis2` (7.4) por acción: objeto `{ primary: modo,
// secondary: modo }` (solo se listan los lados a los que aplica). Eje 1
// ('benefit'|'penalize'): modificador por envergadura relativa propia
// (wingspan-height), acotado, sumado o restado al rating de ESE lado — ver
// MatchEngine.applyHeightAxisModifiers(). Eje 2 (siempre resta, sin
// variante): "impuesto físico" para jugadores muy altos. DESIGN.md 7.4 dice
// que el Eje 2 afecta a Defensa perimetral y a la Pérdida de balón vista
// desde el atacante alto — como ninguna mezcla usa un atributo suelto de
// Agilidad/Velocidad (no existe ese atributo en las mezclas de 7.6, solo
// existe como concepto), aquí se implementa como una resta directa sobre el
// RATING del lado marcado (no sobre un atributo concreto dentro de la
// mezcla) — ver nota extendida en MatchEngine.js.

(function (global) {
  // Escala de atributos 1-20 (ver Player.js) — valor "neutro"/liga-media
  // usado como referencia en las fórmulas de intercepto directo (tiro libre).
  const NEUTRAL_ATTRIBUTE = 10.5;

  const CONFIG_BASE = {
    // --- 7.1: arquitectura del bucle ---
    match: {
      durationMinutes: 40, // FIBA/ACB (parámetro de CONFIG, ver 7.1 y 7.2)
      quarters: 4,
      overtimeMinutes: 5, // DESIGN.md 7.10: prórroga de 5 minutos, tantas como hagan falta
      shotClockSeconds: 24, // reloj de posesión FIBA
      offensiveReboundShotClockSeconds: 14, // reset tras rebote ofensivo
      // Umbral de "bonus" (tiros libres por cualquier falta defensiva fuera
      // de tiro) — regla FIBA/ACB: 5ª falta de equipo en el cuarto/prórroga.
      teamFoulBonusThreshold: 5,
    },

    // --- 7.3-bis: interceptos base por tipo de tiro ---
    shotIntercepts: {
      insideShot: 0.58,
      layup: 0.58, // provisional: comparte intercepto con insideShot (ver 7.3-bis)
      midRangeShot: 0.39,
      outsideShot: 0.36,
      freeThrows: 0.76,
    },

    neutralAttribute: NEUTRAL_ATTRIBUTE,

    // --- 7.4: Modificador de Altura/Envergadura/Peso ---
    // Umbral y magnitudes: DESIGN.md solo ancla el umbral del Eje 2
    // (~2.05-2.10m); el resto de números (magnitud del bono/impuesto) son
    // una propuesta propia de calibración, no validada.
    heightModifiers: {
      axis2ThresholdCm: 207, // punto medio del rango 2.05-2.10m dado por DESIGN.md
      axis2TaxPerCm: 0.2, // puntos de rating restados por cada cm por encima del umbral
      axis2MaxTax: 3, // tope del "impuesto físico" — nunca anula al jugador
      axis1BonusPerCm: 0.25, // puntos de rating por cada cm de envergadura relativa (wingspan-height)
      axis1MaxBonus: 4, // tope del bono/malus de envergadura relativa
    },

    // --- 7.5: Presión de Momento ---
    pressure: {
      // presión = f(tiempo_restante, diferencia_marcador) — ver
      // MatchEngine.computePressure() para la fórmula exacta elegida
      // (multiplicación de dos factores 0-1, ninguno de los dos viene dado
      // por DESIGN.md con una cifra concreta).
      timeHorizonSeconds: 300, // últimos 5 min de PARTIDO empiezan a construir presión
      scoreHorizonPoints: 15, // diferencias de 15+ puntos se sienten "resueltas" (presión ~0)
      // Reponderación de mentales relevantes dentro de la mezcla (solo los
      // que de verdad aparecen como peso en alguna acción de 7.6: ver
      // MatchEngine.PRESSURE_MENTALS — Temperamento y Consistencia no
      // aparecen como peso en ninguna mezcla, así que no se reponderan
      // aquí; Consistencia ya tiene su propio mecanismo en `consistency`).
      mentalWeightBoost: 1.2, // multiplicador de peso extra para mentales de presión, escalado por `pressure`
      technicalWeightPenalty: 0.4, // reducción de peso para el resto de atributos, escalado por `pressure`
      experienceBonusDivisor: 150, // bonus = min(maxExperienceBonus, experience/divisor * pressure)
      maxExperienceBonus: 2.5, // tope del bonus (DESIGN.md: orden de magnitud +2/+3)
      shotClockBuzzerSeconds: 3, // 7.6.16: <3s de los 24 = presión local +
      buzzerBeaterSecondsThreshold: 5, // 7.6.17: últimos N s de cuarto/partido = presión al máximo
      forcedShotPenalty: 0.04, // resta de probabilidad por "tiro forzado" (16/17/19)
    },

    // --- 7.5-bis: Consistencia (ruido transversal) ---
    consistency: {
      // sigma = maxSigma * (1 - (consistency-1)/19) — consistency=20 -> sigma=0; consistency=1 -> sigma=maxSigma.
      maxSigma: 0.08,
    },

    // --- 7.5-bis: Fatiga ---
    fatigue: {
      // Calibrado por simulación: un titular puede ser seleccionado en pista
      // 100-150 veces por partido (no hay rotaciones reales todavía, ver
      // MatchEngine.selectOnCourtFive) — con 1.2 llegaban a 0 de energía
      // bastante antes del final, así que se bajó a un consumo que deje a
      // un titular de Resistencia media alrededor de 40-60% al acabar.
      baseEnergyPerPossession: 0.4,
      lightImpactMax: 1.5, // puntos restados como máximo (a 0 energía) en atributos de tiro
      heavyImpactMax: 4, // puntos restados como máximo en atributos físicos/defensivos puros
      foulTendencyBonusMax: 2, // TendenciaAFalta efectiva sube hasta esto a 0 energía
    },

    // --- 7.6 Bloque C: parámetros de las acciones especiales ---
    fastBreak: {
      windowSeconds: 3, // 7.6.14: primeros 3s de la posesión nueva
      maxBonus: 0.12, // bono máximo de probabilidad en Bandeja, a Aceleración=20
      // Calibrado por simulación: con 0.35 (primera versión), sumado a
      // pérdidas y tapones, más del 40% de las posesiones quedaban
      // "elegibles" para contraataque, cuyo paso de reloj más corto
      // aceleraba el ritmo global del partido muy por encima de lo
      // realista (los rebotes defensivos son el suceso más común de una
      // posesión, así que su probabilidad de "largo" pesa mucho en el
      // total). Bajado para que la elegibilidad total ronde el 20-25% de
      // las posesiones.
      longReboundProbability: 0.12,
    },

    // 7.6.18: Ritmo de posesión ligado a ADN de Club (6.2.8). DESIGN.md dice
    // explícitamente que el ADN de Club no tiene todavía un mapeo numérico
    // definido a este comportamiento — este mapeo es una propuesta propia
    // de calibración, no una regla acordada. Escala aprox. -1 (muy pausado)
    // a +1 (muy rápido); los ADN no listados usan `defaultBias`.
    // `stepMinSeconds`/`stepBaseMaxSeconds`: rango del "paso" de posesión
    // normal antes de aplicar ritmo/visión (ver MatchEngine.
    // pickPossessionStepSeconds) — DESIGN.md 7.1 (corregida): la duración
    // media real de una posesión debe rondar ~14-15s, calculada dividiendo
    // los 2400s del partido entre el total de posesiones de AMBOS equipos
    // combinados (~165), no solo las de un equipo. Calibrado por
    // simulación para que el nº de posesiones por equipo y partido ronde
    // las 82-83 reales (ver CHANGELOG para las cifras finales verificadas).
    tempo: {
      stepMinSeconds: 8,
      stepBaseMaxSeconds: 26,
      stepReductionFactor: 0.25,
      dnaBias: {
        'Ritmo alto': 0.7,
        'Defensa': -0.3,
        'Veteranía': -0.2,
        'Cantera': 0.1,
      },
      defaultBias: 0,
    },

    // 7.6.19: últimos segundos sin tiempo de jugada completa.
    lateClock: {
      noFullPlayThresholdSeconds: 8,
    },

    // 7.6.20: Parcial de anotación — ventana deslizante simplificada (no es
    // el sistema completo de 7.7/7.9, ver nota en MatchEngine).
    scoringRun: {
      threshold: 8, // puntos consecutivos sin respuesta del rival para considerarlo "parcial"
      probabilityEffect: 0.02, // bono/malus de probabilidad de tiro mientras el parcial esté activo
    },

    // 7.6.21: Falta técnica/antideportiva. Solo la probabilidad de que
    // ocurra — NO el escalado a expulsión (pendiente, ver DESIGN.md).
    // Umbral calibrado por simulación: con el ruido del generador actual
    // (±2.5 sobre una base de 10), el mínimo práctico de temperament es ~8,
    // así que un umbral de "< 9" es el que de verdad deja pasar a los
    // jugadores más temperamentales sin dejar de ser una franja baja y poco
    // frecuente (sigue exigiendo presión muy alta a la vez).
    technicalFoul: {
      baseProbability: 0.01,
      temperamentThreshold: 9, // "temperamento muy bajo" en escala 1-20
      pressureThreshold: 0.6, // "presión muy alta"
    },

    // 7.6.15: Tapón con mate — margen del compuesto Tapón (rating del
    // taponador menos el del finalizador) a partir del cual se marca el
    // evento como de alta notabilidad. Cifra propia, no dada por DESIGN.md.
    dunkBlock: {
      ratingMargin: 4,
    },

    // --- 7.6 Bloque A (10) + Bloque B (3) ---
    actions: {
      // 1. Triple — DESIGN.md 7.6.1
      threePointShot: {
        method: 'subtract',
        intercept: 0.36, // shotIntercepts.outsideShot
        sensitivity: 0.018, // puntos de probabilidad por punto de diferencia de rating
        // primary: tirador (equipo en ataque)
        primary: { outsideShot: 0.5, pressureDecisionMaking: 0.25, gameVision: 0.25 },
        // secondary: defensor que le presiona (equipo en defensa)
        secondary: { perimeterDefense: 0.7, anticipation: 0.3 },
        // 7.4: Eje 1 perjudica al tirador (única acción con esta dirección
        // en Bloque A); Eje 2 sobre el defensor (Defensa perimetral).
        heightAxis1: { primary: 'penalize' },
        heightAxis2: { secondary: true },
      },

      // 2. Tiro de media distancia — DESIGN.md 7.6.2
      midRangeShot: {
        method: 'subtract',
        intercept: 0.39,
        sensitivity: 0.018,
        primary: { midRangeShot: 0.5, pressureDecisionMaking: 0.25, gameVision: 0.25 },
        secondary: { perimeterDefense: 0.7, anticipation: 0.3 },
        // 7.6.2 dice explícitamente "sin modificador de Eje 1" (a diferencia
        // del Triple) — pero el Eje 2 sí aplica al defensor, igual que en
        // Triple, porque 7.4 lo describe como un efecto general sobre
        // Defensa perimetral, no restringido a una acción concreta.
        heightAxis2: { secondary: true },
      },

      // 3. Tiro interior — DESIGN.md 7.6.3
      insideShot: {
        method: 'subtract',
        // Calibrado por simulación: 0.58 (intercepto "puro" de 7.3-bis) se
        // quedaba en ~49% real de partido una vez restado el efecto de
        // Tapón (~10% de estos intentos) y Fatiga a lo largo del partido —
        // subido para que el % final de partido ronde el ~58% objetivo.
        intercept: 0.65,
        sensitivity: 0.015,
        primary: { insideShot: 0.5, jumping: 0.25, strength: 0.25 },
        secondary: { interiorDefense: 0.5, blocking: 0.3, positioning: 0.2 },
        // 7.4: Eje 1 beneficia a ambos lados por separado (el neto sale de
        // la resta ya prevista en el método 'subtract').
        heightAxis1: { primary: 'benefit', secondary: 'benefit' },
      },

      // 4. Bandeja/finalización — DESIGN.md 7.6.4
      layup: {
        method: 'subtract',
        // Ídem insideShot: calibrado a 0.65 tras simulación (ver comentario
        // arriba); sigue compartiendo el mismo intercepto "puro" de origen
        // (7.3-bis) que insideShot, solo se recalibran igual.
        intercept: 0.65,
        sensitivity: 0.015,
        primary: { layup: 0.4, acceleration: 0.25, balance: 0.2, aggressiveness: 0.15 },
        secondary: { interiorDefense: 0.4, strength: 0.35, positioning: 0.25 },
        heightAxis1: { primary: 'benefit', secondary: 'benefit' },
      },

      // 5. Tiro libre — DESIGN.md 7.6.5 (sin defensor activo)
      freeThrow: {
        method: 'direct',
        intercept: 0.76,
        sensitivity: 0.02,
        primary: { freeThrows: 0.7, concentration: 0.3 },
        secondary: null,
      },

      // 6. Pérdida de balón — DESIGN.md 7.6.6
      // primary: manejador (ataque), protege el balón.
      // secondary: defensor que presiona/intenta forzar el error (defensa).
      // El resultado de esta acción es "¿hay pérdida?": ratio a favor de
      // `secondary` (más presión defensiva → más pérdidas).
      // `baseProbability`: un cociente crudo a/(a+b) da ~50% con ratings
      // parejos, muy por encima de la tasa real de pérdidas por posesión
      // (~13%) — se usa como ancla de calibración (ver
      // MatchEngine.computeEventProbability): con ratings parejos, la
      // probabilidad final es baseProbability; por encima/debajo de eso
      // escala proporcionalmente con la ventaja de atributos de cada lado.
      // 7.4: "Eje 2 sobre el atacante" (7.6.6) — el manejador alto/pesado
      // pierde agilidad en transición. Como su propia mezcla (ballHandling,
      // gameVision, passing, balance) no tiene un atributo de agilidad que
      // descontar, el impuesto se aplica directamente sobre el RATING de
      // `primary` (ver nota general de heightAxis2 al principio del archivo).
      turnover: {
        method: 'ratio',
        favors: 'secondary', // ver MatchEngine: la probabilidad calculada es la de PÉRDIDA
        baseProbability: 0.13,
        primary: { ballHandling: 0.35, gameVision: 0.25, passing: 0.2, balance: 0.2 },
        secondary: { stealing: 0.45, perimeterDefense: 0.35, aggressiveness: 0.2 },
        heightAxis2: { primary: true },
      },

      // 7. Robo de balón — DESIGN.md 7.6.7
      // Sub-tirada que solo se resuelve SI la acción 6 ya determinó que hay
      // pérdida: decide si se acredita como robo (defensor) o pérdida
      // genérica (sin robo). primary: defensor que intenta robar; secondary:
      // manejador que resiste. Sin `baseProbability`: dado que YA hay
      // pérdida, repartir si fue "robo" o "genérica" sí es razonablemente
      // 50/50 antes de mirar atributos, así que se usa el cociente crudo.
      // 7.4: DESIGN.md 7.6.7 es explícito en que AMBOS ejes se aplican sobre
      // quien intenta robar (`primary`) — Eje 1 (envergadura, alcance) y
      // Eje 2 (altura/peso penaliza reacción), ambos sobre el mismo lado.
      steal: {
        method: 'ratio',
        favors: 'primary', // probabilidad de que se acredite como ROBO
        primary: { stealing: 0.4, anticipation: 0.25, perimeterDefense: 0.2, workRate: 0.15 },
        secondary: { ballHandling: 0.6, gameVision: 0.4 },
        heightAxis1: { primary: 'benefit' },
        heightAxis2: { primary: true },
      },

      // 8. Rebote — DESIGN.md 7.6.8. primary: reboteador ofensivo (ataque);
      // secondary: reboteador defensivo (defensa). Ratio a favor de primary
      // = probabilidad de rebote OFENSIVO. baseProbability ancla la tasa
      // real de rebote ofensivo (~28%), igual que en Pérdida de balón.
      rebound: {
        method: 'ratio',
        favors: 'primary',
        baseProbability: 0.28,
        primary: { offensiveRebound: 0.4, jumping: 0.3, strength: 0.2, workRate: 0.1 },
        secondary: { defensiveRebound: 0.5, jumping: 0.3, positioning: 0.2 },
        heightAxis1: { primary: 'benefit', secondary: 'benefit' },
      },

      // 9. Tapón — DESIGN.md 7.6.9. Solo se tira en intentos de Tiro
      // interior/Bandeja (7.3-bis: solo esos dos comparten intercepto de
      // aro; DESIGN.md solo da mezcla de resistencia para
      // "Bandeja_o_TiroInterior"). primary: taponador (defensa); secondary:
      // finalizador que resiste (ataque) — su atributo de tiro concreto
      // (insideShot o layup, según cuál se esté intentando) lo añade
      // MatchEngine en tiempo de ejecución, ver comentario allí.
      block: {
        method: 'ratio',
        favors: 'primary', // probabilidad de TAPÓN
        baseProbability: 0.1, // tasa aproximada de tapón en tiros cerca del aro
        primary: { blocking: 0.5, jumping: 0.3, anticipation: 0.2 },
        // 'shotAttribute' se sustituye en MatchEngine por insideShot o layup
        // según el tiro que se esté taponando (ver resolveBlock()).
        secondary: { shotAttribute: 0.5, strength: 0.3, pressureDecisionMaking: 0.2 },
        // 7.4: "Eje 1 fuerte sobre el taponador" — solo el lado primary, con
        // un multiplicador extra sobre el bono normal (ver heightAxis1Multiplier).
        heightAxis1: { primary: 'benefit' },
        heightAxis1Multiplier: 1.8,
      },

      // 10. Lucha por balón suelto — DESIGN.md 7.6.10. Simétrica: se aplica
      // sobre los mismos dos jugadores candidatos al rebote (ver
      // MatchEngine), con una mezcla igual en ambos lados.
      looseBall: {
        method: 'ratio',
        favors: 'primary',
        // Sin baseProbability: una vez se da el balón suelto (ver
        // triggerProbability), repartir quién se lo lleva sí es ~50/50
        // antes de mirar atributos, como en Robo — se usa el cociente crudo.
        primary: { strength: 0.4, aggressiveness: 0.35, balance: 0.25 },
        secondary: { strength: 0.4, aggressiveness: 0.35, balance: 0.25 },
        // Probabilidad (por posesión, solo en rebotes) de que la disputa se
        // resuelva como balón suelto en vez de rebote normal — no viene de
        // DESIGN.md (no da una cifra), es una decisión de implementación
        // para poder simular ya, pendiente de calibración.
        triggerProbability: 0.05,
      },

      // --- Bloque B: caminos de reglamento (11-13) ---

      // 11. Falta defensiva (fuera de tiro) — DESIGN.md 7.6.11. Sin mezcla
      // ofensiva (no depende del atacante, solo de la propensión del
      // defensor). Fatiga(defensor) queda fuera de esta fase (7.5-bis no
      // implementado) — TODO: sumarla cuando se aborde esa fase.
      defensiveFoul: {
        method: 'direct',
        // Probabilidad por "turno" dentro de la posesión (ver MatchEngine),
        // escalada por foulTendency del defensor respecto al valor neutro.
        // Calibrado a la baja (primera versión: 0.06) tras comprobar en
        // simulación que generaba muchos más tiros libres de los reales.
        baseProbability: 0.04,
        primary: { foulTendency: 1 },
        secondary: null,
      },

      // 12. Falta en tiro (con sus 3 variantes) — DESIGN.md 7.6.12. primary:
      // defensor (propensión a falta); secondary: atacante que penetra
      // (fuerza/agresividad que provoca contacto). Ratio a favor de primary
      // = probabilidad de que el tiro termine con falta.
      shootingFoul: {
        method: 'ratio',
        favors: 'primary',
        // Calibrado a la baja (primera versión: 0.18) tras comprobar en
        // simulación que generaba muchos más tiros libres de los reales
        // (ACB/FIBA: ~18-22 TL de equipo por partido, no 40+).
        baseProbability: 0.12,
        primary: { foulTendency: 1 },
        secondary: { strength: 0.5, aggressiveness: 0.5 },
      },

      // 13. Violación de reloj de posesión — DESIGN.md 7.6.13. No se tira
      // como una acción independiente: emerge del propio reloj de posesión
      // (ver MatchEngine.pickPossessionStepSeconds()), modulado por la
      // VisiónJuego media del quinteto atacante (a peor visión, más
      // probable agotar el reloj) — sustituye aquí a "Ritmo de posesión"
      // (acción 18 de Bloque C, todavía no implementada).
      shotClockViolation: {
        method: 'emergent', // no se evalúa con una fórmula propia, ver nota arriba
      },
    },
  };

  // Hueco para modificadores multiplicativos por competición (7.2) — NO
  // rellenar todavía. Cuando se aborde NBA (48 min, otro pace, etc.), este
  // objeto llevará los factores multiplicativos sobre CONFIG_BASE, sin
  // reescribirla, siguiendo el patrón de 7.2.
  const CONFIG_MODIFIERS_NBA = {
    // TODO: pendiente de investigación específica de NBA (ver DESIGN.md 7.2
    // y 7.3-bis). No implementar hasta que se aborde esa liga.
  };

  const exportsObj = { CONFIG_BASE, CONFIG_MODIFIERS_NBA, NEUTRAL_ATTRIBUTE };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
