// src/entities/NationalTeam.js
// NATIONAL-TEAMS-1 (DESIGN.md 10.17) — modelo de dominio nacional: entidades
// PLANAS y serializables para elegibilidad, ventanas FIBA, listas,
// convocatorias y apariciones oficiales. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Ninguna de estas entidades reemplaza a `Team`/`Squad` (ver DESIGN.md
// sección 10.17.1: `Team.teamKind === 'national-team'` sigue siendo la
// entidad deportiva; `Squad` con `membershipContext: 'national-team-duty'`
// sigue siendo el contenedor operativo de convocados). Este archivo modela
// SOLO lo que no tenía representación: decisión de nacionalidad deportiva,
// ventana FIBA, lista/convocatoria y evidencia de aparición individual.
//
// Todos los `toJSON()` devuelven objetos/arrays planos — ids, strings,
// booleanos, números; nunca `Map`, funciones, DOM ni instancias vivas
// (invariante 19).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const GameDateTimeModule = dep('../utils/GameDateTime.js');

  function GDT() { return GameDateTimeModule.GameDateTime; }

  function requireField(label, data, field) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new Error(`${label}: falta "${field}" explícito.`);
    }
    return data[field];
  }

  function requireOneOf(label, field, value, allowed) {
    if (!allowed.includes(value)) {
      throw new Error(`${label}: "${field}" = "${value}" no válido — debe ser uno de ${allowed.join(', ')}.`);
    }
    return value;
  }

  function toArray(data, field) {
    return Array.isArray(data[field]) ? [...data[field]] : [];
  }

  // Transición de estado GENÉRICA — reutilizada por Selection/CallUp/Window
  // (sección 4 del prompt: "no un campo de estado mutable libre"). Permite
  // repetir el estado actual (idempotencia, sección 6: "reprocesar un item
  // ya resuelto es idempotente"), pero nunca saltar a un estado no
  // declarado como alcanzable desde el actual.
  function applyTransition(ownerLabel, transitions, current, next) {
    if (next === current) return next; // idempotente
    const allowed = transitions[current] || [];
    if (!allowed.includes(next)) {
      throw new Error(`${ownerLabel}: transición "${current}" -> "${next}" no permitida.`);
    }
    return next;
  }

  // =========================================================================
  // 1. NationalStatusDecision (sección 4.1 del prompt) — única forma
  //    autorizada de cerrar un caso de vínculo significativo, territorio
  //    dependiente, refugio/asilo, nacionalidad dudosa o cambio de
  //    selección. El motor NUNCA se arroga esta decisión.
  // =========================================================================
  const DECISION_STATUSES = ['pending', 'approved-unrestricted', 'approved-restricted', 'denied', 'superseded'];

  class NationalStatusDecision {
    constructor(data = {}) {
      const label = `NationalStatusDecision "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.playerId = requireField(label, data, 'playerId');
      this.federationOrganizationId = requireField(label, data, 'federationOrganizationId');
      this.representedAreaId = requireField(label, data, 'representedAreaId');
      this.status = requireOneOf(label, 'status', data.status, DECISION_STATUSES);
      this.basisCodes = toArray(data, 'basisCodes');
      this.evidenceIds = toArray(data, 'evidenceIds');
      this.authorityOrganizationId = data.authorityOrganizationId !== undefined ? data.authorityOrganizationId : null;
      this.validFrom = data.validFrom !== undefined ? data.validFrom : null;
      this.validTo = data.validTo !== undefined ? data.validTo : null;
      this.decidedAtGameDate = requireField(label, data, 'decidedAtGameDate');
      this.rulesetBundleId = requireField(label, data, 'rulesetBundleId');
      this.sourceRuleIds = toArray(data, 'sourceRuleIds');
      // Referencia a la decisión anterior que esta sustituye (cambio de
      // selección/rectificación) + contador ACUMULADO de cambios ya
      // APROBADOS para este jugador — nunca recalculado por otro lado.
      this.previousDecisionId = data.previousDecisionId !== undefined ? data.previousDecisionId : null;
      this.approvedChangeCount = Number.isFinite(data.approvedChangeCount) ? data.approvedChangeCount : 0;
      this.provenance = data.provenance || null;
    }

    isApproved() { return this.status === 'approved-unrestricted' || this.status === 'approved-restricted'; }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        federationOrganizationId: this.federationOrganizationId,
        representedAreaId: this.representedAreaId,
        status: this.status,
        basisCodes: [...this.basisCodes],
        evidenceIds: [...this.evidenceIds],
        authorityOrganizationId: this.authorityOrganizationId,
        validFrom: this.validFrom,
        validTo: this.validTo,
        decidedAtGameDate: this.decidedAtGameDate,
        rulesetBundleId: this.rulesetBundleId,
        sourceRuleIds: [...this.sourceRuleIds],
        previousDecisionId: this.previousDecisionId,
        approvedChangeCount: this.approvedChangeCount,
        provenance: this.provenance,
      };
    }
  }

  // =========================================================================
  // 2. NationalTeamWindow (sección 4.1) — ventana FIBA: plazos
  //    administrativos + servicio internacional, siempre con instante UTC +
  //    huso IANA explícito (nunca la hora del proceso) y cronología
  //    validada. `_resolvedSteps` es bookkeeping INTERNO (nunca `toJSON()`)
  //    para que la fuente del calendario mundial (`WorldCalendarCoordinator`)
  //    pueda dejar de listar un plazo ya resuelto sin depender de un
  //    "processed" ajeno — mismo problema que ya resuelven `MarketRegistry`/
  //    `LoanRegistry` con sus eventos programados, aquí resuelto en la
  //    propia ventana porque un `NationalTeamWindow` declara varios plazos
  //    distintos, no uno solo.
  // =========================================================================
  const WINDOW_KINDS = [
    'fiba-window', 'continental-championship', 'world-championship', 'olympic-qualifier', 'friendly', 'other',
  ];
  const WINDOW_STATUSES = ['planned', 'open', 'active', 'completed', 'cancelled'];
  const WINDOW_TRANSITIONS = {
    planned: ['open', 'cancelled'],
    open: ['active', 'cancelled'],
    active: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  const WINDOW_DUTY_STEPS = ['notice-due', 'preliminary-roster-due', 'final-roster-due', 'duty-starts', 'duty-ends'];

  class NationalTeamWindow {
    constructor(data = {}) {
      const label = `NationalTeamWindow "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.seasonKey = requireField(label, data, 'seasonKey');
      this.windowKind = requireOneOf(label, 'windowKind', data.windowKind, WINDOW_KINDS);
      this.organizerOrganizationId = requireField(label, data, 'organizerOrganizationId');
      // Explícitos pero OPCIONALES (sección 4.1: "opcionales pero
      // explícitos") — una ventana amistosa puede no tener competición
      // asociada todavía.
      this.competitionDefinitionId = data.competitionDefinitionId !== undefined ? data.competitionDefinitionId : null;
      this.competitionEditionId = data.competitionEditionId !== undefined ? data.competitionEditionId : null;
      this.rulesetBundleId = requireField(label, data, 'rulesetBundleId');
      this.timeZoneId = GDT().requireTimeZoneId(requireField(label, data, 'timeZoneId'));

      WINDOW_DUTY_STEPS.forEach((field) => {
        this[toCamel(field)] = GDT().requireInstant(requireField(label, data, toCamel(field)));
      });

      // Cronología validada (sección 4.1: "siempre... cronología
      // validada") — aviso <= lista preliminar <= lista final <= inicio de
      // servicio < fin de servicio (semiabierto, mismo criterio que
      // `LoanAgreement.isActiveOn`).
      if (GDT().compare(this.noticeDueAt, this.preliminaryRosterDueAt) > 0) {
        throw new Error(`${label}: "noticeDueAt" debe ser anterior o igual a "preliminaryRosterDueAt".`);
      }
      if (GDT().compare(this.preliminaryRosterDueAt, this.finalRosterDueAt) > 0) {
        throw new Error(`${label}: "preliminaryRosterDueAt" debe ser anterior o igual a "finalRosterDueAt".`);
      }
      if (GDT().compare(this.finalRosterDueAt, this.dutyStartsAt) > 0) {
        throw new Error(`${label}: "finalRosterDueAt" debe ser anterior o igual a "dutyStartsAt".`);
      }
      if (GDT().compare(this.dutyStartsAt, this.dutyEndsAt) >= 0) {
        throw new Error(`${label}: "dutyStartsAt" debe ser estrictamente anterior a "dutyEndsAt".`);
      }

      // Competiciones domésticas afectadas (nunca nombre de país/división) —
      // política de conflicto EXPLÍCITA cuando esta ventana solapa con un
      // partido de club; `null` = "no configurada" (bloquea con diagnóstico
      // explícito en vez de decidir en silencio, sección 6 del prompt).
      this.affectedCompetitionDefinitionIds = toArray(data, 'affectedCompetitionDefinitionIds');
      this.conflictPolicy = data.conflictPolicy ? { ...data.conflictPolicy } : null;

      this.status = requireOneOf(label, 'status', data.status || 'planned', WINDOW_STATUSES);
      this.sourceRefs = toArray(data, 'sourceRefs');
      this.provenance = data.provenance || null;

      this._resolvedSteps = new Set(Array.isArray(data._resolvedSteps) ? data._resolvedSteps : []);
    }

    setStatus(status) {
      this.status = applyTransition(`NationalTeamWindow "${this.id}"`, WINDOW_TRANSITIONS, this.status, status);
      return this;
    }

    hasResolvedStep(step) { return this._resolvedSteps.has(step); }

    markStepResolved(step) {
      if (!WINDOW_DUTY_STEPS.includes(step)) throw new Error(`NationalTeamWindow "${this.id}": paso desconocido "${step}".`);
      this._resolvedSteps.add(step);
      return this;
    }

    // ¿El instante dado cae DENTRO del servicio internacional? Semiabierto
    // (`dutyStartsAt <= instant < dutyEndsAt`) — mismo criterio que
    // `LoanAgreement.isActiveOn`.
    coversInstant(instant) {
      return GDT().compare(this.dutyStartsAt, instant) <= 0 && GDT().compare(instant, this.dutyEndsAt) < 0;
    }

    // ¿La FECHA CIVIL de un partido de club (en su propio huso) cae dentro
    // del servicio internacional, expresado en el huso de ESTA ventana? Se
    // compara por fecha civil (no por instante) porque un partido de club
    // llega con su fecha, no con la hora exacta de la ventana FIBA.
    coversLocalDate(localDate) {
      const startDate = GDT().localDateAt(this.dutyStartsAt, this.timeZoneId);
      const endDate = GDT().localDateAt(this.dutyEndsAt, this.timeZoneId);
      return localDate >= startDate && localDate < endDate;
    }

    toJSON() {
      return {
        id: this.id,
        seasonKey: this.seasonKey,
        windowKind: this.windowKind,
        organizerOrganizationId: this.organizerOrganizationId,
        competitionDefinitionId: this.competitionDefinitionId,
        competitionEditionId: this.competitionEditionId,
        rulesetBundleId: this.rulesetBundleId,
        timeZoneId: this.timeZoneId,
        noticeDueAt: this.noticeDueAt,
        preliminaryRosterDueAt: this.preliminaryRosterDueAt,
        finalRosterDueAt: this.finalRosterDueAt,
        dutyStartsAt: this.dutyStartsAt,
        dutyEndsAt: this.dutyEndsAt,
        affectedCompetitionDefinitionIds: [...this.affectedCompetitionDefinitionIds],
        conflictPolicy: this.conflictPolicy,
        status: this.status,
        sourceRefs: [...this.sourceRefs],
        provenance: this.provenance,
      };
    }
  }

  function toCamel(kebab) {
    // 'notice-due' -> 'noticeDueAt', 'duty-starts' -> 'dutyStartsAt'...
    const map = {
      'notice-due': 'noticeDueAt',
      'preliminary-roster-due': 'preliminaryRosterDueAt',
      'final-roster-due': 'finalRosterDueAt',
      'duty-starts': 'dutyStartsAt',
      'duty-ends': 'dutyEndsAt',
    };
    return map[kebab];
  }

  // =========================================================================
  // 3. NationalTeamSelection (sección 4.1) — lista preliminar/final de una
  //    selección para una ventana concreta. Inmutable en cuanto
  //    `final-filed` (invariante 8): la lista final SIEMPRE es subconjunto
  //    de la preliminar aprobada.
  // =========================================================================
  const SELECTION_STATUSES = ['draft', 'preliminary-filed', 'final-filed', 'released', 'cancelled'];
  const SELECTION_TRANSITIONS = {
    draft: ['preliminary-filed', 'cancelled'],
    'preliminary-filed': ['final-filed', 'cancelled'],
    'final-filed': ['released', 'cancelled'],
    released: [],
    cancelled: [],
  };

  class NationalTeamSelection {
    constructor(data = {}) {
      const label = `NationalTeamSelection "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.nationalTeamId = requireField(label, data, 'nationalTeamId');
      this.windowId = requireField(label, data, 'windowId');
      this.seasonKey = requireField(label, data, 'seasonKey');
      this.preliminaryPlayerIds = toArray(data, 'preliminaryPlayerIds');
      this.finalPlayerIds = toArray(data, 'finalPlayerIds');
      this.status = requireOneOf(label, 'status', data.status || 'draft', SELECTION_STATUSES);
      this.preliminaryFiledAt = data.preliminaryFiledAt !== undefined ? data.preliminaryFiledAt : null;
      this.finalFiledAt = data.finalFiledAt !== undefined ? data.finalFiledAt : null;
      this.releasedAt = data.releasedAt !== undefined ? data.releasedAt : null;
      this.rulesetBundleId = requireField(label, data, 'rulesetBundleId');
      this.trace = data.trace ? { ...data.trace } : { sourceRuleIds: [] };
      this.warnings = toArray(data, 'warnings');
    }

    setStatus(status) {
      this.status = applyTransition(`NationalTeamSelection "${this.id}"`, SELECTION_TRANSITIONS, this.status, status);
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        nationalTeamId: this.nationalTeamId,
        windowId: this.windowId,
        seasonKey: this.seasonKey,
        preliminaryPlayerIds: [...this.preliminaryPlayerIds],
        finalPlayerIds: [...this.finalPlayerIds],
        status: this.status,
        preliminaryFiledAt: this.preliminaryFiledAt,
        finalFiledAt: this.finalFiledAt,
        releasedAt: this.releasedAt,
        rulesetBundleId: this.rulesetBundleId,
        trace: { ...this.trace },
        warnings: [...this.warnings],
      };
    }
  }

  // =========================================================================
  // 4. NationalTeamCallUp (sección 4.1) — convocatoria de UN jugador para
  //    UNA ventana. `clubTeamId` es una FOTO tomada al convocar (nunca se
  //    actualiza si el jugador cambia de club después) — nunca implica
  //    ningún movimiento real de `Team.roster`/`player.teamId`.
  // =========================================================================
  const CALLUP_STATUSES = ['selected', 'notified', 'joined', 'released', 'withdrawn'];
  const CALLUP_TRANSITIONS = {
    selected: ['notified', 'withdrawn'],
    notified: ['joined', 'withdrawn'],
    joined: ['released'],
    released: [],
    withdrawn: [],
  };

  class NationalTeamCallUp {
    constructor(data = {}) {
      const label = `NationalTeamCallUp "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.selectionId = requireField(label, data, 'selectionId');
      this.windowId = requireField(label, data, 'windowId');
      this.nationalTeamId = requireField(label, data, 'nationalTeamId');
      this.playerId = requireField(label, data, 'playerId');
      // Foto del club de servicio EN EL MOMENTO de convocar — `null` si el
      // jugador no tenía club afiliado entonces (nunca se recalcula).
      this.clubTeamId = data.clubTeamId !== undefined ? data.clubTeamId : null;
      this.status = requireOneOf(label, 'status', data.status || 'selected', CALLUP_STATUSES);
      this.notifiedAt = data.notifiedAt !== undefined ? data.notifiedAt : null;
      this.joinedAt = data.joinedAt !== undefined ? data.joinedAt : null;
      this.releasedAt = data.releasedAt !== undefined ? data.releasedAt : null;
      this.withdrawalReason = data.withdrawalReason !== undefined ? data.withdrawalReason : null;
      // Referencias/metadatos de seguro/gastos — NUNCA muta economía real
      // (sección 4.1: "como referencias o metadatos, sin mutar economía").
      this.logisticsRefs = data.logisticsRefs ? { ...data.logisticsRefs } : {};
      this.trace = data.trace ? { ...data.trace } : { sourceRuleIds: [] };
      this.provenance = data.provenance || null;
    }

    setStatus(status, extra = {}) {
      this.status = applyTransition(`NationalTeamCallUp "${this.id}"`, CALLUP_TRANSITIONS, this.status, status);
      if (status === 'notified' && extra.notifiedAt !== undefined) this.notifiedAt = extra.notifiedAt;
      if (status === 'joined' && extra.joinedAt !== undefined) this.joinedAt = extra.joinedAt;
      if (status === 'released' && extra.releasedAt !== undefined) this.releasedAt = extra.releasedAt;
      if (status === 'withdrawn' && extra.withdrawalReason !== undefined) this.withdrawalReason = extra.withdrawalReason;
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        selectionId: this.selectionId,
        windowId: this.windowId,
        nationalTeamId: this.nationalTeamId,
        playerId: this.playerId,
        clubTeamId: this.clubTeamId,
        status: this.status,
        notifiedAt: this.notifiedAt,
        joinedAt: this.joinedAt,
        releasedAt: this.releasedAt,
        withdrawalReason: this.withdrawalReason,
        logisticsRefs: { ...this.logisticsRefs },
        trace: { ...this.trace },
        provenance: this.provenance,
      };
    }
  }

  // =========================================================================
  // 5. NationalTeamAppearanceReceipt (sección 4.1) — evidencia INMUTABLE de
  //    una aparición individual REAL. Lista final/convocatoria/resultado
  //    agregado NUNCA equivalen a jugar — por eso `detailLevel` se valida
  //    AQUÍ contra el vocabulario cerrado y se RECHAZA `standard`/`abstract`
  //    (invariante 15: un resultado compacto/agregado nunca fabrica una
  //    aparición individual).
  // =========================================================================
  const APPEARANCE_ALLOWED_DETAIL_LEVELS = ['playable', 'full'];

  class NationalTeamAppearanceReceipt {
    constructor(data = {}) {
      const label = `NationalTeamAppearanceReceipt "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.playerId = requireField(label, data, 'playerId');
      this.nationalTeamId = requireField(label, data, 'nationalTeamId');
      this.federationOrganizationId = requireField(label, data, 'federationOrganizationId');
      this.competitionEditionId = requireField(label, data, 'competitionEditionId');
      this.stageId = requireField(label, data, 'stageId');
      this.matchId = requireField(label, data, 'matchId');
      this.date = requireField(label, data, 'date');
      this.official = Boolean(data.official);
      this.detailLevel = requireOneOf(
        label, 'detailLevel', data.detailLevel, APPEARANCE_ALLOWED_DETAIL_LEVELS,
      );
      this.source = data.source || null;
      this.trace = data.trace ? { ...data.trace } : { sourceRuleIds: [] };
      Object.freeze(this.trace);
      Object.freeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        nationalTeamId: this.nationalTeamId,
        federationOrganizationId: this.federationOrganizationId,
        competitionEditionId: this.competitionEditionId,
        stageId: this.stageId,
        matchId: this.matchId,
        date: this.date,
        official: this.official,
        detailLevel: this.detailLevel,
        source: this.source,
        trace: { ...this.trace },
      };
    }
  }

  const exportsObj = {
    NationalStatusDecision,
    NationalTeamWindow,
    NationalTeamSelection,
    NationalTeamCallUp,
    NationalTeamAppearanceReceipt,
    DECISION_STATUSES,
    WINDOW_KINDS,
    WINDOW_STATUSES,
    WINDOW_DUTY_STEPS,
    SELECTION_STATUSES,
    CALLUP_STATUSES,
    APPEARANCE_ALLOWED_DETAIL_LEVELS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
