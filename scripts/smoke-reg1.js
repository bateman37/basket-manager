#!/usr/bin/env node
// scripts/smoke-reg1.js
// Prueba de humo REG-1 (DESIGN.md 9.18) contra la Liga real de 36 equipos —
// replica en Node el camino real de game.js (mismo patrón que
// smoke-contract1.js/smoke-roster1.js) añadiendo la vertical de
// inscripción/licencias/elegibilidad completa: RegistrationRegistry
// explícito, bootstrap determinista, pool regulado para la CPU (senior +
// propios + vinculados), actas de partido idempotentes, transición de
// temporada (expiración + nuevas altas) y fixtures dirigidos de
// baja/reactivación por lesión y de jugador propio/vinculado.
//
// Ejecutar con:
//   node scripts/smoke-reg1.js [temporadas]

const assert = require('assert');
const Medical = require('../src/core/Medical.js');
const { Player } = require('../src/entities/Player.js');
const { Team } = require('../src/entities/Team.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const PD = require('../src/core/PlayerDevelopment.js');
const PC = require('../src/core/PlayerCareer.js');
const Training = require('../src/core/Training.js');
const TrainingAI = require('../src/core/TrainingAI.js');
const { League } = require('../src/core/League.js');
const { Calendar } = require('../src/core/Calendar.js');
const { PlayerRegistry } = require('../src/core/PlayerRegistry.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { ClubEmploymentContextCatalog } = require('../src/core/ClubEmploymentContextCatalog.js');
const { ContractRegistry } = require('../src/core/ContractRegistry.js');
const { ContractService } = require('../src/core/ContractService.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationRegistry } = require('../src/core/RegistrationRegistry.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');
const { RegistrationSeeder } = require('../src/core/RegistrationSeeder.js');
const { EligibilityService } = require('../src/core/EligibilityService.js');
const { SquadEligibilityService } = require('../src/core/SquadEligibilityService.js');
const Rotation = require('../src/core/Rotation.js');
const { Money } = require('../src/utils/Money.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const { buildCpuLineup, computeMatchImportance } = require('../src/core/CpuLineup.js');
const { createCup, CUP_TRIGGER_ROUND } = require('../src/core/Cup.js');
const { createTitlePlayoff } = require('../src/core/Playoffs.js');
const { PromotionPlayoff } = require('../src/core/Promotion.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { REAL_DATA_INDEX, REAL_DATA_TEAMS } = require('../data/real/real-data-bundle.js');
const { padRosterToMinimum, FICTIONAL_FALLBACK_DATA_SOURCE, generateFictionalPlayer } = require('../src/utils/playerGenerator.js');

// CYCLE-1 (DESIGN.md 9.22) — el cierre de temporada monolítico que este
// script hand-rollaba (ascensos -> expirar/resembrar inscripciones ->
// `generateAcademyIntake(3)` a los 36 clubes -> `new Calendar(...)`) queda
// RETIRADO. Se sustituye por el ciclo anual real vía el harness compartido
// (mismo patrón que smoke-loan1.js) — nunca una copia local del motor.
const cycle1 = require('./cycle1-harness.js');
const { AgentRegistry } = require('../src/core/AgentRegistry.js');
const { MarketRegistry } = require('../src/core/MarketRegistry.js');
const { TransferRegistry } = require('../src/core/TransferRegistry.js');
const { LoanRegistry } = require('../src/core/LoanRegistry.js');

const SEASONS_TO_SIMULATE = Number(process.argv[2] || 3);
const startedAt = Date.now();

function resolveRegistrationRulesForDivision(division, seasonKey, date, phaseId) {
  const competitionId = CompetitionRules.competitionIdFromLegacyDivision(division);
  return RegistrationService.resolveRegistrationRules({
    competitionId, seasonKey, date, phaseId: phaseId || 'league',
  });
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
  const resolved = resolveRegistrationRulesForDivision(teamData.division, seasonKey, referenceDate);
  const fallbackPlayers = padRosterToMinimum(roster, resolved.squadRules.min, {
    minAge: 18,
    maxAge: 34,
    referenceDate,
    // CYCLE-1 (BUG-CYCLE1-02): relleno DETERMINISTA. Este `padRosterToMinimum`
    // usaba `Math.random()`, así que CADA ejecución del smoke construía un
    // mundo distinto: por eso BUG-LOAN1-01 solo aparecía "de vez en cuando".
    // Con semilla e id explícitos el mundo es reproducible y un fallo se puede
    // volver a provocar.
    seed: `smoke-reg1|roster-fill|${teamData.id}`,
    id: `roster-fill:${teamData.id}`,
  });
  fallbackPlayers.forEach((player) => {
    PC.ensureCareerHistory(player, CONFIG_BASE, referenceDate, { historyCompleteness: 'complete', seasonKey });
  });
  return new Team({ ...teamData, roster });
}

// ---------------------------------------------------------------------
// Pool regulado (sección 11.1 del prompt de REG-1) — réplica en Node del
// mismo mecanismo que `game.js` (`buildEligiblePoolForMatch`): senior +
// propios de categoría inferior + vinculados autorizados, TODOS evaluados
// por el MISMO EligibilityService que usa el usuario.
// ---------------------------------------------------------------------
function buildEligiblePool(team, context, deps) {
  const { registrationRegistry, playerRegistry, contractRegistry, allTeamsById } = deps;
  const medicalAvailability = new Map();
  const classificationCache = deps.classificationCache;

  function evaluateFor(player, accessCategory, extraDeps) {
    if (CONFIG_BASE.medical.enabled && !medicalAvailability.has(player.id)) {
      const { getAvailability } = require('../src/core/Medical.js');
      medicalAvailability.set(player.id, getAvailability(player, context.date, CONFIG_BASE, { team }));
    }
    const evaluation = EligibilityService.evaluateEligibility(player.id, team.id, context, {
      playerRegistry,
      contractRegistry,
      registrationRegistry,
      medicalAvailability: CONFIG_BASE.medical.enabled ? medicalAvailability : null,
      classificationCache,
      ...extraDeps,
    });
    return { player, accessCategory, evaluation };
  }

  const pool = team.roster.map((player) => evaluateFor(player, 'senior'));

  registrationRegistry.registrationsForClub(team.id)
    .filter((r) => r.accessCategory === 'own-lower-category' && r.seasonKey === context.seasonKey && r.isEffectiveOn(context.date))
    .forEach((r) => {
      const player = playerRegistry.get(r.playerId);
      if (player) pool.push(evaluateFor(player, 'own-lower-category'));
    });

  registrationRegistry.linkAgreementsAsBeneficiary(team.id).forEach((agreement) => {
    const direction = agreement.upperClubId === team.id ? 'lowerToUpper' : 'upperToLower';
    const originClubId = direction === 'lowerToUpper' ? agreement.lowerClubId : agreement.upperClubId;
    const originTeam = allTeamsById.get(originClubId);
    if (!originTeam) return;
    const lowerClubTeam = direction === 'lowerToUpper' ? originTeam : team;
    const upperClubTeam = direction === 'lowerToUpper' ? team : originTeam;
    agreement.lists[direction].forEach((playerId) => {
      const player = playerRegistry.get(playerId);
      if (!player) return;
      pool.push(evaluateFor(player, 'linked', {
        linkAgreement: agreement,
        linkDirection: direction,
        lowerClubCompetitionId: CompetitionRules.competitionIdFromLegacyDivision(lowerClubTeam.division),
        upperClubCompetitionId: CompetitionRules.competitionIdFromLegacyDivision(upperClubTeam.division),
      }));
    });
  });

  return pool;
}

// Códigos de hallazgo colectivo que la excepción médica de convocatoria
// (DESIGN.md, "Excepción médica de convocatoria") NO cubre: una crisis
// médica real puede dejar a un club por debajo de su cupo de formación o
// por encima de su máximo no comunitario incluso teniendo margen de sobra
// en un día normal (varios titulares de esa clasificación lesionados a la
// vez) — no hay fuente oficial de una excepción explícita para estos dos
// cupos (a diferencia del mínimo de convocatoria, que sí la tiene), así
// que NO se inventa una regla no acordada: el sistema lo reconoce
// (`CpuLineup` cae al selector legacy con warning EXPLÍCITO) en vez de
// bloquear la simulación o fingir una convocatoria legal. El smoke test
// tolera esto SOLO cuando viene acompañado de ese warning — cualquier
// fallo de validación SIN warning, o con un código fuera de esta lista
// (tamaño, duplicado, jugador no elegible), sigue siendo un fallo real.
// CYCLE-1 (BUG-LOAN1-01, ver smoke-loan1.js): un acta solo puede quedar
// INVÁLIDA cuando el partido se juega bajo EXCEPCIÓN MÉDICA de convocatoria
// (mínimo reducido por escasez médica real) y el incumplimiento es de un
// cupo COLECTIVO que esa escasez hace inevitable. Comprobar solo
// `built.warnings.length > 0` (versión REG-1 original de este script) ya no
// basta: `CpuLineup.buildCpuLineup` ahora devuelve un resultado TIPADO
// (`outcome: 'legal' | 'medical-exception' | 'infeasible'`) y una
// imposibilidad reglamentaria (`infeasible`) NUNCA debe llegar hasta aquí —
// se corta antes de jugar en `buildSquadWithSelfHeal()`. Se exige el
// resultado tipado, igual que smoke-loan1.js.
const TOLERATED_INFEASIBLE_FINDING_CODES = new Set(['FORMATION_QUOTA_NOT_MET', 'NON_COMMUNITY_CAP_EXCEEDED']);
let totalToleratedInfeasibleActs = 0;

function assertActValid(matchId, team, validation, built, pool) {
  if (validation.valid) {
    const evaluationsById = new Map(pool.map((entry) => [entry.player.id, entry.evaluation]));
    built.squad.forEach((player) => {
      const evaluation = evaluationsById.get(player.id);
      assert.ok(evaluation && evaluation.eligible, `[${matchId}] ${player.fullName} en acta sin ser individualmente elegible`);
    });
    return;
  }
  const blockingCodes = validation.findings.filter((f) => f.severity === 'blocking').map((f) => f.code);
  const isKnownTolerated = built.outcome === 'medical-exception'
    && blockingCodes.every((code) => TOLERATED_INFEASIBLE_FINDING_CODES.has(code));
  assert.ok(
    isKnownTolerated,
    `[${matchId}] acta inválida para ${team.fullName} sin ser una infeasibilidad médica conocida `
    + `(outcome=${built.outcome}, bloqueos=${blockingCodes.join(',')})`,
  );
  totalToleratedInfeasibleActs += 1;
}

function recordMatchActSnapshot(team, squad, context, resolved, pool, registrationRegistry, configuredAt) {
  const evaluationsById = new Map(pool.map((entry) => [entry.player.id, entry.evaluation]));
  // Excepción médica de convocatoria (DESIGN.md) — mismo cálculo que
  // CpuLineup.js/game.js: el acta no exige el mínimo normal si la escasez
  // médica real de la plantilla cae por debajo.
  const callableCount = pool.filter((entry) => (
    entry.evaluation.eligible && Medical.getAvailability(entry.player, context.date, CONFIG_BASE, { team }).status !== 'unavailable'
  )).length;
  const effectiveMin = Medical.resolveEffectiveSquadMinimum(resolved.squadRules.min, CONFIG_BASE, callableCount);
  const validation = SquadEligibilityService.validateSquad(
    squad.map((p) => p.id), evaluationsById, resolved, { effectiveMin },
  );
  const selectedPlayers = squad.map((player) => {
    const entry = pool.find((p) => p.player.id === player.id);
    return {
      playerId: player.id,
      accessCategory: entry ? entry.accessCategory : 'senior',
      formation: entry ? entry.evaluation.classification.formation.status : 'unknown',
      nonCommunity: entry ? entry.evaluation.classification.nonCommunitySlot.status : 'unknown',
    };
  });
  const { MatchActSnapshot } = require('../src/entities/Registration.js');
  const snapshot = new MatchActSnapshot({
    id: `act:${context.matchId}:${team.id}`,
    matchId: context.matchId,
    roundId: context.roundId,
    phaseId: context.phaseId,
    competitionId: context.competitionId,
    competitionInstanceId: context.competitionInstanceId,
    registrationScopeId: resolved.registrationScopeId,
    seasonKey: context.seasonKey,
    teamId: team.id,
    matchDateTime: LocalDate.fromJsDate(context.date),
    selectedPlayers,
    squadValidation: { valid: validation.valid, counts: validation.counts },
    configuredAt: LocalDate.fromJsDate(configuredAt),
    warnings: validation.findings.map((f) => f.code),
  });
  registrationRegistry.registerMatchAct(snapshot);
  return { snapshot, validation };
}

// =====================================================================
// 1. Arranque (equivalente a startSeason() en game.js)
// =====================================================================
console.log('Construyendo 36 equipos reales (1ª+2ª), Player Registry, Contract Registry y Registration Registry...');
let seasonStartYear = 2026;
let calendar = new Calendar(seasonStartYear, CONFIG_BASE);
const calendarCtx = { seasonStartDate: calendar.seasonStartDate };
let referenceDate = calendar.seasonStartDate;
let seasonKey = PC.seasonKeyFromStartYear(seasonStartYear);

const playerRegistry = new PlayerRegistry();
let teamsByDivision = {};
['1ª', '2ª'].forEach((div) => {
  teamsByDivision[div] = REAL_DATA_INDEX.filter((e) => e.division === div)
    .map((e) => buildRealTeam(REAL_DATA_TEAMS[e.id], referenceDate, seasonKey));
});
let allTeams = teamsByDivision['1ª'].concat(teamsByDivision['2ª']);
allTeams.forEach((team) => playerRegistry.registerMany(team.roster));
let allTeamsById = new Map(allTeams.map((t) => [t.id, t]));

const catalogCheck = ClubEmploymentContextCatalog.validateCatalog(allTeams);
assert.ok(catalogCheck.valid, `contexto laboral incompleto: ${JSON.stringify(catalogCheck.errors)}`);

const contractRegistry = new ContractRegistry();
let bootstrapIsoDate = LocalDate.fromJsDate(referenceDate);
ContractSeeder.seedContractsForTeams({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
});

const registrationRegistry = new RegistrationRegistry();
const registrationBootstrap = RegistrationSeeder.seedRegistrationsForTeams({
  teams: allTeams, seasonKey, date: bootstrapIsoDate, registrationRegistry, contractRegistry, config: CONFIG_BASE,
});
console.log(`OK: ${registrationBootstrap.results.length} licencias/inscripciones simuladas creadas para ${playerRegistry.all().length} jugadores mundiales.`);

// CYCLE-1: `runAnnualCycleTransition` toca agentes/mercado/traspasos/cesiones
// (tanteo orgánico, limpieza de expedientes vivos...) aunque este smoke no
// ejerce fixtures propios de esos dominios — instancias EXPLÍCITAS vacías por
// carrera, mismo criterio que agentRegistry/marketRegistry/transferRegistry/
// loanRegistry en smoke-loan1.js (nunca singletons).
const agentRegistry = new AgentRegistry();
const marketRegistry = new MarketRegistry();
const transferRegistry = new TransferRegistry();
const loanRegistry = new LoanRegistry();

function validateAll(label, date) {
  const isoDate = LocalDate.fromJsDate(date);
  const playerCheck = playerRegistry.validateAgainstTeams(allTeams);
  assert.ok(playerCheck.valid, `[${label}] Player Registry roto: ${JSON.stringify(playerCheck.errors.slice(0, 5))}`);
  const contractCheck = contractRegistry.validateIntegrity({ playerRegistry, teams: allTeams, date: isoDate });
  assert.ok(contractCheck.valid, `[${label}] Contract Registry roto: ${JSON.stringify(contractCheck.errors.slice(0, 5))}`);
  const registrationCheck = registrationRegistry.validateIntegrity({
    playerRegistry, contractRegistry, teams: allTeams, date: isoDate,
  });
  assert.ok(registrationCheck.valid, `[${label}] Registration Registry roto: ${JSON.stringify(registrationCheck.errors.slice(0, 5))}`);
  return { playerCheck, contractCheck, registrationCheck };
}
validateAll('arranque', referenceDate);
console.log('OK: Player/Contract/Registration Registry íntegros al arranque.');

// --- Cada uno de los 36 clubes tiene una solución legal inicial --------
{
  let allFeasible = true;
  allTeams.forEach((team) => {
    const resolved = resolveRegistrationRulesForDivision(team.division, seasonKey, bootstrapIsoDate);
    const requiredMax = Math.max(...resolved.registration.quotaBands.map((b) => b.formationMinimum));
    const classification = RegistrationSeeder.classifyRosterForClub(team, resolved, seasonKey);
    if (classification.formationPlayerIds.size < requiredMax) allFeasible = false;
    if (classification.nonCommunityPlayerIds.size > resolved.registration.nonCommunityCap.max) allFeasible = false;
  });
  assert.ok(allFeasible, 'los 36 clubes deben tener una solución legal inicial (sin softlock)');
  console.log('OK: los 36 clubes tienen cupo de formación y no comunitarios reglamentariamente viables al arranque.');
}

// --- MoraBanc: contrato AD, inscripción bajo ACB ------------------------
{
  const morabanc = allTeamsById.get('team-morabanc-andorra');
  const employment = ContractService.resolveRulesForClub(morabanc, { seasonKey, date: bootstrapIsoDate });
  assert.strictEqual(employment.requestedContext.employerJurisdictionId, 'AD');
  const resolved = resolveRegistrationRulesForDivision(morabanc.division, seasonKey, bootstrapIsoDate);
  assert.strictEqual(resolved.competitionId, CompetitionRules.COMPETITION_IDS.ACB);
  morabanc.roster.forEach((player) => {
    const license = registrationRegistry.currentLicenseForPlayer(player.id, bootstrapIsoDate);
    assert.ok(license, `MoraBanc: ${player.id} sin licencia`);
  });
  console.log('OK: MoraBanc Andorra — contrato bajo jurisdicción AD, inscripción bajo ACB, sin mezclar ambos ejes.');
}

// --- Fixture dirigido: baja/reactivación por lesión ---------------------
let injuryFixtureChecked = false;
function runInjuryFixture() {
  const team = allTeams.find((t) => t.roster.length >= 9);
  const player = team.roster[0];
  const resolved = resolveRegistrationRulesForDivision(team.division, seasonKey, referenceDate);
  const registration = registrationRegistry.currentRegistration(player.id, resolved.registrationScopeId, seasonKey, LocalDate.fromJsDate(referenceDate));
  if (!registration) return;
  const suspendDate = LocalDate.fromJsDate(referenceDate);
  RegistrationService.suspendRegistrationForStatus(registration, suspendDate, 'injury-or-illness', resolved);
  assert.strictEqual(registration.statusOn(suspendDate), 'suspended');
  const reinstateDate = LocalDate.addDays(suspendDate, 20);
  RegistrationService.reinstateRegistration(registration, reinstateDate);
  assert.strictEqual(registration.statusOn(reinstateDate), 'active');
  assert.throws(
    () => RegistrationService.suspendRegistrationForStatus(registration, LocalDate.addDays(reinstateDate, 1), 'not-a-real-reason', resolved),
    'un motivo de suspensión no declarado por la regla debe rechazarse',
  );
  injuryFixtureChecked = true;
  console.log(`OK: fixture dirigido de baja/reactivación por lesión (${player.fullName}, ${team.fullName}) — evento regulatorio explícito, nunca automático desde Medical.`);
}
runInjuryFixture();

// --- Fixture dirigido: jugador propio de categoría inferior y vinculado -
let ownLowerFixtureChecked = false;
let linkedFixtureChecked = false;
function runOwnLowerAndLinkedFixture() {
  const upperClub = allTeams.find((t) => t.division === '1ª');
  const lowerClub = allTeams.find((t) => t.division === '2ª');
  const resolved = resolveRegistrationRulesForDivision(upperClub.division, seasonKey, referenceDate);

  // Sin entidad `Team` para la academia/categoría inferior en este motor
  // (DESIGN.md 9.16: "un jugador sin club puede seguir en el registro con
  // teamId === null"), un propio de categoría inferior es, para el mundo
  // de equipos senior modelados, un jugador SIN afiliación senior — nunca
  // un id de equipo inventado que rompería `validateAgainstTeams()`.
  const ownLowerPlayer = generateFictionalPlayer({ minAge: 16, maxAge: 18, referenceDate });
  ownLowerPlayer.teamId = null;
  playerRegistry.register(ownLowerPlayer);
  const ownLowerFixture = RegistrationSeeder.seedOwnLowerCategoryFixture({
    player: ownLowerPlayer, team: upperClub, seasonKey, date: bootstrapIsoDate, registrationRegistry, resolved,
  });
  assert.strictEqual(ownLowerFixture.registration.accessCategory, 'own-lower-category');
  assert.strictEqual(ownLowerFixture.registration.cumulativeCap.counted, false);
  assert.strictEqual(ownLowerPlayer.teamId, null, 'un propio no se añade a Team.roster del primer equipo');
  ownLowerFixtureChecked = true;

  // El vinculado SÍ es un afiliado senior real de su club de origen
  // (`lowerClub`) — el link agreement lo autoriza a ser convocado TAMBIÉN
  // por `upperClub` sin mover su afiliación, nunca sin afiliación alguna.
  const linkedPlayer = generateFictionalPlayer({ minAge: 19, maxAge: 21, referenceDate });
  lowerClub.addPlayer(linkedPlayer);
  playerRegistry.register(linkedPlayer);
  ContractSeeder.seedContractForNewPlayer({
    player: linkedPlayer, team: lowerClub, seasonKey, date: bootstrapIsoDate, registry: contractRegistry, playerRegistry, config: CONFIG_BASE,
  });
  const linkFixture = RegistrationSeeder.seedLinkedPlayerFixture({
    player: linkedPlayer, lowerClub, upperClub, seasonKey, date: bootstrapIsoDate, registrationRegistry, resolved, direction: 'lowerToUpper',
  });
  assert.strictEqual(linkFixture.registration.accessCategory, 'linked');
  assert.strictEqual(linkFixture.registration.teamId, upperClub.id, 'la inscripción de partido es del club BENEFICIARIO');
  assert.strictEqual(linkedPlayer.teamId, lowerClub.id, 'el vinculado nunca cambia teamId por ser convocado por el club beneficiario');
  assert.ok(!linkFixture.agreement.isEffectiveForCompetition(
    CompetitionRules.competitionIdFromLegacyDivision(upperClub.division),
    CompetitionRules.competitionIdFromLegacyDivision(upperClub.division),
  ), 'la vinculación es ineficaz si ambos clubes comparten competición');

  // Pool del club beneficiario incluye AMBOS sin tocar team.roster.
  const context = {
    competitionId: resolved.competitionId, competitionInstanceId: resolved.competitionInstanceId, seasonKey, date: referenceDate,
    phaseId: 'league', roundId: 1, matchId: `smoke-fixture:${upperClub.id}`,
  };
  const pool = buildEligiblePool(upperClub, context, {
    registrationRegistry, playerRegistry, contractRegistry, allTeamsById, classificationCache: new Map(),
  });
  assert.ok(pool.some((entry) => entry.player.id === ownLowerPlayer.id && entry.accessCategory === 'own-lower-category'));
  assert.ok(pool.some((entry) => entry.player.id === linkedPlayer.id && entry.accessCategory === 'linked'));
  linkedFixtureChecked = true;
  console.log(`OK: fixture dirigido de propio (${ownLowerPlayer.fullName}) y vinculado (${linkedPlayer.fullName}, ${lowerClub.fullName} -> ${upperClub.fullName}) `
    + 'en el pool del club beneficiario, sin mover afiliación.');
}
runOwnLowerAndLinkedFixture();

// =====================================================================
// Simulación de temporadas completas
// =====================================================================
const classificationCache = new Map();
let totalMatchActs = 0;
let totalSquadValidationFailures = 0;

function buildResolver(league) {
  return (match) => {
    Training.prepareTeamForMatch(match.homeTeam, match.date, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(match.awayTeam, match.date, CONFIG_BASE, calendarCtx);
    const standingsTable = league.getStandingsTable();
    const homeImportance = computeMatchImportance(match.homeTeam, match.awayTeam, 'league', standingsTable, CONFIG_BASE);
    const awayImportance = computeMatchImportance(match.awayTeam, match.homeTeam, 'league', standingsTable, CONFIG_BASE);
    const matchId = `league:${match.round}:${match.homeTeam.id}:${match.awayTeam.id}`;
    const sides = [
      { team: match.homeTeam, opponent: match.awayTeam, importance: homeImportance },
      { team: match.awayTeam, opponent: match.homeTeam, importance: awayImportance },
    ].map(({ team, opponent, importance }) => {
      const resolved = resolveRegistrationRulesForDivision(team.division, seasonKey, match.date);
      const context = {
        competitionId: resolved.competitionId, competitionInstanceId: resolved.competitionInstanceId, seasonKey,
        date: match.date, phaseId: 'league', roundId: match.round, matchId,
      };
      const { pool, built } = buildSquadWithSelfHeal(team, context, resolved, importance, matchId);
      const { validation } = recordMatchActSnapshot(team, built.squad, context, resolved, pool, registrationRegistry, match.date);
      totalMatchActs += 1;
      if (!validation.valid) totalSquadValidationFailures += 1;
      assertActValid(matchId, team, validation, built, pool);
      return built;
    });
    return {
      homeSquad: sides[0].squad, homeLineup: sides[0].lineup, awaySquad: sides[1].squad, awayLineup: sides[1].lineup, matchDate: match.date,
    };
  };
}

// Índice de ronda REAL de un bracket en curso — nunca `null` fijo (ver
// mismo razonamiento en game.js `currentBracketRoundKey`): con `null`
// constante, una progresión legítima de un club a través de varias rondas
// del mismo bracket se leería como "el mismo jugador en dos actas de la
// misma jornada a la vez" en `RegistrationRegistry.validateIntegrity()`.
// `PromotionPlayoff` compone dos Bracket internos (cuartos + Final Four).
// `phaseId` prefija la clave — Copa y Playoff por el título comparten
// `registrationScopeId` ACB pero son brackets independientes; sin el
// prefijo, "ronda 1" de ambos colisionaría en
// `playerAlreadyOnActThisRound()` entre jornadas reales distintas.
function currentBracketRoundKey(phaseId, bracketLike) {
  if (bracketLike.quarterFinals) {
    return bracketLike.finalFour
      ? `${phaseId}:finalfour-${bracketLike.finalFour.rounds.length}`
      : `${phaseId}:quarterfinals-${bracketLike.quarterFinals.rounds.length}`;
  }
  return `${phaseId}:round-${bracketLike.rounds.length}`;
}

function bracketResolver(bracketDate, phaseId, bracket) {
  return (homeEntry, awayEntry) => {
    Training.prepareTeamForMatch(homeEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    Training.prepareTeamForMatch(awayEntry.team, bracketDate, CONFIG_BASE, calendarCtx);
    const roundKey = currentBracketRoundKey(phaseId, bracket);
    // Ids de equipo en orden CANÓNICO (ordenados), nunca home/away — una
    // Series a mejor de N alterna el equipo local entre partidos; con el
    // orden home/away el mismo partido cambiaría de matchId de un juego al
    // siguiente, rompiendo la exclusión de "esta misma acta" en
    // `playerAlreadyOnActThisRound()`.
    const matchId = `${roundKey}:${[homeEntry.team.id, awayEntry.team.id].sort().join('-')}`;
    const sides = [homeEntry.team, awayEntry.team].map((team) => {
      const resolved = resolveRegistrationRulesForDivision(team.division, seasonKey, bracketDate, phaseId);
      const context = {
        competitionId: resolved.competitionId, competitionInstanceId: resolved.competitionInstanceId, seasonKey,
        date: bracketDate, phaseId, roundId: roundKey, matchId,
      };
      const { pool, built } = buildSquadWithSelfHeal(team, context, resolved, true, matchId);
      const { validation } = recordMatchActSnapshot(team, built.squad, context, resolved, pool, registrationRegistry, bracketDate);
      totalMatchActs += 1;
      if (!validation.valid) totalSquadValidationFailures += 1;
      assertActValid(matchId, team, validation, built, pool);
      return built;
    });
    return {
      homeSquad: sides[0].squad, homeLineup: sides[0].lineup, awaySquad: sides[1].squad, awayLineup: sides[1].lineup, matchDate: bracketDate,
    };
  };
}

function processDevelopmentToDateForTeams(teams, date) {
  teams.forEach((team) => Training.processTeamDevelopmentToDate(team, date, CONFIG_BASE, calendarCtx));
}
function reviewCpu(teams, date) {
  teams.forEach((team) => TrainingAI.reviewTeamIfDue(team, date, { matchesInNext7Days: 1 }, CONFIG_BASE, calendarCtx));
}

// CYCLE-1 (BUG-LOAN1-01, ver smoke-loan1.js): los fixtures dirigidos de
// arriba (baja/reactivación por lesión, propio/vinculado) pueden dejar a un
// club exactamente en su suelo reglamentario. Antes de CYCLE-1 el motor no
// se enteraba de una convocatoria reglamentariamente imposible: caía en
// silencio al selector NO regulado y el partido se jugaba con un acta
// ilegal. Ahora se detiene, así que la legalidad de los 36 clubes se
// GARANTIZA con la auditoría + escalera de emergencia compartidas
// (`cycle1-harness`), exactamente igual que en una carrera real — nunca
// relajando la comprobación del acta.
const { annualCycleRegistry: cycleRegistryForLegality, academyRegistry: academyRegistryForLegality } = cycle1.createCycleRegistries();
let totalStartupEmergencyActions = 0;

// Auto-corrección MID-TEMPORADA (misma escalera que usa el arranque de
// temporada): una plantilla legal en la jornada 1 puede dejar de serlo más
// tarde sin que ningún traspaso/cesión nuevo la toque (p.ej. la
// clasificación de formación es SIEMPRE contextual por fecha). El motor
// NUNCA juega un partido con una convocatoria reglamentariamente imposible
// — se detiene con diagnóstico en vez de caer al selector no regulado.
function buildSquadWithSelfHeal(team, context, resolved, importance, matchId) {
  const buildOnce = () => {
    const pool = buildEligiblePool(team, context, {
      registrationRegistry, playerRegistry, contractRegistry, allTeamsById, classificationCache,
    });
    const built = buildCpuLineup(team, importance, CONFIG_BASE, context.date, resolved.squadRules, { pool, resolved });
    return { pool, built };
  };
  let { pool, built } = buildOnce();
  if (built.outcome === 'infeasible') {
    const healed = cycle1.selfHealClubLegality({
      team,
      context,
      seasonKey,
      config: CONFIG_BASE,
      annualCycleRegistry: cycleRegistryForLegality,
      academyRegistry: academyRegistryForLegality,
      playerRegistry,
      contractRegistry,
      registrationRegistry,
      loanRegistry,
      teams: allTeams,
      classificationCache,
      careerSeed: `smoke-reg1|${seasonKey}`,
    });
    if (healed) totalStartupEmergencyActions += healed.actions.filter((a) => a.succeeded).length;
    if (healed && healed.resolved) {
      ({ pool, built } = buildOnce());
    }
    if (built.outcome === 'infeasible') {
      console.error('DEBUG-INFEASIBLE', JSON.stringify({
        matchId, teamId: team.id, healed: healed ? { resolved: healed.resolved, remaining: healed.remaining, actions: healed.actions.map((a) => ({ type: a.actionType, succeeded: a.succeeded, failureReason: a.failureReason })) } : null, diagnostic: built.diagnostic,
      }));
    }
  }
  assert.notStrictEqual(
    built.outcome, 'infeasible',
    `[${matchId}] convocatoria reglamentariamente IMPOSIBLE para ${team.fullName}: `
    + `${JSON.stringify(built.diagnostic)} — el motor no puede jugar con un acta ilegal `
    + 'ni caer al selector legacy, ni siquiera tras reintentar la escalera de emergencia mid-temporada.',
  );
  return { pool, built };
}

function ensureLegalRostersBeforeMatches(label, date) {
  const audit = cycle1.ensureAllClubsLegalBeforeFirstMatch({
    teams: allTeams,
    seasonKey,
    date,
    config: CONFIG_BASE,
    careerSeed: `smoke-reg1|${seasonKey}`,
    annualCycleRegistry: cycleRegistryForLegality,
    academyRegistry: academyRegistryForLegality,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    loanRegistry,
    classificationCache,
    userClubId: null,
  });
  totalStartupEmergencyActions += audit.emergencyActions.length;
  const stillIllegal = audit.reports.filter((report) => !report.isLegal)
    .map((report) => `${report.clubId}: ${report.gaps.filter((g) => g.severity === 'blocking').map((g) => g.code).join(',')}`);
  assert.strictEqual(
    stillIllegal.length, 0,
    `[${label}] ${stillIllegal.length} club(es) siguen sin poder construir un acta legal: ${stillIllegal.slice(0, 5).join(' | ')}`,
  );
  return audit;
}

ensureLegalRostersBeforeMatches('antes de la jornada 1', referenceDate);

for (let seasonIndex = 0; seasonIndex < SEASONS_TO_SIMULATE; seasonIndex += 1) {
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
  for (let r = 0; r < 34; r += 1) {
    ['1ª', '2ª'].forEach((div) => {
      const league = leagues[div];
      if (league.isSeasonComplete) return;
      const matches = league.simulateNextRound(undefined, buildResolver(league));
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
  console.log(`Liga regular completa (Primera FEB: 2 de formación en pista comprobado partido a partido). Copa creada: ${!!cup}.`);
  if (cup) {
    const cupDate = calendar.currentGameDateTime;
    while (!cup.isComplete) cup.playNextGame(CONFIG_BASE, bracketResolver(cupDate, 'cup', cup));
  }

  const titlePlayoff = createTitlePlayoff(leagues['1ª']);
  const promotionPlayoff = new PromotionPlayoff(leagues['2ª']);
  {
    const date = calendar.currentGameDateTime;
    while (!titlePlayoff.isComplete) titlePlayoff.playNextGame(CONFIG_BASE, bracketResolver(date, 'title-playoff', titlePlayoff));
  }
  {
    const date = calendar.currentGameDateTime;
    while (!promotionPlayoff.isComplete) promotionPlayoff.playNextGame(CONFIG_BASE, bracketResolver(date, 'promotion', promotionPlayoff));
  }
  console.log(`Playoffs completados. Campeón: ${titlePlayoff.champion ? titlePlayoff.champion.team.fullName : '(sin resolver)'}`);

  validateAll(`fin de temporada ${seasonKey}`, calendar.currentGameDateTime);

  // --- Sin doble acta indebida en ningún ámbito/jornada de ESTA temporada
  {
    const actsByScope = new Map();
    registrationRegistry.allMatchActs().forEach((act) => {
      if (act.roundId === null || act.seasonKey !== seasonKey) return;
      const key = `${act.registrationScopeId}|${act.roundId}`;
      const list = actsByScope.get(key) || [];
      list.push(act);
      actsByScope.set(key, list);
    });
    actsByScope.forEach((acts) => {
      const seenPlayers = new Map();
      acts.forEach((act) => {
        act.selectedPlayers.forEach((entry) => {
          const prior = seenPlayers.get(entry.playerId);
          assert.ok(!prior || prior === act.matchId, `doble acta indebida: ${entry.playerId} en ${prior} y ${act.matchId}`);
          seenPlayers.set(entry.playerId, act.matchId);
        });
      });
    });
  }

  const leagueA = leagues['1ª'];
  const leagueB = leagues['2ª'];
  const seasonEndDateTime = calendar.currentGameDateTime;
  const prevSeasonKey = seasonKey;
  const nextSeasonKey = PC.seasonKeyFromStartYear(seasonStartYear + 1);

  // CYCLE-1 (DESIGN.md 9.22): el cierre de temporada YA NO es el monolito
  // hand-rollado (ascender/descender -> expirar+resembrar inscripciones ->
  // `generateAcademyIntake(3)` a los 36 -> reemplazar calendario) — ese
  // comportamiento está RETIRADO. Este smoke consume el MISMO ciclo anual
  // real que una carrera de verdad, vía el harness compartido (mismo
  // patrón EXACTO que smoke-loan1.js) — nunca una copia local del motor.
  // La fase `licenses-and-registrations` del ciclo hace ahora la
  // expiración+resiembra que este script hacía a mano; construirla en
  // paralelo aquí volvería a procesar dos veces el mismo registro.
  const evidence = cycle1.collectSeasonEvidence({
    leagues: [leagueA, leagueB],
    brackets: [
      { bracket: cup, phaseId: 'cup' },
      { bracket: titlePlayoff, phaseId: 'title-playoff' },
      { bracket: promotionPlayoff, phaseId: 'promotion' },
    ],
  });
  const { cycle, summary } = cycle1.runAnnualCycleTransition({
    annualCycleRegistry: cycleRegistryForLegality,
    academyRegistry: academyRegistryForLegality,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    marketRegistry,
    agentRegistry,
    transferRegistry,
    loanRegistry,
    teams: allTeams,
    leagueA,
    leagueB,
    cup,
    titlePlayoff,
    promotionPlayoff,
    fromSeasonKey: prevSeasonKey,
    targetSeasonKey: nextSeasonKey,
    evidence,
    seasonEndDateTime,
    config: CONFIG_BASE,
    careerSeed: `smoke-reg1|${prevSeasonKey}`,
    classificationCache,
  });
  void cycle;
  const promotedTeams = (summary.promotedIds || []).map((id) => allTeamsById.get(id)).filter(Boolean);
  const relegatedTeams = (summary.relegatedIds || []).map((id) => allTeamsById.get(id)).filter(Boolean);

  allTeams = [...leagueA.teams, ...leagueB.teams];
  teamsByDivision = {
    '1ª': allTeams.filter((t) => t.division === '1ª'),
    '2ª': allTeams.filter((t) => t.division === '2ª'),
  };
  allTeamsById = new Map(allTeams.map((t) => [t.id, t]));

  seasonStartYear += 1;
  calendar = new Calendar(seasonStartYear, CONFIG_BASE);
  calendarCtx.seasonStartDate = calendar.seasonStartDate;
  referenceDate = calendar.seasonStartDate;
  seasonKey = nextSeasonKey;
  bootstrapIsoDate = LocalDate.fromJsDate(referenceDate);

  validateAll(`tras cierre + cantera (${seasonKey})`, referenceDate);
  // Misma garantía tras el cierre: ninguna plantilla arranca la temporada
  // siguiente sin poder construir un acta legal.
  ensureLegalRostersBeforeMatches(`antes de la jornada 1 de ${seasonKey}`, referenceDate);
  console.log(`Temporada cerrada. Ascendidos: ${promotedTeams.map((t) => t.fullName).join(', ')}. `
    + `Descendidos: ${relegatedTeams.map((t) => t.fullName).join(', ')}.`);
  console.log(`Player Registry: ${playerRegistry.all().length} · Contratos: ${contractRegistry.size} · `
    + `Licencias: ${registrationRegistry.allLicenses().length} · Inscripciones: ${registrationRegistry.allRegistrations().length}.`);
}

// =====================================================================
// Resumen final
// =====================================================================
const finalIso = LocalDate.fromJsDate(referenceDate);
validateAll('final', referenceDate);

const licensesByStatus = {};
registrationRegistry.allLicenses().forEach((lic) => {
  const status = lic.statusOn(finalIso);
  licensesByStatus[status] = (licensesByStatus[status] || 0) + 1;
});
const registrationsByCategory = {};
registrationRegistry.allRegistrations().forEach((reg) => {
  registrationsByCategory[reg.accessCategory] = (registrationsByCategory[reg.accessCategory] || 0) + 1;
});
const allSimulated = registrationRegistry.allLicenses().every((lic) => !lic.provenance.isReal)
  && registrationRegistry.allProfiles().every((p) => p.provenance !== 'verified' || p.dataSource);
const totalEvents = registrationRegistry.allLicenses().reduce((acc, l) => acc + l.events.length, 0)
  + registrationRegistry.allRegistrations().reduce((acc, r) => acc + r.events.length, 0);

console.log('\n=== RESUMEN REG-1 ===');
console.log(`Temporadas simuladas:          ${SEASONS_TO_SIMULATE}`);
console.log(`Jugadores mundiales:           ${playerRegistry.all().length}`);
console.log(`Contratos:                     ${contractRegistry.size}`);
console.log(`Licencias:                     ${registrationRegistry.allLicenses().length} — por estado: ${JSON.stringify(licensesByStatus)}`);
console.log(`Inscripciones:                 ${registrationRegistry.allRegistrations().length} — por categoría: ${JSON.stringify(registrationsByCategory)}`);
console.log(`Eventos regulatorios totales:  ${totalEvents}`);
console.log(`Actas de partido registradas:  ${totalMatchActs} (fallos de validación de acta: ${totalSquadValidationFailures}, de los cuales infeasibilidad médica conocida y avisada: ${totalToleratedInfeasibleActs})`);
console.log(`Acuerdos de vinculación:       ${registrationRegistry.allLinkAgreements().length}`);
// CYCLE-1: la cantera ya no entra directamente al primer equipo (retirado
// `Team.generateAcademyIntake(3)` por cierre) — un joven pasa primero por
// el pool de academia (`AcademyRegistry`) y una decisión anual real
// (`academy-decisions`, dentro del ciclo) resuelve si promociona a senior
// con contrato/licencia/inscripción reales. "Newgens contratados/inscritos"
// (contador manual de este script) ya no es una magnitud que este script
// calcule — se reporta la magnitud equivalente real del registro.
console.log(`Pertenencias de academia (histórico): ${academyRegistryForLegality.allMemberships().length} · `
  + `Decisiones anuales: ${academyRegistryForLegality.allDecisions().length}`);
console.log(`Altas de emergencia para garantizar legalidad: ${totalStartupEmergencyActions}`);
console.log(`Fixture lesión/reactivación:   ${injuryFixtureChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Fixture propio/vinculado:      ${ownLowerFixtureChecked && linkedFixtureChecked ? 'OK' : 'NO EJECUTADO'}`);
console.log(`Todos los datos regulatorios simulados etiquetados: ${allSimulated}`);
console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

// Toda acta inválida que llegó hasta aquí ya pasó por `assertActValid()` —
// solo pudo continuar si era una infeasibilidad médica conocida Y avisada
// (nunca silenciosa). Aun así, se acota su frecuencia: una crisis médica
// que deje a un club sin cupo de formación/no comunitarios debe seguir
// siendo RARA sobre una temporada completa — un salto muestra una
// regresión real en el margen de clasificación del seeder, no mala suerte.
assert.strictEqual(totalSquadValidationFailures, totalToleratedInfeasibleActs, 'toda acta inválida debe ser una infeasibilidad médica conocida y avisada');
assert.ok(
  totalMatchActs === 0 || totalToleratedInfeasibleActs / totalMatchActs < 0.01,
  `la infeasibilidad médica conocida debe seguir siendo rara (<1% de actas): ${totalToleratedInfeasibleActs}/${totalMatchActs}`,
);
assert.ok(injuryFixtureChecked && ownLowerFixtureChecked && linkedFixtureChecked, 'los fixtures dirigidos deben ejecutarse');
assert.ok(allSimulated, 'ningún dato regulatorio simulado puede presentarse como real/verificado sin dataSource');

console.log(`\nSMOKE TEST REG-1: OK (36 equipos, ${SEASONS_TO_SIMULATE} temporadas completas con Copa+Playoffs+Ascenso+cantera, `
  + 'licencias/inscripciones simuladas íntegras, actas reguladas sin softlock, fixtures de propio/vinculado/lesión verificados).');
