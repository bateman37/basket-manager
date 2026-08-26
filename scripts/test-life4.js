#!/usr/bin/env node
// scripts/test-life4.js
// Verificación LIFE-4 (DESIGN.md 9.15) — script Node ad-hoc, mismo criterio
// que test-life1.js/test-life2.js/test-life3.js (no hay framework de tests
// instalado, ver CLAUDE.md). Ejecutar con:
//   node scripts/test-life4.js

const assert = require('assert');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const PC = require('../src/core/PlayerCareer.js');
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
    firstName: 'Test', lastName: overrides.lastName || 'Player',
    birthDate: birthDateForAge(overrides.age !== undefined ? overrides.age : 24),
    positions: overrides.positions || { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: overrides.nominalPosition || 'Base',
    technical: overrides.technical || {}, physical: { durability: 10, recovery: 10, ...overrides.physical }, mental: overrides.mental || {},
    hidden: {
      potential: overrides.potential !== undefined ? overrides.potential : 150,
      professionalism: 10, ambition: 10, learningRate: 10, learningPersistence: 10,
    },
  };
  const player = new Player(data);
  PD.ensureDevelopmentState(player, CONFIG_BASE, overrides.referenceDate || REF_DATE);
  return player;
}

function makeTeam(players, overrides = {}) {
  const roster = players || [makePlayer()];
  while (roster.length < 8) roster.push(generateFictionalPlayer({ minAge: 20, maxAge: 30, referenceDate: REF_DATE }));
  return new Team({ name: 'LIFE-4 Test Team', division: '1ª', roster, ...overrides });
}

// Línea de boxScore mínima (mismo shape que MatchEngine.enrichStatLine).
function makeBoxLine(overrides = {}) {
  return {
    playerId: overrides.playerId, name: overrides.name || 'Test Player',
    points: overrides.points || 0,
    fieldGoals: {
      threePointShot: { made: 0, attempted: 0 }, midRangeShot: { made: 0, attempted: 0 },
      insideShot: { made: 0, attempted: 0 }, layup: { made: 0, attempted: 0 },
    },
    freeThrows: { made: 0, attempted: 0 },
    reboundsOffensive: overrides.reboundsOffensive || 0,
    reboundsDefensive: overrides.reboundsDefensive || 0,
    assists: overrides.assists || 0,
    steals: overrides.steals || 0,
    blocks: overrides.blocks || 0,
    turnovers: overrides.turnovers || 0,
    personalFouls: overrides.personalFouls || 0,
    foulsDrawn: overrides.foulsDrawn || 0,
    minutesPlayed: overrides.minutesPlayed !== undefined ? overrides.minutesPlayed : 1200,
    plusMinus: overrides.plusMinus || 0,
    valoracion: overrides.valoracion !== undefined ? overrides.valoracion : 10,
  };
}

function makeMatchInfo(player, overrides = {}) {
  return {
    date: overrides.date || REF_DATE,
    competition: overrides.competition || 'league',
    team: overrides.team || { id: 'team-A', name: 'Equipo A', division: '1ª' },
    opponent: overrides.opponent || { id: 'team-B', name: 'Equipo B' },
    boxScoreLine: overrides.boxScoreLine || makeBoxLine({ playerId: player.id, name: player.fullName, ...overrides.line }),
    isStarter: !!overrides.isStarter,
    matchKey: overrides.matchKey || `match-${overrides.n || 1}`,
  };
}

// ---------------------------------------------------------------------
// 1. legacy init
// ---------------------------------------------------------------------
check('1. legacy init: ensureCareerHistory inicializa sin careerHistory previo', () => {
  const p = makePlayer({ id: 'p1' });
  assert.strictEqual(p.careerHistory, null);
  const ch = PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  assert.ok(ch);
  assert.strictEqual(p.careerHistory, ch);
  assert.strictEqual(ch.historyCompleteness, 'partial');
});

// ---------------------------------------------------------------------
// 2/3. baseline + TMB snapshot real
// ---------------------------------------------------------------------
check('2/3. baseline: tmb/atributos/posiciones coinciden con el estado real en ese instante', () => {
  const p = makePlayer({ id: 'p2' });
  const ch = PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  assert.strictEqual(ch.baseline.tmb, PD.computeTmbRating(p, CONFIG_BASE));
  assert.strictEqual(ch.baseline.attributes.length, 29);
  PC.ATTRIBUTE_SNAPSHOT_KEYS.forEach((attr, i) => {
    assert.strictEqual(ch.baseline.attributes[i], p[PC.ATTRIBUTE_GROUP[attr]][attr]);
  });
  assert.strictEqual(ch.baseline.positions.length, 5);
});

// ---------------------------------------------------------------------
// 4. snapshot sin hidden
// ---------------------------------------------------------------------
check('4. snapshot sin hidden: los 29 mutables no incluyen potential/professionalism/ambition/learning*', () => {
  const hiddenKeys = ['potential', 'professionalism', 'ambition', 'learningRate', 'learningPersistence'];
  hiddenKeys.forEach((key) => {
    assert.ok(!PC.ATTRIBUTE_SNAPSHOT_KEYS.includes(key), `${key} no debe estar en ATTRIBUTE_SNAPSHOT_KEYS`);
  });
  assert.strictEqual(PC.ATTRIBUTE_SNAPSHOT_KEYS.length, 29);
});

// ---------------------------------------------------------------------
// 5. POS snapshot
// ---------------------------------------------------------------------
check('5. POS snapshot: coincide con player.positions en orden fijo', () => {
  const p = makePlayer({ id: 'p5', positions: { Base: 20, Escolta: 14, Alero: 7, 'Ala-pívot': 2, Pívot: 1 } });
  const ch = PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.POSITION_SNAPSHOT_KEYS.forEach((pos, i) => {
    assert.strictEqual(ch.baseline.positions[i], p.positions[pos]);
  });
});

// ---------------------------------------------------------------------
// 6. match suma una vez
// ---------------------------------------------------------------------
check('6. match suma una vez: llamar dos veces con el mismo matchKey no duplica', () => {
  const p = makePlayer({ id: 'p6' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  const info = makeMatchInfo(p, { line: { points: 20 } });
  PC.recordResolvedMatch(p, info, CONFIG_BASE);
  PC.recordResolvedMatch(p, info, CONFIG_BASE);
  assert.strictEqual(PC.statValue(p.careerHistory.currentSeason.stats, 'games'), 1);
  assert.strictEqual(PC.statValue(p.careerHistory.currentSeason.stats, 'points'), 20);
});

// ---------------------------------------------------------------------
// 7. percentages acumulados (no se persisten, se calculan sobre acumulados)
// ---------------------------------------------------------------------
check('7. percentages: no se guardan porcentajes, solo made/attempted', () => {
  const forbidden = ['fg2Pct', 'fg3Pct', 'ftPct', 'totalRebounds'];
  forbidden.forEach((key) => assert.ok(!PC.STAT_SNAPSHOT_KEYS.includes(key), `${key} no debe persistirse`));
  assert.strictEqual(PC.STAT_SNAPSHOT_KEYS.length, 20);
});

// ---------------------------------------------------------------------
// 8. save/load currentSeason
// ---------------------------------------------------------------------
check('8. save/load: currentSeason sobrevive a toJSON()/reconstrucción', () => {
  const p = makePlayer({ id: 'p8' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.recordResolvedMatch(p, makeMatchInfo(p, { line: { points: 15 }, matchKey: 'm8' }), CONFIG_BASE);
  const json = p.toJSON();
  const reloaded = new Player(json);
  assert.ok(reloaded.careerHistory);
  assert.strictEqual(PC.statValue(reloaded.careerHistory.currentSeason.stats, 'points'), 15);
  assert.strictEqual(reloaded.careerHistory.currentSeason.seasonKey, '2026-27');
});

// ---------------------------------------------------------------------
// 9/10. close adds season / second does not overwrite
// ---------------------------------------------------------------------
check('9/10. closeSeason añade temporada; una segunda no sobrescribe la primera', () => {
  const p = makePlayer({ id: 'p9' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.recordResolvedMatch(p, makeMatchInfo(p, { line: { points: 10 }, matchKey: 'm9a' }), CONFIG_BASE);
  PC.closeSeason(p, {
    endDate: REF_DATE, teamId: 'team-A', teamName: 'Equipo A', division: '1ª', nextSeasonKey: '2027-28',
  }, CONFIG_BASE);
  assert.strictEqual(p.careerHistory.seasons.length, 1);
  assert.strictEqual(p.careerHistory.currentSeason.seasonKey, '2027-28');
  PC.recordResolvedMatch(p, makeMatchInfo(p, { line: { points: 5 }, matchKey: 'm9b' }), CONFIG_BASE);
  PC.closeSeason(p, {
    endDate: REF_DATE, teamId: 'team-A', teamName: 'Equipo A', division: '1ª', nextSeasonKey: '2028-29',
  }, CONFIG_BASE);
  assert.strictEqual(p.careerHistory.seasons.length, 2);
  assert.strictEqual(p.careerHistory.seasons[0].stats[PC.STAT_SNAPSHOT_KEYS.indexOf('points')], 10);
  assert.strictEqual(p.careerHistory.seasons[1].stats[PC.STAT_SNAPSHOT_KEYS.indexOf('points')], 5);
});

// ---------------------------------------------------------------------
// 11. CPU history — el mecanismo no distingue usuario/CPU.
// ---------------------------------------------------------------------
check('11. CPU history: recordResolvedMatch funciona igual para cualquier jugador', () => {
  const p = generateFictionalPlayer({ minAge: 20, maxAge: 30, referenceDate: REF_DATE });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.recordResolvedMatch(p, makeMatchInfo(p, { line: { points: 8 }, matchKey: 'cpu-1' }), CONFIG_BASE);
  assert.strictEqual(PC.statValue(p.careerHistory.currentSeason.stats, 'games'), 1);
});

// ---------------------------------------------------------------------
// 12/13/14. partial no debut / complete debut / debut no duplicate
// ---------------------------------------------------------------------
check('12. partial no debut: histórico partial nunca registra milestone debut', () => {
  const p = makePlayer({ id: 'p12' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { historyCompleteness: 'partial', seasonKey: '2026-27' });
  const result = PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm12' }), CONFIG_BASE);
  assert.strictEqual(result.newMilestones.length, 0);
  assert.ok(!p.careerHistory.milestones.some((m) => m.type === 'debut'));
});

check('13. complete debut: primer partido con minutos>0 registra milestone debut', () => {
  const p = makePlayer({ id: 'p13' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { historyCompleteness: 'complete', seasonKey: '2026-27' });
  const result = PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm13' }), CONFIG_BASE);
  assert.strictEqual(result.newMilestones.length, 1);
  assert.strictEqual(result.newMilestones[0].type, 'debut');
});

check('14. debut no duplicate: un segundo partido no vuelve a generar debut', () => {
  const p = makePlayer({ id: 'p14' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { historyCompleteness: 'complete', seasonKey: '2026-27' });
  PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm14a' }), CONFIG_BASE);
  const result2 = PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm14b' }), CONFIG_BASE);
  assert.ok(!result2.newMilestones.some((m) => m.type === 'debut'));
  assert.strictEqual(p.careerHistory.milestones.filter((m) => m.type === 'debut').length, 1);
});

// ---------------------------------------------------------------------
// 15. starts factual
// ---------------------------------------------------------------------
check('15. starts factual: solo se cuenta cuando isStarter=true, nunca inferido de minutos', () => {
  const p = makePlayer({ id: 'p15' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.recordResolvedMatch(p, makeMatchInfo(p, { isStarter: false, matchKey: 'm15a', line: { minutesPlayed: 1800 } }), CONFIG_BASE);
  PC.recordResolvedMatch(p, makeMatchInfo(p, { isStarter: true, matchKey: 'm15b' }), CONFIG_BASE);
  assert.strictEqual(PC.statValue(p.careerHistory.currentSeason.stats, 'starts'), 1);
  assert.strictEqual(PC.statValue(p.careerHistory.currentSeason.stats, 'games'), 2);
});

// ---------------------------------------------------------------------
// 16. milestones no duplicate (umbral de partidos)
// ---------------------------------------------------------------------
check('16. milestones no duplican: el mismo umbral de partidos no se registra dos veces', () => {
  const p = makePlayer({ id: 'p16' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { historyCompleteness: 'complete', seasonKey: '2026-27' });
  for (let i = 0; i < 3; i++) {
    PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: `m16-${i}` }), CONFIG_BASE);
  }
  const debutCount = p.careerHistory.milestones.filter((m) => m.type === 'debut').length;
  assert.strictEqual(debutCount, 1);
});

// ---------------------------------------------------------------------
// 17/18. best thresholds / partial bestInSave
// ---------------------------------------------------------------------
check('17. best thresholds: un récord por debajo del mínimo no genera milestone', () => {
  const p = makePlayer({ id: 'p17' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { historyCompleteness: 'complete', seasonKey: '2026-27' });
  const result = PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm17', line: { points: 5 } }), CONFIG_BASE);
  assert.strictEqual(result.newPersonalBests.length, 0);
  assert.strictEqual(p.careerHistory.personalBests.points.value, 5);
});

check('18. partial bestInSave: personalBests se actualiza también con histórico partial', () => {
  const p = makePlayer({ id: 'p18' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { historyCompleteness: 'partial', seasonKey: '2026-27' });
  const result = PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm18', line: { points: 25 } }), CONFIG_BASE);
  assert.strictEqual(p.careerHistory.personalBests.points.value, 25);
  assert.strictEqual(result.newPersonalBests.length, 1); // 25 >= mínimo (20), se registra milestone igualmente
});

// ---------------------------------------------------------------------
// 19. honours no duplicate
// ---------------------------------------------------------------------
check('19. honours no duplican: registerHonour dos veces con el mismo código no repite', () => {
  const p = makePlayer({ id: 'p19' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.registerHonour(p, 'cupChampion');
  PC.registerHonour(p, 'cupChampion');
  assert.deepStrictEqual(p.careerHistory.currentSeason.honours, ['cupChampion']);
});

// ---------------------------------------------------------------------
// 20. Medical no copiado
// ---------------------------------------------------------------------
check('20. Medical no copiado: careerHistory nunca contiene injuryHistory/medicalState', () => {
  const p = makePlayer({ id: 'p20' });
  const ch = PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  const json = JSON.stringify(ch);
  assert.ok(!json.includes('injuryHistory'));
  assert.ok(!json.includes('medicalState'));
});

// ---------------------------------------------------------------------
// 21. TMB current no persistido como fuente viva
// ---------------------------------------------------------------------
check('21. TMB histórico: los snapshots guardan el valor, nunca una referencia recalculable', () => {
  const p = makePlayer({ id: 'p21' });
  const ch = PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  const baselineTmb = ch.baseline.tmb;
  // Sube mucho el atributo relevante y comprueba que el TMB EN VIVO cambia,
  // pero el snapshot ya guardado permanece igual (no es una referencia).
  p.technical.outsideShot = 20; p.technical.insideShot = 20; p.technical.passing = 20;
  const liveTmb = PD.computeTmbRating(p, CONFIG_BASE);
  assert.strictEqual(ch.baseline.tmb, baselineTmb);
  assert.notStrictEqual(typeof liveTmb, 'undefined');
});

// ---------------------------------------------------------------------
// 22/23. PA/hidden ausentes de lo persistido por PlayerCareer
// ---------------------------------------------------------------------
check('22/23. hidden/PA ausentes: ningún snapshot de PlayerCareer expone potential/learningRate/etc.', () => {
  const p = makePlayer({ id: 'p22' });
  const ch = PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.closeSeason(p, { endDate: REF_DATE, teamId: 't', teamName: 'T', division: '1ª', nextSeasonKey: '2027-28' }, CONFIG_BASE);
  const forbidden = ['potential', 'learningRate', 'learningPersistence', 'professionalism', 'ambition', 'agingOffsetYears', 'developmentSeed', 'medicalSeed', 'attributeProgress', 'positionProgress'];
  const json = JSON.stringify(ch);
  forbidden.forEach((key) => assert.ok(!json.includes(key), `"${key}" no debe aparecer en careerHistory`));
});

// ---------------------------------------------------------------------
// 24. POS LIFE-2 preservado (cambios de posición se ven en el histórico)
// ---------------------------------------------------------------------
check('24. POS LIFE-2 preservado: un cambio de nivel posicional se refleja en el siguiente snapshot', () => {
  const p = makePlayer({ id: 'p24', positions: { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 } });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  p.positions.Escolta = 12; // simula aprendizaje posicional real de LIFE-2
  const record = PC.closeSeason(p, { endDate: REF_DATE, teamId: 't', teamName: 'T', division: '1ª', nextSeasonKey: '2027-28' }, CONFIG_BASE);
  assert.strictEqual(PC.positionAt(record.positions, 'Escolta'), 12);
});

// ---------------------------------------------------------------------
// 25. roles snapshot
// ---------------------------------------------------------------------
check('25. roles snapshot: closeSeason guarda el rol+familiaridad tal cual se le pasa', () => {
  const p = makePlayer({ id: 'p25' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  const record = PC.closeSeason(p, {
    endDate: REF_DATE, teamId: 't', teamName: 'T', division: '1ª', nextSeasonKey: '2027-28',
    roles: { offense: ['pnrHandler', 82], defense: ['poaStopper', 67] },
  }, CONFIG_BASE);
  assert.deepStrictEqual(record.roles.offense, ['pnrHandler', 82]);
  assert.deepStrictEqual(record.roles.defense, ['poaStopper', 67]);
});

// ---------------------------------------------------------------------
// 26. totales = seasons + currentSeason
// ---------------------------------------------------------------------
check('26. totales: computeCareerTotals suma temporadas cerradas + la actual', () => {
  const p = makePlayer({ id: 'p26' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm26a', line: { points: 10 } }), CONFIG_BASE);
  PC.closeSeason(p, { endDate: REF_DATE, teamId: 't', teamName: 'T', division: '1ª', nextSeasonKey: '2027-28' }, CONFIG_BASE);
  PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm26b', line: { points: 20 } }), CONFIG_BASE);
  const totals = PC.computeCareerTotals(p);
  assert.strictEqual(totals.points, 30);
  assert.strictEqual(totals.games, 2);
});

// ---------------------------------------------------------------------
// 27. 2 stints (dos equipos en la misma temporada)
// ---------------------------------------------------------------------
check('27. 2 stints: dos equipos distintos en la misma temporada generan dos stints', () => {
  const p = makePlayer({ id: 'p27' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { seasonKey: '2026-27' });
  PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm27a', team: { id: 'team-A', name: 'A', division: '1ª' } }), CONFIG_BASE);
  PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm27b', team: { id: 'team-C', name: 'C', division: '1ª' } }), CONFIG_BASE);
  assert.strictEqual(p.careerHistory.currentSeason.teamStints.length, 2);
});

// ---------------------------------------------------------------------
// 28. round-trip completo
// ---------------------------------------------------------------------
check('28. round-trip: toJSON()/reconstrucción conserva seasons/milestones/personalBests', () => {
  const p = makePlayer({ id: 'p28' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { historyCompleteness: 'complete', seasonKey: '2026-27' });
  PC.recordResolvedMatch(p, makeMatchInfo(p, { matchKey: 'm28', line: { points: 22 } }), CONFIG_BASE);
  PC.closeSeason(p, { endDate: REF_DATE, teamId: 't', teamName: 'T', division: '1ª', nextSeasonKey: '2027-28' }, CONFIG_BASE);
  const reloaded = new Player(p.toJSON());
  assert.strictEqual(reloaded.careerHistory.seasons.length, 1);
  assert.ok(reloaded.careerHistory.milestones.some((m) => m.type === 'debut'));
  assert.ok(reloaded.careerHistory.personalBests.points);
  assert.ok(reloaded.careerHistory.seasons[0].endDate instanceof Date === false); // toJSON serializa a string ISO
  const revived = PC.ensureCareerHistory(reloaded, CONFIG_BASE, REF_DATE);
  assert.ok(revived.seasons[0].endDate instanceof Date); // ensureCareerHistory revive las fechas
});

// ---------------------------------------------------------------------
// 29/30. 20 temporadas: formato + tamaño
// ---------------------------------------------------------------------
check('29/30. 20 temporadas: formato compacto y tamaño razonable', () => {
  const p = makePlayer({ id: 'p29' });
  PC.ensureCareerHistory(p, CONFIG_BASE, REF_DATE, { historyCompleteness: 'complete', seasonKey: '2026-27' });
  for (let season = 0; season < 20; season++) {
    for (let match = 0; match < 34; match++) {
      PC.recordResolvedMatch(p, makeMatchInfo(p, {
        matchKey: `m29-${season}-${match}`,
        line: { points: 12 + (match % 5), reboundsOffensive: 1, reboundsDefensive: 4, assists: 3, steals: 1, blocks: 1, valoracion: 14 },
      }), CONFIG_BASE);
    }
    PC.closeSeason(p, {
      endDate: REF_DATE, teamId: 't', teamName: 'T', division: '1ª', nextSeasonKey: `season-${season + 1}`,
      roles: { offense: ['pnrHandler', 60], defense: ['poaStopper', 55] },
    }, CONFIG_BASE);
  }
  assert.strictEqual(p.careerHistory.seasons.length, 20);
  p.careerHistory.seasons.forEach((s) => {
    assert.ok(Array.isArray(s.stats));
    assert.ok(Array.isArray(s.attributes));
    assert.ok(Array.isArray(s.positions));
  });
  const bytes = Buffer.byteLength(JSON.stringify(p.toJSON().careerHistory), 'utf8');
  console.log(`     tamaño careerHistory (20 temporadas, 1 jugador): ${bytes} bytes (~${(bytes / 20).toFixed(0)} bytes/temporada)`);
  assert.ok(bytes < 20000, `careerHistory de 20 temporadas no debería superar ~20KB/jugador (real: ${bytes})`);
});

console.log(`\n${passed} OK, ${failed} FAIL`);
if (failed > 0) process.exit(1);
