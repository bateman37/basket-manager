// src/utils/CareerAge.js
// CYCLE-1 (DESIGN.md 9.22, BUG-CYCLE1-01) — API ÚNICA y PURA de edad de
// carrera. Convención del proyecto: identificadores en inglés, comentarios
// en español.
//
// Motivo de existir (BUG-CYCLE1-01): `Player.calculateAge()` usaba
// `new Date()` como referencia por defecto y el getter `player.age` heredaba
// ese comportamiento. En una carrera ficticia de 2036 un jugador seguía
// apareciendo (y siendo evaluado por la CPU) con su edad de 2026 — el reloj
// REAL del ordenador decidía una señal de simulación.
//
// Reglas permanentes desde CYCLE-1:
//  - toda edad usada por el juego se calcula contra la FECHA DE CARRERA
//    (`state.calendar.currentGameDateTime` o la fecha civil del hecho que
//    se está resolviendo), pasada SIEMPRE de forma explícita;
//  - `player.age` queda PROHIBIDO dentro del flujo de carrera (core, UI de
//    partida, seeders, retiro, mercado, planificación) y auditado
//    estáticamente en `scripts/test-cycle1.js`; sobrevive solo como getter
//    de compatibilidad externa para el "modo prueba" del motor;
//  - la fecha de referencia es OBLIGATORIA: no hay valor por defecto que
//    pueda caer en el reloj del sistema.
//
// Módulo puro: no conoce Player, ni `state`, ni el DOM.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('./LocalDate.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  // Normaliza a fecha civil ISO cualquier referencia admitida: string ISO
  // `YYYY-MM-DD` (fecha contractual) o `Date` del reloj de mundo del juego
  // (Calendar.js). NUNCA acepta `undefined`/`null`: sin fecha explícita no
  // hay edad de carrera posible.
  function requireCareerDate(reference, label) {
    if (reference === undefined || reference === null) {
      throw new Error(
        `CareerAge: falta la fecha de carrera "${label || 'referenceDate'}" — CYCLE-1 (BUG-CYCLE1-01) prohíbe `
        + 'calcular una edad sin fecha explícita (nunca se cae al reloj del sistema).',
      );
    }
    if (typeof reference === 'string') return LD().requireIsoDate(reference, label || 'referenceDate');
    if (reference instanceof Date) {
      if (Number.isNaN(reference.getTime())) {
        throw new Error(`CareerAge: la fecha de carrera "${label || 'referenceDate'}" es un Date inválido.`);
      }
      return LD().fromJsDate(reference);
    }
    throw new Error(
      `CareerAge: la fecha de carrera "${label || 'referenceDate'}" debe ser un string ISO YYYY-MM-DD o un Date `
      + `del reloj de mundo (recibido: ${typeof reference}).`,
    );
  }

  // Fecha de nacimiento admitida: `Date` (como la guarda `Player`) o string
  // ISO. `null`/ausente devuelve `null` (jugador sin fecha de nacimiento
  // conocida) — nunca 0 ni una edad inventada.
  function normalizeBirthDate(birthDate) {
    if (!birthDate) return null;
    if (typeof birthDate === 'string') {
      // Admite tanto `YYYY-MM-DD` como un ISO completo con hora.
      const dateOnly = birthDate.slice(0, 10);
      return LD().isValidIsoDate(dateOnly) ? dateOnly : null;
    }
    if (birthDate instanceof Date) {
      return Number.isNaN(birthDate.getTime()) ? null : LD().fromJsDate(birthDate);
    }
    return null;
  }

  // Edad CIVIL cumplida en `reference` (años completos). Pura, sin husos:
  // el día exacto del cumpleaños YA cuenta como cumplido.
  function ageOn(birthDate, reference, label) {
    const birthIso = normalizeBirthDate(birthDate);
    if (!birthIso) return null;
    const refIso = requireCareerDate(reference, label);
    const b = LD().parse(birthIso);
    const d = LD().parse(refIso);
    let age = d.year - b.year;
    if (d.month < b.month || (d.month === b.month && d.day < b.day)) age -= 1;
    return age;
  }

  // Misma función, recibiendo el jugador (duck typing sobre `birthDate`).
  function ageOnDate(player, reference, label) {
    if (!player) return null;
    return ageOn(player.birthDate, reference, label);
  }

  // Fecha de nacimiento que produce EXACTAMENTE `age` años cumplidos en
  // `reference`, conservando mes/día indicados (por defecto, el mismo
  // mes/día de la referencia) — usada por fixtures deterministas y por el
  // generador de newgens (BUG-CYCLE1-02) para no depender del reloj real.
  function birthDateForAgeOn(age, reference, monthDay) {
    const refIso = requireCareerDate(reference, 'referenceDate');
    const d = LD().parse(refIso);
    const month = monthDay ? monthDay.month : d.month;
    const day = monthDay ? monthDay.day : d.day;
    // Si el cumpleaños del año de referencia cae DESPUÉS de la fecha de
    // referencia, el jugador aún no lo ha cumplido: hay que restar un año
    // más para que la edad cumplida sea exactamente `age`.
    const birthdayAlreadyPassed = (month < d.month) || (month === d.month && day <= d.day);
    const year = d.year - age - (birthdayAlreadyPassed ? 0 : 1);
    const safeDay = Math.min(day, LD().daysInMonth(year, month));
    return LD().format(year, month, safeDay);
  }

  const exportsObj = {
    CareerAge: {
      requireCareerDate,
      normalizeBirthDate,
      ageOn,
      ageOnDate,
      birthDateForAgeOn,
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
