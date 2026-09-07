// src/entities/Team.js
// Entidad Equipo (ficha completa) — ver DESIGN.md sección 6.2.
// Convención del proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  // Generador de jugadores, para la Cantera/Academia (ver 6.2.3 más abajo).
  const PlayerGenerator = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/playerGenerator.js')
    : global.BasketManager;

  // DESIGN.md 7.12 (Sistema táctico, TAC-2): `TacticalProfile` pasa a
  // persistir en `Team.js` (ver `this.tacticalProfile` más abajo) — hueco
  // que TAC-1 dejó señalado explícitamente en su CHANGELOG ("persistirlo en
  // el equipo... queda para una sesión de UI/estado futura"). No se
  // DESTRUCTURA `TacticalProfile` aquí arriba (`const { TacticalProfile } =
  // TacticsCore` fallaría en el navegador si Team.js carga antes que
  // Tactics.js, como ocurre hoy en index.html): `TacticsCore` guarda la
  // referencia al objeto compartido `global.BasketManager` (el mismo patrón
  // que ya usa `PlayerGenerator` arriba) y se accede a `.TacticalProfile`
  // perezosamente DENTRO del constructor, cuando ya han cargado todos los
  // scripts.
  const TacticsCore = (typeof module !== 'undefined' && module.exports)
    ? require('../core/Tactics.js')
    : global.BasketManager;

  // CLUB-CORE-1 (DESIGN.md sección 10) — `Club.js` es la fuente ÚNICA de
  // los constructores de estado institucional (instalaciones/junta/afición/
  // finanzas/ADN de club). Se accede perezosamente DENTRO del constructor
  // (mismo criterio que `TacticsCore` arriba: `Club.js` carga DESPUÉS de
  // `Team.js` en `index.html`, así que destructurar aquí arriba fallaría en
  // el navegador) — solo para construir el estado de "bootstrap" de un Team
  // todavía sin `Club` enlazado (modo prueba / tests legacy, ver más abajo).
  const ClubEntityModule = (typeof module !== 'undefined' && module.exports)
    ? require('./Club.js')
    : global.BasketManager;

  function ClubCore() { return ClubEntityModule; }

  const DIVISIONS = ['1ª', '2ª'];

  // NATIONAL-TEAMS-1 (DESIGN.md 10.17) — vocabulario CERRADO de qué clase de
  // entidad deportiva es este `Team`. `club-team` es el fallback SOLO del
  // constructor aislado usado por fixtures/tests legacy (sección 3.1 del
  // prompt: "para evitar reescribir decenas de tests irrelevantes") — todo
  // equipo registrado por un paquete de contenido nuevo declara su
  // `teamKind` explícito.
  const TEAM_KINDS = ['club-team', 'national-team'];

  function validateTeamKind(kind) {
    if (!TEAM_KINDS.includes(kind)) {
      throw new Error(`Team: teamKind "${kind}" no válido — debe ser una de ${TEAM_KINDS.join(', ')}.`);
    }
    return kind;
  }

  // CLUB-CORE-1 (DESIGN.md sección 10, "no combines género, edad y rol en
  // un único string imposible de extender"): rol/categoría estructurados,
  // con `teamType` conservado como ALIAS legacy derivado (nunca fuente de
  // verdad nueva — nada en el motor lo lee, solo se serializa por
  // compatibilidad, ver auditoría en CLAUDE.md).
  const TEAM_ROLES = ['first-team', 'reserve', 'youth', 'other'];
  const TEAM_GENDERS = ['men', 'women', 'mixed'];
  const TEAM_AGE_TIERS = ['senior', 'youth'];
  const ROLE_TEAM_TYPE_SUFFIX = {
    'first-team': 'first-team',
    reserve: 'reserve-team',
    youth: 'youth-team',
    other: 'other-team',
  };

  function validateTeamRole(role) {
    if (!TEAM_ROLES.includes(role)) {
      throw new Error(`Team: role "${role}" no válido — debe ser uno de ${TEAM_ROLES.join(', ')}.`);
    }
    return role;
  }

  function buildTeamCategory(data = {}) {
    const gender = data.gender || 'men';
    const ageTier = data.ageTier || 'senior';
    if (!TEAM_GENDERS.includes(gender)) {
      throw new Error(`Team: category.gender "${gender}" no válido — debe ser uno de ${TEAM_GENDERS.join(', ')}.`);
    }
    if (!TEAM_AGE_TIERS.includes(ageTier)) {
      throw new Error(`Team: category.ageTier "${ageTier}" no válido — debe ser uno de ${TEAM_AGE_TIERS.join(', ')}.`);
    }
    return { gender, ageTier };
  }

  // `teamType` legacy — compuesto a partir de rol+categoría cuando no llega
  // explícito. El default (role 'first-team' + category senior/men) produce
  // EXACTAMENTE el mismo string que antes de esta entrega
  // ('senior-men-first-team'), así que ningún dato existente cambia de
  // forma.
  function composeLegacyTeamType(role, category) {
    return `${category.ageTier}-${category.gender}-${ROLE_TEAM_TYPE_SUFFIX[role] || role}`;
  }

  // ROSTER-1 (DESIGN.md 9.16) + REG-1 (DESIGN.md 9.18, BUG-CONTRACT1-03):
  // estos dos valores NUNCA son la regla universal de convocatoria — cada
  // competición tiene su propio rango, resuelto por
  // `CompetitionRules.resolveRules()` (ver game.js/CpuLineup.js) y pasado
  // EXPLÍCITAMENTE a `buildMatchSquad()`. Desde REG-1, `buildMatchSquad()`
  // ya NO los usa como fallback silencioso — un llamador de producción sin
  // política explícita falla (ver más abajo). Se conservan exportados como
  // `TEST_MATCH_SQUAD_POLICY`, un fixture NOMBRADO de solo prueba/estrés
  // del motor (usado por `MatchEngine.defaultMatchSquad()` y por
  // `buildMatchSquadExcludingPosition()`), nunca una ley universal.
  const MATCH_SQUAD_MIN = 8;
  const MATCH_SQUAD_MAX = 12;
  const TEST_MATCH_SQUAD_POLICY = Object.freeze({ min: MATCH_SQUAD_MIN, max: MATCH_SQUAD_MAX });

  // Niveles de leyenda de club — DESIGN.md 6.2.10. (Histórico deportivo:
  // sigue viviendo en `Team`, ver DESIGN.md 5.2 — "rivalidades e histórico
  // deportivo ya existentes".)
  const LEGEND_STATUSES = ['Predilecto', 'Ídolo', 'Leyenda'];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'team-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  // --- LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2, secciones 4/5 del
  // prompt de esta sesión): plan de entrenamiento persistente + estado
  // interno de procesado. Team.js solo guarda datos/fallback de legacy —
  // esquema/validación/normalización "de verdad" viven en Training.js
  // (mismo criterio que developmentState de Player.js vive en
  // PlayerDevelopment.js). Cualquier equipo legacy/nuevo sin
  // `data.trainingPlan` recibe Balanced/Normal/sin focos, sin reescribir
  // ningún JSON real.
  function buildTrainingPlan(data = {}) {
    return {
      teamFocus: data.teamFocus || 'balanced',
      intensity: data.intensity || 'normal',
      individualFocuses: { ...(data.individualFocuses || {}) },
    };
  }

  function buildTrainingState(data = {}) {
    return {
      lastProcessedDate: data.lastProcessedDate ? new Date(data.lastProcessedDate) : null,
      // Historial de cambios de plan aún no completamente consumidos por
      // Training/PlayerDevelopment (sección 6: "cambiar plan nunca
      // modifica el pasado") — cada entrada es el plan vigente desde
      // `effectiveFrom`. Training.js poda los segmentos ya consumidos.
      planSegments: Array.isArray(data.planSegments)
        ? data.planSegments.map((segment) => ({
          teamFocus: segment.teamFocus,
          intensity: segment.intensity,
          individualFocuses: { ...(segment.individualFocuses || {}) },
          effectiveFrom: segment.effectiveFrom ? new Date(segment.effectiveFrom) : null,
        }))
        : [],
      // Sección 5: una fecha por cada partido REAL jugado por el equipo
      // (cualquier competición), para calcular densidad competitiva.
      recentTeamMatchDates: Array.isArray(data.recentTeamMatchDates)
        ? data.recentTeamMatchDates.map((d) => new Date(d))
        : [],
      // Sección 26: revisión periódica de TrainingAI — colectiva cada 28
      // días, focos individuales cada 56 (nombres separados para conservar
      // la semántica de las dos cadencias distintas del prompt, "puedes
      // adaptar nombres menores").
      nextCpuCollectiveReviewDate: data.nextCpuCollectiveReviewDate ? new Date(data.nextCpuCollectiveReviewDate) : null,
      nextCpuIndividualReviewDate: data.nextCpuIndividualReviewDate ? new Date(data.nextCpuIndividualReviewDate) : null,
    };
  }

  // Estado institucional de "bootstrap" (DESIGN.md sección 10, apartado 10 del
  // prompt de CLUB-CORE-1: "un Team aislado usado por tests legacy puede
  // conservar un pequeño estado de bootstrap antes de ser enlazado") — usa
  // los MISMOS constructores que `Club.js` (fuente única de esa forma), así
  // que un Team sin `Club` (modo prueba / tests antiguos) se comporta
  // EXACTAMENTE igual que antes de esta entrega. En cuanto `team.club` se
  // enlaza a una instancia real, este objeto deja de leerse — Club pasa a
  // ser la única fuente de verdad (ver los accesores más abajo).
  function buildInstitutionalBootstrap(data = {}) {
    const reputation = data.reputation || {};
    return {
      foundationYear: data.foundationYear || null,
      budget: data.budget || 0,
      reputationFinancial: clamp(reputation.financial !== undefined ? reputation.financial : 50, 0, 100),
      reputationYouth: clamp(reputation.youth !== undefined ? reputation.youth : 50, 0, 100),
      facilities: ClubCore().buildFacilities(data.facilities),
      board: ClubCore().buildBoard(data.board),
      fanbase: ClubCore().buildFanbase(data.fanbase),
      finances: ClubCore().buildFinances(data.finances),
      clubDNA: data.clubDNA || ClubCore().CLUB_DNA_EXAMPLES[0],
    };
  }

  class Team {
    constructor(data = {}) {
      this.id = data.id || generateId();

      // NATIONAL-TEAMS-1 (DESIGN.md 10.17, sección 3.1 del prompt) — se
      // resuelve ANTES que `clubId`/federación/área representada, porque
      // esos tres campos son relaciones VÁLIDAS distintas según el tipo.
      this.teamKind = validateTeamKind(data.teamKind || 'club-team');

      // --- Datos básicos ---
      this.name = data.name || '';
      this.city = data.city || '';
      // `foundationYear` es un accesor institucional (ver más abajo) —
      // `buildInstitutionalBootstrap(data)` lo inicializa desde `data`
      // unas líneas más abajo; asignarlo aquí (antes de que exista
      // `this._institutionalBootstrap`) invocaría el setter sobre un
      // bootstrap todavía inexistente.
      this.division = Team.validateDivision(data.division);

      // --- World Architecture (WORLD-CORE-1, ARCH-WORLD-06/07) ---
      // Puente de compatibilidad hacia la nueva jerarquía mundial (`Club`/
      // `CompetitionEntry`, ver `src/entities/Club.js`/`Competition.js`):
      // opcional aquí (Team sigue instanciándose sin mundo en tests/modo
      // prueba), se asigna aparte tras construir el equipo cuando un
      // paquete de contenido (`data/world/spain-2026.1.js`) lo afilia a un
      // `Club` — mismo patrón ya establecido para `player.dataSource`
      // (fuera del constructor de Player). `division` NUNCA es la fuente
      // de verdad de participación desde WORLD-CORE-1 (invariante 8):
      // sigue existiendo como alias legacy para el runtime todavía no
      // migrado (Liga/Copa/Playoffs/Ascenso), pero `legacyDivision` es el
      // nombre explícito para código NUEVO que necesite leer ese puente
      // sabiendo que es compatibilidad, no verdad.
      // NATIONAL-TEAMS-1 (DESIGN.md 10.17, sección 3.1 del prompt) —
      // relaciones VÁLIDAS por `teamKind`: un "club-team" exige `clubId`
      // (al entrar en `GameWorld`, comprobado por
      // `WorldRegistries.registerTeam()`, no aquí en modo bootstrap) y
      // nunca tiene federación/área representada; un "national-team" NUNCA
      // tiene club y exige federación+área representada explícitas ya en el
      // constructor (fallan rápido, no solo al registrar).
      if (this.teamKind === 'national-team') {
        if (data.clubId) {
          throw new Error(`Team "${this.id}": un equipo "national-team" no puede declarar "clubId" (solo un "club-team" tiene club).`);
        }
        if (!data.federationOrganizationId) {
          throw new Error(`Team "${this.id}": un equipo "national-team" exige "federationOrganizationId" explícito.`);
        }
        if (!data.representedAreaId) {
          throw new Error(`Team "${this.id}": un equipo "national-team" exige "representedAreaId" explícito.`);
        }
        this.clubId = null;
        this.federationOrganizationId = data.federationOrganizationId;
        this.representedAreaId = data.representedAreaId;
      } else {
        this.clubId = data.clubId || null;
        this.federationOrganizationId = null;
        this.representedAreaId = null;
      }
      // CLUB-CORE-1: referencia VIVA a la instancia real de `Club` (nunca
      // una copia) — `null` hasta que un paquete de contenido la enlace
      // (`team.club = clubInstance`, mismo patrón que `team.clubId`). Los
      // accesores institucionales de más abajo delegan en esta instancia
      // en cuanto existe; antes de eso, leen `this._institutionalBootstrap`
      // (sección 10 del prompt: "un Team aislado usado por tests legacy
      // puede conservar un pequeño estado de bootstrap antes de ser
      // enlazado, pero al entrar en GameWorld debe quedar una sola fuente
      // mutable").
      this.club = null;
      this._institutionalBootstrap = buildInstitutionalBootstrap(data);

      // CLUB-CORE-1 (DESIGN.md sección 10, "rol dentro del club... categoría
      // explícita, al menos género y tramo de edad"): estructurados, con
      // `teamType` conservado como alias legacy derivado (ver arriba).
      this.role = validateTeamRole(data.role || 'first-team');
      this.category = buildTeamCategory(data.category);
      this.teamType = data.teamType || composeLegacyTeamType(this.role, this.category);
      this.homeAreaId = data.homeAreaId || null;
      this.legacyDivision = data.legacyDivision || this.division;

      // Estadio: entidad propia todavía no implementada (DESIGN.md 6.2:
      // "el equipo solo referencia su instancia de estadio"). Aforo y
      // ocupación vivirán ahí, no en Team. Placeholder: null hasta entonces.
      this.stadium = data.stadium || null;

      // --- Plantilla ---
      // CLUB-CORE-1: `Squad` (`src/entities/Squad.js`) es la fuente de
      // verdad operativa — `this.squad` es la referencia VIVA al squad
      // activo (`null` hasta que un paquete de contenido lo enlace, mismo
      // patrón que `this.club`). Antes de enlazar, `this._legacyRoster`
      // sostiene la plantilla de "bootstrap" (modo prueba/tests legacy) —
      // `this.roster` (getter, más abajo) es SIEMPRE una vista de una única
      // fuente mutable, nunca una segunda copia independiente.
      this.squad = null;
      this.primarySquadId = null;
      this._legacyRoster = Array.isArray(data.roster) ? [...data.roster] : [];
      // Si el roster llega ya poblado (equipos cargados desde datos
      // guardados/generados con jugadores ya creados), aseguramos que cada
      // jugador quede con teamId sincronizado, por si viene de una fuente
      // que no lo puso.
      this._legacyRoster.forEach((player) => { player.teamId = this.id; });

      // --- Reputación DEPORTIVA (DESIGN.md 6.2.1) ---
      // Escala provisional 0-100: a diferencia de los atributos de jugador
      // (1-20, ya fijados en 6.1), DESIGN.md todavía no fija la escala
      // numérica de la reputación — pendiente de confirmar con Dennis.
      // CLUB-CORE-1: solo el componente DEPORTIVO (títulos, calidad de
      // plantilla) sigue siendo del `Team` — financiera/cantera son
      // institucionales y viven en `Club` (ver `this.reputation` getter
      // más abajo, que compone los 3 de solo lectura).
      const reputation = data.reputation || {};
      this._sportingReputation = clamp(reputation.sporting !== undefined ? reputation.sporting : 50, 0, 100);

      // --- Perfil táctico (DESIGN.md 7.12.2, persistido desde TAC-2) ---
      // Instancia real de TacticalProfile (nunca un objeto plano suelto),
      // inicializada con valores por defecto razonables si no se especifica
      // — mismo patrón que `clubDNA`/`reputation` arriba. `TacticalProfile`
      // ya valida su propia forma (cobertura de P&R, spacing) en su
      // constructor, así que no se revalida aquí.
      this.tacticalProfile = new TacticsCore.TacticalProfile(data.tacticalProfile || {});

      // --- Rivalidades (DESIGN.md 6.2.9): dos tipos, ambos activos ya ---
      const rivalries = data.rivalries || {};
      this.rivalries = {
        fixed: Array.isArray(rivalries.fixed) ? [...rivalries.fixed] : [], // derbis históricos
        dynamic: Array.isArray(rivalries.dynamic) ? [...rivalries.dynamic] : [], // emergentes en partida
      };

      // --- Historia y leyendas (DESIGN.md 6.2.10) ---
      const history = data.history || {};
      this.history = {
        titles: Array.isArray(history.titles) ? [...history.titles] : [],
        legends: Array.isArray(history.legends) ? [...history.legends] : [],
      };

      // --- LIFE-2 (DESIGN.md 9, subsección normativa LIFE-2) ---
      this.trainingPlan = buildTrainingPlan(data.trainingPlan);
      this.trainingState = buildTrainingState(data.trainingState);

      // --- LIFE-3 (DESIGN.md 9.14, sección 11 del prompt de esa sesión):
      // hook neutral de Staff médico — 1-20, default 10, ningún empleado/
      // contrato real todavía (Staff como entidad queda para una sesión
      // futura, mismo criterio que `training.staffContext` de LIFE-2). ---
      const medicalStaffContext = data.medicalStaffContext || {};
      this.medicalStaffContext = {
        doctor: medicalStaffContext.doctor !== undefined ? medicalStaffContext.doctor : 10,
        physiotherapy: medicalStaffContext.physiotherapy !== undefined ? medicalStaffContext.physiotherapy : 10,
        physicalPreparation: medicalStaffContext.physicalPreparation !== undefined ? medicalStaffContext.physicalPreparation : 10,
      };
    }

    // BUG-WORLDCORE-09 (CLUB-CORE-1, corregido): antes devolvía '1ª' en
    // silencio ante `undefined`, aunque WORLD-CORE-1 ya afirmaba (comentarios,
    // CHANGELOG, invariante 14) que no existía fallback universal a la
    // primera división. Un `Team` genérico sin división legacy conserva
    // `division: null` (y por tanto `legacyDivision: null`, ver
    // constructor); un valor explícito no reconocido sigue fallando de
    // forma descriptiva. El contenido español sigue pasando siempre '1ª' o
    // '2ª' de forma explícita mientras exista el runtime legacy (ver
    // `data/world/spain-2026.1.js`/`src/utils/teamGenerator.js`).
    static validateDivision(division) {
      if (division === undefined || division === null) return null;
      if (!DIVISIONS.includes(division)) {
        throw new Error('División no válida: debe ser una de ' + DIVISIONS.join(', '));
      }
      return division;
    }

    get fullName() {
      return this.city ? `${this.name} (${this.city})` : this.name;
    }

    // ---------------------------------------------------------------------
    // CLUB-CORE-1 — accesores institucionales legacy: PROYECCIONES/
    // DELEGACIONES hacia la MISMA instancia de `Club` en cuanto existe
    // (`this.club`), nunca una segunda copia mutable (DESIGN.md sección 10).
    // Antes de enlazar (`this.club === null`, modo prueba/tests legacy),
    // leen/escriben `this._institutionalBootstrap` — la MISMA forma que
    // tenían estos campos antes de esta entrega, así que un Team aislado se
    // comporta exactamente igual que antes.
    // ---------------------------------------------------------------------
    get foundationYear() { return this.club ? this.club.foundationYear : this._institutionalBootstrap.foundationYear; }

    set foundationYear(value) {
      if (this.club) this.club.foundationYear = value; else this._institutionalBootstrap.foundationYear = value;
    }

    get budget() { return this.club ? this.club.budget : this._institutionalBootstrap.budget; }

    set budget(value) {
      if (this.club) this.club.budget = value; else this._institutionalBootstrap.budget = value;
    }

    get clubDNA() { return this.club ? this.club.clubDNA : this._institutionalBootstrap.clubDNA; }

    set clubDNA(value) {
      if (this.club) this.club.clubDNA = value; else this._institutionalBootstrap.clubDNA = value;
    }

    // Objetos anidados: la MISMA referencia vive en `Club` (o en el
    // bootstrap) — quien mute `team.facilities.trainingCenter.level = X`
    // está mutando esa única instancia, nunca una copia (sección 10 del
    // prompt: "nunca objetos copiados").
    get facilities() { return this.club ? this.club.facilities : this._institutionalBootstrap.facilities; }

    get board() { return this.club ? this.club.board : this._institutionalBootstrap.board; }

    get fanbase() { return this.club ? this.club.fanbase : this._institutionalBootstrap.fanbase; }

    get finances() { return this.club ? this.club.finances : this._institutionalBootstrap.finances; }

    // Reputación (DESIGN.md 6.2.1): compone SIEMPRE los 3 sub-componentes —
    // "deportiva" es del propio `Team` (`this._sportingReputation`, nunca
    // mutada fuera del constructor hoy), "financiera"/"cantera" son
    // institucionales (`Club`). Objeto NUEVO en cada lectura (de solo
    // lectura: nada en el motor escribe `team.reputation.*` directamente,
    // auditado en CLAUDE.md) — nunca una segunda copia mutable persistente.
    get reputation() {
      const institutional = this.club
        ? { financial: this.club.reputationFinancial, youth: this.club.reputationYouth }
        : { financial: this._institutionalBootstrap.reputationFinancial, youth: this._institutionalBootstrap.reputationYouth };
      return { sporting: this._sportingReputation, ...institutional };
    }

    // Mantenimiento anual de las 7 instalaciones — delegado en `Club`
    // (bootstrap si aún no hay Club enlazado).
    get facilitiesMaintenanceCost() {
      return this.club ? this.club.facilitiesMaintenanceCost
        : Object.values(this.facilities).reduce((sum, facility) => sum + facility.maintenanceCost, 0);
    }

    get totalIncome() {
      if (this.club) return this.club.totalIncome;
      return Object.values(this.finances.income).reduce((sum, value) => sum + value, 0);
    }

    get totalExpenses() {
      if (this.club) return this.club.totalExpenses;
      return Object.values(this.finances.expenses).reduce((sum, value) => sum + value, 0)
        + this.facilitiesMaintenanceCost;
    }

    get netResult() {
      return this.totalIncome - this.totalExpenses;
    }

    // --- Plantilla ---
    // CLUB-CORE-1: vista de compatibilidad del squad activo — SIEMPRE
    // devuelve la misma referencia de array que `this.squad.players` (o
    // `this._legacyRoster` en modo bootstrap), nunca una copia (DESIGN.md
    // sección 5.3: "Team.roster... debe devolver las mismas referencias").
    get roster() { return this.squad ? this.squad.players : this._legacyRoster; }

    addPlayer(player) {
      player.teamId = this.id;
      if (this.squad) this.squad.addPlayer(player); else this._legacyRoster.push(player);
    }

    removePlayer(playerId) {
      const leaving = this.roster.find((player) => player.id === playerId);
      if (leaving) leaving.teamId = null;
      if (this.squad) this.squad.removePlayer(playerId);
      else this._legacyRoster = this._legacyRoster.filter((player) => player.id !== playerId);
      // LIFE-2 (sección 4): un jugador que sale de la plantilla no deja un
      // foco individual huérfano en el plan de entrenamiento.
      delete this.trainingPlan.individualFocuses[playerId];
    }

    // Recibe los ids de jugadores de la plantilla y devuelve la convocatoria
    // validada. `Team` SOLO valida el rango recibido — nunca decide qué
    // normativa aplicar (ROSTER-1, DESIGN.md 9.16): quien llama resuelve
    // antes el rango real de ESA competición vía
    // `CompetitionRules.resolveRules()` y lo pasa aquí explícito.
    //
    // REG-1 (DESIGN.md 9.18, BUG-CONTRACT1-03): `minOverride`/`maxOverride`
    // son OBLIGATORIOS — ya NO existe un fallback silencioso a 8-12. Un
    // llamador de producción sin política/contexto explícito falla con un
    // error de dominio descriptivo, nunca hereda ACB. Quien necesite el
    // rango legacy de prueba debe pasar `TEST_MATCH_SQUAD_POLICY.min/max`
    // explícitamente (ver `MatchEngine.defaultMatchSquad()` y
    // `buildMatchSquadExcludingPosition()` más abajo).
    // `minOverride` (LIFE-3, DESIGN.md 9.14, sección 23 del prompt de esa
    // sesión): también sirve para la excepción médica de convocatoria —
    // 5-7 jugadores solo cuando la plantilla queda médicamente reducida
    // (nunca por elección del usuario/CPU) — el mínimo normal de partida
    // ahora lo aporta la competición, la reducción la sigue aportando
    // `Medical.resolveEffectiveSquadMinimum()`.
    buildMatchSquad(playerIds, minOverride, maxOverride) {
      if (minOverride === undefined || minOverride === null || maxOverride === undefined || maxOverride === null) {
        throw new Error(
          'Team.buildMatchSquad: hacen falta "minOverride"/"maxOverride" explícitos — REG-1 (BUG-CONTRACT1-03) '
          + 'retiró el fallback silencioso a 8-12. Resuelve antes el rango real de la competición (o pasa '
          + 'TEST_MATCH_SQUAD_POLICY.min/max en un fixture de prueba con nombre explícito).',
        );
      }
      const squad = playerIds.map((id) => this.roster.find((player) => player.id === id));
      if (squad.some((player) => !player)) {
        throw new Error('La convocatoria incluye algún jugador que no pertenece a la plantilla');
      }
      if (squad.length < minOverride || squad.length > maxOverride) {
        throw new Error(`La convocatoria debe tener entre ${minOverride} y ${maxOverride} jugadores`);
      }
      return squad;
    }

    // Construye la convocatoria excluyendo a cualquier jugador cuya posición
    // PRINCIPAL (DESIGN.md 6.1: la única con valor 20 en su mapa de 5) sea
    // la indicada — ej. excluir todos los "Pívot" puros (Pívot=20), pero
    // mantener a un jugador cuya principal sea Ala-pívot aunque tenga
    // también nivel alto en Pívot como secundaria. Genérico por posición:
    // sirve igual para "sin Bases", "sin Aleros", etc., sin tocar código de
    // nuevo. Herramienta de prueba de estrés del motor, no una regla de
    // reglamento (no está en DESIGN.md) — usa EXPLÍCITAMENTE
    // `TEST_MATCH_SQUAD_POLICY` (REG-1, BUG-CONTRACT1-03): nunca consagra
    // 8-12 como ley universal, es un fixture de prueba nombrado.
    buildMatchSquadExcludingPosition(position) {
      const eligible = this.roster.filter((player) => player.primaryPosition !== position);
      if (eligible.length < TEST_MATCH_SQUAD_POLICY.min) {
        throw new Error(
          `Tras excluir la posición "${position}" solo quedan ${eligible.length} jugadores elegibles `
          + `en la plantilla de ${this.fullName} — hacen falta al menos ${TEST_MATCH_SQUAD_POLICY.min} para convocar `
          + '(TEST_MATCH_SQUAD_POLICY, fixture de prueba).',
        );
      }
      const ids = eligible.slice(0, TEST_MATCH_SQUAD_POLICY.max).map((player) => player.id);
      return this.buildMatchSquad(ids, TEST_MATCH_SQUAD_POLICY.min, TEST_MATCH_SQUAD_POLICY.max);
    }

    // --- Cantera/Academia (DESIGN.md 6.2.3) ---
    // Placeholder actual: cada temporada la Cantera/Academia genera 3
    // jugadores jóvenes reutilizando el generador de jugadores (6.1), y se
    // incorporan directamente a la plantilla total (sin filial ni
    // categorías inferiores todavía). Relacionar la calidad de estos
    // jugadores con el nivel de la instalación Cantera/Academia queda
    // pendiente de una sesión de diseño futura — no se inventa esa fórmula.
    //
    // Nota de auditoría (no implementado todavía): DESIGN.md 6.2.8 dice que
    // el ADN de Club debería "sesgar el tipo de jugadores que genera la
    // Cantera/Academia" — this.clubDNA todavía NO influye en esta
    // generación (usa el mismo generador genérico que cualquier jugador
    // joven). Pendiente de definir cómo se traduce cada ADN en un sesgo de
    // atributos/posiciones.
    // `referenceDate` (LIFE-1, DESIGN.md 9): fecha real de la partida en
    // curso en el instante del intake — se reenvía tal cual a
    // generateFictionalPlayer() para que developmentState.lastProcessedDate
    // del canterano nuevo arranque en esa fecha (no en el reloj real de la
    // máquina) y para que closeSeasonAndPrepareNext() no le aplique ningún
    // progreso retroactivo (invariante 36). Opcional por compatibilidad
    // (llamadas de modo prueba sin fecha de partida real siguen
    // funcionando igual que antes).
    // CYCLE-1 (DESIGN.md 9.22) — API LEGACY, SOLO MODO PRUEBA / tests
    // antiguos del motor. Ya NO existe ningún camino de CARRERA que llame
    // aquí: el ciclo anual incorpora la cantera al **pool de academia**
    // (`AcademyRegistry`/`AcademyService`, DESIGN.md 6.2.3 reescrito), donde
    // un joven NO tiene contrato, ni licencia, ni plaza en `Team.roster`
    // hasta que una promoción explícita y válida lo afilia mediante
    // `RosterMutationService` + `ContractService` + REG-1. Añadir tres
    // seniors por club y temporada (BUG-CYCLE1-05: ~108 jugadores nuevos por
    // cierre, sin ninguna salida equivalente) queda retirado del ciclo.
    //
    // Se conserva porque el "modo prueba" de `index.html` y los tests de
    // LIFE-1..4 la invocan directamente. Corregida además su generación
    // (BUG-CYCLE1-02): `referenceDate` obligatoria y semilla estable, para
    // que un intake 16-19 tenga EXACTAMENTE 16-19 años en esa fecha civil
    // (antes el año de nacimiento salía del reloj real de la máquina y con
    // un mes/día aleatorio podía producir un jugador de 15 años).
    generateAcademyIntake(count = 3, referenceDate) {
      if (!referenceDate) {
        throw new Error(
          'Team.generateAcademyIntake: "referenceDate" es OBLIGATORIA — CYCLE-1 (BUG-CYCLE1-02) prohíbe generar '
          + 'un jugador contra el reloj del sistema. En una carrera real usa AcademyService.runAnnualIntake().',
        );
      }
      const CareerAge = ((typeof module !== 'undefined' && module.exports)
        ? require('../utils/CareerAge.js') : global.BasketManager).CareerAge;
      const referenceIso = CareerAge.requireCareerDate(referenceDate, 'referenceDate');
      const newPlayers = [];
      for (let i = 0; i < count; i++) {
        const player = PlayerGenerator.generateFictionalPlayer({
          minAge: 16,
          maxAge: 19,
          referenceDate: referenceIso,
          seed: `legacy-academy-intake|${this.id}|${referenceIso}|${i}`,
          id: `legacy-academy:${this.id}:${referenceIso}:${i}`,
        });
        this.addPlayer(player);
        newPlayers.push(player);
      }
      return newPlayers;
    }

    // --- Historia y leyendas (DESIGN.md 6.2.10) ---
    addTitle(title) {
      this.history.titles.push(title);
    }

    addLegend(player, status) {
      if (!LEGEND_STATUSES.includes(status)) {
        throw new Error('Estatus de leyenda no válido: debe ser uno de ' + LEGEND_STATUSES.join(', '));
      }
      this.history.legends.push({ player, status });
    }

    // Representación plana, útil para guardar partidas (saves/) más adelante.
    // CLUB-CORE-1: ya NO incrusta los objetos institucionales canónicos
    // (facilities/board/fanbase/finances/clubDNA/budget/foundationYear) —
    // esos viven en `Club.toJSON()`, nunca duplicados aquí (DESIGN.md
    // sección 10). `reputation` solo serializa el componente DEPORTIVO
    // (el único que es realmente de `Team`).
    toJSON() {
      return {
        id: this.id,
        name: this.name,
        city: this.city,
        division: this.division,
        teamKind: this.teamKind,
        clubId: this.clubId,
        federationOrganizationId: this.federationOrganizationId,
        representedAreaId: this.representedAreaId,
        teamType: this.teamType,
        role: this.role,
        category: { ...this.category },
        homeAreaId: this.homeAreaId,
        legacyDivision: this.legacyDivision,
        primarySquadId: this.primarySquadId,
        stadium: this.stadium,
        roster: this.roster.map((player) => (typeof player.toJSON === 'function' ? player.toJSON() : player)),
        reputation: { sporting: this._sportingReputation },
        medicalStaffContext: this.medicalStaffContext,
        tacticalProfile: this.tacticalProfile,
        rivalries: this.rivalries,
        history: this.history,
        trainingPlan: this.trainingPlan,
        trainingState: {
          ...this.trainingState,
          lastProcessedDate: this.trainingState.lastProcessedDate
            ? this.trainingState.lastProcessedDate.toISOString() : null,
          planSegments: this.trainingState.planSegments.map((segment) => ({
            ...segment,
            effectiveFrom: segment.effectiveFrom ? segment.effectiveFrom.toISOString() : null,
          })),
          recentTeamMatchDates: this.trainingState.recentTeamMatchDates.map((d) => d.toISOString()),
          nextCpuCollectiveReviewDate: this.trainingState.nextCpuCollectiveReviewDate
            ? this.trainingState.nextCpuCollectiveReviewDate.toISOString() : null,
          nextCpuIndividualReviewDate: this.trainingState.nextCpuIndividualReviewDate
            ? this.trainingState.nextCpuIndividualReviewDate.toISOString() : null,
        },
      };
    }
  }

  const exportsObj = {
    Team,
    DIVISIONS,
    TEAM_KINDS,
    MATCH_SQUAD_MIN,
    MATCH_SQUAD_MAX,
    TEST_MATCH_SQUAD_POLICY,
    TEAM_ROLES,
    TEAM_GENDERS,
    TEAM_AGE_TIERS,
    LEGEND_STATUSES,
  };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad futuros) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
