// src/core/WorldCalendarCoordinator.js
// WORLD-CALENDAR-1 (DESIGN.md 10.14) — protocolo de FUENTES temporales
// (`WorldCalendarSource`) y COORDINADOR que implementa la semántica exacta
// de "Continuar" (`advanceUntilNextUserStop()`). Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Cada fuente tiene exactamente dos responsabilidades (sección 10 del
// prompt):
//   1. listar sus items pendientes como objetos PLANOS;
//   2. resolver UN item por id, delegando en su servicio de dominio real.
//
// El coordinador se construye con dependencias EXPLÍCITAS y nunca lee
// `state`, DOM, `Date.now()`, `Math.random()` ni globals por dentro. No
// replica ninguna regla de Market/Transfer/Loan/Competition: ordena
// referencias y delega el commit en la fuente propietaria.
//
// Ningún literal de España/ACB/FEB/`1ª`/`2ª` aparece en este archivo
// (auditado en `scripts/test-world-calendar1.js`).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const GameDateTimeModule = isNode ? require('../utils/GameDateTime.js') : global.BasketManager;

  function GDT() { return GameDateTimeModule.GameDateTime; }

  const SOURCE_TYPES = {
    COMPETITION_MATCH: 'competition-match',
    // WORLD-SIM-1 (DESIGN.md 10.16, sección 12 del prompt): hitos
    // agregados de fases "abstract" — nunca partidos, nunca parada del
    // usuario.
    COMPETITION_SIMULATION: 'competition-simulation',
    MARKET_EVENT: 'market-event',
    TRANSFER_EVENT: 'transfer-event',
    LOAN_EVENT: 'loan-event',
    // NATIONAL-TEAMS-1 (DESIGN.md 10.17, sección 6 del prompt): plazos
    // administrativos + servicio internacional de una NationalTeamWindow —
    // nunca es parada del usuario (ver `requiresUser()` más abajo, que no
    // declara ninguna rama para esta fuente).
    NATIONAL_TEAM_DUTY: 'national-team-duty',
  };

  const STOP_TYPES = {
    USER_MATCH: 'user-match',
    MARKET_ATTENTION: 'market-attention',
    SCHEDULE_CONFLICT: 'schedule-conflict',
    SEASON_COMPLETE: 'season-complete',
    RESOLUTION_FAILED: 'resolution-failed',
  };

  function requireFunction(fn, label) {
    if (typeof fn !== 'function') throw new Error(`WorldCalendarCoordinator: falta "${label}" explícito (función).`);
    return fn;
  }

  // =======================================================================
  // Fuente 1 — `competition-match`: partidos MATERIALIZADOS pendientes de
  // todos los runners activos del `CompetitionEngine`. Listar es PURO: no
  // materializa partidos nuevos, no avanza rondas y no consume RNG
  // (invariante 11); resolver delega SIEMPRE en
  // `CompetitionEngine.resolveMatch()` a través del callback inyectado, que
  // es quien construye alineaciones y publica efectos posteriores.
  // =======================================================================
  function createCompetitionMatchSource({ engine, resolveMatch, timeZoneId }) {
    if (!engine) throw new Error('createCompetitionMatchSource: falta "engine".');
    requireFunction(resolveMatch, 'resolveMatch(descriptor)');
    const fallbackZone = timeZoneId || null;
    return {
      sourceType: SOURCE_TYPES.COMPETITION_MATCH,
      listPendingItems() {
        return engine.listAllPendingMatches().map((descriptor) => {
          if (!descriptor.scheduledAt) {
            throw new Error(
              `competition-match: el partido "${descriptor.id}" no tiene "scheduledAt" — todo partido de la ruta `
              + 'productiva necesita instante UTC y huso explícitos (invariante 8).',
            );
          }
          const zone = descriptor.timeZoneId || fallbackZone;
          if (!zone) {
            throw new Error(
              `competition-match: el partido "${descriptor.id}" no declara "timeZoneId" y la fuente no tiene huso `
              + 'por defecto — nunca se asume el huso del proceso (BUG-WORLDCALENDAR-03).',
            );
          }
          // WORLD-SIM-1 (DESIGN.md 10.16, sección 12 del prompt): el nivel
          // de detalle de la Edition dueña viaja en la metadata para que el
          // coordinador pueda detectar (nunca simular a escondidas) un Team
          // controlado inscrito en una Edition no "playable".
          const edition = engine.world.registries.competitionEditions.get(descriptor.competitionEditionId);
          return {
            sourceId: descriptor.id,
            moment: { precision: 'instant', instant: descriptor.scheduledAt, timeZoneId: zone },
            attentionScope: { teamIds: [descriptor.homeParticipantId, descriptor.awayParticipantId], clubIds: [] },
            metadata: {
              kind: 'match',
              stageId: descriptor.stageId,
              stageKey: descriptor.stageKey,
              matchId: descriptor.id,
              competitionDefinitionId: descriptor.competitionDefinitionId,
              competitionEditionId: descriptor.competitionEditionId,
              detailLevel: edition ? edition.detailLevel : null,
              homeParticipantId: descriptor.homeParticipantId,
              awayParticipantId: descriptor.awayParticipantId,
              round: descriptor.round === undefined ? null : descriptor.round,
              roundIndex: descriptor.roundIndex === undefined ? null : descriptor.roundIndex,
              gameNumber: descriptor.gameNumber === undefined ? null : descriptor.gameNumber,
              seriesId: descriptor.seriesId || null,
            },
          };
        });
      },
      resolveItem(item) {
        return resolveMatch({
          stageId: item.metadata.stageId,
          matchId: item.metadata.matchId,
          item,
        });
      },
    };
  }

  // =======================================================================
  // Fuente NUEVA — `competition-simulation` (WORLD-SIM-1, DESIGN.md 10.16,
  // sección 12 del prompt): hitos AGREGADOS de fases "abstract" ya
  // declarados por runtimes activos del `CompetitionEngine`. Listar es
  // PURO (nunca resuelve ni consume RNG); resolver delega SIEMPRE en
  // `CompetitionEngine.resolveAbstractMilestone()` — nunca es parada del
  // usuario (invariante: "abstract" no tiene control humano).
  // =======================================================================
  function createCompetitionSimulationSource({ engine, resolveMilestone, timeZoneId }) {
    if (!engine) throw new Error('createCompetitionSimulationSource: falta "engine".');
    requireFunction(resolveMilestone, 'resolveMilestone(descriptor)');
    const fallbackZone = timeZoneId || null;
    return {
      sourceType: SOURCE_TYPES.COMPETITION_SIMULATION,
      listPendingItems() {
        return engine.listAllPendingAbstractMilestones().map((milestone) => {
          const zone = milestone.timeZoneId || fallbackZone;
          if (!milestone.scheduledAt || !zone) {
            throw new Error(
              `competition-simulation: el hito "${milestone.id}" no tiene instante/huso explícitos (invariante: `
              + 'nunca el reloj del proceso).',
            );
          }
          return {
            sourceId: milestone.id,
            moment: { precision: 'instant', instant: milestone.scheduledAt, timeZoneId: zone },
            // Nunca teamIds/clubIds de atención — un hito agregado JAMÁS
            // exige intervención del usuario (sección 6: "abstract" no
            // tiene control humano).
            attentionScope: { teamIds: [], clubIds: [] },
            metadata: {
              kind: 'competition-simulation',
              stageId: milestone.stageId,
              stageKey: milestone.stageKey,
              milestoneId: milestone.id,
              competitionDefinitionId: milestone.competitionDefinitionId,
              competitionEditionId: milestone.competitionEditionId,
            },
          };
        });
      },
      resolveItem(item) {
        return resolveMilestone({
          stageId: item.metadata.stageId,
          milestoneId: item.metadata.milestoneId,
          item,
        });
      },
    };
  }

  // =======================================================================
  // Fuente 2 — `market-event`: eventos ya PROGRAMADOS por MARKET-1
  // (`MarketRegistry.allScheduledEvents()`), con su FECHA CIVIL intacta.
  // No se reimplementa ninguna regla de mercado: `resolveEvent` delega en
  // `MarketService` exactamente igual que antes de esta entrega.
  // =======================================================================
  function createMarketEventSource({ marketRegistry, resolveEvent, timeZoneId }) {
    if (!marketRegistry) throw new Error('createMarketEventSource: falta "marketRegistry".');
    requireFunction(resolveEvent, 'resolveEvent(event)');
    const zone = GDT().requireTimeZoneId(timeZoneId);
    return {
      sourceType: SOURCE_TYPES.MARKET_EVENT,
      listPendingItems() {
        return marketRegistry.allScheduledEvents()
          .filter((event) => !event.processed)
          .map((event) => ({
            sourceId: event.id,
            moment: { precision: 'date', localDate: event.dueDate, timeZoneId: zone },
            attentionScope: { teamIds: [], clubIds: event.clubId ? [event.clubId] : [] },
            metadata: {
              kind: 'market-event',
              eventType: event.type,
              clubId: event.clubId || null,
              playerId: event.playerId || null,
              requiresAttention: !!event.requiresAttention,
              dueDate: event.dueDate,
            },
          }));
      },
      resolveItem(item) {
        const event = marketRegistry.getScheduledEvent(item.sourceId);
        if (!event) {
          throw new Error(`market-event: el evento "${item.sourceId}" ya no existe en MarketRegistry.`);
        }
        return resolveEvent(event);
      },
    };
  }

  // =======================================================================
  // Fuente 3 — `transfer-event`: expedientes `scheduled` de TRANSFER-1 con
  // su fecha efectiva ya modelada. `resolveCase` delega en
  // `TransferService.retryScheduledTransferCase()` (que replanifica y
  // revalida desde cero, nunca ejecuta un plan viejo a ciegas).
  // =======================================================================
  function createTransferEventSource({ transferRegistry, resolveCase, timeZoneId }) {
    if (!transferRegistry) throw new Error('createTransferEventSource: falta "transferRegistry".');
    requireFunction(resolveCase, 'resolveCase(transferCase)');
    const zone = GDT().requireTimeZoneId(timeZoneId);
    return {
      sourceType: SOURCE_TYPES.TRANSFER_EVENT,
      listPendingItems() {
        return transferRegistry.allCases()
          // `statusOn(null)` = estado REAL, sin filtrar por fecha (misma
          // corrección documentada en TRANSFER-1: dos competiciones pueden
          // procesar sus fechas en órdenes distintos).
          .filter((tCase) => tCase.statusOn(null) === 'scheduled' && tCase.effectiveDate)
          .map((tCase) => ({
            sourceId: tCase.id,
            moment: { precision: 'date', localDate: tCase.effectiveDate, timeZoneId: zone },
            attentionScope: {
              teamIds: [],
              clubIds: [tCase.destinationClubId, tCase.originClubId].filter(Boolean),
            },
            metadata: {
              kind: 'transfer-event',
              caseId: tCase.id,
              playerId: tCase.playerId,
              effectiveDate: tCase.effectiveDate,
              originClubId: tCase.originClubId || null,
              destinationClubId: tCase.destinationClubId || null,
            },
          }));
      },
      resolveItem(item) {
        const tCase = transferRegistry.getCase(item.sourceId);
        if (!tCase) throw new Error(`transfer-event: el expediente "${item.sourceId}" ya no existe.`);
        return resolveCase(tCase);
      },
    };
  }

  // =======================================================================
  // Fuente 4 — `loan-event`: retornos de cesión de LOAN-1 al alcanzar su
  // `returnEffectiveDate` (modelo SEMIABIERTO: el día del retorno cuenta
  // como ya devuelto). `resolveReturn` delega en `LoanService`.
  // =======================================================================
  function createLoanEventSource({ loanRegistry, resolveReturn, timeZoneId }) {
    if (!loanRegistry) throw new Error('createLoanEventSource: falta "loanRegistry".');
    requireFunction(resolveReturn, 'resolveReturn(agreement)');
    const zone = GDT().requireTimeZoneId(timeZoneId);
    return {
      sourceType: SOURCE_TYPES.LOAN_EVENT,
      listPendingItems() {
        return loanRegistry.allAgreements()
          .filter((agreement) => agreement.currentStatus() === 'active' && agreement.returnEffectiveDate)
          .map((agreement) => ({
            sourceId: `${agreement.id}:return`,
            moment: { precision: 'date', localDate: agreement.returnEffectiveDate, timeZoneId: zone },
            attentionScope: {
              teamIds: [],
              clubIds: [agreement.ownerClubId, agreement.borrowerClubId].filter(Boolean),
            },
            metadata: {
              kind: 'loan-return',
              agreementId: agreement.id,
              playerId: agreement.playerId,
              returnEffectiveDate: agreement.returnEffectiveDate,
              ownerClubId: agreement.ownerClubId,
              borrowerClubId: agreement.borrowerClubId,
            },
          }));
      },
      resolveItem(item) {
        const agreement = loanRegistry.getAgreement(item.metadata.agreementId);
        if (!agreement) throw new Error(`loan-event: la cesión "${item.metadata.agreementId}" ya no existe.`);
        return resolveReturn(agreement);
      },
    };
  }

  // =======================================================================
  // Fuente NUEVA — `national-team-duty` (NATIONAL-TEAMS-1, DESIGN.md 10.17,
  // sección 6 del prompt): plazos administrativos y servicio internacional
  // de cada `NationalTeamWindow` — lista items PLANOS y delega SIEMPRE en
  // `NationalTeamService` a través del callback inyectado; esta fuente no
  // contiene reglas propias. Nunca es parada del usuario (una ventana FIBA
  // jamás exige intervención humana en el club, `requiresUser()` no declara
  // ninguna rama para este `sourceType`).
  //
  // Cada ventana declara 5 pasos fechados (aviso, lista preliminar, lista
  // final, inicio y fin de servicio); `window.hasResolvedStep()`/
  // `markStepResolved()` evita relistar un paso ya resuelto en la próxima
  // sincronización (mismo problema que resuelven los eventos "processed" de
  // Market/Loan, aquí resuelto en la propia ventana porque declara varios
  // plazos distintos, no uno solo) — así reprocesar un item ya resuelto es
  // idempotente (sección 6: "reprocesar un item ya resuelto es idempotente").
  // =======================================================================
  function createNationalTeamDutySource({ nationalTeamRegistry, resolveItem, timeZoneId }) {
    if (!nationalTeamRegistry) throw new Error('createNationalTeamDutySource: falta "nationalTeamRegistry".');
    requireFunction(resolveItem, 'resolveItem({ windowId, step, item })');
    const fallbackZone = timeZoneId || null;
    return {
      sourceType: SOURCE_TYPES.NATIONAL_TEAM_DUTY,
      listPendingItems() {
        const items = [];
        nationalTeamRegistry.allWindows()
          .filter((window) => window.status !== 'completed' && window.status !== 'cancelled')
          .forEach((window) => {
            const zone = window.timeZoneId || fallbackZone;
            if (!zone) {
              throw new Error(`national-team-duty: la ventana "${window.id}" no declara "timeZoneId" y la fuente no tiene huso por defecto.`);
            }
            [
              ['notice-due', window.noticeDueAt],
              ['preliminary-roster-due', window.preliminaryRosterDueAt],
              ['final-roster-due', window.finalRosterDueAt],
              ['duty-starts', window.dutyStartsAt],
              ['duty-ends', window.dutyEndsAt],
            ]
              .filter(([step]) => !window.hasResolvedStep(step))
              .forEach(([step, instant]) => {
                items.push({
                  sourceId: `${window.id}:${step}`,
                  moment: { precision: 'instant', instant, timeZoneId: zone },
                  // Nunca exige atención del usuario (sección 6 del prompt).
                  attentionScope: { teamIds: [], clubIds: [] },
                  metadata: { kind: 'national-team-duty', step, windowId: window.id },
                });
              });
          });
        return items;
      },
      resolveItem(item) {
        const result = resolveItem({ windowId: item.metadata.windowId, step: item.metadata.step, item });
        const window = nationalTeamRegistry.getWindow(item.metadata.windowId);
        if (window) window.markStepResolved(item.metadata.step);
        return result;
      },
    };
  }

  // =======================================================================
  // Coordinador temporal
  // =======================================================================
  class WorldCalendarCoordinator {
    // `controlledTeamIds`/`controlledClubIds`: identidades que EXIGEN
    // intervención del usuario. `onClockAdvanced(instant)`: hook de avance
    // CONTINUO (desarrollo, entrenamiento, progresión médica) — los eventos
    // DISCRETOS de Market/Transfer/Loan se despachan uno a uno desde sus
    // propios items, nunca con un barrido opaco después de saltar a un
    // partido posterior (sección 12 del prompt).
    constructor({
      calendar, sources, controlledTeamIds, controlledClubIds, onClockAdvanced, maxIterations,
    } = {}) {
      if (!calendar) throw new Error('WorldCalendarCoordinator: falta "calendar" explícito.');
      this.calendar = calendar;
      this._sources = new Map();
      (sources || []).forEach((source) => this.registerSource(source));
      this.controlledTeamIds = new Set(controlledTeamIds || []);
      this.controlledClubIds = new Set(controlledClubIds || []);
      this.onClockAdvanced = onClockAdvanced || null;
      this.maxIterations = Number.isFinite(maxIterations) ? maxIterations : 50000;
    }

    registerSource(source) {
      if (!source || !source.sourceType) throw new Error('WorldCalendarCoordinator.registerSource: fuente sin "sourceType".');
      requireFunction(source.listPendingItems, `${source.sourceType}.listPendingItems`);
      requireFunction(source.resolveItem, `${source.sourceType}.resolveItem`);
      this._sources.set(source.sourceType, source);
      return source;
    }

    get sourceTypes() { return [...this._sources.keys()].sort(); }

    // Sincronización EXPLÍCITA e idempotente de todas las fuentes, en orden
    // estable por `sourceType`. Renderizar/consultar nunca llama aquí: la
    // sincronización solo ocurre en puntos de avance/commit reales.
    sync() {
      this.sourceTypes.forEach((sourceType) => {
        const source = this._sources.get(sourceType);
        this.calendar.syncSource(sourceType, source.listPendingItems());
      });
      return this.calendar.pendingItemsOrdered().length;
    }

    // ¿Este item EXIGE una intervención del usuario?
    //  - partido: alguno de sus dos participantes es un equipo controlado
    //    (un CPU-vs-CPU NUNCA es parada, BUG-WORLDCALENDAR-02);
    //  - evento de mercado: pertenece a un club controlado Y está marcado
    //    `requiresAttention` por MARKET-1 (nunca se inventa aquí).
    //  - transfer/loan: automáticos (su ejecución ya está acordada).
    requiresUser(item) {
      if (item.sourceType === SOURCE_TYPES.COMPETITION_MATCH) {
        const involvesControlled = item.attentionScope.teamIds.some((teamId) => this.controlledTeamIds.has(teamId));
        // WORLD-SIM-1 (DESIGN.md 10.16, sección 12 del prompt): un Team
        // controlado inscrito en una Edition NO "playable" es una
        // configuración inválida — se detecta AQUÍ, antes de avanzar,
        // nunca se autosimula a escondidas (invariante 6).
        if (involvesControlled && item.metadata.detailLevel !== 'playable') {
          throw new Error(
            `WorldCalendarCoordinator: el partido "${item.sourceId}" involucra a un Team controlado pero su Edition `
            + `es "${item.metadata.detailLevel}" (no "playable") — configuración inválida.`,
          );
        }
        return involvesControlled;
      }
      if (item.sourceType === SOURCE_TYPES.MARKET_EVENT) {
        return !!item.metadata.requiresAttention
          && item.attentionScope.clubIds.some((clubId) => this.controlledClubIds.has(clubId));
      }
      return false;
    }

    _advanceClockTo(instant) {
      const moved = this.calendar.advanceTo(instant);
      if (moved && this.onClockAdvanced) this.onClockAdvanced(this.calendar.currentInstant);
      return moved;
    }

    // Dos partidos del MISMO equipo controlado en el MISMO instante: no se
    // elige por id, no se simula ninguno — conflicto VISIBLE con los dos
    // ids/competiciones (invariante 16, sin reprogramación inventada).
    _detectConflict(userItems) {
      const matches = userItems.filter((item) => item.sourceType === SOURCE_TYPES.COMPETITION_MATCH);
      const byTeam = new Map();
      matches.forEach((item) => {
        item.attentionScope.teamIds.filter((teamId) => this.controlledTeamIds.has(teamId)).forEach((teamId) => {
          if (!byTeam.has(teamId)) byTeam.set(teamId, []);
          byTeam.get(teamId).push(item);
        });
      });
      const conflicted = [...byTeam.entries()].filter(([, items]) => items.length > 1)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (!conflicted.length) return null;
      const [teamId, items] = conflicted[0];
      return { teamId, items };
    }

    _resolveGroupAutomatically(group) {
      for (let i = 0; i < group.length; i++) {
        const item = group[i];
        const source = this._sources.get(item.sourceType);
        try {
          source.resolveItem(item);
        } catch (err) {
          // Invariante 17: el item queda `failed`, sigue en la cola y el
          // cursor NO se adelanta por encima de él.
          this.calendar.markFailed(item.id, err.message);
          return {
            type: STOP_TYPES.RESOLUTION_FAILED,
            instant: item.orderingInstant,
            items: [item.toJSON()],
            error: err.message,
          };
        }
        this.calendar.markCompleted(item.id);
      }
      return null;
    }

    // ---------------------------------------------------------------------
    // Semántica exacta de "Continuar" (sección 11 del prompt).
    // ---------------------------------------------------------------------
    advanceUntilNextUserStop() {
      for (let iteration = 0; iteration < this.maxIterations; iteration++) {
        this.sync();
        const group = this.calendar.earliestPendingGroup();
        if (!group.length) {
          return {
            type: STOP_TYPES.SEASON_COMPLETE, instant: this.calendar.currentInstant, items: [], iterations: iteration,
          };
        }
        const instant = group[0].orderingInstant;
        const userItems = group.filter((item) => this.requiresUser(item));

        if (!userItems.length) {
          // Grupo enteramente automático: se avanza el reloj a su instante
          // y se resuelve en orden estable por id.
          this._advanceClockTo(instant);
          const failure = this._resolveGroupAutomatically(group);
          if (failure) return { ...failure, iterations: iteration };
          continue;
        }

        // Hay atención del usuario: se avanza HASTA ella, pero no se
        // resuelve. Los items automáticos del MISMO instante se quedan
        // pendientes a propósito — invariante 15: los resultados CPU
        // simultáneos no se revelan antes del partido del usuario.
        this._advanceClockTo(instant);
        const conflict = this._detectConflict(userItems);
        if (conflict) {
          conflict.items.forEach((item) => this.calendar.markAwaitingUser(item.id));
          return {
            type: STOP_TYPES.SCHEDULE_CONFLICT,
            instant,
            teamId: conflict.teamId,
            items: conflict.items.map((item) => item.toJSON()),
            iterations: iteration,
          };
        }
        // Varias atenciones no deportivas del mismo día se ordenan de forma
        // estable (por id) y ninguna se pierde: se devuelve la primera y el
        // resto sigue pendiente para la siguiente llamada.
        const attention = userItems.find((item) => item.sourceType === SOURCE_TYPES.MARKET_EVENT);
        if (attention) {
          this.calendar.markAwaitingUser(attention.id);
          return {
            type: STOP_TYPES.MARKET_ATTENTION,
            instant,
            items: [attention.toJSON()],
            item: attention,
            iterations: iteration,
          };
        }
        const userMatch = userItems[0];
        this.calendar.markAwaitingUser(userMatch.id);
        return {
          type: STOP_TYPES.USER_MATCH,
          instant,
          items: [userMatch.toJSON()],
          item: userMatch,
          simultaneous: group.filter((other) => other.id !== userMatch.id).map((other) => other.toJSON()),
          iterations: iteration,
        };
      }
      throw new Error(
        `WorldCalendarCoordinator.advanceUntilNextUserStop: superado el límite de ${this.maxIterations} `
        + 'iteraciones sin alcanzar una parada — hay una cola que no progresa.',
      );
    }

    // Tras el COMMIT del partido del usuario: se resuelven los CPU-vs-CPU
    // del MISMO instante, en orden por id, sin avanzar el cursor más allá
    // de ese instante (sección 11 "Simultaneidad").
    resolveSimultaneousAfterUserCommit(instant) {
      const target = GDT().requireInstant(instant);
      this.sync();
      const group = this.calendar.pendingItemsAt(target).filter((item) => !this.requiresUser(item));
      if (!group.length) return { resolved: 0, failure: null };
      const failure = this._resolveGroupAutomatically(group);
      return { resolved: failure ? group.indexOf(this.calendar.getItem(failure.items[0].id)) : group.length, failure };
    }

    // Marca como completado el item del partido que el usuario acaba de
    // jugar — el resultado ya está registrado en `CompetitionEngine`, aquí
    // solo se retira de la cola.
    completeUserItem(itemId) {
      if (!this.calendar.getItem(itemId)) return null;
      return this.calendar.markCompleted(itemId);
    }

    // Próximo item pendiente que EXIGE al usuario, sin resolver nada y sin
    // avanzar el reloj — Home/Agenda/Alineación consultan esto. Requiere
    // que las fuentes ya estén sincronizadas (`sync()` en el último punto
    // de avance real): consultar NUNCA sincroniza mutando a escondidas.
    peekNextUserStopItem() {
      return this.calendar.pendingItemsOrdered().find((item) => this.requiresUser(item)) || null;
    }

    peekNextUserMatchItem() {
      return this.calendar.pendingItemsOrdered()
        .find((item) => item.sourceType === SOURCE_TYPES.COMPETITION_MATCH && this.requiresUser(item)) || null;
    }
  }

  const exportsObj = {
    WorldCalendarCoordinator,
    WORLD_CALENDAR_SOURCE_TYPES: SOURCE_TYPES,
    WORLD_CALENDAR_STOP_TYPES: STOP_TYPES,
    createCompetitionMatchSource,
    createCompetitionSimulationSource,
    createMarketEventSource,
    createTransferEventSource,
    createLoanEventSource,
    createNationalTeamDutySource,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
