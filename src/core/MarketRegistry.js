// src/core/MarketRegistry.js
// MARKET-1 (DESIGN.md 9.19, sección 9.2 del prompt) — Registro CANÓNICO de
// mercado: seguimiento, hilos/ofertas/acuerdos, casos de derechos
// preferentes, reservas de presupuesto y eventos programados. Instancia
// EXPLÍCITA por carrera (`state.marketRegistry`), NUNCA un singleton.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// No existe ningún array paralelo en UI/Team/Player — todo lo que puede
// consultarse sobre mercado pasa por aquí.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MarketEventTypesModule = isNode ? require('../core/MarketEventTypes.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function Events() { return MarketEventTypesModule.MarketEventTypes; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function byId(list) { return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)); }

  class MarketRegistry {
    constructor() {
      this._watchlist = new Map(); // clubId -> Set(playerId)
      this._threads = new Map();
      this._threadsByPlayer = new Map();
      this._threadsByClub = new Map();
      this._offers = new Map();
      this._offersByThread = new Map(); // threadId -> [offerId] (orden de inserción == orden de versión)
      this._agreements = new Map();
      this._agreementsByPlayer = new Map();
      this._rightsCases = new Map();
      this._rightsCasesByPlayer = new Map();
      this._rightsCasesByClub = new Map();
      this._returnRightsCases = new Map();
      this._debtChallenges = new Map();
      this._debtChallengesByCase = new Map();
      this._compensationClaims = new Map();
      this._budgetReservations = new Map(); // id -> { clubId, seasonKey, amountMinor, currency, sourceType, sourceId, status }
      this._scheduledEvents = new Map(); // id -> { id, type, dueDate, clubId, playerId, threadId, requiresAttention, processed, payload }
    }

    // --- Seguimiento (sección 16.3) — idempotente ------------------------
    addWatch(clubId, playerId) {
      const set = this._watchlist.get(clubId) || new Set();
      set.add(playerId);
      this._watchlist.set(clubId, set);
      return this;
    }

    removeWatch(clubId, playerId) {
      const set = this._watchlist.get(clubId);
      if (set) set.delete(playerId);
      return this;
    }

    isWatched(clubId, playerId) {
      const set = this._watchlist.get(clubId);
      return Boolean(set && set.has(playerId));
    }

    watchlistForClub(clubId) {
      return [...(this._watchlist.get(clubId) || new Set())].sort();
    }

    // --- Hilos -----------------------------------------------------------
    registerThread(thread) {
      const existing = this._threads.get(thread.id);
      if (existing && existing !== thread) throw new Error(`MarketRegistry: ya existe un NegotiationThread distinto con id "${thread.id}".`);
      this._threads.set(thread.id, thread);
      const byPlayer = this._threadsByPlayer.get(thread.playerId) || [];
      if (!byPlayer.includes(thread.id)) byPlayer.push(thread.id);
      this._threadsByPlayer.set(thread.playerId, byPlayer);
      const byClub = this._threadsByClub.get(thread.actingClubId) || [];
      if (!byClub.includes(thread.id)) byClub.push(thread.id);
      this._threadsByClub.set(thread.actingClubId, byClub);
      return thread;
    }

    getThread(id) { return this._threads.get(id) || null; }

    requireThread(id) {
      const thread = this.getThread(id);
      if (!thread) throw new Error(`MarketRegistry: no existe el NegotiationThread "${id}".`);
      return thread;
    }

    threadsForPlayer(playerId) {
      return byId((this._threadsByPlayer.get(playerId) || []).map((id) => this._threads.get(id)));
    }

    threadsForClub(clubId) {
      return byId((this._threadsByClub.get(clubId) || []).map((id) => this._threads.get(id)));
    }

    allThreads() { return byId([...this._threads.values()]); }

    // --- Ofertas -----------------------------------------------------------
    registerOffer(offer) {
      const existing = this._offers.get(offer.id);
      if (existing && existing !== offer) throw new Error(`MarketRegistry: ya existe un ContractOffer distinto con id "${offer.id}".`);
      this._offers.set(offer.id, offer);
      const byThread = this._offersByThread.get(offer.threadId) || [];
      if (!byThread.includes(offer.id)) byThread.push(offer.id);
      this._offersByThread.set(offer.threadId, byThread);
      return offer;
    }

    getOffer(id) { return this._offers.get(id) || null; }

    requireOffer(id) {
      const offer = this.getOffer(id);
      if (!offer) throw new Error(`MarketRegistry: no existe el ContractOffer "${id}".`);
      return offer;
    }

    // Ordenada por versión — NUNCA por orden de inserción del Map (una
    // reconstrucción/replay debe dar el mismo orden siempre).
    offersForThread(threadId) {
      return (this._offersByThread.get(threadId) || [])
        .map((id) => this._offers.get(id))
        .sort((a, b) => a.version - b.version);
    }

    // La única versión VIVA (estado 'sent') de un hilo en una fecha — nunca
    // más de una a la vez (invariante 7: "solo una oferta viva/reserva
    // relevante por hilo").
    liveOfferForThread(threadId, date) {
      const iso = toIso(date);
      const live = this.offersForThread(threadId).filter((o) => o.isLiveOn(iso));
      if (live.length > 1) {
        throw new Error(`MarketRegistry: el hilo "${threadId}" tiene más de una oferta viva a la vez a ${iso} — invariante rota.`);
      }
      return live[0] || null;
    }

    // --- Acuerdos en principio --------------------------------------------
    registerAgreement(agreement) {
      const existing = this._agreements.get(agreement.id);
      if (existing && existing !== agreement) throw new Error(`MarketRegistry: ya existe un AgreementInPrinciple distinto con id "${agreement.id}".`);
      this._agreements.set(agreement.id, agreement);
      const byPlayer = this._agreementsByPlayer.get(agreement.playerId) || [];
      if (!byPlayer.includes(agreement.id)) byPlayer.push(agreement.id);
      this._agreementsByPlayer.set(agreement.playerId, byPlayer);
      return agreement;
    }

    getAgreement(id) { return this._agreements.get(id) || null; }

    agreementsForPlayer(playerId) {
      return byId((this._agreementsByPlayer.get(playerId) || []).map((id) => this._agreements.get(id)));
    }

    allAgreements() { return byId([...this._agreements.values()]); }

    // Invariante 8: "no hay dos acuerdos incompatibles vivos para el mismo
    // jugador" — un acuerdo se considera VIVO si aún no expiró
    // (`validUntil`) en la fecha dada; MARKET-1 no anula acuerdos, así que
    // dos acuerdos simultáneos sin expirar SIEMPRE es un conflicto.
    hasLiveAgreementForPlayer(playerId, date, excludeAgreementId) {
      const iso = toIso(date);
      return this.agreementsForPlayer(playerId).some((a) => {
        if (a.id === excludeAgreementId) return false;
        return !a.validUntil || !LD().isAfter(iso, a.validUntil);
      });
    }

    // --- Casos de derecho preferente (procedimiento general/preferente) --
    registerRightsCase(rightsCase) {
      const existing = this._rightsCases.get(rightsCase.id);
      if (existing && existing !== rightsCase) throw new Error(`MarketRegistry: ya existe un RightOfFirstRefusalCase distinto con id "${rightsCase.id}".`);
      this._rightsCases.set(rightsCase.id, rightsCase);
      const byPlayer = this._rightsCasesByPlayer.get(rightsCase.playerId) || [];
      if (!byPlayer.includes(rightsCase.id)) byPlayer.push(rightsCase.id);
      this._rightsCasesByPlayer.set(rightsCase.playerId, byPlayer);
      const byClub = this._rightsCasesByClub.get(rightsCase.originClubId) || [];
      if (!byClub.includes(rightsCase.id)) byClub.push(rightsCase.id);
      this._rightsCasesByClub.set(rightsCase.originClubId, byClub);
      return rightsCase;
    }

    getRightsCase(id) { return this._rightsCases.get(id) || null; }

    rightsCasesForPlayer(playerId) {
      return byId((this._rightsCasesByPlayer.get(playerId) || []).map((id) => this._rightsCases.get(id)));
    }

    rightsCasesForClub(clubId) {
      return byId((this._rightsCasesByClub.get(clubId) || []).map((id) => this._rightsCases.get(id)));
    }

    allRightsCases() { return byId([...this._rightsCases.values()]); }

    // --- Casos de retorno (art. 17) ---------------------------------------
    registerReturnRightsCase(rrCase) {
      const existing = this._returnRightsCases.get(rrCase.id);
      if (existing && existing !== rrCase) throw new Error(`MarketRegistry: ya existe un ReturnRightsCase distinto con id "${rrCase.id}".`);
      this._returnRightsCases.set(rrCase.id, rrCase);
      return rrCase;
    }

    getReturnRightsCase(id) { return this._returnRightsCases.get(id) || null; }

    allReturnRightsCases() { return byId([...this._returnRightsCases.values()]); }

    // --- Desafíos de deuda (art. 13.2) ------------------------------------
    registerDebtChallenge(challenge) {
      const existing = this._debtChallenges.get(challenge.id);
      if (existing && existing !== challenge) throw new Error(`MarketRegistry: ya existe un DebtChallenge distinto con id "${challenge.id}".`);
      this._debtChallenges.set(challenge.id, challenge);
      const byCase = this._debtChallengesByCase.get(challenge.rightsCaseId) || [];
      if (!byCase.includes(challenge.id)) byCase.push(challenge.id);
      this._debtChallengesByCase.set(challenge.rightsCaseId, byCase);
      return challenge;
    }

    getDebtChallenge(id) { return this._debtChallenges.get(id) || null; }

    debtChallengesForCase(rightsCaseId) {
      return byId((this._debtChallengesByCase.get(rightsCaseId) || []).map((id) => this._debtChallenges.get(id)));
    }

    // --- Reclamaciones de compensación potencial (art. 16) ----------------
    registerCompensationClaim(claim) {
      const existing = this._compensationClaims.get(claim.id);
      if (existing && existing !== claim) throw new Error(`MarketRegistry: ya existe un PotentialCompensationClaim distinto con id "${claim.id}".`);
      this._compensationClaims.set(claim.id, claim);
      return claim;
    }

    getCompensationClaim(id) { return this._compensationClaims.get(id) || null; }

    allCompensationClaims() { return byId([...this._compensationClaims.values()]); }

    // --- Reservas de presupuesto (sección 11) -----------------------------
    reserveBudget(reservation) {
      if (!reservation || !reservation.id) throw new Error('MarketRegistry.reserveBudget: falta "id".');
      if (this._budgetReservations.has(reservation.id)) {
        // Idempotente: reservar dos veces el MISMO id no duplica.
        return this._budgetReservations.get(reservation.id);
      }
      const record = { ...reservation, status: 'active' };
      this._budgetReservations.set(reservation.id, record);
      return record;
    }

    // Idempotente: liberar una reserva ya liberada (o inexistente) no
    // lanza ni la libera dos veces (sección 12.4: "una expiración libera
    // reserva... un render/avance repetido no procesa dos veces").
    releaseBudget(id) {
      const record = this._budgetReservations.get(id);
      if (!record || record.status === 'released') return false;
      record.status = 'released';
      return true;
    }

    getBudgetReservation(id) { return this._budgetReservations.get(id) || null; }

    // Total RESERVADO (no comprometido por contrato, eso es
    // ContractService/ContractRegistry) para un club+temporada — solo
    // reservas `active`.
    reservedTotalForClubSeason(clubId, seasonKey) {
      let total = 0;
      this._budgetReservations.forEach((r) => {
        if (r.status === 'active' && r.clubId === clubId && r.seasonKey === seasonKey) total += r.amountMinor;
      });
      return total;
    }

    allBudgetReservations() { return byId([...this._budgetReservations.values()]); }

    // --- Eventos programados (sección 15.3) -------------------------------
    scheduleEvent(event) {
      if (!event || !event.id) throw new Error('MarketRegistry.scheduleEvent: falta "id".');
      if (this._scheduledEvents.has(event.id)) {
        // Idempotente: no duplica el mismo evento programado dos veces.
        return this._scheduledEvents.get(event.id);
      }
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

    // Eventos NO procesados con `dueDate <= date` — orden estable por
    // fecha y luego id.
    eventsDueThrough(date) {
      const iso = toIso(date);
      return [...this._scheduledEvents.values()]
        .filter((e) => !e.processed && LD().compare(e.dueDate, iso) <= 0)
        .sort((a, b) => {
          const cmp = LD().compare(a.dueDate, b.dueDate);
          return cmp !== 0 ? cmp : (a.id < b.id ? -1 : 1);
        });
    }

    // Próximo evento programado (procesado o no) de un club, orden estable.
    nextScheduledEvent(clubId) {
      const list = [...this._scheduledEvents.values()]
        .filter((e) => !e.processed && (!clubId || e.clubId === clubId))
        .sort((a, b) => {
          const cmp = LD().compare(a.dueDate, b.dueDate);
          return cmp !== 0 ? cmp : (a.id < b.id ? -1 : 1);
        });
      return list[0] || null;
    }

    // Primer evento que EXIGE decisión del usuario para ese club, en/antes
    // de la fecha objetivo — sección 15.4: la orquestación de reloj
    // consulta esto ANTES de resolver cualquier partido/lote.
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
    validateIntegrity(options) {
      const opts = options || {};
      const { playerRegistry, teams, date } = opts;
      const errors = [];
      const warnings = [];
      const teamIds = new Set((teams || []).map((t) => t.id));

      this.allThreads().forEach((thread) => {
        if (playerRegistry && !playerRegistry.has(thread.playerId)) {
          errors.push(`El hilo "${thread.id}" referencia al jugador "${thread.playerId}", ausente de PlayerRegistry.`);
        }
        if (teams && !teamIds.has(thread.actingClubId)) {
          errors.push(`El hilo "${thread.id}" referencia al club "${thread.actingClubId}", ausente de los equipos vivos.`);
        }
        thread.offerIds.forEach((offerId) => {
          if (!this._offers.has(offerId)) {
            errors.push(`El hilo "${thread.id}" referencia la oferta "${offerId}", inexistente.`);
          }
        });
        if (thread.agreementId && !this._agreements.has(thread.agreementId)) {
          errors.push(`El hilo "${thread.id}" referencia el acuerdo "${thread.agreementId}", inexistente.`);
        }
      });

      this.allAgreements().forEach((agreement) => {
        if (!this._offers.has(agreement.acceptedOfferId)) {
          errors.push(`El acuerdo "${agreement.id}" referencia la oferta "${agreement.acceptedOfferId}", inexistente.`);
        }
        if (!this._budgetReservations.has(agreement.budgetReservationId)) {
          errors.push(`El acuerdo "${agreement.id}" referencia la reserva "${agreement.budgetReservationId}", inexistente.`);
        }
        if (date) {
          const dup = this.agreementsForPlayer(agreement.playerId).filter((a) => {
            if (a.id === agreement.id) return false;
            return !a.validUntil || !LD().isAfter(toIso(date), a.validUntil);
          });
          if (dup.length) {
            errors.push(`El jugador "${agreement.playerId}" tiene más de un AgreementInPrinciple vivo a la vez (invariante 8).`);
          }
        }
      });

      return { valid: errors.length === 0, errors, warnings };
    }

    snapshot() {
      return {
        threads: this._threads.size,
        offers: this._offers.size,
        agreements: this._agreements.size,
        rightsCases: this._rightsCases.size,
        returnRightsCases: this._returnRightsCases.size,
        debtChallenges: this._debtChallenges.size,
        compensationClaims: this._compensationClaims.size,
        budgetReservations: this._budgetReservations.size,
        scheduledEvents: this._scheduledEvents.size,
      };
    }
  }

  const exportsObj = { MarketRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
