# Competiciones — vertical española (Liga, Copa, Playoffs, Ascenso)

_Migrado de `DESIGN.md` (líneas 61-758 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 3. Estructura de competición (primer hito)

**Nota de arquitectura (WORLD-CORE-1/COMP-CORE-1, ver sección 10):** esta
sección describe la **vertical española** tal cual está construida y
jugable hoy — el comportamiento deportivo observable (calendario,
clasificación, desempate, Copa en jornada 17, playoffs) no ha cambiado.
Lo que SÍ cambió en COMP-CORE-1 (ver 10.13) es QUIÉN lo ejecuta: ya no
son runners fijos españoles (`League`/`Bracket`/`Cup`/`Playoffs`/
`Promotion` como autoridad) sino un motor GENÉRICO
(`RoundRobinStageRunner`/`BracketStageRunner`, orquestados por
`CompetitionEngine`) configurado por el `CompetitionFormatDefinition` que
declara `data/world/spain-2026.1.js` — esos cinco archivos sobreviven
solo como fachadas finas/shim histórico (10.8). Esa vertical vive detrás
de identidad mundial genérica (`CompetitionDefinition`/
`CompetitionEdition`/`CompetitionStage`/`CompetitionEntry`, sección 10) y
de un paquete de contenido (`spain-2026.1`): "1ª división" y "2ª división"
son el `legacyDivision` de ACB/Primera FEB, no una estructura universal
del motor.
Cualquier liga/país nuevo se añade como paquete de contenido y como
`CompetitionDefinition` propia — nunca como una tercera "división" aquí.

- **1ª división** (18 equipos, estructura tipo ACB) + **2ª división**
  (18 equipos, estructura tipo Primera FEB / LEB Oro), cada una con
  calendario completo ida y vuelta.

### 3.1 Liga y Calendario

- **Generación de calendario**: algoritmo del círculo (round-robin
  estándar) para 18 equipos → 34 jornadas (17 de ida + 17 de vuelta),
  cada equipo juega exactamente una vez por jornada.
- **Puntuación real FIBA/ACB**: 2 puntos por victoria, 1 punto por
  derrota (no hay "puntos por participar" ni sistema 3-1-0 de fútbol).
- **Simulación por jornada completa**: la entidad Liga puede simular
  todos los partidos de una jornada de golpe (reutilizando el motor de
  partidos ya existente), no solo partido a partido.
- **Criterio de desempate en la clasificación** (normativa real ACB,
  artículo de desempates): para dos equipos empatados a puntos, en
  orden:
  1. Balance de victorias-derrotas en los partidos jugados **entre
     ellos**.
  2. Diferencia de puntos en esos enfrentamientos directos ("basket
     average particular").
  3. Diferencia de puntos **general** de toda la liga regular.
  4. Puntos anotados en toda la liga regular.
  5. Suma de cocientes de tantos a favor y en contra de toda la liga.
  Para empates de **3 o más equipos**: se resuelve como una "mini-liga"
  entre solo los equipos empatados (pasos 1-2 restringidos a sus
  enfrentamientos mutuos); si el empate se resuelve solo parcialmente
  (un subgrupo sigue empatado), se repite el proceso completo desde el
  paso 1 para ese subgrupo restante.

**Estado: implementado y en producción** para 1ª y 2ª división. Desde
COMP-CORE-1 (DESIGN.md 10.13), lo ejecuta el motor GENÉRICO
(`RoundRobinStageRunner`, orquestado por `CompetitionEngine`) configurado
por el `CompetitionFormatDefinition` que declara `data/world/
spain-2026.1.js` — `src/core/League.js` sigue existiendo como fachada
fina sobre ese mismo runner (mismo algoritmo, nunca duplicado), usada por
`game.js` y por scripts/tests históricos que la construyen de forma
standalone. 2ª división usa hoy una plantilla de 18 equipos ficticios
como infraestructura mínima para alimentar el playoff de ascenso (3.2.3)
— no es todavía un modo de juego completo por sí mismo con datos reales
propios, ver 3.2.3.

### 3.2 Playoffs, Copa y Playoff de ascenso

**Estado: implementado y en producción**, reutilizando `MatchEngine.js`
sin ninguna modificación. Desde COMP-CORE-1 (DESIGN.md 10.13), lo ejecuta
el motor GENÉRICO (`BracketStageRunner`) configurado por el mismo
`CompetitionFormatDefinition` español — `src/core/Bracket.js`/
`Playoffs.js`/`Cup.js`/`Promotion.js` sobreviven como fachadas finas sobre
ese runner (mismo algoritmo, nunca duplicado), usadas por scripts/tests
históricos que las construyen de forma standalone (game.js ya no las
construye directamente en la ruta productiva). Esta sección documenta el
sistema tal como quedó construido — sustituye
por completo cualquier redacción anterior de este apartado que lo
describiera como pendiente.

**Actualización PATHWAYS-1 (ver 10.15):** los números de esta sección
(top-8, jornada 17, 2º-9º, reseed best-vs-worst) siguen siendo la norma
vigente, pero YA NO viven en `activation`/`entrySource` del
`CompetitionFormatDefinition` — el formato solo declara que la fase EXISTE
y CÓMO se disputa (cuadro, patrón de campo); QUIÉN la alcanza y CUÁNDO lo
decide el pathway doméstico español (`spain-2026.1:pathway:domestic-club-v1`),
con receipt propio por regla.

#### 3.2.1 Pieza base: `Bracket`/`Series`

Toda eliminatoria del juego (Copa, Playoff por el título, Playoff de
ascenso) se construye sobre la misma pieza genérica:

- **`Series`**: eliminatoria al mejor de N partidos entre dos equipos,
  con un patrón de campo configurable (partido único, al mejor de 3
  con patrón 1-1-1, al mejor de 5 con patrón 2-2-1). Cada partido se
  simula de verdad con el motor de partidos (nunca en bloque).
- **`Bracket`**: encadena rondas de `Series` a partir de un conjunto de
  entradas semilladas y un emparejamiento de primera ronda, con avance
  **fijo** entre rondas — nunca se reordena por resultado (el 1º y el
  2º clasificados solo pueden llegar a cruzarse en la final, igual que
  en el playoff real de ACB). Cada entrada conserva su seed original de
  principio a fin, así que la ventaja de campo en cualquier ronda
  siempre recae en el mejor clasificado real de la liga regular,
  independientemente de qué lado del bracket venga el rival.

#### 3.2.2 Playoff por el título (1ª división)

- Participan los **8 primeros** de la liga regular de 1ª división al
  terminar la temporada (34 jornadas).
- Bracket fijo, orden estándar 1v8 / 4v5 / 2v7 / 3v6 (1º y 2º solo se
  cruzan en la final).
- **Cuartos de final**: al mejor de 3 (patrón de campo 1-1-1).
- **Semifinales y final**: al mejor de 5 (patrón de campo 2-2-1).
- **2ª división NO tiene playoff por el título**: el campeón de la liga
  regular de 2ª división es directamente el campeón de esa división
  (los únicos playoffs en 2ª división son los de ascenso, ver 3.2.3).

#### 3.2.3 Playoff de ascenso (2ª división)

- **2 plazas de ascenso** de 2ª a 1ª división por temporada:
  1. El **campeón de la liga regular** de 2ª división asciende directo
     (dato simple, sin necesidad de jugar ningún partido adicional).
  2. La segunda plaza se decide por un playoff entre los clasificados
     **2º a 9º** de la liga regular de 2ª división: **cuartos de
     final** (bracket fijo, al mejor de 5, patrón de campo 2-2-1:
     2v9/3v8/4v7/5v6) seguidos de una **Final Four**.
  3. **Excepción explícita a la regla de bracket fijo** (la única en
     todo el sistema 3.2): las semifinales de la Final Four se
     **reordenan** según la clasificación regular ORIGINAL de los 4
     ganadores de cuartos — el mejor clasificado de los 4 se empareja
     contra el peor, y los dos intermedios entre sí. No se mantiene la
     posición de bracket que traían de cuartos.
  4. El campeón de la Final Four es el 2º equipo ascendido.
- **2 plazas de descenso** de 1ª a 2ª división: los 2 últimos
  clasificados de la liga regular de 1ª división.
- El subcampeón de la Copa de 2ª división obtendría mejor posición
  (ventaja de cuadro) en este playoff — **sigue pendiente**: la Copa de
  2ª división en sí todavía no está implementada (ver 3.2.4), así que
  este efecto colateral tampoco lo está.
- La 2ª división usada para alimentar este playoff es hoy una
  plantilla ficticia de 18 equipos (ver nota de 3.1) — el efecto de
  ascenso/descenso sobre una temporada siguiente real (con datos ACB/
  Primera FEB) queda pendiente de la sesión de diseño de cierre de
  ciclo de temporada, ver sección 7.11 y pendientes generales.

#### 3.2.4 Copa (1ª división)

- Se crea automáticamente al completarse la **jornada 17** de la liga
  regular de 1ª división (mitad exacta del calendario de 34 jornadas).
- Participan los **8 primeros clasificados** de la liga regular **en
  ese momento** (foto de la clasificación a jornada 17, igual que la
  Copa del Rey actual de la ACB).
- Bracket fijo igual que el Playoff por el título (3.2.2), pero
  **todas las rondas a partido único** (no al mejor de 3/5).
- **No altera el estado de la liga regular**: es una lectura de la
  clasificación en ese momento, la liga sigue avanzando con normalidad
  en paralelo (jornada 18 en adelante) una vez la Copa se ha creado.
- **Nota de implementación señalada, no confirmada explícitamente por
  Dennis**: el reglamento no especifica quién ejerce de local en cada
  partido de Copa (a diferencia de los playoffs, donde sí está
  especificado arriba) — se ha asumido que el mejor clasificado en ese
  momento hace de local, por coherencia con el resto de esta sección.
- **Copa de 2ª división**: su efecto colateral sobre el playoff de
  ascenso ya está decidido (ver 3.2.3), pero su propio formato
  (participantes, calendario, número de rondas) **no se ha diseñado
  ni implementado todavía**.

#### 3.2.5 Flujo de juego (interfaz)

Desde la sesión de diseño de Alineaciones/Rotación (ver 7.11), Liga,
Copa y Playoffs dejaron de ser pestañas paralelas que había que ir a
buscar: mientras haya una Copa o un Playoff/Ascenso activo y sin
terminar, el flujo principal del juego (botón de "jugar siguiente") lo
avanza directamente, un partido a la vez, con revelación progresiva
cuarto a cuarto igual que un partido de liga — ver detalle de
implementación en el CHANGELOG del bloque correspondiente. La pestaña
de Competiciones sigue existiendo para consultar clasificación, cruces
y resultados, pero ya no es la única vía para jugar esos partidos.

### 3.3 Entidad Calendario (fechas reales de partido)

Hasta ahora, Liga/Copa/Playoffs/Ascenso solo se ordenaban por número de
jornada/ronda abstracto — no existía ninguna fecha real de partido en
ningún punto del motor. Esto bloqueaba el cierre de 7.11.5 (Recuperación
de Energía entre partidos), que necesita saber cuántos días reales de
descanso ha tenido cada jugador. Esta sección introduce una entidad
`Calendar` que asigna una fecha real a cada partido, de cualquier
competición, sobre un único eje temporal de temporada.

**Decisión de fidelidad** (confirmada con Dennis): no se replica
literalmente el calendario ACB 2025-26 partido a partido — se genera un
calendario propio con el mismo **patrón realista** de la ACB real:
jornadas de liga regular concentradas en fin de semana (sábado/domingo),
con alguna jornada entre semana (jueves) de forma ocasional, arrancando
la temporada el primer fin de semana de octubre.

#### 3.3.1 Liga regular: generación de fechas

**Sustituido por CAL-1** (calendario vivo y avance temporal): hasta esa
entrega, esta subsección fijaba explícitamente que "el motor no modela
horarios distintos por partido, solo fecha" y que todos los partidos de
una jornada compartían la misma fecha de referencia. CAL-1 existe
precisamente para sustituir esa decisión — no es una ampliación silenciosa,
es un cambio de comportamiento real y buscado. El comportamiento vigente
es el siguiente:

- **Fecha+hora real POR PARTIDO** (`Calendar.leagueMatchDateTime()`): cada
  partido de una jornada tiene su propio instante real de inicio, ya no
  solo una fecha de jornada compartida. Está permitido que dos partidos
  coincidan en el mismo horario — lo que no puede pasar es que los 9
  partidos de una jornada caigan en una única hora fija.
- **`scheduleProfile`** (`config.calendar.scheduleProfiles`, por división —
  `MatchConfig.js`): describe, sin ningún número mágico dentro del
  algoritmo de `Calendar.js`, qué combinaciones de día+hora son plausibles
  para cada división. Shape real:
  ```js
  scheduleProfiles: {
    '1ª': {
      weekendSlots: [{ dayOffset, hour, minute, weight }, ...],
      midweek: { dayOffset, slots: [{ hour, minute, weight }, ...], everyNRounds },
      lastRoundSlot: { dayOffset, hour, minute },
    },
    '2ª': { /* mismo shape, perfil más abierto */ },
  }
  ```
  `dayOffset` es relativo al "sábado ancla" que ya calculaba
  `leagueRoundDate()` (0 = ese día, -1 = el día anterior, +1 = el
  siguiente, -3 = 3 días antes). El slot real de cada partido se elige con
  una función de hash determinista (FNV-1a) sobre
  `(seasonStartYear, división, jornada, índice del partido en la jornada)`
  ponderada por `weight` — reproducible (misma temporada = mismo
  calendario siempre) sin depender de `Math.random()`. Añadir una
  competición nueva (Europa, Supercopa) es añadir una entrada nueva a
  `scheduleProfiles`, nunca tocar el algoritmo de `Calendar.js`.
  - **1ª división**: perfil de fin de semana predominante (viernes noche
    ocasional de peso bajo, sábado tarde/tarde-noche/noche, domingo
    mediodía/tarde/tarde-noche).
  - **2ª división**: perfil algo más abierto (más peso al viernes noche),
    sin replicar un calendario histórico real.
- **Jornadas entre semana**: 1 de cada `everyNRounds` (valor de partida: 8)
  jornadas de liga regular cae en miércoles en vez de fin de semana —
  decisión de partida documentada aquí, no una cifra real de calendario
  ACB. Nunca la jornada 1, la última, ni las jornadas 17/18 (semana de
  Copa, ver 3.3.2), para no acumular casos especiales en la misma semana.
- **Jornada 34 (última) — horario unificado**: regla dura, sin excepción,
  por división — todos los partidos de la última jornada de liga regular
  comparten el mismo `lastRoundSlot`. Evita que se puedan conocer
  resultados con implicaciones clasificatorias antes de que termine el
  propio partido. No se detecta qué partidos concretos tienen algo en
  juego (fuera de alcance de esta primera versión) — se unifica la jornada
  entera.
- **Separación entre jornadas consecutivas**: sigue siendo 7 días exactos
  entre las fechas ANCLA de cada jornada (`leagueRoundDate()`, sin
  cambios), salvo el hueco de la Copa (ver 3.3.2) — el reparto horario de
  3.3.1 es una capa sobre esa estructura de fechas ya correcta, nunca una
  sustitución de ella.
- **Fecha de inicio de temporada**: primer sábado de octubre del año de
  inicio de temporada (constante de `CONFIG`, no hardcodeada en
  `League.js`) — sin cambios.
- **Copa/Playoffs/Ascenso**: horario real vía `config.calendar.
  knockoutKickoff` (un único horario de "prime time" para todas las
  eliminatorias). Limitación de alcance señalada explícitamente:
  `Bracket.js` no expone a su `dateResolver` qué Series concreta está
  pidiendo la fecha (todas las series de una misma ronda comparten
  resolvedor, ver `Bracket.buildRound`), así que no hay variedad horaria
  ENTRE series simultáneas de una misma ronda sin tocar `Bracket.js` —
  fuera de alcance de CAL-1 (no estaba en la lista de archivos a tocar).
  Sí hay variedad de FECHA entre partidos/rondas (`seriesGameGapDays`/
  `seriesRoundGapDays`, sin cambios), solo la hora del día es fija dentro
  de una ronda.

**Estado: implementado** (`src/core/Calendar.js`, CAL-1).

#### 3.3.2 Copa: interrupción real de la liga

Replica el comportamiento real de la ACB, donde la Copa **para la liga
una semana** en vez de jugarse en paralelo:

- Al completarse la jornada 17 (ver 3.2.4), el calendario **inserta un
  hueco de exactamente una semana** antes de la jornada 18 — la Copa
  ocupa siempre esa semana completa, cualesquiera que sean las
  constantes de separación entre rondas (ver más abajo la corrección
  de calibración).
- La Copa completa (cuartos, semifinal, final — 3 fechas, todas a
  partido único, ver 3.2.4) se reparte dentro de ese hueco de una
  semana, con al menos 2 días de descanso real entre la fecha de la
  última ronda de Copa y la jornada 18 — esto es una regla dura, no
  una constante ajustable libremente: si `cupRoundGapDays` combinado
  con `daysBetweenRounds` no deja ese margen mínimo (ver corrección de
  calibración abajo), la separación entre rondas de Copa se comprime
  para respetarlo, nunca al revés.
- **Corrección de calibración** (detectada al implementar): con los
  valores de partida iniciales (`daysBetweenRounds: 7`,
  `cupRoundGapDays: 3`), la 3ª fecha de Copa caía 2 días **después**
  de la jornada 18 en vez de antes — la suma de 3 rondas × 3 días no
  cabía en el hueco semanal real. Corregido fijando que el hueco total
  de Copa es siempre 7 días (una semana, no una duración derivada de
  `cupRoundGapDays` × número de rondas), y las 3 fechas de Copa se
  distribuyen dentro de esos 7 días garantizando el mínimo de 2 días de
  descanso antes de la jornada 18 — `cupRoundGapDays` pasa a ser un
  valor orientativo dentro de ese margen fijo, no una suma libre.
- Los equipos que NO participan en la Copa (no estaban entre los 8
  primeros en jornada 17) simplemente tienen una semana de descanso
  total — esto es correcto y realista (les pasa lo mismo en la ACB
  real), y es precisamente el caso que 7.11.5 necesita poder calcular
  bien (más días de descanso → más Energía recuperada para esos
  equipos de cara a la jornada 18).

#### 3.3.3 Playoffs y Ascenso: fechas dinámicas por serie

A diferencia de la liga (número de partidos conocido de antemano), una
`Series` al mejor de 3/5 no sabe cuántos partidos se jugarán hasta que
se juegan. Por eso estas competiciones NO tienen un calendario
pregenerado como la liga — cada partido recibe su fecha en el momento
de crearse:

- **Separación entre partidos de una misma serie**: 2-3 días
  (constante de `CONFIG`, patrón real de playoffs ACB — más corto que
  la separación semanal de liga regular, refleja la intensidad real de
  una eliminatoria).
- **Separación entre rondas** (ej. fin de cuartos → inicio de
  semifinal): constante de `CONFIG` distinta (algo mayor que entre
  partidos de la misma serie, para dar margen de descanso real entre
  eliminatorias, igual que en la ACB real).
- **Regla dura de secuenciación entre rondas** (confirmada con Dennis,
  corrige la firma de diseño original de esta sección): una ronda
  posterior del bracket **nunca empieza hasta que todas las series de
  la ronda anterior han terminado** — el número de partidos de cada
  serie no se conoce de antemano (una serie al mejor de 5 puede acabar
  en 3, 4 o 5 partidos), así que asignar fechas fijas por adelantado a
  la ronda siguiente podría hacer que empezara antes de que una serie
  larga de la ronda anterior hubiera terminado. Por eso el resolvedor
  de fechas de bracket recibe también el patrón de partidos de cada
  serie de cada ronda (no solo la fecha de inicio), para poder calcular
  el final real más tardío posible de la ronda anterior antes de
  asignar la fecha de inicio de la siguiente.
- **Hueco fin de liga regular → inicio de Playoff por el título**:
  constante de `CONFIG` (días), aplicada una sola vez tras la jornada
  34.
- El Playoff de ascenso (2ª división) sigue el mismo patrón sobre su
  propio eje de fechas de 2ª división, independiente del de 1ª.

#### 3.3.4 Días de descanso de un jugador (para Recovery, 7.11.5)

- **Fuente de verdad**: la fecha real de calendario de cada partido
  jugado (no el número de jornada/ronda).
- **Cálculo unificado, cruzando competiciones**: los días de descanso
  de un jugador se calculan como la diferencia entre la fecha del
  partido que va a jugar y la fecha de **su último partido jugado
  realmente** (`dynamicState.lastMatchDate`, ver 7.11.5) — sea de la
  competición que sea (Liga, Copa, Playoff, Ascenso). Un jugador que
  jugó el jueves de Copa y vuelve a jugar el domingo de Liga tiene 3
  días de descanso reales, no un reloj de energía distinto por
  competición.
- Un jugador **convocado pero sin minutos** en un partido no actualiza
  su `lastMatchDate` — solo se actualiza para quien realmente pisó la
  pista (coherente con que Recovery mide descanso físico real, no
  presencia en la convocatoria).

**Estado: implementado** (`src/core/Calendar.js`), en producción desde
hace varias sesiones. Desviación de firma respecto al diseño original de
este bloque, confirmada como correcta: `buildBracketDateResolver` recibe
`(startDate, roundPatterns)` en vez de solo `(startDate)`, por el motivo
explicado en 3.3.3 (una ronda no puede fecharse sin conocer los patrones
de partidos de la ronda anterior, para no arrancarla antes de que
termine).

#### 3.3.5 Reloj de mundo (CAL-1, reescrito en WORLD-CALENDAR-1)

`currentGameDateTime`: el "ahora" de la partida (ej. "domingo 4 de octubre,
19:00"), avanza de evento en evento — nunca segundo a segundo ni con
animación, es tiempo de simulación, no un reloj en tiempo real.

**Cómo era hasta WORLD-CALENDAR-1** (histórico, ya no vigente): el reloj
vivía en `Calendar` (`calendar.currentGameDateTime`), arrancaba en
`seasonStartDate`, avanzaba cada vez que se resolvía un partido de
cualquiera de las dos divisiones, y **se reiniciaba al cerrar temporada**
porque `closeSeasonAndPrepareNext()` construía un `Calendar` nuevo para
`seasonStartYear + 1`.

**Cómo es desde WORLD-CALENDAR-1** (ver 10.14):

- el reloj vive en el **`WorldCalendar` ÚNICO de la carrera**
  (`state.calendar === state.world.calendar`, la MISMA instancia de
  principio a fin) y su autoridad interna es `currentInstant`, un instante
  **ISO 8601 UTC** con el huso IANA como dato explícito del perfil de
  calendario — no un `Date` construido con el huso del ordenador;
- **sobrevive al cambio de temporada**: cerrar temporada ya no crea otro
  calendario, solo registra la temporada nueva en el mismo agregado. El
  cursor nunca se reinicia ni retrocede;
- **lo avanza un único punto**, el `WorldCalendarCoordinator`, y solo hasta
  el instante del grupo de eventos que va a resolver — nunca "por encima"
  de una parada del usuario o de un partido pendiente;
- `currentGameDateTime`/`seasonStartDate` se conservan como **getters
  legacy** (`Date`) para la interfaz y para Recovery/Training/Development;
  ningún cálculo nuevo de calendario parte de ellos.

#### 3.3.6 Resolución cronológica y parcial de jornada (CAL-1)

> **Ampliado en WORLD-CALENDAR-1 (ver 10.14).** Lo que CAL-1 hizo dentro
> de una jornada (resolver por fecha, parar en el partido del usuario) es
> ahora la regla del MUNDO entero: la unidad de avance ya no es "la
> jornada", es UN evento fechado de cualquier competición. `simulateNextRound()`
> ha desaparecido como unidad de avance productiva.

Antes de CAL-1, `League.simulateNextRound()` resolvía TODOS los partidos
pendientes de la jornada actual de una sola vez — una jornada era un
bloque atómico. CAL-1 sustituye ese modelo por resolución partido a
partido, sin romper la API existente:

- **`League.resolveMatch(match, config, resolveMatchOptions)`**: resuelve
  UN partido pendiente concreto (mismo patrón que
  `Bracket/Series.playNextGame()`, pero aquí el "cursor" lo decide quien
  llama, no una Serie interna). Actualiza clasificación/enfrentamientos
  directos y avanza `currentRound` en cuanto la jornada que señala queda
  completa (`advanceCurrentRoundPointer()`).
- **`League.getPendingMatchesBefore(beforeDateTime)` /
  `League.resolveMatchesBefore(beforeDateTime, config, resolveMatchOptions)`**:
  consulta/resuelve, en orden cronológico, todo lo pendiente con fecha
  anterior a un instante dado — la pieza que usa el reloj de mundo para
  "saltar" los partidos CPU-CPU sin necesidad de resolver la jornada
  entera de golpe.
- **`League.simulateNextRound()` se conserva como wrapper de
  compatibilidad**: mismo nombre, misma firma, mismo contrato desde fuera
  (resuelve toda la jornada actual de una vez) — por dentro ya no repite
  la lógica de simulación, delega en `resolveMatch` sobre los partidos que
  sigan `'pending'` de `getCurrentRoundMatches()`. Lo siguen usando tal
  cual `simulateBackgroundRound()` (la división de fondo se resuelve
  siempre de golpe, sin reveal, 3.4.1 — no necesita granularidad
  cronológica) y el camino defensivo de jornada sin partido para el
  usuario en `game.js`.
- **Cambio de orquestación central** (`game.js`,
  `startUserLeagueMatch()`/`resolvePreUserMatches()`): antes de CAL-1, el
  partido de liga del usuario se jugaba SIEMPRE primero y el resto de la
  jornada se resolvía después. Ahora es exactamente al revés — al llegar
  la hora de su partido, `resolvePreUserMatches()` ya ha resuelto (vía
  `resolveMatchesBefore`) todos los partidos de la jornada (de las dos
  divisiones) con fecha anterior a la suya; los partidos posteriores de su
  misma jornada se resuelven después, al terminar el suyo
  (`finishUserLeagueMatch()`, mismo `simulateNextRound()` de siempre sobre
  lo que quede pendiente).
- **Botón "Continuar"** (sustituye a "Jugar siguiente jornada"/"Jugar
  siguiente partido"): avanza el reloj de mundo hasta el próximo evento
  que requiere atención, saltando lo que no la requiere. Único punto de
  parada obligatoria en esta entrega: el partido del usuario — el juego
  nunca lo simula automáticamente solo por pulsar Continuar. Con 18
  equipos por división el round-robin no genera jornadas de descanso, así
  que en la práctica "Continuar" resuelve como mucho una jornada por click
  (los partidos anteriores al del usuario) antes de parar; no hace falta
  un bucle de "saltar varias jornadas" en esta primera versión. Mientras
  hay una Copa/Playoff/Ascenso activo, "Continuar" conserva el
  comportamiento ya existente (3.2.5): un partido de bracket por click,
  con reveal cuarto a cuarto, sin tocar `Bracket.js`/`Cup.js`/
  `Playoffs.js`/`Promotion.js`.
- **Mecanismo genérico `requiresAttention`** (`game.js`,
  `buildUserMatchStopEvent(match)`): representación mínima de un punto de
  parada obligatoria — `{ type: 'match', dateTime, requiresAttention:
  true, status: 'pending', match }`. Hoy solo lo produce el partido del
  usuario; se deja como mecanismo genérico (no un catálogo de eventos
  todavía) para que una futura Agenda/Noticias pueda ampliarlo sin
  rehacerlo desde cero — CAL-2 debe auditar esto antes de construir su
  propio modelo de evento, no asumir su forma desde este documento.

#### 3.3.7 Recovery y horario real: decisión tomada

`Recovery.js` sigue operando en **días enteros** (`Math.round`, sin
cambios) — no se ha evolucionado a una unidad fraccional. Justificación:
la introducción de horas reales por partido no produce una incoherencia
apreciable con la fórmula actual, porque:

- Las eliminatorias (Copa/Playoffs/Ascenso), donde los partidos pueden
  estar separados por solo 2-3 días (`seriesGameGapDays`), usan un único
  horario fijo (`knockoutKickoff`) para TODOS sus partidos — la diferencia
  entre dos partidos consecutivos de una misma serie sigue siendo un
  número EXACTO de días, sin ningún resto de horas que el redondeo
  distorsione.
- En liga regular, un mismo equipo juega una sola vez por jornada, así que
  la variedad horaria dentro de una jornada nunca afecta al cálculo de
  descanso de un jugador consigo mismo — solo varía la hora ENTRE una
  jornada y la siguiente (separadas por 7±3 días reales, según el
  `scheduleProfile`), un rango donde una diferencia de unas pocas horas es
  despreciable frente al redondeo a día completo.

Si una futura entrega introdujera partidos de liga regular más próximos
entre sí en el tiempo (fuera de alcance hoy), esta decisión debería
revisarse. `Player.toJSON()` SÍ se corrigió (ver 7.11.5): antes truncaba
`lastMatchDate` a solo fecha al serializar ("consistencia de guardado"),
lo que habría destruido la hora real en cualquier guardado/carga futuro;
ahora serializa el ISO completo, ya que la hora tiene significado real
para el cálculo de días de descanso en memoria (aunque el propio cálculo
siga redondeando a días enteros).

### 3.4 Cierre de ciclo de temporada y pretemporada

**Nota de arquitectura (WORLD-CORE-1):** "las dos divisiones" de esta
sección son ACB y Primera FEB del paquete `spain-2026.1` — el mundo puede
alojar más de dos competiciones domésticas simultáneas (sección 10); esta
sección documenta el comportamiento REAL de la vertical española, que
`SpainLegacyCompetitionRuntime` sigue orquestando sin cambios de
comportamiento.

Cierra el ciclo abierto desde el inicio del proyecto: hasta ahora una
partida podía jugar una temporada completa (liga + Copa + Playoffs/
Ascenso) pero al llegar al final no pasaba nada — no había ascensos/
descensos reales, ni temporada siguiente, ni recálculo de nada. Esta
sección define qué ocurre al terminar la temporada regular en las dos
divisiones y qué prepara la pretemporada antes de generar el nuevo
calendario.

#### 3.4.1 Las dos divisiones se simulan SIEMPRE, en paralelo

> **Reescrito en WORLD-CALENDAR-1 (ver 10.14).** El PRINCIPIO sigue
> vigente: las dos divisiones están vivas desde el primer día y el usuario
> nunca tiene que simular "la otra" aparte. El MECANISMO ha cambiado por
> completo: ya no existe una "división de fondo" que se simule por bloques
> tras cada jornada del usuario (`simulateBackgroundRound()`/
> `drainBackgroundBrackets()`, retiradas). Todos los partidos de todas las
> competiciones viven en una sola cola cronológica y se resuelven en su
> instante real; solo los del equipo controlado detienen el juego.

Hueco de arquitectura detectado al diseñar este cierre: hasta ahora el
juego solo mantenía viva **una** `League` (la división donde juega el
usuario) — la otra división real (18 equipos) no se simulaba en ningún
sitio, así que no existía una clasificación real con la que resolver
ascensos/descensos de verdad. `Promotion.js` se probaba hasta ahora
contra una 2ª división **ficticia** generada aparte solo como
andamiaje de prueba (ver 3.2.3 / `Promotion.js`), nunca contra los 18
equipos reales de Primera FEB.

A partir de este cierre, **las dos ligas reales (1ª y 2ª) están vivas
simultáneamente desde el primer instante de la partida**, con el mismo
patrón que un manager de referencia (Football Manager): la liga que el
usuario "tiene abierta" (la de su equipo) se sigue jornada a jornada
con reveal por cuartos como hasta ahora; la otra liga se resuelve
**de golpe, sin reveal**, cada vez que el usuario avanza su propia
jornada — nunca se le pide al usuario que la simule aparte ni queda
rezagada.

- Ambas ligas usan el mismo `Calendar` de temporada (mismo
  `seasonStartYear`), cada una con su propio `generateSchedule()` de
  18 equipos.
- La liga "de fondo" se simula usando `CpuLineup` en ambos lados de
  cada partido (igual que ya se hace hoy para los rivales del usuario
  dentro de su propia liga) — nunca con el placeholder de convocatoria
  por defecto, para que su clasificación y sus datos de jugador
  (Energía, `lastMatchDate`, minutos) queden igual de reales que los de
  la liga visible.
- Recovery.js (3.3.4) se aplica igual en la liga de fondo tras cada
  jornada, reutilizando `applyRecoveryForResolvedMatch()` tal cual —
  no es una integración nueva, es extender la ya existente a la
  segunda liga.
- Si el usuario cambia de club a una división distinta a mitad de
  partida (sección 4, ya permitido), la liga "de fondo" pasa a ser la
  que dejó y la que antes era de fondo pasa a primer plano — ninguna
  de las dos deja de simularse en ningún momento, solo cambia cuál se
  le muestra con reveal.
- Copa (1ª división) y Playoff de ascenso (2ª división) se disparan
  igual que hoy en cada liga cuando corresponda (jornada 17→18 para la
  Copa; fin de jornada 34 para playoffs/ascenso), sea la liga visible o
  la de fondo. Cuando el bracket corresponde a la liga de fondo, se
  juega también de golpe (sin reveal), reutilizando
  `Bracket.playNextGame()`/`PromotionPlayoff.playNextGame()` en bucle
  hasta `isComplete`.

#### 3.4.2 Fin de temporada regular: ascensos y descensos reales

Cuando **ambas** ligas (visible y de fondo) han completado su
temporada regular y sus respectivos Copa/Playoff/Ascenso:

1. **Descensos**: los 2 últimos clasificados de la liga regular de 1ª
   división (ya definido en 3.1) pasan a `division: '2ª'`.
2. **Ascensos**: el campeón de la liga regular de 2ª división y el
   campeón del Playoff de ascenso (`PromotionPlayoff.secondPromotedEntry`,
   ya implementado) pasan a `division: '1ª'`.
3. **La plantilla no se toca**: ascender o descender **solo cambia
   `team.division`**. Ningún atributo de ningún jugador (técnico,
   físico, mental, ocultos, `dataSource`, medidas corporales) se
   modifica por el cambio de división — decisión explícita de Dennis,
   para no repetir aquí el reescalado puntual que se hizo una sola vez
   sobre `team_tiers.json` (ver CHANGELOG "Reescalado proporcional de
   atributos de la base de datos real"). Un equipo puede, por tanto,
   bajar a 2ª conservando un overall alto (o subir con uno bajo) — es
   un resultado esperado, no un bug.
4. Si el equipo del usuario asciende o desciende, no hace falta ninguna
   regla nueva: la sección 4 ya permite que la carrera del usuario
   cambie de club/división libremente: el cierre de ciclo simplemente
   mueve su `team.division` igual que a cualquier otro equipo, y la
   próxima vez que se recalculen las dos `League` su equipo sale ya en
   el grupo de 18 que le corresponde. (Nota: el cierre de temporada
   descrito en 3.4.1-3.4.3 —ascender/descender, recalcular
   `sportingGoal`— es el hueco de arquitectura ORIGINAL, resuelto de
   forma puntual antes de que existiera la EPIC de ciclo de plantilla.
   Desde **CYCLE-1** (9.22), este cierre ya no es un paso aislado: es
   una fase más —`season-history-closed`— dentro del ciclo anual real de
   13 fases, que además resuelve expiración/renovación de contratos,
   tanteo, retirada, cantera y legalidad de plantilla antes de arrancar
   la temporada siguiente. Esta sección 3.4 se conserva como registro
   histórico de por qué existen ascensos/descensos y `sportingGoal`
   reales; el comportamiento vivo hoy es el de 9.22, sobre la base
   declarativa de **PATHWAYS-1** descrita justo debajo.)

   **Actualización PATHWAYS-1 (ver 10.15):** "solo cambia `team.division`"
   deja de ser literalmente cierto como MECANISMO — sigue siendo cierto
   como RESULTADO observable (ningún atributo/plantilla se toca por un
   ascenso/descenso). La fuente de verdad pasa a ser un
   `CompetitionSeasonTransitionReceipt` (`CompetitionPathwayService.
   applyTransitionGroup()`), que crea de forma ATÓMICA las Editions/Entries
   de ACB/Primera FEB de la temporada siguiente (18+18); `team.division`/
   `legacyDivision` se PROYECTAN después, desde esa membership ya
   comprometida (`CompetitionParticipationService.projectLegacyDivisionForTeams()`),
   nunca al revés. `SeasonHistoryService.applyPromotionsAndRelegations()`
   (que sí mutaba `team.division` directamente) queda RETIRADO de la ruta
   productiva — sobrevive solo para los scripts de humo anteriores a esta
   entrega que todavía construyen su cierre desde `League`/
   `PromotionPlayoff` standalone.

#### 3.4.3 Cálculo de `board.sportingGoal` (sustituye el valor fijo)

Hueco cerrado: `Team.js` asignaba a todo equipo real el mismo valor
fijo `'Permanencia'` (ni siquiera perteneciente al vocabulario de
`teamGenerator.js`), señalado como inerte para partidas reales en el
CHANGELOG de `CpuLineup.js`/7.11.7. A partir de este cierre, el
objetivo deportivo de temporada de **todos** los equipos (usuario y
resto) se recalcula en cada pretemporada con esta fórmula, sustituyendo
el valor de la temporada anterior:

```
percentilPlantilla   = percentil del overall-top8 del equipo dentro de
                        SU división de la temporada que empieza
                        (mismo cálculo de "overall de los 8 mejores"
                        que ya usa scripts/rescale-real-attributes.js,
                        aplicado en vivo sobre los 18 equipos de esa
                        división en vez de una vez en un script)

poderCombinado = (percentilPlantilla × 0.5) + (team.reputation.financial × 0.5)
señalFinal     = (poderCombinado × 0.7) + (team.reputation.sporting × 0.3)
```

`señalFinal` (0-100) se mapea a los 4 valores ya existentes de
`SPORTING_GOALS` (`teamGenerator.js`) por tramos (umbrales de partida,
ajustables en `CONFIG_BASE`, no cifras cerradas):

| señalFinal | sportingGoal |
|---|---|
| ≥ 80 | Pelear por el título |
| 55 – 79 | Optar a playoffs |
| 30 – 54 | Consolidarse en la categoría |
| < 30 | Evitar el descenso |

Con esto, `CpuLineup.computeMatchImportance()` (7.11.7) deja de recibir
una señal inerte para equipos reales — vuelve a discriminar partido
clave/no clave con datos de verdad, sin que haya que tocar su propia
lógica (ya implementada exactamente para consumir este campo). Esta es
la fórmula concreta que 6.2.4 dejaba sin definir para
`board.sportingGoal` — 6.2.4 sigue siendo la ficha conceptual del
campo, esta sección (3.4.3) es su cálculo real.

`financialGoal` y `multiYearPlan` quedan fuera de este cálculo (no
tienen aún ninguna fórmula de partida definida) — se recalculan más
adelante, cuando se diseñe en detalle el módulo económico y de
objetivos plurianuales (ver 6.2.4, pendiente).

#### 3.4.4 Pretemporada: qué se recalcula antes del nuevo calendario

Una vez aplicados los ascensos/descensos (3.4.2), en este orden:

1. Recalcular `board.sportingGoal` de los 36 equipos (3.4.3), con la
   composición de división YA actualizada (un recién ascendido calcula
   su percentil dentro de su nueva liga de 1ª, no la de 2ª que acaba de
   dejar).
2. Cantera/Academia (6.2.3, ya placeholder): generar los 3 jugadores
   jóvenes de cada club para la nueva temporada, reutilizando
   `Team.generateAcademyIntake()` tal cual — no es una regla nueva,
   es conectar la llamada en el punto de cierre de ciclo.
3. Nuevo `Calendar` con `seasonStartYear + 1` (mismo `CONFIG_BASE`,
   nuevo `generateSchedule()` para cada división con los 18+18 equipos
   ya reordenados por ascenso/descenso).
4. Nuevas instancias de `League` para 1ª y 2ª (standings a cero,
   `currentRound = 1`) — reutilizando `League.js` tal cual, sin ningún
   cambio de código en esa clase: recibe la lista de equipos que le
   corresponda, como ya hace hoy.
5. Reset de `titlePlayoff`/`cup`/`promotionPlayoff` a `null` en ambas
   divisiones, igual que ya hace `startSeason()` al arrancar una
   partida nueva.

#### Pendiente para sesiones de diseño futuras (Cierre de ciclo)
- Renovación de contratos, salidas/fichajes de jugadores entre
  temporadas — depende del futuro módulo de fichajes, no diseñado
  todavía.
- Envejecimiento y progresión de atributos por edad (sección 9, sigue
  sin diseñar en detalle).
- Evolución de `reputation`/`facilities` entre temporadas (hoy
  persisten tal cual, sin decaimiento ni crecimiento automático por
  resultados — 6.2.1/6.2.2 no definen todavía esa dinámica temporal).
- `financialGoal`/`multiYearPlan` de la Junta (6.2.4): siguen sin
  fórmula de cálculo, ver nota en 3.4.3.
- Qué pasa con equipos que en el futuro dejen de tener datos reales
  disponibles (fuera de alcance mientras el proyecto trabaje solo con
  los 36 equipos actuales).
