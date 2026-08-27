// src/entities/Transfer.js
// TRANSFER-1 (DESIGN.md 9.20, sección 9 del prompt) — modelo de dominio de
// una operación de fichaje/traspaso/rescisión/mutuo acuerdo. Convención
// del proyecto: identificadores en inglés, comentarios en español.
//
// Separación de conceptos permanente (sección 1 del prompt): un
// `TransferCase` (expediente) != un `ClubTransferOffer` (oferta entre
// clubes, distinta de `ContractOffer` de MARKET-1) != un
// `TransferAgreement` (acuerdo definitivo entre clubes) != un
// `ReleaseClauseExercise` != un `ContractTerminationRecord` != una
// `FinancialObligation` (compromiso, NUNCA un pago) != un
// `TransactionRecord` (recibo canónico e inmutable de una operación YA
// completada) != un `TransferExecutionPlan` (artefacto puro previo a
// tocar el estado). Ninguna entidad de este archivo muta `Team.roster`,
// `player.teamId`, `ContractRegistry` ni `RegistrationRegistry` por sí
// sola — eso es competencia exclusiva de `RosterMutationService`/
// `TransferExecutionService` dentro de una transacción controlada.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const TransferEventTypesModule = isNode ? require('../core/TransferEventTypes.js') : global.BasketManager;

  function M() { return MoneyModule.Money; }
  function LD() { return LocalDateModule.LocalDate; }
  function Events() { return TransferEventTypesModule.TransferEventTypes; }

  function toIso(date) {
    if (!date) throw new Error('Transfer: hace falta una fecha.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function requireFields(data, fields, label) {
    fields.forEach((field) => {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        throw new Error(`${label}: falta "${field}".`);
      }
    });
  }

  function normalizeMoney(amount, label) {
    if (!amount) throw new Error(`${label}: falta importe.`);
    M().requireAmountMinor(amount.amountMinor, `${label}.amountMinor`);
    M().requireCurrency(amount.currency);
    return { amountMinor: amount.amountMinor, currency: amount.currency };
  }

  function appendValidatedEvent(machine, events, event, label) {
    const check = machine.validateEvent(event, events);
    if (!check.valid) throw new Error(`${label}: evento inválido — ${check.errors.join(' | ')}`);
    return [...events, event].sort((a, b) => (machine.eventSortKey(a) < machine.eventSortKey(b) ? -1 : 1));
  }

  // ---------------------------------------------------------------------
  // TransferCase (sección 9.1) — expediente de la operación completa.
  // ---------------------------------------------------------------------
  const OPERATION_TYPES = [
    'free-agent-signing',
    'future-signing',
    'negotiated-transfer',
    'release-clause-exercise',
    'mutual-agreement',
    'employer-termination',
    'player-withdrawal',
    'verified-cause-termination',
    'rights-waiver-compensation',
  ];
  const TRANSACTION_SCOPES = ['domestic', 'international'];

  class TransferCase {
    constructor(data = {}) {
      requireFields(data, ['id', 'playerId', 'initiatingClubId', 'destinationClubId', 'agreementInPrincipleId', 'operationType', 'openedAt'], 'TransferCase');
      if (!OPERATION_TYPES.includes(data.operationType)) {
        throw new Error(`TransferCase: operationType desconocido "${data.operationType}".`);
      }
      const transactionScope = data.transactionScope || 'domestic';
      if (!TRANSACTION_SCOPES.includes(transactionScope)) {
        throw new Error(`TransferCase: transactionScope desconocido "${transactionScope}".`);
      }
      this.id = data.id;
      this.playerId = data.playerId;
      this.initiatingClubId = data.initiatingClubId;
      // `originClubId` es null para un libre (no hay club de origen que
      // libere al jugador) — nunca inventado.
      this.originClubId = data.originClubId || null;
      this.destinationClubId = data.destinationClubId;
      this.agreementInPrincipleId = data.agreementInPrincipleId;
      this.operationType = data.operationType;
      this.mechanism = data.mechanism || data.operationType;
      this.transactionScope = transactionScope;
      this.openedAt = toIso(data.openedAt);
      this.effectiveDate = data.effectiveDate ? toIso(data.effectiveDate) : null;
      this.expiresAt = data.expiresAt ? toIso(data.expiresAt) : null;
      this.originContractId = data.originContractId || null;
      this.proposedContractOfferId = data.proposedContractOfferId || null;
      // Congelada al abrirse (sección 9.1 del prompt de TRANSFER-1, mismo
      // criterio que NegotiationThread.rulesSnapshot en MARKET-1) — un
      // ascenso/descenso posterior nunca reescribe un expediente ya vivo.
      this.rulesSnapshot = data.rulesSnapshot ? Object.freeze({ ...data.rulesSnapshot }) : null;
      this.clubOfferId = data.clubOfferId || null;
      this.transferAgreementId = data.transferAgreementId || null;
      this.releaseClauseExerciseId = data.releaseClauseExerciseId || null;
      this.terminationRecordId = data.terminationRecordId || null;
      this.obligationIds = [...(data.obligationIds || [])];
      this.transactionId = data.transactionId || null;
      this.planHash = data.planHash || null;
      this.conditionsPrecedent = [...(data.conditionsPrecedent || [])];
      this.playerConsent = data.playerConsent ? { ...data.playerConsent } : null; // { grantedAt, actor, scope }
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : 'simulated-transfer-v1',
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
      this.confidentiality = data.confidentiality || 'private-user-club';
      this.events = [];
      this.addEvent({ id: `${this.id}:case-opened`, type: 'case-opened', date: this.openedAt });
      (data.events || []).filter((e) => e.type !== 'case-opened').forEach((event) => this.addEvent(event));
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().TransferCaseEvents, this.events, event, `TransferCase "${this.id}"`);
      return this;
    }

    statusOn(date) {
      return Events().TransferCaseEvents.deriveStatus(this.events, date ? toIso(date) : null);
    }

    isTerminal(date) {
      return Events().TRANSFER_CASE_TERMINAL_STATUSES.has(this.statusOn(date));
    }

    setConsent(consent) {
      this.playerConsent = { ...consent };
      return this;
    }

    linkObligation(obligationId) {
      if (!this.obligationIds.includes(obligationId)) this.obligationIds.push(obligationId);
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        initiatingClubId: this.initiatingClubId,
        originClubId: this.originClubId,
        destinationClubId: this.destinationClubId,
        agreementInPrincipleId: this.agreementInPrincipleId,
        operationType: this.operationType,
        mechanism: this.mechanism,
        transactionScope: this.transactionScope,
        openedAt: this.openedAt,
        effectiveDate: this.effectiveDate,
        expiresAt: this.expiresAt,
        originContractId: this.originContractId,
        proposedContractOfferId: this.proposedContractOfferId,
        rulesSnapshot: this.rulesSnapshot,
        clubOfferId: this.clubOfferId,
        transferAgreementId: this.transferAgreementId,
        releaseClauseExerciseId: this.releaseClauseExerciseId,
        terminationRecordId: this.terminationRecordId,
        obligationIds: [...this.obligationIds],
        transactionId: this.transactionId,
        planHash: this.planHash,
        conditionsPrecedent: [...this.conditionsPrecedent],
        playerConsent: this.playerConsent,
        events: this.events,
        status: this.statusOn(null),
        provenance: this.provenance,
        confidentiality: this.confidentiality,
      };
    }
  }

  // ---------------------------------------------------------------------
  // ClubTransferOffer (sección 9.2) — oferta económica ENTRE CLUBES,
  // distinta de ContractOffer (MARKET-1, jugador-club). Inmutable y
  // versionada: una contraoferta es una entidad nueva.
  // ---------------------------------------------------------------------
  class ClubTransferOffer {
    constructor(data = {}) {
      requireFields(data, ['id', 'transferCaseId', 'version', 'offeredByClubId', 'addressedToClubId', 'createdAt', 'expiresAt', 'fee'], 'ClubTransferOffer');
      if (!Number.isInteger(data.version) || data.version < 1) {
        throw new Error('ClubTransferOffer: "version" debe ser un entero >= 1.');
      }
      this.id = data.id;
      this.transferCaseId = data.transferCaseId;
      this.version = data.version;
      this.parentOfferId = data.parentOfferId || null;
      this.offeredByClubId = data.offeredByClubId;
      this.addressedToClubId = data.addressedToClubId;
      this.createdAt = toIso(data.createdAt);
      this.expiresAt = toIso(data.expiresAt);
      if (LD().isBefore(this.expiresAt, this.createdAt)) {
        throw new Error('ClubTransferOffer: "expiresAt" no puede ser anterior a "createdAt".');
      }
      this.fee = Object.freeze(normalizeMoney(data.fee, 'ClubTransferOffer.fee'));
      // Calendario de obligaciones si hay plazos (nunca un pago realizado).
      this.paymentSchedule = Object.freeze((data.paymentSchedule || []).map((line) => Object.freeze({
        dueDate: toIso(line.dueDate), amountMinor: line.amountMinor, currency: line.currency || this.fee.currency,
      })));
      this.conditionsPrecedent = Object.freeze([...(data.conditionsPrecedent || [])]);
      // Cláusulas de solidaridad/formación — SOLO líneas separadas con
      // fuente declarada (sección 9.2: "nunca sumadas al fee").
      this.solidarityLines = Object.freeze((data.solidarityLines || []).map((line) => {
        if (!line.sourceRefs || !line.sourceRefs.length) {
          throw new Error('ClubTransferOffer: una línea de solidaridad/formación exige "sourceRefs" — nunca inventada sin fuente.');
        }
        return Object.freeze({ ...line, amount: normalizeMoney(line.amount, 'solidarityLine.amount') });
      }));
      this.snapshot = data.snapshot ? Object.freeze({ ...data.snapshot }) : null;
      this.provenance = { dataSource: 'simulated-transfer-v1', isReal: false };
      this.events = [];
      this.addEvent({ id: `${this.id}:offer-sent`, type: 'offer-sent', date: this.createdAt });
      (data.events || []).filter((e) => e.type !== 'offer-sent').forEach((event) => this.addEvent(event));
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().ClubOfferEvents, this.events, event, `ClubTransferOffer "${this.id}"`);
      return this;
    }

    statusOn(date) { return Events().ClubOfferEvents.deriveStatus(this.events, date ? toIso(date) : null); }

    isLiveOn(date) { return this.statusOn(date) === 'sent'; }

    toJSON() {
      return {
        id: this.id,
        transferCaseId: this.transferCaseId,
        version: this.version,
        parentOfferId: this.parentOfferId,
        offeredByClubId: this.offeredByClubId,
        addressedToClubId: this.addressedToClubId,
        createdAt: this.createdAt,
        expiresAt: this.expiresAt,
        fee: this.fee,
        paymentSchedule: this.paymentSchedule,
        conditionsPrecedent: this.conditionsPrecedent,
        solidarityLines: this.solidarityLines,
        snapshot: this.snapshot,
        events: this.events,
        status: this.statusOn(null),
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // TransferAgreement (sección 9.3) — acuerdo DEFINITIVO entre clubes.
  // ---------------------------------------------------------------------
  class TransferAgreement {
    constructor(data = {}) {
      requireFields(data, [
        'id', 'transferCaseId', 'playerId', 'originClubId', 'destinationClubId', 'acceptedClubOfferId', 'fee',
        'terminationMechanism', 'effectiveDate', 'agreedAt',
      ], 'TransferAgreement');
      this.id = data.id;
      this.transferCaseId = data.transferCaseId;
      this.playerId = data.playerId;
      this.originClubId = data.originClubId;
      this.destinationClubId = data.destinationClubId;
      this.acceptedClubOfferId = data.acceptedClubOfferId;
      this.fee = Object.freeze(normalizeMoney(data.fee, 'TransferAgreement.fee'));
      this.agreedAt = toIso(data.agreedAt);
      this.effectiveDate = toIso(data.effectiveDate);
      // Consentimiento del jugador — fecha y actor, nunca deducido de
      // haber aceptado una oferta salarial (sección 11.3 del prompt).
      this.playerConsent = data.playerConsent ? Object.freeze({ ...data.playerConsent }) : null;
      this.terminationMechanism = data.terminationMechanism;
      this.documentsRequired = Object.freeze([...(data.documentsRequired || [])]);
      this.documentStatuses = { ...(data.documentStatuses || {}) };
      this.rulesSnapshot = data.rulesSnapshot ? Object.freeze({ ...data.rulesSnapshot }) : null;
      this.sourceFingerprints = data.sourceFingerprints ? Object.freeze({ ...data.sourceFingerprints }) : null;
      this.provenance = { dataSource: 'simulated-transfer-v1', isReal: false };
      this.confidentiality = data.confidentiality || 'private-both-clubs';
    }

    allDocumentsReady() {
      return this.documentsRequired.every((doc) => this.documentStatuses[doc] === 'provided' || this.documentStatuses[doc] === 'verified');
    }

    hasPlayerConsent() { return Boolean(this.playerConsent && this.playerConsent.grantedAt); }

    toJSON() {
      return {
        id: this.id,
        transferCaseId: this.transferCaseId,
        playerId: this.playerId,
        originClubId: this.originClubId,
        destinationClubId: this.destinationClubId,
        acceptedClubOfferId: this.acceptedClubOfferId,
        fee: this.fee,
        agreedAt: this.agreedAt,
        effectiveDate: this.effectiveDate,
        playerConsent: this.playerConsent,
        terminationMechanism: this.terminationMechanism,
        documentsRequired: this.documentsRequired,
        documentStatuses: { ...this.documentStatuses },
        rulesSnapshot: this.rulesSnapshot,
        sourceFingerprints: this.sourceFingerprints,
        provenance: this.provenance,
        confidentiality: this.confidentiality,
      };
    }
  }

  // ---------------------------------------------------------------------
  // ReleaseClauseExercise (sección 9.4).
  // ---------------------------------------------------------------------
  class ReleaseClauseExercise {
    constructor(data = {}) {
      requireFields(data, ['id', 'transferCaseId', 'contractId', 'clauseId', 'amount', 'exercisedBy', 'notifiedAt'], 'ReleaseClauseExercise');
      this.id = data.id;
      this.transferCaseId = data.transferCaseId;
      this.contractId = data.contractId;
      this.clauseId = data.clauseId;
      // Importe/moneda CONGELADOS desde la cláusula tipada del contrato —
      // nunca recalculados aquí.
      this.amount = Object.freeze(normalizeMoney(data.amount, 'ReleaseClauseExercise.amount'));
      // 'player' | 'third-party-on-behalf-of-player'.
      this.exercisedBy = data.exercisedBy;
      this.notifiedAt = toIso(data.notifiedAt);
      this.satisfiedAt = data.satisfiedAt ? toIso(data.satisfiedAt) : null;
      this.effectiveDate = data.effectiveDate ? toIso(data.effectiveDate) : null;
      this.communicationEvidence = data.communicationEvidence || null;
      this.satisfactionEvidence = data.satisfactionEvidence || null; // OBLIGACIÓN formalizada, nunca movimiento bancario
      this.registrationRestrictions = data.registrationRestrictions ? { ...data.registrationRestrictions } : null;
      this.rulesSnapshot = data.rulesSnapshot ? Object.freeze({ ...data.rulesSnapshot }) : null;
      this.provenance = { dataSource: 'simulated-transfer-v1', isReal: false };
      this.events = [];
      this.addEvent({ id: `${this.id}:notified`, type: 'notified', date: this.notifiedAt });
      (data.events || []).filter((e) => e.type !== 'notified').forEach((event) => this.addEvent(event));
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().ReleaseClauseEvents, this.events, event, `ReleaseClauseExercise "${this.id}"`);
      return this;
    }

    statusOn(date) { return Events().ReleaseClauseEvents.deriveStatus(this.events, date ? toIso(date) : null); }

    toJSON() {
      return {
        id: this.id,
        transferCaseId: this.transferCaseId,
        contractId: this.contractId,
        clauseId: this.clauseId,
        amount: this.amount,
        exercisedBy: this.exercisedBy,
        notifiedAt: this.notifiedAt,
        satisfiedAt: this.satisfiedAt,
        effectiveDate: this.effectiveDate,
        communicationEvidence: this.communicationEvidence,
        satisfactionEvidence: this.satisfactionEvidence,
        registrationRestrictions: this.registrationRestrictions,
        rulesSnapshot: this.rulesSnapshot,
        events: this.events,
        status: this.statusOn(null),
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // ContractTerminationRecord (sección 9.5).
  // ---------------------------------------------------------------------
  const TERMINATION_MECHANISMS = [
    'mutual-transfer', 'mutual-release', 'player-release-clause', 'player-withdrawal', 'employer-termination', 'verified-cause', 'expiry',
  ];

  class ContractTerminationRecord {
    constructor(data = {}) {
      requireFields(data, ['id', 'contractId', 'playerId', 'clubId', 'mechanism', 'effectiveDate'], 'ContractTerminationRecord');
      if (!TERMINATION_MECHANISMS.includes(data.mechanism)) {
        throw new Error(`ContractTerminationRecord: mecanismo desconocido "${data.mechanism}".`);
      }
      this.id = data.id;
      this.contractId = data.contractId;
      this.playerId = data.playerId;
      this.clubId = data.clubId;
      this.mechanism = data.mechanism;
      this.agreedAt = data.agreedAt ? toIso(data.agreedAt) : null;
      this.noticeDate = data.noticeDate ? toIso(data.noticeDate) : null;
      this.effectiveDate = toIso(data.effectiveDate);
      this.parties = [...(data.parties || [])]; // [{ actor, consentGivenAt }]
      this.clauseId = data.clauseId || null;
      // Causa controvertida: solo se ejecuta con un artefacto de fixture
      // explícito (ExternalResolution/VerifiedCauseRecord) — sección 9.5.
      this.verifiedCauseRecordId = data.verifiedCauseRecordId || null;
      this.settlement = data.settlement ? Object.freeze(normalizeMoney(data.settlement, 'ContractTerminationRecord.settlement')) : null;
      this.documentation = [...(data.documentation || [])];
      this.rulesSnapshot = data.rulesSnapshot ? Object.freeze({ ...data.rulesSnapshot }) : null;
      this.provenance = { dataSource: 'simulated-transfer-v1', isReal: false };
      this.events = [];
      const initialType = data.initialEventType || 'agreed';
      this.addEvent({ id: `${this.id}:${initialType}`, type: initialType, date: this.agreedAt || this.noticeDate || this.effectiveDate });
      (data.events || []).filter((e) => e.type !== initialType).forEach((event) => this.addEvent(event));
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().TerminationEvents, this.events, event, `ContractTerminationRecord "${this.id}"`);
      return this;
    }

    statusOn(date) { return Events().TerminationEvents.deriveStatus(this.events, date ? toIso(date) : null); }

    toJSON() {
      return {
        id: this.id,
        contractId: this.contractId,
        playerId: this.playerId,
        clubId: this.clubId,
        mechanism: this.mechanism,
        agreedAt: this.agreedAt,
        noticeDate: this.noticeDate,
        effectiveDate: this.effectiveDate,
        parties: this.parties,
        clauseId: this.clauseId,
        verifiedCauseRecordId: this.verifiedCauseRecordId,
        settlement: this.settlement,
        documentation: [...this.documentation],
        rulesSnapshot: this.rulesSnapshot,
        events: this.events,
        status: this.statusOn(null),
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // FinancialObligation (sección 9.6) — COMPROMISO, nunca un pago.
  // ---------------------------------------------------------------------
  const OBLIGATION_CONCEPTS = [
    'transfer-fee', 'player-transfer-participation', 'release-clause-amount', 'mutual-termination-settlement',
    'employer-termination-compensation', 'rights-waiver-compensation', 'agent-fee',
  ];
  const OBLIGATION_STATUSES = ['committed', 'waived', 'superseded'];

  class FinancialObligation {
    constructor(data = {}) {
      requireFields(data, ['id', 'transactionId', 'concept', 'debtorType', 'debtorId', 'creditorType', 'creditorId', 'amountMinor', 'currency', 'legalSource'], 'FinancialObligation');
      if (!OBLIGATION_CONCEPTS.includes(data.concept)) {
        throw new Error(`FinancialObligation: concepto desconocido "${data.concept}".`);
      }
      this.id = data.id;
      this.transactionId = data.transactionId;
      this.concept = data.concept;
      this.debtorType = data.debtorType; // 'club' | 'player'
      this.debtorId = data.debtorId;
      this.creditorType = data.creditorType;
      this.creditorId = data.creditorId;
      this.amountMinor = M().requireAmountMinor(data.amountMinor, 'FinancialObligation.amountMinor');
      this.currency = data.currency;
      M().requireCurrency(this.currency);
      this.dueDate = data.dueDate ? toIso(data.dueDate) : null;
      this.schedule = Object.freeze((data.schedule || []).map((line) => Object.freeze({
        dueDate: toIso(line.dueDate), amountMinor: M().requireAmountMinor(line.amountMinor, 'schedule.amountMinor'), currency: line.currency || this.currency,
      })));
      this.legalSource = data.legalSource; // { ruleModuleId, article }
      this.calculationTrace = data.calculationTrace ? Object.freeze({ ...data.calculationTrace }) : null;
      const status = data.status || 'committed';
      if (!OBLIGATION_STATUSES.includes(status)) {
        throw new Error(`FinancialObligation: estado desconocido "${status}" (nunca "paid" sin economía real).`);
      }
      this.status = status;
      this.provenance = { dataSource: 'simulated-transfer-v1', isReal: false };
      this.visibility = data.visibility || 'private-both-parties';
      this.notes = data.notes || null;
    }

    waive(reason) { this.status = 'waived'; this.notes = reason || this.notes; return this; }

    supersede(byObligationId) { this.status = 'superseded'; this.notes = `superseded-by:${byObligationId}`; return this; }

    toJSON() {
      return {
        id: this.id,
        transactionId: this.transactionId,
        concept: this.concept,
        debtorType: this.debtorType,
        debtorId: this.debtorId,
        creditorType: this.creditorType,
        creditorId: this.creditorId,
        amountMinor: this.amountMinor,
        currency: this.currency,
        dueDate: this.dueDate,
        schedule: this.schedule,
        legalSource: this.legalSource,
        calculationTrace: this.calculationTrace,
        status: this.status,
        provenance: this.provenance,
        visibility: this.visibility,
        notes: this.notes,
      };
    }
  }

  // ---------------------------------------------------------------------
  // TransactionRecord (sección 9.7) — recibo CANÓNICO e INMUTABLE.
  // ---------------------------------------------------------------------
  class TransactionRecord {
    constructor(data = {}) {
      // `destinationClubId` es OBLIGATORIO salvo en una liberación pura
      // (mutuo acuerdo/terminación sin destino nuevo) — un jugador libre
      // queda accesible en el Player Registry con `teamId: null`.
      requireFields(data, ['id', 'transferCaseId', 'playerId', 'operationType', 'mechanism', 'effectiveDate', 'completedAt'], 'TransactionRecord');
      this.id = data.id;
      this.transferCaseId = data.transferCaseId;
      this.playerId = data.playerId;
      this.operationType = data.operationType;
      this.mechanism = data.mechanism;
      this.effectiveDate = toIso(data.effectiveDate);
      this.completedAt = toIso(data.completedAt);
      this.originClubId = data.originClubId || null;
      this.destinationClubId = data.destinationClubId;
      this.agreementInPrincipleId = data.agreementInPrincipleId || null;
      this.contractOfferId = data.contractOfferId || null;
      this.transferAgreementId = data.transferAgreementId || null;
      this.terminationRecordId = data.terminationRecordId || null;
      this.newContractId = data.newContractId || null;
      this.deactivatedRegistrationId = data.deactivatedRegistrationId || null;
      this.createdRegistrationId = data.createdRegistrationId || null;
      this.createdLicenseId = data.createdLicenseId || null;
      this.obligationIds = Object.freeze([...(data.obligationIds || [])]);
      this.rosterMutationReport = data.rosterMutationReport ? Object.freeze({ ...data.rosterMutationReport }) : null;
      this.careerStintReport = data.careerStintReport ? Object.freeze({ ...data.careerStintReport }) : null;
      this.expectedFingerprints = data.expectedFingerprints ? Object.freeze({ ...data.expectedFingerprints }) : null;
      this.rulesSnapshot = data.rulesSnapshot ? Object.freeze({ ...data.rulesSnapshot }) : null;
      this.sourceRefs = Object.freeze([...(data.sourceRefs || [])]);
      this.warnings = Object.freeze([...(data.warnings || [])]);
      this.newsEventIds = Object.freeze([...(data.newsEventIds || [])]);
      this.provenance = { dataSource: 'simulated-transfer-v1', isReal: false };
      Object.freeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        transferCaseId: this.transferCaseId,
        playerId: this.playerId,
        operationType: this.operationType,
        mechanism: this.mechanism,
        effectiveDate: this.effectiveDate,
        completedAt: this.completedAt,
        originClubId: this.originClubId,
        destinationClubId: this.destinationClubId,
        agreementInPrincipleId: this.agreementInPrincipleId,
        contractOfferId: this.contractOfferId,
        transferAgreementId: this.transferAgreementId,
        terminationRecordId: this.terminationRecordId,
        newContractId: this.newContractId,
        deactivatedRegistrationId: this.deactivatedRegistrationId,
        createdRegistrationId: this.createdRegistrationId,
        createdLicenseId: this.createdLicenseId,
        obligationIds: this.obligationIds,
        rosterMutationReport: this.rosterMutationReport,
        careerStintReport: this.careerStintReport,
        expectedFingerprints: this.expectedFingerprints,
        rulesSnapshot: this.rulesSnapshot,
        sourceRefs: this.sourceRefs,
        warnings: this.warnings,
        newsEventIds: this.newsEventIds,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // TransferExecutionPlan (sección 9.8) — artefacto PURO e INMUTABLE,
  // construido ANTES de tocar ningún estado real. `TransferExecutionService`
  // lo construye y lo vuelve a validar en el commit (fingerprints).
  // ---------------------------------------------------------------------
  class TransferExecutionPlan {
    constructor(data = {}) {
      requireFields(data, ['transactionId', 'command', 'hash', 'builtAt'], 'TransferExecutionPlan');
      this.transactionId = data.transactionId;
      this.command = Object.freeze({ ...data.command });
      this.preconditions = Object.freeze([...(data.preconditions || [])]);
      this.fingerprints = Object.freeze({ ...(data.fingerprints || {}) });
      this.operations = Object.freeze([...(data.operations || [])]);
      this.newObjects = data.newObjects || {}; // instancias YA construidas y validadas (no congeladas: se registran tal cual en el commit)
      this.referenceCleanupPlan = Object.freeze([...(data.referenceCleanupPlan || [])]);
      this.obligations = Object.freeze([...(data.obligations || [])]);
      this.blockers = Object.freeze([...(data.blockers || [])]);
      this.warnings = Object.freeze([...(data.warnings || [])]);
      this.hash = data.hash;
      this.builtAt = toIso(data.builtAt);
      Object.freeze(this.command);
    }

    get isExecutable() { return this.blockers.length === 0; }

    toJSON() {
      return {
        transactionId: this.transactionId,
        command: this.command,
        preconditions: this.preconditions,
        fingerprints: this.fingerprints,
        operations: this.operations,
        referenceCleanupPlan: this.referenceCleanupPlan,
        obligations: this.obligations,
        blockers: this.blockers,
        warnings: this.warnings,
        hash: this.hash,
        builtAt: this.builtAt,
        isExecutable: this.isExecutable,
      };
    }
  }

  const exportsObj = {
    TransferCase,
    ClubTransferOffer,
    TransferAgreement,
    ReleaseClauseExercise,
    ContractTerminationRecord,
    FinancialObligation,
    TransactionRecord,
    TransferExecutionPlan,
    OPERATION_TYPES,
    TRANSACTION_SCOPES,
    TERMINATION_MECHANISMS,
    OBLIGATION_CONCEPTS,
    OBLIGATION_STATUSES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
