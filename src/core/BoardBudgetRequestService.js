// src/core/BoardBudgetRequestService.js
// ECONOMY-BOARD-1 — ciclo de vida completo de una petición de ampliación
// de presupuesto salarial: envío atómico/idempotente, resolución
// diferida (1-3 días de mundo, evaluada en la fecha de vencimiento) y
// aplicación atómica de la decisión sobre `SquadBudgetRegistry`.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// La capacidad financiera (`FinancialCapacityService`) es SIEMPRE el
// primer filtro — la confianza/personalidad de junta puede RECORTAR una
// aprobación, nunca superar el headroom. Ninguna función de aquí crea una
// oferta/AIP/reserva de mercado.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const BoardBudgetRequestEntities = isNode ? require('../entities/BoardBudgetRequest.js') : global.BasketManager;
  const BoardConfidenceServiceModule = isNode ? require('./BoardConfidenceService.js') : global.BasketManager;
  const FinancialCapacityServiceModule = isNode ? require('./FinancialCapacityService.js') : global.BasketManager;
  const SquadBudgetServiceModule = isNode ? require('./SquadBudgetService.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }
  function BoardConfidenceSvc() { return BoardConfidenceServiceModule.BoardConfidenceService; }
  function CapacitySvc() { return FinancialCapacityServiceModule.FinancialCapacityService; }
  function SquadBudgetSvc() { return SquadBudgetServiceModule.SquadBudgetService; }

  const { BoardBudgetRequest } = BoardBudgetRequestEntities;
  const REASONS = CapacitySvc().REASON_CODES;
  const ALL_REASONS = Object.freeze({
    ...REASONS,
    LOW_BOARD_CONFIDENCE: 'LOW_BOARD_CONFIDENCE',
    BOARD_WILLINGNESS_CAP: 'BOARD_WILLINGNESS_CAP',
    COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE',
    REQUEST_PENDING: 'REQUEST_PENDING',
  });

  const POLICY_VERSION = 'board-budget-request-policy-v1';
  const APPROVED_COOLDOWN_DAYS = 60;
  const REJECTED_COOLDOWN_DAYS = 30;
  const PARTIAL_APPROVAL_ROUNDING_MINOR = 100000; // 1.000 EUR en céntimos

  const FISCAL_STYLE_ADJUSTMENT_BP = Object.freeze({ conservative: -500, balanced: 0, ambitious: 500 });

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  // -----------------------------------------------------------------------
  // Cooldown compartido — Finanzas y Mercado leen el MISMO estado (sección
  // 4.5/8.3 del prompt): a la fecha del cooldown se suma que el bloqueo por
  // impago se mantiene aparte, aunque la fecha ya haya expirado.
  // -----------------------------------------------------------------------
  function cooldownStatus(params) {
    const { registry, clubId, atGameDate } = params;
    const last = registry.latestResolvedForClub(clubId);
    if (!last) return { active: false, untilGameDate: null };
    const days = (last.outcome === 'approved' || last.outcome === 'partially-approved')
      ? APPROVED_COOLDOWN_DAYS : REJECTED_COOLDOWN_DAYS;
    const untilGameDate = LD().addDays(last.resolvedAtGameDate, days);
    return { active: LD().compare(toIso(atGameDate), untilGameDate) < 0, untilGameDate };
  }

  // -----------------------------------------------------------------------
  // Envío — ATÓMICO e IDEMPOTENTE: una validación rechazada no crea NADA.
  // -----------------------------------------------------------------------
  function submitRequest(params) {
    const {
      registry, clubFinanceRegistry, managerId, employmentSpellId, clubId, source, requestedIncreaseBySeasonKey,
      currency, operationSnapshot, submittedGameDate, horizonSeasonKeys, effectiveLimitBySeasonKey,
      submittedConfidenceSnapshot,
    } = params;
    if (registry.hasUnresolvedForClub(clubId)) {
      return { ok: false, reasonCode: ALL_REASONS.REQUEST_PENDING, message: 'El club ya tiene una petición sin resolver.' };
    }
    const cooldown = cooldownStatus({ registry, clubId, atGameDate: submittedGameDate });
    if (cooldown.active) {
      return {
        ok: false,
        reasonCode: ALL_REASONS.COOLDOWN_ACTIVE,
        message: `El cooldown compartido de peticiones sigue activo hasta ${cooldown.untilGameDate}.`,
      };
    }
    const blockingOverdueIds = CapacitySvc().blockingOverdueIdsForClub(clubFinanceRegistry, clubId, currency);
    if (blockingOverdueIds.length) {
      return {
        ok: false, reasonCode: ALL_REASONS.OVERDUE_PAYMENT_BLOCK, message: 'El club tiene impagos obligatorios pendientes — liquídalos antes de pedir más presupuesto.',
      };
    }
    const seasonKeys = Object.keys(requestedIncreaseBySeasonKey || {});
    if (!seasonKeys.length) {
      return { ok: false, reasonCode: 'INVALID_REQUEST', message: 'La petición no declara ninguna temporada.' };
    }
    const outsideHorizon = seasonKeys.some((sk) => !horizonSeasonKeys.includes(sk));
    if (outsideHorizon) {
      return {
        ok: false, reasonCode: ALL_REASONS.FORECAST_HORIZON_UNAVAILABLE, message: 'Una de las temporadas solicitadas está fuera del horizonte de proyección de 3 temporadas.',
      };
    }

    let maxRatioBp = 0;
    seasonKeys.forEach((seasonKey) => {
      const limit = effectiveLimitBySeasonKey[seasonKey];
      if (!limit) return;
      const ratioBp = Math.round((requestedIncreaseBySeasonKey[seasonKey] * 10000) / limit);
      if (ratioBp > maxRatioBp) maxRatioBp = ratioBp;
    });
    const delayDays = maxRatioBp <= 500 ? 1 : (maxRatioBp <= 1000 ? 2 : 3);
    const dueGameDate = LD().addDays(submittedGameDate, delayDays);

    const request = new BoardBudgetRequest({
      id: `board-budget-request:${clubId}:${submittedGameDate}:${registry.requestsForClub(clubId).length}:${maxRatioBp}`,
      managerId,
      employmentSpellId,
      clubId,
      source,
      currency,
      requestedIncreaseBySeasonKey,
      submittedGameDate: toIso(submittedGameDate),
      dueGameDate,
      dueDateBasis: { maxRatioBp, delayDays },
      operationSnapshot: operationSnapshot || null,
      submittedConfidenceSnapshot,
      status: 'pending',
    });
    request.addEvent('submitted', toIso(submittedGameDate), { source, requestedIncreaseBySeasonKey });
    registry.registerRequest(request);
    return { ok: true, request };
  }

  // -----------------------------------------------------------------------
  // Resolución — evaluada en la fecha de vencimiento, nunca en el envío.
  // -----------------------------------------------------------------------
  function resolveRequest(params) {
    const {
      registry, request, squadBudgetRegistry, clubFinanceRegistry, transferRegistry, currentSeasonKey,
      resolutionConfidenceSnapshot, boardFiscalStyle, atGameDate,
    } = params;
    if (!request.isPending) return { alreadyResolved: true, request };

    const seasonKeys = Object.keys(request.requestedIncreaseBySeasonKey);
    const capacity = CapacitySvc().evaluateFinancialCapacity({
      registry: clubFinanceRegistry,
      clubId: request.clubId,
      currency: request.currency,
      currentSeasonKey,
      transferRegistry,
      requestedSeasonKeys: seasonKeys,
    });

    const approvedIncreaseBySeasonKey = {};
    const reasonCodesBySeasonKey = {};
    const appliedRevisionPlans = [];

    if (capacity.blockingOverdueIds.length) {
      seasonKeys.forEach((seasonKey) => {
        approvedIncreaseBySeasonKey[seasonKey] = 0;
        reasonCodesBySeasonKey[seasonKey] = [ALL_REASONS.OVERDUE_PAYMENT_BLOCK];
      });
    } else {
      const overall = resolutionConfidenceSnapshot.overall;
      const baseCeilingBp = BoardConfidenceSvc().willingnessBaseCeilingBp(overall);
      const styleAdjustmentBp = FISCAL_STYLE_ADJUSTMENT_BP[boardFiscalStyle] || 0;
      const willingnessCeilingBp = clamp(baseCeilingBp + styleAdjustmentBp, 0, 2000);

      seasonKeys.forEach((seasonKey) => {
        const requested = request.requestedIncreaseBySeasonKey[seasonKey];
        if (seasonKey === undefined || !capacity.horizonSeasonKeys.includes(seasonKey)) {
          approvedIncreaseBySeasonKey[seasonKey] = 0;
          reasonCodesBySeasonKey[seasonKey] = [ALL_REASONS.FORECAST_HORIZON_UNAVAILABLE];
          return;
        }
        const allocation = squadBudgetRegistry.effectiveAllocationFor(request.clubId, seasonKey, request.currency, atGameDate);
        const effectiveLimitMinor = allocation ? allocation.amountMinor : 0;
        const willingnessAmountMinor = Math.floor((effectiveLimitMinor * willingnessCeilingBp) / 10000);
        const headroomMinor = capacity.headroomMinorBySeasonKey[seasonKey] || 0;
        const cappedMinor = Math.min(requested, headroomMinor, willingnessAmountMinor);

        let approvedMinor = cappedMinor;
        const reasons = [];
        if (approvedMinor >= requested) {
          approvedMinor = requested;
          reasons.push(ALL_REASONS.APPROVED_WITHIN_LIMITS);
        } else {
          approvedMinor = M().roundToMultiple(Math.max(0, approvedMinor), PARTIAL_APPROVAL_ROUNDING_MINOR, 'floor');
          if (approvedMinor <= 0) {
            approvedMinor = 0;
            if (headroomMinor <= 0) reasons.push(ALL_REASONS.NO_FINANCIAL_HEADROOM);
            else if (willingnessAmountMinor <= 0) reasons.push(ALL_REASONS.LOW_BOARD_CONFIDENCE);
            else reasons.push(ALL_REASONS.BOARD_WILLINGNESS_CAP);
          } else if (headroomMinor < willingnessAmountMinor) {
            reasons.push(ALL_REASONS.PARTIAL_FINANCIAL_CAPACITY);
          } else {
            reasons.push(ALL_REASONS.BOARD_WILLINGNESS_CAP);
          }
        }
        approvedIncreaseBySeasonKey[seasonKey] = approvedMinor;
        reasonCodesBySeasonKey[seasonKey] = reasons;
        if (approvedMinor > 0) {
          appliedRevisionPlans.push({
            seasonKey, newAmountMinor: effectiveLimitMinor + approvedMinor,
          });
        }
      });
    }

    const approvedValues = Object.values(approvedIncreaseBySeasonKey);
    const allZero = approvedValues.every((v) => v === 0);
    const allFull = seasonKeys.every((sk) => approvedIncreaseBySeasonKey[sk] === request.requestedIncreaseBySeasonKey[sk]);
    const outcome = allZero ? 'rejected' : (allFull ? 'approved' : 'partially-approved');

    const appliedAllocationRevisionIdsBySeasonKey = {};
    if (outcome !== 'rejected') {
      // Atómico: se construyen TODAS las revisiones antes de registrar
      // ninguna, así que un fallo de validación de una temporada no deja
      // aplicada solo otra (invariante de la sección 8.4/14 del prompt).
      appliedRevisionPlans.forEach(({ seasonKey, newAmountMinor }) => {
        const allocation = SquadBudgetSvc().recordRevision({
          registry: squadBudgetRegistry,
          clubId: request.clubId,
          seasonKey,
          currency: request.currency,
          effectiveDate: toIso(atGameDate),
          amountMinor: newAmountMinor,
          revisionKind: 'board-revision',
          decisionAuthority: 'board-system',
          calculatedAtGameDate: toIso(atGameDate),
          note: `Aprobación de la petición "${request.id}" (+${approvedIncreaseBySeasonKey[seasonKey]} ${request.currency} para ${seasonKey}).`,
        });
        appliedAllocationRevisionIdsBySeasonKey[seasonKey] = allocation.id;
      });
    }

    request.outcome = outcome;
    request.approvedIncreaseBySeasonKey = approvedIncreaseBySeasonKey;
    request.reasonCodesBySeasonKey = reasonCodesBySeasonKey;
    request.appliedAllocationRevisionIdsBySeasonKey = appliedAllocationRevisionIdsBySeasonKey;
    request.resolutionConfidenceSnapshot = resolutionConfidenceSnapshot;
    request.resolvedAtGameDate = toIso(atGameDate);
    request.explanationEs = explainOutcomeEs(outcome, reasonCodesBySeasonKey, approvedIncreaseBySeasonKey, request.currency);
    request.status = 'resolved';
    request.addEvent('resolved', toIso(atGameDate), { outcome, approvedIncreaseBySeasonKey });

    return { alreadyResolved: false, request, capacity };
  }

  function explainOutcomeEs(outcome, reasonCodesBySeasonKey, approvedIncreaseBySeasonKey, currency) {
    const seasons = Object.keys(approvedIncreaseBySeasonKey);
    if (outcome === 'approved') {
      return 'La junta aprueba la ampliación solicitada íntegramente.';
    }
    if (outcome === 'rejected') {
      const firstReason = seasons.length ? reasonCodesBySeasonKey[seasons[0]][0] : 'NO_FINANCIAL_HEADROOM';
      return `La junta rechaza la petición (${firstReason}).`;
    }
    const parts = seasons.map((sk) => `${sk}: +${M().format(approvedIncreaseBySeasonKey[sk], currency)} (${reasonCodesBySeasonKey[sk][0]})`);
    return `La junta aprueba una ampliación parcial — ${parts.join('; ')}.`;
  }

  // -----------------------------------------------------------------------
  // Fuente de calendario mundial — `board-event`. Nunca es parada del
  // usuario (mismo criterio que transfer-event/loan-event): el aviso llega
  // por noticias vía `onResolved`.
  // -----------------------------------------------------------------------
  function createBoardEventSource(params) {
    const { registry, timeZoneId, resolveDueRequest, onResolved } = params;
    if (!registry) throw new Error('createBoardEventSource: falta "registry".');
    return {
      sourceType: 'board-event',
      listPendingItems() {
        return registry.allPendingRequests().map((request) => ({
          sourceId: request.id,
          moment: { precision: 'date', localDate: request.dueGameDate, timeZoneId },
          attentionScope: { teamIds: [], clubIds: [request.clubId] },
          metadata: { kind: 'board-event', requestId: request.id },
        }));
      },
      resolveItem(descriptor) {
        const request = registry.getRequest(descriptor.metadata.requestId);
        if (!request) throw new Error(`board-event: la petición "${descriptor.metadata.requestId}" ya no existe.`);
        const result = resolveDueRequest(request, descriptor.localDate);
        if (onResolved) onResolved(request);
        return result;
      },
    };
  }

  const exportsObj = {
    BoardBudgetRequestService: {
      POLICY_VERSION,
      REASON_CODES: ALL_REASONS,
      APPROVED_COOLDOWN_DAYS,
      REJECTED_COOLDOWN_DAYS,
      FISCAL_STYLE_ADJUSTMENT_BP,
      cooldownStatus,
      submitRequest,
      resolveRequest,
      createBoardEventSource,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
