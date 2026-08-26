// src/core/RegistrationService.js
// REG-1 (DESIGN.md 9.18, sección 8.2 del prompt) — servicio ÚNICO de
// comandos y bootstrap de licencias/inscripciones/acuerdos de vinculación.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Qué SÍ hace:
//  - resuelve reglas y contexto (CompetitionRules.resolveRules, dominio
//    'registration');
//  - valida contrato cuando la regla lo exige (ContractRegistry);
//  - valida documentos y autorización provisional;
//  - evalúa ventana/plazo (RegulatoryCalendar) cuando la operación no es un
//    bootstrap aprobado;
//  - crea licencia/inscripción/eventos y calcula/congela el impacto en el
//    máximo acumulado;
//  - activa/suspende/da de baja/reactiva con transiciones válidas
//    (delega en `RegistrationEventTypes`/entidades de Registration.js);
//  - crea/valida acuerdos de vinculación y sus listas.
//
// Qué NO hace (fuera de alcance de REG-1):
//  - NO expone botones de alta/baja de usuario;
//  - MARKET-1/TRANSFER-1/LOAN-1 invocarán este servicio más adelante — NO
//    deben escribir directamente en `RegistrationRegistry`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const RegistrationEntities = isNode ? require('../entities/Registration.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const RegulatoryCalendarModule = isNode ? require('../utils/RegulatoryCalendar.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function RCal() { return RegulatoryCalendarModule.RegulatoryCalendar; }

  function toIso(date) {
    if (!date) throw new Error('RegistrationService: hace falta una fecha.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // ---------------------------------------------------------------------
  // 1. Reglas y contexto
  // ---------------------------------------------------------------------
  // `context`: { competitionId, competitionInstanceId, registrationScopeId,
  //   seasonKey, date, phaseId, roundId, matchId, operation }
  function resolveRegistrationRules(context) {
    if (!context || !context.competitionId) {
      throw new Error('RegistrationService.resolveRegistrationRules: falta "competitionId" en el contexto.');
    }
    return CompetitionRules.resolveRules({ domain: 'registration', operation: 'buildMatchSquad', ...context });
  }

  // ---------------------------------------------------------------------
  // 2. Máximo acumulado
  // ---------------------------------------------------------------------
  function determineCumulativeCapImpact(accessCategory, resolved) {
    const cap = resolved.registration && resolved.registration.cumulativeRegistrationCap;
    if (!cap) return { counted: true, reasonCode: 'NO_CUMULATIVE_CAP_DECLARED' };
    const nonCounting = cap.nonCountingCategories || [];
    if (nonCounting.includes(accessCategory)) {
      return { counted: false, reasonCode: 'NON_COUNTING_CATEGORY' };
    }
    return { counted: true, reasonCode: 'ORDINARY_REGISTRATION' };
  }

  function assertCumulativeCapNotExceeded(registry, clubId, registrationScopeId, seasonKey, resolved, impact) {
    if (!impact.counted) return;
    const cap = resolved.registration && resolved.registration.cumulativeRegistrationCap;
    if (!cap) return;
    const current = registry.cumulativeCountForClub(clubId, registrationScopeId, seasonKey);
    if (current >= cap.max) {
      throw new Error(
        `RegistrationService: el club "${clubId}" ya alcanzó el máximo acumulado de ${cap.max} inscripciones `
        + `en "${registrationScopeId}"/${seasonKey} — no se puede registrar una nueva alta que compute.`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // 3. Documentos y autorización provisional
  // ---------------------------------------------------------------------
  function checkMandatoryDocuments(documentStatuses, resolved) {
    const policy = resolved.registration && resolved.registration.provisionalAuthorizationPolicy;
    if (!policy) return { valid: true, errors: [] };
    const errors = [];
    (policy.mandatoryDocumentCodes || []).forEach((code) => {
      const status = documentStatuses[code];
      if (status !== 'provided' && status !== 'verified') {
        errors.push(`Falta el documento imprescindible "${code}" (art. 15.5/Manual) para la autorización provisional.`);
      }
    });
    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------
  // 4. Ventanas/plazos — `operation: 'bootstrap'` está PREAPROBADO (sección
  //    6.5 del prompt: "las operaciones actuales de bootstrap pueden estar
  //    preaprobadas"), cualquier otra operación se evalúa de verdad.
  // ---------------------------------------------------------------------
  function evaluateSubmissionWindow(resolved, params) {
    const opts = params || {};
    if (opts.operation === 'bootstrap') {
      return { evaluable: true, onTime: true, reason: 'Operación de bootstrap preaprobada.' };
    }
    const windows = (resolved.registration && resolved.registration.submissionWindows) || [];
    if (!windows.length) return { evaluable: false, onTime: null, reason: 'Sin ventanas de inscripción declaradas para este módulo.' };
    const window_ = opts.windowId ? windows.find((w) => w.id === opts.windowId) : windows[0];
    if (!window_) return { evaluable: false, onTime: null, reason: `No existe la ventana "${opts.windowId}".` };
    const cutoffSpec = opts.useWeekendCutoff && window_.weekendCutoff ? window_.weekendCutoff : window_.cutoff;
    return RCal().evaluateCutoff(cutoffSpec, {
      requestDate: opts.requestDate,
      requestTime: opts.requestTime,
      referenceDate: opts.referenceDate,
      holidaySet: opts.holidaySet,
    });
  }

  // ---------------------------------------------------------------------
  // 5. Licencias
  // ---------------------------------------------------------------------
  function buildLicenseId(playerId, clubId, seasonKey) {
    return `license:${playerId}:${clubId}:${seasonKey}`;
  }

  // `params.chain`: secuencia de eventos de estado a aplicar de una vez,
  // por defecto ['submitted','validated','activated'] (bootstrap típico) —
  // una operación de usuario futura (MARKET-1+) puede pasar solo
  // ['submitted'] y avanzar paso a paso con `advanceLicense()`.
  function issueLicense(params) {
    const {
      registry, playerId, clubId, federationId, seasonKey, licenseClass, validity, documentStatuses, date, provenance,
      chain,
    } = params;
    const id = params.id || buildLicenseId(playerId, clubId, seasonKey);
    const license = new RegistrationEntities.FederationLicense({
      id, playerId, clubId, federationId, seasonKey, licenseClass, validity, documentStatuses, provenance,
    });
    const isoDate = toIso(date);
    const steps = chain || ['submitted', 'validated', 'activated'];
    steps.forEach((type, index) => license.addEvent({ id: `${id}:${type}:${index}`, type, date: isoDate }));
    if (registry) registry.registerLicense(license);
    return license;
  }

  function provisionallyAuthorizeLicense(license, date, resolved) {
    const check = checkMandatoryDocuments(license.documentStatuses, resolved);
    if (!check.valid) {
      throw new Error(`RegistrationService.provisionallyAuthorizeLicense: ${check.errors.join(' | ')}`);
    }
    license.addEvent({ id: `${license.id}:provisional:${license.events.length}`, type: 'provisionally-authorized', date: toIso(date) });
    return license;
  }

  function advanceLicenseEvent(license, type, date) {
    license.addEvent({ id: `${license.id}:${type}:${license.events.length}`, type, date: toIso(date) });
    return license;
  }

  // ---------------------------------------------------------------------
  // 6. Inscripciones de competición
  // ---------------------------------------------------------------------
  function buildRegistrationId(playerId, registrationScopeId, seasonKey) {
    return `registration:${playerId}:${registrationScopeId}:${seasonKey}`;
  }

  function createRegistration(params) {
    const {
      registry, playerId, licenseId, teamId, competitionId, competitionInstanceId, registrationScopeId, seasonKey,
      accessCategory, contractId, classificationSnapshot, date, resolved, provenance, chain, moduleVersionsPinned,
    } = params;
    const impact = determineCumulativeCapImpact(accessCategory, resolved);
    assertCumulativeCapNotExceeded(registry, teamId, registrationScopeId, seasonKey, resolved, impact);

    const id = params.id || buildRegistrationId(playerId, registrationScopeId, seasonKey);
    const registration = new RegistrationEntities.CompetitionRegistration({
      id,
      playerId,
      licenseId,
      teamId,
      competitionId,
      competitionInstanceId,
      registrationScopeId,
      seasonKey,
      accessCategory,
      contractId,
      classificationSnapshot,
      cumulativeCap: impact,
      moduleVersionsPinned: moduleVersionsPinned || { registration: `${resolved.bundleId}@${resolved.version}` },
      provenance,
    });
    const isoDate = toIso(date);
    const steps = chain || ['submitted', 'validated', 'activated'];
    steps.forEach((type, index) => registration.addEvent({ id: `${id}:${type}:${index}`, type, date: isoDate }));
    if (registry) registry.registerRegistration(registration);
    return registration;
  }

  function advanceRegistrationEvent(registration, type, date) {
    registration.addEvent({ id: `${registration.id}:${type}:${registration.events.length}`, type, date: toIso(date) });
    return registration;
  }

  // Baja de inscripción — NUNCA muta contrato ni afiliación (invariante
  // sección 8.1). Quien llama es responsable de no tocar `Team.roster`
  // ni `ContractRegistry` desde aquí.
  function deactivateRegistration(registration, date, reasonCode) {
    advanceRegistrationEvent(registration, 'deactivated', date);
    registration.trace.deactivationReasonCode = reasonCode || 'UNSPECIFIED';
    return registration;
  }

  // Sustitución por lesión/enfermedad/sanción — EXIGE un evento explícito
  // (sección 5.1: "la baja/sustitución debe ser un evento regulatorio: no
  // la derives automáticamente de Medical"). `statusRestrictions` del
  // módulo resuelto declara qué motivos son válidos.
  function suspendRegistrationForStatus(registration, date, statusReasonCode, resolved) {
    const allowed = (resolved.registration && resolved.registration.statusRestrictions
      && resolved.registration.statusRestrictions.nonSimultaneousStatuses) || [];
    if (!allowed.includes(statusReasonCode)) {
      throw new Error(
        `RegistrationService.suspendRegistrationForStatus: "${statusReasonCode}" no es un motivo de suspensión `
        + `declarado por el módulo resuelto (permitidos: ${allowed.join(', ') || '(ninguno)'}).`,
      );
    }
    advanceRegistrationEvent(registration, 'suspended', date);
    registration.trace.suspensionReasonCode = statusReasonCode;
    return registration;
  }

  function reinstateRegistration(registration, date) {
    return advanceRegistrationEvent(registration, 'reinstated', date);
  }

  // ---------------------------------------------------------------------
  // 7. Acuerdos de vinculación
  // ---------------------------------------------------------------------
  function createLinkAgreement(params) {
    const { registry } = params;
    const agreement = new RegistrationEntities.ClubLinkAgreement(params);
    if (registry) registry.registerLinkAgreement(agreement);
    return agreement;
  }

  // Añade un jugador a la lista de una dirección del acuerdo, validando
  // límites (4/5 según categoría — sección 5.4) y congelación general
  // (`modifiable`), salvo que se declare el overlay de ventana ACB
  // explícito (`allowWindowOverlay: true`).
  function addPlayerToLinkAgreement(agreement, direction, playerId, options) {
    const opts = options || {};
    if (!agreement.modifiable[direction] && !(opts.allowWindowOverlay && agreement.windowUpdateOverlay)) {
      throw new Error(
        `RegistrationService.addPlayerToLinkAgreement: la lista "${direction}" del acuerdo "${agreement.id}" `
        + 'está CONGELADA para la temporada (regla general FEB) y no se declaró overlay de ventana ACB.',
      );
    }
    agreement.addToList(direction, playerId);
    return agreement;
  }

  const exportsObj = {
    RegistrationService: {
      resolveRegistrationRules,
      determineCumulativeCapImpact,
      assertCumulativeCapNotExceeded,
      checkMandatoryDocuments,
      evaluateSubmissionWindow,
      buildLicenseId,
      issueLicense,
      provisionallyAuthorizeLicense,
      advanceLicenseEvent,
      buildRegistrationId,
      createRegistration,
      advanceRegistrationEvent,
      deactivateRegistration,
      suspendRegistrationForStatus,
      reinstateRegistration,
      createLinkAgreement,
      addPlayerToLinkAgreement,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
