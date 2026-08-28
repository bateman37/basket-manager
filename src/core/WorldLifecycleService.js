// src/core/WorldLifecycleService.js
// CYCLE-1 (DESIGN.md 9.22, secciones 4/14 del prompt) — ciclo de vida del
// MUNDO: clasifica a TODOS los jugadores del `PlayerRegistry` en una única
// categoría operativa por intervalo y les aplica el procesado que les
// corresponde EXACTAMENTE UNA VEZ. Convención del proyecto: identificadores
// en inglés, comentarios en español.
//
// BUG-CYCLE1-04 (corregido aquí): el avance temporal anterior recorría
// `Team.roster` (`processDevelopmentToDateForTeams`), así que los agentes
// libres y cualquier otro jugador accesible por `PlayerRegistry` quedaban
// CONGELADOS — el registro mundial era un directorio, pero todavía no el
// universo recorrido por el ciclo de vida.
//
// BUG-CYCLE1-03 (corregido aquí): `initializePlayerLifecycle()` es el
// COMANDO único que inicializa carrera/desarrollo/médico/perfil de ciclo al
// CREAR, REGISTRAR o IMPORTAR un jugador. Ningún renderizador, filtro,
// orden, tooltip o getter de lectura escribe en el mundo.
//
// Categorías EXCLUSIVAS (sección 14): 'senior-service-roster', 'academy',
// 'free-agent', 'external-abstract', 'retired', 'left-professional-pathway'.
// La categoría se DERIVA de registros canónicos — nunca de cinco booleanos
// que puedan contradecirse.
//
// Módulo puro: no lee DOM ni `state`; recibe registros/equipos explícitos.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const PlayerDevelopmentModule = isNode ? require('./PlayerDevelopment.js') : global.BasketManager;
  const MedicalModule = isNode ? require('./Medical.js') : global.BasketManager;
  const PlayerCareerModule = isNode ? require('./PlayerCareer.js') : global.BasketManager;
  const TrainingModule = isNode ? require('./Training.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function PD() { return PlayerDevelopmentModule; }
  function Med() { return MedicalModule; }
  function PC() { return PlayerCareerModule; }
  function Train() { return TrainingModule; }

  const CATEGORIES = [
    'senior-service-roster',
    'academy',
    'free-agent',
    'external-abstract',
    'retired',
    'left-professional-pathway',
  ];

  // Contexto de desarrollo NEUTRAL de un agente libre: no tiene club, así
  // que no hereda instalaciones ni plan de entrenamiento de ninguno
  // (sección 14 del prompt: "contexto neutral, sin plan de entrenamiento de
  // un club inexistente").
  const NEUTRAL_FACILITY_LEVEL = 10;

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function toJsDate(date) {
    return date instanceof Date ? date : LD().toJsDate(toIso(date));
  }

  // =====================================================================
  // 1. Inicialización EXPLÍCITA (BUG-CYCLE1-03)
  // =====================================================================
  // Se llama en TODO punto que crea/registra/importa un jugador: bundle
  // real, relleno ficticio, pool de libres, cantera, emergencia. Idempotente.
  //
  // `opts.seasonKey` es obligatorio la primera vez (quien crea al jugador
  // siempre conoce la temporada de carrera). `opts.historyCompleteness`:
  // 'partial' para un jugador real que ya existía antes de la partida,
  // 'complete' para uno creado dentro de ella.
  function initializePlayerLifecycle(player, config, referenceDate, opts) {
    const options = opts || {};
    const jsDate = toJsDate(referenceDate);
    PD().ensureDevelopmentState(player, config, jsDate);
    Med().ensureMedicalState(player, config, jsDate);
    PC().ensureCareerHistory(player, config, jsDate, {
      historyCompleteness: options.historyCompleteness || 'partial',
      seasonKey: options.seasonKey,
    });
    // Perfil privado de ciclo/retiro: se crea aquí SOLO si se aporta el
    // registro del ciclo y el servicio de retiro (evita una dependencia
    // circular con RetirementService en el navegador). Sin ellos, el perfil
    // se creará en el primer ciclo anual — nunca durante un render.
    if (options.annualCycleRegistry && options.retirementService) {
      options.retirementService.ensureProfile({
        annualCycleRegistry: options.annualCycleRegistry,
        player,
        careerSeed: options.careerSeed,
        date: toIso(referenceDate),
      });
    }
    if (options.dataSource && !player.dataSource) player.dataSource = options.dataSource;
    return player;
  }

  // =====================================================================
  // 2. Clasificación EXCLUSIVA
  // =====================================================================
  // Prioridad de resolución (documentada y probada): retirado >
  // fuera de la vía profesional > roster senior de servicio > academia >
  // club externo abstracto > agente libre. Un cedido cuenta UNA sola vez,
  // en el roster del CESIONARIO (es donde está su instancia real). Un
  // vinculado tampoco recibe doble tick: conserva su afiliación de origen.
  function classifyWorld(deps, date) {
    const {
      playerRegistry, teams, annualCycleRegistry, academyRegistry, externalClubMembership,
    } = deps || {};
    const iso = toIso(date);
    const serviceClubByPlayerId = new Map();
    (teams || []).forEach((team) => {
      team.roster.forEach((player) => serviceClubByPlayerId.set(player.id, team.id));
    });

    const byPlayerId = new Map();
    const byCategory = CATEGORIES.reduce((acc, key) => { acc[key] = []; return acc; }, {});

    playerRegistry.all().forEach((player) => {
      let category;
      let serviceClubId = null;
      if (annualCycleRegistry && annualCycleRegistry.isRetiredOn(player.id, iso)) {
        category = 'retired';
      } else if (annualCycleRegistry && annualCycleRegistry.hasLeftProfessionalPathwayOn(player.id, iso)) {
        category = 'left-professional-pathway';
      } else if (serviceClubByPlayerId.has(player.id)) {
        category = 'senior-service-roster';
        serviceClubId = serviceClubByPlayerId.get(player.id);
      } else if (academyRegistry && academyRegistry.isInAcademyOn(player.id, iso)) {
        category = 'academy';
        const membership = academyRegistry.activeMembershipForPlayer(player.id, iso);
        serviceClubId = membership ? membership.clubId : null;
      } else if (externalClubMembership && externalClubMembership.has(player.id)) {
        // Hook EUROPE-1: club extranjero abstracto. Hoy nunca hay nadie
        // aquí (no existen plantillas extranjeras) — la categoría se
        // conserva para no tener que reclasificar el mundo entero después.
        category = 'external-abstract';
        serviceClubId = externalClubMembership.get(player.id);
      } else {
        category = 'free-agent';
      }
      byPlayerId.set(player.id, { playerId: player.id, category, serviceClubId });
      byCategory[category].push(player.id);
    });

    return {
      date: iso,
      byPlayerId,
      byCategory,
      counts: CATEGORIES.reduce((acc, key) => { acc[key] = byCategory[key].length; return acc; }, {}),
    };
  }

  // =====================================================================
  // 3. Procesado del intervalo
  // =====================================================================
  // | Categoría                 | Desarrollo | Médico | Entrenamiento club |
  // |---------------------------|------------|--------|--------------------|
  // | Roster senior de servicio | Sí         | Sí     | Club de servicio   |
  // | Academia                  | Sí         | Sí     | Contexto academia  |
  // | Agente libre              | Sí neutral | Sí     | No                 |
  // | Club externo abstracto    | Hook det.  | Sí     | No club español    |
  // | Retirado                  | No         | Histórico | No              |
  // | Fuera de vía profesional  | No         | Histórico | No              |
  //
  // Devuelve un RECEIPT de lote con los ids procesados por categoría y una
  // auditoría de exclusividad que FALLA ante cero o dos procesados para el
  // mismo jugador/intervalo.
  function processWorldToDate(deps, date, config, calendarContext) {
    const {
      playerRegistry, teams, academyRegistry,
    } = deps || {};
    const targetJsDate = toJsDate(date);
    const classification = classifyWorld(deps, date);
    const processedCount = new Map();
    const teamsById = new Map((teams || []).map((team) => [team.id, team]));

    function markProcessed(playerId) {
      processedCount.set(playerId, (processedCount.get(playerId) || 0) + 1);
    }

    // 3.1 Roster senior de servicio — se procesa POR EQUIPO (una sola
    // llamada a Training, que ya recorre `team.roster` exactamente una vez)
    // para conservar el entrenamiento colectivo/táctico real del club.
    (teams || []).forEach((team) => {
      Train().processTeamDevelopmentToDate(team, targetJsDate, config, calendarContext);
      team.roster.forEach((player) => markProcessed(player.id));
    });

    // 3.2 Academia — contexto de academia del club, SIN fingir roster senior.
    classification.byCategory.academy.forEach((playerId) => {
      const player = playerRegistry.get(playerId);
      if (!player) return;
      const entry = classification.byPlayerId.get(playerId);
      const club = entry.serviceClubId ? teamsById.get(entry.serviceClubId) : null;
      const facilityLevel = (club && club.facilities && club.facilities.academy)
        ? club.facilities.academy.level : NEUTRAL_FACILITY_LEVEL;
      PD().processPlayerToDate(player, targetJsDate, config, { facilityLevel });
      Med().processPlayerMedicalToDate(player, targetJsDate, config, club || null);
      markProcessed(playerId);
    });

    // 3.3 Agentes libres — contexto NEUTRAL, sin club.
    classification.byCategory['free-agent'].forEach((playerId) => {
      const player = playerRegistry.get(playerId);
      if (!player) return;
      PD().processPlayerToDate(player, targetJsDate, config, { facilityLevel: NEUTRAL_FACILITY_LEVEL });
      Med().processPlayerMedicalToDate(player, targetJsDate, config, null);
      markProcessed(playerId);
    });

    // 3.4 Club externo abstracto — hook determinista, sin club español.
    classification.byCategory['external-abstract'].forEach((playerId) => {
      const player = playerRegistry.get(playerId);
      if (!player) return;
      PD().processPlayerToDate(player, targetJsDate, config, { facilityLevel: NEUTRAL_FACILITY_LEVEL });
      Med().processPlayerMedicalToDate(player, targetJsDate, config, null);
      markProcessed(playerId);
    });

    // 3.5 Retirados y salidos de la vía profesional — NINGÚN desarrollo
    // deportivo futuro. Su estado médico queda como HISTÓRICO: ni se
    // procesa ni se borra. Se cuentan como procesados (decisión explícita:
    // "no recibir desarrollo" ES su procesado) para que la auditoría de
    // exclusividad cubra el mundo COMPLETO.
    classification.byCategory.retired.forEach((playerId) => markProcessed(playerId));
    classification.byCategory['left-professional-pathway'].forEach((playerId) => markProcessed(playerId));

    // 3.6 Auditoría de EXCLUSIVIDAD — falla ante 0 o 2+ procesados.
    const exclusivityErrors = [];
    playerRegistry.all().forEach((player) => {
      const times = processedCount.get(player.id) || 0;
      if (times !== 1) {
        exclusivityErrors.push(
          `El jugador "${player.id}" recibió ${times} procesados de ciclo en el intervalo hasta ${classification.date} `
          + `(categoría "${(classification.byPlayerId.get(player.id) || {}).category}") — debe ser EXACTAMENTE 1.`,
        );
      }
    });

    return {
      date: classification.date,
      counts: classification.counts,
      processedIds: [...processedCount.keys()].sort(),
      exclusivityErrors,
      valid: exclusivityErrors.length === 0,
      academyPoolSizes: academyRegistry
        ? (teams || []).reduce((acc, team) => {
          acc[team.id] = academyRegistry.activePoolForClub(team.id, classification.date).length;
          return acc;
        }, {})
        : null,
    };
  }

  // =====================================================================
  // 4. Cotas de población (sección 18 del prompt)
  // =====================================================================
  // Se distinguen TRES poblaciones y NUNCA se borra una instancia:
  //  - histórica mundial: todos los `Player` creados (incluidos retirados y
  //    salidos de la vía) — puede crecer linealmente;
  //  - activa profesional: rosters senior + academias + libres activos +
  //    externos abstractos activos — debe quedar ACOTADA;
  //  - fichable: subconjunto activo y elegible para mercado.
  function describePopulation(deps, date, cycleConfig, seniorMaxByClub) {
    const classification = classifyWorld(deps, date);
    const { teams } = deps || {};
    const activeCategories = ['senior-service-roster', 'academy', 'free-agent', 'external-abstract'];
    const activeCount = activeCategories.reduce((sum, key) => sum + classification.counts[key], 0);
    const clubCount = (teams || []).length;
    // Cota DERIVADA (nunca un assert mágico contra el total histórico):
    // suma de máximos senior configurados + academias + libres + margen.
    const seniorMaxTotal = (teams || []).reduce((sum, team) => sum + (seniorMaxByClub ? (seniorMaxByClub[team.id] || 0) : 0), 0);
    const bound = seniorMaxTotal
      + (clubCount * cycleConfig.ACADEMY.poolMaxPerClub)
      + cycleConfig.POPULATION.freeAgentHardMax
      + cycleConfig.POPULATION.activeMarginForFutureAgreements;
    return {
      date: classification.date,
      historicalTotal: deps.playerRegistry.all().length,
      activeTotal: activeCount,
      activeBound: bound,
      withinBound: activeCount <= bound,
      counts: classification.counts,
      breakdown: {
        seniorMaxTotal,
        academyBound: clubCount * cycleConfig.ACADEMY.poolMaxPerClub,
        freeAgentHardMax: cycleConfig.POPULATION.freeAgentHardMax,
        margin: cycleConfig.POPULATION.activeMarginForFutureAgreements,
      },
    };
  }

  const exportsObj = {
    WorldLifecycleService: {
      CATEGORIES,
      NEUTRAL_FACILITY_LEVEL,
      initializePlayerLifecycle,
      classifyWorld,
      processWorldToDate,
      describePopulation,
    },
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
