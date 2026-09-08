# Ficha de Epic — COMP-CORE-1 (motor genérico de competiciones)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `COMP-CORE-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Motor genérico de competiciones (runners, engine, formato como contenido).
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/competition-engine.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 8491-8676 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.13 COMP-CORE-1 — resultado

Tercera entrega de la EPIC (ver 10.1). Retira la deuda que WORLD-CORE-1
dejó señalada explícitamente en 10.5/10.8: `SpainLegacyCompetitionRuntime`
y `League`/`Bracket`/`Cup`/`Playoffs`/`Promotion` como AUTORIDAD operativa
de Liga/Copa/Playoffs/Ascenso. `CompetitionEdition`/`CompetitionStage`/
`CompetitionEntry` pasan de ser identidad canónica ENLAZADA a un runtime
fijo a ser la autoridad REAL que un motor genérico ejecuta.

**Formato, engine, registry y runners**: `CompetitionFormatDefinition`/
`CompetitionStageTemplate` (`src/entities/Competition.js`, ver 10.3) son la
definición VERSIONADA y serializable del formato de una competición —
puro dato, nunca funciones/instancias Team/`Map` incrustados.
`CompetitionFormatCatalog.js` los registra (mismo criterio que
`CompetitionCatalog.js` con las `CompetitionDefinition`, catálogo estático
compartido, no por carrera). `RoundRobinStageRunner`/`BracketStageRunner`
(`src/core/CompetitionRunners.js`) son los algoritmos GENÉRICOS reales —
extraídos de `League.js`/`Bracket.js` sin duplicarlos: round-robin acepta
cualquier número de participantes (bye EXPLÍCITO si es impar, nunca un
partido contra un equipo falso), vueltas/puntuación/desempate configurables
por `runnerConfig` (los 5 pasos de desempate son tipos GENÉRICOS —
`group-head-to-head-balance`/`-point-diff`, `overall-point-diff`/
`-points-for`/`-quotient-sum` — nunca llamados "ACB" dentro del runner);
bracket soporta partido único/BO3/BO5 con avance FIJO (un reseed entre
fases se expresa como una fase NUEVA vía `entrySource`
`stage-bracket-final-round-winners`, nunca reordenando dentro del mismo
runner). `CompetitionEngine.js` es la fachada/orquestador por CARRERA
(nunca singleton, nunca lee `state`/DOM/reloj de sistema/aleatoriedad
propia): inicializa una Edition desde su formato y Entries ya registradas,
activa fases declaradas cuando el hecho genérico correspondiente ocurre
(`round-completed`/`stage-completed`, evaluados por tipo — nunca por
"es ACB"), resuelve partidos por id (rechaza una segunda resolución),
consulta clasificación/bracket/resultados sin mutar ni consumir
aleatoriedad, y cierra fase/edición actualizando Entries en una única ruta
de commit. `CompetitionRuntimeRegistry.js` guarda los runners VIVOS de la
carrera (transitorio, nunca en `WorldRegistries`/serializado directamente
— `runner.snapshot()` sí es JSON plano).

**Descriptor de partido**: todo partido (liga o eliminatoria) es un objeto
plano con `id` global estable (derivado de edition/stage/ronda o
serie+partido — nunca de local/visitante ni de nombre visible, así que el
mismo emparejamiento nunca colisiona entre temporadas),
`competitionDefinitionId`/`competitionEditionId`/`stageId`/`stageKey`,
`homeParticipantId`/`awayParticipantId` (+`homeEntryId`/`awayEntryId`),
`status`, fecha real y resultado. La fecha y el id se fijan ANTES de
invocar `MatchEngine` (BUG-COMPCORE-03, ver más abajo) — consultar el
siguiente partido pendiente (`peekNextPendingMatch()`) nunca lo juega ni
consume aleatoriedad. El runner guarda SOLO ids; los Teams se resuelven
vía `resolveParticipant(id)` justo en la frontera con `MatchEngine`. La
UI (fachadas `League`/`Bracket`) añade `homeTeam`/`awayTeam` como vista
TRANSITORIA, nunca otra fuente.

**Configuración española**: `data/world/spain-2026.1.js` registra tres
`CompetitionFormatDefinition` — `acb-liga-playoff` (liga regular 18
equipos/ida-vuelta/2-1 puntos + playoff por el título top-8, cuadro
1-8/4-5/2-7/3-6, cuartos BO3 1-1-1, semis/final BO5 2-2-1),
`primera-feb-liga-ascenso` (liga regular igual + cuartos de ascenso BO5
2-2-1 sobre 2º-9º, cuadro 2-9/3-8/4-7/5-6, + Final Four reseedeada
best-vs-worst de los 4 ganadores) y `copa-acb-knockout` (tres rondas a
partido único, cuadro 1-8/4-5/2-7/3-6). Los 5 pasos de desempate se
declaran IGUAL en ambos formatos de liga (compatibilidad documentada,
nunca presentada como normativa nueva). Ninguno de estos números vive en
los runners genéricos — auditado en `scripts/test-comp-core1.js`. El
alias `spain-2026.1:schedule:1a`/`2a` (añadido en `MatchConfig.js`, MISMO
objeto de perfil que `'1ª'`/`'2ª'`) deja a `Calendar.getScheduleProfile()`
resolver el `scheduleProfileId` que ya declaraba
`CompetitionCatalog.js` — puente marcado para retirada en
WORLD-CALENDAR-1, igual que el propio literal `'1ª'`/`'2ª'`. La Copa gana
su PROPIO `RulesetBundle` (`copa-acb-domestic-2025-26-v1`, en
`CompetitionRules.js`) que reutiliza POR ID (nunca copia) el módulo de
inscripción/overlay de convenio de ACB — nunca fingiendo ser la Liga.

**Activaciones y transición temporal**: la fase regular se activa al
crear la Edition (`initial-participants`, registrado por
`spain-2026.1.js` directamente contra `WorldRegistries`, ANTES de que
exista el engine); el playoff por el título/de ascenso se activan por
cascada INTRA-edición (`stage-completed` sobre `regular-season`,
declarado en el propio formato); la Copa se activa por una regla CRUZADA
de edición (`round-completed` en la jornada 17 de ACB,
`spain-2026.1.buildSeasonActivationPlan()`) — la única pieza que conoce
que Copa depende de OTRA competición, evaluada genéricamente por el
engine (`triggerStageId`/`triggerType`/`triggerRound`, nunca
`if (competitionId === 'acb')`). El cierre de temporada
(`bindNewSeasonEditions()`) completa las ediciones activas previas y abre
las de la temporada siguiente sobre el MISMO `GameWorld`/
`CompetitionEngine` — nunca se reconstruye ninguno de los dos.

**Migración de participación/contexto**: `buildMatchCompetitionContext()`
recibe el `competitionId` REAL del partido concreto cuando quien llama lo
conoce (descriptor canónico de liga o de bracket) — nunca lo deriva de
`team.division`; sin partido concreto (pantalla de Alineación antes de
jugar), resuelve la Liga doméstica PRINCIPAL del Team vía
`CompetitionParticipationService.primaryLeagueCompetitionId()` (Entry
real, nunca "la primera"/ACB por defecto). El resto de call-sites
productivos que traducían `team.division` (mercado, renovación, promoción
de cantera, evidencia de último partido oficial, expiración de
inscripciones al cierre de temporada) migran al mismo servicio.
`competitionIdFromLegacyDivision()` queda sin nuevos call-sites
productivos (solo scripts/tests históricos).

**Bugs corregidos**:
- `BUG-COMPCORE-01` (integridad cruzada): `WorldRegistries.
  registerCompetitionEntry()`/`registerCompetitionStage()` ahora
  rechazan un Entry cuyo Stage pertenece a otra Edition y un
  `sourceStageIds`/`nextStageIds` que conecte stages de otra Edition;
  `validateIntegrity()` audita además el grafo completo (referencias
  huérfanas y ciclos) para las conexiones registradas fuera de orden.
  `registerCompetitionDefinition()` exige `organizerId` existente
  (invariante 9, antes sin comprobar).
- `BUG-COMPCORE-02` (Copa mentía sobre su competición): el descriptor de
  partido/contexto de un partido de Copa recibe SIEMPRE
  `competitionDefinitionId: 'copa-acb'` — nunca `'acb'` derivado de
  `team.division`. Corregido en `buildMatchCompetitionContext()`/
  `resolveNextMatchContextForTeam()`/`resolveBracketOptionsFor()` (game.js)
  y en la evidencia de último partido oficial
  (`applyRecoveryForResolvedMatch()`). La Copa gana su propio
  `RulesetBundle` para que resolver sobre ese id no lance.
- `BUG-COMPCORE-03` (fecha/id aproximados): `BracketStageRunner` crea el
  descriptor (id global + fecha real) ANTES de invocar `MatchEngine` —
  `Series.playNextGame()` calculaba la fecha DESPUÉS de simular; los
  partidos de Liga tampoco tenían id canónico
  (`league:{round}:{home}:{away}` se repetía entre temporadas). Ahora
  `Bracket.js` expone `peekNextPendingGame()` y su `resolveOptions` recibe
  `(homeEntry, awayEntry, scheduledDate, matchId)` reales — game.js deja
  de aproximar con `state.calendar.currentGameDateTime` y de reconstruir
  un `matchId` a mano.

**Shims restantes y propietario de retirada**: ver tabla actualizada en
10.8. `SpainLegacyCompetitionRuntime.js` sigue existiendo solo para
`scripts/test-world-core1.js`/`smoke-world-core1.js`/`smoke-club-core1.js`
(nunca cargado por `index.html`/`game.js`/`spain-2026.1.js`) —
`competitionIdFromLegacyDivision()` sigue exportado para scripts
históricos, sin nuevos call-sites productivos; ambos se retiran
definitivamente en WORLD-HARDEN-1. `state.leagues`/`state.brackets` siguen
como mapa fijo por división hasta WORLD-CALENDAR-1, pero desde esta
entrega son SIEMPRE vistas (`League`/`Bracket`/`PromotionPlayoff`-shaped)
construidas por `game.js` a partir de los runners reales del
`CompetitionEngine` — nunca un segundo estado sincronizado a mano.
`League.js`/`Bracket.js`/`Cup.js`/`Playoffs.js`/`Promotion.js` sobreviven
como fachadas finas que delegan en los mismos runners (constructor con un
parámetro opcional de runner ya construido) — mismo código, nunca
duplicado; siguen siendo el punto de construcción para scripts/tests
históricos que los llaman de forma standalone.

**Pruebas reales** (sección 15 del prompt): `node scripts/test-comp-core1.js`
(32 comprobaciones dirigidas — formato/versionado/inmutabilidad, bindings
congelados, los tres bugs, round-robin par/impar con bye, una/dos vueltas,
puntuación/desempate configurables, bracket BO1/BO3/BO5 con avance fijo,
descriptor antes de simular en ambos runners, doble resolución rechazada,
activación idempotente, snapshots JSON limpios, consultas sin mutar/RNG,
orden de inserción irrelevante, fixture NO español con ambos runners
encadenados, Copa con bundle propio, participación sin "la primera",
auditorías estáticas de literales españoles/shims productivos — **32 OK,
0 fallos**), `node scripts/smoke-comp-core1.js` (36 equipos reales, UNA
temporada completa de ACB/Primera FEB vía el engine con Copa activada en
jornada 17, playoff por el título y playoff de ascenso con Final Four
reseedeada, ids/fechas verificados antes de simular, contexto de acta/
elegibilidad de Copa con su competitionId real, UNA transición anual
completa con el arnés de CYCLE-1 y revalidación de integridad —
MoraBanc Andorra comprobado antes y después del ciclo — **OK en ~5-6s**),
`node scripts/test-world-core1.js` (27 OK, sin cambios de fixture — el
esquema de ids de `registerEditionWithInitialEntries()` reproduce
exactamente el de `bindCareerStart()` histórico), `node
scripts/test-club-core1.js` (36 OK, sin cambios), `node
scripts/test-reg1.js` (88 OK, sin cambios de fixture — el contexto de
partido sigue resolviendo el mismo `registrationScopeId`), `node
scripts/test-cycle1.js` (42 OK, sin cambios — la transición anual sigue
recibiendo `League`/`Bracket` con la misma forma). `node --check` sobre
todos los `.js` nuevos/modificados y `git diff --check`: sin errores.
**0 fallos en toda la batería autorizada.**

**Fuera de alcance de esta entrega** (igual que 10.7/10.12, sin cambios):
cola de calendario mundial (WORLD-CALENDAR-1), pathways/ascenso-descenso
genéricos (PATHWAYS-1), competiciones europeas reales, selecciones,
persistencia SQL/save-load, limpieza completa de `division` en
estadísticas/textos históricos, la deuda naming-only de Cycle sobre
ciertos campos `clubId`.

**Actualización PATHWAYS-1 (ver 10.15):** el `CompetitionFormatDefinition`
español productivo YA NO posee selección (`activation`/`entrySource` de
`title-playoff`/`promotion-quarterfinals`/`promotion-final-four` pasan a
`'pathway-managed'`) — el formato conserva SOLO `runnerConfig`
(cuadro/patrones de campo) y la fase inicial `edition-start`. La Copa deja
de activarse por `registerCrossEditionActivation()` productivamente: la
activa la regla de pathway `acb-copa-qualification`.

_Migrado de `CHANGELOG.md` (líneas 1428-1655 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-06 — COMP-CORE-1: motor genérico de competiciones (DESIGN.md sección 10.13)

Tercera entrega de la EPIC **World Architecture** (WORLD-CORE-1 →
CLUB-CORE-1 → **COMP-CORE-1** → WORLD-CALENDAR-1 → PATHWAYS-1 →
WORLD-SIM-1 → NATIONAL-TEAMS-1 → WORLD-UI-1 → WORLD-HARDEN-1). Base:
`42a1cc9a42db67fc55d5b3f3634ec96e1eff8eae` (`origin/main`, merge de la PR
#47 CLUB-CORE-1). Rama `feat/comp-core-1`. Invierte la relación que
WORLD-CORE-1 dejó pendiente: `CompetitionEdition`/`CompetitionStage`/
`CompetitionEntry` dejan de ser identidad canónica enlazada a un runtime
fijo español para ser la autoridad REAL que un motor genérico ejecuta —
ACB, Primera FEB, Copa y los dos playoffs pasan a ser la primera
configuración de contenido de ese motor, no el motor en sí.

### Diagnóstico y bugs corregidos

- **`BUG-COMPCORE-01`** (integridad cruzada entre ediciones):
  `WorldRegistries.registerCompetitionEntry()` comprobaba que el `Stage`
  de un Entry existiera, pero no que perteneciera a la MISMA Edition que
  el propio Entry — era posible registrar un Entry en la edición B
  apuntando a un Stage de la edición A. `registerCompetitionStage()`
  tenía el mismo hueco con `sourceStageIds`/`nextStageIds`, y
  `registerCompetitionDefinition()` no comprobaba que `organizerId`
  existiera (invariante 9). Corregido: ambos métodos rechazan ahora la
  referencia cruzada en el momento de registrar; `validateIntegrity()`
  audita además el grafo completo de `sourceStageIds`/`nextStageIds`
  (referencias huérfanas y ciclos, con DFS por pila de recursión — no un
  "ya visto" global, que daría falsos positivos ante nodos convergentes
  que no son un ciclo real) para las conexiones registradas fuera de
  orden.
- **`BUG-COMPCORE-02`** (la Copa mentía sobre su propia competición):
  `buildMatchCompetitionContext()` derivaba SIEMPRE el `competitionId` de
  `team.division` — un partido de Copa recibía normativa/acta/evidencia
  con `competitionId: 'acb'`, nunca `'copa-acb'`, aunque la Copa ya tenía
  identidad mundial separada desde WORLD-CORE-1. Corregido: el contexto
  de un partido concreto recibe el `competitionId` REAL del descriptor
  canónico de ESE partido (liga o eliminatoria) cuando quien llama lo
  conoce; sin partido concreto, se resuelve la Liga doméstica PRINCIPAL
  del Team vía `CompetitionParticipationService` (Entry real, nunca "la
  primera"). Se añade el `RulesetBundle` propio de Copa
  (`copa-acb-domestic-2025-26-v1`, reutiliza por id el módulo de
  inscripción/overlay de convenio de ACB, nunca lo copia) para que
  resolver sobre `competitionId: 'copa-acb'` no lance.
- **`BUG-COMPCORE-03`** (descriptor de partido aproximado): `Bracket.
  Series.playNextGame()` calculaba la fecha real del partido DESPUÉS de
  simularlo, así que todo sistema prepartido (descanso, entrenamiento,
  elegibilidad, acta) recibía una aproximación (`state.calendar.
  currentGameDateTime`); los partidos de Liga tampoco tenían id canónico
  propio (`league:{round}:{home}:{away}` se repetía entre temporadas).
  Corregido en ambos runners genéricos: el descriptor (id global estable
  + fecha real) se crea ANTES de invocar `MatchEngine`
  (`BracketStageRunner._ensureNextGameDescriptor()`/`RoundRobinStageRunner`
  ya lo hacía al construir el calendario) — `Bracket.js` expone
  `peekNextPendingGame()` y su `resolveOptions` recibe ahora
  `(homeEntry, awayEntry, scheduledDate, matchId)` reales; `game.js` deja
  de aproximar con el reloj de mundo y de reconstruir un `matchId` a
  mano.

### Motor genérico: formato, engine, registry y runners

- **`CompetitionFormatDefinition`/`CompetitionStageTemplate`**
  (`src/entities/Competition.js`): definición VERSIONADA y serializable
  del formato de una competición — `stageTemplates` con `runnerType`
  (`round-robin`/`bracket`), `activation` (`edition-start`|
  `stage-completed`+`sourceStageKey`|`round-completed`+`sourceStageKey`+
  `round`, tipos GENÉRICOS) y `entrySource` (`initial-participants`|
  `stage-standings-range`+rango/ámbito|`stage-bracket-final-round-winners`
  +reseed). Puro dato, nunca funciones/instancias Team/`Map` incrustados;
  congelado con `Object.freeze()` al construirse.
- **`CompetitionFormatCatalog.js`** (nuevo): catálogo estático
  register/get/require/all, mismo criterio que `CompetitionCatalog.js` —
  id+version idéntica es idempotente, distinta version lanza.
- **`CompetitionRunners.js`** (nuevo): `RoundRobinStageRunner` (algoritmo
  del círculo extraído de `League.js`, generalizado a cualquier número de
  participantes con bye EXPLÍCITO si es impar, vueltas/puntuación/
  desempate configurables por `runnerConfig` — los 5 pasos de desempate
  son tipos GENÉRICOS, `group-head-to-head-balance`/`-point-diff`,
  `overall-point-diff`/`-points-for`/`-quotient-sum`, nunca llamados
  "ACB" dentro del runner) y `BracketStageRunner` (algoritmo extraído de
  `Bracket.js`, avance FIJO entre rondas, patrones de campo `SINGLE_GAME`/
  `BEST_OF_3_1_1_1`/`BEST_OF_5_2_2_1` configurables). Ambos guardan SOLO
  ids en su estado; los Teams se resuelven vía `resolveParticipant(id)`
  justo en la frontera con `MatchEngine.simulateMatch`.
- **`CompetitionEngine.js`** (nuevo): fachada/orquestador por CARRERA
  (nunca singleton, nunca lee `state`/DOM/reloj de sistema/aleatoriedad
  propia) — `registerEditionWithInitialEntries()` (declarativo, usado por
  contenido ANTES de que exista el engine), `initializeEdition()`
  (construye los runners desde Entries ya registradas), activación de
  fases por hechos GENÉRICOS (`round-completed`/`stage-completed`,
  intra-edición y CRUZADA de edición vía `registerCrossEditionActivation()`
  — nunca `if (competitionId === 'acb')`), `resolveMatch()`/
  `peekNextPendingMatch()`/`getStandings()` por stage, cierre de
  fase/edición en una única ruta de commit, `snapshot()`/
  `validateIntegrity()`.
- **`CompetitionRuntimeRegistry.js`** (nuevo): estado operativo transitorio
  por carrera (runners vivos por `stageId`, activaciones ya disparadas
  para idempotencia) — nunca en `WorldRegistries`/serializado
  directamente.
- **`CompetitionParticipationService.js`** (nuevo): servicio PURO —
  `primaryLeagueCompetitionId()` (Liga doméstica principal por Entry,
  falla descriptivo ante ambigüedad o ausencia, nunca "la primera"),
  `activeCompetitionsForParticipant()`, `editionAndStageForEntry()`,
  `participantsForStage()` (orden de seed y luego id estable).

### Configuración española como contenido

`data/world/spain-2026.1.js` registra tres `CompetitionFormatDefinition`:
`acb-liga-playoff` (liga regular 18/ida-vuelta/2-1 puntos + playoff por
el título top-8, cuadro 1-8/4-5/2-7/3-6, cuartos BO3 1-1-1, semis/final
BO5 2-2-1), `primera-feb-liga-ascenso` (liga regular igual + cuartos de
ascenso BO5 2-2-1 sobre 2º-9º, cuadro 2-9/3-8/4-7/5-6, + Final Four
reseedeada best-vs-worst de los 4 ganadores) y `copa-acb-knockout` (tres
rondas a partido único, cuadro 1-8/4-5/2-7/3-6, activada por una regla
CRUZADA de edición en la jornada 17 de ACB —
`buildSeasonActivationPlan()`). Ninguno de estos números vive en los
runners genéricos — auditado en `scripts/test-comp-core1.js`.
`install()` deja de llamar a `SpainLegacyCompetitionRuntime.
bindCareerStart()` — usa `CompetitionEngine.registerEditionWithInitialEntries()`
con el MISMO esquema de ids (verificado sin cambios contra
`test-world-core1.js`). `MatchConfig.js` añade el alias `spain-2026.1:
schedule:1a`/`2a` (MISMO objeto de perfil que `'1ª'`/`'2ª'`) para que
`Calendar.getScheduleProfile()` resuelva el `scheduleProfileId` que ya
declaraba `CompetitionCatalog.js`.

### Runtime antiguo retirado / shims exactos que quedan

`index.html`/`game.js`/`spain-2026.1.js` ya NO cargan ni llaman a
`SpainLegacyCompetitionRuntime` — el archivo sigue existiendo únicamente
como shim de `scripts/test-world-core1.js`/`smoke-world-core1.js`/
`smoke-club-core1.js` (fixtures históricos que lo requieren
directamente). `startSeason()`/`closeSeasonAndPrepareNext()` en `game.js`
ya no construyen `new League()`/`new Bracket()` ni llaman a `createCup()`/
`createTitlePlayoff()`/`new PromotionPlayoff()` — instancian UN
`CompetitionEngine` por carrera y construyen `state.leagues`/
`state.brackets` como vistas (`League`/`Bracket`/`PromotionPlayoff`-shaped)
sobre sus runners reales. `League.js`/`Bracket.js`/`Cup.js`/`Playoffs.js`/
`Promotion.js` sobreviven como fachadas finas que delegan en los mismos
runners (constructor con un parámetro opcional de runner ya construido) —
mismo algoritmo, nunca duplicado; siguen siendo el punto de construcción
para scripts/tests históricos que los llaman de forma standalone.
`competitionIdFromLegacyDivision()` sigue exportado, sin nuevos
call-sites productivos. Retirada definitiva de los cinco shims en
WORLD-HARDEN-1 (tabla actualizada en DESIGN.md 10.8).

### Contexto/participación migrados

`buildMatchCompetitionContext()`/`resolveNextMatchContextForTeam()`/
`matchStableId()` en `game.js` migran de `team.division` al descriptor
canónico del partido concreto; el resto de call-sites productivos que
traducían división (mercado, renovación, promoción de cantera, evidencia
de último partido oficial, expiración de inscripciones al cierre de
temporada) migran a `CompetitionParticipationService.
primaryLeagueCompetitionId()`.

### Compatibilidad observable

El comportamiento deportivo de la vertical española no cambia: mismo
calendario, misma clasificación/desempate, Copa en la misma jornada 17,
mismos cuadros y patrones de playoff/ascenso. `state.leagues`/
`state.brackets` mantienen exactamente el mismo shape que consumían
`game.js`/`SeasonHistoryService`/`cycle1-harness.js` — verificado
reutilizando ese mismo arnés para la transición anual del smoke.

### Pruebas ejecutadas (batería autorizada, sección 15 del prompt)

`node scripts/test-comp-core1.js`: **32 OK, 0 fallos** (formato/
versionado/inmutabilidad, bindings congelados, los tres bugs, round-robin
par/impar con bye, una/dos vueltas, puntuación/desempate configurables,
bracket BO1/BO3/BO5 con avance fijo, descriptor antes de simular en ambos
runners, doble resolución rechazada, activación idempotente, snapshots
JSON limpios, consultas sin mutar/RNG, orden de inserción irrelevante,
fixture NO español con ambos runners encadenados, Copa con bundle propio,
participación sin "la primera", auditorías estáticas). `node
scripts/smoke-comp-core1.js`: **OK en ~5-6s** (36 equipos reales, UNA
temporada completa de ACB/Primera FEB vía el engine con Copa activada en
jornada 17, playoff por el título y playoff de ascenso con Final Four
reseedeada, ids/fechas verificados antes de simular, contexto de acta/
elegibilidad de Copa con su competitionId real, UNA transición anual
completa con el arnés de CYCLE-1, MoraBanc Andorra comprobado antes y
después del ciclo). `node scripts/test-world-core1.js`: **27 OK, 0
fallos** (sin cambios de fixture). `node scripts/test-club-core1.js`:
**36 OK, 0 fallos**. `node scripts/test-reg1.js`: **88 OK, 0 fallos**.
`node scripts/test-cycle1.js`: **42 OK, 0 fallos**. `node --check` sobre
todos los `.js` nuevos/modificados y `git diff --check`: sin errores.
**0 fallos en toda la batería autorizada.** No se ha ejecutado Playwright
ni ninguna simulación de tres/diez temporadas (fuera de la batería
autorizada de esta entrega).

### Archivos nuevos/modificados (principales)

Nuevos: `src/core/CompetitionEngine.js`, `src/core/CompetitionRunners.js`,
`src/core/CompetitionRuntimeRegistry.js`,
`src/core/CompetitionFormatCatalog.js`,
`src/core/CompetitionParticipationService.js`,
`scripts/test-comp-core1.js`, `scripts/smoke-comp-core1.js`. Modificados:
`src/entities/Competition.js` (`CompetitionFormatDefinition`/
`CompetitionStageTemplate`), `src/core/WorldRegistry.js`
(BUG-COMPCORE-01), `src/core/CompetitionRules.js` (bundle
`copa-acb-domestic-2025-26-v1`), `src/core/MatchConfig.js` (alias de
scheduleProfile), `src/core/League.js`/`Bracket.js` (fachadas finas sobre
los runners genéricos), `data/world/spain-2026.1.js` (formatos, plan de
activación, `bindCareerStartEditions`/`bindNewSeasonEditions`), `src/ui/
game.js` (integración del engine en arranque/progresión/cierre de
temporada, migración de contexto/participación), `index.html` (orden de
carga de los módulos nuevos, retirada de `SpainLegacyCompetitionRuntime.js`
de producción), `DESIGN.md`/`CLAUDE.md` (esta entrada).

### Fuera de alcance

Cola de calendario mundial (WORLD-CALENDAR-1), pathways/ascenso-descenso
genéricos y plazas continentales (PATHWAYS-1), competiciones europeas
reales, selecciones/Mundial/JJOO, persistencia SQL/save-load, cambios de
normas ACB/FEB/contratos/mercado/transfer/cesión/economía, traspasos/
cesiones CPU-a-CPU orgánicos, rediseño visual/navegador mundial,
Playwright/pruebas manuales de UI, limpieza completa de `division` en
estadísticas/textos históricos, la deuda naming-only de Cycle sobre
ciertos campos `clubId`. No se ha añadido ninguna competición real nueva
(Supercopa ACB sigue `catalog-only`, sin Edition/Stage/Entry ni runtime).

**Confirmado**: `data/real/*` no se ha tocado; no se ha introducido SQL,
save/load, backend ni dependencia nueva; no se ha añadido ninguna
competición real nueva; no se ha ejecutado Playwright ni ninguna
simulación de tres/diez temporadas; la PR queda abierta contra `main`,
sin fusionar ni auto-merge.

**Siguiente entrega**: WORLD-CALENDAR-1 (cola cronológica mundial y
competiciones simultáneas sin el concepto especial de "la otra
división").
