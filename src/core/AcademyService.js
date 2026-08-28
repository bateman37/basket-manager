// src/core/AcademyService.js
// CYCLE-1 (DESIGN.md 9.22, sección 13 del prompt) — academia real: intake
// anual por vacantes, decisión anual por joven y promoción ATÓMICA al primer
// equipo. Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Sustituye el placeholder de DESIGN.md 6.2.3 (`generateAcademyIntake(3)`
// directo al roster senior). Reglas permanentes:
//  - entrar en academia NO concede contrato, licencia, inscripción ni plaza
//    en `Team.roster` (`player.teamId === null` mientras solo esté aquí);
//  - solo una promoción EXPLÍCITA y válida crea contrato profesional y
//    afilia al joven, y lo hace por los servicios canónicos
//    (`ContractSeeder`/`ContractService` + `RosterMutationService` + REG-1);
//  - estar en academia NUNCA marca `formationQualifies`: se registran
//    periodos formativos REALES simulados y
//    `RegulatoryClassificationService` decide después contra el ruleset de
//    cada competición/temporada;
//  - la configuración (3 altas/año, pool de 8, 16-19 de entrada, 20 de
//    age-out) es CALIBRACIÓN DE SIMULACIÓN (`CycleConfig.ACADEMY`), no
//    reglamento; una competición futura puede aportar otra sin tocar
//    `Team.js`.
//
// Hooks explícitos DELIBERADAMENTE no implementados (sección 13): sin
// competiciones juveniles, sin staff de cantera, sin captación
// internacional, sin mapas reales de escuelas y sin fórmula cerrada de
// "ADN de club".
//
// Módulo puro: no lee DOM ni `state`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CareerAgeModule = isNode ? require('../utils/CareerAge.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;
  const CycleEntities = isNode ? require('../entities/Cycle.js') : global.BasketManager;
  const CycleTransactionModule = isNode ? require('./CycleTransaction.js') : global.BasketManager;
  const PlayerGeneratorModule = isNode ? require('../utils/playerGenerator.js') : global.BasketManager;
  const PlayerDevelopmentModule = isNode ? require('./PlayerDevelopment.js') : global.BasketManager;
  const WorldLifecycleModule = isNode ? require('./WorldLifecycleService.js') : global.BasketManager;
  const RosterMutationModule = isNode ? require('./RosterMutationService.js') : global.BasketManager;
  const ContractSeederModule = isNode ? require('./ContractSeeder.js') : global.BasketManager;
  const RegistrationSeederModule = isNode ? require('./RegistrationSeeder.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function CareerAge() { return CareerAgeModule.CareerAge; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }
  function CC() { return CycleConfigModule.CycleConfig; }
  function Tx() { return CycleTransactionModule.CycleTransaction; }
  function PG() { return PlayerGeneratorModule; }
  function PD() { return PlayerDevelopmentModule; }
  function WorldLifecycle() { return WorldLifecycleModule.WorldLifecycleService; }
  function RosterSvc() { return RosterMutationModule.RosterMutationService; }
  function ContractSeeder() { return ContractSeederModule.ContractSeeder; }
  function RegistrationSeeder() { return RegistrationSeederModule.RegistrationSeeder; }

  const ACADEMY_DATA_SOURCE = 'simulated-academy-intake-v1';
  const ACADEMY_GENERATOR_VERSION = 'academy-service-v1';

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // =====================================================================
  // 1. Intake anual — SOLO por vacantes reales
  // =====================================================================
  // No son tres obligatorios: si el pool ya está lleno (8), no entra nadie.
  // El joven se crea con semilla e id ESTABLES y con la edad EXACTA que le
  // corresponde en la fecha civil de incorporación (BUG-CYCLE1-02).
  function runAnnualIntake(params) {
    const {
      academyRegistry, playerRegistry, team, cycle, date, seasonKey, config, careerSeed,
      annualCycleRegistry, retirementService,
    } = params;
    const iso = toIso(date);
    const cfg = CC().ACADEMY;
    const currentPool = academyRegistry.activePoolForClub(team.id, iso);
    const vacancies = Math.max(0, cfg.poolMaxPerClub - currentPool.length);
    const intakeCount = Math.min(cfg.annualIntakeMaxPerClub, vacancies);
    const created = [];
    for (let index = 0; index < intakeCount; index += 1) {
      const seed = `${careerSeed || 'no-career-seed'}|academy-intake|${team.id}|${seasonKey}|${index}|${ACADEMY_GENERATOR_VERSION}`;
      const playerId = `academy:${team.id}:${seasonKey}:${index}`;
      if (playerRegistry.has(playerId)) continue; // idempotente
      const player = PG().generateFictionalPlayer({
        minAge: cfg.intakeAgeMin,
        maxAge: cfg.intakeAgeMax,
        referenceDate: iso,
        seed,
        id: playerId,
      });
      // Un joven de academia NO tiene club: `teamId` sigue `null` hasta una
      // promoción real (la pertenencia la lleva `AcademyMembership`).
      player.teamId = null;
      player.dataSource = ACADEMY_DATA_SOURCE;
      playerRegistry.register(player);
      WorldLifecycle().initializePlayerLifecycle(player, config, iso, {
        seasonKey,
        historyCompleteness: 'complete',
        annualCycleRegistry,
        retirementService,
        careerSeed,
      });
      const membership = new CycleEntities.AcademyMembership({
        id: `academy-membership:${team.id}:${player.id}`,
        playerId: player.id,
        clubId: team.id,
        joinedAt: iso,
        cohortSeasonKey: seasonKey,
        origin: ACADEMY_DATA_SOURCE,
        developmentContext: {
          academyFacilityLevel: (team.facilities && team.facilities.academy) ? team.facilities.academy.level : null,
          // Hooks futuros DECLARADOS y no implementados (sección 13).
          notImplemented: ['youthCompetitions', 'academyStaff', 'internationalScoutingNetwork', 'clubDnaBias'],
        },
        formationPeriods: [{
          fromDate: iso,
          toDate: null,
          clubId: team.id,
          federationId: 'feb-general',
          provenance: 'simulated-academy-period',
        }],
        provenance: {
          dataSource: ACADEMY_DATA_SOURCE, isReal: false, generatorVersion: ACADEMY_GENERATOR_VERSION, seedFingerprint: seed,
        },
      });
      academyRegistry.registerMembership(membership);
      membership.addEvent({ id: `${membership.id}:joined`, type: 'joined', date: iso, actor: team.id });
      created.push({ player, membership });
    }
    return {
      clubId: team.id,
      cycleId: cycle ? cycle.id : null,
      poolBefore: currentPool.length,
      vacancies,
      created,
      poolAfter: academyRegistry.activePoolForClub(team.id, iso).length,
    };
  }

  // =====================================================================
  // 2. Decisión anual por joven
  // =====================================================================
  // continuar | promocionar | liberar a agente libre | abandonar la vía
  // profesional. El age-out se evalúa en la fecha civil común configurada
  // del ciclo (la de la fase `academy-decisions`).
  function decideForMembership(params) {
    const {
      academyRegistry, playerRegistry, membership, team, date, config, careerSeed, cycle, poolQualityIndex,
    } = params;
    const iso = toIso(date);
    const cfg = CC().ACADEMY;
    const player = playerRegistry.require(membership.playerId);
    const age = CareerAge().ageOnDate(player, iso);
    const agedOut = age !== null && age > cfg.maxAgeInclusive;
    const quality = poolQualityIndex !== undefined && poolQualityIndex !== null
      ? poolQualityIndex : 0.5;
    const reasons = [];

    let outcome;
    if (!agedOut && quality >= cfg.promotionQualityPercentile) {
      outcome = 'promote';
      reasons.push('Su progresión destaca claramente dentro de la cantera del club.');
    } else if (!agedOut) {
      outcome = 'continue';
      reasons.push('Sigue formándose en la cantera un curso más.');
    } else if (quality >= cfg.promotionQualityPercentile) {
      outcome = 'promote';
      reasons.push('Cumple la edad máxima de cantera y el club apuesta por él.');
    } else if (quality >= cfg.leavePathwayQualityPercentile) {
      outcome = 'release';
      reasons.push('Cumple la edad máxima de cantera y sale a buscar equipo.');
    } else {
      outcome = 'left-professional-pathway';
      reasons.push('Cumple la edad máxima de cantera sin nivel para seguir la vía profesional.');
    }

    const decision = new CycleEntities.AcademyDecision({
      id: `academy-decision:${cycle ? cycle.id : 'no-cycle'}:${membership.id}`,
      cycleId: cycle ? cycle.id : 'no-cycle',
      membershipId: membership.id,
      playerId: player.id,
      clubId: membership.clubId,
      outcome,
      decidedAt: iso,
      decidedBy: 'cpu',
      reasons,
      ageAtDecision: age,
      provenance: {
        dataSource: ACADEMY_DATA_SOURCE,
        isReal: false,
        generatorVersion: ACADEMY_GENERATOR_VERSION,
        seedFingerprint: `${careerSeed || 'no-career-seed'}|academy-decision|${membership.id}`,
      },
    });
    academyRegistry.registerDecision(decision);
    membership.decisionIds.push(decision.id);
    void team;
    void config;
    void Rnd;
    return decision;
  }

  // Índice de calidad VISIBLE (percentil de TMB dentro del pool del club) —
  // nunca Potencial. Puro.
  function buildPoolQualityIndex(pool, playerRegistry, config) {
    const rows = pool.map((membership) => {
      const player = playerRegistry.get(membership.playerId);
      return {
        membershipId: membership.id,
        playerId: membership.playerId,
        tmb: player ? PD().computeTmbRating(player, config) : 0,
      };
    }).sort((a, b) => (a.tmb - b.tmb) || (a.playerId < b.playerId ? -1 : 1));
    const index = {};
    rows.forEach((row, i) => {
      index[row.membershipId] = rows.length > 1 ? i / (rows.length - 1) : 0.5;
    });
    return index;
  }

  // =====================================================================
  // 3. Aplicar una decisión
  // =====================================================================
  function applyContinue(membership, date) {
    const iso = toIso(date);
    membership.addEvent({ id: `${membership.id}:continued:${membership.events.length}`, type: 'continued', date: iso });
    return { outcome: 'continue' };
  }

  function applyRelease(params) {
    const { membership, date } = params;
    const iso = toIso(date);
    membership.addEvent({
      id: `${membership.id}:released:${membership.events.length}`, type: 'released-to-free-agency', date: iso,
    });
    membership.closeOpenFormationPeriod(iso);
    membership.leftAt = iso;
    // El jugador queda AGENTE LIBRE: sigue en el Player Registry con
    // `teamId === null` y conserva su histórico. Nunca se borra.
    return { outcome: 'release' };
  }

  function applyLeftPathway(params) {
    const {
      membership, date, annualCycleRegistry, cycle, reasons,
    } = params;
    const iso = toIso(date);
    membership.addEvent({
      id: `${membership.id}:left:${membership.events.length}`, type: 'left-professional-pathway', date: iso,
    });
    membership.closeOpenFormationPeriod(iso);
    membership.leftAt = iso;
    const record = new CycleEntities.ProfessionalPathwayExitRecord({
      id: `pathway-exit:${membership.id}`,
      cycleId: cycle ? cycle.id : null,
      playerId: membership.playerId,
      effectiveDate: iso,
      reason: 'academy-age-out',
      reasons: reasons || [],
      lastClubId: membership.clubId,
    });
    annualCycleRegistry.registerPathwayExit(record);
    return { outcome: 'left-professional-pathway', record };
  }

  // Promoción ATÓMICA (sección 13 del prompt):
  //   1) valida la decisión y la capacidad del club;
  //   2) crea el contrato por los servicios de CONTRACT-1;
  //   3) añade la afiliación por `RosterMutationService`;
  //   4) solicita licencia/inscripción por REG-1;
  //   5) si falla lo administrativo, deja estado PENDIENTE claro (nunca un
  //      commit parcial: el contrato+roster son atómicos entre sí).
  function promoteToFirstTeam(params) {
    const {
      academyRegistry, playerRegistry, contractRegistry, registrationRegistry, teams,
      membership, team, date, seasonKey, config, calibration, lineup, existingClassification,
    } = params;
    const iso = toIso(date);
    const player = playerRegistry.require(membership.playerId);
    const status = membership.currentStatus();
    if (status === 'promoted') {
      return { outcome: 'promote', idempotent: true, registrationOutcome: 'active' };
    }

    return Tx().runAtomic(`AcademyService.promoteToFirstTeam(${player.id})`, (ctx) => {
      const agreedEventId = `${membership.id}:promotion-agreed:${membership.events.length}`;
      membership.addEvent({ id: agreedEventId, type: 'promotion-agreed', date: iso, actor: team.id });
      ctx.registerUndo(() => { membership.removeEvent(agreedEventId); });

      // (2) Contrato profesional REAL por el servicio canónico — nunca
      // creado a mano ni desde `Team.addPlayer()`.
      const { contract } = ContractSeeder().seedContractForNewPlayer({
        player,
        team,
        seasonKey,
        date: iso,
        registry: contractRegistry,
        playerRegistry,
        config,
        calibration,
        teams,
        isFirstProfessionalContract: true,
      });
      ctx.registerUndo(() => { contractRegistry.unregister(contract.id); });

      // (3) Afiliación por la frontera ÚNICA de roster.
      const report = RosterSvc().transferPlayer({
        playerRegistry, teams, playerId: player.id, fromTeamId: null, toTeamId: team.id, lineup,
      });
      ctx.registerUndo(() => {
        team.removePlayer(player.id);
        playerRegistry.setAffiliation(player.id, null);
        report.restoreOperationalReferences();
      });

      // (4) Licencia + inscripción por REG-1 (paso administrativo NO
      // atómico respecto al contrato: si el cupo de la competición está
      // agotado, el jugador queda afiliado y con licencia pero con la
      // inscripción DIFERIDA — estado claro, nunca un commit a medias).
      let registrationOutcome = 'not-attempted';
      let registrationId = null;
      let licenseId = null;
      if (registrationRegistry) {
        const seeded = RegistrationSeeder().seedRegistrationForNewPlayer({
          player,
          team,
          seasonKey,
          date: iso,
          registrationRegistry,
          contractRegistry,
          config,
          existingClassification,
        });
        licenseId = seeded.license ? seeded.license.id : null;
        registrationId = seeded.registration ? seeded.registration.id : null;
        registrationOutcome = seeded.registration ? 'active' : 'pending-registration';
        ctx.registerUndo(() => {
          if (registrationId) registrationRegistry.unregisterRegistration(registrationId);
          if (licenseId) registrationRegistry.unregisterLicense(licenseId);
        });
      }

      const promotedEventId = registrationOutcome === 'pending-registration'
        ? `${membership.id}:promotion-pending-registration:${membership.events.length}`
        : `${membership.id}:promoted:${membership.events.length}`;
      membership.addEvent({
        id: promotedEventId,
        type: registrationOutcome === 'pending-registration' ? 'promotion-pending-registration' : 'promoted',
        date: iso,
        data: { contractId: contract.id, registrationOutcome },
      });
      ctx.registerUndo(() => { membership.removeEvent(promotedEventId); });
      // El periodo formativo se cierra al salir de la academia: NUNCA se
      // redondea ni se declara "formado" por haber estado aquí.
      const closedPeriod = membership.closeOpenFormationPeriod(iso);
      ctx.registerUndo(() => { if (closedPeriod) closedPeriod.toDate = null; });
      membership.leftAt = iso;
      ctx.registerUndo(() => { membership.leftAt = null; });

      void academyRegistry;
      return {
        outcome: 'promote', contract, registrationId, licenseId, registrationOutcome, idempotent: false,
      };
    });
  }

  const exportsObj = {
    AcademyService: {
      ACADEMY_DATA_SOURCE,
      ACADEMY_GENERATOR_VERSION,
      runAnnualIntake,
      buildPoolQualityIndex,
      decideForMembership,
      applyContinue,
      applyRelease,
      applyLeftPathway,
      promoteToFirstTeam,
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
