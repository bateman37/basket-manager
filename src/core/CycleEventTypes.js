// src/core/CycleEventTypes.js
// CYCLE-1 (DESIGN.md 9.22, sección 7 del prompt) — máquinas de estados por
// EVENTOS validados y ordenados del ciclo anual de plantilla. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Mismo patrón exacto que `MarketEventTypes.js`/`RegistrationEventTypes.js`/
// `TransferEventTypes.js`/`LoanEventTypes.js`: reutiliza el motor genérico
// `TransferEventTypes.makeEventMachine` (nunca se duplica la
// infraestructura) y NUNCA guarda un `status` mutable libre — el estado se
// DERIVA del ledger append-only de eventos.
//
// Módulo puro: no conoce Player/Team/Contract, ni el DOM, ni `state`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const TransferEventTypesModule = isNode ? require('./TransferEventTypes.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;

  const { makeEventMachine } = TransferEventTypesModule.TransferEventTypes;

  function CC() { return CycleConfigModule.CycleConfig; }

  // ---------------------------------------------------------------------
  // 1. AnnualRosterCycle — fase global del ciclo anual.
  //
  // El orden semántico de la sección 7 del prompt se conserva EXACTAMENTE:
  // no se puede entrar en una fase sin haber verificado la anterior. La
  // única transición no lineal admitida es `blocked` (un club `not-ready`
  // impide arrancar la temporada) y su vuelta a la fase en la que se
  // bloqueó, con un evento NUEVO.
  // ---------------------------------------------------------------------
  const CYCLE_PHASE_EVENT_TYPES = CC().CYCLE_PHASES.map((phaseId) => `phase:${phaseId}`).concat(['cycle-blocked']);

  const CYCLE_STATUS_BY_EVENT = CC().CYCLE_PHASES.reduce((acc, phaseId) => {
    acc[`phase:${phaseId}`] = phaseId;
    return acc;
  }, { 'cycle-blocked': 'blocked' });

  const CYCLE_ALLOWED_TRANSITIONS = (() => {
    const phases = CC().CYCLE_PHASES;
    const map = { null: [`phase:${phases[0]}`] };
    phases.forEach((phaseId, index) => {
      const next = phases[index + 1];
      map[phaseId] = next ? [`phase:${next}`, 'cycle-blocked'] : [];
    });
    // Desde `blocked` solo se puede volver a intentar la fase que se estaba
    // resolviendo (nunca saltar a una posterior) — se declara admitiendo
    // cualquier fase, y `AnnualCycleService` es quien valida las
    // precondiciones reales de esa fase antes de reintentarla.
    map.blocked = phases.map((phaseId) => `phase:${phaseId}`);
    return map;
  })();

  const AnnualCycleEvents = makeEventMachine({
    label: 'AnnualRosterCycle',
    eventTypes: CYCLE_PHASE_EVENT_TYPES,
    statusByEvent: CYCLE_STATUS_BY_EVENT,
    allowedTransitions: CYCLE_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // 2. ClubCycleCase — expediente de UN club dentro del ciclo.
  //
  // `ready` es el único estado que autoriza a empezar la temporada; un
  // `not-ready` con diagnóstico bloqueante NO lo hace (sección 7: "no se
  // puede empezar temporada con un club not-ready").
  // ---------------------------------------------------------------------
  const CLUB_CASE_EVENT_TYPES = [
    'case-opened',
    'last-match-evidence-recorded',
    'opening-payroll-frozen',
    'plan-built',
    'decisions-required',
    'decisions-completed',
    'legality-audited',
    'emergency-applied',
    'ready',
    'not-ready',
  ];
  const CLUB_CASE_STATUS_BY_EVENT = {
    'case-opened': 'open',
    'last-match-evidence-recorded': 'evidenceRecorded',
    'opening-payroll-frozen': 'payrollFrozen',
    'plan-built': 'planned',
    'decisions-required': 'awaitingDecisions',
    'decisions-completed': 'decisionsCompleted',
    'legality-audited': 'audited',
    'emergency-applied': 'emergencyApplied',
    ready: 'ready',
    'not-ready': 'notReady',
  };
  const CLUB_CASE_ALLOWED_TRANSITIONS = {
    null: ['case-opened'],
    open: ['last-match-evidence-recorded', 'not-ready'],
    evidenceRecorded: ['opening-payroll-frozen', 'not-ready'],
    payrollFrozen: ['plan-built', 'decisions-required', 'legality-audited', 'not-ready'],
    planned: ['decisions-required', 'decisions-completed', 'plan-built', 'legality-audited', 'not-ready'],
    awaitingDecisions: ['decisions-completed', 'plan-built', 'decisions-required', 'legality-audited', 'not-ready'],
    decisionsCompleted: ['plan-built', 'decisions-required', 'legality-audited', 'not-ready'],
    audited: ['emergency-applied', 'ready', 'not-ready', 'legality-audited'],
    emergencyApplied: ['legality-audited', 'ready', 'not-ready'],
    // `ready` puede volver a auditarse (una operación posterior del verano
    // puede alterar la plantilla) pero nunca "desaparece" sin un evento.
    ready: ['legality-audited', 'not-ready'],
    notReady: ['legality-audited', 'emergency-applied', 'decisions-required', 'ready'],
  };
  const ClubCycleCaseEvents = makeEventMachine({
    label: 'ClubCycleCase',
    eventTypes: CLUB_CASE_EVENT_TYPES,
    statusByEvent: CLUB_CASE_STATUS_BY_EVENT,
    allowedTransitions: CLUB_CASE_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // 3. RenewalCase — negociación de renovación con el CLUB ACTUAL.
  //
  // Una renovación NO es un `TransferCase` (no hay cambio de club) y NO es
  // una oferta de mercado a un jugador ajeno: es una negociación nueva entre
  // el empleador actual y el jugador/agente que termina en un contrato
  // futuro NO solapado.
  // ---------------------------------------------------------------------
  const RENEWAL_EVENT_TYPES = [
    'case-opened',
    'offer-sent',
    'countered',
    'accepted',
    'agreement-in-principle',
    'committed',
    'rejected',
    'withdrawn',
    'expired',
    'blocked',
  ];
  const RENEWAL_STATUS_BY_EVENT = {
    'case-opened': 'open',
    'offer-sent': 'offerSent',
    countered: 'countered',
    accepted: 'accepted',
    'agreement-in-principle': 'agreementInPrinciple',
    committed: 'committed',
    rejected: 'rejected',
    withdrawn: 'withdrawn',
    expired: 'expired',
    blocked: 'blocked',
  };
  const RENEWAL_ALLOWED_TRANSITIONS = {
    null: ['case-opened'],
    open: ['offer-sent', 'withdrawn', 'expired', 'blocked'],
    offerSent: ['accepted', 'countered', 'rejected', 'withdrawn', 'expired', 'blocked'],
    countered: ['offer-sent', 'accepted', 'rejected', 'withdrawn', 'expired', 'blocked'],
    accepted: ['agreement-in-principle', 'blocked', 'expired'],
    agreementInPrinciple: ['committed', 'blocked', 'expired'],
    blocked: ['offer-sent', 'withdrawn', 'expired'],
    // Terminales.
    committed: [],
    rejected: [],
    withdrawn: [],
    expired: [],
  };
  const RenewalCaseEvents = makeEventMachine({
    label: 'RenewalCase',
    eventTypes: RENEWAL_EVENT_TYPES,
    statusByEvent: RENEWAL_STATUS_BY_EVENT,
    allowedTransitions: RENEWAL_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // 4. ContractOptionDecision — ejercicio (o no) de una cláusula de opción
  //    TIPADA. La decisión queda persistida aunque la opción NO se ejerza.
  // ---------------------------------------------------------------------
  const OPTION_EVENT_TYPES = [
    'decision-opened',
    'terms-incomplete',
    'window-closed-unexercised',
    'declined',
    'club-consent',
    'player-consent',
    'trigger-verified',
    'trigger-not-met',
    'exercised',
    'committed',
    'blocked',
  ];
  const OPTION_STATUS_BY_EVENT = {
    'decision-opened': 'open',
    'terms-incomplete': 'notExecutable',
    'window-closed-unexercised': 'lapsed',
    declined: 'declined',
    'club-consent': 'clubConsented',
    'player-consent': 'playerConsented',
    'trigger-verified': 'triggerVerified',
    'trigger-not-met': 'triggerNotMet',
    exercised: 'exercised',
    committed: 'committed',
    blocked: 'blocked',
  };
  const OPTION_ALLOWED_TRANSITIONS = {
    null: ['decision-opened'],
    open: ['terms-incomplete', 'club-consent', 'player-consent', 'trigger-verified', 'trigger-not-met', 'declined', 'window-closed-unexercised', 'blocked'],
    clubConsented: ['player-consent', 'exercised', 'declined', 'window-closed-unexercised', 'blocked'],
    playerConsented: ['club-consent', 'exercised', 'declined', 'window-closed-unexercised', 'blocked'],
    triggerVerified: ['exercised', 'blocked'],
    exercised: ['committed', 'blocked'],
    blocked: ['exercised', 'declined', 'window-closed-unexercised'],
    // Terminales.
    notExecutable: [],
    lapsed: [],
    declined: [],
    triggerNotMet: [],
    committed: [],
  };
  const ContractOptionDecisionEvents = makeEventMachine({
    label: 'ContractOptionDecision',
    eventTypes: OPTION_EVENT_TYPES,
    statusByEvent: OPTION_STATUS_BY_EVENT,
    allowedTransitions: OPTION_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // 5. Retirada — anuncio y efectividad son DOS hechos distintos, y una
  //    retirada anunciada NO retira al jugador antes de su fecha efectiva.
  // ---------------------------------------------------------------------
  const RETIREMENT_EVENT_TYPES = ['announced', 'withdrawn-announcement', 'effective', 'blocked'];
  const RETIREMENT_STATUS_BY_EVENT = {
    announced: 'announced',
    'withdrawn-announcement': 'announcementWithdrawn',
    effective: 'retired',
    blocked: 'blocked',
  };
  const RETIREMENT_ALLOWED_TRANSITIONS = {
    null: ['announced'],
    announced: ['effective', 'withdrawn-announcement', 'blocked'],
    blocked: ['effective', 'withdrawn-announcement'],
    // Terminales: no hay retorno del retiro en esta entrega (sección 12).
    retired: [],
    announcementWithdrawn: [],
  };
  const RetirementEvents = makeEventMachine({
    label: 'RetirementAnnouncement',
    eventTypes: RETIREMENT_EVENT_TYPES,
    statusByEvent: RETIREMENT_STATUS_BY_EVENT,
    allowedTransitions: RETIREMENT_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // 6. AcademyMembership — pertenencia al pool de academia (NUNCA una
  //    afiliación senior: `player.teamId` sigue `null` mientras solo esté
  //    aquí).
  // ---------------------------------------------------------------------
  const ACADEMY_EVENT_TYPES = [
    'joined',
    'continued',
    'promotion-agreed',
    'promoted',
    'promotion-pending-registration',
    'released-to-free-agency',
    'left-professional-pathway',
    'aged-out',
    'blocked',
  ];
  const ACADEMY_STATUS_BY_EVENT = {
    joined: 'active',
    continued: 'active',
    'promotion-agreed': 'promotionAgreed',
    promoted: 'promoted',
    'promotion-pending-registration': 'promotedPendingRegistration',
    'released-to-free-agency': 'released',
    'left-professional-pathway': 'leftProfessionalPathway',
    'aged-out': 'agedOut',
    blocked: 'blocked',
  };
  const ACADEMY_ALLOWED_TRANSITIONS = {
    null: ['joined'],
    active: ['continued', 'promotion-agreed', 'released-to-free-agency', 'left-professional-pathway', 'aged-out', 'blocked'],
    agedOut: ['promotion-agreed', 'released-to-free-agency', 'left-professional-pathway', 'blocked'],
    promotionAgreed: ['promoted', 'promotion-pending-registration', 'blocked'],
    promotedPendingRegistration: ['promoted', 'blocked'],
    blocked: ['continued', 'promotion-agreed', 'released-to-free-agency', 'left-professional-pathway'],
    // Terminales de la pertenencia (el jugador sigue existiendo en el
    // Player Registry: cambia su categoría operativa, nunca desaparece).
    promoted: [],
    released: [],
    leftProfessionalPathway: [],
  };
  const AcademyMembershipEvents = makeEventMachine({
    label: 'AcademyMembership',
    eventTypes: ACADEMY_EVENT_TYPES,
    statusByEvent: ACADEMY_STATUS_BY_EVENT,
    allowedTransitions: ACADEMY_ALLOWED_TRANSITIONS,
  });

  // ---------------------------------------------------------------------
  // 7. ClearingRound — ronda del clearinghouse (recibo inmutable).
  // ---------------------------------------------------------------------
  const CLEARING_EVENT_TYPES = ['round-opened', 'snapshot-frozen', 'proposals-admitted', 'decisions-resolved', 'commits-applied', 'round-closed', 'round-failed'];
  const CLEARING_STATUS_BY_EVENT = {
    'round-opened': 'open',
    'snapshot-frozen': 'snapshotFrozen',
    'proposals-admitted': 'proposalsAdmitted',
    'decisions-resolved': 'decisionsResolved',
    'commits-applied': 'commitsApplied',
    'round-closed': 'closed',
    'round-failed': 'failed',
  };
  const CLEARING_ALLOWED_TRANSITIONS = {
    null: ['round-opened'],
    open: ['snapshot-frozen', 'round-failed'],
    snapshotFrozen: ['proposals-admitted', 'round-closed', 'round-failed'],
    proposalsAdmitted: ['decisions-resolved', 'round-closed', 'round-failed'],
    decisionsResolved: ['commits-applied', 'round-closed', 'round-failed'],
    commitsApplied: ['round-closed', 'round-failed'],
    closed: [],
    failed: [],
  };
  const ClearingRoundEvents = makeEventMachine({
    label: 'ClearingRound',
    eventTypes: CLEARING_EVENT_TYPES,
    statusByEvent: CLEARING_STATUS_BY_EVENT,
    allowedTransitions: CLEARING_ALLOWED_TRANSITIONS,
  });

  const exportsObj = {
    CycleEventTypes: {
      AnnualCycleEvents,
      ClubCycleCaseEvents,
      RenewalCaseEvents,
      ContractOptionDecisionEvents,
      RetirementEvents,
      AcademyMembershipEvents,
      ClearingRoundEvents,
      CYCLE_PHASE_EVENT_TYPES,
    },
  };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
