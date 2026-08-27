// src/core/LoanEventTypes.js
// LOAN-1 (DESIGN.md 9.21, sección 8/10 del prompt) — máquinas de estados por
// eventos para el ciclo de vida de una cesión (mismo patrón que
// TransferEventTypes.js/MarketEventTypes.js/RegistrationEventTypes.js: "las
// transiciones surgen de eventos validados y ordenados, nunca de mutaciones
// libres de un string"). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Módulo puro: no conoce Player/Team/Contract/DOM ni `state`. No reimplementa
// el motor genérico — reutiliza `TransferEventTypes.makeEventMachine` (mismo
// criterio de "no dupliques la saga/infraestructura" del prompt de LOAN-1,
// sección 14).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const TransferEventTypesModule = isNode ? require('./TransferEventTypes.js') : global.BasketManager;

  const { makeEventMachine } = TransferEventTypesModule.TransferEventTypes;

  // ---------------------------------------------------------------------
  // LoanCaseEvents (sección 10 del prompt) — expediente completo de una
  // cesión, desde su apertura hasta activación/retorno o un terminal
  // alternativo. Un terminal nunca vuelve a un estado vivo.
  // ---------------------------------------------------------------------
  const LOAN_CASE_EVENT_TYPES = [
    'case-opened',
    'proposed',
    'countered',
    'awaiting-owner-consent',
    'awaiting-borrower-consent',
    'awaiting-player-consent',
    'agreed',
    'documents-pending',
    'registration-pending',
    'scheduled',
    'activated',
    'return-scheduled',
    'returned',
    'rejected',
    'withdrawn',
    'expired',
    'blocked',
    'failed',
    'terminated-early',
    'converted-to-permanent-transfer',
  ];
  const LOAN_CASE_STATUS_BY_EVENT = {
    'case-opened': 'draft',
    proposed: 'proposed',
    countered: 'countered',
    'awaiting-owner-consent': 'awaitingOwnerConsent',
    'awaiting-borrower-consent': 'awaitingBorrowerConsent',
    'awaiting-player-consent': 'awaitingPlayerConsent',
    agreed: 'agreed',
    'documents-pending': 'pendingDocuments',
    'registration-pending': 'pendingRegistration',
    scheduled: 'scheduled',
    activated: 'active',
    'return-scheduled': 'returnScheduled',
    returned: 'returned',
    rejected: 'rejected',
    withdrawn: 'withdrawn',
    expired: 'expired',
    blocked: 'blocked',
    failed: 'failed',
    'terminated-early': 'terminatedEarly',
    'converted-to-permanent-transfer': 'convertedToPermanentTransfer',
  };
  const LOAN_CASE_ALLOWED_TRANSITIONS = {
    null: ['case-opened'],
    draft: ['proposed', 'withdrawn'],
    proposed: ['countered', 'awaiting-owner-consent', 'awaiting-borrower-consent', 'awaiting-player-consent', 'rejected', 'withdrawn', 'expired'],
    countered: ['countered', 'awaiting-owner-consent', 'awaiting-borrower-consent', 'awaiting-player-consent', 'rejected', 'withdrawn', 'expired'],
    awaitingOwnerConsent: ['awaiting-borrower-consent', 'awaiting-player-consent', 'countered', 'agreed', 'rejected', 'withdrawn', 'expired'],
    awaitingBorrowerConsent: ['awaiting-owner-consent', 'awaiting-player-consent', 'countered', 'agreed', 'rejected', 'withdrawn', 'expired'],
    awaitingPlayerConsent: ['awaiting-owner-consent', 'awaiting-borrower-consent', 'countered', 'agreed', 'rejected', 'withdrawn', 'expired'],
    agreed: ['documents-pending', 'registration-pending', 'scheduled', 'activated', 'blocked', 'withdrawn', 'expired'],
    pendingDocuments: ['registration-pending', 'scheduled', 'activated', 'blocked', 'withdrawn', 'expired'],
    pendingRegistration: ['scheduled', 'activated', 'blocked', 'failed', 'withdrawn', 'expired'],
    scheduled: ['activated', 'blocked', 'failed', 'withdrawn', 'expired'],
    active: ['return-scheduled', 'returned', 'terminated-early', 'converted-to-permanent-transfer', 'blocked'],
    returnScheduled: ['returned', 'terminated-early', 'converted-to-permanent-transfer', 'blocked'],
    returned: ['converted-to-permanent-transfer'],
    blocked: ['agreed', 'pendingDocuments', 'pendingRegistration', 'scheduled', 'withdrawn', 'expired'],
    // Terminales — nunca vuelven a un estado vivo.
    rejected: [],
    withdrawn: [],
    expired: [],
    failed: [],
    terminatedEarly: [],
    convertedToPermanentTransfer: [],
  };
  const LOAN_CASE_TERMINAL_STATUSES = new Set([
    'rejected', 'withdrawn', 'expired', 'failed', 'terminatedEarly', 'convertedToPermanentTransfer',
  ]);
  const LoanCaseEvents = makeEventMachine({
    label: 'LoanCase',
    eventTypes: LOAN_CASE_EVENT_TYPES,
    statusByEvent: LOAN_CASE_STATUS_BY_EVENT,
    allowedTransitions: LOAN_CASE_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // LoanProposalEvents (sección 8.2) — ciclo de vida de UNA versión de
  // `LoanProposal`. Inmutable y terminal, una contraoferta es una entidad
  // NUEVA (mismo criterio que ClubOfferEvents/OfferEvents de MARKET-1).
  // ---------------------------------------------------------------------
  const LOAN_PROPOSAL_EVENT_TYPES = ['proposal-sent', 'proposal-accepted', 'proposal-rejected', 'proposal-countered', 'proposal-withdrawn', 'proposal-expired'];
  const LOAN_PROPOSAL_STATUS_BY_EVENT = {
    'proposal-sent': 'sent',
    'proposal-accepted': 'accepted',
    'proposal-rejected': 'rejected',
    'proposal-countered': 'countered',
    'proposal-withdrawn': 'withdrawn',
    'proposal-expired': 'expired',
  };
  const LOAN_PROPOSAL_ALLOWED_TRANSITIONS = {
    null: ['proposal-sent'],
    sent: ['proposal-accepted', 'proposal-rejected', 'proposal-countered', 'proposal-withdrawn', 'proposal-expired'],
    accepted: [], rejected: [], countered: [], withdrawn: [], expired: [],
  };
  const LoanProposalEvents = makeEventMachine({
    label: 'LoanProposal', eventTypes: LOAN_PROPOSAL_EVENT_TYPES, statusByEvent: LOAN_PROPOSAL_STATUS_BY_EVENT, allowedTransitions: LOAN_PROPOSAL_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // PurchaseOptionEvents (sección 8.7) — ejercicio de una opción/obligación
  // de compra pactada en una cesión. Ejercer NUNCA mueve roster ni obliga al
  // jugador: solo abre una vía de TRANSFER-1 (sección 17.2/17.3).
  // ---------------------------------------------------------------------
  const PURCHASE_OPTION_EVENT_TYPES = ['exercise-notified', 'pending-player-consent', 'confirmed', 'declined-by-player', 'withdrawn', 'expired'];
  const PURCHASE_OPTION_STATUS_BY_EVENT = {
    'exercise-notified': 'notified',
    'pending-player-consent': 'pendingPlayerConsent',
    confirmed: 'confirmed',
    'declined-by-player': 'declinedByPlayer',
    withdrawn: 'withdrawn',
    expired: 'expired',
  };
  const PURCHASE_OPTION_ALLOWED_TRANSITIONS = {
    null: ['exercise-notified'],
    notified: ['pending-player-consent', 'withdrawn', 'expired'],
    pendingPlayerConsent: ['confirmed', 'declined-by-player', 'expired'],
    confirmed: [], declinedByPlayer: [], withdrawn: [], expired: [],
  };
  const PurchaseOptionEvents = makeEventMachine({
    label: 'PurchaseOptionExercise', eventTypes: PURCHASE_OPTION_EVENT_TYPES, statusByEvent: PURCHASE_OPTION_STATUS_BY_EVENT, allowedTransitions: PURCHASE_OPTION_ALLOWED_TRANSITIONS,
  });

  const exportsObj = {
    LoanEventTypes: {
      LoanCaseEvents,
      LOAN_CASE_TERMINAL_STATUSES,
      LoanProposalEvents,
      PurchaseOptionEvents,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
