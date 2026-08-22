// src/core/Events.js
// Modelo de evento único para Agenda y Noticias — ver DESIGN.md 3.5 (CAL-2).
// Módulo puro: no conoce `state`/`BM`, ni el DOM, ni cómo se dispara cada
// hecho — recibe datos ya reales (partidos resueltos, clasificaciones,
// equipos) y devuelve objetos de evento. Quien orquesta CUÁNDO se llama a
// cada builder (justo al resolverse cada hecho real) es `src/ui/game.js`.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// REGLA NO NEGOCIABLE (DESIGN.md 3.5): toda noticia deriva de un hecho ya
// ocurrido en el estado real de la partida — ningún builder de aquí
// inventa un dato, todos reciben ya construidos los objetos reales
// (match/result/standings/equipo) de los que derivan el texto.

(function (global) {
  // --- Catálogo de tipos de evento (DESIGN.md 3.5) ---
  // Catálogo ABIERTO y documentado, no cerrado: 'match'/'competition'/'news'
  // son los únicos tipos que esta entrega genera de verdad. Los de STEP 3
  // (Jugador Vivo/Progresión/Entrenamiento/Lesiones, sesión de diseño
  // aparte todavía sin hacer) quedan reservados aquí solo como catálogo —
  // NUNCA se construye ningún evento de estos tipos en esta entrega.
  const EVENT_TYPES = ['match', 'competition', 'news'];
  const RESERVED_FUTURE_EVENT_TYPES = ['training', 'medical', 'scouting', 'market', 'contract', 'board'];

  const NEWS_PRIORITIES = ['alta', 'media', 'baja'];
  // Catálogo de categorías de noticia soportadas hoy (DESIGN.md 3.5) — cada
  // una tiene una fuente real auditada, ver builders correspondientes más
  // abajo. 'streak' y 'surprise' usan datos reales ya existentes
  // (schedule/reputation); NO se implementa 'milestone' (hitos de carrera)
  // por falta de histórico real de estadísticas por jugador entre
  // temporadas — señalado explícitamente, no un olvido.
  const NEWS_CATEGORIES = ['result', 'performance', 'streak', 'standings', 'competition', 'tactical', 'surprise'];

  let eventIdCounter = 0;
  function nextEventId(prefix) {
    eventIdCounter += 1;
    return `${prefix}-${eventIdCounter}`;
  }

  // Constructor único — asegura que TODO evento (Agenda o Noticias) tiene
  // exactamente el mismo shape, con los campos no aplicables a `null`
  // (nunca `undefined`, para no obligar a comprobar dos formas de "vacío").
  function makeEvent(fields) {
    return {
      id: fields.id,
      type: fields.type,
      dateTime: fields.dateTime,
      title: fields.title,
      relatedCompetition: fields.relatedCompetition || null,
      relatedTeam: fields.relatedTeam || null,
      relatedPlayer: fields.relatedPlayer || null,
      requiresAttention: !!fields.requiresAttention,
      status: fields.status || 'resolved',
      // Solo relevantes para `type: 'news'` — `null` en 'match'/'competition'.
      newsCategory: fields.newsCategory || null,
      priority: fields.priority || null,
      body: fields.body || null,
    };
  }

  // ------------------------------------------------------------------
  // Agenda: evento "partido" — funciona igual para un partido de Liga que
  // para un partido de bracket (Copa/Playoff/Ascenso), siempre que quien
  // llama normalice el shape a `{ homeTeam, awayTeam, date, status,
  // result }` (game.js ya sabe hacer esto — mismo patrón que
  // `playBracketGameWithReveal` usa para `state.pendingUserMatch`).
  // ------------------------------------------------------------------
  function buildMatchAgendaEvent(normalizedMatch, opts = {}) {
    const isPlayed = normalizedMatch.status === 'played';
    const title = isPlayed
      ? `${normalizedMatch.homeTeam.fullName} ${normalizedMatch.result.finalScore.home} — `
        + `${normalizedMatch.result.finalScore.away} ${normalizedMatch.awayTeam.fullName}`
      : `${normalizedMatch.homeTeam.fullName} vs ${normalizedMatch.awayTeam.fullName}`;
    return makeEvent({
      id: opts.id || nextEventId('match'),
      type: 'match',
      dateTime: normalizedMatch.date,
      title,
      relatedCompetition: opts.relatedCompetition,
      status: isPlayed ? 'resolved' : 'pending',
      requiresAttention: !!opts.requiresAttention,
    });
  }

  // ------------------------------------------------------------------
  // Noticias — cada builder deriva EXCLUSIVAMENTE de datos reales ya
  // recibidos, nunca de un valor inventado. `opts` común a la mayoría:
  // `{ userTeamId, relatedCompetition, competitionLabel }`.
  // ------------------------------------------------------------------

  // Fuente real: `result.finalScore` (MatchEngine.buildMatchResult) — ya
  // existe para cualquier partido resuelto de cualquier competición.
  function buildResultNewsEvent(normalizedMatch, opts = {}) {
    const { homeTeam, awayTeam, result, date } = normalizedMatch;
    const homeWon = result.finalScore.home > result.finalScore.away;
    const winner = homeWon ? homeTeam : awayTeam;
    const loser = homeWon ? awayTeam : homeTeam;
    const winnerScore = homeWon ? result.finalScore.home : result.finalScore.away;
    const loserScore = homeWon ? result.finalScore.away : result.finalScore.home;
    const involvesUser = opts.userTeamId && (homeTeam.id === opts.userTeamId || awayTeam.id === opts.userTeamId);
    const label = opts.competitionLabel ? `${opts.competitionLabel}: ` : '';
    return makeEvent({
      id: nextEventId('news-result'),
      type: 'news',
      dateTime: date,
      title: `${label}${winner.fullName} ${winnerScore} — ${loserScore} ${loser.fullName}`,
      relatedCompetition: opts.relatedCompetition,
      relatedTeam: winner,
      newsCategory: 'result',
      priority: involvesUser ? 'alta' : 'baja',
      body: `${winner.fullName} vence a ${loser.fullName} por ${winnerScore}-${loserScore}.`,
    });
  }

  // Fuente real: box score por jugador (`result.boxScore.home/away`, ya
  // con `valoracion` calculada por MatchEngine.enrichStatLine) — umbral
  // mínimo en `config.news.bigPerformanceMinValoracion` (CONFIG, nunca
  // hardcodeado).
  function buildBigPerformanceNewsEvents(normalizedMatch, config, opts = {}) {
    const threshold = config.news.bigPerformanceMinValoracion;
    const events = [];
    ['home', 'away'].forEach((side) => {
      const team = normalizedMatch[`${side}Team`];
      const lines = (normalizedMatch.result.boxScore && normalizedMatch.result.boxScore[side]) || [];
      lines.forEach((line) => {
        if (line.valoracion === undefined || line.valoracion === null || line.valoracion < threshold) return;
        const rebounds = line.reboundsOffensive + line.reboundsDefensive;
        const involvesUser = opts.userTeamId && team.id === opts.userTeamId;
        const label = opts.competitionLabel ? ` en ${opts.competitionLabel}` : '';
        events.push(makeEvent({
          id: nextEventId('news-performance'),
          type: 'news',
          dateTime: normalizedMatch.date,
          title: `${line.name} lidera a ${team.fullName} (${line.valoracion.toFixed(0)} de valoración)`,
          relatedCompetition: opts.relatedCompetition,
          relatedTeam: team,
          relatedPlayer: { id: line.playerId, fullName: line.name },
          newsCategory: 'performance',
          priority: involvesUser ? 'media' : 'baja',
          body: `${line.name}: ${line.points} puntos, ${rebounds} rebotes, ${line.assists} asistencias `
            + `(valoración ${line.valoracion.toFixed(0)})${label}.`,
        }));
      });
    });
    return events;
  }

  // Fuente real: resultados consecutivos ya jugados de `team` en
  // `schedule` (League.schedule, ordenado por fecha) — nunca un contador
  // inventado. Devuelve `{ kind: 'win'|'loss', length, lastDate }` puro,
  // sin construir ningún evento (lo separa buildStreakNewsEvent) para
  // poder testear la detección sola.
  function detectStreak(schedule, team) {
    const teamMatches = schedule
      .filter((m) => m.status === 'played' && (m.homeTeam.id === team.id || m.awayTeam.id === team.id))
      .sort((a, b) => a.date - b.date);
    let kind = null;
    let length = 0;
    for (let i = teamMatches.length - 1; i >= 0; i--) {
      const m = teamMatches[i];
      const isHome = m.homeTeam.id === team.id;
      const won = isHome
        ? m.result.finalScore.home > m.result.finalScore.away
        : m.result.finalScore.away > m.result.finalScore.home;
      const thisKind = won ? 'win' : 'loss';
      if (kind === null) { kind = thisKind; length = 1; } else if (thisKind === kind) length += 1; else break;
    }
    const lastDate = teamMatches.length ? teamMatches[teamMatches.length - 1].date : null;
    return { kind, length, lastDate };
  }

  function buildStreakNewsEvent(schedule, team, config, opts = {}) {
    const { kind, length, lastDate } = detectStreak(schedule, team);
    if (!kind || length < config.news.minStreakLength) return null;
    const involvesUser = opts.userTeamId && team.id === opts.userTeamId;
    const verb = kind === 'win' ? 'victorias' : 'derrotas';
    return makeEvent({
      id: nextEventId('news-streak'),
      type: 'news',
      dateTime: lastDate,
      title: `${team.fullName} encadena ${length} ${verb} seguidas`,
      relatedCompetition: opts.relatedCompetition,
      relatedTeam: team,
      newsCategory: 'streak',
      priority: involvesUser ? 'alta' : 'baja',
      body: `${team.fullName} suma ${length} ${verb} consecutivas en liga regular.`,
    });
  }

  // Fuente real: `League.getStandingsTable()` antes/después de una jornada
  // — nunca recalculado por este módulo, solo comparado. `cupCutoff`:
  // posición de corte de Copa/playoff (8, DESIGN.md 3.2.2/3.2.4);
  // `relegationCutoff`: posición de corte de descenso (total-2, DESIGN.md
  // 3.1). Simplificación señalada explícitamente: se usa el mismo corte
  // (posición 8 / últimas 2) para 1ª y 2ª división aunque el significado
  // exacto de "zona alta" difiera (Copa+playoff en 1ª, playoff de ascenso
  // en 2ª a partir de la 2ª posición) — el titular generado es genérico
  // ("puestos de cabeza"/"zona de descenso"), no nombra la competición
  // exacta que se juega ahí.
  function buildStandingsNewsEvents(standingsBefore, standingsAfter, config, opts = {}) {
    const events = [];
    if (!standingsBefore || !standingsBefore.length) return events;
    const total = standingsAfter.length;
    const cupCutoff = 8;
    const relegationCutoff = total - 2;

    const leaderBefore = standingsBefore[0].team.id;
    const leaderAfter = standingsAfter[0].team.id;
    if (leaderBefore !== leaderAfter) {
      const leaderTeam = standingsAfter[0].team;
      events.push(makeEvent({
        id: nextEventId('news-standings'),
        type: 'news',
        dateTime: opts.dateTime,
        title: `${leaderTeam.fullName} es el nuevo líder de la liga`,
        relatedCompetition: opts.relatedCompetition,
        relatedTeam: leaderTeam,
        newsCategory: 'standings',
        priority: (opts.userTeamId && leaderTeam.id === opts.userTeamId) ? 'alta' : 'media',
        body: `${leaderTeam.fullName} toma el liderato de la clasificación.`,
      }));
    }

    if (opts.userTeamId) {
      const before = standingsBefore.findIndex((s) => s.team.id === opts.userTeamId) + 1;
      const after = standingsAfter.findIndex((s) => s.team.id === opts.userTeamId) + 1;
      if (before > 0 && after > 0 && before !== after) {
        const enteredTop = before > cupCutoff && after <= cupCutoff;
        const leftTop = before <= cupCutoff && after > cupCutoff;
        const enteredRelegation = before < relegationCutoff && after >= relegationCutoff;
        const leftRelegation = before >= relegationCutoff && after < relegationCutoff;
        let suffix = '';
        if (enteredTop) suffix = ' — entra en puestos de cabeza';
        else if (leftTop) suffix = ' — sale de puestos de cabeza';
        else if (enteredRelegation) suffix = ' — entra en zona de descenso';
        else if (leftRelegation) suffix = ' — sale de zona de descenso';
        const verb = after < before ? 'sube' : 'baja';
        events.push(makeEvent({
          id: nextEventId('news-standings'),
          type: 'news',
          dateTime: opts.dateTime,
          title: `Tu equipo ${verb} a la ${after}ª posición${suffix}`,
          relatedCompetition: opts.relatedCompetition,
          relatedTeam: standingsAfter[after - 1].team,
          newsCategory: 'standings',
          priority: (enteredTop || leftTop || enteredRelegation || leftRelegation) ? 'alta' : 'media',
          body: `Tu equipo pasa de la ${before}ª a la ${after}ª posición.`,
        }));
      }
    }
    return events;
  }

  // "Sorpresas" (DESIGN.md 3.5, solo con métrica objetiva ya calculada):
  // diferencia de reputación deportiva (`team.reputation.sporting`, dato
  // real ya existente, DESIGN.md 6.2.1) y de posición en tabla ANTES del
  // partido entre los dos equipos — si el de menor reputación/peor
  // clasificado gana con una diferencia grande en ambos ejes, es sorpresa.
  // `standingsBeforeMatch`: tabla de clasificación en el instante justo
  // ANTES de resolver este partido (nunca recalculada aparte).
  function buildUpsetNewsEvent(normalizedMatch, standingsBeforeMatch, config, opts = {}) {
    const { homeTeam, awayTeam, result, date } = normalizedMatch;
    const homeWon = result.finalScore.home > result.finalScore.away;
    const winner = homeWon ? homeTeam : awayTeam;
    const loser = homeWon ? awayTeam : homeTeam;
    const repGap = loser.reputation.sporting - winner.reputation.sporting;
    if (repGap < config.news.upsetReputationGapMin) return null;
    const rankOf = (team) => standingsBeforeMatch.findIndex((s) => s.team.id === team.id) + 1;
    const winnerRank = rankOf(winner);
    const loserRank = rankOf(loser);
    if (!winnerRank || !loserRank || (winnerRank - loserRank) < config.news.upsetStandingsGapMin) return null;
    const involvesUser = opts.userTeamId && winner.id === opts.userTeamId;
    return makeEvent({
      id: nextEventId('news-surprise'),
      type: 'news',
      dateTime: date,
      title: `Sorpresa: ${winner.fullName} (${winnerRank}º) tumba a ${loser.fullName} (${loserRank}º)`,
      relatedCompetition: opts.relatedCompetition,
      relatedTeam: winner,
      newsCategory: 'surprise',
      priority: involvesUser ? 'alta' : 'media',
      body: `${winner.fullName}, ${winnerRank}º clasificado, sorprende a ${loser.fullName} (${loserRank}º), `
        + 'muy por delante en reputación deportiva y clasificación antes del partido.',
    });
  }

  // Fuente real: `bracket.champion`/`bracket.getStatus()` (Bracket.js, sin
  // recalcular nada) — game.js decide CUÁNDO llamar (justo cuando el
  // campeón pasa de null a existir).
  function buildChampionNewsEvent(championTeam, opts = {}) {
    return makeEvent({
      id: nextEventId('news-champion'),
      type: 'news',
      dateTime: opts.dateTime,
      title: `${championTeam.fullName} se proclama campeón de ${opts.competitionLabel}`,
      relatedCompetition: opts.relatedCompetition,
      relatedTeam: championTeam,
      newsCategory: 'competition',
      priority: (opts.userTeamId && championTeam.id === opts.userTeamId) ? 'alta' : 'media',
      body: `${championTeam.fullName} gana ${opts.competitionLabel}.`,
    });
  }

  // Fuente real: `series.loser`/`series.isDecided` (Bracket/Series.js) —
  // game.js decide cuándo llamar (justo cuando una serie con el equipo del
  // usuario queda decidida en su contra).
  function buildEliminationNewsEvent(eliminatedTeam, opts = {}) {
    return makeEvent({
      id: nextEventId('news-elimination'),
      type: 'news',
      dateTime: opts.dateTime,
      title: `${eliminatedTeam.fullName} queda eliminado de ${opts.competitionLabel}`,
      relatedCompetition: opts.relatedCompetition,
      relatedTeam: eliminatedTeam,
      newsCategory: 'competition',
      priority: (opts.userTeamId && eliminatedTeam.id === opts.userTeamId) ? 'alta' : 'baja',
      body: `${eliminatedTeam.fullName} cae eliminado de ${opts.competitionLabel}.`,
    });
  }

  // Fuente real: `bracket.rounds.length` creciendo (Bracket.js) — nueva
  // ronda alcanzada (ej. semifinales). Prioridad baja: es un hecho de
  // competición general, no propio salvo que el usuario siga en liza (lo
  // decide game.js pasando `involvesUser`).
  function buildBracketRoundReachedNewsEvent(roundLabel, opts = {}) {
    return makeEvent({
      id: nextEventId('news-competition'),
      type: 'news',
      dateTime: opts.dateTime,
      title: `${opts.competitionLabel}: se alcanza la fase de ${roundLabel}`,
      relatedCompetition: opts.relatedCompetition,
      newsCategory: 'competition',
      priority: opts.involvesUser ? 'media' : 'baja',
      body: `${opts.competitionLabel} llega a la fase de ${roundLabel}.`,
    });
  }

  // Fuente real: equipos clasificados (`top8`, ya calculado por
  // `Cup.createCup`/`League.getStandingsTable()` — aquí solo se recibe la
  // lista ya construida, nunca recalculada).
  function buildBracketCreatedNewsEvent(qualifiedTeams, opts = {}) {
    const names = qualifiedTeams.map((t) => t.fullName).join(', ');
    return makeEvent({
      id: nextEventId('news-competition'),
      type: 'news',
      dateTime: opts.dateTime,
      title: `Se sortea ${opts.competitionLabel}`,
      relatedCompetition: opts.relatedCompetition,
      newsCategory: 'competition',
      priority: (opts.userTeamId && qualifiedTeams.some((t) => t.id === opts.userTeamId)) ? 'alta' : 'baja',
      body: `Equipos clasificados: ${names}.`,
    });
  }

  // Fuente real: `summary.promoted`/`summary.relegated` — ya construido
  // por `closeSeasonAndPrepareNext()` (game.js) a partir de
  // `PromotionPlayoff`/`League.getStandingsTable()`, nunca recalculado
  // aquí.
  function buildPromotionRelegationNewsEvents(promotedTeams, relegatedTeams, opts = {}) {
    const events = [];
    promotedTeams.forEach((team) => {
      events.push(makeEvent({
        id: nextEventId('news-promotion'),
        type: 'news',
        dateTime: opts.dateTime,
        title: `${team.fullName} asciende a 1ª división`,
        relatedTeam: team,
        newsCategory: 'competition',
        priority: (opts.userTeamId && team.id === opts.userTeamId) ? 'alta' : 'media',
        body: `${team.fullName} logra el ascenso a 1ª división.`,
      }));
    });
    relegatedTeams.forEach((team) => {
      events.push(makeEvent({
        id: nextEventId('news-relegation'),
        type: 'news',
        dateTime: opts.dateTime,
        title: `${team.fullName} desciende a 2ª división`,
        relatedTeam: team,
        newsCategory: 'competition',
        priority: (opts.userTeamId && team.id === opts.userTeamId) ? 'alta' : 'media',
        body: `${team.fullName} desciende a 2ª división.`,
      }));
    });
    return events;
  }

  // Telemetría táctica en noticias (DESIGN.md 4.2 del prompt CAL-2, "con
  // mucho cuidado"): `telemetrySummary` es el objeto YA devuelto por
  // `Tactics.summarizeTacticsTelemetry()` (TAC-7) — este módulo NO calcula
  // ninguna analítica nueva, solo lee `n`/`ppp` ya agregados y compara
  // contra `config.tactics.telemetry.minReliablePossessions` (el MISMO
  // umbral que ya usa `smallSampleBadgeHtml`/`renderTacticsRivalTab` en
  // game.js — nunca un segundo umbral propio). `playTypeKey`/`playTypeLabel`:
  // el tipo de jugada con peor eficiencia defensiva encontrado por game.js
  // (este módulo no decide cuál, solo redacta la noticia si ya se le pasa
  // uno con muestra suficiente).
  function buildTacticalTrendNewsEvent(opponentTeam, playTypeLabel, pppAllowed, n, config, opts = {}) {
    if (n < config.tactics.telemetry.minReliablePossessions) return null;
    return makeEvent({
      id: nextEventId('news-tactical'),
      type: 'news',
      dateTime: opts.dateTime,
      title: `${opponentTeam.fullName} sufre ante ${playTypeLabel}`,
      relatedCompetition: opts.relatedCompetition,
      relatedTeam: opponentTeam,
      newsCategory: 'tactical',
      priority: 'baja',
      body: `${opponentTeam.fullName} concede ${pppAllowed.toFixed(2)} puntos por posesión ante ${playTypeLabel} `
        + `en sus últimos partidos (muestra: ${n} posesiones).`,
    });
  }

  const exportsObj = {
    EVENT_TYPES,
    RESERVED_FUTURE_EVENT_TYPES,
    NEWS_PRIORITIES,
    NEWS_CATEGORIES,
    makeEvent,
    buildMatchAgendaEvent,
    buildResultNewsEvent,
    buildBigPerformanceNewsEvents,
    detectStreak,
    buildStreakNewsEvent,
    buildStandingsNewsEvents,
    buildUpsetNewsEvent,
    buildChampionNewsEvent,
    buildEliminationNewsEvent,
    buildBracketRoundReachedNewsEvent,
    buildBracketCreatedNewsEvent,
    buildPromotionRelegationNewsEvents,
    buildTacticalTrendNewsEvent,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
