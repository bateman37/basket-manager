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

  const DIVISIONS = ['1ª', '2ª'];

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

  const FACILITY_MIN = 1;
  const FACILITY_MAX = 20;

  // Las 7 instalaciones de DESIGN.md 6.2.2, con su nombre descriptivo.
  const FACILITY_KEYS = [
    'trainingCenter',
    'medicalCenter',
    'physicalPreparation',
    'academy',
    'scoutingNetwork',
    'analyticsDepartment',
    'hospitality',
  ];

  const FACILITY_LABELS = {
    trainingCenter: 'Centro de Entrenamiento',
    medicalCenter: 'Centro Médico',
    physicalPreparation: 'Preparación Física',
    academy: 'Cantera/Academia',
    scoutingNetwork: 'Red de Scouting',
    analyticsDepartment: 'Departamento de Análisis/Dirección Deportiva',
    hospitality: 'Hospitality/Patrocinio',
  };

  // Ejemplos de ADN de club citados en DESIGN.md 6.2.8 — no es una lista
  // cerrada, un club puede tener cualquier texto descriptivo de identidad.
  const CLUB_DNA_EXAMPLES = ['Cantera', 'Ritmo alto', 'Defensa', 'Veteranía'];

  // Niveles de leyenda de club — DESIGN.md 6.2.10.
  const LEGEND_STATUSES = ['Predilecto', 'Ídolo', 'Leyenda'];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampFacilityLevel(value) {
    return clamp(Math.round(value), FACILITY_MIN, FACILITY_MAX);
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

  // Construye las 7 instalaciones a partir de los datos recibidos (o valores
  // por defecto razonables). El coste de mantenimiento y la obsolescencia
  // son solo datos por ahora — la lógica temporal de cuándo se vuelve
  // obsoleta una instalación queda pendiente (DESIGN.md 6.2.2).
  function buildFacilities(data = {}) {
    const facilities = {};
    FACILITY_KEYS.forEach((key) => {
      const source = data[key] || {};
      facilities[key] = {
        name: FACILITY_LABELS[key],
        level: clampFacilityLevel(source.level !== undefined ? source.level : 10),
        maintenanceCost: source.maintenanceCost !== undefined ? source.maintenanceCost : 0,
        obsolete: Boolean(source.obsolete),
      };
    });
    return facilities;
  }

  class Team {
    constructor(data = {}) {
      this.id = data.id || generateId();

      // --- Datos básicos ---
      this.name = data.name || '';
      this.city = data.city || '';
      this.foundationYear = data.foundationYear || null;
      this.division = Team.validateDivision(data.division);

      // Presupuesto: caja actual del club. El desglose completo de
      // ingresos/gastos vive en `finances` (DESIGN.md 6.2.6) — este campo
      // es el saldo, no una fuente de ingreso más.
      this.budget = data.budget || 0;

      // Estadio: entidad propia todavía no implementada (DESIGN.md 6.2:
      // "el equipo solo referencia su instancia de estadio"). Aforo y
      // ocupación vivirán ahí, no en Team. Placeholder: null hasta entonces.
      this.stadium = data.stadium || null;

      // --- Plantilla ---
      // Plantilla total sin límite duro; la convocatoria de partido (8-12)
      // se valida aparte con buildMatchSquad().
      this.roster = Array.isArray(data.roster) ? [...data.roster] : [];
      // Si el roster llega ya poblado (equipos cargados desde datos
      // guardados/generados con jugadores ya creados), aseguramos que cada
      // jugador quede con teamId sincronizado, por si viene de una fuente
      // que no lo puso.
      this.roster.forEach((player) => { player.teamId = this.id; });

      // --- Reputación (DESIGN.md 6.2.1) ---
      // Escala provisional 0-100: a diferencia de los atributos de jugador
      // (1-20, ya fijados en 6.1), DESIGN.md todavía no fija la escala
      // numérica de la reputación — pendiente de confirmar con Dennis.
      //
      // Asignación factor → componente (aclarada en DESIGN.md 6.2.1; solo
      // documentada aquí, sin lógica de cálculo todavía — eso llegará con
      // el módulo de fichajes):
      //   - sporting (deportiva)  ← títulos ganados (this.history.titles) y
      //     división en la que compite (this.division), calidad de la
      //     plantilla actual e histórica (this.roster).
      //   - financial (financiera) ← poder económico del club (this.budget,
      //     this.finances) y nivel general de instalaciones (this.facilities,
      //     inversión acumulada).
      //   - youth (cantera)       ← éxito desarrollando canteranos propios
      //     (de momento sin trackear el origen de cada jugador, ver nota de
      //     la sesión) y nivel de las instalaciones Cantera/Academia y Red
      //     de Scouting (this.facilities.academy, this.facilities.scoutingNetwork).
      const reputation = data.reputation || {};
      this.reputation = {
        sporting: clamp(reputation.sporting !== undefined ? reputation.sporting : 50, 0, 100),
        financial: clamp(reputation.financial !== undefined ? reputation.financial : 50, 0, 100),
        youth: clamp(reputation.youth !== undefined ? reputation.youth : 50, 0, 100),
      };

      // --- Instalaciones (DESIGN.md 6.2.2) ---
      this.facilities = buildFacilities(data.facilities);

      // --- Junta/Propietario (DESIGN.md 6.2.4) ---
      const board = data.board || {};
      this.board = {
        patience: board.patience !== undefined ? board.patience : 50,
        sportingGoal: board.sportingGoal || 'Permanencia',
        financialGoal: board.financialGoal || 'Equilibrio presupuestario',
        multiYearPlan: Array.isArray(board.multiYearPlan) ? [...board.multiYearPlan] : [],
      };

      // --- Afición (DESIGN.md 6.2.5) ---
      // El "factor cancha" (fórmula ocupación × satisfacción × importancia
      // del partido) se calculará en el motor de simulación (sección 7,
      // aún no implementado) — aquí solo viven los datos de partida.
      const fanbase = data.fanbase || {};
      this.fanbase = {
        seasonTicketHolders: fanbase.seasonTicketHolders !== undefined ? fanbase.seasonTicketHolders : 0,
        satisfaction: clamp(fanbase.satisfaction !== undefined ? fanbase.satisfaction : 50, 0, 100),
        averageAttendance: clamp(fanbase.averageAttendance !== undefined ? fanbase.averageAttendance : 70, 0, 100),
      };

      // --- Finanzas (DESIGN.md 6.2.6) ---
      const finances = data.finances || {};
      const income = finances.income || {};
      const expenses = finances.expenses || {};
      this.finances = {
        income: {
          mainSponsorship: income.mainSponsorship || 0,
          secondarySponsorship: income.secondarySponsorship || 0,
          tvRights: income.tvRights || 0,
          leagueRevenueShare: income.leagueRevenueShare || 0,
          europeanCompetition: income.europeanCompetition || 0,
          ticketSales: income.ticketSales || 0,
          merchandising: income.merchandising || 0,
        },
        expenses: {
          playerSalaries: expenses.playerSalaries || 0,
          // Cuerpo técnico: partida anotada, importe pendiente de definir
          // hasta que exista esa entidad (DESIGN.md 6.2.7).
          coachingStaff: expenses.coachingStaff || 0,
          // El mantenimiento de las 7 instalaciones NO se duplica aquí:
          // se calcula a partir de `facilities` — ver facilitiesMaintenanceCost.
        },
      };

      // --- ADN de Club (DESIGN.md 6.2.8) ---
      this.clubDNA = data.clubDNA || CLUB_DNA_EXAMPLES[0];

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

    static validateDivision(division) {
      if (division === undefined) return DIVISIONS[0];
      if (!DIVISIONS.includes(division)) {
        throw new Error('División no válida: debe ser una de ' + DIVISIONS.join(', '));
      }
      return division;
    }

    get fullName() {
      return this.city ? `${this.name} (${this.city})` : this.name;
    }

    // Mantenimiento anual de las 7 instalaciones — se calcula a partir de
    // `facilities` en vez de guardarse por duplicado en `finances`.
    get facilitiesMaintenanceCost() {
      return Object.values(this.facilities).reduce((sum, facility) => sum + facility.maintenanceCost, 0);
    }

    get totalIncome() {
      return Object.values(this.finances.income).reduce((sum, value) => sum + value, 0);
    }

    get totalExpenses() {
      return Object.values(this.finances.expenses).reduce((sum, value) => sum + value, 0)
        + this.facilitiesMaintenanceCost;
    }

    get netResult() {
      return this.totalIncome - this.totalExpenses;
    }

    // --- Plantilla ---
    addPlayer(player) {
      player.teamId = this.id;
      this.roster.push(player);
    }

    removePlayer(playerId) {
      const leaving = this.roster.find((player) => player.id === playerId);
      if (leaving) leaving.teamId = null;
      this.roster = this.roster.filter((player) => player.id !== playerId);
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
        player.teamId = this.id;
        this.roster.push(player);
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
    toJSON() {
      return {
        id: this.id,
        name: this.name,
        city: this.city,
        foundationYear: this.foundationYear,
        division: this.division,
        budget: this.budget,
        stadium: this.stadium,
        roster: this.roster.map((player) => (typeof player.toJSON === 'function' ? player.toJSON() : player)),
        reputation: this.reputation,
        facilities: this.facilities,
        board: this.board,
        fanbase: this.fanbase,
        finances: this.finances,
        clubDNA: this.clubDNA,
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
    MATCH_SQUAD_MIN,
    MATCH_SQUAD_MAX,
    TEST_MATCH_SQUAD_POLICY,
    FACILITY_KEYS,
    FACILITY_LABELS,
    FACILITY_MIN,
    FACILITY_MAX,
    CLUB_DNA_EXAMPLES,
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
