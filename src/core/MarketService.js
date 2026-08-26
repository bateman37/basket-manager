// src/core/MarketService.js
// MARKET-1 (DESIGN.md 9.19, sección 9.3 del prompt) — ÚNICO punto para
// acciones de dominio de mercado. Cada comando recibe fecha/contexto/
// dependencias EXPLÍCITOS y vuelve a validar reglas — nunca lee `state`
// ni el DOM (eso es game.js). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Ningún comando de este archivo llama a ContractRegistry.register(),
// ContractService.createContract(), Team.addPlayer()/removePlayer(),
// RegistrationService ni muta player.teamId — eso es TRANSFER-1 (sección
// 1 del prompt, invariantes 4/5).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const NegotiationServiceModule = isNode ? require('./NegotiationService.js') : global.BasketManager;
  const MarketEntities = isNode ? require('../entities/Market.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function NegSvc() { return NegotiationServiceModule.NegotiationService; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // ---------------------------------------------------------------------
  // 1. Seguimiento (sección 16.3) — delega directamente, comando fino.
  // ---------------------------------------------------------------------
  function addWatch(marketRegistry, clubId, playerId) { marketRegistry.addWatch(clubId, playerId); return marketRegistry; }
  function removeWatch(marketRegistry, clubId, playerId) { marketRegistry.removeWatch(clubId, playerId); return marketRegistry; }

  // ---------------------------------------------------------------------
  // 2. Disponibilidad de mercado DERIVADA (sección 8.3) — nunca
  //    `player.isFreeAgent`/`player.hasTanteo` duplicados.
  // ---------------------------------------------------------------------
  function resolveMarketAvailability(params) {
    const {
      playerId, playerRegistry, contractRegistry, marketRegistry, date,
    } = params;
    const iso = toIso(date);
    if (!playerRegistry.has(playerId)) {
      return { status: 'not-found', reasons: ['PLAYER_NOT_FOUND'] };
    }
    const player = playerRegistry.get(playerId);

    // Acuerdo en principio vivo con OTRO club — prioridad máxima de
    // presentación (sección 8.3).
    const liveAgreement = marketRegistry.agreementsForPlayer(playerId)
      .find((a) => !a.validUntil || !LD().isAfter(iso, a.validUntil));
    if (liveAgreement) {
      return {
        status: 'agreement-in-principle', reasons: [], agreementId: liveAgreement.id, withClubId: liveAgreement.clubId,
      };
    }

    // Derecho preferente abierto sobre este jugador (sección 8.3: "libre
    // sujeto a derecho preferente").
    const openRightsCase = marketRegistry.rightsCasesForPlayer(playerId)
      .find((c) => c.statusOn(iso) !== 'procedure-resolved' && c.statusOn(iso) !== null);

    const current = contractRegistry.currentForPlayer(playerId, iso);
    if (!current) {
      if (openRightsCase) {
        return {
          status: 'free-subject-to-rights', reasons: [], rightsCaseId: openRightsCase.id, teamId: player.teamId || null,
        };
      }
      return { status: 'free', reasons: [], teamId: player.teamId || null };
    }

    if (current.statusOn(iso) === 'pending' && LD().isAfter(current.startDate, iso)) {
      const daysToExpiry = LD().daysBetween(iso, current.endDate);
      if (daysToExpiry <= 180) {
        return {
          status: 'contract-expiring-soon', reasons: [], contractId: current.id, endDate: current.endDate, clubId: current.clubId,
        };
      }
    }
    const daysToExpiry = LD().daysBetween(iso, current.endDate);
    if (daysToExpiry <= 180) {
      return {
        status: 'contract-expiring-soon', reasons: [], contractId: current.id, endDate: current.endDate, clubId: current.clubId,
      };
    }

    return {
      status: 'under-contract', reasons: [], contractId: current.id, clubId: current.clubId, endDate: current.endDate,
    };
  }

  // ---------------------------------------------------------------------
  // 3. Contexto normativo de una negociación concreta (sección 7.1).
  // ---------------------------------------------------------------------
  function resolveMarketContext(ctx) {
    return CompetitionRules.resolveMarketRules(ctx);
  }

  // ---------------------------------------------------------------------
  // 4. Presupuesto interno SIMULADO (sección 11) — nunca team.budget/caja
  //    real. Calibrado contra el payroll YA comprometido del propio club
  //    (nunca ingresos inventados) y un multiplicador determinista de
  //    `team.reputation.financial` (señal visible, ya existente).
  // ---------------------------------------------------------------------
  const MARKET_BUDGET_POLICY_VERSION = 'simulated-market-budget-v1';
  const MARKET_BUDGET_FLOOR_MINOR = 20000000; // suelo de staging para clubes sin payroll comprometido aún

  function computeInternalBudgetLimit(team, contractRegistry, seasonKey) {
    const payroll = ContractSvc().guaranteedPayrollForClub(contractRegistry, team.id, seasonKey);
    const financial = (team.reputation && team.reputation.financial !== undefined) ? team.reputation.financial : 50;
    const multiplier = 1.15 + (financial / 100) * 0.85; // rango [1.15, 2.0]
    const base = Math.max(payroll.amountMinor, MARKET_BUDGET_FLOOR_MINOR);
    return {
      amountMinor: Math.round(base * multiplier),
      currency: payroll.currency,
      basedOnCommittedPayrollMinor: payroll.amountMinor,
      multiplier,
      policyVersion: MARKET_BUDGET_POLICY_VERSION,
    };
  }

  // Comprometido (contratos) + reservado (ofertas vivas + acuerdos) +
  // disponible, por club+temporada — sección 11.
  function computeSquadCostPlan(params) {
    const {
      team, contractRegistry, marketRegistry, seasonKey,
    } = params;
    const committed = ContractSvc().guaranteedPayrollForClub(contractRegistry, team.id, seasonKey);
    const reserved = marketRegistry.reservedTotalForClubSeason(team.id, seasonKey);
    const limit = computeInternalBudgetLimit(team, contractRegistry, seasonKey);
    const availableMinor = Math.max(0, limit.amountMinor - committed.amountMinor - reserved);
    return {
      seasonKey,
      currency: committed.currency,
      committedMinor: committed.amountMinor,
      reservedMinor: reserved,
      limitMinor: limit.amountMinor,
      availableMinor,
      limitPolicyVersion: limit.policyVersion,
      warnings: [
        'Límite interno SIMULADO para esta partida; no es un presupuesto real del club ni una regla de la competición.',
      ],
    };
  }

  // ---------------------------------------------------------------------
  // 5. Abrir consulta / hilo (sección 12.1, 8.4).
  // ---------------------------------------------------------------------
  function openInquiry(params) {
    const {
      marketRegistry, agentRegistry, playerId, actingClubId, actingMandateId, prospectiveCompetitionIds,
      date, marketContext, careerSeed,
    } = params;
    const id = params.id || `thread:${actingClubId}:${playerId}:${toIso(date)}`;
    const thread = new MarketEntities.NegotiationThread({
      id,
      playerId,
      actingClubId,
      actingMandateId: actingMandateId || null,
      prospectiveCompetitionIds: prospectiveCompetitionIds || [],
      openedAt: toIso(date),
      rulesSnapshot: marketContext ? { bundleId: marketContext.bundleId, trace: marketContext.trace } : null,
      marketPolicyVersion: NegSvc().NEGOTIATION_POLICY_VERSION,
      provenance: { dataSource: 'market-negotiation', isReal: false },
    });
    marketRegistry.registerThread(thread);

    // Overlay de contacto (EuroLeague-style) exige autorización previa —
    // nunca inventado para ACB/FEB sin módulo real (sección 12.2).
    const requiresAuthorization = Boolean(marketContext && marketContext.capabilities
      && marketContext.capabilities.has && marketContext.capabilities.has('requiresPriorClubAuthorization'));
    if (requiresAuthorization) {
      thread.addEvent({ id: `${thread.id}:contact-permission-requested`, type: 'contact-permission-requested', date: thread.openedAt });
      return thread;
    }

    thread.addEvent({ id: `${thread.id}:contacted`, type: 'player-side-contacted', date: thread.openedAt });
    const fingerprint = NegSvc().buildFingerprint({
      careerSeed, playerId, threadId: thread.id, offerVersion: 0, decisionDate: thread.openedAt,
    });
    const responseDate = NegSvc().scheduleResponseDate({ fingerprint, fromDate: thread.openedAt });
    thread.addEvent({ id: `${thread.id}:response-scheduled`, type: 'interest-response-scheduled', date: thread.openedAt });
    marketRegistry.scheduleEvent({
      id: `${thread.id}:interest-response`,
      type: 'interest-response',
      dueDate: responseDate,
      clubId: actingClubId,
      playerId,
      threadId: thread.id,
      requiresAttention: false,
      payload: { fingerprint },
    });
    return thread;
  }

  function grantContactPermission(marketRegistry, threadId, date, careerSeed) {
    const thread = marketRegistry.requireThread(threadId);
    thread.addEvent({ id: `${threadId}:permission-granted`, type: 'contact-permission-granted', date: toIso(date) });
    thread.addEvent({ id: `${threadId}:contacted`, type: 'player-side-contacted', date: toIso(date) });
    const fingerprint = NegSvc().buildFingerprint({
      careerSeed, playerId: thread.playerId, threadId, offerVersion: 0, decisionDate: toIso(date),
    });
    const responseDate = NegSvc().scheduleResponseDate({ fingerprint, fromDate: toIso(date) });
    thread.addEvent({ id: `${threadId}:response-scheduled`, type: 'interest-response-scheduled', date: toIso(date) });
    marketRegistry.scheduleEvent({
      id: `${threadId}:interest-response`, type: 'interest-response', dueDate: responseDate,
      clubId: thread.actingClubId, playerId: thread.playerId, threadId, requiresAttention: false, payload: { fingerprint },
    });
    return thread;
  }

  function denyContactPermission(marketRegistry, threadId, date) {
    const thread = marketRegistry.requireThread(threadId);
    thread.addEvent({ id: `${threadId}:permission-denied`, type: 'contact-permission-denied', date: toIso(date) });
    thread.addEvent({ id: `${threadId}:closed`, type: 'thread-closed', date: toIso(date) });
    return thread;
  }

  // Procesa un evento de respuesta de interés YA VENCIDO — decide
  // confirmado/declinado de forma determinista (sección 12.1).
  function processInterestResponseEvent(params) {
    const {
      marketRegistry, playerRegistry, event, date, careerSeed,
    } = params;
    const thread = marketRegistry.requireThread(event.threadId);
    const player = playerRegistry.get(event.playerId);
    const fingerprint = event.payload.fingerprint;
    const interest = NegSvc().computeInitialInterest({ player, prospectiveClubId: thread.actingClubId, fingerprint });
    const type = interest.level === 'low' ? 'interest-declined' : 'interest-confirmed';
    thread.addEvent({ id: `${thread.id}:${type}`, type, date: toIso(date) });
    if (type === 'interest-declined') {
      thread.addEvent({ id: `${thread.id}:closed-no-interest`, type: 'thread-closed', date: toIso(date) });
    }
    marketRegistry.markEventProcessed(event.id);
    return { thread, interest };
  }

  // ---------------------------------------------------------------------
  // 6. Ofertas (sección 12, 9.4, 11).
  // ---------------------------------------------------------------------
  // Valida un borrador ANTES de enviarlo — empleo/jurisdicción/reglas de
  // mercado del contexto exacto (sección 3.8 del resultado esperado).
  function validateOfferBeforeSend(params) {
    const {
      draft, team, player, playerRegistry, contractRegistry, marketRegistry, seasonKey, date, marketContext,
    } = params;
    const employment = ContractSvc().validateDraft({
      draft, team, player, playerRegistry, contractRegistry, seasonKey, date,
    });
    const errors = [...employment.errors];

    const guaranteedTotalMinor = NegSvc().summarizeOfferDraft(draft).guaranteedTotalMinor;
    const costPlan = computeSquadCostPlan({
      team, contractRegistry, marketRegistry, seasonKey,
    });
    if (guaranteedTotalMinor > costPlan.availableMinor) {
      errors.push(
        `La oferta (${guaranteedTotalMinor} minor) excede el disponible del límite interno simulado `
        + `(${costPlan.availableMinor} minor) para ${seasonKey}.`,
      );
    }

    const requiresInternationalLicense = Boolean(marketContext && marketContext.market
      && marketContext.market.agentPrinciples
      && marketContext.market.agentPrinciples.requiresFibaLicenseForOperations
      && marketContext.market.agentPrinciples.requiresFibaLicenseForOperations.includes('internationalTransfer')
      && draft.transactionScope === 'international');
    if (requiresInternationalLicense) {
      errors.push('Un transfer internacional requiere agente con licencia FIBA vigente — bloqueado hasta EUROPE-1.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [...employment.warnings],
      employmentValidation: employment,
      costPlan,
      requiresTransferResolution: employment.requiresTransferResolution,
    };
  }

  function createAndSendOffer(params) {
    const {
      marketRegistry, thread, draft, offeredBy, rolePromise, conditionsPrecedent, disclosures, date, careerSeed,
      employmentValidation, marketContext, parentOfferId, version, maxOfficialDeadline,
    } = params;
    const validation = params.validation || { valid: true, errors: [] };
    if (!validation.valid) {
      throw new Error(`MarketService.createAndSendOffer: borrador inválido — ${validation.errors.join(' | ')}`);
    }
    const iso = toIso(date);
    const nextVersion = version || (marketRegistry.offersForThread(thread.id).length + 1);
    const fingerprint = NegSvc().buildFingerprint({
      careerSeed, playerId: thread.playerId, threadId: thread.id, offerVersion: nextVersion, decisionDate: iso,
    });
    const expiresAt = NegSvc().offerExpiryDate({ fingerprint, fromDate: iso, maxOfficialDeadline });
    const offer = new MarketEntities.ContractOffer({
      id: `${thread.id}:offer:${nextVersion}`,
      threadId: thread.id,
      version: nextVersion,
      parentOfferId: parentOfferId || null,
      offeredBy,
      createdAt: iso,
      expiresAt,
      playerId: thread.playerId,
      clubId: draft.clubId,
      contractDraft: draft,
      rolePromise: rolePromise || null,
      conditionsPrecedent: conditionsPrecedent || [],
      disclosures: disclosures || [],
      employmentValidationSnapshot: employmentValidation ? {
        valid: employmentValidation.valid, requiresTransferResolution: employmentValidation.requiresTransferResolution,
      } : null,
      marketRulesSnapshot: marketContext ? { bundleId: marketContext.bundleId } : null,
      provenance: { dataSource: 'market-negotiation', isReal: false },
    });
    marketRegistry.registerOffer(offer);
    thread.addOfferId(offer.id);

    const guaranteedTotalMinor = NegSvc().summarizeOfferDraft(draft).guaranteedTotalMinor;
    marketRegistry.reserveBudget({
      id: `res:${offer.id}`,
      clubId: draft.clubId,
      seasonKey: (draft.coveredSeasonKeys && draft.coveredSeasonKeys[0]) || null,
      amountMinor: guaranteedTotalMinor,
      currency: draft.compensation ? draft.compensation.currency : 'EUR',
      sourceType: 'offer',
      sourceId: offer.id,
    });

    return offer;
  }

  // Retirada — solo mientras el estado lo permita (sección 12.4).
  function withdrawOffer(marketRegistry, offerId, date) {
    const offer = marketRegistry.requireOffer(offerId);
    if (offer.statusOn(toIso(date)) !== 'sent') {
      throw new Error(`MarketService.withdrawOffer: la oferta "${offerId}" no está en estado retirable.`);
    }
    offer.addEvent({ id: `${offerId}:withdrawn`, type: 'offer-withdrawn', date: toIso(date) });
    marketRegistry.releaseBudget(`res:${offerId}`);
    return offer;
  }

  // Expira ofertas vencidas — idempotente, no revive una oferta ya
  // resuelta (sección 12.4).
  function expireDueOffers(marketRegistry, date) {
    const iso = toIso(date);
    const expired = [];
    marketRegistry.allThreads().forEach((thread) => {
      marketRegistry.offersForThread(thread.id).forEach((offer) => {
        if (offer.statusOn(iso) === 'sent' && LD().isAfter(iso, offer.expiresAt)) {
          offer.addEvent({ id: `${offer.id}:expired`, type: 'offer-expired', date: iso });
          marketRegistry.releaseBudget(`res:${offer.id}`);
          expired.push(offer);
        }
      });
    });
    return expired;
  }

  // Procesa la respuesta del jugador/agente a la oferta VIVA de un hilo —
  // acepta, contraoferta o rechaza, de forma determinista (sección 12).
  function processOfferResponse(params) {
    const {
      marketRegistry, playerRegistry, thread, offer, date, careerSeed, marketContext,
    } = params;
    const iso = toIso(date);
    const player = playerRegistry.get(thread.playerId);
    const priorOffers = marketRegistry.offersForThread(thread.id).filter((o) => o.id !== offer.id);
    const fingerprint = NegSvc().buildFingerprint({
      careerSeed, playerId: thread.playerId, threadId: thread.id, offerVersion: offer.version, decisionDate: iso,
    });
    const roundIndex = priorOffers.filter((o) => o.offeredBy === 'club').length - 1;
    const evaluation = NegSvc().evaluateOffer({
      player, offer, priorOffers, rolePromise: offer.rolePromise, fingerprint, roundIndex: Math.max(0, roundIndex),
    });

    if (evaluation.decision === 'accept') {
      offer.addEvent({ id: `${offer.id}:accepted`, type: 'player-accepted', date: iso });
      return { evaluation, outcome: 'accepted', offer };
    }

    if (evaluation.decision === 'reject') {
      offer.addEvent({ id: `${offer.id}:rejected`, type: 'offer-rejected', date: iso });
      marketRegistry.releaseBudget(`res:${offer.id}`);
      return { evaluation, outcome: 'rejected', offer };
    }

    // counter — supera la versión anterior con una NUEVA oferta, nunca
    // muta la vieja (invariante 6).
    offer.addEvent({ id: `${offer.id}:countered`, type: 'offer-countered', date: iso });
    marketRegistry.releaseBudget(`res:${offer.id}`);
    const currentGuaranteedMinor = NegSvc().summarizeOfferDraft(offer.contractDraft).guaranteedTotalMinor
      / Math.max(1, (offer.contractDraft.coveredSeasonKeys || [1]).length);
    const adjustment = NegSvc().generateCounterAdjustment({
      player, currentGuaranteedMinor, evaluation, fingerprint, roundIndex: Math.max(0, roundIndex),
    });
    const seasons = offer.contractDraft.compensation.seasons.map((s) => ({
      ...s, guaranteedBaseSalaryMinor: adjustment.proposedGuaranteedMinor,
    }));
    const counterDraft = {
      ...offer.contractDraft,
      compensation: { ...offer.contractDraft.compensation, seasons },
    };
    const counterOffer = createAndSendOffer({
      marketRegistry,
      thread,
      draft: counterDraft,
      offeredBy: 'player-side',
      rolePromise: offer.rolePromise,
      conditionsPrecedent: offer.conditionsPrecedent,
      disclosures: offer.disclosures,
      date: iso,
      careerSeed,
      marketContext,
      parentOfferId: offer.id,
      version: offer.version + 1,
    });
    return {
      evaluation, outcome: 'countered', offer, counterOffer,
    };
  }

  // ---------------------------------------------------------------------
  // 7. Acuerdo en principio (sección 8.6, 12.1).
  // ---------------------------------------------------------------------
  function createAgreementInPrinciple(params) {
    const {
      marketRegistry, thread, offer, date, employmentSnapshot, marketRulesSnapshot, rightsOutcomeId, validUntil,
    } = params;
    const iso = toIso(date);
    if (offer.statusOn(iso) !== 'accepted') {
      throw new Error('MarketService.createAgreementInPrinciple: la oferta debe estar aceptada por el jugador.');
    }
    if (marketRegistry.hasLiveAgreementForPlayer(thread.playerId, iso)) {
      throw new Error(`MarketService.createAgreementInPrinciple: "${thread.playerId}" ya tiene un acuerdo en principio vivo (invariante 8).`);
    }
    const agreement = new MarketEntities.AgreementInPrinciple({
      id: `aip:${thread.id}:${offer.id}`,
      threadId: thread.id,
      acceptedOfferId: offer.id,
      playerId: thread.playerId,
      clubId: offer.clubId,
      acceptedAt: iso,
      validUntil: validUntil || null,
      conditionsPrecedent: offer.conditionsPrecedent,
      rightsOutcomeId: rightsOutcomeId || null,
      employmentSnapshot: employmentSnapshot || {},
      marketRulesSnapshot: marketRulesSnapshot || null,
      // La reserva del acuerdo REUTILIZA la de la oferta aceptada — nunca
      // se reserva dos veces (sección 11: "un acuerdo conserva la reserva").
      budgetReservationId: `res:${offer.id}`,
      provenance: { dataSource: 'market-negotiation', isReal: false },
    });
    marketRegistry.registerAgreement(agreement);
    thread.setAgreementId(agreement.id);
    thread.addEvent({ id: `${thread.id}:agreement-created`, type: 'agreement-created', date: iso });
    return agreement;
  }

  const exportsObj = {
    MarketService: {
      MARKET_BUDGET_POLICY_VERSION,
      addWatch,
      removeWatch,
      resolveMarketAvailability,
      resolveMarketContext,
      computeInternalBudgetLimit,
      computeSquadCostPlan,
      openInquiry,
      grantContactPermission,
      denyContactPermission,
      processInterestResponseEvent,
      validateOfferBeforeSend,
      createAndSendOffer,
      withdrawOffer,
      expireDueOffers,
      processOfferResponse,
      createAgreementInPrinciple,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
