// src/core/LoanRegistry.js
// LOAN-1 (DESIGN.md 9.21, sección 9 del prompt) — Registro CANÓNICO de
// cesiones de la partida. Instancia EXPLÍCITA por carrera
// (`state.loanRegistry`), NUNCA un singleton — mismo criterio que
// PlayerRegistry/ContractRegistry/RegistrationRegistry/MarketRegistry/
// TransferRegistry. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// `FinancialObligation`/`TransactionRecord` (economía y recibos de
// salida/retorno) NO se duplican aquí — viven en `TransferRegistry`
// (sección 8.8 del prompt: "si amplías TransactionRecord, LoanRegistry solo
// referencia su id"). `LoanAgreement.obligationIds`/`outboundTransactionId`/
// `returnTransactionId` son referencias que se resuelven contra
// `transferRegistry` en el punto de consulta — nunca un segundo índice.
//
// Módulo puro: no lee DOM, ni `state`, ni variables globales.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const RegistryIndexAuditModule = isNode ? require('../utils/RegistryIndexAudit.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function pushIndex(map, key, value) {
    if (key === null || key === undefined) return;
    const list = map.get(key) || [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  }

  function popIndex(map, key, value) {
    if (key === null || key === undefined) return;
    const list = map.get(key) || [];
    map.set(key, list.filter((x) => x !== value));
  }

  function byId(list) { return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)); }

  function auditIndexSymmetry(indexName, indexMap, primaryMap) {
    return RegistryIndexAuditModule.RegistryIndexAudit.auditIndexSymmetry(indexName, indexMap, primaryMap);
  }

  class LoanRegistry {
    constructor() {
      this._cases = new Map();
      this._casesByPlayer = new Map();
      this._casesByOwner = new Map();
      this._casesByBorrower = new Map();
      this._proposals = new Map();
      this._proposalsByCase = new Map();
      this._consents = new Map();
      this._consentsByCase = new Map();
      this._agreements = new Map();
      this._agreementsByPlayer = new Map();
      this._agreementsByOwner = new Map();
      this._agreementsByBorrower = new Map();
      this._agreementsByMasterContract = new Map();
      this._optionExercises = new Map();
      this._optionExercisesByAgreement = new Map();
      this._scheduledEvents = new Map();
    }

    // --- Expedientes ---------------------------------------------------
    registerCase(loanCase) {
      const existing = this._cases.get(loanCase.id);
      if (existing && existing !== loanCase) throw new Error(`LoanRegistry: ya existe un LoanCase distinto con id "${loanCase.id}".`);
      this._cases.set(loanCase.id, loanCase);
      pushIndex(this._casesByPlayer, loanCase.playerId, loanCase.id);
      pushIndex(this._casesByOwner, loanCase.ownerClubId, loanCase.id);
      pushIndex(this._casesByBorrower, loanCase.borrowerClubId, loanCase.id);
      return loanCase;
    }

    unregisterCase(id) {
      const found = this._cases.get(id);
      if (!found) return false;
      this._cases.delete(id);
      popIndex(this._casesByPlayer, found.playerId, id);
      popIndex(this._casesByOwner, found.ownerClubId, id);
      popIndex(this._casesByBorrower, found.borrowerClubId, id);
      return true;
    }

    getCase(id) { return this._cases.get(id) || null; }

    requireCase(id) {
      const found = this.getCase(id);
      if (!found) throw new Error(`LoanRegistry: no existe el LoanCase "${id}".`);
      return found;
    }

    casesForPlayer(playerId) { return byId((this._casesByPlayer.get(playerId) || []).map((id) => this._cases.get(id))); }

    casesForOwner(clubId) { return byId((this._casesByOwner.get(clubId) || []).map((id) => this._cases.get(id))); }

    casesForBorrower(clubId) { return byId((this._casesByBorrower.get(clubId) || []).map((id) => this._cases.get(id))); }

    allCases() { return byId([...this._cases.values()]); }

    liveCasesForPlayer(playerId, date) { return this.casesForPlayer(playerId).filter((c) => !c.isTerminal(date)); }

    // --- Propuestas (versionadas, inmutables) -----------------------------
    registerProposal(proposal) {
      const existing = this._proposals.get(proposal.id);
      if (existing && existing !== proposal) throw new Error(`LoanRegistry: ya existe una LoanProposal distinta con id "${proposal.id}".`);
      this._proposals.set(proposal.id, proposal);
      pushIndex(this._proposalsByCase, proposal.loanCaseId, proposal.id);
      return proposal;
    }

    unregisterProposal(id) {
      const found = this._proposals.get(id);
      if (!found) return false;
      this._proposals.delete(id);
      popIndex(this._proposalsByCase, found.loanCaseId, id);
      return true;
    }

    getProposal(id) { return this._proposals.get(id) || null; }

    proposalsForCase(caseId) {
      return (this._proposalsByCase.get(caseId) || []).map((id) => this._proposals.get(id)).sort((a, b) => a.version - b.version);
    }

    // Versión VIVA ('sent', no expirada) de un expediente — invariante 7
    // (mismo criterio que MarketRegistry.liveOfferForThread/
    // TransferRegistry.liveClubOfferForCase): nunca más de una a la vez.
    liveProposalForCase(caseId, date) {
      const iso = toIso(date);
      const live = this.proposalsForCase(caseId).filter((p) => p.isLiveOn(iso));
      if (live.length > 1) {
        throw new Error(`LoanRegistry: el expediente "${caseId}" tiene más de una propuesta viva a la vez a ${iso} — invariante rota.`);
      }
      return live[0] || null;
    }

    // --- Consentimientos ---------------------------------------------------
    registerConsent(consent) {
      const existing = this._consents.get(consent.id);
      if (existing && existing !== consent) throw new Error(`LoanRegistry: ya existe un LoanPartyConsent distinto con id "${consent.id}".`);
      this._consents.set(consent.id, consent);
      pushIndex(this._consentsByCase, consent.loanCaseId, consent.id);
      return consent;
    }

    unregisterConsent(id) {
      const found = this._consents.get(id);
      if (!found) return false;
      this._consents.delete(id);
      popIndex(this._consentsByCase, found.loanCaseId, id);
      return true;
    }

    getConsent(id) { return this._consents.get(id) || null; }

    consentsForCase(caseId) { return byId((this._consentsByCase.get(caseId) || []).map((id) => this._consents.get(id))); }

    // Los TRES consentimientos vivos (no retirados) sobre el MISMO
    // `termsHash` — 'agreed' exige coincidencia exacta de los tres.
    consentsLiveForTermsHash(caseId, termsHash) {
      return this.consentsForCase(caseId).filter((c) => c.isLiveFor(termsHash));
    }

    // --- Acuerdos ------------------------------------------------------
    registerAgreement(agreement) {
      const existing = this._agreements.get(agreement.id);
      if (existing && existing !== agreement) throw new Error(`LoanRegistry: ya existe un LoanAgreement distinto con id "${agreement.id}".`);
      this._agreements.set(agreement.id, agreement);
      pushIndex(this._agreementsByPlayer, agreement.playerId, agreement.id);
      pushIndex(this._agreementsByOwner, agreement.ownerClubId, agreement.id);
      pushIndex(this._agreementsByBorrower, agreement.borrowerClubId, agreement.id);
      pushIndex(this._agreementsByMasterContract, agreement.masterContractId, agreement.id);
      return agreement;
    }

    unregisterAgreement(id) {
      const found = this._agreements.get(id);
      if (!found) return false;
      this._agreements.delete(id);
      popIndex(this._agreementsByPlayer, found.playerId, id);
      popIndex(this._agreementsByOwner, found.ownerClubId, id);
      popIndex(this._agreementsByBorrower, found.borrowerClubId, id);
      popIndex(this._agreementsByMasterContract, found.masterContractId, id);
      return true;
    }

    getAgreement(id) { return this._agreements.get(id) || null; }

    requireAgreement(id) {
      const found = this.getAgreement(id);
      if (!found) throw new Error(`LoanRegistry: no existe el LoanAgreement "${id}".`);
      return found;
    }

    agreementsForPlayer(playerId) { return byId((this._agreementsByPlayer.get(playerId) || []).map((id) => this._agreements.get(id))); }

    agreementsForOwner(clubId) { return byId((this._agreementsByOwner.get(clubId) || []).map((id) => this._agreements.get(id))); }

    agreementsForBorrower(clubId) { return byId((this._agreementsByBorrower.get(clubId) || []).map((id) => this._agreements.get(id))); }

    allAgreements() { return byId([...this._agreements.values()]); }

    // Acuerdo ACTIVO de un jugador en una fecha (invariante 8: máximo uno) —
    // fuente de verdad para "¿este jugador está cedido ahora mismo?".
    activeAgreementForPlayer(playerId, date) {
      const active = this.agreementsForPlayer(playerId).filter((a) => a.isActiveOn(date));
      if (active.length > 1) {
        throw new Error(`LoanRegistry: el jugador "${playerId}" tiene más de una cesión activa a la vez a ${toIso(date)} — invariante rota.`);
      }
      return active[0] || null;
    }

    // Sección 9.21/TRANSFER-1 BUG-19: hook para que
    // `TransferRegistry.validateIntegrity()` explique un `player.teamId`
    // distinto del último `TransactionRecord` cuando el jugador está cedido
    // (club de servicio real diverge del propietario contractual).
    hasActiveLoanForPlayer(playerId, date) { return Boolean(this.activeAgreementForPlayer(playerId, date)); }

    loansHistoryForPlayer(playerId) { return this.agreementsForPlayer(playerId); }

    // --- Ejercicios de opción/obligación de compra -------------------------
    registerOptionExercise(exercise) {
      const existing = this._optionExercises.get(exercise.id);
      if (existing && existing !== exercise) throw new Error(`LoanRegistry: ya existe un PurchaseOptionExercise distinto con id "${exercise.id}".`);
      this._optionExercises.set(exercise.id, exercise);
      pushIndex(this._optionExercisesByAgreement, exercise.loanAgreementId, exercise.id);
      return exercise;
    }

    unregisterOptionExercise(id) {
      const found = this._optionExercises.get(id);
      if (!found) return false;
      this._optionExercises.delete(id);
      popIndex(this._optionExercisesByAgreement, found.loanAgreementId, id);
      return true;
    }

    getOptionExercise(id) { return this._optionExercises.get(id) || null; }

    optionExercisesForAgreement(agreementId) {
      return byId((this._optionExercisesByAgreement.get(agreementId) || []).map((id) => this._optionExercises.get(id)));
    }

    // --- Eventos programados (retorno/recall/ventanas/expiraciones) --------
    // Mismo criterio que TransferRegistry: `advanceGameClockTo()` es el
    // ÚNICO punto que los dispara (sección 18 del prompt).
    scheduleEvent(record) {
      const existing = this._scheduledEvents.get(record.id);
      if (existing) return existing;
      this._scheduledEvents.set(record.id, { ...record, processed: false });
      return this._scheduledEvents.get(record.id);
    }

    markEventProcessed(id) {
      const record = this._scheduledEvents.get(id);
      if (!record || record.processed) return false;
      record.processed = true;
      return true;
    }

    getScheduledEvent(id) { return this._scheduledEvents.get(id) || null; }

    eventsDueThrough(date) {
      const iso = toIso(date);
      return [...this._scheduledEvents.values()]
        .filter((e) => !e.processed && LD().compare(e.dueDate, iso) <= 0)
        .sort((a, b) => {
          const cmp = LD().compare(a.dueDate, b.dueDate);
          return cmp !== 0 ? cmp : (a.id < b.id ? -1 : 1);
        });
    }

    nextRequiredAttentionEventForClub(clubId, throughDate) {
      const iso = toIso(throughDate);
      const list = [...this._scheduledEvents.values()]
        .filter((e) => !e.processed && e.requiresAttention && (e.ownerClubId === clubId || e.borrowerClubId === clubId) && LD().compare(e.dueDate, iso) <= 0)
        .sort((a, b) => {
          const cmp = LD().compare(a.dueDate, b.dueDate);
          return cmp !== 0 ? cmp : (a.id < b.id ? -1 : 1);
        });
      return list[0] || null;
    }

    allScheduledEvents() { return byId([...this._scheduledEvents.values()]); }

    // --- Integridad --------------------------------------------------------
    // Cruza con Player/Team/Contract/Registration/Transfer registries —
    // NUNCA lanza por sí sola, devuelve todo lo que no cuadra.
    validateIntegrity(options) {
      const opts = options || {};
      const {
        playerRegistry, teams, contractRegistry, transferRegistry, date,
      } = opts;
      const errors = [];
      const warnings = [];
      const teamIds = new Set((teams || []).map((t) => t.id));

      this.allCases().forEach((loanCase) => {
        if (playerRegistry && !playerRegistry.has(loanCase.playerId)) {
          errors.push(`El expediente "${loanCase.id}" referencia al jugador "${loanCase.playerId}", ausente de PlayerRegistry.`);
        }
        if (teams && !teamIds.has(loanCase.ownerClubId)) errors.push(`El expediente "${loanCase.id}" referencia el club propietario "${loanCase.ownerClubId}", inexistente.`);
        if (teams && !teamIds.has(loanCase.borrowerClubId)) errors.push(`El expediente "${loanCase.id}" referencia el club cesionario "${loanCase.borrowerClubId}", inexistente.`);
        if (contractRegistry && !contractRegistry.get(loanCase.masterContractId)) {
          errors.push(`El expediente "${loanCase.id}" referencia el contrato matriz "${loanCase.masterContractId}", inexistente.`);
        }
      });

      this.allAgreements().forEach((agreement) => {
        const masterContract = contractRegistry ? contractRegistry.get(agreement.masterContractId) : null;
        if (contractRegistry && !masterContract) {
          errors.push(`El acuerdo "${agreement.id}" referencia el contrato matriz "${agreement.masterContractId}", inexistente.`);
        } else if (masterContract && masterContract.clubId !== agreement.ownerClubId) {
          errors.push(`El acuerdo "${agreement.id}" declara propietario "${agreement.ownerClubId}" pero el contrato matriz "${agreement.masterContractId}" pertenece a "${masterContract.clubId}".`);
        }
        if (masterContract) {
          if (LD().isBefore(agreement.serviceStartDate, masterContract.startDate) || LD().isAfter(agreement.returnEffectiveDate, LD().addDays(masterContract.endDate, 1))) {
            errors.push(`El acuerdo "${agreement.id}" tiene fechas fuera de la vigencia del contrato matriz "${agreement.masterContractId}" (${masterContract.startDate}..${masterContract.endDate}).`);
          }
        }
        if (transferRegistry) {
          if (agreement.outboundTransactionId && !transferRegistry.getTransactionRecord(agreement.outboundTransactionId)) {
            errors.push(`El acuerdo "${agreement.id}" referencia la salida "${agreement.outboundTransactionId}", inexistente en TransferRegistry.`);
          }
          if (agreement.returnTransactionId && !transferRegistry.getTransactionRecord(agreement.returnTransactionId)) {
            errors.push(`El acuerdo "${agreement.id}" referencia el retorno "${agreement.returnTransactionId}", inexistente en TransferRegistry.`);
          }
          agreement.obligationIds.forEach((obligationId) => {
            if (!transferRegistry.getObligation(obligationId)) {
              errors.push(`El acuerdo "${agreement.id}" referencia la obligación "${obligationId}", inexistente en TransferRegistry.`);
            }
          });
        }
      });

      // Invariante 8: máximo una cesión activa por jugador (nunca dos
      // intervalos activos solapados) — reutiliza `activeAgreementForPlayer`,
      // que ya lanza si detecta más de una; se captura aquí como error de
      // informe en vez de excepción para no abortar el resto del reporte.
      if (playerRegistry && date) {
        playerRegistry.all().forEach((player) => {
          try {
            this.activeAgreementForPlayer(player.id, date);
          } catch (err) {
            errors.push(err.message);
          }
        });
      }

      errors.push(...auditIndexSymmetry('_casesByPlayer', this._casesByPlayer, this._cases));
      errors.push(...auditIndexSymmetry('_casesByOwner', this._casesByOwner, this._cases));
      errors.push(...auditIndexSymmetry('_casesByBorrower', this._casesByBorrower, this._cases));
      errors.push(...auditIndexSymmetry('_proposalsByCase', this._proposalsByCase, this._proposals));
      errors.push(...auditIndexSymmetry('_consentsByCase', this._consentsByCase, this._consents));
      errors.push(...auditIndexSymmetry('_agreementsByPlayer', this._agreementsByPlayer, this._agreements));
      errors.push(...auditIndexSymmetry('_agreementsByOwner', this._agreementsByOwner, this._agreements));
      errors.push(...auditIndexSymmetry('_agreementsByBorrower', this._agreementsByBorrower, this._agreements));
      errors.push(...auditIndexSymmetry('_optionExercisesByAgreement', this._optionExercisesByAgreement, this._optionExercises));

      return { valid: errors.length === 0, errors, warnings };
    }

    snapshot() {
      return {
        cases: this.allCases().map((c) => c.toJSON()),
        proposals: [...this._proposals.values()].map((p) => p.toJSON()),
        consents: [...this._consents.values()].map((c) => c.toJSON()),
        agreements: this.allAgreements().map((a) => a.toJSON()),
        optionExercises: [...this._optionExercises.values()].map((e) => e.toJSON()),
        scheduledEvents: this.allScheduledEvents(),
      };
    }
  }

  const exportsObj = { LoanRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
