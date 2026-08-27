// src/core/NegotiationService.js
// MARKET-1 (DESIGN.md 9.19, sección 9.5/9.6 del prompt) — evaluación
// determinista de interés/ofertas del lado jugador-agente. El jugador y
// su agente NO son una tienda: la respuesta considera remuneración,
// garantía/duración, rol/minutos prometidos, proyecto deportivo, edad,
// situación contractual, trato previo del hilo y derechos preferentes —
// nunca expone utilidad/umbral/probabilidad exacta ni pesos (sección 9.5).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Determinismo (sección 9.6): ninguna decisión material usa Math.random()
// directo — todo se deriva de un fingerprint
// `careerSeed|playerId|threadId|offerVersion|decisionDate|policyVersion`
// vía DeterministicRandom. Misma semilla + mismos inputs -> misma
// secuencia; renderizar/recargar nunca cambia una decisión ya tomada.
//
// Política de JUEGO, NUNCA norma legal (sección 7.4/9.5): los tiempos de
// respuesta, la paciencia y los umbrales de aceptación viven aquí,
// versionados como `simulated-policy`, y JAMÁS acortan/alargan un plazo
// oficial ya resuelto por CompetitionRules (eso lo decide MarketService).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }

  const NEGOTIATION_POLICY_VERSION = 'simulated-negotiation-policy-v1';

  // Política de juego por defecto (sección 9.5) — SIEMPRE sustituida por
  // un plazo/ventana OFICIAL cuando exista (MarketService la recorta,
  // nunca la alarga, si el plazo legal restante es menor).
  const DEFAULT_POLICY = {
    responseDelayDaysRange: { min: 1, max: 3 },
    offerExpiryDaysDefault: 5,
    offerExpiryDaysRange: { min: 2, max: 14 },
    acceptThresholdRange: { min: 0.72, max: 0.85 },
    counterThresholdRange: { min: 0.40, max: 0.52 },
    concessionFactorRange: { min: 0.35, max: 0.55 },
    concessionDecayPerRound: 0.15,
    maxCounterRoundsRange: { min: 2, max: 4 },
  };

  function buildFingerprint({
    careerSeed, playerId, threadId, offerVersion, decisionDate, policyVersion,
  }) {
    if (!careerSeed || !playerId || !threadId || !decisionDate) {
      throw new Error('NegotiationService: fingerprint incompleto (careerSeed/playerId/threadId/decisionDate obligatorios).');
    }
    return `${careerSeed}|${playerId}|${threadId}|${offerVersion || 0}|${decisionDate}|${policyVersion || NEGOTIATION_POLICY_VERSION}`;
  }

  // Fecha de respuesta diferida (sección 9.5: "entre 1 y 3 días naturales
  // por defecto") — un plazo OFICIAL restante menor la recorta; nunca la
  // alarga (`maxOfficialDeadline` opcional, ISO).
  function scheduleResponseDate({
    fingerprint, fromDate, policy, maxOfficialDeadline,
  }) {
    const range = (policy && policy.responseDelayDaysRange) || DEFAULT_POLICY.responseDelayDaysRange;
    const days = Rnd().intFrom(fingerprint, 'response-delay', range.min, range.max);
    let due = LD().addDays(fromDate, days);
    if (maxOfficialDeadline && LD().isAfter(due, maxOfficialDeadline)) due = maxOfficialDeadline;
    return due;
  }

  function offerExpiryDate({ fingerprint, fromDate, policy, maxOfficialDeadline }) {
    const range = (policy && policy.offerExpiryDaysRange) || DEFAULT_POLICY.offerExpiryDaysRange;
    const defaultDays = (policy && policy.offerExpiryDaysDefault) || DEFAULT_POLICY.offerExpiryDaysDefault;
    const jitter = Rnd().intFrom(fingerprint, 'expiry-jitter', 0, Math.max(0, range.max - defaultDays));
    let due = LD().addDays(fromDate, Math.min(range.max, defaultDays + jitter));
    if (maxOfficialDeadline && LD().isAfter(due, maxOfficialDeadline)) due = maxOfficialDeadline;
    return due;
  }

  // Valoración deportiva SIMULADA (nunca una regla legal, nunca Potencial/
  // Ambición/Profesionalidad ocultos) a partir de medias VISIBLES
  // (technicalAverage/physicalAverage/mentalAverage) — sección 9.5:
  // "si un dato necesita scouting no implementado, degrada a banda, nunca
  // inventa certeza". `qualityIndex` 0-20, nunca se expone tal cual a la UI.
  function qualityIndex(player) {
    const technical = player.technicalAverage || 0;
    const physical = player.physicalAverage || 0;
    const mental = player.mentalAverage || 0;
    return (technical * 0.45) + (physical * 0.30) + (mental * 0.25);
  }

  // Objetivo económico SIMULADO (Minor, EUR-equivalente del contexto) —
  // política de juego, calibrada de forma burda contra la banda 0-20 de
  // qualityIndex; nunca se muestra al usuario como "el número real".
  function targetGuaranteedMinor(player) {
    const q = qualityIndex(player);
    const floorMinor = 1200000; // suelo simulado, nunca por debajo de un mínimo razonable de mercado
    const scaleMinor = 400000;
    return Math.round(floorMinor + (q * q) * scaleMinor);
  }

  // DTO de comparación puro (sección 10.2) — nunca presenta variable como
  // garantizada.
  function summarizeOfferDraft(contractDraft) {
    const seasons = (contractDraft.compensation && contractDraft.compensation.seasons) || [];
    const totals = seasons.reduce((acc, s) => {
      acc.guaranteedFixedMinor += s.guaranteedBaseSalaryMinor || 0;
      acc.imageAndInKindMinor += (s.guaranteedImageRightsMinor || 0) + (s.guaranteedSalaryInKindMinor || 0);
      acc.signingBonusMinor += s.signingBonusMinor || 0;
      acc.variableMaxMinor += (s.variableBonuses || []).reduce((sum, v) => sum + (v.amountMinor || 0), 0);
      return acc;
    }, {
      guaranteedFixedMinor: 0, imageAndInKindMinor: 0, signingBonusMinor: 0, variableMaxMinor: 0,
    });
    return {
      seasonsCount: seasons.length,
      guaranteedTotalMinor: totals.guaranteedFixedMinor + totals.imageAndInKindMinor + totals.signingBonusMinor,
      variableMaxMinor: totals.variableMaxMinor,
      guaranteeType: contractDraft.guaranteeType,
    };
  }

  // Evaluación cualitativa de UNA oferta (sección 9.5) — nunca expone
  // fitScore/umbral/peso, solo `decision` + mensajes cualitativos.
  // `priorOffers`: versiones anteriores del MISMO hilo (memoria de ofertas
  // rechazadas/retiradas — sección 9.6).
  function evaluateOffer({
    player, offer, priorOffers, rolePromise, fingerprint, policy, roundIndex,
  }) {
    const pol = policy || DEFAULT_POLICY;
    const summary = summarizeOfferDraft(offer.contractDraft);
    const seasonsCount = summary.seasonsCount;
    // `targetGuaranteedMinor` es un valor POR TEMPORADA — `summary.
    // guaranteedTotalMinor` suma TODAS las temporadas cubiertas, así que
    // el objetivo de comparación escala con el número de temporadas
    // (nunca comparar un total plurianual contra un objetivo anual: una
    // oferta larga y barata por temporada parecería siempre generosa).
    const target = targetGuaranteedMinor(player) * Math.max(1, seasonsCount);
    const economicRatio = Math.min(1.3, summary.guaranteedTotalMinor / Math.max(1, target));

    const durationScore = Math.min(1, seasonsCount / 3);

    const rp = rolePromise || (offer.rolePromise || {});
    const roleScore = rp.role === 'star' || rp.role === 'core' ? 1 : (rp.role === 'rotation' ? 0.7 : 0.4);

    const stabilityScore = offer.contractDraft.guaranteeType === 'fully-guaranteed' ? 1
      : (offer.contractDraft.guaranteeType === 'partially-guaranteed' ? 0.6 : 0.3);

    // La parte económica pesa más que el resto combinado (sección 9.5: el
    // jugador puede usar internamente Ambición/Profesionalidad para
    // decidir, pero la remuneración garantizada sigue siendo el factor
    // dominante para la mayoría de perfiles) — evita que un rol/duración
    // perfectos "compren" una oferta económicamente pobre.
    const fitScore = (economicRatio * 0.6) + (durationScore * 0.15) + (roleScore * 0.15) + (stabilityScore * 0.10);

    // Memoria de trato previo (sección 9.5/9.6): cada versión previa
    // rechazada/retirada erosiona un poco la paciencia — nunca "sube 5%
    // hasta acertar" desde cero, cada ronda parte de la relación real.
    const rejectedCount = (priorOffers || []).filter((o) => o.statusOn(offer.createdAt) === 'rejected').length;
    const patiencePenalty = rejectedCount * 0.03;

    const acceptThreshold = pol.acceptThresholdRange.min
      + Rnd().unitFrom(fingerprint, 'accept-threshold') * (pol.acceptThresholdRange.max - pol.acceptThresholdRange.min)
      + patiencePenalty;
    const counterThreshold = pol.counterThresholdRange.min
      + Rnd().unitFrom(fingerprint, 'counter-threshold') * (pol.counterThresholdRange.max - pol.counterThresholdRange.min);

    const maxRounds = Rnd().intFrom(fingerprint, 'max-rounds', pol.maxCounterRoundsRange.min, pol.maxCounterRoundsRange.max);

    const messages = [];
    let decision;
    if (fitScore >= acceptThreshold) {
      decision = 'accept';
      messages.push('La oferta cubre las expectativas del jugador.');
    } else if (fitScore >= counterThreshold && (roundIndex || 0) < maxRounds) {
      decision = 'counter';
      if (economicRatio < 0.85) messages.push('La parte garantizada es insuficiente.');
      if (durationScore < 0.6) messages.push('Prefiere más estabilidad/duración.');
      if (roleScore < 0.7) messages.push('Espera un rol mayor en la rotación.');
      if (stabilityScore < 1) messages.push('Prioriza garantía total sobre parcial/no garantizada.');
      if (!messages.length) messages.push('Cerca de un acuerdo, pero pide un último ajuste.');
    } else {
      decision = 'reject';
      messages.push(rejectedCount >= 2
        ? 'La distancia entre las partes sigue siendo demasiado grande tras varios intentos.'
        : 'La oferta queda lejos de lo que el jugador y su representación esperaban.');
    }

    return {
      decision,
      qualitativeMessages: messages,
      // Pista de ajuste NO numérica exacta para quien construya la
      // contraoferta — solo dirección, nunca el objetivo interno exacto.
      adjustmentHints: {
        economicGapDetected: economicRatio < 1,
        durationGapDetected: durationScore < 0.8,
        roleGapDetected: roleScore < 0.85,
        stabilityGapDetected: stabilityScore < 1,
      },
      roundIndex: (roundIndex || 0) + 1,
      maxRounds,
    };
  }

  // Genera un ajuste de contraoferta DETERMINISTA — concesiones
  // DECRECIENTES por ronda (sección 9.6: "no hay número fijo de rondas
  // universal; la paciencia deriva del contexto/política"), nunca un
  // incremento fijo del 5% hasta acertar.
  function generateCounterAdjustment({
    player, currentGuaranteedMinor, evaluation, fingerprint, policy, roundIndex,
  }) {
    const pol = policy || DEFAULT_POLICY;
    const target = targetGuaranteedMinor(player);
    const gap = Math.max(0, target - currentGuaranteedMinor);
    const baseFactor = pol.concessionFactorRange.min
      + Rnd().unitFrom(fingerprint, `concession-${roundIndex || 0}`) * (pol.concessionFactorRange.max - pol.concessionFactorRange.min);
    const decayedFactor = Math.max(0.1, baseFactor - (pol.concessionDecayPerRound * (roundIndex || 0)));
    const proposedGuaranteedMinor = Math.round(currentGuaranteedMinor + (gap * decayedFactor));
    return {
      proposedGuaranteedMinor,
      economicGapDetected: evaluation.adjustmentHints.economicGapDetected,
    };
  }

  // Interés inicial (consulta previa a la oferta, sección 3.6/12.1) —
  // banda cualitativa, nunca un número.
  function computeInitialInterest({ player, prospectiveClubId, fingerprint }) {
    const roll = Rnd().unitFrom(fingerprint, `initial-interest:${prospectiveClubId}`);
    const q = qualityIndex(player);
    // Un jugador de más nivel exige más "convencimiento" antes de mostrar
    // interés alto — sesga la tirada determinista, nunca la sustituye.
    const bias = Math.min(0.25, q / 80);
    const level = roll + bias >= 0.66 ? 'high' : (roll + bias >= 0.33 ? 'medium' : 'low');
    return { level };
  }

  const exportsObj = {
    NegotiationService: {
      NEGOTIATION_POLICY_VERSION,
      DEFAULT_POLICY,
      buildFingerprint,
      scheduleResponseDate,
      offerExpiryDate,
      qualityIndex,
      targetGuaranteedMinor,
      summarizeOfferDraft,
      evaluateOffer,
      generateCounterAdjustment,
      computeInitialInterest,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
