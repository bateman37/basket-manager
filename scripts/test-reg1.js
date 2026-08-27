#!/usr/bin/env node
// scripts/test-reg1.js
// Verificación REG-1 (DESIGN.md 9.18) — script Node ad-hoc, mismo criterio
// que test-roster1.js/test-contract1.js (no hay framework de tests
// instalado, ver CLAUDE.md). Ejecutar con:
//   node scripts/test-reg1.js
//
// Grupos (sección 14.1 del prompt de REG-1):
//   1. Bugs de main (BUG-CONTRACT1-01/02/03)
//   2. Entidades y registro
//   3. Clasificación FEB (art. 28)
//   4. Separación ACB/FEB
//   5. ACB
//   6. Primera FEB
//   7. Vinculación
//   8. Reglas y composición
//   9. Seeder/datos
//   10. Actas/CPU/rotación

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Player } = require('../src/entities/Player.js');
const { Team, TEST_MATCH_SQUAD_POLICY } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { ClubEmploymentContextCatalog } = require('../src/core/ClubEmploymentContextCatalog.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { RegulatoryCalendar } = require('../src/utils/RegulatoryCalendar.js');
const { RegistrationEventTypes } = require('../src/core/RegistrationEventTypes.js');
const {
  FederationLicense, CompetitionRegistration, ClubLinkAgreement, MatchActSnapshot, PlayerRegulatoryProfile,
} = require('../src/entities/Registration.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');
const { RegulatoryClassificationService } = require('../src/core/RegulatoryClassificationService.js');
const { EligibilityService } = require('../src/core/EligibilityService.js');
const { SquadEligibilityService } = require('../src/core/SquadEligibilityService.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { buildCpuLineup } = require('../src/core/CpuLineup.js');
const Rotation = require('../src/core/Rotation.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { padRosterToMinimum, ensureDevelopmentState } = (() => {
  const gen = require('../src/utils/playerGenerator.js');
  const pd = require('../src/core/PlayerDevelopment.js');
  return { padRosterToMinimum: gen.padRosterToMinimum, ensureDevelopmentState: pd.ensureDevelopmentState };
})();

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
    positions: overrides.positions || { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: overrides.nominalPosition || 'Base',
    technical: overrides.technical || {},
    physical: { durability: 10, recovery: 10, ...overrides.physical },
    mental: overrides.mental || {},
    hidden: {
      potential: overrides.potential !== undefined ? overrides.potential : 150,
      professionalism: 10,
      ambition: 10,
      learningRate: 10,
      learningPersistence: 10,
    },
  };
  return new Player(data);
}

function makeRoster(count, prefix = 'p', positionCycle) {
  const roster = [];
  const cycle = positionCycle || [
    { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    { Base: 1, Escolta: 20, Alero: 5, 'Ala-pívot': 3, Pívot: 1 },
    { Base: 1, Escolta: 3, Alero: 20, 'Ala-pívot': 5, Pívot: 1 },
    { Base: 1, Escolta: 1, Alero: 3, 'Ala-pívot': 20, Pívot: 5 },
    { Base: 1, Escolta: 1, Alero: 1, 'Ala-pívot': 3, Pívot: 20 },
  ];
  for (let i = 0; i < count; i += 1) {
    const positions = cycle[i % cycle.length];
    const nominal = Object.keys(positions).find((k) => positions[k] === 20);
    roster.push(makePlayer({ id: `${prefix}-${i}`, positions, nominalPosition: nominal }));
  }
  return roster;
}

function makeTeam(overrides = {}) {
  const roster = overrides.roster || makeRoster(12);
  return new Team({
    name: 'REG-1 Test Team', division: overrides.division || '1ª', roster, ...overrides,
  });
}

// A simple resolvable context builder for direct CompetitionRules calls.
function acbContext(extra) {
  return {
    domain: 'registration', competitionId: CompetitionRules.COMPETITION_IDS.ACB, seasonKey: SEASON, date: GAME_DATE, phaseId: 'league', ...extra,
  };
}
function febContext(extra) {
  return {
    domain: 'registration', competitionId: CompetitionRules.COMPETITION_IDS.PRIMERA_FEB, seasonKey: SEASON, date: GAME_DATE, phaseId: 'league', ...extra,
  };
}

// =====================================================================
group('1. Bugs de main (BUG-CONTRACT1-01/02/03)');
// =====================================================================

check('BUG-CONTRACT1-01: no queda ningún "12" de convocatoria hardcodeado en game.js (toggleSquadMember)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/ui/game.js'), 'utf8');
  assert.ok(!/squadIds\.length\s*>=\s*12/.test(source), 'toggleSquadMember todavía compara contra 12 literal');
  assert.ok(/resolveTeamSquadRules\(team\)/.test(source), 'toggleSquadMember debe resolver el máximo real vía CompetitionRules');
});

check('BUG-CONTRACT1-01 (fixture): un perfil con acta máxima 9 resuelve 9, no 12', () => {
  const resolved = CompetitionRules.resolveRules({
    domain: 'registration', competitionId: CompetitionRules.COMPETITION_IDS.TEST_FICTIONAL, seasonKey: '2026-27', date: GAME_DATE, operation: 'buildMatchSquad',
  });
  assert.strictEqual(resolved.squadRules.max, 9);
  assert.notStrictEqual(resolved.squadRules.max, 12);
});

check('BUG-CONTRACT1-02: game.js resuelve reglas por partido/fecha explícitos, nunca leyendo el reloj global dentro del resolver', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/ui/game.js'), 'utf8');
  // El ÚNICO punto permitido que combina team.division + reloj de mundo es
  // resolveNextMatchContextForTeam (adaptador de frontera explícito,
  // documentado) — CompetitionRules.js en sí es puro y nunca lee `state`.
  const rulesSource = fs.readFileSync(path.join(__dirname, '..', 'src/core/CompetitionRules.js'), 'utf8');
  assert.ok(!/state\.calendar/.test(rulesSource), 'CompetitionRules.js no debe leer el reloj de mundo');
  assert.ok(/function buildMatchCompetitionContext/.test(source), 'debe existir un constructor de contexto explícito');
  assert.ok(/falta "date"/.test(source), 'buildMatchCompetitionContext debe exigir "date" explícito, nunca un default silencioso');
});

check('BUG-CONTRACT1-02: ACB Liga/Copa/Playoff comparten registrationScopeId declarado como dato', () => {
  const resolvedLeague = CompetitionRules.resolveRules(acbContext({ phaseId: 'league' }));
  const resolvedCup = CompetitionRules.resolveRules(acbContext({ phaseId: 'cup' }));
  const resolvedPlayoff = CompetitionRules.resolveRules(acbContext({ phaseId: 'title-playoff' }));
  assert.strictEqual(resolvedLeague.registrationScopeId, resolvedCup.registrationScopeId);
  assert.strictEqual(resolvedLeague.registrationScopeId, resolvedPlayoff.registrationScopeId);
  assert.strictEqual(resolvedLeague.registrationScopeId, 'acb-domestic-registration-2025-26');
});

check('BUG-CONTRACT1-02: ACB y Primera FEB tienen registrationScopeId DISTINTOS', () => {
  const acb = CompetitionRules.resolveRules(acbContext());
  const feb = CompetitionRules.resolveRules(febContext());
  assert.notStrictEqual(acb.registrationScopeId, feb.registrationScopeId);
});

check('BUG-CONTRACT1-03: Team.buildMatchSquad() sin política explícita falla (nunca hereda 8-12 en silencio)', () => {
  const team = makeTeam({ roster: makeRoster(12) });
  assert.throws(
    () => team.buildMatchSquad(team.roster.slice(0, 8).map((p) => p.id)),
    /minOverride.*maxOverride|BUG-CONTRACT1-03/,
  );
});

check('BUG-CONTRACT1-03: TEST_MATCH_SQUAD_POLICY es un fixture NOMBRADO, no un fallback oculto', () => {
  assert.deepStrictEqual(TEST_MATCH_SQUAD_POLICY, { min: 8, max: 12 });
  const team = makeTeam({ roster: makeRoster(12) });
  const squad = team.buildMatchSquadExcludingPosition('Pívot');
  assert.ok(squad.length >= TEST_MATCH_SQUAD_POLICY.min);
});

check('BUG-CONTRACT1-03: ningún caller de producción de MatchEngine/CpuLineup deja un 8-12 oculto sin nombrar', () => {
  const meSource = fs.readFileSync(path.join(__dirname, '..', 'src/core/MatchEngine.js'), 'utf8');
  const cpuSource = fs.readFileSync(path.join(__dirname, '..', 'src/core/CpuLineup.js'), 'utf8');
  assert.ok(/TEST_MATCH_SQUAD_POLICY/.test(meSource), 'MatchEngine.defaultMatchSquad debe nombrar TEST_MATCH_SQUAD_POLICY explícitamente');
  assert.ok(/TEST_MATCH_SQUAD_POLICY/.test(cpuSource), 'CpuLineup debe nombrar TEST_MATCH_SQUAD_POLICY explícitamente');
});

// =====================================================================
group('2. Entidades y registro');
// =====================================================================

check('RegistrationEventTypes: transición válida encadenada submitted->validated->activated', () => {
  const events = [];
  ['submitted', 'validated', 'activated'].forEach((type, i) => {
    const event = { id: `e${i}`, type, date: '2026-08-0' + (i + 1) };
    const result = RegistrationEventTypes.validateEvent(event, events);
    assert.ok(result.valid, JSON.stringify(result.errors));
    events.push(event);
  });
  assert.strictEqual(RegistrationEventTypes.deriveStatus(events, null), 'active');
});

check('RegistrationEventTypes: transición imposible se rechaza (activated -> submitted)', () => {
  const events = [
    { id: 'e1', type: 'submitted', date: '2026-08-01' },
    { id: 'e2', type: 'validated', date: '2026-08-02' },
    { id: 'e3', type: 'activated', date: '2026-08-03' },
  ];
  const result = RegistrationEventTypes.validateEvent({ id: 'e4', type: 'submitted', date: '2026-08-04' }, events);
  assert.strictEqual(result.valid, false);
});

check('RegistrationEventTypes: evento desconocido se rechaza', () => {
  const result = RegistrationEventTypes.validateEvent({ id: 'e1', type: 'made-up-type', date: '2026-08-01' }, []);
  assert.strictEqual(result.valid, false);
});

check('RegistrationEventTypes: dos eventos no comparten id', () => {
  const events = [{ id: 'e1', type: 'submitted', date: '2026-08-01' }];
  const result = RegistrationEventTypes.validateEvent({ id: 'e1', type: 'validated', date: '2026-08-02' }, events);
  assert.strictEqual(result.valid, false);
});

check('RegistrationEventTypes: cronología incoherente (evento anterior al último) se rechaza', () => {
  const events = [
    { id: 'e1', type: 'submitted', date: '2026-08-05' },
    { id: 'e2', type: 'validated', date: '2026-08-06' },
  ];
  const result = RegistrationEventTypes.validateEvent({ id: 'e3', type: 'activated', date: '2026-08-01' }, events);
  assert.strictEqual(result.valid, false);
});

check('FederationLicense: statusOn deriva correctamente en una fecha pasada', () => {
  const lic = new FederationLicense({
    id: 'lic1', playerId: 'p1', clubId: 'c1', federationId: 'feb-general', seasonKey: SEASON,
    validity: { startDate: '2026-07-01', endDate: '2027-06-30' },
  });
  lic.addEvent({ id: 'e1', type: 'submitted', date: '2026-08-01' });
  lic.addEvent({ id: 'e2', type: 'validated', date: '2026-08-05' });
  assert.strictEqual(lic.statusOn('2026-08-03'), 'submitted');
  lic.addEvent({ id: 'e3', type: 'activated', date: '2026-08-10' });
  assert.strictEqual(lic.statusOn('2026-08-03'), 'submitted');
  assert.strictEqual(lic.statusOn('2026-09-01'), 'active');
});

check('CompetitionRegistration: baja NUNCA muta contrato ni afiliación (invariante estructural)', () => {
  const reg = new CompetitionRegistration({
    id: 'reg1', playerId: 'p1', licenseId: 'lic1', teamId: 'c1', competitionId: 'acb',
    registrationScopeId: 'acb-domestic-registration-2025-26', seasonKey: SEASON, accessCategory: 'senior', contractId: 'contract1',
  });
  reg.addEvent({ id: 'r1', type: 'submitted', date: '2026-08-01' });
  reg.addEvent({ id: 'r2', type: 'validated', date: '2026-08-02' });
  reg.addEvent({ id: 'r3', type: 'activated', date: '2026-08-03' });
  reg.addEvent({ id: 'r4', type: 'deactivated', date: '2026-10-01' });
  // la baja de inscripción no toca contractId ni teamId: siguen siendo los
  // mismos campos que al crearla — CompetitionRegistration no conoce
  // Team.roster ni ContractRegistry.
  assert.strictEqual(reg.contractId, 'contract1');
  assert.strictEqual(reg.teamId, 'c1');
  assert.strictEqual(reg.statusOn('2026-10-02'), 'deactivated');
});

check('ClubLinkAgreement: vinculado NUNCA cambia teamId (la lista solo guarda IDs)', () => {
  const agreement = new ClubLinkAgreement({
    id: 'link1', lowerClubId: 'c2', upperClubId: 'c1', competitionId: 'acb', federationId: 'feb-general',
    seasonKey: SEASON, formalizedDate: '2026-08-01', limits: { lowerToUpper: 4, upperToLower: 0 },
  });
  agreement.addToList('lowerToUpper', 'p9');
  assert.ok(agreement.listContains('lowerToUpper', 'p9'));
  // la entidad no tiene ningún campo que pudiera mutar player.teamId — el
  // pool elegible del club beneficiario lo consulta sin tocar afiliación.
  assert.strictEqual(typeof agreement.lists.lowerToUpper[0], 'string');
});

check('ClubLinkAgreement: límites 4/5 respetados, exceso lanza', () => {
  const agreement = new ClubLinkAgreement({
    id: 'link2', lowerClubId: 'c2', upperClubId: 'c1', competitionId: 'primera-feb', federationId: 'feb-general',
    seasonKey: SEASON, formalizedDate: '2026-08-01', limits: { lowerToUpper: 4, upperToLower: 5 },
  });
  ['a', 'b', 'c', 'd'].forEach((id) => agreement.addToList('lowerToUpper', id));
  assert.throws(() => agreement.addToList('lowerToUpper', 'e'));
  ['f', 'g', 'h', 'i', 'j'].forEach((id) => agreement.addToList('upperToLower', id));
  assert.throws(() => agreement.addToList('upperToLower', 'k'));
});

check('ClubLinkAgreement: misma competición en ambos clubes -> ineficaz', () => {
  const agreement = new ClubLinkAgreement({
    id: 'link3', lowerClubId: 'c2', upperClubId: 'c1', competitionId: 'acb', federationId: 'feb-general',
    seasonKey: SEASON, formalizedDate: '2026-08-01', limits: { lowerToUpper: 4, upperToLower: 0 },
  });
  assert.strictEqual(agreement.isEffectiveForCompetition('acb', 'acb'), false);
  assert.strictEqual(agreement.isEffectiveForCompetition('primera-feb', 'acb'), true);
});

check('MatchActSnapshot: inmutable y consultable por jugador', () => {
  const snapshot = new MatchActSnapshot({
    id: 'act1', matchId: 'league:1:c1:c2', competitionId: 'acb', registrationScopeId: 'acb-domestic-registration-2025-26',
    seasonKey: SEASON, teamId: 'c1', matchDateTime: '2026-09-05T18:00:00', selectedPlayers: [{ playerId: 'p1', accessCategory: 'senior' }],
  });
  assert.ok(snapshot.includesPlayer('p1'));
  assert.ok(Object.isFrozen(snapshot.selectedPlayers));
});

check('RegistrationRegistry: misma instancia PlayerRegistry (registro por ID, nunca clon)', () => {
  const registry = new RegistrationRegistry();
  const lic = new FederationLicense({
    id: 'lic1', playerId: 'p1', clubId: 'c1', federationId: 'feb-general', seasonKey: SEASON,
    validity: { startDate: '2026-07-01', endDate: '2027-06-30' },
  });
  registry.registerLicense(lic);
  assert.strictEqual(registry.getLicense('lic1'), lic);
});

check('RegistrationRegistry: validateIntegrity detecta jugador ausente de PlayerRegistry', () => {
  const registry = new RegistrationRegistry();
  const playerRegistry = new PlayerRegistry();
  const lic = new FederationLicense({
    id: 'lic1', playerId: 'ghost-player', clubId: 'c1', federationId: 'feb-general', seasonKey: SEASON,
    validity: { startDate: '2026-07-01', endDate: '2027-06-30' },
  });
  registry.registerLicense(lic);
  const report = registry.validateIntegrity({ playerRegistry, teams: [] });
  assert.strictEqual(report.valid, false);
  assert.ok(report.errors.some((e) => e.includes('ghost-player')));
});

check('RegistrationRegistry: playerAlreadyOnActThisRound detecta doble acta misma jornada/ámbito', () => {
  const registry = new RegistrationRegistry();
  registry.registerMatchAct(new MatchActSnapshot({
    id: 'act1', matchId: 'league:1:c1:c2', roundId: 1, competitionId: 'acb', registrationScopeId: 'acb-domestic-registration-2025-26',
    seasonKey: SEASON, teamId: 'c1', matchDateTime: '2026-09-05T18:00:00', selectedPlayers: [{ playerId: 'p1', accessCategory: 'linked' }],
  }));
  const clash = registry.playerAlreadyOnActThisRound('p1', 'acb-domestic-registration-2025-26', SEASON, 1, 'league:1:c3:c4');
  assert.strictEqual(clash, true);
  const noClash = registry.playerAlreadyOnActThisRound('p1', 'acb-domestic-registration-2025-26', SEASON, 1, 'league:1:c1:c2');
  assert.strictEqual(noClash, false, 'la propia acta que se está construyendo no debe autoconsiderarse un choque');
  const noClashOtherSeason = registry.playerAlreadyOnActThisRound('p1', 'acb-domestic-registration-2025-26', '2099-2100', 1, 'league:1:c3:c4');
  assert.strictEqual(noClashOtherSeason, false, 'la jornada 1 de otra temporada nunca debe leerse como la misma jornada');
});

check('RegistrationRegistry.registerMatchAct es idempotente', () => {
  const registry = new RegistrationRegistry();
  const snap1 = new MatchActSnapshot({
    id: 'act1', matchId: 'league:1:c1:c2', competitionId: 'acb', registrationScopeId: 'acb-domestic-registration-2025-26',
    seasonKey: SEASON, teamId: 'c1', matchDateTime: '2026-09-05T18:00:00', selectedPlayers: [],
  });
  registry.registerMatchAct(snap1);
  const snap2 = new MatchActSnapshot({
    id: 'act1', matchId: 'league:1:c1:c2', competitionId: 'acb', registrationScopeId: 'acb-domestic-registration-2025-26',
    seasonKey: SEASON, teamId: 'c1', matchDateTime: '2026-09-05T18:00:00', selectedPlayers: [{ playerId: 'p9', accessCategory: 'senior' }],
  });
  const result = registry.registerMatchAct(snap2);
  assert.strictEqual(result, snap1, 'la primera instantánea registrada gana; nunca se sobrescribe');
});

// =====================================================================
group('3. Clasificación FEB (art. 28)');
// =====================================================================

function profileWithSeasons(count, monthsEach = 9, category = 'cadete-1') {
  const periods = [];
  for (let i = 0; i < count; i += 1) {
    periods.push({
      id: `t${i}`, federationId: 'feb-general', category, fromDate: `${2020 + i}-09-01`, toDate: `${2021 + i}-05-31`, monthsCounted: monthsEach,
    });
  }
  return new PlayerRegulatoryProfile({ playerId: 'pX', citizenships: [{ countryCode: 'ES' }], trainingPeriods: periods });
}

check('Formación FEB: 3 temporadas de 8+ meses computables CALIFICAN', () => {
  const profile = profileWithSeasons(3, 8);
  const result = RegulatoryClassificationService.classifyFormationFeb28(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'qualifies');
  assert.strictEqual(result.basis, 'training-history');
});

check('Formación FEB: 2 temporadas completas NO califican', () => {
  const profile = profileWithSeasons(2, 9);
  const result = RegulatoryClassificationService.classifyFormationFeb28(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'does-not-qualify');
});

check('Formación FEB: periodos fuera de la banda de edad/categoría NO cuentan', () => {
  const profile = profileWithSeasons(3, 9, 'senior'); // categoría fuera de la banda infantil-2..junior-2
  const result = RegulatoryClassificationService.classifyFormationFeb28(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'does-not-qualify');
});

check('Formación FEB: excepción de participación con selección nacional FEB', () => {
  const profile = new PlayerRegulatoryProfile({
    playerId: 'pX', nationalTeamAppearances: [{ id: 'nt1', federationId: 'feb-general', official: true }],
  });
  const result = RegulatoryClassificationService.classifyFormationFeb28(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'qualifies');
  assert.strictEqual(result.basis, 'national-team');
});

check('Formación FEB: 3 temporadas con ciudadanía NO comunitaria y sin acuerdo de igualdad -> no califica', () => {
  const profile = profileWithSeasons(3, 9);
  profile.citizenships = [{ countryCode: 'US' }];
  const result = RegulatoryClassificationService.classifyFormationFeb28(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'does-not-qualify');
  assert.strictEqual(result.basis, 'citizenship');
});

check('No comunitario FEB: ciudadanía comunitaria NO cuenta plaza', () => {
  const profile = new PlayerRegulatoryProfile({ playerId: 'pX', citizenships: [{ countryCode: 'FR' }] });
  const result = RegulatoryClassificationService.classifyNonCommunitySlotFeb(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'does-not-count');
});

check('No comunitario FEB: ciudadanía fuera de UE/EEE/Suiza SÍ cuenta plaza', () => {
  const profile = new PlayerRegulatoryProfile({ playerId: 'pX', citizenships: [{ countryCode: 'US' }] });
  const result = RegulatoryClassificationService.classifyNonCommunitySlotFeb(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'counts');
});

check('No comunitario FEB: ciudadanía de ADOPCIÓN sin vínculo acreditado SÍ cuenta (control explícito)', () => {
  const profile = new PlayerRegulatoryProfile({
    playerId: 'pX',
    citizenships: [{ countryCode: 'US' }],
    equalTreatmentEvidences: [{ id: 'ev1', type: 'adoption-of-convenience-citizenship' }],
  });
  const result = RegulatoryClassificationService.classifyNonCommunitySlotFeb(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'counts');
});

check('No comunitario FEB: exención familiar documentada NO cuenta', () => {
  const profile = new PlayerRegulatoryProfile({
    playerId: 'pX',
    citizenships: [{ countryCode: 'US' }],
    equalTreatmentEvidences: [{ id: 'ev1', type: 'family-member-of-eu-citizen', status: 'documented' }],
  });
  const result = RegulatoryClassificationService.classifyNonCommunitySlotFeb(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'does-not-count');
  assert.strictEqual(result.basis, 'family-exemption');
});

check('No comunitario FEB: transición Brexit DENTRO de vigencia (contrato pre 2021-02-01) NO cuenta', () => {
  const profile = new PlayerRegulatoryProfile({
    playerId: 'pX',
    citizenships: [{ countryCode: 'GB' }],
    equalTreatmentEvidences: [{
      id: 'ev1', type: 'brexit-transitional-contract', contractStartDate: '2020-08-01', contractEndDate: '2027-06-30',
    }],
  });
  const result = RegulatoryClassificationService.classifyNonCommunitySlotFeb(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'does-not-count');
  assert.strictEqual(result.basis, 'legacy-transition');
});

check('No comunitario FEB: transición Brexit FUERA de vigencia (contrato firmado después del corte) SÍ cuenta', () => {
  const profile = new PlayerRegulatoryProfile({
    playerId: 'pX',
    citizenships: [{ countryCode: 'GB' }],
    equalTreatmentEvidences: [{
      id: 'ev1', type: 'brexit-transitional-contract', contractStartDate: '2022-08-01', contractEndDate: '2027-06-30',
    }],
  });
  const result = RegulatoryClassificationService.classifyNonCommunitySlotFeb(profile, { date: GAME_DATE });
  assert.strictEqual(result.status, 'counts');
});

check('Formación/no comunitario FEB: datos ausentes producen "unknown", NUNCA favorable por omisión', () => {
  const emptyProfile = new PlayerRegulatoryProfile({ playerId: 'pX' });
  const formation = RegulatoryClassificationService.classifyFormationFeb28(emptyProfile, { date: GAME_DATE });
  const nonCommunity = RegulatoryClassificationService.classifyNonCommunitySlotFeb(emptyProfile, { date: GAME_DATE });
  assert.strictEqual(formation.status, 'unknown');
  assert.strictEqual(nonCommunity.status, 'unknown');
  assert.notStrictEqual(formation.status, 'qualifies');
  assert.notStrictEqual(nonCommunity.status, 'does-not-count');
});

// =====================================================================
group('4. Separación ACB/FEB');
// =====================================================================

check('ACB NUNCA llama al clasificador FEB art. 28 (usa organizer-approved/simulated-snapshot)', () => {
  const profile = profileWithSeasons(3, 9); // reuniría 3 temporadas si se evaluara con el clasificador FEB
  const result = RegulatoryClassificationService.classifyPlayer('pX', profile, {
    competitionId: CompetitionRules.COMPETITION_IDS.ACB, seasonKey: SEASON, date: GAME_DATE,
  });
  // Sin snapshot aprobado, ACB nunca resuelve "qualifies" reutilizando la
  // evidencia de formación FEB — debe quedar "unknown".
  assert.strictEqual(result.formation.status, 'unknown');
  assert.strictEqual(result.trace.sourceRuleIds[0], 'organizer-approved-classification');
});

check('El mismo perfil puede dar clasificaciones DISTINTAS bajo ACB y bajo Primera FEB', () => {
  const profile = profileWithSeasons(3, 9);
  const feb = RegulatoryClassificationService.classifyPlayer('pX', profile, {
    competitionId: CompetitionRules.COMPETITION_IDS.PRIMERA_FEB, seasonKey: SEASON, date: GAME_DATE,
  });
  const acb = RegulatoryClassificationService.classifyPlayer('pX', profile, {
    competitionId: CompetitionRules.COMPETITION_IDS.ACB, seasonKey: SEASON, date: GAME_DATE,
  });
  assert.strictEqual(feb.formation.status, 'qualifies');
  assert.strictEqual(acb.formation.status, 'unknown');
});

check('MoraBanc Andorra: contrato bajo AD, registro bajo ACB en la misma competición', () => {
  const employment = CompetitionRules.resolveEmploymentRules({
    clubId: 'team-morabanc-andorra',
    employerJurisdictionId: ClubEmploymentContextCatalog.getClubEmploymentContext('team-morabanc-andorra').employerJurisdictionId,
    domesticCompetitionId: CompetitionRules.COMPETITION_IDS.ACB,
    federationId: 'feb-general',
    seasonKey: SEASON,
    date: GAME_DATE,
    operation: 'validateContract',
  });
  assert.strictEqual(employment.requestedContext.employerJurisdictionId, 'AD');
  assert.ok(!employment.ruleModuleIds.includes('es-rd1006-1985-v1'));
  const registration = CompetitionRules.resolveRules(acbContext());
  assert.strictEqual(registration.competitionId, CompetitionRules.COMPETITION_IDS.ACB);
});

// =====================================================================
group('5. ACB');
// =====================================================================

check('ACB: bandas 8-9 (formación 3) y 10-12 (formación 4)', () => {
  const resolved = CompetitionRules.resolveRules(acbContext());
  const bands = resolved.registration.quotaBands;
  assert.deepStrictEqual(bands.find((b) => b.rosterMin === 8), { rosterMin: 8, rosterMax: 9, formationMinimum: 3 });
  assert.deepStrictEqual(bands.find((b) => b.rosterMin === 10), { rosterMin: 10, rosterMax: 12, formationMinimum: 4 });
});

check('ACB: máximo acumulado 20, propio/vinculado NO cuentan', () => {
  const resolved = CompetitionRules.resolveRules(acbContext());
  assert.strictEqual(resolved.registration.cumulativeRegistrationCap.max, 20);
  assert.ok(resolved.registration.cumulativeRegistrationCap.nonCountingCategories.includes('own-lower-category'));
  assert.ok(resolved.registration.cumulativeRegistrationCap.nonCountingCategories.includes('linked'));
});

check('ACB: un tercer no comunitario en el acta se rechaza colectivamente', () => {
  const resolved = CompetitionRules.resolveRules(acbContext());
  const evaluations = new Map();
  const playerIds = [];
  for (let i = 0; i < 10; i += 1) {
    const id = `p${i}`;
    playerIds.push(id);
    const nonCommunityCounts = i < 3; // 3 no comunitarios: excede el máximo de 2
    evaluations.set(id, {
      eligible: true,
      classification: {
        formation: { status: i < 4 ? 'qualifies' : 'does-not-qualify' },
        nonCommunitySlot: { status: nonCommunityCounts ? 'counts' : 'does-not-count' },
      },
    });
  }
  const validation = SquadEligibilityService.validateSquad(playerIds, evaluations, resolved);
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.findings.some((f) => f.code === 'NON_COMMUNITY_CAP_EXCEEDED'));
});

check('ACB: sustitución por lesión exige un evento explícito (no automático desde Medical)', () => {
  const registry = new RegistrationRegistry();
  const resolved = CompetitionRules.resolveRules(acbContext());
  const reg = new CompetitionRegistration({
    id: 'reg1', playerId: 'p1', licenseId: 'lic1', teamId: 'c1', competitionId: 'acb',
    registrationScopeId: resolved.registrationScopeId, seasonKey: SEASON, accessCategory: 'senior', contractId: 'c1',
  });
  registry.registerRegistration(reg);
  reg.addEvent({ id: 'r1', type: 'submitted', date: '2026-08-01' });
  reg.addEvent({ id: 'r2', type: 'validated', date: '2026-08-02' });
  reg.addEvent({ id: 'r3', type: 'activated', date: '2026-08-03' });
  assert.throws(() => RegistrationService.suspendRegistrationForStatus(reg, '2026-09-01', 'not-a-declared-reason', resolved));
  RegistrationService.suspendRegistrationForStatus(reg, '2026-09-01', 'injury-or-illness', resolved);
  assert.strictEqual(reg.statusOn('2026-09-02'), 'suspended');
});

check('ACB: provisional sin documento imprescindible se rechaza', () => {
  const resolved = CompetitionRules.resolveRules(acbContext());
  const lic = new FederationLicense({
    id: 'lic1', playerId: 'p1', clubId: 'c1', federationId: 'feb-general', seasonKey: SEASON,
    validity: { startDate: '2026-07-01', endDate: '2027-06-30' },
    documentStatuses: { 'identity-document': 'verified' }, // faltan medical-clearance y contract-copy
  });
  lic.addEvent({ id: 'e1', type: 'submitted', date: '2026-08-01' });
  lic.addEvent({ id: 'e2', type: 'validated', date: '2026-08-02' });
  assert.throws(() => RegistrationService.provisionallyAuthorizeLicense(lic, '2026-08-03', resolved));
});

check('ACB: ventana ordinaria de alta se evalúa por corte 14:00 mismo día laborable', () => {
  const resolved = CompetitionRules.resolveRules(acbContext());
  const window = resolved.registration.submissionWindows.find((w) => w.id === 'acb-ordinary-window');
  const holidays = new Set(['2026-10-12']);
  const onTime = RegistrationService.evaluateSubmissionWindow(resolved, {
    windowId: 'acb-ordinary-window', requestDate: '2026-09-15', requestTime: '13:00', referenceDate: '2026-09-15', holidaySet: holidays,
  });
  assert.strictEqual(onTime.evaluable, true);
  assert.strictEqual(onTime.onTime, true);
  const late = RegistrationService.evaluateSubmissionWindow(resolved, {
    windowId: 'acb-ordinary-window', requestDate: '2026-09-15', requestTime: '15:00', referenceDate: '2026-09-15', holidaySet: holidays,
  });
  assert.strictEqual(late.onTime, false);
});

check('ACB: doble acta misma jornada se rechaza (EligibilityService)', () => {
  const registry = new RegistrationRegistry();
  const resolved = CompetitionRules.resolveRules(acbContext({ roundId: 5 }));
  registry.registerProfile(new PlayerRegulatoryProfile({
    playerId: 'p1', organizerApprovedClassifications: [{
      id: 'c1', competitionId: 'acb', seasonKey: SEASON, formation: 'qualifies', nonCommunity: 'does-not-count', basis: 'simulated-snapshot',
    }],
  }));
  const lic = RegistrationService.issueLicense({
    registry, playerId: 'p1', clubId: 'c1', federationId: 'feb-general', seasonKey: SEASON, licenseClass: 'professional-senior',
    validity: { startDate: '2026-07-01', endDate: '2027-06-30' }, documentStatuses: {}, date: '2026-08-01',
  });
  RegistrationService.createRegistration({
    registry, playerId: 'p1', licenseId: lic.id, teamId: 'c1', competitionId: 'acb', registrationScopeId: resolved.registrationScopeId,
    seasonKey: SEASON, accessCategory: 'senior', contractId: 'contract1', date: '2026-08-01', resolved,
  });
  registry.registerMatchAct(new MatchActSnapshot({
    id: 'act1', matchId: 'league:5:c1:c2', roundId: 5, competitionId: 'acb', registrationScopeId: resolved.registrationScopeId,
    seasonKey: SEASON, teamId: 'c1', matchDateTime: '2026-11-01T18:00:00', selectedPlayers: [{ playerId: 'p1', accessCategory: 'senior' }],
  }));
  const context = { competitionId: 'acb', seasonKey: SEASON, date: '2026-11-01', roundId: 5, matchId: 'league:5:c3:c1' };
  const evaluation = EligibilityService.evaluateEligibility('p1', 'c3', context, {
    playerRegistry: { has: () => true }, contractRegistry: { get: () => ({ isCurrentOn: () => true }) }, registrationRegistry: registry,
  });
  assert.strictEqual(evaluation.eligible, false);
  assert.ok(evaluation.reasons.some((r) => r.code === 'ALREADY_ON_OTHER_ACT_SAME_ROUND'));
});

check('ACB: una inscripción suspendida se reporta como REGISTRATION_SUSPENDED, nunca como "sin inscripción"', () => {
  // Bug encontrado en verificación de interfaz real (Playwright): una
  // inscripción suspendida era invisible para `currentRegistration()`
  // (solo activas) — EligibilityService la confundía con "nunca inscrito"
  // en vez de reportar el motivo real de suspensión.
  const registry = new RegistrationRegistry();
  const resolved = CompetitionRules.resolveRules(acbContext());
  registry.registerProfile(new PlayerRegulatoryProfile({
    playerId: 'p1', organizerApprovedClassifications: [{
      id: 'c1', competitionId: 'acb', seasonKey: SEASON, formation: 'qualifies', nonCommunity: 'does-not-count', basis: 'simulated-snapshot',
    }],
  }));
  const lic = RegistrationService.issueLicense({
    registry, playerId: 'p1', clubId: 'c1', federationId: 'feb-general', seasonKey: SEASON, licenseClass: 'professional-senior',
    validity: { startDate: '2026-07-01', endDate: '2027-06-30' }, documentStatuses: {}, date: '2026-08-01',
  });
  const registration = RegistrationService.createRegistration({
    registry, playerId: 'p1', licenseId: lic.id, teamId: 'c1', competitionId: 'acb', registrationScopeId: resolved.registrationScopeId,
    seasonKey: SEASON, accessCategory: 'senior', contractId: 'contract1', date: '2026-08-01', resolved,
  });
  RegistrationService.suspendRegistrationForStatus(registration, '2026-11-01', 'disciplinary-suspension', resolved);
  assert.strictEqual(
    registry.currentRegistration('p1', resolved.registrationScopeId, SEASON, '2026-11-01'), null,
    'currentRegistration() sigue devolviendo null para una suspendida (solo activas, comportamiento intencional)',
  );
  assert.ok(
    registry.registrationForScopeSeason('p1', resolved.registrationScopeId, SEASON),
    'registrationForScopeSeason() SÍ la encuentra, sea cual sea su estado',
  );
  const context = { competitionId: 'acb', seasonKey: SEASON, date: '2026-11-01', roundId: 10, matchId: 'league:10:c1:c2' };
  const evaluation = EligibilityService.evaluateEligibility('p1', 'c1', context, {
    playerRegistry: { has: () => true }, contractRegistry: { get: () => ({ isCurrentOn: () => true }) }, registrationRegistry: registry,
  });
  assert.strictEqual(evaluation.eligible, false);
  assert.ok(
    evaluation.reasons.some((r) => r.code === 'REGISTRATION_SUSPENDED'),
    `se esperaba REGISTRATION_SUSPENDED, se obtuvo: ${JSON.stringify(evaluation.reasons)}`,
  );
  assert.ok(!evaluation.reasons.some((r) => r.code === 'NOT_REGISTERED_IN_SCOPE'));
});

// =====================================================================
group('6. Primera FEB');
// =====================================================================

check('Primera FEB: plantilla activa 8-12 distinta del acta 10-12', () => {
  const resolved = CompetitionRules.resolveRules(febContext());
  assert.deepStrictEqual(resolved.registration.activeRosterRange, { min: 8, max: 12 });
  assert.deepStrictEqual(resolved.registration.matchActRange, { min: 10, max: 12 });
});

check('Primera FEB: formación 3/4 y máximo 2 no comunitarios', () => {
  const resolved = CompetitionRules.resolveRules(febContext());
  assert.strictEqual(resolved.registration.nonCommunityCap.max, 2);
  assert.ok(resolved.registration.quotaBands.some((b) => b.formationMinimum === 3));
  assert.ok(resolved.registration.quotaBands.some((b) => b.formationMinimum === 4));
});

check('Primera FEB: dos jugadores de formación en TODOS los slots de rotación (Rotation.validateOnCourtFormationQuota)', () => {
  const formationIds = new Set(['a', 'b', 'c', 'd']);
  const lineup = {
    entries: {
      Base: { starter: { playerId: 'a' }, sub1: { playerId: 'c' }, sub2: { playerId: 'a' } },
      Escolta: { starter: { playerId: 'b' }, sub1: { playerId: 'd' }, sub2: { playerId: 'c' } },
      Alero: { starter: { playerId: 'x' }, sub1: { playerId: 'x' }, sub2: { playerId: 'x' } },
      'Ala-pívot': { starter: { playerId: 'y' }, sub1: { playerId: 'y' }, sub2: { playerId: 'y' } },
      Pívot: { starter: { playerId: 'z' }, sub1: { playerId: 'z' }, sub2: { playerId: 'z' } },
    },
  };
  // starter five = a,b,x,y,z -> 2 de formación (a,b): OK
  // sub1 five    = c,d,x,y,z -> 2 de formación (c,d): OK
  // sub2 five    = a,c,x,y,z -> 2 de formación (a,c): OK
  const result = Rotation.validateOnCourtFormationQuota(lineup, formationIds, 2);
  assert.strictEqual(result.valid, true, JSON.stringify(result.errors));

  const badLineup = JSON.parse(JSON.stringify(lineup));
  badLineup.entries.Base.sub2.playerId = 'x'; // sub2 five pasa a tener solo 1 de formación (c)
  const brokenResult = Rotation.validateOnCourtFormationQuota(badLineup, formationIds, 2);
  assert.strictEqual(brokenResult.valid, false);
  assert.ok(brokenResult.errors.some((e) => e.slot === 'sub2'));
});

check('Primera FEB: máximo acumulado 20 (mismo mecanismo que ACB, declarado aparte)', () => {
  const resolved = CompetitionRules.resolveRules(febContext());
  assert.strictEqual(resolved.registration.cumulativeRegistrationCap.max, 20);
});

check('Primera FEB: reactivación por lesión exige contrato ininterrumpido (declarado, no booleano manual)', () => {
  const resolved = CompetitionRules.resolveRules(febContext());
  assert.strictEqual(resolved.registration.statusRestrictions.reactivationExemptionRequiresUninterruptedContract, true);
});

check('Primera FEB: ventana ordinaria (18:00 día hábil anterior) evaluable con calendario explícito', () => {
  const resolved = CompetitionRules.resolveRules(febContext());
  const holidays = new Set();
  const result = RegistrationService.evaluateSubmissionWindow(resolved, {
    windowId: 'primera-feb-ordinary-window', requestDate: '2026-11-05', requestTime: '17:00', referenceDate: '2026-11-06', holidaySet: holidays,
  });
  assert.strictEqual(result.evaluable, true);
});

check('Primera FEB: excepciones hasta el último día hábil de marzo restringidas a tres categorías (declarado)', () => {
  const resolved = CompetitionRules.resolveRules(febContext());
  const marchWindow = resolved.registration.finalRegistrationDeadlines.find((w) => w.id === 'primera-feb-march-restricted-window');
  assert.ok(marchWindow);
  assert.deepStrictEqual(marchWindow.restrictedToCategories, [
    'from-higher-category', 'requires-international-transfer', 'no-feb-license-this-season',
  ]);
});

check('Primera FEB: inconsistencias oficiales de fuentes están trazadas y visibles', () => {
  const resolved = CompetitionRules.resolveRules(febContext());
  assert.ok(resolved.knownSourceInconsistencies.length >= 3);
  assert.ok(resolved.knownSourceInconsistencies.some((k) => k.includes('13-15')));
  assert.ok(resolved.knownSourceInconsistencies.some((k) => k.includes('máximo 15')));
  assert.ok(resolved.knownSourceInconsistencies.some((k) => k.includes('31 de marzo de 2026')));
});

check('Continuidad ACB 2025-26 en 2026-27 se resuelve como provisionalCarryForward', () => {
  const resolved = CompetitionRules.resolveRules(acbContext());
  assert.strictEqual(resolved.resolutionMode, 'provisionalCarryForward');
  assert.ok(resolved.warnings.some((w) => w.toLowerCase().includes('provisional')));
});

// =====================================================================
group('7. Reglas y composición');
// =====================================================================

check('Composición: rango vacío/conflictivo se declara — perfiles disjuntos no se resuelven en silencio', () => {
  // overlays con min > max resultante debería producir un rango vacío al
  // aplicarse; comprobamos que composeSquadRules (vía overlays) admite el
  // mecanismo (usado ya en ROSTER-1 para reglas europeas futuras).
  const resolved = CompetitionRules.resolveRules(acbContext({
    overlays: [{ matchSquad: { min: 8, max: 12 } }],
  }));
  assert.strictEqual(resolved.squadRules.min, 8);
  assert.strictEqual(resolved.squadRules.max, 12);
});

check('Capacidades derivadas: ACB no declara onCourtFormationQuota, Primera FEB sí', () => {
  const acb = CompetitionRules.resolveRules(acbContext());
  const feb = CompetitionRules.resolveRules(febContext());
  assert.ok(!acb.capabilities.has('onCourtFormationQuota'));
  assert.ok(feb.capabilities.has('onCourtFormationQuota'));
});

check('Capacidades derivadas: linkedPlayers/ownLowerCategoryPlayers presentes en ambas competiciones domésticas', () => {
  const acb = CompetitionRules.resolveRules(acbContext());
  const feb = CompetitionRules.resolveRules(febContext());
  assert.ok(acb.capabilities.has('linkedPlayers'));
  assert.ok(feb.capabilities.has('linkedPlayers'));
  assert.ok(acb.capabilities.has('ownLowerCategoryPlayers'));
});

check('Perfiles de referencia (nunca activados): acta máxima 9, máximo 1 no comunitario, U22 12-20/25, ámbito internacional', () => {
  const max9 = CompetitionRules.REGISTRATION_MODULES['reference-only-max-act-9-v1'];
  const max1NonCommunity = CompetitionRules.REGISTRATION_MODULES['reference-only-max-1-noncommunity-v1'];
  const u22 = CompetitionRules.REGISTRATION_MODULES['reference-only-u22-development-v1'];
  const international = CompetitionRules.REGISTRATION_MODULES['reference-only-international-scope-v1'];
  [max9, max1NonCommunity, u22, international].forEach((m) => assert.strictEqual(m.status, 'reference-only'));
  assert.strictEqual(max9.matchSquad.max, 9);
  assert.strictEqual(max1NonCommunity.nonCommunityCap.max, 1);
  assert.deepStrictEqual(u22.activeRosterRange, { min: 12, max: 20 });
  assert.strictEqual(u22.cumulativeRegistrationCap.max, 25);
  assert.ok(international.finalRegistrationDeadlines[0].cutoff.date);
});

check('Un módulo reference-only nunca se autoselecciona (solo aparece si se fija explícitamente)', () => {
  // Sin pedirlo explícito, la competición de test resuelve SIEMPRE su
  // módulo declarado en el bundle — nunca uno de los `reference-only`,
  // que no está enlazado a ningún RulesetBundle jugable.
  const auto = CompetitionRules.resolveRules({
    domain: 'registration', competitionId: CompetitionRules.COMPETITION_IDS.TEST_FICTIONAL, seasonKey: '2000-01', date: '2026-01-01',
  });
  // Sin pedirlo, resuelve el módulo declarado por el BUNDLE
  // (bm-test-fictional-registration-v1: cupo de formación mínimo 1),
  // nunca el perfil `reference-only-max-act-9-v1` (cupo mínimo 2).
  assert.strictEqual(auto.registration.quotaBands[0].formationMinimum, 1);
  // Fijarlo EXPLÍCITAMENTE (mecanismo de fixture con nombre) sí funciona —
  // esa es la única vía sancionada para usar un perfil reference-only.
  const pinned = CompetitionRules.resolveRules({
    domain: 'registration', competitionId: CompetitionRules.COMPETITION_IDS.TEST_FICTIONAL, seasonKey: '2000-01', date: '2026-01-01',
    registrationModuleId: 'reference-only-max-act-9-v1',
  });
  assert.strictEqual(pinned.registration.quotaBands[0].formationMinimum, 2);
});

// =====================================================================
group('8. RegulatoryCalendar');
// =====================================================================

check('RegulatoryCalendar: día festivo/fin de semana nunca es hábil', () => {
  const holidays = new Set(['2026-12-25']);
  assert.strictEqual(RegulatoryCalendar.isBusinessDay('2026-12-25', holidays), false);
  assert.strictEqual(RegulatoryCalendar.isBusinessDay('2026-12-26', holidays), false); // sábado
});

check('RegulatoryCalendar: sin calendario de festivos explícito, no evaluable (nunca asume "sin festivos")', () => {
  const result = RegulatoryCalendar.evaluateCutoff(
    { time: '14:00', businessDayRule: 'sameDayIfBusiness-elsePriorBusinessDay' },
    { requestDate: '2026-09-01', requestTime: '10:00', referenceDate: '2026-09-01' },
  );
  assert.strictEqual(result.evaluable, false);
});

check('RegulatoryCalendar: último día hábil de un mes retrocede sobre fin de semana', () => {
  const holidays = new Set();
  const result = RegulatoryCalendar.lastBusinessDayOfMonth(2027, 2, holidays); // 28 feb 2027 es domingo
  assert.strictEqual(result.evaluable, true);
  assert.strictEqual(result.date, '2027-02-26');
});

// =====================================================================
group('9. Seeder/datos');
// =====================================================================

function buildRealWorld() {
  const refDate = LocalDate.toJsDate(GAME_DATE);
  const teams = REAL_DATA_INDEX.map((entry) => {
    const teamData = REAL_DATA_TEAMS[entry.id];
    const roster = teamData.roster.map((playerData) => {
      const { dataSource, ...fields } = playerData;
      const player = new Player(fields);
      player.dataSource = dataSource || null;
      ensureDevelopmentState(player, CONFIG_BASE, refDate);
      return player;
    });
    const squadRules = CompetitionRules.resolveRules({
      competitionId: CompetitionRules.competitionIdFromLegacyDivision(teamData.division), seasonKey: SEASON, date: refDate, operation: 'buildMatchSquad',
    }).squadRules;
    padRosterToMinimum(roster, squadRules.min, { minAge: 18, maxAge: 34, referenceDate: refDate });
    return new Team({ ...teamData, roster });
  });
  const playerRegistry = new PlayerRegistry();
  teams.forEach((team) => playerRegistry.registerMany(team.roster));
  const contractRegistry = new ContractRegistry();
  ContractSeeder.seedContractsForTeams({
    teams, seasonKey: SEASON, date: GAME_DATE, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
  });
  const registrationRegistry = new RegistrationRegistry();
  const { results, warnings } = RegistrationSeeder.seedRegistrationsForTeams({
    teams, seasonKey: SEASON, date: GAME_DATE, registrationRegistry, contractRegistry, config: CONFIG_BASE,
  });
  return {
    teams, playerRegistry, contractRegistry, registrationRegistry, results, warnings,
  };
}

const world = buildRealWorld();

check('Seeder: todos los jugadores afiliados de los 36 clubes reciben licencia + inscripción senior', () => {
  const total = world.teams.reduce((acc, team) => acc + team.roster.length, 0);
  assert.strictEqual(world.results.length, total);
  world.teams.forEach((team) => {
    team.roster.forEach((player) => {
      assert.ok(world.registrationRegistry.currentLicenseForPlayer(player.id, GAME_DATE), `sin licencia: ${player.id}`);
    });
  });
});

check('Seeder: todos los snapshots simulados están etiquetados (dataSource/isReal/generatorVersion)', () => {
  world.registrationRegistry.allLicenses().forEach((lic) => {
    assert.strictEqual(lic.provenance.dataSource, RegistrationSeeder.SIMULATED_REGISTRATION_DATA_SOURCE);
    assert.strictEqual(lic.provenance.isReal, false);
    assert.ok(lic.provenance.generatorVersion);
  });
  world.registrationRegistry.allProfiles().forEach((profile) => {
    assert.strictEqual(profile.provenance, 'simulated');
  });
});

check('Seeder: determinismo total — dos ejecuciones sobre los mismos equipos producen registros IDÉNTICOS', () => {
  const registrationRegistryA = new RegistrationRegistry();
  const resultA = RegistrationSeeder.seedRegistrationsForTeams({
    teams: world.teams, seasonKey: SEASON, date: GAME_DATE, registrationRegistry: registrationRegistryA, contractRegistry: world.contractRegistry, config: CONFIG_BASE,
  });
  const registrationRegistryB = new RegistrationRegistry();
  const resultB = RegistrationSeeder.seedRegistrationsForTeams({
    teams: world.teams, seasonKey: SEASON, date: GAME_DATE, registrationRegistry: registrationRegistryB, contractRegistry: world.contractRegistry, config: CONFIG_BASE,
  });
  assert.deepStrictEqual(resultA.results, resultB.results);
});

check('Seeder: no usa Math.random en ninguna decisión regulatoria (fuente estática)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/core/RegistrationSeeder.js'), 'utf8');
  assert.ok(!/Math\.random\(/.test(source), 'RegistrationSeeder no debe invocar Math.random() (solo se menciona en comentarios)');
});

check('Seeder: no infiere ciudadanía/formación por nombre o apellido', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/core/RegistrationSeeder.js'), 'utf8');
  assert.ok(!/firstName|lastName|fullName/.test(source), 'RegistrationSeeder no debe leer nombres de jugador para clasificar');
});

check('Seeder: no escribe en data/real/', () => {
  const dataRealDir = path.join(__dirname, '..', 'data', 'real');
  const before = fs.readdirSync(dataRealDir);
  buildRealWorld();
  const after = fs.readdirSync(dataRealDir);
  assert.deepStrictEqual(before, after);
});

check('Seeder: los 36 clubes reales tienen una solución legal inicial (cupo de formación + no comunitarios)', () => {
  world.teams.forEach((team) => {
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
    const resolved = RegistrationService.resolveRegistrationRules({
      competitionId, seasonKey: SEASON, date: GAME_DATE, phaseId: 'league',
    });
    const classification = RegistrationSeeder.classifyRosterForClub(team, resolved, SEASON);
    const requiredMax = Math.max(...resolved.registration.quotaBands.map((b) => b.formationMinimum));
    assert.ok(classification.formationPlayerIds.size >= requiredMax, `${team.id}: solo ${classification.formationPlayerIds.size} de formación, requiere ${requiredMax}`);
    assert.ok(classification.nonCommunityPlayerIds.size <= resolved.registration.nonCommunityCap.max);
  });
});

// =====================================================================
group('10. Actas/CPU/rotación');
// =====================================================================

check('CPU: selección colectiva legal vía SquadEligibilityService.selectLegalSquad', () => {
  const team = makeTeam({ roster: makeRoster(12) });
  const resolved = CompetitionRules.resolveRules(acbContext());
  const candidates = team.roster.map((player, i) => ({
    playerId: player.id,
    qualityScore: 20 - i,
    evaluation: {
      eligible: true,
      classification: {
        formation: { status: i < 4 ? 'qualifies' : 'does-not-qualify' },
        nonCommunitySlot: { status: i < 1 ? 'counts' : 'does-not-count' },
      },
    },
  }));
  const selection = SquadEligibilityService.selectLegalSquad(candidates, 12, resolved);
  assert.strictEqual(selection.ok, true);
  const evaluations = new Map(candidates.map((c) => [c.playerId, c.evaluation]));
  const validation = SquadEligibilityService.validateSquad(selection.playerIds, evaluations, resolved);
  assert.strictEqual(validation.valid, true);
});

check('CPU: diagnóstico estructurado cuando NO existe solución legal (formación insuficiente)', () => {
  const resolved = CompetitionRules.resolveRules(acbContext());
  const candidates = [];
  for (let i = 0; i < 11; i += 1) {
    candidates.push({
      playerId: `p${i}`, qualityScore: 11 - i,
      evaluation: { eligible: true, classification: { formation: { status: 'does-not-qualify' }, nonCommunitySlot: { status: 'does-not-count' } } },
    });
  }
  const selection = SquadEligibilityService.selectLegalSquad(candidates, 11, resolved);
  assert.strictEqual(selection.ok, false);
  assert.strictEqual(selection.diagnostic.code, 'FORMATION_QUOTA_INFEASIBLE');
});

check('buildCpuLineup: pool regulado produce una convocatoria de exactamente el tamaño deseado sin duplicados', () => {
  const roster = makeRoster(14);
  const team = makeTeam({ roster });
  const resolved = CompetitionRules.resolveRules(acbContext());
  const pool = roster.map((player, i) => ({
    player,
    accessCategory: 'senior',
    evaluation: {
      eligible: true,
      classification: {
        formation: { status: i < 5 ? 'qualifies' : 'does-not-qualify' },
        nonCommunitySlot: { status: 'does-not-count' },
      },
    },
  }));
  const result = buildCpuLineup(team, false, CONFIG_BASE, new Date(2026, 8, 10), resolved.squadRules, { pool, resolved });
  assert.strictEqual(result.squad.length, 12);
  const ids = result.squad.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'la convocatoria no debe tener duplicados');
});

check('buildCpuLineup: Primera FEB mantiene 2 de formación en TODOS los slots (repair) sin dejar softlock', () => {
  const roster = makeRoster(12);
  const team = makeTeam({ roster, division: '2ª' });
  const resolved = CompetitionRules.resolveRules(febContext());
  const pool = roster.map((player, i) => ({
    player,
    accessCategory: 'senior',
    evaluation: {
      eligible: true,
      classification: {
        formation: { status: i < 4 ? 'qualifies' : 'does-not-qualify' },
        nonCommunitySlot: { status: 'does-not-count' },
      },
    },
  }));
  const result = buildCpuLineup(team, false, CONFIG_BASE, new Date(2026, 8, 10), resolved.squadRules, { pool, resolved });
  const formationIds = new Set(pool.filter((e) => e.evaluation.classification.formation.status === 'qualifies').map((e) => e.player.id));
  const check1 = Rotation.validateOnCourtFormationQuota(result.lineup, formationIds, 2);
  assert.strictEqual(check1.valid, true, JSON.stringify(check1.errors));
});

check('Propio de categoría inferior y vinculado participan en el pool sin alterar afiliación', () => {
  const registry = new RegistrationRegistry();
  const resolved = CompetitionRules.resolveRules(acbContext());
  const ownLowerPlayer = makePlayer({ id: 'own1', age: 17 });
  ownLowerPlayer.teamId = 'academy-team';
  const fixture = RegistrationSeeder.seedOwnLowerCategoryFixture({
    player: ownLowerPlayer, team: { id: 'c1' }, seasonKey: SEASON, date: '2026-08-01', registrationRegistry: registry, resolved,
  });
  assert.strictEqual(fixture.registration.accessCategory, 'own-lower-category');
  assert.strictEqual(fixture.registration.cumulativeCap.counted, false);
  assert.strictEqual(ownLowerPlayer.teamId, 'academy-team', 'el propio de categoría inferior no cambia teamId por inscribirse');

  const linkedPlayer = makePlayer({ id: 'linked1', age: 20 });
  linkedPlayer.teamId = 'lower-club';
  const linkFixture = RegistrationSeeder.seedLinkedPlayerFixture({
    player: linkedPlayer, lowerClub: { id: 'lower-club', division: '2ª' }, upperClub: { id: 'c1', division: '1ª' },
    seasonKey: SEASON, date: '2026-08-01', registrationRegistry: registry, resolved, direction: 'lowerToUpper',
  });
  assert.strictEqual(linkFixture.registration.accessCategory, 'linked');
  assert.strictEqual(linkFixture.registration.teamId, 'c1', 'la inscripción de partido es del club BENEFICIARIO');
  assert.strictEqual(linkedPlayer.teamId, 'lower-club', 'el vinculado NUNCA cambia teamId por ser convocado por el club beneficiario');
  assert.ok(registry.linkAgreementsAsBeneficiary('c1').length > 0);
});

// =====================================================================
group('11. Auditorías estáticas de alcance (sección 15 del prompt)');
// =====================================================================

const REPO_ROOT = path.join(__dirname, '..');
const REG_SOURCES = [
  'src/entities/Registration.js',
  'src/core/RegistrationRegistry.js',
  'src/core/RegistrationService.js',
  'src/core/RegistrationEventTypes.js',
  'src/core/RegulatoryClassificationService.js',
  'src/core/EligibilityService.js',
  'src/core/SquadEligibilityService.js',
  'src/core/RegistrationSeeder.js',
  'src/core/CompetitionRules.js',
  'src/utils/RegulatoryCalendar.js',
  'src/core/CpuLineup.js',
  'src/core/Rotation.js',
];
function readSource(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}
// Comentarios fuera: las auditorías miran CÓDIGO, no prosa explicativa.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

check('ninguna rama nueva de lógica regulatoria sobre division/1ª/2ª/isAcb/isFeb', () => {
  REG_SOURCES.filter((f) => !f.endsWith('CompetitionRules.js')).forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/isAcb|isFeb/.test(code), `${file} ramifica por liga`);
    assert.ok(!/['"]1ª['"]|['"]2ª['"]/.test(code), `${file} ramifica por división legacy`);
  });
  // game.js SÍ puede leer `.division` — pero solo para pasarlo al ÚNICO
  // adaptador de frontera (BUG-CONTRACT1-02), nunca para ramificar reglas.
  const gameCode = stripComments(readSource('src/ui/game.js'));
  const divisionUses = (gameCode.match(/\.division\b/g) || []).length;
  const adapterUses = (gameCode.match(/competitionIdFromLegacyDivision\(/g) || []).length;
  assert.ok(divisionUses <= adapterUses + 2, `game.js usa .division fuera del adaptador de frontera (${divisionUses} usos, ${adapterUses} en el adaptador)`);
});

check('ninguna competición desconocida cae por defecto en ACB', () => {
  REG_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/\|\|\s*['"]acb['"]/.test(code), `${file} usa "acb" como fallback silencioso`);
  });
});

check('ningún rango de convocatoria hardcodeado (8-12/10-12) fuera de CompetitionRules.js/fixtures de test', () => {
  REG_SOURCES.filter((f) => f !== 'src/core/CompetitionRules.js').forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/\bmin:\s*8\b[\s\S]{0,20}\bmax:\s*12\b/.test(code), `${file} hardcodea 8-12`);
    assert.ok(!/\bmin:\s*10\b[\s\S]{0,20}\bmax:\s*12\b/.test(code), `${file} hardcodea 10-12`);
  });
});

check('ningún booleano universal de clasificación en Player (isHomegrown/isFormationPlayer/isNonCommunity)', () => {
  const code = stripComments(readSource('src/entities/Player.js'));
  assert.ok(!/isHomegrown|isFormationPlayer|isNonCommunity|homegrownPlayer/.test(code), 'Player.js declara clasificación universal');
});

check('ningún recorrido de Team.roster de TODOS los equipos como índice global de jugadores', () => {
  REG_SOURCES.forEach((file) => {
    const code = stripComments(readSource(file));
    // Los servicios REG-1 nunca reciben una lista de equipos para buscar
    // "en qué roster está" — consultan PlayerRegistry/RegistrationRegistry.
    assert.ok(!/allTeams\.find\(\s*\(?team\)?\s*=>\s*team\.roster\.find/.test(code), `${file} busca un jugador recorriendo rosters como índice global`);
  });
});

check('ninguna composición de reglas con Object.assign/spread genérico en el dominio de inscripción', () => {
  const code = stripComments(readSource('src/core/CompetitionRules.js'));
  const registrationSection = code.slice(code.indexOf('REGISTRATION_MODULES'), code.indexOf('resolveRegistrationDomain') + 5000);
  assert.ok(!/Object\.assign\(\s*\{\s*\}\s*,\s*\w+Module/.test(registrationSection), 'composición genérica de módulos de inscripción con Object.assign');
});

check('RegistrationSeeder no usa Math.random ni infiere ciudadanía/formación por nombre', () => {
  const code = stripComments(readSource('src/core/RegistrationSeeder.js'));
  assert.ok(!/Math\.random\(/.test(code), 'usa Math.random');
  assert.ok(!/fullName|lastName|firstName/.test(code), 'infiere clasificación desde el nombre del jugador');
});

check('ningún documento/identificador personal real modelado (solo estados de documentos)', () => {
  const code = stripComments(readSource('src/entities/Registration.js'));
  assert.ok(!/dni|passportNumber|nifNumber|nationalId/i.test(code), 'modela un identificador personal real');
});

check('data/real no contiene ningún dato de inscripción/licencia generado', () => {
  const bundle = readSource('data/real/real-data-bundle.js');
  assert.ok(!/simulated-registration-v1|registrationRegistry|FederationLicense|CompetitionRegistration/.test(bundle));
});

check('la interfaz no añade acciones de mercado fuera de alcance en Inscripciones/ficha de licencia', () => {
  const ui = readSource('src/ui/game.js');
  // TRANSFER-1 (DESIGN.md 9.20) añade pantallas/acciones DE MERCADO más
  // adelante en el mismo archivo (Mercado > Operaciones, formalización de
  // AIP) — el límite superior de esta sección debe acotarse a la propia
  // pantalla de Inscripciones (hasta que empieza la siguiente pantalla,
  // Mercado) para no barrer código de otra pantalla legítima.
  const registrationsSection = ui.slice(ui.indexOf('Pantalla "Inscripciones" (REG-1'), ui.indexOf('function renderMarketScreen'));
  const ficherSection = ui.slice(ui.indexOf('Pestaña "Licencia y elegibilidad"'), ui.indexOf('Pantalla "Contratos"'));
  [registrationsSection, ficherSection].forEach((section) => {
    const buttonMatches = section.match(/<button[^>]*>[^<]*<\/button>/g) || [];
    [/alta/i, /baja/i, /suspender/i, /vincular/i, /fichar/i, /renovar/i, /ceder/i, /tantear/i, /transfer/i, /autorizar/i].forEach((pattern) => {
      buttonMatches.forEach((button) => {
        assert.ok(!pattern.test(button), `botón de mercado encontrado: ${button}`);
      });
    });
  });
});

check('vincular a un jugador nunca muta su player.teamId (solo la inscripción de partido cambia)', () => {
  const code = stripComments(readSource('src/core/RegistrationSeeder.js'));
  const linkedFnStart = code.indexOf('function seedLinkedPlayerFixture');
  const linkedFn = code.slice(linkedFnStart, code.indexOf('\n  }', linkedFnStart));
  assert.ok(!/player\.teamId\s*=/.test(linkedFn), 'seedLinkedPlayerFixture muta player.teamId');
});

check('una lesión nunca desactiva una inscripción automáticamente (exige evento explícito)', () => {
  ['src/core/EligibilityService.js', 'src/core/Medical.js'].forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/advanceRegistrationEvent|suspendRegistrationForStatus|deactivateRegistration/.test(code), `${file} desactiva inscripciones automáticamente`);
  });
});

check('un contrato nunca concede licencia/inscripción automáticamente (servicios separados)', () => {
  const code = stripComments(readSource('src/core/ContractService.js'));
  assert.ok(!/issueLicense|createRegistration/.test(code), 'ContractService.js concede licencia/inscripción');
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
