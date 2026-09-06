// src/entities/Squad.js
// CLUB-CORE-1 (DESIGN.md sección 10) — `Squad`: contenedor OPERATIVO actual
// de jugadores de un `Team`. No es un club, no es una competición, no es una
// inscripción federativa y no crea otra instancia de `Player` — envuelve
// SIEMPRE las mismas instancias ya registradas en `PlayerRegistry` (mismo
// criterio que `Team.roster` antes de esta entrega). Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// `Team.roster` pasa a ser una VISTA de compatibilidad del squad activo de
// ese equipo (ver `src/entities/Team.js`) — Squad es la única fuente de
// verdad de qué jugadores están afiliados operativamente a un Team; no
// existe un array canónico paralelo en Team.

(function (global) {
  const SQUAD_STATUSES = ['active', 'inactive', 'historical', 'fictional-test'];

  class Squad {
    constructor(data = {}) {
      if (!data.id) throw new Error('Squad: falta "id".');
      if (!data.teamId) throw new Error(`Squad "${data.id}": falta "teamId".`);
      this.id = data.id;
      this.teamId = data.teamId;
      this.name = data.name || this.id;
      // Rol explícito coherente con el equipo (DESIGN.md 5.3) — por ahora
      // "un equipo activo tiene exactamente un squad operativo activo", así
      // que el valor por defecto asume la plantilla senior principal.
      this.squadType = data.squadType || 'first-team-senior';
      this.status = data.status || 'active';
      if (!SQUAD_STATUSES.includes(this.status)) {
        throw new Error(`Squad "${data.id}": status "${this.status}" no válido — debe ser una de ${SQUAD_STATUSES.join(', ')}.`);
      }
      // Colección VIVA de instancias REALES de Player (nunca clones ni
      // objetos planos) — mismo criterio que `PlayerRegistry`/`Team.roster`
      // antes de esta entrega. `Team.roster` es una VISTA de este mismo
      // array (misma referencia), nunca una copia independiente.
      this.players = Array.isArray(data.players) ? [...data.players] : [];
      this.dataSource = data.dataSource || null;
      this.provenance = data.provenance || null;
    }

    hasPlayer(playerId) {
      return this.players.some((player) => player.id === playerId);
    }

    addPlayer(player) {
      if (this.hasPlayer(player.id)) {
        throw new Error(`Squad "${this.id}": el jugador "${player.id}" ya está en este squad.`);
      }
      this.players.push(player);
    }

    // Devuelve `true` si el jugador estaba y se ha retirado.
    removePlayer(playerId) {
      const before = this.players.length;
      this.players = this.players.filter((player) => player.id !== playerId);
      return this.players.length !== before;
    }

    // Serialización por ids (DESIGN.md 5.3: "Squad.toJSON() serializa
    // playerIds, no jugadores embebidos") — nunca una segunda copia de los
    // datos completos del jugador (esos ya viven en PlayerRegistry).
    toJSON() {
      return {
        id: this.id,
        teamId: this.teamId,
        name: this.name,
        squadType: this.squadType,
        status: this.status,
        playerIds: this.players.map((player) => player.id),
        dataSource: this.dataSource,
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = { Squad, SQUAD_STATUSES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
