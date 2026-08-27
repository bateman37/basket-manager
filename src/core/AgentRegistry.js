// src/core/AgentRegistry.js
// MARKET-1 (DESIGN.md 9.19, sección 9.1 del prompt) — Registro CANÓNICO de
// agentes y mandatos de representación. Instancia EXPLÍCITA por carrera
// (`state.agentRegistry`), NUNCA un singleton — mismo criterio que
// PlayerRegistry/ContractRegistry/RegistrationRegistry. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Solo guarda IDs e instancias vivas de Agent/RepresentationMandate —
// nunca clona Player/Team/Contract, nunca vive un `player.agentId` mutable
// en Player.js (sección 8.2: "varios mandatos solo se admiten si sus
// ámbitos no chocan; no reduzcas el mundo a un player.agentId mutable").

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const PlayerModule = isNode ? require('../entities/Player.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function stableByStartDateThenId(list) {
    return [...list].sort((a, b) => {
      if (a.startDate !== b.startDate) return LD().compare(a.startDate, b.startDate);
      return a.id < b.id ? -1 : 1;
    });
  }

  class AgentRegistry {
    constructor() {
      this._agents = new Map();
      this._mandates = new Map();
      this._mandatesByClient = new Map(); // `${clientType}:${clientId}` -> [mandateId]
      this._mandatesByAgent = new Map(); // agentId -> [mandateId]
    }

    // --- Agentes -----------------------------------------------------
    registerAgent(agent) {
      const existing = this._agents.get(agent.id);
      if (existing && existing !== agent) {
        throw new Error(`AgentRegistry: ya existe un Agent distinto con id "${agent.id}".`);
      }
      this._agents.set(agent.id, agent);
      return agent;
    }

    getAgent(id) { return this._agents.get(id) || null; }

    requireAgent(id) {
      const agent = this.getAgent(id);
      if (!agent) throw new Error(`AgentRegistry: no existe el Agent "${id}".`);
      return agent;
    }

    allAgents() { return [...this._agents.values()].sort((a, b) => (a.id < b.id ? -1 : 1)); }

    // --- Mandatos ------------------------------------------------------
    registerMandate(mandate) {
      const existing = this._mandates.get(mandate.id);
      if (existing && existing !== mandate) {
        throw new Error(`AgentRegistry: ya existe un RepresentationMandate distinto con id "${mandate.id}".`);
      }
      this._mandates.set(mandate.id, mandate);
      const clientKey = `${mandate.clientType}:${mandate.clientId}`;
      const byClient = this._mandatesByClient.get(clientKey) || [];
      if (!byClient.includes(mandate.id)) byClient.push(mandate.id);
      this._mandatesByClient.set(clientKey, byClient);
      const byAgent = this._mandatesByAgent.get(mandate.agentId) || [];
      if (!byAgent.includes(mandate.id)) byAgent.push(mandate.id);
      this._mandatesByAgent.set(mandate.agentId, byAgent);
      return mandate;
    }

    getMandate(id) { return this._mandates.get(id) || null; }

    requireMandate(id) {
      const mandate = this.getMandate(id);
      if (!mandate) throw new Error(`AgentRegistry: no existe el RepresentationMandate "${id}".`);
      return mandate;
    }

    mandatesForClient(clientType, clientId) {
      const ids = this._mandatesByClient.get(`${clientType}:${clientId}`) || [];
      return stableByStartDateThenId(ids.map((id) => this._mandates.get(id)));
    }

    mandatesForAgent(agentId) {
      const ids = this._mandatesByAgent.get(agentId) || [];
      return stableByStartDateThenId(ids.map((id) => this._mandates.get(id)));
    }

    allMandates() { return stableByStartDateThenId([...this._mandates.values()]); }

    // Mandatos de un jugador ACTIVOS en la fecha dada, opcionalmente
    // filtrados por ámbito (sección 8.2: un jugador puede tener varios
    // mandatos vivos siempre que sus ámbitos no choquen).
    activeMandatesForPlayer(playerId, date, scope) {
      const iso = toIso(date);
      return this.mandatesForClient('player', playerId)
        .filter((m) => m.isActiveOn(iso))
        .filter((m) => !scope || m.scope === scope);
    }

    // El mandato que ACTÚA en una transacción concreta (sección 8.4: "un
    // hilo identifica el mandato concreto que actúa") — determinista:
    // prioriza mandatos EXCLUSIVOS sobre no exclusivos, y entre iguales el
    // de `startDate` más reciente (el más nuevo formalizado gana).
    actingMandateForTransaction({ playerId, date, scope }) {
      const active = this.activeMandatesForPlayer(playerId, date, scope);
      if (!active.length) return null;
      const exclusive = active.filter((m) => m.exclusive);
      const pool = exclusive.length ? exclusive : active;
      return pool.reduce((best, m) => (LD().isAfter(m.startDate, best.startDate) ? m : best), pool[0]);
    }

    // Sección 6.1 FIBA: un agente no puede representar a dos partes de la
    // misma operación, ni a un club si mantiene contrato vigente con un
    // jugador YA inscrito en ese club. `deps`: { registrationRegistry,
    // contractRegistry, date } — opcional; sin ellas solo se comprueba el
    // conflicto directo agente-cliente-cliente.
    validateConflictOfInterest({
      agentId, playerId, involvedClubId, date,
    }, deps) {
      const errors = [];
      const iso = toIso(date);
      const agentMandates = this.mandatesForAgent(agentId).filter((m) => m.isActiveOn(iso));

      // No puede representar al CLUB de esta operación y al JUGADOR a la
      // vez (sección 6.1: "no puede representar o asesorar a más de una
      // parte en la misma operación").
      const representsClub = agentMandates.some((m) => m.clientType === 'club' && m.clientId === involvedClubId);
      const representsPlayer = agentMandates.some((m) => m.clientType === 'player' && m.clientId === playerId);
      if (representsClub && representsPlayer) {
        errors.push(`El agente "${agentId}" representaría a la vez al club "${involvedClubId}" y al jugador "${playerId}" en la misma operación.`);
      }

      // No puede representar al club si tiene mandato vigente con un
      // jugador YA afiliado a ese club (sección 6.1) — afiliación real
      // (`player.teamId`), nunca inscripción de partido (ámbito distinto).
      if (representsClub && deps && deps.playerRegistry) {
        const playerMandates = agentMandates.filter((m) => m.clientType === 'player');
        const conflictingMandate = playerMandates.find((m) => {
          const player = deps.playerRegistry.get(m.clientId);
          return player && player.teamId === involvedClubId;
        });
        if (conflictingMandate) {
          errors.push(
            `El agente "${agentId}" representaría al club "${involvedClubId}" mientras mantiene mandato con un `
            + `jugador ya afiliado a ese mismo club (mandato "${conflictingMandate.id}").`,
          );
        }
      }

      return { valid: errors.length === 0, errors };
    }

    // Informe de integridad — NUNCA lanza (mismo criterio que
    // ContractRegistry/RegistrationRegistry).
    validateIntegrity(options) {
      const opts = options || {};
      const { playerRegistry, teams, date } = opts;
      const errors = [];
      const warnings = [];
      const iso = date ? toIso(date) : null;
      const teamIds = new Set((teams || []).map((t) => t.id));

      this.allMandates().forEach((mandate) => {
        if (!this._agents.has(mandate.agentId)) {
          errors.push(`El mandato "${mandate.id}" referencia al agente "${mandate.agentId}", inexistente.`);
        }
        if (mandate.clientType === 'player' && playerRegistry && !playerRegistry.has(mandate.clientId)) {
          errors.push(`El mandato "${mandate.id}" referencia al jugador "${mandate.clientId}", ausente de PlayerRegistry.`);
        }
        if (mandate.clientType === 'club' && teams && !teamIds.has(mandate.clientId)) {
          errors.push(`El mandato "${mandate.id}" referencia al club "${mandate.clientId}", ausente de los equipos vivos.`);
        }
      });

      // Menores nunca reciben captación (sección 8.2) — comprobado solo
      // si se pasa playerRegistry con fecha de nacimiento resoluble.
      // `calculateAge(birthDate, referenceDate)` toma la fecha EXPLÍCITA
      // de este informe, nunca `player.age` (que lee `new Date()` real —
      // prohibido dentro del core, sección 15.2 del prompt).
      if (playerRegistry && iso) {
        const referenceDate = LD().toJsDate(iso);
        this.allMandates().filter((m) => m.clientType === 'player').forEach((mandate) => {
          const player = playerRegistry.get(mandate.clientId);
          if (player && player.birthDate) {
            const age = PlayerModule.calculateAge(player.birthDate, referenceDate);
            if (age !== null && age < 18 && LD().compare(mandate.startDate, iso) <= 0) {
              errors.push(`El mandato "${mandate.id}" representa a un menor de edad ("${mandate.clientId}") en vigor a ${iso}.`);
            }
          }
        });
      }

      // Doble representación estructural (mismo agente, cliente club Y
      // jugador de ese club, vigentes a la vez) — auditoría global, no
      // solo por transacción concreta.
      const byAgent = new Map();
      this.allMandates().forEach((m) => {
        const list = byAgent.get(m.agentId) || [];
        list.push(m);
        byAgent.set(m.agentId, list);
      });
      byAgent.forEach((mandates, agentId) => {
        if (!iso) return;
        const activeClubs = mandates.filter((m) => m.clientType === 'club' && m.isActiveOn(iso)).map((m) => m.clientId);
        const activePlayers = mandates.filter((m) => m.clientType === 'player' && m.isActiveOn(iso));
        if (activeClubs.length && activePlayers.length) {
          warnings.push(`El agente "${agentId}" mantiene mandatos activos con club(es) ${activeClubs.join(', ')} y con jugador(es) simultáneamente a ${iso} — revisar conflicto de interés antes de actuar en cualquier operación entre ellos.`);
        }
      });

      return { valid: errors.length === 0, errors, warnings };
    }

    snapshot() {
      return { agents: this.allAgents().length, mandates: this.allMandates().length };
    }
  }

  const exportsObj = { AgentRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
