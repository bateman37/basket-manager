// src/core/Tactics.js
// Sistema táctico — TAC-1 (núcleo de posesión) + TAC-2 (identidad, spacing,
// roles) — DESIGN.md 7.12, bloque de implementación 7.12.33. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Regla de integración #1 (7.12.30): 7.6 sigue siendo el resolver final.
// Este módulo NO tira, NO decide rebotes ni faltas — decide QUIÉN participa
// en la jugada de Pick & Roll y CON QUÉ CONTEXTO llega esa jugada al
// catálogo de acciones ya existente en MatchEngine.simulatePossession(), y
// (TAC-2) qué IDENTIDAD/SPACING/ROLES tiene un equipo y cómo de bien encaja
// cada jugador en cada rol. MatchEngine.js importa de aquí; este archivo
// nunca importa de MatchEngine.js (7.12.2).
//
// Alcance de TAC-1 (ver DESIGN.md 7.12.33): TacticalProfile (solo cobertura
// de P&R), PossessionPlan, DefensivePlan, AdvantageState y la bifurcación de
// lectura de 3 ramas.
//
// Alcance AÑADIDO en TAC-2 (esta entrega): TacticalProfile completo
// (spacing, ejes de identidad, pesos de play-type, RoleAssignment por
// jugador), `effectiveSpacing()`, catálogo de roles ofensivos/defensivos +
// `roleFit()` en estrellas, y valoraciones derivadas de quinteto (7.12.28,
// subset). SIGUE sin implementarse playbook, defensa avanzada, IA táctica,
// tiempos muertos, familiaridad ni Data Hub (TAC-3 a TAC-7).
//
// Compatibilidad con partidas sin perfil táctico (DESIGN.md 7.12.34): un
// equipo sin TacticalProfile en ataque NUNCA activa un Pick & Roll táctico
// — planPnrPossession() devuelve null y MatchEngine sigue exactamente el
// bucle 1v1 de siempre. Desde TAC-2 esto ya no es "todos los partidos
// reales": `Team.js` inicializa `this.tacticalProfile` con valores por
// defecto en el constructor, así que cualquier equipo real/ficticio
// construido con `new Team()` YA tiene un TacticalProfile (ver nota de
// encaje más abajo y en Team.js). El `null` de este módulo sigue existiendo
// para cubrir el caso defensivo de un objeto plano sin esa propiedad.
//
// Decisión de encaje de TAC-1 (7.12.2), corregida en TAC-2: TAC-1 dejó
// señalado que `TacticalProfile` NO vivía todavía en `Team.js` (se pasaba
// de forma efímera por `options.homeTacticalProfile`/`awayTacticalProfile`).
// TAC-2 SÍ lo persiste en `Team.js` (`this.tacticalProfile`, inicializado
// con valores por defecto en el constructor — mismo patrón que `clubDNA`/
// `reputation`). `options.homeTacticalProfile`/`awayTacticalProfile` sigue
// existiendo en `MatchEngine.simulateMatch()` para tests dirigidos, con
// prioridad sobre `team.tacticalProfile` si ambos están presentes — ver
// MatchEngine.js.

(function (global) {
  const RotationCore = (typeof module !== 'undefined' && module.exports)
    ? require('./Rotation.js')
    : global.BasketManager;
  const { getPenalty } = RotationCore;

  // DESIGN.md 7.12 (TAC-2): a diferencia de las funciones de TAC-1
  // (computeAdvantageScore, buildPossessionPlan...), que reciben
  // `getAttribute` como parámetro desde MatchEngine (para no depender de
  // MatchEngine.js, ver regla de dirección de imports arriba), las
  // funciones NUEVAS de esta entrega (effectiveSpacing, roleFit,
  // computeLineupRatings) están pensadas para llamarse DIRECTAMENTE desde
  // la pantalla de Tácticas (game.js), sin pasar por MatchEngine ni por un
  // partido en curso — necesitan su PROPIO lector de atributos. Se
  // reimplementa aquí el mismo criterio que ya usa MatchEngine.getAttribute
  // (buscar el nombre en Player.js) en vez de importarlo, por el mismo
  // motivo que pickWeighted/gaussianRandom ya se reimplementan más abajo.
  const PlayerCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;
  const { TECHNICAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, MENTAL_ATTRIBUTES } = PlayerCore;
  const TACTICS_ATTRIBUTE_GROUP = {};
  TECHNICAL_ATTRIBUTES.forEach((name) => { TACTICS_ATTRIBUTE_GROUP[name] = 'technical'; });
  PHYSICAL_ATTRIBUTES.forEach((name) => { TACTICS_ATTRIBUTE_GROUP[name] = 'physical'; });
  MENTAL_ATTRIBUTES.forEach((name) => { TACTICS_ATTRIBUTE_GROUP[name] = 'mental'; });

  function getPlayerAttribute(player, name) {
    const group = TACTICS_ATTRIBUTE_GROUP[name];
    if (!group) {
      throw new Error(`Tactics: atributo desconocido "${name}" (revisar MatchConfig.js/Player.js)`);
    }
    return player[group][name];
  }

  // --- 7.12.2 / 7.12.16: TacticalProfile ---
  // Catálogo COMPLETO de coberturas de P&R nombrado (7.12.16), aunque TAC-1
  // solo diferencia comportamiento real para drop/under/switch/blitz —
  // 'hedge' comparte exactamente los datos de 'blitz' en CONFIG (7.12.16
  // las agrupa como "Hedge/Blitz", misma vulnerabilidad: short roll/4v3).
  // High Drop/Show/ICE quedan en el catálogo con hueco reservado, sin
  // implementación de comportamiento todavía (pedido explícito del
  // prompt: "no hace falta implementar... solo dejar el catálogo abierto").
  const PNR_COVERAGES = ['drop', 'under', 'switch', 'hedge', 'blitz'];

  // Spacing (7.12.6): estructura de ocupación de espacio, capa distinta del
  // playbook. 'dynamic' no tiene un techo propio fijo — effectiveSpacing()
  // usa el mejor ajuste real de los otros tres para ese quinteto concreto.
  const SPACING_OPTIONS = ['5-out', '4-out-1-in', '3-out-2-in', 'dynamic'];

  // Construye un grupo numérico "abierto" (7.12.7/7.12.8: la interfaz no
  // tiene que implementar los 14 ejes/11 play-types completos todavía, pero
  // el objeto debe poder ampliarse sin romper el shape). Rellena las claves
  // conocidas con su valor por defecto si faltan, y CONSERVA cualquier
  // clave extra que venga en `source` (ejes/play-types añadidos en una
  // sesión futura) en vez de descartarla.
  function buildOpenNumericGroup(defaults, source) {
    const group = { ...defaults };
    Object.keys(defaults).forEach((key) => {
      const raw = source && source[key] !== undefined ? source[key] : defaults[key];
      const num = Number(raw);
      group[key] = Number.isFinite(num) ? clamp(num, 0, 100) : defaults[key];
    });
    if (source && typeof source === 'object') {
      Object.keys(source).forEach((key) => {
        if (key in group) return;
        const num = Number(source[key]);
        group[key] = Number.isFinite(num) ? clamp(num, 0, 100) : 0;
      });
    }
    return group;
  }

  // Valores por defecto de un TacticalProfile recién creado (ej. `new
  // Team()` sin datos tácticos). Deliberadamente NO se leen de
  // MatchConfig.js aquí: `Team.js` construye un `TacticalProfile` sin
  // recibir ningún `config` (mismo patrón que el resto de defaults de
  // Team.js — facilities/reputation también están fijados en el propio
  // archivo, no en un CONFIG externo). Deben coincidir con
  // `config.tactics.identity.defaults`/`playTypeWeights.defaults`/
  // `spacing.default` de MatchConfig.js (mismas cifras, documentadas en los
  // dos sitios) — MatchConfig.js es la fuente para lo que SÍ consume
  // funciones con `config` como parámetro (ej. resolvePnrFrequency).
  const DEFAULT_SPACING = '4-out-1-in';
  const DEFAULT_IDENTITY = { pace: 50, earlyOffense: 50, ballMovement: 50, pickAndRollUsage: 50 };
  const DEFAULT_PLAY_TYPE_WEIGHTS = { pickAndRoll: 30, isolation: 15, postUp: 10, transition: 15 };

  // Perfil táctico de un equipo (7.12.2: "identidad ofensiva y defensiva
  // persistente"). TAC-1 solo tenía `pnrCoverage`; TAC-2 añade spacing, ejes
  // de identidad ofensiva mínimos (7.12.7), pesos de play-type mínimos
  // (7.12.8) y `roleAssignments` (RoleAssignment por jugador, 7.12.2/
  // 7.12.9/7.12.21 — vive aquí en vez de en un fichero propio, pedido
  // explícito del prompt de esta sesión: basta con un mapa).
  class TacticalProfile {
    constructor(data = {}) {
      const coverage = data.pnrCoverage || 'drop';
      if (PNR_COVERAGES.indexOf(coverage) === -1) {
        throw new Error(`TacticalProfile: cobertura de P&R desconocida "${coverage}" (catálogo: ${PNR_COVERAGES.join(', ')})`);
      }
      this.pnrCoverage = coverage;

      const spacing = data.spacing || DEFAULT_SPACING;
      if (SPACING_OPTIONS.indexOf(spacing) === -1) {
        throw new Error(`TacticalProfile: spacing desconocido "${spacing}" (catálogo: ${SPACING_OPTIONS.join(', ')})`);
      }
      this.spacing = spacing;

      this.identity = buildOpenNumericGroup(DEFAULT_IDENTITY, data.identity);
      this.playTypeWeights = buildOpenNumericGroup(DEFAULT_PLAY_TYPE_WEIGHTS, data.playTypeWeights);

      // RoleAssignment (7.12.9/7.12.21): playerId -> { offensiveRole,
      // defensiveRole }. Un jugador SIN entrada aquí no rompe nada — el
      // motor sigue operando con el comportamiento de siempre
      // (usageWeight/onBallDefenderWeight, sin sesgo de rol) para él;
      // ver nota de compatibilidad en planPnrPossession/buildPossessionPlan.
      this.roleAssignments = { ...(data.roleAssignments || {}) };
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

  // DESIGN.md 7.12.7 (TAC-2, punto 4 del prompt de esta sesión):
  // `identity.pickAndRollUsage` MODULA `config.tactics.pnrFrequency` para
  // ESE equipo en vez de dejarlo como un valor global fijo de CONFIG. El
  // punto neutro (`pickAndRollUsageNeutral`, 50 por defecto — el mismo
  // valor que `DEFAULT_IDENTITY.pickAndRollUsage`) reproduce EXACTAMENTE la
  // `pnrFrequency` de TAC-1 sin modulación: multiplicador 1, así que un
  // equipo con TacticalProfile por defecto sortea P&R con la MISMA
  // frecuencia que un equipo de TAC-1 (invariante de regresión explícito
  // del prompt: "con perfil por defecto = comportamiento equivalente").
  // Sin `identity` en el perfil (TacticalProfile antiguo/objeto plano
  // mínimo), se usa `pnrFrequency` tal cual, sin modular.
  function resolvePnrFrequency(offenseTacticalProfile, config) {
    const base = config.tactics.pnrFrequency;
    const identityCfg = config.tactics.identity || {};
    const usage = offenseTacticalProfile.identity && offenseTacticalProfile.identity.pickAndRollUsage;
    if (usage === undefined || usage === null) return base;
    const neutral = identityCfg.pickAndRollUsageNeutral !== undefined ? identityCfg.pickAndRollUsageNeutral : 50;
    const maxMultiplier = identityCfg.pickAndRollUsageMaxMultiplier !== undefined ? identityCfg.pickAndRollUsageMaxMultiplier : 2;
    const multiplier = neutral > 0 ? clamp(usage / neutral, 0, maxMultiplier) : 1;
    return clamp(base * multiplier, 0, 1);
  }

  // --- 7.12.2: PossessionPlan (mínimo de TAC-1) ---
  // ¿Esta posesión es un Pick & Roll central? Solo si el equipo atacante
  // tiene TacticalProfile asignado (ver nota de compatibilidad arriba) y el
  // sorteo de resolvePnrFrequency() (7.12.7, TAC-2: ya no un valor fijo
  // global, ver arriba) lo decide. `handler`/`screener` elegidos del
  // quinteto REAL (offenseFive, ya resuelto por Rotation.getOnCourtFive
  // antes de llegar aquí) con el mismo criterio de peso que ya usa
  // MatchEngine (usageWeight) para el handler — pedido explícito del
  // prompt, no se inventa un criterio de selección de handler nuevo.
  function buildPossessionPlan(offenseTacticalProfile, offenseFive, config, usageWeight, getAttribute) {
    if (!offenseTacticalProfile) return null;
    if (Math.random() >= resolvePnrFrequency(offenseTacticalProfile, config)) return null;

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

  // PENDIENTE EXPLÍCITO para TAC-3 (DESIGN.md 7.12.34, señalado también en
  // el CHANGELOG de esta entrega): `effectiveSpacing()` (más abajo) NO se
  // conecta a `computeAdvantageScore()` en TAC-2, a pesar de que el punto 4
  // del prompt de esta sesión lo permitía si se encontraba una forma limpia.
  // Motivo: desde esta entrega TODO equipo real/ficticio tiene un
  // `TacticalProfile` por defecto (Team.js), así que cualquier término que
  // sume aquí se aplicaría a TODOS los partidos del juego, no solo a los
  // que el usuario edite en la pantalla de Tácticas — y calibrar ese
  // término sin doble contar el efecto que YA describe 7.12.4 (el spacing
  // se refleja cambiando qué defensor ayuda, no como bonus aparte) exige
  // simulación masiva que esta entrega no puede validar sin arriesgar el
  // invariante de regresión (7.12.31: "con perfil por defecto = balance
  // equivalente"). Mejor dejarlo señalado que forzar un acoplamiento
  // improvisado, tal como permite explícitamente el prompt de esta sesión.
  //
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

  // =========================================================================
  // TAC-2 (DESIGN.md 7.12.33): spacing efectivo, roles + roleFit,
  // valoraciones derivadas de quinteto. A diferencia de las funciones de
  // arriba (TAC-1), estas se llaman DIRECTAMENTE desde game.js (pantalla de
  // Tácticas), sin pasar por un partido en curso — usan getPlayerAttribute
  // propio (ver arriba) y reciben `config` explícito (mismo patrón que el
  // resto del módulo: los pesos son datos de MatchConfig.js, no lógica
  // hardcodeada aquí), en vez de leerlo ellas mismas de MatchConfig.js.
  // =========================================================================

  // Mezcla genérica de atributos ponderada (1-20), SIN Fatiga/Consistencia/
  // Presión de Momento — a diferencia de MatchEngine.computeMixRating (que
  // sí los aplica, porque mide rendimiento DURANTE una posesión concreta),
  // roleFit/las valoraciones de quinteto son una foto de APTITUD para
  // mostrar en una pantalla fuera de partido, no una previsión de
  // rendimiento en la jugada — no se reimplementa ese tratamiento aquí a
  // propósito, sería una duplicación real de la fórmula de 7.5/7.5-bis, no
  // una utilidad genérica como pickWeighted/gaussianRandom.
  function computeSimpleMix(player, mix) {
    let sum = 0;
    let total = 0;
    Object.entries(mix).forEach(([attrName, weight]) => {
      sum += getPlayerAttribute(player, attrName) * weight;
      total += weight;
    });
    return total > 0 ? sum / total : 0;
  }

  function averageMix(five, mix) {
    if (!five || five.length === 0) return 0;
    return five.reduce((sum, p) => sum + computeSimpleMix(p, mix), 0) / five.length;
  }

  // Media de los N jugadores con MAYOR puntuación en `mix` (no de los 5) —
  // usado donde solo importan los mejores en ese papel (creadores,
  // finalizadores), no la media de todo el quinteto.
  function topNMixAverage(five, mix, n) {
    if (!five || five.length === 0) return 0;
    const scores = five.map((p) => computeSimpleMix(p, mix)).sort((a, b) => b - a);
    const considered = scores.slice(0, Math.min(n, scores.length));
    return considered.reduce((a, b) => a + b, 0) / considered.length;
  }

  // 1-5 estrellas a partir de una puntuación en escala de atributo (1-20) —
  // mismo criterio de bucketing que competitionRhythmToStars en game.js
  // (Math.ceil(score/paso)), adaptado a la escala 1-20 en vez de 0-100.
  function starsFromScore20(score) {
    return Math.max(1, Math.min(5, Math.ceil(clamp(score, 1, 20) / 4)));
  }

  // --- 7.12.6: effectiveSpacing ---
  // "Amenaza de tiro exterior real" de un jugador (config.tactics.spacing.
  // shotThreatMix) — no es un atributo nuevo, es la misma mezcla aplicada a
  // outsideShot/midRangeShot que ya existían en 6.1.
  function shotThreatValue(player, config) {
    return computeSimpleMix(player, config.tactics.spacing.shotThreatMix);
  }

  // Spacing efectivo real (0..1) de un quinteto REAL en pista (los 5 de
  // `getOnCourtFive`, nunca el roster completo) cruzando el spacing
  // DECLARADO con la amenaza de tiro real de esos 5 (7.12.6, 7.12.31
  // invariantes 5/6). 'dynamic' no tiene techo propio: usa el MEJOR ajuste
  // real de los otros tres para este quinteto concreto (7.12.6, "el spacing
  // cambia según quinteto, jugada y rol" — aquí solo "quinteto", jugada/rol
  // son TAC-3).
  //
  // Pendiente de calibración (7.12.34): la fórmula exacta (qué N jugadores
  // cuentan, el techo por arquetipo) es un punto de partida verificado en
  // DIRECCIÓN, no una cifra cerrada — ver script de verificación de esta
  // entrega.
  function effectiveSpacing(spacing, five, config) {
    if (!five || five.length === 0) return 0;
    const spacingCfg = config.tactics.spacing;
    if (spacing === 'dynamic') {
      const fixedOptions = Object.keys(spacingCfg.shooterRequirement);
      return Math.max(...fixedOptions.map((option) => effectiveSpacing(option, five, config)));
    }
    const required = spacingCfg.shooterRequirement[spacing];
    if (!required) return 0;
    const threats = five.map((p) => shotThreatValue(p, config)).sort((a, b) => b - a);
    const considered = threats.slice(0, Math.min(required, threats.length));
    const averageThreat = considered.reduce((a, b) => a + b, 0) / considered.length; // escala 1-20
    const ceiling = spacingCfg.archetypeCeiling[spacing] !== undefined ? spacingCfg.archetypeCeiling[spacing] : 1;
    return clamp((averageThreat / 20) * ceiling, 0, 1);
  }

  // --- 7.12.9 / 7.12.21: catálogo de roles ofensivos/defensivos ---
  // Solo id/etiqueta/posiciones preferentes (datos de catálogo, como
  // PNR_COVERAGES arriba) — los PESOS de atributo de cada rol viven en
  // MatchConfig.js (config.tactics.roles.offensiveMix/defensiveMix, mismo
  // criterio que coverageHandlerMix). `positions`: usadas para la
  // competencia posicional (6.1) de roleFit, no una restricción dura — un
  // jugador de otra posición puede seguir jugando el rol, solo puntúa peor.
  const OFFENSIVE_ROLES = [
    { id: 'primaryCreator', label: 'Creador primario', positions: ['Base', 'Escolta'] },
    { id: 'secondaryCreator', label: 'Creador secundario', positions: ['Base', 'Escolta', 'Alero'] },
    { id: 'pnrHandler', label: 'PnR Handler', positions: ['Base'] },
    { id: 'isolationScorer', label: 'Isolation Scorer', positions: ['Escolta', 'Alero'] },
    { id: 'spotUpShooter', label: 'Spot-up Shooter', positions: ['Escolta', 'Alero'] },
    { id: 'movementShooter', label: 'Movement Shooter', positions: ['Escolta', 'Alero'] },
    { id: 'slasher', label: 'Slasher', positions: ['Escolta', 'Alero', 'Ala-pívot'] },
    { id: 'connector', label: 'Connector', positions: ['Alero', 'Ala-pívot'] },
    { id: 'postScorer', label: 'Post Scorer', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'postHub', label: 'Post Hub', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'rollMan', label: 'Roll Man', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'shortRollPlaymaker', label: 'Short-Roll Playmaker', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'pickAndPopBig', label: 'Pick & Pop Big', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'primaryScreener', label: 'Primary Screener', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'offensiveRebounder', label: 'Offensive Rebounder', positions: ['Ala-pívot', 'Pívot'] },
  ];

  const DEFENSIVE_ROLES = [
    { id: 'poaStopper', label: 'POA Stopper', positions: ['Base', 'Escolta'] },
    { id: 'screenNavigator', label: 'Screen Navigator', positions: ['Base', 'Escolta', 'Alero'] },
    { id: 'switchDefender', label: 'Switch Defender', positions: ['Alero', 'Ala-pívot'] },
    { id: 'perimeterDisruptor', label: 'Perimeter Disruptor', positions: ['Base', 'Escolta'] },
    { id: 'nailHelper', label: 'Nail Helper', positions: ['Alero', 'Ala-pívot'] },
    { id: 'lowMan', label: 'Low Man', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'rimProtector', label: 'Rim Protector', positions: ['Pívot', 'Ala-pívot'] },
    { id: 'postAnchor', label: 'Post Anchor', positions: ['Pívot'] },
    { id: 'roamer', label: 'Roamer', positions: ['Alero', 'Ala-pívot'] },
    { id: 'defensiveRebounder', label: 'Defensive Rebounder', positions: ['Ala-pívot', 'Pívot'] },
  ];

  function findRoleDefinition(roleId) {
    return OFFENSIVE_ROLES.find((r) => r.id === roleId) || DEFENSIVE_ROLES.find((r) => r.id === roleId) || null;
  }

  function roleSide(roleId) {
    if (OFFENSIVE_ROLES.some((r) => r.id === roleId)) return 'offensive';
    if (DEFENSIVE_ROLES.some((r) => r.id === roleId)) return 'defensive';
    return null;
  }

  // --- 7.12.9 / 7.12.21: roleFit (1-5 estrellas) ---
  // Valoración DERIVADA (nunca un atributo nuevo de Player.js, pedido
  // explícito del prompt): mezcla de atributos del rol (70%) + competencia
  // posicional real del jugador (6.1, 30% — la mejor de las posiciones
  // preferentes del rol) + un factor pequeño de estado físico (Energía
  // actual, 7.12.9 "estado físico"). Puede calcularse para CUALQUIER rol
  // del catálogo contra cualquier jugador, no solo el asignado — para que
  // la UI compare candidatos (pedido explícito del prompt).
  function roleFit(player, roleId, config) {
    const definition = findRoleDefinition(roleId);
    if (!definition) {
      throw new Error(`Tactics.roleFit: rol desconocido "${roleId}"`);
    }
    const side = roleSide(roleId);
    const rolesCfg = config.tactics.roles;
    const mix = (side === 'offensive' ? rolesCfg.offensiveMix : rolesCfg.defensiveMix)[roleId];
    const mixScore = computeSimpleMix(player, mix);
    const positionScore = Math.max(...definition.positions.map((pos) => player.positionLevel(pos)));
    const fitWeights = rolesCfg.fitWeights;
    const energyFactor = fitWeights.energyBaseline + fitWeights.energyRange * (player.dynamicState.energy / 100);
    const combined = (mixScore * fitWeights.attributeMixWeight + positionScore * fitWeights.positionLevelWeight) * energyFactor;
    return { score: combined, stars: starsFromScore20(combined) };
  }

  // Los `topN` roles de un lado (ofensivo/defensivo) con mejor `roleFit`
  // para un jugador — para la vista "Roles" de la pantalla de Tácticas
  // (7.12.32: "2-3 roles con mejor encaje de cada jugador").
  function bestRolesForPlayer(player, side, config, topN = 3) {
    const catalog = side === 'offensive' ? OFFENSIVE_ROLES : DEFENSIVE_ROLES;
    return catalog
      .map((definition) => ({ roleId: definition.id, label: definition.label, ...roleFit(player, definition.id, config) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // --- 7.12.28: valoraciones derivadas de quinteto (subset de esta entrega) ---
  // Deja fuera Switchability/Rim Protection/Transition Offense/Transition
  // Defense/Tactical Execution — dependen de piezas que todavía no existen
  // (defensa avanzada es TAC-4, familiaridad/tacticalExecution es TAC-6);
  // señalado también en el CHANGELOG, no se inventan con datos que no hay.
  const CREATION_MIX = { gameVision: 0.4, passing: 0.35, ballHandling: 0.25 };
  const FINISHING_MIX = { insideShot: 0.5, layup: 0.5 };

  function computeLineupRatings(five, tacticalProfile, config) {
    const spacingScore20 = effectiveSpacing(tacticalProfile.spacing, five, config) * 20;
    const raw = {
      creation: topNMixAverage(five, CREATION_MIX, 2),
      spacing: spacingScore20,
      outsideShooting: averageMix(five, { outsideShot: 1 }),
      insideFinishing: topNMixAverage(five, FINISHING_MIX, 2),
      offensiveRebound: averageMix(five, { offensiveRebound: 1 }),
      defensiveRebound: averageMix(five, { defensiveRebound: 1 }),
    };
    const out = {};
    Object.entries(raw).forEach(([key, score]) => { out[key] = { score, stars: starsFromScore20(score) }; });
    return out;
  }

  const exportsObj = {
    TacticalProfile,
    PNR_COVERAGES,
    SPACING_OPTIONS,
    OFFENSIVE_ROLES,
    DEFENSIVE_ROLES,
    planPnrPossession,
    effectiveSpacing,
    roleFit,
    bestRolesForPlayer,
    computeLineupRatings,
    starsFromScore20,
    // Expuestas para tests dedicados (verificación de invariantes 7.12.31
    // sin tener que simular partidos completos para cada pieza).
    buildPossessionPlan,
    buildDefensivePlan,
    computeAdvantageScore,
    resolveRead,
    pickRollFinishType,
    resolvePnrFrequency,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
