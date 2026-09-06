// src/entities/CompetitionSchedule.js
// WORLD-CALENDAR-1 (DESIGN.md 10.14) — `CompetitionScheduleDefinition`:
// CUÁNDO se programa cada fase de una competición, como CONTENIDO
// versionado, inmutable y serializable (mismo contrato que
// `CompetitionFormatDefinition` de COMP-CORE-1: datos planos, nunca
// funciones). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Frontera de responsabilidades (sección 6 del prompt de esta entrega):
//  - QUIÉN juega, con qué formato y cuál es el resultado -> `CompetitionEngine`;
//  - CUÁNDO se programa cada fase -> esta definición (contenido);
//  - el INSTANTE exacto, la cola global y el cursor -> `WorldCalendar`.
//
// Ningún literal de España/ACB/FEB/`1ª`/`2ª` aparece en este archivo: los
// perfiles españoles reales viven en `data/world/spain-2026.1.js`
// (auditado en `scripts/test-world-calendar1.js`).
//
// Estrategias soportadas HOY (deliberadamente dos, no un DSL universal —
// ver `CompetitionScheduleService.js` para el algoritmo):
//
//  1. `round-robin-cadence`
//     params: {
//       roundsCount,               // nº de jornadas declarado por el contenido
//       daysBetweenRounds,
//       weekendSlots: [{ dayOffset, hour, minute, weight }],
//       midweek: { dayOffset, slots:[{hour,minute,weight}], everyNRounds,
//                  excludedRounds:[..] } | null,
//       lastRoundSlot: { dayOffset, hour, minute },
//     }
//
//  2. `bracket-offsets`
//     params: {
//       anchor: { type:'round-robin-round', scheduleId?, planKey, round,
//                 offsetDays },     // `round` = número o 'last'
//       offsetPolicy: 'series-cadence' | 'compressed-window',
//       // series-cadence:
//       roundPatternLengths: [n,...], seriesGameGapDays, seriesRoundGapDays,
//       roundIndexOffset,           // fases que comparten tramo (Final Four)
//       // compressed-window:
//       roundCount, roundGapDays, windowDays, finalCushionDays,
//       kickoff: { hour, minute },
//     }
//
// `anchor.scheduleId` ausente = la MISMA definición; presente = referencia
// PLANA a otra definición ya registrada (así la Copa ancla su ventana en la
// jornada 17 de la Liga sin que el scheduler conozca ACB).

(function (global) {
  const SCHEMA_VERSION = '2026.1';
  const STRATEGIES = ['round-robin-cadence', 'bracket-offsets'];
  const STATUSES = ['active', 'reference-only', 'fictional-test', 'deprecated'];

  function requireString(value, label) {
    if (typeof value !== 'string' || !value.length) {
      throw new Error(`CompetitionScheduleDefinition: falta "${label}" (string no vacío).`);
    }
    return value;
  }

  function requireFiniteNumber(value, label) {
    if (!Number.isFinite(value)) {
      throw new Error(`CompetitionScheduleDefinition: "${label}" debe ser numérico explícito (recibido: ${value}).`);
    }
    return value;
  }

  function freezeSlot(slot, label) {
    requireFiniteNumber(slot.hour, `${label}.hour`);
    if (slot.hour < 0 || slot.hour > 23) throw new Error(`CompetitionScheduleDefinition: "${label}.hour" fuera de rango.`);
    return Object.freeze({
      dayOffset: slot.dayOffset === undefined ? 0 : requireFiniteNumber(slot.dayOffset, `${label}.dayOffset`),
      hour: slot.hour,
      minute: slot.minute === undefined ? 0 : requireFiniteNumber(slot.minute, `${label}.minute`),
      weight: slot.weight === undefined ? 1 : requireFiniteNumber(slot.weight, `${label}.weight`),
    });
  }

  function freezeRoundRobinParams(params, label) {
    const weekendSlots = params.weekendSlots || [];
    if (!Array.isArray(weekendSlots) || !weekendSlots.length) {
      throw new Error(`CompetitionScheduleDefinition: "${label}.weekendSlots" no puede estar vacío.`);
    }
    const midweek = params.midweek
      ? Object.freeze({
        dayOffset: requireFiniteNumber(params.midweek.dayOffset, `${label}.midweek.dayOffset`),
        everyNRounds: requireFiniteNumber(params.midweek.everyNRounds, `${label}.midweek.everyNRounds`),
        excludedRounds: Object.freeze([...(params.midweek.excludedRounds || [])]),
        slots: Object.freeze((params.midweek.slots || []).map((s, i) => freezeSlot(s, `${label}.midweek.slots[${i}]`))),
      })
      : null;
    if (midweek && !midweek.slots.length) {
      throw new Error(`CompetitionScheduleDefinition: "${label}.midweek.slots" no puede estar vacío.`);
    }
    return Object.freeze({
      roundsCount: requireFiniteNumber(params.roundsCount, `${label}.roundsCount`),
      daysBetweenRounds: requireFiniteNumber(params.daysBetweenRounds, `${label}.daysBetweenRounds`),
      weekendSlots: Object.freeze(weekendSlots.map((s, i) => freezeSlot(s, `${label}.weekendSlots[${i}]`))),
      midweek,
      lastRoundSlot: freezeSlot(params.lastRoundSlot || { hour: 18 }, `${label}.lastRoundSlot`),
    });
  }

  function freezeAnchor(anchor, label) {
    if (!anchor) throw new Error(`CompetitionScheduleDefinition: falta "${label}.anchor".`);
    if (anchor.type !== 'round-robin-round') {
      throw new Error(`CompetitionScheduleDefinition: tipo de ancla desconocido "${anchor.type}" en "${label}".`);
    }
    if (anchor.round !== 'last' && !Number.isFinite(anchor.round)) {
      throw new Error(`CompetitionScheduleDefinition: "${label}.anchor.round" debe ser un número o 'last'.`);
    }
    return Object.freeze({
      type: anchor.type,
      scheduleId: anchor.scheduleId || null,
      planKey: requireString(anchor.planKey, `${label}.anchor.planKey`),
      round: anchor.round,
      offsetDays: anchor.offsetDays === undefined ? 0 : requireFiniteNumber(anchor.offsetDays, `${label}.anchor.offsetDays`),
    });
  }

  function freezeBracketParams(params, label) {
    const offsetPolicy = params.offsetPolicy || 'series-cadence';
    if (!['series-cadence', 'compressed-window'].includes(offsetPolicy)) {
      throw new Error(`CompetitionScheduleDefinition: "${label}.offsetPolicy" desconocida "${offsetPolicy}".`);
    }
    const base = {
      anchor: freezeAnchor(params.anchor, label),
      offsetPolicy,
      kickoff: freezeSlot(params.kickoff || { hour: 21 }, `${label}.kickoff`),
      roundIndexOffset: params.roundIndexOffset === undefined
        ? 0 : requireFiniteNumber(params.roundIndexOffset, `${label}.roundIndexOffset`),
    };
    if (offsetPolicy === 'series-cadence') {
      const lengths = params.roundPatternLengths;
      if (!Array.isArray(lengths) || !lengths.length) {
        throw new Error(`CompetitionScheduleDefinition: "${label}.roundPatternLengths" es obligatorio con 'series-cadence'.`);
      }
      return Object.freeze({
        ...base,
        roundPatternLengths: Object.freeze(lengths.map((n, i) => requireFiniteNumber(n, `${label}.roundPatternLengths[${i}]`))),
        seriesGameGapDays: requireFiniteNumber(params.seriesGameGapDays, `${label}.seriesGameGapDays`),
        seriesRoundGapDays: requireFiniteNumber(params.seriesRoundGapDays, `${label}.seriesRoundGapDays`),
      });
    }
    return Object.freeze({
      ...base,
      roundCount: requireFiniteNumber(params.roundCount, `${label}.roundCount`),
      roundGapDays: requireFiniteNumber(params.roundGapDays, `${label}.roundGapDays`),
      windowDays: requireFiniteNumber(params.windowDays, `${label}.windowDays`),
      finalCushionDays: requireFiniteNumber(params.finalCushionDays, `${label}.finalCushionDays`),
    });
  }

  function freezePlan(planKey, plan) {
    const label = `plans.${planKey}`;
    if (!plan || !STRATEGIES.includes(plan.strategy)) {
      throw new Error(
        `CompetitionScheduleDefinition: estrategia desconocida "${plan && plan.strategy}" en "${label}" `
        + `(soportadas: ${STRATEGIES.join(', ')}).`,
      );
    }
    const params = plan.strategy === 'round-robin-cadence'
      ? freezeRoundRobinParams(plan.params || {}, label)
      : freezeBracketParams(plan.params || {}, label);
    return Object.freeze({ key: planKey, strategy: plan.strategy, params });
  }

  class CompetitionScheduleDefinition {
    constructor(data = {}) {
      this.id = requireString(data.id, 'id');
      this.version = requireString(data.version, 'version');
      this.status = data.status || 'active';
      if (!STATUSES.includes(this.status)) {
        throw new Error(`CompetitionScheduleDefinition "${this.id}": status desconocido "${this.status}".`);
      }
      this.schemaVersion = data.schemaVersion || SCHEMA_VERSION;
      this.timeZoneId = requireString(data.timeZoneId, 'timeZoneId');
      // Ancla CIVIL de temporada (mes/día en el huso declarado) — el año lo
      // aporta la carrera (`seasonStartYear`), nunca está codificado aquí.
      const anchor = data.seasonAnchor || {};
      this.seasonAnchor = Object.freeze({
        month: requireFiniteNumber(anchor.month, 'seasonAnchor.month'),
        day: requireFiniteNumber(anchor.day, 'seasonAnchor.day'),
      });
      const plans = data.plans || {};
      const planKeys = Object.keys(plans).sort();
      if (!planKeys.length) {
        throw new Error(`CompetitionScheduleDefinition "${this.id}": no declara ningún plan por fase.`);
      }
      const frozenPlans = {};
      planKeys.forEach((key) => { frozenPlans[key] = freezePlan(key, plans[key]); });
      this.plans = Object.freeze(frozenPlans);
      this.planKeys = Object.freeze(planKeys);
      // Procedencia HONESTA (misma convención que CONTRACT-1..CYCLE-1): un
      // calendario simulado nunca se presenta como el calendario oficial de
      // una competición real.
      const provenance = data.provenance || {};
      this.provenance = Object.freeze({
        dataSource: provenance.dataSource || 'simulated-schedule',
        status: provenance.status || 'design',
        isReal: false,
        notes: provenance.notes
          || 'Calendario SIMULADO de diseño para esta partida; no es el calendario oficial de la competición.',
      });
      Object.freeze(this);
    }

    hasPlan(planKey) { return Object.prototype.hasOwnProperty.call(this.plans, planKey); }

    getPlan(planKey) {
      const plan = this.plans[planKey];
      if (!plan) {
        throw new Error(
          `CompetitionScheduleDefinition "${this.id}": no declara plan de calendario para la fase "${planKey}" `
          + `(declara: ${this.planKeys.join(', ')}). Un calendario desconocido FALLA — nunca hereda otro perfil.`,
        );
      }
      return plan;
    }

    // Plano y serializable (sin `Map`, funciones ni referencias circulares).
    toJSON() {
      return {
        id: this.id,
        version: this.version,
        status: this.status,
        schemaVersion: this.schemaVersion,
        timeZoneId: this.timeZoneId,
        seasonAnchor: { ...this.seasonAnchor },
        plans: this.planKeys.reduce((acc, key) => {
          const plan = this.plans[key];
          acc[key] = { key: plan.key, strategy: plan.strategy, params: JSON.parse(JSON.stringify(plan.params)) };
          return acc;
        }, {}),
        provenance: { ...this.provenance },
      };
    }
  }

  const exportsObj = {
    CompetitionScheduleDefinition,
    COMPETITION_SCHEDULE_SCHEMA_VERSION: SCHEMA_VERSION,
    COMPETITION_SCHEDULE_STRATEGIES: STRATEGIES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
