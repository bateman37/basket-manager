# DESIGN.md — Basket Manager

Documento de diseño del juego. Este archivo es la referencia de reglas para
cualquier sesión de desarrollo (humana o de Claude Code). Si una duda de
implementación no está resuelta aquí, hay que preguntar al diseñador (Dennis)
antes de asumir una respuesta.

## 1. Visión general

Manager de baloncesto al estilo **PC Basket / PC Fútbol**, con un modo
completo que fusiona presidencia + entrenador en un único rol de jugador
(no hay "sombreros" separados: el usuario decide fichajes, finanzas,
tácticas y entrenamientos desde el mismo perfil).

Más adelante se derivará un **modo Manager simple** (estilo Football
Manager: solo gestión, sin pantallas de presidencia) reutilizando el mismo
motor, quitando funciones en vez de añadirlas.

## 2. Estado del proyecto

- **Fase actual:** motor jugable con datos de prueba/ficticios.
- **En paralelo:** construcción progresiva de una base de datos con
  jugadores y equipos reales (ACB primero, luego LEB y clubes europeos
  relevantes), estadística por estadística, como proceso de contenido
  separado del desarrollo del motor.
- Los datos reales se cargan en el mismo formato que los datos ficticios,
  así que el motor no necesita cambios cuando se sustituyen.

⚠️ **Nota legal activa:** el proyecto usa nombres reales de jugadores y
clubes para uso privado. Si en el futuro se comercializa, hay que revisar
esto (ver sección 12).

## 3. Estructura de competición (primer hito)

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

**Estado: implementado y en producción** (`src/core/League.js`) para
1ª y 2ª división. 2ª división usa hoy una plantilla de 18 equipos
ficticios como infraestructura mínima para alimentar el playoff de
ascenso (3.2.3) — no es todavía un modo de juego completo por sí mismo
con datos reales propios, ver 3.2.3.

### 3.2 Playoffs, Copa y Playoff de ascenso

**Estado: implementado y en producción** (`src/core/Bracket.js`,
`src/core/Playoffs.js`, `src/core/Cup.js`, `src/core/Promotion.js`),
reutilizando `League.js` y `MatchEngine.js` sin ninguna modificación.
Esta sección documenta el sistema tal como quedó construido — sustituye
por completo cualquier redacción anterior de este apartado que lo
describiera como pendiente.

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

- **Una jornada = un fin de semana** (sábado y/o domingo): todos los
  partidos de una misma jornada comparten la misma fecha de referencia
  de calendario (no se reparten los 9 partidos de una jornada en días
  distintos); el motor no modela horarios distintos por partido, solo
  fecha.
- **Separación entre jornadas consecutivas**: 7 días exactos, salvo el
  hueco de la Copa (ver 3.3.2).
- **Fecha de inicio de temporada**: primer sábado de octubre del año de
  inicio de temporada (constante de `CONFIG`, no hardcodeada en
  `League.js`).
- **Jornadas entre semana**: se descarta modelar la variabilidad real
  jueves/viernes/sábado/domingo con detalle — toda jornada de liga
  regular cae en sábado por defecto en esta fase. Simplificación
  explícita: da una cadencia realista (7 días) sin necesidad de simular
  ventanas de selecciones nacionales ni derbis con horario especial,
  ninguno de los cuales está modelado hoy en el motor.

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

**Estado: implementado** (`src/core/Calendar.js`), pendiente de merge a
`main` en el momento de escribir esto — ver PR en curso. Desviación de
firma respecto al diseño original de este bloque, confirmada como
correcta: `buildBracketDateResolver` recibe `(startDate, roundPatterns)`
en vez de solo `(startDate)`, por el motivo explicado en 3.3.3 (una
ronda no puede fecharse sin conocer los patrones de partidos de la
ronda anterior, para no arrancarla antes de que termine).

### Supercopa y competición europea (pendiente)

- **Supercopa** (formato corto, equipos clasificados por resultados de
  la temporada anterior — a definir criterio exacto más adelante).
- **Competición europea**: los clubes "grandes" están siempre asignados
  a la misma competición europea cada año (sin sistema de clasificación
  dinámico todavía — se revisará más adelante). Un ascenso/descenso de
  división no afecta, por ahora, a la participación europea de estos
  clubes fijos.

### Pendiente para sesiones de diseño futuras (Liga/Calendario)
- Copa de 2ª división (formato completo: participantes, calendario,
  número de rondas) — solo se ha decidido su efecto colateral sobre el
  playoff de ascenso (3.2.3).
- 2ª división con datos reales propios (hoy es una plantilla ficticia
  mínima, ver 3.1) y cierre de ciclo de temporada (ascenso/descenso
  real entre temporadas sucesivas).
- Supercopa y competición europea (criterio de clasificación dinámico).

## 4. Inicio de partida

- El usuario **elige libremente** con qué club empezar, de primera o
  segunda división, sin restricciones de nivel ni de presupuesto.
- La carrera **no está atada a un solo club**: el usuario puede ser
  despedido (por malos resultados/directiva descontenta) o fichar por
  otro club, como en Football Manager.

## 5. Economía del club

**Sustituida por el desglose completo de la sección 6.2.6.** Aquella
sesión de diseño (análisis de referentes de club) definió las 7 fuentes
de ingreso y las 3 categorías de gasto ancladas a la estructura real de
la ACB (patrocinio como primera fuente, no la TV), sustituyendo por
completo el planteamiento genérico que había aquí originalmente. Esta
sección se deja como puntero explícito para que nadie implemente contra
una versión desactualizada: **la referencia vigente es 6.2.6**, no este
apartado.

## 6. Jugadores y equipos

- **Nombres y datos reales** para las dos primeras ligas españolas y los
  clubes europeos más relevantes que participan en competición europea.
- Atributos de juego derivados de estadísticas y reportajes reales, lo más
  fieles posible al rendimiento real de cada jugador — construidos
  progresivamente, no todos de golpe.
- Los clubes europeos "grandes" están fijos en su competición europea cada
  temporada por ahora (sin lógica de clasificación aún).
- **Fase de arranque:** mientras se construye la base de datos real, el
  motor funciona con jugadores y equipos ficticios generados para poder
  probar y jugar desde ya.

### 6.1 Ficha de jugador

Inspirada en el nivel de profundidad de Football Manager, adaptada a
baloncesto. Todos los atributos numéricos en **escala 1-20**.

**Posiciones**: cada jugador tiene mínimo 1 y hasta 5 posiciones
(Base, Escolta, Alero, Ala-pívot, Pívot), reflejando polivalencia real.

**Actualización (sesión de diseño de Alineaciones/Rotación, ver 7.11)**:
el campo deja de ser una lista plana de posiciones habilitadas y pasa a
ser un **mapa con nivel de competencia para las 5 posiciones,
siempre presente** (no una lista variable de 1 a 5 entradas):

- Cada jugador tiene un valor 1-20 para **cada una** de las 5
  posiciones (Base, Escolta, Alero, Ala-pívot, Pívot), no solo para las
  que "tiene habilitadas". Una posición en la que el jugador no está
  habilitado en absoluto simplemente lleva un valor bajo (nivel 1), en
  vez de no existir en los datos.
- **Posición principal**: no es un campo aparte — se deduce
  directamente de cuál de las 5 posiciones tiene valor **20** (el
  jugador rinde al 100% de su capacidad exactamente en su posición
  principal, por definición, y solo en ella). Esto evita que puedan
  quedar inconsistentes un campo "principal" declarado y el propio
  valor numérico.
- **Posiciones secundarias**: las que tienen un valor entre 1 y 19,
  coherente con el resto de la ficha — un grado real de competencia,
  no una etiqueta plana de "habilitada/no habilitada" (ej. un base con
  Escolta a nivel 16 se defiende mucho mejor ahí que uno a nivel 6).
- Este shape simplifica el uso en el motor (7.11.3, polivalencia de
  emergencia): nunca hay que comprobar si una posición "existe" en los
  datos del jugador — siempre hay un valor que consultar, incluso para
  las posiciones no habilitadas (nivel 1 por defecto), así que la regla
  de emergencia total queda implícita en los propios datos.
- El generador de jugadores (real o ficticio) decide el valor de cada
  una de las 5 posiciones según coherencia posicional (ej. un Base
  tendría un valor muy bajo en Pívot, y probablemente un valor medio en
  Escolta) — el criterio exacto de generación se deja para cuando se
  trabaje esa parte del generador, no bloquea el uso del campo en el
  motor de partido.

#### Datos Físicos Corporales (reales, no en escala 1-20)
Distintos de los Atributos Físicos de abajo (que son habilidad/capacidad
en escala 1-20): estos son medidas corporales reales, generadas con
rangos realistas según posición (ej. un Pívot 195-215cm, un Base
178-195cm).
- **Altura** (cm)
- **Envergadura** (cm — puede ser mayor que la altura, como en la
  realidad)
- **Peso** (kg)

Estos datos alimentan directamente al motor de simulación de partidos
(ver sección 7), donde la diferencia de altura/envergadura entre
jugadores enfrentados es clave para emparejamientos realistas (ej. un
pívot alto anotando con facilidad sobre un base bajo cerca del aro).

#### Atributos Técnicos (fijos, mejoran con entrenamiento/edad)
Tiro exterior, tiro media distancia, tiro interior, tiro libre,
bandeja/finalización, pase, manejo de balón, rebote ofensivo, rebote
defensivo, tapón, robo, tendencia a falta, **defensa perimetral**,
**defensa interior**.

Nota (añadido al implementar el motor, sección 7): defensa perimetral y
defensa interior faltaban en esta lista pese a que el catálogo de
acciones (7.6, Bloque A) ya las usaba como `DefensaPerimetral` y
`DefensaInterior` en 6 de las 10 acciones — inconsistencia detectada y
resuelta añadiéndolas aquí como Atributos Técnicos normales (escala
1-20), en vez de inventar una fórmula derivada de otros atributos.

Nota: **tiro interior** y **bandeja/finalización** son atributos
DISTINTOS (no deben fusionarse en el motor de simulación) — el tiro
interior cubre tiros de corta/media distancia cerca del aro con arco
(incluyendo ganchos, tiros con bote parado), mientras que la bandeja es
específicamente el gesto de ir a canasta en movimiento/penetración.

#### Atributos Físicos (fijos)
Velocidad (punta), aceleración, salto, fuerza, agilidad, balance
(equilibrio/aguante al contacto), resistencia (aguante dentro de un
partido), recuperación (velocidad de recuperación entre partidos/
entrenamientos), durabilidad (propensión a lesión — se detallará en
sesión de diseño del módulo de progresión/lesiones).

#### Atributos Mentales (fijos)
Visión de juego, decisión bajo presión, agresividad, concentración,
liderazgo, trabajo en equipo, ambición, profesionalidad, temperamento,
consistencia, anticipación, posicionamiento (movimiento sin balón),
ética de trabajo (esfuerzo/energía que invierte en el partido, distinto
de profesionalidad, que es cómo entrena).

#### Rasgos (etiquetas, no numéricas)
Ej. tirador clutch, especialista defensivo, generador de asistencias,
chispa de banquillo, jugador de vestuario. Afectan a la simulación en
situaciones concretas, no son un número 1-20.

#### Experiencia
Campo aparte, no encaja como atributo fijo ni estado dinámico: crece con
partidos jugados (más con partidos "importantes": playoffs, Copa,
competición europea), nunca decrece, no se entrena directamente. Actúa
como modificador que ayuda en Decisión bajo presión y Consistencia en
momentos de tensión (finales de partido, eliminatorias). Un jugador joven
con buenos atributos pero poca Experiencia puede fallar más en momentos
clave que un veterano con atributos algo menores.

#### Ocultos para el usuario (existen en los datos, revelados vía scouting)
Potencial (techo de mejora), profesionalidad, ambición. El scouting los
revela progresivamente y con precisión creciente según la calidad de los
ojeadores del club (a definir en detalle cuando se implemente el módulo
de scouting).

#### Estados dinámicos (cambian constantemente durante la simulación de temporada)
Estos **siempre existen y se guardan en los datos del jugador**; lo que
varía es cuánto se le muestra al usuario en la interfaz — "oculto" aquí
significa oculto en la UI, nunca que el dato no exista o no se simule.

- **Energía**: batería física actual. Baja al jugar/entrenar, sube al
  descansar. Depende de Resistencia y Recuperación. **Visible** al
  usuario.
- **Ritmo de competición**: refleja si el jugador ha tenido continuidad
  de minutos recientemente. Un jugador con mucha Energía pero sin jugar
  hace semanas no rinde igual que uno con partidos seguidos.
  **Semi-visible** (deducible por el usuario, sin mostrar un número
  directo).
- **Racha / momento anímico**: rachas de acierto o desacierto con
  componente aleatorio/anímico, independiente de atributos fijos y de la
  Energía. Existe y se actualiza en la base de datos como cualquier otro
  estado, y la simulación de partidos la usa activamente — pero **nunca
  se muestra en la interfaz**; el usuario solo la intuye por los
  resultados recientes del jugador.

#### Pendiente para sesiones de diseño futuras
- Roles tácticos con valoración en estrellas (ej. "Base organizador",
  "Anotador de banquillo"), similar a los roles de FM — se definirá junto
  al módulo de tácticas, ya que depende de cómo se diseñen las tácticas
  del equipo. **Nota**: esto es distinto de la posición en pista por
  partido, ya resuelta en 7.11 — los roles tácticos son un refinamiento
  adicional sobre esa posición, no un reemplazo.
- Sistema de lesiones (relacionado con Durabilidad) — se definirá junto
  al módulo de progresión/entrenamiento.

### 6.2 Ficha de equipo

Diseño ampliado tras sesión de análisis de referentes (Football Manager,
NBA 2K MyNBA/MyGM, Basketball GM, PC Basket/PC Fútbol, Pro Basketball
Manager) — el enfoque es **europeo/ACB**, evitando deliberadamente
mecánicas específicas de NBA (salary cap, draft, franquicias sin
ascenso/descenso). La adaptación de una eventual comparación con clubes
americanos queda pendiente para cuando se aborde esa parte del proyecto.

#### Datos básicos
Nombre, ciudad, año de fundación, división actual (1ª o 2ª), presupuesto
(ver desglose económico en 6.2.6).

**Estadio/pabellón**: sigue siendo una **entidad separada** asociada al
equipo (no integrada directamente en esta ficha), tal como se decidió
originalmente. Se detallará cuando se implemente su propio diseño; el
equipo solo referencia su instancia de estadio, y variables como aforo y
ocupación (usadas en 6.2.5, factor cancha, y 6.2.6, ingresos de
taquilla) viven en esa entidad, no aquí.

#### Plantilla
Agrupa jugadores (entidad `Jugador`, ver 6.1).
- **Plantilla total del club**: sin límite duro por ahora.
- **Convocatoria de partido**: mínimo 8, máximo 12 jugadores, fiel al
  reglamento real de la ACB. Se aplica solo a la selección de partido,
  no a la plantilla total.

#### 6.2.1 Reputación (el "número maestro")
Se muestra al usuario como **3 sub-componentes visibles por separado**,
cada uno alimentado por factores propios (inspirado en el sistema de FM,
con la asignación factor→componente hecha explícita para que no quede
ambigua a la hora de implementar):

- **Reputación deportiva** ← títulos ganados y división en la que
  compite, calidad de la plantilla actual e histórica.
- **Reputación financiera** ← poder económico del club, nivel general
  de instalaciones (inversión acumulada, ver 6.2.2).
- **Reputación de cantera** ← éxito desarrollando canteranos propios,
  nivel de las instalaciones Cantera/Academia y Red de Scouting
  (6.2.2, puntos 4 y 5).

La reputación (los 3 sub-componentes en conjunto) gobierna la atracción
de jugadores en fichajes, el interés de patrocinadores, y las
expectativas que fija la junta/propietario (ver 6.2.4).

#### 6.2.2 Instalaciones (escala 1-20 cada una)
Siete instalaciones internas del club, cada una mejorable con dinero
(sujeto a aprobación de la junta si el gasto es grande), con **coste de
mantenimiento anual** y posibilidad de quedar **obsoleta con el tiempo**
si no se actualiza (igual que en Football Manager):

1. **Centro de Entrenamiento** — progresión técnica/táctica del primer
   equipo, prevención de fatiga.
2. **Centro Médico** — prevención y recuperación de lesiones.
3. **Preparación Física** — rendimiento físico general y puesta a punto
   en pretemporada (distinto del Centro Médico: esta es sobre rendir
   mejor, la otra sobre no lesionarse/recuperarse).
4. **Cantera/Academia** — calidad de los jugadores jóvenes generados
   (ver 6.2.3). En el futuro será la puerta de entrada al sistema
   completo de categorías inferiores.
5. **Red de Scouting** — ojeadores de campo: descubrimiento de jugadores
   externos y velocidad/precisión para revelar los atributos ocultos de
   la ficha de jugador (Potencial, Profesionalidad, Ambición).
6. **Departamento de Análisis/Dirección Deportiva** — analítica de datos
   y oficinas de dirección deportiva. Efecto: mejora general de calidad
   de decisiones (fichajes, tácticas). El efecto concreto/numérico se
   detallará cuando se diseñe el módulo de fichajes y el de tácticas —
   no inventar una fórmula todavía.
7. **Hospitality/Patrocinio** — zonas VIP y relación con patrocinadores;
   alimenta los ingresos de Publicidad extra (ver 6.2.6).

#### 6.2.3 Cantera/Academia — placeholder actual
**Ambición declarada del proyecto** (diferenciador frente a otros
managers): más adelante se diseñará un sistema completo de gestión de
**categorías inferiores reales** (infantil, cadete, junior, etc., cada
una con su propia plantilla y progresión), algo que prácticamente ningún
manager del mercado aborda con profundidad. Este sistema es complejo y
**queda pendiente de una sesión de diseño dedicada**, junto con la
decisión de si existe un club filial/vinculado en 2ª división para ceder
jóvenes (también pendiente, ver nota abajo).

**Mientras tanto (placeholder para poder jugar ya):** cada temporada, la
instalación Cantera/Academia genera **3 jugadores jóvenes aleatorios**,
con atributos coherentes según las reglas ya definidas en 6.1
(multi-posición, escala 1-20, atributos ocultos, potencial, etc.). Sin
filial ni categorías todavía — estos jugadores se incorporan
directamente a la plantilla total del club.

#### 6.2.4 Junta/Propietario y objetivos de temporada
Existe una **junta/propietario** por encima del usuario (que ocupa el
rol fusionado presidente+entrenador, ver sección 8) que puede
**despedirle** si no se cumplen los objetivos. Detalle equivalente al
Club Vision de FM:
- **Nivel de paciencia** (se erosiona con malos resultados sostenidos).
- **Objetivo deportivo** de la temporada (ej. posición en liga,
  permanencia, clasificación europea).
- **Objetivo financiero** de la temporada (ej. equilibrio
  presupuestario, no superar deuda).
- **Plan a varias temporadas** (visión plurianual, similar al "plan a
  cinco años" de FM).

Esto conecta con la regla ya establecida en la sección 4: el usuario
puede ser despedido y fichar por otro club durante la partida.

#### 6.2.5 Afición y factor cancha
Variables de afición en la ficha de club:
- **Base de abonados**
- **Satisfacción de la afición** (dinámica, sube/baja con resultados,
  fichajes, precio de entradas, etc.)
- **Ocupación media del pabellón**

**Factor cancha**: modula el rendimiento del equipo local con una
fórmula basada en **ocupación × satisfacción × importancia del
partido**, con más efecto en derbis y playoffs. Ver nota de investigación:
estudios reales (Ganz y Allsop, 2024) cifran la ventaja real de jugar en
casa en torno a ~2.1 puntos con público lleno frente a ~0.4 puntos sin
público — usar esta magnitud como referencia de calibración cuando se
implemente la fórmula en el motor de simulación, no un número arbitrario.

#### 6.2.6 Finanzas — desglose completo de ingresos y gastos
Sustituye el "presupuesto dinámico" genérico de la sección 5 por este
desglose, fiel a la estructura económica real de la ACB (donde, a
diferencia de la NBA, el patrocinio es la primera fuente de ingresos,
no la televisión):

**Ingresos:**
1. **Patrocinio principal** (naming del club/camiseta) — depende de
   reputación financiera.
2. **Publicidad extra** (patrocinadores secundarios) — depende de
   reputación y de la instalación Hospitality/Patrocinio.
3. **Televisión/retransmisión** — parte fija de liga + parte variable
   por **reparto por méritos deportivos** (posición final de temporada).
4. **Contrato de liga** (reparto centralizado de la ACB, distinto de
   TV) — también con componente por méritos.
5. **Competición europea** — premios propios de participar/avanzar en
   competición europea, aparte de la liga nacional.
6. **Taquilla** — según ocupación del pabellón × precio de entrada,
   conectado con la sección de afición (6.2.5).
7. **Merchandising** — depende de reputación y de tener jugadores
   populares/estrella en plantilla.

**Gastos:**
- Salarios de jugadores.
- **Mantenimiento anual de las 7 instalaciones** (6.2.2).
- Cuerpo técnico — partida ya anotada pero **con importe pendiente de
  definir** cuando se diseñe esa entidad (ver 6.2.7).

#### 6.2.7 Cuerpo técnico
No existe todavía como entidad propia — de momento el usuario ES el
entrenador/presidente (rol único, ver sección 8). Pendiente de sesión de
diseño futura (ayudantes, preparador físico dedicado, etc.), momento en
el que también se definirá su coste salarial exacto dentro de gastos.

#### 6.2.8 ADN de Club
Cada club tiene un **rasgo de identidad histórica** (ej. cantera, ritmo
alto, defensa, veteranía) que:
- Sesga el tipo de jugadores que genera la Cantera/Academia (6.2.3).
- Da un **bonus de moral** cuando el equipo juega conforme a su
  tradición, y una **penalización** (descontento de afición) cuando la
  traiciona sistemáticamente.

#### 6.2.9 Rivalidades
Dos tipos, ambos activos desde ya:
- **Rivalidades fijas**, por historia/geografía (derbis tradicionales).
- **Rivalidades dinámicas**, que emergen durante la partida por competir
  repetidamente por los mismos objetivos (título, permanencia, plaza
  europea).

Efecto: bonus de moral y de asistencia/ocupación del pabellón en esos
partidos concretos.

#### 6.2.10 Historia y leyendas de club
Sistema completo de niveles automáticos, inspirado en Football Manager:
**Predilecto → Ídolo → Leyenda**, calculado según títulos ganados,
premios individuales, y actuaciones destacadas en derbis/rivalidades. El
estatus puede mantenerse aunque el jugador abandone el club.

#### Pendiente para sesiones de diseño futuras (Equipo)
- Sistema completo de categorías inferiores reales (infantil, cadete,
  junior...) con sus propias plantillas y progresión — ver 6.2.3.
- Club filial/vinculado en 2ª división para ceder canteranos — ver
  6.2.3.
- Cuerpo técnico como entidad propia y su coste salarial — ver 6.2.7.
- Fórmula numérica exacta del efecto del Departamento de
  Análisis/Dirección Deportiva sobre fichajes y tácticas — ver 6.2.2.

## 7. Simulación de partidos

Nivel de detalle mostrado al usuario: **medio** — por cuartos, con
eventos destacados (ej. tapón decisivo, triple sobre la bocina, parcial
de anotación, lesión durante el partido). No es simulación jugada a
jugada narrada completa.

**Importante**: el CÁLCULO INTERNO por debajo sí es granular —
posesión a posesión — aunque el resultado que ve el usuario se agregue y
muestre por cuartos. Enfoque **europeo/FIBA/ACB**, evitando
deliberadamente mecánicas específicas de NBA (salary cap, draft). La
adaptación a una eventual comparación con clubes americanos queda
pendiente para cuando se aborde esa parte del proyecto.

Referentes técnicos centrales: **Basketball GM / ZenGM** (código
público, patrón de referencia para el bucle de posesión) y
**BuzzerBeater** (por su solidez y comunidad). Se descarta el estilo NBA
2K y la nostalgia de PC Basket como referentes técnicos de cálculo.

### 7.1 Arquitectura general del bucle

- El motor simula **posesiones**, no minutos. El reloj de posesión FIBA
  es de 24 segundos máximo (se resetea a 14s si hay rebote ofensivo tras
  tocar el aro) — este es el límite duro de cada posesión, no una
  duración fija.
- **Cálculo de pace real**: la media NBA es de ~99 posesiones por equipo
  cada 48 minutos. El reloj de tiro es el mismo en FIBA (24s), así que el
  ritmo por minuto debería ser similar; lo que cambia es el total de
  minutos jugados. En un partido FIBA de 40 minutos, esto da
  aproximadamente **82-83 posesiones por equipo por partido**.
  **Corrección (detectada en sesión de depuración tras implementar el
  motor):** la duración media de una posesión NO se calcula dividiendo
  los 2400s del partido entre las 82-83 posesiones de un solo equipo
  (eso daría ~29s, cifra que aparecía aquí antes y era un error) — ambos
  equipos se turnan sobre el **mismo reloj compartido**, así que hay que
  dividir entre el total de turnos de LOS DOS equipos combinados
  (~165 turnos). Esto da una duración media real de **~14-15 segundos
  por posesión**, la mitad de lo que decía esta sección originalmente.
  Esta cifra es un punto de partida para calibración, no un valor final
  cerrado, pero la implementación debe apuntar a ~14-15s de media, no a
  ~29-30s — calibrar contra esto hasta que el número de posesiones por
  equipo y partido ronde las 82-83 reales (una implementación inicial
  puede desviarse; ajustar `pickPossessionStepSeconds`/parámetros de
  ritmo en MatchConfig hasta acercarse a esta cifra, no al revés).
- **Duración de partido como parámetro de CONFIG** (ver 7.2), no fija en
  el código: FIBA/ACB = 40 min actualmente; NBA = 48 min en el futuro,
  sin tocar ninguna fórmula interna al cambiarlo.
- **El "peso" de titular vs banquillo NO es un multiplicador artificial
  separado** — se descarta esa idea tras revisión. Al simular
  literalmente qué 5 jugadores concretos están en pista en cada
  posesión, un titular "pesa más" simplemente porque participa en más
  posesiones reales según la cuota de minutos que el usuario (como
  entrenador) le asigne en las rotaciones. El peso emerge del propio
  bucle, no necesita una regla aparte.
- Se descarta el modelo "solo resultado agregado sin posesiones": el
  cálculo posesión a posesión es la base desde el primer modelo
  implementable (nivel "b" de la investigación previa), no un añadido
  posterior.

### 7.2 CONFIG como entidad propia del motor

El `CONFIG` es una **entidad propia**, no una lista suelta de constantes.
Estructura en dos capas:

- **`CONFIG_BASE`**: universal, con todas las fórmulas y valores por
  defecto. FIBA/ACB es la base de partida.
- **`CONFIG_MODIFIERS_<competición>`**: modificadores multiplicativos
  que se aplican SOBRE la base, sin reescribirla. Ejemplo de patrón (los
  valores exactos se calibrarán cuando toque): si en FIBA la duración
  media de posesión es 1 (unidad base), en NBA podría ser
  `1 × factor_nba` (factor a determinar por investigación cuando se
  aborde esa liga). Así, añadir una competición nueva es añadir un
  archivo de modificadores, no tocar el motor.
- **Cada fórmula de acción vive en el CONFIG como datos**, no en el
  código del motor — cambiar una mezcla de atributos es editar datos, no
  reescribir lógica.

### 7.3 Estructura de las fórmulas de acción

Cada acción define en el CONFIG:

- Una **mezcla ofensiva**: 2-5 atributos SOLO del atacante, en escala
  1-20 directa (sin normalizar), con pesos ya ajustados a esa escala.
- Un **modificador defensivo**: 2-5 atributos SOLO del defensor/equipo
  defensor, definido por separado.
- Un **método de combinación** propio de la acción: **resta** (para
  tiros) o **cociente** (para pérdidas/robos/rebotes/tapón) — híbrido,
  no un único método para todas las acciones.

El número de atributos en cada mezcla (2 a 5) se decide **acción por
acción** según su complejidad real, no aplicando una plantilla fija — el
tiro libre es más simple (2 atributos) que el tiro interior (5).

### 7.3-bis Interceptos base por tipo de tiro (dificultad intrínseca)

Corrige una laguna detectada: los pesos de atributos deciden cuánto
varía la probabilidad según el jugador, pero hace falta además un
**valor de partida (intercepto) propio de cada acción**, que refleje la
dificultad intrínseca del gesto — un tiro interior es más fácil de
meter que un triple incluso con defensa presente, y eso debe reflejarse
en la fórmula, no solo en los atributos.

Investigación específica realizada sobre las tres competiciones de
referencia (Euroliga, ACB, NBA), confirmando que la **jerarquía de
dificultad es consistente entre ligas** (propiedad estructural del
propio baloncesto, no una particularidad de una liga concreta):

| Acción | Euroliga 24-25 | ACB 24-25 | NBA 24-25 | Intercepto CONFIG_BASE |
|---|---|---|---|---|
| Tiro interior (aro) | ~59,5% | ~58-60% | ~57-61% | **~58%** |
| Bandeja/finalización | (ver nota) | (ver nota) | (ver nota) | **~58%** (provisional) |
| Media distancia | ~37% | intermedio | ~40-42% | **~39%** |
| Triple | ~35,5% | ~36-40% | ~36% | **~36%** |
| Tiro libre | ~76,4% | ~73-75% | ~78% | **~76%** |

**Nota sobre Bandeja/finalización**: las estadísticas públicas
consultadas (RIM FREQ/RIM PPS de Hack a Stat) agrupan en una sola
categoría "tiros en el aro" tanto los tiros interiores con arco (poste,
gancho, bote-parado) como las bandejas en movimiento — no existe una
fuente que separe ambos gestos con datos reales. Por eso, mientras no
haya una investigación dedicada o datos de playtesting propios, Bandeja
**comparte provisionalmente el mismo intercepto que Tiro interior
(~58%)**, no porque sean la misma acción (no lo son, ver 6.1 y acciones
3-4 de 7.6), sino porque es la mejor aproximación disponible. Su propia
mezcla de atributos (Aceleración, Balance, Agresividad) y el Eje 1 en
ambos lados ya la diferencian del Tiro interior en el resultado final,
aunque partan del mismo punto de partida.

Estos interceptos forman parte de `CONFIG_BASE` (FIBA/ACB, ver 7.2) y se
combinan con la mezcla de atributos (ofensiva − defensiva, o cociente
según la acción) para dar la probabilidad final. Los datos de NBA quedan
anotados aquí como referencia directa para cuando se aborde el futuro
`CONFIG_MODIFIERS_NBA` — la NBA tiende a interceptos de media distancia
y tiro libre algo más altos, útil saberlo de antemano.

### 7.4 Modificador de Altura/Envergadura/Peso

Sistema aparte, no uno de los 2-5 atributos de la mezcla — se aplica
DESPUÉS de calcular la fórmula base de atributos de cada acción. Se
apoya en los nuevos Datos Físicos Corporales de 6.1 (Altura, Envergadura,
Peso). Basado en investigación específica (ver nota de evidencia al
final de esta sección): dos ejes independientes, no uno solo.

**Eje 1 — Envergadura relativa** (envergadura − altura del jugador):
- **Beneficia**: Tiro interior, Bandeja/finalización, Rebote (ofensivo y
  defensivo), Tapón, Robo defensivo.
- **Perjudica levemente**: precisión de Tiro exterior (triple/media
  distancia) — evidencia real: los mejores tiradores de referencia
  (Curry, Bane, Redick) tienden a envergadura corta relativa a su altura.
- En acciones donde **ambos jugadores enfrentados** tienen envergadura
  relevante (ej. Tiro interior, Rebote), el Eje 1 se aplica a AMBOS por
  separado — el efecto neto es la diferencia entre ambos modificadores.

**Eje 2 — Altura/Peso vs Agilidad** (umbral de referencia: ~2.05-2.10m,
punto donde la evidencia de "cuerpo grande = más difícil cambiar de
dirección" es más clara; no existe un umbral universal exacto publicado,
así que este es el mejor ancla disponible, ajustable en CONFIG):
- Por encima del umbral, un **pequeño "impuesto físico" se resta del
  propio atributo Agilidad/Velocidad** del jugador — NO lo sustituye ni
  le pone un tope artificial. Un jugador excepcional (ej. un "caso
  Wembanyama": muy alto pero generado con Agilidad alta) sigue siendo
  ágil para su tamaño, solo con un descuento proporcional, nunca
  anulado.
- Afecta indirectamente a: **Defensa perimetral** (peor capacidad de
  seguir a manejadores rápidos) y **Pérdida de balón/velocidad en
  transición** — NO afecta directamente al manejo de balón ofensivo del
  propio jugador alto (esto se descartó tras investigación: no hay
  evidencia de que la altura en sí perjudique el bote/manejo propio,
  solo la capacidad de defender el perímetro por agilidad).

**Nota de implementación (confirmada al construir el motor)**: ninguna
mezcla del catálogo de 7.6 usa un atributo suelto llamado
"Agilidad"/"Velocidad" (usan `perimeterDefense`, `interiorDefense`,
`stealing`, `ballHandling`, etc.). Por eso, el "impuesto físico" del
Eje 2 se aplica sobre el **rating compuesto final** del lado marcado en
la acción (después de mezclar sus atributos, antes de convertir a
probabilidad), no sobre un atributo aislado — con el mismo tope acotado
(máx. ~3 puntos sobre la escala 1-20). Esto conserva la protección del
caso "Wembanyama": el impuesto es una resta fija, no un porcentaje, así
que un jugador alto con buen `perimeterDefense`/`interiorDefense` sigue
quedando por delante de uno sin esos atributos, solo con un descuento
proporcional menor en términos relativos.

Ambos ejes **pueden coexistir** sobre el mismo jugador en distintas
acciones del mismo partido (ej. un pívot recibe el modificador de Eje 1
en tiro interior Y el de Eje 2 si defiende en el perímetro).

### 7.5 Presión de Momento (sistema transversal)

Modificador que afecta a **todas** las fórmulas de acción por igual, no
solo al tiro libre — no es lo mismo faltar 5 minutos ganando de 30 que
ganando de 4, ni faltar 1 minuto ganando de 15 que de 1.

- **Cálculo único por posesión**: `presión = f(tiempo_restante,
  diferencia_marcador)`, un valor de 0 (mínima tensión) a 1 (máxima
  tensión: últimos segundos, marcador ajustado). Se calcula UNA vez por
  posesión y lo consultan las fórmulas de todas las acciones por igual —
  no hay una fórmula de presión distinta por tipo de acción.
- **Efecto**: a mayor presión, más peso ganan los atributos MENTALES
  (Decisión bajo presión, Concentración, Temperamento, Consistencia)
  dentro de cada mezcla, a costa de los atributos técnicos puros.
- **Experiencia como modulador, no como amortiguador de redistribución**:
  la Experiencia añade un **bonus directo, acotado con un tope máximo**,
  a los atributos mentales relevantes cuando la presión es alta.
  - Un veterano con mentales mediocres y mucha Experiencia mejora su
    efectivo bajo presión (ayuda real, sin volverlo un crack).
  - Un joven con mentales altos pero poca Experiencia NO se ve
    perjudicado por su falta de experiencia — simplemente no recibe el
    bonus extra que sí recibe el veterano; su nivel mental ya alto se
    mantiene tal cual.
  - El tope del bonus (valor exacto ajustable en CONFIG, orden de
    magnitud +2/+3 puntos sobre el atributo) existe explícitamente para
    que la experiencia complemente el talento mental real sin
    sustituirlo ni desbalancear a jugadores jóvenes excepcionales.

### 7.5-bis Consistencia (ruido transversal) y Fatiga

Dos sistemas transversales adicionales, definidos tras auditoría de que
no tenían mecanismo real conectado pese a estar en la ficha de jugador.

**Consistencia** — deja de ser un atributo de una mezcla concreta (se
retira de Tiro exterior donde estaba antes) y se convierte en el
modificador transversal que define el **ruido/varianza (σ)** aplicado a
TODAS las probabilidades de ese jugador, en todas las acciones: alta
Consistencia = rinde casi igual siempre (σ bajo); baja Consistencia =
más variable posesión a posesión, a veces mucho mejor y a veces mucho
peor de lo esperado (σ alto).

**Fatiga** — mecanismo real conectado a Energía (estado dinámico de
6.1), antes solo mencionado conceptualmente. **Modelo de consumo
detallado y cerrado en la sesión de Alineaciones/Rotación (ver 7.11,
que es la referencia completa)**; resumen aquí para no perder la
conexión con Presión de Momento y el catálogo de acciones:
- **Consumo en dos componentes** (detalle completo en 7.11): un
  **desgaste general** por estar en pista (el componente mayor,
  con jerarquía según la posición que el jugador ocupa EN ESA JUGADA
  concreta — base > ala > interior) más un **desgaste menor** por
  intervenir activamente en la acción que resuelve esa posesión
  concreta (7.6). Ambos modulados por el atributo Resistencia (mayor
  Resistencia = consume menos Energía por la misma carga).
- **Efecto**: afecta con **impacto leve** a las acciones de precisión de
  tiro (Tiro exterior, Tiro media distancia, Tiro interior, Bandeja) y
  con **impacto mayor** a las acciones físicas puras (Salto, Velocidad,
  Agilidad, y por tanto Rebote, Robo, Defensa perimetral).
- **Conexión con Falta defensiva (7.6, Bloque B)**: la Fatiga también
  sube la `TendenciaAFalta` efectiva de un defensor — un jugador cansado
  llega tarde a las ayudas y comete más faltas.
- **Recuperación entre partidos**: cerrada en 7.11 (curva no lineal
  modulada por el atributo Recuperación, con gancho pendiente al futuro
  tipo de entrenamiento) — ya no es un hueco de diseño abierto, aunque
  el módulo de Entrenamiento en sí siga pendiente (sección 9).

### 7.6 Catálogo completo de acciones

Auditoría de coherencia realizada: se revisó qué atributos de la ficha
de Jugador (6.1) pertenecen realmente al Motor de Partido frente al
futuro Motor de Progresión (Ambición, Profesionalidad, Liderazgo,
Trabajo en equipo NO pertenecen a ninguna fórmula de partido — deciden
la curva de carrera del jugador, no el rendimiento en un partido
concreto; Trabajo en equipo ya tiene hogar en ADN de Club, 6.2.8). Con
esta depuración, el catálogo se organiza en tres bloques.

#### Bloque A — Acciones Base (10)

1. **Triple** — ofensiva: `TiroExterior + DecisiónBajoPresión +
   VisiónJuego`; defensiva: `DefensaPerimetral + Anticipación`; resta;
   Eje 1 perjudica al tirador. (Separado de Media distancia tras
   revisión — son atributos técnicos distintos en 6.1.)
2. **Tiro de media distancia** — ofensiva: `TiroMediaDistancia +
   DecisiónBajoPresión + VisiónJuego`; defensiva:
   `DefensaPerimetral + Anticipación`; resta; sin modificador de Eje 1
   (la envergadura afecta menos a un tiro más cercano con arco más
   directo que el triple).
3. **Tiro interior** — ofensiva: `TiroInterior + Salto + Fuerza`;
   defensiva: `DefensaInterior + Tapón + Posicionamiento`; resta; Eje 1
   en ambos lados.
4. **Bandeja/finalización** (penetración en movimiento, distinta de
   tiro interior) — ofensiva: `Bandeja + Aceleración + Balance +
   Agresividad`; defensiva: `DefensaInterior + Fuerza + Posicionamiento`;
   resta; Eje 1 en ambos lados.
5. **Tiro libre** — ofensiva: `TiroLibre + Concentración`; sin
   defensiva (no hay defensor activo); combinación directa; sujeto al
   sistema de Presión de Momento (7.5) igual que las demás.
6. **Pérdida de balón** — ofensiva: `ManejoBalón + VisiónJuego + Pase +
   Balance`; defensiva: `Robo + DefensaPerimetral + Agresividad`
   (incluye Robo explícitamente, corregido tras revisión); cociente;
   Eje 2 sobre el atacante.
7. **Robo de balón** — ofensiva (quien intenta robar):
   `Robo + Anticipación + DefensaPerimetral` (Defensa perimetral añadida
   tras revisión) + `ÉticaDeTrabajo` (perseguir la jugada con
   intensidad); defensiva (quien resiste, manejando):
   `ManejoBalón + VisiónJuego`; cociente. **Ambos ejes físicos aplican
   sobre quien intenta robar** (corregido: 7.4 ya establecía que el
   Eje 1 beneficia el robo defensivo, pero se quedó fuera de esta
   entrada): Eje 1 (envergadura relativa) beneficia el alcance para
   interceptar el balón; Eje 2 (altura/peso) penaliza si el defensor es
   excesivamente alto/pesado y pierde agilidad para reaccionar. Ambos
   coexisten sobre el mismo jugador, tal como permite 7.4 (ej. un
   pívot largo puede tener buen alcance de robo por Eje 1, pero perder
   parte de esa ventaja por Eje 2 si además es muy pesado).
8. **Rebote** (mismo patrón para ofensivo y defensivo) — lado
   reboteador: `Rebote + Salto + Fuerza` + `ÉticaDeTrabajo` (ir a buscar
   el rebote en vez de quedarse parado); lado rival en pugna:
   `Rebote + Salto + Posicionamiento`; cociente entre ambos; Eje 1 en
   ambos lados por separado.
9. **Tapón** — ofensiva (taponador): `Tapón + Salto + Anticipación`;
   defensiva (finalizador resistiendo): `Bandeja_o_TiroInterior (según
   la acción taponada) + Fuerza + DecisiónBajoPresión`; cociente; Eje 1
   fuerte sobre el taponador.
10. **Lucha por balón suelto** (nueva — balón vivo sin control claro:
    rebote que bota extraño, pase mal interceptado, forcejeo) —
    simétrica, sin bando ofensivo/defensivo fijo: `Fuerza + Agresividad +
    Balance` en ambos lados; cociente directo. Quien gana inicia nueva
    posesión de su equipo (24s si viene de fuera, 14s si el balón tocó
    aro).

#### Bloque B — Caminos de Reglamento (3)

11. **Falta defensiva** (fuera de tiro) — probabilidad:
    `TendenciaAFalta(defensor) + Fatiga(defensor)` (ver 7.5-bis, la
    Fatiga sube la tendencia efectiva); resultado: tiros libres si el
    atacante está en bonus, si no saque de banda con el mismo reloj.
12. **Falta en tiro** (con sus 3 variantes) — probabilidad:
    `TendenciaAFalta(defensor) + Fatiga(defensor)` vs
    `Fuerza + Agresividad(atacante penetrando)`; cociente; resultado: si
    falla el tiro, 2 tiros libres (3 si era triple); si anota pese a la
    falta, "and-one" con 1 tiro libre extra.
13. **Violación de reloj de posesión** (24s agotados) — probabilidad
    base fija muy baja, sube con Ritmo de posesión muy pausado (acción
    17) combinado con mala VisiónJuego colectiva del equipo; resultado:
    pérdida automática, cambia el turno.

#### Bloque C — Acciones Especiales (moduladores contextuales, 8)

Situaciones de juego que modifican temporalmente cómo se resuelven las
acciones base — no son acciones completamente nuevas e independientes.

14. **Contraataque** — se activa en los **primeros 3 segundos** de la
    nueva posesión tras Pérdida de balón, Tapón, o Rebote defensivo
    largo (uno que se aleja del aro, no un rebote corto recogido cerca
    de la zona). Si se resuelve una Bandeja dentro de esa ventana,
    recibe bonus modulado por Aceleración. Pasados los 3s sin
    resolverse, desaparece el bonus y la posesión sigue con fórmulas
    normales.
15. **Tapón con mate** (variante de notabilidad, no de probabilidad) —
    cuando el margen del compuesto en la acción 9 (Tapón) es amplio, se
    resuelve como evento de alta notabilidad (7.7), sin cambiar la
    fórmula en sí.
16. **Tiro sobre la bocina de posesión** (<3s de los 24s del reloj) —
    sube la Presión de Momento local de esa jugada; baja levemente la
    probabilidad base de acierto (tiro forzado).
17. **Tiro sobre la bocina de cuarto/partido** (últimos segundos del
    reloj de partido) — Presión de Momento al máximo (7.5); candidato
    automático de alta notabilidad si entra (7.7).
18. **Ritmo de posesión** (rápido vs. pausado, ligado al ADN de Club,
    6.2.8) — modula la mezcla de probabilidades entre "tiro rápido de
    menor calidad" (más contraataque) y "posesión trabajada" (más
    pases, mejor tiro esperado, pero más riesgo de violación de reloj,
    acción 13, si se pasa de rosca).
19. **Últimos segundos sin tiempo de jugada completa** — cuando quedan
    pocos segundos del cuarto y no ha habido tiempo de organizar el
    ataque: sube la probabilidad de tiro forzado y de violación de
    reloj (acción 13).
20. **Parcial de anotación en marcha** — detectado por ventana
    deslizante (7.7). Aplica un pequeño bonus de Moral/Racha
    **compartido a nivel de equipo** mientras el parcial esté activo,
    no solo individual como la Racha normal (7.9).
21. **Falta técnica/antideportiva** (poco frecuente) — ligada a
    Temperamento muy bajo bajo Presión de Momento muy alta. Puede
    escalar a expulsión si se repite (mecanismo exacto pendiente,
    conecta con futuro sistema disciplinario).

#### Bloque D — Estadística derivada (no forma parte del bucle de posesión)

22. **Asistencia** (estadística simplificada, no modelada dentro del
    bucle de posesión) — cuando se anota un tiro de campo, se calcula
    una probabilidad de asistencia según el tipo de tiro (mayor en tiro
    interior/bandeja, menor en triple/media distancia), y si se cumple,
    se asigna a un jugador del quinteto ofensivo distinto del anotador,
    ponderado por VisiónJuego + Pase de los candidatos. Es una
    asignación posterior a la canasta ya decidida, no un pase real
    simulado dentro de la posesión.

    **Decisión explícita de alcance, pendiente de revisión futura**:
    esta versión simplificada NO hace que un buen pasador genere una
    MEJOR ocasión de tiro (no sube la probabilidad de acierto del
    tirador) — solo reparte el "crédito" estadístico de una canasta que
    ya se decidió por las fórmulas de tiro normales. Queda pendiente
    para una sesión de diseño futura mover esto dentro del propio bucle
    de posesión: un buen manejador de balón (VisiónJuego + Pase altos)
    debería poder generar un pase que mejore la probabilidad de acierto
    del compañero que recibe el balón (ej. un modificador positivo
    aplicado a la fórmula de tiro del receptor cuando el pase previo
    fue de calidad alta), no solo determinar a quién se le apunta la
    asistencia después del hecho. Esto implicaría rediseñar el orden de
    resolución de la posesión (decidir si hay pase de asistencia ANTES
    de resolver el tiro, no después) y probablemente separar la
    elección de tirador de la elección de ballHandler actual. No
    implementar esto ahora — solo dejar la intención registrada para
    cuando se aborde el módulo de Tácticas o una revisión dedicada del
    bucle de posesión (7.6).

    **Nota de implementación**: las probabilidades por tipo de tiro son
    constantes heurísticas locales de `MatchEngine.js`
    (`ASSIST_PROBABILITY_BY_SHOT_TYPE`), no de `CONFIG` — mismo patrón
    que `STARTER_WEIGHT`/`BENCH_WEIGHT` (placeholder de Fase 1, ya en el
    motor sin pasar por `MatchConfig.js`). Punto de partida razonable a
    calibrar después con playtesting, no un número cerrado.

**Estadísticas derivadas del boxScore** (sesión de retoques de
estadísticas): además de las estadísticas registradas acción a acción
(puntos, tiros, rebotes, robos, tapones, pérdidas, faltas, y ahora
Asistencia), cada línea de `boxScore` incluye tres campos calculados a
partir de las anteriores, no de una fórmula nueva de simulación:
minutos jugados (ya existían en `Rotation.js`, solo se exponen en el
boxScore), +/- (diferencial de puntos del equipo mientras el jugador
estuvo en pista) y Valoración (índice de valoración FIBA/ACB/Euroliga,
PIR). Ninguno de los tres modifica el resultado del partido — son
lectura, no simulación.

**Pendientes explícitos, confirmados, para el futuro módulo de
Tácticas** (aún no diseñado): **Bloqueo/pick-and-roll** (jugada de
equipo coordinada, el modelo actual es 1 vs 1 por acción), **Tiempo
muerto táctico** (decisión del entrenador que rompe el ritmo/racha del
rival), **Falta táctica intencionada** (decisión del entrenador en
tramo final para parar el reloj). Los tres dependen de decisiones del
usuario como entrenador que el módulo de Tácticas aún no modela.

**Pendiente de cierre**: los pesos numéricos exactos de todas las
fórmulas del Bloque A y B son un punto de partida para calibración, no
valores finales — lo fijado en esta sección es la ESTRUCTURA (qué
atributos entran, en qué lado, con qué método de combinación), sujeta a
una pasada final de ajuste tras pruebas de simulación masiva.

### 7.7 Eventos destacados (sin narrar cada posesión)

Cada posesión simulada internamente recibe una **puntuación de
notabilidad** = leverage (importancia del momento, mismo concepto que
Presión de Momento en 7.5) × rareza del evento × magnitud. Solo se
muestran al usuario los eventos de mayor notabilidad por cuarto (2-4
aprox.), nunca la simulación completa. Detección de candidatos: tiro
sobre la bocina (últimos segundos del cuarto), tapón de alto leverage,
parcial de anotación (racha detectada en ventana deslizante de
posesiones), lesión (siempre se muestra).

### 7.8 Factor cancha

Modula el rendimiento del equipo local con fórmula basada en
**ocupación × satisfacción × importancia del partido** (más efecto en
derbis/playoffs), ya definida en la ficha de equipo (6.2.5). Ancla de
calibración real: estudios citan una ventaja de jugar en casa de ~2.1
puntos con público lleno frente a ~0.4 puntos sin público — usar como
referencia de magnitud al implementar, no un número arbitrario. Se
aplica como pequeños modificadores distribuidos por posesión, nunca
como suma final visible de puntos.

### 7.9 Racha/momento anímico

Ya definida como estado dinámico oculto en 6.1 (Racha/momento anímico):
existe en los datos, nunca se muestra en la interfaz. Aplica un
modificador acotado (pequeño, del orden de unos pocos puntos
porcentuales) a la probabilidad de acierto del jugador "caliente", con
decaimiento rápido (memoria de pocas posesiones).

### 7.10 Prórroga

Hueco de diseño detectado durante la depuración del motor implementado
(nunca se había discutido hasta entonces): un partido de baloncesto real
**nunca termina en empate**. Regla confirmada, fiel al reglamento real
FIBA/ACB:

- Si el marcador está empatado al final del 4º cuarto, se juega una
  **prórroga de 5 minutos**.
- Se juegan **tantas prórrogas de 5 minutos como hagan falta** hasta que
  el marcador quede desempatado al final de una de ellas.
- **Las faltas de equipo (para el bonus de tiros libres) se resetean al
  inicio de cada prórroga**, igual que se resetean al inicio de cada
  cuarto normal.
- Las faltas personales de cada jugador (para la descalificación a 5)
  **siguen acumulando sin resetearse** — son de partido completo, no por
  período.

### 7.11 Alineaciones, Rotación y Desgaste/Energía

Sesión de diseño dedicada: el motor asumía (7.1, 7.5-bis) que existía
una asignación de minutos/posición en pista por jugador, sin haberla
definido nunca formalmente. Esta sección la cierra, junto con el modelo
de desgaste y recuperación de Energía que depende directamente de ella.

#### 7.11.1 Convocatoria y posición declarada

- La convocatoria de partido sigue la regla ya fijada en 6.2 (mínimo 8,
  máximo 12 jugadores de la plantilla total).
- Para cada jugador convocado, el usuario declara **una posición para
  ese partido concreto**, elegida entre las posiciones en las que el
  jugador tiene un nivel razonable según su mapa de 5 posiciones (6.1):
  la de valor 20 (su principal) o cualquiera con un valor que el
  usuario considere jugable como secundaria — el motor no impone un
  umbral duro aquí, es una decisión del usuario. Un jugador polivalente
  puede así jugar en una posición distinta a su principal en un
  partido dado (ej. por baja de otro jugador en esa posición), sin que
  eso sea una "emergencia" — es una elección deliberada del usuario,
  distinta de la polivalencia de emergencia de 7.11.3, que es una
  decisión automática del motor durante el partido.

#### 7.11.2 Rotación: cuotas de minutos + quintetos fijos

- El usuario asigna a cada convocado una **cuota de minutos objetivo**
  (0 a 40, duración FIBA/ACB de `CONFIG_BASE`).
- **Validación estricta antes de poder guardar/jugar la alineación**:
  para cada una de las 5 posiciones, la suma de minutos de los
  jugadores declarados en esa posición debe ser exactamente 40. Si
  alguna posición no cuadra, el sistema **bloquea el guardado** y
  señala qué posición(es) están descuadradas y en cuánto — no hay
  normalización automática ni aceptación de un desajuste silencioso.
- Opcionalmente, el usuario puede fijar **quintetos concretos por
  franja** del partido (ej. "este quinteto de cierre en el último
  cuarto si vamos ganando"). Mientras una franja fija esté activa,
  **congela** el reparto automático de rotación; al salir de la franja,
  el reparto automático se retoma con normalidad.
- Fuera de las franjas fijadas, el motor reparte las sustituciones
  automáticamente para intentar cumplir la cuota de minutos de cada
  jugador, respetando en todo momento que las 5 posiciones estén
  cubiertas en pista.
- **Ventanas de sustitución automática**: el motor no sustituye a mitad
  de una jugada viva. Las sustituciones automáticas solo se evalúan en
  **fin de cuarto** y en **paradas de juego** (falta o violación,
  Bloque B de 7.6) — puntos de corte naturales del partido real. Dentro
  de esas ventanas, el motor prioriza sacar a quien más se haya
  alejado (por encima) de su ritmo de cuota esperado a esa altura del
  partido, y meter a quien más por debajo esté.

#### 7.11.2-bis Minutos de la basura ("garbage time")

Excepción explícita a la validación estricta de cuotas de 7.11.2,
activable/desactivable por el usuario.

- **Checkbox "Permitir minutos de la basura"**: vive **por partido, en
  la pantalla de alineación** (no es una config global del usuario). Si
  está desactivado, esta norma no se aplica nunca y rige solo la lógica
  normal de rotación de 7.11.2. Si está activado, se aplican las
  condiciones siguientes. La alineación ya fijada por el usuario
  (titulares, suplentes, cuotas) **se mantiene siempre** — esta norma
  solo decide cuándo se ignora temporalmente esa cuota, nunca cambia
  quién está convocado ni en qué slot.
- **Condición de activación — equipo que va ganando**: desde la mitad
  del 3er cuarto en adelante, si la diferencia de puntos a su favor
  llega a **20 o más**.
- **Condición de activación — equipo que va perdiendo**: desde la mitad
  del 4º cuarto en adelante, si la diferencia de puntos en su contra
  llega a **20 o más**. El umbral de tiempo es más tardío que el del
  ganador de forma deliberada: un equipo que va perdiendo debe seguir
  intentando remontar mientras quede margen real de partido, y solo
  entra en minutos de la basura cuando ya apenas queda tiempo para
  lograrlo.
- **Mientras está activa** para un equipo: ese equipo deja de exigir
  el cumplimiento de la cuota de 40 minutos por posición (7.11.2) y da
  minutos a su banquillo, con este orden de entrada dentro de cada
  posición: primero el **segundo slot de suplente** (el último), luego
  el **primer slot de suplente**; si ninguno de los dos puede entrar
  (p. ej. lesión, expulsión, o sin cuota restante), se queda el
  **titular** en pista en vez de dejar la posición sin cubrir.
- **Desactivación (histéresis)**: una vez activa, se mantiene activa
  aunque la diferencia fluctúe, hasta que la diferencia se reduzca a
  **10 puntos o menos** — en ese momento ese equipo vuelve a la lógica
  normal de rotación/cuotas de 7.11.2. Cada equipo evalúa su propia
  activación/desactivación de forma independiente (uno puede estar en
  minutos de la basura mientras el otro sigue en rotación normal).

#### 7.11.3 Polivalencia de emergencia

Cuando, durante el reparto automático de rotación, una posición se
queda sin cobertura (los jugadores asignados a ella agotaron su cuota,
o no hay convocados suficientes en ella):

- El motor busca, entre los convocados que **todavía tengan minutos
  disponibles**, el que tenga el **mayor nivel** en esa posición dentro
  de su mapa de 5 posiciones (6.1) combinado con la **menor distancia
  posicional** a la posición vacía. La distancia se mide como
  diferencia de índice en el espectro Base(1)–Escolta(2)–Alero(3)–
  Ala-pívot(4)–Pívot(5) (ej. Alero→Ala-pívot = distancia 1; Base→Pívot
  = distancia 4). Como el mapa de 5 posiciones (6.1) siempre tiene un
  valor para cada posición, esta búsqueda no necesita un caso especial
  para "no la tiene habilitada" — simplemente ese candidato tendrá un
  nivel bajo (cercano a 1) en la fórmula de penalización de abajo, y el
  motor puede seguir usándolo sin bloquearse.
- **Desempate**: si hay varios candidatos a la misma distancia mínima,
  gana el que tenga más cuota de minutos restante.

**Penalización por polivalencia**: un jugador que cubre una posición
distinta a la que se le declaró (7.11.1) sufre una penalización de
rendimiento en esa jugada:

`penalización_final = penalización_base(distancia_posicional) ×
(1 − nivel_del_jugador_en_esa_posición / 20)`

- `penalización_base` crece con la distancia posicional (a calibrar en
  CONFIG, como el resto de fórmulas del motor).
- El nivel usado es directamente el valor de esa posición en el mapa de
  6.1 (20 si fuera su principal, caso que no debería darse aquí ya que
  si es su principal no hay emergencia; el valor 1-20 que corresponda
  en cualquier otro caso, incluyendo valores bajos para posiciones en
  las que el jugador apenas tiene competencia).
- Efecto práctico: un jugador con nivel alto en la posición de
  emergencia apenas sufre penalización (tiene sentido, básicamente ya
  sabe jugar ahí); un jugador con nivel bajo en esa posición sufre la
  penalización casi completa.

#### 7.11.4 Desgaste de Energía dentro del partido

Amplía el mecanismo de Fatiga de 7.5-bis con el modelo acordado:

- **Dos componentes por posesión, para cada uno de los 5 jugadores en
  pista de un equipo** (los 5 desgastan siempre algo, no solo quien
  interviene directamente en la acción resuelta por el motor):
  1. **Desgaste general** (componente **mayor**) — por el solo hecho de
     estar en pista corriendo, marcando sin balón, replegando, etc.
     Lleva una **jerarquía según la posición que el jugador ocupa EN
     ESA JUGADA** (no su posición principal fija): posiciones más
     exteriores desgastan más que las interiores (base > ala > pívot),
     reflejando el mayor recorrido/carga de los exteriores en el juego
     real. Esta jerarquía vive como multiplicador en CONFIG (coherente
     con 7.2: cada fórmula vive como datos, no como lógica aparte).
  2. **Desgaste por intervención** (componente **menor**) — extra
     aplicado solo a los jugadores directamente implicados como
     atributo en la acción que el motor resuelve esa posesión (7.6):
     quien tira, quien defiende el tiro, quien lucha el rebote, etc.
- **Modulación por Resistencia**: el desgaste bruto (general +
  intervención) se reduce según el atributo Resistencia del jugador
  (1-20) — más Resistencia, menor pérdida de Energía por la misma
  carga de juego. Fórmula estructural:

  `pérdida_energía_posesión = [desgaste_general(posición_en_jugada) +
  desgaste_intervención(acción)] × (1 − factor_resistencia)`

  con `factor_resistencia` acotado (nunca reduce el desgaste a cero;
  hasta el jugador con mejor físico se cansa jugando 40 minutos reales).
- Los números exactos de ambos componentes y de `factor_resistencia`
  quedan, como el resto del catálogo de 7.6, como estructura fijada
  pendiente de calibración final tras pruebas de simulación.

#### 7.11.5 Recuperación de Energía entre partidos

Cierra el hueco que 7.5-bis dejaba explícitamente pendiente ("fuera del
ámbito de un partido concreto"):

- **Curva no lineal**: la Energía perdida se recupera más rápido en el
  primer día de descanso y progresivamente más despacio en los días
  siguientes (modelo tipo decaimiento exponencial inverso sobre el
  hueco de energía restante) — no es una recuperación lineal fija por
  día.
- **Atributo Recuperación (1-20)** actúa como **multiplicador de
  velocidad** sobre esa misma curva, no como una curva distinta de
  forma: un jugador con Recuperación alta avanza más rápido por la
  misma curva (llega antes al mismo punto de energía repuesta), no
  tiene una forma de curva diferente a la de otro jugador.
- **Gancho pendiente explícito hacia el futuro módulo de Entrenamiento**
  (sección 9, aún sin diseñar en detalle): el tipo de entrenamiento que
  el club realice modulará esta curva como un trade-off — un
  entrenamiento de recuperación acelerará el cierre del hueco de
  energía pero reducirá la ganancia de progresión técnica/física de
  esa sesión; un entrenamiento intenso hará lo contrario (mejor
  progresión, recuperación de Energía más lenta). La mecánica exacta de
  tipos de entrenamiento (qué opciones existen, cómo se eligen, qué
  otros efectos tienen) se diseñará en la sesión dedicada a Progresión/
  Entrenamiento — aquí solo queda fijado que esta palanca existirá y
  cómo interactúa con la curva de recuperación.

**Cierre de integración** (sesión de diseño de Calendario, ver 3.3): la
fórmula (`Recovery.js`, ya construida) llevaba desde el bloque C sin
ningún punto real que la invocara — nada calculaba "días" ni llamaba a
`applyRestRecovery`. Con la entidad Calendario (3.3) ya resuelto de
dónde salen los días de descanso reales, esta sesión cierra la
integración:

- **Nuevo campo en `dynamicState`**: `lastMatchDate` (fecha ISO del
  último partido en el que el jugador jugó minutos reales, `null` si
  aún no ha debutado en la temporada). Se actualiza únicamente para
  jugadores con minutos > 0 en el partido recién jugado — un convocado
  que no llegó a pisar la pista no actualiza esta fecha (ver 3.3.4).
- **Punto de invocación**: justo después de resolverse cada partido
  (Liga, Copa, Playoff, Ascenso — el mismo punto para las 4
  competiciones, vía el resolver compartido ya existente en la UI), se
  recorre la plantilla completa de cada equipo implicado (no solo los
  11-12 convocados) y se llama a `Recovery.applyRestRecovery` con los
  días reales transcurridos desde el `lastMatchDate` de cada jugador
  hasta la fecha del partido recién jugado — un jugador lesionado o
  descartado también recupera Energía con el paso de fechas de
  calendario, aunque no haya jugado.
- **Jugador sin `lastMatchDate` previo** (aún no ha debutado en la
  temporada, o es la jornada 1): no se aplica recuperación — su Energía
  de inicio de temporada (100 por defecto, ver 6.1) ya es la máxima, no
  hay hueco que recuperar.

**Estado: implementado** (`Calendar.js` + `lastMatchDate` en
`Player.js` + enganche en el resolver compartido de `game.js`),
pendiente de merge — ver PR en curso.

**Limitación real detectada y señalada explícitamente por la
implementación, no corregida en este bloque**: `Recovery` solo puede
actualizar `lastMatchDate` para el lado del partido que tenga una
alineación real construida con `Rotation.js` (hoy, únicamente el
equipo del usuario) — sin `homeLineup`/`awayLineup`, `MatchEngine`
recurre a `selectOnCourtFive`, un placeholder que elige 5 jugadores por
posesión con pesos aleatorios pero **no acumula minutos por jugador**
(no hay `rotationState.playedSeconds` sin rotación real). Sin reparto
de minutos, no hay forma de saber quién "jugó realmente" para
actualizar su fecha. Esto significa que, hoy, los otros equipos de la
liga (17 rivales en 1ª división, más los de Copa/Playoffs/Ascenso)
nunca recuperan ni desgastan Energía de forma realista entre jornadas.
Se resuelve en 7.11.7 (nueva), no inventando un reparto sintético
puntual aquí.

#### 7.11.6 Requisito de frontend — pantalla de alineación

La pantalla de alineación (aún por construir) debe mostrar, por cada
jugador convocado, junto a su asignación de quinteto/banquillo, minutos
previstos y posición deseada para ese partido (7.11.1, 7.11.2):

- **Valoración Técnica**: media de los 14 Atributos Técnicos (6.1),
  escala 1-20.
- **Valoración Física**: media de los Atributos Físicos (6.1), escala
  1-20.
- **Valoración Mental**: media de los Atributos Mentales (6.1), escala
  1-20.
- **Resistencia**: atributo directo (1-20), ya visible según 6.1.
- **Energía actual**: estado dinámico ya visible según 6.1 — dato clave
  para decidir minutos y quinteto, se muestra en esta misma pantalla.
- **Forma** (Ritmo de competición, 6.1): este estado está clasificado
  como semi-visible en 6.1 (no se expone el número interno exacto).
  **Excepción explícita a esa regla, solo para esta pantalla**: se
  muestra traducido a una escala de **1 a 5 estrellas**, manteniendo el
  espíritu semi-visible (no da el dato crudo) pero ofreciendo una señal
  clara y consistente para decidir la alineación.

**Ampliación** (sesión de diseño de frontend, referencia visual: esquema
clásico de manager de texto tipo BuzzerBeater con posiciones fijas y
dropdowns). **Decisión confirmada con Dennis al implementar esta
ampliación**: se descarta la idea de dos pantallas separadas de más abajo
(la convocatoria y los quintetos conviven en una única pantalla de
Alineación, arriba y abajo respectivamente) — le parece innecesariamente
engorroso navegar entre dos pantallas para configurar un mismo partido.
El resto de la ampliación (checkboxes de convocatoria con las
valoraciones, tabla de 3 slots por fila, validación y contador en vivo)
se mantiene tal cual está descrito debajo, solo cambia que vive en una
pantalla en vez de en dos:

- **Bloque de convocatoria**: lista de jugadores de plantilla con las
  valoraciones ya definidas arriba (Técnica, Física, Mental,
  Resistencia, Energía, Forma en estrellas) y un checkbox por jugador
  para marcarlo convocado.
- **Bloque de quintetos**: 5 filas fijas por posición (Base, Escolta,
  Alero, Ala-pívot, Pívot). Cada fila tiene exactamente **1 slot de
  titular + 2 slots de suplente** para esa posición (3 slots por fila,
  15 en total). Cada slot es un par dropdown de jugador + campo de
  minutos independiente.
  - Un mismo jugador convocado puede ocupar más de un slot (ej. titular
    en Base y suplente en Escolta), coherente con que la posición
    declarada (7.11.1) es una elección libre del usuario por partido.
  - **Los minutos de cada slot se validan por separado** contra la
    regla de 40 minutos por posición (7.11.2): el minutaje del slot
    "Base titular" y el del slot "ese mismo jugador como suplente de
    Escolta" no comparten validación entre sí — cada fila/posición
    cuadra sus propios 40 minutos de forma independiente.
  - **Los minutos de un mismo jugador SÍ se suman entre todos sus
    slots** hacia su total de minutos de partido — esa suma total (no
    el minutaje de un slot aislado) es la magnitud real que consume su
    Energía (7.11.4).
  - **Contador en vivo por posición**: mientras el usuario edita, cada
    una de las 5 filas muestra la suma actual de minutos de sus 3 slots
    frente a los 40 requeridos (ej. "35/40" vs "40/40"), actualizado al
    momento sin esperar a guardar. El bloqueo real de guardado
    (7.11.2) se mantiene igual, evaluado al confirmar la alineación.

#### 7.11.7 Alineación automática de equipos gestionados por la CPU

Cierra la limitación señalada en el cierre de 7.11.5: los 35 equipos
que el usuario no controla necesitan una alineación real construida
con `Rotation.js` (el mismo shape de `lineup.entries` de 7.11.1-7.11.3,
no un sistema aparte), para que Energía/Recuperación funcionen igual de
bien para todo el mundo, no solo para el equipo del usuario. Esta
sección diseña **cómo decide la CPU esa alineación**, reutilizando datos
que el motor ya tiene (plantilla, posiciones, valoraciones, objetivo de
temporada, clasificación) — no se introduce ningún dato nuevo en la
ficha de jugador/equipo para esto.

**Alcance de esta primera versión**: quintetos y reparto de minutos
razonables y variados por partido, con dos palancas de comportamiento
(carga de energía, e importancia del partido) — no es una IA táctica
completa (eso pertenece al futuro módulo de Tácticas, ya señalado como
pendiente en 7.6). El objetivo es que los rivales dejen de ser un
placeholder ciego, no que jueguen con inteligencia estratégica plena.

**Generación base del quinteto/rotación (cada partido, para cada
equipo CPU)**:

- Se ordena la plantilla de cada una de las 5 posiciones por
  valoración compuesta relevante (media ponderada de atributos técnicos
  + físicos + mentales pertinentes a esa posición, reutilizando el
  mismo criterio de valoración ya usado en 7.11.6 para la pantalla de
  alineación) y por Energía actual (`dynamicState.energy`) — un
  jugador con nota alta pero Energía muy baja pierde prioridad frente a
  uno algo peor pero descansado, para que la rotación varíe de forma
  creíble partido a partido en vez de repetir siempre el mismo 5 fijo.
- **Variedad deliberada**: no se elige siempre estrictamente el mejor
  disponible en cada slot — se introduce una aleatoriedad acotada
  (ponderada, no uniforme) entre los 2-3 mejores candidatos de cada
  posición para Titular/Suplente 1/Suplente 2, de forma que dos
  partidos consecutivos del mismo rival no produzcan el quinteto
  idéntico salvo que la plantilla en esa posición sea muy corta.
- El reparto de minutos por slot sigue el mismo patrón razonable que un
  usuario humano seguiría con la validación ya existente de
  `Rotation.validateLineup` (40/40 por fila): titular con mayoría de
  minutos, suplentes cubriendo el resto, sin que ningún jugador con
  Energía muy baja reciba una cuota de titular completa si hay
  alternativa razonable en el banquillo.

**Importancia del partido (agresividad competitiva)**:

- Se calcula un factor de "partido clave" por equipo CPU antes de
  generar su alineación, cruzando dos señales ya existentes en el
  motor, sin inventar ninguna nueva:
  1. **Objetivo de temporada** (`team.board.sportingGoal`, 6.2.4):
     equipos con objetivo de playoff/título tratan como clave cualquier
     partido contra rivales cercanos en la tabla que compiten por ese
     mismo tramo de clasificación; equipos con objetivo de permanencia
     tratan como clave los partidos contra rivales de la zona baja
     (los "seis puntos" de la permanencia).
  2. **Posición real en la clasificación** (`league.getStandingsTable()`
     en el momento de jugarse el partido) — la distancia en la tabla
     entre ambos equipos decide si el partido entra en la zona de
     "objetivos similares o en juego" (banda configurable en `CONFIG`,
     ej. ±3-4 posiciones alrededor de la frontera del objetivo propio).
  3. Cualquier partido de eliminatoria (Copa desde cuartos, Playoff,
     Ascenso) es SIEMPRE clave — no depende de la clasificación, ya es
     una eliminatoria por definición.
- **Efecto del factor de partido clave sobre la generación de
  alineación**: en un partido clave, la CPU prioriza más agresivamente
  su mejor quinteto disponible (menos aleatoriedad de variedad, más
  peso a la valoración pura) y acepta jugar con más minutos a titulares
  con Energía algo más baja de lo que aceptaría en un partido no clave
  — refleja que un equipo real "aprieta" en los partidos que de verdad
  le importan, a costa de desgaste. En un partido NO clave (ya con
  objetivo cumplido o inalcanzable, rival lejano en la tabla), la CPU
  da más minutos a suplentes y jugadores con Energía baja, dando
  prioridad a la recuperación de cara a partidos más importantes
  próximos — mismo principio que un usuario humano gestionando
  rotación aplicaría.
- Los pesos exactos (bandas de posiciones, cuánto se reduce la
  aleatoriedad, cuánta Energía extra se acepta gastar) quedan como
  estructura fijada pendiente de calibración, igual que el resto de
  fórmulas de 7.6/7.11 — el criterio (qué señales entran, en qué
  dirección) es lo fijado en esta sesión, no los números finales.

**Estado: pendiente de implementación** — ver prompt de Claude Code
asociado a este bloque de diseño.


### Pendiente para sesiones de diseño futuras (Simulación)
- Pesos numéricos finales calibrados de las 21 piezas del catálogo
  (7.6), y de los componentes de desgaste/penalización de polivalencia
  de 7.11 — la estructura está fijada, faltan los números definitivos
  tras pruebas de simulación masiva.
- Bloqueo/pick-and-roll, Tiempo muerto táctico, Falta táctica
  intencionada — pendientes del futuro módulo de Tácticas (7.6).
- Roles tácticos con valoración en estrellas (distintos de la posición
  en pista, ya resuelta en 7.11) — pendientes del futuro módulo de
  Tácticas (6.1).
- Constantes exactas del `CONFIG_MODIFIERS_NBA` — pendiente hasta que se
  aborde esa parte del proyecto.
- Mecánica completa de tipos de Entrenamiento (más allá de su efecto en
  la curva de recuperación de Energía, ya fijado en 7.11.5) — pendiente
  del módulo de Progresión/Entrenamiento (sección 9).
- Detalle exacto del sistema de lesiones dentro del bucle de posesión.
- Mecanismo exacto de escalado a expulsión por faltas técnicas
  repetidas (acción 21).
- Calibración final contra medias reales ACB/Euroliga (ritmo, eficiencia
  por posesión, porcentajes de tiro) una vez el motor esté implementado.

**Nota sobre fuentes de evidencia usada en este diseño**: el Eje 1
(envergadura relativa) y el Eje 2 (altura/peso vs agilidad) se basan en
evidencia real investigada — la relación envergadura↔manejo de balón
(protección del balón) y envergadura↔tiro exterior (trade-off de
mecánica) están razonablemente respaldadas; el umbral exacto de Eje 2
(~2.05-2.10m) NO tiene un número universal publicado y es una
aproximación de diseño basada en la evidencia disponible sobre
dificultad de cambio de dirección en cuerpos grandes, no un dato exacto
verificado — revisar si aparece evidencia mejor en el futuro.

## 8. Roles y control del club

Un único rol de usuario que controla:

- Fichajes y renovaciones
- Tácticas y alineaciones
- Entrenamientos y desarrollo de jugadores
- Finanzas y presupuesto
- Contratación de staff (cuerpo técnico, scouts, médicos)
- Relación con la directiva/afición (objetivos de temporada, presión)

**Nota de coherencia con 6.2.7**: "contratación de cuerpo técnico" aquí
describe la intención de diseño a largo plazo, no un sistema ya
implementable — el cuerpo técnico **no existe todavía como entidad
propia** (ver 6.2.7); de momento el usuario asume ese rol íntegramente.
Este punto se activará cuando se diseñe esa entidad en una sesión
futura.

## 9. Progresión de jugadores

*(Pendiente de definir en detalle: curvas de edad, entrenamiento,
lesiones, decadencia por edad. Se completará en una próxima sesión de
diseño antes de programar el módulo de progresión.)*

## 10. Modo Manager (futuro, derivado del modo Completo)

Mismo motor, pero sin pantallas de gestión de presidencia — pensado para
quien solo quiere las decisiones deportivas. Se construirá después de
tener el modo Completo funcional, quitando pantallas en vez de duplicando
lógica.

## 11. Plataforma

- Desarrollo en **JavaScript/HTML** (sin frameworks pesados), pensado para
  jugarse en navegador de escritorio y móvil.
- Posibilidad futura de empaquetar como app móvil (PWA o similar) sin
  rehacer el motor.

## 12. Nota sobre comercialización futura

Proyecto privado por ahora. Si se decide comercializar en el futuro:

- Quitar todos los logos/escudos oficiales (ya contemplado desde el
  principio).
- Revisar el uso de nombres reales de jugadores y clubes — probablemente
  sustituir por una capa de nombres ficticios/generados, manteniendo los
  atributos y la estructura de datos ya construida.
- Esta decisión se pospone deliberadamente; no bloquea el desarrollo
  actual.
