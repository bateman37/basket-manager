// scripts/test-national-teams1.js
// NATIONAL-TEAMS-1 (DESIGN.md 10.17) — batería DIRIGIDA (sección 10 del
// prompt): ~20 comprobaciones AGRUPADAS, no centenares de asserts
// impresos. Fixture ficticio (nunca instalado en producción). Convención
// del proyecto: identificadores en inglés, comentarios en español.

const assert = require('assert');

const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Team } = require('../src/entities/Team.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const { CompetitionDefinition, CompetitionEdition, CompetitionStage, CompetitionEntry } = require('../src/entities/Competition.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { PlayerRegulatoryProfile } = require('../src/entities/Registration.js');
const { EligibilityService } = require('../src/core/EligibilityService.js');
const { RegulatoryClassificationService } = require('../src/core/RegulatoryClassificationService.js');
const { generateFictionalTeams } = require('../src/utils/teamGenerator.js');
const { COMPETITION_IDS } = require('../src/core/CompetitionCatalog.js');

const {
  NationalStatusDecision, NationalTeamWindow, NationalTeamAppearanceReceipt,
} = require('../src/entities/NationalTeam.js');
const { NationalTeamRegistry } = require('../src/core/NationalTeamRegistry.js');
const { NationalTeamEligibilityService } = require('../src/core/NationalTeamEligibilityService.js');
const { NationalTeamService } = require('../src/core/NationalTeamService.js');
const NationalTeamRules = require('../src/core/NationalTeamRules.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${err.message}`);
  }
}

function assertThrows(fn, messageContains, label) {
  let threw = false;
  try { fn(); } catch (err) {
    threw = true;
    if (messageContains && !err.message.includes(messageContains)) {
      throw new Error(`${label}: lanzó, pero sin "${messageContains}" — mensaje real: ${err.message}`);
    }
  }
  if (!threw) throw new Error(`${label}: debía lanzar y no lo hizo.`);
}

// -----------------------------------------------------------------------
// Fixture — mundo ficticio pequeño: un club-team (con jugadores reales) +
// un national-team asociado a una federación/área — NUNCA instalado en
// producción.
// -----------------------------------------------------------------------
let seq = 0;
function buildFixture() {
  seq += 1;
  const tag = `nt-test-${seq}`;
  const world = new GameWorld({ id: `world:${tag}`, careerSeed: `${tag}-seed` });
  world.registries.registerArea(new GeographicArea({ id: `${tag}-area-world`, type: 'world', parentAreaId: null, name: 'Mundo' }));
  world.registries.registerArea(new GeographicArea({
    id: `${tag}-area-continent`, type: 'continent', parentAreaId: `${tag}-area-world`, name: '[TEST] Continente',
  }));
  world.registries.registerArea(new GeographicArea({
    id: `${tag}-area-country`, type: 'country', parentAreaId: `${tag}-area-continent`, name: '[TEST] Testland', isoCode: 'XX',
  }));

  // Club-team real, con roster real, para probar la doble pertenencia.
  const clubOrgId = `${tag}-club-fed`;
  world.registries.registerOrganization(new Organization({
    id: clubOrgId, name: '[TEST] Federación doméstica', type: 'national-federation', headquartersAreaId: `${tag}-area-country`, scopeAreaId: `${tag}-area-country`,
  }));
  const [clubTeam] = generateFictionalTeams(1, { seed: `${tag}-club-team` });
  const club = new Club({
    id: `${tag}-club`, name: clubTeam.name, homeAreaId: `${tag}-area-country`, employerJurisdictionAreaId: `${tag}-area-country`, primaryTeamId: clubTeam.id, dataSource: 'test-fixture',
  });
  world.registries.registerClub(club);
  clubTeam.clubId = club.id;
  clubTeam.club = club;
  world.registries.registerTeam(clubTeam);
  const clubSquad = new Squad({ id: `${tag}-club-squad`, teamId: clubTeam.id, players: clubTeam.roster, dataSource: 'test-fixture' });
  world.registries.registerSquad(clubSquad);
  clubTeam.squad = clubSquad;
  clubTeam.primarySquadId = clubSquad.id;

  // National federation + national team.
  const fedOrgId = `${tag}-national-fed`;
  world.registries.registerOrganization(new Organization({
    id: fedOrgId, name: '[TEST] Federación Nacional A', type: 'national-federation', headquartersAreaId: `${tag}-area-country`, scopeAreaId: `${tag}-area-country`,
  }));
  const nationalTeam = new Team({
    id: `${tag}-national-team`, name: '[TEST] Selección A', teamKind: 'national-team',
    federationOrganizationId: fedOrgId, representedAreaId: `${tag}-area-country`,
    category: { gender: 'men', ageTier: 'senior' },
  });
  world.registries.registerTeam(nationalTeam);

  const playerRegistry = new PlayerRegistry();
  clubTeam.roster.forEach((p) => playerRegistry.register(p));

  const registrationRegistry = new RegistrationRegistry();

  const nationalTeamRegistry = new NationalTeamRegistry();
  world.attachDomainRegistries({ playerRegistry, registrationRegistry, nationalTeamRegistry });

  const service = new NationalTeamService({ nationalTeamRegistry, world, playerRegistry, rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID });

  return {
    tag, world, club, clubTeam, clubSquad, nationalTeam, fedOrgId, areaId: `${tag}-area-country`,
    playerRegistry, registrationRegistry, nationalTeamRegistry, service,
  };
}

function buildWindow(fx, overrides = {}) {
  return fx.service.openWindow({
    id: overrides.id || `${fx.tag}-window`,
    seasonKey: '2026-27',
    windowKind: 'fiba-window',
    organizerOrganizationId: fx.fedOrgId,
    timeZoneId: 'UTC',
    noticeDueAt: '2026-06-01T00:00:00Z',
    preliminaryRosterDueAt: '2026-06-10T00:00:00Z',
    finalRosterDueAt: '2026-06-20T00:00:00Z',
    dutyStartsAt: '2026-07-01T00:00:00Z',
    dutyEndsAt: '2026-07-15T00:00:00Z',
    ...overrides,
  });
}

// =========================================================================
// 1. Team: teamKind + relaciones válidas/inválidas.
// =========================================================================
check('Team: teamKind por defecto club-team; national-team exige relaciones válidas', () => {
  const fx = buildFixture();
  assert.strictEqual(fx.clubTeam.teamKind, 'club-team');
  assert.strictEqual(fx.nationalTeam.teamKind, 'national-team');
  assert.strictEqual(fx.nationalTeam.clubId, null);
  assert.strictEqual(fx.nationalTeam.federationOrganizationId, fx.fedOrgId);
  assertThrows(() => new Team({
    id: 'bad-nt-1', teamKind: 'national-team', clubId: 'some-club', federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId,
  }), 'no puede declarar "clubId"', 'national-team con clubId debe lanzar');
  assertThrows(() => new Team({ id: 'bad-nt-2', teamKind: 'national-team', representedAreaId: fx.areaId }), 'federationOrganizationId', 'national-team sin federación debe lanzar');
  assertThrows(() => new Team({ id: 'bad-nt-3', teamKind: 'national-team', federationOrganizationId: fx.fedOrgId }), 'representedAreaId', 'national-team sin área debe lanzar');
});

check('WorldRegistries.registerTeam: BUG-NATIONAL1-01 corregido (national-team sin club se registra)', () => {
  const fx = buildFixture();
  assert.strictEqual(fx.world.registries.teams.get(fx.nationalTeam.id), fx.nationalTeam);
  assert.deepStrictEqual(fx.world.validateIntegrity(), []);
  // Federación con type incorrecto -> registerTeam debe rechazar.
  fx.world.registries.registerOrganization(new Organization({
    id: `${fx.tag}-wrong-org`, name: '[TEST] Operador de liga', type: 'league-operator', headquartersAreaId: fx.areaId, scopeAreaId: fx.areaId,
  }));
  const badTeam = new Team({
    id: `${fx.tag}-bad-nt`, teamKind: 'national-team', federationOrganizationId: `${fx.tag}-wrong-org`, representedAreaId: fx.areaId,
  });
  assertThrows(() => fx.world.registries.registerTeam(badTeam), 'no es "national-federation"', 'registerTeam debe exigir type national-federation');
});

// =========================================================================
// 2. Squad: membershipContext, doble pertenencia, unicidad por contexto.
// =========================================================================
check('Squad: membershipContext por defecto club-service y serializa', () => {
  const fx = buildFixture();
  assert.strictEqual(fx.clubSquad.membershipContext, 'club-service');
  const json = fx.clubSquad.toJSON();
  assert.strictEqual(json.membershipContext, 'club-service');
  assertThrows(() => new Squad({ id: 'bad-squad', teamId: fx.clubTeam.id, membershipContext: 'not-a-context' }), 'membershipContext', 'membershipContext inválido debe lanzar');
});

check('BUG-NATIONAL1-03 corregido: doble pertenencia club+selección, identidad estricta de Player', () => {
  const fx = buildFixture();
  const player = fx.clubTeam.roster[0];
  const originalTeamId = player.teamId;
  const ntSquad = new Squad({
    id: `${fx.tag}-nt-squad`, teamId: fx.nationalTeam.id, membershipContext: 'national-team-duty', players: [player], dataSource: 'test-fixture',
  });
  // No lanza: un squad activo de club-service Y uno de national-team-duty
  // pueden coexistir para el MISMO jugador (invariante 4).
  fx.world.registries.registerSquad(ntSquad);
  assert.strictEqual(fx.world.registries.squads.activeClubSquadForPlayer(player.id), fx.clubSquad);
  assert.strictEqual(fx.world.registries.squads.activeNationalTeamSquadForPlayer(player.id), ntSquad);
  // Alias legacy documentado — sigue siendo club-service, nunca nacional.
  assert.strictEqual(fx.world.registries.squads.activeSquadForPlayer(player.id), fx.clubSquad);
  // Identidad ESTRICTA: la misma instancia viva en ambos squads.
  assert.strictEqual(fx.clubSquad.players.find((p) => p.id === player.id), ntSquad.players.find((p) => p.id === player.id));
  assert.deepStrictEqual(fx.world.validateIntegrity(), []);
  // Player.teamId nunca lo toca una convocatoria (invariante 3).
  assert.strictEqual(player.teamId, originalTeamId);

  // Un SEGUNDO squad activo del MISMO contexto para el mismo jugador (con
  // OTRA selección, para no chocar antes con la unicidad "un squad activo
  // por Team") SÍ debe seguir bloqueado — la unicidad por contexto no es
  // "sin unicidad".
  const secondFedOrgId = `${fx.tag}-national-fed-2`;
  fx.world.registries.registerOrganization(new Organization({
    id: secondFedOrgId, name: '[TEST] Federación Nacional B', type: 'national-federation', headquartersAreaId: fx.areaId, scopeAreaId: fx.areaId,
  }));
  const nationalTeam2 = new Team({
    id: `${fx.tag}-national-team-2`, name: '[TEST] Selección B', teamKind: 'national-team', federationOrganizationId: secondFedOrgId, representedAreaId: fx.areaId,
  });
  fx.world.registries.registerTeam(nationalTeam2);
  const secondNtSquad = new Squad({
    id: `${fx.tag}-nt-squad-2`, teamId: nationalTeam2.id, membershipContext: 'national-team-duty', players: [player],
  });
  assertThrows(() => fx.world.registries.registerSquad(secondNtSquad), 'ya está en el squad activo', 'dos squads activos del mismo contexto (con otra selección) deben chocar');
});

// =========================================================================
// 3. CompetitionEntry nacional válido/inválido (BUG-NATIONAL1-02).
// =========================================================================
function buildNationalCompetition(fx) {
  const definition = new CompetitionDefinition({
    id: `${fx.tag}-continental-cup`, name: '[TEST] Copa Continental', scopeLevel: 'continental', scopeAreaId: `${fx.tag}-area-continent`,
    organizerId: fx.fedOrgId, participantType: 'national-team', kind: 'championship', implementationStatus: 'active-runtime', bindings: {},
  });
  fx.world.registries.registerCompetitionDefinition(definition);
  const edition = new CompetitionEdition({
    id: `${fx.tag}-continental-cup-edition`, competitionDefinitionId: definition.id, seasonKey: '2026-27', status: 'active', detailLevel: 'standard',
  });
  fx.world.registries.registerCompetitionEdition(edition);
  const stage = new CompetitionStage({
    id: `${fx.tag}-continental-cup-stage`, editionId: edition.id, stageType: 'round-robin', status: 'active', stageKey: 'group',
  });
  fx.world.registries.registerCompetitionStage(stage);
  return { definition, edition, stage };
}

check('Entry nacional válido: motor común (CompetitionDefinition/Edition/Stage/Entry)', () => {
  const fx = buildFixture();
  const { edition, stage } = buildNationalCompetition(fx);
  const entry = new CompetitionEntry({
    id: `${fx.tag}-entry-a`, editionId: edition.id, stageId: stage.id, participantType: 'national-team', participantId: fx.nationalTeam.id, entryStatus: 'active',
  });
  fx.world.registries.registerCompetitionEntry(entry);
  assert.deepStrictEqual(fx.world.validateIntegrity(), []);
  assert.strictEqual(fx.world.registries.competitionEntries.forParticipant(fx.nationalTeam.id)[0].id, entry.id);
});

check('BUG-NATIONAL1-02 corregido: Entry inválido rechazado AL REGISTRAR (teamKind/participante)', () => {
  const fx = buildFixture();
  const { edition, stage } = buildNationalCompetition(fx);
  const mismatchEntry = new CompetitionEntry({
    id: `${fx.tag}-entry-bad-kind`, editionId: edition.id, stageId: stage.id, participantType: 'national-team', participantId: fx.clubTeam.id, entryStatus: 'active',
  });
  assertThrows(() => fx.world.registries.registerCompetitionEntry(mismatchEntry), 'club-team', 'Entry con teamKind incompatible debe lanzar al registrar');
  const ghostEntry = new CompetitionEntry({
    id: `${fx.tag}-entry-ghost`, editionId: edition.id, stageId: stage.id, participantType: 'national-team', participantId: `${fx.tag}-no-existe`, entryStatus: 'active',
  });
  assertThrows(() => fx.world.registries.registerCompetitionEntry(ghostEntry), 'participante inexistente', 'Entry con participante inexistente debe lanzar al registrar');
});

// =========================================================================
// 4. Serialización — plano, sin Map/funciones/instancias vivas.
// =========================================================================
check('Serialización: entidades nacionales son JSON plano', () => {
  const fx = buildFixture();
  const window = buildWindow(fx);
  const decision = new NationalStatusDecision({
    id: `${fx.tag}-decision`, playerId: fx.clubTeam.roster[0].id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId,
    status: 'approved-unrestricted', decidedAtGameDate: '2026-05-01', rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID,
  });
  const receipt = new NationalTeamAppearanceReceipt({
    id: `${fx.tag}-appearance`, playerId: fx.clubTeam.roster[0].id, nationalTeamId: fx.nationalTeam.id, federationOrganizationId: fx.fedOrgId,
    competitionEditionId: 'edition-x', stageId: 'stage-x', matchId: 'match-x', date: '2026-07-05', official: true, detailLevel: 'playable',
  });
  // Las entidades NUEVAS de esta entrega son JSON plano completo (round
  // trip exacto). `Team.toJSON()`/`Squad.toJSON()` preexistentes incrustan
  // alguna instancia viva ajena a esta entrega (p.ej. `tacticalProfile`,
  // TAC-2) — fuera de alcance tocarlo aquí; solo se comprueba que
  // `JSON.stringify()` no lanza y que los campos NUEVOS son planos.
  [window.toJSON(), decision.toJSON(), receipt.toJSON()].forEach((plain) => {
    const roundTrip = JSON.parse(JSON.stringify(plain));
    assert.deepStrictEqual(roundTrip, plain);
    assert.strictEqual(typeof plain, 'object');
  });
  assert.doesNotThrow(() => JSON.stringify(fx.clubTeam.toJSON()));
  assert.doesNotThrow(() => JSON.stringify(fx.nationalTeam.toJSON()));
  assert.doesNotThrow(() => JSON.stringify(fx.clubSquad.toJSON()));
  const nationalTeamJson = fx.nationalTeam.toJSON();
  assert.strictEqual(nationalTeamJson.teamKind, 'national-team');
  assert.strictEqual(nationalTeamJson.clubId, null);
  assert.strictEqual(typeof nationalTeamJson.federationOrganizationId, 'string');
  assert.strictEqual(fx.clubSquad.toJSON().membershipContext, 'club-service');
});

// =========================================================================
// 5. Ciudadanía/pasaporte/decisión/unknown (NationalTeamEligibilityService).
// =========================================================================
check('NationalTeamEligibilityService: pasaporte ausente -> unknown (nunca elegible silencioso)', () => {
  const fx = buildFixture();
  const player = fx.clubTeam.roster[0];
  fx.registrationRegistry.registerProfile(new PlayerRegulatoryProfile({ playerId: player.id }));
  const evaluation = NationalTeamEligibilityService.evaluateNationalEligibility(
    { playerId: player.id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId, date: '2026-06-01' },
    { playerRegistry: fx.playerRegistry, registrationRegistry: fx.registrationRegistry, nationalTeamRegistry: fx.nationalTeamRegistry, rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID },
  );
  assert.strictEqual(evaluation.status, 'unknown');
  assert.ok(evaluation.reasonCodes.includes('PASSPORT_NOT_DEMONSTRATED'));
});

check('NationalTeamEligibilityService: pasaporte caducado/invalido -> ineligible; válido sin decisión -> pending-decision', () => {
  const fx = buildFixture();
  const [expiredPlayer, pendingPlayer] = fx.clubTeam.roster;
  fx.registrationRegistry.registerProfile(new PlayerRegulatoryProfile({
    playerId: expiredPlayer.id,
    passportEvidences: [{ id: 'pp-1', areaId: fx.areaId, expiryDate: '2020-01-01', verificationStatus: 'verified' }],
  }));
  fx.registrationRegistry.registerProfile(new PlayerRegulatoryProfile({
    playerId: pendingPlayer.id,
    passportEvidences: [{ id: 'pp-2', areaId: fx.areaId, expiryDate: '2030-01-01', verificationStatus: 'verified' }],
  }));
  const deps = { playerRegistry: fx.playerRegistry, registrationRegistry: fx.registrationRegistry, nationalTeamRegistry: fx.nationalTeamRegistry, rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID };
  const expiredEval = NationalTeamEligibilityService.evaluateNationalEligibility(
    { playerId: expiredPlayer.id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId, date: '2026-06-01' }, deps,
  );
  assert.strictEqual(expiredEval.status, 'ineligible');
  const pendingEval = NationalTeamEligibilityService.evaluateNationalEligibility(
    { playerId: pendingPlayer.id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId, date: '2026-06-01' }, deps,
  );
  assert.strictEqual(pendingEval.status, 'pending-decision');
  assert.ok(pendingEval.reasonCodes.includes('NATIONALITY_DECISION_REQUIRED'));
});

check('NationalTeamEligibilityService: decisión aprobada (unrestricted/restricted) manda', () => {
  const fx = buildFixture();
  const [p1, p2] = fx.clubTeam.roster;
  fx.registrationRegistry.registerProfile(new PlayerRegulatoryProfile({ playerId: p1.id }));
  fx.registrationRegistry.registerProfile(new PlayerRegulatoryProfile({ playerId: p2.id }));
  fx.nationalTeamRegistry.registerDecision(new NationalStatusDecision({
    id: `${fx.tag}-decision-1`, playerId: p1.id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId,
    status: 'approved-unrestricted', decidedAtGameDate: '2026-05-01', rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID, validFrom: '2026-05-01',
  }));
  fx.nationalTeamRegistry.registerDecision(new NationalStatusDecision({
    id: `${fx.tag}-decision-2`, playerId: p2.id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId,
    status: 'approved-restricted', decidedAtGameDate: '2026-05-01', rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID, validFrom: '2026-05-01',
  }));
  const deps = { playerRegistry: fx.playerRegistry, registrationRegistry: fx.registrationRegistry, nationalTeamRegistry: fx.nationalTeamRegistry, rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID };
  assert.strictEqual(NationalTeamEligibilityService.evaluateNationalEligibility({ playerId: p1.id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId, date: '2026-06-01' }, deps).status, 'eligible');
  assert.strictEqual(NationalTeamEligibilityService.evaluateNationalEligibility({ playerId: p2.id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId, date: '2026-06-01' }, deps).status, 'eligible-restricted');
});

// =========================================================================
// 6. Listas 24/preliminar y 10-12/final (aquí con el ruleset ficticio
//    6/4-5) — subconjunto y máximo de restringidos.
// =========================================================================
function primeEligiblePlayers(fx, players, restrictedIds) {
  players.forEach((p) => fx.registrationRegistry.registerProfile(new PlayerRegulatoryProfile({ playerId: p.id })));
  players.forEach((p) => {
    fx.nationalTeamRegistry.registerDecision(new NationalStatusDecision({
      id: `${fx.tag}-decision-${p.id}`, playerId: p.id, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId,
      status: restrictedIds.includes(p.id) ? 'approved-restricted' : 'approved-unrestricted',
      decidedAtGameDate: '2026-05-01', rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID, validFrom: '2026-05-01',
    }));
  });
}

function evalFor(fx) {
  return (playerId) => NationalTeamEligibilityService.evaluateNationalEligibility(
    { playerId, federationOrganizationId: fx.fedOrgId, representedAreaId: fx.areaId, date: '2026-06-15' },
    { playerRegistry: fx.playerRegistry, registrationRegistry: fx.registrationRegistry, nationalTeamRegistry: fx.nationalTeamRegistry, rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID },
  );
}

check('Lista preliminar: máximo del ruleset (ficticio 6) y duplicados rechazados', () => {
  const fx = buildFixture();
  const roster = fx.clubTeam.roster;
  primeEligiblePlayers(fx, roster, []);
  const window = buildWindow(fx);
  const selection = fx.service.createSelection({ id: `${fx.tag}-selection`, nationalTeamId: fx.nationalTeam.id, windowId: window.id, seasonKey: '2026-27' });
  assertThrows(() => fx.service.savePreliminaryList(selection.id, roster.map((p) => p.id).concat(roster[0].id)), 'duplicados', 'lista preliminar con duplicados debe lanzar');
  assert.ok(roster.length >= 7, 'el fixture necesita >=7 jugadores para probar el máximo de 6 del ruleset ficticio');
  assertThrows(() => fx.service.savePreliminaryList(selection.id, roster.slice(0, 7).map((p) => p.id)), 'debe tener entre', 'lista preliminar por encima del máximo debe lanzar');
  const saved = fx.service.savePreliminaryList(selection.id, roster.slice(0, 6).map((p) => p.id));
  assert.strictEqual(saved.status, 'preliminary-filed');
  assert.strictEqual(saved.preliminaryPlayerIds.length, 6);
});

check('Lista final: 4-5 (ruleset ficticio), subconjunto de la preliminar, máximo 1 restricted', () => {
  const fx = buildFixture();
  const roster = fx.clubTeam.roster.slice(0, 6);
  primeEligiblePlayers(fx, roster, [roster[0].id, roster[1].id]); // dos restringidos a propósito
  const window = buildWindow(fx);
  const selection = fx.service.createSelection({ id: `${fx.tag}-selection`, nationalTeamId: fx.nationalTeam.id, windowId: window.id, seasonKey: '2026-27' });
  fx.service.savePreliminaryList(selection.id, roster.map((p) => p.id));
  const outsider = fx.clubTeam.roster[6];
  assertThrows(
    () => fx.service.finalizeList(selection.id, [roster[0].id, roster[2].id, roster[3].id, outsider.id], evalFor(fx)),
    'fuera de la lista preliminar', 'lista final con jugador fuera de la preliminar debe lanzar',
  );
  assertThrows(
    () => fx.service.finalizeList(selection.id, [roster[0].id, roster[1].id, roster[2].id, roster[3].id], evalFor(fx)),
    'máximo de 1 jugador(es)', 'lista final con 2 restricted (máximo 1) debe lanzar',
  );
  assertThrows(
    () => fx.service.finalizeList(selection.id, [roster[2].id], evalFor(fx)),
    'debe tener entre', 'lista final por debajo del mínimo debe lanzar',
  );
  const finalized = fx.service.finalizeList(selection.id, [roster[0].id, roster[2].id, roster[3].id, roster[4].id], evalFor(fx));
  assert.strictEqual(finalized.status, 'final-filed');
  assert.strictEqual(finalized.finalPlayerIds.length, 4);
});

// =========================================================================
// 7. Atomicidad e idempotencia.
// =========================================================================
check('Atomicidad: finalizeList fallido no deja estado parcial', () => {
  const fx = buildFixture();
  const roster = fx.clubTeam.roster.slice(0, 5);
  // Un jugador SIN decisión/pasaporte -> 'unknown', bloquea la lista final.
  fx.registrationRegistry.registerProfile(new PlayerRegulatoryProfile({ playerId: roster[0].id }));
  primeEligiblePlayers(fx, roster.slice(1), []);
  const window = buildWindow(fx);
  const selection = fx.service.createSelection({ id: `${fx.tag}-selection`, nationalTeamId: fx.nationalTeam.id, windowId: window.id, seasonKey: '2026-27' });
  fx.service.savePreliminaryList(selection.id, roster.map((p) => p.id));
  assertThrows(() => fx.service.finalizeList(selection.id, roster.map((p) => p.id), evalFor(fx)), 'no es elegible', 'un jugador unknown debe bloquear toda la lista final');
  assert.strictEqual(selection.status, 'preliminary-filed');
  assert.deepStrictEqual(selection.finalPlayerIds, []);
});

check('Idempotencia: startInternationalService/window.setStatus repetidos no duplican ni fallan', () => {
  const fx = buildFixture();
  const roster = fx.clubTeam.roster.slice(0, 4);
  primeEligiblePlayers(fx, roster, []);
  const window = buildWindow(fx);
  const selection = fx.service.createSelection({ id: `${fx.tag}-selection`, nationalTeamId: fx.nationalTeam.id, windowId: window.id, seasonKey: '2026-27' });
  fx.service.savePreliminaryList(selection.id, roster.map((p) => p.id));
  fx.service.finalizeList(selection.id, roster.map((p) => p.id), evalFor(fx));
  fx.service.notifyCallUps(selection.id);
  fx.service.setWindowStatus(window.id, 'open');
  const first = fx.service.startInternationalService(window.id);
  assert.strictEqual(first.length, roster.length);
  // Repetir NO debe reprocesar callups ya 'joined' (filtrados por status).
  const second = fx.service.startInternationalService(window.id);
  assert.strictEqual(second.length, 0);
  const squad = fx.world.registries.squads.forTeam(fx.nationalTeam.id).find((s) => s.status === 'active' && s.membershipContext === 'national-team-duty');
  assert.strictEqual(squad.players.length, roster.length);
  // window.setStatus('active') repetido es idempotente (mismo estado).
  window.setStatus('active');
  assert.strictEqual(window.status, 'active');
});

// =========================================================================
// 8. Duties y reason code de club (EligibilityService.NATIONAL_TEAM_DUTY).
// =========================================================================
check('EligibilityService: NATIONAL_TEAM_DUTY bloquea al club durante el servicio, y solo entonces', () => {
  const fx = buildFixture();
  const roster = fx.clubTeam.roster.slice(0, 4);
  primeEligiblePlayers(fx, roster, []);
  const window = buildWindow(fx);
  const selection = fx.service.createSelection({ id: `${fx.tag}-selection`, nationalTeamId: fx.nationalTeam.id, windowId: window.id, seasonKey: '2026-27' });
  fx.service.savePreliminaryList(selection.id, roster.map((p) => p.id));
  fx.service.finalizeList(selection.id, roster.map((p) => p.id), evalFor(fx));
  fx.service.notifyCallUps(selection.id);
  fx.service.setWindowStatus(window.id, 'open');
  fx.service.startInternationalService(window.id);
  const player = roster[0];

  assert.ok(fx.nationalTeamRegistry.activeDutyForPlayerOn(player.id, '2026-07-05'));
  assert.strictEqual(fx.nationalTeamRegistry.activeDutyForPlayerOn(player.id, '2026-07-20'), null);

  const contextDuring = { competitionId: COMPETITION_IDS.TEST_FICTIONAL, seasonKey: '2026-27', date: '2026-07-05', operation: 'buildMatchSquad' };
  const evaluationDuring = EligibilityService.evaluateEligibility(player.id, fx.clubTeam.id, contextDuring, {
    playerRegistry: fx.playerRegistry, registrationRegistry: fx.registrationRegistry, nationalTeamRegistry: fx.nationalTeamRegistry, clubId: fx.club.id,
  });
  assert.ok(evaluationDuring.reasons.some((r) => r.code === 'NATIONAL_TEAM_DUTY'));

  const contextAfter = { ...contextDuring, date: '2026-07-20' };
  const evaluationAfter = EligibilityService.evaluateEligibility(player.id, fx.clubTeam.id, contextAfter, {
    playerRegistry: fx.playerRegistry, registrationRegistry: fx.registrationRegistry, nationalTeamRegistry: fx.nationalTeamRegistry, clubId: fx.club.id,
  });
  assert.ok(!evaluationAfter.reasons.some((r) => r.code === 'NATIONAL_TEAM_DUTY'), 'tras la ventana, el jugador vuelve a estar disponible');

  // Sin nationalTeamRegistry inyectado (fixture histórico) el bloque nunca
  // se activa — comportamiento IDÉNTICO a antes de esta entrega.
  const evaluationNoRegistry = EligibilityService.evaluateEligibility(player.id, fx.clubTeam.id, contextDuring, {
    playerRegistry: fx.playerRegistry, registrationRegistry: fx.registrationRegistry, clubId: fx.club.id,
  });
  assert.ok(!evaluationNoRegistry.reasons.some((r) => r.code === 'NATIONAL_TEAM_DUTY'));
});

// =========================================================================
// 9. Appearances solo con evidencia de match individual.
// =========================================================================
check('NationalTeamAppearanceReceipt: solo playable/full, nunca standard/abstract', () => {
  const fx = buildFixture();
  const player = fx.clubTeam.roster[0];
  const base = {
    id: `${fx.tag}-appearance-ok`, playerId: player.id, nationalTeamId: fx.nationalTeam.id, federationOrganizationId: fx.fedOrgId,
    competitionEditionId: 'edition-x', stageId: 'stage-x', matchId: 'match-x', date: '2026-07-05', official: true,
  };
  const receipt = fx.service.registerAppearance({ ...base, detailLevel: 'playable' });
  assert.strictEqual(fx.nationalTeamRegistry.appearancesForPlayer(player.id)[0].id, receipt.id);
  assertThrows(() => new NationalTeamAppearanceReceipt({ ...base, id: `${fx.tag}-appearance-bad-1`, detailLevel: 'standard' }), 'detailLevel', 'un receipt "standard" nunca debe crearse');
  assertThrows(() => new NationalTeamAppearanceReceipt({ ...base, id: `${fx.tag}-appearance-bad-2`, detailLevel: 'abstract' }), 'detailLevel', 'un receipt "abstract" nunca debe crearse');
});

check('RegulatoryClassificationService: excepción de formación FEB consulta NationalTeamRegistry (con fallback legacy)', () => {
  const fx = buildFixture();
  const player = fx.clubTeam.roster[0];
  fx.service.registerAppearance({
    id: `${fx.tag}-feb-appearance`, playerId: player.id, nationalTeamId: fx.nationalTeam.id, federationOrganizationId: 'feb-general',
    competitionEditionId: 'edition-x', stageId: 'stage-x', matchId: 'match-x', date: '2026-07-05', official: true, detailLevel: 'playable',
  });
  const profile = new PlayerRegulatoryProfile({ playerId: player.id, trainingPeriods: [] });
  const decision = RegulatoryClassificationService.classifyFormationFeb28(
    profile, { date: '2026-07-06' }, { nationalTeamRegistry: fx.nationalTeamRegistry },
  );
  assert.strictEqual(decision.status, 'qualifies');
  assert.strictEqual(decision.basis, 'national-team');
  // Sin deps.nationalTeamRegistry: cae al fallback legacy (profile.nationalTeamAppearances), nunca rompe.
  const legacyProfile = new PlayerRegulatoryProfile({
    playerId: player.id, trainingPeriods: [], nationalTeamAppearances: [{ id: 'legacy-1', federationId: 'feb-general', official: true }],
  });
  const legacyDecision = RegulatoryClassificationService.classifyFormationFeb28(legacyProfile, { date: '2026-07-06' });
  assert.strictEqual(legacyDecision.status, 'qualifies');
  assert.strictEqual(legacyDecision.basis, 'national-team');
});

// =========================================================================
// 10. Determinismo — orden invertido de registro no cambia el resultado.
// =========================================================================
check('Determinismo: orden de registro invertido no cambia el resultado (NationalTeamRegistry)', () => {
  const fx1 = buildFixture();
  const players = fx1.clubTeam.roster.slice(0, 3);
  const decisions1 = players.map((p, i) => new NationalStatusDecision({
    id: `${fx1.tag}-decision-${i}`, playerId: p.id, federationOrganizationId: fx1.fedOrgId, representedAreaId: fx1.areaId,
    status: 'approved-unrestricted', decidedAtGameDate: '2026-05-01', rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID,
  }));
  decisions1.forEach((d) => fx1.nationalTeamRegistry.registerDecision(d));

  const fx2 = buildFixture();
  const decisions2 = players.map((p, i) => new NationalStatusDecision({
    id: `${fx1.tag}-decision-${i}`, playerId: p.id, federationOrganizationId: fx1.fedOrgId, representedAreaId: fx1.areaId,
    status: 'approved-unrestricted', decidedAtGameDate: '2026-05-01', rulesetBundleId: NationalTeamRules.FICTIONAL_TEST_RULESET_ID,
  }));
  [...decisions2].reverse().forEach((d) => fx2.nationalTeamRegistry.registerDecision(d));

  const idsFromFx1 = fx1.nationalTeamRegistry.allDecisions().map((d) => d.id);
  const idsFromFx2 = fx2.nationalTeamRegistry.allDecisions().map((d) => d.id);
  assert.deepStrictEqual(idsFromFx1, idsFromFx2);
});

check('NationalTeamRules: overlay se compone semánticamente (nunca "el último gana")', () => {
  const base = NationalTeamRules.FIBA_NATIONAL_TEAMS_RULESET;
  const overlay = {
    id: 'test-handbook-overlay',
    rules: {
      maxRestrictedInFinalList: { id: 'overlay-max-restricted', kind: 'maximum', value: 2 },
      nationalityDecisionMinNoticeDays: { id: 'overlay-notice', kind: 'minimum', value: 7 },
    },
  };
  const composed = NationalTeamRules.composeOverlay(base, overlay);
  // maximum: el overlay (2) es MAYOR que el base (1) -> gana el base (más restrictivo).
  assert.strictEqual(composed.rules.maxRestrictedInFinalList.value, 1);
  // minimum: el overlay (7) es MENOR que el base (14) -> gana el base (más exigente).
  assert.strictEqual(composed.rules.nationalityDecisionMinNoticeDays.value, 14);
  assert.strictEqual(composed.overlayOf, base.id);
  assertThrows(() => NationalTeamRules.requireNationalTeamRuleset('no-existe-bundle'), 'ruleset bundle desconocido', 'un bundle desconocido debe lanzar (sin fallback ACB/FEB)');
});

console.log(`\n${passed} OK, ${failed} fallos.`);
process.exit(failed ? 1 : 0);
