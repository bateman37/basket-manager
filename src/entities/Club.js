// src/entities/Club.js
// WORLD-CORE-1 (ARCH-WORLD-07) — `Club`: identidad institucional, separada
// del equipo deportivo (`Team`). Esta entrega SOLO introduce la identidad y
// el vínculo `Club` <-> `Team`; finanzas, instalaciones, junta, afición y
// táctica SIGUEN viviendo en `Team` — su migración completa es CLUB-CORE-1
// (ver DESIGN.md). Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Decisión de compatibilidad de `spain-2026.1` (documentada, no invariante
// universal): `club.id === primaryTeam.id` para preservar todos los
// `clubId` legacy ya usados por CONTRACT-1/REG-1/MARKET-1/TRANSFER-1/
// LOAN-1/CYCLE-1 (`ClubEmploymentContextCatalog`, `ContractRegistry`, etc.).
// Un paquete de contenido futuro con varios equipos por club NO tiene por
// qué mantener esa igualdad.

(function (global) {
  const CLUB_STATUSES = ['active', 'inactive', 'historical', 'fictional-test'];

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
      // en esta entrega (WORLD-CORE-1 deja el modelo listo para varios
      // equipos por club, pero no lo implementa: ver DESIGN.md, invariante 6).
      this.primaryTeamId = data.primaryTeamId || null;
      this.status = data.status || 'active';
      if (!CLUB_STATUSES.includes(this.status)) {
        throw new Error(`Club "${data.id}": status "${this.status}" no válido — debe ser una de ${CLUB_STATUSES.join(', ')}.`);
      }
      this.dataSource = data.dataSource || null;
      this.provenance = data.provenance || null;
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
      };
    }
  }

  const exportsObj = { Club, CLUB_STATUSES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
