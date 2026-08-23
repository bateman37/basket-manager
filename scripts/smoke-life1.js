#!/usr/bin/env node
// scripts/smoke-life1.js
// Prueba de humo LIFE-1 (DESIGN.md 9) contra la Liga real de 36 equipos/414
// jugadores reales — replica en Node el mismo camino que game.js usa para
// resolver partidos CPU-CPU (buildCpuLineup + computeMatchImportance,
// mismo patrón que buildCpuOnlyResolver en src/ui/game.js) para poder
// generar `result.rotation` real y ejercitar matchExposures/facilityFactor
// de principio a fin sin necesitar DOM. Ejecutar con:
//   node scripts/smoke-life1.js

const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const { League } = require('../src/core/League.js');
const { Calendar } = require('../src/core/Calendar.js');
const { buildCpuLineup, computeMatchImportance } = require('../src/core/CpuLineup.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');

function buildRealTeam(teamData, referenceDate) {
  const roster = teamData.roster.map((playerData) => {
    const { dataSource, ...playerFields } = playerData;
    const player = new Player(playerFields);
    player.dataSource = dataSource || null;
    PD.ensureDevelopmentState(player, CONFIG_BASE, referenceDate);
    return player;
  });
  return new Team({ ...teamData, roster });
}

function buildCpuResolver(league) {
  return (match) => {
    const standingsTable = league.getStandingsTable();
    const homeImportance = computeMatchImportance(match.homeTeam, match.awayTeam, 'league', standingsTable, CONFIG_BASE);
    const awayImportance = computeMatchImportance(match.awayTeam, match.homeTeam, 'league', standingsTable, CONFIG_BASE);
    const home = buildCpuLineup(match.homeTeam, homeImportance, CONFIG_BASE);
    const away = buildCpuLineup(match.awayTeam, awayImportance, CONFIG_BASE);
    return {
      homeSquad: home.squad, homeLineup: home.lineup,
      awaySquad: away.squad, awayLineup: away.lineup,
    };
  };
}

function applyRecoveryForResolvedMatch(homeTeam, awayTeam, result, date, competitionKey = 'league') {
  if (!date || !result.rotation) return;
  const { applyRestRecovery } = require('../src/core/Recovery.js');
  [{ team: homeTeam, rotation: result.rotation.home }, { team: awayTeam, rotation: result.rotation.away }]
    .forEach(({ team, rotation }) => {
      if (!rotation) return;
      team.roster.forEach((player) => {
        const playedSeconds = rotation.playedSeconds[player.id] || 0;
        if (playedSeconds <= 0) return;
        if (player.dynamicState.lastMatchDate) {
          const days = Math.round((date - player.dynamicState.lastMatchDate) / (1000 * 60 * 60 * 24));
          if (days > 0) applyRestRecovery([player], days, CONFIG_BASE);
        }
        player.recordMatchDate(date);
        PD.ensureDevelopmentState(player, CONFIG_BASE, date);
        PD.recordMatchExposure(player, {
          date, minutes: Math.round(playedSeconds / 60), competition: competitionKey, division: team.division,
        });
        player.addExperience(1);
      });
    });
}

function processDevelopmentToDateForTeams(teams, date) {
  teams.forEach((team) => PD.processTeamToDate(team, date, CONFIG_BASE));
}

console.log('Construyendo 36 equipos reales (1ª+2ª)...');
const seasonStartYear = 2026;
const referenceDate = new Date(seasonStartYear, CONFIG_BASE.calendar.seasonStartMonth, CONFIG_BASE.calendar.seasonStartDay);
const calendar = new Calendar(seasonStartYear, CONFIG_BASE);

const teamsByDivision = {};
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div)
    .map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id], referenceDate));
});

const totalPlayers = teamsByDivision['1ª'].concat(teamsByDivision['2ª']).reduce((n, t) => n + t.roster.length, 0);
console.log(`OK: ${teamsByDivision['1ª'].length + teamsByDivision['2ª'].length} equipos, ${totalPlayers} jugadores reales migrados.`);

const leagueDateResolver = (div) => (round, matchIndexInRound, matchesInRound, totalRounds) => (
  calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
);
const leagues = {
  '1ª': new League(teamsByDivision['1ª'], leagueDateResolver('1ª')),
  '2ª': new League(teamsByDivision['2ª'], leagueDateResolver('2ª')),
};

const ROUNDS_TO_SIMULATE = 12;
console.log(`Simulando ${ROUNDS_TO_SIMULATE} jornadas en ambas divisiones (invariantes 34/35)...`);
for (let r = 0; r < ROUNDS_TO_SIMULATE; r++) {
  ['1ª', '2ª'].forEach((div) => {
    const league = leagues[div];
    if (league.isSeasonComplete) return;
    const resolver = buildCpuResolver(league);
    const matches = league.simulateNextRound(undefined, resolver);
    matches.forEach((m) => applyRecoveryForResolvedMatch(m.homeTeam, m.awayTeam, m.result, m.date));
    if (matches.length) {
      calendar.advanceTo(matches[matches.length - 1].date);
      processDevelopmentToDateForTeams(teamsByDivision['1ª'].concat(teamsByDivision['2ª']), matches[matches.length - 1].date);
    }
  });
}

// Comprueba que hubo exposición real registrada y consumida, y que algún
// atributo mutable se movió (residual != 0 para varios jugadores).
let playersWithExposureHistoryTouched = 0;
let playersWithMovedResidual = 0;
teamsByDivision['1ª'].concat(teamsByDivision['2ª']).forEach((team) => {
  team.roster.forEach((player) => {
    if (!player.developmentState) throw new Error(`Jugador ${player.fullName} sin developmentState tras simular`);
    const moved = Object.values(player.developmentState.attributeProgress).some((v) => Math.abs(v) > 1e-6);
    if (moved) playersWithMovedResidual += 1;
    if (player.dynamicState.lastMatchDate) playersWithExposureHistoryTouched += 1;
    // Invariantes 1-3.
    const tmb = PD.computeTmbRating(player, CONFIG_BASE);
    if (tmb < 1 || tmb > 200) throw new Error(`TMB fuera de rango para ${player.fullName}: ${tmb}`);
    if (player.hidden.potential < 1 || player.hidden.potential > 200) {
      throw new Error(`Potential fuera de rango para ${player.fullName}: ${player.hidden.potential}`);
    }
    ['technical', 'physical', 'mental'].forEach((group) => {
      Object.values(player[group]).forEach((v) => {
        if (v < 1 || v > 20) throw new Error(`Atributo fuera de 1-20 en ${player.fullName} (${group}): ${v}`);
      });
    });
  });
});
console.log(`Jugadores con partidos jugados: ${playersWithExposureHistoryTouched}/${totalPlayers}`);
console.log(`Jugadores con residual de desarrollo movido: ${playersWithMovedResidual}/${totalPlayers}`);

// Cierre de temporada + academy intake (invariante 36) sobre las 36
// plantillas reales, replicando el orden de closeSeasonAndPrepareNext().
console.log('Cerrando temporada (academy intake, invariante 36)...');
const seasonEndDateTime = calendar.currentGameDateTime;
const allTeams = teamsByDivision['1ª'].concat(teamsByDivision['2ª']);
processDevelopmentToDateForTeams(allTeams, seasonEndDateTime);
const rosterSizeBefore = {};
allTeams.forEach((t) => { rosterSizeBefore[t.id] = t.roster.length; });
allTeams.forEach((t) => t.generateAcademyIntake(3, seasonEndDateTime));
allTeams.forEach((t) => {
  const newPlayers = t.roster.slice(rosterSizeBefore[t.id]);
  newPlayers.forEach((p) => {
    const result = PD.processPlayerToDate(p, seasonEndDateTime, CONFIG_BASE, {});
    if (result.ticks !== 0) throw new Error(`Canterano nuevo de ${t.fullName} recibió progreso retroactivo (${result.ticks} ticks)`);
  });
});
console.log('OK: ningún canterano nuevo recibió progreso retroactivo.');

console.log('\nSMOKE TEST LIFE-1: OK (sin excepciones, 36 equipos / 414+ jugadores reales, ambas divisiones).');
