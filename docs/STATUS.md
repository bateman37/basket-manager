# STATUS — Estado actual del proyecto

Fotografía del presente, no un resumen de sesiones. Fecha y commit
contrastados: **2026-09-08**, `origin/main` en `83b85d1` (PR #57,
`REPO-HARDEN-1`, fusionada). Si `origin/main` ha avanzado desde entonces,
esta foto puede estar desactualizada — compruébalo antes de asumirla.

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
- **Diseñado pero NO implementado**: competición europea real, Supercopa,
  transfer internacional/Letter of Clearance (EUROPE-1, sin fecha),
  cuerpo técnico como entidad propia, categorías inferiores reales/club
  filial, persistencia real de partidas.

## Últimas entregas relevantes

REPO-HARDEN-1 (saneamiento técnico) → WORLD-CLEANUP-1 (retirada final de
`Team.division`/proyecciones legacy) → WORLD-CONTEXT-1 (contexto
competitivo explícito) → WORLD-HARDEN-1 parcial → WORLD-UI-1 →
NATIONAL-TEAMS-1 → WORLD-SIM-1 → PATHWAYS-1 → WORLD-CALENDAR-1 →
COMP-CORE-1 → CLUB-CORE-1 → WORLD-CORE-1. Detalle completo en
`docs/epics/`.

## Limitaciones activas (deuda conocida, no oculta)

1. **Persistencia real de partidas: no implementada.** `localStorage` NO
   se usa en producción pese a lo que decía la documentación antigua;
   `CareerPersistenceBoundary.js` es una sonda de qué sería durable, no
   un guardado real (`saveCareer`/`loadCareer` no existen). Ver
   `docs/architecture/persistence-boundary.md` y `docs/ROADMAP.md`.
2. **`FORMATION_QUOTA_INFEASIBLE` flaky sin resolver.** REPO-HARDEN-1 no
   pudo reproducirlo: la reproducción estaba bloqueada por un `TypeError`
   previo de `competitionIdFromLegacyDivision` en `smoke-reg1.js`/
   `smoke-loan1.js`. Diagnóstico acotado pero no cerrado — ver
   `docs/epics/REPO-HARDEN-1.md`.
3. **`scripts/verify-cycle1-playwright.js`** conserva
   `fastForwardSeasonToClose()` sin migrar: usa `state.division`,
   `getLeague(division)`, `getBrackets(division)`, `simulateNextRound`,
   `simulateBackgroundRound`, `drainBackgroundBrackets` — APIs retiradas
   de la ruta productiva desde WORLD-CALENDAR-1/WORLD-CLEANUP-1.
   Confirmado sin migrar en esta auditoría (2026-09-08).
4. **Checklist manual de World Architecture pendiente de ejecución
   humana.** `docs/manual/WORLD_ARCHITECTURE_ACCEPTANCE.md` es documental
   — ninguna sesión de Claude Code la ha ejecutado en navegador/Playwright
   real; sigue pendiente de Dennis.
5. **`src/core/Calendar.js`** sigue en disco (≈20 scripts históricos lo
   `require()` directamente) pero su `<script>` ya NO se carga desde
   `index.html` desde REPO-HARDEN-1 — confirmado en esta auditoría
   (`index.html` línea 401, comentario explícito). Este punto ya estaba
   resuelto, no es una contradicción activa.
6. Cohorte interactivo excluye ligas/selecciones futuras `standard`/
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

- Checklist manual completa de `docs/manual/WORLD_ARCHITECTURE_ACCEPTANCE.md`
  (navegador real, Dennis).
- Cualquier verificación con Playwright/smokes/auditoría de temporadas —
  no se ejecutó ninguna en esta Epic documental (fuera de alcance,
  DOCS-CONTEXT-1 es solo documentación).

## Enlaces al detalle

`docs/EPIC_CONTEXT.md` (tarea activa) · `docs/ROADMAP.md` (pendientes) ·
`docs/epics/README.md` (historial completo) · `docs/architecture/`
(contratos vigentes) · `docs/reference/LEGACY_MAP.md` (referencias
antiguas).
