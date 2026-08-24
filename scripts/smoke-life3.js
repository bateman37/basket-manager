#!/usr/bin/env node
// scripts/smoke-life3.js
// Prueba de humo LIFE-3 (DESIGN.md 9.14) contra la Liga real de 36 equipos/
// 414+ jugadores reales — replica en Node el camino real de game.js
// (Training.prepareTeamForMatch -> CpuLineup.buildCpuLineup ->
// MatchEngine.simulateMatch, con Medical.js activado de principio a fin)
// para una temporada regular completa en ambas divisiones, incluyendo
// Copa (1ª) y Playoff por el título/Ascenso al terminar la liga regular,
// y reporta estadísticas de calibración (sección 37 del prompt de esta
// sesión). Ejecutar con:
//   node scripts/smoke-life3.js

const assert = require('assert');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const Training = require('../src/core/Training.js');
const TrainingAI = require('../src/core/TrainingAI.js');
const Medical = require('../src/core/Medical.js');
const { League } = require('../src/core/League.js');
const { Calendar } = require('../src/core/Calendar.js');
const { buildCpuLineup, computeMatchImportance } = require('../src/core/CpuLineup.js');
const { createCup, CUP_TRIGGER_ROUND } = require('../src/core/Cup.js');
const { createTitlePlayoff } = require('../src/core/Playoffs.js');
const { PromotionPlayoff } = require('../src/core/Promotion.js');
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

// ---------------------------------------------------------------------
// Estadísticas de calibración (sección 37 del prompt de esta sesión).
// ---------------------------------------------------------------------
const stats = {
  totalInjuries: 0,
  byMechanism: { acuteContact: 0, acuteNonContact: 0, overuse: 0 },
  byType: {},
  bySeverity: { minor: 0, moderate: 0, major: 0, severe: 0 },
  bySource: { match: 0, training: 0 },
  lowerLimbAreas: new Set(['ankle', 'knee', 'upperLeg', 'lowerLeg']),
  lowerLimbCount: 0,
  daysLost: 0,
  recurrences: 0,
  sequelae: 0,
  byTeam: new Map(),
  playersReturnedLimited: new Set(),
  loadCorrelationSamples: [], // { recentLoad, injured } para una revisión somera
};

function recordInjuryFromHistoryEntry(team, entry) {
  stats.totalInjuries += 1;
  stats.byMechanism[entry.mechanism] = (stats.byMechanism[entry.mechanism] || 0) + 1;
  stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
  stats.bySeverity[entry.severity] = (stats.bySeverity[entry.severity] || 0) + 1;
  const catalogEntry = CONFIG_BASE.medical.catalog[entry.type];
  if (catalogEntry && stats.lowerLimbAreas.has(catalogEntry.bodyArea)) stats.lowerLimbCount += 1;
  stats.daysLost += entry.daysUnavailable;
  if (entry.recurrenceOf) stats.recurrences += 1;
  if (entry.sequela) stats.sequelae += 1;
  stats.byTeam.set(team.id, (stats.byTeam.get(team.id) || 0) + 1);
}

// Snapshot de identidad médica de TODA la liga — permite detectar, por
// diferencia, nuevas lesiones/altas/entradas de historial sin que
// Training.js/Medical.js tengan que devolver un log de eventos (mismo
// criterio que game.js, ver snapshotMedicalIdentity()).
function snapshotAll(teams) {
  const map = new Map();
  teams.forEach((team) => {
    team.roster.forEach((player) => {
      map.set(player.id, {
        currentInjuryId: (player.medicalState && player.medicalState.currentInjury) ? player.medicalState.currentInjury.id : null,
        historyLength: player.medicalState ? player.medicalState.injuryHistory.length : 0,
        source: null,
      });
    });
  });
  return map;
}

function diffAndRecord(teams, before) {
  teams.forEach((team) => {
    team.roster.forEach((player) => {
      if (!player.medicalState) return;
      const prev = before.get(player.id);
      if (!prev) return;
      player.medicalState.injuryHistory.slice(prev.historyLength).forEach((entry) => {
        recordInjuryFromHistoryEntry(team, entry);
      });
    });
  });
}

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
  // Lesiones en directo de ESTE partido — registradas directamente desde
  // result.injuries (más preciso que el diff genérico, marca mechanism/
  // source ya conocidos).
  (result.injuries || []).forEach((inj) => {
    const team = inj.teamId === homeTeam.id ? homeTeam : awayTeam;
    stats.bySource.match += 1;
    void team;
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
console.log(`Simulando ${ROUNDS_TO_SIMULATE} jornadas en ambas divisiones (LIFE-3 activado)...`);
let cup = null;
for (let r = 0; r < ROUNDS_TO_SIMULATE; r++) {
  ['1ª', '2ª'].forEach((div) => {
    const league = leagues[div];
    if (league.isSeasonComplete) return;
    const before = snapshotAll(teamsByDivision[div]);
    const matches = league.simulateNextRound(undefined, buildResolver(league));
    matches.forEach((m) => applyPostMatchBookkeeping(m.homeTeam, m.awayTeam, m.result, m.date));
    diffAndRecord(teamsByDivision[div], before);
    if (matches.length) {
      const lastDate = matches[matches.length - 1].date;
      calendar.advanceTo(lastDate);
      const beforeDev = snapshotAll(teamsByDivision[div]);
      processDevelopmentToDateForTeams(teamsByDivision[div], lastDate);
      diffAndRecord(teamsByDivision[div], beforeDev);
      reviewCpu(teamsByDivision[div], lastDate, null);
    }
    if (div === '1ª' && league.currentRound === CUP_TRIGGER_ROUND + 1 && !cup) {
      cup = createCup(league, calendar.cupRoundDates());
    }
  });
}
console.log(`Copa creada: ${!!cup}. Jugándola hasta el final...`);
if (cup) {
  const cupDate = calendar.currentGameDateTime;
  while (!cup.isComplete) {
    const before = snapshotAll(allTeams);
    const game = cup.playNextGame(CONFIG_BASE, bracketResolver(cupDate));
    applyPostMatchBookkeeping(game.homeEntry.team, game.awayEntry.team, game.result, game.date, 'cup');
    diffAndRecord(allTeams, before);
  }
  console.log(`Copa completada. Campeón: ${cup.champion ? cup.champion.fullName : '(sin resolver)'}`);
}

console.log('Jugando Playoff por el título (1ª) y Playoff de ascenso (2ª)...');
const titlePlayoff = createTitlePlayoff(leagues['1ª']);
const promotionPlayoff = new PromotionPlayoff(leagues['2ª']);
[titlePlayoff, promotionPlayoff].forEach((bracket) => {
  const date = calendar.currentGameDateTime;
  while (!bracket.isComplete) {
    const before = snapshotAll(allTeams);
    const game = bracket.playNextGame(CONFIG_BASE, bracketResolver(date));
    applyPostMatchBookkeeping(game.homeEntry.team, game.awayEntry.team, game.result, game.date, 'playoff');
    diffAndRecord(allTeams, before);
  }
});
console.log('Playoffs completados.');

console.log('\nEjecutando 5 temporadas sintéticas rápidas (colas/acumulación de riesgo)...');
for (let season = 0; season < 5; season++) {
  const fastTeam = teamsByDivision['1ª'][season % teamsByDivision['1ª'].length];
  let cursor = new Date(calendar.currentGameDateTime);
  for (let week = 0; week < 34; week++) {
    cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
    Training.prepareTeamForMatch(fastTeam, cursor, CONFIG_BASE, calendarCtx);
  }
}
console.log('Temporadas sintéticas OK (sin excepciones).');

// ---------------------------------------------------------------------
// Verificación de invariantes de integridad de plantilla.
// ---------------------------------------------------------------------
console.log('\nVerificando invariantes de integridad...');
let teamsBlockedBelow5 = 0;
allTeams.forEach((team) => {
  const callable = Medical.countMedicallyCallable(team.roster, team, calendar.currentGameDateTime, CONFIG_BASE);
  if (callable < 5) teamsBlockedBelow5 += 1;
  team.roster.forEach((player) => {
    assert.ok(player.dynamicState.energy >= 0 && player.dynamicState.energy <= 100, 'Energy fuera de rango');
    const tmb = PD.computeTmbRating(player, CONFIG_BASE);
    assert.ok(tmb >= 1 && tmb <= 200, 'TMB fuera de rango');
    if (player.medicalState) {
      if (player.medicalState.currentInjury) {
        const phase = Medical.computePhase(
          player.medicalState.currentInjury.recoveryProgress, player.medicalState.currentInjury.severity, CONFIG_BASE,
        );
        if (phase === 'limited') stats.playersReturnedLimited.add(player.id);
      }
    }
  });
});
assert.strictEqual(teamsBlockedBelow5, 0, 'ningún equipo debe quedar médicamente por debajo de 5 disponibles');

// ---------------------------------------------------------------------
// Reporte de calibración (sección 37).
// ---------------------------------------------------------------------
console.log('\n=== CALIBRACIÓN LIFE-3 ===');
console.log(`Lesiones totales (temporada regular+Copa+Playoffs): ${stats.totalInjuries}`);
console.log(`Por equipo (media): ${(stats.totalInjuries / allTeams.length).toFixed(2)}`);
console.log('Por mecanismo:', stats.byMechanism);
const nonContactShare = (stats.byMechanism.acuteNonContact + stats.byMechanism.overuse) / Math.max(1, stats.totalInjuries);
console.log(`Cuota sin contacto directo: ${(nonContactShare * 100).toFixed(1)}% (objetivo ~65-75%)`);
console.log('Por severidad:', stats.bySeverity);
const severeShare = stats.bySeverity.severe / Math.max(1, stats.totalInjuries);
console.log(`Cuota severa: ${(severeShare * 100).toFixed(1)}% (objetivo ~10-18%)`);
console.log(`Miembros inferiores: ${stats.lowerLimbCount}/${stats.totalInjuries} (${((stats.lowerLimbCount / Math.max(1, stats.totalInjuries)) * 100).toFixed(1)}%, objetivo ~65-80%)`);
console.log('Por tipo:', stats.byType);
console.log(`Días perdidos totales: ${stats.daysLost} (media ${(stats.daysLost / Math.max(1, stats.totalInjuries)).toFixed(1)} días/lesión)`);
console.log(`Recurrencias: ${stats.recurrences} · Secuelas: ${stats.sequelae}`);
// Nota: `bySource.match` cuenta lesiones detectadas EN EL INSTANTE de
// crearse durante un partido (result.injuries); el resto de
// `totalInjuries` (contado al CERRARSE cada lesión) son de entrenamiento
// más las de partido aún no cerradas al terminar esta simulación — cifra
// aproximada, suficiente para verificar orden de magnitud (sección 37).
console.log(`Partido vs entrenamiento (aprox.): partido~${stats.bySource.match}, resto~${stats.totalInjuries - stats.bySource.match}`);
console.log(`Jugadores que volvieron en estado 'limited' en algún momento: ${stats.playersReturnedLimited.size}`);
console.log(`Equipos por debajo de 5 disponibles: ${teamsBlockedBelow5} (debe ser 0)`);

console.log('\nSMOKE TEST LIFE-3: OK (sin excepciones, 36 equipos / 414+ jugadores reales, ambas divisiones, Copa+Playoffs+Ascenso).');
