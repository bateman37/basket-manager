// src/core/MatchConfig.js
// CONFIG del motor de simulación de partidos — ver DESIGN.md sección 7,
// especialmente 7.2 ("el CONFIG es una entidad propia, no una lista suelta
// de constantes"), 7.3/7.3-bis (estructura de las fórmulas) y 7.6 (catálogo
// de acciones). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// FASE 1: Bloque A (10 acciones base) y Bloque B (3 caminos de reglamento).
// FASE 2 (esta entrega): añade el modificador de Altura/Envergadura/Peso
// (7.4, flag `heightAxis1` en cada acción), Presión de
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
// `heightAxis1` (7.4) por acción: objeto `{ primary: modo, secondary: modo }`
// (solo se listan los lados a los que aplica). ('benefit'|'penalize'):
// modificador por envergadura relativa propia (wingspan-height), acotado,
// sumado o restado al rating de ESE lado — ver
// MatchEngine.applyHeightAxisModifiers(). El antiguo "Eje 2" (altura/peso vs
// Agilidad, "impuesto físico" por superar un umbral absoluto) se RETIRÓ en
// la revisión mini-EPIC POS — ver DESIGN.md 7.4 para la justificación
// completa (evidencia real moderada/contradictoria; los atributos físicos
// explícitos del jugador ya describen su movilidad real).

(function (global) {
  // Player.js (config.positions.attributeCategory, mini-EPIC POS): se
  // construye a partir del catálogo YA existente de atributos Técnicos/
  // Físicos/Mentales, para no duplicar esa lista aquí. Player.js carga
  // antes que este archivo (ver index.html/Node require, sin dependencia
  // circular), así que está disponible en tiempo de carga del propio
  // CONFIG_BASE.
  const PlayerCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;
  const { TECHNICAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, MENTAL_ATTRIBUTES } = PlayerCore;

  // DESIGN.md 7.11.3 (revisión mini-EPIC POS): atributos de "responsabilidad
  // posicional" — reciben la penalización COMPLETA de la curva no lineal al
  // cubrir una posición de emergencia. Todo lo demás (tiro, pase, manejo,
  // físicos...) es "pureSkill" y recibe solo una fracción — el cuerpo/
  // técnica del jugador no desaparece por jugar fuera de su posición
  // habitual, lo que falla es la lectura/posicionamiento.
  const RESPONSIBILITY_ATTRIBUTES = new Set([
    'positioning', 'gameVision', 'pressureDecisionMaking', 'anticipation',
    'interiorDefense', 'perimeterDefense', 'teamwork',
  ]);

  function buildAttributeCategoryMap() {
    const map = {};
    [...TECHNICAL_ATTRIBUTES, ...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].forEach((attrName) => {
      map[attrName] = RESPONSIBILITY_ATTRIBUTES.has(attrName) ? 'responsibility' : 'pureSkill';
    });
    return map;
  }

  // Escala de atributos 1-20 (ver Player.js) — valor "neutro"/liga-media
  // usado como referencia en las fórmulas de intercepto directo (tiro libre).
  const NEUTRAL_ATTRIBUTE = 10.5;

  // Exponente de la curva no lineal de penalización por competencia
  // posicional (DESIGN.md 6.1, mini-EPIC POS) — constante compartida para
  // que positions.competencePenaltyExponent y
  // tactics.roles.fitWeights.positionShortfallExponent nunca diverjan sin
  // querer al calibrar.
  const COMPETENCE_PENALTY_EXPONENT = 1.6;
  // Límite superior del tramo "Funcional" (DESIGN.md 6.1: 11-14) —
  // constante compartida para que positions.competenceThresholds.
  // functionalMax y tactics.roles.fitWeights.positionShortfallThreshold
  // nunca diverjan sin querer al calibrar.
  const FUNCTIONAL_COMPETENCE_MAX = 14;

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

    // --- DESIGN.md 6.1/7.11.3/7.12.9 (mini-EPIC POS): Competencia
    // posicional — parámetros compartidos por Player.js (semántica de
    // tramos), Rotation.chooseEmergencyCandidate (7.11.3) y Tactics.roleFit
    // (7.12.9). Vive como sección propia (no dentro de emergencyVersatility
    // ni de tactics.roles) porque los tres consumidores la comparten.
    positions: {
      // Descriptores de los 5 tramos de DESIGN.md 6.1 — mismo patrón de
      // shape que tactics.roles... starRating.thresholds (más abajo):
      // límites SUPERIORES (inclusive) de cada escalón salvo el máximo
      // (20 = Dominio natural completo, implícito por encima del último).
      competenceThresholds: {
        outOfPositionMax: 6, // 1-6: Claramente fuera de posición
        emergencyMax: 10, // 7-10: Emergencia
        functionalMax: FUNCTIONAL_COMPETENCE_MAX, // 11-14: Funcional
        veryCompetentMax: 17, // 15-17: Muy competente
        almostNaturalMax: 19, // 18-19: Prácticamente natural
        // 20: Dominio natural completo (naturalMastery)
      },
      // Exponente de la curva no lineal de penalización por competencia
      // posicional (DESIGN.md 6.1: penalización_base × (1-nivel/20)^exponente)
      // — reutilizado tanto por emergencyVersatility (7.11.3) como por
      // tactics.roles.fitWeights.positionShortfallExponent (7.12.9) para no
      // duplicar el número en dos sitios. Punto de partida orientativo, sin
      // validar por simulación masiva.
      competencePenaltyExponent: COMPETENCE_PENALTY_EXPONENT,
      // Umbral (cm) de envergadura relativa (wingspan-height) a partir del
      // que el Modelo B de 7.4 sesga la generación de outsideShot/
      // interiorDefense/blocking/rebote (playerGenerator.js) — SOLO en
      // generación, nunca en tiempo de partido.
      wingspanBiasThresholdCm: 8,
      // Categoría de cada atributo Técnico/Físico/Mental (DESIGN.md 7.11.3):
      // 'responsibility' (penalización completa) | 'pureSkill' (penalización
      // reducida, ver pureSkillPenaltyFraction) — construido arriba a partir
      // del catálogo ya existente de Player.js, no duplicado a mano.
      attributeCategory: buildAttributeCategoryMap(),
      // Fracción de la penalización completa que reciben los atributos
      // 'pureSkill'. Única cifra de calibración explícitamente sin cerrar
      // por Dennis más allá de "0.2 si no se indica otro número" (prompt
      // mini-EPIC POS).
      pureSkillPenaltyFraction: 0.2,
    },

    // --- 7.4: Modificador de Envergadura (revisión mini-EPIC POS) ---
    // El antiguo Eje 2 (altura/peso vs Agilidad, "impuesto físico" por
    // superar un umbral absoluto de altura) se RETIRA — ver DESIGN.md 7.4
    // para la justificación completa (evidencia real moderada/contradictoria,
    // atributos físicos explícitos ya cubren la movilidad real del
    // jugador). Solo queda el Eje 1 (envergadura relativa).
    heightModifiers: {
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

    // --- DESIGN.md 7.11.3 (Bloque C.3, revisión mini-EPIC POS):
    // Polivalencia de emergencia ---
    emergencyVersatility: {
      // Penalización BASE de rendimiento (escala 1-20, mismo orden de
      // magnitud que heightModifiers) — ya NO depende de la distancia
      // posicional geométrica (esa heurística solo sobrevive en
      // GENERACIÓN, ver DESIGN.md 7.11.3): se multiplica por
      // (1 - nivel/20)^config.positions.competencePenaltyExponent en
      // Rotation.chooseEmergencyCandidate, y el resultado se reparte entre
      // responsibilityPenalty (completa)/pureSkillPenalty (fracción) en
      // MatchEngine.computeMixRating. Valor de partida, pendiente de
      // calibración.
      basePenalty: 6,
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

      // --- CAL-1 (DESIGN.md 3.3.1 evolucionado): horario real por partido,
      // no solo fecha. `dayOffset` es relativo al "sábado ancla" que ya
      // calculaba `leagueRoundDate()` (0 = ese sábado, -1 = viernes,
      // +1 = domingo, -3 = miércoles de esa misma semana). El algoritmo de
      // Calendar.js NUNCA tiene una franja/hora hardcodeada: todo sale de
      // aquí, para poder añadir otras competiciones (Europa, Supercopa) sin
      // tocar la lógica de asignación — solo un `scheduleProfile` nuevo.
      scheduleProfiles: {
        '1ª': {
          // Fin de semana predominante, con algún viernes ocasional (peso
          // bajo) — DESIGN.md 3.3.1: "viernes ocasional/sábado/domingo
          // predominante".
          weekendSlots: [
            { dayOffset: -1, hour: 21, minute: 0, weight: 1 }, // viernes noche (ocasional)
            { dayOffset: 0, hour: 17, minute: 0, weight: 3 }, // sábado tarde
            { dayOffset: 0, hour: 19, minute: 0, weight: 3 }, // sábado tarde-noche
            { dayOffset: 0, hour: 21, minute: 0, weight: 2 }, // sábado noche
            { dayOffset: 1, hour: 12, minute: 30, weight: 2 }, // domingo mediodía
            { dayOffset: 1, hour: 17, minute: 0, weight: 3 }, // domingo tarde
            { dayOffset: 1, hour: 19, minute: 0, weight: 2 }, // domingo tarde-noche
          ],
          // Jornada entre semana ocasional (DESIGN.md 3.3.1): 1 de cada
          // `everyNRounds` jornadas de liga regular cae en miércoles en vez
          // de fin de semana — decisión de partida, documentada en
          // DESIGN.md, no una cifra real de calendario ACB.
          midweek: {
            dayOffset: -3, // miércoles de la semana de ese sábado ancla
            slots: [
              { hour: 20, minute: 30, weight: 1 },
              { hour: 21, minute: 0, weight: 1 },
            ],
            everyNRounds: 8,
          },
          // Jornada 34 (última): horario ÚNICO para toda la división
          // (DESIGN.md 3.3.1) — nadie puede conocer resultados con
          // implicaciones clasificatorias antes de que acabe su propio
          // partido.
          lastRoundSlot: { dayOffset: 0, hour: 18, minute: 0 },
        },
        '2ª': {
          // Perfil algo más abierto que 1ª (DESIGN.md 3.3.1): viernes
          // noche con más peso, mediodías de sábado/domingo habituales.
          weekendSlots: [
            { dayOffset: -1, hour: 20, minute: 30, weight: 2 }, // viernes noche
            { dayOffset: 0, hour: 12, minute: 0, weight: 1 }, // sábado mediodía
            { dayOffset: 0, hour: 17, minute: 0, weight: 2 }, // sábado tarde
            { dayOffset: 0, hour: 19, minute: 0, weight: 2 }, // sábado tarde-noche
            { dayOffset: 1, hour: 12, minute: 0, weight: 2 }, // domingo mediodía
            { dayOffset: 1, hour: 17, minute: 0, weight: 2 }, // domingo tarde
          ],
          midweek: {
            dayOffset: -3,
            slots: [
              { hour: 20, minute: 0, weight: 1 },
              { hour: 20, minute: 30, weight: 1 },
            ],
            everyNRounds: 8,
          },
          lastRoundSlot: { dayOffset: 1, hour: 12, minute: 0 },
        },
      },

      // Copa/Playoffs/Ascenso (DESIGN.md 3.3.2/3.3.3): un único horario de
      // "prime time" para todos los partidos de eliminatoria — Bracket.js
      // no expone a su `dateResolver` qué Series concreta está pidiendo la
      // fecha (todas las series de una misma ronda comparten resolvedor,
      // ver comentario en Bracket.buildRound), así que no hay forma de dar
      // variedad horaria ENTRE series simultáneas sin tocar Bracket.js —
      // fuera de alcance de esta entrega (ver CHANGELOG). Sí hay variedad
      // de FECHA entre partidos/rondas (seriesGameGapDays/seriesRoundGapDays
      // ya existentes), solo la hora del día es fija.
      knockoutKickoff: { hour: 21, minute: 0 },
    },

    // --- CAL-2 (DESIGN.md 3.5): umbrales de las categorías de Noticias que
    // sí tienen un dato real objetivo detrás (Events.js). Nunca se
    // duplica aquí el umbral de muestra táctica: eso sigue viviendo en
    // `tactics.telemetry.minReliablePossessions` (más abajo), reutilizado
    // literalmente por `Events.buildTacticalTrendNewsEvent`.
    news: {
      // Valoración FIBA/ACB mínima para considerar una actuación individual
      // "destacada" (DESIGN.md 3.5) — de partida, sin calibrar con
      // playtesting real (una gran actuación real suele rondar 25-30+).
      bigPerformanceMinValoracion: 25,
      // Racha mínima de resultados consecutivos (mismo signo) para generar
      // noticia de racha.
      minStreakLength: 3,
      // "Sorpresa" (DESIGN.md 3.5): diferencia mínima de reputación
      // deportiva (`team.reputation.sporting`, escala 0-100, 6.2.1) Y de
      // posición en la clasificación ANTES del partido entre ganador y
      // perdedor para considerarlo sorpresa — deben cumplirse las dos.
      upsetReputationGapMin: 15,
      upsetStandingsGapMin: 6,
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
        // en Bloque A).
        heightAxis1: { primary: 'penalize' },
      },

      // 2. Tiro de media distancia — DESIGN.md 7.6.2
      midRangeShot: {
        method: 'subtract',
        intercept: 0.39,
        sensitivity: 0.018,
        primary: { midRangeShot: 0.5, pressureDecisionMaking: 0.25, gameVision: 0.25 },
        secondary: { perimeterDefense: 0.7, anticipation: 0.3 },
        // 7.6.2 dice explícitamente "sin modificador de Eje 1" (a diferencia
        // del Triple) — sin heightAxis en esta acción tras retirarse el Eje 2
        // (mini-EPIC POS, ver DESIGN.md 7.4).
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
      // El antiguo "Eje 2 sobre el atacante" (7.6.6) se retiró (mini-EPIC
      // POS, ver DESIGN.md 7.4) — sin heightAxis en esta acción.
      turnover: {
        method: 'ratio',
        favors: 'secondary', // ver MatchEngine: la probabilidad calculada es la de PÉRDIDA
        baseProbability: 0.13,
        primary: { ballHandling: 0.35, gameVision: 0.25, passing: 0.2, balance: 0.2 },
        secondary: { stealing: 0.45, perimeterDefense: 0.35, aggressiveness: 0.2 },
      },

      // 7. Robo de balón — DESIGN.md 7.6.7
      // Sub-tirada que solo se resuelve SI la acción 6 ya determinó que hay
      // pérdida: decide si se acredita como robo (defensor) o pérdida
      // genérica (sin robo). primary: defensor que intenta robar; secondary:
      // manejador que resiste. Sin `baseProbability`: dado que YA hay
      // pérdida, repartir si fue "robo" o "genérica" sí es razonablemente
      // 50/50 antes de mirar atributos, así que se usa el cociente crudo.
      // 7.4: Eje 1 (envergadura, alcance) sobre quien intenta robar
      // (`primary`) — el antiguo Eje 2 (altura/peso penaliza reacción) se
      // retiró (mini-EPIC POS, ver DESIGN.md 7.4).
      steal: {
        method: 'ratio',
        favors: 'primary', // probabilidad de que se acredite como ROBO
        primary: { stealing: 0.4, anticipation: 0.25, perimeterDefense: 0.2, workRate: 0.15 },
        secondary: { ballHandling: 0.6, gameVision: 0.4 },
        heightAxis1: { primary: 'benefit' },
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
        // secondary: añade `anticipation` (mini-EPIC POS, "leer de dónde
        // viene el rebote" es tan parte de rebotear bien como el salto puro)
        // redistribuyendo pesos con defensiveRebound/jumping/positioning
        // para seguir sumando 1 — cifras de partida, no calibradas.
        secondary: {
          defensiveRebound: 0.45, jumping: 0.25, positioning: 0.15, anticipation: 0.15,
        },
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
        // magnitud que emergencyVersatility.basePenalty más abajo) aplicada
        // al defensor cuando la lectura es "pequeña ventaja": "defensor
        // llega tarde" (7.12.4) se traduce como un contexto de penalización
        // adicional sobre el MISMO mecanismo ya existente
        // (computeMixRating/penalty), no un canal paralelo. Revisión
        // mini-EPIC POS: se combina con la penalización de polivalencia de
        // emergencia (si la hay) sumándose a su `responsibilityPenalty` —
        // es una penalización de lectura/posicionamiento del defensor
        // "recuperándose", misma naturaleza que esa categoría (ver
        // MatchEngine, combinación en el punto donde se calcula
        // shotDefenderPenalty).
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
        // TAC-6 (7.12.7/7.12.22): `rigidity` se añade a los ejes de
        // identidad por defecto — TAC-2/TAC-3 lo dejaron declarado en
        // DESIGN.md pero SIN campo real en `identity` (el eje no existía
        // ni en `TacticalProfile` ni aquí, no solo "sin efecto en el
        // motor"). 50 = punto neutro (ni Rigidez ni Read & React puro),
        // mismo criterio de neutralidad que el resto de ejes de
        // `defaults`. 0 = Read & React total, 100 = Rigidez total — ver
        // `Tactics.computeTacticalExecution`, único consumidor real por
        // ahora (7.12.34: primera conexión de este eje tras dos entregas
        // aplazándolo).
        defaults: { pace: 50, earlyOffense: 50, ballMovement: 50, pickAndRollUsage: 50, rigidity: 50 },
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
          // roleFit (revisión mini-EPIC POS, DESIGN.md 7.12.9): la mezcla de
          // atributos del rol (mixScore) YA ES la base del score — la
          // competencia posicional deja de sumarse ponderada (permitía que
          // un jugador con atributos neutros pero posición natural obtuviera
          // un roleFit artificialmente alto) y pasa a actuar solo como techo
          // con penalización acotada por debajo del umbral. Umbral de
          // competencia "funcional o mejor" — referencia directa al mismo
          // número de config.positions.competenceThresholds.functionalMax,
          // nunca duplicado.
          positionShortfallThreshold: FUNCTIONAL_COMPETENCE_MAX,
          // Tope pequeño (sobre 20) de la penalización cuando la mejor
          // posición preferente del rol queda por debajo del umbral — nunca
          // puede hundir el score entero, solo matizarlo.
          positionShortfallMaxPenalty: 4,
          // Exponente de la curva no lineal — mismo valor que
          // config.positions.competencePenaltyExponent (constante
          // COMPETENCE_PENALTY_EXPONENT compartida arriba, nunca duplicado
          // como número suelto).
          positionShortfallExponent: COMPETENCE_PENALTY_EXPONENT,
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
        // --- DESIGN.md 7.12.28 (TAC-7, punto 5): Transition Offense/POA
        // Defense, pendientes desde TAC-2/TAC-4 por falta de base sólida.
        // POA Defense reutiliza LITERALMENTE `roles.defensiveMix.poaStopper`
        // (arriba) en vez de una mezcla nueva — es exactamente lo que ese
        // rol ya mide. Transition Offense es mezcla nueva mínima (mismo
        // criterio heurístico que el resto de `lineupRatings`): velocidad
        // real en el contraataque (topSpeed/acceleration, ya usada en
        // `fastBreak`/`transitionDefense` para el lado contrario) + Visión
        // de Juego para la decisión de pase de salida + Bandeja para
        // finalizar. Ambas son valoraciones de APTITUD de plantilla (se
        // recalculan al cambiar un jugador, 7.12.28), no telemetría de
        // partidos jugados — la telemetría real de transición (PPP/
        // frecuencia) vive en `tacticsTelemetry`, ver Tactics.js.
        transitionOffenseMix: { acceleration: 0.35, topSpeed: 0.25, gameVision: 0.2, layup: 0.2 },
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

      // --- DESIGN.md 7.12.22 (TAC-6): Familiaridad Táctica ---
      // "No se cierra todavía la curva matemática" (frase literal de
      // 7.12.22) — estos valores son un mecanismo de PARTIDA simple y
      // explicable (rendimientos decrecientes hacia un techo de 100, sin
      // curva cerrada validada), no cifras calibradas. Pendiente de
      // calibración/decisión explícita (7.12.34).
      familiarity: {
        // Valor inicial (0-100) de `offensiveSystem`/`defensiveSystem` y de
        // cada entrada de `byPlayFamily`/`byCoverage` en un TacticalProfile
        // recién creado — ni cero total ni máxima (pedido explícito de esta
        // entrega): una plantilla recién empezada no domina el sistema,
        // pero tampoco parte de cero absoluto (ya hubo algo de pretemporada
        // implícita antes del primer partido simulado).
        default: 55,
        // Valor inicial la PRIMERA vez que un jugador recibe un
        // `roleAssignment` en una `TacticalProfile` (antes de disputar
        // ningún partido con ese rol) — mismo criterio "ni cero ni máximo"
        // que `default`, pero deliberadamente más bajo: la familiaridad
        // INDIVIDUAL de rol es más específica que la de sistema/familia, se
        // empieza a aprender jugando el rol, no antes.
        roleDefaultInitial: 35,
        // Valor al que se RESETEA la familiaridad individual de un jugador
        // cuando su `roleAssignment` CAMBIA de un partido a otro (7.12.22:
        // "cambios frecuentes de rol" hacen caer la familiaridad) — mucho
        // más bajo que `roleDefaultInitial`: un cambio de rol a mitad de
        // temporada es peor que empezar de cero con la plantilla nueva
        // (arrastra hábitos del rol anterior que hay que desaprender).
        roleChangeResetValue: 15,
        // Incremento base (puntos de 0-100) por CADA posesión resuelta con
        // esa familia de jugada/cobertura/rol — antes de aplicar
        // rendimientos decrecientes (`diminishingExponent`) y el freno de
        // complejidad (`complexitySlowdown`). Punto de partida: con uso
        // repetido y sin complejidad, tarda decenas de posesiones en
        // acercarse al techo de 100, no partidos enteros ni un solo uso.
        baseGrowthPerUse: 2.2,
        // Rendimientos decrecientes (7.12.22: "no se cierra la curva
        // matemática", pero SÍ exige que no crezca indefinido sin límite):
        // growth *= (1 - nivel/100)^diminishingExponent — a nivel 0 el
        // exponente no importa (factor 1); cerca de 100 el incremento real
        // tiende a 0, así que el nivel se ESTABILIZA cerca del techo en vez
        // de superarlo, sin necesitar un tope duro aparte.
        diminishingExponent: 1.4,
        // Freno de Complejidad (7.12.10 `PlayDefinition.complexity`, 0-100):
        // una jugada más compleja debe tardar más en alcanzar familiaridad
        // alta que una simple con el mismo número de usos — se aplica como
        // un factor que RALENTIZA el incremento (nunca un techo aparte, que
        // ya cubre `diminishingExponent`). `minComplexityFactor` evita que
        // la jugada más compleja del catálogo (Spain P&R, complexity=70)
        // deje de aprenderse por completo.
        complexitySlowdown: 0.6,
        minComplexityFactor: 0.3,
        // Complejidad NOMINAL de cada cobertura defensiva (7.12.16 no da una
        // cifra de complejidad por cobertura como sí hace `PlayDefinition`
        // para el playbook ofensivo — decisión de encaje propia de esta
        // entrega, señalada explícitamente): Drop/Under son coberturas de
        // base, un cambio (Switch) exige más coordinación, y Hedge/Blitz
        // (doblar el balón y recuperar el rotación) son las más exigentes,
        // mismo agrupamiento "Hedge/Blitz" que ya usa 7.12.16.
        coverageComplexity: { drop: 15, under: 15, switch: 45, hedge: 65, blitz: 65 },
        // Fracción del incremento de familia/cobertura que ADEMÁS suma
        // (atenuada) a la familiaridad de SISTEMA global (offensiveSystem/
        // defensiveSystem) — la misma posesión alimenta las dos capas a la
        // vez, a ritmo distinto (7.12.22 no dice que sean independientes,
        // solo que son capas MÍNIMAS distintas de un mismo estado).
        systemGrowthShare: 0.55,
      },

      // --- DESIGN.md 7.12.22 (TAC-6): `tacticalExecution` ---
      // Rango 0-1 (elección de esta entrega, documentada: mismo rango que
      // `advantageScore`/probabilidades del motor, para poder combinarse
      // directamente con `shotAdjustment`/multiplicadores existentes sin
      // reescalar). "No se cierra la curva matemática" aplica también aquí
      // — pesos/exponentes de partida, no cifras calibradas (7.12.34).
      tacticalExecution: {
        // Peso de cada componente en la mezcla final (no tienen que sumar
        // exactamente 1: `complexityPenaltyWeight` se RESTA aparte, el
        // resto de pesos sí suman 1 para que el máximo teórico sea ~1).
        familiarityWeight: 0.45,
        attributeWeight: 0.30,
        energyWeight: 0.15,
        experienceWeight: 0.10,
        // Mezcla de atributos "de ejecución colectiva" (7.12.22: TrabajoEnEquipo,
        // Concentración, Posicionamiento, VisiónJuego/DecisiónBajoPresión
        // para lecturas) — TrabajoEnEquipo entra aquí precisamente por la
        // excepción de 7.12.18 ("participa en tacticalExecution... NO
        // aumenta la probabilidad técnica de tiro/robo/tapón/rebote por sí
        // solo").
        attributeMix: {
          teamwork: 0.3, concentration: 0.25, positioning: 0.2, gameVision: 0.15, pressureDecisionMaking: 0.1,
        },
        // --- Eje Rigidez↔Read & React (7.12.7), primera conexión real ---
        // Un equipo más Rigidez (rigidity→100) alcanza un techo de
        // `tacticalExecution` MÁS ALTO con familiaridad alta, pero un
        // exponente >1 castiga con más dureza la familiaridad baja (sistema
        // estructurado que se desmorona sin entrenarlo). Un equipo más Read
        // & React (rigidity→0) tiene un techo algo MÁS BAJO (nunca ejecuta
        // tan perfecto como un sistema muy trabajado) pero un exponente <1
        // "levanta" el resultado con familiaridad baja (menos dependiente
        // de un guion fijo, se adapta mejor sin rodaje). rigidity=50
        // (neutro, valor por defecto de `identity`) interpola a medio
        // camino entre ambos pares — reproduce un punto intermedio
        // razonable, no un caso especial.
        rigidityCeiling: 0.95,
        readAndReactCeiling: 0.85,
        rigidityExponent: 1.6,
        readAndReactExponent: 0.65,
        // Penalización DIRECTA (no vía familiaridad) de la Complejidad
        // requerida de la jugada en curso (0-100) — 7.12.22 la cruza como
        // factor propio, no solo como freno de la curva de familiarity.
        complexityPenaltyWeight: 0.12,
        // --- Errores reconocibles (7.12.22) con punto de enganche real ---
        // "Lectura incorrecta"/"pérdida de continuidad": probabilidad de
        // que la posesión DEGRADE su lectura (read6) una categoría cuando
        // tacticalExecution es bajo — 0 con tacticalExecution=1 (ejecución
        // perfecta, nunca empeora la lectura por su cuenta), máximo con
        // tacticalExecution=0.
        misreadMaxProbability: 0.25,
        // "Pérdida ofensiva de sistema": multiplicador sobre rollTurnover()
        // YA EXISTENTE (nunca un resolver nuevo, mismo patrón que
        // `press.turnoverBoost`) cuando tacticalExecution es bajo — 1 (sin
        // efecto) con tacticalExecution=1, hasta `turnoverMaxMultiplier`
        // con tacticalExecution=0.
        turnoverMaxMultiplier: 1.4,
        // "Ayuda defensiva tarde"/"error de switch"/"dos defensores
        // ayudando al mismo jugador": probabilidad de que la SELECCIÓN de
        // ayudante/defensor de cobertura de la DEFENSA (pickDoubleTeamHelper/
        // screenerDefender) se sustituya por el candidato MENOS preparado
        // disponible (rotación tardía/mal ejecutada) cuando el
        // tacticalExecution de la defensa es bajo.
        defensiveMisexecutionMaxProbability: 0.2,
      },

      // --- DESIGN.md 7.12.27 (TAC-7): Data Hub táctico — umbrales de
      // "muestra pequeña" para la advertencia obligatoria de 7.12.27 ("no
      // presentar 2 posesiones, 1.50 PPP como una verdad táctica estable").
      // Cifras propias, pendientes de calibración/decisión (7.12.34): un
      // puñado de partidos/posesiones es un punto de partida razonable, no
      // un umbral estadístico riguroso (no hay intervalo de confianza real
      // detrás, solo "hay muy poco que mirar todavía").
      telemetry: {
        minReliableGames: 3,
        minReliablePossessions: 15,
      },

      // --- DESIGN.md 7.12.25 (TAC-7, alcance acotado): Construcción de
      // identidad CPU — pesos de la heurística de Tactics.buildCpuTacticalIdentity.
      // Cifras propias, pendientes de calibración (7.12.34): fijan la
      // DIRECCIÓN (qué señales de plantilla mueven qué parte del perfil),
      // no una calibración validada por simulación masiva.
      cpuIdentity: {
        // Umbral (escala roleFit 1-20) por encima del cual se considera que
        // la plantilla tiene un especialista REAL en ese rol (no solo "el
        // menos malo de los cinco") — usado para decidir spacing/playType/
        // cobertura por presencia/ausencia de arquetipo, no por comparación
        // relativa entre plantillas (una plantilla floja no debe leerse como
        // "todo lo contrario" solo por ser la peor de las dos). 15 y no un
        // valor más bajo: `roleFit` combina un 30% de competencia posicional
        // que por sí sola ya empuja a ~13 a CUALQUIER jugador con atributos
        // neutros en su posición "natural" (verificado con el script de
        // invariantes de esta entrega) — el umbral tiene que superar ese
        // suelo para distinguir un especialista real de "alguien que ocupa
        // esa posición sin más".
        specialistThreshold: 15,
        // Umbral (escala 1-20 pura, sin blend de posición — usado solo
        // contra medias de atributo físico directas, ej. movilidad del
        // protector de aro, nunca contra un roleFit ya blendeado con
        // posición) por debajo del cual una cualidad física se considera
        // ausente/pobre.
        weakThreshold: 9,
        // Sesgo de identidad por `clubDNA` (6.2.8) — NUNCA una orden
        // obligatoria (7.12.25, cita literal), un empujón pequeño y acotado
        // sobre la dirección ya decidida por la plantilla real. Mismo
        // criterio de mapeo por texto exacto que `tempo.dnaBias` (TAC-1);
        // un ADN de club no listado aquí no aplica ningún sesgo (0 en los
        // 3 ejes). `pace`/`pickAndRollUsage` son puntos (0-100) sumados
        // directo al eje de identidad; `pressActive` es una probabilidad
        // adicional de activar press por defecto.
        dnaBias: {
          'Ritmo alto': { pace: 12, pickAndRollUsage: 5, pressActive: 0.15 },
          'Defensa': { pace: -5, pickAndRollUsage: 0, pressActive: 0.2 },
          'Veteranía': { pace: -10, pickAndRollUsage: -5, pressActive: -0.1 },
          'Cantera': { pace: 5, pickAndRollUsage: 5, pressActive: 0.05 },
        },
      },

      // --- Sesión de consolidación: conversión de puntuación (1-20) a
      // estrellas (1-5) de `Tactics.starsFromScore20`, usada por `roleFit`
      // y por las valoraciones derivadas de quinteto (7.12.28). Antes vivía
      // hardcodeada como un escalón único cada 4 puntos
      // (`Math.ceil(score / 4)`), que agrupaba 17-20 en el mismo 5★ sin
      // distinguir "muy competente" de "el máximo posible" — una de las dos
      // causas confirmadas por auditoría de la saturación de 5★ en
      // `roleFit` (junto a los patrones de posición planos, ver
      // scripts/regenerate-real-positions.js). Decisión YA TOMADA por
      // Dennis (no una calibración propia de esta sesión): 5 tramos
      // desiguales, punto de partida calibrable como el resto de
      // `config.tactics` — "puntos de partida con dirección verificada, no
      // cifras cerradas" (DESIGN.md 7.12.31/7.12.34, tabla completa en
      // DESIGN.md 7.12.9). `oneStarMax`/`twoStarMax`/`threeStarMax`/
      // `fourStarMax` son los límites SUPERIORES (inclusive) de cada
      // escalón; cualquier puntuación por encima de `fourStarMax` es 5★.
      starRating: {
        thresholds: {
          oneStarMax: 6,
          twoStarMax: 10,
          threeStarMax: 14,
          fourStarMax: 17,
        },
      },
    },

    // --- LIFE-1 (DESIGN.md 9): Carrera, TMB, Potencial, desarrollo y
    // declive — ver src/core/PlayerDevelopment.js, que es quien consume
    // toda esta sección. Aquí solo viven los coeficientes/curvas (7.2:
    // "el CONFIG es una entidad propia"), nunca lógica.
    playerDevelopment: {
      // Días reales entre cada "tick" de desarrollo — PlayerDevelopment
      // procesa internamente en bloques de 7 días exactos, nunca eventos de
      // Calendar propios (sección 12 del prompt de esta sesión).
      tickDays: 7,

      // --- TMB Rating (Current Ability, escala 1-200) ---
      tmb: {
        min: 1,
        max: 200,
        // Media ponderada de atributos efectivos que se considera "élite"
        // (mapea a TMB≈200 antes de clamp) — punto de partida, pendiente de
        // calibración por playtesting real de la liga completa.
        eliteWeightedAverage: 19.0,
        // Pesos de relevancia por atributo dentro de la posición nominal
        // (sección 4.2): un atributo ausente del perfil de esa posición en
        // POSITION_PROFILES (playerGenerator.js) recibe `relevanceFloor`
        // (nunca 0, para que ningún atributo mejore "gratis" sin consumir
        // capacidad); el resto se normaliza dentro del rango de deltas que
        // REALMENTE aparece en todo el catálogo POSITION_PROFILES (mismo
        // rango global para las 5 posiciones, para que un delta idéntico
        // produzca siempre el mismo peso sea cual sea la posición donde
        // aparece) — ver PlayerDevelopment.getPositionWeights().
        relevanceFloor: 0.25,
        relevanceCeiling: 1.00,
      },

      // --- Professionalism/Ambition -> mindsetFactor (sección 7) ---
      // Mapeo lineal 1-20 -> [at1, at20], media aritmética 50/50 entre
      // ambos factores. `learningRateFactor` no viene dado con cifras
      // concretas por el prompt de esta sesión (solo profesionalidad/
      // ambición las traen) — se usa el MISMO mapeo lineal por consistencia
      // y sencillez, como punto de partida propio pendiente de calibración,
      // documentado explícitamente como decisión de esta sesión.
      mindset: {
        professionalismFactor: { at1: 0.75, at20: 1.25 },
        ambitionFactor: { at1: 0.75, at20: 1.25 },
        learningRateFactor: { at1: 0.75, at20: 1.25 },
      },

      // learningPersistence (1-20) amortigua el DECLIVE (nunca el
      // crecimiento) de las categorías technical/cognitive/social
      // exclusivamente (sección 21) — mapeo lineal a un multiplicador
      // acotado sobre declineFactor: persistence=1 -> sin amortiguación
      // (1.0), persistence=20 -> declive reducido un 40% (0.6) en esas 3
      // categorías. Explosive/strength/endurance nunca lo usan.
      learningPersistenceDeclineDamping: { at1: 1.0, at20: 0.6 },

      // --- Coeficientes base de crecimiento/declive (sección 18/21) ---
      // Orden de magnitud: fracción de punto de atributo por tick (7 días)
      // en condiciones medias — puntos de partida sin calibrar por
      // simulación masiva de varias temporadas (sección 30), ajustables
      // solo aquí sin tocar la fórmula.
      baseGrowthRate: 0.075,
      // Calibrado por script Node dedicado (scripts/test-life1.js): con
      // 0.055 un veterano de 38 años con potencial casi agotado podía
      // seguir mostrando un TMB agregado ligerísimamente AL ALZA (el
      // crecimiento residual de technical/cognitive/social, que a esa edad
      // sigue teniendo factor >0 en las curvas de la sección 14, superaba
      // al declive de explosive/strength/endurance) — contradice la
      // calibración esperada de la sección 30 ("38+: declive agregado claro
      // en la mayoría"). Subido para que el declive físico domine con
      // claridad a partir de esa edad.
      baseDeclineRate: 0.09,

      // --- Ruido determinista acotado (sección 24) ---
      noise: {
        // Rango de inicialización de residuales legacy (sección 9): ±0.45.
        residualInitSpread: 0.45,
        // ±10% sobre growthDelta (sección 18) — declineDelta no lleva ruido
        // (sección 21 no lo pide, y así declive queda 100% determinista a
        // partir de edad/curvas, más fácil de verificar en tests).
        growthNoiseSpread: 0.10,
      },

      // --- Exposición competitiva (sección 19) ---
      // Ventana deslizante de matchExposures realmente consumida en cada
      // tick; los registros más antiguos que la ventana se descartan (no
      // crecen indefinidamente). Función cóncava elegida: raíz cuadrada de
      // los minutos SEMANALES ponderados por división sobre
      // `referenceWeeklyMinutes` — crece rápido entre 0 y ~15 min, se
      // aplana progresivamente después, sin tope duro (sección 19).
      exposure: {
        windowDays: 30,
        referenceWeeklyMinutes: 120,
        // Estímulo base incluso sin minutos (entrenamiento diario fuera de
        // partido) — el salto 0->12min sigue siendo claro (invariante 30)
        // porque el resto de la fórmula multiplica por un factor bastante
        // mayor que este suelo.
        zeroMinutesFactor: 0.15,
        // Peso moderado por división (invariante 31: "de forma moderada",
        // nunca un multiplicador extremo) — se aplica a los minutos antes
        // de la raíz cuadrada.
        divisionWeight: { '1ª': 1.0, '2ª': 0.7 },
      },

      // --- Instalaciones del club (sección 20) ---
      // Reutiliza `team.facilities.trainingCenter` (Team.js, DESIGN.md
      // 6.2.2, escala 1-20 ya existente) — no se crea ningún campo nuevo.
      // Rango de efecto moderado: nivel 1 -> 0.9, nivel 20 -> 1.1.
      facility: {
        key: 'trainingCenter',
        minLevel: 1,
        maxLevel: 20,
        minFactor: 0.9,
        maxFactor: 1.1,
        // Nivel neutro usado cuando se procesa un jugador SIN equipo real
        // (ej. herramientas de modo prueba) — mismo valor por defecto que
        // usa Team.buildFacilities() para cualquier instalación (10).
        neutralLevelWhenNoTeam: 10,
      },

      // Hook explícito para el futuro sistema de Staff (sección 20-bis) —
      // multiplicador neutro (1 = sin efecto) hasta que ese módulo exista.
      // Un futuro Staff sustituirá este valor fijo por un cálculo real; NO
      // implementar Staff en LIFE-1.
      staffFactor: 1.0,

      // --- Longevidad individual (sección 15) ---
      agingOffset: {
        min: -3,
        max: 6,
      },

      // --- Clasificación de atributos mutables por curva (sección 16) ---
      attributeCategories: {
        explosive: ['topSpeed', 'acceleration', 'jumping', 'agility'],
        strength: ['strength', 'balance'],
        endurance: ['stamina', 'recovery'],
        technical: [
          'outsideShot', 'midRangeShot', 'insideShot', 'freeThrows', 'layup',
          'passing', 'ballHandling', 'offensiveRebound', 'defensiveRebound',
          'blocking', 'stealing', 'perimeterDefense', 'interiorDefense',
        ],
        cognitive: [
          'gameVision', 'pressureDecisionMaking', 'concentration',
          'consistency', 'anticipation', 'positioning',
        ],
        social: ['leadership', 'teamwork'],
      },

      // --- Trainability por atributo (sección 17) — cubre exactamente los
      // 29 atributos mutables de la sección 8 (verificado en
      // PlayerDevelopment.js al cargar, ver ASSERT_TRAINABILITY_COVERAGE).
      trainability: {
        outsideShot: 1.00,
        midRangeShot: 1.00,
        insideShot: 0.95,
        freeThrows: 0.85,
        layup: 0.95,
        passing: 0.95,
        ballHandling: 0.95,
        offensiveRebound: 0.80,
        defensiveRebound: 0.80,
        blocking: 0.75,
        stealing: 0.80,
        perimeterDefense: 0.85,
        interiorDefense: 0.80,
        topSpeed: 0.70,
        acceleration: 0.70,
        jumping: 0.65,
        strength: 0.90,
        agility: 0.70,
        balance: 0.75,
        stamina: 0.90,
        recovery: 0.80,
        gameVision: 0.85,
        pressureDecisionMaking: 0.80,
        concentration: 0.85,
        leadership: 0.70,
        teamwork: 0.85,
        consistency: 0.75,
        anticipation: 0.80,
        positioning: 0.90,
      },

      // --- Curvas de aprendizaje positivo (sección 14) — puntos [edad,
      // factor], interpolación lineal; fuera de rango se usa el extremo. ---
      growthCurves: {
        explosive: [[14, 1.00], [16, 1.20], [19, 1.25], [22, 1.00], [24, 0.55], [27, 0.20], [30, 0.05], [34, 0.00]],
        strength: [[14, 0.55], [16, 0.75], [20, 1.00], [24, 1.05], [28, 0.65], [32, 0.25], [35, 0.08], [38, 0.00]],
        endurance: [[14, 0.65], [16, 0.90], [20, 1.05], [24, 0.95], [28, 0.55], [32, 0.20], [35, 0.08], [38, 0.00]],
        technical: [[14, 0.70], [16, 0.95], [19, 1.15], [23, 1.10], [27, 0.85], [30, 0.55], [33, 0.30], [36, 0.12], [40, 0.04]],
        cognitive: [[14, 0.45], [16, 0.65], [20, 0.90], [24, 1.05], [28, 1.00], [31, 0.75], [34, 0.45], [37, 0.20], [40, 0.08]],
        social: [[14, 0.20], [16, 0.35], [20, 0.55], [24, 0.80], [28, 1.00], [32, 0.85], [36, 0.55], [40, 0.25]],
      },

      // --- Curvas de declive (sección 15) — se consultan con
      // effectiveDeclineAge (edad real - agingOffsetYears), nunca con la
      // edad real directa. Representan tendencia POBLACIONAL base, nunca
      // un cliff igual para todos. ---
      declineCurves: {
        explosive: [[24, 0], [27, 0.10], [29, 0.35], [31, 0.70], [33, 1.00], [35, 1.35], [38, 1.70], [41, 2.00]],
        strength: [[28, 0], [31, 0.10], [33, 0.30], [35, 0.60], [38, 1.00], [41, 1.30]],
        endurance: [[27, 0], [30, 0.15], [32, 0.40], [34, 0.75], [37, 1.20], [40, 1.50]],
        technical: [[33, 0], [36, 0.05], [38, 0.15], [40, 0.35], [43, 0.70]],
        cognitive: [[36, 0], [39, 0.05], [42, 0.15]],
        social: [[14, 0], [50, 0]],
      },
    },

    // --- LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2): Entrenamiento,
    // desarrollo dirigido y aprendizaje táctico/posicional. Todos los
    // coeficientes que usan Training.js/TrainingAI.js viven aquí — nada
    // hardcodeado en esos ficheros, mismo criterio que playerDevelopment.
    training: {
      // --- Sección 7: densidad competitiva semanal (nº de partidos
      // OFICIALES del equipo, liga+copa+playoff+ascenso, en la ventana de
      // 7 días de un tick) -> cuánto entrenamiento cabe esa semana. Para 4
      // o más se reutiliza el tramo de 4.
      matchDensity: {
        0: { opportunityFactor: 1.10, loadUnits: 4.0 },
        1: { opportunityFactor: 1.00, loadUnits: 3.0 },
        2: { opportunityFactor: 0.68, loadUnits: 1.75 },
        3: { opportunityFactor: 0.42, loadUnits: 0.75 },
        4: { opportunityFactor: 0.25, loadUnits: 0.25 },
      },

      // --- Sección 8/9: intensidad -> desarrollo vs Energy/Recovery ---
      intensity: {
        recovery: {
          developmentMultiplier: 0.50, recoveryMultiplier: 1.30, energyCostPerLoadUnit: 0.15, tacticalMultiplier: 0.70,
        },
        light: {
          developmentMultiplier: 0.82, recoveryMultiplier: 1.12, energyCostPerLoadUnit: 0.50, tacticalMultiplier: 0.90,
        },
        normal: {
          developmentMultiplier: 1.00, recoveryMultiplier: 1.00, energyCostPerLoadUnit: 1.00, tacticalMultiplier: 1.00,
        },
        high: {
          developmentMultiplier: 1.18, recoveryMultiplier: 0.82, energyCostPerLoadUnit: 1.70, tacticalMultiplier: 1.10,
        },
      },

      // Referencia de `opportunityShare` (sección 8: loadUnits/4, clamp 0-1)
      // usada para no aplicar el recoveryMultiplier completo cuando la
      // densidad competitiva deja casi cero entrenamiento real.
      recoveryOpportunityReference: 4.0,

      // --- Sección 9: coste de Energy por foco individual (además del
      // coste base loadUnits*energyCostPerLoadUnit de la intensidad) ---
      individualFocusEnergyCostPerLoadUnit: {
        attribute: 0.10, position: 0.15, role: 0.10, none: 0,
      },

      // --- Sección 10: readinessFactorByEnergy (interpolado, sección 14
      // reutiliza el mismo estilo de curva [energy, factor] que
      // playerDevelopment.growthCurves) — modula SOLO el estímulo
      // POSITIVO de entrenamiento, nunca el declive.
      readinessFactorByEnergy: [[0, 0.40], [20, 0.55], [40, 0.75], [60, 0.90], [80, 1.00], [100, 1.00]],

      // --- Sección 11: vectores BRUTOS de Team Focus por atributo mutable.
      // `default` es el peso de cualquier atributo mutable no listado en
      // `overrides`; `physical` usa `groupOverrides` (por grupo
      // technical/physical/mental de Player.js) en vez de listar los 29
      // atributos uno a uno, porque la regla de la sección 11 es "todos los
      // Physical mutables 1.25, todos los Technical/Mental mutables 0.85"
      // (una regla de GRUPO, no de atributo individual). Training.js
      // normaliza el vector resultante contra el presupuesto TMB del
      // jugador (PlayerDevelopment.getPositionWeights) para que la media
      // ponderada del estímulo vuelva a 1.00 — estos números son
      // deliberadamente "brutos", nunca el multiplicador final.
      teamFocusVectors: {
        balanced: { default: 1.00, overrides: {} },
        offense: {
          default: 0.90,
          overrides: {
            outsideShot: 1.30, midRangeShot: 1.20, insideShot: 1.15, freeThrows: 1.10, layup: 1.20,
            passing: 1.20, ballHandling: 1.20, offensiveRebound: 1.05, gameVision: 1.15, pressureDecisionMaking: 1.10,
          },
        },
        defense: {
          default: 0.90,
          overrides: {
            defensiveRebound: 1.20, offensiveRebound: 1.05, blocking: 1.20, stealing: 1.20,
            perimeterDefense: 1.25, interiorDefense: 1.25, anticipation: 1.15, positioning: 1.20, concentration: 1.10,
          },
        },
        physical: { default: 0.85, overrides: {}, groupOverrides: { physical: 1.25 } },
      },

      // --- Sección 15: foco individual de atributo ---
      attributeFocus: { targetMultiplier: 1.35 },

      // --- Sección 22: foco individual de rol ---
      roleFocus: { attributeBudgetMultiplier: 0.94 },

      // --- Sección 16/17/18/23: foco/progreso posicional ---
      position: {
        basePositionGainPerTrainingWeek: 0.040,
        attributeBudgetMultiplier: 0.92,
        // Sección 18: entorno de coaching posicional — pesos sobre los
        // mismos mappings 1-20->factor ya usados por facilities/staffContext
        // (computeFacilityFactor/staffRatingToFactor), nunca una fórmula
        // nueva de instalaciones.
        environment: {
          adult: { trainingCenter: 0.40, headCoachDevelopment: 0.40, technicalDevelopment: 0.20 },
          youth: {
            trainingCenter: 0.35, headCoachDevelopment: 0.30, technicalDevelopment: 0.15, youthDevelopment: 0.20,
          },
          youthAgeThreshold: 21,
        },
        // Sección 17: matchRepFactor semanal — saturación exponencial de
        // los minutos reales jugados en la posición target esa semana.
        matchRep: { halfLifeMinutes: 12, floor: 0.85, range: 0.25 },
      },

      // --- Sección 12/20/21/22: entrenamiento táctico colectivo/individual
      // — reutiliza SIEMPRE Tactics.growFamiliarityValue/PLAY_DEFINITIONS
      // (nunca una familiaridad paralela); estos números son la velocidad
      // semanal de Training, propia y separada de config.tactics.familiarity
      // (que sigue rigiendo el aprendizaje POR POSESIÓN jugando partidos).
      tactical: {
        // Sección 12: presupuesto de atributos NO normalizado a 1.00 para
        // el foco Tactical (a cambio del mayor estímulo de familiaridad) —
        // por CATEGORÍA de curva de PlayerDevelopment (technical/physical
        // agrupan explosive+strength+endurance; cognitive/social son las
        // dos categorías en las que LIFE-1 divide el grupo mental).
        attributeBase: {
          technical: 0.82, physical: 0.78, cognitive: 0.95, social: 0.90,
        },
        baseTacticalFamiliarityGainPerWeek: 0.60,
        teamFocusMultiplier: {
          balanced: 0.55,
          offense: { offense: 0.90, defense: 0.25 },
          defense: { offense: 0.25, defense: 0.90 },
          physical: 0.15,
          tactical: 1.80,
        },
        complexityLearningPenaltyMax: 0.35,
        individualRoleFocusMultiplier: 1.75,
        // Rendimientos decrecientes hacia 100 con la MISMA forma que
        // Tactics.js (7.12.22) pero ritmo propio de Training (base rate
        // semanal en vez de por posesión) — se reutiliza el patrón
        // matemático, no la instancia de config.tactics.familiarity.
        diminishingExponent: 1.4,
        offseasonTacticalMultiplier: 0.60,
      },

      // --- Sección 24: offseason — LIFE-1 no dejó ningún
      // "offseasonLearningMultiplier" real (verificado contra HEAD, mismo
      // tipo de desviación que staffContext/stimulusByAttribute en la
      // sección 3-bis: no existía nada que "conservar"). Documentado en el
      // CHANGELOG. El resto de reglas de la sección 24 (intensidad forzada
      // a 'normal', sin coste de Energy persistente, offseasonTacticalMultiplier
      // de arriba) sí se implementan tal cual.

      // --- Sección 26/27: revisión periódica de TrainingAI ---
      cpuReview: {
        collectiveReviewDays: 28,
        individualReviewDays: 56,
        lowEnergyThreshold: 65,
        lowEnergyTopN: 10,
        congestionMatchesWindowDays: 7,
        congestionMatchesThreshold: 2,
        lowFamiliarityThreshold: 55,
        youngHeadroomAgeThreshold: 23,
        youngHeadroomShareThreshold: 0.35,
        highIntensityMinEnergy: 85,
        // Umbral de headroom TMB (potencial - TMB sin cap) considerado
        // "amplio" — DESIGN.md/prompt LIFE-2 no fija una cifra concreta
        // para "margen amplio"; punto de partida razonable en la escala
        // 1-200, pendiente de calibración como el resto de CONFIG.
        headroomAmpleThreshold: 15,
        // "Cobertura pobre" de una posición en la plantilla (sección 26,
        // foco posicional CPU): ningún jugador de la plantilla alcanza
        // este nivel real en esa posición.
        poorPositionCoverageThreshold: 14,
        // "Familiaridad de rol claramente inferior al resto del equipo"
        // (sección 26, foco de rol CPU): diferencia mínima frente a la
        // media de familiaridad de rol del equipo.
        roleFamiliarityGapThreshold: 15,
      },

      // --- Sección 3-bis/18/37: staffContext — construcción NUEVA de
      // LIFE-2 (no heredada de LIFE-1), neutro en 10 mientras no exista
      // Staff real. Separado de `playerDevelopment.staffFactor` (LIFE-1,
      // escalar plano que sigue multiplicando el crecimiento GENERAL de
      // atributos exactamente igual que antes) — nunca se mezclan.
      staffContext: {
        headCoachDevelopment: 10,
        technicalDevelopment: 10,
        youthDevelopment: 10,
      },
    },

    // =====================================================================
    // LIFE-3 (DESIGN.md 9.14): lesiones, carga médica, rehabilitación y
    // vuelta a competir. Toda la lógica vive en src/core/Medical.js — este
    // bloque solo aporta coeficientes/curvas/catálogo, sin números mágicos
    // en el módulo. `enabled=false` reproduce el motor de partido HEAD
    // previo a esta entrega (invariante 33 del prompt de esta sesión).
    // =====================================================================
    medical: {
      enabled: true,

      // --- Sección 3: Durability (1-20, Player.physical.durability) como
      // ÚNICA predisposición basal — no existe un injuryProneness aparte.
      // Interpolación lineal por puntos [durability, factor de incidencia].
      durabilityFactorCurve: [[1, 1.70], [10, 1.00], [20, 0.55]],

      // --- Sección 14: Recovery (1-20, Player.physical.recovery) modula
      // SOLO velocidad de rehabilitación, nunca incidencia.
      recoveryFactorCurve: [[1, 0.90], [20, 1.10]],

      // --- Sección 8: carga individual — dos señales continuas y acotadas,
      // sin ACWR/ratios. `matchLoadPerMinute` convierte minutos reales
      // jugados en unidades de carga (misma unidad que Training.js usa
      // internamente para el coste de Energy semanal, ver
      // Training.computeWeeklyTrainingLoadUnits — Medical.js NUNCA
      // reimplementa intensidad/densidad/foco desde sus nombres, consume
      // esa misma cifra). `referenceWeeklyLoad` calibrado contra una
      // semana típica Balanced/Normal + 1 partido de ~30 min
      // (≈3.0 loadUnits de entrenamiento + ≈1.8 de partido).
      load: {
        matchLoadPerMinute: 0.06,
        referenceWeeklyLoad: 5.0,
        // Ventana de carga reciente/pico (sección 8) — 7 días para la
        // carga absoluta reciente, 3 semanas anteriores para el pico.
        recentWindowDays: 7,
        spikeLookbackWeeks: 3,
        absoluteWeight: 0.35,
        spikeWeight: 0.30,
        maxLoadFactor: 1.55,
        // Historial individual de carga (sección 4, loadHistory): máximo
        // de días de entradas conservadas — nunca histórico de carrera.
        historyRetentionDays: 42,
        // acuteContact solo recibe el 20% del exceso de loadFactor/Energy
        // sobre 1.0 (secciones 8/9) — nunca el efecto completo.
        contactExcessShare: 0.20,
      },

      // --- Sección 9: Energy como señal (no diagnóstico) — interpolación
      // por puntos [energy, factor] para acuteNonContact/overuse.
      energyFactorCurve: [[0, 1.65], [40, 1.45], [55, 1.25], [70, 1.10], [85, 1.00], [100, 1.00]],

      // --- Sección 10: historial/recurrencia — factor por antigüedad desde
      // la fecha de RECUPERACIÓN de la lesión previa relevante. "Misma
      // zona, tipo distinto" aplica solo la mitad del exceso (excess/2).
      // Clamp global aplicado en Medical.js, nunca aquí.
      history: {
        sameTypeCurve: [
          { maxDays: 90, factor: 1.70 },
          { maxDays: 365, factor: 1.40 },
          { maxDays: 730, factor: 1.20 },
          { maxDays: Infinity, factor: 1.05 },
        ],
        sameAreaDifferentTypeShare: 0.5,
        maxHistoryFactor: 1.80,
      },

      // --- Sección 11: Centro Médico + Preparación Física + hook de Staff
      // — medias ponderadas, nunca 5 factores multiplicados entre sí.
      // Mapeos lineales 1-20 -> factor (mismo patrón que
      // PlayerDevelopment.computeFacilityFactor/staffRatingToFactor, pero
      // con sus propios puntos — Medical.js no reutiliza esas instancias
      // porque los rangos/semántica son propios de esta entrega).
      environment: {
        // Prevención médica total (Centro Médico + doctor) — aplica a
        // TODOS los mecanismos, nunca hace riesgo 0 (nivel 1 -> 1.10 peor
        // que neutro, nivel 20 -> 0.90 mejor que neutro).
        medicalPreventionCurve: [[1, 1.10], [20, 0.90]],
        // Preparación física (facility + physicalPreparation staff) — solo
        // acuteNonContact/overuse.
        physicalPreparationCurve: [[1, 1.15], [20, 0.85]],
        // Velocidad de rehabilitación — Centro Médico + physiotherapy.
        rehabSpeedCurve: [[1, 0.85], [20, 1.15]],
        // Peso relativo instalación de club vs hook de staff dentro de cada
        // media ponderada (mismo peso para las 3 medias, decisión simple
        // de esta entrega).
        facilityWeight: 0.6,
        staffWeight: 0.4,
        // Reducción de probabilidad de secuela (sección 27) aportada por
        // el mejor entorno médico posible frente al peor — multiplicador
        // acotado sobre la probabilidad base del catálogo.
        sequelaReductionCurve: [[1, 1.15], [20, 0.75]],
      },

      // Hook neutral de Staff médico (sección 11) — 1-20, default 10,
      // ningún empleado/contrato real todavía.
      staffContext: {
        doctor: 10,
        physiotherapy: 10,
        physicalPreparation: 10,
      },

      // --- Sección 19: hazard base de partido — ancla epidemiológica,
      // antes de modificadores individuales. Convertido a probabilidad por
      // segundo de exposición real (nunca "% fijo por posesión").
      // Calibración real (scripts/smoke-life3.js, 36 equipos/414 jugadores
      // reales, temporada completa+Copa+Playoffs): con el 35/65 "de
      // catálogo" (sección 19) la cuota SIN CONTACTO agregada salía ~86%
      // (objetivo 65-75%) porque los modificadores de acuteContact están
      // deliberadamente amortiguados (sección 6: "carga/fatiga influyen
      // poco", solo 20% del exceso de load/energy, sin Preparación
      // Física) — con los mismos modificadores, un contactShare "de
      // catálogo" igual al share real deseado se queda corto en la
      // práctica. Subido para compensar ese amortiguado, no para cambiar
      // el criterio de la sección 19 en sí.
      match: {
        hazardPerThousandPlayerHours: 30,
        contactShare: 0.52,
        nonContactShare: 0.48,
      },

      // --- Sección 18: incidencia base de entrenamiento — ancla semanal
      // por jugador (independiente del hazard de partido), calibrada para
      // ~2-4 lesiones time-loss/equipo/temporada de entrenamiento (sección
      // 35/37) sobre una plantilla de 12 jugadores y ~34-40 ticks/temporada.
      training: {
        baseWeeklyIncidence: 0.0065,
        nonContactShare: 0.45,
        overuseShare: 0.55,
      },

      // --- Sección 18 (setback en fase `limited`): rango de
      // recoveryProgress al que se reduce una lesión activa al sufrir una
      // recaída, según severidad de la lesión ORIGINAL.
      setback: {
        recoveryProgressRangeBySeverity: {
          minor: [0.65, 0.85],
          moderate: [0.65, 0.85],
          major: [0.65, 0.85],
          severe: [0.65, 0.85],
        },
      },

      // --- Sección 12: catálogo mínimo (10 diagnósticos) como DATOS, sin
      // if/else disperso. `mechanisms`: peso RELATIVO de ese diagnóstico
      // DENTRO del mecanismo indicado (0 o ausente = mecanismo imposible
      // para ese diagnóstico). `severities`: peso relativo (0/ausente =
      // severidad imposible para ese diagnóstico). `recoveryDaysBySeverity`:
      // rango [min,max] propio, sobrescribe el rango general orientativo de
      // la sección 13. `sequelaAttributes`: atributos físicos 1-20
      // susceptibles de secuela (vacío si esa lesión nunca deja secuela).
      catalog: {
        // Severidades recalibradas (scripts/smoke-life3.js, temporada
        // real completa): la primera pasada dejó `severe` en ~2.7% del
        // total (objetivo sección 36: ~10-18%) — se sube el peso `severe`
        // en las lesiones que ya lo admitían y se añade un peso `severe`
        // pequeño a ankleSprain/muscleStrain (esguinces de sindesmosis y
        // roturas musculares grado III severas sí existen en la
        // realidad, aunque minoritarias dentro de cada diagnóstico).
        ankleSprain: {
          label: 'Esguince de tobillo', bodyArea: 'ankle', weight: 26,
          mechanisms: { acuteContact: 0.30, acuteNonContact: 0.70 },
          severities: { minor: 0.40, moderate: 0.31, major: 0.17, severe: 0.12 },
          recoveryDaysBySeverity: { minor: [3, 10], moderate: [10, 21], major: [22, 35], severe: [40, 65] },
          sequelaAttributes: ['agility', 'topSpeed'],
        },
        kneeSprain: {
          label: 'Esguince de rodilla', bodyArea: 'knee', weight: 14,
          mechanisms: { acuteContact: 0.35, acuteNonContact: 0.65 },
          severities: { minor: 0.26, moderate: 0.29, major: 0.25, severe: 0.20 },
          recoveryDaysBySeverity: { minor: [5, 12], moderate: [12, 25], major: [26, 45], severe: [46, 80] },
          sequelaAttributes: ['jumping', 'agility', 'topSpeed'],
        },
        majorKneeLigament: {
          label: 'Rotura ligamentosa de rodilla', bodyArea: 'knee', weight: 1.6,
          mechanisms: { acuteContact: 0.40, acuteNonContact: 0.60 },
          severities: { severe: 1.0 },
          recoveryDaysBySeverity: { severe: [180, 300] },
          sequelaAttributes: ['jumping', 'agility', 'topSpeed', 'acceleration'],
        },
        muscleStrain: {
          label: 'Sobrecarga/rotura muscular', bodyArea: 'upperLeg', weight: 18,
          mechanisms: { acuteNonContact: 1.0 },
          severities: { minor: 0.34, moderate: 0.31, major: 0.23, severe: 0.12 },
          recoveryDaysBySeverity: { minor: [3, 8], moderate: [9, 20], major: [21, 40], severe: [41, 65] },
          sequelaAttributes: ['topSpeed', 'acceleration'],
        },
        tendonOveruse: {
          label: 'Tendinopatía por sobrecarga', bodyArea: 'lowerLeg', weight: 10,
          mechanisms: { overuse: 1.0 },
          severities: { minor: 0.26, moderate: 0.35, major: 0.28, severe: 0.11 },
          recoveryDaysBySeverity: { minor: [4, 10], moderate: [11, 25], major: [26, 42], severe: [43, 65] },
          sequelaAttributes: ['jumping', 'stamina'],
        },
        backIssue: {
          label: 'Lumbalgia/dorsalgia', bodyArea: 'back', weight: 7,
          mechanisms: { acuteNonContact: 0.5, overuse: 0.5 },
          severities: { minor: 0.32, moderate: 0.29, major: 0.20, severe: 0.19 },
          recoveryDaysBySeverity: { minor: [3, 8], moderate: [9, 21], major: [22, 40], severe: [41, 70] },
          sequelaAttributes: ['strength'],
        },
        handFingerInjury: {
          label: 'Lesión de mano/dedos', bodyArea: 'hand', weight: 6,
          mechanisms: { acuteContact: 0.8, acuteNonContact: 0.2 },
          severities: { minor: 0.60, moderate: 0.35, major: 0.05 },
          recoveryDaysBySeverity: { minor: [2, 7], moderate: [8, 18], major: [19, 30] },
          sequelaAttributes: [],
        },
        contusion: {
          label: 'Contusión', bodyArea: 'trunk', weight: 7,
          mechanisms: { acuteContact: 1.0 },
          severities: { minor: 0.70, moderate: 0.30 },
          recoveryDaysBySeverity: { minor: [2, 6], moderate: [7, 14] },
          sequelaAttributes: [],
        },
        shoulderSprain: {
          label: 'Esguince de hombro', bodyArea: 'shoulder', weight: 5,
          mechanisms: { acuteContact: 0.6, acuteNonContact: 0.4 },
          severities: { minor: 0.28, moderate: 0.33, major: 0.20, severe: 0.19 },
          recoveryDaysBySeverity: { minor: [3, 9], moderate: [10, 22], major: [23, 42], severe: [43, 70] },
          sequelaAttributes: ['strength'],
        },
        concussion: {
          label: 'Conmoción cerebral', bodyArea: 'head', weight: 2,
          mechanisms: { acuteContact: 1.0 },
          severities: { minor: 0.50, moderate: 0.35, major: 0.15 },
          recoveryDaysBySeverity: { minor: [3, 7], moderate: [8, 21], major: [22, 42] },
          sequelaAttributes: [],
        },
      },

      // --- Sección 13: distribución global orientativa de severidad (no
      // fuerza cada catálogo — cada diagnóstico ya restringe sus propias
      // severidades posibles arriba; esto documenta el objetivo agregado).
      severityGlobalTarget: { minor: 0.33, moderate: 0.26, major: 0.26, severe: 0.15 },

      // --- Sección 14: variación individual de recuperación por lesión.
      recoveryVarianceRange: [0.85, 1.15],

      // --- Sección 15: fases de Return to Play — umbrales sobre
      // recoveryProgress (0..1). `limitedThreshold` depende de la
      // severidad de la lesión.
      phases: {
        treatmentMax: 0.25,
        rehabMax: 0.75,
        modifiedTrainingMaxBySeverity: { minor: 0.85, moderate: 0.88, major: 0.90, severe: 0.93 },
      },

      // --- Sección 16: minute cap progresivo en fase `limited`.
      minuteCap: {
        atEnterLimited: 12,
        atAvailable: 30,
        // Preparación física acelera MODERADAMENTE la progresión del cap
        // (nunca se salta el limitedThreshold — eso lo decide `phases`).
        physicalPreparationBonusCurve: [[1, 0.0], [20, 6]],
      },

      // --- Sección 27: secuelas — raras y basadas en la lesión concreta.
      sequela: {
        baseProbabilityBySeverity: { minor: 0, moderate: 0.01, major: 0.06, severe: 0.18 },
        recentRecurrenceBonus: 0.05,
        recentRecurrenceWindowDays: 365,
        // Delta agregado (escala 1-20) repartido entre 1-3 atributos de
        // `catalog[type].sequelaAttributes` — signo siempre negativo.
        aggregateDeltaRange: [0.35, 1.20],
        maxAttributesAffected: 3,
      },

      // --- Sección 23: excepción médica al mínimo de convocatoria 8.
      squadException: {
        absoluteMinimum: 5,
        normalMinimum: 8,
      },

      // --- Sección 25: factores de estímulo/coste de entrenamiento por
      // fase médica — multiplican (nunca sustituyen) el estímulo normal ya
      // calculado por Training.js. `declineDelta` de PlayerDevelopment
      // NUNCA se ve afectado por estos factores (sección 25, cierre).
      trainingStimulusByPhase: {
        treatment: {
          physical: 0.10, technical: 0.35, cognitive: 0.50, social: 0.50,
          position: 0.20, role: 0.35, tactical: 0.50, energyCost: 0.25,
        },
        rehab: {
          physical: 0.10, technical: 0.35, cognitive: 0.50, social: 0.50,
          position: 0.20, role: 0.35, tactical: 0.50, energyCost: 0.25,
        },
        modifiedTraining: {
          physical: 0.50, technical: 0.70, cognitive: 0.80, social: 0.80,
          position: 0.60, role: 0.60, tactical: 0.75, energyCost: 0.60,
        },
        limited: { stimulusMultiplier: 0.90, energyCostMultiplier: 0.85 },
      },

      // --- Sección 28: decay mínimo de Competition Rhythm durante
      // indisponibilidad médica (solo si LIFE-2 no dejó ya un decay
      // temporal real — verificado contra HEAD: `dynamicState.
      // competitionRhythm` no decae con inactividad hasta esta entrega,
      // ver Medical.js/CHANGELOG). Puntos por día de indisponibilidad.
      competitionRhythmDecayPerDayUnavailable: 0.6,

      // --- Sección 29: anchura de incertidumbre del rango de vuelta
      // mostrado en UI, según nivel de Centro Médico.
      estimatedReturnUncertainty: { atLevel1: 0.20, atLevel20: 0.08 },
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
