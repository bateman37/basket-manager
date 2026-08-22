// src/core/League.js
// Entidad Liga y Calendario — FASE 1 (ver DESIGN.md sección 3.1).
// Convención del proyecto: identificadores en inglés, comentarios en español.
//
// Alcance de esta fase: SOLO 1ª división (18 equipos), sin playoffs, sin
// ascensos/descensos, sin Copa/Supercopa todavía — ver "Pendiente" al
// final de DESIGN.md 3.1. Reutiliza el motor de partidos ya existente
// (MatchEngine.simulateMatch) para simular cada partido del calendario.

(function (global) {
  const MatchEngineCore = (typeof module !== 'undefined' && module.exports)
    ? require('./MatchEngine.js')
    : global.BasketManager;

  const { simulateMatch } = MatchEngineCore;

  const TEAM_COUNT = 18;
  // Puntuación real FIBA/ACB — DESIGN.md 3.1: 2 puntos por victoria, 1 por
  // derrota. NO es el sistema 3-1-0 de fútbol.
  const WIN_POINTS = 2;
  const LOSS_POINTS = 1;

  // --- Generación de calendario: algoritmo del círculo (round-robin) ---

  // Genera una vuelta simple (round-robin de una sola ronda): cada equipo
  // juega exactamente una vez contra cada rival, en `teams.length - 1`
  // jornadas. El equipo en la posición 0 queda fijo; el resto rota una
  // posición cada jornada (método del círculo estándar).
  function generateSingleRoundRobin(teamCount) {
    if (teamCount % 2 !== 0) {
      throw new Error('generateSingleRoundRobin requiere un número par de equipos');
    }
    const roundsCount = teamCount - 1;
    const half = teamCount / 2;
    const fixed = 0;
    let rotating = [];
    for (let i = 1; i < teamCount; i++) rotating.push(i);

    const rounds = [];
    for (let round = 0; round < roundsCount; round++) {
      const positions = [fixed, ...rotating];
      const pairs = [];
      for (let i = 0; i < half; i++) {
        const a = positions[i];
        const b = positions[teamCount - 1 - i];
        // Alterna qué lado es local según la paridad de la jornada, para
        // no dejar siempre al mismo equipo (sobre todo el fijo) de local
        // o de visitante durante toda la ida.
        const [homeIndex, awayIndex] = round % 2 === 0 ? [a, b] : [b, a];
        pairs.push({ homeIndex, awayIndex });
      }
      rounds.push(pairs);
      // Rotar: el último elemento pasa al principio, el resto se desplaza.
      rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)];
    }
    return rounds; // array de (teamCount-1) jornadas, cada una con (teamCount/2) pares {homeIndex, awayIndex}
  }

  // `dateResolver` (opcional, DESIGN.md 3.3 — Entidad Calendario):
  // `(round, matchIndexInRound, matchesInRound, totalRounds) => Date`,
  // normalmente `Calendar.leagueMatchDateTime` ya ligado a una instancia y
  // a una división (CAL-1: firma ampliada respecto a la versión anterior,
  // que solo recibía `round` — necesaria para poder dar horario real POR
  // PARTIDO en vez de por jornada, ver DESIGN.md 3.3.1. `dateResolver` es
  // un contrato interno entre League.js y quien construye la Liga
  // —game.js—, no una API pública documentada en otro sitio, así que
  // ampliar su firma aquí no rompe nada externo). Sin él, `date` queda en
  // `null` — comportamiento idéntico al de antes de existir Calendar.js.
  function createMatch(round, homeTeam, awayTeam, dateResolver, matchIndexInRound, matchesInRound, totalRounds) {
    return {
      round,
      homeTeam,
      awayTeam,
      status: 'pending', // 'pending' | 'played'
      result: null, // se rellena con el resultado completo de MatchEngine.simulateMatch()
      date: dateResolver ? dateResolver(round, matchIndexInRound, matchesInRound, totalRounds) : null,
    };
  }

  // Calendario completo: 34 jornadas (17 ida + 17 vuelta) — DESIGN.md 3.1.
  // La vuelta repite exactamente los mismos enfrentamientos de la ida con
  // local/visitante invertido.
  function generateSchedule(teams, dateResolver) {
    if (teams.length !== TEAM_COUNT) {
      throw new Error(`El calendario de Fase 1 requiere exactamente ${TEAM_COUNT} equipos (recibidos: ${teams.length})`);
    }
    const firstLegRounds = generateSingleRoundRobin(teams.length);
    const totalRounds = (teams.length - 1) * 2;
    const schedule = [];
    let roundNumber = 1;

    firstLegRounds.forEach((pairs) => {
      pairs.forEach(({ homeIndex, awayIndex }, matchIndexInRound) => {
        schedule.push(createMatch(
          roundNumber, teams[homeIndex], teams[awayIndex], dateResolver, matchIndexInRound, pairs.length, totalRounds,
        ));
      });
      roundNumber += 1;
    });
    firstLegRounds.forEach((pairs) => {
      pairs.forEach(({ homeIndex, awayIndex }, matchIndexInRound) => {
        schedule.push(createMatch( // vuelta: local/visitante invertido
          roundNumber, teams[awayIndex], teams[homeIndex], dateResolver, matchIndexInRound, pairs.length, totalRounds,
        ));
      });
      roundNumber += 1;
    });
    return schedule;
  }

  // --- Clasificación ---

  function createEmptyStanding(team) {
    return {
      team,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifference: 0,
      points: 0, // puntos de clasificación (2 victoria / 1 derrota)
      quotientSum: 0, // paso 5 del desempate: suma de cocientes PF/PA partido a partido
    };
  }

  function updateStandingWithResult(standing, pointsFor, pointsAgainst) {
    standing.played += 1;
    standing.pointsFor += pointsFor;
    standing.pointsAgainst += pointsAgainst;
    standing.pointDifference = standing.pointsFor - standing.pointsAgainst;
    // pointsAgainst no debería ser nunca 0 en un partido real de baloncesto,
    // pero se protege igualmente por seguridad.
    standing.quotientSum += pointsAgainst > 0 ? pointsFor / pointsAgainst : pointsFor;
    if (pointsFor > pointsAgainst) {
      standing.wins += 1;
      standing.points += WIN_POINTS;
    } else {
      standing.losses += 1;
      standing.points += LOSS_POINTS;
    }
  }

  // --- Criterio de desempate (DESIGN.md 3.1, normativa real ACB) ---
  //
  // 5 pasos, en orden. Los pasos 1-2 se calculan SOLO entre los equipos
  // que siguen empatados en ese momento (mini-liga); los pasos 3-5 son
  // estadísticas generales de toda la liga regular (no dependen del grupo).
  // Cada paso es una función (teamId, currentGroupIds, context) => número
  // (más alto = mejor puesto).

  // Suma los resultados de un equipo SOLO contra los rivales indicados
  // (el resto del grupo que sigue empatado con él en este momento).
  function mutualStatsAgainstGroup(teamId, groupIds, headToHead) {
    const opponents = headToHead.get(teamId) || new Map();
    let wins = 0;
    let losses = 0;
    let pointsFor = 0;
    let pointsAgainst = 0;
    groupIds.forEach((opponentId) => {
      if (opponentId === teamId) return;
      const stats = opponents.get(opponentId);
      if (!stats) return; // todavía no se han enfrentado (liga incompleta)
      wins += stats.wins;
      losses += stats.losses;
      pointsFor += stats.pointsFor;
      pointsAgainst += stats.pointsAgainst;
    });
    return { wins, losses, pointsFor, pointsAgainst };
  }

  const TIEBREAK_STEPS = [
    // 1. Balance de victorias-derrotas en los enfrentamientos MUTUOS del grupo.
    (teamId, groupIds, ctx) => {
      const s = mutualStatsAgainstGroup(teamId, groupIds, ctx.headToHead);
      return s.wins - s.losses;
    },
    // 2. Diferencia de puntos en esos enfrentamientos directos ("basket average particular").
    (teamId, groupIds, ctx) => {
      const s = mutualStatsAgainstGroup(teamId, groupIds, ctx.headToHead);
      return s.pointsFor - s.pointsAgainst;
    },
    // 3. Diferencia de puntos GENERAL de toda la liga regular (no depende del grupo).
    (teamId, groupIds, ctx) => ctx.standings.get(teamId).pointDifference,
    // 4. Puntos anotados en TODA la liga regular.
    (teamId, groupIds, ctx) => ctx.standings.get(teamId).pointsFor,
    // 5. Suma de cocientes de tantos a favor y en contra de toda la liga.
    (teamId, groupIds, ctx) => ctx.standings.get(teamId).quotientSum,
  ];

  // Agrupa ids por score exacto (mismo score = siguen empatados en este
  // paso), ordenado de mejor a peor.
  function groupByScoreDescending(scoredIds) {
    const byScore = new Map();
    scoredIds.forEach(({ id, score }) => {
      if (!byScore.has(score)) byScore.set(score, []);
      byScore.get(score).push(id);
    });
    return [...byScore.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, ids]) => ids);
  }

  // Ejecuta los 5 pasos en orden para `teamIds` (un grupo empatado a
  // puntos, o un subgrupo que sigue empatado tras pasos anteriores).
  // `cycleStartSize`: tamaño del grupo al empezar ESTE ciclo de 5 pasos —
  // sirve para detectar, si se agotan los 5 pasos sin separar a nadie, si
  // hace falta reiniciar el proceso (ver resolveTiedGroup).
  function runTiebreakCycle(teamIds, context, stepIndex, cycleStartSize) {
    if (teamIds.length <= 1) return teamIds;
    if (stepIndex >= TIEBREAK_STEPS.length) {
      // Se agotaron los 5 pasos y este (sub)grupo sigue empatado entre sí:
      // DESIGN.md 3.1 dice que se repite el proceso completo desde el
      // paso 1, como una mini-liga NUEVA restringida a este subgrupo (que
      // puede ser más pequeño que el grupo con el que se calcularon los
      // pasos 1-2 la vez anterior, si en algún paso posterior se separaron
      // ya algunos equipos del grupo original).
      return resolveTiedGroup(teamIds, context, cycleStartSize);
    }
    const scoreFn = TIEBREAK_STEPS[stepIndex];
    const scored = teamIds.map((id) => ({ id, score: scoreFn(id, teamIds, context) }));
    const groups = groupByScoreDescending(scored);
    const result = [];
    groups.forEach((subgroup) => {
      if (subgroup.length === 1) {
        result.push(subgroup[0]);
      } else {
        result.push(...runTiebreakCycle(subgroup, context, stepIndex + 1, cycleStartSize));
      }
    });
    return result;
  }

  // Punto de entrada de la resolución de un grupo empatado a puntos.
  // `previousCycleSize`: si se indica y coincide EXACTAMENTE con el
  // tamaño actual del grupo, significa que el ciclo de 5 pasos anterior no
  // separó a NADIE de este grupo — un empate genuinamente irresoluble con
  // estos criterios (ej. dos equipos estadísticamente idénticos en todo).
  // Se corta aquí para no reiniciar en bucle infinito; el grupo se
  // devuelve en un orden estable (no aleatorio) tal cual llegó.
  function resolveTiedGroup(teamIds, context, previousCycleSize) {
    if (teamIds.length <= 1) return teamIds;
    if (previousCycleSize !== undefined && teamIds.length === previousCycleSize) {
      return teamIds;
    }
    return runTiebreakCycle(teamIds, context, 0, teamIds.length);
  }

  // Construye la tabla de clasificación completa, ordenada: primero por
  // puntos de clasificación (descendente), y dentro de cada grupo de
  // equipos empatados a puntos, aplicando el criterio de desempate de 5
  // pasos (o la mini-liga recursiva si hay 3 o más empatados).
  function buildOrderedStandings(teams, standingsMap, headToHead) {
    const byPoints = new Map();
    teams.forEach((team) => {
      const pts = standingsMap.get(team.id).points;
      if (!byPoints.has(pts)) byPoints.set(pts, []);
      byPoints.get(pts).push(team.id);
    });
    const pointsGroups = [...byPoints.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids);

    const context = { headToHead, standings: standingsMap };
    const orderedIds = [];
    pointsGroups.forEach((group) => {
      if (group.length === 1) {
        orderedIds.push(group[0]);
      } else {
        orderedIds.push(...resolveTiedGroup(group, context));
      }
    });
    return orderedIds.map((id) => standingsMap.get(id));
  }

  // --- Liga ---

  class League {
    // `dateResolver` (opcional, DESIGN.md 3.3): ver createMatch() arriba.
    // Añadido como 2º parámetro nuevo — no rompe ninguna llamada existente
    // `new League(teams)`, que sigue funcionando igual (fechas a null).
    constructor(teams, dateResolver) {
      this.teams = teams;
      this.schedule = generateSchedule(teams, dateResolver);
      this.totalRounds = (teams.length - 1) * 2; // 34
      this.currentRound = 1;

      this.standings = new Map();
      teams.forEach((team) => this.standings.set(team.id, createEmptyStanding(team)));

      // headToHead: Map<teamId, Map<opponentId, {wins,losses,pointsFor,pointsAgainst}>>
      // — necesario para los pasos 1-2 del desempate (enfrentamientos directos).
      this.headToHead = new Map();
      teams.forEach((team) => this.headToHead.set(team.id, new Map()));
    }

    get isSeasonComplete() {
      return this.currentRound > this.totalRounds;
    }

    // Partidos de la jornada actual (pendientes hasta que se simulen).
    getCurrentRoundMatches() {
      return this.schedule.filter((match) => match.round === this.currentRound);
    }

    recordHeadToHead(teamId, opponentId, pointsFor, pointsAgainst) {
      const opponents = this.headToHead.get(teamId);
      const existing = opponents.get(opponentId) || { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
      existing.pointsFor += pointsFor;
      existing.pointsAgainst += pointsAgainst;
      if (pointsFor > pointsAgainst) existing.wins += 1;
      else existing.losses += 1;
      opponents.set(opponentId, existing);
    }

    recordResult(homeTeam, awayTeam, homeScore, awayScore) {
      updateStandingWithResult(this.standings.get(homeTeam.id), homeScore, awayScore);
      updateStandingWithResult(this.standings.get(awayTeam.id), awayScore, homeScore);
      this.recordHeadToHead(homeTeam.id, awayTeam.id, homeScore, awayScore);
      this.recordHeadToHead(awayTeam.id, homeTeam.id, awayScore, homeScore);
    }

    // CAL-1 (DESIGN.md 3.3, resolución cronológica): resuelve UN partido
    // PENDIENTE concreto del calendario — pieza base sobre la que se
    // construye tanto la resolución de un partido suelto (partido del
    // usuario en su horario real) como la de "todo lo vencido hasta una
    // fecha" (resolveMatchesBefore) o la de una jornada entera de golpe
    // (simulateNextRound, ahora un wrapper de conveniencia sobre esto).
    // Mismo patrón que `Bracket/Series.playNextGame()`, pero aquí no hay un
    // cursor interno de "siguiente partido de la serie": es quien llama
    // quien decide qué `match` concreto tocar.
    resolveMatch(match, config, resolveMatchOptions) {
      if (match.status === 'played') {
        throw new Error('League.resolveMatch: el partido ya está jugado');
      }
      const options = resolveMatchOptions ? resolveMatchOptions(match) : undefined;
      const result = simulateMatch(match.homeTeam, match.awayTeam, config, options);
      match.status = 'played';
      match.result = result;
      this.recordResult(match.homeTeam, match.awayTeam, result.finalScore.home, result.finalScore.away);
      this.advanceCurrentRoundPointer();
      return match;
    }

    // Avanza `currentRound` mientras la jornada que señala esté completa.
    // Antes de CAL-1 esta invariante la garantizaba `simulateNextRound()`
    // resolviendo toda la jornada de un golpe; con resolución parcial
    // (partidos sueltos, DESIGN.md 3.3) tiene que reevaluarse cada vez que
    // se resuelve un partido individual, venga de donde venga.
    advanceCurrentRoundPointer() {
      while (this.currentRound <= this.totalRounds) {
        const roundMatches = this.getCurrentRoundMatches();
        if (roundMatches.length === 0 || !roundMatches.every((m) => m.status === 'played')) break;
        this.currentRound += 1;
      }
    }

    // Partidos PENDIENTES de todo el calendario con fecha estrictamente
    // anterior a `beforeDateTime`, en orden cronológico (DESIGN.md 3.3). En
    // la práctica, como una jornada no avanza hasta estar completa
    // (advanceCurrentRoundPointer), solo puede haber partidos pendientes en
    // `currentRound` — pero se consulta sobre todo `schedule` para no
    // depender de ese invariante interno.
    getPendingMatchesBefore(beforeDateTime) {
      return this.schedule
        .filter((match) => match.status === 'pending' && match.date && match.date < beforeDateTime)
        .sort((a, b) => a.date - b.date);
    }

    // Resuelve, en orden cronológico, todos los partidos pendientes con
    // fecha anterior a `beforeDateTime` — la pieza que usa el reloj de
    // mundo (game.js) para "saltar" los partidos CPU-CPU anteriores al del
    // usuario sin necesidad de resolver la jornada entera de golpe
    // (DESIGN.md 3.3/sección 5 de CAL-1: lo anterior a la hora del usuario
    // debe existir como resultado antes de que juegue el suyo).
    resolveMatchesBefore(beforeDateTime, config, resolveMatchOptions) {
      return this.getPendingMatchesBefore(beforeDateTime)
        .map((match) => this.resolveMatch(match, config, resolveMatchOptions));
    }

    // Simula TODOS los partidos PENDIENTES de la jornada actual de golpe
    // (reutiliza resolveMatch para cada uno), actualiza la clasificación y
    // avanza el puntero a la siguiente jornada en cuanto queda completa.
    // Devuelve los partidos recién jugados por ESTA llamada (ya con
    // `result` relleno) — si parte de la jornada ya se había resuelto antes
    // por otra vía (resolveMatchesBefore), esos partidos ya estaban
    // 'played' y no se incluyen aquí ni se vuelven a simular.
    //
    // CAL-1: wrapper de compatibilidad — antes de esta entrega era el
    // ÚNICO camino para resolver partidos de Liga; se mantiene con el mismo
    // contrato (mismo nombre, misma firma, misma jornada de una sola vez
    // desde el punto de vista de quien la llama) para no romper a quien ya
    // la usa así (`simulateBackgroundRound`, el "bye" defensivo de
    // game.js) — por dentro ya no repite la lógica de simulación, delega en
    // `resolveMatch`.
    //
    // `resolveMatchOptions` (opcional, DESIGN.md 7.11.6 — pantalla de
    // Alineación): callback `(match) => options|undefined` que permite
    // pasar `options.home/awaySquad`+`home/awayLineup` a MatchEngine para
    // el partido concreto del usuario, sin afectar al resto de la jornada.
    simulateNextRound(config, resolveMatchOptions) {
      if (this.isSeasonComplete) {
        throw new Error('La temporada ya ha terminado: no quedan jornadas por simular');
      }
      const matches = this.getCurrentRoundMatches().filter((match) => match.status === 'pending');
      matches.forEach((match) => this.resolveMatch(match, config, resolveMatchOptions));
      return matches;
    }

    // Clasificación ordenada aplicando el criterio de desempate (3.1).
    getStandingsTable() {
      return buildOrderedStandings(this.teams, this.standings, this.headToHead);
    }
  }

  const exportsObj = { League, generateSchedule, TEAM_COUNT, WIN_POINTS, LOSS_POINTS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
