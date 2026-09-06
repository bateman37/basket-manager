// src/entities/WorldSimulation.js
// WORLD-SIM-1 (DESIGN.md 10.16) — vocabulario CERRADO de nivel de detalle
// (`playable|full|standard|abstract`) y las entidades planas que congelan
// cuánto simula el motor una `CompetitionEdition`/`Team` concretos:
// `WorldSimulationProfile` (decisión de la CARRERA, nunca del paquete de
// contenido), `TeamSimulationSnapshot` (fuerza/cobertura agregada de un
// equipo por temporada) y `CompetitionSimulationReceipt` (evidencia
// INMUTABLE de una resolución `standard`/`abstract`). Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Ningún literal de país/liga/competición aparece en este archivo —
// auditado en `scripts/test-world-sim1.js`.

(function (global) {
  // Orden de FIDELIDAD (invariante de vocabulario cerrado, DESIGN.md 10.16,
  // sección 6 del prompt): `playable > full > standard > abstract`. Ningún
  // nivel desconocido recibe fallback — `requireDetailLevel()` lanza.
  const DETAIL_LEVELS = ['playable', 'full', 'standard', 'abstract'];
  const ROSTER_COVERAGE_LEVELS = ['complete', 'partial', 'aggregate'];
  const SCOPE_TYPES = ['competition', 'area'];
  const RECEIPT_RESULT_TYPES = ['standings', 'bracket-summary'];

  function requireDetailLevel(ownerLabel, value) {
    if (!DETAIL_LEVELS.includes(value)) {
      throw new Error(`${ownerLabel}: "detailLevel" = "${value}" no válido — debe ser uno de ${DETAIL_LEVELS.join(', ')}.`);
    }
    return value;
  }

  function requireField(ownerLabel, data, field) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new Error(`${ownerLabel}: falta "${field}" explícito.`);
    }
    return data[field];
  }

  // ---------------------------------------------------------------------
  // Capacidades DERIVADAS de un nivel — nunca booleanos sueltos guardados
  // aparte que puedan contradecir al nivel (sección 6 del prompt:
  // "no guardes además isPlayable/usesFullMatchEngine/storesBoxScore").
  // ---------------------------------------------------------------------
  function capabilitiesForDetailLevel(level) {
    requireDetailLevel('capabilitiesForDetailLevel', level);
    const isMatchEngineLevel = level === 'playable' || level === 'full';
    return Object.freeze({
      detailLevel: level,
      // Único nivel que puede convertirse en parada de partido del usuario.
      allowsUserMatchStop: level === 'playable',
      // Unidad temporal que resuelve este nivel: un partido concreto, o una
      // fase entera de una sola vez.
      temporalUnit: level === 'abstract' ? 'phase' : 'match',
      // Cómo se produce el resultado.
      resolutionKind: isMatchEngineLevel ? 'match-engine' : (level === 'standard' ? 'compact-score' : 'aggregate-phase'),
      // ¿Guarda posesiones/rotaciones/lesiones/box score/telemetría por
      // jugador? Solo playable/full.
      hasIndividualMatchDetail: isMatchEngineLevel,
      // Cobertura de plantilla que este nivel EXIGE para poder resolver.
      requiredRosterCoverage: isMatchEngineLevel ? 'complete' : 'any',
    });
  }

  // Helper tipado (sección 10.2 del prompt): distingue un resultado
  // COMPLETO (playable/full, viene de `MatchEngine`) de uno COMPACTO
  // (`standard`) por la presencia de `result.simulation.kind`, en vez de
  // que cada consumidor adivine mirando si faltan campos.
  function hasIndividualMatchDetail(result) {
    return !(result && result.simulation && result.simulation.kind === 'compact-score');
  }

  // ---------------------------------------------------------------------
  // Cadena de áreas MÁS CERCANA -> raíz, para resolver un assignment de
  // `scopeType: 'area'` sin que el perfil conozca la jerarquía por sí
  // mismo (la resuelve quien SÍ tiene el `AreaRegistry`, ver
  // `CompetitionSimulationService.resolveDetailLevelForCompetition`).
  // ---------------------------------------------------------------------
  function resolveAreaChain(areasRegistry, startAreaId) {
    const chain = [];
    let cursor = startAreaId;
    const seen = new Set();
    while (cursor) {
      if (seen.has(cursor)) break; // AreaRegistry.validateHierarchy() ya audita ciclos — corte defensivo aquí.
      seen.add(cursor);
      chain.push(cursor);
      const area = areasRegistry.get(cursor);
      cursor = area ? area.parentAreaId : null;
    }
    return chain;
  }

  // ---------------------------------------------------------------------
  // WorldSimulationProfile — perfil de la CARRERA (nunca del paquete de
  // contenido), congelado tras construirse. Resolución determinista
  // (sección 7 del prompt): 1) competición exacta; 2) área más cercana en
  // la cadena aportada; 3) `defaultDetailLevel` explícito.
  // ---------------------------------------------------------------------
  class WorldSimulationProfile {
    constructor(data = {}) {
      const label = `WorldSimulationProfile "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.version = requireField(label, data, 'version');
      this.selectedAtGameDate = data.selectedAtGameDate || null;
      this.defaultDetailLevel = requireDetailLevel(label, data.defaultDetailLevel);
      this.provenance = data.provenance || null;

      const rawAssignments = Array.isArray(data.assignments) ? data.assignments : [];
      this._byScopeKey = new Map(); // `${scopeType}:${scopeId}` -> detailLevel
      this.assignments = rawAssignments.map((raw) => {
        const scopeType = requireField(label, raw, 'scopeType');
        if (!SCOPE_TYPES.includes(scopeType)) {
          throw new Error(`${label}: assignment "scopeType" = "${scopeType}" no válido — debe ser uno de ${SCOPE_TYPES.join(', ')}.`);
        }
        const scopeId = requireField(label, raw, 'scopeId');
        const detailLevel = requireDetailLevel(label, raw.detailLevel);
        const key = `${scopeType}:${scopeId}`;
        const existing = this._byScopeKey.get(key);
        if (existing !== undefined && existing !== detailLevel) {
          throw new Error(
            `${label}: dos assignments incompatibles para "${key}" ("${existing}" vs "${detailLevel}") — `
            + 'un mismo scope no puede resolver a dos niveles distintos (nunca se desempata por orden de array).',
          );
        }
        this._byScopeKey.set(key, detailLevel);
        return Object.freeze({
          scopeType, scopeId, detailLevel,
        });
      });
      Object.freeze(this.assignments);
      Object.freeze(this);
    }

    // `areaChain`: ids del área más cercana a la más lejana (sin incluir
    // necesariamente la raíz) — quien llama la construye con
    // `resolveAreaChain()`. Una competición mundial (`scopeAreaId: null`)
    // pasa `areaChain: []` y cae directamente en el default explícito.
    resolveDetailLevel({ competitionDefinitionId, areaChain } = {}) {
      if (competitionDefinitionId) {
        const exact = this._byScopeKey.get(`competition:${competitionDefinitionId}`);
        if (exact) return exact;
      }
      const chain = Array.isArray(areaChain) ? areaChain : [];
      for (let i = 0; i < chain.length; i += 1) {
        const found = this._byScopeKey.get(`area:${chain[i]}`);
        if (found) return found;
      }
      return this.defaultDetailLevel;
    }

    toJSON() {
      return {
        id: this.id,
        version: this.version,
        selectedAtGameDate: this.selectedAtGameDate,
        defaultDetailLevel: this.defaultDetailLevel,
        assignments: this.assignments.map((a) => ({ ...a })),
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // TeamSimulationSnapshot — fuerza/cobertura agregada de UN Team en UNA
  // temporada. Nunca duplica Club/Team/Squad/Player: `materializedPlayerIds`
  // solo REFERENCIA instancias ya vivas en el Player Registry.
  // ---------------------------------------------------------------------
  class TeamSimulationSnapshot {
    constructor(data = {}) {
      const label = `TeamSimulationSnapshot "${data.id || '?'}"`;
      this.teamId = requireField(label, data, 'teamId');
      this.seasonKey = requireField(label, data, 'seasonKey');
      this.id = data.id || `snapshot:${this.teamId}:${this.seasonKey}`;
      this.effectiveDetailLevel = requireDetailLevel(label, data.effectiveDetailLevel);
      this.rosterCoverage = requireField(label, data, 'rosterCoverage');
      if (!ROSTER_COVERAGE_LEVELS.includes(this.rosterCoverage)) {
        throw new Error(`${label}: "rosterCoverage" = "${this.rosterCoverage}" no válido — debe ser una de ${ROSTER_COVERAGE_LEVELS.join(', ')}.`);
      }
      this.materializedPlayerIds = Array.isArray(data.materializedPlayerIds) ? [...data.materializedPlayerIds] : [];
      if (!Number.isFinite(data.estimatedRosterSize) || data.estimatedRosterSize < 0) {
        throw new Error(`${label}: falta "estimatedRosterSize" numérico explícito.`);
      }
      this.estimatedRosterSize = data.estimatedRosterSize;
      const strength = data.strength || {};
      ['overall', 'offense', 'defense'].forEach((field) => {
        if (!Number.isFinite(strength[field])) {
          throw new Error(`${label}: falta "strength.${field}" numérico explícito — nunca un 50/reputación española por defecto.`);
        }
      });
      this.strength = { overall: strength.overall, offense: strength.offense, defense: strength.defense };
      this.strengthSource = requireField(label, data, 'strengthSource');
      this.generatedAtGameDate = data.generatedAtGameDate || null;
      this.provenance = data.provenance || null;
    }

    toJSON() {
      return {
        id: this.id,
        teamId: this.teamId,
        seasonKey: this.seasonKey,
        effectiveDetailLevel: this.effectiveDetailLevel,
        rosterCoverage: this.rosterCoverage,
        materializedPlayerIds: [...this.materializedPlayerIds],
        estimatedRosterSize: this.estimatedRosterSize,
        strength: { ...this.strength },
        strengthSource: this.strengthSource,
        generatedAtGameDate: this.generatedAtGameDate,
        provenance: this.provenance,
      };
    }
  }

  // ---------------------------------------------------------------------
  // CompetitionSimulationReceipt — evidencia PLANA e INMUTABLE de una
  // resolución `standard`/`abstract`. Nunca guarda instancias Team/Player,
  // `Map`, funciones ni el runtime — solo ids/instante/resultado plano
  // (invariante 13).
  // ---------------------------------------------------------------------
  class CompetitionSimulationReceipt {
    constructor(data = {}) {
      const label = `CompetitionSimulationReceipt "${data.id || '?'}"`;
      this.id = requireField(label, data, 'id');
      this.editionId = requireField(label, data, 'editionId');
      this.stageId = requireField(label, data, 'stageId');
      this.detailLevel = requireDetailLevel(label, data.detailLevel);
      this.algorithmVersion = requireField(label, data, 'algorithmVersion');
      this.resolvedAt = requireField(label, data, 'resolvedAt');
      this.timeZoneId = requireField(label, data, 'timeZoneId');
      this.participantIds = Array.isArray(data.participantIds) ? [...data.participantIds] : [];
      const result = data.result || {};
      if (!RECEIPT_RESULT_TYPES.includes(result.type)) {
        throw new Error(`${label}: "result.type" = "${result.type}" no válido — debe ser uno de ${RECEIPT_RESULT_TYPES.join(', ')}.`);
      }
      this.result = JSON.parse(JSON.stringify(result));
      this.seedFingerprint = requireField(label, data, 'seedFingerprint');
      this.status = data.status || 'resolved';
      this.provenance = data.provenance || 'estimated';
      Object.freeze(this.result);
      Object.freeze(this.participantIds);
      Object.freeze(this);
    }

    toJSON() {
      return {
        id: this.id,
        editionId: this.editionId,
        stageId: this.stageId,
        detailLevel: this.detailLevel,
        algorithmVersion: this.algorithmVersion,
        resolvedAt: this.resolvedAt,
        timeZoneId: this.timeZoneId,
        participantIds: [...this.participantIds],
        result: JSON.parse(JSON.stringify(this.result)),
        seedFingerprint: this.seedFingerprint,
        status: this.status,
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = {
    DETAIL_LEVELS,
    ROSTER_COVERAGE_LEVELS,
    capabilitiesForDetailLevel,
    hasIndividualMatchDetail,
    resolveAreaChain,
    WorldSimulationProfile,
    TeamSimulationSnapshot,
    CompetitionSimulationReceipt,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
