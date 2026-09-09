# STATUS — Estado actual del proyecto

Fotografía del presente, no un resumen de sesiones. Fecha y commit
contrastados: **2026-09-09**, `origin/main` en `9c77d0e` (PR #61,
`SQUAD-BUDGET-1`, ya FUSIONADA) + `ECONOMY-BOARD-1` (economía real del
club, manager/junta y peticiones de ampliación de presupuesto),
completada en rama `claude/modest-gauss-ab8bat` (reiniciada desde `main`,
sin fusionar todavía). Si `origin/main` ha avanzado desde entonces, esta
foto puede estar desactualizada — compruébalo antes de asumirla.

## Arquitectura y contenido realmente disponibles

- **Implementado**: motor genérico de mundo (`GameWorld`, `WorldRegistries`)
  con **España (ACB + Primera FEB + Copa)** como único paquete de
  contenido real instalado (`data/world/spain-2026.1.js`). World
  Architecture (nueve entregas, WORLD-CORE-1 → WORLD-CLEANUP-1) está
  **estructuralmente cerrada** desde `WORLD-CLEANUP-1` — ver contradicción
  resuelta más abajo.
- **Implementado**: ciclo profesional de plantilla completo — Player
  Registry mundial, contratos, inscripción/licencias/elegibilidad,
  mercado con negociación y Agreement in Principle, traspasos, cesiones,
  ciclo anual (expiración, renovación, retirada, cantera, clearinghouse
  CPU). Ningún dominio de este ciclo abre transfer internacional real ni
  licencia FIBA (ver deuda).
- **Implementado**: simulación de partidos posesión a posesión, sistema
  táctico completo (TAC-1 a TAC-7), alineación por slots, minutos de la
  basura, ficha universal de jugador con carrera/histórico, entrenamiento,
  lesiones/recuperación.
- **Implementado, con datos ficticios donde falta cobertura real**: 36
  clubes/equipos reales (ACB + Primera FEB), jugadores reales con
  `padRosterToMinimum()` completando huecos con `dataSource:
  'fictional-fallback'` marcado en interfaz.
- **Implementado (SAVE-LOAD-1)**: guardado y carga reales de una carrera
  vía IndexedDB — 3 ranuras manuales + autoguardado, formato versionado
  (`basket-manager-career-save`, schemaVersion 1), hidratación en dos
  fases con validación completa (fingerprint/schema/content packs/
  integridad de registries) antes de sustituir la carrera activa. Ver
  `docs/architecture/persistence-boundary.md` y `docs/epics/SAVE-LOAD-1.md`.
- **Implementado (SIM-CAL-1)**: "Continuar" ya no es una operación
  síncrona/bloqueante en el navegador — `WorldAdvanceRunner` reparte el
  MISMO algoritmo de `WorldCalendarCoordinator` en slices cooperativos,
  con overlay de progreso real, cancelación segura (para en el siguiente
  límite cronológico seguro, nunca a mitad de un grupo) y protección
  contra clicks duplicados. `advanceUntilNextUserStop()` síncrona se
  mantiene sin cambios para scripts/Node. Ver
  `docs/architecture/simulation-advance.md` y `docs/epics/SIM-CAL-1.md`.
- **Implementado (SQUAD-BUDGET-1)**: presupuesto salarial de plantilla
  canónico y durable por `clubId+seasonKey+currency`
  (`SquadBudgetRegistry`/`SquadBudgetService`), congelado por temporada y
  revisable solo de forma explícita/auditable. Mercado
  (`MarketService.computeSquadCostPlan()`) y ciclo anual/planificación CPU
  (`AnnualCycleService.freezeSnapshot()`/`CpuRosterPlanner.
  computeCycleBudget()`) consumen ya el mismo límite canónico en vez de
  fórmulas independientes; una oferta multi-temporada se bloquea
  ATÓMICAMENTE con detalle estructurado de déficit cuando excede el
  disponible. Pantalla **Finanzas** nueva, solo lectura. Persistencia:
  colección durable `squadBudget`, `schemaVersion` 1→2 con migración real.
  Ver `docs/architecture/squad-budget.md` y `docs/epics/SQUAD-BUDGET-1.md`.
- **Implementado (ECONOMY-BOARD-1)**: economía real SIMULADA del club
  (plan financiero anual, tesorería derivada de un ledger de postings,
  calendario de cobros/pagos, impagos durables con reintento automático,
  proyección a 3 temporadas, capacidad financiera dura), manager humano
  con empleo/antigüedad y junta con confianza dinámica (3 dimensiones +
  estilo fiscal simulado por club), y peticiones jugables de ampliación
  de presupuesto salarial (desde Finanzas o desde una oferta de mercado
  bloqueada, resueltas por el calendario mundial 1-3 días después con
  aprobación total/parcial/rechazo deterministas). Nuevas pantallas
  Directiva y Finanzas ampliada. Persistencia: `schemaVersion` 2→3 con
  migración real de v1/v2. Ver `docs/architecture/club-finance.md`,
  `docs/architecture/board-budget-requests.md` y
  `docs/epics/ECONOMY-BOARD-1.md` — pendiente explícito: modo presidente/
  propietario jugable, inyecciones de capital/deuda, sanciones por
  impago, ticket pricing/patrocinio negociable y presupuesto de
  operaciones/traspasos separado del salarial.
- **Diseñado pero NO implementado**: competición europea real, Supercopa,
  transfer internacional/Letter of Clearance (EUROPE-1, sin fecha),
  cuerpo técnico como entidad propia, categorías inferiores reales/club
  filial.

## Últimas entregas relevantes

ECONOMY-BOARD-1 (economía real del club + manager/junta + peticiones de
ampliación de presupuesto) → SQUAD-BUDGET-1 (presupuesto salarial de
plantilla) → SIM-CAL-1 (avance
cooperativo y cancelable de "Continuar") → SAVE-LOAD-1
(persistencia real de partidas) → REPO-HARDEN-1 (saneamiento
técnico) → WORLD-CLEANUP-1 (retirada final de `Team.division`/
proyecciones legacy) → WORLD-CONTEXT-1 (contexto competitivo explícito) →
WORLD-HARDEN-1 parcial → WORLD-UI-1 → NATIONAL-TEAMS-1 → WORLD-SIM-1 →
PATHWAYS-1 → WORLD-CALENDAR-1 → COMP-CORE-1 → CLUB-CORE-1 → WORLD-CORE-1.
Detalle completo en `docs/epics/`.

## Limitaciones activas (deuda conocida, no oculta)

1. **Persistencia real de partidas: implementada, checklist manual
   pendiente.** SAVE-LOAD-1 entregó guardado/carga reales (ver arriba);
   la única deuda activa es que **ninguna sesión de Claude Code ha
   ejecutado el checklist manual en navegador real**
   (`docs/manual/SAVE_LOAD_ACCEPTANCE.md`, pendiente de Dennis), y que
   `transfers`/`loans`/`annualCycle`/`academy`/`nationalTeams` en el
   round-trip de guardado solo están verificados por analogía de patrón
   (mismo `exportState()`/`restoreState()` que contratos/inscripciones/
   mercado, ya probados), no con datos reales de esos dominios en el
   fixture de `scripts/test-save-load1.js`.
2. **Avance cooperativo de "Continuar": implementado, checklist manual
   pendiente.** SIM-CAL-1 entregó el driver cooperativo/cancelable (ver
   arriba); la única deuda activa es que ninguna sesión de Claude Code ha
   ejecutado el checklist manual en navegador real
   (`docs/manual/SIM_CAL_ACCEPTANCE.md`, pendiente de Dennis).
3. **`FORMATION_QUOTA_INFEASIBLE` flaky sin resolver.** REPO-HARDEN-1 no
   pudo reproducirlo: la reproducción estaba bloqueada por un `TypeError`
   previo de `competitionIdFromLegacyDivision` en `smoke-reg1.js`/
   `smoke-loan1.js`. Diagnóstico acotado pero no cerrado — ver
   `docs/epics/REPO-HARDEN-1.md`.
4. **`scripts/verify-cycle1-playwright.js`** conserva
   `fastForwardSeasonToClose()` sin migrar: usa `state.division`,
   `getLeague(division)`, `getBrackets(division)`, `simulateNextRound`,
   `simulateBackgroundRound`, `drainBackgroundBrackets` — APIs retiradas
   de la ruta productiva desde WORLD-CALENDAR-1/WORLD-CLEANUP-1.
   Confirmado sin migrar en esta auditoría (2026-09-08); SIM-CAL-1 no lo ha
   tocado (fuera de su alcance explícito).
5. **Checklist manual de World Architecture pendiente de ejecución
   humana.** `docs/manual/WORLD_ARCHITECTURE_ACCEPTANCE.md` es documental
   — ninguna sesión de Claude Code la ha ejecutado en navegador/Playwright
   real; sigue pendiente de Dennis.
6. **`src/core/Calendar.js`** sigue en disco (≈20 scripts históricos lo
   `require()` directamente) pero su `<script>` ya NO se carga desde
   `index.html` desde REPO-HARDEN-1 — confirmado en esta auditoría
   (`index.html` línea 401, comentario explícito). Este punto ya estaba
   resuelto, no es una contradicción activa.
7. Cohorte interactivo excluye ligas/selecciones futuras `standard`/
   `abstract` de bootstrap español — correcto por diseño (WORLD-SIM-1),
   sin equipos de ese tipo instalados hoy.

## Contradicciones detectadas en la auditoría de DOCS-CONTEXT-1

Investigadas contra el código real el 2026-09-08 (no corregidas — esta
Epic es solo documental):

- **World Architecture "en curso"**: la antigua `DESIGN.md` §2 decía "en
  curso" pese a que `WORLD-CLEANUP-1` (10.21) registra el cierre
  estructural. **Resuelto en esta migración**: se declara cerrada
  estructuralmente arriba; el antecedente "en curso" queda como histórico
  en `docs/epics/WORLD-CLEANUP-1.md`.
- **Persistencia en `localStorage`**: la antigua `CLAUDE.md` la daba por
  existente "por ahora". **Confirmado como incorrecto** contra
  `src/ui/game.js` (comentario explícito: "no hay persistencia todavía") y
  `CareerPersistenceBoundary.js` (sonda, no guardado). Corregido en la
  sección 2 de `CLAUDE.md` y en `docs/architecture/persistence-boundary.md`.
- **Revelado por cuartos**: la antigua `CLAUDE.md` decía, sin matiz, que
  el motor calcula el partido entero y la interfaz revela por cuartos.
  **Confirmado parcialmente cierto**: solo aplica al modo `'replay'`
  (partidos de Copa/Playoff/Ascenso, `MatchEngine.simulateMatch()` +
  reveal de `quarterScores`). Los partidos de LIGA del usuario usan desde
  TAC-5 el motor pausable real (`createMatchState`/`advanceMatch`, modo
  `'live'`), que sí se detiene de verdad en cada cuarto/tiempo muerto —
  decisión de encaje señalada explícitamente en el propio código
  (`src/ui/game.js`, comentario sobre `playNextMatchWithLineup`). Matizado
  en `docs/design/game-ui-decisions.md`.
- **Agrupaciones por división / APIs retiradas**: código productivo
  (`src/core/*.js`, `src/ui/game.js`) confirmado limpio — las únicas
  coincidencias de `.division`/`competitionIdFromLegacyDivision` en `src/`
  son comentarios que PROHÍBEN el patrón, no usos reales. Los usos reales
  sobreviven solo en `scripts/*.js` históricos (fixtures/tests anteriores
  a WORLD-CLEANUP-1), exención ya documentada — no es código productivo.
- **`Calendar.js`**: ver limitación 5 arriba — ya resuelto, no
  contradictorio.
- **`FORMATION_QUOTA_INFEASIBLE`**: ver limitación 2 — confirmado sin
  corregir.
- **`verify-cycle1-playwright.js`**: ver limitación 3 — confirmado sin
  migrar.
- **Checklist manual World Architecture**: ver limitación 4 — confirmado
  pendiente.

## Comprobaciones humanas pendientes

- Checklist manual completa de `docs/manual/ECONOMY_BOARD_ACCEPTANCE.md`
  (ECONOMY-BOARD-1, navegador real, Dennis) — pantallas Finanzas/Directiva,
  petición de ampliación desde Finanzas y desde Mercado bloqueado, impago/
  liquidación visibles como noticia, cierre de temporada rueda el
  horizonte financiero, guardado/carga v3 y migración de un guardado
  anterior, anchura móvil.
- Checklist manual completa de `docs/manual/WORLD_ARCHITECTURE_ACCEPTANCE.md`
  (navegador real, Dennis).
- Checklist manual completa de `docs/manual/SAVE_LOAD_ACCEPTANCE.md`
  (SAVE-LOAD-1, navegador real, Dennis) — guardar/cargar/sobrescribir/
  eliminar, "Continuar", anchura móvil.
- Checklist manual completa de `docs/manual/SIM_CAL_ACCEPTANCE.md`
  (SIM-CAL-1, navegador real, Dennis) — overlay, cancelación, reanudación
  sin duplicados, gating de mercado/alineación, guardado bloqueado durante
  el avance, anchura móvil.
- Checklist manual completa de `docs/manual/SQUAD_BUDGET_ACCEPTANCE.md`
  (SQUAD-BUDGET-1, navegador real, Dennis) — pantalla Finanzas, bloqueo de
  oferta por presupuesto, reparto de cesión, apertura de temporada nueva,
  guardado/carga, anchura móvil.
- Cualquier verificación con Playwright/smokes/auditoría de temporadas —
  no se ejecutó ninguna en SIM-CAL-1/SAVE-LOAD-1/DOCS-CONTEXT-1 (fuera de
  alcance explícito de las tres).

## Enlaces al detalle

`docs/EPIC_CONTEXT.md` (tarea activa) · `docs/ROADMAP.md` (pendientes) ·
`docs/epics/README.md` (historial completo) · `docs/architecture/`
(contratos vigentes) · `docs/reference/LEGACY_MAP.md` (referencias
antiguas).
