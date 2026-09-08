# Arquitectura — persistencia real de partidas (SAVE-LOAD-1)

Contrato VIGENTE de guardado/carga. La sección "WORLD-HARDEN-1" más abajo
es HISTÓRICA — `CareerPersistenceBoundary.js` dejó de ser una sonda y es
hoy el proyector canónico real, pero sus decisiones de diseño (envelope
plano, orden estable por id, fingerprint FNV-1a determinista) siguen
vigentes tal cual se describen ahí.

## Qué guarda una partida — dos envelopes anidados

- **Envelope de guardado** (`format: 'basket-manager-career-save'`,
  `schemaVersion: 1`) — construido en `src/ui/game.js`
  (`saveCareerToSlot()`): `{format, schemaVersion, slotId, revision,
  savedAtUtc, metadata, contentPacks, payload, fingerprint}`. `metadata`
  (`careerId, userTeamId, userClubId, teamName, clubName, seasonKey,
  gameDate, saveKind`) y `contentPacks` (`{id, version}`) son metadatos
  de ranura para listar partidas SIN hidratar nada. `fingerprint` cubre
  el objeto COMPLETO (incluido `payload`), calculado con
  `CareerPersistenceBoundary.computeFingerprint()` — el MISMO mecanismo
  que el envelope interno, nunca una segunda implementación.
- **`payload`** = el envelope que produce
  `CareerPersistenceBoundary.project(runtime, {snapshotAtGameDate})` —
  ver el resto de este documento para su forma exacta.

## Repositorio — `src/storage/IndexedDbCareerSaveRepository.js`

Único punto que toca IndexedDB (base `basket-manager`, store
`career-saves`, `keyPath: 'slotId'`, ranuras `manual-1`/`manual-2`/
`manual-3`/`autosave`). Cada escritura es UNA transacción `readwrite` con
un único `put()` — un fallo (cuota excedida, error de serialización)
aborta la transacción entera, así que la ranura anterior sobrevive
intacta (IndexedDB nunca deja un `put()` a medias). `game.js` nunca abre
una transacción ni conoce el nombre de la base de datos — solo llama a
`listSlots()`/`readSlot()`/`writeSlot()`/`deleteSlot()`.

## Hidratación — `src/core/CareerHydrationService.js`

Dos fases obligatorias:

1. **`hydrate(envelope, deps)`** reconstruye TODA la carrera en un
   runtime aislado — nunca toca `state`, nunca lee DOM/reloj de
   sistema/RNG propia. Si algo falla, lanza y no devuelve nada.
2. Solo cuando `hydrate()` devuelve con éxito, `game.js`
   (`loadCareerFromSlot()`) llama a `resetCareerState()` y asigna
   `state.*` de una sola vez (síncrono — el bucle de eventos de JS lo
   hace atómico).

Validaciones, en orden, ANTES de reconstruir ninguna entidad:
fingerprint del envelope completo (detecta corrupción/manipulación),
`format`/`schemaVersion` exactos (v1 es la única versión — el punto de
migración existe pero no hay ninguna migración real todavía), content
packs EXACTOS por `id`+`version` (nunca se llama a `manifest.install()`,
que regeneraría contenido nuevo — solo se registra el manifest y se marca
instalado con la fecha original).

Reconstrucción, en orden de dependencias, SIEMPRE vía el constructor
`(data = {})` propio de cada entidad (el mismo patrón de round-trip que
ya usaban `Team`/`Club`/`Squad`/`Player`/`Contract`/... antes de esta
Epic) + el método público `registerX()` del registro correspondiente —
nunca escritura directa de un campo interno `_xxx`:

1. `GameWorld` (identidad + perfil de simulación) + content packs
   (metadato de instalación, nunca `install()`) + catálogos estáticos de
   formato/calendario/pathway (`ContentPackLifecycleService.
   prepareCatalogs()`, puro, nunca toca el mundo).
2. `PlayerRegistry` — un `Player` por id, UNA sola vez.
3. `WorldRegistries` — áreas → organizaciones → clubes → equipos (`Team`
   completo vía la colección `teams`, SIN `roster`) → squads (resolviendo
   `playerIds` contra el `PlayerRegistry` ya lleno, y enlazando
   `team.squad`/`team.primarySquadId`) → definiciones → ediciones → (por
   cada edición, en el orden EXACTO de su propio `stageIds`/`entryIds`
   original — esos campos los reconstruye el propio registro al
   registrar cada stage/entry, así que el orden de registro debe
   reproducir el original o el fingerprint de una carga posterior no
   coincidiría con el de la anterior) → stages → entries → receipts de
   pathway/transición/simulación.
4. Registros de dominio profesional (contratos/inscripciones/agentes/
   mercado/traspasos/cesiones/ciclo anual/academia/selecciones
   nacionales) vía `exportState()`/`restoreState()` de cada uno (ver
   sección siguiente).
5. `WorldCalendar` — cursor + temporadas vía constructor/`registerSeason()`,
   items pendientes/ledger vía `restorePendingItems()`/`restoreLedger()`
   (siembra directa, NUNCA `syncSource()`, que crearía todo `'scheduled'`
   por defecto y perdería un item `awaiting-user`/`failed` ya conocido).
6. Runtime de competición — `CompetitionEngine.initializeEdition(id,
   {includeStatuses: ['active', 'completed']})` reconstruye cada runner
   con el MISMO código que una carrera nueva (determinista desde las
   Entries ya restauradas); después, cada partido YA jugado
   (`competitionRuntime[].playedMatches`) se reaplica con
   `resolveMatch(matchId, {silent: true, matchEngineOptions:
   {precomputedResult}})` — sin RNG (`precomputedResult` corta antes de
   simular) y sin repetir callbacks de pathway/noticias (esos efectos ya
   están en el resto del estado durable). El orden de reproducción
   importa para brackets (una ronda posterior no existe hasta que la
   anterior está decidida) — siempre `runner.
   listPlayedMatchesInReplayOrder()`, nunca un orden inventado.
7. Validaciones finales (`WorldRegistries.validateIntegrity()`,
   identidad de alias `world.domainRegistries.playerRegistry ===
   playerRegistry`, `world.calendar === calendar`) — solo si TODAS pasan
   se devuelve el runtime hidratado.

## Contrato `exportState()`/`restoreState()` de un registro de dominio

Varios `.snapshot()` de WORLD-HARDEN-1 eran deliberadamente RESÚMENES
diagnósticos (contadores o campos reducidos) — nunca contratos de
persistencia, confirmado contra el propio código, no solo el comentario
(ej. `ContractRegistry.snapshot()` daba solo
`{id, playerId, clubId, startDate, endDate}`, sin remuneración ni
cláusulas). `ContractRegistry`/`RegistrationRegistry`/`AgentRegistry`/
`MarketRegistry`/`TransferRegistry`/`AnnualCycleRegistry`/
`AcademyRegistry` ganan `exportState()` (cada colección primaria vía
`.toJSON()` de su entidad) + `restoreState(state, entities)` (reconstruye
por `new Entity(json)` + `registerX()`, en el orden de creación real del
dominio) — `snapshot()` NO cambia, conserva su significado diagnóstico.
`LoanRegistry`/`NationalTeamRegistry` ya eran lossless (`exportState()`
reexporta `snapshot()` tal cual). Los índices secundarios de cada
registro (`_byPlayer`, `_byClub`, índices de idempotencia...) son
DERIVADOS — se reconstruyen solos al volver a llamar a `registerX()`,
nunca se serializan aparte.

## Invariante central

```text
proyectar(A) → hidratar → proyectar(B)
```

debe producir igualdad canónica y el MISMO fingerprint — verificado en
`scripts/test-save-load1.js`. Una acción determinista aplicada al mismo
partido pendiente en A y en B (mismo `matchId`, mismo resultado ya
conocido) debe producir el mismo efecto observable sobre
standings/puntero.

## Puntos seguros de autoguardado

Exactamente tres checkpoints (`src/ui/game.js`, `autoSaveCareer()`, fire-
and-forget, nunca bloquea): fin del bootstrap de una carrera nueva
(`startCareerFromSetup()`), partido del usuario confirmado (ambos modos
`'live'`/`'replay'` de `renderMatchScreen()`), cierre de temporada
(`closeSeasonAndPrepareNext()`). El guardado manual/autoguardado se
bloquea (`CareerPersistenceBoundary.canSave()`/`describeSaveBlockers()`)
mientras `state.matchReveal` no es `null` (partido en pantalla sin
confirmar) — nunca se guarda un estado transitorio irreproducible.

## Qué NO cubre esta Epic

Backend/API remota/SQL, sincronización en la nube, cuentas de usuario,
import/export de JSON, compresión/cifrado, migraciones de schema reales
(el punto de entrada existe, v1 es la única versión), rediseño de
navegación. Ver `docs/epics/SAVE-LOAD-1.md` para la lista completa y los
follow-ups aceptados.

---

# Histórico — orquestación genérica y frontera de persistencia (WORLD-HARDEN-1)

_Migrado de `CLAUDE.md` (líneas 1449-1505 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original. SAVE-LOAD-1 (arriba) reemplaza la decisión de "no implementar guardado nuevo sin decisión explícita" — esa decisión ya se tomó y se ejecutó._

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
