// src/core/AnnualCycleService.js
// CYCLE-1 (DESIGN.md 9.22, secciones 7/8 del prompt) — MÁQUINA DE ESTADOS
// anual del ciclo de plantilla y reloj del verano. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Sustituye el cierre anual monolítico de `closeSeasonAndPrepareNext()`
// (BUG-CYCLE1-05: ascensos -> historia -> re-siembra de inscripciones ANTES
// de decidir contratos -> `generateAcademyIntake(3)` a los 36 clubes -> 108
// seniors nuevos sin ninguna salida -> calendario nuevo, todo de golpe).
//
// Principios:
//  - el estado del ciclo se DERIVA de un ledger append-only de eventos
//    (`CycleEventTypes.AnnualCycleEvents`), nunca de un `status` mutable;
//  - no se puede entrar en una fase sin precondiciones verificadas, ni
//    empezar temporada con un club `not-ready`;
//  - cada club conserva la fecha REAL de su último partido oficial: los
//    plazos que dependen de ella se abren desde la fecha de ESE club, nunca
//    desde la final para los 36;
//  - dentro de una misma fecha civil, el orden de eventos sigue la tabla de
//    prioridad centralizada de `CycleConfig.SAME_DATE_EVENT_PRIORITY`, y a
//    igualdad de prioridad se ordena por id canónico (nunca por posición en
//    un array);
//  - una consulta NUNCA consume aleatoriedad ni muta el mundo;
//  - toda noticia se deriva DESPUÉS del receipt comprometido (este módulo no
//    construye ninguna).
//
// Módulo puro: no lee DOM ni `state`; recibe registros/equipos/fechas
// explícitos y, para el cierre deportivo (ascensos/descensos/honores/
// histórico, que ya existía y NO se reescribe), un `hooks.closeSeasonHistory`
// aportado por la capa de orquestación.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CareerAgeModule = isNode ? require('../utils/CareerAge.js') : global.BasketManager;
  const CanonicalHashModule = isNode ? require('../utils/CanonicalHash.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;
  const CycleEntities = isNode ? require('../entities/Cycle.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const ContractSeederModule = isNode ? require('./ContractSeeder.js') : global.BasketManager;
  const ContractExpiryModule = isNode ? require('./ContractExpiryService.js') : global.BasketManager;
  const RenewalServiceModule = isNode ? require('./RenewalService.js') : global.BasketManager;
  const RetirementServiceModule = isNode ? require('./RetirementService.js') : global.BasketManager;
  const AcademyServiceModule = isNode ? require('./AcademyService.js') : global.BasketManager;
  const WorldLifecycleModule = isNode ? require('./WorldLifecycleService.js') : global.BasketManager;
  const CpuRosterPlannerModule = isNode ? require('./CpuRosterPlanner.js') : global.BasketManager;
  const MarketClearinghouseModule = isNode ? require('./MarketClearinghouse.js') : global.BasketManager;
  const RosterLegalityModule = isNode ? require('./RosterLegalityService.js') : global.BasketManager;
  const RegistrationSeederModule = isNode ? require('./RegistrationSeeder.js') : global.BasketManager;
  const RegistrationServiceModule = isNode ? require('./RegistrationService.js') : global.BasketManager;
  const RightOfFirstRefusalModule = isNode ? require('./RightOfFirstRefusalService.js') : global.BasketManager;
  const MarketServiceModule = isNode ? require('./MarketService.js') : global.BasketManager;
  const PlayerDevelopmentModule = isNode ? require('./PlayerDevelopment.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function CareerAge() { return CareerAgeModule.CareerAge; }
  function Hash() { return CanonicalHashModule.CanonicalHash; }
  function CC() { return CycleConfigModule.CycleConfig; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function ContractSeeder() { return ContractSeederModule.ContractSeeder; }
  function ExpirySvc() { return ContractExpiryModule.ContractExpiryService; }
  function RenewalSvc() { return RenewalServiceModule.RenewalService; }
  function RetirementSvc() { return RetirementServiceModule.RetirementService; }
  function AcademySvc() { return AcademyServiceModule.AcademyService; }
  function WorldLifecycle() { return WorldLifecycleModule.WorldLifecycleService; }
  function Planner() { return CpuRosterPlannerModule.CpuRosterPlanner; }
  function Clearinghouse() { return MarketClearinghouseModule.MarketClearinghouse; }
  function LegalitySvc() { return RosterLegalityModule.RosterLegalityService; }
  function RegistrationSeeder() { return RegistrationSeederModule.RegistrationSeeder; }
  function RegSvc() { return RegistrationServiceModule.RegistrationService; }
  function RofrSvc() { return RightOfFirstRefusalModule.RightOfFirstRefusalService; }
  function MarketSvc() { return MarketServiceModule.MarketService; }
  function PD() { return PlayerDevelopmentModule; }

  const CYCLE_SOURCE_VERSION = 'annual-cycle-service-v1';

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // =====================================================================
  // 1. Gateway de cumplimiento de pagos (sección 11 del prompt)
  // =====================================================================
  // La economía completa sigue FUERA DE ALCANCE: no hay tesorería, ni caja,
  // ni impagos jugables. Este gateway es el ÚNICO punto comprobable por
  // tests: sin ledger real devuelve "no existe deuda confirmada" con
  // procedencia visible. `unknown` NUNCA se convierte en deuda en silencio.
  function paymentComplianceEvidence(params) {
    const { contractId, clubId, date, paymentLedger } = params || {};
    if (!paymentLedger) {
      return {
        ...CC().PAYMENT_COMPLIANCE_DEFAULT, contractId: contractId || null, clubId: clubId || null, date: date ? toIso(date) : null,
      };
    }
    const evidence = paymentLedger.evidenceFor(contractId, clubId, toIso(date));
    if (!evidence || !evidence.status) {
      return {
        status: 'unknown',
        provenance: 'payment-ledger-returned-no-evidence',
        note: 'El ledger no aporta evidencia: "unknown" NUNCA se interpreta como deuda confirmada.',
        contractId: contractId || null,
        clubId: clubId || null,
        date: date ? toIso(date) : null,
      };
    }
    return { ...evidence, contractId, clubId, date: toIso(date) };
  }

  // =====================================================================
  // 2. Apertura del ciclo
  // =====================================================================
  // `evidence`: `[{ clubId, date, competitionId, phaseId, matchId, opponentClubId }]`
  // — la fecha REAL del último partido oficial de CADA club, recogida
  // durante la temporada (nunca la de la final para todos).
  function openCycle(params) {
    const {
      annualCycleRegistry, teams, fromSeasonKey, targetSeasonKey, evidence, date, playerRegistry, contractRegistry,
    } = params;
    const iso = toIso(date);
    const existing = annualCycleRegistry.cycleForSeason(fromSeasonKey);
    if (existing) return { cycle: existing, idempotent: true };

    const evidenceRows = [...(evidence || [])].sort((a, b) => (a.clubId < b.clubId ? -1 : 1));
    if (!evidenceRows.length) {
      throw new Error(
        'AnnualCycleService.openCycle: hace falta la evidencia del último partido oficial de cada club — '
        + 'CYCLE-1 nunca inventa una fecha de cierre global (sección 7 del prompt).',
      );
    }
    const worldLastMatchDate = evidenceRows.map((row) => row.date).sort((a, b) => LD().compare(a, b)).pop();

    const cycle = new CycleEntities.AnnualRosterCycle({
      id: `cycle:${fromSeasonKey}`,
      fromSeasonKey,
      targetSeasonKey,
      openedAt: iso,
      openingWorldFingerprint: Hash().stableHash({
        players: playerRegistry ? playerRegistry.snapshot().sort((a, b) => (a.id < b.id ? -1 : 1)) : [],
        contracts: contractRegistry ? contractRegistry.snapshot().sort((a, b) => (a.id < b.id ? -1 : 1)) : [],
        clubs: [...(teams || [])].map((team) => ({ clubId: team.id, division: team.division })).sort((a, b) => (a.clubId < b.clubId ? -1 : 1)),
      }),
      competitionMembershipSnapshot: [...(teams || [])]
        .map((team) => ({
          clubId: team.id,
          competitionId: CompetitionRules.competitionIdFromLegacyDivision(team.division),
          division: team.division,
        }))
        .sort((a, b) => (a.clubId < b.clubId ? -1 : 1)),
      clubLastOfficialMatchEvidence: evidenceRows,
      summerSchedule: CC().buildSummerSchedule(worldLastMatchDate, fromSeasonKey),
      sourceVersion: CYCLE_SOURCE_VERSION,
      provenance: { dataSource: 'simulated-cycle-v1', isReal: false, generatorVersion: CYCLE_SOURCE_VERSION },
    });
    annualCycleRegistry.registerCycle(cycle);
    cycle.addEvent({
      id: `${cycle.id}:phase:competitions-complete`,
      type: 'phase:competitions-complete',
      date: iso,
      data: { worldLastMatchDate, clubs: evidenceRows.length },
    });
    return { cycle, idempotent: false };
  }

  // =====================================================================
  // 3. Fases — cada una con sus precondiciones y su paso real
  // =====================================================================
  function requirePhase(cycle, expectedPhaseId) {
    const current = cycle.currentPhase();
    if (current !== expectedPhaseId) {
      throw new Error(
        `AnnualCycleService: precondición de fase no cumplida — el ciclo "${cycle.id}" está en `
        + `"${current}" y se esperaba "${expectedPhaseId}" (el orden de fases no se salta).`,
      );
    }
  }

  function enterPhase(cycle, phaseId, date, data) {
    cycle.addEvent({
      id: `${cycle.id}:phase:${phaseId}`, type: `phase:${phaseId}`, date: toIso(date), data: data || null,
    });
    return cycle.currentPhase();
  }

  // --- 3.1 snapshot-frozen: expedientes de club + nómina de apertura ----
  function freezeSnapshot(params) {
    const {
      annualCycleRegistry, cycle, teams, contractRegistry, date, targetSeasonKey,
    } = params;
    requirePhase(cycle, 'competitions-complete');
    const iso = toIso(date);
    const created = [];
    [...(teams || [])].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((team) => {
      const employmentContext = ContractSvc().resolveEmploymentContext(team, {});
      const clubCase = new CycleEntities.ClubCycleCase({
        id: `club-cycle:${cycle.id}:${team.id}`,
        cycleId: cycle.id,
        clubId: team.id,
        // La competición de destino se fija DESPUÉS de ascensos/descensos
        // (fase `season-history-closed`); aquí se registra la actual y se
        // actualiza al cerrar la historia deportiva.
        targetCompetitionId: CompetitionRules.competitionIdFromLegacyDivision(team.division),
        targetDivision: team.division,
        // MoraBanc Andorra conserva AD aunque compita en ACB.
        employerJurisdictionId: employmentContext.employerJurisdictionId,
        lastOfficialMatchDate: cycle.lastOfficialMatchDateForClub(team.id),
        provenance: { dataSource: 'simulated-cycle-v1', isReal: false },
      });
      annualCycleRegistry.registerClubCase(clubCase);
      clubCase.addEvent({ id: `${clubCase.id}:opened`, type: 'case-opened', date: iso });
      clubCase.addEvent({
        id: `${clubCase.id}:evidence`,
        type: 'last-match-evidence-recorded',
        date: iso,
        data: { lastOfficialMatchDate: clubCase.lastOfficialMatchDate },
      });
      // Referencia de nómina de apertura CONGELADA aquí: ANTES de que
      // expire ningún contrato (sección 16 del prompt).
      const payroll = ContractSvc().guaranteedPayrollForClub(contractRegistry, team.id, cycle.fromSeasonKey);
      clubCase.openingPayrollReference = {
        amountMinor: payroll.amountMinor,
        currency: payroll.currency,
        seasonKey: cycle.fromSeasonKey,
        frozenAt: iso,
      };
      clubCase.addEvent({
        id: `${clubCase.id}:payroll-frozen`,
        type: 'opening-payroll-frozen',
        date: iso,
        data: { amountMinor: payroll.amountMinor, seasonKey: cycle.fromSeasonKey },
      });
      created.push(clubCase);
    });
    void targetSeasonKey;
    enterPhase(cycle, 'snapshot-frozen', iso, { clubCases: created.length });
    return { clubCases: created };
  }

  // --- 3.2 season-history-closed: cierre DEPORTIVO ya existente ---------
  // El cierre deportivo (ascensos/descensos, honores, `teamStints`,
  // histórico de carrera) YA existía y NO se reescribe: lo ejecuta el hook
  // de la capa de orquestación reutilizando `League`/`Bracket`/
  // `PlayerCareer` tal cual. Esta fase solo lo ORDENA y lo registra.
  function closeSeasonHistory(params) {
    const {
      annualCycleRegistry, cycle, teams, date, hooks,
    } = params;
    requirePhase(cycle, 'snapshot-frozen');
    const iso = toIso(date);
    const summary = (hooks && typeof hooks.closeSeasonHistory === 'function')
      ? hooks.closeSeasonHistory({ cycle, date: iso })
      : { promoted: [], relegated: [] };
    // Los expedientes de club actualizan su competición de DESTINO con la
    // división ya modificada por ascensos/descensos.
    (teams || []).forEach((team) => {
      const clubCase = annualCycleRegistry.clubCaseFor(cycle.id, team.id);
      if (!clubCase) return;
      clubCase.targetCompetitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
      clubCase.targetDivision = team.division;
    });
    enterPhase(cycle, 'season-history-closed', iso, {
      promoted: summary.promoted || [], relegated: summary.relegated || [],
    });
    return summary;
  }

  // --- 3.3 loans-and-options-reviewed ----------------------------------
  // Cesiones: sus retornos los procesa el punto ÚNICO del reloj (LOAN-1),
  // nunca esta fase. Aquí se revisan las OPCIONES contractuales tipadas:
  // se crea la decisión (persistida SIEMPRE, aunque no se ejerza) y se
  // ejerce solo con términos completos, ventana abierta y consentimientos.
  function reviewLoansAndOptions(params) {
    const {
      annualCycleRegistry, cycle, teams, contractRegistry, playerRegistry, date, targetSeasonKey, config, userClubId,
    } = params;
    requirePhase(cycle, 'season-history-closed');
    const iso = toIso(date);
    const decisions = [];
    const exercised = [];
    [...(teams || [])].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((team) => {
      const resolved = ContractSvc().resolveRulesForClub(team, {
        seasonKey: targetSeasonKey, date: iso, operation: 'signContract',
      });
      contractRegistry.forClub(team.id)
        .filter((contract) => contract.isCurrentOn(iso))
        .forEach((contract) => {
          contract.clauses
            .filter((clause) => RenewalSvc().OPTION_CLAUSE_TYPES.includes(clause.type))
            .forEach((clause) => {
              const decision = RenewalSvc().buildOptionDecision({
                annualCycleRegistry, cycle, contract, clause, date: iso,
              });
              decisions.push(decision);
              // El club del USUARIO nunca ejerce nada sin su decisión
              // explícita (sección 15 del prompt).
              if (team.id === userClubId) return;
              const executability = decision.describeExecutability();
              if (!executability.executable) return;
              if (!decision.isWithinWindow(iso)) return;
              const player = playerRegistry.get(contract.playerId);
              if (!player) return;
              const addedCostMinor = decision.compensationSeasons
                .reduce((sum, season) => sum + (season.guaranteedBaseSalaryMinor || 0), 0);
              const clubCase = annualCycleRegistry.clubCaseFor(cycle.id, team.id);
              const budgetLimit = clubCase && clubCase.openingPayrollReference
                ? clubCase.openingPayrollReference.amountMinor : 0;
              const committed = ContractSvc().guaranteedPayrollForClub(contractRegistry, team.id, targetSeasonKey).amountMinor;
              const cpuChoice = RenewalSvc().decideOptionForCpu({
                decision,
                qualityIndex: Math.min(1, PD().computeTmbRating(player, config) / 200),
                budgetAvailableMinor: Math.max(0, Math.round(budgetLimit * CC().BUDGET.openingPayrollMultiplierMin) - committed),
                addedSeasonCostMinor: addedCostMinor,
              });
              if (!cpuChoice.exercise) {
                if (decision.currentStatus() === 'open') {
                  decision.addEvent({
                    id: `${decision.id}:declined`, type: 'declined', date: iso, data: { reasons: cpuChoice.reasons },
                  });
                }
                return;
              }
              const result = RenewalSvc().exerciseOption({
                annualCycleRegistry,
                contractRegistry,
                playerRegistry,
                decision,
                contract,
                player,
                team,
                resolved,
                seasonKey: targetSeasonKey,
                date: iso,
                clubConsent: decision.clauseType !== 'player-option',
                playerConsent: decision.clauseType !== 'club-option',
              });
              if (result.contract) exercised.push(result.contract.id);
            });
        });
    });
    enterPhase(cycle, 'loans-and-options-reviewed', iso, {
      decisions: decisions.length, exercised: exercised.length,
    });
    return { decisions, exercised };
  }

  // --- 3.4 rights-and-retention-open ----------------------------------
  // (a) Derecho de tanteo ORGÁNICO: se abre para los casos que resuelva el
  //     ruleset APLICABLE, usando la fecha del último partido oficial de
  //     ESE club (nunca la de la final para los 36).
  // (b) Retención: primera ronda del clearinghouse (renovaciones y
  //     promociones de cantera). Los contratos todavía NO han vencido, así
  //     que aquí no hay agencia libre.
  function openRightsAndRetention(params) {
    const {
      annualCycleRegistry, cycle, teams, contractRegistry, playerRegistry, marketRegistry, date, targetSeasonKey,
      paymentLedger,
    } = params;
    requirePhase(cycle, 'loans-and-options-reviewed');
    const iso = toIso(date);
    const rightsCases = [];
    const skipped = [];

    [...(teams || [])].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((team) => {
      const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
      let marketContext = null;
      try {
        marketContext = MarketSvc().resolveMarketContext({
          domesticCompetitionId: competitionId, seasonKey: cycle.fromSeasonKey, date: iso,
        });
      } catch (err) {
        skipped.push({ clubId: team.id, reason: 'MARKET_RULES_UNRESOLVED', message: err.message });
        return;
      }
      // Sin procedimiento doméstico resuelto NO se abre nada: Primera FEB
      // NUNCA hereda el tanteo ACB (invariante 32/33 de la EPIC).
      const hasProcedure = Boolean(marketContext.market && marketContext.market.domesticProcedure);
      if (!hasProcedure) {
        skipped.push({ clubId: team.id, reason: 'NO_DOMESTIC_PROCEDURE_FOR_COMPETITION', competitionId });
        return;
      }
      const clubLastMatchDate = cycle.lastOfficialMatchDateForClub(team.id);
      if (!clubLastMatchDate) {
        skipped.push({ clubId: team.id, reason: 'NO_LAST_MATCH_EVIDENCE' });
        return;
      }
      contractRegistry.forClub(team.id)
        .filter((contract) => contract.isCurrentOn(iso))
        // Contrato REALMENTE expirable: termina con esta temporada.
        .filter((contract) => !contract.coveredSeasonKeys.includes(targetSeasonKey))
        .forEach((contract) => {
          const player = playerRegistry.get(contract.playerId);
          if (!player) return;
          // Sin duplicado previo para el MISMO hecho.
          const alreadyOpen = marketRegistry.rightsCasesForPlayer(contract.playerId)
            .some((entry) => entry.originClubId === team.id && entry.lastOfficialMatchDate === clubLastMatchDate);
          if (alreadyOpen) return;
          // Evidencia de deuda: sin ledger, "no existe deuda confirmada".
          const compliance = paymentComplianceEvidence({
            contractId: contract.id, clubId: team.id, date: iso, paymentLedger,
          });
          try {
            const rightsCase = RofrSvc().openCase({
              marketRegistry,
              playerId: contract.playerId,
              originClubId: team.id,
              lastOfficialMatchDate: clubLastMatchDate,
              procedureType: 'right-of-first-refusal',
              marketContext,
              id: `rights-case:${cycle.id}:${team.id}:${contract.playerId}`,
            });
            rightsCases.push({
              rightsCaseId: rightsCase.id,
              clubId: team.id,
              playerId: contract.playerId,
              lastOfficialMatchDate: clubLastMatchDate,
              paymentCompliance: compliance.status,
              paymentComplianceProvenance: compliance.provenance,
            });
          } catch (err) {
            skipped.push({
              clubId: team.id, playerId: contract.playerId, reason: 'RIGHTS_CASE_NOT_OPENED', message: err.message,
            });
          }
        });
    });

    const retention = runClearingRound({ ...params, roundIndex: 0, date: iso, includeFreeAgency: false });
    enterPhase(cycle, 'rights-and-retention-open', iso, {
      rightsCases: rightsCases.length, skipped: skipped.length, retentionDecisions: retention.decisions.length,
    });
    return { rightsCases, skipped, retention };
  }

  // --- 3.5 retirements-reviewed ---------------------------------------
  // Evalúa a TODO el mundo profesional (no solo a quienes están en un
  // roster) y ANUNCIA las retiradas. Una retirada anunciada NO retira al
  // jugador antes de su fecha efectiva.
  function reviewRetirements(params) {
    const {
      annualCycleRegistry, academyRegistry, cycle, teams, playerRegistry, contractRegistry, date, config, careerSeed,
    } = params;
    requirePhase(cycle, 'rights-and-retention-open');
    const iso = toIso(date);
    const classification = WorldLifecycle().classifyWorld({
      playerRegistry, teams, annualCycleRegistry, academyRegistry,
    }, iso);
    const announcements = [];
    // Orden CANÓNICO por playerId — nunca el orden del registro.
    [...playerRegistry.all()].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((player) => {
      const category = (classification.byPlayerId.get(player.id) || {}).category;
      if (category === 'retired' || category === 'left-professional-pathway' || category === 'academy') return;
      const currentContract = contractRegistry.currentForPlayer(player.id, iso);
      const intent = RetirementSvc().evaluateRetirementIntent({
        annualCycleRegistry, player, config, date: iso, careerSeed, currentContract,
      });
      if (!intent.willAnnounce) return;
      const announcement = RetirementSvc().announceRetirement({
        annualCycleRegistry,
        cycle,
        player,
        clubId: player.teamId || null,
        date: iso,
        currentContract,
        reasons: intent.reasons,
        forced: intent.forced,
      });
      announcements.push(announcement);
    });
    enterPhase(cycle, 'retirements-reviewed', iso, { announcements: announcements.length });
    return { announcements };
  }

  // --- 3.6 renewals-and-free-agency -----------------------------------
  // (a) EXPIRACIONES orgánicas ya vencidas (prioridad 3 de la tabla);
  // (b) RETIRADAS efectivas (prioridad 4);
  // (c) primera ronda de agencia libre.
  function runRenewalsAndFreeAgency(params) {
    const { cycle, date } = params;
    requirePhase(cycle, 'retirements-reviewed');
    const iso = toIso(date);
    const expiry = processDueExpirations({ ...params, date: iso });
    const retirements = processDueRetirements({ ...params, date: iso });
    const clearing = runClearingRound({ ...params, roundIndex: 1, date: iso, includeFreeAgency: true });
    enterPhase(cycle, 'renewals-and-free-agency', iso, {
      expirations: expiry.records.length,
      blockedExpirations: expiry.blocked.length,
      retirements: retirements.records.length,
      clearingDecisions: clearing.decisions.length,
    });
    return { expiry, retirements, clearing };
  }

  // --- 3.7 academy-decisions ------------------------------------------
  // Intake anual SOLO por vacantes + decisión anual por joven (continuar,
  // promocionar, liberar, abandonar la vía profesional).
  function runAcademyDecisions(params) {
    const {
      annualCycleRegistry, academyRegistry, cycle, teams, playerRegistry, contractRegistry, registrationRegistry,
      date, targetSeasonKey, config, careerSeed, userClubId, lineup, calibration,
    } = params;
    requirePhase(cycle, 'renewals-and-free-agency');
    const iso = toIso(date);
    const intakes = [];
    const decisions = [];
    const promotions = [];
    [...(teams || [])].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((team) => {
      // (1) Decisión anual del pool ACTUAL, antes del intake nuevo.
      const pool = academyRegistry.activePoolForClub(team.id, iso);
      const qualityIndex = AcademySvc().buildPoolQualityIndex(pool, playerRegistry, config);
      [...pool].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((membership) => {
        const decision = AcademySvc().decideForMembership({
          academyRegistry,
          playerRegistry,
          membership,
          team,
          date: iso,
          config,
          careerSeed,
          cycle,
          poolQualityIndex: qualityIndex[membership.id],
        });
        decisions.push(decision);
        // El club del USUARIO recibe la decisión como TAREA, nunca se
        // aplica sin su consentimiento explícito.
        if (team.id === userClubId) {
          const clubCase = annualCycleRegistry.clubCaseFor(cycle.id, team.id);
          if (clubCase) {
            clubCase.requiredDecisions.push({
              id: `academy-decision:${membership.id}`,
              type: 'academy-decision',
              playerId: membership.playerId,
              dueDate: iso,
              proposedOutcome: decision.outcome,
              reasons: decision.reasons,
            });
          }
          return;
        }
        if (decision.outcome === 'continue') {
          AcademySvc().applyContinue(membership, iso);
        } else if (decision.outcome === 'release') {
          AcademySvc().applyRelease({ membership, date: iso });
        } else if (decision.outcome === 'left-professional-pathway') {
          AcademySvc().applyLeftPathway({
            membership, date: iso, annualCycleRegistry, cycle, reasons: decision.reasons,
          });
        } else if (decision.outcome === 'promote') {
          try {
            const promoted = AcademySvc().promoteToFirstTeam({
              academyRegistry,
              playerRegistry,
              contractRegistry,
              registrationRegistry,
              teams,
              membership,
              team,
              date: iso,
              seasonKey: targetSeasonKey,
              config,
              calibration,
              lineup,
            });
            promotions.push({ playerId: membership.playerId, clubId: team.id, contractId: promoted.contract ? promoted.contract.id : null });
          } catch (err) {
            // Una promoción que no cabe (cupo/contrato) no rompe el ciclo:
            // el joven CONTINÚA en academia con diagnóstico explícito.
            membership.addEvent({
              id: `${membership.id}:blocked:${membership.events.length}`,
              type: 'blocked',
              date: iso,
              data: { message: err.message },
            });
            AcademySvc().applyContinue(membership, iso);
          }
        }
      });

      // (2) Intake nuevo, SOLO por vacantes reales.
      const intake = AcademySvc().runAnnualIntake({
        academyRegistry,
        playerRegistry,
        team,
        cycle,
        date: iso,
        seasonKey: targetSeasonKey,
        config,
        careerSeed,
        annualCycleRegistry,
        retirementService: RetirementSvc(),
      });
      intakes.push(intake);
    });
    enterPhase(cycle, 'academy-decisions', iso, {
      decisions: decisions.length,
      promotions: promotions.length,
      intake: intakes.reduce((sum, entry) => sum + entry.created.length, 0),
    });
    return { intakes, decisions, promotions };
  }

  // --- 3.8 clearing-rounds --------------------------------------------
  // Rondas restantes de agencia libre + saneamiento anual de la población.
  function runClearingRounds(params) {
    const { cycle, date } = params;
    requirePhase(cycle, 'academy-decisions');
    const iso = toIso(date);
    const rounds = [];
    for (let roundIndex = 2; roundIndex < CC().CPU_PLANNING.clearingRounds + 2; roundIndex += 1) {
      rounds.push(runClearingRound({ ...params, roundIndex, date: iso, includeFreeAgency: true }));
    }
    const population = balanceFreeAgentPopulation({ ...params, date: iso });
    enterPhase(cycle, 'clearing-rounds', iso, {
      rounds: rounds.length,
      committed: rounds.reduce((sum, entry) => sum + entry.round.committedTransactionIds.length, 0),
      pruned: population.pruned.length,
    });
    return { rounds, population };
  }

  // --- 3.9 roster-legality-audit --------------------------------------
  function runRosterLegalityAudit(params) {
    const {
      annualCycleRegistry, cycle, teams, date, targetSeasonKey, userClubId, delegateEmergencyForUserClub,
    } = params;
    requirePhase(cycle, 'clearing-rounds');
    const iso = toIso(date);
    // Auditoría PROYECTADA (`projectRegistrations: true`): esta fase corre
    // ANTES de `licenses-and-registrations`, así que ningún jugador tiene
    // todavía inscripción del curso nuevo. Sin proyección los 36 clubes
    // parecerían ilegales por un alta administrativa que el propio verano va
    // a emitir después, y la escalera de emergencia se dispararía sobre una
    // carencia inexistente. La auditoría ESTRICTA es la de `preseason-ready`.
    const result = auditAllClubs({
      ...params, date: iso, seasonKey: targetSeasonKey, projectRegistrations: true,
    });
    enterPhase(cycle, 'roster-legality-audit', iso, {
      audited: result.reports.length,
      illegal: result.reports.filter((report) => !report.isLegal).length,
      emergencyActions: result.emergencyActions.length,
      projected: result.reports.reduce((sum, report) => sum + ((report.counts && report.counts.projectedRegistrations) || 0), 0),
    });
    void teams;
    void userClubId;
    void delegateEmergencyForUserClub;
    void annualCycleRegistry;
    return result;
  }

  // Auditoría (+ escalera de emergencia) reutilizable también FUERA de la
  // fase: la capa de orquestación puede llamarla antes del primer partido
  // de una carrera nueva (invariante 26: los 36 clubes pueden construir una
  // convocatoria legal antes del primer partido).
  function auditAllClubs(params) {
    const {
      annualCycleRegistry, academyRegistry, cycle, teams, playerRegistry, contractRegistry, registrationRegistry,
      loanRegistry, date, seasonKey, config, careerSeed, userClubId, delegateEmergencyForUserClub, lineup, calibration,
      classificationCache, retirementService, projectRegistrations,
    } = params;
    const iso = toIso(date);
    const reports = [];
    const emergencyActions = [];
    const notReady = [];
    [...(teams || [])].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((team) => {
      let report = LegalitySvc().buildReport({
        team,
        seasonKey,
        date: iso,
        phaseId: 'league',
        cycleId: cycle ? cycle.id : null,
        config,
        playerRegistry,
        contractRegistry,
        registrationRegistry,
        loanRegistry,
        teams,
        classificationCache,
        projectRegistrations: projectRegistrations === true,
      });
      annualCycleRegistry.registerLegalityReport(report);

      if (!report.isLegal) {
        // El club del USUARIO solo recibe medidas de emergencia si el
        // usuario las DELEGA explícitamente (sección 15/17 del prompt).
        const mayApply = team.id !== userClubId || delegateEmergencyForUserClub === true;
        if (mayApply) {
          const ladder = LegalitySvc().applyEmergencyLadder({
            report,
            team,
            deps: {
              academyRegistry,
              playerRegistry,
              contractRegistry,
              registrationRegistry,
              annualCycleRegistry,
              teams,
              lineup,
              calibration,
              retirementService: retirementService || RetirementSvc(),
            },
            date: iso,
            seasonKey,
            config,
            cycle,
            careerSeed,
            delegatedByUser: team.id === userClubId,
          });
          ladder.actions.forEach((action) => {
            annualCycleRegistry.registerEmergencyAction(action);
            emergencyActions.push(action);
            report.appliedActionIds.push(action.id);
          });
          if (ladder.actions.length) {
            // Se REAUDITA tras la emergencia — nunca se declara legal por
            // haber "hecho algo".
            report = LegalitySvc().buildReport({
              team,
              seasonKey,
              date: iso,
              phaseId: 'league',
              cycleId: cycle ? cycle.id : null,
              config,
              playerRegistry,
              contractRegistry,
              registrationRegistry,
              loanRegistry,
              teams,
              classificationCache,
              projectRegistrations: projectRegistrations === true,
            });
            annualCycleRegistry.registerLegalityReport(report);
          }
        }
      }
      reports.push(report);

      const clubCase = cycle ? annualCycleRegistry.clubCaseFor(cycle.id, team.id) : null;
      if (clubCase) {
        clubCase.legalityReportIds.push(report.id);
        clubCase.addEvent({
          id: `${clubCase.id}:audited:${clubCase.events.length}`,
          type: 'legality-audited',
          date: iso,
          data: { reportId: report.id, isLegal: report.isLegal },
        });
        if (emergencyActions.some((action) => action.clubId === team.id)) {
          clubCase.addEvent({
            id: `${clubCase.id}:emergency:${clubCase.events.length}`, type: 'emergency-applied', date: iso,
          });
        }
        if (report.isLegal) {
          clubCase.addEvent({ id: `${clubCase.id}:ready:${clubCase.events.length}`, type: 'ready', date: iso });
        } else {
          clubCase.blockingDiagnostics.push(...report.gaps.filter((gap) => gap.severity === 'blocking'));
          clubCase.addEvent({
            id: `${clubCase.id}:not-ready:${clubCase.events.length}`,
            type: 'not-ready',
            date: iso,
            data: { gaps: report.gaps.filter((gap) => gap.severity === 'blocking').map((gap) => gap.code) },
          });
          notReady.push({
            clubId: team.id, reportId: report.id, gaps: report.gaps, counts: report.counts, warnings: report.warnings,
          });
        }
      }
    });
    return { reports, emergencyActions, notReady };
  }

  // --- 3.10 licenses-and-registrations --------------------------------
  // Las licencias/inscripciones del NUEVO curso se crean DESPUÉS del ciclo
  // contractual (corrección de REG-1: ya no inmediatamente al aplicar
  // ascensos/descensos). Las de la temporada que termina EXPIRAN por
  // evento, recorriendo el REGISTRO por ámbito (BUG-REG1-01), nunca
  // `Team.roster`.
  function runLicensesAndRegistrations(params) {
    const {
      annualCycleRegistry, cycle, teams, registrationRegistry, contractRegistry, date, targetSeasonKey, config,
    } = params;
    requirePhase(cycle, 'roster-legality-audit');
    const iso = toIso(date);

    // (a) Expiración por ÁMBITO de la temporada que termina.
    const oldScopeIds = new Set();
    cycle.competitionMembershipSnapshot.forEach((row) => {
      const resolved = RegSvc().resolveRegistrationRules({
        competitionId: row.competitionId, seasonKey: cycle.fromSeasonKey, date: iso, phaseId: 'league', operation: 'bootstrap',
      });
      oldScopeIds.add(resolved.registrationScopeId);
    });
    let expiredRegistrations = 0;
    oldScopeIds.forEach((scopeId) => {
      registrationRegistry.registrationsForScope(scopeId)
        .filter((registration) => registration.seasonKey === cycle.fromSeasonKey && registration.statusOn(iso) === 'active')
        .forEach((registration) => {
          RegSvc().advanceRegistrationEvent(registration, 'expired', iso);
          expiredRegistrations += 1;
        });
    });
    let expiredLicenses = 0;
    registrationRegistry.allLicenses()
      .filter((license) => license.seasonKey === cycle.fromSeasonKey && license.statusOn(iso) === 'active')
      .forEach((license) => {
        RegSvc().advanceLicenseEvent(license, 'expired', iso);
        expiredLicenses += 1;
      });

    // (b) Alta del NUEVO ámbito/temporada, con la plantilla ya definitiva.
    const { warnings } = RegistrationSeeder().seedRegistrationsForTeams({
      teams: [...(teams || [])].sort((a, b) => (a.id < b.id ? -1 : 1)),
      seasonKey: targetSeasonKey,
      date: iso,
      registrationRegistry,
      contractRegistry,
      config,
    });

    enterPhase(cycle, 'licenses-and-registrations', iso, {
      expiredRegistrations, expiredLicenses, warnings: warnings.length,
    });
    void annualCycleRegistry;
    return { expiredRegistrations, expiredLicenses, warnings };
  }

  // --- 3.11 preseason-ready -------------------------------------------
  // Segunda auditoría (ya con licencias/inscripciones del curso nuevo): NO
  // se puede declarar el verano listo con un club `not-ready`.
  function markPreseasonReady(params) {
    const { annualCycleRegistry, cycle, date, targetSeasonKey } = params;
    requirePhase(cycle, 'licenses-and-registrations');
    const iso = toIso(date);
    // Auditoría ESTRICTA (sin proyección de inscripciones): a esta altura
    // del verano las licencias/inscripciones del curso nuevo YA están
    // emitidas, así que el club se juzga por lo que puede hacer HOY.
    const audit = auditAllClubs({
      ...params, date: iso, seasonKey: targetSeasonKey, projectRegistrations: false,
    });
    if (audit.notReady.length) {
      cycle.addEvent({
        id: `${cycle.id}:blocked:${cycle.events.length}`,
        type: 'cycle-blocked',
        date: iso,
        data: { notReady: audit.notReady.map((entry) => entry.clubId) },
      });
      return { ready: false, audit };
    }
    enterPhase(cycle, 'preseason-ready', iso, { clubs: audit.reports.length });
    void annualCycleRegistry;
    return { ready: true, audit };
  }

  // --- 3.12 new-season-started ----------------------------------------
  function startNewSeason(params) {
    const { cycle, date } = params;
    const current = cycle.currentPhase();
    if (current !== 'preseason-ready') {
      throw new Error(
        `AnnualCycleService.startNewSeason: el ciclo "${cycle.id}" está en "${current}" — no se puede empezar `
        + 'temporada sin haber alcanzado "preseason-ready" (ningún club puede quedar not-ready).',
      );
    }
    const iso = toIso(date);
    enterPhase(cycle, 'new-season-started', iso, {});
    return { cycle };
  }

  // =====================================================================
  // 4. Pasos reutilizables del reloj (prioridades 1-8 de la sección 8)
  // =====================================================================
  function processDueExpirations(params) {
    const {
      annualCycleRegistry, cycle, teams, playerRegistry, contractRegistry, registrationRegistry, marketRegistry,
      loanRegistry, transferRegistry, date, targetSeasonKey, lineup,
    } = params;
    return ExpirySvc().processDueExpirationsToDate({
      contractRegistry,
      registrationRegistry,
      playerRegistry,
      marketRegistry,
      loanRegistry,
      transferRegistry,
      annualCycleRegistry,
      teams,
      cycle,
      seasonKey: targetSeasonKey,
      lineup,
      date: toIso(date),
    });
  }

  function processDueRetirements(params) {
    const {
      annualCycleRegistry, academyRegistry, cycle, teams, playerRegistry, contractRegistry, registrationRegistry,
      marketRegistry, loanRegistry, date, targetSeasonKey, lineup,
    } = params;
    const iso = toIso(date);
    const records = [];
    const blocked = [];
    // Orden canónico por id de anuncio.
    annualCycleRegistry.allRetirementAnnouncements()
      .filter((announcement) => announcement.currentStatus() === 'announced' || announcement.currentStatus() === 'blocked')
      .filter((announcement) => !LD().isAfter(announcement.effectiveDate, iso))
      .forEach((announcement) => {
        const result = RetirementSvc().commitRetirement({
          annualCycleRegistry,
          academyRegistry,
          playerRegistry,
          contractRegistry,
          registrationRegistry,
          marketRegistry,
          loanRegistry,
          teams,
          announcement,
          date: iso,
          seasonKey: targetSeasonKey,
          lineup,
          cycleId: cycle ? cycle.id : null,
        });
        if (result.record) records.push(result.record);
        else if (result.blocked) blocked.push(result.diagnostic);
      });
    return { records, blocked };
  }

  // Una RONDA completa: snapshot nuevo -> planes puros -> propuestas ->
  // clearinghouse. `includeFreeAgency: false` limita las propuestas a
  // retención (renovaciones/cantera), para la fase previa a las
  // expiraciones.
  function runClearingRound(params) {
    const {
      annualCycleRegistry, academyRegistry, cycle, teams, playerRegistry, contractRegistry, registrationRegistry,
      marketRegistry, agentRegistry, transferRegistry, loanRegistry, date, targetSeasonKey, config, careerSeed,
      userClubId, lineup, calibration, operationalContext, roundIndex, includeFreeAgency, userProposals,
    } = params;
    const iso = toIso(date);
    const snapshot = Planner().buildSnapshot({
      teams,
      playerRegistry,
      contractRegistry,
      registrationRegistry,
      academyRegistry,
      annualCycleRegistry,
      loanRegistry,
      date: iso,
      seasonKey: targetSeasonKey,
      config,
      cycle,
    });
    const resolvedByCompetitionId = {};
    new Set(snapshot.clubs.map((club) => club.competitionId)).forEach((competitionId) => {
      resolvedByCompetitionId[competitionId] = RegSvc().resolveRegistrationRules({
        competitionId, seasonKey: targetSeasonKey, date: iso, phaseId: 'league', operation: 'bootstrap',
      });
    });
    const plans = Planner().buildAllPlans({
      snapshot, teams, cycle, roundIndex, marketRegistry, careerSeed, resolvedByCompetitionId,
    });
    plans.forEach((plan) => {
      annualCycleRegistry.registerPlan(plan);
      const clubCase = annualCycleRegistry.clubCaseFor(cycle.id, plan.clubId);
      if (clubCase) {
        clubCase.planIds.push(plan.id);
        clubCase.addEvent({
          id: `${clubCase.id}:plan:${roundIndex}`, type: 'plan-built', date: iso, data: { planId: plan.id },
        });
      }
    });
    let proposals = Planner().buildProposals({ plans, snapshot, careerSeed });
    if (!includeFreeAgency) {
      proposals = proposals.filter((proposal) => proposal.type !== 'free-agent-signing');
    }
    if (userProposals && userProposals.length) {
      proposals = proposals.concat(userProposals.map((proposal) => ({ ...proposal, submittedByUser: true })))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
    }
    const employmentResolvedByCompetitionId = {};
    [...(teams || [])].forEach((team) => {
      const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
      if (employmentResolvedByCompetitionId[competitionId]) return;
      employmentResolvedByCompetitionId[competitionId] = ContractSvc().resolveRulesForClub(team, {
        seasonKey: targetSeasonKey, date: iso, operation: 'signContract',
      });
    });
    return Clearinghouse().runRound({
      snapshot,
      proposals,
      deps: {
        annualCycleRegistry,
        academyRegistry,
        playerRegistry,
        contractRegistry,
        registrationRegistry,
        marketRegistry,
        agentRegistry,
        transferRegistry,
        teams,
        lineup,
        calibration,
        operationalContext,
      },
      cycle,
      roundIndex,
      date: iso,
      seasonKey: targetSeasonKey,
      careerSeed,
      config,
      userClubId,
      resolvedByCompetitionId: employmentResolvedByCompetitionId,
    });
  }

  // =====================================================================
  // 5. Equilibrio de población (sección 18 del prompt)
  // =====================================================================
  // Cuando SOBRAN agentes libres se decide de forma DETERMINISTA quién
  // sigue disponible y quién pasa a `left-professional-pathway` (edad,
  // calidad/tendencia visible y tiempo sin club). NUNCA se borra ninguna
  // instancia: el jugador sigue en `PlayerRegistry` con su histórico.
  function balanceFreeAgentPopulation(params) {
    const {
      annualCycleRegistry, academyRegistry, cycle, teams, playerRegistry, contractRegistry, date, config,
    } = params;
    const iso = toIso(date);
    const cfg = CC().POPULATION;
    const classification = WorldLifecycle().classifyWorld({
      playerRegistry, teams, annualCycleRegistry, academyRegistry,
    }, iso);
    const freeAgentIds = classification.byCategory['free-agent'];
    const pruned = [];
    if (freeAgentIds.length <= cfg.freeAgentHardMax) {
      return { total: freeAgentIds.length, hardMax: cfg.freeAgentHardMax, pruned };
    }
    // Orden de CONTINUIDAD: mejor calidad visible primero; a igualdad, más
    // joven; a igualdad, id (determinista y estable).
    const ranked = freeAgentIds
      .map((playerId) => {
        const player = playerRegistry.get(playerId);
        return {
          playerId,
          tmb: player ? PD().computeTmbRating(player, config) : 0,
          age: player ? (CareerAge().ageOnDate(player, iso) || 99) : 99,
        };
      })
      .sort((a, b) => (b.tmb - a.tmb) || (a.age - b.age) || (a.playerId < b.playerId ? -1 : 1));
    ranked.slice(cfg.freeAgentHardMax).forEach((row) => {
      const player = playerRegistry.get(row.playerId);
      if (!player) return;
      // Nunca se saca de la vía a quien tenga un contrato futuro válido.
      if (contractRegistry && contractRegistry.currentForPlayer(row.playerId, iso)) return;
      const record = new CycleEntities.ProfessionalPathwayExitRecord({
        id: `pathway-exit:${cycle.id}:${row.playerId}`,
        cycleId: cycle.id,
        playerId: row.playerId,
        effectiveDate: iso,
        reason: 'population-balance',
        reasons: ['Sin equipo y sin mercado real para su perfil: deja la vía profesional.'],
        lastClubId: null,
      });
      annualCycleRegistry.registerPathwayExit(record);
      pruned.push(record);
    });
    return {
      total: freeAgentIds.length, hardMax: cfg.freeAgentHardMax, target: cfg.freeAgentTarget, pruned,
    };
  }

  // =====================================================================
  // 6. Reloj del verano: siguiente parada y procesado por fechas
  // =====================================================================
  // Devuelve la SIGUIENTE fecha de parada real: la próxima fase pendiente o,
  // si vence antes, la próxima atención OBLIGATORIA del club del usuario.
  // Consulta PURA: no muta nada ni consume aleatoriedad.
  function nextStopDate(params) {
    const { annualCycleRegistry, cycle, userClubId, date } = params;
    const iso = toIso(date);
    const currentPhase = cycle.currentPhase();
    const phases = CC().CYCLE_PHASES;
    const nextPhaseId = phases[phases.indexOf(currentPhase) + 1];
    const phaseDate = nextPhaseId ? cycle.scheduledDateForPhase(nextPhaseId) : null;
    const attention = userClubId ? getUserAttention({ annualCycleRegistry, cycle, userClubId, date: iso }) : null;
    if (attention && phaseDate && LD().isBefore(attention.dueDate, phaseDate)) {
      return { date: attention.dueDate, reason: 'user-attention', attention, nextPhaseId };
    }
    if (attention && !phaseDate) {
      return { date: attention.dueDate, reason: 'user-attention', attention, nextPhaseId: null };
    }
    if (!phaseDate) return { date: null, reason: 'cycle-complete', nextPhaseId: null };
    return { date: phaseDate, reason: 'phase', nextPhaseId, attention };
  }

  // Atención OBLIGATORIA del club del usuario dentro del ciclo — bloquea
  // "Continuar" hasta que decida o deje caducar explícitamente.
  function getUserAttention(params) {
    const { annualCycleRegistry, cycle, userClubId, date } = params;
    const iso = toIso(date);
    const clubCase = annualCycleRegistry.clubCaseFor(cycle.id, userClubId);
    if (!clubCase) return null;
    const pending = clubCase.pendingRequiredDecisions()
      .sort((a, b) => (LD().compare(a.dueDate, b.dueDate)) || (a.id < b.id ? -1 : 1));
    if (!pending.length) return null;
    void iso;
    return pending[0];
  }

  // Procesa TODAS las fases cuya fecha programada ya se ha alcanzado, EN
  // ORDEN, deteniéndose si aparece una atención obligatoria del usuario o si
  // una fase bloquea. Es el punto que consume `advanceGameClockTo()`.
  function processDuePhasesToDate(params) {
    const { cycle, date, userClubId, annualCycleRegistry } = params;
    const iso = toIso(date);
    const executed = [];
    let guard = 0;
    while (guard < CC().CYCLE_PHASES.length + 2) {
      guard += 1;
      const currentPhase = cycle.currentPhase();
      if (currentPhase === 'new-season-started' || currentPhase === 'preseason-ready') break;
      const phases = CC().CYCLE_PHASES;
      const nextPhaseId = phases[phases.indexOf(currentPhase) + 1];
      if (!nextPhaseId || nextPhaseId === 'new-season-started') break;
      const phaseDate = cycle.scheduledDateForPhase(nextPhaseId);
      if (!phaseDate || LD().isAfter(phaseDate, iso)) break;
      // Una atención obligatoria del usuario que vence ANTES de la próxima
      // fase detiene el procesado (nunca se salta en silencio).
      if (userClubId) {
        const attention = getUserAttention({
          annualCycleRegistry, cycle, userClubId, date: phaseDate,
        });
        if (attention && !LD().isAfter(attention.dueDate, phaseDate)) {
          return { executed, stoppedByAttention: attention };
        }
      }
      const result = runPhase({ ...params, phaseId: nextPhaseId, date: phaseDate });
      executed.push({ phaseId: nextPhaseId, date: phaseDate, result });
      if (result && result.ready === false) return { executed, blockedAt: nextPhaseId };
    }
    return { executed, stoppedByAttention: null };
  }

  // Despachador ÚNICO de fase -> paso (nunca un `switch` repartido por la
  // interfaz).
  function runPhase(params) {
    const { phaseId } = params;
    if (phaseId === 'snapshot-frozen') return freezeSnapshot(params);
    if (phaseId === 'season-history-closed') return closeSeasonHistory(params);
    if (phaseId === 'loans-and-options-reviewed') return reviewLoansAndOptions(params);
    if (phaseId === 'rights-and-retention-open') return openRightsAndRetention(params);
    if (phaseId === 'retirements-reviewed') return reviewRetirements(params);
    if (phaseId === 'renewals-and-free-agency') return runRenewalsAndFreeAgency(params);
    if (phaseId === 'academy-decisions') return runAcademyDecisions(params);
    if (phaseId === 'clearing-rounds') return runClearingRounds(params);
    if (phaseId === 'roster-legality-audit') return runRosterLegalityAudit(params);
    if (phaseId === 'licenses-and-registrations') return runLicensesAndRegistrations(params);
    if (phaseId === 'preseason-ready') return markPreseasonReady(params);
    if (phaseId === 'new-season-started') return startNewSeason(params);
    throw new Error(`AnnualCycleService.runPhase: fase desconocida "${phaseId}".`);
  }

  // Vista para la interfaz — CONSULTA PURA (no muta, no consume azar).
  function describeCycleForUi(params) {
    const { annualCycleRegistry, cycle, userClubId, date } = params;
    const iso = toIso(date);
    const clubCase = userClubId ? annualCycleRegistry.clubCaseFor(cycle.id, userClubId) : null;
    const phases = CC().CYCLE_PHASES;
    const currentPhase = cycle.currentPhase();
    const nextPhaseId = phases[phases.indexOf(currentPhase) + 1] || null;
    return {
      cycleId: cycle.id,
      fromSeasonKey: cycle.fromSeasonKey,
      targetSeasonKey: cycle.targetSeasonKey,
      currentPhase,
      nextPhaseId,
      nextPhaseDate: nextPhaseId ? cycle.scheduledDateForPhase(nextPhaseId) : null,
      worldDate: iso,
      schedule: cycle.summerSchedule.map((row) => ({
        ...row, done: phases.indexOf(row.phaseId) <= phases.indexOf(currentPhase),
      })),
      clubStatus: clubCase ? clubCase.currentStatus() : null,
      clubLastOfficialMatchDate: userClubId ? cycle.lastOfficialMatchDateForClub(userClubId) : null,
      pendingDecisions: clubCase ? clubCase.pendingRequiredDecisions() : [],
      blockingDiagnostics: clubCase ? clubCase.blockingDiagnostics : [],
      openingPayrollReference: clubCase ? clubCase.openingPayrollReference : null,
      legalityReportId: clubCase && clubCase.legalityReportIds.length
        ? clubCase.legalityReportIds[clubCase.legalityReportIds.length - 1] : null,
    };
  }

  const exportsObj = {
    AnnualCycleService: {
      CYCLE_SOURCE_VERSION,
      paymentComplianceEvidence,
      openCycle,
      requirePhase,
      enterPhase,
      freezeSnapshot,
      closeSeasonHistory,
      reviewLoansAndOptions,
      openRightsAndRetention,
      reviewRetirements,
      runRenewalsAndFreeAgency,
      runAcademyDecisions,
      runClearingRounds,
      runRosterLegalityAudit,
      auditAllClubs,
      runLicensesAndRegistrations,
      markPreseasonReady,
      startNewSeason,
      processDueExpirations,
      processDueRetirements,
      runClearingRound,
      balanceFreeAgentPopulation,
      nextStopDate,
      getUserAttention,
      processDuePhasesToDate,
      runPhase,
      describeCycleForUi,
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
