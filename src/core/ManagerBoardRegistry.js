// src/core/ManagerBoardRegistry.js
// ECONOMY-BOARD-1 — registro CANÓNICO del manager humano, su historial de
// empleo, sus evaluaciones de temporada y el perfil de política/
// personalidad de junta por club. Instancia EXPLÍCITA por carrera
// (`state.managerBoardRegistry`), nunca un singleton. Convención del
// proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  function byId(list) { return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)); }

  class ManagerBoardRegistry {
    constructor() {
      this._managers = new Map(); // id -> ManagerProfile
      this._spells = new Map(); // id -> EmploymentSpell
      this._spellsByClub = new Map(); // clubId -> [spellId...] orden de creación
      this._evaluations = new Map(); // id -> SeasonEvaluation
      this._boardPolicies = new Map(); // clubId -> BoardPolicyProfile
    }

    // --- Manager ------------------------------------------------------
    registerManager(manager) {
      if (!manager || !manager.id) throw new Error('ManagerBoardRegistry.registerManager: falta un manager con "id".');
      if (this._managers.has(manager.id)) return this._managers.get(manager.id);
      this._managers.set(manager.id, manager);
      return manager;
    }

    hasManager(id) { return this._managers.has(id); }

    getManager(id) { return this._managers.get(id) || null; }

    allManagers() { return byId([...this._managers.values()]); }

    // --- Empleo ---------------------------------------------------------
    registerSpell(spell) {
      if (!spell || !spell.id) throw new Error('ManagerBoardRegistry.registerSpell: falta un spell con "id".');
      if (this._spells.has(spell.id)) return this._spells.get(spell.id);
      this._spells.set(spell.id, spell);
      const list = this._spellsByClub.get(spell.clubId) || [];
      list.push(spell.id);
      this._spellsByClub.set(spell.clubId, list);
      return spell;
    }

    getSpell(id) { return this._spells.get(id) || null; }

    spellsForClub(clubId) { return (this._spellsByClub.get(clubId) || []).map((id) => this._spells.get(id)); }

    activeSpellForClub(clubId) { return this.spellsForClub(clubId).find((s) => s.isActive) || null; }

    activeSpellForManager(managerId) {
      return [...this._spells.values()].find((s) => s.managerId === managerId && s.isActive) || null;
    }

    allSpells() { return byId([...this._spells.values()]); }

    // --- Evaluaciones de temporada ----------------------------------------
    registerEvaluation(evaluation) {
      if (!evaluation || !evaluation.id) throw new Error('ManagerBoardRegistry.registerEvaluation: falta una evaluación con "id".');
      if (this._evaluations.has(evaluation.id)) return this._evaluations.get(evaluation.id);
      this._evaluations.set(evaluation.id, evaluation);
      const spell = this._spells.get(evaluation.employmentSpellId);
      if (spell) spell.addSeasonEvaluation(evaluation.id);
      return evaluation;
    }

    hasEvaluationForSpellSeason(employmentSpellId, seasonKey) {
      return [...this._evaluations.values()].some((e) => e.employmentSpellId === employmentSpellId && e.seasonKey === seasonKey);
    }

    evaluationsForSpell(employmentSpellId) {
      return byId([...this._evaluations.values()].filter((e) => e.employmentSpellId === employmentSpellId));
    }

    allEvaluations() { return byId([...this._evaluations.values()]); }

    // --- Política/personalidad de junta ------------------------------------
    registerBoardPolicy(profile) {
      if (!profile || !profile.clubId) throw new Error('ManagerBoardRegistry.registerBoardPolicy: falta un perfil con "clubId".');
      if (this._boardPolicies.has(profile.clubId)) return this._boardPolicies.get(profile.clubId);
      this._boardPolicies.set(profile.clubId, profile);
      return profile;
    }

    hasBoardPolicy(clubId) { return this._boardPolicies.has(clubId); }

    boardPolicyFor(clubId) { return this._boardPolicies.get(clubId) || null; }

    allBoardPolicies() { return byId([...this._boardPolicies.values()]); }

    validateIntegrity() {
      const errors = [];
      this._spells.forEach((spell) => {
        if (!this._managers.has(spell.managerId)) errors.push(`El spell "${spell.id}" referencia el manager "${spell.managerId}", inexistente.`);
      });
      this._evaluations.forEach((evaluation) => {
        if (!this._spells.has(evaluation.employmentSpellId)) {
          errors.push(`La evaluación "${evaluation.id}" referencia el spell "${evaluation.employmentSpellId}", inexistente.`);
        }
      });
      return { valid: errors.length === 0, errors };
    }

    exportState() {
      return {
        managers: [...this._managers.values()].map((m) => m.toJSON()),
        spells: [...this._spells.values()].map((s) => s.toJSON()),
        evaluations: [...this._evaluations.values()].map((e) => e.toJSON()),
        boardPolicies: [...this._boardPolicies.values()].map((p) => p.toJSON()),
      };
    }

    restoreState(state, entities) {
      const raw = state || {};
      (raw.managers || []).forEach((j) => this.registerManager(new entities.ManagerProfile(j)));
      (raw.spells || []).forEach((j) => this.registerSpell(new entities.EmploymentSpell(j)));
      (raw.evaluations || []).forEach((j) => this.registerEvaluation(new entities.SeasonEvaluation(j)));
      (raw.boardPolicies || []).forEach((j) => this.registerBoardPolicy(new entities.BoardPolicyProfile(j)));
    }

    snapshot() {
      return {
        managers: this._managers.size, spells: this._spells.size, evaluations: this._evaluations.size, boardPolicies: this._boardPolicies.size,
      };
    }

    describe() { return this.snapshot(); }
  }

  const exportsObj = { ManagerBoardRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
