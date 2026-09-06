// src/core/CompetitionScheduleService.js
// WORLD-CALENDAR-1 (DESIGN.md 10.14) — algoritmo GENÉRICO que convierte un
// `CompetitionScheduleDefinition` (contenido versionado) en los resolvers
// de fecha que exigen los runners de COMP-CORE-1. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Es el ÚNICO sitio que sabe programar fechas. No conoce:
//  - país, liga, división ni nombre visible de competición (ningún literal
//    de España/ACB/FEB/`1ª`/`2ª` — auditado en
//    `scripts/test-world-calendar1.js`);
//  - `state`, DOM, `Date.now()`, `Math.random()` ni el huso del proceso
//    (todo instante sale de `GameDateTime` con el `timeZoneId` DECLARADO
//    por el calendario, BUG-WORLDCALENDAR-03).
//
// Sustituye en la ruta productiva a `src/core/Calendar.js`
// (`leagueMatchDateTime`/`cupRoundDates`/`buildBracketDateResolver`/
// `titlePlayoffStartDate`), reproduciendo su calendario observable
// EXACTAMENTE (mismo hash determinista de slots, misma cadencia, mismos
// offsets) pero con el instante canónico en UTC y el huso explícito.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const GameDateTimeModule = isNode ? require('../utils/GameDateTime.js') : global.BasketManager;
  const ScheduleCatalogModule = isNode ? require('./CompetitionScheduleCatalog.js') : global.BasketManager;

  function GDT() { return GameDateTimeModule.GameDateTime; }
  function defaultCatalog() { return ScheduleCatalogModule.CompetitionScheduleCatalog; }

  // Hash determinista (FNV-1a) de una clave de texto a [0, 1) — MISMA
  // función que `Calendar.js` histórico: el calendario de una temporada
  // debe salir idéntico al de antes de esta entrega (invariante 11 del
  // prompt: "el calendario observable actual de la vertical española se
  // conserva") y ser reproducible sin `Math.random()`.
  function hashToUnitInterval(key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  // Elige un slot de una lista ponderada de forma determinista — misma
  // implementación que `Calendar.pickWeightedSlot`.
  function pickWeightedSlot(slots, seedKey) {
    const totalWeight = slots.reduce((sum, slot) => sum + slot.weight, 0);
    let target = hashToUnitInterval(seedKey) * totalWeight;
    for (let i = 0; i < slots.length; i++) {
      target -= slots[i].weight;
      if (target < 0) return slots[i];
    }
    return slots[slots.length - 1];
  }

  function isMidweekRound(round, totalRounds, midweek) {
    if (!midweek) return false;
    if (round === 1 || round === totalRounds) return false;
    if (midweek.excludedRounds && midweek.excludedRounds.indexOf(round) !== -1) return false;
    return round % midweek.everyNRounds === 0;
  }

  class CompetitionScheduleService {
    // `catalog`: `CompetitionScheduleCatalog` (inyectable para tests).
    constructor({ catalog } = {}) {
      this.catalog = catalog || defaultCatalog();
    }

    // Fecha CIVIL (`YYYY-MM-DD`) del ancla de temporada de un calendario
    // para el año de inicio dado.
    seasonAnchorLocalDate(definition, seasonStartYear) {
      if (!Number.isInteger(seasonStartYear)) {
        throw new Error('CompetitionScheduleService: "seasonStartYear" debe ser un año entero explícito.');
      }
      const { month, day } = definition.seasonAnchor;
      return `${String(seasonStartYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    // Instante del ancla de temporada (00:00 locales del huso declarado).
    seasonStartInstant(definition, seasonStartYear) {
      return GDT().startOfLocalDay(this.seasonAnchorLocalDate(definition, seasonStartYear), definition.timeZoneId);
    }

    // Desplazamiento en días MÁS TEMPRANO que cualquier plan de este
    // calendario puede aplicar sobre su ancla semanal (los slots de viernes
    // usan `dayOffset: -1`, la jornada intersemanal `-3`...). Derivado del
    // CONTENIDO, nunca un margen inventado.
    earliestDayOffset(definition) {
      let earliest = 0;
      definition.planKeys.forEach((planKey) => {
        const plan = definition.getPlan(planKey);
        if (plan.strategy !== 'round-robin-cadence') return;
        plan.params.weekendSlots.forEach((slot) => { earliest = Math.min(earliest, slot.dayOffset); });
        if (plan.params.midweek) earliest = Math.min(earliest, plan.params.midweek.dayOffset);
        earliest = Math.min(earliest, plan.params.lastRoundSlot.dayOffset);
      });
      return earliest;
    }

    // Instante en el que ABRE la ventana de la temporada: el ancla civil
    // desplazada al `dayOffset` más temprano posible. Es el arranque
    // correcto del CURSOR de una carrera — el ancla a secas no sirve,
    // porque la jornada 1 puede tener partidos en viernes (`dayOffset: -1`)
    // y un cursor situado en el ancla dejaría esos partidos DETRÁS de él
    // desde el minuto cero (invariante 5). El ancla sigue siendo la fecha
    // de "inicio de temporada" que se muestra y que usa el contexto de
    // entrenamiento; esto es solo el borde del calendario.
    seasonWindowStartInstant(definition, seasonStartYear) {
      const localDate = GDT().addLocalDaysToLocalDate(
        this.seasonAnchorLocalDate(definition, seasonStartYear), this.earliestDayOffset(definition),
      );
      return GDT().startOfLocalDay(localDate, definition.timeZoneId);
    }

    // Fecha CIVIL ancla de la jornada N (1-indexed) de un plan de
    // round-robin — la referencia semanal sobre la que se aplican los
    // `dayOffset` de cada slot (misma semántica que
    // `Calendar.leagueRoundDate`).
    roundAnchorLocalDate(definition, planKey, roundNumber, seasonStartYear) {
      const plan = definition.getPlan(planKey);
      if (plan.strategy !== 'round-robin-cadence') {
        throw new Error(
          `CompetitionScheduleService: el plan "${planKey}" de "${definition.id}" no es de cadencia round-robin, `
          + 'no puede servir de ancla de jornada.',
        );
      }
      const resolvedRound = roundNumber === 'last' ? plan.params.roundsCount : roundNumber;
      if (!Number.isFinite(resolvedRound) || resolvedRound < 1) {
        throw new Error(`CompetitionScheduleService: jornada de ancla inválida "${roundNumber}" en "${definition.id}".`);
      }
      return GDT().addLocalDaysToLocalDate(
        this.seasonAnchorLocalDate(definition, seasonStartYear),
        (resolvedRound - 1) * plan.params.daysBetweenRounds,
      );
    }

    // Ancla CIVIL de un plan de bracket — referencia PLANA a un plan de
    // round-robin (de esta misma definición o de otra ya registrada), más
    // un desplazamiento en días. El scheduler nunca sabe QUÉ competición
    // es la referenciada.
    bracketAnchorLocalDate(definition, plan, seasonStartYear) {
      const { anchor } = plan.params;
      const anchorDefinition = anchor.scheduleId
        ? this.catalog.requireSchedule(anchor.scheduleId)
        : definition;
      const base = this.roundAnchorLocalDate(anchorDefinition, anchor.planKey, anchor.round, seasonStartYear);
      return GDT().addLocalDaysToLocalDate(base, anchor.offsetDays);
    }

    // Offsets (en días, sobre el ancla) del PRIMER partido de cada ronda.
    bracketRoundStartOffsets(plan) {
      const p = plan.params;
      if (plan.params.offsetPolicy === 'compressed-window') {
        // Ventana FIJA entre dos jornadas de la competición ancla (misma
        // regla dura que `Calendar.cupRoundDates`): el hueco total nunca se
        // alarga y el colchón mínimo antes de la jornada siguiente nunca se
        // reduce; solo se comprime la separación entre rondas cuando no cabe.
        const maxLastOffset = p.windowDays - p.finalCushionDays;
        const offsets = [];
        for (let i = 1; i <= p.roundCount; i++) offsets.push(i * p.roundGapDays);
        if (offsets[offsets.length - 1] > maxLastOffset) offsets[offsets.length - 1] = maxLastOffset;
        for (let i = offsets.length - 2; i >= 0; i--) {
          if (offsets[i] >= offsets[i + 1]) offsets[i] = Math.max(1, offsets[i + 1] - 1);
        }
        return offsets;
      }
      // Cadencia por serie: cada ronda arranca cuando la anterior ya pudo
      // terminar en su desarrollo MÁS LARGO (nº de partidos del patrón de
      // campo), más la separación entre rondas — misma justificación que
      // `Calendar.buildBracketDateResolver`.
      const offsets = [];
      let cursor = 0;
      p.roundPatternLengths.forEach((length, index) => {
        offsets[index] = cursor;
        cursor += (length - 1) * p.seriesGameGapDays + p.seriesRoundGapDays;
      });
      return offsets;
    }

    // Construye el instante de un partido a partir de una fecha civil
    // ancla, un desplazamiento en días y un slot horario.
    _instantFor(definition, anchorLocalDate, dayOffset, slot) {
      const localDate = GDT().addLocalDaysToLocalDate(anchorLocalDate, dayOffset);
      const [year, month, day] = localDate.split('-').map(Number);
      const scheduledAt = GDT().fromZonedParts({
        year, month, day, hour: slot.hour, minute: slot.minute || 0, second: 0,
      }, definition.timeZoneId);
      return {
        scheduledAt,
        timeZoneId: definition.timeZoneId,
        scheduledLocalDate: localDate,
        scheduledLocalTime: `${String(slot.hour).padStart(2, '0')}:${String(slot.minute || 0).padStart(2, '0')}`,
        // Vista de COMPATIBILIDAD para motor/UI legacy — SIEMPRE derivada
        // de `scheduledAt`, nunca una segunda fuente (sección 7 del prompt).
        scheduledDate: GDT().toJsDate(scheduledAt),
        scheduleId: definition.id,
        scheduleVersion: definition.version,
      };
    }

    // ---------------------------------------------------------------------
    // Resolver para un plan de cadencia round-robin — firma que exige
    // `RoundRobinStageRunner`: `(meta) => scheduling`.
    // ---------------------------------------------------------------------
    buildRoundRobinResolver(definition, planKey, { seasonStartYear }) {
      const plan = definition.getPlan(planKey);
      if (plan.strategy !== 'round-robin-cadence') {
        throw new Error(
          `CompetitionScheduleService: el plan "${planKey}" de "${definition.id}" declara la estrategia `
          + `"${plan.strategy}", no válida para un runner de round-robin.`,
        );
      }
      const p = plan.params;
      return (meta) => {
        if (Number.isFinite(meta.totalRounds) && meta.totalRounds !== p.roundsCount) {
          throw new Error(
            `CompetitionScheduleService: el calendario "${definition.id}" declara ${p.roundsCount} jornadas para `
            + `"${planKey}", pero el formato genera ${meta.totalRounds} — calendario y formato deben coincidir `
            + '(nunca se ajusta uno de los dos en silencio).',
          );
        }
        const anchorLocalDate = this.roundAnchorLocalDate(definition, planKey, meta.round, seasonStartYear);
        // MISMA semilla que `Calendar.js` histórico (temporada|calendario|
        // jornada|posición en la jornada) — el calendario observable no
        // cambia con esta entrega.
        const seedKey = `${seasonStartYear}|${definition.id}|${meta.round}|${meta.matchIndexInRound}`;
        if (meta.round === p.roundsCount) {
          return this._instantFor(definition, anchorLocalDate, p.lastRoundSlot.dayOffset, p.lastRoundSlot);
        }
        if (isMidweekRound(meta.round, p.roundsCount, p.midweek)) {
          const slot = pickWeightedSlot(p.midweek.slots, `${seedKey}|midweek`);
          return this._instantFor(definition, anchorLocalDate, p.midweek.dayOffset, slot);
        }
        const slot = pickWeightedSlot(p.weekendSlots, seedKey);
        return this._instantFor(definition, anchorLocalDate, slot.dayOffset, slot);
      };
    }

    // ---------------------------------------------------------------------
    // Resolver para un plan de bracket — firma que exige
    // `BracketStageRunner`: `(roundIndex, gameIndexInSeries) => scheduling`.
    // ---------------------------------------------------------------------
    buildBracketResolver(definition, planKey, { seasonStartYear }) {
      const plan = definition.getPlan(planKey);
      if (plan.strategy !== 'bracket-offsets') {
        throw new Error(
          `CompetitionScheduleService: el plan "${planKey}" de "${definition.id}" declara la estrategia `
          + `"${plan.strategy}", no válida para un runner de bracket.`,
        );
      }
      const p = plan.params;
      const anchorLocalDate = this.bracketAnchorLocalDate(definition, plan, seasonStartYear);
      const roundStartOffsets = this.bracketRoundStartOffsets(plan);
      const gameGapDays = p.offsetPolicy === 'compressed-window' ? 0 : p.seriesGameGapDays;
      return (roundIndex, gameIndexInSeries) => {
        // `roundIndexOffset`: fases que comparten el MISMO tramo de fechas
        // que la anterior (la Final Four continúa la numeración de sus
        // propios cuartos) — dato del plan, nunca una rama por nombre de
        // fase en el código.
        const effectiveRoundIndex = roundIndex + p.roundIndexOffset;
        const roundOffset = roundStartOffsets[effectiveRoundIndex];
        if (roundOffset === undefined) {
          throw new Error(
            `CompetitionScheduleService: el plan "${planKey}" de "${definition.id}" no declara offset para la `
            + `ronda ${effectiveRoundIndex} (declara ${roundStartOffsets.length}).`,
          );
        }
        return this._instantFor(definition, anchorLocalDate, roundOffset + (gameIndexInSeries || 0) * gameGapDays, p.kickoff);
      };
    }

    // Resolver genérico por `runnerType` — usado por el proveedor que
    // recibe `CompetitionEngine.setDateResolverProvider()`.
    buildResolver({
      scheduleId, planKey, runnerType, seasonStartYear,
    }) {
      const definition = this.catalog.requireSchedule(scheduleId);
      if (runnerType === 'round-robin') return this.buildRoundRobinResolver(definition, planKey, { seasonStartYear });
      if (runnerType === 'bracket') return this.buildBracketResolver(definition, planKey, { seasonStartYear });
      throw new Error(`CompetitionScheduleService: runnerType desconocido "${runnerType}" para el plan "${planKey}".`);
    }

    // Proveedor GENÉRICO para `CompetitionEngine.setDateResolverProvider()`
    // (sección 8 del prompt): resuelve el calendario desde
    // `edition.scheduleProfileId` + `template.key`. Nunca ramifica por
    // competición, país, división ni nombre visible; una edición sin
    // calendario declarado no recibe fechas (y una fase sin plan FALLA, en
    // vez de heredar otro perfil).
    buildDateResolverProvider({ seasonStartYearForEdition }) {
      if (typeof seasonStartYearForEdition !== 'function') {
        throw new Error(
          'CompetitionScheduleService.buildDateResolverProvider: falta "seasonStartYearForEdition(edition)" '
          + 'explícito (el año de inicio de temporada llega de la carrera, nunca del reloj del sistema).',
        );
      }
      return ({ template, edition }) => {
        if (!edition.scheduleProfileId) return null;
        return this.buildResolver({
          scheduleId: edition.scheduleProfileId,
          planKey: template.key,
          runnerType: template.runnerType,
          seasonStartYear: seasonStartYearForEdition(edition),
        });
      };
    }
  }

  const exportsObj = {
    CompetitionScheduleService,
    // Expuestas para las pruebas dirigidas de determinismo (mismo hash que
    // el `Calendar.js` histórico).
    scheduleHashToUnitInterval: hashToUnitInterval,
    schedulePickWeightedSlot: pickWeightedSlot,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
