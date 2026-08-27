// src/core/LoanExecutionService.js
// LOAN-1 (DESIGN.md 9.21, sección 14 del prompt) — orquestador ATÓMICO de
// los DOS movimientos administrativos de una cesión: activación de salida
// (propietario -> cesionario) y retorno/recall/terminación anticipada
// (cesionario -> propietario). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Reutiliza EXACTAMENTE la misma infraestructura que
// `TransferExecutionService.js` — nunca la duplica (sección 14 del prompt:
// "no dupliques la saga"): `RosterMutationService` (frontera de roster),
// `OperationalReferenceService` (captura/limpieza/restauración de
// referencias operativas), `CanonicalHash` (fingerprint de contenido para
// replan-at-commit), y `TransferRegistry` para `FinancialObligation`/
// `TransactionRecord` (sección 8.8 del prompt: "si amplías TransactionRecord,
// LoanRegistry solo referencia su id" — nunca un segundo registro de
// recibos/obligaciones).
//
// `planTransaction()` NUNCA muta nada, no lee `state` global, no consume
// aleatoriedad. `commitTransaction()` es el ÚNICO punto que aplica
// mutaciones reales y las revierte EXACTAMENTE si cualquier paso lanza —
// mismo patrón de "saga" que TRANSFER-1, con UNA diferencia deliberada
// (sección 14.2 del prompt): en un retorno, el intento de RE-inscripción
// del propietario es una fase administrativa EXPLÍCITA fuera del batch
// atómico — un fallo ahí no revierte el roster/baja/recibo ya completados,
// el resultado queda tipado `returned-pending-registration`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const RegistrationServiceModule = isNode ? require('./RegistrationService.js') : global.BasketManager;
  const RosterMutationServiceModule = isNode ? require('./RosterMutationService.js') : global.BasketManager;
  const TransferEntities = isNode ? require('../entities/Transfer.js') : global.BasketManager;
  const CanonicalHashModule = isNode ? require('../utils/CanonicalHash.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function RegSvc() { return RegistrationServiceModule.RegistrationService; }
  function RosterSvc() { return RosterMutationServiceModule.RosterMutationService; }
  function stableHash(value) { return CanonicalHashModule.CanonicalHash.stableHash(value); }

  function toIso(date) {
    if (!date) throw new Error('LoanExecutionService: hace falta una fecha.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  class LoanDomainError extends Error {
    constructor(message, code, blockers) {
      super(message);
      this.code = code || 'LOAN_BLOCKED';
      this.blockers = blockers || [{ code: this.code, message }];
    }
  }

  const MOVEMENT_TYPES = ['activation', 'return', 'early-termination'];

  // ---------------------------------------------------------------------
  // 1. PLAN — fase pura. `command` esperado:
  //   { transactionId, movementType, loanAgreementId, playerId, fromClubId,
  //     toClubId, effectiveDate, seasonKey, fromCompetitionId,
  //     toCompetitionId, fromFederationId, toFederationId, transactionScope,
  //     fromRegistrationScopeId?, fromSeasonKey?, toRegistration?,
  //     recallClauseId?, earlyTerminationClauseId?, earlyTerminationConsents?,
  //     earlyTerminationSettlement? }
  // `deps`: { playerRegistry, contractRegistry, registrationRegistry,
  //   transferRegistry, loanRegistry, teams, operationalContext, lineup, now }
  // ---------------------------------------------------------------------
  function planTransaction(command, deps) {
    const cmd = command || {};
    const {
      playerRegistry, contractRegistry, registrationRegistry, transferRegistry, loanRegistry, teams,
    } = deps || {};
    ['transactionId', 'movementType', 'loanAgreementId', 'playerId', 'fromClubId', 'toClubId', 'effectiveDate', 'seasonKey'].forEach((field) => {
      if (!cmd[field]) throw new Error(`LoanExecutionService.planTransaction: falta "${field}" en el comando.`);
    });
    if (!MOVEMENT_TYPES.includes(cmd.movementType)) {
      throw new Error(`LoanExecutionService.planTransaction: movementType desconocido "${cmd.movementType}".`);
    }
    const effectiveDate = toIso(cmd.effectiveDate);
    const warnings = [];
    const blockers = [];
    const preconditions = [];

    function check(label, ok, blockerCode) {
      preconditions.push({ label, ok });
      if (!ok) blockers.push({ code: blockerCode || 'PRECONDITION_FAILED', message: label });
      return ok;
    }

    const player = playerRegistry.get(cmd.playerId);
    check(`El jugador "${cmd.playerId}" existe en el Player Registry mundial.`, Boolean(player), 'PLAYER_NOT_FOUND');
    const fromTeam = (teams || []).find((t) => t.id === cmd.fromClubId);
    const toTeam = (teams || []).find((t) => t.id === cmd.toClubId);
    check(`El club de origen "${cmd.fromClubId}" existe entre los equipos vivos.`, Boolean(fromTeam), 'FROM_CLUB_NOT_FOUND');
    check(`El club de destino "${cmd.toClubId}" existe entre los equipos vivos.`, Boolean(toTeam), 'TO_CLUB_NOT_FOUND');

    const hasOperationalContext = Boolean(deps.operationalContext) && typeof deps.operationalContext.pendingUserMatchBlocks === 'boolean';
    check('Existe un contexto operacional explícito (¿hay un partido del usuario iniciado o pendiente de revelar?).', hasOperationalContext, 'MISSING_OPERATIONAL_CONTEXT');
    if (hasOperationalContext && deps.operationalContext.pendingUserMatchBlocks) {
      blockers.push({ code: 'PENDING_USER_MATCH', message: 'Hay un partido del usuario iniciado o pendiente de revelar que usa la plantilla — bloquea la mutación de roster.' });
    }

    if (!player || !fromTeam || !toTeam) {
      return new TransferEntities.TransferExecutionPlan({
        transactionId: cmd.transactionId, command: cmd, preconditions, fingerprints: {}, operations: [], blockers, warnings, hash: stableHash(cmd), builtAt: effectiveDate,
      });
    }

    const agreement = loanRegistry.getAgreement(cmd.loanAgreementId);
    check(`El acuerdo de cesión "${cmd.loanAgreementId}" existe en LoanRegistry.`, Boolean(agreement), 'LOAN_AGREEMENT_NOT_FOUND');

    const masterContract = agreement ? contractRegistry.get(agreement.masterContractId) : null;
    check('El contrato matriz existe en ContractRegistry.', Boolean(masterContract), 'MASTER_CONTRACT_NOT_FOUND');
    if (masterContract) {
      check('El contrato matriz pertenece al club propietario declarado en el acuerdo.', masterContract.clubId === agreement.ownerClubId, 'MASTER_CONTRACT_OWNER_MISMATCH');
    }

    let resolvedLoanRules = null;
    if (agreement) {
      try {
        resolvedLoanRules = CompetitionRules.resolveLoanRules({
          playerId: cmd.playerId,
          masterContractId: agreement.masterContractId,
          ownerClubId: agreement.ownerClubId,
          borrowerClubId: agreement.borrowerClubId,
          ownerEmployerJurisdictionId: cmd.ownerEmployerJurisdictionId,
          borrowerEmployerJurisdictionId: cmd.borrowerEmployerJurisdictionId || null,
          originCompetitionId: cmd.fromCompetitionId || null,
          destinationCompetitionId: cmd.toCompetitionId || null,
          originFederationId: cmd.fromFederationId || null,
          destinationFederationId: cmd.toFederationId || null,
          seasonKey: cmd.seasonKey,
          effectiveDate,
          returnEffectiveDate: agreement.returnEffectiveDate,
          transactionScope: cmd.transactionScope || 'domestic',
          operation: cmd.movementType,
        });
      } catch (err) {
        blockers.push({ code: 'LOAN_RULES_ERROR', message: err.message });
      }
      if (resolvedLoanRules && resolvedLoanRules.blockers.length) {
        resolvedLoanRules.blockers.forEach((b) => blockers.push(b));
      }
    }

    // -- Validaciones específicas por movimiento -----------------------------
    if (agreement && cmd.movementType === 'activation') {
      check('El acuerdo está en estado "agreed" (aún no activado).', agreement.currentStatus() === 'agreed', 'LOAN_ALREADY_ACTIVATED_OR_TERMINAL');
      check('La fecha efectiva coincide con "serviceStartDate" del acuerdo.', effectiveDate === agreement.serviceStartDate, 'ACTIVATION_DATE_MISMATCH');
      check('El club de origen del movimiento es el propietario declarado.', cmd.fromClubId === agreement.ownerClubId, 'FROM_CLUB_MISMATCH');
      check('El club de destino del movimiento es el cesionario declarado.', cmd.toClubId === agreement.borrowerClubId, 'TO_CLUB_MISMATCH');
      check('El jugador está actualmente en la plantilla del propietario.', fromTeam.roster.some((p) => p.id === cmd.playerId), 'PLAYER_NOT_IN_OWNER_ROSTER');
      check('El jugador no aparece ya en la plantilla del cesionario.', !toTeam.roster.some((p) => p.id === cmd.playerId), 'PLAYER_ALREADY_IN_BORROWER_ROSTER');
      const existingActive = (() => {
        try { return loanRegistry.activeAgreementForPlayer(cmd.playerId, effectiveDate); } catch (err) { return 'invariant-broken'; }
      })();
      check('El jugador no tiene ya otra cesión activa a esta fecha.', !existingActive, 'PLAYER_ALREADY_ON_ACTIVE_LOAN');
    }
    if (agreement && (cmd.movementType === 'return' || cmd.movementType === 'early-termination')) {
      check('El acuerdo está "active" (salida ya ejecutada, sin retorno/terminación previos).', agreement.currentStatus() === 'active', 'LOAN_NOT_ACTIVE');
      check('El club de origen del movimiento es el cesionario declarado.', cmd.fromClubId === agreement.borrowerClubId, 'FROM_CLUB_MISMATCH');
      check('El club de destino del movimiento es el propietario declarado.', cmd.toClubId === agreement.ownerClubId, 'TO_CLUB_MISMATCH');
      check('El jugador está actualmente en la plantilla del cesionario.', fromTeam.roster.some((p) => p.id === cmd.playerId), 'PLAYER_NOT_IN_BORROWER_ROSTER');
      if (cmd.movementType === 'return' && cmd.recallClauseId) {
        const clause = agreement.clauses.find((c) => c.id === cmd.recallClauseId && c.type === 'recall-right');
        check('La cláusula de recall referenciada existe en el acuerdo.', Boolean(clause), 'RECALL_CLAUSE_NOT_FOUND');
        if (clause) {
          const inWindow = clause.windows.some((w) => !LD().isBefore(effectiveDate, w.startDate) && !LD().isAfter(effectiveDate, w.endDate));
          check('La fecha de recall cae dentro de alguna ventana pactada.', inWindow, 'RECALL_OUTSIDE_WINDOW');
        }
      }
      if (cmd.movementType === 'early-termination') {
        const clause = cmd.earlyTerminationClauseId ? agreement.clauses.find((c) => c.id === cmd.earlyTerminationClauseId && c.type === 'early-termination') : null;
        const hasClauseBasis = Boolean(clause);
        const consents = cmd.earlyTerminationConsents || [];
        const hasAllRequiredConsents = hasClauseBasis
          ? clause.requiresConsentOf.every((party) => consents.includes(party))
          : ['ownerClub', 'borrowerClub', 'player'].every((party) => consents.includes(party));
        check(
          'La terminación anticipada exige una cláusula tipada con sus consentimientos, o consentimiento mutuo explícito de las tres partes.',
          hasAllRequiredConsents, 'MISSING_EARLY_TERMINATION_BASIS',
        );
      }
    }

    // -- Documentos/registro de destino (validación de disponibilidad) ------
    if (registrationRegistry && cmd.toRegistration && cmd.toRegistration.registrationScopeId) {
      const currentCumulative = registrationRegistry.cumulativeCountForClub(cmd.toClubId, cmd.toRegistration.registrationScopeId, cmd.seasonKey);
      const cap = cmd.toRegistration.cumulativeRegistrationCapMax;
      if (cap !== undefined && cap !== null && cmd.movementType === 'activation') {
        check(`El club de destino no ha agotado el cupo acumulado de inscripción declarado (${currentCumulative}/${cap}).`, currentCumulative < cap, 'REGISTRATION_CAP_EXCEEDED');
      }
    }

    // -- Fingerprints (revalidación en commit) — mismo criterio que
    //    TRANSFER-1 (BUG-TRANSFER1-17): contenido, nunca solo conteos.
    const fingerprints = {
      agreementStatus: agreement ? agreement.currentStatus() : null,
      agreementContentHash: agreement ? stableHash(agreement.toJSON()) : null,
      masterContractLifecycleHash: masterContract ? stableHash(masterContract.lifecycleEvents) : null,
      fromRosterPlayerIds: fromTeam.roster.map((p) => p.id).sort(),
      toRosterPlayerIds: toTeam.roster.map((p) => p.id).sort(),
      destinationCumulativeRegistrationCount: (registrationRegistry && cmd.toRegistration && cmd.toRegistration.registrationScopeId)
        ? registrationRegistry.cumulativeCountForClub(cmd.toClubId, cmd.toRegistration.registrationScopeId, cmd.seasonKey)
        : null,
      resolvedLoanRulesHash: resolvedLoanRules ? stableHash(resolvedLoanRules.trace) : null,
      pendingUserMatchBlocks: hasOperationalContext ? deps.operationalContext.pendingUserMatchBlocks : null,
    };

    return new TransferEntities.TransferExecutionPlan({
      transactionId: cmd.transactionId,
      command: cmd,
      preconditions,
      fingerprints,
      operations: ['apply-origin-deregistration', 'move-roster', 'register-obligations', 'update-agreement', 'create-destination-registration', 'register-movement-record'],
      newObjects: { agreement, masterContract, resolvedLoanRules },
      obligations: cmd.obligations || [],
      blockers,
      warnings,
      hash: stableHash({
        transactionId: cmd.transactionId, movementType: cmd.movementType, playerId: cmd.playerId, fromClubId: cmd.fromClubId, toClubId: cmd.toClubId, effectiveDate,
      }),
      builtAt: effectiveDate,
    });
  }

  // ---------------------------------------------------------------------
  // 2/3. REVALIDACIÓN + COMMIT/ROLLBACK.
  // ---------------------------------------------------------------------
  function commitTransaction(plan, deps) {
    const {
      playerRegistry, contractRegistry, registrationRegistry, transferRegistry, loanRegistry, teams,
    } = deps || {};

    const already = transferRegistry.completedTransaction(plan.transactionId);
    if (already) return { record: already, idempotent: true, registrationOutcome: 'active' };

    if (!plan.isExecutable) {
      throw new LoanDomainError(
        `LoanExecutionService.commitTransaction: el plan "${plan.transactionId}" tiene blockers sin resolver: `
        + plan.blockers.map((b) => b.message).join(' | '),
        'PLAN_HAS_BLOCKERS', plan.blockers,
      );
    }

    const cmd = plan.command;
    const effectiveDate = toIso(cmd.effectiveDate);

    if (!deps.operationalContext || typeof deps.operationalContext.pendingUserMatchBlocks !== 'boolean') {
      throw new LoanDomainError('LoanExecutionService.commitTransaction: falta "operationalContext" explícito en las dependencias.', 'MISSING_OPERATIONAL_CONTEXT');
    }
    // Replan-at-commit (BUG-TRANSFER1-17, mismo criterio reutilizado aquí).
    const freshPlan = planTransaction(cmd, deps);
    if (!freshPlan.isExecutable) {
      throw new LoanDomainError(
        `El plan "${plan.transactionId}" ya no es ejecutable al revalidar contra el estado actual: `
        + freshPlan.blockers.map((b) => b.message).join(' | '),
        'PLAN_STALE_BLOCKED', freshPlan.blockers,
      );
    }
    const staleFields = Object.keys(plan.fingerprints).filter(
      (key) => stableHash(plan.fingerprints[key]) !== stableHash(freshPlan.fingerprints[key]),
    );
    if (staleFields.length) {
      throw new LoanDomainError(
        `El plan "${plan.transactionId}" quedó obsoleto desde que se planificó — cambió: ${staleFields.join(', ')}. Replanifica.`,
        'PLAN_STALE_CONTENT',
      );
    }
    const resolvedPlan = freshPlan;

    const undoStack = [];
    function registerUndo(fn) { undoStack.push(fn); }

    let record;
    try {
      const { agreement, resolvedLoanRules } = resolvedPlan.newObjects;
      const player = playerRegistry.require(cmd.playerId);
      const fromTeam = (teams || []).find((t) => t.id === cmd.fromClubId);

      // 1) baja regulatoria de origen (propietario en activación, cesionario
      //    en retorno/terminación anticipada).
      let deactivatedRegistrationId = null;
      if (registrationRegistry && cmd.fromRegistrationScopeId) {
        const currentReg = registrationRegistry.currentRegistration(cmd.playerId, cmd.fromRegistrationScopeId, cmd.fromSeasonKey || cmd.seasonKey, effectiveDate);
        if (currentReg) {
          const deactivationEventId = `${currentReg.id}:deactivated:${currentReg.events.length}`;
          const previousReasonCode = currentReg.trace.deactivationReasonCode;
          RegSvc().deactivateRegistration(currentReg, effectiveDate, `LOAN-1:${cmd.movementType}`);
          deactivatedRegistrationId = currentReg.id;
          registerUndo(() => {
            currentReg.removeEvent(deactivationEventId);
            if (previousReasonCode === undefined) delete currentReg.trace.deactivationReasonCode;
            else currentReg.trace.deactivationReasonCode = previousReasonCode;
          });
        }
      }

      // 2) mover afiliación canónica (frontera única) — captura/limpia
      //    referencias operativas del club de ORIGEN de este movimiento.
      const rosterReport = RosterSvc().transferPlayer({
        playerRegistry, teams, playerId: cmd.playerId, fromTeamId: cmd.fromClubId, toTeamId: cmd.toClubId, lineup: deps.lineup,
      });
      registerUndo(() => {
        const backTeam = (teams || []).find((t) => t.id === rosterReport.fromTeamId);
        const forwardTeam = (teams || []).find((t) => t.id === rosterReport.toTeamId);
        if (forwardTeam) forwardTeam.removePlayer(cmd.playerId);
        if (backTeam) backTeam.addPlayer(player);
        else playerRegistry.setAffiliation(cmd.playerId, null);
        rosterReport.restoreOperationalReferences();
      });

      // 3) obligaciones económicas (reutiliza FinancialObligation de
      //    Transfer.js — sección 16 del prompt: conceptos SEPARADOS).
      const registeredObligations = resolvedPlan.obligations.map((line, idx) => {
        const obligation = new TransferEntities.FinancialObligation({
          id: `obligation:${plan.transactionId}:${idx}`, transactionId: plan.transactionId, ...line,
        });
        transferRegistry.registerObligation(obligation);
        registerUndo(() => { transferRegistry.unregisterObligation(obligation.id); });
        return obligation;
      });

      // 4) marcar el acuerdo (activo / devuelto / terminado anticipadamente)
      //    — mutación reversible por cierre directo (LoanAgreement no está
      //    congelado; el mismo criterio que "agreement.completedTransactionId
      //    = null" del rollback de TRANSFER-1).
      const fieldToSet = cmd.movementType === 'activation' ? 'outboundTransactionId'
        : cmd.movementType === 'return' ? 'returnTransactionId' : 'earlyTerminationRecordId';
      const previousFieldValue = agreement[fieldToSet];
      agreement[fieldToSet] = plan.transactionId;
      registerUndo(() => { agreement[fieldToSet] = previousFieldValue; });
      const previousObligationIds = agreement.obligationIds;
      agreement.obligationIds = Object.freeze([...previousObligationIds, ...registeredObligations.map((o) => o.id)]);
      registerUndo(() => { agreement.obligationIds = previousObligationIds; });

      // 5) inscripción de destino — ATÓMICA en activación (sección 14.1:
      //    "si la inscripción del cesionario falla, no hay salida ni estado
      //    parcial"); en retorno/terminación se intenta aparte, fuera de
      //    este bloque (sección 14.2), nunca aquí.
      let createdLicenseId = null;
      let createdRegistrationId = null;
      if (cmd.movementType === 'activation' && registrationRegistry && cmd.toRegistration) {
        const regCmd = cmd.toRegistration;
        // Id explícito por transacción (mismo motivo que la inscripción de
        // abajo): un jugador puede volver a licenciarse en el MISMO club
        // dentro de la misma temporada (p.ej. cedido y devuelto, y luego
        // vuelto a ceder o comprado en firme por el mismo cesionario) — el
        // id determinista por defecto (playerId+clubId+season) chocaría con
        // la licencia anterior, desactivada pero no borrada.
        const license = RegSvc().issueLicense({
          registry: registrationRegistry, id: `license:${plan.transactionId}`, playerId: cmd.playerId, clubId: cmd.toClubId, federationId: regCmd.federationId,
          seasonKey: regCmd.seasonKey, licenseClass: regCmd.licenseClass, validity: regCmd.validity,
          documentStatuses: regCmd.documentStatuses || {}, date: effectiveDate, provenance: { dataSource: 'simulated-loan-v1', isReal: false },
        });
        createdLicenseId = license.id;
        registerUndo(() => { registrationRegistry.unregisterLicense(license.id); });

        const registration = RegSvc().createRegistration({
          registry: registrationRegistry,
          id: `registration:${plan.transactionId}`,
          playerId: cmd.playerId,
          licenseId: license.id,
          teamId: cmd.toClubId,
          competitionId: regCmd.competitionId,
          competitionInstanceId: regCmd.competitionInstanceId,
          registrationScopeId: regCmd.registrationScopeId,
          seasonKey: regCmd.seasonKey,
          accessCategory: 'senior',
          contractId: agreement.masterContractId,
          contractRegistry,
          employmentBasis: {
            type: 'temporary-assignment', contractId: agreement.masterContractId, loanAgreementId: agreement.id, employerClubId: agreement.ownerClubId, serviceClubId: agreement.borrowerClubId,
          },
          classificationSnapshot: regCmd.classificationSnapshot,
          date: effectiveDate,
          resolved: regCmd.resolved,
          provenance: { dataSource: 'simulated-loan-v1', isReal: false },
        });
        createdRegistrationId = registration.id;
        registerUndo(() => { registrationRegistry.unregisterRegistration(registration.id); });
      }

      // 6) recibo del movimiento — recibo REUTILIZADO de TRANSFER-1
      //    (TransactionRecord, sección 8.8 del prompt), operationType/
      //    mechanism propios de LOAN-1.
      const mechanism = cmd.movementType === 'activation' ? 'loan-activation' : cmd.movementType === 'return' ? 'loan-return' : 'loan-early-termination';
      record = new TransferEntities.TransactionRecord({
        id: plan.transactionId,
        transferCaseId: cmd.loanCaseId || plan.transactionId,
        playerId: cmd.playerId,
        operationType: `loan-${cmd.movementType}`,
        mechanism,
        effectiveDate,
        completedAt: effectiveDate,
        originClubId: cmd.fromClubId,
        destinationClubId: cmd.toClubId,
        deactivatedRegistrationId,
        createdRegistrationId,
        createdLicenseId,
        obligationIds: registeredObligations.map((o) => o.id),
        rosterMutationReport: { fromTeamId: rosterReport.fromTeamId, toTeamId: rosterReport.toTeamId },
        rulesSnapshot: resolvedLoanRules ? { trace: resolvedLoanRules.trace } : null,
        sourceRefs: resolvedLoanRules ? resolvedLoanRules.sourceRefs : [],
        warnings: resolvedPlan.warnings,
      });
      transferRegistry.registerTransactionRecord(record);
      registerUndo(() => { transferRegistry.unregisterTransactionRecord(record.id); });
    } catch (err) {
      for (let i = undoStack.length - 1; i >= 0; i -= 1) undoStack[i]();
      throw err;
    }

    // --- Fase administrativa NO atómica (sección 14.2): SOLO en retorno, el
    //     intento de RE-inscripción del propietario. Un fallo aquí NUNCA
    //     revierte el bloque anterior (ya completado con éxito) — el
    //     resultado queda tipado.
    let registrationOutcome = 'not-applicable';
    if (cmd.movementType === 'activation') registrationOutcome = 'active';
    if ((cmd.movementType === 'return' || cmd.movementType === 'early-termination') && registrationRegistry && cmd.toRegistration) {
      try {
        const regCmd = cmd.toRegistration;
        // El contrato matriz nunca se movió durante la cesión (solo
        // afiliación de plantilla/licencia lo hicieron) — sigue siendo el
        // contrato vigente del propietario al volver, así que la
        // inscripción de retorno debe referenciarlo (nunca null: una
        // inscripción senior activa exige contrato — BUG-REG1-07).
        const returnAgreement = loanRegistry.getAgreement(cmd.loanAgreementId);
        const returnMasterContractId = returnAgreement ? returnAgreement.masterContractId : null;
        // Id explícito: el propietario YA tenía una licencia en este club+
        // temporada antes de la cesión (desactivada, no borrada, al activar
        // la cesión) — el id determinista por defecto chocaría con ella al
        // volver.
        const license = RegSvc().issueLicense({
          registry: registrationRegistry, id: `license:return:${plan.transactionId}`, playerId: cmd.playerId, clubId: cmd.toClubId, federationId: regCmd.federationId,
          seasonKey: regCmd.seasonKey, licenseClass: regCmd.licenseClass, validity: regCmd.validity,
          documentStatuses: regCmd.documentStatuses || {}, date: effectiveDate, provenance: { dataSource: 'simulated-loan-v1', isReal: false },
        });
        RegSvc().createRegistration({
          registry: registrationRegistry,
          id: `registration:return:${plan.transactionId}`,
          playerId: cmd.playerId,
          licenseId: license.id,
          teamId: cmd.toClubId,
          competitionId: regCmd.competitionId,
          competitionInstanceId: regCmd.competitionInstanceId,
          registrationScopeId: regCmd.registrationScopeId,
          seasonKey: regCmd.seasonKey,
          accessCategory: 'senior',
          contractId: returnMasterContractId,
          contractRegistry,
          classificationSnapshot: regCmd.classificationSnapshot,
          date: effectiveDate,
          resolved: regCmd.resolved,
          provenance: { dataSource: 'simulated-loan-v1', isReal: false },
        });
        registrationOutcome = 'active';
      } catch (err) {
        // Sección 14.2: el jugador vuelve al propietario, mantiene el
        // contrato matriz, pero NO es elegible hasta inscribirse — nunca se
        // le deja en el cesionario ni se inventa una excepción.
        registrationOutcome = 'pending-registration';
      }
    }

    return { record, idempotent: false, registrationOutcome };
  }

  const exportsObj = {
    LoanExecutionService: {
      LoanDomainError,
      MOVEMENT_TYPES,
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
