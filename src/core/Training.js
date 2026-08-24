// src/core/Training.js
// LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2): Entrenamiento,
// desarrollo dirigido y aprendizaje táctico/posicional. Construye el
// ESTÍMULO de entrenamiento y los sistemas nuevos de posición/rol/Energy;
// PlayerDevelopment.js sigue siendo la única fuente de reglas de
// crecimiento de atributos/TMB/PA (nunca se recalculan aquí). Convención
// del proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  function core() {
    return (typeof module !== 'undefined' && module.exports) ? null : global.BasketManager;
  }

  // Accesores perezosos a los otros módulos — mismo patrón que
  // PlayerDevelopment.getPlayerGenerator(): en navegador, Training.js
  // puede cargar antes o después de Tactics.js/Recovery.js según el orden
  // de <script> de index.html, así que nunca se destructura nada de estos
  // objetos a nivel de módulo, solo dentro de las funciones.
  function PD() {
    return (typeof module !== 'undefined' && module.exports) ? require('./PlayerDevelopment.js') : core();
  }
  function PlayerCore() {
    return (typeof module !== 'undefined' && module.exports) ? require('../entities/Player.js') : core();
  }
  function TacticsCore() {
    return (typeof module !== 'undefined' && module.exports) ? require('./Tactics.js') : core();
  }
  function RecoveryCore() {
    return (typeof module !== 'undefined' && module.exports) ? require('./Recovery.js') : core();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Interpolación lineal por puntos [x, factor] — mismo patrón que
  // PlayerDevelopment.interpolateCurve (no exportada por ese módulo), copia
  // local trivial (utilidad genérica, no una regla de negocio duplicada).
  function interpolateCurve(points, x) {
    if (x <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      if (x >= x0 && x <= x1) {
        const t = (x - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    return last[1];
  }

  const TEAM_FOCUS_OPTIONS = ['balanced', 'offense', 'defense', 'physical', 'tactical'];
  const INTENSITY_OPTIONS = ['recovery', 'light', 'normal', 'high'];
  const FOCUS_TYPES = ['none', 'attribute', 'position', 'role'];

  // Mapa atributo -> grupo (technical/physical/mental de Player.js), para
  // el foco Physical (sección 11: regla de GRUPO, no de atributo
  // individual) — construido una vez a partir de las listas ya existentes,
  // nunca un catálogo nuevo.
  let cachedAttributeGroup = null;
  function getAttributeGroupMap() {
    if (cachedAttributeGroup) return cachedAttributeGroup;
    const { TECHNICAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, MENTAL_ATTRIBUTES } = PlayerCore();
    const map = {};
    TECHNICAL_ATTRIBUTES.forEach((a) => { map[a] = 'technical'; });
    PHYSICAL_ATTRIBUTES.forEach((a) => { map[a] = 'physical'; });
    MENTAL_ATTRIBUTES.forEach((a) => { map[a] = 'mental'; });
    cachedAttributeGroup = map;
    return map;
  }

  // Mapa atributo -> categoría de curva LIFE-1 (explosive/strength/
  // endurance/technical/cognitive/social) — leído directo de CONFIG, sin
  // depender de ningún export interno de PlayerDevelopment.js.
  function getCurveCategoryMap(config) {
    const map = {};
    const categories = config.playerDevelopment.attributeCategories;
    Object.keys(categories).forEach((cat) => {
      categories[cat].forEach((attr) => { map[attr] = cat; });
    });
    return map;
  }

  // ---------------------------------------------------------------------
  // Sección 4/5: esquema/normalización de plan e individualFocus.
  // Team.js ya construye los defaults (Balanced/Normal/sin focos) — aquí
  // solo se VALIDA un foco individual concreto contra el catálogo real
  // vigente (atributos mutables/posiciones/roles), con fallback seguro a
  // `none` si el target ya no existe (sección 14, nunca crash de save).
  // ---------------------------------------------------------------------
  function normalizeIndividualFocus(raw, config) {
    if (!raw || !raw.type || raw.type === 'none') return { type: 'none' };
    if (raw.type === 'attribute') {
      if (PD().ALL_MUTABLE_ATTRIBUTES.includes(raw.target)) return { type: 'attribute', target: raw.target };
      return { type: 'none' };
    }
    if (raw.type === 'position') {
      if (PlayerCore().POSITIONS.includes(raw.target)) return { type: 'position', target: raw.target };
      return { type: 'none' };
    }
    if (raw.type === 'role') {
      const tac = TacticsCore();
      const catalog = raw.side === 'defense' ? tac.DEFENSIVE_ROLES : (raw.side === 'offense' ? tac.OFFENSIVE_ROLES : null);
      if (catalog && catalog.some((r) => r.id === raw.target)) {
        return { type: 'role', side: raw.side, target: raw.target };
      }
      return { type: 'none' };
    }
    return { type: 'none' };
  }

  function getIndividualFocus(team, playerId, config) {
    return normalizeIndividualFocus(team.trainingPlan.individualFocuses[playerId], config);
  }

  // ---------------------------------------------------------------------
  // Sección 6: cambiar plan nunca modifica el pasado — flush con el plan
  // ANTERIOR antes de registrar el nuevo segmento.
  // ---------------------------------------------------------------------
  function recordPlanSegment(team, asOfDate) {
    team.trainingState.planSegments.push({
      teamFocus: team.trainingPlan.teamFocus,
      intensity: team.trainingPlan.intensity,
      individualFocuses: { ...team.trainingPlan.individualFocuses },
      effectiveFrom: new Date(asOfDate),
    });
    const lastProcessed = team.trainingState.lastProcessedDate;
    // Sección 5: poda segmentos ya completamente consumidos.
    team.trainingState.planSegments = team.trainingState.planSegments
      .filter((segment) => !lastProcessed || segment.effectiveFrom > lastProcessed);
  }

  function setTeamFocus(team, teamFocus, asOfDate, config, calendarCtx) {
    if (!TEAM_FOCUS_OPTIONS.includes(teamFocus)) {
      throw new Error(`Training.setTeamFocus: enfoque desconocido "${teamFocus}"`);
    }
    processTeamDevelopmentToDate(team, asOfDate, config, calendarCtx);
    team.trainingPlan.teamFocus = teamFocus;
    recordPlanSegment(team, asOfDate);
  }

  function setIntensity(team, intensity, asOfDate, config, calendarCtx) {
    if (!INTENSITY_OPTIONS.includes(intensity)) {
      throw new Error(`Training.setIntensity: intensidad desconocida "${intensity}"`);
    }
    processTeamDevelopmentToDate(team, asOfDate, config, calendarCtx);
    team.trainingPlan.intensity = intensity;
    recordPlanSegment(team, asOfDate);
  }

  // Guarda enfoque + intensidad juntos en UNA sola operación (botón
  // "Guardar plan" de la UI, sección 29, y revisión colectiva de
  // TrainingAI, sección 26) — un único flush/segmento en vez de dos.
  function setPlan(team, { teamFocus, intensity }, asOfDate, config, calendarCtx) {
    if (teamFocus !== undefined && !TEAM_FOCUS_OPTIONS.includes(teamFocus)) {
      throw new Error(`Training.setPlan: enfoque desconocido "${teamFocus}"`);
    }
    if (intensity !== undefined && !INTENSITY_OPTIONS.includes(intensity)) {
      throw new Error(`Training.setPlan: intensidad desconocida "${intensity}"`);
    }
    processTeamDevelopmentToDate(team, asOfDate, config, calendarCtx);
    if (teamFocus !== undefined) team.trainingPlan.teamFocus = teamFocus;
    if (intensity !== undefined) team.trainingPlan.intensity = intensity;
    recordPlanSegment(team, asOfDate);
  }

  function setIndividualFocus(team, playerId, rawFocus, asOfDate, config, calendarCtx) {
    const player = team.roster.find((p) => p.id === playerId);
    if (!player) throw new Error(`Training.setIndividualFocus: jugador "${playerId}" no está en la plantilla`);
    const focus = normalizeIndividualFocus(rawFocus, config);
    processTeamDevelopmentToDate(team, asOfDate, config, calendarCtx);
    if (focus.type === 'none') delete team.trainingPlan.individualFocuses[playerId];
    else team.trainingPlan.individualFocuses[playerId] = focus;
    recordPlanSegment(team, asOfDate);
  }

  // ---------------------------------------------------------------------
  // Sección 7: densidad competitiva semanal.
  // ---------------------------------------------------------------------
  function registerTeamMatchDate(team, date) {
    const time = date.getTime();
    const exists = team.trainingState.recentTeamMatchDates.some((d) => d.getTime() === time);
    if (!exists) team.trainingState.recentTeamMatchDates.push(new Date(date));
    team.trainingState.recentTeamMatchDates.sort((a, b) => a.getTime() - b.getTime());
    const pruneBefore = time - 40 * 24 * 60 * 60 * 1000;
    team.trainingState.recentTeamMatchDates = team.trainingState.recentTeamMatchDates
      .filter((d) => d.getTime() >= pruneBefore);
  }

  function computeMatchDensityTier(count, config) {
    const tier = Math.max(0, Math.min(4, count));
    return config.training.matchDensity[tier];
  }

  function countTeamMatchesInWindow(team, windowStart, windowEnd) {
    return team.trainingState.recentTeamMatchDates
      .filter((d) => d.getTime() >= windowStart.getTime() && d.getTime() < windowEnd.getTime()).length;
  }

  // Sección 24: una fecha cae en pretemporada si es anterior al inicio de
  // temporada del Calendar vigente (`calendarCtx.seasonStartDate`) — no se
  // inventa ningún concepto de calendario nuevo, se reutiliza el que ya
  // expone `Calendar.seasonStartDate`.
  function isOffseasonTick(tickDate, calendarCtx) {
    return !!(calendarCtx && calendarCtx.seasonStartDate && tickDate < calendarCtx.seasonStartDate);
  }

  function resolveEffectiveIntensity(team, tickDate, calendarCtx) {
    return isOffseasonTick(tickDate, calendarCtx) ? 'normal' : (team.trainingPlan.intensity || 'normal');
  }

  function computeWeeklyTrainingContext(team, tickDate, config, calendarCtx) {
    const windowStart = new Date(tickDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const count = countTeamMatchesInWindow(team, windowStart, tickDate);
    const density = computeMatchDensityTier(count, config);
    const intensityKey = resolveEffectiveIntensity(team, tickDate, calendarCtx);
    return {
      matchCount: count,
      opportunityFactor: density.opportunityFactor,
      loadUnits: density.loadUnits,
      intensityKey,
      intensityCfg: config.training.intensity[intensityKey],
      isOffseason: isOffseasonTick(tickDate, calendarCtx),
    };
  }

  // ---------------------------------------------------------------------
  // Sección 10: readiness por Energy.
  // ---------------------------------------------------------------------
  function computeReadinessFactor(energy, config) {
    return interpolateCurve(config.training.readinessFactorByEnergy, energy);
  }

  // ---------------------------------------------------------------------
  // Sección 11: vector bruto de Team Focus, normalizado contra el
  // presupuesto TMB del jugador (PlayerDevelopment.getPositionWeights) —
  // excepto Tactical (sección 12, presupuesto NO normalizado a propósito).
  // ---------------------------------------------------------------------
  function computeTeamFocusStimulusVector(player, teamFocus, config) {
    const mutableAttrs = PD().ALL_MUTABLE_ATTRIBUTES;
    if (teamFocus === 'tactical') {
      const curveCategory = getCurveCategoryMap(config);
      const base = config.training.tactical.attributeBase;
      const vector = {};
      mutableAttrs.forEach((attr) => {
        const cat = curveCategory[attr];
        const group = cat === 'technical' ? 'technical' : ((cat === 'cognitive' || cat === 'social') ? cat : 'physical');
        vector[attr] = base[group] !== undefined ? base[group] : 1.00;
      });
      return vector;
    }

    const cfg = config.training.teamFocusVectors[teamFocus] || config.training.teamFocusVectors.balanced;
    const attributeGroup = getAttributeGroupMap();
    const raw = {};
    mutableAttrs.forEach((attr) => {
      let w = (cfg.overrides && cfg.overrides[attr] !== undefined) ? cfg.overrides[attr] : cfg.default;
      if (cfg.groupOverrides) {
        const group = attributeGroup[attr];
        if (cfg.groupOverrides[group] !== undefined) w = cfg.groupOverrides[group];
      }
      raw[attr] = w;
    });
    if (teamFocus === 'balanced') return raw; // ya uniforme en 1.00, nada que normalizar

    const weights = PD().getPositionWeights(player.nominalPosition, config);
    let sumWeight = 0;
    let sumWeighted = 0;
    mutableAttrs.forEach((attr) => {
      sumWeight += weights[attr];
      sumWeighted += weights[attr] * raw[attr];
    });
    const weightedAverage = sumWeighted / sumWeight;
    const normalized = {};
    mutableAttrs.forEach((attr) => { normalized[attr] = raw[attr] / weightedAverage; });
    return normalized;
  }

  // --- Sección 15: foco individual de atributo — concentra presupuesto,
  // conservando la media ponderada total (misma relevancia TMB de LIFE-1).
  function applyAttributeFocusRedistribution(player, vector, target, config) {
    const weights = PD().getPositionWeights(player.nominalPosition, config);
    const mult = config.training.attributeFocus.targetMultiplier;
    const mutableAttrs = PD().ALL_MUTABLE_ATTRIBUTES;
    let totalBudget = 0;
    mutableAttrs.forEach((attr) => { totalBudget += weights[attr] * vector[attr]; });
    const targetWeight = weights[target];
    const targetBudgetBefore = targetWeight * vector[target];
    const targetBudgetAfter = targetWeight * vector[target] * mult;
    const restBudgetBefore = totalBudget - targetBudgetBefore;
    const k = restBudgetBefore > 0 ? (totalBudget - targetBudgetAfter) / restBudgetBefore : 1;
    const result = {};
    mutableAttrs.forEach((attr) => {
      result[attr] = attr === target ? vector[target] * mult : vector[attr] * k;
    });
    return result;
  }

  function scaleVector(vector, factor) {
    const out = {};
    Object.keys(vector).forEach((k) => { out[k] = vector[k] * factor; });
    return out;
  }

  // ---------------------------------------------------------------------
  // Sección 16/17/18/23: progreso posicional.
  // ---------------------------------------------------------------------
  function ensurePositionProgress(player) {
    if (!player.developmentState) return null;
    if (!player.developmentState.positionProgress) {
      const map = {};
      PlayerCore().POSITIONS.forEach((pos) => { map[pos] = 0; });
      player.developmentState.positionProgress = map;
    }
    return player.developmentState.positionProgress;
  }

  function positionHeadroomFactor(currentRating) {
    if (currentRating >= 20) return 0;
    return Math.sqrt((20 - currentRating) / 19);
  }

  function computeMatchRepFactor(targetMinutesThisWeek, config) {
    const { halfLifeMinutes, floor, range } = config.training.position.matchRep;
    const repExposure = 1 - Math.exp((-Math.LN2 * targetMinutesThisWeek) / halfLifeMinutes);
    return floor + range * repExposure;
  }

  function computePositionEnvironmentFactor(player, team, tickDate, config) {
    const age = PD().ageAt(player, tickDate);
    const envCfg = (age !== null && age < config.training.position.environment.youthAgeThreshold)
      ? config.training.position.environment.youth
      : config.training.position.environment.adult;
    const tcFactor = PD().computeFacilityFactor(team.facilities.trainingCenter.level, config);
    const hcFactor = PD().staffRatingToFactor(config.training.staffContext.headCoachDevelopment, config);
    const tdFactor = PD().staffRatingToFactor(config.training.staffContext.technicalDevelopment, config);
    let result = tcFactor * envCfg.trainingCenter + hcFactor * envCfg.headCoachDevelopment + tdFactor * envCfg.technicalDevelopment;
    if (envCfg.youthDevelopment) {
      const ydFactor = PD().staffRatingToFactor(config.training.staffContext.youthDevelopment, config);
      result += ydFactor * envCfg.youthDevelopment;
    }
    return result;
  }

  // Sección 16: "learningRate/mindset/age cognitiva REUTILIZADOS desde
  // PlayerDevelopment" — nunca reimplementados.
  function computePositionAgeLearningFactor(player, tickDate, config) {
    const age = PD().ageAt(player, tickDate);
    const cognitiveCurveFactor = Math.max(0, interpolateCurve(config.playerDevelopment.growthCurves.cognitive, age));
    const learningFactor = PD().computeLearningFactor(player, config);
    return cognitiveCurveFactor * learningFactor;
  }

  function targetPositionMinutesInWindow(player, target, tickDate) {
    const exposures = (player.developmentState && player.developmentState.matchExposures) || [];
    const windowStart = tickDate.getTime() - 7 * 24 * 60 * 60 * 1000;
    let minutes = 0;
    exposures.forEach((exp) => {
      const d = exp.date instanceof Date ? exp.date : new Date(exp.date);
      if (d.getTime() < windowStart || d.getTime() > tickDate.getTime()) return;
      if (exp.positionMinutes && exp.positionMinutes[target]) minutes += exp.positionMinutes[target];
    });
    return minutes;
  }

  function computePositionProgressDelta(player, team, target, tickDate, weeklyCtx, offseasonMultiplier, config) {
    const current = player.positions[target];
    const headroom = positionHeadroomFactor(current);
    if (headroom <= 0) return 0;
    const targetMinutes = targetPositionMinutesInWindow(player, target, tickDate);
    const repFactor = computeMatchRepFactor(targetMinutes, config);
    const envFactor = computePositionEnvironmentFactor(player, team, tickDate, config);
    const ageLearning = computePositionAgeLearningFactor(player, tickDate, config);
    return config.training.position.basePositionGainPerTrainingWeek
      * weeklyCtx.opportunityFactor * weeklyCtx.intensityCfg.developmentMultiplier * computeReadinessFactor(player.dynamicState.energy, config)
      * ageLearning * envFactor * headroom * repFactor * offseasonMultiplier;
  }

  // Residual persistente separado de `attributeProgress` (sección 16) —
  // mismo patrón de "cruce del entero visible" que
  // PlayerDevelopment.applyResidualDelta, aplicado a `player.positions`
  // (nunca a atributos 1-20).
  function applyPositionResidualDelta(player, position, delta) {
    const progress = ensurePositionProgress(player);
    if (!progress) return;
    let residual = (progress[position] || 0) + delta;
    let visible = player.positions[position];
    while (residual >= 0.5 && visible < 20) { visible += 1; residual -= 1; }
    while (residual < -0.5 && visible > 1) { visible -= 1; residual += 1; }
    player.positions[position] = clamp(Math.round(visible), 1, 20);
    progress[position] = residual;
  }

  // ---------------------------------------------------------------------
  // Sección 12/19/20/21/22: entrenamiento táctico — SIEMPRE sobre los
  // datos reales de TAC-6 (Tactics.growFamiliarityValue/PLAY_DEFINITIONS),
  // nunca una familiaridad paralela.
  // ---------------------------------------------------------------------
  function applyDiminishingGrowth(currentLevel, gain, config) {
    if (gain <= 0) return clamp(currentLevel, 0, 100);
    const diminishing = clamp(1 - currentLevel / 100, 0, 1) ** config.training.tactical.diminishingExponent;
    return clamp(currentLevel + gain * diminishing, 0, 100);
  }

  function complexityLearningFactor(complexity, config) {
    if (complexity === undefined || complexity === null) return 1;
    return 1 - (complexity / 100) * config.training.tactical.complexityLearningPenaltyMax;
  }

  function computeWeeklyTacticalGain(baseRate, focusMultiplier, intensityCfg, weeklyCtx, headCoachFactor, complexity, offseasonMultiplier, config) {
    return baseRate * focusMultiplier * intensityCfg.tacticalMultiplier * weeklyCtx.opportunityFactor
      * headCoachFactor * complexityLearningFactor(complexity, config) * offseasonMultiplier;
  }

  function getFamilyComplexity(family, tac) {
    const defs = tac.PLAY_DEFINITIONS.filter((d) => d.family === family);
    if (!defs.length) return undefined;
    return defs.reduce((sum, d) => sum + d.complexity, 0) / defs.length;
  }

  // Mismo bookkeeping de inicio/reset que Tactics.growPlayerRoleFamiliarity
  // (35 al primer rol, 15 solo si el roleAssignment activo cambió de rol —
  // sección 22 del prompt), sustituyendo únicamente el paso de aplicar
  // crecimiento por la curva semanal propia de Training.
  function growPlayerRoleFamiliarityFromTraining(profile, playerId, side, roleId, gain, config) {
    const roleKey = side === 'offensive' ? 'offensiveRoleId' : 'defensiveRoleId';
    const levelKey = side === 'offensive' ? 'offensiveLevel' : 'defensiveLevel';
    const byPlayerRole = profile.familiarity.byPlayerRole;
    const roleDefaultInitial = config.tactics.familiarity.roleDefaultInitial;
    const roleChangeResetValue = config.tactics.familiarity.roleChangeResetValue;
    let entry = byPlayerRole[playerId];
    if (!entry) {
      entry = {
        offensiveRoleId: null, offensiveLevel: roleDefaultInitial, defensiveRoleId: null, defensiveLevel: roleDefaultInitial,
      };
      byPlayerRole[playerId] = entry;
    }
    if (entry[roleKey] !== roleId) {
      entry[levelKey] = entry[roleKey] === null ? roleDefaultInitial : roleChangeResetValue;
      entry[roleKey] = roleId;
    }
    entry[levelKey] = applyDiminishingGrowth(entry[levelKey], gain, config);
  }

  function applyWeeklyTacticalTraining(team, tickDate, config, calendarCtx) {
    const tac = TacticsCore();
    const profile = team.tacticalProfile;
    if (!profile || !profile.familiarity) return;
    const focus = team.trainingPlan.teamFocus;
    const weeklyCtx = computeWeeklyTrainingContext(team, tickDate, config, calendarCtx);
    const offseasonMultiplier = weeklyCtx.isOffseason ? config.training.tactical.offseasonTacticalMultiplier : 1.0;
    const headCoachFactor = PD().staffRatingToFactor(config.training.staffContext.headCoachDevelopment, config);
    const baseRate = config.training.tactical.baseTacticalFamiliarityGainPerWeek;
    const focusCfg = config.training.tactical.teamFocusMultiplier[focus];
    const offenseMultiplier = typeof focusCfg === 'number' ? focusCfg : focusCfg.offense;
    const defenseMultiplier = typeof focusCfg === 'number' ? focusCfg : focusCfg.defense;
    const systemGrowthShare = config.tactics.familiarity.systemGrowthShare;

    // --- Sistema ofensivo + familias activas del playbook (según
    // playTypeWeights REALES del equipo, sección 20: "según el perfil
    // táctico ACTIVO del equipo") ---
    const weightsTotal = tac.PLAY_FAMILIES.reduce((sum, fam) => sum + Math.max(0, profile.playTypeWeights[fam] || 0), 0);
    if (weightsTotal > 0) {
      tac.PLAY_FAMILIES.forEach((family) => {
        const weight = Math.max(0, profile.playTypeWeights[family] || 0);
        if (weight <= 0) return;
        const share = weight / weightsTotal;
        const complexity = getFamilyComplexity(family, tac);
        const gain = computeWeeklyTacticalGain(baseRate * share, offenseMultiplier, weeklyCtx.intensityCfg, weeklyCtx, headCoachFactor, complexity, offseasonMultiplier, config);
        const current = profile.familiarity.byPlayFamily[family] !== undefined ? profile.familiarity.byPlayFamily[family] : tac.FAMILIARITY_DEFAULT;
        profile.familiarity.byPlayFamily[family] = applyDiminishingGrowth(current, gain, config);
        profile.familiarity.offensiveSystem = applyDiminishingGrowth(profile.familiarity.offensiveSystem, gain * systemGrowthShare, config);
      });
    }

    // --- Cobertura defensiva activa (pnrCoverage) ---
    const coverage = profile.pnrCoverage;
    if (coverage) {
      const coverageComplexity = config.tactics.familiarity.coverageComplexity[coverage];
      const coverageGain = computeWeeklyTacticalGain(baseRate, defenseMultiplier, weeklyCtx.intensityCfg, weeklyCtx, headCoachFactor, coverageComplexity, offseasonMultiplier, config);
      const currentCoverage = profile.familiarity.byCoverage[coverage] !== undefined ? profile.familiarity.byCoverage[coverage] : tac.FAMILIARITY_DEFAULT;
      profile.familiarity.byCoverage[coverage] = applyDiminishingGrowth(currentCoverage, coverageGain, config);
      profile.familiarity.defensiveSystem = applyDiminishingGrowth(profile.familiarity.defensiveSystem, coverageGain * systemGrowthShare, config);
    }

    // --- Roles actualmente asignados + bonus de foco individual (sección
    // 22: individualRoleFocusMultiplier=1.75 sobre la ganancia de ESE rol) ---
    const roleAssignments = profile.roleAssignments || {};
    Object.keys(roleAssignments).forEach((playerId) => {
      if (!team.roster.some((p) => p.id === playerId)) return; // ya no está en plantilla
      const assignment = roleAssignments[playerId];
      const individualFocus = getIndividualFocus(team, playerId, config);
      [{ key: 'offensiveRole', side: 'offensive', focusSide: 'offense', mult: offenseMultiplier },
        { key: 'defensiveRole', side: 'defensive', focusSide: 'defense', mult: defenseMultiplier }].forEach((entry) => {
        const roleId = assignment[entry.key];
        if (!roleId) return;
        const isFocused = individualFocus.type === 'role' && individualFocus.side === entry.focusSide && individualFocus.target === roleId;
        const extra = isFocused ? config.training.tactical.individualRoleFocusMultiplier : 1;
        const gain = computeWeeklyTacticalGain(baseRate * 0.4, entry.mult * extra, weeklyCtx.intensityCfg, weeklyCtx, headCoachFactor, undefined, offseasonMultiplier, config);
        growPlayerRoleFamiliarityFromTraining(profile, playerId, entry.side, roleId, gain, config);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Sección 9: coste de Energy + estímulo de atributos, por jugador y por
  // tick semanal — construye el `context.stimulusByAttribute` (sección
  // 3-bis) que PlayerDevelopment.processOneTick() consume, y aplica como
  // efecto lateral el progreso posicional + el coste de Energy de ESA
  // semana (mismo tick, para que readiness de la semana siguiente ya
  // refleje el coste de esta).
  // ---------------------------------------------------------------------
  function buildPlayerTickContext(player, team, tickDate, config, calendarCtx) {
    const weeklyCtx = computeWeeklyTrainingContext(team, tickDate, config, calendarCtx);
    const readiness = computeReadinessFactor(player.dynamicState.energy, config);
    const focus = getIndividualFocus(team, player.id, config);

    let vector = computeTeamFocusStimulusVector(player, team.trainingPlan.teamFocus, config);
    if (focus.type === 'attribute') {
      vector = applyAttributeFocusRedistribution(player, vector, focus.target, config);
    } else if (focus.type === 'position') {
      vector = scaleVector(vector, config.training.position.attributeBudgetMultiplier);
    } else if (focus.type === 'role') {
      vector = scaleVector(vector, config.training.roleFocus.attributeBudgetMultiplier);
    }

    const stimulusByAttribute = {};
    PD().ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
      stimulusByAttribute[attr] = vector[attr] * weeklyCtx.intensityCfg.developmentMultiplier * weeklyCtx.opportunityFactor * readiness;
    });

    if (focus.type === 'position') {
      const offseasonMultiplier = weeklyCtx.isOffseason ? config.training.tactical.offseasonTacticalMultiplier : 1;
      const delta = computePositionProgressDelta(player, team, focus.target, tickDate, weeklyCtx, offseasonMultiplier, config);
      if (delta) applyPositionResidualDelta(player, focus.target, delta);
    }

    if (!weeklyCtx.isOffseason) {
      const extraCost = config.training.individualFocusEnergyCostPerLoadUnit[focus.type] || 0;
      const cost = weeklyCtx.loadUnits * (weeklyCtx.intensityCfg.energyCostPerLoadUnit + extraCost);
      if (cost > 0) player.adjustEnergy(-cost);
    }

    const facilityLevel = team.facilities[config.playerDevelopment.facility.key].level;
    return { facilityLevel, stimulusByAttribute };
  }

  // ---------------------------------------------------------------------
  // Sección 32: integración temporal central — procesa Training +
  // PlayerDevelopment + progreso POS/táctico de un equipo hasta
  // `targetDate`, de forma NO retroactiva e idempotente (una llamada con
  // `targetDate` ya cubierto no repite nada). Cubre equipo usuario, CPU,
  // liga visible, liga de fondo y brackets por igual — es la única función
  // que avanza `team.trainingState.lastProcessedDate`.
  // ---------------------------------------------------------------------
  function processTeamDevelopmentToDate(team, targetDate, config, calendarCtx) {
    if (!targetDate) return;
    if (!team.trainingState.lastProcessedDate) {
      team.trainingState.lastProcessedDate = new Date(targetDate);
    }
    if (targetDate <= team.trainingState.lastProcessedDate) return;

    const tickMs = config.playerDevelopment.tickDays * 24 * 60 * 60 * 1000;
    let cursor = team.trainingState.lastProcessedDate.getTime();
    const targetMs = targetDate.getTime();
    while (targetMs - cursor >= tickMs) {
      cursor += tickMs;
      applyWeeklyTacticalTraining(team, new Date(cursor), config, calendarCtx);
    }

    team.roster.forEach((player) => {
      PD().processPlayerToDate(player, targetDate, config, (tickDate) => buildPlayerTickContext(player, team, tickDate, config, calendarCtx));
    });

    team.trainingState.lastProcessedDate = new Date(targetDate);
    const lastProcessed = team.trainingState.lastProcessedDate;
    team.trainingState.planSegments = team.trainingState.planSegments.filter((segment) => segment.effectiveFrom > lastProcessed);
  }

  // ---------------------------------------------------------------------
  // Sección 9/32: hook PRE-partido — corrige el orden temporal (partido
  // anterior -> recuperación entre fechas -> entrenamiento -> Energy
  // previa al nuevo partido), llamado ANTES de MatchEngine.simulateMatch
  // para AMBOS lados de cualquier partido (liga/copa/playoff/ascenso,
  // usuario o CPU) desde el resolver de opciones de partido de game.js —
  // nunca dentro de MatchEngine.js.
  // ---------------------------------------------------------------------
  function prepareTeamForMatch(team, matchDate, config, calendarCtx) {
    if (!matchDate) return;
    registerTeamMatchDate(team, matchDate);
    if (team.trainingState.lastProcessedDate && matchDate <= team.trainingState.lastProcessedDate) return;

    // 1) Recuperación real de Energy desde el último partido de CADA
    // jugador hasta `matchDate` — con el `trainingModifier` que Recovery.js
    // reservó explícitamente para este módulo (sección 8: nunca una
    // segunda fórmula de recuperación).
    const weeklyCtx = computeWeeklyTrainingContext(team, matchDate, config, calendarCtx);
    const opportunityShare = clamp(weeklyCtx.loadUnits / config.training.recoveryOpportunityReference, 0, 1);
    const effectiveRecoveryMultiplier = 1 + (weeklyCtx.intensityCfg.recoveryMultiplier - 1) * opportunityShare;
    const { applyRestRecovery } = RecoveryCore();
    team.roster.forEach((player) => {
      if (player.dynamicState.lastMatchDate) {
        const days = Math.round((matchDate - player.dynamicState.lastMatchDate) / (24 * 60 * 60 * 1000));
        if (days > 0) applyRestRecovery([player], days, config, effectiveRecoveryMultiplier);
      }
      // Se avanza para TODA la plantilla (no solo quien vaya a jugar) —
      // evita el doble cómputo de recuperación que existiría si el
      // "reloj de descanso" de un jugador se quedara parado hasta que
      // vuelva a pisar la pista (test dirigido: sin doble recuperación).
      player.recordMatchDate(new Date(matchDate));
    });

    // 2) Estímulo de entrenamiento + PlayerDevelopment + progreso POS/
    // táctico hasta este mismo instante — Energy de entrenamiento ya
    // queda deducida aquí (buildPlayerTickContext), ANTES del partido.
    processTeamDevelopmentToDate(team, matchDate, config, calendarCtx);
  }

  // ---------------------------------------------------------------------
  // Sección 31: proyección PURA de Energy (no muta estado) — usada por la
  // UI para "Energy estimada al próximo partido".
  // ---------------------------------------------------------------------
  function projectEnergyToDate(player, team, targetDate, config, calendarCtx) {
    let energy = player.dynamicState.energy;
    const weeklyCtx = computeWeeklyTrainingContext(team, targetDate, config, calendarCtx);
    if (player.dynamicState.lastMatchDate) {
      const days = Math.round((targetDate - player.dynamicState.lastMatchDate) / (24 * 60 * 60 * 1000));
      if (days > 0) {
        const opportunityShare = clamp(weeklyCtx.loadUnits / config.training.recoveryOpportunityReference, 0, 1);
        const modifier = 1 + (weeklyCtx.intensityCfg.recoveryMultiplier - 1) * opportunityShare;
        energy = RecoveryCore().computeRecoveredEnergy(energy, days, player, config, modifier);
      }
    }
    if (!weeklyCtx.isOffseason && team.trainingState.lastProcessedDate) {
      const weeksElapsed = Math.max(0, Math.floor((targetDate - team.trainingState.lastProcessedDate) / (7 * 24 * 60 * 60 * 1000)));
      if (weeksElapsed > 0) {
        const focus = getIndividualFocus(team, player.id, config);
        const extraCost = config.training.individualFocusEnergyCostPerLoadUnit[focus.type] || 0;
        const costPerWeek = weeklyCtx.loadUnits * (weeklyCtx.intensityCfg.energyCostPerLoadUnit + extraCost);
        energy = clamp(energy - costPerWeek * weeksElapsed, 0, 100);
      }
    }
    return clamp(energy, 0, 100);
  }

  // ---------------------------------------------------------------------
  // Bloque B UI: margen/carga del próximo microciclo — helper puro, la UI
  // solo aporta el número real de partidos ya conocido por Calendar/Liga.
  // ---------------------------------------------------------------------
  function describeMicrocycle(team, matchesInNext7Days, config) {
    const tier = computeMatchDensityTier(matchesInNext7Days, config);
    const marginByCount = ['Alto', 'Normal', 'Bajo', 'Muy bajo', 'Muy bajo'];
    const loadByIntensity = {
      recovery: 'Recuperación', light: 'Baja', normal: 'Media', high: 'Alta',
    };
    const count = clamp(Math.round(matchesInNext7Days), 0, 4);
    return {
      matchesInNext7Days,
      opportunityFactor: tier.opportunityFactor,
      marginLabel: marginByCount[count],
      loadLabel: loadByIntensity[team.trainingPlan.intensity] || 'Media',
    };
  }

  const exportsObj = {
    getAttributeGroupMap,
    TEAM_FOCUS_OPTIONS,
    INTENSITY_OPTIONS,
    FOCUS_TYPES,
    normalizeIndividualFocus,
    getIndividualFocus,
    setTeamFocus,
    setIntensity,
    setPlan,
    setIndividualFocus,
    registerTeamMatchDate,
    computeMatchDensityTier,
    computeWeeklyTrainingContext,
    isOffseasonTick,
    computeReadinessFactor,
    computeTeamFocusStimulusVector,
    applyAttributeFocusRedistribution,
    ensurePositionProgress,
    positionHeadroomFactor,
    computeMatchRepFactor,
    computePositionProgressDelta,
    applyPositionResidualDelta,
    applyDiminishingGrowth,
    applyWeeklyTacticalTraining,
    buildPlayerTickContext,
    processTeamDevelopmentToDate,
    prepareTeamForMatch,
    projectEnergyToDate,
    describeMicrocycle,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
