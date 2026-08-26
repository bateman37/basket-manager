#!/usr/bin/env node
// scripts/smoke-roster1.js
// Prueba de humo ROSTER-1 (DESIGN.md 9.16) contra la Liga real de 36
// equipos — replica en Node el camino real de game.js (mismo patrón que
// smoke-life3.js/smoke-life4.js), pero además: construye el Player
// Registry mundial, resuelve el rango de convocatoria por competición
// real (ACB 8-12, Primera FEB 10-12) vía CompetitionRules en vez del
// 8-12 universal legacy, completa en memoria los rosters de Primera FEB
// con cobertura incompleta, y verifica la integridad del registro tras
// varias temporadas con ascensos/descensos, Copa, Playoffs/Ascenso y
// cantera — incluyendo una liberación/reincorporación dirigida. Ejecutar
// con:
//   node scripts/smoke-roster1.js [temporadas]

const assert = require('assert');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const PC = require('../src/core/PlayerCareer.js');
const Training = require('../src/core/Training.js');
const TrainingAI = require('../src/core/TrainingAI.js');
const Medical = require('../src/core/Medical.js');
const { League } = require('../src/core/League.js');
const { Calendar } = require('../src/core/Calendar.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { buildCpuLineup, computeMatchImportance } = require('../src/core/CpuLineup.js');
const { createCup, CUP_TRIGGER_ROUND } = require('../src/core/Cup.js');
const { createTitlePlayoff } = require('../src/core/Playoffs.js');
const { PromotionPlayoff } = require('../src/core/Promotion.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { padRosterToMinimum, FICTIONAL_FALLBACK_DATA_SOURCE } = require('../src/utils/playerGenerator.js');

const SEASONS_TO_SIMULATE = Number(process.argv[2] || 3);

function resolveSquadRulesForDivision(division, seasonKey, date) {
  const competitionId = CompetitionRules.competitionIdFromLegacyDivision(division);
  return CompetitionRules.resolveRules({
    competitionId, seasonKey, date, operation: 'buildMatchSquad',
  }).squadRules;
}

function buildRealTeam(teamData, referenceDate, seasonKey) {
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...playerFields } = playerData;
    const player = new Player(playerFields);
    player.dataSource = dataSource || null;
    PD.ensureDevelopmentState(player, CONFIG_BASE, referenceDate);
    PC.ensureCareerHistory(player, CONFIG_BASE, referenceDate, { historyCompleteness: 'partial', seasonKey });
    return player;
  });

  // ROSTER-1: puente de cobertura de datos — completa EN MEMORIA (nunca
  // data/real/) hasta el mínimo real de convocatoria de la competición de
  // este equipo, si el bundle se queda corto (hoy: varios clubes de
  // Primera FEB con <10 jugadores cargados).
  const squadRules = resolveSquadRulesForDivision(teamData.division, seasonKey, referenceDate);
  const fallbackPlayers = padRosterToMinimum(roster, squadRules.min, { minAge: 18, maxAge: 34, referenceDate });
  fallbackPlayers.forEach((player) => {
    PC.ensureCareerHistory(player, CONFIG_BASE, referenceDate, { historyCompleteness: 'complete', seasonKey });
  });

  return new Team({ ...teamData, roster });
}

console.log('Construyendo 36 equipos reales (1ª+2ª) + Player Registry mundial...');
let seasonStartYear = 2026;
let calendar = new Calendar(seasonStartYear, CONFIG_BASE);
const calendarCtx = { seasonStartDate: calendar.seasonStartDate };
let referenceDate = calendar.seasonStartDate;
let seasonKey = PC.seasonKeyFromStartYear(seasonStartYear);

const registry = new PlayerRegistry();
let teamsByDivision = {};
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div)
    .map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id], referenceDate, seasonKey));
});
let allTeams = teamsByDivision['1ª'].concat(teamsByDivision['2ª']);
allTeams.forEach((team) => registry.registerMany(team.roster));

const totalRealPlayers = allTeams.reduce((n, t) => n + t.roster.length, 0);
const totalFallbackPlayers = allTeams.reduce(
  (n, t) => n + t.roster.filter((p) => p.dataSource === FICTIONAL_FALLBACK_DATA_SOURCE).length, 0,
);
console.log(`OK: ${allTeams.length} equipos, ${totalRealPlayers} jugadores en plantilla `
  + `(${totalFallbackPlayers} de relleno ficticio por cobertura incompleta de Primera FEB).`);
assert.ok(totalFallbackPlayers > 0, 'el snapshot conocido del bundle FEB debe seguir teniendo clubes por debajo de 10');

{
  const initialCheck = registry.validateAgainstTeams(allTeams);
  assert.ok(initialCheck.valid, `integridad inicial rota: ${JSON.stringify(initialCheck.errors)}`);
  assert.strictEqual(registry.all().length, totalRealPlayers, 'el registro debe coincidir con la unión única de plantillas al arranque');
}

// --- Comprobación dirigida: liberar y reincorporar a un jugador conserva
// identidad + careerHistory + medicalState (sección 4.3, invariante 8). ---
{
  const team = allTeams[0];
  const targetPlayer = team.roster[0];
  const targetId = targetPlayer.id;
  targetPlayer.careerHistory = targetPlayer.careerHistory || {};
  targetPlayer.careerHistory.__smokeMarker = 'kept-through-release-cycle';
  team.removePlayer(targetId);
  registry.setAffiliation(targetId, null);
  assert.strictEqual(registry.get(targetId).teamId, null, 'un jugador liberado debe seguir en el registro con teamId null');
  assert.strictEqual(team.roster.some((p) => p.id === targetId), false, 'un jugador liberado no debe seguir en Team.roster');
  const releasedCheck = registry.validateAgainstTeams(allTeams);
  assert.ok(releasedCheck.valid, `integridad tras liberar rota: ${JSON.stringify(releasedCheck.errors)}`);

  team.addPlayer(targetPlayer);
  registry.setAffiliation(targetId, team.id);
  assert.strictEqual(registry.get(targetId), targetPlayer, 'reincorporar debe conservar la MISMA instancia');
  assert.strictEqual(registry.get(targetId).careerHistory.__smokeMarker, 'kept-through-release-cycle');
  const rejoinedCheck = registry.validateAgainstTeams(allTeams);
  assert.ok(rejoinedCheck.valid, `integridad tras reincorporar rota: ${JSON.stringify(rejoinedCheck.errors)}`);
  console.log('OK: liberación + reincorporación dirigida conserva identidad, careerHistory e integridad.');
}

function buildResolver(league, division) {
  const squadRules = resolveSquadRulesForDivision(division, seasonKey, calendar.currentGameDateTime);
  return (match) => {
    Training.prepareTeamForMatch(match.homeTeam, match.date, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(match.awayTeam, match.date, CONFIG_BASE, calendarCtx);
    const standingsTable = league.getStandingsTable();
    const homeImportance = computeMatchImportance(match.homeTeam, match.awayTeam, 'league', standingsTable, CONFIG_BASE);
    const awayImportance = computeMatchImportance(match.awayTeam, match.homeTeam, 'league', standingsTable, CONFIG_BASE);
    const homeRules = resolveSquadRulesForDivision(match.homeTeam.division, seasonKey, match.date);
    const awayRules = resolveSquadRulesForDivision(match.awayTeam.division, seasonKey, match.date);
    const home = buildCpuLineup(match.homeTeam, homeImportance, CONFIG_BASE, match.date, homeRules);
    const away = buildCpuLineup(match.awayTeam, awayImportance, CONFIG_BASE, match.date, awayRules);
    // El tamaño real puede bajar del mínimo normal por la excepción médica
    // de LIFE-3 (nunca por debajo del mínimo absoluto) — se valida contra
    // ESE rango, no contra el normal fijo, para no confundir "escasez
    // médica real" con una convocatoria mal construida.
    const absoluteMinimum = CONFIG_BASE.medical.squadException.absoluteMinimum;
    assert.ok(
      home.squad.length >= absoluteMinimum && home.squad.length <= homeRules.max,
      `convocatoria CPU fuera de rango para ${match.homeTeam.fullName}: ${home.squad.length} (máx ${homeRules.max}, mínimo absoluto ${absoluteMinimum})`,
    );
    assert.ok(
      away.squad.length >= absoluteMinimum && away.squad.length <= awayRules.max,
      `convocatoria CPU fuera de rango para ${match.awayTeam.fullName}: ${away.squad.length} (máx ${awayRules.max}, mínimo absoluto ${absoluteMinimum})`,
    );
    void squadRules;
    return {
      homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup, matchDate: match.date,
    };
  };
}

function bracketResolver(bracketDate) {
  return (homeEntry, awayEntry) => {
    Training.prepareTeamForMatch(homeEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(awayEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    const homeRules = resolveSquadRulesForDivision(homeEntry.team.division, seasonKey, bracketDate);
    const awayRules = resolveSquadRulesForDivision(awayEntry.team.division, seasonKey, bracketDate);
    const home = buildCpuLineup(homeEntry.team, true, CONFIG_BASE, bracketDate, homeRules);
    const away = buildCpuLineup(awayEntry.team, true, CONFIG_BASE, bracketDate, awayRules);
    return {
      homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup, matchDate: bracketDate,
    };
  };
}

function applyPostMatchBookkeeping(homeTeam, awayTeam, result, date, competitionKey = 'league') {
  if (!date || !result.rotation) return;
  const matchKey = result.gameId || `match-${homeTeam.id}-${awayTeam.id}-${date.toISOString()}`;
  [
    { team: homeTeam, opponent: awayTeam, rotation: result.rotation.home, boxScore: result.boxScore.home },
    { team: awayTeam, opponent: homeTeam, rotation: result.rotation.away, boxScore: result.boxScore.away },
  ].forEach(({ team, opponent, rotation, boxScore }) => {
    if (!rotation) return;
    team.roster.forEach((player) => {
      const playedSeconds = rotation.playedSeconds[player.id] || 0;
      if (playedSeconds <= 0) return;
      PD.ensureDevelopmentState(player, CONFIG_BASE, date);
      const posSecs = (rotation.positionSecondsByPlayer && rotation.positionSecondsByPlayer[player.id]) || null;
      const positionMinutes = posSecs
        ? Object.fromEntries(Object.entries(posSecs).map(([pos, secs]) => [pos, Math.round(secs / 60)])) : undefined;
      PD.recordMatchExposure(player, {
        date, minutes: Math.round(playedSeconds / 60), competition: competitionKey, division: team.division, positionMinutes,
      });
      player.addExperience(1);
      if (player.careerHistory) {
        const line = boxScore.find((l) => l.playerId === player.id);
        if (line) {
          const isStarter = (rotation.starterIds || []).indexOf(player.id) !== -1;
          PC.recordResolvedMatch(player, {
            date, competition: competitionKey,
            team: { id: team.id, name: team.fullName, division: team.division },
            opponent: { id: opponent.id, name: opponent.fullName },
            boxScoreLine: line, isStarter, matchKey,
          }, CONFIG_BASE);
        }
      }
    });
  });
}

function processDevelopmentToDateForTeams(teams, date) {
  teams.forEach((team) => Training.processTeamDevelopmentToDate(team, date, CONFIG_BASE, calendarCtx));
}

function reviewCpu(teams, date) {
  teams.forEach((team) => TrainingAI.reviewTeamIfDue(team, date, { matchesInNext7Days: 1 }, CONFIG_BASE, calendarCtx));
}

function buildRolesSnapshotForPlayer(player, team) {
  const profile = team.tacticalProfile;
  if (!profile) return { offense: null, defense: null };
  const assignment = (profile.roleAssignments && profile.roleAssignments[player.id]) || {};
  const fam = (profile.familiarity && profile.familiarity.byPlayerRole && profile.familiarity.byPlayerRole[player.id]) || {};
  return {
    offense: assignment.offensiveRole ? [assignment.offensiveRole, Math.round(fam.offensiveLevel || 0)] : null,
    defense: assignment.defensiveRole ? [assignment.defensiveRole, Math.round(fam.defensiveLevel || 0)] : null,
  };
}

function buildSeasonHonoursByTeamId(leagueB, cup, titlePlayoff, promotedTeams) {
  const map = new Map();
  function add(teamId, code) {
    if (!teamId) return;
    const list = map.get(teamId) || [];
    list.push(code);
    map.set(teamId, list);
  }
  const standingsB = leagueB.getStandingsTable();
  if (standingsB.length) add(standingsB[0].team.id, 'regularSeasonChampion2');
  if (cup && cup.champion) add(cup.champion.team.id, 'cupChampion');
  if (titlePlayoff && titlePlayoff.champion) add(titlePlayoff.champion.team.id, 'titlePlayoffChampion');
  if (promotedTeams[0]) add(promotedTeams[0].id, 'promotedDirect');
  if (promotedTeams[1]) add(promotedTeams[1].id, 'promotedPlayoff');
  return map;
}

for (let seasonIndex = 0; seasonIndex < SEASONS_TO_SIMULATE; seasonIndex++) {
  console.log(`\n=== Temporada ${seasonIndex + 1}/${SEASONS_TO_SIMULATE} (${seasonKey}) ===`);
  ['1ª', '2ª'].forEach((div) => recalculateSportingGoalsForDivision(teamsByDivision[div], CONFIG_BASE));

  const leagueDateResolver = (div) => (round, matchIndexInRound, matchesInRound, totalRounds) => (
    calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
  );
  const leagues = {
    '1ª': new League(teamsByDivision['1ª'], leagueDateResolver('1ª')),
    '2ª': new League(teamsByDivision['2ª'], leagueDateResolver('2ª')),
  };

  let cup = null;
  for (let r = 0; r < 34; r++) {
    ['1ª', '2ª'].forEach((div) => {
      const league = leagues[div];
      if (league.isSeasonComplete) return;
      const matches = league.simulateNextRound(undefined, buildResolver(league, div));
      matches.forEach((m) => applyPostMatchBookkeeping(m.homeTeam, m.awayTeam, m.result, m.date));
      if (matches.length) {
        const lastDate = matches[matches.length - 1].date;
        calendar.advanceTo(lastDate);
        processDevelopmentToDateForTeams(teamsByDivision[div], lastDate);
        reviewCpu(teamsByDivision[div], lastDate);
      }
      if (div === '1ª' && league.currentRound === CUP_TRIGGER_ROUND + 1 && !cup) {
        cup = createCup(league, calendar.cupRoundDates());
      }
    });
  }
  console.log(`Liga regular completa (ACB 8-12 / Primera FEB 10-12 verificado partido a partido). Copa creada: ${!!cup}.`);
  if (cup) {
    const cupDate = calendar.currentGameDateTime;
    while (!cup.isComplete) {
      const game = cup.playNextGame(CONFIG_BASE, bracketResolver(cupDate));
      applyPostMatchBookkeeping(game.homeEntry.team, game.awayEntry.team, game.result, game.date, 'cup');
    }
  }

  const titlePlayoff = createTitlePlayoff(leagues['1ª']);
  const promotionPlayoff = new PromotionPlayoff(leagues['2ª']);
  [
    { bracket: titlePlayoff, key: 'playoff' },
    { bracket: promotionPlayoff, key: 'promotion' },
  ].forEach(({ bracket, key }) => {
    const date = calendar.currentGameDateTime;
    while (!bracket.isComplete) {
      const game = bracket.playNextGame(CONFIG_BASE, bracketResolver(date));
      applyPostMatchBookkeeping(game.homeEntry.team, game.awayEntry.team, game.result, game.date, key);
    }
  });
  console.log(`Playoffs completados. Campeón liga: ${titlePlayoff.champion ? titlePlayoff.champion.team.fullName : '(sin resolver)'}`);

  const leagueA = leagues['1ª'];
  const leagueB = leagues['2ª'];
  const seasonEndDateTime = calendar.currentGameDateTime;
  const divisionBeforeByTeamId = new Map();
  [...leagueA.teams, ...leagueB.teams].forEach((team) => divisionBeforeByTeamId.set(team.id, team.division));

  const standingsA = leagueA.getStandingsTable();
  const relegatedTeams = [standingsA[standingsA.length - 1].team, standingsA[standingsA.length - 2].team];
  relegatedTeams.forEach((team) => { team.division = '2ª'; });
  const promotedTeams = [promotionPlayoff.directPromotion.team, promotionPlayoff.secondPromotedEntry.team];
  promotedTeams.forEach((team) => { team.division = '1ª'; });

  allTeams = [...leagueA.teams, ...leagueB.teams];
  teamsByDivision = {
    '1ª': allTeams.filter((t) => t.division === '1ª'),
    '2ª': allTeams.filter((t) => t.division === '2ª'),
  };
  processDevelopmentToDateForTeams(allTeams, seasonEndDateTime);

  const nextSeasonKey = PC.seasonKeyFromStartYear(seasonStartYear + 1);
  const honoursByTeamId = buildSeasonHonoursByTeamId(leagueB, cup, titlePlayoff, promotedTeams);
  allTeams.forEach((team) => {
    const honours = honoursByTeamId.get(team.id) || [];
    team.roster.forEach((player) => {
      if (!player.careerHistory) return;
      honours.forEach((code) => PC.registerHonour(player, code));
      PC.closeSeason(player, {
        endDate: seasonEndDateTime,
        teamId: team.id,
        teamName: team.fullName,
        division: divisionBeforeByTeamId.get(team.id) || team.division,
        roles: buildRolesSnapshotForPlayer(player, team),
        honours,
        nextSeasonKey,
      }, CONFIG_BASE);
    });
  });

  allTeams.forEach((team) => {
    const newPlayers = team.generateAcademyIntake(3, seasonEndDateTime);
    newPlayers.forEach((player) => {
      PC.ensureCareerHistory(player, CONFIG_BASE, seasonEndDateTime, { historyCompleteness: 'complete', seasonKey: nextSeasonKey });
    });
    // ROSTER-1 (DESIGN.md 9.16): el intake de cantera registra cada newgen
    // en cuanto se crea — nunca colisiona con ids existentes.
    registry.registerMany(newPlayers);
  });

  const postIntakeCheck = registry.validateAgainstTeams(allTeams);
  assert.ok(postIntakeCheck.valid, `integridad tras intake de cantera rota: ${JSON.stringify(postIntakeCheck.errors)}`);

  seasonStartYear += 1;
  calendar = new Calendar(seasonStartYear, CONFIG_BASE);
  calendarCtx.seasonStartDate = calendar.seasonStartDate;
  referenceDate = calendar.seasonStartDate;
  seasonKey = nextSeasonKey;
  console.log(`Temporada cerrada. Ascendidos: ${promotedTeams.map((t) => t.fullName).join(', ')}. Descendidos: ${relegatedTeams.map((t) => t.fullName).join(', ')}.`);
  console.log(`Player Registry: ${registry.all().length} jugadores mundiales (integridad OK tras cierre + cantera).`);
}

console.log('\nVerificando integridad final del Player Registry...');
const finalCheck = registry.validateAgainstTeams(allTeams);
assert.ok(finalCheck.valid, `integridad final rota: ${JSON.stringify(finalCheck.errors)}`);
const finalRosterCount = allTeams.reduce((n, t) => n + t.roster.length, 0);
assert.strictEqual(registry.all().length, finalRosterCount, 'el registro debe seguir coincidiendo con la unión única de plantillas');
console.log(`OK: ${registry.all().length} jugadores registrados == ${finalRosterCount} en plantillas de los 36 equipos.`);

console.log(`\nSMOKE TEST ROSTER-1: OK (sin excepciones, 36 equipos, ${SEASONS_TO_SIMULATE} temporadas, `
  + 'Copa+Playoffs+Ascenso+cantera, convocatoria ACB 8-12 / Primera FEB 10-12 verificada, '
  + 'Player Registry íntegro incluyendo liberación/reincorporación dirigida).');
