# Ficha de Epic — WORLD-HARDEN-1 (orquestación genérica y frontera de persistencia)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `WORLD-HARDEN-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Orquestación genérica de arranque/cierre y frontera de persistencia (entregada parcialmente).
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/persistence-boundary.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 9915-10172 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.19 WORLD-HARDEN-1 — resultado (parcial, deuda explícita)

Novena entrega de la EPIC. Base: merge de la PR de WORLD-UI-1 en
`origin/main` (`38049ca`). Rama `claude/modest-gauss-ab8bat`. **Esta
sesión implementó un subconjunto verificado del prompt completo de
WORLD-HARDEN-1** — cierra los puentes de mayor riesgo arquitectónico real
(arranque/cierre de temporada de `game.js` llamando a España por nombre) y
dos entregables nuevos completos (auditoría de diez temporadas, frontera
de persistencia), pero NO completa toda la limpieza legacy que el prompt
original pedía (sección 6 y parte de la 7/8/9/13) — ver "Deuda explícita
NO resuelta" más abajo. **World Architecture NO se declara cerrada al
100 %** por esta sesión; queda una lista de trabajo concreta para la
siguiente.

#### 10.19.1 Lo que SÍ quedó implementado y verificado

- **`ContentPackLifecycleService.js`** (`src/core/`) — orquesta
  `prepareCatalogs(manifests)` (invoca `hooks.registerFormats/
  registerSchedules/registerPathways` de cada paquete YA resuelto, en su
  orden de dependencias) y `resolveEditionBindings(manifests,
  competitionId, world)` (localiza al propietario por
  `manifest.provides.competitionDefinitions` — dos paquetes con la misma
  competición, o ninguno, bloquean con diagnóstico). `unionScheduleIds()`
  une los `provides.competitionSchedules` de varios paquetes sin
  duplicados. Ambos manifiestos (`world-core-2026.1`/`spain-2026.1`) ganan
  un campo `hooks` ADITIVO (nunca serializado — la persistencia solo
  conserva `packId`+versión, ver 10.19.4).
- **`data/world/content-pack-catalog.js`** — único índice de paquetes
  DISPONIBLES (`listAvailableContentPacks()`); `game.js`
  (`careerSetupManifests()`) ya no construye `[WORLD_CORE_MANIFEST,
  SPAIN_MANIFEST]` a mano. Sigue habiendo solo estos dos paquetes reales.
- **`src/ui/game.js` ya NO llama a `registerSpainSchedules`,
  `registerSpainPathways`, `resolveSpainEditionBindings`,
  `SPAIN_PATHWAY_IDS`, `SPAIN_DOMESTIC_TRANSITION_GROUP_ID` ni
  `SPAIN_SCHEDULE_IDS`** (acceptance criterion 1 del prompt, auditado
  estáticamente en `scripts/test-world-harden1.js`, comprobando ausencia
  de esos símbolos en código NO comentado):
  - `startCareerFromSetup()`: `state.contentPackLifecycle.prepareCatalogs(startPlan.packs)`
    sustituye la llamada directa; `resolveEditionBindings` del
    `CompetitionPathwayService` se resuelve por ownership.
  - `closeSeasonAndPrepareNext()`: `discoverReadyTransitionGroup(seasonKey)`
    (nueva, en `game.js`) descubre el ÚNICO transition group LISTO leyendo
    los `pathwayBindingIds` YA CONGELADOS en las Editions de la temporada
    (nunca un literal) — bloquea con diagnóstico si hay cero o más de uno.
    Los `scheduleIds` de la temporada siguiente se derivan de
    `ContentPackLifecycleService.unionScheduleIds(state.installedContentPacks)`
    — nunca `SPAIN_SCHEDULE_IDS` sueltos. El schedule que fija el arranque
    de la temporada siguiente se lee de `scheduleProfileId` YA CONGELADO en
    la Edition de Liga principal real recién creada, nunca de un id suelto.
  - `getLeague(division)`/`getBrackets(division)`/`competitionIdForDivision()`
    quedan RETIRADAS por completo (funciones eliminadas, no solo sin
    llamadas) — sus dos únicos usos productivos reales (`closeSeasonAndPrepareNext()`
    y `publishActivationNews()`) ya resuelven la competición real
    directamente (`CompetitionCatalog.COMPETITION_IDS.*`, literal permitido
    en esta capa). `getAllTeams()` pierde su fallback por división (dead
    code: solo se alcanzaba con `!state.world`, es decir, antes de que
    exista ninguna carrera).
  - `state.division` queda RETIRADO (no tenía NINGUNA lectura productiva —
    solo se escribía tres veces y nunca se consultaba como autoridad,
    auditado). `Team.division`/`legacyDivision` SIGUEN existiendo en la
    entidad como proyección histórica de solo lectura.
- **`buildRealTeamFromData()` recibe `competitionDefinitionId` EXPLÍCITO**
  (nunca deriva de `{division: teamData.division}`) para resolver el
  mínimo real de cobertura — corrige una fragilidad real: antes de esta
  entrega, esa llamada intermedia construía un objeto `team` SIN `.id` y
  sin `competitionId`, dependiente de `state.world.registries` que
  TODAVÍA no existe en ese punto exacto del arranque (los 36 equipos se
  construyen antes que `GameWorld`). El id se resuelve por
  `CareerParticipantFactory.competitionIdByTeamIdFrom(SPAIN_CLUB_CONTENT)`.
- **`CareerParticipantFactory.js`** (`src/core/`) — `materializeParticipants()`
  (fábrica genérica completa, usada en `scripts/test-world-harden1.js` con
  fixtures sintéticos), `groupTeamsByCompetitionId()` (sustituye el bucle
  manual de agrupación en `startCareerFromSetup()`) y
  `competitionIdByTeamIdFrom()`. Puro, sin literales de país (auditado).
- **`ContentPackRegistry.markInstalled(manifest, installedAtGameDate)`**
  recibe la fecha de juego EXPLÍCITA — deja de usar `new Date()`.
  `WorldFactory.installContentPacks()`/`buildCareerWorld()` la propagan
  (por defecto, `world.createdAtGameDate`, ya explícito — nunca el reloj
  del proceso). Instalar el mismo conjunto de paquetes en cualquier orden
  de entrada produce el mismo orden real y la misma fecha instalada
  (verificado en `scripts/test-world-harden1.js`).
- **`scripts/audit-world-10-seasons.js`** (nuevo) — DIEZ cierres de
  temporada consecutivos sobre la carrera española real (36 equipos),
  conducidos por la vía canónica (`GameWorld`+`CompetitionEngine`+
  `CompetitionPathwayService`+`AnnualCycleService`, el mismo patrón que
  `scripts/smoke-pathways1.js` extendido a diez iteraciones), usando la
  MISMA lógica genérica de descubrimiento de transition group y unión de
  schedules que ahora usa `game.js` (nunca `SPAIN_PATHWAY_IDS`/
  `SPAIN_SCHEDULE_IDS` sueltos, salvo en el bootstrap inicial del
  calendario — mismo punto que `game.js`, antes de que exista ninguna
  Edition). Verifica por temporada: integridad World/Engine/Calendar;
  ausencia de duplicación en el Player Registry al consultar dos veces;
  máximo un squad ACTIVO por (jugador, contexto) sin squads huérfanos;
  cada `RetirementRecord` nuevo corresponde a un jugador retirado
  localizable, sin `teamId`; población afiliada viva ≤ población total
  registrada. Corre en ~100 s, imprime una línea por temporada + un
  resumen. Resultado real de la última ejecución de esta sesión: 10
  cierres OK, terminando con 1508 jugadores en el Player Registry (324
  afiliados vivos a los 36 equipos, 97 retirados acumulados), integridad
  limpia en las diez temporadas.
- **`src/core/CareerPersistenceBoundary.js`** (nuevo, módulo PURO) —
  `inventory()`: 21 colecciones/componentes clasificados
  `durable`/`derived`/`ephemeral` con `identityKeys`/`dependsOn`/
  `rebuildStrategy` (careerSetup, identidad de mundo, packs instalados,
  perfil de simulación, calendario, registries mundiales, jugadores,
  contratos, inscripción, agentes, mercado, transferencias, cesiones,
  ciclo anual, academia, selecciones — más tres entradas `derived`/
  `ephemeral` documentando explícitamente qué NO se persiste: runners
  vivos, view state de `game.js`, índices/caches internos, hooks de
  paquete). `project(runtime, { snapshotAtGameDate })` produce un
  envelope `{schemaVersion: 'world-harden-1', snapshotAtGameDate,
  careerSetup, world, collections, runtimeSnapshots, inventory,
  fingerprint}` — JSON plano (verificado con `JSON.stringify()` en
  caliente), cada colección ordenada por id estable (orden de entrada
  invertido produce el MISMO resultado, verificado), cada Player
  proyectado una única vez desde `PlayerRegistry`, packs proyectados solo
  por `id`/versión/procedencia (NUNCA sus hooks/callbacks). Reutiliza los
  `.snapshot()`/`.toJSON()`/`.describe()` YA existentes de cada registro de
  dominio (`ContractRegistry`, `RegistrationRegistry`, `AgentRegistry`,
  `MarketRegistry`, `TransferRegistry`, `LoanRegistry`,
  `AnnualCycleRegistry`, `AcademyRegistry`, `NationalTeamRegistry`,
  `WorldRegistries`) como fuente CANÓNICA de qué campos son durables en
  cada dominio — este módulo solo los ensambla/ordena/detecta ausencias.
  Una colección durable declarada sin proyector bloquea con diagnóstico
  (nunca se omite en silencio). NO implementa `fromJSON`/hidratación/
  `saveCareer`/`loadCareer`/`saves/` — sonda de persistibilidad, no un
  save jugable.
- **Verificación**: `scripts/test-world-harden1.js` (20 comprobaciones
  agrupadas, todas OK), `scripts/smoke-world-harden1.js` (carrera española
  real hasta la primera parada de usuario + un cierre administrativo
  sintético corto, sin jugar la temporada completa, OK), y las
  regresiones autorizadas `test-world-ui1.js` (20 OK), `test-pathways1.js`
  (19 OK), `test-cycle1.js` (42 OK) y `test-world-sim1.js` (19 OK, se
  ejecutó por tocar `WorldFactory`/`ContentPackRegistry`) — las cuatro sin
  ninguna regresión.

#### 10.19.2 Deuda explícita NO resuelta en esta sesión (propietario: sesión de cierre siguiente)

Decisión deliberada, documentada aquí en vez de maquillada — cada punto es
un riesgo de regresión real que esta sesión no pudo verificar con el
presupuesto de pruebas autorizado (sección 15 del prompt: sin Playwright,
sin ejecutar `test-market1.js`/`test-transfer1.js`/`test-contract1.js`/
`test-reg1.js`/`test-loan1.js`/`test-roster1.js`):

1. ~~**`CompetitionRules.competitionIdFromLegacyDivision()` sigue con
   ~22 call-sites productivos reales** en `AnnualCycleService.js`,
   `ContractSeeder.js`, `RegistrationSeeder.js`, `CpuRosterPlanner.js`,
   `MarketClearinghouse.js`, `RosterLegalityService.js`,
   `TransferService.js`, `LoanService.js`,
   `ClubEmploymentContextCatalog.js`.~~ **RESUELTO en WORLD-CONTEXT-1
   (ver 10.20)**: los nueve servicios reciben ahora contexto competitivo
   EXPLÍCITO (id por operación, ids por papel o resolver obligatorio) y no
   queda ningún call-site productivo del adaptador legacy (auditado
   estáticamente en `scripts/test-world-context1.js`). La función sigue
   exportada solo para fixtures históricos de `scripts/`; su retirada
   definitiva es de `WORLD-CLEANUP-1`.
2. ~~**`UI_COMPETITION_KEY_BY_STAGE_KEY`/`competitionKeyForStageKey()`/
   `BRACKET_PHASE_IDS` siguen vivos en `game.js`**.~~ **RESUELTO en
   WORLD-CLEANUP-1 (ver 10.21)**: los tres símbolos y `COMPETITION_LABELS`
   quedan retirados de `game.js` — match exposure/Events/noticias/actas/
   ficha usan el descriptor canónico (`BM.describeCompetitionContext()`) y
   `rulesPhaseId` declarado por el contenido (`CompetitionStageTemplate`),
   nunca un mapa fijo de UI. Verificación automática dirigida (sección 13),
   sin jugar la UI real — Dennis debe validarla manualmente (ver checklist
   10.21).
3. ~~**Sección 8 del prompt (semántica `clubId`/`teamId` en `ClubCycleCase`/
   `RosterLegalityReport`/`EmergencyRosterAction`/
   `LastOfficialMatchEvidenceCollector`) NO se tocó.**~~ **RESUELTO en
   WORLD-CONTEXT-1 (ver 10.20.3/10.20.4)**: esas cuatro formas llevan ya
   `teamId` y `clubId` por separado — y no era solo naming: la confusión
   ponía la nómina congelada del ciclo a 0, dejaba los planes CPU sin
   expediente, ignoraba el consentimiento del club del usuario y vaciaba
   varias pantallas. La deuda de naming que SIGUE viva está enumerada en
   10.20.5.
4. ~~**Sección 9 del prompt (grafo completo de pathways para
   `CONTROLLED_CLUB_WITHOUT_USER_STOP`) NO se implementó**.~~ **RESUELTO
   en WORLD-CLEANUP-1 (ver 10.21)**: `CareerSetupService.validateDraft()`
   recorre AHORA el grafo completo de `CompetitionPathwayRule` alcanzables
   desde la competición inicial (BFS con soporte de ciclos), ignora
   competiciones `catalog-only` y bloquea con un único mensaje listando
   todos los destinos incompatibles y su camino mínimo. Sigue siendo una
   consulta PURA (no instala packs, no crea Editions, no muta el mundo).
5. ~~**`Team.js` conserva `DIVISIONS`/`validateDivision`**.~~ **RESUELTO
   en WORLD-CLEANUP-1 (ver 10.21)**: `Team.js` ya no tiene `division`,
   `legacyDivision`, `DIVISIONS` ni `validateDivision` — participación se
   consulta SIEMPRE por `CompetitionEntry`.
6. **`SpainLegacyCompetitionRuntime.js` retirado de `src/core` en
   WORLD-CLEANUP-1** (ver 10.21) — movido a
   `scripts/fixtures/legacy/SpainLegacyCompetitionRuntime.js`, sin ningún
   call-site en `src/`; sus tres consumidores históricos
   (`test-world-core1.js`/`smoke-world-core1.js`/`smoke-club-core1.js`)
   solo tuvieron su ruta de `require()` corregida, no una migración de
   lógica. **`src/core/Calendar.js` NO se tocó** — deliberado: su
   retirada está condicionada en el prompt de origen a que sus
   consumidores históricos (~20 scripts que aún lo `require()` en Node,
   más el test de regresión que afirma que `index.html` sigue
   cargándolo) estén migrados primero, y esa migración es la campaña de
   `scripts/` explícitamente fuera de alcance de esta sesión. Sigue sin
   ningún call-site productivo real en `index.html`/`game.js` (comprobado
   de nuevo en esta sesión).
7. ~~**`scripts/smoke-world-calendar1.js` sigue construyendo un mundo sin
   `simulationProfile`**.~~ **RESUELTO en WORLD-CLEANUP-1**: el fixture
   construye ahora un `WorldSimulationProfile` explícito (mismo perfil
   transitorio que `game.js`/`test-contract1.js`), sin relajar la
   invariante productiva. `node --check` verificado; el smoke en sí NO se
   ejecuta en esta sesión (fuera del presupuesto de la sección 13).
8. **La auditoría de determinismo administrativo (sección 10 del prompt)
   se AMPLÍA en WORLD-CLEANUP-1** a los dieciséis servicios
   administrativos de contratos/mercado/ciclo/traspasos/cesiones
   (`scripts/test-world-cleanup1.js`, comprobación 7): ninguno usa
   `Math.random()`/`Date.now()`/`new Date()` como reloj/RNG implícito.
   Sigue siendo una auditoría ESTÁTICA dirigida (grep sobre el código
   fuente), no una revisión exhaustiva campo a campo de cada colección
   serializada por orden estable.

#### 10.19.3 Sobre el cierre de la EPIC

**Actualización (WORLD-CONTEXT-1, ver 10.20)**: los puntos 1 y 3 de
10.19.2 quedaron RESUELTOS.

**Actualización (WORLD-CLEANUP-1, ver 10.21)**: los puntos 2, 4, 5, 7 y la
ampliación del 8 quedan RESUELTOS. El punto 6 queda **RESUELTO
parcialmente**: `SpainLegacyCompetitionRuntime.js` se retira de `src/core`;
`src/core/Calendar.js` se conserva DELIBERADAMENTE (su retirada depende de
migrar ~20 scripts que aún lo `require()` directamente, fuera del
presupuesto de esta sesión — ver 10.21.4). Con esto, **World Architecture
queda declarada CERRADA** en el sentido estructural de las nueve entregas
originales y sus dos correcciones posteriores (WORLD-CONTEXT-1,
WORLD-CLEANUP-1): ningún dominio productivo decide ya por `Team.division`/
división legacy/mapas fijos de UI. La única deuda estructural que
sobrevive, documentada y no oculta, es la retirada de `Calendar.js` (10.21.4)
y los nombres ambiguos residuales de persistencia futura (10.20.5,
`state.lastOfficialMatchEvidence`).

**World Architecture NO añade contenido jugable en ninguna de sus dos
correcciones** — la partida española por defecto conserva sus 36 equipos,
reglas, formatos, calendario, Copa/playoffs, ascensos/descensos, mercado y
ciclo anual observables (verificado por `test-comp-core1.js`,
`test-world-context1.js` y `test-world-cleanup1.js`, sección 10.21.5); el
arranque/cierre de temporada de `game.js` ya no conoce ninguna división,
mapa fijo ni adaptador legacy en los puntos auditados. La validación
funcional manual completa (jugar la UI real, varias temporadas) sigue
pendiente de Dennis — ver checklist en 10.21.6.

#### 10.19.4 Frontera de persistencia — cobertura y límites exactos

Ver `src/core/CareerPersistenceBoundary.js`. Cobertura: inventario de 21
colecciones (16 durables + 5 derivadas/efímeras documentadas) y
proyección plana funcional para las 16 durables usando los serializadores
YA existentes de cada registro. Límites EXPLÍCITOS: los proyectores de
`contracts`/`registrations`/`agents`/`market`/`transfers`/`loans`/
`annualCycle`/`academy`/`nationalTeams` delegan íntegramente en el
`.snapshot()` que cada registro YA exponía antes de esta entrega — este
módulo no auditó campo a campo si esos `.snapshot()` son suficientemente
completos para un save real (esa auditoría es trabajo de la futura entrega de
persistencia real, no de esta sonda). No hay `fromJSON`, no hay
hidratación, no hay `saveCareer`/`loadCareer`, no se toca `saves/`.

_Migrado de `CHANGELOG.md` (líneas 428-516 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-07 — WORLD-HARDEN-1 (parcial): orquestación genérica de arranque/cierre + frontera de persistencia (DESIGN.md sección 10.19)

Novena entrega de la EPIC **World Architecture** — **entregada
PARCIALMENTE** (ver DESIGN.md 10.19.2 para la lista exacta de deuda
pendiente; esta sesión NO declara la EPIC 100 % cerrada). Base: merge de
la PR de WORLD-UI-1 en `origin/main` (`38049ca`). Rama
`claude/modest-gauss-ab8bat`.

### Qué se implementó

- **`src/core/ContentPackLifecycleService.js`** (nuevo) — orquesta
  `prepareCatalogs()`/`resolveEditionBindings()` de los paquetes YA
  resueltos, localizando propietario por `manifest.provides` (nunca por
  nombre de paquete). `unionScheduleIds()` une schedules de varios
  paquetes.
- **`src/core/CareerParticipantFactory.js`** (nuevo) —
  `materializeParticipants()`/`groupTeamsByCompetitionId()`/
  `competitionIdByTeamIdFrom()`, extracción PURA de la materialización de
  participantes de `game.js`.
- **`src/core/CareerPersistenceBoundary.js`** (nuevo) — sonda de
  persistibilidad: `inventory()` (21 colecciones/componentes, 16
  durables + 5 derivadas/efímeras) + `project(runtime, {snapshotAtGameDate})`
  (envelope JSON plano con fingerprint, reutilizando los `.snapshot()`
  ya existentes de cada registro de dominio). No implementa save/load.
- **`data/world/content-pack-catalog.js`** (nuevo) — único índice de los
  DOS paquetes de contenido disponibles (World Core + España).
- **`src/ui/game.js` ya NO llama a `registerSpainSchedules`,
  `registerSpainPathways`, `resolveSpainEditionBindings`,
  `SPAIN_PATHWAY_IDS`, `SPAIN_DOMESTIC_TRANSITION_GROUP_ID` ni
  `SPAIN_SCHEDULE_IDS`** (auditado estáticamente): `startCareerFromSetup()`
  usa `ContentPackLifecycleService`; `closeSeasonAndPrepareNext()` usa una
  nueva `discoverReadyTransitionGroup()` que descubre el transition group
  listo desde los `pathwayBindingIds` congelados en las Editions, y deriva
  los `scheduleIds` de la temporada siguiente de los paquetes instalados.
  `getLeague(division)`/`getBrackets(division)`/`competitionIdForDivision()`/
  `state.division` quedan RETIRADOS por completo de `game.js` (sin
  ninguna lectura productiva, solo escrituras muertas).
- **`buildRealTeamFromData()` corregido** para recibir
  `competitionDefinitionId` explícito — antes construía un `team`
  provisional sin `.id` y sin competitionId, dependiente de
  `state.world.registries` en un punto del arranque donde el mundo
  TODAVÍA no existe (fragilidad real detectada durante esta entrega).
- **`ContentPackRegistry.markInstalled(manifest, installedAtGameDate)`**
  recibe la fecha de juego explícita — deja de usar `new Date()`.
- **`scripts/audit-world-10-seasons.js`** (nuevo) — diez cierres de
  temporada reales sobre los 36 equipos españoles, vía la ruta canónica
  (`GameWorld`+`CompetitionEngine`+`CompetitionPathwayService`+
  `AnnualCycleService`). Última ejecución: 10/10 temporadas OK, ~103 s,
  terminando con 1508 jugadores en el Player Registry (324 afiliados
  vivos, 97 retirados acumulados), integridad limpia en cada cierre.
- **`scripts/test-world-harden1.js`** (20 comprobaciones, todas OK) y
  **`scripts/smoke-world-harden1.js`** (carrera española real hasta la
  primera parada de usuario + cierre administrativo sintético corto, OK).

### Deuda NO resuelta en esta sesión (ver DESIGN.md 10.19.2)

`competitionIdFromLegacyDivision()` sigue con ~22 call-sites productivos
en `AnnualCycleService`/`ContractSeeder`/`RegistrationSeeder`/
`CpuRosterPlanner`/`MarketClearinghouse`/`RosterLegalityService`/
`TransferService`/`LoanService`/`ClubEmploymentContextCatalog` (migrarlos
exige tocar 9 servicios normativos sensibles sin poder ejecutar sus
baterías completas, fuera del presupuesto de verificación de esta
sesión); `UI_COMPETITION_KEY_BY_STAGE_KEY`/`competitionKeyForStageKey()`/
`BRACKET_PHASE_IDS` siguen vivos en `game.js`; el grafo completo de
pathways para `CONTROLLED_CLUB_WITHOUT_USER_STOP` no se implementó
(sigue comprobando solo la competición inicial); la semántica `clubId`/
`teamId` de `ClubCycleCase`/`RosterLegalityReport`/`EmergencyRosterAction`
no se corrigió; `Team.js` conserva `DIVISIONS`/`validateDivision`;
`SpainLegacyCompetitionRuntime.js`/`src/core/Calendar.js` no se tocaron;
`scripts/smoke-world-calendar1.js` sigue con la aserción obsoleta de
`simulationProfile` sin corregir.

### Pruebas ejecutadas

`node scripts/test-world-harden1.js` (20/20), `node
scripts/smoke-world-harden1.js` (OK), `node
scripts/audit-world-10-seasons.js` (10/10 temporadas OK), `node
scripts/test-world-ui1.js` (20/20), `node scripts/test-pathways1.js`
(19/19), `node scripts/test-cycle1.js` (42/42), `node
scripts/test-world-sim1.js` (19/19) — las cuatro regresiones históricas
sin ninguna regresión nueva. `node --check` sobre todo el JS nuevo/
modificado y `git diff --check` limpios. No se ejecutó Playwright ni el
resto de smokes/tests históricos (fuera del presupuesto de esta entrega).

### Checklist manual pendiente

Ver `docs/manual/WORLD_ARCHITECTURE_ACCEPTANCE.md` — prueba manual amplia
de Dennis, no ejecutada por esta sesión.
