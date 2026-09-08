# Ficha de Epic — WORLD-CALENDAR-1 (cronología mundial única)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `WORLD-CALENDAR-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Cronología mundial única, calendario como contenido versionado.
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/world-calendar.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 8677-8916 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.14 WORLD-CALENDAR-1 — resultado

Cuarta entrega de la EPIC. La identidad del torneo ya era mundial desde
COMP-CORE-1; **el tiempo no lo era**. Esta entrega sustituye la
orquestación "jornada visible + una jornada de la otra división + drenar
los brackets" por una **cronología mundial única**: cada partido de
cualquier Edition/Stage activa y cada evento fechado que ya modelan
Market/Transfer/Loan se resuelven en su instante real, y el juego solo se
detiene cuando el usuario debe actuar de verdad.

#### 10.14.1 Modelo temporal canónico

- `src/utils/GameDateTime.js` — utilidad PURA, separada de `LocalDate`:
  - `LocalDate` sigue siendo la FECHA CIVIL `YYYY-MM-DD` sin hora (plazos
    contractuales, ventanas, inscripciones: CONTRACT-1..CYCLE-1);
  - `GameDateTime` es el INSTANTE exacto, ISO 8601 UTC terminado en `Z`, y
    toda conversión a/desde componentes civiles exige un `timeZoneId`
    **IANA explícito** (vía `Intl.DateTimeFormat`, sin dependencias);
  - `addLocalDays` suma DÍAS DE CALENDARIO en el huso declarado, no `24h`
    ciegas: el día del cambio horario tiene 23 o 25 horas reales;
  - `startOfLocalDay(localDate, tz)` es la frontera que permite ORDENAR un
    evento de fecha civil frente a un partido del mismo día sin inventarle
    una hora.
- Los descriptores de partido tienen como AUTORIDAD `scheduledAt` +
  `timeZoneId` (+ `scheduledLocalDate`/`scheduledLocalTime` de
  trazabilidad). `scheduledDate` (`Date`) sobrevive como **vista de
  compatibilidad derivada**, nunca como segunda fuente; los snapshots
  serializan strings.
- `WorldCalendar` conserva getters legacy (`currentGameDateTime`,
  `seasonStartDate`) para la interfaz y para Recovery/Training/Development,
  pero su autoridad interna es `currentInstant` y las fechas civiles se
  obtienen SIEMPRE con el huso declarado.

#### 10.14.2 Calendarios como contenido versionado

- `CompetitionScheduleDefinition` (`src/entities/CompetitionSchedule.js`):
  inmutable, serializable, con `id`, `version`, `status`, `timeZoneId`,
  ancla civil de temporada, planes por `stageKey`, estrategia y parámetros
  planos por plan, y procedencia HONESTA (`simulated/design`, "no es el
  calendario oficial de la competición").
- `CompetitionScheduleCatalog` (`src/core/CompetitionScheduleCatalog.js`):
  mismo contrato que `CompetitionFormatCatalog` — idempotente para la misma
  id+version, error descriptivo ante otra versión o contenido distinto,
  `requireSchedule()` FALLA ante un id desconocido (nunca hereda otro
  perfil), listado ordenado por id.
- `CompetitionScheduleService` (`src/core/CompetitionScheduleService.js`):
  ÚNICO sitio que sabe programar fechas. Dos estrategias, deliberadamente
  no un DSL universal:
  1. `round-robin-cadence` — ancla, días entre jornadas, slots ponderados
     deterministas (mismo hash FNV-1a que el `Calendar.js` histórico),
     jornada intersemanal con rondas excluidas, franja unificada de última
     jornada;
  2. `bracket-offsets` — ancla como referencia PLANA a un plan de
     round-robin (de la misma definición o de otra: así la Copa ancla en la
     jornada 17 de la Liga sin que el scheduler sepa qué es ACB), con
     política `series-cadence` (offsets por duración máxima de ronda) o
     `compressed-window` (ventana fija entre dos jornadas con colchón
     mínimo, la regla dura de 3.3.2), `roundIndexOffset` para fases que
     comparten tramo (Final Four de ascenso) y hora de inicio.
- `buildDateResolverProvider()` es el proveedor GENÉRICO que recibe
  `CompetitionEngine.setDateResolverProvider()`: resuelve el calendario
  desde `edition.scheduleProfileId` + `template.key`, sin ramificar por
  competición, país, división ni nombre visible.

**Migración de `spain-2026.1`**: los perfiles de Liga ACB y Primera FEB
(slots ponderados, jornada intersemanal, exclusiones de la semana de Copa),
la ventana de Copa respecto a la jornada 17 y los arranques/separaciones de
playoff por el título y de cuartos + Final Four de ascenso pasan a ser
contenido de ese paquete **sin recalibrar ningún número**. Ids estables
`spain-2026.1:schedule:1a`/`:2a`, más `spain-2026.1:schedule:copa-acb`
nuevo y explícito: la Copa tiene runtime fechado, así que ya no puede
quedar con `scheduleProfileId: null`, y la regla de activación cruzada
transporta ese id (y su ruleset) como dato plano para que la Edition nueva
lo congele. El resultado observable es EL MISMO que antes: 637 fechas
comparadas contra `Calendar.js` con `TZ=Europe/Madrid`, 0 diferencias.

#### 10.14.3 `WorldCalendar` y modelo de item

`src/core/WorldCalendar.js` — agregado EXPLÍCITO por carrera (nunca
singleton): id + versión de esquema, `defaultTimeZoneId` aportado por la
composición (el core nunca asume un país), `currentInstant` monotónico,
temporadas registradas, índice de items pendientes por id estable, ledger
ACOTADO de lo resuelto (para Agenda/diagnóstico, sin duplicar resultados),
`validateIntegrity()` y `snapshot()` planos.

`WorldCalendarItem` normaliza una REFERENCIA a un hecho ajeno: id estable
(`sourceType + sourceId`, nunca un contador global), fuente propietaria,
momento con precisión EXPLÍCITA (`instant` con huso, o `date` civil con
huso), `status` proyectado, `attentionScope` con `teamIds`/`clubIds` (solo
ids, nunca copias de `Team`/`Club`), ids de competición/edición/fase/
participantes y metadatos mínimos serializables. **No guarda resultados,
rosters, instancias ni funciones**: el calendario es la autoridad del ORDEN
y del CURSOR, no una segunda base de datos del dominio.

#### 10.14.4 Fuentes y coordinador

`src/core/WorldCalendarCoordinator.js` — protocolo de fuentes (listar
pendientes como objetos planos; resolver UN item delegando en su servicio
real) y coordinador con dependencias EXPLÍCITAS (nunca lee `state`, DOM,
`Date.now()`, `Math.random()` ni globals).

| Fuente | Extrae de | Comportamiento |
|---|---|---|
| `competition-match` | `CompetitionEngine.listAllPendingMatches()` | partido exacto por stage/match id |
| `market-event` | `MarketRegistry.allScheduledEvents()` no procesados | automático, o parada si `requiresAttention` y es del club del usuario |
| `transfer-event` | `TransferRegistry` (`scheduled` con fecha efectiva) | ejecuta el evento futuro ya modelado |
| `loan-event` | `LoanRegistry` (cesión activa con `returnEffectiveDate`) | ejecuta el retorno ya modelado |

Ninguna regla de esos dominios se reimplementa: el coordinador ordena
referencias y delega el commit en `MarketService`/`TransferService`/
`LoanService`/`CompetitionEngine`.

**Cambios mínimos en COMP-CORE**: el engine lista de forma PURA todos los
partidos materializados pendientes de todos sus runners con orden total
estable (instante, id); el bracket expone el siguiente descriptor pendiente
de **cada serie viva** de la ronda (antes solo el primer cruce del array);
`resolveMatch()` materializa explícitamente el siguiente partido de su
serie, así que consultar después no crea objetos ni avanza rondas;
`allStageIds()` y los agregados se ordenan por id, nunca por inserción de
`Map`; la doble resolución sigue rechazada. `League`/`Bracket` pasan a ser
vistas totalmente DERIVADAS del runner (getters), para poder construirse
bajo demanda desde un `stageId` real.

#### 10.14.5 Semántica exacta de "Continuar"

`advanceUntilNextUserStop()`:

1. sincroniza explícitamente las fuentes;
2. toma el grupo temporal más antiguo pendiente;
3. si no contiene ninguna atención del usuario: avanza el reloj a ese
   instante, resuelve sus items en orden estable por id y vuelve al paso 1;
4. si contiene una atención del usuario: avanza HASTA ella y **no la
   resuelve**;
5. devuelve un objeto de parada que la interfaz presenta tal cual.

Tipos de parada: `user-match`, `market-attention`, `schedule-conflict`,
`season-complete` y `resolution-failed`.

**Simultaneidad**: antes de un `user-match` solo se resuelven items
ESTRICTAMENTE anteriores; los CPU del mismo instante quedan pendientes a
propósito (no se revelan antes) y se resuelven tras el commit del usuario
con `resolveSimultaneousAfterUserCommit(instant)`, **sin** mover el cursor
más allá de ese instante. Dos partidos del mismo equipo controlado a la
misma hora devuelven un conflicto visible con los dos ids/competiciones: no
se elige por id, no se simula ninguno y no se inventa reprogramación
(aplazamientos quedan fuera de alcance). Un error de resolución deja el
item `failed`, en la cola, y el cursor no lo salta.

El hook de avance continuo (`applyClockAdvanceHook`) mantiene desarrollo,
entrenamiento CPU y progresión médica; los eventos DISCRETOS de
Market/Transfer/Loan se despachan uno a uno desde sus items, no con un
barrido `eventsDueThrough()` posterior al salto.

#### 10.14.6 Bugs corregidos

- **`BUG-WORLDCALENDAR-01`** — el fondo adelantaba el reloj por encima del
  usuario: `simulateBackgroundRound()` jugaba una jornada de la otra
  división y `drainBackgroundBrackets()` consumía su bracket COMPLETO, así
  que el reloj podía llegar a la final de ascenso antes de que el usuario
  disputara su propio playoff, y después se jugaban partidos "en el
  pasado". Corregido con la cola mundial: cada partido se resuelve cuando
  toca y el cursor solo avanza al instante del grupo que se va a resolver.
- **`BUG-WORLDCALENDAR-02`** — una eliminatoria ajena era parada manual:
  `getActiveBracket()` devolvía el siguiente partido de cualquier bracket
  de la división visible (con prioridad fija Copa > título > ascenso),
  aunque el equipo del usuario no participara o ya estuviera eliminado.
  Corregido: solo un partido que incluya un `teamId` controlado es parada;
  el resto se resuelve de fondo en su instante, sea Liga, Copa o playoff.
- **`BUG-WORLDCALENDAR-03`** — el calendario dependía del huso del
  ordenador: `Calendar.js` construía con `new Date(year, month, day)` y
  mutaba con `setDate`/`setHours`, así que el mismo partido de 2026 daba
  instantes distintos con `TZ=UTC`, `Europe/Madrid` o `America/New_York`.
  Corregido: instante canónico UTC + huso IANA como dato del perfil;
  además la fecha civil del "ahora" (`currentGameIsoDate()`) se deriva del
  huso declarado y no de `LocalDate.fromJsDate(state.calendar...)`.
- **`BUG-WORLDCALENDAR-04`** — Agenda no cumplía su contrato de mercado: el
  comentario de `pushMarketAgenda()` afirmaba que `buildAgendaEvents()`
  incorporaba los eventos futuros de `marketRegistry.allScheduledEvents()`,
  y la función no los leía ni añadía `state.marketAgendaLog`. Corregido:
  Agenda proyecta los partidos del usuario de TODAS sus competiciones desde
  la cronología, los eventos futuros de mercado/traspaso/cesión de su club
  y el log histórico, sin duplicados.

Dos defectos adicionales encontrados por las pruebas de esta entrega y
corregidos aquí: el cursor de una carrera debe arrancar en el BORDE de la
ventana de temporada (`seasonWindowStartInstant`, el ancla desplazada al
`dayOffset` más temprano que declara el contenido) y no en el ancla, porque
la jornada 1 tiene partidos en viernes; y `Bracket.rounds` debe
sincronizarse al LEERSE, porque una fachada construida bajo demanda solo
veía la primera ronda y el histórico de temporada perdía semifinales y
final.

#### 10.14.7 Pruebas de esta entrega

Batería DIRIGIDA (nada de Playwright, matrices históricas completas ni
simulaciones de varias temporadas):

- `node scripts/test-world-calendar1.js` — 25 checks: `GameDateTime` y
  frontera DST, misma instantánea bajo tres `TZ` del proceso y equivalencia
  exacta con `Calendar.js`, definición/catálogo/versionado/serialización de
  schedule, item estable y orden total independiente de inserción, cursor
  monotónico y temporadas encadenadas, dos competiciones ficticias
  simultáneas sin España, CPU anterior automático + partido del usuario como
  parada + simultáneos después, conflicto de dos partidos del usuario, fecha
  civil antes del partido del mismo día, error de resolución sin salto,
  bracket con un pendiente por serie sin mutar al consultar, una sola
  instancia de calendario entre dos temporadas, y auditorías estáticas
  (literales españoles en módulos genéricos; jornada de fondo/drenaje/
  `new Calendar` en la ruta productiva).
- `node scripts/smoke-world-calendar1.js` — 36 equipos reales, UNA temporada
  + UNA transición: 661 partidos resueltos por la cola, 37 paradas (todas
  del equipo controlado), Copa en el hueco real entre las jornadas 17 y 18
  en 3 fechas distintas, playoff por el título y de ascenso entrelazados,
  orden estrictamente cronológico, misma instancia de calendario tras el
  ciclo anual, MoraBanc andorrano y Supercopa sin runtime.
- Única regresión anterior autorizada: `node scripts/test-comp-core1.js`.

#### 10.14.8 Fuera de alcance de esta entrega

Pathways/ascenso-descenso declarativos y plazas continentales
(**PATHWAYS-1**); niveles `full/standard/abstract` y simulación del
exterior (**WORLD-SIM-1**); selecciones (**NATIONAL-TEAMS-1**);
navegación mundial y selector de ligas/nivel de detalle (**WORLD-UI-1**);
retirada final de puentes y frontera de persistencia
(**WORLD-HARDEN-1**). Tampoco entran: calendarios oficiales reales,
reprogramaciones/aplazamientos/viajes/pabellones, resolución AUTOMÁTICA de
conflictos horarios (solo detección y bloqueo), cambios de reglas
ACB/FEB/contrato/inscripción/tanteo/traspaso/cesión/cantera/economía,
traspasos o cesiones CPU-a-CPU orgánicos, competiciones nuevas, SQL/
save-load/backend/dependencias, tocar `data/real/*`, y la limpieza completa
de los textos/nombres legacy `division` fuera de la orquestación temporal.

**Actualización PATHWAYS-1 (ver 10.15):** los stages/Editions que activa
`CompetitionPathwayService` (title-playoff, Copa, cuartos y Final Four de
ascenso, las Editions de la temporada siguiente) entran en la cola mundial
por el MISMO mecanismo que cualquier otra activación del engine —
`WorldCalendarCoordinator.sync()` los descubre en cuanto se registran, sin
ruta paralela. El calendario sigue sin saber POR QUÉ una fase se activó;
solo ordena lo que ya existe.

_Migrado de `CHANGELOG.md` (líneas 1185-1427 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-06 — WORLD-CALENDAR-1: cronología mundial única (DESIGN.md sección 10.14)

Cuarta entrega de la EPIC **World Architecture** (WORLD-CORE-1 →
CLUB-CORE-1 → COMP-CORE-1 → **WORLD-CALENDAR-1** → PATHWAYS-1 →
WORLD-SIM-1 → NATIONAL-TEAMS-1 → WORLD-UI-1 → WORLD-HARDEN-1). Base:
`c445587b4cf03e1ebba49e1b5eff8ff47423cb91` (`origin/main`, merge de la PR
#48 COMP-CORE-1). Rama `claude/modest-gauss-ab8bat`.

COMP-CORE-1 hizo mundial la IDENTIDAD del torneo; el TIEMPO seguía siendo
el de antes: una "jornada visible" del usuario, una jornada de "la otra
división" simulada por bloques detrás de ella, y las eliminatorias de fondo
drenadas de golpe. Esta entrega sustituye todo eso por una **cola
cronológica única**: cada partido de cualquier Edition/Stage activa y cada
evento fechado que ya modelan Market/Transfer/Loan se resuelven en su
instante real, y el juego solo se detiene cuando el usuario debe actuar.

### Bugs corregidos

- **`BUG-WORLDCALENDAR-01`** — el fondo adelantaba el reloj por encima del
  usuario. *Causa*: `simulateBackgroundRound()` jugaba una jornada completa
  de la otra división tras cada jornada visible y `drainBackgroundBrackets()`
  consumía su bracket ENTERO en el mismo paso; al terminar las ligas, el
  reloj podía llegar a la final de ascenso/título de fondo antes de que el
  usuario disputara su propio playoff, y después se resolvían partidos con
  fecha anterior al "ahora" ya alcanzado (con desarrollo, contratos y
  retornos ya procesados en el futuro). *Corrección*: las dos funciones
  desaparecen; `WorldCalendarCoordinator` resuelve el grupo temporal más
  antiguo pendiente y avanza el cursor SOLO hasta ese instante. Verificado
  en el smoke: los 661 partidos de la temporada se resuelven en orden
  estrictamente cronológico y ninguno queda detrás del cursor (aserción por
  partido, más `WorldCalendar.validateIntegrity()`).
- **`BUG-WORLDCALENDAR-02`** — una eliminatoria ajena se convertía en parada
  manual. *Causa*: `getActiveBracket()` devolvía el siguiente partido de
  cualquier bracket de la división visible, con prioridad fija `Copa >
  playoff por el título > playoff de ascenso` (ignorando su fecha real),
  aunque el equipo del usuario no participara o ya estuviera eliminado —
  obligaba a pulsar "Continuar" y abría contexto de alineación para un
  cruce CPU contra CPU. *Corrección*: solo un partido que incluya un
  `teamId` controlado es parada (`coordinator.requiresUser`); el resto se
  resuelve de fondo en su instante, sea Liga, Copa o playoff.
  `getActiveBracket()` sobrevive como vista de compatibilidad DERIVADA del
  próximo partido del usuario por FECHA. Verificado: en el smoke las 37
  paradas coinciden EXACTAMENTE con los 37 partidos del equipo controlado,
  y en la batería dirigida una carrera sin equipo controlado llega a
  `season-complete` sin pedir nada.
- **`BUG-WORLDCALENDAR-03`** — el calendario dependía del huso del
  ordenador. *Causa*: `Calendar.js` construía con `new Date(year, month,
  day)` y mutaba con `setDate`/`setHours`, así que el MISMO partido de 2026
  producía instantes distintos con `TZ=UTC`, `Europe/Madrid` o
  `America/New_York` (comprobado: 18:00Z / 19:00Z / 23:00Z para el mismo
  encuentro); `currentGameIsoDate()` derivaba además la fecha civil del
  "ahora" con `LocalDate.fromJsDate(state.calendar.currentGameDateTime)`,
  arrastrando el desfase a todos los plazos de ese día. *Corrección*:
  `src/utils/GameDateTime.js` (instante ISO UTC + huso IANA explícito), el
  huso como dato del perfil de calendario, y la fecha civil del "ahora"
  desde `calendar.currentLocalDate`. Verificado: la batería ejecuta el
  mismo cálculo en tres subprocesos con `TZ=UTC`, `Europe/Madrid` y
  `Asia/Tokyo` y exige salida IDÉNTICA.
- **`BUG-WORLDCALENDAR-04`** — Agenda no cumplía su contrato de mercado.
  *Causa*: el comentario de `pushMarketAgenda()` afirmaba que
  `buildAgendaEvents()` incorporaba los eventos futuros de
  `marketRegistry.allScheduledEvents()`, y la función no los leía ni añadía
  `state.marketAgendaLog`; además proyectaba el siguiente partido de una
  serie con `series.dateResolver`, un campo que la vista legacy de
  `Bracket` nunca ha expuesto (rama muerta: ningún partido de eliminatoria
  futuro llegaba a Agenda). *Corrección*: Agenda es una PROYECCIÓN de la
  cronología — partidos del usuario de TODAS sus competiciones (pendientes
  y jugados), eventos futuros de mercado/traspaso/cesión de su club leídos
  de la misma cola, y `marketAgendaLog` histórico, todo sin duplicados y
  con las fechas civiles normalizadas al inicio de su día en el huso
  declarado.

Dos defectos adicionales encontrados por las pruebas de esta entrega y
corregidos aquí: el cursor de una carrera arranca en el BORDE de la ventana
de temporada (`seasonWindowStartInstant`, el ancla desplazada al `dayOffset`
más temprano que declara el contenido) y no en el ancla, porque la jornada 1
tiene partidos en viernes que quedaban detrás del cursor desde el minuto
cero; y `Bracket.rounds` se sincroniza al LEERSE, porque una fachada
construida bajo demanda solo veía la primera ronda y el histórico de
temporada perdía semifinales y final.

### Modelo temporal y calendarios como contenido

- `src/utils/GameDateTime.js`: utilidad PURA separada de `LocalDate` —
  instantes ISO UTC, `fromZonedParts`/`toZonedParts`/`localDateAt`/
  `startOfLocalDay`/`addLocalDays` (días de CALENDARIO en el huso
  declarado, no 24h ciegas), `toJsDate` como única frontera legacy.
  Sin dependencias: `Intl.DateTimeFormat` para el desplazamiento real.
- `src/entities/CompetitionSchedule.js` + `src/core/CompetitionScheduleCatalog.js`:
  `CompetitionScheduleDefinition` inmutable/versionada/serializable con
  `timeZoneId`, ancla civil de temporada, planes por `stageKey`, estrategia
  y parámetros planos, y procedencia honesta (`isReal: false`, "no es el
  calendario oficial"). Catálogo con el mismo contrato que
  `CompetitionFormatCatalog`: idempotente por id+version, error ante otra
  versión o contenido distinto, `requireSchedule()` falla ante id
  desconocido.
- `src/core/CompetitionScheduleService.js`: ÚNICO sitio que programa
  fechas. Dos estrategias — `round-robin-cadence` y `bracket-offsets` (con
  política `series-cadence` o `compressed-window`, ancla como referencia
  PLANA a un plan de otra definición). `buildDateResolverProvider()` es el
  proveedor genérico del engine, resuelto desde `edition.scheduleProfileId`
  + `template.key`, sin ninguna rama por competición.
- `data/world/spain-2026.1.js`: los perfiles `1a`/`2a`, la ventana de Copa
  respecto a la jornada 17 y los arranques de playoff/ascenso pasan a ser
  contenido de este paquete **sin recalibrar ningún número**. Ids estables
  `spain-2026.1:schedule:1a`/`:2a` y el nuevo `:copa-acb`, congelado en la
  Edition de Copa (que ya no puede tener `scheduleProfileId: null`) y
  transportado por la regla de activación cruzada. Resultado observable
  idéntico: **637 fechas comparadas contra `Calendar.js`, 0 diferencias**.

### Cola mundial, fuentes y "Continuar"

- `src/core/WorldCalendar.js`: agregado por carrera con cursor monotónico,
  temporadas registradas, índice de items por id estable
  (`sourceType + sourceId`), ledger ACOTADO, `validateIntegrity()` (detecta
  pendientes detrás del cursor) y `snapshot()` plano. Un item guarda SOLO
  ids/instantes/metadatos: el estado real sigue en su fuente propietaria.
- `src/core/WorldCalendarCoordinator.js`: cuatro fuentes
  (`competition-match`, `market-event`, `transfer-event`, `loan-event`) y
  `advanceUntilNextUserStop()` con paradas `user-match`,
  `market-attention`, `schedule-conflict`, `season-complete` y
  `resolution-failed`. Simultaneidad: antes de un `user-match` solo se
  resuelve lo ESTRICTAMENTE anterior; los CPU del mismo instante se
  resuelven DESPUÉS del commit del usuario sin mover el cursor; dos
  partidos simultáneos del equipo controlado devuelven conflicto explícito
  con los dos ids/competiciones y bloquean Continuar.
- COMP-CORE mínimo: `scheduledAt`/`timeZoneId` como autoridad del
  descriptor, `listAllPendingMatches()` con orden total estable, un
  pendiente por CADA serie viva del bracket, materialización del siguiente
  partido de la serie en `resolveMatch()` (consultar ya no muta),
  `allStageIds()` ordenado por id, `League`/`Bracket` como vistas
  totalmente derivadas del runner.

### Migración de `game.js` y puentes restantes

Retirados de la autoridad productiva: `getBackgroundDivision()`,
`getBackgroundLeague()`, `simulateBackgroundRound()`,
`drainBackgroundBrackets()`, `simulateNextRound()`,
`finishRoundBookkeeping()`, `resolvePreUserMatches()`,
`pushLeagueMatchNews()`, `playBracketGameWithReveal()`,
`findSeriesForGame()`, la prioridad fija de `getActiveBracket()`,
`state.leagues`/`state.brackets` como mapas fijos, y el
`new Calendar(...)` de cada cierre de temporada. `advanceGameClockTo()`
queda partido en dos: hook de avance continuo (desarrollo/entrenamiento/
médico) y despacho DISCRETO de cada evento de Market/Transfer/Loan desde su
item. La ruta de commit de un partido se unifica en
`buildMatchEngineOptionsForDescriptor()` (sustituye a los tres resolvers
anteriores), con `precomputedResult` sobre el MISMO descriptor para el
partido en vivo del usuario. `activeCompetitionEditionId`/`activeStageId`
pasan a llamarse `uiFocusCompetitionEditionId`/`uiFocusStageId`: son foco
de pantalla, no autoridad.

Puentes que PERMANECEN, con propietario de retirada (DESIGN.md 10.8):
`Calendar.js` + `CONFIG_BASE.calendar.scheduleProfiles` como shim del "modo
prueba" técnico de `index.html` y de scripts standalone (WORLD-HARDEN-1);
`getLeague(division)`/`getBrackets(division)` y `state.division` como
filtro VISUAL de las pantallas españolas (WORLD-UI-1);
`UI_COMPETITION_KEY_BY_STAGE_KEY` (WORLD-UI-1/PATHWAYS-1); el cierre
deportivo español de `SeasonHistoryService` (PATHWAYS-1). Ninguno autoriza
call-sites nuevos.

Consecuencia declarada: `scripts/verify-*-playwright.js` usaban
`simulateBackgroundRound`/`drainBackgroundBrackets` para avanzar una
carrera sin reveals y necesitan migrarse a
`advanceWorldUntilNextUserStop()`. No se han tocado ni ejecutado (el
presupuesto de pruebas de esta entrega prohíbe Playwright).

### Transición anual persistente

El MISMO `WorldCalendar` atraviesa el verano: `closeSeasonAndPrepareNext()`
ya no crea otro calendario — registra la temporada siguiente en el mismo
agregado, avanza el cursor común en cada fase FECHADA de
`AnnualCycleService` antes de ejecutar su hook, retira el ledger, vuelve a
enlazar los schedules de la temporada nueva y resincroniza las fuentes.
Tras la transición: `state.calendar === state.world.calendar` y es la MISMA
referencia anterior, el calendario tiene las dos temporadas registradas y
el primer evento de la nueva es posterior al último de la anterior.

### Pruebas ejecutadas y resultado REAL

```
node scripts/test-world-calendar1.js   -> 25 OK, 0 FAIL
node scripts/smoke-world-calendar1.js  -> SMOKE TEST WORLD-CALENDAR-1: OK
                                          (36 clubes, 1 temporada completa por la
                                          cola mundial + 1 transición anual, 7.1s)
node scripts/test-comp-core1.js        -> 32 OK, 0 FAIL   (única regresión autorizada)
node --check <cada JS nuevo/modificado> -> sin errores
git diff --check                        -> limpio
```

Datos reales del smoke: 612 partidos materializados con `scheduledAt` UTC +
`timeZoneId`, 661 partidos resueltos (ACB + Primera FEB + Copa + los dos
playoffs), 37 paradas —todas del equipo controlado—, 105 avances de reloj,
72 alternancias de competición en la cola, Copa jugada en el hueco real
entre las jornadas 17 y 18 en 3 fechas distintas, playoff por el título
(24 partidos) y de ascenso (18) entrelazados.

No se ejecutó Playwright, ni ninguna simulación de tres o diez temporadas,
ni el resto de la matriz histórica (presupuesto vinculante de la sección 17
del prompt).

### Archivos principales

Nuevos: `src/utils/GameDateTime.js`, `src/entities/CompetitionSchedule.js`,
`src/core/CompetitionScheduleCatalog.js`,
`src/core/CompetitionScheduleService.js`, `src/core/WorldCalendar.js`,
`src/core/WorldCalendarCoordinator.js`,
`scripts/test-world-calendar1.js`, `scripts/smoke-world-calendar1.js`.

Modificados: `src/ui/game.js`, `data/world/spain-2026.1.js`,
`src/core/CompetitionEngine.js`, `src/core/CompetitionRunners.js`,
`src/core/CompetitionRuntimeRegistry.js`, `src/core/CompetitionCatalog.js`,
`src/core/League.js`, `src/core/Bracket.js`, `src/entities/World.js`,
`index.html`, `DESIGN.md`, `CLAUDE.md`, `CHANGELOG.md`.

### Fuera de alcance (declarado, no implementado)

PATHWAYS genéricos/ascensos reescritos/plazas continentales (PATHWAYS-1);
niveles `full/standard/abstract` y simulación del exterior (WORLD-SIM-1);
selecciones (NATIONAL-TEAMS-1); navegación mundial (WORLD-UI-1); retirada
final de puentes y persistencia (WORLD-HARDEN-1). Tampoco: calendarios
oficiales reales, reprogramaciones/aplazamientos/viajes/pabellones,
resolución AUTOMÁTICA de conflictos horarios (solo detección y bloqueo),
competiciones nuevas, cambios de reglas ACB/FEB/contrato/inscripción/
tanteo/traspaso/cesión/cantera/economía, traspasos o cesiones CPU-a-CPU
orgánicos, SQL/save-load/backend/dependencias, y la limpieza completa de
los textos/nombres legacy `division` fuera de la orquestación temporal.

### Confirmaciones

- `data/real/*` NO se ha modificado (ningún archivo de esa carpeta aparece
  en el diff).
- No se ha añadido SQL, IndexedDB, repositorio de persistencia, save/load,
  backend, framework ni ninguna dependencia externa (sigue siendo
  JavaScript/HTML/CSS puro, monolito modular).
- No se ha añadido ninguna competición real nueva: ACB, Primera FEB y Copa
  siguen siendo las mismas; Supercopa sigue `catalog-only` sin Edition ni
  runtime.
- La PR queda ABIERTA contra `main`, sin merge ni auto-merge, para que
  Dennis revise y fusione a mano.

Siguiente entrega: **PATHWAYS-1**.
