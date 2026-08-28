// src/core/RosterLegalityService.js
// CYCLE-1 (DESIGN.md 9.22, sección 17 del prompt) — garantía de que las 36
// plantillas pueden CUMPLIR las reglas de su competición antes del primer
// partido, y escalera de emergencia como ÚLTIMO recurso. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Reglas permanentes:
//  - las reglas se resuelven SIEMPRE con `competitionId`+`seasonKey`+fecha+
//    fase+operación explícitos vía `CompetitionRules`/`SquadEligibilityService`
//    — nunca un 8-12 global, nunca ACB por defecto: un ruleset ausente
//    BLOQUEA con diagnóstico;
//  - el pool evaluado es el REGULADO de REG-1 (senior + propios de
//    categoría inferior + vinculados), el MISMO que consume un partido
//    real, nunca solo `team.roster`;
//  - una lesión TEMPORAL no convierte toda la plantilla contractual en
//    ilegal: la legalidad se evalúa sobre elegibilidad reglamentaria y la
//    disponibilidad médica se reporta como RIESGO OPERATIVO aparte;
//  - la escalera de emergencia va SIEMPRE en orden (promocionar cantera >
//    fichar un libre mundial existente > generar un jugador ficticio de
//    emergencia) y cada paso pasa por contrato, roster, licencia e
//    inscripción NORMALES — nunca una inserción directa en arrays;
//  - el jugador de emergencia es `isReal: false` con `dataSource`
//    `simulated-emergency-roster-v1`, no se marca formado sin evidencia y
//    queda auditado en `EmergencyRosterAction`.
//
// Módulo puro: no lee DOM ni `state`; no construye noticias.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;
  const CycleEntities = isNode ? require('../entities/Cycle.js') : global.BasketManager;
  const CycleTransactionModule = isNode ? require('./CycleTransaction.js') : global.BasketManager;
  const EligibilityServiceModule = isNode ? require('./EligibilityService.js') : global.BasketManager;
  const SquadEligibilityModule = isNode ? require('./SquadEligibilityService.js') : global.BasketManager;
  const MedicalModule = isNode ? require('./Medical.js') : global.BasketManager;
  const CpuLineupModule = isNode ? require('./CpuLineup.js') : global.BasketManager;
  const PlayerGeneratorModule = isNode ? require('../utils/playerGenerator.js') : global.BasketManager;
  const RosterMutationModule = isNode ? require('./RosterMutationService.js') : global.BasketManager;
  const ContractSeederModule = isNode ? require('./ContractSeeder.js') : global.BasketManager;
  const RegistrationSeederModule = isNode ? require('./RegistrationSeeder.js') : global.BasketManager;
  const WorldLifecycleModule = isNode ? require('./WorldLifecycleService.js') : global.BasketManager;
  const AcademyServiceModule = isNode ? require('./AcademyService.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function CC() { return CycleConfigModule.CycleConfig; }
  function Tx() { return CycleTransactionModule.CycleTransaction; }
  function Elig() { return EligibilityServiceModule.EligibilityService; }
  function SquadElig() { return SquadEligibilityModule.SquadEligibilityService; }
  function Med() { return MedicalModule; }
  function CpuLineup() { return CpuLineupModule; }
  function PG() { return PlayerGeneratorModule; }
  function RosterSvc() { return RosterMutationModule.RosterMutationService; }
  function ContractSeeder() { return ContractSeederModule.ContractSeeder; }
  function RegistrationSeeder() { return RegistrationSeederModule.RegistrationSeeder; }
  function WorldLifecycle() { return WorldLifecycleModule.WorldLifecycleService; }
  function AcademySvc() { return AcademyServiceModule.AcademyService; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // =====================================================================
  // 1. Pool REGULADO compartido (REG-1, sección 11.1 de su prompt)
  // =====================================================================
  // Punto ÚNICO: senior afiliados + propios de categoría inferior +
  // vinculados autorizados, todos YA evaluados por `EligibilityService`.
  // La interfaz (`game.js`), la CPU (`CpuLineup`) y esta auditoría consumen
  // EXACTAMENTE esta función — nunca tres recorridos paralelos.
  function buildRegulatedPool(params) {
    const {
      team, context, playerRegistry, contractRegistry, registrationRegistry, loanRegistry,
      teams, classificationCache, medicalAvailability,
    } = params;
    if (!registrationRegistry) return null;

    function evaluateFor(player, accessCategory, extraDeps) {
      const evaluation = Elig().evaluateEligibility(player.id, team.id, context, {
        playerRegistry,
        contractRegistry,
        registrationRegistry,
        loanRegistry,
        medicalAvailability: medicalAvailability || null,
        classificationCache: classificationCache || null,
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
      const originTeam = (teams || []).find((t) => t.id === originClubId);
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

  // =====================================================================
  // 2. Informe de legalidad
  // =====================================================================
  // Motivos de NO elegibilidad que la fase de licencias/inscripciones del
  // propio verano va a resolver por sí sola (el alta administrativa del
  // curso nuevo todavía no se ha ejecutado cuando se audita la plantilla).
  // SOLO se proyectan estos tres: son exactamente los que
  // `RegistrationSeeder.seedRegistrationsForTeams()` cubre en la fase
  // `licenses-and-registrations`. Cualquier otro motivo (contrato, médico,
  // disciplinario, vinculación, cupo acumulado agotado) sigue siendo una
  // carencia REAL y nunca se proyecta.
  const PROJECTABLE_REGISTRATION_REASONS = new Set([
    'NOT_REGISTERED_IN_SCOPE',
    'NO_VALID_FEDERATION_LICENSE',
    'REGISTRATION_NOT_EFFECTIVE',
  ]);

  // ¿Se puede dar por hecho que este jugador del roster TENDRÁ inscripción
  // válida cuando corra la fase de licencias? Solo si lo único que le falta
  // es esa alta administrativa Y ya acredita relación laboral (contrato
  // propio vigente o cesión entrante activa) — el seeder no inscribe a
  // nadie sin base laboral.
  function isProjectableForRegistration(entry, deps) {
    const { contractRegistry, loanRegistry, iso } = deps;
    if (entry.accessCategory !== 'senior') return false;
    const blocking = (entry.evaluation.reasons || []).filter((r) => r.severity === 'blocking');
    if (!blocking.length) return false;
    if (!blocking.every((r) => PROJECTABLE_REGISTRATION_REASONS.has(r.code))) return false;
    const contract = contractRegistry ? contractRegistry.currentForPlayer(entry.player.id, iso) : null;
    if (contract) return true;
    const loanIn = loanRegistry ? loanRegistry.activeAgreementForPlayer(entry.player.id, iso) : null;
    return Boolean(loanIn);
  }

  // Evaluación PROYECTADA: misma forma que la real, pero con la
  // clasificación que la fase de licencias va a asignar de verdad
  // (`RegistrationSeeder.classifyRosterForClub`, mismo cálculo determinista
  // que se ejecutará después) — nunca una clasificación favorable inventada
  // ni un `unknown` tratado como bueno.
  function projectEvaluation(entry, projectedClassification) {
    const playerId = entry.player.id;
    const basis = 'projected-registration';
    return {
      ...entry.evaluation,
      eligible: true,
      projected: true,
      classification: {
        ...(entry.evaluation.classification || {}),
        playerId,
        formation: {
          status: projectedClassification.formationPlayerIds.has(playerId) ? 'qualifies' : 'does-not-qualify',
          basis,
          evidenceIds: [],
        },
        nonCommunitySlot: {
          status: projectedClassification.nonCommunityPlayerIds.has(playerId) ? 'counts' : 'does-not-count',
          basis,
          evidenceIds: [],
        },
      },
    };
  }

  function buildReport(params) {
    const {
      team, seasonKey, date, phaseId, cycleId, config,
      playerRegistry, contractRegistry, registrationRegistry, loanRegistry, teams, classificationCache,
      projectRegistrations,
    } = params;
    const iso = toIso(date);
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
    const context = {
      competitionId,
      competitionInstanceId: competitionId,
      seasonKey,
      date: iso,
      phaseId: phaseId || 'league',
      roundId: null,
      matchId: null,
      operation: 'rosterLegalityAudit',
    };

    let resolved = null;
    const warnings = [];
    const gaps = [];
    try {
      resolved = CompetitionRules.resolveRules({ ...context, domain: 'registration' });
      warnings.push(...(resolved.warnings || []));
    } catch (err) {
      // Un ruleset ausente BLOQUEA con diagnóstico — nunca aplica ACB.
      gaps.push({
        code: 'RULESET_UNRESOLVED', severity: 'blocking', message: err.message, competitionId,
      });
      return new CycleEntities.RosterLegalityReport({
        id: `legality:${cycleId || 'no-cycle'}:${team.id}:${seasonKey}`,
        cycleId: cycleId || null,
        clubId: team.id,
        competitionId,
        seasonKey,
        date: iso,
        phaseId: context.phaseId,
        gaps,
        warnings,
        canBuildLegalSquad: false,
      });
    }

    const pool = buildRegulatedPool({
      team, context, playerRegistry, contractRegistry, registrationRegistry, loanRegistry, teams, classificationCache,
    }) || [];

    // --- Contratos/afiliación/licencia/inscripción por jugador ----------
    const withoutContract = [];
    const withoutRegistration = [];
    const withoutLicense = [];
    team.roster.forEach((player) => {
      const contract = contractRegistry ? contractRegistry.currentForPlayer(player.id, iso) : null;
      // Un cedido ENTRANTE tiene su contrato con el propietario: la base
      // laboral válida es la `temporary-assignment` de LOAN-1, no una
      // ausencia de contrato.
      const onLoanHere = loanRegistry ? loanRegistry.activeAgreementForPlayer(player.id, iso) : null;
      if (!contract && !onLoanHere) withoutContract.push(player.id);
      if (registrationRegistry) {
        const registration = registrationRegistry.currentRegistration(player.id, resolved.registrationScopeId, seasonKey, iso);
        if (!registration) withoutRegistration.push(player.id);
        const license = registrationRegistry.currentLicenseForPlayer(player.id, iso);
        if (!license) withoutLicense.push(player.id);
      }
    });
    if (withoutContract.length) {
      gaps.push({
        code: 'PLAYER_WITHOUT_CONTRACT', severity: 'blocking', playerIds: withoutContract,
        message: `${withoutContract.length} jugador(es) afiliado(s) sin contrato laboral ni excepción válida.`,
      });
    }
    if (withoutRegistration.length) {
      gaps.push({
        code: 'PLAYER_WITHOUT_REGISTRATION', severity: 'warning', playerIds: withoutRegistration,
        message: `${withoutRegistration.length} jugador(es) sin inscripción activa en "${resolved.registrationScopeId}"/${seasonKey}.`,
      });
    }
    if (withoutLicense.length) {
      gaps.push({
        code: 'PLAYER_WITHOUT_LICENSE', severity: 'warning', playerIds: withoutLicense,
        message: `${withoutLicense.length} jugador(es) sin licencia federativa activa.`,
      });
    }

    // --- Acta CONSTRUIBLE (legalidad reglamentaria, sin filtro médico) ---
    const squadRules = resolved.squadRules;

    // Modo PROYECTADO (solo la auditoría de verano previa a la fase de
    // licencias, `projectRegistrations: true`): la plantilla se juzga por si
    // PODRÁ construir un acta legal una vez emitidas las licencias e
    // inscripciones del curso nuevo, no por si puede HOY — a esa altura del
    // verano nadie tiene todavía inscripción de la temporada de destino, así
    // que sin proyección los 36 clubes parecerían ilegales y la escalera de
    // emergencia se dispararía sobre una carencia inexistente, inflando las
    // plantillas y diluyendo el cupo de formación. La auditoría estricta
    // (`preseason-ready`, sin proyección) sigue siendo la barrera real: nunca
    // se empieza temporada con un club ilegal de verdad.
    let projectedClassification = null;
    let projectedPlayerIds = [];
    if (projectRegistrations) {
      const preAssigned = RegistrationSeeder().collectPreAssignedClassification(
        team, registrationRegistry, resolved, seasonKey, iso,
      );
      projectedClassification = RegistrationSeeder().classifyRosterForClub(team, resolved, seasonKey, { preAssigned });
    }

    const eligibleEntries = [];
    pool.forEach((entry) => {
      if (entry.evaluation.eligible) {
        eligibleEntries.push(entry);
        return;
      }
      if (!projectedClassification) return;
      if (!isProjectableForRegistration(entry, { contractRegistry, loanRegistry, iso })) return;
      projectedPlayerIds.push(entry.player.id);
      eligibleEntries.push({
        ...entry,
        evaluation: projectEvaluation(entry, projectedClassification),
      });
    });
    projectedPlayerIds = projectedPlayerIds.sort();

    const candidates = eligibleEntries.map((entry) => ({
      playerId: entry.player.id,
      qualityScore: CpuLineup().playerQualityScore(entry.player),
      evaluation: entry.evaluation,
    }));
    const desiredSize = Math.max(squadRules.min, Math.min(squadRules.max, candidates.length));
    // CYCLE-1: el cupo de formación depende de la BANDA de tamaño de acta
    // (ACB: 3 con acta de 8-9, 4 con acta de 10-12), así que la legalidad se
    // juzga buscando un tamaño LEGAL en todo el rango con la MISMA función
    // compartida que usa la CPU (`selectLegalSquadWithinRange`) — un club con
    // 3 jugadores de formación puede presentar un acta legal de 9 y no es
    // ilegal por no poder presentar una de 11.
    const selection = candidates.length >= squadRules.min
      ? SquadElig().selectLegalSquadWithinRange(candidates, {
        minSize: squadRules.min, maxSize: squadRules.max, preferredSize: desiredSize, resolved,
      })
      : {
        ok: false,
        diagnostic: { code: 'NOT_ENOUGH_ELIGIBLE_CANDIDATES', available: candidates.length, required: squadRules.min },
      };

    const formationCount = candidates.filter((c) => SquadElig().isFormationQualifying(c.evaluation)).length;
    const nonCommunityCount = candidates.filter((c) => SquadElig().isNonCommunityCounting(c.evaluation)).length;
    // La banda reportada es la del acta REALMENTE alcanzable (el tamaño que
    // resolvió la búsqueda) — nunca la del tamaño deseado si ese no era legal.
    const reportedSize = selection.ok && selection.size ? selection.size : desiredSize;
    const band = SquadElig().findQuotaBand(resolved, reportedSize);
    const formationRequired = band ? band.formationMinimum : 0;
    const nonCommunityCap = (resolved.registration && resolved.registration.nonCommunityCap)
      ? resolved.registration.nonCommunityCap.max : null;

    const recommendedActions = [];
    if (!selection.ok) {
      const code = selection.diagnostic.code;
      gaps.push({
        code, severity: 'blocking', detail: selection.diagnostic,
        message: `No se puede construir un acta legal (${code}).`,
      });
      if (code === 'NOT_ENOUGH_ELIGIBLE_CANDIDATES') {
        recommendedActions.push({
          type: 'add-eligible-players',
          count: squadRules.min - candidates.length,
          requiredClassification: { formation: 'does-not-qualify', nonCommunity: 'does-not-count' },
          reason: `Faltan ${squadRules.min - candidates.length} jugador(es) elegible(s) para alcanzar el mínimo de acta (${squadRules.min}).`,
        });
      } else if (code === 'FORMATION_QUOTA_INFEASIBLE') {
        recommendedActions.push({
          type: 'add-eligible-players',
          count: Math.max(1, formationRequired - formationCount),
          requiredClassification: { formation: 'qualifies', nonCommunity: 'does-not-count' },
          reason: `Faltan jugadores de formación para cumplir el cupo (${formationCount}/${formationRequired}).`,
        });
      } else if (code === 'NON_COMMUNITY_CAP_INFEASIBLE') {
        recommendedActions.push({
          type: 'add-eligible-players',
          count: 1,
          requiredClassification: { formation: 'qualifies', nonCommunity: 'does-not-count' },
          reason: `Sobran no comunitarios respecto al cupo (${nonCommunityCount}/${nonCommunityCap}); hace falta alternativa comunitaria.`,
        });
      }
    }

    // --- Riesgo OPERATIVO (médico) — advertencia, nunca ilegalidad -------
    const medicallyCallable = eligibleEntries.filter((entry) => (
      Med().peekAvailability(entry.player, LD().toJsDate(iso), config, { team }).status !== 'unavailable'
    )).length;
    if (medicallyCallable < squadRules.min) {
      warnings.push(
        `Riesgo operativo: solo ${medicallyCallable} jugador(es) elegible(s) están médicamente disponibles frente al `
        + `mínimo de acta ${squadRules.min}. La plantilla contractual es legal; la excepción médica de convocatoria `
        + 'cubriría el partido si la escasez persiste.',
      );
    }

    if (projectedPlayerIds.length) {
      warnings.push(
        `Auditoría PROYECTADA: ${projectedPlayerIds.length} jugador(es) con contrato válido cuentan como elegibles a la `
        + 'espera del alta administrativa de la fase de licencias e inscripciones. La auditoría estricta de '
        + '"preseason-ready" volverá a comprobarlo sin proyección.',
      );
    }

    // --- Cupo acumulado de inscripciones consumido ----------------------
    const cumulativeConsumed = registrationRegistry
      ? registrationRegistry.cumulativeCountForClub(team.id, resolved.registrationScopeId, seasonKey) : 0;
    const cumulativeCap = (resolved.registration && resolved.registration.cumulativeRegistrationCap)
      ? resolved.registration.cumulativeRegistrationCap.max : null;
    if (cumulativeCap !== null && cumulativeConsumed >= cumulativeCap) {
      warnings.push(
        `El club ha agotado su cupo acumulado de inscripciones de la temporada (${cumulativeConsumed}/${cumulativeCap}) `
        + 'en este ámbito: cualquier alta nueva quedaría con inscripción diferida.',
      );
    }

    return new CycleEntities.RosterLegalityReport({
      id: `legality:${cycleId || 'no-cycle'}:${team.id}:${seasonKey}`,
      cycleId: cycleId || null,
      clubId: team.id,
      competitionId,
      seasonKey,
      date: iso,
      phaseId: context.phaseId,
      rulesTrace: resolved.trace || null,
      squadRules,
      counts: {
        rosterSize: team.roster.length,
        poolSize: pool.length,
        eligible: candidates.length,
        formationCount,
        formationRequired,
        nonCommunityCount,
        nonCommunityCap,
        medicallyCallable,
        cumulativeConsumed,
        cumulativeCap,
        withoutContract: withoutContract.length,
        withoutRegistration: withoutRegistration.length,
        projectedRegistrations: projectedPlayerIds.length,
      },
      gaps,
      recommendedActions,
      canBuildLegalSquad: Boolean(selection.ok),
      legalSquadSample: selection.ok ? [...selection.playerIds].sort() : [],
      warnings,
    });
  }

  // =====================================================================
  // 3. Escalera de emergencia (SOLO si la planificación ordinaria falla)
  // =====================================================================
  // Devuelve las `EmergencyRosterAction` aplicadas, en el ORDEN de la
  // escalera. Cada paso usa los servicios NORMALES de contrato/roster/
  // licencia/inscripción.
  function applyEmergencyLadder(params) {
    const {
      report, team, deps, date, seasonKey, config, cycle, careerSeed, delegatedByUser,
    } = params;
    const iso = toIso(date);
    const actions = [];
    if (report.isLegal) return { actions, resolved: true };

    const needs = report.recommendedActions.filter((action) => action.type === 'add-eligible-players');
    let remaining = needs.reduce((sum, need) => sum + Math.max(0, need.count), 0);
    const requiredClassification = needs.length
      ? needs[0].requiredClassification
      : { formation: 'qualifies', nonCommunity: 'does-not-count' };

    let step = 0;
    while (remaining > 0 && step < CC().EMERGENCY.ladder.length) {
      const actionType = CC().EMERGENCY.ladder[step];
      let applied = null;
      if (actionType === 'promote-academy') {
        applied = tryPromoteFromAcademy({
          report, team, deps, iso, seasonKey, config, cycle, requiredClassification, delegatedByUser,
        });
      } else if (actionType === 'sign-existing-free-agent') {
        applied = trySignExistingFreeAgent({
          report, team, deps, iso, seasonKey, config, cycle, requiredClassification, delegatedByUser, careerSeed,
        });
      } else {
        applied = tryGenerateEmergencyPlayer({
          report, team, deps, iso, seasonKey, config, cycle, requiredClassification, delegatedByUser, careerSeed,
          sequence: actions.length,
        });
      }
      if (applied && applied.succeeded) {
        actions.push(applied.action);
        remaining -= 1;
        // Tras cada alta se vuelve a intentar el paso MÁS BARATO de la
        // escalera (nunca se salta directamente al generador si la cantera
        // aún puede resolverlo).
        step = 0;
      } else {
        if (applied && applied.action) actions.push(applied.action);
        step += 1;
      }
    }
    return { actions, resolved: remaining <= 0, remaining };
  }

  // --- Paso 1: promocionar un joven de academia ELEGIBLE que acepte -----
  function tryPromoteFromAcademy(params) {
    const {
      report, team, deps, iso, seasonKey, config, cycle, requiredClassification, delegatedByUser,
    } = params;
    const {
      academyRegistry, playerRegistry, contractRegistry, registrationRegistry, teams, lineup, calibration,
    } = deps;
    if (!academyRegistry) return { succeeded: false };
    const pool = academyRegistry.activePoolForClub(team.id, iso);
    if (!pool.length) return { succeeded: false };
    const qualityIndex = AcademySvc().buildPoolQualityIndex(pool, playerRegistry, config);
    // El mejor disponible por calidad VISIBLE, desempate por id.
    const best = [...pool].sort((a, b) => (
      (qualityIndex[b.id] || 0) - (qualityIndex[a.id] || 0)) || (a.id < b.id ? -1 : 1))[0];
    const actionId = `emergency:${report.id}:promote:${best.playerId}`;
    try {
      const promoted = AcademySvc().promoteToFirstTeam({
        academyRegistry,
        playerRegistry,
        contractRegistry,
        registrationRegistry,
        teams,
        membership: best,
        team,
        date: iso,
        seasonKey,
        config,
        calibration,
        lineup,
        existingClassification: buildForcedClassification(team, best.playerId, requiredClassification),
      });
      const action = new CycleEntities.EmergencyRosterAction({
        id: actionId,
        cycleId: cycle ? cycle.id : null,
        reportId: report.id,
        clubId: team.id,
        actionType: 'promote-academy',
        playerId: best.playerId,
        appliedAt: iso,
        gapAddressed: report.gaps.find((g) => g.severity === 'blocking') || null,
        contractId: promoted.contract ? promoted.contract.id : null,
        registrationId: promoted.registrationId || null,
        licenseId: promoted.licenseId || null,
        delegatedByUser: Boolean(delegatedByUser),
        succeeded: true,
        provenance: { dataSource: 'simulated-academy-intake-v1', isReal: false },
      });
      return { succeeded: true, action };
    } catch (err) {
      const action = new CycleEntities.EmergencyRosterAction({
        id: actionId,
        cycleId: cycle ? cycle.id : null,
        reportId: report.id,
        clubId: team.id,
        actionType: 'promote-academy',
        playerId: best.playerId,
        appliedAt: iso,
        delegatedByUser: Boolean(delegatedByUser),
        succeeded: false,
        failureReason: err.message,
      });
      return { succeeded: false, action };
    }
  }

  // --- Paso 2: fichar un agente libre MUNDIAL ya existente y válido -----
  function trySignExistingFreeAgent(params) {
    const {
      report, team, deps, iso, seasonKey, config, cycle, requiredClassification, delegatedByUser, careerSeed,
    } = params;
    const {
      playerRegistry, contractRegistry, registrationRegistry, annualCycleRegistry, academyRegistry, teams, lineup, calibration,
    } = deps;
    // Libres REALES del mundo: sin club, no retirados, no en academia, no
    // fuera de la vía profesional. Orden canónico por id (determinista).
    const freeAgents = playerRegistry.all()
      .filter((player) => player.teamId === null)
      .filter((player) => !(annualCycleRegistry && annualCycleRegistry.isRetiredOn(player.id, iso)))
      .filter((player) => !(annualCycleRegistry && annualCycleRegistry.hasLeftProfessionalPathwayOn(player.id, iso)))
      .filter((player) => !(academyRegistry && academyRegistry.isInAcademyOn(player.id, iso)))
      .filter((player) => !contractRegistry.currentForPlayer(player.id, iso))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!freeAgents.length) return { succeeded: false };
    const CpuQuality = CpuLineup().playerQualityScore;
    const best = [...freeAgents].sort((a, b) => (CpuQuality(b) - CpuQuality(a)) || (a.id < b.id ? -1 : 1))[0];
    const actionId = `emergency:${report.id}:free-agent:${best.id}`;
    try {
      const result = signPlayerForEmergency({
        player: best,
        team,
        deps: {
          playerRegistry, contractRegistry, registrationRegistry, teams, lineup, calibration,
        },
        iso,
        seasonKey,
        config,
        requiredClassification,
      });
      const action = new CycleEntities.EmergencyRosterAction({
        id: actionId,
        cycleId: cycle ? cycle.id : null,
        reportId: report.id,
        clubId: team.id,
        actionType: 'sign-existing-free-agent',
        playerId: best.id,
        appliedAt: iso,
        gapAddressed: report.gaps.find((g) => g.severity === 'blocking') || null,
        contractId: result.contract.id,
        registrationId: result.registrationId,
        licenseId: result.licenseId,
        delegatedByUser: Boolean(delegatedByUser),
        succeeded: true,
        provenance: { dataSource: best.dataSource || null, isReal: false },
      });
      void careerSeed;
      return { succeeded: true, action };
    } catch (err) {
      const action = new CycleEntities.EmergencyRosterAction({
        id: actionId,
        cycleId: cycle ? cycle.id : null,
        reportId: report.id,
        clubId: team.id,
        actionType: 'sign-existing-free-agent',
        playerId: best.id,
        appliedAt: iso,
        delegatedByUser: Boolean(delegatedByUser),
        succeeded: false,
        failureReason: err.message,
      });
      return { succeeded: false, action };
    }
  }

  // --- Paso 3: generar un jugador ficticio de EMERGENCIA ----------------
  function tryGenerateEmergencyPlayer(params) {
    const {
      report, team, deps, iso, seasonKey, config, cycle, requiredClassification, delegatedByUser, careerSeed, sequence,
    } = params;
    const {
      playerRegistry, contractRegistry, registrationRegistry, annualCycleRegistry, teams, lineup, calibration, retirementService,
    } = deps;
    const cfg = CC().EMERGENCY;
    const seed = `${careerSeed || 'no-career-seed'}|emergency|${team.id}|${seasonKey}|${sequence}`;
    const playerId = `emergency:${team.id}:${seasonKey}:${sequence}`;
    const actionId = `emergency:${report.id}:generated:${playerId}`;
    try {
      let player = playerRegistry.get(playerId);
      if (!player) {
        player = PG().generateFictionalPlayer({
          minAge: cfg.ageMin,
          maxAge: cfg.ageMax,
          referenceDate: iso,
          seed,
          id: playerId,
          attributeRange: cfg.attributeRange,
        });
        player.teamId = null;
        // Procedencia SIEMPRE visible: nunca se presenta como real.
        player.dataSource = cfg.dataSource;
        playerRegistry.register(player);
        WorldLifecycle().initializePlayerLifecycle(player, config, iso, {
          seasonKey,
          historyCompleteness: 'complete',
          annualCycleRegistry,
          retirementService,
          careerSeed,
        });
      }
      const result = signPlayerForEmergency({
        player,
        team,
        deps: {
          playerRegistry, contractRegistry, registrationRegistry, teams, lineup, calibration,
        },
        iso,
        seasonKey,
        config,
        requiredClassification,
      });
      const action = new CycleEntities.EmergencyRosterAction({
        id: actionId,
        cycleId: cycle ? cycle.id : null,
        reportId: report.id,
        clubId: team.id,
        actionType: 'generate-emergency-player',
        playerId: player.id,
        appliedAt: iso,
        gapAddressed: report.gaps.find((g) => g.severity === 'blocking') || null,
        contractId: result.contract.id,
        registrationId: result.registrationId,
        licenseId: result.licenseId,
        delegatedByUser: Boolean(delegatedByUser),
        succeeded: true,
        provenance: {
          dataSource: cfg.dataSource, isReal: false, generatorVersion: 'roster-legality-emergency-v1', seedFingerprint: seed,
        },
      });
      return { succeeded: true, action };
    } catch (err) {
      const action = new CycleEntities.EmergencyRosterAction({
        id: actionId,
        cycleId: cycle ? cycle.id : null,
        reportId: report.id,
        clubId: team.id,
        actionType: 'generate-emergency-player',
        playerId,
        appliedAt: iso,
        delegatedByUser: Boolean(delegatedByUser),
        succeeded: false,
        failureReason: err.message,
        provenance: { dataSource: cfg.dataSource, isReal: false },
      });
      return { succeeded: false, action };
    }
  }

  // Clasificación regulatoria FORZADA para el alta de emergencia: se
  // construye sobre la clasificación normal del club y se declara
  // EXPLÍCITAMENTE la del jugador nuevo. Es un dato SIMULADO (REG-1 ya
  // define la clasificación como contextual por competición+temporada y
  // decidida a nivel de club por `RegistrationSeeder`) — nunca "evidencia
  // real de formación" del jugador.
  function buildForcedClassification(team, playerId, requiredClassification) {
    const formationPlayerIds = new Set();
    const nonCommunityPlayerIds = new Set();
    if (!requiredClassification || requiredClassification.formation === 'qualifies') {
      formationPlayerIds.add(playerId);
    }
    if (requiredClassification && requiredClassification.nonCommunity === 'counts') {
      nonCommunityPlayerIds.add(playerId);
    }
    void team;
    return { formationPlayerIds, nonCommunityPlayerIds };
  }

  // Alta ATÓMICA de un jugador (libre existente o de emergencia) por los
  // servicios NORMALES: contrato -> afiliación -> licencia/inscripción.
  function signPlayerForEmergency(params) {
    const {
      player, team, deps, iso, seasonKey, config, requiredClassification,
    } = params;
    const {
      playerRegistry, contractRegistry, registrationRegistry, teams, lineup, calibration,
    } = deps;
    return Tx().runAtomic(`RosterLegalityService.signPlayerForEmergency(${player.id})`, (ctx) => {
      const { contract } = ContractSeeder().seedContractForNewPlayer({
        player,
        team,
        seasonKey,
        date: iso,
        registry: contractRegistry,
        playerRegistry,
        config,
        calibration,
        teams,
        isFirstProfessionalContract: false,
      });
      ctx.registerUndo(() => { contractRegistry.unregister(contract.id); });

      const report = RosterSvc().transferPlayer({
        playerRegistry, teams, playerId: player.id, fromTeamId: null, toTeamId: team.id, lineup,
      });
      ctx.registerUndo(() => {
        team.removePlayer(player.id);
        playerRegistry.setAffiliation(player.id, null);
        report.restoreOperationalReferences();
      });

      let registrationId = null;
      let licenseId = null;
      if (registrationRegistry) {
        const seeded = RegistrationSeeder().seedRegistrationForNewPlayer({
          player,
          team,
          seasonKey,
          date: iso,
          registrationRegistry,
          contractRegistry,
          config,
          existingClassification: buildForcedClassification(team, player.id, requiredClassification),
        });
        licenseId = seeded.license ? seeded.license.id : null;
        registrationId = seeded.registration ? seeded.registration.id : null;
        ctx.registerUndo(() => {
          if (registrationId) registrationRegistry.unregisterRegistration(registrationId);
          if (licenseId) registrationRegistry.unregisterLicense(licenseId);
        });
        if (!registrationId) {
          throw new Error(
            `El alta de emergencia de "${player.id}" en "${team.id}" no obtuvo inscripción de competición `
            + '(cupo acumulado agotado): no resuelve la carencia de legalidad.',
          );
        }
      }
      return { contract, registrationId, licenseId };
    });
  }

  const exportsObj = {
    RosterLegalityService: {
      buildRegulatedPool,
      buildReport,
      applyEmergencyLadder,
      buildForcedClassification,
      signPlayerForEmergency,
    },
  };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
