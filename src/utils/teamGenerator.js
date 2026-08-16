// src/utils/teamGenerator.js
// Generador de equipos ficticios de prueba (data/fictional/), reutilizando
// el generador de jugadores para la plantilla. Ver DESIGN.md sección 6.2.
// Los valores concretos (rangos de presupuesto, reputación, etc.) son
// ejemplos de prueba, no cifras de diseño acordadas.

(function (global) {
  const TeamCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Team.js')
    : global.BasketManager;
  const PlayerGenerator = (typeof module !== 'undefined' && module.exports)
    ? require('./playerGenerator.js')
    : global.BasketManager;

  const { Team, DIVISIONS, CLUB_DNA_EXAMPLES, FACILITY_KEYS } = TeamCore;
  const { generateFictionalPlayers } = PlayerGenerator;

  // Nombres claramente ficticios (ciudades inventadas), para no mezclar
  // datos de prueba con clubes reales de data/real/.
  const CLUB_PREFIXES = ['CB', 'Baloncesto', 'CD'];
  const CITY_NAMES = [
    'Alcázar', 'Rivera', 'Montealto', 'Puertollano', 'Sierra Nueva',
    'Vallecas', 'Costa Azul', 'Miraflores', 'Peñaranda', 'Ribadeo',
  ];

  const SPORTING_GOALS = [
    'Evitar el descenso', 'Consolidarse en la categoría', 'Optar a playoffs', 'Pelear por el título',
  ];
  const FINANCIAL_GOALS = [
    'Equilibrio presupuestario', 'Reducir deuda', 'Aumentar ingresos por patrocinio',
  ];

  function randomFrom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // Niveles e importes de ejemplo para las 7 instalaciones — coherentes
  // entre sí (más nivel, más coste de mantenimiento) pero sin ninguna
  // fórmula de diseño detrás todavía.
  function randomFacilities() {
    const facilities = {};
    FACILITY_KEYS.forEach((key) => {
      const level = randomInt(5, 15);
      facilities[key] = {
        level,
        maintenanceCost: level * randomInt(2000, 5000),
        obsolete: Math.random() < 0.15,
      };
    });
    return facilities;
  }

  function randomMultiYearPlan() {
    return [
      `Temporada 1: ${randomFrom(SPORTING_GOALS)}`,
      `Temporada 2: ${randomFrom(SPORTING_GOALS)}`,
      `Temporada 3: ${randomFrom(SPORTING_GOALS)}`,
    ];
  }

  // `options.playerOptions` se pasa tal cual a generateFictionalPlayers()
  // — permite, por ejemplo, generar la plantilla con un rango de atributos
  // sesgado para pruebas de estrés del motor (ver skewedTeamGenerator.js),
  // sin cambiar el comportamiento por defecto (roster normal) si se omite.
  function generateFictionalTeam(options = {}) {
    const city = randomFrom(CITY_NAMES);
    const name = `${randomFrom(CLUB_PREFIXES)} ${city}`;

    return new Team({
      name,
      city,
      foundationYear: randomInt(1930, 2005),
      division: randomFrom(DIVISIONS),
      budget: randomInt(500000, 8000000),
      roster: generateFictionalPlayers(randomInt(14, 16), options.playerOptions),
      reputation: {
        sporting: randomInt(30, 90),
        financial: randomInt(30, 90),
        youth: randomInt(30, 90),
      },
      facilities: randomFacilities(),
      board: {
        patience: randomInt(40, 80),
        sportingGoal: randomFrom(SPORTING_GOALS),
        financialGoal: randomFrom(FINANCIAL_GOALS),
        multiYearPlan: randomMultiYearPlan(),
      },
      fanbase: {
        seasonTicketHolders: randomInt(1000, 9000),
        satisfaction: randomInt(40, 80),
        averageAttendance: randomInt(50, 90),
      },
      finances: {
        income: {
          mainSponsorship: randomInt(200000, 1500000),
          secondarySponsorship: randomInt(50000, 400000),
          tvRights: randomInt(100000, 900000),
          leagueRevenueShare: randomInt(100000, 700000),
          europeanCompetition: randomInt(0, 500000),
          ticketSales: randomInt(100000, 900000),
          merchandising: randomInt(20000, 300000),
        },
        expenses: {
          playerSalaries: randomInt(500000, 4000000),
          coachingStaff: 0, // 6.2.7: pendiente de definir hasta que exista esa entidad
        },
      },
      clubDNA: randomFrom(CLUB_DNA_EXAMPLES),
    });
  }

  function generateFictionalTeams(count) {
    const teams = [];
    for (let i = 0; i < count; i++) {
      teams.push(generateFictionalTeam());
    }
    return teams;
  }

  const exportsObj = { generateFictionalTeam, generateFictionalTeams };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
