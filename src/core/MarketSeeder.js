// src/core/MarketSeeder.js
// MARKET-1 (DESIGN.md 9.19, sección 14 del prompt) — bootstrap honesto y
// determinista: pool inicial de libres ficticios (14.1) y agentes/
// mandatos simulados (14.2). Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Determinismo total (sección 9.6/20): NINGUNA decisión usa Math.random()
// directo — `generateFictionalPlayer()` (playerGenerator.js) SÍ lo usa
// (aceptable para relleno de roster incompleto, sección "no es parte de
// esta entrega"), así que este seeder construye sus propios `Player`
// deterministas con `DeterministicRandom`, sin llamar a ese generador.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const PlayerModule = isNode ? require('../entities/Player.js') : global.BasketManager;
  const AgentModule = isNode ? require('../entities/Agent.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const DeterministicRandomModule = isNode ? require('../utils/DeterministicRandom.js') : global.BasketManager;
  const PlayerDevelopmentModule = isNode ? require('./PlayerDevelopment.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function Rnd() { return DeterministicRandomModule.DeterministicRandom; }

  const GENERATOR_VERSION = 'market-free-agent-v1';
  const SIMULATED_FREE_AGENT_DATA_SOURCE = 'simulated-market-free-agent-v1';
  const SIMULATED_AGENT_DATA_SOURCE = 'simulated-market-agent-v1';
  const SIMULATED_MANDATE_DATA_SOURCE = 'simulated-market-mandate-v1';
  const DEFAULT_POOL_SIZE = 30;
  const POSITIONS = PlayerModule.POSITIONS || ['Base', 'Escolta', 'Alero', 'Ala-pívot', 'Pívot'];

  // Nombres FICTICIOS (nunca reales) — mismo criterio que
  // playerGenerator.js: identidad ficticia, señalada con `dataSource`.
  const FIRST_NAMES = [
    'Aitor', 'Bruno', 'Cesc', 'Dídac', 'Enzo', 'Facu', 'Gonzalo', 'Hugo', 'Iker', 'Jonás',
    'Kilian', 'Leo', 'Marc', 'Nico', 'Oriol', 'Pau', 'Quim', 'Rubén', 'Sergi', 'Tomás',
  ];
  const LAST_NAMES = [
    'Abascal', 'Bermejo', 'Casals', 'Duarte', 'Escudero', 'Ferrer', 'Gallardo', 'Hidalgo',
    'Iglesias', 'Jover', 'Lozano', 'Montero', 'Novoa', 'Ortuño', 'Prados', 'Quintana',
    'Rivas', 'Salinas', 'Tudela', 'Vidal',
  ];
  const AGENCY_NAMES = ['Global Court Sports', 'Baseline Management', 'PickRoll Agency', 'Elite Hoops Partners', 'Metro Basketball Group'];

  function seasonKeyOf(referenceDate) {
    const iso = typeof referenceDate === 'string' ? referenceDate : LD().fromJsDate(referenceDate);
    const { year, month } = LD().parse(iso);
    return month >= 7 ? LD().seasonKeyFromStartYear(year) : LD().seasonKeyFromStartYear(year - 1);
  }

  // Nivel de atributo calibrado (1-20) — banda deliberadamente MEDIA
  // (nunca estrella): sección 14.1 "calibrado contra ACB y Primera FEB,
  // sin llenar el pool de estrellas".
  function buildAttributeGroup(names, fingerprint, discriminatorPrefix, baseLevel) {
    const group = {};
    names.forEach((name) => {
      const variance = Rnd().intFrom(fingerprint, `${discriminatorPrefix}:${name}`, -2, 2);
      group[name] = Math.max(1, Math.min(20, baseLevel + variance));
    });
    return group;
  }

  function buildPositionMap(primaryPosition, fingerprint) {
    const map = {};
    POSITIONS.forEach((pos) => {
      if (pos === primaryPosition) {
        map[pos] = Rnd().intFrom(fingerprint, `pos:${pos}`, 16, 20);
      } else {
        map[pos] = Rnd().intFrom(fingerprint, `pos:${pos}`, 1, 6);
      }
    });
    return map;
  }

  function buildFreeAgent(index, { careerSeed, referenceDate, config }) {
    const fingerprint = `${careerSeed}|${GENERATOR_VERSION}|${index}`;
    // Seis por posición como objetivo de distribución (sección 14.1) —
    // asignación determinista por ciclo, no una tirada que pueda desviar
    // la distribución.
    const primaryPosition = POSITIONS[index % POSITIONS.length];
    const firstName = Rnd().pickFrom(fingerprint, 'first-name', FIRST_NAMES);
    const lastName = Rnd().pickFrom(fingerprint, 'last-name', LAST_NAMES);

    // Edad 18-34 con distribución NO uniforme (media de tres tiradas ->
    // sesgo hacia el centro de la banda, sin descartar extremos).
    const r1 = Rnd().unitFrom(fingerprint, 'age-1');
    const r2 = Rnd().unitFrom(fingerprint, 'age-2');
    const r3 = Rnd().unitFrom(fingerprint, 'age-3');
    const age = 18 + Math.round(((r1 + r2 + r3) / 3) * 16);
    const iso = typeof referenceDate === 'string' ? referenceDate : LD().fromJsDate(referenceDate);
    const { year, month, day } = LD().parse(iso);
    const birthDate = new Date(year - age, month - 1, day);

    const positions = buildPositionMap(primaryPosition, fingerprint);
    // Nivel base 6-13 (banda media-baja, sección 14.1: "sin llenar el
    // pool de estrellas") — misma banda para los tres grupos, con
    // variación individual por atributo vía buildAttributeGroup.
    const baseLevel = 6 + Rnd().intFrom(fingerprint, 'base-level', 0, 7);
    const technical = buildAttributeGroup(PlayerModule.TECHNICAL_ATTRIBUTES, fingerprint, 'tech', baseLevel);
    const physical = buildAttributeGroup(PlayerModule.PHYSICAL_ATTRIBUTES, fingerprint, 'phys', baseLevel);
    const mental = buildAttributeGroup(PlayerModule.MENTAL_ATTRIBUTES, fingerprint, 'ment', baseLevel);

    const player = new PlayerModule.Player({
      id: `market-free-agent:${GENERATOR_VERSION}:${index}`,
      firstName,
      lastName,
      birthDate,
      positions,
      nominalPosition: primaryPosition,
      technical,
      physical,
      mental,
      hidden: {
        potential: 100 + Rnd().intFrom(fingerprint, 'potential', 0, 60),
        professionalism: Rnd().intFrom(fingerprint, 'professionalism', 4, 16),
        ambition: Rnd().intFrom(fingerprint, 'ambition', 4, 16),
        learningRate: Rnd().intFrom(fingerprint, 'learningRate', 4, 16),
        learningPersistence: Rnd().intFrom(fingerprint, 'learningPersistence', 4, 16),
      },
    });
    // Sección 14.1: badge/etiqueta visible — nunca un dato real presentado
    // como tal.
    player.dataSource = SIMULATED_FREE_AGENT_DATA_SOURCE;
    if (PlayerDevelopmentModule && PlayerDevelopmentModule.ensureDevelopmentState) {
      PlayerDevelopmentModule.ensureDevelopmentState(player, config, typeof referenceDate === 'string' ? LD().toJsDate(referenceDate) : referenceDate);
    }
    return player;
  }

  // Pool determinista e IDEMPOTENTE (por id fijo derivado del índice —
  // volver a llamar no duplica ni cambia los ya creados). Sección 14.1:
  // "no repongas el pool cada temporada" — quien llama decide CUÁNDO
  // invocarlo (una sola vez, en `startSeason()`).
  function seedFreeAgentPool(params) {
    const {
      playerRegistry, careerSeed, referenceDate, config, poolSize,
    } = params;
    if (!careerSeed) throw new Error('MarketSeeder.seedFreeAgentPool: falta "careerSeed" (determinismo).');
    const size = poolSize || DEFAULT_POOL_SIZE;
    const created = [];
    for (let i = 0; i < size; i += 1) {
      const id = `market-free-agent:${GENERATOR_VERSION}:${i}`;
      if (playerRegistry.has(id)) continue;
      const player = buildFreeAgent(i, { careerSeed, referenceDate, config });
      playerRegistry.register(player);
      created.push(player);
    }
    return created;
  }

  // ---------------------------------------------------------------------
  // Agentes y mandatos simulados (sección 14.2).
  // ---------------------------------------------------------------------
  function seedAgentsAndMandates(params) {
    const {
      playerRegistry, agentRegistry, careerSeed, referenceDate, players, selfRepresentedShare,
    } = params;
    if (!careerSeed) throw new Error('MarketSeeder.seedAgentsAndMandates: falta "careerSeed" (determinismo).');
    const iso = typeof referenceDate === 'string' ? referenceDate : LD().fromJsDate(referenceDate);
    const seasonKey = seasonKeyOf(iso);
    const selfShare = selfRepresentedShare !== undefined ? selfRepresentedShare : 0.35;

    // Menores de 18 NUNCA reciben captación simulada (sección 14.2).
    const eligible = players.filter((p) => PlayerModule.calculateAge(p.birthDate, LD().toJsDate(iso)) >= 18);

    // Cálculo determinista del número de agentes a partir del número de
    // representados — nunca una lista real raspada (sección 14.2).
    const agentCount = Math.max(1, Math.round(eligible.length / 6));
    const agents = [];
    for (let i = 0; i < agentCount; i += 1) {
      const fingerprint = `${careerSeed}|market-agent|${i}`;
      if (agentRegistry.getAgent(`market-agent:${GENERATOR_VERSION}:${i}`)) {
        agents.push(agentRegistry.getAgent(`market-agent:${GENERATOR_VERSION}:${i}`));
        continue;
      }
      const firstName = Rnd().pickFrom(fingerprint, 'first-name', FIRST_NAMES);
      const lastName = Rnd().pickFrom(fingerprint, 'last-name', LAST_NAMES);
      const licenseStart = LD().addDays(iso, -Rnd().intFrom(fingerprint, 'license-age-days', 0, 900));
      const agent = new AgentModule.Agent({
        id: `market-agent:${GENERATOR_VERSION}:${i}`,
        displayName: `${firstName} ${lastName}`,
        agencyName: Rnd().pickFrom(fingerprint, 'agency', AGENCY_NAMES),
        credentials: [{
          issuer: 'FIBA (simulado)',
          type: 'fiba-agent-license',
          identifier: null,
          validity: { startDate: licenseStart, endDate: LD().addDays(licenseStart, 365 * 4) },
        }],
        operatingRegions: ['ES'],
        languages: ['es'],
        provenance: {
          dataSource: SIMULATED_AGENT_DATA_SOURCE, isReal: false, generatorVersion: GENERATOR_VERSION, seedFingerprint: fingerprint,
        },
      });
      agentRegistry.registerAgent(agent);
      agents.push(agent);
    }

    let assignedCount = 0;
    eligible.forEach((player) => {
      const mandateId = `market-mandate:${GENERATOR_VERSION}:${player.id}`;
      if (agentRegistry.getMandate(mandateId)) { assignedCount += 1; return; }
      const fingerprint = `${careerSeed}|market-agent-assign|${player.id}`;
      const roll = Rnd().unitFrom(fingerprint, 'has-agent');
      if (roll < selfShare) return; // autorrepresentado
      const agent = Rnd().pickFrom(fingerprint, 'agent-pick', agents);
      const startDate = LD().addDays(iso, -Rnd().intFrom(fingerprint, 'mandate-age-days', 0, 540));
      // FIBA: mandato máximo 2 años (sección 6.1) — el seeder respeta el
      // límite desde el propio bootstrap, nunca genera uno inválido.
      const endDate = LD().addDays(startDate, 730);
      const mandate = new AgentModule.RepresentationMandate({
        id: mandateId,
        agentId: agent.id,
        clientType: 'player',
        clientId: player.id,
        scope: 'employment',
        exclusive: true,
        startDate,
        endDate,
        commissionBasisPoints: Rnd().intFrom(fingerprint, 'commission', 300, 1000),
        feePayerClientId: player.id,
        writtenContractDeclared: true,
        provenance: {
          dataSource: SIMULATED_MANDATE_DATA_SOURCE, isReal: false, generatorVersion: GENERATOR_VERSION, seedFingerprint: fingerprint,
        },
      });
      agentRegistry.registerMandate(mandate);
      assignedCount += 1;
    });

    return {
      agents, seasonKey, eligiblePlayers: eligible.length, playersWithAgent: assignedCount,
    };
  }

  const exportsObj = {
    MarketSeeder: {
      GENERATOR_VERSION,
      SIMULATED_FREE_AGENT_DATA_SOURCE,
      SIMULATED_AGENT_DATA_SOURCE,
      SIMULATED_MANDATE_DATA_SOURCE,
      DEFAULT_POOL_SIZE,
      seedFreeAgentPool,
      seedAgentsAndMandates,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
