// src/core/Bracket.js
// Piezas reutilizables de eliminatoria — ver DESIGN.md sección 3.2.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// COMP-CORE-1 (DESIGN.md 10.13): `Series`/`Bracket` dejan de contener el
// algoritmo de avance/patrón de campo — son FACHADAS FINAS sobre el runner
// genérico `BracketStageRunner` (`src/core/CompetitionRunners.js`),
// conservadas por el mismo motivo que `League.js`: compatibilidad de
// scripts/tests históricos que construyen `new Bracket(...)` directamente,
// Y fachada que usa el runtime productivo cuando `CompetitionEngine` ya
// construyó el runner real (`runtimeOptions`). Nunca hay dos algoritmos.
//
// BUG-COMPCORE-03 (corregido aquí): antes, `Series.playNextGame()`
// calculaba la fecha DESPUÉS de simular — todo el prepartido (descanso,
// entrenamiento, elegibilidad, acta) recibía una aproximación. Ahora el
// descriptor (id global + fecha real) se crea ANTES de invocar
// `resolveOptions`/`MatchEngine` (`BracketStageRunner._ensureNextGameDescriptor`),
// así que `resolveOptions` recibe también `(scheduledDate, matchId)` reales.
//
// Destino: `game.js` ya NO construye `new Bracket()` en la ruta productiva
// (retirado, ver CLAUDE.md/DESIGN.md 10.8) — la construye
// `CompetitionEngine`.

(function (global) {
  const RunnersCore = (typeof module !== 'undefined' && module.exports)
    ? require('./CompetitionRunners.js')
    : global.BasketManager;

  const { BracketStageRunner, VENUE_PATTERNS } = RunnersCore;

  // --- Series: vista legacy sobre una serie del runner ---
  //
  // Ya no es una clase con estado propio: envuelve la serie CANÓNICA del
  // runner (misma referencia siempre) y expone la forma histórica
  // (betterEntry/worseEntry/pattern/games/wins/isDecided/winner/loser/
  // getStatus) — `games` se rellena en el mismo orden en que se resuelven
  // los partidos (`Bracket.playNextGame()`), igual que antes.
  // WORLD-CALENDAR-1 (DESIGN.md 10.14): `games` pasa a ser una vista
  // DERIVADA del runner (antes se rellenaba a mano en
  // `Bracket.playNextGame()`), para que la vista legacy pueda construirse
  // BAJO DEMANDA desde un `stageId`/runner real en cualquier momento, sin
  // guardarla como estado paralelo (`state.brackets` deja de ser un mapa
  // fijo). Semántica histórica intacta: `games` solo contiene los partidos
  // ya JUGADOS, en el orden en que se resolvieron; los pendientes ya
  // materializados se consultan en `pendingGames`.
  function wrapSeries(canonicalSeries, teamsById) {
    const wrapEntry = (entry) => ({ team: teamsById.get(entry.participantId), seed: entry.seed });
    const wrapGame = (descriptor) => ({
      id: descriptor.id,
      gameNumber: descriptor.gameNumber,
      homeEntry: { team: teamsById.get(descriptor.homeParticipantId), seed: descriptor.homeSeed },
      awayEntry: { team: teamsById.get(descriptor.awayParticipantId), seed: descriptor.awaySeed },
      result: descriptor.result,
      date: descriptor.scheduledDate,
      scheduledAt: descriptor.scheduledAt || null,
      timeZoneId: descriptor.timeZoneId || null,
      status: descriptor.status,
    });
    const legacy = {
      betterEntry: wrapEntry(canonicalSeries.better),
      worseEntry: wrapEntry(canonicalSeries.worse),
      pattern: canonicalSeries.pattern,
      gamesNeededToWin: canonicalSeries.gamesNeededToWin,
      get games() { return canonicalSeries.games.filter((g) => g && g.status === 'played').map(wrapGame); },
      get pendingGames() { return canonicalSeries.games.filter((g) => g && g.status === 'pending').map(wrapGame); },
      wins: canonicalSeries.wins, // MISMA referencia — el runner la muta in-place
      get isDecided() {
        return canonicalSeries.wins.better >= canonicalSeries.gamesNeededToWin
          || canonicalSeries.wins.worse >= canonicalSeries.gamesNeededToWin;
      },
      get winner() {
        if (!legacy.isDecided) return null;
        return canonicalSeries.wins.better > canonicalSeries.wins.worse ? legacy.betterEntry : legacy.worseEntry;
      },
      get loser() {
        if (!legacy.isDecided) return null;
        return canonicalSeries.wins.better > canonicalSeries.wins.worse ? legacy.worseEntry : legacy.betterEntry;
      },
      getStatus() {
        return {
          betterEntry: legacy.betterEntry,
          worseEntry: legacy.worseEntry,
          wins: { ...canonicalSeries.wins },
          gamesPlayed: legacy.games.length,
          gamesNeededToWin: legacy.gamesNeededToWin,
          isDecided: legacy.isDecided,
          winner: legacy.winner,
        };
      },
    };
    return legacy;
  }

  // --- Bracket: fachada sobre BracketStageRunner ---
  //
  // `entries`: array de { team, seed } (Team reales — nunca ids, mismo
  // contrato histórico). `runtimeOptions` (opcional, COMP-CORE-1):
  // `{ runner, entryIdFor(teamId), matchIdResolver }` — cuando el engine ya
  // construyó el `BracketStageRunner` real, esta fachada solo lo envuelve.
  class Bracket {
    // `entries`/`firstRoundPairing`/`roundPatterns` solo se usan para
    // construir un runner nuevo (rama standalone, sin `runtimeOptions.
    // runner`) — con un runner YA vivo (ruta productiva), solo hace falta
    // `entries` (para poder resolver Team reales por id, ver
    // `_teamsById`); los otros dos pueden pasarse vacíos.
    constructor(entries, firstRoundPairing, roundPatterns, dateResolver, runtimeOptions) {
      const opts = runtimeOptions || {};
      this.dateResolver = dateResolver || null;
      this._teamsById = new Map(entries.map((e) => [e.team.id, e.team]));
      const canonicalEntries = entries.map((e) => ({
        participantId: e.team.id,
        seed: e.seed,
        entryId: opts.entryIdFor ? opts.entryIdFor(e.team.id) : null,
      }));
      this.runner = opts.runner || new BracketStageRunner({
        stageId: opts.stageId || null,
        competitionDefinitionId: opts.competitionDefinitionId || null,
        competitionEditionId: opts.competitionEditionId || null,
        stageKey: opts.stageKey || null,
        entries: canonicalEntries,
        firstRoundPairing,
        roundPatterns,
        dateResolver: dateResolver ? (roundIndex, gameIndexInSeries) => dateResolver(roundIndex, gameIndexInSeries) : null,
        matchIdResolver: opts.matchIdResolver || null,
        resolveParticipant: (id) => this._teamsById.get(id),
      });
      this.roundPatterns = this.runner.roundPatterns;
      this._legacySeriesByCanonicalId = new Map();
      this._wrappedRounds = [this._wrapRound(this.runner.rounds[0])];
    }

    // WORLD-CALENDAR-1 (DESIGN.md 10.14): `rounds` es una vista DERIVADA
    // que se sincroniza con el runner al LEERSE. Antes solo se sincronizaba
    // dentro de `playNextGame()`, así que una fachada construida bajo
    // demanda (o construida antes de que el partido se resolviera por la
    // cola mundial, que resuelve por `stageId`/`matchId` sin pasar por
    // aquí) se quedaba mostrando únicamente la PRIMERA ronda — y con ella,
    // el histórico de la temporada perdía los partidos de semifinales y
    // final. Sincronizar es solo envolver rondas que el runner YA creó: no
    // materializa partidos, no avanza rondas y no consume aleatoriedad.
    get rounds() {
      this._syncRounds();
      return this._wrappedRounds;
    }

    _wrapSeries(canonicalSeries) {
      if (!this._legacySeriesByCanonicalId.has(canonicalSeries.id)) {
        this._legacySeriesByCanonicalId.set(canonicalSeries.id, wrapSeries(canonicalSeries, this._teamsById));
      }
      return this._legacySeriesByCanonicalId.get(canonicalSeries.id);
    }

    _wrapRound(canonicalRound) { return canonicalRound.map((s) => this._wrapSeries(s)); }

    _syncRounds() {
      while (this._wrappedRounds.length < this.runner.rounds.length) {
        this._wrappedRounds.push(this._wrapRound(this.runner.rounds[this._wrappedRounds.length]));
      }
    }

    get currentRound() {
      const rounds = this.rounds;
      return rounds[rounds.length - 1];
    }

    isCurrentRoundComplete() { return this.currentRound.every((s) => s.isDecided); }

    advanceIfPossible() { this._syncRounds(); }

    get champion() {
      const c = this.runner.champion;
      return c ? { team: this._teamsById.get(c.participantId), seed: c.seed } : null;
    }

    get isComplete() { return this.runner.isComplete; }

    // Descriptor del siguiente partido pendiente (sin resolverlo) —
    // BUG-COMPCORE-03: expone `scheduledDate`/`matchId` REALES para que
    // los sistemas prepartido (descanso/entrenamiento/elegibilidad/acta)
    // puedan prepararse ANTES de que nadie llame a `playNextGame()`, en
    // vez de aproximar con el reloj de mundo. `null` si el bracket ya
    // está completo.
    peekNextPendingGame() {
      const pending = this.runner.peekNextPendingMatch();
      if (!pending) return null;
      const { descriptor } = pending;
      return {
        homeEntry: { team: this._teamsById.get(descriptor.homeParticipantId), seed: descriptor.homeSeed },
        awayEntry: { team: this._teamsById.get(descriptor.awayParticipantId), seed: descriptor.awaySeed },
        scheduledDate: descriptor.scheduledDate,
        scheduledAt: descriptor.scheduledAt || null,
        timeZoneId: descriptor.timeZoneId || null,
        matchId: descriptor.id,
        stageId: this.runner.stageId,
      };
    }

    // Juega el siguiente partido pendiente de TODO el bracket.
    // `resolveOptions(homeEntry, awayEntry, scheduledDate, matchId)` —
    // BUG-COMPCORE-03: `scheduledDate`/`matchId` YA son reales (el
    // descriptor se crea antes de simular), nunca una aproximación.
    playNextGame(config, resolveOptions) {
      const pending = this.runner.peekNextPendingMatch();
      if (!pending) throw new Error('Bracket.playNextGame: el bracket ya está completo (hay campeón)');
      const { series: canonicalSeries, descriptor } = pending;
      const homeEntry = { team: this._teamsById.get(descriptor.homeParticipantId), seed: descriptor.homeSeed };
      const awayEntry = { team: this._teamsById.get(descriptor.awayParticipantId), seed: descriptor.awaySeed };
      const options = resolveOptions ? resolveOptions(homeEntry, awayEntry, descriptor.scheduledDate, descriptor.id) : undefined;
      this.runner.resolveMatch(descriptor.id, { matchEngineConfig: config, matchEngineOptions: options });
      this._syncRounds();
      void canonicalSeries; // `series.games` es ahora una vista derivada del runner
      return {
        id: descriptor.id,
        gameNumber: descriptor.gameNumber,
        homeEntry,
        awayEntry,
        result: descriptor.result,
        date: descriptor.scheduledDate,
        scheduledAt: descriptor.scheduledAt || null,
        timeZoneId: descriptor.timeZoneId || null,
        status: descriptor.status,
      };
    }

    getStatus() {
      return {
        rounds: this.rounds.map((round) => round.map((s) => s.getStatus())),
        champion: this.champion,
        isComplete: this.isComplete,
      };
    }
  }

  const exportsObj = { Series: null, Bracket, VENUE_PATTERNS };
  // `Series` histórica ya no se instancia de forma independiente (nunca
  // tuvo consumidores fuera de este archivo, ver auditoría de game.js) —
  // se conserva el nombre exportado como `null` documentado, en vez de
  // borrarlo, por si algún script externo lo importa defensivamente.

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
