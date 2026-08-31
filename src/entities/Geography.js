// src/entities/Geography.js
// WORLD-CORE-1 (DESIGN.md sección "World Architecture") — `GeographicArea`:
// pieza mínima de la jerarquía Mundo → Continente → País → Competiciones.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Principio rector: la geografía forma una jerarquía por `parentAreaId`
// explícito — nunca un árbol de objetos anidados copiados. El nombre visible
// nunca decide lógica (WORLD-CORE-1, ARCH-WORLD-08).

(function (global) {
  const AREA_TYPES = ['world', 'continent', 'country', 'territory', 'region'];
  const AREA_STATUSES = ['active', 'historical', 'fictional-test'];

  class GeographicArea {
    constructor(data = {}) {
      if (!data.id) throw new Error('GeographicArea: falta "id".');
      if (!AREA_TYPES.includes(data.type)) {
        throw new Error(`GeographicArea "${data.id}": type "${data.type}" no válido — debe ser una de ${AREA_TYPES.join(', ')}.`);
      }
      // Solo la raíz mundial puede carecer de padre.
      if (data.parentAreaId === undefined) {
        throw new Error(`GeographicArea "${data.id}": falta "parentAreaId" explícito (usa null solo para la raíz mundial).`);
      }
      if (data.parentAreaId === null && data.type !== 'world') {
        throw new Error(`GeographicArea "${data.id}": solo un área de type "world" puede tener parentAreaId null.`);
      }
      this.id = data.id;
      this.type = data.type;
      this.parentAreaId = data.parentAreaId;
      this.name = data.name || data.id;
      this.shortName = data.shortName || this.name;
      this.isoCode = data.isoCode || null;
      this.status = data.status || 'active';
      if (!AREA_STATUSES.includes(this.status)) {
        throw new Error(`GeographicArea "${data.id}": status "${this.status}" no válido — debe ser una de ${AREA_STATUSES.join(', ')}.`);
      }
      this.provenance = data.provenance || null;
    }

    toJSON() {
      return {
        id: this.id,
        type: this.type,
        parentAreaId: this.parentAreaId,
        name: this.name,
        shortName: this.shortName,
        isoCode: this.isoCode,
        status: this.status,
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = { GeographicArea, AREA_TYPES, AREA_STATUSES };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
