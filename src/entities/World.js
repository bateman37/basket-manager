// src/entities/World.js
// WORLD-CORE-1 — `GameWorld`: agregado raíz de una carrera. NO es un
// singleton, no lee el DOM ni variables globales — una carrera nueva
// construye su PROPIA instancia (mismo criterio que `PlayerRegistry`/
// `ContractRegistry` de ROSTER-1..CYCLE-1). `state.world` es la referencia
// canónica en la interfaz (`src/ui/game.js`). Convención del proyecto:
// identificadores en inglés, comentarios en español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const WorldRegistryModule = isNode ? require('../core/WorldRegistry.js') : global.BasketManager;

  function WR() { return WorldRegistryModule.WorldRegistries; }

  const SCHEMA_VERSION = '2026.1';

  // Nombres de los registros de dominio ya existentes (ROSTER-1..CYCLE-1)
  // que esta entrega ADJUNTA por identidad — nunca copia (sección 5.2 del
  // prompt: "las MISMAS instancias... nunca aliases que puedan
  // desincronizarse").
  const DOMAIN_REGISTRY_KEYS = [
    'playerRegistry',
    'contractRegistry',
    'registrationRegistry',
    'agentRegistry',
    'marketRegistry',
    'transferRegistry',
    'loanRegistry',
    'annualCycleRegistry',
    'academyRegistry',
    // NATIONAL-TEAMS-1 (DESIGN.md 10.17) — mismo patrón: instancia
    // EXPLÍCITA por carrera, adjuntada aquí por identidad, nunca copiada.
    'nationalTeamRegistry',
  ];

  class GameWorld {
    constructor(data = {}) {
      if (!data.id) throw new Error('GameWorld: falta "id".');
      if (!data.careerSeed) throw new Error('GameWorld: falta "careerSeed" explícito (nunca Math.random()/Date.now() implícitos).');
      this.id = data.id;
      this.name = data.name || 'Mundo de la carrera';
      this.careerSeed = data.careerSeed;
      this.createdAtGameDate = data.createdAtGameDate || null;
      this.schemaVersion = data.schemaVersion || SCHEMA_VERSION;

      // Registros canónicos de la nueva jerarquía mundial (áreas,
      // organizaciones, clubes, equipos, identidad de competición, paquetes).
      this.registries = new (WR())();

      // WORLD-CALENDAR-1 (DESIGN.md 10.14): el calendario de la carrera es
      // el `WorldCalendar` ÚNICO (`src/core/WorldCalendar.js`) — la MISMA
      // instancia que `state.calendar` (identidad estricta,
      // `state.calendar === state.world.calendar`, invariante 2) y la MISMA
      // durante TODA la carrera: el cambio de temporada ya no la sustituye
      // (invariante 3), solo registra la temporada nueva sobre ella. Antes
      // de esta entrega era un `Calendar` por temporada, reemplazado en
      // cada cierre.
      this.calendar = null;

      // Registros de dominio de ROSTER-1..CYCLE-1, adjuntados por
      // `attachDomainRegistries()` — inicialmente ausentes (se crean después
      // de construir el mundo, ver `WorldFactory`/`startSeason()`).
      this.domainRegistries = {};
      DOMAIN_REGISTRY_KEYS.forEach((key) => { this.domainRegistries[key] = null; });

      // WORLD-SIM-1 (DESIGN.md 10.16): perfil de simulación EXPLÍCITO de la
      // carrera (nunca del paquete de contenido) — decide qué `detailLevel`
      // congela cada `CompetitionEdition` nueva. `null` hasta que
      // `setSimulationProfile()` lo asigna, SIEMPRE antes de instalar
      // paquetes de contenido (que ya crean Editions durante `install()`).
      this.simulationProfile = null;
    }

    setCalendar(calendar) { this.calendar = calendar; }

    setSimulationProfile(profile) { this.simulationProfile = profile; }

    // Contadores DERIVADOS (nunca un segundo estado sincronizado a mano) de
    // Editions/Teams por nivel de detalle — usados por `describe()` para el
    // diagnóstico técnico de Home (10.6) y por los scripts de prueba. Un
    // Team con Entries en varias Editions de la MISMA temporada cuenta en
    // cada nivel que participe (no es "el nivel efectivo del Team", eso lo
    // resuelve `CompetitionSimulationService.effectiveDetailLevelForTeam()`).
    _simulationLevelCounters() {
      const editionsByLevel = {};
      const teamIdsByLevel = {};
      this.registries.competitionEditions.all().forEach((edition) => {
        const level = edition.detailLevel;
        editionsByLevel[level] = (editionsByLevel[level] || 0) + 1;
        if (!teamIdsByLevel[level]) teamIdsByLevel[level] = new Set();
        this.registries.competitionEntries.forEdition(edition.id).forEach((entry) => {
          teamIdsByLevel[level].add(entry.participantId);
        });
      });
      const teamsByLevel = {};
      Object.keys(teamIdsByLevel).forEach((level) => { teamsByLevel[level] = teamIdsByLevel[level].size; });
      return { editionsByLevel, teamsByLevel };
    }

    // Adjunta por IDENTIDAD (nunca copia) las instancias ya existentes de
    // los registros de dominio. Se puede llamar varias veces (cada cierre de
    // ciclo puede volver a adjuntar la misma instancia, o una nueva si algún
    // flujo la recreara) — siempre sobrescribe con la instancia recibida.
    attachDomainRegistries(registries) {
      DOMAIN_REGISTRY_KEYS.forEach((key) => {
        if (registries[key] !== undefined) this.domainRegistries[key] = registries[key];
      });
    }

    validateIntegrity() {
      return this.registries.validateIntegrity();
    }

    // Descripción serializable (invariante 27) — sin `Map`, funciones, DOM
    // ni referencias circulares. Usada por la interfaz mínima (sección 9 del
    // prompt) y por los scripts de prueba.
    describe() {
      return {
        id: this.id,
        name: this.name,
        careerSeed: this.careerSeed,
        createdAtGameDate: this.createdAtGameDate,
        schemaVersion: this.schemaVersion,
        // WORLD-SIM-1 (DESIGN.md 10.16): vista PLANA del perfil de
        // simulación + contadores — nunca runtimes vivos ni `Map`.
        simulationProfile: this.simulationProfile ? this.simulationProfile.toJSON() : null,
        simulationLevelCounters: this._simulationLevelCounters(),
        // NATIONAL-TEAMS-1 (DESIGN.md 10.17, sección 4.3 del prompt):
        // resumen PLANO del registro nacional — solo contadores, nunca el
        // volcado completo (que ya expone `nationalTeamRegistry.snapshot()`
        // para quien lo necesite explícitamente).
        nationalTeamRegistrySummary: this.domainRegistries.nationalTeamRegistry
          ? this.domainRegistries.nationalTeamRegistry.describe() : null,
        ...this.registries.describe(),
      };
    }
  }

  const exportsObj = { GameWorld, WORLD_SCHEMA_VERSION: SCHEMA_VERSION, DOMAIN_REGISTRY_KEYS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
