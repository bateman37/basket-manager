# WORLD-CORE-1 — checkpoint de progreso

- HEAD base: `46f822e` (origin/main, incluye PR #45 CYCLE-1 + commit posterior
  `950a50d`). El prompt asumía `c810647`; se usa el HEAD real más nuevo.
- Rama: `feat/world-core-1`.

## Checklist de fases

1. [ ] Modelo mundial, entidades y registros (Geography, Organization, Club,
   Competition, WorldRegistry, ContentPackRegistry, CompetitionCatalog).
2. [ ] Paquetes `world-core-2026.1` y `spain-2026.1`, migración de identidad
   de competición (CompetitionRules delega en CompetitionCatalog),
   `SpainLegacyCompetitionRuntime`.
3. [ ] Integración en `game.js`/`index.html` (arranque de carrera, cierre de
   temporada, brackets, Team.js con clubId/teamType/homeAreaId/legacyDivision,
   Calendar.js sin fallback).
4. [ ] Pruebas reducidas (`test-world-core1.js`, `smoke-world-core1.js`,
   regresión `test-cycle1.js`), documentación (DESIGN.md/CLAUDE.md/
   CHANGELOG.md), PR.

## Último commit completado
(ninguno todavía — trabajo en curso, sin commit)

## Archivos tocados hasta ahora
(ninguno todavía)

## Siguiente acción exacta
Crear `src/entities/Geography.js`, `src/entities/Organization.js`,
`src/entities/Club.js`, `src/entities/Competition.js`.

## Prueba más reciente y resultado
Ninguna ejecutada todavía en esta sesión.

## Bloqueadores
Ninguno.
