// src/core/League.js
// Entidad Liga y Calendario — ver DESIGN.md sección 3.1.
// Convención del proyecto: identificadores en inglés, comentarios en español.
//
// COMP-CORE-1 (DESIGN.md 10.13): esta clase deja de contener el algoritmo
// de round-robin/desempate — es ahora una FACHADA FINA que delega en el
// runner genérico `RoundRobinStageRunner` (`src/core/CompetitionRunners.js`),
// configurado aquí con los valores HISTÓRICOS de esta vertical (18 equipos
// exactos, 2/1 puntos, la secuencia de 5 pasos de desempate) — la MISMA
// config que ahora también declara `data/world/spain-2026.1.js` para el
// runtime productivo. Se conserva por dos motivos:
//  1. compatibilidad de scripts/tests históricos que construyen
//     `new League(teams, dateResolver)` directamente sin pasar por el
//     motor genérico (`CompetitionEngine`);
//  2. es la fachada que SÍ usa el runtime productivo (`game.js`) cuando el
//     engine ya construyó el runner — ver el 3er parámetro `runtimeOptions`.
// Nunca hay dos algoritmos: ambos caminos ejecutan `RoundRobinStageRunner`.
//
// Destino: `game.js` ya NO construye `new League()` directamente en la ruta
// productiva (retirado, ver CLAUDE.md/DESIGN.md 10.8) — la construye
// `CompetitionEngine`, que entrega aquí el runner ya vivo.

(function (global) {
  const RunnersCore = (typeof module !== 'undefined' && module.exports)
    ? require('./CompetitionRunners.js')
    : global.BasketManager;

  const { RoundRobinStageRunner } = RunnersCore;

  const TEAM_COUNT = 18;
  // Puntuación real FIBA/ACB — DESIGN.md 3.1: 2 puntos por victoria, 1 por
  // derrota. NO es el sistema 3-1-0 de fútbol. El contenido español declara
  // esta MISMA secuencia en su formato (`data/world/spain-2026.1.js`); se
  // conserva aquí también para la fachada histórica standalone.
  const WIN_POINTS = 2;
  const LOSS_POINTS = 1;

  // Criterio de desempate histórico (DESIGN.md 3.1, normativa real ACB) —
  // 5 pasos GENÉRICOS (ver CompetitionRunners.js: ningún paso se llama
  // "ACB" dentro del runner). Primera FEB declara la MISMA secuencia por
  // compatibilidad (documentado, nunca presentado como normativa nueva).
  const LEGACY_TIEBREAK_STEPS = [
    { type: 'group-head-to-head-balance' },
    { type: 'group-head-to-head-point-diff' },
    { type: 'overall-point-diff' },
    { type: 'overall-points-for' },
    { type: 'overall-quotient-sum' },
  ];

  // --- Liga ---

  class League {
    // `dateResolver` (opcional, DESIGN.md 3.3): `(round, matchIndexInRound,
    // matchesInRound, totalRounds) => Date`. `runtimeOptions` (opcional,
    // COMP-CORE-1): `{ runner, entriesByParticipantId }` — cuando el
    // `CompetitionEngine` ya construyó el `RoundRobinStageRunner` real
    // (ruta productiva), esta fachada solo lo envuelve; sin él, construye
    // uno igual que siempre (scripts/tests históricos).
    constructor(teams, dateResolver, runtimeOptions) {
      const opts = runtimeOptions || {};
      this.teams = teams;
      this._teamsById = new Map(teams.map((t) => [t.id, t]));
      this.runner = opts.runner || new RoundRobinStageRunner({
        stageId: opts.stageId || null,
        competitionDefinitionId: opts.competitionDefinitionId || null,
        competitionEditionId: opts.competitionEditionId || null,
        stageKey: opts.stageKey || null,
        participants: teams.map((t) => ({ id: t.id })),
        entriesByParticipantId: opts.entriesByParticipantId || null,
        legs: 2,
        pointsWin: WIN_POINTS,
        pointsLoss: LOSS_POINTS,
        tiebreakSteps: LEGACY_TIEBREAK_STEPS,
        requireExactParticipantCount: TEAM_COUNT,
        dateResolver: dateResolver
          ? (meta) => dateResolver(meta.round, meta.matchIndexInRound, meta.matchesInRound, meta.totalRounds)
          : null,
        resolveParticipant: (id) => this._teamsById.get(id),
      });
      this.totalRounds = this.runner.totalRounds;
      // Vista legacy ESTABLE (misma identidad de objeto durante toda la
      // vida de la Liga) — el adaptador de UI añade aquí `homeTeam`/
      // `awayTeam` como vista TRANSITORIA (invariante COMP-CORE-1: el
      // runner solo guarda ids, nunca instancias Team).
      this.schedule = this.runner.matches.map((descriptor) => this._wrapMatch(descriptor));
      this._wrapperByDescriptorId = new Map(this.schedule.map((w) => [w._descriptorId, w]));
    }

    // WORLD-CALENDAR-1 (DESIGN.md 10.14): `status`/`result`/`date` pasan a
    // ser GETTERS sobre el descriptor real del runner (antes eran copias
    // refrescadas a mano en `resolveMatch`). Así la vista legacy puede
    // construirse BAJO DEMANDA desde un `stageId`/runner en cualquier
    // momento y nunca queda obsoleta si el partido se resolvió por otra vía
    // (la cola mundial resuelve un descriptor cada vez, sin pasar por esta
    // fachada) — `state.leagues` deja de ser un mapa fijo de estado.
    _wrapMatch(descriptor) {
      return {
        round: descriptor.round,
        homeTeam: this._teamsById.get(descriptor.homeParticipantId),
        awayTeam: this._teamsById.get(descriptor.awayParticipantId),
        get status() { return descriptor.status; },
        get result() { return descriptor.result; },
        get date() { return descriptor.scheduledDate; },
        get scheduledAt() { return descriptor.scheduledAt || null; },
        get timeZoneId() { return descriptor.timeZoneId || null; },
        // Identidad global estable (BUG-COMPCORE-03) — `matchStableId()`
        // en game.js usa este campo en vez de reconstruir un id local.
        id: descriptor.id,
        competitionDefinitionId: descriptor.competitionDefinitionId,
        competitionEditionId: descriptor.competitionEditionId,
        stageId: descriptor.stageId,
        stageKey: descriptor.stageKey,
        _descriptorId: descriptor.id,
      };
    }

    get currentRound() { return this.runner.currentRoundPointer; }

    get isSeasonComplete() { return this.runner.isComplete; }

    // Partidos de la jornada actual (pendientes hasta que se simulen).
    getCurrentRoundMatches() { return this.schedule.filter((w) => w.round === this.currentRound); }

    // CAL-1 (DESIGN.md 3.3): resuelve UN partido PENDIENTE concreto —
    // `match` es uno de los objetos de `this.schedule` (identidad estable).
    resolveMatch(match, config, resolveMatchOptions) {
      const options = resolveMatchOptions ? resolveMatchOptions(match) : undefined;
      // `status`/`result`/`date` del wrapper son getters sobre el
      // descriptor — no hay nada que copiar tras resolver.
      this.runner.resolveMatch(match._descriptorId, { matchEngineConfig: config, matchEngineOptions: options });
      return match;
    }

    // Partidos PENDIENTES con fecha estrictamente anterior a `beforeDateTime`.
    getPendingMatchesBefore(beforeDateTime) {
      const pendingIds = new Set(this.runner.getPendingMatchesBefore(beforeDateTime).map((d) => d.id));
      return this.schedule.filter((w) => pendingIds.has(w._descriptorId))
        .sort((a, b) => a.date - b.date);
    }

    resolveMatchesBefore(beforeDateTime, config, resolveMatchOptions) {
      return this.getPendingMatchesBefore(beforeDateTime).map((match) => this.resolveMatch(match, config, resolveMatchOptions));
    }

    // Simula TODOS los partidos PENDIENTES de la jornada actual de golpe.
    simulateNextRound(config, resolveMatchOptions) {
      if (this.isSeasonComplete) {
        throw new Error('La temporada ya ha terminado: no quedan jornadas por simular');
      }
      const matches = this.getCurrentRoundMatches().filter((match) => match.status === 'pending');
      matches.forEach((match) => this.resolveMatch(match, config, resolveMatchOptions));
      return matches;
    }

    // Clasificación ordenada aplicando el criterio de desempate (3.1) —
    // mismo shape legacy {team, played, wins, losses, pointsFor,
    // pointsAgainst, pointDifference, points, quotientSum}.
    getStandingsTable() {
      return this.runner.getStandings().map((s) => ({
        team: this._teamsById.get(s.participantId),
        played: s.played,
        wins: s.wins,
        losses: s.losses,
        pointsFor: s.pointsFor,
        pointsAgainst: s.pointsAgainst,
        pointDifference: s.pointDifference,
        points: s.points,
        quotientSum: s.quotientSum,
      }));
    }
  }

  // Compatibilidad de conveniencia (sin consumidores productivos, ver
  // cabecera) — construye una Liga desechable y devuelve su calendario.
  function generateSchedule(teams, dateResolver) {
    return new League(teams, dateResolver).schedule;
  }

  const exportsObj = {
    League, generateSchedule, TEAM_COUNT, WIN_POINTS, LOSS_POINTS, LEGACY_TIEBREAK_STEPS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
