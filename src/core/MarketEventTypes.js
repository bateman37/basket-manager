// src/core/MarketEventTypes.js
// MARKET-1 (DESIGN.md 9.19, sección 8.4/8.5 del prompt) — Uniones
// discriminadas de eventos de mercado, DOS máquinas de estados
// independientes que comparten el mismo motor genérico (mismo criterio que
// RegistrationEventTypes.js en REG-1: "las transiciones surgen de eventos
// validados y ordenados, nunca de mutaciones libres de un string"):
//
//  - `ThreadEvents`: ciclo de vida de la CONVERSACIÓN (NegotiationThread) —
//    consulta, permiso de contacto, respuesta de interés, acuerdo, cierre.
//  - `OfferEvents`: ciclo de vida de UNA versión de oferta (ContractOffer)
//    — enviada, contraofertada (superada por una versión nueva),
//    rechazada, retirada, expirada o aceptada. Cada ContractOffer tiene su
//    PROPIO ledger, nunca comparte estado con el hilo ni con otra versión.
//
// Módulo puro: no conoce Player/Team/Contract/DOM ni `state`.

(function (global) {
  const LocalDateModule = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/LocalDate.js')
    : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  // Combina fecha civil (obligatoria) + hora local opcional en una clave
  // ordenable — mismo criterio que RegistrationEventTypes.eventSortKey.
  function eventSortKey(event) {
    const date = LD().requireIsoDate(event.date, 'date');
    const time = event.time || '23:59:59';
    return `${date}T${time}`;
  }

  // Motor genérico de máquina de estados por eventos — usado por AMBAS
  // máquinas (Thread/Offer) para no duplicar validación/derivación.
  function makeEventMachine({ label, eventTypes, statusByEvent, allowedTransitions }) {
    function isKnownEventType(type) {
      return eventTypes.includes(type);
    }

    function deriveStatus(events, asOfDate) {
      const relevant = (events || [])
        .filter((e) => !asOfDate || LD().compare(e.date, asOfDate) <= 0)
        .sort((a, b) => (eventSortKey(a) < eventSortKey(b) ? -1 : 1));
      if (!relevant.length) return null;
      return statusByEvent[relevant[relevant.length - 1].type];
    }

    function validateEvent(event, priorEvents) {
      const errors = [];
      if (!event || typeof event !== 'object') {
        return { valid: false, errors: [`${label}: evento vacío o no es un objeto.`] };
      }
      if (!event.id) errors.push(`${label}: evento sin "id".`);
      if (!isKnownEventType(event.type)) {
        errors.push(`${label}: tipo de evento desconocido "${event.type}" — no se admite fuera de ${eventTypes.join(', ')}.`);
      }
      if (!event.date || !LocalDateModule.LocalDate.isValidIsoDate(event.date)) {
        errors.push(`${label}: evento "${event.id || '?'}" sin fecha civil ISO válida.`);
      }
      if (errors.length) return { valid: false, errors };

      const priors = priorEvents || [];
      if (priors.some((e) => e.id === event.id)) {
        errors.push(`${label}: ya existe un evento con id "${event.id}" — no se permiten IDs duplicados.`);
      }

      const sorted = [...priors].sort((a, b) => (eventSortKey(a) < eventSortKey(b) ? -1 : 1));
      const last = sorted[sorted.length - 1];
      if (last && eventSortKey(event) < eventSortKey(last)) {
        errors.push(
          `${label}: el evento "${event.id}" (${eventSortKey(event)}) es anterior al último evento registrado `
          + `"${last.id}" (${eventSortKey(last)}) — cronología incoherente.`,
        );
      }

      const currentStatus = deriveStatus(priors, null);
      const statusKey = currentStatus === null ? 'null' : currentStatus;
      const allowed = allowedTransitions[statusKey] || [];
      if (!allowed.includes(event.type)) {
        errors.push(
          `${label}: transición no permitida — no se puede aplicar "${event.type}" estando en estado `
          + `"${currentStatus === null ? '(sin eventos)' : currentStatus}" (permitidos: ${allowed.join(', ') || '(ninguno)'}).`,
        );
      }
      return { valid: errors.length === 0, errors };
    }

    return {
      EVENT_TYPES: eventTypes, STATUS_BY_EVENT: statusByEvent, ALLOWED_TRANSITIONS: allowedTransitions,
      isKnownEventType, eventSortKey, validateEvent, deriveStatus,
    };
  }

  // ---------------------------------------------------------------------
  // ThreadEvents — ciclo de vida del NegotiationThread (sección 8.4).
  //
  //   inquiry-opened
  //     -> contact-permission-requested (solo si una regla exige
  //        autorización previa del club actual, p.ej. overlay EuroLeague)
  //     -> player-side-contacted (contacto directo permitido)
  //   contact-permission-requested -> granted | denied | expired
  //   contact-permission-granted -> player-side-contacted
  //   contact-permission-denied -> thread-closed
  //   contact-permission-expired -> puede re-solicitarse o cerrar
  //   player-side-contacted -> interest-response-scheduled (respuesta
  //     diferida en el reloj de la partida, nunca inmediata)
  //   interest-response-scheduled -> interest-confirmed | interest-declined
  //   interest-declined -> thread-closed
  //   interest-confirmed -> el hilo queda "abierto a ofertas" — cada
  //     ContractOffer lleva su PROPIA máquina (OfferEvents); el hilo solo
  //     avanza de nuevo cuando una oferta es aceptada (agreement-created)
  //     o se decide cerrar sin acuerdo (thread-closed).
  // ---------------------------------------------------------------------
  const THREAD_EVENT_TYPES = [
    'inquiry-opened',
    'contact-permission-requested',
    'contact-permission-granted',
    'contact-permission-denied',
    'contact-permission-expired',
    'player-side-contacted',
    'interest-response-scheduled',
    'interest-confirmed',
    'interest-declined',
    'agreement-created',
    'thread-closed',
  ];
  const THREAD_STATUS_BY_EVENT = {
    'inquiry-opened': 'inquiry-opened',
    'contact-permission-requested': 'contact-permission-requested',
    'contact-permission-granted': 'contact-permission-granted',
    'contact-permission-denied': 'contact-permission-denied',
    'contact-permission-expired': 'contact-permission-expired',
    'player-side-contacted': 'player-side-contacted',
    'interest-response-scheduled': 'interest-response-scheduled',
    'interest-confirmed': 'interest-confirmed',
    'interest-declined': 'interest-declined',
    'agreement-created': 'agreement-created',
    'thread-closed': 'thread-closed',
  };
  const THREAD_ALLOWED_TRANSITIONS = {
    null: ['inquiry-opened'],
    'inquiry-opened': ['contact-permission-requested', 'player-side-contacted', 'thread-closed'],
    'contact-permission-requested': ['contact-permission-granted', 'contact-permission-denied', 'contact-permission-expired'],
    'contact-permission-granted': ['player-side-contacted'],
    'contact-permission-denied': ['thread-closed'],
    'contact-permission-expired': ['contact-permission-requested', 'thread-closed'],
    'player-side-contacted': ['interest-response-scheduled', 'thread-closed'],
    'interest-response-scheduled': ['interest-confirmed', 'interest-declined'],
    'interest-declined': ['thread-closed'],
    'interest-confirmed': ['agreement-created', 'thread-closed'],
    'agreement-created': ['thread-closed'],
    'thread-closed': [],
  };
  const ThreadEvents = makeEventMachine({
    label: 'NegotiationThread', eventTypes: THREAD_EVENT_TYPES, statusByEvent: THREAD_STATUS_BY_EVENT, allowedTransitions: THREAD_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // OfferEvents — ciclo de vida de UNA versión de oferta (sección 8.5).
  // Terminal siempre: una oferta nunca "revive" tras countered/rejected/
  // withdrawn/expired — una contraoferta crea una ContractOffer NUEVA con
  // su propio ledger (`parentOfferId` la enlaza a esta).
  // ---------------------------------------------------------------------
  const OFFER_EVENT_TYPES = ['offer-sent', 'offer-countered', 'offer-rejected', 'offer-withdrawn', 'offer-expired', 'player-accepted'];
  const OFFER_STATUS_BY_EVENT = {
    'offer-sent': 'sent',
    'offer-countered': 'countered',
    'offer-rejected': 'rejected',
    'offer-withdrawn': 'withdrawn',
    'offer-expired': 'expired',
    'player-accepted': 'accepted',
  };
  const OFFER_ALLOWED_TRANSITIONS = {
    null: ['offer-sent'],
    sent: ['offer-countered', 'offer-rejected', 'offer-withdrawn', 'offer-expired', 'player-accepted'],
    countered: [],
    rejected: [],
    withdrawn: [],
    expired: [],
    accepted: [],
  };
  const OfferEvents = makeEventMachine({
    label: 'ContractOffer', eventTypes: OFFER_EVENT_TYPES, statusByEvent: OFFER_STATUS_BY_EVENT, allowedTransitions: OFFER_ALLOWED_TRANSITIONS,
  });

  // Estados de oferta que siguen "vivos" (reservan presupuesto, sección
  // 11) — un estado ausente de aquí ya liberó su reserva.
  const OFFER_LIVE_STATUSES = new Set(['sent']);
  // `accepted` conserva la reserva por otra vía (AgreementInPrinciple),
  // nunca se cuenta dos veces junto a un `sent` de la misma versión.

  // ---------------------------------------------------------------------
  // RightsCaseEvents — máquina de estados del procedimiento GENERAL de
  // derecho de tanteo ACB (sección 13 del prompt de MARKET-1, arts. 13-14
  // del IV Convenio). `RightOfFirstRefusalService` es quien decide CUÁNDO
  // aplicar cada evento (plazos/condiciones); este módulo solo valida que
  // la transición sea estructuralmente posible.
  // ---------------------------------------------------------------------
  const RIGHTS_CASE_EVENT_TYPES = [
    'case-opened',
    'status-reporting-open',
    'status-reported',
    'eligible-list-published',
    'qualifying-offer-window-open',
    'qualifying-offer-filed',
    'qualifying-offer-lapsed',
    'right-invalidated',
    'third-party-offer-window-open',
    'offer-sheet-filed',
    'offer-sheet-forwarded',
    'matching-window-open',
    'origin-matched',
    'origin-waived',
    'matching-deadline-lapsed',
    'contract-deposit-pending',
    'procedure-resolved',
    'disputed',
  ];
  const RIGHTS_CASE_STATUS_BY_EVENT = Object.fromEntries(RIGHTS_CASE_EVENT_TYPES.map((t) => [t, t]));
  const RIGHTS_CASE_ALLOWED_TRANSITIONS = {
    null: ['case-opened'],
    'case-opened': ['status-reporting-open'],
    'status-reporting-open': ['status-reported'],
    'status-reported': ['eligible-list-published'],
    'eligible-list-published': ['qualifying-offer-window-open'],
    'qualifying-offer-window-open': ['qualifying-offer-filed', 'qualifying-offer-lapsed', 'right-invalidated'],
    'qualifying-offer-filed': ['third-party-offer-window-open'],
    'qualifying-offer-lapsed': ['procedure-resolved'],
    'right-invalidated': ['procedure-resolved'],
    'third-party-offer-window-open': ['offer-sheet-filed', 'procedure-resolved'],
    'offer-sheet-filed': ['offer-sheet-forwarded'],
    'offer-sheet-forwarded': ['matching-window-open'],
    'matching-window-open': ['origin-matched', 'origin-waived', 'matching-deadline-lapsed'],
    'origin-matched': ['contract-deposit-pending'],
    'origin-waived': ['contract-deposit-pending'],
    'matching-deadline-lapsed': ['contract-deposit-pending'],
    'contract-deposit-pending': ['procedure-resolved', 'disputed'],
    disputed: ['procedure-resolved'],
    'procedure-resolved': [],
  };
  const RightsCaseEvents = makeEventMachine({
    label: 'RightOfFirstRefusalCase',
    eventTypes: RIGHTS_CASE_EVENT_TYPES,
    statusByEvent: RIGHTS_CASE_STATUS_BY_EVENT,
    allowedTransitions: RIGHTS_CASE_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // AgreementEvents (BUG-MARKET1-06, TRANSFER-1 DESIGN.md 9.20) — ciclo de
  // vida EXPLÍCITO del AgreementInPrinciple. Antes `executionState` era una
  // constante fija `pending-transfer-1`, y `validUntil: null` lo trataba
  // como vivo para siempre. Ahora el estado se DERIVA de eventos, nunca se
  // sobrescribe sin historial, y todo estado terminal (completed/expired/
  // withdrawn/failed) dejar de bloquear el mercado para ese jugador.
  // ---------------------------------------------------------------------
  const AGREEMENT_EVENT_TYPES = [
    'agreement-created',
    'execution-scheduled',
    'execution-completed',
    'execution-failed',
    'agreement-expired',
    'agreement-withdrawn',
  ];
  const AGREEMENT_STATUS_BY_EVENT = {
    'agreement-created': 'pendingExecution',
    'execution-scheduled': 'scheduled',
    'execution-completed': 'completed',
    'execution-failed': 'failed',
    'agreement-expired': 'expired',
    'agreement-withdrawn': 'withdrawn',
  };
  const AGREEMENT_ALLOWED_TRANSITIONS = {
    null: ['agreement-created'],
    pendingExecution: ['execution-scheduled', 'execution-completed', 'execution-failed', 'agreement-expired', 'agreement-withdrawn'],
    scheduled: ['execution-completed', 'execution-failed', 'agreement-expired', 'agreement-withdrawn'],
    // Terminales: nunca vuelven a un estado vivo (sección 9.1 del prompt de
    // TRANSFER-1) — un reintento exige un AIP/expediente nuevo.
    completed: [],
    failed: [],
    expired: [],
    withdrawn: [],
  };
  const AGREEMENT_TERMINAL_STATUSES = new Set(['completed', 'expired', 'withdrawn', 'failed']);
  const AgreementEvents = makeEventMachine({
    label: 'AgreementInPrinciple',
    eventTypes: AGREEMENT_EVENT_TYPES,
    statusByEvent: AGREEMENT_STATUS_BY_EVENT,
    allowedTransitions: AGREEMENT_ALLOWED_TRANSITIONS,
  });

  const exportsObj = {
    MarketEventTypes: {
      eventSortKey, ThreadEvents, OfferEvents, RightsCaseEvents, OFFER_LIVE_STATUSES,
      AgreementEvents, AGREEMENT_TERMINAL_STATUSES,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
