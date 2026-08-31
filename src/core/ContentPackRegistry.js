// src/core/ContentPackRegistry.js
// WORLD-CORE-1 — registro de paquetes de contenido instalados en un
// `GameWorld`. Un `ContentPackManifest` es dato de configuración (id,
// versión, dependencias, qué provee) — la instalación de verdad (crear
// áreas/organizaciones/clubes/equipos/competiciones) la ejecuta la propia
// función `manifest.install(world, context)` de cada paquete
// (`data/world/*.js`), nunca este registro. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Requisitos (sección 7/11 del prompt de WORLD-CORE-1): instalar debe fallar
// descriptivamente ante dependencia ausente, ciclo, id duplicado
// incompatible o referencia huérfana — nunca dejar un mundo parcialmente
// mutado (invariante 22, ver `WorldFactory.installContentPacks`).

(function (global) {
  function requireManifestShape(manifest) {
    if (!manifest || !manifest.id) throw new Error('ContentPackRegistry: el manifiesto no tiene "id".');
    if (!manifest.version) throw new Error(`ContentPackRegistry: el paquete "${manifest.id}" no declara "version".`);
    if (typeof manifest.install !== 'function') {
      throw new Error(`ContentPackRegistry: el paquete "${manifest.id}" no declara una función "install(world, context)".`);
    }
    return manifest;
  }

  function dependencyId(dep) {
    return typeof dep === 'string' ? dep : dep.id;
  }

  class ContentPackRegistry {
    constructor() {
      this._manifestsById = new Map();
      this._installedById = new Map(); // id -> { id, version, name, installedAt }
    }

    // Registra el MANIFIESTO (metadatos), sin instalar nada todavía. Un id
    // ya registrado con OTRA versión es un conflicto — nunca se sobrescribe
    // en silencio.
    registerManifest(manifest) {
      requireManifestShape(manifest);
      const existing = this._manifestsById.get(manifest.id);
      if (existing && existing !== manifest) {
        if (existing.version !== manifest.version) {
          throw new Error(
            `ContentPackRegistry: el paquete "${manifest.id}" ya está registrado con la versión `
            + `"${existing.version}" — no se puede volver a registrar con la versión "${manifest.version}".`,
          );
        }
        return existing;
      }
      this._manifestsById.set(manifest.id, manifest);
      return manifest;
    }

    getManifest(id) { return this._manifestsById.get(id) || null; }

    isInstalled(id) { return this._installedById.has(id); }

    installedManifest(id) { return this._installedById.get(id) || null; }

    // Solo llamado por `WorldFactory` tras ejecutar `manifest.install()` con
    // éxito — este registro nunca decide POR SÍ SOLO que algo quedó
    // instalado.
    markInstalled(manifest) {
      this._installedById.set(manifest.id, {
        id: manifest.id,
        version: manifest.version,
        name: manifest.name || manifest.id,
        installedAt: new Date().toISOString(),
      });
    }

    installedPacks() {
      // Orden canónico: orden de instalación real (Map preserva inserción).
      return [...this._installedById.values()];
    }

    // Orden de instalación DERIVADO de las dependencias declaradas — nunca
    // el orden accidental del array de entrada (invariante 20: instalar el
    // mismo conjunto de paquetes en cualquier orden de entrada produce el
    // mismo mundo final). Lanza ante dependencia ausente del conjunto o
    // ciclo, sin instalar nada todavía (esto es un cálculo puro).
    computeInstallOrder(manifests) {
      const byId = new Map(manifests.map((m) => [m.id, m]));
      const order = [];
      const visiting = new Set();
      const visited = new Set();

      function visit(manifest) {
        if (visited.has(manifest.id)) return;
        if (visiting.has(manifest.id)) {
          throw new Error(`ContentPackRegistry: dependencia circular detectada al instalar "${manifest.id}".`);
        }
        visiting.add(manifest.id);
        (manifest.dependencies || []).forEach((dep) => {
          const depId = dependencyId(dep);
          const depManifest = byId.get(depId);
          if (!depManifest) {
            throw new Error(
              `ContentPackRegistry: el paquete "${manifest.id}" depende de "${depId}", no incluido en esta `
              + 'instalación (ni ya instalado antes) — dependencia ausente.',
            );
          }
          visit(depManifest);
        });
        visiting.delete(manifest.id);
        visited.add(manifest.id);
        order.push(manifest);
      }

      manifests.forEach((manifest) => { requireManifestShape(manifest); visit(manifest); });
      return order;
    }
  }

  const exportsObj = { ContentPackRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
