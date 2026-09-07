#!/usr/bin/env node
// scripts/test-world-context1.js
// Verificación WORLD-CONTEXT-1 (DESIGN.md 10.20) — batería DIRIGIDA y
// pequeña, mismo criterio que el resto de la EPIC (no hay framework de
// tests instalado, ver CLAUDE.md). Ejecutar con:
//   node scripts/test-world-context1.js
//
// Grupos:
//   1. Resolución del contexto competitivo desde CompetitionEntry
//   2. Origen y destino en una transición anual
//   3. Identidades canónicas Club vs Team (ciclo, evidencia, legalidad,
//      emergencia)
//   4. MoraBanc Andorra (test transfronterizo obligatorio de la EPIC)
//   5. Snapshots JSON planos y con orden estable
//   6. Auditoría estática: ningún call-site productivo de
//      `competitionIdFromLegacyDivision` en los nueve servicios migrados
//   7. Consultar no muta ni consume aleatoriedad

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { Club } = require('../src/entities/Club.js');
const { CompetitionEdition, CompetitionEntry } = require('../src/entities/Competition.js');
const CycleEntities = require('../src/entities/Cycle.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { ContractService } = require('../src/core/ContractService.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { RosterLegalityService } = require('../src/core/RosterLegalityService.js');
const { AnnualCycleRegistry } = require('../src/core/AnnualCycleRegistry.js');
const { AnnualCycleService } = require('../src/core/AnnualCycleService.js');
const { CpuRosterPlanner } = require('../src/core/CpuRosterPlanner.js');
const { LoanService } = require('../src/core/LoanService.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');
const { CompetitionContextService } = require('../src/core/CompetitionContextService.js');
const SeasonHistory = require('../src/core/SeasonHistoryService.js');
const CompetitionCatalog = require('../src/core/CompetitionCatalog.js');
const WorldFactory = require('../src/core/WorldFactory.js');
const { WorldSimulationProfile } = require('../src/entities/WorldSimulation.js');
const { WORLD_CORE_MANIFEST } = require('../data/world/world-core-2026.1.js');
const { SPAIN_MANIFEST } = require('../data/world/spain-2026.1.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');

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
const NEXT_SEASON = '2027-28';
const GAME_DATE = '2026-10-03';
const { ACB, PRIMERA_FEB } = CompetitionCatalog.COMPETITION_IDS;

// =====================================================================
// Mundo real mínimo (paquete español instalado): los 36 equipos con sus
// `Club` reales (ids DISTINTOS de los de Team, CLUB-CORE-1) y sus
// `CompetitionEntry` reales de la temporada de arranque.
// =====================================================================
function buildSpainWorld() {
  const refDate = new Date(2026, 9, 3);
  const teamsByCompetitionId = { [ACB]: [], [PRIMERA_FEB]: [] };
  REAL_DATA_INDEX.forEach((entry) => {
    const teamData = REAL_DATA_TEAMS[entry.id];
    const roster = teamData.roster.map((playerData) => {
      const { dataSource, ...fields } = playerData;
      const player = new Player(fields);
      player.dataSource = dataSource || null;
      PD.ensureDevelopmentState(player, CONFIG_BASE, refDate);
      return player;
    });
    const team = new Team({ ...teamData, roster });
    const competitionId = entry.division === '1ª' ? ACB : PRIMERA_FEB;
    teamsByCompetitionId[competitionId].push(team);
  });
  const simulationProfile = new WorldSimulationProfile({
    id: 'simulation-profile:test-world-context1',
    version: '1.0.0',
    defaultDetailLevel: 'abstract',
    assignments: [
      { scopeType: 'competition', scopeId: ACB, detailLevel: 'playable' },
      { scopeType: 'competition', scopeId: PRIMERA_FEB, detailLevel: 'playable' },
      { scopeType: 'competition', scopeId: CompetitionCatalog.COMPETITION_IDS.COPA_ACB, detailLevel: 'playable' },
    ],
    provenance: { status: 'design', notes: 'Perfil transitorio de test-world-context1.js — mismo criterio que game.js.' },
  });
  const world = WorldFactory.buildCareerWorld({
    id: 'world:test-world-context1',
    name: 'Mundo de prueba WORLD-CONTEXT-1',
    careerSeed: 'test-world-context1-seed',
    createdAtGameDate: GAME_DATE,
    packs: [WORLD_CORE_MANIFEST, SPAIN_MANIFEST],
    context: { teamsByCompetitionId, seasonKey: SEASON, seasonStartDate: GAME_DATE },
    simulationProfile,
  });
  const allTeams = world.registries.teams.all();
  return { world, allTeams };
}

const spain = buildSpainWorld();

function teamById(id) {
  return spain.world.registries.teams.require(id);
}

// =====================================================================
group('1. Resolución del contexto competitivo desde CompetitionEntry');
// =====================================================================

check('un equipo de ACB y uno de Primera FEB resuelven su competición doméstica real (nunca por división)', () => {
  const acbTeam = teamById('team-real-madrid');
  const febTeam = teamById('team-bueno-arenas-albacete');
  assert.strictEqual(
    CompetitionContextService.resolveDomesticCompetitionId(spain.world.registries, acbTeam.id, { seasonKey: SEASON }),
    ACB,
  );
  assert.strictEqual(
    CompetitionContextService.resolveDomesticCompetitionId(spain.world.registries, febTeam.id, { seasonKey: SEASON }),
    PRIMERA_FEB,
  );
});

check('el resolver compartido devuelve el MISMO id para cualquier equipo del mundo', () => {
  const resolver = CompetitionContextService.makeDomesticCompetitionResolver(spain.world.registries, {
    operation: 'test', seasonKey: SEASON,
  });
  spain.allTeams.forEach((team) => {
    assert.strictEqual(
      resolver(team),
      CompetitionContextService.resolveDomesticCompetitionId(spain.world.registries, team.id, { seasonKey: SEASON }),
    );
  });
});

check('CERO ligas primarias (equipo sin Entry en esa temporada) falla con diagnóstico, nunca ACB por defecto', () => {
  assert.throws(
    () => CompetitionContextService.resolveDomesticCompetitionId(spain.world.registries, 'team-real-madrid', {
      seasonKey: NEXT_SEASON, operation: 'zero-entries',
    }),
    (err) => /no tiene ninguna Entry de liga/.test(err.message)
      && /zero-entries/.test(err.message)
      && !/acb/.test(err.message.replace('team-real-madrid', '')),
  );
});

check('VARIAS ligas primarias simultáneas fallan explícito (nunca se elige la primera)', () => {
  const world = buildSpainWorld().world;
  const team = world.registries.teams.require('team-real-madrid');
  // Segunda liga doméstica simultánea (configuración inválida deliberada).
  const febEdition = world.registries.competitionEditions.all()
    .find((edition) => edition.competitionDefinitionId === PRIMERA_FEB && edition.seasonKey === SEASON);
  world.registries.registerCompetitionEntry(new CompetitionEntry({
    id: 'entry:test-double-league',
    editionId: febEdition.id,
    participantType: 'club-team',
    participantId: team.id,
    entryStatus: 'active',
  }));
  assert.throws(
    () => CompetitionContextService.resolveDomesticCompetitionId(world.registries, team.id, { seasonKey: SEASON }),
    /Entries de liga simultáneas/,
  );
});

check('falta de contexto explícito bloquea la operación (contratos, inscripción, legalidad)', () => {
  const team = teamById('team-real-madrid');
  assert.throws(
    () => ContractService.resolveRulesForClub(team, { seasonKey: SEASON, date: GAME_DATE }),
    /falta el "competitionId" explícito/,
  );
  assert.throws(
    () => RegistrationSeeder.seedRegistrationsForTeams({
      teams: [team], seasonKey: SEASON, date: GAME_DATE, registrationRegistry: new RegistrationRegistry(), config: CONFIG_BASE,
    }),
    /falta el resolver obligatorio "competitionIdForTeam"/,
  );
  assert.throws(
    () => RosterLegalityService.buildReport({
      team, seasonKey: SEASON, date: GAME_DATE, config: CONFIG_BASE, playerRegistry: new PlayerRegistry(),
    }),
    /falta el "competitionId" explícito/,
  );
});

check('un Team puede tener varias Entries simultáneas (Liga + Copa) sin ambigüedad', () => {
  const team = teamById('team-real-madrid');
  const competitions = require('../src/core/CompetitionParticipationService.js')
    .activeCompetitionsForParticipant(spain.world.registries, team.id, { seasonKey: SEASON })
    .map((row) => row.competitionDefinitionId)
    .sort();
  assert.ok(competitions.length >= 1);
  // La liga se resuelve igual aunque haya más competiciones registradas.
  assert.strictEqual(
    CompetitionContextService.resolveDomesticCompetitionId(spain.world.registries, team.id, { seasonKey: SEASON }),
    ACB,
  );
});

// =====================================================================
group('2. Origen y destino en una transición anual');
// =====================================================================

check('la misma instancia de Team resuelve competición DISTINTA en la temporada de origen y de destino', () => {
  const { world } = buildSpainWorld();
  const team = world.registries.teams.require('team-bueno-arenas-albacete'); // Primera FEB en 2026-27
  assert.strictEqual(
    CompetitionContextService.resolveDomesticCompetitionId(world.registries, team.id, { seasonKey: SEASON }),
    PRIMERA_FEB,
  );
  // Temporada de DESTINO: asciende — Edition + Entry reales de 2027-28.
  const targetEdition = new CompetitionEdition({
    id: `edition:${ACB}:${NEXT_SEASON}:test`,
    competitionDefinitionId: ACB,
    seasonKey: NEXT_SEASON,
    status: 'planned',
    detailLevel: 'playable',
  });
  world.registries.registerCompetitionEdition(targetEdition);
  world.registries.registerCompetitionEntry(new CompetitionEntry({
    id: 'entry:test-target-season',
    editionId: targetEdition.id,
    participantType: 'club-team',
    participantId: team.id,
    entryStatus: 'active',
  }));
  const fromId = CompetitionContextService.resolveDomesticCompetitionId(world.registries, team.id, { seasonKey: SEASON });
  const targetId = CompetitionContextService.resolveDomesticCompetitionId(world.registries, team.id, { seasonKey: NEXT_SEASON });
  assert.strictEqual(fromId, PRIMERA_FEB);
  assert.strictEqual(targetId, ACB);
  assert.notStrictEqual(fromId, targetId, 'origen y destino son ids DISTINTOS tras un ascenso');
});

check('el resolver del ciclo se consulta con la temporada del PAPEL (origen o destino), nunca con una sola id', () => {
  const seen = [];
  const resolver = (team, seasonKey) => {
    seen.push(seasonKey);
    return seasonKey === NEXT_SEASON ? ACB : PRIMERA_FEB;
  };
  const team = teamById('team-bueno-arenas-albacete');
  assert.strictEqual(
    CompetitionContextService.competitionIdForTeamWith(resolver, team, { seasonKey: SEASON, operation: 'from' }),
    PRIMERA_FEB,
  );
  assert.strictEqual(
    CompetitionContextService.competitionIdForTeamWith(resolver, team, { seasonKey: NEXT_SEASON, operation: 'target' }),
    ACB,
  );
  assert.deepStrictEqual(seen, [SEASON, NEXT_SEASON]);
});

// =====================================================================
group('3. Identidades canónicas Club vs Team');
// =====================================================================

// Fixture DELIBERADO con ids DISTINTOS (`club:test` !== `team:test`) — así
// una confusión clubId/teamId no puede volver a quedar oculta.
const TEST_CLUB_ID = 'club:test-world-context1';
const TEST_TEAM_ID = 'team:test-world-context1';

function buildDistinctIdTeam() {
  const club = new Club({
    id: TEST_CLUB_ID,
    name: 'Club de prueba',
    homeAreaId: 'area-country-es',
    employerJurisdictionAreaId: 'area-country-es',
  });
  const team = new Team({
    id: TEST_TEAM_ID, name: 'Equipo de prueba', city: 'Test', division: '1ª', roster: [], clubId: club.id,
  });
  team.club = club;
  team.clubId = club.id;
  return team;
}

check('ClubCycleCase separa clubId (institución) de teamId (equipo senior operativo)', () => {
  const team = buildDistinctIdTeam();
  const clubCase = new CycleEntities.ClubCycleCase({
    id: `club-cycle:cycle:${SEASON}:${team.clubId}`,
    cycleId: `cycle:${SEASON}`,
    clubId: team.clubId,
    teamId: team.id,
    targetCompetitionId: ACB,
    employerJurisdictionId: 'ES',
  });
  assert.strictEqual(clubCase.clubId, TEST_CLUB_ID);
  assert.strictEqual(clubCase.teamId, TEST_TEAM_ID);
  assert.notStrictEqual(clubCase.clubId, clubCase.teamId);
  assert.ok(clubCase.id.includes(TEST_CLUB_ID), 'el id del expediente deriva del CLUB, nunca del teamId');
  assert.strictEqual(clubCase.toJSON().teamId, TEST_TEAM_ID);
  assert.throws(() => new CycleEntities.ClubCycleCase({
    id: 'x', cycleId: 'c', clubId: TEST_CLUB_ID, targetCompetitionId: ACB, employerJurisdictionId: 'ES',
  }), /ClubCycleCase\.teamId/);
});

check('RosterLegalityReport y EmergencyRosterAction guardan teamId y clubId por separado', () => {
  const report = new CycleEntities.RosterLegalityReport({
    id: 'legality:test', teamId: TEST_TEAM_ID, clubId: TEST_CLUB_ID, competitionId: ACB, seasonKey: SEASON, date: GAME_DATE,
  });
  assert.strictEqual(report.teamId, TEST_TEAM_ID);
  assert.strictEqual(report.clubId, TEST_CLUB_ID);
  assert.strictEqual(report.toJSON().teamId, TEST_TEAM_ID);
  const action = new CycleEntities.EmergencyRosterAction({
    id: 'emergency:test', reportId: report.id, teamId: TEST_TEAM_ID, clubId: TEST_CLUB_ID,
    actionType: 'generate-emergency-player', appliedAt: GAME_DATE,
  });
  assert.strictEqual(action.teamId, TEST_TEAM_ID);
  assert.strictEqual(action.clubId, TEST_CLUB_ID);
  assert.throws(() => new CycleEntities.RosterLegalityReport({
    id: 'legality:test2', clubId: TEST_CLUB_ID, competitionId: ACB, seasonKey: SEASON, date: GAME_DATE,
  }), /RosterLegalityReport\.teamId/);
});

check('el AnnualCycleRegistry indexa legalidad y emergencias por teamId (deportivo)', () => {
  const registry = new AnnualCycleRegistry();
  const report = new CycleEntities.RosterLegalityReport({
    id: 'legality:test-index', teamId: TEST_TEAM_ID, clubId: TEST_CLUB_ID, competitionId: ACB, seasonKey: SEASON, date: GAME_DATE,
  });
  registry.registerLegalityReport(report);
  assert.deepStrictEqual(registry.legalityReportsForTeam(TEST_TEAM_ID).map((r) => r.id), [report.id]);
  assert.deepStrictEqual(registry.legalityReportsForTeam(TEST_CLUB_ID), []);
  const action = new CycleEntities.EmergencyRosterAction({
    id: 'emergency:test-index', reportId: report.id, teamId: TEST_TEAM_ID, clubId: TEST_CLUB_ID,
    actionType: 'promote-academy', appliedAt: GAME_DATE,
  });
  registry.registerEmergencyAction(action);
  assert.deepStrictEqual(registry.emergencyActionsForTeam(TEST_TEAM_ID).map((a) => a.id), [action.id]);
  assert.deepStrictEqual(registry.emergencyActionsForTeam(TEST_CLUB_ID), []);
});

check('LastOfficialMatchEvidenceCollector indexa por teamId y registra los DOS ids de cada lado', () => {
  const collector = new SeasonHistory.SeasonHistoryService.LastOfficialMatchEvidenceCollector();
  collector.recordMatch({
    homeTeamId: TEST_TEAM_ID,
    homeClubId: TEST_CLUB_ID,
    awayTeamId: 'team:rival',
    awayClubId: 'club:rival',
    date: '2027-05-30',
    competitionId: ACB,
    phaseId: 'league',
    matchId: 'match-1',
  });
  const row = collector.forTeam(TEST_TEAM_ID);
  assert.ok(row, 'la evidencia se consulta por teamId');
  assert.strictEqual(row.clubId, TEST_CLUB_ID);
  assert.strictEqual(row.opponentTeamId, 'team:rival');
  assert.strictEqual(row.opponentClubId, 'club:rival');
  assert.strictEqual(collector.forTeam(TEST_CLUB_ID), null, 'nunca se indexa por el clubId institucional');
  assert.deepStrictEqual(collector.missingTeamIds([{ id: 'team:sin-partido' }]), ['team:sin-partido']);
});

check('AnnualRosterCycle: instantánea competitiva {teamId, clubId, competitionId} y evidencia por equipo', () => {
  const cycle = new CycleEntities.AnnualRosterCycle({
    id: `cycle:${SEASON}`,
    fromSeasonKey: SEASON,
    targetSeasonKey: NEXT_SEASON,
    openedAt: '2027-07-01',
    competitionMembershipSnapshot: [{ teamId: TEST_TEAM_ID, clubId: TEST_CLUB_ID, competitionId: ACB }],
    teamLastOfficialMatchEvidence: [{ teamId: TEST_TEAM_ID, clubId: TEST_CLUB_ID, date: '2027-06-01' }],
    summerSchedule: [{ phaseId: 'snapshot-frozen', date: '2027-07-02' }],
  });
  assert.deepStrictEqual(cycle.competitionMembershipSnapshot, [
    { teamId: TEST_TEAM_ID, clubId: TEST_CLUB_ID, competitionId: ACB },
  ]);
  assert.strictEqual(cycle.lastOfficialMatchDateForTeam(TEST_TEAM_ID), '2027-06-01');
  assert.strictEqual(cycle.lastOfficialMatchDateForTeam(TEST_CLUB_ID), null);
  assert.throws(() => new CycleEntities.AnnualRosterCycle({
    id: 'cycle:bad', fromSeasonKey: SEASON, targetSeasonKey: NEXT_SEASON, openedAt: '2027-07-01',
    competitionMembershipSnapshot: [{ clubId: TEST_CLUB_ID, competitionId: ACB }],
  }), /competitionMembershipSnapshot\.teamId/);
});

check('la instantánea de planificación CPU lleva teamId + clubId + competitionId (sin división)', () => {
  const team = teamById('team-real-madrid');
  const playerRegistry = new PlayerRegistry();
  playerRegistry.registerMany(team.roster);
  const snapshot = CpuRosterPlanner.buildSnapshot({
    teams: [team],
    playerRegistry,
    date: GAME_DATE,
    seasonKey: SEASON,
    config: CONFIG_BASE,
    competitionIdForTeam: () => ACB,
  });
  const row = snapshot.clubs[0];
  assert.strictEqual(row.teamId, team.id);
  assert.strictEqual(row.clubId, team.clubId);
  assert.notStrictEqual(row.teamId, row.clubId, 'el paquete español declara ids DISTINTOS');
  assert.strictEqual(row.competitionId, ACB);
  assert.ok(!('division' in row), 'la instantánea ya no transporta división legacy');
});

check('la nómina congelada del ciclo se agrega por el clubId REAL (nunca por teamId)', () => {
  const team = teamById('team-real-madrid');
  const playerRegistry = new PlayerRegistry();
  playerRegistry.registerMany(team.roster);
  const contractRegistry = new ContractRegistry();
  ContractSeeder.seedContractsForTeams({
    teams: [team], seasonKey: SEASON, date: GAME_DATE, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
    competitionIdForTeam: () => ACB,
  });
  const byClub = ContractService.guaranteedPayrollForClub(contractRegistry, team.clubId, SEASON);
  const byTeam = ContractService.guaranteedPayrollForClub(contractRegistry, team.id, SEASON);
  assert.ok(byClub.amountMinor > 0, 'la nómina por clubId real existe');
  assert.strictEqual(byTeam.amountMinor, 0, 'agregar por teamId no encuentra contratos (por eso era un bug)');

  const annualCycleRegistry = new AnnualCycleRegistry();
  const { cycle } = AnnualCycleService.openCycle({
    annualCycleRegistry,
    teams: [team],
    fromSeasonKey: SEASON,
    targetSeasonKey: NEXT_SEASON,
    evidence: [{ teamId: team.id, clubId: team.clubId, date: '2027-06-01' }],
    date: '2027-07-01',
    playerRegistry,
    contractRegistry,
    competitionIdForTeam: () => ACB,
  });
  AnnualCycleService.freezeSnapshot({
    annualCycleRegistry, cycle, teams: [team], contractRegistry, date: '2027-07-02', targetSeasonKey: NEXT_SEASON,
    competitionIdForTeam: () => ACB,
  });
  const clubCase = annualCycleRegistry.clubCaseFor(cycle.id, team.clubId);
  assert.ok(clubCase, 'el expediente se localiza por el clubId institucional');
  assert.strictEqual(clubCase.teamId, team.id);
  assert.strictEqual(clubCase.openingPayrollReference.amountMinor, byClub.amountMinor);
  assert.strictEqual(annualCycleRegistry.clubCaseFor(cycle.id, team.id), null, 'nunca se indexa por teamId');
});

// =====================================================================
group('4. MoraBanc Andorra — jurisdicción laboral vs competición');
// =====================================================================

check('MoraBanc Andorra: participa en ACB con jurisdicción laboral andorrana', () => {
  const morabanc = teamById('team-morabanc-andorra');
  const competitionId = CompetitionContextService.resolveDomesticCompetitionId(spain.world.registries, morabanc.id, {
    seasonKey: SEASON,
  });
  assert.strictEqual(competitionId, ACB);
  const context = ContractService.resolveEmploymentContext(morabanc, {
    seasonKey: SEASON, domesticCompetitionId: competitionId,
  });
  assert.strictEqual(context.employerJurisdictionId, 'AD', 'la jurisdicción es del CLUB empleador, nunca del organizador');
  assert.strictEqual(context.domesticCompetitionId, ACB);
  assert.strictEqual(context.clubId, morabanc.clubId);
  assert.notStrictEqual(context.clubId, morabanc.id);
  const resolved = ContractService.resolveRulesForClub(morabanc, {
    seasonKey: SEASON, date: GAME_DATE, operation: 'signContract', domesticCompetitionId: competitionId,
  });
  assert.ok(!resolved.ruleModuleIds.includes('es-rd1006-1985-v1'), 'nunca hereda el RD 1006 español');
  assert.strictEqual(resolved.requestedContext.employerJurisdictionId, 'AD');
});

check('la reacción del jugador a una cesión usa el TIER de la competición, nunca la id de ACB', () => {
  assert.strictEqual(LoanService.competitionTier(ACB), 1);
  assert.strictEqual(LoanService.competitionTier(PRIMERA_FEB), 2);
  assert.strictEqual(LoanService.competitiveLevelBonus(ACB), LoanService.LOAN_ATTRACTIVENESS.topTierBonus);
  assert.strictEqual(LoanService.competitiveLevelBonus(PRIMERA_FEB), 0);
  assert.strictEqual(
    LoanService.competitiveLevelBonus(CompetitionCatalog.COMPETITION_IDS.COPA_ACB), 0,
    'una competición sin tier declarado no recibe bonus (nunca por defecto)',
  );
  const borrowerTeam = teamById('team-real-madrid');
  const proposal = { id: 'proposal:test', clauses: [] };
  assert.throws(
    () => LoanService.evaluatePlayerReaction({
      player: { id: 'p1' }, proposal, borrowerTeam, careerSeed: 'seed', date: GAME_DATE,
    }),
    /falta el "competitionId" explícito/,
  );
  const reaction = LoanService.evaluatePlayerReaction({
    player: { id: 'p1' }, proposal, borrowerTeam, careerSeed: 'seed', date: GAME_DATE, borrowerCompetitionId: ACB,
  });
  assert.ok(['accept', 'reject'].includes(reaction.decision));
  // Auditoría estática sobre CÓDIGO (los comentarios explicativos sí
  // pueden nombrar el bug histórico).
  const code = fs.readFileSync(path.join(__dirname, '..', 'src/core/LoanService.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/COMPETITION_IDS\.ACB/.test(code), 'LoanService nunca compara con la id de ACB para decidir');
  assert.ok(!/divisionBonus/.test(code), 'el bonus por división queda retirado');
});

// =====================================================================
group('5. Snapshots JSON planos y orden estable');
// =====================================================================

check('la instantánea competitiva del ciclo es JSON plano y con orden ESTABLE (no depende del array)', () => {
  const teamA = teamById('team-real-madrid');
  const teamB = teamById('team-barca');
  const playerRegistry = new PlayerRegistry();
  [teamA, teamB].forEach((team) => playerRegistry.registerMany(team.roster));
  const resolver = () => ACB;
  const evidence = [
    { teamId: teamA.id, clubId: teamA.clubId, date: '2027-06-01' },
    { teamId: teamB.id, clubId: teamB.clubId, date: '2027-06-02' },
  ];
  const openWith = (teams, rows) => AnnualCycleService.openCycle({
    annualCycleRegistry: new AnnualCycleRegistry(),
    teams,
    fromSeasonKey: SEASON,
    targetSeasonKey: NEXT_SEASON,
    evidence: rows,
    date: '2027-07-01',
    playerRegistry,
    contractRegistry: null,
    competitionIdForTeam: resolver,
  }).cycle;
  const first = openWith([teamA, teamB], evidence);
  const second = openWith([teamB, teamA], [...evidence].reverse());
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(first.competitionMembershipSnapshot)),
    JSON.parse(JSON.stringify(second.competitionMembershipSnapshot)),
  );
  assert.strictEqual(first.openingWorldFingerprint, second.openingWorldFingerprint, 'el fingerprint es independiente del orden');
  const json = first.toJSON();
  assert.ok(Array.isArray(json.teamLastOfficialMatchEvidence));
  assert.deepStrictEqual(Object.keys(json.competitionMembershipSnapshot[0]).sort(), ['clubId', 'competitionId', 'teamId']);
  assert.strictEqual(JSON.stringify(json).includes('"division"'), false, 'ningún resto de división en la forma durable');
});

check('la proyección plana competitionIdByTeamId ordena por teamId de forma estable', () => {
  const teams = [teamById('team-barca'), teamById('team-real-madrid')];
  const projectionA = CompetitionContextService.projectCompetitionIdByTeamId(() => ACB, teams, { seasonKey: SEASON });
  const projectionB = CompetitionContextService.projectCompetitionIdByTeamId(() => ACB, [...teams].reverse(), { seasonKey: SEASON });
  assert.deepStrictEqual(Object.keys(projectionA), Object.keys(projectionB));
  assert.deepStrictEqual(projectionA, projectionB);
});

// =====================================================================
group('6. Auditoría estática de los nueve servicios migrados');
// =====================================================================

const MIGRATED_SERVICES = [
  'src/core/AnnualCycleService.js',
  'src/core/ClubEmploymentContextCatalog.js',
  'src/core/ContractSeeder.js',
  'src/core/RegistrationSeeder.js',
  'src/core/CpuRosterPlanner.js',
  'src/core/MarketClearinghouse.js',
  'src/core/RosterLegalityService.js',
  'src/core/TransferService.js',
  'src/core/LoanService.js',
];

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

check('ningún call-site productivo de competitionIdFromLegacyDivision en los nueve servicios', () => {
  MIGRATED_SERVICES.forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(
      !/competitionIdFromLegacyDivision\s*\(/.test(code),
      `${file} sigue resolviendo competición desde la división legacy`,
    );
  });
});

check('ningún servicio migrado lee `.division` en código (solo comentarios)', () => {
  MIGRATED_SERVICES.concat(['src/core/ContractService.js']).forEach((file) => {
    const code = stripComments(readSource(file));
    assert.ok(!/\.division\b/.test(code), `${file} sigue leyendo team.division`);
    assert.ok(!/legacyDivision/.test(code), `${file} sigue leyendo legacyDivision`);
  });
});

check('src/ui/game.js no usa el adaptador legacy en código productivo', () => {
  const code = stripComments(readSource('src/ui/game.js'));
  assert.ok(!/competitionIdFromLegacyDivision\s*\(/.test(code), 'game.js no puede llamar al adaptador legacy');
});

check('el servicio de contexto es GENÉRICO: sin literales de país/liga/división', () => {
  const code = stripComments(readSource('src/core/CompetitionContextService.js'));
  [/1ª/, /2ª/, /\bACB\b/, /Primera FEB/, /\bEspaña\b/, /competitionIdFromLegacyDivision/].forEach((pattern) => {
    assert.ok(!pattern.test(code), `CompetitionContextService.js contiene un literal prohibido: ${pattern}`);
  });
});

// =====================================================================
group('7. Consultar no muta ni consume aleatoriedad');
// =====================================================================

check('resolver el contexto competitivo no muta el mundo ni consume Math.random', () => {
  const team = teamById('team-real-madrid');
  const before = JSON.stringify(spain.world.registries.competitionEntries.forParticipant(team.id).map((e) => e.toJSON()));
  const divisionBefore = team.division;
  const originalRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => { randomCalls += 1; return originalRandom(); };
  try {
    for (let i = 0; i < 5; i += 1) {
      CompetitionContextService.resolveDomesticCompetitionId(spain.world.registries, team.id, { seasonKey: SEASON });
    }
  } finally {
    Math.random = originalRandom;
  }
  assert.strictEqual(randomCalls, 0, 'una consulta NUNCA consume aleatoriedad');
  assert.strictEqual(
    JSON.stringify(spain.world.registries.competitionEntries.forParticipant(team.id).map((e) => e.toJSON())),
    before,
    'una consulta NUNCA muta las Entries',
  );
  assert.strictEqual(team.division, divisionBefore, 'una consulta NUNCA proyecta división');
});

check('un fallo de resolución NO deja ningún cambio parcial aplicado', () => {
  const team = teamById('team-real-madrid');
  const playerRegistry = new PlayerRegistry();
  playerRegistry.registerMany(team.roster);
  const contractRegistry = new ContractRegistry();
  const registrationRegistry = new RegistrationRegistry();
  assert.throws(() => ContractSeeder.seedContractsForTeams({
    teams: [team], seasonKey: SEASON, date: GAME_DATE, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
  }), /falta el resolver obligatorio/);
  assert.strictEqual(contractRegistry.snapshot().length, 0, 'ningún contrato registrado tras un fallo de contexto');
  assert.throws(() => RegistrationSeeder.seedRegistrationsForTeams({
    teams: [team], seasonKey: SEASON, date: GAME_DATE, registrationRegistry, contractRegistry, config: CONFIG_BASE,
  }), /falta el resolver obligatorio/);
  assert.strictEqual(registrationRegistry.allLicenses().length, 0, 'ninguna licencia emitida tras un fallo de contexto');
  assert.strictEqual(new LoanRegistry().allAgreements().length, 0);
});

console.log(`\n${passed} OK, ${failed} FAIL`);
if (failed > 0) process.exit(1);
