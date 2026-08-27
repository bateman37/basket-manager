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
  //
  // `date` es el momento REAL en que se abre el expediente (hoy, "now") —
  // determina si el AIP sigue vivo y fecha el evento `case-opened`.
  // `effectiveDate` es la fecha en la que la operación surtirá efecto
  // (sección 11.2: puede ser posterior a `date` en un fichaje futuro) — se
  // guarda como dato del expediente, nunca como fecha de sus propios
  // eventos administrativos.
  // ---------------------------------------------------------------------
  function openCaseFromAgreement(params) {
    const {
      transferRegistry, marketRegistry, agreement, operationType, originClubId, initiatingClubId, date, effectiveDate, rulesSnapshot,
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
      effectiveDate: effectiveDate || date,
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
      originTeam, player, originContract, offer, careerSeed, date, seasonKey, deadlinePassed,
    } = params;
    const fingerprint = `${careerSeed}|seller-eval|${originTeam.id}|${player.id}|${offer.id}|${toIso(date)}`;
    // `remainingSeasonKeys()` compara CLAVES de temporada ("2026-27"), nunca
    // una fecha civil ISO — `seasonKey` llega SIEMPRE explícito desde el
    // llamador (mismo criterio que el resto de la EPIC: nunca se deriva un
    // dato de calendario de juego adivinando a partir de una fecha suelta).
    const remainingSeasons = originContract ? originContract.remainingSeasonKeys(seasonKey).length : 0;
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

  // Resuelve el `registrationScopeId` del club de ORIGEN — se calcula
  // SIEMPRE aquí (nunca queda a que el llamador se acuerde de pasarlo):
  // sin esto, `TransferExecutionService.commitTransaction()` nunca
  // desactiva la inscripción de origen, y un traspaso DENTRO de la misma
  // competición/temporada dejaría al jugador con dos inscripciones activas
  // a la vez. `params.originRegistrationScopeId`/`originSeasonKey`
  // explícitos (si el llamador los pasa, p.ej. un origen recién
  // ascendido/descendido con ámbito de temporada anterior) tienen
  // prioridad sobre este valor por defecto.
  function resolveOriginRegistrationScope(originTeam, seasonKey, date) {
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(originTeam.division);
    const resolved = RegSvc().resolveRegistrationRules({
      competitionId, seasonKey, date: toIso(date), phaseId: 'league', operation: 'transfer',
    });
    return resolved.registrationScopeId;
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
  function advanceTransferCaseLifecycle(transferCase, plan, result, committed, date, command) {
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
      // Sección 11.2: el comando congelado se conserva para que
      // `retryScheduledTransferCase()` pueda re-planificar/comprometer en
      // la fecha efectiva real, sin que el llamador (game.js) tenga que
      // reconstruir el comando desde cero — mismo criterio que
      // `rulesSnapshot` (congelado al abrir el expediente).
      transferCase.pendingCommand = command ? Object.freeze({ ...command }) : null;
      return transferCase;
    }
    transferCase.addEvent({ id: `${transferCase.id}:rte`, type: 'ready-to-execute', date: iso });
    transferCase.addEvent({ id: `${transferCase.id}:completed`, type: 'completed', date: iso });
    return transferCase;
  }

  // ---------------------------------------------------------------------
  // Fichaje futuro tras expiración (sección 11.2 del prompt) — reintenta
  // un expediente `scheduled` en una fecha posterior real
  // (`advanceGameClockTo()`, punto único del reloj). Re-planifica siempre
  // desde cero (nunca reutiliza el plan viejo sin revalidar: contrato,
  // derechos, ventana e inscripción deben seguir siendo ciertos en la
  // fecha real de ejecución) — si algo cambió entretanto, el expediente
  // queda `blocked` con el motivo, nunca a medias.
  // ---------------------------------------------------------------------
  function retryScheduledTransferCase(transferCase, deps, date) {
    const iso = toIso(date);
    // Estado REAL actual (sin filtrar por `iso`), no "estado a fecha
    // `iso`": dos divisiones/ligas pueden llamar a este reintento con
    // fechas de ronda que no avanzan en el mismo orden estricto (el
    // calendario de 2ª puede procesar un día anterior al que ya procesó
    // 1ª en la misma vuelta) — si se usara `statusOn(iso)` filtrado, un
    // expediente YA completado con fecha posterior podría parecer
    // "scheduled" otra vez ante una `iso` anterior y reintentarse,
    // generando un evento con fecha incoherente respecto al ya registrado.
    if (transferCase.statusOn(null) !== 'scheduled') return { transferCase, plan: null, result: null };
    const command = transferCase.pendingCommand;
    const plan = ExecutionSvc().planTransaction(command, deps);
    if (!plan.isExecutable) {
      transferCase.addEvent({ id: `${transferCase.id}:blocked:${iso}`, type: 'blocked', date: iso });
      transferCase.lastBlockers = plan.blockers;
      return { transferCase, plan, result: null };
    }
    const result = ExecutionSvc().commitTransaction(plan, deps);
    if (result.notYetDue) return { transferCase, plan, result }; // sigue sin llegar la fecha (defensivo)
    if (result.record) transferCase.transactionId = result.record.id;
    transferCase.addEvent({ id: `${transferCase.id}:rte:${iso}`, type: 'ready-to-execute', date: iso });
    transferCase.addEvent({ id: `${transferCase.id}:completed:${iso}`, type: 'completed', date: iso });
    return { transferCase, plan, result };
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
      transferRegistry, marketRegistry, agreement, operationType: 'free-agent-signing', initiatingClubId: destinationTeam.id, date: now, effectiveDate, rulesSnapshot: resolvedRules.trace,
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
      // BUG-TRANSFER1-16 (DESIGN.md 9.21): estas fachadas RECONSTRUÍAN sus
      // propias `deps` a mano en vez de reenviar `params` completo — así
      // que `operationalContext`/`lineup` del llamador real (game.js) se
      // perdían silenciosamente aquí, nunca llegaban a `planTransaction`/
      // `commitTransaction`.
      operationalContext: params.operationalContext, lineup: params.lineup,
    }, { commit });
    if (result && result.record) transferCase.transactionId = result.record.id;
    advanceTransferCaseLifecycle(transferCase, plan, result, commit, now, command);
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
      transferRegistry, marketRegistry, agreement, operationType: 'negotiated-transfer', originClubId: originTeam.id, initiatingClubId: destinationTeam.id, date: now, effectiveDate, rulesSnapshot: resolvedRules.trace,
    });
    // Sección 9.2 del prompt: la oferta club-club ACEPTADA es una entidad
    // CANÓNICA propia (`ClubTransferOffer`, nunca el objeto suelto
    // `{id, fee}` de la negociación previa) — se registra aquí, no se deja
    // a que el llamador (UI/negociación) recuerde registrarla, para que
    // `transferCase.clubOfferId` resuelva SIEMPRE (invariante 8: "oferta
    // jugador-club y oferta club-club son entidades distintas").
    const clubOfferRecord = new TransferEntities.ClubTransferOffer({
      id: clubOffer.id,
      transferCaseId: transferCase.id,
      version: 1,
      offeredByClubId: destinationTeam.id,
      addressedToClubId: originTeam.id,
      createdAt: effectiveDate,
      expiresAt: effectiveDate,
      fee: clubOffer.fee,
    });
    clubOfferRecord.addEvent({ id: `${clubOfferRecord.id}:accepted`, type: 'offer-accepted', date: effectiveDate });
    transferRegistry.registerClubOffer(clubOfferRecord);
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
      originRegistrationScopeId: params.originRegistrationScopeId || resolveOriginRegistrationScope(originTeam, seasonKey, effectiveDate),
      originSeasonKey: params.originSeasonKey || seasonKey,
      destinationRegistration,
      rightsOutcomeId: params.rightsOutcomeId || null,
    };
    const { plan, result } = planAndMaybeCommit(command, {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
      // BUG-TRANSFER1-16 (DESIGN.md 9.21): estas fachadas RECONSTRUÍAN sus
      // propias `deps` a mano en vez de reenviar `params` completo — así
      // que `operationalContext`/`lineup` del llamador real (game.js) se
      // perdían silenciosamente aquí, nunca llegaban a `planTransaction`/
      // `commitTransaction`.
      operationalContext: params.operationalContext, lineup: params.lineup,
    }, { commit });
    if (result && result.record) transferCase.transactionId = result.record.id;
    advanceTransferCaseLifecycle(transferCase, plan, result, commit, now, command);
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
      transferRegistry, marketRegistry, agreement, operationType: 'release-clause-exercise', originClubId: originTeam.id, initiatingClubId: destinationTeam.id, date: now, effectiveDate, rulesSnapshot: resolvedRules.trace,
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
      originRegistrationScopeId: params.originRegistrationScopeId || resolveOriginRegistrationScope(originTeam, seasonKey, effectiveDate),
      originSeasonKey: params.originSeasonKey || seasonKey,
      destinationRegistration,
    };
    const { plan, result } = planAndMaybeCommit(command, {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
      // BUG-TRANSFER1-16 (DESIGN.md 9.21): estas fachadas RECONSTRUÍAN sus
      // propias `deps` a mano en vez de reenviar `params` completo — así
      // que `operationalContext`/`lineup` del llamador real (game.js) se
      // perdían silenciosamente aquí, nunca llegaban a `planTransaction`/
      // `commitTransaction`.
      operationalContext: params.operationalContext, lineup: params.lineup,
    }, { commit });
    if (result && result.record) transferCase.transactionId = result.record.id;
    advanceTransferCaseLifecycle(transferCase, plan, result, commit, now, command);
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
      openedAt: now,
      effectiveDate,
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
      originRegistrationScopeId: params.originRegistrationScopeId || resolveOriginRegistrationScope(originTeam, seasonKey, effectiveDate),
      originSeasonKey: params.originSeasonKey || seasonKey,
      destinationRegistration,
    };
    if (!agreement) {
      // Sin AIP real (liberación pura o mutuo acuerdo sin destino nuevo
      // todavía): planTransaction exige `agreementInPrincipleId` como
      // referencia — se valida por separado aquí, fuera del motor de AIP.
      const { plan, result } = planReleaseWithoutAgreement(command, {
        playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
        operationalContext: params.operationalContext, lineup: params.lineup,
      }, resolvedRules, commit);
      if (result && result.record) transferCase.transactionId = result.record.id;
      advanceTransferCaseLifecycle(transferCase, plan, result, commit, now, command);
      return { transferCase, plan, result };
    }
    const { plan, result } = planAndMaybeCommit(command, {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams, now,
      // BUG-TRANSFER1-16 (DESIGN.md 9.21): estas fachadas RECONSTRUÍAN sus
      // propias `deps` a mano en vez de reenviar `params` completo — así
      // que `operationalContext`/`lineup` del llamador real (game.js) se
      // perdían silenciosamente aquí, nunca llegaban a `planTransaction`/
      // `commitTransaction`.
      operationalContext: params.operationalContext, lineup: params.lineup,
    }, { commit });
    if (result && result.record) transferCase.transactionId = result.record.id;
    advanceTransferCaseLifecycle(transferCase, plan, result, commit, now, command);
    return { transferCase, plan, result };
  }

  // Variante de plan/commit para una liberación SIN AIP (mutuo acuerdo sin
  // destino nuevo) — reutiliza el mismo motor atómico saltándose solo la
  // comprobación de AIP vivo (no aplica cuando no hay destino nuevo).
  //
  // BUG-TRANSFER1-13/16/17 (DESIGN.md 9.21): esta era una SEGUNDA saga
  // divergente de `TransferExecutionService.commitTransaction()`, con los
  // MISMOS tres defectos por duplicación de código en vez de reutilización:
  // tocaba mapas privados de los registros directamente en vez de sus APIs
  // reversibles (`unregister...`), leía `deps.pendingUserMatchBlocks`
  // opcional en vez de un `operationalContext` obligatorio, y ejecutaba a
  // ciegas el `plan` recibido por parámetro sin revalidar contra el estado
  // REAL en el momento del commit. `buildReleaseWithoutAgreementPlan()` es
  // ahora la ÚNICA función que calcula blockers/fingerprint — tanto
  // `planReleaseWithoutAgreement()` como `commitMutualReleaseWithoutAgreement()`
  // la invocan (el commit la vuelve a invocar como "replan-at-commit", igual
  // criterio que el motor principal), en vez de mantener dos copias del
  // cálculo de blockers.
  function buildReleaseWithoutAgreementPlan(command, deps, resolvedRules) {
    const effectiveDate = toIso(command.effectiveDate);
    const player = deps.playerRegistry.get(command.playerId);
    const originContract = deps.contractRegistry.currentForPlayer(command.playerId, effectiveDate);
    const blockers = [];
    if (!player) blockers.push({ code: 'PLAYER_NOT_FOUND', message: 'Jugador no encontrado.' });
    if (!originContract) blockers.push({ code: 'NO_ORIGIN_CONTRACT', message: 'Sin contrato vigente de origen.' });
    if (!command.mutualSettlement || !command.mutualSettlement.partiesConsent) {
      blockers.push({ code: 'MISSING_MUTUAL_SETTLEMENT', message: 'Falta el acuerdo explícito de mutuo acuerdo (partes/fecha/importe o fuente).' });
    }
    const hasOperationalContext = Boolean(deps.operationalContext) && typeof deps.operationalContext.pendingUserMatchBlocks === 'boolean';
    if (!hasOperationalContext) {
      blockers.push({ code: 'MISSING_OPERATIONAL_CONTEXT', message: 'Falta un contexto operacional explícito (¿hay un partido del usuario iniciado o pendiente de revelar?).' });
    } else if (deps.operationalContext.pendingUserMatchBlocks) {
      blockers.push({ code: 'PENDING_USER_MATCH', message: 'Partido del usuario en curso/pendiente de revelar.' });
    }

    // Fingerprint de CONTENIDO (BUG-TRANSFER1-17) — nunca solo un conteo.
    const fingerprints = {
      originContractId: originContract ? originContract.id : null,
      originContractLifecycleHash: originContract ? JSON.stringify(originContract.lifecycleEvents) : null,
      contractRegistryPlayerContractIds: deps.contractRegistry.forPlayer(command.playerId).map((c) => c.id),
      pendingUserMatchBlocks: hasOperationalContext ? deps.operationalContext.pendingUserMatchBlocks : null,
    };

    return new TransferEntities.TransferExecutionPlan({
      transactionId: command.transactionId,
      command,
      preconditions: [],
      fingerprints,
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
  }

  function planReleaseWithoutAgreement(command, deps, resolvedRules, commit) {
    const plan = buildReleaseWithoutAgreementPlan(command, deps, resolvedRules);
    if (!plan.isExecutable || !commit) return { plan, result: null };
    const result = commitMutualReleaseWithoutAgreement(plan, deps, resolvedRules);
    return { plan, result };
  }

  // Commit reducido para mutuo acuerdo SIN AIP — reutiliza
  // RosterMutationService/RegistrationService/ContractRegistry igual que
  // TransferExecutionService, pero sin tocar MarketRegistry (no hay AIP).
  function commitMutualReleaseWithoutAgreement(plan, deps, resolvedRules) {
    const {
      playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams,
    } = deps;
    const already = transferRegistry.completedTransaction(plan.transactionId);
    if (already) return { record: already, idempotent: true };
    const cmd = plan.command;
    const effectiveDate = toIso(cmd.effectiveDate);
    const RosterMutationServiceModule2 = isNode ? require('./RosterMutationService.js') : global.BasketManager;
    const RosterSvc = RosterMutationServiceModule2.RosterMutationService;

    // Replan-at-commit (BUG-TRANSFER1-17) — se revalida contra el estado
    // REAL de ahora mismo, nunca se ejecuta a ciegas el `plan` recibido.
    const freshPlan = buildReleaseWithoutAgreementPlan(cmd, deps, resolvedRules);
    if (!freshPlan.isExecutable) {
      throw new (ExecutionSvc().TransferDomainError)(
        `El plan "${plan.transactionId}" ya no es ejecutable al revalidar contra el estado actual: `
        + freshPlan.blockers.map((b) => b.message).join(' | '),
        'PLAN_STALE_BLOCKED', freshPlan.blockers,
      );
    }
    const staleFields = Object.keys(plan.fingerprints).filter(
      (key) => JSON.stringify(plan.fingerprints[key]) !== JSON.stringify(freshPlan.fingerprints[key]),
    );
    if (staleFields.length) {
      throw new (ExecutionSvc().TransferDomainError)(
        `El plan "${plan.transactionId}" quedó obsoleto desde que se planificó — cambió: ${staleFields.join(', ')}. Replanifica.`,
        'PLAN_STALE_CONTENT',
      );
    }

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
      runStep(() => { transferRegistry.unregisterTerminationRecord(terminationRecord.id); });
      const terminatedEvent = originContract.addLifecycleEvent({ type: 'terminated', date: effectiveDate, note: `TRANSFER-1:${plan.newObjects.terminationPlan.mechanism}` });
      runStep(() => { originContract.removeLifecycleEvent(terminatedEvent.id); });

      const registeredObligations = plan.obligations.map((line, idx) => {
        const obligation = new TransferEntities.FinancialObligation({ id: `obligation:${plan.transactionId}:${idx}`, transactionId: plan.transactionId, ...line });
        transferRegistry.registerObligation(obligation);
        runStep(() => { transferRegistry.unregisterObligation(obligation.id); });
        return obligation;
      });

      let deactivatedRegistrationId = null;
      if (registrationRegistry && cmd.originRegistrationScopeId) {
        const currentReg = registrationRegistry.currentRegistration(cmd.playerId, cmd.originRegistrationScopeId, cmd.originSeasonKey, effectiveDate);
        if (currentReg) {
          const deactivationEventId = `${currentReg.id}:deactivated:${currentReg.events.length}`;
          const previousReasonCode = currentReg.trace.deactivationReasonCode;
          RegSvc().deactivateRegistration(currentReg, effectiveDate, `TRANSFER-1:${plan.newObjects.terminationPlan.mechanism}`);
          deactivatedRegistrationId = currentReg.id;
          runStep(() => {
            currentReg.removeEvent(deactivationEventId);
            if (previousReasonCode === undefined) delete currentReg.trace.deactivationReasonCode;
            else currentReg.trace.deactivationReasonCode = previousReasonCode;
          });
        }
      }

      const player = playerRegistry.require(cmd.playerId);
      const rosterReport = RosterSvc.releasePlayer({
        playerRegistry, teams, playerId: cmd.playerId, fromTeamId: cmd.originClubId, lineup: deps.lineup,
      });
      runStep(() => {
        const backTeam = (teams || []).find((t) => t.id === rosterReport.fromTeamId);
        if (backTeam) backTeam.addPlayer(player);
        else playerRegistry.setAffiliation(cmd.playerId, rosterReport.fromTeamId);
        rosterReport.restoreOperationalReferences();
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
      runStep(() => { transferRegistry.unregisterTransactionRecord(record.id); });
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
      // LOAN-1 (DESIGN.md 9.21, sección 15 del prompt): reutilizado por
      // LoanExecutionService.js para resolver el `registrationScopeId` de
      // salida/retorno — nunca un segundo cálculo duplicado.
      resolveOriginRegistrationScope,
      formalizeFreeAgentSigning,
      formalizeNegotiatedTransfer,
      formalizeReleaseClauseExercise,
      formalizeMutualAgreement,
      retryScheduledTransferCase,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
