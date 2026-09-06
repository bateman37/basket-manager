// src/entities/Club.js
// WORLD-CORE-1 (ARCH-WORLD-07) — `Club`: identidad institucional, separada
// del equipo deportivo (`Team`). CLUB-CORE-1 (DESIGN.md sección 10)
// completa la migración que WORLD-CORE-1 dejó señalada: finanzas,
// instalaciones, junta, afición, nómina proyectada y ADN de club pasan a
// vivir AQUÍ como fuente de verdad — `Team` conserva solo accesores legacy
// que DELEGAN en la misma instancia de `Club` (ver `src/entities/Team.js`),
// nunca una segunda copia mutable. Convención del proyecto: identificadores
// en inglés, comentarios en español.
//
// Decisión de compatibilidad de `spain-2026.1` (documentada, NO invariante
// universal, ver DESIGN.md 10.3/10.8): antes de CLUB-CORE-1,
// `club.id === primaryTeam.id`. Esta entrega la retira — el paquete español
// declara 36 `clubId` explícitos, distintos de sus 36 `teamId` (ver
// `data/world/spain-2026.1.js`).
//
// Reputación: DESIGN.md 6.2.1 separa 3 sub-componentes — "deportiva" sigue
// siendo del `Team` (calidad de plantilla, títulos), pero "financiera" y
// "de cantera" son institucionales y viven AQUÍ (`this.reputationFinancial`/
// `this.reputationYouth`). `Team.reputation` sigue exponiendo los 3 juntos
// como vista compuesta de solo lectura (getter).

(function (global) {
  const CLUB_STATUSES = ['active', 'inactive', 'historical', 'fictional-test'];

  const FACILITY_MIN = 1;
  const FACILITY_MAX = 20;

  // Las 7 instalaciones de DESIGN.md 6.2.2, con su nombre descriptivo —
  // fuente ÚNICA de esta lista (Team.js las importa de aquí para su modo
  // bootstrap, ver comentario en ese archivo).
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampFacilityLevel(value) {
    return clamp(Math.round(value), FACILITY_MIN, FACILITY_MAX);
  }

  // Construye las 7 instalaciones a partir de los datos recibidos (o valores
  // por defecto razonables) — fuente ÚNICA de esta forma (antes duplicada
  // solo en Team.js). El coste de mantenimiento y la obsolescencia son solo
  // datos por ahora — la lógica temporal de cuándo se vuelve obsoleta una
  // instalación queda pendiente (DESIGN.md 6.2.2).
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

  function buildBoard(data = {}) {
    return {
      patience: data.patience !== undefined ? data.patience : 50,
      sportingGoal: data.sportingGoal || 'Permanencia',
      financialGoal: data.financialGoal || 'Equilibrio presupuestario',
      multiYearPlan: Array.isArray(data.multiYearPlan) ? [...data.multiYearPlan] : [],
    };
  }

  function buildFanbase(data = {}) {
    return {
      seasonTicketHolders: data.seasonTicketHolders !== undefined ? data.seasonTicketHolders : 0,
      satisfaction: clamp(data.satisfaction !== undefined ? data.satisfaction : 50, 0, 100),
      averageAttendance: clamp(data.averageAttendance !== undefined ? data.averageAttendance : 70, 0, 100),
    };
  }

  function buildFinances(data = {}) {
    const income = data.income || {};
    const expenses = data.expenses || {};
    return {
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
        // El mantenimiento de las 7 instalaciones NO se duplica aquí: se
        // deriva de `facilities` — ver `facilitiesMaintenanceCost`.
      },
    };
  }

  class Club {
    constructor(data = {}) {
      if (!data.id) throw new Error('Club: falta "id".');
      if (!data.homeAreaId) {
        throw new Error(`Club "${data.id}": falta "homeAreaId" explícito.`);
      }
      if (!data.employerJurisdictionAreaId) {
        throw new Error(`Club "${data.id}": falta "employerJurisdictionAreaId" explícito — un club nunca hereda la `
          + 'jurisdicción laboral de su geografía de origen por defecto (MoraBanc Andorra es el test obligatorio).');
      }
      this.id = data.id;
      this.name = data.name || data.id;
      this.shortName = data.shortName || this.name;
      this.homeAreaId = data.homeAreaId;
      this.employerJurisdictionAreaId = data.employerJurisdictionAreaId;
      this.federationMembershipOrganizationIds = Array.isArray(data.federationMembershipOrganizationIds)
        ? [...data.federationMembershipOrganizationIds] : [];
      // Referencia al primer equipo — la única sección deportiva que existe
      // en el paquete español actual (CLUB-CORE-1 deja el modelo listo para
      // varios equipos por club vía `TeamRegistry.forClub()`, ver
      // DESIGN.md, invariante 6).
      this.primaryTeamId = data.primaryTeamId || null;
      this.status = data.status || 'active';
      if (!CLUB_STATUSES.includes(this.status)) {
        throw new Error(`Club "${data.id}": status "${this.status}" no válido — debe ser una de ${CLUB_STATUSES.join(', ')}.`);
      }
      this.dataSource = data.dataSource || null;
      this.provenance = data.provenance || null;

      // --- CLUB-CORE-1: estado institucional (fuente de verdad única, ver
      // DESIGN.md 5.1/6.2) — migrado desde `Team`, no inventado de nuevo. ---
      this.foundationYear = data.foundationYear || null;
      this.budget = data.budget || 0;
      const reputation = data.reputation || {};
      this.reputationFinancial = clamp(reputation.financial !== undefined ? reputation.financial : 50, 0, 100);
      this.reputationYouth = clamp(reputation.youth !== undefined ? reputation.youth : 50, 0, 100);
      this.facilities = buildFacilities(data.facilities);
      this.board = buildBoard(data.board);
      this.fanbase = buildFanbase(data.fanbase);
      this.finances = buildFinances(data.finances);
      this.clubDNA = data.clubDNA || CLUB_DNA_EXAMPLES[0];
    }

    // Mantenimiento anual de las 7 instalaciones — derivado de `facilities`,
    // nunca duplicado en `finances`.
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

    toJSON() {
      return {
        id: this.id,
        name: this.name,
        shortName: this.shortName,
        homeAreaId: this.homeAreaId,
        employerJurisdictionAreaId: this.employerJurisdictionAreaId,
        federationMembershipOrganizationIds: [...this.federationMembershipOrganizationIds],
        primaryTeamId: this.primaryTeamId,
        status: this.status,
        dataSource: this.dataSource,
        provenance: this.provenance,
        foundationYear: this.foundationYear,
        budget: this.budget,
        reputation: { financial: this.reputationFinancial, youth: this.reputationYouth },
        facilities: this.facilities,
        board: this.board,
        fanbase: this.fanbase,
        finances: this.finances,
        clubDNA: this.clubDNA,
      };
    }
  }

  const exportsObj = {
    Club,
    CLUB_STATUSES,
    FACILITY_KEYS,
    FACILITY_LABELS,
    FACILITY_MIN,
    FACILITY_MAX,
    CLUB_DNA_EXAMPLES,
    buildFacilities,
    buildBoard,
    buildFanbase,
    buildFinances,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
