// src/core/CompetitionRunners.js
// COMP-CORE-1 (DESIGN.md 10.13) — runners GENÉRICOS que ejecutan de verdad
// una fase de competición: `RoundRobinStageRunner` (liga con vueltas,
// desempate configurable, bye explícito para número impar de participantes)
// y `BracketStageRunner` (eliminatoria a mejor de N, patrón de campo
// configurable, avance FIJO entre rondas). Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Ninguno de los dos runners conoce geografía, nombre de país/liga ni ids de
// España (invariante 10) — auditado en `scripts/test-comp-core1.js`. Ambos:
//  - guardan SOLO ids en su estado (invariante 20): las instancias Team se
//    resuelven vía `resolveParticipant(id)` justo en la frontera con
//    `MatchEngine.simulateMatch`, nunca antes;
//  - crean el descriptor de partido (id global + fecha real) ANTES de
//    simular (BUG-COMPCORE-03) — consultar el siguiente partido pendiente
//    nunca consume RNG ni resuelve nada;
//  - rechazan resolver dos veces el mismo partido;
//  - no leen `state`/DOM/reloj de sistema — toda fecha llega de un
//    `dateResolver` inyectado, toda config llega ya validada por quien
//    construye el runner (`CompetitionEngine`).

(function (global) {
  const MatchEngineCore = (typeof module !== 'undefined' && module.exports)
    ? require('./MatchEngine.js')
    : global.BasketManager;

  const { simulateMatch } = MatchEngineCore;

  // =========================================================================
  // 1. round-robin — algoritmo del círculo, generalizado a N participantes
  //    (par o impar, con bye EXPLÍCITO — nunca un partido contra un equipo
  //    falso) y a criterios de desempate configurables por CONTENIDO.
  // =========================================================================

  // Genera las rondas de UNA vuelta simple: cada participante juega
  // exactamente una vez contra cada rival (o descansa, si hay bye), en
  // `n-1` rondas (n = participantes reales + 1 hueco de bye si n es impar).
  // Devuelve un array de rondas, cada una un array de { home, away } (ids,
  // o `null` en el hueco de bye — NUNCA se genera un partido con `null`).
  function generateSingleRoundRobinPairings(participantIds) {
    const ids = [...participantIds];
    const hasBye = ids.length % 2 !== 0;
    if (hasBye) ids.push(null); // hueco de bye — nunca un participante falso
    const n = ids.length;
    const roundsCount = n - 1;
    const half = n / 2;
    const fixed = ids[0];
    let rotating = ids.slice(1);
    const rounds = [];
    for (let round = 0; round < roundsCount; round++) {
      const positions = [fixed, ...rotating];
      const pairs = [];
      for (let i = 0; i < half; i++) {
        const a = positions[i];
        const b = positions[n - 1 - i];
        if (a === null || b === null) continue; // bye explícito: sin partido
        const [home, away] = round % 2 === 0 ? [a, b] : [b, a];
        pairs.push({ home, away });
      }
      rounds.push(pairs);
      rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)];
    }
    return rounds;
  }

  // --- Criterios de desempate GENÉRICOS (el contenido declara el orden) ---
  function mutualStatsAgainstGroup(participantId, groupIds, headToHead) {
    const opponents = headToHead.get(participantId) || new Map();
    let wins = 0; let losses = 0; let pointsFor = 0; let pointsAgainst = 0;
    groupIds.forEach((opponentId) => {
      if (opponentId === participantId) return;
      const stats = opponents.get(opponentId);
      if (!stats) return;
      wins += stats.wins; losses += stats.losses; pointsFor += stats.pointsFor; pointsAgainst += stats.pointsAgainst;
    });
    return {
      wins, losses, pointsFor, pointsAgainst,
    };
  }

  // Cada evaluador: (participantId, groupIds, ctx:{headToHead, standings}) => número (más alto = mejor puesto).
  const TIEBREAK_STEP_EVALUATORS = {
    'group-head-to-head-balance': (id, group, ctx) => {
      const s = mutualStatsAgainstGroup(id, group, ctx.headToHead);
      return s.wins - s.losses;
    },
    'group-head-to-head-point-diff': (id, group, ctx) => {
      const s = mutualStatsAgainstGroup(id, group, ctx.headToHead);
      return s.pointsFor - s.pointsAgainst;
    },
    'overall-point-diff': (id, _group, ctx) => ctx.standings.get(id).pointDifference,
    'overall-points-for': (id, _group, ctx) => ctx.standings.get(id).pointsFor,
    'overall-quotient-sum': (id, _group, ctx) => ctx.standings.get(id).quotientSum,
  };

  function resolveTiebreakEvaluator(stepDescriptor) {
    const evaluator = TIEBREAK_STEP_EVALUATORS[stepDescriptor.type];
    if (!evaluator) {
      throw new Error(`RoundRobinStageRunner: tipo de criterio de desempate desconocido "${stepDescriptor.type}".`);
    }
    return evaluator;
  }

  function groupByScoreDescending(scoredIds) {
    const byScore = new Map();
    scoredIds.forEach(({ id, score }) => {
      if (!byScore.has(score)) byScore.set(score, []);
      byScore.get(score).push(id);
    });
    return [...byScore.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids);
  }

  function runTiebreakCycle(ids, ctx, evaluators, stepIndex, cycleStartSize) {
    if (ids.length <= 1) return ids;
    if (stepIndex >= evaluators.length) {
      return resolveTiedGroup(ids, ctx, evaluators, cycleStartSize);
    }
    const evaluator = evaluators[stepIndex];
    const scored = ids.map((id) => ({ id, score: evaluator(id, ids, ctx) }));
    const groups = groupByScoreDescending(scored);
    const result = [];
    groups.forEach((subgroup) => {
      if (subgroup.length === 1) result.push(subgroup[0]);
      else result.push(...runTiebreakCycle(subgroup, ctx, evaluators, stepIndex + 1, cycleStartSize));
    });
    return result;
  }

  // Grupo empatado sin separación tras un ciclo completo: se repite el
  // ciclo entero desde el paso 1 (mini-liga recursiva) — si el ciclo
  // ANTERIOR ya tenía exactamente este mismo tamaño de grupo, es un empate
  // genuinamente irresoluble con estos criterios y se corta (orden estable,
  // nunca aleatorio) para no reintentar en bucle infinito.
  function resolveTiedGroup(ids, ctx, evaluators, previousCycleSize) {
    if (ids.length <= 1) return ids;
    if (previousCycleSize !== undefined && ids.length === previousCycleSize) return ids;
    return runTiebreakCycle(ids, ctx, evaluators, 0, ids.length);
  }

  function buildOrderedStandings(participantIds, standingsMap, headToHead, tiebreakSteps) {
    const evaluators = tiebreakSteps.map(resolveTiebreakEvaluator);
    const byPoints = new Map();
    participantIds.forEach((id) => {
      const pts = standingsMap.get(id).points;
      if (!byPoints.has(pts)) byPoints.set(pts, []);
      byPoints.get(pts).push(id);
    });
    const pointsGroups = [...byPoints.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids);
    const ctx = { headToHead, standings: standingsMap };
    const orderedIds = [];
    pointsGroups.forEach((group) => {
      if (group.length === 1) orderedIds.push(group[0]);
      else orderedIds.push(...resolveTiedGroup(group, ctx, evaluators));
    });
    return orderedIds.map((id) => standingsMap.get(id));
  }

  function createEmptyStanding(participantId) {
    return {
      participantId, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, pointDifference: 0, points: 0, quotientSum: 0,
    };
  }

  class RoundRobinStageRunner {
    constructor(config = {}) {
      const {
        stageId = null, competitionDefinitionId = null, competitionEditionId = null, stageKey = null,
        participants, entriesByParticipantId, legs = 2, pointsWin, pointsLoss, tiebreakSteps,
        requireExactParticipantCount = null, dateResolver = null,
        resolveParticipant, onRoundCompleted = null, onStageCompleted = null,
      } = config;
      if (!Array.isArray(participants) || participants.length < 2) {
        throw new Error('RoundRobinStageRunner: "participants" exige al menos 2 elementos {id}.');
      }
      if (requireExactParticipantCount !== null && participants.length !== requireExactParticipantCount) {
        throw new Error(
          `RoundRobinStageRunner: este formato exige exactamente ${requireExactParticipantCount} participantes `
          + `(recibidos: ${participants.length}).`,
        );
      }
      if (![1, 2].includes(legs)) throw new Error('RoundRobinStageRunner: "legs" debe ser 1 o 2.');
      if (!Number.isFinite(pointsWin) || !Number.isFinite(pointsLoss)) {
        throw new Error('RoundRobinStageRunner: "pointsWin"/"pointsLoss" deben ser numéricos explícitos.');
      }
      if (!Array.isArray(tiebreakSteps) || !tiebreakSteps.length) {
        throw new Error('RoundRobinStageRunner: "tiebreakSteps" no puede estar vacío.');
      }
      if (typeof resolveParticipant !== 'function') {
        throw new Error('RoundRobinStageRunner: falta "resolveParticipant(id)" explícito.');
      }
      tiebreakSteps.forEach(resolveTiebreakEvaluator); // valida tipos ahora, no en el primer resolveMatch

      this.stageId = stageId;
      this.competitionDefinitionId = competitionDefinitionId;
      this.competitionEditionId = competitionEditionId;
      this.stageKey = stageKey;
      this.participantIds = participants.map((p) => p.id);
      this.pointsWin = pointsWin;
      this.pointsLoss = pointsLoss;
      this.tiebreakSteps = tiebreakSteps;
      this.dateResolver = dateResolver;
      this.resolveParticipant = resolveParticipant;
      this.onRoundCompleted = onRoundCompleted;
      this.onStageCompleted = onStageCompleted;
      const entryIdFor = (id) => (entriesByParticipantId && entriesByParticipantId.get ? entriesByParticipantId.get(id) : null) || null;

      const firstLegRounds = generateSingleRoundRobinPairings(this.participantIds);
      this.totalRounds = firstLegRounds.length * legs;
      this._currentRoundPointer = 1;
      this._firedRoundCompleted = new Set();
      this._stageCompletedFired = false;

      this.matches = [];
      this._matchesById = new Map();

      let roundNumber = 1;
      const appendLeg = (pairsPerRound, swapHomeAway) => {
        pairsPerRound.forEach((pairs) => {
          pairs.forEach(({ home, away }, matchIndexInRound) => {
            const homeId = swapHomeAway ? away : home;
            const awayId = swapHomeAway ? home : away;
            const meta = {
              round: roundNumber, matchIndexInRound, matchesInRound: pairs.length, totalRounds: this.totalRounds,
            };
            const scheduledDate = this.dateResolver ? this.dateResolver(meta) : null;
            const descriptor = {
              id: `match:${this.stageId || 'standalone'}:r${roundNumber}:${homeId}:${awayId}`,
              competitionDefinitionId: this.competitionDefinitionId,
              competitionEditionId: this.competitionEditionId,
              stageId: this.stageId,
              stageKey: this.stageKey,
              round: roundNumber,
              matchIndexInRound,
              homeParticipantId: homeId,
              awayParticipantId: awayId,
              homeEntryId: entryIdFor(homeId),
              awayEntryId: entryIdFor(awayId),
              status: 'pending',
              scheduledDate,
              result: null,
            };
            this.matches.push(descriptor);
            this._matchesById.set(descriptor.id, descriptor);
          });
          roundNumber += 1;
        });
      };
      appendLeg(firstLegRounds, false);
      if (legs === 2) appendLeg(firstLegRounds, true);

      this._standings = new Map();
      this.participantIds.forEach((id) => this._standings.set(id, createEmptyStanding(id)));
      this._headToHead = new Map();
      this.participantIds.forEach((id) => this._headToHead.set(id, new Map()));
    }

    get currentRoundPointer() { return this._currentRoundPointer; }

    get isComplete() { return this._currentRoundPointer > this.totalRounds; }

    getMatchById(id) { return this._matchesById.get(id) || null; }

    getCurrentRoundMatches() { return this.matches.filter((m) => m.round === this._currentRoundPointer); }

    // Partidos PENDIENTES con fecha estrictamente anterior a `beforeDateTime`,
    // en orden cronológico — consultar no resuelve ni muta nada.
    getPendingMatchesBefore(beforeDateTime) {
      return this.matches
        .filter((m) => m.status === 'pending' && m.scheduledDate && m.scheduledDate < beforeDateTime)
        .sort((a, b) => a.scheduledDate - b.scheduledDate);
    }

    _recordHeadToHead(homeId, awayId, homeScore, awayScore) {
      const opponents = this._headToHead.get(homeId);
      const existing = opponents.get(awayId) || {
        wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0,
      };
      existing.pointsFor += homeScore;
      existing.pointsAgainst += awayScore;
      if (homeScore > awayScore) existing.wins += 1; else existing.losses += 1;
      opponents.set(awayId, existing);
    }

    _recordResult(homeId, awayId, homeScore, awayScore) {
      const updateSide = (id, pointsFor, pointsAgainst) => {
        const standing = this._standings.get(id);
        standing.played += 1;
        standing.pointsFor += pointsFor;
        standing.pointsAgainst += pointsAgainst;
        standing.pointDifference = standing.pointsFor - standing.pointsAgainst;
        standing.quotientSum += pointsAgainst > 0 ? pointsFor / pointsAgainst : pointsFor;
        if (pointsFor > pointsAgainst) { standing.wins += 1; standing.points += this.pointsWin; } else { standing.losses += 1; standing.points += this.pointsLoss; }
      };
      updateSide(homeId, homeScore, awayScore);
      updateSide(awayId, awayScore, homeScore);
      this._recordHeadToHead(homeId, awayId, homeScore, awayScore);
      this._recordHeadToHead(awayId, homeId, awayScore, homeScore);
    }

    _advanceRoundPointer() {
      while (this._currentRoundPointer <= this.totalRounds) {
        const roundMatches = this.matches.filter((m) => m.round === this._currentRoundPointer);
        if (roundMatches.length === 0 || !roundMatches.every((m) => m.status === 'played')) break;
        if (!this._firedRoundCompleted.has(this._currentRoundPointer)) {
          this._firedRoundCompleted.add(this._currentRoundPointer);
          if (this.onRoundCompleted) this.onRoundCompleted(this._currentRoundPointer);
        }
        this._currentRoundPointer += 1;
      }
      if (this.isComplete && !this._stageCompletedFired) {
        this._stageCompletedFired = true;
        if (this.onStageCompleted) this.onStageCompleted();
      }
    }

    // Resuelve exactamente un partido PENDIENTE — invariante 15 (doble
    // resolución rechazada) e invariante 18 (consultar no muta): esta es la
    // ÚNICA función que muta el runner además de los helpers internos que
    // llama.
    resolveMatch(matchId, options = {}) {
      const descriptor = this._matchesById.get(matchId);
      if (!descriptor) throw new Error(`RoundRobinStageRunner.resolveMatch: partido desconocido "${matchId}".`);
      if (descriptor.status === 'played') throw new Error(`RoundRobinStageRunner.resolveMatch: el partido "${matchId}" ya está jugado.`);
      const homeTeam = this.resolveParticipant(descriptor.homeParticipantId);
      const awayTeam = this.resolveParticipant(descriptor.awayParticipantId);
      const result = simulateMatch(homeTeam, awayTeam, options.matchEngineConfig, options.matchEngineOptions);
      descriptor.status = 'played';
      descriptor.result = result;
      this._recordResult(descriptor.homeParticipantId, descriptor.awayParticipantId, result.finalScore.home, result.finalScore.away);
      this._advanceRoundPointer();
      return descriptor;
    }

    resolveMatchesBefore(beforeDateTime, options) {
      return this.getPendingMatchesBefore(beforeDateTime).map((m) => this.resolveMatch(m.id, options));
    }

    // Compatibilidad de conveniencia (mismo contrato que `League.
    // simulateNextRound` antes de esta entrega): resuelve TODOS los
    // partidos pendientes de la jornada actual. `resolveMatchOptions(match)`
    // opcional: `(descriptor) => matchEngineOptions|undefined`.
    simulateNextRound(matchEngineConfig, resolveMatchOptions) {
      if (this.isComplete) throw new Error('RoundRobinStageRunner.simulateNextRound: la fase ya ha terminado.');
      const pending = this.getCurrentRoundMatches().filter((m) => m.status === 'pending');
      return pending.map((m) => this.resolveMatch(m.id, {
        matchEngineConfig, matchEngineOptions: resolveMatchOptions ? resolveMatchOptions(m) : undefined,
      }));
    }

    // Clasificación ordenada (invariante 18: no consume RNG ni muta).
    getStandings() {
      return buildOrderedStandings(this.participantIds, this._standings, this._headToHead, this.tiebreakSteps);
    }

    snapshot() {
      return {
        stageId: this.stageId,
        totalRounds: this.totalRounds,
        currentRoundPointer: this._currentRoundPointer,
        isComplete: this.isComplete,
        matches: this.matches.map((m) => ({
          ...m, scheduledDate: m.scheduledDate ? new Date(m.scheduledDate).toISOString() : null,
        })),
        standings: this.getStandings(),
      };
    }
  }

  // =========================================================================
  // 2. bracket — eliminatoria a mejor de N, avance FIJO entre rondas
  //    (invariante: dentro de UN runner nunca se reordena por resultado; un
  //    reseed entre fases se expresa como una fase NUEVA, ver `entrySource`
  //    "stage-bracket-final-round-winners" de `CompetitionFormatDefinition`).
  // =========================================================================

  // Patrones de campo GENÉRICOS (nunca nombrados por competición) — cada
  // posición indica quién es local en ese partido de la serie: 'better' =
  // el entry con seed más bajo (mejor clasificado); 'worse' = el otro.
  const VENUE_PATTERNS = {
    SINGLE_GAME: ['better'],
    BEST_OF_3_1_1_1: ['better', 'worse', 'better'],
    BEST_OF_5_2_2_1: ['better', 'better', 'worse', 'worse', 'better'],
  };

  class BracketStageRunner {
    // `entries`: [{ participantId, seed, entryId }]. `firstRoundPairing`:
    // [[seedA, seedB], ...] EN ORDEN DE BRACKET (ver comentario histórico de
    // Bracket.js — se conserva idéntico). `roundPatterns`: array de
    // VENUE_PATTERNS.*, uno por ronda.
    constructor(config = {}) {
      const {
        stageId = null, competitionDefinitionId = null, competitionEditionId = null, stageKey = null,
        entries, firstRoundPairing, roundPatterns, dateResolver = null, matchIdResolver = null,
        resolveParticipant, onSeriesDecided = null, onRoundAdvanced = null, onStageCompleted = null,
      } = config;
      if (!Array.isArray(entries) || entries.length < 2) throw new Error('BracketStageRunner: "entries" exige al menos 2 elementos.');
      if (!Array.isArray(firstRoundPairing) || !firstRoundPairing.length) throw new Error('BracketStageRunner: falta "firstRoundPairing".');
      if (!Array.isArray(roundPatterns) || !roundPatterns.length) throw new Error('BracketStageRunner: falta "roundPatterns".');
      if (typeof resolveParticipant !== 'function') throw new Error('BracketStageRunner: falta "resolveParticipant(id)" explícito.');

      this.stageId = stageId;
      this.competitionDefinitionId = competitionDefinitionId;
      this.competitionEditionId = competitionEditionId;
      this.stageKey = stageKey;
      this.roundPatterns = roundPatterns;
      this.dateResolver = dateResolver;
      this.matchIdResolver = matchIdResolver;
      this.resolveParticipant = resolveParticipant;
      this.onSeriesDecided = onSeriesDecided;
      this.onRoundAdvanced = onRoundAdvanced;
      this.onStageCompleted = onStageCompleted;
      this._stageCompletedFired = false;

      const bySeed = new Map(entries.map((e) => [e.seed, e]));
      this._seriesById = new Map();
      const firstRoundEntryPairs = firstRoundPairing.map(([seedA, seedB]) => [bySeed.get(seedA), bySeed.get(seedB)]);
      this.rounds = [this._buildRound(firstRoundEntryPairs, 0)];
      this.rounds[0].forEach((series) => this._ensureNextGameDescriptor(series));
    }

    _buildRound(entryPairs, roundIndex) {
      const pattern = this.roundPatterns[roundIndex];
      if (!pattern) throw new Error(`BracketStageRunner: no hay roundPattern declarado para la ronda ${roundIndex}.`);
      return entryPairs.map((pair, seriesIndexInRound) => {
        const [entryA, entryB] = pair;
        const better = entryA.seed <= entryB.seed ? entryA : entryB;
        const worse = entryA.seed <= entryB.seed ? entryB : entryA;
        const series = {
          id: `series:${this.stageId || 'standalone'}:r${roundIndex}:s${seriesIndexInRound}`,
          roundIndex,
          seriesIndexInRound,
          better,
          worse,
          pattern,
          gamesNeededToWin: Math.ceil(pattern.length / 2),
          games: [],
          wins: { better: 0, worse: 0 },
        };
        this._seriesById.set(series.id, series);
        return series;
      });
    }

    get currentRound() { return this.rounds[this.rounds.length - 1]; }

    _isSeriesDecided(series) {
      return series.wins.better >= series.gamesNeededToWin || series.wins.worse >= series.gamesNeededToWin;
    }

    _seriesWinner(series) {
      if (!this._isSeriesDecided(series)) return null;
      return series.wins.better > series.wins.worse ? series.better : series.worse;
    }

    isCurrentRoundComplete() { return this.currentRound.every((s) => this._isSeriesDecided(s)); }

    _advanceIfPossible() {
      if (!this.isCurrentRoundComplete()) return;
      if (this.rounds.length >= this.roundPatterns.length) return;
      const winners = this.currentRound.map((s) => this._seriesWinner(s));
      const entryPairs = [];
      for (let i = 0; i < winners.length; i += 2) entryPairs.push([winners[i], winners[i + 1]]);
      const nextRound = this._buildRound(entryPairs, this.rounds.length);
      this.rounds.push(nextRound);
      nextRound.forEach((series) => this._ensureNextGameDescriptor(series));
      if (this.onRoundAdvanced) this.onRoundAdvanced(this.rounds.length - 1);
    }

    // Crea (si no existe ya) el descriptor ESTABLE del siguiente partido
    // pendiente de `series` — fecha e id reales quedan fijados AQUÍ, antes
    // de que nadie llame a MatchEngine (BUG-COMPCORE-03). Idempotente.
    _ensureNextGameDescriptor(series) {
      if (this._isSeriesDecided(series)) return null;
      const last = series.games[series.games.length - 1];
      if (last && last.status === 'pending') return last;
      const gameIndex = series.games.length;
      const homeSide = series.pattern[gameIndex];
      const homeEntry = homeSide === 'better' ? series.better : series.worse;
      const awayEntry = homeSide === 'better' ? series.worse : series.better;
      const scheduledDate = this.dateResolver ? this.dateResolver(series.roundIndex, gameIndex) : null;
      const id = this.matchIdResolver
        ? this.matchIdResolver(series.roundIndex, series.seriesIndexInRound, gameIndex)
        : `match:${this.stageId || 'standalone'}:r${series.roundIndex}:s${series.seriesIndexInRound}:g${gameIndex}`;
      const descriptor = {
        id,
        competitionDefinitionId: this.competitionDefinitionId,
        competitionEditionId: this.competitionEditionId,
        stageId: this.stageId,
        stageKey: this.stageKey,
        seriesId: series.id,
        roundIndex: series.roundIndex,
        gameNumber: gameIndex + 1,
        homeParticipantId: homeEntry.participantId,
        awayParticipantId: awayEntry.participantId,
        homeSeed: homeEntry.seed,
        awaySeed: awayEntry.seed,
        homeEntryId: homeEntry.entryId || null,
        awayEntryId: awayEntry.entryId || null,
        status: 'pending',
        scheduledDate,
        result: null,
      };
      series.games.push(descriptor);
      return descriptor;
    }

    // Descriptor del siguiente partido pendiente de TODO el bracket — el
    // MISMO orden que el `Bracket.js` histórico (primer series NO decidida
    // de la ronda actual, tras avanzar de ronda si procede). Consultar
    // nunca resuelve ni muta el resultado.
    peekNextPendingMatch() {
      this._advanceIfPossible();
      const series = this.currentRound.find((s) => !this._isSeriesDecided(s));
      if (!series) return null;
      const descriptor = this._ensureNextGameDescriptor(series);
      return { series, descriptor };
    }

    _findSeriesById(seriesId) { return this._seriesById.get(seriesId) || null; }

    get champion() {
      if (this.rounds.length < this.roundPatterns.length) return null;
      const finalRound = this.rounds[this.rounds.length - 1];
      if (finalRound.length !== 1 || !this._isSeriesDecided(finalRound[0])) return null;
      return this._seriesWinner(finalRound[0]);
    }

    get isComplete() { return this.champion !== null; }

    getPendingMatches() {
      const pending = this.peekNextPendingMatch();
      return pending ? [pending.descriptor] : [];
    }

    resolveMatch(matchId, options = {}) {
      let target = null;
      let targetSeries = null;
      for (const series of this._seriesById.values()) {
        const found = series.games.find((g) => g && g.id === matchId);
        if (found) { target = found; targetSeries = series; break; }
      }
      if (!target) throw new Error(`BracketStageRunner.resolveMatch: partido desconocido "${matchId}".`);
      if (target.status === 'played') throw new Error(`BracketStageRunner.resolveMatch: el partido "${matchId}" ya está jugado.`);
      const homeTeam = this.resolveParticipant(target.homeParticipantId);
      const awayTeam = this.resolveParticipant(target.awayParticipantId);
      const result = simulateMatch(homeTeam, awayTeam, options.matchEngineConfig, options.matchEngineOptions);
      target.status = 'played';
      target.result = result;
      const homeWon = result.finalScore.home > result.finalScore.away;
      const homeSide = targetSeries.pattern[target.gameNumber - 1];
      const winnerSide = homeWon === (homeSide === 'better') ? 'better' : 'worse';
      targetSeries.wins[winnerSide] += 1;
      if (this._isSeriesDecided(targetSeries) && this.onSeriesDecided) this.onSeriesDecided(targetSeries);
      this._advanceIfPossible();
      if (this.isComplete && !this._stageCompletedFired) {
        this._stageCompletedFired = true;
        if (this.onStageCompleted) this.onStageCompleted();
      }
      return target;
    }

    // Resuelve el siguiente partido pendiente de TODO el bracket —
    // compatibilidad de conveniencia (mismo contrato que
    // `Bracket.playNextGame` antes de esta entrega).
    resolveNextPendingMatch(options) {
      const pending = this.peekNextPendingMatch();
      if (!pending) throw new Error('BracketStageRunner.resolveNextPendingMatch: el bracket ya está completo (hay campeón).');
      return this.resolveMatch(pending.descriptor.id, options);
    }

    snapshot() {
      return {
        stageId: this.stageId,
        isComplete: this.isComplete,
        champion: this.champion,
        rounds: this.rounds.map((round) => round.map((series) => ({
          id: series.id,
          betterEntry: series.better,
          worseEntry: series.worse,
          wins: { ...series.wins },
          isDecided: this._isSeriesDecided(series),
          games: series.games.filter(Boolean).map((g) => ({
            ...g, scheduledDate: g.scheduledDate ? new Date(g.scheduledDate).toISOString() : null,
          })),
        }))),
      };
    }
  }

  const exportsObj = {
    RoundRobinStageRunner,
    BracketStageRunner,
    VENUE_PATTERNS,
    generateSingleRoundRobinPairings,
    TIEBREAK_STEP_EVALUATORS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
