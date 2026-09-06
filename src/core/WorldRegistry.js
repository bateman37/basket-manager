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

  // CLUB-CORE-1 (DESIGN.md sección 10) — envuelve instancias REALES de
  // `Squad` (nunca objetos planos), mismo criterio que `TeamRegistry`.
  class SquadRegistry extends BaseRegistry {
    constructor() { super('SquadRegistry'); }

    forTeam(teamId) { return this.all().filter((squad) => squad.teamId === teamId); }

    // Un equipo activo tiene exactamente un squad operativo activo en esta
    // versión (invariante 7 del prompt de CLUB-CORE-1) — `null` si el
    // equipo todavía no tiene ninguno.
    activeForTeam(teamId) {
      return this.forTeam(teamId).find((squad) => squad.status === 'active') || null;
    }

    // Squad ACTIVO que contiene actualmente a un jugador concreto — un
    // Player aparece como máximo en un squad activo del mundo (invariante 8).
    activeSquadForPlayer(playerId) {
      return this.all().find((squad) => squad.status === 'active' && squad.hasPlayer(playerId)) || null;
    }
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
      this.squads = new SquadRegistry();
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

    // CLUB-CORE-1 — `squad` es la instancia REAL ya construida (invariante
    // 26, mismas instancias que el runtime de partidos). Protege aquí,
    // ANTES de registrar, las dos unicidades que Squad no puede comprobar
    // por sí solo (no conoce a los demás squads del mundo): un squad activo
    // por equipo (invariante 7) y un jugador en como máximo un squad activo
    // de TODO el mundo (invariante 8) — nunca repartidas por quien llama.
    registerSquad(squad) {
      this.teams.require(squad.teamId);
      if (squad.status === 'active') {
        const existingActive = this.squads.forTeam(squad.teamId).find((s) => s.status === 'active' && s.id !== squad.id);
        if (existingActive) {
          throw new Error(
            `WorldRegistries: el equipo "${squad.teamId}" ya tiene un squad activo "${existingActive.id}" — `
            + `no puede registrarse también "${squad.id}" como activo.`,
          );
        }
        squad.players.forEach((player) => {
          const already = this.squads.all().find((s) => s.status === 'active' && s.id !== squad.id && s.hasPlayer(player.id));
          if (already) {
            throw new Error(
              `WorldRegistries: el jugador "${player.id}" ya está en el squad activo "${already.id}" — no puede `
              + `estar también en "${squad.id}".`,
            );
          }
        });
      }
      return this.squads.register(squad);
    }

    // BUG-COMPCORE-01 (COMP-CORE-1): invariante 9 (DESIGN.md) — toda
    // definición referencia un organizador EXISTENTE. Antes de esta
    // corrección, `registerCompetitionDefinition()` no lo comprobaba.
    registerCompetitionDefinition(definition) {
      if (definition.scopeAreaId !== null && !this.areas.has(definition.scopeAreaId)) {
        throw new Error(`WorldRegistries: la competición "${definition.id}" referencia un área de ámbito inexistente "${definition.scopeAreaId}".`);
      }
      if (!this.organizations.has(definition.organizerId)) {
        throw new Error(`WorldRegistries: la competición "${definition.id}" referencia un organizador inexistente "${definition.organizerId}".`);
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
    //
    // BUG-COMPCORE-01: `sourceStageIds`/`nextStageIds` solo pueden conectar
    // stages de la MISMA edición (invariante 4) — se comprueba aquí contra
    // cualquier stage YA registrado que referencien (un id que todavía no
    // existe se revalida en `validateIntegrity()`, que recorre el grafo
    // completo una vez todo está registrado).
    registerCompetitionStage(stage) {
      const edition = this.competitionEditions.require(stage.editionId);
      [...stage.sourceStageIds, ...stage.nextStageIds].forEach((referencedId) => {
        const referenced = this.competitionStages.get(referencedId);
        if (referenced && referenced.editionId !== stage.editionId) {
          throw new Error(
            `WorldRegistries: el stage "${stage.id}" (edición "${stage.editionId}") referencia en `
            + `sourceStageIds/nextStageIds el stage "${referencedId}" de OTRA edición ("${referenced.editionId}") `
            + '— solo pueden conectar stages de la MISMA edición (invariante 4).',
          );
        }
      });
      this.competitionStages.register(stage);
      if (!edition.stageIds.includes(stage.id)) edition.stageIds.push(stage.id);
      return stage;
    }

    // Único punto que añade un entry a una edición (y, si declara stage, a
    // ese stage) — invariante 12: participante compatible con
    // `participantType` de la definición de la edición.
    //
    // BUG-COMPCORE-01: además de que el Stage EXISTA, se comprueba que
    // pertenezca a la MISMA edición que declara el Entry (invariante 5) —
    // antes de esta corrección era posible registrar un Entry en la
    // edición B apuntando a un Stage de la edición A.
    registerCompetitionEntry(entry) {
      const edition = this.competitionEditions.require(entry.editionId);
      const definition = this.competitionDefinitions.require(edition.competitionDefinitionId);
      if (entry.participantType !== definition.participantType) {
        throw new Error(
          `WorldRegistries: el entry "${entry.id}" declara participantType "${entry.participantType}", pero la `
          + `competición "${definition.id}" es de participantType "${definition.participantType}".`,
        );
      }
      if (entry.stageId) {
        const stage = this.competitionStages.require(entry.stageId);
        if (stage.editionId !== entry.editionId) {
          throw new Error(
            `WorldRegistries: el entry "${entry.id}" declara editionId "${entry.editionId}" pero su stage `
            + `"${entry.stageId}" pertenece a la edición "${stage.editionId}" — un Entry no puede registrarse en `
            + 'el Stage de OTRA edición (invariante 5).',
          );
        }
      }
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
        if (team.primarySquadId && !this.squads.has(team.primarySquadId)) {
          errors.push(`Equipo "${team.id}": primarySquadId inexistente "${team.primarySquadId}".`);
        }
      });
      // CLUB-CORE-1 — mismas dos unicidades que `registerSquad()` ya evita
      // al registrar, revalidadas aquí de forma agregada (un squad podría,
      // en teoría, mutar su `status` después de registrado).
      const activeSquadsByTeam = new Map();
      const activeSquadByPlayer = new Map();
      this.squads.all().forEach((squad) => {
        if (!this.teams.has(squad.teamId)) errors.push(`Squad "${squad.id}": equipo inexistente "${squad.teamId}".`);
        if (squad.status !== 'active') return;
        const existing = activeSquadsByTeam.get(squad.teamId);
        if (existing && existing !== squad.id) {
          errors.push(`Equipo "${squad.teamId}": más de un squad activo ("${existing}" y "${squad.id}").`);
        }
        activeSquadsByTeam.set(squad.teamId, squad.id);
        squad.players.forEach((player) => {
          const already = activeSquadByPlayer.get(player.id);
          if (already && already !== squad.id) {
            errors.push(`Jugador "${player.id}": presente en más de un squad activo ("${already}" y "${squad.id}").`);
          }
          activeSquadByPlayer.set(player.id, squad.id);
        });
      });
      this.competitionEditions.all().forEach((edition) => {
        if (!this.competitionDefinitions.has(edition.competitionDefinitionId)) {
          errors.push(`Edición "${edition.id}": competición inexistente "${edition.competitionDefinitionId}".`);
        }
      });
      this.competitionStages.all().forEach((stage) => {
        if (!this.competitionEditions.has(stage.editionId)) errors.push(`Stage "${stage.id}": edición inexistente "${stage.editionId}".`);
        // BUG-COMPCORE-01: auditoría AGREGADA de sourceStageIds/nextStageIds
        // (invariante 4) — cubre también referencias hacia adelante que
        // todavía no existían cuando se registró el stage.
        [...stage.sourceStageIds, ...stage.nextStageIds].forEach((refId) => {
          const referenced = this.competitionStages.get(refId);
          if (!referenced) { errors.push(`Stage "${stage.id}": sourceStageIds/nextStageIds referencia un stage inexistente "${refId}".`); return; }
          if (referenced.editionId !== stage.editionId) {
            errors.push(`Stage "${stage.id}": sourceStageIds/nextStageIds referencia el stage "${refId}" de OTRA edición ("${referenced.editionId}").`);
          }
        });
      });
      // BUG-COMPCORE-01: sourceStageIds/nextStageIds no pueden formar un
      // ciclo dentro de una misma edición (invariante 4) — DFS por el grafo
      // de "siguiente stage" (nextStageIds), con el set "en la pila actual"
      // (no un "ya visto" global, que daría falsos positivos ante nodos
      // convergentes que no son un ciclo real).
      const cyclicStageIds = new Set();
      const stagesById = this.competitionStages;
      this.competitionStages.all().forEach((startStage) => {
        const inCurrentPath = new Set();
        const visitedFromHere = new Set();
        const dfs = (id) => {
          if (inCurrentPath.has(id)) return true;
          if (visitedFromHere.has(id)) return false;
          visitedFromHere.add(id);
          inCurrentPath.add(id);
          const current = stagesById.get(id);
          const cyclic = current ? current.nextStageIds.some((nextId) => dfs(nextId)) : false;
          inCurrentPath.delete(id);
          return cyclic;
        };
        if (dfs(startStage.id) && !cyclicStageIds.has(startStage.id)) {
          cyclicStageIds.add(startStage.id);
          errors.push(`Stage "${startStage.id}": ciclo detectado en sourceStageIds/nextStageIds.`);
        }
      });
      this.competitionEntries.all().forEach((entry) => {
        if (!this.competitionEditions.has(entry.editionId)) errors.push(`Entry "${entry.id}": edición inexistente "${entry.editionId}".`);
        if (entry.stageId) {
          const stage = this.competitionStages.get(entry.stageId);
          if (stage && stage.editionId !== entry.editionId) {
            errors.push(`Entry "${entry.id}": su stage "${entry.stageId}" pertenece a la edición "${stage.editionId}", no a "${entry.editionId}".`);
          }
        }
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
        squads: this.squads.all().map((s) => s.toJSON()),
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
    SquadRegistry,
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
