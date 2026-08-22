// src/core/CpuLineup.js
// Alineación automática de equipos gestionados por la CPU — ver DESIGN.md
// 7.11.7. Cierra la limitación señalada en el cierre de 7.11.5: sin esto,
// los equipos que el usuario no controla nunca tenían una alineación real
// (`lineup.entries`, el mismo shape que ya valida Rotation.validateLineup),
// así que MatchEngine caía en `selectOnCourtFive` (sin reparto de minutos
// por jugador) y Recovery.js nunca podía actualizar su `lastMatchDate`.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  const PlayerCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;
  const TeamCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Team.js')
    : global.BasketManager;

  const { POSITIONS } = PlayerCore;
  const { MATCH_SQUAD_MIN, MATCH_SQUAD_MAX } = TeamCore;

  // --- Valoración de jugador ---
  //
  // NOTA (mismatch con DESIGN.md señalado explícitamente, ver respuesta
  // final): 7.11.7 pide reutilizar "el mismo criterio ya usado para las
  // valoraciones en estrellas de 7.11.6", pero 7.11.6 no tiene en realidad
  // ninguna fórmula compuesta de la que extraer nada — la pantalla de
  // Alineación muestra Técnica/Física/Mental como 3 medias SEPARADAS
  // (Player.technicalAverage/physicalAverage/mentalAverage) sin combinarlas
  // en un único número; solo "Forma" (competitionRhythm) se convierte a
  // estrellas, y Energía se muestra como número crudo. No había nada que
  // extraer a una función compartida. Esta función es NUEVA — combina esas
  // 3 medias ya existentes (sin duplicar su cálculo) en una sola puntuación
  // de calidad general 1-20, específicamente para decidir convocatoria y
  // quintetos CPU.
  function playerQualityScore(player) {
    return (player.technicalAverage + player.physicalAverage + player.mentalAverage) / 3;
  }

  // Puntuación de un jugador para UNA posición concreta: combina afinidad
  // posicional (Player.positionLevel — el mismo mapa de posiciones 1-20
  // que ya usa Rotation.js para la polivalencia de emergencia, no se
  // inventa un criterio de afinidad nuevo), calidad general y Energía
  // actual — para que una nota alta con Energía muy baja pueda perder
  // frente a una nota algo menor pero descansada (DESIGN.md 7.11.7).
  function playerPositionScore(player, position, config) {
    const weights = config.cpuLineup.ratingWeights;
    const affinity = player.positionLevel(position); // 1-20
    const quality = playerQualityScore(player); // 1-20
    const energyScore = (player.dynamicState.energy / 100) * 20; // 0-20
    return affinity * weights.affinity + quality * weights.quality + energyScore * weights.energy;
  }

  // Elige por sorteo ponderado entre los N mejores candidatos restantes de
  // una lista ya ordenada de mejor a peor (más peso al mejor, no
  // determinista — DESIGN.md 7.11.7, "variedad deliberada"). Se recorta al
  // tamaño real de `ranked` si hay menos candidatos que `poolSize`.
  function pickFromTopCandidates(ranked, poolSize, poolWeights) {
    const pool = ranked.slice(0, poolSize);
    const weights = poolWeights.slice(0, pool.length);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < pool.length; i += 1) {
      if (roll < weights[i]) return pool[i];
      roll -= weights[i];
    }
    return pool[pool.length - 1];
  }

  // --- Convocatoria ---
  //
  // NOTA (infraestructura necesaria, no una decisión de diseño nueva): el
  // `lineup.entries` generado abajo tiene que referenciar exactamente a los
  // jugadores del `squad` que se pasa como `options.homeSquad`/`awaySquad`
  // a MatchEngine.simulateMatch — si no coinciden, Rotation.buildRotationState
  // construye su mapa de jugadores a partir de ESE squad, y cualquier
  // playerId del lineup que no esté ahí queda huérfano. Por eso
  // buildCpuLineup también decide la convocatoria (no solo el reparto de
  // minutos): se garantiza el mejor jugador de cada una de las 5 posiciones
  // (para que ninguna quede sin ningún especialista razonable) y se
  // completa hasta 12 (o el tamaño de plantilla si es menor) con los
  // mejores por calidad general.
  function pickMatchSquadIds(team) {
    const desiredSize = Math.max(MATCH_SQUAD_MIN, Math.min(MATCH_SQUAD_MAX, team.roster.length));
    const bestByPosition = {};
    const guaranteed = new Set();
    POSITIONS.forEach((position) => {
      let best = team.roster[0];
      team.roster.forEach((player) => {
        if (player.positionLevel(position) > best.positionLevel(position)) best = player;
      });
      bestByPosition[position] = best.id;
      guaranteed.add(best.id);
    });
    // Cobertura real de las 5 posiciones (mini-EPIC POS: con el nuevo
    // modelo de múltiples posiciones en 20, un mismo polivalente puede
    // "ganar" el bucle de arriba en más de una posición a la vez, dejando
    // guaranteed con menos de 5 jugadores DISTINTOS). Para cada posición
    // cuyo mejor candidato ya quedó reservado por OTRA posición, se busca
    // el siguiente mejor candidato de ESA posición que aún no esté
    // garantizado, y se añade también. No cambia nada para jugadores con
    // una sola posición en 20 (el caso de siempre, donde guaranteed.size ya
    // sale en 5 directamente).
    if (guaranteed.size < POSITIONS.length) {
      const claimedBy = new Map(); // playerId -> primera posición que lo reservó
      POSITIONS.forEach((position) => {
        const playerId = bestByPosition[position];
        if (!claimedBy.has(playerId)) {
          claimedBy.set(playerId, position);
          return;
        }
        const nextBest = team.roster
          .filter((player) => !guaranteed.has(player.id))
          .sort((a, b) => b.positionLevel(position) - a.positionLevel(position))[0];
        if (nextBest) guaranteed.add(nextBest.id);
      });
    }
    const ranked = team.roster
      .filter((player) => !guaranteed.has(player.id))
      .sort((a, b) => playerQualityScore(b) - playerQualityScore(a));
    const ids = [...guaranteed];
    ranked.forEach((player) => {
      if (ids.length < desiredSize) ids.push(player.id);
    });
    return ids.slice(0, desiredSize);
  }

  // --- Generación de quinteto/rotación (DESIGN.md 7.11.7) ---
  //
  // `matchImportance` (booleano — decisión de implementación: DESIGN.md
  // deja explícitamente a elección "booleano simple, o 0-1 más granular";
  // se elige booleano porque la propia sección 7.11.7 solo describe dos
  // comportamientos discretos, "clave" / "no clave", nunca una gradación
  // intermedia).
  function buildCpuLineup(team, matchImportance, config) {
    const squadIds = pickMatchSquadIds(team);
    const squad = team.buildMatchSquad(squadIds);
    const cfg = config.cpuLineup;
    const totalMinutes = config.match.durationMinutes;

    const split = matchImportance ? cfg.minutesSplitKeyMatch : cfg.minutesSplit;
    const starterMinutes = Math.round(totalMinutes * split.starter);
    const sub1Minutes = Math.round(totalMinutes * split.sub1);
    const sub2Minutes = totalMinutes - starterMinutes - sub1Minutes;

    // Partido clave: menos aleatoriedad (más peso a la valoración pura).
    // Partido no clave: grupo de candidatos más amplio, más variedad.
    const poolSize = matchImportance ? cfg.keyMatchCandidatePoolSize : cfg.candidatePoolSize;

    const entries = {};

    // Paso 1: quinteto titular — 5 jugadores DISTINTOS (invariante real:
    // nadie puede empezar el partido ocupando dos posiciones a la vez).
    const usedStarters = new Set();
    const starterIdByPosition = {};
    POSITIONS.forEach((position) => {
      const ranked = squad
        .filter((player) => !usedStarters.has(player.id))
        .sort((a, b) => playerPositionScore(b, position, config) - playerPositionScore(a, position, config));
      const pick = pickFromTopCandidates(ranked, poolSize, cfg.candidatePoolWeights);
      starterIdByPosition[position] = pick.id;
      usedStarters.add(pick.id);
    });

    // Pasos 2-3: suplente 1 y 2 — cada posición se puntúa sobre TODA la
    // plantilla convocada de nuevo (sin excluir a quien ya sea titular o
    // suplente en OTRA fila). Un mismo jugador puede repetirse en varias
    // filas/slots de banquillo sin restricción — mismo modelo ya aceptado
    // para la pantalla de Alineación humana (ver CLAUDE.md, "Interfaz de
    // juego"), y refleja con realismo la profundidad de banco corta de una
    // plantilla de 8-12 convocados repartida en 5 posiciones × 3 slots.
    // "Si la plantilla en esa posición tiene menos de `poolSize` jugadores
    // con afinidad, usa los que haya sin bloquear la generación" (DESIGN.md
    // 7.11.7) queda cubierto de forma natural: se puntúa siempre sobre el
    // squad COMPLETO, así que nunca hay "candidatos insuficientes" — un
    // jugador de otra posición con menos afinidad simplemente puntúa más
    // bajo, pero sigue siendo un candidato válido.
    POSITIONS.forEach((position) => {
      const ranked = squad
        .slice()
        .sort((a, b) => playerPositionScore(b, position, config) - playerPositionScore(a, position, config));

      const startedId = starterIdByPosition[position];
      const sub1Pick = pickFromTopCandidates(ranked, poolSize, cfg.candidatePoolWeights);
      const sub2Pick = pickFromTopCandidates(ranked, poolSize, cfg.candidatePoolWeights);

      let starterQuota = starterMinutes;
      let sub1Quota = sub1Minutes;
      const starter = squad.find((player) => player.id === startedId);

      // DESIGN.md 7.11.7: en partido NO clave, un titular con Energía muy
      // baja reduce su cuota en favor del siguiente candidato (sub1) — en
      // partido clave se acepta jugarlo igual con más minutos de lo
      // habitual, así que esta reducción no se aplica.
      if (!matchImportance && starter.dynamicState.energy < cfg.lowEnergyThreshold) {
        starterQuota = sub1Minutes;
        sub1Quota = starterMinutes;
      }

      entries[position] = {
        starter: { playerId: startedId, minutesQuota: starterQuota },
        sub1: { playerId: sub1Pick.id, minutesQuota: sub1Quota },
        sub2: { playerId: sub2Pick.id, minutesQuota: sub2Minutes },
      };
    });

    return { squad, lineup: { entries, fixedSegments: [], garbageTime: { enabled: false } } };
  }

  // --- Importancia del partido (DESIGN.md 7.11.7, apartado 2.2) ---
  //
  // NOTA HISTÓRICA (resuelta, ver DESIGN.md 3.4.3): en la sesión original
  // de CPU Lineup, `team.board.sportingGoal` solo variaba de verdad para
  // equipos FICTICIOS (generados por teamGenerator.js, uno de 'Evitar el
  // descenso'/'Consolidarse en la categoría'/'Optar a playoffs'/'Pelear
  // por el título'). Los equipos REALES (los únicos seleccionables desde
  // "Empezar temporada", ver CLAUDE.md) no traían `board` en los datos
  // importados, así que Team.js les asignaba el valor por defecto fijo
  // 'Permanencia' — un 5º valor que ni siquiera pertenecía al vocabulario
  // de teamGenerator.js. Con eso, TODOS los equipos (usuario y rivales)
  // tenían literalmente el mismo objetivo, así que esta señal quedaba
  // inerte en una partida real: siempre resolvía a la zona baja de tabla
  // para todo el mundo — se implementó la lógica exactamente como la
  // describe 7.11.7, lista para funcionar en cuanto existieran objetivos
  // de temporada reales, señalando explícitamente que todavía no
  // discriminaba nada entre equipos reales.
  //
  // Ya resuelto (sesión de cierre de ciclo de temporada): `SeasonGoals.js`
  // calcula `sportingGoal` real y variable por equipo (percentil de
  // overall + reputación), y `startSeason()` en `game.js` lo recalcula
  // tanto al arrancar una partida nueva como en cada cierre de ciclo — la
  // señal que consume esta función ya es real para los 36 equipos,
  // incluidos los reales.
  const HIGH_ZONE_GOALS = new Set(['Pelear por el título', 'Optar a playoffs']);
  const LOW_ZONE_GOALS = new Set(['Evitar el descenso', 'Permanencia']);

  function findTeamRank(team, standingsTable) {
    const index = standingsTable.findIndex((row) => row.team.id === team.id);
    return index === -1 ? null : index + 1; // 1-indexed, coincide con "posición" de la tabla
  }

  // `competition`: 'league' para partidos de liga regular (única para la
  // que se evalúa clasificación/objetivo); cualquier otro valor
  // (convención de esta integración: 'bracket', cubre Copa desde cuartos,
  // Playoff por el título y Playoff de ascenso — ver nota en la respuesta
  // final sobre por qué no se distingue cuál de los tres) se trata siempre
  // como partido clave, sin mirar la tabla.
  function computeMatchImportance(team, opponent, competition, standingsTable, config) {
    if (competition !== 'league') return true;

    const goal = team.board.sportingGoal;
    let frontier;
    if (HIGH_ZONE_GOALS.has(goal)) {
      frontier = 8; // corte de Copa/Playoff por el título (Cup.js/Playoffs.js: top8)
    } else if (LOW_ZONE_GOALS.has(goal)) {
      frontier = standingsTable.length - 1; // DESIGN.md 3.2: 2 plazas de descenso, los 2 últimos
    } else {
      return false; // objetivo neutro ('Consolidarse en la categoría' u otro no reconocido): sin señal de zona
    }

    const band = config.cpuMatchImportance.standingsBandSize;
    const teamRank = findTeamRank(team, standingsTable);
    const opponentRank = findTeamRank(opponent, standingsTable);
    if (teamRank === null || opponentRank === null) return false;

    return Math.abs(teamRank - frontier) <= band && Math.abs(opponentRank - frontier) <= band;
  }

  const exportsObj = {
    buildCpuLineup,
    computeMatchImportance,
    playerQualityScore,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
