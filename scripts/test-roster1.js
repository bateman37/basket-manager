#!/usr/bin/env node
// scripts/test-roster1.js
// Verificación ROSTER-1 (DESIGN.md 9.16) — script Node ad-hoc, mismo
// criterio que test-life1.js/test-life2.js/test-life3.js/test-life4.js (no
// hay framework de tests instalado, ver CLAUDE.md). Ejecutar con:
//   node scripts/test-roster1.js

const assert = require('assert');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const Medical = require('../src/core/Medical.js');
const { generateFictionalPlayer, padRosterToMinimum, FICTIONAL_FALLBACK_DATA_SOURCE } = require('../src/utils/playerGenerator.js');

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
  return new Player(data);
}

function makeRoster(count, prefix = 'p') {
  const roster = [];
  for (let i = 0; i < count; i++) roster.push(makePlayer({ id: `${prefix}-${i}` }));
  return roster;
}

function makeTeam(overrides = {}) {
  const roster = overrides.roster || makeRoster(12);
  return new Team({
    name: 'ROSTER-1 Test Team', division: overrides.division || '1ª', roster, ...overrides,
  });
}

// ---------------------------------------------------------------------
// PlayerRegistry — invariantes de identidad (sección 4.3 del prompt).
// ---------------------------------------------------------------------

check('register/get: misma instancia recuperada por id', () => {
  const registry = new PlayerRegistry();
  const player = makePlayer({ id: 'reg-1' });
  registry.register(player);
  assert.strictEqual(registry.get('reg-1'), player);
});

check('register: id vacío se rechaza con error descriptivo', () => {
  const registry = new PlayerRegistry();
  assert.throws(() => registry.register({ id: '' }), /id válido/);
  assert.throws(() => registry.register(null), /id válido/);
});

check('register: id duplicado con OTRA instancia se rechaza', () => {
  const registry = new PlayerRegistry();
  registry.register(makePlayer({ id: 'dup-1' }));
  assert.throws(() => registry.register(makePlayer({ id: 'dup-1' })), /ya existe un jugador distinto/);
});

check('register: la MISMA instancia se puede re-registrar sin error (idempotente)', () => {
  const registry = new PlayerRegistry();
  const player = makePlayer({ id: 'idem-1' });
  registry.register(player);
  assert.doesNotThrow(() => registry.register(player));
  assert.strictEqual(registry.size, 1);
});

check('require: lanza con mensaje útil si el id no existe', () => {
  const registry = new PlayerRegistry();
  assert.throws(() => registry.require('nope'), /no existe ningún jugador/);
});

check('get: devuelve un jugador aunque teamId sea null', () => {
  const registry = new PlayerRegistry();
  const player = makePlayer({ id: 'free-1' });
  player.teamId = null;
  registry.register(player);
  assert.strictEqual(registry.get('free-1'), player);
  assert.strictEqual(registry.get('free-1').teamId, null);
});

check('all(): sin duplicados tras registerMany de varios equipos', () => {
  const registry = new PlayerRegistry();
  const teamA = makeTeam({ roster: makeRoster(8, 'a') });
  const teamB = makeTeam({ roster: makeRoster(8, 'b') });
  registry.registerMany(teamA.roster);
  registry.registerMany(teamB.roster);
  assert.strictEqual(registry.all().length, 16);
  assert.strictEqual(new Set(registry.all().map((p) => p.id)).size, 16);
});

check('forTeam(): vista derivada por afiliación actual, no una fuente aparte', () => {
  const registry = new PlayerRegistry();
  const team = makeTeam({ roster: makeRoster(8, 'c') });
  registry.registerMany(team.roster);
  assert.strictEqual(registry.forTeam(team.id).length, 8);
  team.removePlayer('c-0');
  registry.setAffiliation('c-0', null);
  assert.strictEqual(registry.forTeam(team.id).length, 7);
  assert.strictEqual(registry.get('c-0').teamId, null);
});

check('setAffiliation: liberar y reincorporar conserva la misma instancia', () => {
  const registry = new PlayerRegistry();
  const team = makeTeam({ roster: makeRoster(8, 'd') });
  registry.registerMany(team.roster);
  const player = registry.require('d-0');
  player.careerHistory = { marker: 'kept' };
  team.removePlayer('d-0');
  registry.setAffiliation('d-0', null);
  assert.strictEqual(registry.get('d-0'), player);
  assert.strictEqual(registry.get('d-0').careerHistory.marker, 'kept');
  team.addPlayer(player);
  registry.setAffiliation('d-0', team.id);
  assert.strictEqual(registry.get('d-0'), player);
  assert.strictEqual(player.teamId, team.id);
});

check('validateAgainstTeams: detecta teamId incoherente', () => {
  const registry = new PlayerRegistry();
  const team = makeTeam({ roster: makeRoster(4, 'e') });
  registry.registerMany(team.roster);
  team.roster[0].teamId = 'wrong-team-id';
  const report = registry.validateAgainstTeams([team]);
  assert.strictEqual(report.valid, false);
  assert.ok(report.errors.some((e) => e.includes('no coincide')));
});

check('validateAgainstTeams: detecta doble afiliación (mismo id en dos rosters)', () => {
  const registry = new PlayerRegistry();
  const shared = makePlayer({ id: 'shared-1' });
  const teamA = makeTeam({ roster: [shared, ...makeRoster(7, 'fa')] });
  const teamB = makeTeam({ roster: [shared, ...makeRoster(7, 'fb')] });
  registry.register(shared);
  registry.registerMany(teamA.roster.slice(1));
  registry.registerMany(teamB.roster.slice(1));
  const report = registry.validateAgainstTeams([teamA, teamB]);
  assert.strictEqual(report.valid, false);
  assert.ok(report.errors.some((e) => e.includes('más de una plantilla')));
});

check('validateAgainstTeams: informe limpio cuando todo es coherente', () => {
  const registry = new PlayerRegistry();
  const team = makeTeam({ roster: makeRoster(8, 'g') });
  registry.registerMany(team.roster);
  const report = registry.validateAgainstTeams([team]);
  assert.deepStrictEqual(report, { valid: true, errors: [] });
});

// ---------------------------------------------------------------------
// CompetitionRules — identidad de competición, bundles, resolución.
// ---------------------------------------------------------------------

check('competitionIdFromLegacyDivision: mapea 1ª/2ª a ids estables', () => {
  assert.strictEqual(CompetitionRules.competitionIdFromLegacyDivision('1ª'), 'acb');
  assert.strictEqual(CompetitionRules.competitionIdFromLegacyDivision('2ª'), 'primera-feb');
});

check('competitionIdFromLegacyDivision: división desconocida lanza (nunca ACB por defecto)', () => {
  assert.throws(() => CompetitionRules.competitionIdFromLegacyDivision('3ª'), /desconocida/);
});

check('resolveRules: ACB resuelve 8-12 con trazabilidad', () => {
  const resolved = CompetitionRules.resolveRules({
    competitionId: 'acb', seasonKey: '2026-27', date: REF_DATE, operation: 'buildMatchSquad',
  });
  assert.deepStrictEqual(resolved.squadRules, { min: 8, max: 12 });
  assert.strictEqual(resolved.trace.bundleId, 'acb-domestic-2025-26-v1');
  assert.ok(resolved.trace.sourceRuleIds.includes('acb-registration-2025-26-v1'));
  assert.ok(resolved.capabilities.has('matchSquadSizeLimit'));
});

check('resolveRules: Primera FEB resuelve 10-12', () => {
  const resolved = CompetitionRules.resolveRules({
    competitionId: 'primera-feb', seasonKey: '2026-27', date: REF_DATE, operation: 'buildMatchSquad',
  });
  assert.deepStrictEqual(resolved.squadRules, { min: 10, max: 12 });
});

check('resolveRules: capacidades no implementadas no aparecen como activas', () => {
  const resolved = CompetitionRules.resolveRules({ competitionId: 'acb', operation: 'buildMatchSquad' });
  assert.ok(!resolved.capabilities.has('rightOfFirstRefusal'));
  assert.ok(!resolved.capabilities.has('loanEligible'));
  assert.ok(resolved.notImplemented.includes('employment'));
  assert.ok(resolved.notImplemented.includes('market'));
  assert.ok(resolved.notImplemented.some((f) => f.startsWith('registration.')));
});

check('resolveRules: competición desconocida lanza explícito (nunca hereda ACB)', () => {
  assert.throws(
    () => CompetitionRules.resolveRules({ competitionId: 'euroleague-not-real', operation: 'buildMatchSquad' }),
    /competición desconocida/,
  );
});

check('resolveRules: bundleId inexistente lanza explícito', () => {
  assert.throws(
    () => CompetitionRules.resolveRules({ competitionId: 'acb', bundleId: 'acb-domestic-1999-00-v1' }),
    /no existe el bundle/,
  );
});

check('resolveRules: perfil ficticio de test funciona sin ramas nuevas (6-9)', () => {
  const resolved = CompetitionRules.resolveRules({
    competitionId: CompetitionRules.COMPETITION_IDS.TEST_FICTIONAL, operation: 'buildMatchSquad',
  });
  assert.deepStrictEqual(resolved.squadRules, { min: 6, max: 9 });
});

check('resolveRules: overlay compone min/max con estrategia semántica (no "el último gana")', () => {
  // Mínimos concurrentes: se conserva el MAYOR.
  const tighterMin = CompetitionRules.resolveRules({
    competitionId: 'acb', operation: 'buildMatchSquad', overlays: [{ matchSquad: { min: 9 } }],
  });
  assert.deepStrictEqual(tighterMin.squadRules, { min: 9, max: 12 });
  const looserMinIgnored = CompetitionRules.resolveRules({
    competitionId: 'acb', operation: 'buildMatchSquad', overlays: [{ matchSquad: { min: 6 } }],
  });
  assert.strictEqual(looserMinIgnored.squadRules.min, 8, 'un overlay que RELAJA el mínimo no debe ganar');
  // Máximos concurrentes: se conserva el MENOR.
  const tighterMax = CompetitionRules.resolveRules({
    competitionId: 'acb', operation: 'buildMatchSquad', overlays: [{ matchSquad: { max: 10 } }],
  });
  assert.deepStrictEqual(tighterMax.squadRules, { min: 8, max: 10 });
  const looserMaxIgnored = CompetitionRules.resolveRules({
    competitionId: 'acb', operation: 'buildMatchSquad', overlays: [{ matchSquad: { max: 20 } }],
  });
  assert.strictEqual(looserMaxIgnored.squadRules.max, 12, 'un overlay que RELAJA el máximo no debe ganar');
});

check('RulesetBundle: ACB/FEB declaran fuentes oficiales con URL y temporada', () => {
  const acbModule = CompetitionRules.REGISTRATION_MODULES['acb-registration-2025-26-v1'];
  const febModule = CompetitionRules.REGISTRATION_MODULES['primera-feb-registration-2026-27-v1'];
  assert.ok(acbModule.sourceRefs[0].url.includes('acb.com'));
  assert.strictEqual(acbModule.effectiveSeason, '2025-26');
  assert.ok(febModule.sourceRefs[0].url.includes('feb.es'));
  assert.strictEqual(febModule.effectiveSeason, '2026-27');
  assert.ok(febModule.knownSourceInconsistency, 'la discrepancia 13-15 del PDF FEB debe quedar registrada');
});

// ---------------------------------------------------------------------
// Vertical funcional: convocatoria por competición (Team.buildMatchSquad).
// ---------------------------------------------------------------------

check('Team.buildMatchSquad: ACB acepta 8 y 12, rechaza 7 con mensaje del rango correcto', () => {
  const team = makeTeam({ division: '1ª', roster: makeRoster(12, 'acb') });
  const acbRules = CompetitionRules.resolveRules({ competitionId: 'acb', operation: 'buildMatchSquad' }).squadRules;
  assert.strictEqual(team.buildMatchSquad(team.roster.slice(0, 8).map((p) => p.id), acbRules.min, acbRules.max).length, 8);
  assert.strictEqual(team.buildMatchSquad(team.roster.slice(0, 12).map((p) => p.id), acbRules.min, acbRules.max).length, 12);
  assert.throws(
    () => team.buildMatchSquad(team.roster.slice(0, 7).map((p) => p.id), acbRules.min, acbRules.max),
    /entre 8 y 12/,
  );
});

check('Team.buildMatchSquad: Primera FEB exige 10, rechaza 9 con mensaje del rango correcto', () => {
  const team = makeTeam({ division: '2ª', roster: makeRoster(12, 'feb') });
  const febRules = CompetitionRules.resolveRules({ competitionId: 'primera-feb', operation: 'buildMatchSquad' }).squadRules;
  assert.strictEqual(team.buildMatchSquad(team.roster.slice(0, 10).map((p) => p.id), febRules.min, febRules.max).length, 10);
  assert.throws(
    () => team.buildMatchSquad(team.roster.slice(0, 9).map((p) => p.id), febRules.min, febRules.max),
    /entre 10 y 12/,
  );
});

check('Team.buildMatchSquad: sin overrides reproduce el default legacy 8-12', () => {
  const team = makeTeam({ roster: makeRoster(12, 'legacy') });
  assert.strictEqual(team.buildMatchSquad(team.roster.slice(0, 8).map((p) => p.id)).length, 8);
  assert.throws(() => team.buildMatchSquad(team.roster.slice(0, 7).map((p) => p.id)), /entre 8 y 12/);
});

check('Medical.resolveEffectiveSquadMinimum: combina mínimo normal de la competición con el absoluto médico', () => {
  const config = CONFIG_BASE;
  // ACB (normal 8): con 6 disponibles, la excepción baja a 6 (nunca <5).
  assert.strictEqual(Medical.resolveEffectiveSquadMinimum(8, config, 6), 6);
  // Primera FEB (normal 10): con 6 disponibles, la excepción baja a 6.
  assert.strictEqual(Medical.resolveEffectiveSquadMinimum(10, config, 6), 6);
  // Con escasez extrema (3 disponibles) nunca baja del mínimo absoluto (5).
  assert.strictEqual(Medical.resolveEffectiveSquadMinimum(10, config, 3), 5);
  // Con plantilla sana (12 disponibles) nunca sube del mínimo normal.
  assert.strictEqual(Medical.resolveEffectiveSquadMinimum(8, config, 12), 8);
  assert.strictEqual(Medical.resolveEffectiveSquadMinimum(10, config, 12), 10);
});

check('MatchConfig: normalMinimum ya NO vive en config.medical.squadException (sección universal retirada)', () => {
  assert.strictEqual(CONFIG_BASE.medical.squadException.normalMinimum, undefined);
  assert.strictEqual(CONFIG_BASE.medical.squadException.absoluteMinimum, 5);
});

// ---------------------------------------------------------------------
// Puente de cobertura de datos (relleno ficticio de rosters incompletos).
// ---------------------------------------------------------------------

check('padRosterToMinimum: no añade nada si el roster ya alcanza el mínimo', () => {
  const roster = makeRoster(10, 'full');
  const added = padRosterToMinimum(roster, 10, { referenceDate: REF_DATE });
  assert.strictEqual(added.length, 0);
  assert.strictEqual(roster.length, 10);
});

check('padRosterToMinimum: completa hasta el mínimo y marca dataSource de fallback', () => {
  const roster = makeRoster(8, 'short');
  const added = padRosterToMinimum(roster, 10, { minAge: 18, maxAge: 34, referenceDate: REF_DATE });
  assert.strictEqual(added.length, 2);
  assert.strictEqual(roster.length, 10);
  added.forEach((p) => assert.strictEqual(p.dataSource, FICTIONAL_FALLBACK_DATA_SOURCE));
  // Los 8 "reales" originales no quedan marcados como fallback.
  roster.slice(0, 8).forEach((p) => assert.notStrictEqual(p.dataSource, FICTIONAL_FALLBACK_DATA_SOURCE));
});

check('padRosterToMinimum: distingue "roster fuente incompleto" de "10 inscritos con bajas médicas" — no toca rosters ya completos', () => {
  // Un roster de 10 con varias bajas médicas (simuladas aparte por
  // Medical.js) NO debe activar el puente de datos — el roster en sí
  // sigue teniendo 10 jugadores reales, el problema (si lo hay) es de
  // disponibilidad médica, no de cobertura de datos.
  const roster = makeRoster(10, 'medical-shortage');
  const added = padRosterToMinimum(roster, 10, { referenceDate: REF_DATE });
  assert.strictEqual(added.length, 0, 'un roster con 10 jugadores reales no es "cobertura incompleta" aunque varios estén lesionados');
});

check('generateFictionalPlayer (usado por el relleno): instancia normal de Player, apta para PlayerRegistry', () => {
  const registry = new PlayerRegistry();
  const player = generateFictionalPlayer({ minAge: 18, maxAge: 34, referenceDate: REF_DATE });
  player.dataSource = FICTIONAL_FALLBACK_DATA_SOURCE;
  assert.doesNotThrow(() => registry.register(player));
  assert.ok(player.id);
});

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
