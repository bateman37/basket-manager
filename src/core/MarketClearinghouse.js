// src/core/MarketClearinghouse.js
// CYCLE-1 (DESIGN.md 9.22, sección 15 del prompt) — FASE 2 de la
// planificación CPU: resuelve las PROPUESTAS de todos los clubes por rondas,
// de forma DETERMINISTA, y ejecuta las ganadoras mediante los servicios de
// dominio YA existentes. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Reglas permanentes:
//  - agrupa propuestas por jugador/operación, valida versiones/reservas y
//    deja que el jugador/agente COMPARE ofertas con la utilidad cualitativa
//    de MARKET-1 (`NegotiationService`) — nunca "la primera del array";
//  - resuelve conflictos en ORDEN CANÓNICO estable (playerId, y a igualdad
//    clubId) y desempata por importe garantizado y luego por clubId;
//  - ejecuta ganadores SOLO por los servicios canónicos: `RenewalService`
//    (MARKET+CONTRACT), `TransferService.formalizeFreeAgentSigning`
//    (MARKET+TRANSFER) y `AcademyService.promoteToFirstTeam`. NUNCA escribe
//    directamente en registries ajenos "para simplificar la CPU";
//  - cualquier commit fallido se revierte por completo (la saga vive en los
//    servicios de ejecución) y queda registrado como `failed`;
//  - publica resultados/noticias SOLO tras receipt: este módulo no
//    construye ninguna noticia (game.js lo hace después del commit real);
//  - abre cada ronda nueva desde un snapshot NUEVO.
//
// Módulo puro: no lee DOM ni `state`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CanonicalHashModule = isNode ? require('../utils/CanonicalHash.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;
  const CycleEntities = isNode ? require('../entities/Cycle.js') : global.BasketManager;
  const ContractEntities = isNode ? require('../entities/Contract.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const ContractSeederModule = isNode ? require('./ContractSeeder.js') : global.BasketManager;
  const MarketServiceModule = isNode ? require('./MarketService.js') : global.BasketManager;
  const NegotiationServiceModule = isNode ? require('./NegotiationService.js') : global.BasketManager;
  const TransferServiceModule = isNode ? require('./TransferService.js') : global.BasketManager;
  const RenewalServiceModule = isNode ? require('./RenewalService.js') : global.BasketManager;
  const AcademyServiceModule = isNode ? require('./AcademyService.js') : global.BasketManager;
  const PlayerDevelopmentModule = isNode ? require('./PlayerDevelopment.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function Hash() { return CanonicalHashModule.CanonicalHash; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }
  function CC() { return CycleConfigModule.CycleConfig; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function ContractSeeder() { return ContractSeederModule.ContractSeeder; }
  function MarketSvc() { return MarketServiceModule.MarketService; }
  function NegSvc() { return NegotiationServiceModule.NegotiationService; }
  function TransferSvc() { return TransferServiceModule.TransferService; }
  function RenewalSvc() { return RenewalServiceModule.RenewalService; }
  function AcademySvc() { return AcademyServiceModule.AcademyService; }
  function PD() { return PlayerDevelopmentModule; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // =====================================================================
  // 1. Borrador de contrato para un fichaje de AGENTE LIBRE
  // =====================================================================
  // Calibración de JUEGO (no una norma): parte del mínimo salarial REAL
  // resuelto para el perfil del club y añade una banda por calidad VISIBLE
  // (TMB) dentro del rango bajo del perfil económico de su competición —
  // exactamente el mismo criterio que `ContractSeeder.seedContractForNewPlayer`
  // usa para una incorporación con la partida en marcha, aquí expresado como
  // BORRADOR (para que pase por oferta/aceptación real) en vez de como
  // contrato ya registrado.
  function buildFreeAgentOfferDraft(params) {
    const {
      player, team, resolved, seasonKey, date, fingerprint, config, budgetAvailableMinor,
    } = params;
    const iso = toIso(date);
    const employment = resolved.employment;
    const currency = (employment.allowedCurrencies && employment.allowedCurrencies[0]) || 'EUR';
    const declaredBasis = (employment.allowedBases && employment.allowedBases[0]) || 'gross';
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
    const economicProfile = ContractSeeder().getEconomicProfile(competitionId);
    const legalFloorMinor = employment.effectiveMinimumAnnual ? employment.effectiveMinimumAnnual.amountMinor : 0;
    const tmb = PD().computeTmbRating(player, config);
    const qualityIndex = Math.max(0, Math.min(1, (tmb - 40) / 120));
    const bandMinor = Math.round(economicProfile.lowPayrollMinor * 0.08 * qualityIndex);
    let salaryMinor = Math.max(legalFloorMinor, legalFloorMinor + bandMinor);
    // Nunca por encima de lo que el club tiene disponible en su presupuesto
    // interno (y nunca por debajo del mínimo legal: si no cabe, no se oferta).
    if (budgetAvailableMinor !== undefined && budgetAvailableMinor !== null) {
      const cap = Math.floor(budgetAvailableMinor * CC().CPU_PLANNING.maxSingleOperationBudgetShare);
      if (cap < legalFloorMinor) return null;
      salaryMinor = Math.max(legalFloorMinor, Math.min(salaryMinor, cap));
    }

    const seasons = CC().resolveInitialContractSeasons(
      fingerprint, 'free-agent-duration', employment.maxTermYears, CC().NEW_CONTRACT_DURATION_WEIGHTS,
    );
    const coveredSeasonKeys = [];
    for (let i = 0; i < seasons; i += 1) coveredSeasonKeys.push(LD().addSeasons(seasonKey, i));
    const firstWindow = LD().seasonWindow(coveredSeasonKeys[0]);
    const lastWindow = LD().seasonWindow(coveredSeasonKeys[coveredSeasonKeys.length - 1]);
    const startDate = LD().isAfter(iso, firstWindow.startDate) ? iso : firstWindow.startDate;
    const endDate = lastWindow.endDate;
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
      ContractEntities.buildPaymentSchedule({
        totalMinor: salaryMinor,
        installmentCount: Math.max(1, Math.min(installmentCount, periodsAvailable)),
        firstDueDate: LD().endOfMonth(anchorStartDate),
        frequency,
        currency,
        seasonKey: key,
      }).forEach((installment) => schedule.push(installment));
    });

    return {
      id: `contract:free-agent:${team.id}:${player.id}:${seasonKey}`,
      playerId: player.id,
      clubId: team.id,
      contractType: 'professional-player',
      signedDate: startDate,
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
        installmentCount, frequency, scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'], schedule,
      },
      clauses: [],
      declaredDocuments: [...new Set(['written-contract', ...employment.requiredDocuments])],
      representation: { agentId: null, mandateId: null },
      minorProtections: null,
      transactionScope: 'domestic',
      provenance: {
        dataSource: 'simulated-contract-v2-free-agent', isReal: false, generatorVersion: CC().CPU_PLANNING.clearinghouseVersion, seedFingerprint: fingerprint,
      },
    };
  }

  // =====================================================================
  // 2. Ronda del clearinghouse
  // =====================================================================
  function runRound(params) {
    const {
      snapshot, proposals, deps, cycle, roundIndex, date, seasonKey, careerSeed, config, userClubId,
      resolvedByCompetitionId,
    } = params;
    const iso = toIso(date);
    const {
      annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry,
      marketRegistry, agentRegistry, transferRegistry, teams, lineup, calibration, operationalContext,
    } = deps;

    const round = new CycleEntities.ClearingRound({
      id: `clearing:${cycle.id}:r${roundIndex}`,
      cycleId: cycle.id,
      roundIndex,
      openedAt: iso,
      snapshotFingerprint: snapshot.fingerprint,
      plannerVersion: CC().CPU_PLANNING.plannerVersion,
      clearinghouseVersion: CC().CPU_PLANNING.clearinghouseVersion,
      seed: `${careerSeed || 'no-career-seed'}|clearing|${cycle.id}|${roundIndex}`,
      provenance: { dataSource: 'simulated-clearing-v1', isReal: false },
    });
    annualCycleRegistry.registerClearingRound(round);
    round.addEvent({ id: `${round.id}:opened`, type: 'round-opened', date: iso });
    round.addEvent({ id: `${round.id}:snapshot`, type: 'snapshot-frozen', date: iso, fingerprint: snapshot.fingerprint });

    // (1) Propuestas ADMITIDAS: nunca las del club del usuario sin su
    // consentimiento explícito (sección 15: "el planificador no acepta,
    // rechaza, renueva ni ficha en su nombre"). Sus propias ofertas SÍ
    // compiten aquí cuando el usuario las envía (llegan ya como propuestas
    // marcadas `submittedByUser`).
    const admitted = proposals
      .filter((proposal) => proposal.clubId !== userClubId || proposal.submittedByUser === true)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    round.admittedProposalIds.push(...admitted.map((p) => p.id));
    round.addEvent({ id: `${round.id}:admitted`, type: 'proposals-admitted', date: iso, data: { count: admitted.length } });

    // (2) Agrupación por jugador+operación y ORDEN CANÓNICO de resolución.
    const byPlayer = new Map();
    admitted.forEach((proposal) => {
      const key = proposal.playerId;
      const list = byPlayer.get(key) || [];
      list.push(proposal);
      byPlayer.set(key, list);
    });
    const resolutionOrder = [...byPlayer.keys()].sort();
    round.canonicalResolutionOrder.push(...resolutionOrder);

    const decisions = [];
    const teamsById = new Map((teams || []).map((team) => [team.id, team]));

    resolutionOrder.forEach((playerId) => {
      const competing = byPlayer.get(playerId).sort((a, b) => (a.id < b.id ? -1 : 1));
      const player = playerRegistry.get(playerId);
      if (!player) {
        competing.forEach((proposal) => {
          decisions.push(recordDecision({
            annualCycleRegistry, round, proposal, competing, outcome: 'failed', date: iso, failureReason: 'PLAYER_NOT_FOUND',
          }));
        });
        return;
      }

      // (3) El jugador/agente COMPARA: se puntúa cada propuesta con la
      // utilidad CUALITATIVA de MARKET-1 (`NegotiationService.qualityIndex`
      // + importe garantizado ofrecido) y se desempata de forma estable.
      const scored = competing.map((proposal) => {
        const team = teamsById.get(proposal.clubId);
        const resolvedRules = resolvedByCompetitionId
          ? resolvedByCompetitionId[CompetitionRules.competitionIdFromLegacyDivision(team.division)] : null;
        return {
          proposal,
          team,
          resolvedRules,
          // Preferencia del jugador: reputación deportiva visible del club +
          // hueco real en su plantilla. Nunca Potencial/Ambición exactos.
          preference: (team && team.reputation ? team.reputation.sporting : 50) / 100,
          offeredMinor: proposal.type === 'free-agent-signing' ? (proposal.budgetAvailableMinor || 0) : 0,
        };
      }).sort((a, b) => (
        (b.preference - a.preference)
        || (b.offeredMinor - a.offeredMinor)
        || (a.proposal.clubId < b.proposal.clubId ? -1 : 1)
      ));

      const winner = scored[0];
      const losers = scored.slice(1);

      // (4) Ejecución del ganador por los servicios canónicos.
      let executed = { outcome: 'failed', failureReason: 'NOT_EXECUTED' };
      try {
        if (winner.proposal.type === 'renewal') {
          executed = executeRenewal({
            deps, cycle, proposal: winner.proposal, team: winner.team, player, resolved: winner.resolvedRules,
            seasonKey, date: iso, careerSeed, config,
          });
        } else if (winner.proposal.type === 'free-agent-signing') {
          executed = executeFreeAgentSigning({
            deps, cycle, proposal: winner.proposal, team: winner.team, player, resolved: winner.resolvedRules,
            seasonKey, date: iso, careerSeed, config, operationalContext,
          });
        } else if (winner.proposal.type === 'academy-promotion') {
          executed = executeAcademyPromotion({
            deps, proposal: winner.proposal, team: winner.team, player, seasonKey, date: iso, config,
          });
        }
      } catch (err) {
        executed = { outcome: 'failed', failureReason: err.message };
        round.failedCommits.push({ proposalId: winner.proposal.id, reason: err.message });
      }

      decisions.push(recordDecision({
        annualCycleRegistry,
        round,
        proposal: winner.proposal,
        competing,
        outcome: executed.outcome,
        date: iso,
        transactionId: executed.transactionId || null,
        failureReason: executed.failureReason || null,
        playerChoiceReasons: executed.reasons || [],
      }));
      if (executed.transactionId) round.committedTransactionIds.push(executed.transactionId);

      losers.forEach((entry) => {
        decisions.push(recordDecision({
          annualCycleRegistry,
          round,
          proposal: entry.proposal,
          competing,
          outcome: 'lost',
          date: iso,
          playerChoiceReasons: ['El jugador ha preferido otro destino en esta ronda.'],
        }));
      });
    });

    round.decisionIds.push(...decisions.map((d) => d.id));
    round.addEvent({ id: `${round.id}:resolved`, type: 'decisions-resolved', date: iso, data: { decisions: decisions.length } });
    round.addEvent({ id: `${round.id}:commits`, type: 'commits-applied', date: iso, data: { committed: round.committedTransactionIds.length } });
    round.finalFingerprint = Hash().stableHash({
      roundId: round.id,
      decisions: decisions.map((d) => ({
        proposalId: d.proposalId, playerId: d.playerId, clubId: d.clubId, outcome: d.outcome,
      })),
    });
    round.addEvent({ id: `${round.id}:closed`, type: 'round-closed', date: iso, fingerprint: round.finalFingerprint });

    void agentRegistry;
    void marketRegistry;
    void registrationRegistry;
    void contractRegistry;
    void academyRegistry;
    void transferRegistry;
    void lineup;
    void calibration;
    void Rnd;
    return { round, decisions };
  }

  function recordDecision(params) {
    const {
      annualCycleRegistry, round, proposal, competing, outcome, date, transactionId, failureReason, playerChoiceReasons,
    } = params;
    const decision = new CycleEntities.ClearingDecision({
      id: `clearing-decision:${round.id}:${proposal.id}`,
      roundId: round.id,
      playerId: proposal.playerId,
      operationType: proposal.type,
      proposalId: proposal.id,
      clubId: proposal.clubId,
      outcome: outcome === 'committed' ? 'won' : outcome,
      decidedAt: date,
      playerChoiceReasons: playerChoiceReasons || [],
      competingProposalIds: competing.map((p) => p.id).sort(),
      transactionId: transactionId || null,
      failureReason: failureReason || null,
    });
    annualCycleRegistry.registerClearingDecision(decision);
    return decision;
  }

  // --- Ejecución: RENOVACIÓN (MARKET + CONTRACT) ------------------------
  function executeRenewal(params) {
    const {
      deps, cycle, proposal, team, player, resolved, seasonKey, date, careerSeed,
    } = params;
    const {
      annualCycleRegistry, marketRegistry, agentRegistry, playerRegistry, contractRegistry, teams,
    } = deps;
    const iso = toIso(date);
    const expiringContract = contractRegistry.currentForPlayer(player.id, iso);
    if (!expiringContract) {
      return { outcome: 'failed', failureReason: 'NO_EXPIRING_CONTRACT' };
    }
    const renewable = RenewalSvc().isRenewable({
      contract: expiringContract, annualCycleRegistry, contractRegistry, date: iso,
    });
    let renewalCase = annualCycleRegistry.liveRenewalCaseForPlayer(player.id, iso);
    if (!renewalCase) {
      if (!renewable.renewable) {
        return { outcome: 'expired', failureReason: renewable.reason };
      }
      renewalCase = RenewalSvc().openRenewalCase({
        annualCycleRegistry, cycle, player, team, expiringContract, date: iso, seasonKey,
      });
    }
    const marketContext = MarketSvc().resolveMarketContext({
      domesticCompetitionId: CompetitionRules.competitionIdFromLegacyDivision(team.division),
      seasonKey,
      date: iso,
    });
    const attempt = RenewalSvc().sendRenewalOfferAndResolve({
      annualCycleRegistry,
      marketRegistry,
      playerRegistry,
      contractRegistry,
      agentRegistry,
      renewalCase,
      player,
      team,
      expiringContract,
      resolved,
      seasonKey,
      date: iso,
      careerSeed,
      marketContext,
      // Límite interno CONGELADO del ciclo (sección 16): el propio plan ya
      // lo trae calculado desde la referencia de nómina de apertura.
      budgetLimitMinor: proposal.budgetLimitMinor,
    });
    if (attempt.outcome !== 'agreement-in-principle') {
      return {
        outcome: attempt.outcome === 'rejected' ? 'lost' : 'expired',
        failureReason: attempt.outcome,
        reasons: renewalCase.lastResponseReasons,
      };
    }
    const committed = RenewalSvc().commitRenewal({
      annualCycleRegistry,
      marketRegistry,
      contractRegistry,
      playerRegistry,
      renewalCase,
      player,
      team,
      resolved,
      seasonKey,
      date: iso,
      teams,
    });
    return {
      outcome: 'committed',
      transactionId: `tx:renewal:${renewalCase.id}`,
      reasons: renewalCase.lastResponseReasons,
      contractId: committed.contract ? committed.contract.id : null,
    };
  }

  // --- Ejecución: FICHAJE DE LIBRE (MARKET + TRANSFER) ------------------
  function executeFreeAgentSigning(params) {
    const {
      deps, cycle, proposal, team, player, resolved, seasonKey, date, careerSeed, config, operationalContext,
    } = params;
    const {
      marketRegistry, agentRegistry, playerRegistry, contractRegistry, registrationRegistry, transferRegistry, teams, lineup,
    } = deps;
    const iso = toIso(date);
    const fingerprint = `${careerSeed || 'no-career-seed'}|free-agent|${cycle.id}|${team.id}|${player.id}`;
    const draft = buildFreeAgentOfferDraft({
      player, team, resolved, seasonKey, date: iso, fingerprint, config, budgetAvailableMinor: proposal.budgetAvailableMinor,
    });
    if (!draft) return { outcome: 'expired', failureReason: 'NO_BUDGET_FOR_LEGAL_MINIMUM' };

    const marketContext = MarketSvc().resolveMarketContext({
      domesticCompetitionId: CompetitionRules.competitionIdFromLegacyDivision(team.division),
      seasonKey,
      date: iso,
    });
    // Hilo + oferta REALES de MARKET-1 (nunca un AIP fabricado a mano).
    const thread = MarketSvc().openInquiry({
      marketRegistry,
      agentRegistry,
      playerId: player.id,
      actingClubId: team.id,
      prospectiveCompetitionIds: [resolved.competitionId || null].filter(Boolean),
      date: iso,
      marketContext,
      careerSeed,
      playerRegistry,
      id: `thread:clearing:${cycle.id}:${team.id}:${player.id}`,
    });
    thread.addEvent({ id: `${thread.id}:confirmed`, type: 'interest-confirmed', date: iso });
    marketRegistry.markEventProcessed(`${thread.id}:interest-response`);

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
        budgetLimitMinor: proposal.budgetLimitMinor,
      });
    } catch (err) {
      return { outcome: 'expired', failureReason: `OFFER_INVALID: ${err.message}` };
    }
    marketRegistry.markEventProcessed(`${offer.id}:offer-response`);

    const evaluation = NegSvc().evaluateOffer({
      player, offer, priorOffers: [], rolePromise: null, fingerprint, roundIndex: 0,
    });
    if (evaluation.decision !== 'accept') {
      offer.addEvent({
        id: `${offer.id}:${evaluation.decision === 'reject' ? 'rejected' : 'countered'}`,
        type: evaluation.decision === 'reject' ? 'offer-rejected' : 'offer-countered',
        date: iso,
      });
      marketRegistry.releaseBudgetGroup(`res:${offer.id}`);
      return { outcome: 'lost', failureReason: `PLAYER_${evaluation.decision.toUpperCase()}`, reasons: evaluation.reasons || [] };
    }
    offer.addEvent({ id: `${offer.id}:accepted`, type: 'player-accepted', date: iso });
    const agreement = MarketSvc().createAgreementInPrinciple({
      marketRegistry,
      thread,
      offer,
      date: iso,
      employmentSnapshot: { profileId: resolved.profileId || null, seasonKey },
      marketRulesSnapshot: { bundleId: marketContext.bundleId },
    });

    // Formalización REAL por TRANSFER-1 — contrato + afiliación + licencia +
    // inscripción de forma atómica. El clearinghouse nunca las escribe.
    const { plan, result } = TransferSvc().formalizeFreeAgentSigning({
      transferRegistry,
      marketRegistry,
      registrationRegistry,
      contractRegistry,
      playerRegistry,
      teams,
      agreement,
      destinationTeam: team,
      seasonKey,
      effectiveDate: iso,
      now: iso,
      commit: true,
      operationalContext,
      lineup,
    });
    if (!result || !result.record) {
      return {
        outcome: 'failed',
        failureReason: plan && plan.blockers.length ? plan.blockers.map((b) => b.code).join(',') : 'TRANSFER_NOT_COMMITTED',
      };
    }
    return {
      outcome: 'committed',
      transactionId: result.record.id,
      reasons: evaluation.reasons || [],
    };
  }

  // --- Ejecución: PROMOCIÓN DE CANTERA ---------------------------------
  function executeAcademyPromotion(params) {
    const {
      deps, proposal, team, player, seasonKey, date, config,
    } = params;
    const {
      academyRegistry, playerRegistry, contractRegistry, registrationRegistry, teams, lineup, calibration,
    } = deps;
    const iso = toIso(date);
    const membership = academyRegistry ? academyRegistry.activeMembershipForPlayer(player.id, iso) : null;
    if (!membership) return { outcome: 'expired', failureReason: 'NO_ACTIVE_ACADEMY_MEMBERSHIP' };
    const promoted = AcademySvc().promoteToFirstTeam({
      academyRegistry,
      playerRegistry,
      contractRegistry,
      registrationRegistry,
      teams,
      membership,
      team,
      date: iso,
      seasonKey,
      config,
      calibration,
      lineup,
    });
    void proposal;
    return {
      outcome: 'committed',
      transactionId: `tx:academy-promotion:${membership.id}`,
      reasons: ['El club promociona a un joven de su cantera.'],
      contractId: promoted.contract ? promoted.contract.id : null,
    };
  }

  const exportsObj = {
    MarketClearinghouse: {
      buildFreeAgentOfferDraft,
      runRound,
      executeRenewal,
      executeFreeAgentSigning,
      executeAcademyPromotion,
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
