// src/core/AcademyRegistry.js
// CYCLE-1 (DESIGN.md 9.22, sección 13 del prompt) — registro CANÓNICO de la
// pertenencia a academia. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Sustituye el placeholder de DESIGN.md 6.2.3 (`Team.generateAcademyIntake(3)`
// directo al primer equipo, BUG-CYCLE1-05: ~108 seniors nuevos por cierre
// sin ninguna salida equivalente).
//
// Reglas de dominio permanentes:
//  - la academia es un POOL SEPARADO del primer equipo: mientras un joven
//    solo esté aquí, `player.teamId === null`, NO está en `Team.roster`, NO
//    tiene contrato profesional y NO tiene licencia/inscripción senior;
//  - `AcademyMembership` es la ÚNICA fuente de pertenencia — nunca un campo
//    `player.academyClubId` ni un array en `Team` (prohibidos y auditados);
//  - el club recupera su cantera por ESTE registro, nunca recorriendo
//    rosters;
//  - estar en academia NO marca a nadie como jugador de formación: se
//    registran periodos formativos REALES simulados y
//    `RegulatoryClassificationService` decide después si cumplen el ruleset
//    de una competición/temporada.
//
// Instancia EXPLÍCITA por carrera (`state.academyRegistry`), nunca un
// singleton. Módulo puro: no lee DOM ni `state`.

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

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  class AcademyRegistry {
    constructor() {
      this._memberships = new Map();
      this._byClub = new Map();
      this._byPlayer = new Map();
      this._decisions = new Map();
      this._decisionsByMembership = new Map();
    }

    registerMembership(membership) {
      if (!membership || !membership.id) {
        throw new Error('AcademyRegistry.registerMembership: la pertenencia debe tener un id válido.');
      }
      const existing = this._memberships.get(membership.id);
      if (existing && existing !== membership) {
        throw new Error(`AcademyRegistry.registerMembership: ya existe una pertenencia distinta con id "${membership.id}".`);
      }
      if (existing === membership) return membership;
      // Un jugador NUNCA pertenece a dos academias a la vez.
      const liveElsewhere = this.membershipsForPlayer(membership.playerId)
        .find((entry) => entry.currentStatus() === 'active' || entry.currentStatus() === 'agedOut'
          || entry.currentStatus() === 'promotionAgreed' || entry.currentStatus() === 'promotedPendingRegistration');
      if (liveElsewhere) {
        throw new Error(
          `AcademyRegistry.registerMembership: el jugador "${membership.playerId}" ya tiene una pertenencia viva `
          + `("${liveElsewhere.id}", club "${liveElsewhere.clubId}") — nadie está en dos academias a la vez.`,
        );
      }
      this._memberships.set(membership.id, membership);
      pushIndex(this._byClub, membership.clubId, membership.id);
      pushIndex(this._byPlayer, membership.playerId, membership.id);
      return membership;
    }

    unregisterMembership(id) {
      const membership = this._memberships.get(id);
      if (!membership) return false;
      this._memberships.delete(id);
      dropIndex(this._byClub, membership.clubId, id);
      dropIndex(this._byPlayer, membership.playerId, id);
      return true;
    }

    getMembership(id) { return this._memberships.get(id) || null; }

    requireMembership(id) {
      const membership = this.getMembership(id);
      if (!membership) throw new Error(`AcademyRegistry.requireMembership: no existe la pertenencia "${id}".`);
      return membership;
    }

    membershipsForClub(clubId) {
      return byId((this._byClub.get(clubId) || []).map((id) => this._memberships.get(id)));
    }

    membershipsForPlayer(playerId) {
      return byId((this._byPlayer.get(playerId) || []).map((id) => this._memberships.get(id)));
    }

    // Pool ACTIVO de un club en una fecha — la consulta que usa la interfaz
    // y el planificador CPU (nunca recorrer `Team.roster`).
    activePoolForClub(clubId, date) {
      const iso = toIso(date);
      return this.membershipsForClub(clubId).filter((entry) => entry.isActiveOn(iso));
    }

    activeMembershipForPlayer(playerId, date) {
      const iso = toIso(date);
      return this.membershipsForPlayer(playerId).find((entry) => entry.isActiveOn(iso)) || null;
    }

    allMemberships() { return byId([...this._memberships.values()]); }

    // Consulta DERIVADA: ¿está este jugador en una academia ahora?
    isInAcademyOn(playerId, date) {
      return Boolean(this.activeMembershipForPlayer(playerId, date));
    }

    registerDecision(decision) {
      if (!decision || !decision.id) throw new Error('AcademyRegistry.registerDecision: id inválido.');
      const existing = this._decisions.get(decision.id);
      if (existing && existing !== decision) {
        throw new Error(`AcademyRegistry.registerDecision: ya existe una decisión distinta con id "${decision.id}".`);
      }
      this._decisions.set(decision.id, decision);
      pushIndex(this._decisionsByMembership, decision.membershipId, decision.id);
      return decision;
    }

    unregisterDecision(id) {
      const decision = this._decisions.get(id);
      if (!decision) return false;
      this._decisions.delete(id);
      dropIndex(this._decisionsByMembership, decision.membershipId, id);
      return true;
    }

    getDecision(id) { return this._decisions.get(id) || null; }

    decisionsForMembership(membershipId) {
      return byId((this._decisionsByMembership.get(membershipId) || []).map((id) => this._decisions.get(id)));
    }

    allDecisions() { return byId([...this._decisions.values()]); }

    // Periodos formativos SIMULADOS de un jugador — evidencia que
    // `RegulatoryClassificationService` puede evaluar después. Nunca
    // devuelve "es de formación": devuelve los PERIODOS reales.
    formationPeriodsForPlayer(playerId) {
      return this.membershipsForPlayer(playerId)
        .reduce((acc, membership) => acc.concat(membership.formationPeriods.map((p) => ({ ...p, membershipId: membership.id }))), [])
        .sort((a, b) => LD().compare(a.fromDate, b.fromDate));
    }

    validateIntegrity(options) {
      const { playerRegistry, teams, date } = options || {};
      const errors = [];
      const teamIds = new Set((teams || []).map((team) => team.id));
      const iso = date ? toIso(date) : null;
      const rosterByPlayerId = new Map();
      (teams || []).forEach((team) => team.roster.forEach((player) => rosterByPlayerId.set(player.id, team.id)));

      this.allMemberships().forEach((membership) => {
        if (playerRegistry && !playerRegistry.has(membership.playerId)) {
          errors.push(`La pertenencia "${membership.id}" referencia al jugador "${membership.playerId}", que no está en PlayerRegistry.`);
        }
        if (teams && !teamIds.has(membership.clubId)) {
          errors.push(`La pertenencia "${membership.id}" referencia el club "${membership.clubId}", inexistente entre los equipos vivos.`);
        }
        if (iso && membership.isActiveOn(iso) && rosterByPlayerId.has(membership.playerId)) {
          // Un joven de academia NO está en el roster senior sin promoción
          // comprometida (invariante 8 del prompt).
          const status = membership.currentStatus();
          if (status !== 'promotionAgreed' && status !== 'promotedPendingRegistration') {
            errors.push(
              `El jugador "${membership.playerId}" tiene pertenencia de academia ACTIVA ("${membership.id}") y además `
              + `está en la plantilla senior de "${rosterByPlayerId.get(membership.playerId)}" sin promoción comprometida.`,
            );
          }
        }
        membership.formationPeriods.forEach((period) => {
          if (period.toDate && LD().isBefore(period.toDate, period.fromDate)) {
            errors.push(`La pertenencia "${membership.id}" tiene un periodo formativo con toDate anterior a fromDate.`);
          }
        });
      });

      // Un jugador con más de una pertenencia VIVA es invariante roto.
      [...this._byPlayer.keys()].forEach((playerId) => {
        const live = this.membershipsForPlayer(playerId).filter((entry) => {
          const status = entry.currentStatus();
          return status === 'active' || status === 'agedOut' || status === 'promotionAgreed' || status === 'promotedPendingRegistration';
        });
        if (live.length > 1) {
          errors.push(`El jugador "${playerId}" tiene ${live.length} pertenencias de academia vivas a la vez.`);
        }
      });

      errors.push(...auditIndexSymmetry('_byClub', this._byClub, this._memberships));
      errors.push(...auditIndexSymmetry('_byPlayer', this._byPlayer, this._memberships));
      errors.push(...auditIndexSymmetry('_decisionsByMembership', this._decisionsByMembership, this._decisions));

      return { valid: errors.length === 0, errors };
    }

    snapshot() {
      return {
        memberships: this.allMemberships().map((m) => ({
          id: m.id, playerId: m.playerId, clubId: m.clubId, status: m.currentStatus(), joinedAt: m.joinedAt,
        })),
        decisions: this.allDecisions().map((d) => ({
          id: d.id, playerId: d.playerId, clubId: d.clubId, outcome: d.outcome, decidedAt: d.decidedAt,
        })),
      };
    }
  }

  const exportsObj = { AcademyRegistry };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
