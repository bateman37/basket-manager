// src/core/CompetitionSimulationService.js
// WORLD-SIM-1 (DESIGN.md 10.16) — servicio GENÉRICO que decide CÓMO se
// produce el resultado de una fase/partido según el `detailLevel`
// congelado de su `CompetitionEdition`: `playable`/`full` no lo consultan
// (siguen usando exactamente el `MatchEngine` actual, vía los runners de
// `CompetitionRunners.js`); `standard` le pide un marcador COMPACTO
// determinista; `abstract` le pide construir/resolver el runtime agregado
// de `AbstractCompetitionStageRuntime.js`. Instancia EXPLÍCITA por carrera
// (nunca singleton, nunca lee `state`/DOM/reloj de sistema/aleatoriedad
// propia — el hash determinista de `DeterministicRandom` sustituye
// cualquier `Math.random()`). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Ningún literal de país/liga/competición aparece en este archivo —
// auditado en `scripts/test-world-sim1.js`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const WorldSimulationModule = dep('../entities/WorldSimulation.js');
  const AbstractRuntimeModule = dep('./AbstractCompetitionStageRuntime.js');
  const DeterministicRandomModule = dep('../utils/DeterministicRandom.js');
  const SeasonGoalsModule = dep('./SeasonGoals.js');

  function DR() { return DeterministicRandomModule.DeterministicRandom; }

  // --- Simulador compacto "standard" (sección 10.2 del prompt) -----------
  const STANDARD_ALGORITHM_VERSION = 'standard-score-v1';
  const HOME_ADVANTAGE_POINTS = 3;
  const BASE_SCORE = 74;
  const SCORE_SCALE = 0.6; // puntos por punto de diferencia de fuerza (escala 0-100)
  const JITTER_RANGE = 14;
  const OVERTIME_MARGIN = 4;
  const MIN_TEAM_SCORE = 55;

  function computeCompactScore({ homeStrength, awayStrength, fingerprint }) {
    const diff = homeStrength.overall - awayStrength.overall;
    const homeExpected = BASE_SCORE + diff * SCORE_SCALE + HOME_ADVANTAGE_POINTS;
    const awayExpected = BASE_SCORE - diff * SCORE_SCALE;
    const homeJitter = (DR().unitFrom(fingerprint, 'home-jitter') - 0.5) * JITTER_RANGE;
    const awayJitter = (DR().unitFrom(fingerprint, 'away-jitter') - 0.5) * JITTER_RANGE;
    let home = Math.round(Math.max(MIN_TEAM_SCORE, homeExpected + homeJitter));
    let away = Math.round(Math.max(MIN_TEAM_SCORE, awayExpected + awayJitter));
    // Invariante: "standard" nunca deja empate — se resuelve como una
    // prórroga compacta determinista (un tercer hash independiente decide
    // el lado que se lleva el margen, nunca el mismo hash que ya decidió el
    // marcador base).
    if (home === away) {
      if (DR().unitFrom(fingerprint, 'ot-winner') >= 0.5) home += OVERTIME_MARGIN; else away += OVERTIME_MARGIN;
    }
    return {
      finalScore: { home, away },
      // Ausencia EXPLÍCITA de detalle individual — nunca `[]`/objetos
      // vacíos que un consumidor pudiera confundir con "sin datos todavía".
      quarterScores: null,
      boxScore: null,
      simulation: {
        kind: 'compact-score',
        algorithmVersion: STANDARD_ALGORITHM_VERSION,
        seedFingerprint: fingerprint,
        homeAdvantage: HOME_ADVANTAGE_POINTS,
      },
    };
  }

  function requireDep(value, label) {
    if (!value) throw new Error(`CompetitionSimulationService: falta "${label}" explícito.`);
    return value;
  }

  class CompetitionSimulationService {
    // `matchEngineResolver`: referencia informativa al resolutor completo
    // de partido (`MatchEngine.simulateMatch`) — esta entrega no lo invoca
    // directamente (playable/full siguen resolviéndose dentro del runner
    // sin pasar por este servicio; standard/abstract nunca simulan
    // posesión a posesión), se acepta/guarda para que una ampliación futura
    // (niveles intermedios) no necesite cambiar la firma del constructor.
    constructor({
      world, careerSeed, formatCatalog, pathwayCatalog, matchEngineResolver, now,
    } = {}) {
      this.world = requireDep(world, 'world');
      this.careerSeed = requireDep(careerSeed, 'careerSeed');
      this._formatCatalog = formatCatalog || null;
      this._pathwayCatalog = pathwayCatalog || null;
      this._matchEngineResolver = matchEngineResolver || null;
      this._now = now || null;
    }

    // -------------------------------------------------------------------
    // Resolución de nivel (sección 7 del prompt) — SIEMPRE por identidad
    // mundial (competición exacta -> área más cercana -> default), nunca
    // por `division`/nombre/país supuesto.
    // -------------------------------------------------------------------
    resolveDetailLevelForCompetition(competitionDefinitionId) {
      if (!this.world.simulationProfile) {
        throw new Error(
          'CompetitionSimulationService.resolveDetailLevelForCompetition: el mundo no tiene "simulationProfile" '
          + 'asignado — asígnalo con "world.setSimulationProfile()" antes de instalar contenido.',
        );
      }
      const definition = this.world.registries.competitionDefinitions.require(competitionDefinitionId);
      const areaChain = definition.scopeAreaId
        ? WorldSimulationModule.resolveAreaChain(this.world.registries.areas, definition.scopeAreaId)
        : [];
      return this.world.simulationProfile.resolveDetailLevel({ competitionDefinitionId, areaChain });
    }

    // -------------------------------------------------------------------
    // Snapshots de simulación de equipo (sección 9 del prompt).
    // -------------------------------------------------------------------
    registerSnapshot(data) {
      const snapshot = data instanceof WorldSimulationModule.TeamSimulationSnapshot
        ? data : new WorldSimulationModule.TeamSimulationSnapshot(data);
      return this.world.registries.registerTeamSimulationSnapshot(snapshot);
    }

    // Fórmula VERSIONADA y determinista reutilizando la calidad YA
    // disponible de un roster COMPLETO (`SeasonGoals.top8Rating`, la misma
    // que ya usa el cálculo de `sportingGoal`) — nunca para cobertura
    // parcial/agregada, que exige fuerza aportada por el contenido
    // (sección 9: "nunca uses 50 o reputación española por defecto").
    deriveSnapshotFromRoster(team, seasonKey, options = {}) {
      if (!team || !team.roster || !team.roster.length) {
        throw new Error(`CompetitionSimulationService.deriveSnapshotFromRoster: el equipo "${team && team.id}" no tiene roster completo cargado.`);
      }
      const overall = SeasonGoalsModule().top8Rating(team.roster);
      return this.registerSnapshot({
        teamId: team.id,
        seasonKey,
        effectiveDetailLevel: options.effectiveDetailLevel || 'standard',
        rosterCoverage: 'complete',
        materializedPlayerIds: team.roster.map((p) => p.id),
        estimatedRosterSize: team.roster.length,
        strength: { overall, offense: overall, defense: overall },
        strengthSource: 'derived-roster-formula-v1',
        generatedAtGameDate: options.generatedAtGameDate || null,
        provenance: { status: 'derived', notes: 'Fórmula determinista sobre roster completo (SeasonGoals.top8Rating) — DESIGN.md 10.16.' },
      });
    }

    snapshotForTeamSeason(teamId, seasonKey) {
      return this.world.registries.teamSimulationSnapshots.forTeamSeason(teamId, seasonKey);
    }

    requireSnapshot(teamId, seasonKey) {
      const snapshot = this.snapshotForTeamSeason(teamId, seasonKey);
      if (!snapshot) {
        throw new Error(
          `CompetitionSimulationService: falta TeamSimulationSnapshot para "${teamId}"/"${seasonKey}" — "standard"/`
          + '"abstract" nunca resuelven sin fuerza agregada explícita.',
        );
      }
      return snapshot;
    }

    // -------------------------------------------------------------------
    // Cobertura exigida por nivel (sección 9 del prompt) — `playable`/
    // `full` necesitan roster REAL completo; `standard`/`abstract` una
    // snapshot explícita. Nunca completa en silencio con el generador
    // español ni cambia de nivel para sortear la falta de cobertura.
    // -------------------------------------------------------------------
    validateCoverageForEdition(edition, participantIds) {
      const capabilities = WorldSimulationModule.capabilitiesForDetailLevel(edition.detailLevel);
      participantIds.forEach((participantId) => {
        if (capabilities.requiredRosterCoverage === 'complete') {
          const team = this.world.registries.teams.get(participantId);
          if (!team || !team.roster || !team.roster.length) {
            throw new Error(
              `CompetitionSimulationService: la edición "${edition.id}" ("${edition.detailLevel}") exige roster `
              + `COMPLETO y el equipo "${participantId}" no tiene ninguno cargado — bloquea la Edition.`,
            );
          }
        } else if (!this.snapshotForTeamSeason(participantId, edition.seasonKey)) {
          throw new Error(
            `CompetitionSimulationService: la edición "${edition.id}" ("${edition.detailLevel}") exige una `
            + `TeamSimulationSnapshot explícita para "${participantId}"/"${edition.seasonKey}".`,
          );
        }
      });
    }

    // -------------------------------------------------------------------
    // Cohortes operativos (sección 16 del prompt).
    // -------------------------------------------------------------------
    effectiveDetailLevelForTeam(teamId, seasonKey) {
      const order = WorldSimulationModule.DETAIL_LEVELS;
      const levels = this.world.registries.competitionEntries.forParticipant(teamId)
        .filter((entry) => entry.entryStatus === 'active' || entry.entryStatus === 'qualified')
        .map((entry) => this.world.registries.competitionEditions.get(entry.editionId))
        .filter((edition) => edition && (!seasonKey || edition.seasonKey === seasonKey))
        .map((edition) => edition.detailLevel);
      if (!levels.length) return null;
      return [...levels].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    }

    editionsByDetailLevel(seasonKey) {
      const grouped = {};
      this.world.registries.competitionEditions.all()
        .filter((edition) => !seasonKey || edition.seasonKey === seasonKey)
        .forEach((edition) => {
          if (!grouped[edition.detailLevel]) grouped[edition.detailLevel] = [];
          grouped[edition.detailLevel].push(edition.id);
        });
      return grouped;
    }

    teamsForDetailLevel(detailLevel, seasonKey) {
      const teamIds = new Set();
      this.world.registries.competitionEditions.all()
        .filter((edition) => edition.detailLevel === detailLevel && (!seasonKey || edition.seasonKey === seasonKey))
        .forEach((edition) => {
          this.world.registries.competitionEntries.forEdition(edition.id)
            .forEach((entry) => teamIds.add(entry.participantId));
        });
      return [...teamIds].sort();
    }

    // Cohorte INTERACTIVO — los sistemas españoles (contratos/inscripción/
    // ciclo) solo procesan esto, nunca `getAllTeams()` a secas (BUG-WORLDSIM-06).
    // BUG-NATIONAL1-05 (NATIONAL-TEAMS-1, DESIGN.md 10.17): antes devolvía
    // CUALQUIER Team "playable" sin mirar su `teamKind` — una selección
    // "playable" futura habría entrado por accidente en bootstrap de
    // contratos/licencias domésticas/mercado/ciclo anual de clubes. Ahora
    // filtra explícitamente por "club-team" (invariante 16).
    interactiveCohortTeams(seasonKey) {
      return this.teamsForDetailLevel('playable', seasonKey).filter((teamId) => {
        const team = this.world.registries.teams.get(teamId);
        return Boolean(team) && team.teamKind === 'club-team';
      });
    }

    // Diagnóstico de población materializada frente a estimada — nunca
    // suma la estimación a `PlayerRegistry.size` ni la presenta como
    // identidades existentes (invariante 18).
    populationMaterializationSummary(seasonKey) {
      const snapshots = this.world.registries.teamSimulationSnapshots.forSeason(seasonKey);
      const materializedPlayerIds = new Set();
      const byCoverage = { complete: 0, partial: 0, aggregate: 0 };
      let estimatedNonMaterializedRosterSize = 0;
      snapshots.forEach((snapshot) => {
        byCoverage[snapshot.rosterCoverage] = (byCoverage[snapshot.rosterCoverage] || 0) + 1;
        snapshot.materializedPlayerIds.forEach((id) => materializedPlayerIds.add(id));
        if (snapshot.rosterCoverage !== 'complete') estimatedNonMaterializedRosterSize += snapshot.estimatedRosterSize;
      });
      return {
        seasonKey,
        teamsWithSnapshot: snapshots.length,
        byCoverage,
        materializedPlayerCount: materializedPlayerIds.size,
        estimatedNonMaterializedRosterSize,
      };
    }

    // -------------------------------------------------------------------
    // "standard" — marcador compacto determinista (sección 10.2).
    // -------------------------------------------------------------------
    computeStandardResult({
      homeParticipantId, awayParticipantId, editionId, stageId, matchId, seasonKey,
    }) {
      const homeSnapshot = this.requireSnapshot(homeParticipantId, seasonKey);
      const awaySnapshot = this.requireSnapshot(awayParticipantId, seasonKey);
      const fingerprint = `${this.careerSeed}:${STANDARD_ALGORITHM_VERSION}:${editionId}:${stageId}:${matchId}`;
      return computeCompactScore({ homeStrength: homeSnapshot.strength, awayStrength: awaySnapshot.strength, fingerprint });
    }

    // -------------------------------------------------------------------
    // "abstract" — construye el runtime agregado de la fase (sección 10.3).
    // -------------------------------------------------------------------
    buildAbstractRuntime({
      stageId, competitionDefinitionId, competitionEditionId, stageKey, entries, runnerType, firstRoundPairing, dateResolver, onStageCompleted,
    }) {
      const edition = this.world.registries.competitionEditions.require(competitionEditionId);
      return new (AbstractRuntimeModule.AbstractCompetitionStageRuntime)({
        stageId,
        competitionDefinitionId,
        competitionEditionId,
        stageKey,
        entries,
        runnerType,
        firstRoundPairing,
        dateResolver,
        resolveStrength: (participantId) => this.requireSnapshot(participantId, edition.seasonKey).strength,
        careerSeed: this.careerSeed,
        registerReceipt: (data) => {
          const receipt = new WorldSimulationModule.CompetitionSimulationReceipt(data);
          return this.world.registries.registerCompetitionSimulationReceipt(receipt);
        },
        onStageCompleted,
      });
    }
  }

  const exportsObj = { CompetitionSimulationService, STANDARD_ALGORITHM_VERSION };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
