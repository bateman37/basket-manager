#!/usr/bin/env node
// scripts/test-club-core1.js
// CLUB-CORE-1 (DESIGN.md sección 10) — batería DIRIGIDA (no exhaustiva) de
// esta entrega de la EPIC "World Architecture". Mismo criterio que
// test-world-core1.js: máximo orientativo ~25 comprobaciones de alto valor,
// nunca una matriz completa. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Grupos:
//   1. Club/Team/Squad con ids DISTINTOS, un Club con varias secciones
//   2. Unicidad de squad activo por equipo y de jugador por squad activo
//   3. Serialización por ids, identidad de instancias, Team.roster como vista
//   4. Migración institucional sin copias mutables duplicadas
//   5. BUG-WORLDCORE-09 (Team.validateDivision)
//   6. Contexto laboral resuelto desde Club/área (nunca team.id por defecto)
//   7. ClubStructureService (frontera pura Club<->Team<->Squad)
//   8. Paquete de test SIN España/ACB (auditoría de fallback)
//   9. Los 36 clubes/equipos reales, MoraBanc Andorra, Contract/Registration/
//      Academy resueltos con la identidad correcta

const assert = require('assert');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { WorldRegistries } = require('../src/core/WorldRegistry.js');
const { ClubStructureService } = require('../src/core/ClubStructureService.js');
const { ClubEmploymentContextCatalog } = require('../src/core/ClubEmploymentContextCatalog.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { Calendar } = require('../src/core/Calendar.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { AcademyRegistry } = require('../src/core/AcademyRegistry.js');
const { AcademyService } = require('../src/core/AcademyService.js');
const { CompetitionContextService } = require('../src/core/CompetitionContextService.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const { SPAIN_MANIFEST, SPAIN_CLUB_CONTENT } = require('../data/world/spain-2026.1.js');
const { WorldSimulationProfile } = require('../src/entities/WorldSimulation.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');

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

const GAME_DATE = '2026-10-03';

function birthDateForAge(age, refIso = GAME_DATE) {
  const ref = LocalDate.parse(refIso);
  return new Date(ref.year - age, ref.month - 1, ref.day);
}

function makePlayer(overrides = {}) {
  return new Player({
    id: overrides.id,
    firstName: 'Test',
    lastName: overrides.lastName || 'Player',
    birthDate: overrides.birthDate || birthDateForAge(overrides.age !== undefined ? overrides.age : 24),
    positions: { Base: 20, Escolta: 5, Alero: 3, 'Ala-pívot': 1, Pívot: 1 },
    nominalPosition: 'Base',
    technical: {},
    physical: { durability: 10, recovery: 10 },
    mental: {},
    hidden: {
      potential: 150, professionalism: 10, ambition: 10, learningRate: 10, learningPersistence: 10,
    },
  });
}

// =========================================================================
// Fixture genérica (NO española): un Club de test con DOS secciones
// (primer equipo senior + juvenil), cada una con su propio Squad — nunca el
// mismo id que su Team, nunca un fallback a ACB/España.
// =========================================================================
function buildTestlandFixture() {
  const registries = new WorldRegistries();
  registries.registerArea(new GeographicArea({ id: 'area-world', type: 'world', parentAreaId: null, name: 'Mundo' }));
  registries.registerArea(new GeographicArea({
    id: 'area-country-testland', type: 'country', parentAreaId: 'area-world', name: 'Testland', isoCode: 'XX',
  }));
  // Área de jurisdicción laboral de TEST — misma que
  // `ClubEmploymentContextCatalog.TEST_JURISDICTION_AREA_ID`, demuestra que
  // dar de alta un país nuevo real es una entrada de catálogo, nunca una
  // rama de código nueva.
  registries.registerArea(new GeographicArea({
    id: ClubEmploymentContextCatalog.TEST_JURISDICTION_AREA_ID, type: 'country', parentAreaId: 'area-world', name: '[TEST] Testland laboral',
  }));
  registries.registerOrganization(new Organization({
    id: 'org-testland-federation', type: 'national-federation', headquartersAreaId: 'area-country-testland', scopeAreaId: 'area-country-testland',
  }));

  const club = new Club({
    id: 'club-testland-warriors',
    name: 'Testland Warriors',
    homeAreaId: 'area-country-testland',
    employerJurisdictionAreaId: ClubEmploymentContextCatalog.TEST_JURISDICTION_AREA_ID,
    federationMembershipOrganizationIds: ['org-testland-federation'],
  });
  registries.registerClub(club);

  const seniorPlayers = [makePlayer({ id: 'testland-senior-p1' }), makePlayer({ id: 'testland-senior-p2' })];
  const teamSenior = new Team({
    id: 'team-testland-warriors-senior', name: 'Testland Warriors', city: 'Testland', roster: seniorPlayers,
  });
  teamSenior.clubId = club.id;
  teamSenior.club = club;
  registries.registerTeam(teamSenior);

  const youthPlayers = [makePlayer({ id: 'testland-youth-p1', age: 17 })];
  const teamYouth = new Team({
    id: 'team-testland-warriors-youth', name: 'Testland Warriors B', city: 'Testland', roster: youthPlayers, role: 'youth', category: { gender: 'men', ageTier: 'youth' },
  });
  teamYouth.clubId = club.id;
  teamYouth.club = club;
  registries.registerTeam(teamYouth);

  club.primaryTeamId = teamSenior.id;

  const squadSenior = new Squad({
    id: 'squad:team-testland-warriors-senior:senior', teamId: teamSenior.id, squadType: 'first-team-senior', status: 'active', players: teamSenior.roster,
  });
  registries.registerSquad(squadSenior);
  teamSenior.squad = squadSenior;
  teamSenior.primarySquadId = squadSenior.id;

  const squadYouth = new Squad({
    id: 'squad:team-testland-warriors-youth:youth', teamId: teamYouth.id, squadType: 'youth', status: 'active', players: teamYouth.roster,
  });
  registries.registerSquad(squadYouth);
  teamYouth.squad = squadYouth;
  teamYouth.primarySquadId = squadYouth.id;

  return {
    registries, club, teamSenior, teamYouth, squadSenior, squadYouth,
  };
}

// =========================================================================
// Fixture española: los 36 equipos reales + GameWorld canónico (sin jugar
// ninguna temporada — mismo patrón que `buildSpainWorld()` de
// test-world-core1.js, cada llamada es barata).
// =========================================================================
function buildRealTeam(teamData) {
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...fields } = playerData;
    const player = new Player(fields);
    player.dataSource = dataSource || null;
    return player;
  });
  return new Team({ ...teamData, roster });
}

function buildTeamsByDivision() {
  const teamsByDivision = { '1ª': [], '2ª': [] };
  ['1ª', '2ª'].forEach((div) => {
    teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div).map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id]));
  });
  return teamsByDivision;
}

// Corrección incidental (no de NATIONAL-TEAMS-1): desde WORLD-SIM-1
// (DESIGN.md 10.16) `spain-2026.1.js` exige `world.simulationProfile`
// asignado ANTES de instalar el paquete — este fixture se había quedado
// sin ese perfil (regresión detectada al ejecutar esta batería como parte
// de la verificación de NATIONAL-TEAMS-1). Mismo perfil TRANSITORIO que usa
// `game.js`/`scripts/test-world-sim1.js`: ACB/Primera FEB/Copa ACB
// "playable" explícito.
// WORLD-CONTEXT-1 (DESIGN.md 10.20): el contexto competitivo llega SIEMPRE
// explícito — aquí se resuelve desde las `CompetitionEntry` reales del mundo
// instalado (nunca de `team.division`).
function competitionResolverFor(world, seasonKey) {
  return CompetitionContextService.makeDomesticCompetitionResolver(world.registries, {
    operation: 'test-club-core1',
    seasonKey,
  });
}

function buildSpainWorld() {
  const teamsByDivision = buildTeamsByDivision();
  const calendar = new Calendar(2026, CONFIG_BASE);
  const simulationProfile = new WorldSimulationProfile({
    id: 'simulation-profile:test-club-core1',
    version: '1.0.0',
    defaultDetailLevel: 'abstract',
    assignments: [
      { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.ACB, detailLevel: 'playable' },
      { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.PRIMERA_FEB, detailLevel: 'playable' },
      { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.COPA_ACB, detailLevel: 'playable' },
    ],
    provenance: { status: 'design', notes: 'Perfil transitorio de test-club-core1.js — mismo criterio que game.js/test-world-sim1.js.' },
  });
  const world = WorldFactory.buildCareerWorld({
    id: 'world:test-club-core1',
    name: 'Mundo de prueba CLUB-CORE-1',
    careerSeed: 'test-club-core1-seed',
    createdAtGameDate: GAME_DATE,
    packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
    context: { teamsByDivision, seasonKey: '2026-27', seasonStartDate: GAME_DATE },
    simulationProfile,
  });
  world.setCalendar(calendar);
  const allTeams = [...teamsByDivision['1ª'], ...teamsByDivision['2ª']];
  return {
    world, teamsByDivision, allTeams,
  };
}

// =========================================================================
// 1. Club/Team/Squad con ids DISTINTOS, un Club con varias secciones
// =========================================================================
group('1. Club/Team/Squad con ids distintos');

check('el Club y sus dos Team tienen ids TODOS distintos entre sí', () => {
  const { club, teamSenior, teamYouth } = buildTestlandFixture();
  const ids = [club.id, teamSenior.id, teamYouth.id];
  assert.strictEqual(new Set(ids).size, 3, 'club/team senior/team youth deben tener 3 ids distintos');
});

check('un Club puede tener VARIAS secciones (Team) sin duplicarse', () => {
  const { registries, club, teamSenior, teamYouth } = buildTestlandFixture();
  const teams = registries.teams.forClub(club.id);
  assert.strictEqual(teams.length, 2);
  assert.ok(teams.includes(teamSenior) && teams.includes(teamYouth));
  assert.strictEqual(registries.clubs.size, 1, 'un solo Club, nunca uno por sección');
});

check('role/category distinguen primer equipo senior de la sección juvenil', () => {
  const { teamSenior, teamYouth } = buildTestlandFixture();
  assert.strictEqual(teamSenior.role, 'first-team');
  assert.deepStrictEqual(teamSenior.category, { gender: 'men', ageTier: 'senior' });
  assert.strictEqual(teamSenior.teamType, 'senior-men-first-team', 'teamType por defecto debe seguir siendo EXACTAMENTE el legacy');
  assert.strictEqual(teamYouth.role, 'youth');
  assert.deepStrictEqual(teamYouth.category, { gender: 'men', ageTier: 'youth' });
});

check('un role no válido lanza descriptivo', () => {
  assert.throws(() => new Team({ id: 't', role: 'coach-staff' }), /role "coach-staff" no válido/);
});

check('club.primaryTeamId resuelve al primer equipo, no a la sección juvenil', () => {
  const { club, teamSenior } = buildTestlandFixture();
  assert.strictEqual(club.primaryTeamId, teamSenior.id);
});

// =========================================================================
// 2. Unicidad de squad activo por equipo / jugador por squad activo
// =========================================================================
group('2. Unicidad de squads activos');

check('un equipo activo tiene exactamente un squad operativo activo', () => {
  const { registries, teamSenior, squadSenior } = buildTestlandFixture();
  assert.strictEqual(registries.squads.activeForTeam(teamSenior.id), squadSenior);
});

check('registrar un SEGUNDO squad activo para el mismo equipo lanza descriptivo', () => {
  const { registries, teamSenior } = buildTestlandFixture();
  const secondActive = new Squad({ id: 'squad:duplicate', teamId: teamSenior.id, status: 'active', players: [] });
  assert.throws(() => registries.registerSquad(secondActive), /ya tiene un squad activo/);
});

check('un jugador no puede estar en dos squads activos del mundo a la vez', () => {
  const { registries, club, squadSenior } = buildTestlandFixture();
  const sharedPlayer = squadSenior.players[0];
  // Una TERCERA sección del mismo Club, sin squad todavía, para aislar la
  // comprobación de "jugador en dos squads activos" de la de "dos squads
  // activos del mismo equipo" (ya cubierta arriba).
  const teamReserve = new Team({ id: 'team-testland-warriors-reserve', name: 'Testland Warriors C', role: 'reserve' });
  teamReserve.clubId = club.id;
  teamReserve.club = club;
  registries.registerTeam(teamReserve);
  const rogueSquad = new Squad({
    id: 'squad:rogue', teamId: teamReserve.id, status: 'active', players: [sharedPlayer],
  });
  assert.throws(() => registries.registerSquad(rogueSquad), /ya está en el squad activo/);
});

check('Squad.addPlayer lanza si el jugador ya está en ESE squad', () => {
  const { squadSenior } = buildTestlandFixture();
  assert.throws(() => squadSenior.addPlayer(squadSenior.players[0]), /ya está en este squad/);
});

check('Squad.removePlayer devuelve true/false según si el jugador estaba', () => {
  const { squadSenior } = buildTestlandFixture();
  const id = squadSenior.players[0].id;
  assert.strictEqual(squadSenior.removePlayer(id), true);
  assert.strictEqual(squadSenior.removePlayer(id), false);
});

// =========================================================================
// 3. Serialización por ids, identidad de instancias, roster como vista
// =========================================================================
group('3. Identidad de instancias y serialización');

check('Team.roster es la MISMA referencia de array que Squad.players', () => {
  const { teamSenior, squadSenior } = buildTestlandFixture();
  assert.strictEqual(teamSenior.roster, squadSenior.players);
});

check('Squad.toJSON() serializa playerIds, nunca jugadores embebidos', () => {
  const { squadSenior } = buildTestlandFixture();
  const json = squadSenior.toJSON();
  assert.deepStrictEqual(json.playerIds, squadSenior.players.map((p) => p.id));
  assert.strictEqual(json.players, undefined, 'nunca debe existir un campo "players" embebido en el JSON');
});

check('Team.addPlayer/removePlayer delegan en el Squad cuando hay uno enlazado', () => {
  const { teamSenior, squadSenior } = buildTestlandFixture();
  const newPlayer = makePlayer({ id: 'testland-senior-p3' });
  teamSenior.addPlayer(newPlayer);
  assert.ok(squadSenior.hasPlayer(newPlayer.id), 'addPlayer debe llegar al Squad real, no a un array paralelo');
  assert.strictEqual(newPlayer.teamId, teamSenior.id);
  teamSenior.removePlayer(newPlayer.id);
  assert.strictEqual(squadSenior.hasPlayer(newPlayer.id), false);
});

// =========================================================================
// 4. Migración institucional sin copias mutables duplicadas
// =========================================================================
group('4. Migración institucional (Club como fuente única)');

check('team.facilities es la MISMA referencia que club.facilities (no una copia)', () => {
  const { club, teamSenior } = buildTestlandFixture();
  assert.strictEqual(teamSenior.facilities, club.facilities);
  club.facilities.trainingCenter.level = 15;
  assert.strictEqual(teamSenior.facilities.trainingCenter.level, 15);
});

check('team.budget/team.clubDNA delegan en Club (getter Y setter)', () => {
  const { club, teamSenior } = buildTestlandFixture();
  teamSenior.budget = 999000;
  assert.strictEqual(club.budget, 999000, 'el setter de Team debe escribir en el Club real, nunca en una copia');
  teamSenior.clubDNA = 'Ritmo alto';
  assert.strictEqual(club.clubDNA, 'Ritmo alto');
});

check('team.reputation compone deportiva (Team) + financiera/cantera (Club)', () => {
  const { club, teamSenior } = buildTestlandFixture();
  club.reputationFinancial = 70;
  club.reputationYouth = 30;
  const reputation = teamSenior.reputation;
  assert.strictEqual(reputation.financial, 70);
  assert.strictEqual(reputation.youth, 30);
  assert.strictEqual(reputation.sporting, 50, 'valor por defecto de reputación deportiva');
});

check('un Team AISLADO (sin Club enlazado, modo bootstrap/tests legacy) conserva su propio estado institucional', () => {
  const bootstrapTeam = new Team({
    id: 'bootstrap-team', name: 'Bootstrap FC', budget: 500, foundationYear: 1950,
  });
  assert.strictEqual(bootstrapTeam.club, null);
  assert.strictEqual(bootstrapTeam.budget, 500);
  assert.strictEqual(bootstrapTeam.foundationYear, 1950);
  bootstrapTeam.budget = 750;
  assert.strictEqual(bootstrapTeam.budget, 750, 'el bootstrap sigue siendo mutable localmente sin Club');
});

// =========================================================================
// 5. BUG-WORLDCORE-09 (Team.validateDivision)
// =========================================================================
group('5. BUG-WORLDCORE-09');

check('Team sin división (undefined) queda con division=null, nunca "1ª" por defecto', () => {
  const team = new Team({ id: 'no-division-team' });
  assert.strictEqual(team.division, null);
  assert.strictEqual(team.legacyDivision, null);
});

check('un valor de división explícito no reconocido sigue lanzando', () => {
  assert.throws(() => new Team({ id: 'bad-division-team', division: '3ª' }), /División no válida/);
});

check('el contenido español sigue pasando "1ª"/"2ª" explícitos sin cambiar de forma', () => {
  assert.strictEqual(Team.validateDivision('1ª'), '1ª');
  assert.strictEqual(Team.validateDivision('2ª'), '2ª');
});

// =========================================================================
// 6. Contexto laboral resuelto desde Club/área
// =========================================================================
group('6. Contexto laboral (ClubEmploymentContextCatalog)');

check('buildEmploymentContext resuelve la jurisdicción de TEST (XX) desde el área del Club, nunca de España', () => {
  const { club, teamSenior } = buildTestlandFixture();
  const context = ClubEmploymentContextCatalog.buildEmploymentContext(teamSenior, club, { domesticCompetitionId: 'testland-league' });
  assert.strictEqual(context.clubId, club.id);
  assert.strictEqual(context.employerJurisdictionId, 'XX');
  assert.strictEqual(context.domesticCompetitionId, 'testland-league');
});

check('buildEmploymentContext lanza si no hay Club real enlazado (nunca team.id como clubId por defecto)', () => {
  const orphanTeam = new Team({ id: 'team-sin-club' });
  assert.throws(
    () => ClubEmploymentContextCatalog.buildEmploymentContext(orphanTeam, orphanTeam.club, {}),
    /CLUB-CORE-1 exige un Club real enlazado/,
  );
});

check('un área de jurisdicción laboral desconocida lanza descriptivo, nunca hereda España', () => {
  assert.throws(
    () => ClubEmploymentContextCatalog.requireJurisdictionIdForArea('area-no-registrada'),
    /no tiene jurisdicción laboral registrada/,
  );
});

// =========================================================================
// 7. ClubStructureService (frontera pura Club<->Team<->Squad)
// =========================================================================
group('7. ClubStructureService');

check('buildContext({teamId}) deriva el Club y el Squad activo correctos', () => {
  const { registries, club, teamYouth, squadYouth } = buildTestlandFixture();
  const context = ClubStructureService.buildContext(registries, { teamId: teamYouth.id });
  assert.strictEqual(context.club, club);
  assert.strictEqual(context.team, teamYouth);
  assert.strictEqual(context.squad, squadYouth);
});

check('buildContext({clubId}) deriva el Team PRINCIPAL del Club (nunca uno cualquiera)', () => {
  const { registries, club, teamSenior } = buildTestlandFixture();
  const context = ClubStructureService.buildContext(registries, { clubId: club.id });
  assert.strictEqual(context.team, teamSenior);
});

check('buildContext lanza si clubId/teamId pasados son incoherentes entre sí', () => {
  const { registries, teamYouth } = buildTestlandFixture();
  registries.registerArea(new GeographicArea({ id: 'area-country-other', type: 'country', parentAreaId: 'area-world', name: 'Otro' }));
  const otherClub = new Club({
    id: 'club-other', homeAreaId: 'area-country-other', employerJurisdictionAreaId: ClubEmploymentContextCatalog.TEST_JURISDICTION_AREA_ID,
  });
  registries.registerClub(otherClub);
  assert.throws(
    () => ClubStructureService.buildContext(registries, { clubId: otherClub.id, teamId: teamYouth.id }),
    /referencia incoherente/,
  );
});

check('activeSquadForTeam devuelve null (nunca lanza) para un equipo sin squad todavía', () => {
  const registries = new WorldRegistries();
  registries.registerArea(new GeographicArea({ id: 'area-world-2', type: 'world', parentAreaId: null }));
  const club = new Club({
    id: 'club-empty', homeAreaId: 'area-world-2', employerJurisdictionAreaId: 'area-world-2',
  });
  registries.registerClub(club);
  const team = new Team({ id: 'team-empty' });
  team.clubId = club.id;
  registries.registerTeam(team);
  assert.strictEqual(ClubStructureService.activeSquadForTeam(registries, team.id), null);
  assert.throws(() => ClubStructureService.requireActiveSquadForTeam(registries, team.id), /no tiene squad activo/);
});

// =========================================================================
// 8. Paquete de test SIN España/ACB
// =========================================================================
group('8. Paquete de test sin España/ACB');

check('la fixture de Testland no contiene NINGÚN literal de España/ACB', () => {
  const { registries } = buildTestlandFixture();
  const snapshot = JSON.stringify(registries.describe());
  ['acb', 'primera-feb', "'1ª'", "'2ª'", 'ACB', 'Primera FEB', 'España', 'team-real-madrid'].forEach((token) => {
    assert.ok(!snapshot.includes(token), `Testland no debería contener "${token}"`);
  });
});

check('registries.validateIntegrity() de la fixture Testland no reporta errores', () => {
  const { registries } = buildTestlandFixture();
  assert.deepStrictEqual(registries.validateIntegrity(), []);
});

// =========================================================================
// 9. Los 36 clubes/equipos reales, MoraBanc Andorra, Contract/Registration/
//    Academy con la identidad correcta
// =========================================================================
group('9. Paquete español real (36 clubes/equipos/squads)');

check('los 36 clubId son TODOS distintos de los 36 teamId (ninguna intersección)', () => {
  const { world, allTeams } = buildSpainWorld();
  assert.strictEqual(world.registries.clubs.size, 36);
  assert.strictEqual(world.registries.teams.size, 36);
  assert.strictEqual(world.registries.squads.size, 36, 'un squad activo por equipo');
  const clubIds = new Set(allTeams.map((t) => t.clubId));
  const teamIds = new Set(allTeams.map((t) => t.id));
  assert.strictEqual(clubIds.size, 36);
  const intersection = [...clubIds].filter((id) => teamIds.has(id));
  assert.deepStrictEqual(intersection, [], 'ningún clubId real coincide con ningún teamId real');
});

check('SPAIN_CLUB_CONTENT declara los 36 pares clubId/teamId de forma EXPLÍCITA (no derivada por sufijo)', () => {
  assert.strictEqual(SPAIN_CLUB_CONTENT.length, 36);
  SPAIN_CLUB_CONTENT.forEach((entry) => {
    assert.notStrictEqual(entry.clubId, entry.teamId);
    assert.ok(entry.clubId.startsWith('club-'));
    assert.ok(entry.teamId.startsWith('team-'));
  });
});

check('MoraBanc Andorra: teamId conserva "team-morabanc-andorra", clubId es "club-morabanc-andorra" distinto', () => {
  const { world } = buildSpainWorld();
  const team = world.registries.teams.require('team-morabanc-andorra');
  assert.strictEqual(team.clubId, 'club-morabanc-andorra');
  const club = world.registries.clubs.require('club-morabanc-andorra');
  assert.strictEqual(club.employerJurisdictionAreaId, 'area-country-ad');
  assert.strictEqual(club.homeAreaId, 'area-country-ad');
  assert.strictEqual(team.squad.teamId, team.id);
});

check('cada Team real tiene exactamente un Squad activo con el MISMO roster (misma referencia)', () => {
  const { allTeams } = buildSpainWorld();
  const sample = allTeams[0];
  assert.ok(sample.squad);
  assert.strictEqual(sample.squad.status, 'active');
  assert.strictEqual(sample.roster, sample.squad.players);
});

check('Contract.clubId resuelve al clubId REAL (nunca team.id) tras ContractSeeder', () => {
  const { allTeams, world } = buildSpainWorld();
  const competitionIdForTeam = competitionResolverFor(world, '2026-27');
  const playerRegistry = new PlayerRegistry();
  allTeams.forEach((team) => playerRegistry.registerMany(team.roster));
  const contractRegistry = new ContractRegistry();
  ContractSeeder.seedContractsForTeams({
    teams: allTeams, seasonKey: '2026-27', date: GAME_DATE, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
    competitionIdForTeam,
  });
  const sample = allTeams.find((t) => t.id === 'team-real-madrid');
  const contract = contractRegistry.currentForPlayer(sample.roster[0].id, GAME_DATE);
  assert.ok(contract, 'debe existir un contrato sembrado para el jugador de muestra');
  assert.strictEqual(contract.clubId, sample.clubId);
  assert.notStrictEqual(contract.clubId, sample.id, 'el contrato NUNCA debe usar el teamId como clubId');
});

check('License.clubId (RegistrationRegistry) resuelve al clubId real, Registration.teamId al teamId real', () => {
  const { allTeams, world } = buildSpainWorld();
  const competitionIdForTeam = competitionResolverFor(world, '2026-27');
  const playerRegistry = new PlayerRegistry();
  allTeams.forEach((team) => playerRegistry.registerMany(team.roster));
  const contractRegistry = new ContractRegistry();
  ContractSeeder.seedContractsForTeams({
    teams: allTeams, seasonKey: '2026-27', date: GAME_DATE, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
    competitionIdForTeam,
  });
  const registrationRegistry = new RegistrationRegistry();
  RegistrationSeeder.seedRegistrationsForTeams({
    teams: allTeams, seasonKey: '2026-27', date: GAME_DATE, registrationRegistry, contractRegistry, config: CONFIG_BASE,
    competitionIdForTeam,
  });
  const sample = allTeams.find((t) => t.id === 'team-real-madrid');
  const player = sample.roster[0];
  const registration = registrationRegistry.registrationsForPlayer(player.id)
    .find((r) => r.statusOn(GAME_DATE) === 'active');
  assert.ok(registration, 'debe existir una inscripción activa para el jugador de muestra');
  assert.strictEqual(registration.teamId, sample.id, 'CompetitionRegistration.teamId es SIEMPRE un Team id');
  const license = registrationRegistry.licensesForPlayer(player.id)[0];
  assert.ok(license, 'debe existir una licencia federativa sembrada');
  assert.strictEqual(license.clubId, sample.clubId, 'FederationLicense.clubId es SIEMPRE un Club id');
  assert.deepStrictEqual(registrationRegistry.validateIntegrity({ teams: allTeams, playerRegistry, contractRegistry }).errors, []);
});

check('AcademyMembership.clubId es el clubId real y promoteToFirstTeam afilia al Team correcto', () => {
  const { allTeams, world } = buildSpainWorld();
  const competitionIdForTeam = competitionResolverFor(world, '2026-27');
  const playerRegistry = new PlayerRegistry();
  allTeams.forEach((team) => playerRegistry.registerMany(team.roster));
  const contractRegistry = new ContractRegistry();
  ContractSeeder.seedContractsForTeams({
    teams: allTeams, seasonKey: '2026-27', date: GAME_DATE, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
    competitionIdForTeam,
  });
  const registrationRegistry = new RegistrationRegistry();
  RegistrationSeeder.seedRegistrationsForTeams({
    teams: allTeams, seasonKey: '2026-27', date: GAME_DATE, registrationRegistry, contractRegistry, config: CONFIG_BASE,
    competitionIdForTeam,
  });
  const academyRegistry = new AcademyRegistry();
  const sample = allTeams.find((t) => t.id === 'team-real-madrid');
  const intake = AcademyService.runAnnualIntake({
    academyRegistry, playerRegistry, team: sample, cycle: null, date: GAME_DATE, seasonKey: '2026-27', config: CONFIG_BASE, careerSeed: 'test-club-core1-academy',
  });
  assert.strictEqual(intake.clubId, sample.clubId);
  assert.ok(intake.created.length > 0, 'debe generarse al menos un académico (cupo vacío al arrancar)');
  const { membership } = intake.created[0];
  assert.strictEqual(membership.clubId, sample.clubId);

  const rosterSizeBefore = sample.roster.length;
  AcademyService.promoteToFirstTeam({
    academyRegistry, playerRegistry, contractRegistry, registrationRegistry, teams: allTeams,
    membership, team: sample, date: GAME_DATE, seasonKey: '2026-27', config: CONFIG_BASE,
    domesticCompetitionId: competitionIdForTeam(sample, '2026-27'),
    competitionIdForTeam,
  });
  assert.strictEqual(sample.roster.length, rosterSizeBefore + 1, 'la promoción debe afiliar al Team (roster), nunca dejarlo en el limbo');
  assert.ok(sample.roster.some((p) => p.id === membership.playerId));
});

console.log(`\n${passed} comprobaciones OK, ${failed} fallidas.`);
if (failed > 0) process.exit(1);
