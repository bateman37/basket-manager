#!/usr/bin/env node
// scripts/smoke-life2.js
// Prueba de humo LIFE-2 (DESIGN.md 9) contra la Liga real de 36 equipos/414
// jugadores reales — replica en Node el camino real de game.js
// (buildMatchOptionsResolver -> Training.prepareTeamForMatch ANTES de
// CpuLineup.buildCpuLineup/MatchEngine.simulateMatch, TrainingAI.reviewTeamIfDue
// tras cada avance de reloj) para ejercitar Training.js/TrainingAI.js de
// principio a fin con datos reales, sin necesitar DOM. Ejecutar con:
//   node scripts/smoke-life2.js

const assert = require('assert');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const Training = require('../src/core/Training.js');
const TrainingAI = require('../src/core/TrainingAI.js');
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

console.log('Construyendo 36 equipos reales (1ª+2ª)...');
const seasonStartYear = 2026;
const calendar = new Calendar(seasonStartYear, CONFIG_BASE);
const calendarCtx = { seasonStartDate: calendar.seasonStartDate };
const referenceDate = calendar.seasonStartDate;

const teamsByDivision = {};
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div)
    .map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id], referenceDate));
});
const allTeams = teamsByDivision['1ª'].concat(teamsByDivision['2ª']);
console.log(`OK: ${allTeams.length} equipos, ${allTeams.reduce((n, t) => n + t.roster.length, 0)} jugadores reales.`);

// Un par de equipos con plan/foco no-default para ejercitar todas las
// ramas (offense/defense/physical/tactical, focos attribute/position/role).
const teamOffense = teamsByDivision['1ª'][0];
Training.setPlan(teamOffense, { teamFocus: 'offense', intensity: 'high' }, referenceDate, CONFIG_BASE, calendarCtx);
Training.setIndividualFocus(teamOffense, teamOffense.roster[0].id, { type: 'attribute', target: 'outsideShot' }, referenceDate, CONFIG_BASE, calendarCtx);

const teamTactical = teamsByDivision['1ª'][1];
Training.setPlan(teamTactical, { teamFocus: 'tactical', intensity: 'normal' }, referenceDate, CONFIG_BASE, calendarCtx);
teamTactical.tacticalProfile.roleAssignments[teamTactical.roster[0].id] = { offensiveRole: 'primaryCreator', defensiveRole: 'poaStopper' };
Training.setIndividualFocus(teamTactical, teamTactical.roster[0].id, { type: 'role', side: 'offense', target: 'primaryCreator' }, referenceDate, CONFIG_BASE, calendarCtx);

const teamPosition = teamsByDivision['2ª'][0];
const p = teamPosition.roster.find((pl) => pl.nominalPosition !== 'Pívot') || teamPosition.roster[0];
const altPos = p.nominalPosition === 'Base' ? 'Escolta' : 'Base';
p.positions[altPos] = 9; // forzado bajo a propósito, para medir crecimiento real (no heredar un valor real ya alto)
Training.setPlan(teamPosition, { teamFocus: 'physical', intensity: 'recovery' }, referenceDate, CONFIG_BASE, calendarCtx);
Training.setIndividualFocus(teamPosition, p.id, { type: 'position', target: altPos }, referenceDate, CONFIG_BASE, calendarCtx);

function buildResolver(league) {
  return (match) => {
    Training.prepareTeamForMatch(match.homeTeam, match.date, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(match.awayTeam, match.date, CONFIG_BASE, calendarCtx);
    const standingsTable = league.getStandingsTable();
    const homeImportance = computeMatchImportance(match.homeTeam, match.awayTeam, 'league', standingsTable, CONFIG_BASE);
    const awayImportance = computeMatchImportance(match.awayTeam, match.homeTeam, 'league', standingsTable, CONFIG_BASE);
    const home = buildCpuLineup(match.homeTeam, homeImportance, CONFIG_BASE);
    const away = buildCpuLineup(match.awayTeam, awayImportance, CONFIG_BASE);
    return {
      homeSquad: home.squad, homeLineup: home.lineup, awaySquad: away.squad, awayLineup: away.lineup,
    };
  };
}

function applyPostMatchBookkeeping(homeTeam, awayTeam, result, date, competitionKey = 'league') {
  if (!date || !result.rotation) return;
  [{ team: homeTeam, rotation: result.rotation.home }, { team: awayTeam, rotation: result.rotation.away }]
    .forEach(({ team, rotation }) => {
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
      });
    });
}

function processDevelopmentToDateForTeams(teams, date) {
  teams.forEach((team) => Training.processTeamDevelopmentToDate(team, date, CONFIG_BASE, calendarCtx));
}

function reviewCpu(teams, date, userTeamId) {
  teams.forEach((team) => {
    if (team.id === userTeamId) return;
    TrainingAI.reviewTeamIfDue(team, date, { matchesInNext7Days: 1 }, CONFIG_BASE, calendarCtx);
  });
}

const leagueDateResolver = (div) => (round, matchIndexInRound, matchesInRound, totalRounds) => (
  calendar.leagueMatchDateTime(round, matchIndexInRound, matchesInRound, totalRounds, div)
);
const leagues = {
  '1ª': new League(teamsByDivision['1ª'], leagueDateResolver('1ª')),
  '2ª': new League(teamsByDivision['2ª'], leagueDateResolver('2ª')),
};

const ROUNDS_TO_SIMULATE = 34;
console.log(`Simulando ${ROUNDS_TO_SIMULATE} jornadas en ambas divisiones (LIFE-2 pre-match hook + TrainingAI)...`);
for (let r = 0; r < ROUNDS_TO_SIMULATE; r++) {
  ['1ª', '2ª'].forEach((div) => {
    const league = leagues[div];
    if (league.isSeasonComplete) return;
    const matches = league.simulateNextRound(undefined, buildResolver(league));
    matches.forEach((m) => applyPostMatchBookkeeping(m.homeTeam, m.awayTeam, m.result, m.date));
    if (matches.length) {
      const lastDate = matches[matches.length - 1].date;
      calendar.advanceTo(lastDate);
      processDevelopmentToDateForTeams(teamsByDivision[div], lastDate);
      reviewCpu(teamsByDivision[div], lastDate, null);
    }
  });
}

console.log('Verificando invariantes...');
allTeams.forEach((team) => {
  team.roster.forEach((player) => {
    assert.ok(player.dynamicState.energy >= 0 && player.dynamicState.energy <= 100, `Energy fuera de rango: ${player.dynamicState.energy}`);
    const tmb = PD.computeTmbRating(player, CONFIG_BASE);
    assert.ok(tmb >= 1 && tmb <= 200, `TMB fuera de rango: ${tmb}`);
    ['technical', 'physical', 'mental'].forEach((group) => {
      Object.values(player[group]).forEach((v) => assert.ok(v >= 1 && v <= 20, `Atributo fuera de 1-20: ${v}`));
    });
    Object.values(player.positions).forEach((v) => assert.ok(v >= 1 && v <= 20, `Posición fuera de 1-20: ${v}`));
  });
  const fam = team.tacticalProfile.familiarity;
  [fam.offensiveSystem, fam.defensiveSystem, ...Object.values(fam.byPlayFamily), ...Object.values(fam.byCoverage)]
    .forEach((v) => assert.ok(v >= 0 && v <= 100, `Familiaridad fuera de 0-100: ${v}`));
  Object.values(fam.byPlayerRole).forEach((entry) => {
    assert.ok(entry.offensiveLevel >= 0 && entry.offensiveLevel <= 100, 'offensiveLevel fuera de rango');
    assert.ok(entry.defensiveLevel >= 0 && entry.defensiveLevel <= 100, 'defensiveLevel fuera de rango');
  });
});

assert.ok(PD.getEffectiveAttribute(teamOffense.roster[0], 'outsideShot') > teamOffense.roster[0].technical.outsideShot - 1,
  'foco de atributo debería reflejarse en el residual');
const posEntry = Training.ensurePositionProgress(p);
assert.ok(posEntry, 'foco posicional debería haber inicializado positionProgress');
const posGainTotal = (p.positions[altPos] - 9) + posEntry[altPos];
console.log(`Posición entrenada (${altPos}) de ${p.fullName}: rating=${p.positions[altPos]}, residual=${posEntry[altPos].toFixed(3)}, ganancia total=${posGainTotal.toFixed(2)} en ${ROUNDS_TO_SIMULATE} semanas`);

const roleEntry = teamTactical.tacticalProfile.familiarity.byPlayerRole[teamTactical.roster[0].id];
assert.ok(roleEntry && roleEntry.offensiveLevel > CONFIG_BASE.tactics.familiarity.roleDefaultInitial,
  'foco de rol debería haber crecido por encima del valor inicial');
console.log('Rol entrenado offensiveLevel:', roleEntry.offensiveLevel.toFixed(2));

console.log('\nSMOKE TEST LIFE-2: OK (sin excepciones, 36 equipos / 414+ jugadores reales, ambas divisiones).');
