#!/usr/bin/env node
// scripts/test-life1.js
// Verificación LIFE-1 (DESIGN.md 9) — script Node ad-hoc, mismo criterio que
// el resto del proyecto (no hay framework de tests instalado, ver
// CLAUDE.md): construye escenarios sintéticos y comprueba los invariantes
// duros de la sección 31 del prompt de la sesión. Ejecutar con:
//   node scripts/test-life1.js

const assert = require('assert');
const { Player, calculateAge } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
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

function daysAgo(days, from = new Date('2026-09-01T00:00:00Z')) {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

const NOW = new Date('2026-09-01T00:00:00Z'); // "hoy" en el universo de estos tests, distinto de birthDateForAge (fecha de NACIMIENTO)

function birthDateForAge(age, ref = new Date('2026-09-01T00:00:00Z')) {
  const d = new Date(ref);
  d.setFullYear(d.getFullYear() - age);
  return d;
}

function makePlayer(overrides = {}) {
  const base = {
    firstName: 'Test', lastName: 'Player',
    birthDate: birthDateForAge(overrides.age !== undefined ? overrides.age : 22),
    positions: { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: 'Base',
    technical: {}, physical: {}, mental: {},
    hidden: {
      potential: overrides.potential !== undefined ? overrides.potential : 120,
      professionalism: overrides.professionalism !== undefined ? overrides.professionalism : 10,
      ambition: overrides.ambition !== undefined ? overrides.ambition : 10,
      learningRate: overrides.learningRate !== undefined ? overrides.learningRate : null,
      learningPersistence: overrides.learningPersistence !== undefined ? overrides.learningPersistence : null,
    },
  };
  const player = new Player(base);
  return player;
}

// --- 1-3: escala básica ---
check('Potential migra 1-20 -> x10 (idempotente)', () => {
  const p1 = new Player({ ...makeMinimalData(), hidden: { potential: 15, professionalism: 10, ambition: 10 } });
  assert.strictEqual(p1.hidden.potential, 150);
  const asJson = p1.toJSON();
  const p2 = new Player({ ...asJson, birthDate: asJson.birthDate });
  assert.strictEqual(p2.hidden.potential, 150, 'recargar no debe multiplicar de nuevo');
});

function makeMinimalData() {
  return {
    firstName: 'A', lastName: 'B',
    birthDate: birthDateForAge(22),
    positions: { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: 'Base',
  };
}

check('Potential >20 se conserva tal cual', () => {
  const p = new Player({ ...makeMinimalData(), hidden: { potential: 150, professionalism: 10, ambition: 10 } });
  assert.strictEqual(p.hidden.potential, 150);
});

check('TMB siempre en [1,200]', () => {
  const p = makePlayer({ potential: 200 });
  const tmb = PD.computeTmbRating(p, CONFIG_BASE);
  assert.ok(tmb >= 1 && tmb <= 200, `tmb=${tmb}`);
});

check('ensureDevelopmentState: PA nunca queda por debajo del TMB actual (invariante 13)', () => {
  const p = makePlayer({ potential: 1 }); // deliberadamente absurdo, por debajo de cualquier tmb real
  Object.keys(p.technical).forEach((k) => { p.technical[k] = 15; });
  Object.keys(p.physical).forEach((k) => { p.physical[k] = 15; });
  Object.keys(p.mental).forEach((k) => { p.mental[k] = 15; });
  PD.ensureDevelopmentState(p, CONFIG_BASE, new Date());
  const tmb = PD.computeTmbRating(p, CONFIG_BASE);
  assert.ok(p.hidden.potential >= Math.ceil(PD.computeUncappedTmb(p, CONFIG_BASE)), `potential=${p.hidden.potential} tmb=${tmb}`);
});

// --- 9/10: headroom nunca se supera con crecimiento; declive sí puede bajar en PA ---
check('Crecimiento nunca deja uncappedTmb > PA (invariante 9)', () => {
  const p = makePlayer({ age: 17, potential: 60 });
  Object.keys(p.technical).forEach((k) => { p.technical[k] = 15; });
  PD.ensureDevelopmentState(p, CONFIG_BASE, NOW);
  for (let i = 0; i < 60; i++) { // ~60 semanas
    const target = new Date(p.developmentState.lastProcessedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    PD.recordMatchExposure(p, { date: target, minutes: 15, competition: 'league', division: '1ª' });
    PD.processPlayerToDate(p, target, CONFIG_BASE, { facilityLevel: 10 });
    const uncapped = PD.computeUncappedTmb(p, CONFIG_BASE);
    assert.ok(uncapped <= p.hidden.potential + 1e-6, `tick ${i}: uncapped=${uncapped} > PA=${p.hidden.potential}`);
  }
});

check('Declive puede bajar TMB estando en PA (invariante 10)', () => {
  const p = makePlayer({ age: 38, potential: 200 });
  Object.keys(p.technical).forEach((k) => { p.technical[k] = 18; });
  Object.keys(p.physical).forEach((k) => { p.physical[k] = 18; });
  Object.keys(p.mental).forEach((k) => { p.mental[k] = 18; });
  PD.ensureDevelopmentState(p, CONFIG_BASE, NOW);
  const before = PD.computeUncappedTmb(p, CONFIG_BASE);
  const target = new Date(p.developmentState.lastProcessedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  PD.processPlayerToDate(p, target, CONFIG_BASE, { facilityLevel: 10 });
  const after = PD.computeUncappedTmb(p, CONFIG_BASE);
  assert.ok(after < before, `before=${before} after=${after}`);
});

// --- 21: sin cliff de cumpleaños ---
check('Sin salto de cumpleaños: crecimiento continuo alrededor de una edad entera', () => {
  const refA = birthDateForAge(20.0);
  const p = makePlayer({ age: 20 });
  const ageJustBefore = PD.ageAt(p, daysAgo(-1, refA));
  const ageJustAfter = PD.ageAt(p, daysAgo(1, refA));
  assert.ok(Math.abs(ageJustAfter - ageJustBefore) < 0.02, 'la edad decimal debe moverse de forma continua');
});

// --- 22/23/24: campos no tocados ---
check('positions/bodyMeasurements/no-mutables no cambian tras varios ticks', () => {
  const p = makePlayer({ age: 19, potential: 190 });
  const positionsBefore = JSON.stringify(p.positions);
  const bodyBefore = JSON.stringify(p.bodyMeasurements);
  const durBefore = p.physical.durability;
  const workBefore = p.mental.workRate;
  const foulBefore = p.technical.foulTendency;
  PD.ensureDevelopmentState(p, CONFIG_BASE, NOW);
  for (let i = 0; i < 20; i++) {
    const target = new Date(p.developmentState.lastProcessedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    PD.processPlayerToDate(p, target, CONFIG_BASE, { facilityLevel: 15 });
  }
  assert.strictEqual(JSON.stringify(p.positions), positionsBefore);
  assert.strictEqual(JSON.stringify(p.bodyMeasurements), bodyBefore);
  assert.strictEqual(p.physical.durability, durBefore);
  assert.strictEqual(p.mental.workRate, workBefore);
  assert.strictEqual(p.technical.foulTendency, foulBefore);
});

// --- 14/15/16: determinismo ---
check('Misma seed + mismas decisiones = mismos cambios (determinismo)', () => {
  const dataA = makeMinimalData();
  const pA = new Player({ ...dataA, hidden: { potential: 180, professionalism: 14, ambition: 14 } });
  PD.ensureDevelopmentState(pA, CONFIG_BASE, NOW);
  const seed = pA.developmentState.developmentSeed;

  const pB = new Player({ ...dataA, hidden: { potential: 180, professionalism: 14, ambition: 14 } });
  pB.developmentState = null;
  PD.ensureDevelopmentState(pB, CONFIG_BASE, NOW);
  pB.developmentState.developmentSeed = seed; // fuerza misma seed (normalmente vendría del mismo id)
  pB.hidden.learningRate = pA.hidden.learningRate;
  pB.hidden.learningPersistence = pA.hidden.learningPersistence;
  pB.developmentState.agingOffsetYears = pA.developmentState.agingOffsetYears;
  ['technical', 'physical', 'mental'].forEach((g) => Object.keys(pA[g]).forEach((k) => { pB[g][k] = pA[g][k]; }));
  pB.developmentState.attributeProgress = { ...pA.developmentState.attributeProgress };
  pB.developmentState.lastProcessedDate = new Date(pA.developmentState.lastProcessedDate);

  for (let i = 0; i < 10; i++) {
    const target = new Date(pA.developmentState.lastProcessedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    PD.recordMatchExposure(pA, { date: target, minutes: 20, competition: 'league', division: '1ª' });
    PD.recordMatchExposure(pB, { date: target, minutes: 20, competition: 'league', division: '1ª' });
    PD.processPlayerToDate(pA, target, CONFIG_BASE, { facilityLevel: 12 });
    PD.processPlayerToDate(pB, target, CONFIG_BASE, { facilityLevel: 12 });
  }
  assert.deepStrictEqual(pA.technical, pB.technical);
  assert.deepStrictEqual(pA.physical, pB.physical);
  assert.deepStrictEqual(pA.developmentState.attributeProgress, pB.developmentState.attributeProgress);
});

check('Idempotencia: procesar dos veces la misma fecha no duplica cambios (invariante 37)', () => {
  const p = makePlayer({ age: 20, potential: 180 });
  PD.ensureDevelopmentState(p, CONFIG_BASE, NOW);
  const target = new Date(p.developmentState.lastProcessedDate.getTime() + 21 * 24 * 60 * 60 * 1000);
  PD.processPlayerToDate(p, target, CONFIG_BASE, { facilityLevel: 10 });
  const snapshot = JSON.stringify(p.toJSON());
  const result = PD.processPlayerToDate(p, target, CONFIG_BASE, { facilityLevel: 10 });
  assert.strictEqual(result.ticks, 0, 'no debería procesar ningún tick nuevo');
  assert.strictEqual(JSON.stringify(p.toJSON()), snapshot);
});

check('Remanente temporal: 23 días procesan 3 ticks completos, se conserva el resto', () => {
  const p = makePlayer({ age: 20, potential: 180 });
  PD.ensureDevelopmentState(p, CONFIG_BASE, new Date('2026-01-01T00:00:00Z'));
  const target = new Date('2026-01-24T00:00:00Z'); // 23 días después
  const result = PD.processPlayerToDate(p, target, CONFIG_BASE, {});
  assert.strictEqual(result.ticks, 3);
  const expectedLast = new Date('2026-01-01T00:00:00Z').getTime() + 3 * 7 * 24 * 60 * 60 * 1000;
  assert.strictEqual(p.developmentState.lastProcessedDate.getTime(), expectedLast);
});

// --- 17/18/19/20: agingOffsetYears independiente ---
check('agingOffsetYears es independiente de PA/learningRate/learningPersistence', () => {
  const seedsSeen = new Set();
  const offsets = [];
  for (let i = 0; i < 30; i++) {
    const p = makePlayer({ potential: 100 + i, learningRate: 1 + (i % 20), learningPersistence: 20 - (i % 20) });
    p.id = `player-${i}`;
    PD.ensureDevelopmentState(p, CONFIG_BASE, new Date());
    offsets.push(p.developmentState.agingOffsetYears);
    seedsSeen.add(p.developmentState.developmentSeed);
  }
  const allSame = offsets.every((o) => Math.abs(o - offsets[0]) < 1e-9);
  assert.ok(!allSame, 'con distinta seed (id), agingOffsetYears debería variar');
  offsets.forEach((o) => assert.ok(o >= -3 - 1e-9 && o <= 6 + 1e-9, `offset fuera de rango: ${o}`));
});

// --- 27/28/29: mindset ---
function seasonsOfGrowth(overrides, seasons = 3) {
  const p = makePlayer({ age: 20, potential: 190, ...overrides });
  Object.keys(p.technical).forEach((k) => { p.technical[k] = 10; });
  p.id = `mindset-${JSON.stringify(overrides)}`;
  PD.ensureDevelopmentState(p, CONFIG_BASE, NOW);
  for (let week = 0; week < seasons * 34; week++) {
    const target = new Date(p.developmentState.lastProcessedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    PD.recordMatchExposure(p, { date: target, minutes: 25, competition: 'league', division: '1ª' });
    PD.processPlayerToDate(p, target, CONFIG_BASE, { facilityLevel: 10 });
  }
  return PD.computeUncappedTmb(p, CONFIG_BASE);
}

check('Ambition 18 > Ambition 5 a igualdad del resto (invariante 27)', () => {
  const hi = seasonsOfGrowth({ ambition: 18, professionalism: 10, learningRate: 10 });
  const lo = seasonsOfGrowth({ ambition: 5, professionalism: 10, learningRate: 10 });
  assert.ok(hi > lo, `hi=${hi} lo=${lo}`);
});

check('Professionalism 18 > Professionalism 5 a igualdad del resto (invariante 28)', () => {
  const hi = seasonsOfGrowth({ professionalism: 18, ambition: 10, learningRate: 10 });
  const lo = seasonsOfGrowth({ professionalism: 5, ambition: 10, learningRate: 10 });
  assert.ok(hi > lo, `hi=${hi} lo=${lo}`);
});

check('Ambos altos > uno alto/uno bajo > ambos bajos (invariante 29)', () => {
  const both = seasonsOfGrowth({ ambition: 18, professionalism: 18, learningRate: 10 });
  const mixed = seasonsOfGrowth({ ambition: 18, professionalism: 5, learningRate: 10 });
  const neither = seasonsOfGrowth({ ambition: 5, professionalism: 5, learningRate: 10 });
  assert.ok(both > mixed && mixed > neither, `both=${both} mixed=${mixed} neither=${neither}`);
});

check('learningRate alto acelera crecimiento (invariante 25)', () => {
  const hi = seasonsOfGrowth({ learningRate: 19, ambition: 10, professionalism: 10 });
  const lo = seasonsOfGrowth({ learningRate: 2, ambition: 10, professionalism: 10 });
  assert.ok(hi > lo, `hi=${hi} lo=${lo}`);
});

// --- 30/31/32: test dirigido de minutos ---
// Los invariantes describen el ESTÍMULO de jugar X minutos/semana de forma
// SOSTENIDA (sección 19: "la función de estímulo por minutos debe..."), no
// una acumulación transitoria desde cero — así que se construye
// directamente un `matchExposures` ya en RÉGIMEN ESTABLE (una entrada por
// semana durante más de `exposure.windowDays/7` semanas, para que la
// ventana deslizante esté completamente "llena") y se lee
// `PD.computeExposureFactor` en ese instante — aísla la fórmula de la
// sección 19 del ruido/headroom del resto del tick, que es justo lo que
// estos tres invariantes verifican.
function steadyStateExposureFactor(minutesPerWeek, division) {
  const p = makePlayer({ age: 16, potential: 190 });
  PD.ensureDevelopmentState(p, CONFIG_BASE, NOW);
  const { windowDays } = CONFIG_BASE.playerDevelopment.exposure;
  const weeksToFill = Math.ceil(windowDays / 7) + 2;
  const tickDate = new Date(NOW.getTime() + weeksToFill * 7 * 24 * 60 * 60 * 1000);
  if (minutesPerWeek > 0) {
    for (let i = 1; i <= weeksToFill; i++) {
      const matchDate = new Date(NOW.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      PD.recordMatchExposure(p, { date: matchDate, minutes: minutesPerWeek, competition: 'league', division });
    }
  }
  return PD.computeExposureFactor(p, tickDate, CONFIG_BASE);
}

check('16 años + 12min/semana en 1ª > 16 años + 0min (invariante 30)', () => {
  const with12 = steadyStateExposureFactor(12, '1ª');
  const with0 = steadyStateExposureFactor(0, '1ª');
  assert.ok(with12 > with0, `with12=${with12} with0=${with0}`);
  // "salto de valor claro" (sección 19), no un roce marginal.
  assert.ok(with12 - with0 > 0.1, `salto insuficiente: ${with12 - with0}`);
});

check('16 años + 12min/semana en 1ª > mismo caso en 2ª, de forma moderada (invariante 31)', () => {
  const primera = steadyStateExposureFactor(12, '1ª');
  const segunda = steadyStateExposureFactor(12, '2ª');
  assert.ok(primera > segunda, `primera=${primera} segunda=${segunda}`);
  const ratio = primera / segunda;
  assert.ok(ratio < 1.5, `la ventaja de 1ª sobre 2ª no debería ser extrema: ratio=${ratio}`);
});

check('40 min/semana no produce el doble de estímulo que 12-15 min/semana (invariante 32)', () => {
  const with15 = steadyStateExposureFactor(15, '1ª');
  const with40 = steadyStateExposureFactor(40, '1ª');
  assert.ok(with40 > with15, `with40=${with40} debería superar with15=${with15}`);
  assert.ok(with40 < with15 * 2, `with40=${with40} no debería duplicar with15=${with15}`);
});

// --- 36: intake nuevo no recibe progreso retroactivo ---
check('Academy intake nuevo no recibe progreso retroactivo (invariante 36)', () => {
  const team = new Team({ name: 'Test CF', division: '1ª' });
  const referenceDate = new Date('2027-06-01T00:00:00Z');
  const [rookie] = team.generateAcademyIntake(1, referenceDate);
  const result = PD.processPlayerToDate(rookie, referenceDate, CONFIG_BASE, {});
  assert.strictEqual(result.ticks, 0, 'un canterano creado justo en referenceDate no debe tener ticks pendientes');
});

// --- Generador ficticio: potential >= tmb inicial ---
check('generateFictionalPlayer: potential siempre >= TMB inicial (sección 25)', () => {
  for (let i = 0; i < 25; i++) {
    const p = generateFictionalPlayer({ minAge: 16, maxAge: 34 });
    const tmb = PD.computeUncappedTmb(p, CONFIG_BASE);
    assert.ok(p.hidden.potential >= tmb - 1e-6, `potential=${p.hidden.potential} tmb=${tmb}`);
    assert.ok(p.hidden.learningRate >= 1 && p.hidden.learningRate <= 20);
    assert.ok(p.hidden.learningPersistence >= 1 && p.hidden.learningPersistence <= 20);
    assert.ok(p.developmentState && p.developmentState.matchExposures.length === 0);
  }
});

// --- Cohorte breve para sanity-check de calibración (invariante 39) ---
function cohortCheck() {
  const results = [];
  for (let i = 0; i < 40; i++) {
    const age = 17 + (i % 10);
    const p = generateFictionalPlayer({ minAge: age, maxAge: age });
    p.id = `cohort-${i}`;
    PD.ensureDevelopmentState(p, CONFIG_BASE, birthDateForAge(age));
    for (let week = 0; week < 34 * 12; week++) { // 12 temporadas
      const target = new Date(p.developmentState.lastProcessedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const minutes = 10 + Math.round(Math.random() * 25);
      PD.recordMatchExposure(p, { date: target, minutes, competition: 'league', division: '1ª' });
      PD.processPlayerToDate(p, target, CONFIG_BASE, { facilityLevel: 10 });
    }
    results.push(PD.computeTmbRating(p, CONFIG_BASE));
  }
  const eliteCount = results.filter((tmb) => tmb >= 180).length;
  console.log(`     [cohorte] TMB tras 12 temporadas: min=${Math.min(...results)} max=${Math.max(...results)} `
    + `media=${(results.reduce((a, b) => a + b, 0) / results.length).toFixed(1)} elite(>=180)=${eliteCount}/${results.length}`);
  return eliteCount / results.length;
}

check('La liga no deriva sistemáticamente hacia 180-200 (invariante 39, sanity check)', () => {
  const eliteRatio = cohortCheck();
  assert.ok(eliteRatio < 0.5, `demasiados jugadores en zona élite tras 12 temporadas: ${eliteRatio}`);
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
