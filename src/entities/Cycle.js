// src/entities/Cycle.js
// CYCLE-1 (DESIGN.md 9.22, sección 6 del prompt) — entidades del ciclo anual
// de plantilla. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Principios estructurales (los mismos de CONTRACT-1/REG-1/MARKET-1/
// TRANSFER-1/LOAN-1, no se relajan aquí):
//  - el ESTADO se DERIVA del ledger append-only de eventos
//    (`CycleEventTypes.js`), nunca de un campo `status` mutable libre;
//  - todo importe es ENTERO en unidad mínima (`...Minor`) + moneda ISO;
//  - todas las fechas son civiles ISO `YYYY-MM-DD` (`LocalDate`), nunca
//    `Date.now()` ni el reloj del sistema;
//  - `toJSON()`/`snapshot()` devuelven objetos planos serializables (sin
//    cierres, funciones ni referencias circulares) — HARDEN-1 hará la
//    persistencia real y esta entrega no debe bloquearla;
//  - los datos SIMULADOS llevan `provenance.dataSource`/`isReal: false`
//    visibles; nunca se presentan como datos reales.
//
// Este archivo NO conoce Player/Team/Contract como clases (duck typing sobre
// ids), no lee el DOM y no toca ningún registro.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const CycleEventTypesModule = isNode ? require('../core/CycleEventTypes.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }
  function ET() { return CycleEventTypesModule.CycleEventTypes; }

  function requireIso(value, label) { return LD().requireIsoDate(value, label); }

  function requireId(value, label) {
    if (!value || typeof value !== 'string') {
      throw new Error(`Cycle: "${label}" debe ser un id string no vacío (recibido: ${JSON.stringify(value)}).`);
    }
    return value;
  }

  function normalizeProvenance(provenance, defaultDataSource) {
    const p = provenance || {};
    return {
      dataSource: p.dataSource || defaultDataSource || null,
      isReal: p.isReal === true,
      generatorVersion: p.generatorVersion || null,
      seedFingerprint: p.seedFingerprint || null,
    };
  }

  // Ledger append-only compartido por todas las entidades con máquina de
  // estados: valida contra su máquina, rechaza ids duplicados y cronología
  // incoherente, y NUNCA permite escribir `events` desde fuera.
  function makeEventLedger(machine, label) {
    return {
      addEvent(target, event) {
        const normalized = {
          id: requireId(event.id, `${label}.event.id`),
          type: event.type,
          date: requireIso(event.date, `${label}.event.date`),
          actor: event.actor || null,
          data: event.data ? JSON.parse(JSON.stringify(event.data)) : null,
          provenance: event.provenance || null,
          fingerprint: event.fingerprint || null,
        };
        const validation = machine.validateEvent(normalized, target.events);
        if (!validation.valid) {
          throw new Error(`${label}: evento inválido — ${validation.errors.join(' | ')}`);
        }
        target.events.push(normalized);
        return normalized;
      },
      // Reversión EXACTA de un `addEvent` (mismo criterio que
      // `Contract.removeLifecycleEvent`): la ÚNICA API que puede quitar un
      // evento, para que un rollback nunca toque el array directamente.
      removeEvent(target, id) {
        const index = target.events.findIndex((e) => e.id === id);
        if (index === -1) return null;
        return target.events.splice(index, 1)[0];
      },
      statusOn(target, date) {
        return machine.deriveStatus(target.events, date ? requireIso(date, 'date') : null);
      },
    };
  }

  // =====================================================================
  // 1. AnnualRosterCycle
  // =====================================================================
  const AnnualCycleLedger = makeEventLedger(ET().AnnualCycleEvents, 'AnnualRosterCycle');

  class AnnualRosterCycle {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'AnnualRosterCycle.id');
      this.fromSeasonKey = LD().isValidSeasonKey(d.fromSeasonKey) ? d.fromSeasonKey : (() => {
        throw new Error(`AnnualRosterCycle: fromSeasonKey inválido "${d.fromSeasonKey}".`);
      })();
      this.targetSeasonKey = LD().isValidSeasonKey(d.targetSeasonKey) ? d.targetSeasonKey : (() => {
        throw new Error(`AnnualRosterCycle: targetSeasonKey inválido "${d.targetSeasonKey}".`);
      })();
      this.openedAt = requireIso(d.openedAt, 'AnnualRosterCycle.openedAt');
      // Fingerprint canónico del mundo en el instante de abrir el ciclo
      // (`CanonicalHash.stableHash` de la instantánea ordenada por ids).
      this.openingWorldFingerprint = d.openingWorldFingerprint || null;
      // Composición REAL de competiciones al abrir el ciclo (antes de
      // aplicar ascensos/descensos): `[{ clubId, competitionId, division }]`.
      this.competitionMembershipSnapshot = (d.competitionMembershipSnapshot || []).map((row) => ({
        clubId: row.clubId, competitionId: row.competitionId, division: row.division,
      }));
      // Evidencia INMUTABLE del último partido oficial de CADA club — nunca
      // la fecha de la final para los 36 (sección 7 del prompt).
      this.clubLastOfficialMatchEvidence = (d.clubLastOfficialMatchEvidence || []).map((row) => ({
        clubId: row.clubId,
        date: requireIso(row.date, 'clubLastOfficialMatchEvidence.date'),
        competitionId: row.competitionId || null,
        phaseId: row.phaseId || null,
        matchId: row.matchId || null,
        opponentClubId: row.opponentClubId || null,
      }));
      // Calendario del verano: `[{ phaseId, date }]` (CycleConfig).
      this.summerSchedule = (d.summerSchedule || []).map((row) => ({
        phaseId: row.phaseId, date: requireIso(row.date, 'summerSchedule.date'),
      }));
      this.events = [];
      this.sourceVersion = d.sourceVersion || null;
      this.provenance = normalizeProvenance(d.provenance, 'simulated-cycle-v1');
    }

    addEvent(event) { return AnnualCycleLedger.addEvent(this, event); }

    removeEvent(id) { return AnnualCycleLedger.removeEvent(this, id); }

    // Fase DERIVADA del ledger — nunca un campo mutable.
    phaseOn(date) { return AnnualCycleLedger.statusOn(this, date); }

    currentPhase() { return AnnualCycleLedger.statusOn(this, null); }

    scheduledDateForPhase(phaseId) {
      const row = this.summerSchedule.find((entry) => entry.phaseId === phaseId);
      return row ? row.date : null;
    }

    lastOfficialMatchDateForClub(clubId) {
      const row = this.clubLastOfficialMatchEvidence.find((entry) => entry.clubId === clubId);
      return row ? row.date : null;
    }

    // Fecha más TARDÍA de los 36 clubes (apertura real del verano global).
    worldLastOfficialMatchDate() {
      return this.clubLastOfficialMatchEvidence
        .map((row) => row.date)
        .sort((a, b) => LD().compare(a, b))
        .pop() || null;
    }

    toJSON() {
      return {
        id: this.id,
        fromSeasonKey: this.fromSeasonKey,
        targetSeasonKey: this.targetSeasonKey,
        openedAt: this.openedAt,
        openingWorldFingerprint: this.openingWorldFingerprint,
        competitionMembershipSnapshot: this.competitionMembershipSnapshot.map((r) => ({ ...r })),
        clubLastOfficialMatchEvidence: this.clubLastOfficialMatchEvidence.map((r) => ({ ...r })),
        summerSchedule: this.summerSchedule.map((r) => ({ ...r })),
        events: this.events.map((e) => ({ ...e })),
        sourceVersion: this.sourceVersion,
        provenance: { ...this.provenance },
        currentPhase: this.currentPhase(),
      };
    }
  }

  // =====================================================================
  // 2. ClubCycleCase
  // =====================================================================
  const ClubCaseLedger = makeEventLedger(ET().ClubCycleCaseEvents, 'ClubCycleCase');

  class ClubCycleCase {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'ClubCycleCase.id');
      this.cycleId = requireId(d.cycleId, 'ClubCycleCase.cycleId');
      this.clubId = requireId(d.clubId, 'ClubCycleCase.clubId');
      // Competición doméstica de DESTINO (ya con ascenso/descenso aplicado).
      this.targetCompetitionId = requireId(d.targetCompetitionId, 'ClubCycleCase.targetCompetitionId');
      this.targetDivision = d.targetDivision || null;
      // Jurisdicción LABORAL del empleador — MoraBanc Andorra conserva AD
      // aunque compita en ACB (test transfronterizo obligatorio de la EPIC).
      this.employerJurisdictionId = requireId(d.employerJurisdictionId, 'ClubCycleCase.employerJurisdictionId');
      this.lastOfficialMatchDate = d.lastOfficialMatchDate
        ? requireIso(d.lastOfficialMatchDate, 'ClubCycleCase.lastOfficialMatchDate') : null;
      // Deadlines aplicables a ESTE club (algunos derivan de su propia fecha
      // de último partido: tanteo, retención).
      this.deadlines = d.deadlines ? JSON.parse(JSON.stringify(d.deadlines)) : {};
      // Referencia de nómina de apertura CONGELADA antes de que expiren
      // contratos (sección 16 del prompt: si se recalculara después de
      // liberar media plantilla, el presupuesto entraría en espiral).
      this.openingPayrollReference = d.openingPayrollReference
        ? {
          amountMinor: M().requireAmountMinor(d.openingPayrollReference.amountMinor, 'openingPayrollReference.amountMinor'),
          currency: M().requireCurrency(d.openingPayrollReference.currency),
          seasonKey: d.openingPayrollReference.seasonKey,
          frozenAt: requireIso(d.openingPayrollReference.frozenAt, 'openingPayrollReference.frozenAt'),
        }
        : null;
      this.requiredDecisions = [...(d.requiredDecisions || [])];
      this.completedDecisions = [...(d.completedDecisions || [])];
      this.planIds = [...(d.planIds || [])];
      this.legalityReportIds = [...(d.legalityReportIds || [])];
      this.blockingDiagnostics = [...(d.blockingDiagnostics || [])];
      this.events = [];
      this.provenance = normalizeProvenance(d.provenance, 'simulated-cycle-v1');
    }

    addEvent(event) { return ClubCaseLedger.addEvent(this, event); }

    removeEvent(id) { return ClubCaseLedger.removeEvent(this, id); }

    statusOn(date) { return ClubCaseLedger.statusOn(this, date); }

    currentStatus() { return ClubCaseLedger.statusOn(this, null); }

    isReady() { return this.currentStatus() === 'ready'; }

    // Decisiones OBLIGATORIAS del usuario todavía sin resolver — bloquean
    // "Continuar" por su deadline (sección 15 del prompt).
    pendingRequiredDecisions() {
      const completed = new Set(this.completedDecisions.map((entry) => entry.id));
      return this.requiredDecisions.filter((entry) => !completed.has(entry.id));
    }

    markDecisionCompleted(id, resolution, date) {
      this.completedDecisions.push({
        id: requireId(id, 'decision.id'),
        resolution: resolution || 'resolved',
        date: requireIso(date, 'decision.date'),
      });
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        clubId: this.clubId,
        targetCompetitionId: this.targetCompetitionId,
        targetDivision: this.targetDivision,
        employerJurisdictionId: this.employerJurisdictionId,
        lastOfficialMatchDate: this.lastOfficialMatchDate,
        deadlines: JSON.parse(JSON.stringify(this.deadlines)),
        openingPayrollReference: this.openingPayrollReference ? { ...this.openingPayrollReference } : null,
        requiredDecisions: this.requiredDecisions.map((r) => ({ ...r })),
        completedDecisions: this.completedDecisions.map((r) => ({ ...r })),
        planIds: [...this.planIds],
        legalityReportIds: [...this.legalityReportIds],
        blockingDiagnostics: this.blockingDiagnostics.map((r) => (typeof r === 'string' ? r : { ...r })),
        events: this.events.map((e) => ({ ...e })),
        provenance: { ...this.provenance },
        currentStatus: this.currentStatus(),
      };
    }
  }

  // =====================================================================
  // 3. ClubSquadPlan — plan INMUTABLE, versionado y PURO de una ronda.
  //    No es una mutación ni garantiza que las operaciones se completen.
  // =====================================================================
  class ClubSquadPlan {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'ClubSquadPlan.id');
      this.cycleId = requireId(d.cycleId, 'ClubSquadPlan.cycleId');
      this.clubId = requireId(d.clubId, 'ClubSquadPlan.clubId');
      this.roundIndex = Number.isInteger(d.roundIndex) ? d.roundIndex : 0;
      this.builtAt = requireIso(d.builtAt, 'ClubSquadPlan.builtAt');
      this.seasonKey = d.seasonKey;
      this.targetCompetitionId = d.targetCompetitionId || null;
      // Profundidad objetivo/actual por posición.
      this.positionDepth = JSON.parse(JSON.stringify(d.positionDepth || {}));
      this.targetDepthPerPosition = d.targetDepthPerPosition || null;
      // Listas de intención (NUNCA operaciones ejecutadas).
      this.retain = [...(d.retain || [])];
      this.renew = [...(d.renew || [])];
      this.release = [...(d.release || [])];
      this.loanOut = [...(d.loanOut || [])];
      this.listenToOffers = [...(d.listenToOffers || [])];
      this.sign = [...(d.sign || [])];
      this.promoteFromAcademy = [...(d.promoteFromAcademy || [])];
      // Necesidades de cupo (formación/no comunitario), riesgos y coste.
      this.quotaNeeds = JSON.parse(JSON.stringify(d.quotaNeeds || {}));
      this.medicalRisks = [...(d.medicalRisks || [])];
      this.contractRisks = [...(d.contractRisks || [])];
      this.currentCostMinor = M().requireAmountMinor(d.currentCostMinor || 0, 'currentCostMinor');
      this.futureCostMinor = M().requireAmountMinor(d.futureCostMinor || 0, 'futureCostMinor');
      this.budgetLimitMinor = M().requireAmountMinor(d.budgetLimitMinor || 0, 'budgetLimitMinor');
      this.budgetReservedMinor = M().requireAmountMinor(d.budgetReservedMinor || 0, 'budgetReservedMinor');
      this.budgetAvailableMinor = M().requireAmountMinor(d.budgetAvailableMinor || 0, 'budgetAvailableMinor');
      this.currency = M().requireCurrency(d.currency || 'EUR');
      this.registrationsConsumed = d.registrationsConsumed || 0;
      this.registrationsPlanned = d.registrationsPlanned || 0;
      this.sportingGoal = d.sportingGoal || null;
      // Razones CUALITATIVAS — nunca una puntuación exacta ni un atributo
      // oculto (Potencial/Ambición/Profesionalidad no salen nunca de aquí).
      this.reasons = [...(d.reasons || [])];
      this.snapshotFingerprint = requireId(d.snapshotFingerprint, 'ClubSquadPlan.snapshotFingerprint');
      this.plannerVersion = requireId(d.plannerVersion, 'ClubSquadPlan.plannerVersion');
      this.seed = d.seed || null;
      this.provenance = normalizeProvenance(d.provenance, 'simulated-cpu-plan-v1');
      // Inmutable: un plan es una FOTO, cualquier cambio es un plan nuevo
      // con id/versión propios.
      Object.freeze(this.positionDepth);
      Object.freeze(this.quotaNeeds);
      Object.freeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        clubId: this.clubId,
        roundIndex: this.roundIndex,
        builtAt: this.builtAt,
        seasonKey: this.seasonKey,
        targetCompetitionId: this.targetCompetitionId,
        positionDepth: { ...this.positionDepth },
        targetDepthPerPosition: this.targetDepthPerPosition,
        retain: [...this.retain],
        renew: [...this.renew],
        release: [...this.release],
        loanOut: [...this.loanOut],
        listenToOffers: [...this.listenToOffers],
        sign: [...this.sign],
        promoteFromAcademy: [...this.promoteFromAcademy],
        quotaNeeds: { ...this.quotaNeeds },
        medicalRisks: [...this.medicalRisks],
        contractRisks: [...this.contractRisks],
        currentCostMinor: this.currentCostMinor,
        futureCostMinor: this.futureCostMinor,
        budgetLimitMinor: this.budgetLimitMinor,
        budgetReservedMinor: this.budgetReservedMinor,
        budgetAvailableMinor: this.budgetAvailableMinor,
        currency: this.currency,
        registrationsConsumed: this.registrationsConsumed,
        registrationsPlanned: this.registrationsPlanned,
        sportingGoal: this.sportingGoal,
        reasons: [...this.reasons],
        snapshotFingerprint: this.snapshotFingerprint,
        plannerVersion: this.plannerVersion,
        seed: this.seed,
        provenance: { ...this.provenance },
      };
    }
  }

  // =====================================================================
  // 4. RenewalCase
  // =====================================================================
  const RenewalLedger = makeEventLedger(ET().RenewalCaseEvents, 'RenewalCase');

  class RenewalCase {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'RenewalCase.id');
      this.cycleId = requireId(d.cycleId, 'RenewalCase.cycleId');
      this.playerId = requireId(d.playerId, 'RenewalCase.playerId');
      this.clubId = requireId(d.clubId, 'RenewalCase.clubId');
      // Contrato que VENCE (nunca se muta: la renovación crea uno nuevo).
      this.expiringContractId = requireId(d.expiringContractId, 'RenewalCase.expiringContractId');
      this.expiringEndDate = requireIso(d.expiringEndDate, 'RenewalCase.expiringEndDate');
      // Contexto laboral de la NUEVA firma (jurisdicción del empleador en la
      // fecha de firma), congelado al abrir el expediente.
      this.employmentContextSnapshot = d.employmentContextSnapshot
        ? JSON.parse(JSON.stringify(d.employmentContextSnapshot)) : null;
      this.marketThreadId = d.marketThreadId || null;
      this.offerIds = [...(d.offerIds || [])];
      this.agreementInPrincipleId = d.agreementInPrincipleId || null;
      this.budgetReservationGroupId = d.budgetReservationGroupId || null;
      this.committedContractId = d.committedContractId || null;
      // Razones CUALITATIVAS de la última respuesta del jugador/agente.
      this.lastResponseReasons = [...(d.lastResponseReasons || [])];
      this.openedAt = requireIso(d.openedAt, 'RenewalCase.openedAt');
      this.windowOpensAt = d.windowOpensAt ? requireIso(d.windowOpensAt, 'RenewalCase.windowOpensAt') : null;
      this.windowClosesAt = d.windowClosesAt ? requireIso(d.windowClosesAt, 'RenewalCase.windowClosesAt') : null;
      this.events = [];
      this.provenance = normalizeProvenance(d.provenance, 'simulated-renewal-v1');
    }

    addEvent(event) { return RenewalLedger.addEvent(this, event); }

    removeEvent(id) { return RenewalLedger.removeEvent(this, id); }

    statusOn(date) { return RenewalLedger.statusOn(this, date); }

    currentStatus() { return RenewalLedger.statusOn(this, null); }

    isLiveOn(date) {
      const status = this.statusOn(date);
      return status !== null && !['committed', 'rejected', 'withdrawn', 'expired'].includes(status);
    }

    offerRounds() {
      return this.events.filter((e) => e.type === 'offer-sent').length;
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        playerId: this.playerId,
        clubId: this.clubId,
        expiringContractId: this.expiringContractId,
        expiringEndDate: this.expiringEndDate,
        employmentContextSnapshot: this.employmentContextSnapshot
          ? JSON.parse(JSON.stringify(this.employmentContextSnapshot)) : null,
        marketThreadId: this.marketThreadId,
        offerIds: [...this.offerIds],
        agreementInPrincipleId: this.agreementInPrincipleId,
        budgetReservationGroupId: this.budgetReservationGroupId,
        committedContractId: this.committedContractId,
        lastResponseReasons: [...this.lastResponseReasons],
        openedAt: this.openedAt,
        windowOpensAt: this.windowOpensAt,
        windowClosesAt: this.windowClosesAt,
        events: this.events.map((e) => ({ ...e })),
        provenance: { ...this.provenance },
        currentStatus: this.currentStatus(),
      };
    }
  }

  // =====================================================================
  // 5. ContractOptionDecision
  // =====================================================================
  const OptionLedger = makeEventLedger(ET().ContractOptionDecisionEvents, 'ContractOptionDecision');

  // Términos MÍNIMOS que una cláusula tipada debe traer completos para ser
  // EJECUTABLE (sección 10 del prompt). Ninguno se inventa: si falta uno, la
  // opción queda visible como NO ejecutable con el motivo exacto.
  const OPTION_REQUIRED_TERMS = ['window', 'addedSeasonKeys', 'compensationSeasons', 'entitledParty'];

  class ContractOptionDecision {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'ContractOptionDecision.id');
      this.cycleId = requireId(d.cycleId, 'ContractOptionDecision.cycleId');
      this.playerId = requireId(d.playerId, 'ContractOptionDecision.playerId');
      this.clubId = requireId(d.clubId, 'ContractOptionDecision.clubId');
      this.contractId = requireId(d.contractId, 'ContractOptionDecision.contractId');
      this.clauseId = requireId(d.clauseId, 'ContractOptionDecision.clauseId');
      // Tipo EXACTO de la cláusula del catálogo tipado de CONTRACT-1:
      // 'club-option' | 'player-option' | 'mutual-option' | 'automatic-renewal'.
      this.clauseType = requireId(d.clauseType, 'ContractOptionDecision.clauseType');
      this.entitledParty = d.entitledParty || null;
      this.window = d.window ? { fromDate: requireIso(d.window.fromDate, 'window.fromDate'), toDate: requireIso(d.window.toDate, 'window.toDate') } : null;
      this.addedSeasonKeys = [...(d.addedSeasonKeys || [])];
      // Términos completos de la/s temporada/s añadida/s (mismo shape que
      // `Contract.compensation.seasons`) — sin ellos NO es ejecutable.
      this.compensationSeasons = (d.compensationSeasons || []).map((s) => ({ ...s }));
      this.objectiveTrigger = d.objectiveTrigger ? JSON.parse(JSON.stringify(d.objectiveTrigger)) : null;
      this.triggerEvidence = d.triggerEvidence ? JSON.parse(JSON.stringify(d.triggerEvidence)) : null;
      this.missingTerms = [...(d.missingTerms || [])];
      this.newContractId = d.newContractId || null;
      this.events = [];
      this.provenance = normalizeProvenance(d.provenance, 'simulated-option-decision-v1');
    }

    addEvent(event) { return OptionLedger.addEvent(this, event); }

    removeEvent(id) { return OptionLedger.removeEvent(this, id); }

    statusOn(date) { return OptionLedger.statusOn(this, date); }

    currentStatus() { return OptionLedger.statusOn(this, null); }

    // ¿Están COMPLETOS los términos tipados? Un texto libre nunca se
    // ejecuta y un término ausente nunca se rellena "con un salario
    // parecido" (sección 10 del prompt).
    describeExecutability() {
      const missing = [];
      if (!this.window) missing.push('window');
      if (!this.addedSeasonKeys.length) missing.push('addedSeasonKeys');
      if (!this.compensationSeasons.length) missing.push('compensationSeasons');
      if (!this.entitledParty) missing.push('entitledParty');
      this.addedSeasonKeys.forEach((seasonKey) => {
        if (!this.compensationSeasons.some((s) => s.seasonKey === seasonKey)) {
          missing.push(`compensationSeasons[${seasonKey}]`);
        }
      });
      if (this.clauseType === 'automatic-renewal' && !this.objectiveTrigger) {
        missing.push('objectiveTrigger');
      }
      return { executable: missing.length === 0, missingTerms: [...new Set(missing)], requiredTerms: [...OPTION_REQUIRED_TERMS] };
    }

    isWithinWindow(date) {
      if (!this.window) return false;
      return LD().isWithinInclusive(requireIso(date, 'date'), this.window.fromDate, this.window.toDate);
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        playerId: this.playerId,
        clubId: this.clubId,
        contractId: this.contractId,
        clauseId: this.clauseId,
        clauseType: this.clauseType,
        entitledParty: this.entitledParty,
        window: this.window ? { ...this.window } : null,
        addedSeasonKeys: [...this.addedSeasonKeys],
        compensationSeasons: this.compensationSeasons.map((s) => ({ ...s })),
        objectiveTrigger: this.objectiveTrigger ? JSON.parse(JSON.stringify(this.objectiveTrigger)) : null,
        triggerEvidence: this.triggerEvidence ? JSON.parse(JSON.stringify(this.triggerEvidence)) : null,
        missingTerms: [...this.missingTerms],
        newContractId: this.newContractId,
        events: this.events.map((e) => ({ ...e })),
        provenance: { ...this.provenance },
        currentStatus: this.currentStatus(),
      };
    }
  }

  // =====================================================================
  // 6. Retirada — perfil PRIVADO, anuncio y receipt son tres cosas
  //    distintas. NUNCA existe `player.isRetired` como fuente de verdad.
  // =====================================================================
  class RetirementProfile {
    constructor(data) {
      const d = data || {};
      this.playerId = requireId(d.playerId, 'RetirementProfile.playerId');
      this.seedFingerprint = requireId(d.seedFingerprint, 'RetirementProfile.seedFingerprint');
      this.profileVersion = requireId(d.profileVersion, 'RetirementProfile.profileVersion');
      // Dispersión individual de longevidad (años) — con esto dos jugadores
      // de IGUAL Potencial pueden terminar con trayectorias muy distintas.
      this.longevityOffsetYears = d.longevityOffsetYears;
      this.declineSensitivity = d.declineSensitivity;
      this.mindsetFactor = d.mindsetFactor;
      // PROHIBIDO por diseño: `hidden.potential` (ni ninguna transformación
      // de PA) participa en este perfil — auditado estáticamente.
      this.inputsUsed = [...(d.inputsUsed || [])];
      this.createdAt = requireIso(d.createdAt, 'RetirementProfile.createdAt');
      // Perfil PRIVADO: nunca se muestra en la interfaz (sección 20 del
      // prompt: "no muestres perfil de longevidad ni probabilidad de
      // retirada").
      this.visibility = 'private';
    }

    toJSON() {
      return {
        playerId: this.playerId,
        seedFingerprint: this.seedFingerprint,
        profileVersion: this.profileVersion,
        longevityOffsetYears: this.longevityOffsetYears,
        declineSensitivity: this.declineSensitivity,
        mindsetFactor: this.mindsetFactor,
        inputsUsed: [...this.inputsUsed],
        createdAt: this.createdAt,
        visibility: this.visibility,
      };
    }
  }

  const RetirementLedger = makeEventLedger(ET().RetirementEvents, 'RetirementAnnouncement');

  class RetirementAnnouncement {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'RetirementAnnouncement.id');
      this.cycleId = requireId(d.cycleId, 'RetirementAnnouncement.cycleId');
      this.playerId = requireId(d.playerId, 'RetirementAnnouncement.playerId');
      this.clubIdAtAnnouncement = d.clubIdAtAnnouncement || null;
      this.announcedAt = requireIso(d.announcedAt, 'RetirementAnnouncement.announcedAt');
      // Fecha EFECTIVA: normalmente el final del contrato garantizado en
      // vigor (CYCLE-1 nunca inventa una extinción unilateral a mitad de
      // contrato, sección 12 del prompt).
      this.effectiveDate = requireIso(d.effectiveDate, 'RetirementAnnouncement.effectiveDate');
      // Razones CUALITATIVAS (nunca la puntuación interna ni el perfil).
      this.reasons = [...(d.reasons || [])];
      this.events = [];
      this.provenance = normalizeProvenance(d.provenance, 'simulated-retirement-v1');
    }

    addEvent(event) { return RetirementLedger.addEvent(this, event); }

    removeEvent(id) { return RetirementLedger.removeEvent(this, id); }

    statusOn(date) { return RetirementLedger.statusOn(this, date); }

    currentStatus() { return RetirementLedger.statusOn(this, null); }

    isEffectiveOn(date) {
      const iso = requireIso(date, 'date');
      return this.currentStatus() === 'retired' && !LD().isAfter(this.effectiveDate, iso);
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        playerId: this.playerId,
        clubIdAtAnnouncement: this.clubIdAtAnnouncement,
        announcedAt: this.announcedAt,
        effectiveDate: this.effectiveDate,
        reasons: [...this.reasons],
        events: this.events.map((e) => ({ ...e })),
        provenance: { ...this.provenance },
        currentStatus: this.currentStatus(),
      };
    }
  }

  class RetirementRecord {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'RetirementRecord.id');
      this.announcementId = requireId(d.announcementId, 'RetirementRecord.announcementId');
      this.playerId = requireId(d.playerId, 'RetirementRecord.playerId');
      this.effectiveDate = requireIso(d.effectiveDate, 'RetirementRecord.effectiveDate');
      this.transactionId = requireId(d.transactionId, 'RetirementRecord.transactionId');
      this.lastClubId = d.lastClubId || null;
      this.finalSeasonKey = d.finalSeasonKey || null;
      // Qué se limpió realmente (afiliación, licencia, inscripción,
      // negociaciones, reservas) — receipt AUDITABLE, no una promesa.
      this.cleanup = JSON.parse(JSON.stringify(d.cleanup || {}));
      this.careerSummary = JSON.parse(JSON.stringify(d.careerSummary || {}));
      this.provenance = normalizeProvenance(d.provenance, 'simulated-retirement-v1');
    }

    toJSON() {
      return {
        id: this.id,
        announcementId: this.announcementId,
        playerId: this.playerId,
        effectiveDate: this.effectiveDate,
        transactionId: this.transactionId,
        lastClubId: this.lastClubId,
        finalSeasonKey: this.finalSeasonKey,
        cleanup: JSON.parse(JSON.stringify(this.cleanup)),
        careerSummary: JSON.parse(JSON.stringify(this.careerSummary)),
        provenance: { ...this.provenance },
      };
    }
  }

  // =====================================================================
  // 7. Academia — pertenencia y decisión anual.
  // =====================================================================
  const AcademyLedger = makeEventLedger(ET().AcademyMembershipEvents, 'AcademyMembership');

  class AcademyMembership {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'AcademyMembership.id');
      this.playerId = requireId(d.playerId, 'AcademyMembership.playerId');
      this.clubId = requireId(d.clubId, 'AcademyMembership.clubId');
      this.joinedAt = requireIso(d.joinedAt, 'AcademyMembership.joinedAt');
      this.cohortSeasonKey = d.cohortSeasonKey || null;
      this.leftAt = d.leftAt ? requireIso(d.leftAt, 'AcademyMembership.leftAt') : null;
      // Procedencia SIMULADA visible (nunca un dato real de captación).
      this.origin = d.origin || 'simulated-academy-intake';
      // Contexto de desarrollo aplicado mientras esté en academia
      // (instalación de cantera del club; hook para staff/competiciones
      // juveniles futuras, deliberadamente NO implementadas).
      this.developmentContext = JSON.parse(JSON.stringify(d.developmentContext || {}));
      // Periodos de formación REALMENTE simulados: `RegulatoryClassificationService`
      // decidirá DESPUÉS si cumplen el ruleset de una competición/temporada.
      // Estar en academia NUNCA marca `formationQualifies = true` por sí solo.
      this.formationPeriods = (d.formationPeriods || []).map((p) => ({
        fromDate: requireIso(p.fromDate, 'formationPeriods.fromDate'),
        toDate: p.toDate ? requireIso(p.toDate, 'formationPeriods.toDate') : null,
        clubId: p.clubId,
        federationId: p.federationId || null,
        provenance: p.provenance || 'simulated-academy-period',
      }));
      this.decisionIds = [...(d.decisionIds || [])];
      this.events = [];
      this.provenance = normalizeProvenance(d.provenance, 'simulated-academy-v1');
    }

    addEvent(event) { return AcademyLedger.addEvent(this, event); }

    removeEvent(id) { return AcademyLedger.removeEvent(this, id); }

    statusOn(date) { return AcademyLedger.statusOn(this, date); }

    currentStatus() { return AcademyLedger.statusOn(this, null); }

    isActiveOn(date) {
      const status = this.statusOn(date);
      return status === 'active' || status === 'agedOut' || status === 'promotionAgreed' || status === 'blocked'
        || status === 'promotedPendingRegistration';
    }

    // Cierra el periodo formativo abierto (si hay) — nunca redondea un
    // periodo incompleto (sección 13 del prompt).
    closeOpenFormationPeriod(date) {
      const open = this.formationPeriods.find((p) => p.toDate === null);
      if (!open) return null;
      open.toDate = requireIso(date, 'date');
      return open;
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        clubId: this.clubId,
        joinedAt: this.joinedAt,
        cohortSeasonKey: this.cohortSeasonKey,
        leftAt: this.leftAt,
        origin: this.origin,
        developmentContext: JSON.parse(JSON.stringify(this.developmentContext)),
        formationPeriods: this.formationPeriods.map((p) => ({ ...p })),
        decisionIds: [...this.decisionIds],
        events: this.events.map((e) => ({ ...e })),
        provenance: { ...this.provenance },
        currentStatus: this.currentStatus(),
      };
    }
  }

  const ACADEMY_DECISION_OUTCOMES = ['continue', 'promote', 'release', 'left-professional-pathway'];

  class AcademyDecision {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'AcademyDecision.id');
      this.cycleId = requireId(d.cycleId, 'AcademyDecision.cycleId');
      this.membershipId = requireId(d.membershipId, 'AcademyDecision.membershipId');
      this.playerId = requireId(d.playerId, 'AcademyDecision.playerId');
      this.clubId = requireId(d.clubId, 'AcademyDecision.clubId');
      if (!ACADEMY_DECISION_OUTCOMES.includes(d.outcome)) {
        throw new Error(
          `AcademyDecision: resultado desconocido "${d.outcome}" (permitidos: ${ACADEMY_DECISION_OUTCOMES.join(', ')}).`,
        );
      }
      this.outcome = d.outcome;
      this.decidedAt = requireIso(d.decidedAt, 'AcademyDecision.decidedAt');
      this.decidedBy = d.decidedBy || 'cpu';
      // Razones CUALITATIVAS (nunca Potencial ni una puntuación).
      this.reasons = [...(d.reasons || [])];
      this.ageAtDecision = d.ageAtDecision !== undefined ? d.ageAtDecision : null;
      this.resultingContractId = d.resultingContractId || null;
      this.provenance = normalizeProvenance(d.provenance, 'simulated-academy-v1');
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        membershipId: this.membershipId,
        playerId: this.playerId,
        clubId: this.clubId,
        outcome: this.outcome,
        decidedAt: this.decidedAt,
        decidedBy: this.decidedBy,
        reasons: [...this.reasons],
        ageAtDecision: this.ageAtDecision,
        resultingContractId: this.resultingContractId,
        provenance: { ...this.provenance },
      };
    }
  }

  // =====================================================================
  // 8. Clearinghouse — recibo INMUTABLE de una ronda.
  // =====================================================================
  const ClearingLedger = makeEventLedger(ET().ClearingRoundEvents, 'ClearingRound');

  class ClearingRound {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'ClearingRound.id');
      this.cycleId = requireId(d.cycleId, 'ClearingRound.cycleId');
      this.roundIndex = Number.isInteger(d.roundIndex) ? d.roundIndex : 0;
      this.openedAt = requireIso(d.openedAt, 'ClearingRound.openedAt');
      this.snapshotFingerprint = requireId(d.snapshotFingerprint, 'ClearingRound.snapshotFingerprint');
      this.plannerVersion = d.plannerVersion || null;
      this.clearinghouseVersion = d.clearinghouseVersion || null;
      this.seed = d.seed || null;
      // Propuestas ADMITIDAS (ids ordenados canónicamente).
      this.admittedProposalIds = [...(d.admittedProposalIds || [])];
      // Orden CANÓNICO de resolución: nunca la posición en un array.
      this.canonicalResolutionOrder = [...(d.canonicalResolutionOrder || [])];
      this.decisionIds = [...(d.decisionIds || [])];
      this.committedTransactionIds = [...(d.committedTransactionIds || [])];
      this.failedCommits = (d.failedCommits || []).map((f) => ({ ...f }));
      this.finalFingerprint = d.finalFingerprint || null;
      this.events = [];
      this.provenance = normalizeProvenance(d.provenance, 'simulated-clearing-v1');
    }

    addEvent(event) { return ClearingLedger.addEvent(this, event); }

    removeEvent(id) { return ClearingLedger.removeEvent(this, id); }

    statusOn(date) { return ClearingLedger.statusOn(this, date); }

    currentStatus() { return ClearingLedger.statusOn(this, null); }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        roundIndex: this.roundIndex,
        openedAt: this.openedAt,
        snapshotFingerprint: this.snapshotFingerprint,
        plannerVersion: this.plannerVersion,
        clearinghouseVersion: this.clearinghouseVersion,
        seed: this.seed,
        admittedProposalIds: [...this.admittedProposalIds],
        canonicalResolutionOrder: [...this.canonicalResolutionOrder],
        decisionIds: [...this.decisionIds],
        committedTransactionIds: [...this.committedTransactionIds],
        failedCommits: this.failedCommits.map((f) => ({ ...f })),
        finalFingerprint: this.finalFingerprint,
        events: this.events.map((e) => ({ ...e })),
        provenance: { ...this.provenance },
        currentStatus: this.currentStatus(),
      };
    }
  }

  const CLEARING_DECISION_OUTCOMES = ['won', 'lost', 'expired', 'withdrawn', 'failed'];

  class ClearingDecision {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'ClearingDecision.id');
      this.roundId = requireId(d.roundId, 'ClearingDecision.roundId');
      this.playerId = requireId(d.playerId, 'ClearingDecision.playerId');
      this.operationType = requireId(d.operationType, 'ClearingDecision.operationType');
      this.proposalId = requireId(d.proposalId, 'ClearingDecision.proposalId');
      this.clubId = requireId(d.clubId, 'ClearingDecision.clubId');
      if (!CLEARING_DECISION_OUTCOMES.includes(d.outcome)) {
        throw new Error(
          `ClearingDecision: resultado desconocido "${d.outcome}" (permitidos: ${CLEARING_DECISION_OUTCOMES.join(', ')}).`,
        );
      }
      this.outcome = d.outcome;
      this.decidedAt = requireIso(d.decidedAt, 'ClearingDecision.decidedAt');
      // Elección CUALITATIVA del jugador/agente (MARKET-1) — nunca la
      // utilidad exacta.
      this.playerChoiceReasons = [...(d.playerChoiceReasons || [])];
      this.competingProposalIds = [...(d.competingProposalIds || [])];
      this.transactionId = d.transactionId || null;
      this.failureReason = d.failureReason || null;
      Object.freeze(this.playerChoiceReasons);
      Object.freeze(this.competingProposalIds);
      Object.freeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        roundId: this.roundId,
        playerId: this.playerId,
        operationType: this.operationType,
        proposalId: this.proposalId,
        clubId: this.clubId,
        outcome: this.outcome,
        decidedAt: this.decidedAt,
        playerChoiceReasons: [...this.playerChoiceReasons],
        competingProposalIds: [...this.competingProposalIds],
        transactionId: this.transactionId,
        failureReason: this.failureReason,
      };
    }
  }

  // =====================================================================
  // 9. Legalidad de plantilla y emergencia.
  // =====================================================================
  class RosterLegalityReport {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'RosterLegalityReport.id');
      this.cycleId = d.cycleId || null;
      this.clubId = requireId(d.clubId, 'RosterLegalityReport.clubId');
      this.competitionId = requireId(d.competitionId, 'RosterLegalityReport.competitionId');
      this.seasonKey = requireId(d.seasonKey, 'RosterLegalityReport.seasonKey');
      this.date = requireIso(d.date, 'RosterLegalityReport.date');
      this.phaseId = d.phaseId || 'league';
      // Traza normativa REAL (módulos aplicados) — un ruleset ausente
      // BLOQUEA con diagnóstico, nunca aplica ACB por defecto.
      this.rulesTrace = d.rulesTrace ? JSON.parse(JSON.stringify(d.rulesTrace)) : null;
      this.squadRules = d.squadRules ? { ...d.squadRules } : null;
      this.counts = JSON.parse(JSON.stringify(d.counts || {}));
      this.gaps = (d.gaps || []).map((g) => ({ ...g }));
      this.recommendedActions = (d.recommendedActions || []).map((a) => ({ ...a }));
      this.appliedActionIds = [...(d.appliedActionIds || [])];
      this.canBuildLegalSquad = d.canBuildLegalSquad === true;
      this.legalSquadSample = [...(d.legalSquadSample || [])];
      this.warnings = [...(d.warnings || [])];
      this.fallbackProvenance = [...(d.fallbackProvenance || [])];
    }

    get isLegal() { return this.canBuildLegalSquad && this.gaps.filter((g) => g.severity === 'blocking').length === 0; }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        clubId: this.clubId,
        competitionId: this.competitionId,
        seasonKey: this.seasonKey,
        date: this.date,
        phaseId: this.phaseId,
        rulesTrace: this.rulesTrace ? JSON.parse(JSON.stringify(this.rulesTrace)) : null,
        squadRules: this.squadRules ? { ...this.squadRules } : null,
        counts: JSON.parse(JSON.stringify(this.counts)),
        gaps: this.gaps.map((g) => ({ ...g })),
        recommendedActions: this.recommendedActions.map((a) => ({ ...a })),
        appliedActionIds: [...this.appliedActionIds],
        canBuildLegalSquad: this.canBuildLegalSquad,
        legalSquadSample: [...this.legalSquadSample],
        warnings: [...this.warnings],
        fallbackProvenance: [...this.fallbackProvenance],
        isLegal: this.isLegal,
      };
    }
  }

  const EMERGENCY_ACTION_TYPES = ['promote-academy', 'sign-existing-free-agent', 'generate-emergency-player'];

  class EmergencyRosterAction {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'EmergencyRosterAction.id');
      this.cycleId = d.cycleId || null;
      this.reportId = requireId(d.reportId, 'EmergencyRosterAction.reportId');
      this.clubId = requireId(d.clubId, 'EmergencyRosterAction.clubId');
      if (!EMERGENCY_ACTION_TYPES.includes(d.actionType)) {
        throw new Error(
          `EmergencyRosterAction: tipo desconocido "${d.actionType}" (permitidos, EN ORDEN de escalera: `
          + `${EMERGENCY_ACTION_TYPES.join(' > ')}).`,
        );
      }
      this.actionType = d.actionType;
      this.ladderStep = EMERGENCY_ACTION_TYPES.indexOf(d.actionType) + 1;
      this.playerId = d.playerId || null;
      this.appliedAt = requireIso(d.appliedAt, 'EmergencyRosterAction.appliedAt');
      this.gapAddressed = d.gapAddressed ? { ...d.gapAddressed } : null;
      this.contractId = d.contractId || null;
      this.registrationId = d.registrationId || null;
      this.licenseId = d.licenseId || null;
      this.delegatedByUser = d.delegatedByUser === true;
      this.succeeded = d.succeeded === true;
      this.failureReason = d.failureReason || null;
      // Procedencia SIEMPRE visible: un jugador de emergencia generado
      // NUNCA se presenta como real.
      this.provenance = normalizeProvenance(d.provenance, 'simulated-emergency-roster-v1');
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        reportId: this.reportId,
        clubId: this.clubId,
        actionType: this.actionType,
        ladderStep: this.ladderStep,
        playerId: this.playerId,
        appliedAt: this.appliedAt,
        gapAddressed: this.gapAddressed ? { ...this.gapAddressed } : null,
        contractId: this.contractId,
        registrationId: this.registrationId,
        licenseId: this.licenseId,
        delegatedByUser: this.delegatedByUser,
        succeeded: this.succeeded,
        failureReason: this.failureReason,
        provenance: { ...this.provenance },
      };
    }
  }

  // =====================================================================
  // 10. Receipt de expiración de contrato (sección 9 del prompt) — un
  //     contrato vencido NUNCA se borra ni se amplía mutando su `endDate`,
  //     y su expiración natural NO es una terminación por causa ni un
  //     mutuo acuerdo (no se crea un `ContractTerminationRecord` falso).
  // =====================================================================
  const CONTRACT_EXPIRY_OUTCOMES = ['continuity-same-club', 'scheduled-move-executed', 'released-to-free-agency', 'retired', 'blocked'];

  class ContractExpiryRecord {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'ContractExpiryRecord.id');
      this.cycleId = d.cycleId || null;
      this.transactionId = requireId(d.transactionId, 'ContractExpiryRecord.transactionId');
      this.playerId = requireId(d.playerId, 'ContractExpiryRecord.playerId');
      this.contractId = requireId(d.contractId, 'ContractExpiryRecord.contractId');
      this.clubId = requireId(d.clubId, 'ContractExpiryRecord.clubId');
      this.expiredEndDate = requireIso(d.expiredEndDate, 'ContractExpiryRecord.expiredEndDate');
      this.effectiveDate = requireIso(d.effectiveDate, 'ContractExpiryRecord.effectiveDate');
      if (!CONTRACT_EXPIRY_OUTCOMES.includes(d.outcome)) {
        throw new Error(
          `ContractExpiryRecord: resultado desconocido "${d.outcome}" (permitidos: ${CONTRACT_EXPIRY_OUTCOMES.join(', ')}).`,
        );
      }
      this.outcome = d.outcome;
      this.continuityContractId = d.continuityContractId || null;
      this.deactivatedRegistrationId = d.deactivatedRegistrationId || null;
      this.expiredLicenseId = d.expiredLicenseId || null;
      this.releasedReservationGroupIds = [...(d.releasedReservationGroupIds || [])];
      this.rosterMutation = d.rosterMutation ? { ...d.rosterMutation } : null;
      this.diagnostics = [...(d.diagnostics || [])];
      Object.freeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        transactionId: this.transactionId,
        playerId: this.playerId,
        contractId: this.contractId,
        clubId: this.clubId,
        expiredEndDate: this.expiredEndDate,
        effectiveDate: this.effectiveDate,
        outcome: this.outcome,
        continuityContractId: this.continuityContractId,
        deactivatedRegistrationId: this.deactivatedRegistrationId,
        expiredLicenseId: this.expiredLicenseId,
        releasedReservationGroupIds: [...this.releasedReservationGroupIds],
        rosterMutation: this.rosterMutation ? { ...this.rosterMutation } : null,
        diagnostics: [...this.diagnostics],
      };
    }
  }

  // =====================================================================
  // 11. Salida de la vía profesional (sección 18 del prompt) — NUNCA se
  //     borra la instancia del jugador: cambia su categoría operativa.
  // =====================================================================
  class ProfessionalPathwayExitRecord {
    constructor(data) {
      const d = data || {};
      this.id = requireId(d.id, 'ProfessionalPathwayExitRecord.id');
      this.cycleId = d.cycleId || null;
      this.playerId = requireId(d.playerId, 'ProfessionalPathwayExitRecord.playerId');
      this.effectiveDate = requireIso(d.effectiveDate, 'ProfessionalPathwayExitRecord.effectiveDate');
      this.reason = d.reason || 'population-balance';
      this.reasons = [...(d.reasons || [])];
      this.lastClubId = d.lastClubId || null;
      Object.freeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        cycleId: this.cycleId,
        playerId: this.playerId,
        effectiveDate: this.effectiveDate,
        reason: this.reason,
        reasons: [...this.reasons],
        lastClubId: this.lastClubId,
      };
    }
  }

  const exportsObj = {
    AnnualRosterCycle,
    ClubCycleCase,
    ClubSquadPlan,
    RenewalCase,
    ContractOptionDecision,
    OPTION_REQUIRED_TERMS,
    RetirementProfile,
    RetirementAnnouncement,
    RetirementRecord,
    AcademyMembership,
    AcademyDecision,
    ACADEMY_DECISION_OUTCOMES,
    ClearingRound,
    ClearingDecision,
    CLEARING_DECISION_OUTCOMES,
    RosterLegalityReport,
    EmergencyRosterAction,
    EMERGENCY_ACTION_TYPES,
    ContractExpiryRecord,
    CONTRACT_EXPIRY_OUTCOMES,
    ProfessionalPathwayExitRecord,
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
