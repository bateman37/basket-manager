// src/core/TransferRegistry.js
// TRANSFER-1 (DESIGN.md 9.20, sección 10.1 del prompt) — Registro CANÓNICO
// de transferencias de la partida. Instancia EXPLÍCITA por carrera
// (`state.transferRegistry`), NUNCA un singleton — mismo criterio que
// PlayerRegistry/ContractRegistry/RegistrationRegistry/MarketRegistry.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
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

  function byId(list) { return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)); }

  class TransferRegistry {
    constructor() {
      this._cases = new Map();
      this._casesByPlayer = new Map();
      this._casesByClub = new Map(); // clubId -> [caseId] (origen o destino)
      this._clubOffers = new Map();
      this._clubOffersByCase = new Map();
      this._transferAgreements = new Map();
      this._releaseClauseExercises = new Map();
      this._terminationRecords = new Map();
      this._obligations = new Map();
      this._obligationsByTransaction = new Map();
      this._transactionRecords = new Map();
      this._transactionRecordsByPlayer = new Map();
      this._scheduledEvents = new Map();
      // Idempotencia (sección 13.5 del prompt): transactionId -> resultado
      // ya completado — un segundo commit con el MISMO id devuelve lo mismo.
      this._completedByTransactionId = new Map();
    }

    // --- Casos ---------------------------------------------------------
    registerCase(transferCase) {
      const existing = this._cases.get(transferCase.id);
      if (existing && existing !== transferCase) throw new Error(`TransferRegistry: ya existe un TransferCase distinto con id "${transferCase.id}".`);
      this._cases.set(transferCase.id, transferCase);
      pushIndex(this._casesByPlayer, transferCase.playerId, transferCase.id);
      pushIndex(this._casesByClub, transferCase.originClubId, transferCase.id);
      pushIndex(this._casesByClub, transferCase.destinationClubId, transferCase.id);
      return transferCase;
    }

    getCase(id) { return this._cases.get(id) || null; }

    requireCase(id) {
      const found = this.getCase(id);
      if (!found) throw new Error(`TransferRegistry: no existe el TransferCase "${id}".`);
      return found;
    }

    casesForPlayer(playerId) { return byId((this._casesByPlayer.get(playerId) || []).map((id) => this._cases.get(id))); }

    casesForClub(clubId) { return byId((this._casesByClub.get(clubId) || []).map((id) => this._cases.get(id))); }

    allCases() { return byId([...this._cases.values()]); }

    // Casos VIVOS (no terminales) de un jugador — invariante equivalente a
    // "un AIP vivo bloquea el mercado" (MARKET-1) pero para expedientes.
    liveCasesForPlayer(playerId, date) {
      return this.casesForPlayer(playerId).filter((c) => !c.isTerminal(date));
    }

    // --- Ofertas club-club -----------------------------------------------
    registerClubOffer(offer) {
      const existing = this._clubOffers.get(offer.id);
      if (existing && existing !== offer) throw new Error(`TransferRegistry: ya existe un ClubTransferOffer distinto con id "${offer.id}".`);
      this._clubOffers.set(offer.id, offer);
      pushIndex(this._clubOffersByCase, offer.transferCaseId, offer.id);
      return offer;
    }

    // BUG-TRANSFER1-14 (DESIGN.md 9.21): reversión SIMÉTRICA — primario +
    // `_clubOffersByCase` juntos, nunca por separado desde fuera.
    unregisterClubOffer(id) {
      const offer = this._clubOffers.get(id);
      if (!offer) return false;
      this._clubOffers.delete(id);
      const byCase = this._clubOffersByCase.get(offer.transferCaseId) || [];
      this._clubOffersByCase.set(offer.transferCaseId, byCase.filter((x) => x !== id));
      return true;
    }

    getClubOffer(id) { return this._clubOffers.get(id) || null; }

    requireClubOffer(id) {
      const found = this.getClubOffer(id);
      if (!found) throw new Error(`TransferRegistry: no existe el ClubTransferOffer "${id}".`);
      return found;
    }

    clubOffersForCase(caseId) {
      return (this._clubOffersByCase.get(caseId) || []).map((id) => this._clubOffers.get(id)).sort((a, b) => a.version - b.version);
    }

    // La única versión VIVA ('sent') de un expediente en una fecha —
    // invariante 7 (mismo criterio que MarketRegistry.liveOfferForThread).
    liveClubOfferForCase(caseId, date) {
      const iso = toIso(date);
      const live = this.clubOffersForCase(caseId).filter((o) => o.isLiveOn(iso));
      if (live.length > 1) {
        throw new Error(`TransferRegistry: el expediente "${caseId}" tiene más de una oferta club-club viva a la vez a ${iso} — invariante rota.`);
      }
      return live[0] || null;
    }

    // --- Acuerdos entre clubes -------------------------------------------
    registerTransferAgreement(agreement) {
      const existing = this._transferAgreements.get(agreement.id);
      if (existing && existing !== agreement) throw new Error(`TransferRegistry: ya existe un TransferAgreement distinto con id "${agreement.id}".`);
      this._transferAgreements.set(agreement.id, agreement);
      return agreement;
    }

    getTransferAgreement(id) { return this._transferAgreements.get(id) || null; }

    allTransferAgreements() { return byId([...this._transferAgreements.values()]); }

    // --- Ejercicios de cláusula -------------------------------------------
    registerReleaseClauseExercise(exercise) {
      const existing = this._releaseClauseExercises.get(exercise.id);
      if (existing && existing !== exercise) throw new Error(`TransferRegistry: ya existe un ReleaseClauseExercise distinto con id "${exercise.id}".`);
      this._releaseClauseExercises.set(exercise.id, exercise);
      return exercise;
    }

    getReleaseClauseExercise(id) { return this._releaseClauseExercises.get(id) || null; }

    allReleaseClauseExercises() { return byId([...this._releaseClauseExercises.values()]); }

    // --- Terminaciones -----------------------------------------------------
    registerTerminationRecord(record) {
      const existing = this._terminationRecords.get(record.id);
      if (existing && existing !== record) throw new Error(`TransferRegistry: ya existe un ContractTerminationRecord distinto con id "${record.id}".`);
      this._terminationRecords.set(record.id, record);
      return record;
    }

    // BUG-TRANSFER1-14 (DESIGN.md 9.21): reversión — sin índice secundario
    // propio, pero centraliza el borrado para que ningún servicio toque
    // `_terminationRecords` directamente.
    unregisterTerminationRecord(id) { return this._terminationRecords.delete(id); }

    getTerminationRecord(id) { return this._terminationRecords.get(id) || null; }

    allTerminationRecords() { return byId([...this._terminationRecords.values()]); }

    // --- Obligaciones económicas -------------------------------------------
    registerObligation(obligation) {
      const existing = this._obligations.get(obligation.id);
      if (existing && existing !== obligation) throw new Error(`TransferRegistry: ya existe una FinancialObligation distinta con id "${obligation.id}".`);
      this._obligations.set(obligation.id, obligation);
      pushIndex(this._obligationsByTransaction, obligation.transactionId, obligation.id);
      return obligation;
    }

    // BUG-TRANSFER1-14 (DESIGN.md 9.21): reversión SIMÉTRICA — primario +
    // `_obligationsByTransaction` juntos, nunca por separado desde fuera.
    unregisterObligation(id) {
      const obligation = this._obligations.get(id);
      if (!obligation) return false;
      this._obligations.delete(id);
      const byTx = this._obligationsByTransaction.get(obligation.transactionId) || [];
      this._obligationsByTransaction.set(obligation.transactionId, byTx.filter((x) => x !== id));
      return true;
    }

    getObligation(id) { return this._obligations.get(id) || null; }

    obligationsForTransaction(transactionId) {
      return (this._obligationsByTransaction.get(transactionId) || []).map((id) => this._obligations.get(id));
    }

    allObligations() { return byId([...this._obligations.values()]); }

    // --- Transacciones completadas (recibo canónico) -----------------------
    // Idempotente por `id` (invariante 18): la primera instancia gana,
    // nunca se sobrescribe.
    registerTransactionRecord(record) {
      const existing = this._transactionRecords.get(record.id);
      if (existing) return existing;
      this._transactionRecords.set(record.id, record);
      pushIndex(this._transactionRecordsByPlayer, record.playerId, record.id);
      this._completedByTransactionId.set(record.id, record);
      return record;
    }

    // BUG-TRANSFER1-13/14 (DESIGN.md 9.21): reversión SIMÉTRICA — primario,
    // `_transactionRecordsByPlayer` Y el índice de idempotencia
    // (`_completedByTransactionId`) juntos. Antes, un fallo DESPUÉS de
    // registrar el recibo (p.ej. al refrescar la proyección salarial) no
    // tenía undo — el recibo quedaba completado y el índice de
    // idempotencia ocupado aunque el resto del mundo se revirtiera.
    unregisterTransactionRecord(id) {
      const record = this._transactionRecords.get(id);
      if (!record) return false;
      this._transactionRecords.delete(id);
      const byPlayer = this._transactionRecordsByPlayer.get(record.playerId) || [];
      this._transactionRecordsByPlayer.set(record.playerId, byPlayer.filter((x) => x !== id));
      this._completedByTransactionId.delete(id);
      return true;
    }

    getTransactionRecord(id) { return this._transactionRecords.get(id) || null; }

    transactionRecordsForPlayer(playerId) {
      return byId((this._transactionRecordsByPlayer.get(playerId) || []).map((id) => this._transactionRecords.get(id)));
    }

    allTransactionRecords() { return byId([...this._transactionRecords.values()]); }

    // Consulta de idempotencia — sección 13.5: repetir el mismo comando con
    // el mismo transactionId debe devolver el MISMO resultado.
    completedTransaction(transactionId) { return this._completedByTransactionId.get(transactionId) || null; }

    // --- Eventos programados (fechas futuras/plazos) ------------------------
    scheduleEvent(event) {
      if (!event || !event.id) throw new Error('TransferRegistry.scheduleEvent: falta "id".');
      if (this._scheduledEvents.has(event.id)) return this._scheduledEvents.get(event.id);
      const record = { requiresAttention: false, processed: false, ...event };
      this._scheduledEvents.set(event.id, record);
      return record;
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
        .filter((e) => !e.processed && e.requiresAttention && e.clubId === clubId && LD().compare(e.dueDate, iso) <= 0)
        .sort((a, b) => {
          const cmp = LD().compare(a.dueDate, b.dueDate);
          return cmp !== 0 ? cmp : (a.id < b.id ? -1 : 1);
        });
      return list[0] || null;
    }

    allScheduledEvents() { return byId([...this._scheduledEvents.values()]); }

    // --- Integridad --------------------------------------------------------
    // Cruza con Player/Team/Contract/Registration/Market/Agent registries —
    // NUNCA lanza por sí sola, devuelve todo lo que no cuadra.
    validateIntegrity(options) {
      const opts = options || {};
      const {
        playerRegistry, teams, contractRegistry, registrationRegistry, marketRegistry, loanRegistry, date,
      } = opts;
      const errors = [];
      const warnings = [];
      const teamIds = new Set((teams || []).map((t) => t.id));
      const iso = date ? toIso(date) : null;

      this.allCases().forEach((tCase) => {
        if (playerRegistry && !playerRegistry.has(tCase.playerId)) {
          errors.push(`El expediente "${tCase.id}" referencia al jugador "${tCase.playerId}", ausente de PlayerRegistry.`);
        }
        if (teams && tCase.destinationClubId && !teamIds.has(tCase.destinationClubId)) {
          errors.push(`El expediente "${tCase.id}" referencia el club de destino "${tCase.destinationClubId}", inexistente.`);
        }
        if (teams && tCase.originClubId && !teamIds.has(tCase.originClubId)) {
          errors.push(`El expediente "${tCase.id}" referencia el club de origen "${tCase.originClubId}", inexistente.`);
        }
        // `agreementInPrincipleId` empieza por "self:" cuando un mutuo
        // acuerdo/liberación pura no tiene AIP real (TransferService.js,
        // formalizeMutualAgreement sin `agreement`) — marcador propio
        // exigido por `TransferCase` como campo obligatorio, NUNCA un id
        // real de MarketRegistry, así que no se busca ahí.
        const hasSyntheticSelfMarker = typeof tCase.agreementInPrincipleId === 'string' && tCase.agreementInPrincipleId.startsWith('self:');
        if (marketRegistry && tCase.agreementInPrincipleId && !hasSyntheticSelfMarker && !marketRegistry.getAgreement(tCase.agreementInPrincipleId)) {
          errors.push(`El expediente "${tCase.id}" referencia el AIP "${tCase.agreementInPrincipleId}", inexistente en MarketRegistry.`);
        }
        if (tCase.clubOfferId && !this._clubOffers.has(tCase.clubOfferId)) {
          errors.push(`El expediente "${tCase.id}" referencia la oferta club-club "${tCase.clubOfferId}", inexistente.`);
        }
        if (tCase.transferAgreementId && !this._transferAgreements.has(tCase.transferAgreementId)) {
          errors.push(`El expediente "${tCase.id}" referencia el acuerdo "${tCase.transferAgreementId}", inexistente.`);
        }
        if (tCase.transactionId && !this._transactionRecords.has(tCase.transactionId)) {
          errors.push(`El expediente "${tCase.id}" declara transactionId "${tCase.transactionId}" pero no hay TransactionRecord registrado.`);
        }
        tCase.obligationIds.forEach((obligationId) => {
          if (!this._obligations.has(obligationId)) {
            errors.push(`El expediente "${tCase.id}" referencia la obligación "${obligationId}", inexistente.`);
          }
        });
      });

      this.allTransactionRecords().forEach((record) => {
        if (playerRegistry && !playerRegistry.has(record.playerId)) {
          errors.push(`El TransactionRecord "${record.id}" referencia al jugador "${record.playerId}", ausente de PlayerRegistry.`);
        }
        if (contractRegistry && record.newContractId && !contractRegistry.get(record.newContractId)) {
          errors.push(`El TransactionRecord "${record.id}" referencia el contrato nuevo "${record.newContractId}", inexistente.`);
        }
        if (registrationRegistry && record.createdRegistrationId && !registrationRegistry.getRegistration(record.createdRegistrationId)) {
          errors.push(`El TransactionRecord "${record.id}" referencia la inscripción creada "${record.createdRegistrationId}", inexistente.`);
        }
        record.obligationIds.forEach((obligationId) => {
          if (!this._obligations.has(obligationId)) {
            errors.push(`El TransactionRecord "${record.id}" referencia la obligación "${obligationId}", inexistente.`);
          }
        });
      });

      // BUG-TRANSFER1-19 (DESIGN.md 9.21): cadena histórica de movimientos —
      // orden estable explícito (fecha efectiva, luego `completedAt`, luego
      // id, NUNCA orden de inserción del Map) y comprobación de continuidad
      // (el destino de un movimiento debe coincidir con el origen del
      // siguiente del MISMO jugador). Solo el ÚLTIMO movimiento efectivo —
      // el que ningún otro sucede — se contrasta con `player.teamId`: un
      // recibo histórico correcto no deja de serlo porque el jugador se
      // haya movido de nuevo después (antes, CADA recibo se comparaba con
      // el presente, así que el primer recibo de un segundo movimiento
      // "corrompía" retroactivamente al primero). Una liberación
      // (`mutual-release`, sin destino) termina legítimamente en `null`.
      const stableTransactionOrder = (a, b) => {
        const cmp = LD().compare(a.effectiveDate, b.effectiveDate);
        if (cmp !== 0) return cmp;
        const completedCmp = LD().compare(a.completedAt, b.completedAt);
        if (completedCmp !== 0) return completedCmp;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      };
      const byPlayer = new Map();
      this.allTransactionRecords().forEach((r) => {
        const list = byPlayer.get(r.playerId) || [];
        list.push(r);
        byPlayer.set(r.playerId, list);
      });
      byPlayer.forEach((records, playerId) => {
        const sorted = [...records].sort(stableTransactionOrder);
        for (let i = 1; i < sorted.length; i += 1) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          if (prev.effectiveDate === curr.effectiveDate && prev.destinationClubId !== curr.destinationClubId) {
            warnings.push(`El jugador "${playerId}" tiene dos TransactionRecords con la MISMA fecha efectiva y destinos distintos — revisar orden real.`);
          }
          const prevDestination = prev.mechanism === 'mutual-release' ? null : prev.destinationClubId;
          if (curr.originClubId && prevDestination && curr.originClubId !== prevDestination) {
            errors.push(
              `El jugador "${playerId}" tiene una cadena de movimientos incoherente: "${prev.id}" termina en `
              + `"${prevDestination}" pero "${curr.id}" declara origen "${curr.originClubId}".`,
            );
          }
        }
        const last = sorted[sorted.length - 1];
        if (playerRegistry && last) {
          const player = playerRegistry.get(last.playerId);
          if (player) {
            const expectedTeamId = last.mechanism === 'mutual-release' ? null : last.destinationClubId;
            // Un jugador puede estar cedido (LOAN-1: club de servicio
            // distinto del propietario contractual) sin que ningún
            // TransactionRecord de ESTE registro lo refleje — LoanRegistry
            // es quien valida `player.teamId` durante una cesión activa.
            const explainedByActiveLoan = Boolean(
              loanRegistry && typeof loanRegistry.hasActiveLoanForPlayer === 'function'
              && loanRegistry.hasActiveLoanForPlayer(playerId, iso || last.effectiveDate),
            );
            if (!explainedByActiveLoan && player.teamId !== expectedTeamId) {
              errors.push(
                `El TransactionRecord "${last.id}" (el más reciente de "${playerId}") completó un movimiento a `
                + `"${expectedTeamId}" pero player.teamId es "${player.teamId}".`,
              );
            }
          }
        }
      });

      // BUG-TRANSFER1-14 (DESIGN.md 9.21): índices secundarios simétricos.
      errors.push(...RegistryIndexAuditModule.RegistryIndexAudit.auditIndexSymmetry('_casesByPlayer', this._casesByPlayer, this._cases));
      errors.push(...RegistryIndexAuditModule.RegistryIndexAudit.auditIndexSymmetry('_casesByClub', this._casesByClub, this._cases));
      errors.push(...RegistryIndexAuditModule.RegistryIndexAudit.auditIndexSymmetry('_clubOffersByCase', this._clubOffersByCase, this._clubOffers));
      errors.push(...RegistryIndexAuditModule.RegistryIndexAudit.auditIndexSymmetry('_obligationsByTransaction', this._obligationsByTransaction, this._obligations));
      errors.push(...RegistryIndexAuditModule.RegistryIndexAudit.auditIndexSymmetry('_transactionRecordsByPlayer', this._transactionRecordsByPlayer, this._transactionRecords));

      return { valid: errors.length === 0, errors, warnings };
    }

    snapshot() {
      return {
        cases: this._cases.size,
        clubOffers: this._clubOffers.size,
        transferAgreements: this._transferAgreements.size,
        releaseClauseExercises: this._releaseClauseExercises.size,
        terminationRecords: this._terminationRecords.size,
        obligations: this._obligations.size,
        transactionRecords: this._transactionRecords.size,
        scheduledEvents: this._scheduledEvents.size,
      };
    }
  }

  const exportsObj = { TransferRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
