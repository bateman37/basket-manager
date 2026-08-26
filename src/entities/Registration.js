// src/entities/Registration.js
// REG-1 (DESIGN.md 9.18) — Entidades de inscripción, licencia, vinculación
// y acta: la tercera pieza canónica de la EPIC "Ciclo profesional de
// plantilla", separada de identidad (PlayerRegistry, ROSTER-1) y de
// contrato (ContractRegistry, CONTRACT-1). Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Igualdad conceptual permanente (CLAUDE.md):
//   identidad mundial != afiliación actual != contrato laboral
//                     != licencia federativa != inscripción en competición
//                     != inscripción activa en jornada != elegibilidad de
//                        partido != selección en acta != autorización
//                        internacional
//
// Este archivo SOLO define forma/validación/derivación de cada entidad —
// nunca resuelve normativa (eso es CompetitionRules.js) ni decide CUÁNDO
// crear/mutar una entidad (eso es RegistrationService.js). El registro
// (RegistrationRegistry.js) solo guarda IDs hacia jugador/club/contrato,
// nunca clona `Player`/`Contract`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const EventTypesModule = isNode ? require('../core/RegistrationEventTypes.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function EventTypes() { return EventTypesModule.RegistrationEventTypes; }
  function LD() { return LocalDateModule.LocalDate; }

  function toIso(date) {
    if (!date) throw new Error('Registration: hace falta una fecha para resolver el estado.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // Aplica un evento nuevo a una lista de eventos ya validada — lanza si la
  // transición/cronología/id no son válidas (sección 7.4: "un evento
  // desconocido o una transición imposible se rechaza"). Devuelve la nueva
  // lista ordenada (no muta el array recibido).
  function appendValidatedEvent(events, event, label) {
    const check = EventTypes().validateEvent(event, events);
    if (!check.valid) {
      throw new Error(`${label}: evento regulatorio inválido — ${check.errors.join(' | ')}`);
    }
    return [...events, event].sort((a, b) => (
      EventTypes().eventSortKey(a) < EventTypes().eventSortKey(b) ? -1 : 1
    ));
  }

  // ---------------------------------------------------------------------
  // 1. FederationLicense (sección 7.2 del prompt de REG-1)
  // ---------------------------------------------------------------------
  const LICENSE_CLASSES = ['professional-senior', 'own-lower-category', 'linked-player'];

  class FederationLicense {
    constructor(data = {}) {
      if (!data.id) throw new Error('FederationLicense: falta "id".');
      if (!data.playerId) throw new Error('FederationLicense: falta "playerId".');
      if (!data.clubId) throw new Error('FederationLicense: falta "clubId".');
      if (!data.federationId) throw new Error('FederationLicense: falta "federationId".');
      if (!data.seasonKey) throw new Error('FederationLicense: falta "seasonKey".');
      this.id = data.id;
      this.playerId = data.playerId;
      this.clubId = data.clubId;
      this.federationId = data.federationId;
      this.seasonKey = data.seasonKey;
      this.licenseClass = LICENSE_CLASSES.includes(data.licenseClass) ? data.licenseClass : 'professional-senior';
      // Vigencia declarada por el Manual/federación resuelta (sección 7.2:
      // "la licencia FEB dura una temporada según el Manual; no establezcas
      // esa duración como universal") — se guarda tal cual la resolvió
      // RegistrationService, nunca recalculada aquí.
      this.validity = { startDate: data.validity && data.validity.startDate ? data.validity.startDate : null, endDate: data.validity && data.validity.endDate ? data.validity.endDate : null };
      // Estados de documentos exigidos (sección 5.1/5.2: "modela estados de
      // documentos, no documentos personales reales") — código -> estado.
      this.documentStatuses = { ...(data.documentStatuses || {}) };
      this.events = [];
      (data.events || []).forEach((event) => this.addEvent(event));
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
        generatorVersion: data.provenance ? data.provenance.generatorVersion : null,
        seedFingerprint: data.provenance ? data.provenance.seedFingerprint : null,
      };
      this.trace = { sourceRuleIds: [], ...(data.trace || {}) };
    }

    addEvent(event) {
      this.events = appendValidatedEvent(this.events, event, `FederationLicense "${this.id}"`);
      return this;
    }

    setDocumentStatus(code, status) {
      this.documentStatuses[code] = status;
    }

    statusOn(date) {
      return EventTypes().deriveStatus(this.events, toIso(date));
    }

    isValidOn(date) {
      const iso = toIso(date);
      const withinValidity = LD().isWithinInclusive(iso, this.validity.startDate, this.validity.endDate);
      return withinValidity && this.statusOn(iso) === 'active';
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        clubId: this.clubId,
        federationId: this.federationId,
        seasonKey: this.seasonKey,
        licenseClass: this.licenseClass,
        validity: this.validity,
        documentStatuses: this.documentStatuses,
        events: this.events,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // 2. CompetitionRegistration (sección 7.3 del prompt de REG-1)
  // ---------------------------------------------------------------------
  const ACCESS_CATEGORIES = ['senior', 'own-lower-category', 'linked', 'additional-list'];

  class CompetitionRegistration {
    constructor(data = {}) {
      ['id', 'playerId', 'licenseId', 'teamId', 'competitionId', 'registrationScopeId', 'seasonKey'].forEach((field) => {
        if (!data[field]) throw new Error(`CompetitionRegistration: falta "${field}".`);
      });
      if (!ACCESS_CATEGORIES.includes(data.accessCategory)) {
        throw new Error(`CompetitionRegistration: "accessCategory" debe ser uno de ${ACCESS_CATEGORIES.join(', ')} (recibido: "${data.accessCategory}").`);
      }
      this.id = data.id;
      this.playerId = data.playerId;
      this.licenseId = data.licenseId;
      this.teamId = data.teamId;
      this.competitionId = data.competitionId;
      this.competitionInstanceId = data.competitionInstanceId || data.competitionId;
      this.registrationScopeId = data.registrationScopeId;
      this.seasonKey = data.seasonKey;
      this.accessCategory = data.accessCategory;
      // Referencia al contrato exigido, SIN copiarlo (sección 7.3).
      this.contractId = data.contractId || null;
      // Snapshot de clasificación/aprobación usado en el momento del alta
      // (formación/no-comunitario) — INMUTABLE una vez creado, ver
      // RegulatoryClassificationService.
      this.classificationSnapshot = data.classificationSnapshot ? { ...data.classificationSnapshot } : null;
      // ¿Este alta computó para el máximo acumulado de la temporada? Y por
      // qué — decisión CONGELADA en el momento del alta (sección 6.4: "una
      // actualización futura de reglas no reescribe la historia").
      this.cumulativeCap = {
        counted: data.cumulativeCap ? Boolean(data.cumulativeCap.counted) : false,
        reasonCode: data.cumulativeCap ? data.cumulativeCap.reasonCode : null,
      };
      this.moduleVersionsPinned = { ...(data.moduleVersionsPinned || {}) };
      this.events = [];
      (data.events || []).forEach((event) => this.addEvent(event));
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
        generatorVersion: data.provenance ? data.provenance.generatorVersion : null,
        seedFingerprint: data.provenance ? data.provenance.seedFingerprint : null,
      };
      this.trace = { sourceRuleIds: [], ...(data.trace || {}) };
    }

    addEvent(event) {
      this.events = appendValidatedEvent(this.events, event, `CompetitionRegistration "${this.id}"`);
      return this;
    }

    statusOn(date) {
      return EventTypes().deriveStatus(this.events, toIso(date));
    }

    isEffectiveOn(date) {
      return this.statusOn(date) === 'active';
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        licenseId: this.licenseId,
        teamId: this.teamId,
        competitionId: this.competitionId,
        competitionInstanceId: this.competitionInstanceId,
        registrationScopeId: this.registrationScopeId,
        seasonKey: this.seasonKey,
        accessCategory: this.accessCategory,
        contractId: this.contractId,
        classificationSnapshot: this.classificationSnapshot,
        cumulativeCap: this.cumulativeCap,
        events: this.events,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // 3. ClubLinkAgreement (sección 7.5 del prompt de REG-1)
  // ---------------------------------------------------------------------
  // Direcciones de vinculación (sección 5.4): un mismo acuerdo puede
  // declarar listas en AMBAS direcciones (ACB/FEB art. 18: hasta 4
  // comunitarios sub-22 con licencia senior del club INFERIOR hacia el
  // superior, y — solo FEB — hasta 5 junior/cadete del club SUPERIOR hacia
  // el inferior). Nunca un único número sin dirección.
  const LINK_DIRECTIONS = ['lowerToUpper', 'upperToLower'];
  const LINK_AGREEMENT_STATUSES = ['formalized', 'ineffective', 'terminated'];

  class ClubLinkAgreement {
    constructor(data = {}) {
      ['id', 'lowerClubId', 'upperClubId', 'competitionId', 'federationId', 'seasonKey', 'formalizedDate'].forEach((field) => {
        if (!data[field]) throw new Error(`ClubLinkAgreement: falta "${field}".`);
      });
      this.id = data.id;
      this.lowerClubId = data.lowerClubId;
      this.upperClubId = data.upperClubId;
      this.competitionId = data.competitionId;
      this.federationId = data.federationId;
      this.seasonKey = data.seasonKey;
      this.formalizedDate = data.formalizedDate;
      this.status = LINK_AGREEMENT_STATUSES.includes(data.status) ? data.status : 'formalized';
      // Listas por dirección — cada entrada es un playerId, no una copia
      // del jugador. `modifiable` (sección 7.5): la regla general FEB las
      // congela durante la temporada; la especialidad ACB puede permitir
      // actualizarlas dentro de su ventana — declarado como OVERLAY
      // explícito, nunca "el último objeto gana" (sección 5.4 del prompt).
      this.lists = {
        lowerToUpper: Array.isArray(data.lists && data.lists.lowerToUpper) ? [...data.lists.lowerToUpper] : [],
        upperToLower: Array.isArray(data.lists && data.lists.upperToLower) ? [...data.lists.upperToLower] : [],
      };
      this.limits = {
        lowerToUpper: (data.limits && data.limits.lowerToUpper) || 0,
        upperToLower: (data.limits && data.limits.upperToLower) || 0,
      };
      this.modifiable = {
        lowerToUpper: Boolean(data.modifiable && data.modifiable.lowerToUpper),
        upperToLower: Boolean(data.modifiable && data.modifiable.upperToLower),
      };
      this.windowUpdateOverlay = data.windowUpdateOverlay || null;
      this.ageCategoryConstraint = data.ageCategoryConstraint || null;
      this.citizenshipRequirement = data.citizenshipRequirement || null;
      this.documentEvidences = Array.isArray(data.documentEvidences) ? [...data.documentEvidences] : [];
      this.events = Array.isArray(data.events) ? [...data.events] : [];
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
      };
      this.trace = { sourceRuleIds: [], ...(data.trace || {}) };
    }

    addToList(direction, playerId) {
      if (!LINK_DIRECTIONS.includes(direction)) throw new Error(`ClubLinkAgreement: dirección "${direction}" desconocida.`);
      if (this.lists[direction].length >= this.limits[direction]) {
        throw new Error(
          `ClubLinkAgreement "${this.id}": la lista "${direction}" ya tiene el máximo de ${this.limits[direction]} jugadores.`,
        );
      }
      if (this.lists[direction].includes(playerId)) return this;
      this.lists[direction].push(playerId);
      return this;
    }

    removeFromList(direction, playerId) {
      this.lists[direction] = this.lists[direction].filter((id) => id !== playerId);
      return this;
    }

    // Ineficacia cuando ambos clubes compiten en la MISMA competición
    // (sección 5.4: "ineficacia de la vinculación cuando los clubes
    // participan en la misma competición").
    isEffectiveForCompetition(lowerClubCompetitionId, upperClubCompetitionId) {
      if (this.status !== 'formalized') return false;
      if (lowerClubCompetitionId === upperClubCompetitionId) return false;
      return true;
    }

    listContains(direction, playerId) {
      return this.lists[direction].includes(playerId);
    }

    toJSON() {
      return {
        id: this.id,
        lowerClubId: this.lowerClubId,
        upperClubId: this.upperClubId,
        competitionId: this.competitionId,
        federationId: this.federationId,
        seasonKey: this.seasonKey,
        formalizedDate: this.formalizedDate,
        status: this.status,
        lists: this.lists,
        limits: this.limits,
      };
    }
  }

  // ---------------------------------------------------------------------
  // 4. MatchActSnapshot (sección 7.6 del prompt de REG-1)
  // ---------------------------------------------------------------------
  class MatchActSnapshot {
    constructor(data = {}) {
      ['id', 'matchId', 'competitionId', 'registrationScopeId', 'seasonKey', 'teamId', 'matchDateTime', 'selectedPlayers'].forEach((field) => {
        if (data[field] === undefined || data[field] === null) throw new Error(`MatchActSnapshot: falta "${field}".`);
      });
      this.id = data.id;
      this.matchId = data.matchId;
      this.roundId = data.roundId !== undefined ? data.roundId : null;
      this.phaseId = data.phaseId || null;
      this.competitionId = data.competitionId;
      this.competitionInstanceId = data.competitionInstanceId || data.competitionId;
      this.registrationScopeId = data.registrationScopeId;
      this.seasonKey = data.seasonKey;
      this.teamId = data.teamId;
      this.matchDateTime = data.matchDateTime;
      // [{ playerId, accessCategory, classification, formationQualifies, nonCommunitySlotCounts }]
      this.selectedPlayers = data.selectedPlayers.map((entry) => ({ ...entry }));
      this.squadValidation = data.squadValidation ? { ...data.squadValidation } : null;
      this.rulesTrace = data.rulesTrace ? { ...data.rulesTrace } : null;
      this.configuredAt = data.configuredAt || null;
      this.warnings = Array.isArray(data.warnings) ? [...data.warnings] : [];
      Object.freeze(this.selectedPlayers);
    }

    includesPlayer(playerId) {
      return this.selectedPlayers.some((entry) => entry.playerId === playerId);
    }

    toJSON() {
      return {
        id: this.id,
        matchId: this.matchId,
        roundId: this.roundId,
        phaseId: this.phaseId,
        competitionId: this.competitionId,
        registrationScopeId: this.registrationScopeId,
        seasonKey: this.seasonKey,
        teamId: this.teamId,
        matchDateTime: this.matchDateTime,
        selectedPlayers: this.selectedPlayers,
        squadValidation: this.squadValidation,
        warnings: this.warnings,
      };
    }
  }

  // ---------------------------------------------------------------------
  // 5. PlayerRegulatoryProfile (sección 7.1 del prompt de REG-1)
  // ---------------------------------------------------------------------
  const PROVENANCE_LEVELS = ['verified', 'simulated', 'unknown'];

  class PlayerRegulatoryProfile {
    constructor(data = {}) {
      if (!data.playerId) throw new Error('PlayerRegulatoryProfile: falta "playerId".');
      this.playerId = data.playerId;
      // Ciudadanías declaradas con vigencia y procedencia (sección 7.1).
      this.citizenships = (data.citizenships || []).map((c) => ({
        countryCode: c.countryCode,
        validFrom: c.validFrom || null,
        validTo: c.validTo || null,
        source: c.source || null,
        isReal: Boolean(c.isReal),
        dataSource: c.dataSource || null,
      }));
      // Periodos de formación por club/federación/categoría (art. 28 FEB).
      this.trainingPeriods = (data.trainingPeriods || []).map((p) => ({
        clubId: p.clubId || null,
        federationId: p.federationId || null,
        category: p.category || null,
        fromDate: p.fromDate,
        toDate: p.toDate,
        monthsCounted: p.monthsCounted !== undefined ? p.monthsCounted : null,
        isReal: Boolean(p.isReal),
        dataSource: p.dataSource || null,
      }));
      this.nationalTeamAppearances = Array.isArray(data.nationalTeamAppearances) ? [...data.nationalTeamAppearances] : [];
      // Evidencias de igualdad de trato / vínculo familiar / transición
      // (sección 5.3: Brexit, exención familiar, adopción sin vínculo).
      this.equalTreatmentEvidences = Array.isArray(data.equalTreatmentEvidences) ? [...data.equalTreatmentEvidences] : [];
      // Clasificaciones aprobadas DIRECTAMENTE por el organizador (ACB) o
      // snapshots simulados, por competición+temporada — nunca reutilizadas
      // entre competiciones (sección 6.3: "no uses una clasificación
      // calculada para Primera FEB en ACB").
      this.organizerApprovedClassifications = Array.isArray(data.organizerApprovedClassifications)
        ? data.organizerApprovedClassifications.map((c) => ({ ...c })) : [];
      this.documentStatuses = { ...(data.documentStatuses || {}) };
      this.provenance = PROVENANCE_LEVELS.includes(data.provenance) ? data.provenance : 'unknown';
      this.dataSource = data.dataSource || null;
    }

    citizenshipsOn(date) {
      const iso = toIso(date);
      return this.citizenships.filter((c) => LD().isWithinInclusive(iso, c.validFrom, c.validTo));
    }

    organizerApprovedClassificationFor(competitionId, seasonKey) {
      return this.organizerApprovedClassifications.find(
        (c) => c.competitionId === competitionId && c.seasonKey === seasonKey,
      ) || null;
    }

    toJSON() {
      return {
        playerId: this.playerId,
        citizenships: this.citizenships,
        trainingPeriods: this.trainingPeriods,
        nationalTeamAppearances: this.nationalTeamAppearances,
        equalTreatmentEvidences: this.equalTreatmentEvidences,
        organizerApprovedClassifications: this.organizerApprovedClassifications,
        documentStatuses: this.documentStatuses,
        provenance: this.provenance,
        dataSource: this.dataSource,
      };
    }
  }

  const exportsObj = {
    FederationLicense,
    CompetitionRegistration,
    ClubLinkAgreement,
    MatchActSnapshot,
    PlayerRegulatoryProfile,
    LICENSE_CLASSES,
    ACCESS_CATEGORIES,
    LINK_DIRECTIONS,
    LINK_AGREEMENT_STATUSES,
    PROVENANCE_LEVELS,
  };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
