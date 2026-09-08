# Ficha de Epic — WORLD-CORE-1 (mundo canónico y España como paquete de contenido)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `WORLD-CORE-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Mundo canónico genérico y España como primer paquete de contenido.
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/world-model.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 1814-1954 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-31 — WORLD-CORE-1: mundo canónico y España como paquete de contenido (DESIGN.md sección 10)

Primera entrega de la nueva EPIC **World Architecture** (9 partes:
**WORLD-CORE-1** → CLUB-CORE-1 → COMP-CORE-1 → WORLD-CALENDAR-1 →
PATHWAYS-1 → WORLD-SIM-1 → NATIONAL-TEAMS-1 → WORLD-UI-1 →
WORLD-HARDEN-1). Base: `46f822e` (`origin/main`, PR #45 CYCLE-1 fusionada +
un commit posterior de housekeeping) — más nueva que la base `c810647`
asumida al redactar el prompt; se usó el HEAD real sin descartar trabajo
remoto. **Decisión de arquitectura**: España deja de ser el mundo del motor
y pasa a ser el primer paquete de contenido (`spain-2026.1`) instalado
sobre un `GameWorld` genérico. Esto **sustituye el plan anterior** de la
EPIC "Ciclo profesional de plantilla" (9.16), que situaba `EUROPE-1`/
`HARDEN-1` justo después de CYCLE-1 — quedan REDEFINIDAS como entregas
posteriores de World Architecture; el histórico de CYCLE-1 en 9.16/9.22 y
en este mismo archivo no se reescribe, sigue siendo correcto en su
contexto (ver DESIGN.md 10.9, "plan superado").

### Diagnóstico ARCH-WORLD-01..08

| Punto | Diagnóstico | Estado |
|---|---|---|
| ARCH-WORLD-01 | `Team.js` solo acepta `1ª`/`2ª` | Aislado por adaptador — `division` sigue existiendo como alias legacy (`legacyDivision`), nunca por defecto sin dato |
| ARCH-WORLD-02 | `state.leagues`/`state.brackets`/`state.division` como mapa español fijo | Aislado por adaptador (`SpainLegacyCompetitionRuntime`) — retirada en COMP-CORE-1/WORLD-CALENDAR-1 |
| ARCH-WORLD-03 | `Calendar.getScheduleProfile()` con fallback silencioso a `1ª` | **Corregido** — lanza explícito ante un `scheduleProfileId` desconocido |
| ARCH-WORLD-04 | Identidad de competición mezclada dentro de `CompetitionRules.js` | **Corregido** — extraída a `CompetitionCatalog.js`, `CompetitionRules.js` reexporta por referencia |
| ARCH-WORLD-05 | Copa/playoffs no eran entidades canónicas | **Corregido** — `CompetitionDefinition`/`Edition`/`Stage`/`Entry` reales, Copa como competición separada y playoffs como stage de Liga |
| ARCH-WORLD-06 | Pertenencia deportiva expresada por `Team.division` | Aislado — `CompetitionEntry` ya es la fuente real para ACB/Primera FEB/Copa/playoffs; `Team.division` queda como espejo legacy |
| ARCH-WORLD-07 | Club y equipo confundidos en `Team` | Aislado — `Club` nuevo con vínculo `team.clubId`; migración completa de finanzas/instalaciones es CLUB-CORE-1 |
| ARCH-WORLD-08 | "Exterior" no es un mundo (`external-abstract`) | Asignado a WORLD-SIM-1 — documentado como nivel de simulación transitorio, no tipo de club |

### Entidades, registros y paquetes nuevos

`GeographicArea`/`Organization`/`Club`/`CompetitionDefinition`/
`CompetitionEdition`/`CompetitionStage`/`CompetitionEntry`/`GameWorld`
(`src/entities/`), `WorldRegistries` (siete registros por carrera +
`ContentPackRegistry`, `src/core/WorldRegistry.js`/
`src/core/ContentPackRegistry.js`), `WorldFactory` (construcción +
instalación atómica de paquetes), `CompetitionCatalog.js` (catálogo
canónico ACB/Primera FEB/Copa ACB/Supercopa ACB `catalog-only`/perfil de
test — `CompetitionRules.js` ya no mantiene su propia tabla, la importa),
`SpainLegacyCompetitionRuntime.js` (adaptador aislado, con destino de
eliminación en COMP-CORE-1/WORLD-CALENDAR-1). Paquetes:
`data/world/world-core-2026.1.js` (raíz Mundo + continente Europa) y
`data/world/spain-2026.1.js` (España + Andorra, FEB/ACB, los 36 clubes/
equipos reales REUTILIZANDO las instancias ya construidas, referencias a
las `CompetitionDefinition` del catálogo, edición/stage/entries de
temporada regular vía `SpainLegacyCompetitionRuntime`).

### Migración de España y MoraBanc

`startSeason()` construye los 36 equipos exactamente igual que antes,
crea `GameWorld` e instala `world-core-2026.1` + `spain-2026.1` con esas
MISMAS instancias, enlaza cada `League` real con su
`CompetitionEdition`/`Stage` (`bindLeagueRuntime`), y adjunta por identidad
los siete registros de dominio de ROSTER-1..CYCLE-1 a
`state.world.domainRegistries`. `createBracketsIfDue()` enlaza Copa/
Playoff por el título/Playoff de ascenso con sus stages reales en el
instante en que el runtime los crea de verdad. `closeSeasonAndPrepareNext()`
cierra las ediciones de la temporada que termina (`status: 'completed'`,
nunca se borran) y abre las de la siguiente sobre el MISMO mundo — nunca
lo reconstruye. **MoraBanc Andorra** sigue siendo el test transfronterizo
obligatorio: `homeAreaId`/`employerJurisdictionAreaId` en Andorra, ACB como
participación deportiva vía `CompetitionEntry` — verificado en el smoke
(desciende de verdad en la temporada simulada, sin perder su jurisdicción).

### Compatibilidad conservada

`Team.js` gana `clubId`/`teamType`/`homeAreaId`/`legacyDivision`
(opcionales, retrocompatibles); `division` se sigue leyendo donde ya se
leía. `League`/`Bracket`/`Cup`/`Playoffs`/`Promotion` sin tocar. La
selección de equipo sigue mostrando ACB/Primera FEB (únicas ediciones
jugables instaladas); Home/Competiciones/Agenda/Noticias/Plantilla/Mercado
no pierden ninguna función. Un bloque `<details>` plegado y discreto en
Home ("Mundo de la carrera") muestra paquetes instalados y la jerarquía
Mundo › Europa › España/Andorra — solo lectura.

### Deuda aislada para entregas posteriores

`SpainLegacyCompetitionRuntime`/`League`-`Bracket`-`Cup`-`Playoffs`-
`Promotion` como runner fijo → COMP-CORE-1. Calendario por
`scheduleProfileId` de contenido español y `state.leagues`/`state.brackets`
como mapa fijo → WORLD-CALENDAR-1. `Club.id === primaryTeam.id` y
finanzas/instalaciones/junta/afición todavía en `Team` → CLUB-CORE-1.
`external-abstract` como categoría de `WorldLifecycleService` →
WORLD-SIM-1. Navegador mundial completo → WORLD-UI-1. Transfer
internacional/Letter of Clearance, competiciones europeas y persistencia
real: replanteadas como entregas de World Architecture (ver DESIGN.md
10.1/10.9), no ejecutadas en esta entrega.

### Pruebas reducidas ejecutadas y resultados reales

- `node scripts/test-world-core1.js`: **27 comprobaciones, 0 fallos**
  (jerarquía geográfica/organizaciones, dependencias/atomicidad/orden de
  paquetes, mundo sin España vía un fixture de test, Definition/Edition/
  Stage/Entry, múltiples competiciones por equipo, sin fallback de
  calendario, MoraBanc transfronterizo, identidad canónica y aliases,
  auditoría estática de literales españoles en los 8 archivos mundiales
  genéricos).
- `node scripts/smoke-world-core1.js`: 36 equipos reales, **1 temporada
  completa** (Liga + Copa + Playoff por el título + Playoff de ascenso) +
  **1 transición anual completa** reutilizando `scripts/cycle1-harness.js`
  — mundo/geografía/organizaciones/clubes/equipos/428 jugadores
  verificados, evidencia de último partido oficial resuelta contra
  edition/stage canónicos, MoraBanc Andorra desciende realmente en la
  ejecución registrada, integridad e identidad de instancias revalidadas
  tras la transición. OK en ~9-10s.
- Regresión (sin repetir la matriz completa): `node scripts/test-cycle1.js`
  (42 OK), `node scripts/test-roster1.js` (31 OK), `node
  scripts/test-contract1.js` (102 OK), `node --check` sobre todo el
  repositorio — **0 fallos en los cuatro**.
- Checklist manual (desktop/móvil, Playwright) diferida a Dennis al
  terminar la EPIC completa — no se afirma haber probado UI real.

### Archivos nuevos

`src/entities/Geography.js`, `src/entities/Organization.js`,
`src/entities/Club.js`, `src/entities/Competition.js`,
`src/entities/World.js`, `src/core/WorldRegistry.js`,
`src/core/ContentPackRegistry.js`, `src/core/WorldFactory.js`,
`src/core/CompetitionCatalog.js`, `src/core/SpainLegacyCompetitionRuntime.js`,
`data/world/world-core-2026.1.js`, `data/world/spain-2026.1.js`,
`scripts/test-world-core1.js`, `scripts/smoke-world-core1.js`.

### Archivos modificados

`src/entities/Team.js` (campos puente), `src/core/Calendar.js`
(`getScheduleProfile()` sin fallback), `src/core/CompetitionRules.js`
(identidad delegada en `CompetitionCatalog.js`), `src/ui/game.js`
(construcción/enlace del mundo en `startSeason()`/
`closeSeasonAndPrepareNext()`/`createBracketsIfDue()`, `getAllTeams()`
desde el World Registry, detalle técnico en Home), `index.html` (orden de
carga de los nuevos scripts), `DESIGN.md`, `CLAUDE.md`.

### Confirmaciones

**Sin SQL ni save/load** — no se ha implementado ninguna persistencia real.
**Sin ligas/competiciones nuevas jugables** — Supercopa ACB queda
`catalog-only` (identidad sin edición). **`data/real/*` sin cambios**
(confirmado con `git diff --stat`/`git status`). **PR preparada pero no
fusionada, sin auto-merge** — la fusión la hace Dennis.
