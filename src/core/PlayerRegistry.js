// src/core/PlayerRegistry.js
// ROSTER-1 (DESIGN.md 9.16) — Registro mundial único de jugadores.
// Convención del proyecto: identificadores en inglés, comentarios en español.
//
// Principio de dominio (ver DESIGN.md 9.16): un `Player` pertenece al MUNDO
// de la partida, no a un array concreto. `Team.roster` sigue siendo la
// afiliación deportiva ACTUAL de un jugador, pero deja de ser el único
// sitio donde se le puede encontrar — quitar a un jugador de una plantilla
// (CONTRACT-1/MARKET-1/TRANSFER-1, todavía no implementado) nunca debe
// volverlo ilocalizable ni destruir su instancia/histórico.
//
// Módulo puro: no conoce Team ni Player como clases (duck typing sobre
// `player.id`/`player.teamId`/`player.fullName`), no simula contratos ni
// licencias (eso es CONTRACT-1/REG-1), y no sustituye a `Team.roster` como
// fuente de verdad de la alineación deportiva — `forTeam()` es una vista
// DERIVADA, nunca un segundo índice que se pueda desincronizar por su
// cuenta.

(function (global) {
  class PlayerRegistry {
    constructor() {
      this._players = new Map(); // playerId -> instancia viva de Player
    }

    // Indexa la MISMA instancia recibida — nunca clona ni serializa. Un id
    // vacío o `undefined` se rechaza (nunca se genera uno aquí: la
    // identidad la decide quien crea al jugador, Player.js). Registrar dos
    // veces la MISMA instancia es idempotente (no es un error: sirve para
    // llamadores defensivos); registrar un id ya ocupado por OTRA instancia
    // sí se rechaza — nunca hay dos jugadores distintos bajo el mismo id.
    register(player) {
      if (!player || !player.id) {
        throw new Error('PlayerRegistry.register: el jugador debe tener un id válido y no vacío.');
      }
      const existing = this._players.get(player.id);
      if (existing && existing !== player) {
        throw new Error(
          `PlayerRegistry.register: ya existe un jugador distinto registrado con id "${player.id}" `
          + `(intento de registrar a "${player.fullName || '?'}" sobre "${existing.fullName || '?'}").`,
        );
      }
      this._players.set(player.id, player);
      return player;
    }

    registerMany(players) {
      (players || []).forEach((player) => this.register(player));
      return players || [];
    }

    // Devuelve la instancia o `null` — funciona igual con `teamId === null`
    // (jugador sin club, DESIGN.md 9.16), nunca filtra por afiliación.
    get(playerId) {
      return this._players.get(playerId) || null;
    }

    // Como `get()`, pero lanza con mensaje descriptivo si no existe — para
    // puntos de la app donde un id ausente es un error de programación, no
    // un caso a degradar (a diferencia de la ficha universal de game.js,
    // que sí debe degradar con "Jugador no encontrado" y usa `get()`).
    require(playerId) {
      const player = this.get(playerId);
      if (!player) {
        throw new Error(`PlayerRegistry.require: no existe ningún jugador registrado con id "${playerId}".`);
      }
      return player;
    }

    has(playerId) {
      return this._players.has(playerId);
    }

    // Sin duplicados por construcción (clave del Map = playerId).
    all() {
      return [...this._players.values()];
    }

    // Vista DERIVADA por afiliación actual — nunca se guarda aparte ni se
    // actualiza de forma incremental: siempre se recalcula desde `all()`,
    // para que no pueda desincronizarse de `player.teamId`/`Team.roster`.
    forTeam(teamId) {
      return this.all().filter((player) => player.teamId === teamId);
    }

    // Sincronización EXPLÍCITA de afiliación (sección 4.2: "actualizar/
    // sincronizar afiliación de forma explícita"). No toca `Team.roster`
    // por su cuenta — quien llama es responsable de mantener coherencia con
    // el array real de la plantilla (hasta que exista un servicio/
    // orquestador explícito de fichajes en CONTRACT-1/MARKET-1/TRANSFER-1,
    // ver DESIGN.md 9.16).
    setAffiliation(playerId, teamIdOrNull) {
      const player = this.require(playerId);
      player.teamId = teamIdOrNull;
      return player;
    }

    get size() {
      return this._players.size;
    }

    // Informe de integridad (sección 4.2/9, para tests y diagnóstico) —
    // nunca lanza por sí solo: compara este registro contra el roster REAL
    // de los equipos vivos y devuelve todas las incoherencias encontradas.
    // Detecta: jugador en un roster pero no registrado; misma id
    // registrada pero con una instancia DISTINTA a la del roster;
    // `teamId` incoherente con el roster donde aparece; el mismo jugador en
    // más de una plantilla a la vez; y un jugador registrado con
    // `teamId` no nulo que no aparece en ningún roster vivo.
    validateAgainstTeams(teams) {
      const errors = [];
      const seenInRosters = new Map(); // playerId -> teamId del primer roster donde aparece esta pasada

      (teams || []).forEach((team) => {
        team.roster.forEach((player) => {
          if (!this.has(player.id)) {
            errors.push(
              `Jugador "${player.id}" (${player.fullName || '?'}) está en la plantilla de `
              + `"${team.fullName || team.id}" pero no está registrado en PlayerRegistry.`,
            );
            return;
          }
          const registered = this.get(player.id);
          if (registered !== player) {
            errors.push(
              `Jugador "${player.id}": la instancia en la plantilla de "${team.fullName || team.id}" `
              + 'no es la misma instancia que la registrada en PlayerRegistry.',
            );
          }
          if (player.teamId !== team.id) {
            errors.push(
              `Jugador "${player.id}" (${player.fullName || '?'}): teamId="${player.teamId}" no coincide `
              + `con el equipo en cuya plantilla está ("${team.id}").`,
            );
          }
          if (seenInRosters.has(player.id)) {
            errors.push(
              `Jugador "${player.id}" (${player.fullName || '?'}) aparece en más de una plantilla a la vez: `
              + `"${seenInRosters.get(player.id)}" y "${team.id}".`,
            );
          } else {
            seenInRosters.set(player.id, team.id);
          }
        });
      });

      this.all().forEach((player) => {
        if (player.teamId && !seenInRosters.has(player.id)) {
          errors.push(
            `Jugador "${player.id}" (${player.fullName || '?'}) tiene teamId="${player.teamId}" pero no `
            + 'aparece en la plantilla de ningún equipo vivo de la lista recibida.',
          );
        }
      });

      return { valid: errors.length === 0, errors };
    }

    // Snapshot MÍNIMO (sección 4.2: explícitamente NO es un sistema de
    // save/load) — solo identidad + afiliación, útil para comparar
    // "antes/después" en tests (cantera, liberación, reincorporación) sin
    // serializar el estado completo de cada Player.
    snapshot() {
      return this.all().map((player) => ({ id: player.id, teamId: player.teamId }));
    }
  }

  const exportsObj = { PlayerRegistry };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
