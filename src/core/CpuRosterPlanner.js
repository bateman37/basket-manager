// src/core/CpuRosterPlanner.js
// CYCLE-1 (DESIGN.md 9.22, sección 15 del prompt) — FASE 1 de la
// planificación CPU: instantánea canónica del mundo y planes PUROS de los 36
// clubes. Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Reglas permanentes:
//  - PLANIFICAR ES PURO: este archivo NUNCA llama a
//    `ContractRegistry.register`, `ContractService.createContract`,
//    `Team.addPlayer/removePlayer`, `RosterMutationService`,
//    `RegistrationService`, `TransferExecutionService.commitTransaction` ni
//    `LoanService.returnLoan` (auditado estáticamente en
//    `scripts/test-cycle1.js`). Solo produce `ClubSquadPlan` inmutables y
//    PROPUESTAS (intenciones), nunca contratos ni movimientos;
//  - los 36 clubes planifican desde el MISMO snapshot congelado, ordenado
//    por ids estables: cambiar el orden del array de clubes o de jugadores
//    NO cambia el resultado;
//  - ninguna decisión usa `Math.random()`: todo sale de
//    `DeterministicRandom` con una huella estable;
//  - nada de Potencial/Ambición/Profesionalidad en las razones ni en la
//    salida visible (las razones son CUALITATIVAS);
//  - el presupuesto parte de la REFERENCIA DE NÓMINA DE APERTURA congelada
//    (sección 16), nunca del payroll ya vaciado por las expiraciones.
//
// Módulo puro: no lee DOM ni `state`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CareerAgeModule = isNode ? require('../utils/CareerAge.js') : global.BasketManager;
  const CanonicalHashModule = isNode ? require('../utils/CanonicalHash.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;
  const CycleEntities = isNode ? require('../entities/Cycle.js') : global.BasketManager;
  const PlayerCore = isNode ? require('../entities/Player.js') : global.BasketManager;
  const PlayerDevelopmentModule = isNode ? require('./PlayerDevelopment.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const MedicalModule = isNode ? require('./Medical.js') : global.BasketManager;
  const SquadEligibilityModule = isNode ? require('./SquadEligibilityService.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function CareerAge() { return CareerAgeModule.CareerAge; }
  function Hash() { return CanonicalHashModule.CanonicalHash; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }
  function CC() { return CycleConfigModule.CycleConfig; }
  function PD() { return PlayerDevelopmentModule; }
  function ContractSvc() { return ContractServiceModule.ContractService; }
  function Med() { return MedicalModule; }
  function SquadElig() { return SquadEligibilityModule.SquadEligibilityService; }

  const { POSITIONS } = PlayerCore;

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // =====================================================================
  // 1. Snapshot CANÓNICO del mundo
  // =====================================================================
  // Todo ordenado por ids estables; el fingerprint se calcula con
  // `CanonicalHash.stableHash` (serialización canónica RECURSIVA, no solo
  // del primer nivel — BUG-TRANSFER1-17). Barajar los arrays de entrada
  // produce EXACTAMENTE el mismo snapshot y el mismo fingerprint.
  function buildSnapshot(params) {
    const {
      teams, playerRegistry, contractRegistry, registrationRegistry, academyRegistry, annualCycleRegistry,
      loanRegistry, date, seasonKey, config, cycle,
    } = params;
    const iso = toIso(date);
    const clubs = [...(teams || [])]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((team) => {
        const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
        const clubCase = cycle && annualCycleRegistry ? annualCycleRegistry.clubCaseFor(cycle.id, team.id) : null;
        const roster = [...team.roster]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((player) => describePlayerForPlan({
            player, team, contractRegistry, registrationRegistry, loanRegistry, iso, seasonKey, config,
          }));
        const academyPool = academyRegistry
          ? academyRegistry.activePoolForClub(team.id, iso)
            .map((membership) => ({
              membershipId: membership.id,
              playerId: membership.playerId,
              tmb: (() => {
                const p = playerRegistry.get(membership.playerId);
                return p ? PD().computeTmbRating(p, config) : 0;
              })(),
              age: (() => {
                const p = playerRegistry.get(membership.playerId);
                return p ? CareerAge().ageOnDate(p, iso) : null;
              })(),
            }))
            .sort((a, b) => (a.playerId < b.playerId ? -1 : 1))
          : [];
        return {
          clubId: team.id,
          competitionId,
          division: team.division,
          sportingGoal: team.board ? team.board.sportingGoal : null,
          roster,
          academyPool,
          openingPayrollReferenceMinor: clubCase && clubCase.openingPayrollReference
            ? clubCase.openingPayrollReference.amountMinor : null,
          committedMinor: contractRegistry
            ? ContractSvc().guaranteedPayrollForClub(contractRegistry, team.id, seasonKey).amountMinor : 0,
        };
      });

    // Libres MUNDIALES (no retirados, no en academia, no fuera de la vía) —
    // ordenados por id, nunca por posición de array.
    const freeAgents = playerRegistry.all()
      .filter((player) => player.teamId === null)
      .filter((player) => !(annualCycleRegistry && annualCycleRegistry.isRetiredOn(player.id, iso)))
      .filter((player) => !(annualCycleRegistry && annualCycleRegistry.hasLeftProfessionalPathwayOn(player.id, iso)))
      .filter((player) => !(academyRegistry && academyRegistry.isInAcademyOn(player.id, iso)))
      .filter((player) => !(contractRegistry && contractRegistry.currentForPlayer(player.id, iso)))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((player) => ({
        playerId: player.id,
        nominalPosition: player.nominalPosition,
        tmb: PD().computeTmbRating(player, config),
        age: CareerAge().ageOnDate(player, iso),
        available: Med().peekAvailability(player, LD().toJsDate(iso), config, {}).status !== 'unavailable',
      }));

    const snapshot = {
      date: iso,
      seasonKey,
      cycleId: cycle ? cycle.id : null,
      clubs,
      freeAgents,
    };
    snapshot.fingerprint = Hash().stableHash(snapshot);
    // El snapshot es una FOTO inmutable: cualquier cambio del mundo exige
    // una foto nueva (y una ronda nueva del clearinghouse).
    return Object.freeze(snapshot);
  }

  // Descripción de un jugador para planificar — SOLO señales visibles o ya
  // modeladas. Nunca `hidden.potential`.
  function describePlayerForPlan(params) {
    const {
      player, team, contractRegistry, registrationRegistry, loanRegistry, iso, seasonKey, config,
    } = params;
    const contract = contractRegistry ? contractRegistry.currentForPlayer(player.id, iso) : null;
    const availability = Med().peekAvailability(player, LD().toJsDate(iso), config, { team });
    const loan = loanRegistry ? loanRegistry.activeAgreementForPlayer(player.id, iso) : null;
    return {
      playerId: player.id,
      nominalPosition: player.nominalPosition,
      tmb: PD().computeTmbRating(player, config),
      age: CareerAge().ageOnDate(player, iso),
      contractId: contract ? contract.id : null,
      contractEndDate: contract ? contract.endDate : null,
      contractCoversTargetSeason: contract ? contract.coveredSeasonKeys.includes(seasonKey) : false,
      seasonSalaryMinor: contract ? contract.breakdownForSeason(seasonKey).guaranteedTotalMinor : 0,
      availability: availability.status,
      onLoanIn: Boolean(loan && loan.borrowerClubId === team.id),
      onLoanOut: Boolean(loan && loan.ownerClubId === team.id && loan.borrowerClubId !== team.id),
      hasActiveRegistration: registrationRegistry
        ? Boolean(registrationRegistry.registrationsForPlayer(player.id).find((r) => r.teamId === team.id && r.statusOn(iso) === 'active'))
        : false,
    };
  }

  // =====================================================================
  // 2. Presupuesto interno del ciclo (NO salary cap)
  // =====================================================================
  // Se deriva de la REFERENCIA DE NÓMINA DE APERTURA congelada antes de las
  // expiraciones: así un club con muchos vencimientos conserva capacidad de
  // reposición coherente en vez de espiralar hacia cero.
  function computeCycleBudget(params) {
    const {
      clubSnapshot, team, marketRegistry, seasonKey,
    } = params;
    const cfg = CC().BUDGET;
    const financial = (team && team.reputation && team.reputation.financial !== undefined) ? team.reputation.financial : 50;
    const multiplier = cfg.openingPayrollMultiplierMin
      + (financial / 100) * (cfg.openingPayrollMultiplierMax - cfg.openingPayrollMultiplierMin);
    const base = Math.max(
      clubSnapshot.openingPayrollReferenceMinor !== null && clubSnapshot.openingPayrollReferenceMinor !== undefined
        ? clubSnapshot.openingPayrollReferenceMinor : 0,
      cfg.floorMinor,
    );
    const limitMinor = Math.round(base * multiplier);
    const reservedMinor = marketRegistry ? marketRegistry.reservedTotalForClubSeason(clubSnapshot.clubId, seasonKey) : 0;
    const committedMinor = clubSnapshot.committedMinor || 0;
    return {
      limitMinor,
      committedMinor,
      reservedMinor,
      availableMinor: Math.max(0, limitMinor - committedMinor - reservedMinor),
      currency: 'EUR',
      policyVersion: cfg.policyVersion,
      basedOn: 'frozen-opening-payroll-reference',
    };
  }

  // =====================================================================
  // 3. Plan PURO de un club
  // =====================================================================
  function buildPlanForClub(params) {
    const {
      snapshot, clubSnapshot, team, cycle, roundIndex, marketRegistry, careerSeed, resolvedRegistration,
    } = params;
    const cfg = CC().CPU_PLANNING;
    const seed = `${careerSeed || 'no-career-seed'}|plan|${cycle ? cycle.id : 'no-cycle'}|${clubSnapshot.clubId}|${roundIndex}`;
    const budget = computeCycleBudget({
      clubSnapshot, team, marketRegistry, seasonKey: snapshot.seasonKey,
    });

    // Profundidad por posición NOMINAL (solo jugadores que cubren la
    // temporada objetivo — un contrato que vence no da profundidad futura).
    const positionDepth = {};
    POSITIONS.forEach((pos) => { positionDepth[pos] = 0; });
    const continuing = clubSnapshot.roster.filter((row) => row.contractCoversTargetSeason && !row.onLoanOut);
    continuing.forEach((row) => {
      if (positionDepth[row.nominalPosition] !== undefined) positionDepth[row.nominalPosition] += 1;
    });

    const expiring = clubSnapshot.roster
      .filter((row) => row.contractId && !row.contractCoversTargetSeason)
      .sort((a, b) => (b.tmb - a.tmb) || (a.playerId < b.playerId ? -1 : 1));

    // Retener/renovar: los mejores por calidad VISIBLE que caben en el
    // presupuesto interno; liberar el resto. Desempate SIEMPRE por id.
    const renew = [];
    const release = [];
    let projectedMinor = budget.committedMinor;
    expiring.forEach((row) => {
      const expectedCostMinor = Math.max(row.seasonSalaryMinor, Math.round(row.tmb * 100000));
      const fitsBudget = (projectedMinor + expectedCostMinor) <= budget.limitMinor;
      const positionNeedsDepth = (positionDepth[row.nominalPosition] || 0) < cfg.targetDepthPerPosition;
      const qualityRoll = Rnd().unitFrom(seed, `renew|${row.playerId}`);
      // Señal cualitativa: los muy mayores con poca calidad relativa no se
      // renuevan aunque quepan (nunca por Potencial: por TMB y edad).
      const tooOld = row.age !== null && row.age >= 36 && row.tmb < 120;
      if (fitsBudget && !tooOld && (positionNeedsDepth || qualityRoll > 0.35)) {
        renew.push(row.playerId);
        projectedMinor += expectedCostMinor;
        if (positionDepth[row.nominalPosition] !== undefined) positionDepth[row.nominalPosition] += 1;
      } else {
        release.push(row.playerId);
      }
    });

    // Necesidades de fichaje: posiciones por debajo de la profundidad
    // objetivo, y tamaño mínimo de plantilla de la competición.
    //
    // TOPE de plantilla (CYCLE-1): el máximo de plantilla ACTIVA que declara
    // la propia competición (`activeRosterRange.max`, 12 en ACB/Primera
    // FEB), NUNCA un número global. Sin este tope la CPU seguía fichando
    // por "profundidad objetivo" ronda tras ronda: los rosters crecían a 20+
    // jugadores, agotaban el cupo acumulado de inscripciones de la temporada
    // (20 en ACB) y diluían el cupo de formación hasta hacer el acta
    // imposible.
    const squadRules = resolvedRegistration ? resolvedRegistration.squadRules : null;
    const activeRosterRange = (resolvedRegistration && resolvedRegistration.registration
      && resolvedRegistration.registration.activeRosterRange) || squadRules;
    const maxRosterSize = activeRosterRange ? activeRosterRange.max : null;
    const projectedSize = continuing.length + renew.length;
    const sizeGap = squadRules ? Math.max(0, squadRules.min - projectedSize) : 0;
    const roomForNewSignings = maxRosterSize === null ? Infinity : Math.max(0, maxRosterSize - projectedSize);
    const positionGaps = POSITIONS
      .filter((pos) => (positionDepth[pos] || 0) < cfg.targetDepthPerPosition)
      .map((pos) => ({ position: pos, missing: cfg.targetDepthPerPosition - (positionDepth[pos] || 0) }));

    // Cupos: cuántos de formación/no comunitarios se necesitan para que el
    // acta sea construible (la comprobación REAL la hace
    // `RosterLegalityService`; aquí solo se declara la necesidad).
    const quotaNeeds = {};
    if (resolvedRegistration) {
      const band = SquadElig().findQuotaBand(resolvedRegistration, Math.max(projectedSize, squadRules ? squadRules.min : 0));
      quotaNeeds.formationMinimum = band ? band.formationMinimum : 0;
      quotaNeeds.nonCommunityMax = (resolvedRegistration.registration && resolvedRegistration.registration.nonCommunityCap)
        ? resolvedRegistration.registration.nonCommunityCap.max : null;
    }

    // Candidatos a fichar: libres del snapshot que encajan en las
    // posiciones con hueco, orden canónico por id tras ordenar por calidad.
    const sign = [];
    const wanted = Math.min(
      cfg.maxProposalsPerClubPerRound,
      // El mínimo de acta manda SIEMPRE (aunque supere el tope, que nunca
      // puede ser menor que el mínimo por definición de la competición);
      // la profundidad objetivo solo se persigue mientras haya hueco real
      // por debajo del máximo de plantilla activa.
      Math.max(sizeGap, Math.min(roomForNewSignings, positionGaps.reduce((sum, gap) => sum + gap.missing, 0))),
    );
    if (wanted > 0) {
      const neededPositions = new Set(positionGaps.map((gap) => gap.position));
      const affordable = snapshot.freeAgents
        .filter((row) => row.available)
        .filter((row) => (neededPositions.size === 0 || neededPositions.has(row.nominalPosition)))
        .sort((a, b) => (b.tmb - a.tmb) || (a.playerId < b.playerId ? -1 : 1));
      affordable.slice(0, wanted).forEach((row) => sign.push(row.playerId));
      if (sign.length < wanted) {
        // Si no hay libres en las posiciones exactas, se amplía a cualquier
        // posición (la legalidad manda sobre la preferencia táctica).
        snapshot.freeAgents
          .filter((row) => row.available && !sign.includes(row.playerId))
          .sort((a, b) => (b.tmb - a.tmb) || (a.playerId < b.playerId ? -1 : 1))
          .slice(0, wanted - sign.length)
          .forEach((row) => sign.push(row.playerId));
      }
    }

    // Cantera: promocionar si hay hueco de plantilla y el pool tiene edad.
    // Nunca por encima del tope de plantilla activa de su competición.
    const promoteFromAcademy = [];
    if (sizeGap > sign.length && roomForNewSignings > sign.length) {
      [...clubSnapshot.academyPool]
        .sort((a, b) => (b.tmb - a.tmb) || (a.playerId < b.playerId ? -1 : 1))
        .slice(0, sizeGap - sign.length)
        .forEach((row) => promoteFromAcademy.push(row.playerId));
    }

    const medicalRisks = clubSnapshot.roster
      .filter((row) => row.availability === 'unavailable')
      .map((row) => row.playerId);
    const contractRisks = expiring.map((row) => row.playerId);

    const reasons = [];
    if (sizeGap > 0) reasons.push(`La plantilla proyectada (${projectedSize}) no alcanza el mínimo de su competición.`);
    if (positionGaps.length) reasons.push(`Faltan efectivos en: ${positionGaps.map((g) => g.position).join(', ')}.`);
    if (renew.length) reasons.push(`${renew.length} renovación(es) prioritaria(s) para sostener el bloque.`);
    if (release.length) reasons.push(`${release.length} salida(s) prevista(s) por fin de contrato.`);
    if (!reasons.length) reasons.push('Plantilla equilibrada: sin necesidades urgentes.');

    return new CycleEntities.ClubSquadPlan({
      id: `plan:${cycle ? cycle.id : 'no-cycle'}:${clubSnapshot.clubId}:r${roundIndex}`,
      cycleId: cycle ? cycle.id : 'no-cycle',
      clubId: clubSnapshot.clubId,
      roundIndex,
      builtAt: snapshot.date,
      seasonKey: snapshot.seasonKey,
      targetCompetitionId: clubSnapshot.competitionId,
      positionDepth,
      targetDepthPerPosition: cfg.targetDepthPerPosition,
      retain: continuing.map((row) => row.playerId),
      renew,
      release,
      loanOut: [],
      listenToOffers: [],
      sign,
      promoteFromAcademy,
      quotaNeeds: { ...quotaNeeds, maxRosterSize, roomForNewSignings: Number.isFinite(roomForNewSignings) ? roomForNewSignings : null },
      medicalRisks,
      contractRisks,
      currentCostMinor: budget.committedMinor,
      futureCostMinor: projectedMinor,
      budgetLimitMinor: budget.limitMinor,
      budgetReservedMinor: budget.reservedMinor,
      budgetAvailableMinor: budget.availableMinor,
      currency: budget.currency,
      registrationsConsumed: 0,
      registrationsPlanned: sign.length + promoteFromAcademy.length,
      sportingGoal: clubSnapshot.sportingGoal,
      reasons,
      snapshotFingerprint: snapshot.fingerprint,
      plannerVersion: cfg.plannerVersion,
      seed,
      provenance: { dataSource: 'simulated-cpu-plan-v1', isReal: false, generatorVersion: cfg.plannerVersion },
    });
  }

  // Planes de TODOS los clubes desde el MISMO snapshot, ordenados por id.
  function buildAllPlans(params) {
    const {
      snapshot, teams, cycle, roundIndex, marketRegistry, careerSeed, resolvedByCompetitionId,
    } = params;
    const teamsById = new Map((teams || []).map((team) => [team.id, team]));
    return snapshot.clubs.map((clubSnapshot) => buildPlanForClub({
      snapshot,
      clubSnapshot,
      team: teamsById.get(clubSnapshot.clubId),
      cycle,
      roundIndex,
      marketRegistry,
      careerSeed,
      resolvedRegistration: resolvedByCompetitionId ? resolvedByCompetitionId[clubSnapshot.competitionId] : null,
    }));
  }

  // =====================================================================
  // 4. Propuestas (INTENCIONES, nunca contratos ni movimientos)
  // =====================================================================
  // El clearinghouse (fase 2) las agrupa por jugador y las resuelve. Aquí
  // solo se declaran, con id canónico y orden estable.
  function buildProposals(params) {
    const { plans, snapshot, careerSeed } = params;
    const proposals = [];
    [...plans].sort((a, b) => (a.clubId < b.clubId ? -1 : 1)).forEach((plan) => {
      plan.renew.forEach((playerId) => {
        proposals.push({
          id: `proposal:renewal:${plan.id}:${playerId}`,
          type: 'renewal',
          clubId: plan.clubId,
          playerId,
          planId: plan.id,
          roundIndex: plan.roundIndex,
          budgetAvailableMinor: plan.budgetAvailableMinor,
          budgetLimitMinor: plan.budgetLimitMinor,
          seed: `${careerSeed || 'no-career-seed'}|proposal|renewal|${plan.clubId}|${playerId}|${plan.roundIndex}`,
        });
      });
      plan.sign.forEach((playerId) => {
        const row = snapshot.freeAgents.find((entry) => entry.playerId === playerId);
        proposals.push({
          id: `proposal:free-agent:${plan.id}:${playerId}`,
          type: 'free-agent-signing',
          clubId: plan.clubId,
          playerId,
          planId: plan.id,
          roundIndex: plan.roundIndex,
          budgetAvailableMinor: plan.budgetAvailableMinor,
          budgetLimitMinor: plan.budgetLimitMinor,
          targetTmb: row ? row.tmb : null,
          seed: `${careerSeed || 'no-career-seed'}|proposal|free-agent|${plan.clubId}|${playerId}|${plan.roundIndex}`,
        });
      });
      plan.promoteFromAcademy.forEach((playerId) => {
        proposals.push({
          id: `proposal:academy-promotion:${plan.id}:${playerId}`,
          type: 'academy-promotion',
          clubId: plan.clubId,
          playerId,
          planId: plan.id,
          roundIndex: plan.roundIndex,
          budgetAvailableMinor: plan.budgetAvailableMinor,
          budgetLimitMinor: plan.budgetLimitMinor,
          seed: `${careerSeed || 'no-career-seed'}|proposal|academy|${plan.clubId}|${playerId}|${plan.roundIndex}`,
        });
      });
    });
    // Orden CANÓNICO final por id de propuesta — nunca por posición del
    // array de clubes ni por orden de generación.
    return proposals.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  const exportsObj = {
    CpuRosterPlanner: {
      buildSnapshot,
      describePlayerForPlan,
      computeCycleBudget,
      buildPlanForClub,
      buildAllPlans,
      buildProposals,
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
