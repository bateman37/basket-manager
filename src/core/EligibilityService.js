// src/core/EligibilityService.js
// REG-1 (DESIGN.md 9.18, sección 8.4 del prompt) — punto ÚNICO de
// elegibilidad INDIVIDUAL de un jugador para un partido/contexto concreto.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Puro respecto a la UI: recibe TODOS los registros/reglas/contexto como
// parámetros explícitos, nunca lee `state`/DOM/fecha global. `Medical.
// getAvailability()` sigue siendo la ÚNICA autoridad médica — este
// servicio la INTEGRA, nunca la duplica.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const RegistrationServiceModule = isNode ? require('./RegistrationService.js') : global.BasketManager;
  const ClassificationModule = isNode ? require('./RegulatoryClassificationService.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function RegSvc() { return RegistrationServiceModule.RegistrationService; }
  function Classification() { return ClassificationModule.RegulatoryClassificationService; }
  function LD() { return LocalDateModule.LocalDate; }

  // Códigos de razón ESTABLES (sección 8.4 del prompt de REG-1) — nunca
  // texto en español como clave de lógica.
  const REASON_CODES = {
    PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
    NO_VALID_FEDERATION_LICENSE: 'NO_VALID_FEDERATION_LICENSE',
    LICENSE_SUSPENDED: 'LICENSE_SUSPENDED',
    NOT_REGISTERED_IN_SCOPE: 'NOT_REGISTERED_IN_SCOPE',
    REGISTRATION_NOT_EFFECTIVE: 'REGISTRATION_NOT_EFFECTIVE',
    REGISTRATION_SUSPENDED: 'REGISTRATION_SUSPENDED',
    CONTRACT_NOT_ACTIVE: 'CONTRACT_NOT_ACTIVE',
    // BUG-REG1-07 (DESIGN.md 9.19): la inscripción referencia un contrato
    // que existe y está vigente, pero pertenece a OTRO jugador o a OTRO
    // club — nunca se corrige en silencio, se rechaza con un motivo
    // estable y no ambiguo (distinto de CONTRACT_NOT_ACTIVE, que es sobre
    // vigencia, no sobre identidad).
    CONTRACT_PLAYER_MISMATCH: 'CONTRACT_PLAYER_MISMATCH',
    CONTRACT_CLUB_MISMATCH: 'CONTRACT_CLUB_MISMATCH',
    MANDATORY_DOCUMENT_MISSING: 'MANDATORY_DOCUMENT_MISSING',
    PROVISIONAL_AUTHORIZATION_INVALID: 'PROVISIONAL_AUTHORIZATION_INVALID',
    INTERNATIONAL_CLEARANCE_REQUIRED: 'INTERNATIONAL_CLEARANCE_REQUIRED',
    LINK_AGREEMENT_INVALID: 'LINK_AGREEMENT_INVALID',
    LINKED_PLAYER_NOT_ON_LIST: 'LINKED_PLAYER_NOT_ON_LIST',
    LINKED_PLAYER_AGE_OR_CATEGORY_INVALID: 'LINKED_PLAYER_AGE_OR_CATEGORY_INVALID',
    SAME_COMPETITION_LINK_INEFFECTIVE: 'SAME_COMPETITION_LINK_INEFFECTIVE',
    ALREADY_ON_OTHER_ACT_SAME_ROUND: 'ALREADY_ON_OTHER_ACT_SAME_ROUND',
    MEDICALLY_UNAVAILABLE: 'MEDICALLY_UNAVAILABLE',
    DISCIPLINARY_SUSPENSION: 'DISCIPLINARY_SUSPENSION',
    CLASSIFICATION_UNKNOWN: 'CLASSIFICATION_UNKNOWN',
  };

  function reason(code, severity, params, sourceRuleIds) {
    return { code, severity: severity || 'blocking', params: params || {}, sourceRuleIds: sourceRuleIds || [] };
  }

  // `context`: { competitionId, competitionInstanceId, seasonKey, date,
  //   phaseId, roundId, matchId, operation }. `registrationScopeId` NUNCA
  // se lee de aquí — es un dato RESUELTO (declarado en el bundle) que esta
  // función obtiene de `RegistrationService.resolveRegistrationRules(context)`
  // (ver `resolved.registrationScopeId` más abajo); pasarlo en `context` de
  // entrada sería una segunda fuente de verdad que podría desincronizarse.
  // `deps`: { playerRegistry, contractRegistry, registrationRegistry,
  //   medicalAvailability (Map opcional playerId->{status,minuteCap}),
  //   disciplinarySuspensions (Map opcional playerId->boolean),
  //   classificationCache (Map opcional) }
  function evaluateEligibility(playerId, teamId, context, deps) {
    const warnings = [];
    const reasons = [];
    const trace = { sourceRuleIds: [], fieldRules: {} };

    if (!deps.playerRegistry.has(playerId)) {
      return {
        eligible: false, playerId, teamId, context, accessCategory: null, licenseStatus: null,
        registrationStatus: null, classification: null,
        reasons: [reason(REASON_CODES.PLAYER_NOT_FOUND, 'blocking')],
        warnings, trace,
      };
    }

    const resolved = RegSvc().resolveRegistrationRules(context);
    trace.sourceRuleIds.push(resolved.bundleId);
    warnings.push(...(resolved.warnings || []));

    // El ámbito de inscripción es un dato RESUELTO (declarado en el
    // bundle, ver CompetitionRules.js) — nunca se lee de `context` (que
    // solo declara `competitionId`/fecha/fase): `resolved.registrationScopeId`
    // es la única fuente correcta.
    const registry = deps.registrationRegistry;
    // `registrationForScopeSeason` (no `currentRegistration`, que solo
    // devuelve inscripciones ACTIVAS): esta función necesita distinguir
    // "nunca inscrito" de "inscrito pero suspendido/desactivado/expirado"
    // para emitir el código de motivo correcto — con `currentRegistration`
    // ambos casos eran indistinguibles (bug encontrado en verificación de
    // interfaz real, ver `RegistrationRegistry.registrationForScopeSeason`).
    const registration = registry.registrationForScopeSeason(playerId, resolved.registrationScopeId, context.seasonKey);
    let accessCategory = null;
    let licenseStatus = null;
    let registrationStatus = null;

    if (!registration) {
      reasons.push(reason(REASON_CODES.NOT_REGISTERED_IN_SCOPE, 'blocking', { registrationScopeId: resolved.registrationScopeId }));
    } else {
      accessCategory = registration.accessCategory;
      registrationStatus = registration.statusOn(context.date);
      const license = registry.getLicense(registration.licenseId);
      licenseStatus = license ? license.statusOn(context.date) : null;

      if (!license || !license.isValidOn(context.date)) {
        reasons.push(reason(REASON_CODES.NO_VALID_FEDERATION_LICENSE, 'blocking'));
      } else if (licenseStatus === 'suspended') {
        reasons.push(reason(REASON_CODES.LICENSE_SUSPENDED, 'blocking'));
      }

      if (registrationStatus === 'suspended') {
        reasons.push(reason(REASON_CODES.REGISTRATION_SUSPENDED, 'blocking', { reasonCode: registration.trace.suspensionReasonCode || null }));
      } else if (registrationStatus !== 'active') {
        reasons.push(reason(REASON_CODES.REGISTRATION_NOT_EFFECTIVE, 'blocking', { status: registrationStatus }));
      }

      // Inscripción senior activa exige contrato vigente (sección 8.1).
      if (accessCategory === 'senior') {
        const contract = registration.contractId && deps.contractRegistry ? deps.contractRegistry.get(registration.contractId) : null;
        if (!contract) {
          reasons.push(reason(REASON_CODES.CONTRACT_NOT_ACTIVE, 'blocking'));
        } else if (contract.playerId !== registration.playerId) {
          // BUG-REG1-07: el contrato existe pero es de OTRO jugador —
          // nunca se acepta como si acreditara relación laboral de este.
          reasons.push(reason(REASON_CODES.CONTRACT_PLAYER_MISMATCH, 'blocking'));
        } else if (contract.clubId !== registration.teamId) {
          // BUG-REG1-07: el contrato existe, es del jugador correcto, pero
          // con OTRO club — tampoco acredita relación laboral con el club
          // que está inscribiéndolo.
          reasons.push(reason(REASON_CODES.CONTRACT_CLUB_MISMATCH, 'blocking'));
        } else if (!contract.isActiveOn(context.date)) {
          // BUG-REG1-08: elegibilidad de PARTIDO exige relación laboral
          // ACTIVA hoy, no "vigente o pendiente" (isCurrentOn incluye un
          // contrato ya firmado que todavía no ha empezado — útil para
          // compromisos de nómina/solapamientos, pero no para acreditar
          // que hoy hay relación laboral para disputar un partido).
          reasons.push(reason(REASON_CODES.CONTRACT_NOT_ACTIVE, 'blocking'));
        }
      }

      // Documentos imprescindibles (autorización provisional) — si el
      // registro guardó una licencia con documentos incompletos.
      if (license) {
        const docCheck = RegSvc().checkMandatoryDocuments(license.documentStatuses, resolved);
        if (!docCheck.valid) {
          reasons.push(reason(REASON_CODES.MANDATORY_DOCUMENT_MISSING, 'blocking', { errors: docCheck.errors }));
        }
      }
    }

    // Clasificación (formación/no comunitario) — CLASSIFICATION_UNKNOWN es
    // warning, nunca bloqueante por sí solo (una plaza "unknown" se trata
    // como no-formación/cuenta como no-comunitario a efectos de cupos
    // colectivos, decisión conservadora documentada en
    // SquadEligibilityService — nunca "unknown" se convierte en favorable).
    const profile = deps.registrationRegistry.getProfile(playerId);
    const classification = Classification().classifyPlayer(
      playerId, profile, context, deps.classificationCache,
    );
    if (classification.formation.status === 'unknown' || classification.nonCommunitySlot.status === 'unknown') {
      reasons.push(reason(REASON_CODES.CLASSIFICATION_UNKNOWN, 'informational'));
    }

    // Médico — integra Medical.js, nunca lo duplica.
    if (deps.medicalAvailability) {
      const info = deps.medicalAvailability.get(playerId);
      if (info && info.status === 'unavailable') {
        reasons.push(reason(REASON_CODES.MEDICALLY_UNAVAILABLE, 'blocking'));
      }
    }

    // Disciplinario — hook de estado, sección 8.4: "separa razones
    // regulatorias, médicas y disciplinarias por categoría".
    if (deps.disciplinarySuspensions && deps.disciplinarySuspensions.get(playerId)) {
      reasons.push(reason(REASON_CODES.DISCIPLINARY_SUSPENSION, 'blocking'));
    }

    // Vinculados: comprobaciones específicas cuando accessCategory==='linked'.
    if (accessCategory === 'linked' && deps.linkAgreement) {
      const agreement = deps.linkAgreement;
      const direction = deps.linkDirection || 'lowerToUpper';
      if (!agreement.isEffectiveForCompetition(deps.lowerClubCompetitionId, deps.upperClubCompetitionId)) {
        reasons.push(reason(REASON_CODES.SAME_COMPETITION_LINK_INEFFECTIVE, 'blocking'));
      } else if (!agreement.listContains(direction, playerId)) {
        reasons.push(reason(REASON_CODES.LINKED_PLAYER_NOT_ON_LIST, 'blocking'));
      }
    }

    // Doble acta misma jornada (mismo ámbito) — sección 5.1 del prompt.
    if (context.roundId !== undefined && context.roundId !== null && deps.registrationRegistry.playerAlreadyOnActThisRound) {
      const clash = deps.registrationRegistry.playerAlreadyOnActThisRound(
        playerId, resolved.registrationScopeId, context.seasonKey, context.roundId, context.matchId,
      );
      if (clash) reasons.push(reason(REASON_CODES.ALREADY_ON_OTHER_ACT_SAME_ROUND, 'blocking'));
    }

    const blocking = reasons.filter((r) => r.severity === 'blocking');
    return {
      eligible: blocking.length === 0,
      playerId,
      teamId,
      context,
      accessCategory,
      licenseStatus,
      registrationStatus,
      classification,
      reasons,
      warnings,
      trace,
    };
  }

  const exportsObj = {
    EligibilityService: {
      REASON_CODES,
      evaluateEligibility,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
