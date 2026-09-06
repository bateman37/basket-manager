// src/utils/GameDateTime.js
// WORLD-CALENDAR-1 (DESIGN.md 10.14) — tiempo CANÓNICO del mundo:
// instantes exactos ISO 8601 en UTC (`....Z`) + huso IANA EXPLÍCITO para
// toda conversión a/desde componentes civiles. Utilidad PURA: no lee
// `state`, DOM, `Date.now()`, `Math.random()` ni el huso del proceso.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// SEPARADA de `LocalDate` a propósito (BUG-WORLDCALENDAR-03):
//  - `LocalDate` sigue representando FECHAS CIVILES `YYYY-MM-DD` sin hora
//    (plazos contractuales, ventanas, inscripciones — CONTRACT-1..CYCLE-1);
//  - `GameDateTime` representa INSTANTES exactos (cuándo empieza un
//    partido). Un instante solo se convierte a componentes civiles con un
//    `timeZoneId` declarado; nunca con el huso del ordenador.
//
// El bug que corrige: `Calendar.js` construía con `new Date(year, month,
// day)` y mutaba con `setDate`/`setHours`, así que el MISMO partido de 2026
// producía instantes distintos con `TZ=UTC`, `TZ=Europe/Madrid` o
// `TZ=America/New_York`. Aquí el instante se calcula SIEMPRE a partir de
// (componentes civiles + huso declarado), con `Intl.DateTimeFormat` como
// única fuente del desplazamiento real de ese huso en ese instante — sin
// dependencia externa ni tabla de zonas propia.

(function (global) {
  const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  // Caché de formateadores por huso — `Intl.DateTimeFormat` es caro de
  // construir y esta utilidad se llama miles de veces por temporada
  // (calendario completo de dos ligas + eliminatorias).
  const FORMATTER_CACHE = new Map();

  function zonedFormatter(timeZoneId) {
    let formatter = FORMATTER_CACHE.get(timeZoneId);
    if (formatter) return formatter;
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZoneId,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (err) {
      throw new Error(
        `GameDateTime: huso horario IANA inválido o no soportado por este entorno: "${timeZoneId}" `
        + `(${err.message}). Todo perfil de calendario debe declarar un "timeZoneId" real.`,
      );
    }
    FORMATTER_CACHE.set(timeZoneId, formatter);
    return formatter;
  }

  function pad(value, width) { return String(value).padStart(width, '0'); }

  function requireTimeZoneId(timeZoneId) {
    if (typeof timeZoneId !== 'string' || !timeZoneId.length) {
      throw new Error('GameDateTime: falta "timeZoneId" IANA explícito (nunca se asume el huso del proceso).');
    }
    zonedFormatter(timeZoneId); // valida ahora, no en la primera conversión
    return timeZoneId;
  }

  // Normaliza a instante ISO UTC canónico (`YYYY-MM-DDTHH:MM:SSZ`, sin
  // milisegundos). Acepta un string ISO con `Z`, un `Date` o un número de
  // epoch — cualquier otra cosa lanza de forma descriptiva.
  function requireInstant(value) {
    if (typeof value === 'string') {
      if (!INSTANT_PATTERN.test(value)) {
        throw new Error(
          `GameDateTime.requireInstant: "${value}" no es un instante ISO 8601 UTC terminado en "Z" `
          + '(formato esperado YYYY-MM-DDTHH:MM:SSZ).',
        );
      }
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) throw new Error(`GameDateTime.requireInstant: instante inexistente "${value}".`);
      return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new Error('GameDateTime.requireInstant: Date inválido.');
      return new Date(Math.floor(value.getTime() / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(Math.floor(value / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    throw new Error(
      `GameDateTime.requireInstant: valor no convertible a instante (${typeof value}). `
      + 'Se espera un ISO UTC "…Z", un Date o un epoch en ms.',
    );
  }

  function isInstant(value) {
    return typeof value === 'string' && INSTANT_PATTERN.test(value);
  }

  // Comparación por INSTANTE (nunca lexicográfica sobre fechas civiles de
  // husos distintos): <0, 0, >0.
  function compare(a, b) {
    const ta = Date.parse(requireInstant(a));
    const tb = Date.parse(requireInstant(b));
    return ta < tb ? -1 : (ta > tb ? 1 : 0);
  }

  function min(a, b) { return compare(a, b) <= 0 ? requireInstant(a) : requireInstant(b); }
  function max(a, b) { return compare(a, b) >= 0 ? requireInstant(a) : requireInstant(b); }

  // Componentes CIVILES de `instant` en `timeZoneId`.
  function toZonedParts(instant, timeZoneId) {
    const iso = requireInstant(instant);
    const zone = requireTimeZoneId(timeZoneId);
    const parts = zonedFormatter(zone).formatToParts(new Date(iso));
    const bag = {};
    parts.forEach((part) => { if (part.type !== 'literal') bag[part.type] = part.value; });
    return {
      year: Number(bag.year),
      month: Number(bag.month),
      day: Number(bag.day),
      hour: Number(bag.hour) % 24,
      minute: Number(bag.minute),
      second: Number(bag.second),
    };
  }

  // Desplazamiento (en minutos) de `timeZoneId` en el instante dado.
  function zoneOffsetMinutes(instant, timeZoneId) {
    const parts = toZonedParts(instant, timeZoneId);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return (asUtc - Date.parse(requireInstant(instant))) / 60000;
  }

  // Componentes civiles + huso -> instante UTC. Algoritmo estándar de dos
  // pasos: se estima con el desplazamiento del instante candidato y se
  // reajusta una vez (suficiente para cualquier huso real, incluidos los
  // cambios de hora de 30/45/60 minutos). Un instante civil INEXISTENTE
  // (el salto de primavera) se resuelve hacia adelante de forma
  // determinista; uno AMBIGUO (el retroceso de otoño) elige la primera
  // ocurrencia — ambos casos documentados, nunca dependientes del huso del
  // proceso.
  function fromZonedParts(parts, timeZoneId) {
    const zone = requireTimeZoneId(timeZoneId);
    const {
      year, month, day,
    } = parts;
    const hour = parts.hour || 0;
    const minute = parts.minute || 0;
    const second = parts.second || 0;
    if (![year, month, day].every((n) => Number.isInteger(n))) {
      throw new Error(`GameDateTime.fromZonedParts: componentes civiles incompletos (${JSON.stringify(parts)}).`);
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error(`GameDateTime.fromZonedParts: fecha civil inexistente ${year}-${month}-${day}.`);
    }
    const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    let candidate = new Date(naiveUtcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (let pass = 0; pass < 2; pass++) {
      const offset = zoneOffsetMinutes(candidate, zone);
      const nextMs = naiveUtcMs - offset * 60000;
      const next = new Date(nextMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
      if (next === candidate) return candidate;
      candidate = next;
    }
    return candidate;
  }

  // Fecha CIVIL (`YYYY-MM-DD`, el mismo formato de `LocalDate`) del
  // instante en el huso declarado — frontera oficial entre los dos
  // modelos de tiempo.
  function localDateAt(instant, timeZoneId) {
    const parts = toZonedParts(instant, timeZoneId);
    return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
  }

  function localTimeAt(instant, timeZoneId) {
    const parts = toZonedParts(instant, timeZoneId);
    return `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}`;
  }

  function requireLocalDate(localDate) {
    if (typeof localDate !== 'string' || !LOCAL_DATE_PATTERN.test(localDate)) {
      throw new Error(`GameDateTime: fecha civil inválida "${localDate}" (se espera YYYY-MM-DD).`);
    }
    return localDate;
  }

  function partsFromLocalDate(localDate) {
    const [year, month, day] = requireLocalDate(localDate).split('-').map(Number);
    return { year, month, day };
  }

  // Instante de las 00:00 LOCALES de una fecha civil en el huso declarado —
  // usado para ORDENAR un evento de fecha civil (plazo de mercado,
  // vencimiento) frente a un partido del mismo día: la decisión vence al
  // inicio del día, así que bloquea ANTES del partido (regla inclusiva ya
  // vigente en MARKET-1). No reescribe el `dueDate` del evento.
  function startOfLocalDay(localDate, timeZoneId) {
    return fromZonedParts({ ...partsFromLocalDate(localDate), hour: 0, minute: 0, second: 0 }, timeZoneId);
  }

  // Suma de DÍAS DE CALENDARIO en el huso declarado (nunca `24h` ciegas:
  // el día del cambio de hora tiene 23 o 25 horas reales). Conserva la
  // hora civil de partida.
  function addLocalDays(instantOrParts, days, timeZoneId) {
    const zone = requireTimeZoneId(timeZoneId);
    const parts = typeof instantOrParts === 'object' && instantOrParts !== null && instantOrParts.year !== undefined
      ? instantOrParts
      : toZonedParts(instantOrParts, zone);
    // Aritmética de días sobre el calendario civil vía UTC (sin husos):
    // `Date.UTC` normaliza meses/años sin depender del huso del proceso.
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, (parts.day || 1) + days));
    return fromZonedParts({
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: parts.hour || 0,
      minute: parts.minute || 0,
      second: parts.second || 0,
    }, zone);
  }

  // Suma de días sobre una FECHA CIVIL, devolviendo otra fecha civil —
  // equivalente a `LocalDate.addDays`, replicado aquí para no acoplar los
  // dos módulos (`LocalDate` no conoce husos).
  function addLocalDaysToLocalDate(localDate, days) {
    const parts = partsFromLocalDate(localDate);
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(shifted.getUTCDate(), 2)}`;
  }

  // FRONTERA legacy/UI ÚNICA: un `Date` real solo se construye aquí (y en
  // los getters legacy de `WorldCalendar`), nunca dentro de un cálculo de
  // calendario.
  function toJsDate(instant) { return new Date(requireInstant(instant)); }

  function fromJsDate(date) { return requireInstant(date); }

  const exportsObj = {
    GameDateTime: {
      INSTANT_PATTERN,
      requireInstant,
      isInstant,
      requireTimeZoneId,
      compare,
      min,
      max,
      fromZonedParts,
      toZonedParts,
      zoneOffsetMinutes,
      localDateAt,
      localTimeAt,
      startOfLocalDay,
      addLocalDays,
      addLocalDaysToLocalDate,
      requireLocalDate,
      toJsDate,
      fromJsDate,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
