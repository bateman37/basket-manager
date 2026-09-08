# Ficha de Epic — REPO-HARDEN-1 (saneamiento técnico posterior a WORLD-CLEANUP-1)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `REPO-HARDEN-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Saneamiento técnico posterior a WORLD-CLEANUP-1 (Epic 0, no jugable, no de diseño).
- **Documento(s) canónico(s) vigente(s)**: `docs/STATUS.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 3-120 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-08 — REPO-HARDEN-1: saneamiento técnico posterior a WORLD-CLEANUP-1

Epic 0 de saneamiento (no jugable, no de diseño). Rama
`chore/repo-harden-1`, base `origin/main` en `861b3b2` (cierre de
WORLD-CLEANUP-1). Corrige deuda pequeña y directamente vinculada a esa
migración — sin campañas de migración masiva, sin reabrir World
Architecture.

- **Migrado `PlayerDevelopment.recordMatchExposure()` a su firma actual**
  (`{competitionDefinitionId, competitionTier, stageId}` + `config`) en
  `scripts/test-life1.js`/`test-life2.js` — llevaban 10/0 y 0/0 FAIL
  (10 fallos directos por la firma antigua, `TypeError` en cascada);
  ahora **22 OK / 28 OK, 0 FAIL** ambos. `smoke-life1..4.js` y
  `smoke-roster1.js` usan el mismo patrón antiguo pero además dependen de
  `recalculateSportingGoalsForDivision()`/`teamsByDivision`/`new Calendar()`
  (arquitectura de división íntegra, no solo la firma) — migrarlos exige
  reescribir su orquestación completa, aplazado como deuda (ver abajo).
- **Verificadores Playwright** (`verify-transfer1`, `verify-loan1`,
  `verify-market1`, `verify-reg1`, `verify-cycle1`) migrados de
  `state.leagues[state.division]`/`team.division`/
  `competitionIdFromLegacyDivision()` (retirados, ninguno existe ya en
  `window.BasketManagerGame`/`CompetitionRules.js`) a los contratos
  canónicos: `getUserTeam()` para el equipo del usuario,
  `state.world.registries.teams.get(id)`/`.all()` para lookups
  generales, `BM.CompetitionContextService.resolveDomesticCompetitionId()`
  para resolver competición. De paso, el lookup de propietario/cesionario
  en `verify-loan1-playwright.js` pasa de comparar `t.id` con un
  `ownerClubId`/`borrowerClubId` (que son Club ids, no Team ids desde
  CLUB-CORE-1) a comparar `t.clubId`, alineado con el patrón productivo
  de `game.js` (`resolveLoanReturn()`). `verify-cycle1-playwright.js`
  conserva `fastForwardSeasonToClose()` sin migrar (usa
  `simulateNextRound`/`simulateBackgroundRound`/`drainBackgroundBrackets`/
  `getLeague`/`getBrackets`/`buildCpuOnlyResolver`, retirados en
  WORLD-CALENDAR-1) — es un cambio de fondo (modelo de cursor único vs.
  bloques por división), documentado inline como deuda aplazada, no un
  ajuste de patrón. Ninguno de los cinco se ejecutó contra un navegador
  real esta sesión (fuera del presupuesto) — solo se dejaron
  sintácticamente correctos y coherentes con los contratos actuales.
- **`Calendar.js`**: confirmado (auditoría estática) que no tiene ningún
  caller productivo real en `index.html`/`game.js`/`src/`. Se quitó su
  `<script>` de `index.html` (cambio pequeño y seguro); el ARCHIVO se
  conserva en disco sin cambios — lo siguen requiriendo directamente
  ~20 `scripts/*.js` históricos, ajenos al `<script>` del navegador y
  fuera de esta Epic. Ver DESIGN.md 10.21.7 (addendum).
- **Flaky de legalidad (`FORMATION_QUOTA_INFEASIBLE`)**: no se pudo
  reproducir con el presupuesto de una reproducción dirigida — los dos
  smokes más próximos al bug documentado (`smoke-reg1.js`, primer
  reporte; `smoke-loan1.js`, reporte en WORLD-CONTEXT-1) fallan de
  inmediato con un `TypeError` no relacionado
  (`CompetitionRules.competitionIdFromLegacyDivision is not a function`,
  deuda ya documentada de WORLD-CLEANUP-1, fuera del alcance mínimo de
  esta Epic). Revisado el camino de legalidad/semilla
  (`RosterLegalityService.tryGenerateEmergencyPlayer()`,
  `playerGenerator.padRosterToMinimum()`/`generateFictionalPlayer()`):
  BUG-CYCLE1-02 ya hizo determinista la generación de atributos/id
  cuando se pasa `seed`/`id`/`careerSeed` explícitos, y los call-sites
  auditados sí los pasan. Diagnóstico acotado, no una corrección: sigue
  sin identificarse la fuente exacta del no determinismo intermitente;
  hipótesis abierta más probable, sin verificar, es un call-site del
  camino de convocatoria CPU multi-temporada que aún no hereda
  `careerSeed` explícito. Siguiente paso recomendado: reparar primero el
  `TypeError` de `competitionIdFromLegacyDivision` en `smoke-reg1.js`/
  `smoke-loan1.js` (ambos ya rotos por deuda ajena) para poder volver a
  ejecutarlos, y entonces comparar ids/atributos generados entre dos
  ejecuciones idénticas para aislar el primer punto de divergencia.
- **`docs/manual/WORLD_ARCHITECTURE_ACCEPTANCE.md`**: actualizada —
  título/intro reflejan el cierre estructural de World Architecture con
  WORLD-CLEANUP-1 (no solo WORLD-HARDEN-1 parcial); el paso 6 ya no pide
  anotar "división" (retirada del motor) y añade la comprobación de
  competitionStats dobles sin duplicar; nuevo paso 8 para confirmar que
  "Modo prueba" sigue arrancando sin errores tras quitar el `<script>`
  de `Calendar.js`. Sigue sin ejecutarse por esta sesión — checklist para
  Dennis.

### Pruebas ejecutadas

- `node scripts/test-world-cleanup1.js`: **7 OK, 0 FAIL** (idéntico a la
  entrega anterior, sin regresión).
- `node scripts/test-comp-core1.js`: **32 OK, 0 FAIL** (idéntico).
- `node scripts/test-world-calendar1.js` (dirigido al cambio de
  `index.html`, incluye la comprobación estática de `Calendar.js`):
  **25 OK, 0 FAIL**.
- `node scripts/test-life1.js`: **22 OK, 0 FAIL** (antes 12 OK/10 FAIL).
- `node scripts/test-life2.js`: **28 OK, 0 FAIL** (sin cambio — ya
  estaba roto por la misma firma antigua, confirmado antes de migrar).
- `node --check` sobre los 7 `.js` modificados y `git diff --check`:
  sin errores.
- No se ejecutó ningún smoke largo, batería completa, Playwright ni
  auditoría de varias temporadas (fuera del presupuesto de esta Epic).

### Deuda expresamente aplazada (no resuelta esta sesión)

- `smoke-life1.js`/`smoke-life2.js`/`smoke-life3.js`/`smoke-life4.js`/
  `smoke-roster1.js`: además de la firma antigua de `recordMatchExposure()`,
  dependen de `recalculateSportingGoalsForDivision()` (retirada,
  renombrada a `...ForCohort()`), `teamsByDivision`/`REAL_DATA_INDEX
  .division` y `new Calendar()` — requieren reescribir su orquestación de
  temporada completa, no un ajuste de firma.
- `verify-cycle1-playwright.js`: `fastForwardSeasonToClose()` sigue
  usando la API de avance por bloques retirada en WORLD-CALENDAR-1
  (`simulateNextRound`/`simulateBackgroundRound`/`drainBackgroundBrackets`/
  `getLeague`/`getBrackets`/`buildCpuOnlyResolver`) — migrar a
  `advanceWorldUntilNextUserStop()`/`peekNextUserMatchDescriptor()` es un
  cambio de fondo, documentado inline en el script.
- El resto de `verify-*-playwright.js` (contract1/life3/life4/roster1) no
  presentaba ninguno de los patrones auditados — no se tocaron.
- Flaky `FORMATION_QUOTA_INFEASIBLE`: diagnóstico acotado (ver arriba),
  sin corrección ni reproducción confirmada esta sesión.
- Deuda de naming ya conocida y sin tocar (documentada desde
  WORLD-CLEANUP-1/WORLD-CONTEXT-1): `RetirementRecord.lastClubId`/
  `cleanup.rosterRemovedFromClubId` siguen guardando en realidad
  `team.id`.
- `CompetitionRules.competitionIdFromLegacyDivision()` retirado sigue
  roto en varios scripts históricos NO tocados (`smoke-reg1.js`,
  `smoke-loan1.js` y otros) — deuda ya documentada en WORLD-CLEANUP-1,
  confirmada de nuevo aquí al intentar reproducir el flaky de legalidad,
  no ampliada.
