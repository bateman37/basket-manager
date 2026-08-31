// src/entities/Organization.js
// WORLD-CORE-1 — `Organization`: federación/operador de liga/organizador de
// torneo. NUNCA se asume que toda competición continental la organiza una
// federación continental, ni que todo operador de liga es una federación —
// `type` queda explícito por cada organización real. Convención del
// proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  const ORGANIZATION_TYPES = [
    'global-federation',
    'continental-federation',
    'national-federation',
    'league-operator',
    'tournament-organizer',
    'other',
  ];

  class Organization {
    constructor(data = {}) {
      if (!data.id) throw new Error('Organization: falta "id".');
      if (!ORGANIZATION_TYPES.includes(data.type)) {
        throw new Error(`Organization "${data.id}": type "${data.type}" no válido — debe ser una de ${ORGANIZATION_TYPES.join(', ')}.`);
      }
      if (!data.headquartersAreaId) {
        throw new Error(`Organization "${data.id}": falta "headquartersAreaId" explícito.`);
      }
      if (!data.scopeAreaId) {
        throw new Error(`Organization "${data.id}": falta "scopeAreaId" explícito.`);
      }
      this.id = data.id;
      this.name = data.name || data.id;
      this.type = data.type;
      this.headquartersAreaId = data.headquartersAreaId;
      this.parentOrganizationId = data.parentOrganizationId !== undefined ? data.parentOrganizationId : null;
      this.scopeAreaId = data.scopeAreaId;
      this.provenance = data.provenance || null;
    }

    toJSON() {
      return {
        id: this.id,
        name: this.name,
        type: this.type,
        headquartersAreaId: this.headquartersAreaId,
        parentOrganizationId: this.parentOrganizationId,
        scopeAreaId: this.scopeAreaId,
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = { Organization, ORGANIZATION_TYPES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
