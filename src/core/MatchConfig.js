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

      // --- DESIGN.md 7.12.24 (TAC-5): tiempos muertos, como CONFIG y no
      // como números hardcodeados en la UI. Referencia FIBA/ACB citada
      // literalmente por 7.12.24: 2 en la primera mitad, 3 en la segunda
      // (con restricción en los últimos 2 minutos del 4º cuarto), 1 por
      // prórroga, duración 1 minuto. Si otra competición cambia las
      // reglas, lo hace por CONFIG (7.2), nunca tocando MatchEngine.js.
      timeouts: {
        perHalf: { first: 2, second: 3 },
        perOvertime: 1,
        durationSeconds: 60,
        // 7.12.24: "restricción de los últimos 2 minutos del 4º cuarto" —
        // DESIGN.md no cierra la cifra exacta ("CONFIG/UX a calibrar
        // después"). Interpretación de partida (pendiente de calibración/
        // decisión, 7.12.34): dentro de esa ventana, un equipo no puede
        // consumir más de `maxInLastMinutesOfFourthQuarter` tiempos muertos
        // aunque le queden más de su cupo de segunda mitad.
        lastMinutesThresholdSeconds: 120,
        maxInLastMinutesOfFourthQuarter: 2,
        // 7.12.24: "Auto Timeouts... pedir tiempo muerto si el rival mete
        // un parcial de 8-0" (ejemplo literal del prompt de esta sesión) —
        // coincide a propósito con `scoringRun.threshold` (más abajo, mismo
        // valor) porque es exactamente ese parcial ya trackeado por el
        // motor (Tactics/MatchEngine no reimplementan un segundo contador
        // de racha); se deja como cifra propia en vez de referenciar
        // directamente `scoringRun.threshold` para poder calibrarlos por
        // separado en el futuro sin acoplar ambos sistemas.
        autoTriggerRunPoints: 8,
      },
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
      // Tope del factor_resistencia de la fórmula estructural de 7.11.4
      // (`pérdida = [general+intervención] × (1 − factor_resistencia)`) —
      // acotado por debajo de 1 para que el desgaste NUNCA llegue a cero,
      // ni con Resistencia=20. Pendiente de calibración.
      resistanceFactorMax: 0.6,

      // --- DESIGN.md 7.11.4 (Bloque C.4): amplía el desgaste con dos
      // componentes nuevos, ambos SOLO activos cuando hay una alineación
      // real (Rotation.js) que sabe qué posición ocupa cada jugador EN ESA
      // JUGADA — sin alineación (equipos IA sin lineup todavía, ver
      // MatchEngine) se mantiene el desgaste plano de arriba tal cual.
      // Multiplicador de desgaste GENERAL según la posición ocupada en pista
      // (no la principal fija del jugador): más exterior desgasta más.
      // Cifras de partida, pendientes de calibración por playtesting.
      positionWearMultiplier: {
        Base: 1.3,
        Escolta: 1.2,
        Alero: 1.0,
        'Ala-pívot': 0.85,
        Pívot: 0.7,
      },
      // Desgaste por INTERVENCIÓN (componente menor): multiplicador extra
      // aplicado SOLO a quien es atributo directo en la acción resuelta esa
      // posesión (catálogo 7.6) — ej. el tirador, el defensor del tiro, el
      // taponador, los dos reboteadores. Pendiente de calibración.
      interventionWearMultiplier: 0.6,
    },

    // --- DESIGN.md 7.11.3 (Bloque C.3): Polivalencia de emergencia ---
    emergencyVersatility: {
      // Penalización BASE de rendimiento según la distancia posicional
      // (índice 0-4: Base=0 ... Pívot=4, ver Player.POSITIONS) entre la
      // posición que hay que cubrir y la posición asignada del jugador que
      // la cubre de emergencia. Expresada en puntos de rating (escala 1-20,
      // mismo orden de magnitud que los modificadores de heightAxis) — se
      // multiplica por (1 - nivel/20) en MatchEngine. Valores de partida,
      // pendientes de calibración; distancia 0 no debería darse nunca (si la
      // posición coincide, no hace falta polivalencia de emergencia).
      basePenaltyByDistance: [0, 1.5, 3, 4.5, 6],
      // Peso de la distancia en la selección de candidato (ver
      // Rotation.chooseEmergencyCandidate): score = nivel - distancia * este
      // valor. Pendiente de calibración — solo fija que la distancia importe
      // de forma comparable al nivel (escala 1-20).
      selectionDistanceWeight: 3,
    },

    // --- DESIGN.md 7.11.2 (Bloque C.2): rotación automática ---
    rotation: {
      // Margen (segundos) de desviación sobre el ritmo esperado de cuota
      // antes de que el reparto automático considere que alguien está "por
      // encima"/"por debajo" y merece sustitución. Pendiente de calibración.
      paceToleranceSeconds: 60,
    },

    // --- DESIGN.md 7.11.2-bis: "Minutos de la basura" ---
    // Márgenes de puntos que activan/desactivan el modo para cada equipo
    // (ver Rotation.updateGarbageTimeState) — antes vivían como números
    // sueltos en el código, ahora aquí como el resto de parámetros del
    // motor (7.2).
    garbageTime: {
      marginToEnter: 20, // el equipo que gana lo activa a partir de esta ventaja
      marginToExit: 10, // se desactiva al bajar a esta diferencia (o menos)
    },

    // --- DESIGN.md 7.11.5 (Bloque C.5): recuperación de Energía entre
    // partidos — curva de decaimiento exponencial inverso sobre el hueco de
    // energía restante (100 - energía actual): más rápida el primer día,
    // progresivamente más lenta. Valores de partida, pendientes de
    // calibración por playtesting real de calendario.
    recovery: {
      // hueco_tras(d días) = hueco_inicial * exp(-baseDecayPerDay * velocidad * d)
      baseDecayPerDay: 0.35,
      // Recuperación (1-20) actúa como MULTIPLICADOR de velocidad (mismo
      // punto final, se llega antes) — referenciado contra el valor neutro
      // de la escala 1-20 (ver NEUTRAL_ATTRIBUTE), no como curva de forma
      // distinta.
      recoveryAttributeReference: NEUTRAL_ATTRIBUTE,
      // Gancho explícito para el futuro módulo de Entrenamiento (DESIGN.md
      // 7.11.5) — multiplicador neutro (1 = sin efecto) hasta que ese módulo
      // exista. NO implementar el sistema de entrenamiento aquí.
      trainingModifierDefault: 1,
    },

    // --- DESIGN.md 3.3 (Entidad Calendario) — fecha real de cada partido
    // de las 4 competiciones, para poder calcular días de descanso reales
    // (7.11.5) en vez de solo un número de jornada/ronda abstracto. Valores
    // de partida razonables, NO cifras cerradas — pendientes de ajuste.
    calendar: {
      seasonStartMonth: 9, // octubre (0-indexed, como Date de JS)
      seasonStartDay: 3, // ajustar al primer sábado de octubre real del año de inicio
      daysBetweenRounds: 7, // separación entre jornadas de liga regular
      cupRoundGapDays: 3, // separación ORIENTATIVA entre rondas de Copa — se comprime si no cabe en el hueco fijo de 7 días (ver DESIGN.md 3.3.2)
      cupFinalCushionDays: 2, // regla dura (DESIGN.md 3.3.2): mínimo de días entre la final de Copa y la jornada 18
      seriesGameGapDays: 2, // separación entre partidos de una misma Series (playoff/ascenso)
      seriesRoundGapDays: 5, // separación entre rondas de un Bracket (cuartos->semis, etc.)
      seasonEndToPlayoffGapDays: 10, // hueco entre fin de jornada 34 y playoff por el título
    },

    // --- DESIGN.md 7.11.7 (Alineación automática de equipos CPU) ---
    // Banda de posiciones alrededor de la frontera del objetivo de
    // temporada propio (corte de Copa/Playoff = posición 8, corte de
    // descenso = penúltima posición) dentro de la que un partido de liga
    // regular se considera "clave" para ese equipo. Valor de partida,
    // pendiente de calibración (DESIGN.md: "banda configurable, ej. ±3-4").
    cpuMatchImportance: {
      standingsBandSize: 4,
    },

    // Generación de quinteto/rotación para equipos gestionados por la CPU
    // (DESIGN.md 7.11.7). Pesos y bandas de partida, pendientes de
    // calibración — el criterio (qué señales entran y en qué dirección) es
    // lo fijado en el diseño, no estos números finales.
    cpuLineup: {
      // Combinación de afinidad posicional (Player.positionLevel, 1-20),
      // calidad general (media de las 3 medias de atributos, 1-20) y
      // Energía actual (escalada a 1-20) para puntuar a un jugador en una
      // posición concreta. Deben sumar 1.
      ratingWeights: { affinity: 0.5, quality: 0.3, energy: 0.2 },
      // Reparto de minutos por fila (starter/sub1/sub2) en partido NO
      // clave vs. partido clave — en partido clave se prioriza más al
      // titular (DESIGN.md: "acepta jugar con más minutos a titulares").
      minutesSplit: { starter: 0.6, sub1: 0.25, sub2: 0.15 },
      minutesSplitKeyMatch: { starter: 0.7, sub1: 0.2, sub2: 0.1 },
      // Tamaño del grupo de candidatos entre los que se elige de forma
      // aleatoria ponderada para cada slot — más pequeño en partido clave
      // (menos variedad, más peso a la valoración pura), más amplio en
      // partido no clave (más variedad partido a partido).
      candidatePoolSize: 3,
      keyMatchCandidatePoolSize: 2,
      // Pesos del sorteo ponderado dentro del grupo de candidatos (más
      // peso al mejor situado, no determinista) — se recorta al tamaño
      // real del grupo si hay menos candidatos disponibles.
      candidatePoolWeights: [3, 2, 1],
      // Energía por debajo de la cual, en partido NO clave, se reduce la
      // cuota de un titular seleccionado en favor del siguiente candidato
      // (DESIGN.md: "banda a definir, ej. por debajo de 30").
      lowEnergyThreshold: 30,
    },

    // --- DESIGN.md 3.4.3: umbrales de señalFinal -> board.sportingGoal,
    // recalculado en cada pretemporada (SeasonGoals.js). Valores de
    // partida (tabla de 3.4.3), ajustables sin tocar código.
    seasonGoals: {
      titleThreshold: 80, // señalFinal >= 80 -> Pelear por el título
      playoffThreshold: 55, // 55-79 -> Optar a playoffs
      stayUpThreshold: 30, // 30-54 -> Consolidarse en la categoría; <30 -> Evitar el descenso
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

    // --- DESIGN.md 7.12 (Sistema táctico) — TAC-1: núcleo táctico de
    // posesión (7.12.33). Todos los pesos/umbrales aquí son valores de
    // partida "pendientes de calibración (7.12.31)" — 7.12 fija la
    // ESTRUCTURA (qué señales entran, en qué dirección), no las cifras
    // finales, igual que 7.6 (ver comentario al principio de `actions`).
    tactics: {
      // Probabilidad de que una posesión de un equipo CON TacticalProfile
      // se resuelva como Pick & Roll central en vez del bucle 1v1 normal —
      // pendiente de calibración (7.12.31), valor de partida razonable.
      pnrFrequency: 0.3,
      // Cobertura de DefensivePlan cuando el equipo defensor no tiene
      // TacticalProfile asignado (DESIGN.md 7.12.16, punto 3 del prompt
      // de esta sesión) — Drop es la cobertura "por defecto" real más
      // habitual, no una cifra arbitraria.
      defaultCoverage: 'drop',

      // Mezcla de atributos del HANDLER para medir cuánto explota cada
      // cobertura (7.12.16 "vulnerabilidades emergentes") — mismo shape
      // que `primary`/`secondary` de `actions`, consumida por
      // Tactics.computeAdvantageScore vía MatchEngine.computeMixRating
      // (no se duplica esa función, se le pasa esta mezcla como dato).
      // 'hedge' comparte literalmente los valores de 'blitz' (7.12.16 los
      // agrupa como "Hedge/Blitz", misma vulnerabilidad) — no hace falta
      // diferenciarlos todavía, ver Tactics.js.
      coverageHandlerMix: {
        // Drop: el big protege el aro: pull-up/floater de media distancia
        // o exterior es la vulnerabilidad (7.12.16, 7.12.31 invariante 1).
        drop: { midRangeShot: 0.4, outsideShot: 0.3, gameVision: 0.3 },
        // Under: concede más el exterior a propósito — castigable por un
        // gran tirador (7.12.31 invariante 4).
        under: { outsideShot: 0.6, midRangeShot: 0.3, gameVision: 0.1 },
        // Switch: no hay ventaja de tiro inmediata que buscar — el
        // handler sondea el mismatch en vez de tirar directo (7.12.31
        // invariante 3; el mismatch en sí lo mide computeAdvantageScore
        // sobre los DEFENSORES, no aquí).
        switch: { ballHandling: 0.4, gameVision: 0.35, passing: 0.25 },
        // Hedge/Blitz: dos defensores sobre el balón — la vulnerabilidad
        // es la lectura rápida del short-roll/4v3 (7.12.31 invariante 2),
        // no el tiro directo del handler.
        hedge: { gameVision: 0.5, passing: 0.5 },
        blitz: { gameVision: 0.5, passing: 0.5 },
      },
      // Mezcla de atributos del SCREENER — genérica (no varía por
      // cobertura en TAC-1): capacidad de leer el roll y finalizar cerca
      // del aro.
      screenerMix: { gameVision: 0.3, passing: 0.3, insideShot: 0.2, layup: 0.2 },

      // Mezcla de atributos del defensor que ejecuta cada cobertura sobre
      // el HANDLER (rol "on-ball" tras aplicar el cambio de Switch, ver
      // Tactics.computeAdvantageScore).
      coverageDefenderMix: {
        drop: { perimeterDefense: 0.5, anticipation: 0.3, workRate: 0.2 },
        under: { perimeterDefense: 0.6, anticipation: 0.4 },
        // Switch: mezcla deliberadamente orientada a defensa PERIMETRAL —
        // el mismatch real (7.12.31 invariante 3) sale de evaluar a un
        // interior con esta mezcla cuando es él quien queda tras el
        // cambio (ver nota en Tactics.computeAdvantageScore).
        switch: { perimeterDefense: 0.6, agility: 0.4 },
        hedge: { perimeterDefense: 0.4, aggressiveness: 0.3, anticipation: 0.3 },
        blitz: { perimeterDefense: 0.4, aggressiveness: 0.3, anticipation: 0.3 },
      },
      // Mezcla del defensor del bloqueador en su rol "roll" (tras Switch,
      // el ORIGINAL onBallDefender pasa a este rol — ver nota de mismatch).
      screenerDefenderMix: { interiorDefense: 0.5, strength: 0.3, blocking: 0.2 },

      advantage: {
        // advantageScore base por cobertura ANTES de factorizar atributos
        // (7.12.16): cuanto más agresiva/comprometida la cobertura, más
        // negativo el punto de partida para el ataque (Blitz > Switch >
        // Drop > Under) — pendiente de calibración masiva (7.12.31).
        coverageBaseScore: {
          drop: -0.1,
          under: 0.05,
          switch: -0.2,
          hedge: -0.35,
          blitz: -0.35,
        },
        // Pesos de la combinación handler+screener (ataque) y
        // onBallDefender+screenerDefender (defensa) en sus roles
        // efectivos — deben sumar 1 cada pareja.
        handlerWeight: 0.7,
        screenerWeight: 0.3,
        onBallDefenderWeight: 0.6,
        screenerDefenderWeight: 0.4,
        // Sensibilidad de advantageScore a la diferencia de rating
        // ofensivo/defensivo (mismo papel que `sensitivity` en `actions`,
        // pero en una escala mayor a propósito: aquí el rango objetivo es
        // -1..+1 completo, no una probabilidad 0-1 con un intercepto que
        // ya absorbe la mayor parte del valor). Calibrado empíricamente
        // (script Node dedicado) para que una diferencia de atributos
        // realista entre dos jugadores (≈5-9 puntos de rating en la
        // mezcla relevante) sea suficiente para cruzar de una rama de
        // lectura a la siguiente — pendiente de calibración masiva
        // (7.12.31), esto es un punto de partida verificado, no una cifra
        // cerrada.
        sensitivity: 0.1,
        // Ruido gaussiano pequeño (7.5-bis, variabilidad de ejecución) —
        // sigma fijo en TAC-1 (la familiaridad/consistencia por jugada es
        // TAC-6, no varía por jugador todavía).
        noiseSigma: 0.08,
        // Umbrales de bifurcación de lectura (7.12.4): por debajo de
        // `smallAdvantage`, rama de ventaja baja/nula; entre ambos,
        // pequeña ventaja; por encima de `clearAdvantage`, ventaja clara/
        // defensa rota. Pendientes de calibración (7.12.31) — no hay cifra
        // cerrada en DESIGN.md para esta separación.
        // TAC-3 (7.12.4/7.12.33): ampliado de 2 a 4 umbrales para separar
        // las 6 categorías completas de AdvantageState en vez de solo 3
        // ramas — `smallAdvantage`/`clearAdvantage` NO cambian de valor
        // respecto a TAC-1/TAC-2 (mismo punto de corte "small"/"clear" para
        // el colapso 6→3 que usa planPnrPossession legacy, ver Tactics.js
        // `collapseRead6To3`); `clearDefenseAdvantage`/`stableDefense`
        // subdividen la vieja rama "low", `clearOffenseAdvantage` subdivide
        // la vieja rama "small". Pendientes de calibración (7.12.31/7.12.34).
        thresholds: {
          clearDefenseAdvantage: -0.5,
          stableDefense: -0.15,
          smallAdvantage: 0.15,
          clearOffenseAdvantage: 0.3,
          clearAdvantage: 0.5,
        },
        // Penalización de rating (puntos, escala 1-20 — mismo orden de
        // magnitud que emergencyVersatility.basePenaltyByDistance más
        // abajo) aplicada al defensor cuando la lectura es "pequeña
        // ventaja": "defensor llega tarde" (7.12.4) se traduce como un
        // contexto de penalización adicional sobre el MISMO mecanismo ya
        // existente (computeMixRating/penalty), no un canal paralelo.
        recoveringDefenderPenalty: 1.5,
        // TAC-3 (7.12.6/7.12.34): conexión de effectiveSpacing con
        // AdvantageState, pendiente heredado de TAC-2 — término ACOTADO y
        // pequeño (Tactics.computeSpacingAdvantageTerm), único sitio donde
        // el spacing entra a la fórmula (evita doble conteo, 7.12.4).
        // `neutral` aproxima el effectiveSpacing típico de un quinteto de
        // nivel medio en el spacing por defecto (4-Out-1-In) — verificado
        // en DIRECCIÓN con un script de invariantes (5-Out real > 3-Out-2-In
        // real para el MISMO quinteto), no en cifra cerrada. Pendiente de
        // calibración masiva (7.12.31/7.12.34).
        spacing: {
          sensitivity: 0.12,
          neutral: 0.6,
          maxEffect: 0.08,
        },
      },

      // TAC-3 (7.12.8, punto 2 del prompt): mezclas/umbrales de Isolation y
      // Post Up con comportamiento real por primera vez — mismo criterio
      // que `coverageHandlerMix`/`screenerMix` de arriba (datos, no lógica
      // hardcodeada en Tactics.js). Pendientes de calibración (7.12.31).
      isolation: {
        // Anotador: manejo + finalización variada + agresividad (ataca
        // directo, sin bloqueo). Defensor: perfil de "stopper" perimetral.
        scorerMix: { ballHandling: 0.3, midRangeShot: 0.2, insideShot: 0.15, layup: 0.15, aggressiveness: 0.2 },
        defenderMix: { perimeterDefense: 0.6, agility: 0.25, anticipation: 0.15 },
        baseScore: -0.05,
        sensitivity: 0.1,
        noiseSigma: 0.08,
      },
      postUp: {
        scorerMix: { insideShot: 0.4, strength: 0.3, balance: 0.2, aggressiveness: 0.1 },
        defenderMix: { interiorDefense: 0.55, strength: 0.3, blocking: 0.15 },
        baseScore: -0.05,
        sensitivity: 0.1,
        noiseSigma: 0.08,
        // Umbral/probabilidad de la regla 'starOnly' (7.12.19) — MISMOS
        // valores que la versión simple de TAC-3, sin cambiar de cifra,
        // para no romper el rango de regresión con el perfil por defecto
        // (defaultDoubleTeamRule más abajo).
        doubleTeamRatingMargin: 3,
        doubleTeamProbability: 0.5,
        // TAC-4 (7.12.19 completo): catálogo de reglas de activación —
        // 'never'/'starOnly'/'always' son las únicas con comportamiento
        // real esta entrega. 'onCatch'/'onFirstDribble'/zona objetivo
        // (matices de timing de 7.12.19) quedan fuera: este motor resuelve
        // el poste en una sola pasada, sin sub-pasos de catch/dribble
        // sobre los que distinguirlas — pendiente de calibración/decisión
        // (7.12.34).
        doubleTeamRules: ['never', 'starOnly', 'always'],
        defaultDoubleTeamRule: 'starOnly',
        // Probabilidad de que el postScorer ENCUENTRE el hueco que deja el
        // doble equipo (kick-out exitoso), según su propia lectura
        // (VisiónJuego+Pase) — TAC-3 acreditaba el kick-out el 100% de las
        // veces; esta entrega lo condiciona a la calidad del pasador
        // (7.12.19: "la Visión/Pase/Decisión del jugador posteado... deciden
        // si puede castigar esa superioridad"). Pendiente de calibración
        // (7.12.31).
        readMix: { gameVision: 0.5, passing: 0.5 },
        readBaseProbability: 0.55,
        readSensitivity: 0.35,
        // Penalización de calidad de tiro (mismo canal que
        // `shotAdjustment`, nunca un resolver de pérdida nuevo) cuando el
        // doble equipo llega y el postScorer NO encuentra el hueco — tiro
        // forzado con dos defensores encima.
        doubleTeamFailedReadPenalty: 0.12,
      },

      // TAC-3 (7.12.8): presupuesto de referencia para Tactics.selectPlayType
      // — "100 posesiones" conceptuales sobre las que se reparten los pesos
      // de playTypeWeights (incluida la frecuencia de P&R, ya modulada por
      // identity.pickAndRollUsage) antes de caer al bucle 1v1 normal.
      // Pendiente de calibración (7.12.34).
      playTypeSelection: {
        budget: 100,
      },

      // TAC-3 (7.12.12): ver Tactics.resolveTransitionAttempt — punto neutro
      // igual al default de playTypeWeights.transition (15) para reproducir
      // el comportamiento de siempre con perfil por defecto.
      transitionAttempt: {
        weightNeutral: 15,
      },

      // TAC-3 (7.12.11): continuidad/counters — cuánto reloj de posesión
      // exige/consume una segunda acción, y penalización de tiro forzado
      // cuando no queda reloj para intentarla. Pendientes de calibración
      // (7.12.31/7.12.34).
      continuity: {
        minClockForSecondAction: 5,
        secondActionClockCost: 3,
        extraPassClockCost: 2,
        forcedShotPenalty: 0.08,
      },

      // TAC-3 (7.12.5): bonus de probabilidad de asistencia (no de tiro,
      // "regla dura" 7.12.5) por la calidad de lectura/pase del creador de
      // la ventaja — VisiónJuego+Pase+DecisiónBajoPresión frente al valor
      // neutro de atributo (escala 1-20). Pendiente de calibración (7.12.34).
      assist: {
        playmakingBoostMax: 0.15,
      },

      // --- DESIGN.md 7.12 (Sistema táctico) — TAC-2: identidad + spacing +
      // roles (7.12.33). Mismo criterio que el bloque `advantage` de arriba:
      // valores de partida "pendientes de calibración (7.12.31/7.12.34)",
      // la estructura (qué entra, en qué dirección) es lo que fija 7.12, no
      // la cifra final.

      // Ejes de identidad ofensiva (7.12.7, mínimo de esta entrega) y pesos
      // de play-type (7.12.8, mínimo de esta entrega) — valores por defecto
      // de un TacticalProfile recién creado (Team.js). `identity` usa escala
      // 0-100 (igual que el ejemplo ilustrativo de 7.12.29); `playTypeWeights`
      // no son un reparto de 100 posesiones, solo prioridad relativa (7.12.8).
      identity: {
        defaults: { pace: 50, earlyOffense: 50, ballMovement: 50, pickAndRollUsage: 50 },
        // Punto neutro de `pickAndRollUsage` (7.12.7) que reproduce EXACTAMENTE
        // `pnrFrequency` de arriba sin modulación — con este valor, un equipo
        // con TacticalProfile por defecto sortea P&R con la misma frecuencia
        // que en TAC-1 (invariante de regresión, ver Tactics.resolvePnrFrequency).
        pickAndRollUsageNeutral: 50,
        // Rango de modulación de `pnrFrequency` (multiplicador acotado):
        // 0 = el eje puede anular el P&R táctico por completo; 2 = puede
        // duplicar la frecuencia base. Pendiente de calibración masiva.
        pickAndRollUsageMaxMultiplier: 2,
      },
      playTypeWeights: {
        // Solo `pickAndRoll` tiene efecto real en el motor esta entrega (ver
        // arriba, `identity.pickAndRollUsage`); el resto se guarda para que
        // TAC-3 los consuma al implementar sus play-types (7.12.8, catálogo
        // completo pendiente de comportamiento propio).
        defaults: { pickAndRoll: 30, isolation: 15, postUp: 10, transition: 15 },
      },

      // Spacing (7.12.6) — catálogo de opciones en Tactics.SPACING_OPTIONS;
      // aquí solo los pesos que alimentan `effectiveSpacing()`.
      spacing: {
        default: '4-out-1-in',
        // Mezcla de atributos que mide la "amenaza de tiro exterior real"
        // de un jugador en el suelo (7.12.6: "Tiro exterior real de los
        // cinco"), usada para ordenar quién cuenta como amenaza en cada
        // spacing. Debe sumar 1.
        shotThreatMix: { outsideShot: 0.7, midRangeShot: 0.3 },
        // Cuántos de los 5 jugadores (los de MAYOR amenaza, no posición fija)
        // debe respetar la defensa para que ESE spacing sea real (7.12.31,
        // invariante 5/6: 5-Out exige a los 5, 3-Out-2-In exige menos).
        shooterRequirement: { '5-out': 5, '4-out-1-in': 4, '3-out-2-in': 3 },
        // Techo de espacio ocupado propio de cada estructura ANTES de mirar
        // a los jugadores reales (7.12.31 invariante 6: 3-Out-2-In < 5-Out
        // incluso con jugadores idénticos, por diseño de la estructura).
        // 'dynamic' no tiene techo propio: usa el mejor ajuste real de los
        // otros tres para ESE quinteto concreto (7.12.6, "el spacing cambia
        // según quinteto").
        archetypeCeiling: { '5-out': 1.0, '4-out-1-in': 0.85, '3-out-2-in': 0.65 },
      },

      // Roles ofensivos (7.12.9) y defensivos (7.12.21) — catálogo de ids y
      // etiquetas en Tactics.OFFENSIVE_ROLES/DEFENSIVE_ROLES; aquí solo los
      // pesos de atributos (mismo criterio que coverageHandlerMix arriba) y
      // los pesos de combinación de roleFit.
      roles: {
        fitWeights: {
          // roleFit combina mezcla de atributos (aptitud pura) y competencia
          // posicional (6.1) — mismo peso relativo que handler/screener de
          // `advantage` arriba (0.7/0.3), reutilizado por analogía, no
          // recalculado aparte.
          attributeMixWeight: 0.7,
          positionLevelWeight: 0.3,
          // Estado físico (DESIGN.md 7.12.9/7.12.21, "estado físico"): un
          // jugador agotado rinde peor en su rol AHORA MISMO, pero el efecto
          // es pequeño a propósito — roleFit es sobre todo una valoración de
          // aptitud, no un medidor de forma del día (eso ya lo cubren las
          // estrellas de Forma/Energía que muestra la pantalla de Alineación).
          energyBaseline: 0.9,
          energyRange: 0.1,
        },
        // Mezclas de atributos por rol ofensivo (7.12.9) — pesos relativos,
        // no necesitan sumar 1 (se normalizan en Tactics.computeSimpleMix).
        offensiveMix: {
          primaryCreator: { ballHandling: 0.35, gameVision: 0.35, passing: 0.2, pressureDecisionMaking: 0.1 },
          secondaryCreator: { ballHandling: 0.3, gameVision: 0.3, passing: 0.3, pressureDecisionMaking: 0.1 },
          pnrHandler: { ballHandling: 0.4, gameVision: 0.3, passing: 0.2, pressureDecisionMaking: 0.1 },
          isolationScorer: { ballHandling: 0.3, midRangeShot: 0.25, insideShot: 0.15, layup: 0.1, aggressiveness: 0.2 },
          spotUpShooter: { outsideShot: 0.55, positioning: 0.25, concentration: 0.2 },
          movementShooter: { outsideShot: 0.4, agility: 0.2, positioning: 0.25, stamina: 0.15 },
          slasher: { acceleration: 0.3, agility: 0.25, layup: 0.3, aggressiveness: 0.15 },
          connector: { passing: 0.35, gameVision: 0.35, teamwork: 0.2, ballHandling: 0.1 },
          postScorer: { insideShot: 0.4, strength: 0.25, balance: 0.2, aggressiveness: 0.15 },
          postHub: { passing: 0.3, gameVision: 0.3, insideShot: 0.2, teamwork: 0.2 },
          rollMan: { layup: 0.35, jumping: 0.25, strength: 0.2, offensiveRebound: 0.2 },
          shortRollPlaymaker: { passing: 0.35, gameVision: 0.3, layup: 0.2, pressureDecisionMaking: 0.15 },
          pickAndPopBig: { outsideShot: 0.4, midRangeShot: 0.35, strength: 0.25 },
          primaryScreener: { strength: 0.35, balance: 0.25, workRate: 0.2, offensiveRebound: 0.2 },
          offensiveRebounder: { offensiveRebound: 0.45, jumping: 0.25, strength: 0.15, workRate: 0.15 },
        },
        // Mezclas de atributos por rol defensivo (7.12.21).
        defensiveMix: {
          poaStopper: { perimeterDefense: 0.4, agility: 0.25, anticipation: 0.2, stealing: 0.15 },
          screenNavigator: { agility: 0.35, perimeterDefense: 0.3, workRate: 0.2, stamina: 0.15 },
          switchDefender: { perimeterDefense: 0.3, interiorDefense: 0.3, agility: 0.25, strength: 0.15 },
          perimeterDisruptor: { stealing: 0.35, anticipation: 0.3, aggressiveness: 0.2, perimeterDefense: 0.15 },
          nailHelper: { anticipation: 0.35, gameVision: 0.25, positioning: 0.25, interiorDefense: 0.15 },
          lowMan: { interiorDefense: 0.35, jumping: 0.25, blocking: 0.25, anticipation: 0.15 },
          rimProtector: { blocking: 0.4, interiorDefense: 0.3, jumping: 0.2, strength: 0.1 },
          postAnchor: { interiorDefense: 0.5, strength: 0.3, balance: 0.2 },
          roamer: { anticipation: 0.35, gameVision: 0.25, stealing: 0.2, agility: 0.2 },
          defensiveRebounder: { defensiveRebound: 0.45, jumping: 0.25, strength: 0.15, positioning: 0.15 },
        },
      },

      // --- DESIGN.md 7.12 (Sistema táctico) — TAC-4: defensa avanzada
      // (7.12.33). Mismo criterio que el resto del módulo: valores de
      // partida "pendientes de calibración (7.12.31/7.12.34)", 7.12 fija
      // la estructura, no la cifra final.

      // Esquema defensivo base (7.12.13/7.12.14) — catálogo MÍNIMO: solo
      // 3 zonas reales (2-3/3-2/1-3-1) además de man-to-man. Match-up Zone
      // (híbrido zona/hombre) y Box-and-One (exige un jugador objetivo
      // marcado) quedan fuera de esta entrega, señalados explícitamente
      // como pendientes — "catálogo mínimo razonable" permitido
      // explícitamente por el prompt de esta sesión cuando 7.12 no cierra
      // el catálogo exacto.
      defense: {
        baseSchemes: ['man-to-man', '2-3', '3-2', '1-3-1'],
        defaultBaseScheme: 'man-to-man',
        // Efecto de zona sobre AdvantageState (7.12.14: "debe cambiar qué
        // defensor es responsable... dónde aparece una sobrecarga",
        // NUNCA un opponent3P+X/opponentInside-Y directo). Se modela como
        // el mismo tipo de término acotado que ya usa
        // computeSpacingAdvantageTerm para el spacing individual — la
        // pieza dominante es `spacingSensitivity` (una zona debe ser
        // MÁS vulnerable a un quinteto con effectiveSpacing real alto que
        // a uno sin tiradores reales, invariante nuevo de esta entrega),
        // `baseScoreByScheme` es solo el punto de partida estructural de
        // cada zona antes de mirar a los jugadores reales (mismo patrón
        // que `advantage.coverageBaseScore` para coberturas de P&R).
        zone: {
          baseScoreByScheme: {
            '2-3': -0.05, // protege pintura por defecto (7.12.14)
            '3-2': -0.02, // más presencia perimetral, menos protección interior
            '1-3-1': 0.03, // presiona líneas de pase, pero las rotaciones largas dejan huecos de media distancia
          },
          spacingSensitivity: 0.35,
          spacingNeutral: 0.55,
          // "1-2 contramedidas reales" mínimas pedidas explícitamente
          // (punto 2 del prompt de esta sesión), conectadas al play-type
          // YA elegido por Tactics.selectPlayType (7.12.8), sin inventar
          // un sub-sistema de jugadas anti-zona completo: Post Up ataca
          // el alto poste que deja libre una 2-3 (7.12.14, "riesgos en
          // high post"); Pick & Roll/Isolation explotan el hueco de una
          // 1-3-1 tras el trap (7.12.14, "exige rotaciones largas") vía
          // skip-pass/kick-out. Overload y otras contramedidas de
          // playbook completo quedan fuera, señaladas explícitamente.
          playTypeCounters: {
            '2-3': { postUp: 0.06 },
            '1-3-1': { pickAndRoll: 0.05, isolation: 0.03 },
          },
          maxEffect: 0.14,
        },
      },

      // Press (7.12.15) — solo el tramo INICIAL de la posesión, antes de
      // decidir play-type: modula la probabilidad de rollTurnover() YA
      // EXISTENTE (nunca un resolver nuevo) y el reloj consumido en
      // cruzar medio campo, según la calidad de manejo/decisión del
      // equipo atacante (un press castiga más a manejadores débiles).
      // Desgaste extra de Energía por presionar (7.12.15) queda fuera —
      // exigiría tocar Rotation.js/Recovery.js, vetado explícitamente
      // para esta entrega.
      press: {
        types: ['halfCourt', 'fullCourt'],
        turnoverBoost: { halfCourt: 0.25, fullCourt: 0.6 },
        clockCostSeconds: { halfCourt: 0.5, fullCourt: 1.5 },
        maxMultiplier: 2.2,
        neutralHandling: 10, // escala 1-20, aproxima un manejador de nivel medio
        handlingMix: { ballHandling: 0.4, gameVision: 0.3, pressureDecisionMaking: 0.3 },
      },

      // Transición defensiva (7.12.20) — modificador DENTRO de la ventana
      // de contraataque YA EXISTENTE (7.6 acción 14, nunca la ventana en
      // sí): un repliegue malo (media de Velocidad/ÉticaDeTrabajo/
      // Posicionamiento del quinteto que acaba de perder el balón) amplía
      // la ventaja de contraataque más allá de lo que ya da la ventana;
      // uno excelente puede neutralizarla parcialmente. No modela
      // "cuántos jugadores cargaron el rebote" de forma explícita (7.12.20
      // lo describe así, pero este motor no distingue por jugador quién
      // cargó el rebote vs quién se replegó) — aproximación por atletismo
      // agregado del quinteto, señalada como simplificación.
      transitionDefense: {
        retreatMix: { topSpeed: 0.35, workRate: 0.35, positioning: 0.3 },
        neutral: 12, // escala 1-20, aproxima un quinteto de nivel medio
        sensitivity: 0.02,
        maxEffect: 0.12,
      },

      // Valoraciones derivadas de quinteto (7.12.28) que TAC-2 dejó fuera
      // explícitamente por falta de piezas de defensa avanzada
      // (Switchability/Rim Protection) — ya hay una base de datos sólida
      // tras esta entrega (DefensiveScheme, matchups, transición
      // defensiva) para completarlas; Transition Defense reutiliza
      // LITERALMENTE `transitionDefense.retreatMix` de arriba, no una
      // aproximación nueva. POA Defense/Transition Offense/Tactical
      // Execution siguen fuera (ninguna pedida por el prompt de esta
      // entrega), señaladas explícitamente en el CHANGELOG.
      lineupRatings: {
        switchabilityMix: { perimeterDefense: 0.35, interiorDefense: 0.35, agility: 0.3 },
        rimProtectionMix: { interiorDefense: 0.4, blocking: 0.4, jumping: 0.2 },
      },

      // --- DESIGN.md 7.12.24 (TAC-5): situaciones especiales — solo el
      // umbral que de verdad necesita un número de CONFIG propio
      // (Tactics.resolveSituationType). Late Clock reutiliza LITERALMENTE
      // `lateClock.noFullPlayThresholdSeconds` (7.6.19, ya existente, ver
      // arriba) y Last Possession reutiliza `pressure.
      // buzzerBeaterSecondsThreshold` (7.6.17) — ninguno de los dos
      // duplica una cifra ya calibrada para otro propósito, solo
      // `lastPossessionMarginPoints` (margen de partido que hace plausible
      // que ESTA sea la posesión decisiva) es nuevo. Cifra propia,
      // pendiente de calibración (7.12.34): un partido a 1-3 posesiones de
      // diferencia con reloj de últimos segundos del período final.
      situational: {
        lastPossessionMarginPoints: 3,
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
