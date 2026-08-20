// src/core/SeasonGoals.js
// Cálculo de board.sportingGoal en pretemporada — DESIGN.md 3.4.3. Cierra
// el hueco señalado en el CHANGELOG de CpuLineup.js/7.11.7: los equipos
// reales no traían `board.sportingGoal` en los datos importados, así que
// Team.js les asignaba a TODOS el mismo valor fijo ('Permanencia'), una
// señal inerte para CpuLineup.computeMatchImportance(). Convención del
// proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  // Mismo cálculo que scripts/rescale-real-attributes.js
  // (playerOverall/top8Rating): media simple de TODOS los atributos
  // technical/physical/mental de un jugador, y media del top8 de una
  // plantilla por ese criterio. Reimplementado aquí en vez de requerido
  // desde ese script — es un CLI de Node con fs/path, no cargable en el
  // navegador — pero es la MISMA fórmula exacta, no una nueva.
  const RESCALED_GROUPS = ['technical', 'physical', 'mental'];
  const TOP_N = 8;

  function playerOverall(player) {
    const values = [];
    RESCALED_GROUPS.forEach((group) => {
      Object.values(player[group]).forEach((value) => values.push(value));
    });
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  function top8Rating(roster) {
    const sorted = [...roster].map(playerOverall).sort((a, b) => b - a);
    const top = sorted.slice(0, TOP_N);
    return top.reduce((sum, v) => sum + v, 0) / top.length;
  }

  // Percentil 0-100 del top8Rating de cada equipo DENTRO de los `teams`
  // recibidos (se espera la división completa, 18 equipos — el percentil
  // no tiene sentido calculado sobre un subconjunto) — 0 = el más bajo de
  // esa división, 100 = el más alto.
  function computeOverallPercentiles(teams) {
    const ranked = teams
      .map((team) => ({ team, rating: top8Rating(team.roster) }))
      .sort((a, b) => a.rating - b.rating);
    const n = ranked.length;
    const percentileByTeamId = new Map();
    ranked.forEach((entry, index) => {
      percentileByTeamId.set(entry.team.id, n > 1 ? (index / (n - 1)) * 100 : 50);
    });
    return percentileByTeamId;
  }

  // DESIGN.md 3.4.3, fórmula exacta:
  //   poderCombinado = percentilPlantilla*0.5 + reputation.financial*0.5
  //   señalFinal     = poderCombinado*0.7 + reputation.sporting*0.3
  // mapeada a los 4 SPORTING_GOALS (teamGenerator.js) por los umbrales de
  // config.seasonGoals (MatchConfig.js) — valores de partida, ajustables.
  function computeSportingGoal(team, percentilPlantilla, config) {
    const thresholds = config.seasonGoals;
    const poderCombinado = percentilPlantilla * 0.5 + team.reputation.financial * 0.5;
    const señalFinal = poderCombinado * 0.7 + team.reputation.sporting * 0.3;
    if (señalFinal >= thresholds.titleThreshold) return 'Pelear por el título';
    if (señalFinal >= thresholds.playoffThreshold) return 'Optar a playoffs';
    if (señalFinal >= thresholds.stayUpThreshold) return 'Consolidarse en la categoría';
    return 'Evitar el descenso';
  }

  // Recalcula board.sportingGoal de TODOS los `teams` recibidos a la vez
  // (necesita la división completa para el percentil, no equipo a
  // equipo) — no toca financialGoal ni multiYearPlan (DESIGN.md 3.4.3,
  // explícitamente fuera de alcance).
  function recalculateSportingGoalsForDivision(teams, config) {
    const percentiles = computeOverallPercentiles(teams);
    teams.forEach((team) => {
      team.board.sportingGoal = computeSportingGoal(team, percentiles.get(team.id), config);
    });
  }

  const exportsObj = {
    computeOverallPercentiles,
    computeSportingGoal,
    recalculateSportingGoalsForDivision,
    top8Rating,
    playerOverall,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
