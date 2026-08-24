// src/core/TrainingAI.js
// LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2): IA de entrenamiento
// CPU — responsabilidad EXCLUSIVA de elegir/revisar planes colectivos y
// focos individuales de los equipos que no controla el usuario. Ninguna
// heurística CPU vive en game.js. Convención del proyecto: identificadores
// en inglés, comentarios en español.

(function (global) {
  function core() {
    return (typeof module !== 'undefined' && module.exports) ? null : global.BasketManager;
  }
  function Training() {
    return (typeof module !== 'undefined' && module.exports) ? require('./Training.js') : core();
  }
  function PD() {
    return (typeof module !== 'undefined' && module.exports) ? require('./PlayerDevelopment.js') : core();
  }
  function PlayerCore() {
    return (typeof module !== 'undefined' && module.exports) ? require('../entities/Player.js') : core();
  }
  // LIFE-3 (DESIGN.md 9.14, sección 34 del prompt de esa sesión): "no
  // crear MedicalAI.js" — TrainingAI.js solo CONSULTA el mismo
  // Medical.getAvailability()/riskBand que ya calcula todo el mundo,
  // nunca una probabilidad oculta distinta para la CPU.
  function MedicalCore() {
    return (typeof module !== 'undefined' && module.exports) ? require('./Medical.js') : core();
  }

  function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  function getAttributeValue(player, attr) {
    if (attr in player.technical) return player.technical[attr];
    if (attr in player.physical) return player.physical[attr];
    return player.mental[attr];
  }

  // --- Sección 26 (punto 1): Energy media de los N jugadores con más
  // minutos recientes (misma ventana de exposición ya usada por LIFE-1). ---
  function recentMinutes(player, referenceDate, config) {
    const exposures = (player.developmentState && player.developmentState.matchExposures) || [];
    const windowMs = config.playerDevelopment.exposure.windowDays * 24 * 60 * 60 * 1000;
    return exposures.reduce((sum, exp) => {
      const d = exp.date instanceof Date ? exp.date : new Date(exp.date);
      if (referenceDate.getTime() - d.getTime() > windowMs || d > referenceDate) return sum;
      return sum + exp.minutes;
    }, 0);
  }

  function averageEnergyTopMinutesPlayers(team, referenceDate, config) {
    const n = config.training.cpuReview.lowEnergyTopN;
    if (!team.roster.length) return 100;
    const ranked = [...team.roster]
      .sort((a, b) => recentMinutes(b, referenceDate, config) - recentMinutes(a, referenceDate, config))
      .slice(0, n);
    return ranked.reduce((sum, p) => sum + p.dynamicState.energy, 0) / ranked.length;
  }

  function averageRelevantTacticalFamiliarity(team) {
    const fam = team.tacticalProfile && team.tacticalProfile.familiarity;
    if (!fam) return 100;
    return (fam.offensiveSystem + fam.defensiveSystem) / 2;
  }

  function computeYoungHeadroomShare(team, referenceDate, config) {
    if (!team.roster.length) return 0;
    const PDm = PD();
    const count = team.roster.filter((player) => {
      const age = PDm.ageAt(player, referenceDate);
      if (age === null || age >= config.training.cpuReview.youngHeadroomAgeThreshold) return false;
      const headroom = player.hidden.potential - PDm.computeUncappedTmb(player, config);
      return headroom >= config.training.cpuReview.headroomAmpleThreshold;
    }).length;
    return count / team.roster.length;
  }

  // --- Sección 26 (punto 5): debilidad relativa del roster — media BRUTA
  // (sin ponderar por posición: es una comparación entre GRUPOS, no un TMB)
  // de los atributos que cada foco prioriza (mismos catálogos de CONFIG que
  // ya usa Training.computeTeamFocusStimulusVector, sin duplicar números). ---
  function pickWeakestTeamFocus(team, config) {
    const attributeGroup = Training().getAttributeGroupMap();
    const averageOf = (attrs) => {
      let sum = 0;
      let n = 0;
      team.roster.forEach((player) => {
        attrs.forEach((attr) => {
          const group = attributeGroup[attr];
          const value = player[group] && player[group][attr];
          if (value !== undefined) { sum += value; n += 1; }
        });
      });
      return n ? sum / n : 10;
    };
    const offenseScore = averageOf(Object.keys(config.training.teamFocusVectors.offense.overrides));
    const defenseScore = averageOf(Object.keys(config.training.teamFocusVectors.defense.overrides));
    const physicalScore = averageOf(PlayerCore().PHYSICAL_ATTRIBUTES.filter((a) => a !== 'durability'));
    const scores = { offense: offenseScore, defense: defenseScore, physical: physicalScore };
    return Object.keys(scores).reduce((best, key) => (scores[key] < scores[best] ? key : best), 'offense');
  }

  // LIFE-3 (DESIGN.md 9.14, sección 34 del prompt de esa sesión): cuántos
  // jugadores de la ROTACIÓN PRINCIPAL (mismo top-N de minutos recientes
  // ya usado por averageEnergyTopMinutesPlayers, nunca un segundo criterio
  // de "rotación") tienen riskBand Alto/Muy alto — Medical.getAvailability
  // es la ÚNICA fuente, nunca una probabilidad propia de la CPU.
  function countHighRiskRotationPlayers(team, referenceDate, config) {
    if (!config.medical || !config.medical.enabled || !team.roster.length) return 0;
    const Medical = MedicalCore();
    const n = config.training.cpuReview.lowEnergyTopN;
    const rotation = [...team.roster]
      .sort((a, b) => recentMinutes(b, referenceDate, config) - recentMinutes(a, referenceDate, config))
      .slice(0, n);
    return rotation.filter((p) => {
      const band = Medical.getAvailability(p, referenceDate, config, { team }).riskBand;
      return band === 'alto' || band === 'muyAlto';
    }).length;
  }

  // ---------------------------------------------------------------------
  // Sección 26: plan colectivo CPU — heurística explicable, EN ESTE ORDEN.
  // ---------------------------------------------------------------------
  function decideCollectivePlan(team, referenceDate, teamContext, config) {
    const cfg = config.training.cpuReview;
    const matchesNext7 = (teamContext && teamContext.matchesInNext7Days) || 0;

    let decision;
    if (averageEnergyTopMinutesPlayers(team, referenceDate, config) < cfg.lowEnergyThreshold) {
      decision = { teamFocus: team.trainingPlan.teamFocus, intensity: 'recovery' };
    } else if (matchesNext7 >= cfg.congestionMatchesThreshold) {
      const focus = averageRelevantTacticalFamiliarity(team) < cfg.lowFamiliarityThreshold ? 'tactical' : 'balanced';
      decision = { teamFocus: focus, intensity: 'light' };
    } else if (averageRelevantTacticalFamiliarity(team) < cfg.lowFamiliarityThreshold) {
      decision = { teamFocus: 'tactical', intensity: 'normal' };
    } else if (computeYoungHeadroomShare(team, referenceDate, config) >= cfg.youngHeadroomShareThreshold) {
      const avgEnergyAll = team.roster.length
        ? team.roster.reduce((sum, p) => sum + p.dynamicState.energy, 0) / team.roster.length : 0;
      const intensity = (matchesNext7 <= 1 && avgEnergyAll > cfg.highIntensityMinEnergy) ? 'high' : 'normal';
      decision = { teamFocus: 'balanced', intensity };
    } else {
      decision = { teamFocus: pickWeakestTeamFocus(team, config), intensity: 'normal' };
    }

    // Sección 34: "nunca elige High si existe una concentración clara de
    // jugadores en riesgo Alto/Muy alto" — guarda final sobre CUALQUIER
    // rama de arriba, nunca al revés (una razón de Energy/congestión ya
    // más segura que esta seguiría aplicando sin llegar aquí con 'high').
    if (decision.intensity === 'high' && countHighRiskRotationPlayers(team, referenceDate, config) >= 3) {
      return { teamFocus: decision.teamFocus, intensity: 'light' };
    }
    return decision;
  }

  // ---------------------------------------------------------------------
  // Sección 26: focos individuales CPU.
  // ---------------------------------------------------------------------
  function rosterBestLevelForPosition(team, position) {
    return team.roster.reduce((best, p) => Math.max(best, p.positionLevel(position)), 0);
  }

  // Foco posicional SOLO si: la posición tiene cobertura pobre en la
  // plantilla, el jugador ya tiene competencia real (>=8) en ella, y no
  // está ya en 20.
  function considerPositionFocus(team, player, config) {
    const POSITIONS = PlayerCore().POSITIONS;
    const target = POSITIONS.find((pos) => {
      if (pos === player.nominalPosition) return false;
      const level = player.positionLevel(pos);
      if (level < 8 || level >= 20) return false;
      return rosterBestLevelForPosition(team, pos) < config.training.cpuReview.poorPositionCoverageThreshold;
    });
    return target ? { type: 'position', target } : null;
  }

  function averageRoleFamiliarity(team, config) {
    const byPlayerRole = team.tacticalProfile.familiarity.byPlayerRole || {};
    const levels = [];
    Object.values(byPlayerRole).forEach((entry) => {
      if (entry.offensiveRoleId) levels.push(entry.offensiveLevel);
      if (entry.defensiveRoleId) levels.push(entry.defensiveLevel);
    });
    if (!levels.length) return config.tactics.familiarity.roleDefaultInitial;
    return levels.reduce((sum, v) => sum + v, 0) / levels.length;
  }

  // Foco de rol SOLO si: tiene un rol táctico asignado y su familiaridad
  // (de cualquiera de sus dos roles) es claramente inferior a la media del
  // equipo.
  function considerRoleFocus(team, player, config) {
    const assignment = team.tacticalProfile.roleAssignments && team.tacticalProfile.roleAssignments[player.id];
    if (!assignment) return null;
    const entry = team.tacticalProfile.familiarity.byPlayerRole[player.id];
    const roleDefaultInitial = config.tactics.familiarity.roleDefaultInitial;
    const candidates = [];
    if (assignment.offensiveRole) {
      candidates.push({ side: 'offense', target: assignment.offensiveRole, level: entry ? entry.offensiveLevel : roleDefaultInitial });
    }
    if (assignment.defensiveRole) {
      candidates.push({ side: 'defense', target: assignment.defensiveRole, level: entry ? entry.defensiveLevel : roleDefaultInitial });
    }
    if (!candidates.length) return null;
    const worst = candidates.reduce((a, b) => (a.level < b.level ? a : b));
    const teamAvg = averageRoleFamiliarity(team, config);
    if (teamAvg - worst.level >= config.training.cpuReview.roleFamiliarityGapThreshold) {
      return { type: 'role', side: worst.side, target: worst.target };
    }
    return null;
  }

  // Foco de atributo por defecto: prioriza un mutable RELEVANTE para su
  // nominalPosition (peso TMB alto) que esté claramente por debajo del
  // propio perfil medio del jugador — nunca solo "el más bajo absoluto" si
  // es poco relevante para su puesto.
  function chooseAttributeFocus(player, config) {
    const PDm = PD();
    const weights = PDm.getPositionWeights(player.nominalPosition, config);
    const attrs = PDm.ALL_MUTABLE_ATTRIBUTES;
    const playerAverage = attrs.reduce((sum, a) => sum + getAttributeValue(player, a), 0) / attrs.length;
    let best = null;
    let bestScore = -Infinity;
    attrs.forEach((attr) => {
      const relevance = weights[attr];
      if (relevance < 0.5) return; // solo relevantes para su posición
      const value = getAttributeValue(player, attr);
      if (value >= 20) return;
      const deficit = Math.max(0, playerAverage - value) + 1;
      const score = relevance * deficit;
      if (score > bestScore) { bestScore = score; best = attr; }
    });
    return best ? { type: 'attribute', target: best } : { type: 'none' };
  }

  function choosePlayerFocus(team, player, config) {
    return considerPositionFocus(team, player, config)
      || considerRoleFocus(team, player, config)
      || chooseAttributeFocus(player, config);
  }

  function reviewIndividualFocuses(team, referenceDate, config, calendarCtx) {
    const PDm = PD();
    const Medical = (config.medical && config.medical.enabled) ? MedicalCore() : null;
    team.roster.forEach((player) => {
      const age = PDm.ageAt(player, referenceDate);
      if (age === null) return;
      // Sección 34: "lesionados no reciben nuevos focos individuales hasta
      // volver al menos a `limited`" — el foco YA asignado sigue vigente
      // (Training.js lo deja "suspendido", nunca lo borra), esta revisión
      // solo se abstiene de ASIGNAR uno nuevo.
      if (Medical && Medical.getAvailability(player, referenceDate, config, { team }).status === 'unavailable') return;
      const headroom = player.hidden.potential - PDm.computeUncappedTmb(player, config);
      if (headroom < config.training.cpuReview.headroomAmpleThreshold) return; // sin margen real de desarrollo, no forzar foco
      const focus = choosePlayerFocus(team, player, config);
      Training().setIndividualFocus(team, player.id, focus, referenceDate, config, calendarCtx);
    });
  }

  // Revisión defensiva (sección 26, "revisión defensiva si el plan actual
  // queda inválido por cambios de plantilla"): un foco individual cuyo
  // target ya no es válido (Training.normalizeIndividualFocus lo tumba a
  // 'none') o que ya alcanzó el máximo (20) dispara revisión anticipada,
  // sin esperar a los 56 días.
  function needsDefensiveIndividualReview(team, config) {
    return Object.keys(team.trainingPlan.individualFocuses).some((playerId) => {
      const player = team.roster.find((p) => p.id === playerId);
      const raw = team.trainingPlan.individualFocuses[playerId];
      if (!player) return true;
      const normalized = Training().normalizeIndividualFocus(raw, config);
      if (normalized.type === 'none' && raw && raw.type && raw.type !== 'none') return true;
      if (normalized.type === 'attribute' && getAttributeValue(player, normalized.target) >= 20) return true;
      if (normalized.type === 'position' && player.positions[normalized.target] >= 20) return true;
      return false;
    });
  }

  // ---------------------------------------------------------------------
  // Punto de entrada único: revisa (si toca) el plan colectivo cada 28
  // días y los focos individuales cada 56, más la revisión defensiva de
  // arriba. Nunca se llama para el equipo del usuario (game.js filtra) —
  // invariante 29, "user team nunca es sobrescrito por TrainingAI".
  // `teamContext`: { matchesInNext7Days } — ver sección 27, calculado por
  // game.js a partir del calendario/ligas/brackets YA cargados.
  // ---------------------------------------------------------------------
  function reviewTeamIfDue(team, referenceDate, teamContext, config, calendarCtx) {
    let changed = false;
    const state = team.trainingState;

    if (!state.nextCpuCollectiveReviewDate || referenceDate >= state.nextCpuCollectiveReviewDate) {
      const decision = decideCollectivePlan(team, referenceDate, teamContext, config);
      Training().setPlan(team, decision, referenceDate, config, calendarCtx);
      state.nextCpuCollectiveReviewDate = addDays(referenceDate, config.training.cpuReview.collectiveReviewDays);
      changed = true;
    }

    if (!state.nextCpuIndividualReviewDate || referenceDate >= state.nextCpuIndividualReviewDate
      || needsDefensiveIndividualReview(team, config)) {
      reviewIndividualFocuses(team, referenceDate, config, calendarCtx);
      state.nextCpuIndividualReviewDate = addDays(referenceDate, config.training.cpuReview.individualReviewDays);
      changed = true;
    }

    return changed;
  }

  const exportsObj = {
    decideCollectivePlan,
    choosePlayerFocus,
    reviewTeamIfDue,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
