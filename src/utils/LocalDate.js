// src/utils/LocalDate.js
// CONTRACT-1 (DESIGN.md 9.17) — Fechas CIVILES (date-only, `YYYY-MM-DD`)
// puras, sin husos horarios. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Motivo de existir (sección 6.3 del prompt de CONTRACT-1): una fecha
// contractual (firma, inicio, fin, vencimiento de una cuota) es un DÍA del
// calendario civil, no un instante. Convertirla a `new Date(iso)` la
// interpreta como medianoche UTC y en husos negativos se muestra el día
// anterior — exactamente el fallo que esta capa impide. Todo el dominio
// Contract trabaja con strings `YYYY-MM-DD` y estas funciones puras; el
// reloj de mundo del juego (Calendar.js, instancias de `Date` locales)
// solo se cruza aquí, en `fromJsDate()`.
//
// Módulo puro: no conoce Contract, ni el DOM, ni `state`.

(function (global) {
  const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isValidIsoDate(value) {
    if (typeof value !== 'string') return false;
    const match = ISO_DATE_RE.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > daysInMonth(year, month)) return false;
    return true;
  }

  function requireIsoDate(value, label) {
    if (!isValidIsoDate(value)) {
      throw new Error(`LocalDate: "${label || 'fecha'}" debe ser una fecha civil ISO YYYY-MM-DD válida (recibido: ${JSON.stringify(value)}).`);
    }
    return value;
  }

  function parse(value) {
    requireIsoDate(value, 'fecha');
    const match = ISO_DATE_RE.exec(value);
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function format(year, month, day) {
    return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function daysInMonth(year, month) {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  // Conversión ÚNICA desde el reloj de mundo del juego (instancias `Date`
  // construidas como fecha LOCAL en Calendar.js) — usa los componentes
  // locales a propósito, nunca `toISOString()` (que aplicaría UTC y podría
  // devolver el día anterior).
  function fromJsDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error('LocalDate.fromJsDate: se esperaba una instancia válida de Date.');
    }
    return format(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  // Vuelta al reloj local (medianoche local del día indicado) — solo para
  // presentación/ordenación junto a fechas del calendario del juego.
  function toJsDate(iso) {
    const { year, month, day } = parse(iso);
    return new Date(year, month - 1, day);
  }

  // Comparación lexicográfica: `YYYY-MM-DD` ordena igual como string que
  // como fecha, así que no hace falta convertir a número.
  function compare(a, b) {
    requireIsoDate(a, 'a');
    requireIsoDate(b, 'b');
    return a < b ? -1 : (a > b ? 1 : 0);
  }

  function isBefore(a, b) { return compare(a, b) < 0; }
  function isAfter(a, b) { return compare(a, b) > 0; }

  // Intervalo con AMBOS extremos INCLUSIVOS (sección 6.3: startDate y
  // endDate son inclusivas). `from`/`to` nulos = extremo abierto.
  function isWithinInclusive(value, from, to) {
    requireIsoDate(value, 'value');
    if (from && compare(value, from) < 0) return false;
    if (to && compare(value, to) > 0) return false;
    return true;
  }

  function addDays(iso, days) {
    const { year, month, day } = parse(iso);
    const jsDate = new Date(Date.UTC(year, month - 1, day));
    jsDate.setUTCDate(jsDate.getUTCDate() + days);
    return format(jsDate.getUTCFullYear(), jsDate.getUTCMonth() + 1, jsDate.getUTCDate());
  }

  // Suma de meses con recorte de fin de mes: 31-01 + 1 mes = 28-02 (o
  // 29-02 en bisiesto). Necesario para el calendario de pagos mensuales
  // (sección 6.5: "respeta las fechas civiles y fin de mes").
  function addMonths(iso, months) {
    const { year, month, day } = parse(iso);
    const totalMonths = (year * 12) + (month - 1) + months;
    const newYear = Math.floor(totalMonths / 12);
    const newMonth = (totalMonths % 12) + 1;
    const newDay = Math.min(day, daysInMonth(newYear, newMonth));
    return format(newYear, newMonth, newDay);
  }

  function endOfMonth(iso) {
    const { year, month } = parse(iso);
    return format(year, month, daysInMonth(year, month));
  }

  function daysBetween(from, to) {
    const a = parse(from);
    const b = parse(to);
    const msPerDay = 24 * 60 * 60 * 1000;
    const aUtc = Date.UTC(a.year, a.month - 1, a.day);
    const bUtc = Date.UTC(b.year, b.month - 1, b.day);
    return Math.round((bUtc - aUtc) / msPerDay);
  }

  // Duración en AÑOS de un contrato con endDate INCLUSIVA: de 2026-07-01 a
  // 2030-06-30 hay exactamente 4 años (no 4 años y un día). Se calcula
  // sobre el día SIGUIENTE al final inclusivo, que es la forma correcta de
  // medir "cuánto dura" un periodo cerrado.
  function inclusiveTermYears(startDate, endDate) {
    const exclusiveEnd = addDays(endDate, 1);
    return daysBetween(startDate, exclusiveEnd) / 365.2425;
  }

  // --- Temporadas deportivas ('2026-27') ---------------------------------
  // Una temporada cruza dos años naturales (sección 4.1, SMI: "la
  // validación debe ser capaz de trabajar por fechas/periodos, porque una
  // temporada deportiva cruza dos años naturales").
  const SEASON_KEY_RE = /^(\d{4})-(\d{2})$/;

  function isValidSeasonKey(value) {
    if (typeof value !== 'string') return false;
    const match = SEASON_KEY_RE.exec(value);
    if (!match) return false;
    const startYear = Number(match[1]);
    const expected = String((startYear + 1) % 100).padStart(2, '0');
    return match[2] === expected;
  }

  function seasonStartYear(seasonKey) {
    if (!isValidSeasonKey(seasonKey)) {
      throw new Error(`LocalDate: clave de temporada inválida "${seasonKey}" — se espera el formato "2026-27".`);
    }
    return Number(SEASON_KEY_RE.exec(seasonKey)[1]);
  }

  function seasonKeyFromStartYear(startYear) {
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  }

  function compareSeasonKeys(a, b) {
    const ya = seasonStartYear(a);
    const yb = seasonStartYear(b);
    return ya < yb ? -1 : (ya > yb ? 1 : 0);
  }

  function addSeasons(seasonKey, count) {
    return seasonKeyFromStartYear(seasonStartYear(seasonKey) + count);
  }

  // Ventana civil por defecto de una temporada deportiva europea: 1 de
  // julio del año de inicio a 30 de junio del siguiente. Es una convención
  // DE JUEGO (no una norma legal): la usan las fechas de contrato del
  // bootstrap y el calendario de pagos. Documentada en DESIGN.md 9.17.
  function seasonWindow(seasonKey) {
    const startYear = seasonStartYear(seasonKey);
    return { startDate: format(startYear, 7, 1), endDate: format(startYear + 1, 6, 30) };
  }

  // Temporadas (claves) cubiertas por un intervalo de fechas inclusivo.
  function seasonKeysCovered(startDate, endDate) {
    requireIsoDate(startDate, 'startDate');
    requireIsoDate(endDate, 'endDate');
    const keys = [];
    let year = parse(startDate).year - 1;
    const lastYear = parse(endDate).year;
    for (; year <= lastYear; year += 1) {
      const key = seasonKeyFromStartYear(year);
      const window = seasonWindow(key);
      // Se cuenta la temporada si el contrato se solapa con su ventana.
      if (!(compare(endDate, window.startDate) < 0 || compare(startDate, window.endDate) > 0)) {
        keys.push(key);
      }
    }
    return keys;
  }

  // Formato visible en español (`3 oct 2026`) — SOLO presentación, nunca
  // se guarda así (mismo criterio que Intl.NumberFormat en Money.js).
  function formatEs(iso) {
    if (!isValidIsoDate(iso)) return '—';
    return toJsDate(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const exportsObj = {
    LocalDate: {
      isValidIsoDate,
      requireIsoDate,
      parse,
      format,
      isLeapYear,
      daysInMonth,
      fromJsDate,
      toJsDate,
      compare,
      isBefore,
      isAfter,
      isWithinInclusive,
      addDays,
      addMonths,
      endOfMonth,
      daysBetween,
      inclusiveTermYears,
      isValidSeasonKey,
      seasonStartYear,
      seasonKeyFromStartYear,
      compareSeasonKeys,
      addSeasons,
      seasonWindow,
      seasonKeysCovered,
      formatEs,
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
