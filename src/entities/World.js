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

      // Referencia al calendario de la carrera (`Calendar`, ya existente) —
      // la MISMA instancia que `state.calendar`, actualizada vía
      // `setCalendar()` cada vez que game.js crea un `Calendar` nuevo
      // (arranque de carrera, cierre de temporada).
      this.calendar = null;

      // Registros de dominio de ROSTER-1..CYCLE-1, adjuntados por
      // `attachDomainRegistries()` — inicialmente ausentes (se crean después
      // de construir el mundo, ver `WorldFactory`/`startSeason()`).
      this.domainRegistries = {};
      DOMAIN_REGISTRY_KEYS.forEach((key) => { this.domainRegistries[key] = null; });
    }

    setCalendar(calendar) { this.calendar = calendar; }

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
