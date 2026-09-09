// src/entities/SquadBudget.js
// SQUAD-BUDGET-1 — entidad del presupuesto salarial de plantilla (club +
// temporada + moneda). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// `SquadBudgetAllocation` es un registro INMUTABLE de una cadena de
// revisiones: la junta asigna un límite salarial que queda CONGELADO para
// esa temporada — solo una revisión explícita nueva (con su propio id y
// `predecessorId` apuntando a la anterior) cambia el límite efectivo. Nunca
// se edita un campo de una asignación ya registrada.
//
// Este archivo no conoce Club/Team/Contract como clases (duck typing sobre
// ids), no lee el DOM y no toca ningún registro.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function M() { return MoneyModule.Money; }

  function requireId(value, label) {
    if (!value || typeof value !== 'string') {
      throw new Error(`SquadBudgetAllocation: "${label}" debe ser un id string no vacío (recibido: ${JSON.stringify(value)}).`);
    }
    return value;
  }

  // Tipos de revisión — nunca un booleano suelto. `opening-allocation` es la
  // primera asignación de una cadena club+temporada+moneda (creada por el
  // bootstrap de carrera o por el ciclo anual al abrir la temporada
  // siguiente); `season-opening-cycle-policy` es la variante que crea el
  // ciclo anual para la temporada que se abre; `board-revision` es una
  // ampliación/recorte explícito y auditable (mecanismo de esta entrega,
  // sin UI todavía que la dispare — ver docs/architecture/squad-budget.md);
  // `migration-backfill` es la reconstruida al migrar un guardado v1 sin
  // esta colección.
  const REVISION_KINDS = Object.freeze([
    'opening-allocation',
    'season-opening-cycle-policy',
    'board-revision',
    'migration-backfill',
  ]);

  // Quién autorizó la cifra — nunca implica que exista ya un sistema de
  // peticiones jugables (eso es el follow-up documentado, ver §4.3 del
  // prompt / docs/architecture/squad-budget.md).
  const DECISION_AUTHORITIES = Object.freeze([
    'board-system-seed', // compatibilidad congelada al arrancar la carrera o al abrir temporada
    'board-manual', // revisión explícita registrada por una sesión/herramienta (sin UI jugable todavía)
    'migration', // reconstruida al migrar un guardado antiguo
  ]);

  function normalizeProvenance(provenance) {
    const p = provenance || {};
    return {
      dataSource: p.dataSource || 'simulated-squad-budget-v1',
      isReal: false,
      policyVersion: p.policyVersion || null,
      basisAmountMinor: p.basisAmountMinor !== undefined && p.basisAmountMinor !== null
        ? M().requireAmountMinor(p.basisAmountMinor, 'provenance.basisAmountMinor') : null,
      multiplier: p.multiplier !== undefined && p.multiplier !== null ? p.multiplier : null,
      calculatedAtGameDate: p.calculatedAtGameDate ? LD().requireIsoDate(p.calculatedAtGameDate, 'provenance.calculatedAtGameDate') : null,
      note: p.note || null,
    };
  }

  class SquadBudgetAllocation {
    constructor(data = {}) {
      this.id = requireId(data.id, 'id');
      this.clubId = requireId(data.clubId, 'clubId');
      this.seasonKey = data.seasonKey;
      if (typeof this.seasonKey !== 'string' || !this.seasonKey) {
        throw new Error(`SquadBudgetAllocation: "seasonKey" debe ser un string no vacío (recibido: ${JSON.stringify(data.seasonKey)}).`);
      }
      this.currency = M().requireCurrency(data.currency || 'EUR');
      this.amountMinor = M().requireAmountMinor(data.amountMinor, 'amountMinor');
      this.effectiveDate = LD().requireIsoDate(data.effectiveDate, 'effectiveDate');
      this.createdAtGameDate = data.createdAtGameDate
        ? LD().requireIsoDate(data.createdAtGameDate, 'createdAtGameDate') : this.effectiveDate;
      this.revisionKind = data.revisionKind || 'opening-allocation';
      if (!REVISION_KINDS.includes(this.revisionKind)) {
        throw new Error(`SquadBudgetAllocation: "revisionKind" desconocido "${this.revisionKind}" (esperado uno de ${REVISION_KINDS.join(', ')}).`);
      }
      this.decisionAuthority = data.decisionAuthority || 'board-system-seed';
      if (!DECISION_AUTHORITIES.includes(this.decisionAuthority)) {
        throw new Error(`SquadBudgetAllocation: "decisionAuthority" desconocida "${this.decisionAuthority}".`);
      }
      this.predecessorId = data.predecessorId || null;
      this.provenance = normalizeProvenance(data.provenance);
    }

    toJSON() {
      return {
        id: this.id,
        clubId: this.clubId,
        seasonKey: this.seasonKey,
        currency: this.currency,
        amountMinor: this.amountMinor,
        effectiveDate: this.effectiveDate,
        createdAtGameDate: this.createdAtGameDate,
        revisionKind: this.revisionKind,
        decisionAuthority: this.decisionAuthority,
        predecessorId: this.predecessorId,
        provenance: { ...this.provenance },
      };
    }
  }

  const exportsObj = {
    SquadBudgetAllocation,
    SQUAD_BUDGET_REVISION_KINDS: REVISION_KINDS,
    SQUAD_BUDGET_DECISION_AUTHORITIES: DECISION_AUTHORITIES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
