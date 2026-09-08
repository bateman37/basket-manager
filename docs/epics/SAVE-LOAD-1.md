# Ficha de Epic — SAVE-LOAD-1 (guardado y carga reales de una carrera)

- **Identificador**: `SAVE-LOAD-1`
- **Estado**: cerrada
- **Objetivo**: implementar guardado y carga reales de una carrera vía
  IndexedDB (3 ranuras manuales + autoguardado), manteniendo la simulación
  determinista, sin backend/SQL/nube ni cambio general de arquitectura.
- **Alcance y exclusiones**: ver encargo completo (prompt de la sesión).
  Incluye: repositorio IndexedDB, formato de guardado versionado,
  proyección/hidratación completas, UI mínima (Continuar/Cargar
  partida/modal Partida), autoguardado en checkpoints seguros, validación
  de integridad, pruebas focalizadas y documentación. Excluye: backend,
  sincronización en la nube, cuentas de usuario, import/export de JSON,
  compresión/cifrado, guardado a mitad de partido, migraciones ficticias,
  rediseño de navegación, smokes/Playwright exhaustivos.
- **Archivos permitidos**: `src/core/CareerPersistenceBoundary.js`, un
  hidratador nuevo en `src/core/` (`CareerHydrationService.js`), un
  repositorio nuevo en `src/storage/` (`IndexedDbCareerSaveRepository.js`),
  registries/entidades concretos que necesiten exportación/restauración
  durable, runners de competición y `WorldCalendar` si necesitan contrato
  de restore, `src/ui/game.js` + `src/ui/game.css`, `index.html` (nuevos
  `<script>`), `scripts/test-save-load1.js`, documentación de la sección
  11 del encargo.
- **Dependencias**: `WORLD-HARDEN-1` (`CareerPersistenceBoundary.js` ya
  existe como sonda), `WORLD-CALENDAR-1` (`WorldCalendar`/
  `WorldCalendarCoordinator`), `COMP-CORE-1` (`CompetitionEngine`/
  runners), `DOCS-CONTEXT-1` (sistema documental vigente).

## Estado real encontrado al empezar (2026-09-08)

- El prompt de encargo asume el sistema documental de `DOCS-CONTEXT-1`
  (`docs/STATUS.md`, `docs/EPIC_CONTEXT.md`, `docs/epics/`,
  `docs/architecture/`) — **confirmado real**, ya fusionado en `main`
  (PR #58, commit `a36a9ac`). La copia de `CLAUDE.md` con la que arrancó
  esta sesión estaba desactualizada (monolítica, pre-DOCS-CONTEXT-1); se
  ha re-leído la versión real de `main` antes de tocar nada.
- La rama designada `claude/modest-gauss-ab8bat` ya estaba fusionada
  íntegramente en `main` (PR #55) — se ha reiniciado desde
  `origin/main` (`a36a9ac`) siguiendo el protocolo de rama ya fusionada,
  sin apilar sobre historia ya integrada.
- `docs/EPIC_CONTEXT.md` confirma que no había ninguna Epic activa tras
  `DOCS-CONTEXT-1` — esta sesión abre `SAVE-LOAD-1` por instrucción
  explícita del encargo (no autoiniciada).
- `src/core/CareerPersistenceBoundary.js` **ya existe** (WORLD-HARDEN-1)
  y es más completo de lo que el prompt de encargo hace suponer: ya tiene
  `inventory()` versionado y `project(runtime, {snapshotAtGameDate})` que
  produce un envelope canónico con fingerprint FNV-1a determinista
  (orden estable por id, sin depender de `Map`/timestamps). Cubre:
  identidad de mundo, content packs instalados, `simulationProfile`,
  calendario (id/huso/instante/temporadas — **sin ledger de pendientes**),
  `WorldRegistries.describe()` completo (áreas, organizaciones, clubes,
  teamIds, squads, definiciones/ediciones/etapas/entries de competición,
  receipts de pathway/transición, snapshots de simulación), un `Player`
  por id vía `PlayerRegistry`, y `.snapshot()` de
  contracts/registrations/agents/market/transfers/loans/annualCycle/
  academy/nationalTeams.
- Esta Epic **reutiliza `CareerPersistenceBoundary.js` como base** (no lo
  sustituye) y lo extiende donde el propio módulo ya documenta huecos
  (`runtimeCompetitiveState` declarado `derived` con un rebuild
  strategy que hoy solo produce `{stageId, status, completed}` — ver
  sección de gaps más abajo) y donde el encargo detecta cobertura
  incompleta (decisiones de equipo, news/history, contadores de ID).

## Inventario del estado durable (clasificación completa)

Ampliación real sobre `CareerPersistenceBoundary.inventory()` (WORLD-HARDEN-1
ya cubría la mayoría — ver tabla abajo solo lo que esta Epic auditó o
cambió).

**Durable y persistido (ya en WORLD-HARDEN-1, sin cambios):** identidad de
mundo, content packs instalados (id+version), perfil de simulación,
temporadas del calendario, `WorldRegistries` (áreas/organizaciones/clubes/
definiciones/ediciones/stages/entries/receipts de pathway y transición/
snapshots de simulación), un `Player` por id, y las colecciones de
contratos/inscripciones/agentes/mercado/traspasos/cesiones/ciclo anual/
academia/selecciones nacionales.

**Durable pero NO cubierto hasta ahora (añadido en esta Epic):**

- **`teams`** (nueva colección) — `Team.toJSON()` SIN `roster` (la
  plantilla real la aporta el `Squad` ya persistido + `PlayerRegistry`,
  invariante "un Player se proyecta una vez"): perfil táctico, plan/estado
  de entrenamiento, reputación deportiva, historia/rivalidades, staff
  médico, categoría/rol — de los 36 equipos, no solo el del usuario.
  `worldRegistries.teamIds` (WORLD-HARDEN-1) solo daba el id, nunca este
  contenido.
- **`competitionRuntime`** (nueva colección) — por cada stage con runner
  vivo: los partidos YA JUGADOS con su resultado ya calculado
  (`runner.listPlayedMatchesInReplayOrder()`), en orden de reproducción
  válido. `runtimeSnapshots` de WORLD-HARDEN-1 solo daba
  `{stageId, status, completed}` — insuficiente para reanudar sin volver a
  simular. Este dato es DURABLE, no derivado: un resultado de partido
  (RNG real vía `MatchEngine`) no es reconstruible sin repetir la
  simulación (prohibido por el encargo).
- **`calendar.pendingItems`/`calendar.ledger`** — WORLD-HARDEN-1 los
  descartaba deliberadamente. Un item `awaiting-user`/`failed` no es
  re-derivable resincronizando sus fuentes (`WorldCalendar.syncSource()`
  solo conserva ese estado para un item que YA existe en el índice), así
  que es durable.
- **`uiState`** (nueva colección) — `newsLog`/`medicalAgendaLog`/
  `marketAgendaLog` (el propio `game.js` ya documentaba que no son
  reconstruibles desde otro estado vivo), la alineación en curso del
  usuario (`state.lineup`) y los contadores de ronda de negociación
  (`transferNegotiationOfferSequence`/`loanNegotiationAttemptSequence`,
  antes solo en `state`, nunca persistidos).
- **Contratos/inscripciones/agentes/mercado/traspasos/ciclo anual/
  academia — fidelidad real, no solo contadores**: se auditó cada
  `.snapshot()` de WORLD-HARDEN-1 contra su propio código (no solo el
  comentario) y se confirmó que `ContractRegistry`/`RegistrationRegistry`/
  `AgentRegistry`/`MarketRegistry`/`TransferRegistry`/
  `AnnualCycleRegistry`/`AcademyRegistry` devolvían RESÚMENES diagnósticos
  (contadores o campos reducidos: p.ej. `ContractRegistry.snapshot()` solo
  daba `{id, playerId, clubId, startDate, endDate}`, sin remuneración ni
  cláusulas). Cada uno gana ahora `exportState()`/`restoreState()` — el
  contrato COMPLETO y sin pérdida vía `.toJSON()` de cada entidad —
  dejando su `snapshot()` original intacto (mismo significado
  diagnóstico). `LoanRegistry`/`NationalTeamRegistry` YA eran lossless;
  ganan `exportState()`/`restoreState()` solo por uniformidad de contrato
  (`exportState()` reexporta `snapshot()` tal cual).

**Derivado (se recalcula, nunca se persiste aparte):** índices secundarios
de todos los registros (reconstruidos por las propias llamadas a
`registerX()`), runners vivos de `CompetitionEngine` (reconstruidos por
`initializeEdition()` + reaplicación silenciosa de resultados), fachadas
`League`/`Bracket` legacy, `state.pathwayService`/`state.
calendarCoordinator`/`state.scheduleService` (se reconstruyen tras
hidratar, mismo patrón que el tramo final de `startCareerFromSetup()`).

**Efímero de UI, descartado (no se persiste, ni se pretende):** pantalla
actual, foco de navegación del navegador Mundo, catálogo/borrador de
configuración de carrera (antes de "Comenzar"), warnings de bootstrap
(one-shot), caché de clasificación regulatoria, resumen de cierre de
temporada (se muestra una vez), ancla de fecha de Agenda.

**No compatible con guardado v1 (deuda aceptada, documentada):**

- Contadores de id de `Events.js` (`news-result-N`...) son un cierre de
  módulo no persistido — `CareerHydrationService` eleva su suelo al mayor
  sufijo ya usado en los logs restaurados (`Events.
  ensureEventIdCounterAtLeast()`) para no reutilizar un id, pero el
  contador en sí no es parte del envelope.
- El contador local de `Medical.js` (`injury-N-<timestamp>`) no se toca —
  su sufijo `Date.now()` ya hace la colisión extremadamente improbable
  incluso sin seedearlo; no se justificaba tocar ese archivo para esta
  Epic.
- Migraciones de schema: el punto de entrada existe
  (`CareerHydrationService.verifyEnvelopeIntegrity()` rechaza
  `schemaVersion` distinta de 1 con mensaje explícito), pero no hay
  ninguna migración real todavía (v1 es la única versión existente).

## Decisiones cerradas

- Se reutiliza el envelope/fingerprint/orden estable de
  `CareerPersistenceBoundary.js` como base del payload nuevo — no se
  reinventa un segundo mecanismo de canonicalización.
- Formato nuevo `basket-manager-career-save` (`schemaVersion: 1`),
  distinto del `schemaVersion: 'world-harden-1'` interno del boundary
  (ese sigue siendo el envelope de contenido; el formato de guardado lo
  envuelve con metadata de ranura/fingerprint propio):
  `{format, schemaVersion, slotId, revision, savedAtUtc, metadata,
  contentPacks, payload, fingerprint}`, con `payload` = el envelope
  completo de `CareerPersistenceBoundary.project()`.
- **Runtime competitivo — reproducción silenciosa, nunca replay de
  partidos ni de callbacks**: `CompetitionRunners.js`
  (`RoundRobinStageRunner`/`BracketStageRunner`) gana `options.silent` en
  `resolveMatch()` (omite `onRoundCompleted`/`onStageCompleted`/
  `onSeriesDecided`/`onRoundAdvanced`) y `listPlayedMatchesInReplayOrder()`.
  `CareerHydrationService` reconstruye el runner con
  `CompetitionEngine.initializeEdition()` (código de siempre, determinista
  desde las Entries ya restauradas) y reaplica cada resultado YA CONOCIDO
  vía `matchEngineOptions.precomputedResult` (ya soportado por
  `MatchEngine.simulateMatch`, cero RNG) + `silent: true` — nunca vuelve a
  simular ni repite activación de pathway/noticias (esos efectos ya están
  en el resto del estado durable restaurado). `CompetitionEngine.
  initializeEdition()` gana `options.includeStatuses` (por defecto
  `['active']`, sin cambio de comportamiento en ningún call-site
  existente) para poder reconstruir también el runner de un stage YA
  `'completed'` (ej. Liga regular terminada con un playoff posterior
  todavía en curso) — en una carrera EN VIVO esto nunca hace falta (el
  runner de una fase completada sigue vivo desde que se construyó).
- **`WorldCalendar` gana `restorePendingItems()`/`restoreLedger()`** —
  siembra directa (nunca `syncSource()`, que crearía todo `'scheduled'`
  por defecto) ANTES de que `game.js` vuelva a sincronizar las fuentes
  reales; un item ya existente conserva su estado/motivo de fallo
  (comportamiento ya existente de `syncSource()` para items conocidos).
- **`resetCareerState()` extraído** del handler "Volver a selección de
  equipo" (sin cambio de comportamiento) — reutilizado también antes de
  hidratar una carga, para que nunca mezcle registros de la sesión
  anterior con los del guardado.
- **Bloqueo de guardado durante partido activo**: predicado puro
  `CareerPersistenceBoundary.canSave(runtime)`/`describeSaveBlockers(runtime)`
  sobre `runtime.activeMatchInProgress` (aportado explícito por `game.js`
  desde `!!state.matchReveal`) — nunca se infiere leyendo `state` dentro
  del boundary.
- **Pantalla "Partida"** (`data-screen="save-load"`, nav + landing) hace de
  las dos cosas a la vez: dentro de una carrera es guardar/cargar/
  sobrescribir/eliminar; desde la landing sin carrera activa (botón
  "Cargar partida") es solo cargar/eliminar — la sección de guardar se
  oculta sola cuando `state.world` es `null`. "Continuar" en la landing
  carga directo la ranura `autosave` sin pasar por esta pantalla.

## Preguntas abiertas

- Ninguna decisión de diseño de juego nueva — esta Epic es solo
  infraestructura de persistencia sobre reglas ya vigentes.

## Documentos canónicos

- `docs/architecture/persistence-boundary.md` (se reescribe con el
  contrato final de guardado/hidratación).

## Pruebas mínimas

```bash
node scripts/test-save-load1.js
node scripts/test-world-harden1.js
node --check <cada JS modificado>
git diff --check
```

## Criterios de aceptación

Una carrera guardada puede cargarse en un runtime nuevo, supera las
validaciones, mantiene igualdad canónica (`proyectar(A) → hidratar →
proyectar(B)` con el mismo fingerprint) y puede ejecutar correctamente la
siguiente acción del juego.

## Resultado (al cerrar)

- **Qué se implementó**: guardado/carga reales de una carrera vía
  IndexedDB (base `basket-manager`, store `career-saves`, ranuras
  `manual-1`/`manual-2`/`manual-3`/`autosave`), con proyección/hidratación
  de fidelidad completa (mundo, 36 equipos con su estado táctico/
  institucional, competición con partidos/standings/brackets reales,
  calendario con pendientes, ciclo profesional completo, logs de
  interfaz), validación de fingerprint/schema/content packs antes de
  tocar nada, autoguardado en los 3 checkpoints seguros del encargo,
  bloqueo de guardado durante partido activo, y una pantalla "Partida"
  única para guardar/cargar/sobrescribir/eliminar + botones "Continuar"/
  "Cargar partida" en la landing.
- **Archivos/módulos principales**: `src/core/CareerPersistenceBoundary.js`
  (extendido: `teams`/`competitionRuntime`/`uiState`, `pendingItems`/
  `ledger` del calendario, `canSave()`/`describeSaveBlockers()`,
  fingerprint exportado), `src/core/CareerHydrationService.js` (nuevo),
  `src/storage/IndexedDbCareerSaveRepository.js` (nuevo),
  `src/core/CompetitionRunners.js`/`CompetitionEngine.js` (restore
  silencioso), `src/core/WorldCalendar.js` (restore de pendientes/
  ledger), `exportState()`/`restoreState()` en `ContractRegistry`/
  `RegistrationRegistry`/`AgentRegistry`/`MarketRegistry`/
  `TransferRegistry`/`LoanRegistry`/`AnnualCycleRegistry`/
  `AcademyRegistry`/`NationalTeamRegistry`, `Events.
  ensureEventIdCounterAtLeast()`, `src/ui/game.js` (`resetCareerState()`
  extraído, `saveCareerToSlot`/`autoSaveCareer`/`loadCareerFromSlot`/
  `renderSaveLoadScreen`), `src/ui/game.css`, `index.html` (landing +
  pantalla "Partida" + carga de scripts nuevos).
- **Pruebas realmente ejecutadas**:
  ```
  node scripts/test-save-load1.js       # 12/12 OK
  node scripts/test-world-harden1.js    # 20/20 OK (compatibilidad hacia atrás)
  node scripts/test-comp-core1.js       # 32/32 OK (se tocó CompetitionEngine/Runners)
  node scripts/test-world-calendar1.js  # 25/25 OK (se tocó WorldCalendar)
  node --check <cada .js modificado/nuevo>
  git diff --check
  ```
  `scripts/test-save-load1.js` cubre: proyección completa de las
  colecciones nuevas, round-trip canónico con fingerprint estable,
  identidad de `Player` entre registry/roster/squad, cursor+temporadas del
  calendario, igualdad de partidos/resultados/standings, integridad de
  `WorldRegistries`/registries de dominio tras cargar, igualdad de una
  acción determinista aplicada a A y a B, rechazo de fingerprint
  corrupto/schema futura/content pack incompatible, no-corrupción de la
  carrera activa ante una carga fallida, y reproducción de un playoff
  (bracket) activado tras completar una Liga regular ya `'completed'`
  (el caso que exigió `includeStatuses` en `initializeEdition()`).
  **No se ejecutó** ninguna verificación en navegador real/Playwright —
  ver checklist manual pendiente.
- **Limitaciones o follow-ups reales**:
  1. **Checklist manual completo pendiente de Dennis** —
     `docs/manual/SAVE_LOAD_ACCEPTANCE.md`, ninguna sesión de Claude Code
     la ha ejecutado en navegador real.
  2. Los contadores de ronda de negociación de mercado/cesión
     (`transferNegotiationOfferSequence`/`loanNegotiationAttemptSequence`)
     sí se persisten (`uiState.negotiationSequences`), pero el fixture de
     `test-save-load1.js` no cubre una contraoferta viva a mitad de
     ronda — cobertura por analogía con el resto de `uiState`, no
     verificada end-to-end.
  3. Las colecciones `transfers`/`loans`/`annualCycle`/`academy`/
     `nationalTeams` quedaron VACÍAS en el fixture de prueba (por acotar
     el alcance de la batería a 10-12 bloques) — su
     `exportState()`/`restoreState()` sigue el MISMO patrón mecánico ya
     verificado en `contracts`/`registrations`/`agents`/`market`
     (constructor `(data) => toJSON()` simétrico, confirmado código a
     código), pero no tiene un caso de prueba propio con datos reales.
     Follow-up razonable para una sesión que además toque esos dominios.
  4. `src/core/Medical.js` conserva su contador de lesiones sin cambios
     (mitigado por su sufijo `Date.now()`, no por diseño determinista) —
     deuda aceptada, no bloqueante.
  5. No hay migración de schema real (v1 es la única versión) — el punto
     de entrada existe y rechaza con mensaje explícito cualquier versión
     distinta.
- **Checklist manual pendiente para el propietario**: ver
  `docs/manual/SAVE_LOAD_ACCEPTANCE.md`.
