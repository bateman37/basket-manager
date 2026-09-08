# Sistema táctico — índice

Diseño del sistema táctico (`DESIGN.md` §7.12 original), dividido por
concepto para permitir lectura independiente. Mapa de código:
`docs/code/tactics.md` (`src/core/Tactics.js`).

| Documento | Contenido |
|---|---|
| `docs/design/tactics/fundamentals.md` | Capas del sistema, entidades conceptuales, orden de resolución de una posesión, `AdvantageState`, calidad de tiro y asistencia (§7.12.1-7.12.5) |
| `docs/design/tactics/offense.md` | Spacing, identidad ofensiva, play types, roles ofensivos, playbook, continuidad/counters, transición (§7.12.6-7.12.12) |
| `docs/design/tactics/defense.md` | Capas defensivas, shell/base scheme, pickup/pressing, cobertura de Pick&Roll, reglas on/off-ball, defensa de poste, transición defensiva, roles defensivos (§7.12.13-7.12.21) |
| `docs/design/tactics/live-game.md` | Familiaridad/`tacticalExecution`, plan de partido y scouting, ajustes en vivo, ATO/BLOB/SLOB, falta táctica, visión futura TAC-5 (§7.12.22-7.12.24-bis) |
| `docs/design/tactics/cpu-ai.md` | IA táctica de equipos CPU: identidad, plan de partido, ajustes en vivo, tendencies de jugador (§7.12.25-7.12.26) |
| `docs/design/tactics/analytics.md` | Data Hub táctico, valoraciones de quinteto, forma de los datos, integración con el motor, balance/calibración, interfaz táctica (§7.12.27-7.12.32) |
| `docs/design/tactics/roadmap.md` | Orden de implementación TAC-1 a TAC-7, pendientes deliberados, fuentes/criterio de diseño, ayuda táctica contextual (§7.12.33-7.12.36) |

Historial de implementación (TAC-1 a TAC-7): `docs/epics/TACTICS-EPIC.md`.
Ayuda contextual en pantalla: `docs/design/tactics/roadmap.md` §7.12.36 +
`docs/epics/TOOLTIP-1.md`.
