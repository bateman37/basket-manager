// src/core/MatchConfig.js
// CONFIG del motor de simulación de partidos — ver DESIGN.md sección 7,
// especialmente 7.2 ("el CONFIG es una entidad propia, no una lista suelta
// de constantes"), 7.3/7.3-bis (estructura de las fórmulas) y 7.6 (catálogo
// de acciones). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// FASE 1 (esta entrega): solo Bloque A (10 acciones base) y Bloque B (3
// caminos de reglamento). NO incluye Bloque C, ni los sistemas transversales
// (Presión de Momento 7.5, Consistencia/Fatiga 7.5-bis, modificador de
// Altura/Envergadura/Peso 7.4), ni factor cancha (7.8) ni racha (7.9) — esos
// llegan en fases futuras del motor, no se ha tocado nada de eso aquí.
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

(function (global) {
  // Escala de atributos 1-20 (ver Player.js) — valor "neutro"/liga-media
  // usado como referencia en las fórmulas de intercepto directo (tiro libre).
  const NEUTRAL_ATTRIBUTE = 10.5;

  const CONFIG_BASE = {
    // --- 7.1: arquitectura del bucle ---
    match: {
      durationMinutes: 40, // FIBA/ACB (parámetro de CONFIG, ver 7.1 y 7.2)
      quarters: 4,
      shotClockSeconds: 24, // reloj de posesión FIBA
      offensiveReboundShotClockSeconds: 14, // reset tras rebote ofensivo
      // Umbral de "bonus" (tiros libres por cualquier falta defensiva fuera
      // de tiro) — regla FIBA/ACB: 5ª falta de equipo en el cuarto.
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
      },

      // 2. Tiro de media distancia — DESIGN.md 7.6.2
      midRangeShot: {
        method: 'subtract',
        intercept: 0.39,
        sensitivity: 0.018,
        primary: { midRangeShot: 0.5, pressureDecisionMaking: 0.25, gameVision: 0.25 },
        secondary: { perimeterDefense: 0.7, anticipation: 0.3 },
      },

      // 3. Tiro interior — DESIGN.md 7.6.3
      insideShot: {
        method: 'subtract',
        intercept: 0.58,
        sensitivity: 0.015,
        primary: { insideShot: 0.5, jumping: 0.25, strength: 0.25 },
        secondary: { interiorDefense: 0.5, blocking: 0.3, positioning: 0.2 },
      },

      // 4. Bandeja/finalización — DESIGN.md 7.6.4
      layup: {
        method: 'subtract',
        intercept: 0.58, // provisional, comparte con insideShot (7.3-bis)
        sensitivity: 0.015,
        primary: { layup: 0.4, acceleration: 0.25, balance: 0.2, aggressiveness: 0.15 },
        secondary: { interiorDefense: 0.4, strength: 0.35, positioning: 0.25 },
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
      steal: {
        method: 'ratio',
        favors: 'primary', // probabilidad de que se acredite como ROBO
        primary: { stealing: 0.4, anticipation: 0.25, perimeterDefense: 0.2, workRate: 0.15 },
        secondary: { ballHandling: 0.6, gameVision: 0.4 },
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
