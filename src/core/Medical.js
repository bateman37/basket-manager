// src/core/Medical.js
// LIFE-3 (DESIGN.md 9.14): Lesiones, carga médica, rehabilitación y vuelta
// a competir. Responsabilidad ÚNICA de todo lo médico — Recovery.js sigue
// siendo Energy (batería física); PlayerDevelopment.js sigue siendo la
// única fuente de crecimiento normal de atributos/TMB/PA (una lesión NUNCA
// cambia PA/learningRate/learningPersistence/Professionalism/Ambition/
// agingOffsetYears). Convención del proyecto: identificadores en inglés,
// comentarios en español.

(function (global) {
  function core() {
    return (typeof module !== 'undefined' && module.exports) ? null : global.BasketManager;
  }
  function PD() {
    return (typeof module !== 'undefined' && module.exports) ? require('./PlayerDevelopment.js') : core();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Interpolación lineal por puntos [x, factor] — mismo patrón ya repetido
  // en Calendar.js/PlayerDevelopment.js/Training.js (utilidad genérica, no
  // una regla de negocio duplicada).
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

  // --- Determinismo (sección 5) — mismo algoritmo FNV-1a que Calendar.js/
  // PlayerDevelopment.js, reimplementado aquí (ninguno de los dos lo
  // exporta) para que las lesiones de entrenamiento/progresión médica por
  // fecha sean reproducibles a partir de `medicalSeed + fecha/contexto`,
  // nunca de Math.random(). Las lesiones DURANTE un partido SÍ pueden usar
  // Math.random() (sección 5, explícitamente permitido).
  function hashToUnitInterval(key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function deterministicUnit(...keyParts) {
    return hashToUnitInterval(keyParts.join('|'));
  }

  function isoDay(date) {
    return (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
  }

  function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  // ===========================================================================
  // Estado médico persistente (sección 4) — inicialización/migración
  // idempotente, mismo criterio que PlayerDevelopment.ensureDevelopmentState:
  // legacy sin medicalState se inicializa SIN inventar lesiones pasadas ni
  // tocar ningún otro atributo.
  // ===========================================================================
  function ensureMedicalState(player, config, referenceDate) {
    const refDate = referenceDate || new Date();
    if (!player.medicalState) {
      player.medicalState = {
        medicalSeed: player.id,
        lastProcessedDate: new Date(refDate),
        currentInjury: null,
        injuryHistory: [],
        loadHistory: [],
        // Cursor SEPARADO del de rehabilitación (sección 5: "no rerollear
        // una semana por llamar dos veces a processPlayerToDate()") —
        // protege evaluateWeeklyTrainingTick() específicamente, que se
        // dispara por tick semanal de LIFE-2, no por avance de días reales.
        lastTrainingTickDate: null,
      };
    } else if (!(player.medicalState.lastProcessedDate instanceof Date)) {
      player.medicalState.lastProcessedDate = player.medicalState.lastProcessedDate
        ? new Date(player.medicalState.lastProcessedDate) : new Date(refDate);
    }
    const ms = player.medicalState;
    if (!Array.isArray(ms.injuryHistory)) ms.injuryHistory = [];
    if (!Array.isArray(ms.loadHistory)) ms.loadHistory = [];
    if (ms.lastTrainingTickDate === undefined) ms.lastTrainingTickDate = null;
    if (ms.lastTrainingTickDate && !(ms.lastTrainingTickDate instanceof Date)) {
      ms.lastTrainingTickDate = new Date(ms.lastTrainingTickDate);
    }
    if (ms.currentInjury) {
      if (!(ms.currentInjury.occurredAt instanceof Date)) ms.currentInjury.occurredAt = new Date(ms.currentInjury.occurredAt);
      if (!(ms.currentInjury.lastProcessedDate instanceof Date)) {
        ms.currentInjury.lastProcessedDate = new Date(ms.currentInjury.lastProcessedDate || ms.currentInjury.occurredAt);
      }
    }
    ms.loadHistory.forEach((entry) => {
      if (!(entry.date instanceof Date)) entry.date = new Date(entry.date);
    });
    ms.injuryHistory.forEach((entry) => {
      if (!(entry.occurredAt instanceof Date)) entry.occurredAt = new Date(entry.occurredAt);
      if (!(entry.recoveredAt instanceof Date)) entry.recoveredAt = new Date(entry.recoveredAt);
    });
    return ms;
  }

  // ===========================================================================
  // Factores individuales (secciones 3/8/9/10/11)
  // ===========================================================================

  // Durability (1-20, Player.physical.durability) — predisposición basal,
  // ÚNICA (sección 3: no existe injuryProneness aparte). Nunca llega a 0.
  function computeDurabilityFactor(player, config) {
    return interpolateCurve(config.medical.durabilityFactorCurve, player.physical.durability);
  }

  function computeRecoverySpeedFactor(player, config) {
    return interpolateCurve(config.medical.recoveryFactorCurve, player.physical.recovery);
  }

  // Media ponderada instalación de club + hook de staff (sección 11) sobre
  // el mismo mapeo lineal 1-20 -> factor de una curva concreta — NUNCA
  // multiplicando varios factores entre sí.
  function weightedFacilityStaffFactor(facilityLevel, staffLevel, curve, config) {
    const envCfg = config.medical.environment;
    const facilityFactor = interpolateCurve(curve, facilityLevel === undefined || facilityLevel === null ? 10 : facilityLevel);
    const staffFactor = interpolateCurve(curve, staffLevel === undefined || staffLevel === null ? 10 : staffLevel);
    return facilityFactor * envCfg.facilityWeight + staffFactor * envCfg.staffWeight;
  }

  function getMedicalStaffContext(config, team) {
    return (team && team.medicalStaffContext) || config.medical.staffContext;
  }

  function computeMedicalPreventionFactor(team, config) {
    const envCfg = config.medical.environment;
    const facilityLevel = team ? team.facilities.medicalCenter.level : undefined;
    const staff = getMedicalStaffContext(config, team);
    return weightedFacilityStaffFactor(facilityLevel, staff.doctor, envCfg.medicalPreventionCurve, config);
  }

  function computePhysicalPreparationFactor(team, config) {
    const envCfg = config.medical.environment;
    const facilityLevel = team ? team.facilities.physicalPreparation.level : undefined;
    const staff = getMedicalStaffContext(config, team);
    return weightedFacilityStaffFactor(facilityLevel, staff.physicalPreparation, envCfg.physicalPreparationCurve, config);
  }

  function computeRehabSpeedEnvironmentFactor(team, config) {
    const envCfg = config.medical.environment;
    const facilityLevel = team ? team.facilities.medicalCenter.level : undefined;
    const staff = getMedicalStaffContext(config, team);
    return weightedFacilityStaffFactor(facilityLevel, staff.physiotherapy, envCfg.rehabSpeedCurve, config);
  }

  // Entorno combinado (sección 11) por mecanismo: acuteContact solo recibe
  // prevención médica (Preparación Física NO afecta a contacto, "no cura
  // directamente una rotura/lesión" — exclusión total, no parcial).
  function computeEnvironmentFactor(mechanism, team, config) {
    const medical = computeMedicalPreventionFactor(team, config);
    if (mechanism === 'acuteContact') return medical;
    const physical = computePhysicalPreparationFactor(team, config);
    return (medical + physical) / 2;
  }

  function computeEnergyFactor(energy, mechanism, config) {
    const full = interpolateCurve(config.medical.energyFactorCurve, energy);
    if (mechanism === 'acuteContact') {
      return 1 + (full - 1) * config.medical.load.contactExcessShare;
    }
    return full;
  }

  // --- Carga (sección 8): sin ACWR/ratios — carga absoluta reciente de 7
  // días + pico respecto a la carga semanal habitual de las 3 semanas
  // anteriores, ambas señales continuas y acotadas.
  function pruneLoadHistory(player, referenceDate, config) {
    const ms = player.medicalState;
    const cutoff = addDays(referenceDate, -config.medical.load.historyRetentionDays);
    ms.loadHistory = ms.loadHistory.filter((entry) => entry.date >= cutoff);
  }

  function registerLoad(player, date, units, source, config) {
    if (!units || units <= 0) return;
    const ms = player.medicalState;
    ms.loadHistory.push({ date: new Date(date), units, source });
    pruneLoadHistory(player, date, config);
  }

  function sumLoadInWindow(player, windowStart, windowEnd) {
    return player.medicalState.loadHistory.reduce((sum, entry) => {
      if (entry.date >= windowStart && entry.date < windowEnd) return sum + entry.units;
      return sum;
    }, 0);
  }

  function computeLoadFactor(player, date, mechanism, config) {
    const cfg = config.medical.load;
    const recent7d = sumLoadInWindow(player, addDays(date, -cfg.recentWindowDays), addDays(date, 1));
    const lookbackStart = addDays(date, -cfg.recentWindowDays * (cfg.spikeLookbackWeeks + 1));
    const lookbackEnd = addDays(date, -cfg.recentWindowDays);
    const previous3WeeksTotal = sumLoadInWindow(player, lookbackStart, lookbackEnd);
    const previous3WeeksAverage = previous3WeeksTotal / cfg.spikeLookbackWeeks;

    const absoluteExcess = Math.max(0, recent7d - cfg.referenceWeeklyLoad);
    const spikeExcess = Math.max(0, recent7d - previous3WeeksAverage);
    const normalize = (x) => clamp(x / cfg.referenceWeeklyLoad, 0, 1);
    const full = clamp(
      1 + cfg.absoluteWeight * normalize(absoluteExcess) + cfg.spikeWeight * normalize(spikeExcess),
      1, cfg.maxLoadFactor,
    );
    if (mechanism === 'acuteContact') return 1 + (full - 1) * cfg.contactExcessShare;
    return full;
  }

  // --- Historial/recurrencia (sección 10) — aproximación documentada: para
  // decidir SI ocurre una nueva lesión usamos el mayor factor de
  // recurrencia entre TODO el historial reciente (tratando cada entrada
  // como si fuera "mismo tipo", la interpretación más conservadora posible
  // sin conocer aún qué lesión concreta se sortearía); para decidir QUÉ
  // lesión concreta ocurre, `biasCatalogWeight()` más abajo sesga el peso a
  // favor de la MISMA zona/tipo que esa entrada "caliente" — así la
  // recurrencia real (misma zona repite más) queda garantizada sin
  // necesitar precalcular el catálogo completo antes de conocer el riesgo
  // agregado. Nunca hay bonus por "cualquier lesión alguna vez": una
  // entrada fuera de `sameTypeCurve` (>730 días) ya vale 1.05, no 1.0, así
  // que el suelo real es ese factor mínimo — documentado explícitamente,
  // no una desviación silenciosa.
  function recencyFactorForEntry(entry, date, config) {
    const daysSince = daysBetween(entry.recoveredAt, date);
    if (daysSince < 0) return 1; // aún no recuperada (no debería llegar aquí, defensivo)
    const tier = config.medical.history.sameTypeCurve.find((t) => daysSince <= t.maxDays);
    return tier ? tier.factor : 1;
  }

  function computeHistoryFactor(player, date, config) {
    const history = player.medicalState.injuryHistory;
    let best = { factor: 1, entry: null };
    history.forEach((entry) => {
      const factor = recencyFactorForEntry(entry, date, config);
      if (factor > best.factor) best = { factor, entry };
    });
    return { factor: clamp(best.factor, 1, config.medical.history.maxHistoryFactor), hotEntry: best.entry };
  }

  // ===========================================================================
  // Riesgo compuesto (sección 7) — una sola fórmula, acotada por mecanismo.
  // ===========================================================================
  function computeMechanismRisk(baseExposureRisk, player, date, mechanism, config, team) {
    if (baseExposureRisk <= 0) return 0;
    ensureMedicalState(player, config, date);
    const durabilityFactor = computeDurabilityFactor(player, config);
    const { factor: historyFactor } = computeHistoryFactor(player, date, config);
    const energyFactor = computeEnergyFactor(player.dynamicState.energy, mechanism, config);
    const loadFactor = computeLoadFactor(player, date, mechanism, config);
    const environmentFactor = computeEnvironmentFactor(mechanism, team, config);
    return baseExposureRisk * durabilityFactor * historyFactor * energyFactor * loadFactor * environmentFactor;
  }

  // ===========================================================================
  // Catálogo (sección 12) — selección determinista/RNG-agnóstica.
  // ===========================================================================
  function pickWeighted(entries, weightFn, unitRoll) {
    const weights = entries.map(weightFn);
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return entries[entries.length - 1];
    let roll = unitRoll * total;
    for (let i = 0; i < entries.length; i++) {
      roll -= weights[i];
      if (roll < 0) return entries[i];
    }
    return entries[entries.length - 1];
  }

  // Sesga el peso del catálogo a favor de la MISMA zona/tipo que la entrada
  // "caliente" del historial (ver computeHistoryFactor) — la única vía por
  // la que la recurrencia real influye en QUÉ lesión concreta ocurre.
  function biasCatalogWeight(catalogId, entry, mechanism, hotEntry, historyFactor, config) {
    const baseWeight = entry.weight * (entry.mechanisms[mechanism] || 0);
    if (!hotEntry || historyFactor <= 1) return baseWeight;
    if (hotEntry.type === catalogId) return baseWeight * historyFactor;
    if (hotEntry.bodyArea === entry.bodyArea) {
      const excess = historyFactor - 1;
      return baseWeight * (1 + excess * config.medical.history.sameAreaDifferentTypeShare);
    }
    return baseWeight;
  }

  function selectCatalogEntry(mechanism, hotEntry, historyFactor, config, unitRoll) {
    const catalog = config.medical.catalog;
    const candidates = Object.keys(catalog).filter((id) => (catalog[id].mechanisms[mechanism] || 0) > 0);
    if (!candidates.length) return null;
    const chosen = pickWeighted(
      candidates,
      (id) => biasCatalogWeight(id, catalog[id], mechanism, hotEntry, historyFactor, config),
      unitRoll,
    );
    return chosen;
  }

  function selectSeverity(catalogId, config, unitRoll) {
    const entry = config.medical.catalog[catalogId];
    const severities = Object.keys(entry.severities);
    return pickWeighted(severities, (s) => entry.severities[s], unitRoll);
  }

  function sampleRange([min, max], unitRoll) {
    return min + (max - min) * unitRoll;
  }

  // ===========================================================================
  // Creación/cierre de lesiones (secciones 4/10/13/14/27)
  // ===========================================================================
  let localInjuryCounter = 0;
  function nextInjuryId() {
    localInjuryCounter += 1;
    return `injury-${localInjuryCounter}-${Date.now().toString(36)}`;
  }

  // `rng`: función `() => [0,1)` — deterministaUnit(seed) para entrenamiento,
  // Math.random para partido (sección 5, explícitamente permitido).
  function createInjury(player, { mechanism, date, source, competition }, config, rng) {
    ensureMedicalState(player, config, date);
    const { factor: historyFactor, hotEntry } = computeHistoryFactor(player, date, config);
    const catalogId = selectCatalogEntry(mechanism, hotEntry, historyFactor, config, rng());
    if (!catalogId) return null;
    const catalogEntry = config.medical.catalog[catalogId];
    const severity = selectSeverity(catalogId, config, rng());
    const [minDays, maxDays] = catalogEntry.recoveryDaysBySeverity[severity];
    const targetRecoveryDays = Math.round(sampleRange([minDays, maxDays], rng()));
    const [varMin, varMax] = config.medical.recoveryVarianceRange;
    const recoveryVariance = sampleRange([varMin, varMax], rng());

    // recurrenceOf (sección 10): lesión previa MÁS relevante — mismo tipo
    // reciente si existe, si no la entrada "caliente" general.
    const history = player.medicalState.injuryHistory;
    const sameType = history.filter((h) => h.type === catalogId)
      .sort((a, b) => b.recoveredAt - a.recoveredAt)[0];
    const recurrenceOf = sameType ? sameType.id : (hotEntry ? hotEntry.id : null);

    const injury = {
      id: nextInjuryId(),
      type: catalogId,
      bodyArea: catalogEntry.bodyArea,
      mechanism,
      severity,
      occurredAt: new Date(date),
      source, // 'match' | 'training'
      competition: competition || null,
      recoveryProgress: 0,
      lastProcessedDate: new Date(date),
      targetRecoveryDays,
      recoveryVariance,
      recurrenceOf,
      limitedFromProgress: null,
      sequelaApplied: false,
      setbackCount: 0,
    };
    player.medicalState.currentInjury = injury;
    return injury;
  }

  function computePhase(recoveryProgress, severity, config) {
    const cfg = config.medical.phases;
    if (recoveryProgress < cfg.treatmentMax) return 'treatment';
    if (recoveryProgress < cfg.rehabMax) return 'rehab';
    const modifiedMax = cfg.modifiedTrainingMaxBySeverity[severity] !== undefined
      ? cfg.modifiedTrainingMaxBySeverity[severity] : cfg.modifiedTrainingMaxBySeverity.moderate;
    if (recoveryProgress < modifiedMax) return 'modifiedTraining';
    if (recoveryProgress < 1) return 'limited';
    return 'available';
  }

  function computeMinuteCap(recoveryProgress, phase, severity, config, team) {
    if (phase !== 'limited') return null;
    const cfg = config.medical.minuteCap;
    const modifiedMax = config.medical.phases.modifiedTrainingMaxBySeverity[severity] !== undefined
      ? config.medical.phases.modifiedTrainingMaxBySeverity[severity] : config.medical.phases.modifiedTrainingMaxBySeverity.moderate;
    const t = clamp((recoveryProgress - modifiedMax) / (1 - modifiedMax), 0, 1);
    const physicalPrepLevel = team ? team.facilities.physicalPreparation.level : 10;
    const bonus = interpolateCurve(cfg.physicalPreparationBonusCurve, physicalPrepLevel) * t;
    const cap = cfg.atEnterLimited + (cfg.atAvailable - cfg.atEnterLimited) * t + bonus;
    return Math.round(clamp(cap, cfg.atEnterLimited, cfg.atAvailable + cfg.physicalPreparationBonusCurve[1][1]));
  }

  // Sección 27: secuela rara, basada en la lesión concreta. `rng`: función
  // `() => [0,1)`.
  function maybeApplySequela(player, injury, config, team, rng) {
    if (injury.sequelaApplied) return false;
    const catalogEntry = config.medical.catalog[injury.type];
    if (!catalogEntry.sequelaAttributes || !catalogEntry.sequelaAttributes.length) return false;
    let probability = config.medical.sequela.baseProbabilityBySeverity[injury.severity] || 0;
    if (probability <= 0) return false;
    if (injury.recurrenceOf) {
      const original = player.medicalState.injuryHistory.find((h) => h.id === injury.recurrenceOf);
      if (original && daysBetween(original.recoveredAt, injury.occurredAt) <= config.medical.sequela.recentRecurrenceWindowDays) {
        probability += config.medical.sequela.recentRecurrenceBonus;
      }
    }
    const medicalLevel = team ? team.facilities.medicalCenter.level : 10;
    const staff = getMedicalStaffContext(config, team);
    const reduction = weightedFacilityStaffFactor(
      medicalLevel, staff.doctor, config.medical.environment.sequelaReductionCurve, config,
    );
    probability = clamp(probability * reduction, 0, 1);
    if (rng() >= probability) return false;

    const pdRef = PD();
    const attrs = catalogEntry.sequelaAttributes;
    const maxAttrs = Math.min(config.medical.sequela.maxAttributesAffected, attrs.length);
    const count = 1 + Math.floor(rng() * maxAttrs);
    const [minDelta, maxDelta] = config.medical.sequela.aggregateDeltaRange;
    const totalDelta = -sampleRange([minDelta, maxDelta], rng());
    const chosen = [...attrs].sort(() => rng() - 0.5).slice(0, count);
    const perAttr = totalDelta / chosen.length;
    if (player.developmentState) {
      chosen.forEach((attr) => pdRef.applyResidualDelta(player, attr, perAttr));
    }
    injury.sequelaApplied = true;
    return true;
  }

  function closeInjury(player, date, config, team, rng) {
    const injury = player.medicalState.currentInjury;
    if (!injury) return null;
    const rollFn = rng || Math.random;
    maybeApplySequela(player, injury, config, team, rollFn);
    player.medicalState.injuryHistory.push({
      id: injury.id,
      type: injury.type,
      bodyArea: injury.bodyArea,
      mechanism: injury.mechanism,
      severity: injury.severity,
      occurredAt: injury.occurredAt,
      recoveredAt: new Date(date),
      daysUnavailable: Math.round(daysBetween(injury.occurredAt, date)),
      recurrenceOf: injury.recurrenceOf,
      sequela: injury.sequelaApplied,
    });
    player.medicalState.currentInjury = null;
    return injury;
  }

  // Sección 18: recaída/setback de la lesión ACTIVA en fase `limited` — no
  // crea un segundo `currentInjury`.
  function applySetback(player, config, rng) {
    const injury = player.medicalState.currentInjury;
    if (!injury) return null;
    const [rMin, rMax] = config.medical.setback.recoveryProgressRangeBySeverity[injury.severity]
      || config.medical.setback.recoveryProgressRangeBySeverity.moderate;
    injury.recoveryProgress = Math.min(injury.recoveryProgress, sampleRange([rMin, rMax], rng()));
    injury.setbackCount += 1;
    injury.lastProcessedDate = injury.lastProcessedDate; // sin cambio de fecha, solo de progreso
    return injury;
  }

  // ===========================================================================
  // Disponibilidad — API única (sección 17).
  // ===========================================================================
  function getAvailability(player, date, config, context) {
    const team = context && context.team;
    ensureMedicalState(player, config, date);
    const injury = player.medicalState.currentInjury;
    if (!injury) {
      return { status: 'available', phase: 'available', minuteCap: null, injury: null, riskBand: describeRiskBand(player, date, config, team) };
    }
    const phase = computePhase(injury.recoveryProgress, injury.severity, config);
    if (phase === 'available') {
      return { status: 'available', phase: 'available', minuteCap: null, injury: null, riskBand: describeRiskBand(player, date, config, team) };
    }
    const minuteCap = computeMinuteCap(injury.recoveryProgress, phase, injury.severity, config, team);
    const status = phase === 'limited' ? 'limited' : 'unavailable';
    return { status, phase, minuteCap, injury, riskBand: describeRiskBand(player, date, config, team) };
  }

  // ===========================================================================
  // Bandas para UI (sección 32) — nunca fórmulas duplicadas en game.js.
  // ===========================================================================
  function describeRiskBand(player, date, config, team) {
    ensureMedicalState(player, config, date);
    const riskNonContact = computeMechanismRisk(1, player, date, 'acuteNonContact', config, team);
    // `computeMechanismRisk` con baseExposureRisk=1 devuelve el PRODUCTO de
    // todos los modificadores (nunca una probabilidad real) — suficiente
    // como índice relativo ordenable para la banda de riesgo de UI, sin
    // mostrar fórmula ni probabilidad exacta (sección 32).
    if (riskNonContact < 1.05) return 'bajo';
    if (riskNonContact < 1.35) return 'normal';
    if (riskNonContact < 1.75) return 'alto';
    return 'muyAlto';
  }

  function describeLoadBand(player, date, config) {
    const recent7d = sumLoadInWindow(player, addDays(date, -config.medical.load.recentWindowDays), addDays(date, 1));
    const ratio = recent7d / config.medical.load.referenceWeeklyLoad;
    if (ratio < 0.5) return 'baja';
    if (ratio < 1.15) return 'normal';
    if (ratio < 1.5) return 'alta';
    return 'muyAlta';
  }

  // ===========================================================================
  // Rehabilitación progresiva (secciones 15/16) — avance por DÍAS reales
  // transcurridos (nunca por tick semanal), independiente de la cadencia de
  // LIFE-2/entrenamiento — así una lesión de 5 días no espera a la próxima
  // semana de desarrollo para dar el alta.
  // ===========================================================================
  function advanceRehab(player, targetDate, config, team) {
    const injury = player.medicalState.currentInjury;
    if (!injury) return;
    const elapsedDays = daysBetween(injury.lastProcessedDate, targetDate);
    if (elapsedDays <= 0) { injury.lastProcessedDate = new Date(targetDate); return; }
    const recoverySpeed = computeRecoverySpeedFactor(player, config);
    const envSpeed = computeRehabSpeedEnvironmentFactor(team, config);
    const dailyProgress = (1 / (injury.targetRecoveryDays * injury.recoveryVariance)) * recoverySpeed * envSpeed;
    injury.recoveryProgress = clamp(injury.recoveryProgress + dailyProgress * elapsedDays, 0, 1);
    injury.lastProcessedDate = new Date(targetDate);
    if (injury.recoveryProgress >= 1) {
      closeInjury(player, targetDate, config, team);
    }
  }

  // Sección 28: decay mínimo de Competition Rhythm SOLO durante
  // indisponibilidad médica real (unavailable/limited) — nunca fija el
  // alta a 100, los minutos reales reconstruyen el resto (mismo mecanismo
  // ya existente, `Player.adjustCompetitionRhythm`).
  function applyCompetitionRhythmDecay(player, elapsedDays, config) {
    if (elapsedDays <= 0) return;
    const decay = config.medical.competitionRhythmDecayPerDayUnavailable * elapsedDays;
    if (decay > 0) player.adjustCompetitionRhythm(-decay);
  }

  // ===========================================================================
  // Procesamiento hasta una fecha (día a día en cuanto a rehab; carga de
  // entrenamiento SIGUE viniendo del hook semanal de Training.js, sección
  // 18 — Medical.js nunca reimplementa un calendario de gimnasio paralelo).
  // ===========================================================================
  function processPlayerMedicalToDate(player, targetDate, config, team) {
    ensureMedicalState(player, config, targetDate);
    const ms = player.medicalState;
    const elapsedDays = daysBetween(ms.lastProcessedDate, targetDate);
    if (elapsedDays <= 0) return;
    const wasUnavailable = !!ms.currentInjury;
    if (ms.currentInjury) {
      advanceRehab(player, targetDate, config, team);
    }
    if (wasUnavailable) {
      applyCompetitionRhythmDecay(player, elapsedDays, config);
    }
    pruneLoadHistory(player, targetDate, config);
    ms.lastProcessedDate = new Date(targetDate);
  }

  function processTeamMedicalToDate(team, targetDate, config) {
    team.roster.forEach((player) => processPlayerMedicalToDate(player, targetDate, config, team));
  }

  // ===========================================================================
  // Sección 23: excepción médica de convocatoria — cuántos de `players`
  // (por defecto, y en el uso normal de pre-convocatoria, `team.roster`
  // completo) están médicamente disponibles/limitados (nunca
  // "unavailable") en la fecha dada. `team`: solo para el contexto de
  // instalaciones de `getAvailability()`, nunca para decidir la lista.
  // ===========================================================================
  function countMedicallyCallable(players, team, date, config) {
    return players.filter((p) => getAvailability(p, date, config, { team }).status !== 'unavailable').length;
  }

  // Guarda extrema (sección 23, y sección 20 aplicada también DENTRO de
  // un partido ya en curso — invariante 14, "el motor no genera una
  // lesión que deje <5 disponibles"): ¿generar esta lesión dejaría a
  // `players` por debajo del mínimo absoluto de disponibles?
  // `excludingPlayerId`: el jugador que se lesionaría ahora (ya cuenta
  // como disponible hasta este instante, se descuenta explícitamente).
  // `players` es la CONVOCATORIA real del partido (`state.homeSquad`/
  // `awaySquad`) cuando se llama desde MatchEngine — no basta con que el
  // ROSTER completo del club siga teniendo 5 disponibles si la mayoría
  // no fueron convocados a este partido concreto.
  function wouldDropBelowMinimum(players, team, date, config, excludingPlayerId) {
    const callable = countMedicallyCallable(players, team, date, config);
    const afterInjury = callable - 1; // excludingPlayerId pasa de disponible a no disponible
    return afterInjury < config.medical.squadException.absoluteMinimum;
  }

  // ===========================================================================
  // Entrenamiento (sección 18) — evaluado UNA vez por tick semanal real de
  // LIFE-2, llamado desde Training.buildPlayerTickContext con la carga YA
  // calculada de esa semana. `weeklyLoadUnits`: misma cifra que Training.js
  // usa para el coste de Energy (Training.computeWeeklyTrainingLoadUnits),
  // nunca reimplementada aquí.
  // ===========================================================================
  function evaluateWeeklyTrainingTick(player, team, tickDate, weeklyLoadUnits, config) {
    ensureMedicalState(player, config, tickDate);
    const ms = player.medicalState;
    // Sección 5/15 del prompt LIFE-3: idempotencia propia de ESTE tick —
    // llamar dos veces con el mismo tickDate (ej. dos rutas de resolución
    // de partido tocando al mismo jugador) no vuelve a registrar carga ni
    // a sortear una segunda lesión/recaída para esa semana.
    if (ms.lastTrainingTickDate && ms.lastTrainingTickDate.getTime() === tickDate.getTime()) return null;
    ms.lastTrainingTickDate = new Date(tickDate);
    registerLoad(player, tickDate, weeklyLoadUnits, 'training', config);

    const injury = player.medicalState.currentInjury;
    if (injury) {
      const phase = computePhase(injury.recoveryProgress, injury.severity, config);
      if (phase !== 'limited') return null; // treatment/rehab/modifiedTraining: nunca se sortea nada nuevo
      if (wouldDropBelowMinimum(team.roster, team, tickDate, config, player.id)) return null;
      const seed = player.medicalState.medicalSeed;
      const rollUnit = deterministicUnit(seed, 'setback', isoDay(tickDate));
      const p = computeMechanismRisk(
        config.medical.training.baseWeeklyIncidence, player, tickDate, 'acuteNonContact', config, team,
      );
      if (rollUnit < p) return applySetback(player, config, () => deterministicUnit(seed, 'setbackRoll', isoDay(tickDate)));
      return null;
    }

    if (wouldDropBelowMinimum(team.roster, team, tickDate, config, player.id)) return null;
    const seed = player.medicalState.medicalSeed;
    const cfg = config.medical.training;
    const pNonContact = cfg.nonContactShare * computeMechanismRisk(
      cfg.baseWeeklyIncidence, player, tickDate, 'acuteNonContact', config, team,
    );
    const pOveruse = cfg.overuseShare * computeMechanismRisk(
      cfg.baseWeeklyIncidence, player, tickDate, 'overuse', config, team,
    );
    const total = pNonContact + pOveruse;
    const rollUnit = deterministicUnit(seed, 'trainingInjury', isoDay(tickDate));
    if (rollUnit >= total) return null;
    const mechanism = rollUnit < pNonContact ? 'acuteNonContact' : 'overuse';
    let calls = 0;
    const rng = () => deterministicUnit(seed, 'trainingInjuryDetail', isoDay(tickDate), (calls += 1));
    return createInjury(player, { mechanism, date: tickDate, source: 'training', competition: null }, config, rng);
  }

  // ===========================================================================
  // Partido (secciones 19/20) — hazard convertido correctamente a
  // probabilidad por segundo de exposición real, con Math.random (fuente
  // RNG normal del propio MatchEngine, sección 5).
  // ===========================================================================
  // `players`: array de { player, team, squad } realmente en pista esta
  // posesión (ambos lados juntos, 10 entradas típicas). `squad`: la
  // CONVOCATORIA real de ese lado en este partido (`state.homeSquad`/
  // `awaySquad`, no `team.roster` completo) — la guarda de integridad de
  // más abajo debe proteger a los 8-12 convocados a ESTE partido, no al
  // club entero (invariante 14: dentro de un partido ya en curso, no solo
  // al construir la convocatoria). Devuelve como mucho UNA lesión (la
  // primera que dispara, en orden de `players`) — no tiene sentido
  // narrativo ni de guarda de integridad generar dos lesiones en la misma
  // posesión.
  function evaluateMatchPossessionInjuries(players, elapsedSeconds, date, config) {
    if (!config.medical.enabled || elapsedSeconds <= 0) return [];
    const cfg = config.medical.match;
    const hazardPerSecond = (cfg.hazardPerThousandPlayerHours / 1000) / 3600;
    const baseExposure = hazardPerSecond * elapsedSeconds;
    const triggered = [];
    players.forEach(({ player, team, squad }) => {
      if (triggered.length) return; // ya se generó una lesión esta posesión
      ensureMedicalState(player, config, date);
      if (player.medicalState.currentInjury) return; // ya lesionado, no puede lesionarse de nuevo
      const pContact = cfg.contactShare * computeMechanismRisk(baseExposure, player, date, 'acuteContact', config, team);
      const pNonContact = cfg.nonContactShare * computeMechanismRisk(baseExposure, player, date, 'acuteNonContact', config, team);
      const total = pContact + pNonContact;
      if (Math.random() >= total) return;
      if (wouldDropBelowMinimum(squad || team.roster, team, date, config, player.id)) return;
      const mechanism = Math.random() < (pContact / total) ? 'acuteContact' : 'acuteNonContact';
      const injury = createInjury(player, { mechanism, date, source: 'match', competition: null }, config, Math.random);
      if (injury) triggered.push({ player, team, injury });
    });
    return triggered;
  }

  // ===========================================================================
  // Estimación de vuelta (sección 29) — rango, nunca fecha exacta.
  // ===========================================================================
  function formatDayRange(minDays, maxDays) {
    const lo = Math.max(1, Math.round(minDays));
    const hi = Math.max(lo, Math.round(maxDays));
    if (hi <= 10) return `${lo}-${hi} días`;
    if (hi <= 60) return `${Math.round(lo / 7)}-${Math.round(hi / 7)} semanas`;
    return `${Math.round(lo / 30)}-${Math.round(hi / 30)} meses`;
  }

  function getEstimatedReturnRange(player, date, config, team) {
    const injury = player.medicalState && player.medicalState.currentInjury;
    if (!injury) return null;
    const speed = computeRecoverySpeedFactor(player, config) * computeRehabSpeedEnvironmentFactor(team, config);
    const remainingProgress = Math.max(0, 1 - injury.recoveryProgress);
    const remainingDays = (remainingProgress * injury.targetRecoveryDays * injury.recoveryVariance) / speed;
    const medicalLevel = team ? team.facilities.medicalCenter.level : 10;
    const uncertaintyCfg = config.medical.estimatedReturnUncertainty;
    const uncertainty = interpolateCurve(
      [[1, uncertaintyCfg.atLevel1], [20, uncertaintyCfg.atLevel20]], medicalLevel,
    );
    const lo = remainingDays * (1 - uncertainty);
    const hi = remainingDays * (1 + uncertainty);
    return { minDays: lo, maxDays: hi, label: formatDayRange(lo, hi) };
  }

  const exportsObj = {
    ensureMedicalState,
    getAvailability,
    computePhase,
    computeMinuteCap,
    computeDurabilityFactor,
    computeRecoverySpeedFactor,
    computeMechanismRisk,
    computeLoadFactor,
    computeEnergyFactor,
    computeHistoryFactor,
    computeEnvironmentFactor,
    registerLoad,
    sumLoadInWindow,
    describeRiskBand,
    describeLoadBand,
    createInjury,
    closeInjury,
    applySetback,
    processPlayerMedicalToDate,
    processTeamMedicalToDate,
    countMedicallyCallable,
    wouldDropBelowMinimum,
    evaluateWeeklyTrainingTick,
    evaluateMatchPossessionInjuries,
    getEstimatedReturnRange,
    // Expuestas para tests dirigidos (mismo criterio que
    // PlayerDevelopment.hashToUnitInterval/deterministicUnit).
    hashToUnitInterval,
    deterministicUnit,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
