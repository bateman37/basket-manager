// src/core/Promotion.js
// Playoff de ascenso sobre la 2ª división ficticia — ver DESIGN.md sección
// 3.2.3. El 1º de la liga regular de 2ª división asciende directo (sin
// jugar el playoff). Los clasificados 2º-9º juegan cuartos (bracket fijo,
// igual que Playoffs.js/Cup.js) y una Final Four cuyas semifinales se
// reordenan por la clasificación regular ORIGINAL de los 4 ganadores de
// cuartos (mejor vs peor, los dos intermedios entre sí) — NO por posición
// de bracket. Esta reordenación es una excepción explícita de DESIGN.md
// 3.2.3 frente al resto de 3.2 (que usa bracket fijo sin reordenar), así
// que aquí NO se usa el avance automático de rondas de Bracket: se arma
// la Final Four a mano como un Bracket nuevo e independiente, una vez
// conocidos los 4 ganadores.
//
// La 2ª división en sí (los 18 equipos ficticios + su League) es
// infraestructura mínima de esta fase (no es un modo de juego completo) y
// se construye fuera de este archivo (ver index.html), reutilizando
// generateFictionalTeams() y League.js tal cual, sin cambios.

(function (global) {
  const BracketCore = (typeof module !== 'undefined' && module.exports)
    ? require('./Bracket.js')
    : global.BasketManager;

  const { Bracket, VENUE_PATTERNS } = BracketCore;

  // Cuartos EN ORDEN DE BRACKET (ver Bracket.js): con solo una ronda no
  // importa la agrupación en "mitades" porque la Final Four se reordena
  // de todos modos, pero se mantiene el mismo formato de emparejamiento
  // 2v9/3v8/4v7/5v6 que pide DESIGN.md 3.2.3.
  const QUARTERFINAL_PAIRING = [[2, 9], [3, 8], [4, 7], [5, 6]];

  // Reordena los 4 ganadores de cuartos por su seed ORIGINAL de liga
  // regular (no por posición de bracket) y arma el cruce de semifinal:
  // mejor de los 4 vs peor de los 4, y los dos intermedios entre sí.
  function buildFinalFourPairing(quarterFinalWinners) {
    const bySeedAscending = [...quarterFinalWinners].sort((a, b) => a.seed - b.seed);
    const [best, midHigh, midLow, worst] = bySeedAscending;
    return {
      entries: bySeedAscending,
      pairing: [[best.seed, worst.seed], [midHigh.seed, midLow.seed]],
    };
  }

  class PromotionPlayoff {
    // `league`: instancia de League de la 2ª división ficticia, con la
    // temporada regular ya completa (league.isSeasonComplete === true).
    constructor(league) {
      if (!league.isSeasonComplete) {
        throw new Error('PromotionPlayoff: la liga regular de 2ª división todavía no ha terminado');
      }
      const standings = league.getStandingsTable();

      // 1º asciende directo — dato simple, sin lógica de fusión con 1ª
      // división (fuera de alcance de esta fase, DESIGN.md 3.2.3).
      this.directPromotion = { team: standings[0].team, seed: 1 };

      const qualifiers = standings.slice(1, 9).map((standing, index) => ({
        team: standing.team,
        seed: index + 2, // 2º a 9º
      }));
      this.quarterFinals = new Bracket(qualifiers, QUARTERFINAL_PAIRING, [VENUE_PATTERNS.BEST_OF_5_2_2_1]);
      this.finalFour = null; // se crea al completar cuartos, con el cruce reordenado
    }

    get isQuarterFinalsComplete() {
      return this.quarterFinals.currentRound.every((series) => series.isDecided);
    }

    // Construye la Final Four (si no existe ya) en cuanto cuartos está
    // completo, reordenando el cruce de semifinal por seed original.
    ensureFinalFour() {
      if (this.finalFour || !this.isQuarterFinalsComplete) return;
      const winners = this.quarterFinals.currentRound.map((series) => series.winner);
      const { entries, pairing } = buildFinalFourPairing(winners);
      this.finalFour = new Bracket(entries, pairing, [VENUE_PATTERNS.SINGLE_GAME, VENUE_PATTERNS.SINGLE_GAME]);
    }

    // 2º equipo ascendido = campeón de la Final Four (null hasta que se
    // decida). El 1º ascendido es `this.directPromotion`.
    get secondPromotedEntry() {
      return this.finalFour ? this.finalFour.champion : null;
    }

    get isComplete() {
      return this.secondPromotedEntry !== null;
    }

    // Juega el siguiente partido pendiente de todo el playoff de ascenso:
    // primero termina cuartos: luego arma y juega la Final Four.
    playNextGame(config) {
      if (!this.isQuarterFinalsComplete) {
        return this.quarterFinals.playNextGame(config);
      }
      this.ensureFinalFour();
      if (this.finalFour.isComplete) {
        throw new Error('PromotionPlayoff.playNextGame: el playoff de ascenso ya está completo');
      }
      return this.finalFour.playNextGame(config);
    }

    getStatus() {
      this.ensureFinalFour();
      return {
        directPromotion: this.directPromotion,
        quarterFinals: this.quarterFinals.getStatus(),
        finalFour: this.finalFour ? this.finalFour.getStatus() : null,
        secondPromotedEntry: this.secondPromotedEntry,
        isComplete: this.isComplete,
      };
    }
  }

  const exportsObj = { PromotionPlayoff };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
