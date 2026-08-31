// src/core/WorldFactory.js
// WORLD-CORE-1 — construcción e instalación de paquetes de un `GameWorld`.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Invariante 22 (DESIGN.md): si falla la creación del mundo, no debe quedar
// un `state.world` parcial utilizable. Este módulo no puede garantizar eso
// por sí solo (no deshace mutaciones a medio terminar dentro de un
// `manifest.install()` que falle a mitad de camino) — la garantía real está
// en CÓMO se usa desde `game.js`: construir siempre en una variable local y
// asignar `state.world` SOLO después de que `buildCareerWorld()` termine sin
// lanzar. Documentado aquí y respetado por `startSeason()`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const WorldModule = isNode ? require('../entities/World.js') : global.BasketManager;

  function GW() { return WorldModule.GameWorld; }

  function createWorld({
    id, name, careerSeed, createdAtGameDate,
  }) {
    return new (GW())({
      id, name, careerSeed, createdAtGameDate,
    });
  }

  // Instala un conjunto de manifiestos sobre `world`, en el orden DERIVADO
  // de sus dependencias (`ContentPackRegistry.computeInstallOrder`) — nunca
  // el orden accidental del array `manifests` (invariante 20). Idempotente:
  // un paquete ya instalado no se vuelve a instalar.
  function installContentPacks(world, manifests, context) {
    manifests.forEach((manifest) => world.registries.packs.registerManifest(manifest));
    const order = world.registries.packs.computeInstallOrder(manifests);
    order.forEach((manifest) => {
      if (world.registries.packs.isInstalled(manifest.id)) return;
      manifest.install(world, context || {});
      world.registries.packs.markInstalled(manifest);
    });
    return world;
  }

  // Punto de entrada de conveniencia usado por `game.js`/scripts de prueba:
  // crea el mundo e instala los paquetes de una tacada.
  function buildCareerWorld({
    id, name, careerSeed, createdAtGameDate, packs, context,
  }) {
    const world = createWorld({
      id, name, careerSeed, createdAtGameDate,
    });
    installContentPacks(world, packs || [], context);
    return world;
  }

  const exportsObj = { createWorld, installContentPacks, buildCareerWorld };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
