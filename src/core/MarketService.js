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
    // presentación (sección 8.3). BUG-MARKET1-06: "vivo" ahora es
    // `isLiveOn()` (ciclo de vida + validUntil), nunca solo `validUntil`.
    const liveAgreement = marketRegistry.agreementsForPlayer(playerId)
      .find((a) => a.isLiveOn(iso));
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
  // `params.limitOverrideMinor` (CYCLE-1, DESIGN.md 9.22, sección 16 del
  // prompt): límite interno YA calculado por el ciclo anual a partir de la
  // REFERENCIA DE NÓMINA DE APERTURA congelada ANTES de que expiren
  // contratos. Sin él, el límite se derivaría del payroll comprometido de la
  // temporada objetivo — que en pleno verano puede ser casi cero porque
  // media plantilla acaba de vencer, produciendo una espiral de presupuesto
  // hacia cero justo cuando el club necesita reponer. MARKET-1 sigue
  // calculando su propio límite cuando nadie aporta override (partida en
  // curso, negociación puntual del usuario dentro de la temporada).
  function computeSquadCostPlan(params) {
    const {
      team, contractRegistry, marketRegistry, seasonKey, limitOverrideMinor,
    } = params;
    const committed = ContractSvc().guaranteedPayrollForClub(contractRegistry, team.id, seasonKey);
    const reserved = marketRegistry.reservedTotalForClubSeason(team.id, seasonKey);
    const limit = (limitOverrideMinor !== undefined && limitOverrideMinor !== null)
      ? { amountMinor: limitOverrideMinor, currency: committed.currency, policyVersion: 'cycle-frozen-opening-payroll-v1' }
      : computeInternalBudgetLimit(team, contractRegistry, seasonKey);
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
  // BUG-MARKET1-04 (DESIGN.md 9.20): `openInquiry()` aceptaba
  // `agentRegistry`/`actingMandateId` pero nunca los resolvía ni validaba
  // — un hilo podía abrirse con `actingMandateId: null` aunque el jugador
  // SÍ estuviera representado, o con un mandato ajeno/expirado/fuera de
  // alcance sin ningún error. Ahora:
  //  - si se declara `actingMandateId`, se exige que exista, represente
  //    EXACTAMENTE a este jugador y esté activo en la fecha (nunca un
  //    mandato ajeno o vencido — exige renovación/nuevo mandato/
  //    consentimiento personal trazado);
  //  - si no se declara, se resuelve el mandato ACTIVO exacto vía
  //    `AgentRegistry.actingMandateForTransaction()` (determinista:
  //    exclusivo > más reciente, nunca "el primero del array") — `null`
  //    significa auto-representación EXPLÍCITA, no un mandato ignorado;
  //  - si se pasa `playerRegistry`, se valida además conflicto de interés
  //    (agente representando a la vez al club y al jugador de esta
  //    operación).
  // ---------------------------------------------------------------------
  function resolveActingMandate(params) {
    const {
      agentRegistry, playerId, actingClubId, actingMandateId, date, playerRegistry,
    } = params;
    if (!agentRegistry) return null; // sin registro de agentes disponible: auto-representación (fixtures legacy)
    let mandate = null;
    if (actingMandateId) {
      mandate = agentRegistry.requireMandate(actingMandateId);
      if (mandate.clientType !== 'player' || mandate.clientId !== playerId) {
        throw new Error(
          `MarketService.openInquiry: el mandato "${actingMandateId}" no representa al jugador "${playerId}" `
          + '(BUG-MARKET1-04: nunca se acepta un mandato ajeno).',
        );
      }
      if (!mandate.isActiveOn(date)) {
        throw new Error(
          `MarketService.openInquiry: el mandato "${actingMandateId}" no está activo a ${date} `
          + '(pendiente/expirado/terminado) — exige renovación, nuevo mandato o consentimiento personal trazado, '
          + 'nunca se reescribe el hilo histórico con un mandato caducado.',
        );
      }
    } else {
      mandate = agentRegistry.actingMandateForTransaction({ playerId, date, scope: 'employment' });
    }
    if (mandate && playerRegistry) {
      const conflict = agentRegistry.validateConflictOfInterest(
        {
          agentId: mandate.agentId, playerId, involvedClubId: actingClubId, date,
        },
        { playerRegistry },
      );
      if (!conflict.valid) {
        throw new Error(`MarketService.openInquiry: conflicto de interés del agente — ${conflict.errors.join(' | ')}`);
      }
    }
    return mandate;
  }

  // ---------------------------------------------------------------------
  // 5. Abrir consulta / hilo (sección 12.1, 8.4).
  // ---------------------------------------------------------------------
  function openInquiry(params) {
    const {
      marketRegistry, agentRegistry, playerId, actingClubId, actingMandateId, prospectiveCompetitionIds,
      date, marketContext, careerSeed, playerRegistry,
    } = params;
    const iso = toIso(date);
    const resolvedMandate = resolveActingMandate({
      agentRegistry, playerId, actingClubId, actingMandateId, date: iso, playerRegistry,
    });
    const id = params.id || `thread:${actingClubId}:${playerId}:${iso}`;
    const thread = new MarketEntities.NegotiationThread({
      id,
      playerId,
      actingClubId,
      actingMandateId: resolvedMandate ? resolvedMandate.id : null,
      prospectiveCompetitionIds: prospectiveCompetitionIds || [],
      openedAt: iso,
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
  //
  // BUG-MARKET1-05 (DESIGN.md 9.20): desglose y validación POR TEMPORADA
  // (`Contract.breakdownForSeason`, misma semántica que CONTRACT-1), nunca
  // un total plurianual comparado contra el disponible de un único
  // ejercicio. `costPlan` pasa a ser un mapa `{ [seasonKey]: costPlan }` —
  // quien consuma el resultado (UI, tests) debe leer por temporada.
  function validateOfferBeforeSend(params) {
    const {
      draft, team, player, playerRegistry, contractRegistry, marketRegistry, seasonKey, date, marketContext,
      // CYCLE-1: límite interno congelado del ciclo anual (ver
      // computeSquadCostPlan) — opcional, nunca obligatorio para MARKET-1.
      budgetLimitMinor,
    } = params;
    const employment = ContractSvc().validateDraft({
      draft, team, player, playerRegistry, contractRegistry, seasonKey, date,
    });
    const errors = [...employment.errors];
    const warnings = [...employment.warnings];

    const currency = (draft.compensation && draft.compensation.currency) || 'EUR';
    const coveredSeasonKeys = (draft.coveredSeasonKeys && draft.coveredSeasonKeys.length)
      ? draft.coveredSeasonKeys
      : (employment.contract ? employment.contract.coveredSeasonKeys : []);
    const costPlanBySeason = {};
    const perSeasonReservationLines = [];
    if (employment.contract) {
      coveredSeasonKeys.forEach((sKey) => {
        const breakdown = employment.contract.breakdownForSeason(sKey);
        if (breakdown.currency !== currency) {
          errors.push(
            `La temporada ${sKey} usa la moneda ${breakdown.currency}, distinta de la declarada en la oferta `
            + `(${currency}) — no se suman monedas distintas.`,
          );
          return;
        }
        const costPlan = computeSquadCostPlan({
          team, contractRegistry, marketRegistry, seasonKey: sKey, limitOverrideMinor: budgetLimitMinor,
        });
        costPlanBySeason[sKey] = costPlan;
        if (breakdown.guaranteedTotalMinor > costPlan.availableMinor) {
          errors.push(
            `La oferta de ${sKey} (${breakdown.guaranteedTotalMinor} minor) excede el disponible del límite `
            + `interno simulado (${costPlan.availableMinor} minor) para esa temporada.`,
          );
        }
        perSeasonReservationLines.push({ seasonKey: sKey, amountMinor: breakdown.guaranteedTotalMinor, currency });
      });
    } else {
      warnings.push('No se pudo construir un Contract efímero desde el borrador — no hay desglose por temporada disponible.');
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
      warnings,
      employmentValidation: employment,
      // Compatibilidad de lectura: `costPlan` sigue existiendo como el
      // plan de la temporada PRINCIPAL solicitada (si se pidió una), y
      // `costPlanBySeason` expone el desglose completo por temporada.
      costPlan: (seasonKey && costPlanBySeason[seasonKey]) || costPlanBySeason[coveredSeasonKeys[0]] || null,
      costPlanBySeason,
      perSeasonReservationLines,
      requiresTransferResolution: employment.requiresTransferResolution,
    };
  }

  // BUG-MARKET1-03 (DESIGN.md 9.20): antes existía un fallback
  // `params.validation || { valid: true, errors: [] }` que permitía a
  // cualquier llamador distinto de la UI enviar una oferta SIN validar
  // jugador/club/contrato/solapamiento/jurisdicción/presupuesto. Ahora
  // `createAndSendOffer()` exige las dependencias completas y VALIDA él
  // mismo internamente llamando a `validateOfferBeforeSend()` — la UI ya
  // no puede decidir que un borrador es válido. Además congela una copia
  // profunda del borrador ANTES de validar: una mutación posterior del
  // objeto de entrada nunca puede alterar lo ya validado ni su fingerprint.
  function deepFreezeClone(value) {
    const clone = JSON.parse(JSON.stringify(value));
    const freeze = (node) => {
      if (node && typeof node === 'object') {
        Object.values(node).forEach(freeze);
        Object.freeze(node);
      }
    };
    freeze(clone);
    return clone;
  }

  function createAndSendOffer(params) {
    const {
      marketRegistry, thread, draft, offeredBy, rolePromise, conditionsPrecedent, disclosures, date, careerSeed,
      marketContext, parentOfferId, version, maxOfficialDeadline,
      team, player, playerRegistry, contractRegistry, seasonKey, budgetLimitMinor,
    } = params;
    if (!team || !playerRegistry || !contractRegistry) {
      throw new Error(
        'MarketService.createAndSendOffer: faltan dependencias obligatorias (team/playerRegistry/contractRegistry) '
        + '— BUG-MARKET1-03: el comando valida SIEMPRE internamente, un llamador nunca puede saltarse la validación.',
      );
    }
    const frozenDraft = deepFreezeClone(draft);
    const iso = toIso(date);
    const resolvedSeasonKey = seasonKey || (frozenDraft.coveredSeasonKeys && frozenDraft.coveredSeasonKeys[0]);
    const validation = validateOfferBeforeSend({
      draft: frozenDraft, team, player, playerRegistry, contractRegistry, marketRegistry, seasonKey: resolvedSeasonKey, date: iso, marketContext, budgetLimitMinor,
    });
    if (!validation.valid) {
      throw new Error(`MarketService.createAndSendOffer: borrador inválido — ${validation.errors.join(' | ')}`);
    }
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
      clubId: frozenDraft.clubId,
      contractDraft: frozenDraft,
      rolePromise: rolePromise || null,
      conditionsPrecedent: conditionsPrecedent || [],
      disclosures: disclosures || [],
      employmentValidationSnapshot: {
        valid: validation.employmentValidation.valid, requiresTransferResolution: validation.employmentValidation.requiresTransferResolution,
      },
      marketRulesSnapshot: marketContext ? { bundleId: marketContext.bundleId } : null,
      provenance: { dataSource: 'market-negotiation', isReal: false },
    });
    marketRegistry.registerOffer(offer);
    thread.addOfferId(offer.id);

    // BUG-MARKET1-05: reserva por GRUPO (una línea por temporada), nunca
    // bajo `coveredSeasonKeys[0]` solamente.
    marketRegistry.reserveBudgetGroup(`res:${offer.id}`, validation.perSeasonReservationLines.map((line) => ({
      clubId: frozenDraft.clubId, seasonKey: line.seasonKey, amountMinor: line.amountMinor, currency: line.currency,
      sourceType: 'offer', sourceId: offer.id,
    })));

    // Ofertas del CLUB esperan respuesta del jugador/agente (CPU): se
    // programa un evento NO interactivo (game.js lo procesa solo al
    // avanzar el reloj, sección 15.3) — nunca bloquea "Continuar", a
    // diferencia de una contraoferta viva del lado jugador (sección 15.4).
    if (offeredBy === 'club') {
      marketRegistry.scheduleEvent({
        id: `${offer.id}:offer-response`,
        type: 'offer-response',
        dueDate: NegSvc().scheduleResponseDate({ fingerprint, fromDate: iso, maxOfficialDeadline: expiresAt }),
        clubId: frozenDraft.clubId,
        playerId: thread.playerId,
        threadId: thread.id,
        requiresAttention: false,
        payload: { offerId: offer.id, playerId: thread.playerId },
      });
    }

    return offer;
  }

  // Retirada — solo mientras el estado lo permita (sección 12.4).
  function withdrawOffer(marketRegistry, offerId, date) {
    const offer = marketRegistry.requireOffer(offerId);
    if (offer.statusOn(toIso(date)) !== 'sent') {
      throw new Error(`MarketService.withdrawOffer: la oferta "${offerId}" no está en estado retirable.`);
    }
    offer.addEvent({ id: `${offerId}:withdrawn`, type: 'offer-withdrawn', date: toIso(date) });
    marketRegistry.releaseBudgetGroup(`res:${offerId}`);
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
          marketRegistry.releaseBudgetGroup(`res:${offer.id}`);
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
      team, contractRegistry, seasonKey,
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
      marketRegistry.releaseBudgetGroup(`res:${offer.id}`);
      return { evaluation, outcome: 'rejected', offer };
    }

    // counter — supera la versión anterior con una NUEVA oferta, nunca
    // muta la vieja (invariante 6).
    offer.addEvent({ id: `${offer.id}:countered`, type: 'offer-countered', date: iso });
    marketRegistry.releaseBudgetGroup(`res:${offer.id}`);
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
    // BUG-MARKET1-03: la contraoferta pasa por el MISMO createAndSendOffer
    // que valida internamente — nunca se salta la validación por ser una
    // contraoferta generada por el motor.
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
      team,
      player,
      playerRegistry,
      contractRegistry,
      seasonKey,
    });
    return {
      evaluation, outcome: 'countered', offer, counterOffer,
    };
  }

  // ---------------------------------------------------------------------
  // 7. Acuerdo en principio (sección 8.6, 12.1).
  //
  // BUG-MARKET1-06 (DESIGN.md 9.20): antes `validUntil` podía quedar
  // `null` (vivo para siempre) y no se comprobaba que oferta/hilo/jugador/
  // club/reserva/derecho de tanteo fueran REALMENTE coherentes entre sí.
  // Ahora la creación:
  //  - exige `validUntil` (declarado o derivado de una política
  //    versionada, `AIP_DEFAULT_VALIDITY_DAYS`, nunca un plazo mágico);
  //  - valida que la oferta pertenezca al hilo y coincida en jugador/club;
  //  - valida que exista el grupo de reserva de la oferta aceptada (BUG-
  //    MARKET1-05) y esté activo;
  //  - valida, si se declara, que el resultado de tanteo pertenezca al
  //    mismo jugador.
  // ---------------------------------------------------------------------
  const AIP_DEFAULT_VALIDITY_DAYS = 30;
  const AIP_VALIDITY_POLICY_VERSION = 'simulated-aip-validity-policy-v1';

  function createAgreementInPrinciple(params) {
    const {
      marketRegistry, thread, offer, date, employmentSnapshot, marketRulesSnapshot, rightsOutcomeId, validUntil,
    } = params;
    const iso = toIso(date);
    if (offer.threadId !== thread.id) {
      throw new Error(`MarketService.createAgreementInPrinciple: la oferta "${offer.id}" no pertenece al hilo "${thread.id}".`);
    }
    if (offer.playerId !== thread.playerId || offer.clubId !== thread.actingClubId) {
      throw new Error('MarketService.createAgreementInPrinciple: la oferta no coincide en jugador/club con el hilo.');
    }
    if (offer.statusOn(iso) !== 'accepted') {
      throw new Error('MarketService.createAgreementInPrinciple: la oferta debe estar aceptada por el jugador.');
    }
    if (marketRegistry.hasLiveAgreementForPlayer(thread.playerId, iso)) {
      throw new Error(`MarketService.createAgreementInPrinciple: "${thread.playerId}" ya tiene un acuerdo en principio vivo (invariante 8).`);
    }
    const reservationGroupId = `res:${offer.id}`;
    const reservationLines = marketRegistry.getBudgetReservationGroup(reservationGroupId);
    if (!reservationLines || !reservationLines.length || !reservationLines.every((line) => line.status === 'active')) {
      throw new Error(
        `MarketService.createAgreementInPrinciple: el grupo de reserva "${reservationGroupId}" de la oferta `
        + 'aceptada no existe o no está activo (BUG-MARKET1-06: la reserva debe existir, estar activa y coincidir con su coste).',
      );
    }
    if (rightsOutcomeId) {
      const rightsCase = marketRegistry.getRightsCase(rightsOutcomeId);
      if (!rightsCase || rightsCase.playerId !== thread.playerId) {
        throw new Error(`MarketService.createAgreementInPrinciple: el caso de derechos "${rightsOutcomeId}" no pertenece a este jugador/operación.`);
      }
    }
    const resolvedValidUntil = validUntil || LD().addDays(iso, AIP_DEFAULT_VALIDITY_DAYS);
    const agreement = new MarketEntities.AgreementInPrinciple({
      id: `aip:${thread.id}:${offer.id}`,
      threadId: thread.id,
      acceptedOfferId: offer.id,
      playerId: thread.playerId,
      clubId: offer.clubId,
      acceptedAt: iso,
      validUntil: resolvedValidUntil,
      validityPolicyVersion: AIP_VALIDITY_POLICY_VERSION,
      conditionsPrecedent: offer.conditionsPrecedent,
      rightsOutcomeId: rightsOutcomeId || null,
      employmentSnapshot: employmentSnapshot || {},
      marketRulesSnapshot: marketRulesSnapshot || null,
      // La reserva del acuerdo REUTILIZA la de la oferta aceptada — nunca
      // se reserva dos veces (sección 11: "un acuerdo conserva la reserva").
      budgetReservationGroupId: reservationGroupId,
      provenance: { dataSource: 'market-negotiation', isReal: false },
    });
    marketRegistry.registerAgreement(agreement);
    thread.setAgreementId(agreement.id);
    thread.addEvent({ id: `${thread.id}:agreement-created`, type: 'agreement-created', date: iso });
    return agreement;
  }

  // ---------------------------------------------------------------------
  // 8. Parada obligatoria del reloj (sección 15.4) — primer punto que
  //    exige una DECISIÓN del usuario para este club, antes de una fecha
  //    objetivo: una contraoferta viva esperando respuesta, o una
  //    decisión de igualar en un derecho preferente del que el club es
  //    origen. Consultas/respuestas automáticas (interés inicial,
  //    respuesta CPU a una oferta del usuario) NUNCA aparecen aquí — se
  //    procesan solas al avanzar el reloj (processDueMarketEventsToDate,
  //    game.js).
  // ---------------------------------------------------------------------
  function computeMarketAttentionForClub(params) {
    const { marketRegistry, clubId, date } = params;
    if (!marketRegistry || !clubId) return null;
    const iso = toIso(date);
    const items = [];
    marketRegistry.threadsForClub(clubId).forEach((thread) => {
      const live = marketRegistry.offersForThread(thread.id).find((o) => o.isLiveOn(iso) && o.offeredBy === 'player-side');
      if (live) {
        items.push({
          type: 'offer-response-needed', dueDate: live.expiresAt, threadId: thread.id, offerId: live.id, playerId: thread.playerId,
        });
      }
    });
    marketRegistry.rightsCasesForClub(clubId).forEach((rightsCase) => {
      if (rightsCase.statusOn(iso) === 'matching-window-open' && rightsCase.deadlines.matchingWindow) {
        items.push({
          type: 'matching-decision-needed', dueDate: rightsCase.deadlines.matchingWindow.closes, rightsCaseId: rightsCase.id, playerId: rightsCase.playerId,
        });
      }
    });
    if (!items.length) return null;
    items.sort((a, b) => LD().compare(a.dueDate, b.dueDate));
    return items[0];
  }

  // BUG-MARKET1-07 (DESIGN.md 9.20): regla INCLUSIVA ÚNICA compartida por
  // Home y `advanceGameClockTo()` — antes Home invocaba
  // `computeMarketAttentionForClub()` con la fecha de HOY (nunca la fecha
  // objetivo real de la siguiente acción) y sustituía "Continuar" por
  // CUALQUIER atención viva, aunque venciera mucho después del próximo
  // partido; mientras tanto `advanceGameClockTo()` solo bloqueaba con una
  // comparación EXCLUSIVA (`isAfter`), así que una atención que vencía
  // EXACTAMENTE el mismo día del salto no bloqueaba ahí tampoco. Las dos
  // fronteras usan ahora esta MISMA consulta pura, con `throughDate`
  // OBLIGATORIO: bloquea si `attention.dueDate <= throughDate` (inclusive).
  function attentionBlocksThrough(attention, throughDate) {
    if (!attention) return false;
    if (!throughDate) {
      throw new Error('MarketService.attentionBlocksThrough: falta "throughDate" (obligatorio, BUG-MARKET1-07).');
    }
    return LD().compare(attention.dueDate, toIso(throughDate)) <= 0;
  }

  const exportsObj = {
    MarketService: {
      computeMarketAttentionForClub,
      attentionBlocksThrough,
      MARKET_BUDGET_POLICY_VERSION,
      AIP_DEFAULT_VALIDITY_DAYS,
      AIP_VALIDITY_POLICY_VERSION,
      addWatch,
      removeWatch,
      resolveMarketAvailability,
      resolveMarketContext,
      computeInternalBudgetLimit,
      computeSquadCostPlan,
      resolveActingMandate,
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
