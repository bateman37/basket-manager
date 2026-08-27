// src/core/TransferExecutionService.js
// TRANSFER-1 (DESIGN.md 9.20, sección 13 del prompt) — orquestador ATÓMICO:
// plan puro -> revalidación -> commit/rollback exacto. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// `planTransaction()` NUNCA muta nada, no lee `state` global, no consume
// aleatoriedad. `commitTransaction()` es el ÚNICO punto que aplica
// mutaciones reales, en el orden de la sección 13.4, y las revierte
// EXACTAMENTE si cualquier paso lanza (patrón de "saga": cada paso que
// muta devuelve su propio `undo`, ejecutado en orden inverso ante fallo).
//
// Mecanismos soportados en esta entrega: fichaje de libre (incluye
// futuro/programado), traspaso definitivo negociado, ejercicio de
// cláusula de rescisión y terminación (mutuo acuerdo / con causa /
// voluntad del jugador — mismo planificador, distinto `mechanism` y
// artefactos exigidos). LOAN-1/CYCLE-1/EUROPE-1 quedan fuera.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const ContractModule = isNode ? require('../entities/Contract.js') : global.BasketManager;
  const RegistrationServiceModule = isNode ? require('./RegistrationService.js') : global.BasketManager;
  const RosterMutationServiceModule = isNode ? require('./RosterMutationService.js') : global.BasketManager;
  const TransferEntities = isNode ? require('../entities/Transfer.js') : global.BasketManager;
  const CanonicalHashModule = isNode ? require('../utils/CanonicalHash.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function RegSvc() { return RegistrationServiceModule.RegistrationService; }
  function RosterSvc() { return RosterMutationServiceModule.RosterMutationService; }

  function toIso(date) {
    if (!date) throw new Error('TransferExecutionService: hace falta una fecha.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  class TransferDomainError extends Error {
    constructor(message, code, blockers) {
      super(message);
      this.code = code || 'TRANSFER_BLOCKED';
      this.blockers = blockers || [{ code: this.code, message }];
    }
  }

  // BUG-TRANSFER1-17 (DESIGN.md 9.21): serialización canónica recursiva y
  // hash determinista — extraídos a `src/utils/CanonicalHash.js` para que
  // LoanExecutionService.js (LOAN-1) los reutilice sin duplicar la misma
  // lógica (sección 14 del prompt de LOAN-1: "no dupliques la saga").
  function stableHash(value) { return CanonicalHashModule.CanonicalHash.stableHash(value); }

  // ---------------------------------------------------------------------
  // Compensación por renuncia de derechos ACB (sección 11.7 del prompt) —
  // función PURA sobre los tramos resueltos por CompetitionRules
  // (`rightsCompensationRules.ageBands`). Nunca conocida como "impuesto
  // universal": solo se invoca cuando el origen la declara (ACB).
  // ---------------------------------------------------------------------
  function computeRightsWaiverCompensation(rightsCompensationRules, ageOnComputationDate, newContractAnnualAverageMinor) {
    if (!rightsCompensationRules) return null;
    const band = rightsCompensationRules.ageBands.find((b) => (
      (b.maxAgeInclusive === undefined || ageOnComputationDate <= b.maxAgeInclusive)
      && (b.minAgeInclusive === undefined || ageOnComputationDate >= b.minAgeInclusive)
    ));
    if (!band) return { amountMinor: 0, applicable: false, reason: `Edad ${ageOnComputationDate} fuera de los tramos de edad declarados.` };
    let remaining = newContractAnnualAverageMinor;
    let previousThreshold = 0;
    let totalMinor = 0;
    const breakdown = [];
    band.tiers.forEach((tier) => {
      if (remaining <= 0) return;
      const sliceCeiling = tier.uptoAnnualMinor === null ? Infinity : tier.uptoAnnualMinor;
      const sliceWidth = Math.max(0, sliceCeiling - previousThreshold);
      const sliceAmount = Math.min(remaining, sliceWidth);
      const sliceCompMinor = Math.round((sliceAmount * tier.percentBasisPoints) / 10000);
      if (sliceAmount > 0) {
        breakdown.push({ fromMinor: previousThreshold, toMinor: tier.uptoAnnualMinor, percentBasisPoints: tier.percentBasisPoints, sliceAmountMinor: sliceAmount, compensationMinor: sliceCompMinor });
        totalMinor += sliceCompMinor;
      }
      remaining -= sliceAmount;
      previousThreshold = sliceCeiling;
    });
    return {
      amountMinor: totalMinor, currency: rightsCompensationRules.currency, applicable: true, breakdown, ageOnComputationDate, newContractAnnualAverageMinor,
    };
  }

  // ---------------------------------------------------------------------
  // Helpers de resolución (leen SOLO lo que se les pasa explícito).
  // ---------------------------------------------------------------------
  function requireLiveAgreement(marketRegistry, agreementInPrincipleId, effectiveDate) {
    const agreement = marketRegistry.getAgreement(agreementInPrincipleId);
    if (!agreement) throw new TransferDomainError(`No existe el Acuerdo en Principio "${agreementInPrincipleId}".`, 'AIP_NOT_FOUND');
    if (!agreement.isLiveOn(effectiveDate)) {
      throw new TransferDomainError(
        `El Acuerdo en Principio "${agreementInPrincipleId}" no está vivo a ${effectiveDate} (estado: ${agreement.statusOn(effectiveDate)}).`,
        'AIP_NOT_LIVE',
      );
    }
    return agreement;
  }

  function ageOnDate(player, isoDate) {
    return ContractSvc().ageOnDate(player, isoDate);
  }

  // ---------------------------------------------------------------------
  // 1. PLAN — fase pura. `command` esperado (sección 8.1/13.1):
  //   { transactionId, operationType, mechanism, playerId, originClubId,
  //     destinationClubId, effectiveDate, seasonKey, agreementInPrincipleId,
  //     transferAgreementId?, releaseClauseExerciseId?, clauseId?,
  //     mutualSettlement?, verifiedCauseRecordId?, rightsOutcomeId?,
  //     documentStatuses? }
  // `deps`: { playerRegistry, contractRegistry, registrationRegistry,
  //   marketRegistry, transferRegistry, teams, now }
  // ---------------------------------------------------------------------
  function planTransaction(command, deps) {
    const cmd = command || {};
    const {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams,
    } = deps || {};
    ['transactionId', 'operationType', 'playerId', 'destinationClubId', 'effectiveDate', 'agreementInPrincipleId'].forEach((field) => {
      if (!cmd[field]) throw new Error(`TransferExecutionService.planTransaction: falta "${field}" en el comando.`);
    });
    const effectiveDate = toIso(cmd.effectiveDate);
    const warnings = [];
    const blockers = [];
    const preconditions = [];

    function check(label, ok, blockerCode) {
      preconditions.push({ label, ok });
      if (!ok) blockers.push({ code: blockerCode || 'PRECONDITION_FAILED', message: label });
      return ok;
    }

    // -- Identidad canónica ------------------------------------------------
    const player = playerRegistry.get(cmd.playerId);
    check(`El jugador "${cmd.playerId}" existe en el Player Registry mundial.`, Boolean(player), 'PLAYER_NOT_FOUND');
    const destinationTeam = (teams || []).find((t) => t.id === cmd.destinationClubId);
    check(`El club de destino "${cmd.destinationClubId}" existe entre los equipos vivos.`, Boolean(destinationTeam), 'DESTINATION_CLUB_NOT_FOUND');
    if (!player || !destinationTeam) {
      return new TransferEntities.TransferExecutionPlan({
        transactionId: cmd.transactionId, command: cmd, preconditions, fingerprints: {}, operations: [], blockers, warnings, hash: stableHash(cmd), builtAt: effectiveDate,
      });
    }

    // -- AIP vivo y coherente ------------------------------------------------
    let agreement = null;
    try {
      agreement = requireLiveAgreement(marketRegistry, cmd.agreementInPrincipleId, effectiveDate);
      check('El AIP referenciado está vivo y coincide con el jugador/club.', agreement.playerId === cmd.playerId && agreement.clubId === cmd.destinationClubId, 'AIP_MISMATCH');
    } catch (err) {
      blockers.push({ code: err.code || 'AIP_ERROR', message: err.message });
    }
    const acceptedOffer = agreement ? marketRegistry.getOffer(agreement.acceptedOfferId) : null;
    check('La oferta salarial aceptada del AIP existe.', Boolean(acceptedOffer), 'OFFER_NOT_FOUND');

    // -- Contexto operacional obligatorio (BUG-TRANSFER1-16, DESIGN.md
    //    9.21) — `pendingUserMatchBlocks` era un booleano OPCIONAL que
    //    ningún llamador real de game.js pasaba nunca: `undefined` se leía
    //    como "falso", así que la protección de "partido en curso" solo
    //    funcionaba en fixtures de test. Ahora es un `operationalContext`
    //    EXPLÍCITO y obligatorio — su ausencia BLOQUEA (nunca se asume "sin
    //    partido pendiente" por defecto).
    const hasOperationalContext = Boolean(deps.operationalContext) && typeof deps.operationalContext.pendingUserMatchBlocks === 'boolean';
    check('Existe un contexto operacional explícito (¿hay un partido del usuario iniciado o pendiente de revelar?).', hasOperationalContext, 'MISSING_OPERATIONAL_CONTEXT');
    if (hasOperationalContext && deps.operationalContext.pendingUserMatchBlocks) {
      blockers.push({ code: 'PENDING_USER_MATCH', message: 'Hay un partido del usuario iniciado o pendiente de revelar que usa la plantilla — bloquea la mutación de roster.' });
    }

    // -- Reglas de transferencia (dominio `transfer`) ------------------------
    let resolvedTransferRules = null;
    if (destinationTeam && cmd.destinationEmployerJurisdictionId && cmd.originEmployerJurisdictionId) {
      try {
        resolvedTransferRules = CompetitionRules.resolveTransferRules({
          playerId: cmd.playerId,
          originClubId: cmd.originClubId || cmd.destinationClubId,
          destinationClubId: cmd.destinationClubId,
          originEmployerJurisdictionId: cmd.originEmployerJurisdictionId,
          destinationEmployerJurisdictionId: cmd.destinationEmployerJurisdictionId,
          originCompetitionId: cmd.originCompetitionId || null,
          destinationCompetitionId: cmd.destinationCompetitionId || null,
          federationId: cmd.federationId || null,
          seasonKey: cmd.seasonKey,
          effectiveDate,
          operationType: cmd.operationType,
          mechanism: cmd.mechanism || cmd.operationType,
          transactionScope: cmd.transactionScope || 'domestic',
        });
      } catch (err) {
        blockers.push({ code: 'TRANSFER_RULES_ERROR', message: err.message });
      }
      if (resolvedTransferRules && resolvedTransferRules.blockers.length) {
        resolvedTransferRules.blockers.forEach((b) => blockers.push(b));
      }
    }

    // -- Contrato de origen ---------------------------------------------------
    const originContract = contractRegistry.currentForPlayer(cmd.playerId, effectiveDate);
    const expectsOriginContract = ['negotiated-transfer', 'release-clause-exercise', 'mutual-agreement', 'employer-termination', 'player-withdrawal', 'verified-cause-termination'].includes(cmd.operationType);
    if (expectsOriginContract) {
      check(`El jugador tiene un contrato vigente/pendiente a ${effectiveDate} con el club de origen.`, Boolean(originContract), 'NO_ORIGIN_CONTRACT');
      if (originContract && cmd.originClubId) {
        check('El contrato de origen es con el club de origen declarado.', originContract.clubId === cmd.originClubId, 'ORIGIN_CONTRACT_CLUB_MISMATCH');
      }
    } else if (originContract) {
      check('Un fichaje de libre no puede tener un contrato vigente/pendiente con OTRO club en la fecha efectiva.', false, 'PLAYER_NOT_FREE');
    }

    // -- Construcción de la terminación + nuevo contrato (por mecanismo) -----
    let terminationPlan = null;
    let newContract = null;
    let contractValidation = null;
    if (blockers.length === 0 || cmd.operationType) {
      // Se construye igualmente el resto para exponer TODOS los blockers
      // detectables (sección 13.1: "devuelve plan inmutable, blockers y
      // warnings" — no se detiene en el primero salvo dependencia dura).
      if (acceptedOffer) {
        contractValidation = ContractSvc().validateDraft({
          draft: acceptedOffer.contractDraft,
          team: destinationTeam,
          player,
          playerRegistry,
          contractRegistry,
          seasonKey: cmd.seasonKey,
          date: effectiveDate,
        });
        check('El borrador de contrato aceptado revalida contra las reglas normativas actuales.', contractValidation.valid, 'CONTRACT_INVALID');
        if (contractValidation.valid) newContract = contractValidation.contract;
      }

      if (expectsOriginContract && originContract) {
        terminationPlan = planTerminationStep(cmd, originContract, player, blockers, check);
      }
    }

    // -- Compensación por renuncia de derechos (sección 11.7) ---------------
    let rightsCompensation = null;
    if (cmd.rightsOutcomeId && resolvedTransferRules && resolvedTransferRules.rightsCompensationRules && newContract) {
      const rightsCase = marketRegistry.getRightsCase(cmd.rightsOutcomeId);
      if (rightsCase && rightsCase.playerId === cmd.playerId) {
        const age = ageOnDate(player, effectiveDate);
        const avgAnnualMinor = Math.round(
          newContract.coveredSeasonKeys.reduce((sum, sk) => sum + newContract.breakdownForSeason(sk).guaranteedTotalMinor, 0)
          / Math.max(1, newContract.coveredSeasonKeys.length),
        );
        rightsCompensation = computeRightsWaiverCompensation(resolvedTransferRules.rightsCompensationRules, age, avgAnnualMinor);
      }
    }

    // -- Documentos/registro de destino (validación de disponibilidad, sin
    //    mutar: la creación real ocurre en commit) -----------------------
    if (registrationRegistry && cmd.registrationScopeId) {
      const currentCumulative = registrationRegistry.cumulativeCountForClub(cmd.destinationClubId, cmd.registrationScopeId, cmd.seasonKey);
      const cap = resolvedTransferRules && resolvedTransferRules.destinationRegistrationRules
        ? resolvedTransferRules.destinationRegistrationRules.cumulativeRegistrationCapReference : null;
      if (cmd.cumulativeRegistrationCapMax !== undefined && cmd.cumulativeRegistrationCapMax !== null) {
        check(`El club de destino no ha agotado el cupo acumulado de inscripción declarado (${currentCumulative}/${cmd.cumulativeRegistrationCapMax}).`,
          currentCumulative < cmd.cumulativeRegistrationCapMax, 'REGISTRATION_CAP_EXCEEDED');
      }
      void cap;
    }

    // -- Obligaciones económicas (líneas SEPARADAS, sección 9.6) -------------
    const obligations = [];
    if (terminationPlan && terminationPlan.mechanism === 'mutual-transfer' && cmd.transferAgreement) {
      const fee = cmd.transferAgreement.fee;
      obligations.push({
        concept: 'transfer-fee', debtorType: 'club', debtorId: cmd.destinationClubId, creditorType: 'club', creditorId: cmd.originClubId,
        amountMinor: fee.amountMinor, currency: fee.currency, legalSource: { ruleModuleId: 'transfer-agreement', article: null },
      });
      if (resolvedTransferRules && resolvedTransferRules.playerParticipationRules.negotiatedTransfer
        && resolvedTransferRules.playerParticipationRules.negotiatedTransfer.defaultMinimumPercentBasisPoints) {
        const participationRule = resolvedTransferRules.playerParticipationRules.negotiatedTransfer;
        const pactPercentBp = cmd.transferAgreement.playerParticipationPercentBasisPoints;
        const percentBp = pactPercentBp !== undefined && pactPercentBp !== null
          ? pactPercentBp : participationRule.defaultMinimumPercentBasisPoints;
        if (!pactPercentBp && !participationRule.overridableByExplicitPact) {
          check('El 15% del art. 13.a no puede reducirse sin pacto explícito.', percentBp >= participationRule.defaultMinimumPercentBasisPoints, 'PARTICIPATION_BELOW_STATUTORY_MINIMUM');
        }
        if (pactPercentBp !== undefined && pactPercentBp !== null && !participationRule.overridableByExplicitPact) {
          check('La participación mínima estatutaria no puede pactarse por debajo del mínimo legal.', pactPercentBp >= participationRule.defaultMinimumPercentBasisPoints, 'PARTICIPATION_BELOW_STATUTORY_MINIMUM');
        } else if (pactPercentBp !== undefined && pactPercentBp !== null) {
          check('La participación pactada no puede ser inferior al mínimo legal sin pacto explícito distinto declarado.', pactPercentBp >= 0, 'PARTICIPATION_NEGATIVE');
        }
        const participationMinor = Math.round((fee.amountMinor * percentBp) / 10000);
        if (participationMinor > 0) {
          obligations.push({
            concept: 'player-transfer-participation', debtorType: 'club', debtorId: cmd.originClubId, creditorType: 'player', creditorId: cmd.playerId,
            amountMinor: participationMinor, currency: fee.currency, legalSource: { ruleModuleId: participationRule.sourceModuleId, article: 'art. 13.a' },
          });
        }
      }
    }
    if (terminationPlan && terminationPlan.mechanism === 'player-release-clause' && cmd.releaseClauseAmount) {
      obligations.push({
        concept: 'release-clause-amount', debtorType: cmd.releaseClauseExercisedBy === 'player' ? 'player' : 'club',
        debtorId: cmd.releaseClauseExercisedBy === 'player' ? cmd.playerId : (cmd.releaseClausePayerClubId || cmd.destinationClubId),
        creditorType: 'club', creditorId: cmd.originClubId,
        amountMinor: cmd.releaseClauseAmount.amountMinor, currency: cmd.releaseClauseAmount.currency,
        legalSource: { ruleModuleId: 'contract-clause', article: cmd.clauseId },
      });
    }
    if (terminationPlan && terminationPlan.mechanism === 'mutual-release' && cmd.mutualSettlement && cmd.mutualSettlement.amount) {
      obligations.push({
        concept: 'mutual-termination-settlement', debtorType: 'club', debtorId: cmd.originClubId, creditorType: 'player', creditorId: cmd.playerId,
        amountMinor: cmd.mutualSettlement.amount.amountMinor, currency: cmd.mutualSettlement.amount.currency,
        legalSource: { ruleModuleId: 'mutual-agreement', article: null },
      });
    }
    if (terminationPlan && terminationPlan.mechanism === 'employer-termination' && cmd.employerTerminationCompensation) {
      obligations.push({
        concept: 'employer-termination-compensation', debtorType: 'club', debtorId: cmd.originClubId, creditorType: 'player', creditorId: cmd.playerId,
        amountMinor: cmd.employerTerminationCompensation.amountMinor, currency: cmd.employerTerminationCompensation.currency,
        legalSource: { ruleModuleId: 'employer-termination-pact', article: null },
      });
    }
    if (rightsCompensation && rightsCompensation.applicable && rightsCompensation.amountMinor > 0) {
      obligations.push({
        concept: 'rights-waiver-compensation', debtorType: 'club', debtorId: cmd.destinationClubId, creditorType: 'club', creditorId: cmd.originClubId,
        amountMinor: rightsCompensation.amountMinor, currency: rightsCompensation.currency,
        legalSource: { ruleModuleId: 'acb-transfer-membership-2026-27-provisional-v1', article: 'art. 16' },
        calculationTrace: rightsCompensation,
        schedule: newContract ? newContract.coveredSeasonKeys.map((sk, idx) => ({
          dueDate: newContract.compensationForSeason(sk) ? LD().seasonWindow(sk).startDate : effectiveDate,
          amountMinor: M().allocate(rightsCompensation.amountMinor, newContract.coveredSeasonKeys.length)[idx],
          currency: rightsCompensation.currency,
        })) : [],
      });
    }

    // -- Fingerprints (revalidación en commit) -------------------------------
    // BUG-TRANSFER1-17 (DESIGN.md 9.21): antes solo cubrían 4 campos
    // SUPERFICIALES (estado del AIP, número de contratos, id del contrato
    // de origen, longitud del roster de destino) — un cambio de CONTENIDO
    // que conserva esos conteos pasaba inadvertido: sustituir un jugador
    // por otro en el roster sin cambiar su tamaño, añadir un evento al
    // contrato de origen, cambiar el contenido de la oferta/AIP sin
    // cambiar su estado derivado, cambiar las reservas de presupuesto,
    // cambiar el módulo normativo resuelto... Ahora son un fingerprint de
    // CONTENIDO (ids/eventos/hash canónico), comparado con `stableHash()`
    // recursivo — nunca solo conteos.
    const fingerprints = {
      agreementStatus: agreement ? agreement.statusOn(effectiveDate) : null,
      agreementContentHash: agreement ? stableHash(agreement.toJSON ? agreement.toJSON() : { id: agreement.id, events: agreement.events }) : null,
      acceptedOfferContentHash: acceptedOffer ? stableHash(acceptedOffer.toJSON ? acceptedOffer.toJSON() : acceptedOffer) : null,
      budgetReservationGroupHash: (agreement && agreement.budgetReservationGroupId && marketRegistry.getBudgetReservationGroup)
        ? stableHash(marketRegistry.getBudgetReservationGroup(agreement.budgetReservationGroupId))
        : null,
      contractRegistryPlayerContractIds: contractRegistry.forPlayer(cmd.playerId).map((c) => c.id),
      originContractId: originContract ? originContract.id : null,
      originContractLifecycleHash: originContract ? stableHash(originContract.lifecycleEvents) : null,
      destinationRosterPlayerIds: destinationTeam.roster.map((p) => p.id).sort(),
      destinationCumulativeRegistrationCount: (registrationRegistry && cmd.registrationScopeId)
        ? registrationRegistry.cumulativeCountForClub(cmd.destinationClubId, cmd.registrationScopeId, cmd.seasonKey)
        : null,
      resolvedTransferRulesHash: resolvedTransferRules ? stableHash(resolvedTransferRules.trace) : null,
      pendingUserMatchBlocks: hasOperationalContext ? deps.operationalContext.pendingUserMatchBlocks : null,
    };

    // -- Programada para el futuro (sección 11.2) ---------------------------
    const isFutureSigning = deps.now && LD().isAfter(effectiveDate, toIso(deps.now));

    return new TransferEntities.TransferExecutionPlan({
      transactionId: cmd.transactionId,
      command: cmd,
      preconditions,
      fingerprints,
      operations: [
        'reserve-transaction-id', 'register-termination-and-obligations', 'register-new-contract',
        'apply-origin-deregistration', 'move-roster', 'create-destination-registration',
        'consume-reservations-and-aip', 'register-transaction-record', 'publish-news',
      ],
      newObjects: {
        contract: newContract,
        terminationPlan,
        agreement,
        acceptedOffer,
        resolvedTransferRules,
        rightsCompensation,
        isFutureSigning,
      },
      referenceCleanupPlan: ['lineup.squadIds', 'rotation.entries', 'trainingPlan.individualFocuses', 'tacticalProfile.roleAssignments'],
      obligations,
      blockers,
      warnings,
      hash: stableHash({ transactionId: cmd.transactionId, operationType: cmd.operationType, playerId: cmd.playerId, destinationClubId: cmd.destinationClubId, effectiveDate }),
      builtAt: effectiveDate,
    });
  }

  // Construye (sin registrar) la terminación del contrato de origen según
  // el mecanismo declarado — devuelve `{ mechanism, ...datos }` o añade
  // blockers si faltan artefactos obligatorios (sección 11.6: nunca se
  // inventa una causa/cifra).
  function planTerminationStep(cmd, originContract, player, blockers, check) {
    const mechanism = {
      'negotiated-transfer': 'mutual-transfer',
      'release-clause-exercise': 'player-release-clause',
      'mutual-agreement': cmd.destinationClubId && cmd.destinationClubId !== cmd.originClubId ? 'mutual-transfer' : 'mutual-release',
      'employer-termination': 'employer-termination',
      'player-withdrawal': 'player-withdrawal',
      'verified-cause-termination': 'verified-cause',
    }[cmd.operationType];
    if (!mechanism) return null;

    if (mechanism === 'mutual-transfer' && cmd.operationType === 'negotiated-transfer') {
      check('Existe un TransferAgreement con la oferta club-club aceptada.', Boolean(cmd.transferAgreement), 'MISSING_TRANSFER_AGREEMENT');
      check('El jugador ha dado consentimiento expreso al traspaso.', Boolean(cmd.transferAgreement && cmd.transferAgreement.playerConsent), 'MISSING_PLAYER_CONSENT');
    }
    if (mechanism === 'player-release-clause') {
      check('La cláusula de rescisión está tipada, activa y con importe determinable.', Boolean(cmd.clauseId && cmd.releaseClauseAmount), 'MISSING_RELEASE_CLAUSE');
      const clause = originContract.clauses.find((c) => c.id === cmd.clauseId && c.type === 'player-release');
      check('La cláusula referenciada existe en el contrato de origen y es de tipo "player-release".', Boolean(clause), 'RELEASE_CLAUSE_NOT_FOUND');
      if (clause && cmd.releaseClauseAmount) {
        check('El importe ejercido coincide con el importe congelado de la cláusula.', clause.amount && clause.amount.amountMinor === cmd.releaseClauseAmount.amountMinor, 'RELEASE_CLAUSE_AMOUNT_MISMATCH');
      }
      if (cmd.registrationRestrictionAfterMonthDay && cmd.effectiveDate) {
        const { month, day } = LD().parse(toIso(cmd.effectiveDate));
        const [restrictMonth, restrictDay] = cmd.registrationRestrictionAfterMonthDay.split('-').map(Number);
        const isAfterRestriction = month > restrictMonth || (month === restrictMonth && day > restrictDay);
        if (isAfterRestriction) blockers.push({ code: 'RELEASE_CLAUSE_REGISTRATION_RESTRICTED', message: `Cláusula ejercida después del ${cmd.registrationRestrictionAfterMonthDay} — restricción de inscripción ACB aplicable.` });
      }
    }
    if (mechanism === 'mutual-release' || (mechanism === 'mutual-transfer' && cmd.operationType === 'mutual-agreement')) {
      check('Existe un acuerdo de mutuo acuerdo explícito (partes, fecha, importe/fuente).', Boolean(cmd.mutualSettlement && cmd.mutualSettlement.partiesConsent), 'MISSING_MUTUAL_SETTLEMENT');
    }
    if (mechanism === 'employer-termination') {
      check('La terminación por causa del empleador declara un pacto o resolución explícita — nunca se inventa la decisión judicial.', Boolean(cmd.employerTerminationCompensation || cmd.verifiedCauseRecordId), 'MISSING_EMPLOYER_TERMINATION_BASIS');
    }
    if (mechanism === 'player-withdrawal') {
      check('La extinción unilateral del jugador exige pacto explícito o ExternalResolution — nunca se inventa la indemnización.', Boolean(cmd.mutualSettlement || cmd.verifiedCauseRecordId), 'MISSING_WITHDRAWAL_BASIS');
    }
    if (mechanism === 'verified-cause') {
      check('La causa controvertida exige un ExternalResolution/VerifiedCauseRecord de fixture explícito.', Boolean(cmd.verifiedCauseRecordId), 'MISSING_VERIFIED_CAUSE');
    }

    // La comprobación de partido en curso/pendiente ya se hizo una única
    // vez en `planTransaction()` (BUG-TRANSFER1-16) — repetirla aquí sería
    // el mismo blocker duplicado dos veces en la lista.

    return { mechanism, originContractId: originContract.id };
  }

  // ---------------------------------------------------------------------
  // 2/3. REVALIDACIÓN + COMMIT/ROLLBACK — sección 13.2/13.3/13.4.
  // ---------------------------------------------------------------------
  function commitTransaction(plan, deps) {
    const {
      playerRegistry, contractRegistry, registrationRegistry, marketRegistry, transferRegistry, teams,
    } = deps || {};

    // Idempotencia (sección 13.5): repetir el mismo transactionId devuelve
    // SIEMPRE el mismo resultado, nunca duplica nada.
    const already = transferRegistry.completedTransaction(plan.transactionId);
    if (already) return { record: already, idempotent: true };

    if (!plan.isExecutable) {
      throw new TransferDomainError(
        `TransferExecutionService.commitTransaction: el plan "${plan.transactionId}" tiene blockers sin resolver: `
        + plan.blockers.map((b) => b.message).join(' | '),
        'PLAN_HAS_BLOCKERS', plan.blockers,
      );
    }

    const cmd = plan.command;
    const effectiveDate = toIso(cmd.effectiveDate);

    // Fichaje futuro (sección 11.2): no se ejecuta antes de su fecha —
    // nunca saca al jugador del roster ni desactiva su inscripción actual
    // por adelantado.
    if (deps.now && LD().isAfter(effectiveDate, toIso(deps.now))) {
      return { record: null, notYetDue: true, effectiveDate };
    }

    // Revalidación de fingerprints (sección 13.2, BUG-TRANSFER1-13/17,
    // DESIGN.md 9.21) — "replan-at-commit": la versión anterior comparaba
    // 4 campos SUPERFICIALES (estado del AIP, número de contratos, id del
    // contrato de origen, longitud del roster de destino) contra el estado
    // actual, así que un cambio de CONTENIDO que conservara esos conteos
    // pasaba inadvertido. Ahora se vuelve a ejecutar `planTransaction()`
    // con el MISMO comando contra el estado REAL de este instante y se
    // compara el fingerprint de CONTENIDO resultante campo a campo — un
    // plan obsoleto se rechaza explícito, nunca se ejecuta a ciegas el
    // plan viejo. El resto del commit usa SIEMPRE `resolvedPlan` (el plan
    // recién recalculado), nunca el `plan` recibido por parámetro.
    if (!deps.operationalContext || typeof deps.operationalContext.pendingUserMatchBlocks !== 'boolean') {
      throw new TransferDomainError('TransferExecutionService.commitTransaction: falta "operationalContext" explícito en las dependencias.', 'MISSING_OPERATIONAL_CONTEXT');
    }
    const freshPlan = planTransaction(cmd, deps);
    if (!freshPlan.isExecutable) {
      throw new TransferDomainError(
        `El plan "${plan.transactionId}" ya no es ejecutable al revalidar contra el estado actual: `
        + freshPlan.blockers.map((b) => b.message).join(' | '),
        'PLAN_STALE_BLOCKED', freshPlan.blockers,
      );
    }
    const staleFields = Object.keys(plan.fingerprints).filter(
      (key) => stableHash(plan.fingerprints[key]) !== stableHash(freshPlan.fingerprints[key]),
    );
    if (staleFields.length) {
      throw new TransferDomainError(
        `El plan "${plan.transactionId}" quedó obsoleto desde que se planificó — cambió: ${staleFields.join(', ')}. Replanifica.`,
        'PLAN_STALE_CONTENT',
      );
    }
    const resolvedPlan = freshPlan;
    const agreement = marketRegistry.getAgreement(cmd.agreementInPrincipleId);
    const destinationTeam = (teams || []).find((t) => t.id === cmd.destinationClubId);

    // --- Commit por pasos con "undo" acumulado (saga) -----------------------
    // Cada paso muta primero y ACTO SEGUIDO registra su propio cierre de
    // reversión exacta — `registerUndo()` solo ALMACENA ese cierre, nunca
    // lo ejecuta (si lo ejecutara aquí, deshacería el paso que se acaba de
    // aplicar en vez de guardarlo para un fallo POSTERIOR).
    const undoStack = [];
    function registerUndo(fn) { undoStack.push(fn); }

    try {
      const { contract, terminationPlan } = resolvedPlan.newObjects;
      const player = playerRegistry.require(cmd.playerId);
      const originTeam = cmd.originClubId ? (teams || []).find((t) => t.id === cmd.originClubId) : null;

      // 1) reservar transactionId — ya comprobado arriba (idempotencia).

      // 2) registrar terminación + obligaciones ya validadas.
      let terminationRecord = null;
      if (terminationPlan) {
        const originContract = contractRegistry.currentForPlayer(cmd.playerId, effectiveDate);
        terminationRecord = new TransferEntities.ContractTerminationRecord({
          id: `termination:${plan.transactionId}`,
          contractId: originContract.id,
          playerId: cmd.playerId,
          clubId: originContract.clubId,
          mechanism: terminationPlan.mechanism,
          effectiveDate,
          agreedAt: effectiveDate,
          parties: cmd.transferAgreement && cmd.transferAgreement.playerConsent
            ? [{ actor: 'player', consentGivenAt: cmd.transferAgreement.playerConsent.grantedAt }] : [],
          clauseId: cmd.clauseId || null,
          verifiedCauseRecordId: cmd.verifiedCauseRecordId || null,
          settlement: cmd.mutualSettlement && cmd.mutualSettlement.amount ? cmd.mutualSettlement.amount : (cmd.releaseClauseAmount || null),
          documentation: cmd.documentation || [],
          rulesSnapshot: resolvedPlan.newObjects.resolvedTransferRules ? { trace: resolvedPlan.newObjects.resolvedTransferRules.trace } : null,
        });
        transferRegistry.registerTerminationRecord(terminationRecord);
        registerUndo(() => { transferRegistry.unregisterTerminationRecord(terminationRecord.id); });
        const terminatedEvent = originContract.addLifecycleEvent({ type: 'terminated', date: effectiveDate, note: `TRANSFER-1:${terminationPlan.mechanism}` });
        registerUndo(() => { originContract.removeLifecycleEvent(terminatedEvent.id); });
      }

      const registeredObligations = resolvedPlan.obligations.map((line, idx) => {
        const obligation = new TransferEntities.FinancialObligation({
          id: `obligation:${plan.transactionId}:${idx}`,
          transactionId: plan.transactionId,
          ...line,
        });
        transferRegistry.registerObligation(obligation);
        registerUndo(() => { transferRegistry.unregisterObligation(obligation.id); });
        return obligation;
      });

      // 3) registrar contrato nuevo.
      if (contract) {
        contractRegistry.register(contract);
        registerUndo(() => { contractRegistry.unregister(contract.id); });
      }

      // 4) baja regulatoria de origen.
      let deactivatedRegistrationId = null;
      if (registrationRegistry && cmd.originRegistrationScopeId && originTeam) {
        const currentReg = registrationRegistry.currentRegistration(cmd.playerId, cmd.originRegistrationScopeId, cmd.originSeasonKey || cmd.seasonKey, effectiveDate);
        if (currentReg) {
          // BUG-TRANSFER1-13 (DESIGN.md 9.21): id determinista del evento
          // calculado ANTES de mutar (mismo criterio que
          // `RegistrationService.advanceRegistrationEvent`) — el rollback
          // usa `removeEvent(id)` en vez de reasignar `currentReg.events`
          // desde fuera del agregado.
          const deactivationEventId = `${currentReg.id}:deactivated:${currentReg.events.length}`;
          const previousReasonCode = currentReg.trace.deactivationReasonCode;
          RegSvc().deactivateRegistration(currentReg, effectiveDate, `TRANSFER-1:${terminationPlan ? terminationPlan.mechanism : cmd.operationType}`);
          deactivatedRegistrationId = currentReg.id;
          registerUndo(() => {
            currentReg.removeEvent(deactivationEventId);
            if (previousReasonCode === undefined) delete currentReg.trace.deactivationReasonCode;
            else currentReg.trace.deactivationReasonCode = previousReasonCode;
          });
        }
      }

      // 5) mover afiliación canónica (frontera única) — el snapshot
      // operativo (foco de entrenamiento, rol táctico, `state.lineup` si se
      // pasó) se captura ANTES de mover y se restaura EXACTO en el
      // rollback vía `restoreOperationalReferences()` (BUG-TRANSFER1-15).
      const rosterReport = cmd.releaseOnly
        ? RosterSvc().releasePlayer({
          playerRegistry, teams, playerId: cmd.playerId, fromTeamId: cmd.originClubId, lineup: deps.lineup,
        })
        : RosterSvc().transferPlayer({
          playerRegistry, teams, playerId: cmd.playerId, fromTeamId: cmd.originClubId, toTeamId: cmd.destinationClubId, lineup: deps.lineup,
        });
      registerUndo(() => {
        if (cmd.releaseOnly) {
          if (rosterReport.fromTeamId) {
            const backTeam = (teams || []).find((t) => t.id === rosterReport.fromTeamId);
            if (backTeam) backTeam.addPlayer(player);
            else playerRegistry.setAffiliation(cmd.playerId, rosterReport.fromTeamId);
          }
        } else {
          const backTeam = rosterReport.fromTeamId ? (teams || []).find((t) => t.id === rosterReport.fromTeamId) : null;
          const forwardTeam = (teams || []).find((t) => t.id === rosterReport.toTeamId);
          if (forwardTeam) forwardTeam.removePlayer(cmd.playerId);
          if (backTeam) backTeam.addPlayer(player);
          else playerRegistry.setAffiliation(cmd.playerId, null);
        }
        rosterReport.restoreOperationalReferences();
      });

      // 6) licencia + inscripción de destino.
      let createdLicenseId = null;
      let createdRegistrationId = null;
      if (registrationRegistry && !cmd.releaseOnly && cmd.destinationRegistration) {
        const regCmd = cmd.destinationRegistration;
        const license = RegSvc().issueLicense({
          registry: registrationRegistry,
          // Igual que la inscripción de abajo: el id determinista por
          // defecto (playerId+clubId+season) asume UNA licencia por
          // jugador/club/temporada — roto en cuanto el mismo jugador vuelve
          // a licenciarse en el MISMO club dentro de la misma temporada
          // (p.ej. cesión activada y devuelta y luego comprado en firme por
          // el propio cesionario). Se fija explícito por transacción para
          // que nunca choque con una licencia anterior desactivada.
          id: `license:${plan.transactionId}`,
          playerId: cmd.playerId,
          clubId: cmd.destinationClubId,
          federationId: regCmd.federationId,
          seasonKey: regCmd.seasonKey,
          licenseClass: regCmd.licenseClass,
          validity: regCmd.validity,
          documentStatuses: regCmd.documentStatuses || {},
          date: effectiveDate,
          provenance: { dataSource: 'simulated-transfer-v1', isReal: false },
        });
        createdLicenseId = license.id;
        registerUndo(() => { registrationRegistry.unregisterLicense(license.id); });

        const registration = RegSvc().createRegistration({
          registry: registrationRegistry,
          // El id determinista por defecto (playerId+scope+season) asume
          // UNA inscripción por jugador/ámbito/temporada — cierto antes de
          // TRANSFER-1, roto en cuanto un traspaso mueve al jugador DENTRO
          // del mismo ámbito/temporada (origen y destino en la misma
          // competición): la inscripción de origen queda desactivada, no
          // borrada, así que su id sigue ocupado. Se fija explícito por
          // transacción para que nunca choque con ella.
          id: `registration:${plan.transactionId}`,
          playerId: cmd.playerId,
          licenseId: license.id,
          teamId: cmd.destinationClubId,
          competitionId: regCmd.competitionId,
          competitionInstanceId: regCmd.competitionInstanceId,
          registrationScopeId: regCmd.registrationScopeId,
          seasonKey: regCmd.seasonKey,
          accessCategory: 'senior',
          contractId: contract ? contract.id : null,
          contractRegistry,
          classificationSnapshot: regCmd.classificationSnapshot,
          date: effectiveDate,
          resolved: regCmd.resolved,
          provenance: { dataSource: 'simulated-transfer-v1', isReal: false },
        });
        createdRegistrationId = registration.id;
        registerUndo(() => { registrationRegistry.unregisterRegistration(registration.id); });
      }

      // 7) historial/team stint: PlayerCareer crea el stint automáticamente
      //    al registrar el siguiente partido con el club nuevo (ver
      //    PlayerCareer.recordResolvedMatch/ensureTeamStint) — ningún paso
      //    explícito aquí (sección 16 del prompt: nunca reinicializa carrera).

      // 8) consumir reservas + AIP.
      const completionEventId = `${agreement.id}:completed:${plan.transactionId}`;
      agreement.addEvent({ id: completionEventId, type: 'execution-completed', date: effectiveDate });
      agreement.completedTransactionId = plan.transactionId;
      registerUndo(() => { agreement.removeEvent(completionEventId); agreement.completedTransactionId = null; });

      const reservationLinesBefore = (marketRegistry.getBudgetReservationGroup(agreement.budgetReservationGroupId) || []).map((l) => ({ ...l }));
      marketRegistry.releaseBudgetGroup(agreement.budgetReservationGroupId);
      registerUndo(() => {
        reservationLinesBefore.forEach((line) => {
          const current = marketRegistry.getBudgetReservation(line.id);
          if (current) current.status = line.status;
        });
      });

      // 9) proyección de nómina refrescada ANTES del recibo final
      // (BUG-TRANSFER1-14, DESIGN.md 9.21) — antes se refrescaba DESPUÉS de
      // `registerTransactionRecord()`, así que un fallo entre medias dejaba
      // el `TransactionRecord` ya registrado (comentado como "no hace falta
      // undo, es la última mutación") pero con la nómina de los clubes
      // implicados desincronizada, sin ningún paso posterior que la
      // revirtiera.
      if (contract) {
        const before = destinationTeam.finances.expenses.playerSalaries;
        ContractSvc().refreshTeamSalaryProjection(destinationTeam, contractRegistry, cmd.seasonKey);
        registerUndo(() => { destinationTeam.finances.expenses.playerSalaries = before; });
      }
      if (originTeam) {
        const before = originTeam.finances.expenses.playerSalaries;
        ContractSvc().refreshTeamSalaryProjection(originTeam, contractRegistry, cmd.seasonKey);
        registerUndo(() => { originTeam.finances.expenses.playerSalaries = before; });
      }

      // 10) TransactionRecord completado — ÚLTIMO paso: si algo posterior
      // fallara tendría que deshacer el recibo también, así que registra su
      // propio undo por defensa en profundidad (anticipando que LOAN-1
      // añada pasos DESPUÉS del recibo, p.ej. publicar noticia con
      // dependencias que pueden lanzar).
      const record = new TransferEntities.TransactionRecord({
        id: plan.transactionId,
        transferCaseId: cmd.transferCaseId || plan.transactionId,
        playerId: cmd.playerId,
        operationType: cmd.operationType,
        mechanism: terminationPlan ? terminationPlan.mechanism : cmd.mechanism,
        effectiveDate,
        completedAt: effectiveDate,
        originClubId: cmd.originClubId || null,
        destinationClubId: cmd.releaseOnly ? null : cmd.destinationClubId,
        agreementInPrincipleId: agreement.id,
        contractOfferId: agreement.acceptedOfferId,
        transferAgreementId: cmd.transferAgreementRecordId || null,
        terminationRecordId: terminationRecord ? terminationRecord.id : null,
        newContractId: contract ? contract.id : null,
        deactivatedRegistrationId,
        createdRegistrationId,
        createdLicenseId,
        obligationIds: registeredObligations.map((o) => o.id),
        rosterMutationReport: { fromTeamId: rosterReport.fromTeamId, toTeamId: rosterReport.toTeamId },
        rulesSnapshot: resolvedPlan.newObjects.resolvedTransferRules ? { trace: resolvedPlan.newObjects.resolvedTransferRules.trace } : null,
        sourceRefs: resolvedPlan.newObjects.resolvedTransferRules ? resolvedPlan.newObjects.resolvedTransferRules.sourceRefs : [],
        warnings: resolvedPlan.warnings,
      });
      transferRegistry.registerTransactionRecord(record);
      registerUndo(() => { transferRegistry.unregisterTransactionRecord(record.id); });

      return { record, idempotent: false };
    } catch (err) {
      // Rollback EXACTO: deshace en orden inverso todo lo que sí llegó a
      // aplicarse (sección 13.3) — inyectar un fallo después de cualquier
      // paso debe dejar Player/Team/Contract/Registration/Market/Transfer
      // exactamente como estaban.
      for (let i = undoStack.length - 1; i >= 0; i -= 1) {
        undoStack[i]();
      }
      throw err;
    }
  }

  const exportsObj = {
    TransferExecutionService: {
      TransferDomainError,
      computeRightsWaiverCompensation,
      planTransaction,
      commitTransaction,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
