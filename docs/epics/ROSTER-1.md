# Ficha de Epic — ROSTER-1 (Player Registry y núcleo normativo multi-liga)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `ROSTER-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Player Registry mundial y núcleo normativo multi-liga.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/roster-registry.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 2863-3078 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-24 — ROSTER-1: registro mundial de jugadores y núcleo normativo multi-liga (DESIGN.md 9.16)

Primera entrega de la EPIC "Ciclo profesional de plantilla" (9 partes
planificadas, ver DESIGN.md 9.16: ROSTER-1 → CONTRACT-1 → REG-1 →
MARKET-1 → TRANSFER-1 → LOAN-1 → CYCLE-1 → EUROPE-1 → HARDEN-1). Esta
entrega estabiliza LIFE-4 y sienta las dos piezas de las que dependerá
todo lo demás: identidad mundial de jugadores y un núcleo de reglas
normativas independiente de qué liga sea.

### Bugs corregidos de LIFE-4 (PR #37)

- **BUG-LIFE4-01**: fechas de histórico mostradas como hora en vez de
  fecha completa — corregido con `formatHistoryDate()`.
- **BUG-LIFE4-02**: varios comentarios de código citaban "DESIGN.md 9.4"
  en vez de "9.15" (LIFE-4 quedó numerado 9.15, no 9.4) — auditados y
  corregidos todos los archivos tocados por LIFE-4 (`Events.js`,
  `MatchEngine.js`, `Rotation.js`, `Player.js`, `index.html`).
- **BUG-LIFE4-03**: `findPlayerById()` dependía de que el jugador
  siguiera en `Team.roster` — un jugador sin club se volvía ilocalizable.
  Corregido con el Player Registry (ver más abajo); la ficha universal
  ahora abre igual con o sin club.

### Player Registry — identidad mundial de jugadores (`src/core/PlayerRegistry.js`, nuevo)

Un `Player` pertenece al mundo de la partida, no a un array concreto.
`Team.roster` sigue siendo la afiliación deportiva ACTUAL de un club,
pero deja de ser el directorio mundial: quitar a un jugador de una
plantilla (todavía sin implementar, CONTRACT-1/MARKET-1/TRANSFER-1)
nunca debe destruirlo ni volverlo ilocalizable.

- Módulo puro (sin conocer `Player`/`Team` como clases) que indexa por
  `player.id` la MISMA instancia viva usada por los equipos. La partida
  posee una instancia EXPLÍCITA (`state.playerRegistry`, construida en
  `startSeason()`) — nunca un singleton global oculto. API:
  `register`/`registerMany`/`get`/`require`/`has`/`all`/`forTeam`/
  `setAffiliation`/`validateAgainstTeams`/`snapshot`. `forTeam()` es una
  vista DERIVADA de `all()`, nunca un segundo índice desincronizable.
  `snapshot()` es mínimo (solo id+teamId) — no es un sistema de guardado
  todavía (eso es HARDEN-1).
- Integración: `startSeason()` construye los 36 equipos (con el puente de
  cobertura de Primera FEB, ver más abajo) y registra el universo
  completo; `closeSeasonAndPrepareNext()` registra los newgens de
  `generateAcademyIntake()` inmediatamente al cerrar ciclo.
  `Team.addPlayer()`/`removePlayer()` NO sincronizan el registro por sí
  solos todavía (acoplaría la entidad a `game.js`) — la sincronización
  explícita (`registry.setAffiliation()`) queda para el futuro
  orquestador de fichajes de MARKET-1/TRANSFER-1.
- Invariantes verificados (`scripts/test-roster1.js`/`scripts/smoke-roster1.js`):
  cada jugador de cada plantilla aparece exactamente una vez en el
  registro; dos plantillas nunca comparten un id; `player.teamId`
  coincide siempre con el equipo real; un jugador sin club puede seguir
  en el registro con `teamId === null`; ascender/descender un club no
  recrea jugadores; el intake de cantera registra cada newgen sin
  colisionar; liberar y reincorporar a un jugador conserva la misma
  instancia y su `careerHistory`/`developmentState`/`medicalState`
  completos; un id duplicado con otra instancia se rechaza con error
  descriptivo. `data/real/` permanece inmutable — el registro se
  construye en memoria, nunca reescribiendo los JSON de origen.

### Núcleo normativo multi-liga (`src/core/CompetitionRules.js`, nuevo)

Hoy solo hay dos competiciones domésticas (ACB/Primera FEB, legacy
`1ª`/`2ª`) — eso es solo el punto de partida para un futuro con muchas
ligas/federaciones/países, algunas con reglas distintas e incluso varias
normativas aplicables al mismo club a la vez (EUROPE-1). Por eso:

- `1ª`/`2ª` NO vuelven a usarse como claves de lógica nueva (quedan como
  compatibilidad/presentación). Toda regla NUEVA usa `competitionId`
  (`acb`, `primera-feb`). `competitionIdFromLegacyDivision()` es el ÚNICO
  punto que traduce división → `competitionId` — lanza explícito ante una
  división desconocida, nunca asume ACB. Una competición o
  `bundleId`/versión inexistente también lanzan explícito — nunca heredan
  el comportamiento de ACB por defecto.
- **Capas**: `CompetitionDefinition` (identidad pura, sin reglas) →
  `RuleModule` (una pieza de normativa versionada: versión, temporada de
  vigencia, estado `verified`/`provisional`/`deprecated`, fuentes
  oficiales con URL, y qué partes quedan `notImplemented` explícitamente)
  → `RulesetBundle` (compone módulos de ámbitos distintos —
  `registration`/`employment`/`market`/`transfer`/
  `internationalTransfer`, cada uno `null` hasta que exista el módulo
  real).
- `resolveRules(context)`: punto de entrada único, recibe contexto
  EXPLÍCITO (`competitionId`, `seasonKey`, `date`, `operation`, `clubId`,
  `playerId`, `overlays`) — nunca lee `state`/globales. Devuelve
  `{bundleId, version, effectiveSeason, squadRules, capabilities,
  notImplemented, trace}`.
- **Capacidad ≠ comportamiento**: la UI consulta
  `resolved.capabilities.has(...)` para saber qué mostrar, pero la
  capacidad se DERIVA siempre de qué módulo está realmente presente —
  nunca una lista aparte que pueda divergir.
- **Composición por capas, nunca `Object.assign`/spread "el último
  gana"**: cada tipo de regla tiene su propia estrategia semántica
  (`MERGE_STRATEGIES` — mínimos concurrentes conservan el MAYOR, máximos
  concurrentes el MENOR). Mecanismo ya probado aunque ROSTER-1 no genera
  overlays todavía (llegan con EUROPE-1).
- **Trazabilidad**: `trace.{sourceRuleIds, bundleId, version}` en todo
  resultado. **Versionado temporal**: cada módulo/bundle tiene id
  estable + versión + temporada + fuentes + estado; sin `bundleId`
  explícito resuelve el de versión más alta para esa competición.
- Perfil ficticio de test (`bm-test-fictional-league`, límites 6-9)
  registrado en los mismos catálogos que ACB/FEB — demuestra que añadir
  una liga nueva es dato de catálogo, nunca una rama nueva en
  `Team.js`/`game.js`/UI.

### Primera vertical real: convocatoria por competición

`Team.buildMatchSquad(playerIds, minOverride, maxOverride)` ya NO decide
qué normativa aplicar — solo valida el rango recibido. `MATCH_SQUAD_MIN`/
`MATCH_SQUAD_MAX` (8/12) quedan como default LEGACY (modo prueba,
`buildMatchSquadExcludingPosition()`), nunca fuente para producción
multi-liga. `CpuLineup.buildCpuLineup()` recibe un 5º parámetro opcional
`squadRules` — la CPU consulta EXACTAMENTE la misma fuente de reglas que
el usuario.

- **ACB**: convocatoria normal 8-12 — fuente: *ACB — Normas Internas
  2025-26*, artículos 15 y 17 (consultado 2026-08-24). Cupos de
  formación, extranjeros no comunitarios, máximo de 20
  inscripciones/temporada y sustituciones de no computables quedan
  `notImplemented` — alcance de REG-1.
- **Primera FEB**: convocatoria normal 10-12 — fuente: *FEB — Bases de
  Competición Primera FEB 2026-27*, apartados 2.2/2.3 (consultado
  2026-08-24). El propio PDF oficial incluye una fila "13-15 jugadores"
  que contradice el máximo de 12 fijado en el texto inmediatamente
  anterior — discrepancia real del documento, registrada en
  `knownSourceInconsistency` del módulo, no resuelta por interpretación
  propia; se mantiene el máximo inequívoco (12) hasta aclaración oficial.
- **Excepción médica** (LIFE-3): el mínimo NORMAL ahora lo aporta la
  competición; el mínimo ABSOLUTO (5) y la reducción siguen siendo
  política médica, combinados en `Medical.resolveEffectiveSquadMinimum()`
  — punto único que sustituye la duplicación literal que antes vivía en
  `game.js` (x2) y `CpuLineup.js`. `config.medical.squadException.normalMinimum`
  se retira de `MatchConfig.js` (ya no es una cifra universal).

**Puente de cobertura de datos (Primera FEB)**: 8 clubes del bundle real
tienen menos jugadores cargados (8-9) que el mínimo normativo — limitación
de COBERTURA del dataset, no una lesión, y no autoriza a bajar el mínimo.
`playerGenerator.padRosterToMinimum(roster, targetMinimum, options)`
completa EN MEMORIA (nunca `data/real/`) cada roster corto con el
generador ficticio ya existente. Cada jugador añadido: `dataSource =
'fictional-fallback-incomplete-roster'` (`FICTIONAL_FALLBACK_DATA_SOURCE`),
mostrado como tal en la interfaz (badge en Alineación, nota en la ficha
universal) — nunca como jugador real; instancia normal de `Player`,
inscrita en Player Registry igual que cualquier otra; recibe histórico
`complete` desde su creación (sin pasado inventado); NO recibe
contrato/licencia/vinculado ficticio (esas entidades no existen
todavía); desaparece por sí solo en cuanto el dataset real de ese club
alcance el mínimo. Un roster de 10 jugadores reales con varias bajas
médicas NO activa este puente — ese caso es disponibilidad médica, no
cobertura de datos (distinguido explícitamente en el test).

### Conceptos distintos fijados para las entregas futuras

Afiliación de plantilla, identidad mundial (esta entrega), contrato/
relación laboral (CONTRACT-1), licencia/inscripción por competición
(REG-1) y transfer internacional/Letter of Clearance (EUROPE-1) quedan
como cinco conceptos separados desde ahora — un contrato no concede
licencia, una licencia no sustituye al contrato. Ver DESIGN.md 9.16 para
el detalle completo y el anexo de fuentes ya estudiadas para las
entregas futuras (Real Decreto 1006/1985, Convenio colectivo ACB-ABP,
FIBA Internal Regulations Book 3, etc.).

### Convenciones nuevas para toda sesión futura de esta EPIC (`CLAUDE.md`)

Añadido un bloque permanente en `CLAUDE.md` ("Ciclo profesional de
plantilla"): resolver siempre desde el registro (nunca recorriendo
rosters actuales como índice global), usar siempre `competitionId`
(nunca `division` ni comportamiento ACB por defecto), capacidades
derivadas nunca implementan comportamiento por sí solas, contrato y
licencia son conceptos separados, toda norma incluye
fuente/versión/estado, composición por capas nunca `Object.assign`
genérico, y `DESIGN.md`/`CLAUDE.md`/`CHANGELOG.md` se actualizan en la
misma PR cuando cambia la arquitectura normativa.

### Verificación

- `scripts/test-roster1.js`: 31 checks dirigidos (registro/afiliación,
  validación de coherencia, resolución de reglas por competición,
  composición por capas, `buildMatchSquad` por competición, mínimo
  médico efectivo, puente de cobertura de datos) — 31/31 OK.
- `scripts/smoke-roster1.js`: 36 equipos reales + Player Registry
  mundial, 3 temporadas completas (liga regular ACB 8-12/Primera FEB
  10-12 verificada partido a partido, Copa, Playoffs, ascensos/
  descensos, cantera, liberación+reincorporación dirigida) — Player
  Registry íntegro en todo momento (752 jugadores tras 3 temporadas,
  coincide exactamente con la suma de las 36 plantillas). Sin
  excepciones.
- `scripts/verify-roster1-playwright.js` (desktop + móvil, `file://` sin
  servidor): cabeceras de convocatoria muestran el rango real por
  competición; rechazo con el rango correcto; relleno ficticio de
  Primera FEB visible con badge; BUG-LIFE4-01 (fecha completa) y
  BUG-LIFE4-03 (ficha de jugador sin club, liberado del roster) resueltos
  contra la interfaz real; las 7 sub-pestañas de la ficha degradan sin
  romperse sin club; abrir/cerrar la ficha no avanza el reloj de mundo —
  TODO OK en ambos viewports, sin errores de consola relevantes.
- `git diff --stat`: `CLAUDE.md`, `CHANGELOG.md`, `DESIGN.md`,
  `index.html`, `scripts/smoke-life4.js`/`test-life4.js` (solo la cita
  9.4→9.15), `scripts/smoke-roster1.js`/`test-roster1.js`/
  `verify-roster1-playwright.js` (nuevos), `src/core/CompetitionRules.js`/
  `PlayerRegistry.js` (nuevos), `src/core/CpuLineup.js`, `Events.js`
  (solo cita), `MatchConfig.js`, `MatchEngine.js` (solo cita),
  `Medical.js`, `PlayerCareer.js`, `Rotation.js` (solo cita),
  `src/entities/Player.js` (solo cita), `Team.js`, `src/ui/game.css`,
  `game.js`, `src/utils/playerGenerator.js`. Ninguno de
  `Bracket.js`/`Cup.js`/`Playoffs.js`/`Promotion.js`/`League.js`/
  `Calendar.js`/`Recovery.js`/`SeasonGoals.js`/`data/real/*.json`/
  `data/real/sources/*` se tocó.

### Fuera de alcance de ROSTER-1

Entidad `Contract`/salarios, negociación jugador/agente, derecho de
tanteo/ofertas cualificadas, licencias completas/cupos de formación o no
comunitarios/máximo de 20 altas, transfer fees/buyouts/rescisiones,
cesiones, Letter of Clearance, ligas extranjeras reales, retiros/IA de
mercado, reducción del intake de cantera, UI de mercado/contratos,
save/load nuevo. Siguiente entrega: **CONTRACT-1**.
