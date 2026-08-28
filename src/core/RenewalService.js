// src/core/RenewalService.js
// CYCLE-1 (DESIGN.md 9.22, sección 10 del prompt) — RENOVACIONES y OPCIONES
// contractuales. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Una renovación es una NEGOCIACIÓN NUEVA entre el empleador ACTUAL y el
// jugador/agente:
//  - usa `MarketService`/`NegotiationService` para oferta, contraoferta,
//    aceptación y razones cualitativas (nunca una segunda IA de jugador);
//  - usa `ContractService` para validar y registrar el contrato definitivo;
//  - usa el contexto laboral del club en la FECHA DE LA NUEVA FIRMA;
//  - crea un contrato FUTURO separado y NO solapado (nunca muta el
//    `endDate` del anterior);
//  - NO mueve `Team.roster`, NO crea licencia por sí sola, NO es un
//    `TransferCase` y NUNCA es automática porque la CPU "necesite completar
//    plantilla".
//
// Las OPCIONES solo se ejecutan si la cláusula TIPADA de CONTRACT-1 trae
// términos COMPLETOS (ventana, temporadas añadidas, remuneración completa,
// parte con derecho, y trigger objetivo demostrado cuando corresponda). Un
// texto libre nunca se ejecuta y un término ausente nunca se inventa.
//
// Módulo puro: no lee DOM ni `state`; no construye noticias.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const CareerAgeModule = isNode ? require('../utils/CareerAge.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;
  const CycleEntities = isNode ? require('../entities/Cycle.js') : global.BasketManager;
  const CycleTransactionModule = isNode ? require('./CycleTransaction.js') : global.BasketManager;
  const ContractEntities = isNode ? require('../entities/Contract.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const MarketServiceModule = isNode ? require('./MarketService.js') : global.BasketManager;
  const NegotiationServiceModule = isNode ? require('./NegotiationService.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }
  function CareerAge() { return CareerAgeModule.CareerAge; }
  function CC() { return CycleConfigModule.CycleConfig; }
  function Tx() { return CycleTransactionModule.CycleTransaction; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function MarketSvc() { return MarketServiceModule.MarketService; }
  function NegSvc() { return NegotiationServiceModule.NegotiationService; }

  const RENEWAL_POLICY_VERSION = 'simulated-renewal-policy-v1';
  const RENEWAL_CONTRACT_DATA_SOURCE = 'simulated-contract-v2-renewal';

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // =====================================================================
  // 1. Ventana de renovación (decisión de SIMULACIÓN, no un plazo legal)
  // =====================================================================
  function renewalWindowFor(contract, referenceDate) {
    const iso = toIso(referenceDate);
    const opens = LD().addDays(contract.endDate, -CC().RENEWAL.windowDaysBeforeExpiry);
    // Cierra el propio día de fin de vigencia: después ya no es una
    // renovación, es un fichaje de agente libre (TRANSFER-1).
    const closes = contract.endDate;
    return {
      opens, closes, isOpen: LD().isWithinInclusive(iso, opens, closes),
    };
  }

  // ¿Este contrato es renovable AHORA por su propio club?
  function isRenewable(params) {
    const {
      contract, annualCycleRegistry, contractRegistry, date,
    } = params;
    const iso = toIso(date);
    const window = renewalWindowFor(contract, iso);
    if (!window.isOpen) return { renewable: false, reason: 'OUTSIDE_RENEWAL_WINDOW', window };
    if (contract.statusOn(iso) === 'terminated' || contract.statusOn(iso) === 'void') {
      return { renewable: false, reason: 'CONTRACT_NOT_ALIVE', window };
    }
    // Ya hay un contrato futuro (renovación/opción comprometida) — no se
    // renueva dos veces.
    const alreadyContinued = contractRegistry.forPlayer(contract.playerId)
      .some((other) => other.id !== contract.id && LD().isAfter(other.startDate, contract.endDate));
    if (alreadyContinued) return { renewable: false, reason: 'ALREADY_HAS_FUTURE_CONTRACT', window };
    const live = annualCycleRegistry.liveRenewalCaseForPlayer(contract.playerId, iso);
    if (live) return { renewable: false, reason: 'RENEWAL_ALREADY_OPEN', window, caseId: live.id };
    return { renewable: true, window };
  }

  // =====================================================================
  // 2. Borrador de contrato de renovación
  // =====================================================================
  // Calibración de juego: parte del salario garantizado de la ÚLTIMA
  // temporada del contrato que vence, con una prima base y un recorte por
  // declive de edad. Duración de la distribución determinista de
  // `CycleConfig`, SIEMPRE recortada por el máximo normativo REAL resuelto.
  function buildRenewalDraft(params) {
    const {
      player, team, expiringContract, resolved, seasonKey, date, fingerprint, salaryOverrideMinor, seasonsOverride,
    } = params;
    const iso = toIso(date);
    const employment = resolved.employment;
    const currency = (employment.allowedCurrencies && employment.allowedCurrencies[0]) || 'EUR';
    const declaredBasis = (employment.allowedBases && employment.allowedBases[0]) || 'gross';

    const seasons = seasonsOverride || CC().resolveInitialContractSeasons(
      fingerprint, 'renewal-duration', employment.maxTermYears, CC().NEW_CONTRACT_DURATION_WEIGHTS,
    );
    const coveredSeasonKeys = [];
    for (let i = 0; i < seasons; i += 1) coveredSeasonKeys.push(LD().addSeasons(seasonKey, i));
    const firstWindow = LD().seasonWindow(coveredSeasonKeys[0]);
    const lastWindow = LD().seasonWindow(coveredSeasonKeys[coveredSeasonKeys.length - 1]);
    const startDate = firstWindow.startDate;
    const endDate = lastWindow.endDate;
    if (!LD().isAfter(startDate, expiringContract.endDate)) {
      throw new Error(
        `RenewalService.buildRenewalDraft: el contrato nuevo (${startDate}) se solaparía con el que vence `
        + `(${expiringContract.endDate}) — una renovación crea SIEMPRE un contrato futuro no solapado.`,
      );
    }
    const signedDate = LD().isBefore(iso, startDate) ? iso : startDate;

    // Base: última temporada del contrato que vence.
    const lastSeasonOfExpiring = expiringContract.coveredSeasonKeys[expiringContract.coveredSeasonKeys.length - 1];
    const baseMinor = expiringContract.breakdownForSeason(lastSeasonOfExpiring).guaranteedBaseSalaryMinor
      || expiringContract.breakdownForSeason(lastSeasonOfExpiring).guaranteedCashMinor;
    const age = CareerAge().ageOnDate(player, startDate);
    const cfg = CC().RENEWAL;
    let factor = 1 + (cfg.baseRaisePercent / 100);
    if (age !== null && age >= cfg.declineAgeThreshold) factor = 1 - (cfg.declineCutPercent / 100);
    const legalFloorMinor = employment.effectiveMinimumAnnual ? employment.effectiveMinimumAnnual.amountMinor : 0;
    const salaryMinor = salaryOverrideMinor !== undefined && salaryOverrideMinor !== null
      ? M().requireAmountMinor(salaryOverrideMinor, 'salaryOverrideMinor')
      : Math.max(legalFloorMinor, Math.round(baseMinor * factor));

    const installmentCount = employment.payments.defaultInstallmentCount;
    const frequency = employment.payments.frequency || 'monthly';
    const monthStep = frequency === 'quarterly' ? 3 : 1;
    const schedule = [];
    coveredSeasonKeys.forEach((key, index) => {
      const window = LD().seasonWindow(key);
      const anchorStartDate = index === 0 ? startDate : window.startDate;
      const [anchorYear, anchorMonth] = anchorStartDate.split('-').map(Number);
      const [endYear, endMonth] = window.endDate.split('-').map(Number);
      const periodsAvailable = Math.floor(((endYear - anchorYear) * 12 + (endMonth - anchorMonth)) / monthStep) + 1;
      const seasonInstallmentCount = Math.max(1, Math.min(installmentCount, periodsAvailable));
      ContractEntities.buildPaymentSchedule({
        totalMinor: salaryMinor,
        installmentCount: seasonInstallmentCount,
        firstDueDate: LD().endOfMonth(anchorStartDate),
        frequency,
        currency,
        seasonKey: key,
      }).forEach((installment) => schedule.push(installment));
    });

    return {
      id: `contract:renewal:${team.id}:${player.id}:${seasonKey}`,
      playerId: player.id,
      clubId: team.id,
      contractType: 'professional-player',
      signedDate,
      startDate,
      endDate,
      coveredSeasonKeys,
      guaranteeType: 'fully-guaranteed',
      probation: { enabled: false },
      compensation: {
        currency,
        declaredBasis,
        seasons: coveredSeasonKeys.map((key) => ({
          seasonKey: key,
          guaranteedBaseSalaryMinor: salaryMinor,
          guaranteedImageRightsMinor: 0,
          guaranteedSalaryInKindMinor: 0,
          signingBonusMinor: 0,
          variableBonuses: [],
          nonSalaryBenefits: [],
          agentCosts: [],
        })),
      },
      paymentPolicy: {
        installmentCount,
        frequency,
        scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'],
        schedule,
      },
      clauses: [],
      declaredDocuments: [...new Set(['written-contract', ...employment.requiredDocuments])],
      representation: { agentId: null, mandateId: null },
      minorProtections: null,
      lifecycleEvents: [{ id: `signed-renewal-${player.id}-${seasonKey}`, type: 'signed', date: signedDate, note: 'Renovación simulada para esta partida; no es un dato contractual real.' }],
      provenance: {
        dataSource: RENEWAL_CONTRACT_DATA_SOURCE,
        isReal: false,
        generatorVersion: RENEWAL_POLICY_VERSION,
        seedFingerprint: fingerprint,
      },
    };
  }

  // =====================================================================
  // 3. Expediente de renovación
  // =====================================================================
  function openRenewalCase(params) {
    const {
      annualCycleRegistry, cycle, player, team, expiringContract, date, seasonKey,
    } = params;
    const iso = toIso(date);
    const window = renewalWindowFor(expiringContract, iso);
    const employmentContext = ContractSvc().resolveEmploymentContext(team, {});
    const renewalCase = new CycleEntities.RenewalCase({
      id: `renewal:${cycle.id}:${team.id}:${player.id}`,
      cycleId: cycle.id,
      playerId: player.id,
      clubId: team.id,
      expiringContractId: expiringContract.id,
      expiringEndDate: expiringContract.endDate,
      employmentContextSnapshot: {
        clubId: employmentContext.clubId,
        employerJurisdictionId: employmentContext.employerJurisdictionId,
        domesticCompetitionId: employmentContext.domesticCompetitionId,
        employmentProfileId: employmentContext.employmentProfileId,
        federationId: employmentContext.federationId,
        seasonKey,
        signedAtDate: iso,
      },
      openedAt: iso,
      windowOpensAt: window.opens,
      windowClosesAt: window.closes,
      provenance: { dataSource: 'simulated-renewal-v1', isReal: false, generatorVersion: RENEWAL_POLICY_VERSION },
    });
    annualCycleRegistry.registerRenewalCase(renewalCase);
    renewalCase.addEvent({
      id: `${renewalCase.id}:opened`, type: 'case-opened', date: iso, actor: team.id,
    });
    return renewalCase;
  }

  // Envía una oferta de renovación y resuelve la respuesta del jugador/
  // agente de forma DETERMINISTA en el mismo instante (el ciclo anual
  // resuelve el verano por fechas civiles, no por eventos de reloj de
  // partido). Usa EXACTAMENTE `NegotiationService.evaluateOffer` — la misma
  // utilidad cualitativa que MARKET-1.
  function sendRenewalOfferAndResolve(params) {
    const {
      annualCycleRegistry, marketRegistry, playerRegistry, contractRegistry, agentRegistry,
      renewalCase, player, team, expiringContract, resolved, seasonKey, date, careerSeed, marketContext,
      salaryOverrideMinor, seasonsOverride, budgetLimitMinor,
    } = params;
    const iso = toIso(date);
    const round = renewalCase.offerRounds();
    if (round >= CC().RENEWAL.maxOfferRounds) {
      const eventId = `${renewalCase.id}:expired`;
      renewalCase.addEvent({ id: eventId, type: 'expired', date: iso, data: { reason: 'MAX_OFFER_ROUNDS' } });
      return { outcome: 'expired', renewalCase };
    }
    const fingerprint = `${careerSeed || 'no-career-seed'}|renewal|${renewalCase.id}|${round}`;

    let draft;
    try {
      draft = buildRenewalDraft({
        player, team, expiringContract, resolved, seasonKey, date: iso, fingerprint, salaryOverrideMinor, seasonsOverride,
      });
    } catch (err) {
      const eventId = `${renewalCase.id}:blocked:${renewalCase.events.length}`;
      renewalCase.addEvent({ id: eventId, type: 'blocked', date: iso, data: { message: err.message } });
      return { outcome: 'blocked', renewalCase, diagnostic: { code: 'DRAFT_INVALID', message: err.message } };
    }

    // Hilo de negociación de MARKET-1 (uno por expediente) — el club actual
    // es el `actingClubId`.
    let thread = renewalCase.marketThreadId ? marketRegistry.getThread(renewalCase.marketThreadId) : null;
    if (!thread) {
      thread = MarketSvc().openInquiry({
        marketRegistry,
        agentRegistry,
        playerId: player.id,
        actingClubId: team.id,
        prospectiveCompetitionIds: [resolved.competitionId || null].filter(Boolean),
        date: iso,
        marketContext,
        careerSeed,
        playerRegistry,
        id: `thread:renewal:${renewalCase.id}`,
      });
      renewalCase.marketThreadId = thread.id;
      // El interés en una renovación con su club actual se considera
      // confirmado (el jugador ya está ahí): la decisión real es la
      // respuesta a la oferta, que sí se evalúa.
      thread.addEvent({ id: `${thread.id}:confirmed`, type: 'interest-confirmed', date: iso });
      marketRegistry.markEventProcessed(`${thread.id}:interest-response`);
    }

    let offer;
    try {
      offer = MarketSvc().createAndSendOffer({
        marketRegistry,
        thread,
        draft,
        offeredBy: 'club',
        date: iso,
        careerSeed,
        marketContext,
        team,
        player,
        playerRegistry,
        contractRegistry,
        seasonKey,
        version: round + 1,
        // CYCLE-1 (sección 16): límite interno congelado del ciclo — nunca
        // el payroll post-expiración (espiral hacia cero).
        budgetLimitMinor,
      });
    } catch (err) {
      const eventId = `${renewalCase.id}:blocked:${renewalCase.events.length}`;
      renewalCase.addEvent({ id: eventId, type: 'blocked', date: iso, data: { message: err.message } });
      return { outcome: 'blocked', renewalCase, diagnostic: { code: 'OFFER_REJECTED_BY_RULES', message: err.message } };
    }
    renewalCase.offerIds.push(offer.id);
    renewalCase.addEvent({
      id: `${renewalCase.id}:offer-sent:${round}`, type: 'offer-sent', date: iso, actor: team.id, data: { offerId: offer.id },
    });
    // La respuesta programada del lado jugador se marca procesada: la
    // resolvemos aquí mismo, de forma determinista, con el MISMO servicio.
    marketRegistry.markEventProcessed(`${offer.id}:offer-response`);

    const priorOffers = marketRegistry.offersForThread(thread.id).filter((o) => o.id !== offer.id);
    const evaluation = NegSvc().evaluateOffer({
      player,
      offer,
      priorOffers,
      rolePromise: null,
      fingerprint,
      roundIndex: round,
    });
    renewalCase.lastResponseReasons = [...(evaluation.reasons || [])];

    if (evaluation.decision === 'accept') {
      offer.addEvent({ id: `${offer.id}:accepted`, type: 'player-accepted', date: iso });
      renewalCase.addEvent({ id: `${renewalCase.id}:accepted`, type: 'accepted', date: iso, actor: player.id });
      const agreement = MarketSvc().createAgreementInPrinciple({
        marketRegistry,
        thread,
        offer,
        date: iso,
        employmentSnapshot: { profileId: resolved.profileId || null, seasonKey },
        marketRulesSnapshot: marketContext ? { bundleId: marketContext.bundleId } : null,
      });
      renewalCase.agreementInPrincipleId = agreement.id;
      renewalCase.budgetReservationGroupId = agreement.budgetReservationGroupId;
      renewalCase.addEvent({
        id: `${renewalCase.id}:aip`, type: 'agreement-in-principle', date: iso, data: { agreementId: agreement.id },
      });
      return {
        outcome: 'agreement-in-principle', renewalCase, agreement, offer, evaluation, draft,
      };
    }

    if (evaluation.decision === 'reject') {
      offer.addEvent({ id: `${offer.id}:rejected`, type: 'offer-rejected', date: iso });
      marketRegistry.releaseBudgetGroup(`res:${offer.id}`);
      renewalCase.addEvent({ id: `${renewalCase.id}:rejected`, type: 'rejected', date: iso, actor: player.id });
      return { outcome: 'rejected', renewalCase, evaluation };
    }

    // Contraoferta: entidad NUEVA (nunca una mutación de la anterior).
    offer.addEvent({ id: `${offer.id}:countered`, type: 'offer-countered', date: iso });
    marketRegistry.releaseBudgetGroup(`res:${offer.id}`);
    const currentGuaranteedMinor = NegSvc().summarizeOfferDraft(offer.contractDraft).guaranteedTotalMinor
      / Math.max(1, (offer.contractDraft.coveredSeasonKeys || [1]).length);
    const adjustment = NegSvc().generateCounterAdjustment({
      player, currentGuaranteedMinor, evaluation, fingerprint, roundIndex: round,
    });
    renewalCase.addEvent({
      id: `${renewalCase.id}:countered:${round}`,
      type: 'countered',
      date: iso,
      actor: player.id,
      data: { requestedGuaranteedMinor: adjustment.proposedGuaranteedMinor },
    });
    return {
      outcome: 'countered', renewalCase, evaluation, counterRequestMinor: adjustment.proposedGuaranteedMinor,
    };
  }

  // =====================================================================
  // 4. Commit del contrato de renovación
  // =====================================================================
  // El acuerdo en principio NUNCA registra el contrato: eso ocurre aquí, por
  // `ContractService`, y de forma atómica.
  function commitRenewal(params) {
    const {
      annualCycleRegistry, marketRegistry, contractRegistry, playerRegistry, renewalCase, player, team,
      resolved, seasonKey, date, teams,
    } = params;
    const iso = toIso(date);
    if (renewalCase.currentStatus() === 'committed') {
      return { contract: contractRegistry.get(renewalCase.committedContractId), idempotent: true };
    }
    const agreement = marketRegistry.getAgreement(renewalCase.agreementInPrincipleId);
    if (!agreement) {
      throw new Error(`RenewalService.commitRenewal: la renovación "${renewalCase.id}" no tiene acuerdo en principio.`);
    }
    const acceptedOffer = marketRegistry.getOffer(agreement.acceptedOfferId);
    if (!acceptedOffer) {
      throw new Error(`RenewalService.commitRenewal: no existe la oferta aceptada "${agreement.acceptedOfferId}".`);
    }

    return Tx().runAtomic(`RenewalService.commitRenewal(${renewalCase.id})`, (ctx) => {
      const created = ContractSvc().createContract({
        draft: acceptedOffer.contractDraft,
        team,
        player,
        registry: contractRegistry,
        playerRegistry,
        seasonKey,
        date: iso,
        resolved,
      });
      ctx.registerUndo(() => { contractRegistry.unregister(created.contract.id); });

      renewalCase.committedContractId = created.contract.id;
      ctx.registerUndo(() => { renewalCase.committedContractId = null; });
      const eventId = `${renewalCase.id}:committed`;
      renewalCase.addEvent({
        id: eventId, type: 'committed', date: iso, data: { contractId: created.contract.id },
      });
      ctx.registerUndo(() => { renewalCase.removeEvent(eventId); });

      // Consume la reserva presupuestaria del acuerdo (nunca se queda
      // colgada tras el commit).
      if (agreement.budgetReservationGroupId) {
        const before = (marketRegistry.getBudgetReservationGroup(agreement.budgetReservationGroupId) || [])
          .map((line) => ({ id: line.id, status: line.status }));
        marketRegistry.releaseBudgetGroup(agreement.budgetReservationGroupId);
        ctx.registerUndo(() => {
          before.forEach((line) => {
            const current = marketRegistry.getBudgetReservation(line.id);
            if (current) current.status = line.status;
          });
        });
      }
      const completionEventId = `${agreement.id}:completed:renewal`;
      agreement.addEvent({ id: completionEventId, type: 'execution-completed', date: iso });
      const previousCompleted = agreement.completedTransactionId;
      agreement.completedTransactionId = `tx:renewal:${renewalCase.id}`;
      ctx.registerUndo(() => {
        agreement.removeEvent(completionEventId);
        agreement.completedTransactionId = previousCompleted;
      });

      // Proyección de nómina refrescada desde el registro contractual.
      const before = team.finances.expenses.playerSalaries;
      ContractSvc().refreshTeamSalaryProjection(team, contractRegistry, seasonKey);
      ctx.registerUndo(() => { team.finances.expenses.playerSalaries = before; });

      void annualCycleRegistry;
      void teams;
      return { contract: created.contract, idempotent: false, warnings: created.warnings || [] };
    });
  }

  // =====================================================================
  // 5. OPCIONES contractuales tipadas
  // =====================================================================
  // Construye la decisión (persistida SIEMPRE, aunque la opción no se
  // ejerza) a partir de la cláusula REAL del contrato. Si los términos son
  // incompletos, queda visible como NO ejecutable con el motivo exacto.
  const OPTION_CLAUSE_TYPES = ['club-option', 'player-option', 'mutual-option', 'automatic-renewal'];

  function buildOptionDecision(params) {
    const {
      annualCycleRegistry, cycle, contract, clause, date,
    } = params;
    const iso = toIso(date);
    if (!OPTION_CLAUSE_TYPES.includes(clause.type)) {
      throw new Error(
        `RenewalService.buildOptionDecision: la cláusula "${clause.type}" no es una opción contractual `
        + `(tipos válidos: ${OPTION_CLAUSE_TYPES.join(', ')}).`,
      );
    }
    const existing = annualCycleRegistry.optionDecisionsForPlayer(contract.playerId)
      .find((entry) => entry.clauseId === clause.id && entry.cycleId === cycle.id);
    if (existing) return existing;

    // Los términos se leen SOLO de la cláusula tipada — nunca de texto libre.
    const terms = clause.conditions || {};
    const decision = new CycleEntities.ContractOptionDecision({
      id: `option-decision:${cycle.id}:${contract.id}:${clause.id}`,
      cycleId: cycle.id,
      playerId: contract.playerId,
      clubId: contract.clubId,
      contractId: contract.id,
      clauseId: clause.id,
      clauseType: clause.type,
      entitledParty: clause.holder || null,
      window: clause.window || null,
      addedSeasonKeys: terms.addedSeasonKeys || [],
      compensationSeasons: terms.compensationSeasons || [],
      objectiveTrigger: terms.objectiveTrigger || null,
      provenance: { dataSource: 'simulated-option-decision-v1', isReal: false, generatorVersion: RENEWAL_POLICY_VERSION },
    });
    annualCycleRegistry.registerOptionDecision(decision);
    decision.addEvent({ id: `${decision.id}:opened`, type: 'decision-opened', date: iso });

    const executability = decision.describeExecutability();
    if (!executability.executable) {
      decision.missingTerms = executability.missingTerms;
      decision.addEvent({
        id: `${decision.id}:terms-incomplete`,
        type: 'terms-incomplete',
        date: iso,
        data: { missingTerms: executability.missingTerms },
      });
    }
    return decision;
  }

  // Ejercicio de una opción — solo con términos completos, ventana abierta y
  // los consentimientos exigibles por su tipo. Crea un contrato NUEVO no
  // solapado; NUNCA muta el original.
  function exerciseOption(params) {
    const {
      annualCycleRegistry, contractRegistry, playerRegistry, decision, contract, player, team,
      resolved, seasonKey, date, clubConsent, playerConsent, triggerEvidence,
    } = params;
    const iso = toIso(date);
    if (decision.currentStatus() === 'committed') {
      return { contract: contractRegistry.get(decision.newContractId), idempotent: true };
    }
    const executability = decision.describeExecutability();
    if (!executability.executable) {
      return {
        contract: null,
        blocked: true,
        diagnostic: { code: 'OPTION_TERMS_INCOMPLETE', missingTerms: executability.missingTerms },
      };
    }
    if (!decision.isWithinWindow(iso)) {
      const eventId = `${decision.id}:lapsed`;
      if (decision.currentStatus() !== 'lapsed') {
        decision.addEvent({ id: eventId, type: 'window-closed-unexercised', date: iso });
      }
      return { contract: null, blocked: true, diagnostic: { code: 'OPTION_WINDOW_CLOSED', window: decision.window } };
    }

    // Consentimientos exigibles POR TIPO.
    if (decision.clauseType === 'club-option') {
      if (!clubConsent) return { contract: null, blocked: true, diagnostic: { code: 'CLUB_CONSENT_MISSING' } };
      decision.addEvent({ id: `${decision.id}:club-consent`, type: 'club-consent', date: iso, actor: team.id });
    } else if (decision.clauseType === 'player-option') {
      if (!playerConsent) return { contract: null, blocked: true, diagnostic: { code: 'PLAYER_CONSENT_MISSING' } };
      decision.addEvent({ id: `${decision.id}:player-consent`, type: 'player-consent', date: iso, actor: player.id });
    } else if (decision.clauseType === 'mutual-option') {
      if (!clubConsent) return { contract: null, blocked: true, diagnostic: { code: 'CLUB_CONSENT_MISSING' } };
      if (!playerConsent) return { contract: null, blocked: true, diagnostic: { code: 'PLAYER_CONSENT_MISSING' } };
      decision.addEvent({ id: `${decision.id}:club-consent`, type: 'club-consent', date: iso, actor: team.id });
      decision.addEvent({ id: `${decision.id}:player-consent`, type: 'player-consent', date: iso, actor: player.id });
    } else {
      // automatic-renewal: SOLO un trigger objetivo ya modelado y
      // demostrado por un hecho del juego. Sin evidencia, no se ejerce.
      if (!triggerEvidence || triggerEvidence.met !== true) {
        decision.addEvent({
          id: `${decision.id}:trigger-not-met`, type: 'trigger-not-met', date: iso, data: { triggerEvidence: triggerEvidence || null },
        });
        return { contract: null, blocked: true, diagnostic: { code: 'OBJECTIVE_TRIGGER_NOT_MET' } };
      }
      decision.triggerEvidence = triggerEvidence;
      decision.addEvent({
        id: `${decision.id}:trigger-verified`, type: 'trigger-verified', date: iso, data: { triggerEvidence },
      });
    }

    return Tx().runAtomic(`RenewalService.exerciseOption(${decision.id})`, (ctx) => {
      const exercisedEventId = `${decision.id}:exercised`;
      decision.addEvent({ id: exercisedEventId, type: 'exercised', date: iso });
      ctx.registerUndo(() => { decision.removeEvent(exercisedEventId); });

      const employment = resolved.employment;
      const currency = (employment.allowedCurrencies && employment.allowedCurrencies[0]) || 'EUR';
      const declaredBasis = (employment.allowedBases && employment.allowedBases[0]) || 'gross';
      const coveredSeasonKeys = [...decision.addedSeasonKeys];
      const startDate = LD().seasonWindow(coveredSeasonKeys[0]).startDate;
      const endDate = LD().seasonWindow(coveredSeasonKeys[coveredSeasonKeys.length - 1]).endDate;
      if (!LD().isAfter(startDate, contract.endDate)) {
        throw new Error(
          `RenewalService.exerciseOption: la temporada añadida (${startDate}) se solaparía con el contrato original `
          + `(${contract.endDate}) — ejercer una opción crea SIEMPRE un contrato nuevo no solapado.`,
        );
      }
      const installmentCount = employment.payments.defaultInstallmentCount;
      const frequency = employment.payments.frequency || 'monthly';
      const schedule = [];
      coveredSeasonKeys.forEach((key) => {
        const season = decision.compensationSeasons.find((s) => s.seasonKey === key);
        const window = LD().seasonWindow(key);
        const scheduledMinor = (season.guaranteedBaseSalaryMinor || 0) + (season.guaranteedImageRightsMinor || 0);
        const monthStep = frequency === 'quarterly' ? 3 : 1;
        const [anchorYear, anchorMonth] = window.startDate.split('-').map(Number);
        const [endYear, endMonth] = window.endDate.split('-').map(Number);
        const periodsAvailable = Math.floor(((endYear - anchorYear) * 12 + (endMonth - anchorMonth)) / monthStep) + 1;
        ContractEntities.buildPaymentSchedule({
          totalMinor: scheduledMinor,
          installmentCount: Math.max(1, Math.min(installmentCount, periodsAvailable)),
          firstDueDate: LD().endOfMonth(window.startDate),
          frequency,
          currency,
          seasonKey: key,
        }).forEach((installment) => schedule.push(installment));
      });

      const draft = {
        id: `contract:option:${decision.id}`,
        playerId: contract.playerId,
        clubId: contract.clubId,
        contractType: 'professional-player',
        signedDate: LD().isBefore(iso, startDate) ? iso : startDate,
        startDate,
        endDate,
        coveredSeasonKeys,
        guaranteeType: contract.guaranteeType,
        probation: { enabled: false },
        compensation: {
          currency,
          declaredBasis,
          seasons: coveredSeasonKeys.map((key) => {
            const season = decision.compensationSeasons.find((s) => s.seasonKey === key);
            return {
              seasonKey: key,
              guaranteedBaseSalaryMinor: season.guaranteedBaseSalaryMinor || 0,
              guaranteedImageRightsMinor: season.guaranteedImageRightsMinor || 0,
              guaranteedSalaryInKindMinor: season.guaranteedSalaryInKindMinor || 0,
              signingBonusMinor: season.signingBonusMinor || 0,
              variableBonuses: season.variableBonuses || [],
              nonSalaryBenefits: season.nonSalaryBenefits || [],
              agentCosts: season.agentCosts || [],
            };
          }),
        },
        paymentPolicy: {
          installmentCount, frequency, scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'], schedule,
        },
        clauses: [],
        declaredDocuments: [...new Set(['written-contract', ...employment.requiredDocuments])],
        representation: { agentId: null, mandateId: null },
        minorProtections: null,
        lifecycleEvents: [{
          id: `signed-option-${decision.id}`,
          type: 'signed',
          date: LD().isBefore(iso, startDate) ? iso : startDate,
          note: 'Opción contractual ejercida (simulada para esta partida; no es un dato contractual real).',
        }],
        provenance: {
          dataSource: 'simulated-contract-v2-option', isReal: false, generatorVersion: RENEWAL_POLICY_VERSION, seedFingerprint: decision.id,
        },
      };

      const created = ContractSvc().createContract({
        draft, team, player, registry: contractRegistry, playerRegistry, seasonKey, date: iso, resolved,
      });
      ctx.registerUndo(() => { contractRegistry.unregister(created.contract.id); });

      decision.newContractId = created.contract.id;
      ctx.registerUndo(() => { decision.newContractId = null; });
      const committedEventId = `${decision.id}:committed`;
      decision.addEvent({
        id: committedEventId, type: 'committed', date: iso, data: { contractId: created.contract.id },
      });
      ctx.registerUndo(() => { decision.removeEvent(committedEventId); });

      const before = team.finances.expenses.playerSalaries;
      ContractSvc().refreshTeamSalaryProjection(team, contractRegistry, seasonKey);
      ctx.registerUndo(() => { team.finances.expenses.playerSalaries = before; });

      void annualCycleRegistry;
      return { contract: created.contract, idempotent: false };
    });
  }

  // Decisión CPU determinista sobre una opción: la CPU ejerce si el jugador
  // aporta valor visible y cabe en el presupuesto interno. Razones
  // CUALITATIVAS, nunca puntuación.
  function decideOptionForCpu(params) {
    const {
      decision, qualityIndex, budgetAvailableMinor, addedSeasonCostMinor, fingerprint,
    } = params;
    const executability = decision.describeExecutability();
    if (!executability.executable) {
      return { exercise: false, reasons: ['La cláusula no contiene términos completos: no es ejecutable.'] };
    }
    const affordable = addedSeasonCostMinor <= budgetAvailableMinor;
    const reasons = [];
    if (!affordable) reasons.push('El coste de la temporada añadida no cabe en el presupuesto interno del club.');
    const valuable = (qualityIndex !== undefined && qualityIndex !== null) ? qualityIndex >= 0.45 : true;
    if (!valuable) reasons.push('El club no considera prioritario alargar su relación contractual.');
    if (affordable && valuable) reasons.push('El club considera que aporta valor y ejerce la opción.');
    void fingerprint;
    return { exercise: affordable && valuable, reasons };
  }

  const exportsObj = {
    RenewalService: {
      RENEWAL_POLICY_VERSION,
      RENEWAL_CONTRACT_DATA_SOURCE,
      OPTION_CLAUSE_TYPES,
      renewalWindowFor,
      isRenewable,
      buildRenewalDraft,
      openRenewalCase,
      sendRenewalOfferAndResolve,
      commitRenewal,
      buildOptionDecision,
      exerciseOption,
      decideOptionForCpu,
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
