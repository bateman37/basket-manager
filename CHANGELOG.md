# CHANGELOG.md

Registro breve de sesiones recientes. El diario de implementación completo
(bugs, pruebas ejecutadas, archivos tocados) vive en la ficha de cada Epic
bajo `docs/epics/`, o en `docs/history/` para sesiones sin Epic
identificable. A partir de esta migración, una entrada nueva es un resumen
corto con enlace al detalle — no un informe completo pegado aquí.

## 2026-09-08 — `SAVE-LOAD-1`: guardado y carga reales de una carrera

Primera persistencia real de partidas: IndexedDB (3 ranuras manuales +
autoguardado), formato de guardado versionado, hidratación en dos fases
con validación completa (fingerprint/schema/content packs/integridad)
antes de sustituir la carrera activa, autoguardado en 3 checkpoints
seguros, y una pantalla "Partida" (+ "Continuar"/"Cargar partida" en la
landing). `CareerPersistenceBoundary.js` deja de ser una sonda y pasa a
ser el proyector canónico real. Detalle completo:
`docs/epics/SAVE-LOAD-1.md`. Checklist manual pendiente de Dennis:
`docs/manual/SAVE_LOAD_ACCEPTANCE.md`.

## 2026-09-08 — `DOCS-CONTEXT-1`: reorganización documental

Reorganiza `CLAUDE.md`/`DESIGN.md`/`CHANGELOG.md` (crecidos a monolitos
de ~1655/10696/7907 líneas) en el árbol documental `docs/`, sin tocar
código productivo. Detalle completo: `docs/epics/DOCS-CONTEXT-1.md`.
Mapa de referencias antiguas: `docs/reference/LEGACY_MAP.md`.

## 2026-09-08 — `REPO-HARDEN-1`: saneamiento técnico posterior a WORLD-CLEANUP-1

Migra scripts de prueba/Playwright a los contratos retirados de la ruta
productiva, retira el `<script>` de `Calendar.js` de `index.html`, y deja
constancia del `FORMATION_QUOTA_INFEASIBLE` flaky sin reproducir. Detalle
completo: `docs/epics/REPO-HARDEN-1.md`.

## 2026-09-07/09-08 — Cierre estructural de World Architecture

`WORLD-CLEANUP-1` (retirada final de `Team.division`/proyecciones legacy)
y `WORLD-CONTEXT-1` (contexto competitivo explícito e identidades
canónicas Club/Team) cierran las nueve entregas de la EPIC "World
Architecture" iniciada en `WORLD-CORE-1`. Detalle:
`docs/epics/WORLD-CLEANUP-1.md`, `docs/epics/WORLD-CONTEXT-1.md`, y el
resto de fichas `docs/epics/WORLD-*.md` para las siete entregas
anteriores (CLUB-CORE-1, COMP-CORE-1, WORLD-CALENDAR-1, PATHWAYS-1,
WORLD-SIM-1, NATIONAL-TEAMS-1, WORLD-UI-1, WORLD-HARDEN-1).

## Historial anterior

Todas las entregas anteriores a esta migración (World Architecture
completa, el ciclo profesional de plantilla ROSTER-1 → CYCLE-1, el
sistema táctico TAC-1 → TAC-7, LIFE-1 → LIFE-4, CAL-1/CAL-2, TOOLTIP-1,
mini-EPIC POS y la construcción inicial del motor) tienen su ficha
completa en `docs/epics/README.md` (índice cronológico) o, para las
sesiones sin Epic identificable de agosto de 2026, en
`docs/history/2026-08-foundation.md`.
