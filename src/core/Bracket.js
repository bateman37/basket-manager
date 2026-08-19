// src/core/Bracket.js
// Piezas reutilizables de eliminatoria — FASE 2 de Liga/Calendario (ver
// DESIGN.md sección 3.2). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Series: eliminatoria al mejor de N partidos entre dos equipos, con un
// patrón de campo dado (1-1-1, 2-2-1, o partido único = mejor de 1).
// Bracket: encadena rondas de Series desde un conjunto de entradas
// semilladas (seed 1 = mejor), con emparejamientos FIJOS — nunca se
// reordena por resultado (DESIGN.md exige bracket fijo tanto en playoffs
// como en Copa; el playoff de ascenso de 2ª división es la única
// excepción, y esa reordenación se implementa en Promotion.js, no aquí).

(function (global) {
  const MatchEngineCore = (typeof module !== 'undefined' && module.exports)
    ? require('./MatchEngine.js')
    : global.BasketManager;

  const { simulateMatch } = MatchEngineCore;

  // Patrones de campo estándar (DESIGN.md 3.2). Cada posición del array
  // indica quién es local en ese partido de la serie: 'better' = el
  // equipo mejor clasificado de los dos (seed más bajo), 'worse' = el
  // otro. La longitud del patrón es el nº máximo de partidos de la serie.
  const VENUE_PATTERNS = {
    SINGLE_GAME: ['better'],
    BEST_OF_3_1_1_1: ['better', 'worse', 'better'],
    BEST_OF_5_2_2_1: ['better', 'better', 'worse', 'worse', 'better'],
  };

  // --- Series: al mejor de N partidos entre dos equipos ---
  class Series {
    // `betterEntry`/`worseEntry`: { team, seed } — seed = posición de
    // origen (liga regular u otra fuente), 1 = mejor. La ventaja de campo
    // en cada partido la decide `pattern`, siempre en términos relativos
    // a quién es "better"/"worse", nunca en términos de un equipo fijo.
    // `dateResolver` (opcional, DESIGN.md 3.3): `(gameIndexInSeries) =>
    // Date`, ya fijado a la ronda de esta Series por Bracket.buildRound().
    constructor(betterEntry, worseEntry, pattern, dateResolver) {
      this.betterEntry = betterEntry;
      this.worseEntry = worseEntry;
      this.pattern = pattern;
      this.gamesNeededToWin = Math.ceil(pattern.length / 2);
      this.games = []; // { gameNumber, homeEntry, awayEntry, result, date }
      this.wins = { better: 0, worse: 0 };
      this.dateResolver = dateResolver || null;
    }

    get isDecided() {
      return this.wins.better >= this.gamesNeededToWin || this.wins.worse >= this.gamesNeededToWin;
    }

    get winner() {
      if (!this.isDecided) return null;
      return this.wins.better > this.wins.worse ? this.betterEntry : this.worseEntry;
    }

    get loser() {
      if (!this.isDecided) return null;
      return this.wins.better > this.wins.worse ? this.worseEntry : this.betterEntry;
    }

    // Juega el siguiente partido pendiente de la serie, simulándolo de
    // verdad con MatchEngine.simulateMatch (nunca en bloque).
    //
    // `resolveOptions` (opcional, DESIGN.md 7.11.6 — pantalla de
    // Alineación): callback `(homeEntry, awayEntry) => options|undefined`
    // que permite pasar `options.home/awaySquad`+`home/awayLineup` para el
    // equipo del usuario cuando le toque jugar dentro del bracket.
    playNextGame(config, resolveOptions) {
      if (this.isDecided) {
        throw new Error('Series.playNextGame: la serie ya tiene ganador, no quedan partidos por jugar');
      }
      const gameIndex = this.games.length;
      const homeSide = this.pattern[gameIndex];
      const homeEntry = homeSide === 'better' ? this.betterEntry : this.worseEntry;
      const awayEntry = homeSide === 'better' ? this.worseEntry : this.betterEntry;
      const options = resolveOptions ? resolveOptions(homeEntry, awayEntry) : undefined;
      const result = simulateMatch(homeEntry.team, awayEntry.team, config, options);
      const homeWon = result.finalScore.home > result.finalScore.away;
      const winnerSide = homeWon === (homeSide === 'better') ? 'better' : 'worse';
      this.wins[winnerSide] += 1;
      const game = {
        gameNumber: gameIndex + 1,
        homeEntry,
        awayEntry,
        result,
        // DESIGN.md 3.3: fecha real del partido, si el Bracket recibió un
        // dateResolver (Calendar.buildBracketDateResolver) — null si no.
        date: this.dateResolver ? this.dateResolver(gameIndex) : null,
      };
      this.games.push(game);
      return game;
    }

    getStatus() {
      return {
        betterEntry: this.betterEntry,
        worseEntry: this.worseEntry,
        wins: { ...this.wins },
        gamesPlayed: this.games.length,
        gamesNeededToWin: this.gamesNeededToWin,
        isDecided: this.isDecided,
        winner: this.winner,
      };
    }
  }

  // --- Bracket: encadena rondas de Series, con emparejamiento FIJO ---
  //
  // `entries`: array de { team, seed } (no hace falta que estén ordenadas).
  // `firstRoundPairing`: array de pares [seedA, seedB] EN ORDEN DE BRACKET,
  // no en orden "de anuncio" — las series consecutivas (0,1), (2,3), ...
  // son las que se enfrentarán entre sí en la ronda siguiente. Ej.: para
  // un bracket de 8 con emparejamientos 1v8/2v7/3v6/4v5, el orden de
  // bracket correcto es [[1,8],[4,5],[2,7],[3,6]] — así el 1 y el 2 solo
  // pueden cruzarse en la final (formato estándar de seeding). Quien llama
  // a Bracket es responsable de pasar ya el orden correcto.
  // `roundPatterns`: array de VENUE_PATTERNS.*, uno por ronda, en el orden
  // en que se van a jugar (ej. [BEST_OF_3_1_1_1, BEST_OF_5_2_2_1, BEST_OF_5_2_2_1]).
  class Bracket {
    // `dateResolver` (opcional, DESIGN.md 3.3): `(roundIndex,
    // gameIndexInSeries) => Date`, normalmente
    // `Calendar.buildBracketDateResolver(startDate, roundPatterns)`. Sin
    // él, todas las `date` de los partidos quedan en `null` — igual que
    // antes de existir Calendar.js.
    constructor(entries, firstRoundPairing, roundPatterns, dateResolver) {
      const bySeed = new Map(entries.map((entry) => [entry.seed, entry]));
      this.roundPatterns = roundPatterns;
      this.dateResolver = dateResolver || null;
      const firstRoundEntryPairs = firstRoundPairing.map(
        ([seedA, seedB]) => [bySeed.get(seedA), bySeed.get(seedB)],
      );
      this.rounds = [this.buildRound(firstRoundEntryPairs, 0)];
    }

    buildRound(entryPairs, roundIndex) {
      const pattern = this.roundPatterns[roundIndex];
      const seriesDateResolver = this.dateResolver
        ? (gameIndexInSeries) => this.dateResolver(roundIndex, gameIndexInSeries)
        : null;
      return entryPairs.map(([entryA, entryB]) => {
        const better = entryA.seed <= entryB.seed ? entryA : entryB;
        const worse = entryA.seed <= entryB.seed ? entryB : entryA;
        return new Series(better, worse, pattern, seriesDateResolver);
      });
    }

    get currentRound() {
      return this.rounds[this.rounds.length - 1];
    }

    isCurrentRoundComplete() {
      return this.currentRound.every((series) => series.isDecided);
    }

    // Si la ronda actual ya está completa y todavía queda alguna ronda por
    // jugar, construye la siguiente emparejando a los ganadores en el
    // mismo orden fijo (sin mirar el resultado para reordenar).
    advanceIfPossible() {
      if (!this.isCurrentRoundComplete()) return;
      if (this.rounds.length >= this.roundPatterns.length) return;
      const winners = this.currentRound.map((series) => series.winner);
      const entryPairs = [];
      for (let i = 0; i < winners.length; i += 2) entryPairs.push([winners[i], winners[i + 1]]);
      this.rounds.push(this.buildRound(entryPairs, this.rounds.length));
    }

    get champion() {
      if (this.rounds.length < this.roundPatterns.length) return null;
      const finalRound = this.rounds[this.rounds.length - 1];
      if (finalRound.length !== 1 || !finalRound[0].isDecided) return null;
      return finalRound[0].winner;
    }

    get isComplete() {
      return this.champion !== null;
    }

    // Juega el siguiente partido pendiente de TODO el bracket (detecta en
    // qué serie/ronda toca) y avanza de ronda automáticamente en cuanto
    // corresponda. `resolveOptions`: ver Series.playNextGame — se reenvía
    // tal cual a la serie que le toque jugar.
    playNextGame(config, resolveOptions) {
      this.advanceIfPossible();
      const pendingSeries = this.currentRound.find((series) => !series.isDecided);
      if (!pendingSeries) {
        throw new Error('Bracket.playNextGame: el bracket ya está completo (hay campeón)');
      }
      const game = pendingSeries.playNextGame(config, resolveOptions);
      this.advanceIfPossible();
      return game;
    }

    getStatus() {
      return {
        rounds: this.rounds.map((round) => round.map((series) => series.getStatus())),
        champion: this.champion,
        isComplete: this.isComplete,
      };
    }
  }

  const exportsObj = { Series, Bracket, VENUE_PATTERNS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
