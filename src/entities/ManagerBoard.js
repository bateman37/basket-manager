// src/entities/ManagerBoard.js
// ECONOMY-BOARD-1 — identidad DURABLE del manager humano, su historial de
// empleo y la ficha de política/personalidad de junta por club:
// `ManagerProfile`, `EmploymentSpell`, `SeasonEvaluation` (evaluación
// INMUTABLE registrada al cierre de cada temporada) y `BoardPolicyProfile`
// (estilo fiscal simulado del club — separado de la capacidad financiera,
// nunca la sustituye). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Este archivo no conoce Club/Team como clases (duck typing sobre ids),
// no lee el DOM y no toca ningún registro.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function requireId(value, label) {
    if (!value || typeof value !== 'string') {
      throw new Error(`ManagerBoard: "${label}" debe ser un id string no vacío (recibido: ${JSON.stringify(value)}).`);
    }
    return value;
  }

  class ManagerProfile {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.careerSeed = data.careerSeed || null;
      this.createdAtGameDate = LD().requireIsoDate(data.createdAtGameDate, 'createdAtGameDate');
      this.provenance = { dataSource: 'simulated-manager-board-v1', isReal: false };
    }

    toJSON() {
      return {
        id: this.id, careerSeed: this.careerSeed, createdAtGameDate: this.createdAtGameDate, provenance: { ...this.provenance },
      };
    }
  }

  const AUTHORITY_ROLES = Object.freeze(['manager']);

  class EmploymentSpell {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.managerId = requireId(data.managerId, 'managerId');
      this.clubId = requireId(data.clubId, 'clubId');
      this.authorityRole = data.authorityRole || 'manager';
      if (!AUTHORITY_ROLES.includes(this.authorityRole)) {
        throw new Error(`EmploymentSpell: authorityRole desconocido "${this.authorityRole}".`);
      }
      this.startGameDate = LD().requireIsoDate(data.startGameDate, 'startGameDate');
      this.endGameDate = data.endGameDate ? LD().requireIsoDate(data.endGameDate, 'endGameDate') : null;
      this.seasonEvaluationIds = Array.isArray(data.seasonEvaluationIds) ? [...data.seasonEvaluationIds] : [];
      this.provenance = { dataSource: (data.provenance && data.provenance.dataSource) || 'simulated-manager-board-v1', isReal: false };
    }

    get isActive() { return this.endGameDate === null; }

    completedMonthsAsOf(atGameDate) {
      const end = this.endGameDate || atGameDate;
      const days = Math.max(0, LD().daysBetween(this.startGameDate, end));
      return Math.floor(days / 30);
    }

    end(atGameDate) { this.endGameDate = LD().requireIsoDate(atGameDate, 'atGameDate'); return this; }

    addSeasonEvaluation(evaluationId) {
      if (!this.seasonEvaluationIds.includes(evaluationId)) this.seasonEvaluationIds.push(evaluationId);
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        managerId: this.managerId,
        clubId: this.clubId,
        authorityRole: this.authorityRole,
        startGameDate: this.startGameDate,
        endGameDate: this.endGameDate,
        seasonEvaluationIds: [...this.seasonEvaluationIds],
        provenance: { ...this.provenance },
      };
    }
  }

  const SPORTING_OUTCOMES = Object.freeze(['exceeded', 'met', 'failed']);

  // Evaluación INMUTABLE registrada una vez por temporada cerrada —
  // `EmploymentSpell.seasonEvaluationIds` evita duplicar (cerrar/reanudar
  // nunca la repite, sección 7.2 del prompt).
  class SeasonEvaluation {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.employmentSpellId = requireId(data.employmentSpellId, 'employmentSpellId');
      this.seasonKey = data.seasonKey;
      if (!LD().isValidSeasonKey(this.seasonKey)) throw new Error(`SeasonEvaluation: seasonKey inválida "${this.seasonKey}".`);
      this.sportingOutcome = data.sportingOutcome;
      if (!SPORTING_OUTCOMES.includes(this.sportingOutcome)) {
        throw new Error(`SeasonEvaluation: sportingOutcome desconocido "${this.sportingOutcome}".`);
      }
      this.overallConfidenceAtClose = data.overallConfidenceAtClose;
      this.confidenceBreakdownAtClose = data.confidenceBreakdownAtClose ? { ...data.confidenceBreakdownAtClose } : null;
      this.createdAtGameDate = LD().requireIsoDate(data.createdAtGameDate, 'createdAtGameDate');
      this.provenance = { dataSource: 'simulated-manager-board-v1', isReal: false };
    }

    toJSON() {
      return {
        id: this.id,
        employmentSpellId: this.employmentSpellId,
        seasonKey: this.seasonKey,
        sportingOutcome: this.sportingOutcome,
        overallConfidenceAtClose: this.overallConfidenceAtClose,
        confidenceBreakdownAtClose: this.confidenceBreakdownAtClose ? { ...this.confidenceBreakdownAtClose } : null,
        createdAtGameDate: this.createdAtGameDate,
        provenance: { ...this.provenance },
      };
    }
  }

  const FISCAL_STYLES = Object.freeze(['conservative', 'balanced', 'ambitious']);

  // Personalidad/estilo fiscal SIMULADO del club — separado de
  // `FinancialCapacityService` (nunca cambia caja/headroom/hechos
  // regulatorios, solo la disposición de la junta dentro del margen ya
  // seguro). Actor-neutral: preparado para que un futuro modo
  // manager+propiedad lo reutilice sin tocar este archivo.
  class BoardPolicyProfile {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.clubId = requireId(data.clubId, 'clubId');
      this.fiscalStyle = data.fiscalStyle;
      if (!FISCAL_STYLES.includes(this.fiscalStyle)) {
        throw new Error(`BoardPolicyProfile: fiscalStyle desconocido "${this.fiscalStyle}".`);
      }
      this.provenance = {
        dataSource: 'simulated-manager-board-v1',
        isReal: false,
        policyVersion: (data.provenance && data.provenance.policyVersion) || null,
        careerSeed: (data.provenance && data.provenance.careerSeed) || null,
      };
    }

    toJSON() {
      return {
        id: this.id, clubId: this.clubId, fiscalStyle: this.fiscalStyle, provenance: { ...this.provenance },
      };
    }
  }

  const exportsObj = {
    ManagerProfile,
    EmploymentSpell,
    SeasonEvaluation,
    BoardPolicyProfile,
    MANAGER_BOARD_AUTHORITY_ROLES: AUTHORITY_ROLES,
    MANAGER_BOARD_SPORTING_OUTCOMES: SPORTING_OUTCOMES,
    MANAGER_BOARD_FISCAL_STYLES: FISCAL_STYLES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
