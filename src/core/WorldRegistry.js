// src/core/WorldRegistry.js
// WORLD-CORE-1 — registros canónicos por carrera de la nueva jerarquía
// mundial: áreas, organizaciones, clubes, equipos y la identidad de
// competición (definiciones/ediciones/stages/entries). Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Cada registro es una instancia EXPLÍCITA por carrera (nunca un singleton
// oculto) — mismo criterio que `PlayerRegistry`/`ContractRegistry` de
// ROSTER-1..CYCLE-1. `WorldRegistries` es el agregado que expone las siete
// colecciones más el registro de paquetes (`ContentPackRegistry`) y las
// operaciones que mantienen sus relaciones consistentes (una edición nunca
// gana un stage sin que ese stage se registre TAMBIÉN aquí, así que
// `stageIds`/`entryIds` nunca pueden desincronizarse del registro real).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const ContentPackRegistryModule = isNode ? require('./ContentPackRegistry.js') : global.BasketManager;

  function CPR() { return ContentPackRegistryModule.ContentPackRegistry; }

  // ---------------------------------------------------------------------
  // Registro genérico por id — base interna reutilizada por cada colección
  // tipada de abajo (sección 7 del prompt: "puede existir una clase base
  // interna... pero cada API pública debe expresar su dominio").
  // ---------------------------------------------------------------------
  class BaseRegistry {
    constructor(label) {
      this._label = label;
      this._byId = new Map();
    }

    register(entity) {
      if (!entity || !entity.id) {
        throw new Error(`${this._label}.register: la entidad no tiene "id".`);
      }
      const existing = this._byId.get(entity.id);
      if (existing && existing !== entity) {
        throw new Error(`${this._label}: id duplicado incompatible "${entity.id}" (ya registrado con otra instancia).`);
      }
      this._byId.set(entity.id, entity);
      return entity;
    }

    has(id) { return this._byId.has(id); }

    get(id) { return this._byId.has(id) ? this._byId.get(id) : null; }

    require(id) {
      const found = this.get(id);
      if (!found) throw new Error(`${this._label}: id desconocido "${id}".`);
      return found;
    }

    // Orden canónico = orden de inserción (Map lo preserva) — determinista,
    // nunca depende de iterar un objeto plano. Copia nueva: mutar el array
    // devuelto nunca puede desincronizar el índice interno.
    all() { return [...this._byId.values()]; }

    get size() { return this._byId.size; }
  }

  class AreaRegistry extends BaseRegistry {
    constructor() { super('AreaRegistry'); }

    // Invariantes 1-2 (DESIGN.md): exactamente una raíz `world`, todo padre
    // existe, sin ciclos.
    validateHierarchy() {
      const errors = [];
      const roots = this.all().filter((area) => area.parentAreaId === null);
      if (roots.length !== 1) {
        errors.push(`AreaRegistry: debe haber exactamente 1 área raíz (parentAreaId null) — encontradas ${roots.length}.`);
      }
      roots.forEach((root) => {
        if (root.type !== 'world') {
          errors.push(`AreaRegistry: el área raíz "${root.id}" debe ser de type "world" (es "${root.type}").`);
        }
      });
      this.all().forEach((area) => {
        if (area.parentAreaId !== null && !this.has(area.parentAreaId)) {
          errors.push(`AreaRegistry: el área "${area.id}" referencia un padre inexistente "${area.parentAreaId}".`);
        }
      });
      this.all().forEach((area) => {
        const seen = new Set();
        let cursor = area;
        while (cursor && cursor.parentAreaId !== null) {
          if (seen.has(cursor.id)) {
            errors.push(`AreaRegistry: ciclo detectado en la jerarquía de áreas que incluye "${area.id}".`);
            break;
          }
          seen.add(cursor.id);
          cursor = this.get(cursor.parentAreaId);
        }
      });
      return errors;
    }
  }

  class OrganizationRegistry extends BaseRegistry {
    constructor() { super('OrganizationRegistry'); }
  }

  class ClubRegistry extends BaseRegistry {
    constructor() { super('ClubRegistry'); }
  }

  // Envuelve instancias REALES de `Team` (nunca objetos planos) — mismo
  // criterio que `PlayerRegistry` con `Player` (ROSTER-1, DESIGN.md 9.16).
  class TeamRegistry extends BaseRegistry {
    constructor() { super('TeamRegistry'); }

    forClub(clubId) { return this.all().filter((team) => team.clubId === clubId); }
  }

  // Referencias a `CompetitionDefinition` del catálogo mundial
  // (`CompetitionCatalog.js`) — nunca copias (ARCH-WORLD-04).
  class CompetitionDefinitionRegistry extends BaseRegistry {
    constructor() { super('CompetitionDefinitionRegistry'); }
  }

  class CompetitionEditionRegistry extends BaseRegistry {
    constructor() { super('CompetitionEditionRegistry'); }

    forDefinition(competitionDefinitionId) {
      return this.all().filter((edition) => edition.competitionDefinitionId === competitionDefinitionId);
    }

    forSeason(seasonKey) {
      return this.all().filter((edition) => edition.seasonKey === seasonKey);
    }
  }

  class CompetitionStageRegistry extends BaseRegistry {
    constructor() { super('CompetitionStageRegistry'); }

    forEdition(editionId) { return this.all().filter((stage) => stage.editionId === editionId); }
  }

  class CompetitionEntryRegistry extends BaseRegistry {
    constructor() { super('CompetitionEntryRegistry'); }

    forEdition(editionId) { return this.all().filter((entry) => entry.editionId === editionId); }

    forStage(stageId) { return this.all().filter((entry) => entry.stageId === stageId); }

    // Invariante 7: un participante (equipo/selección) puede tener entries
    // simultáneas en varias competiciones — se consulta así, nunca desde
    // `Team.division`.
    forParticipant(participantId) { return this.all().filter((entry) => entry.participantId === participantId); }
  }

  // ---------------------------------------------------------------------
  // Agregado — las operaciones que cruzan colecciones (validar referencias,
  // mantener `stageIds`/`entryIds` de una edición sincronizados) viven aquí,
  // nunca repartidas por quien las llama.
  // ---------------------------------------------------------------------
  class WorldRegistries {
    constructor() {
      this.areas = new AreaRegistry();
      this.organizations = new OrganizationRegistry();
      this.clubs = new ClubRegistry();
      this.teams = new TeamRegistry();
      this.competitionDefinitions = new CompetitionDefinitionRegistry();
      this.competitionEditions = new CompetitionEditionRegistry();
      this.competitionStages = new CompetitionStageRegistry();
      this.competitionEntries = new CompetitionEntryRegistry();
      this.packs = new (CPR())();
    }

    registerArea(area) { return this.areas.register(area); }

    registerOrganization(organization) {
      if (!this.areas.has(organization.headquartersAreaId)) {
        throw new Error(`WorldRegistries: la organización "${organization.id}" referencia una sede inexistente "${organization.headquartersAreaId}".`);
      }
      if (!this.areas.has(organization.scopeAreaId)) {
        throw new Error(`WorldRegistries: la organización "${organization.id}" referencia un ámbito inexistente "${organization.scopeAreaId}".`);
      }
      if (organization.parentOrganizationId && !this.organizations.has(organization.parentOrganizationId)) {
        throw new Error(`WorldRegistries: la organización "${organization.id}" referencia una organización superior inexistente "${organization.parentOrganizationId}".`);
      }
      return this.organizations.register(organization);
    }

    registerClub(club) {
      if (!this.areas.has(club.homeAreaId)) {
        throw new Error(`WorldRegistries: el club "${club.id}" referencia un área de origen inexistente "${club.homeAreaId}".`);
      }
      if (!this.areas.has(club.employerJurisdictionAreaId)) {
        throw new Error(`WorldRegistries: el club "${club.id}" referencia una jurisdicción laboral inexistente "${club.employerJurisdictionAreaId}".`);
      }
      club.federationMembershipOrganizationIds.forEach((orgId) => {
        if (!this.organizations.has(orgId)) {
          throw new Error(`WorldRegistries: el club "${club.id}" referencia una organización de afiliación inexistente "${orgId}".`);
        }
      });
      return this.clubs.register(club);
    }

    // `team` es la instancia REAL ya construida (invariante 16) — este
    // método solo la registra, nunca la reconstruye. Requiere que
    // `team.clubId` ya apunte a un club existente.
    registerTeam(team) {
      if (!team.clubId) {
        throw new Error(`WorldRegistries: el equipo "${team.id}" no tiene "clubId" — asígnalo antes de registrar.`);
      }
      const club = this.clubs.require(team.clubId);
      if (!club) throw new Error(`WorldRegistries: el equipo "${team.id}" referencia un club inexistente "${team.clubId}".`);
      return this.teams.register(team);
    }

    registerCompetitionDefinition(definition) {
      if (definition.scopeAreaId !== null && !this.areas.has(definition.scopeAreaId)) {
        throw new Error(`WorldRegistries: la competición "${definition.id}" referencia un área de ámbito inexistente "${definition.scopeAreaId}".`);
      }
      return this.competitionDefinitions.register(definition);
    }

    registerCompetitionEdition(edition) {
      if (!this.competitionDefinitions.has(edition.competitionDefinitionId)) {
        throw new Error(`WorldRegistries: la edición "${edition.id}" referencia una competición inexistente "${edition.competitionDefinitionId}".`);
      }
      return this.competitionEditions.register(edition);
    }

    // Único punto que añade un stage a una edición — `edition.stageIds`
    // nunca se empuja desde otro sitio (evita la desincronización que
    // describe la cabecera del archivo).
    registerCompetitionStage(stage) {
      const edition = this.competitionEditions.require(stage.editionId);
      this.competitionStages.register(stage);
      if (!edition.stageIds.includes(stage.id)) edition.stageIds.push(stage.id);
      return stage;
    }

    // Único punto que añade un entry a una edición (y, si declara stage, a
    // ese stage) — invariante 12: participante compatible con
    // `participantType` de la definición de la edición.
    registerCompetitionEntry(entry) {
      const edition = this.competitionEditions.require(entry.editionId);
      const definition = this.competitionDefinitions.require(edition.competitionDefinitionId);
      if (entry.participantType !== definition.participantType) {
        throw new Error(
          `WorldRegistries: el entry "${entry.id}" declara participantType "${entry.participantType}", pero la `
          + `competición "${definition.id}" es de participantType "${definition.participantType}".`,
        );
      }
      if (entry.stageId) this.competitionStages.require(entry.stageId);
      this.competitionEntries.register(entry);
      if (!edition.entryIds.includes(entry.id)) edition.entryIds.push(entry.id);
      if (entry.stageId) {
        const stage = this.competitionStages.get(entry.stageId);
        if (!stage.entryIds.includes(entry.id)) stage.entryIds.push(entry.id);
      }
      return entry;
    }

    // Agrega TODOS los errores de todas las colecciones — nunca lanza en el
    // primero, para que un diagnóstico muestre el mundo completo de una vez.
    validateIntegrity() {
      const errors = [...this.areas.validateHierarchy()];
      this.organizations.all().forEach((organization) => {
        if (!this.areas.has(organization.headquartersAreaId)) errors.push(`Organización "${organization.id}": sede inexistente "${organization.headquartersAreaId}".`);
        if (!this.areas.has(organization.scopeAreaId)) errors.push(`Organización "${organization.id}": ámbito inexistente "${organization.scopeAreaId}".`);
      });
      this.clubs.all().forEach((club) => {
        if (!this.areas.has(club.homeAreaId)) errors.push(`Club "${club.id}": área de origen inexistente "${club.homeAreaId}".`);
        if (!this.areas.has(club.employerJurisdictionAreaId)) errors.push(`Club "${club.id}": jurisdicción laboral inexistente "${club.employerJurisdictionAreaId}".`);
        if (club.primaryTeamId && !this.teams.has(club.primaryTeamId)) errors.push(`Club "${club.id}": primaryTeamId inexistente "${club.primaryTeamId}".`);
      });
      this.teams.all().forEach((team) => {
        if (!team.clubId || !this.clubs.has(team.clubId)) errors.push(`Equipo "${team.id}": club inexistente "${team.clubId}".`);
      });
      this.competitionEditions.all().forEach((edition) => {
        if (!this.competitionDefinitions.has(edition.competitionDefinitionId)) {
          errors.push(`Edición "${edition.id}": competición inexistente "${edition.competitionDefinitionId}".`);
        }
      });
      this.competitionStages.all().forEach((stage) => {
        if (!this.competitionEditions.has(stage.editionId)) errors.push(`Stage "${stage.id}": edición inexistente "${stage.editionId}".`);
      });
      this.competitionEntries.all().forEach((entry) => {
        if (!this.competitionEditions.has(entry.editionId)) errors.push(`Entry "${entry.id}": edición inexistente "${entry.editionId}".`);
        if (entry.participantType === 'club-team' && !this.teams.has(entry.participantId)) {
          errors.push(`Entry "${entry.id}": equipo inexistente "${entry.participantId}".`);
        }
      });
      return errors;
    }

    // Snapshot serializable (invariante 27) — Mundo > Continente > País,
    // paquetes instalados. Usado por la interfaz mínima (sección 9 del
    // prompt) y por los scripts de prueba.
    describe() {
      return {
        packs: this.packs.installedPacks(),
        areas: this.areas.all().map((a) => a.toJSON()),
        organizations: this.organizations.all().map((o) => o.toJSON()),
        clubs: this.clubs.all().map((c) => c.toJSON()),
        teamIds: this.teams.all().map((t) => t.id),
        competitionDefinitions: this.competitionDefinitions.all().map((d) => d.toJSON()),
        competitionEditions: this.competitionEditions.all().map((e) => e.toJSON()),
        competitionStages: this.competitionStages.all().map((s) => s.toJSON()),
        competitionEntries: this.competitionEntries.all().map((e) => e.toJSON()),
      };
    }
  }

  const exportsObj = {
    WorldRegistries,
    AreaRegistry,
    OrganizationRegistry,
    ClubRegistry,
    TeamRegistry,
    CompetitionDefinitionRegistry,
    CompetitionEditionRegistry,
    CompetitionStageRegistry,
    CompetitionEntryRegistry,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
