// src/core/AnnualCycleRegistry.js
// CYCLE-1 (DESIGN.md 9.22) — registro CANÓNICO del ciclo anual de plantilla.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Mismo principio que PlayerRegistry/ContractRegistry/RegistrationRegistry/
// MarketRegistry/TransferRegistry/LoanRegistry: la partida posee una
// instancia EXPLÍCITA (`state.annualCycleRegistry`, creada al iniciar
// carrera y limpiada al volver a selección de equipo), NUNCA un singleton
// oculto. Dos partidas o dos tests tienen registros independientes.
//
// Reglas de dominio:
//  - fuente CANÓNICA de `AnnualRosterCycle`/`ClubCycleCase`/`ClubSquadPlan`/
//    `RenewalCase`/`ContractOptionDecision`/`RetirementProfile`/
//    `RetirementAnnouncement`/`RetirementRecord`/`ClearingRound`/
//    `ClearingDecision`/`RosterLegalityReport`/`EmergencyRosterAction`/
//    `ContractExpiryRecord`/`ProfessionalPathwayExitRecord`;
//  - `Player`/`Team` NUNCA duplican nada de esto: no existe
//    `player.isRetired`, `player.academyClubId`, `team.cyclePhase` ni
//    equivalentes (prohibidos y auditados estáticamente);
//  - "¿está retirado?", "¿está en academia?", "¿qué fase lleva su club?" son
//    consultas DERIVADAS de este registro;
//  - `unregister*` existe para el ROLLBACK de una saga y revierte los
//    índices secundarios de forma SIMÉTRICA (mismo criterio que
//    BUG-TRANSFER1-14).
//
// Módulo puro: no lee DOM, ni `state`, ni variables globales.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const RegistryIndexAuditModule = isNode ? require('../utils/RegistryIndexAudit.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function auditIndexSymmetry(...args) {
    return RegistryIndexAuditModule.RegistryIndexAudit.auditIndexSymmetry(...args);
  }

  function byId(list) {
    return list.filter(Boolean).sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
  }

  function pushIndex(map, key, value) {
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  }

  function dropIndex(map, key, value) {
    if (!key) return;
    const list = map.get(key) || [];
    map.set(key, list.filter((entry) => entry !== value));
  }

  class AnnualCycleRegistry {
    constructor() {
      this._cycles = new Map();
      this._clubCases = new Map();
      this._clubCasesByCycle = new Map();
      this._clubCasesByClub = new Map();
      this._plans = new Map();
      this._plansByClub = new Map();
      this._renewals = new Map();
      this._renewalsByPlayer = new Map();
      this._renewalsByClub = new Map();
      this._optionDecisions = new Map();
      this._optionDecisionsByPlayer = new Map();
      this._retirementProfiles = new Map(); // playerId -> RetirementProfile
      this._retirementAnnouncements = new Map();
      this._retirementAnnouncementsByPlayer = new Map();
      this._retirementRecords = new Map();
      this._retirementRecordsByPlayer = new Map();
      this._clearingRounds = new Map();
      this._clearingDecisions = new Map();
      this._clearingDecisionsByRound = new Map();
      this._legalityReports = new Map();
      this._legalityReportsByClub = new Map();
      this._emergencyActions = new Map();
      this._emergencyActionsByClub = new Map();
      this._expiryRecords = new Map();
      this._expiryRecordsByPlayer = new Map();
      this._expiryRecordsByTransaction = new Map(); // transactionId -> recordId (idempotencia)
      this._pathwayExits = new Map();
      this._pathwayExitsByPlayer = new Map();
    }

    // --- Ciclos -----------------------------------------------------------
    registerCycle(cycle) {
      if (!cycle || !cycle.id) throw new Error('AnnualCycleRegistry.registerCycle: el ciclo debe tener un id válido.');
      const existing = this._cycles.get(cycle.id);
      if (existing && existing !== cycle) {
        throw new Error(`AnnualCycleRegistry.registerCycle: ya existe un ciclo distinto con id "${cycle.id}".`);
      }
      this._cycles.set(cycle.id, cycle);
      return cycle;
    }

    getCycle(id) { return this._cycles.get(id) || null; }

    requireCycle(id) {
      const cycle = this.getCycle(id);
      if (!cycle) throw new Error(`AnnualCycleRegistry.requireCycle: no existe el ciclo "${id}".`);
      return cycle;
    }

    allCycles() { return byId([...this._cycles.values()]); }

    // Ciclo ABIERTO (aún sin `new-season-started`) — como mucho uno.
    openCycle() {
      return this.allCycles().find((cycle) => cycle.currentPhase() !== 'new-season-started') || null;
    }

    cycleForSeason(fromSeasonKey) {
      return this.allCycles().find((cycle) => cycle.fromSeasonKey === fromSeasonKey) || null;
    }

    // --- Expedientes de club ---------------------------------------------
    registerClubCase(clubCase) {
      if (!clubCase || !clubCase.id) throw new Error('AnnualCycleRegistry.registerClubCase: id inválido.');
      const existing = this._clubCases.get(clubCase.id);
      if (existing && existing !== clubCase) {
        throw new Error(`AnnualCycleRegistry.registerClubCase: ya existe un expediente distinto con id "${clubCase.id}".`);
      }
      this._clubCases.set(clubCase.id, clubCase);
      pushIndex(this._clubCasesByCycle, clubCase.cycleId, clubCase.id);
      pushIndex(this._clubCasesByClub, clubCase.clubId, clubCase.id);
      return clubCase;
    }

    getClubCase(id) { return this._clubCases.get(id) || null; }

    clubCasesForCycle(cycleId) {
      return byId((this._clubCasesByCycle.get(cycleId) || []).map((id) => this._clubCases.get(id)));
    }

    clubCaseFor(cycleId, clubId) {
      return this.clubCasesForCycle(cycleId).find((entry) => entry.clubId === clubId) || null;
    }

    allClubCases() { return byId([...this._clubCases.values()]); }

    // --- Planes -----------------------------------------------------------
    registerPlan(plan) {
      if (!plan || !plan.id) throw new Error('AnnualCycleRegistry.registerPlan: id inválido.');
      const existing = this._plans.get(plan.id);
      if (existing && existing !== plan) {
        throw new Error(`AnnualCycleRegistry.registerPlan: ya existe un plan distinto con id "${plan.id}".`);
      }
      this._plans.set(plan.id, plan);
      pushIndex(this._plansByClub, plan.clubId, plan.id);
      return plan;
    }

    getPlan(id) { return this._plans.get(id) || null; }

    plansForClub(clubId) { return byId((this._plansByClub.get(clubId) || []).map((id) => this._plans.get(id))); }

    latestPlanForClub(clubId) {
      const plans = this.plansForClub(clubId);
      if (!plans.length) return null;
      return plans.reduce((best, plan) => (plan.roundIndex >= best.roundIndex ? plan : best), plans[0]);
    }

    allPlans() { return byId([...this._plans.values()]); }

    // --- Renovaciones -----------------------------------------------------
    registerRenewalCase(renewalCase) {
      if (!renewalCase || !renewalCase.id) throw new Error('AnnualCycleRegistry.registerRenewalCase: id inválido.');
      const existing = this._renewals.get(renewalCase.id);
      if (existing && existing !== renewalCase) {
        throw new Error(`AnnualCycleRegistry.registerRenewalCase: ya existe un expediente distinto con id "${renewalCase.id}".`);
      }
      this._renewals.set(renewalCase.id, renewalCase);
      pushIndex(this._renewalsByPlayer, renewalCase.playerId, renewalCase.id);
      pushIndex(this._renewalsByClub, renewalCase.clubId, renewalCase.id);
      return renewalCase;
    }

    unregisterRenewalCase(id) {
      const renewalCase = this._renewals.get(id);
      if (!renewalCase) return false;
      this._renewals.delete(id);
      dropIndex(this._renewalsByPlayer, renewalCase.playerId, id);
      dropIndex(this._renewalsByClub, renewalCase.clubId, id);
      return true;
    }

    getRenewalCase(id) { return this._renewals.get(id) || null; }

    renewalCasesForPlayer(playerId) {
      return byId((this._renewalsByPlayer.get(playerId) || []).map((id) => this._renewals.get(id)));
    }

    renewalCasesForClub(clubId) {
      return byId((this._renewalsByClub.get(clubId) || []).map((id) => this._renewals.get(id)));
    }

    liveRenewalCaseForPlayer(playerId, date) {
      return this.renewalCasesForPlayer(playerId).find((entry) => entry.isLiveOn(date)) || null;
    }

    allRenewalCases() { return byId([...this._renewals.values()]); }

    // --- Opciones contractuales ------------------------------------------
    registerOptionDecision(decision) {
      if (!decision || !decision.id) throw new Error('AnnualCycleRegistry.registerOptionDecision: id inválido.');
      const existing = this._optionDecisions.get(decision.id);
      if (existing && existing !== decision) {
        throw new Error(`AnnualCycleRegistry.registerOptionDecision: ya existe una decisión distinta con id "${decision.id}".`);
      }
      this._optionDecisions.set(decision.id, decision);
      pushIndex(this._optionDecisionsByPlayer, decision.playerId, decision.id);
      return decision;
    }

    getOptionDecision(id) { return this._optionDecisions.get(id) || null; }

    optionDecisionsForPlayer(playerId) {
      return byId((this._optionDecisionsByPlayer.get(playerId) || []).map((id) => this._optionDecisions.get(id)));
    }

    allOptionDecisions() { return byId([...this._optionDecisions.values()]); }

    // --- Retirada ---------------------------------------------------------
    registerRetirementProfile(profile) {
      if (!profile || !profile.playerId) throw new Error('AnnualCycleRegistry.registerRetirementProfile: playerId inválido.');
      const existing = this._retirementProfiles.get(profile.playerId);
      if (existing && existing !== profile && existing.seedFingerprint !== profile.seedFingerprint) {
        throw new Error(
          `AnnualCycleRegistry.registerRetirementProfile: el jugador "${profile.playerId}" ya tiene un perfil de `
          + 'longevidad con otra huella — un perfil privado nunca se reescribe (sería re-sortear su carrera).',
        );
      }
      this._retirementProfiles.set(profile.playerId, profile);
      return profile;
    }

    getRetirementProfile(playerId) { return this._retirementProfiles.get(playerId) || null; }

    allRetirementProfiles() { return [...this._retirementProfiles.values()]; }

    registerRetirementAnnouncement(announcement) {
      if (!announcement || !announcement.id) throw new Error('AnnualCycleRegistry.registerRetirementAnnouncement: id inválido.');
      const existing = this._retirementAnnouncements.get(announcement.id);
      if (existing && existing !== announcement) {
        throw new Error(`AnnualCycleRegistry.registerRetirementAnnouncement: ya existe un anuncio distinto con id "${announcement.id}".`);
      }
      this._retirementAnnouncements.set(announcement.id, announcement);
      pushIndex(this._retirementAnnouncementsByPlayer, announcement.playerId, announcement.id);
      return announcement;
    }

    unregisterRetirementAnnouncement(id) {
      const announcement = this._retirementAnnouncements.get(id);
      if (!announcement) return false;
      this._retirementAnnouncements.delete(id);
      dropIndex(this._retirementAnnouncementsByPlayer, announcement.playerId, id);
      return true;
    }

    getRetirementAnnouncement(id) { return this._retirementAnnouncements.get(id) || null; }

    retirementAnnouncementsForPlayer(playerId) {
      return byId((this._retirementAnnouncementsByPlayer.get(playerId) || []).map((id) => this._retirementAnnouncements.get(id)));
    }

    allRetirementAnnouncements() { return byId([...this._retirementAnnouncements.values()]); }

    registerRetirementRecord(record) {
      if (!record || !record.id) throw new Error('AnnualCycleRegistry.registerRetirementRecord: id inválido.');
      const existing = this._retirementRecords.get(record.id);
      if (existing && existing !== record) {
        throw new Error(`AnnualCycleRegistry.registerRetirementRecord: ya existe un receipt distinto con id "${record.id}".`);
      }
      this._retirementRecords.set(record.id, record);
      pushIndex(this._retirementRecordsByPlayer, record.playerId, record.id);
      return record;
    }

    unregisterRetirementRecord(id) {
      const record = this._retirementRecords.get(id);
      if (!record) return false;
      this._retirementRecords.delete(id);
      dropIndex(this._retirementRecordsByPlayer, record.playerId, id);
      return true;
    }

    getRetirementRecord(id) { return this._retirementRecords.get(id) || null; }

    retirementRecordForPlayer(playerId) {
      return this.retirementRecordsForPlayer(playerId)[0] || null;
    }

    retirementRecordsForPlayer(playerId) {
      return byId((this._retirementRecordsByPlayer.get(playerId) || []).map((id) => this._retirementRecords.get(id)));
    }

    allRetirementRecords() { return byId([...this._retirementRecords.values()]); }

    // Consulta DERIVADA ("¿está retirado?") — nunca un booleano en `Player`.
    isRetiredOn(playerId, date) {
      const iso = LD().requireIsoDate(typeof date === 'string' ? date : LD().fromJsDate(date), 'date');
      return this.retirementRecordsForPlayer(playerId).some((record) => !LD().isAfter(record.effectiveDate, iso));
    }

    // --- Clearinghouse ----------------------------------------------------
    registerClearingRound(round) {
      if (!round || !round.id) throw new Error('AnnualCycleRegistry.registerClearingRound: id inválido.');
      const existing = this._clearingRounds.get(round.id);
      if (existing && existing !== round) {
        throw new Error(`AnnualCycleRegistry.registerClearingRound: ya existe una ronda distinta con id "${round.id}".`);
      }
      this._clearingRounds.set(round.id, round);
      return round;
    }

    getClearingRound(id) { return this._clearingRounds.get(id) || null; }

    clearingRoundsForCycle(cycleId) {
      return byId([...this._clearingRounds.values()].filter((round) => round.cycleId === cycleId))
        .sort((a, b) => a.roundIndex - b.roundIndex);
    }

    allClearingRounds() { return byId([...this._clearingRounds.values()]); }

    registerClearingDecision(decision) {
      if (!decision || !decision.id) throw new Error('AnnualCycleRegistry.registerClearingDecision: id inválido.');
      const existing = this._clearingDecisions.get(decision.id);
      if (existing && existing !== decision) {
        throw new Error(`AnnualCycleRegistry.registerClearingDecision: ya existe una decisión distinta con id "${decision.id}".`);
      }
      this._clearingDecisions.set(decision.id, decision);
      pushIndex(this._clearingDecisionsByRound, decision.roundId, decision.id);
      return decision;
    }

    clearingDecisionsForRound(roundId) {
      return byId((this._clearingDecisionsByRound.get(roundId) || []).map((id) => this._clearingDecisions.get(id)));
    }

    allClearingDecisions() { return byId([...this._clearingDecisions.values()]); }

    // --- Legalidad y emergencia ------------------------------------------
    registerLegalityReport(report) {
      if (!report || !report.id) throw new Error('AnnualCycleRegistry.registerLegalityReport: id inválido.');
      this._legalityReports.set(report.id, report);
      pushIndex(this._legalityReportsByClub, report.clubId, report.id);
      return report;
    }

    getLegalityReport(id) { return this._legalityReports.get(id) || null; }

    legalityReportsForClub(clubId) {
      return byId((this._legalityReportsByClub.get(clubId) || []).map((id) => this._legalityReports.get(id)));
    }

    latestLegalityReportForClub(clubId) {
      const reports = this.legalityReportsForClub(clubId);
      if (!reports.length) return null;
      return reports.reduce((best, report) => (LD().isAfter(report.date, best.date) ? report : best), reports[0]);
    }

    allLegalityReports() { return byId([...this._legalityReports.values()]); }

    registerEmergencyAction(action) {
      if (!action || !action.id) throw new Error('AnnualCycleRegistry.registerEmergencyAction: id inválido.');
      this._emergencyActions.set(action.id, action);
      pushIndex(this._emergencyActionsByClub, action.clubId, action.id);
      return action;
    }

    emergencyActionsForClub(clubId) {
      return byId((this._emergencyActionsByClub.get(clubId) || []).map((id) => this._emergencyActions.get(id)));
    }

    allEmergencyActions() { return byId([...this._emergencyActions.values()]); }

    // --- Expiración de contrato ------------------------------------------
    registerExpiryRecord(record) {
      if (!record || !record.id) throw new Error('AnnualCycleRegistry.registerExpiryRecord: id inválido.');
      const existing = this._expiryRecords.get(record.id);
      if (existing && existing !== record) {
        throw new Error(`AnnualCycleRegistry.registerExpiryRecord: ya existe un receipt distinto con id "${record.id}".`);
      }
      this._expiryRecords.set(record.id, record);
      pushIndex(this._expiryRecordsByPlayer, record.playerId, record.id);
      this._expiryRecordsByTransaction.set(record.transactionId, record.id);
      return record;
    }

    unregisterExpiryRecord(id) {
      const record = this._expiryRecords.get(id);
      if (!record) return false;
      this._expiryRecords.delete(id);
      dropIndex(this._expiryRecordsByPlayer, record.playerId, id);
      this._expiryRecordsByTransaction.delete(record.transactionId);
      return true;
    }

    // Idempotencia por `transactionId` (mismo criterio que
    // `TransferRegistry.completedTransaction`): repetir el comando devuelve
    // el MISMO receipt, nunca una segunda liberación.
    expiryRecordForTransaction(transactionId) {
      const id = this._expiryRecordsByTransaction.get(transactionId);
      return id ? this._expiryRecords.get(id) || null : null;
    }

    expiryRecordsForPlayer(playerId) {
      return byId((this._expiryRecordsByPlayer.get(playerId) || []).map((id) => this._expiryRecords.get(id)));
    }

    allExpiryRecords() { return byId([...this._expiryRecords.values()]); }

    // --- Salida de la vía profesional ------------------------------------
    registerPathwayExit(record) {
      if (!record || !record.id) throw new Error('AnnualCycleRegistry.registerPathwayExit: id inválido.');
      this._pathwayExits.set(record.id, record);
      pushIndex(this._pathwayExitsByPlayer, record.playerId, record.id);
      return record;
    }

    unregisterPathwayExit(id) {
      const record = this._pathwayExits.get(id);
      if (!record) return false;
      this._pathwayExits.delete(id);
      dropIndex(this._pathwayExitsByPlayer, record.playerId, id);
      return true;
    }

    pathwayExitsForPlayer(playerId) {
      return byId((this._pathwayExitsByPlayer.get(playerId) || []).map((id) => this._pathwayExits.get(id)));
    }

    hasLeftProfessionalPathwayOn(playerId, date) {
      const iso = LD().requireIsoDate(typeof date === 'string' ? date : LD().fromJsDate(date), 'date');
      return this.pathwayExitsForPlayer(playerId).some((record) => !LD().isAfter(record.effectiveDate, iso));
    }

    allPathwayExits() { return byId([...this._pathwayExits.values()]); }

    // --- Integridad -------------------------------------------------------
    // NUNCA lanza por sí sola (mismo criterio que el resto de registries):
    // devuelve todo lo que no cuadra.
    validateIntegrity(options) {
      const { playerRegistry, contractRegistry, teams, date } = options || {};
      const errors = [];
      const teamIds = new Set((teams || []).map((team) => team.id));
      const iso = date ? LD().requireIsoDate(typeof date === 'string' ? date : LD().fromJsDate(date), 'date') : null;

      this.allClubCases().forEach((clubCase) => {
        if (!this._cycles.has(clubCase.cycleId)) {
          errors.push(`El expediente de club "${clubCase.id}" referencia un ciclo inexistente "${clubCase.cycleId}".`);
        }
        if (teams && !teamIds.has(clubCase.clubId)) {
          errors.push(`El expediente de club "${clubCase.id}" referencia el club "${clubCase.clubId}", que no existe entre los equipos vivos.`);
        }
      });

      this.allRenewalCases().forEach((renewal) => {
        if (playerRegistry && !playerRegistry.has(renewal.playerId)) {
          errors.push(`La renovación "${renewal.id}" referencia al jugador "${renewal.playerId}", que no está en PlayerRegistry.`);
        }
        if (contractRegistry && !contractRegistry.has(renewal.expiringContractId)) {
          errors.push(`La renovación "${renewal.id}" referencia el contrato que vence "${renewal.expiringContractId}", inexistente en ContractRegistry.`);
        }
        if (renewal.committedContractId && contractRegistry && !contractRegistry.has(renewal.committedContractId)) {
          errors.push(`La renovación "${renewal.id}" declara el contrato comprometido "${renewal.committedContractId}", inexistente en ContractRegistry.`);
        }
        if (renewal.currentStatus() === 'committed' && !renewal.committedContractId) {
          errors.push(`La renovación "${renewal.id}" está "committed" pero no referencia ningún contrato nuevo.`);
        }
      });

      this.allOptionDecisions().forEach((decision) => {
        if (contractRegistry && !contractRegistry.has(decision.contractId)) {
          errors.push(`La decisión de opción "${decision.id}" referencia el contrato "${decision.contractId}", inexistente.`);
        }
        if (decision.currentStatus() === 'committed' && !decision.newContractId) {
          errors.push(`La decisión de opción "${decision.id}" está "committed" pero no referencia ningún contrato nuevo.`);
        }
      });

      // Un retirado NO puede estar en ningún roster senior (invariante 12).
      if (iso && teams) {
        const retiredIds = new Set(
          this.allRetirementRecords().filter((r) => !LD().isAfter(r.effectiveDate, iso)).map((r) => r.playerId),
        );
        (teams || []).forEach((team) => {
          team.roster.forEach((player) => {
            if (retiredIds.has(player.id)) {
              errors.push(`El jugador "${player.id}" está retirado (receipt efectivo) pero sigue en la plantilla de "${team.id}".`);
            }
          });
        });
        // Un retirado sigue SIENDO localizable en el registro mundial.
        if (playerRegistry) {
          retiredIds.forEach((playerId) => {
            if (!playerRegistry.has(playerId)) {
              errors.push(`El jugador retirado "${playerId}" no está en PlayerRegistry — una retirada nunca borra la instancia.`);
            }
          });
        }
      }

      // Un mismo jugador no puede tener dos anuncios de retirada vivos.
      [...this._retirementAnnouncementsByPlayer.keys()].forEach((playerId) => {
        const live = this.retirementAnnouncementsForPlayer(playerId)
          .filter((a) => a.currentStatus() === 'announced' || a.currentStatus() === 'blocked');
        if (live.length > 1) {
          errors.push(`El jugador "${playerId}" tiene ${live.length} anuncios de retirada vivos a la vez.`);
        }
      });

      errors.push(...auditIndexSymmetry('_clubCasesByCycle', this._clubCasesByCycle, this._clubCases));
      errors.push(...auditIndexSymmetry('_clubCasesByClub', this._clubCasesByClub, this._clubCases));
      errors.push(...auditIndexSymmetry('_renewalsByPlayer', this._renewalsByPlayer, this._renewals));
      errors.push(...auditIndexSymmetry('_renewalsByClub', this._renewalsByClub, this._renewals));
      errors.push(...auditIndexSymmetry('_retirementRecordsByPlayer', this._retirementRecordsByPlayer, this._retirementRecords));
      errors.push(...auditIndexSymmetry('_expiryRecordsByPlayer', this._expiryRecordsByPlayer, this._expiryRecords));
      errors.push(...auditIndexSymmetry('_pathwayExitsByPlayer', this._pathwayExitsByPlayer, this._pathwayExits));

      return { valid: errors.length === 0, errors };
    }

    // Snapshot MÍNIMO y SERIALIZABLE (no es un sistema de guardado — eso es
    // HARDEN-1): arrays/objetos planos, sin cierres ni referencias
    // circulares, para poder comparar dos ejecuciones byte a byte.
    snapshot() {
      return {
        cycles: this.allCycles().map((c) => ({ id: c.id, fromSeasonKey: c.fromSeasonKey, targetSeasonKey: c.targetSeasonKey, phase: c.currentPhase() })),
        clubCases: this.allClubCases().map((c) => ({ id: c.id, clubId: c.clubId, status: c.currentStatus() })),
        plans: this.allPlans().map((p) => ({ id: p.id, clubId: p.clubId, roundIndex: p.roundIndex, fingerprint: p.snapshotFingerprint })),
        renewals: this.allRenewalCases().map((r) => ({
          id: r.id, playerId: r.playerId, clubId: r.clubId, status: r.currentStatus(), committedContractId: r.committedContractId,
        })),
        optionDecisions: this.allOptionDecisions().map((o) => ({ id: o.id, playerId: o.playerId, status: o.currentStatus() })),
        retirements: this.allRetirementRecords().map((r) => ({ id: r.id, playerId: r.playerId, effectiveDate: r.effectiveDate })),
        announcements: this.allRetirementAnnouncements().map((a) => ({
          id: a.id, playerId: a.playerId, effectiveDate: a.effectiveDate, status: a.currentStatus(),
        })),
        clearingRounds: this.allClearingRounds().map((r) => ({
          id: r.id, roundIndex: r.roundIndex, status: r.currentStatus(), finalFingerprint: r.finalFingerprint,
        })),
        clearingDecisions: this.allClearingDecisions().map((d) => ({
          id: d.id, playerId: d.playerId, clubId: d.clubId, outcome: d.outcome,
        })),
        expiryRecords: this.allExpiryRecords().map((r) => ({
          id: r.id, playerId: r.playerId, outcome: r.outcome, effectiveDate: r.effectiveDate,
        })),
        pathwayExits: this.allPathwayExits().map((r) => ({ id: r.id, playerId: r.playerId, effectiveDate: r.effectiveDate })),
        emergencyActions: this.allEmergencyActions().map((a) => ({
          id: a.id, clubId: a.clubId, actionType: a.actionType, playerId: a.playerId, succeeded: a.succeeded,
        })),
        legalityReports: this.allLegalityReports().map((r) => ({
          id: r.id, clubId: r.clubId, isLegal: r.isLegal, gaps: r.gaps.length,
        })),
      };
    }
  }

  const exportsObj = { AnnualCycleRegistry };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
