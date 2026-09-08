// src/core/NationalTeamRegistry.js
// NATIONAL-TEAMS-1 (DESIGN.md 10.17) — registro CANÓNICO de decisiones de
// nacionalidad deportiva, ventanas FIBA, listas/selecciones, convocatorias
// y apariciones oficiales. Instancia EXPLÍCITA por carrera
// (`state.nationalTeamRegistry`), NUNCA un singleton — mismo criterio que
// `PlayerRegistry`/`ContractRegistry`/`RegistrationRegistry`/`LoanRegistry`.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// `Map` es SOLO implementación interna en memoria (sección 4.3 del prompt:
// "las colecciones persistentes futuras serán objetos/arrays planos") —
// toda consulta pública devuelve arrays ordenados de forma ESTABLE (por id),
// nunca el orden de iteración de un `Map`.
//
// Módulo puro: no lee DOM, ni `state`, ni variables globales.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const RegistryIndexAuditModule = dep('../utils/RegistryIndexAudit.js');
  const LocalDateModule = dep('../utils/LocalDate.js');

  function LD() { return LocalDateModule.LocalDate; }
  function auditIndexSymmetry(name, indexMap, primaryMap) {
    return RegistryIndexAuditModule.RegistryIndexAudit.auditIndexSymmetry(name, indexMap, primaryMap);
  }

  function pushIndex(map, key, value) {
    if (key === null || key === undefined) return;
    const list = map.get(key) || [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  }

  function byId(list) { return [...list].sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0))); }

  class NationalTeamRegistry {
    constructor() {
      this._decisions = new Map();
      this._decisionsByPlayer = new Map();
      this._decisionsByFederation = new Map();

      this._windows = new Map();
      this._windowsBySeason = new Map();

      this._selections = new Map();
      this._selectionsByWindow = new Map();
      this._selectionsByNationalTeam = new Map();

      this._callUps = new Map();
      this._callUpsBySelection = new Map();
      this._callUpsByWindow = new Map();
      this._callUpsByPlayer = new Map();

      this._appearances = new Map();
      this._appearancesByPlayer = new Map();
      this._appearancesByFederation = new Map();
    }

    // --- Decisiones de nacionalidad deportiva -----------------------------
    registerDecision(decision) {
      const existing = this._decisions.get(decision.id);
      if (existing && existing !== decision) throw new Error(`NationalTeamRegistry: ya existe una NationalStatusDecision distinta con id "${decision.id}".`);
      this._decisions.set(decision.id, decision);
      pushIndex(this._decisionsByPlayer, decision.playerId, decision.id);
      pushIndex(this._decisionsByFederation, decision.federationOrganizationId, decision.id);
      return decision;
    }

    getDecision(id) { return this._decisions.get(id) || null; }

    requireDecision(id) {
      const found = this.getDecision(id);
      if (!found) throw new Error(`NationalTeamRegistry: no existe la NationalStatusDecision "${id}".`);
      return found;
    }

    decisionsForPlayer(playerId) {
      return byId((this._decisionsByPlayer.get(playerId) || []).map((id) => this._decisions.get(id)));
    }

    allDecisions() { return byId([...this._decisions.values()]); }

    // Decisión APROBADA vigente (no `superseded`) más reciente de un jugador
    // para una federación+área representada, en una fecha civil dada —
    // nunca infiere "elegible" sin una decisión explícita y vigente.
    latestActiveDecisionForPlayer(playerId, federationOrganizationId, representedAreaId, dateIso) {
      const candidates = this.decisionsForPlayer(playerId)
        .filter((d) => d.federationOrganizationId === federationOrganizationId
          && d.representedAreaId === representedAreaId
          && d.status !== 'superseded');
      const inWindow = dateIso
        ? candidates.filter((d) => LD().isWithinInclusive(dateIso, d.validFrom || d.decidedAtGameDate, d.validTo))
        : candidates;
      const pool = inWindow.length ? inWindow : candidates;
      if (!pool.length) return null;
      return [...pool].sort((a, b) => {
        if (a.decidedAtGameDate !== b.decidedAtGameDate) return a.decidedAtGameDate < b.decidedAtGameDate ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      })[0];
    }

    // --- Ventanas FIBA -------------------------------------------------
    registerWindow(window) {
      const existing = this._windows.get(window.id);
      if (existing && existing !== window) throw new Error(`NationalTeamRegistry: ya existe una NationalTeamWindow distinta con id "${window.id}".`);
      this._windows.set(window.id, window);
      pushIndex(this._windowsBySeason, window.seasonKey, window.id);
      return window;
    }

    getWindow(id) { return this._windows.get(id) || null; }

    requireWindow(id) {
      const found = this.getWindow(id);
      if (!found) throw new Error(`NationalTeamRegistry: no existe la NationalTeamWindow "${id}".`);
      return found;
    }

    windowsForSeason(seasonKey) { return byId((this._windowsBySeason.get(seasonKey) || []).map((id) => this._windows.get(id))); }

    allWindows() { return byId([...this._windows.values()]); }

    // --- Listas/selecciones ---------------------------------------------
    registerSelection(selection) {
      const existing = this._selections.get(selection.id);
      if (existing && existing !== selection) throw new Error(`NationalTeamRegistry: ya existe una NationalTeamSelection distinta con id "${selection.id}".`);
      this._selections.set(selection.id, selection);
      pushIndex(this._selectionsByWindow, selection.windowId, selection.id);
      pushIndex(this._selectionsByNationalTeam, selection.nationalTeamId, selection.id);
      return selection;
    }

    getSelection(id) { return this._selections.get(id) || null; }

    requireSelection(id) {
      const found = this.getSelection(id);
      if (!found) throw new Error(`NationalTeamRegistry: no existe la NationalTeamSelection "${id}".`);
      return found;
    }

    selectionsForWindow(windowId) { return byId((this._selectionsByWindow.get(windowId) || []).map((id) => this._selections.get(id))); }

    selectionsForNationalTeam(nationalTeamId) {
      return byId((this._selectionsByNationalTeam.get(nationalTeamId) || []).map((id) => this._selections.get(id)));
    }

    selectionForTeamWindow(nationalTeamId, windowId) {
      return this.selectionsForWindow(windowId).find((s) => s.nationalTeamId === nationalTeamId) || null;
    }

    allSelections() { return byId([...this._selections.values()]); }

    // --- Convocatorias ---------------------------------------------------
    registerCallUp(callUp) {
      const existing = this._callUps.get(callUp.id);
      if (existing && existing !== callUp) throw new Error(`NationalTeamRegistry: ya existe una NationalTeamCallUp distinta con id "${callUp.id}".`);
      this._callUps.set(callUp.id, callUp);
      pushIndex(this._callUpsBySelection, callUp.selectionId, callUp.id);
      pushIndex(this._callUpsByWindow, callUp.windowId, callUp.id);
      pushIndex(this._callUpsByPlayer, callUp.playerId, callUp.id);
      return callUp;
    }

    getCallUp(id) { return this._callUps.get(id) || null; }

    requireCallUp(id) {
      const found = this.getCallUp(id);
      if (!found) throw new Error(`NationalTeamRegistry: no existe la NationalTeamCallUp "${id}".`);
      return found;
    }

    callUpsForSelection(selectionId) { return byId((this._callUpsBySelection.get(selectionId) || []).map((id) => this._callUps.get(id))); }

    callUpsForWindow(windowId) { return byId((this._callUpsByWindow.get(windowId) || []).map((id) => this._callUps.get(id))); }

    callUpsForPlayer(playerId) { return byId((this._callUpsByPlayer.get(playerId) || []).map((id) => this._callUps.get(id))); }

    allCallUps() { return byId([...this._callUps.values()]); }

    // ¿Hay un servicio internacional ACTIVO ('joined') que cubra la fecha
    // civil dada? Fuente ÚNICA de "indisponible para el club por selección"
    // — consultada tanto por `EligibilityService` (reason code
    // `NATIONAL_TEAM_DUTY`) como por cualquier diagnóstico de Agenda/Home.
    // Nunca muta.
    activeDutyForPlayerOn(playerId, dateIso) {
      const found = this.callUpsForPlayer(playerId)
        .filter((c) => c.status === 'joined')
        .map((callUp) => ({ callUp, window: this.getWindow(callUp.windowId) }))
        .find(({ window }) => window && window.coversLocalDate(dateIso));
      return found || null;
    }

    // --- Apariciones oficiales -------------------------------------------
    registerAppearanceReceipt(receipt) {
      const existing = this._appearances.get(receipt.id);
      if (existing && existing !== receipt) throw new Error(`NationalTeamRegistry: ya existe un NationalTeamAppearanceReceipt distinto con id "${receipt.id}".`);
      this._appearances.set(receipt.id, receipt);
      pushIndex(this._appearancesByPlayer, receipt.playerId, receipt.id);
      pushIndex(this._appearancesByFederation, receipt.federationOrganizationId, receipt.id);
      return receipt;
    }

    getAppearanceReceipt(id) { return this._appearances.get(id) || null; }

    appearancesForPlayer(playerId) { return byId((this._appearancesByPlayer.get(playerId) || []).map((id) => this._appearances.get(id))); }

    appearancesForFederation(federationOrganizationId) {
      return byId((this._appearancesByFederation.get(federationOrganizationId) || []).map((id) => this._appearances.get(id)));
    }

    allAppearances() { return byId([...this._appearances.values()]); }

    // --- Integridad --------------------------------------------------------
    // Nunca lanza por sí sola — agrega todo lo que no cuadra, mismo patrón
    // que LoanRegistry/TransferRegistry.
    validateIntegrity(options) {
      const opts = options || {};
      const { playerRegistry, teams, organizations } = opts;
      const errors = [];
      const teamsById = new Map((teams || []).map((t) => [t.id, t]));

      this.allDecisions().forEach((decision) => {
        if (playerRegistry && !playerRegistry.has(decision.playerId)) {
          errors.push(`NationalStatusDecision "${decision.id}": jugador inexistente "${decision.playerId}".`);
        }
        if (organizations && !organizations.has(decision.federationOrganizationId)) {
          errors.push(`NationalStatusDecision "${decision.id}": federación inexistente "${decision.federationOrganizationId}".`);
        }
      });

      this.allWindows().forEach((window) => {
        if (organizations && !organizations.has(window.organizerOrganizationId)) {
          errors.push(`NationalTeamWindow "${window.id}": organizador inexistente "${window.organizerOrganizationId}".`);
        }
      });

      this.allSelections().forEach((selection) => {
        if (!this._windows.has(selection.windowId)) errors.push(`NationalTeamSelection "${selection.id}": ventana inexistente "${selection.windowId}".`);
        const team = teamsById.get(selection.nationalTeamId);
        if (teams && (!team || team.teamKind !== 'national-team')) {
          errors.push(`NationalTeamSelection "${selection.id}": "${selection.nationalTeamId}" no es un equipo "national-team" existente.`);
        }
        const notInPreliminary = selection.finalPlayerIds.filter((id) => !selection.preliminaryPlayerIds.includes(id));
        if (selection.finalPlayerIds.length && notInPreliminary.length) {
          errors.push(`NationalTeamSelection "${selection.id}": la lista final contiene jugadores fuera de la preliminar (${notInPreliminary.join(', ')}).`);
        }
      });

      this.allCallUps().forEach((callUp) => {
        if (!this._selections.has(callUp.selectionId)) errors.push(`NationalTeamCallUp "${callUp.id}": selección inexistente "${callUp.selectionId}".`);
        if (!this._windows.has(callUp.windowId)) errors.push(`NationalTeamCallUp "${callUp.id}": ventana inexistente "${callUp.windowId}".`);
        if (playerRegistry && !playerRegistry.has(callUp.playerId)) errors.push(`NationalTeamCallUp "${callUp.id}": jugador inexistente "${callUp.playerId}".`);
      });

      this.allAppearances().forEach((receipt) => {
        if (playerRegistry && !playerRegistry.has(receipt.playerId)) errors.push(`NationalTeamAppearanceReceipt "${receipt.id}": jugador inexistente "${receipt.playerId}".`);
      });

      errors.push(...auditIndexSymmetry('_decisionsByPlayer', this._decisionsByPlayer, this._decisions));
      errors.push(...auditIndexSymmetry('_decisionsByFederation', this._decisionsByFederation, this._decisions));
      errors.push(...auditIndexSymmetry('_windowsBySeason', this._windowsBySeason, this._windows));
      errors.push(...auditIndexSymmetry('_selectionsByWindow', this._selectionsByWindow, this._selections));
      errors.push(...auditIndexSymmetry('_selectionsByNationalTeam', this._selectionsByNationalTeam, this._selections));
      errors.push(...auditIndexSymmetry('_callUpsBySelection', this._callUpsBySelection, this._callUps));
      errors.push(...auditIndexSymmetry('_callUpsByWindow', this._callUpsByWindow, this._callUps));
      errors.push(...auditIndexSymmetry('_callUpsByPlayer', this._callUpsByPlayer, this._callUps));
      errors.push(...auditIndexSymmetry('_appearancesByPlayer', this._appearancesByPlayer, this._appearances));
      errors.push(...auditIndexSymmetry('_appearancesByFederation', this._appearancesByFederation, this._appearances));

      return { valid: errors.length === 0, errors };
    }

    // Resumen PLANO (sección 4.3 del prompt: "sin filtrar información
    // privada innecesaria") — usado por `GameWorld.describe()`.
    describe() {
      return {
        decisionCount: this._decisions.size,
        windowCount: this._windows.size,
        selectionCount: this._selections.size,
        callUpCount: this._callUps.size,
        appearanceCount: this._appearances.size,
      };
    }

    // Ya lossless — SAVE-LOAD-1 lo reutiliza directamente como
    // `exportState()`.
    snapshot() {
      return {
        decisions: this.allDecisions().map((d) => d.toJSON()),
        windows: this.allWindows().map((w) => w.toJSON()),
        selections: this.allSelections().map((s) => s.toJSON()),
        callUps: this.allCallUps().map((c) => c.toJSON()),
        appearances: this.allAppearances().map((a) => a.toJSON()),
      };
    }

    exportState() { return this.snapshot(); }

    // `entities`: `{NationalStatusDecision, NationalTeamWindow,
    // NationalTeamSelection, NationalTeamCallUp,
    // NationalTeamAppearanceReceipt}` — vacío en la partida española hoy,
    // pero proyectado/restaurado igual que cualquier otra colección durable.
    restoreState(state, entities) {
      (state.decisions || []).forEach((j) => this.registerDecision(new entities.NationalStatusDecision(j)));
      (state.windows || []).forEach((j) => this.registerWindow(new entities.NationalTeamWindow(j)));
      (state.selections || []).forEach((j) => this.registerSelection(new entities.NationalTeamSelection(j)));
      (state.callUps || []).forEach((j) => this.registerCallUp(new entities.NationalTeamCallUp(j)));
      (state.appearances || []).forEach((j) => this.registerAppearanceReceipt(new entities.NationalTeamAppearanceReceipt(j)));
    }
  }

  const exportsObj = { NationalTeamRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
