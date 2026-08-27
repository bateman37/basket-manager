// src/entities/Market.js
// MARKET-1 (DESIGN.md 9.19, secciones 8.4-8.7 del prompt) — Entidades del
// PROCESO previo a una incorporación: hilo de negociación, oferta
// contractual inmutable/versionada, acuerdo en principio y los
// procedimientos de derecho preferente ACB. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Ninguna entidad de este archivo muta `Team.roster`, `player.teamId`,
// crea/registra un `Contract` ni concede licencia/inscripción — son
// artefactos PREVIOS, consumidos por TRANSFER-1 (sección 1 del prompt).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MarketEventTypesModule = isNode ? require('../core/MarketEventTypes.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function Events() { return MarketEventTypesModule.MarketEventTypes; }

  function toIso(date) {
    if (!date) throw new Error('Market: hace falta una fecha.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function appendValidatedEvent(machine, events, event, label) {
    const check = machine.validateEvent(event, events);
    if (!check.valid) throw new Error(`${label}: evento inválido — ${check.errors.join(' | ')}`);
    return [...events, event].sort((a, b) => (machine.eventSortKey(a) < machine.eventSortKey(b) ? -1 : 1));
  }

  // ---------------------------------------------------------------------
  // NegotiationThread (sección 8.4)
  // ---------------------------------------------------------------------
  class NegotiationThread {
    constructor(data = {}) {
      ['id', 'playerId', 'actingClubId', 'openedAt'].forEach((field) => {
        if (!data[field]) throw new Error(`NegotiationThread: falta "${field}".`);
      });
      this.id = data.id;
      this.playerId = data.playerId;
      this.actingClubId = data.actingClubId;
      // Mandato del agente que ACTÚA en esta operación concreta — un hilo
      // identifica el mandato exacto (sección 8.2: "un hilo identifica el
      // mandato concreto que actúa"), null si el jugador se autorrepresenta.
      this.actingMandateId = data.actingMandateId || null;
      this.prospectiveCompetitionIds = [...(data.prospectiveCompetitionIds || [])];
      this.openedAt = toIso(data.openedAt);
      // Congela reglas/versiones AL ABRIRSE (sección 9.1/9.3 del prompt) —
      // una actualización de reglas nunca reescribe un hilo ya vivo.
      this.rulesSnapshot = data.rulesSnapshot ? { ...data.rulesSnapshot } : null;
      this.marketPolicyVersion = data.marketPolicyVersion || null;
      this.events = [];
      // `inquiry-opened` es implícito a la creación — mismo criterio que
      // `offer-sent` en ContractOffer (un hilo sin este evento no existe).
      this.addEvent({ id: `${this.id}:inquiry-opened`, type: 'inquiry-opened', date: this.openedAt });
      (data.events || []).filter((e) => e.type !== 'inquiry-opened').forEach((event) => this.addEvent(event));
      this.offerIds = [...(data.offerIds || [])];
      this.agreementId = data.agreementId || null;
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().ThreadEvents, this.events, event, `NegotiationThread "${this.id}"`);
      return this;
    }

    statusOn(date) {
      return Events().ThreadEvents.deriveStatus(this.events, date ? toIso(date) : null);
    }

    addOfferId(offerId) {
      if (!this.offerIds.includes(offerId)) this.offerIds.push(offerId);
      return this;
    }

    setAgreementId(agreementId) {
      this.agreementId = agreementId;
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        actingClubId: this.actingClubId,
        actingMandateId: this.actingMandateId,
        prospectiveCompetitionIds: this.prospectiveCompetitionIds,
        openedAt: this.openedAt,
        rulesSnapshot: this.rulesSnapshot,
        marketPolicyVersion: this.marketPolicyVersion,
        events: this.events,
        offerIds: this.offerIds,
        agreementId: this.agreementId,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // ContractOffer (sección 8.5) — INMUTABLE y versionada: el `contractDraft`
  // y demás campos económicos nunca cambian tras construirse; solo su
  // ledger de eventos avanza (envío/contraoferta/rechazo/retirada/
  // expiración/aceptación).
  // ---------------------------------------------------------------------
  const OFFERED_BY_VALUES = ['club', 'player-side'];
  const ROLE_PROMISE_ROLES = ['star', 'core', 'rotation', 'development', 'depth'];

  function normalizeRolePromise(data) {
    if (!data) return { role: null, expectedMinutesBand: null };
    if (data.role && !ROLE_PROMISE_ROLES.includes(data.role)) {
      throw new Error(`ContractOffer: rolePromise.role desconocido "${data.role}".`);
    }
    return {
      role: data.role || null,
      expectedMinutesBand: data.expectedMinutesBand
        ? { min: data.expectedMinutesBand.min, max: data.expectedMinutesBand.max } : null,
    };
  }

  class ContractOffer {
    constructor(data = {}) {
      ['id', 'threadId', 'version', 'offeredBy', 'createdAt', 'expiresAt', 'playerId', 'clubId', 'contractDraft'].forEach((field) => {
        if (data[field] === undefined || data[field] === null) throw new Error(`ContractOffer: falta "${field}".`);
      });
      if (!OFFERED_BY_VALUES.includes(data.offeredBy)) {
        throw new Error(`ContractOffer: "offeredBy" desconocido "${data.offeredBy}" (admitidos: ${OFFERED_BY_VALUES.join(', ')}).`);
      }
      if (!Number.isInteger(data.version) || data.version < 1) {
        throw new Error('ContractOffer: "version" debe ser un entero >= 1.');
      }
      this.id = data.id;
      this.threadId = data.threadId;
      this.version = data.version;
      this.parentOfferId = data.parentOfferId || null;
      this.offeredBy = data.offeredBy;
      this.createdAt = toIso(data.createdAt);
      this.expiresAt = toIso(data.expiresAt);
      if (LD().isBefore(this.expiresAt, this.createdAt)) {
        throw new Error('ContractOffer: "expiresAt" no puede ser anterior a "createdAt".');
      }
      this.playerId = data.playerId;
      this.clubId = data.clubId;
      // Snapshot congelado del borrador de contrato (CONTRACT-1) — un
      // objeto plano, NUNCA una instancia viva de Contract (esto no es un
      // contrato registrado, sección 1 del prompt).
      this.contractDraft = Object.freeze({ ...data.contractDraft });
      this.rolePromise = Object.freeze(normalizeRolePromise(data.rolePromise));
      this.conditionsPrecedent = Object.freeze([...(data.conditionsPrecedent || [])]);
      this.disclosures = Object.freeze([...(data.disclosures || [])]);
      // Snapshot de validación laboral (ContractService.validateDraft())
      // en el momento de construir la oferta — nunca se recalcula
      // retroactivamente.
      this.employmentValidationSnapshot = data.employmentValidationSnapshot
        ? Object.freeze({ ...data.employmentValidationSnapshot }) : null;
      this.marketRulesSnapshot = data.marketRulesSnapshot ? Object.freeze({ ...data.marketRulesSnapshot }) : null;
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
      this.events = [];
      // `offer-sent` es implícito a la creación — toda ContractOffer nace
      // ya enviada (una oferta que nadie ha enviado no existe como entidad).
      this.addEvent({ id: `${this.id}:offer-sent`, type: 'offer-sent', date: this.createdAt });
      (data.events || []).filter((e) => e.type !== 'offer-sent').forEach((event) => this.addEvent(event));
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().OfferEvents, this.events, event, `ContractOffer "${this.id}"`);
      return this;
    }

    statusOn(date) {
      return Events().OfferEvents.deriveStatus(this.events, date ? toIso(date) : null);
    }

    // ¿Sigue siendo LA versión viva del hilo en esta fecha? (reserva
    // presupuesto — sección 11). Solo `sent` computa; `accepted` pasa a
    // reservar vía AgreementInPrinciple (nunca doble conteo).
    isLiveOn(date) {
      return this.statusOn(date) === 'sent';
    }

    toJSON() {
      return {
        id: this.id,
        threadId: this.threadId,
        version: this.version,
        parentOfferId: this.parentOfferId,
        offeredBy: this.offeredBy,
        createdAt: this.createdAt,
        expiresAt: this.expiresAt,
        playerId: this.playerId,
        clubId: this.clubId,
        contractDraft: this.contractDraft,
        rolePromise: this.rolePromise,
        conditionsPrecedent: this.conditionsPrecedent,
        disclosures: this.disclosures,
        employmentValidationSnapshot: this.employmentValidationSnapshot,
        marketRulesSnapshot: this.marketRulesSnapshot,
        events: this.events,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // AgreementInPrinciple (sección 8.6) — artefacto FINAL de MARKET-1.
  //
  // BUG-MARKET1-06 (DESIGN.md 9.20, TRANSFER-1): `executionState` ya NO es
  // una constante fija `pending-transfer-1` — es un ciclo de vida EXPLÍCITO
  // derivado de eventos (`AgreementEvents`, MarketEventTypes.js):
  // pendingExecution -> scheduled -> completed | expired | withdrawn |
  // failed. `validUntil` es OBLIGATORIO (nunca null vivo eternamente): si
  // no se declara explícito, se deriva de una política versionada
  // (`AIP_DEFAULT_VALIDITY_POLICY`, ver MarketService). `budgetReservationGroupId`
  // (antes `budgetReservationId`) referencia el GRUPO de reserva plurianual
  // creado por `createAndSendOffer()` (BUG-MARKET1-05) — nunca una única
  // línea suelta.
  // ---------------------------------------------------------------------
  class AgreementInPrinciple {
    constructor(data = {}) {
      [
        'id', 'threadId', 'acceptedOfferId', 'playerId', 'clubId', 'acceptedAt', 'employmentSnapshot',
        'budgetReservationGroupId', 'validUntil', 'validityPolicyVersion',
      ].forEach((field) => {
        if (!data[field]) throw new Error(`AgreementInPrinciple: falta "${field}" (BUG-MARKET1-06: validUntil ya no puede ser null).`);
      });
      this.id = data.id;
      this.threadId = data.threadId;
      this.acceptedOfferId = data.acceptedOfferId;
      this.playerId = data.playerId;
      this.clubId = data.clubId;
      this.acceptedAt = toIso(data.acceptedAt);
      this.validUntil = toIso(data.validUntil);
      if (LD().isBefore(this.validUntil, this.acceptedAt)) {
        throw new Error('AgreementInPrinciple: "validUntil" no puede ser anterior a "acceptedAt".');
      }
      // Política versionada que derivó `validUntil` cuando no se declaró
      // explícito — traza obligatoria (nunca un plazo mágico sin fuente).
      this.validityPolicyVersion = data.validityPolicyVersion;
      this.conditionsPrecedent = Object.freeze([...(data.conditionsPrecedent || [])]);
      // Cuando el acuerdo procede de un derecho preferente ACB resuelto
      // (sección 13): id del caso que lo condicionó/resolvió.
      this.rightsOutcomeId = data.rightsOutcomeId || null;
      this.employmentSnapshot = Object.freeze({ ...data.employmentSnapshot });
      this.marketRulesSnapshot = data.marketRulesSnapshot ? Object.freeze({ ...data.marketRulesSnapshot }) : null;
      this.budgetReservationGroupId = data.budgetReservationGroupId;
      // Vínculo con la transacción completada (TRANSFER-1) — null hasta que
      // exista un `TransactionRecord`. Un consumo idempotente devuelve
      // siempre este mismo id; nunca se reescribe una vez fijado.
      this.completedTransactionId = data.completedTransactionId || null;
      this.events = [];
      this.addEvent({ id: `${this.id}:agreement-created`, type: 'agreement-created', date: this.acceptedAt });
      (data.events || []).filter((e) => e.type !== 'agreement-created').forEach((event) => this.addEvent(event));
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().AgreementEvents, this.events, event, `AgreementInPrinciple "${this.id}"`);
      return this;
    }

    // Estado DERIVADO en una fecha — nunca sobrescrito directamente. Un
    // acuerdo vencido por `validUntil` sin haberse ejecutado se considera
    // `expired` aunque nadie haya registrado el evento explícito todavía
    // (mismo criterio que Contract.statusOn con `endDate`).
    statusOn(date) {
      const iso = date ? toIso(date) : null;
      const eventStatus = Events().AgreementEvents.deriveStatus(this.events, iso);
      if (Events().AGREEMENT_TERMINAL_STATUSES.has(eventStatus)) return eventStatus;
      if (iso && LD().isAfter(iso, this.validUntil)) return 'expired';
      return eventStatus;
    }

    // ¿Sigue BLOQUEANDO el mercado para este jugador en esta fecha? — un
    // estado terminal (completed/expired/withdrawn/failed) nunca bloquea
    // (BUG-MARKET1-06: antes `validUntil: null` lo trataba como vivo para
    // siempre).
    isLiveOn(date) {
      return !Events().AGREEMENT_TERMINAL_STATUSES.has(this.statusOn(date));
    }

    toJSON() {
      return {
        id: this.id,
        threadId: this.threadId,
        acceptedOfferId: this.acceptedOfferId,
        playerId: this.playerId,
        clubId: this.clubId,
        acceptedAt: this.acceptedAt,
        validUntil: this.validUntil,
        validityPolicyVersion: this.validityPolicyVersion,
        conditionsPrecedent: this.conditionsPrecedent,
        rightsOutcomeId: this.rightsOutcomeId,
        employmentSnapshot: this.employmentSnapshot,
        marketRulesSnapshot: this.marketRulesSnapshot,
        budgetReservationGroupId: this.budgetReservationGroupId,
        completedTransactionId: this.completedTransactionId,
        events: this.events,
        executionState: this.statusOn(null),
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // QualifyingOfferCase (sección 6.2 art. 13/13.2, sección 13.1) — valor
  // congelado de la oferta cualificada de un procedimiento de derecho
  // preferente. Nunca un booleano `hasTanteo` — un documento evaluable.
  // ---------------------------------------------------------------------
  class QualifyingOfferCase {
    constructor(data = {}) {
      ['id', 'rightsCaseId', 'filedByClubId', 'filedAt', 'monetizedAnnualValueMinor', 'minimumRequiredMinor', 'currency'].forEach((field) => {
        if (data[field] === undefined || data[field] === null) throw new Error(`QualifyingOfferCase: falta "${field}".`);
      });
      this.id = data.id;
      this.rightsCaseId = data.rightsCaseId;
      this.filedByClubId = data.filedByClubId;
      this.filedAt = toIso(data.filedAt);
      this.currency = data.currency;
      this.monetizedAnnualValueMinor = data.monetizedAnnualValueMinor;
      this.minimumRequiredMinor = data.minimumRequiredMinor;
      this.ageOnComputationDate = data.ageOnComputationDate !== undefined ? data.ageOnComputationDate : null;
      this.consecutiveExerciseCount = data.consecutiveExerciseCount !== undefined ? data.consecutiveExerciseCount : 0;
      this.maxConsecutiveExercises = data.maxConsecutiveExercises !== undefined ? data.maxConsecutiveExercises : null;
      this.debtChallengeConfirmed = Boolean(data.debtChallengeConfirmed);
      this.sourceRuleIds = [...(data.sourceRuleIds || [])];
    }

    // Válida si cumple el mínimo económico, no ha agotado ejercicios y no
    // hay una reclamación de deuda CONFIRMADA — nunca se "corrige" en
    // silencio; quien la consulta decide qué hacer con `valid === false`.
    get valid() {
      if (this.debtChallengeConfirmed) return false;
      if (this.monetizedAnnualValueMinor < this.minimumRequiredMinor) return false;
      // `consecutiveExerciseCount` cuenta los ejercicios YA realizados
      // ANTES de este (sección 13.1: "máximo de tres ejercicios") — esta
      // oferta sería el ejercicio número `count + 1`, así que el cupo se
      // agota en `count >= max` (con max=3: 0,1,2 previos admiten esta
      // 1ª/2ª/3ª vez; 3 previos ya agotó el máximo, un 4º no es válido).
      if (this.maxConsecutiveExercises !== null && this.consecutiveExerciseCount >= this.maxConsecutiveExercises) return false;
      return true;
    }

    toJSON() {
      return {
        id: this.id,
        rightsCaseId: this.rightsCaseId,
        filedByClubId: this.filedByClubId,
        filedAt: this.filedAt,
        currency: this.currency,
        monetizedAnnualValueMinor: this.monetizedAnnualValueMinor,
        minimumRequiredMinor: this.minimumRequiredMinor,
        ageOnComputationDate: this.ageOnComputationDate,
        consecutiveExerciseCount: this.consecutiveExerciseCount,
        maxConsecutiveExercises: this.maxConsecutiveExercises,
        debtChallengeConfirmed: this.debtChallengeConfirmed,
        valid: this.valid,
        sourceRuleIds: this.sourceRuleIds,
      };
    }
  }

  // ---------------------------------------------------------------------
  // RightOfFirstRefusalCase (sección 8.7/13) — procedimiento GENERAL o de
  // INSCRIPCIÓN PREFERENTE (art. 15), discriminados por `procedureType`
  // (sección 13.4: "usa máquinas distintas o un procedureType discriminado
  // con transiciones propias" — aquí comparten la MISMA máquina de
  // estados porque su secuencia de fases es la misma; solo cambian los
  // NÚMEROS/umbrales, congelados en `procedureRules`).
  // ---------------------------------------------------------------------
  const RIGHTS_PROCEDURE_TYPES = ['right-of-first-refusal', 'preferred-registration'];

  class RightOfFirstRefusalCase {
    constructor(data = {}) {
      ['id', 'playerId', 'originClubId', 'lastOfficialMatchDate', 'procedureType', 'procedureRules', 'sourceModuleId'].forEach((field) => {
        if (!data[field]) throw new Error(`RightOfFirstRefusalCase: falta "${field}".`);
      });
      if (!RIGHTS_PROCEDURE_TYPES.includes(data.procedureType)) {
        throw new Error(`RightOfFirstRefusalCase: procedureType desconocido "${data.procedureType}".`);
      }
      this.id = data.id;
      this.playerId = data.playerId;
      this.originClubId = data.originClubId;
      this.lastOfficialMatchDate = toIso(data.lastOfficialMatchDate);
      this.procedureType = data.procedureType;
      // Números/umbrales/plazos CONGELADOS al abrir el caso (sección 9.1) —
      // una actualización de módulo nunca reescribe un caso ya abierto.
      this.procedureRules = Object.freeze({ ...data.procedureRules });
      this.sourceModuleId = data.sourceModuleId;
      this.deadlines = { ...(data.deadlines || {}) };
      this.qualifyingOffer = data.qualifyingOffer || null; // QualifyingOfferCase.toJSON() congelado
      this.offerSheet = data.offerSheet || null;
      this.matchingDecision = data.matchingDecision || null; // { decidedBy: 'user'|'cpu', decision, decidedAt }
      this.debtChallengeId = data.debtChallengeId || null;
      this.events = [];
      // `case-opened` es implícito a la creación — mismo criterio que
      // `inquiry-opened`/`offer-sent`. Por defecto, el día del último
      // partido oficial (art. 14.1); `data.caseOpenedAt` permite declarar
      // otra fecha exacta cuando el llamador la conoce.
      this.addEvent({
        id: `${this.id}:case-opened`, type: 'case-opened', date: data.caseOpenedAt ? toIso(data.caseOpenedAt) : this.lastOfficialMatchDate,
      });
      (data.events || []).filter((e) => e.type !== 'case-opened').forEach((event) => this.addEvent(event));
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().RightsCaseEvents, this.events, event, `RightOfFirstRefusalCase "${this.id}"`);
      return this;
    }

    statusOn(date) {
      return Events().RightsCaseEvents.deriveStatus(this.events, date ? toIso(date) : null);
    }

    setQualifyingOffer(qoCase) {
      this.qualifyingOffer = qoCase.toJSON ? qoCase.toJSON() : qoCase;
      return this;
    }

    setOfferSheet(offerSheet) {
      this.offerSheet = { ...offerSheet };
      return this;
    }

    setMatchingDecision(decision) {
      this.matchingDecision = { ...decision };
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        originClubId: this.originClubId,
        lastOfficialMatchDate: this.lastOfficialMatchDate,
        procedureType: this.procedureType,
        procedureRules: this.procedureRules,
        sourceModuleId: this.sourceModuleId,
        deadlines: this.deadlines,
        qualifyingOffer: this.qualifyingOffer,
        offerSheet: this.offerSheet,
        matchingDecision: this.matchingDecision,
        debtChallengeId: this.debtChallengeId,
        events: this.events,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // ReturnRightsCase (sección 6.2 art. 17, sección 13.4) — procedimiento
  // DISTINTO del general: decisión del club de origen entre TRES opciones
  // (17.2), no una secuencia de fases de oferta/igualación.
  // ---------------------------------------------------------------------
  const RETURN_RIGHTS_OPTIONS = ['do-not-maintain', 'maintain-and-use-general-procedure', 'wait-for-third-party-offer'];

  class ReturnRightsCase {
    constructor(data = {}) {
      ['id', 'playerId', 'originClubId', 'lastOfficialMatchDate', 'decisionDeadline'].forEach((field) => {
        if (!data[field]) throw new Error(`ReturnRightsCase: falta "${field}".`);
      });
      this.id = data.id;
      this.playerId = data.playerId;
      this.originClubId = data.originClubId;
      this.lastOfficialMatchDate = toIso(data.lastOfficialMatchDate);
      this.decisionDeadline = toIso(data.decisionDeadline);
      this.optionChosen = data.optionChosen || null;
      if (this.optionChosen && !RETURN_RIGHTS_OPTIONS.includes(this.optionChosen)) {
        throw new Error(`ReturnRightsCase: optionChosen desconocido "${this.optionChosen}".`);
      }
      this.decidedAt = data.decidedAt ? toIso(data.decidedAt) : null;
      // Cuando la opción 3 (esperar oferta de tercero) se iguala, se
      // aplica el recargo del 10% (sección 6.2 art. 17.2.3) — marcado
      // aquí, nunca calculado como dinero pagado (fuera de alcance).
      this.matchingSurchargePercent = data.matchingSurchargePercent !== undefined ? data.matchingSurchargePercent : null;
      // Enlaza al caso general (art. 14.6) cuando la opción elegida lo
      // requiere — nunca dos procedimientos mezclados en un mismo objeto.
      this.linkedRightsCaseId = data.linkedRightsCaseId || null;
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
    }

    chooseOption(option, decidedAt) {
      if (!RETURN_RIGHTS_OPTIONS.includes(option)) {
        throw new Error(`ReturnRightsCase: opción desconocida "${option}".`);
      }
      if (this.optionChosen) {
        throw new Error(`ReturnRightsCase "${this.id}": ya tiene una decisión tomada (${this.optionChosen}).`);
      }
      this.optionChosen = option;
      this.decidedAt = toIso(decidedAt);
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        originClubId: this.originClubId,
        lastOfficialMatchDate: this.lastOfficialMatchDate,
        decisionDeadline: this.decisionDeadline,
        optionChosen: this.optionChosen,
        decidedAt: this.decidedAt,
        matchingSurchargePercent: this.matchingSurchargePercent,
        linkedRightsCaseId: this.linkedRightsCaseId,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // DebtChallenge (sección 6.2 art. 13.2) — procedimiento PARALELO: puede
  // invalidar un derecho, pero sin ledger real de pagos el juego no
  // inventa deudas al azar — solo actúa sobre evidencia/fixture explícito.
  // ---------------------------------------------------------------------
  class DebtChallenge {
    constructor(data = {}) {
      ['id', 'rightsCaseId', 'filedByClubId', 'filedAt'].forEach((field) => {
        if (!data[field]) throw new Error(`DebtChallenge: falta "${field}".`);
      });
      this.id = data.id;
      this.rightsCaseId = data.rightsCaseId;
      this.filedByClubId = data.filedByClubId;
      this.filedAt = toIso(data.filedAt);
      // Evidencia DECLARADA por quien abre el desafío (fixture/test
      // dirigido) — nunca inferida ni generada al azar.
      this.evidenceDeclared = Boolean(data.evidenceDeclared);
      this.outcome = data.outcome || null; // null | 'confirmed' | 'rejected'
      this.resolvedAt = data.resolvedAt ? toIso(data.resolvedAt) : null;
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
    }

    resolve(outcome, resolvedAt) {
      if (!['confirmed', 'rejected'].includes(outcome)) {
        throw new Error(`DebtChallenge: outcome desconocido "${outcome}".`);
      }
      this.outcome = outcome;
      this.resolvedAt = toIso(resolvedAt);
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        rightsCaseId: this.rightsCaseId,
        filedByClubId: this.filedByClubId,
        filedAt: this.filedAt,
        evidenceDeclared: this.evidenceDeclared,
        outcome: this.outcome,
        resolvedAt: this.resolvedAt,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // PotentialCompensationClaim (sección 6.2 art. 16, sección 8.7) — SOLO
  // referencia trazada para TRANSFER-1; su cálculo, cargo y pago NO
  // pertenecen a MARKET-1.
  // ---------------------------------------------------------------------
  class PotentialCompensationClaim {
    constructor(data = {}) {
      ['id', 'rightsCaseId', 'playerId', 'originClubId', 'notedAt'].forEach((field) => {
        if (!data[field]) throw new Error(`PotentialCompensationClaim: falta "${field}".`);
      });
      this.id = data.id;
      this.rightsCaseId = data.rightsCaseId;
      this.playerId = data.playerId;
      this.originClubId = data.originClubId;
      this.notedAt = toIso(data.notedAt);
      this.basisDescription = data.basisDescription || null;
      // SIEMPRE 'noted' en MARKET-1 — TRANSFER-1 decide cálculo/cargo/pago.
      this.status = 'noted';
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
    }

    toJSON() {
      return {
        id: this.id,
        rightsCaseId: this.rightsCaseId,
        playerId: this.playerId,
        originClubId: this.originClubId,
        notedAt: this.notedAt,
        basisDescription: this.basisDescription,
        status: this.status,
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = {
    NegotiationThread,
    ContractOffer,
    AgreementInPrinciple,
    QualifyingOfferCase,
    RightOfFirstRefusalCase,
    ReturnRightsCase,
    DebtChallenge,
    PotentialCompensationClaim,
    RIGHTS_PROCEDURE_TYPES,
    RETURN_RIGHTS_OPTIONS,
    ROLE_PROMISE_ROLES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
