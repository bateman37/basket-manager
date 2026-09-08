# Ficha de Epic — PATHWAYS-1 (clasificación y ascenso/descenso declarativos)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `PATHWAYS-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Clasificación y ascenso/descenso declarativos entre fases/competiciones.
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/pathways.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 8917-9143 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.15 PATHWAYS-1 — resultado

Quinta entrega de la EPIC. Base: `af115cb` (merge de la PR #49,
WORLD-CALENDAR-1) en `origin/main`. Completa la columna vertebral
deportiva (identidad, ejecución, tiempo, progresión): decidir quién avanza
de fase, quién entra en otro torneo, quién asciende/desciende o conserva
plaza deja de estar repartido entre el formato, `CompetitionEngine`,
`game.js` y `SeasonHistoryService` — vive en reglas de pathway
declarativas, versionadas, serializables y con receipt.

#### 10.15.1 Modelo y vocabulario

`src/entities/CompetitionPathway.js` — `CompetitionPathwayRule` (dato
plano congelado: `id`, `kind`, `trigger`, `selector`, `destination`,
`seedPolicy`, `outcomeCode`, `transitionGroupId` opcional, `provenance`) y
`CompetitionPathwayDefinition` (`id`/`version`/`status`/`participantType`/
`rules` ordenadas por id/`transitionGroups`/`provenance`, congelada con
`Object.freeze()`). Vocabulario CERRADO (sección 7.3 del prompt): `kind` ∈
`stage-qualification | competition-qualification | next-season-membership`;
`trigger` ∈ `round-completed | stage-completed | season-transition`;
`selector` ∈ `standings-range | bracket-final-round-winners |
bracket-champion | remaining-participants`; `seedPolicy` ∈ `source-rank |
preserve-source-seed | best-vs-worst-by-seed | none`; `destination` ∈
`{type:'stage'} | {type:'competition-edition'} | {type:'next-season-competition'}`.
El core NUNCA contiene `promotion`/`relegation`/`cup`/`continental` como
concepto — esos significados son `outcomeCode` de CONTENIDO.

Dos receipts, registrados en `WorldRegistries` (`pathwayReceipts`/
`seasonTransitionReceipts`, nuevos registros por carrera):
`CompetitionPathwayReceipt` (evidencia INMUTABLE de una regla aplicada:
definición/versión/regla/temporada origen/trigger/destino/qualifiers/
`outcomeCode`/instante+huso REAL/`status`) y
`CompetitionSeasonTransitionReceipt` (commit atómico de un transition
group completo: `memberships` por competición destino, `moves` con
`outcomeCode` y receipt fuente, ids de Editions/Entries creadas). Un
receipt aplicado nunca se reescribe; recalcular el mismo hecho/transición
devuelve el existente (idempotencia real).

`CompetitionStage` gana `stageKey` EXPLÍCITO (ya no se deduce cortando el
`id`); `CompetitionEdition` gana `pathwayBindingIds` (congelados al
crearse, en `toJSON()`); `CompetitionEntry` gana `qualificationReceiptId`
(`qualificationSource` se conserva por compatibilidad).

#### 10.15.2 Catálogo y servicio

`src/core/CompetitionPathwayCatalog.js` — mismo contrato que
`CompetitionFormatCatalog.js` (idempotente por id+version idéntica, error
descriptivo ante otra versión, `requirePathwayDefinition()` nunca cae a
España por defecto).

`src/core/CompetitionPathwayService.js` — instancia EXPLÍCITA por carrera
(`world`, `competitionEngine`, catálogo, `now()` inyectado —nunca
`Date.now()`—, `resolveEditionBindings()` inyectado —quién sabe qué
formato/calendario/ruleset/pathways congela una Edition nueva es SIEMPRE
el paquete de contenido—). `handleEngineFact(fact)` reacciona a los hechos
`round-completed`/`stage-completed` que emite el engine, localiza las
reglas de los `pathwayBindingIds` de la Edition cuyo trigger coincide (en
orden de id) y aplica cada una como mucho una vez (receipt id determinista
`pathway:{definitionId}:{ruleId}:{sourceSeasonKey}`). `applyTransitionGroup()`
confirma un grupo de `next-season-membership` completo: preflight PURO
(resuelve qualifiers de cada regla explícita, calcula `remaining-participants`
descontando movimientos ya explícitos, valida cardinalidad EXACTA declarada
por el grupo y exclusividad de pirámide) y solo si TODO valida, COMMIT
atómico (`completePreviousEditions()` + `activateEditionFromDecision()` por
competición destino + receipt). Un lote inválido no deja ningún target
parcial. `isTransitionGroupReady()` es una consulta PURA (nunca muta,
nunca consume RNG) que el llamador usa antes de confirmar.

#### 10.15.3 Cambios mínimos en `CompetitionEngine`

Aditivos, sin romper la cascada legacy de `activation`/`entrySource` que
siguen usando fixtures/tests históricos: `setFactHandler(fn)` (invocado
ANTES de la cascada interna, con el hecho plano `{type, editionId, stageId,
stageKey, round}`); consultas PURAS `getStandingsFacts()`/
`getBracketFinalRoundWinners()`/`getBracketChampion()`/`isStageCompleted()`;
API pública de activación `activateStageFromQualifiers(editionId, stageKey,
qualifiers, options)` y `activateEditionFromDecision({...})` —
idempotentes por stage id/edition id, nunca interpretan POR QUÉ un
conjunto de participantes clasifica (eso lo decidió ya el pathway).
`registerEditionWithInitialEntries()` acepta `pathwayBindingIds`/
`qualificationReceiptId` opcionales. Dos nuevos tipos cerrados en
`src/entities/Competition.js`: `activation.type`/`entrySource.type`
`'pathway-managed'` — una fase así declarada por el formato NUNCA se
autoactiva por la cascada legacy (ningún hecho real coincide con ese
tipo); solo la API pública de activación, invocada por el pathway, la
construye.

#### 10.15.4 Migración española

`spain-2026.1.js` registra `spain-2026.1:pathway:domestic-club-v1`
(versión `2026.1.0`) con 9 reglas: `acb-title-playoff-qualification`
(top-8 de la liga regular ACB → stage `title-playoff`),
`acb-copa-qualification` (top-8 en la foto de la jornada 17 → Edition de
`copa-acb`, `competition-qualification` — sustituye a
`buildSeasonActivationPlan()`/`registerCrossEditionActivation()` en la
ruta productiva), `feb-promotion-quarterfinals-qualification` (2º-9º de
Primera FEB → `promotion-quarterfinals`),
`feb-promotion-final-four-qualification` (ganadores de cuartos, reseed
`best-vs-worst-by-seed` → `promotion-final-four`), y cinco reglas
`next-season-membership` del transition group
`acb-feb-domestic-v1` (`acb-relegation` 17º-18º → Primera FEB;
`feb-direct-promotion` 1º → ACB; `feb-playoff-promotion` campeón de la
Final Four → ACB; `acb-remaining-membership`/`feb-remaining-membership`,
`remaining-participants`). Los formatos `acb-liga-playoff`/
`primera-feb-liga-ascenso` migran sus fases de playoff/ascenso a
`activation`/`entrySource` `'pathway-managed'` (BUG-PATHWAYS-01) — el
`runnerConfig` (cuadro fijo, patrones de campo) sigue siendo del formato,
nunca del pathway. `editionBindings()` congela `pathwayBindingIds:
[PATHWAY_IDS.DOMESTIC_CLUB]` en las Editions de ACB/Primera FEB (Copa no
alimenta ninguna regla propia, `pathwayBindingIds: []`).

`game.js`: `startSeason()` registra el pathway español y conecta
`CompetitionEngine.setFactHandler()` a una instancia por carrera de
`CompetitionPathwayService` — YA NO llama a
`buildSeasonActivationPlan()`/`registerCrossEditionActivation()`.
`closeSeasonAndPrepareNext()` captura `divisionsBefore` (membership
ANTERIOR, para el histórico), confirma
`pathwayService.applyTransitionGroup(DOMESTIC_CLUB, acb-feb-domestic-v1,
...)` (crea de forma atómica las Editions/Stages/Entries de ACB/Primera
FEB de la temporada siguiente, 18+18), deriva
`promotedTeams`/`relegatedTeams` con
`SeasonHistoryService.deriveSeasonMovesFromTransitionReceipt()` (lee
`receipt.moves`, nunca recalcula standings) y SOLO ENTONCES proyecta
`team.division`/`legacyDivision` con
`CompetitionParticipationService.projectLegacyDivisionForTeams()`
(BUG-PATHWAYS-04). El ciclo anual (`AnnualCycleService.closeSeasonHistory()`)
acepta un `targetCompetitionIdForTeam(team)` opcional — game.js lo resuelve
desde la Entry YA comprometida (`CompetitionParticipationService.
primaryLeagueCompetitionId()`), nunca desde `competitionIdFromLegacyDivision
(team.division)`; sin ese callback (scripts de humo anteriores a esta
entrega), el comportamiento histórico se conserva sin cambios. Se elimina
además el helper muerto duplicado `buildSeasonHonoursByTeamId()` de
`game.js` (sin call-sites, sección 12.3 del prompt).

#### 10.15.5 Bugs corregidos

- **`BUG-PATHWAYS-01`** (formato y clasificación eran la misma autoridad):
  `title-playoff`/`promotion-quarterfinals`/`promotion-final-four` dejan
  de declarar `activation`/`entrySource` de selección — pasan a
  `'pathway-managed'`; la clasificación real vive en las reglas del
  pathway español.
- **`BUG-PATHWAYS-02`** (la Copa no dejaba recibo canónico): la foto de la
  jornada 17 ahora es una regla `competition-qualification` con receipt
  estable (`qualifiers`, `outcomeCode`, instante real) — antes quedaba solo
  en un plan estacional (`buildSeasonActivationPlan()`) y un marcador
  transitorio del runtime.
- **`BUG-PATHWAYS-03`** (el campeón de ascenso directo se recalculaba dos
  veces): `feb-direct-promotion` se resuelve UNA vez, dentro del
  transition group — `SeasonHistoryService.deriveSeasonMovesFromTransitionReceipt()`
  es la ÚNICA fuente que consumen honores y ciclo anual (la vista LIVE
  `buildPromotionPlayoffCompatView()` de la pantalla en curso sigue
  existiendo como previsualización de solo lectura, nunca como segunda
  autoridad).
- **`BUG-PATHWAYS-04`** (`Team.division` gobernaba la temporada
  siguiente): invertido — `applyTransitionGroup()` construye y valida
  18+18 ANTES; `team.division`/`legacyDivision` se proyectan DESPUÉS del
  commit real, nunca al revés. `SeasonHistoryService.
  applyPromotionsAndRelegations()` (mutaba `team.division` directamente)
  queda retirado de la ruta productiva.
- **`BUG-PATHWAYS-05`** (acotado a la ruta que esta entrega toca): el
  transition receipt y sus `moves` usan SIEMPRE `participantId` real
  (`teamId` deportivo) — nunca lo confunden con `clubId`. La deuda
  histórica de naming en `ClubCycleCase`/`RosterLegalityReport`/
  `EmergencyRosterAction`/`LastOfficialMatchEvidenceCollector` (que
  guardan `team.id` bajo campos llamados `clubId`, documentada ya en
  CLAUDE.md CLUB-CORE-1) NO se ha tocado en esta entrega: corregirla
  exige tocar `AnnualCycleService.freezeSnapshot()`, compartida por seis
  scripts de humo ajenos a PATHWAYS-1 fuera del presupuesto de pruebas
  autorizado — propietario: la primera sesión que reabra esa ruta.

#### 10.15.6 Shims y límites

`buildSeasonActivationPlan()`/`registerCrossEditionActivation()`/
`bindNewSeasonEditions()` (spain-2026.1.js) y
`SeasonHistoryService.applyPromotionsAndRelegations()` quedan SIN
call-sites productivos nuevos — se conservan exportados únicamente porque
`scripts/test-world-calendar1.js`/`scripts/smoke-world-calendar1.js` (y
otros scripts de humo anteriores a esta entrega) siguen construyendo su
cierre desde `League`/`Bracket`/`PromotionPlayoff` standalone; se retiran
en **WORLD-HARDEN-1** junto con el resto de puentes legacy documentados en
10.8. `UI_COMPETITION_KEY_BY_STAGE_KEY` sigue vivo para
etiquetas/exposición de interfaz — nunca decide reglas/triggers/destinos.

#### 10.15.7 Invariantes ampliadas

Ver sección 10.10 (invariantes 42-49, añadidas por esta entrega).

#### 10.15.8 Pruebas reales

`node scripts/test-pathways1.js` (19 comprobaciones dirigidas —
validación/inmutabilidad/serialización/versionado del catálogo y la
entidad, `stageKey`/`pathwayBindingIds` congelados, selectors y seed
policies mínimos, `stage-qualification`/`competition-qualification`
reales, fixture nacional→continental SIN instalar España, receipt estable
e idempotente ante trigger repetido, orden de participantes invertido con
resultado idéntico, preview sin mutación/RNG, lote inválido sin mutación
parcial, transición anual 4+4 con cardinalidad/exclusividad/idempotencia
real y Entry enlazada al receipt, idempotencia de la API pública de
activación del engine, selector `bracket-champion` sin campeón bloquea,
auditorías estáticas de literales españoles y de call-sites productivos
retirados — **19 OK, 0 fallos**). `node scripts/smoke-pathways1.js` (36
clubes/equipos reales, UNA temporada completa por la cola mundial: 659
partidos resueltos, 42 paradas del usuario; Copa/playoff ACB/cuartos y
Final Four de ascenso con qualifiers/seeds exactos vía receipts, sin
duplicados; UNA transición anual vía `applyTransitionGroup()` — ascienden
Gran Canaria y Covirán Granada, descienden Recoletas Salud San Pablo
Burgos y Leyma Coruña, 18+18 Entries target, proyección legacy correcta;
integridad World/Competition/Calendar, MoraBanc Andorra (`teamId`/`clubId`
distintos), Supercopa sin runtime; no juega la segunda temporada — **OK en
~7s**). Regresiones autorizadas: `node scripts/test-comp-core1.js` (**32
OK, 0 fallos**, sin cambios de fixture) y `node scripts/test-world-calendar1.js`
(**25 OK, 0 fallos**, sin cambios de fixture — ninguno de los dos
inspecciona `activation`/`entrySource` del formato español). `node --check`
sobre todo el JS nuevo/modificado y `git diff --check`: sin errores.

#### 10.15.9 Fuera de alcance de esta entrega

Euroliga/EuroCup/BCL/Intercontinental/Supercopa jugable o cualquier
competición real nueva; asignar plazas europeas reales a ACB (solo
capacidad genérica de test); niveles de detalle/simulación exterior
(**WORLD-SIM-1**); selecciones (**NATIONAL-TEAMS-1**); navegación
mundial/selector de ligas (**WORLD-UI-1**); persistencia SQL/save-load
(**WORLD-HARDEN-1**); sanciones/renuncias/vacantes/wildcards/descensos por
economía; traspasos/cesiones CPU-a-CPU orgánicos; cambios de reglas
ACB/FEB/contrato/mercado/inscripción/cantera/retirada/economía; migración
global de la deuda naming-only de Cycle fuera del camino anual tocado.

_Migrado de `CHANGELOG.md` (líneas 975-1184 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-06 — PATHWAYS-1: clasificación y ascenso/descenso declarativos (DESIGN.md sección 10.15)

Quinta entrega de la EPIC **World Architecture** (WORLD-CORE-1 →
CLUB-CORE-1 → COMP-CORE-1 → WORLD-CALENDAR-1 → **PATHWAYS-1** →
WORLD-SIM-1 → NATIONAL-TEAMS-1 → WORLD-UI-1 → WORLD-HARDEN-1). Base:
`af115cb` (`origin/main`, merge de la PR #49 WORLD-CALENDAR-1). Rama
`claude/modest-gauss-ab8bat`.

Decidir quién avanza a una fase, entra en otro torneo, asciende, desciende
o conserva plaza dejaba de ser comportamiento repartido entre el formato,
`CompetitionEngine`, `game.js` y `SeasonHistoryService`. Esta entrega
aísla esas decisiones en reglas de pathway declarativas, versionadas,
serializables y con receipt — España sigue siendo la primera vertical
funcional (ACB, Primera FEB, Copa ACB), no el modelo universal; no se
añade ninguna competición real nueva.

### Bugs corregidos

- **`BUG-PATHWAYS-01`** — formato y clasificación eran la misma
  autoridad. *Causa*: `title-playoff`/`promotion-quarterfinals`/
  `promotion-final-four` declaraban `activation`/`entrySource` con el
  rango de puestos, el reseed y el disparador incrustados en el propio
  `CompetitionFormatDefinition` español. *Corrección*: esas tres fases
  pasan a `activation`/`entrySource: 'pathway-managed'` (dos tipos nuevos,
  cerrados, en `src/entities/Competition.js`) — el formato conserva solo
  `runnerConfig` (cuadro, patrones de campo); la clasificación real vive
  en `spain-2026.1:pathway:domestic-club-v1`
  (`data/world/spain-2026.1.js`). El engine nunca autoactiva una fase
  `'pathway-managed'` por su cascada legacy (ningún hecho real coincide
  con ese tipo de activación).
- **`BUG-PATHWAYS-02`** — la clasificación a Copa no dejaba recibo
  canónico. *Causa*: la foto de la jornada 17 se resolvía en
  `buildSeasonActivationPlan()`/`registerCrossEditionActivation()`, un
  plan estacional + un marcador transitorio del runtime, sin ningún
  registro estable de qué 8 equipos clasificaron ni con qué seeds.
  *Corrección*: regla `acb-copa-qualification`
  (`competition-qualification`, trigger `round-completed` en la jornada
  17) — deja un `CompetitionPathwayReceipt` con qualifiers/seeds/instante
  real. `buildSeasonActivationPlan()`/`registerCrossEditionActivation()`
  quedan sin call-sites productivos en `game.js`.
- **`BUG-PATHWAYS-03`** — el campeón de ascenso directo se recalculaba
  dos veces. *Causa*: `buildPromotionPlayoffCompatView()` extraía el 1º de
  Primera FEB en vivo, y el cierre de temporada lo volvía a extraer por su
  cuenta — dos cálculos independientes del mismo hecho, sin garantía de
  coherencia. *Corrección*: `feb-direct-promotion` (regla
  `next-season-membership` del transition group) resuelve el hecho UNA
  vez; `SeasonHistoryService.deriveSeasonMovesFromTransitionReceipt()` es
  la ÚNICA fuente que leen honores y ciclo anual. La vista LIVE de la
  pantalla en curso sigue existiendo como previsualización de solo
  lectura, nunca como segunda autoridad.
- **`BUG-PATHWAYS-04`** — `Team.division` gobernaba la temporada
  siguiente. *Causa*: `closeSeasonAndPrepareNext()` mutaba
  `team.division` primero (`SeasonHistoryService.
  applyPromotionsAndRelegations()`), agrupaba equipos por ese string
  después y solo entonces creaba las Editions/Entries de la temporada
  siguiente (`bindNewSeasonEditions()`) — el alias legacy decidía la
  composición real. *Corrección*: invertido por completo.
  `CompetitionPathwayService.applyTransitionGroup()` construye y VALIDA
  18+18 de forma atómica (preflight puro + commit); `team.division`/
  `legacyDivision` se proyectan DESPUÉS, desde esa membership ya
  comprometida
  (`CompetitionParticipationService.projectLegacyDivisionForTeams()`).
  `SeasonHistoryService.applyPromotionsAndRelegations()`/
  `bindNewSeasonEditions()` quedan sin call-sites productivos.
- **`BUG-PATHWAYS-05`** (acotado) — `teamId`/`clubId` se confundían en
  varios puntos del ciclo anual (`ClubCycleCase`, evidencia de último
  partido oficial). *Corrección aplicada*: el transition receipt y sus
  `moves` usan siempre `participantId` real (`teamId` deportivo),
  verificado explícitamente en `scripts/test-pathways1.js`. *Deuda NO
  tocada, documentada explícitamente*: `ClubCycleCase.clubId`/
  `RosterLegalityReport.clubId`/`EmergencyRosterAction.clubId`/
  `LastOfficialMatchEvidenceCollector` siguen guardando `team.id` bajo
  campos llamados `clubId` (deuda ya señalada en CLAUDE.md, bloque
  CLUB-CORE-1) — corregirla exige tocar
  `AnnualCycleService.freezeSnapshot()`, compartida por
  `scripts/cycle1-harness.js` y seis scripts de humo ajenos a esta
  entrega (fuera del presupuesto de pruebas autorizado de PATHWAYS-1).
  Propietario: la primera sesión que reabra esa ruta.

### Arquitectura — Format ≠ Engine ≠ Pathway

- `src/entities/CompetitionPathway.js` (nuevo): `CompetitionPathwayRule`/
  `CompetitionPathwayDefinition` (vocabulario cerrado — `kind`/`trigger`/
  `selector`/`seedPolicy`/`destination` — congeladas, serializables) y los
  dos receipts (`CompetitionPathwayReceipt`,
  `CompetitionSeasonTransitionReceipt`).
- `src/core/CompetitionPathwayCatalog.js` (nuevo): mismo contrato que
  `CompetitionFormatCatalog.js` (idempotente por id+version).
- `src/core/CompetitionPathwayService.js` (nuevo): `handleEngineFact()`
  (reacciona a hechos del engine dentro de temporada) +
  `applyTransitionGroup()` (transición anual atómica) +
  `isTransitionGroupReady()` (consulta pura).
- `src/core/CompetitionEngine.js`: `setFactHandler()`, consultas puras
  (`getStandingsFacts`/`getBracketFinalRoundWinners`/`getBracketChampion`/
  `isStageCompleted`), API pública de activación
  (`activateStageFromQualifiers`/`activateEditionFromDecision`, ambas
  idempotentes), `registerEditionWithInitialEntries()` acepta
  `pathwayBindingIds`/`qualificationReceiptId` opcionales — todo aditivo,
  la cascada legacy de `activation`/`entrySource` sigue intacta para
  fixtures/tests históricos.
- `src/core/WorldRegistry.js`: registros nuevos por carrera
  (`pathwayReceipts`, `seasonTransitionReceipts`), integrados en
  `validateIntegrity()`/`describe()`.
- `src/entities/Competition.js`: `CompetitionStage.stageKey` explícito,
  `CompetitionEdition.pathwayBindingIds` congelado,
  `CompetitionEntry.qualificationReceiptId`, tipos `'pathway-managed'`
  añadidos a `ACTIVATION_TYPES`/`ENTRY_SOURCE_TYPES`.
- `src/core/CompetitionParticipationService.js`: `projectLegacyDivision()`/
  `projectLegacyDivisionForTeams()` — proyección legacy SIEMPRE posterior
  al commit real, `null` explícito sin `legacyDivision` (nunca `'1ª'` por
  defecto).
- `src/core/SeasonHistoryService.js`: `deriveSeasonMovesFromTransitionReceipt()`
  nuevo (lee el receipt, nunca recalcula standings);
  `applyPromotionsAndRelegations()` se conserva para scripts de humo
  anteriores a esta entrega.
- `src/core/AnnualCycleService.js`: `closeSeasonHistory()` acepta
  `targetCompetitionIdForTeam` opcional (resuelve desde la Entry real
  cuando el llamador lo aporta; conserva el comportamiento histórico si
  no).

### Contenido español migrado

`data/world/spain-2026.1.js` registra `spain-2026.1:pathway:domestic-club-v1`
(9 reglas): playoff por el título (top-8), Copa (foto jornada 17,
`competition-qualification`), cuartos de ascenso (2º-9º), Final Four
(reseed `best-vs-worst-by-seed`), y el transition group
`acb-feb-domestic-v1` (descenso 17º-18º, ascenso directo 1º, ascenso por
playoff, `remaining-participants` de ambas ligas). Los tres formatos
`acb-liga-playoff`/`primera-feb-liga-ascenso` migran sus fases de
playoff/ascenso a `'pathway-managed'`. `game.js` conecta
`CompetitionPathwayService` en `startSeason()` (`setFactHandler`) y
reescribe `closeSeasonAndPrepareNext()`: captura `divisionsBefore` →
`applyTransitionGroup()` → deriva `promotedTeams`/`relegatedTeams` del
receipt → proyecta `team.division`/`legacyDivision` → abre el ciclo anual
con `targetCompetitionIdForTeam` resuelto desde la Entry real. Se elimina
el helper muerto duplicado `buildSeasonHonoursByTeamId()` de `game.js`
(sin call-sites).

### Pruebas exactas ejecutadas

- `node scripts/test-pathways1.js` — **19 OK, 0 FAIL** (validación/
  inmutabilidad/serialización/versionado, `stageKey`/`pathwayBindingIds`
  congelados, selectors/seed policies, `stage-qualification`/
  `competition-qualification` reales con seeds verificados, fixture
  nacional→continental sin instalar España, receipt estable e idempotente
  ante trigger repetido, orden de participantes invertido con resultado
  idéntico, preview sin mutación/RNG, lote inválido sin mutación parcial,
  transición anual 4+4 con cardinalidad/exclusividad/idempotencia real y
  Entry enlazada al receipt, idempotencia de `activateStageFromQualifiers`/
  `activateEditionFromDecision`, selector `bracket-champion` sin campeón
  bloquea, auditorías estáticas).
- `node scripts/smoke-pathways1.js` — **OK en ~7s** (36 clubes/equipos
  reales, 659 partidos resueltos por la cola mundial, 42 paradas del
  usuario; Copa (8 qualifiers), playoff ACB (top-8 real), cuartos de
  ascenso (2º-9º real) y Final Four (4, reseed verificado) con receipts
  únicos; transición anual real — ascienden Gran Canaria y Covirán
  Granada, descienden Recoletas Salud San Pablo Burgos y Leyma Coruña,
  18+18 Entries target, proyección legacy correcta; integridad World/
  Competition/Calendar, MoraBanc Andorra con `teamId`/`clubId` distintos,
  Supercopa sin runtime; no juega la segunda temporada).
- `node scripts/test-comp-core1.js` — **32 OK, 0 FAIL** (sin cambios de
  fixture).
- `node scripts/test-world-calendar1.js` — **25 OK, 0 FAIL** (sin cambios
  de fixture).
- `node --check` sobre todo el JS nuevo/modificado y `git diff --check`:
  sin errores.

### Shims que quedan (propietario: WORLD-HARDEN-1)

`buildSeasonActivationPlan()`/`registerCrossEditionActivation()`/
`bindNewSeasonEditions()` (`data/world/spain-2026.1.js`) y
`SeasonHistoryService.applyPromotionsAndRelegations()` — sin call-sites
productivos nuevos, conservados solo para
`scripts/test-world-calendar1.js`/`scripts/smoke-world-calendar1.js` y
scripts de humo anteriores a esta entrega. La deuda de naming
`clubId`/`teamId` en `ClubCycleCase`/`RosterLegalityReport`/
`EmergencyRosterAction`/`LastOfficialMatchEvidenceCollector` sigue sin
tocar (ver BUG-PATHWAYS-05 arriba).

### Archivos principales

Nuevos: `src/entities/CompetitionPathway.js`,
`src/core/CompetitionPathwayCatalog.js`,
`src/core/CompetitionPathwayService.js`, `scripts/test-pathways1.js`,
`scripts/smoke-pathways1.js`. Modificados: `src/entities/Competition.js`,
`src/core/CompetitionEngine.js`, `src/core/WorldRegistry.js`,
`src/core/CompetitionParticipationService.js`,
`src/core/SeasonHistoryService.js`, `src/core/AnnualCycleService.js`,
`data/world/spain-2026.1.js`, `src/ui/game.js`, `index.html`,
`DESIGN.md`, `CLAUDE.md`.

### Fuera de alcance

Euroliga/EuroCup/BCL/Intercontinental/Supercopa jugable o cualquier
competición real nueva; asignar plazas europeas reales a ACB (solo
capacidad genérica de test); niveles `playable/full/standard/abstract` y
simulación exterior (WORLD-SIM-1); selecciones (NATIONAL-TEAMS-1);
navegación mundial/selector de ligas (WORLD-UI-1); persistencia SQL/
save-load (WORLD-HARDEN-1); sanciones/renuncias/vacantes/wildcards;
traspasos/cesiones CPU-a-CPU orgánicos; cambios de reglas ACB/FEB/
contrato/mercado/inscripción/cantera/retirada/economía; migración global
de la deuda naming-only de Cycle fuera del camino anual tocado.

Confirmado: `data/real/*` no cambió; no se añadió SQL/save-load/backend/
dependencias; no se añadió ninguna competición real nueva; no se ejecutó
Playwright ni simulación larga (una sola temporada + una transición). La
PR queda abierta contra `main`, sin fusionar.

Siguiente entrega: **WORLD-SIM-1**.
