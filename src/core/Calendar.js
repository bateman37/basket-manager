// src/core/Calendar.js
// Entidad Calendario — ver DESIGN.md sección 3.3. Asigna fecha real (Date)
// a todo partido de cualquier competición (Liga, Copa, Playoffs, Ascenso),
// hoy solo ordenados por número de jornada/ronda abstracto. Convención del
// proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
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
    }

    // Fecha de la jornada N de liga regular (1-indexed), separadas
    // uniformemente por daysBetweenRounds. DESIGN.md 3.3.2: el hueco de la
    // Copa entre la jornada 17 y la 18 ocupa ESE MISMO intervalo, no lo
    // amplía — por eso la jornada 18 sigue la misma progresión lineal que
    // el resto, sin ningún desplazamiento extra por la Copa.
    leagueRoundDate(roundNumber) {
      return addDays(this.seasonStartDate, (roundNumber - 1) * this.config.calendar.daysBetweenRounds);
    }

    // Fechas de las 3 rondas de Copa (cuartos, semifinal, final), dentro
    // del hueco entre la jornada 17 y la 18. DESIGN.md 3.3.2, reglas duras:
    // (1) el hueco total de Copa es SIEMPRE el mismo que separa la jornada
    // 17 de la 18 (daysBetweenRounds, no una duración derivada de sumar
    // cupRoundGapDays × rondas); (2) mínimo cupFinalCushionDays de descanso
    // real entre la final de Copa y la jornada 18. `cupRoundGapDays` es
    // solo la separación ORIENTATIVA entre rondas — se comprime (nunca se
    // alarga el hueco total ni se reduce el colchón mínimo) cuando no cabe.
    //
    // Corrección de calibración (bug real de la sesión anterior): con
    // daysBetweenRounds=7 y cupRoundGapDays=3, la 3ª fecha caía en +9,
    // 2 días DESPUÉS de la jornada 18 (+7) en vez de antes. Ahora el hueco
    // disponible para las 3 fechas es siempre gapDays - cupFinalCushionDays,
    // y solo se comprime la separación entre rondas lo mínimo necesario
    // para que la final quepa dentro de ese margen (empezando por el hueco
    // cuartos->semis, luego semis->final si aún no cupiera).
    cupRoundDates() {
      const round17Date = this.leagueRoundDate(17);
      const { cupRoundGapDays, cupFinalCushionDays, daysBetweenRounds } = this.config.calendar;
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
      return offsets.map((offset) => addDays(round17Date, offset));
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
    buildBracketDateResolver(startDate, roundPatterns) {
      const { seriesGameGapDays, seriesRoundGapDays } = this.config.calendar;
      const roundStartOffsets = [];
      let cursor = 0;
      roundPatterns.forEach((pattern, roundIndex) => {
        roundStartOffsets[roundIndex] = cursor;
        const maxGamesThisRound = pattern.length;
        cursor += (maxGamesThisRound - 1) * seriesGameGapDays + seriesRoundGapDays;
      });
      return (roundIndex, gameIndexInSeries) => addDays(
        startDate, roundStartOffsets[roundIndex] + gameIndexInSeries * seriesGameGapDays,
      );
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
