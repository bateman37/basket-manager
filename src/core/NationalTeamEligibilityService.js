// src/core/NationalTeamEligibilityService.js
// NATIONAL-TEAMS-1 (DESIGN.md 10.17) — punto ÚNICO de elegibilidad de
// NACIONALIDAD DEPORTIVA de un jugador para una federación+área
// representada concretas. Separado de `EligibilityService.js` (elegibilidad
// de PARTIDO doméstico) pero con el mismo espíritu conservador de REG-1:
// un dato ausente produce `unknown`, NUNCA se convierte silenciosamente en
// favorable. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Puro: recibe TODO como parámetros explícitos, nunca lee `state`/DOM/fecha
// global. Consultar NUNCA crea una decisión, una convocatoria ni un
// receipt (invariante 18).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const LocalDateModule = dep('../utils/LocalDate.js');

  function LD() { return LocalDateModule.LocalDate; }

  const REASON_CODES = {
    PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
    PASSPORT_NOT_DEMONSTRATED: 'PASSPORT_NOT_DEMONSTRATED',
    PASSPORT_INVALID_OR_EXPIRED: 'PASSPORT_INVALID_OR_EXPIRED',
    DECISION_DENIED: 'DECISION_DENIED',
    DECISION_PENDING: 'DECISION_PENDING',
    RESTRICTED_SLOT: 'RESTRICTED_SLOT',
    PRIOR_FEDERATION_COMMITMENT_REQUIRES_CHANGE_CASE: 'PRIOR_FEDERATION_COMMITMENT_REQUIRES_CHANGE_CASE',
    NATIONALITY_DECISION_REQUIRED: 'NATIONALITY_DECISION_REQUIRED',
  };

  const STATUSES = ['eligible', 'eligible-restricted', 'ineligible', 'pending-decision', 'unknown'];

  function result(status, { reasonCodes, evidenceIds, warnings, trace }) {
    if (!STATUSES.includes(status)) throw new Error(`NationalTeamEligibilityService: status "${status}" no válido.`);
    return {
      status,
      reasonCodes: reasonCodes || [],
      evidenceIds: evidenceIds || [],
      warnings: warnings || [],
      trace,
    };
  }

  // `params`: { playerId, federationOrganizationId, representedAreaId,
  //   date (fecha civil ISO) }.
  // `deps`: { playerRegistry, registrationRegistry (opcional, para el
  //   `PlayerRegulatoryProfile` con `passportEvidences`),
  //   nationalTeamRegistry (opcional, para decisiones/compromisos previos),
  //   rulesetBundleId }.
  function evaluateNationalEligibility(params, deps) {
    const {
      playerId, federationOrganizationId, representedAreaId, date,
    } = params;
    const trace = { rulesetBundleId: deps.rulesetBundleId || null, sourceRuleIds: [], versions: {} };

    if (!deps.playerRegistry || !deps.playerRegistry.has(playerId)) {
      return result('unknown', { reasonCodes: [REASON_CODES.PLAYER_NOT_FOUND], trace });
    }

    // 1. Una decisión EXPLÍCITA ya resuelta manda siempre — nunca se
    // recalcula por debajo de ella (sección 5.2: "resolución aprobada
    // restringida -> eligible-restricted").
    const decision = deps.nationalTeamRegistry
      ? deps.nationalTeamRegistry.latestActiveDecisionForPlayer(playerId, federationOrganizationId, representedAreaId, date)
      : null;
    if (decision) {
      trace.sourceRuleIds.push(...(decision.sourceRuleIds || []));
      if (decision.status === 'denied') {
        return result('ineligible', { reasonCodes: [REASON_CODES.DECISION_DENIED], evidenceIds: decision.evidenceIds, trace });
      }
      if (decision.status === 'approved-unrestricted') {
        return result('eligible', { evidenceIds: decision.evidenceIds, trace });
      }
      if (decision.status === 'approved-restricted') {
        return result('eligible-restricted', { reasonCodes: [REASON_CODES.RESTRICTED_SLOT], evidenceIds: decision.evidenceIds, trace });
      }
      // 'pending' — un caso que exige resolución externa y todavía no la
      // tiene (sección 5.2).
      return result('pending-decision', { reasonCodes: [REASON_CODES.DECISION_PENDING], evidenceIds: decision.evidenceIds, trace });
    }

    // 2. Sin decisión explícita: se mira el pasaporte declarado.
    const profile = deps.registrationRegistry ? deps.registrationRegistry.getProfile(playerId) : null;
    const passport = profile && Array.isArray(profile.passportEvidences)
      ? profile.passportEvidences.find((p) => p.areaId === representedAreaId)
      : null;

    if (!passport) {
      return result('unknown', { reasonCodes: [REASON_CODES.PASSPORT_NOT_DEMONSTRATED], trace });
    }
    const expired = passport.expiryDate ? LD().isBefore(passport.expiryDate, date) : false;
    if (passport.verificationStatus === 'invalid' || expired) {
      return result('ineligible', {
        reasonCodes: [REASON_CODES.PASSPORT_INVALID_OR_EXPIRED],
        evidenceIds: [passport.id].filter(Boolean),
        trace,
      });
    }

    // 3. Compromiso oficial previo con OTRA federación (apariciones
    // oficiales registradas) — bloquea/exige expediente de cambio, nunca se
    // resuelve solo (sección 5.2).
    const priorCommitment = deps.nationalTeamRegistry
      ? deps.nationalTeamRegistry.appearancesForPlayer(playerId)
        .find((a) => a.official && a.federationOrganizationId !== federationOrganizationId)
      : null;
    if (priorCommitment) {
      return result('pending-decision', {
        reasonCodes: [REASON_CODES.PRIOR_FEDERATION_COMMITMENT_REQUIRES_CHANGE_CASE],
        evidenceIds: [priorCommitment.id],
        warnings: [`El jugador "${playerId}" tiene una aparición oficial previa con otra federación — exige un expediente de cambio de nacionalidad deportiva antes de poder evaluarse.`],
        trace,
      });
    }

    // 4. Pasaporte válido pero SIN decisión explícita todavía — nunca se
    // infiere favorable por tener solo pasaporte (sección 5.2: "consultar
    // nunca crea una resolución").
    return result('pending-decision', {
      reasonCodes: [REASON_CODES.NATIONALITY_DECISION_REQUIRED],
      evidenceIds: [passport.id].filter(Boolean),
      warnings: [`El jugador "${playerId}" tiene pasaporte/nacionalidad demostrada para "${representedAreaId}" pero ninguna NationalStatusDecision explícita — hace falta abrir el expediente.`],
      trace,
    });
  }

  // La lista final SOLO acepta 'eligible'/'eligible-restricted' (sección
  // 5.2 e invariante 9 — "unknown y pending-decision nunca se convierten en
  // elegibles").
  function isFinalListEligible(status) {
    return status === 'eligible' || status === 'eligible-restricted';
  }

  const exportsObj = {
    NationalTeamEligibilityService: {
      REASON_CODES,
      STATUSES,
      evaluateNationalEligibility,
      isFinalListEligible,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
