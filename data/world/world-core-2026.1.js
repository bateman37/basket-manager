// data/world/world-core-2026.1.js
// WORLD-CORE-1 — paquete de contenido raíz: solo el esqueleto geográfico
// mínimo que cualquier otro paquete necesita para referenciar un área
// (Mundo, Europa). NO inventa todo el mapa mundial ni clubes/selecciones que
// todavía no existen (sección 6 del prompt de WORLD-CORE-1). Convención del
// proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const GeographyModule = isNode ? require('../../src/entities/Geography.js') : global.BasketManager;

  function Geo() { return GeographyModule; }

  const MANIFEST_ID = 'world-core-2026.1';

  // IDs de área estables — otros paquetes (`spain-2026.1`) los referencian
  // por este literal (documentado también en `CompetitionCatalog.js`).
  const AREA_IDS = {
    WORLD: 'area-world',
    EUROPE: 'area-continent-europe',
  };

  function install(world) {
    world.registries.registerArea(new (Geo().GeographicArea)({
      id: AREA_IDS.WORLD,
      type: 'world',
      parentAreaId: null,
      name: 'Mundo',
      status: 'active',
      provenance: { dataSource: MANIFEST_ID, status: 'verified' },
    }));
    world.registries.registerArea(new (Geo().GeographicArea)({
      id: AREA_IDS.EUROPE,
      type: 'continent',
      parentAreaId: AREA_IDS.WORLD,
      name: 'Europa',
      shortName: 'Europa',
      status: 'active',
      provenance: { dataSource: MANIFEST_ID, status: 'verified' },
    }));
  }

  const WORLD_CORE_MANIFEST = {
    id: MANIFEST_ID,
    version: '2026.1.0',
    name: 'World Core',
    status: 'active',
    dependencies: [],
    provides: { areas: [AREA_IDS.WORLD, AREA_IDS.EUROPE], organizations: [] },
    dataSource: MANIFEST_ID,
    provenance: { status: 'verified' },
    install,
  };

  const exportsObj = { WORLD_CORE_MANIFEST, WORLD_CORE_AREA_IDS: AREA_IDS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
