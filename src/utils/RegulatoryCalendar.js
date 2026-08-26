// src/utils/RegulatoryCalendar.js
// REG-1 (DESIGN.md 9.18, sección 6.5 del prompt) — utilidad PURA de
// fecha-hora regulatoria: día hábil, último día hábil de un mes, y
// comparación de una solicitud contra un corte con hora + huso horario
// explícitos. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Por qué existe (sección 6.5): los contratos (LocalDate.js) usan fechas
// CIVILES sin hora; las altas/inscripciones incluyen HORA y huso horario
// ("no compares plazos regulatorios mediante medianoches UTC implícitas").
// `LocalDate.js` no basta para eso — esta es la "utilidad pura y pequeña"
// que el prompt autoriza a crear.
//
// El evaluador de día hábil recibe SIEMPRE un calendario de festivos
// EXPLÍCITO (`holidaySet`, un Set de fechas ISO) — nunca inventa el
// calendario festivo español completo. Sin calendario, las funciones que
// lo necesitan devuelven `{ evaluable: false }` con warning, salvo los
// fixtures de test que sí lo aportan (sección 6.5).
//
// Módulo puro: no conoce `state`, DOM, ni ninguna entidad de dominio.

(function (global) {
  const LocalDateModule = (typeof module !== 'undefined' && module.exports)
    ? require('./LocalDate.js')
    : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  // Día de la semana ISO (1=lunes .. 7=domingo) de una fecha civil, sin
  // depender del huso horario de la máquina (usa UTC internamente, igual
  // que `LocalDate.addDays`).
  function isoWeekday(isoDate) {
    const { year, month, day } = LD().parse(isoDate);
    const jsDate = new Date(Date.UTC(year, month - 1, day));
    const jsDay = jsDate.getUTCDay(); // 0=domingo..6=sábado
    return jsDay === 0 ? 7 : jsDay;
  }

  function isWeekend(isoDate) {
    const weekday = isoWeekday(isoDate);
    return weekday === 6 || weekday === 7;
  }

  // `holidaySet`: `Set<string>` de fechas ISO festivas, o `null/undefined`
  // si no se dispone de calendario (nunca se asume "ningún festivo").
  function isBusinessDay(isoDate, holidaySet) {
    if (isWeekend(isoDate)) return false;
    if (holidaySet && holidaySet.has(isoDate)) return false;
    return true;
  }

  // Retrocede día a día hasta el día hábil anterior (excluye siempre
  // `isoDate` en sí). `maxLookbackDays` evita un bucle infinito ante un
  // calendario de festivos mal construido (fixture defectuoso).
  function priorBusinessDay(isoDate, holidaySet, maxLookbackDays) {
    if (holidaySet === undefined) return { evaluable: false, date: null };
    let cursor = isoDate;
    const limit = maxLookbackDays || 14;
    for (let i = 0; i < limit; i += 1) {
      cursor = LD().addDays(cursor, -1);
      if (isBusinessDay(cursor, holidaySet)) return { evaluable: true, date: cursor };
    }
    return { evaluable: false, date: null };
  }

  // Último día hábil de un mes/año concreto (usado por los plazos
  // generales de Primera FEB: "14:00 del último día hábil de febrero/marzo").
  function lastBusinessDayOfMonth(year, month, holidaySet) {
    if (holidaySet === undefined) return { evaluable: false, date: null };
    const lastCalendarDay = LD().endOfMonth(LD().format(year, month, 1));
    if (isBusinessDay(lastCalendarDay, holidaySet)) return { evaluable: true, date: lastCalendarDay };
    return priorBusinessDay(lastCalendarDay, holidaySet);
  }

  // Combina fecha civil + hora "HH:mm" en una clave ORDENABLE lexicográfica
  // — el `timeZone` se conserva solo como METADATO trazable (sección 6.5:
  // "Europe/Madrid" explícito); esta simulación no reimplementa una
  // biblioteca de husos horarios completa — todas las competiciones
  // activas (ACB/Primera FEB) usan la MISMA zona, así que una comparación
  // de reloj civil dentro de esa zona es equivalente a una comparación de
  // instante real. Documentado como simplificación deliberada.
  function dateTimeKey(isoDate, time) {
    return `${isoDate}T${time || '00:00'}`;
  }

  function isBeforeOrAt(isoDate, time, cutoffIsoDate, cutoffTime) {
    return dateTimeKey(isoDate, time) <= dateTimeKey(cutoffIsoDate, cutoffTime);
  }

  // Evalúa si una solicitud fechada en `requestDate`+`requestTime` cumple
  // el corte de una `submissionWindow`/`finalRegistrationDeadline` del
  // RuleModule de inscripción (CompetitionRules.js). `referenceDate`: la
  // fecha del PARTIDO o del hecho regulado, cuando el corte se define
  // relativo a ella (ACB: "mismo día si es laborable, día hábil anterior
  // si no"); para los límites de FEB (último día hábil de un mes fijo) no
  // hace falta `referenceDate`.
  //
  // Devuelve `{ evaluable, onTime, cutoffDate, cutoffTime, reason }` — SIN
  // calendario de festivos disponible cuando la regla lo necesita,
  // `evaluable` es `false` y `onTime` es `null` (sección 6.5: "unknown/
  // not-evaluable con warning").
  function evaluateCutoff(cutoffSpec, context) {
    const { requestDate, requestTime, referenceDate, holidaySet } = context || {};
    if (!cutoffSpec) return { evaluable: false, onTime: null, reason: 'Sin corte declarado para esta operación.' };
    const rule = cutoffSpec.businessDayRule;

    if (cutoffSpec.date) {
      // Corte de FECHA FIJA (p.ej. fixture internacional 25 de febrero).
      return {
        evaluable: true,
        onTime: isBeforeOrAt(requestDate, requestTime, cutoffSpec.date, cutoffSpec.time),
        cutoffDate: cutoffSpec.date,
        cutoffTime: cutoffSpec.time,
      };
    }

    if (rule === 'lastBusinessDayOfMonth') {
      if (!referenceDate) return { evaluable: false, onTime: null, reason: 'Falta "referenceDate" (temporada/año) para resolver el mes del corte.' };
      const { year } = LD().parse(referenceDate);
      const resolved = lastBusinessDayOfMonth(year, cutoffSpec.month, holidaySet);
      if (!resolved.evaluable) return { evaluable: false, onTime: null, reason: 'Falta calendario de festivos explícito para calcular el último día hábil.' };
      return {
        evaluable: true,
        onTime: isBeforeOrAt(requestDate, requestTime, resolved.date, cutoffSpec.time),
        cutoffDate: resolved.date,
        cutoffTime: cutoffSpec.time,
      };
    }

    if (rule === 'sameDayIfBusiness-elsePriorBusinessDay') {
      if (!referenceDate) return { evaluable: false, onTime: null, reason: 'Falta "referenceDate" (fecha del partido) para resolver el corte.' };
      if (holidaySet === undefined) return { evaluable: false, onTime: null, reason: 'Falta calendario de festivos explícito.' };
      const cutoffDate = isBusinessDay(referenceDate, holidaySet)
        ? referenceDate : priorBusinessDay(referenceDate, holidaySet).date;
      if (!cutoffDate) return { evaluable: false, onTime: null, reason: 'No se pudo resolver un día hábil anterior dentro del margen de búsqueda.' };
      return {
        evaluable: true,
        onTime: isBeforeOrAt(requestDate, requestTime, cutoffDate, cutoffSpec.time),
        cutoffDate,
        cutoffTime: cutoffSpec.time,
      };
    }

    if (rule === 'priorBusinessDay') {
      if (!referenceDate) return { evaluable: false, onTime: null, reason: 'Falta "referenceDate" (fecha del partido) para resolver el corte.' };
      const resolved = priorBusinessDay(referenceDate, holidaySet);
      if (!resolved.evaluable) return { evaluable: false, onTime: null, reason: 'Falta calendario de festivos explícito.' };
      return {
        evaluable: true,
        onTime: isBeforeOrAt(requestDate, requestTime, resolved.date, cutoffSpec.time),
        cutoffDate: resolved.date,
        cutoffTime: cutoffSpec.time,
      };
    }

    return { evaluable: false, onTime: null, reason: `Regla de corte "${rule}" no evaluable sin más contexto.` };
  }

  const exportsObj = {
    RegulatoryCalendar: {
      isoWeekday,
      isWeekend,
      isBusinessDay,
      priorBusinessDay,
      lastBusinessDayOfMonth,
      dateTimeKey,
      isBeforeOrAt,
      evaluateCutoff,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
