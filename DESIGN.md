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

### 3.4 Cierre de ciclo de temporada y pretemporada

Cierra el ciclo abierto desde el inicio del proyecto: hasta ahora una
partida podía jugar una temporada completa (liga + Copa + Playoffs/
Ascenso) pero al llegar al final no pasaba nada — no había ascensos/
descensos reales, ni temporada siguiente, ni recálculo de nada. Esta
sección define qué ocurre al terminar la temporada regular en las dos
divisiones y qué prepara la pretemporada antes de generar el nuevo
calendario.

#### 3.4.1 Las dos divisiones se simulan SIEMPRE, en paralelo

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
   próxima vez que se recalculen las dos `League` (3.4.4) su equipo
   sale ya en el grupo de 18 que le corresponde.

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
- Supercopa y competición europea (criterio de clasificación dinámico).
- Cierre de ciclo de temporada: ver 3.4, ya diseñado — quedan fuera de
  esa sección (pendientes de sesiones futuras) la renovación de
  contratos/fichajes entre temporadas, el envejecimiento/progresión de
  atributos por edad, la evolución de `reputation`/`facilities` entre
  temporadas, y el cálculo de `financialGoal`/`multiYearPlan` de la
  Junta.

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
- Roles tácticos ofensivos y defensivos con valoración en estrellas —
  **diseño cerrado en 7.12.9 y 7.12.21; implementado en TAC-2**
  (`Tactics.roleFit()`/`Tactics.bestRolesForPlayer()`, catálogos
  `OFFENSIVE_ROLES`/`DEFENSIVE_ROLES` en `src/core/Tactics.js`, mostrados en
  la pantalla de Tácticas → Roles). Siguen siendo distintos de la posición
  en pista ya resuelta en 7.11: son un refinamiento de función dentro del
  sistema, no un reemplazo.
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

**Objetivo deportivo — fórmula de cálculo**: ver 3.4.3, que define cómo
se calcula `board.sportingGoal` en cada pretemporada a partir del poder
de plantilla, la economía y la reputación del club. Esta sección
(6.2.4) sigue siendo la ficha conceptual del campo; 3.4.3 es su cálculo
real. `financialGoal` y `multiYearPlan` siguen sin fórmula de cálculo
— pendiente (ver 3.4.3 y el listado de pendientes de 3.4).

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

**Integración con el sistema táctico**: el diseño de **Bloqueo/pick-and-roll**,
**Tiempo muerto táctico** y **Falta táctica intencionada** queda cerrado en
7.12. El modelo actual sigue siendo 1 vs 1 por acción hasta que se implemente
TAC-1/TAC-5; 7.12 define cómo añadir la capa colectiva sin duplicar los
resolvers existentes de este catálogo.

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
completa: esa capa queda diseñada en 7.12.25 y se implementará por separado.
El objetivo de 7.11.7 sigue siendo que los rivales dejen de ser un placeholder
ciego en rotación, no anticipar la inteligencia estratégica de `TacticalAI`.

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
  1. **Objetivo de temporada** (`team.board.sportingGoal`, ficha
     conceptual en 6.2.4, fórmula de cálculo real en 3.4.3):
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


## 7.12 Sistema táctico — ataque, defensa y generación de ventajas

Sesión de diseño dedicada. Esta sección cierra los huecos que las secciones
6.1, 7.6 y 7.11 habían dejado expresamente pendientes respecto a roles
tácticos, acciones coordinadas de equipo, pick-and-roll, generación real de
asistencias, ajustes del entrenador, tiempos muertos, falta táctica y defensa
colectiva.

El objetivo no es añadir una capa de "bonificadores de táctica" sobre el
motor existente. La táctica debe cambiar **qué situaciones aparecen durante
una posesión, quién participa en ellas, qué respuesta defensiva se encuentra,
qué ventaja se genera y qué tipo de tiro/pérdida/falta termina resolviendo el
motor de acciones de 7.6**.

Principio rector de todo el sistema:

> **La táctica crea situaciones; los jugadores las resuelven.**

Por tanto, elegir 5-Out, Spain Pick & Roll, Drop o una defensa zonal **nunca**
concede por sí mismo `+X%` al tiro, `+X` a un atributo ni una victoria
automática contra otra táctica. El efecto aparece porque cambia el espacio,
los participantes, las ayudas, los emparejamientos, la calidad del tiro y las
lecturas disponibles. Los atributos reales del jugador, la Fatiga, la
Presión de Momento, la Consistencia, los modificadores físicos y el resto del
motor ya definido siguen decidiendo el resultado final.

**Estado:** diseño funcional cerrado en esta sección; implementación pendiente
por bloques TAC-1 a TAC-7 (7.12.25). Los valores numéricos exactos de pesos,
umbrales y modificadores permanecen pendientes de calibración masiva, igual
que en 7.6. Lo fijado aquí es la arquitectura, los conceptos, las relaciones
y la dirección de cada efecto.

### 7.12.1 Capas del sistema táctico

Una táctica de Basket Manager se divide en cinco capas independientes pero
conectadas. No se modela como una única etiqueta del tipo "Princeton" o
"Run & Gun", porque en baloncesto real conviven en un mismo equipo el spacing,
las familias de acciones, las lecturas, los roles y las respuestas a una
defensa concreta.

1. **Identidad táctica** — cómo quiere jugar normalmente el equipo:
   spacing, ritmo, prioridades ofensivas, estructura defensiva, nivel de
   presión, agresividad de ayudas, etc. Persiste entre partidos hasta que el
   usuario la modifica.
2. **Roles** — qué función ofensiva y defensiva realiza cada jugador dentro
   de esa identidad. Un jugador tiene un rol ofensivo y otro defensivo; no
   existe un único "rol táctico" que intente resumir ambos lados de la pista.
3. **Playbook** — familias de jugadas/acciones que el equipo conoce y con qué
   prioridad/familiaridad las utiliza: Horns, Spain P&R, Double Drag, DHO,
   Floppy, 5-Out Motion, etc. Una jugada no es un script con resultado fijo:
   genera una situación y varias lecturas posibles.
4. **Plan de partido (`GamePlan`)** — cambios temporales para un rival
   concreto: matchups, coberturas especiales, objetivos de ataque, cambios de
   ritmo, negar un tiro concreto, atacar a un defensor, etc. No modifica la
   táctica base de forma permanente.
5. **Ajustes en vivo** — modificaciones durante el partido entre cuartos o en
   un tiempo muerto: cobertura del P&R, matchups, presión, play-types,
   quintetos, ATO y reglas de final de partido.

La interfaz puede presentar estas capas de forma separada, pero el motor las
fusiona en un único `TacticalContext` para cada posesión.

### 7.12.2 Entidades conceptuales nuevas

El sistema requiere las siguientes entidades conceptuales. Los nombres de
archivo/clase finales pueden adaptarse al patrón del código existente, pero
**las responsabilidades no deben mezclarse dentro de `MatchEngine.js`**:

- **`TacticalProfile`** — identidad ofensiva y defensiva persistente de un
  equipo.
- **`RoleAssignment`** — rol ofensivo y rol defensivo asignados a un jugador
  dentro de un perfil táctico.
- **`PlayDefinition`** — definición data-driven de una familia de jugada:
  participantes, spacing requerido, entrada, lecturas, counters, dificultad
  de ejecución y posibles continuaciones.
- **`Playbook`** — colección de `PlayDefinition` conocidas por el equipo,
  con prioridades y familiaridad.
- **`GamePlan`** — overrides específicos para un rival/partido.
- **`PossessionPlan`** — decisión táctica concreta para UNA posesión:
  transición/media pista, play-type, jugada, participantes y primera lectura.
- **`DefensivePlan`** — respuesta defensiva concreta para esa posesión:
  shell, matchup, cobertura del bloqueo, ayudas y posibles rotaciones.
- **`AdvantageState`** — estado dinámico de la ventaja generada durante la
  posesión.
- **`TacticalContext`** — snapshot efímero que combina perfil, plan del
  partido, quinteto, marcador, reloj, familiaridad y ajustes en vivo.
- **`TacticalAI`** — lógica CPU que construye perfiles, planes de partido y
  ajustes usando exactamente las mismas reglas y costes que el usuario.

`TacticalProfile`, `RoleAssignment`, `Playbook` y su familiaridad forman parte
del estado persistente de la partida. `GamePlan` puede persistir como plantilla
reutilizable, pero sus overrides activos pertenecen al partido concreto.
`PossessionPlan`, `DefensivePlan`, `AdvantageState` y `TacticalContext` son
estado efímero del motor y no deben ensuciar la ficha permanente del jugador.

**Nota de cableado real (descubierta en TAC-1, confirmada en TAC-2):**
`index.html` es un conjunto de `<script>` clásicos sin build (ver CLAUDE.md),
así que `src/core/Tactics.js` necesita su propia etiqueta `<script>` — debe
cargar antes que `MatchEngine.js` (que lee `planPnrPossession` de
`global.BasketManager`) y después de `src/core/Rotation.js` y
`src/entities/Player.js` (de los que depende). `src/entities/Team.js`
también depende de `Tactics.TacticalProfile` (TAC-2, ver más abajo) pero NO
necesita cargar después de `Tactics.js`: `Team.js` guarda una referencia al
objeto compartido `global.BasketManager` y accede a `.TacticalProfile`
dentro del propio constructor (en tiempo de ejecución, no al cargar el
script), así que el orden real en `index.html` sigue siendo
Player → Team → ... → Rotation → Tactics → MatchEngine sin que Team.js
necesite moverse.

**Decisión de encaje TAC-1 → TAC-2 (`TacticalProfile` en `Team.js`):**
TAC-1 dejó señalado que `TacticalProfile` NO vivía todavía en `Team.js` (se
pasaba de forma efímera por `options.homeTacticalProfile`/
`awayTacticalProfile` a `MatchEngine.simulateMatch()`). Desde TAC-2,
`Team.js` persiste `this.tacticalProfile` como instancia real de
`TacticalProfile`, inicializada con valores por defecto en su constructor
(mismo patrón que `clubDNA`/`reputation`) — la nota anterior queda
desactualizada y se corrige aquí. `options.homeTacticalProfile`/
`awayTacticalProfile` sigue existiendo para tests dirigidos, con prioridad
sobre `team.tacticalProfile` si ambos están presentes.

**`RoleAssignment` (TAC-2):** no vive en un fichero/clase propia — es un
mapa simple `playerId → { offensiveRole, defensiveRole }` dentro de
`TacticalProfile.roleAssignments` (`src/core/Tactics.js`). Basta con esto
mientras no exista una necesidad real de tratarlo como entidad
independiente.

### 7.12.3 Nuevo orden de resolución de una posesión

La arquitectura actual de 7.1/7.6 decide y resuelve una acción final. El
módulo táctico añade una capa ANTES de esa resolución. Cuando 7.12 esté
implementado, el orden conceptual pasa a ser:

```
Contexto de partido
        ↓
¿Transición, early offense o media pista?
        ↓
Identidad + GamePlan + quinteto real
        ↓
Selección de play-type / jugada
        ↓
Selección de participantes y roles
        ↓
Respuesta defensiva / cobertura
        ↓
AdvantageState inicial
        ↓
Lectura ofensiva / counter / continuación
        ↓
Posible pase extra o segunda acción
        ↓
Calidad real de la oportunidad
        ↓
Acción final de 7.6
        ↓
Resolución técnica/física/mental existente
        ↓
Rebote / transición / siguiente posesión
```

**Regla dura:** la capa táctica NO decide si el tiro entra. Solo decide qué
jugador termina pudiendo ejecutar qué acción, contra qué defensor/ayuda, con
qué grado de contestación y desde qué contexto. El motor de 7.6 conserva la
responsabilidad de convertir esa situación en probabilidad y resultado.

Esto permite mejorar el juego sin tirar el motor actual: Triple, Tiro medio,
Tiro interior, Bandeja, Pérdida, Robo, Rebote, Tapón, Faltas y el resto del
catálogo siguen siendo los resolvers finales.

### 7.12.4 `AdvantageState`: la pieza central

Se introduce un estado de ventaja para representar algo que el motor 1v1 de
7.6 no podía describir: **una acción colectiva puede desplazar la defensa
antes de que exista un tiro**.

Internamente puede representarse mediante un `advantageScore` normalizado
(p. ej. alrededor de -1..+1; los límites/umbrales exactos son CONFIG y no se
cierran aquí) y una categoría derivada para lectura/telemetría:

- **Ventaja defensiva clara** — ataque fuera de sistema, reloj bajo, pase
  negado, balón lejos de zona deseada.
- **Defensa estable** — no existe ventaja relevante para ninguno.
- **Pequeña ventaja ofensiva** — defensor llega tarde, pantalla genera medio
  paso, closeout imperfecto.
- **Ventaja ofensiva clara** — dos defensores comprometidos, mismatch limpio,
  penetración que fuerza ayuda.
- **Defensa en rotación** — la primera ayuda ya se activó y el ataque juega
  contra rotaciones sucesivas.
- **Defensa rota** — aro/triple abierto o superioridad numérica muy clara.

El `AdvantageState` puede aumentar, mantenerse, reducirse o invertirse durante
una misma posesión. Ejemplo:

```
PnR central
→ Drop
→ handler gana la pantalla
→ pequeña ventaja
→ low man ayuda al roller
→ defensa en rotación
→ pase a esquina
→ closeout largo
→ ventaja clara
→ extra-pass
→ tiro abierto
```

La ventaja NO se traduce de forma simplista a `+10% de tiro`. Se utiliza para:

- decidir si la defensa puede mantener al defensor original o necesita ayuda;
- seleccionar quién es el defensor real que contesta la acción final;
- modificar la calidad/grado de contestación que recibe el resolver de 7.6;
- abrir o cerrar lecturas: roll, pop, pocket pass, skip pass, extra pass,
  re-screen, mismatch, reset;
- aumentar la probabilidad de que aparezcan faltas por recuperación tardía;
- aumentar el valor de un buen pase/Visión cuando existe una ventaja que debe
  ser identificada rápidamente;
- decidir si el ataque continúa buscando una oportunidad mejor o debe
  conformarse con un tiro forzado por el reloj.

**Evitar doble conteo:** si `AdvantageState` ya ha provocado que el defensor
quede fuera de posición, no se aplica además un bonus duplicado a la misma
causa. El resultado táctico se expresa principalmente cambiando el defensor,
la ayuda, la distancia/contestación y el contexto que recibe la fórmula de
7.6. Cualquier modificador residual de `shotQuality` debe ser pequeño,
acotado y calibrado específicamente.

### 7.12.5 Calidad de tiro y creación real de la asistencia

La implementación de Asistencia de 7.6-D es deliberadamente provisional:
hoy acredita una asistencia DESPUÉS de que la canasta ya haya sido resuelta.
7.12 define la arquitectura que permitirá sustituir esa aproximación.

Se introduce conceptualmente `shotQuality`, calculada a partir de:

- `AdvantageState`;
- distancia/estado del defensor real;
- existencia y calidad de la ayuda;
- tipo de finalización generada;
- reloj de posesión;
- equilibrio/contexto del tirador;
- spacing efectivo del quinteto;
- calidad de la lectura/pase que produjo la oportunidad.

Un buen pasador no recibe un bonus abstracto de tiro. Su `VisiónJuego + Pase +
DecisiónBajoPresión` aumenta la probabilidad de **detectar la lectura correcta
y entregar el balón en el momento correcto**, conservando o ampliando la
ventaja. El receptor recibe entonces un tiro de mayor calidad porque la
defensa está peor colocada.

La asistencia pasa a derivarse de la cadena causal real:

```
creación de ventaja
→ lectura correcta
→ pase que mantiene/amplía ventaja
→ tiro anotado
→ asistencia al creador correspondiente
```

Puede existir una canasta sin asistencia aunque hubiera pases previos si el
anotador destruye la ventaja y crea su propio tiro posteriormente. También
puede existir un gran pase que genere un tiro abierto fallado: no produce
asistencia estadística, pero sí queda registrado como creación de ventaja en
el Data Hub táctico (7.12.22).

Hasta que TAC-1/TAC-3 sustituyan realmente la lógica de 7.6-D, la asignación
simplificada actual se mantiene para no romper estadísticas.

### 7.12.6 Sistema ofensivo — estructura de spacing

El `spacing` es una capa distinta del playbook. Define la ocupación base del
espacio, no una jugada concreta.

Opciones iniciales:

1. **5-Out** — cinco amenazas fuera/abiertas, máxima separación de pintura.
2. **4-Out 1-In** — cuatro abiertos y un interior con presencia de zona/dunker
   spot/poste.
3. **3-Out 2-In** — dos interiores, mayor presencia de rebote/poste y menor
   amplitud.
4. **Dynamic** — el spacing cambia según quinteto, jugada y rol.

**Regla fundamental:** elegir un spacing no garantiza que sea efectivo. Se
calcula un `effectiveSpacing` con los cinco jugadores REALES en pista. Un
pívot con `TiroExterior` muy bajo colocado en 5-Out puede ser ignorado por la
defensa, reduciendo el espacio efectivo y permitiendo ayudas más profundas.
Un interior capaz de Pop amenaza la cobertura de forma distinta a uno que solo
puede Roll.

Factores que alimentan `effectiveSpacing` sin crear un nuevo atributo fijo:

- Tiro exterior real de los cinco;
- tendencia/rol del jugador (cuando se introduzcan tendencies, 7.12.26);
- posición táctica ocupada en la jugada;
- distancia al balón/aro;
- respeto que la defensa decide conceder según scouting/GamePlan;
- familiaridad del quinteto con ese spacing.

El spacing afecta sobre todo a **rutas de ayuda y distancia de recuperación**,
no a porcentajes directos.

### 7.12.7 Identidad ofensiva

El usuario define una identidad ofensiva persistente mediante un conjunto
limitado de ejes. Deben presentarse con etiquetas comprensibles y una escala
visual, evitando que el usuario tenga que editar coeficientes matemáticos.
Internamente pueden normalizarse a una escala continua.

Ejes iniciales:

- **Ritmo:** muy pausado ↔ muy rápido.
- **Early offense:** organizar siempre ↔ atacar antes de que la defensa se
  coloque.
- **Movimiento de balón:** directo ↔ alta circulación/extra-pass.
- **Rigidez:** sistema estructurado ↔ Read & React/libertad creativa.
- **Uso de Pick & Roll:** bajo ↔ muy alto.
- **Uso de DHO/Handoff:** bajo ↔ muy alto.
- **Juego al poste:** bajo ↔ muy alto.
- **Bloqueos sin balón:** bajo ↔ muy alto.
- **Isolation:** bajo ↔ muy alto.
- **Penetración:** conservadora ↔ agresiva.
- **Prioridad de triple:** baja ↔ alta.
- **Media distancia:** evitar ↔ permitir/buscar si el perfil lo justifica.
- **Rebote ofensivo:** priorizar balance defensivo ↔ cargar el aro.
- **Buscar mismatches:** bajo ↔ muy alto.

Estas instrucciones **sesgan la selección de situaciones**. No fuerzan una
acción imposible. Si el playbook tiene prioridad alta de Post Up pero el
quinteto no contiene un jugador con perfil adecuado, la frecuencia real debe
bajar o la eficiencia caer de forma natural por mala resolución.

El motor debe distinguir entre **intención táctica** y **resultado observado**.
Ejemplo: `threePointPriority = alta` puede no producir muchos triples si el
rival niega líneas de pase, el spacing es pobre o el equipo no crea ventajas.

### 7.12.8 Play Types ofensivos

Se introduce una taxonomía intermedia entre identidad y jugada concreta. Los
play-types iniciales son:

- **Pick & Roll — Ball Handler**
- **Pick & Roll — Roll/Pop Man**
- **Isolation**
- **Post Up**
- **Handoff / DHO**
- **Off Screen**
- **Cut**
- **Spot Up / Attack Closeout**
- **Transition**
- **Putback**
- **Motion / Flow** (familia que encadena acciones, no resultado final)

Cada `TacticalProfile` almacena pesos/prioridades de play-type, pero el motor
los ajusta dinámicamente por:

- jugadores en pista y roles;
- energía;
- matchups;
- `GamePlan`;
- marcador/reloj;
- familiaridad;
- éxito/fracaso reciente sin sobrerreaccionar a muestras pequeñas;
- cobertura defensiva esperada/observada;
- imposibilidad contextual (p. ej. no hay Post Up si nadie ocupa ese rol).

La suma de pesos no equivale necesariamente a una distribución fija de 100
posesiones. Es una preferencia de selección que el contexto convierte en
frecuencias reales.

### 7.12.9 Roles ofensivos

Cada jugador recibe **un rol ofensivo principal dentro de cada táctica**. El
rol no sustituye su posición de 6.1/7.11 ni crea nuevos atributos; determina
cómo se le utiliza.

Catálogo inicial:

- **Creador primario** — inicia gran parte del ataque y toma la primera lectura.
- **Creador secundario** — ataca la segunda ventaja y organiza cuando el
  primario no está disponible.
- **PnR Handler** — especialista en dirigir bloqueo directo.
- **Isolation Scorer** — creación individual en aclarado/mismatch.
- **Spot-up Shooter** — spacing, catch-and-shoot y ataque de closeout.
- **Movement Shooter** — recibe saliendo de bloqueos/DHO/Floppy.
- **Slasher** — cortes, penetración, backdoor y ataque de espacios.
- **Connector** — recibe, decide rápido, extra-pass, handoff y continuidad.
- **Post Scorer** — finalización/creación individual desde poste.
- **Post Hub** — distribuye desde poste/codo y activa cortes.
- **Roll Man** — bloquea y continúa al aro.
- **Short-Roll Playmaker** — recibe 4v3 tras trap/hedge y toma la siguiente
  decisión.
- **Pick & Pop Big** — amenaza exterior tras bloquear.
- **Primary Screener** — prioriza calidad/frecuencia de bloqueos y re-screens.
- **Offensive Rebounder** — carga el rebote con prioridad.

Un jugador puede tener **capacidades altas para varios roles**, pero el usuario
elige uno principal para esa táctica. El sistema calcula `roleFit` en 1-5
estrellas para ayudar al usuario. Las estrellas son una **valoración derivada**
a partir de atributos existentes, competencia posicional, estado físico y
requisitos del rol; no se almacenan como un atributo de talento independiente.

El motor puede consultar capacidades secundarias cuando una posesión cambia de
forma orgánica (ej. el Connector recibe un closeout y termina actuando como
creador secundario), pero no convierte cada acción en una reasignación manual
de rol.

Además puede existir una jerarquía de uso ofensivo:

- primera opción;
- segunda opción;
- tercera opción;
- uso normal;
- uso bajo.

Esta jerarquía es una preferencia, no una orden de lanzar. Un jugador marcado
como primera opción no debe monopolizar posesiones si el rival lo dobla y el
pase correcto genera una oportunidad mejor.

### 7.12.10 Playbook — familias de jugadas

El playbook representa **familias de acciones conocidas**, no secuencias
cerradas con un resultado predeterminado.

Catálogo inicial objetivo (se puede ampliar sin cambiar la arquitectura):

- **Basic High P&R**
- **Horns**
- **Spain Pick & Roll**
- **Double Drag**
- **Pistol**
- **DHO / Zoom**
- **Floppy**
- **Flex**
- **Princeton Elbow / Princeton entry**
- **Post Split**
- **5-Out Motion**
- **Isolation Clearout**
- **High-Low**
- **Post Entry + weak-side action**

Cada `PlayDefinition` debe poder describir como datos:

- `id` / nombre;
- familia/play-type principal;
- spacing compatible/recomendado;
- participantes requeridos (handler, screener, back-screener, shooter,
  post-hub, etc.);
- punto/entrada inicial;
- complejidad;
- requisitos mínimos o penalizaciones de mala idoneidad;
- lecturas posibles;
- respuesta esperada contra coberturas defensivas;
- counters;
- continuaciones si la primera acción no crea ventaja;
- posibles outcomes finales de 7.6;
- opción de `reset` si la defensa gana;
- clave de familiaridad.

Ejemplo conceptual de Spain P&R:

```
Spain P&R
  handler
  screener/roller
  back-screener/shooter

vs Drop:
  pull-up / lob / pocket pass / pop-back-screener / kick-out

vs Switch:
  attack guard-big mismatch / seal roller / re-screen

vs Blitz:
  short roll → 4v3 → corner/roller/extra-pass

vs Under:
  pull-up si hay rango / re-screen / cambio de ángulo
```

**No scripting:** el motor no hace `Spain P&R → pase al pívot → bandeja`.
Selecciona una lectura ponderada por jugadores, defensa y ventaja. Si la
primera lectura falla, la posesión puede continuar hacia una segunda acción
si queda reloj y la filosofía del equipo lo permite.

### 7.12.11 Continuidad, counters y Read & React

El baloncesto de alto nivel no termina cuando la primera acción es negada. Se
modela una pequeña **cadena de acciones** por posesión, acotada por reloj y
complejidad para evitar un simulador infinito.

Estados posibles tras una primera acción:

- **Advantage created** → atacar inmediatamente.
- **Neutral** → continuación prevista del playbook.
- **Defense wins** → reset, segunda acción o tiro forzado según reloj.
- **Mismatch created** → cambiar prioridad a Isolation/Post Up.
- **Two on ball** → activar short-roll/weak-side read.
- **Rotation forced** → extra-pass/cut/spot-up.

El eje **Rigidez ↔ Read & React** de 7.12.7 decide cuánto se permite salir de
la secuencia base:

**Sistema estructurado**:
- menor abanico de lecturas espontáneas;
- más sencillo de aprender;
- menor riesgo de errores de sincronización;
- más predecible si el rival reconoce la acción.

**Read & React alto**:
- más counters y continuaciones dinámicas;
- explota mejor defensas en rotación;
- exige más `VisiónJuego`, `DecisiónBajoPresión`, `Posicionamiento`,
  `TrabajoEnEquipo`, `Concentración` y Experiencia;
- mayor riesgo de pérdida/spacing roto si el quinteto no ejecuta bien.

No se fija todavía una fórmula exacta; estos factores alimentan
`tacticalExecution` (7.12.18).

### 7.12.12 Transición y early offense

La transición deja de ser únicamente un bonus de Bandeja en los primeros
segundos (7.6 acción 14) y pasa a ser también un play-type táctico. Se mantiene
la ventana temporal de transición ya definida, pero el equipo puede decidir
cuánto intenta explotarla.

`TransitionPriority` afecta a:

- velocidad con la que el handler busca avanzar;
- probabilidad de atacar aro antes de montar media pista;
- probabilidad de triple temprano si existen tiradores abiertos;
- participación de wings que corren calles;
- probabilidad de Drag/Double Drag temprano;
- riesgo de pérdida por jugar antes de que el equipo esté organizado;
- consumo de Energía.

Debe conectarse directamente con la defensa de transición rival y con la
política propia de rebote ofensivo. **Trade-off duro de diseño:**

> Cargar más el rebote ofensivo deja menos jugadores preparados para replegar.

Por tanto `OffensiveReboundPriority` no puede ser un bonus gratuito a rebotes:
aumenta segundas oportunidades a cambio de mayor vulnerabilidad a
contraataques si el rival captura el balón.

### 7.12.13 Sistema defensivo — capas

La defensa tiene la misma profundidad estructural que el ataque. Se divide en:

1. **Shell/base scheme** — organización de media pista.
2. **Pickup point / presión** — dónde empieza a incomodar al balón.
3. **Cobertura de P&R/DHO** — respuesta a bloqueos directos.
4. **Reglas on-ball** — presión, orientación, distancia y navegación.
5. **Reglas off-ball** — ayudas, negación, closeouts y bloqueos indirectos.
6. **Defensa del poste** — posición y reglas de doble ayuda.
7. **Transición defensiva** — prioridades al perder/cambiar posesión.
8. **Press** — estructuras de presión a toda/3/4 pista.
9. **Matchups e instrucciones individuales** — overrides por jugador rival.

Como en ataque, ninguna opción otorga automáticamente una ventaja general.
Cada decisión protege unas situaciones y concede otras.

### 7.12.14 Shell/base scheme defensivo

Opciones iniciales:

- **Man-to-Man** — referencia principal.
- **Match-up Zone** — responsabilidades zonales con emparejamientos dinámicos.
- **2-3 Zone** — protege pintura y fuerza decisiones exteriores, con riesgos en
  high post/esquinas/rebote según ejecución.
- **3-2 Zone** — mayor presencia alta/perimetral, distinta vulnerabilidad
  interior/baseline.
- **1-3-1 Zone** — presión de líneas/pases y traps, exige rotaciones largas.
- **Box-and-One** — cuatro en zona + perseguidor sobre una estrella rival.

Una zona NO se implementa como `opponent3P +X / opponentInside -Y`. Debe cambiar
qué defensor es responsable de cada área, cuándo se activa una ayuda, qué
líneas de pase están disponibles, dónde aparece una sobrecarga y quién cierra
el rebote.

**Box-and-One** requiere seleccionar objetivo; si ese jugador abandona pista o
cambia su rol, la CPU/usuario puede volver al shell base o seleccionar otro.

Sistemas más específicos como Triangle-and-Two pueden añadirse posteriormente
sobre la misma arquitectura sin alterar el núcleo.

### 7.12.15 Pickup point, presión y pressing

El punto donde comienza la defensa es independiente del shell de media pista:

- **Media pista**
- **3/4 de pista**
- **Toda la pista**

Y la intensidad:

- conservadora;
- normal;
- alta;
- asfixiante.

La presión alta:

- puede consumir segundos de posesión antes de iniciar sistema;
- aumenta opciones de pérdida/robo si los defensores tienen perfil adecuado;
- exige `DefensaPerimetral`, `Agilidad`, `Aceleración`, `Resistencia`,
  `Anticipación`, `ÉticaDeTrabajo` y `TrabajoEnEquipo` de forma táctica;
- aumenta desgaste de Energía;
- deja una defensa más vulnerable si se supera la primera línea.

No se trata como un multiplicador universal de robos.

Esquemas de press previstos:

- **Man-to-Man Press**
- **2-2-1 Press**
- **1-2-1-1 Press**
- **Match-up Press**

Cada press define puntos de trap/rotación y una condición de salida hacia el
shell de media pista. La defensa puede, por ejemplo, presionar 2-2-1 y después
caer a Man-to-Man; una no sustituye conceptualmente a la otra.

### 7.12.16 Pick & Roll / DHO — cobertura defensiva

El bloqueo directo es la interacción táctica más importante de esta primera
versión. La cobertura depende de:

- localización (central/lateral);
- handler;
- screener;
- resto del spacing;
- capacidades de los dos defensores implicados;
- plan del partido.

La interfaz puede ofrecer **presets reconocibles**, pero internamente conviene
separar dos decisiones para evitar simplificaciones:

1. **Ruta del defensor del balón** — `over`, `under`, perseguir/recuperar.
2. **Comportamiento del defensor del bloqueador** — drop, high/flat, show,
   hedge, switch, blitz, ICE en lateral, etc.

Presets iniciales:

- **Drop + Over** — big protege profundidad/aro, defensor persigue por encima.
- **Drop + Under** — concede más espacio exterior para contener penetración.
- **High Drop / Flat** — big más alto que en Drop profundo.
- **Show & Recover** — big contiene temporalmente y vuelve a su hombre.
- **Hard Hedge** — salida agresiva, exige recuperación/rotación.
- **Switch** — cambio directo de asignaciones.
- **Blitz / Trap** — dos defensores comprometen al balón.
- **ICE / Push** — en P&R lateral, negar pantalla y orientar el balón hacia
  banda/baseline según la regla definida.

**Aplicabilidad:** ICE es una solución lateral; la UI no debe permitir una
combinación absurda simplemente porque existe en el catálogo. Las jugadas y
coberturas declaran contextos compatibles.

Cada cobertura tiene vulnerabilidades emergentes:

- Drop: pull-up/midrange/floater si el handler los domina.
- Under: triple/pull-up si el handler tiene rango.
- Hedge/Blitz: short roll y juego 4v3 si el pase/roller leen bien.
- Switch: reduce ventaja inicial, pero puede crear mismatch exterior/interior.
- ICE: limita uso normal de pantalla lateral, pero abre reject/re-screen,
  short corner u otros counters según spacing.

La respuesta no se codifica como `Coverage A pierde contra Action B`; depende
de jugadores y lecturas.

### 7.12.17 Reglas on-ball y matchups individuales

Cada matchup puede tener overrides sobre la defensa general:

- **Presión al balón:** baja / normal / alta.
- **Distancia:** flotar / normal / pegarse.
- **Orientación:** negar centro / orientar a banda / neutral.
- **Bloqueo:** over / under / seguir regla del equipo.
- **Negar recepción:** normal / agresiva.
- **Forzar mano/dirección** — opcional cuando los datos/tendencies permitan
  justificarlo; no se introduce como dato real obligatorio en TAC-1.

Ejemplo:

```
Tirador élite:
  pegarse
  over
  negar recepción

Base con poco tiro:
  flotar
  under
  cerrar penetración
```

El `GamePlan` permite asignar un defensor específico a una estrella rival. El
motor respeta esa intención siempre que ambos estén en pista, salvo que una
rotación/cambio defensivo obligue temporalmente a otro matchup.

### 7.12.18 Reglas off-ball, ayudas y ejecución colectiva

La defensa sin balón se modela mediante reglas de equipo y roles, no mediante
una bonificación global de `Defensa`.

Instrucciones iniciales:

- **Intensidad de ayuda:** baja / normal / agresiva.
- **Negación de líneas de pase:** conservadora / normal / negar.
- **Corner help:** quedarse / situacional / ayudar agresivamente.
- **Protección de pintura:** normal / colapsar.
- **Closeout:** contener penetración / expulsar de triple.
- **Bloqueos indirectos:** perseguir / pasar por debajo / cambiar / top-lock
  cuando sea compatible.
- **DHO:** perseguir / cambiar / pasar por debajo / contener según perfil.
- **Stunt & recover:** permitido según rol/ayuda.
- **Prioridad de low man:** quién toma la primera ayuda al roller.
- **Nail help:** apoyo central frente a penetraciones/short roll.

La defensa debe poder entrar en **rotación**. Cuando un jugador ayuda, otro debe
cubrir temporalmente el espacio/hombre abandonado. El `AdvantageState` mide si
esas rotaciones recuperan la posesión o el ataque mantiene la ventaja mediante
pase extra/corte.

#### Revisión explícita de `Trabajo en equipo`

7.6 excluyó `TrabajoEnEquipo` de las fórmulas individuales del partido. Esa
regla **se mantiene para las acciones individuales**, pero 7.12 introduce una
excepción necesaria y limitada:

> `TrabajoEnEquipo` participa en `tacticalExecution`, sincronización de
> bloqueos/cortes, spacing, ayudas y rotaciones colectivas; NO aumenta la
> probabilidad técnica de meter un tiro, robar, taponar o rebotear por sí solo.

Esto evita duplicar talento individual y, al mismo tiempo, permite distinguir
a cinco grandes atletas que defienden descoordinados de un quinteto que rota
como una unidad.

### 7.12.19 Defensa del poste

Opciones de posición inicial:

- **Behind** — defensa por detrás.
- **3/4 Front** — negar parcialmente entrada.
- **Front** — negar por delante, asumiendo riesgo de pase alto/ayuda trasera.

Reglas de double-team:

- nunca;
- solo contra jugador marcado como estrella/amenaza;
- al recibir;
- al primer bote;
- siempre que reciba en zona objetivo.

El double-team crea una ventaja defensiva contra la finalización individual a
cambio de poner **dos defensores sobre un jugador** y forzar rotaciones. La
Visión/Pase/Decisión del jugador posteado y el spacing del ataque deciden si
puede castigar esa superioridad.

No se añade un `-X% post` directo por hacer 2v1.

### 7.12.20 Transición defensiva y balance

Al terminar una posesión ofensiva, el equipo debe decidir cuántos jugadores y
qué perfiles priorizan:

- **Proteger aro**
- **Parar balón**
- **Localizar tiradores**
- **Replegar antes que cargar rebote**
- **Cross-match rápido** cuando no se puede recuperar el matchup original

La calidad de la transición defensiva depende del compromiso ofensivo al
rebote (7.12.12), velocidad/agilidad, posicionamiento, concentración,
TrabajoEnEquipo y roles defensivos.

Un equipo que carga el rebote con tres/cuatro jugadores puede dominar el
rebote ofensivo, pero si pierde la pugna su `DefensiveTransitionState` comienza
con menos jugadores detrás del balón. Esta relación debe ser causal y medible
en el Data Hub.

### 7.12.21 Roles defensivos

Cada jugador recibe un rol defensivo principal dentro de la táctica:

- **POA Stopper** — defensor principal del manejador.
- **Screen Navigator** — especialista en perseguir/navegar bloqueos.
- **Switch Defender** — capaz de asumir cambios y sobrevivir mismatches.
- **Perimeter Disruptor** — presión, líneas de pase, actividad exterior.
- **Nail Helper** — ayuda central y recuperación.
- **Low Man** — última ayuda frente al roller/aro.
- **Rim Protector** — protección de aro y ayudas interiores.
- **Post Anchor** — defensa de poste/posición interior.
- **Roamer** — puede abandonar una amenaza débil para generar ayudas.
- **Defensive Rebounder** — prioridad en cierre y rebote defensivo.

Como en ataque, `roleFit` se calcula en estrellas a partir de los atributos ya
existentes; no es un atributo fijo adicional. Un jugador puede ser excelente
POA pero mediocre Switch Defender, o gran Rim Protector pero mal defensor en
espacio.

### 7.12.22 `tacticalExecution`, familiaridad y complejidad

Una táctica no se ejecuta igual el primer día que después de meses de trabajo.
Se introduce **Familiaridad Táctica** como estado dinámico/persistente del
savegame, separado de los atributos fijos del jugador.

Capas mínimas de familiaridad:

- familiaridad ofensiva global del sistema;
- familiaridad defensiva global;
- familiaridad por familia de jugada;
- familiaridad por cobertura defensiva;
- familiaridad individual del jugador con su rol;
- familiaridad del quinteto con estructuras muy específicas (opcional en
  primera implementación; la arquitectura debe permitirla sin obligar a
  almacenar todas las combinaciones de cinco jugadores).

La familiaridad crece por:

- entrenamiento táctico futuro (sección 9);
- minutos reales ejecutando el sistema;
- continuidad de jugadores/roles;
- pretemporada.

Y cae/queda limitada por:

- introducir demasiadas novedades simultáneas;
- cambios frecuentes de rol;
- alta complejidad;
- nuevos fichajes;
- periodos largos sin usar una familia.

**No se cierra todavía la curva matemática.**

La **Complejidad táctica** es derivada de:

- cantidad de familias del playbook;
- cantidad de variantes/counters;
- diversidad de coberturas defensivas;
- nivel de Read & React;
- frecuencia de cambios de plan;
- cantidad de instrucciones individuales.

`tacticalExecution` cruza, en dirección positiva/negativa según corresponda:

- Familiaridad;
- `TrabajoEnEquipo`;
- `Concentración`;
- `Posicionamiento`;
- `VisiónJuego` / `DecisiónBajoPresión` para lecturas;
- Experiencia;
- Energía/Fatiga;
- Complejidad requerida.

Un `tacticalExecution` bajo no debe convertirse en una penalización plana a
todos los atributos. Sus errores aparecen como:

- mal timing de pantalla/corte;
- spacing roto;
- lectura incorrecta;
- pase tarde;
- dos jugadores ocupando el mismo espacio;
- pérdida ofensiva de sistema;
- ayuda defensiva tarde;
- dos defensores ayudando al mismo jugador;
- error de switch;
- closeout equivocado.

Esto produce resultados tácticos reconocibles sin falsear la habilidad base
del jugador.

### 7.12.23 Plan de partido (`GamePlan`) y scouting táctico

La táctica base NO se destruye cada semana. Antes de un partido el usuario
puede crear un `GamePlan` con overrides específicos.

Bloques de plan:

**Ataque**
- play-types a aumentar/reducir;
- target de mismatch;
- defensor rival a atacar en P&R;
- jugador interior/exterior a buscar;
- ritmo específico;
- orientación del shot profile;
- prioridad de rebote ofensivo.

**Defensa**
- matchup principal;
- cobertura P&R general para ese partido;
- cobertura por jugador rival;
- over/under por handler;
- presión/distancia por jugador;
- negar recepción a estrella;
- dobles al poste;
- ayudar o quedarse con tiradores;
- shell alternativo preparado.

**Regla de persistencia:** al terminar el partido se vuelve a la identidad base,
salvo que el usuario guarde explícitamente ese plan como nueva táctica.

#### Informe táctico del rival

El juego debe generar, a partir de datos REALES de las posesiones simuladas,
un informe como:

- frecuencia de cada play-type;
- PPP por play-type;
- perfil de tiro (aro/media/triple);
- transición;
- P&R handler/roller;
- uso de poste;
- porcentaje de tiros asistidos;
- pérdidas forzadas/cometidas por contexto;
- cobertura defensiva usada y frecuencia;
- eficiencia concedida por cobertura;
- quintetos/lineups más utilizados;
- jugadores con mayor creación.

En la primera versión, mientras Scouting no esté implementado, estos datos
pueden mostrarse con un nivel de acceso alto para probar el sistema. Cuando
exista el módulo de Scouting, **la base conoce todos los datos pero el usuario
solo ve el nivel de precisión/información que su scouting haya conseguido**.
No rediseñar 7.12 cuando llegue Scouting: solo cambiar la capa de visibilidad.

### 7.12.24 Ajustes durante el partido, tiempos muertos y situaciones especiales

El flujo actual revela el partido principalmente por cuartos. El sistema
mantiene ese nivel de presentación —no se convierte en narración jugada a
jugada—, pero añade **ventanas de intervención táctica**.

#### Entre cuartos

Siempre se puede revisar:

- play-type frequency/PPP hasta ese momento;
- shot profile;
- P&R rival;
- pérdidas;
- rebote;
- matchups;
- Energía/faltas;
- cobertura defensiva rival observada.

Y cambiar:

- quinteto/rotación dentro de las reglas de 7.11;
- roles activos;
- play-type priorities;
- ritmo;
- coverage;
- matchups;
- ayudas/presión;
- shell defensivo.

#### Tiempos muertos

Los tiempos muertos se modelan con las reglas FIBA de `CONFIG_BASE` y no con
números hardcodeados en la UI. Para FIBA/ACB la referencia actual es 2 en la
primera mitad, 3 en la segunda (con la restricción de los últimos 2 minutos del
4º cuarto) y 1 por prórroga; duración reglamentaria 1 minuto. Si otra
competición cambia las reglas, lo hace mediante CONFIG.

Un tiempo muerto **NO aplica un `momentum = 0` ni un bonus mágico de acierto**.
Su valor principal es permitir:

- ajuste inmediato de cobertura;
- cambio de matchup;
- cambio de quinteto;
- cambio de prioridad ofensiva;
- selección de una jugada ATO preparada;
- recordatorio táctico que puede mejorar temporalmente la ejecución de UNA
  acción conocida, condicionado por familiaridad.

El sistema de Racha/Momento de 7.9 y el parcial colectivo de 7.6-20 no se
borran automáticamente por pedir tiempo muerto. Si en pruebas futuras se
justifica un efecto psicológico menor, deberá calibrarse por separado; no se
asume aquí.

#### Compatibilidad con el reveal por cuartos

Para poder pedir un timeout dentro de un cuarto sin mostrar cada posesión:

- el motor sigue simulando posesión a posesión internamente;
- cuando aparece una oportunidad reglamentaria de timeout y se cumple un
  trigger configurado por usuario/CPU, el cuarto puede **pausarse** y devolver
  control con marcador, reloj y resumen agregado hasta ese instante;
- el usuario puede tener `Auto Timeouts` activado para mantener un flujo más
  rápido: la IA asistente usa reglas configuradas sin abrir una pantalla cada
  vez;
- los triggers exactos (parcial rival, deterioro de shot quality, faltas,
  final de cuarto, etc.) son CONFIG/UX y se calibran después.

#### ATO, BLOB, SLOB y finales

Se reserva un sub-playbook especial:

- **ATO** — After Time Out.
- **BLOB** — Baseline Out Of Bounds.
- **SLOB** — Sideline Out Of Bounds.
- **Late Clock** — pocos segundos de posesión.
- **Last Possession** — última posesión de cuarto/partido.

Estas jugadas utilizan la misma arquitectura `PlayDefinition`: no garantizan un
tiro concreto y su eficacia depende de jugadores, cobertura y familiaridad.

#### Falta táctica intencionada

Se cierra el hueco de 7.6 mediante reglas configurables:

- perdiendo por X margen con Y segundos: empezar a hacer falta;
- priorizar receptor/objetivo con peor TiroLibre cuando sea posible;
- evitar que el jugador propio con 4 faltas sea quien haga la falta si existe
  alternativa razonable;
- ganando por 3: futura opción de falta preventiva antes del triple, cuando el
  motor de situación final esté suficientemente calibrado;
- CPU usa las mismas reglas.

No se fija todavía el umbral óptimo de segundos/marcador: será decisión de
usuario/CPU y calibración de diseño.

### 7.12.25 IA táctica de equipos CPU

Los equipos CPU utilizan **exactamente el mismo sistema táctico**, sin bonuses
ocultos ni conocimiento omnisciente de estados que el usuario no podría
obtener.

#### Construcción de identidad

Al comenzar una partida/pretemporada, la CPU evalúa:

- mejores jugadores;
- distribución de roles disponibles;
- calidad de creación;
- tiro/spacers;
- interiores Roll/Pop/Post;
- defensa perimetral/interior;
- movilidad/switchability;
- rebote;
- Energía/edad de rotación;
- `clubDNA` como sesgo, no como orden obligatoria.

Y selecciona una identidad que maximice el encaje de plantilla. Ejemplos:

- base creador + pívot móvil + tiradores → más P&R/4-Out/5-Out;
- interior dominante + poco tiro → más 4-Out-1-In/Post/High-Low;
- muchos wings móviles → más switch/pressure/transition;
- pívot protector lento → más Drop que Switch Everything.

La CPU puede mantener 1 táctica principal y variantes secundarias preparadas.
No necesita copiar al usuario ni cambiar de identidad cada partido.

#### Plan de partido CPU

Usa estadísticas disponibles y conocimiento/scouting cuando exista ese módulo.
Busca:

- play-types dominantes del rival;
- estrellas y roles;
- coberturas habituales;
- mismatches;
- tendencias de tiro;
- lineups frecuentes.

En la fase previa a Scouting, puede usar el mismo informe estadístico objetivo
que está disponible al usuario para evitar asimetría de información.

#### Ajustes en vivo CPU

La CPU analiza:

- calidad de las oportunidades, NO solo si los tiros entraron;
- frecuencia/PPP por play-type;
- generación de ventaja;
- pérdidas;
- rebote;
- faltas;
- Energía;
- matchup dominante.

**Regla anti-sobrerreacción:** no cambia de cobertura porque el rival meta 3
tiros difíciles seguidos. Distingue resultado de proceso. Un rival puede ir
3/4 en triples muy contestados sin que el GamePlan esté roto; en cambio, cinco
triples abiertos consecutivos sí son señal de fallo estructural aunque solo
entren dos.

Se requieren:

- tamaño mínimo de muestra/confianza;
- histéresis para no alternar Drop↔Switch cada dos posesiones;
- coste de familiaridad;
- inercia táctica.

Una CPU cuyo equipo apenas conoce Switch puede usarlo como emergencia, pero
con peor `tacticalExecution` que su Drop habitual.

### 7.12.26 Tendencies de jugador — arquitectura futura

Capacidad y comportamiento no son equivalentes. Un jugador puede tener
`TiroExterior = 17` y lanzar poco; otro `TiroExterior = 14` y buscar ocho
triples por partido.

7.12 reserva explícitamente un futuro sistema de `playerTendencies`, separado
de los atributos 1-20 de capacidad. Posibles tendencies:

- `threePointFrequency`
- `pullUpFrequency`
- `driveFrequency`
- `rimAttackFrequency`
- `postUpFrequency`
- `passFirst`
- `cutFrequency`
- `rollVsPop`
- `offBallMovement`
- `extraPassTendency`
- `defensiveGamble`
- `helpDiscipline`
- `foulAggressiveness`

**No se implementan en TAC-1**. La selección táctica inicial puede usar roles
y atributos. Pero el diseño no debe asumir que "habilidad = frecuencia" para
siempre, porque esa equivalencia impediría representar fielmente perfiles
reales más adelante.

Cuando existan tendencies, el entrenador puede sesgarlas mediante instrucciones,
pero no borrarlas completamente: un anotador agresivo sigue teniendo una
personalidad de juego distinta a un jugador pasivo bajo el mismo sistema.

### 7.12.27 Data Hub táctico — qué se registra desde el principio

Aunque la UI inicial no muestre toda esta información, **el motor debe guardar
la telemetría táctica desde la primera implementación**, porque datos históricos
no almacenados no pueden reconstruirse después.

Cada posesión debería poder registrar, como mínimo:

- `gameId` / periodo / reloj / marcador;
- quinteto ofensivo y defensivo;
- fase: transición / early offense / media pista;
- `playType`;
- `playId` si hubo jugada concreta;
- initiator/handler;
- screener;
- receptores/participantes principales;
- roles activos;
- shell defensivo;
- matchup del balón;
- cobertura P&R/DHO si aplica;
- ruta over/under si aplica;
- ayuda y help defender;
- `advantageStart` / `advantagePeak` / `advantageEnd`;
- counter/continuación utilizada;
- número de pases relevantes o cadena de creación;
- `shotQuality` contextual;
- tipo de acción final 7.6;
- defensor real del tiro/finalización;
- reloj de posesión al finalizar;
- resultado: canasta/fallo/pérdida/falta/rebote/etc.;
- si la canasta fue asistida y por quién;
- si hubo ATO/BLOB/SLOB/Last Possession;
- timeout/ajuste táctico vigente.

De ello se derivan, entre otras:

**Ataque**
- frecuencia y PPP por play-type;
- PPP de P&R handler / roll man;
- efficiency tras DHO / Off Screen / Post / Isolation;
- Transition Frequency / PPP;
- rim / midrange / 3P frequency;
- assisted FG%;
- turnover rate por contexto;
- FT rate por play-type;
- shot quality media;
- ATO PPP;
- efectividad de cada play del playbook;
- rebote ofensivo vs puntos concedidos en transición.

**Defensa**
- PPP concedido por coverage;
- frecuencia de Drop/Switch/Hedge/Blitz/ICE;
- shot profile permitido;
- rim frequency permitido;
- triples abiertos/contestados si el modelo de `shotQuality` lo permite;
- pérdidas forzadas por presión;
- puntos concedidos tras superar primera línea;
- eficiencia de zona/man;
- rebote defensivo por shell/quinteto;
- mismatch efficiency concedida.

**Lineups**
- ORtg/DRtg/Net aproximado;
- play-types más eficientes por quinteto;
- spacing efectivo;
- frecuencia de ventajas creadas/cedidas;
- rendimiento de cada cobertura.

La UI debe advertir cuando una muestra es pequeña. No presentar `2 posesiones,
1.50 PPP` como una verdad táctica estable.

### 7.12.28 Valoraciones derivadas de quinteto

Para ayudar al usuario sin crear nuevos atributos base, cada quinteto puede
mostrar índices calculados:

- **Creación**
- **Spacing**
- **Finalización interior**
- **Tiro exterior**
- **Rebote ofensivo**
- **Rebote defensivo**
- **POA Defense**
- **Switchability**
- **Rim Protection**
- **Transition Offense**
- **Transition Defense**
- **Tactical Execution**

Se muestran en estrellas/barras y se recalculan al cambiar un jugador.

Ejemplo conceptual:

```
Quinteto A
Creación         ★★★★★
Spacing          ★★★★★
Rebote           ★★☆☆☆
Switchability    ★★★★☆
Rim Protection   ★★☆☆☆
```

Cambiar un pívot abierto por un interior tradicional puede mejorar Roll,
rebote y protección de aro, pero reducir spacing. La táctica elegida no ha
cambiado; **su encaje con el quinteto sí**.

### 7.12.29 Forma conceptual de los datos tácticos

Mientras el proyecto siga usando JSON, el sistema puede representarse con un
shape equivalente al siguiente. Es una referencia de diseño, no obliga a usar
exactamente estos nombres de propiedades si la implementación existente exige
otro convenio:

```json
{
  "offense": {
    "spacing": "4-out-1-in",
    "pace": 60,
    "earlyOffense": 55,
    "ballMovement": 70,
    "freedom": 50,
    "offensiveRebound": 45,
    "mismatchHunting": 60,
    "playTypeWeights": {
      "pickAndRoll": 30,
      "handoff": 15,
      "offScreen": 12,
      "postUp": 10,
      "isolation": 8,
      "cut": 10,
      "transition": 15
    }
  },
  "defense": {
    "baseScheme": "man",
    "pickupPoint": "half-court",
    "ballPressure": 60,
    "helpIntensity": 55,
    "centralPnR": "drop-over",
    "sidePnR": "ice",
    "offBallScreenCoverage": "chase",
    "postDefense": "behind",
    "doublePost": "star-only"
  }
}
```

Los números del ejemplo son **solo ilustrativos**, no valores de balance.

El `GamePlan` vive separado:

```json
{
  "opponentId": "team-rival",
  "matchups": {
    "player-rival-01": {
      "defenderId": "player-own-03",
      "pressure": "high",
      "screenRoute": "over"
    }
  },
  "overrides": {
    "centralPnR": "high-drop",
    "mismatchHunting": 80
  }
}
```

El playbook también debe ser data-driven. Forma conceptual mínima:

```json
{
  "id": "spain-pnr",
  "family": "pick-and-roll",
  "participants": ["handler", "screener", "backScreener"],
  "complexity": "high",
  "reads": ["handlerShot", "roll", "shortRoll", "pop", "kickOut", "reset"],
  "counters": ["reScreen", "reject", "attackMismatch", "extraPass"]
}
```

Las ramas exactas contra cada cobertura pueden vivir en CONFIG/datos de
playbook. Añadir una nueva jugada debe ser principalmente **añadir una nueva
definición**, no reescribir el bucle central del motor.

### 7.12.30 Reglas de integración con el motor existente

1. **7.6 sigue siendo el resolver final.** No duplicar las fórmulas de tiro,
   robo, rebote, tapón, faltas, etc. dentro de Tactics.
2. **7.11 sigue siendo fuente de quintetos/minutos.** Tactics consulta quién
   está realmente en pista; no inventa titulares paralelos.
3. **Energía/Fatiga sigue siendo una única verdad.** Presión y esquemas más
   agresivos pueden elevar carga de acciones, pero no crean otra batería
   táctica.
4. **Position map de 6.1 sigue válido.** Los roles no sustituyen posición ni
   polivalencia.
5. **Presión de Momento de 7.5 sigue transversal.** Una táctica de final de
   partido no crea otro sistema de clutch.
6. **Consistencia sigue controlando varianza individual.** No se utiliza para
   familiaridad táctica.
7. **TrabajoEnEquipo solo entra por ejecución colectiva** según 7.12.18.
8. **Asistencia de 7.6-D se sustituirá progresivamente**, no se duplica para
   siempre.
9. **ClubDNA es un sesgo de identidad**, especialmente para CPU/cantera,
   nunca un bonus automático a una jugada.
10. **CONFIG contiene pesos y calibración.** La lógica estructural vive en las
    entidades; los coeficientes ajustables no deben desperdigarse por código.

### 7.12.31 Principios de balance y calibración

Antes de fijar coeficientes, el sistema debe cumplir invariantes cualitativos.
Estos son requisitos de validación, no números finales:

1. Contra un **Drop profundo**, un handler competente en pull-up debe aumentar
   su frecuencia de tiros intermedios/exteriores respecto a un baseline.
2. Contra **Blitz**, debe bajar la frecuencia de tiro directo del handler y
   aumentar short-roll/4v3 si el equipo tiene pasadores capaces; un handler con
   mala decisión puede aumentar pérdidas.
3. **Switch** debe reducir ventaja inmediata del P&R, pero aumentar la
   aparición de mismatch cuando los perfiles físicos/posicionales lo permitan.
4. **Under** debe ser castigable por un gran tirador y útil contra un handler
   sin amenaza exterior.
5. **5-Out** solo mejora spacing si el quinteto realmente obliga a respetar a
   los cinco jugadores.
6. **3-Out 2-In** debe tender a mayor presencia interior/rebote y menor espacio
   para penetración que 5-Out, sin recibir un porcentaje fijo artificial.
7. Aumentar **rebote ofensivo** debe aumentar ORB y también vulnerabilidad de
   transición si el rival consigue el rebote.
8. Un **press** agresivo debe poder elevar pérdidas rivales, pero consumir más
   Energía y conceder oportunidades mejores cuando es superado.
9. Familiaridad baja debe producir **errores de ejecución**, no una caída
   indiscriminada de todos los atributos del jugador.
10. Un gran pasador debe mejorar la **calidad de oportunidades creadas**, no
    solo acumular asistencias después de la canasta.
11. Una CPU debe poder llegar a los mismos resultados usando las mismas
    herramientas; no existen coberturas/bonuses exclusivos de la IA.
12. Los resultados deben depender de la interacción táctica + jugadores: no
    debe existir una tabla universal `táctica A > táctica B`.

La calibración cuantitativa posterior se hará mediante simulación masiva y
comparación con distribuciones reales: pace, shot profile, P&R frequency,
turnover rate, ORB%, FT rate, asistencias, eficiencia por play-type y eficiencia
por cobertura cuando exista evidencia suficiente.

### 7.12.32 Interfaz táctica

La pantalla principal de Tácticas se divide en siete vistas, manteniendo
profundidad sin mostrar todos los parámetros a la vez:

1. **Resumen** — identidad, media cancha visual y fortalezas del quinteto.
2. **Ataque** — spacing, ritmo, prioridades, rebote ofensivo y play-types.
3. **Defensa** — shell, presión, P&R, ayudas, poste y transición.
4. **Roles** — rol ofensivo y defensivo de cada jugador + `roleFit` en estrellas.
5. **Playbook** — jugadas activas, prioridad y familiaridad.
6. **Situaciones** — ATO, BLOB, SLOB, Late Clock, Last Possession y falta
   táctica.
7. **Rival** — `GamePlan`, matchups e informe de scouting/análisis.

La media cancha gráfica es explicativa, no un editor libre de dibujo en esta
fase. Al cambiar 4-Out-1-In → 5-Out debe visualizarse la ocupación de espacios;
al elegir Drop/Switch/ICE debe poder mostrarse esquemáticamente la cobertura.

**Futuro, no TAC-1:** editor visual de jugadas propio. La arquitectura
`PlayDefinition` debe permitirlo más adelante, pero no bloquear el módulo
actual esperando esa herramienta.

**Integración con la navegación existente** (confirmado contra `game.js`):
el juego ya tiene cinco pantallas de navegación (`home`, `lineup`,
`calendar`, `competitions`, `stats`) más `match` y `team-select`, gestionadas
por la constante `SCREENS` y un `renderXScreen()` por pantalla. La nueva
pantalla de Tácticas se añade a esa misma lista (`tactics`, junto a
`lineup` en el nav) con su propio `renderTacticsScreen()`, siguiendo el
patrón ya existente — no se introduce un sistema de navegación paralelo.
Las siete vistas de esta sección son sub-pestañas dentro de esa única
pantalla, igual que Alineación (7.11.6) ya unificó convocatoria y
quintetos en una sola pantalla con bloques internos en vez de dos
pantallas separadas.

### 7.12.33 Orden de implementación — EPIC TÁCTICAS

No implementar toda la sección en un único cambio. Orden obligatorio para
reducir riesgo:

#### TAC-1 — Núcleo táctico de posesión

Construir:

- `PossessionPlan`;
- `DefensivePlan`;
- `AdvantageState`;
- `TacticalContext`;
- selección de participantes;
- `shotQuality`/contest contextual;
- primera integración real de P&R con varias coberturas.

Mínimo demostrable:

> El mismo Pick & Roll con los mismos jugadores produce distribuciones de
> lectura distintas frente a Drop, Switch, Hedge y Blitz, pero sigue
> resolviendo los tiros/rebotes/etc. con 7.6.

Sin frontend complejo todavía; tests/simulación primero.

#### TAC-2 — Identidad + roles

Añadir:

- spacing;
- ritmo/early offense;
- pesos de play-type;
- roles ofensivos;
- roles defensivos;
- `roleFit` en estrellas;
- indicadores derivados de quinteto;
- CPU utilizando las mismas estructuras.

#### TAC-3 — Playbook + generación real de oportunidades

Añadir inicialmente:

- Basic P&R;
- Horns;
- Spain P&R;
- Double Drag;
- DHO/Zoom;
- Floppy;
- Post Entry;
- 5-Out Motion;
- Isolation Clearout.

Implementar continuaciones/counters y reemplazar progresivamente la
asistencia posterior de 7.6-D por creación real de tiro.

#### TAC-4 — Defensa avanzada

Añadir:

- zonas;
- match-up zone;
- press;
- ayudas;
- off-ball screen coverages;
- post defense;
- matchups individuales;
- transition defense;
- Box-and-One.

#### TAC-5 — Partido vivo y situaciones

Añadir:

- ajustes entre cuartos;
- timeouts;
- triggers/Auto Timeouts;
- ATO;
- BLOB/SLOB;
- late-game;
- falta táctica intencionada;
- última posesión.

#### TAC-6 — Familiaridad, complejidad y entrenamiento

Añadir:

- familiaridad ofensiva/defensiva;
- familiaridad por jugada/cobertura;
- rol individual;
- coste de complejidad;
- inercia táctica CPU;
- gancho al futuro módulo de Entrenamiento de sección 9.

#### TAC-7 — Data Hub y scouting táctico

Añadir:

- telemetría completa de 7.12.27;
- PPP/frequency por play-type;
- coverage efficiency;
- shot profile/quality;
- lineups;
- informe de rival;
- visualizaciones/alertas de muestra pequeña;
- futura capa de visibilidad limitada por Scouting.

### 7.12.34 Pendientes deliberados del sistema táctico

Aunque la arquitectura queda preparada, NO se cierra todavía:

- valores numéricos finales de `AdvantageState` → contest/shotQuality;
- pesos exactos de selección de play-type;
- catálogo completo de tendencies reales por jugador (7.12.26);
- editor visual de jugadas;
- atributos/estilo propios de un futuro cuerpo técnico/entrenador asistente;
- química interpersonal/relaciones como factor táctico separado;
- scouting que limite la información del rival;
- entrenamiento táctico detallado que modifique familiaridad;
- versiones específicas NBA u otras reglas fuera de FIBA/ACB;
- aprendizaje automático/adaptativo: la CPU inicial es heurística y
  explicable, no una caja negra;
- calibración cuantitativa final contra datos ACB/Euroliga tras simulación
  masiva;
- **compatibilidad con partidas guardadas sin `TacticalProfile`**: todo el
  sistema 7.12 es aditivo y debe tener un fallback neutro (equivalente al
  comportamiento 1v1 actual de `simulatePossession`) cuando un equipo no
  tiene perfil táctico asignado — mismo patrón ya usado para
  `homeLineup`/`awayLineup` ausentes en 7.11.5. No se fuerza migración de
  partidas existentes en TAC-1; se señala aquí para que ninguna sesión de
  implementación lo asuma sin más. **Actualización TAC-2:** `Team.js`
  construye siempre un `TacticalProfile` por defecto en su constructor
  (`new TacticsCore.TacticalProfile(data.tacticalProfile || {})`), así que
  al cargar una partida/save antigua sin ese campo, el equipo reconstruido
  recibe automáticamente el perfil neutro (spacing/identidad/pesos de
  play-type por defecto, cobertura `drop`) — no hace falta ninguna
  migración de datos explícita, el propio constructor la cubre.
- **effectiveSpacing NO conectado a `AdvantageState`/`computeAdvantageScore`
  todavía** (7.12.4/7.12.6): TAC-2 construyó `Tactics.effectiveSpacing()`
  como función aislada y verificada en dirección, pero deliberadamente no
  la usaba para desplazar `advantageScore`. **Actualización TAC-3: ya
  conectado.** `Tactics.computeSpacingAdvantageTerm()` añade un término
  ACOTADO (`config.tactics.advantage.spacing.sensitivity`/`neutral`/
  `maxEffect`) a `computeAdvantageScore`/`computeIsolationAdvantageScore`/
  `computePostUpAdvantageScore` — único sitio donde el spacing entra a la
  fórmula (evita doble conteo, 7.12.4). Verificado en dirección (mismo
  quinteto real, `5-out` > `3-out-2-in`) con un script de invariantes; los
  valores concretos de `sensitivity`/`neutral`/`maxEffect` siguen siendo
  puntos de partida, no cifras cerradas — misma calibración pendiente que
  el resto de 7.12.31 (ver CHANGELOG de TAC-3).
- **pesos de `roleFit`, mezclas de atributos por rol y techos de
  `effectiveSpacing` por arquetipo** (`config.tactics.roles`/
  `config.tactics.spacing` en `MatchConfig.js`): puntos de partida
  razonables con dirección verificada (ver CHANGELOG de TAC-2), no cifras
  cerradas — misma calibración pendiente que el resto de 7.12.31.
- **TAC-3, nuevos pendientes**: catálogo de playbook con solo 9/14 familias
  (Flex, Princeton Elbow/entry, Post Split, High-Low, Pistol quedan fuera);
  Handoff/DHO, Off Screen y Motion/Flow tienen `PlayDefinition` de catálogo
  pero SIN motor propio (solo Pick & Roll/Isolation/Post Up lo tienen esta
  entrega); prioridad/peso editable POR JUGADA dentro de una misma familia
  (pantalla Playbook, solo lista/muestra, no edita todavía); eje
  Rigidez↔Read & React de 7.12.7 sigue sin efecto real (7.12.11 ya lo
  confirmaba: "no se fija todavía una fórmula exacta"); presupuesto de 100
  "posesiones conceptuales" de `Tactics.selectPlayType`
  (`config.tactics.playTypeSelection.budget`) y punto neutro de
  `Tactics.resolveTransitionAttempt` (`config.tactics.transitionAttempt.
  weightNeutral`) son puntos de partida, no cifras cerradas; el límite de 2
  acciones por posesión de 7.12.11 se implementó con un coste de reloj fijo
  (`config.tactics.continuity`), no una simulación real de la segunda
  acción — pendiente de calibración masiva junto al resto de 7.12.31.

### 7.12.35 Fuentes y criterio de diseño

Esta sección combina las decisiones internas ya fijadas en este `DESIGN.md`
con investigación externa de baloncesto real. La evidencia externa se utiliza
para la **estructura de conceptos**, no para introducir coeficientes numéricos
no verificados:

- El manual WABC/FIBA de Nivel 3 describe múltiples defensas del on-ball
  screen y señala explícitamente que los buenos equipos cambian la solución
  según la zona de pista, los atacantes implicados y las limitaciones de sus
  propios defensores. También documenta sets/estructuras como Horns, Flex y
  Princeton, además de zonas y situaciones especiales.
- Los informes de scouting FIBA muestran el uso combinado de 4-Out/5-Out,
  P&R/Pick-and-Pop, DHO, Floppy y variaciones de presión en baloncesto
  internacional: refuerzan que estas piezas son capas combinables, no tácticas
  mutuamente excluyentes.
- El análisis táctico oficial de Basketball Champions League aporta ejemplos
  de Spain P&R, re-screen, Drop/Over, trap, switch, short-roll y rotaciones
  encadenadas, justificando un modelo de **lecturas y counters** en lugar de
  scripts con resultado fijo.
- Las reglas FIBA 2024 se usan como referencia actual para la estructura de
  tiempos muertos; los valores concretos deben seguir viviendo en
  `CONFIG_BASE` para que el motor no dependa de una edición reglamentaria
  concreta.

**Decisión final de filosofía:** Basket Manager debe permitir mucha profundidad
sin exigir que el usuario conozca terminología profesional. La UI puede ofrecer
presets, explicaciones y recomendaciones; el motor, sin embargo, conserva la
estructura profunda descrita aquí. Un usuario puede jugar con una táctica base
sencilla y dejar detalles a la CPU asistente, mientras otro puede configurar
matchups, P&R coverages, playbook, ATO y reglas de ayuda de forma avanzada.
Ambos usan el MISMO motor, no dos modos tácticos distintos.

### Pendiente para sesiones de diseño futuras (Simulación)
- Pesos numéricos finales calibrados de las 21 piezas del catálogo
  (7.6), y de los componentes de desgaste/penalización de polivalencia
  de 7.11 — la estructura está fijada, faltan los números definitivos
  tras pruebas de simulación masiva.
- Bloqueo/pick-and-roll, Tiempo muerto táctico y Falta táctica
  intencionada — **diseño cerrado en 7.12; implementación pendiente según
  TAC-1/TAC-5**.
- Roles tácticos ofensivos/defensivos con valoración en estrellas
  (distintos de la posición en pista, ya resuelta en 7.11) — **diseño cerrado
  en 7.12.9/7.12.21; implementado en TAC-2**.
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
