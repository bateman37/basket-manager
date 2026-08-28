// src/core/ContractExpiryService.js
// CYCLE-1 (DESIGN.md 9.22, sección 9 del prompt) — EXPIRACIÓN ORGÁNICA de
// contratos. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Un contrato vence por su FECHA REAL (`endDate` es INCLUSIVA: un contrato
// que termina el 31 de julio está vencido desde el 1 de agosto). La
// expiración natural:
//  - NUNCA muta ni borra el contrato histórico (nada de reescribir
//    `endDate`, nada de un `ContractTerminationRecord` falso: no es una
//    terminación por causa ni un mutuo acuerdo);
//  - conserva EXACTAMENTE la misma instancia de `Player` en el registro
//    mundial (un libre no es un jugador nuevo);
//  - libera al jugador de forma ATÓMICA solo si no existe continuidad
//    válida (contrato futuro con el mismo club, operación programada a otro
//    club, o retirada efectiva);
//  - es IDEMPOTENTE por `transactionId`.
//
// Este servicio retira el puente de staging
// `ContractSeeder.MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` como mecanismo
// para impedir que venza nadie (BUG-CYCLE1-05).
//
// Módulo puro: no lee DOM ni `state`; no construye noticias (game.js las
// publica SOLO tras un commit real).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CycleEntities = isNode ? require('../entities/Cycle.js') : global.BasketManager;
  const CycleTransactionModule = isNode ? require('./CycleTransaction.js') : global.BasketManager;
  const RosterMutationModule = isNode ? require('./RosterMutationService.js') : global.BasketManager;
  const RegistrationServiceModule = isNode ? require('./RegistrationService.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function Tx() { return CycleTransactionModule.CycleTransaction; }
  function RosterSvc() { return RosterMutationModule.RosterMutationService; }
  function RegSvc() { return RegistrationServiceModule.RegistrationService; }
  function ContractSvc() { return ContractServiceModule.ContractService; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // =====================================================================
  // 1. Detección: contratos cuyo PRIMER DÍA POSTERIOR a `endDate` ya llegó
  // =====================================================================
  // Devuelve `[{ contract, expiryDate }]` ordenado canónicamente por
  // `contractId` (nunca por orden de inserción del Map).
  function findDueExpirations(params) {
    const { contractRegistry, date } = params;
    const iso = toIso(date);
    return contractRegistry.all()
      .filter((contract) => {
        const expiryDate = LD().addDays(contract.endDate, 1);
        if (LD().isAfter(expiryDate, iso)) return false; // todavía vigente
        // Un contrato ya terminado/anulado no "expira" otra vez.
        const statusAtExpiry = contract.statusOn(expiryDate);
        return statusAtExpiry === 'expired';
      })
      .map((contract) => ({ contract, expiryDate: LD().addDays(contract.endDate, 1) }))
      .sort((a, b) => (a.contract.id < b.contract.id ? -1 : 1));
  }

  // =====================================================================
  // 2. Continuidad: ¿hay algo válido que evite la liberación genérica?
  // =====================================================================
  // Orden de precedencia (sección 8, prioridad 2 antes que 3):
  //   a) contrato FUTURO válido con el MISMO club (renovación/opción ya
  //      comprometida) -> se conserva la afiliación, no se mueve roster;
  //   b) operación PROGRAMADA válida a OTRO club (fichaje futuro de
  //      TRANSFER-1) -> la ejecuta su servicio canónico, no este;
  //   c) retirada EFECTIVA ese mismo día -> la resuelve RetirementService;
  //   d) nada -> liberación genérica.
  function resolveContinuity(params) {
    const {
      contract, contractRegistry, transferRegistry, annualCycleRegistry, date,
    } = params;
    const iso = toIso(date);
    const futureSameClub = contractRegistry.forPlayer(contract.playerId).find((other) => (
      other.id !== contract.id
      && other.clubId === contract.clubId
      && other.isCurrentOn(iso)
    ));
    if (futureSameClub) {
      return { kind: 'continuity-same-club', contractId: futureSameClub.id };
    }
    const futureOtherClub = contractRegistry.forPlayer(contract.playerId).find((other) => (
      other.id !== contract.id && other.clubId !== contract.clubId && other.isCurrentOn(iso)
    ));
    if (futureOtherClub) {
      return { kind: 'continuity-other-club', contractId: futureOtherClub.id, clubId: futureOtherClub.clubId };
    }
    if (transferRegistry) {
      const scheduled = transferRegistry.allCases().find((tCase) => (
        tCase.playerId === contract.playerId
        && tCase.statusOn(null) === 'scheduled'
        && tCase.effectiveDate
        && !LD().isAfter(tCase.effectiveDate, LD().addDays(iso, 30))
      ));
      if (scheduled) {
        return { kind: 'scheduled-move', transferCaseId: scheduled.id, effectiveDate: scheduled.effectiveDate };
      }
    }
    if (annualCycleRegistry) {
      const announcement = annualCycleRegistry.retirementAnnouncementsForPlayer(contract.playerId)
        .find((entry) => entry.currentStatus() === 'announced' && !LD().isAfter(entry.effectiveDate, iso));
      if (announcement) {
        return { kind: 'retirement-due', announcementId: announcement.id, effectiveDate: announcement.effectiveDate };
      }
    }
    return { kind: 'none' };
  }

  // =====================================================================
  // 3. Ejecución ATÓMICA de UNA expiración
  // =====================================================================
  function processExpiration(params) {
    const {
      contract, expiryDate, contractRegistry, registrationRegistry, playerRegistry, marketRegistry,
      loanRegistry, transferRegistry, annualCycleRegistry, teams, cycle, seasonKey, lineup, date,
    } = params;
    const iso = toIso(date || expiryDate);
    const transactionId = `tx:contract-expiry:${contract.id}`;

    // Idempotencia (sección 9 del prompt): repetir el comando devuelve el
    // MISMO receipt, nunca una segunda liberación.
    const already = annualCycleRegistry.expiryRecordForTransaction(transactionId);
    if (already) return { record: already, idempotent: true };

    const player = playerRegistry.require(contract.playerId);

    // Una CESIÓN nunca puede sobrevivir a su contrato matriz: si el jugador
    // sigue cedido, el retorno se procesa ANTES (prioridad 1 de la tabla de
    // eventos de la misma fecha, `processDueLoanReturnsToDate`). Aquí solo
    // se BLOQUEA con diagnóstico — nunca se deja al jugador en el roster
    // del cesionario sin contrato matriz, ni duplicado en ambos clubes.
    if (loanRegistry && loanRegistry.hasActiveLoanForPlayer(player.id, iso)) {
      return {
        record: null,
        blocked: true,
        diagnostic: {
          code: 'ACTIVE_LOAN_MUST_RETURN_FIRST',
          playerId: player.id,
          contractId: contract.id,
          message: 'La cesión activa debe retornar antes de extinguir el contrato matriz (prioridad 1 del ciclo).',
        },
      };
    }

    const continuity = resolveContinuity({
      contract, contractRegistry, transferRegistry, annualCycleRegistry, date: iso,
    });

    return Tx().runAtomic(`ContractExpiryService.processExpiration(${contract.id})`, (ctx) => {
      const diagnostics = [];
      let outcome;
      let rosterMutation = null;
      let deactivatedRegistrationId = null;
      let expiredLicenseId = null;
      const releasedReservationGroupIds = [];

      if (continuity.kind === 'continuity-same-club') {
        // La nueva relación laboral ya está registrada y es del MISMO club:
        // se conserva la afiliación y NO se mueve el roster.
        outcome = 'continuity-same-club';
        diagnostics.push(`Continuidad con el mismo club mediante el contrato "${continuity.contractId}".`);
      } else if (continuity.kind === 'continuity-other-club' || continuity.kind === 'scheduled-move') {
        // La ejecuta su servicio canónico (TRANSFER-1) — este servicio no
        // toca roster ni inscripción en ese caso.
        outcome = 'scheduled-move-executed';
        diagnostics.push(
          continuity.kind === 'scheduled-move'
            ? `Movimiento programado pendiente ("${continuity.transferCaseId}", efecto ${continuity.effectiveDate}): la liberación genérica no se aplica.`
            : `Contrato futuro con otro club ("${continuity.contractId}"): la liberación genérica no se aplica.`,
        );
      } else if (continuity.kind === 'retirement-due') {
        outcome = 'retired';
        diagnostics.push(`Retirada anunciada con efecto ${continuity.effectiveDate}: la resuelve RetirementService.`);
      } else {
        // --- Liberación genérica -------------------------------------------
        outcome = 'released-to-free-agency';

        // (4) Baja regulatoria donde proceda, por servicios canónicos.
        if (registrationRegistry) {
          registrationRegistry.registrationsForPlayer(player.id)
            .filter((registration) => registration.teamId === contract.clubId && registration.statusOn(iso) === 'active')
            .forEach((registration) => {
              const eventId = `${registration.id}:deactivated:${registration.events.length}`;
              const previousReason = registration.trace.deactivationReasonCode;
              RegSvc().deactivateRegistration(registration, iso, `CYCLE-1:contract-expiry:${contract.id}`);
              deactivatedRegistrationId = registration.id;
              ctx.registerUndo(() => {
                registration.removeEvent(eventId);
                if (previousReason === undefined) delete registration.trace.deactivationReasonCode;
                else registration.trace.deactivationReasonCode = previousReason;
              });
            });
          registrationRegistry.licensesForPlayer(player.id)
            .filter((license) => license.clubId === contract.clubId && license.statusOn(iso) === 'active')
            .forEach((license) => {
              const eventId = `${license.id}:expired:${license.events.length}`;
              RegSvc().advanceLicenseEvent(license, 'expired', iso);
              expiredLicenseId = license.id;
              ctx.registerUndo(() => { license.removeEvent(eventId); });
            });
        }

        // (5)(6)(7) Afiliación: frontera ÚNICA. La MISMA instancia queda en
        // `PlayerRegistry` con `teamId === null`.
        const currentTeam = (teams || []).find((team) => team.roster.some((p) => p.id === player.id));
        if (currentTeam) {
          const report = RosterSvc().releasePlayer({
            playerRegistry, teams, playerId: player.id, fromTeamId: currentTeam.id, lineup,
          });
          rosterMutation = { fromTeamId: currentTeam.id, toTeamId: null };
          ctx.registerUndo(() => {
            currentTeam.addPlayer(player);
            report.restoreOperationalReferences();
          });
        }

        // (8) Reservas presupuestarias caducadas del club por este jugador.
        if (marketRegistry) {
          annualCycleRegistry.renewalCasesForPlayer(player.id)
            .filter((renewal) => renewal.clubId === contract.clubId && !renewal.isLiveOn(iso) && renewal.budgetReservationGroupId)
            .forEach((renewal) => {
              const before = (marketRegistry.getBudgetReservationGroup(renewal.budgetReservationGroupId) || [])
                .map((line) => ({ id: line.id, status: line.status }));
              if (!before.length) return;
              marketRegistry.releaseBudgetGroup(renewal.budgetReservationGroupId);
              releasedReservationGroupIds.push(renewal.budgetReservationGroupId);
              ctx.registerUndo(() => {
                before.forEach((line) => {
                  const current = marketRegistry.getBudgetReservation(line.id);
                  if (current) current.status = line.status;
                });
              });
            });
        }
      }

      // (9) Receipt de `contract-expiry`. El contrato vencido PERMANECE en
      // `ContractRegistry` como historia: no se borra, no se muta su
      // `endDate` y no se crea ninguna terminación falsa.
      const record = new CycleEntities.ContractExpiryRecord({
        id: `contract-expiry:${contract.id}`,
        cycleId: cycle ? cycle.id : null,
        transactionId,
        playerId: player.id,
        contractId: contract.id,
        clubId: contract.clubId,
        expiredEndDate: contract.endDate,
        effectiveDate: iso,
        outcome,
        continuityContractId: continuity.contractId || null,
        deactivatedRegistrationId,
        expiredLicenseId,
        releasedReservationGroupIds,
        rosterMutation,
        diagnostics,
      });
      annualCycleRegistry.registerExpiryRecord(record);
      ctx.registerUndo(() => { annualCycleRegistry.unregisterExpiryRecord(record.id); });

      // Entrada histórica en el propio contrato (evento de ciclo de vida
      // `expired`) — es HISTORIA, no un cambio de vigencia.
      const historyEventId = `${contract.id}:cycle-expiry:${contract.lifecycleEvents.length}`;
      contract.addLifecycleEvent({
        id: historyEventId,
        type: 'expiry-processed',
        date: iso,
        note: `CYCLE-1:${outcome}`,
      });
      ctx.registerUndo(() => { contract.removeLifecycleEvent(historyEventId); });

      // Proyección de nómina del club refrescada desde el registro (nunca
      // una segunda verdad editable).
      const clubTeam = (teams || []).find((team) => team.id === contract.clubId);
      if (clubTeam && seasonKey) {
        const before = clubTeam.finances.expenses.playerSalaries;
        ContractSvc().refreshTeamSalaryProjection(clubTeam, contractRegistry, seasonKey);
        ctx.registerUndo(() => { clubTeam.finances.expenses.playerSalaries = before; });
      }

      return { record, idempotent: false, continuity };
    });
  }

  // =====================================================================
  // 4. Procesado de TODAS las expiraciones vencidas hasta una fecha
  // =====================================================================
  // Orden canónico por `contractId` (determinista, independiente del orden
  // de los arrays). Devuelve el lote de receipts + bloqueos.
  function processDueExpirationsToDate(params) {
    const { contractRegistry, date } = params;
    const iso = toIso(date);
    const due = findDueExpirations({ contractRegistry, date: iso });
    const records = [];
    const blocked = [];
    due.forEach(({ contract, expiryDate }) => {
      const result = processExpiration({
        ...params, contract, expiryDate, date: LD().isAfter(expiryDate, iso) ? iso : expiryDate,
      });
      if (result.record) records.push(result.record);
      else if (result.blocked) blocked.push(result.diagnostic);
    });
    return { date: iso, records, blocked };
  }

  const exportsObj = {
    ContractExpiryService: {
      findDueExpirations,
      resolveContinuity,
      processExpiration,
      processDueExpirationsToDate,
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
