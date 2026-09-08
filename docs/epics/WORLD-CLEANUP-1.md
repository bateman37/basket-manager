# Ficha de Epic — WORLD-CLEANUP-1 (retirada final de proyecciones legacy)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `WORLD-CLEANUP-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Retirada final de proyecciones legacy (Team.division y mapas fijos de UI). Cierra World Architecture estructuralmente.
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/competitive-context-identity.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 10399-10671 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.21 WORLD-CLEANUP-1 — retirada final de proyecciones legacy

Segunda y última corrección posterior a WORLD-HARDEN-1 (la primera fue
WORLD-CONTEXT-1, 10.20). Base: `origin/main` en `e9f7ab9`. Rama
`refactor/world-cleanup-1`. Cierra el resto de la deuda explícita de
10.19.2 (puntos 2, 4, 5, 6 parcial, 7, 8). No añade contenido jugable
nuevo — la partida española sigue siendo el único contenido real instalado.

#### 10.21.1 Retirada de `Team.division`

`src/entities/Team.js` ya NO tiene `division`, `legacyDivision`,
`DIVISIONS` ni `Team.validateDivision()` — ni en el constructor, ni en
`toJSON()`, ni exportados. Un Team no "pertenece" a una única
competición: su participación se consulta SIEMPRE en `CompetitionEntry`
(`CompetitionParticipationService.activeCompetitionsForParticipant()`), y
puede ser múltiple (liga + Copa a la vez). `CompetitionDefinition.legacyDivision`
y `CompetitionParticipationService.projectLegacyDivision()`/
`projectLegacyDivisionForTeams()` quedan retirados por el mismo motivo —
ya no hay ningún campo al que proyectar. `CompetitionRules.
competitionIdFromLegacyDivision()` y su tabla `'1ª'/'2ª'` quedan
retirados de `CompetitionRules.js` (sin ningún call-site productivo desde
WORLD-CONTEXT-1); los fixtures históricos de `scripts/` que aún lo
necesiten mantienen su propio adaptador local, fuera de `src/`.

`src/ui/game.js` construye los 36 equipos reales SIN agrupar por
`['1ª','2ª']`: `startCareerFromSetup()` recorre `REAL_DATA_INDEX` entero y
resuelve la afiliación competitiva de cada equipo por id estable
(`SPAIN_CLUB_CONTENT.initialCompetitionDefinitionId`, vía
`CareerParticipantFactory`) — el mismo cohorte por `competitionDefinitionId`
real (no por división) se reutiliza para `recalculateSportingGoalsForCohort()`
(antes `...ForDivision()`, `src/core/SeasonGoals.js`, renombrada sin
cambiar su fórmula) y para construir la identidad táctica CPU.
`getRealTeamsByDivision()` queda eliminada; `getAllRealTeamsForMatchupTarget()`
(TAC-4) reconstruye los 36 equipos reales por id estable, igual criterio.

#### 10.21.2 Exposición competitiva por tier (BUG-WORLD-CLEANUP-03)

`MatchConfig.js`: `playerDevelopment.exposure.divisionWeight` (`{'1ª':
1.0, '2ª': 0.7}`) se renombra a `competitionTierWeight` (`{1: 1.0, 2:
0.7}`, mismo balance observable) + `defaultCompetitionTierWeight: 1`
(política genérica y neutra para una competición sin `tier` declarado —
nunca decidida por nombre/id). `PlayerDevelopment.recordMatchExposure()`
recibe ahora `{date, minutes, competitionDefinitionId, competitionTier,
stageId, positionMinutes}` (nunca `competition`/`division`) y
**congela el peso aplicable en el momento del partido** (`exp.weight`,
resuelto por `resolveCompetitionTierWeight()`) — cambiar el catálogo de
competiciones/tiers más adelante nunca reescribe exposiciones pasadas.
`computeExposureFactor()` consume directamente `exp.weight`, sin volver a
consultar la ponderación por id. Probado con una competición ficticia de
tier 3 sin ponderación explícita (política genérica) y una de tier 2
(0.7), además de tier 1 (1.0) — `scripts/test-world-cleanup1.js`,
comprobación 3.

#### 10.21.3 Histórico de carrera multi-competición

`PlayerCareer.js`: un `teamStint` (`ensureTeamStint()`) identifica el
Team de SERVICIO — `{teamId, teamName, clubId, clubName, stats,
competitionStats: []}`, sin `division`. `ensureCompetitionStint()` añade
un acumulado POR competición real dentro del mismo stint
(`{competitionDefinitionId, competitionName, competitionShortName,
stats}`) — un mismo Team que juega Liga y Copa produce UN stint con DOS
`competitionStats`, nunca dos stints ni doble contabilización (el total
del stint sigue siendo la suma real de los deltas de cada partido).
`closeSeason()` conserva esa forma al cerrar la temporada; una temporada
sin minutos (`teamStints` vacío) conserva la afiliación del jugador
(`clubId`/`clubName` del llamador) con `competitionStats: []`, sin
inventar una competición disputada. `pushMilestone()`/
`updatePersonalBests()` guardan `competitionDefinitionId`/`stageId`
canónicos en vez de una clave `'league'/'cup'`. `SeasonHistoryService.
closeCareerHistories()` ya no recibe `divisionsBefore` — resuelve
`clubId`/`clubName` directamente del Team real. `captureDivisionsBefore()`/
`applyPromotionsAndRelegations()` quedan retiradas de la ruta productiva
(sin call-site canónico); sobreviven únicamente para
`scripts/cycle1-harness.js` (legacy, no ejecutado en esta sesión — ver
10.21.4).

Cierre de temporada (`game.js`, `closeSeasonAndPrepareNext()`):
`summary.userTeamDivision` → `summary.userPrimaryCompetitionId`
(competitionId real, resuelto por Entries de `targetSeasonKey`); el
texto de cierre usa el nombre real de la competición
(`competitionDisplayName()`), nunca `"${division} división"`.

#### 10.21.4 Metadatos de Stage y retirada de los mapas de UI

`CompetitionStageTemplate`/`CompetitionStage` (`src/entities/Competition.js`)
ganan `rulesPhaseId` (string opaco de contenido, copiado de template a
Stage al crearse) y `presentationRole` (opcional). `data/world/spain-2026.1.js`
declara `rulesPhaseId` en sus cinco stage templates reales
(`'league'`/`'title-playoff'`/`'promotion'` x2/`'cup'`) — EXACTAMENTE los
mismos valores que ya producía el mapa de UI retirado, preservando el
comportamiento observable. `CompetitionEngine.describeCompetitionContext(
registries, stageId)` (nueva consulta PURA, exportada) resuelve
`{competitionDefinitionId, competitionName, competitionShortName,
editionId, stageId, stageKey, stageName, stageType, rulesPhaseId}` desde
el catálogo/Stage reales.

`src/ui/game.js` retira `UI_COMPETITION_KEY_BY_STAGE_KEY`,
`competitionKeyForStageKey()`, `BRACKET_PHASE_IDS` y `COMPETITION_LABELS`
— `describeMatchDescriptor()` usa el descriptor canónico de arriba;
`isBracket` se deriva de `stageType !== 'round-robin'` (nunca de una clave
de UI); eventos/noticias/lesiones/actas usan `competitionDefinitionId`/
`stageId`/nombres reales — ningún evento nuevo lleva
`relatedCompetition: 'league'/'cup'/'playoff'/'promotion'` (los pocos
casos verdaderamente "de liga" sin partido concreto, p.ej. noticias
médicas de entrenamiento, usan `userLeagueCompetitionId()` real).
`publishActivationNews()`/`publishBracketOutcomeNews()` resuelven
etiquetas desde `CompetitionDefinition.name`/`CompetitionStage.name`
reales, nunca desde una tabla fija.

#### 10.21.5 Career Setup: grafo completo de pathways

`CareerSetupService.validateDraft()` sustituye la comprobación de
`CONTROLLED_CLUB_WITHOUT_USER_STOP` (solo la competición inicial) por un
recorrido COMPLETO del grafo de `CompetitionPathwayRule` alcanzables
desde `initialCompetitionDefinitionId` — BFS puro sobre las reglas ya
registradas (`ensurePathwaysRegistered()` reutiliza
`ContentPackLifecycleService.prepareCatalogs()`, idempotente, sin crear
Editions ni mundo), con soporte de ciclos (nunca reexpande un
competitionId visitado) y camino mínimo reconstruido para el mensaje de
error. Un destino `catalog-only` (implementationStatus distinto de
`active-runtime`) se ignora — nunca bloquea "Comenzar carrera". Probado
con un fixture ficticio de dos saltos (A → Mid → B) más un ciclo (B → A)
y un destino catalog-only ignorado (`scripts/test-world-cleanup1.js`,
comprobación 6) — nunca instala packs, nunca crea Editions, nunca muta el
catálogo (verificado con snapshot antes/después).

#### 10.21.6 Shims retirados y nombres ambiguos resueltos (10.20.5)

- `src/core/SpainLegacyCompetitionRuntime.js` se retira de `src/core` —
  movido a `scripts/fixtures/legacy/SpainLegacyCompetitionRuntime.js`,
  sin ningún call-site en `src/`. Sus tres consumidores históricos
  (`scripts/test-world-core1.js`/`smoke-world-core1.js`/
  `smoke-club-core1.js`) solo tuvieron su `require()` redirigido — no se
  reescribió su lógica ni se ejecutaron.
- `src/core/Calendar.js` **NO se retira** — deliberado (ver 10.21.7,
  fuera de alcance de esta sesión).
- `RegistrationRegistry.registrationsForClub()`/`cumulativeCountForClub()`
  → `registrationsForTeam()`/`cumulativeCountForTeam()` (siempre
  indexadas por `team.id`, nunca por `Club.id`) — call-sites actualizados
  en `RosterLegalityService.js`, `RegistrationService.js`,
  `LoanExecutionService.js`, `TransferExecutionService.js`,
  `RegistrationSeeder.js`, `src/ui/game.js` y los smokes de MARKET-1/
  TRANSFER-1/LOAN-1/REG-1.
- `RetirementAnnouncement.clubIdAtAnnouncement` → `teamIdAtAnnouncement`
  (el valor guardado siempre fue `player.teamId`) — entidad, serialización
  y `RetirementService.announceRetirement()`/`AnnualCycleService.js`
  actualizados.
- `ContractSeeder.seedFingerprint()`/`RegistrationSeeder.seedFingerprint()`:
  el segundo parámetro pasa a llamarse `teamId` (documentado: casi todos
  los llamadores pasan `team.id`; un llamador puntual de vinculación pasa
  el `Club.id` real del beneficiario) — el VALOR/ORDEN del fingerprint no
  cambia, así que ningún contrato/licencia simulado existente se invalida.
- Deuda de naming que SIGUE viva, deliberadamente NO agravada esta sesión
  (fuera del alcance explícito del prompt de origen): `RetirementRecord.
  lastClubId`/`cleanup.rosterRemovedFromClubId` (en
  `RetirementService.js`) guardan en realidad `team.id`, mismo patrón que
  los tres puntos ya corregidos arriba — no estaba en la lista explícita
  de esta entrega; queda señalado para una futura sesión de naming.
  `state.lastOfficialMatchEvidence` sigue sin declararse en
  `CareerPersistenceBoundary.inventory()` (deuda de la futura entrega de
  persistencia real, sin cambios aquí).

#### 10.21.7 Contenido español existente vs. dependencia estructural

Separación explícita, para no confundir "sigue habiendo España" con "el
core depende de España":

- **Contenido español, por diseño, permitido en su capa** (no es deuda):
  `data/world/spain-2026.1.js` (identidad/formatos/calendario/pathways de
  ACB/Primera FEB/Copa), `src/ui/game.js` como ÚNICA capa de interfaz que
  conoce esos tres nombres como literales (career start/close, Copa),
  `CompetitionCatalog.js`/`ClubEmploymentContextCatalog.js` como
  catálogos de identidad/jurisdicción con MoraBanc Andorra como caso
  transfronterizo permanente, y el propio contenido normativo de
  `CompetitionRules.js` (miles de reglas ACB/FEB/RD 1006/convenio ACB,
  deliberadamente NO movido en esta PR — mover ese catálogo no era
  imprescindible para retirar ningún fallback y habría sido una tercera
  refactorización dentro de la misma sesión, fuera de alcance).
- **Dependencia estructural real, y su estado**: `Team.js`/
  `CompetitionParticipationService.js`/`CompetitionRules.js` ya NO tienen
  ningún vocabulario cerrado de división ni adaptador legacy (10.21.1);
  `game.js` ya no agrupa/materializa equipos por división (10.21.1) ni
  traduce fase por un mapa fijo de UI (10.21.4); `CareerSetupService`
  valida el grafo completo de pathways, no solo España (10.21.5). La
  única dependencia estructural que sobrevive es la NO retirada de
  `Calendar.js` (10.21.6/10.21.7 abajo) — un shim inerte en la ruta
  productiva, pero todavía requerido por scripts de Node.

Límite deliberado, fuera de alcance de esta PR (documentado, no
fabricado): `src/core/Calendar.js` sigue cargado en `index.html` (modo
prueba técnico, protegido por CLAUDE.md — "vive tal cual estaba, sin
lógica propia añadida") y requerido directamente por ~20 scripts de
`scripts/` vía `require('../src/core/Calendar.js')`, incluido un test de
regresión (`test-world-calendar1.js`) que afirma explícitamente que
`index.html` sigue cargándolo. Ninguno de esos scripts se ejecuta en esta
sesión (regla prioritaria de consumo del prompt de origen: sin campaña de
migración de `scripts/`), así que retirar el archivo habría dejado ~20
`require()` rotos sin forma de verificarlos. Se confirmó de nuevo
(auditoría estática) que `Calendar.js` no tiene ningún caller REAL dentro
de `index.html`/`game.js` — solo comentarios históricos que documentan su
API antigua. Su retirada definitiva queda para una sesión futura que
pueda migrar esos ~20 scripts (y el test que los verifica) como
propio objeto de trabajo, no como efecto colateral de otra entrega.

**Actualización (`REPO-HARDEN-1`, saneamiento técnico posterior a esta
entrega)**: el `<script src="src/core/Calendar.js">` SÍ se quitó de
`index.html` — auditoría estática confirmó (de nuevo) cero callers reales
del global `Calendar`/`BM.Calendar` en `index.html`/`game.js`/el resto de
`src/`, así que cargarlo en el navegador era puro peso muerto. El
ARCHIVO `src/core/Calendar.js` sigue en disco sin cambios (siguen
requiriéndolo directamente los ~20 `scripts/*.js` históricos de arriba,
ajenos al `<script>` del navegador). `scripts/test-world-calendar1.js`
(comprobación "`Calendar.js` sigue existiendo como shim standalone")
sigue en verde porque solo comprueba que el TEXTO `src/core/Calendar.js`
aparece en `index.html` — ahora en el comentario que documenta esta
decisión, no en un `<script>` — sin verificar que sea un tag de carga;
no se tocó ese test.

#### 10.21.8 Verificación (resultados EXACTOS de esta sesión)

- `scripts/test-world-cleanup1.js` (nuevo, batería dirigida mínima —
  máximo 10 comprobaciones agrupadas, sección 13 del prompt de origen):
  **7 OK, 0 FAIL**. Cubre: símbolos legacy ausentes de `src/`/`data/world/`;
  Team sin división + participación múltiple por Entries; exposición por
  tier con una competición ficticia de tier 3; un teamStint con dos
  competitionStats sin doble contabilización; descriptor de Stage con una
  `stageKey` ficticia; grafo de pathways de dos saltos + ciclo + destino
  catalog-only ignorado; serialización JSON de las formas modificadas +
  auditoría estática de determinismo (`Date.now()`/`Math.random()`/
  `new Date()`) en los dieciséis servicios administrativos de contratos/
  mercado/ciclo/traspasos/cesiones.
- `scripts/test-comp-core1.js` (BUG-WORLD-CLEANUP-01, fixtures corregidos
  con `detailLevel` explícito — nunca opcional ni con valor por defecto
  productivo): **32 OK, 0 FAIL** (antes 21 OK, 11 FAIL).
- `scripts/test-world-context1.js` (garantiza que no se reintroducen los
  fallos cerrados en la PR #55): **25 OK, 0 FAIL**.
- `node --check` sobre todo el JS nuevo/modificado y `git diff --check`:
  sin errores.
- `scripts/smoke-world-calendar1.js` (BUG-WORLD-CLEANUP-02): fixture
  corregido con `WorldSimulationProfile` explícito, `node --check` OK — el
  smoke en sí NO se ejecutó (fuera de la lista de verificación de la
  sección 13).
- NO ejecutados en esta sesión (regla prioritaria de consumo): ningún
  `smoke-*.js` adicional, `test-world-calendar1.js`, `test-pathways1.js`,
  `test-world-ui1.js`, `test-cycle1.js`, `test-world-harden1.js`, ninguna
  batería de contratos/mercado/traspasos/cesiones, Playwright, ni el
  audit de diez temporadas. Varios scripts quedan con imports/llamadas
  rotas por los renombrados de esta sesión (`recalculateSportingGoalsForDivision`
  → `...ForCohort`, `registrationsForClub`/`cumulativeCountForClub` →
  `...ForTeam`, `competitionIdFromLegacyDivision` retirado de
  `CompetitionRules.js`) en scripts NO tocados por no ser su import
  directo roto por un archivo retirado — validación funcional/manual
  pendiente, nunca declarada verificada aquí.

#### 10.21.9 Checklist manual recomendado para Dennis (no ejecutado en esta sesión)

- Abrir `index.html` → "Empezar temporada", elegir un club de ACB y otro
  de Primera FEB, jugar varias jornadas: comprobar Home/Agenda/
  Competiciones/Estadísticas muestran el nombre real de la competición
  (nunca `"1ª división"`), y que la Copa/Playoff/Ascenso siguen
  disparándose en su jornada real.
  ficha de un jugador con historial de Liga + Copa muestra ambos bloques
  de estadísticas sin duplicar el total.
- Cerrar una temporada completa: comprobar el resumen de cierre muestra
  el nombre de la competición real del equipo del usuario (no una
  división), y que ascensos/descensos siguen funcionando.
- Verificar que "Modo prueba" (`index.html`) sigue arrancando sin errores
  de consola (confirma que `Calendar.js`, no tocado, sigue cargando bien).

World Architecture, con esta entrega, se declara **estructuralmente
cerrada** (10.19.3) — la única deuda explícita restante es la retirada de
`Calendar.js`, documentada como fuera de alcance y no oculta.

_Migrado de `CHANGELOG.md` (líneas 121-260 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-07 — WORLD-CLEANUP-1: retirada final de proyecciones legacy (DESIGN.md 10.21)

Segunda y última PR de cierre posterior a WORLD-HARDEN-1 (la primera fue
WORLD-CONTEXT-1, entrada de abajo). Base real: `origin/main` en `e9f7ab9`
(merge de la PR #55 de WORLD-CONTEXT-1). Rama `refactor/world-cleanup-1`.
No añade contenido jugable — la partida española sigue siendo el único
contenido real instalado.

### Bugs/deuda cerrados

- **BUG-WORLD-CLEANUP-01** — `scripts/test-comp-core1.js` llevaba **21
  OK, 11 FAIL** desde WORLD-SIM-1: sus fixtures construían
  `CompetitionEdition`/`registerEditionWithInitialEntries()` sin el
  `detailLevel` explícito obligatorio. Corregidos los FIXTURES (nunca la
  validación productiva) → **32 OK, 0 FAIL**.
- **BUG-WORLD-CLEANUP-02** — `scripts/smoke-world-calendar1.js` construía
  un mundo sin `simulationProfile` (mismo fallo documentado desde
  10.19.2 punto 7). Corregido con un `WorldSimulationProfile` explícito
  (mismo perfil transitorio que `game.js`); el smoke no se ejecutó esta
  sesión (fuera de la lista de verificación autorizada).
- **BUG-WORLD-CLEANUP-03** — `PlayerDevelopment.computeExposureFactor()`
  leía `config.playerDevelopment.exposure.divisionWeight[exp.division]` —
  imposible de valorar una competición no española sin fingir una
  división. Sustituido por `competitionTierWeight`/
  `defaultCompetitionTierWeight`, resuelto por `CompetitionDefinition.tier`
  y CONGELADO en el registro de exposición en el momento del partido.
- **BUG-WORLD-CLEANUP-04** — `PlayerCareer.teamStints`/
  `SeasonHistoryService`/`game.js` guardaban `division`; un Team puede
  disputar varias competiciones en el mismo stint. Un stint ahora lleva
  `{teamId, teamName, clubId, clubName, stats, competitionStats: []}` —
  un acumulado por competición real, sin doble contabilización del total.
- **BUG-WORLD-CLEANUP-05** — `src/ui/game.js` traducía `stageKey` a
  semántica normativa/de historial con mapas fijos de UI
  (`UI_COMPETITION_KEY_BY_STAGE_KEY`/`competitionKeyForStageKey()`/
  `BRACKET_PHASE_IDS`/`COMPETITION_LABELS`). Retirados — el descriptor
  canónico (`CompetitionEngine.describeCompetitionContext()`) resuelve
  nombres/`rulesPhaseId` desde `CompetitionDefinition`/`CompetitionStage`
  reales; `rulesPhaseId` se declara por CONTENIDO
  (`CompetitionStageTemplate`, copiado a la Stage al crearse).
- **BUG-WORLD-CLEANUP-06** — `CareerSetupService.validateDraft()` solo
  comprobaba la competición INICIAL del club controlado. Ahora recorre el
  grafo COMPLETO de `CompetitionPathwayRule` alcanzables (BFS puro, con
  soporte de ciclos, ignora `catalog-only`), bloqueando "Comenzar carrera"
  con un único mensaje que lista todos los destinos incompatibles y su
  camino mínimo.
- **BUG-WORLD-CLEANUP-07** — `src/core/SpainLegacyCompetitionRuntime.js`
  ya no estaba en la ruta productiva pero seguía en `src/core`. Movido a
  `scripts/fixtures/legacy/SpainLegacyCompetitionRuntime.js` (sin ningún
  call-site en `src/`); sus tres consumidores históricos
  (`test-world-core1.js`/`smoke-world-core1.js`/`smoke-club-core1.js`)
  solo tuvieron su `require()` redirigido. `src/core/Calendar.js` NO se
  tocó (deliberado, ver "Límites" abajo).

### Símbolos/shims retirados

`Team.division`/`Team.legacyDivision`/`Team.DIVISIONS`/
`Team.validateDivision()`; `CompetitionDefinition.legacyDivision`;
`CompetitionParticipationService.projectLegacyDivision()`/
`projectLegacyDivisionForTeams()`; `CompetitionRules.
competitionIdFromLegacyDivision()` y su tabla `'1ª'/'2ª'`;
`SeasonHistoryService.captureDivisionsBefore()`/
`applyPromotionsAndRelegations()` (sin call-site canónico; sobreviven
solo para `scripts/cycle1-harness.js`, no ejecutado); `game.js`:
`getRealTeamsByDivision()`, `UI_COMPETITION_KEY_BY_STAGE_KEY`,
`competitionKeyForStageKey()`, `BRACKET_PHASE_IDS`, `COMPETITION_LABELS`;
`src/core/SpainLegacyCompetitionRuntime.js` fuera de `src/core`.
`SeasonGoals.recalculateSportingGoalsForDivision()` →
`recalculateSportingGoalsForCohort()` (misma fórmula, cohorte por
`competitionDefinitionId` real). `RegistrationRegistry.
registrationsForClub()`/`cumulativeCountForClub()` →
`registrationsForTeam()`/`cumulativeCountForTeam()`.
`RetirementAnnouncement.clubIdAtAnnouncement` → `teamIdAtAnnouncement`.
`ContractSeeder`/`RegistrationSeeder.seedFingerprint()`: segundo parámetro
renombrado a `teamId` (mismo valor/orden de hash, sin regenerar ids).

### Migraciones de forma

- `MatchConfig.playerDevelopment.exposure`: `divisionWeight: {'1ª':1.0,
  '2ª':0.7}` → `competitionTierWeight: {1:1.0, 2:0.7}` +
  `defaultCompetitionTierWeight: 1`.
- `PlayerDevelopment.recordMatchExposure()`: `{competition, division}` →
  `{competitionDefinitionId, competitionTier, stageId}` + `weight`
  congelado en el registro (nuevo parámetro `config` obligatorio).
- `PlayerCareer` `teamStint`: `{teamId, teamName, division, stats}` →
  `{teamId, teamName, clubId, clubName, stats, competitionStats:
  [{competitionDefinitionId, competitionName, competitionShortName,
  stats}]}`. `matchInfo`/milestones/personalBests: `competition`/
  `team.division` → `competitionDefinitionId`/`stageId`.
- `CompetitionStageTemplate`/`CompetitionStage`: + `rulesPhaseId` +
  `presentationRole`. `data/world/spain-2026.1.js` declara `rulesPhaseId`
  (`'league'`/`'title-playoff'`/`'promotion'` x2/`'cup'`) en sus cinco
  stage templates reales — mismos valores que el mapa de UI retirado.
- `Team.toJSON()`: sin `division`/`legacyDivision`.
- `summary.userTeamDivision` (cierre de temporada, `game.js`) →
  `summary.userPrimaryCompetitionId`.

### Resultados exactos de pruebas

- `node scripts/test-world-cleanup1.js` (nuevo, 7 comprobaciones
  agrupadas): **7 OK, 0 FAIL**.
- `node scripts/test-comp-core1.js`: **32 OK, 0 FAIL** (antes 21 OK, 11
  FAIL).
- `node scripts/test-world-context1.js`: **25 OK, 0 FAIL** (sin
  regresión de la PR #55).
- `node --check` sobre todo el JS nuevo/modificado y `git diff --check`:
  sin errores.

### Límites deliberados y checklist funcional manual pendiente

- `src/core/Calendar.js` **NO se retira** — sigue cargado en
  `index.html` (modo prueba técnico) y requerido directamente por ~20
  scripts de `scripts/`, incluido un test de regresión que afirma que
  `index.html` sigue cargándolo. Confirmado (auditoría estática) que no
  tiene ningún caller real dentro de `index.html`/`game.js` — su
  retirada exige migrar esos ~20 scripts primero, fuera del presupuesto
  de esta sesión (ver DESIGN.md 10.21.7).
- No se ejecutó ningún `smoke-*.js`, `test-world-calendar1.js`,
  `test-pathways1.js`, `test-world-ui1.js`, `test-cycle1.js`,
  `test-world-harden1.js`, batería de contratos/mercado/traspasos/
  cesiones, Playwright, ni el audit de diez temporadas — validación
  funcional manual pendiente de Dennis (checklist en DESIGN.md 10.21.9).
- Varios scripts NO tocados quedan con imports/llamadas rotas por los
  renombrados de esta sesión (`recalculateSportingGoalsForDivision` →
  `...ForCohort`, `registrationsForClub`/`cumulativeCountForClub` →
  `...ForTeam`, `competitionIdFromLegacyDivision` retirado de
  `CompetitionRules.js`, `PlayerDevelopment.recordMatchExposure()` con
  nueva firma) — aceptado deliberadamente (regla prioritaria de consumo:
  sin campaña de migración de `scripts/`), nunca declarado verificado.
- Deuda de naming NUEVA, detectada pero NO corregida esta sesión (fuera
  de la lista explícita del prompt de origen): `RetirementRecord.
  lastClubId`/`cleanup.rosterRemovedFromClubId` (`RetirementService.js`)
  guardan en realidad `team.id`, mismo patrón que los tres puntos ya
  corregidos — queda señalado para una futura sesión de naming.
- **Confirmación honesta del estado final de la EPIC**: World Architecture
  queda declarada **estructuralmente cerrada** con esta entrega — ningún
  dominio productivo decide ya por `Team.division`/división legacy/mapas
  fijos de UI. La única deuda estructural que sobrevive es la retirada de
  `Calendar.js` (documentada, no oculta) y la validación funcional manual
  completa (jugar la UI real varias temporadas), pendiente de Dennis.
