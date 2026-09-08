# Arquitectura — mundo genérico y paquetes de contenido (WORLD-CORE-1)

_Migrado de `CLAUDE.md` (líneas 809-900 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## World Architecture (WORLD-CORE-1 y siguientes)

Nueva EPIC (nueve entregas, DESIGN.md sección 10) que corrige la raíz
arquitectónica del motor: España deja de ser el mundo y pasa a ser el
primer paquete de contenido instalado sobre un `GameWorld` genérico.
**Sustituye el plan anterior** de "Ciclo profesional de plantilla" que
situaba `EUROPE-1`/`HARDEN-1` justo después de CYCLE-1 — esas dos quedan
REDEFINIDAS como entregas posteriores de World Architecture, sobre la base
correcta (ver DESIGN.md 10.9; el histórico de CYCLE-1 en 9.16/9.22 y en
`CHANGELOG.md` sigue siendo válido, no se reescribe).

Convenciones permanentes, aplicables a toda sesión futura que toque el
mundo, geografía, organizaciones, clubes, identidad de competición o
paquetes de contenido:

- Toda carrera tiene `state.world` explícito (`GameWorld`,
  `src/entities/World.js`) — instancia EXPLÍCITA por carrera, nunca un
  singleton, construida en `startSeason()` tras levantar los equipos
  reales (nunca antes, nunca reconstruyéndolos).
- **España es contenido, nunca fallback.** Un código genérico nuevo que
  necesite "la competición X" la resuelve por `competitionId`/catálogo —
  nunca asume ACB/Primera FEB por defecto ante una competición o país
  desconocidos.
- Geografía (`GeographicArea`), organizador/federación (`Organization`),
  competición (`CompetitionDefinition`) y jurisdicción laboral
  (`employerJurisdictionAreaId` de `Club`, `employerJurisdictionId` de
  `ClubEmploymentContextCatalog`) son EJES DISTINTOS — MoraBanc Andorra
  (organizador ACB/España, jurisdicción laboral Andorra) sigue siendo el
  test transfronterizo obligatorio también para esta EPIC.
- `Club` (`src/entities/Club.js`) y `Team` (`src/entities/Team.js`) son
  conceptos DISTINTOS desde WORLD-CORE-1, vinculados por `team.clubId` —
  `club.id === primaryTeam.id` es una decisión de compatibilidad de
  `spain-2026.1`, no una invariante universal (CLUB-CORE-1 podrá tener
  varios equipos por club). Finanzas/instalaciones/junta/afición SIGUEN en
  `Team` hasta CLUB-CORE-1 — no las muevas ni las dupliques.
- `CompetitionDefinition` (identidad), `CompetitionEdition` (instancia por
  temporada), `CompetitionStage` (fase dentro de una edición) y
  `CompetitionEntry` (participación) NO se colapsan entre sí. Liga, Copa y
  playoff no se confunden: la Copa es una `CompetitionDefinition` SEPARADA
  con su propia edición cada temporada; el playoff por el título/de
  ascenso es un `CompetitionStage` de la edición de Liga, nunca otra
  competición.
- `CompetitionEntry` es la ÚNICA fuente de participación — código nuevo
  nunca deriva "en qué compite un equipo" de `Team.division` (alias legacy
  de compatibilidad, `legacyDivision`) ni de su nacionalidad.
- Ningún código NUEVO ramifica por `division` (`1ª`/`2ª`), nombre visible
  de liga/país, ni un país por defecto — usa `competitionId`/identidad
  mundial (`WorldRegistries`) o falla explícito.
- Las reglas normativas (registro, empleo, mercado, traspaso, cesión)
  SIGUEN viviendo en `CompetitionRules.js` — la identidad de competición
  vive en `src/core/CompetitionCatalog.js` (fuente CANÓNICA única;
  `CompetitionRules.js` importa y reexporta LOS MISMOS objetos, nunca una
  copia). `getCompetitionDefinition()`/`COMPETITION_DEFINITIONS` de
  `CompetitionRules.js` son wrappers de compatibilidad, no una segunda
  tabla.
- Los paquetes de contenido (`ContentPackManifest`, `data/world/*.js`)
  declaran `dependencies` explícitas y solo referencian entidades ya
  registradas por sus dependencias — nunca asumen un orden de instalación
  concreto (`ContentPackRegistry.computeInstallOrder()` lo deriva). Un
  paquete nuevo (país, competición) es dato de catálogo + su propio
  `install(world, context)`, nunca una rama nueva en `game.js`/`Team.js`/
  el core genérico.
- El runtime legacy español fijo (`League`/`Bracket`/`Cup`/`Playoffs`/
  `Promotion`, `state.leagues`/`state.brackets`) sigue funcionando sin
  cambios de comportamiento, aislado detrás de
  `src/core/SpainLegacyCompetitionRuntime.js` — este adaptador (y
  `data/world/spain-2026.1.js`) son los DOS ÚNICOS sitios permitidos para
  literales de España fuera del catálogo de identidad; se retira en
  COMP-CORE-1/WORLD-CALENDAR-1, no antes. `state.leagues`/`state.brackets`
  como mapa fijo de "1ª y 2ª" es COMPATIBILIDAD TRANSITORIA, no arquitectura
  definitiva — la selección de equipo por pestañas de división que
  describía este párrafo históricamente ya no existe (WORLD-UI-1, ver
  10.18 y el bloque de convenciones más abajo): la pantalla de
  configuración de carrera agrupa clubes por competición real, no por
  división.
- Los aliases a registros existentes (`state.playerRegistry`,
  `state.contractRegistry`, etc. y `state.world.domainRegistries.*`) deben
  ser la MISMA instancia — comprueba identidad estricta (`===`), nunca
  contenido equivalente.
- Un mundo exterior/extranjero NO es un tipo especial: `external-abstract`
  (`WorldLifecycleService`) es un NIVEL DE SIMULACIÓN transitorio, no una
  clase de club distinta — WORLD-SIM-1 lo sustituirá por clubes/equipos
  normales con detalle abstracto, nunca por una segunda ontología.
- Sin SQL, sin repositorio de persistencia, sin save/load real hasta que
  WORLD-HARDEN-1 lo decida explícitamente.
- Las pruebas de esta EPIC son DIRIGIDAS (batería reducida por entrega,
  `scripts/test-world-core1.js`/`scripts/smoke-world-core1.js` como
  ejemplo) — se evita repetir matrices completas de la EPIC anterior salvo
  riesgo demostrado sobre un dominio concreto que la entrega toque.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura mundial o qué puentes legacy siguen vivos.

_Migrado de `DESIGN.md` (líneas 7615-8369 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 10. World Architecture — mundo, geografía, organizaciones y competiciones

Nueva EPIC (nueve entregas), abierta al completar la EPIC "Ciclo profesional
de plantilla" (ROSTER-1 → CYCLE-1, ver 9.16-9.22, las siete YA hechas).
**Decisión de producto que sustituye el plan anterior** (ver 10.9): el orden
antiguo situaba después `EUROPE-1` (transfer internacional) y `HARDEN-1`
(persistencia). Esas dos entregas quedan PAUSADAS con su planteamiento
anterior — se replantearán después de esta EPIC, sobre la base correcta.

### Por qué se hace ahora

El juego se construyó con España como vertical inicial y, aunque ROSTER-1
introdujo `competitionId` y reglas multi-liga (9.16), la orquestación real
seguía suponiendo: exactamente dos divisiones `1ª`/`2ª`; una ACB con Copa y
playoff y una Primera FEB con playoff de ascenso; una "otra división" que
siempre era el único mundo de fondo; ascensos/descensos mutando
`Team.division`; calendario seleccionado por división con fallback
silencioso a `1ª`; competición/fase/temporada representadas por strings
repartidos por `game.js`; club y primer equipo confundidos en una sola
entidad `Team`; Europa tratada como "exterior abstracto" en vez de formar
parte del mismo mundo. El mundo debe poder contener competiciones
mundiales, continentales y nacionales, de clubes y de selecciones, sin que
ninguna sea el caso por defecto.

### 10.1 Las nueve entregas

| Orden | Entrega | Resultado | Estado |
|---:|---|---|---|
| 1 | **WORLD-CORE-1** | `GameWorld` canónico, geografía, organizaciones, catálogos/registros, paquetes de contenido, identidad de competición y migración compatible de España. | **hecha**, esta sección |
| 2 | **CLUB-CORE-1** | Separación completa `Club` institucional / `Team`-`Squad` deportivo; primer equipo, filial, cantera y futuras secciones sin duplicar el club. | **hecha**, ver 10.12 |
| 3 | **COMP-CORE-1** | Motor genérico `CompetitionEdition → Stage → Entry`; migra Liga/Copa/playoff por el título/ascenso fuera de los mapas fijos por división — retira `SpainLegacyCompetitionRuntime` de producción. | **hecha**, ver 10.13 |
| 4 | **WORLD-CALENDAR-1** | Calendario mundial y cola cronológica única; varias competiciones simultáneas, paradas de usuario y simulación de fondo sin el concepto especial de "la otra división". | **hecha**, ver 10.14 |
| 5 | **PATHWAYS-1** | Clasificación entre fases/torneos, ascenso/descenso, acceso a copas y plazas continentales mediante reglas declarativas versionadas. | **hecha**, ver 10.15 |
| 6 | **WORLD-SIM-1** | Niveles de detalle `playable/full/standard/abstract`, simulación acotada del exterior y población/mercado mundial sin cargarlo todo al máximo — sustituye `external-abstract` por clubes/equipos normales con detalle abstracto. | **hecha**, ver 10.16 |
| 7 | **NATIONAL-TEAMS-1** | Federaciones, selecciones, elegibilidad, convocatorias, ventanas y competiciones continentales/mundiales de selecciones. | **hecha**, ver 10.17 |
| 8 | **WORLD-UI-1** | Navegación estilo manager Mundo → Continente → País → Competición, configuración de carrera, selección de ligas/nivel de detalle. | **hecha**, ver 10.18 |
| 9 | **WORLD-HARDEN-1** | Elimina los puentes legacy de España en `game.js` (arranque/cierre de temporada, `state.division`/`getLeague`/`getBrackets`), audita determinismo/población a diez temporadas, prepara la frontera de persistencia — todavía sin imponer SQLite/PostgreSQL. | **completada mediante dos correcciones posteriores** — WORLD-CONTEXT-1 (10.20) + WORLD-CLEANUP-1 (10.21) resuelven la deuda explícita de 10.19.2; ver 10.19.3 y 10.21 para el estado final exacto (`Calendar.js` es la única pieza deliberadamente no retirada) |

Después de esta EPIC, ya sobre una base correcta: `EUROPE-CONTENT-1`
(Euroliga/EuroCup/BCL como paquetes de contenido), `INTL-TRANSFER-1`
(mercado transfronterizo y Letter of Clearance), paquetes de países
adicionales, y persistencia real (SQLite/PostgreSQL cuando corresponda). La
sección 10.19 detalla qué de WORLD-HARDEN-1 quedó implementado en esta
sesión y qué deuda queda explícitamente para una sesión de cierre
posterior antes de declarar la EPIC 100% cerrada.

### 10.2 Modelo de dominio

La navegación conceptual es Mundo → Continente → País → Competiciones, pero
el dominio usa entidades canónicas por id y relaciones EXPLÍCITAS — nunca un
árbol de objetos anidados copiados:

- La geografía forma una jerarquía por `parentAreaId`.
- Una competición referencia su `scopeAreaId`.
- Una organización referencia su sede y, opcionalmente, su organización
  superior.
- Un club referencia su área de origen, pero puede entrar en competiciones
  de otras áreas.
- El organizador de una competición NUNCA determina la jurisdicción laboral
  de un club (MoraBanc Andorra: organizador ACB/España, jurisdicción
  laboral Andorra — ver 9.17).
- Una competición mundial puede ser de selecciones o de clubes.

El modelo debe poder expresar (sin implementarlas todavía, ver 10.7 "Fuera
de alcance"): Mundial/JJOO (mundial, selecciones), Intercontinental de
clubes (mundial, clubes), EuroBasket (continental, selecciones), Euroliga/
EuroCup/BCL (continental, clubes), Liga/Copa/Supercopa españolas (nacional,
clubes). **NATIONAL-TEAMS-1 (ver 10.17)** hace ejecutable la mitad de
"selecciones" de esa lista — el `participantType: 'national-team'` de
`CompetitionEntry` ya corre sobre el mismo motor, demostrado con un
fixture ficticio continental/mundial; el contenido real (Mundial/JJOO/
EuroBasket) sigue sin instalarse.

### 10.3 Entidades

#### `GeographicArea` (`src/entities/Geography.js`)

`id`, `type` (`world|continent|country|territory|region`), `parentAreaId`
(`null` SOLO para la raíz mundial), `name`, `shortName`, `isoCode`,
`status` (`active|historical|fictional-test`), `provenance`. El nombre
visible nunca resuelve lógica. `AreaRegistry.validateHierarchy()` exige
exactamente una raíz `world`, todo padre existente, sin ciclos.

#### `Organization` (`src/entities/Organization.js`)

`id`, `name`, `type` (`global-federation|continental-federation|
national-federation|league-operator|tournament-organizer|other`),
`headquartersAreaId`, `parentOrganizationId` opcional, `scopeAreaId`,
`provenance`. Nunca se asume que toda competición continental la organiza
una federación continental, ni que todo operador de liga es una
federación.

#### `Club` (`src/entities/Club.js`) — ARCH-WORLD-07, ampliada en CLUB-CORE-1

Identidad institucional, SEPARADA del equipo deportivo — fuente CANÓNICA
única del estado institucional de un club. Campos: `id`, `name`,
`shortName`, `homeAreaId`, `employerJurisdictionAreaId` explícito,
`federationMembershipOrganizationIds`, `primaryTeamId`, `status`,
`dataSource`/`provenance`, y (migrados desde `Team` en CLUB-CORE-1)
`foundationYear`, `budget`, `reputationFinancial`/`reputationYouth`
(0-100), `facilities` (las 7 de 6.2.2), `board`, `fanbase`, `finances`,
`clubDNA`, más los getters derivados `facilitiesMaintenanceCost`,
`totalIncome`, `totalExpenses`, `netResult`. **`club.id === primaryTeam.id`
QUEDA RETIRADO como invariante de `spain-2026.1`** (ver 10.8): el paquete
español declara 36 pares `clubId`/`teamId` EXPLÍCITOS y distintos
(`SPAIN_CLUB_CONTENT` en `data/world/spain-2026.1.js`) — MoraBanc Andorra es
`club-morabanc-andorra`/`team-morabanc-andorra`. Un test/fixture legacy
puede seguir usando `clubId === teamId` (compatibilidad documentada, nunca
invariante universal para contenido nuevo).

#### `Squad` (`src/entities/Squad.js`) — CLUB-CORE-1

Contenedor OPERATIVO actual de jugadores de un `Team` — la única fuente de
verdad de qué jugadores están afiliados operativamente a un equipo (nunca
un array paralelo en `Team`). Campos: `id`, `teamId`, `name`, `squadType`
(`first-team-senior` por defecto), `status`
(`active|inactive|historical|fictional-test`), `players` (instancias REALES
de `Player`, nunca copias — misma colección que `Team.roster` devuelve),
`dataSource`/`provenance`. `addPlayer()`/`removePlayer()`/`hasPlayer()`;
`toJSON()` serializa `playerIds`, nunca jugadores embebidos. `SquadRegistry`
(en `WorldRegistries.squads`) exige exactamente un squad ACTIVO por equipo y
que un jugador esté en como máximo un squad ACTIVO de todo el mundo —
ambas invariantes se comprueban al registrar y se revalidan en
`WorldRegistries.validateIntegrity()`. **NATIONAL-TEAMS-1 (ver 10.17)**
añade `membershipContext: 'club-service' | 'national-team-duty'` (por
defecto `'club-service'`) — la unicidad "un jugador en como máximo un
squad ACTIVO" pasa a ser POR CONTEXTO, nunca global: puede haber un squad
activo de cada contexto para el mismo jugador a la vez.

#### `Team` (`src/entities/Team.js`, ampliado en WORLD-CORE-1, CLUB-CORE-1 y NATIONAL-TEAMS-1)

Añade `clubId` explícito (Club real, nunca `team.id`), `club` (referencia
VIVA a la instancia, `null` hasta enlazar), `role`
(`first-team|reserve|youth|other`), `category` (`{gender, ageTier}`
explícitos), `teamType` (alias legacy derivado de `role`+`category`, sigue
produciendo `'senior-men-first-team'` por defecto — misma forma que antes
de CLUB-CORE-1), `homeAreaId`, `legacyDivision`, `squad` (referencia VIVA
al `Squad` activo), `primarySquadId`. `division` se conserva como alias
legacy durante la EPIC: ya NO recibe `1ª` por defecto cuando no se
proporciona (BUG-WORLDCORE-09, ver 10.12), no es fuente de verdad de
participación, y no debe usarse en código mundial nuevo. Un club puede
tener varios equipos en el modelo (el pack actual solo crea uno por club)
— `TeamRegistry.forClub(clubId)` ya lo consulta así.

**`teamKind` (NATIONAL-TEAMS-1, ver 10.17)**: vocabulario cerrado
`'club-team' | 'national-team'` (por defecto `'club-team'`, fallback SOLO
del constructor aislado de fixtures legacy). `club-team` exige `clubId`;
`national-team` nunca tiene `clubId`/`club` y exige
`federationOrganizationId` (`Organization` real `type: 'national-
federation'`) y `representedAreaId` (área real) — no hay clase `NationalTeam`
paralela.

**Migración institucional (CLUB-CORE-1)**: `foundationYear`, `budget`,
`clubDNA`, `facilities`, `board`, `fanbase`, `finances` y los totales
derivados dejan de vivir en `Team` — sus antiguos getters/setters
SOBREVIVEN como accesores legacy que DELEGAN en la MISMA instancia de
`Club` en cuanto `team.club` está enlazado (nunca una segunda copia
mutable); antes de enlazar (`team.club === null`, modo bootstrap de tests
legacy/modo prueba), leen/escriben un pequeño estado de bootstrap propio
con la MISMA forma que tenían antes de esta entrega, así que un `Team`
aislado se comporta exactamente igual que antes. `team.reputation` sigue
existiendo como vista compuesta de solo lectura: `sporting` (del propio
`Team`, la única componente genuinamente deportiva) + `financial`/`youth`
(del `Club`). `Team.roster` pasa a ser una VISTA de compatibilidad del
`Squad` activo (`this.squad.players`, o el roster de bootstrap antes de
enlazar) — misma referencia de array siempre, `Team.addPlayer()`/
`removePlayer()` delegan en el `Squad` cuando existe.

#### `CompetitionDefinition` (`src/entities/Competition.js` + catálogo en
`src/core/CompetitionCatalog.js`) — ARCH-WORLD-04

Identidad DURADERA, independiente de temporada y de reglas: `id`, `name`,
`shortName`, `scopeLevel` (`world|continental|national|regional`),
`scopeAreaId` (`null` solo si `scopeLevel` es `world`), `organizerId`,
`participantType` (`club-team|national-team`), `category` (género/edad
explícitos), `kind` (`league|cup|supercup|championship|qualifier|other`),
`recurrence`, `pyramidId`/`tier` cuando proceda, `implementationStatus`
(`active-runtime|catalog-only|future`), `bindings` por id a formato/
calendario/reglas (nunca el algoritmo incrustado), `provenance`. Conserva
además, en el MISMO objeto (nunca una segunda tabla), los campos legacy que
ya existían en `CompetitionRules.COMPETITION_DEFINITIONS` antes de esta
entrega: `organizerCountry`, `federationId`, `legacyDivision`.

#### `CompetitionEdition` / `CompetitionStage` / `CompetitionEntry`

- **Edition**: instancia de una definición en un ciclo temporal —
  `id`, `competitionDefinitionId`, `seasonKey`, `startDate`/`endDate`,
  `status` (`planned|active|completed|cancelled`), `stageIds`/`entryIds`
  (mutados EXCLUSIVAMENTE por `WorldRegistries.registerCompetitionStage/
  Entry()`, nunca a mano), ids congelados de formato/calendario/ruleset,
  `detailLevel` (siempre `'playable'` en esta entrega), `runtimeBinding`
  TRANSITORIO (la `League`/`Bracket` real — excluido de `toJSON()`/snapshot).
- **Stage**: fase dentro de una edición — `id`, `editionId`, `name`,
  `sequence`, `stageType` (`round-robin|knockout|series|group|final-four|
  other`), `status`, `entryIds`, `sourceStageIds`/`nextStageIds`
  declarativos, `runtimeBinding` transitorio.
- **Entry**: FUENTE DE VERDAD de participación (invariante 8) — `id`,
  `editionId`, `stageId` opcional, `participantType`, `participantId`,
  `entryStatus` (`invited|qualified|active|eliminated|withdrawn|completed`),
  `seed`, `qualificationSource`, vigencia. **NATIONAL-TEAMS-1 (ver 10.17,
  BUG-NATIONAL1-02)**: `WorldRegistries.registerCompetitionEntry()` exige
  AL REGISTRAR (no solo al validar después) que el `participantId`
  referencie un `Team` existente y que su `teamKind` coincida con
  `participantType` — antes solo se comprobaba para `club-team`.

**Invariante 13 (Liga/Copa/Playoff no se confunden)**: la Copa ACB es una
`CompetitionDefinition` SEPARADA (su propia `CompetitionEdition` cada
temporada); el playoff por el título/de ascenso es un `CompetitionStage`
DENTRO de la edición de Liga de esa temporada, nunca otra competición.

**Actualización COMP-CORE-1 (ver 10.13 para el resultado completo)**:
`runtimeBinding` DEJA de ser la autoridad operativa de Edition/Stage —
sigue existiendo como campo transitorio (excluido de `toJSON()`, invariante
27) para los shims históricos que todavía lo enlazan
(`SpainLegacyCompetitionRuntime`, solo desde tests), pero el runtime real
de una carrera vive en el `RoundRobinStageRunner`/`BracketStageRunner` que
`CompetitionEngine` guarda en su propio `CompetitionRuntimeRegistry`
(transitorio, fuera de `WorldRegistries`) — consultar/resolver un partido
pasa SIEMPRE por ahí, nunca por `edition.runtimeBinding`/`stage.
runtimeBinding`. `CompetitionEdition` añade además `formatBindingId`
(`CompetitionFormatDefinition`, ver más abajo) congelado en el mismo
momento que `scheduleProfileId`/`rulesetBundleId`.

**Actualización WORLD-CALENDAR-1 (ver 10.14)**: `scheduleProfileId` deja de
ser un literal de división (`'1ª'`/`'2ª'` en `CONFIG_BASE.calendar`) y pasa
a ser el id de un `CompetitionScheduleDefinition` del catálogo de
calendarios (`src/core/CompetitionScheduleCatalog.js`), **congelado por
Edition** igual que formato y ruleset. Una edición con runtime fechado ya
NO puede tener `scheduleProfileId: null` — la Copa ACB recibe su propio id
estable (`spain-2026.1:schedule:copa-acb`) y la regla de activación cruzada
lo transporta como dato plano para que la Edition nueva lo congele.
El instante de cada partido (`scheduledAt` UTC + `timeZoneId` IANA) vive en
el descriptor del runner, no en la Edition; `scheduledDate` (`Date`) queda
como vista derivada de compatibilidad.

**Actualización PATHWAYS-1 (ver 10.15):** `CompetitionEdition` congela
además `pathwayBindingIds` (ids estables de
`CompetitionPathwayDefinition`, en `toJSON()`, nunca reescritos después de
crearse); `CompetitionStage` gana `stageKey` EXPLÍCITO (nunca deducido
cortando `stage.id`); `CompetitionEntry` gana `qualificationReceiptId`
(referencia al `CompetitionPathwayReceipt`/`CompetitionSeasonTransitionReceipt`
que justificó esa clasificación — `qualificationSource` se conserva solo
por compatibilidad).

#### `CompetitionFormatDefinition` / `CompetitionStageTemplate` (COMP-CORE-1, `src/entities/Competition.js` + catálogo en `src/core/CompetitionFormatCatalog.js`)

Definición VERSIONADA y SERIALIZABLE de "qué fases tiene una competición y
con qué algoritmo se ejecuta cada una" — puro dato de contenido (`id`,
`version`, `status`, `participantType`, `stageTemplates` ordenados por
`sequence`, `editionCompletionPolicy`, `provenance`), nunca funciones/
instancias Team/`Map`/objetos de `CompetitionRules` incrustados. Cada
`CompetitionStageTemplate` declara `stageType`/`runnerType`
(`round-robin|bracket`), `activation` (`edition-start`|`stage-completed`+
`sourceStageKey`|`round-completed`+`sourceStageKey`+`round` — tipos
GENÉRICOS, nunca "cuando ACB llegue a la jornada 17"), `entrySource`
(`initial-participants`|`stage-standings-range`+rango+ámbito misma edición
o externo|`stage-bracket-final-round-winners`+reseed) y `runnerConfig`
(config validada por el runner: puntuación/desempate para round-robin,
cuadro/patrones de campo para bracket). Congelado con `Object.freeze()` al
construirse — una definición activa no puede modificarse después
(`CompetitionFormatCatalog.registerFormat()` es idempotente por
id+version idéntica, lanza si difieren).

#### `GameWorld` (`src/entities/World.js`)

Agregado raíz de una carrera — NO singleton, no lee DOM ni globales. `id`,
`name`, `careerSeed`, `createdAtGameDate`, `schemaVersion`, `registries`
(`WorldRegistries`), `calendar` (**WORLD-CALENDAR-1**: el `WorldCalendar`
ÚNICO de la carrera, `src/core/WorldCalendar.js` — la MISMA instancia que
`state.calendar`, enlazada una sola vez con `setCalendar()` en
`startSeason()` y NUNCA sustituida en el cierre de temporada; antes era un
`Calendar` por temporada), `domainRegistries` (aliases por
IDENTIDAD a los registros ya existentes de ROSTER-1..CYCLE-1, adjuntados
con `attachDomainRegistries()`). `validateIntegrity()`/`describe()` — este
último serializable (sin `Map`/funciones/DOM/ciclos), usado por el detalle
técnico de Home (10.6) y por los scripts de prueba.

#### `WorldRegistries` (`src/core/WorldRegistry.js`)

Agregado de siete registros por carrera (`areas`, `organizations`, `clubs`,
`teams`, `competitionDefinitions`, `competitionEditions`,
`competitionStages`, `competitionEntries`) más `packs`
(`ContentPackRegistry`, `src/core/ContentPackRegistry.js`). API común:
`register/get/require/has/all`, orden canónico de inserción, id duplicado
incompatible lanza, `validateIntegrity()` agrega TODOS los errores del
mundo de una vez. Las operaciones que cruzan colecciones (`registerClub`,
`registerTeam`, `registerCompetitionStage`, `registerCompetitionEntry`...)
viven en `WorldRegistries`, nunca repartidas por quien llama — es el ÚNICO
punto que mantiene `edition.stageIds`/`entryIds` sincronizados con lo
realmente registrado.

#### `ContentPackManifest`

`id`, `version`, `name`, `status`, `dependencies` (id o `{id,version}`),
`provides` por tipo de entidad (informativo), `dataSource`/`provenance`,
`install(world, context)`. `ContentPackRegistry.computeInstallOrder()`
deriva el orden de instalación de las dependencias declaradas — nunca el
orden accidental del array de entrada (invariante 20) — y lanza
descriptivo ante dependencia ausente o ciclo. `WorldFactory.
installContentPacks()` es idempotente por paquete.

### 10.4 Paquetes iniciales

- **`world-core-2026.1`** (`data/world/world-core-2026.1.js`): esqueleto
  geográfico mínimo — raíz Mundo (`area-world`) y continente Europa
  (`area-continent-europe`). Sin dependencias. No inventa países/
  organizaciones/clubes que todavía no hacen falta.
- **`spain-2026.1`** (`data/world/spain-2026.1.js`, depende de
  `world-core-2026.1`): España y Andorra como países DISTINTOS bajo Europa
  (`area-country-es`/`area-country-ad`); FEB (`org-feb`) y ACB (`org-acb`,
  organización superior FEB); los 36 clubes/equipos reales, REUTILIZANDO
  las instancias ya construidas por `game.js` (nunca las recrea, nunca
  copia `data/real/*`); referencias (no copias) a las
  `CompetitionDefinition` de ACB/Primera FEB/Copa ACB/Supercopa ACB
  (`catalog-only`, identidad declarada sin edición jugable — no hay
  participantes/calendario/reglas reales todavía) desde
  `CompetitionCatalog.js`; los `CompetitionFormatDefinition` de ACB/Primera
  FEB/Copa ACB (COMP-CORE-1, ver 10.13); y la edición/stage/entries de
  temporada regular de ACB y Primera FEB de la temporada de arranque, vía
  `CompetitionEngine.registerEditionWithInitialEntries()` (mismo esquema de
  ids que el histórico `SpainLegacyCompetitionRuntime.bindCareerStart()`,
  ya retirado de esta ruta — ver 10.13).
- **Fixture de test** (`scripts/test-world-core1.js`, función
  `buildTestOnlyManifest()`): paquete mínimo SOLO de test con otra área y
  una competición mundial de selecciones (`testland-world-cup`) — se
  instala y valida sin ACB/FEB/`1ª`/`2ª`/España ni módulo normativo
  español, y nunca se carga en una partida real.

### 10.5 Adaptador legacy — `SpainLegacyCompetitionRuntime`

**Nota COMP-CORE-1 (ver 10.13): esta sección describe el diseño de
WORLD-CORE-1, ya SUPERADO en la ruta productiva.** El adaptador se retiró
de `index.html`/`game.js`/`spain-2026.1.js` — sigue existiendo solo como
shim para los fixtures de `scripts/test-world-core1.js`/
`smoke-world-core1.js`/`smoke-club-core1.js`, que lo llaman directamente
sin pasar por el contenido español real. El texto histórico se conserva
para entender de dónde viene el esquema de ids que reutiliza el
`CompetitionEngine` genérico.

`src/core/SpainLegacyCompetitionRuntime.js` enlaza el runtime FIJO español
(`League`/`Bracket`/`Cup`/`Playoffs`/`Promotion`, sin tocarlos) con su
`CompetitionEdition`/`CompetitionStage`/`CompetitionEntry` canónicos:
`bindCareerStart`/`bindNewSeason` (edición+stage+entries de temporada
regular de ACB/Primera FEB), `bindLeagueRuntime` (enlaza la `League` real ya
construida, que no existe todavía en el momento de instalar el paquete),
`bindCup`/`bindTitlePlayoff`/`bindPromotionPlayoff` (enlazan Copa/playoffs
en el momento REAL en que `game.js` los crea — jornada 17 / fin de liga
regular). Junto con `data/world/spain-2026.1.js`, es uno de los DOS únicos
sitios permitidos para literales de España (`1ª`/`2ª`/ACB/Primera FEB)
fuera del catálogo de identidad — auditado estáticamente en
`scripts/test-world-core1.js` contra los ocho archivos mundiales GENÉRICOS
(`Geography.js`, `Organization.js`, `Club.js`, `Competition.js`, `World.js`,
`WorldRegistry.js`, `ContentPackRegistry.js`, `WorldFactory.js`). No
registra ninguna regla normativa nueva (eso sigue en `CompetitionRules.js`)
y no lo usa ningún paquete que no sea `spain-2026.1`. **Destino de
eliminación explícito**: desaparece cuando COMP-CORE-1 (motor genérico de
stages) y WORLD-CALENDAR-1 (calendario mundial único) sustituyan a
`League`/`Bracket`/`Cup`/`Playoffs`/`Promotion` por un runner genérico.

### 10.6 Integración con el runtime actual

**Actualizado en WORLD-CALENDAR-1 (ver 10.14 para el detalle completo)** —
sobre lo que describe el bloque de COMP-CORE-1 más abajo, `startSeason()`
crea además el `WorldCalendar` ÚNICO de la carrera (con huso por defecto
explícito aportado por el paquete instalado), el
`CompetitionScheduleService` y el `WorldCalendarCoordinator` con sus cuatro
fuentes (`competition-match`, `market-event`, `transfer-event`,
`loan-event`); el proveedor de fechas que recibe el engine lo construye
ese servicio a partir del calendario congelado en cada Edition, no una
función que ramifique por competición. `closeSeasonAndPrepareNext()` ya NO
construye ningún calendario nuevo: registra la temporada siguiente en el
mismo agregado, avanza el cursor común en cada fase fechada del ciclo
anual y resincroniza las fuentes. `state.leagues`/`state.brackets`
desaparecen como mapas fijos: las vistas `League`/`Bracket` que consumen
las pantallas antiguas y `SeasonHistoryService` se construyen BAJO DEMANDA
desde el `stageId`/runner real. `simulateBackgroundRound()`,
`drainBackgroundBrackets()`, `getBackgroundDivision()`,
`getBackgroundLeague()`, `finishRoundBookkeeping()` y la prioridad fija de
`getActiveBracket()` quedan RETIRADAS.

**Actualizado en COMP-CORE-1 (ver 10.13 para el detalle completo)** —
`startSeason()`: construye los 36 equipos (misma construcción de siempre,
`getRealTeamsByDivision()`), crea `GameWorld` e instala `world-core-2026.1`
+ `spain-2026.1` (con los equipos YA construidos como contexto — nunca se
reconstruyen; el paquete registra los `CompetitionFormatDefinition` y las
Editions/Stage de Liga regular/Entries directamente, sin construir ningún
runner todavía), crea UNA instancia de `CompetitionEngine` para la carrera,
la inyecta con el proveedor de fechas real y llama a
`initializeEdition()` para ACB y Primera FEB (construye los runners desde
las Entries ya registradas) — `state.leagues['1ª'/'2ª']` pasan a ser
fachadas `League` que envuelven esos runners reales, nunca una segunda
construcción. AL FINAL se adjuntan por identidad los siete registros de
dominio (`attachDomainRegistries()`). Si la instalación de un paquete
lanza, `state.world` NUNCA llega a asignarse (invariante 22) — el error se
propaga tal cual, sin dejar un mundo parcial utilizable.

`closeSeasonAndPrepareNext()`: cierra las ediciones/stages de la temporada
que termina (`status: 'completed'`, nunca se borran) y abre las de la
siguiente sobre el MISMO `GameWorld` **y el MISMO `CompetitionEngine`**
(nunca se reconstruye ninguno de los dos al cerrar temporada).

`createBracketsIfDue()`: ya NO decide con ramas por división/`currentRound`
cuándo crear Copa/playoff — el `CompetitionEngine` los activa como efecto
de procesar `round-completed`/`stage-completed` al resolver el partido real
que completa la jornada/fase (Copa: activación cruzada declarada por
`spain-2026.1.buildSeasonActivationPlan()`; playoff por el título/ascenso:
cascada intra-edición declarada en el propio `CompetitionFormatDefinition`).
Esta función solo drena esos hechos (`drainCompetitionActivationEvents()`)
y construye la vista `Bracket`/`PromotionPlayoff`-shaped que falte —
la foto de clasificación usada para las `CompetitionEntry` la calcula el
propio engine desde el runner de la fase fuente, nunca "recalculada" aparte.

`getAllTeams()` lee de `state.world.registries.teams.all()` cuando el mundo
existe (ARCH-WORLD-08: "equipos desde World Registry, no desde una lista de
clubes españoles") — mismas instancias que devolvía antes el recorrido por
`League.teams`.

**Actualizado en NATIONAL-TEAMS-1 (ver 10.17 para el detalle completo)** —
`startSeason()` crea además `state.nationalTeamRegistry` (instancia
EXPLÍCITA por carrera, siempre VACÍA en la partida española) y la adjunta
a `state.world.domainRegistries`; los tres puntos donde `game.js` llama a
`EligibilityService.evaluateEligibility()` le pasan ese registro como
dependencia — sin ninguna `NationalTeamWindow` real, el reason code
`NATIONAL_TEAM_DUTY` nunca se activa, así que el comportamiento observable
de la partida española no cambia.

**Interfaz mínima** (Home, `renderHomeScreen()`): un bloque `<details>`
plegado ("Mundo de la carrera") con los paquetes instalados y la jerarquía
Mundo › Europa › España/Andorra, construido desde `state.world.describe()`
— solo lectura, nunca muta el mundo ni consume aleatoriedad. Home/
Competiciones/Agenda/Noticias/Plantilla/Mercado no pierden ninguna función;
la selección de equipo sigue mostrando ACB y Primera FEB porque son las
únicas ediciones jugables instaladas. El navegador mundial completo
(Mundo → Continente → País → Competición) llegó en WORLD-UI-1 (ver 10.18)
— este `<details>` de Home se conserva tal cual como diagnóstico técnico
discreto, ahora complementado por la pantalla Mundo real.

### 10.7 Fuera de alcance de WORLD-CORE-1

SQLite/PostgreSQL/IndexedDB/backend/API/repositorios de persistencia o
save-load; cargar todos los países/clubes/jugadores del mundo; Euroliga/
EuroCup/BCL u otras competiciones nuevas jugables; Mundial/JJOO/EuroBasket
o selecciones funcionales; transferencias internacionales/Letter of
Clearance; motor genérico completo de formatos/stages (COMP-CORE-1);
clasificación continental/ascenso-descenso genérico (PATHWAYS-1); varios
equipos reales por club y migración completa de finanzas/instalaciones a
`Club` (CLUB-CORE-1); simulación abstracta del exterior (WORLD-SIM-1);
navegador mundial/rediseño visual (WORLD-UI-1); cambios a las reglas ACB/
FEB ya vigentes; traspasos/cesiones CPU-a-CPU que CYCLE-1 dejó pendientes;
datos reales modificados.

### 10.8 Migración legacy — puentes y su entrega de retirada

| Puente legacy | Vive en | Se retira en |
|---|---|---|
| `Team.division`/`legacyDivision` como alias de participación | `Team.js` | Participación real ya es `CompetitionEntry` desde COMP-CORE-1. **Desde WORLD-HARDEN-1 (ver 10.19), `getLeague(division)`/`getBrackets(division)`/`competitionIdForDivision()`/`state.division` quedan RETIRADOS de `src/ui/game.js`** — sus dos únicos usos productivos (arranque y cierre de temporada) resuelven la competición real directamente con `CompetitionCatalog.COMPETITION_IDS.*` (literal permitido en esa capa). `Team.division`/`legacyDivision` SIGUEN existiendo en la entidad como proyección histórica/legacy de solo lectura (usada por `SeasonHistoryService`/histórico de carrera, fichas) — **RETIRAR el vocabulario `DIVISIONS`/`validateDivision` de `Team.js` sigue PENDIENTE**, deuda explícita de una sesión futura |
| ~~`SpainLegacyCompetitionRuntime` como autoridad productiva~~ | *(retirado de producción en COMP-CORE-1)* | **RETIRADO de `index.html`/`game.js`/`spain-2026.1.js`** — el archivo sigue existiendo únicamente como shim de `scripts/test-world-core1.js`/`smoke-world-core1.js`/`smoke-club-core1.js` (fixtures históricos); se elimina el archivo cuando esos scripts dejen de necesitarlo (WORLD-CALENDAR-1) |
| ~~`League`/`Bracket`/`Cup`/`Playoffs`/`Promotion` como runner fijo~~ | *(retirado como autoridad en COMP-CORE-1)* | **Fachadas finas** sobre `RoundRobinStageRunner`/`BracketStageRunner` (`src/core/CompetitionRunners.js`) — mismo algoritmo, nunca duplicado; siguen siendo la vista legacy que consume `game.js`/`cycle1-harness.js`, construida SIEMPRE desde el runner del `CompetitionEngine` |
| `competitionIdFromLegacyDivision()` | `CompetitionRules.js` | Sin call-sites en `game.js` desde COMP-CORE-1. **WORLD-HARDEN-1 NO migró sus ~22 call-sites productivos restantes** en `AnnualCycleService.js`/`ContractSeeder.js`/`RegistrationSeeder.js`/`CpuRosterPlanner.js`/`MarketClearinghouse.js`/`RosterLegalityService.js`/`TransferService.js`/`LoanService.js`/`ClubEmploymentContextCatalog.js` (todos del patrón `competitionIdFromLegacyDivision(team.division)`) — decisión DELIBERADA de esta sesión: sin poder ejecutar `test-market1.js`/`test-transfer1.js`/`test-contract1.js`/`test-reg1.js`/`test-loan1.js`/`test-roster1.js` (fuera del presupuesto de verificación de WORLD-HARDEN-1), migrar 9 servicios normativos sensibles sin red de pruebas era un riesgo de regresión silenciosa inaceptable. Sigue exportada y en uso productivo real — **deuda EXPLÍCITA, propietario: la primera sesión de WORLD-HARDEN-1 que pueda ejecutar esas baterías completas** |
| ~~`Club.id === primaryTeam.id`~~ | *(retirado)* | **RETIRADO en CLUB-CORE-1** — `spain-2026.1` declara 36 pares `clubId`/`teamId` distintos (`SPAIN_CLUB_CONTENT`) |
| ~~Finanzas/instalaciones/junta/afición en `Team` en vez de `Club`~~ | *(retirado)* | **RETIRADO en CLUB-CORE-1** — viven en `Club.js`; `Team.js` conserva solo accesores legacy que delegan (ver 10.3) |
| ~~`external-abstract` como categoría de `WorldLifecycleService`~~ | *(retirado en WORLD-SIM-1)* | **RETIRADO** — nunca tuvo call-site real (`externalClubMembership` sin usar, BUG-WORLDSIM-04); un Team exterior es un `Club`/`Team`/`Squad` NORMAL, clasificado `senior-service-roster` en cuanto sus jugadores llegan en `deps.teams` |
| ~~Calendario por `scheduleProfileId` de contenido español en `CONFIG_BASE.calendar` (`1ª`/`2ª`)~~ | *(retirado de la ruta productiva en WORLD-CALENDAR-1)* | **RETIRADO** — los perfiles, la ventana de Copa y los arranques de playoff/ascenso son ahora `CompetitionScheduleDefinition` versionadas de `data/world/spain-2026.1.js` (ids estables `spain-2026.1:schedule:1a`/`2a`/`copa-acb`). `CONFIG_BASE.calendar.scheduleProfiles` y `src/core/Calendar.js` siguen existiendo SOLO como shim del "modo prueba" técnico de `index.html` y de scripts standalone antiguos; ningún módulo nuevo los consulta. Eliminación del archivo: **WORLD-HARDEN-1** |
| ~~`state.leagues`/`state.brackets` como mapa fijo de dos divisiones~~ | *(retirado en WORLD-CALENDAR-1)* | **RETIRADO** — `getLeague(division)`/`getBrackets(division)` construyen la vista `League`/`Bracket` BAJO DEMANDA desde el `stageId`/runner real; no queda ningún estado paralelo. Los accesores por división siguen siendo el puente de las pantallas españolas hasta **WORLD-UI-1** |
| ~~`simulateBackgroundRound()`/`drainBackgroundBrackets()`/`getBackgroundDivision()`/`getBackgroundLeague()`~~ | *(retirados en WORLD-CALENDAR-1)* | **RETIRADOS** — no existe "la otra división" en el core ni en la orquestación productiva (BUG-WORLDCALENDAR-01/02) |
| `UI_COMPETITION_KEY_BY_STAGE_KEY` (`stageKey` genérica → `'league'/'cup'/'playoff'/'promotion'` histórica) | `src/ui/game.js` | Puente de INTERFAZ/normativa legacy (`matchExposures`, `relatedCompetition`, `BRACKET_PHASE_IDS`) — nunca decide tiempo. **WORLD-HARDEN-1 NO lo retira** (decisión deliberada, ver 10.19: retirarlo exige reescribir cómo se etiquetan match exposure/Events/noticias/actas/ficha en TODA la pantalla, sin poder verificarlo con Playwright en esta sesión — riesgo de regresión silenciosa de UI inaceptable sin esa red). Sigue siendo el único traductor de noticias/actas; retirada definitiva: sesión futura con presupuesto de verificación manual/Playwright |
| ~~Cierre deportivo español (ascensos/descensos ACB↔Primera FEB) en `SeasonHistoryService`/`cycle1-harness`~~ | *(retirado de producción en PATHWAYS-1)* | **RETIRADO** — `SeasonHistoryService.applyPromotionsAndRelegations()` (mutaba `team.division`) sigue sin call-sites productivos; `game.js` usa `CompetitionPathwayService.applyTransitionGroup()` + `deriveSeasonMovesFromTransitionReceipt()`, con el `pathwayId`/`transitionGroupId` descubiertos GENÉRICAMENTE (`discoverReadyTransitionGroup()`, WORLD-HARDEN-1, ver 10.19) desde los `pathwayBindingIds` congelados — nunca `SPAIN_PATHWAY_IDS`/`SPAIN_DOMESTIC_TRANSITION_GROUP_ID` sueltos. `captureDivisionsBefore()` (solo la ETIQUETA histórica pre-transición) sigue en uso — ver 10.19, es display, no arquitectura. Sobrevive para `scripts/cycle1-harness.js`/smokes anteriores a esta entrega, sin plan de retirada nuevo |
| ~~`buildSeasonActivationPlan()`/`registerCrossEditionActivation()` (activación de Copa)~~ | *(retirado de producción en PATHWAYS-1)* | **RETIRADO** — la Copa se activa por la regla de pathway `acb-copa-qualification` (`competition-qualification`). Sobrevive exportado solo para `scripts/test-world-calendar1.js`/`scripts/smoke-world-calendar1.js` (fixtures históricos); sin nuevos call-sites en WORLD-HARDEN-1 |
| `bindNewSeasonEditions()` (construcción manual de la temporada siguiente desde `team.division`) | `data/world/spain-2026.1.js` | Sin call-sites productivos desde **PATHWAYS-1** (`applyTransitionGroup()` crea las Editions/Entries de la temporada siguiente de forma atómica) — sigue exportado para `scripts/test-world-calendar1.js`/`scripts/smoke-world-calendar1.js`; sin nuevos call-sites en WORLD-HARDEN-1 |
| `registerSpainSchedules`/`registerSpainPathways`/`resolveSpainEditionBindings` llamados por nombre desde `game.js` | `src/ui/game.js` | **RETIRADO en WORLD-HARDEN-1** (ver 10.19) — `game.js` llama a `ContentPackLifecycleService.prepareCatalogs()`/`.resolveEditionBindings()` (ownership por `manifest.provides`, nunca por nombre de paquete). Los propios `registerSchedules`/`registerFormats`/`registerPathways`/`editionBindings` de `spain-2026.1.js` SIGUEN existiendo (ahora expuestos también como `manifest.hooks`) — solo desaparece la llamada DIRECTA por nombre desde `game.js` |
| `activation`/`entrySource` de `CompetitionFormatDefinition` para SELECCIÓN (top-N/reseed) | `src/entities/Competition.js`/`data/world/spain-2026.1.js` | Sin nuevos call-sites productivos desde **PATHWAYS-1** — un formato productivo nuevo declara `'pathway-managed'` para cualquier fase cuya clasificación decida un pathway; los tipos legacy (`stage-completed`+`stage-standings-range`, etc.) siguen resolviéndose en el engine SOLO para fixtures/tests históricos que los declaran explícitamente |
| `scripts/verify-*-playwright.js` usan `simulateBackgroundRound`/`drainBackgroundBrackets` para avanzar una carrera sin reveals | `scripts/verify-*-playwright.js` | Necesitan migrarse a `advanceWorldUntilNextUserStop()`. No se han tocado ni ejecutado en WORLD-CALENDAR-1 (el presupuesto de pruebas prohíbe Playwright) — propietario: la primera sesión que vuelva a ejecutarlos |

No es obligatorio eliminar en esta entrega todos los usos históricos de
`state.division`/`competitionIdFromLegacyDivision` — sí lo es no añadir
ninguno nuevo fuera del adaptador (auditado en `scripts/test-world-core1.js`
contra los ocho archivos mundiales genéricos, y en
`scripts/test-comp-core1.js` contra los módulos genéricos nuevos de esta
entrega).

### 10.9 Plan superado

El orden anterior de la EPIC "Ciclo profesional de plantilla" (9.16) situaba
tras CYCLE-1 dos entregas — `EUROPE-1` (transfer internacional/Letter of
Clearance) y `HARDEN-1` (persistencia/simulación larga/calibración) — con un
planteamiento que asumía el mundo español fijo de antes de WORLD-CORE-1.
**Esa decisión queda SUPERADA, no borrada**: el histórico de CYCLE-1 en
9.16/9.22 y en `CHANGELOG.md` sigue siendo correcto en su contexto. El
transfer internacional volverá como entrega de World Architecture (tras
NATIONAL-TEAMS-1/COMP-CORE-1, con LOC real sobre el mundo nuevo); las
competiciones europeas serán paquetes de contenido (`EUROPE-CONTENT-1`)
sobre el motor genérico; la persistencia sigue pospuesta hasta
WORLD-HARDEN-1. **Confirmado explícitamente**: no se implementa SQL ni
save/load real en ninguna entrega de World Architecture hasta que
WORLD-HARDEN-1 lo decida.

### 10.10 Invariantes

1. Hay exactamente una raíz geográfica de tipo `world`.
2. Toda área no raíz tiene un padre válido y no existen ciclos.
3. Toda organización referencia áreas existentes.
4. Todo club referencia un área y una jurisdicción laboral explícitas.
5. Todo equipo referencia exactamente un club existente.
6. Un club puede tener varios equipos en el modelo aunque el pack actual
   cree uno (`TeamRegistry.forClub()`).
7. Un equipo puede tener entries simultáneas en varias competiciones.
8. Participación se deriva de `CompetitionEntry`, nunca de nacionalidad ni
   de `Team.division`.
9. Toda definición referencia scope y organizador válidos.
10. Toda edición referencia una definición y versiones explícitas de sus
    bindings.
11. Todo stage pertenece a una sola edición.
12. Todo entry referencia edición y participante compatibles con
    `participantType`.
13. Liga, Copa y playoff no se confunden: Copa es competición separada;
    playoff es stage de Liga.
14. No existe fallback de calendario, reglas, país o jurisdicción a
    ACB/España (`Calendar.getScheduleProfile()` lanza ante un
    `scheduleProfileId` desconocido — ARCH-WORLD-03).
15. MoraBanc conserva Andorra como origen/jurisdicción y ACB como
    participación deportiva.
16. Los 36 equipos y sus jugadores son las mismas instancias en World,
    runtime legacy y registries.
17. Todo Player sigue registrado exactamente una vez.
18. Los registries de ROSTER-1..CYCLE-1 tienen una sola instancia por
    carrera; los aliases de `state`/`GameWorld.domainRegistries` son
    identidad estricta (`===`).
19. Instalar solo un pack de prueba no español no instala España ni
    requiere divisiones legacy.
20. El orden de packs de entrada no cambia el mundo final si sus
    dependencias son las mismas.
21. Un id duplicado incompatible, referencia huérfana o dependencia
    circular falla de forma descriptiva antes de mutar parcialmente el
    mundo.
22. Si falla la creación del mundo, no queda un `state.world` parcial
    utilizable.
23. Consultas y renders no consumen aleatoriedad ni mutan registros.
24. El juego español actual conserva calendario, equipos, competiciones y
    progresión observables.
25. No se modifica `data/real/*`.
26. No se implementa SQL, repositorio de persistencia ni save/load.
27. Todos los objetos de diagnóstico se pueden serializar a JSON sin `Map`,
    funciones, DOM ni referencias circulares.
28. Ningún archivo genérico nuevo contiene reglas o ids de España — viven
    solo en `CompetitionCatalog.js` (identidad heredada de
    `CompetitionRules.js`, ver 10.3), `SpainLegacyCompetitionRuntime.js` y
    `data/world/spain-2026.1.js` (adaptador y paquete, expresamente
    permitidos).

**Ampliación WORLD-CALENDAR-1** (ver 10.14; se auditan en
`scripts/test-world-calendar1.js` y en el smoke):

29. Una carrera posee exactamente UN `WorldCalendar` vivo, y
    `state.calendar === state.world.calendar` durante toda la carrera.
30. El cambio de temporada NO reemplaza el calendario; el cursor nunca
    retrocede.
31. Ningún item pendiente puede quedar silenciosamente detrás del cursor.
32. Cada item tiene id estable (`sourceType + sourceId`) y una única fuente
    propietaria; un resultado vive en `CompetitionEngine`, nunca duplicado
    en el calendario.
33. Todo partido productivo tiene `scheduledAt` UTC y `timeZoneId`
    explícito; el mismo seed/contenido produce el mismo calendario bajo
    cualquier `TZ` del proceso.
34. Una fecha CIVIL sigue siendo fecha civil: se ordena al inicio de su día
    en el huso declarado, nunca se le persiste una hora inventada.
35. Consultar/renderizar no muta, no materializa partidos y no consume
    aleatoriedad.
36. El orden total no depende de arrays, `Map`, orden de instalación de
    paquetes ni de la competición "seleccionada" en la interfaz.
37. Un CPU-vs-CPU nunca exige intervención del usuario; un partido del
    usuario nunca se auto-resuelve; los resultados CPU simultáneos no se
    revelan antes del suyo.
38. Dos partidos simultáneos del equipo controlado bloquean con conflicto
    explícito — no se elige por id y no se reprograma nada.
39. Un fallo de resolución no elimina el item ni adelanta el cursor por
    encima de él; cada partido se resuelve como máximo una vez.
40. `state.division` no decide tiempo, participación ni siguiente partido;
    no existe "otra división" en el core ni en la orquestación productiva.
41. Un schedule desconocido FALLA; nunca hereda otro perfil. Los schedules
    activos están versionados y congelados por Edition.

**Ampliación PATHWAYS-1** (ver 10.15; se auditan en
`scripts/test-pathways1.js` y en el smoke):

42. Un mismo hecho + misma definición/version de pathway produce el mismo
    receipt id y los mismos qualifiers.
43. Ninguna decisión de pathway depende del orden de paquetes, arrays,
    `Map`, reglas o participantes de entrada.
44. Un trigger de pathway se aplica como máximo una vez.
45. Una consulta/preview de pathway (`isTransitionGroupReady`, hechos
    puros del engine) no muta y no consume RNG.
46. Todo qualifier de un receipt existía en la fuente declarada por su
    selector.
47. Todo Entry clasificado por un pathway referencia el receipt que lo
    justificó (`qualificationReceiptId`).
48. Un formato productivo (`activation`/`entrySource`) no selecciona
    participantes de fases posteriores — esa selección vive SIEMPRE en un
    pathway.
49. Dentro de una pirámide exclusiva (`transitionGroups[...].exclusivePyramid`),
    un participante tiene una sola liga destino por temporada; una
    transición anual se compromete completa o no se compromete
    (`applyTransitionGroup()` nunca deja Editions/Entries parciales).

**Ampliación WORLD-SIM-1** (ver 10.16; se auditan en
`scripts/test-world-sim1.js` y en el smoke):

50. Toda Edition productiva congela exactamente un `detailLevel` válido
    (`playable|full|standard|abstract`) — ninguno recibe fallback.
51. El perfil de simulación de la CARRERA (`WorldSimulationProfile`), nunca
    el paquete de contenido, decide el nivel de detalle.
52. Una Edition ya iniciada nunca cambia de nivel (sin setter; solo se fija
    al construirse).
53. `playable` es el único nivel que puede convertirse en parada de partido
    del usuario; un partido del Team controlado en una Edition no
    `playable` es configuración inválida, detectada antes de avanzar
    (`WorldCalendarCoordinator.requiresUser()`), nunca autosimulada.
54. `playable`/`full` reutilizan el `MatchEngine` actual sin cambiar su
    balance ni su shape de resultado.
55. `standard` nunca fabrica detalle individual (`quarterScores`/`boxScore`
    siempre `null`) y nunca deja empate.
56. `abstract` nunca crea ni almacena partidos individuales — un único hito
    por fase, dentro del límite consciente de una sola fase resoluble.
57. Todo resultado/resumen `standard`/`abstract` depende de un fingerprint
    estable (`careerSeed+algorithmVersion+editionId+stageId(+matchId)`),
    nunca de orden de arrays/`Map`/registro.
58. Consultar/renderizar (`getPendingMilestones`, `getStandings` antes de
    resolver, `listAllPendingAbstractMilestones`) nunca resuelve ni
    consume aleatoriedad.
59. Un hito abstracto se aplica como máximo una vez; repetirlo devuelve el
    mismo `CompetitionSimulationReceipt`, nunca duplicado.
60. Todo resultado abstracto deja un `CompetitionSimulationReceipt` plano
    y serializable (nunca instancias Team/Player/`Map`/funciones).
61. PATHWAYS consume hechos/consultas del engine (`getStandingsFacts`,
    `getBracketChampion`, `getBracketFinalRoundWinners`, uniformes para
    runner detallado y runtime abstracto) — nunca conoce niveles de detalle.
62. Un Club/Team/Squad de detalle `standard`/`abstract` sigue siendo un
    Club/Team/Squad NORMAL — nunca una segunda ontología (`external-abstract`
    retirado, BUG-WORLDSIM-04).
63. Todo Player materializado sigue registrado exactamente una vez en el
    Player Registry mundial; población estimada (`TeamSimulationSnapshot.
    estimatedRosterSize`) nunca crea identidades ni infla ese registro.
64. `Squad` conserva la afiliación real; `Player.teamId` sigue siendo solo
    espejo — un afiliado sin cobertura contractual materializada nunca se
    presenta como agente libre (`affiliated-contract-unknown`,
    BUG-WORLDSIM-05) ni puede negociarse.
65. Los sistemas interactivos españoles (contratos/inscripción/ciclo anual)
    procesan SOLO el cohorte `playable`
    (`CompetitionSimulationService.interactiveCohortTeams()`), nunca
    `getAllTeams()` a secas (BUG-WORLDSIM-06); `getAllTeams()` conserva su
    semántica de "todos los Teams registrados" para búsquedas/diagnóstico.
66. Instalar un Team `standard`/`abstract` no le aplica reglas españolas
    por accidente.
67. Un único `WorldCalendar` ordena partidos, marcadores compactos e hitos
    agregados en la MISMA cola cronológica (fuente `competition-simulation`
    además de `competition-match`).
68. Un fallo de resolución (partido o hito) no permite que el cursor lo
    salte por encima; el item queda `failed` en la cola.
69. Ningún módulo genérico nuevo de esta entrega (`WorldSimulation.js`,
    `CompetitionSimulationService.js`, `AbstractCompetitionStageRuntime.js`)
    contiene ids/reglas de España.
70. El juego español conserva sus 36 Teams/instancias e idéntico
    comportamiento observable — ACB/Primera FEB/Copa siguen `playable`
    explícito.
71. `data/real/*` no cambia; no se añade SQL/save-load/backend/dependencia
    nueva ni competición/club real nuevo en esta entrega.

**Ampliación NATIONAL-TEAMS-1** (ver 10.17; se auditan en
`scripts/test-national-teams1.js` y en el smoke):

72. Cada `Player` existe exactamente una vez en `PlayerRegistry`; club y
    selección referencian esa misma instancia viva.
73. Una convocatoria jamás cambia `Player.teamId` ni el contrato/
    inscripción de club — el jugador nunca "sale" de su club.
74. Puede existir un squad activo `club-service` y uno `national-team-duty`
    para el mismo jugador a la vez; nunca dos activos del MISMO contexto
    (`WorldRegistries.registerSquad()`/`validateIntegrity()`).
75. Un `Team` con `teamKind: 'national-team'` no tiene `clubId` y sí
    `federationOrganizationId` (una `Organization` real de tipo
    `national-federation`) y `representedAreaId` (un área real) válidos.
76. Todo `CompetitionEntry` referencia un `Team` existente cuyo `teamKind`
    coincide con `entry.participantType` — comprobado al REGISTRAR
    (`WorldRegistries.registerCompetitionEntry()`), no solo al final.
77. Selecciones y clubes usan el MISMO `CompetitionEngine`, `WorldCalendar`,
    `PATHWAYS` y niveles de detalle `playable/full/standard/abstract` — no
    hay un motor/calendario/pathway paralelo para selecciones.
78. La lista final de una `NationalTeamSelection` tiene el tamaño que fija
    el ruleset vigente, es subconjunto de una lista preliminar dentro de su
    máximo, y respeta el máximo de jugadores `eligible-restricted` — todo
    validado ANTES de mutar (`NationalTeamService.finalizeList()`).
79. `unknown` y `pending-decision` (`NationalTeamEligibilityService`) nunca
    se convierten en elegibles para una lista final.
80. Ciudadanía (`PlayerRegulatoryProfile.citizenships`), pasaporte
    (`passportEvidences`) y nacionalidad deportiva FIBA
    (`NationalStatusDecision`) son conceptos DISTINTOS — nunca se infiere
    uno de otro.
81. Un cambio de nacionalidad deportiva o un caso marginal (territorio/
    refugio/vínculo significativo) exige una `NationalStatusDecision`
    trazable — el motor nunca se arroga esa decisión.
82. Finalizar lista, incorporar (`startInternationalService`) y liberar
    (`endInternationalService`) son operaciones atómicas (todo se valida
    antes de mutar) e idempotentes (reprocesar un callup/paso ya resuelto
    no lo duplica ni falla).
83. Durante el servicio internacional ('joined'), tanto el club del usuario
    como la CPU ven el reason code `NATIONAL_TEAM_DUTY`
    (`EligibilityService`, vía `deps.nationalTeamRegistry` inyectado); al
    terminar la ventana, el jugador vuelve a estar disponible sin ninguna
    acción adicional (nunca salió de su club).
84. El squad de club, historial médico, desarrollo y carrera de un jugador
    convocado sobreviven intactos durante y después del servicio
    internacional.
85. Un resultado `standard`/`abstract` nunca fabrica una
    `NationalTeamAppearanceReceipt` — el propio constructor de la entidad
    rechaza `detailLevel` distinto de `playable`/`full`.
86. Ninguna selección entra en `CompetitionSimulationService.
    interactiveCohortTeams()` (bootstrap de contratos/registros/mercado/
    ciclo anual de clubes) — el cohorte filtra explícitamente por
    `teamKind === 'club-team'`.
87. Ninguna regla de `NationalTeamRules.js`/`NationalTeamEligibilityService.js`/
    `NationalTeamService.js` depende de España, `1ª`/`2ª`, ACB/FEB ni del
    orden de arrays/`Map` — auditado por construcción (módulos genéricos
    nuevos sin literales españoles) y por el test de determinismo (orden de
    registro invertido).
88. Consultar, describir, sincronizar o renderizar el dominio nacional
    (`NationalTeamRegistry`, la fuente `national-team-duty` del calendario)
    nunca muta ni consume aleatoriedad.
89. Todo diagnóstico/`toJSON()` del dominio nacional es serializable y no
    contiene instancias vivas/`Map`/funciones.
90. La partida española actual conserva exactamente su comportamiento y
    sus 36 equipos de club — no se instala ninguna federación/selección/
    ventana real en `data/world/spain-2026.1.js` ni en `game.js`.

### 10.11 Verificación reducida (esta entrega)

`node scripts/test-world-core1.js`: 27 comprobaciones dirigidas — jerarquía
geográfica/organizaciones, dependencias/atomicidad de paquetes, mundo sin
España, Definition/Edition/Stage/Entry, múltiples competiciones por equipo,
sin fallback de calendario, MoraBanc transfronterizo, identidad canónica/
aliases, auditoría estática de literales españoles. **27 OK, 0 fallos.**

`node scripts/smoke-world-core1.js`: construye la carrera con los 36
equipos reales, verifica mundo/geografía/organizaciones/clubes/equipos/
jugadores, juega UNA temporada completa (Liga+Copa+Playoff por el
título+Playoff de ascenso) con el runtime real, comprueba que la evidencia
de último partido oficial resuelve contra edition/stage canónicos, ejecuta
UNA transición anual completa reutilizando `scripts/cycle1-harness.js`
(MoraBanc Andorra desciende de verdad en la ejecución registrada) y
revalida integridad e identidad de instancias tras la transición. **OK en
~9-10s.**

Regresión ejecutada (sin repetir la matriz completa): `node
scripts/test-cycle1.js` (42 OK), `node scripts/test-roster1.js` (31 OK),
`node scripts/test-contract1.js` (102 OK), `node --check` sobre todo el
repositorio — 0 fallos en los cuatro. Checklist manual (móvil/escritorio,
Playwright) diferida a Dennis al terminar la EPIC completa.
