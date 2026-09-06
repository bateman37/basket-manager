// src/entities/CompetitionPathway.js
// PATHWAYS-1 (DESIGN.md 10.15) — modelo canónico de PROGRESIÓN declarativa
// entre fases/torneos: quién avanza de una fase a otra, quién entra en otra
// competición, quién ocupa una plaza de liga la temporada siguiente. Antes
// de esta entrega esa decisión vivía repartida entre `CompetitionFormatDefinition`
// (`activation`/`entrySource`), `CompetitionEngine` y `SeasonHistoryService` —
// esta entidad la aísla en datos VERSIONADOS, serializables y con receipt
// (BUG-PATHWAYS-01). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Vocabulario CERRADO (sección 7.3 del prompt) — un tipo desconocido lanza,
// nunca se interpreta con un fallback. El core (esta entidad, el catálogo y
// el servicio) NUNCA contiene un literal de país/liga/competición concreta
// (invariante 8) — auditado en `scripts/test-pathways1.js`.

(function (global) {
  const PATHWAY_DEFINITION_STATUSES = ['active', 'provisional', 'deprecated', 'fictional-test'];
  const PATHWAY_RULE_KINDS = ['stage-qualification', 'competition-qualification', 'next-season-membership'];
  const PATHWAY_TRIGGER_TYPES = ['round-completed', 'stage-completed', 'season-transition'];
  const PATHWAY_SELECTOR_TYPES = [
    'standings-range', 'bracket-final-round-winners', 'bracket-champion', 'remaining-participants',
  ];
  const PATHWAY_SEED_POLICIES = ['source-rank', 'preserve-source-seed', 'best-vs-worst-by-seed', 'none'];
  const PATHWAY_DESTINATION_TYPES = ['stage', 'competition-edition', 'next-season-competition'];
  const PATHWAY_RECEIPT_STATUSES = ['applied', 'reserved', 'blocked'];

  function requireField(ownerLabel, data, field) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new Error(`${ownerLabel}: falta "${field}" explícito.`);
    }
    return data[field];
  }

  function requireOneOf(ownerLabel, field, value, allowed) {
    if (!allowed.includes(value)) {
      throw new Error(`${ownerLabel}: "${field}" = "${value}" no válido — debe ser uno de ${allowed.join(', ')}.`);
    }
    return value;
  }

  function deepFreeze(value) {
    if (value === null || typeof value !== 'object') return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function clonePlain(value) {
    return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  // -----------------------------------------------------------------------
  // Validación de sub-shapes (trigger/selector/destination/seedPolicy) — sin
  // funciones ni instancias vivas, solo datos planos comprobados.
  // -----------------------------------------------------------------------
  function validateStageRef(ownerLabel, field, ref) {
    if (!ref || typeof ref !== 'object') throw new Error(`${ownerLabel}: falta "${field}" explícito.`);
    requireField(`${ownerLabel}.${field}`, ref, 'competitionDefinitionId');
    requireField(`${ownerLabel}.${field}`, ref, 'stageKey');
    return { competitionDefinitionId: ref.competitionDefinitionId, stageKey: ref.stageKey };
  }

  function validateTrigger(ownerLabel, trigger) {
    if (!trigger || typeof trigger !== 'object') throw new Error(`${ownerLabel}: falta "trigger" explícito.`);
    requireOneOf(ownerLabel, 'trigger.type', trigger.type, PATHWAY_TRIGGER_TYPES);
    const result = { type: trigger.type };
    if (trigger.type === 'stage-completed' || trigger.type === 'round-completed') {
      result.stageRef = validateStageRef(ownerLabel, 'trigger.stageRef', trigger.stageRef);
    }
    if (trigger.type === 'round-completed') {
      if (!Number.isInteger(trigger.round) || trigger.round <= 0) {
        throw new Error(`${ownerLabel}: trigger "round-completed" exige "round" entero positivo.`);
      }
      result.round = trigger.round;
    }
    return deepFreeze(result);
  }

  function validateSelector(ownerLabel, selector) {
    if (!selector || typeof selector !== 'object') throw new Error(`${ownerLabel}: falta "selector" explícito.`);
    requireOneOf(ownerLabel, 'selector.type', selector.type, PATHWAY_SELECTOR_TYPES);
    const result = { type: selector.type };
    if (selector.type === 'standings-range') {
      result.stageRef = validateStageRef(ownerLabel, 'selector.stageRef', selector.stageRef);
      if (!Number.isInteger(selector.fromRank) || !Number.isInteger(selector.toRank) || selector.fromRank < 1 || selector.toRank < selector.fromRank) {
        throw new Error(`${ownerLabel}: selector "standings-range" exige "fromRank"/"toRank" enteros válidos.`);
      }
      result.fromRank = selector.fromRank;
      result.toRank = selector.toRank;
    } else if (selector.type === 'bracket-final-round-winners' || selector.type === 'bracket-champion') {
      result.stageRef = validateStageRef(ownerLabel, 'selector.stageRef', selector.stageRef);
    } else if (selector.type === 'remaining-participants') {
      // La exigencia de "solo dentro de un transitionGroupId" se comprueba
      // a nivel de REGLA (`transitionGroupId` vive ahí, nunca en el
      // selector) — ver `CompetitionPathwayRule` más abajo.
      result.sourceCompetitionDefinitionId = requireField(ownerLabel, selector, 'sourceCompetitionDefinitionId');
    }
    return deepFreeze(result);
  }

  function validateDestination(ownerLabel, destination) {
    if (!destination || typeof destination !== 'object') throw new Error(`${ownerLabel}: falta "destination" explícito.`);
    requireOneOf(ownerLabel, 'destination.type', destination.type, PATHWAY_DESTINATION_TYPES);
    const result = { type: destination.type };
    if (destination.type === 'stage') {
      result.stageKey = requireField(ownerLabel, destination, 'stageKey');
    } else if (destination.type === 'competition-edition') {
      result.competitionDefinitionId = requireField(ownerLabel, destination, 'competitionDefinitionId');
      result.seasonRelation = requireOneOf(ownerLabel, 'destination.seasonRelation', destination.seasonRelation || 'same-season', ['same-season']);
    } else if (destination.type === 'next-season-competition') {
      result.competitionDefinitionId = requireField(ownerLabel, destination, 'competitionDefinitionId');
    }
    return deepFreeze(result);
  }

  // ---------------------------------------------------------------------
  // CompetitionPathwayRule — una regla de progresión, dato plano congelado.
  // ---------------------------------------------------------------------
  class CompetitionPathwayRule {
    constructor(data = {}) {
      const label = `CompetitionPathwayRule "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.kind = requireOneOf(label, 'kind', data.kind, PATHWAY_RULE_KINDS);
      this.trigger = validateTrigger(label, data.trigger);
      this.selector = validateSelector(label, data.selector);
      if (this.selector.type === 'remaining-participants' && !data.transitionGroupId) {
        throw new Error(`${label}: selector "remaining-participants" exige "transitionGroupId".`);
      }
      this.destination = validateDestination(label, data.destination);
      this.seedPolicy = requireOneOf(label, 'seedPolicy', data.seedPolicy || 'source-rank', PATHWAY_SEED_POLICIES);
      this.outcomeCode = data.outcomeCode || null;
      this.transitionGroupId = data.transitionGroupId || null;
      this.provenance = data.provenance ? clonePlain(data.provenance) : null;
      Object.freeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        kind: this.kind,
        trigger: clonePlain(this.trigger),
        selector: clonePlain(this.selector),
        destination: clonePlain(this.destination),
        seedPolicy: this.seedPolicy,
        outcomeCode: this.outcomeCode,
        transitionGroupId: this.transitionGroupId,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionPathwayDefinition — versionada, serializable, inmutable.
  // ---------------------------------------------------------------------
  class CompetitionPathwayDefinition {
    constructor(data = {}) {
      const label = `CompetitionPathwayDefinition "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.version = requireField(label, data, 'version');
      this.status = requireOneOf(label, 'status', data.status || 'active', PATHWAY_DEFINITION_STATUSES);
      this.participantType = requireOneOf(label, 'participantType', data.participantType || 'club-team', ['club-team', 'national-team']);
      const rulesInput = Array.isArray(data.rules) ? data.rules : [];
      if (!rulesInput.length) throw new Error(`${label}: "rules" no puede estar vacío.`);
      this.rules = rulesInput
        .map((r) => (r instanceof CompetitionPathwayRule ? r : new CompetitionPathwayRule(r)))
        .sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
      const ids = new Set();
      this.rules.forEach((rule) => {
        if (ids.has(rule.id)) throw new Error(`${label}: "id" de regla duplicada "${rule.id}".`);
        ids.add(rule.id);
      });
      // transitionGroups: metadatos declarativos por grupo (cardinalidad
      // esperada por destino, exclusividad) — puro dato, la validación real
      // la aplica el servicio contra el mundo real.
      const groupsInput = data.transitionGroups || {};
      this.transitionGroups = {};
      Object.keys(groupsInput).forEach((groupId) => {
        const group = groupsInput[groupId] || {};
        this.transitionGroups[groupId] = deepFreeze({
          id: groupId,
          expectedCardinalityByCompetitionDefinitionId: clonePlain(group.expectedCardinalityByCompetitionDefinitionId || {}),
          exclusivePyramid: group.exclusivePyramid !== false,
        });
      });
      // Toda regla con transitionGroupId debe referenciar un grupo declarado.
      this.rules.forEach((rule) => {
        if (rule.transitionGroupId && !this.transitionGroups[rule.transitionGroupId]) {
          throw new Error(`${label}: la regla "${rule.id}" referencia transitionGroupId "${rule.transitionGroupId}" no declarado en "transitionGroups".`);
        }
      });
      this.provenance = data.provenance ? clonePlain(data.provenance) : null;
      Object.freeze(this.rules);
      Object.freeze(this.transitionGroups);
      Object.freeze(this);
    }

    getRule(ruleId) {
      const found = this.rules.find((r) => r.id === ruleId);
      if (!found) throw new Error(`CompetitionPathwayDefinition "${this.id}": no existe la regla "${ruleId}".`);
      return found;
    }

    rulesForTransitionGroup(groupId) {
      return this.rules.filter((r) => r.transitionGroupId === groupId);
    }

    rulesMatchingTrigger(trigger) {
      return this.rules.filter((rule) => {
        if (rule.trigger.type !== trigger.type) return false;
        if (rule.trigger.type === 'season-transition') return true;
        if (rule.trigger.stageRef.competitionDefinitionId !== trigger.stageRef.competitionDefinitionId) return false;
        if (rule.trigger.stageRef.stageKey !== trigger.stageRef.stageKey) return false;
        if (rule.trigger.type === 'round-completed' && rule.trigger.round !== trigger.round) return false;
        return true;
      });
    }

    toJSON() {
      return {
        id: this.id,
        version: this.version,
        status: this.status,
        participantType: this.participantType,
        rules: this.rules.map((r) => r.toJSON()),
        transitionGroups: clonePlain(this.transitionGroups),
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionPathwayReceipt — evidencia INMUTABLE de una decisión de
  // clasificación aplicada (sección 7.4 del prompt).
  // ---------------------------------------------------------------------
  class CompetitionPathwayReceipt {
    constructor(data = {}) {
      const label = `CompetitionPathwayReceipt "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.pathwayDefinitionId = requireField(label, data, 'pathwayDefinitionId');
      this.pathwayVersion = requireField(label, data, 'pathwayVersion');
      this.ruleId = requireField(label, data, 'ruleId');
      this.kind = requireOneOf(label, 'kind', data.kind, PATHWAY_RULE_KINDS);
      this.sourceSeasonKey = requireField(label, data, 'sourceSeasonKey');
      this.trigger = clonePlain(data.trigger || null);
      this.destination = clonePlain(data.destination || null);
      this.qualifiers = (Array.isArray(data.qualifiers) ? data.qualifiers : []).map((q) => clonePlain(q));
      this.firstRoundPairing = data.firstRoundPairing ? clonePlain(data.firstRoundPairing) : null;
      this.outcomeCode = data.outcomeCode || null;
      this.resolvedAt = requireField(label, data, 'resolvedAt');
      this.timeZoneId = data.timeZoneId || null;
      this.status = requireOneOf(label, 'status', data.status || 'applied', PATHWAY_RECEIPT_STATUSES);
      this.errors = Array.isArray(data.errors) ? data.errors.map(String) : [];
      this.trace = clonePlain(data.trace || null);
      deepFreeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        pathwayDefinitionId: this.pathwayDefinitionId,
        pathwayVersion: this.pathwayVersion,
        ruleId: this.ruleId,
        kind: this.kind,
        sourceSeasonKey: this.sourceSeasonKey,
        trigger: this.trigger,
        destination: this.destination,
        qualifiers: this.qualifiers,
        firstRoundPairing: this.firstRoundPairing,
        outcomeCode: this.outcomeCode,
        resolvedAt: this.resolvedAt,
        timeZoneId: this.timeZoneId,
        status: this.status,
        errors: this.errors,
        trace: this.trace,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionSeasonTransitionReceipt — commit atómico de un transition
  // group completo (sección 7.4 del prompt).
  // ---------------------------------------------------------------------
  class CompetitionSeasonTransitionReceipt {
    constructor(data = {}) {
      const label = `CompetitionSeasonTransitionReceipt "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.pathwayDefinitionId = requireField(label, data, 'pathwayDefinitionId');
      this.pathwayVersion = requireField(label, data, 'pathwayVersion');
      this.transitionGroupId = requireField(label, data, 'transitionGroupId');
      this.fromSeasonKey = requireField(label, data, 'fromSeasonKey');
      this.targetSeasonKey = requireField(label, data, 'targetSeasonKey');
      this.committedAt = requireField(label, data, 'committedAt');
      // memberships: [{ competitionDefinitionId, editionId, participantIds:[...] }]
      this.memberships = (Array.isArray(data.memberships) ? data.memberships : []).map((m) => clonePlain(m));
      // moves: [{ participantId, outcomeCode, fromCompetitionDefinitionId, toCompetitionDefinitionId, sourceReceiptId }]
      this.moves = (Array.isArray(data.moves) ? data.moves : []).map((m) => clonePlain(m));
      this.createdEditionIds = Array.isArray(data.createdEditionIds) ? [...data.createdEditionIds] : [];
      this.createdEntryIds = Array.isArray(data.createdEntryIds) ? [...data.createdEntryIds] : [];
      this.status = requireOneOf(label, 'status', data.status || 'committed', ['committed']);
      deepFreeze(this);
    }

    membershipFor(competitionDefinitionId) {
      return this.memberships.find((m) => m.competitionDefinitionId === competitionDefinitionId) || null;
    }

    toJSON() {
      return {
        id: this.id,
        pathwayDefinitionId: this.pathwayDefinitionId,
        pathwayVersion: this.pathwayVersion,
        transitionGroupId: this.transitionGroupId,
        fromSeasonKey: this.fromSeasonKey,
        targetSeasonKey: this.targetSeasonKey,
        committedAt: this.committedAt,
        memberships: clonePlain(this.memberships),
        moves: clonePlain(this.moves),
        createdEditionIds: [...this.createdEditionIds],
        createdEntryIds: [...this.createdEntryIds],
        status: this.status,
      };
    }
  }

  const exportsObj = {
    CompetitionPathwayRule,
    CompetitionPathwayDefinition,
    CompetitionPathwayReceipt,
    CompetitionSeasonTransitionReceipt,
    PATHWAY_DEFINITION_STATUSES,
    PATHWAY_RULE_KINDS,
    PATHWAY_TRIGGER_TYPES,
    PATHWAY_SELECTOR_TYPES,
    PATHWAY_SEED_POLICIES,
    PATHWAY_DESTINATION_TYPES,
    PATHWAY_RECEIPT_STATUSES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
