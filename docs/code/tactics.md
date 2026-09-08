# Mapa de código — `src/core/Tactics.js`

Mapa de navegación, no una copia del código (3 063 líneas). Diseño
relacionado completo: `docs/design/tactics/` (fundamentals, offense,
defense, live-game, cpu-ai, analytics, roadmap).

```bash
rg -n "^  function " src/core/Tactics.js
```

## Tabla de responsabilidades

| Responsabilidad | Símbolo | Colaboradores | Diseño relacionado |
|---|---|---|---|
| Plan de posesión ofensivo/defensivo | `buildPossessionPlan()`, `buildDefensivePlan()` | `TacticalProfile`, `GamePlan`, `MatchEngine` (bucle de posesión) | `docs/design/tactics/fundamentals.md` |
| Ventaja/calidad de tiro de la posesión | `computeAdvantageScore(params)`, `resolveRead()` | `AdvantageState` | `docs/design/tactics/fundamentals.md` §7.12.4-5 |
| Pick & Roll / DHO | `resolvePnrFrequency()`, `planPnrPossession()`, `pickRollFinishType()` | `screenerWeight()`, `resolveMatchupOverride()` | `docs/design/tactics/offense.md`, `docs/design/tactics/defense.md` §7.12.16 |
| Spacing efectivo | `effectiveSpacing(spacing, five, config)` | mezcla de tiro exterior del quinteto | `docs/design/tactics/offense.md` §7.12.6 |
| Roles ofensivos/defensivos y su ajuste | `roleFit(player, roleId, config)`, `findRoleDefinition()`, `bestRolesForPlayer()` | catálogos `OFFENSIVE_ROLES`/`DEFENSIVE_ROLES` | `docs/design/tactics/offense.md` §7.12.9, `docs/design/tactics/defense.md` §7.12.21 |
| Familiaridad táctica y `tacticalExecution` | (ver `effectiveTacticalProfile()`, `applyGamePlanToProfile()`) | `Training.js` (TAC-6) | `docs/design/tactics/live-game.md` §7.12.22 |
| Telemetría / Data Hub táctico | `buildTacticsTelemetryAggregate()`, `cloneLineupGroup()`, `summarizeTacticsTelemetry()` | `config.tactics.telemetry.minReliablePossessions` | `docs/design/tactics/analytics.md` |
| Ayuda táctica contextual (tooltips) | (ver `src/ui/TacticsHelp.js`, archivo aparte — 97 entradas, `CATEGORY_ORDER`) | `TACTICS_TABS`, `renderTacticsGlossaryTab` | `docs/design/tactics/roadmap.md` §7.12.36 |

## Notas de auditoría (comentarios históricos vs. comportamiento actual)

- No copies como estado vigente los comentarios de una implementación
  inicial de TAC-1/TAC-2 sin comprobar la función real — varias piezas
  (roleFit, spacing, PnR) se ampliaron en TAC-3/TAC-4/TAC-6 con
  "pendientes deliberados" propios; el estado exacto de cada uno vive en
  `docs/design/tactics/roadmap.md` (§7.12.34), no en el propio archivo.
- `computeAdvantageScore`/`effectiveSpacing` son puros — no consultan
  `state` ni el DOM; toda dependencia les llega por parámetro.

## Ejemplos de búsqueda útiles

```bash
rg -n "OFFENSIVE_ROLES|DEFENSIVE_ROLES" src/core/Tactics.js
rg -n "function .*[Tt]elemetry" src/core/Tactics.js
rg -n "TacticsHelp" src/ui/
```
