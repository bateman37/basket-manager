// scripts/cycle1-harness.js
// CYCLE-1 (DESIGN.md 9.22, sección 26 del prompt) — HARNESS COMPARTIDO de
// transición de temporada. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Motivo de existir: antes de CYCLE-1, CADA script de humo de la EPIC
// (`smoke-roster1`, `smoke-contract1`, `smoke-reg1`, `smoke-market1`,
// `smoke-transfer1`, `smoke-loan1`) tenía su PROPIO atajo de cierre de
// temporada, copiado del monolito `closeSeasonAndPrepareNext()`: ascensos ->
// expirar/re-sembrar inscripciones -> `generateAcademyIntake(3)` a los 36
// clubes -> contrato + inscripción a los 108 newgens. CYCLE-1 retira ese
// comportamiento, así que todos los smokes consumen AHORA este harness
// único, que ejecuta el ciclo anual REAL (`AnnualCycleService`).
//
// Este archivo NO reimplementa el ciclo: solo lo orquesta con las piezas que
// cada smoke ya tiene (equipos, registros, ligas, brackets) y ofrece
// utilidades comunes (pool regulado, convocatoria CPU con resultado tipado,
// legalidad antes del primer partido).

const assert = require('assert');

const { CONFIG_BASE } = require('../src/core/MatchConfig.js');
const { LocalDate } = require('../src/utils/LocalDate.js');
const CompetitionRules = require('../src/core/CompetitionRules.js');
const { AnnualCycleRegistry } = require('../src/core/AnnualCycleRegistry.js');
const { AcademyRegistry } = require('../src/core/AcademyRegistry.js');
const { AnnualCycleService } = require('../src/core/AnnualCycleService.js');
const { SeasonHistoryService } = require('../src/core/SeasonHistoryService.js');
const { RosterLegalityService } = require('../src/core/RosterLegalityService.js');
const { WorldLifecycleService } = require('../src/core/WorldLifecycleService.js');
const { RetirementService } = require('../src/core/RetirementService.js');
const { CycleConfig } = require('../src/core/CycleConfig.js');
const { ContractSeeder } = require('../src/core/ContractSeeder.js');
const { RegistrationService } = require('../src/core/RegistrationService.js');
const { SquadEligibilityService } = require('../src/core/SquadEligibilityService.js');
const { recalculateSportingGoalsForDivision } = require('../src/core/SeasonGoals.js');
const { buildCpuLineup } = require('../src/core/CpuLineup.js');
const Medical = require('../src/core/Medical.js');
const Training = require('../src/core/Training.js');

const OPERATIONAL_CONTEXT = Object.freeze({ pendingUserMatchBlocks: false });

// ---------------------------------------------------------------------
// 1. Registros nuevos de CYCLE-1 por carrera (nunca singletons)
// ---------------------------------------------------------------------
function createCycleRegistries() {
  return {
    annualCycleRegistry: new AnnualCycleRegistry(),
    academyRegistry: new AcademyRegistry(),
  };
}

function resolveRegistrationRulesForDivision(division, seasonKey, date, phaseId) {
  return RegistrationService.resolveRegistrationRules({
    competitionId: CompetitionRules.competitionIdFromLegacyDivision(division),
    seasonKey,
    date: typeof date === 'string' ? date : LocalDate.fromJsDate(date),
    phaseId: phaseId || 'league',
  });
}

// ---------------------------------------------------------------------
// 2. Pool regulado + convocatoria CPU con resultado TIPADO
// ---------------------------------------------------------------------
// Punto ÚNICO compartido por todos los smokes: el pool REGULADO de REG-1
// (`RosterLegalityService.buildRegulatedPool`, el mismo que consume la
// auditoría de legalidad y la interfaz) y `CpuLineup.buildCpuLineup` con el
// resultado tipado de BUG-LOAN1-01 — una imposibilidad reglamentaria NUNCA
// cae a un selector no regulado y el partido no se juega con acta ilegal.
function buildRegulatedPool(params) {
  return RosterLegalityService.buildRegulatedPool(params) || [];
}

// Auto-corrección MID-TEMPORADA (encontrada tras la entrega inicial de
// CYCLE-1): la auditoría de legalidad + escalera de emergencia solo se
// ejecutaba UNA vez, antes de la jornada 1. Una plantilla legal en ese
// instante puede dejar de serlo más tarde sin que ningún traspaso/cesión
// nuevo la toque — p.ej. un jugador de cupo de formación deja de contar
// según su edad en la fecha real de un partido posterior (la clasificación
// de formación es SIEMPRE contextual por fecha, REG-1/CYCLE-1 9.18/9.22).
// Antes de declarar una convocatoria reglamentariamente INVIABLE en un
// partido real, se reintenta la MISMA escalera de emergencia que ya usa el
// arranque de temporada — nunca una segunda vía distinta ni un selector no
// regulado — y solo si la escalera tampoco puede resolverlo se propaga como
// inviabilidad real.
function selfHealClubLegality(params) {
  const {
    team, context, seasonKey, config,
    annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry, loanRegistry,
    teams, classificationCache, careerSeed,
  } = params;
  if (!annualCycleRegistry || !academyRegistry) return null;
  const report = RosterLegalityService.buildReport({
    team,
    seasonKey,
    date: context.date,
    phaseId: context.phaseId,
    cycleId: null,
    config: config || CONFIG_BASE,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    loanRegistry,
    teams,
    classificationCache,
  });
  if (report.isLegal) return null;
  return RosterLegalityService.applyEmergencyLadder({
    report,
    team,
    deps: {
      academyRegistry, playerRegistry, contractRegistry, registrationRegistry, loanRegistry, teams,
      lineup: null,
      calibration: ContractSeeder.buildCompetitionCalibration(teams, config || CONFIG_BASE),
    },
    date: context.date,
    seasonKey,
    config: config || CONFIG_BASE,
    cycle: null,
    careerSeed,
    delegatedByUser: true,
  });
}

function buildCpuSquadForMatch(params) {
  const {
    team, context, resolved, matchImportance, pool, config,
    annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry, loanRegistry,
    teams, classificationCache, careerSeed, seasonKey,
  } = params;
  const built = buildCpuLineup(
    team, matchImportance, config || CONFIG_BASE, context.date, resolved.squadRules, { pool, resolved },
  );
  if (built.outcome !== 'infeasible') return built;

  const healed = selfHealClubLegality({
    team,
    context,
    seasonKey,
    config,
    annualCycleRegistry,
    academyRegistry,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    loanRegistry,
    teams,
    classificationCache,
    careerSeed,
  });
  if (healed && healed.resolved) {
    const healedPool = buildRegulatedPool({
      team, context, playerRegistry, contractRegistry, registrationRegistry, loanRegistry, teams, classificationCache,
    });
    const retried = buildCpuLineup(
      team, matchImportance, config || CONFIG_BASE, context.date, resolved.squadRules, { pool: healedPool, resolved },
    );
    if (retried.outcome !== 'infeasible') return retried;
  }

  throw new Error(
    `[CYCLE-1/BUG-LOAN1-01] Convocatoria reglamentariamente IMPOSIBLE para "${built.diagnostic.teamName}" `
    + `(${built.diagnostic.code}): pool ${built.diagnostic.poolSize}, elegibles y disponibles `
    + `${built.diagnostic.eligibleAndAvailable}, mínimo efectivo ${built.diagnostic.effectiveMin}. `
    + 'El motor NUNCA juega con un acta ilegal ni cae al selector legacy — la escalera de emergencia mid-temporada '
    + 'tampoco pudo resolverlo.',
  );
}

// ---------------------------------------------------------------------
// 3. Legalidad antes del PRIMER partido (invariante 26)
// ---------------------------------------------------------------------
// Se ejecuta al arrancar una carrera (y tras cualquier fixture dirigido que
// altere plantillas antes de la jornada 1): audita los 36 clubes y aplica la
// escalera de emergencia SOLO donde haga falta.
function ensureAllClubsLegalBeforeFirstMatch(params) {
  const {
    teams, seasonKey, date, config, careerSeed,
    annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry, loanRegistry,
    calibration, classificationCache, userClubId, delegateEmergencyForUserClub,
  } = params;
  const iso = typeof date === 'string' ? date : LocalDate.fromJsDate(date);
  const result = AnnualCycleService.auditAllClubs({
    annualCycleRegistry,
    academyRegistry,
    cycle: null,
    teams,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    loanRegistry,
    date: iso,
    seasonKey,
    config: config || CONFIG_BASE,
    careerSeed,
    userClubId: userClubId || null,
    delegateEmergencyForUserClub: delegateEmergencyForUserClub !== false,
    calibration: calibration || ContractSeeder.buildCompetitionCalibration(teams, config || CONFIG_BASE),
    classificationCache: classificationCache || new Map(),
    retirementService: RetirementService,
  });
  return result;
}

// ---------------------------------------------------------------------
// 3-bis. Evidencia del último partido oficial de CADA club, a partir de las
// competiciones YA jugadas
// ---------------------------------------------------------------------
// `game.js` alimenta el colector EN VIVO, en el punto único por el que pasa
// todo partido resuelto (`applyRecoveryForResolvedMatch`). Los scripts de
// humo no tienen ese punto único, así que aquí se recoge la evidencia
// LEYENDO las competiciones ya completadas: el calendario de liga (solo
// partidos con `status === 'played'`) y los `games` de cada Series de cada
// bracket. Nunca se inventa una fecha: un club sin ningún partido jugado se
// queda sin evidencia y `runAnnualCycleTransition` lo declara.
function collectSeasonEvidence(params) {
  const {
    leagues, brackets, evidence,
  } = params;
  const collector = evidence || new SeasonHistoryService.LastOfficialMatchEvidenceCollector();

  (leagues || []).forEach((league) => {
    if (!league || !league.schedule) return;
    league.schedule
      .filter((match) => match.status === 'played' && match.date)
      .forEach((match) => collector.recordMatch({
        homeClubId: match.homeTeam.id,
        awayClubId: match.awayTeam.id,
        date: match.date,
        competitionId: CompetitionRules.competitionIdFromLegacyDivision(match.homeTeam.division),
        phaseId: 'league',
        matchId: match.result && match.result.gameId ? match.result.gameId : null,
      }));
  });

  function recordBracket(bracketLike, phaseId) {
    if (!bracketLike) return;
    // `PromotionPlayoff` no es un `Bracket`: contiene cuartos + Final Four.
    if (bracketLike.quarterFinals) {
      recordBracket(bracketLike.quarterFinals, `${phaseId}:quarterfinals`);
      recordBracket(bracketLike.finalFour, `${phaseId}:finalfour`);
      return;
    }
    (bracketLike.rounds || []).forEach((round) => {
      round.forEach((series) => {
        (series.games || []).forEach((game) => {
          if (!game.date) return;
          collector.recordMatch({
            homeClubId: game.homeEntry.team.id,
            awayClubId: game.awayEntry.team.id,
            date: game.date,
            competitionId: CompetitionRules.competitionIdFromLegacyDivision(game.homeEntry.team.division),
            phaseId,
            matchId: game.result && game.result.gameId ? game.result.gameId : null,
          });
        });
      });
    });
  }
  (brackets || []).forEach(({ bracket, phaseId }) => recordBracket(bracket, phaseId));

  return collector;
}

// ---------------------------------------------------------------------
// 4. Transición de temporada COMPLETA (el ciclo anual real)
// ---------------------------------------------------------------------
// Sustituye el bloque de cierre copiado en cada smoke. Ejecuta el ciclo
// anual de punta a punta (fases 1-12) y devuelve el resumen.
//
// `evidence`: instancia de `SeasonHistoryService.LastOfficialMatchEvidenceCollector`
// alimentada durante la temporada — SIN ella el ciclo no se abre (nunca se
// inventa una fecha de cierre global).
function runAnnualCycleTransition(params) {
  const {
    annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry,
    marketRegistry, agentRegistry, transferRegistry, loanRegistry,
    teams, leagueA, leagueB, cup, titlePlayoff, promotionPlayoff,
    fromSeasonKey, targetSeasonKey, evidence, seasonEndDateTime, config, careerSeed,
    userClubId, lineup, calibration, classificationCache, delegateEmergencyForUserClub, rolesSnapshotFor,
    onPhase,
  } = params;
  const activeConfig = config || CONFIG_BASE;
  const seasonEndIso = typeof seasonEndDateTime === 'string'
    ? seasonEndDateTime : LocalDate.fromJsDate(seasonEndDateTime);
  const missing = evidence.missingClubIds(teams);
  assert.strictEqual(
    missing.length, 0,
    `[cycle1-harness] hay ${missing.length} club(es) sin evidencia de último partido oficial: ${missing.join(', ')}`,
  );

  const { cycle } = AnnualCycleService.openCycle({
    annualCycleRegistry,
    teams,
    fromSeasonKey,
    targetSeasonKey,
    evidence: evidence.toArray(),
    date: seasonEndIso,
    playerRegistry,
    contractRegistry,
  });

  const summary = { promoted: [], relegated: [] };
  const hooks = {
    closeSeasonHistory({ date }) {
      const divisionsBefore = SeasonHistoryService.captureDivisionsBefore(teams);
      const { promotedTeams, relegatedTeams } = SeasonHistoryService.applyPromotionsAndRelegations({
        leagueA, leagueB, promotionPlayoff,
      });
      const honoursByTeamId = SeasonHistoryService.buildSeasonHonoursByTeamId({
        leagueB, cup, titlePlayoff, promotedTeams,
      });
      // El desarrollo mundial se procesa hasta el instante de cierre ANTES
      // de cerrar el histórico (mismo orden que ya tenía game.js).
      WorldLifecycleService.processWorldToDate({
        playerRegistry, teams, annualCycleRegistry, academyRegistry,
      }, seasonEndDateTime, activeConfig, { seasonStartDate: null });
      SeasonHistoryService.closeCareerHistories({
        teams,
        honoursByTeamId,
        divisionsBefore,
        seasonEndDateTime,
        nextSeasonKey: targetSeasonKey,
        config: activeConfig,
        rolesSnapshotFor,
      });
      ['1ª', '2ª'].forEach((division) => {
        recalculateSportingGoalsForDivision(teams.filter((team) => team.division === division), activeConfig);
      });
      summary.promoted = promotedTeams.map((team) => team.fullName);
      summary.relegated = relegatedTeams.map((team) => team.fullName);
      summary.promotedIds = promotedTeams.map((team) => team.id);
      summary.relegatedIds = relegatedTeams.map((team) => team.id);
      void date;
      return summary;
    },
  };

  const cycleParams = {
    annualCycleRegistry,
    academyRegistry,
    cycle,
    teams,
    playerRegistry,
    contractRegistry,
    registrationRegistry,
    marketRegistry,
    agentRegistry,
    transferRegistry,
    loanRegistry,
    targetSeasonKey,
    config: activeConfig,
    careerSeed,
    userClubId: userClubId || null,
    lineup: lineup || null,
    operationalContext: OPERATIONAL_CONTEXT,
    calibration: calibration || ContractSeeder.buildCompetitionCalibration(teams, activeConfig),
    classificationCache: classificationCache || new Map(),
    delegateEmergencyForUserClub: delegateEmergencyForUserClub !== false,
    hooks,
    retirementService: RetirementService,
  };

  const phaseResults = [];
  CycleConfig.CYCLE_PHASES.slice(1).forEach((phaseId) => {
    const phaseDate = phaseId === 'new-season-started'
      ? cycle.scheduledDateForPhase('preseason-ready')
      : cycle.scheduledDateForPhase(phaseId);
    const result = AnnualCycleService.runPhase({ ...cycleParams, phaseId, date: phaseDate });
    phaseResults.push({ phaseId, date: phaseDate, result });
    if (onPhase) onPhase({ phaseId, date: phaseDate, result });
    if (result && result.ready === false) {
      const detail = (result.audit && result.audit.notReady ? result.audit.notReady : [])
        .map((entry) => `${entry.clubId}: ${entry.gaps.filter((g) => g.severity === 'blocking').map((g) => `${g.code}${g.detail ? ` ${JSON.stringify(g.detail)}` : ''}`).join('; ')} counts=${JSON.stringify(entry.counts)}`);
      throw new Error(
        `[cycle1-harness] la fase "${phaseId}" dejó ${detail.length} club(es) NOT READY — el ciclo nunca empieza `
        + `temporada con un club ilegal:\n  ${detail.slice(0, 10).join('\n  ')}`,
      );
    }
  });

  return {
    cycle, summary, phaseResults, finalPhase: cycle.currentPhase(),
  };
}

// ---------------------------------------------------------------------
// 5. Utilidades de validación compartidas
// ---------------------------------------------------------------------
function validateCycleRegistries(params) {
  const {
    annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, teams, date, label,
  } = params;
  const iso = typeof date === 'string' ? date : LocalDate.fromJsDate(date);
  const cycleCheck = annualCycleRegistry.validateIntegrity({
    playerRegistry, contractRegistry, teams, date: iso,
  });
  assert.ok(cycleCheck.valid, `[${label}] Annual Cycle Registry roto: ${JSON.stringify(cycleCheck.errors.slice(0, 5))}`);
  const academyCheck = academyRegistry.validateIntegrity({ playerRegistry, teams, date: iso });
  assert.ok(academyCheck.valid, `[${label}] Academy Registry roto: ${JSON.stringify(academyCheck.errors.slice(0, 5))}`);
  return { cycleCheck, academyCheck };
}

// Comprueba que cada club puede construir un acta LEGAL en la fecha dada.
function assertAllClubsCanBuildLegalSquad(params) {
  const {
    teams, seasonKey, date, config, label,
    playerRegistry, contractRegistry, registrationRegistry, loanRegistry, classificationCache,
  } = params;
  const iso = typeof date === 'string' ? date : LocalDate.fromJsDate(date);
  const illegal = [];
  teams.forEach((team) => {
    const report = RosterLegalityService.buildReport({
      team,
      seasonKey,
      date: iso,
      phaseId: 'league',
      cycleId: null,
      config: config || CONFIG_BASE,
      playerRegistry,
      contractRegistry,
      registrationRegistry,
      loanRegistry,
      teams,
      classificationCache: classificationCache || new Map(),
    });
    if (!report.isLegal) {
      illegal.push({ clubId: team.id, gaps: report.gaps.filter((gap) => gap.severity === 'blocking').map((gap) => gap.code) });
    }
  });
  assert.strictEqual(
    illegal.length, 0,
    `[${label}] ${illegal.length} club(es) NO pueden construir un acta legal: ${JSON.stringify(illegal.slice(0, 5))}`,
  );
  return { illegal };
}

module.exports = {
  OPERATIONAL_CONTEXT,
  createCycleRegistries,
  resolveRegistrationRulesForDivision,
  buildRegulatedPool,
  buildCpuSquadForMatch,
  selfHealClubLegality,
  ensureAllClubsLegalBeforeFirstMatch,
  collectSeasonEvidence,
  runAnnualCycleTransition,
  validateCycleRegistries,
  assertAllClubsCanBuildLegalSquad,
  // Reexportadas para que los smokes no tengan que requerir cada módulo.
  SeasonHistoryService,
  AnnualCycleService,
  WorldLifecycleService,
  RosterLegalityService,
  RetirementService,
  CycleConfig,
  SquadEligibilityService,
  Medical,
  Training,
};
