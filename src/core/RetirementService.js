// src/core/RetirementService.js
// CYCLE-1 (DESIGN.md 9.22, sección 12 del prompt) — retiradas: perfil
// privado determinista de longevidad, decisión/anuncio y commit efectivo.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// PROHIBICIÓN CENTRAL DE ESTA ENTREGA: `hidden.potential` (ni ninguna
// transformación de PA) participa NUNCA en la longevidad ni en la decisión
// de retirada. Este archivo no lee `potential` en ningún punto — auditado
// estáticamente en `scripts/test-cycle1.js` (búsqueda literal) y verificado
// además en runtime (cambiar el PA de un jugador de 100 a 200 no altera su
// perfil ni su decisión).
//
// Señales PERMITIDAS (todas visibles o ya modeladas): edad en la fecha de
// CARRERA, `developmentState.agingOffsetYears`, tendencia reciente de TMB,
// carga médica acumulada y disponibilidad, minutos/rol reciente, situación
// contractual, duración como agente libre, y Profesionalidad/Ambición
// ocultas (que sí están permitidas explícitamente por el prompt).
//
// La retirada es CALIBRACIÓN DE JUEGO (`CycleConfig.RETIREMENT`), nunca una
// norma federativa.
//
// Módulo puro: no lee DOM ni `state`; recibe registros/fechas explícitos.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CareerAgeModule = isNode ? require('../utils/CareerAge.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;
  const CycleEntities = isNode ? require('../entities/Cycle.js') : global.BasketManager;
  const CycleTransactionModule = isNode ? require('./CycleTransaction.js') : global.BasketManager;
  const PlayerDevelopmentModule = isNode ? require('./PlayerDevelopment.js') : global.BasketManager;
  const RosterMutationModule = isNode ? require('./RosterMutationService.js') : global.BasketManager;
  const RegistrationServiceModule = isNode ? require('./RegistrationService.js') : global.BasketManager;
  const PlayerCareerModule = isNode ? require('./PlayerCareer.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function CareerAge() { return CareerAgeModule.CareerAge; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }
  function CC() { return CycleConfigModule.CycleConfig; }
  function Tx() { return CycleTransactionModule.CycleTransaction; }
  function PD() { return PlayerDevelopmentModule; }
  function RosterSvc() { return RosterMutationModule.RosterMutationService; }
  function RegSvc() { return RegistrationServiceModule.RegistrationService; }

  const RETIREMENT_PROFILE_VERSION = 'retirement-profile-v1';
  const RETIREMENT_POLICY_VERSION = 'simulated-retirement-policy-v1';

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  // =====================================================================
  // 1. Perfil PRIVADO determinista de longevidad
  // =====================================================================
  // Huella estable por jugador+carrera: dos carreras con la misma semilla
  // reproducen el mismo perfil; dos jugadores DISTINTOS (aunque tengan
  // idéntico Potencial y atributos) reciben perfiles distintos, que es
  // exactamente la diversidad individual que pidió el usuario.
  function buildProfileFingerprint(playerId, careerSeed) {
    return `${careerSeed || 'no-career-seed'}|${playerId}|${RETIREMENT_PROFILE_VERSION}`;
  }

  function ensureProfile(params) {
    const {
      annualCycleRegistry, player, careerSeed, date,
    } = params;
    const existing = annualCycleRegistry.getRetirementProfile(player.id);
    if (existing) return existing;
    const fingerprint = buildProfileFingerprint(player.id, careerSeed);
    const cfg = CC().RETIREMENT;
    const offsetSpan = cfg.longevityOffsetMaxYears - cfg.longevityOffsetMinYears;
    // Distribución triangular (dos tiradas independientes promediadas):
    // concentra la mayoría de carreras en la banda objetivo 34-41 y deja
    // colas reales a ambos lados, sin que ninguna edad exacta garantice por
    // sí sola la retirada antes del máximo de seguridad.
    const rollA = Rnd().unitFrom(fingerprint, 'longevity-a');
    const rollB = Rnd().unitFrom(fingerprint, 'longevity-b');
    const triangular = (rollA + rollB) / 2;
    const longevityOffsetYears = Number((cfg.longevityOffsetMinYears + triangular * offsetSpan).toFixed(3));
    const declineSensitivity = Number((0.80 + Rnd().unitFrom(fingerprint, 'decline-sensitivity') * 0.45).toFixed(3));
    // Mentalidad: SOLO Profesionalidad y Ambición (permitidas), nunca PA.
    const professionalism = (player.hidden && player.hidden.professionalism) || 10;
    const ambition = (player.hidden && player.hidden.ambition) || 10;
    const mindsetFactor = Number((((professionalism + ambition) / 2 - 10) / 10).toFixed(3)); // ~[-0.9, +1.0]
    const profile = new CycleEntities.RetirementProfile({
      playerId: player.id,
      seedFingerprint: fingerprint,
      profileVersion: RETIREMENT_PROFILE_VERSION,
      longevityOffsetYears,
      declineSensitivity,
      mindsetFactor,
      inputsUsed: [
        'careerAge', 'developmentState.agingOffsetYears', 'tmbTrend', 'medicalLoad', 'recentMinutes',
        'contractSituation', 'freeAgentDuration', 'hidden.professionalism', 'hidden.ambition',
      ],
      createdAt: toIso(date),
    });
    return annualCycleRegistry.registerRetirementProfile(profile);
  }

  // =====================================================================
  // 2. Señales de la decisión (todas VISIBLES o ya modeladas)
  // =====================================================================
  // Tendencia de TMB de las últimas temporadas cerradas (careerHistory) —
  // negativa = declive. No usa Potencial en ningún punto.
  function computeTmbTrend(player, config) {
    const ch = player.careerHistory;
    if (!ch || !ch.seasons || ch.seasons.length < 2) return 0;
    const recent = ch.seasons.slice(-3);
    const currentTmb = PD().computeTmbRating(player, config);
    // `season.tmb` es el TMB fotografiado por `PlayerCareer.closeSeason()`
    // al cerrar cada temporada — dato YA existente, nunca recalculado aquí.
    const firstOfWindow = (recent[0].tmb !== undefined && recent[0].tmb !== null) ? recent[0].tmb : currentTmb;
    // Normalizado a [-1, 1]: 20 puntos de TMB perdidos = -1.
    return clamp((currentTmb - firstOfWindow) / 20, -1, 1);
  }

  // Carga médica acumulada: número de lesiones del histórico + si está
  // indisponible ahora. Normalizado a [0, 1].
  function computeMedicalLoadSignal(player) {
    const ms = player.medicalState;
    if (!ms) return 0;
    const injuries = (ms.injuryHistory || []).length;
    const currentlyInjured = ms.currentInjury ? 1 : 0;
    return clamp((injuries / 12) + (currentlyInjured * 0.25), 0, 1);
  }

  // Minutos/rol reciente: media de minutos por partido de la última
  // temporada cerrada (o de la temporada en curso si no hay cerradas).
  // Normalizado a [0, 1] con 25 min/partido como referencia de titular.
  // `stats` es el array compacto de `PlayerCareer` (STAT_SNAPSHOT_KEYS):
  // se leen `games`/`seconds` con su API pública (`statValue`), nunca por
  // índice numérico a mano.
  function computeRecentMinutesSignal(player) {
    const ch = player.careerHistory;
    if (!ch) return 0.5;
    const source = (ch.seasons && ch.seasons.length) ? ch.seasons[ch.seasons.length - 1] : ch.currentSeason;
    if (!source || !source.stats) return 0.5;
    const PCore = PlayerCareerModule;
    const games = PCore.statValue(source.stats, 'games');
    const seconds = PCore.statValue(source.stats, 'seconds');
    if (!games) return 0.5;
    return clamp(((seconds / games) / 60) / 25, 0, 1);
  }

  // =====================================================================
  // 3. Decisión anual de retirada
  // =====================================================================
  // Devuelve `{ willAnnounce, score, reasons, effectiveDate }` — `reasons`
  // son CUALITATIVAS (nunca la puntuación, nunca el perfil privado).
  function evaluateRetirementIntent(params) {
    const {
      annualCycleRegistry, player, config, date, careerSeed, currentContract, freeAgentSinceDate,
    } = params;
    const iso = toIso(date);
    const cfg = CC().RETIREMENT;
    const profile = ensureProfile({
      annualCycleRegistry, player, careerSeed, date: iso,
    });
    const age = CareerAge().ageOnDate(player, iso);
    if (age === null) {
      return { willAnnounce: false, score: 0, reasons: ['Sin fecha de nacimiento conocida: sin evaluación de retirada.'], age: null };
    }

    // Máximo de seguridad: por encima de él la retirada es forzosa (evita
    // jugadores activos indefinidamente).
    if (age >= cfg.safetyMaxAgeInclusive) {
      return {
        willAnnounce: true,
        forced: true,
        impliedRetirementAge: cfg.safetyMaxAgeInclusive,
        age,
        reasons: [`Alcanza el máximo de edad competitiva contemplado por la simulación (${cfg.safetyMaxAgeInclusive} años).`],
      };
    }

    const reasons = [];
    const shifts = cfg.yearShifts;
    // Base individual: el perfil privado sitúa al jugador dentro de la banda
    // objetivo. `longevityOffsetYears` es triangular en
    // [min, max] con media (min+max)/2, así que se centra sobre esa media
    // para que la banda resultante sea la configurada.
    const offsetMean = (cfg.longevityOffsetMinYears + cfg.longevityOffsetMaxYears) / 2;
    const bandMid = (cfg.targetBandMinAge + cfg.targetBandMaxAge) / 2;
    let impliedAge = bandMid + (profile.longevityOffsetYears - offsetMean);

    // Longevidad individual YA modelada por LIFE-1 (nunca duplicada aquí).
    const agingOffset = (player.developmentState && player.developmentState.agingOffsetYears) || 0;
    impliedAge += agingOffset * shifts.agingOffset;

    const tmbTrend = computeTmbTrend(player, config);
    const declineSignal = clamp(-tmbTrend * profile.declineSensitivity, 0, 1);
    impliedAge += declineSignal * shifts.tmbDeclineTrend;
    if (declineSignal > 0.25) reasons.push('Su rendimiento viene cayendo en las últimas temporadas.');

    const medicalSignal = computeMedicalLoadSignal(player);
    impliedAge += medicalSignal * shifts.medicalLoad;
    if (medicalSignal > 0.35) reasons.push('Acumula una carga de lesiones considerable.');

    const minutesSignal = computeRecentMinutesSignal(player);
    const roleSignal = clamp(1 - minutesSignal, 0, 1);
    impliedAge += roleSignal * shifts.reducedRole;
    if (roleSignal > 0.6) reasons.push('Su papel en la rotación se ha reducido mucho.');

    if (!currentContract) {
      impliedAge += shifts.noContract;
      reasons.push('Termina el curso sin contrato profesional en vigor.');
    }

    let freeAgentSignal = 0;
    if (!currentContract && freeAgentSinceDate) {
      const days = LD().daysBetween(toIso(freeAgentSinceDate), iso);
      freeAgentSignal = clamp(days / 365, 0, 1);
      impliedAge += freeAgentSignal * shifts.freeAgentDuration;
      if (freeAgentSignal > 0.5) reasons.push('Lleva mucho tiempo sin encontrar equipo.');
    }

    // Mentalidad: más profesionalidad/ambición ALARGA la carrera.
    impliedAge += profile.mindsetFactor * shifts.mindset;

    // La edad implícita nunca cae por debajo de la evaluación ordinaria ni
    // supera el máximo de seguridad.
    impliedAge = clamp(impliedAge, cfg.ordinaryEvaluationFromAge, cfg.safetyMaxAgeInclusive);

    if (age < cfg.ordinaryEvaluationFromAge) {
      return {
        willAnnounce: false,
        forced: false,
        impliedRetirementAge: Number(impliedAge.toFixed(2)),
        age,
        reasons: ['Todavía no entra en la evaluación ordinaria de retirada por edad.'],
      };
    }

    const willAnnounce = age >= impliedAge;
    if (willAnnounce) {
      reasons.unshift('Considera que su recorrido competitivo ha llegado a su fin.');
    } else if (!reasons.length) {
      reasons.push('Se mantiene con ganas de seguir compitiendo una temporada más.');
    }
    return {
      willAnnounce,
      forced: false,
      // Dato PRIVADO de simulación: se expone para tests/smoke deterministas
      // y NUNCA se muestra en la interfaz (sección 20 del prompt).
      impliedRetirementAge: Number(impliedAge.toFixed(2)),
      age,
      reasons,
    };
  }

  // =====================================================================
  // 4. Anuncio
  // =====================================================================
  // Un jugador con contrato garantizado ACTIVO normalmente anuncia su
  // retirada para el FINAL de ese contrato — CYCLE-1 no inventa una
  // extinción unilateral a mitad de contrato (sección 12 del prompt).
  function resolveEffectiveDate(params) {
    const { currentContract, date, forced } = params;
    const iso = toIso(date);
    if (!currentContract) return iso;
    // Si el contrato ya venció (o vence hoy), la retirada es inmediata.
    if (!LD().isAfter(currentContract.endDate, iso)) return iso;
    if (forced) {
      // Ni siquiera el máximo de seguridad rompe un contrato garantizado:
      // se retira al terminarlo.
      return currentContract.endDate;
    }
    return currentContract.endDate;
  }

  function announceRetirement(params) {
    const {
      annualCycleRegistry, cycle, player, clubId, date, currentContract, reasons, forced,
    } = params;
    const iso = toIso(date);
    const existing = annualCycleRegistry.retirementAnnouncementsForPlayer(player.id)
      .find((a) => a.currentStatus() === 'announced' || a.currentStatus() === 'blocked');
    if (existing) return existing; // idempotente
    const effectiveDate = resolveEffectiveDate({ currentContract, date: iso, forced });
    const announcement = new CycleEntities.RetirementAnnouncement({
      id: `retirement:${cycle.id}:${player.id}`,
      cycleId: cycle.id,
      playerId: player.id,
      clubIdAtAnnouncement: clubId || null,
      announcedAt: iso,
      effectiveDate,
      reasons: reasons || [],
      provenance: { dataSource: 'simulated-retirement-v1', isReal: false, generatorVersion: RETIREMENT_POLICY_VERSION },
    });
    annualCycleRegistry.registerRetirementAnnouncement(announcement);
    announcement.addEvent({
      id: `${announcement.id}:announced`, type: 'announced', date: iso, actor: player.id,
    });
    return announcement;
  }

  // =====================================================================
  // 5. Commit de la retirada (atómico e idempotente)
  // =====================================================================
  // En la fecha efectiva: revalida contrato/cesión/movimientos pendientes,
  // limpia afiliación/licencia/inscripción/negociaciones/reservas mediante
  // servicios canónicos, conserva `Player`/`careerHistory`/estadísticas/
  // honores/hitos/contratos históricos, y lo excluye de roster, academia,
  // libres activos y búsqueda de fichables. Nunca borra nada.
  function commitRetirement(params) {
    const {
      annualCycleRegistry, academyRegistry, playerRegistry, contractRegistry, registrationRegistry,
      marketRegistry, loanRegistry, teams, announcement, date, seasonKey, lineup, cycleId,
    } = params;
    const iso = toIso(date);
    const transactionId = `tx:retirement:${announcement.id}`;

    // Idempotencia: repetir el comando devuelve el MISMO receipt.
    const already = annualCycleRegistry.retirementRecordsForPlayer(announcement.playerId)
      .find((record) => record.announcementId === announcement.id);
    if (already) return { record: already, idempotent: true };

    if (LD().isAfter(announcement.effectiveDate, iso)) {
      return { record: null, notYetDue: true, effectiveDate: announcement.effectiveDate };
    }
    const player = playerRegistry.require(announcement.playerId);

    // Una cesión ACTIVA debe haberse resuelto antes (prioridad 1 de la
    // tabla de eventos de la misma fecha) — nunca se retira a alguien que
    // sigue cedido: el retorno lo procesa LOAN-1 por el reloj.
    if (loanRegistry && loanRegistry.hasActiveLoanForPlayer(player.id, iso)) {
      announcement.addEvent({
        id: `${announcement.id}:blocked:${announcement.events.length}`, type: 'blocked', date: iso,
        data: { code: 'ACTIVE_LOAN_PENDING_RETURN' },
      });
      return {
        record: null,
        blocked: true,
        diagnostic: { code: 'ACTIVE_LOAN_PENDING_RETURN', playerId: player.id },
      };
    }

    return Tx().runAtomic(`RetirementService.commitRetirement(${player.id})`, (ctx) => {
      const cleanup = {
        rosterRemovedFromClubId: null,
        deactivatedRegistrationIds: [],
        expiredLicenseIds: [],
        withdrawnRenewalCaseIds: [],
        releasedReservationGroupIds: [],
        closedAcademyMembershipId: null,
        terminatedContractId: null,
      };

      // 5.1 Contrato vigente: si aún cubre la fecha efectiva, se cierra por
      // RETIRADA (hecho real y distinto de una expiración natural o de una
      // terminación por causa: la relación se extingue porque el trabajador
      // deja la profesión). Nunca se muta `endDate`.
      const currentContract = contractRegistry ? contractRegistry.currentForPlayer(player.id, iso) : null;
      if (currentContract && currentContract.statusOn(iso) === 'active') {
        const eventId = `${currentContract.id}:retired:${currentContract.lifecycleEvents.length}`;
        currentContract.addLifecycleEvent({
          id: eventId, type: 'terminated', date: iso, note: `CYCLE-1:retirement:${announcement.id}`,
        });
        cleanup.terminatedContractId = currentContract.id;
        ctx.registerUndo(() => { currentContract.removeLifecycleEvent(eventId); });
      }

      // 5.2 Inscripciones ACTIVAS: baja regulatoria por servicios canónicos.
      if (registrationRegistry) {
        registrationRegistry.registrationsForPlayer(player.id)
          .filter((registration) => registration.statusOn(iso) === 'active')
          .forEach((registration) => {
            const eventId = `${registration.id}:deactivated:${registration.events.length}`;
            const previousReason = registration.trace.deactivationReasonCode;
            RegSvc().deactivateRegistration(registration, iso, `CYCLE-1:retirement:${announcement.id}`);
            cleanup.deactivatedRegistrationIds.push(registration.id);
            ctx.registerUndo(() => {
              registration.removeEvent(eventId);
              if (previousReason === undefined) delete registration.trace.deactivationReasonCode;
              else registration.trace.deactivationReasonCode = previousReason;
            });
          });
        registrationRegistry.licensesForPlayer(player.id)
          .filter((license) => license.statusOn(iso) === 'active')
          .forEach((license) => {
            const eventId = `${license.id}:expired:${license.events.length}`;
            RegSvc().advanceLicenseEvent(license, 'expired', iso);
            cleanup.expiredLicenseIds.push(license.id);
            ctx.registerUndo(() => { license.removeEvent(eventId); });
          });
      }

      // 5.3 Afiliación de plantilla: frontera ÚNICA (RosterMutationService).
      const currentTeam = (teams || []).find((team) => team.roster.some((p) => p.id === player.id));
      if (currentTeam) {
        const report = RosterSvc().releasePlayer({
          playerRegistry, teams, playerId: player.id, fromTeamId: currentTeam.id, lineup,
        });
        cleanup.rosterRemovedFromClubId = currentTeam.id;
        ctx.registerUndo(() => {
          currentTeam.addPlayer(player);
          report.restoreOperationalReferences();
        });
      }

      // 5.4 Academia: si estaba en un pool, se cierra la pertenencia.
      if (academyRegistry) {
        const membership = academyRegistry.activeMembershipForPlayer(player.id, iso);
        if (membership) {
          const eventId = `${membership.id}:left:${membership.events.length}`;
          membership.addEvent({
            id: eventId, type: 'left-professional-pathway', date: iso, data: { reason: 'retirement' },
          });
          membership.closeOpenFormationPeriod(iso);
          cleanup.closedAcademyMembershipId = membership.id;
          ctx.registerUndo(() => { membership.removeEvent(eventId); });
        }
      }

      // 5.5 Renovaciones/negociaciones vivas y reservas presupuestarias.
      annualCycleRegistry.renewalCasesForPlayer(player.id)
        .filter((renewal) => renewal.isLiveOn(iso))
        .forEach((renewal) => {
          const eventId = `${renewal.id}:withdrawn:${renewal.events.length}`;
          renewal.addEvent({
            id: eventId, type: 'withdrawn', date: iso, data: { reason: 'player-retirement' },
          });
          cleanup.withdrawnRenewalCaseIds.push(renewal.id);
          ctx.registerUndo(() => { renewal.removeEvent(eventId); });
          if (marketRegistry && renewal.budgetReservationGroupId) {
            const before = (marketRegistry.getBudgetReservationGroup(renewal.budgetReservationGroupId) || [])
              .map((line) => ({ id: line.id, status: line.status }));
            marketRegistry.releaseBudgetGroup(renewal.budgetReservationGroupId);
            cleanup.releasedReservationGroupIds.push(renewal.budgetReservationGroupId);
            ctx.registerUndo(() => {
              before.forEach((line) => {
                const current = marketRegistry.getBudgetReservation(line.id);
                if (current) current.status = line.status;
              });
            });
          }
        });

      // 5.6 Receipt + evento de efectividad. `Player`, `careerHistory`,
      // estadísticas, honores, hitos, récords y contratos históricos se
      // CONSERVAN intactos: una retirada nunca borra temporadas.
      const record = new CycleEntities.RetirementRecord({
        id: `retirement-record:${announcement.id}`,
        announcementId: announcement.id,
        playerId: player.id,
        effectiveDate: announcement.effectiveDate,
        transactionId,
        lastClubId: cleanup.rosterRemovedFromClubId || announcement.clubIdAtAnnouncement || null,
        finalSeasonKey: seasonKey || null,
        cleanup,
        careerSummary: player.careerHistory ? {
          seasons: player.careerHistory.seasons.length,
          milestones: player.careerHistory.milestones.length,
          historyCompleteness: player.careerHistory.historyCompleteness,
        } : {},
        provenance: { dataSource: 'simulated-retirement-v1', isReal: false, generatorVersion: RETIREMENT_POLICY_VERSION },
      });
      annualCycleRegistry.registerRetirementRecord(record);
      ctx.registerUndo(() => { annualCycleRegistry.unregisterRetirementRecord(record.id); });

      const effectiveEventId = `${announcement.id}:effective`;
      announcement.addEvent({ id: effectiveEventId, type: 'effective', date: iso });
      ctx.registerUndo(() => { announcement.removeEvent(effectiveEventId); });

      void cycleId;
      return { record, idempotent: false };
    });
  }

  // =====================================================================
  // 6. Consulta DERIVADA para la interfaz/mercado
  // =====================================================================
  // Un retirado sigue siendo LOCALIZABLE por id (ficha universal) pero NO
  // es fichable. Nunca se muestra el perfil de longevidad ni la
  // probabilidad de retirada (sección 20 del prompt).
  function describeRetirementStatus(annualCycleRegistry, playerId, date) {
    const iso = toIso(date);
    const record = annualCycleRegistry.retirementRecordsForPlayer(playerId)
      .find((entry) => !LD().isAfter(entry.effectiveDate, iso));
    if (record) {
      return {
        status: 'retired', effectiveDate: record.effectiveDate, recordId: record.id, signable: false,
      };
    }
    const announcement = annualCycleRegistry.retirementAnnouncementsForPlayer(playerId)
      .find((entry) => entry.currentStatus() === 'announced');
    if (announcement) {
      return {
        status: 'retirement-announced',
        effectiveDate: announcement.effectiveDate,
        announcementId: announcement.id,
        reasons: [...announcement.reasons],
        // Una retirada ANUNCIADA no retira al jugador antes de su fecha
        // efectiva: sigue jugando y sigue siendo fichable hasta entonces.
        signable: true,
      };
    }
    return { status: 'active', signable: true };
  }

  const exportsObj = {
    RetirementService: {
      RETIREMENT_PROFILE_VERSION,
      RETIREMENT_POLICY_VERSION,
      buildProfileFingerprint,
      ensureProfile,
      computeTmbTrend,
      computeMedicalLoadSignal,
      computeRecentMinutesSignal,
      evaluateRetirementIntent,
      resolveEffectiveDate,
      announceRetirement,
      commitRetirement,
      describeRetirementStatus,
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
