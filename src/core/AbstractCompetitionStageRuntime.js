// src/core/AbstractCompetitionStageRuntime.js
// WORLD-SIM-1 (DESIGN.md 10.16) — runtime AGREGADO para una
// `CompetitionEdition`/`CompetitionStage` con `detailLevel: 'abstract'`.
// Registrado en el MISMO `CompetitionRuntimeRegistry` que
// `RoundRobinStageRunner`/`BracketStageRunner` (nunca un engine paralelo),
// pero nunca crea `matches[]` ni descriptors de partido individuales — solo
// expone UN hito pendiente ("resolver la fase") y, al resolverlo, deja una
// clasificación final o un resumen de cuadro calculados a partir de FUERZA
// agregada (`TeamSimulationSnapshot`) + un fingerprint estable, nunca de
// posesión a posesión. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Límite consciente de esta entrega (DESIGN.md 10.16, sección 6 del
// prompt): solo soporta formatos de UNA sola fase resoluble
// (round-robin, o bracket con un número de participantes potencia de 2) —
// una ampliación futura que necesite hitos intermedios de una fase
// abstracta multi-stage no está cubierta aquí.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const DeterministicRandomModule = dep('../utils/DeterministicRandom.js');

  function DR() { return DeterministicRandomModule.DeterministicRandom; }

  const ABSTRACT_ALGORITHM_VERSION = 'abstract-phase-v1';
  // Dispersión determinista alrededor de la fuerza agregada (misma escala
  // 0-100 que `TeamSimulationSnapshot.strength`) — nunca tan grande que
  // ignore la fuerza, nunca tan pequeña que el resultado sea siempre "gana
  // el mejor seed".
  const JITTER_RANGE = 20;

  const RUNNER_TYPES = ['round-robin', 'bracket'];

  // Fecha/huso de un hito — AUTORIDAD explícita, nunca el reloj del
  // sistema (mismo criterio que `normalizeScheduling` de
  // `CompetitionRunners.js`, pero sin aceptar un `Date` suelto: un hito de
  // fase SIEMPRE necesita huso IANA declarado por el calendario del
  // contenido).
  function normalizeMilestoneScheduling(value) {
    if (!value) return null;
    if (!value.scheduledAt || !value.timeZoneId) return null;
    return { scheduledAt: value.scheduledAt, timeZoneId: value.timeZoneId };
  }

  function defaultBracketPairing(sortedEntries) {
    const n = sortedEntries.length;
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) pairs.push([sortedEntries[i], sortedEntries[n - 1 - i]]);
    return pairs;
  }

  function simulateBracketWinner(entryA, entryB, fingerprint, roundIndex) {
    const key = `bracket:r${roundIndex}:${entryA.participantId}:${entryB.participantId}`;
    const jitterA = (DR().unitFrom(fingerprint, `${key}:a`) - 0.5) * JITTER_RANGE;
    const jitterB = (DR().unitFrom(fingerprint, `${key}:b`) - 0.5) * JITTER_RANGE;
    const scoreA = entryA.strength.overall + jitterA;
    const scoreB = entryB.strength.overall + jitterB;
    if (scoreA === scoreB) return entryA.seed <= entryB.seed ? entryA : entryB;
    return scoreA > scoreB ? entryA : entryB;
  }

  // Resuelve un bracket entero en una sola llamada (DETERMINISTA: mismo
  // fingerprint + mismas entries -> mismo campeón, sin importar el orden en
  // que se registraron los participantes — se ordena SIEMPRE por seed).
  function resolveBracketSummary(entries, firstRoundPairing, fingerprint) {
    const bySeed = new Map(entries.map((e) => [e.seed, e]));
    let round = (Array.isArray(firstRoundPairing) && firstRoundPairing.length)
      ? firstRoundPairing.map(([seedA, seedB]) => [bySeed.get(seedA), bySeed.get(seedB)])
      : defaultBracketPairing([...entries].sort((a, b) => a.seed - b.seed));
    let roundIndex = 0;
    for (;;) {
      const winners = round.map((pair) => simulateBracketWinner(pair[0], pair[1], fingerprint, roundIndex));
      if (winners.length === 1) {
        const [entryA, entryB] = round[0];
        const champion = winners[0];
        const runnerUp = champion === entryA ? entryB : entryA;
        return {
          champion: { participantId: champion.participantId, seed: champion.seed },
          runnerUp: { participantId: runnerUp.participantId, seed: runnerUp.seed },
        };
      }
      const nextRound = [];
      for (let i = 0; i < winners.length; i += 2) nextRound.push([winners[i], winners[i + 1]]);
      round = nextRound;
      roundIndex += 1;
    }
  }

  // Clasificación final agregada — ORDEN es el rango (nunca un campo de
  // puntos/wins/losses fabricado: eso sería detalle individual/partido a
  // partido que "abstract" nunca produce).
  function rankStandings(entries, fingerprint) {
    return entries
      .map((e) => ({
        participantId: e.participantId,
        seed: e.seed,
        score: e.strength.overall + (DR().unitFrom(fingerprint, `standing:${e.participantId}`) - 0.5) * JITTER_RANGE,
      }))
      .sort((a, b) => (b.score - a.score) || (a.seed - b.seed))
      .map((e) => ({ participantId: e.participantId, seed: e.seed }));
  }

  class AbstractCompetitionStageRuntime {
    constructor(config = {}) {
      const {
        stageId, competitionDefinitionId, competitionEditionId, stageKey,
        entries, runnerType, firstRoundPairing, dateResolver,
        resolveStrength, careerSeed, registerReceipt, onStageCompleted,
      } = config;
      const label = `AbstractCompetitionStageRuntime "${stageId || '?'}"`;
      if (!stageId) throw new Error(`${label}: falta "stageId".`);
      if (!RUNNER_TYPES.includes(runnerType)) {
        throw new Error(`${label}: "runnerType" = "${runnerType}" no soportado — debe ser uno de ${RUNNER_TYPES.join(', ')}.`);
      }
      if (!Array.isArray(entries) || entries.length < 2) {
        throw new Error(`${label}: "entries" exige al menos 2 elementos {participantId, seed}.`);
      }
      if (runnerType === 'bracket') {
        const n = entries.length;
        // eslint-disable-next-line no-bitwise
        if ((n & (n - 1)) !== 0) {
          throw new Error(
            `${label}: el límite consciente de WORLD-SIM-1 exige un número de participantes potencia de 2 para un `
            + `bracket abstracto (recibidos ${n}) — usa "standard"/"full"/"playable" para este caso.`,
          );
        }
      }
      if (typeof resolveStrength !== 'function') throw new Error(`${label}: falta "resolveStrength(participantId)".`);
      if (typeof registerReceipt !== 'function') throw new Error(`${label}: falta "registerReceipt(data)".`);
      if (!careerSeed) throw new Error(`${label}: falta "careerSeed" explícito.`);

      this.stageId = stageId;
      this.competitionDefinitionId = competitionDefinitionId;
      this.competitionEditionId = competitionEditionId;
      this.stageKey = stageKey;
      this.runnerType = runnerType;
      this._entries = entries;
      this._firstRoundPairing = firstRoundPairing || null;
      this._resolveStrength = resolveStrength;
      this._registerReceipt = registerReceipt;
      this.onStageCompleted = onStageCompleted || null;
      this.careerSeed = careerSeed;
      this.algorithmVersion = ABSTRACT_ALGORITHM_VERSION;
      this._resolved = false;
      this._receipt = null;
      this._milestoneId = `milestone:${stageId}`;

      const scheduling = normalizeMilestoneScheduling(typeof dateResolver === 'function' ? dateResolver() : dateResolver);
      if (!scheduling) {
        throw new Error(
          `${label}: necesita fecha final + huso IANA explícitos para su hito de resolución — nunca el reloj del `
          + 'sistema (aporta un "dateResolver" real desde el calendario del contenido).',
        );
      }
      this._scheduling = scheduling;
    }

    get isComplete() { return this._resolved; }

    // Uniforme con `BracketStageRunner.champion`: `null` sin campeón
    // todavía, o cuando este stage no es de tipo bracket.
    get champion() {
      if (!this._resolved || this.runnerType !== 'bracket') return null;
      return this._receipt.result.bracketSummary.champion;
    }

    // Equivalente agregado de "ganadores de la última ronda" — con un solo
    // hito no hay rondas intermedias, así que es siempre el campeón (o
    // `null` antes de resolver).
    getFinalRoundWinners() {
      if (!this._resolved || this.runnerType !== 'bracket') return null;
      return [this._receipt.result.bracketSummary.champion];
    }

    // Uniforme con `RoundRobinStageRunner.getStandings()` — `[]` antes de
    // resolver (invariante: abstract no fabrica clasificaciones parciales).
    getStandings() {
      if (!this._resolved || this.runnerType !== 'round-robin') return [];
      return this._receipt.result.standings;
    }

    // Invariante 9 (DESIGN.md 10.16): "abstract" nunca crea ni almacena
    // partidos individuales.
    getPendingMatches() { return []; }

    getPendingMilestones() {
      if (this._resolved) return [];
      return [{
        id: this._milestoneId,
        kind: 'stage-resolution',
        stageId: this.stageId,
        stageKey: this.stageKey,
        competitionDefinitionId: this.competitionDefinitionId,
        competitionEditionId: this.competitionEditionId,
        scheduledAt: this._scheduling.scheduledAt,
        timeZoneId: this._scheduling.timeZoneId,
        status: 'pending',
      }];
    }

    // Resuelve el hito ÚNICO de esta fase — idempotente (invariante 12: se
    // aplica como máximo una vez; repetir devuelve el receipt ya existente
    // sin consumir el hash determinista ni emitir dos veces el hecho).
    resolveMilestone(milestoneId, options = {}) {
      if (milestoneId !== this._milestoneId) {
        throw new Error(`AbstractCompetitionStageRuntime "${this.stageId}": hito desconocido "${milestoneId}".`);
      }
      if (this._resolved) return this._receipt;
      const fingerprint = `${this.careerSeed}:${this.algorithmVersion}:${this.competitionEditionId}:${this.stageId}`;
      const sortedEntries = [...this._entries].sort((a, b) => a.seed - b.seed);
      const withStrength = sortedEntries.map((e) => ({ ...e, strength: this._resolveStrength(e.participantId) }));
      const result = this.runnerType === 'bracket'
        ? { type: 'bracket-summary', bracketSummary: resolveBracketSummary(withStrength, this._firstRoundPairing, fingerprint) }
        : { type: 'standings', standings: rankStandings(withStrength, fingerprint) };
      const resolvedAt = (options.now && options.now.instant) || this._scheduling.scheduledAt;
      this._receipt = this._registerReceipt({
        id: `receipt:${this.stageId}`,
        editionId: this.competitionEditionId,
        stageId: this.stageId,
        detailLevel: 'abstract',
        algorithmVersion: this.algorithmVersion,
        resolvedAt,
        timeZoneId: this._scheduling.timeZoneId,
        participantIds: this._entries.map((e) => e.participantId),
        result,
        seedFingerprint: fingerprint,
        status: 'resolved',
      });
      this._resolved = true;
      if (this.onStageCompleted) this.onStageCompleted();
      return this._receipt;
    }

    snapshot() {
      return {
        stageId: this.stageId,
        kind: 'abstract',
        isComplete: this._resolved,
        receipt: this._receipt ? this._receipt.toJSON() : null,
      };
    }
  }

  const exportsObj = { AbstractCompetitionStageRuntime, ABSTRACT_ALGORITHM_VERSION };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
