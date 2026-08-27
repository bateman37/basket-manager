// src/entities/Loan.js
// LOAN-1 (DESIGN.md 9.21, sección 8 del prompt) — modelo de dominio de una
// cesión temporal doméstica: expediente, propuesta inmutable, consentimiento
// tripartito, acuerdo vivo, cláusulas tipadas y ejercicio de opción/
// obligación de compra. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Separación de conceptos permanente (sección 1/8 del prompt): un
// `LoanCase` (expediente) != una `LoanProposal` (versión inmutable de
// términos) != un `LoanPartyConsent` (consentimiento de UNA parte sobre
// UNA versión) != un `LoanAgreement` (acuerdo vivo/activo) != un
// `PurchaseOptionExercise` (ejercicio de opción, nunca mueve roster por sí
// solo). Ninguna entidad de este archivo muta Team.roster/player.teamId/
// ContractRegistry/RegistrationRegistry — eso es competencia exclusiva de
// RosterMutationService/LoanExecutionService dentro de una transacción
// atómica (sección 14 del prompt).
//
// `FinancialObligation`/`TransactionRecord` de `src/entities/Transfer.js`
// se REUTILIZAN tal cual para la economía de la cesión y para los recibos
// de salida/retorno (sección 8.8: "si amplías TransactionRecord,
// LoanRegistry solo referencia su id") — nunca se duplica esa maquinaria
// aquí.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const LoanEventTypesModule = isNode ? require('../core/LoanEventTypes.js') : global.BasketManager;
  const CanonicalHashModule = isNode ? require('../utils/CanonicalHash.js') : global.BasketManager;

  function M() { return MoneyModule.Money; }
  function LD() { return LocalDateModule.LocalDate; }
  function Events() { return LoanEventTypesModule.LoanEventTypes; }
  function Hash() { return CanonicalHashModule.CanonicalHash; }

  function toIso(date) {
    if (!date) throw new Error('Loan: hace falta una fecha.');
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
  // Reparto salarial (sección 8.5) — invariante: suma EXACTA 10.000 basis
  // points, nunca negativo. La distribución en importes reales (por
  // temporada/tramo) la calcula LoanCostService con Money.allocateByWeights
  // — aquí solo se valida y congela la PROPORCIÓN pactada.
  // ---------------------------------------------------------------------
  function validateSalaryAllocation(allocation) {
    if (!allocation) throw new Error('Loan: falta "salaryAllocation".');
    const { ownerShareBasisPoints, borrowerShareBasisPoints } = allocation;
    if (!Number.isInteger(ownerShareBasisPoints) || ownerShareBasisPoints < 0) {
      throw new Error('Loan.salaryAllocation: "ownerShareBasisPoints" debe ser un entero >= 0.');
    }
    if (!Number.isInteger(borrowerShareBasisPoints) || borrowerShareBasisPoints < 0) {
      throw new Error('Loan.salaryAllocation: "borrowerShareBasisPoints" debe ser un entero >= 0.');
    }
    if (ownerShareBasisPoints + borrowerShareBasisPoints !== 10000) {
      throw new Error(
        `Loan.salaryAllocation: la suma debe ser EXACTAMENTE 10000 basis points (100%), recibido `
        + `${ownerShareBasisPoints + borrowerShareBasisPoints}.`,
      );
    }
    return Object.freeze({ ownerShareBasisPoints, borrowerShareBasisPoints });
  }

  // ---------------------------------------------------------------------
  // LoanClause (sección 8.6/17) — unión discriminada. Un texto libre puede
  // acompañar como nota no ejecutable (`note`), pero NUNCA activa
  // comportamiento por sí solo — solo los campos tipados de cada variante
  // son consultados por LoanExecutionService/EligibilityService/etc.
  // ---------------------------------------------------------------------
  const LOAN_CLAUSE_TYPES = [
    'recall-right',
    'purchase-option',
    'purchase-obligation',
    'early-termination',
    'parent-club-match-eligibility',
    'promised-role',
    'minimum-participation-promise',
    'medical-responsibility',
    'insurance-responsibility',
    'bonus-allocation',
  ];

  const PURCHASE_OBLIGATION_TRIGGER_TYPES = ['matches-played', 'minutes-played', 'promotion', 'permanence', 'date'];

  function validateLoanClause(clause, label) {
    const lbl = label || 'LoanClause';
    if (!clause || typeof clause !== 'object') throw new Error(`${lbl}: cláusula vacía o no es un objeto.`);
    if (!LOAN_CLAUSE_TYPES.includes(clause.type)) {
      throw new Error(`${lbl}: tipo de cláusula desconocido "${clause.type}" — catálogo: ${LOAN_CLAUSE_TYPES.join(', ')}.`);
    }
    const base = { id: clause.id, type: clause.type, note: clause.note || null };
    switch (clause.type) {
      case 'recall-right': {
        requireFields(clause, ['holderClubId', 'windows'], `${lbl}(recall-right)`);
        if (!['owner', 'borrower'].includes(clause.holderClubId)) {
          throw new Error(`${lbl}(recall-right): "holderClubId" debe ser "owner" o "borrower".`);
        }
        if (!Array.isArray(clause.windows) || !clause.windows.length) {
          throw new Error(`${lbl}(recall-right): "windows" debe ser un array no vacío de {startDate,endDate}.`);
        }
        const windows = clause.windows.map((w) => {
          const start = toIso(w.startDate);
          const end = toIso(w.endDate);
          if (LD().isBefore(end, start)) throw new Error(`${lbl}(recall-right): ventana con endDate anterior a startDate.`);
          return Object.freeze({ startDate: start, endDate: end });
        });
        const noticeDays = Number.isInteger(clause.noticeDays) && clause.noticeDays >= 0 ? clause.noticeDays : 0;
        return Object.freeze({
          ...base,
          holderClubId: clause.holderClubId,
          windows: Object.freeze(windows),
          noticeDays,
          conditions: Object.freeze([...(clause.conditions || [])]),
          compensation: clause.compensation ? Object.freeze(normalizeMoney(clause.compensation, `${lbl}(recall-right).compensation`)) : null,
          preexistingConsent: Boolean(clause.preexistingConsent),
          scopeCompetitionIds: Object.freeze([...(clause.scopeCompetitionIds || [])]),
        });
      }
      case 'purchase-option':
      case 'purchase-obligation': {
        requireFields(clause, ['beneficiaryClubId', 'price', 'windowStart', 'windowEnd'], `${lbl}(${clause.type})`);
        if (!['owner', 'borrower'].includes(clause.beneficiaryClubId)) {
          throw new Error(`${lbl}(${clause.type}): "beneficiaryClubId" debe ser "owner" o "borrower".`);
        }
        const windowStart = toIso(clause.windowStart);
        const windowEnd = toIso(clause.windowEnd);
        if (LD().isBefore(windowEnd, windowStart)) throw new Error(`${lbl}(${clause.type}): windowEnd anterior a windowStart.`);
        const common = {
          ...base,
          beneficiaryClubId: clause.beneficiaryClubId,
          price: Object.freeze(normalizeMoney(clause.price, `${lbl}(${clause.type}).price`)),
          windowStart,
          windowEnd,
        };
        if (clause.type === 'purchase-option') {
          return Object.freeze({
            ...common,
            exerciseForm: clause.exerciseForm || 'unilateral-notice',
            objectiveConditions: Object.freeze([...(clause.objectiveConditions || [])]),
          });
        }
        // purchase-obligation: trigger OBJETIVO y auditable — nunca utilidad
        // oculta, decisión subjetiva ni azar (sección 17.3).
        requireFields(clause, ['trigger'], `${lbl}(purchase-obligation)`);
        if (!clause.trigger || !PURCHASE_OBLIGATION_TRIGGER_TYPES.includes(clause.trigger.type)) {
          throw new Error(
            `${lbl}(purchase-obligation): "trigger.type" debe ser uno de ${PURCHASE_OBLIGATION_TRIGGER_TYPES.join(', ')}.`,
          );
        }
        if (clause.trigger.type !== 'date' && !(Number.isInteger(clause.trigger.threshold) && clause.trigger.threshold > 0)
          && !['promotion', 'permanence'].includes(clause.trigger.type)) {
          throw new Error(`${lbl}(purchase-obligation): "trigger.threshold" debe ser un entero positivo para "${clause.trigger.type}".`);
        }
        return Object.freeze({
          ...common,
          trigger: Object.freeze({ ...clause.trigger, effectiveDate: clause.trigger.effectiveDate ? toIso(clause.trigger.effectiveDate) : null }),
        });
      }
      case 'early-termination': {
        requireFields(clause, ['initiator', 'requiresConsentOf'], `${lbl}(early-termination)`);
        if (!['owner', 'borrower', 'mutual'].includes(clause.initiator)) {
          throw new Error(`${lbl}(early-termination): "initiator" debe ser "owner", "borrower" o "mutual".`);
        }
        return Object.freeze({
          ...base,
          initiator: clause.initiator,
          requiresConsentOf: Object.freeze([...clause.requiresConsentOf]),
          conditions: Object.freeze([...(clause.conditions || [])]),
        });
      }
      case 'parent-club-match-eligibility': {
        requireFields(clause, ['scope', 'prohibited'], `${lbl}(parent-club-match-eligibility)`);
        if (!['competition', 'match'].includes(clause.scope)) {
          throw new Error(`${lbl}(parent-club-match-eligibility): "scope" debe ser "competition" o "match".`);
        }
        return Object.freeze({
          ...base,
          scope: clause.scope,
          competitionId: clause.competitionId || null,
          prohibited: Boolean(clause.prohibited),
          reason: clause.reason || null,
        });
      }
      case 'promised-role':
        requireFields(clause, ['roleDescription'], `${lbl}(promised-role)`);
        return Object.freeze({ ...base, roleDescription: clause.roleDescription, executable: false });
      case 'minimum-participation-promise':
        requireFields(clause, ['description'], `${lbl}(minimum-participation-promise)`);
        return Object.freeze({ ...base, description: clause.description, executable: false });
      case 'medical-responsibility':
      case 'insurance-responsibility': {
        requireFields(clause, ['responsibleParty'], `${lbl}(${clause.type})`);
        if (!['owner', 'borrower', 'shared'].includes(clause.responsibleParty)) {
          throw new Error(`${lbl}(${clause.type}): "responsibleParty" debe ser "owner", "borrower" o "shared".`);
        }
        return Object.freeze({ ...base, responsibleParty: clause.responsibleParty, notes: clause.notes || null });
      }
      case 'bonus-allocation': {
        requireFields(clause, ['ownerShareBasisPoints', 'borrowerShareBasisPoints'], `${lbl}(bonus-allocation)`);
        const alloc = validateSalaryAllocation({
          ownerShareBasisPoints: clause.ownerShareBasisPoints, borrowerShareBasisPoints: clause.borrowerShareBasisPoints,
        });
        return Object.freeze({ ...base, bonusId: clause.bonusId || null, ...alloc });
      }
      default:
        throw new Error(`${lbl}: tipo de cláusula "${clause.type}" no manejado.`);
    }
  }

  function validateLoanClauses(clauses, label) {
    return Object.freeze((clauses || []).map((c, idx) => validateLoanClause({ ...c, id: c.id || `clause-${idx + 1}` }, label)));
  }

  // ---------------------------------------------------------------------
  // Canon/reparto/responsabilidad médica-seguro comunes a Proposal/Agreement.
  // ---------------------------------------------------------------------
  function validateResponsibility(value, fieldLabel) {
    if (!value) return null;
    if (!['owner', 'borrower', 'shared'].includes(value.responsibleParty)) {
      throw new Error(`${fieldLabel}: "responsibleParty" debe ser "owner", "borrower" o "shared".`);
    }
    return Object.freeze({ responsibleParty: value.responsibleParty, notes: value.notes || null });
  }

  // ---------------------------------------------------------------------
  // LoanCase (sección 8.1) — expediente, fuente de verdad del ciclo de vida.
  // ---------------------------------------------------------------------
  class LoanCase {
    constructor(data = {}) {
      requireFields(data, ['id', 'playerId', 'ownerClubId', 'borrowerClubId', 'masterContractId', 'initiatingClubId', 'createdAt', 'seasonKey'], 'LoanCase');
      if (data.ownerClubId === data.borrowerClubId) {
        throw new Error('LoanCase: el club propietario y el cesionario no pueden ser el mismo club.');
      }
      const transactionScope = data.transactionScope || 'domestic';
      if (!['domestic', 'international'].includes(transactionScope)) {
        throw new Error(`LoanCase: transactionScope desconocido "${transactionScope}".`);
      }
      this.id = data.id;
      this.playerId = data.playerId;
      this.ownerClubId = data.ownerClubId;
      this.borrowerClubId = data.borrowerClubId;
      this.masterContractId = data.masterContractId;
      this.initiatingClubId = data.initiatingClubId;
      this.createdAt = toIso(data.createdAt);
      this.seasonKey = data.seasonKey;
      this.transactionScope = transactionScope;
      this.currentProposalId = data.currentProposalId || null;
      this.agreementId = data.agreementId || null;
      this.outboundTransactionId = data.outboundTransactionId || null;
      this.returnTransactionId = data.returnTransactionId || null;
      // Congelada al abrirse (mismo criterio que TransferCase.rulesSnapshot)
      // — un ascenso/descenso posterior nunca reescribe un expediente vivo.
      this.rulesSnapshot = data.rulesSnapshot ? Object.freeze({ ...data.rulesSnapshot }) : null;
      this.lastBlockers = Object.freeze([...(data.lastBlockers || [])]);
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : 'simulated-loan-v1',
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
      this.events = [];
      this.addEvent({ id: `${this.id}:case-opened`, type: 'case-opened', date: this.createdAt });
      (data.events || []).filter((e) => e.type !== 'case-opened').forEach((event) => this.addEvent(event));
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().LoanCaseEvents, this.events, event, `LoanCase "${this.id}"`);
      return this;
    }

    statusOn(date) { return Events().LoanCaseEvents.deriveStatus(this.events, date ? toIso(date) : null); }

    isTerminal(date) { return Events().LOAN_CASE_TERMINAL_STATUSES.has(this.statusOn(date)); }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        ownerClubId: this.ownerClubId,
        borrowerClubId: this.borrowerClubId,
        masterContractId: this.masterContractId,
        initiatingClubId: this.initiatingClubId,
        createdAt: this.createdAt,
        seasonKey: this.seasonKey,
        transactionScope: this.transactionScope,
        currentProposalId: this.currentProposalId,
        agreementId: this.agreementId,
        outboundTransactionId: this.outboundTransactionId,
        returnTransactionId: this.returnTransactionId,
        rulesSnapshot: this.rulesSnapshot,
        lastBlockers: this.lastBlockers,
        events: this.events,
        status: this.statusOn(null),
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // LoanProposal (sección 8.2) — oferta INMUTABLE y versionada. Una
  // contraoferta crea otra instancia; nunca muta la anterior. Cambiar
  // cualquier término invalida las aceptaciones previas (invariante 14):
  // por eso el hash se calcula sobre TODOS los términos económicos/de
  // fecha/cláusulas y las aceptaciones (`LoanPartyConsent`) se ligan al
  // `termsHash` exacto, nunca al id de la propuesta a secas.
  // ---------------------------------------------------------------------
  class LoanProposal {
    constructor(data = {}) {
      requireFields(data, [
        'id', 'loanCaseId', 'version', 'authorClubId', 'createdAt', 'serviceStartDate', 'returnEffectiveDate', 'expiresAt',
      ], 'LoanProposal');
      if (!Number.isInteger(data.version) || data.version < 1) {
        throw new Error('LoanProposal: "version" debe ser un entero >= 1.');
      }
      this.id = data.id;
      this.loanCaseId = data.loanCaseId;
      this.version = data.version;
      this.parentProposalId = data.parentProposalId || null;
      this.authorClubId = data.authorClubId;
      this.createdAt = toIso(data.createdAt);
      this.serviceStartDate = toIso(data.serviceStartDate);
      this.returnEffectiveDate = toIso(data.returnEffectiveDate);
      // Sección 7: intervalo semiabierto, nunca cesión de cero días.
      if (!LD().isBefore(this.serviceStartDate, this.returnEffectiveDate)) {
        throw new Error('LoanProposal: "serviceStartDate" debe ser estrictamente anterior a "returnEffectiveDate" (sin cesión de cero días).');
      }
      this.expiresAt = toIso(data.expiresAt);
      // `loanFee` es OPCIONAL — una cesión puede pactarse sin canon.
      this.loanFee = data.loanFee ? Object.freeze(normalizeMoney(data.loanFee, 'LoanProposal.loanFee')) : null;
      this.salaryAllocation = validateSalaryAllocation(data.salaryAllocation);
      this.clauses = validateLoanClauses(data.clauses, `LoanProposal "${data.id}"`);
      this.medicalResponsibility = validateResponsibility(data.medicalResponsibility, 'LoanProposal.medicalResponsibility');
      this.insuranceResponsibility = validateResponsibility(data.insuranceResponsibility, 'LoanProposal.insuranceResponsibility');
      this.documentsRequired = Object.freeze([...(data.documentsRequired || [])]);
      this.reciprocalLoanLinkedProposalId = data.reciprocalLoanLinkedProposalId || null;
      this.provenance = { dataSource: 'simulated-loan-v1', isReal: false };
      // Hash canónico de términos (sección 8.2/8.3) — calculado sobre el
      // contenido económico/temporal/cláusulas ya congelado arriba, NUNCA
      // sobre metadatos administrativos (id/version/createdAt), para que dos
      // versiones con TÉRMINOS idénticos pero metadatos distintos no
      // colisionen por accidente ni, a la inversa, un cambio real de
      // términos deje pasar una aceptación vieja.
      this.termsHash = LoanProposal.computeTermsHash({
        loanCaseId: this.loanCaseId,
        serviceStartDate: this.serviceStartDate,
        returnEffectiveDate: this.returnEffectiveDate,
        loanFee: this.loanFee,
        salaryAllocation: this.salaryAllocation,
        clauses: this.clauses,
        medicalResponsibility: this.medicalResponsibility,
        insuranceResponsibility: this.insuranceResponsibility,
        documentsRequired: this.documentsRequired,
      });
      this.events = [];
      this.addEvent({ id: `${this.id}:proposal-sent`, type: 'proposal-sent', date: this.createdAt });
      (data.events || []).filter((e) => e.type !== 'proposal-sent').forEach((event) => this.addEvent(event));
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().LoanProposalEvents, this.events, event, `LoanProposal "${this.id}"`);
      return this;
    }

    statusOn(date) { return Events().LoanProposalEvents.deriveStatus(this.events, date ? toIso(date) : null); }

    isLiveOn(date) {
      const iso = toIso(date);
      return this.statusOn(iso) === 'sent' && !LD().isAfter(iso, this.expiresAt);
    }

    toJSON() {
      return {
        id: this.id,
        loanCaseId: this.loanCaseId,
        version: this.version,
        parentProposalId: this.parentProposalId,
        authorClubId: this.authorClubId,
        createdAt: this.createdAt,
        serviceStartDate: this.serviceStartDate,
        returnEffectiveDate: this.returnEffectiveDate,
        expiresAt: this.expiresAt,
        loanFee: this.loanFee,
        salaryAllocation: this.salaryAllocation,
        clauses: this.clauses,
        medicalResponsibility: this.medicalResponsibility,
        insuranceResponsibility: this.insuranceResponsibility,
        documentsRequired: this.documentsRequired,
        reciprocalLoanLinkedProposalId: this.reciprocalLoanLinkedProposalId,
        termsHash: this.termsHash,
        events: this.events,
        status: this.statusOn(null),
        provenance: this.provenance,
      };
    }
  }
  // Estático: expuesto para que LoanPartyConsent/LoanService puedan validar
  // un `termsHash` recibido contra los términos reales sin duplicar la
  // fórmula de hashing.
  LoanProposal.computeTermsHash = (terms) => Hash().stableHash(terms);

  // ---------------------------------------------------------------------
  // LoanPartyConsent (sección 8.3) — consentimiento INMUTABLE de UNA parte
  // sobre UNA versión exacta (ligado a `termsHash`, nunca solo al id de la
  // propuesta: si los términos cambian, el hash cambia y una aceptación
  // vieja deja de coincidir con cualquier propuesta nueva).
  // ---------------------------------------------------------------------
  const CONSENT_PARTY_TYPES = ['ownerClub', 'borrowerClub', 'player', 'legalRepresentative'];

  class LoanPartyConsent {
    constructor(data = {}) {
      requireFields(data, ['id', 'loanCaseId', 'proposalId', 'partyType', 'partyId', 'termsHash', 'grantedAt', 'grantedBy'], 'LoanPartyConsent');
      if (!CONSENT_PARTY_TYPES.includes(data.partyType)) {
        throw new Error(`LoanPartyConsent: partyType desconocido "${data.partyType}" (catálogo: ${CONSENT_PARTY_TYPES.join(', ')}).`);
      }
      this.id = data.id;
      this.loanCaseId = data.loanCaseId;
      this.proposalId = data.proposalId;
      this.partyType = data.partyType;
      this.partyId = data.partyId;
      this.termsHash = data.termsHash;
      this.grantedAt = toIso(data.grantedAt);
      this.grantedBy = data.grantedBy;
      // Informativo — un agente puede TRANSMITIR/negociar, nunca sustituye
      // el consentimiento del jugador (invariante 13 del prompt).
      this.representationMandateId = data.representationMandateId || null;
      this.scope = data.scope || 'full-terms';
      this.documentRef = data.documentRef || null;
      this.withdrawnAt = data.withdrawnAt ? toIso(data.withdrawnAt) : null;
      this.provenance = { dataSource: 'simulated-loan-v1', isReal: false };
      Object.freeze(this);
    }

    isLiveFor(termsHash) { return !this.withdrawnAt && this.termsHash === termsHash; }

    toJSON() {
      return {
        id: this.id,
        loanCaseId: this.loanCaseId,
        proposalId: this.proposalId,
        partyType: this.partyType,
        partyId: this.partyId,
        termsHash: this.termsHash,
        grantedAt: this.grantedAt,
        grantedBy: this.grantedBy,
        representationMandateId: this.representationMandateId,
        scope: this.scope,
        documentRef: this.documentRef,
        withdrawnAt: this.withdrawnAt,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // LoanAgreement (sección 8.4) — fuente CANÓNICA de una cesión acordada y,
  // tras activarse, VIVA. Su estado se DERIVA de los ids de movimiento
  // (`outboundTransactionId`/`returnTransactionId`/...), nunca un campo de
  // estado libre — mismo criterio que "el estado del contrato se deriva de
  // fechas y eventos" de CONTRACT-1.
  // ---------------------------------------------------------------------
  class LoanAgreement {
    constructor(data = {}) {
      requireFields(data, [
        'id', 'loanCaseId', 'proposalId', 'playerId', 'ownerClubId', 'borrowerClubId', 'masterContractId',
        'serviceStartDate', 'returnEffectiveDate', 'agreedAt',
      ], 'LoanAgreement');
      this.id = data.id;
      this.loanCaseId = data.loanCaseId;
      this.proposalId = data.proposalId;
      this.playerId = data.playerId;
      this.ownerClubId = data.ownerClubId;
      this.borrowerClubId = data.borrowerClubId;
      this.masterContractId = data.masterContractId;
      this.serviceStartDate = toIso(data.serviceStartDate);
      this.returnEffectiveDate = toIso(data.returnEffectiveDate);
      if (!LD().isBefore(this.serviceStartDate, this.returnEffectiveDate)) {
        throw new Error('LoanAgreement: "serviceStartDate" debe ser estrictamente anterior a "returnEffectiveDate".');
      }
      this.agreedAt = toIso(data.agreedAt);
      this.loanFee = data.loanFee ? Object.freeze(normalizeMoney(data.loanFee, 'LoanAgreement.loanFee')) : null;
      // Participación legal del jugador sobre el canon (art. 11.3 español u
      // otra jurisdicción) — importe CONGELADO al activarse, nunca recalculado.
      this.playerParticipation = data.playerParticipation ? Object.freeze(normalizeMoney(data.playerParticipation, 'LoanAgreement.playerParticipation')) : null;
      this.salaryAllocation = validateSalaryAllocation(data.salaryAllocation);
      this.jointAndSeveralLiability = data.jointAndSeveralLiability ? Object.freeze({ ...data.jointAndSeveralLiability }) : null;
      this.medicalResponsibility = validateResponsibility(data.medicalResponsibility, 'LoanAgreement.medicalResponsibility');
      this.insuranceResponsibility = validateResponsibility(data.insuranceResponsibility, 'LoanAgreement.insuranceResponsibility');
      this.clauses = validateLoanClauses(data.clauses, `LoanAgreement "${data.id}"`);
      this.consentIds = Object.freeze([...(data.consentIds || [])]);
      this.documentsRequired = Object.freeze([...(data.documentsRequired || [])]);
      this.documentStatuses = { ...(data.documentStatuses || {}) };
      this.rulesSnapshot = data.rulesSnapshot ? Object.freeze({ ...data.rulesSnapshot }) : null;
      // Movimientos/terminales — SIEMPRE escritos por LoanExecutionService
      // dentro de una transacción atómica, nunca por esta clase.
      this.outboundTransactionId = data.outboundTransactionId || null;
      this.returnTransactionId = data.returnTransactionId || null;
      this.earlyTerminationRecordId = data.earlyTerminationRecordId || null;
      this.convertedTransferCaseId = data.convertedTransferCaseId || null;
      this.obligationIds = Object.freeze([...(data.obligationIds || [])]);
      this.provenance = { dataSource: 'simulated-loan-v1', isReal: false };
    }

    allDocumentsReady() {
      return this.documentsRequired.every((doc) => this.documentStatuses[doc] === 'provided' || this.documentStatuses[doc] === 'verified');
    }

    // Estado DERIVADO — nunca persistido como campo libre (sección 10 del
    // prompt: "active solo tras commit real de salida").
    currentStatus() {
      if (this.convertedTransferCaseId) return 'convertedToPermanentTransfer';
      if (this.earlyTerminationRecordId) return 'terminatedEarly';
      if (this.returnTransactionId) return 'returned';
      if (this.outboundTransactionId) return 'active';
      return 'agreed';
    }

    isActiveOn(date) {
      if (this.currentStatus() !== 'active') return false;
      const iso = toIso(date);
      return !LD().isBefore(iso, this.serviceStartDate) && LD().isBefore(iso, this.returnEffectiveDate);
    }

    toJSON() {
      return {
        id: this.id,
        loanCaseId: this.loanCaseId,
        proposalId: this.proposalId,
        playerId: this.playerId,
        ownerClubId: this.ownerClubId,
        borrowerClubId: this.borrowerClubId,
        masterContractId: this.masterContractId,
        serviceStartDate: this.serviceStartDate,
        returnEffectiveDate: this.returnEffectiveDate,
        agreedAt: this.agreedAt,
        loanFee: this.loanFee,
        playerParticipation: this.playerParticipation,
        salaryAllocation: this.salaryAllocation,
        jointAndSeveralLiability: this.jointAndSeveralLiability,
        medicalResponsibility: this.medicalResponsibility,
        insuranceResponsibility: this.insuranceResponsibility,
        clauses: this.clauses,
        consentIds: this.consentIds,
        documentsRequired: this.documentsRequired,
        documentStatuses: { ...this.documentStatuses },
        rulesSnapshot: this.rulesSnapshot,
        outboundTransactionId: this.outboundTransactionId,
        returnTransactionId: this.returnTransactionId,
        earlyTerminationRecordId: this.earlyTerminationRecordId,
        convertedTransferCaseId: this.convertedTransferCaseId,
        obligationIds: this.obligationIds,
        status: this.currentStatus(),
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // PurchaseOptionExercise (sección 8.7/17.2/17.3) — ejercer NUNCA termina
  // el contrato, crea el nuevo, mueve roster ni obliga al jugador a firmar.
  // Solo abre/prepara una vía de TRANSFER-1.
  // ---------------------------------------------------------------------
  class PurchaseOptionExercise {
    constructor(data = {}) {
      requireFields(data, ['id', 'loanAgreementId', 'clauseId', 'beneficiaryClubId', 'exercisedAt', 'price'], 'PurchaseOptionExercise');
      this.id = data.id;
      this.loanAgreementId = data.loanAgreementId;
      this.clauseId = data.clauseId;
      this.beneficiaryClubId = data.beneficiaryClubId;
      this.exercisedAt = toIso(data.exercisedAt);
      this.price = Object.freeze(normalizeMoney(data.price, 'PurchaseOptionExercise.price'));
      this.window = data.window ? Object.freeze({ startDate: toIso(data.window.startDate), endDate: toIso(data.window.endDate) }) : null;
      this.evidence = data.evidence || null;
      this.transferCaseId = data.transferCaseId || null;
      this.consentBlockerCode = data.consentBlockerCode || null;
      this.provenance = { dataSource: 'simulated-loan-v1', isReal: false };
      this.events = [];
      this.addEvent({ id: `${this.id}:exercise-notified`, type: 'exercise-notified', date: this.exercisedAt });
      (data.events || []).filter((e) => e.type !== 'exercise-notified').forEach((event) => this.addEvent(event));
    }

    addEvent(event) {
      this.events = appendValidatedEvent(Events().PurchaseOptionEvents, this.events, event, `PurchaseOptionExercise "${this.id}"`);
      return this;
    }

    statusOn(date) { return Events().PurchaseOptionEvents.deriveStatus(this.events, date ? toIso(date) : null); }

    toJSON() {
      return {
        id: this.id,
        loanAgreementId: this.loanAgreementId,
        clauseId: this.clauseId,
        beneficiaryClubId: this.beneficiaryClubId,
        exercisedAt: this.exercisedAt,
        price: this.price,
        window: this.window,
        evidence: this.evidence,
        transferCaseId: this.transferCaseId,
        consentBlockerCode: this.consentBlockerCode,
        events: this.events,
        status: this.statusOn(null),
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = {
    LOAN_CLAUSE_TYPES,
    CONSENT_PARTY_TYPES,
    validateSalaryAllocation,
    validateLoanClause,
    validateLoanClauses,
    LoanCase,
    LoanProposal,
    LoanPartyConsent,
    LoanAgreement,
    PurchaseOptionExercise,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
