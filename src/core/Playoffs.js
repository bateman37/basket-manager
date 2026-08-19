// src/core/Playoffs.js
// Playoff por el título — 1ª división (ver DESIGN.md sección 3.2.1).
// Construye el bracket de los 8 primeros de una Liga con la temporada
// regular ya completa, reutilizando Bracket.js. No modifica League.js.

(function (global) {
  const BracketCore = (typeof module !== 'undefined' && module.exports)
    ? require('./Bracket.js')
    : global.BasketManager;

  const { Bracket, VENUE_PATTERNS } = BracketCore;

  // Emparejamientos de cuartos EN ORDEN DE BRACKET (ver comentario en
  // Bracket.js): así el 1º y el 2º clasificados solo pueden cruzarse en
  // la final, como exige un bracket de seeding estándar.
  const FIRST_ROUND_PAIRING = [[1, 8], [4, 5], [2, 7], [3, 6]];

  // DESIGN.md 3.2.1: cuartos al mejor de 3 (1-1-1), semis y final al
  // mejor de 5 (2-2-1).
  const TITLE_PLAYOFF_ROUND_PATTERNS = [
    VENUE_PATTERNS.BEST_OF_3_1_1_1,
    VENUE_PATTERNS.BEST_OF_5_2_2_1,
    VENUE_PATTERNS.BEST_OF_5_2_2_1,
  ];

  // `league`: instancia de League con la temporada regular ya completa
  // (league.isSeasonComplete === true). `dateResolver` (opcional,
  // DESIGN.md 3.3): `(roundIndex, gameIndexInSeries) => Date`, construido
  // por quien llama con `Calendar.buildBracketDateResolver(startDate,
  // TITLE_PLAYOFF_ROUND_PATTERNS)` — se exporta este último array justo
  // para eso, y así no hay que duplicarlo en dos sitios. Sin `dateResolver`,
  // las fechas de los partidos quedan en null (comportamiento de siempre).
  // Devuelve un Bracket ya listo para jugar con
  // Bracket.playNextGame(config)/getStatus().
  function createTitlePlayoff(league, dateResolver) {
    if (!league.isSeasonComplete) {
      throw new Error('createTitlePlayoff: la liga regular todavía no ha terminado (faltan jornadas)');
    }
    const top8 = league.getStandingsTable().slice(0, 8);
    const entries = top8.map((standing, index) => ({ team: standing.team, seed: index + 1 }));
    return new Bracket(entries, FIRST_ROUND_PAIRING, TITLE_PLAYOFF_ROUND_PATTERNS, dateResolver);
  }

  const exportsObj = { createTitlePlayoff, TITLE_PLAYOFF_ROUND_PATTERNS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
