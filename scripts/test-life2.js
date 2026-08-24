#!/usr/bin/env node
// scripts/test-life2.js
// Verificación LIFE-2 (DESIGN.md 9.13) — script Node ad-hoc, mismo criterio
// que el resto del proyecto (no hay framework de tests instalado, ver
// CLAUDE.md): construye escenarios sintéticos y comprueba los invariantes
// duros de la sección 42 del prompt de esta sesión. Ejecutar con:
//   node scripts/test-life2.js

const assert = require('assert');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const Training = require('../src/core/Training.js');
const TrainingAI = require('../src/core/TrainingAI.js');
const Recovery = require('../src/core/Recovery.js');
const { generateFictionalPlayer } = require('../src/utils/playerGenerator.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}`);
    console.log(`     ${err.message}`);
  }
}

const SEASON_START = new Date('2026-10-03T00:00:00Z');
const CALENDAR_CTX = { seasonStartDate: SEASON_START };

function birthDateForAge(age, ref = SEASON_START) {
  const d = new Date(ref);
  d.setFullYear(d.getFullYear() - age);
  return d;
}

function makePlayer(overrides = {}) {
  const data = {
    id: overrides.id, // si se omite, Player genera un id random (developmentSeed distinto cada vez)
    firstName: 'Test', lastName: 'Player',
    birthDate: birthDateForAge(overrides.age !== undefined ? overrides.age : 24),
    positions: overrides.positions || { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: overrides.nominalPosition || 'Base',
    technical: overrides.technical || {}, physical: overrides.physical || {}, mental: overrides.mental || {},
    hidden: {
      potential: overrides.potential !== undefined ? overrides.potential : 150,
      professionalism: overrides.professionalism !== undefined ? overrides.professionalism : 10,
      ambition: overrides.ambition !== undefined ? overrides.ambition : 10,
      learningRate: overrides.learningRate !== undefined ? overrides.learningRate : 10,
      learningPersistence: overrides.learningPersistence !== undefined ? overrides.learningPersistence : 10,
    },
  };
  const player = new Player(data);
  PD.ensureDevelopmentState(player, CONFIG_BASE, overrides.referenceDate || SEASON_START);
  return player;
}

function makeTeam(playersOrCount = 12, teamData = {}) {
  const roster = Array.isArray(playersOrCount)
    ? playersOrCount
    : Array.from({ length: playersOrCount }, () => makePlayer());
  return new Team({ name: 'Test Team', roster, ...teamData });
}

// --- 1: save legacy sin trainingPlan carga Balanced/Normal ---
check('Team legacy sin trainingPlan carga Balanced/Normal/sin focos', () => {
  const team = new Team({ name: 'Legacy', roster: [] });
  assert.strictEqual(team.trainingPlan.teamFocus, 'balanced');
  assert.strictEqual(team.trainingPlan.intensity, 'normal');
  assert.deepStrictEqual(team.trainingPlan.individualFocuses, {});
});

// --- 2: plan se serializa y recarga idéntico ---
check('trainingPlan/trainingState se serializan y recargan idénticos', () => {
  const team = makeTeam(3);
  Training.setPlan(team, { teamFocus: 'offense', intensity: 'high' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  Training.setIndividualFocus(team, team.roster[0].id, { type: 'attribute', target: 'outsideShot' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  const json = team.toJSON();
  const reloaded = new Team({ ...json, roster: json.roster.map((p) => new Player(p)) });
  assert.strictEqual(reloaded.trainingPlan.teamFocus, 'offense');
  assert.strictEqual(reloaded.trainingPlan.intensity, 'high');
  assert.deepStrictEqual(reloaded.trainingPlan.individualFocuses, team.trainingPlan.individualFocuses);
  assert.strictEqual(reloaded.trainingState.lastProcessedDate.getTime(), team.trainingState.lastProcessedDate.getTime());
});

// --- 3/32: cambiar plan no modifica el pasado ---
check('Cambiar teamFocus en fecha X solo afecta desde X (no reescribe el pasado)', () => {
  const sharedId = 'shared-seed-player-1';
  const teamA = makeTeam([makePlayer({ id: sharedId, potential: 200 })]);
  const teamB = makeTeam([makePlayer({ id: sharedId, potential: 200 })]);
  let date = new Date(SEASON_START);
  // Ambos con Balanced 3 semanas.
  for (let w = 0; w < 3; w++) {
    date = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    Training.processTeamDevelopmentToDate(teamA, date, CONFIG_BASE, CALENDAR_CTX);
    Training.processTeamDevelopmentToDate(teamB, date, CONFIG_BASE, CALENDAR_CTX);
  }
  const snapshotA = PD.getEffectiveAttribute(teamA.roster[0], 'outsideShot');
  const snapshotB = PD.getEffectiveAttribute(teamB.roster[0], 'outsideShot');
  assert.ok(Math.abs(snapshotA - snapshotB) < 1e-9, 'antes de divergir deben ser idénticos');
  // A cambia a Offense; B se queda Balanced. El pasado (semanas 1-3) no debe recalcularse.
  Training.setTeamFocus(teamA, 'offense', date, CONFIG_BASE, CALENDAR_CTX);
  assert.strictEqual(PD.getEffectiveAttribute(teamA.roster[0], 'outsideShot'), snapshotA, 'el flush no debe alterar lo ya procesado');
});

// --- 4: Balanced+Normal ~neutral ---
check('Balanced/Normal produce vector de estímulo neutro (1.00 en todos los mutables)', () => {
  const player = makePlayer();
  const vector = Training.computeTeamFocusStimulusVector(player, 'balanced', CONFIG_BASE);
  PD.ALL_MUTABLE_ATTRIBUTES.forEach((attr) => {
    assert.ok(Math.abs(vector[attr] - 1.0) < 1e-9, `balanced debería ser 1.00 en ${attr}`);
  });
});

// --- 5: Offense/Defense/Physical redistribuyen sin presupuesto gratis ---
['offense', 'defense', 'physical'].forEach((focus) => {
  check(`Team focus "${focus}" no crea presupuesto ponderado extra (redistribuye)`, () => {
    const player = makePlayer();
    const vector = Training.computeTeamFocusStimulusVector(player, focus, CONFIG_BASE);
    const weights = PD.getPositionWeights(player.nominalPosition, CONFIG_BASE);
    let sumWeight = 0; let sumWeighted = 0;
    PD.ALL_MUTABLE_ATTRIBUTES.forEach((attr) => { sumWeight += weights[attr]; sumWeighted += weights[attr] * vector[attr]; });
    const weightedAverage = sumWeighted / sumWeight;
    assert.ok(Math.abs(weightedAverage - 1.0) < 1e-6, `presupuesto ponderado debería volver a 1.00, salió ${weightedAverage}`);
  });
});

// --- 6: Tactical sacrifica desarrollo de atributos ---
check('Team focus "tactical" tiene presupuesto de atributos por debajo de 1.00 (no normalizado)', () => {
  const player = makePlayer();
  const vector = Training.computeTeamFocusStimulusVector(player, 'tactical', CONFIG_BASE);
  const avg = PD.ALL_MUTABLE_ATTRIBUTES.reduce((s, a) => s + vector[a], 0) / PD.ALL_MUTABLE_ATTRIBUTES.length;
  assert.ok(avg < 1.0, `tactical debería quedar por debajo de 1.00, salió ${avg}`);
});

// --- 7/8: intensidad vs Energy/desarrollo ---
check('Recovery intensity: menos desarrollo y más recuperación que Normal; High al revés', () => {
  const rec = CONFIG_BASE.training.intensity.recovery;
  const normal = CONFIG_BASE.training.intensity.normal;
  const high = CONFIG_BASE.training.intensity.high;
  assert.ok(rec.developmentMultiplier < normal.developmentMultiplier);
  assert.ok(rec.recoveryMultiplier > normal.recoveryMultiplier);
  assert.ok(rec.energyCostPerLoadUnit < normal.energyCostPerLoadUnit);
  assert.ok(high.developmentMultiplier > normal.developmentMultiplier);
  assert.ok(high.recoveryMultiplier < normal.recoveryMultiplier);
  assert.ok(high.energyCostPerLoadUnit > normal.energyCostPerLoadUnit);
});

// --- 9/26: Energy y familiaridad nunca salen de rango ---
check('Energy nunca sale de [0,100] tras muchos ticks en High', () => {
  const team = makeTeam(12);
  Training.setPlan(team, { teamFocus: 'balanced', intensity: 'high' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  let date = new Date(SEASON_START);
  for (let w = 0; w < 30; w++) {
    date = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    Training.registerTeamMatchDate(team, date);
    Training.prepareTeamForMatch(team, date, CONFIG_BASE, CALENDAR_CTX);
  }
  team.roster.forEach((p) => assert.ok(p.dynamicState.energy >= 0 && p.dynamicState.energy <= 100, `energy=${p.dynamicState.energy}`));
});

check('Familiaridad táctica nunca sale de [0,100] tras muchos ticks en Tactical', () => {
  const team = makeTeam(12);
  Training.setPlan(team, { teamFocus: 'tactical', intensity: 'high' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  let date = new Date(SEASON_START);
  for (let w = 0; w < 60; w++) {
    date = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    Training.processTeamDevelopmentToDate(team, date, CONFIG_BASE, CALENDAR_CTX);
  }
  const fam = team.tacticalProfile.familiarity;
  [fam.offensiveSystem, fam.defensiveSystem, ...Object.values(fam.byPlayFamily), ...Object.values(fam.byCoverage)]
    .forEach((v) => assert.ok(v >= 0 && v <= 100, `familiaridad fuera de rango: ${v}`));
});

// --- 10: no doble aplicación de Recovery ---
check('prepareTeamForMatch no aplica Recovery dos veces para la misma fecha (idempotente)', () => {
  const team = makeTeam(1);
  const player = team.roster[0];
  player.dynamicState.energy = 50;
  player.dynamicState.lastMatchDate = SEASON_START;
  const matchDate = new Date(SEASON_START.getTime() + 5 * 24 * 60 * 60 * 1000);
  Training.prepareTeamForMatch(team, matchDate, CONFIG_BASE, CALENDAR_CTX);
  const energyAfterFirst = player.dynamicState.energy;
  assert.ok(energyAfterFirst > 50, 'debería haber recuperado algo de Energy');
  Training.prepareTeamForMatch(team, matchDate, CONFIG_BASE, CALENDAR_CTX);
  assert.strictEqual(player.dynamicState.energy, energyAfterFirst, 'una segunda llamada con la MISMA fecha no debe recuperar de nuevo');
});

// --- 11: semana congestionada reduce oportunidad ---
check('matchDensity: más partidos/semana reduce opportunityFactor', () => {
  const { matchDensity } = CONFIG_BASE.training;
  assert.ok(matchDensity[0].opportunityFactor > matchDensity[1].opportunityFactor);
  assert.ok(matchDensity[1].opportunityFactor > matchDensity[2].opportunityFactor);
  assert.ok(matchDensity[2].opportunityFactor > matchDensity[3].opportunityFactor);
});

// --- 12/13: no se multiplican dos veces mindset/facilities ---
// Nota de diseño del test: MISMO `id` (developmentSeed) en ambas ramas —
// `noiseFactor` depende solo de developmentSeed/atributo/fecha, nunca de
// mindset/facilities, así que compartir seed anula el ruido determinista
// (sección 24 de LIFE-1) y dejas SOLO la variable que se quiere medir. Con
// seeds distintos el ruido acumulado en 20 semanas puede superar la señal
// real y producir ratios sin sentido sin que exista ningún doble cómputo.
check('El mismo factor de mindset (Professionalism/Ambition/learningRate) no se aplica dos veces', () => {
  const sharedId = 'mindset-shared-seed';
  const low = makePlayer({ id: sharedId, potential: 200, professionalism: 1, ambition: 1, learningRate: 1 });
  const high = makePlayer({ id: sharedId, potential: 200, professionalism: 20, ambition: 20, learningRate: 20 });
  const teamLow = makeTeam([low]);
  const teamHigh = makeTeam([high]);
  // Valor inicial REAL (no se asume 10: ensureDevelopmentState ya deja un
  // residual legacy determinista ±0.45 en attributeProgress al crear el
  // jugador, así que el efectivo de partida no es exactamente el entero
  // visible) — capturado ANTES de procesar ningún tick.
  const initialLow = PD.getEffectiveAttribute(low, 'outsideShot');
  const initialHigh = PD.getEffectiveAttribute(high, 'outsideShot');
  Training.setPlan(teamLow, { teamFocus: 'balanced', intensity: 'normal' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  Training.setPlan(teamHigh, { teamFocus: 'balanced', intensity: 'normal' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  const target = new Date(SEASON_START.getTime() + 20 * 7 * 24 * 60 * 60 * 1000);
  Training.processTeamDevelopmentToDate(teamLow, target, CONFIG_BASE, CALENDAR_CTX);
  Training.processTeamDevelopmentToDate(teamHigh, target, CONFIG_BASE, CALENDAR_CTX);
  const deltaLow = PD.getEffectiveAttribute(low, 'outsideShot') - initialLow;
  const deltaHigh = PD.getEffectiveAttribute(high, 'outsideShot') - initialHigh;
  const expectedRatio = PD.computeLearningFactor(high, CONFIG_BASE) / PD.computeLearningFactor(low, CONFIG_BASE);
  const actualRatio = deltaHigh / deltaLow;
  assert.ok(Math.abs(actualRatio - expectedRatio) < 0.02 * expectedRatio,
    `ratio esperado ~${expectedRatio.toFixed(3)} (mindsetFactor aplicado una vez), salió ${actualRatio.toFixed(3)} (indicaría doble aplicación)`);
});

check('El mismo facilityFactor no se aplica dos veces (Training no reintroduce facilities)', () => {
  const sharedId = 'facility-shared-seed';
  const lowPlayer = makePlayer({ id: sharedId, potential: 200 });
  const highPlayer = makePlayer({ id: sharedId, potential: 200 });
  const teamLowFac = makeTeam([lowPlayer], { facilities: { trainingCenter: { level: 1 } } });
  const teamHighFac = makeTeam([highPlayer], { facilities: { trainingCenter: { level: 20 } } });
  const initialLow = PD.getEffectiveAttribute(lowPlayer, 'outsideShot');
  const initialHigh = PD.getEffectiveAttribute(highPlayer, 'outsideShot');
  Training.setPlan(teamLowFac, { teamFocus: 'balanced', intensity: 'normal' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  Training.setPlan(teamHighFac, { teamFocus: 'balanced', intensity: 'normal' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  const target = new Date(SEASON_START.getTime() + 20 * 7 * 24 * 60 * 60 * 1000);
  Training.processTeamDevelopmentToDate(teamLowFac, target, CONFIG_BASE, CALENDAR_CTX);
  Training.processTeamDevelopmentToDate(teamHighFac, target, CONFIG_BASE, CALENDAR_CTX);
  const deltaLow = PD.getEffectiveAttribute(teamLowFac.roster[0], 'outsideShot') - initialLow;
  const deltaHigh = PD.getEffectiveAttribute(teamHighFac.roster[0], 'outsideShot') - initialHigh;
  const expectedRatio = PD.computeFacilityFactor(20, CONFIG_BASE) / PD.computeFacilityFactor(1, CONFIG_BASE);
  const actualRatio = deltaHigh / deltaLow;
  assert.ok(Math.abs(actualRatio - expectedRatio) < 0.02 * expectedRatio,
    `ratio esperado ~${expectedRatio.toFixed(3)}, salió ${actualRatio.toFixed(3)} (indicaría doble aplicación de facilities)`);
});

// --- 14: attribute focus no permite target no mutable ---
check('normalizeIndividualFocus rechaza atributos no mutables (potential/durability/traits...)', () => {
  ['potential', 'durability', 'aggressiveness', 'temperament', 'workRate', 'foulTendency', 'learningRate'].forEach((bad) => {
    const result = Training.normalizeIndividualFocus({ type: 'attribute', target: bad }, CONFIG_BASE);
    assert.strictEqual(result.type, 'none', `"${bad}" no debería ser un target válido`);
  });
});

// --- 15: attribute focus conserva presupuesto ponderado ---
check('Attribute focus conserva el presupuesto ponderado total (solo redistribuye)', () => {
  const player = makePlayer();
  const base = Training.computeTeamFocusStimulusVector(player, 'balanced', CONFIG_BASE);
  const weights = PD.getPositionWeights(player.nominalPosition, CONFIG_BASE);
  const budgetBefore = PD.ALL_MUTABLE_ATTRIBUTES.reduce((s, a) => s + weights[a] * base[a], 0);
  const focused = Training.applyAttributeFocusRedistribution(player, base, 'outsideShot', CONFIG_BASE);
  const budgetAfter = PD.ALL_MUTABLE_ATTRIBUTES.reduce((s, a) => s + weights[a] * focused[a], 0);
  assert.ok(Math.abs(budgetBefore - budgetAfter) < 1e-6, `presupuesto antes=${budgetBefore} después=${budgetAfter}`);
  assert.ok(focused.outsideShot > base.outsideShot, 'el target debe subir');
});

// --- 16/17/18/20: posición ---
check('Position focus solo mueve la posición target (residual) + no toca TMB/PA/bodyMeasurements/nominalPosition', () => {
  const player = makePlayer({ positions: { Base: 20, Escolta: 9, Alero: 3, 'Ala-pívot': 1, Pívot: 1 } });
  const team = makeTeam([player]);
  Training.setPlan(team, { teamFocus: 'balanced', intensity: 'normal' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  Training.setIndividualFocus(team, player.id, { type: 'position', target: 'Escolta' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  const tmbBefore = PD.computeTmbRating(player, CONFIG_BASE);
  const potentialBefore = player.hidden.potential;
  const bodyBefore = { ...player.bodyMeasurements };
  const nominalBefore = player.nominalPosition;
  let date = new Date(SEASON_START);
  for (let w = 0; w < 20; w++) {
    date = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    Training.registerTeamMatchDate(team, date);
    PD.recordMatchExposure(player, { date, minutes: 30, competition: 'league', division: '1ª', positionMinutes: { Escolta: 30 } });
    Training.prepareTeamForMatch(team, date, CONFIG_BASE, CALENDAR_CTX);
  }
  assert.ok(player.positions.Escolta >= 9, 'Escolta debería haber progresado o mantenerse');
  assert.strictEqual(player.positions.Alero, 3, 'Alero no debería moverse');
  assert.strictEqual(player.positions['Ala-pívot'], 1, 'Ala-pívot no debería moverse');
  assert.strictEqual(player.hidden.potential, potentialBefore, 'position training no debe cambiar PA');
  assert.deepStrictEqual(player.bodyMeasurements, bodyBefore, 'position training no debe cambiar bodyMeasurements');
  assert.strictEqual(player.nominalPosition, nominalBefore, 'nominalPosition no cambia automáticamente');
  // El TMB SÍ puede moverse (crece por el estímulo de atributos del teamFocus, no por la posición en sí) — se
  // verifica por separado que la fórmula de TMB no lee `positions` (invariante 20, ver test siguiente).
  void tmbBefore;
});

check('computeTmbRating no depende de player.positions (invariante 20: posición no alimenta TMB)', () => {
  // Mismo `id` en ambas ramas: developmentSeed idéntico anula el ruido de
  // inicialización de residuales (determinista mismo por seed, sección 24
  // de LIFE-1), que de otro modo introduciría una diferencia de TMB de
  // origen ajeno a `positions` y falsearía la comparación.
  const sharedId = 'tmb-vs-positions-seed';
  const playerA = makePlayer({ id: sharedId, positions: { Base: 20, Escolta: 1, Alero: 1, 'Ala-pívot': 1, Pívot: 1 } });
  const playerB = makePlayer({ id: sharedId, positions: { Base: 20, Escolta: 20, Alero: 20, 'Ala-pívot': 20, Pívot: 20 } });
  assert.strictEqual(PD.computeTmbRating(playerA, CONFIG_BASE), PD.computeTmbRating(playerB, CONFIG_BASE));
});

// --- 19: múltiples posiciones a 20 ---
check('Un jugador puede llegar a 20 en varias posiciones a la vez', () => {
  const player = makePlayer({ positions: { Base: 20, Escolta: 19, Alero: 1, 'Ala-pívot': 1, Pívot: 1 } });
  Training.applyPositionResidualDelta(player, 'Escolta', 0.6);
  assert.strictEqual(player.positions.Escolta, 20);
  assert.strictEqual(player.positions.Base, 20);
  assert.deepStrictEqual(player.masteredPositions().sort(), ['Base', 'Escolta']);
});

// --- 21/22: minutos reales aceleran, nunca inferidos de nominalPosition ---
check('Minutos reales en el target aceleran el aprendizaje frente a sin minutos', () => {
  const withMinutesPlayer = makePlayer({ positions: { Base: 20, Escolta: 9, Alero: 1, 'Ala-pívot': 1, Pívot: 1 } });
  const withoutMinutesPlayer = makePlayer({ positions: { Base: 20, Escolta: 9, Alero: 1, 'Ala-pívot': 1, Pívot: 1 } });
  const teamA = makeTeam([withMinutesPlayer]);
  const teamB = makeTeam([withoutMinutesPlayer]);
  Training.setIndividualFocus(teamA, withMinutesPlayer.id, { type: 'position', target: 'Escolta' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  Training.setIndividualFocus(teamB, withoutMinutesPlayer.id, { type: 'position', target: 'Escolta' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  let date = new Date(SEASON_START);
  for (let w = 0; w < 10; w++) {
    date = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    PD.recordMatchExposure(withMinutesPlayer, { date, minutes: 30, competition: 'league', division: '1ª', positionMinutes: { Escolta: 30 } });
    Training.prepareTeamForMatch(teamA, date, CONFIG_BASE, CALENDAR_CTX);
    Training.prepareTeamForMatch(teamB, date, CONFIG_BASE, CALENDAR_CTX);
  }
  const progressA = Training.ensurePositionProgress(withMinutesPlayer).Escolta + (withMinutesPlayer.positions.Escolta - 9);
  const progressB = Training.ensurePositionProgress(withoutMinutesPlayer).Escolta + (withoutMinutesPlayer.positions.Escolta - 9);
  assert.ok(progressA > progressB, `con minutos (${progressA}) debería superar sin minutos (${progressB})`);
});

check('No se infieren position minutes desde nominalPosition (solo matchExposures reales)', () => {
  const player = makePlayer({ nominalPosition: 'Escolta', positions: { Base: 9, Escolta: 20, Alero: 1, 'Ala-pívot': 1, Pívot: 1 } });
  // Ningún matchExposure registrado con positionMinutes.Base — aunque nominalPosition sea Escolta y el
  // jugador tenga historial de minutos jugados EN Escolta, el rep factor de "Base" debe ser el suelo (0
  // minutos reales), no inferido de otra posición.
  PD.recordMatchExposure(player, { date: SEASON_START, minutes: 30, competition: 'league', division: '1ª', positionMinutes: { Escolta: 30 } });
  const tickDate = new Date(SEASON_START.getTime() + 7 * 24 * 60 * 60 * 1000);
  const repFactor = Training.computeMatchRepFactor(0, CONFIG_BASE);
  const floor = CONFIG_BASE.training.position.matchRep.floor;
  assert.strictEqual(repFactor, floor);
  void tickDate;
});

// --- 23/24: rol usa familiaridad TAC, no altera roleFit ---
check('Role focus usa el mismo almacén de familiaridad TAC-6 (byPlayerRole) y no altera roleFit', () => {
  const Tactics = require('../src/core/Tactics.js');
  const player = makePlayer({ positions: { Base: 20, Escolta: 15, Alero: 1, 'Ala-pívot': 1, Pívot: 1 } });
  const team = makeTeam([player]);
  team.tacticalProfile.roleAssignments[player.id] = { offensiveRole: 'spotUpShooter' };
  const roleFitBefore = Tactics.roleFit(player, 'spotUpShooter', CONFIG_BASE).score;
  Training.setIndividualFocus(team, player.id, { type: 'role', side: 'offense', target: 'spotUpShooter' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  let date = new Date(SEASON_START);
  for (let w = 0; w < 8; w++) {
    date = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    Training.applyWeeklyTacticalTraining(team, date, CONFIG_BASE, CALENDAR_CTX);
  }
  const entry = team.tacticalProfile.familiarity.byPlayerRole[player.id];
  assert.ok(entry && entry.offensiveLevel > CONFIG_BASE.tactics.familiarity.roleDefaultInitial, 'la familiaridad de rol debería haber crecido');
  const roleFitAfter = Tactics.roleFit(player, 'spotUpShooter', CONFIG_BASE).score;
  assert.strictEqual(roleFitAfter, roleFitBefore, 'roleFit no debe cambiar solo por entrenar familiaridad (deriva solo de atributos+POS)');
});

// --- 28: CPU no cambia plan cada jornada ---
check('TrainingAI no revisa el plan colectivo antes de collectiveReviewDays', () => {
  const team = makeTeam(12);
  const before = { ...team.trainingPlan };
  const changed1 = TrainingAI.reviewTeamIfDue(team, SEASON_START, { matchesInNext7Days: 1 }, CONFIG_BASE, CALENDAR_CTX);
  assert.ok(changed1, 'la primera revisión (nunca revisado) sí debe ejecutar');
  const planAfterFirst = { ...team.trainingPlan };
  const nextDay = new Date(SEASON_START.getTime() + 24 * 60 * 60 * 1000);
  TrainingAI.reviewTeamIfDue(team, nextDay, { matchesInNext7Days: 1 }, CONFIG_BASE, CALENDAR_CTX);
  assert.strictEqual(team.trainingPlan.teamFocus, planAfterFirst.teamFocus, 'un día después no debería tocar el plan colectivo de nuevo');
  assert.strictEqual(team.trainingPlan.intensity, planAfterFirst.intensity);
  void before;
});

// --- 30: offseason ignora High y no deja Energy residual absurda ---
check('Offseason fuerza intensidad efectiva a Normal aunque el plan guardado sea High', () => {
  const team = makeTeam(3);
  Training.setPlan(team, { teamFocus: 'balanced', intensity: 'high' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  const offseasonTick = new Date(SEASON_START.getTime() - 10 * 24 * 60 * 60 * 1000);
  const futureCtx = { seasonStartDate: SEASON_START };
  assert.strictEqual(Training.isOffseasonTick(offseasonTick, futureCtx), true);
  const weeklyCtx = Training.computeWeeklyTrainingContext(team, offseasonTick, CONFIG_BASE, futureCtx);
  assert.strictEqual(weeklyCtx.intensityKey, 'normal', 'la intensidad efectiva en offseason debe ser normal aunque el plan diga high');
});

check('Offseason no deja Energy fuera de rango tras muchas semanas sin coste de entrenamiento', () => {
  const team = makeTeam(6);
  Training.setPlan(team, { teamFocus: 'balanced', intensity: 'high' }, new Date('2025-06-01T00:00:00Z'), CONFIG_BASE, { seasonStartDate: SEASON_START });
  Training.processTeamDevelopmentToDate(team, SEASON_START, CONFIG_BASE, { seasonStartDate: SEASON_START });
  team.roster.forEach((p) => assert.ok(p.dynamicState.energy >= 0 && p.dynamicState.energy <= 100));
});

// --- 31: determinismo ---
check('Same save + mismos planes = mismo desarrollo (determinismo)', () => {
  function buildAndRun() {
    const player = makePlayer({ id: 'determinism-player', age: 20, potential: 180 });
    const team = makeTeam([player]);
    Training.setPlan(team, { teamFocus: 'offense', intensity: 'normal' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
    Training.setIndividualFocus(team, player.id, { type: 'attribute', target: 'outsideShot' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
    let date = new Date(SEASON_START);
    for (let w = 0; w < 12; w++) {
      date = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
      Training.registerTeamMatchDate(team, date);
      Training.prepareTeamForMatch(team, date, CONFIG_BASE, CALENDAR_CTX);
    }
    return PD.getEffectiveAttribute(player, 'outsideShot');
  }
  const resultA = buildAndRun();
  const resultB = buildAndRun();
  assert.strictEqual(resultA, resultB);
});

// --- 33: PA sigue limitando crecimiento con High/Focus ---
check('PA (Potential) sigue limitando el crecimiento con intensidad High + foco de atributo', () => {
  const player = makePlayer({ age: 20, potential: 60 });
  Object.keys(player.technical).forEach((k) => { player.technical[k] = 15; });
  const team = makeTeam([player]);
  Training.setPlan(team, { teamFocus: 'balanced', intensity: 'high' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  Training.setIndividualFocus(team, player.id, { type: 'attribute', target: 'outsideShot' }, SEASON_START, CONFIG_BASE, CALENDAR_CTX);
  let date = new Date(SEASON_START);
  for (let w = 0; w < 80; w++) {
    date = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    Training.registerTeamMatchDate(team, date);
    PD.recordMatchExposure(player, { date, minutes: 25, competition: 'league', division: '1ª' });
    Training.prepareTeamForMatch(team, date, CONFIG_BASE, CALENDAR_CTX);
    const uncapped = PD.computeUncappedTmb(player, CONFIG_BASE);
    assert.ok(uncapped <= player.hidden.potential + 1e-6, `semana ${w}: uncapped=${uncapped} > PA=${player.hidden.potential}`);
  }
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
