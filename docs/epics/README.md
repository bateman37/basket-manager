# Epics — índice e histórico

Cada Epic tiene una ficha propia en este directorio. El histórico describe
lo que ocurrió entonces — el estado vigente vive en `docs/STATUS.md` y en
los documentos de `docs/design/`/`docs/architecture/` que cada ficha
enlaza. No leas todas las fichas por rutina: usa la tabla para ir
directamente a la que necesitas.

## Índice cronológico

| Fecha | Epic | Ficha | Documento canónico vigente |
|---|---|---|---|
| 2026-08-14/19 | (sin Epic) | `docs/history/2026-08-foundation.md` | varios `docs/design/` |
| 2026-08-20/21 | `TACTICS-EPIC` (TAC-1 a TAC-7) | `docs/epics/TACTICS-EPIC.md` | `docs/design/tactics/README.md` |
| 2026-08-21 | `POS` (mini-EPIC) | `docs/epics/POS.md` | `docs/design/players-attributes.md` |
| 2026-08-22 | `TOOLTIP-1` | `docs/epics/TOOLTIP-1.md` | `docs/design/tactics/roadmap.md` |
| 2026-08-22 | `CAL-1-CAL-2` | `docs/epics/CAL-1-CAL-2.md` | `docs/design/competitions-spain.md`, `docs/design/events-agenda-news.md` |
| 2026-08-23 | `LIFE-2` | `docs/epics/LIFE-2.md` | `docs/design/training.md` |
| 2026-08-24 | `LIFE-3` | `docs/epics/LIFE-3.md` | `docs/design/injuries-recovery.md` |
| 2026-08-24 | `LIFE-4` | `docs/epics/LIFE-4.md` | `docs/design/career-history.md` |
| 2026-08-24 | `ROSTER-1` | `docs/epics/ROSTER-1.md` | `docs/design/roster-registry.md` |
| 2026-08-26 | `CONTRACT-1` | `docs/epics/CONTRACT-1.md` | `docs/design/contracts.md` |
| 2026-08-26 | `REG-1` | `docs/epics/REG-1.md` | `docs/design/registration-eligibility.md` |
| 2026-08-26 | `MARKET-1` | `docs/epics/MARKET-1.md` | `docs/design/market.md` |
| 2026-08-27 | `TRANSFER-1` | `docs/epics/TRANSFER-1.md` | `docs/design/transfers.md` |
| 2026-08-27 | `LOAN-1` | `docs/epics/LOAN-1.md` | `docs/design/loans.md` |
| 2026-08-28 | `CYCLE-1` | `docs/epics/CYCLE-1.md` | `docs/design/annual-cycle.md` |
| 2026-08-31 | `WORLD-CORE-1` | `docs/epics/WORLD-CORE-1.md` | `docs/architecture/world-model.md` |
| 2026-09-05 | `CLUB-CORE-1` | `docs/epics/CLUB-CORE-1.md` | `docs/architecture/club-team-squad.md` |
| 2026-09-06 | `COMP-CORE-1` | `docs/epics/COMP-CORE-1.md` | `docs/architecture/competition-engine.md` |
| 2026-09-06 | `WORLD-CALENDAR-1` | `docs/epics/WORLD-CALENDAR-1.md` | `docs/architecture/world-calendar.md` |
| 2026-09-06 | `PATHWAYS-1` | `docs/epics/PATHWAYS-1.md` | `docs/architecture/pathways.md` |
| 2026-09-06 | `WORLD-SIM-1` | `docs/epics/WORLD-SIM-1.md` | `docs/architecture/simulation-levels.md` |
| 2026-09-07 | `NATIONAL-TEAMS-1` | `docs/epics/NATIONAL-TEAMS-1.md` | `docs/architecture/national-teams.md` |
| 2026-09-07 | `WORLD-UI-1` | `docs/epics/WORLD-UI-1.md` | `docs/architecture/career-setup-and-navigation.md` |
| 2026-09-07 | `WORLD-HARDEN-1` | `docs/epics/WORLD-HARDEN-1.md` | `docs/architecture/persistence-boundary.md` |
| 2026-09-07 | `WORLD-CONTEXT-1` | `docs/epics/WORLD-CONTEXT-1.md` | `docs/architecture/competitive-context-identity.md` |
| 2026-09-07 | `WORLD-CLEANUP-1` | `docs/epics/WORLD-CLEANUP-1.md` | `docs/architecture/competitive-context-identity.md` |
| 2026-09-08 | `REPO-HARDEN-1` | `docs/epics/REPO-HARDEN-1.md` | `docs/STATUS.md` |
| 2026-09-08 | `DOCS-CONTEXT-1` | `docs/epics/DOCS-CONTEXT-1.md` | este mismo directorio |

Sesiones sin Epic identificable (agosto 2026, construcción del motor
antes de que se adoptara la convención de nombrar cada entrega) están en
`docs/history/2026-08-foundation.md`, no en `docs/epics/`.

## Plantilla para una ficha de Epic nueva

Copia esta estructura al crear `docs/epics/<ID>.md` para una Epic nueva:

```markdown
# Ficha de Epic — <ID> (<título corto>)

- **Identificador**: `<ID>`
- **Estado**: activa | cerrada | pausada
- **Objetivo**: <una frase>
- **Alcance y exclusiones**: <qué toca y qué explícitamente no>
- **Archivos permitidos**: <lista o "sin restricción especial">
- **Dependencias**: <Epics/decisiones previas que asume>
- **Decisiones cerradas**: <lista, con fecha si aplica>
- **Preguntas abiertas**: <lista, o "ninguna">
- **Documentos canónicos**: <docs/design/... y/o docs/architecture/...>
- **Pruebas mínimas**: <scripts/comandos exigidos antes de cerrar>
- **Criterios de aceptación**: <lista>

## Resultado (al cerrar)

- **Qué se implementó**: ...
- **Pruebas realmente ejecutadas**: ... (nunca marques como ejecutado algo
  que solo se trasladó de otro sitio)
- **Deuda aplazada**: ...
```

Para una Epic histórica que se documenta después de los hechos, no
inventes retroactivamente "archivos permitidos" — registra solo los
archivos que puedas acreditar (por ejemplo, en su propia sección
"Archivos nuevos/modificados" ya migrada del `CHANGELOG.md` original).
