// src/core/RightOfFirstRefusalService.js
// MARKET-1 (DESIGN.md 9.19, sección 13 del prompt) — máquina de estados
// del procedimiento ACB de derecho preferente (general/inscripción
// preferente, art. 13-15) y del procedimiento de retorno (art. 17).
// Construido sobre `resolved.market.domesticProcedure`
// (CompetitionRules.resolveMarketRules) — NUNCA sobre
// `if (division === '1ª')` ni ningún literal de competición. Convención
// del proyecto: identificadores en inglés, comentarios en español.
//
// Un documento de oferta de tercero sujeto a tanteo NO crea inmediatamente
// un AgreementInPrinciple con el ofertante — mientras el derecho esté
// abierto, la reserva económica se mantiene y el resultado queda
// condicionado (sección 13). Este servicio nunca registra un contrato ni
// muta roster/afiliación (eso es TRANSFER-1).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const MarketEntities = isNode ? require('../entities/Market.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // ---------------------------------------------------------------------
  // 1. Apertura del caso y cálculo de plazos FIJOS (sección 13/6.2 art.
  //    14) — 3+3+3+13 días desde el último partido oficial; forwarding/
  //    matching/deposit se calculan MÁS TARDE, relativos a la fecha REAL
  //    de presentación del documento de oferta (nunca fijos desde d0).
  // ---------------------------------------------------------------------
  function computeFixedWindows(lastOfficialMatchDate, procedureRules) {
    const d0 = toIso(lastOfficialMatchDate);
    const deadlines = procedureRules.generalProcedureDeadlinesNaturalDays;
    const statusReportOpens = LD().addDays(d0, 1);
    const statusReportCloses = LD().addDays(d0, deadlines.clubStatusReportingDays);
    const listPublicationCloses = LD().addDays(statusReportCloses, deadlines.listPublicationDays);
    const qoWindowOpens = LD().addDays(listPublicationCloses, 1);
    const qoWindowCloses = LD().addDays(listPublicationCloses, deadlines.qualifyingOfferAccreditationDays);
    const thirdPartyDays = procedureRules.thirdPartyOfferSheetDaysOverride || deadlines.thirdPartyOfferSheetDays;
    const thirdPartyWindowOpens = LD().addDays(qoWindowCloses, 1);
    const thirdPartyWindowCloses = LD().addDays(qoWindowCloses, thirdPartyDays);
    return {
      statusReportingWindow: { opens: statusReportOpens, closes: statusReportCloses },
      listPublicationDeadline: listPublicationCloses,
      qualifyingOfferWindow: { opens: qoWindowOpens, closes: qoWindowCloses },
      thirdPartyOfferWindow: { opens: thirdPartyWindowOpens, closes: thirdPartyWindowCloses },
    };
  }

  // `marketContext.market.domesticProcedure` ya trae `procedureRules`
  // COMPUESTOS (general o preferente, sección 13.4 — mismo discriminador
  // `procedureType`, distintos NÚMEROS). Congelados al abrir el caso
  // (sección 9.1: "un caso congela sus módulos de firma al abrirse").
  function buildProcedureRules(marketContext, procedureType) {
    const dp = marketContext.market.domesticProcedure;
    if (!dp) {
      throw new Error('RightOfFirstRefusalService: el contexto de mercado no resuelve ningún procedimiento doméstico (competición sin módulo, invariante 32).');
    }
    if (procedureType === 'preferred-registration') {
      if (!dp.preferredRegistrationRight) {
        throw new Error('RightOfFirstRefusalService: el módulo doméstico no declara inscripción preferente (art. 15).');
      }
      return {
        procedureType,
        generalProcedureDeadlinesNaturalDays: dp.generalProcedureDeadlinesNaturalDays,
        // Art. 15.3.2: 12 días, DISTINTO de los 13 generales — conservado
        // como particularidad de fuente (sección 6.2), nunca "corregido".
        thirdPartyOfferSheetDaysOverride: dp.preferredRegistrationRight.thirdPartyOfferSheetDays,
        qualifyingOfferMinimumMultiplierBySeason: dp.preferredRegistrationRight.qualifyingOfferMinimumMultiplierBySeason,
        maxAgeInclusive: dp.preferredRegistrationRight.maxAgeInclusive,
        maxConsecutiveExercises: dp.preferredRegistrationRight.maxConsecutiveExercises,
        communicationDeadlineMonthDay: dp.preferredRegistrationRight.communicationDeadlineMonthDay,
        matchableComponents: dp.matchableComponents,
        ignoredForMatchingComponents: dp.ignoredForMatchingComponents,
        offerSheetRequiredFields: dp.offerSheetRequiredFields,
      };
    }
    return {
      procedureType,
      generalProcedureDeadlinesNaturalDays: dp.generalProcedureDeadlinesNaturalDays,
      qualifyingOffer: dp.qualifyingOffer,
      matchableComponents: dp.matchableComponents,
      ignoredForMatchingComponents: dp.ignoredForMatchingComponents,
      offerSheetRequiredFields: dp.offerSheetRequiredFields,
    };
  }

  function openCase(params) {
    const {
      marketRegistry, playerId, originClubId, lastOfficialMatchDate, procedureType, marketContext, id,
    } = params;
    const procedureRules = buildProcedureRules(marketContext, procedureType || 'right-of-first-refusal');
    const deadlines = computeFixedWindows(lastOfficialMatchDate, procedureRules);
    const rightsCase = new MarketEntities.RightOfFirstRefusalCase({
      id: id || `rights-case:${originClubId}:${playerId}:${toIso(lastOfficialMatchDate)}`,
      playerId,
      originClubId,
      lastOfficialMatchDate,
      procedureType: procedureType || 'right-of-first-refusal',
      procedureRules,
      sourceModuleId: marketContext.trace.fields.domesticProcedure
        ? marketContext.trace.fields.domesticProcedure[0].ruleModuleId : null,
      deadlines,
      provenance: { dataSource: 'market-rights-procedure', isReal: false },
    });
    marketRegistry.registerRightsCase(rightsCase);
    // Fases 1-4 del art. 14 son HECHOS de calendario automáticos (nunca
    // una decisión de nadie) — se registran de una vez al abrir el caso,
    // con sus fechas REALES ya calculadas, para dejar el caso listo para
    // el primer punto de decisión real (oferta cualificada).
    rightsCase.addEvent({ id: `${rightsCase.id}:reporting-open`, type: 'status-reporting-open', date: deadlines.statusReportingWindow.opens });
    rightsCase.addEvent({ id: `${rightsCase.id}:reporting-closed`, type: 'status-reported', date: deadlines.statusReportingWindow.closes });
    rightsCase.addEvent({ id: `${rightsCase.id}:list-published`, type: 'eligible-list-published', date: deadlines.listPublicationDeadline });
    rightsCase.addEvent({ id: `${rightsCase.id}:qo-window-open`, type: 'qualifying-offer-window-open', date: deadlines.qualifyingOfferWindow.opens });
    return rightsCase;
  }

  // ---------------------------------------------------------------------
  // 2. Oferta cualificada (sección 13.1, art. 13).
  // ---------------------------------------------------------------------
  function fileQualifyingOffer(params) {
    const {
      rightsCase, filedByClubId, filedAt, monetizedAnnualValueMinor, currency, lastContract, ageOnJuly1,
      consecutiveExerciseCount, debtChallengeConfirmed,
    } = params;
    const iso = toIso(filedAt);
    const window = rightsCase.deadlines.qualifyingOfferWindow;
    if (LD().isBefore(iso, window.opens) || LD().isAfter(iso, window.closes)) {
      throw new Error(`RightOfFirstRefusalService.fileQualifyingOffer: fuera de la ventana (${window.opens}..${window.closes}).`);
    }
    let minimumRequiredMinor;
    let maxExercises;
    if (rightsCase.procedureType === 'preferred-registration') {
      const seasonIndex = Math.min(consecutiveExerciseCount, 2); // 0,1,2 -> temporadas 1ª/2ª/3ª
      const multiplier = rightsCase.procedureRules.qualifyingOfferMinimumMultiplierBySeason[seasonIndex];
      minimumRequiredMinor = Math.round((params.applicableMinimumSalaryMinor || 0) * multiplier);
      maxExercises = rightsCase.procedureRules.maxConsecutiveExercises;
    } else {
      // Art. 13: 100% del valor monetizado de la última retribución anual.
      const lastAnnualMinor = lastContract ? lastContract.breakdownForSeason(lastContract.coveredSeasonKeys[0]).guaranteedTotalMinor : 0;
      minimumRequiredMinor = Math.round(lastAnnualMinor * (rightsCase.procedureRules.qualifyingOffer.firstExtensionMinimumPercentOfLastMonetizedAnnual / 100));
      maxExercises = ageOnJuly1 !== undefined && ageOnJuly1 !== null && ageOnJuly1 < 30
        ? rightsCase.procedureRules.qualifyingOffer.maxConsecutiveExercisesUpToAge30
        : rightsCase.procedureRules.qualifyingOffer.maxConsecutiveExercisesFromAge30;
    }
    const qo = new MarketEntities.QualifyingOfferCase({
      id: `${rightsCase.id}:qo`,
      rightsCaseId: rightsCase.id,
      filedByClubId,
      filedAt: iso,
      currency,
      monetizedAnnualValueMinor,
      minimumRequiredMinor,
      ageOnComputationDate: ageOnJuly1 !== undefined ? ageOnJuly1 : null,
      consecutiveExerciseCount: consecutiveExerciseCount || 0,
      maxConsecutiveExercises: maxExercises,
      debtChallengeConfirmed: Boolean(debtChallengeConfirmed),
      sourceRuleIds: [rightsCase.sourceModuleId],
    });
    rightsCase.setQualifyingOffer(qo);
    const eventType = qo.valid ? 'qualifying-offer-filed' : 'right-invalidated';
    rightsCase.addEvent({ id: `${rightsCase.id}:${eventType}`, type: eventType, date: iso });
    if (eventType === 'qualifying-offer-filed') {
      rightsCase.addEvent({
        id: `${rightsCase.id}:third-party-window`, type: 'third-party-offer-window-open', date: rightsCase.deadlines.thirdPartyOfferWindow.opens,
      });
    }
    return qo;
  }

  // Sin oferta cualificada dentro de plazo -> el derecho caduca (sección
  // 13, art. 13) — idempotente: no repite el evento si ya se procesó.
  function lapseQualifyingOfferIfDue(rightsCase, date) {
    const iso = toIso(date);
    if (rightsCase.statusOn(iso) !== 'qualifying-offer-window-open') return false;
    if (!LD().isAfter(iso, rightsCase.deadlines.qualifyingOfferWindow.closes)) return false;
    rightsCase.addEvent({ id: `${rightsCase.id}:qo-lapsed`, type: 'qualifying-offer-lapsed', date: iso });
    rightsCase.addEvent({ id: `${rightsCase.id}:resolved-lapsed`, type: 'procedure-resolved', date: iso });
    return true;
  }

  // ---------------------------------------------------------------------
  // 3. Documento de oferta de tercero (sección 13.2, art. 14.4).
  // ---------------------------------------------------------------------
  function fileOfferSheet(params) {
    const {
      rightsCase, marketRegistry, filedByClubId, filedAt, contractDraftSummary, playerSignedMarker, clubSignedMarker,
    } = params;
    const iso = toIso(filedAt);
    if (rightsCase.offerSheet) {
      throw new Error(`RightOfFirstRefusalService.fileOfferSheet: el caso "${rightsCase.id}" ya tiene un documento de oferta (un jugador solo presenta uno, invariante 26).`);
    }
    const window = rightsCase.deadlines.thirdPartyOfferWindow;
    if (LD().isBefore(iso, window.opens) || LD().isAfter(iso, window.closes)) {
      throw new Error(`RightOfFirstRefusalService.fileOfferSheet: fuera de la ventana (${window.opens}..${window.closes}).`);
    }
    const requiredFields = rightsCase.procedureRules.offerSheetRequiredFields;
    const missing = requiredFields.filter((f) => contractDraftSummary[f] === undefined || contractDraftSummary[f] === null);
    if (missing.length) {
      throw new Error(`RightOfFirstRefusalService.fileOfferSheet: faltan campos obligatorios: ${missing.join(', ')}.`);
    }
    if (!playerSignedMarker || !clubSignedMarker) {
      throw new Error('RightOfFirstRefusalService.fileOfferSheet: el documento exige marca de firma de jugador Y club ofertante.');
    }
    const forwardedAt = LD().addDays(iso, 1);
    const matchingWindow = { opens: forwardedAt, closes: LD().addDays(forwardedAt, rightsCase.procedureRules.generalProcedureDeadlinesNaturalDays.originClubMatchingWindowDays) };
    rightsCase.setOfferSheet({
      filedByClubId, filedAt: iso, contractDraftSummary, playerSignedMarker: true, clubSignedMarker: true, forwardedAt, matchingWindow,
    });
    rightsCase.deadlines = { ...rightsCase.deadlines, forwardedAt, matchingWindow };

    if (marketRegistry) {
      const guaranteedTotalMinor = contractDraftSummary.economicTotalMinor || 0;
      marketRegistry.reserveBudget({
        id: `res:rights:${rightsCase.id}`,
        clubId: filedByClubId,
        seasonKey: contractDraftSummary.seasonKey || null,
        amountMinor: guaranteedTotalMinor,
        currency: contractDraftSummary.currency || 'EUR',
        sourceType: 'rights-offer-sheet',
        sourceId: rightsCase.id,
      });
    }

    rightsCase.addEvent({ id: `${rightsCase.id}:sheet-filed`, type: 'offer-sheet-filed', date: iso });
    rightsCase.addEvent({ id: `${rightsCase.id}:sheet-forwarded`, type: 'offer-sheet-forwarded', date: forwardedAt });
    rightsCase.addEvent({ id: `${rightsCase.id}:matching-open`, type: 'matching-window-open', date: forwardedAt });
    return rightsCase.offerSheet;
  }

  // ---------------------------------------------------------------------
  // 4. Comparador NORMATIVO (sección 10.3) — componentes exactos del art.
  //    14, nunca utilidad subjetiva. `rolePromise`/minutos quedan
  //    explícitamente FUERA de la igualación.
  // ---------------------------------------------------------------------
  function compareOfferToMatch(offerSheetSummary, matchProposalSummary) {
    const matchedFields = [];
    const unmatchedFields = [];
    const ignoredForMatching = ['rolePromise', 'expectedMinutes', 'nonSalaryHousing', 'personalPreferences'];

    function compareAtLeast(field, offerVal, matchVal) {
      if ((matchVal || 0) >= (offerVal || 0)) matchedFields.push(field);
      else unmatchedFields.push(field);
    }

    compareAtLeast('economicTotal', offerSheetSummary.economicTotalMinor, matchProposalSummary.economicTotalMinor);
    compareAtLeast('inKindValuation', offerSheetSummary.inKindValuationMinor, matchProposalSummary.inKindValuationMinor);
    compareAtLeast('agentFees', offerSheetSummary.agentFeesMinor, matchProposalSummary.agentFeesMinor);
    compareAtLeast('terminationClause', offerSheetSummary.terminationClauseMinor, matchProposalSummary.terminationClauseMinor);

    if ((matchProposalSummary.durationSeasons || 0) >= (offerSheetSummary.durationSeasons || 0)) matchedFields.push('duration');
    else unmatchedFields.push('duration');

    // Art. 14: el cómputo económico global debe dividirse en 10
    // mensualidades — comprobado como componente propio, no fusionado con
    // el total económico.
    if ((matchProposalSummary.installmentCount || 0) >= 10) matchedFields.push('tenMonthlyInstallments');
    else unmatchedFields.push('tenMonthlyInstallments');

    return {
      matchable: unmatchedFields.length === 0,
      matchedFields,
      unmatchedFields,
      ignoredForMatching,
      sourceRuleIds: [],
      trace: { comparedAt: 'RightOfFirstRefusalService.compareOfferToMatch' },
    };
  }

  // ---------------------------------------------------------------------
  // 5. Decisión de igualar del club de origen (sección 13.3).
  // ---------------------------------------------------------------------
  function decideMatching(params) {
    const {
      rightsCase, decision, decidedBy, decidedAt, matchProposalSummary,
    } = params;
    const iso = toIso(decidedAt);
    const window = rightsCase.deadlines.matchingWindow;
    if (!window) throw new Error('RightOfFirstRefusalService.decideMatching: el caso todavía no tiene documento de oferta trasladado.');
    if (LD().isAfter(iso, window.closes)) {
      throw new Error('RightOfFirstRefusalService.decideMatching: plazo de 5 días naturales improrrogable ya vencido.');
    }
    if (!['match', 'waive'].includes(decision)) {
      throw new Error(`RightOfFirstRefusalService.decideMatching: decisión desconocida "${decision}".`);
    }

    let comparison = null;
    if (decision === 'match') {
      comparison = compareOfferToMatch(rightsCase.offerSheet.contractDraftSummary, matchProposalSummary);
      if (!comparison.matchable) {
        throw new Error(`RightOfFirstRefusalService.decideMatching: la propuesta NO iguala componentes exactos: ${comparison.unmatchedFields.join(', ')}.`);
      }
    }

    const deadlines = rightsCase.procedureRules.generalProcedureDeadlinesNaturalDays;
    const depositDays = decision === 'match' ? deadlines.contractDepositIfMatchedDays : deadlines.contractDepositIfNotMatchedDays;
    const eventType = decision === 'match' ? 'origin-matched' : 'origin-waived';
    rightsCase.setMatchingDecision({
      decidedBy, decision, decidedAt: iso, matchProposalSummary: matchProposalSummary || null, comparison,
    });
    rightsCase.addEvent({ id: `${rightsCase.id}:${eventType}`, type: eventType, date: iso });
    const depositDeadline = LD().addDays(iso, depositDays);
    rightsCase.deadlines = { ...rightsCase.deadlines, depositDeadline };
    rightsCase.addEvent({ id: `${rightsCase.id}:deposit-pending`, type: 'contract-deposit-pending', date: iso });

    if (decision === 'waive') {
      // Libera la reserva del tercero — la oferta puede consolidarse tras
      // el depósito (sección 13, TRANSFER-1 ejecuta el registro real).
      // MARKET-1 no libera aquí la reserva porque el AIP con el tercero
      // se crea aparte (MarketService) y conserva su propia reserva.
    }
    return rightsCase;
  }

  // Sin decisión del club de origen dentro de plazo -> se trata como NO
  // igualado (art. 14.6) — idempotente.
  function lapseMatchingIfDue(rightsCase, date) {
    const iso = toIso(date);
    if (rightsCase.statusOn(iso) !== 'matching-window-open') return false;
    if (!rightsCase.deadlines.matchingWindow || !LD().isAfter(iso, rightsCase.deadlines.matchingWindow.closes)) return false;
    rightsCase.addEvent({ id: `${rightsCase.id}:matching-lapsed`, type: 'matching-deadline-lapsed', date: iso });
    const deadlines = rightsCase.procedureRules.generalProcedureDeadlinesNaturalDays;
    const depositDeadline = LD().addDays(iso, deadlines.contractDepositIfNotMatchedDays);
    rightsCase.deadlines = { ...rightsCase.deadlines, depositDeadline };
    rightsCase.addEvent({ id: `${rightsCase.id}:deposit-pending-lapsed`, type: 'contract-deposit-pending', date: iso });
    return true;
  }

  function resolveProcedure(rightsCase, date) {
    const iso = toIso(date);
    if (rightsCase.statusOn(iso) !== 'contract-deposit-pending') return false;
    rightsCase.addEvent({ id: `${rightsCase.id}:resolved`, type: 'procedure-resolved', date: iso });
    return true;
  }

  // Decisión CPU determinista (club de origen) — sección 13.3: capacidad
  // económica, necesidad posicional, calidad conocida, edad, duración,
  // proyecto — nunca intenciones ocultas del usuario.
  function decideMatchingDeterministic(params) {
    const {
      rightsCase, costPlan, matchProposalSummary, fingerprint,
    } = params;
    const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;
    const Rnd = DeterministicRandomModule.DeterministicRandom;
    const canAfford = matchProposalSummary.economicTotalMinor <= costPlan.availableMinor + costPlan.reservedMinor;
    if (!canAfford) return 'waive';
    // Pequeña variación determinista de "proyecto deportivo" (no hay
    // necesidad posicional modelada en detalle en esta entrega) — nunca
    // Math.random().
    const roll = Rnd.unitFrom(fingerprint, `origin-match:${rightsCase.id}`);
    return roll < 0.6 ? 'match' : 'waive';
  }

  // ---------------------------------------------------------------------
  // 6. Retorno (art. 17) — procedimiento DISTINTO, tres opciones.
  // ---------------------------------------------------------------------
  function openReturnRightsCase(params) {
    const {
      marketRegistry, playerId, originClubId, lastOfficialMatchDate, id,
    } = params;
    const deadline = LD().addDays(toIso(lastOfficialMatchDate), 3);
    const rrCase = new MarketEntities.ReturnRightsCase({
      id: id || `return-case:${originClubId}:${playerId}:${toIso(lastOfficialMatchDate)}`,
      playerId,
      originClubId,
      lastOfficialMatchDate,
      decisionDeadline: deadline,
      provenance: { dataSource: 'market-rights-procedure', isReal: false },
    });
    marketRegistry.registerReturnRightsCase(rrCase);
    return rrCase;
  }

  function decideReturnRightsOption(rrCase, option, decidedAt, matchingSurchargePercent) {
    rrCase.chooseOption(option, decidedAt);
    if (option === 'wait-for-third-party-offer' && matchingSurchargePercent) {
      rrCase.matchingSurchargePercent = matchingSurchargePercent;
    }
    return rrCase;
  }

  const exportsObj = {
    RightOfFirstRefusalService: {
      buildProcedureRules,
      computeFixedWindows,
      openCase,
      fileQualifyingOffer,
      lapseQualifyingOfferIfDue,
      fileOfferSheet,
      compareOfferToMatch,
      decideMatching,
      lapseMatchingIfDue,
      resolveProcedure,
      decideMatchingDeterministic,
      openReturnRightsCase,
      decideReturnRightsOption,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
