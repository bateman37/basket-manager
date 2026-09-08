# Arquitectura — cronología mundial única (WORLD-CALENDAR-1)

_Migrado de `CLAUDE.md` (líneas 1045-1120 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### WORLD-CALENDAR-1 (DESIGN.md 10.14) — cronología mundial única

Convenciones permanentes de la 4ª entrega de World Architecture — aplican a
toda sesión futura que toque el tiempo de la carrera: calendario, orden de
eventos, "Continuar", paradas del usuario, fechas de partido o proyección de
Agenda/Home:

- Una carrera tiene UN solo `WorldCalendar` (`src/core/WorldCalendar.js`),
  instancia EXPLÍCITA por carrera, y `state.calendar ===
  state.world.calendar` por identidad estricta durante TODA la carrera. El
  cierre de temporada NO lo reemplaza: registra la temporada nueva en el
  mismo agregado. El cursor (`currentInstant`) nunca retrocede.
- El tiempo canónico es un **instante ISO 8601 UTC** + un **huso IANA
  explícito** (`src/utils/GameDateTime.js`). `LocalDate` sigue siendo la
  fecha CIVIL `YYYY-MM-DD` sin hora y NO se mezcla con él. Ningún cálculo
  nuevo puede depender del huso del proceso/navegador: nada de
  `new Date(y, m, d)`, `setHours`, `getFullYear` ni
  `LocalDate.fromJsDate(state.calendar...)` en la ruta productiva. Sumar
  "el día siguiente" es `addLocalDays` en el huso declarado, nunca 24h
  ciegas.
- Los calendarios son CONTENIDO versionado (`CompetitionScheduleDefinition`
  + `CompetitionScheduleCatalog`), congelado por Edition en
  `edition.scheduleProfileId`. Un schedule/fase desconocido FALLA de forma
  descriptiva; nunca hereda el perfil de otra competición. Añadir una
  competición o un país es registrar su definición de calendario en el
  catálogo desde su paquete (`data/world/*.js`), nunca una rama nueva en
  el core, en `game.js` ni en el servicio.
- `CompetitionScheduleService` es el ÚNICO sitio que sabe programar fechas.
  Toda fecha de partido llega al runner por el `dateResolverProvider`
  inyectado; el descriptor tiene como AUTORIDAD `scheduledAt` +
  `timeZoneId` y `scheduledDate` (`Date`) es solo una vista derivada de
  compatibilidad, nunca una segunda fuente.
- El orden global y "Continuar" pasan EXCLUSIVAMENTE por
  `WorldCalendarCoordinator.advanceUntilNextUserStop()`. No se resucita
  ninguna unidad de avance por bloques (`simulateNextRound()`,
  `simulateBackgroundRound()`, `drainBackgroundBrackets()` y la prioridad
  fija de `getActiveBracket()` están RETIRADAS y no vuelven con otro
  nombre). El coordinador es el único punto que avanza `state.calendar`.
- Un CPU-vs-CPU NUNCA es parada del usuario; un partido del usuario nunca
  se auto-resuelve; los resultados CPU del MISMO instante no se revelan
  antes de que termine el suyo (se resuelven después, sin mover el cursor).
  Dos partidos simultáneos del equipo controlado devuelven CONFLICTO
  explícito: no se elige por id ni se reprograma nada.
- Ni `state.division`, ni el país, ni el nombre visible de una liga, ni el
  orden de un array/`Map`/paquete deciden tiempo, participación o siguiente
  partido. `state.division` sobrevive SOLO como filtro visual de las
  pantallas españolas hasta WORLD-UI-1.
- Consultar/renderizar NUNCA muta, NUNCA materializa partidos y NUNCA
  consume aleatoriedad. `resolveMatch()` materializa el siguiente partido
  de su serie; sincronizar la cola solo ocurre en puntos de avance/commit
  reales, jamás dentro de un render.
- Cada evento discreto de Market/Transfer/Loan se despacha por su propio
  ITEM, en su fecha — nunca con un barrido de "todo lo vencido" después de
  saltar a un partido posterior. Un fallo de resolución deja el item
  `failed` en la cola y no adelanta el cursor por encima de él.
- Un item del calendario guarda SOLO ids, instantes y metadatos
  serializables: el resultado/estado real vive en `CompetitionEngine`/
  `MarketRegistry`/`TransferRegistry`/`LoanRegistry`. El calendario es la
  autoridad del ORDEN y del CURSOR, nunca una segunda base de datos.
- Una fecha CIVIL sigue siendo fecha civil: se ordena al inicio de su día
  en el huso declarado (así un plazo que vence el día del partido bloquea
  antes del partido) y nunca se le persiste una hora inventada.
- Límites de alcance: accesos/ascensos/plazas declarativos son PATHWAYS-1;
  niveles de detalle y simulación del exterior, WORLD-SIM-1; navegación
  mundial y selector de ligas, WORLD-UI-1; retirada final de puentes y
  persistencia, WORLD-HARDEN-1. Reprogramaciones, aplazamientos y
  resolución AUTOMÁTICA de conflictos horarios no están decididas: hay que
  proponerlas antes.
- **SIM-CAL-1**: la ejecución de "Continuar" en el navegador es cooperativa
  y cancelable de forma segura (avance por slices, overlay, cancelación),
  pero usa EXACTAMENTE el mismo algoritmo/orden descrito arriba — ningún
  invariante de esta ficha cambió. Contrato de ejecución completo:
  `docs/architecture/simulation-advance.md`.
- Los puentes legacy que quedan (`Calendar.js`/`CONFIG_BASE.calendar` como
  shim del "modo prueba", `getLeague(division)`/`getBrackets(division)`
  como vista derivada de las pantallas españolas) NO autorizan ningún
  call-site nuevo: se consultan solo desde donde ya estaban y tienen su
  propietario de retirada declarado en DESIGN.md 10.8. (`UI_COMPETITION_KEY_BY_STAGE_KEY`,
  vivo cuando se escribió este párrafo, queda retirado desde
  WORLD-CLEANUP-1 — ver DESIGN.md 10.21.)
