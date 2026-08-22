// src/core/Tactics.js
// Sistema táctico — TAC-1 (núcleo de posesión) + TAC-2 (identidad, spacing,
// roles) — DESIGN.md 7.12, bloque de implementación 7.12.33. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Regla de integración #1 (7.12.30): 7.6 sigue siendo el resolver final.
// Este módulo NO tira, NO decide rebotes ni faltas — decide QUIÉN participa
// en la jugada de Pick & Roll y CON QUÉ CONTEXTO llega esa jugada al
// catálogo de acciones ya existente en MatchEngine.simulatePossession(), y
// (TAC-2) qué IDENTIDAD/SPACING/ROLES tiene un equipo y cómo de bien encaja
// cada jugador en cada rol. MatchEngine.js importa de aquí; este archivo
// nunca importa de MatchEngine.js (7.12.2).
//
// Alcance de TAC-1 (ver DESIGN.md 7.12.33): TacticalProfile (solo cobertura
// de P&R), PossessionPlan, DefensivePlan, AdvantageState y la bifurcación de
// lectura de 3 ramas.
//
// Alcance AÑADIDO en TAC-2 (esta entrega): TacticalProfile completo
// (spacing, ejes de identidad, pesos de play-type, RoleAssignment por
// jugador), `effectiveSpacing()`, catálogo de roles ofensivos/defensivos +
// `roleFit()` en estrellas, y valoraciones derivadas de quinteto (7.12.28,
// subset). SIGUE sin implementarse playbook, defensa avanzada, IA táctica,
// tiempos muertos, familiaridad ni Data Hub (TAC-3 a TAC-7).
//
// Compatibilidad con partidas sin perfil táctico (DESIGN.md 7.12.34): un
// equipo sin TacticalProfile en ataque NUNCA activa un Pick & Roll táctico
// — planPnrPossession() devuelve null y MatchEngine sigue exactamente el
// bucle 1v1 de siempre. Desde TAC-2 esto ya no es "todos los partidos
// reales": `Team.js` inicializa `this.tacticalProfile` con valores por
// defecto en el constructor, así que cualquier equipo real/ficticio
// construido con `new Team()` YA tiene un TacticalProfile (ver nota de
// encaje más abajo y en Team.js). El `null` de este módulo sigue existiendo
// para cubrir el caso defensivo de un objeto plano sin esa propiedad.
//
// Decisión de encaje de TAC-1 (7.12.2), corregida en TAC-2: TAC-1 dejó
// señalado que `TacticalProfile` NO vivía todavía en `Team.js` (se pasaba
// de forma efímera por `options.homeTacticalProfile`/`awayTacticalProfile`).
// TAC-2 SÍ lo persiste en `Team.js` (`this.tacticalProfile`, inicializado
// con valores por defecto en el constructor — mismo patrón que `clubDNA`/
// `reputation`). `options.homeTacticalProfile`/`awayTacticalProfile` sigue
// existiendo en `MatchEngine.simulateMatch()` para tests dirigidos, con
// prioridad sobre `team.tacticalProfile` si ambos están presentes — ver
// MatchEngine.js.

(function (global) {
  const RotationCore = (typeof module !== 'undefined' && module.exports)
    ? require('./Rotation.js')
    : global.BasketManager;
  const { getPenalty } = RotationCore;

  // DESIGN.md 7.12 (TAC-2): a diferencia de las funciones de TAC-1
  // (computeAdvantageScore, buildPossessionPlan...), que reciben
  // `getAttribute` como parámetro desde MatchEngine (para no depender de
  // MatchEngine.js, ver regla de dirección de imports arriba), las
  // funciones NUEVAS de esta entrega (effectiveSpacing, roleFit,
  // computeLineupRatings) están pensadas para llamarse DIRECTAMENTE desde
  // la pantalla de Tácticas (game.js), sin pasar por MatchEngine ni por un
  // partido en curso — necesitan su PROPIO lector de atributos. Se
  // reimplementa aquí el mismo criterio que ya usa MatchEngine.getAttribute
  // (buscar el nombre en Player.js) en vez de importarlo, por el mismo
  // motivo que pickWeighted/gaussianRandom ya se reimplementan más abajo.
  const PlayerCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;
  const { TECHNICAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, MENTAL_ATTRIBUTES } = PlayerCore;
  const TACTICS_ATTRIBUTE_GROUP = {};
  TECHNICAL_ATTRIBUTES.forEach((name) => { TACTICS_ATTRIBUTE_GROUP[name] = 'technical'; });
  PHYSICAL_ATTRIBUTES.forEach((name) => { TACTICS_ATTRIBUTE_GROUP[name] = 'physical'; });
  MENTAL_ATTRIBUTES.forEach((name) => { TACTICS_ATTRIBUTE_GROUP[name] = 'mental'; });

  function getPlayerAttribute(player, name) {
    const group = TACTICS_ATTRIBUTE_GROUP[name];
    if (!group) {
      throw new Error(`Tactics: atributo desconocido "${name}" (revisar MatchConfig.js/Player.js)`);
    }
    return player[group][name];
  }

  // --- 7.12.2 / 7.12.16: TacticalProfile ---
  // Catálogo COMPLETO de coberturas de P&R nombrado (7.12.16), aunque TAC-1
  // solo diferencia comportamiento real para drop/under/switch/blitz —
  // 'hedge' comparte exactamente los datos de 'blitz' en CONFIG (7.12.16
  // las agrupa como "Hedge/Blitz", misma vulnerabilidad: short roll/4v3).
  // High Drop/Show/ICE quedan en el catálogo con hueco reservado, sin
  // implementación de comportamiento todavía (pedido explícito del
  // prompt: "no hace falta implementar... solo dejar el catálogo abierto").
  const PNR_COVERAGES = ['drop', 'under', 'switch', 'hedge', 'blitz'];

  // Spacing (7.12.6): estructura de ocupación de espacio, capa distinta del
  // playbook. 'dynamic' no tiene un techo propio fijo — effectiveSpacing()
  // usa el mejor ajuste real de los otros tres para ese quinteto concreto.
  const SPACING_OPTIONS = ['5-out', '4-out-1-in', '3-out-2-in', 'dynamic'];

  // --- 7.12.13/7.12.14 (TAC-4): esquema defensivo base ---
  // Catálogo MÍNIMO de zonas reales (ver comentario del mismo catálogo en
  // MatchConfig.js): Match-up Zone y Box-and-One quedan fuera de esta
  // entrega, señalado explícitamente como pendiente (7.12.34) — no hay
  // cifra cerrada en DESIGN.md que obligue a implementarlas ya.
  const BASE_SCHEMES = ['man-to-man', '2-3', '3-2', '1-3-1'];
  // --- 7.12.15 (TAC-4): tipos de press ---
  const PRESS_TYPES = ['halfCourt', 'fullCourt'];
  // --- 7.12.19 (TAC-4): reglas de activación del doble equipo de poste ---
  const POST_DOUBLE_TEAM_RULES = ['never', 'starOnly', 'always'];

  // --- 7.12.24 (TAC-5): catálogo de situaciones especiales ---
  // ATO (After Time Out), BLOB/SLOB (saque de fondo/banda), Late Clock
  // (pocos segundos de posesión) y Last Possession (última posesión de
  // cuarto/partido) — ver PLAY_DEFINITIONS más abajo (situationType) y
  // MatchEngine.resolveSituationType/planSituationalPossession.
  const SITUATION_TYPES = ['ATO', 'BLOB', 'SLOB', 'lateClock', 'lastPossession'];
  // Valores por defecto de TacticalProfile.situations.tacticalFoul — cifras
  // propias, pendientes de calibración/decisión (7.12.34), NO validadas con
  // Dennis: "perdiendo por 3 o menos con 24s o menos" es un punto de
  // partida razonable para empezar a hacer falta intencionada, ajustable
  // desde la pestaña Situaciones (7.12.32).
  const DEFAULT_TACTICAL_FOUL_MARGIN = 3;
  const DEFAULT_TACTICAL_FOUL_SECONDS = 24;

  // Construye un grupo numérico "abierto" (7.12.7/7.12.8: la interfaz no
  // tiene que implementar los 14 ejes/11 play-types completos todavía, pero
  // el objeto debe poder ampliarse sin romper el shape). Rellena las claves
  // conocidas con su valor por defecto si faltan, y CONSERVA cualquier
  // clave extra que venga en `source` (ejes/play-types añadidos en una
  // sesión futura) en vez de descartarla.
  function buildOpenNumericGroup(defaults, source) {
    const group = { ...defaults };
    Object.keys(defaults).forEach((key) => {
      const raw = source && source[key] !== undefined ? source[key] : defaults[key];
      const num = Number(raw);
      group[key] = Number.isFinite(num) ? clamp(num, 0, 100) : defaults[key];
    });
    if (source && typeof source === 'object') {
      Object.keys(source).forEach((key) => {
        if (key in group) return;
        const num = Number(source[key]);
        group[key] = Number.isFinite(num) ? clamp(num, 0, 100) : 0;
      });
    }
    return group;
  }

  // Valores por defecto de un TacticalProfile recién creado (ej. `new
  // Team()` sin datos tácticos). Deliberadamente NO se leen de
  // MatchConfig.js aquí: `Team.js` construye un `TacticalProfile` sin
  // recibir ningún `config` (mismo patrón que el resto de defaults de
  // Team.js — facilities/reputation también están fijados en el propio
  // archivo, no en un CONFIG externo). Deben coincidir con
  // `config.tactics.identity.defaults`/`playTypeWeights.defaults`/
  // `spacing.default` de MatchConfig.js (mismas cifras, documentadas en los
  // dos sitios) — MatchConfig.js es la fuente para lo que SÍ consume
  // funciones con `config` como parámetro (ej. resolvePnrFrequency).
  const DEFAULT_SPACING = '4-out-1-in';
  // TAC-6 (7.12.7/7.12.22): `rigidity` se añade a los ejes de identidad —
  // TAC-2/TAC-3 dejaron el eje Rigidez↔Read & React SEÑALADO en DESIGN.md
  // pero sin campo real (no "sin efecto en el motor": no existía ni
  // siquiera como número en `identity`). 50 = punto neutro, mismo criterio
  // que el resto de ejes. Ver `computeTacticalExecution` más abajo, primer
  // consumidor real tras dos entregas aplazándolo (7.12.34).
  const DEFAULT_IDENTITY = { pace: 50, earlyOffense: 50, ballMovement: 50, pickAndRollUsage: 50, rigidity: 50 };
  const DEFAULT_PLAY_TYPE_WEIGHTS = { pickAndRoll: 30, isolation: 15, postUp: 10, transition: 15 };

  // --- TAC-6 (7.12.22): Familiaridad Táctica — catálogos/defaults ---
  // Familias reconocidas por el playbook (7.12.10, mismos 6 valores que
  // `PlayDefinition.family` más abajo) — listadas aquí de forma literal
  // (en vez de derivarlas de PLAY_DEFINITIONS) para que el shape de
  // `familiarity.byPlayFamily` de un TacticalProfile recién creado no
  // dependa del orden de declaración del archivo.
  const PLAY_FAMILIES = ['pickAndRoll', 'isolation', 'postUp', 'handoff', 'offScreen', 'motionFlow'];
  // Valor inicial (0-100) de un TacticalProfile recién creado — "ni cero
  // total ni máxima" (pedido explícito de esta entrega): debe coincidir
  // con `config.tactics.familiarity.default` de MatchConfig.js (mismo
  // criterio de duplicación documentada que DEFAULT_IDENTITY/
  // DEFAULT_PLAY_TYPE_WEIGHTS arriba, que tampoco se leen de `config` en
  // el constructor).
  const FAMILIARITY_DEFAULT = 55;
  // Valor inicial la PRIMERA vez que un jugador recibe familiaridad de rol
  // (nunca al crear el perfil — `byPlayerRole` empieza vacío, ver
  // TacticalProfile más abajo) — debe coincidir con
  // `config.tactics.familiarity.roleDefaultInitial`.
  const FAMILIARITY_ROLE_DEFAULT_INITIAL = 35;
  function defaultsFromKeys(keys, value) {
    const obj = {};
    keys.forEach((key) => { obj[key] = value; });
    return obj;
  }
  const DEFAULT_FAMILIARITY_BY_FAMILY = defaultsFromKeys(PLAY_FAMILIES, FAMILIARITY_DEFAULT);
  const DEFAULT_FAMILIARITY_BY_COVERAGE = defaultsFromKeys(PNR_COVERAGES, FAMILIARITY_DEFAULT);

  // --- TAC-7 (7.12.27): Data Hub táctico — agregado persistente por
  // equipo, mismo patrón de encaje que `familiarity` (TAC-6): vive dentro
  // de `TacticalProfile` (`tacticsTelemetry`), se actualiza posesión a
  // posesión desde `MatchEngine.simulateOnePossessionStep`
  // (`updateTacticsTelemetryAfterPossession`, más abajo) y se lee para
  // construir el informe de rival/derivadas de ataque-defensa-lineups
  // (`summarizeTacticsTelemetry`). Solo se acumulan AGREGADOS (no cada
  // posesión cruda de cada partido histórico, decisión de encaje explícita
  // del punto 1 del prompt de esta entrega, "no necesariamente cada
  // posesión cruda") — el log crudo posesión a posesión vive únicamente
  // dentro de `MatchState.telemetryLog` mientras dura CADA partido (ver
  // MatchEngine.js), nunca se persiste entre partidos.
  const SHOT_ZONES = ['rim', 'midRange', 'three'];
  // 'none': posesión sin play-type táctico real (bucle 1v1 de siempre) —
  // se cuenta igual que un play-type más para poder calcular la
  // FRECUENCIA real de cada uno sobre el total de posesiones ofensivas
  // (7.12.27, "frecuencia y PPP por play-type"), no solo sobre las
  // tácticas.
  const TELEMETRY_PLAY_TYPES = ['pickAndRoll', 'isolation', 'postUp', 'none'];

  function buildEmptyCountPointsStats() {
    return { possessions: 0, points: 0 };
  }
  function buildEmptyShotZoneStats() {
    return { attempts: 0, made: 0 };
  }
  function buildEmptyLineupTelemetryStats() {
    return {
      offensePossessions: 0, offensePoints: 0, defensePossessions: 0, defensePointsAllowed: 0,
      spacingSum: 0, spacingCount: 0,
    };
  }
  function cloneCountPointsGroup(keys, source) {
    const out = {};
    keys.forEach((key) => {
      const src = source && source[key];
      out[key] = {
        possessions: Number(src && src.possessions) || 0,
        points: Number(src && (src.points !== undefined ? src.points : src.pointsAllowed)) || 0,
      };
    });
    return out;
  }
  function cloneShotZoneGroup(source) {
    const out = {};
    SHOT_ZONES.forEach((key) => {
      const src = source && source[key];
      out[key] = { attempts: Number(src && src.attempts) || 0, made: Number(src && src.made) || 0 };
    });
    return out;
  }
  function cloneCoverageGroup(source) {
    const out = {};
    PNR_COVERAGES.forEach((key) => {
      const src = source && source[key];
      out[key] = {
        possessions: Number(src && src.possessions) || 0,
        pointsAllowed: Number(src && src.pointsAllowed) || 0,
      };
    });
    return out;
  }
  // `byPlayDefinition` crece con el catálogo REAL usado (no un catálogo
  // fijo de claves como el resto de grupos): se clona tal cual llega, sin
  // forzar ninguna clave concreta — nuevas PLAY_DEFINITIONS futuras no
  // exigen tocar este shape.
  function clonePlayDefinitionGroup(source) {
    const out = {};
    Object.keys(source || {}).forEach((key) => {
      const src = source[key];
      out[key] = { possessions: Number(src.possessions) || 0, points: Number(src.points) || 0 };
    });
    return out;
  }
  function cloneLineupGroup(source) {
    const out = {};
    Object.keys(source || {}).forEach((key) => {
      const src = source[key] || {};
      out[key] = {
        offensePossessions: Number(src.offensePossessions) || 0,
        offensePoints: Number(src.offensePoints) || 0,
        defensePossessions: Number(src.defensePossessions) || 0,
        defensePointsAllowed: Number(src.defensePointsAllowed) || 0,
        spacingSum: Number(src.spacingSum) || 0,
        spacingCount: Number(src.spacingCount) || 0,
      };
    });
    return out;
  }

  function buildTacticsTelemetryAggregate(source) {
    const s = source || {};
    const offense = s.offense || {};
    const defense = s.defense || {};
    return {
      games: Number(s.games) || 0,
      offense: {
        possessions: Number(offense.possessions) || 0,
        points: Number(offense.points) || 0,
        byPlayType: cloneCountPointsGroup(TELEMETRY_PLAY_TYPES, offense.byPlayType),
        byPlayDefinition: clonePlayDefinitionGroup(offense.byPlayDefinition),
        shotZones: cloneShotZoneGroup(offense.shotZones),
        assistedMade: Number(offense.assistedMade) || 0,
        unassistedMade: Number(offense.unassistedMade) || 0,
        turnovers: Number(offense.turnovers) || 0,
        shotQualitySum: Number(offense.shotQualitySum) || 0,
        shotQualityCount: Number(offense.shotQualityCount) || 0,
      },
      defense: {
        possessions: Number(defense.possessions) || 0,
        pointsAllowed: Number(defense.pointsAllowed) || 0,
        byCoverage: cloneCoverageGroup(defense.byCoverage),
        shotZonesAllowed: cloneShotZoneGroup(defense.shotZonesAllowed),
      },
      lineups: cloneLineupGroup(s.lineups),
    };
  }

  function clampFamiliarityValue(raw, fallback) {
    const num = Number(raw);
    return Number.isFinite(num) ? clamp(num, 0, 100) : fallback;
  }

  // `familiarity.byPlayerRole` (7.12.22, familiaridad individual del
  // jugador con su rol — decisión de encaje explícita: NO puede vivir en
  // Player.js, vetado para nuevos atributos 1-20, así que vive aquí como
  // mapa por `playerId`, mismo patrón que `roleAssignments`).
  // `offensiveRoleId`/`defensiveRoleId` en `null` significa "todavía sin
  // ningún rol de ese lado registrado" (distinto de un rol YA registrado
  // que cambia — ver `growPlayerRoleFamiliarity`, el primer caso arranca en
  // `roleDefaultInitial`, el segundo en `roleChangeResetValue`, más bajo).
  function cloneByPlayerRole(source) {
    const out = {};
    if (!source) return out;
    Object.keys(source).forEach((playerId) => {
      const entry = source[playerId] || {};
      out[playerId] = {
        offensiveRoleId: entry.offensiveRoleId || null,
        offensiveLevel: clampFamiliarityValue(entry.offensiveLevel, FAMILIARITY_ROLE_DEFAULT_INITIAL),
        defensiveRoleId: entry.defensiveRoleId || null,
        defensiveLevel: clampFamiliarityValue(entry.defensiveLevel, FAMILIARITY_ROLE_DEFAULT_INITIAL),
      };
    });
    return out;
  }

  // Perfil táctico de un equipo (7.12.2: "identidad ofensiva y defensiva
  // persistente"). TAC-1 solo tenía `pnrCoverage`; TAC-2 añade spacing, ejes
  // de identidad ofensiva mínimos (7.12.7), pesos de play-type mínimos
  // (7.12.8) y `roleAssignments` (RoleAssignment por jugador, 7.12.2/
  // 7.12.9/7.12.21 — vive aquí en vez de en un fichero propio, pedido
  // explícito del prompt de esta sesión: basta con un mapa).
  class TacticalProfile {
    constructor(data = {}) {
      const coverage = data.pnrCoverage || 'drop';
      if (PNR_COVERAGES.indexOf(coverage) === -1) {
        throw new Error(`TacticalProfile: cobertura de P&R desconocida "${coverage}" (catálogo: ${PNR_COVERAGES.join(', ')})`);
      }
      this.pnrCoverage = coverage;

      const spacing = data.spacing || DEFAULT_SPACING;
      if (SPACING_OPTIONS.indexOf(spacing) === -1) {
        throw new Error(`TacticalProfile: spacing desconocido "${spacing}" (catálogo: ${SPACING_OPTIONS.join(', ')})`);
      }
      this.spacing = spacing;

      this.identity = buildOpenNumericGroup(DEFAULT_IDENTITY, data.identity);
      this.playTypeWeights = buildOpenNumericGroup(DEFAULT_PLAY_TYPE_WEIGHTS, data.playTypeWeights);

      // RoleAssignment (7.12.9/7.12.21): playerId -> { offensiveRole,
      // defensiveRole }. Un jugador SIN entrada aquí no rompe nada — el
      // motor sigue operando con el comportamiento de siempre
      // (usageWeight/onBallDefenderWeight, sin sesgo de rol) para él;
      // ver nota de compatibilidad en planPnrPossession/buildPossessionPlan.
      this.roleAssignments = { ...(data.roleAssignments || {}) };

      // --- TAC-4 (7.12.13/7.12.14/7.12.15/7.12.19): DefensiveScheme ---
      // 'man-to-man' + press inactivo + regla 'starOnly' por defecto
      // reproducen EXACTAMENTE el comportamiento de TAC-1/TAC-2/TAC-3
      // (7.12.34, compatibilidad): ningún término de zona/press se activa,
      // y el doble equipo de poste sigue el mismo umbral/probabilidad que
      // ya usaba TAC-3 (ver buildPostUpPlan/resolvePostDoubleTeamDecision).
      const defensiveInput = data.defensiveScheme || {};
      const baseScheme = defensiveInput.baseScheme || 'man-to-man';
      if (BASE_SCHEMES.indexOf(baseScheme) === -1) {
        throw new Error(`TacticalProfile: esquema defensivo desconocido "${baseScheme}" (catálogo: ${BASE_SCHEMES.join(', ')})`);
      }
      const pressInput = defensiveInput.press || {};
      const pressType = pressInput.type || 'halfCourt';
      if (PRESS_TYPES.indexOf(pressType) === -1) {
        throw new Error(`TacticalProfile: tipo de press desconocido "${pressType}" (catálogo: ${PRESS_TYPES.join(', ')})`);
      }
      const postDoubleTeamRule = defensiveInput.postDoubleTeamRule || 'starOnly';
      if (POST_DOUBLE_TEAM_RULES.indexOf(postDoubleTeamRule) === -1) {
        throw new Error(`TacticalProfile: regla de doble equipo de poste desconocida "${postDoubleTeamRule}" (catálogo: ${POST_DOUBLE_TEAM_RULES.join(', ')})`);
      }
      this.defensiveScheme = {
        baseScheme,
        press: { active: !!pressInput.active, type: pressType },
        postDoubleTeamRule,
      };

      // --- TAC-4 (7.12.17): matchups individuales declarados ---
      // Mapa `defenderId -> targetPlayerId` (forma sugerida literalmente
      // por el prompt de esta sesión) — "mi defensor X marca siempre al
      // jugador rival Y", con prioridad sobre la selección ponderada
      // genérica SOLO para ese jugador concreto (ver
      // MatchEngine.resolveMatchupOverride). Se declara por ID de
      // jugador real (no por nombre): la pantalla de Tácticas (game.js)
      // no tiene un "rival de este partido" fijo (se edita fuera de un
      // partido concreto), así que el override se guarda de forma
      // genérica y solo tiene efecto los partidos en los que ese jugador
      // concreto aparezca en el quinteto rival — decisión de encaje
      // señalada explícitamente (7.12.34), no un cierre de diseño de
      // 7.12.17/GamePlan (que no existe todavía como entidad propia).
      this.matchupOverrides = { ...(data.matchupOverrides || {}) };

      // --- TAC-5 (7.12.24/7.12.32, sub-pestaña Situaciones): reglas de
      // partido persistentes del EQUIPO (no de un GamePlan concreto,
      // 7.12.23 — un GamePlan de partido puede sobreescribir SOLO
      // `preferredPlays` para ese partido, ver GamePlan.situationalPlays/
      // effectiveTacticalProfile más abajo; `autoTimeouts`/`tacticalFoul`
      // son "identidad" de equipo, igual que defensiveScheme). Por defecto
      // AMBOS desactivados (7.12.34, compatibilidad/regresión): un equipo
      // recién creado o cargado de una partida guardada ANTES de esta
      // entrega nunca pide tiempos muertos automáticos ni fuerza faltas
      // intencionadas — comportamiento idéntico al de antes de TAC-5. Que
      // los equipos CPU deban tener esto activado por defecto para jugar de
      // forma más realista es una decisión de calibración de IA (7.12.25)
      // que esta entrega deja señalada, no resuelta aquí.
      const situationsInput = data.situations || {};
      const autoTimeoutsInput = situationsInput.autoTimeouts || {};
      const tacticalFoulInput = situationsInput.tacticalFoul || {};
      this.situations = {
        autoTimeouts: { enabled: !!autoTimeoutsInput.enabled },
        tacticalFoul: {
          enabled: !!tacticalFoulInput.enabled,
          marginPoints: Number.isFinite(Number(tacticalFoulInput.marginPoints))
            ? Number(tacticalFoulInput.marginPoints) : DEFAULT_TACTICAL_FOUL_MARGIN,
          secondsRemaining: Number.isFinite(Number(tacticalFoulInput.secondsRemaining))
            ? Number(tacticalFoulInput.secondsRemaining) : DEFAULT_TACTICAL_FOUL_SECONDS,
        },
        // situationType -> playDefinitionId preferido ("GamePlan base" que
        // cita 7.12.32 para la sub-pestaña Situaciones) — un GamePlan de
        // partido concreto puede sobreescribir esto SOLO para ese partido
        // (GamePlan.situationalPlays), sin tocar este objeto persistente.
        preferredPlays: { ...(situationsInput.preferredPlays || {}) },
      };

      // --- TAC-6 (7.12.22): Familiaridad Táctica ---
      // Estado DINÁMICO del savegame, deliberadamente SEPARADO del resto
      // del perfil (decisión de encaje explícita, punto 1 de esta entrega):
      // el usuario declara QUÉ táctica quiere jugar (identity/roleAssignments/
      // playTypeWeights/defensiveScheme, todo lo de arriba); `familiarity`
      // mide CUÁNTO el equipo domina todavía esa declaración — nunca se
      // edita a mano desde la pantalla de Tácticas, solo se OBSERVA (ver
      // game.js) y crece/decae jugando partidos reales (ver
      // updateFamiliarityAfterPossession más abajo).
      // `offensiveSystem`/`defensiveSystem` (globales) y `byPlayFamily`/
      // `byCoverage` (grupos abiertos, mismo patrón que identity/
      // playTypeWeights de arriba) parten de FAMILIARITY_DEFAULT.
      // `byPlayerRole` (individual del jugador con su rol, 7.12.9/7.12.21)
      // empieza VACÍO como roleAssignments/matchupOverrides — se rellena la
      // primera vez que ese jugador participa en una posesión con un rol
      // asignado, no al crear el perfil (7.12.34, compatibilidad: un
      // equipo recién creado o cargado de una partida sin este campo
      // recibe familiaridad neutra de partida, nunca null/undefined).
      // Familiaridad de QUINTETO con estructuras específicas (7.12.22,
      // marcada EXPLÍCITAMENTE como opcional en la primera implementación):
      // NO se modela aquí — este shape no obliga a enumerar combinaciones
      // de cinco jugadores para añadirla después; podría vivir como un
      // mapa adicional `byLineupKey` (clave = ids de los 5 ordenados) sin
      // tocar ninguno de los campos de abajo, señalado explícitamente como
      // pendiente (7.12.34).
      const familiarityInput = data.familiarity || {};
      this.familiarity = {
        offensiveSystem: clampFamiliarityValue(familiarityInput.offensiveSystem, FAMILIARITY_DEFAULT),
        defensiveSystem: clampFamiliarityValue(familiarityInput.defensiveSystem, FAMILIARITY_DEFAULT),
        byPlayFamily: buildOpenNumericGroup(DEFAULT_FAMILIARITY_BY_FAMILY, familiarityInput.byPlayFamily),
        byCoverage: buildOpenNumericGroup(DEFAULT_FAMILIARITY_BY_COVERAGE, familiarityInput.byCoverage),
        byPlayerRole: cloneByPlayerRole(familiarityInput.byPlayerRole),
      };

      // --- TAC-7 (7.12.27): Data Hub táctico — telemetría agregada
      // persistente, mismo patrón de encaje que `familiarity` arriba (ver
      // comentario de `buildTacticsTelemetryAggregate`). Empieza en cero
      // absoluto (a diferencia de `familiarity`, que arranca en un valor
      // neutro "ni cero ni máximo"): no hay ninguna telemetría real antes
      // del primer partido jugado, cero no es una aproximación, es el dato
      // correcto.
      this.tacticsTelemetry = buildTacticsTelemetryAggregate(data.tacticsTelemetry);
    }
  }

  // --- 7.12.23 (TAC-5): GamePlan — overrides de UN partido concreto ---
  // Regla de persistencia (7.12.23, "regla dura"): al terminar el partido
  // el GamePlan se descarta sin más — como no se guarda en ningún sitio
  // persistente (ni en Team.js, ni en ninguna partida guardada), esto se
  // cumple estructuralmente por construcción: basta con no reutilizar el
  // mismo GamePlan en el siguiente partido. `applyGamePlanToProfile()` es
  // el único camino para que algo de un GamePlan sobreviva al partido
  // ("guardar como táctica base"), y copia explícitamente, nunca implícito.
  //
  // Alcance MÍNIMO de esta entrega (7.12.33, priorizar campos con pieza
  // real del motor detrás): playTypeWeights, matchupOverrides, pnrCoverage,
  // defensiveScheme, y `situationalPlays` (preferencia de ATO/BLOB/SLOB/
  // Late Clock/Last Possession SOLO para este partido, 7.12.24). El resto
  // del catálogo de 7.12.23 (target de mismatch, ritmo específico,
  // orientación de shot profile, prioridad de rebote ofensivo, cobertura
  // por jugador rival, over/under por handler, presión/distancia por
  // jugador, negar recepción a estrella...) queda como catálogo de datos
  // SIN comportamiento real todavía — señalado explícitamente, no se
  // inventa una pieza de motor que no existe para sostenerlos.
  class GamePlan {
    constructor(baseProfile, overrides = {}) {
      this.playTypeWeights = overrides.playTypeWeights
        ? buildOpenNumericGroup(baseProfile.playTypeWeights, overrides.playTypeWeights)
        : { ...baseProfile.playTypeWeights };
      this.matchupOverrides = { ...(overrides.matchupOverrides || baseProfile.matchupOverrides) };
      const coverage = overrides.pnrCoverage || baseProfile.pnrCoverage;
      if (PNR_COVERAGES.indexOf(coverage) === -1) {
        throw new Error(`GamePlan: cobertura de P&R desconocida "${coverage}" (catálogo: ${PNR_COVERAGES.join(', ')})`);
      }
      this.pnrCoverage = coverage;
      const schemeOverride = overrides.defensiveScheme || {};
      this.defensiveScheme = {
        ...baseProfile.defensiveScheme,
        ...schemeOverride,
        press: { ...baseProfile.defensiveScheme.press, ...(schemeOverride.press || {}) },
      };
      // 7.12.24: preferencia de jugada situacional SOLO para este partido —
      // se combina con `preferredPlays` persistente en
      // effectiveTacticalProfile() (esta entrada gana si ambas existen).
      this.situationalPlays = { ...(overrides.situationalPlays || {}) };
      // TAC-6 (7.12.22): primer uso real del gancho que TAC-5 dejó
      // preparado sin efecto ("Gancho explícito para TAC-6", ver
      // CHANGELOG de esa entrega). Número 0-1: sustituye DIRECTAMENTE el
      // `tacticalExecution` calculado (familiaridad+atributos+complejidad,
      // ver resolveTacticalExecutionValue más abajo) para el equipo dueño
      // de este GamePlan, SOLO en este partido — pensado para casos
      // manuales/futuros (ej. una IA de scouting de TAC-7 que ya sabe que
      // el rival prepara un plan simplificado esta noche), sin editor
      // propio en la pantalla de Tácticas todavía (7.12.34, señalado
      // explícitamente). `null`/no finito (por defecto): sin efecto, se
      // calcula con normalidad — mismo comportamiento que antes de esta
      // entrega.
      const overrideValue = Number(overrides.tacticalExecutionOverride);
      this.tacticalExecutionOverride = Number.isFinite(overrideValue) ? clamp(overrideValue, 0, 1) : null;
    }
  }

  // Vista MERGEADA de un TacticalProfile persistente + un GamePlan de
  // partido (7.12.23): un objeto plano con la MISMA forma que
  // TacticalProfile (pnrCoverage/spacing/identity/playTypeWeights/
  // roleAssignments/defensiveScheme/matchupOverrides/situations) — nunca
  // una clase nueva ni una mutación del perfil base, así que TODO el resto
  // de Tactics.js/MatchEngine.js que ya lee `offenseTacticalProfile.*`
  // sigue funcionando sin cambios, sepa o no que hay un GamePlan detrás
  // (7.12.30, "7.6 sigue siendo el resolver final" — aquí, "Tactics.js
  // sigue siendo el único lector de TacticalProfile"). Sin GamePlan (`null`,
  // el caso de siempre fuera de un partido en curso o de un equipo sin
  // ajustes este partido), devuelve `baseProfile` tal cual — cero coste,
  // comportamiento idéntico a antes de esta entrega (7.12.34, regresión).
  function effectiveTacticalProfile(baseProfile, gamePlan) {
    if (!baseProfile || !gamePlan) return baseProfile;
    return {
      pnrCoverage: gamePlan.pnrCoverage || baseProfile.pnrCoverage,
      spacing: baseProfile.spacing,
      identity: baseProfile.identity,
      playTypeWeights: gamePlan.playTypeWeights || baseProfile.playTypeWeights,
      roleAssignments: baseProfile.roleAssignments,
      defensiveScheme: gamePlan.defensiveScheme || baseProfile.defensiveScheme,
      matchupOverrides: gamePlan.matchupOverrides || baseProfile.matchupOverrides,
      situations: {
        ...baseProfile.situations,
        preferredPlays: { ...baseProfile.situations.preferredPlays, ...gamePlan.situationalPlays },
      },
    };
  }

  // "Guardar como táctica base" (7.12.23): el ÚNICO camino explícito para
  // que un GamePlan sobreviva al partido — copia sus 4 campos con pieza de
  // motor real al TacticalProfile persistente del equipo, mutándolo in
  // situ (mismo patrón que el resto de la pantalla de Tácticas, que ya
  // muta `team.tacticalProfile.*` directamente desde game.js). Nunca se
  // llama automáticamente al terminar un partido — si no se llama, el
  // GamePlan simplemente se descarta (regla de persistencia de 7.12.23).
  function applyGamePlanToProfile(profile, gamePlan) {
    profile.playTypeWeights = { ...gamePlan.playTypeWeights };
    profile.matchupOverrides = { ...gamePlan.matchupOverrides };
    profile.pnrCoverage = gamePlan.pnrCoverage;
    profile.defensiveScheme = {
      ...gamePlan.defensiveScheme,
      press: { ...gamePlan.defensiveScheme.press },
    };
    profile.situations.preferredPlays = { ...profile.situations.preferredPlays, ...gamePlan.situationalPlays };
    return profile;
  }

  // Sorteo ponderado genérico — mismo algoritmo que MatchEngine.pickWeighted
  // (utilidad genérica sin lógica de dominio, no la fórmula de ninguna
  // acción de 7.6; se reimplementa aquí en vez de importarla para no
  // depender de MatchEngine.js, ver regla de dirección de imports arriba).
  function pickWeighted(items, weightFn) {
    const weights = items.map(weightFn);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < items.length; i += 1) {
      if (roll < weights[i]) return items[i];
      roll -= weights[i];
    }
    return items[items.length - 1];
  }

  // Ruido gaussiano simple (Box-Muller) — misma utilidad genérica que
  // MatchEngine.gaussianRandom (7.5-bis), reimplementada aquí por el mismo
  // motivo que pickWeighted: es matemática genérica, no una fórmula de 7.6
  // ni de 7.12 que debiera vivir en un solo sitio.
  function gaussianRandom() {
    const u1 = Math.max(Math.random(), 1e-9);
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Mezcla de atributos ponderada (1-20), SIN Fatiga/Consistencia/Presión
  // de Momento — a diferencia de `computeSimpleMix` (TAC-2, más abajo, que
  // usa el `getPlayerAttribute` INTERNO de este módulo porque se llama
  // desde game.js sin partido en curso), esta variante recibe
  // `getAttribute` como parámetro para poder usarse desde funciones que sí
  // se llaman DURANTE una posesión (press/transición defensiva, TAC-4,
  // mismo criterio de parametrización que el resto de TAC-1/TAC-3). Nueva
  // utilidad genérica mínima (sin equivalente ya pasado como parámetro),
  // igual de heurística que screenerWeight/screenerDefenderWeight.
  function averageMixWithAttribute(five, mix, getAttribute) {
    if (!five || five.length === 0) return 0;
    const perPlayerScores = five.map((player) => {
      let sum = 0;
      let total = 0;
      Object.entries(mix).forEach(([attrName, weight]) => {
        sum += getAttribute(player, attrName) * weight;
        total += weight;
      });
      return total > 0 ? sum / total : 0;
    });
    return perPlayerScores.reduce((a, b) => a + b, 0) / perPlayerScores.length;
  }

  // --- 7.12.17 (TAC-4): matchups individuales declarados ---
  // Prioridad sobre la selección ponderada genérica SOLO para el jugador
  // objetivo declarado (7.12.17: "el motor respeta esa intención siempre
  // que ambos estén en pista, salvo que una rotación/cambio defensivo
  // obligue temporalmente a otro matchup") — por eso MatchEngine.js solo
  // la aplica en los puntos donde, si no hubiera matchup, se usaría un
  // pickWeighted genérico; NUNCA sustituye a un defensor ya reasignado por
  // una cobertura/rotación de Tactics.js (Switch, doble equipo, roller
  // defender...), que representa precisamente esa excepción.
  function resolveMatchupOverride(defenseFive, defenseTacticalProfile, targetPlayerId, fallbackDefender) {
    const overrides = defenseTacticalProfile && defenseTacticalProfile.matchupOverrides;
    if (!overrides) return fallbackDefender;
    const entry = Object.keys(overrides).find((defenderId) => overrides[defenderId] === targetPlayerId);
    if (!entry) return fallbackDefender;
    const forcedDefender = defenseFive.find((p) => p.id === entry);
    return forcedDefender || fallbackDefender;
  }

  // "Quién pone el bloqueo": ponderado por atributos de screener real
  // (fuerza para aguantar el contacto, buen manejo interior para el roll
  // posterior) — no existe un peso equivalente ya en MatchEngine (a
  // diferencia de handler/onBallDefender, que SÍ reutilizan
  // usageWeight/onBallDefenderWeight tal cual pide el prompt), así que es
  // un criterio nuevo mínimo, igual de heurístico que los ya existentes.
  function screenerWeight(player, getAttribute) {
    return getAttribute(player, 'strength') + getAttribute(player, 'insideShot')
      + getAttribute(player, 'offensiveRebound') + 1;
  }

  // "Quién defiende al bloqueador": ponderado por atributos defensivos de
  // interior — mismo criterio de heurística nueva mínima que screenerWeight.
  function screenerDefenderWeight(player, getAttribute) {
    return getAttribute(player, 'interiorDefense') + getAttribute(player, 'strength')
      + getAttribute(player, 'blocking') + 1;
  }

  // DESIGN.md 7.12.7 (TAC-2, punto 4 del prompt de esta sesión):
  // `identity.pickAndRollUsage` MODULA `config.tactics.pnrFrequency` para
  // ESE equipo en vez de dejarlo como un valor global fijo de CONFIG. El
  // punto neutro (`pickAndRollUsageNeutral`, 50 por defecto — el mismo
  // valor que `DEFAULT_IDENTITY.pickAndRollUsage`) reproduce EXACTAMENTE la
  // `pnrFrequency` de TAC-1 sin modulación: multiplicador 1, así que un
  // equipo con TacticalProfile por defecto sortea P&R con la MISMA
  // frecuencia que un equipo de TAC-1 (invariante de regresión explícito
  // del prompt: "con perfil por defecto = comportamiento equivalente").
  // Sin `identity` en el perfil (TacticalProfile antiguo/objeto plano
  // mínimo), se usa `pnrFrequency` tal cual, sin modular.
  function resolvePnrFrequency(offenseTacticalProfile, config) {
    const base = config.tactics.pnrFrequency;
    const identityCfg = config.tactics.identity || {};
    const usage = offenseTacticalProfile.identity && offenseTacticalProfile.identity.pickAndRollUsage;
    if (usage === undefined || usage === null) return base;
    const neutral = identityCfg.pickAndRollUsageNeutral !== undefined ? identityCfg.pickAndRollUsageNeutral : 50;
    const maxMultiplier = identityCfg.pickAndRollUsageMaxMultiplier !== undefined ? identityCfg.pickAndRollUsageMaxMultiplier : 2;
    const multiplier = neutral > 0 ? clamp(usage / neutral, 0, maxMultiplier) : 1;
    return clamp(base * multiplier, 0, 1);
  }

  // --- 7.12.2: PossessionPlan (mínimo de TAC-1) ---
  // ¿Esta posesión es un Pick & Roll central? Solo si el equipo atacante
  // tiene TacticalProfile asignado (ver nota de compatibilidad arriba) y el
  // sorteo de resolvePnrFrequency() (7.12.7, TAC-2: ya no un valor fijo
  // global, ver arriba) lo decide. `handler`/`screener` elegidos del
  // quinteto REAL (offenseFive, ya resuelto por Rotation.getOnCourtFive
  // antes de llegar aquí) con el mismo criterio de peso que ya usa
  // MatchEngine (usageWeight) para el handler — pedido explícito del
  // prompt, no se inventa un criterio de selección de handler nuevo.
  // `forcePlay` (TAC-5, 7.12.24, opcional): salta el sorteo de frecuencia
  // — usado SOLO por planSituationalPossession() para una jugada de
  // ATO/BLOB/SLOB/Late Clock/Last Possession ya elegida del catálogo
  // situacional (el equipo la dibuja deliberadamente, no depende de que
  // "toque" el sorteo normal de Pick & Roll). `false`/ausente reproduce
  // exactamente el comportamiento de siempre (TAC-1 a TAC-4).
  function buildPossessionPlan(offenseTacticalProfile, offenseFive, config, usageWeight, getAttribute, forcePlay) {
    if (!offenseTacticalProfile) return null;
    if (!forcePlay && Math.random() >= resolvePnrFrequency(offenseTacticalProfile, config)) return null;

    const handler = pickWeighted(offenseFive, usageWeight);
    const screenerCandidates = offenseFive.filter((p) => p.id !== handler.id);
    const screener = pickWeighted(screenerCandidates, (p) => screenerWeight(p, getAttribute));
    return { handler, screener };
  }

  // --- 7.12.2 / 7.12.16: DefensivePlan (mínimo de TAC-1) ---
  // Cobertura leída del TacticalProfile del equipo defensor, con fallback a
  // 'drop' si no tiene perfil (pedido explícito del prompt, punto 3) —
  // decisión de diseño ya tomada por 7.12.16, no una interpretación propia.
  // `screenerDefender` elegido del quinteto real (defenseFive), excluyendo
  // a quien ya defiende de cerca (onBallDefender).
  // `defenseTacticalExecutionOverride` (TAC-6, opcional): ver
  // GamePlan.tacticalExecutionOverride más abajo — `undefined`/no finito
  // en llamadas legacy de TAC-1/TAC-2/TAC-3 (sin este parámetro), cae al
  // tacticalExecution calculado con normalidad (7.12.34, compatibilidad).
  function buildDefensivePlan(defenseTacticalProfile, defenseFive, onBallDefender, config, getAttribute, defenseTacticalExecutionOverride) {
    const coverage = (defenseTacticalProfile && defenseTacticalProfile.pnrCoverage) || config.tactics.defaultCoverage;
    const candidates = defenseFive.filter((p) => p.id !== onBallDefender.id);
    const properScreenerDefender = pickWeighted(candidates, (p) => screenerDefenderWeight(p, getAttribute));

    // TAC-6 (7.12.22, "error de switch"): estimación TEMPRANA del
    // tacticalExecution defensivo, con SOLO `onBallDefender` (el propio
    // `screenerDefender` es la pieza que este mecanismo puede corromper —
    // no puede depender de sí mismo para decidir si se corrompe). Sin
    // `familiarity` en el perfil (objeto plano legacy, 7.12.34
    // compatibilidad), `resolveRelevantFamiliarity` ya cae al neutro
    // FAMILIARITY_DEFAULT, así que esto tiene un efecto pequeño y acotado
    // incluso sin ningún dato táctico nuevo.
    const preReadFamiliarity = resolveRelevantFamiliarity(defenseTacticalProfile, 'defensive', 'pickAndRoll', coverage, [onBallDefender.id]);
    const preReadExecution = resolveTacticalExecutionValue(defenseTacticalExecutionOverride, {
      participants: [onBallDefender],
      familiarityFactor: preReadFamiliarity,
      complexity: config.tactics.familiarity.coverageComplexity[coverage],
      rigidityAxis: 50,
      config,
      getAttribute,
    });
    const screenerDefender = resolveDefensiveExecutionOverride(
      properScreenerDefender, candidates, preReadExecution, config,
      (p) => 1 / (screenerDefenderWeight(p, getAttribute) + 1) + 0.01,
    );
    return { coverage, screenerDefender };
  }

  // PENDIENTE EXPLÍCITO para TAC-3 (DESIGN.md 7.12.34, señalado también en
  // el CHANGELOG de esta entrega): `effectiveSpacing()` (más abajo) NO se
  // conecta a `computeAdvantageScore()` en TAC-2, a pesar de que el punto 4
  // del prompt de esta sesión lo permitía si se encontraba una forma limpia.
  // Motivo: desde esta entrega TODO equipo real/ficticio tiene un
  // `TacticalProfile` por defecto (Team.js), así que cualquier término que
  // sume aquí se aplicaría a TODOS los partidos del juego, no solo a los
  // que el usuario edite en la pantalla de Tácticas — y calibrar ese
  // término sin doble contar el efecto que YA describe 7.12.4 (el spacing
  // se refleja cambiando qué defensor ayuda, no como bonus aparte) exige
  // simulación masiva que esta entrega no puede validar sin arriesgar el
  // invariante de regresión (7.12.31: "con perfil por defecto = balance
  // equivalente"). Mejor dejarlo señalado que forzar un acoplamiento
  // improvisado, tal como permite explícitamente el prompt de esta sesión.
  //
  // --- 7.12.4: AdvantageState ---
  // advantageScore (-1..+1): base por cobertura (7.12.16 vulnerabilidades)
  // ajustada por la diferencia de rating ofensivo/defensivo de los 4
  // jugadores implicados, calculada con computeMixRating (recibida como
  // parámetro — MISMO tratamiento de Fatiga/Consistencia/Presión de
  // Momento que ya aplica el resto del motor, no reimplementado aquí) y
  // penalizada por getPenalty() (Rotation.js, 7.11.3, polivalencia de
  // emergencia) de cada uno de los 4.
  //
  // Mismatch de Switch (invariante #3, 7.12.31): tras un cambio, quien
  // defiende de cerca al handler es realmente `screenerDefender` (no
  // `onBallDefender`), y quien queda emparejado con el rolo es
  // `onBallDefender`. Por eso, SOLO para 'switch', se evalúan los ratings
  // de cobertura con los dos defensores intercambiados respecto a su rol
  // original — si `screenerDefender` es un pívot lento evaluado con una
  // mezcla de defensa perimetral, su rating cae, y el advantageScore sube
  // en consecuencia (mismatch real, no una etiqueta).
  function computeAdvantageScore(params) {
    const {
      handler, screener, onBallDefender, screenerDefender, coverage, config, pressure,
      computeMixRating, offenseRotationState, defenseRotationState,
      // TAC-3 (7.12.6/7.12.34): opcionales — offenseFive/offenseSpacing solo
      // los pasa el nuevo planTacticalPossession (ver más abajo). Sin ellos
      // (llamadas existentes de TAC-1/TAC-2, ej. planPnrPossession legacy),
      // computeSpacingAdvantageTerm devuelve 0 y el comportamiento es
      // idéntico al de antes de esta entrega.
      offenseFive, offenseSpacing,
      // TAC-4 (7.12.14): opcional — esquema defensivo base del equipo que
      // defiende. Sin él (llamadas legacy de TAC-1/TAC-2/TAC-3, o
      // 'man-to-man'), computeZoneAdvantageTerm devuelve 0 (7.12.34,
      // compatibilidad).
      defenseBaseScheme,
    } = params;
    const cfg = config.tactics.advantage;
    const handlerMix = config.tactics.coverageHandlerMix[coverage] || config.tactics.coverageHandlerMix.drop;
    const defenderMix = config.tactics.coverageDefenderMix[coverage] || config.tactics.coverageDefenderMix.drop;
    const baseScore = cfg.coverageBaseScore[coverage] !== undefined ? cfg.coverageBaseScore[coverage] : cfg.coverageBaseScore.drop;

    const isSwitch = coverage === 'switch';
    // Tras un Switch, el rol de "quién defiende de cerca al balón" pasa al
    // defensor del bloqueador (ver nota de mismatch arriba); en cualquier
    // otra cobertura, cada uno evalúa su rol original.
    const onBallRoleDefender = isSwitch ? screenerDefender : onBallDefender;
    const rollRoleDefender = isSwitch ? onBallDefender : screenerDefender;

    const handlerPenalty = getPenalty(offenseRotationState, handler.id);
    const screenerPenalty = getPenalty(offenseRotationState, screener.id);
    const onBallRolePenalty = getPenalty(defenseRotationState, onBallRoleDefender.id);
    const rollRolePenalty = getPenalty(defenseRotationState, rollRoleDefender.id);

    const handlerRating = computeMixRating(handler, handlerMix, config, pressure, undefined, handlerPenalty);
    const screenerRating = computeMixRating(screener, config.tactics.screenerMix, config, pressure, undefined, screenerPenalty);
    const onBallRating = computeMixRating(onBallRoleDefender, defenderMix, config, pressure, undefined, onBallRolePenalty);
    const rollDefRating = computeMixRating(rollRoleDefender, config.tactics.screenerDefenderMix, config, pressure, undefined, rollRolePenalty);

    const offenseRating = handlerRating * cfg.handlerWeight + screenerRating * cfg.screenerWeight;
    const defenseRating = onBallRating * cfg.onBallDefenderWeight + rollDefRating * cfg.screenerDefenderWeight;

    const noise = gaussianRandom() * cfg.noiseSigma;
    let raw = baseScore + cfg.sensitivity * (offenseRating - defenseRating) + noise;
    // TAC-3 (7.12.6/7.12.34, pendiente heredado de TAC-2): único punto donde
    // el spacing EFECTIVO real entra a la fórmula — ver
    // computeSpacingAdvantageTerm más abajo.
    raw += computeSpacingAdvantageTerm(offenseFive, offenseSpacing, config);
    // TAC-4 (7.12.14): único punto donde el esquema defensivo de ZONA entra
    // a la fórmula de un P&R — ver computeZoneAdvantageTerm más abajo.
    raw += computeZoneAdvantageTerm(offenseFive, offenseSpacing, defenseBaseScheme, 'pickAndRoll', config);
    return clamp(raw, -1, 1);
  }

  // Bifurcación de lectura (7.12.4/7.12.31): TAC-1 solo diferencia 3 ramas
  // (mínimo demostrable de 7.12.33), no las 6 categorías completas de
  // telemetría de 7.12.4 — "ventaja defensiva clara" y "defensa estable"
  // colapsan ambas en 'low' (bucle 1v1 normal); "defensa en rotación" y
  // "defensa rota" colapsan en 'clear' (el roller termina la jugada). Las
  // 6 categorías completas y sus transiciones dentro de una misma posesión
  // eran TAC-3 (continuidad/counters), explícitamente fuera de esta entrega.
  //
  // ACTUALIZACIÓN TAC-3: las 6 categorías reales de 7.12.4 ya existen
  // (resolveRead6 más abajo). Esta función se mantiene tal cual para no
  // romper el contrato de 3 ramas de planPnrPossession/pickRollFinishType
  // (legacy, sigue exportada para tests dirigidos) — ahora es un colapso
  // 6→3 (collapseRead6To3) en vez de un cálculo de umbrales propio, pero
  // con los MISMOS umbrales (smallAdvantage/clearAdvantage sin cambiar de
  // valor), así que devuelve exactamente los mismos resultados que antes.
  function resolveRead(advantageScore, config) {
    return collapseRead6To3(resolveRead6(advantageScore, config));
  }

  // Tipo de finalización del roller en la rama de ventaja clara (rama 3,
  // ver planPnrPossession): SOLO Tiro interior o Bandeja (pedido explícito
  // del prompt, punto 5) — variante restringida de
  // MatchEngine.pickShotType (que sortea entre los 4 tipos), no una
  // duplicación de esa función: aquí el universo son solo 2 tipos porque
  // el roller termina cerca del aro, nunca con un triple.
  function pickRollFinishType(player, getAttribute) {
    const weights = {
      insideShot: getAttribute(player, 'insideShot') + 1,
      layup: getAttribute(player, 'layup') + 1,
    };
    const entries = Object.entries(weights);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < entries.length; i += 1) {
      const [key, w] = entries[i];
      if (roll < w) return key;
      roll -= w;
    }
    return entries[entries.length - 1][0];
  }

  // --- Punto de entrada único que llama MatchEngine.simulatePossession ---
  // Devuelve `null` si esta posesión NO es un P&R táctico (sin perfil
  // ofensivo asignado, o no tocó el sorteo de pnrFrequency) — en ese caso
  // MatchEngine debe comportarse exactamente como si Tactics.js no
  // existiera. Si devuelve un plan, MatchEngine usa sus campos para
  // sustituir SOLO la elección de ballHandler/onBallDefender/shotDefender/
  // shotType de esa posesión — 7.6 sigue resolviendo el tiro/rebote/falta
  // con las mismas fórmulas de siempre (regla de integración #1, 7.12.30).
  //
  // Campos del plan devuelto:
  // - handler/screener: quinteto real implicado en el bloqueo.
  // - coverage: cobertura defensiva resuelta ('drop'|'under'|'switch'|
  //   'hedge'|'blitz').
  // - screenerDefender: quién defiende al bloqueador.
  // - effectiveOnBallDefender: quién defiende de cerca al `handler` YA
  //   considerando el cambio de asignación de Switch.
  // - read: 'low' | 'small' | 'clear' — bifurcación de 7.12.4/7.12.31.
  // - rollerDefender: quién defiende al `screener` si termina la jugada
  //   como roller (rama 'clear') — el propio `screenerDefender` si no ha
  //   rotado (Drop/Under), o `onBallDefender` si la cobertura fue Switch/
  //   Blitz/Hedge (7.12.16, "vulnerabilidades emergentes").
  // - advantageScore: valor -1..+1, expuesto solo para telemetría/debug
  //   (7.12.33: "sin frontend complejo, un flag de debug/consola basta").
  function planPnrPossession(params) {
    const {
      offenseTacticalProfile, defenseTacticalProfile, offenseFive, defenseFive, onBallDefender,
      config, pressure, computeMixRating, getAttribute, usageWeight,
      offenseRotationState, defenseRotationState,
    } = params;

    const possessionPlan = buildPossessionPlan(offenseTacticalProfile, offenseFive, config, usageWeight, getAttribute);
    if (!possessionPlan) return null;
    const { handler, screener } = possessionPlan;

    const defensivePlan = buildDefensivePlan(defenseTacticalProfile, defenseFive, onBallDefender, config, getAttribute);
    const { coverage, screenerDefender } = defensivePlan;

    const advantageScore = computeAdvantageScore({
      handler, screener, onBallDefender, screenerDefender, coverage, config, pressure,
      computeMixRating, offenseRotationState, defenseRotationState,
    });
    const read = resolveRead(advantageScore, config);

    // Switch: el defensor real del handler pasa a ser screenerDefender
    // (ver nota de mismatch en computeAdvantageScore) — cualquier otra
    // cobertura mantiene al onBallDefender original defendiendo de cerca.
    const effectiveOnBallDefender = coverage === 'switch' ? screenerDefender : onBallDefender;

    // Vulnerabilidades emergentes de 7.12.16: si el roller recibe el
    // balón (rama 'clear'), quién queda de ayuda depende de si el
    // defensor del bloqueador rotó o no. Drop/Under: no rota, sigue
    // defendiendo el aro — es él quien contesta el roll. Switch/Blitz/
    // Hedge: comprometió al balón (cambió o dobló), así que es el
    // onBallDefender original quien queda como única ayuda disponible.
    const rollerDefender = (coverage === 'switch' || coverage === 'blitz' || coverage === 'hedge')
      ? onBallDefender : screenerDefender;

    const forcedShotType = read === 'clear' ? pickRollFinishType(screener, getAttribute) : null;

    return {
      handler, screener, coverage, screenerDefender, effectiveOnBallDefender, rollerDefender,
      read, advantageScore, forcedShotType,
    };
  }

  // =========================================================================
  // TAC-2 (DESIGN.md 7.12.33): spacing efectivo, roles + roleFit,
  // valoraciones derivadas de quinteto. A diferencia de las funciones de
  // arriba (TAC-1), estas se llaman DIRECTAMENTE desde game.js (pantalla de
  // Tácticas), sin pasar por un partido en curso — usan getPlayerAttribute
  // propio (ver arriba) y reciben `config` explícito (mismo patrón que el
  // resto del módulo: los pesos son datos de MatchConfig.js, no lógica
  // hardcodeada aquí), en vez de leerlo ellas mismas de MatchConfig.js.
  // =========================================================================

  // Mezcla genérica de atributos ponderada (1-20), SIN Fatiga/Consistencia/
  // Presión de Momento — a diferencia de MatchEngine.computeMixRating (que
  // sí los aplica, porque mide rendimiento DURANTE una posesión concreta),
  // roleFit/las valoraciones de quinteto son una foto de APTITUD para
  // mostrar en una pantalla fuera de partido, no una previsión de
  // rendimiento en la jugada — no se reimplementa ese tratamiento aquí a
  // propósito, sería una duplicación real de la fórmula de 7.5/7.5-bis, no
  // una utilidad genérica como pickWeighted/gaussianRandom.
  function computeSimpleMix(player, mix) {
    let sum = 0;
    let total = 0;
    Object.entries(mix).forEach(([attrName, weight]) => {
      sum += getPlayerAttribute(player, attrName) * weight;
      total += weight;
    });
    return total > 0 ? sum / total : 0;
  }

  function averageMix(five, mix) {
    if (!five || five.length === 0) return 0;
    return five.reduce((sum, p) => sum + computeSimpleMix(p, mix), 0) / five.length;
  }

  // Media de los N jugadores con MAYOR puntuación en `mix` (no de los 5) —
  // usado donde solo importan los mejores en ese papel (creadores,
  // finalizadores), no la media de todo el quinteto.
  function topNMixAverage(five, mix, n) {
    if (!five || five.length === 0) return 0;
    const scores = five.map((p) => computeSimpleMix(p, mix)).sort((a, b) => b - a);
    const considered = scores.slice(0, Math.min(n, scores.length));
    return considered.reduce((a, b) => a + b, 0) / considered.length;
  }

  // 1-5 estrellas a partir de una puntuación en escala de atributo (1-20).
  // Sesión de consolidación: sustituye el escalón único cada 4 puntos
  // (agrupaba 17-20 en el mismo 5★, una de las causas de la saturación de
  // estrellas confirmada por auditoría) por 5 tramos desiguales que SÍ
  // distinguen 17 (4★) de 18-20 (5★) — decisión ya tomada por Dennis, los
  // umbrales viven en `config.tactics.starRating.thresholds` (nunca
  // hardcodeados aquí), mismo criterio que el resto de coeficientes
  // calibrables del sistema táctico (tabla completa en DESIGN.md 7.12.9).
  function starsFromScore20(score, config) {
    const t = config.tactics.starRating.thresholds;
    const clamped = clamp(score, 1, 20);
    if (clamped <= t.oneStarMax) return 1;
    if (clamped <= t.twoStarMax) return 2;
    if (clamped <= t.threeStarMax) return 3;
    if (clamped <= t.fourStarMax) return 4;
    return 5;
  }

  // --- 7.12.6: effectiveSpacing ---
  // "Amenaza de tiro exterior real" de un jugador (config.tactics.spacing.
  // shotThreatMix) — no es un atributo nuevo, es la misma mezcla aplicada a
  // outsideShot/midRangeShot que ya existían en 6.1.
  function shotThreatValue(player, config) {
    return computeSimpleMix(player, config.tactics.spacing.shotThreatMix);
  }

  // Spacing efectivo real (0..1) de un quinteto REAL en pista (los 5 de
  // `getOnCourtFive`, nunca el roster completo) cruzando el spacing
  // DECLARADO con la amenaza de tiro real de esos 5 (7.12.6, 7.12.31
  // invariantes 5/6). 'dynamic' no tiene techo propio: usa el MEJOR ajuste
  // real de los otros tres para este quinteto concreto (7.12.6, "el spacing
  // cambia según quinteto, jugada y rol" — aquí solo "quinteto", jugada/rol
  // son TAC-3).
  //
  // Pendiente de calibración (7.12.34): la fórmula exacta (qué N jugadores
  // cuentan, el techo por arquetipo) es un punto de partida verificado en
  // DIRECCIÓN, no una cifra cerrada — ver script de verificación de esta
  // entrega.
  function effectiveSpacing(spacing, five, config) {
    if (!five || five.length === 0) return 0;
    const spacingCfg = config.tactics.spacing;
    if (spacing === 'dynamic') {
      const fixedOptions = Object.keys(spacingCfg.shooterRequirement);
      return Math.max(...fixedOptions.map((option) => effectiveSpacing(option, five, config)));
    }
    const required = spacingCfg.shooterRequirement[spacing];
    if (!required) return 0;
    const threats = five.map((p) => shotThreatValue(p, config)).sort((a, b) => b - a);
    const considered = threats.slice(0, Math.min(required, threats.length));
    const averageThreat = considered.reduce((a, b) => a + b, 0) / considered.length; // escala 1-20
    const ceiling = spacingCfg.archetypeCeiling[spacing] !== undefined ? spacingCfg.archetypeCeiling[spacing] : 1;
    return clamp((averageThreat / 20) * ceiling, 0, 1);
  }

  // --- 7.12.9 / 7.12.21: catálogo de roles ofensivos/defensivos ---
  // Solo id/etiqueta/posiciones preferentes (datos de catálogo, como
  // PNR_COVERAGES arriba) — los PESOS de atributo de cada rol viven en
  // MatchConfig.js (config.tactics.roles.offensiveMix/defensiveMix, mismo
  // criterio que coverageHandlerMix). `positions`: usadas para la
  // competencia posicional (6.1) de roleFit, no una restricción dura — un
  // jugador de otra posición puede seguir jugando el rol, solo puntúa peor.
  const OFFENSIVE_ROLES = [
    { id: 'primaryCreator', label: 'Creador primario', positions: ['Base', 'Escolta'] },
    { id: 'secondaryCreator', label: 'Creador secundario', positions: ['Base', 'Escolta', 'Alero'] },
    { id: 'pnrHandler', label: 'PnR Handler', positions: ['Base'] },
    { id: 'isolationScorer', label: 'Isolation Scorer', positions: ['Escolta', 'Alero'] },
    { id: 'spotUpShooter', label: 'Spot-up Shooter', positions: ['Escolta', 'Alero'] },
    { id: 'movementShooter', label: 'Movement Shooter', positions: ['Escolta', 'Alero'] },
    { id: 'slasher', label: 'Slasher', positions: ['Escolta', 'Alero', 'Ala-pívot'] },
    { id: 'connector', label: 'Connector', positions: ['Alero', 'Ala-pívot'] },
    { id: 'postScorer', label: 'Post Scorer', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'postHub', label: 'Post Hub', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'rollMan', label: 'Roll Man', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'shortRollPlaymaker', label: 'Short-Roll Playmaker', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'pickAndPopBig', label: 'Pick & Pop Big', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'primaryScreener', label: 'Primary Screener', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'offensiveRebounder', label: 'Offensive Rebounder', positions: ['Ala-pívot', 'Pívot'] },
  ];

  const DEFENSIVE_ROLES = [
    { id: 'poaStopper', label: 'POA Stopper', positions: ['Base', 'Escolta'] },
    { id: 'screenNavigator', label: 'Screen Navigator', positions: ['Base', 'Escolta', 'Alero'] },
    { id: 'switchDefender', label: 'Switch Defender', positions: ['Alero', 'Ala-pívot'] },
    { id: 'perimeterDisruptor', label: 'Perimeter Disruptor', positions: ['Base', 'Escolta'] },
    { id: 'nailHelper', label: 'Nail Helper', positions: ['Alero', 'Ala-pívot'] },
    { id: 'lowMan', label: 'Low Man', positions: ['Ala-pívot', 'Pívot'] },
    { id: 'rimProtector', label: 'Rim Protector', positions: ['Pívot', 'Ala-pívot'] },
    { id: 'postAnchor', label: 'Post Anchor', positions: ['Pívot'] },
    { id: 'roamer', label: 'Roamer', positions: ['Alero', 'Ala-pívot'] },
    { id: 'defensiveRebounder', label: 'Defensive Rebounder', positions: ['Ala-pívot', 'Pívot'] },
  ];

  function findRoleDefinition(roleId) {
    return OFFENSIVE_ROLES.find((r) => r.id === roleId) || DEFENSIVE_ROLES.find((r) => r.id === roleId) || null;
  }

  function roleSide(roleId) {
    if (OFFENSIVE_ROLES.some((r) => r.id === roleId)) return 'offensive';
    if (DEFENSIVE_ROLES.some((r) => r.id === roleId)) return 'defensive';
    return null;
  }

  // --- 7.12.9 / 7.12.21: roleFit (1-5 estrellas) ---
  // Valoración DERIVADA (nunca un atributo nuevo de Player.js, pedido
  // explícito del prompt): mezcla de atributos del rol (70%) + competencia
  // posicional real del jugador (6.1, 30% — la mejor de las posiciones
  // preferentes del rol) + un factor pequeño de estado físico (Energía
  // actual, 7.12.9 "estado físico"). Puede calcularse para CUALQUIER rol
  // del catálogo contra cualquier jugador, no solo el asignado — para que
  // la UI compare candidatos (pedido explícito del prompt).
  function roleFit(player, roleId, config) {
    const definition = findRoleDefinition(roleId);
    if (!definition) {
      throw new Error(`Tactics.roleFit: rol desconocido "${roleId}"`);
    }
    const side = roleSide(roleId);
    const rolesCfg = config.tactics.roles;
    const mix = (side === 'offensive' ? rolesCfg.offensiveMix : rolesCfg.defensiveMix)[roleId];
    const mixScore = computeSimpleMix(player, mix);
    const positionScore = Math.max(...definition.positions.map((pos) => player.positionLevel(pos)));
    const fitWeights = rolesCfg.fitWeights;
    const energyFactor = fitWeights.energyBaseline + fitWeights.energyRange * (player.dynamicState.energy / 100);
    const combined = (mixScore * fitWeights.attributeMixWeight + positionScore * fitWeights.positionLevelWeight) * energyFactor;
    return { score: combined, stars: starsFromScore20(combined, config) };
  }

  // Los `topN` roles de un lado (ofensivo/defensivo) con mejor `roleFit`
  // para un jugador — para la vista "Roles" de la pantalla de Tácticas
  // (7.12.32: "2-3 roles con mejor encaje de cada jugador").
  function bestRolesForPlayer(player, side, config, topN = 3) {
    const catalog = side === 'offensive' ? OFFENSIVE_ROLES : DEFENSIVE_ROLES;
    return catalog
      .map((definition) => ({ roleId: definition.id, label: definition.label, ...roleFit(player, definition.id, config) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // --- 7.12.28: valoraciones derivadas de quinteto ---
  // TAC-2 dejó fuera Switchability/Rim Protection/Transition Offense/
  // Transition Defense/Tactical Execution por depender de piezas que
  // todavía no existían (defensa avanzada era TAC-4, familiaridad/
  // tacticalExecution es TAC-6). TAC-4 (esta entrega) completa
  // Switchability/Rim Protection/Transition Defense — ya hay una base de
  // datos sólida (DefensiveScheme, matchups, transición defensiva, ver
  // MatchConfig.js `lineupRatings`/`transitionDefense`) para calcularlas
  // con sentido, pedido explícito del prompt de esta sesión (punto 7).
  // Transition Offense/POA Defense/Tactical Execution SIGUEN fuera (ninguna
  // pedida por el prompt de esta entrega) — señalado explícitamente en el
  // CHANGELOG, no se inventan con datos que no hay.
  const CREATION_MIX = { gameVision: 0.4, passing: 0.35, ballHandling: 0.25 };
  const FINISHING_MIX = { insideShot: 0.5, layup: 0.5 };

  function computeLineupRatings(five, tacticalProfile, config) {
    const spacingScore20 = effectiveSpacing(tacticalProfile.spacing, five, config) * 20;
    const raw = {
      creation: topNMixAverage(five, CREATION_MIX, 2),
      spacing: spacingScore20,
      outsideShooting: averageMix(five, { outsideShot: 1 }),
      insideFinishing: topNMixAverage(five, FINISHING_MIX, 2),
      offensiveRebound: averageMix(five, { offensiveRebound: 1 }),
      defensiveRebound: averageMix(five, { defensiveRebound: 1 }),
      switchability: averageMix(five, config.tactics.lineupRatings.switchabilityMix),
      rimProtection: averageMix(five, config.tactics.lineupRatings.rimProtectionMix),
      // Reutiliza LITERALMENTE la misma mezcla que
      // computeTransitionDefenseAdjustment (más abajo) — no una
      // aproximación distinta solo para mostrar en pantalla.
      transitionDefense: averageMix(five, config.tactics.transitionDefense.retreatMix),
      // --- TAC-7 (7.12.28, punto 5): Transition Offense/POA Defense/
      // Tactical Execution, pendientes desde TAC-2/TAC-4. Las dos primeras
      // son valoraciones de APTITUD de plantilla (igual que el resto de
      // esta función): se recalculan al cambiar un jugador sin necesitar
      // ningún partido jugado, así que NO usan `tacticsTelemetry` (esa
      // telemetría real de PPP/frecuencia en transición vive en
      // `summarizeTacticsTelemetry`, un informe distinto, de partidos
      // jugados). POA Defense reutiliza LITERALMENTE
      // `roles.defensiveMix.poaStopper` (7.12.21) — es exactamente lo que
      // ese rol ya mide, no una mezcla nueva.
      transitionOffense: averageMix(five, config.tactics.lineupRatings.transitionOffenseMix),
      poaDefense: averageMix(five, config.tactics.roles.defensiveMix.poaStopper),
    };
    const out = {};
    Object.entries(raw).forEach(([key, score]) => { out[key] = { score, stars: starsFromScore20(score, config) }; });
    // Tactical Execution SÍ depende de `tacticalProfile` (familiaridad de
    // sistema + eje Rigidez↔Read & React, TAC-6) — no es una mezcla
    // simple de atributos como el resto de `raw`, así que se calcula
    // aparte reutilizando LITERALMENTE `computeTacticalExecution` (nunca
    // un segundo cálculo de ejecución colectiva): "complejidad 0" porque
    // esta es una foto en reposo del quinteto (sin ninguna jugada concreta
    // elegida todavía), no la ejecución de una posesión real.
    const familiarityFactor = tacticalProfile.familiarity
      ? (tacticalProfile.familiarity.offensiveSystem + tacticalProfile.familiarity.defensiveSystem) / 200
      : FAMILIARITY_DEFAULT / 100;
    const rigidityAxis = (tacticalProfile.identity && tacticalProfile.identity.rigidity !== undefined)
      ? tacticalProfile.identity.rigidity : 50;
    const tacticalExecutionValue = computeTacticalExecution({
      participants: five, familiarityFactor, complexity: 0, rigidityAxis, config, getAttribute: getPlayerAttribute,
    });
    out.tacticalExecution = { score: tacticalExecutionValue * 20, stars: starsFromScore20(tacticalExecutionValue * 20, config) };
    return out;
  }

  // =========================================================================
  // TAC-3 (DESIGN.md 7.12.33): playbook (7.12.10), selección real de
  // play-type (7.12.8), AdvantageState de 6 categorías + continuidad
  // (7.12.4/7.12.11), shotQuality/asistencia causal (7.12.5) y conexión de
  // effectiveSpacing a AdvantageState (7.12.6/7.12.34, pendiente heredado
  // de TAC-2, ver computeSpacingAdvantageTerm arriba). AMPLÍA TAC-1/TAC-2,
  // no los reescribe: buildPossessionPlan/buildDefensivePlan/
  // computeAdvantageScore/resolveRead/pickRollFinishType/
  // resolvePnrFrequency/planPnrPossession de arriba siguen exportados tal
  // cual (comportamiento idéntico) para no romper ningún test dirigido de
  // sesiones anteriores — la producción (MatchEngine.js) deja de llamar a
  // planPnrPossession y llama a planTacticalPossession en su lugar (ver
  // más abajo), que reutiliza buildPossessionPlan/buildDefensivePlan/
  // computeAdvantageScore como piezas, no los duplica.
  // =========================================================================

  // --- 7.12.10: Playbook — catálogo inicial (datos). Solo 9 de las 14
  // familias del catálogo objetivo de DESIGN.md (pedido explícito del
  // prompt de esta sesión) — Flex, Princeton Elbow/entry, Post Split,
  // High-Low y Pistol quedan FUERA, señalado explícitamente aquí y en el
  // CHANGELOG; ampliar el catálogo de datos después es barato, no bloquea
  // nada. `family` referencia una clave de `playTypeWeights` (7.12.8).
  // `reads`: 2-4 lecturas REPRESENTATIVAS por jugada (no la tabla completa
  // de 7.12.10) con su(s) cobertura(s) objetivo en `vs` — usadas para
  // telemetría/etiqueta del evento de partido (`playDefinitionId`), NUNCA
  // para bifurcar la fórmula real (la resuelve siempre AdvantageState,
  // "no scripting" 7.12.10). Lecturas explícitamente dejadas fuera del
  // catálogo completo de 7.12.10 (ej. re-screen de Basic P&R, cambio de
  // ángulo de Horns, weak-side action de Post Entry): señaladas en el
  // CHANGELOG, no una lista cerrada.
  const PLAY_DEFINITIONS = [
    {
      id: 'basicHighPnr',
      name: 'Basic High P&R',
      family: 'pickAndRoll',
      participants: ['handler', 'screener'],
      compatibleSpacing: ['4-out-1-in', '3-out-2-in', 'dynamic'],
      complexity: 20,
      reads: [
        { id: 'pullUp', label: 'Pull-up del handler', vs: ['drop', 'under'] },
        { id: 'rollFinish', label: 'Finalización del roller', vs: ['drop', 'switch'] },
        { id: 'kickOut', label: 'Kick-out a tirador abierto', vs: ['blitz', 'hedge'] },
      ],
    },
    {
      id: 'horns',
      name: 'Horns',
      family: 'pickAndRoll',
      participants: ['handler', 'screener', 'weakSideBig'],
      compatibleSpacing: ['4-out-1-in', 'dynamic'],
      complexity: 45,
      reads: [
        { id: 'sidePnr', label: 'P&R lateral tras el doble bloqueo de codo', vs: ['drop', 'switch'] },
        { id: 'elbowPop', label: 'Pop del segundo interior en el codo libre', vs: ['blitz', 'hedge'] },
        { id: 'reScreen', label: 'Re-screen del segundo bloqueador', vs: ['under'] },
      ],
    },
    {
      id: 'spainPnr',
      name: 'Spain Pick & Roll',
      family: 'pickAndRoll',
      participants: ['handler', 'screener', 'backScreener'],
      compatibleSpacing: ['4-out-1-in', '3-out-2-in', 'dynamic'],
      complexity: 70,
      reads: [
        { id: 'popBackScreener', label: 'Pop del back-screener tras bloquear al ayudador', vs: ['drop'] },
        { id: 'lob', label: 'Lob al roller si el back-screen deja el aro libre', vs: ['drop', 'under'] },
        { id: 'kickOutBackScreener', label: 'Kick-out al back-screener liberado', vs: ['blitz', 'hedge'] },
        { id: 'attackMismatch', label: 'Atacar el mismatch generado por el cambio', vs: ['switch'] },
      ],
    },
    {
      id: 'doubleDrag',
      name: 'Double Drag',
      family: 'pickAndRoll',
      participants: ['handler', 'screener', 'secondScreener'],
      compatibleSpacing: ['4-out-1-in', 'dynamic'],
      complexity: 55,
      reads: [
        { id: 'secondScreenAttack', label: 'Ataque tras el segundo bloqueo (doble ventaja)', vs: ['drop', 'switch'] },
        { id: 'shortRoll', label: 'Short-roll del primer bloqueador', vs: ['blitz', 'hedge'] },
      ],
    },
    {
      id: 'dhoZoom',
      name: 'DHO / Zoom',
      family: 'handoff',
      participants: ['hubPlayer', 'cutter'],
      compatibleSpacing: ['5-out', '4-out-1-in', 'dynamic'],
      complexity: 40,
      reads: [
        { id: 'catchAndShoot', label: 'Catch-and-shoot tras el handoff', vs: ['under', 'drop'] },
        { id: 'driveOffHandoff', label: 'Penetración del receptor tras el DHO', vs: ['switch'] },
      ],
    },
    {
      id: 'floppy',
      name: 'Floppy',
      family: 'offScreen',
      participants: ['shooter', 'screener1', 'screener2'],
      compatibleSpacing: ['5-out', '4-out-1-in', 'dynamic'],
      complexity: 35,
      reads: [
        { id: 'curl', label: 'Curl hacia el aro si niegan el exterior', vs: ['switch'] },
        { id: 'catchAndShoot', label: 'Catch-and-shoot tras el doble bloqueo', vs: ['under', 'drop'] },
      ],
    },
    {
      id: 'postEntry',
      name: 'Post Entry',
      family: 'postUp',
      participants: ['postHub'],
      compatibleSpacing: ['3-out-2-in', '4-out-1-in', 'dynamic'],
      complexity: 25,
      reads: [
        { id: 'directFinish', label: 'Finalización directa 1v1 desde poste', vs: ['drop', 'under'] },
        { id: 'kickOutDoubleTeam', label: 'Kick-out si llega el doble equipo', vs: ['switch', 'blitz'] },
      ],
    },
    {
      id: 'fiveOutMotion',
      name: '5-Out Motion',
      family: 'motionFlow',
      participants: [],
      compatibleSpacing: ['5-out'],
      complexity: 60,
      reads: [
        { id: 'backdoorCut', label: 'Corte backdoor si niegan la línea de pase', vs: ['switch', 'drop'] },
        { id: 'extraPass', label: 'Extra-pass buscando el mejor tiro disponible', vs: ['under', 'blitz'] },
      ],
    },
    {
      id: 'isolationClearout',
      name: 'Isolation Clearout',
      family: 'isolation',
      participants: ['isolationScorer'],
      compatibleSpacing: ['5-out', '4-out-1-in', 'dynamic'],
      complexity: 15,
      reads: [
        { id: 'directAttack', label: 'Ataque directo 1v1', vs: ['drop', 'under', 'switch'] },
        { id: 'lateHelp', label: 'Kick-out si llega la ayuda tardía', vs: ['blitz', 'hedge'] },
      ],
    },

    // --- TAC-5 (7.12.24): sub-playbook de situaciones especiales — MISMA
    // arquitectura PlayDefinition que el resto del catálogo (7.12.10: no
    // garantizan un tiro concreto, "su eficacia depende de jugadores,
    // cobertura y familiaridad" — la familiaridad en sí sigue sin efecto,
    // TAC-6). `situationType` (7.12.24, catálogo Tactics.SITUATION_TYPES)
    // marca a qué situación pertenece; `resolvesAs` indica con qué motor de
    // los 3 REAL_PLAY_FAMILIES existentes se resuelve de verdad (nunca un
    // cuarto motor de resolución paralelo, pedido explícito del prompt de
    // esta sesión — reutiliza planPickAndRollTactical/buildIsolationPlan/
    // buildPostUpPlan tal cual, ver planSituationalPossession más abajo).
    // Solo 1-2 jugadas por situación (catálogo mínimo, no las 14+ familias
    // completas de un playbook real de ATO) — ampliar el catálogo de datos
    // después es barato, señalado explícitamente como pendiente (7.12.34).
    {
      id: 'atoSidePnr',
      name: 'ATO — P&R lateral tras tiempo muerto',
      family: 'pickAndRoll',
      situationType: 'ATO',
      resolvesAs: 'pickAndRoll',
      participants: ['handler', 'screener'],
      compatibleSpacing: ['4-out-1-in', '3-out-2-in', 'dynamic'],
      complexity: 40,
      reads: [
        { id: 'drawnUpPullUp', label: 'Pull-up del handler tras el bloqueo dibujado en el tiempo muerto', vs: ['drop', 'under'] },
        { id: 'drawnUpRoll', label: 'Finalización del roller sobre la jugada preparada', vs: ['switch', 'blitz', 'hedge'] },
      ],
    },
    {
      id: 'atoIsolationMismatch',
      name: 'ATO — Aislar el mismatch buscado en el tiempo muerto',
      family: 'isolation',
      situationType: 'ATO',
      resolvesAs: 'isolation',
      participants: ['isolationScorer'],
      compatibleSpacing: ['5-out', '4-out-1-in', 'dynamic'],
      complexity: 35,
      reads: [
        { id: 'directAttack', label: 'Ataque directo al mismatch dibujado', vs: ['drop', 'under', 'switch'] },
      ],
    },
    {
      id: 'blobPostEntry',
      name: 'BLOB — Entrada directa al poste tras canasta rival',
      family: 'postUp',
      situationType: 'BLOB',
      resolvesAs: 'postUp',
      participants: ['postHub'],
      compatibleSpacing: ['3-out-2-in', '4-out-1-in', 'dynamic'],
      complexity: 20,
      reads: [
        { id: 'directFinish', label: 'Finalización directa desde poste tras el saque de fondo', vs: ['drop', 'under'] },
      ],
    },
    {
      id: 'slobSidePnr',
      name: 'SLOB — P&R de saque de banda',
      family: 'pickAndRoll',
      situationType: 'SLOB',
      resolvesAs: 'pickAndRoll',
      participants: ['handler', 'screener'],
      compatibleSpacing: ['4-out-1-in', 'dynamic'],
      complexity: 30,
      reads: [
        { id: 'pullUp', label: 'Pull-up tras el bloqueo de saque de banda', vs: ['drop', 'under'] },
      ],
    },
    {
      id: 'lateClockIsolation',
      name: 'Late Clock — Isolation con poco reloj de posesión',
      family: 'isolation',
      situationType: 'lateClock',
      resolvesAs: 'isolation',
      participants: ['isolationScorer'],
      compatibleSpacing: ['5-out', '4-out-1-in', '3-out-2-in', 'dynamic'],
      complexity: 15,
      reads: [
        { id: 'forcedAttack', label: 'Ataque forzado 1v1 sin tiempo para más', vs: ['drop', 'under', 'switch', 'blitz', 'hedge'] },
      ],
    },
    {
      id: 'lastPossessionSidePnr',
      name: 'Last Possession — P&R para el último tiro',
      family: 'pickAndRoll',
      situationType: 'lastPossession',
      resolvesAs: 'pickAndRoll',
      participants: ['handler', 'screener'],
      compatibleSpacing: ['4-out-1-in', '3-out-2-in', 'dynamic'],
      complexity: 45,
      reads: [
        { id: 'pullUp', label: 'Último tiro del handler tras el bloqueo', vs: ['drop', 'under'] },
        { id: 'kickOut', label: 'Kick-out al tirador liberado para el último tiro', vs: ['blitz', 'hedge', 'switch'] },
      ],
    },
  ];

  // Familias con comportamiento real EN ESTA ENTREGA (7.12.8, punto 2 del
  // prompt): pickAndRoll ya existía (TAC-1); isolation/postUp lo estrenan
  // aquí. handoff/offScreen/motionFlow quedan como catálogo puro (sin
  // motor propio) hasta una entrega futura — sus PlayDefinition ya
  // existen arriba para no bloquear ampliar el catálogo de datos después.
  const REAL_PLAY_FAMILIES = ['pickAndRoll', 'isolation', 'postUp'];

  function getPlayDefinition(id) {
    return PLAY_DEFINITIONS.find((p) => p.id === id) || null;
  }

  // Jugada concreta del catálogo elegida dentro de una familia (7.12.10,
  // "no scripting": esto NUNCA cambia la fórmula de AdvantageState, solo
  // decide qué `playDefinitionId` se etiqueta en el evento de partido para
  // telemetría) — pendiente de calibración/decisión (7.12.34): ponderado
  // por compatibilidad de spacing declarado (jugadas compatibles con el
  // spacing actual del equipo pesan más) y, en igualdad, por menor
  // complejidad (más fácil de ejecutar bien sin familiaridad todavía
  // modelada, TAC-6). Sin editor de prioridad por jugada todavía (ver
  // pantalla de Playbook, punto 6 del prompt — deferido explícitamente).
  function choosePlayDefinition(family, tacticalProfile, config) {
    const candidates = PLAY_DEFINITIONS.filter((p) => p.family === family);
    if (candidates.length === 0) return null;
    const spacing = tacticalProfile && tacticalProfile.spacing;
    return pickWeighted(candidates, (p) => {
      const compatible = spacing && p.compatibleSpacing.indexOf(spacing) !== -1;
      const complexityWeight = Math.max(1, 100 - p.complexity);
      return (compatible ? 2 : 1) * complexityWeight;
    });
  }

  // --- 7.12.4: AdvantageState de 6 categorías (sustituye la bifurcación de
  // 3 ramas de TAC-1 como fuente de verdad; collapseRead6To3 más abajo
  // mantiene el contrato de 3 ramas para planPnrPossession/resolveRead). ---
  function resolveRead6(advantageScore, config) {
    const t = config.tactics.advantage.thresholds;
    if (advantageScore < t.clearDefenseAdvantage) return 'clearDefenseAdvantage';
    if (advantageScore < t.stableDefense) return 'stableDefense';
    if (advantageScore < t.smallAdvantage) return 'smallOffenseAdvantage';
    if (advantageScore < t.clearOffenseAdvantage) return 'clearOffenseAdvantage';
    if (advantageScore < t.clearAdvantage) return 'rotatingDefense';
    return 'brokenDefense';
  }

  // Colapso 6→3 (decisión de encaje de esta entrega, ver prompt punto 3):
  // se MANTIENE para que planPnrPossession/resolveRead (legacy, TAC-1)
  // sigan devolviendo exactamente 'low'/'small'/'clear' sin cambiar su
  // contrato, en vez de migrar TAC-1 entero a las 6 categorías. Mismo
  // agrupamiento que ya documentaba el comentario original de
  // resolveRead: defensiva clara + estable → low; pequeña + clara
  // ofensiva → small; rotación + rota → clear. Como `smallAdvantage`
  // (0.15) y `clearAdvantage` (0.5) NO cambian de valor en esta entrega,
  // el resultado de resolveRead()/planPnrPossession() para cualquier
  // cobertura es numéricamente idéntico al de TAC-1/TAC-2.
  function collapseRead6To3(read6) {
    if (read6 === 'clearDefenseAdvantage' || read6 === 'stableDefense') return 'low';
    if (read6 === 'smallOffenseAdvantage' || read6 === 'clearOffenseAdvantage') return 'small';
    return 'clear';
  }

  // --- 7.12.6/7.12.34 (TAC-3): conexión de effectiveSpacing con
  // AdvantageState — pendiente explícito heredado de TAC-2. ---
  // Único sitio donde el spacing EFECTIVO real (no el declarado) entra a
  // la fórmula de ventaja (evita doble conteo, 7.12.4): no se aplica
  // además como bono de tiro en shotQuality ni en elección de ayuda (que
  // este motor no modela todavía, TAC-4). `neutral` (pendiente de
  // calibración, 7.12.34) aproxima el effectiveSpacing típico de un
  // quinteto de nivel medio en 4-Out-1-In (spacing por defecto) — un
  // quinteto/spacing MEJOR que eso suma ventaja ofensiva, uno PEOR la
  // resta; `sensitivity`/`maxEffect` acotan el término para que nunca
  // domine sobre la diferencia real de rating de los protagonistas
  // (7.12.31, mismo criterio que el resto de `advantage`). Sin
  // `offenseFive`/`offenseSpacing` (llamadas legacy de TAC-1/TAC-2 que no
  // los pasan), devuelve 0 — comportamiento idéntico al de antes.
  function computeSpacingAdvantageTerm(offenseFive, offenseSpacing, config) {
    if (!offenseFive || !offenseSpacing) return 0;
    const cfg = config.tactics.advantage.spacing;
    if (!cfg) return 0;
    const value = effectiveSpacing(offenseSpacing, offenseFive, config);
    const term = cfg.sensitivity * (value - cfg.neutral);
    return clamp(term, -cfg.maxEffect, cfg.maxEffect);
  }

  // --- 7.12.14 (TAC-4): efecto real de la defensa de ZONA sobre
  // AdvantageState — mismo patrón ACOTADO/aditivo que computeSpacingAdvantageTerm
  // (evita doble conteo, 7.12.4), NUNCA un opponent3P+X/opponentInside-Y
  // directo (7.12.14 lo prohíbe explícitamente). La pieza dominante es el
  // término de spacing: una zona debe ser MÁS vulnerable a un quinteto con
  // effectiveSpacing real alto (la estira) que a uno sin amenaza exterior
  // real (se contrae sin coste) — invariante nuevo de esta entrega,
  // verificado en el script de esta sesión. `playTypeCounters` conecta las
  // "1-2 contramedidas reales" mínimas pedidas por el prompt (Post Up
  // castiga el alto poste de una 2-3; Pick & Roll/Isolation explotan el
  // hueco de una 1-3-1 tras el trap) — sin construir un sub-sistema de
  // jugadas anti-zona completo (Overload, etc., señalado como pendiente).
  // Sin esquema o 'man-to-man' (7.12.34, compatibilidad): devuelve 0,
  // comportamiento idéntico a TAC-1/TAC-2/TAC-3.
  function computeZoneAdvantageTerm(offenseFive, offenseSpacing, defenseBaseScheme, playType, config) {
    if (!defenseBaseScheme || defenseBaseScheme === 'man-to-man') return 0;
    if (!offenseFive || !offenseSpacing) return 0;
    const cfg = config.tactics.defense && config.tactics.defense.zone;
    if (!cfg) return 0;
    const baseScore = (cfg.baseScoreByScheme && cfg.baseScoreByScheme[defenseBaseScheme]) || 0;
    const value = effectiveSpacing(offenseSpacing, offenseFive, config);
    const spacingTerm = cfg.spacingSensitivity * (value - cfg.spacingNeutral);
    const counterCfg = cfg.playTypeCounters && cfg.playTypeCounters[defenseBaseScheme];
    const counterTerm = (counterCfg && counterCfg[playType]) || 0;
    return clamp(baseScore + spacingTerm + counterTerm, -cfg.maxEffect, cfg.maxEffect);
  }

  // --- 7.12.15 (TAC-4): efecto real del PRESS sobre el tramo inicial de
  // la posesión — MODULA la probabilidad del rollTurnover() ya existente
  // de MatchEngine.js (nunca un resolver nuevo) y el reloj consumido en
  // cruzar medio campo, según la calidad de manejo/decisión del equipo
  // atacante (7.12.15: "exige DefensaPerimetral/Agilidad/Aceleración... de
  // forma táctica" — aquí, desde el punto de vista del ATACANTE que sufre
  // la presión: ballHandling/gameVision/DecisiónBajoPresión). Sin press
  // activo (7.12.34, compatibilidad): devuelve el par neutro
  // {turnoverMultiplier: 1, clockCost: 0}, idéntico a no tener este
  // término. El desgaste extra de Energía por presionar (7.12.15) queda
  // fuera — exigiría tocar Rotation.js/Recovery.js, vetado explícitamente
  // para esta entrega (ver CHANGELOG).
  function computePressEffect(offenseFive, defenseTacticalProfile, config, getAttribute) {
    const press = defenseTacticalProfile && defenseTacticalProfile.defensiveScheme && defenseTacticalProfile.defensiveScheme.press;
    if (!press || !press.active) return { turnoverMultiplier: 1, clockCost: 0 };
    const cfg = config.tactics.press;
    const handlingScore = averageMixWithAttribute(offenseFive, cfg.handlingMix, getAttribute); // escala 1-20
    const deficit = clamp((cfg.neutralHandling - handlingScore) / cfg.neutralHandling, -1, 1); // >0 = manejo pobre
    const boost = cfg.turnoverBoost[press.type] * (1 + deficit);
    const turnoverMultiplier = clamp(1 + boost, 1, cfg.maxMultiplier);
    const clockCost = cfg.clockCostSeconds[press.type] * (1 + Math.max(0, deficit) * 0.5);
    return { turnoverMultiplier, clockCost };
  }

  // --- 7.12.20 (TAC-4): transición defensiva — modificador DENTRO de la
  // ventana de contraataque YA EXISTENTE (7.6 acción 14, nunca la ventana
  // en sí, pedido explícito del prompt): un repliegue malo (media de
  // Velocidad/ÉticaDeTrabajo/Posicionamiento del quinteto que acaba de
  // perder el balón) amplía la ventaja de contraataque; uno excelente
  // puede neutralizarla parcialmente. Aproximación por atletismo agregado
  // del quinteto — este motor no distingue por jugador quién cargó el
  // rebote ofensivo vs quién se replegó (7.12.20 lo describe así),
  // señalado como simplificación explícita.
  function computeTransitionDefenseAdjustment(defenseFive, config, getAttribute) {
    const cfg = config.tactics.transitionDefense;
    const retreatScore = averageMixWithAttribute(defenseFive, cfg.retreatMix, getAttribute); // escala 1-20
    const term = cfg.sensitivity * (cfg.neutral - retreatScore);
    return clamp(term, -cfg.maxEffect, cfg.maxEffect);
  }

  // "Tirador del lado débil" para lecturas de extra-pass/kick-out (7.12.11
  // Rotation forced / doble equipo de Post Up / ayuda tardía de
  // Isolation): ponderado por Tiro exterior + Posicionamiento, excluyendo
  // a quien ya tenía el balón — heurística nueva mínima, mismo criterio
  // que screenerWeight/screenerDefenderWeight de TAC-1.
  function pickWeakSideShooter(five, exclude, getAttribute) {
    const candidates = five.filter((p) => p.id !== exclude.id);
    if (candidates.length === 0) return null;
    return pickWeighted(candidates, (p) => getAttribute(p, 'outsideShot') + getAttribute(p, 'positioning') + 1);
  }

  // Defensor que contesta un tiro nacido de una ayuda/rotación tardía
  // (7.12.4, "closeout imperfecto"): ponderado INVERSAMENTE a Defensa
  // perimetral (el defensor MENOS preparado de los cinco es quien más
  // probablemente llega tarde a cerrar), al contrario que el resto de
  // pickWeighted del motor (que siempre pondera A FAVOR del atributo).
  function pickLeastContestedDefender(five, getAttribute) {
    return pickWeighted(five, (p) => 1 / (getAttribute(p, 'perimeterDefense') + 1) + 0.01);
  }

  // --- 7.12.8/7.12.9 (TAC-3): Isolation con comportamiento real ---
  // Jugador: el marcado con rol ofensivo 'isolationScorer' (7.12.9) si
  // existe alguno en el quinteto real; si no, el de mayor usageWeight
  // (pedido explícito del prompt, punto 2 — TAC-2 no implementó una
  // jerarquía de uso primera/segunda opción todavía en `roleAssignments`,
  // así que no hay otra señal disponible). El defensor es el mismo
  // `onBallDefender` ya elegido por defecto en MatchEngine para esta
  // posesión (mismo criterio que ya usa Pick & Roll: no se inventa un
  // sistema de matchups por jugador, eso es TAC-4).
  function pickIsolationScorer(offenseFive, offenseTacticalProfile, usageWeight) {
    const assignments = (offenseTacticalProfile && offenseTacticalProfile.roleAssignments) || {};
    const designated = offenseFive.filter((p) => assignments[p.id] && assignments[p.id].offensiveRole === 'isolationScorer');
    const pool = designated.length > 0 ? designated : offenseFive;
    return pickWeighted(pool, usageWeight);
  }

  // Sin cobertura (no hay bloqueo): advantageScore = diferencia de rating
  // anotador/defensor directamente, sin `coverageBaseScore` por cobertura
  // (7.12.16 no aplica a Isolation).
  function computeIsolationAdvantageScore(params) {
    const {
      scorer, defender, config, pressure, computeMixRating, scorerPenalty, defenderPenalty,
      offenseFive, offenseSpacing,
      // TAC-4 (7.12.14): ver nota de computeAdvantageScore arriba.
      defenseBaseScheme,
    } = params;
    const cfg = config.tactics.isolation;
    const scorerRating = computeMixRating(scorer, cfg.scorerMix, config, pressure, undefined, scorerPenalty);
    const defenderRating = computeMixRating(defender, cfg.defenderMix, config, pressure, undefined, defenderPenalty);
    const noise = gaussianRandom() * cfg.noiseSigma;
    let raw = cfg.baseScore + cfg.sensitivity * (scorerRating - defenderRating) + noise;
    raw += computeSpacingAdvantageTerm(offenseFive, offenseSpacing, config);
    raw += computeZoneAdvantageTerm(offenseFive, offenseSpacing, defenseBaseScheme, 'isolation', config);
    return clamp(raw, -1, 1);
  }

  function buildIsolationPlan(params) {
    const {
      offenseFive, defenseFive, onBallDefender, offenseTacticalProfile, defenseTacticalProfile, config, pressure,
      computeMixRating, usageWeight, getAttribute, offenseRotationState, defenseRotationState, offenseSpacing,
      // TAC-6 (7.12.23): ver GamePlan.tacticalExecutionOverride.
      offenseTacticalExecutionOverride, defenseTacticalExecutionOverride,
    } = params;
    const scorer = pickIsolationScorer(offenseFive, offenseTacticalProfile, usageWeight);
    const defender = onBallDefender;
    const scorerPenalty = getPenalty(offenseRotationState, scorer.id);
    const defenderPenalty = getPenalty(defenseRotationState, defender.id);
    const defenseBaseScheme = defenseTacticalProfile && defenseTacticalProfile.defensiveScheme && defenseTacticalProfile.defensiveScheme.baseScheme;
    const advantageScore = computeIsolationAdvantageScore({
      scorer, defender, config, pressure, computeMixRating, scorerPenalty, defenderPenalty, offenseFive, offenseSpacing, defenseBaseScheme,
    });
    let read6 = resolveRead6(advantageScore, config);

    // TAC-6 (7.12.22): tacticalExecution — Isolation no tiene una jugada
    // concreta de PLAY_DEFINITIONS elegida por familia (siempre
    // 'isolationClearout'), así que su complejidad se lee directamente del
    // catálogo (ver getPlayDefinition más abajo).
    const isoDefinition = getPlayDefinition('isolationClearout');
    const complexity = isoDefinition ? isoDefinition.complexity : 0;
    const offenseParticipantIds = [scorer.id];
    const defenseParticipantIds = [defender.id];
    const offenseFamiliarity = resolveRelevantFamiliarity(offenseTacticalProfile, 'offensive', 'isolation', null, offenseParticipantIds);
    const defenseFamiliarity = resolveRelevantFamiliarity(defenseTacticalProfile, 'defensive', 'isolation', null, defenseParticipantIds);
    const offenseTacticalExecution = resolveTacticalExecutionValue(offenseTacticalExecutionOverride, {
      participants: [scorer],
      familiarityFactor: offenseFamiliarity,
      complexity,
      rigidityAxis: offenseTacticalProfile && offenseTacticalProfile.identity && offenseTacticalProfile.identity.rigidity,
      config,
      getAttribute,
    });
    const defenseTacticalExecution = resolveTacticalExecutionValue(defenseTacticalExecutionOverride, {
      participants: [defender],
      familiarityFactor: defenseFamiliarity,
      complexity,
      rigidityAxis: 50,
      config,
      getAttribute,
    });
    read6 = applyTacticalExecutionMisread(read6, offenseTacticalExecution, config);

    // Continuidad (7.12.11): una gran penetración que colapsa la defensa
    // (rotatingDefense/brokenDefense) genera una lectura de kick-out — solo
    // entonces existe un pasador real que acredite asistencia; una
    // ventaja pequeña/clara sin colapsar ayuda es "Isolation puro" (el
    // anotador crea y remata su propio tiro, sin asistencia, 7.12.5).
    // Decisión de encaje señalada explícitamente (7.12.34): 7.12.11 no
    // detalla este caso concreto para Isolation, es una interpretación
    // razonable de "Rotation forced" aplicada a esta familia.
    const helpCollapsed = read6 === 'rotatingDefense' || read6 === 'brokenDefense';
    let shooter = scorer;
    let shotDefender = defender;
    let assistCandidate = null;
    if (helpCollapsed) {
      const weakSide = pickWeakSideShooter(offenseFive, scorer, getAttribute);
      if (weakSide) {
        shooter = weakSide;
        shotDefender = pickLeastContestedDefender(defenseFive, getAttribute);
        assistCandidate = scorer;
      }
    }
    return {
      playType: 'isolation',
      playDefinitionId: 'isolationClearout',
      initialHandler: scorer,
      initialOnBallDefender: defender,
      shooter,
      shotDefender,
      shotDefenderPenalty: 0,
      forcedShotType: null,
      assistCandidate,
      shotAdjustment: 0,
      clockCost: 0,
      read6,
      read3: collapseRead6To3(read6),
      advantageScore,
      // TAC-6 (7.12.22): ver planPickAndRollTactical para el mismo criterio.
      coverage: null,
      offenseParticipantIds,
      defenseParticipantIds,
      tacticalExecution: { offense: offenseTacticalExecution, defense: defenseTacticalExecution },
      turnoverExecutionMultiplier: computeTurnoverExecutionMultiplier(offenseTacticalExecution, config),
    };
  }

  // --- 7.12.8/7.12.9 (TAC-3): Post Up con comportamiento real + doble
  // equipo simple (7.12.19 completo es TAC-4; aquí solo la forma más
  // simple permitida explícitamente por el prompt: probabilidad fija en
  // CONFIG si el postScorer es claramente superior a su defensor). ---
  function pickPostScorer(offenseFive, offenseTacticalProfile, getAttribute) {
    const assignments = (offenseTacticalProfile && offenseTacticalProfile.roleAssignments) || {};
    const designated = offenseFive.filter((p) => {
      const role = assignments[p.id] && assignments[p.id].offensiveRole;
      return role === 'postScorer' || role === 'postHub';
    });
    const pool = designated.length > 0 ? designated : offenseFive;
    return pickWeighted(pool, (p) => getAttribute(p, 'insideShot') + getAttribute(p, 'strength') + 1);
  }

  function pickPostDefender(defenseFive, getAttribute) {
    return pickWeighted(defenseFive, (p) => getAttribute(p, 'interiorDefense') + getAttribute(p, 'strength') + 1);
  }

  // --- 7.12.19 (TAC-4): ¿quién dobla? El ayudante MÁS CERCANO según su
  // rol defensivo (7.12.21) — prioriza a quien ya tiene declarado un rol
  // de ayuda (lowMan/nailHelper/roamer, los 3 roles de DEFENSIVE_ROLES
  // descritos como "ayuda" en 7.12.21), primera vez que roleAssignments
  // se consume REALMENTE en el motor (hasta ahora solo alimentaba
  // roleFit/UI, TAC-2). Sin ninguno declarado, cae al mismo criterio
  // heurístico que el resto de "quién ayuda" del módulo (anticipación +
  // posicionamiento + ética de trabajo).
  const POST_HELP_ROLES = ['lowMan', 'nailHelper', 'roamer'];
  function pickDoubleTeamHelper(defenseFive, postDefender, defenseTacticalProfile, getAttribute) {
    const candidates = defenseFive.filter((p) => p.id !== postDefender.id);
    const assignments = (defenseTacticalProfile && defenseTacticalProfile.roleAssignments) || {};
    const designated = candidates.filter((p) => POST_HELP_ROLES.indexOf(assignments[p.id] && assignments[p.id].defensiveRole) !== -1);
    const pool = designated.length > 0 ? designated : candidates;
    return pickWeighted(pool, (p) => getAttribute(p, 'anticipation') + getAttribute(p, 'positioning') + getAttribute(p, 'workRate') + 1);
  }

  // --- 7.12.19 (TAC-4): reglas de activación del doble equipo ---
  // 'starOnly' reproduce EXACTAMENTE el umbral/probabilidad de TAC-3 (no
  // cambia de cifra, ver MatchConfig.js) para no romper el rango de
  // regresión con el perfil por defecto. 'never'/'always' son las otras
  // dos reglas con comportamiento real esta entrega — 'onCatch'/
  // 'onFirstDribble'/zona objetivo (matices de timing de 7.12.19) quedan
  // fuera, señalado explícitamente (ver MatchConfig.js).
  function resolvePostDoubleTeamDecision(rule, scorerRating, defenderRating, config) {
    const cfg = config.tactics.postUp;
    if (rule === 'never') return false;
    if (rule === 'always') return true;
    return (scorerRating - defenderRating) >= cfg.doubleTeamRatingMargin && Math.random() < cfg.doubleTeamProbability;
  }

  // --- 7.12.19 (TAC-4): ¿el postScorer ENCUENTRA el hueco que deja el
  // doble equipo? TAC-3 acreditaba el kick-out el 100% de las veces —
  // esta entrega lo condiciona a su propia calidad de lectura/pase
  // (VisiónJuego+Pase, 7.12.19: "la Visión/Pase/Decisión del jugador
  // posteado... deciden si puede castigar esa superioridad").
  function resolvePostReadSuccess(postScorer, config, getAttribute) {
    const cfg = config.tactics.postUp;
    const readScore = averageMixWithAttribute([postScorer], cfg.readMix, getAttribute); // escala 1-20
    const probability = clamp(cfg.readBaseProbability + cfg.readSensitivity * ((readScore - 10) / 10), 0.05, 0.95);
    return Math.random() < probability;
  }

  function computePostUpAdvantageScore(params) {
    const {
      postScorer, postDefender, config, pressure, computeMixRating, scorerPenalty, defenderPenalty,
      offenseFive, offenseSpacing,
      // TAC-4 (7.12.14): ver nota de computeAdvantageScore arriba.
      defenseBaseScheme,
    } = params;
    const cfg = config.tactics.postUp;
    const scorerRating = computeMixRating(postScorer, cfg.scorerMix, config, pressure, undefined, scorerPenalty);
    const defenderRating = computeMixRating(postDefender, cfg.defenderMix, config, pressure, undefined, defenderPenalty);
    const noise = gaussianRandom() * cfg.noiseSigma;
    let raw = cfg.baseScore + cfg.sensitivity * (scorerRating - defenderRating) + noise;
    raw += computeSpacingAdvantageTerm(offenseFive, offenseSpacing, config);
    raw += computeZoneAdvantageTerm(offenseFive, offenseSpacing, defenseBaseScheme, 'postUp', config);
    return { advantageScore: clamp(raw, -1, 1), scorerRating, defenderRating };
  }

  function buildPostUpPlan(params) {
    const {
      offenseFive, defenseFive, offenseTacticalProfile, defenseTacticalProfile, config, pressure, computeMixRating,
      getAttribute, offenseRotationState, defenseRotationState, offenseSpacing,
      // TAC-6 (7.12.23): ver GamePlan.tacticalExecutionOverride.
      offenseTacticalExecutionOverride, defenseTacticalExecutionOverride,
    } = params;
    const postScorer = pickPostScorer(offenseFive, offenseTacticalProfile, getAttribute);
    const postDefender = pickPostDefender(defenseFive, getAttribute);
    const scorerPenalty = getPenalty(offenseRotationState, postScorer.id);
    const defenderPenalty = getPenalty(defenseRotationState, postDefender.id);
    const defenseBaseScheme = defenseTacticalProfile && defenseTacticalProfile.defensiveScheme && defenseTacticalProfile.defensiveScheme.baseScheme;

    const { advantageScore, scorerRating, defenderRating } = computePostUpAdvantageScore({
      postScorer, postDefender, config, pressure, computeMixRating, scorerPenalty, defenderPenalty, offenseFive, offenseSpacing, defenseBaseScheme,
    });

    // TAC-6 (7.12.22): tacticalExecution — se calcula ANTES de decidir el
    // doble equipo porque el `helper` (si lo hay) todavía no existe;
    // participantes defensivos iniciales = solo `postDefender` (mismo
    // criterio de estimación temprana que buildDefensivePlan usa con
    // `onBallDefender`).
    const postDefinition = getPlayDefinition('postEntry');
    const complexity = postDefinition ? postDefinition.complexity : 0;
    const offenseParticipantIds = [postScorer.id];
    const offenseFamiliarity = resolveRelevantFamiliarity(offenseTacticalProfile, 'offensive', 'postUp', null, offenseParticipantIds);
    const defenseFamiliarityPreHelp = resolveRelevantFamiliarity(defenseTacticalProfile, 'defensive', 'postUp', null, [postDefender.id]);
    const offenseTacticalExecution = resolveTacticalExecutionValue(offenseTacticalExecutionOverride, {
      participants: [postScorer],
      familiarityFactor: offenseFamiliarity,
      complexity,
      rigidityAxis: offenseTacticalProfile && offenseTacticalProfile.identity && offenseTacticalProfile.identity.rigidity,
      config,
      getAttribute,
    });
    const defenseTacticalExecutionPreHelp = resolveTacticalExecutionValue(defenseTacticalExecutionOverride, {
      participants: [postDefender],
      familiarityFactor: defenseFamiliarityPreHelp,
      complexity,
      rigidityAxis: 50,
      config,
      getAttribute,
    });

    const cfg = config.tactics.postUp;
    const rule = (defenseTacticalProfile && defenseTacticalProfile.defensiveScheme && defenseTacticalProfile.defensiveScheme.postDoubleTeamRule)
      || cfg.defaultDoubleTeamRule;
    const doubleTeamed = resolvePostDoubleTeamDecision(rule, scorerRating, defenderRating, config);

    let shooter = postScorer;
    let shotDefender = postDefender;
    let assistCandidate = null;
    let shotAdjustment = 0;
    let read6;
    const defenseParticipantIds = [postDefender.id];
    if (doubleTeamed) {
      // 7.12.19 (completo en esta entrega): el ayudante que dobla (ver
      // pickDoubleTeamHelper) es, por construcción, quien queda
      // recuperándose de la rotación — es él quien contesta el kick-out
      // si el postScorer encuentra el hueco (no un segundo sorteo
      // genérico independiente de "quién está menos atento").
      read6 = 'rotatingDefense';
      const properHelper = pickDoubleTeamHelper(defenseFive, postDefender, defenseTacticalProfile, getAttribute);
      // TAC-6 (7.12.22, "dos defensores ayudando al mismo jugador"): con
      // tacticalExecution defensivo bajo, el ayudante que de verdad llega
      // puede NO ser el que el rol de ayuda declarado señalaba (rotación
      // mal comunicada/tardía) — ver resolveDefensiveExecutionOverride.
      const helperCandidates = defenseFive.filter((p) => p.id !== postDefender.id);
      const helper = resolveDefensiveExecutionOverride(
        properHelper, helperCandidates, defenseTacticalExecutionPreHelp, config,
        (p) => 1 / (getAttribute(p, 'anticipation') + getAttribute(p, 'positioning') + getAttribute(p, 'workRate') + 1) + 0.01,
      );
      defenseParticipantIds.push(helper.id);
      const readSucceeds = resolvePostReadSuccess(postScorer, config, getAttribute);
      if (readSucceeds) {
        const weakSide = pickWeakSideShooter(offenseFive, postScorer, getAttribute);
        if (weakSide) {
          shooter = weakSide;
          shotDefender = helper;
          assistCandidate = postScorer;
        }
      } else {
        // No encontró el hueco: tiro forzado del propio postScorer con
        // dos defensores encima — penalización de calidad de tiro dentro
        // del canal ya existente (shotAdjustment), nunca un resolver de
        // pérdida nuevo (pedido explícito del prompt).
        shotAdjustment -= cfg.doubleTeamFailedReadPenalty;
      }
    } else {
      read6 = resolveRead6(advantageScore, config);
      // 7.12.22 ("lectura incorrecta"): solo tiene sentido degradar la
      // lectura NORMAL — con doble equipo, `read6` ya es una decisión
      // deliberada de la defensa (rotatingDefense fijo), no una lectura
      // que el ataque pueda "leer mal" por su cuenta.
      read6 = applyTacticalExecutionMisread(read6, offenseTacticalExecution, config);
    }

    return {
      playType: 'postUp',
      playDefinitionId: 'postEntry',
      initialHandler: postScorer,
      initialOnBallDefender: postDefender,
      shooter,
      shotDefender,
      shotDefenderPenalty: 0,
      forcedShotType: null,
      assistCandidate,
      shotAdjustment,
      clockCost: 0,
      read6,
      read3: collapseRead6To3(read6),
      advantageScore,
      // TAC-6 (7.12.22): ver planPickAndRollTactical para el mismo criterio.
      coverage: null,
      offenseParticipantIds,
      defenseParticipantIds,
      tacticalExecution: { offense: offenseTacticalExecution, defense: defenseTacticalExecutionPreHelp },
      turnoverExecutionMultiplier: computeTurnoverExecutionMultiplier(offenseTacticalExecution, config),
    };
  }

  // --- 7.12.11: continuidad, counters y Read & React — estado tras la
  // primera acción. Se llama UNA sola vez por posesión (nunca se re-invoca
  // sobre su propio resultado): límite duro de 2 acciones (7.12.11
  // explícito: "acotado por reloj y complejidad para evitar un simulador
  // infinito"). Precedencia cuando varias condiciones aplicarían a la vez:
  // Mismatch (switch) > Two on ball (blitz/hedge) > Rotation forced >
  // Advantage created — un Switch nunca dobla el balón literalmente
  // (mismatch, no ayuda de dos), así que tiene prioridad sobre la lectura
  // genérica de rotación.
  function resolveContinuityState(read6, coverage) {
    if (read6 === 'clearDefenseAdvantage') return 'Defense wins';
    if (read6 === 'stableDefense') return 'Neutral';
    if (coverage === 'switch' && read6 !== 'smallOffenseAdvantage') return 'Mismatch created';
    if ((coverage === 'blitz' || coverage === 'hedge') && (read6 === 'rotatingDefense' || read6 === 'brokenDefense')) return 'Two on ball';
    if (read6 === 'rotatingDefense') return 'Rotation forced';
    return 'Advantage created'; // smallOffenseAdvantage / clearOffenseAdvantage / brokenDefense sin cobertura especial
  }

  // --- Pick & Roll táctico con continuidad (TAC-3 amplía planPnrPossession
  // de TAC-1, sin reescribirlo — reutiliza buildPossessionPlan/
  // buildDefensivePlan/computeAdvantageScore como piezas). ---
  function planPickAndRollTactical(params) {
    const {
      offenseTacticalProfile, defenseTacticalProfile, offenseFive, defenseFive, onBallDefender,
      config, pressure, computeMixRating, getAttribute, usageWeight,
      offenseRotationState, defenseRotationState, offenseSpacing, shotClockRemaining, forcePlay,
      // TAC-6 (7.12.23): ver GamePlan.tacticalExecutionOverride — `undefined`
      // en llamadas legacy (7.12.34, compatibilidad).
      offenseTacticalExecutionOverride, defenseTacticalExecutionOverride,
    } = params;

    const possessionPlan = buildPossessionPlan(offenseTacticalProfile, offenseFive, config, usageWeight, getAttribute, forcePlay);
    if (!possessionPlan) return null;
    const { handler, screener } = possessionPlan;

    const defensivePlan = buildDefensivePlan(defenseTacticalProfile, defenseFive, onBallDefender, config, getAttribute, defenseTacticalExecutionOverride);
    const { coverage, screenerDefender } = defensivePlan;
    // TAC-4 (7.12.14): esquema defensivo base del equipo que defiende —
    // 'man-to-man'/ausente deja computeZoneAdvantageTerm en 0 (7.12.34).
    const defenseBaseScheme = defenseTacticalProfile && defenseTacticalProfile.defensiveScheme && defenseTacticalProfile.defensiveScheme.baseScheme;

    const advantageScore = computeAdvantageScore({
      handler, screener, onBallDefender, screenerDefender, coverage, config, pressure,
      computeMixRating, offenseRotationState, defenseRotationState, offenseFive, offenseSpacing, defenseBaseScheme,
    });
    let read6 = resolveRead6(advantageScore, config);
    const effectiveOnBallDefender = coverage === 'switch' ? screenerDefender : onBallDefender;
    const rollerDefender = (coverage === 'switch' || coverage === 'blitz' || coverage === 'hedge')
      ? onBallDefender : screenerDefender;

    const chosenPlay = choosePlayDefinition('pickAndRoll', offenseTacticalProfile, config);
    const playDefinitionId = chosenPlay ? chosenPlay.id : 'basicHighPnr';
    const complexity = chosenPlay ? chosenPlay.complexity : 0;

    // TAC-6 (7.12.22): tacticalExecution de ataque/defensa para ESTA
    // posesión (familiaridad relevante + atributos de ejecución colectiva
    // + energía/experiencia + complejidad de la jugada elegida — ver
    // computeTacticalExecution). `offenseParticipantIds`/
    // `defenseParticipantIds` son también los 4 protagonistas ya conocidos
    // de esta jugada (7.12.22, familiaridad individual del jugador con su
    // rol) — se exponen en el plan devuelto para que
    // updateFamiliarityAfterPossession (MatchEngine) sepa a quién hacer
    // crecer.
    const offenseParticipantIds = [handler.id, screener.id];
    const defenseParticipantIds = [effectiveOnBallDefender.id, rollerDefender.id];
    const offenseFamiliarity = resolveRelevantFamiliarity(offenseTacticalProfile, 'offensive', 'pickAndRoll', null, offenseParticipantIds);
    const defenseFamiliarity = resolveRelevantFamiliarity(defenseTacticalProfile, 'defensive', 'pickAndRoll', coverage, defenseParticipantIds);
    const offenseTacticalExecution = resolveTacticalExecutionValue(offenseTacticalExecutionOverride, {
      participants: [handler, screener],
      familiarityFactor: offenseFamiliarity,
      complexity,
      rigidityAxis: offenseTacticalProfile && offenseTacticalProfile.identity && offenseTacticalProfile.identity.rigidity,
      config,
      getAttribute,
    });
    const defenseTacticalExecution = resolveTacticalExecutionValue(defenseTacticalExecutionOverride, {
      participants: [effectiveOnBallDefender, rollerDefender],
      familiarityFactor: defenseFamiliarity,
      complexity,
      rigidityAxis: 50,
      config,
      getAttribute,
    });
    // 7.12.22 ("lectura incorrecta"): una ejecución ofensiva baja puede
    // degradar la lectura real un escalón — la ventaja que AdvantageState
    // SÍ generó se pierde por mala ejecución colectiva, nunca por una
    // resta plana de atributo (regla dura, no negociable).
    read6 = applyTacticalExecutionMisread(read6, offenseTacticalExecution, config);

    const continuityState = resolveContinuityState(read6, coverage);
    const continuityCfg = config.tactics.continuity;
    const canContinue = shotClockRemaining >= continuityCfg.minClockForSecondAction;

    let shooter = handler;
    let shotDefender = effectiveOnBallDefender;
    let shotDefenderPenalty = 0;
    let forcedShotType = null;
    let assistCandidate = null;
    let clockCost = 0;
    let shotAdjustment = 0;

    if (continuityState === 'Two on ball') {
      // 7.12.11: lectura de short-roll inmediata (Blitz/Hedge) — igual que
      // la rama 'clear' de TAC-1, el rodador termina la jugada.
      shooter = screener;
      shotDefender = rollerDefender;
      forcedShotType = pickRollFinishType(screener, getAttribute);
      assistCandidate = handler;
    } else if (continuityState === 'Advantage created') {
      if (read6 === 'clearOffenseAdvantage' || read6 === 'brokenDefense') {
        shooter = screener;
        shotDefender = rollerDefender;
        forcedShotType = pickRollFinishType(screener, getAttribute);
        assistCandidate = handler;
      } else {
        // smallOffenseAdvantage: el handler sigue con el tiro, marcado
        // como "en recuperación" (7.12.4) — igual que la rama 'small' de
        // TAC-1.
        shotDefenderPenalty = config.tactics.advantage.recoveringDefenderPenalty;
      }
    } else if (continuityState === 'Mismatch created' && canContinue) {
      // 7.12.11: "cambiar prioridad a Isolation/Post Up" — el handler
      // ataca directamente al defensor mismatcheado (ya es
      // effectiveOnBallDefender tras el cambio) con la mezcla de
      // Isolation: una segunda lectura real, no repetir la misma cobertura
      // de P&R. Isolation surgida de un mismatch: el propio handler crea
      // su tiro, sin pasador — no hay asistencia (7.12.5, mismo criterio
      // que Isolation puro).
      const mismatchPenalty = getPenalty(defenseRotationState, effectiveOnBallDefender.id);
      const handlerPenalty = getPenalty(offenseRotationState, handler.id);
      const secondScore = computeIsolationAdvantageScore({
        scorer: handler, defender: effectiveOnBallDefender, config, pressure, computeMixRating,
        scorerPenalty: handlerPenalty, defenderPenalty: mismatchPenalty, offenseFive, offenseSpacing, defenseBaseScheme,
      });
      const secondRead6 = resolveRead6(secondScore, config);
      if (secondRead6 === 'clearDefenseAdvantage' || secondRead6 === 'stableDefense') {
        shotAdjustment -= continuityCfg.forcedShotPenalty;
      }
      clockCost = continuityCfg.secondActionClockCost;
    } else if (continuityState === 'Rotation forced' && canContinue) {
      const weakSide = pickWeakSideShooter(offenseFive, handler, getAttribute);
      if (weakSide) {
        shooter = weakSide;
        shotDefender = pickLeastContestedDefender(defenseFive, getAttribute);
        assistCandidate = handler;
        clockCost = continuityCfg.extraPassClockCost;
      }
    } else if ((continuityState === 'Neutral' || continuityState === 'Defense wins') && canContinue) {
      // 7.12.11: "continuación prevista del playbook"/"reset, segunda
      // acción" — la posesión repite la MISMA lectura de P&R con un
      // segundo sorteo de AdvantageState (representa una acción
      // relacionada del playbook, no la jugada idéntica repetida —
      // 7.12.10 "no scripting"), acotado al límite duro de 2 acciones
      // (7.12.11).
      const secondScore = computeAdvantageScore({
        handler, screener, onBallDefender, screenerDefender, coverage, config, pressure,
        computeMixRating, offenseRotationState, defenseRotationState, offenseFive, offenseSpacing, defenseBaseScheme,
      });
      const secondRead6 = resolveRead6(secondScore, config);
      if (secondRead6 === 'clearOffenseAdvantage' || secondRead6 === 'brokenDefense' || secondRead6 === 'rotatingDefense') {
        shooter = screener;
        shotDefender = rollerDefender;
        forcedShotType = pickRollFinishType(screener, getAttribute);
        assistCandidate = handler;
      } else if (secondRead6 === 'smallOffenseAdvantage') {
        shotDefenderPenalty = config.tactics.advantage.recoveringDefenderPenalty;
      } else {
        shotAdjustment -= continuityCfg.forcedShotPenalty;
      }
      clockCost = continuityCfg.secondActionClockCost;
    } else {
      // Sin reloj para una segunda acción: tiro forzado con el contexto de
      // la primera acción tal cual (7.12.11, "tiro forzado según reloj").
      shotAdjustment -= continuityCfg.forcedShotPenalty;
    }

    return {
      playType: 'pickAndRoll',
      playDefinitionId,
      initialHandler: handler,
      initialOnBallDefender: effectiveOnBallDefender,
      shooter,
      shotDefender,
      shotDefenderPenalty,
      forcedShotType,
      assistCandidate,
      shotAdjustment,
      clockCost,
      read6,
      read3: collapseRead6To3(read6),
      continuityState,
      advantageScore,
      // TAC-6 (7.12.22): expuestos para updateFamiliarityAfterPossession
      // (MatchEngine) y para telemetría/debug de tacticalExecution, mismo
      // criterio que `advantageScore` (7.12.33: "un flag de debug/consola
      // basta").
      coverage,
      offenseParticipantIds,
      defenseParticipantIds,
      tacticalExecution: { offense: offenseTacticalExecution, defense: defenseTacticalExecution },
      // TAC-6 (7.12.22, "pérdida ofensiva de sistema"): multiplicador sobre
      // rollTurnover() YA EXISTENTE en MatchEngine.js — 1 con ejecución
      // perfecta, ver computeTurnoverExecutionMultiplier.
      turnoverExecutionMultiplier: computeTurnoverExecutionMultiplier(offenseTacticalExecution, config),
    };
  }

  // --- 7.12.12 (TAC-3): TransitionPriority sesga CUÁNTO intenta el equipo
  // explotar una ventana de contraataque YA elegible (7.6 acción 14, sin
  // tocar la ventana en sí) — pedido explícito del prompt, punto 2. Valor
  // neutro (config.tactics.transitionAttempt.weightNeutral, igual al
  // default de playTypeWeights.transition) reproduce EXACTAMENTE el
  // comportamiento de siempre (intenta el contraataque el 100% de las
  // veces que la ventana está disponible); un peso MENOR reduce esa
  // probabilidad (el equipo decide montar media pista en vez de correr);
  // un peso MAYOR no puede superar el 100% — pendiente de calibración/
  // decisión (7.12.34): un eje "más agresivo que nunca" no tiene margen
  // por encima de "siempre corre" con la ventana ya resuelta por 7.6. Sin
  // TacticalProfile o sin `playTypeWeights.transition`, siempre intenta
  // (7.12.34, compatibilidad — comportamiento idéntico al de antes).
  function resolveTransitionAttempt(offenseTacticalProfile, config) {
    const weights = offenseTacticalProfile && offenseTacticalProfile.playTypeWeights;
    if (!weights || weights.transition === undefined) return true;
    const neutral = config.tactics.transitionAttempt.weightNeutral;
    const probability = neutral > 0 ? clamp(weights.transition / neutral, 0, 1) : 1;
    return Math.random() < probability;
  }

  // --- 7.12.8 (TAC-3): selección real de play-type por posesión ---
  // `pnrEffectiveWeight` reutiliza resolvePnrFrequency (TAC-2, ya modulada
  // por identity.pickAndRollUsage) expresada como peso sobre el mismo
  // "presupuesto" de 100 que playTypeWeights (7.12.8: "no equivale
  // necesariamente a un reparto de 100 posesiones" — aquí se usa esa
  // cifra justamente como presupuesto de referencia porque con los
  // defaults, pnrFrequency=0.3 ⇒ peso 30, coincide EXACTAMENTE con
  // `playTypeWeights.pickAndRoll` por defecto (30), mismo valor
  // documentado dos veces desde TAC-2). El resto del presupuesto no
  // consumido por pickAndRoll/isolation/postUp queda como posesión NO
  // táctica (bucle 1v1 de siempre) — pendiente de calibración (7.12.34):
  // el presupuesto de 100 y el reparto exacto son un punto de partida, no
  // una cifra cerrada.
  function selectPlayType(offenseTacticalProfile, config) {
    if (!offenseTacticalProfile) return null;
    const weights = offenseTacticalProfile.playTypeWeights || {};
    const budget = config.tactics.playTypeSelection.budget;
    const pnrWeight = resolvePnrFrequency(offenseTacticalProfile, config) * 100;
    const isoWeight = Math.max(0, weights.isolation || 0);
    const postUpWeight = Math.max(0, weights.postUp || 0);
    const total = pnrWeight + isoWeight + postUpWeight;
    const noneWeight = Math.max(0, budget - total);
    const entries = [
      ['pickAndRoll', pnrWeight], ['isolation', isoWeight], ['postUp', postUpWeight], [null, noneWeight],
    ];
    const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
    if (totalWeight <= 0) return null;
    let roll = Math.random() * totalWeight;
    for (let i = 0; i < entries.length; i += 1) {
      if (roll < entries[i][1]) return entries[i][0];
      roll -= entries[i][1];
    }
    return null;
  }

  // --- Punto de entrada único NUEVO que llama MatchEngine.simulatePossession
  // (sustituye a planPnrPossession como enganche de PRODUCCIÓN —
  // planPnrPossession sigue exportado tal cual para tests dirigidos de
  // TAC-1/TAC-2). `null` si esta posesión NO tiene play-type real (sin
  // TacticalProfile ofensivo, o el sorteo cayó en "ninguno") — MatchEngine
  // se comporta EXACTAMENTE como si Tactics.js no existiera (7.12.34,
  // compatibilidad). Campos del plan devuelto (forma unificada para los 3
  // play-types con motor real): `initialHandler`/`initialOnBallDefender`
  // (turnover/falta, antes de conocer quién tira), `shooter`/`shotDefender`/
  // `shotDefenderPenalty`/`forcedShotType` (selección de tiro, sustituye a
  // ballHandler/onBallDefender en ese punto), `assistCandidate` (7.12.5,
  // null si no hay asistencia causal), `shotAdjustment`/`clockCost`
  // (7.12.11, ajustes de la cadena de continuidad).
  function planTacticalPossession(params) {
    const { offenseTacticalProfile, config } = params;
    const playType = selectPlayType(offenseTacticalProfile, config);
    if (!playType) return null;
    if (playType === 'pickAndRoll') return planPickAndRollTactical(params);
    if (playType === 'isolation') return buildIsolationPlan(params);
    if (playType === 'postUp') return buildPostUpPlan(params);
    return null;
  }

  // =========================================================================
  // TAC-5 (DESIGN.md 7.12.33): partido vivo y situaciones — motor de
  // simulación por tramos (ver MatchEngine.createMatchState/advanceMatch),
  // GamePlan (arriba), tiempos muertos (config.match.timeouts,
  // MatchConfig.js) y el sub-playbook de situaciones especiales de este
  // bloque. AMPLÍA TAC-1 a TAC-4, no los reescribe.
  // =========================================================================

  // --- 7.12.24: ¿en qué situación especial está esta posesión? ---
  // `situationContext` (construido por MatchEngine, que es quien conoce el
  // estado real del partido — reloj/período/marcador/tiempo muerto recién
  // pedido): { afterTimeout, quarterClockRemaining, period, quartersTotal,
  // scoreDiffAbs, inboundType }. Precedencia cuando varias condiciones se
  // cumplen a la vez (decisión de encaje de esta entrega, 7.12.34): ATO >
  // Last Possession > Late Clock > BLOB/SLOB — un tiempo muerto pedido
  // justo para el último tiro debe usar la jugada de ATO preparada, no la
  // genérica de Last Possession; Last Possession (más urgente, más
  // específica) pesa más que Late Clock genérico; BLOB/SLOB es la más
  // "de fondo" de las cinco (se cumple en casi cualquier saque de banda/
  // fondo sin más contexto). `null` si ninguna aplica — posesión normal.
  function resolveSituationType(situationContext, config) {
    if (!situationContext) return null;
    const {
      afterTimeout, quarterClockRemaining, period, quartersTotal, scoreDiffAbs, inboundType,
    } = situationContext;
    if (afterTimeout) return 'ATO';
    const situationalCfg = config.tactics.situational;
    const isFinalPeriod = period >= quartersTotal;
    if (isFinalPeriod
      && quarterClockRemaining <= config.pressure.buzzerBeaterSecondsThreshold
      && scoreDiffAbs <= situationalCfg.lastPossessionMarginPoints) {
      return 'lastPossession';
    }
    if (quarterClockRemaining <= config.lateClock.noFullPlayThresholdSeconds) return 'lateClock';
    if (inboundType === 'BLOB' || inboundType === 'SLOB') return inboundType;
    return null;
  }

  // Jugada concreta del catálogo situacional (7.12.24, "no scripting" tal
  // como el resto de 7.12.10): prioriza la preferencia declarada por el
  // equipo (`offenseTacticalProfile.situations.preferredPlays`, que ya
  // incluye la fusión con el GamePlan de este partido si lo hay — ver
  // effectiveTacticalProfile) si es compatible con `situationType`; si no
  // hay preferencia o no aplica, sortea entre las jugadas del catálogo para
  // esa situación, mismo criterio de peso que choosePlayDefinition (menor
  // complejidad pesa más, sin familiaridad todavía, TAC-6).
  function chooseSituationalPlayType(situationType, offenseTacticalProfile, config) {
    const candidates = PLAY_DEFINITIONS.filter((p) => p.situationType === situationType);
    if (candidates.length === 0) return null;
    const preferredId = offenseTacticalProfile && offenseTacticalProfile.situations
      && offenseTacticalProfile.situations.preferredPlays
      && offenseTacticalProfile.situations.preferredPlays[situationType];
    if (preferredId) {
      const preferred = candidates.find((p) => p.id === preferredId);
      if (preferred) return preferred;
    }
    return pickWeighted(candidates, (p) => Math.max(1, 100 - p.complexity));
  }

  // --- Punto de entrada único de situaciones especiales ---
  // Sustituye a planTacticalPossession() SOLO cuando resolveSituationType()
  // ya ha decidido que esta posesión es ATO/BLOB/SLOB/Late Clock/Last
  // Possession — reutiliza LITERALMENTE planPickAndRollTactical/
  // buildIsolationPlan/buildPostUpPlan (7.12.8/7.12.10, "no crear un
  // segundo selector de play-type paralelo", pedido explícito del prompt),
  // solo que la ELECCIÓN de cuál de los 3 usar viene del catálogo
  // situacional (`resolvesAs`) en vez del sorteo normal de
  // Tactics.selectPlayType, y con `forcePlay: true` para Pick & Roll (la
  // jugada se dibuja deliberadamente, no depende de que "toque" el sorteo
  // de frecuencia habitual — Isolation/Post Up no tienen ese sorteo previo,
  // ver buildIsolationPlan/buildPostUpPlan, así que no necesitan forzarse).
  // Sin jugada disponible para esa situación, o si el equipo no tiene
  // TacticalProfile (`planPickAndRollTactical`/build* devuelven null), cae
  // a planTacticalPossession(params) — comportamiento normal, nunca deja
  // la posesión sin resolver.
  function planSituationalPossession(params, situationType) {
    const definition = chooseSituationalPlayType(situationType, params.offenseTacticalProfile, params.config);
    if (!definition) return planTacticalPossession(params);
    let plan = null;
    if (definition.resolvesAs === 'pickAndRoll') plan = planPickAndRollTactical({ ...params, forcePlay: true });
    else if (definition.resolvesAs === 'isolation') plan = buildIsolationPlan(params);
    else if (definition.resolvesAs === 'postUp') plan = buildPostUpPlan(params);
    if (!plan) return planTacticalPossession(params);
    plan.playDefinitionId = definition.id;
    plan.situational = situationType;
    return plan;
  }

  // =========================================================================
  // TAC-6 (DESIGN.md 7.12.33): Familiaridad Táctica, `tacticalExecution` y
  // primera conexión real del eje Rigidez↔Read & React (7.12.7/7.12.22).
  // AMPLÍA TAC-1 a TAC-5, no los reescribe. 7.12.22 admite explícitamente
  // "no se cierra todavía la curva matemática" — todo lo de aquí es un
  // mecanismo de PARTIDA simple y explicable (rendimientos decrecientes,
  // cruces acotados), documentado como primera versión, no como cifra
  // cerrada (ver CHANGELOG/DESIGN.md de esta entrega para el detalle de
  // cada decisión).
  // =========================================================================

  // --- Crecimiento de familiaridad (7.12.22, "minutos reales ejecutando
  // el sistema" + "alta complejidad limita... la velocidad de subida") ---
  // Rendimientos decrecientes hacia 100 (nunca crece indefinido): a nivel 0
  // el incremento es máximo; cerca de 100 tiende a 0, así que el nivel se
  // ESTABILIZA cerca del techo sin necesitar un tope duro aparte. La
  // Complejidad (0-100, `PlayDefinition.complexity`) RALENTIZA el
  // incremento (nunca añade un techo distinto — eso ya lo cubre el
  // exponente de rendimientos decrecientes): con el mismo número de usos,
  // una jugada compleja tarda más en acercarse a 100 que una simple.
  function computeFamiliarityGrowth(currentLevel, complexity, config) {
    const cfg = config.tactics.familiarity;
    const diminishing = Math.pow(clamp(1 - currentLevel / 100, 0, 1), cfg.diminishingExponent);
    const complexityFactor = (complexity === undefined || complexity === null)
      ? 1
      : clamp(1 - (complexity / 100) * cfg.complexitySlowdown, cfg.minComplexityFactor, 1);
    return cfg.baseGrowthPerUse * diminishing * complexityFactor;
  }

  function growFamiliarityValue(currentLevel, complexity, config) {
    return clamp(currentLevel + computeFamiliarityGrowth(currentLevel, complexity, config), 0, 100);
  }

  // --- Familiaridad individual del jugador con su rol (7.12.9/7.12.21/
  // 7.12.22) --- Un jugador SIN rol asignado en `profile.roleAssignments`
  // no tiene familiaridad de rol que crecer para esa posesión (ni penaliza
  // ni premia, comportamiento neutro — mismo criterio que el resto del
  // motor cuando falta una asignación). `offensiveRoleId`/`defensiveRoleId`
  // en `null` (nunca asignado antes) arranca en `roleDefaultInitial`; un
  // rol DISTINTO al del último partido registrado arranca en
  // `roleChangeResetValue` (más bajo, "no hereda la familiaridad del rol
  // anterior" — invariante explícito de esta entrega). El mismo rol que ya
  // tenía sigue acumulando con `growFamiliarityValue` normal.
  function growPlayerRoleFamiliarity(profile, playerId, side, config) {
    const assignment = profile.roleAssignments && profile.roleAssignments[playerId];
    const roleId = assignment && (side === 'offensive' ? assignment.offensiveRole : assignment.defensiveRole);
    if (!roleId) return;
    const cfg = config.tactics.familiarity;
    const roleKey = side === 'offensive' ? 'offensiveRoleId' : 'defensiveRoleId';
    const levelKey = side === 'offensive' ? 'offensiveLevel' : 'defensiveLevel';
    const byPlayerRole = profile.familiarity.byPlayerRole;
    let entry = byPlayerRole[playerId];
    if (!entry) {
      entry = {
        offensiveRoleId: null, offensiveLevel: cfg.roleDefaultInitial,
        defensiveRoleId: null, defensiveLevel: cfg.roleDefaultInitial,
      };
      byPlayerRole[playerId] = entry;
    }
    if (entry[roleKey] !== roleId) {
      entry[levelKey] = entry[roleKey] === null ? cfg.roleDefaultInitial : cfg.roleChangeResetValue;
      entry[roleKey] = roleId;
    } else {
      entry[levelKey] = growFamiliarityValue(entry[levelKey], undefined, config);
    }
  }

  // Aplica el crecimiento de UNA posesión resuelta con play-type táctico
  // real a los perfiles PERSISTENTES de equipo (nunca a la vista EFECTIVA
  // de `effectiveTacticalProfile` — un GamePlan de partido no debe
  // "aprender" nada que sobreviva al partido; la familiaridad es identidad
  // real de equipo, mutando `Team.js.tacticalProfile` in situ igual que el
  // resto de esta pantalla). `tacticalUsage` (`null` si la posesión no fue
  // táctica: sin TacticalProfile o el sorteo cayó en "ninguno") — 7.12.22
  // solo cuenta "minutos reales EJECUTANDO EL SISTEMA", así que una
  // posesión no táctica no hace crecer nada. Nivel de granularidad elegido
  // para esta entrega (7.12.22, "se puede resolver... de forma más simple
  // al final de cada partido agregando el uso real"): POSESIÓN a posesión
  // dentro de `advanceMatch` (más fino que "al final del partido", sin
  // necesitar acumular un contador aparte por partido) — ver
  // MatchEngine.simulateOnePossessionStep, único punto que la llama.
  function updateFamiliarityAfterPossession(offenseProfile, defenseProfile, tacticalUsage, config) {
    if (!tacticalUsage) return;
    const definition = getPlayDefinition(tacticalUsage.playDefinitionId);
    const complexity = definition ? definition.complexity : undefined;
    const cfg = config.tactics.familiarity;

    if (offenseProfile && offenseProfile.familiarity) {
      const fam = offenseProfile.familiarity;
      const currentFamily = fam.byPlayFamily[tacticalUsage.playType] !== undefined
        ? fam.byPlayFamily[tacticalUsage.playType] : FAMILIARITY_DEFAULT;
      const familyGrowth = computeFamiliarityGrowth(currentFamily, complexity, config);
      fam.byPlayFamily[tacticalUsage.playType] = clamp(currentFamily + familyGrowth, 0, 100);
      fam.offensiveSystem = clamp(fam.offensiveSystem + familyGrowth * cfg.systemGrowthShare, 0, 100);
      (tacticalUsage.offenseParticipantIds || []).forEach((playerId) => {
        growPlayerRoleFamiliarity(offenseProfile, playerId, 'offensive', config);
      });
    }

    if (defenseProfile && defenseProfile.familiarity) {
      const fam = defenseProfile.familiarity;
      if (tacticalUsage.coverage) {
        // Pick & Roll: familiaridad por COBERTURA (7.12.16) — complejidad
        // nominal de la cobertura ejecutada (`coverageComplexity`, decisión
        // de encaje propia de esta entrega, 7.12.34: 7.12.16 no da una
        // cifra de complejidad por cobertura como sí hace `PlayDefinition`
        // para el playbook ofensivo).
        const currentCoverage = fam.byCoverage[tacticalUsage.coverage] !== undefined
          ? fam.byCoverage[tacticalUsage.coverage] : FAMILIARITY_DEFAULT;
        const coverageComplexity = cfg.coverageComplexity[tacticalUsage.coverage];
        const coverageGrowth = computeFamiliarityGrowth(currentCoverage, coverageComplexity, config);
        fam.byCoverage[tacticalUsage.coverage] = clamp(currentCoverage + coverageGrowth, 0, 100);
        fam.defensiveSystem = clamp(fam.defensiveSystem + coverageGrowth * cfg.systemGrowthShare, 0, 100);
      } else {
        // Isolation/Post Up (decisión de encaje, 7.12.34): sin cobertura de
        // P&R que aprender — no se inventa una "cobertura" ficticia para
        // estos dos play-types, solo alimentan el sistema defensivo global.
        const genericGrowth = computeFamiliarityGrowth(fam.defensiveSystem, complexity, config);
        fam.defensiveSystem = clamp(fam.defensiveSystem + genericGrowth * cfg.systemGrowthShare, 0, 100);
      }
      (tacticalUsage.defenseParticipantIds || []).forEach((playerId) => {
        growPlayerRoleFamiliarity(defenseProfile, playerId, 'defensive', config);
      });
    }
  }

  // --- Familiaridad relevante para ESTA jugada (0-1) — agrega sistema +
  // familia/cobertura + individual de rol de los participantes (7.12.22,
  // "cruza... la familiaridad relevante para la jugada en curso"). Media
  // simple de las 3 capas (pendiente de calibración/decisión, 7.12.34: no
  // hay ponderación cerrada entre capas en DESIGN.md) — un participante SIN
  // rol declarado no penaliza ni premia (usa `FAMILIARITY_ROLE_DEFAULT_INITIAL`
  // como neutro, ni el valor de partida completo ni cero). Sin
  // TacticalProfile/familiarity (objeto plano legacy, 7.12.34
  // compatibilidad): devuelve el neutro `FAMILIARITY_DEFAULT`.
  function resolveRelevantFamiliarity(profile, side, playType, coverage, participantIds) {
    if (!profile || !profile.familiarity) return FAMILIARITY_DEFAULT / 100;
    const fam = profile.familiarity;
    const systemLevel = side === 'offensive' ? fam.offensiveSystem : fam.defensiveSystem;
    let specificLevel;
    if (side === 'offensive') {
      specificLevel = fam.byPlayFamily[playType] !== undefined ? fam.byPlayFamily[playType] : FAMILIARITY_DEFAULT;
    } else {
      specificLevel = coverage
        ? (fam.byCoverage[coverage] !== undefined ? fam.byCoverage[coverage] : FAMILIARITY_DEFAULT)
        : fam.defensiveSystem;
    }
    const roleLevels = (participantIds || [])
      .map((id) => fam.byPlayerRole[id])
      .filter(Boolean)
      .map((entry) => (side === 'offensive' ? entry.offensiveLevel : entry.defensiveLevel))
      .filter((level) => level !== undefined && level !== null);
    const roleAverage = roleLevels.length > 0
      ? roleLevels.reduce((a, b) => a + b, 0) / roleLevels.length
      : FAMILIARITY_ROLE_DEFAULT_INITIAL;
    const average = (systemLevel + specificLevel + roleAverage) / 3;
    return clamp(average, 0, 100) / 100;
  }

  // --- `tacticalExecution` (7.12.22) — cruce de familiaridad, atributos de
  // ejecución colectiva (TrabajoEnEquipo/Concentración/Posicionamiento/
  // VisiónJuego+DecisiónBajoPresión), Energía/Experiencia y la Complejidad
  // requerida de la jugada en curso. Rango 0-1 (elección de esta entrega,
  // documentada en MatchConfig.js). Regla dura no negociable (7.12.22): el
  // resultado NUNCA se usa como resta plana a un atributo de la jugada —
  // solo modula qué RAMA/PROBABILIDAD de un mecanismo YA EXISTENTE se toma
  // (ver applyTacticalExecutionMisread/computeTurnoverExecutionMultiplier/
  // resolveDefensiveExecutionOverride más abajo).
  //
  // Eje Rigidez↔Read & React (7.12.7), primera conexión real tras dos
  // entregas aplazándolo (TAC-2/TAC-3): `rigidityAxis` (0-100, identity.
  // rigidity del equipo — 50 neutro si no se declara un eje real para
  // defensa, que no tiene esta identidad) interpola el TECHO y el
  // EXPONENTE de la curva familiaridad→ejecución. Rigidez alta (→100):
  // techo más alto pero exponente >1 (convexo: castiga con más dureza la
  // familiaridad baja, "sufre más los errores"). Read & React (→0): techo
  // algo más bajo pero exponente <1 (cóncavo: "levanta" el resultado con
  // familiaridad baja, "más tolerante", menos dependiente de un guion
  // fijo). rigidity=50 interpola a medio camino, sin caso especial.
  function computeTacticalExecution(params) {
    const {
      participants, familiarityFactor, complexity, rigidityAxis, config, getAttribute,
    } = params;
    const cfg = config.tactics.tacticalExecution;
    const rigidity = clamp(rigidityAxis === undefined || rigidityAxis === null ? 50 : rigidityAxis, 0, 100) / 100;
    const ceiling = cfg.readAndReactCeiling + rigidity * (cfg.rigidityCeiling - cfg.readAndReactCeiling);
    const exponent = cfg.readAndReactExponent + rigidity * (cfg.rigidityExponent - cfg.readAndReactExponent);
    const familiarityTerm = Math.pow(clamp(familiarityFactor, 0, 1), exponent) * ceiling;

    const attributeScore = averageMixWithAttribute(participants, cfg.attributeMix, getAttribute) / 20;
    const energyScore = participants.length > 0
      ? participants.reduce((sum, p) => sum + p.dynamicState.energy, 0) / (participants.length * 100)
      : 1;
    // Normaliza `player.experience` (contador sin techo fijo, escala
    // propia, no 1-20) reutilizando LITERALMENTE `pressure.
    // experienceBonusDivisor` (7.5) — misma idea de "veteranía
    // normalizada" que ya usa `computeMixRating`, no una segunda escala
    // inventada para esta entrega.
    const experienceScore = participants.length > 0
      ? clamp(participants.reduce((sum, p) => sum + p.experience, 0)
        / participants.length / config.pressure.experienceBonusDivisor, 0, 1)
      : 0;
    const complexityPenalty = ((complexity || 0) / 100) * cfg.complexityPenaltyWeight;

    const raw = familiarityTerm * cfg.familiarityWeight
      + attributeScore * cfg.attributeWeight
      + energyScore * cfg.energyWeight
      + experienceScore * cfg.experienceWeight
      - complexityPenalty;
    return clamp(raw, 0, 1);
  }

  // `GamePlan.tacticalExecutionOverride` (7.12.23, gancho que TAC-5 dejó
  // preparado SIN efecto real — ver Tactics.js de esa entrega): esta
  // entrega le da su primer uso. Un número 0-1 sustituye DIRECTAMENTE el
  // `tacticalExecution` calculado para el equipo dueño de ese GamePlan,
  // SOLO en este partido — pensado para casos manuales/futuros (ej. una
  // IA de scouting de TAC-7 que ya sabe que el rival prepara un plan
  // simplificado esta noche), sin editor propio en la pantalla de
  // Tácticas todavía (7.12.34). `null`/no finito: sin efecto, se calcula
  // con normalidad.
  function resolveTacticalExecutionValue(overrideValue, computeParams) {
    const num = Number(overrideValue);
    if (Number.isFinite(num)) return clamp(num, 0, 1);
    return computeTacticalExecution(computeParams);
  }

  // --- Errores reconocibles de 7.12.22 con punto de enganche real en el
  // motor existente (3 de los 10 listados, priorizados por tener una pieza
  // de motor real que modular sin crear un resolver nuevo — el resto queda
  // señalado explícitamente como pendiente en CHANGELOG/DESIGN.md) ---

  // "Lectura incorrecta" / "pérdida de continuidad": orden de read6 de
  // MEJOR a PEOR para el ataque (7.12.4) — degradar un escalón representa
  // que la ventaja que AdvantageState SÍ generó se pierde por mala
  // ejecución colectiva, nunca por falta de talento (el talento ya está
  // dentro de `advantageScore`). En el extremo peor (clearDefenseAdvantage)
  // no hay nada más que degradar.
  const READ6_BEST_TO_WORST = [
    'brokenDefense', 'rotatingDefense', 'clearOffenseAdvantage',
    'smallOffenseAdvantage', 'stableDefense', 'clearDefenseAdvantage',
  ];
  function degradeRead6(read6) {
    const idx = READ6_BEST_TO_WORST.indexOf(read6);
    if (idx === -1 || idx === READ6_BEST_TO_WORST.length - 1) return read6;
    return READ6_BEST_TO_WORST[idx + 1];
  }
  // Probabilidad inversa al tacticalExecution ofensivo: 0 con ejecución
  // perfecta (1), máxima (`misreadMaxProbability`) con ejecución nula (0).
  // Se aplica SOLO a la primera lectura de la posesión (7.12.34, decisión
  // de encaje: no se duplica sobre las lecturas de la segunda acción de
  // continuidad, para no acumular dos degradaciones en la misma posesión).
  function applyTacticalExecutionMisread(read6, tacticalExecution, config) {
    const probability = config.tactics.tacticalExecution.misreadMaxProbability * (1 - clamp(tacticalExecution, 0, 1));
    return Math.random() < probability ? degradeRead6(read6) : read6;
  }

  // "Pérdida ofensiva de sistema": multiplicador sobre `rollTurnover()` YA
  // EXISTENTE en MatchEngine.js (nunca un resolver nuevo, mismo patrón que
  // `computePressEffect`, 7.12.15) — 1 (sin efecto) con tacticalExecution=1,
  // hasta `turnoverMaxMultiplier` con tacticalExecution=0.
  function computeTurnoverExecutionMultiplier(tacticalExecution, config) {
    const cfg = config.tactics.tacticalExecution;
    return 1 + (cfg.turnoverMaxMultiplier - 1) * (1 - clamp(tacticalExecution, 0, 1));
  }

  // "Ayuda defensiva tarde" / "error de switch" / "dos defensores ayudando
  // al mismo jugador": con probabilidad inversa al tacticalExecution
  // defensivo, la selección de un defensor de cobertura/ayuda YA HECHA por
  // `buildDefensivePlan`/`pickDoubleTeamHelper` se sustituye por el
  // candidato MENOS preparado disponible (`inverseWeightFn`, mismo
  // criterio que `pickLeastContestedDefender` ya usa para el closeout
  // tardío) — representa una rotación mal comunicada/tardía, nunca un
  // resolver de falta/tiro nuevo.
  function resolveDefensiveExecutionOverride(properPick, candidates, tacticalExecution, config, inverseWeightFn) {
    const probability = config.tactics.tacticalExecution.defensiveMisexecutionMaxProbability * (1 - clamp(tacticalExecution, 0, 1));
    if (candidates.length === 0 || Math.random() >= probability) return properPick;
    return pickWeighted(candidates, inverseWeightFn);
  }

  // =========================================================================
  // TAC-7 (DESIGN.md 7.12.33): Data Hub táctico — agregación de telemetría
  // (7.12.27), derivadas de Ataque/Defensa/Lineups con tamaño de muestra, y
  // Construcción de identidad CPU (7.12.25, alcance acotado — ver
  // CHANGELOG de esta entrega). AMPLÍA TAC-1 a TAC-6, no los reescribe.
  // =========================================================================

  function shotZoneFromShotType(shotType) {
    if (shotType === 'threePointShot') return 'three';
    if (shotType === 'midRangeShot') return 'midRange';
    if (shotType === 'insideShot' || shotType === 'layup') return 'rim';
    return null;
  }

  function lineupKeyFromIds(ids) {
    if (!ids || ids.length === 0) return null;
    return ids.slice().sort().join('|');
  }

  // --- Punto de enganche de producción: MatchEngine.simulateOnePossessionStep
  // llama a esto justo después de updateFamiliarityAfterPossession, con el
  // registro que construye buildPossessionTelemetryRecord (MatchEngine.js).
  // Puramente aditivo (7.6, "lectura, no simulación"): nunca llama a
  // Math.random ni decide nada de la posesión — solo acumula sobre
  // `profile.tacticsTelemetry` (mismo patrón de mutación in situ que
  // updateFamiliarityAfterPossession sobre `profile.familiarity`).
  function updateTacticsTelemetryAfterPossession(offenseProfile, defenseProfile, record, config) {
    if (!record) return;
    const zone = shotZoneFromShotType(record.shotType);

    if (offenseProfile && offenseProfile.tacticsTelemetry) {
      const off = offenseProfile.tacticsTelemetry.offense;
      off.possessions += 1;
      off.points += record.points;
      const playTypeKey = record.playType || 'none';
      if (!off.byPlayType[playTypeKey]) off.byPlayType[playTypeKey] = buildEmptyCountPointsStats();
      off.byPlayType[playTypeKey].possessions += 1;
      off.byPlayType[playTypeKey].points += record.points;
      if (record.playDefinitionId) {
        if (!off.byPlayDefinition[record.playDefinitionId]) off.byPlayDefinition[record.playDefinitionId] = buildEmptyCountPointsStats();
        off.byPlayDefinition[record.playDefinitionId].possessions += 1;
        off.byPlayDefinition[record.playDefinitionId].points += record.points;
      }
      if (zone) {
        off.shotZones[zone].attempts += 1;
        if (record.outcome === 'made') off.shotZones[zone].made += 1;
      }
      if (record.outcome === 'made') {
        if (record.assistedById) off.assistedMade += 1; else off.unassistedMade += 1;
      }
      if (record.outcome === 'turnover') off.turnovers += 1;
      if (record.shotQuality !== null && record.shotQuality !== undefined) {
        off.shotQualitySum += record.shotQuality;
        off.shotQualityCount += 1;
      }
      const offenseLineupKey = lineupKeyFromIds(record.offenseFiveIds);
      if (offenseLineupKey) {
        const lineups = offenseProfile.tacticsTelemetry.lineups;
        if (!lineups[offenseLineupKey]) lineups[offenseLineupKey] = buildEmptyLineupTelemetryStats();
        lineups[offenseLineupKey].offensePossessions += 1;
        lineups[offenseLineupKey].offensePoints += record.points;
        if (record.effectiveSpacing !== null && record.effectiveSpacing !== undefined) {
          lineups[offenseLineupKey].spacingSum += record.effectiveSpacing;
          lineups[offenseLineupKey].spacingCount += 1;
        }
      }
    }

    if (defenseProfile && defenseProfile.tacticsTelemetry) {
      const def = defenseProfile.tacticsTelemetry.defense;
      def.possessions += 1;
      def.pointsAllowed += record.points;
      if (record.coverage) {
        if (!def.byCoverage[record.coverage]) def.byCoverage[record.coverage] = { possessions: 0, pointsAllowed: 0 };
        def.byCoverage[record.coverage].possessions += 1;
        def.byCoverage[record.coverage].pointsAllowed += record.points;
      }
      if (zone) {
        def.shotZonesAllowed[zone].attempts += 1;
        if (record.outcome === 'made') def.shotZonesAllowed[zone].made += 1;
      }
      const defenseLineupKey = lineupKeyFromIds(record.defenseFiveIds);
      if (defenseLineupKey) {
        const lineups = defenseProfile.tacticsTelemetry.lineups;
        if (!lineups[defenseLineupKey]) lineups[defenseLineupKey] = buildEmptyLineupTelemetryStats();
        lineups[defenseLineupKey].defensePossessions += 1;
        lineups[defenseLineupKey].defensePointsAllowed += record.points;
      }
    }
  }

  // --- Derivadas con tamaño de muestra (7.12.27, "regla dura... toda
  // métrica derivada debe poder mostrar su tamaño de muestra junto al
  // valor"). `n` es SIEMPRE el número de posesiones (o partidos, en el
  // caso de `games`) que sustentan el valor — nunca se devuelve una
  // derivada sin su `n` acompañante. ---
  function ppp(points, possessions) {
    return possessions > 0 ? points / possessions : null;
  }
  function pct(made, attempts) {
    return attempts > 0 ? made / attempts : null;
  }
  function isSmallSample(games, possessions, config) {
    const cfg = config.tactics.telemetry;
    return games < cfg.minReliableGames || possessions < cfg.minReliablePossessions;
  }

  // Informe completo de un TacticalProfile — consumido por la sub-pestaña
  // Rival (game.js) y, en principio, por cualquier pantalla futura que
  // necesite las mismas derivadas para el propio equipo. Estructura
  // deliberada en dos "capas" (7.12.27, gancho de Scouting futuro, ver
  // CHANGELOG de esta entrega): esta función siempre devuelve el dato
  // CALCULADO completo — cualquier ocultado/difuminado por una futura capa
  // de Scouting (6.2.2 punto 5, no implementada) debe vivir en la CAPA DE
  // PRESENTACIÓN (game.js), decidiendo qué de este objeto se muestra, sin
  // tener que rediseñar este shape.
  function summarizeTacticsTelemetry(profile, config) {
    const telemetry = profile && profile.tacticsTelemetry;
    if (!telemetry) return null;
    const { games } = telemetry;
    const off = telemetry.offense;
    const def = telemetry.defense;

    const byPlayType = {};
    TELEMETRY_PLAY_TYPES.forEach((key) => {
      const stats = off.byPlayType[key];
      byPlayType[key] = {
        possessions: stats.possessions,
        frequency: pct(stats.possessions, off.possessions),
        ppp: ppp(stats.points, stats.possessions),
        n: stats.possessions,
      };
    });

    const byPlayDefinition = {};
    Object.keys(off.byPlayDefinition).forEach((id) => {
      const stats = off.byPlayDefinition[id];
      byPlayDefinition[id] = { possessions: stats.possessions, ppp: ppp(stats.points, stats.possessions), n: stats.possessions };
    });

    const shotProfile = {};
    let shotAttemptsTotal = 0;
    SHOT_ZONES.forEach((zone) => { shotAttemptsTotal += off.shotZones[zone].attempts; });
    SHOT_ZONES.forEach((zone) => {
      const stats = off.shotZones[zone];
      shotProfile[zone] = {
        frequency: pct(stats.attempts, shotAttemptsTotal),
        fgPercent: pct(stats.made, stats.attempts),
        n: stats.attempts,
      };
    });

    const shotProfileAllowed = {};
    let shotAttemptsAllowedTotal = 0;
    SHOT_ZONES.forEach((zone) => { shotAttemptsAllowedTotal += def.shotZonesAllowed[zone].attempts; });
    SHOT_ZONES.forEach((zone) => {
      const stats = def.shotZonesAllowed[zone];
      shotProfileAllowed[zone] = {
        frequency: pct(stats.attempts, shotAttemptsAllowedTotal),
        fgPercentAllowed: pct(stats.made, stats.attempts),
        n: stats.attempts,
      };
    });

    const byCoverage = {};
    PNR_COVERAGES.forEach((coverage) => {
      const stats = def.byCoverage[coverage];
      byCoverage[coverage] = {
        possessions: stats.possessions,
        frequency: pct(stats.possessions, def.possessions),
        pppAllowed: ppp(stats.pointsAllowed, stats.possessions),
        n: stats.possessions,
      };
    });

    const lineups = Object.keys(telemetry.lineups).map((key) => {
      const l = telemetry.lineups[key];
      return {
        lineupKey: key,
        offensePossessions: l.offensePossessions,
        defensePossessions: l.defensePossessions,
        offensiveRating: l.offensePossessions > 0 ? (l.offensePoints / l.offensePossessions) * 100 : null,
        defensiveRating: l.defensePossessions > 0 ? (l.defensePointsAllowed / l.defensePossessions) * 100 : null,
        netRating: (l.offensePossessions > 0 && l.defensePossessions > 0)
          ? ((l.offensePoints / l.offensePossessions) - (l.defensePointsAllowed / l.defensePossessions)) * 100
          : null,
        averageEffectiveSpacing: l.spacingCount > 0 ? l.spacingSum / l.spacingCount : null,
        n: Math.min(l.offensePossessions, l.defensePossessions === 0 ? l.offensePossessions : l.defensePossessions),
      };
    }).sort((a, b) => (b.offensePossessions + b.defensePossessions) - (a.offensePossessions + a.defensePossessions));

    return {
      games,
      smallSample: isSmallSample(games, off.possessions, config),
      offense: {
        possessions: off.possessions,
        pointsPerPossession: ppp(off.points, off.possessions),
        byPlayType,
        byPlayDefinition,
        shotProfile,
        assistedFgPercent: pct(off.assistedMade, off.assistedMade + off.unassistedMade),
        turnoverRate: pct(off.turnovers, off.possessions),
        averageShotQuality: off.shotQualityCount > 0 ? off.shotQualitySum / off.shotQualityCount : null,
        shotQualityN: off.shotQualityCount,
        n: off.possessions,
      },
      defense: {
        possessions: def.possessions,
        pointsPerPossessionAllowed: ppp(def.pointsAllowed, def.possessions),
        byCoverage,
        shotProfileAllowed,
        // "eficiencia de mismatch concedida" (7.12.27): aproximación
        // explícita de esta entrega — PPP concedido específicamente en
        // posesiones resueltas con cobertura Switch (el mismatch real que
        // el motor modela hoy, 7.12.31 invariante 3), no un cálculo
        // separado nuevo. Señalado explícitamente: 7.12.27 no da una
        // fórmula cerrada de "mismatch efficiency", esta es la lectura más
        // directa posible con los datos ya agregados arriba.
        mismatchEfficiencyAllowed: { pppAllowed: byCoverage.switch.pppAllowed, n: byCoverage.switch.n },
        n: def.possessions,
      },
      lineups,
    };
  }

  // --- Construcción de identidad CPU (7.12.25, alcance acotado a esta
  // entrega — ver CHANGELOG). Se llama UNA VEZ por equipo CPU al empezar
  // partida/pretemporada (game.js, startSeason()), NUNCA cada partido — el
  // `tacticalProfile` que devuelve sustituye por completo al default
  // universal que construye `new TacticalProfile()`. Evalúa la PLANTILLA
  // REAL (`team.roster` completo, no solo 5 titulares: 7.12.25 dice
  // "evalúa... distribución de roles disponibles", no "el quinteto en
  // pista") usando `roleFit`/`bestRolesForPlayer` YA EXISTENTES — nunca
  // inventa un segundo cálculo de encaje (mismo dato que la pantalla de
  // Roles del usuario mostraría para esta plantilla). NO toca el
  // TacticalProfile del equipo del usuario (game.js decide a quién llamar
  // esto, este módulo no sabe qué equipo es "del usuario").
  function bestRoleFitInRoster(roster, roleId, config) {
    return roster.reduce((best, player) => Math.max(best, roleFit(player, roleId, config).score), 0);
  }

  // Jugador CONCRETO con mejor `roleFit` de un rol, no solo su puntuación —
  // necesario para comprobar un atributo distinto (movilidad física) del
  // MISMO jugador que encaja mejor en el rol, en vez de mezclar el mejor
  // encaje de un jugador con la movilidad de otro (7.12.25, ejemplo
  // literal "pívot protector lento": el protector Y su propia movilidad,
  // no dos jugadores distintos).
  function findBestPlayerForRole(roster, roleId, config) {
    let bestPlayer = roster[0];
    let bestScore = -Infinity;
    roster.forEach((player) => {
      const score = roleFit(player, roleId, config).score;
      if (score > bestScore) { bestScore = score; bestPlayer = player; }
    });
    return { player: bestPlayer, score: bestScore };
  }

  // Sesgo de `clubDNA` (6.2.8) — texto exacto contra el catálogo de
  // `config.tactics.cpuIdentity.dnaBias` (mismo criterio de mapeo por
  // texto exacto que `config.tempo.dnaBias`, TAC-1): un ADN no listado no
  // aplica ningún sesgo. "Sesgo, no orden obligatoria" (7.12.25, cita
  // literal): se suma/resta sobre la dirección que YA decidió la
  // evaluación de plantilla más abajo, nunca la sustituye.
  function resolveClubDnaBias(clubDNA, config) {
    return (config.tactics.cpuIdentity.dnaBias && config.tactics.cpuIdentity.dnaBias[clubDNA]) || { pace: 0, pickAndRollUsage: 0, pressActive: 0 };
  }

  function buildCpuTacticalIdentity(team, config) {
    const roster = team.roster;
    if (!roster || roster.length === 0) return new TacticalProfile();
    const cfg = config.tactics.cpuIdentity;
    const dnaBias = resolveClubDnaBias(team.clubDNA, config);
    const specialist = cfg.specialistThreshold;

    // --- Señales de plantilla (7.12.25, lista literal del punto 4) ---
    // Cada señal de "PRESENCIA de especialista" usa `roleFit` (mezcla de
    // atributos + competencia posicional, ya existente) contra un umbral
    // fijo — un jugador cualquiera en su posición "natural" con atributos
    // neutros ya puntúa por debajo de `specialistThreshold` gracias al
    // peso combinado (verificado con el script de esta entrega), así que
    // el umbral distingue un especialista real de "alguien que ocupa esa
    // posición sin más".
    // Creador real: mejor base/escolta como manejador de P&R.
    const creatorScore = Math.max(bestRoleFitInRoster(roster, 'primaryCreator', config), bestRoleFitInRoster(roster, 'pnrHandler', config));
    // Interiores con encaje de Roll/Pop (7.12.25: "pívot móvil").
    const mobileBigScore = Math.max(bestRoleFitInRoster(roster, 'rollMan', config), bestRoleFitInRoster(roster, 'pickAndPopBig', config));
    // Interior tradicional dominante (Post).
    const traditionalBigScore = bestRoleFitInRoster(roster, 'postScorer', config);
    // Tiro/spacers: mejor spot-up/movement shooter (amenaza real de tiro).
    const shooterScore = Math.max(bestRoleFitInRoster(roster, 'spotUpShooter', config), bestRoleFitInRoster(roster, 'movementShooter', config));
    // Movilidad/switchability perimetral (wings) — defensa.
    const perimeterMobilityScore = Math.max(bestRoleFitInRoster(roster, 'switchDefender', config), bestRoleFitInRoster(roster, 'perimeterDisruptor', config));
    // Protector de aro LENTO (7.12.25, ejemplo literal "pívot protector
    // lento"): el jugador con mejor encaje de `rimProtector` es un
    // especialista real (roleFit) Y, ESE MISMO jugador, tiene movilidad
    // física baja (Agilidad+Aceleración medias, escala 1-20 pura — sin
    // blend de posición, a diferencia de roleFit, para no repetir el
    // mismo suelo que ya distorsiona `weakThreshold` contra roleFit).
    const rimProtectorBest = findBestPlayerForRole(roster, 'rimProtector', config);
    const rimProtectorMobility = (getPlayerAttribute(rimProtectorBest.player, 'agility') + getPlayerAttribute(rimProtectorBest.player, 'acceleration')) / 2;
    const isSlowRimProtector = rimProtectorBest.score >= specialist && rimProtectorMobility < cfg.weakThreshold;
    // Energía/edad de rotación: media de Energía actual y edad de TODA la
    // plantilla (7.12.25, "Energía/edad de rotación" — señal de fondo de
    // banco, no solo del quinteto titular).
    const averageEnergy = roster.reduce((sum, p) => sum + p.dynamicState.energy, 0) / roster.length;
    const averageAge = roster.reduce((sum, p) => sum + p.age, 0) / roster.length;
    const isYoungAthleticRoster = averageAge < 27 && averageEnergy >= 55;

    // --- Dirección (7.12.25, los 4 ejemplos literales como guía) ---
    // 1. Base creador + interiores móviles + tiradores -> más P&R/spacing abierto.
    const hasCreatorPnrShooters = creatorScore >= specialist && mobileBigScore >= specialist && shooterScore >= specialist;
    // 2. Interior dominante + poco tiro -> más Post/spacing cerrado. "Poco
    // tiro" se lee como AUSENCIA de un especialista de tiro real (no un
    // roleFit forzado a un mínimo inalcanzable por el suelo posicional),
    // mismo umbral `specialist` que el resto de señales de presencia.
    const hasDominantBigWeakShooting = traditionalBigScore >= specialist && shooterScore < specialist;
    // 3. Muchos wings móviles -> más switch/press/transition.
    const hasMobileWings = perimeterMobilityScore >= specialist;

    let spacing = DEFAULT_SPACING;
    if (hasDominantBigWeakShooting) spacing = '3-out-2-in';
    else if (hasCreatorPnrShooters) spacing = mobileBigScore >= specialist + 3 ? '5-out' : '4-out-1-in';

    const playTypeWeights = { ...DEFAULT_PLAY_TYPE_WEIGHTS };
    if (hasCreatorPnrShooters) playTypeWeights.pickAndRoll += 15;
    if (hasDominantBigWeakShooting) { playTypeWeights.postUp += 15; playTypeWeights.pickAndRoll -= 5; }
    if (creatorScore < specialist) playTypeWeights.isolation += 5;
    if (hasMobileWings) playTypeWeights.transition += 10;

    const identity = { ...DEFAULT_IDENTITY };
    identity.pickAndRollUsage = clamp(
      DEFAULT_IDENTITY.pickAndRollUsage + (hasCreatorPnrShooters ? 15 : 0) + (hasDominantBigWeakShooting ? -10 : 0) + dnaBias.pickAndRollUsage,
      0, 100,
    );
    identity.pace = clamp(DEFAULT_IDENTITY.pace + (hasMobileWings || isYoungAthleticRoster ? 10 : 0) + dnaBias.pace, 0, 100);

    // 4. Pívot protector lento -> más Drop que Switch Everything; wings
    // móviles -> más Switch/press. Un pívot protector lento pesa MÁS que
    // wings móviles para esta decisión concreta (7.12.31 invariante 3/4:
    // un Switch con un pívot lento real detrás sería una combinación
    // rota, no una decisión táctica válida — regresión explícita del
    // prompt de esta entrega).
    let pnrCoverage = 'drop'; // por defecto (7.12.16, cobertura real más habitual — mismo criterio que defaultCoverage)
    if (isSlowRimProtector) pnrCoverage = 'drop';
    else if (hasMobileWings) pnrCoverage = 'switch';

    const pressActiveProbability = clamp((hasMobileWings ? 0.5 : 0.15) + dnaBias.pressActive, 0, 1);
    const pressActive = Math.random() < pressActiveProbability;

    return new TacticalProfile({
      spacing,
      pnrCoverage,
      identity,
      playTypeWeights,
      defensiveScheme: { baseScheme: 'man-to-man', press: { active: pressActive, type: 'halfCourt' } },
    });
  }

  const exportsObj = {
    TacticalProfile,
    PNR_COVERAGES,
    SPACING_OPTIONS,
    OFFENSIVE_ROLES,
    DEFENSIVE_ROLES,
    planPnrPossession,
    effectiveSpacing,
    roleFit,
    bestRolesForPlayer,
    computeLineupRatings,
    starsFromScore20,
    // Expuestas para tests dedicados (verificación de invariantes 7.12.31
    // sin tener que simular partidos completos para cada pieza).
    buildPossessionPlan,
    buildDefensivePlan,
    computeAdvantageScore,
    resolveRead,
    pickRollFinishType,
    resolvePnrFrequency,
    // TAC-3 (7.12.33): playbook, selección real de play-type, 6 categorías
    // de AdvantageState + continuidad, y el nuevo punto de enganche de
    // producción para MatchEngine.simulatePossession.
    PLAY_DEFINITIONS,
    REAL_PLAY_FAMILIES,
    getPlayDefinition,
    choosePlayDefinition,
    resolveRead6,
    collapseRead6To3,
    computeSpacingAdvantageTerm,
    computeIsolationAdvantageScore,
    buildIsolationPlan,
    computePostUpAdvantageScore,
    buildPostUpPlan,
    resolveContinuityState,
    selectPlayType,
    resolveTransitionAttempt,
    planTacticalPossession,
    // TAC-4 (7.12.33): defensa avanzada — catálogos de esquema/press/regla
    // de doble equipo, matchups individuales, efecto de zona/press/
    // transición defensiva sobre AdvantageState/shotAdjustment.
    BASE_SCHEMES,
    PRESS_TYPES,
    POST_DOUBLE_TEAM_RULES,
    resolveMatchupOverride,
    computeZoneAdvantageTerm,
    computePressEffect,
    computeTransitionDefenseAdjustment,
    pickDoubleTeamHelper,
    resolvePostDoubleTeamDecision,
    resolvePostReadSuccess,
    // TAC-5 (7.12.33): partido vivo y situaciones — GamePlan (overrides de
    // partido), catálogo de situaciones especiales y su punto de enganche
    // de producción.
    SITUATION_TYPES,
    GamePlan,
    effectiveTacticalProfile,
    applyGamePlanToProfile,
    resolveSituationType,
    chooseSituationalPlayType,
    planSituationalPossession,
    // TAC-6 (7.12.33): Familiaridad Táctica, `tacticalExecution` y primera
    // conexión real del eje Rigidez↔Read & React (7.12.22/7.12.7).
    PLAY_FAMILIES,
    FAMILIARITY_DEFAULT,
    FAMILIARITY_ROLE_DEFAULT_INITIAL,
    computeFamiliarityGrowth,
    growFamiliarityValue,
    updateFamiliarityAfterPossession,
    resolveRelevantFamiliarity,
    computeTacticalExecution,
    resolveTacticalExecutionValue,
    applyTacticalExecutionMisread,
    computeTurnoverExecutionMultiplier,
    resolveDefensiveExecutionOverride,
    degradeRead6,
    // TAC-7 (7.12.33): Data Hub táctico — telemetría agregada, derivadas
    // con tamaño de muestra e informe de rival, y Construcción de
    // identidad CPU (7.12.25, alcance acotado).
    SHOT_ZONES,
    TELEMETRY_PLAY_TYPES,
    updateTacticsTelemetryAfterPossession,
    summarizeTacticsTelemetry,
    buildCpuTacticalIdentity,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
