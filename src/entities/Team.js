// src/entities/Team.js
// Entidad Equipo (ficha completa) — ver DESIGN.md sección 6.2.
// Convención del proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  // Generador de jugadores, para la Cantera/Academia (ver 6.2.3 más abajo).
  const PlayerGenerator = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/playerGenerator.js')
    : global.BasketManager;

  const DIVISIONS = ['1ª', '2ª'];

  // Convocatoria de partido — DESIGN.md 6.2: mínimo 8, máximo 12, fiel al
  // reglamento real de la ACB. No afecta al tamaño de la plantilla total.
  const MATCH_SQUAD_MIN = 8;
  const MATCH_SQUAD_MAX = 12;

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

      // --- Reputación (DESIGN.md 6.2.1) ---
      // Escala provisional 0-100: a diferencia de los atributos de jugador
      // (1-20, ya fijados en 6.1), DESIGN.md todavía no fija la escala
      // numérica de la reputación — pendiente de confirmar con Dennis.
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
      this.roster.push(player);
    }

    removePlayer(playerId) {
      this.roster = this.roster.filter((player) => player.id !== playerId);
    }

    // Recibe los ids de jugadores de la plantilla y devuelve la convocatoria
    // validada (entre 8 y 12, todos pertenecientes a la plantilla). Lanza
    // error si no se cumple — DESIGN.md 6.2: reglamento real de la ACB.
    buildMatchSquad(playerIds) {
      const squad = playerIds.map((id) => this.roster.find((player) => player.id === id));
      if (squad.some((player) => !player)) {
        throw new Error('La convocatoria incluye algún jugador que no pertenece a la plantilla');
      }
      if (squad.length < MATCH_SQUAD_MIN || squad.length > MATCH_SQUAD_MAX) {
        throw new Error(`La convocatoria debe tener entre ${MATCH_SQUAD_MIN} y ${MATCH_SQUAD_MAX} jugadores`);
      }
      return squad;
    }

    // --- Cantera/Academia (DESIGN.md 6.2.3) ---
    // Placeholder actual: cada temporada la Cantera/Academia genera 3
    // jugadores jóvenes reutilizando el generador de jugadores (6.1), y se
    // incorporan directamente a la plantilla total (sin filial ni
    // categorías inferiores todavía). Relacionar la calidad de estos
    // jugadores con el nivel de la instalación Cantera/Academia queda
    // pendiente de una sesión de diseño futura — no se inventa esa fórmula.
    generateAcademyIntake(count = 3) {
      const newPlayers = [];
      for (let i = 0; i < count; i++) {
        const player = PlayerGenerator.generateFictionalPlayer({ minAge: 16, maxAge: 19 });
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
        rivalries: this.rivalries,
        history: this.history,
      };
    }
  }

  const exportsObj = {
    Team,
    DIVISIONS,
    MATCH_SQUAD_MIN,
    MATCH_SQUAD_MAX,
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
