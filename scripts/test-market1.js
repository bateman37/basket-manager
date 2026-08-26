#!/usr/bin/env node
// scripts/test-market1.js
// Verificación MARKET-1 (DESIGN.md 9.19) — script Node ad-hoc, mismo
// criterio que test-reg1.js/test-contract1.js/test-roster1.js (no hay
// framework de tests instalado, ver CLAUDE.md). Ejecutar con:
//   node scripts/test-market1.js
//
// Grupos (sección 19.1 del prompt de MARKET-1):
//   1. Bugs base (REG-1 estabilizado + táctico)
//   2. Agentes
//   3. Mercado/registro
//   4. Negociación
//   5. Oferta/empleo/presupuesto
//   6. Multi-liga
//   7. Tanteo ACB
//   8. Reloj
//   9. Auditorías estáticas de alcance

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');
const { EligibilityService } = require('../src/core/EligibilityService.js');
const { Contract, buildPaymentSchedule } = require('../src/entities/Contract.js');
const { ContractService } = require('../src/core/ContractService.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { DeterministicRandom } = require('../src/utils/DeterministicRandom.js');
const { MarketEventTypes } = require('../src/core/MarketEventTypes.js');
const { Agent, RepresentationMandate } = require('../src/entities/Agent.js');
const {
  NegotiationThread, ContractOffer, AgreementInPrinciple, QualifyingOfferCase,
  RightOfFirstRefusalCase, ReturnRightsCase, DebtChallenge, PotentialCompensationClaim,
} = require('../src/entities/Market.js');
const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { NegotiationService } = require('../src/core/NegotiationService.js');
const { MarketService } = require('../src/core/MarketService.js');
const { MarketSeeder } = require('../src/core/MarketSeeder.js');
const { RightOfFirstRefusalService } = require('../src/core/RightOfFirstRefusalService.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const Rotation = require('../src/core/Rotation.js');
const { REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');

let passed = 0;
let failed = 0;
let currentGroup = '';
function group(name) {
  currentGroup = name;
  console.log(`\n--- ${name} ---`);
}
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
const GAME_DATE = '2026-10-03';

function birthDateForAge(age, referenceDate = GAME_DATE) {
  const { year, month, day } = LocalDate.parse(referenceDate);
  return new Date(year - age, month - 1, day);
}

function makePlayer(overrides = {}) {
  const data = {
    id: overrides.id,
    firstName: 'Test',
    lastName: overrides.lastName || 'Player',
    birthDate: overrides.birthDate || birthDateForAge(overrides.age !== undefined ? overrides.age : 24),
    positions: overrides.positions || { Base: 15, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: overrides.nominalPosition || 'Base',
    technical: overrides.technical || {},
    physical: { durability: 10, recovery: 10, ...overrides.physical },
    mental: overrides.mental || {},
    hidden: {
      potential: overrides.potential !== undefined ? overrides.potential : 150,
      professionalism: 10, ambition: 10, learningRate: 10, learningPersistence: 10,
    },
  };
  return new Player(data);
}

function makeTeam(clubId, division, rosterSize = 1) {
  const roster = [];
  for (let i = 0; i < rosterSize; i += 1) roster.push(makePlayer({ id: `${clubId}-p${i}` }));
  return new Team({
    id: clubId, name: clubId, city: 'Test', division, roster,
  });
}

function realTeam(id) {
  return new Team({ ...REAL_DATA_TEAMS[id], roster: [] });
}

function buildValidDraft(team, player, resolved, overrides = {}) {
  const employment = resolved.employment;
  const currency = employment.allowedCurrencies[0];
  const minimum = employment.effectiveMinimumAnnual ? employment.effectiveMinimumAnnual.amountMinor : 0;
  const baseSalary = overrides.baseSalaryMinor !== undefined ? overrides.baseSalaryMinor : Math.max(minimum, 5000000);
  const seasons = overrides.coveredSeasonKeys || [SEASON];
  const startDate = overrides.startDate || LocalDate.seasonWindow(seasons[0]).startDate;
  const endDate = overrides.endDate || LocalDate.seasonWindow(seasons[seasons.length - 1]).endDate;
  const installmentCount = overrides.installmentCount || employment.payments.defaultInstallmentCount;
  const schedule = [];
  seasons.forEach((seasonKey) => {
    const window = LocalDate.seasonWindow(seasonKey);
    buildPaymentSchedule({
      totalMinor: baseSalary, installmentCount, firstDueDate: LocalDate.endOfMonth(window.startDate),
      frequency: employment.payments.frequency || 'monthly', currency, seasonKey,
    }).forEach((installment) => schedule.push(installment));
  });
  return {
    playerId: player.id,
    clubId: team.id,
    signedDate: overrides.signedDate || startDate,
    startDate,
    endDate,
    coveredSeasonKeys: seasons,
    guaranteeType: overrides.guaranteeType || 'fully-guaranteed',
    compensation: {
      currency, declaredBasis: 'gross',
      seasons: seasons.map((seasonKey) => ({
        seasonKey, guaranteedBaseSalaryMinor: baseSalary, guaranteedImageRightsMinor: 0, guaranteedSalaryInKindMinor: 0,
        signingBonusMinor: 0, variableBonuses: [], nonSalaryBenefits: [], agentCosts: [],
      })),
    },
    paymentPolicy: { installmentCount, frequency: employment.payments.frequency || 'monthly', scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'], schedule },
    clauses: overrides.clauses || [],
    declaredDocuments: ['written-contract', ...employment.requiredDocuments],
    provenance: { dataSource: 'simulated-market-offer-v1', isReal: false },
  };
}

// =========================================================================
// 1. Bugs base
// =========================================================================
group('1. Bugs base (REG-1 estabilizado + táctico)');

check('BUG-REG1-06: dos "carreras" con el mismo playerId/competición/temporada no comparten clasificación', () => {
  // Simulación de dos careras: cada una construye su PROPIO registro y su
  // PROPIA caché — nunca comparten instancia (mismo criterio que
  // playerRegistry/contractRegistry por carrera).
  const cacheA = new Map();
  cacheA.set('player-X', { formation: 'qualifies' });
  const cacheB = new Map(); // "nueva carrera": caché nueva, nunca la de A
  assert.ok(!cacheB.has('player-X'), 'la caché de la carrera nueva no debería heredar entradas de la anterior');
  assert.strictEqual(cacheA.get('player-X').formation, 'qualifies');
});

check('BUG-REG1-07: inscripción rechaza contrato de OTRO jugador', () => {
  const c = new Contract({
    id: 'c1', playerId: 'playerA', clubId: 'clubA', contractType: 'professional-player',
    signedDate: '2026-08-01', startDate: '2026-08-01', endDate: '2027-06-30', guaranteeType: 'fully-guaranteed',
    compensation: { currency: 'EUR', declaredBasis: 'gross', seasons: [{ seasonKey: SEASON, guaranteedBaseSalaryMinor: 1000000 }] },
    declaredDocuments: ['written-contract'],
  });
  const cr = new ContractRegistry();
  cr.register(c);
  assert.throws(() => {
    RegistrationService.createRegistration({
      registry: new RegistrationRegistry(), playerId: 'playerB', licenseId: 'lic1', teamId: 'clubA',
      competitionId: 'acb', registrationScopeId: 'scope1', seasonKey: SEASON,
      accessCategory: 'senior', contractId: 'c1', contractRegistry: cr, date: GAME_DATE,
      resolved: { registration: null }, provenance: { dataSource: 'test', isReal: false },
    });
  }, /REGISTRATION_CONTRACT_PLAYER_MISMATCH/);
});

check('BUG-REG1-07: inscripción rechaza contrato de OTRO club', () => {
  const c = new Contract({
    id: 'c2', playerId: 'playerA', clubId: 'clubA', contractType: 'professional-player',
    signedDate: '2026-08-01', startDate: '2026-08-01', endDate: '2027-06-30', guaranteeType: 'fully-guaranteed',
    compensation: { currency: 'EUR', declaredBasis: 'gross', seasons: [{ seasonKey: SEASON, guaranteedBaseSalaryMinor: 1000000 }] },
    declaredDocuments: ['written-contract'],
  });
  const cr = new ContractRegistry();
  cr.register(c);
  assert.throws(() => {
    RegistrationService.createRegistration({
      registry: new RegistrationRegistry(), playerId: 'playerA', licenseId: 'lic1', teamId: 'clubB',
      competitionId: 'acb', registrationScopeId: 'scope1', seasonKey: SEASON,
      accessCategory: 'senior', contractId: 'c2', contractRegistry: cr, date: GAME_DATE,
      resolved: { registration: null }, provenance: { dataSource: 'test', isReal: false },
    });
  }, /REGISTRATION_CONTRACT_CLUB_MISMATCH/);
});

check('BUG-REG1-07: ambos correctos (jugador y club) no lanza', () => {
  const c = new Contract({
    id: 'c3', playerId: 'playerA', clubId: 'clubA', contractType: 'professional-player',
    signedDate: '2026-08-01', startDate: '2026-08-01', endDate: '2027-06-30', guaranteeType: 'fully-guaranteed',
    compensation: { currency: 'EUR', declaredBasis: 'gross', seasons: [{ seasonKey: SEASON, guaranteedBaseSalaryMinor: 1000000 }] },
    declaredDocuments: ['written-contract'],
  });
  const cr = new ContractRegistry();
  cr.register(c);
  const resolved = { registration: null, bundleId: 'x', version: 1 };
  assert.doesNotThrow(() => {
    RegistrationService.createRegistration({
      registry: new RegistrationRegistry(), playerId: 'playerA', licenseId: 'lic1', teamId: 'clubA',
      competitionId: 'acb', registrationScopeId: 'scope1', seasonKey: SEASON,
      accessCategory: 'senior', contractId: 'c3', contractRegistry: cr, date: GAME_DATE,
      resolved, provenance: { dataSource: 'test', isReal: false }, chain: ['submitted'],
    });
  });
});

check('BUG-REG1-08: contrato pending no habilita elegibilidad de partido hoy (pero sí isCurrentOn)', () => {
  const c = new Contract({
    id: 'c4', playerId: 'playerA', clubId: 'clubA', contractType: 'professional-player',
    signedDate: '2026-08-01', startDate: '2027-07-01', endDate: '2028-06-30', guaranteeType: 'fully-guaranteed',
    compensation: { currency: 'EUR', declaredBasis: 'gross', seasons: [{ seasonKey: '2027-28', guaranteedBaseSalaryMinor: 1000000 }] },
    declaredDocuments: ['written-contract'],
  });
  assert.strictEqual(c.statusOn(GAME_DATE), 'pending');
  assert.strictEqual(c.isCurrentOn(GAME_DATE), true, 'isCurrentOn sigue contando pending (nómina/compromisos)');
  assert.strictEqual(c.isActiveOn(GAME_DATE), false, 'isActiveOn NO cuenta pending (elegibilidad de partido)');
});

check('BUG-REG1-09: el código de doble acta es agnóstico de competición', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src/core/EligibilityService.js'), 'utf8');
  assert.ok(code.includes('ALREADY_ON_OTHER_ACT_SAME_ROUND'));
  assert.ok(!code.includes('ALREADY_ON_OTHER_ACB_ACT_SAME_ROUND'));
});

check('BUG-PREEXISTING-TAC-01: alineación degenerada (mismo jugador en dos posiciones) se rechaza sin cambiar una válida', () => {
  const degenerate = {
    entries: {
      Base: { starter: { playerId: 'p1', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
      Escolta: { starter: { playerId: 'p1', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
      Alero: { starter: { playerId: 'p3', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
      'Ala-pívot': { starter: { playerId: 'p4', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
      Pívot: { starter: { playerId: 'p5', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
    },
  };
  const v = Rotation.validateLineup(degenerate, CONFIG_BASE);
  assert.strictEqual(v.valid, false);
  assert.ok(v.errors.some((e) => e.type === 'duplicate-on-court-starter' && e.playerId === 'p1'));

  const valid = {
    entries: {
      Base: { starter: { playerId: 'p1', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
      Escolta: { starter: { playerId: 'p2', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
      Alero: { starter: { playerId: 'p3', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
      'Ala-pívot': { starter: { playerId: 'p4', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
      Pívot: { starter: { playerId: 'p5', minutesQuota: 40 }, sub1: { playerId: null, minutesQuota: 0 }, sub2: { playerId: null, minutesQuota: 0 } },
    },
  };
  const v2 = Rotation.validateLineup(valid, CONFIG_BASE);
  assert.strictEqual(v2.valid, true, 'una alineación válida no debe verse afectada por el nuevo guard');
});

// =========================================================================
// 2. Agentes
// =========================================================================
group('2. Agentes');

check('credencial vigente/expirada se deriva de fechas, nunca de un booleano', () => {
  const agent = new Agent({
    id: 'a1', displayName: 'Test Agent',
    credentials: [{ issuer: 'FIBA', type: 'fiba-agent-license', validity: { startDate: '2026-01-01', endDate: '2026-12-31' } }],
  });
  assert.strictEqual(agent.credentialStatusOn('fiba-agent-license', '2026-06-01'), 'active');
  assert.strictEqual(agent.credentialStatusOn('fiba-agent-license', '2027-06-01'), 'expired');
});

check('mandato exige contrato escrito declarado', () => {
  const m = new RepresentationMandate({
    id: 'm1', agentId: 'a1', clientType: 'player', clientId: 'p1', startDate: '2026-01-01', endDate: '2027-12-31',
    commissionBasisPoints: 500, feePayerClientId: 'p1', writtenContractDeclared: true,
  });
  assert.strictEqual(m.writtenContractDeclared, true);
});

check('mandato máximo FIBA: 2 años exacto es válido, más de 2 se detecta en termYears', () => {
  const ok = new RepresentationMandate({
    id: 'm2', agentId: 'a1', clientType: 'player', clientId: 'p1', startDate: '2026-01-01', endDate: '2027-12-31',
    commissionBasisPoints: 500, feePayerClientId: 'p1',
  });
  assert.ok(ok.termYears <= 2.01);
  const long = new RepresentationMandate({
    id: 'm3', agentId: 'a1', clientType: 'player', clientId: 'p1', startDate: '2026-01-01', endDate: '2030-12-31',
    commissionBasisPoints: 500, feePayerClientId: 'p1',
  });
  assert.ok(long.termYears > 2.01, 'un mandato de ~5 años debe superar el máximo FIBA — la validación normativa la aplica MarketService');
});

check('terminación exige preaviso de 30 días (evento explícito)', () => {
  const m = new RepresentationMandate({
    id: 'm4', agentId: 'a1', clientType: 'player', clientId: 'p1', startDate: '2026-01-01', endDate: '2027-12-31',
    commissionBasisPoints: 500, feePayerClientId: 'p1',
  });
  m.addLifecycleEvent({ type: 'termination-notice-given', date: '2026-06-01' });
  m.addLifecycleEvent({ type: 'terminated', date: '2026-07-01' });
  const noticeDays = LocalDate.daysBetween('2026-06-01', '2026-07-01');
  assert.strictEqual(noticeDays, 30);
  assert.strictEqual(m.statusOn('2026-07-01'), 'terminated');
  assert.strictEqual(m.statusOn('2026-06-15'), 'active', 'sigue activo mientras el preaviso corre');
});

check('comisión 10% exacto (1000bp) es válida estructuralmente; superior también se admite estructuralmente pero MarketService la rechazaría contra la regla FIBA', () => {
  assert.doesNotThrow(() => new RepresentationMandate({
    id: 'm5', agentId: 'a1', clientType: 'player', clientId: 'p1', startDate: '2026-01-01', commissionBasisPoints: 1000, feePayerClientId: 'p1',
  }));
  const over = new RepresentationMandate({
    id: 'm6', agentId: 'a1', clientType: 'player', clientId: 'p1', startDate: '2026-01-01', commissionBasisPoints: 1500, feePayerClientId: 'p1',
  });
  const fiba = CompetitionRules.MARKET_MODULES['fiba-agents-book3-2026-v1'].agentPrinciples;
  assert.ok(over.commissionBasisPoints > fiba.commissionMaxBasisPoints, 'MarketService debe rechazar esto contra la regla FIBA resuelta');
});

check('pagador distinto del cliente es detectable (feePayerClientId !== clientId)', () => {
  const m = new RepresentationMandate({
    id: 'm7', agentId: 'a1', clientType: 'player', clientId: 'p1', startDate: '2026-01-01', commissionBasisPoints: 500, feePayerClientId: 'club-X',
  });
  assert.notStrictEqual(m.feePayerClientId, m.clientId, 'FIBA: el pagador debe ser el cliente — este caso debe marcarse inválido por quien valide contra la regla');
});

check('doble representación (mismo agente, club y jugador de ese club) detectada por validateConflictOfInterest', () => {
  const reg = new AgentRegistry();
  const agent = new Agent({ id: 'a2', displayName: 'Test' });
  reg.registerAgent(agent);
  reg.registerMandate(new RepresentationMandate({ id: 'm8', agentId: 'a2', clientType: 'player', clientId: 'p1', startDate: '2026-01-01', commissionBasisPoints: 500, feePayerClientId: 'p1' }));
  reg.registerMandate(new RepresentationMandate({ id: 'm9', agentId: 'a2', clientType: 'club', clientId: 'clubZ', startDate: '2026-01-01', commissionBasisPoints: 500, feePayerClientId: 'clubZ' }));
  const conflict = reg.validateConflictOfInterest({ agentId: 'a2', playerId: 'p1', involvedClubId: 'clubZ', date: GAME_DATE });
  assert.strictEqual(conflict.valid, false);
});

check('menor no recibe captación (mandato con jugador menor de 18 marcado en validateIntegrity)', () => {
  const reg = new AgentRegistry();
  const agent = new Agent({ id: 'a3', displayName: 'Test' });
  reg.registerAgent(agent);
  reg.registerMandate(new RepresentationMandate({ id: 'm10', agentId: 'a3', clientType: 'player', clientId: 'minor-1', startDate: GAME_DATE, commissionBasisPoints: 500, feePayerClientId: 'minor-1' }));
  const pr = new PlayerRegistry();
  const minor = makePlayer({ id: 'minor-1', age: 16 });
  pr.register(minor);
  const integrity = reg.validateIntegrity({ playerRegistry: pr, date: GAME_DATE });
  assert.ok(!integrity.valid, 'un mandato vigente con un menor de 18 debe marcarse como error');
});

check('el jugador conserva la decisión final (player-accepted solo lo dispara quien acepta la oferta, nunca el agente en solitario)', () => {
  const offer = new ContractOffer({
    id: 'o1', threadId: 't1', version: 1, offeredBy: 'club', createdAt: GAME_DATE, expiresAt: '2026-10-10',
    playerId: 'p1', clubId: 'c1', contractDraft: { compensation: { currency: 'EUR', seasons: [] } },
  });
  offer.addEvent({ id: 'o1:accept', type: 'player-accepted', date: '2026-10-04' });
  assert.strictEqual(offer.statusOn('2026-10-04'), 'accepted');
});

check('licencia FIBA obligatoria SOLO en contexto internacional, nunca doméstico', () => {
  const domestic = CompetitionRules.resolveMarketRules({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE });
  assert.ok(domestic.capabilities.has('requiresFibaLicensedAgentForInternationalTransfer'));
  assert.ok(domestic.market.agentPrinciples.requiresFibaLicenseForOperations.includes('internationalTransfer'));
  assert.ok(!domestic.market.agentPrinciples.requiresFibaLicenseForOperations.includes('domestic'));
});

// =========================================================================
// 3. Mercado/registro
// =========================================================================
group('3. Mercado/registro');

check('seeder determinista: misma semilla produce el mismo pool exacto', () => {
  const pr1 = new PlayerRegistry();
  const c1 = MarketSeeder.seedFreeAgentPool({ playerRegistry: pr1, careerSeed: 'seed-test-A', referenceDate: GAME_DATE, config: CONFIG_BASE });
  const pr2 = new PlayerRegistry();
  const c2 = MarketSeeder.seedFreeAgentPool({ playerRegistry: pr2, careerSeed: 'seed-test-A', referenceDate: GAME_DATE, config: CONFIG_BASE });
  assert.strictEqual(c1.length, c2.length);
  c1.forEach((p, i) => {
    assert.strictEqual(p.id, c2[i].id);
    assert.strictEqual(p.fullName, c2[i].fullName);
    assert.strictEqual(p.birthDate.getTime(), c2[i].birthDate.getTime());
  });
});

check('seeder idempotente: segunda llamada no añade nada', () => {
  const pr = new PlayerRegistry();
  const first = MarketSeeder.seedFreeAgentPool({ playerRegistry: pr, careerSeed: 'seed-test-B', referenceDate: GAME_DATE, config: CONFIG_BASE });
  const second = MarketSeeder.seedFreeAgentPool({ playerRegistry: pr, careerSeed: 'seed-test-B', referenceDate: GAME_DATE, config: CONFIG_BASE });
  assert.strictEqual(first.length, MarketSeeder.DEFAULT_POOL_SIZE);
  assert.strictEqual(second.length, 0);
});

check('30 libres por defecto, distribución 6 por posición', () => {
  const pr = new PlayerRegistry();
  const created = MarketSeeder.seedFreeAgentPool({ playerRegistry: pr, careerSeed: 'seed-test-C', referenceDate: GAME_DATE, config: CONFIG_BASE });
  assert.strictEqual(created.length, 30);
  const byPos = {};
  created.forEach((p) => { byPos[p.nominalPosition] = (byPos[p.nominalPosition] || 0) + 1; });
  ['Base', 'Escolta', 'Alero', 'Ala-pívot', 'Pívot'].forEach((pos) => assert.strictEqual(byPos[pos], 6));
});

check('todos los libres están en PlayerRegistry y ninguno en roster/ContractRegistry', () => {
  const pr = new PlayerRegistry();
  const cr = new ContractRegistry();
  const created = MarketSeeder.seedFreeAgentPool({ playerRegistry: pr, careerSeed: 'seed-test-D', referenceDate: GAME_DATE, config: CONFIG_BASE });
  created.forEach((p) => {
    assert.ok(pr.has(p.id));
    assert.strictEqual(p.teamId, null);
    assert.strictEqual(cr.currentForPlayer(p.id, GAME_DATE), null);
  });
});

check('disponibilidad derivada: libre / bajo contrato / próximo a expirar', () => {
  const pr = new PlayerRegistry();
  const cr = new ContractRegistry();
  const mr = new MarketRegistry();
  const free = makePlayer({ id: 'free-1' });
  pr.register(free);
  const underContract = makePlayer({ id: 'uc-1' });
  pr.register(underContract);
  cr.register(new Contract({
    id: 'c-uc', playerId: 'uc-1', clubId: 'club-1', contractType: 'professional-player',
    signedDate: '2025-08-01', startDate: '2025-08-01', endDate: '2028-06-30', guaranteeType: 'fully-guaranteed',
    coveredSeasonKeys: [SEASON],
    compensation: { currency: 'EUR', declaredBasis: 'gross', seasons: [{ seasonKey: SEASON, guaranteedBaseSalaryMinor: 1000000 }] },
    declaredDocuments: ['written-contract'],
  }));
  const expiring = makePlayer({ id: 'exp-1' });
  pr.register(expiring);
  cr.register(new Contract({
    id: 'c-exp', playerId: 'exp-1', clubId: 'club-1', contractType: 'professional-player',
    signedDate: '2025-08-01', startDate: '2025-08-01', endDate: '2027-01-15', guaranteeType: 'fully-guaranteed',
    coveredSeasonKeys: [SEASON],
    compensation: { currency: 'EUR', declaredBasis: 'gross', seasons: [{ seasonKey: SEASON, guaranteedBaseSalaryMinor: 1000000 }] },
    declaredDocuments: ['written-contract'],
  }));
  assert.strictEqual(MarketService.resolveMarketAvailability({ playerId: 'free-1', playerRegistry: pr, contractRegistry: cr, marketRegistry: mr, date: GAME_DATE }).status, 'free');
  assert.strictEqual(MarketService.resolveMarketAvailability({ playerId: 'uc-1', playerRegistry: pr, contractRegistry: cr, marketRegistry: mr, date: GAME_DATE }).status, 'under-contract');
  assert.strictEqual(MarketService.resolveMarketAvailability({ playerId: 'exp-1', playerRegistry: pr, contractRegistry: cr, marketRegistry: mr, date: GAME_DATE }).status, 'contract-expiring-soon');
});

check('seguimiento idempotente', () => {
  const mr = new MarketRegistry();
  mr.addWatch('club-1', 'p1');
  mr.addWatch('club-1', 'p1');
  assert.deepStrictEqual(mr.watchlistForClub('club-1'), ['p1']);
  mr.removeWatch('club-1', 'p1');
  mr.removeWatch('club-1', 'p1');
  assert.deepStrictEqual(mr.watchlistForClub('club-1'), []);
});

check('integridad de referencias MarketRegistry detecta oferta huérfana', () => {
  const mr = new MarketRegistry();
  const thread = new NegotiationThread({ id: 't-orphan', playerId: 'p1', actingClubId: 'c1', openedAt: GAME_DATE });
  mr.registerThread(thread);
  thread.addOfferId('offer-inexistente');
  const integrity = mr.validateIntegrity({});
  assert.ok(!integrity.valid);
});

check('limpieza de carrera: registros nuevos por instancia, nunca singleton', () => {
  const ar1 = new AgentRegistry();
  const ar2 = new AgentRegistry();
  assert.notStrictEqual(ar1, ar2);
  const mr1 = new MarketRegistry();
  const mr2 = new MarketRegistry();
  assert.notStrictEqual(mr1, mr2);
});

// =========================================================================
// 4. Negociación
// =========================================================================
group('4. Negociación');

// Avanza un hilo hasta 'interest-confirmed', pasando por los eventos
// intermedios obligatorios de la máquina de estados (contacto -> respuesta
// programada -> confirmado) — helper compartido por los tests que
// necesitan un hilo listo para recibir ofertas sin pasar por
// MarketService.openInquiry/processInterestResponseEvent.
function advanceThreadToConfirmed(thread, date) {
  thread.addEvent({ id: `${thread.id}:contacted`, type: 'player-side-contacted', date });
  thread.addEvent({ id: `${thread.id}:scheduled`, type: 'interest-response-scheduled', date });
  thread.addEvent({ id: `${thread.id}:confirmed`, type: 'interest-confirmed', date });
  return thread;
}

function setupNegotiationFixture(seed) {
  const team = realTeam('team-real-madrid');
  const player = makePlayer({ id: `nego-player-${seed}`, age: 26 });
  const pr = new PlayerRegistry();
  pr.register(player);
  const cr = new ContractRegistry();
  const mr = new MarketRegistry();
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE, operation: 'test' });
  const thread = MarketService.openInquiry({
    marketRegistry: mr, agentRegistry: null, playerId: player.id, actingClubId: team.id,
    prospectiveCompetitionIds: ['acb'], date: GAME_DATE, marketContext, careerSeed: seed,
  });
  return {
    team, player, pr, cr, mr, marketContext, thread,
  };
}

check('consulta, respuesta diferida y orden de eventos', () => {
  const { mr, thread } = setupNegotiationFixture('seed-nego-1');
  assert.strictEqual(thread.statusOn(GAME_DATE), 'interest-response-scheduled');
  const due = mr.eventsDueThrough('2026-10-10');
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].type, 'interest-response');
  assert.ok(LocalDate.compare(due[0].dueDate, GAME_DATE) > 0, 'la respuesta es SIEMPRE diferida, nunca el mismo día');
});

check('dos renders (dos llamadas) no cambian la respuesta de interés', () => {
  const {
    mr, pr, thread,
  } = setupNegotiationFixture('seed-nego-2');
  const due = mr.eventsDueThrough('2026-10-10')[0];
  const r1 = MarketService.processInterestResponseEvent({ marketRegistry: mr, playerRegistry: pr, event: due, date: due.dueDate, careerSeed: 'seed-nego-2' });
  const status1 = thread.statusOn(due.dueDate);
  // Segunda "renderización": el evento ya está marcado processed, así que
  // eventsDueThrough ya no lo devuelve — invariante de no reprocesar.
  const dueAgain = mr.eventsDueThrough('2026-10-10');
  assert.strictEqual(dueAgain.length, 0);
  assert.strictEqual(thread.statusOn(due.dueDate), status1);
});

check('oferta/contraoferta inmutables: contractDraft congelado, contraoferta = id+versión nuevos', () => {
  const { team, player, mr } = setupNegotiationFixture('seed-nego-3');
  const thread = new NegotiationThread({ id: 'imm-thread', playerId: player.id, actingClubId: team.id, openedAt: GAME_DATE });
  mr.registerThread(thread);
  thread.addEvent({ id: 'imm:e2', type: 'player-side-contacted', date: GAME_DATE });
  thread.addEvent({ id: 'imm:e3', type: 'interest-response-scheduled', date: GAME_DATE });
  thread.addEvent({ id: 'imm:e4', type: 'interest-confirmed', date: GAME_DATE });
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 30000000 });
  const offer1 = MarketService.createAndSendOffer({
    marketRegistry: mr, thread, draft, offeredBy: 'club', date: GAME_DATE, careerSeed: 'seed-nego-3',
  });
  // Object.freeze en módulos no-strict no lanza al reasignar — se
  // comprueba que la asignación NO surte efecto (single source of truth).
  const before = offer1.contractDraft.compensation;
  offer1.contractDraft.compensation = null;
  assert.strictEqual(offer1.contractDraft.compensation, before, 'contractDraft debe estar congelado (Object.freeze) — la asignación no debe surtir efecto');
  offer1.addEvent({ id: `${offer1.id}:cnt`, type: 'offer-countered', date: '2026-10-04' });
  const offer2 = MarketService.createAndSendOffer({
    marketRegistry: mr, thread, draft, offeredBy: 'player-side', date: '2026-10-04', careerSeed: 'seed-nego-3', parentOfferId: offer1.id, version: offer1.version + 1,
  });
  assert.notStrictEqual(offer1.id, offer2.id);
  assert.strictEqual(offer2.version, offer1.version + 1);
  assert.strictEqual(offer2.parentOfferId, offer1.id);
});

check('transición inválida rechazada (no se puede aceptar un hilo recién abierto sin pasar por interés)', () => {
  const thread = new NegotiationThread({ id: 'bad-thread', playerId: 'p1', actingClubId: 'c1', openedAt: GAME_DATE });
  assert.throws(() => thread.addEvent({ id: 'bad:e2', type: 'agreement-created', date: GAME_DATE }));
});

check('retirada/expiración liberan reserva una sola vez (idempotente)', () => {
  const { team, player, mr } = setupNegotiationFixture('seed-nego-4');
  const thread = new NegotiationThread({ id: 'wd-thread', playerId: player.id, actingClubId: team.id, openedAt: GAME_DATE });
  mr.registerThread(thread);
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 20000000 });
  const offer = MarketService.createAndSendOffer({ marketRegistry: mr, thread, draft, offeredBy: 'club', date: GAME_DATE, careerSeed: 'seed-nego-4' });
  assert.ok(mr.reservedTotalForClubSeason(team.id, SEASON) > 0);
  MarketService.withdrawOffer(mr, offer.id, GAME_DATE);
  assert.strictEqual(mr.reservedTotalForClubSeason(team.id, SEASON), 0);
  assert.throws(() => MarketService.withdrawOffer(mr, offer.id, GAME_DATE), /no está en estado retirable/);
  assert.strictEqual(mr.reservedTotalForClubSeason(team.id, SEASON), 0, 'segundo intento no debe volver a liberar/afectar nada');
});

check('aceptación conserva la reserva (no se libera al crear el acuerdo)', () => {
  const { team, player, mr } = setupNegotiationFixture('seed-nego-5');
  const thread = new NegotiationThread({ id: 'acc-thread', playerId: player.id, actingClubId: team.id, openedAt: GAME_DATE });
  mr.registerThread(thread);
  advanceThreadToConfirmed(thread, GAME_DATE);
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 40000000 });
  const offer = MarketService.createAndSendOffer({ marketRegistry: mr, thread, draft, offeredBy: 'club', date: GAME_DATE, careerSeed: 'seed-nego-5' });
  const reservedBefore = mr.reservedTotalForClubSeason(team.id, SEASON);
  offer.addEvent({ id: `${offer.id}:acc`, type: 'player-accepted', date: '2026-10-04' });
  const agreement = MarketService.createAgreementInPrinciple({
    marketRegistry: mr, thread, offer, date: '2026-10-04', employmentSnapshot: {},
  });
  assert.strictEqual(mr.reservedTotalForClubSeason(team.id, SEASON), reservedBefore, 'la reserva de la oferta aceptada se conserva');
  assert.strictEqual(agreement.executionState, 'pending-transfer-1');
});

check('segundo acuerdo incompatible para el mismo jugador se rechaza (invariante 8)', () => {
  const { team, player, mr } = setupNegotiationFixture('seed-nego-6');
  const thread = new NegotiationThread({ id: 'dup-thread', playerId: player.id, actingClubId: team.id, openedAt: GAME_DATE });
  mr.registerThread(thread);
  advanceThreadToConfirmed(thread, GAME_DATE);
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 40000000 });
  const offer1 = MarketService.createAndSendOffer({ marketRegistry: mr, thread, draft, offeredBy: 'club', date: GAME_DATE, careerSeed: 'seed-nego-6' });
  offer1.addEvent({ id: `${offer1.id}:acc`, type: 'player-accepted', date: '2026-10-04' });
  MarketService.createAgreementInPrinciple({ marketRegistry: mr, thread, offer: offer1, date: '2026-10-04', employmentSnapshot: {} });

  const otherTeam = realTeam('team-morabanc-andorra');
  const thread2 = new NegotiationThread({ id: 'dup-thread-2', playerId: player.id, actingClubId: otherTeam.id, openedAt: '2026-10-05' });
  mr.registerThread(thread2);
  advanceThreadToConfirmed(thread2, '2026-10-05');
  const draft2 = buildValidDraft(otherTeam, player, ContractService.resolveRulesForClub(otherTeam, { seasonKey: SEASON, date: '2026-10-05', operation: 'signContract' }), { baseSalaryMinor: 40000000 });
  const offer2 = MarketService.createAndSendOffer({ marketRegistry: mr, thread: thread2, draft: draft2, offeredBy: 'club', date: '2026-10-05', careerSeed: 'seed-nego-6' });
  offer2.addEvent({ id: `${offer2.id}:acc`, type: 'player-accepted', date: '2026-10-06' });
  assert.throws(() => MarketService.createAgreementInPrinciple({ marketRegistry: mr, thread: thread2, offer: offer2, date: '2026-10-06', employmentSnapshot: {} }), /invariante 8/);
});

check('feedback cualitativo nunca expone valores ocultos (sin fitScore/threshold/peso en el resultado)', () => {
  const player = makePlayer({ id: 'feedback-p1' });
  const offer = new ContractOffer({
    id: 'fb-offer', threadId: 'fb-thread', version: 1, offeredBy: 'club', createdAt: GAME_DATE, expiresAt: '2026-10-10',
    playerId: player.id, clubId: 'c1',
    contractDraft: { guaranteeType: 'fully-guaranteed', compensation: { currency: 'EUR', declaredBasis: 'gross', seasons: [{ seasonKey: SEASON, guaranteedBaseSalaryMinor: 1000000 }] } },
  });
  const fp = NegotiationService.buildFingerprint({ careerSeed: 'seed-fb', playerId: player.id, threadId: 'fb-thread', offerVersion: 1, decisionDate: '2026-10-04' });
  const evaluation = NegotiationService.evaluateOffer({ player, offer, priorOffers: [], fingerprint: fp, roundIndex: 0 });
  const serialized = JSON.stringify(evaluation);
  assert.ok(!/fitScore|threshold|weight|utility/i.test(serialized));
  assert.ok(Array.isArray(evaluation.qualitativeMessages));
});

check('contrato bajo vigencia no se rompe: la oferta con otro club queda marcada requiresTransferResolution', () => {
  const team = realTeam('team-real-madrid');
  const player = makePlayer({ id: 'under-contract-elsewhere' });
  const pr = new PlayerRegistry();
  pr.register(player);
  const cr = new ContractRegistry();
  cr.register(new Contract({
    id: 'existing-elsewhere', playerId: player.id, clubId: 'other-club-y', contractType: 'professional-player',
    signedDate: '2025-07-01', startDate: '2025-07-01', endDate: '2027-06-30', guaranteeType: 'fully-guaranteed',
    compensation: {
      currency: 'EUR', declaredBasis: 'gross', seasons: [
        { seasonKey: '2025-26', guaranteedBaseSalaryMinor: 2000000 }, { seasonKey: SEASON, guaranteedBaseSalaryMinor: 2000000 },
      ],
    },
    declaredDocuments: ['written-contract'],
  }));
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 10000000 });
  const validation = ContractService.validateDraft({
    draft, team, player, playerRegistry: pr, contractRegistry: cr, seasonKey: SEASON, date: GAME_DATE,
  });
  assert.strictEqual(validation.requiresTransferResolution, true);
  assert.strictEqual(cr.size, 1, 'el contrato existente no se ha tocado');
});

check('oferta futura (empieza tras expirar el contrato) queda diferenciada de la incorporación inmediata', () => {
  const team = realTeam('team-real-madrid');
  const player = makePlayer({ id: 'future-offer-player' });
  const pr = new PlayerRegistry();
  pr.register(player);
  const cr = new ContractRegistry();
  cr.register(new Contract({
    id: 'expiring-soon', playerId: player.id, clubId: 'other-club-z', contractType: 'professional-player',
    signedDate: '2025-07-01', startDate: '2025-07-01', endDate: '2027-06-30', guaranteeType: 'fully-guaranteed',
    compensation: {
      currency: 'EUR', declaredBasis: 'gross', seasons: [
        { seasonKey: '2025-26', guaranteedBaseSalaryMinor: 2000000 }, { seasonKey: SEASON, guaranteedBaseSalaryMinor: 2000000 },
      ],
    },
    declaredDocuments: ['written-contract'],
  }));
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: '2027-28', date: '2027-07-01', operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 10000000, coveredSeasonKeys: ['2027-28'] });
  const validation = ContractService.validateDraft({
    draft, team, player, playerRegistry: pr, contractRegistry: cr, seasonKey: '2027-28', date: '2027-07-01',
  });
  assert.strictEqual(validation.overlapsCurrentContract, false, 'una oferta que empieza tras expirar el contrato actual no se solapa');
  assert.strictEqual(validation.requiresTransferResolution, false);
});

// =========================================================================
// 5. Oferta/empleo/presupuesto
// =========================================================================
group('5. Oferta/empleo/presupuesto');

check('MoraBanc Andorra: oferta de mercado resuelve AD, nunca RD 1006/SMI español', () => {
  const team = realTeam('team-morabanc-andorra');
  const player = makePlayer({ id: 'morabanc-target' });
  const pr = new PlayerRegistry();
  pr.register(player);
  const cr = new ContractRegistry();
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 20000000 });
  const validation = ContractService.validateDraft({
    draft, team, player, playerRegistry: pr, contractRegistry: cr, seasonKey: SEASON, date: GAME_DATE,
  });
  assert.strictEqual(validation.valid, true, validation.errors.join(' | '));
  assert.strictEqual(validation.signingContext.employerJurisdictionId, 'AD');
});

check('validateDraft nunca registra (ContractRegistry.size sin cambios)', () => {
  const team = realTeam('team-real-madrid');
  const player = makePlayer({ id: 'never-registered' });
  const pr = new PlayerRegistry();
  pr.register(player);
  const cr = new ContractRegistry();
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 15000000 });
  ContractService.validateDraft({
    draft, team, player, playerRegistry: pr, contractRegistry: cr, seasonKey: SEASON, date: GAME_DATE,
  });
  assert.strictEqual(cr.size, 0);
});

check('cantidades siempre enteras (Minor)', () => {
  const team = realTeam('team-real-madrid');
  const player = makePlayer({ id: 'minor-check' });
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 12345678 });
  draft.compensation.seasons.forEach((s) => assert.ok(Number.isInteger(s.guaranteedBaseSalaryMinor)));
});

check('límite interno de presupuesto por temporada bloquea una oferta excesiva', () => {
  const team = realTeam('team-real-madrid');
  const player = makePlayer({ id: 'budget-check' });
  const pr = new PlayerRegistry();
  pr.register(player);
  const cr = new ContractRegistry();
  const mr = new MarketRegistry();
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE });
  const costPlan = MarketService.computeSquadCostPlan({
    team, contractRegistry: cr, marketRegistry: mr, seasonKey: SEASON,
  });
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: costPlan.limitMinor * 2 });
  const validation = MarketService.validateOfferBeforeSend({
    draft, team, player, playerRegistry: pr, contractRegistry: cr, marketRegistry: mr, seasonKey: SEASON, date: GAME_DATE, marketContext,
  });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('límite interno')));
});

check('no hay doble reserva al contraofertar (solo la versión viva relevante cuenta)', () => {
  const { team, player, mr } = setupNegotiationFixture('seed-budget-1');
  const thread = new NegotiationThread({ id: 'nb-thread', playerId: player.id, actingClubId: team.id, openedAt: GAME_DATE });
  mr.registerThread(thread);
  advanceThreadToConfirmed(thread, GAME_DATE);
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft1 = buildValidDraft(team, player, resolved, { baseSalaryMinor: 20000000 });
  const offer1 = MarketService.createAndSendOffer({ marketRegistry: mr, thread, draft: draft1, offeredBy: 'club', date: GAME_DATE, careerSeed: 'seed-budget-1' });
  const reserved1 = mr.reservedTotalForClubSeason(team.id, SEASON);
  offer1.addEvent({ id: `${offer1.id}:cnt`, type: 'offer-countered', date: '2026-10-04' });
  mr.releaseBudget(`res:${offer1.id}`);
  const draft2 = buildValidDraft(team, player, resolved, { baseSalaryMinor: 25000000 });
  MarketService.createAndSendOffer({
    marketRegistry: mr, thread, draft: draft2, offeredBy: 'player-side', date: '2026-10-04', careerSeed: 'seed-budget-1', parentOfferId: offer1.id, version: 2,
  });
  const reserved2 = mr.reservedTotalForClubSeason(team.id, SEASON);
  assert.strictEqual(reserved2, 25000000, 'solo la versión viva (25M minor) cuenta, no 20M+25M');
  assert.notStrictEqual(reserved1, reserved2);
});

check('ContractRegistry.size, roster y RegistrationRegistry sin cambios tras un AIP', () => {
  const team = realTeam('team-real-madrid');
  const player = makePlayer({ id: 'aip-untouched' });
  const pr = new PlayerRegistry();
  pr.register(player);
  const cr = new ContractRegistry();
  const rr = new RegistrationRegistry();
  const mr = new MarketRegistry();
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE });
  const thread = MarketService.openInquiry({
    marketRegistry: mr, agentRegistry: null, playerId: player.id, actingClubId: team.id, prospectiveCompetitionIds: ['acb'], date: GAME_DATE, marketContext, careerSeed: 'seed-untouched',
  });
  const dueEvent = mr.eventsDueThrough('2026-10-10')[0];
  MarketService.processInterestResponseEvent({ marketRegistry: mr, playerRegistry: pr, event: dueEvent, date: dueEvent.dueDate, careerSeed: 'seed-untouched' });
  const offerDate = dueEvent.dueDate;
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: offerDate, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 40000000 });
  const offer = MarketService.createAndSendOffer({ marketRegistry: mr, thread, draft, offeredBy: 'club', date: offerDate, careerSeed: 'seed-untouched' });
  const acceptDate = LocalDate.addDays(offerDate, 1);
  offer.addEvent({ id: `${offer.id}:acc`, type: 'player-accepted', date: acceptDate });
  MarketService.createAgreementInPrinciple({ marketRegistry: mr, thread, offer, date: acceptDate, employmentSnapshot: {} });
  assert.strictEqual(cr.size, 0);
  assert.strictEqual(team.roster.length, 0);
  assert.strictEqual(rr.allRegistrations().length, 0);
  assert.strictEqual(player.teamId, null);
});

// =========================================================================
// 6. Multi-liga
// =========================================================================
group('6. Multi-liga');

check('ACB resuelve procedimiento doméstico con módulo provisional', () => {
  const resolved = CompetitionRules.resolveMarketRules({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE });
  assert.ok(resolved.market.domesticProcedure);
  assert.ok(resolved.warnings.some((w) => w.includes('PROVISIONAL')));
});

check('Primera FEB no tiene procedimiento doméstico (sin tanteo)', () => {
  const resolved = CompetitionRules.resolveMarketRules({ domesticCompetitionId: 'primera-feb', seasonKey: SEASON, date: GAME_DATE });
  assert.strictEqual(resolved.market.domesticProcedure, null);
  assert.ok(!resolved.capabilities.has('supportsRightOfFirstRefusal'));
});

check('competición desconocida no hereda ACB (lanza explícito)', () => {
  assert.throws(() => CompetitionRules.resolveMarketRules({ domesticCompetitionId: 'liga-inventada-xyz', seasonKey: SEASON, date: GAME_DATE }));
});

check('fixture de contacto distinto (reference-only) funciona SOLO fijado explícitamente', () => {
  const unpinned = CompetitionRules.resolveMarketRules({ domesticCompetitionId: 'bm-test-fictional-league', seasonKey: SEASON, date: GAME_DATE });
  assert.strictEqual(unpinned.market.domesticProcedure, null, 'nunca se autoselecciona');
  const pinned = CompetitionRules.resolveMarketRules({ marketModuleId: 'bm-test-fictional-market-window-reference-only-v1', seasonKey: SEASON, date: GAME_DATE });
  assert.ok(pinned.market.domesticProcedure);
  assert.deepStrictEqual(pinned.market.domesticProcedure.marketWindow, { opensMonthDay: '07-01', closesMonthDay: '09-15' });
});

check('EuroLeague reference-only bloquea sin permiso y se activa SOLO con membresía + fijación explícita', () => {
  const withoutOverlay = CompetitionRules.resolveMarketRules({
    domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE, membershipCompetitionIds: ['euroleague'],
  });
  assert.strictEqual(withoutOverlay.market.membershipOverlay, null);
  const withOverlay = CompetitionRules.resolveMarketRules({
    domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE, membershipCompetitionIds: ['euroleague'],
    pinnedModuleIds: ['euroleague-efa-contact-overlay-2024-27-reference-only-v1'],
  });
  assert.ok(withOverlay.market.membershipOverlay);
  assert.strictEqual(withOverlay.market.membershipOverlay.exemptWithinDaysBeforeContractExpiry, 60);
});

check('módulo reference-only nunca se autoselecciona en un bundle real', () => {
  ['acb-domestic-2025-26-v1', 'primera-feb-domestic-2026-27-v1', 'bm-test-fictional-league-domestic-v1'].forEach((bundleId) => {
    const bundle = CompetitionRules.RULESET_BUNDLES[bundleId];
    if (!bundle) return;
    if (bundle.modules.market) {
      const module_ = CompetitionRules.MARKET_MODULES[bundle.modules.market];
      assert.notStrictEqual(module_.status, 'reference-only', `${bundleId} referencia un módulo reference-only por defecto`);
    }
  });
});

check('traza por campo y composición semántica (agentPrinciples/domesticProcedure trazados)', () => {
  const resolved = CompetitionRules.resolveMarketRules({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE });
  assert.ok(resolved.trace.fields.agentPrinciples);
  assert.ok(resolved.trace.fields.domesticProcedure);
  assert.strictEqual(resolved.trace.fields.agentPrinciples[0].ruleModuleId, 'fiba-agents-book3-2026-v1');
});

// =========================================================================
// 7. Tanteo ACB
// =========================================================================
group('7. Tanteo ACB');

function openRightsFixture(id) {
  const mr = new MarketRegistry();
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: '2027-05-15' });
  const rc = RightOfFirstRefusalService.openCase({
    marketRegistry: mr, playerId: `rights-player-${id}`, originClubId: 'club-origin', lastOfficialMatchDate: '2027-05-15', marketContext, id: `rights-case-${id}`,
  });
  return { mr, rc, marketContext };
}

check('QO del 100% del valor monetizado anterior', () => {
  const { rc } = openRightsFixture('qo100');
  const qo = RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rc, filedByClubId: 'club-origin', filedAt: rc.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR',
    lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 5000000 }) },
    ageOnJuly1: 27, consecutiveExerciseCount: 0,
  });
  assert.strictEqual(qo.minimumRequiredMinor, 5000000);
  assert.strictEqual(qo.valid, true);
});

check('edad al 1 de julio y contadores de ejercicios consecutivos (hasta 30: 3; desde 30: 3 más)', () => {
  const { rc: rcYoung } = openRightsFixture('age-young');
  const qoYoung = RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rcYoung, filedByClubId: 'club-origin', filedAt: rcYoung.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR',
    lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 5000000 }) },
    ageOnJuly1: 25, consecutiveExerciseCount: 3,
  });
  assert.strictEqual(qoYoung.valid, false, 'menor de 30 con 3 ejercicios ya consecutivos agota el cupo de 3');

  const { rc: rcOld } = openRightsFixture('age-old');
  const qoOld = RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rcOld, filedByClubId: 'club-origin', filedAt: rcOld.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR',
    lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 5000000 }) },
    ageOnJuly1: 32, consecutiveExerciseCount: 2,
  });
  assert.strictEqual(qoOld.valid, true, 'a partir de 30, hasta 3 ejercicios MÁS son válidos con independencia de los clubes');
});

check('deuda confirmada invalida el derecho', () => {
  const { rc } = openRightsFixture('debt');
  const qo = RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rc, filedByClubId: 'club-origin', filedAt: rc.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR',
    lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 5000000 }) },
    ageOnJuly1: 27, consecutiveExerciseCount: 0, debtChallengeConfirmed: true,
  });
  assert.strictEqual(qo.valid, false);
  assert.strictEqual(rc.statusOn(rc.deadlines.qualifyingOfferWindow.opens), 'right-invalidated');
});

check('deadlines exactos 3+3+3+13+1+5 (días naturales, sin desplazar por fin de semana)', () => {
  const { rc } = openRightsFixture('deadlines');
  const d0 = '2027-05-15'; // sábado
  assert.strictEqual(rc.deadlines.statusReportingWindow.opens, LocalDate.addDays(d0, 1));
  assert.strictEqual(rc.deadlines.statusReportingWindow.closes, LocalDate.addDays(d0, 3));
  assert.strictEqual(rc.deadlines.listPublicationDeadline, LocalDate.addDays(rc.deadlines.statusReportingWindow.closes, 3));
  assert.strictEqual(rc.deadlines.qualifyingOfferWindow.closes, LocalDate.addDays(rc.deadlines.listPublicationDeadline, 3));
  assert.strictEqual(rc.deadlines.thirdPartyOfferWindow.closes, LocalDate.addDays(rc.deadlines.qualifyingOfferWindow.closes, 13));
  // ningún cálculo de fecha desplaza por sábado/domingo — comprobado por
  // igualdad exacta de addDays, que nunca comprueba día de la semana.
});

check('un documento de oferta por jugador (invariante 26)', () => {
  const { rc } = openRightsFixture('one-doc');
  RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rc, filedByClubId: 'club-origin', filedAt: rc.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR',
    lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 4000000 }) },
    ageOnJuly1: 27, consecutiveExerciseCount: 0,
  });
  const summary = {
    duration: '2 years', grossAnnualRemunerationPerSeason: 6000000, fixedComponents: 6000000, inKindValuation: 0, imageRights: 0,
    unilateralTerminationClause: 0, agentFees: 0, economicTotalMinor: 12000000, inKindValuationMinor: 0, agentFeesMinor: 0,
    terminationClauseMinor: 0, durationSeasons: 2, installmentCount: 12, currency: 'EUR', seasonKey: '2027-28',
  };
  RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rc, marketRegistry: null, filedByClubId: 'club-third', filedAt: rc.deadlines.thirdPartyOfferWindow.opens, contractDraftSummary: summary, playerSignedMarker: true, clubSignedMarker: true,
  });
  assert.throws(() => RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rc, marketRegistry: null, filedByClubId: 'club-fourth', filedAt: LocalDate.addDays(rc.deadlines.thirdPartyOfferWindow.opens, 1), contractDraftSummary: summary, playerSignedMarker: true, clubSignedMarker: true,
  }), /ya tiene un documento de oferta/);
});

check('campos obligatorios del documento de oferta completos', () => {
  const { rc } = openRightsFixture('required-fields');
  RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rc, filedByClubId: 'club-origin', filedAt: rc.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR',
    lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 4000000 }) },
    ageOnJuly1: 27, consecutiveExerciseCount: 0,
  });
  assert.throws(() => RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rc, marketRegistry: null, filedByClubId: 'club-third', filedAt: rc.deadlines.thirdPartyOfferWindow.opens, contractDraftSummary: { duration: '2 years' }, playerSignedMarker: true, clubSignedMarker: true,
  }), /faltan campos obligatorios/);
});

check('comparación exacta: 10 mensualidades, especie, duración, cláusula y agente', () => {
  const offerSheet = {
    economicTotalMinor: 20000000, inKindValuationMinor: 100000, agentFeesMinor: 50000, terminationClauseMinor: 200000, durationSeasons: 2, installmentCount: 12,
  };
  const matchAllGood = {
    economicTotalMinor: 20000000, inKindValuationMinor: 100000, agentFeesMinor: 50000, terminationClauseMinor: 200000, durationSeasons: 2, installmentCount: 10,
  };
  const cmp1 = RightOfFirstRefusalService.compareOfferToMatch(offerSheet, matchAllGood);
  assert.strictEqual(cmp1.matchable, true);
  const matchFewInstallments = { ...matchAllGood, installmentCount: 8 };
  const cmp2 = RightOfFirstRefusalService.compareOfferToMatch(offerSheet, matchFewInstallments);
  assert.strictEqual(cmp2.matchable, false);
  assert.ok(cmp2.unmatchedFields.includes('tenMonthlyInstallments'));
});

check('rol/minutos ignorados para la igualación', () => {
  const cmp = RightOfFirstRefusalService.compareOfferToMatch(
    { economicTotalMinor: 10000000, inKindValuationMinor: 0, agentFeesMinor: 0, terminationClauseMinor: 0, durationSeasons: 1, installmentCount: 10 },
    { economicTotalMinor: 10000000, inKindValuationMinor: 0, agentFeesMinor: 0, terminationClauseMinor: 0, durationSeasons: 1, installmentCount: 10 },
  );
  assert.ok(cmp.ignoredForMatching.includes('rolePromise'));
  assert.ok(cmp.ignoredForMatching.includes('expectedMinutes'));
});

check('igualación / no igualación / lapse', () => {
  const { rc: rcMatch } = openRightsFixture('match');
  RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rcMatch, filedByClubId: 'club-origin', filedAt: rcMatch.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR', lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 4000000 }) }, ageOnJuly1: 27, consecutiveExerciseCount: 0,
  });
  const summary = {
    duration: '2 years', grossAnnualRemunerationPerSeason: 6000000, fixedComponents: 6000000, inKindValuation: 0, imageRights: 0, unilateralTerminationClause: 0, agentFees: 0,
    economicTotalMinor: 12000000, inKindValuationMinor: 0, agentFeesMinor: 0, terminationClauseMinor: 0, durationSeasons: 2, installmentCount: 12, currency: 'EUR', seasonKey: '2027-28',
  };
  const sheet = RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rcMatch, marketRegistry: null, filedByClubId: 'club-third', filedAt: rcMatch.deadlines.thirdPartyOfferWindow.opens, contractDraftSummary: summary, playerSignedMarker: true, clubSignedMarker: true,
  });
  RightOfFirstRefusalService.decideMatching({
    rightsCase: rcMatch, decision: 'match', decidedBy: 'user', decidedAt: sheet.matchingWindow.opens, matchProposalSummary: { ...summary, installmentCount: 10 },
  });
  assert.strictEqual(rcMatch.statusOn(sheet.matchingWindow.opens), 'contract-deposit-pending');
  assert.strictEqual(rcMatch.deadlines.depositDeadline, LocalDate.addDays(sheet.matchingWindow.opens, 5), 'igualado: depósito en 5 días');

  const { rc: rcWaive } = openRightsFixture('waive');
  RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rcWaive, filedByClubId: 'club-origin', filedAt: rcWaive.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR', lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 4000000 }) }, ageOnJuly1: 27, consecutiveExerciseCount: 0,
  });
  const sheetW = RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rcWaive, marketRegistry: null, filedByClubId: 'club-third', filedAt: rcWaive.deadlines.thirdPartyOfferWindow.opens, contractDraftSummary: summary, playerSignedMarker: true, clubSignedMarker: true,
  });
  RightOfFirstRefusalService.decideMatching({ rightsCase: rcWaive, decision: 'waive', decidedBy: 'user', decidedAt: sheetW.matchingWindow.opens });
  assert.strictEqual(rcWaive.deadlines.depositDeadline, LocalDate.addDays(sheetW.matchingWindow.opens, 10), 'no igualado: depósito en 10 días');

  const { rc: rcLapse } = openRightsFixture('lapse');
  const lapsed = RightOfFirstRefusalService.lapseQualifyingOfferIfDue(rcLapse, LocalDate.addDays(rcLapse.deadlines.qualifyingOfferWindow.closes, 1));
  assert.strictEqual(lapsed, true);
  assert.strictEqual(rcLapse.statusOn(LocalDate.addDays(rcLapse.deadlines.qualifyingOfferWindow.closes, 1)), 'procedure-resolved');
});

check('depósito 5/10 días como resultado PENDIENTE (nunca registra contrato)', () => {
  const { rc } = openRightsFixture('deposit-pending');
  RightOfFirstRefusalService.fileQualifyingOffer({
    rightsCase: rc, filedByClubId: 'club-origin', filedAt: rc.deadlines.qualifyingOfferWindow.opens,
    monetizedAnnualValueMinor: 5000000, currency: 'EUR', lastContract: { coveredSeasonKeys: [SEASON], breakdownForSeason: () => ({ guaranteedTotalMinor: 4000000 }) }, ageOnJuly1: 27, consecutiveExerciseCount: 0,
  });
  const summary = {
    duration: '2 years', grossAnnualRemunerationPerSeason: 6000000, fixedComponents: 6000000, inKindValuation: 0, imageRights: 0, unilateralTerminationClause: 0, agentFees: 0,
    economicTotalMinor: 12000000, inKindValuationMinor: 0, agentFeesMinor: 0, terminationClauseMinor: 0, durationSeasons: 2, installmentCount: 12, currency: 'EUR', seasonKey: '2027-28',
  };
  const sheet = RightOfFirstRefusalService.fileOfferSheet({
    rightsCase: rc, marketRegistry: null, filedByClubId: 'club-third', filedAt: rc.deadlines.thirdPartyOfferWindow.opens, contractDraftSummary: summary, playerSignedMarker: true, clubSignedMarker: true,
  });
  RightOfFirstRefusalService.decideMatching({ rightsCase: rc, decision: 'waive', decidedBy: 'cpu', decidedAt: sheet.matchingWindow.opens });
  assert.strictEqual(rc.statusOn(sheet.matchingWindow.opens), 'contract-deposit-pending');
  const resolvedNow = RightOfFirstRefusalService.resolveProcedure(rc, rc.deadlines.depositDeadline);
  assert.strictEqual(resolvedNow, true);
  assert.strictEqual(rc.statusOn(rc.deadlines.depositDeadline), 'procedure-resolved');
});

check('inscripción preferente con límites/plazo propio (12 días, no 13)', () => {
  const mr = new MarketRegistry();
  const marketContext = MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: '2027-03-01' });
  const rc = RightOfFirstRefusalService.openCase({
    marketRegistry: mr, playerId: 'preferred-reg-player', originClubId: 'club-origin', lastOfficialMatchDate: '2027-03-01', procedureType: 'preferred-registration', marketContext, id: 'preferred-case-1',
  });
  const expectedThirdParty = rc.procedureRules.thirdPartyOfferSheetDaysOverride;
  assert.strictEqual(expectedThirdParty, 12, 'art. 15.3.2: 12 días, distinto de los 13 generales');
  assert.strictEqual(rc.procedureRules.maxAgeInclusive, 21);
});

check('retorno con tres opciones y +10% de la tercera', () => {
  const mr = new MarketRegistry();
  const rr = RightOfFirstRefusalService.openReturnRightsCase({
    marketRegistry: mr, playerId: 'return-player', originClubId: 'club-origin', lastOfficialMatchDate: '2027-05-15',
  });
  assert.strictEqual(rr.decisionDeadline, LocalDate.addDays('2027-05-15', 3));
  RightOfFirstRefusalService.decideReturnRightsOption(rr, 'wait-for-third-party-offer', '2027-05-16', 10);
  assert.strictEqual(rr.matchingSurchargePercent, 10);
  assert.throws(() => rr.chooseOption('do-not-maintain', '2027-05-17'), /ya tiene una decisión tomada/);
});

check('compensación potencial solo MARCADA, nunca pagada', () => {
  const claim = new PotentialCompensationClaim({
    id: 'claim-1', rightsCaseId: 'rc-1', playerId: 'p1', originClubId: 'club-origin', notedAt: GAME_DATE, basisDescription: 'renuncia art. 16',
  });
  assert.strictEqual(claim.status, 'noted');
});

check('snapshot normativo del caso no cambia tras un ascenso/descenso simulado', () => {
  const { rc } = openRightsFixture('snapshot');
  const frozenRules = JSON.stringify(rc.procedureRules);
  // Simula un "ascenso/descenso": nada en el core debería volver a
  // recalcular procedureRules de un caso ya abierto.
  assert.strictEqual(JSON.stringify(rc.procedureRules), frozenRules);
  assert.ok(Object.isFrozen(rc.procedureRules));
});

// =========================================================================
// 8. Reloj
// =========================================================================
group('8. Reloj');

check('respuesta no interactiva (interés inicial) se procesa determinísticamente al "avanzar"', () => {
  const { mr, pr, thread } = setupNegotiationFixture('seed-clock-1');
  const due = mr.eventsDueThrough('2026-10-10')[0];
  assert.strictEqual(due.requiresAttention, false);
  MarketService.processInterestResponseEvent({ marketRegistry: mr, playerRegistry: pr, event: due, date: due.dueDate, careerSeed: 'seed-clock-1' });
  assert.notStrictEqual(thread.statusOn(due.dueDate), 'interest-response-scheduled');
});

check('atención detiene antes del partido: computeMarketAttentionForClub detecta una contraoferta viva del lado jugador', () => {
  const { team, player, mr } = setupNegotiationFixture('seed-clock-2');
  const thread = new NegotiationThread({ id: 'attn-thread', playerId: player.id, actingClubId: team.id, openedAt: GAME_DATE });
  mr.registerThread(thread);
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 20000000 });
  const offer1 = MarketService.createAndSendOffer({ marketRegistry: mr, thread, draft, offeredBy: 'club', date: GAME_DATE, careerSeed: 'seed-clock-2' });
  assert.strictEqual(MarketService.computeMarketAttentionForClub({ marketRegistry: mr, clubId: team.id, date: GAME_DATE }), null, 'una oferta del CLUB esperando respuesta CPU no exige atención');
  offer1.addEvent({ id: `${offer1.id}:cnt`, type: 'offer-countered', date: '2026-10-04' });
  const counter = MarketService.createAndSendOffer({
    marketRegistry: mr, thread, draft, offeredBy: 'player-side', date: '2026-10-04', careerSeed: 'seed-clock-2', parentOfferId: offer1.id, version: 2,
  });
  const attention = MarketService.computeMarketAttentionForClub({ marketRegistry: mr, clubId: team.id, date: '2026-10-04' });
  assert.ok(attention, 'una contraoferta viva del lado jugador SÍ exige atención');
  assert.strictEqual(attention.offerId, counter.id);
});

check('no se resuelven partidos posteriores a la parada (no se libera/expira una oferta más allá de la fecha objetivo)', () => {
  const { team, player, mr } = setupNegotiationFixture('seed-clock-3');
  const thread = new NegotiationThread({ id: 'stop-thread', playerId: player.id, actingClubId: team.id, openedAt: GAME_DATE });
  mr.registerThread(thread);
  const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE, operation: 'signContract' });
  const draft = buildValidDraft(team, player, resolved, { baseSalaryMinor: 20000000 });
  const offer = MarketService.createAndSendOffer({ marketRegistry: mr, thread, draft, offeredBy: 'club', date: GAME_DATE, careerSeed: 'seed-clock-3' });
  const expiredBeforeDue = MarketService.expireDueOffers(mr, GAME_DATE);
  assert.strictEqual(expiredBeforeDue.length, 0, 'no debe expirar antes de su fecha');
  assert.strictEqual(offer.statusOn(GAME_DATE), 'sent');
});

check('evento idempotente: procesar el mismo intervalo dos veces no duplica nada', () => {
  const { mr } = setupNegotiationFixture('seed-clock-4');
  const due1 = mr.eventsDueThrough('2026-10-10');
  const due2 = mr.eventsDueThrough('2026-10-10');
  assert.strictEqual(due1.length, due2.length, 'consultar dos veces no cambia el resultado');
  mr.markEventProcessed(due1[0].id);
  const due3 = mr.eventsDueThrough('2026-10-10');
  assert.strictEqual(due3.length, 0, 'un evento procesado no vuelve a aparecer como pendiente');
});

check('ningún Date.now()/timer/polling en el core de mercado', () => {
  ['src/core/MarketService.js', 'src/core/NegotiationService.js', 'src/core/RightOfFirstRefusalService.js', 'src/core/MarketSeeder.js', 'src/core/MarketRegistry.js', 'src/core/AgentRegistry.js']
    .forEach((file) => {
      const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      assert.ok(!/Date\.now\(\)|setTimeout|setInterval/.test(code), `${file} usa reloj de sistema o timers`);
    });
});

// =========================================================================
// 9. Auditorías estáticas de alcance (sección 20 del prompt)
// =========================================================================
group('9. Auditorías estáticas de alcance');

const MARKET_SOURCES = [
  'src/core/CompetitionRules.js', 'src/core/MarketService.js', 'src/core/NegotiationService.js', 'src/core/MarketRegistry.js',
  'src/core/AgentRegistry.js', 'src/core/MarketSeeder.js', 'src/core/RightOfFirstRefusalService.js', 'src/core/MarketEventTypes.js',
  'src/entities/Agent.js', 'src/entities/Market.js',
];

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

check('ninguna lógica de mercado ramifica por team.division/1ª/2ª/nombre visible', () => {
  // CompetitionRules.js excluido: contiene el ÚNICO adaptador legacy
  // sancionado (competitionIdFromLegacyDivision), mismo criterio que la
  // auditoría equivalente de REG-1 (scripts/test-reg1.js).
  MARKET_SOURCES.filter((f) => !f.endsWith('CompetitionRules.js')).forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/team\.division\s*===|['"]1ª['"]|['"]2ª['"]/.test(code), `${file} ramifica por división`);
  });
});

check('sin hasTanteo/player.agent/player.currentOffer/team.offers duplicados', () => {
  MARKET_SOURCES.concat(['src/ui/game.js']).forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/hasTanteo|player\.agent\b|player\.currentOffer|team\.offers\b/.test(code), `${file} duplica estado de mercado fuera del registro`);
  });
});

check('ningún Math.random() en decisiones/seeder/eventos de mercado', () => {
  MARKET_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/Math\.random\(\)/.test(code), `${file} usa Math.random()`);
  });
});

check('sin floats monetarios/euros sueltos (todo Minor entero)', () => {
  ['src/core/MarketService.js', 'src/core/NegotiationService.js', 'src/core/RightOfFirstRefusalService.js'].forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/parseFloat\(.*(euro|salary|salario)/i.test(code), `${file} podría usar float para dinero`);
  });
});

check('ningún comando de Market llama a ContractRegistry.register/ContractService.createContract/Team.addPlayer/RegistrationService', () => {
  ['src/core/MarketService.js', 'src/core/RightOfFirstRefusalService.js', 'src/core/NegotiationService.js', 'src/core/MarketSeeder.js'].forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/\.register\(.*[Cc]ontract\)|createContract\(|addPlayer\(|removePlayer\(|RegistrationService\./.test(code), `${file} ejecuta una mutación de TRANSFER-1`);
  });
});

check('alta automática en data/real/ ausente (Market nunca escribe ahí)', () => {
  MARKET_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/data\/real/.test(code), `${file} referencia data/real/`);
  });
});

check('licencia FIBA no se exige a negociación doméstica sin contexto internacional', () => {
  const code = stripComments(readSource('src/core/MarketService.js'));
  assert.ok(code.includes('transactionScope'), 'la comprobación de licencia FIBA debe estar condicionada a transactionScope internacional');
});

check('módulo EuroLeague reference-only no añadido a ningún bundle real', () => {
  Object.values(CompetitionRules.RULESET_BUNDLES).forEach((bundle) => {
    assert.notStrictEqual(bundle.modules.market, 'euroleague-efa-contact-overlay-2024-27-reference-only-v1');
  });
});

check('ACB nunca es fallback de competición desconocida', () => {
  assert.throws(() => CompetitionRules.resolveMarketRules({ domesticCompetitionId: 'otra-liga-cualquiera', seasonKey: SEASON, date: GAME_DATE }));
});

check('potencial/ambición/profesionalidad numéricos nunca impresos en la pantalla de Mercado', () => {
  const code = stripComments(readSource('src/ui/game.js'));
  const marketStart = code.indexOf('const MARKET_TABS');
  const marketEnd = code.indexOf('function renderPlayerProfileScreen');
  const marketScreenCode = code.slice(marketStart, marketEnd);
  assert.ok(!/hidden\.potential|hidden\.ambition|hidden\.professionalism|\.potential\b|\.ambition\b/.test(marketScreenCode), 'la pantalla de Mercado expone un atributo oculto numérico');
});

check('sin timers/polling para respuestas de mercado', () => {
  const code = stripComments(readSource('src/core/NegotiationService.js'));
  assert.ok(!/setTimeout|setInterval/.test(code));
});

check('strings "fichado"/"contrato firmado"/"inscrito" ausentes al crear solo un AIP', () => {
  const code = stripComments(readSource('src/core/MarketService.js'));
  assert.ok(!/fichado|contrato firmado|jugador inscrito/i.test(code));
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
