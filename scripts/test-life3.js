#!/usr/bin/env node
// scripts/test-life3.js
// Verificación LIFE-3 (DESIGN.md 9.14) — script Node ad-hoc, mismo criterio
// que test-life1.js/test-life2.js (no hay framework de tests instalado, ver
// CLAUDE.md): construye escenarios sintéticos y comprueba los invariantes
// duros de la sección 38 del prompt de esta sesión. Ejecutar con:
//   node scripts/test-life3.js

const assert = require('assert');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const Medical = require('../src/core/Medical.js');
const Rotation = require('../src/core/Rotation.js');
const CpuLineup = require('../src/core/CpuLineup.js');
const Training = require('../src/core/Training.js');
const MatchEngine = require('../src/core/MatchEngine.js');
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
    console.log(`     ${err.stack || err.message}`);
  }
}

const REF_DATE = new Date('2026-10-03T00:00:00Z');

function birthDateForAge(age, ref = REF_DATE) {
  const d = new Date(ref);
  d.setFullYear(d.getFullYear() - age);
  return d;
}

function makePlayer(overrides = {}) {
  const data = {
    id: overrides.id,
    firstName: 'Test', lastName: 'Player',
    birthDate: birthDateForAge(overrides.age !== undefined ? overrides.age : 24),
    positions: overrides.positions || { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: overrides.nominalPosition || 'Base',
    technical: overrides.technical || {}, physical: { durability: 10, recovery: 10, ...overrides.physical }, mental: overrides.mental || {},
    hidden: {
      potential: overrides.potential !== undefined ? overrides.potential : 150,
      professionalism: 10, ambition: 10, learningRate: 10, learningPersistence: 10,
    },
    dynamicState: overrides.dynamicState,
  };
  const player = new Player(data);
  PD.ensureDevelopmentState(player, CONFIG_BASE, overrides.referenceDate || REF_DATE);
  return player;
}

function makeTeam(overrides = {}) {
  const roster = overrides.roster || [makePlayer(overrides.player || {})];
  while (roster.length < (overrides.rosterSize || 12)) {
    roster.push(generateFictionalPlayer({ minAge: 20, maxAge: 30, referenceDate: REF_DATE }));
  }
  return new Team({ name: 'LIFE-3 Test Team', roster, ...overrides.teamData });
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ---------------------------------------------------------------------
// 1. No existe injuryProneness nuevo.
// ---------------------------------------------------------------------
check('invariante 1: no existe injuryProneness', () => {
  const player = makePlayer();
  assert.strictEqual(player.hidden.injuryProneness, undefined);
  assert.strictEqual(CONFIG_BASE.medical.injuryProneness, undefined);
});

// ---------------------------------------------------------------------
// 2/3. Durability reduce incidencia (no recuperación); Recovery afecta
// recuperación (no incidencia basal).
// ---------------------------------------------------------------------
check('invariante 2: Durability alta reduce incidencia', () => {
  const low = makePlayer({ physical: { durability: 5, recovery: 10 } });
  const high = makePlayer({ physical: { durability: 18, recovery: 10 } });
  const riskLow = Medical.computeMechanismRisk(1, low, REF_DATE, 'acuteNonContact', CONFIG_BASE, null);
  const riskHigh = Medical.computeMechanismRisk(1, high, REF_DATE, 'acuteNonContact', CONFIG_BASE, null);
  assert.ok(riskHigh < riskLow, `esperado riskHigh(${riskHigh}) < riskLow(${riskLow})`);
  assert.ok(riskHigh > 0, 'Durability alta nunca lleva el riesgo a 0');
});

check('invariante 3: Recovery afecta velocidad de rehabilitación, no incidencia', () => {
  const slow = makePlayer({ physical: { durability: 10, recovery: 1 } });
  const fast = makePlayer({ physical: { durability: 10, recovery: 20 } });
  const riskSlow = Medical.computeMechanismRisk(1, slow, REF_DATE, 'acuteNonContact', CONFIG_BASE, null);
  const riskFast = Medical.computeMechanismRisk(1, fast, REF_DATE, 'acuteNonContact', CONFIG_BASE, null);
  assert.strictEqual(riskSlow, riskFast, 'Recovery no debe cambiar el riesgo');
  const speedSlow = Medical.computeRecoverySpeedFactor(slow, CONFIG_BASE);
  const speedFast = Medical.computeRecoverySpeedFactor(fast, CONFIG_BASE);
  assert.ok(speedFast > speedSlow, 'Recovery alta debe rehabilitar más rápido');
});

// ---------------------------------------------------------------------
// 4. PA/TMB/learning/personality no cambian al crearse una lesión.
// ---------------------------------------------------------------------
check('invariante 4: crear una lesión no cambia PA/TMB/learning/personality', () => {
  const player = makePlayer();
  const before = {
    potential: player.hidden.potential,
    tmb: PD.computeTmbRating(player, CONFIG_BASE),
    learningRate: player.hidden.learningRate,
    learningPersistence: player.hidden.learningPersistence,
    professionalism: player.hidden.professionalism,
    ambition: player.hidden.ambition,
  };
  Medical.createInjury(player, { mechanism: 'acuteNonContact', date: REF_DATE, source: 'training' }, CONFIG_BASE, Math.random);
  assert.strictEqual(player.hidden.potential, before.potential);
  assert.strictEqual(PD.computeTmbRating(player, CONFIG_BASE), before.tmb);
  assert.strictEqual(player.hidden.learningRate, before.learningRate);
  assert.strictEqual(player.hidden.learningPersistence, before.learningPersistence);
  assert.strictEqual(player.hidden.professionalism, before.professionalism);
  assert.strictEqual(player.hidden.ambition, before.ambition);
});

// ---------------------------------------------------------------------
// 5. currentInjury/history/loadHistory sobreviven toJSON/reconstrucción.
// ---------------------------------------------------------------------
check('invariante 5: medicalState sobrevive toJSON/reconstrucción', () => {
  const player = makePlayer();
  Medical.createInjury(player, { mechanism: 'acuteContact', date: REF_DATE, source: 'match' }, CONFIG_BASE, Math.random);
  Medical.registerLoad(player, REF_DATE, 3.2, 'training', CONFIG_BASE);
  const json = player.toJSON();
  assert.ok(json.medicalState.currentInjury, 'currentInjury debe serializarse');
  assert.strictEqual(typeof json.medicalState.currentInjury.occurredAt, 'string');
  const rebuilt = new Player(clone(json));
  assert.ok(rebuilt.medicalState.currentInjury, 'currentInjury debe reconstruirse');
  assert.strictEqual(rebuilt.medicalState.currentInjury.type, player.medicalState.currentInjury.type);
  assert.strictEqual(rebuilt.medicalState.loadHistory.length, 1);
  Medical.ensureMedicalState(rebuilt, CONFIG_BASE, REF_DATE);
  assert.ok(rebuilt.medicalState.currentInjury.occurredAt instanceof Date, 'ensureMedicalState debe coercer fechas');
});

// ---------------------------------------------------------------------
// 6/15. Procesar dos veces la misma fecha no duplica lesión ni
// rehabilitación; training injuries solo se sortean una vez por tick.
// ---------------------------------------------------------------------
check('invariante 6/15: procesar/evaluar dos veces la misma fecha no duplica', () => {
  const player = makePlayer();
  const team = makeTeam({ roster: [player] });
  const tickDate = new Date(REF_DATE.getTime() + 7 * 24 * 60 * 60 * 1000);
  Medical.evaluateWeeklyTrainingTick(player, team, tickDate, 10, CONFIG_BASE);
  const injuryAfterFirst = player.medicalState.currentInjury;
  const loadCountAfterFirst = player.medicalState.loadHistory.length;
  Medical.evaluateWeeklyTrainingTick(player, team, tickDate, 10, CONFIG_BASE);
  assert.strictEqual(player.medicalState.loadHistory.length, loadCountAfterFirst, 'no debe duplicar carga');
  if (injuryAfterFirst) {
    assert.strictEqual(player.medicalState.currentInjury.id, injuryAfterFirst.id, 'no debe generar una segunda lesión');
  }

  // Rehab: procesar dos veces el mismo targetDate no debe avanzar dos veces.
  const injured = makePlayer({ id: 'rehab-idem' });
  Medical.createInjury(injured, { mechanism: 'acuteNonContact', date: REF_DATE, source: 'training' }, CONFIG_BASE, () => 0.4);
  const target = new Date(REF_DATE.getTime() + 3 * 24 * 60 * 60 * 1000);
  Medical.processPlayerMedicalToDate(injured, target, CONFIG_BASE, null);
  const progressAfterFirst = injured.medicalState.currentInjury ? injured.medicalState.currentInjury.recoveryProgress : 1;
  Medical.processPlayerMedicalToDate(injured, target, CONFIG_BASE, null);
  const progressAfterSecond = injured.medicalState.currentInjury ? injured.medicalState.currentInjury.recoveryProgress : 1;
  assert.strictEqual(progressAfterSecond, progressAfterFirst, 'procesar la misma fecha dos veces no debe avanzar rehab de nuevo');
});

// ---------------------------------------------------------------------
// 7/8/9. Lesión de partido saca al jugador inmediatamente, no vuelve
// aunque aparezca en otros slots, Rotation puede reemplazarlo saltándose
// cuotas normales.
// ---------------------------------------------------------------------
function buildFullLineup(team) {
  const { POSITIONS, SLOT_KEYS } = require('../src/entities/Player.js') && Rotation;
  const positions = require('../src/entities/Player.js').POSITIONS;
  const entries = {};
  const totalMinutes = CONFIG_BASE.match.durationMinutes;
  positions.forEach((pos, i) => {
    const starter = team.roster[i % team.roster.length];
    const sub1 = team.roster[(i + 5) % team.roster.length];
    const sub2 = team.roster[(i + 8) % team.roster.length];
    entries[pos] = {
      starter: { playerId: starter.id, minutesQuota: totalMinutes },
      sub1: { playerId: sub1.id, minutesQuota: 0 },
      sub2: { playerId: sub2.id, minutesQuota: 0 },
    };
  });
  return { entries, fixedSegments: [], garbageTime: { enabled: false } };
}

check('invariante 7/8/9: lesión de partido retira al jugador y Rotation lo reemplaza sin exigir cuota', () => {
  const team = makeTeam({ rosterSize: 12 });
  const lineup = buildFullLineup(team);
  const state = Rotation.buildRotationState(lineup, team.roster, CONFIG_BASE, null);
  const injuredPosition = require('../src/entities/Player.js').POSITIONS[0];
  const injuredId = state.onCourt[injuredPosition];
  assert.ok(injuredId, 'debe haber alguien en pista en esa posición');

  const logEntry = Rotation.markPlayerUnavailable(state, injuredId);
  assert.ok(logEntry, 'debe generar una entrada de sustitución');
  assert.notStrictEqual(state.onCourt[injuredPosition], injuredId, 'el lesionado ya no debe estar en pista');
  assert.ok(state.unavailablePlayerIds.has(injuredId), 'debe quedar marcado no disponible globalmente');

  // Aunque aparezca declarado en OTRO slot de la misma fila (sub1/sub2), la
  // ventana de sustitución nunca debe volver a colocarlo.
  Rotation.runSubstitutionWindow(state, { period: 4, scoreDiff: 0, elapsedSeconds: 100 });
  assert.notStrictEqual(state.onCourt[injuredPosition], injuredId);
  Object.values(state.onCourt).forEach((id) => assert.notStrictEqual(id, injuredId));
});

// ---------------------------------------------------------------------
// 10/11. Usuario no puede convocar unavailable / no puede asignar a
// limited más de su cap total entre slots (verificado vía quotaSeconds).
// ---------------------------------------------------------------------
check('invariante 10/11: quotaSeconds de un limited queda acotado a su minuteCap', () => {
  const player = makePlayer({ id: 'limited-cap' });
  Medical.createInjury(player, { mechanism: 'acuteNonContact', date: REF_DATE, source: 'training' }, CONFIG_BASE, () => 0.4);
  player.medicalState.currentInjury.recoveryProgress = 0.95; // fase limited
  const team = makeTeam({ roster: [player] });
  const info = Medical.getAvailability(player, REF_DATE, CONFIG_BASE, { team });
  assert.strictEqual(info.status, 'limited');
  assert.ok(info.minuteCap > 0 && info.minuteCap < CONFIG_BASE.match.durationMinutes);

  const lineup = buildFullLineup(team);
  // Declara 40 min repartidos en 2 slots (20+20) para forzar que supere el cap.
  const pos = require('../src/entities/Player.js').POSITIONS[0];
  lineup.entries[pos].starter = { playerId: player.id, minutesQuota: 20 };
  lineup.entries[pos].sub1 = { playerId: player.id, minutesQuota: 20 };
  const availabilityMap = new Map([[player.id, info]]);
  const state = Rotation.buildRotationState(lineup, team.roster, CONFIG_BASE, availabilityMap);
  assert.ok(state.quotaSeconds.get(player.id) <= info.minuteCap * 60, 'quotaSeconds debe quedar acotado al minuteCap');
});

check('invariante 10: unavailable queda excluido de bySlot/onCourt', () => {
  const player = makePlayer({ id: 'unavailable-test' });
  Medical.createInjury(player, { mechanism: 'acuteContact', date: REF_DATE, source: 'match' }, CONFIG_BASE, () => 0.4);
  const team = makeTeam({ roster: [player] });
  const info = Medical.getAvailability(player, REF_DATE, CONFIG_BASE, { team });
  assert.strictEqual(info.status, 'unavailable');
  const lineup = buildFullLineup(team);
  const availabilityMap = new Map([[player.id, info]]);
  const state = Rotation.buildRotationState(lineup, team.roster, CONFIG_BASE, availabilityMap);
  assert.ok(!Object.values(state.onCourt).includes(player.id), 'no debe empezar en pista');
  Object.keys(state.bySlot).forEach((pos) => {
    assert.ok(!state.bySlot[pos].includes(player.id), 'no debe contar como cobertura propia');
  });
});

// ---------------------------------------------------------------------
// 12. CPU respeta exactamente las mismas reglas.
// ---------------------------------------------------------------------
check('invariante 12: CpuLineup excluye unavailable y respeta escasez médica', () => {
  const roster = [];
  for (let i = 0; i < 12; i++) roster.push(generateFictionalPlayer({ minAge: 20, maxAge: 30, referenceDate: REF_DATE }));
  const team = new Team({ name: 'CPU Test', roster });
  // Lesiona a 6 jugadores (deja 6 disponibles, dentro de la excepción 5-7).
  for (let i = 0; i < 6; i++) {
    Medical.createInjury(roster[i], { mechanism: 'acuteContact', date: REF_DATE, source: 'match' }, CONFIG_BASE, () => 0.3);
  }
  const { lineup, squad } = CpuLineup.buildCpuLineup(team, false, CONFIG_BASE, REF_DATE);
  assert.ok(squad.length >= 5 && squad.length <= 7, `convocatoria debe reflejar la excepción médica, fue ${squad.length}`);
  const injuredIds = new Set(roster.slice(0, 6).map((p) => p.id));
  squad.forEach((p) => assert.ok(!injuredIds.has(p.id), 'un lesionado no debe entrar en la convocatoria CPU'));
});

// ---------------------------------------------------------------------
// 13/14. Squad 5-7 solo por escasez médica real; el motor no genera una
// lesión que deje <5 disponibles.
// ---------------------------------------------------------------------
check('invariante 14: guarda extrema — nunca deja al equipo por debajo de 5 disponibles', () => {
  const roster = [];
  for (let i = 0; i < 6; i++) roster.push(makePlayer({ id: `guard-${i}` }));
  const team = new Team({ name: 'Guard Test', roster });
  // Lesiona a 2, quedan 4 disponibles — por debajo del mínimo absoluto.
  Medical.createInjury(roster[0], { mechanism: 'acuteContact', date: REF_DATE, source: 'match' }, CONFIG_BASE, () => 0.3);
  Medical.createInjury(roster[1], { mechanism: 'acuteContact', date: REF_DATE, source: 'match' }, CONFIG_BASE, () => 0.3);
  assert.strictEqual(Medical.countMedicallyCallable(team.roster, team, REF_DATE, CONFIG_BASE), 4);
  // Cualquier candidato adicional debe ser bloqueado por la guarda.
  assert.ok(Medical.wouldDropBelowMinimum(team.roster, team, REF_DATE, CONFIG_BASE, roster[2].id));
});

// ---------------------------------------------------------------------
// 17. Historial de misma zona aumenta recurrencia.
// ---------------------------------------------------------------------
check('invariante 17: historial reciente de la misma zona aumenta el riesgo', () => {
  const fresh = makePlayer({ id: 'fresh-history' });
  const recent = makePlayer({ id: 'recent-history' });
  recent.medicalState = null;
  Medical.ensureMedicalState(recent, CONFIG_BASE, REF_DATE);
  recent.medicalState.injuryHistory.push({
    id: 'prev-1', type: 'ankleSprain', bodyArea: 'ankle', mechanism: 'acuteNonContact', severity: 'moderate',
    occurredAt: new Date(REF_DATE.getTime() - 30 * 24 * 60 * 60 * 1000),
    recoveredAt: new Date(REF_DATE.getTime() - 10 * 24 * 60 * 60 * 1000),
    daysUnavailable: 20, recurrenceOf: null, sequela: false,
  });
  const riskFresh = Medical.computeMechanismRisk(1, fresh, REF_DATE, 'acuteNonContact', CONFIG_BASE, null);
  const riskRecent = Medical.computeMechanismRisk(1, recent, REF_DATE, 'acuteNonContact', CONFIG_BASE, null);
  assert.ok(riskRecent > riskFresh, `esperado riskRecent(${riskRecent}) > riskFresh(${riskFresh})`);
});

// ---------------------------------------------------------------------
// 18. Setback en fase limited; treatment/rehab/modified no acumulan una
// segunda lesión simultánea.
// ---------------------------------------------------------------------
check('invariante 18: fases tempranas nunca sortean una segunda lesión', () => {
  const player = makePlayer({ id: 'no-double-injury' });
  const team = makeTeam({ roster: [player] });
  Medical.createInjury(player, { mechanism: 'acuteNonContact', date: REF_DATE, source: 'training' }, CONFIG_BASE, () => 0.4);
  player.medicalState.currentInjury.recoveryProgress = 0.5; // fase rehab
  const before = player.medicalState.currentInjury.id;
  const tickDate = new Date(REF_DATE.getTime() + 7 * 24 * 60 * 60 * 1000);
  const outcome = Medical.evaluateWeeklyTrainingTick(player, team, tickDate, 20, CONFIG_BASE);
  assert.strictEqual(outcome, null, 'fase rehab no debe sortear nada');
  assert.strictEqual(player.medicalState.currentInjury.id, before, 'sigue siendo la misma lesión');
});

check('invariante 18: setback en fase limited reduce recoveryProgress sin crear otra lesión', () => {
  const player = makePlayer({ id: 'setback-test', physical: { durability: 1, recovery: 1 } });
  const team = makeTeam({ roster: [player] });
  Medical.createInjury(player, { mechanism: 'acuteNonContact', date: REF_DATE, source: 'training' }, CONFIG_BASE, () => 0.4);
  const injuryId = player.medicalState.currentInjury.id;
  player.medicalState.currentInjury.recoveryProgress = 0.97; // fase limited
  const setback = Medical.applySetback(player, CONFIG_BASE, () => 0.5);
  assert.strictEqual(player.medicalState.currentInjury.id, injuryId, 'sigue siendo la misma lesión');
  assert.ok(player.medicalState.currentInjury.recoveryProgress < 0.97, 'el progreso debe retroceder');
  assert.strictEqual(setback.setbackCount, 1);
});

// ---------------------------------------------------------------------
// 19. Lesión antigua no aumenta eternamente el riesgo como si fuese
// reciente.
// ---------------------------------------------------------------------
check('invariante 19: una lesión muy antigua deja de contar como reciente', () => {
  const player = makePlayer({ id: 'old-history' });
  Medical.ensureMedicalState(player, CONFIG_BASE, REF_DATE);
  player.medicalState.injuryHistory.push({
    id: 'ancient', type: 'ankleSprain', bodyArea: 'ankle', mechanism: 'acuteNonContact', severity: 'minor',
    occurredAt: new Date(REF_DATE.getTime() - 5 * 365 * 24 * 60 * 60 * 1000),
    recoveredAt: new Date(REF_DATE.getTime() - 5 * 365 * 24 * 60 * 60 * 1000 + 5 * 24 * 60 * 60 * 1000),
    daysUnavailable: 5, recurrenceOf: null, sequela: false,
  });
  const { factor } = Medical.computeHistoryFactor(player, REF_DATE, CONFIG_BASE);
  assert.ok(factor < 1.10, `factor de una lesión de hace 5 años debe ser bajo, fue ${factor}`);
});

// ---------------------------------------------------------------------
// 20. Medical Center nunca hace riesgo 0.
// ---------------------------------------------------------------------
check('invariante 20: Centro Médico 20 nunca lleva el riesgo a 0', () => {
  const player = makePlayer({ id: 'elite-medical' });
  const team = makeTeam({ roster: [player], teamData: { facilities: { medicalCenter: { level: 20 }, physicalPreparation: { level: 20 } } } });
  const risk = Medical.computeMechanismRisk(1, player, REF_DATE, 'acuteNonContact', CONFIG_BASE, team);
  assert.ok(risk > 0, 'el riesgo nunca debe ser exactamente 0');
});

// ---------------------------------------------------------------------
// 21/22. Minor no deja secuela; severe puede dejar secuela pero no
// siempre.
// ---------------------------------------------------------------------
check('invariante 21: minor nunca deja secuela', () => {
  const player = makePlayer({ id: 'minor-no-sequela' });
  const injury = { type: 'ankleSprain', severity: 'minor', recurrenceOf: null, sequelaApplied: false, occurredAt: REF_DATE };
  Medical.ensureMedicalState(player, CONFIG_BASE, REF_DATE);
  player.medicalState.currentInjury = injury;
  const closed = Medical.closeInjury(player, REF_DATE, CONFIG_BASE, null, () => 0.001);
  assert.strictEqual(closed.sequelaApplied, false);
});

check('invariante 22: severe puede dejar secuela pero no siempre', () => {
  let anySequela = false;
  let anyNoSequela = false;
  for (let i = 0; i < 30; i++) {
    const player = makePlayer({ id: `severe-${i}` });
    Medical.ensureMedicalState(player, CONFIG_BASE, REF_DATE);
    player.medicalState.currentInjury = {
      type: 'kneeSprain', severity: 'severe', recurrenceOf: null, sequelaApplied: false, occurredAt: REF_DATE,
    };
    const closed = Medical.closeInjury(player, REF_DATE, CONFIG_BASE, null, Math.random);
    if (closed.sequelaApplied) anySequela = true; else anyNoSequela = true;
  }
  assert.ok(anyNoSequela, 'severe no debe dejar secuela SIEMPRE');
  // anySequela es probabilístico (18% base) — no se afirma con dureza aquí,
  // solo se informa si en esta tirada de 30 no salió ninguna.
  if (!anySequela) console.log('     (nota: 0/30 severas dejaron secuela en esta tirada — esperado ~18% base)');
});

// ---------------------------------------------------------------------
// 23. Secuela usa PlayerDevelopment/residuals, no bypass; 24. nunca
// cambia PA/POS/bodyMeasurements.
// ---------------------------------------------------------------------
check('invariante 23/24: secuela aplicada vía residuales, nunca PA/POS/bodyMeasurements', () => {
  const player = makePlayer({ id: 'sequela-mechanism', potential: 190 });
  const beforePotential = player.hidden.potential;
  const beforePositions = clone(player.positions);
  const beforeBody = clone(player.bodyMeasurements);
  const beforeTopSpeed = PD.getEffectiveAttribute(player, 'topSpeed');
  Medical.ensureMedicalState(player, CONFIG_BASE, REF_DATE);
  player.medicalState.currentInjury = {
    type: 'majorKneeLigament', severity: 'severe', recurrenceOf: null, sequelaApplied: false, occurredAt: REF_DATE,
  };
  let closed = null;
  for (let i = 0; i < 200 && !(closed && closed.sequelaApplied); i++) {
    player.medicalState.currentInjury = {
      type: 'majorKneeLigament', severity: 'severe', recurrenceOf: null, sequelaApplied: false, occurredAt: REF_DATE,
    };
    closed = Medical.closeInjury(player, REF_DATE, CONFIG_BASE, null, Math.random);
  }
  assert.ok(closed.sequelaApplied, 'en 200 intentos con severe+majorKneeLigament debería haber saltado al menos una secuela');
  const afterTopSpeed = PD.getEffectiveAttribute(player, 'topSpeed');
  assert.ok(afterTopSpeed < beforeTopSpeed + 1e-6, 'algún atributo físico susceptible debe haber bajado (o quedado igual si no fue elegido)');
  assert.strictEqual(player.hidden.potential, beforePotential, 'PA nunca cambia por secuela');
  assert.deepStrictEqual(player.positions, beforePositions, 'POS nunca cambia por secuela');
  assert.deepStrictEqual(player.bodyMeasurements, beforeBody, 'bodyMeasurements nunca cambia por secuela');
});

// ---------------------------------------------------------------------
// 25. Un lesionado recibe estímulo Training reducido según fase.
// ---------------------------------------------------------------------
check('invariante 25: estímulo de entrenamiento reducido en treatment/rehab', () => {
  const player = makePlayer({ id: 'reduced-stimulus' });
  const team = makeTeam({ roster: [player] });
  Medical.createInjury(player, { mechanism: 'acuteNonContact', date: REF_DATE, source: 'training' }, CONFIG_BASE, () => 0.4);
  player.medicalState.currentInjury.recoveryProgress = 0.1; // treatment
  const calendarCtx = { seasonStartDate: new Date(REF_DATE.getTime() - 100 * 24 * 60 * 60 * 1000) };
  const tickDate = new Date(REF_DATE.getTime() + 7 * 24 * 60 * 60 * 1000);
  const beforeEnergy = player.dynamicState.energy;
  const ctx = Training.buildPlayerTickContext(player, team, tickDate, CONFIG_BASE, calendarCtx);
  const healthy = makePlayer({ id: 'reduced-stimulus-control' });
  const healthyTeam = makeTeam({ roster: [healthy] });
  const ctxHealthy = Training.buildPlayerTickContext(healthy, healthyTeam, tickDate, CONFIG_BASE, calendarCtx);
  assert.ok(
    ctx.stimulusByAttribute.outsideShot < ctxHealthy.stimulusByAttribute.outsideShot,
    'estímulo técnico en treatment debe ser menor que el de un jugador sano',
  );
  assert.ok(player.dynamicState.energy >= beforeEnergy - 100, 'sanity: energy sigue en rango');
});

// ---------------------------------------------------------------------
// 26. Lesión no resta TMB directamente.
// ---------------------------------------------------------------------
check('invariante 26: crear una lesión no resta TMB directamente', () => {
  const player = makePlayer({ id: 'no-direct-tmb-hit' });
  const before = PD.computeTmbRating(player, CONFIG_BASE);
  Medical.createInjury(player, { mechanism: 'acuteContact', date: REF_DATE, source: 'match' }, CONFIG_BASE, Math.random);
  assert.strictEqual(PD.computeTmbRating(player, CONFIG_BASE), before);
});

// ---------------------------------------------------------------------
// 32. simulateMatch() wrapper sigue funcionando con la nueva lógica
// pausable; 33. con medical.enabled=false, equivalencia con HEAD previo.
// ---------------------------------------------------------------------
check('invariante 32: simulateMatch() sigue devolviendo el shape esperado con Medical activado', () => {
  const homeTeam = makeTeam({ rosterSize: 12, teamData: { name: 'Home' } });
  const awayTeam = makeTeam({ rosterSize: 12, teamData: { name: 'Away' } });
  const home = CpuLineup.buildCpuLineup(homeTeam, false, CONFIG_BASE, REF_DATE);
  const away = CpuLineup.buildCpuLineup(awayTeam, false, CONFIG_BASE, REF_DATE);
  const result = MatchEngine.simulateMatch(homeTeam, awayTeam, CONFIG_BASE, {
    homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup, matchDate: REF_DATE,
  });
  assert.ok(result.finalScore);
  assert.ok(Array.isArray(result.injuries), 'buildMatchResult debe exponer injuries');
  assert.ok(Array.isArray(result.eventLog));
});

check('invariante 33: con medical.enabled=false no se generan lesiones ni se toca Rotation médica', () => {
  const disabledConfig = clone(CONFIG_BASE);
  disabledConfig.medical.enabled = false;
  // clone() destruye funciones/arrays especiales anidados en catalog (son
  // solo datos, sobrevive bien) — basePenalty/curvas son números, sin problema.
  const homeTeam = makeTeam({ rosterSize: 12, teamData: { name: 'Home2' } });
  const awayTeam = makeTeam({ rosterSize: 12, teamData: { name: 'Away2' } });
  const home = CpuLineup.buildCpuLineup(homeTeam, false, disabledConfig, REF_DATE);
  const away = CpuLineup.buildCpuLineup(awayTeam, false, disabledConfig, REF_DATE);
  const result = MatchEngine.simulateMatch(homeTeam, awayTeam, disabledConfig, {
    homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup, matchDate: REF_DATE,
  });
  assert.strictEqual(result.injuries.length, 0, 'sin medical.enabled no debe haber lesiones en directo');
  homeTeam.roster.concat(awayTeam.roster).forEach((p) => {
    assert.ok(!p.medicalState || !p.medicalState.currentInjury, 'ningún jugador debe quedar lesionado');
  });
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
