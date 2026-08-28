#!/usr/bin/env node
// scripts/test-contract1.js
// Verificación CONTRACT-1 (DESIGN.md 9.17) — script Node ad-hoc, mismo
// criterio que test-roster1.js/test-life*.js (no hay framework de tests
// instalado, ver CLAUDE.md). Ejecutar con:
//   node scripts/test-contract1.js
//
// Grupos (sección 13.1 del prompt de CONTRACT-1):
//   1. Resolver temporal y bugs heredados de ROSTER-1
//   2. Composición normativa multi-capa
//   3. Entidad Contract y ContractRegistry
//   4. Dinero y calendario de pagos
//   5. Contratos, cláusulas y menores
//   6. Seeder determinista
//   7. Auditorías estáticas de alcance (sección 13.5)

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { ClubEmploymentContextCatalog } = require('../src/core/ClubEmploymentContextCatalog.js');
const {
  Contract, CLAUSE_TYPE_DEFINITIONS, validateClause, buildPaymentSchedule,
} = require('../src/entities/Contract.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractService } = require('../src/core/ContractService.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { Money } = require('../src/utils/Money.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { padRosterToMinimum, FICTIONAL_FALLBACK_DATA_SOURCE } = require('../src/utils/playerGenerator.js');

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

function birthDateForAge(age, refIso = GAME_DATE) {
  const ref = LocalDate.parse(refIso);
  return new Date(ref.year - age, ref.month - 1, ref.day);
}

function makePlayer(overrides = {}) {
  const player = new Player({
    id: overrides.id,
    firstName: 'Test',
    lastName: overrides.lastName || 'Player',
    birthDate: overrides.birthDate || birthDateForAge(overrides.age !== undefined ? overrides.age : 26),
    positions: { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: 'Base',
    technical: overrides.technical || {},
    physical: { durability: 10, recovery: 10 },
    mental: {},
    hidden: { potential: 150, professionalism: 10, ambition: 10, learningRate: 10, learningPersistence: 10 },
  });
  PD.ensureDevelopmentState(player, CONFIG_BASE, LocalDate.toJsDate(GAME_DATE));
  return player;
}

function makeTeam(clubId, division, rosterSize = 10) {
  const roster = [];
  for (let i = 0; i < rosterSize; i += 1) roster.push(makePlayer({ id: `${clubId}-p${i}` }));
  return new Team({
    id: clubId, name: clubId, city: 'Test', division, roster,
  });
}

const ES_ACB_TEAM = () => makeTeam('team-real-madrid', '1ª');
const AD_ACB_TEAM = () => makeTeam('team-morabanc-andorra', '1ª');
const ES_FEB_TEAM = () => makeTeam('team-palencia-baloncesto', '2ª');

function resolveFor(team, options) {
  return ContractService.resolveRulesForClub(team, Object.assign({
    seasonKey: SEASON, date: GAME_DATE, operation: 'signContract',
  }, options || {}));
}

// Borrador válido mínimo para un perfil resuelto.
function makeDraft(player, team, resolved, overrides = {}) {
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
      totalMinor: baseSalary,
      installmentCount,
      firstDueDate: LocalDate.endOfMonth(window.startDate),
      frequency: employment.payments.frequency || 'monthly',
      currency,
      seasonKey,
    }).forEach((installment) => schedule.push(installment));
  });
  return Object.assign({
    id: overrides.id,
    playerId: player.id,
    clubId: team.id,
    signedDate: overrides.signedDate || startDate,
    startDate,
    endDate,
    coveredSeasonKeys: seasons,
    guaranteeType: 'fully-guaranteed',
    compensation: {
      currency,
      declaredBasis: 'gross',
      seasons: seasons.map((seasonKey) => ({
        seasonKey,
        guaranteedBaseSalaryMinor: baseSalary,
        guaranteedImageRightsMinor: 0,
        guaranteedSalaryInKindMinor: 0,
        signingBonusMinor: 0,
        variableBonuses: [],
        nonSalaryBenefits: [],
        agentCosts: [],
      })),
    },
    paymentPolicy: {
      installmentCount,
      frequency: employment.payments.frequency || 'monthly',
      scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'],
      schedule,
    },
    clauses: overrides.clauses || [],
    declaredDocuments: ['written-contract', ...employment.requiredDocuments],
    provenance: { dataSource: 'test-fixture', isReal: false, generatorVersion: 'test', seedFingerprint: 'test' },
  }, overrides.contract || {});
}

// =====================================================================
group('1. Resolver temporal y bugs heredados de ROSTER-1');
// =====================================================================

check('BUG-ROSTER1-01: un bundle de vigencia FUTURA con versión superior NO se aplica a una temporada pasada', () => {
  // Antes del fix, resolveBundle() elegía simplemente "la versión más alta"
  // de la competición e ignoraba `seasonKey` (ver CHANGELOG CONTRACT-1).
  CompetitionRules.RULESET_BUNDLES['acb-domestic-2030-31-v2-test'] = {
    id: 'acb-domestic-2030-31-v2-test',
    version: 2,
    status: 'verified',
    competitionId: 'acb',
    validity: {
      seasonFrom: '2030-31', seasonTo: '2030-31', dateFrom: null, dateTo: null, carryForwardUntilSuperseded: false,
    },
    organizerCountry: 'ES',
    federationId: 'feb-general',
    collectiveAgreementId: 'acb-abp',
    modules: {
      registration: 'acb-registration-2025-26-v1',
      employmentMembershipOverlay: null,
      market: null,
      transfer: null,
      internationalTransfer: null,
    },
    sourceRefs: [],
  };
  try {
    const resolved = CompetitionRules.resolveRules({ competitionId: 'acb', seasonKey: SEASON, operation: 'buildMatchSquad' });
    assert.notStrictEqual(resolved.bundleId, 'acb-domestic-2030-31-v2-test', 'una norma futura no puede aplicarse a 2026-27');
    assert.strictEqual(resolved.bundleId, 'acb-domestic-2025-26-v1');
  } finally {
    delete CompetitionRules.RULESET_BUNDLES['acb-domestic-2030-31-v2-test'];
  }
});

check('selección exacta por seasonKey: Primera FEB 2026-27 resuelve su módulo verificado sin warnings', () => {
  const resolved = CompetitionRules.resolveRules({ competitionId: 'primera-feb', seasonKey: SEASON, operation: 'buildMatchSquad' });
  assert.strictEqual(resolved.resolutionMode, 'exact');
  assert.deepStrictEqual(resolved.squadRules, { min: 10, max: 12 });
  assert.strictEqual(resolved.warnings.length, 0);
});

check('selección exacta por FECHA: el SMI andorrano aplicable depende del día de la firma', () => {
  const june = CompetitionRules.resolveEmploymentRules({
    employerJurisdictionId: 'AD', domesticCompetitionId: 'acb', seasonKey: SEASON, date: '2026-06-01',
  });
  const october = CompetitionRules.resolveEmploymentRules({
    employerJurisdictionId: 'AD', domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE,
  });
  assert.ok(june.ruleModuleIds.includes('ad-smi-2026-01-v1'));
  assert.ok(october.ruleModuleIds.includes('ad-smi-2026-07-v1'));
  assert.strictEqual(october.employment.effectiveMinimumAnnual.amountMinor, 1882404);
});

check('una actualización de salario mínimo NO se aplica retroactivamente', () => {
  const june = CompetitionRules.resolveEmploymentRules({
    employerJurisdictionId: 'AD', domesticCompetitionId: 'acb', seasonKey: SEASON, date: '2026-06-30',
  });
  assert.strictEqual(june.employment.effectiveMinimumAnnual.ruleModuleId, 'ad-smi-2026-01-v1');
  assert.ok(june.employment.effectiveMinimumAnnual.amountMinor < 1882404);
});

check('norma de vigencia FUTURA no se aplica al pasado (módulo laboral de test v2, vigente desde 2030-31)', () => {
  const resolved = CompetitionRules.resolveEmploymentRules({
    employerJurisdictionId: 'XX', seasonKey: SEASON, date: GAME_DATE,
  });
  assert.ok(resolved.ruleModuleIds.includes('bm-test-jurisdiction-employment-v1'));
  assert.ok(!resolved.ruleModuleIds.includes('bm-test-jurisdiction-employment-v2'));
  assert.strictEqual(resolved.employment.maxTermYears, 2);
});

check('un módulo FIJADO conserva exactamente esa versión', () => {
  const resolved = CompetitionRules.resolveEmploymentRules({
    employerJurisdictionId: 'XX',
    seasonKey: SEASON,
    date: GAME_DATE,
    pinnedModuleIds: ['bm-test-jurisdiction-employment-v2'],
  });
  assert.ok(resolved.ruleModuleIds.includes('bm-test-jurisdiction-employment-v2'));
  assert.strictEqual(resolved.ruleVersions['bm-test-jurisdiction-employment-v2'], 2);
  assert.strictEqual(resolved.resolutionMode, 'pinned');
});

check('una norma DEPRECATED solo resuelve un histórico FIJADO, nunca se autoselecciona', () => {
  assert.throws(
    () => CompetitionRules.resolveEmploymentRules({
      employerJurisdictionId: 'bm-test-deprecated-jur', seasonKey: SEASON, date: GAME_DATE,
    }),
    /ninguna .* cubre .* y ninguna declara carryForwardUntilSuperseded/,
  );
  const pinned = CompetitionRules.resolveEmploymentRules({
    employerJurisdictionId: 'bm-test-deprecated-jur',
    seasonKey: SEASON,
    date: GAME_DATE,
    pinnedModuleIds: ['bm-test-deprecated-v1'],
  });
  assert.ok(pinned.ruleModuleIds.includes('bm-test-deprecated-v1'));
  assert.ok(pinned.warnings.some((w) => w.includes('deprecated')));
});

check('carry-forward SOLO si el módulo lo declara en datos', () => {
  assert.throws(
    () => CompetitionRules.resolveEmploymentRules({
      employerJurisdictionId: 'bm-test-nocarry-jur', seasonKey: SEASON, date: GAME_DATE,
    }),
    /carryForwardUntilSuperseded|no se aplica ningún fallback silencioso/,
  );
});

check('el resultado carry-forward incluye resolutionMode, warning y traza de la versión aplicada', () => {
  const resolved = resolveFor(ES_ACB_TEAM());
  assert.strictEqual(resolved.resolutionMode, 'provisionalCarryForward');
  const acbResolution = resolved.moduleResolutions.find((r) => r.moduleId.startsWith('acb-abp-cba'));
  assert.strictEqual(acbResolution.resolutionMode, 'provisionalCarryForward');
  assert.ok(resolved.warnings.some((w) => w.includes('Continuidad provisional')));
  assert.ok(resolved.trace.moduleIds.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
});

check('una temporada anterior a toda vigencia registrada falla explícito (nunca ACB por defecto)', () => {
  assert.throws(
    () => CompetitionRules.resolveEmploymentRules({
      employerJurisdictionId: 'ES', domesticCompetitionId: 'acb', seasonKey: '1970-71', date: '1970-10-01',
    }),
    /nunca se aplica retroactivamente|ninguna .* cubre/,
  );
});

check('un club desconocido falla explícito y no hereda España ni ACB', () => {
  assert.throws(
    () => ContractService.resolveRulesForClub(makeTeam('team-unknown-club', '1ª'), { seasonKey: SEASON, date: GAME_DATE }),
    /no tiene contexto laboral declarado/,
  );
});

check('BUG-ROSTER1-02: organizerCountry NO es la jurisdicción laboral', () => {
  const acb = CompetitionRules.getCompetitionDefinition('acb');
  assert.strictEqual(acb.organizerCountry, 'ES');
  assert.strictEqual(acb.country, undefined, 'el campo ambiguo `country` ya no existe');
  // El bundle de competición ya no declara jurisdicción laboral.
  const bundle = CompetitionRules.RULESET_BUNDLES['acb-domestic-2025-26-v1'];
  assert.strictEqual(bundle.jurisdictionId, undefined);
  // Y resolver employment sin jurisdicción del empleador es un error.
  assert.throws(
    () => CompetitionRules.resolveEmploymentRules({ domesticCompetitionId: 'acb', seasonKey: SEASON, date: GAME_DATE }),
    /employerJurisdictionId/,
  );
});

check('BUG-ROSTER1-02: MoraBanc Andorra resuelve AD y NUNCA el RD 1006 ni el SMI español', () => {
  const resolved = resolveFor(AD_ACB_TEAM());
  assert.strictEqual(resolved.requestedContext.employerJurisdictionId, 'AD');
  assert.strictEqual(resolved.profileId, 'employment:AD:acb');
  assert.ok(!resolved.ruleModuleIds.includes('es-rd1006-1985-v1'));
  assert.ok(!resolved.ruleModuleIds.includes('es-smi-2026-v1'));
  assert.ok(resolved.ruleModuleIds.includes('ad-labour-31-2018-v1'));
  assert.ok(resolved.ruleModuleIds.includes('ad-smi-2026-07-v1'));
});

check('MoraBanc: el convenio ACB solo entra como capa de MEMBRESÍA, con aviso explícito', () => {
  const resolved = resolveFor(AD_ACB_TEAM());
  assert.ok(resolved.ruleModuleIds.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
  assert.ok(resolved.warnings.some((w) => w.includes('capa de membresía')));
  // El mínimo del convenio ACB (28.000 EUR) NO se le aplica: el suyo es el
  // salario mínimo andorrano.
  assert.strictEqual(resolved.employment.effectiveMinimumAnnual.ruleModuleId, 'ad-smi-2026-07-v1');
});

check('club español en ACB resuelve ES + convenio ACB provisional', () => {
  const resolved = resolveFor(ES_ACB_TEAM());
  assert.strictEqual(resolved.profileId, 'employment:ES:acb');
  assert.ok(resolved.ruleModuleIds.includes('es-rd1006-1985-v1'));
  assert.ok(resolved.ruleModuleIds.includes('es-smi-2026-v1'));
  assert.ok(resolved.ruleModuleIds.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
  assert.strictEqual(resolved.employment.effectiveMinimumAnnual.status, 'provisional');
});

check('club español en Primera FEB resuelve ES SIN convenio ACB (no hereda su mínimo ni sus 10 mensualidades)', () => {
  const resolved = resolveFor(ES_FEB_TEAM());
  assert.strictEqual(resolved.profileId, 'employment:ES:primera-feb');
  assert.ok(resolved.ruleModuleIds.includes('es-rd1006-1985-v1'));
  assert.ok(!resolved.ruleModuleIds.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
  assert.strictEqual(resolved.employment.effectiveMinimumAnnual.amountMinor, 1709400);
  assert.notStrictEqual(resolved.employment.payments.defaultInstallmentCount, 10);
});

check('un módulo extranjero reference-only NO se activa por sí solo', () => {
  ['fr-lnb-ccbp-reference-v1', 'euroleague-spc-2024-reference-v1'].forEach((moduleId) => {
    assert.strictEqual(CompetitionRules.getEmploymentModule(moduleId).status, 'reference-only');
    [ES_ACB_TEAM(), AD_ACB_TEAM(), ES_FEB_TEAM()].forEach((team) => {
      assert.ok(!resolveFor(team).ruleModuleIds.includes(moduleId));
    });
  });
});

check('los 36 clubes reales tienen contexto laboral EXPLÍCITO (35 ES + 1 AD)', () => {
  const contexts = ClubEmploymentContextCatalog.listClubEmploymentContexts();
  assert.strictEqual(contexts.length, 36);
  REAL_DATA_INDEX.forEach((entry) => {
    assert.ok(ClubEmploymentContextCatalog.getClubEmploymentContext(entry.id), `sin contexto: ${entry.id}`);
  });
  assert.strictEqual(contexts.filter((c) => c.employerJurisdictionId === 'ES').length, 35);
  assert.strictEqual(contexts.filter((c) => c.employerJurisdictionId === 'AD').length, 1);
  assert.strictEqual(
    ClubEmploymentContextCatalog.getClubEmploymentContext('team-morabanc-andorra').employerJurisdictionId, 'AD',
  );
});

// =====================================================================
group('2. Composición normativa multi-capa');
// =====================================================================

check('mínimos monetarios concurrentes: se aplica el MAYOR exigible', () => {
  const resolved = resolveFor(ES_ACB_TEAM());
  const amounts = resolved.employment.minimumSalaryRequirements.map((r) => r.annualAmountMinor);
  assert.ok(amounts.includes(1709400) && amounts.includes(2800000));
  assert.strictEqual(resolved.employment.effectiveMinimumAnnual.amountMinor, 2800000);
  assert.ok(resolved.trace.fields.minimumAnnualSalaryMinor.every((t) => t.strategy === 'max'));
});

check('duración máxima concurrente: se aplica el MENOR (FIBA 4 gana a la referencia francesa de 5)', () => {
  const resolved = CompetitionRules.resolveEmploymentRules({
    employerJurisdictionId: 'FR', seasonKey: SEASON, date: GAME_DATE, extraModuleIds: ['fr-lnb-ccbp-reference-v1'],
  });
  const contributions = resolved.trace.fields.maxTermYears.map((t) => t.value);
  assert.ok(contributions.includes(4) && contributions.includes(5), 'ambas capas deben aparecer en la traza');
  assert.strictEqual(resolved.employment.maxTermYears, 4);
  assert.ok(resolved.trace.fields.maxTermYears.every((t) => t.strategy === 'min'));
});

check('periodo de prueba: se aplica el MENOR de los topes (ACB 1 mes gana al máximo general de 3 meses)', () => {
  const acb = resolveFor(ES_ACB_TEAM());
  assert.strictEqual(acb.employment.probation.maxDays, 30);
  assert.strictEqual(acb.employment.probation.decidedBy, 'acb-abp-cba-2018-22-operational-provisional-v1');
  const feb = resolveFor(ES_FEB_TEAM());
  assert.strictEqual(feb.employment.probation.maxDays, 90, 'Primera FEB no hereda el mes del convenio ACB');
});

check('periodo de prueba DINÁMICO: política evaluable por múltiplo salarial (no una constante)', () => {
  const policy = CompetitionRules.getEmploymentModule('bm-test-jurisdiction-employment-v1').rules.probationPolicy;
  assert.strictEqual(policy.type, 'salary-multiple-tiers');
  const low = CompetitionRules.evaluateProbationPolicy(policy, { annualSalaryMinor: 1000000, minimumAnnualMinor: 1000000 });
  const mid = CompetitionRules.evaluateProbationPolicy(policy, { annualSalaryMinor: 4000000, minimumAnnualMinor: 1000000 });
  const high = CompetitionRules.evaluateProbationPolicy(policy, { annualSalaryMinor: 20000000, minimumAnnualMinor: 1000000 });
  assert.deepStrictEqual([low, mid, high], [30, 45, 60]);
});

check('Andorra: la política de prueba es evaluable y su tabla de escalones queda notImplemented (nunca un umbral inventado)', () => {
  const module_ = CompetitionRules.getEmploymentModule('ad-labour-31-2018-v1');
  assert.strictEqual(module_.rules.probationPolicy.type, 'salary-multiple-tiers');
  assert.deepStrictEqual(module_.rules.probationPolicy.tiers, []);
  assert.ok(module_.notImplemented.includes('probationSalaryMultipleTiers'));
  const resolved = resolveFor(AD_ACB_TEAM());
  assert.strictEqual(resolved.employment.probation.maxDays, 60);
  assert.strictEqual(resolved.employment.probation.decidedBy, 'ad-labour-31-2018-v1');
});

check('rangos de cuotas: INTERSECCIÓN (ACB 8-12 ∩ Andorra 12-12 = 12)', () => {
  const acb = resolveFor(ES_ACB_TEAM());
  assert.deepStrictEqual(
    { min: acb.employment.payments.installmentRange.min, max: acb.employment.payments.installmentRange.max },
    { min: 8, max: 12 },
  );
  assert.strictEqual(acb.employment.payments.defaultInstallmentCount, 10);
  const morabanc = resolveFor(AD_ACB_TEAM());
  assert.deepStrictEqual(
    { min: morabanc.employment.payments.installmentRange.min, max: morabanc.employment.payments.installmentRange.max },
    { min: 12, max: 12 },
  );
  assert.strictEqual(morabanc.employment.payments.defaultInstallmentCount, 12);
});

check('Primera FEB: las cuotas se DERIVAN de la periodicidad legal, no del 10 de ACB', () => {
  const feb = resolveFor(ES_FEB_TEAM());
  assert.strictEqual(feb.employment.payments.frequency, 'monthly');
  assert.strictEqual(feb.employment.payments.defaultInstallmentCount, 12);
  assert.deepStrictEqual(feb.employment.payments.installmentRange.sourceRuleIds, ['derivedFromFrequency']);
});

check('documentos y beneficios se UNEN sin duplicar', () => {
  const resolved = resolveFor(ES_ACB_TEAM());
  const documents = resolved.employment.requiredDocuments;
  assert.ok(documents.includes('written-contract') && documents.includes('competition-deposit-copy'));
  assert.strictEqual(new Set(documents).size, documents.length, 'sin duplicados');
  assert.deepStrictEqual(resolved.employment.mandatoryBenefits, ['disability-coverage', 'sports-insurance']);
});

check('prohibiciones de menores se UNEN entre capas', () => {
  const ad = resolveFor(AD_ACB_TEAM());
  assert.deepStrictEqual(ad.employment.minorRules.prohibitions.sort(), ['night-work', 'overtime']);
  assert.ok(ad.employment.minorRules.requiredMarkers.includes('administrative-authorization'));
  assert.ok(ad.employment.minorRules.requiredMarkers.includes('medical-certificate'));
});

check('monedas incompatibles: conflicto EXPLÍCITO, nunca se elige una en silencio', () => {
  const resolved = CompetitionRules.resolveEmploymentRules({
    employerJurisdictionId: 'XX', seasonKey: SEASON, date: GAME_DATE, extraModuleIds: ['bm-test-foreign-currency-v1'],
  });
  assert.deepStrictEqual(resolved.employment.allowedCurrencies, []);
  assert.strictEqual(resolved.conflicts.length >= 1, true);
  assert.ok(resolved.conflicts.some((c) => c.field === 'allowedCurrencies'));
});

check('un conflicto irresoluble impide crear el contrato (no se oculta)', () => {
  const team = makeTeam(ClubEmploymentContextCatalog.TEST_CLUB_ID, '1ª', 3);
  const resolved = ContractService.resolveRulesForClub(team, {
    seasonKey: SEASON, date: GAME_DATE, operation: 'signContract', extraModuleIds: ['bm-test-foreign-currency-v1'],
  });
  const player = team.roster[0];
  const registry = new ContractRegistry();
  assert.throws(
    () => ContractService.createContract({
      draft: makeDraft(player, team, resolveFor(ES_ACB_TEAM()), { contract: { clubId: team.id } }),
      team,
      player,
      registry,
      resolved,
    }),
    /Conflicto normativo sin resolver/,
  );
});

check('cláusula prohibida por una capa vence a "unspecified"', () => {
  const resolved = resolveFor(ES_ACB_TEAM());
  assert.strictEqual(resolved.employment.clausePolicy['automatic-renewal'], 'forbidden');
  assert.strictEqual(resolved.employment.clausePolicy['player-release'], 'allowed');
  assert.strictEqual(resolved.employment.clausePolicy['nba-out'], undefined, 'no indicada = unspecified, nunca permitida por defecto');
});

check('cada campo compuesto conserva TRAZA de procedencia y estrategia', () => {
  const resolved = resolveFor(ES_ACB_TEAM());
  ['maxTermYears', 'probationMaxDays', 'paymentInstallmentRange', 'minimumAnnualSalaryMinor', 'requiredDocuments']
    .forEach((field) => {
      assert.ok(resolved.trace.fields[field] && resolved.trace.fields[field].length, `sin traza: ${field}`);
      resolved.trace.fields[field].forEach((entry) => {
        assert.ok(entry.ruleModuleId, `traza sin módulo en ${field}`);
        assert.ok(entry.strategy, `traza sin estrategia en ${field}`);
      });
    });
});

check('capacidades derivadas: solo aparecen las que tienen política real detrás', () => {
  const resolved = resolveFor(ES_ACB_TEAM());
  assert.ok(resolved.capabilities.has('employmentContractRules'));
  assert.ok(resolved.capabilities.has('minimumSalaryFloor'));
  assert.ok(resolved.capabilities.has('collectiveAgreementOverlay'));
  assert.ok(!resolved.capabilities.has('rightOfFirstRefusal'));
  assert.ok(!resolved.capabilities.has('loanEligible'));
  assert.ok(resolved.notImplemented.includes('market'));
  assert.ok(resolved.notImplemented.includes('registrationLicence'));
  const feb = resolveFor(ES_FEB_TEAM());
  assert.ok(!feb.capabilities.has('collectiveAgreementOverlay'));
});

// =====================================================================
group('3. Entidad Contract y ContractRegistry');
// =====================================================================

function buildValidContract(overrides) {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  return {
    team, player, resolved, contract: new Contract(makeDraft(player, team, resolved, overrides || {})),
  };
}

check('creación válida: el contrato queda con estado derivado "active" en la fecha de juego', () => {
  const { contract } = buildValidContract();
  assert.strictEqual(contract.statusOn(GAME_DATE), 'active');
  assert.strictEqual(contract.coveredSeasonKeys.length, 1);
});

check('un contrato sin playerId/clubId se rechaza', () => {
  assert.throws(() => new Contract({ playerId: 'p1' }), /clubId/);
  assert.throws(() => new Contract({ clubId: 'c1' }), /playerId/);
});

check('ContractRegistry rechaza id duplicado con OTRA instancia y es idempotente con la misma', () => {
  const registry = new ContractRegistry();
  const { contract } = buildValidContract({ id: 'dup-1' });
  registry.register(contract);
  assert.doesNotThrow(() => registry.register(contract));
  assert.strictEqual(registry.size, 1);
  const other = buildValidContract({ id: 'dup-1' }).contract;
  assert.throws(() => registry.register(other), /ya existe un contrato distinto/);
});

check('ContractService rechaza un contrato de un jugador que no está en PlayerRegistry', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const playerRegistry = new PlayerRegistry();
  assert.throws(
    () => ContractService.createContract({
      draft: makeDraft(player, team, resolved), team, player, registry: new ContractRegistry(), playerRegistry, resolved,
    }),
    /no está en PlayerRegistry/,
  );
});

check('ContractService rechaza un contrato cuyo clubId no es el club firmante', () => {
  const team = ES_ACB_TEAM();
  const other = ES_FEB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  assert.throws(
    () => ContractService.createContract({
      draft: makeDraft(player, other, resolved, { contract: { clubId: other.id } }), team, player, registry: new ContractRegistry(), resolved,
    }),
    /se está firmando con/,
  );
});

check('solapamiento total, parcial y por fecha límite INCLUSIVA se rechazan', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const base = new Contract(makeDraft(player, team, resolved, { id: 'ov-base', coveredSeasonKeys: ['2026-27', '2027-28'] }));
  const registry = new ContractRegistry();
  registry.register(base);
  // Total
  assert.throws(() => registry.register(new Contract(makeDraft(player, team, resolved, {
    id: 'ov-total', coveredSeasonKeys: ['2026-27', '2027-28'],
  }))), /solapado/);
  // Parcial
  assert.throws(() => registry.register(new Contract(makeDraft(player, team, resolved, {
    id: 'ov-partial', coveredSeasonKeys: ['2027-28', '2028-29'],
  }))), /solapado/);
  // Límite INCLUSIVO: empezar el mismo día en que termina el anterior solapa.
  assert.throws(() => registry.register(new Contract(makeDraft(player, team, resolved, {
    id: 'ov-edge', coveredSeasonKeys: ['2028-29'], startDate: base.endDate, endDate: '2029-07-31',
  }))), /solapado/);
  // Justo al día siguiente NO solapa.
  assert.doesNotThrow(() => registry.register(new Contract(makeDraft(player, team, resolved, {
    // CYCLE-1 (BUG-CYCLE1-06): la ventana civil de temporada pasa a ser
    // 1-ago .. 31-jul, así que "el día siguiente al fin del anterior" es el
    // 1 de agosto — mismo criterio semántico exacto, derivado ahora del
    // propio `base.endDate` en vez de un literal.
    id: 'ov-ok', coveredSeasonKeys: ['2028-29'], startDate: LocalDate.addDays(base.endDate, 1), endDate: '2029-07-31',
  }))));
});

check('dos registros son independientes (no hay singleton oculto)', () => {
  const a = new ContractRegistry();
  const b = new ContractRegistry();
  a.register(buildValidContract({ id: 'reg-a' }).contract);
  assert.strictEqual(a.size, 1);
  assert.strictEqual(b.size, 0);
});

check('la MISMA instancia se devuelve por id, por jugador y por club', () => {
  const registry = new ContractRegistry();
  const { contract } = buildValidContract({ id: 'same-1' });
  registry.register(contract);
  assert.strictEqual(registry.get('same-1'), contract);
  assert.strictEqual(registry.forPlayer(contract.playerId)[0], contract);
  assert.strictEqual(registry.forClub(contract.clubId)[0], contract);
  assert.strictEqual(registry.currentForPlayer(contract.playerId, GAME_DATE), contract);
});

check('el histórico de un jugador queda ORDENADO de forma estable', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const registry = new ContractRegistry();
  const second = new Contract(makeDraft(player, team, resolved, { id: 'h-2', coveredSeasonKeys: ['2028-29'] }));
  const first = new Contract(makeDraft(player, team, resolved, { id: 'h-1', coveredSeasonKeys: ['2026-27'] }));
  registry.register(second);
  registry.register(first);
  assert.deepStrictEqual(registry.forPlayer(player.id).map((c) => c.id), ['h-1', 'h-2']);
});

check('estados derivados: pending / active / expired / terminated / void', () => {
  const { contract } = buildValidContract({ coveredSeasonKeys: ['2026-27'] });
  assert.strictEqual(contract.statusOn('2026-07-31'), 'pending');
  assert.strictEqual(contract.statusOn('2026-08-01'), 'active');
  assert.strictEqual(contract.statusOn('2027-07-31'), 'active', 'endDate es INCLUSIVA');
  assert.strictEqual(contract.statusOn('2027-08-01'), 'expired');
  const terminated = buildValidContract({ coveredSeasonKeys: ['2026-27'] }).contract;
  terminated.addLifecycleEvent({ type: 'terminated', date: '2026-12-01' });
  assert.strictEqual(terminated.statusOn('2026-11-30'), 'active');
  assert.strictEqual(terminated.statusOn('2026-12-01'), 'terminated');
  const voided = buildValidContract({ coveredSeasonKeys: ['2026-27'] }).contract;
  voided.addLifecycleEvent({ type: 'voided', date: '2026-08-01' });
  assert.strictEqual(voided.statusOn(GAME_DATE), 'void');
});

check('"expira pronto" NO existe como estado persistido del contrato', () => {
  const { contract } = buildValidContract();
  const json = JSON.stringify(contract.toJSON());
  assert.ok(!/expiring|expiresSoon|expiraPronto/i.test(json));
  assert.ok(!Object.prototype.hasOwnProperty.call(contract, 'status'), 'el estado se deriva, no se guarda');
});

check('un contrato expirado SIGUE en el registro (historial consultable)', () => {
  const registry = new ContractRegistry();
  const { contract } = buildValidContract({ id: 'exp-1', coveredSeasonKeys: ['2026-27'] });
  registry.register(contract);
  assert.strictEqual(contract.statusOn('2030-01-01'), 'expired');
  assert.strictEqual(registry.get('exp-1'), contract);
  assert.strictEqual(registry.forPlayer(contract.playerId).length, 1);
  assert.strictEqual(registry.currentForPlayer(contract.playerId, '2030-01-01'), null);
});

check('validateIntegrity detecta un afiliado sin contrato y un contrato de otro club', () => {
  const team = ES_ACB_TEAM();
  const playerRegistry = new PlayerRegistry();
  playerRegistry.registerMany(team.roster);
  const registry = new ContractRegistry();
  const report = registry.validateIntegrity({ playerRegistry, teams: [team], date: GAME_DATE });
  assert.strictEqual(report.valid, false);
  assert.ok(report.errors.some((e) => e.includes('no tiene ningún contrato vigente')));
});

// =====================================================================
group('4. Dinero y calendario de pagos');
// =====================================================================

check('solo se admiten enteros no negativos en unidad mínima', () => {
  assert.ok(Money.isValidAmountMinor(0));
  assert.ok(Money.isValidAmountMinor(2800000));
  assert.ok(!Money.isValidAmountMinor(1234.5));
  assert.ok(!Money.isValidAmountMinor(NaN));
  assert.ok(!Money.isValidAmountMinor(Infinity));
  assert.ok(!Money.isValidAmountMinor(-1));
  assert.ok(!Money.isValidAmountMinor('2800000'));
  assert.throws(() => Money.requireAmountMinor(10.5, 'x'), /entero no negativo/);
});

check('la moneda debe ser un código ISO 4217 registrado', () => {
  assert.throws(() => Money.requireCurrency('PESETA'), /no soportada/);
  assert.strictEqual(Money.requireCurrency('EUR'), 'EUR');
});

check('sumar importes de monedas distintas lanza', () => {
  assert.throws(
    () => Money.sum([{ amountMinor: 100, currency: 'EUR' }, { amountMinor: 100, currency: 'GBP' }]),
    /monedas distintas/,
  );
});

check('un contrato no puede mezclar monedas entre sus componentes', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const draft = makeDraft(player, team, resolved);
  draft.compensation.seasons[0].variableBonuses = [{ id: 'b1', amountMinor: 100000, currency: 'GBP' }];
  assert.throws(() => new Contract(draft), /moneda GBP, distinta de la del contrato/);
});

check('los totales son DERIVADOS por componentes (no un campo duplicado)', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const draft = makeDraft(player, team, resolved, { baseSalaryMinor: 5000000 });
  draft.compensation.seasons[0].guaranteedImageRightsMinor = 1000000;
  draft.compensation.seasons[0].guaranteedSalaryInKindMinor = 500000;
  draft.compensation.seasons[0].signingBonusMinor = 250000;
  draft.compensation.seasons[0].variableBonuses = [
    { id: 'b1', type: 'team-performance-bonus', amountMinor: 300000 },
    { id: 'b2', type: 'individual-performance-bonus', amountMinor: 200000 },
  ];
  draft.compensation.seasons[0].nonSalaryBenefits = [{ id: 'car', amountMinor: 120000, valued: true }];
  draft.compensation.seasons[0].agentCosts = [{ id: 'agent', amountMinor: 400000, paidBy: 'club' }];
  const contract = new Contract(draft);
  const breakdown = contract.breakdownForSeason(SEASON);
  assert.strictEqual(breakdown.guaranteedCashMinor, 5000000 + 1000000 + 250000);
  assert.strictEqual(breakdown.guaranteedTotalMinor, 5000000 + 1000000 + 250000 + 500000);
  assert.strictEqual(breakdown.variableMaxMinor, 500000);
  assert.strictEqual(breakdown.benefitsValueMinor, 120000);
  assert.strictEqual(breakdown.agentCostsMinor, 400000);
  assert.strictEqual(JSON.stringify(contract.toJSON()).includes('"totalMinor"'), false);
});

check('el reparto en cuotas es EXACTO al céntimo (8, 10 y 12 cuotas)', () => {
  [8, 10, 12].forEach((count) => {
    const total = 1000001; // no divisible: fuerza reparto de resto
    const schedule = buildPaymentSchedule({
      totalMinor: total, installmentCount: count, firstDueDate: '2026-07-31', frequency: 'monthly', currency: 'EUR', seasonKey: SEASON,
    });
    assert.strictEqual(schedule.length, count);
    assert.strictEqual(schedule.reduce((acc, i) => acc + i.amountMinor, 0), total);
    schedule.forEach((installment) => assert.ok(Number.isInteger(installment.amountMinor)));
  });
});

check('el calendario respeta fin de mes y año bisiesto', () => {
  const schedule = buildPaymentSchedule({
    totalMinor: 1200000, installmentCount: 12, firstDueDate: '2027-07-31', frequency: 'monthly', currency: 'EUR',
  });
  const dates = schedule.map((i) => i.dueDate);
  assert.strictEqual(dates[0], '2027-07-31');
  assert.strictEqual(dates[1], '2027-08-31');
  assert.strictEqual(dates[2], '2027-09-30');
  assert.strictEqual(dates[7], '2028-02-29', '2028 es bisiesto');
  assert.strictEqual(dates[11], '2028-06-30');
});

check('LocalDate no desplaza el día por husos horarios', () => {
  assert.strictEqual(LocalDate.fromJsDate(new Date(2026, 9, 3)), '2026-10-03');
  assert.strictEqual(LocalDate.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(LocalDate.addMonths('2028-01-31', 1), '2028-02-29');
  assert.strictEqual(LocalDate.daysBetween('2026-07-01', '2027-07-01'), 365);
});

check('el calendario del contrato cuadra exactamente con la remuneración incluida en pagos', () => {
  const { contract } = buildValidContract();
  const report = contract.validatePaymentScheduleIntegrity();
  assert.deepStrictEqual(report, { valid: true, errors: [] });
  const sum = contract.scheduleForSeason(SEASON).reduce((acc, i) => acc + i.amountMinor, 0);
  assert.strictEqual(sum, contract.scheduledAmountForSeason(SEASON));
});

check('un número de cuotas fuera del rango resuelto se rechaza', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const draft = makeDraft(player, team, resolved, { installmentCount: 20 });
  assert.throws(
    () => ContractService.createContract({
      draft, team, player, registry: new ContractRegistry(), resolved,
    }),
    /queda fuera del rango resuelto 8-12/,
  );
});

check('toda cantidad declara base gross/net/estimated-gross', () => {
  assert.deepStrictEqual(Money.AMOUNT_BASES, ['gross', 'net', 'estimated-gross']);
  assert.throws(() => Money.requireBasis('bruto'), /base de importe inválida/);
  const { contract } = buildValidContract();
  assert.strictEqual(contract.compensation.declaredBasis, 'gross');
});

check('el salario EN ESPECIE no reduce el mínimo monetario cuando la capa lo prohíbe', () => {
  const team = ES_FEB_TEAM(); // perfil ES sin convenio ACB: mínimo = SMI 17.094 EUR
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const draft = makeDraft(player, team, resolved, { baseSalaryMinor: 1000000 });
  draft.compensation.seasons[0].guaranteedSalaryInKindMinor = 1000000; // especie que "completaría" el mínimo
  const contract = new Contract(draft);
  const validation = ContractService.validateContractAgainstRules(contract, resolved, { player });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('no alcanza el mínimo')));
  // Con el mismo importe TOTAL pero en dinero, sí cumple.
  const cashDraft = makeDraft(player, team, resolved, { baseSalaryMinor: 2000000 });
  const cashContract = new Contract(cashDraft);
  assert.strictEqual(ContractService.validateContractAgainstRules(cashContract, resolved, { player }).valid, true);
});

check('mínimos por perfil: ACB provisional 28.000 EUR, España SMI 17.094 EUR, Andorra 18.824,04 EUR', () => {
  assert.strictEqual(resolveFor(ES_ACB_TEAM()).employment.effectiveMinimumAnnual.amountMinor, 2800000);
  assert.strictEqual(resolveFor(ES_FEB_TEAM()).employment.effectiveMinimumAnnual.amountMinor, 1709400);
  assert.strictEqual(resolveFor(AD_ACB_TEAM()).employment.effectiveMinimumAnnual.amountMinor, 1882404);
});

check('formatear importes es SOLO presentación (Intl), nunca cálculo', () => {
  assert.strictEqual(Money.format(2800000, 'EUR', { compact: true }).replace(/ /g, ' '), '28.000 €');
  assert.strictEqual(Money.toMajorUnits(2800000, 'EUR'), 28000);
});

// =====================================================================
group('5. Contratos, cláusulas y menores');
// =====================================================================

check('el máximo FIBA de cuatro años se aplica; un fixture de cinco se rechaza', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  assert.strictEqual(resolved.employment.maxTermYears, 4);
  const fourSeasons = ['2026-27', '2027-28', '2028-29', '2029-30'];
  const okContract = new Contract(makeDraft(player, team, resolved, { coveredSeasonKeys: fourSeasons }));
  assert.strictEqual(ContractService.validateContractAgainstRules(okContract, resolved, { player }).valid, true);
  const fiveSeasons = fourSeasons.concat('2030-31');
  const longContract = new Contract(makeDraft(player, team, resolved, { coveredSeasonKeys: fiveSeasons }));
  const validation = ContractService.validateContractAgainstRules(longContract, resolved, { player });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('supera el máximo resuelto de 4 años')));
});

check('un contrato real de UNA temporada expira correctamente y no se renueva solo', () => {
  const registry = new ContractRegistry();
  const { contract } = buildValidContract({ id: 'one-season', coveredSeasonKeys: ['2026-27'] });
  registry.register(contract);
  assert.strictEqual(contract.statusOn('2027-07-31'), 'active');
  assert.strictEqual(contract.statusOn('2027-08-01'), 'expired');
  assert.strictEqual(registry.currentForPlayer(contract.playerId, '2027-08-01'), null);
  assert.strictEqual(registry.size, 1, 'expirar no borra ni sustituye el contrato');
});

check('el periodo de prueba debe caber en la vigencia y respetar el tope resuelto', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const draft = makeDraft(player, team, resolved);
  draft.probation = {
    enabled: true, startDate: '2026-08-01', endDate: '2026-10-31', durationDays: 92, legalBasisRuleIds: [],
  };
  const contract = new Contract(draft);
  const validation = ContractService.validateContractAgainstRules(contract, resolved, { player });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('supera el máximo resuelto de 30 días')));
  // Fuera de la vigencia, el propio constructor lo rechaza.
  const outsideDraft = makeDraft(player, team, resolved);
  outsideDraft.probation = {
    enabled: true, startDate: '2026-07-01', endDate: '2026-07-31', durationDays: 30, legalBasisRuleIds: [],
  };
  assert.throws(() => new Contract(outsideDraft), /DENTRO de la vigencia/);
});

check('no se puede crear un contrato laboral ordinario para un menor de 16 años', () => {
  const team = ES_ACB_TEAM();
  const child = makePlayer({ id: 'child-15', age: 15, birthDate: birthDateForAge(15, '2026-07-01') });
  const resolved = resolveFor(team);
  const contract = new Contract(makeDraft(child, team, resolved));
  const validation = ContractService.validateContractAgainstRules(contract, resolved, { player: child });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('menor de 16 años')));
  assert.throws(
    () => ContractService.createContract({
      draft: makeDraft(child, team, resolved), team, player: child, registry: new ContractRegistry(), resolved,
    }),
    /menor de 16 años/,
  );
});

check('un menor español de 16-17 exige marcador de consentimiento', () => {
  const team = ES_ACB_TEAM();
  const teenager = makePlayer({ id: 'teen-17', birthDate: birthDateForAge(17, '2026-07-01') });
  const resolved = resolveFor(team);
  const noConsent = new Contract(makeDraft(teenager, team, resolved));
  const invalid = ContractService.validateContractAgainstRules(noConsent, resolved, { player: teenager });
  assert.strictEqual(invalid.valid, false);
  assert.ok(invalid.errors.some((e) => e.includes('guardian-consent')));
  const withConsentDraft = makeDraft(teenager, team, resolved);
  withConsentDraft.minorProtections = { ageAtSigning: 17, markers: ['guardian-consent'], markerStatus: 'simulated-recorded', allowances: [] };
  const valid = ContractService.validateContractAgainstRules(new Contract(withConsentDraft), resolved, { player: teenager });
  assert.strictEqual(valid.valid, true);
});

check('un menor andorrano exige ADEMÁS autorización administrativa y certificado médico', () => {
  const team = AD_ACB_TEAM();
  const teenager = makePlayer({ id: 'teen-ad-17', birthDate: birthDateForAge(17, '2026-07-01') });
  const resolved = resolveFor(team);
  const draft = makeDraft(teenager, team, resolved);
  draft.minorProtections = { ageAtSigning: 17, markers: ['guardian-consent'], markerStatus: 'simulated-recorded', allowances: [] };
  const validation = ContractService.validateContractAgainstRules(new Contract(draft), resolved, { player: teenager });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('administrative-authorization')));
  assert.ok(validation.errors.some((e) => e.includes('medical-certificate')));
});

check('un menor no puede habilitar trabajo nocturno ni horas extraordinarias', () => {
  const team = ES_ACB_TEAM();
  const teenager = makePlayer({ id: 'teen-night', birthDate: birthDateForAge(16, '2026-07-01') });
  const resolved = resolveFor(team);
  const draft = makeDraft(teenager, team, resolved);
  draft.minorProtections = {
    ageAtSigning: 16, markers: ['guardian-consent'], markerStatus: 'simulated-recorded', allowances: ['night-work'],
  };
  const validation = ContractService.validateContractAgainstRules(new Contract(draft), resolved, { player: teenager });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('night-work')));
});

check('cláusula tipada válida: player-release con importe y titular correctos', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const draft = makeDraft(player, team, resolved, {
    clauses: [{
      id: 'c1', type: 'player-release', holder: 'player', amount: { amountMinor: 50000000, currency: 'EUR', basis: 'gross' }, support: 'modeled-only', status: 'simulated',
    }],
  });
  const contract = new Contract(draft);
  assert.strictEqual(contract.clauses.length, 1);
  assert.strictEqual(ContractService.validateContractAgainstRules(contract, resolved, { player }).valid, true);
});

check('una cláusula de tipo DESCONOCIDO se rechaza (nunca se acepta en silencio)', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  assert.throws(
    () => new Contract(makeDraft(player, team, resolved, {
      clauses: [{ id: 'x', type: 'clausula-magica', holder: 'player', support: 'modeled-only' }],
    })),
    /Tipo de cláusula desconocido/,
  );
});

check('una cláusula no sustentada por ninguna capa (unspecified) se rechaza', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const contract = new Contract(makeDraft(player, team, resolved, {
    clauses: [{
      id: 'c-nba', type: 'nba-out', holder: 'player', window: { fromDate: '2026-07-01', toDate: '2026-08-31' }, support: 'modeled-only', status: 'simulated',
    }],
  }));
  const validation = ContractService.validateContractAgainstRules(contract, resolved, { player });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('unspecified')));
});

check('una cláusula PROHIBIDA por el perfil se rechaza', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const contract = new Contract(makeDraft(player, team, resolved, {
    clauses: [{ id: 'c-auto', type: 'automatic-renewal', holder: 'club', support: 'modeled-only', status: 'simulated' }],
  }));
  const validation = ContractService.validateContractAgainstRules(contract, resolved, { player });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('PROHIBIDA')));
});

check('el derecho de tanteo NO existe como cláusula ni como booleano', () => {
  assert.ok(!Object.keys(CLAUSE_TYPE_DEFINITIONS).some((type) => /tanteo|first-refusal/i.test(type)));
  const { contract } = buildValidContract();
  const json = JSON.stringify(contract.toJSON());
  assert.ok(!/hasTanteo|tanteo/i.test(json));
});

check('la cláusula de rescisión del jugador NO es un transfer fee', () => {
  const definition = CLAUSE_TYPE_DEFINITIONS['player-release'];
  assert.strictEqual(definition.allowedHolders.join(','), 'player');
  assert.ok(/distinto de un traspaso/i.test(definition.notes));
  assert.ok(!Object.keys(CLAUSE_TYPE_DEFINITIONS).includes('transfer-fee'));
});

check('toda cláusula es modeled-only: CONTRACT-1 no ejecuta ninguna', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const contract = new Contract(makeDraft(player, team, resolved, {
    clauses: [{
      id: 'c1', type: 'player-release', holder: 'player', amount: { amountMinor: 50000000, currency: 'EUR' }, support: 'modeled-only', status: 'simulated',
    }],
  }));
  contract.clauses.forEach((clause) => assert.strictEqual(clause.support, 'modeled-only'));
  assert.strictEqual(typeof contract.exerciseClause, 'undefined');
  assert.strictEqual(typeof ContractService.exerciseClause, 'undefined');
  assert.strictEqual(typeof ContractService.terminateContract, 'undefined');
  assert.strictEqual(typeof ContractService.renewContract, 'undefined');
});

check('validateClause exige ventana de ejercicio en las opciones', () => {
  const result = validateClause({ id: 'o1', type: 'club-option', holder: 'club', support: 'modeled-only' }, { currency: 'EUR' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('ventana de ejercicio')));
});

check('el DTO comparable para MARKET-1 se DERIVA del contrato y no ejecuta nada', () => {
  const team = ES_ACB_TEAM();
  const player = team.roster[0];
  const resolved = resolveFor(team);
  const contract = new Contract(makeDraft(player, team, resolved, {
    baseSalaryMinor: 8000000,
    clauses: [{
      id: 'c1', type: 'player-release', holder: 'player', amount: { amountMinor: 50000000, currency: 'EUR' }, support: 'modeled-only', status: 'simulated',
    }],
  }));
  const offer = contract.toComparableOffer(SEASON);
  assert.strictEqual(offer.guaranteedFixedMinor, 8000000);
  assert.strictEqual(offer.buyoutMinor, 50000000);
  assert.ok(offer.notImplemented.includes('rightOfFirstRefusal'));
});

check('un contrato firmado congela sus módulos: un ascenso posterior no reescribe su normativa', () => {
  const team = ES_FEB_TEAM();
  const player = team.roster[0];
  const playerRegistry = new PlayerRegistry();
  playerRegistry.registerMany(team.roster);
  const registry = new ContractRegistry();
  const resolved = resolveFor(team);
  const { contract } = ContractService.createContract({
    draft: makeDraft(player, team, resolved), team, player, registry, playerRegistry, resolved,
  });
  const frozenModules = [...contract.signingContext.ruleModuleIds];
  assert.ok(!frozenModules.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
  // El club asciende a ACB: el contrato ya firmado NO cambia.
  team.division = '1ª';
  const afterPromotion = ContractService.resolveRulesForClub(team, { seasonKey: '2027-28', date: '2027-07-01' });
  assert.ok(afterPromotion.ruleModuleIds.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
  assert.deepStrictEqual([...contract.signingContext.ruleModuleIds], frozenModules);
  // Y una firma NUEVA sí usa el contexto nuevo.
  const newPlayer = makePlayer({ id: 'post-promotion' });
  playerRegistry.register(newPlayer);
  team.addPlayer(newPlayer);
  const { contract: newContract } = ContractService.createContract({
    draft: makeDraft(newPlayer, team, afterPromotion, { coveredSeasonKeys: ['2027-28'], baseSalaryMinor: 5000000 }),
    team,
    player: newPlayer,
    registry,
    playerRegistry,
    resolved: afterPromotion,
  });
  assert.ok(newContract.signingContext.ruleModuleIds.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
});

// Helpers de auditoría estática (usados también por el grupo 6).
const REPO_ROOT = path.join(__dirname, '..');
const CONTRACT_SOURCES = [
  'src/entities/Contract.js',
  'src/core/ContractRegistry.js',
  'src/core/ContractService.js',
  'src/core/ContractSeeder.js',
  'src/core/ClubEmploymentContextCatalog.js',
  'src/core/CompetitionRules.js',
  'src/utils/Money.js',
  'src/utils/LocalDate.js',
];
function readSource(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}
// Comentarios fuera: las auditorías miran CÓDIGO, no prosa explicativa.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}


// =====================================================================
group('6. Seeder determinista y calibración');
// =====================================================================

function buildRealWorld() {
  const refDate = LocalDate.toJsDate(GAME_DATE);
  const teams = REAL_DATA_INDEX.map((entry) => {
    const teamData = REAL_DATA_TEAMS[entry.id];
    const roster = teamData.roster.map((playerData) => {
      const { dataSource, ...fields } = playerData;
      const player = new Player(fields);
      player.dataSource = dataSource || null;
      PD.ensureDevelopmentState(player, CONFIG_BASE, refDate);
      return player;
    });
    const squadRules = CompetitionRules.resolveRules({
      competitionId: CompetitionRules.competitionIdFromLegacyDivision(teamData.division),
      seasonKey: SEASON,
      date: refDate,
      operation: 'buildMatchSquad',
    }).squadRules;
    padRosterToMinimum(roster, squadRules.min, { minAge: 18, maxAge: 34, referenceDate: refDate });
    return new Team({ ...teamData, roster });
  });
  const playerRegistry = new PlayerRegistry();
  teams.forEach((team) => playerRegistry.registerMany(team.roster));
  const registry = new ContractRegistry();
  const result = ContractSeeder.seedContractsForTeams({
    teams, seasonKey: SEASON, date: GAME_DATE, registry, playerRegistry, config: CONFIG_BASE,
  });
  return {
    teams, playerRegistry, registry, warnings: result.warnings, calibration: result.calibration,
  };
}

const world = buildRealWorld();

check('todos los jugadores afiliados de los 36 clubes reciben exactamente un contrato vigente', () => {
  const total = world.teams.reduce((acc, team) => acc + team.roster.length, 0);
  assert.strictEqual(world.registry.size, total);
  const report = world.registry.validateIntegrity({
    playerRegistry: world.playerRegistry, teams: world.teams, date: GAME_DATE,
  });
  assert.deepStrictEqual(report.errors, []);
  assert.strictEqual(report.valid, true);
});

check('el relleno ficticio de plantillas de Primera FEB también recibe contrato', () => {
  const fallbackPlayers = world.teams
    .reduce((acc, team) => acc.concat(team.roster.filter((p) => p.dataSource === FICTIONAL_FALLBACK_DATA_SOURCE)), []);
  assert.ok(fallbackPlayers.length > 0, 'el snapshot del bundle FEB debe seguir teniendo clubes por debajo del mínimo');
  fallbackPlayers.forEach((player) => {
    assert.ok(world.registry.currentForPlayer(player.id, GAME_DATE), `sin contrato: ${player.id}`);
  });
});

check('dos ejecuciones del seeder producen contratos IDÉNTICOS (determinismo)', () => {
  const a = buildRealWorld();
  const b = buildRealWorld();
  const serialize = (w) => w.registry.forClub('team-real-madrid').map((c) => ({
    id: c.id,
    playerId: c.playerId,
    total: c.breakdownForSeason(SEASON).guaranteedTotalMinor,
    start: c.startDate,
    end: c.endDate,
    clauses: c.clauses.map((cl) => [cl.type, cl.amount ? cl.amount.amountMinor : null]),
  }));
  assert.deepStrictEqual(serialize(a), serialize(b));
});

check('el seeder NO usa Math.random ni atributos ocultos', () => {
  const source = stripComments(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ContractSeeder.js'), 'utf8'));
  assert.ok(!/Math\.random/.test(source), 'ContractSeeder no puede usar Math.random');
  ['potential', 'ambition', 'professionalism', 'learningRate', 'learningPersistence', '\\.hidden'].forEach((attribute) => {
    assert.ok(!new RegExp(attribute).test(source), `el seeder no puede leer el atributo oculto ${attribute}`);
  });
  assert.ok(!/reputation|\.budget/.test(source), 'el seeder no puede usar reputation ni budget del dataset');
});

check('todos los contratos del bootstrap se identifican como SIMULADOS', () => {
  world.registry.all().forEach((contract) => {
    // CYCLE-1 (DESIGN.md 9.22): procedencia/versión NUEVAS del seeder — la
    // distribución de duración pasa a ser variada y determinista, así que
    // los contratos del bootstrap ya no son los de `contract-seeder-v1`.
    assert.strictEqual(contract.provenance.dataSource, 'simulated-contract-v2');
    assert.strictEqual(contract.provenance.isReal, false);
    assert.strictEqual(contract.provenance.generatorVersion, 'contract-seeder-v2');
    assert.ok(contract.provenance.seedFingerprint);
  });
  assert.strictEqual(
    ContractSeeder.SIMULATED_CONTRACT_WARNING,
    'Contrato simulado para esta partida; no es un dato contractual real.',
  );
});

check('ningún salario baja del mínimo normativo del perfil de su club', () => {
  world.teams.forEach((team) => {
    const resolved = ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE });
    const floor = resolved.employment.effectiveMinimumAnnual.amountMinor;
    world.registry.forClubInSeason(team.id, SEASON).forEach((contract) => {
      const counted = contract.salaryForMinimumCheck(SEASON, resolved.employment.effectiveMinimumAnnual
        ? ['guaranteedBaseSalary', 'guaranteedImageRights'] : []);
      assert.ok(counted >= floor, `${team.id}: ${counted} < ${floor}`);
    });
  });
});

check('la nómina de cada club cuadra EXACTAMENTE con el objetivo de calibración', () => {
  world.teams.forEach((team) => {
    const payroll = ContractService.guaranteedPayrollForClub(world.registry, team.id, SEASON);
    assert.ok(Number.isInteger(payroll.amountMinor));
    // Todos los importes generados son múltiplos de 1.000 EUR.
    assert.strictEqual(payroll.amountMinor % ContractSeeder.PRESENTATION_UNIT_MINOR, 0);
  });
});

check('los rangos de nómina simulada se mantienen dentro del perfil económico declarado', () => {
  const byCompetition = { acb: [], 'primera-feb': [] };
  world.teams.forEach((team) => {
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
    byCompetition[competitionId].push(ContractService.guaranteedPayrollForClub(world.registry, team.id, SEASON).amountMinor);
  });
  Object.entries(byCompetition).forEach(([competitionId, payrolls]) => {
    const profile = ContractSeeder.getEconomicProfile(competitionId);
    payrolls.forEach((amount) => {
      assert.ok(amount >= profile.lowPayrollMinor * 0.98, `${competitionId}: nómina ${amount} por debajo del rango`);
      assert.ok(amount <= profile.highPayrollMinor * 1.02, `${competitionId}: nómina ${amount} por encima del rango`);
    });
  });
});

check('no hay outliers absurdos: ningún salario individual supera la nómina de su club ni es cero', () => {
  world.teams.forEach((team) => {
    const payroll = ContractService.guaranteedPayrollForClub(world.registry, team.id, SEASON).amountMinor;
    world.registry.forClubInSeason(team.id, SEASON).forEach((contract) => {
      const total = contract.breakdownForSeason(SEASON).guaranteedTotalMinor;
      assert.ok(total > 0);
      assert.ok(total <= payroll);
    });
  });
});

check('monotonía razonable: en un mismo club y franja de edad, más TMB implica no menos salario', () => {
  const team = world.teams.find((t) => t.id === 'team-barca');
  const rows = team.roster
    .map((player) => ({
      tmb: PD.computeTmbRating(player, CONFIG_BASE),
      age: ContractService.ageOnDate(player, GAME_DATE),
      salary: world.registry.currentForPlayer(player.id, GAME_DATE).breakdownForSeason(SEASON).guaranteedTotalMinor,
    }))
    .filter((row) => row.age >= 23 && row.age <= 30)
    .sort((a, b) => a.tmb - b.tmb);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(
      rows[i].salary >= rows[i - 1].salary,
      `monotonía rota: TMB ${rows[i - 1].tmb} -> ${rows[i].tmb} con salario ${rows[i - 1].salary} -> ${rows[i].salary}`,
    );
  }
});

check('CYCLE-1 retiró el suelo de tres temporadas: la duración inicial es variada y determinista', () => {
  // El puente de staging de CONTRACT-1 (`MINIMUM_PLAYABLE_REMAINING_SEASONS
  // = 3`, que garantizaba que ningún contrato pudiera vencer) queda
  // RETIRADO en CYCLE-1: la constante se conserva solo como referencia
  // histórica documentada y ya no participa en ningún cálculo.
  assert.strictEqual(ContractSeeder.MINIMUM_PLAYABLE_REMAINING_SEASONS_RETIRED_IN, 'CYCLE-1');
  const lengths = new Set();
  world.registry.all().forEach((contract) => {
    assert.ok(contract.coveredSeasonKeys.length >= 1);
    assert.ok(contract.termYears <= 4 + (1 / 365), 'nunca por encima del máximo FIBA de cuatro años');
    lengths.add(contract.coveredSeasonKeys.length);
  });
  // Población significativa en cada tramo de la distribución declarada.
  [1, 2, 3, 4].forEach((n) => assert.ok(lengths.has(n), `no hay ningún contrato de ${n} temporada(s)`));
  const oneSeason = world.registry.all().filter((c) => c.coveredSeasonKeys.length === 1).length;
  const twoSeasons = world.registry.all().filter((c) => c.coveredSeasonKeys.length === 2).length;
  assert.ok(oneSeason > 20, `demasiados pocos contratos de una temporada (${oneSeason})`);
  assert.ok(twoSeasons > 20, `demasiados pocos contratos de dos temporadas (${twoSeasons})`);
});

check('MoraBanc: contratos bajo jurisdicción andorrana, con 12 cuotas y sin RD 1006', () => {
  const contracts = world.registry.forClub('team-morabanc-andorra');
  assert.ok(contracts.length > 0);
  contracts.forEach((contract) => {
    assert.strictEqual(contract.signingContext.employerJurisdictionId, 'AD');
    assert.strictEqual(contract.paymentPolicy.installmentCount, 12);
    assert.ok(!contract.signingContext.ruleModuleIds.includes('es-rd1006-1985-v1'));
    assert.ok(!contract.signingContext.ruleModuleIds.includes('es-smi-2026-v1'));
  });
});

check('un club español de ACB usa 10 mensualidades y uno de Primera FEB no las hereda', () => {
  const acbContract = world.registry.forClub('team-real-madrid')[0];
  const febContract = world.registry.forClub('team-palencia-baloncesto')[0];
  assert.strictEqual(acbContract.paymentPolicy.installmentCount, 10);
  assert.strictEqual(febContract.paymentPolicy.installmentCount, 12);
});

check('un newgen recibe contrato con el contexto vigente y sus marcadores de menor si procede', () => {
  const team = world.teams.find((t) => t.id === 'team-unicaja');
  const newgen = makePlayer({ id: 'newgen-16', birthDate: birthDateForAge(16, '2027-07-01') });
  world.playerRegistry.register(newgen);
  team.addPlayer(newgen);
  const { contract } = ContractSeeder.seedContractForNewPlayer({
    player: newgen,
    team,
    seasonKey: '2027-28',
    date: '2027-06-15',
    registry: world.registry,
    playerRegistry: world.playerRegistry,
    config: CONFIG_BASE,
    calibration: world.calibration,
  });
  assert.ok(contract.minorProtections, 'un menor debe llevar marcadores de protección');
  assert.ok(contract.minorProtections.markers.includes('guardian-consent'));
  assert.strictEqual(contract.minorProtections.markerStatus, 'simulated-recorded');
  assert.strictEqual(contract.provenance.isReal, false);
  assert.ok(contract.probation.enabled, 'un primer contrato profesional sí abre periodo de prueba');
});

check('un club ascendido firma a su cantera con la competición NUEVA sin reescribir contratos antiguos', () => {
  const world2 = buildRealWorld();
  const team = world2.teams.find((t) => t.id === 'team-palencia-baloncesto');
  const oldContract = world2.registry.forClub(team.id)[0];
  const frozen = [...oldContract.signingContext.ruleModuleIds];
  assert.ok(!frozen.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
  team.division = '1ª'; // asciende
  const newgen = makePlayer({ id: 'newgen-promoted', age: 19 });
  world2.playerRegistry.register(newgen);
  team.addPlayer(newgen);
  const { contract } = ContractSeeder.seedContractForNewPlayer({
    player: newgen,
    team,
    seasonKey: '2027-28',
    date: '2027-06-15',
    registry: world2.registry,
    playerRegistry: world2.playerRegistry,
    config: CONFIG_BASE,
    teams: world2.teams,
  });
  assert.ok(contract.signingContext.ruleModuleIds.includes('acb-abp-cba-2018-22-operational-provisional-v1'));
  assert.deepStrictEqual([...oldContract.signingContext.ruleModuleIds], frozen);
});

check('la nómina proyectada del equipo coincide con la del registro contractual', () => {
  const team = world.teams.find((t) => t.id === 'team-valencia-basket');
  const payroll = ContractService.refreshTeamSalaryProjection(team, world.registry, SEASON);
  assert.strictEqual(team.finances.expenses.playerSalaries, Money.toMajorUnits(payroll.amountMinor, 'EUR'));
  assert.strictEqual(
    payroll.amountMinor,
    ContractService.guaranteedPayrollForClub(world.registry, team.id, SEASON).amountMinor,
  );
});

check('los compromisos futuros se proyectan temporada a temporada desde el registro', () => {
  const commitments = ContractService.futureCommitmentsForClub(world.registry, 'team-barca', SEASON);
  assert.strictEqual(commitments.length, 4);
  assert.deepStrictEqual(commitments.map((c) => c.seasonKey), ['2026-27', '2027-28', '2028-29', '2029-30']);
  commitments.forEach((commitment) => assert.ok(commitment.guaranteed.amountMinor > 0));
});

// =====================================================================
group('7. Auditorías estáticas de alcance (sección 13.5)');
// =====================================================================

check('ningún `currentContract` duplicado en Player/Team', () => {
  ['src/entities/Player.js', 'src/entities/Team.js'].forEach((file) => {
    assert.ok(!/currentContract/.test(readSource(file)), `${file} no puede guardar una copia del contrato`);
  });
  assert.ok(!/currentContract\s*[:=]/.test(stripComments(readSource('src/ui/game.js'))));
});

check('ningún `hasTanteo` ni booleano equivalente en todo el repositorio', () => {
  CONTRACT_SOURCES.concat(['src/ui/game.js']).forEach((file) => {
    assert.ok(!/hasTanteo|rightOfFirstRefusalEnabled/.test(stripComments(readSource(file))), `${file} declara tanteo como booleano`);
  });
});

check('ninguna cantidad monetaria se persiste como float de euros', () => {
  CONTRACT_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/salaryEuros|amountEuros|priceEuros/.test(code), `${file} usa euros en float`);
    assert.ok(!/parseFloat\s*\(/.test(code), `${file} usa parseFloat sobre importes`);
  });
});

check('ninguna rama nueva de lógica contractual sobre division/1ª/2ª/isAcb', () => {
  CONTRACT_SOURCES.filter((f) => !f.endsWith('CompetitionRules.js')).forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/isAcb|isFeb/.test(code), `${file} ramifica por liga`);
    // `team.division` solo puede aparecer para PASARLO al adaptador único.
    const divisionUses = (code.match(/\.division/g) || []).length;
    const adapterUses = (code.match(/competitionIdFromLegacyDivision\(/g) || []).length;
    assert.ok(divisionUses <= adapterUses, `${file} usa .division fuera del adaptador de frontera`);
    assert.ok(!/['"]1ª['"]|['"]2ª['"]/.test(code), `${file} ramifica por división legacy`);
  });
});

check('CompetitionDefinition.organizerCountry nunca se usa como jurisdicción laboral', () => {
  CONTRACT_SOURCES.concat(['src/ui/game.js']).forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(
      !/employerJurisdictionId\s*[:=]\s*[^;,\n]*organizerCountry/.test(code),
      `${file} deriva la jurisdicción laboral del país organizador`,
    );
  });
});

check('data/real no contiene ningún contrato ni salario generado', () => {
  const bundle = readSource('data/real/real-data-bundle.js');
  assert.ok(!/simulated-contract-v1|contractRegistry|guaranteedBaseSalaryMinor/.test(bundle));
});

check('la interfaz no añade acciones de mercado fuera de alcance', () => {
  const ui = readSource('src/ui/game.js');
  const contractSection = ui.slice(ui.indexOf('CONTRACT-1 (DESIGN.md 9.17) — presentación de contratos'));
  [/renovar/i, /despedir/i, /fichar/i, /ejecutar cláusula/i, /tantear/i, /ceder/i].forEach((pattern) => {
    const buttonMatches = contractSection.match(/<button[^>]*>[^<]*<\/button>/g) || [];
    buttonMatches.forEach((button) => {
      assert.ok(!pattern.test(button), `botón de mercado encontrado: ${button}`);
    });
  });
  assert.ok(!/data-contract-action/.test(ui));
});

check('no se ha implementado save/load nuevo', () => {
  const ui = stripComments(readSource('src/ui/game.js'));
  assert.ok(!/localStorage|sessionStorage|indexedDB/i.test(ui));
  CONTRACT_SOURCES.forEach((file) => {
    assert.ok(!/localStorage|sessionStorage/i.test(stripComments(readSource(file))), `${file} implementa persistencia`);
  });
});

check('todos los módulos normativos declaran fuente, versión y estado', () => {
  Object.values(CompetitionRules.EMPLOYMENT_MODULES).forEach((module_) => {
    assert.ok(module_.id && module_.version && module_.status, `módulo incompleto: ${module_.id}`);
    assert.ok(['verified', 'provisional', 'deprecated', 'reference-only'].includes(module_.status));
    assert.ok(module_.validity, `sin vigencia declarada: ${module_.id}`);
    if (!module_.id.startsWith('bm-test')) {
      assert.ok(module_.sourceRefs.length > 0, `sin fuente oficial: ${module_.id}`);
      module_.sourceRefs.forEach((ref) => {
        assert.ok(ref.title && ref.url && ref.retrievedAt, `fuente incompleta en ${module_.id}`);
      });
    }
  });
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
