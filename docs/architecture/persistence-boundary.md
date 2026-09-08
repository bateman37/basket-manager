# Arquitectura — orquestación genérica y frontera de persistencia (WORLD-HARDEN-1)

_Migrado de `CLAUDE.md` (líneas 1449-1505 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### WORLD-HARDEN-1 (DESIGN.md 10.19) — orquestación genérica y frontera de persistencia

Convenciones permanentes de la novena entrega de World Architecture —
**entregada PARCIALMENTE** (ver DESIGN.md 10.19.2 para la lista exacta de
deuda pendiente; no asumir que la EPIC quedó 100 % cerrada). Aplican a
toda sesión futura que toque arranque/cierre de carrera, ciclo de vida de
paquetes de contenido, o la frontera de persistencia:

- Ningún dominio nuevo resuelve competición leyendo `Team.division`/
  `state.division`/nombre visible de liga — usa `competitionId`/
  `CompetitionParticipationService`/identidad mundial, o falla explícito.
  `competitionIdFromLegacyDivision()` YA NO tiene ningún call-site
  productivo (WORLD-CONTEXT-1 migró los nueve servicios; ver DESIGN.md
  10.20 y el bloque de convenciones de abajo): sigue exportado solo para
  fixtures históricos de `scripts/`, y su retirada definitiva es de
  WORLD-CLEANUP-1.
- Los paquetes de contenido POSEEN su contenido y sus hooks runtime
  (`manifest.hooks.registerFormats/registerSchedules/registerPathways/
  resolveEditionBindings`) — el core (`ContentPackLifecycleService.js`)
  SOLO orquesta: localiza al propietario de una competición por
  `manifest.provides`, nunca por nombre de paquete ni `if (id === 'spain-2026.1')`.
  `game.js` sigue siendo la única capa que sabe qué DOS paquetes existen
  (`data/world/content-pack-catalog.js`), y la única que conoce
  ACB/Primera FEB/Copa como literales de COMPETICIÓN (nunca de división)
  para resolver honores/facades de UI.
- `clubId` nunca significa `teamId` en código nuevo — la deuda de naming
  de `ClubCycleCase`/`RosterLegalityReport`/`EmergencyRosterAction`/
  `LastOfficialMatchEvidenceCollector` (desde CLUB-CORE-1/PATHWAYS-1) YA
  está resuelta en WORLD-CONTEXT-1 (DESIGN.md 10.20); la que sigue viva
  está enumerada allí (10.20.5) — no la agraves con un campo nuevo mal
  nombrado.
- Todo comando MATERIAL (instalar un paquete, abrir un transition group,
  registrar una temporada) recibe fecha/seed/id EXPLÍCITOS — nunca
  `new Date()`/`Math.random()` dentro del core. `ContentPackRegistry.
  markInstalled(manifest, installedAtGameDate)` es el patrón de referencia:
  parámetro explícito, sin fallback al reloj del proceso.
- Cada dato durable tiene UN owner/proyector — `CareerPersistenceBoundary.js`
  reutiliza el `.snapshot()`/`.toJSON()`/`.describe()` que YA expone cada
  registro de dominio (nunca reinventa qué campos son durables). Una
  colección durable nueva sin proyector debe añadirse a
  `CareerPersistenceBoundary.inventory()` Y a su `buildProjectors()` en el
  MISMO cambio — nunca queda declarada sin proyector (bloquea con
  diagnóstico si se detecta).
- `CareerPersistenceBoundary.js` es una SONDA de persistibilidad, no
  autoriza construir `saveCareer()`/`loadCareer()`/`fromJSON()` ni tocar
  `saves/` — eso sigue pendiente de una decisión explícita futura
  (DESIGN.md 10.7/10.9). Índices `Map`, resolvers, hooks de manifiesto,
  runners vivos de `CompetitionEngine` y view state de `game.js` son
  DERIVADOS/EFÍMEROS — nunca se declaran como una segunda copia durable.
- Pruebas nuevas de esta EPIC usan el world CANÓNICO
  (`GameWorld`+`CompetitionEngine`+`CompetitionPathwayService`+
  `AnnualCycleService`, patrón de `scripts/smoke-pathways1.js`/
  `scripts/audit-world-10-seasons.js`) — nunca revive el harness
  pre-World de `scripts/cycle1-harness.js` como fuente de verdad de
  competición/participación (sus utilidades de contratos/registro/ciclo
  siguen siendo reutilizables, su modelo de división NO).
