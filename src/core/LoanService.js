// src/core/LoanService.js
// LOAN-1 (DESIGN.md 9.21, sección 10/11 del prompt) — servicio de dominio:
// negociación tripartita (propuesta -> contraoferta -> consentimiento ->
// acuerdo), evaluación determinista de propietario/cesionario/jugador,
// activación/retorno/recall/terminación anticipada (delegadas en
// `LoanExecutionService`) y ejercicio de opción/obligación de compra.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// La UI SOLO llama a este servicio (y a LoanExecutionService) — nunca
// escribe directamente en LoanRegistry/ContractRegistry/
// RegistrationRegistry/Team.roster/player.teamId.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const TransferServiceModule = isNode ? require('./TransferService.js') : global.BasketManager;
  const LoanExecutionServiceModule = isNode ? require('./LoanExecutionService.js') : global.BasketManager;
  const LoanEntities = isNode ? require('../entities/Loan.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function TransferSvc() { return TransferServiceModule.TransferService; }
  function ExecutionSvc() { return LoanExecutionServiceModule.LoanExecutionService; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  const CONSENT_PARTIES = ['ownerClub', 'borrowerClub', 'player'];

  // ---------------------------------------------------------------------
  // Contexto normativo de UNA cesión — resuelve jurisdicción/competición de
  // propietario y cesionario a partir de los clubes REALES (nunca de
  // `team.division` directamente).
  // ---------------------------------------------------------------------
  function buildLoanRulesContext(params) {
    const {
      ownerTeam, borrowerTeam, seasonKey, effectiveDate, returnEffectiveDate, operation, transactionScope, masterContractId,
    } = params;
    const ownerCtx = ContractSvc().resolveEmploymentContext(ownerTeam);
    const borrowerCtx = ContractSvc().resolveEmploymentContext(borrowerTeam);
    return {
      playerId: params.playerId,
      masterContractId: masterContractId || null,
      ownerClubId: ownerTeam.id,
      borrowerClubId: borrowerTeam.id,
      ownerEmployerJurisdictionId: ownerCtx.employerJurisdictionId,
      borrowerEmployerJurisdictionId: borrowerCtx.employerJurisdictionId,
      originCompetitionId: ownerCtx.domesticCompetitionId,
      destinationCompetitionId: borrowerCtx.domesticCompetitionId,
      originFederationId: ownerCtx.federationId,
      destinationFederationId: borrowerCtx.federationId,
      seasonKey,
      effectiveDate,
      returnEffectiveDate: returnEffectiveDate || null,
      transactionScope: transactionScope || 'domestic',
      operation,
    };
  }

  function resolveLoanRules(params) {
    return CompetitionRules.resolveLoanRules(buildLoanRulesContext(params));
  }

  // ---------------------------------------------------------------------
  // Apertura de expediente + primera propuesta (sección 10/11 del prompt).
  // ---------------------------------------------------------------------
  function openCaseAndPropose(params) {
    const {
      loanRegistry, contractRegistry, ownerTeam, borrowerTeam, playerId, initiatingClubId, now, seasonKey,
      serviceStartDate, returnEffectiveDate, loanFee, salaryAllocation, clauses, medicalResponsibility, insuranceResponsibility,
      documentsRequired, expiresAt, authorClubId,
    } = params;
    const masterContract = contractRegistry.currentForPlayer(playerId, toIso(now));
    if (!masterContract) throw new Error('LoanService.openCaseAndPropose: el jugador no tiene contrato vigente con el club propietario.');
    if (masterContract.clubId !== ownerTeam.id) {
      throw new Error('LoanService.openCaseAndPropose: el contrato vigente del jugador no es con el club propietario declarado.');
    }
    if (!masterContract.isActiveOn(toIso(serviceStartDate))) {
      throw new Error('LoanService.openCaseAndPropose: el contrato matriz no está activo en la fecha de inicio de servicio.');
    }
    // Sección 7: la cesión cabe ÍNTEGRA dentro del contrato matriz.
    if (LD().isAfter(returnEffectiveDate, LD().addDays(masterContract.endDate, 1))) {
      throw new Error('LoanService.openCaseAndPropose: "returnEffectiveDate" es posterior a la vigencia del contrato matriz.');
    }
    const resolvedRules = resolveLoanRules({
      playerId, ownerTeam, borrowerTeam, seasonKey, effectiveDate: serviceStartDate, returnEffectiveDate, operation: 'proposal', masterContractId: masterContract.id,
    });
    const loanCaseId = params.id || `loan-case:${playerId}:${ownerTeam.id}:${borrowerTeam.id}:${serviceStartDate}`;
    const loanCase = new LoanEntities.LoanCase({
      id: loanCaseId,
      playerId,
      ownerClubId: ownerTeam.id,
      borrowerClubId: borrowerTeam.id,
      masterContractId: masterContract.id,
      initiatingClubId,
      createdAt: now,
      seasonKey,
      transactionScope: 'domestic',
      rulesSnapshot: resolvedRules.trace,
    });
    loanRegistry.registerCase(loanCase);
    loanCase.addEvent({ id: `${loanCase.id}:proposed`, type: 'proposed', date: toIso(now) });

    const proposal = new LoanEntities.LoanProposal({
      id: params.proposalId || `${loanCase.id}:proposal:1`,
      loanCaseId: loanCase.id,
      version: 1,
      authorClubId: authorClubId || initiatingClubId,
      createdAt: now,
      serviceStartDate,
      returnEffectiveDate,
      expiresAt,
      loanFee,
      salaryAllocation,
      clauses,
      medicalResponsibility,
      insuranceResponsibility,
      documentsRequired,
    });
    loanRegistry.registerProposal(proposal);
    loanCase.currentProposalId = proposal.id;

    return {
      loanCase, proposal, resolvedRules,
    };
  }

  // Contraoferta — SIEMPRE una versión nueva, nunca muta la anterior
  // (invariante 14: cambiar cualquier término invalida consentimientos).
  function counterPropose(params) {
    const {
      loanRegistry, loanCase, authorClubId, now, serviceStartDate, returnEffectiveDate, expiresAt,
      loanFee, salaryAllocation, clauses, medicalResponsibility, insuranceResponsibility, documentsRequired,
    } = params;
    const priorProposals = loanRegistry.proposalsForCase(loanCase.id);
    const parent = priorProposals[priorProposals.length - 1];
    const proposal = new LoanEntities.LoanProposal({
      id: params.proposalId || `${loanCase.id}:proposal:${parent.version + 1}`,
      loanCaseId: loanCase.id,
      version: parent.version + 1,
      parentProposalId: parent.id,
      authorClubId,
      createdAt: now,
      serviceStartDate,
      returnEffectiveDate,
      expiresAt,
      loanFee,
      salaryAllocation,
      clauses,
      medicalResponsibility,
      insuranceResponsibility,
      documentsRequired,
    });
    loanRegistry.registerProposal(proposal);
    loanCase.currentProposalId = proposal.id;
    loanCase.addEvent({ id: `${loanCase.id}:countered:${proposal.version}`, type: 'countered', date: toIso(now) });
    return proposal;
  }

  // ---------------------------------------------------------------------
  // Consentimiento tripartito — ligado SIEMPRE al `termsHash` exacto de la
  // versión viva (invariante 14). Un agente puede transmitir, nunca
  // sustituye el consentimiento del jugador (invariante 13).
  // ---------------------------------------------------------------------
  function grantConsent(params) {
    const {
      loanRegistry, loanCase, partyType, partyId, now, grantedBy, representationMandateId, scope, documentRef,
    } = params;
    if (!CONSENT_PARTIES.includes(partyType)) {
      throw new Error(`LoanService.grantConsent: partyType desconocido "${partyType}".`);
    }
    if (partyType === 'player' && !grantedBy) {
      throw new Error('LoanService.grantConsent: el consentimiento del jugador exige "grantedBy" explícito — un mandato de agente nunca lo sustituye.');
    }
    const liveProposal = loanRegistry.liveProposalForCase(loanCase.id, now);
    if (!liveProposal) throw new Error(`LoanService.grantConsent: no hay ninguna propuesta viva en el expediente "${loanCase.id}".`);
    const consent = new LoanEntities.LoanPartyConsent({
      id: params.id || `${loanCase.id}:consent:${partyType}:${liveProposal.version}`,
      loanCaseId: loanCase.id,
      proposalId: liveProposal.id,
      partyType,
      partyId,
      termsHash: liveProposal.termsHash,
      grantedAt: now,
      grantedBy: grantedBy || partyId,
      representationMandateId: representationMandateId || null,
      scope,
      documentRef,
    });
    loanRegistry.registerConsent(consent);
    advanceCaseConsentStatus(loanCase, loanRegistry, liveProposal, now);
    return consent;
  }

  function missingConsentParties(loanRegistry, loanCase, liveProposal) {
    const live = loanRegistry.consentsLiveForTermsHash(loanCase.id, liveProposal.termsHash).map((c) => c.partyType);
    return CONSENT_PARTIES.filter((party) => !live.includes(party));
  }

  function advanceCaseConsentStatus(loanCase, loanRegistry, liveProposal, date) {
    const missing = missingConsentParties(loanRegistry, loanCase, liveProposal);
    if (!missing.length) return; // formAgreement() emite 'agreed'.
    const nextEventByParty = {
      ownerClub: 'awaiting-owner-consent', borrowerClub: 'awaiting-borrower-consent', player: 'awaiting-player-consent',
    };
    const eventType = nextEventByParty[missing[0]];
    const currentStatus = loanCase.statusOn(null);
    const alreadyThere = {
      'awaiting-owner-consent': 'awaitingOwnerConsent', 'awaiting-borrower-consent': 'awaitingBorrowerConsent', 'awaiting-player-consent': 'awaitingPlayerConsent',
    }[eventType] === currentStatus;
    if (!alreadyThere) {
      loanCase.addEvent({ id: `${loanCase.id}:${eventType}:${loanCase.events.length}`, type: eventType, date: toIso(date) });
    }
  }

  function isReadyToAgree(loanRegistry, loanCase, date) {
    const liveProposal = loanRegistry.liveProposalForCase(loanCase.id, date);
    if (!liveProposal) return false;
    return missingConsentParties(loanRegistry, loanCase, liveProposal).length === 0;
  }

  // ---------------------------------------------------------------------
  // Formación del acuerdo — SOLO cuando los TRES consentimientos coinciden
  // exactamente con la versión viva (invariante "tres consentimientos
  // sobre términos idénticos").
  // ---------------------------------------------------------------------
  function formAgreement(params) {
    const {
      loanRegistry, contractRegistry, loanCase, now,
    } = params;
    const liveProposal = loanRegistry.liveProposalForCase(loanCase.id, now);
    if (!liveProposal) throw new Error(`LoanService.formAgreement: no hay ninguna propuesta viva en el expediente "${loanCase.id}".`);
    const missing = missingConsentParties(loanRegistry, loanCase, liveProposal);
    if (missing.length) {
      throw new Error(`LoanService.formAgreement: faltan consentimientos de ${missing.join(', ')} sobre la versión viva ("${liveProposal.id}").`);
    }
    const masterContract = contractRegistry.get(loanCase.masterContractId);
    const consents = loanRegistry.consentsLiveForTermsHash(loanCase.id, liveProposal.termsHash);

    // Participación legal del jugador sobre el canon (art. 11.3 español u
    // otra jurisdicción) — CONGELADA al formarse el acuerdo, sección 16 del
    // prompt: se calcula EXCLUSIVAMENTE sobre el canon, nunca sobre salario/
    // opción/comisión de agente.
    const rules = params.resolvedRules || null;
    const participationRule = rules && rules.ownerEmploymentLawRules ? rules.ownerEmploymentLawRules.playerParticipationOnFee : null;
    let playerParticipation = null;
    if (liveProposal.loanFee && liveProposal.loanFee.amountMinor > 0 && participationRule && participationRule.appliesWhenFeePositive) {
      const percentBp = participationRule.defaultMinimumPercentBasisPoints || 0;
      playerParticipation = { amountMinor: Math.round((liveProposal.loanFee.amountMinor * percentBp) / 10000), currency: liveProposal.loanFee.currency };
    }

    const agreement = new LoanEntities.LoanAgreement({
      id: params.id || `loan-agreement:${loanCase.id}`,
      loanCaseId: loanCase.id,
      proposalId: liveProposal.id,
      playerId: loanCase.playerId,
      ownerClubId: loanCase.ownerClubId,
      borrowerClubId: loanCase.borrowerClubId,
      masterContractId: loanCase.masterContractId,
      serviceStartDate: liveProposal.serviceStartDate,
      returnEffectiveDate: liveProposal.returnEffectiveDate,
      agreedAt: now,
      loanFee: liveProposal.loanFee,
      playerParticipation,
      salaryAllocation: liveProposal.salaryAllocation,
      jointAndSeveralLiability: rules ? rules.ownerEmploymentLawRules.jointAndSeveralLiability : null,
      medicalResponsibility: liveProposal.medicalResponsibility,
      insuranceResponsibility: liveProposal.insuranceResponsibility,
      clauses: liveProposal.clauses,
      consentIds: consents.map((c) => c.id),
      documentsRequired: liveProposal.documentsRequired,
      rulesSnapshot: rules ? rules.trace : loanCase.rulesSnapshot,
    });
    loanRegistry.registerAgreement(agreement);
    loanCase.agreementId = agreement.id;
    loanCase.addEvent({ id: `${loanCase.id}:agreed`, type: 'agreed', date: toIso(now) });
    void masterContract;
    return agreement;
  }

  // ---------------------------------------------------------------------
  // Activación de salida (sección 14.1) — delega en LoanExecutionService.
  // ---------------------------------------------------------------------
  function buildLoanDestinationRegistration(destinationTeam, seasonKey, date, registrationRegistry) {
    return TransferSvc().buildDestinationRegistrationCommand({
      destinationTeam, seasonKey, date, registrationRegistry,
    });
  }

  function buildLoanObligations(agreement, concept) {
    const lines = [];
    if (concept === 'activation') {
      if (agreement.loanFee && agreement.loanFee.amountMinor > 0) {
        lines.push({
          concept: 'loan-fee', debtorType: 'club', debtorId: agreement.borrowerClubId, creditorType: 'club', creditorId: agreement.ownerClubId,
          amountMinor: agreement.loanFee.amountMinor, currency: agreement.loanFee.currency, legalSource: { ruleModuleId: 'loan-agreement', article: null },
        });
      }
      if (agreement.playerParticipation && agreement.playerParticipation.amountMinor > 0) {
        lines.push({
          concept: 'player-loan-participation', debtorType: 'club', debtorId: agreement.ownerClubId, creditorType: 'player', creditorId: agreement.playerId,
          amountMinor: agreement.playerParticipation.amountMinor, currency: agreement.playerParticipation.currency, legalSource: { ruleModuleId: 'es-rd1006-temporary-assignment-2026-v1', article: 'art. 11.3' },
        });
      }
    }
    return lines;
  }

  function activateLoan(params) {
    const {
      loanRegistry, playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams, agreement,
      ownerTeam, borrowerTeam, now, effectiveDate, seasonKey, operationalContext, lineup, commit,
    } = params;
    const rulesCtx = buildLoanRulesContext({
      playerId: agreement.playerId, ownerTeam, borrowerTeam, seasonKey, effectiveDate, returnEffectiveDate: agreement.returnEffectiveDate, operation: 'activation', masterContractId: agreement.masterContractId,
    });
    const toRegistration = buildLoanDestinationRegistration(borrowerTeam, seasonKey, effectiveDate, registrationRegistry);
    const command = {
      transactionId: params.transactionId || `loan-tx:${agreement.loanCaseId}:activation`,
      movementType: 'activation',
      loanCaseId: agreement.loanCaseId,
      loanAgreementId: agreement.id,
      playerId: agreement.playerId,
      fromClubId: agreement.ownerClubId,
      toClubId: agreement.borrowerClubId,
      effectiveDate,
      seasonKey,
      ownerEmployerJurisdictionId: rulesCtx.ownerEmployerJurisdictionId,
      borrowerEmployerJurisdictionId: rulesCtx.borrowerEmployerJurisdictionId,
      fromCompetitionId: rulesCtx.originCompetitionId,
      toCompetitionId: rulesCtx.destinationCompetitionId,
      fromFederationId: rulesCtx.originFederationId,
      toFederationId: rulesCtx.destinationFederationId,
      transactionScope: rulesCtx.transactionScope,
      fromRegistrationScopeId: params.originRegistrationScopeId || TransferSvc().resolveOriginRegistrationScope(ownerTeam, seasonKey, effectiveDate),
      fromSeasonKey: seasonKey,
      toRegistration,
      obligations: buildLoanObligations(agreement, 'activation'),
    };
    const deps = {
      playerRegistry, contractRegistry, registrationRegistry, transferRegistry, loanRegistry, teams, operationalContext, lineup, now,
    };
    const plan = ExecutionSvc().planTransaction(command, deps);
    if (!plan.isExecutable || !commit) return { plan, result: null };
    const result = ExecutionSvc().commitTransaction(plan, deps);
    return { plan, result };
  }

  // ---------------------------------------------------------------------
  // Retorno programado / recall / terminación anticipada (sección 14.2/14.3)
  // — comparten mecánica, difieren en `movementType` y validación de causa.
  // ---------------------------------------------------------------------
  function returnOrTerminateLoan(params) {
    const {
      loanRegistry, playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams, agreement,
      ownerTeam, borrowerTeam, now, effectiveDate, seasonKey, operationalContext, lineup, commit,
      movementType, recallClauseId, earlyTerminationClauseId, earlyTerminationConsents,
    } = params;
    const rulesCtx = buildLoanRulesContext({
      playerId: agreement.playerId, ownerTeam, borrowerTeam, seasonKey, effectiveDate, returnEffectiveDate: agreement.returnEffectiveDate, operation: movementType, masterContractId: agreement.masterContractId,
    });
    const toRegistration = buildLoanDestinationRegistration(ownerTeam, seasonKey, effectiveDate, registrationRegistry);
    const command = {
      transactionId: params.transactionId || `loan-tx:${agreement.loanCaseId}:${movementType}`,
      movementType,
      loanCaseId: agreement.loanCaseId,
      loanAgreementId: agreement.id,
      playerId: agreement.playerId,
      fromClubId: agreement.borrowerClubId,
      toClubId: agreement.ownerClubId,
      effectiveDate,
      seasonKey,
      ownerEmployerJurisdictionId: ContractSvc().resolveEmploymentContext(ownerTeam).employerJurisdictionId,
      borrowerEmployerJurisdictionId: ContractSvc().resolveEmploymentContext(borrowerTeam).employerJurisdictionId,
      fromCompetitionId: rulesCtx.destinationCompetitionId,
      toCompetitionId: rulesCtx.originCompetitionId,
      fromFederationId: rulesCtx.destinationFederationId,
      toFederationId: rulesCtx.originFederationId,
      transactionScope: rulesCtx.transactionScope,
      fromRegistrationScopeId: params.originRegistrationScopeId || TransferSvc().resolveOriginRegistrationScope(borrowerTeam, seasonKey, effectiveDate),
      fromSeasonKey: seasonKey,
      toRegistration,
      recallClauseId,
      earlyTerminationClauseId,
      earlyTerminationConsents,
      obligations: params.obligations || [],
    };
    const deps = {
      playerRegistry, contractRegistry, registrationRegistry, transferRegistry, loanRegistry, teams, operationalContext, lineup, now,
    };
    const plan = ExecutionSvc().planTransaction(command, deps);
    if (!plan.isExecutable || !commit) return { plan, result: null };
    const result = ExecutionSvc().commitTransaction(plan, deps);
    return { plan, result };
  }

  function returnLoan(params) { return returnOrTerminateLoan({ ...params, movementType: 'return' }); }

  function recallLoan(params) { return returnOrTerminateLoan({ ...params, movementType: 'return' }); }

  function earlyTerminateLoan(params) { return returnOrTerminateLoan({ ...params, movementType: 'early-termination' }); }

  // ---------------------------------------------------------------------
  // Ejercicio de opción/obligación de compra (sección 8.7/17.2/17.3) — NUNCA
  // mueve roster, crea contrato ni obliga al jugador. Solo prepara la vía
  // de TRANSFER-1 (invariante 27).
  //
  // Cuando el comprador (`beneficiaryClubId` de la cláusula) es el propio
  // CESIONARIO — el caso habitual — la instancia YA está en su roster
  // operativo por la cesión: `TransferService.formalizeNegotiatedTransfer()`
  // asume que el club de ORIGEN tiene físicamente al jugador, así que el
  // handoff real (una vez el jugador consiente) se compone de DOS pasos
  // atómicos encadenados, nunca de un tercer motor nuevo: primero
  // `returnLoan()` (misma instancia, vuelve al propietario) y ACTO SEGUIDO
  // el traspaso definitivo normal propietario->cesionario. Cada paso
  // conserva su propio rollback exacto — no hay lógica ad-hoc de "quitar y
  // volver a añadir" fuera de RosterMutationService.
  // ---------------------------------------------------------------------
  function exercisePurchaseOption(params) {
    const {
      loanRegistry, agreement, clauseId, exercisedAt, evidence,
    } = params;
    const clause = agreement.clauses.find((c) => c.id === clauseId && (c.type === 'purchase-option' || c.type === 'purchase-obligation'));
    if (!clause) throw new Error(`LoanService.exercisePurchaseOption: no existe una cláusula de compra "${clauseId}" en el acuerdo "${agreement.id}".`);
    const iso = toIso(exercisedAt);
    if (LD().isBefore(iso, clause.windowStart) || LD().isAfter(iso, clause.windowEnd)) {
      throw new Error('LoanService.exercisePurchaseOption: fuera de la ventana pactada de ejercicio.');
    }
    const exercise = new LoanEntities.PurchaseOptionExercise({
      id: params.id || `purchase-option:${agreement.id}:${clauseId}`,
      loanAgreementId: agreement.id,
      clauseId,
      beneficiaryClubId: clause.beneficiaryClubId === 'owner' ? agreement.ownerClubId : agreement.borrowerClubId,
      exercisedAt,
      price: clause.price,
      window: { startDate: clause.windowStart, endDate: clause.windowEnd },
      evidence: evidence || null,
    });
    loanRegistry.registerOptionExercise(exercise);
    return exercise;
  }

  // ---------------------------------------------------------------------
  // Evaluación determinista de las tres partes (sección 11 del prompt) — sin
  // Math.random(), sin depender del orden del array, nunca revela
  // Potencial/Ambición/Profesionalidad. Un subconjunto REAL y auditable de
  // los criterios listados (profundidad posicional, duración restante,
  // canon, riesgo/edad) — el resto de factores cualitativos listados en la
  // sección 11 (rivalidad, objetivo deportivo detallado, agente) quedan
  // como refinamiento futuro documentado, nunca fingidos aquí.
  // ---------------------------------------------------------------------
  const CPU_LOAN_POLICY_VERSION = 'simulated-cpu-loan-policy-v1';

  function evaluateOwnerClub(params) {
    const {
      ownerTeam, player, masterContract, proposal, careerSeed, date, seasonKey, zeroUtilizationEvidence,
    } = params;
    const fingerprint = `${careerSeed}|loan-owner-eval|${ownerTeam.id}|${player.id}|${proposal.id}|${toIso(date)}`;
    const squadDepthAtPosition = (ownerTeam.roster || []).filter((p) => p.primaryPosition === player.primaryPosition).length;
    const depthScore = Math.min(1, Math.max(0, (squadDepthAtPosition - 2) / 3));
    const remainingSeasons = masterContract ? masterContract.remainingSeasonKeys(seasonKey).length : 0;
    const durationScore = Math.min(1, remainingSeasons / 2);
    const feeScore = proposal.loanFee ? Math.min(1, proposal.loanFee.amountMinor / 5000000) : 0;
    const zeroUtilizationPressure = zeroUtilizationEvidence === true ? 0.3 : 0;

    const acceptScore = (depthScore * 0.4) + (feeScore * 0.35) + (durationScore * 0.1) + zeroUtilizationPressure
      + (Rnd().unitFrom(fingerprint, 'sentiment') * 0.15);
    const acceptThreshold = 0.5 + Rnd().unitFrom(fingerprint, 'threshold') * 0.15;

    const reasons = [];
    let decision;
    if (acceptScore >= acceptThreshold) {
      decision = 'accept';
      reasons.push(depthScore > 0.5 ? 'Hay recambio suficiente en esa posición.' : 'El canon y las condiciones compensan la cesión.');
      if (zeroUtilizationPressure > 0) reasons.push('El jugador apenas ha jugado esta temporada — el club prioriza su desarrollo en otro sitio.');
    } else if (acceptScore >= acceptThreshold - 0.15) {
      decision = 'counter';
      reasons.push('Cerca de un acuerdo, pero pide mejorar el canon o el reparto salarial.');
    } else {
      decision = 'reject';
      reasons.push(depthScore < 0.3 ? 'La plantilla no tiene recambio claro en esa posición.' : 'El club prefiere conservar al jugador esta temporada.');
    }
    return {
      decision, reasons, policyVersion: CPU_LOAN_POLICY_VERSION,
    };
  }

  function evaluateBorrowerClub(params) {
    const {
      borrowerTeam, player, proposal, careerSeed, date,
    } = params;
    const fingerprint = `${careerSeed}|loan-borrower-eval|${borrowerTeam.id}|${player.id}|${proposal.id}|${toIso(date)}`;
    const squadDepthAtPosition = (borrowerTeam.roster || []).filter((p) => p.primaryPosition === player.primaryPosition).length;
    const needScore = Math.min(1, Math.max(0, (2 - squadDepthAtPosition) / 2));
    const costScore = proposal.loanFee ? Math.max(0, 1 - (proposal.loanFee.amountMinor / 8000000)) : 1;

    const acceptScore = (needScore * 0.55) + (costScore * 0.25) + (Rnd().unitFrom(fingerprint, 'sentiment') * 0.20);
    const acceptThreshold = 0.45 + Rnd().unitFrom(fingerprint, 'threshold') * 0.15;

    const reasons = [];
    let decision;
    if (acceptScore >= acceptThreshold) {
      decision = 'accept';
      reasons.push(needScore > 0.5 ? 'La plantilla necesita refuerzo real en esa posición.' : 'El coste asumido encaja en el presupuesto.');
    } else if (acceptScore >= acceptThreshold - 0.15) {
      decision = 'counter';
      reasons.push('Interesados, pero piden reducir el canon o el coste asumido.');
    } else {
      decision = 'reject';
      reasons.push(needScore < 0.3 ? 'No hay necesidad real en esa posición ahora mismo.' : 'El coste asumido es demasiado alto para este proyecto.');
    }
    return {
      decision, reasons, policyVersion: CPU_LOAN_POLICY_VERSION,
    };
  }

  function evaluatePlayerReaction(params) {
    const {
      player, proposal, borrowerTeam, careerSeed, date,
    } = params;
    const fingerprint = `${careerSeed}|loan-player-eval|${player.id}|${proposal.id}|${toIso(date)}`;
    const promisedRole = proposal.clauses.find((c) => c.type === 'promised-role');
    // Nunca `team.division` como clave normativa — la competición del
    // cesionario se resuelve por `competitionId` (mismo adaptador legacy
    // que el resto de la EPIC), nunca comparando el string de división.
    const borrowerCompetitionId = CompetitionRules.competitionIdFromLegacyDivision(borrowerTeam.division);
    const divisionBonus = borrowerCompetitionId === CompetitionRules.COMPETITION_IDS.ACB ? 0.15 : 0;
    const acceptScore = 0.45 + (promisedRole ? 0.2 : 0) + divisionBonus + (Rnd().unitFrom(fingerprint, 'sentiment') * 0.25);
    const decision = acceptScore >= 0.55 ? 'accept' : 'reject';
    const reasons = [];
    if (promisedRole) reasons.push('Valora el rol prometido en el nuevo club.');
    if (divisionBonus > 0) reasons.push('La cesión mantiene el nivel competitivo deseado.');
    if (decision === 'reject' && !reasons.length) reasons.push('El jugador prefiere quedarse y pelear su sitio en el club actual.');
    return {
      decision, reasons, policyVersion: CPU_LOAN_POLICY_VERSION,
    };
  }

  const exportsObj = {
    LoanService: {
      CPU_LOAN_POLICY_VERSION,
      buildLoanRulesContext,
      resolveLoanRules,
      openCaseAndPropose,
      counterPropose,
      grantConsent,
      isReadyToAgree,
      formAgreement,
      activateLoan,
      returnLoan,
      recallLoan,
      earlyTerminateLoan,
      exercisePurchaseOption,
      evaluateOwnerClub,
      evaluateBorrowerClub,
      evaluatePlayerReaction,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
