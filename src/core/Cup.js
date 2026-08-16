// src/core/Cup.js
// Copa — ver DESIGN.md sección 3.2.2. Bracket de partido único con los 8
// primeros de la clasificación de una Liga justo al completar su jornada
// 17 (fin de la "ida"). No altera el estado de la Liga regular: solo lee
// una foto de getStandingsTable() en ese momento — la liga sigue
// avanzando con normalidad después (jornada 18 en adelante).

(function (global) {
  const BracketCore = (typeof module !== 'undefined' && module.exports)
    ? require('./Bracket.js')
    : global.BasketManager;

  const { Bracket, VENUE_PATTERNS } = BracketCore;

  const CUP_TRIGGER_ROUND = 17; // jornada que debe estar recién completada

  // Mismo orden de bracket que el playoff por el título (ver Playoffs.js /
  // Bracket.js): el 1º y el 2º solo se cruzan en la final.
  const FIRST_ROUND_PAIRING = [[1, 8], [4, 5], [2, 7], [3, 6]];

  // DESIGN.md 3.2.2: todas las rondas a partido único (sin ida/vuelta).
  const ROUND_PATTERNS = [
    VENUE_PATTERNS.SINGLE_GAME,
    VENUE_PATTERNS.SINGLE_GAME,
    VENUE_PATTERNS.SINGLE_GAME,
  ];

  // `league`: instancia de League justo con la jornada 17 recién jugada
  // (league.currentRound === 18). Se exige el valor EXACTO, no solo
  // ">= 18", para no capturar por error la clasificación de un momento
  // posterior de la temporada si se llama tarde.
  //
  // Nota de implementación: DESIGN.md no especifica quién es local en cada
  // partido de Copa (a diferencia de los playoffs, que sí lo dicen
  // explícitamente). Aquí se asume, por coherencia con el resto de 3.2,
  // que el mejor clasificado en ese momento hace de local en cada ronda.
  // Es una interpretación de implementación, no una regla confirmada por
  // Dennis — señalado también en el resumen final.
  function createCup(league) {
    if (league.currentRound !== CUP_TRIGGER_ROUND + 1) {
      throw new Error(
        `createCup: la liga debe tener la jornada ${CUP_TRIGGER_ROUND} recién completada (currentRound esperado: ${CUP_TRIGGER_ROUND + 1}, actual: ${league.currentRound})`,
      );
    }
    const top8 = league.getStandingsTable().slice(0, 8);
    const entries = top8.map((standing, index) => ({ team: standing.team, seed: index + 1 }));
    return new Bracket(entries, FIRST_ROUND_PAIRING, ROUND_PATTERNS);
  }

  const exportsObj = { createCup, CUP_TRIGGER_ROUND };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
