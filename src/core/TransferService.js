// src/core/TransferService.js
// TRANSFER-1 (DESIGN.md 9.20, sección 10.2/11/12 del prompt) — servicio de
// dominio: apertura de expedientes, ofertas club-club, consentimiento del
// jugador, evaluación determinista del club vendedor y ensamblado de los
// comandos que consume TransferExecutionService. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// La UI SOLO llama a este servicio (y a TransferExecutionService) — nunca
// escribe directamente en TransferRegistry/ContractRegistry/
// RegistrationRegistry/Team.roster/player.teamId.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const RegistrationServiceModule = isNode ? require('./RegistrationService.js') : global.BasketManager;
  const RegulatoryClassificationServiceModule = isNode ? require('./RegulatoryClassificationService.js') : global.BasketManager;
  const TransferExecutionServiceModule = isNode ? require('./TransferExecutionService.js') : global.BasketManager;
  const TransferEntities = isNode ? require('../entities/Transfer.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function RegSvc() { return RegistrationServiceModule.RegistrationService; }
  function RegClass() { return RegulatoryClassificationServiceModule.RegulatoryClassificationService; }
  function ExecutionSvc() { return TransferExecutionServiceModule.TransferExecutionService; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // ---------------------------------------------------------------------
  // Contexto normativo de UNA operación — resuelve jurisdicción/competición
  // de origen y destino a partir de los clubes REALES (nunca de
  // `team.division` directamente ni del próximo partido).
  // ---------------------------------------------------------------------
  function buildTransferRulesContext(params) {
    const {
      playerId, originTeam, destinationTeam, seasonKey, effectiveDate, operationType, mechanism, agreementInPrincipleId,
      contractId, transactionScope,
    } = params;
    const destinationCtx = ContractSvc().resolveEmploymentContext(destinationTeam);
    const originCtx = originTeam ? ContractSvc().resolveEmploymentContext(originTeam) : null;
    return {
      playerId,
      originClubId: originTeam ? originTeam.id : destinationTeam.id,
      destinationClubId: destinationTeam.id,
      originEmployerJurisdictionId: originCtx ? originCtx.employerJurisdictionId : destinationCtx.employerJurisdictionId,
      destinationEmployerJurisdictionId: destinationCtx.employerJurisdictionId,
      originCompetitionId: originCtx ? originCtx.domesticCompetitionId : null,
      destinationCompetitionId: destinationCtx.domesticCompetitionId,
      federationId: destinationCtx.federationId,
      seasonKey,
      effectiveDate,
      operationType,
      mechanism: mechanism || operationType,
      transactionScope: transactionScope || 'domestic',
      contractId: contractId || null,
      agreementInPrincipleId,
    };
  }

  function resolveTransferRules(params) {
    return CompetitionRules.resolveTransferRules(buildTransferRulesContext(params));
  }

  // ---------------------------------------------------------------------
  // Apertura de expediente (sección 10.2) — a partir de un AIP VIVO.
  // ---------------------------------------------------------------------
  function openCaseFromAgreement(params) {
    const {
      transferRegistry, marketRegistry, agreement, operationType, originClubId, initiatingClubId, date, rulesSnapshot,
    } = params;
    const iso = toIso(date);
    if (!agreement.isLiveOn(iso)) {
      throw new Error(`TransferService.openCaseFromAgreement: el AIP "${agreement.id}" no está vivo a ${iso}.`);
    }
    const id = params.id || `transfer-case:${agreement.id}`;
    const transferCase = new TransferEntities.TransferCase({
      id,
      playerId: agreement.playerId,
      initiatingClubId: initiatingClubId || agreement.clubId,
      originClubId: originClubId || null,
      destinationClubId: agreement.clubId,
      agreementInPrincipleId: agreement.id,
      operationType,
      openedAt: iso,
      expiresAt: agreement.validUntil,
      rulesSnapshot,
      provenance: { dataSource: 'simulated-transfer-v1', isReal: false },
    });
    transferRegistry.registerCase(transferCase);
    return transferCase;
  }

  // ---------------------------------------------------------------------
  // Negociación club-club (sección 12) — evaluación DETERMINISTA del club
  // vendedor. Nunca Math.random(), nunca Potencial/Ambición/Profesionalismo
  // visibles, nunca depende del orden de un array. Devuelve razones
  // CUALITATIVAS, nunca la puntuación interna.
  // ---------------------------------------------------------------------
  const CPU_SELLER_POLICY_VERSION = 'simulated-cpu-seller-policy-v1';

  function evaluateSellingClub(params) {
    const {
      originTeam, player, originContract, offer, careerSeed, date, deadlinePassed,
    } = params;
    const fingerprint = `${careerSeed}|seller-eval|${originTeam.id}|${player.id}|${offer.id}|${toIso(date)}`;
    const remainingSeasons = originContract ? originContract.remainingSeasonKeys(toIso(date)).length : 0;
    const hasReleaseClause = Boolean(originContract && originContract.clauses.some((c) => c.type === 'player-release'));
    const feeQualityRatio = Math.min(2, offer.fee.amountMinor / Math.max(1, (originContract ? originContract.breakdownForSeason(originContract.coveredSeasonKeys[0]).guaranteedTotalMinor : 1) * Math.max(1, remainingSeasons)));
    const squadDepthAtPosition = (originTeam.roster || []).filter((p) => p.primaryPosition === player.primaryPosition).length;
    const depthScore = Math.min(1, Math.max(0, (squadDepthAtPosition - 1) / 3));
    const sportingGoalPressure = originTeam.board && originTeam.board.sportingGoal === 'Título' ? 0.15 : 0;

    const acceptScore = (Math.min(1, feeQualityRatio / 1.2) * 0.55) + (depthScore * 0.25) + (Rnd().unitFrom(fingerprint, 'sentiment') * 0.20) - sportingGoalPressure;
    const acceptThreshold = 0.55 + Rnd().unitFrom(fingerprint, 'threshold') * 0.15;

    const reasons = [];
    let decision;
    if (deadlinePassed) {
      decision = 'reject';
      reasons.push('El plazo de respuesta ha vencido sin decisión.');
    } else if (acceptScore >= acceptThreshold) {
      decision = 'accept';
      reasons.push('El importe ofrecido compensa la pérdida deportiva del jugador.');
    } else if (acceptScore >= acceptThreshold - 0.18) {
      decision = 'counter';
      if (feeQualityRatio < 1) reasons.push('El importe se queda corto frente al valor interno del jugador.');
      if (depthScore < 0.3) reasons.push('La plantilla no tiene recambio claro en esa posición.');
      if (!reasons.length) reasons.push('Cerca de un acuerdo, pero pide una mejora del importe.');
    } else {
      decision = 'reject';
      reasons.push(feeQualityRatio < 0.6 ? 'La oferta queda muy lejos del valor interno del jugador.' : 'El club no quiere debilitar la plantilla ahora mismo.');
    }
    return {
      decision, reasons, hasReleaseClause, policyVersion: CPU_SELLER_POLICY_VERSION,
    };
  }

  function generateCounterFee(params) {
    const { originalFeeMinor, careerSeed, offerId, roundIndex } = params;
    const fingerprint = `${careerSeed}|seller-counter|${offerId}|${roundIndex || 0}`;
    const bumpFactor = 0.12 + Rnd().unitFrom(fingerprint, 'bump') * 0.18; // +12% a +30%
    return Math.round(originalFeeMinor * (1 + bumpFactor));
  }

  // ---------------------------------------------------------------------
  // Construcción del sub-comando de inscripción de destino (sección 17.2)
  // — mismo criterio de clasificación que RegistrationSeeder, pero
  // resuelto AQUÍ para el club/temporada/fecha de la operación real.
  // ---------------------------------------------------------------------
  function buildDestinationRegistrationCommand(params) {
    const {
      destinationTeam, seasonKey, date, registrationRegistry,
    } = params;
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(destinationTeam.division);
    const resolved = RegSvc().resolveRegistrationRules({
      competitionId, seasonKey, date: toIso(date), phaseId: 'league', operation: 'transfer',
    });
    const documentCodes = (resolved.registration && resolved.registration.documentRequirements) || [];
    const documentStatuses = {};
    documentCodes.forEach((code) => { documentStatuses[code] = 'verified'; });
    return {
      federationId: resolved.registration ? (resolved.registration.federationId || 'feb-general') : 'feb-general',
      seasonKey,
      licenseClass: 'professional-senior',
      validity: LD().seasonWindow(seasonKey),
      documentStatuses,
      competitionId,
      competitionInstanceId: competitionId,
      registrationScopeId: resolved.registrationScopeId,
      classificationSnapshot: {
        formation: 'does-not-qualify', nonCommunity: 'does-not-count', basis: 'simulated-transfer-signing', provenance: 'simulated',
      },
      resolved,
      cumulativeRegistrationCapMax: resolved.registration && resolved.registration.cumulativeRegistrationCap
        ? resolved.registration.cumulativeRegistrationCap.max : null,
    };
  }

  // ---------------------------------------------------------------------
  // Fachadas de alto nivel por mecanismo — construyen el `command` completo
  // y delegan en TransferExecutionService (plan + commit). Devuelven
  // `{ plan, result }`; si `plan.blockers.length`, NO se intenta el commit.
  // ---------------------------------------------------------------------
  function planAndMaybeCommit(command, deps, { commit }) {
    const plan = ExecutionSvc().planTransaction(command, deps);
    if (!plan.isExecutable) return { plan, result: null };
    if (!commit) return { plan, result: null };
    const result = ExecutionSvc().commitTransaction(plan, deps);
    return { plan, result };
  }

  // Avanza el ciclo de vida del EXPEDIENTE (TransferCase) tras planificar/
  // comprometer — sección 9.1/20.3 del prompt: Mercado > Operaciones
  // necesita un estado REAL (readyToPlan/planned/readyToExecute/completed
  // /blocked), nunca "draft" para siempre. Un plan bloqueado se detiene en
  // `blocked` con los motivos anotados para mostrarlos en la pantalla de
  // solo lectura; un commit exitoso recorre las transiciones intermedias
  // hasta `completed` (nunca salta directo, la máquina de estados exige el
  // orden). `result === undefined` (en vez de null explícito) significa
  // "no se intentó comprometer" (commit:false) — el expediente queda en
  // readyToPlan, ni bloqueado ni completado.
  function advanceTransferCaseLifecycle(transferCase, plan, result, committed, date) {
    const iso = toIso(date);
    if (plan.blockers.length) {
      transferCase.addEvent({ id: `${transferCase.id}:blocked`, type: 'blocked', date: iso });
      transferCase.lastBlockers = plan.blockers;
      return transferCase;
    }
    // Sin `time` explícito: comparte la MISMA clave de orden por defecto
    // (23:59:59, mismo criterio que el evento implícito `case-opened`) —
    // igual patrón ya usado por NegotiationThread/ContractOffer de
    // MARKET-1 (varios eventos el mismo día civil, ninguno con hora
    // explícita). La cronología solo exige "no anterior", nunca "hora
    // estrictamente distinta".
    transferCase.addEvent({ id: `${transferCase.id}:rtp`, type: 'ready-to-plan', date: iso });
    if (!committed) return transferCase; // solo se planificó (commit:false)
    transferCase.addEvent({ id: `${transferCase.id}:planned`, type: 'planned', date: iso });
    if (result && result.notYetDue) {
      transferCase.addEvent({ id: `${transferCase.id}:scheduled`, type: 'scheduled', date: iso });
      return transferCase;
    }
    transferCase.addEvent({ id: `${transferCase.id}:rte`, type: 'ready-to-execute', date: iso });
    transferCase.addEvent({ id: `${transferCase.id}:completed`, type: 'completed', date: iso });
    return transferCase;
  }

  function formalizeFreeAgentSigning(params) {
    const {
      transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams,
      agreement, destinationTeam, seasonKey, effectiveDate, now, commit,
    } = params;
    const rulesCtx = buildTransferRulesContext({
      playerId: agreement.playerId, originTeam: null, destinationTeam, seasonKey, effectiveDate, operationType: 'free-agent-signing', agreementInPrincipleId: agreement.id,
    });
    const resolvedRules = CompetitionRules.resolveTransferRules(rulesCtx);
    const transferCase = openCaseFromAgreement({
      transferRegistry, marketRegistry, agreement, operationType: 'free-agent-signing', initiatingClubId: destinationTeam.id, date: effectiveDate, rulesSnapshot: resolvedRules.trace,
    });
    const destinationRegistration = buildDestinationRegistrationCommand({ destinationTeam, seasonKey, date: effectiveDate, registrationRegistry });
    const command = {
      transactionId: `tx:${transferCase.id}`,
      transferCaseId: transferCase.id,
      operationType: 'free-agent-signing',
      mechanism: 'free-agent-signing',
      playerId: agreement.playerId,
      destinationClubId: destinationTeam.id,
      effectiveDate,
      seasonKey,
      agreementInPrincipleId: agreement.id,
      destinationEmployerJurisdictionId: rulesCtx.destinationEmployerJurisdictionId,
      destinationCompetitionId: rulesCtx.destinationCompetitionId,
      federationId: rulesCtx.federationId,
      destinationRegistration,
    };
    const { plan, result } = planAndMaybeCommit(command, {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
    }, { commit });
    if (result && result.record) transferCase.transactionId = result.record.id;
    advanceTransferCaseLifecycle(transferCase, plan, result, commit, effectiveDate);
    return { transferCase, plan, result };
  }

  function formalizeNegotiatedTransfer(params) {
    const {
      transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams,
      agreement, originTeam, destinationTeam, seasonKey, effectiveDate, now, commit,
      clubOffer, playerConsentGrantedAt,
    } = params;
    const originContract = contractRegistry.currentForPlayer(agreement.playerId, effectiveDate);
    if (!originContract) throw new Error('TransferService.formalizeNegotiatedTransfer: el jugador no tiene contrato vigente con el club de origen.');
    const rulesCtx = buildTransferRulesContext({
      playerId: agreement.playerId, originTeam, destinationTeam, seasonKey, effectiveDate, operationType: 'negotiated-transfer', agreementInPrincipleId: agreement.id, contractId: originContract.id,
    });
    const resolvedRules = CompetitionRules.resolveTransferRules(rulesCtx);
    const transferCase = openCaseFromAgreement({
      transferRegistry, marketRegistry, agreement, operationType: 'negotiated-transfer', originClubId: originTeam.id, initiatingClubId: destinationTeam.id, date: effectiveDate, rulesSnapshot: resolvedRules.trace,
    });
    const agreementRecord = new TransferEntities.TransferAgreement({
      id: `transfer-agreement:${transferCase.id}`,
      transferCaseId: transferCase.id,
      playerId: agreement.playerId,
      originClubId: originTeam.id,
      destinationClubId: destinationTeam.id,
      acceptedClubOfferId: clubOffer.id,
      fee: clubOffer.fee,
      agreedAt: effectiveDate,
      effectiveDate,
      // El consentimiento NUNCA se deduce de haber aceptado una oferta
      // salarial (sección 11.3 del prompt) — sin `playerConsentGrantedAt`
      // EXPLÍCITO, no hay consentimiento, y el plan debe bloquear.
      playerConsent: playerConsentGrantedAt ? { grantedAt: playerConsentGrantedAt, actor: 'player', scope: 'transfer-and-termination' } : null,
      terminationMechanism: 'mutual-transfer',
      documentsRequired: (resolvedRules.documentRequirements || []),
      documentStatuses: Object.fromEntries((resolvedRules.documentRequirements || []).map((d) => [d, 'verified'])),
      rulesSnapshot: resolvedRules.trace,
    });
    transferRegistry.registerTransferAgreement(agreementRecord);
    transferCase.transferAgreementId = agreementRecord.id;
    transferCase.clubOfferId = clubOffer.id;
    transferCase.setConsent(agreementRecord.playerConsent);

    const destinationRegistration = buildDestinationRegistrationCommand({ destinationTeam, seasonKey, date: effectiveDate, registrationRegistry });
    const command = {
      transactionId: `tx:${transferCase.id}`,
      transferCaseId: transferCase.id,
      transferAgreementRecordId: agreementRecord.id,
      operationType: 'negotiated-transfer',
      mechanism: 'negotiated-transfer',
      playerId: agreement.playerId,
      originClubId: originTeam.id,
      destinationClubId: destinationTeam.id,
      effectiveDate,
      seasonKey,
      agreementInPrincipleId: agreement.id,
      originEmployerJurisdictionId: rulesCtx.originEmployerJurisdictionId,
      destinationEmployerJurisdictionId: rulesCtx.destinationEmployerJurisdictionId,
      originCompetitionId: rulesCtx.originCompetitionId,
      destinationCompetitionId: rulesCtx.destinationCompetitionId,
      federationId: rulesCtx.federationId,
      transferAgreement: {
        fee: agreementRecord.fee,
        playerConsent: agreementRecord.playerConsent,
        playerParticipationPercentBasisPoints: params.playerParticipationPercentBasisPoints,
      },
      originRegistrationScopeId: params.originRegistrationScopeId,
      originSeasonKey: params.originSeasonKey || seasonKey,
      destinationRegistration,
      rightsOutcomeId: params.rightsOutcomeId || null,
    };
    const { plan, result } = planAndMaybeCommit(command, {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
    }, { commit });
    if (result && result.record) transferCase.transactionId = result.record.id;
    advanceTransferCaseLifecycle(transferCase, plan, result, commit, effectiveDate);
    return {
      transferCase, agreementRecord, plan, result,
    };
  }

  function formalizeReleaseClauseExercise(params) {
    const {
      transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams,
      agreement, originTeam, destinationTeam, seasonKey, effectiveDate, now, commit, clauseId, exercisedBy,
    } = params;
    const originContract = contractRegistry.currentForPlayer(agreement.playerId, effectiveDate);
    if (!originContract) throw new Error('TransferService.formalizeReleaseClauseExercise: el jugador no tiene contrato vigente con el club de origen.');
    const clause = originContract.clauses.find((c) => c.id === clauseId && c.type === 'player-release');
    if (!clause || !clause.amount) throw new Error(`TransferService.formalizeReleaseClauseExercise: cláusula "${clauseId}" inexistente o sin importe.`);
    const rulesCtx = buildTransferRulesContext({
      playerId: agreement.playerId, originTeam, destinationTeam, seasonKey, effectiveDate, operationType: 'release-clause-exercise', agreementInPrincipleId: agreement.id, contractId: originContract.id,
    });
    const resolvedRules = CompetitionRules.resolveTransferRules(rulesCtx);
    const transferCase = openCaseFromAgreement({
      transferRegistry, marketRegistry, agreement, operationType: 'release-clause-exercise', originClubId: originTeam.id, initiatingClubId: destinationTeam.id, date: effectiveDate, rulesSnapshot: resolvedRules.trace,
    });
    const exercise = new TransferEntities.ReleaseClauseExercise({
      id: `release-clause:${transferCase.id}`,
      transferCaseId: transferCase.id,
      contractId: originContract.id,
      clauseId,
      amount: clause.amount,
      exercisedBy: exercisedBy || 'player',
      notifiedAt: effectiveDate,
      rulesSnapshot: resolvedRules.trace,
    });
    exercise.addEvent({ id: `${exercise.id}:satisfied`, type: 'satisfied', date: effectiveDate });
    transferRegistry.registerReleaseClauseExercise(exercise);
    transferCase.releaseClauseExerciseId = exercise.id;

    const destinationRegistration = buildDestinationRegistrationCommand({ destinationTeam, seasonKey, date: effectiveDate, registrationRegistry });
    const command = {
      transactionId: `tx:${transferCase.id}`,
      transferCaseId: transferCase.id,
      operationType: 'release-clause-exercise',
      mechanism: 'release-clause-exercise',
      playerId: agreement.playerId,
      originClubId: originTeam.id,
      destinationClubId: destinationTeam.id,
      effectiveDate,
      seasonKey,
      agreementInPrincipleId: agreement.id,
      originEmployerJurisdictionId: rulesCtx.originEmployerJurisdictionId,
      destinationEmployerJurisdictionId: rulesCtx.destinationEmployerJurisdictionId,
      originCompetitionId: rulesCtx.originCompetitionId,
      destinationCompetitionId: rulesCtx.destinationCompetitionId,
      federationId: rulesCtx.federationId,
      clauseId,
      releaseClauseAmount: clause.amount,
      releaseClauseExercisedBy: exercisedBy || 'player',
      registrationRestrictionAfterMonthDay: resolvedRules.releaseClauseRules ? resolvedRules.releaseClauseRules.registrationRestrictionAfterMonthDay : null,
      originRegistrationScopeId: params.originRegistrationScopeId,
      originSeasonKey: params.originSeasonKey || seasonKey,
      destinationRegistration,
    };
    const { plan, result } = planAndMaybeCommit(command, {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
    }, { commit });
    if (result && result.record) transferCase.transactionId = result.record.id;
    advanceTransferCaseLifecycle(transferCase, plan, result, commit, effectiveDate);
    return {
      transferCase, exercise, plan, result,
    };
  }

  function formalizeMutualAgreement(params) {
    const {
      transferRegistry, marketRegistry, registrationRegistry, contractRegistry, playerRegistry, teams,
      originTeam, destinationTeam, seasonKey, effectiveDate, now, commit, mutualSettlement, agreement,
    } = params;
    const originContract = contractRegistry.currentForPlayer(params.playerId || (agreement && agreement.playerId), effectiveDate);
    if (!originContract) throw new Error('TransferService.formalizeMutualAgreement: el jugador no tiene contrato vigente con el club de origen.');
    const playerId = originContract.playerId;
    const releaseOnly = !destinationTeam;
    const rulesCtx = buildTransferRulesContext({
      playerId, originTeam, destinationTeam: destinationTeam || originTeam, seasonKey, effectiveDate, operationType: 'mutual-agreement', agreementInPrincipleId: agreement ? agreement.id : `self:${playerId}`, contractId: originContract.id,
    });
    const resolvedRules = CompetitionRules.resolveTransferRules(rulesCtx);
    const id = `transfer-case:mutual:${playerId}:${effectiveDate}`;
    const transferCase = new TransferEntities.TransferCase({
      id,
      playerId,
      initiatingClubId: originTeam.id,
      originClubId: originTeam.id,
      destinationClubId: destinationTeam ? destinationTeam.id : originTeam.id,
      agreementInPrincipleId: agreement ? agreement.id : `self:release:${playerId}`,
      operationType: 'mutual-agreement',
      openedAt: effectiveDate,
      rulesSnapshot: resolvedRules.trace,
      provenance: { dataSource: 'simulated-transfer-v1', isReal: false },
    });
    transferRegistry.registerCase(transferCase);

    const destinationRegistration = destinationTeam ? buildDestinationRegistrationCommand({ destinationTeam, seasonKey, date: effectiveDate, registrationRegistry }) : null;
    const command = {
      transactionId: `tx:${transferCase.id}`,
      transferCaseId: transferCase.id,
      operationType: 'mutual-agreement',
      mechanism: 'mutual-agreement',
      playerId,
      originClubId: originTeam.id,
      destinationClubId: destinationTeam ? destinationTeam.id : originTeam.id,
      releaseOnly,
      effectiveDate,
      seasonKey,
      // Un release NO tiene AIP real — se satisface con un marcador propio
      // que solo esta operación consume (nunca bloquea a otro jugador).
      agreementInPrincipleId: agreement ? agreement.id : null,
      originEmployerJurisdictionId: rulesCtx.originEmployerJurisdictionId,
      destinationEmployerJurisdictionId: destinationTeam ? rulesCtx.destinationEmployerJurisdictionId : null,
      originCompetitionId: rulesCtx.originCompetitionId,
      destinationCompetitionId: destinationTeam ? rulesCtx.destinationCompetitionId : null,
      federationId: rulesCtx.federationId,
      mutualSettlement,
      originRegistrationScopeId: params.originRegistrationScopeId,
      originSeasonKey: params.originSeasonKey || seasonKey,
      destinationRegistration,
    };
    if (!agreement) {
      // Sin AIP real (liberación pura o mutuo acuerdo sin destino nuevo
      // todavía): planTransaction exige `agreementInPrincipleId` como
      // referencia — se valida por separado aquí, fuera del motor de AIP.
      const { plan, result } = planReleaseWithoutAgreement(command, {
        playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
      }, resolvedRules, commit);
      if (result && result.record) transferCase.transactionId = result.record.id;
      advanceTransferCaseLifecycle(transferCase, plan, result, commit, effectiveDate);
      return { transferCase, plan, result };
    }
    const { plan, result } = planAndMaybeCommit(command, {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
    }, { commit });
    if (result && result.record) transferCase.transactionId = result.record.id;
    advanceTransferCaseLifecycle(transferCase, plan, result, commit, effectiveDate);
    return { transferCase, plan, result };
  }

  // Variante de plan/commit para una liberación SIN AIP (mutuo acuerdo sin
  // destino nuevo) — reutiliza el mismo motor atómico saltándose solo la
  // comprobación de AIP vivo (no aplica cuando no hay destino nuevo).
  function planReleaseWithoutAgreement(command, deps, resolvedRules, commit) {
    const TransferExecutionServiceCore = ExecutionSvc();
    // Se construye un plan MANUALMENTE (mismo criterio que planTransaction,
    // reducido: sin AIP, sin nuevo contrato) para no forzar un AIP
    // artificial en el registro de mercado.
    const effectiveDate = toIso(command.effectiveDate);
    const player = deps.playerRegistry.get(command.playerId);
    const originContract = deps.contractRegistry.currentForPlayer(command.playerId, effectiveDate);
    const blockers = [];
    if (!player) blockers.push({ code: 'PLAYER_NOT_FOUND', message: 'Jugador no encontrado.' });
    if (!originContract) blockers.push({ code: 'NO_ORIGIN_CONTRACT', message: 'Sin contrato vigente de origen.' });
    if (!command.mutualSettlement || !command.mutualSettlement.partiesConsent) {
      blockers.push({ code: 'MISSING_MUTUAL_SETTLEMENT', message: 'Falta el acuerdo explícito de mutuo acuerdo (partes/fecha/importe o fuente).' });
    }
    if (deps.pendingUserMatchBlocks) blockers.push({ code: 'PENDING_USER_MATCH', message: 'Partido del usuario en curso/pendiente de revelar.' });

    const TransferEntitiesLocal = TransferEntities;
    const plan = new TransferEntitiesLocal.TransferExecutionPlan({
      transactionId: command.transactionId,
      command,
      preconditions: [],
      fingerprints: { contractRegistrySizeForPlayer: deps.contractRegistry.forPlayer(command.playerId).length },
      operations: ['register-termination-and-obligations', 'move-roster', 'apply-origin-deregistration', 'register-transaction-record'],
      newObjects: { terminationPlan: { mechanism: command.releaseOnly ? 'mutual-release' : 'mutual-transfer' }, resolvedTransferRules: resolvedRules },
      obligations: command.mutualSettlement && command.mutualSettlement.amount ? [{
        concept: 'mutual-termination-settlement', debtorType: 'club', debtorId: command.originClubId, creditorType: 'player', creditorId: command.playerId,
        amountMinor: command.mutualSettlement.amount.amountMinor, currency: command.mutualSettlement.amount.currency, legalSource: { ruleModuleId: 'mutual-agreement', article: null },
      }] : [],
      blockers,
      warnings: [],
      hash: `mutual:${command.playerId}:${effectiveDate}`,
      builtAt: effectiveDate,
    });
    if (!plan.isExecutable || !commit) return { plan, result: null };
    const result = commitMutualReleaseWithoutAgreement(plan, deps);
    return { plan, result };
  }

  // Commit reducido para mutuo acuerdo SIN AIP — reutiliza
  // RosterMutationService/RegistrationService/ContractRegistry igual que
  // TransferExecutionService, pero sin tocar MarketRegistry (no hay AIP).
  function commitMutualReleaseWithoutAgreement(plan, deps) {
    const {
      playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams,
    } = deps;
    const already = transferRegistry.completedTransaction(plan.transactionId);
    if (already) return { record: already, idempotent: true };
    const cmd = plan.command;
    const effectiveDate = toIso(cmd.effectiveDate);
    const RosterMutationServiceModule2 = isNode ? require('./RosterMutationService.js') : global.BasketManager;
    const RosterSvc = RosterMutationServiceModule2.RosterMutationService;
    const undoStack = [];
    // Igual criterio que TransferExecutionService.commitTransaction: cada
    // paso muta primero y ACTO SEGUIDO registra su propio cierre de
    // reversión — `runStep()` solo ALMACENA ese cierre, nunca lo ejecuta.
    function runStep(fn) { undoStack.push(fn); }
    try {
      const originContract = contractRegistry.currentForPlayer(cmd.playerId, effectiveDate);
      const terminationRecord = new TransferEntities.ContractTerminationRecord({
        id: `termination:${plan.transactionId}`,
        contractId: originContract.id,
        playerId: cmd.playerId,
        clubId: originContract.clubId,
        mechanism: plan.newObjects.terminationPlan.mechanism,
        effectiveDate,
        agreedAt: effectiveDate,
        parties: (cmd.mutualSettlement.partiesConsent || []).map((actor) => ({ actor, consentGivenAt: effectiveDate })),
        settlement: cmd.mutualSettlement.amount || null,
        documentation: cmd.documentation || [],
      });
      transferRegistry.registerTerminationRecord(terminationRecord);
      runStep(() => { transferRegistry._terminationRecords.delete(terminationRecord.id); });
      originContract.addLifecycleEvent({ type: 'terminated', date: effectiveDate, note: `TRANSFER-1:${plan.newObjects.terminationPlan.mechanism}` });

      const registeredObligations = plan.obligations.map((line, idx) => {
        const obligation = new TransferEntities.FinancialObligation({ id: `obligation:${plan.transactionId}:${idx}`, transactionId: plan.transactionId, ...line });
        transferRegistry.registerObligation(obligation);
        runStep(() => { transferRegistry._obligations.delete(obligation.id); });
        return obligation;
      });

      let deactivatedRegistrationId = null;
      if (registrationRegistry && cmd.originRegistrationScopeId) {
        const currentReg = registrationRegistry.currentRegistration(cmd.playerId, cmd.originRegistrationScopeId, cmd.originSeasonKey, effectiveDate);
        if (currentReg) {
          const before = currentReg.events.slice();
          RegSvc().deactivateRegistration(currentReg, effectiveDate, `TRANSFER-1:${plan.newObjects.terminationPlan.mechanism}`);
          deactivatedRegistrationId = currentReg.id;
          runStep(() => { currentReg.events = before; });
        }
      }

      const player = playerRegistry.require(cmd.playerId);
      const rosterReport = RosterSvc.releasePlayer({ playerRegistry, teams, playerId: cmd.playerId, fromTeamId: cmd.originClubId });
      runStep(() => {
        const backTeam = (teams || []).find((t) => t.id === rosterReport.fromTeamId);
        if (backTeam) backTeam.addPlayer(player);
      });

      const record = new TransferEntities.TransactionRecord({
        id: plan.transactionId,
        transferCaseId: cmd.transferCaseId,
        playerId: cmd.playerId,
        operationType: cmd.operationType,
        mechanism: plan.newObjects.terminationPlan.mechanism,
        effectiveDate,
        completedAt: effectiveDate,
        originClubId: cmd.originClubId,
        destinationClubId: null,
        terminationRecordId: terminationRecord.id,
        deactivatedRegistrationId,
        obligationIds: registeredObligations.map((o) => o.id),
        rosterMutationReport: { fromTeamId: rosterReport.fromTeamId, toTeamId: null },
      });
      transferRegistry.registerTransactionRecord(record);
      return { record, idempotent: false };
    } catch (err) {
      for (let i = undoStack.length - 1; i >= 0; i -= 1) undoStack[i]();
      throw err;
    }
  }

  const exportsObj = {
    TransferService: {
      CPU_SELLER_POLICY_VERSION,
      buildTransferRulesContext,
      resolveTransferRules,
      openCaseFromAgreement,
      evaluateSellingClub,
      generateCounterFee,
      buildDestinationRegistrationCommand,
      formalizeFreeAgentSigning,
      formalizeNegotiatedTransfer,
      formalizeReleaseClauseExercise,
      formalizeMutualAgreement,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
