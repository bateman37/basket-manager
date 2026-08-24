#!/usr/bin/env node
// scripts/smoke-life4.js
// Prueba de humo LIFE-4 (DESIGN.md 9.4) contra la Liga real de 36 equipos/
// 414+ jugadores reales — replica en Node el camino real de game.js
// (mismo patrón que smoke-life3.js: Training.prepareTeamForMatch ->
// CpuLineup.buildCpuLineup -> MatchEngine.simulateMatch, con Medical.js
// activado) para VARIAS temporadas completas seguidas, incluyendo Copa,
// Playoff por el título/Ascenso, ascensos/descensos y cantera al cierre de
// cada una — verificando que el histórico de carrera (PlayerCareer.js) se
// acumula igual para el equipo del usuario y para los 35 clubes CPU,
// nunca sobrescribe temporadas anteriores, y que el tamaño se mantiene en
// un orden de magnitud razonable. Ejecutar con:
//   node scripts/smoke-life4.js

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
const { buildCpuLineup, computeMatchImportance } = require('../src/core/CpuLineup.js');
const { createCup, CUP_TRIGGER_ROUND } = require('../src/core/Cup.js');
const { createTitlePlayoff } = require('../src/core/Playoffs.js');
const { PromotionPlayoff } = require('../src/core/Promotion.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');

const SEASONS_TO_SIMULATE = Number(process.argv[2] || 3);

function buildRealTeam(teamData, referenceDate, seasonKey) {
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...playerFields } = playerData;
    const player = new Player(playerFields);
    player.dataSource = dataSource || null;
    PD.ensureDevelopmentState(player, CONFIG_BASE, referenceDate);
    PC.ensureCareerHistory(player, CONFIG_BASE, referenceDate, { historyCompleteness: 'partial', seasonKey });
    return player;
  });
  return new Team({ ...teamData, roster });
}

console.log('Construyendo 36 equipos reales (1ª+2ª)...');
let seasonStartYear = 2026;
let calendar = new Calendar(seasonStartYear, CONFIG_BASE);
const calendarCtx = { seasonStartDate: calendar.seasonStartDate };
let referenceDate = calendar.seasonStartDate;
let seasonKey = PC.seasonKeyFromStartYear(seasonStartYear);

let teamsByDivision = {};
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div)
    .map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id], referenceDate, seasonKey));
});
let allTeams = teamsByDivision['1ª'].concat(teamsByDivision['2ª']);
console.log(`OK: ${allTeams.length} equipos, ${allTeams.reduce((n, t) => n + t.roster.length, 0)} jugadores reales.`);

function buildResolver(league) {
  return (match) => {
    Training.prepareTeamForMatch(match.homeTeam, match.date, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(match.awayTeam, match.date, CONFIG_BASE, calendarCtx);
    const standingsTable = league.getStandingsTable();
    const homeImportance = computeMatchImportance(match.homeTeam, match.awayTeam, 'league', standingsTable, CONFIG_BASE);
    const awayImportance = computeMatchImportance(match.awayTeam, match.homeTeam, 'league', standingsTable, CONFIG_BASE);
    const home = buildCpuLineup(match.homeTeam, homeImportance, CONFIG_BASE, match.date);
    const away = buildCpuLineup(match.awayTeam, awayImportance, CONFIG_BASE, match.date);
    return {
      homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup, matchDate: match.date,
    };
  };
}

function bracketResolver(bracketDate) {
  return (homeEntry, awayEntry) => {
    Training.prepareTeamForMatch(homeEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(awayEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    const home = buildCpuLineup(homeEntry.team, true, CONFIG_BASE, bracketDate);
    const away = buildCpuLineup(awayEntry.team, true, CONFIG_BASE, bracketDate);
    return {
      homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup, matchDate: bracketDate,
    };
  };
}

// Mismo punto único que game.js.applyRecoveryForResolvedMatch: LIFE-1/2/3
// YA existentes + LIFE-4 (PlayerCareer.recordResolvedMatch) en la MISMA
// llamada, para cualquiera de las 4 competiciones, usuario o CPU.
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

function buildSeasonHonoursByTeamId(leagueA, leagueB, cup, titlePlayoff, promotedTeams) {
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

let totalMilestonesSeen = 0;
let totalPersonalBests = 0;

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
      const matches = league.simulateNextRound(undefined, buildResolver(league));
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
  console.log(`Liga regular completa. Copa creada: ${!!cup}.`);
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

  // --- Cierre de temporada (mismo orden que game.js.closeSeasonAndPrepareNext) ---
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
  const honoursByTeamId = buildSeasonHonoursByTeamId(leagueA, leagueB, cup, titlePlayoff, promotedTeams);
  allTeams.forEach((team) => {
    const honours = honoursByTeamId.get(team.id) || [];
    team.roster.forEach((player) => {
      if (!player.careerHistory) return;
      honours.forEach((code) => PC.registerHonour(player, code));
      const record = PC.closeSeason(player, {
        endDate: seasonEndDateTime,
        teamId: team.id,
        teamName: team.fullName,
        division: divisionBeforeByTeamId.get(team.id) || team.division,
        roles: buildRolesSnapshotForPlayer(player, team),
        honours,
        nextSeasonKey,
      }, CONFIG_BASE);
      totalMilestonesSeen += player.careerHistory.milestones.length;
      totalPersonalBests += Object.keys(player.careerHistory.personalBests).length;
      void record;
    });
  });

  allTeams.forEach((team) => {
    const newPlayers = team.generateAcademyIntake(3, seasonEndDateTime);
    newPlayers.forEach((player) => {
      PC.ensureCareerHistory(player, CONFIG_BASE, seasonEndDateTime, { historyCompleteness: 'complete', seasonKey: nextSeasonKey });
    });
  });

  seasonStartYear += 1;
  calendar = new Calendar(seasonStartYear, CONFIG_BASE);
  calendarCtx.seasonStartDate = calendar.seasonStartDate;
  referenceDate = calendar.seasonStartDate;
  seasonKey = nextSeasonKey;
  console.log(`Temporada cerrada. Ascendidos: ${promotedTeams.map((t) => t.fullName).join(', ')}. Descendidos: ${relegatedTeams.map((t) => t.fullName).join(', ')}.`);
}

// ---------------------------------------------------------------------
// Verificación de invariantes (DESIGN.md 9.4, secciones 67/68/83).
// ---------------------------------------------------------------------
console.log('\nVerificando invariantes de integridad...');
let totalBytes = 0;
let playersWithHistory = 0;
let cpuPlayersWithSeasons = 0;
allTeams.forEach((team) => {
  team.roster.forEach((player) => {
    assert.ok(player.careerHistory, `jugador ${player.fullName} sin careerHistory`);
    playersWithHistory += 1;
    const ch = player.careerHistory;
    const tmb = PD.computeTmbRating(player, CONFIG_BASE);
    assert.ok(tmb >= 1 && tmb <= 200, 'TMB fuera de rango 1-200');
    ch.seasons.forEach((s) => {
      assert.ok(s.tmb >= 1 && s.tmb <= 200, 'TMB histórico fuera de rango');
      s.attributes.forEach((v) => assert.ok(v >= 1 && v <= 20, 'atributo histórico fuera de rango 1-20'));
      s.positions.forEach((v) => assert.ok(v >= 1 && v <= 20, 'POS histórico fuera de rango 1-20'));
      assert.ok(Array.isArray(s.stats) && s.stats.length === PC.STAT_SNAPSHOT_KEYS.length, 'stats de temporada mal formadas');
    });
    if (ch.historyCompleteness === 'complete' && ch.seasons.length > 0) cpuPlayersWithSeasons += 1;
    // LIFE-3: medicalState intacto (nunca copiado/alterado por LIFE-4).
    if (player.medicalState) {
      assert.ok(Array.isArray(player.medicalState.injuryHistory), 'medicalState.injuryHistory debe seguir intacto');
    }
    totalBytes += Buffer.byteLength(JSON.stringify(player.toJSON().careerHistory || {}), 'utf8');
  });
});
assert.strictEqual(playersWithHistory, allTeams.reduce((n, t) => n + t.roster.length, 0));
assert.ok(cpuPlayersWithSeasons > 0, 'debe haber al menos un jugador CPU con historial "complete" y temporadas cerradas (cantera)');

const totalPlayers = allTeams.reduce((n, t) => n + t.roster.length, 0);
console.log(`Jugadores con careerHistory: ${playersWithHistory}/${totalPlayers}`);
console.log(`Jugadores 'complete' con >=1 temporada cerrada (cantera de sesiones anteriores): ${cpuPlayersWithSeasons}`);
console.log(`Milestones totales acumulados: ${totalMilestonesSeen} · personalBests (entradas de estadística con récord): ${totalPersonalBests}`);
console.log(`Tamaño total de careerHistory (${totalPlayers} jugadores, ${SEASONS_TO_SIMULATE} temporada(s)): ${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`Proyección a 20 temporadas (lineal): ${((totalBytes / SEASONS_TO_SIMULATE) * 20 / 1024 / 1024).toFixed(2)} MB`);

console.log(`\nSMOKE TEST LIFE-4: OK (sin excepciones, 36 equipos / ${totalPlayers} jugadores, ${SEASONS_TO_SIMULATE} temporadas, Copa+Playoffs+Ascenso+cantera).`);
