// src/core/Tactics.js
// Sistema táctico — TAC-1: núcleo táctico de posesión (DESIGN.md 7.12,
// bloque de implementación 7.12.33 "TAC-1 — Núcleo táctico de posesión").
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Regla de integración #1 (7.12.30): 7.6 sigue siendo el resolver final.
// Este módulo NO tira, NO decide rebotes ni faltas — solo decide QUIÉN
// participa en la jugada de Pick & Roll (handler/screener/defensores) y
// CON QUÉ CONTEXTO llega esa jugada al catálogo de acciones ya existente
// en MatchEngine.simulatePossession(). MatchEngine.js importa de aquí;
// este archivo nunca importa de MatchEngine.js (7.12.2).
//
// Alcance de ESTA entrega (TAC-1, ver DESIGN.md 7.12.33): solo
// TacticalProfile (cobertura de P&R por defecto), PossessionPlan (¿es
// esta posesión un P&R central?), DefensivePlan (cobertura + defensor del
// bloqueador), AdvantageState (advantageScore -1..+1) y la bifurcación de
// lectura de 3 ramas que decide qué jugador tira y contra qué defensor —
// SIN spacing, roles, playbook, defensa avanzada, IA táctica, tiempos
// muertos, familiaridad ni Data Hub (eso es TAC-2 a TAC-7, no adelantar).
//
// Compatibilidad con partidas sin perfil táctico (DESIGN.md 7.12.34): un
// equipo sin TacticalProfile en ataque NUNCA activa un Pick & Roll táctico
// — planPnrPossession() devuelve null y MatchEngine sigue exactamente el
// bucle 1v1 de siempre. Esto es, hoy, el caso de TODOS los partidos reales
// (no existe todavía ninguna pantalla ni mecanismo que asigne un
// TacticalProfile a un equipo — ver "Qué NO hacer" del prompt de esta
// sesión); el perfil solo se puede asignar hoy pasándolo explícitamente en
// `options.homeTacticalProfile`/`awayTacticalProfile` a
// MatchEngine.simulateMatch(), para tests/simulación dirigida.
//
// Decisión de encaje NO fijada explícitamente en DESIGN.md, señalada aquí:
// 7.12.2 describe TacticalProfile como "estado persistente de la
// partida" (viviría en el equipo/partida guardada). Esta entrega NO toca
// `src/entities/Team.js` (fuera de la lista de archivos permitidos para
// TAC-1: solo MatchConfig.js, MatchEngine.js y este archivo), así que el
// perfil se pasa de forma efímera por partido vía `options` de
// `simulateMatch()` — mismo patrón ya usado para `homeLineup`/`awayLineup`
// (7.11.5). Persistirlo en el equipo es trabajo de una sesión de UI/estado
// futura (TAC-2+), no de este núcleo de posesión.

(function (global) {
  const RotationCore = (typeof module !== 'undefined' && module.exports)
    ? require('./Rotation.js')
    : global.BasketManager;
  const { getPenalty } = RotationCore;

  // --- 7.12.2 / 7.12.16: TacticalProfile ---
  // Catálogo COMPLETO de coberturas de P&R nombrado (7.12.16), aunque TAC-1
  // solo diferencia comportamiento real para drop/under/switch/blitz —
  // 'hedge' comparte exactamente los datos de 'blitz' en CONFIG (7.12.16
  // las agrupa como "Hedge/Blitz", misma vulnerabilidad: short roll/4v3).
  // High Drop/Show/ICE quedan en el catálogo con hueco reservado, sin
  // implementación de comportamiento todavía (pedido explícito del
  // prompt: "no hace falta implementar... solo dejar el catálogo abierto").
  const PNR_COVERAGES = ['drop', 'under', 'switch', 'hedge', 'blitz'];

  // Perfil táctico de un equipo (7.12.2: "identidad ofensiva y defensiva
  // persistente"). Mínimo viable de TAC-1: solo la cobertura de P&R por
  // defecto. El resto de campos de un TacticalProfile completo (spacing,
  // ritmo, play-type weights, roles...) es TAC-2+, deliberadamente fuera.
  class TacticalProfile {
    constructor({ pnrCoverage } = {}) {
      const coverage = pnrCoverage || 'drop';
      if (PNR_COVERAGES.indexOf(coverage) === -1) {
        throw new Error(`TacticalProfile: cobertura de P&R desconocida "${coverage}" (catálogo: ${PNR_COVERAGES.join(', ')})`);
      }
      this.pnrCoverage = coverage;
    }
  }

  // Sorteo ponderado genérico — mismo algoritmo que MatchEngine.pickWeighted
  // (utilidad genérica sin lógica de dominio, no la fórmula de ninguna
  // acción de 7.6; se reimplementa aquí en vez de importarla para no
  // depender de MatchEngine.js, ver regla de dirección de imports arriba).
  function pickWeighted(items, weightFn) {
    const weights = items.map(weightFn);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < items.length; i += 1) {
      if (roll < weights[i]) return items[i];
      roll -= weights[i];
    }
    return items[items.length - 1];
  }

  // Ruido gaussiano simple (Box-Muller) — misma utilidad genérica que
  // MatchEngine.gaussianRandom (7.5-bis), reimplementada aquí por el mismo
  // motivo que pickWeighted: es matemática genérica, no una fórmula de 7.6
  // ni de 7.12 que debiera vivir en un solo sitio.
  function gaussianRandom() {
    const u1 = Math.max(Math.random(), 1e-9);
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // "Quién pone el bloqueo": ponderado por atributos de screener real
  // (fuerza para aguantar el contacto, buen manejo interior para el roll
  // posterior) — no existe un peso equivalente ya en MatchEngine (a
  // diferencia de handler/onBallDefender, que SÍ reutilizan
  // usageWeight/onBallDefenderWeight tal cual pide el prompt), así que es
  // un criterio nuevo mínimo, igual de heurístico que los ya existentes.
  function screenerWeight(player, getAttribute) {
    return getAttribute(player, 'strength') + getAttribute(player, 'insideShot')
      + getAttribute(player, 'offensiveRebound') + 1;
  }

  // "Quién defiende al bloqueador": ponderado por atributos defensivos de
  // interior — mismo criterio de heurística nueva mínima que screenerWeight.
  function screenerDefenderWeight(player, getAttribute) {
    return getAttribute(player, 'interiorDefense') + getAttribute(player, 'strength')
      + getAttribute(player, 'blocking') + 1;
  }

  // --- 7.12.2: PossessionPlan (mínimo de TAC-1) ---
  // ¿Esta posesión es un Pick & Roll central? Solo si el equipo atacante
  // tiene TacticalProfile asignado (ver nota de compatibilidad arriba) y el
  // sorteo de config.tactics.pnrFrequency lo decide. `handler`/`screener`
  // elegidos del quinteto REAL (offenseFive, ya resuelto por
  // Rotation.getOnCourtFive antes de llegar aquí) con el mismo criterio de
  // peso que ya usa MatchEngine (usageWeight) para el handler — pedido
  // explícito del prompt, no se inventa un criterio de selección de
  // handler nuevo.
  function buildPossessionPlan(offenseTacticalProfile, offenseFive, config, usageWeight, getAttribute) {
    if (!offenseTacticalProfile) return null;
    if (Math.random() >= config.tactics.pnrFrequency) return null;

    const handler = pickWeighted(offenseFive, usageWeight);
    const screenerCandidates = offenseFive.filter((p) => p.id !== handler.id);
    const screener = pickWeighted(screenerCandidates, (p) => screenerWeight(p, getAttribute));
    return { handler, screener };
  }

  // --- 7.12.2 / 7.12.16: DefensivePlan (mínimo de TAC-1) ---
  // Cobertura leída del TacticalProfile del equipo defensor, con fallback a
  // 'drop' si no tiene perfil (pedido explícito del prompt, punto 3) —
  // decisión de diseño ya tomada por 7.12.16, no una interpretación propia.
  // `screenerDefender` elegido del quinteto real (defenseFive), excluyendo
  // a quien ya defiende de cerca (onBallDefender).
  function buildDefensivePlan(defenseTacticalProfile, defenseFive, onBallDefender, config, getAttribute) {
    const coverage = (defenseTacticalProfile && defenseTacticalProfile.pnrCoverage) || config.tactics.defaultCoverage;
    const candidates = defenseFive.filter((p) => p.id !== onBallDefender.id);
    const screenerDefender = pickWeighted(candidates, (p) => screenerDefenderWeight(p, getAttribute));
    return { coverage, screenerDefender };
  }

  // --- 7.12.4: AdvantageState ---
  // advantageScore (-1..+1): base por cobertura (7.12.16 vulnerabilidades)
  // ajustada por la diferencia de rating ofensivo/defensivo de los 4
  // jugadores implicados, calculada con computeMixRating (recibida como
  // parámetro — MISMO tratamiento de Fatiga/Consistencia/Presión de
  // Momento que ya aplica el resto del motor, no reimplementado aquí) y
  // penalizada por getPenalty() (Rotation.js, 7.11.3, polivalencia de
  // emergencia) de cada uno de los 4.
  //
  // Mismatch de Switch (invariante #3, 7.12.31): tras un cambio, quien
  // defiende de cerca al handler es realmente `screenerDefender` (no
  // `onBallDefender`), y quien queda emparejado con el rolo es
  // `onBallDefender`. Por eso, SOLO para 'switch', se evalúan los ratings
  // de cobertura con los dos defensores intercambiados respecto a su rol
  // original — si `screenerDefender` es un pívot lento evaluado con una
  // mezcla de defensa perimetral, su rating cae, y el advantageScore sube
  // en consecuencia (mismatch real, no una etiqueta).
  function computeAdvantageScore(params) {
    const {
      handler, screener, onBallDefender, screenerDefender, coverage, config, pressure,
      computeMixRating, offenseRotationState, defenseRotationState,
    } = params;
    const cfg = config.tactics.advantage;
    const handlerMix = config.tactics.coverageHandlerMix[coverage] || config.tactics.coverageHandlerMix.drop;
    const defenderMix = config.tactics.coverageDefenderMix[coverage] || config.tactics.coverageDefenderMix.drop;
    const baseScore = cfg.coverageBaseScore[coverage] !== undefined ? cfg.coverageBaseScore[coverage] : cfg.coverageBaseScore.drop;

    const isSwitch = coverage === 'switch';
    // Tras un Switch, el rol de "quién defiende de cerca al balón" pasa al
    // defensor del bloqueador (ver nota de mismatch arriba); en cualquier
    // otra cobertura, cada uno evalúa su rol original.
    const onBallRoleDefender = isSwitch ? screenerDefender : onBallDefender;
    const rollRoleDefender = isSwitch ? onBallDefender : screenerDefender;

    const handlerPenalty = getPenalty(offenseRotationState, handler.id);
    const screenerPenalty = getPenalty(offenseRotationState, screener.id);
    const onBallRolePenalty = getPenalty(defenseRotationState, onBallRoleDefender.id);
    const rollRolePenalty = getPenalty(defenseRotationState, rollRoleDefender.id);

    const handlerRating = computeMixRating(handler, handlerMix, config, pressure, undefined, handlerPenalty);
    const screenerRating = computeMixRating(screener, config.tactics.screenerMix, config, pressure, undefined, screenerPenalty);
    const onBallRating = computeMixRating(onBallRoleDefender, defenderMix, config, pressure, undefined, onBallRolePenalty);
    const rollDefRating = computeMixRating(rollRoleDefender, config.tactics.screenerDefenderMix, config, pressure, undefined, rollRolePenalty);

    const offenseRating = handlerRating * cfg.handlerWeight + screenerRating * cfg.screenerWeight;
    const defenseRating = onBallRating * cfg.onBallDefenderWeight + rollDefRating * cfg.screenerDefenderWeight;

    const noise = gaussianRandom() * cfg.noiseSigma;
    const raw = baseScore + cfg.sensitivity * (offenseRating - defenseRating) + noise;
    return clamp(raw, -1, 1);
  }

  // Bifurcación de lectura (7.12.4/7.12.31): TAC-1 solo diferencia 3 ramas
  // (mínimo demostrable de 7.12.33), no las 6 categorías completas de
  // telemetría de 7.12.4 — "ventaja defensiva clara" y "defensa estable"
  // colapsan ambas en 'low' (bucle 1v1 normal); "defensa en rotación" y
  // "defensa rota" colapsan en 'clear' (el roller termina la jugada). Las
  // 6 categorías completas y sus transiciones dentro de una misma posesión
  // son TAC-3 (continuidad/counters), explícitamente fuera de esta entrega.
  function resolveRead(advantageScore, config) {
    const t = config.tactics.advantage.thresholds;
    if (advantageScore >= t.clearAdvantage) return 'clear';
    if (advantageScore >= t.smallAdvantage) return 'small';
    return 'low';
  }

  // Tipo de finalización del roller en la rama de ventaja clara (rama 3,
  // ver planPnrPossession): SOLO Tiro interior o Bandeja (pedido explícito
  // del prompt, punto 5) — variante restringida de
  // MatchEngine.pickShotType (que sortea entre los 4 tipos), no una
  // duplicación de esa función: aquí el universo son solo 2 tipos porque
  // el roller termina cerca del aro, nunca con un triple.
  function pickRollFinishType(player, getAttribute) {
    const weights = {
      insideShot: getAttribute(player, 'insideShot') + 1,
      layup: getAttribute(player, 'layup') + 1,
    };
    const entries = Object.entries(weights);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < entries.length; i += 1) {
      const [key, w] = entries[i];
      if (roll < w) return key;
      roll -= w;
    }
    return entries[entries.length - 1][0];
  }

  // --- Punto de entrada único que llama MatchEngine.simulatePossession ---
  // Devuelve `null` si esta posesión NO es un P&R táctico (sin perfil
  // ofensivo asignado, o no tocó el sorteo de pnrFrequency) — en ese caso
  // MatchEngine debe comportarse exactamente como si Tactics.js no
  // existiera. Si devuelve un plan, MatchEngine usa sus campos para
  // sustituir SOLO la elección de ballHandler/onBallDefender/shotDefender/
  // shotType de esa posesión — 7.6 sigue resolviendo el tiro/rebote/falta
  // con las mismas fórmulas de siempre (regla de integración #1, 7.12.30).
  //
  // Campos del plan devuelto:
  // - handler/screener: quinteto real implicado en el bloqueo.
  // - coverage: cobertura defensiva resuelta ('drop'|'under'|'switch'|
  //   'hedge'|'blitz').
  // - screenerDefender: quién defiende al bloqueador.
  // - effectiveOnBallDefender: quién defiende de cerca al `handler` YA
  //   considerando el cambio de asignación de Switch.
  // - read: 'low' | 'small' | 'clear' — bifurcación de 7.12.4/7.12.31.
  // - rollerDefender: quién defiende al `screener` si termina la jugada
  //   como roller (rama 'clear') — el propio `screenerDefender` si no ha
  //   rotado (Drop/Under), o `onBallDefender` si la cobertura fue Switch/
  //   Blitz/Hedge (7.12.16, "vulnerabilidades emergentes").
  // - advantageScore: valor -1..+1, expuesto solo para telemetría/debug
  //   (7.12.33: "sin frontend complejo, un flag de debug/consola basta").
  function planPnrPossession(params) {
    const {
      offenseTacticalProfile, defenseTacticalProfile, offenseFive, defenseFive, onBallDefender,
      config, pressure, computeMixRating, getAttribute, usageWeight,
      offenseRotationState, defenseRotationState,
    } = params;

    const possessionPlan = buildPossessionPlan(offenseTacticalProfile, offenseFive, config, usageWeight, getAttribute);
    if (!possessionPlan) return null;
    const { handler, screener } = possessionPlan;

    const defensivePlan = buildDefensivePlan(defenseTacticalProfile, defenseFive, onBallDefender, config, getAttribute);
    const { coverage, screenerDefender } = defensivePlan;

    const advantageScore = computeAdvantageScore({
      handler, screener, onBallDefender, screenerDefender, coverage, config, pressure,
      computeMixRating, offenseRotationState, defenseRotationState,
    });
    const read = resolveRead(advantageScore, config);

    // Switch: el defensor real del handler pasa a ser screenerDefender
    // (ver nota de mismatch en computeAdvantageScore) — cualquier otra
    // cobertura mantiene al onBallDefender original defendiendo de cerca.
    const effectiveOnBallDefender = coverage === 'switch' ? screenerDefender : onBallDefender;

    // Vulnerabilidades emergentes de 7.12.16: si el roller recibe el
    // balón (rama 'clear'), quién queda de ayuda depende de si el
    // defensor del bloqueador rotó o no. Drop/Under: no rota, sigue
    // defendiendo el aro — es él quien contesta el roll. Switch/Blitz/
    // Hedge: comprometió al balón (cambió o dobló), así que es el
    // onBallDefender original quien queda como única ayuda disponible.
    const rollerDefender = (coverage === 'switch' || coverage === 'blitz' || coverage === 'hedge')
      ? onBallDefender : screenerDefender;

    const forcedShotType = read === 'clear' ? pickRollFinishType(screener, getAttribute) : null;

    return {
      handler, screener, coverage, screenerDefender, effectiveOnBallDefender, rollerDefender,
      read, advantageScore, forcedShotType,
    };
  }

  const exportsObj = {
    TacticalProfile,
    PNR_COVERAGES,
    planPnrPossession,
    // Expuestas para tests dedicados (verificación de invariantes 7.12.31
    // sin tener que simular partidos completos para cada pieza).
    buildPossessionPlan,
    buildDefensivePlan,
    computeAdvantageScore,
    resolveRead,
    pickRollFinishType,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
