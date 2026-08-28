// src/core/CycleConfig.js
// CYCLE-1 (DESIGN.md 9.22) — CALIBRACIÓN DE SIMULACIÓN del ciclo anual de
// plantilla. Convención del proyecto: identificadores en inglés, comentarios
// en español.
//
// HONESTIDAD NORMATIVA (sección 21 del prompt de CYCLE-1): NADA de este
// archivo es una norma jurídica, federativa ni de convenio. Son decisiones
// de JUEGO (calibración inicial, pendientes de playtesting en HARDEN-1):
// distribución de duración de los contratos simulados, ventana de
// negociación de renovación, banda de retiradas, tamaño de la academia,
// cota de agentes libres, orden de prioridad de eventos del verano.
//
// Las reglas REALES (cupos, actas, ventanas de inscripción, plazos de
// tanteo, duración máxima de contrato, participación del 15 %...) viven
// EXCLUSIVAMENTE en `CompetitionRules.js` / `ClubEmploymentContextCatalog.js`
// con su fuente, versión y estado. Este archivo nunca las sustituye: cuando
// una calibración de juego choca con un límite normativo real, GANA SIEMPRE
// el límite real (ver `resolveInitialContractSeasons`).
//
// Módulo puro: no conoce `state`, ni el DOM, ni ningún registro.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }

  const CYCLE_CONFIG_VERSION = 'cycle-config-v1';

  // =====================================================================
  // 1. Fases del ciclo anual (orden semántico, sección 7 del prompt)
  // =====================================================================
  const CYCLE_PHASES = [
    'competitions-complete',
    'snapshot-frozen',
    'season-history-closed',
    'loans-and-options-reviewed',
    'rights-and-retention-open',
    'retirements-reviewed',
    'renewals-and-free-agency',
    'academy-decisions',
    'clearing-rounds',
    'roster-legality-audit',
    'licenses-and-registrations',
    'preseason-ready',
    'new-season-started',
  ];

  // Desplazamiento en DÍAS CIVILES de cada fase respecto a la fecha del
  // ÚLTIMO partido oficial del mundo (la más tardía de los 36 clubes).
  // Calibración de juego: el verano se recorre por fechas reales, no por
  // "pasos" abstractos. `renewals-and-free-agency` se ancla además al primer
  // día posterior al fin de los contratos de la temporada que termina (ver
  // `buildSummerSchedule`): las expiraciones orgánicas no pueden procesarse
  // antes de que el contrato haya vencido de verdad.
  const PHASE_DAY_OFFSETS = {
    'competitions-complete': 0,
    'snapshot-frozen': 0,
    'season-history-closed': 0,
    'loans-and-options-reviewed': 1,
    'rights-and-retention-open': 2,
    'retirements-reviewed': 6,
    'renewals-and-free-agency': 10,
    'academy-decisions': 18,
    'clearing-rounds': 22,
    'roster-legality-audit': 30,
    'licenses-and-registrations': 34,
    'preseason-ready': 40,
  };

  // Prioridad ESTABLE de los eventos del ciclo que caen en la MISMA fecha
  // civil (sección 8 del prompt). Dentro de la misma prioridad se ordena por
  // id canónico, NUNCA por posición en un array.
  const SAME_DATE_EVENT_PRIORITY = [
    'loan-return', // 1. retornos de cesión antes de extinguir el contrato matriz
    'scheduled-move', // 2. opciones/renovaciones/traspasos ya programados con efecto hoy
    'contract-expiry', // 3. expiración orgánica y liberación sin continuidad
    'retirement-effective', // 4. retiradas efectivas
    'market-deadline', // 5. deadlines de mercado/derechos
    'academy-decision', // 6. decisiones de academia
    'roster-legality', // 7. auditoría de plantilla
    'registration', // 8. licencias/inscripciones del nuevo curso
  ];

  // =====================================================================
  // 2. Contratos simulados iniciales (sustituye el puente de 3 temporadas)
  // =====================================================================
  // Sección 9 del prompt: distribución DETERMINISTA de duración restante.
  // Calibración de juego, NO una norma — siempre recortada por el máximo
  // real que resuelva el contexto laboral aplicable.
  const INITIAL_CONTRACT_DURATION_WEIGHTS = [
    { seasons: 1, weightPercent: 25 },
    { seasons: 2, weightPercent: 30 },
    { seasons: 3, weightPercent: 30 },
    { seasons: 4, weightPercent: 15 },
  ];

  // Duración de un contrato NUEVO firmado durante el ciclo (renovación,
  // fichaje de libre, promoción de cantera, emergencia) — misma naturaleza
  // de calibración, distribución propia (más corta que el bootstrap).
  const NEW_CONTRACT_DURATION_WEIGHTS = [
    { seasons: 1, weightPercent: 35 },
    { seasons: 2, weightPercent: 40 },
    { seasons: 3, weightPercent: 25 },
  ];

  // Elige una duración de la distribución de forma DETERMINISTA a partir de
  // una huella estable, y la recorta al máximo normativo REAL resuelto.
  // `maxTermYearsFromRules`: `resolved.employment.maxTermYears` (puede ser
  // `null` = sin máximo declarado). Nunca se sube por encima del límite
  // real; si el límite real es menor que la calibración, gana el real.
  function resolveInitialContractSeasons(fingerprint, discriminator, maxTermYearsFromRules, weights) {
    const table = weights || INITIAL_CONTRACT_DURATION_WEIGHTS;
    const totalWeight = table.reduce((sum, row) => sum + row.weightPercent, 0);
    let roll = Rnd().unitFrom(fingerprint, discriminator) * totalWeight;
    let chosen = table[table.length - 1].seasons;
    for (let i = 0; i < table.length; i += 1) {
      roll -= table[i].weightPercent;
      if (roll < 0) { chosen = table[i].seasons; break; }
    }
    const cap = (maxTermYearsFromRules === null || maxTermYearsFromRules === undefined)
      ? chosen : Math.max(1, Math.floor(maxTermYearsFromRules));
    return Math.max(1, Math.min(chosen, cap));
  }

  // =====================================================================
  // 3. Renovaciones y opciones
  // =====================================================================
  const RENEWAL = {
    // Ventana de JUEGO en la que un club puede abrir una renovación con su
    // propio jugador antes de que expire el contrato. No es un plazo legal.
    windowDaysBeforeExpiry: 300,
    // Rondas máximas de oferta/contraoferta por expediente (evita bucles
    // infinitos en una simulación de 10 temporadas).
    maxOfferRounds: 3,
    // Prima de renovación sobre el salario garantizado de la última
    // temporada del contrato que vence — calibración de juego.
    baseRaisePercent: 8,
    // Recorte para jugadores en declive (por encima de esta edad de
    // carrera), también calibración.
    declineAgeThreshold: 33,
    declineCutPercent: 12,
  };

  // =====================================================================
  // 4. Retiradas (calibración de juego, NUNCA norma federativa)
  // =====================================================================
  // El usuario pidió expresamente DIVERSIDAD individual: dos jugadores con
  // el mismo Potencial deben poder retirarse a edades muy distintas. El
  // Potencial (`hidden.potential`) está PROHIBIDO como entrada del perfil de
  // longevidad — auditado estáticamente en `scripts/test-cycle1.js`.
  const RETIREMENT = {
    ordinaryEvaluationFromAge: 32,
    targetBandMinAge: 34,
    targetBandMaxAge: 41,
    // Máximo de seguridad para que no queden jugadores activos
    // indefinidamente. Nunca una edad exacta por debajo de este máximo
    // garantiza por sí sola la retirada.
    safetyMaxAgeInclusive: 44,
    // Dispersión individual del perfil privado (años). Con esto un jugador
    // puede declinar y retirarse alrededor de los 34 y otro mantenerse
    // hasta cerca de los 40-41 con el mismo Potencial.
    longevityOffsetMinYears: -3,
    longevityOffsetMaxYears: 6,
    // La decisión se modela como una EDAD DE RETIRADA IMPLÍCITA en años (no
    // como una puntuación abstracta): el perfil privado sitúa a cada jugador
    // dentro de la banda objetivo y las señales de la temporada la adelantan
    // o la retrasan en años. Es directamente interpretable y hace evidente
    // la diversidad individual pedida (dos jugadores con el MISMO Potencial
    // pueden tener edades implícitas de 34 y de 41).
    //
    // Desplazamiento en AÑOS por señal (todas VISIBLES o ya modeladas;
    // ninguna es Potencial). Negativo = adelanta la retirada.
    yearShifts: {
      tmbDeclineTrend: -3.0, // declive sostenido de TMB
      medicalLoad: -3.0, // carga de lesiones acumulada
      reducedRole: -2.5, // pérdida de minutos/rol
      noContract: -1.5, // termina el curso sin contrato
      freeAgentDuration: -2.5, // tiempo sin encontrar equipo
      mindset: 1.5, // más profesionalidad/ambición alarga la carrera
      agingOffset: 1.0, // longevidad individual ya modelada (LIFE-1)
    },
  };

  // =====================================================================
  // 5. Academia (configuración de simulación, no reglamento)
  // =====================================================================
  const ACADEMY = {
    annualIntakeMaxPerClub: 3,
    poolMaxPerClub: 8,
    intakeAgeMin: 16,
    intakeAgeMax: 19,
    // Edad máxima INCLUSIVA para seguir en academia: al superarla hay que
    // promocionar, liberar o salir de la vía profesional.
    maxAgeInclusive: 20,
    // Umbral de calidad visible (percentil dentro del pool del club) por
    // encima del cual la CPU promociona en vez de liberar.
    promotionQualityPercentile: 0.75,
    // Percentil por debajo del cual un joven que hace age-out abandona la
    // vía profesional en vez de salir a agente libre.
    leavePathwayQualityPercentile: 0.35,
  };

  // =====================================================================
  // 6. Equilibrio de población (sección 18 del prompt)
  // =====================================================================
  const POPULATION = {
    freeAgentTarget: 30,
    freeAgentHardMax: 72,
    // Margen explícito para acuerdos futuros/externos abstractos al
    // calcular la cota de población ACTIVA (nunca un assert mágico contra
    // el total histórico de `PlayerRegistry`, que conserva retirados).
    activeMarginForFutureAgreements: 60,
  };

  // =====================================================================
  // 7. Planificación CPU y clearinghouse
  // =====================================================================
  const CPU_PLANNING = {
    plannerVersion: 'cpu-roster-planner-v1',
    clearinghouseVersion: 'market-clearinghouse-v1',
    clearingRounds: 3,
    maxProposalsPerClubPerRound: 3,
    // Profundidad objetivo por posición (calibración de juego).
    targetDepthPerPosition: 2,
    // Reserva de presupuesto: fracción máxima del disponible que un club
    // compromete en una sola operación.
    maxSingleOperationBudgetShare: 0.45,
  };

  // =====================================================================
  // 8. Presupuesto interno de plantilla (NO salary cap)
  // =====================================================================
  const BUDGET = {
    policyVersion: 'simulated-cycle-budget-v1',
    // La referencia de nómina de apertura se congela ANTES de que expiren
    // contratos (sección 16 del prompt): si se recalculara después de
    // liberar media plantilla, el presupuesto se hundiría en espiral.
    // Multiplicador sobre esa referencia congelada.
    openingPayrollMultiplierMin: 1.10,
    openingPayrollMultiplierMax: 1.95,
    // Suelo de staging para un club sin nómina comprometida (mismo criterio
    // que MARKET-1) — hook documentado, no una señal económica aprobada.
    floorMinor: 20000000,
  };

  // =====================================================================
  // 9. Emergencia de plantilla
  // =====================================================================
  const EMERGENCY = {
    dataSource: 'simulated-emergency-roster-v1',
    ladder: ['promote-academy', 'sign-existing-free-agent', 'generate-emergency-player'],
    // Rango de atributos del jugador generado en último recurso: nivel
    // bajo/medio, nunca un refuerzo de calidad.
    attributeRange: { min: 6, max: 12 },
    ageMin: 19,
    ageMax: 28,
  };

  // =====================================================================
  // 10. Deuda: gateway comprobable, NUNCA un impago inventado
  // =====================================================================
  // Sección 11 del prompt: la economía completa sigue fuera de alcance. Sin
  // ledger real, el resultado por defecto es "no existe deuda confirmada",
  // con procedencia visible. `unknown` NUNCA se convierte en deuda.
  const PAYMENT_COMPLIANCE_DEFAULT = Object.freeze({
    status: 'confirmed-clear',
    provenance: 'no-payment-ledger-implemented',
    note: 'No existe ledger de pagos en esta entrega: el motor NUNCA inventa un impago (CYCLE-1, sección 11).',
  });

  // =====================================================================
  // 11. Calendario del verano
  // =====================================================================
  // `lastOfficialMatchDate`: la fecha más TARDÍA de los 36 clubes (ISO).
  // `targetSeasonKey`: temporada que va a empezar.
  // Devuelve la lista ORDENADA de fases con su fecha civil real.
  //
  // `renewals-and-free-agency` (y todo lo posterior) nunca cae antes del
  // primer día posterior al fin de los contratos de la temporada que
  // termina: una expiración orgánica no puede procesarse antes de que el
  // contrato haya vencido de verdad (sección 8, "endDate es inclusiva").
  function buildSummerSchedule(lastOfficialMatchDate, fromSeasonKey) {
    const d0 = LD().requireIsoDate(lastOfficialMatchDate, 'lastOfficialMatchDate');
    // Primer día posterior al fin de los contratos de la temporada que
    // termina (`endDate` es INCLUSIVA, sección 8 del prompt).
    const expiryDay = LD().addDays(LD().seasonWindow(fromSeasonKey).endDate, 1);
    const renewalOffset = PHASE_DAY_OFFSETS['renewals-and-free-agency'];
    const expiryIndex = CYCLE_PHASES.indexOf('renewals-and-free-agency');
    let cursor = null;
    return CYCLE_PHASES.filter((phaseId) => phaseId !== 'new-season-started').map((phaseId) => {
      const offset = PHASE_DAY_OFFSETS[phaseId];
      let date = LD().addDays(d0, offset);
      if (CYCLE_PHASES.indexOf(phaseId) >= expiryIndex) {
        // Las fases posteriores a la expiración conservan su SEPARACIÓN
        // relativa contada desde el día de expiración real, en vez de
        // apelotonarse todas en esa misma fecha.
        const fromExpiry = LD().addDays(expiryDay, offset - renewalOffset);
        if (LD().isAfter(fromExpiry, date)) date = fromExpiry;
      }
      // Dos fases pueden compartir fecha, pero el calendario del verano
      // NUNCA retrocede.
      if (cursor && LD().isBefore(date, cursor)) date = cursor;
      cursor = date;
      return { phaseId, date };
    });
  }

  const exportsObj = {
    CycleConfig: {
      CYCLE_CONFIG_VERSION,
      CYCLE_PHASES,
      PHASE_DAY_OFFSETS,
      SAME_DATE_EVENT_PRIORITY,
      INITIAL_CONTRACT_DURATION_WEIGHTS,
      NEW_CONTRACT_DURATION_WEIGHTS,
      RENEWAL,
      RETIREMENT,
      ACADEMY,
      POPULATION,
      CPU_PLANNING,
      BUDGET,
      EMERGENCY,
      PAYMENT_COMPLIANCE_DEFAULT,
      resolveInitialContractSeasons,
      buildSummerSchedule,
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
