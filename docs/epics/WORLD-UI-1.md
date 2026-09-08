# Ficha de Epic — WORLD-UI-1 (configuración de carrera y navegación mundial)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `WORLD-UI-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Configuración de carrera y navegación mundial (sustituye la selección por división).
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/career-setup-and-navigation.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 9643-9914 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.18 WORLD-UI-1 — resultado

Octava entrega de la EPIC. Base: merge de la PR de NATIONAL-TEAMS-1 en
`origin/main` (`9fd7a08`). España deja de presentarse como estructura
universal en la interfaz: el usuario configura una carrera mediante
manifiestos de contenido, elige club sin construir el mundo durante el
render, y navega Mundo → continente → país/territorio → competición. No se
añade contenido: siguen World Core, Europa, España, Andorra, ACB, Primera
FEB, Copa ACB y la Supercopa solo catalogada.

#### 10.18.1 Snapshot y servicio de configuración

`src/entities/CareerSetup.js` — `CareerSetupSnapshot`: value object
explícito, validado y CONGELADO al construirse (`id, schemaVersion:
'world-ui-1', seasonKey, seasonStartYear, timeZoneId,
selectedContentPackIds[], controlledClubId, controlledTeamId, careerSeed,
defaultDetailLevel, simulationAssignments[], createdAtGameDate,
provenance`). `selectedContentPackIds` y `simulationAssignments` se
normalizan por id (nunca por el orden de clics de la interfaz); dos
assignments incompatibles para el mismo scope bloquean AL CONSTRUIRSE
(reutiliza el mismo criterio de conflicto que `WorldSimulationProfile`,
WORLD-SIM-1, nunca una segunda implementación). `toJSON()` es plano
(objetos/arrays/strings/números/booleanos), nunca `Map`/funciones. El
borrador de la pantalla (`state.careerSetupDraft` en `game.js`) es
MUTABLE; en cuanto `CareerSetupService.buildSnapshot()` lo valida y
congela, deja de ser autoridad.

`src/core/CareerSetupService.js` — servicio PURO (sin DOM, sin `state`
global, nunca construye `Team`/`Player`): `buildCatalog(manifests,
competitionCatalog)` proyecta metadatos `careerSetup` planos de cada
manifiesto + identidad de `CompetitionCatalog` en paquetes/temporadas/
husos/competiciones/clubes; `buildDefaultDraft()` arma el borrador por
defecto (paquetes raíz + seleccionables, temporada/huso `isDefault`,
niveles recomendados, sin competiciones `catalog-only`); `validateDraft()`
nunca corrige en silencio — devuelve `{valid, errors: [{code, message,
field}]}` con códigos (`MISSING_ROOT_PACK`, `MISSING_DEPENDENCY`,
`UNKNOWN_SEASON`, `UNKNOWN_TIME_ZONE`, `UNKNOWN_COMPETITION`,
`UNKNOWN_DETAIL_LEVEL`, `DETAIL_LEVEL_NOT_ALLOWED`,
`CONTROLLED_CLUB_WITHOUT_USER_STOP`, `MISSING_CONTROLLED_CLUB`,
`UNKNOWN_CLUB`, `MISSING_CAREER_SEED`, `MISSING_CREATED_AT_GAME_DATE`).
El cierre de dependencias de paquetes reutiliza EXACTAMENTE
`ContentPackRegistry.computeInstallOrder()` (nunca una segunda
comprobación que pudiera desincronizarse). `CONTROLLED_CLUB_WITHOUT_USER_STOP`
comprueba que la competición INICIAL declarada del club controlado
resuelve `allowsUserMatchStop` con el nivel elegido — alcance de esta
entrega, documentado: solo la competición inicial, no un grafo completo de
pathways multi-temporada. `buildSnapshot()`/`buildSimulationProfile()`
(deriva SIEMPRE el `WorldSimulationProfile` del snapshot — nunca una
segunda preferencia editable) /`buildStartPlan()` (manifiestos YA resueltos
en orden de dependencias) completan la producción.

#### 10.18.2 Contrato de manifiesto — metadatos `careerSetup`

`ContentPackManifest.careerSetup` (opcional, plano): `{isRootRequired,
seasons: [{seasonKey, seasonStartYear, isDefault}], timeZones:
[{timeZoneId, isDefault}], competitions: [{competitionDefinitionId,
recommendedDetailLevel, allowedDetailLevels}], clubs: [{clubId, teamId,
name, city, rosterSize, dataCoverage, initialCompetitionDefinitionId}]}`.
El core (`CareerSetupService.js`) solo conoce el SHAPE — auditado
estáticamente (`scripts/test-world-ui1.js`) sin ningún literal de
país/liga/división. `world-core-2026.1` declara `{isRootRequired: true}`
(raíz obligatoria, sin temporadas/competiciones propias). `spain-2026.1`
declara la vertical completa; sus competiciones catalogadas sin
`recommendedDetailLevel` (Supercopa) nunca reciben selección de nivel
(invariante 9). `SPAIN_CLUB_CONTENT` (`CLUB_CONTENT`) gana
`initialCompetitionDefinitionId` explícito por `teamId` (BUG-WORLDUI-09) —
fuente NUEVA de pertenencia competitiva, nunca `REAL_DATA_INDEX.division`;
nombre/ciudad/tamaño de roster se leen UNA VEZ del bundle real ya
existente por id, sin duplicarlo ni tocar `data/real/*`.

`spain-2026.1.install(world, context)` migra a un contexto CANÓNICO
`teamsByCompetitionId` (`{[competitionDefinitionId]: Team[]}`) — un
normalizador PRIVADO (`normalizeTeamsByCompetitionId()`) acepta
temporalmente el `teamsByDivision` legacy SOLO para los fixtures
históricos que aún lo construyen (`scripts/test-world-calendar1.js`,
`scripts/smoke-world-calendar1.js`, `scripts/test-club-core1.js` y
similares) — sin nuevos call-sites productivos de esa forma; retirada
definitiva del atajo legacy: **WORLD-HARDEN-1**.

#### 10.18.3 Arranque: `startCareerFromSetup(snapshot)`

`src/ui/game.js` sustituye `startSeason(teamId, division)` por
`startCareerFromSetup(snapshot)`: recibe el snapshot YA validado e
inmutable y deriva de él temporada/huso/paquetes/perfil de simulación —
ningún literal se decide dentro de la función salvo los que siguen siendo
contenido español explícito y permitido en esta capa (`game.js` es la
ÚNICA capa que conoce ACB/Primera FEB/Copa como literales). Orden real:
construir manifiestos resueltos (`CareerSetupService.buildStartPlan()`)
→ derivar la unión de `scheduleIds` declarados por esos paquetes y el
inicio de temporada MÁS TEMPRANO entre sus schedules (nunca el de ACB por
defecto, BUG-WORLDUI-03) → construir los 36 `Team`/`Player` reales (misma
construcción de siempre) → agrupar por `competitionDefinitionId` real
leyendo `SPAIN_CLUB_CONTENT.initialCompetitionDefinitionId`
(BUG-WORLDUI-09) → `WorldSimulationProfile` derivado del snapshot
(`CareerSetupService.buildSimulationProfile()`) → `GameWorld` construido
con los paquetes YA resueltos → inicializar TODAS las Editions
`active-runtime` de la temporada que el registro ya contiene
(`competitionEditions.forSeason(seasonKey)`, nunca dos ids ACB/Primera FEB
codificados, BUG-WORLDUI-03) → pathways/contratos/inscripción/mercado/
ciclo/selecciones (sin cambios de comportamiento) → `state.division`
asignado SOLO como proyección legacy final (`team.legacyDivision`), nunca
consultado como autoridad de aquí en adelante.

`buildCareerSeasonKey()` (BUG-WORLDUI-02) retira el fallback a
`new Date().getFullYear()` — ya no hace falta: la pantalla de
configuración no construye equipos/jugadores para previsualizar
(BUG-WORLDUI-01), así que la función solo se invoca con
`state.seasonStartYear` ya explícito (o lanza descriptivo si no lo hay).

#### 10.18.4 Pantalla de configuración (reemplaza la selección por división)

`renderCareerSetupScreen()` (mismo contenedor `#gm-team-select`, screen key
`'team-select'` sin cambios de wiring) sustituye a la antigua
`renderTeamSelectScreen()` — tres pasos compactos en la MISMA pantalla:

1. **Mundo** — paquetes instalados (World Core marcado "Requerido"),
   selector de temporada/huso (hoy una sola opción cada uno, pero
   implementado como selección real, no texto fijo).
2. **Competiciones** — por cada competición del catálogo: nombre, estado,
   selector de nivel de detalle (`<select>`, deshabilitado si solo admite
   un nivel) y una descripción DERIVADA de `capabilitiesForDetailLevel()`
   (parada de usuario, unidad temporal, tipo de resolución, cobertura
   exigida) — nunca un texto fijo por nombre de nivel. `catalog-only`
   (Supercopa) se ve deshabilitada y explicada ("Catalogada, sin edición
   activa"), nunca desaparece ni gana selector.
3. **Club** — tarjetas de club agrupadas por competición ACTUAL, leídas
   SOLO de metadatos planos (`catalog.clubs`, id/nombre/ciudad/tamaño de
   roster/cobertura) — BUG-WORLDUI-01 corregido: ningún render construye
   `Team`/`Player` ni consume RNG, ni siquiera al cambiar de club/paso
   repetidamente.

"Comenzar carrera" solo se habilita con `validateDraft().valid`; los
errores (código + mensaje) se listan bajo los pasos. Avanzar/retroceder
entre pasos conserva el borrador y no muta ningún registro.

#### 10.18.5 Navegador mundial (`WorldNavigationService.js` + pantalla Mundo)

`src/core/WorldNavigationService.js` — proyector PURO sobre
`WorldRegistries`/`CompetitionEngine`: `breadcrumbForArea`,
`childrenOfArea`, `organizationsForArea` (distingue sede vs ámbito,
DISTINTAS relaciones), `clubsForArea` (por `homeAreaId`),
`competitionsForArea` (por `scopeAreaId` propio),
`externalCompetitionsForAreaClubs` (competiciones de OTRA área en las que
participa un equipo de un club local — nunca cambia el `scopeAreaId` real
de la competición) y `competitionView()` (identidad + edición vigente +
fases con resultado tipado + participantes; `catalog-only` nunca fabrica
Edition/participantes). El resultado de cada fase se tipa
(`not-available|standings|standings-compact|bracket|bracket-compact`) vía
`capabilitiesForDetailLevel(edition.detailLevel).hasIndividualMatchDetail`
— nunca confunde ausencia de detalle con cero.

Nueva pantalla **Mundo** (`state.worldView: {kind: 'area'|'competition',
areaId, competitionDefinitionId, editionId}`, navegación EXCLUSIVAMENTE
por ids) con botón propio en `#gm-nav`. Casos verificados: `Mundo → Europa
→ España` (35 clubes, sin MoraBanc); `Mundo → Europa → Andorra` (MoraBanc,
sección "participa fuera de su área" con ACB, que conserva
`scopeAreaId: area-country-es`); Supercopa "Catalogada, sin edición
activa"; consultar/repetir consulta nunca muta ni consume RNG
(verificado con orden de registro invertido). El `<details>` técnico de
Home (`buildWorldDetailHtml()`, `world.describe()`) se conserva como
diagnóstico discreto — BUG-WORLDUI-08 se corrige AÑADIENDO la navegación
real, no quitando el detalle técnico.

#### 10.18.6 Migración de Inicio/Calendario/Competiciones/Estadísticas

`state.division` deja de ser AUTORIDAD de ninguna pantalla productiva
(BUG-WORLDUI-04) — sobrevive solo como proyección legacy
(`team.legacyDivision`, escrita tras `startCareerFromSetup()` y tras cada
cierre de temporada). Nuevas funciones resuelven por participación REAL
(`CompetitionParticipationService.primaryLeagueCompetitionId`), nunca por
igualdad de string: `teamLeagueCompetitionId(team)`, `getLeagueForTeam(team)`,
`userLeagueCompetitionId()`, `isUserInTopFlight()`, `getUserBracketsReal()`.
`getUserLeague()` se redefine en términos de estas — todo consumidor
existente (más de una decena de call-sites: partido en vivo, noticias,
rachas, agenda) queda corregido sin tocarlos uno a uno.

- **Inicio**: `${state.division} División` sustituido por el nombre real
  de la competición (`CompetitionParticipationService` +
  `CompetitionDefinition.name`) más un enlace "Ver en Mundo" que navega a
  la pantalla Mundo enfocada en esa competición.
- **Competiciones/Estadísticas** (BUG-WORLDUI-05): las pestañas Copa/
  Playoff vs. Ascenso se deciden con `isUserInTopFlight()` (participación
  real), nunca `state.division === '1ª'`; los brackets se resuelven con
  `getUserBracketsReal()`.
- **Estadísticas** (`aggregatePlayerStats()`, BUG-WORLDUI-06): un
  resultado sin `hasIndividualMatchDetail(result)` (nivel `standard`/
  `abstract`) se EXCLUYE de las medias — nunca accede ciegamente a
  `result.boxScore.home/away` ni fabrica ceros. Hoy sin efecto observable
  (ACB/Primera FEB/Copa son `playable`), protege cualquier competición
  futura no `playable`.
- **Noticias/lesiones** (`pushMedicalDiffEvents`/`pushMedicalMatchEvents`,
  BUG-WORLDUI-07): filtran por `teamLeagueCompetitionId(team) ===
  userLeagueCompetitionId()` — identidad de participación real, nunca
  `team.division !== state.division`.
- **Cierre de temporada** (`isSeasonFullyClosable()`, sección 7.3 del
  prompt): ya no pregunta "¿han terminado 1ª y 2ª?" — deriva las
  competiciones de club `active-runtime` del registro
  (`activeClubLeagueCompetitionIds()`) y comprueba cada una
  (`isCompetitionFullyDone()`), nunca un mapa fijo de dos divisiones. Los
  brackets asociados a cada liga (Copa/playoff por el título para ACB,
  playoff de ascenso para Primera FEB) siguen siendo estructura española
  conocida, permitida en `game.js`.
- `getLeague(division)`/`getBrackets(division)`/`competitionIdForDivision()`
  SOBREVIVEN únicamente como puente interno de `closeSeasonAndPrepareNext()`
  (honores de cierre de temporada, vía `SeasonHistoryService`) — ningún
  call-site productivo de PANTALLA los usa ya. Retirada definitiva de este
  puente interno: **WORLD-HARDEN-1** (requiere migrar el cierre de
  temporada a facades por `competitionDefinitionId`, fuera de alcance
  aquí). `UI_COMPETITION_KEY_BY_STAGE_KEY`/`competitionKeyForStageKey()`
  (traducción legacy `stageKey` → `league/cup/playoff/promotion` para
  noticias/`BRACKET_PHASE_IDS`) tampoco se retira en esta entrega — sigue
  siendo puente de INTERFAZ/normativa, nunca decide tiempo; mismo
  propietario de retirada.

#### 10.18.7 Bugs verificados

BUG-WORLDUI-01 a BUG-WORLDUI-09 (sección 8 del prompt) — los nueve
confirmados presentes en el `main` real al empezar y corregidos según se
describe en 10.18.3-10.18.6 arriba.

#### 10.18.8 Pruebas de esta entrega

`node scripts/test-world-ui1.js` — 20 comprobaciones agrupadas: snapshot
(orden/inmutabilidad/serialización/conflicto de assignments), catálogo
desde manifiestos reales (36 clubes/4 competiciones/1 temporada-huso, sin
construir Team/Player), validación (paquete raíz ausente, nivel no
permitido, club sin parada de usuario con catálogo sintético, club
inexistente), mundo real construido desde el snapshot (36 equipos,
Editions con el nivel congelado, integridad), `teamsByCompetitionId` real
(BUG-WORLDUI-09), breadcrumb y relaciones de área/organización/club,
MoraBanc/Andorra/ACB transfronterizo, Supercopa `catalog-only`, fases/
participantes/resultado honesto (antes y después de resolver un partido),
orden de registro invertido sin cambiar el view model, consulta repetida
sin mutación, auditoría estática sin literales de España en los tres
módulos genéricos nuevos. **20 OK, 0 FAIL.**

`node scripts/smoke-world-ui1.js` — configuración por defecto (Unicaja)
→ carrera real (36 equipos, Editions derivadas del registro) → `Mundo →
Europa → España (35 clubes) / Andorra (MoraBanc, ACB) → ACB (18
participantes)` → "Continuar" hasta la primera parada real del equipo
controlado. **OK en ~0.1s.**

Regresiones autorizadas ejecutadas, sin cambio de comportamiento
pretendido: `node scripts/test-world-calendar1.js` (**25 OK, 0 FAIL**),
`node scripts/test-world-sim1.js` (**19 OK, 0 FAIL**), `node
scripts/test-national-teams1.js` (**19 OK, 0 fallos**). Comprobación
adicional no exigida por el presupuesto reducido, ejecutada por afectar a
`spain-2026.1.js` de forma amplia: `node scripts/test-club-core1.js`
(**36 comprobaciones OK, 0 fallidas**). `node --check` sobre todo el JS
nuevo/modificado y `git diff --check`: sin errores.

**Hallazgo no atribuible a esta entrega**: `scripts/smoke-world-calendar1.js`
falla ya en `origin/main` (antes de cualquier cambio de WORLD-UI-1) porque
`buildCareerWorld()` no le pasa `simulationProfile` y, desde WORLD-SIM-1,
`spain-2026.1.js` exige esa dependencia para resolver `detailLevel` —
mismo patrón ya documentado para `scripts/test-club-core1.js` en 10.17.8.
No forma parte de la verificación reducida obligatoria de esta entrega;
queda señalado para quien retome ese script.

#### 10.18.9 Fuera de alcance de esta entrega

Contenido real europeo/mundial, países, clubes, ligas o selecciones
adicionales; modo seleccionador nacional; crear/eliminar paquetes desde la
UI o descargar contenido; editor de formatos/reglas/calendarios/pathways;
materialización/desmaterialización dinámica de plantillas; persistencia/
save-load/backend; rediseño visual completo; cambios a contratos/mercado/
transferencias/cesiones/tácticas/`MatchEngine`/balance; limpieza completa
de los shims legacy documentados en 10.18.6 (propiedad de
**WORLD-HARDEN-1**); un grafo completo de pathways multi-temporada para
`CONTROLLED_CLUB_WITHOUT_USER_STOP` (solo comprueba la competición
inicial); cambios a `data/real/*`.

_Migrado de `CHANGELOG.md` (líneas 517-670 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-07 — WORLD-UI-1: configuración de carrera y navegación mundial (DESIGN.md sección 10.18)

Octava entrega de la EPIC **World Architecture** (WORLD-CORE-1 →
CLUB-CORE-1 → COMP-CORE-1 → WORLD-CALENDAR-1 → PATHWAYS-1 → WORLD-SIM-1 →
NATIONAL-TEAMS-1 → **WORLD-UI-1** → WORLD-HARDEN-1). Base: merge de la PR
de NATIONAL-TEAMS-1 en `origin/main` (`9fd7a08`). Rama
`claude/modest-gauss-ab8bat`.

La interfaz deja de presentar España/`1ª`/`2ª` como estructura universal:
el usuario configura una carrera mediante paquetes de contenido y niveles
de simulación, elige club sin construir el mundo durante el render, y
navega Mundo → continente → país/territorio → competición. No se añade
contenido: siguen World Core, Europa, España, Andorra, ACB, Primera FEB,
Copa ACB y la Supercopa solo catalogada.

### Bugs/deudas corregidos

- **`BUG-WORLDUI-01`** — `renderTeamSelectScreen()` llamaba a
  `getRealTeamsByDivision()` y construía instancias reales de
  `Player`/`Team` en CADA render (incluso al cambiar de pestaña de
  división), consumiendo el generador de relleno ficticio de cobertura.
  *Corrección*: la nueva pantalla de configuración (`renderCareerSetupScreen()`,
  paso "Club") lee SOLO metadatos planos (`CareerSetupService.buildCatalog()`
  → `manifest.careerSetup.clubs`) — la construcción real ocurre una única
  vez, tras pulsar "Comenzar carrera".
- **`BUG-WORLDUI-02`** — `buildCareerSeasonKey()` caía a
  `new Date().getFullYear()` si `state.seasonStartYear` no existía
  todavía (usado por las tarjetas de previsualización de selección).
  *Corrección*: retirado el fallback — la pantalla de configuración ya no
  construye equipos para previsualizar, así que la función solo se llama
  con la temporada ya explícita (lanza descriptivo en cualquier otro
  caso).
- **`BUG-WORLDUI-03`** — `startSeason()` fijaba dentro de `game.js` los
  dos manifiestos, el huso horario, los tres `scheduleIds` y las dos
  Editions de arranque (ACB/Primera FEB) como literales sueltos.
  *Corrección*: `CareerSetupService.buildStartPlan()` resuelve los
  manifiestos en orden de dependencias desde el snapshot; el huso y el
  perfil de simulación se derivan del propio snapshot
  (`buildSimulationProfile()`); el inicio de temporada es el MÁS TEMPRANO
  entre los `scheduleIds` que esos paquetes declaran (nunca el de ACB por
  defecto); las Editions de arranque a inicializar se DERIVAN del
  registro (`competitionEditions.forSeason(seasonKey)`), nunca dos ids
  codificados.
- **`BUG-WORLDUI-04`** — `state.division` gobernaba selección de equipo,
  pestañas de Competiciones/Estadísticas, el hero de Inicio y el filtro de
  noticias/lesiones médicas. *Corrección*: nuevas funciones resuelven por
  participación REAL vía `CompetitionParticipationService`
  (`teamLeagueCompetitionId(team)`, `getLeagueForTeam(team)`,
  `userLeagueCompetitionId()`, `isUserInTopFlight()`,
  `getUserBracketsReal()`); `getUserLeague()` se redefine en términos de
  ellas, corrigiendo de paso a todos sus consumidores existentes (partido
  en vivo, rachas, agenda...) sin tocarlos uno a uno. `state.division`
  sobrevive solo como proyección legacy (`team.legacyDivision`) y como
  puente interno de `closeSeasonAndPrepareNext()`.
- **`BUG-WORLDUI-05`** — Competiciones/Estadísticas tenían tabs fijas
  `league/cup/playoffs/promotion` decididas por `state.division === '1ª'`.
  *Corrección*: la visibilidad de Copa/Playoff vs. Ascenso se decide con
  `isUserInTopFlight()` (participación real); los brackets se resuelven
  con `getUserBracketsReal()`.
- **`BUG-WORLDUI-06`** — `aggregatePlayerStats()` accedía ciegamente a
  `result.boxScore.home/away`, incompatible con un resultado `standard`/
  `abstract` (WORLD-SIM-1) que nunca lleva `boxScore` por jugador.
  *Corrección*: un resultado sin `BM.hasIndividualMatchDetail(result)` se
  EXCLUYE de las medias — nunca fabrica ceros ni lanza. Sin efecto
  observable hoy (ACB/Primera FEB/Copa son `playable`).
- **`BUG-WORLDUI-07`** — `pushMedicalDiffEvents()`/`pushMedicalMatchEvents()`
  filtraban noticias/lesiones comparando `team.division`/`homeTeam.division`
  contra `state.division`. *Corrección*: comparan
  `teamLeagueCompetitionId(team) === userLeagueCompetitionId()` — identidad
  de participación real, nunca igualdad de string de división.
- **`BUG-WORLDUI-08`** — el mundo de la carrera solo aparecía como un
  `<details>` técnico plegado en Inicio (`world.describe()`), sin ninguna
  navegación real. *Corrección*: `src/core/WorldNavigationService.js`
  (proyector puro) + pantalla **Mundo** nueva (`state.worldView`, botón
  propio en `#gm-nav`) — el `<details>` técnico se conserva tal cual como
  diagnóstico discreto, ahora complementado por la navegación real.
- **`BUG-WORLDUI-09`** — `spain-2026.1.install()` exigía
  `context.teamsByDivision` (`{'1ª': [...], '2ª': [...]}`) aunque la
  pertenencia canónica ya vivía en Entries/CompetitionDefinition desde
  COMP-CORE-1. *Corrección*: `install()` migra a un contexto canónico
  `teamsByCompetitionId` (`{[competitionDefinitionId]: Team[]}`); un
  normalizador privado acepta temporalmente `teamsByDivision` SOLO para
  fixtures históricos (`scripts/test-world-calendar1.js`/
  `smoke-world-calendar1.js`/`test-club-core1.js`); `SPAIN_CLUB_CONTENT`
  gana `initialCompetitionDefinitionId` explícito por `teamId` — fuente
  NUEVA de pertenencia competitiva, ya no `REAL_DATA_INDEX.division`.
- Corrección incidental encontrada al ejecutar la regresión adicional (no
  es un `BUG-WORLDUI-0x`, sin relación con esta entrega, mismo patrón ya
  documentado para NATIONAL-TEAMS-1): `scripts/smoke-world-calendar1.js`
  falla ya en `origin/main` porque construye el mundo sin
  `simulationProfile`; no forma parte de la verificación reducida
  obligatoria de esta entrega, queda señalado para quien retome ese
  script.

### Entidades, servicios y ficheros añadidos

`src/entities/CareerSetup.js` (`CareerSetupSnapshot`, congelado,
validado, serializable), `src/core/CareerSetupService.js` (catálogo desde
manifiestos, borrador por defecto, validación con códigos, snapshot/perfil
de simulación/plan de arranque), `src/core/WorldNavigationService.js`
(breadcrumb, hijos de área, organizaciones por sede/ámbito, clubes por
área, competiciones por área, competiciones externas, vista de
competición con resultado tipado), `scripts/test-world-ui1.js`,
`scripts/smoke-world-ui1.js`.

### Ficheros modificados

`data/world/world-core-2026.1.js` (metadatos `careerSetup: {isRootRequired:
true}`), `data/world/spain-2026.1.js` (`careerSetup` completo: temporada/
huso/competiciones/clubes; `initialCompetitionDefinitionId` en
`SPAIN_CLUB_CONTENT`; `teamsByCompetitionId` canónico con normalizador
legacy), `src/ui/game.js` (pantalla de configuración de 3 pasos reemplaza
la selección por división; `startCareerFromSetup()` reemplaza
`startSeason()`; pantalla Mundo nueva; Inicio/Competiciones/Estadísticas/
noticias/lesiones migrados fuera de `state.division`;
`isSeasonFullyClosable()` deriva de las competiciones de club
`active-runtime` reales), `src/ui/game.css` (estilos de la pantalla de
configuración y de la pantalla Mundo, reutilizando componentes
existentes), `index.html` (scripts nuevos, botón y pantalla "Mundo").

### Pruebas realmente ejecutadas

`node scripts/test-world-ui1.js` (**20 OK, 0 FAIL**), `node
scripts/smoke-world-ui1.js` (**OK en ~0.1s**). Regresiones obligatorias:
`node scripts/test-world-calendar1.js` (**25 OK, 0 FAIL**), `node
scripts/test-world-sim1.js` (**19 OK, 0 FAIL**), `node
scripts/test-national-teams1.js` (**19 OK, 0 fallos**). Regresión
adicional no exigida, ejecutada por el alcance amplio del cambio en
`spain-2026.1.js`: `node scripts/test-club-core1.js` (**36 OK, 0
fallidas**). `node --check` sobre todo el JS nuevo/modificado y `git diff
--check`: sin errores.

### Comprobaciones manuales pendientes (Dennis)

- Configurar la carrera por defecto y elegir un club ACB/Primera FEB.
- Comprobar los errores de una combinación de niveles incompatible.
- Navegar Mundo/Europa/España/Andorra/ACB.
- Revisar Inicio, Calendario, Competiciones y Estadísticas antes/después
  de partidos y de la activación de Copa/playoff.
- Repetir el recorrido en móvil al cierre de la EPIC.

### Límites y siguiente entrega

`data/real/*`, dependencias y persistencia NO cambiaron. Shims que quedan,
con dueño **WORLD-HARDEN-1**: `getLeague`/`getBrackets`/
`competitionIdForDivision` como puente interno de
`closeSeasonAndPrepareNext()`; `UI_COMPETITION_KEY_BY_STAGE_KEY`;
`teamsByDivision` en fixtures históricos; `state.division` como
proyección legacy. `CONTROLLED_CLUB_WITHOUT_USER_STOP` solo comprueba la
competición inicial declarada de un club, no un grafo completo de
pathways multi-temporada. Siguiente entrega: **WORLD-HARDEN-1** (retira
todos los puentes legacy de España, audita determinismo/población,
prepara la frontera de persistencia).
