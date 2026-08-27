// src/core/TransferEventTypes.js
// TRANSFER-1 (DESIGN.md 9.20, sección 9.1 del prompt) — máquina de estados
// GENÉRICA (mismo patrón que MarketEventTypes.js/RegistrationEventTypes.js:
// "las transiciones surgen de eventos validados y ordenados, nunca de
// mutaciones libres de un string") para el ciclo de vida de un
// `TransferCase`. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Módulo puro: no conoce Player/Team/Contract/DOM ni `state`.

(function (global) {
  const LocalDateModule = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/LocalDate.js')
    : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function eventSortKey(event) {
    const date = LD().requireIsoDate(event.date, 'date');
    const time = event.time || '23:59:59';
    return `${date}T${time}`;
  }

  // Motor genérico de máquina de estados por eventos — mismo criterio que
  // MarketEventTypes.makeEventMachine, reimplementado aquí (cada dominio
  // de la EPIC mantiene el suyo, mismo criterio ya usado por REG-1/MARKET-1
  // como módulos independientes) para no acoplar `transfer` a los
  // internos de `market`.
  function makeEventMachine({
    label, eventTypes, statusByEvent, allowedTransitions,
  }) {
    function isKnownEventType(type) { return eventTypes.includes(type); }

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
  // TransferCaseEvents (sección 9.1 del prompt) — expediente completo de
  // una operación, desde su apertura hasta la ejecución o un terminal
  // alternativo. Nunca vuelve de un terminal a un estado vivo (sección
  // 9.1: "una corrección requiere un nuevo evento/expediente").
  // ---------------------------------------------------------------------
  const TRANSFER_CASE_EVENT_TYPES = [
    'case-opened',
    'awaiting-origin-club',
    'awaiting-player-consent',
    'awaiting-conditions',
    'ready-to-plan',
    'planned',
    'scheduled',
    'ready-to-execute',
    'completed',
    'rejected',
    'withdrawn',
    'expired',
    'blocked',
    'failed',
  ];
  const TRANSFER_CASE_STATUS_BY_EVENT = Object.fromEntries(TRANSFER_CASE_EVENT_TYPES.map((t) => [t, t === 'case-opened' ? 'draft' : t.replace(/-([a-z])/g, (m, c) => c.toUpperCase())]));
  // Normaliza los nombres de estado a camelCase (mismo criterio que el resto
  // de la EPIC): 'awaiting-origin-club' -> 'awaitingOriginClub', etc.
  TRANSFER_CASE_STATUS_BY_EVENT['ready-to-plan'] = 'readyToPlan';
  TRANSFER_CASE_STATUS_BY_EVENT['ready-to-execute'] = 'readyToExecute';

  const TRANSFER_CASE_ALLOWED_TRANSITIONS = {
    null: ['case-opened'],
    draft: ['awaiting-origin-club', 'awaiting-player-consent', 'awaiting-conditions', 'ready-to-plan', 'blocked', 'rejected', 'withdrawn'],
    awaitingOriginClub: ['awaiting-player-consent', 'awaiting-conditions', 'ready-to-plan', 'rejected', 'withdrawn', 'expired'],
    awaitingPlayerConsent: ['awaiting-origin-club', 'awaiting-conditions', 'ready-to-plan', 'rejected', 'withdrawn', 'expired'],
    awaitingConditions: ['ready-to-plan', 'blocked', 'rejected', 'withdrawn', 'expired'],
    readyToPlan: ['planned', 'blocked', 'withdrawn', 'expired'],
    planned: ['scheduled', 'ready-to-execute', 'blocked', 'failed', 'withdrawn', 'expired'],
    scheduled: ['ready-to-execute', 'blocked', 'failed', 'withdrawn', 'expired'],
    readyToExecute: ['completed', 'blocked', 'failed'],
    blocked: ['ready-to-plan', 'awaiting-conditions', 'withdrawn', 'expired'],
    // Terminales — nunca vuelven a un estado vivo (sección 9.1).
    completed: [],
    rejected: [],
    withdrawn: [],
    expired: [],
    failed: [],
  };
  const TRANSFER_CASE_TERMINAL_STATUSES = new Set(['completed', 'rejected', 'withdrawn', 'expired', 'failed']);
  const TransferCaseEvents = makeEventMachine({
    label: 'TransferCase',
    eventTypes: TRANSFER_CASE_EVENT_TYPES,
    statusByEvent: TRANSFER_CASE_STATUS_BY_EVENT,
    allowedTransitions: TRANSFER_CASE_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // ClubOfferEvents (sección 9.2 del prompt) — ciclo de vida de UNA
  // versión de `ClubTransferOffer`. Mismo criterio que OfferEvents de
  // MARKET-1: inmutable y terminal, una contraoferta es una entidad NUEVA.
  // ---------------------------------------------------------------------
  const CLUB_OFFER_EVENT_TYPES = ['offer-sent', 'offer-accepted', 'offer-rejected', 'offer-countered', 'offer-withdrawn', 'offer-expired'];
  const CLUB_OFFER_STATUS_BY_EVENT = {
    'offer-sent': 'sent',
    'offer-accepted': 'accepted',
    'offer-rejected': 'rejected',
    'offer-countered': 'countered',
    'offer-withdrawn': 'withdrawn',
    'offer-expired': 'expired',
  };
  const CLUB_OFFER_ALLOWED_TRANSITIONS = {
    null: ['offer-sent'],
    sent: ['offer-accepted', 'offer-rejected', 'offer-countered', 'offer-withdrawn', 'offer-expired'],
    accepted: [], rejected: [], countered: [], withdrawn: [], expired: [],
  };
  const ClubOfferEvents = makeEventMachine({
    label: 'ClubTransferOffer', eventTypes: CLUB_OFFER_EVENT_TYPES, statusByEvent: CLUB_OFFER_STATUS_BY_EVENT, allowedTransitions: CLUB_OFFER_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // ReleaseClauseEvents (sección 9.4) — comunicación -> satisfacción ->
  // efectiva; o bloqueada por restricción de inscripción (15-09 ACB).
  // ---------------------------------------------------------------------
  const RELEASE_CLAUSE_EVENT_TYPES = ['notified', 'satisfied', 'effective', 'blocked', 'withdrawn'];
  const RELEASE_CLAUSE_STATUS_BY_EVENT = {
    notified: 'notified', satisfied: 'satisfied', effective: 'effective', blocked: 'blocked', withdrawn: 'withdrawn',
  };
  const RELEASE_CLAUSE_ALLOWED_TRANSITIONS = {
    null: ['notified'],
    notified: ['satisfied', 'blocked', 'withdrawn'],
    satisfied: ['effective', 'blocked'],
    blocked: ['satisfied', 'withdrawn'],
    effective: [], withdrawn: [],
  };
  const ReleaseClauseEvents = makeEventMachine({
    label: 'ReleaseClauseExercise', eventTypes: RELEASE_CLAUSE_EVENT_TYPES, statusByEvent: RELEASE_CLAUSE_STATUS_BY_EVENT, allowedTransitions: RELEASE_CLAUSE_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // TerminationEvents (sección 9.5) — agreed/noticed -> effective; o
  // blocked-awaiting-resolution cuando la causa no está acreditada.
  // ---------------------------------------------------------------------
  const TERMINATION_EVENT_TYPES = ['agreed', 'noticed', 'blocked-awaiting-resolution', 'effective', 'withdrawn'];
  const TERMINATION_STATUS_BY_EVENT = {
    agreed: 'agreed', noticed: 'noticed', 'blocked-awaiting-resolution': 'blockedAwaitingResolution', effective: 'effective', withdrawn: 'withdrawn',
  };
  const TERMINATION_ALLOWED_TRANSITIONS = {
    null: ['agreed', 'noticed', 'blocked-awaiting-resolution'],
    agreed: ['effective', 'withdrawn'],
    noticed: ['effective', 'blocked-awaiting-resolution', 'withdrawn'],
    blockedAwaitingResolution: ['effective', 'withdrawn'],
    effective: [], withdrawn: [],
  };
  const TerminationEvents = makeEventMachine({
    label: 'ContractTerminationRecord', eventTypes: TERMINATION_EVENT_TYPES, statusByEvent: TERMINATION_STATUS_BY_EVENT, allowedTransitions: TERMINATION_ALLOWED_TRANSITIONS,
  });

  const exportsObj = {
    TransferEventTypes: {
      eventSortKey,
      makeEventMachine,
      TransferCaseEvents,
      TRANSFER_CASE_TERMINAL_STATUSES,
      ClubOfferEvents,
      ReleaseClauseEvents,
      TerminationEvents,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
