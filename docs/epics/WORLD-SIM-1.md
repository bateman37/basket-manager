# Ficha de Epic — WORLD-SIM-1 (niveles de detalle y simulación mundial)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `WORLD-SIM-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Niveles de detalle (playable/full/standard/abstract) y simulación mundial acotada.
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/simulation-levels.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 9144-9373 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.16 WORLD-SIM-1 — resultado

Sexta entrega de la EPIC. Base: merge de la PR de PATHWAYS-1 en
`origin/main`. Aporta CAPACIDAD, no contenido deportivo real nuevo: tras
esta entrega la partida española sigue teniendo únicamente ACB, Primera
FEB y Copa ACB como Editions jugables, las tres con `detailLevel:
'playable'` explícito — el resto de la sección describe la maquinaria
genérica que permitirá instalar mundo exterior con coste acotado en
entregas futuras (`EUROPE-CONTENT-1` y siguientes), demostrada aquí solo
con un fixture ficticio pequeño en `scripts/test-world-sim1.js`/
`scripts/smoke-world-sim1.js`.

#### 10.16.1 Vocabulario y perfil

`src/entities/WorldSimulation.js` — vocabulario CERRADO `playable > full >
standard > abstract` (fidelidad decreciente) y `capabilitiesForDetailLevel(
level)`, función PURA que deriva `{allowsUserMatchStop, temporalUnit,
resolutionKind, hasIndividualMatchDetail, requiredRosterCoverage}` — nunca
booleanos sueltos guardados aparte que puedan contradecir al nivel.
`hasIndividualMatchDetail(result)` es un helper TIPADO aparte: distingue un
resultado completo (playable/full) de uno compacto (`standard`) mirando
`result.simulation.kind === 'compact-score'`, para que ningún consumidor
confunda ambos shapes.

`WorldSimulationProfile` — perfil EXPLÍCITO de la CARRERA (nunca del
paquete de contenido), congelado al construirse. Resolución determinista:
1) `CompetitionDefinition.id` exacto; 2) área más cercana en la cadena que
aporta quien resuelve (`resolveAreaChain(areasRegistry, startAreaId)`); 3)
`defaultDetailLevel` explícito. Dos assignments incompatibles para el
mismo scope (mismo `scopeType`+`scopeId`, distinto nivel) lanzan al
construirse — nunca se desempata por orden de array. `GameWorld` lleva
`simulationProfile` (`null` hasta `setSimulationProfile()`, asignado
SIEMPRE antes de instalar ningún paquete de contenido, porque un paquete
como `spain-2026.1.js` ya crea Editions dentro de su propio `install()`).
`WorldFactory.buildCareerWorld()` acepta `simulationProfile` y lo asigna
entre crear el mundo e instalar los paquetes.

**Perfil transitorio de la partida actual** (`src/ui/game.js`,
`startSeason()`): ACB/Primera FEB/Copa ACB → `playable` explícitos;
default → `abstract` para cualquier competición futura no configurada. Es
configuración de ARRANQUE de `game.js`, no lógica del core — WORLD-UI-1
añadirá el selector real. La Supercopa sigue `catalog-only`, sin Edition.

#### 10.16.2 Edition congelada y snapshots de equipo

`CompetitionEdition.detailLevel` pasa de opcional con fallback `'playable'`
a OBLIGATORIO y validado contra el vocabulario cerrado (BUG-WORLDSIM-01) —
`registerEditionWithInitialEntries()`/`activateEditionFromDecision()`
exigen el campo explícito, nunca lo infieren. `CompetitionPathwayService`
nunca copia el nivel de la Edition fuente: cada destino resuelve su PROPIO
nivel llamando a `resolveEditionBindings(competitionDefinitionId, world)`
(firma ampliada con `world`) — `data/world/spain-2026.1.js` resuelve así
`detailLevel` para ACB/Primera FEB/Copa mediante
`WorldSimulationProfile.resolveDetailLevel()` + `resolveAreaChain()`.

`TeamSimulationSnapshot` (mismo archivo) — fuerza/cobertura agregada de un
Team por temporada (`rosterCoverage: complete|partial|aggregate`,
`strength: {overall, offense, defense}`, `materializedPlayerIds`,
`estimatedRosterSize`, `strengthSource`/`provenance` honestos). Nunca
duplica Club/Team/Squad/Player. Con roster COMPLETO se puede derivar con
una fórmula versionada determinista (`CompetitionSimulationService.
deriveSnapshotFromRoster()`, reutiliza `SeasonGoals.top8Rating()`, la MISMA
que ya usa `sportingGoal`); con cobertura parcial/agregada, el contenido
debe aportar la fuerza explícita — nunca `50`/reputación española por
defecto. Registrado en `WorldRegistries.teamSimulationSnapshots`
(`registerTeamSimulationSnapshot()`, exige Team existente).
`CompetitionEngine.initializeEdition()` valida la cobertura exigida por
nivel (`CompetitionSimulationService.validateCoverageForEdition()`, solo si
hay `simulationService` inyectado): `playable`/`full` exigen roster REAL
completo; `standard`/`abstract` exigen una snapshot explícita — bloquea la
Edition en vez de completar en silencio o cambiar de nivel.

#### 10.16.3 Servicio de simulación y adaptadores

`src/core/CompetitionSimulationService.js` — instancia EXPLÍCITA por
carrera (`world`, `careerSeed`, nunca `state`/DOM/`Math.random()`).
`playable`/`full` NUNCA pasan por el servicio: siguen resolviéndose
exactamente como antes, dentro del mismo runner detallado
(`RoundRobinStageRunner`/`BracketStageRunner`, sin tocar
`CompetitionRunners.js`). `standard` usa el simulador compacto
`standard-score-v1` (`computeStandardResult()`): fuerza agregada de ambos
Teams + ventaja local fija + hash determinista de
`DeterministicRandom.unitFrom(fingerprint, discriminador)` (fingerprint
`careerSeed+algoritmo+editionId+stageId+matchId`) — nunca deja empate (un
tercer hash independiente decide el lado que se lleva el margen de
prórroga compacta), y el resultado se inyecta como
`MatchEngine.options.precomputedResult` en el MISMO punto de encaje que ya
existía para el partido del usuario (TAC-5) — `CompetitionEngine.
resolveMatch()` detecta el nivel (`_detailLevelForStage()`) y solo para
`standard` calcula el marcador antes de llamar a `runner.resolveMatch()`,
sin duplicar `_recordResult` ni el avance de ronda/bracket.

`abstract` construye `AbstractCompetitionStageRuntime`
(`src/core/AbstractCompetitionStageRuntime.js`), registrado en el MISMO
`CompetitionRuntimeRegistry` que los runners detallados (nunca un engine
paralelo): nunca crea `matches[]`, expone un ÚNICO hito pendiente
(`getPendingMilestones()`) con fecha/huso explícitos (nunca el reloj del
sistema) y, al resolverse (`resolveMilestone()`, idempotente por id de
hito), calcula una clasificación (`rankStandings`) o un resumen de cuadro
(`resolveBracketSummary`, campeón + subcampeón) a partir de fuerza +
fingerprint estable — nunca posesión a posesión. Deja EXACTAMENTE un
`CompetitionSimulationReceipt` plano (`WorldRegistries.
competitionSimulationReceipts`, registro nuevo con `forEdition()`/
`forStage()`) por fase, con `provenance: 'estimated'`.

**Límite consciente de esta entrega** (`_validateAbstractFormatSupported()`
+ validación de bracket potencia de 2 dentro de
`AbstractCompetitionStageRuntime`): `abstract` solo soporta formatos de UNA
sola fase resoluble — un formato multi-fase (como los españoles, con
playoff/ascenso) o un bracket con un número de participantes que no sea
potencia de 2 bloquean ANTES de mutar nada, con mensaje descriptivo. Una
ampliación futura que necesite hitos intermedios de una fase abstracta
multi-stage queda fuera de esta entrega.

#### 10.16.4 Integración con el engine, el calendario y PATHWAYS

`CompetitionEngine` recibe `simulationService` inyectado (opcional —
ausente, se comporta EXACTAMENTE igual que antes de esta entrega, lo que
usan todos los fixtures/tests históricos de COMP-CORE-1/WORLD-CALENDAR-1/
PATHWAYS-1 sin cambiar una línea de comportamiento). `getBracketChampion`/
`isStageCompleted`/`getStandings` funcionan de forma UNIFORME para runner
detallado y runtime abstracto (mismo contrato de retorno);
`getBracketFinalRoundWinners` detecta el runtime abstracto por duck-typing
(`typeof runner.getFinalRoundWinners === 'function'`). Nuevo:
`listAllPendingAbstractMilestones()`/`resolveAbstractMilestone()`.
`listAllPendingMatches()` sigue devolviendo SOLO partidos materializados
(un runtime abstracto responde `getPendingMatches(): []`, así que nunca
aparece ahí, invariante 9).

`WorldCalendarCoordinator.js` añade la fuente `competition-simulation`
(`createCompetitionSimulationSource()`): lista hitos agregados pendientes,
nunca es parada del usuario, comparte el MISMO `WorldCalendar` que
`competition-match`/`market-event`/`transfer-event`/`loan-event`. La
fuente `competition-match` añade `detailLevel` a la metadata de cada
partido; `requiresUser()` detecta y LANZA ante la configuración inválida
"Team controlado en una Edition no playable" en vez de autosimularla a
escondidas (invariante 6 de la sección 19 del prompt).

`CompetitionPathwayService`/`CompetitionEngine.activateEditionFromDecision()`
propagan `detailLevel` explícito en cada activación (intra-temporada y
transición anual) — el destino de un pathway SIEMPRE resuelve su propio
nivel, nunca hereda el de la Edition que disparó la regla.

#### 10.16.5 Población, ciclo de vida y mercado honestos

`WorldLifecycleService.js` (BUG-WORLDSIM-04): categoría `'external-abstract'`
y el hook `externalClubMembership` quedan RETIRADOS — nunca tuvieron un
call-site real. Un Player en el Squad activo de cualquier Team (español o
de detalle `standard`/`abstract`) clasifica `senior-service-roster` en
cuanto ese Team llega en `deps.teams`, con `serviceClubId` real — un Club
exterior sigue siendo un `Club`/`Team`/`Squad` NORMAL, nunca una segunda
ontología.

`MarketService.resolveMarketAvailability()` (BUG-WORLDSIM-05): si un
Player no tiene contrato vigente pero SÍ `player.teamId` (afiliado a un
Squad real), devuelve `'affiliated-contract-unknown'` — nunca `'free'`.
Ese estado no permite abrir negociación (`canInquire` en la pantalla de
Mercado lo excluye explícitamente) ni ejecutar un traspaso; la etiqueta
visible es "Afiliado — contrato no cargado en este nivel de detalle". En
la partida española esto NUNCA ocurre en la práctica (`ContractExpiryService`
limpia `teamId` al expirar un contrato), pero protege cualquier Team
`standard`/`abstract` futuro sin bootstrap contractual propio.

`CompetitionSimulationService.interactiveCohortTeams(seasonKey)`
(BUG-WORLDSIM-06) — Teams con Entry activa en una Edition `playable` de
esa temporada. `game.js` lo usa (`interactiveCohortTeams()`) en los TRES
bootstraps que hoy recorren "todos los equipos": `bootstrapContractsForNewCareer()`,
`bootstrapRegistrationsForNewCareer()` y `closeSeasonAndPrepareNext()`
(ciclo anual) — para la partida actual el cohorte contiene los MISMOS 36
equipos (ACB+Primera FEB son "playable"), así que contratos/licencias/
ciclo no cambian de comportamiento observable. `getAllTeams()` conserva su
semántica de "todos los Teams registrados" para búsquedas/diagnóstico.

`GameWorld.describe()` añade una vista PLANA de `simulationProfile` +
`simulationLevelCounters` (Editions/Teams por nivel, derivados de los
registries reales) — sin runtimes vivos ni `Map`.

#### 10.16.6 Pruebas de esta entrega

`node scripts/test-world-sim1.js` — 19 comprobaciones agrupadas:
vocabulario cerrado/capabilities/serialización, precedencia
competición>área>default, conflicto de assignments, Edition con nivel
obligatorio/inmutable, snapshots e integridad de referencias, "standard"
determinista sin empate ni detalle individual falso, "abstract"
round-robin (hito único, receipt idempotente) y bracket (PATHWAYS lee
campeón/ganadores de última ronda), configuración abstracta no soportada
(multi-fase y bracket no potencia de 2) fallando antes de mutar,
`validateCoverageForEdition`, orden de registro invertido sin cambiar
marcador/campeón, consultar sin mutar, Player exterior con Club/Team/Squad
normales (nunca `external-abstract`), afiliado sin contrato nunca libre,
cohorte interactivo excluyendo Teams no playable, auditoría estática sin
literales de España, `GameWorld.describe()` serializable. **19 OK, 0
fallos.**

`node scripts/smoke-world-sim1.js` — fixture sintético (`world-core-2026.1`
+ 4 ligas ficticias de 4 equipos, una por nivel, nunca instalado en
producción): 4 Editions inicializadas con su nivel congelado; "Continuar"
resuelve TODA la cola con exactamente 3 paradas de usuario (las 3 jornadas
de la liga "playable", único Team controlado); "full" se resuelve
enteramente automático con resultado completo; "standard" deja marcadores
compactos deterministas sin empates; "abstract" deja un único
receipt/cero partidos; un pathway de test clasifica el top-2 de la liga
abstracta a una Edition de "Torneo de honor" (también abstracta, con su
PROPIO nivel) — demuestra PATHWAYS consumiendo un resultado abstracto;
integridad World/Competition/Calendar limpia al final; jugador afiliado a
un Team abstracto con Club/Team/Squad normales, `affiliated-contract-unknown`
y `senior-service-roster`; determinismo confirmado con orden de registro
invertido. **OK en ~0.3s.**

Regresiones autorizadas sin cambio de comportamiento: `node
scripts/test-pathways1.js` (**19 OK, 0 fallos** — fixtures actualizadas con
`detailLevel: 'playable'` explícito, la única adaptación permitida ante el
nuevo campo obligatorio) y `node scripts/test-world-calendar1.js` (**25
OK, 0 fallos**, mismo ajuste). `node --check` sobre todo el JS nuevo/
modificado y `git diff --check`: sin errores.

#### 10.16.7 Fuera de alcance de esta entrega

Euroliga/EuroCup/BCL/ligas extranjeras o clubes/jugadores reales nuevos;
instalar el fixture ficticio del smoke en producción; selecciones/
convocatorias/ventanas FIBA (**NATIONAL-TEAMS-1**); selector de nivel de
detalle/navegación mundial (**WORLD-UI-1**); materialización/
dematerialización dinámica de plantillas al cambiar nivel; simulación
abstracta multi-stage o checkpoints de jornada intermedios; scouting u
ocultación/revelado de atributos; contratos completos/agentes/licencias/
ciclo anual de clubes abstractos; mercado CPU-a-CPU exterior, transfer
internacional o Letter of Clearance; cambios al `MatchEngine`/tácticas/
lesiones/desarrollo/balance; SQL/save-load/backend/dependencias nuevas;
retirada general de shims legacy reservados a **WORLD-HARDEN-1**.

_Migrado de `CHANGELOG.md` (líneas 820-974 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-06 — WORLD-SIM-1: niveles de detalle y simulación mundial acotada (DESIGN.md sección 10.16)

Sexta entrega de la EPIC **World Architecture** (WORLD-CORE-1 →
CLUB-CORE-1 → COMP-CORE-1 → WORLD-CALENDAR-1 → PATHWAYS-1 →
**WORLD-SIM-1** → NATIONAL-TEAMS-1 → WORLD-UI-1 → WORLD-HARDEN-1). Base:
merge de la PR de PATHWAYS-1 en `origin/main`. Rama `claude/modest-gauss-ab8bat`.

El mundo debe poder contener muchas competiciones y clubes sin simular
cada partido/plantilla/estadística con el coste máximo. Esta entrega
aporta la CAPACIDAD (cuatro niveles de detalle `playable/full/standard/
abstract`, un perfil de simulación explícito por carrera, snapshots de
fuerza agregada, un servicio de simulación y un runtime "abstract") — no
contenido deportivo real nuevo: la partida española sigue teniendo
únicamente ACB, Primera FEB y Copa ACB como Editions jugables, las tres
`playable` explícito. La extensibilidad se demuestra con un fixture
ficticio pequeño (`scripts/test-world-sim1.js`/`scripts/smoke-world-sim1.js`),
nunca instalado en producción.

### Bugs/deudas corregidos

- **`BUG-WORLDSIM-01`** — toda Edition caía silenciosamente en
  `'playable'`. *Causa*: `CompetitionEdition.detailLevel` tenía
  `data.detailLevel || 'playable'` como fallback silencioso desde
  WORLD-CORE-1. *Corrección*: el campo es OBLIGATORIO y se valida contra
  el vocabulario cerrado (`WorldSimulation.DETAIL_LEVELS`) —
  `registerEditionWithInitialEntries()`/`activateEditionFromDecision()`
  lo exigen explícito; los tres fixtures productivos de contenido
  (`data/world/spain-2026.1.js`) lo resuelven desde el perfil de la
  carrera, nunca por defecto.
- **`BUG-WORLDSIM-02`** — el nivel declarado no cambiaba la ejecución.
  *Corrección*: `CompetitionSimulationService`/`AbstractCompetitionStageRuntime`
  implementan adaptadores REALES por nivel — `standard` calcula un
  marcador compacto determinista (`standard-score-v1`) sin tocar
  `CompetitionRunners.js`/`MatchEngine`; `abstract` nunca construye un
  runner de partidos, resuelve la fase entera en un único hito agregado.
- **`BUG-WORLDSIM-03`** — la cola mundial solo entendía partidos
  completos. *Corrección*: nueva fuente `competition-simulation`
  (`WorldCalendarCoordinator.js`) que lista/resuelve hitos "abstract"
  compartiendo el MISMO `WorldCalendar`, sin fabricar `competition-match`
  falsos y sin ser nunca parada del usuario.
- **`BUG-WORLDSIM-04`** — el exterior usaba una segunda ontología.
  *Causa*: `WorldLifecycleService` conservaba la categoría
  `'external-abstract'` + el hook `externalClubMembership` desde
  WORLD-CORE-1, sin ningún call-site real. *Corrección*: ambos quedan
  RETIRADOS — un Player en el Squad activo de cualquier Team (español o
  de detalle `standard`/`abstract`) clasifica `senior-service-roster` sin
  ninguna rama especial.
- **`BUG-WORLDSIM-05`** — un afiliado sin contrato cargado parecía agente
  libre. *Corrección*: `MarketService.resolveMarketAvailability()`
  comprueba `player.teamId` ANTES de asumir libertad contractual — sin
  contrato vigente pero con afiliación real devuelve
  `'affiliated-contract-unknown'` (nuevo estado, bloquea negociación en
  la pantalla de Mercado), nunca `'free'`.
- **`BUG-WORLDSIM-06`** — los sistemas interactivos recorrían todos los
  equipos. *Corrección*: `CompetitionSimulationService.
  interactiveCohortTeams(seasonKey)` (Teams con Entry en una Edition
  `playable`); `game.js` lo usa en `bootstrapContractsForNewCareer()`,
  `bootstrapRegistrationsForNewCareer()` y `closeSeasonAndPrepareNext()`
  vía el helper `interactiveCohortTeams()`. Sin cambio observable hoy (el
  cohorte son los mismos 36 equipos), protege contra aplicar bootstrap
  español a un Team `standard`/`abstract` futuro.
- Corrección propia de esta sesión (nunca publicada): la primera versión
  de `_buildRunnerForStage()` pasaba el resolver de fechas de contenido
  DOS VECES envuelto al runtime "abstract"
  (`dateResolver: () => this._dateResolverProvider(...)`, cuando
  `_dateResolverProvider(activationContext)` ya devuelve un resolver POR
  PARTIDO que hay que invocar una vez más con una `meta` sintética) —
  detectada por `scripts/smoke-world-sim1.js` al fallar con "necesita
  fecha final + huso IANA explícitos" en cuanto el resolver de fechas del
  fixture seguía el contrato real (no el atajo que enmascaraba el bug en
  la primera versión de `scripts/test-world-sim1.js`). Corregida antes de
  cualquier ejecución reportada como buena.

### Entidades, registros y servicio añadidos

`src/entities/WorldSimulation.js` (`WorldSimulationProfile`,
`TeamSimulationSnapshot`, `CompetitionSimulationReceipt`, `DETAIL_LEVELS`,
`capabilitiesForDetailLevel()`, `hasIndividualMatchDetail()`,
`resolveAreaChain()`), `src/core/CompetitionSimulationService.js`
(servicio EXPLÍCITO por carrera: resolución de nivel, snapshots,
cobertura, cohortes, marcador compacto, construcción del runtime
abstracto), `src/core/AbstractCompetitionStageRuntime.js` (runtime
agregado "abstract", registrado en el mismo `CompetitionRuntimeRegistry`
que los runners detallados). `WorldRegistries` gana
`teamSimulationSnapshots`/`competitionSimulationReceipts`.
`GameWorld.simulationProfile`/`setSimulationProfile()`/
`_simulationLevelCounters()`; `WorldFactory.buildCareerWorld()` acepta
`simulationProfile`.

### Semántica real de cada nivel

`playable`/`full`: MatchEngine actual sin cambios (`full` nunca para al
usuario). `standard`: marcador compacto determinista, sin
`quarterScores`/box score, nunca empate, inyectado vía
`MatchEngine.options.precomputedResult` (mismo punto de encaje que TAC-5).
`abstract`: un único hito por fase (fecha/huso explícitos), receipt
idempotente, cero partidos individuales — limitado en esta entrega a
formatos de una sola fase resoluble (bracket exige potencia de 2).

### Profile español y cohorte interactivo

`game.js`, `startSeason()`: perfil transitorio explícito (ACB/Primera
FEB/Copa ACB → `playable`, default → `abstract`), asignado al mundo ANTES
de instalar `spain-2026.1` (que ya crea Editions dentro de `install()`).
`data/world/spain-2026.1.js`: `editionBindings(competitionId, world)`
resuelve `detailLevel` desde el perfil; `CompetitionPathwayService`
propaga el nivel del DESTINO (nunca copiado de la fuente) en activación
intra-temporada y en la transición anual. `state.competitionSimulationService`
inyectado en `CompetitionEngine` — inerte hoy, listo para un paquete
futuro no jugable.

### Comandos ejecutados y resultados reales

```
node scripts/test-world-sim1.js       # 19 OK, 0 FAIL
node scripts/smoke-world-sim1.js      # OK, ~0.3s
node scripts/test-pathways1.js        # 19 OK, 0 FAIL (fixtures con detailLevel: 'playable' explícito)
node scripts/test-world-calendar1.js  # 25 OK, 0 FAIL (mismo ajuste)
node --check <cada .js nuevo/modificado>   # sin errores
git diff --check                      # sin errores
```

### Archivos principales

Nuevos: `src/entities/WorldSimulation.js`,
`src/core/CompetitionSimulationService.js`,
`src/core/AbstractCompetitionStageRuntime.js`,
`scripts/test-world-sim1.js`, `scripts/smoke-world-sim1.js`. Modificados:
`src/entities/Competition.js`, `src/entities/World.js`,
`src/core/WorldFactory.js`, `src/core/WorldRegistry.js`,
`src/core/CompetitionEngine.js`, `src/core/CompetitionPathwayService.js`,
`src/core/WorldCalendarCoordinator.js`, `src/core/WorldLifecycleService.js`,
`src/core/MarketService.js`, `data/world/spain-2026.1.js`,
`src/ui/game.js`, `index.html`, `DESIGN.md`, `CLAUDE.md`.

### Fuera de alcance de esta entrega

Euroliga/EuroCup/BCL/ligas extranjeras o clubes/jugadores reales nuevos;
instalar el fixture ficticio del smoke en producción; selecciones
(NATIONAL-TEAMS-1); selector de nivel de detalle/navegación mundial
(WORLD-UI-1); materialización/dematerialización dinámica de plantillas;
simulación abstracta multi-stage; scouting; contratos/agentes/licencias/
ciclo anual de clubes abstractos; mercado CPU-a-CPU exterior/transfer
internacional/Letter of Clearance; cambios al MatchEngine/tácticas/
lesiones/balance; SQL/save-load/backend/dependencias nuevas; retirada
general de shims legacy (WORLD-HARDEN-1).

`data/real/*` no cambió, no se añadió SQL/save-load/backend/dependencia
nueva ni ninguna competición/club real nuevo. PR abierta contra `main`,
sin fusionar.

**Siguiente entrega: NATIONAL-TEAMS-1** (federaciones, selecciones,
elegibilidad, convocatorias, ventanas y competiciones continentales/
mundiales de selecciones).
