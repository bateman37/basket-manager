// src/core/ContractRegistry.js
// CONTRACT-1 (DESIGN.md 9.17) — Registro contractual de la partida: fuente
// CANÓNICA de contratos. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Mismo principio que PlayerRegistry (ROSTER-1): la partida posee una
// instancia EXPLÍCITA (`state.contractRegistry`, construida en
// `startSeason()`), nunca un singleton oculto en `window`. Dos partidas o
// dos tests tienen registros independientes.
//
// Reglas de dominio (secciones 6.2 y 7.1 del prompt de CONTRACT-1):
//  - `Player` NO contiene un clon del contrato ni un `currentContract`
//    mutable duplicado; `Team` no tiene un array paralelo de contratos;
//  - las relaciones se guardan por `playerId`/`clubId` y se resuelven
//    contra PlayerRegistry/equipos;
//  - "contrato actual", "contratos del club" y "nómina" son consultas
//    DERIVADAS, nunca índices que puedan desincronizarse;
//  - un contrato expirado/terminado/anulado SIGUE en el registro (historial);
//  - dos contratos nunca comparten id, y un mismo jugador nunca tiene dos
//    contratos solapados.
//
// Módulo puro: no lee DOM, ni `state`, ni variables globales.

(function (global) {
  const LocalDateModule = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/LocalDate.js')
    : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function toIso(date) {
    if (!date) throw new Error('ContractRegistry: hace falta una fecha para resolver el estado de un contrato.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  class ContractRegistry {
    constructor() {
      this._contracts = new Map(); // contractId -> instancia viva de Contract
      this._byPlayer = new Map(); // playerId -> [contractId]
      this._byClub = new Map(); // clubId -> [contractId]
    }

    register(contract) {
      if (!contract || !contract.id) {
        throw new Error('ContractRegistry.register: el contrato debe tener un id válido y no vacío.');
      }
      const existing = this._contracts.get(contract.id);
      if (existing && existing !== contract) {
        throw new Error(
          `ContractRegistry.register: ya existe un contrato distinto con id "${contract.id}" `
          + '(dos contratos nunca comparten id).',
        );
      }
      if (existing === contract) return contract; // idempotente

      // Ningún jugador puede tener dos contratos SOLAPADOS (fechas
      // inclusivas): ni parcial, ni total, ni tocándose en el día límite.
      const overlapping = this.forPlayer(contract.playerId)
        .find((other) => other.overlaps(contract) && !isClosedBefore(other, contract));
      if (overlapping) {
        throw new Error(
          `ContractRegistry.register: el jugador "${contract.playerId}" ya tiene el contrato `
          + `"${overlapping.id}" (${overlapping.startDate}..${overlapping.endDate}) solapado con `
          + `"${contract.id}" (${contract.startDate}..${contract.endDate}).`,
        );
      }

      this._contracts.set(contract.id, contract);
      pushIndex(this._byPlayer, contract.playerId, contract.id);
      pushIndex(this._byClub, contract.clubId, contract.id);
      return contract;
    }

    registerMany(contracts) {
      (contracts || []).forEach((contract) => this.register(contract));
      return contracts || [];
    }

    get(contractId) {
      return this._contracts.get(contractId) || null;
    }

    require(contractId) {
      const contract = this.get(contractId);
      if (!contract) {
        throw new Error(`ContractRegistry.require: no existe ningún contrato registrado con id "${contractId}".`);
      }
      return contract;
    }

    has(contractId) { return this._contracts.has(contractId); }

    get size() { return this._contracts.size; }

    all() { return [...this._contracts.values()]; }

    // Histórico ORDENADO de forma estable: por fecha de inicio, y a igualdad
    // por fecha de firma e id (nunca por orden de inserción del Map).
    forPlayer(playerId) {
      return (this._byPlayer.get(playerId) || [])
        .map((id) => this._contracts.get(id))
        .sort(stableContractOrder);
    }

    forClub(clubId) {
      return (this._byClub.get(clubId) || [])
        .map((id) => this._contracts.get(id))
        .sort(stableContractOrder);
    }

    // Contrato VIGENTE o PENDIENTE de un jugador en una fecha — como mucho
    // uno (los solapamientos están prohibidos al registrar).
    currentForPlayer(playerId, date) {
      const iso = toIso(date);
      return this.forPlayer(playerId).find((contract) => contract.isCurrentOn(iso)) || null;
    }

    activeForClub(clubId, date) {
      const iso = toIso(date);
      return this.forClub(clubId).filter((contract) => contract.isCurrentOn(iso));
    }

    // Contratos que cubren una temporada concreta (para nómina/compromisos
    // futuros), estén ya vigentes o todavía pendientes.
    forClubInSeason(clubId, seasonKey) {
      return this.forClub(clubId).filter((contract) => (
        contract.coveredSeasonKeys.includes(seasonKey)
        && !contract.lifecycleEvents.some((e) => e.type === 'voided')
      ));
    }

    // Informe de integridad — NUNCA lanza por sí solo (mismo criterio que
    // `PlayerRegistry.validateAgainstTeams`): devuelve todo lo que no cuadra.
    validateIntegrity(options) {
      const { playerRegistry, teams, date } = options || {};
      const errors = [];
      const iso = date ? toIso(date) : null;
      const teamIds = new Set((teams || []).map((team) => team.id));

      this.all().forEach((contract) => {
        if (playerRegistry && !playerRegistry.has(contract.playerId)) {
          errors.push(`El contrato "${contract.id}" referencia al jugador "${contract.playerId}", que no está en PlayerRegistry.`);
        }
        if (teams && !teamIds.has(contract.clubId)) {
          errors.push(`El contrato "${contract.id}" referencia al club "${contract.clubId}", que no existe entre los equipos vivos.`);
        }
        const scheduleCheck = contract.validatePaymentScheduleIntegrity();
        if (!scheduleCheck.valid) {
          scheduleCheck.errors.forEach((error) => errors.push(`Contrato "${contract.id}": ${error}`));
        }
      });

      // Ningún jugador con dos contratos solapados.
      [...this._byPlayer.keys()].forEach((playerId) => {
        const contracts = this.forPlayer(playerId);
        for (let i = 0; i < contracts.length; i += 1) {
          for (let j = i + 1; j < contracts.length; j += 1) {
            if (contracts[i].overlaps(contracts[j]) && !isClosedBefore(contracts[i], contracts[j])) {
              errors.push(
                `El jugador "${playerId}" tiene contratos solapados: "${contracts[i].id}" `
                + `(${contracts[i].startDate}..${contracts[i].endDate}) y "${contracts[j].id}" `
                + `(${contracts[j].startDate}..${contracts[j].endDate}).`,
              );
            }
          }
        }
      });

      // Cada jugador AFILIADO a un club debe tener exactamente un contrato
      // vigente/pendiente compatible con ese club (invariante 16 del
      // prompt). Un jugador SIN club puede no tener ninguno (invariante 17).
      if (iso && teams) {
        (teams || []).forEach((team) => {
          team.roster.forEach((player) => {
            const current = this.currentForPlayer(player.id, iso);
            if (!current) {
              errors.push(
                `El jugador "${player.id}" (${player.fullName || '?'}) está en la plantilla de `
                + `"${team.fullName || team.id}" pero no tiene ningún contrato vigente ni pendiente a ${iso}.`,
              );
            } else if (current.clubId !== team.id) {
              errors.push(
                `El jugador "${player.id}" está en la plantilla de "${team.id}" pero su contrato vigente `
                + `("${current.id}") es con "${current.clubId}".`,
              );
            }
          });
        });
      }

      return { valid: errors.length === 0, errors };
    }

    // Resumen por estado, útil para el smoke y la pantalla de Contratos.
    countByStatus(date) {
      const iso = toIso(date);
      return this.all().reduce((acc, contract) => {
        const status = contract.statusOn(iso);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
    }

    // Snapshot MÍNIMO (como `PlayerRegistry.snapshot()`): NO es un sistema
    // de guardado (eso es HARDEN-1).
    snapshot() {
      return this.all().map((contract) => ({
        id: contract.id, playerId: contract.playerId, clubId: contract.clubId,
        startDate: contract.startDate, endDate: contract.endDate,
      }));
    }
  }

  function pushIndex(map, key, value) {
    const list = map.get(key) || [];
    list.push(value);
    map.set(key, list);
  }

  function stableContractOrder(a, b) {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
    if (a.signedDate !== b.signedDate) return a.signedDate < b.signedDate ? -1 : 1;
    // Desempate por jugador y luego por id: los contratos del seeder tienen
    // id determinista, así que el orden es reproducible entre carreras.
    if (a.playerId !== b.playerId) return a.playerId < b.playerId ? -1 : 1;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  // Un contrato TERMINADO o ANULADO antes del inicio del siguiente ya no
  // ocupa esas fechas: el solapamiento se mide contra la vigencia REAL.
  //
  // TRANSFER-1 (DESIGN.md 9.20, sección 14.1 del prompt): la comparación es
  // INCLUSIVA (`closing.date <= incoming.startDate`), no estrictamente
  // anterior — un traspaso/rescisión/mutuo acuerdo con fecha de efecto
  // civil única extingue el contrato de origen y arranca el nuevo el MISMO
  // día (ACB Normas Internas art. 14.7: "documento extintivo y acuerdo de
  // traspaso en la misma fecha de efecto"). Con la comparación estricta
  // anterior, ningún traspaso con handoff el mismo día podía registrar su
  // contrato nuevo: `ContractRegistry.register()` lo rechazaba como
  // solapado contra un contrato que en realidad ya estaba cerrado.
  function isClosedBefore(existing, incoming) {
    const closing = existing.lifecycleEvents
      .filter((e) => e.type === 'terminated' || e.type === 'voided')
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    if (!closing) return false;
    return !LD().isAfter(closing.date, incoming.startDate);
  }

  const exportsObj = { ContractRegistry };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
