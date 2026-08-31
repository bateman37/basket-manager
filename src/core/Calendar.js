// src/core/Calendar.js
// Entidad Calendario — ver DESIGN.md sección 3.3. Asigna fecha real (Date)
// a todo partido de cualquier competición (Liga, Copa, Playoffs, Ascenso).
// CAL-1 (DESIGN.md 3.3.1 evolucionado): ya no solo fecha de jornada, sino
// fecha+hora real POR PARTIDO, vía `scheduleProfile` (config.calendar,
// MatchConfig.js) — el algoritmo de esta clase nunca tiene una franja/hora
// hardcodeada, todo sale de ese perfil. También aloja el reloj de mundo
// (`currentGameDateTime`, ver más abajo) — ver justificación en DESIGN.md
// 3.3.5: es la entidad que ya conoce el eje temporal de la temporada,
// compartida por las dos divisiones (`state.calendar`), así que es mejor
// candidata que añadir una propiedad más suelta a `state` en game.js.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  // Aplica un "slot" de scheduleProfile ({dayOffset, hour, minute}) sobre
  // una fecha ancla (normalmente medianoche) — desplaza el día y fija la
  // hora real de inicio del partido.
  function applySlot(anchorDate, slot) {
    const result = addDays(anchorDate, slot.dayOffset || 0);
    result.setHours(slot.hour, slot.minute || 0, 0, 0);
    return result;
  }

  // Hash determinista (FNV-1a) de una clave de texto a [0, 1) — CAL-1
  // necesita variedad horaria REPRODUCIBLE (misma temporada = mismo
  // calendario siempre) sin depender de Math.random(), para que generar
  // dos veces la misma temporada (mismo seasonStartYear+división+jornada)
  // dé siempre el mismo resultado (tests deterministas, DESIGN.md 3.3).
  function hashToUnitInterval(key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  // Elige un slot de una lista ponderada (`{..., weight}`) de forma
  // determinista a partir de `seedKey` — DESIGN.md 3.3.1: "permitido que
  // coincidan en el mismo horario, lo que no puede pasar es que TODOS
  // caigan en una única hora fija"; el peso relativo de cada slot es lo
  // único que decide su probabilidad, nunca un valor fijo en el algoritmo.
  function pickWeightedSlot(slots, seedKey) {
    const totalWeight = slots.reduce((sum, slot) => sum + slot.weight, 0);
    let target = hashToUnitInterval(seedKey) * totalWeight;
    for (let i = 0; i < slots.length; i++) {
      target -= slots[i].weight;
      if (target < 0) return slots[i];
    }
    return slots[slots.length - 1];
  }

  // WORLD-CORE-1 (ARCH-WORLD-03): sin fallback silencioso a ACB. Antes de
  // esta entrega, un `scheduleProfileId` desconocido heredaba en silencio el
  // perfil de 1ª división (`profiles['1ª']`) — una competición/paquete
  // desconocido NUNCA hereda el calendario de ACB por defecto. Quien llama
  // debe declarar explícitamente su `scheduleProfileId`
  // (`CompetitionDefinition.bindings.scheduleProfileId`, ver
  // `CompetitionCatalog.js`) — hoy sigue siendo el literal '1ª'/'2ª' de
  // `config.calendar.scheduleProfiles` (perfiles de contenido español,
  // WORLD-CALENDAR-1 los sustituirá por perfiles de paquete reales).
  function getScheduleProfile(config, scheduleProfileId) {
    const profiles = config.calendar.scheduleProfiles;
    const profile = profiles[scheduleProfileId];
    if (!profile) {
      throw new Error(
        `Calendar: no existe scheduleProfile para "${scheduleProfileId}" — una competición/paquete desconocido `
        + 'nunca hereda el calendario de ACB por defecto (ARCH-WORLD-03).',
      );
    }
    return profile;
  }

  // Jornada 17 (fin de la Copa, DESIGN.md 3.2.4) y la jornada siguiente
  // quedan excluidas de ser "jornada entre semana" para no complicar la
  // semana ya especial de la Copa — mismo número 17 que ya usa
  // Cup.CUP_TRIGGER_ROUND (duplicado aquí como literal, igual que ya hacía
  // cupRoundDates() más abajo con `leagueRoundDate(17)`, no una nueva
  // dependencia entre archivos).
  const CUP_TRIGGER_ROUND = 17;

  function isMidweekRound(round, totalRounds, midweekConfig) {
    if (!midweekConfig) return false;
    if (round === 1 || round === totalRounds) return false;
    if (round === CUP_TRIGGER_ROUND || round === CUP_TRIGGER_ROUND + 1) return false;
    return round % midweekConfig.everyNRounds === 0;
  }

  class Calendar {
    // `seasonStartYear`: año en que empieza la temporada (ej. 2026 para la
    // 2026-27). `config`: CONFIG_BASE (o equivalente), lee config.calendar.
    constructor(seasonStartYear, config) {
      this.seasonStartYear = seasonStartYear;
      this.config = config;
      this.seasonStartDate = new Date(
        seasonStartYear, config.calendar.seasonStartMonth, config.calendar.seasonStartDay,
      );
      // Reloj de mundo (DESIGN.md 3.3.5) — "ahora" de la partida, avanza de
      // evento en evento (nunca en tiempo real). Arranca en el inicio de
      // temporada, antes de que se haya jugado nada.
      this.currentGameDateTime = new Date(this.seasonStartDate);
    }

    // Avanza el reloj de mundo a `dateTime` — nunca hacia atrás (protección
    // por si dos rutas de resolución llaman fuera de orden; el reloj de
    // mundo es "lo más tarde que se ha resuelto algo", no un cursor que se
    // pueda mover libremente).
    advanceTo(dateTime) {
      if (!dateTime) return;
      if (!this.currentGameDateTime || dateTime > this.currentGameDateTime) {
        this.currentGameDateTime = dateTime;
      }
    }

    // Fecha ANCLA (medianoche, sin hora real) de la jornada N de liga
    // regular (1-indexed), separadas uniformemente por daysBetweenRounds —
    // sigue siendo la referencia de semana que usan cupRoundDates()/
    // titlePlayoffStartDate() y el propio scheduleProfile (dayOffset se
    // aplica sobre esta fecha). DESIGN.md 3.3.2: el hueco de la Copa entre
    // la jornada 17 y la 18 ocupa ESE MISMO intervalo, no lo amplía — por
    // eso la jornada 18 sigue la misma progresión lineal que el resto, sin
    // ningún desplazamiento extra por la Copa.
    leagueRoundDate(roundNumber) {
      return addDays(this.seasonStartDate, (roundNumber - 1) * this.config.calendar.daysBetweenRounds);
    }

    // CAL-1: fecha+hora REAL de un partido concreto de liga regular —
    // sustituye la "jornada = fecha única compartida" de antes de esta
    // entrega (DESIGN.md 3.3.1 anterior, ya corregido). `matchIndexInRound`/
    // `matchesInRound`: posición del partido dentro de su jornada (los usa
    // League.generateSchedule al construir el calendario). `totalRounds`:
    // para poder detectar la última jornada (horario unificado, 3.3.1).
    // `scheduleProfileId` (WORLD-CORE-1): antes documentado como "división"
    // — sigue recibiendo el mismo literal '1ª'/'2ª' que ya pasaba game.js
    // (`CompetitionDefinition.bindings.scheduleProfileId` de ACB/Primera FEB
    // hoy resuelve a esos mismos ids en `config.calendar.scheduleProfiles`),
    // pero ya nunca hereda un perfil ajeno en silencio (ver
    // `getScheduleProfile()`).
    leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, scheduleProfileId) {
      const profile = getScheduleProfile(this.config, scheduleProfileId);
      const anchor = this.leagueRoundDate(round);
      const seedKey = `${this.seasonStartYear}|${scheduleProfileId}|${round}|${matchIndexInRound}`;

      if (round === totalRounds) {
        return applySlot(anchor, profile.lastRoundSlot);
      }
      if (isMidweekRound(round, totalRounds, profile.midweek)) {
        const slot = pickWeightedSlot(profile.midweek.slots, `${seedKey}|midweek`);
        return applySlot(anchor, { dayOffset: profile.midweek.dayOffset, hour: slot.hour, minute: slot.minute });
      }
      const slot = pickWeightedSlot(profile.weekendSlots, seedKey);
      return applySlot(anchor, slot);
    }

    // Fechas+horas de las 3 rondas de Copa (cuartos, semifinal, final),
    // dentro del hueco entre la jornada 17 y la 18. DESIGN.md 3.3.2, reglas
    // duras: (1) el hueco total de Copa es SIEMPRE el mismo que separa la
    // jornada 17 de la 18 (daysBetweenRounds, no una duración derivada de
    // sumar cupRoundGapDays × rondas); (2) mínimo cupFinalCushionDays de
    // descanso real entre la final de Copa y la jornada 18.
    // `cupRoundGapDays` es solo la separación ORIENTATIVA entre rondas — se
    // comprime (nunca se alarga el hueco total ni se reduce el colchón
    // mínimo) cuando no cabe.
    //
    // Corrección de calibración (bug real de la sesión anterior): con
    // daysBetweenRounds=7 y cupRoundGapDays=3, la 3ª fecha caía en +9,
    // 2 días DESPUÉS de la jornada 18 (+7) en vez de antes. Ahora el hueco
    // disponible para las 3 fechas es siempre gapDays - cupFinalCushionDays,
    // y solo se comprime la separación entre rondas lo mínimo necesario
    // para que la final quepa dentro de ese margen (empezando por el hueco
    // cuartos->semis, luego semis->final si aún no cupiera).
    //
    // CAL-1: cada fecha lleva ahora hora real (`config.calendar.
    // knockoutKickoff`, ver comentario allí sobre por qué es un único
    // horario para toda la ronda, no variedad por partido).
    cupRoundDates() {
      const round17Date = this.leagueRoundDate(17);
      const { cupRoundGapDays, cupFinalCushionDays, daysBetweenRounds, knockoutKickoff } = this.config.calendar;
      const maxLastOffset = daysBetweenRounds - cupFinalCushionDays;

      const offsets = [cupRoundGapDays, 2 * cupRoundGapDays, 3 * cupRoundGapDays];
      if (offsets[2] > maxLastOffset) {
        offsets[2] = maxLastOffset;
      }
      if (offsets[1] >= offsets[2]) {
        offsets[1] = Math.max(1, offsets[2] - 1);
      }
      if (offsets[0] >= offsets[1]) {
        offsets[0] = Math.max(1, offsets[1] - 1);
      }
      return offsets.map((offset) => applySlot(round17Date, { dayOffset: offset, ...knockoutKickoff }));
    }

    // Resolver de fechas para un Bracket completo: `(roundIndex,
    // gameIndexInSeries) => Date`.
    //
    // Desviación deliberada de la firma sugerida en el prompt original
    // (`buildBracketDateResolver(startDate)`, sin `roundPatterns`): sin
    // conocer la duración máxima de cada ronda (el patrón de campo de cada
    // una: 1, 3 o 5 partidos posibles), una ronda fija a
    // `roundIndex * seriesRoundGapDays` podría empezar ANTES de que la
    // ronda anterior hubiera podido terminar en su desarrollo más largo
    // (ej. unos cuartos al mejor de 5 que llegasen al 5º partido). Por eso
    // esta versión precalcula el inicio real de cada ronda a partir de la
    // duración máxima (nº de partidos del patrón) de todas las rondas
    // anteriores — necesita `roundPatterns` (el mismo array que ya recibe
    // `new Bracket(entries, firstRoundPairing, roundPatterns)`) para poder
    // hacerlo. Comportamiento pedido (separación entre partidos de una
    // misma Series y entre rondas) preservado exactamente; solo cambia qué
    // parámetros necesita para calcularlo bien.
    //
    // CAL-1: cada fecha lleva ahora hora real (`knockoutKickoff`, ver nota
    // en cupRoundDates() sobre por qué es una hora única, no variedad por
    // serie — Bracket.js no expone qué Series concreta pide la fecha).
    buildBracketDateResolver(startDate, roundPatterns) {
      const { seriesGameGapDays, seriesRoundGapDays, knockoutKickoff } = this.config.calendar;
      const roundStartOffsets = [];
      let cursor = 0;
      roundPatterns.forEach((pattern, roundIndex) => {
        roundStartOffsets[roundIndex] = cursor;
        const maxGamesThisRound = pattern.length;
        cursor += (maxGamesThisRound - 1) * seriesGameGapDays + seriesRoundGapDays;
      });
      return (roundIndex, gameIndexInSeries) => applySlot(startDate, {
        dayOffset: roundStartOffsets[roundIndex] + gameIndexInSeries * seriesGameGapDays,
        ...knockoutKickoff,
      });
    }

    // Fecha de inicio del Playoff por el título (o del Playoff de ascenso,
    // que reutiliza esta misma fórmula con la fecha de fin de SU propia
    // liga regular — DESIGN.md 3.3.3, "startDate independiente del de 1ª
    // división"): fecha de la última jornada de liga regular +
    // seasonEndToPlayoffGapDays.
    titlePlayoffStartDate(leagueScheduleEndRoundDate) {
      return addDays(leagueScheduleEndRoundDate, this.config.calendar.seasonEndToPlayoffGapDays);
    }
  }

  const exportsObj = { Calendar };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
