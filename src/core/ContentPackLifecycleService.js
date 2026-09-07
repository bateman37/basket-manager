// src/core/ContentPackLifecycleService.js
// WORLD-HARDEN-1 (DESIGN.md 10.19) — servicio GENÉRICO que orquesta el
// ciclo de vida runtime de los paquetes de contenido ya SELECCIONADOS para
// una carrera (`ContentPackManifest.hooks`, opcionales). Antes de esta
// entrega `game.js` llamaba por NOMBRE a funciones de España
// (`BM.registerSpainSchedules()`, `BM.registerSpainPathways()`,
// `resolveEditionBindings: BM.resolveSpainEditionBindings`) — ese
// conocimiento pasa a vivir aquí, localizado SIEMPRE por
// `manifest.provides` (ownership), nunca por un nombre de paquete
// hardcodeado. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Reglas duras (sección 4 del prompt de WORLD-HARDEN-1):
//  - solo invoca hooks de los manifiestos YA seleccionados, en su orden
//    canónico de dependencias (el que ya trae `CareerSetupService.
//    buildStartPlan()`/`ContentPackRegistry.computeInstallOrder()` —
//    este servicio NO vuelve a calcular el orden, confía en el que recibe);
//  - encuentra al propietario de una Definition/competición vía
//    `manifest.provides`, nunca `if (competitionId === ACB)`;
//  - dos paquetes que declaren la misma competición en su `provides`, o
//    ninguno, bloquean con diagnóstico — nunca ACB/España por defecto;
//  - los hooks son RUNTIME y nunca se serializan (la persistencia solo
//    conserva `packId`+versión+procedencia, ver `CareerPersistenceBoundary.js`);
//  - preparar catálogos dos veces es idempotente (delega en la
//    idempotencia ya existente de `registerFormats`/`registerSchedules`/
//    `registerPathways` de cada paquete).

(function (global) {
  class ContentPackLifecycleService {
    constructor({ manifests } = {}) {
      // Manifiestos por defecto de esta instancia — SIEMPRE los ya resueltos
      // en orden de dependencias por el llamador (nunca recalculados aquí).
      this._manifests = manifests ? [...manifests] : [];
      this._preparedPackIds = new Set();
    }

    // -------------------------------------------------------------------
    // Preparación de catálogos ESTÁTICOS (formatos/schedules/pathways) —
    // ANTES de calcular el primer instante de la carrera (sección 4, primer
    // punto del contrato). Cada hook es opcional; un paquete sin
    // competiciones propias (World Core) simplemente no declara ninguno.
    // -------------------------------------------------------------------
    prepareCatalogs(manifests) {
      const list = manifests || this._manifests;
      list.forEach((manifest) => {
        const hooks = manifest.hooks || {};
        if (typeof hooks.registerFormats === 'function') hooks.registerFormats();
        if (typeof hooks.registerSchedules === 'function') hooks.registerSchedules();
        if (typeof hooks.registerPathways === 'function') hooks.registerPathways();
        this._preparedPackIds.add(manifest.id);
      });
      return { preparedPackIds: [...this._preparedPackIds] };
    }

    isPrepared(packId) { return this._preparedPackIds.has(packId); }

    // -------------------------------------------------------------------
    // Localiza el ÚNICO paquete que declara `value` en `provides[providesKey]`
    // — dos paquetes válidos, o ninguno, bloquean con diagnóstico (nunca se
    // elige "el primero" ni se hereda un paquete por defecto).
    // -------------------------------------------------------------------
    static findOwner(manifests, providesKey, value) {
      const owners = (manifests || []).filter((manifest) => {
        const provided = manifest.provides && manifest.provides[providesKey];
        return Array.isArray(provided) && provided.includes(value);
      });
      if (owners.length === 0) {
        throw new Error(
          `ContentPackLifecycleService: ningún paquete instalado declara "${value}" en `
          + `provides.${providesKey} — no hay propietario, nunca se asume ACB/España por defecto.`,
        );
      }
      if (owners.length > 1) {
        throw new Error(
          `ContentPackLifecycleService: más de un paquete (${owners.map((m) => m.id).join(', ')}) declara `
          + `"${value}" en provides.${providesKey} — conflicto de propiedad de contenido.`,
        );
      }
      return owners[0];
    }

    // -------------------------------------------------------------------
    // Bindings (formato/schedule/ruleset/pathways) de una Edition NUEVA cuya
    // Definition pertenece a un paquete instalado — reemplaza la llamada
    // directa a `BM.resolveSpainEditionBindings(competitionId, world)`.
    // -------------------------------------------------------------------
    resolveEditionBindings(manifests, competitionId, world) {
      const list = manifests || this._manifests;
      const owner = ContentPackLifecycleService.findOwner(list, 'competitionDefinitions', competitionId);
      const hook = owner.hooks && owner.hooks.resolveEditionBindings;
      if (typeof hook !== 'function') {
        throw new Error(`ContentPackLifecycleService: el paquete "${owner.id}" no declara hooks.resolveEditionBindings().`);
      }
      return hook(competitionId, world);
    }

    // -------------------------------------------------------------------
    // Dato crudo (bundle) de un club/equipo seleccionable por `teamId` —
    // localizado por el paquete que lo declara en `provides.clubs`. Uso
    // opcional: `CareerParticipantFactory` puede recibir ya el mapa
    // `rawTeamsById` construido por `game.js` (única capa que conoce el
    // bundle real, CLAUDE.md) sin pasar por aquí; este método existe para
    // cuando el paquete SOLO se identifica por ownership, sin bundle
    // preconstruido.
    // -------------------------------------------------------------------
    resolveClubRawDataOwner(manifests, teamId) {
      const list = manifests || this._manifests;
      return ContentPackLifecycleService.findOwner(list, 'clubs', teamId);
    }

    // -------------------------------------------------------------------
    // Une los `competitionSchedules` de TODOS los paquetes recibidos, sin
    // duplicados — reemplaza la lectura directa de `SPAIN_SCHEDULE_IDS` al
    // registrar una temporada (arranque Y cierre de ciclo).
    // -------------------------------------------------------------------
    static unionScheduleIds(manifests) {
      const ids = new Set();
      (manifests || []).forEach((manifest) => {
        ((manifest.provides && manifest.provides.competitionSchedules) || []).forEach((id) => ids.add(id));
      });
      return [...ids];
    }
  }

  const exportsObj = { ContentPackLifecycleService };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
