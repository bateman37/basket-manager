// src/core/PlayerCareer.js
// LIFE-4 (DESIGN.md 9.15): ficha universal, histórico de carrera, evolución,
// hitos y noticias. Responsabilidad ÚNICA de este módulo: persistencia
// histórica compacta + cálculos puros de carrera (totales, tendencias,
// hitos, récords, honores). NO modifica atributos, NO calcula crecimiento
// (PlayerDevelopment.js), NO calcula lesiones (Medical.js), NO resuelve
// partidos, NO decide roles tácticos (Tactics.js) y NO escribe `newsLog`
// directamente (Events.js sigue siendo quien construye noticias; game.js
// decide cuándo llamarlo a partir de los hitos que este módulo detecta).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  function core() {
    return (typeof module !== 'undefined' && module.exports) ? null : global.BasketManager;
  }
  function PDCore() {
    return (typeof module !== 'undefined' && module.exports) ? require('./PlayerDevelopment.js') : core();
  }
  function PlayerEntitiesCore() {
    return (typeof module !== 'undefined' && module.exports) ? require('../entities/Player.js') : core();
  }

  const PD = PDCore();
  const PlayerEntities = PlayerEntitiesCore();
  const {
    ALL_MUTABLE_ATTRIBUTES, MUTABLE_TECHNICAL, MUTABLE_PHYSICAL, MUTABLE_MENTAL, computeTmbRating,
  } = PD;
  const { POSITIONS } = PlayerEntities;

  // --- Sección 7/8/9: histórico compacto, orden fijo (nunca por nombre de
  // clave dentro del array — la UI usa los helpers de abajo, nunca índices
  // mágicos directamente).
  const ATTRIBUTE_SNAPSHOT_KEYS = ALL_MUTABLE_ATTRIBUTES; // 29, orden fijo
  const POSITION_SNAPSHOT_KEYS = POSITIONS; // 5, orden fijo

  const ATTRIBUTE_GROUP = {};
  MUTABLE_TECHNICAL.forEach((a) => { ATTRIBUTE_GROUP[a] = 'technical'; });
  MUTABLE_PHYSICAL.forEach((a) => { ATTRIBUTE_GROUP[a] = 'physical'; });
  MUTABLE_MENTAL.forEach((a) => { ATTRIBUTE_GROUP[a] = 'mental'; });

  // Sección 12: campos estadísticos acumulados — nunca porcentajes/medias
  // (se calculan sobre estos acumulados, sección 12/56), nunca rebotes
  // totales duplicados (se derivan de ofensivos+defensivos, ver
  // `totalReboundsOf`).
  const STAT_SNAPSHOT_KEYS = [
    'games', 'starts', 'seconds', 'points', 'offensiveRebounds', 'defensiveRebounds',
    'assists', 'steals', 'blocks', 'turnovers', 'personalFouls', 'foulsDrawn',
    'valoracion', 'plusMinus', 'fg2Made', 'fg2Attempted', 'fg3Made', 'fg3Attempted',
    'ftMade', 'ftAttempted',
  ];
  const STAT_INDEX = {};
  STAT_SNAPSHOT_KEYS.forEach((key, i) => { STAT_INDEX[key] = i; });

  // Sección 24: mínimos para que un mejor registro cuente como "récord
  // significativo" (milestone/news), no cualquier partido de referencia.
  const PB_STATS = ['points', 'totalRebounds', 'assists', 'blocks', 'steals', 'valoracion'];
  const PB_MINIMUMS = { points: 20, totalRebounds: 10, assists: 8, blocks: 4, steals: 4, valoracion: 20 };

  // Sección 23: umbrales de hitos de carrera (solo historyCompleteness
  // 'complete').
  const GAMES_MILESTONE_THRESHOLDS = [50, 100, 250, 500];
  const MINUTES_MILESTONE_THRESHOLDS = [1000, 5000, 10000];

  const CAREER_HISTORY_VERSION = 1;
  const RECENT_MATCH_KEYS_MAX = 30;

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  // --- Helpers de array compacto (sección 7/56: nunca índices mágicos en
  // la UI/otros módulos, siempre estos accesores) ---
  function makeEmptyStats() { return STAT_SNAPSHOT_KEYS.map(() => 0); }
  function statSet(statsArray, key, value) { statsArray[STAT_INDEX[key]] = value; }
  function statValue(statsArray, key) { return statsArray[STAT_INDEX[key]] || 0; }
  function totalReboundsOf(statsArray) {
    return statValue(statsArray, 'offensiveRebounds') + statValue(statsArray, 'defensiveRebounds');
  }
  function addStatsInto(target, delta) {
    for (let i = 0; i < STAT_SNAPSHOT_KEYS.length; i++) target[i] = (target[i] || 0) + (delta[i] || 0);
  }
  // Objeto plano de un array de stats — usado solo para totales/lectura de
  // UI/tests, nunca como forma de persistencia (esa sigue siendo el array).
  function statsArrayToObject(statsArray) {
    const obj = {};
    STAT_SNAPSHOT_KEYS.forEach((key) => { obj[key] = statValue(statsArray, key); });
    obj.totalRebounds = totalReboundsOf(statsArray);
    return obj;
  }

  function attributeAt(attributesArray, attrKey) {
    const idx = ATTRIBUTE_SNAPSHOT_KEYS.indexOf(attrKey);
    return idx === -1 ? undefined : attributesArray[idx];
  }
  function positionAt(positionsArray, posName) {
    const idx = POSITION_SNAPSHOT_KEYS.indexOf(posName);
    return idx === -1 ? undefined : positionsArray[idx];
  }
  function nominalPositionOf(nominalPositionIndex) {
    return POSITIONS[nominalPositionIndex] || null;
  }
  function averageGroup(attributesArray, group) {
    const keys = group === 'technical' ? MUTABLE_TECHNICAL : (group === 'physical' ? MUTABLE_PHYSICAL : MUTABLE_MENTAL);
    const sum = keys.reduce((acc, attr) => acc + (attributeAt(attributesArray, attr) || 0), 0);
    return sum / keys.length;
  }

  // Temporada "2026-27" a partir del año real de inicio — DESIGN.md 9.15,
  // sección 17 del prompt de esta sesión: nunca "Temporada 1".
  function seasonKeyFromStartYear(startYear) {
    const nextYearShort = String((startYear + 1) % 100).padStart(2, '0');
    return `${startYear}-${nextYearShort}`;
  }

  function attributesSnapshot(player) {
    return ATTRIBUTE_SNAPSHOT_KEYS.map((attr) => player[ATTRIBUTE_GROUP[attr]][attr]);
  }
  function positionsSnapshot(player) {
    return POSITION_SNAPSHOT_KEYS.map((pos) => player.positions[pos]);
  }

  function buildBaselineSnapshot(player, config, date, seasonKey) {
    return {
      date: new Date(date),
      seasonKey,
      tmb: computeTmbRating(player, config),
      attributes: attributesSnapshot(player),
      positions: positionsSnapshot(player),
      nominalPositionIndex: POSITIONS.indexOf(player.nominalPosition),
    };
  }

  function makeEmptyCurrentSeason(seasonKey, startDate) {
    return {
      seasonKey,
      startDate: new Date(startDate),
      stats: makeEmptyStats(),
      teamStints: [],
      honours: [],
      recentMatchKeys: [],
    };
  }

  function reviveDate(value) {
    return (value instanceof Date) ? value : new Date(value);
  }

  // --- Sección 5/54: inicialización/migración idempotente — mismo criterio
  // que PlayerDevelopment.ensureDevelopmentState/Medical.ensureMedicalState:
  // legacy sin careerHistory se inicializa SIN inventar pasado (baseline en
  // la fecha real de esta llamada, nunca retrocedida a birthDate).
  // `opts.historyCompleteness` ('partial' por defecto — jugador real ya
  // existente antes de esta partida; 'complete' para academy intake/
  // newgens creados dentro de la partida). `opts.seasonKey` es obligatorio
  // la primera vez (game.js siempre lo conoce vía Calendar.seasonStartYear).
  function ensureCareerHistory(player, config, referenceDate, opts) {
    const refDate = referenceDate || new Date();
    if (!player.careerHistory) {
      const completeness = (opts && opts.historyCompleteness) || 'partial';
      const seasonKey = (opts && opts.seasonKey) || seasonKeyFromStartYear(refDate.getFullYear());
      player.careerHistory = {
        version: CAREER_HISTORY_VERSION,
        historyCompleteness: completeness,
        historyStartDate: new Date(refDate),
        baseline: buildBaselineSnapshot(player, config, refDate, seasonKey),
        currentSeason: makeEmptyCurrentSeason(seasonKey, refDate),
        seasons: [],
        milestones: [],
        personalBests: {},
      };
      return player.careerHistory;
    }
    const ch = player.careerHistory;
    ch.historyStartDate = reviveDate(ch.historyStartDate);
    ch.baseline.date = reviveDate(ch.baseline.date);
    ch.currentSeason.startDate = reviveDate(ch.currentSeason.startDate);
    if (!Array.isArray(ch.currentSeason.recentMatchKeys)) ch.currentSeason.recentMatchKeys = [];
    if (!Array.isArray(ch.currentSeason.teamStints)) ch.currentSeason.teamStints = [];
    if (!Array.isArray(ch.currentSeason.honours)) ch.currentSeason.honours = [];
    if (!Array.isArray(ch.seasons)) ch.seasons = [];
    if (!Array.isArray(ch.milestones)) ch.milestones = [];
    if (!ch.personalBests) ch.personalBests = {};
    ch.seasons.forEach((s) => { s.endDate = reviveDate(s.endDate); });
    ch.milestones.forEach((m) => { m.date = reviveDate(m.date); });
    Object.keys(ch.personalBests).forEach((key) => {
      const pb = ch.personalBests[key];
      if (pb) pb.date = reviveDate(pb.date);
    });
    return ch;
  }

  // CYCLE-1 (DESIGN.md 9.22, BUG-CYCLE1-03) — CONSULTA PURA: devuelve el
  // histórico ya inicializado o `null`, NUNCA lo crea. La ficha universal y
  // cualquier renderizador/filtro/orden la usan en vez de
  // `ensureCareerHistory()` (que es un COMANDO y se llama al crear/
  // registrar/importar un jugador, o en una migración explícita de
  // bootstrap). Antes de esta corrección, abrir la ficha de un agente libre
  // podía alterar la instancia canónica y, con ella, el resultado futuro de
  // la simulación.
  function peekCareerHistory(player) {
    return (player && player.careerHistory) ? player.careerHistory : null;
  }

  function ensureTeamStint(currentSeason, team) {
    let stint = currentSeason.teamStints.find((s) => s.teamId === team.id);
    if (!stint) {
      stint = { teamId: team.id, teamName: team.name, division: team.division, stats: makeEmptyStats() };
      currentSeason.teamStints.push(stint);
    }
    return stint;
  }

  // --- Sección 11/12: acumulación pura desde una línea de boxScore ya
  // construida por MatchEngine (nunca una segunda fórmula divergente de la
  // que ya usa aggregatePlayerStats en game.js).
  function statsFromBoxScoreLine(line, isStarter) {
    const s = makeEmptyStats();
    statSet(s, 'games', 1);
    statSet(s, 'starts', isStarter ? 1 : 0);
    statSet(s, 'seconds', line.minutesPlayed || 0);
    statSet(s, 'points', line.points || 0);
    statSet(s, 'offensiveRebounds', line.reboundsOffensive || 0);
    statSet(s, 'defensiveRebounds', line.reboundsDefensive || 0);
    statSet(s, 'assists', line.assists || 0);
    statSet(s, 'steals', line.steals || 0);
    statSet(s, 'blocks', line.blocks || 0);
    statSet(s, 'turnovers', line.turnovers || 0);
    statSet(s, 'personalFouls', line.personalFouls || 0);
    statSet(s, 'foulsDrawn', line.foulsDrawn || 0);
    statSet(s, 'valoracion', line.valoracion || 0);
    statSet(s, 'plusMinus', line.plusMinus || 0);
    const fg = line.fieldGoals || {};
    let fg2Made = 0;
    let fg2Attempted = 0;
    ['midRangeShot', 'insideShot', 'layup'].forEach((shotType) => {
      fg2Made += (fg[shotType] && fg[shotType].made) || 0;
      fg2Attempted += (fg[shotType] && fg[shotType].attempted) || 0;
    });
    statSet(s, 'fg2Made', fg2Made);
    statSet(s, 'fg2Attempted', fg2Attempted);
    statSet(s, 'fg3Made', (fg.threePointShot && fg.threePointShot.made) || 0);
    statSet(s, 'fg3Attempted', (fg.threePointShot && fg.threePointShot.attempted) || 0);
    statSet(s, 'ftMade', (line.freeThrows && line.freeThrows.made) || 0);
    statSet(s, 'ftAttempted', (line.freeThrows && line.freeThrows.attempted) || 0);
    return s;
  }

  function lineValueForPbStat(line, stat) {
    if (stat === 'totalRebounds') return (line.reboundsOffensive || 0) + (line.reboundsDefensive || 0);
    return line[stat] || 0;
  }

  function hasMilestoneType(ch, type) {
    return ch.milestones.some((m) => m.type === type);
  }

  function pushMilestone(ch, id, type, matchInfo, value, metadata) {
    const milestone = {
      id,
      type,
      date: new Date(matchInfo.date),
      seasonKey: ch.currentSeason.seasonKey,
      teamId: matchInfo.team.id,
      competition: matchInfo.competition,
      value: value === undefined ? null : value,
      metadata: metadata || null,
    };
    ch.milestones.push(milestone);
    return milestone;
  }

  // Sección 23: SOLO historyCompleteness 'complete' — debut/primera
  // titularidad/umbrales de partidos y minutos. `totalsBefore` (objeto,
  // computeCareerTotals) debe capturarse ANTES de sumar el partido actual.
  function detectCompleteMilestones(ch, matchInfo, totalsBefore, line) {
    const found = [];
    const playedNow = (line.minutesPlayed || 0) > 0;
    if (!playedNow) return found;

    if (totalsBefore.games === 0 && !hasMilestoneType(ch, 'debut')) {
      found.push(pushMilestone(ch, 'debut', 'debut', matchInfo));
    }
    if (matchInfo.isStarter && !hasMilestoneType(ch, 'firstStart')) {
      found.push(pushMilestone(ch, 'firstStart', 'firstStart', matchInfo));
    }
    const gamesAfter = totalsBefore.games + 1;
    GAMES_MILESTONE_THRESHOLDS.forEach((threshold) => {
      const id = `games${threshold}`;
      if (totalsBefore.games < threshold && gamesAfter >= threshold && !hasMilestoneType(ch, id)) {
        found.push(pushMilestone(ch, id, id, matchInfo, threshold));
      }
    });
    const minutesBefore = totalsBefore.seconds / 60;
    const minutesAfter = minutesBefore + (line.minutesPlayed || 0) / 60;
    MINUTES_MILESTONE_THRESHOLDS.forEach((threshold) => {
      const id = `minutes${threshold}`;
      if (minutesBefore < threshold && minutesAfter >= threshold && !hasMilestoneType(ch, id)) {
        found.push(pushMilestone(ch, id, id, matchInfo, threshold));
      }
    });
    return found;
  }

  // Sección 21/24: personalBests siempre se actualiza (partial y complete
  // por igual — "bestInSave" es solo la etiqueta de UI); un milestone
  // (para timeline/news) solo se añade cuando además supera el mínimo de
  // sección 24. IDs estables por partido (`matchKey`) — invariante 21
  // "milestone no duplica".
  function updatePersonalBests(ch, matchInfo, line) {
    const newBests = [];
    PB_STATS.forEach((stat) => {
      const value = lineValueForPbStat(line, stat);
      const previous = ch.personalBests[stat];
      if (previous && value <= previous.value) return;
      ch.personalBests[stat] = {
        value,
        date: new Date(matchInfo.date),
        teamId: matchInfo.team.id,
        opponentId: (matchInfo.opponent && matchInfo.opponent.id) || null,
        competition: matchInfo.competition,
        matchKey: matchInfo.matchKey || null,
      };
      if (value >= PB_MINIMUMS[stat]) {
        const id = `personalBest-${stat}-${matchInfo.matchKey || matchInfo.date.toISOString()}`;
        if (!ch.milestones.some((m) => m.id === id)) {
          const milestone = pushMilestone(ch, id, 'personalBest', matchInfo, value, { stat });
          newBests.push(milestone);
        }
      }
    });
    return newBests;
  }

  // --- Sección 11/28/68: punto único de acumulación por partido resuelto.
  // `matchInfo`: { date, competition, team:{id,name,division},
  // opponent:{id,name}, boxScoreLine, isStarter, matchKey }. Devuelve
  // `{ newMilestones, newPersonalBests }` para que el orquestador (game.js)
  // decida si alguno merece noticia (Events.js construye el texto).
  function recordResolvedMatch(player, matchInfo, config) {
    const ch = player.careerHistory;
    if (!ch) return { newMilestones: [], newPersonalBests: [] };
    const cs = ch.currentSeason;
    if (matchInfo.matchKey && cs.recentMatchKeys.indexOf(matchInfo.matchKey) !== -1) {
      return { newMilestones: [], newPersonalBests: [] }; // invariante 10: una sola suma por partido
    }

    const totalsBefore = computeCareerTotals(player);
    const line = matchInfo.boxScoreLine;
    const delta = statsFromBoxScoreLine(line, matchInfo.isStarter);
    addStatsInto(cs.stats, delta);
    const stint = ensureTeamStint(cs, matchInfo.team);
    addStatsInto(stint.stats, delta);

    if (matchInfo.matchKey) {
      cs.recentMatchKeys.push(matchInfo.matchKey);
      if (cs.recentMatchKeys.length > RECENT_MATCH_KEYS_MAX) {
        cs.recentMatchKeys.splice(0, cs.recentMatchKeys.length - RECENT_MATCH_KEYS_MAX);
      }
    }

    const newMilestones = ch.historyCompleteness === 'complete'
      ? detectCompleteMilestones(ch, matchInfo, totalsBefore, line)
      : [];
    const newPersonalBests = updatePersonalBests(ch, matchInfo, line);
    return { newMilestones, newPersonalBests };
  }

  // --- Sección 16/56: cierre de temporada — snapshot final + honores,
  // reinicio de currentSeason. `seasonInfo`: { endDate, teamId, teamName,
  // division, roles, honours, nextSeasonKey }. `roles`/`honours` llegan ya
  // construidos por el llamador (Tactics.js/League.js/Bracket.js reales,
  // nunca recalculados aquí — este módulo no decide tácticas ni
  // competición).
  function closeSeason(player, seasonInfo, config) {
    const ch = player.careerHistory;
    if (!ch) return null;
    const cs = ch.currentSeason;
    const stints = cs.teamStints.length
      ? cs.teamStints.map((s) => ({ teamId: s.teamId, teamName: s.teamName, division: s.division, stats: s.stats.slice() }))
      : [{
        teamId: seasonInfo.teamId, teamName: seasonInfo.teamName, division: seasonInfo.division, stats: makeEmptyStats(),
      }];
    const record = {
      seasonKey: cs.seasonKey,
      endDate: new Date(seasonInfo.endDate),
      stats: cs.stats.slice(),
      stints,
      tmb: computeTmbRating(player, config),
      attributes: attributesSnapshot(player),
      positions: positionsSnapshot(player),
      nominalPositionIndex: POSITIONS.indexOf(player.nominalPosition),
      roles: seasonInfo.roles || { offense: null, defense: null },
      honours: seasonInfo.honours || [],
    };
    ch.seasons.push(record);
    ch.currentSeason = makeEmptyCurrentSeason(seasonInfo.nextSeasonKey, seasonInfo.endDate);
    return record;
  }

  // Sección 20: totales derivados (nunca persistidos aparte) — suma de
  // todas las temporadas cerradas + la temporada en curso.
  function computeCareerTotals(player) {
    const ch = player.careerHistory;
    const totals = makeEmptyStats();
    if (!ch) return statsArrayToObject(totals);
    ch.seasons.forEach((season) => addStatsInto(totals, season.stats));
    addStatsInto(totals, ch.currentSeason.stats);
    return statsArrayToObject(totals);
  }

  // Sección 33/36: tendencia de un atributo (entero, sin residual) frente
  // al snapshot anterior — flecha + delta entero.
  function describeAttributeTrend(previousValue, currentValue) {
    if (previousValue === undefined || previousValue === null) return { arrow: '→', delta: 0 };
    const delta = currentValue - previousValue;
    if (delta > 0) return { arrow: '▲', delta };
    if (delta < 0) return { arrow: '▼', delta };
    return { arrow: '→', delta: 0 };
  }

  // Sección 36: resumen por grupos (technical/physical/mental) — umbral de
  // media absoluta >= 0.25 para considerar mejora/empeoramiento real.
  const GROUP_TREND_THRESHOLD = 0.25;
  function summarizeGroupTrends(previousAttributes, currentAttributes) {
    const groups = ['technical', 'physical', 'mental'];
    const summary = {};
    groups.forEach((group) => {
      const prevAvg = previousAttributes ? averageGroup(previousAttributes, group) : null;
      const currAvg = averageGroup(currentAttributes, group);
      const delta = prevAvg === null ? 0 : currAvg - prevAvg;
      summary[group] = {
        delta,
        direction: Math.abs(delta) < GROUP_TREND_THRESHOLD ? 'stable' : (delta > 0 ? 'up' : 'down'),
      };
    });
    return summary;
  }

  // Sección 22: registro de honor de equipo/temporada — idempotente
  // (invariante 23: "honor no genera 12 news", y aquí además evita
  // duplicar el mismo código de honor dos veces en la misma temporada si
  // el orquestador llama más de una vez por descuido).
  function registerHonour(player, honourCode) {
    const ch = player.careerHistory;
    if (!ch) return;
    if (ch.currentSeason.honours.indexOf(honourCode) === -1) {
      ch.currentSeason.honours.push(honourCode);
    }
  }

  const exportsObj = {
    ATTRIBUTE_SNAPSHOT_KEYS,
    POSITION_SNAPSHOT_KEYS,
    STAT_SNAPSHOT_KEYS,
    ATTRIBUTE_GROUP,
    PB_STATS,
    PB_MINIMUMS,
    GAMES_MILESTONE_THRESHOLDS,
    MINUTES_MILESTONE_THRESHOLDS,
    makeEmptyStats,
    statValue,
    totalReboundsOf,
    statsArrayToObject,
    attributeAt,
    positionAt,
    nominalPositionOf,
    averageGroup,
    seasonKeyFromStartYear,
    ensureCareerHistory,
    // CYCLE-1 (BUG-CYCLE1-03): consulta PURA para renderizadores.
    peekCareerHistory,
    recordResolvedMatch,
    closeSeason,
    computeCareerTotals,
    describeAttributeTrend,
    summarizeGroupTrends,
    registerHonour,
    clamp,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
