# Arquitectura — avance cooperativo y cancelable de "Continuar" (SIM-CAL-1)

Contrato VIGENTE de ejecución de "Continuar". No redefine ninguna regla de
`docs/architecture/world-calendar.md` (calendario, orden, paradas): esta
Epic es de EJECUCIÓN/UX, nunca de reglas de dominio.

## Una única primitiva, dos drivers

`WorldCalendarCoordinator._advanceGenerator(session)` (generador JS) es la
ÚNICA implementación del algoritmo de "Continuar" — mismo `sync()`, mismo
criterio de grupo cronológico/parada, misma resolución automática estable
por id que antes de SIM-CAL-1. Dos consumidores del MISMO generador, nunca
dos algoritmos:

- **`coordinator.advanceUntilNextUserStop()`** — driver SÍNCRONO mantenido
  para scripts, pruebas Node y compatibilidad. Crea una `WorldAdvanceSession`
  efímera sin cancelación posible y la agota de un tirón
  (`session.runSteps(Infinity)`).
- **`WorldAdvanceRunner`** (`src/core/WorldAdvanceRunner.js`) — driver
  COOPERATIVO del navegador. Reparte la MISMA sesión en slices acotados por
  presupuesto de tiempo (~8ms por defecto) y un máximo de items por slice,
  cediendo el control (`scheduler`, nunca `setInterval`: el siguiente slice
  se agenda solo después de que el anterior termine) para que el navegador
  repinte entre ellos.

Dadas las mismas condiciones iniciales y sin cancelación, ambos drivers
producen el MISMO tipo/item de parada, el mismo snapshot de calendario, los
mismos resultados/standings de competición y el mismo registro de dominio —
verificado en `scripts/test-sim-cal1.js` (check de equivalencia síncrono
vs. cooperativo).

## `WorldAdvanceSession` — sesión efímera, nunca durable

`coordinator.createAdvanceSession({ now })` crea una sesión que envuelve el
generador:

- `requestCancel()` — idempotente, marca la intención de cancelar.
- `runSteps(maxSteps)` — avanza como máximo `maxSteps` pasos del generador
  (cada `yield` o el `return` final cuentan como un paso); devuelve
  `{ done, terminal }`.
- `getProgressReport()` — informe PLANO y JSON-safe: instante inicial/
  actual, grupos completados, total de items resueltos, contadores por
  `sourceType`, partidos resueltos, último item resuelto, tiempo técnico
  transcurrido, `status` (`running`/`cancel-requested`/`stopped`/
  `cancelled`/`failed`) y `finalStopType` cuando es terminal. Nunca
  contiene instancias de `Team`/`Player`/DOM/runner — la UI deriva
  etiquetas de presentación a partir de `sourceType`.
- `dispose()` — descarta los internos; la sesión nunca se reutiliza tras
  esto y NUNCA se proyecta en un guardado (no es estado de carrera).

## Cancelación cooperativa segura

El único punto de comprobación de cancelación está al principio de cada
iteración del generador, justo DESPUÉS de `sync()` (sincroniza el grupo que
se acaba de resolver) y ANTES de bloquear un grupo cronológico nuevo —
nunca a mitad de un grupo ya bloqueado. Esto reproduce exactamente la
sección "Cancelación segura" del contrato de la Epic:

1. Un click marca la intención (`session.requestCancel()` /
   `runner.cancel()`).
2. El item que se está resolviendo en ese instante termina.
3. Si un grupo cronológico ya empezó a resolverse, termina ENTERO (con
   `yield` entre cada item, para que el navegador pueda repintar, pero sin
   comprobar cancelación hasta que el grupo completo esté resuelto).
4. El calendario se sincroniza (boundary de la siguiente iteración).
5. Se devuelve un resultado terminal `{ type: 'user-cancelled', instant,
   iterations }` limpio, antes de bloquear otro grupo.

El estado tras cancelar pasa las MISMAS comprobaciones de integridad de
calendario/mundo/registries que cualquier checkpoint normal — no hay
ningún token de continuación oculto: reanudar es simplemente llamar de
nuevo a "Continuar", que crea una `WorldAdvanceSession` NUEVA sobre el
MISMO `WorldCalendarCoordinator`/`WorldCalendar` ya avanzado.

## `WorldAdvanceRunner` — driver cooperativo del navegador

`src/core/WorldAdvanceRunner.js`, sin importar DOM ni `state` global
(inyectado desde `game.js`):

- `coordinator` (obligatorio), `scheduler(callback)` (por defecto
  `(cb) => setTimeout(cb, 0)`, inyectable en pruebas Node para no depender
  de temporizadores reales), `now()` (por defecto `Date.now`; `game.js`
  inyecta `performance.now()`), `sliceBudgetMs` (8 por defecto),
  `maxItemsPerSlice` (200 por defecto).
- `start({ onProgress, onTerminal })` — rechaza (`false`) un segundo
  arranque mientras ya hay una operación activa: NUNCA crea una segunda
  simulación (protección de reentrada).
- `cancel()` — delega en `session.requestCancel()`.
- `dispose()` — descarta sesión y callbacks; se llama en
  `resetCareerState()` y tras una carga con éxito, para que ninguna carrera
  nueva herede progreso/callbacks de la anterior.
- Una excepción NO capturada ya dentro del generador (las de dominio se
  convierten en `resolution-failed` con su propio item, sin llegar aquí)
  se enruta como un `resolution-failed` sintético hacia `onTerminal` — el
  mismo flujo visible que un fallo de resolución normal, sin un camino
  aparte en `game.js`.

## Integración en `game.js`

- `state.worldAdvanceRunner` se construye junto a
  `state.calendarCoordinator` (carrera nueva y carga) y se descarta en
  `resetCareerState()`.
- `playNextMatchWithLineup(team)` es el ÚNICO punto de entrada de la UI al
  avance — arranca el runner, programa el overlay a los 150ms
  (`scheduleWorldAdvanceOverlay()`), actualiza el overlay en cada progreso
  y enruta la parada terminal (`routeWorldAdvanceTerminalStop()`). Un
  click mientras ya hay una operación activa se ignora (el propio
  `runner.start()` ya protege esto desde antes de que exista overlay
  visible).
- **Corrección de encaje** (antes de esta Epic, `playNextMatchWithLineup()`
  y sus llamadores comprobaban la validez de la alineación ANTES de saber
  cuál sería la parada real, así que una atención de mercado con plazo más
  cercano quedaba bloqueada sin necesidad): la validez de alineación se
  comprueba SOLO dentro de `routeWorldAdvanceTerminalStop()`, y solo cuando
  la parada devuelta es, de hecho, `user-match`.
- `advanceWorldUntilNextUserStop()` (llamada síncrona directa a
  `state.calendarCoordinator.advanceUntilNextUserStop()`) se MANTIENE sin
  cambios, para scripts/Node/compatibilidad — la UI del navegador ya no la
  invoca en el click de "Continuar", pero sigue expuesta en
  `global.BasketManagerGame` y sigue siendo la ruta que la auditoría
  estática de `scripts/test-world-calendar1.js` verifica.
- Mientras el avance está activo: navegación (`#gm-nav`) y "Elegir otro
  club / salir" quedan deshabilitados; `loadCareerFromSlot()` rechaza
  explícitamente; los botones Cargar/Eliminar de la pantalla "Partida" y
  "Cerrar temporada" en Home quedan deshabilitados. El único control
  interactivo dentro del overlay es "Detener tras este bloque".
- Tras una cancelación, Home muestra un aviso pequeño y NO de error (se
  limpia solo, igual que el resumen de cierre de temporada, en la próxima
  parada real).

## Guardado durante el avance

`CareerPersistenceBoundary.describeSaveBlockers(runtime)` añade un motivo
nuevo cuando `runtime.activeCalendarAdvance` es `true` (aportado por
`game.js`, nunca inferido dentro del boundary) — cubre tanto la sesión
corriendo como la cancelación todavía sin terminar de sincronizar
(`runner.isActive()` sigue `true` hasta el terminal `user-cancelled`). No
cambia el formato de guardado ni los 3 checkpoints de autoguardado de
`docs/architecture/persistence-boundary.md`.

## Qué NO cubre esta Epic

Controles de avanzar 1/3/7 días, modo vacaciones, autogestión de partidos
del usuario, fecha objetivo arbitraria, reprogramación/resolución
automática de conflictos de calendario, cambios a calendarios/formatos/
niveles de detalle de competición, Web Workers/backend, un bus de eventos
nuevo, o un refactor amplio de `game.js`. Ver `docs/epics/SIM-CAL-1.md`
para la lista completa y los follow-ups aceptados.
