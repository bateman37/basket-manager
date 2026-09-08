# Ficha de Epic — SIM-CAL-1 (avance cooperativo y cancelable de "Continuar")

- **Identificador**: `SIM-CAL-1`
- **Estado**: cerrada
- **Objetivo**: convertir el "Continuar" síncrono de `WORLD-CALENDAR-1` en
  una operación cooperativa, visible y cancelable de forma segura, sin
  cambiar ninguna regla deportiva/de calendario/de simulación.
- **Alcance y exclusiones**: incluye avance por pasos resumible, scheduling
  cooperativo en el navegador, contadores de progreso reales, cancelación
  segura, protección de reentrada, enrutado de la parada terminal,
  bloqueo de guardar/cargar durante el avance, overlay compacto y
  responsive, y pruebas/documentación focalizadas. Excluye explícitamente:
  controles de avanzar 1/3/7 días, modo vacaciones, autogestión de
  partidos del usuario, fecha objetivo arbitraria, resolución automática de
  conflictos de calendario, cambios a calendarios/formatos/niveles de
  detalle de competición, Web Workers/backend, un bus de eventos nuevo, un
  refactor amplio de `game.js`, contenido de juego nuevo y smokes/Playwright
  completos.
- **Archivos permitidos**: `src/core/WorldCalendarCoordinator.js`,
  `src/core/WorldAdvanceRunner.js` (nuevo), `src/core/
  CareerPersistenceBoundary.js` (solo el nuevo bloqueador explícito),
  secciones acotadas de orquestación en `src/ui/game.js`, `src/ui/game.css`,
  `index.html` (script nuevo + contenedor del overlay),
  `scripts/test-sim-cal1.js` (nuevo), y la documentación listada abajo.
- **Dependencias**: `WORLD-CALENDAR-1` (coordinador y sus invariantes),
  `WORLD-SIM-1` (niveles de detalle/hitos abstractos, sin cambios),
  `SAVE-LOAD-1` (contexto explícito de bloqueadores de guardado).
- **Decisiones cerradas**:
  - El avance por pasos y el driver síncrono comparten el MISMO generador
    (`WorldCalendarCoordinator._advanceGenerator()`) — nunca dos algoritmos
    de calendario independientes.
  - `advanceUntilNextUserStop()` se mantiene, sin cambiar su contrato
    público, para scripts/tests/compatibilidad — crea una sesión efímera
    sin cancelación posible y la agota de un tirón.
  - La UI (`playNextMatchWithLineup()` en `game.js`) ya NO llama a
    `advanceUntilNextUserStop()` directamente: usa
    `state.worldAdvanceRunner` (`WorldAdvanceRunner`), que reparte la MISMA
    sesión en slices cooperativos.
  - Cancelación cooperativa: el único punto de comprobación está al
    principio de cada iteración del generador, justo después de `sync()` y
    antes de bloquear un grupo cronológico nuevo — nunca a mitad de un
    grupo ya bloqueado. Reanudar usa una sesión NUEVA sobre el MISMO
    `WorldCalendarCoordinator`/`WorldCalendar` — nunca revive ni serializa
    la sesión cancelada.
  - `WorldAdvanceSession` (sesión efímera) y `WorldAdvanceRunner` (driver
    cooperativo del navegador) nunca son estado durable — se descartan
    (`dispose()`) en cada frontera terminal y en `resetCareerState()`/una
    carga con éxito.
  - Corrección de encaje: la validez de alineación deja de comprobarse
    ANTES de avanzar el mundo — solo importa cuando la parada real
    devuelta es `user-match` (antes bloqueaba aunque la siguiente parada
    fuera una atención de mercado).
  - Nuevo bloqueador explícito de guardado, `activeCalendarAdvance`
    (`CareerPersistenceBoundary.describeSaveBlockers()`), aportado por
    `game.js` — nunca inferido dentro del boundary.
  - Auditoría estática de `test-world-calendar1.js` ("Continuar pasa
    exclusivamente por el coordinador") sigue pasando SIN modificarla: la
    llamada literal `state.calendarCoordinator.advanceUntilNextUserStop()`
    se conserva en la función `advanceWorldUntilNextUserStop()` de
    `game.js`, mantenida para scripts/compatibilidad aunque la UI ya no la
    invoque en el click de "Continuar".
- **Preguntas abiertas**: ninguna nueva; ver "Deuda aplazada" abajo.
- **Documentos canónicos**: `docs/architecture/simulation-advance.md`
  (contrato nuevo de esta Epic), con enlace corto desde
  `docs/architecture/world-calendar.md`. Mapa de código actualizado en
  `docs/code/game-ui.md`.
- **Pruebas mínimas**: `node scripts/test-sim-cal1.js`,
  `node scripts/test-world-calendar1.js`, `node scripts/test-world-sim1.js`,
  `node scripts/test-save-load1.js`, `node --check` sobre cada archivo
  JavaScript tocado, `git diff --check`.
- **Criterios de aceptación**: avance cooperativo y driver síncrono llegan
  al mismo estado canónico; cancelación deja una carrera válida y
  resumible; clicks duplicados de "Continuar" no duplican trabajo; el
  navegador puede repintar entre slices de simulación.

## Resultado (al cerrar)

- **Qué se implementó**:
  - `WorldCalendarCoordinator.js`: `advanceUntilNextUserStop()` se
    reimplementa como generador (`_advanceGenerator()`) con puntos `yield`
    entre cada item automático resuelto y un único punto de comprobación
    de cancelación cooperativa; nueva clase `WorldAdvanceSession`
    (`createAdvanceSession()`) con `requestCancel()`, `runSteps(n)` e
    informe de progreso plano/JSON-safe; nuevo `STOP_TYPES.USER_CANCELLED`
    (`'user-cancelled'`).
  - `src/core/WorldAdvanceRunner.js` (nuevo): driver cooperativo con
    presupuesto de ~8ms + máximo de items por slice, reloj técnico y
    scheduler inyectables (nunca `setInterval`, siempre se agenda el
    siguiente slice tras terminar el anterior), protección de reentrada
    (`start()` devuelve `false` si ya hay una operación activa), y
    conversión de excepciones inesperadas al flujo visible de
    `resolution-failed` existente.
  - `CareerPersistenceBoundary.describeSaveBlockers()`: nuevo motivo
    "El mundo se está simulando…" cuando `runtime.activeCalendarAdvance`
    es `true`.
  - `game.js`: `state.worldAdvanceRunner` construido junto al coordinador
    (arranque de carrera nueva y carga), descartado en
    `resetCareerState()`; `playNextMatchWithLineup()` reescrita para usar
    el runner cooperativo con overlay a los 150ms, contador de progreso
    real y enrutado de la parada terminal
    (`routeWorldAdvanceTerminalStop()`); comprobación de alineación movida
    a DESPUÉS de conocer la parada real (`user-match` únicamente);
    `loadCareerFromSlot()`/botones de Cargar/Eliminar/Cerrar
    temporada/"Elegir otro club" bloqueados mientras el avance está activo;
    `buildCareerSaveRuntime()` aporta `activeCalendarAdvance`; aviso
    pequeño en Home tras una cancelación.
  - `index.html`/`game.css`: overlay compacto (`#gm-advance-overlay`,
    `aria-live`/`aria-busy`, responsive) y carga de
    `WorldAdvanceRunner.js`.
  - `scripts/test-sim-cal1.js` (nuevo): 10 checks agrupados cubriendo los
    12 puntos de la sección 13 del prompt (dos pares fusionados por
    solaparse naturalmente: orden estable + yield dentro de un grupo;
    cancelación + reanudación sin duplicados).
- **Pruebas realmente ejecutadas**: `node scripts/test-sim-cal1.js` (10 OK),
  `node scripts/test-world-calendar1.js` (25 OK, sin modificar — incluida
  la auditoría estática de "Continuar"), `node scripts/test-world-sim1.js`
  (19 OK), `node scripts/test-save-load1.js` (12 OK), `node --check` sobre
  los 5 archivos JavaScript tocados, `git diff --check` limpio. No se ha
  ejecutado ninguna comprobación en navegador/Playwright real (fuera de
  alcance explícito de esta Epic) — checklist manual pendiente de Dennis en
  `docs/manual/SIM_CAL_ACCEPTANCE.md`.
- **Deuda aplazada**:
  - Checklist manual completo en navegador real (`docs/manual/
    SIM_CAL_ACCEPTANCE.md`) — ninguna sesión de Claude Code lo ha
    ejecutado.
  - `scripts/verify-cycle1-playwright.js`/scripts Playwright históricos
    siguen sin migrarse a la primitiva cooperativa (ya estaban fuera de la
    ruta productiva desde antes de esta Epic, ver `docs/STATUS.md`).
  - Controles de avanzar 1/3/7 días, modo vacaciones, resolución automática
    de conflictos de calendario y fecha objetivo arbitraria quedan
    explícitamente fuera de alcance (sección 11 del prompt) — candidatos a
    Epic futura si Dennis los prioriza.
