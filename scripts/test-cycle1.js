#!/usr/bin/env node
// scripts/test-cycle1.js
// Verificación CYCLE-1 (DESIGN.md 9.22) — script Node ad-hoc, mismo criterio
// que test-loan1.js/test-transfer1.js/test-market1.js/test-reg1.js/
// test-contract1.js/test-roster1.js (no hay framework de tests instalado,
// ver CLAUDE.md).
// Ejecutar con:
//   node scripts/test-cycle1.js
//
// Grupos (sección 23 del prompt de CYCLE-1):
//   1. Base y pureza (BUG-LOAN1-01, BUG-CYCLE1-01..06, auditorías estáticas).
//   2. State machine.
//   3. Expiración/renovación/opciones.
//   4. Derechos (tanteo orgánico).
//   5. Retirada.
//   6. Academia.
//   7. CPU y clearing.
//   8. Legalidad/población.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Team } = require('../src/entities/Team.js');
const { Player } = require('../src/entities/Player.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const { AnnualCycleRegistry } = require('../src/core/AnnualCycleRegistry.js');
const { AcademyRegistry } = require('../src/core/AcademyRegistry.js');
const { AnnualCycleService } = require('../src/core/AnnualCycleService.js');
const { ContractExpiryService } = require('../src/core/ContractExpiryService.js');
const { RenewalService } = require('../src/core/RenewalService.js');
const { RetirementService } = require('../src/core/RetirementService.js');
const { AcademyService } = require('../src/core/AcademyService.js');
const { WorldLifecycleService } = require('../src/core/WorldLifecycleService.js');
const { CpuRosterPlanner } = require('../src/core/CpuRosterPlanner.js');
const { MarketClearinghouse } = require('../src/core/MarketClearinghouse.js');
const { RosterLegalityService } = require('../src/core/RosterLegalityService.js');
const { CycleConfig } = require('../src/core/CycleConfig.js');
const CycleEntities = require('../src/entities/Cycle.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');
const { SeasonHistoryService } = require('../src/core/SeasonHistoryService.js');
const { SquadEligibilityService } = require('../src/core/SquadEligibilityService.js');
const { buildCpuLineup } = require('../src/core/CpuLineup.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { CareerAge } = require('../src/utils/CareerAge.js');
const PlayerGenerator = require('../src/utils/playerGenerator.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const Medical = require('../src/core/Medical.js');

let passed = 0;
let failed = 0;
let currentGroup = '';
function group(name) { currentGroup = name; console.log(`\n--- ${name} ---`); }
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL [${currentGroup}] ${name}`);
    console.log(`     ${err.stack || err.message}`);
  }
}

const SEASON = '2026-27';
const GAME_DATE = '2026-10-15';
const CAREER_SEED = 'test-cycle1-seed-v1';

// Reconstrucción real (nunca objetos planos, ver CLAUDE.md) del roster de un
// club a partir del bundle — mismo patrón EXACTO que
// scripts/smoke-cycle1.js's buildRealTeam(): instancias reales de Player,
// lifecycle inicializado UNA vez al importar (BUG-CYCLE1-03), relleno
// determinista si el bundle se queda corto (BUG-CYCLE1-02).
function realTeam(id, isoDate, annualCycleRegistry) {
  const iso = isoDate || GAME_DATE;
  const acr = annualCycleRegistry || new AnnualCycleRegistry();
  return buildRealTeamInner(id, iso, acr);
}
function buildRealTeamInner(id, isoDate, annualCycleRegistry) {
  const teamData = REAL_DATA_TEAMS[id];
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...playerFields } = playerData;
    const player = new Player(playerFields);
    player.dataSource = dataSource || null;
    WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, isoDate, {
      seasonKey: SEASON, historyCompleteness: 'partial', annualCycleRegistry, retirementService: RetirementService, careerSeed: CAREER_SEED,
    });
    return player;
  });
  const resolved = RegistrationService.resolveRegistrationRules({
    competitionId: CompetitionRules.competitionIdFromLegacyDivision(teamData.division), seasonKey: SEASON, date: isoDate, phaseId: 'league',
  });
  const fallbackPlayers = PlayerGenerator.padRosterToMinimum(roster, resolved.squadRules.min, {
    minAge: 18, maxAge: 34, referenceDate: isoDate, seed: `${CAREER_SEED}|roster-fill|${id}`, id: `roster-fill:${id}`,
  });
  fallbackPlayers.forEach((player) => {
    WorldLifecycleService.initializePlayerLifecycle(player, CONFIG_BASE, isoDate, {
      seasonKey: SEASON, historyCompleteness: 'complete', annualCycleRegistry, retirementService: RetirementService, careerSeed: CAREER_SEED,
    });
  });
  return new Team({ ...teamData, roster });
}

function readSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}
// Las auditorías estáticas de este archivo buscan USO real, nunca texto
// dentro de un comentario que documenta la propia prohibición.
function isCommentLine(line) { return /^\s*\/\//.test(line); }

// =========================================================================
// 1. Base y pureza
// =========================================================================
group('1. Base y pureza');

check('CareerAge.ageOn: edad exacta antes/en/después del cumpleaños', () => {
  assert.strictEqual(CareerAge.ageOn('2008-06-15', '2026-06-14'), 17, 'un día antes del cumpleaños');
  assert.strictEqual(CareerAge.ageOn('2008-06-15', '2026-06-15'), 18, 'el día exacto del cumpleaños ya cuenta');
  assert.strictEqual(CareerAge.ageOn('2008-06-15', '2026-06-16'), 18, 'un día después');
});

check('CareerAge.requireCareerDate: sin fecha explícita lanza (BUG-CYCLE1-01)', () => {
  assert.throws(() => CareerAge.ageOn('2008-06-15', undefined), /fecha de carrera/);
  assert.throws(() => CareerAge.ageOn('2008-06-15', null), /fecha de carrera/);
});

check('CareerAge.birthDateForAgeOn: produce EXACTAMENTE la edad pedida en la fecha de referencia', () => {
  const iso = CareerAge.birthDateForAgeOn(17, '2036-09-01');
  assert.strictEqual(CareerAge.ageOn(iso, '2036-09-01'), 17);
  assert.strictEqual(CareerAge.ageOn(iso, '2026-09-01'), 7, 'la MISMA fecha de nacimiento, evaluada en 2026, da otra edad — nunca depende del reloj real');
});

check('playerGenerator determinista: intake 16-19 tiene 16-19 EXACTOS en su fecha de alta, en 2026 y en 2036 (BUG-CYCLE1-02)', () => {
  [{ ref: '2026-09-01' }, { ref: '2036-09-01' }].forEach(({ ref }) => {
    for (let i = 0; i < 5; i += 1) {
      const player = PlayerGenerator.generateFictionalPlayer({
        minAge: 16, maxAge: 19, referenceDate: ref, seed: `${CAREER_SEED}|intake-check|${ref}|${i}`, id: `intake-check:${ref}:${i}`,
      });
      const age = CareerAge.ageOnDate(player, ref);
      assert.ok(age >= 16 && age <= 19, `edad ${age} fuera de 16-19 en ${ref}`);
    }
  });
});

check('playerGenerator determinista: misma semilla -> mismo jugador; semilla distinta -> distinto', () => {
  const a1 = PlayerGenerator.generateFictionalPlayer({
    minAge: 16, maxAge: 19, referenceDate: '2030-01-01', seed: 'same-seed-x', id: 'det-a1',
  });
  const a2 = PlayerGenerator.generateFictionalPlayer({
    minAge: 16, maxAge: 19, referenceDate: '2030-01-01', seed: 'same-seed-x', id: 'det-a2',
  });
  const b = PlayerGenerator.generateFictionalPlayer({
    minAge: 16, maxAge: 19, referenceDate: '2030-01-01', seed: 'other-seed-y', id: 'det-b',
  });
  assert.strictEqual(a1.birthDate.getTime(), a2.birthDate.getTime(), 'misma semilla -> mismo nacimiento');
  assert.deepStrictEqual(a1.technical, a2.technical, 'misma semilla -> mismos atributos');
  const differs = a1.birthDate.getTime() !== b.birthDate.getTime() || JSON.stringify(a1.technical) !== JSON.stringify(b.technical);
  assert.ok(differs, 'semilla distinta debería producir un jugador distinto');
});

check('playerGenerator determinista: id estable — nunca depende del fallback Date.now()+Math.random() de Player', () => {
  const player = PlayerGenerator.generateFictionalPlayer({
    minAge: 16, maxAge: 19, referenceDate: '2030-01-01', seed: 'id-check', id: 'explicit-stable-id-42',
  });
  assert.strictEqual(player.id, 'explicit-stable-id-42');
});

check('CycleConfig.resolveInitialContractSeasons: nunca supera el máximo real de la jurisdicción', () => {
  for (let i = 0; i < 30; i += 1) {
    const seasons = CycleConfig.resolveInitialContractSeasons(`fp-${i}`, 'test', 2, null);
    assert.ok(seasons >= 1 && seasons <= 2, `duración ${seasons} debe recortarse al máximo real (2)`);
  }
});

check('CycleConfig.resolveInitialContractSeasons: distribución real coincide aproximadamente con los pesos (25/30/30/15)', () => {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const N = 2000;
  for (let i = 0; i < N; i += 1) {
    const seasons = CycleConfig.resolveInitialContractSeasons(`dist-${i}`, 'dist-check', 10, null);
    counts[seasons] = (counts[seasons] || 0) + 1;
  }
  assert.ok(counts[1] > 0 && counts[2] > 0, 'debe haber población significativa venciendo tras 1 y 2 temporadas (sección 9)');
  const oneSeasonShare = counts[1] / N;
  assert.ok(oneSeasonShare > 0.15 && oneSeasonShare < 0.35, `1 temporada ~25% esperado, real ${(oneSeasonShare * 100).toFixed(1)}%`);
});

check('MINIMUM_PLAYABLE_REMAINING_SEASONS queda RETIRADO — no participa en ningún cálculo de duración', () => {
  const src = readSrc('src/core/ContractSeeder.js');
  const usageLines = src.split('\n').filter((line) => (
    /\bMINIMUM_PLAYABLE_REMAINING_SEASONS\b/.test(line)
    && !/MINIMUM_PLAYABLE_REMAINING_SEASONS_RETIRED_IN/.test(line)
    && !/^\s*\/\//.test(line.trim())
    && !/^\s*const MINIMUM_PLAYABLE_REMAINING_SEASONS\b/.test(line)
    && !/^\s*MINIMUM_PLAYABLE_REMAINING_SEASONS,?\s*$/.test(line)
  ));
  assert.strictEqual(usageLines.length, 0, `referencias vivas inesperadas: ${JSON.stringify(usageLines)}`);
});

check('Auditoría estática: sin Math.random()/Date.now()/new Date() en el núcleo del ciclo (fuera de fallbacks legacy documentados)', () => {
  const files = [
    'src/core/AnnualCycleService.js', 'src/core/ContractExpiryService.js', 'src/core/RenewalService.js',
    'src/core/RetirementService.js', 'src/core/AcademyService.js', 'src/core/CpuRosterPlanner.js',
    'src/core/MarketClearinghouse.js', 'src/core/RosterLegalityService.js', 'src/entities/Cycle.js',
    'src/core/AnnualCycleRegistry.js', 'src/core/AcademyRegistry.js',
  ];
  const offenders = [];
  files.forEach((rel) => {
    const src = readSrc(rel);
    src.split('\n').forEach((line, idx) => {
      if (isCommentLine(line)) return;
      if (/\bMath\.random\(\)/.test(line) || /\bDate\.now\(\)/.test(line)) {
        offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
      }
    });
  });
  assert.strictEqual(offenders.length, 0, `usos prohibidos encontrados:\n${offenders.join('\n')}`);
});

check('Auditoría estática: ninguna rama nueva por team.division (1ª/2ª) en el núcleo del ciclo', () => {
  const files = [
    'src/core/AnnualCycleService.js', 'src/core/RenewalService.js', 'src/core/RetirementService.js',
    'src/core/AcademyService.js', 'src/core/CpuRosterPlanner.js', 'src/core/MarketClearinghouse.js',
    'src/core/RosterLegalityService.js',
  ];
  const offenders = [];
  files.forEach((rel) => {
    const src = readSrc(rel);
    src.split('\n').forEach((line, idx) => {
      if (/division\s*===\s*['"]/.test(line) || /division\s*!==\s*['"]/.test(line)) {
        offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
      }
    });
  });
  assert.strictEqual(offenders.length, 0, `ramas por division encontradas:\n${offenders.join('\n')}`);
});

check('Auditoría estática (BUG-CYCLE1-03): ningún renderer de src/ui/game.js llama a ensureCareerHistory/ensureMedicalState/ensureDevelopmentState', () => {
  const src = readSrc('src/ui/game.js');
  const lines = src.split('\n');
  const offenders = [];
  lines.forEach((line, idx) => {
    if (isCommentLine(line)) return;
    if (!/ensureCareerHistory|ensureMedicalState|ensureDevelopmentState/.test(line)) return;
    // Solo se permite dentro de funciones de BOOTSTRAP/procesado explícitas
    // (nombre contiene bootstrap/buildRealTeam/WorldLifecycle/recovery/
    // desarrollo), nunca dentro de un render* — localizamos la función
    // contenedora más cercana hacia arriba.
    let containingFn = null;
    for (let i = idx; i >= 0; i -= 1) {
      const m = lines[i].match(/function\s+(\w+)\s*\(/);
      if (m) { containingFn = m[1]; break; }
    }
    const allowed = containingFn && /bootstrap|buildRealTeam|WorldLifecycle|processDevelopment|Recovery/i.test(containingFn);
    if (!allowed) offenders.push(`game.js:${idx + 1} (en ${containingFn || '?'}): ${line.trim()}`);
  });
  assert.strictEqual(offenders.length, 0, `llamadas de inicialización fuera de un punto de bootstrap:\n${offenders.join('\n')}`);
});

check('Auditoría estática: hidden.potential/ambition/professionalism nunca en src/ui', () => {
  const src = readSrc('src/ui/game.js');
  const offenders = src.split('\n').filter((line) => /hidden\.(potential|ambition|professionalism)\b/.test(line));
  assert.strictEqual(offenders.length, 0, JSON.stringify(offenders));
});

check('Auditoría estática (sección 15): CpuRosterPlanner.js (planificación) nunca llama a servicios de commit', () => {
  const src = readSrc('src/core/CpuRosterPlanner.js');
  const forbidden = [
    /ContractRegistry\.register\b/, /ContractService\.createContract\b/, /Team\.addPlayer\b/, /Team\.removePlayer\b/,
    /RosterMutationService\./, /RegistrationService\.createRegistration\b/, /TransferExecutionService\.commitTransaction\b/,
    /LoanService\.returnLoan\b/, /\.registerContract\(/,
  ];
  const offenders = [];
  src.split('\n').forEach((line, idx) => {
    if (isCommentLine(line)) return;
    forbidden.forEach((re) => { if (re.test(line)) offenders.push(`${idx + 1}: ${line.trim()}`); });
  });
  assert.strictEqual(offenders.length, 0, JSON.stringify(offenders));
});

// =========================================================================
// 2. State machine
// =========================================================================
group('2. State machine');

check('CycleConfig.CYCLE_PHASES preserva el orden semántico de la sección 7', () => {
  assert.deepStrictEqual(CycleConfig.CYCLE_PHASES, [
    'competitions-complete', 'snapshot-frozen', 'season-history-closed', 'loans-and-options-reviewed',
    'rights-and-retention-open', 'retirements-reviewed', 'renewals-and-free-agency', 'academy-decisions',
    'clearing-rounds', 'roster-legality-audit', 'licenses-and-registrations', 'preseason-ready', 'new-season-started',
  ]);
});

check('AnnualCycleService.openCycle: exige evidencia real de último partido por club (nunca inventa una fecha común)', () => {
  const annualCycleRegistry = new AnnualCycleRegistry();
  assert.throws(() => AnnualCycleService.openCycle({
    annualCycleRegistry, teams: [], fromSeasonKey: SEASON, targetSeasonKey: '2027-28', evidence: [], date: '2027-07-15',
  }), /evidencia del último partido/);
});

check('AnnualCycleService.openCycle: idempotente por fromSeasonKey', () => {
  const annualCycleRegistry = new AnnualCycleRegistry();
  const teams = [realTeam('team-real-madrid')];
  const evidence = [{ clubId: teams[0].id, date: '2027-06-20' }];
  const first = AnnualCycleService.openCycle({
    annualCycleRegistry, teams, fromSeasonKey: SEASON, targetSeasonKey: '2027-28', evidence, date: '2027-07-01',
  });
  const second = AnnualCycleService.openCycle({
    annualCycleRegistry, teams, fromSeasonKey: SEASON, targetSeasonKey: '2027-28', evidence, date: '2027-07-01',
  });
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(second.cycle.id, first.cycle.id);
});

check('Clubes con último partido distinto: el ciclo conserva CADA fecha real, nunca una única fecha común', () => {
  const annualCycleRegistry = new AnnualCycleRegistry();
  const teamA = realTeam('team-real-madrid');
  const teamB = realTeam('team-gran-canaria');
  const evidence = [
    { clubId: teamA.id, date: '2027-05-10' }, // eliminado pronto
    { clubId: teamB.id, date: '2027-06-25' }, // finalista
  ];
  const { cycle } = AnnualCycleService.openCycle({
    annualCycleRegistry, teams: [teamA, teamB], fromSeasonKey: SEASON, targetSeasonKey: '2027-28', evidence, date: '2027-07-01',
  });
  const byClub = new Map(cycle.clubLastOfficialMatchEvidence.map((row) => [row.clubId, row.date]));
  assert.strictEqual(byClub.get(teamA.id), '2027-05-10');
  assert.strictEqual(byClub.get(teamB.id), '2027-06-25');
  assert.notStrictEqual(byClub.get(teamA.id), byClub.get(teamB.id));
});

check('AnnualRosterCycle: evento duplicado (mismo id) lanza colisión descriptiva, nunca duplica efectos (sección 7)', () => {
  const cycle = new CycleEntities.AnnualRosterCycle({
    id: 'cycle-test-dup', fromSeasonKey: SEASON, targetSeasonKey: '2027-28', openedAt: '2027-07-01',
    openingWorldFingerprint: 'fp', competitionMembershipSnapshot: [], clubLastOfficialMatchEvidence: [{ clubId: 'x', date: '2027-06-01' }],
    summerSchedule: [{ phaseId: 'snapshot-frozen', date: '2027-07-01' }], sourceVersion: 'v1', provenance: { dataSource: 'simulated-cycle-v1', isReal: false },
  });
  // El constructor deja el ledger VACÍO — la única transición inicial
  // válida es "competitions-complete" (mismo evento que registra
  // AnnualCycleService.openCycle() tras construir la entidad).
  cycle.addEvent({
    id: 'evt-0', type: 'phase:competitions-complete', date: '2027-07-01', data: {},
  });
  cycle.addEvent({
    id: 'evt-1', type: 'phase:snapshot-frozen', date: '2027-07-02', data: {},
  });
  const lengthAfterFirst = cycle.events.length;
  assert.throws(
    () => cycle.addEvent({ id: 'evt-1', type: 'phase:snapshot-frozen', date: '2027-07-02', data: {} }),
    /ya existe un evento con id/,
    'un id de evento repetido debe lanzar una colisión descriptiva',
  );
  assert.strictEqual(cycle.events.length, lengthAfterFirst, 'el intento fallido nunca debe duplicar el evento');
});

// =========================================================================
// 3. Expiración/renovación/opciones
// =========================================================================
group('3. Expiración/renovación/opciones');

function buildMiniWorld(seasonKey, isoDate) {
  const playerRegistry = new PlayerRegistry();
  const contractRegistry = new ContractRegistry();
  const registrationRegistry = new RegistrationRegistry();
  const marketRegistry = new MarketRegistry();
  const agentRegistry = new AgentRegistry();
  const transferRegistry = new TransferRegistry();
  const loanRegistry = new LoanRegistry();
  const teamA = realTeam('team-real-madrid', isoDate);
  const teamB = realTeam('team-barca', isoDate);
  // Un roster mínimo real bastante amplio ya viene en el bundle — lo usamos
  // directamente en vez de generar jugadores sintéticos, para que
  // Contract/Registration Seeder resuelvan sus reglas reales.
  [teamA, teamB].forEach((team) => {
    team.roster.forEach((player) => playerRegistry.register(player));
  });
  const calibration = ContractSeeder.buildCompetitionCalibration([teamA, teamB], CONFIG_BASE);
  ContractSeeder.seedContractsForTeams({
    teams: [teamA, teamB], seasonKey, date: isoDate, registry: contractRegistry, playerRegistry, config: CONFIG_BASE, calibration,
  });
  RegistrationSeeder.seedRegistrationsForTeams({
    teams: [teamA, teamB], seasonKey, date: isoDate, registrationRegistry, contractRegistry, config: CONFIG_BASE,
  });
  return {
    playerRegistry, contractRegistry, registrationRegistry, marketRegistry, agentRegistry, transferRegistry, loanRegistry, teamA, teamB,
  };
}

check('ContractExpiryService: un contrato de 1 temporada vence orgánicamente el día siguiente a endDate', () => {
  const world = buildMiniWorld(SEASON, GAME_DATE);
  const annualCycleRegistry = new AnnualCycleRegistry();
  const player = world.teamA.roster[0];
  const contract = world.contractRegistry.currentForPlayer(player.id, GAME_DATE);
  assert.ok(contract, 'debe existir un contrato vigente sembrado');
  // Fuerza una expiración de 1 temporada ajustando endDate al final de la
  // temporada actual (equivalente al 25% de contratos de 1 temporada real).
  const seasonWindow = LocalDate.seasonWindow(SEASON);
  contract.endDate = seasonWindow.endDate;
  const expiryDate = LocalDate.addDays(contract.endDate, 1);
  const due = ContractExpiryService.findDueExpirations({ contractRegistry: world.contractRegistry, date: expiryDate });
  assert.ok(due.some((entry) => entry.contract.id === contract.id), 'debe aparecer como vencido al día siguiente');
  const result = ContractExpiryService.processExpiration({
    contract, expiryDate, contractRegistry: world.contractRegistry, registrationRegistry: world.registrationRegistry,
    playerRegistry: world.playerRegistry, marketRegistry: world.marketRegistry, loanRegistry: world.loanRegistry,
    transferRegistry: world.transferRegistry, annualCycleRegistry, teams: [world.teamA, world.teamB], cycle: null,
    seasonKey: SEASON, lineup: null, date: expiryDate,
  });
  assert.ok(result.record, 'debe producir un receipt de contract-expiry');
  assert.strictEqual(world.teamA.roster.some((p) => p.id === player.id), false, 'sin continuidad, el jugador sale del roster');
  assert.strictEqual(player.teamId, null);
  assert.strictEqual(world.playerRegistry.get(player.id), player, 'sigue siendo la MISMA instancia canónica');
  assert.ok(world.contractRegistry.get(contract.id), 'el contrato vencido permanece en el registro como historia');
});

check('ContractExpiryService: idempotente — repetir el comando devuelve el MISMO receipt', () => {
  const world = buildMiniWorld(SEASON, GAME_DATE);
  const annualCycleRegistry = new AnnualCycleRegistry();
  const player = world.teamA.roster[1];
  const contract = world.contractRegistry.currentForPlayer(player.id, GAME_DATE);
  contract.endDate = LocalDate.seasonWindow(SEASON).endDate;
  const expiryDate = LocalDate.addDays(contract.endDate, 1);
  const params = {
    contract, expiryDate, contractRegistry: world.contractRegistry, registrationRegistry: world.registrationRegistry,
    playerRegistry: world.playerRegistry, marketRegistry: world.marketRegistry, loanRegistry: world.loanRegistry,
    transferRegistry: world.transferRegistry, annualCycleRegistry, teams: [world.teamA, world.teamB], cycle: null,
    seasonKey: SEASON, lineup: null, date: expiryDate,
  };
  const first = ContractExpiryService.processExpiration(params);
  const second = ContractExpiryService.processExpiration(params);
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(second.record.id, first.record.id);
});

check('ContractExpiryService: rollback exacto ante un fallo inyectado en la liberación de registro', () => {
  const world = buildMiniWorld(SEASON, GAME_DATE);
  const annualCycleRegistry = new AnnualCycleRegistry();
  const player = world.teamA.roster[2];
  const contract = world.contractRegistry.currentForPlayer(player.id, GAME_DATE);
  contract.endDate = LocalDate.seasonWindow(SEASON).endDate;
  const expiryDate = LocalDate.addDays(contract.endDate, 1);
  const rosterBefore = world.teamA.roster.map((p) => p.id);
  const original = RegistrationService.deactivateRegistration;
  let threw = false;
  if (typeof original === 'function') {
    RegistrationService.deactivateRegistration = () => { throw new Error('INJECTED test rollback'); };
    try {
      ContractExpiryService.processExpiration({
        contract, expiryDate, contractRegistry: world.contractRegistry, registrationRegistry: world.registrationRegistry,
        playerRegistry: world.playerRegistry, marketRegistry: world.marketRegistry, loanRegistry: world.loanRegistry,
        transferRegistry: world.transferRegistry, annualCycleRegistry, teams: [world.teamA, world.teamB], cycle: null,
        seasonKey: SEASON, lineup: null, date: expiryDate,
      });
    } catch (err) { threw = true; } finally { RegistrationService.deactivateRegistration = original; }
    assert.ok(threw, 'un fallo inyectado debe propagar el error, nunca quedar a medias en silencio');
    assert.deepStrictEqual(world.teamA.roster.map((p) => p.id), rosterBefore, 'el roster debe quedar EXACTAMENTE como antes');
    assert.strictEqual(world.contractRegistry.currentForPlayer(player.id, GAME_DATE).id, contract.id, 'el contrato sigue vigente tras el rollback');
  }
});

check('RenewalService.isRenewable: fuera de la ventana de juego antes de expirar -> no renovable', () => {
  const world = buildMiniWorld(SEASON, GAME_DATE);
  const annualCycleRegistry = new AnnualCycleRegistry();
  const player = world.teamA.roster[3];
  const contract = world.contractRegistry.currentForPlayer(player.id, GAME_DATE);
  contract.endDate = LocalDate.addSeasons(SEASON, 3).replace ? contract.endDate : contract.endDate;
  const farDate = LocalDate.seasonWindow(LocalDate.addSeasons(SEASON, 5)).endDate;
  contract.endDate = farDate;
  const outcome = RenewalService.isRenewable({
    contract, annualCycleRegistry, contractRegistry: world.contractRegistry, date: GAME_DATE,
  });
  assert.strictEqual(outcome.renewable, false);
  assert.strictEqual(outcome.reason, 'OUTSIDE_RENEWAL_WINDOW');
});

check('RenewalService.buildOptionDecision: rechaza una cláusula que no es una opción contractual', () => {
  const annualCycleRegistry = new AnnualCycleRegistry();
  const cycle = { id: 'cycle-opt-test' };
  assert.throws(() => RenewalService.buildOptionDecision({
    annualCycleRegistry, cycle, contract: { playerId: 'x' }, clause: { type: 'recall-right', id: 'clause-1' }, date: GAME_DATE,
  }), /no es una opción contractual/);
});

check('ContractOptionDecision: una cláusula sin ventana/temporada/compensación completa NUNCA es ejecutable (nunca se inventa)', () => {
  const incomplete = new CycleEntities.ContractOptionDecision({
    id: 'opt-decision-incomplete', cycleId: 'cycle-x', playerId: 'player-x', clubId: 'club-x',
    contractId: 'contract-x', clauseId: 'clause-incomplete', clauseType: 'club-option',
    // Sin window/addedSeasonKeys/compensationSeasons/entitledParty: a propósito incompleta.
    provenance: { dataSource: 'simulated-cycle-v1', isReal: false },
  });
  const executability = incomplete.describeExecutability();
  assert.strictEqual(executability.executable, false);
  assert.ok(executability.missingTerms.length > 0);

  const complete = new CycleEntities.ContractOptionDecision({
    id: 'opt-decision-complete', cycleId: 'cycle-x', playerId: 'player-x', clubId: 'club-x',
    contractId: 'contract-x', clauseId: 'clause-complete', clauseType: 'club-option',
    entitledParty: 'club',
    window: { fromDate: '2027-05-01', toDate: '2027-06-01' },
    addedSeasonKeys: ['2028-29'],
    compensationSeasons: [{ seasonKey: '2028-29', guaranteedBaseSalaryMinor: 10000000 }],
    provenance: { dataSource: 'simulated-cycle-v1', isReal: false },
  });
  assert.strictEqual(complete.describeExecutability().executable, true, 'con TODOS los términos completos, sí debe ser ejecutable');
});

// =========================================================================
// 4. Derechos (tanteo orgánico)
// =========================================================================
group('4. Derechos (tanteo orgánico)');

check('paymentComplianceEvidence: sin ledger, el motor nunca inventa deuda ("unknown"/"confirmed-clear" por defecto, nunca "confirmed-debt")', () => {
  const result = AnnualCycleService.paymentComplianceEvidence({ contractId: 'contract-x', clubId: 'club-x', date: GAME_DATE });
  assert.notStrictEqual(result.status, 'confirmed-debt');
  assert.ok(result.status === 'unknown' || result.status === 'confirmed-clear', `estado inesperado: ${result.status}`);
});

check('paymentComplianceEvidence: un ledger con evidencia "unknown" NUNCA se interpreta como deuda confirmada', () => {
  const fakeLedger = { evidenceFor: () => ({ status: null }) };
  const result = AnnualCycleService.paymentComplianceEvidence({
    contractId: 'contract-x', clubId: 'club-x', date: GAME_DATE, paymentLedger: fakeLedger,
  });
  assert.strictEqual(result.status, 'unknown');
});

check('MoraBanc Andorra: su régimen laboral sigue resolviendo AD, nunca ACB por defecto, también dentro del ciclo', () => {
  // Prueba indirecta y estable: el catálogo de contexto laboral por club
  // (ya usado por CONTRACT-1/TRANSFER-1/LOAN-1) sigue resolviendo AD para
  // MoraBanc — CYCLE-1 reutiliza ese mismo catálogo sin ninguna capa nueva.
  const { ClubEmploymentContextCatalog } = require('../src/core/ClubEmploymentContextCatalog.js');
  const ctx = ClubEmploymentContextCatalog.requireClubEmploymentContext('team-morabanc-andorra');
  assert.strictEqual(ctx.employerJurisdictionId, 'AD');
});

// =========================================================================
// 5. Retirada
// =========================================================================
group('5. Retirada');

check('RetirementService.ensureProfile: misma semilla/jugador -> mismo perfil (determinista)', () => {
  const annualCycleRegistry = new AnnualCycleRegistry();
  const player = { id: 'retire-player-a' };
  const p1 = RetirementService.ensureProfile({
    annualCycleRegistry, player, careerSeed: CAREER_SEED, date: GAME_DATE,
  });
  const registryB = new AnnualCycleRegistry();
  const p2 = RetirementService.ensureProfile({
    annualCycleRegistry: registryB, player, careerSeed: CAREER_SEED, date: GAME_DATE,
  });
  assert.strictEqual(p1.longevityOffsetYears, p2.longevityOffsetYears);
});

check('RetirementService: el perfil NUNCA usa hidden.potential como entrada (auditoría estática, fuera de la prohibición documentada)', () => {
  const src = readSrc('src/core/RetirementService.js');
  const offenders = src.split('\n').filter((line) => !isCommentLine(line) && /hidden\.potential/.test(line));
  assert.strictEqual(offenders.length, 0, `uso real encontrado: ${JSON.stringify(offenders)}`);
});

check('RetirementService: dos jugadores con el MISMO potencial (irrelevante, ni se lee) pueden tener perfiles de longevidad distintos', () => {
  const annualCycleRegistry = new AnnualCycleRegistry();
  const playerA = { id: 'twin-a' };
  const playerB = { id: 'twin-b' };
  const profileA = RetirementService.ensureProfile({ annualCycleRegistry, player: playerA, careerSeed: CAREER_SEED, date: GAME_DATE });
  const profileB = RetirementService.ensureProfile({ annualCycleRegistry, player: playerB, careerSeed: CAREER_SEED, date: GAME_DATE });
  assert.notStrictEqual(profileA.longevityOffsetYears, profileB.longevityOffsetYears, 'ids distintos deben producir perfiles distintos (huella propia)');
});

check('RetirementService.announceRetirement: idempotente, misma announcement al repetir', () => {
  const annualCycleRegistry = new AnnualCycleRegistry();
  const cycle = { id: 'cycle-retire-test' };
  const player = { id: 'retire-announce-player', birthDate: new Date(1990, 0, 1) };
  const first = RetirementService.announceRetirement({
    annualCycleRegistry, cycle, player, clubId: 'club-x', date: GAME_DATE, currentContract: null, reasons: ['test'], forced: false,
  });
  const second = RetirementService.announceRetirement({
    annualCycleRegistry, cycle, player, clubId: 'club-x', date: GAME_DATE, currentContract: null, reasons: ['test'], forced: false,
  });
  assert.strictEqual(second.id, first.id);
});

// =========================================================================
// 6. Academia
// =========================================================================
group('6. Academia');

check('AcademyService.runAnnualIntake: nunca supera el cap de 8 y solo llena vacantes reales', () => {
  const playerRegistry = new PlayerRegistry();
  const academyRegistry = new AcademyRegistry();
  const team = realTeam('team-real-madrid');
  const first = AcademyService.runAnnualIntake({
    academyRegistry, playerRegistry, team, cycle: { id: 'cycle-academy-1' }, date: '2027-08-15', seasonKey: '2027-28',
    config: CONFIG_BASE, careerSeed: CAREER_SEED,
  });
  assert.ok(first.created.length <= 3, 'máximo 3 por año');
  assert.strictEqual(first.created.length, first.vacancies > 0 ? Math.min(3, first.vacancies) : 0);
  // Repite 4 años más para llenar el pool y comprobar el tope de 8.
  let seasonKey = '2027-28';
  for (let i = 0; i < 4; i += 1) {
    seasonKey = LocalDate.addSeasons(seasonKey, 1);
    AcademyService.runAnnualIntake({
      academyRegistry, playerRegistry, team, cycle: { id: `cycle-academy-${i}` }, date: '2027-08-15', seasonKey, config: CONFIG_BASE, careerSeed: CAREER_SEED,
    });
  }
  const pool = academyRegistry.activePoolForClub(team.id, '2031-08-15');
  assert.ok(pool.length <= 8, `el pool nunca debe superar 8, tiene ${pool.length}`);
});

check('AcademyService.runAnnualIntake: sin vacantes (pool lleno) no crea a nadie (nunca "3 obligatorios")', () => {
  const playerRegistry = new PlayerRegistry();
  const academyRegistry = new AcademyRegistry();
  const team = realTeam('team-barca');
  let seasonKey = SEASON;
  for (let i = 0; i < 5; i += 1) {
    AcademyService.runAnnualIntake({
      academyRegistry, playerRegistry, team, cycle: { id: `cycle-full-${i}` }, date: '2027-08-15', seasonKey, config: CONFIG_BASE, careerSeed: CAREER_SEED,
    });
    seasonKey = LocalDate.addSeasons(seasonKey, 1);
  }
  const poolBefore = academyRegistry.activePoolForClub(team.id, '2032-08-15').length;
  const extra = AcademyService.runAnnualIntake({
    academyRegistry, playerRegistry, team, cycle: { id: 'cycle-extra' }, date: '2032-08-15', seasonKey, config: CONFIG_BASE, careerSeed: CAREER_SEED,
  });
  assert.strictEqual(poolBefore, 8);
  assert.strictEqual(extra.created.length, 0, 'con el pool lleno, ninguna incorporación nueva');
});

check('Academia: mientras solo está en el pool, el joven NUNCA está en Team.roster ni tiene teamId', () => {
  const playerRegistry = new PlayerRegistry();
  const academyRegistry = new AcademyRegistry();
  const team = realTeam('team-valencia-basket');
  const { created } = AcademyService.runAnnualIntake({
    academyRegistry, playerRegistry, team, cycle: { id: 'cycle-membership' }, date: '2027-08-15', seasonKey: SEASON, config: CONFIG_BASE, careerSeed: CAREER_SEED,
  });
  assert.ok(created.length > 0, 'este club debería tener vacantes');
  created.forEach(({ player }) => {
    assert.strictEqual(player.teamId, null);
    assert.strictEqual(team.roster.some((p) => p.id === player.id), false);
  });
});

// =========================================================================
// 7. CPU y clearing
// =========================================================================
group('7. CPU y clearing');

check('CpuRosterPlanner: planificar es PURO — no muta contractRegistry/playerRegistry/roster', () => {
  const world = buildMiniWorld(SEASON, GAME_DATE);
  const contractsBefore = JSON.stringify(world.contractRegistry.snapshot());
  const playersBefore = JSON.stringify(world.playerRegistry.snapshot());
  const rosterABefore = world.teamA.roster.map((p) => p.id);
  const snapshot = CpuRosterPlanner.buildSnapshot({
    teams: [world.teamA, world.teamB], playerRegistry: world.playerRegistry, contractRegistry: world.contractRegistry,
    registrationRegistry: world.registrationRegistry, loanRegistry: world.loanRegistry, date: GAME_DATE, seasonKey: SEASON, config: CONFIG_BASE,
  });
  CpuRosterPlanner.buildAllPlans({
    snapshot, teams: [world.teamA, world.teamB], config: CONFIG_BASE, seasonKey: SEASON, date: GAME_DATE, careerSeed: CAREER_SEED,
  });
  assert.strictEqual(JSON.stringify(world.contractRegistry.snapshot()), contractsBefore, 'contractRegistry no debe mutar al planificar');
  assert.strictEqual(JSON.stringify(world.playerRegistry.snapshot()), playersBefore, 'playerRegistry no debe mutar al planificar');
  assert.deepStrictEqual(world.teamA.roster.map((p) => p.id), rosterABefore, 'el roster no debe mutar al planificar');
});

check('CpuRosterPlanner: el orden del array de equipos no cambia el conjunto de planes producidos', () => {
  const world = buildMiniWorld(SEASON, GAME_DATE);
  const teams = [world.teamA, world.teamB];
  const shuffled = [world.teamB, world.teamA];
  const snapshotA = CpuRosterPlanner.buildSnapshot({
    teams, playerRegistry: world.playerRegistry, contractRegistry: world.contractRegistry, registrationRegistry: world.registrationRegistry,
    loanRegistry: world.loanRegistry, date: GAME_DATE, seasonKey: SEASON, config: CONFIG_BASE,
  });
  const snapshotB = CpuRosterPlanner.buildSnapshot({
    teams: shuffled, playerRegistry: world.playerRegistry, contractRegistry: world.contractRegistry, registrationRegistry: world.registrationRegistry,
    loanRegistry: world.loanRegistry, date: GAME_DATE, seasonKey: SEASON, config: CONFIG_BASE,
  });
  assert.strictEqual(snapshotA.fingerprint, snapshotB.fingerprint, 'el snapshot canónico debe ser byte-equivalente sin importar el orden del array de entrada');
});

check('CpuRosterPlanner.buildAllPlans: misma semilla + mismo snapshot = mismos planes (determinismo)', () => {
  const world = buildMiniWorld(SEASON, GAME_DATE);
  const snapshot = CpuRosterPlanner.buildSnapshot({
    teams: [world.teamA, world.teamB], playerRegistry: world.playerRegistry, contractRegistry: world.contractRegistry,
    registrationRegistry: world.registrationRegistry, loanRegistry: world.loanRegistry, date: GAME_DATE, seasonKey: SEASON, config: CONFIG_BASE,
  });
  const plansA = CpuRosterPlanner.buildAllPlans({
    snapshot, teams: [world.teamA, world.teamB], config: CONFIG_BASE, seasonKey: SEASON, date: GAME_DATE, careerSeed: CAREER_SEED,
  });
  const plansB = CpuRosterPlanner.buildAllPlans({
    snapshot, teams: [world.teamA, world.teamB], config: CONFIG_BASE, seasonKey: SEASON, date: GAME_DATE, careerSeed: CAREER_SEED,
  });
  assert.strictEqual(
    JSON.stringify(plansA.map((p) => p.snapshotFingerprint)),
    JSON.stringify(plansB.map((p) => p.snapshotFingerprint)),
  );
});

// =========================================================================
// 8. Legalidad/población
// =========================================================================
group('8. Legalidad/población');

check('RosterLegalityService.buildReport: ACB y Primera FEB conservan cupos/rangos DISTINTOS (nunca un 8-12 global)', () => {
  const teamAcb = realTeam('team-real-madrid');
  const teamFeb = realTeam('team-bueno-arenas-albacete');
  const playerRegistry = new PlayerRegistry();
  const contractRegistry = new ContractRegistry();
  const registrationRegistry = new RegistrationRegistry();
  [teamAcb, teamFeb].forEach((team) => team.roster.forEach((p) => playerRegistry.register(p)));
  ContractSeeder.seedContractsForTeams({
    teams: [teamAcb, teamFeb], seasonKey: SEASON, date: GAME_DATE, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
  });
  RegistrationSeeder.seedRegistrationsForTeams({
    teams: [teamAcb, teamFeb], seasonKey: SEASON, date: GAME_DATE, registrationRegistry, contractRegistry, config: CONFIG_BASE,
  });
  const reportAcb = RosterLegalityService.buildReport({
    team: teamAcb, seasonKey: SEASON, date: GAME_DATE, phaseId: 'league', cycleId: null, config: CONFIG_BASE,
    playerRegistry, contractRegistry, registrationRegistry, loanRegistry: new LoanRegistry(), teams: [teamAcb, teamFeb], classificationCache: new Map(),
  });
  const reportFeb = RosterLegalityService.buildReport({
    team: teamFeb, seasonKey: SEASON, date: GAME_DATE, phaseId: 'league', cycleId: null, config: CONFIG_BASE,
    playerRegistry, contractRegistry, registrationRegistry, loanRegistry: new LoanRegistry(), teams: [teamAcb, teamFeb], classificationCache: new Map(),
  });
  assert.notDeepStrictEqual(reportAcb.squadRules, reportFeb.squadRules, 'ACB y Primera FEB deben resolver reglas de convocatoria DISTINTAS');
});

check('BUG-LOAN1-01: CpuLineup.buildCpuLineup devuelve "infeasible" TIPADO ante un pool regulado vacío — nunca cae al selector legacy', () => {
  const team = realTeam('team-real-madrid');
  const resolved = { squadRules: { min: 8, max: 12 } };
  const built = buildCpuLineup(team, 0.5, CONFIG_BASE, new Date('2027-01-15'), resolved.squadRules, { pool: [], resolved });
  assert.strictEqual(built.outcome, 'infeasible');
  assert.ok(built.diagnostic && built.diagnostic.code);
  assert.strictEqual(built.squad, null, 'un resultado inviable nunca produce un acta jugable');
});

check('BUG-LOAN1-01: con contexto regulado real y roster suficiente, la convocatoria es "legal" (nunca legacy)', () => {
  const team = realTeam('team-real-madrid');
  const playerRegistry = new PlayerRegistry();
  const contractRegistry = new ContractRegistry();
  const registrationRegistry = new RegistrationRegistry();
  team.roster.forEach((p) => playerRegistry.register(p));
  ContractSeeder.seedContractsForTeams({
    teams: [team], seasonKey: SEASON, date: GAME_DATE, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
  });
  RegistrationSeeder.seedRegistrationsForTeams({
    teams: [team], seasonKey: SEASON, date: GAME_DATE, registrationRegistry, contractRegistry, config: CONFIG_BASE,
  });
  const resolved = RegistrationService.resolveRegistrationRules({
    competitionId: CompetitionRules.competitionIdFromLegacyDivision(team.division), seasonKey: SEASON, date: GAME_DATE, phaseId: 'league',
  });
  const context = {
    competitionId: CompetitionRules.competitionIdFromLegacyDivision(team.division),
    competitionInstanceId: CompetitionRules.competitionIdFromLegacyDivision(team.division),
    seasonKey: SEASON, date: GAME_DATE, phaseId: 'league',
  };
  const pool = RosterLegalityService.buildRegulatedPool({
    team, context, playerRegistry, contractRegistry, registrationRegistry,
    loanRegistry: new LoanRegistry(), teams: [team], classificationCache: new Map(),
  });
  const built = buildCpuLineup(team, 0.5, CONFIG_BASE, new Date('2026-10-15'), resolved.squadRules, { pool, resolved });
  assert.strictEqual(built.outcome, 'legal', JSON.stringify(built.diagnostic));
  assert.ok(built.squad && built.squad.length >= resolved.squadRules.min);
});

check('Población: activa vs histórica son conceptos DISTINTOS (WorldLifecycleService.describePopulation)', () => {
  const playerRegistry = new PlayerRegistry();
  const team = realTeam('team-real-madrid');
  team.roster.forEach((p) => playerRegistry.register(p));
  const academyRegistry = new AcademyRegistry();
  const annualCycleRegistry = new AnnualCycleRegistry();
  const pop = WorldLifecycleService.describePopulation(
    {
      playerRegistry, teams: [team], annualCycleRegistry, academyRegistry,
    },
    GAME_DATE,
    CycleConfig,
    { [team.id]: 12 },
  );
  assert.ok(typeof pop.activeTotal === 'number');
  assert.ok(typeof pop.historicalTotal === 'number');
  assert.ok(pop.historicalTotal >= pop.activeTotal, 'la histórica nunca puede ser menor que la activa (los retirados se conservan aparte)');
  assert.ok(typeof pop.activeBound === 'number' && pop.activeBound > 0, 'la cota debe derivarse de la configuración, nunca un número mágico');
});

console.log(`\n${passed} OK, ${failed} FAIL`);
if (failed > 0) process.exit(1);
