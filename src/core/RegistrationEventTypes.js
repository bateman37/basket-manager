// src/core/RegistrationEventTypes.js
// REG-1 (DESIGN.md 9.18) — Unión discriminada de eventos regulatorios
// (`RegistrationEvent`, sección 7.4 del prompt de REG-1) compartida por
// `FederationLicense` y `CompetitionRegistration` (mismo vocabulario de
// ciclo de vida — sección 6.4: "altas, bajas, suspensión, provisionalidad,
// reactivación y expiración deben surgir de eventos validados y ordenados,
// no de mutaciones libres de un string desde la UI"). Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Módulo puro: no conoce `Player`, `Team`, DOM ni `state`.

(function (global) {
  const LocalDateModule = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/LocalDate.js')
    : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  // Tipos válidos (sección 7.4 del prompt de REG-1). `document-corrected`
  // no cambia el estado derivado por sí solo — es un evento de EVIDENCIA
  // (corrección de documentos) que puede acompañar cualquier estado.
  const EVENT_TYPES = [
    'submitted',
    'validated',
    'provisionally-authorized',
    'activated',
    'deactivated',
    'suspended',
    'reinstated',
    'rejected',
    'expired',
    'document-corrected',
  ];

  // Estado DERIVADO de cada tipo de evento "de estado" (todos menos
  // `document-corrected`, que es puramente evidencial).
  const STATUS_BY_EVENT = {
    submitted: 'submitted',
    validated: 'validated',
    'provisionally-authorized': 'provisional',
    activated: 'active',
    deactivated: 'deactivated',
    suspended: 'suspended',
    reinstated: 'active',
    rejected: 'rejected',
    expired: 'expired',
  };

  // Transiciones PERMITIDAS: `from` (estado derivado actual, o `null` si
  // todavía no hay ningún evento) -> conjunto de eventos que puede recibir
  // a continuación. Una transición fuera de esta tabla se rechaza
  // explícitamente (sección 7.4: "un evento desconocido o una transición
  // imposible se rechaza").
  const ALLOWED_TRANSITIONS = {
    null: ['submitted'],
    submitted: ['validated', 'rejected', 'document-corrected'],
    validated: ['provisionally-authorized', 'activated', 'rejected', 'document-corrected'],
    provisional: ['activated', 'rejected', 'deactivated', 'document-corrected'],
    active: ['suspended', 'deactivated', 'expired', 'document-corrected'],
    suspended: ['reinstated', 'deactivated', 'expired', 'document-corrected'],
    deactivated: ['document-corrected'],
    rejected: ['document-corrected'],
    expired: ['document-corrected'],
  };

  function isKnownEventType(type) {
    return EVENT_TYPES.includes(type);
  }

  // Combina fecha civil (obligatoria) + hora local opcional (sección 6.5:
  // "las altas incluyen horas y zona horaria") en una clave ORDENABLE como
  // string — nunca medianoche UTC implícita. Sin hora declarada, se ordena
  // como si fuera al final del día (una alta con hora explícita el mismo
  // día civil se considera anterior a una sin hora declarada — desempate
  // determinista, documentado).
  function eventSortKey(event) {
    const date = LD().requireIsoDate(event.date, 'date');
    const time = event.time || '23:59:59';
    return `${date}T${time}`;
  }

  // `priorEvents` deben venir YA validados/ordenados (se asume invariante
  // mantenida por quien construye la entidad, ver FederationLicense/
  // CompetitionRegistration). Devuelve `{ valid, errors }`, nunca lanza —
  // el llamador decide si continuar o rechazar.
  function validateEvent(event, priorEvents) {
    const errors = [];
    if (!event || typeof event !== 'object') {
      return { valid: false, errors: ['Evento regulatorio vacío o no es un objeto.'] };
    }
    if (!event.id) errors.push('Evento regulatorio sin "id".');
    if (!isKnownEventType(event.type)) {
      errors.push(`Tipo de evento regulatorio desconocido: "${event.type}" — no se admite fuera de ${EVENT_TYPES.join(', ')}.`);
    }
    if (!event.date || !LocalDateModule.LocalDate.isValidIsoDate(event.date)) {
      errors.push(`Evento regulatorio "${event.id || '?'}" sin fecha civil ISO válida.`);
    }
    if (errors.length) return { valid: false, errors };

    const priors = priorEvents || [];
    if (priors.some((e) => e.id === event.id)) {
      errors.push(`Ya existe un evento regulatorio con id "${event.id}" — no se permiten IDs duplicados.`);
    }

    // Cronología: un evento nuevo no puede fecharse ANTES del último evento
    // ya registrado (sección 7.4: "no permitas ... una cronología
    // incoherente"). `document-corrected` es la única excepción de
    // ORDEN DE ESTADO (no lo cambia), pero sigue sujeta a la cronología.
    const sorted = [...priors].sort((a, b) => (eventSortKey(a) < eventSortKey(b) ? -1 : 1));
    const last = sorted[sorted.length - 1];
    if (last && eventSortKey(event) < eventSortKey(last)) {
      errors.push(
        `El evento "${event.id}" (${eventSortKey(event)}) es anterior al último evento registrado `
        + `"${last.id}" (${eventSortKey(last)}) — cronología incoherente.`,
      );
    }

    const currentStatus = deriveStatus(priors, null);
    const statusKey = currentStatus === null ? 'null' : currentStatus;
    const allowed = ALLOWED_TRANSITIONS[statusKey] || [];
    if (!allowed.includes(event.type)) {
      errors.push(
        `Transición no permitida: no se puede aplicar el evento "${event.type}" estando en estado `
        + `"${currentStatus === null ? '(sin eventos)' : currentStatus}" (permitidos: ${allowed.join(', ') || '(ninguno)'}).`,
      );
    }

    return { valid: errors.length === 0, errors };
  }

  // Estado derivado en una fecha concreta (`asOfDate` ISO, o `null` para
  // "el último estado conocido, sin filtrar por fecha" — usado por
  // `validateEvent` para conocer el estado ACTUAL antes de aplicar el
  // evento siguiente). `document-corrected` nunca es el evento que decide
  // el estado — se salta al buscar el último evento "de estado".
  function deriveStatus(events, asOfDate) {
    const relevant = (events || [])
      .filter((e) => e.type !== 'document-corrected')
      .filter((e) => !asOfDate || LD().compare(e.date, asOfDate) <= 0)
      .sort((a, b) => (eventSortKey(a) < eventSortKey(b) ? -1 : 1));
    if (!relevant.length) return null;
    return STATUS_BY_EVENT[relevant[relevant.length - 1].type];
  }

  // Estados que NO ocupan el máximo simultáneo de convocatoria/inscripción
  // (sección 5.1/8.5 del prompt de REG-1) — un estado ausente de esta lista
  // (p.ej. 'active') sí computa.
  const NON_OCCUPYING_STATUSES = new Set(['suspended', 'deactivated', 'rejected', 'expired', 'submitted', 'validated', 'provisional']);

  function occupiesActiveSlot(status) {
    return status === 'active';
  }

  const exportsObj = {
    RegistrationEventTypes: {
      EVENT_TYPES,
      STATUS_BY_EVENT,
      ALLOWED_TRANSITIONS,
      NON_OCCUPYING_STATUSES,
      isKnownEventType,
      eventSortKey,
      validateEvent,
      deriveStatus,
      occupiesActiveSlot,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
