# Player Life — TMB, Potencial y desarrollo (LIFE-1)

_Migrado de `DESIGN.md` (líneas 4569-4770 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 9. Player Life — carrera, TMB, Potencial, desarrollo y declive

Implementado en **LIFE-1** (`src/core/PlayerDevelopment.js`,
`CONFIG_BASE.playerDevelopment` en `MatchConfig.js`). Player.js guarda
datos/estado; PlayerDevelopment.js concentra las reglas; game.js solo
orquesta desde los puntos de integración ya existentes
(`applyRecoveryForResolvedMatch`, `closeSeasonAndPrepareNext`).

### 9.1 TMB Rating y Potencial: dos escalas 1-200

**TMB Rating** (`tmbRating`, calculado bajo demanda vía
`computeTmbRating()`, nunca persistido) resume la capacidad ACTUAL del
jugador combinando sus 29 atributos mutables (9.4), ponderados según la
relevancia de cada uno para su `nominalPosition`. Es el equivalente
conceptual de una Current Ability: útil para comparar/ordenar jugadores,
pero **no sustituye a los atributos 1-20** — MatchEngine, Tactics y
Rotation siguen leyendo únicamente los atributos individuales, nunca TMB.

**Potencial** (`hidden.potential`, escala 1-200) es el techo máximo de TMB
que el jugador puede alcanzar mediante desarrollo positivo. **PA 200 no
significa que todos los atributos vayan a 20** — un jugador puede tener PA
200 y seguir teniendo atributos mediocres en zonas poco relevantes para su
perfil; lo que exige un PA/TMB altísimo es un perfil ponderado de nivel
extraordinario para su posición, no un vector plano de atributos
perfectos. Ambos, TMB y Potencial, permanecen ocultos en la UI real de
partida (ver 6.1) — el modo prueba de `index.html` (sección "LIFE-1 —
Carrera, TMB y Potencial") es la única herramienta de inspección.

Fórmula de TMB (resumen; ver comentarios de `PlayerDevelopment.js` para el
detalle exacto): media ponderada de los atributos mutables efectivos
(visible + residual, ver 9.3), donde el peso de cada atributo para una
posición sale de normalizar su delta en `POSITION_PROFILES`
(`playerGenerator.js`) dentro del rango global de deltas del catálogo —
mismo peso para el mismo delta, sea cual sea la posición donde aparezca.
Atributos ausentes del perfil de esa posición reciben un peso mínimo
(`relevanceFloor`, nunca 0). La competencia posicional (mapa 1-20 de POS,
sección 6.1) **no** entra en TMB — un jugador no gana calidad global por
ser polivalente.

### 9.2 Migración del Potencial legacy

Los 414 jugadores reales y cualquier dato anterior a LIFE-1 traen
Potencial en escala 1-20. Al reconstruir un `Player`, un valor `<= 20` se
multiplica ×10 (idempotente: recargar un valor ya migrado nunca lo vuelve
a multiplicar). Los JSON de `data/real/` **no se reescriben** — la
migración corre en memoria cada vez que se instancia el `Player`, igual
que otros valores por defecto de `Player.js`.

`hidden.potential` vive FUERA de la lista genérica `HIDDEN_ATTRIBUTES` de
`Player.js` a propósito: esa lista pasa por un clamp 1-20 dentro del
propio constructor, que destruiría cualquier valor migrado a 1-200 antes
de que la migración pudiera actuar. `PlayerDevelopment.ensureDevelopmentState()`
además refuerza en cada uso que el Potencial nunca quede por debajo del
TMB actual del jugador.

### 9.3 Precisión interna: residuales

Los atributos que consume el resto del motor siguen siendo enteros 1-20.
Por debajo, `player.developmentState.attributeProgress` guarda un residual
decimal por atributo mutable (normalmente en `[-0.5, +0.5)`); el valor
`efectivo = visible + residual` es el que usa TMB y el propio desarrollo.
Cuando el residual cruza ±0.5, el entero visible sube/baja 1 y el residual
se reajusta — así un jugador puede progresar durante semanas sin que
aparezca necesariamente un +1 visible cada tick.

### 9.4 Atributos mutables

29 en total — technical (13: outsideShot, midRangeShot, insideShot,
freeThrows, layup, passing, ballHandling, offensiveRebound,
defensiveRebound, blocking, stealing, perimeterDefense, interiorDefense),
physical (8: topSpeed, acceleration, jumping, strength, agility, balance,
stamina, recovery), mental (8: gameVision, pressureDecisionMaking,
concentration, leadership, teamwork, consistency, anticipation,
positioning). **No mutables en LIFE-1**: foulTendency, durability,
aggressiveness, temperament, workRate, Profesionalidad, Ambición,
Potencial, learningRate, learningPersistence, traits, bodyMeasurements,
positions/nominalPosition, familiaridad táctica.

### 9.5 Curvas independientes de aprendizaje y declive

Cada atributo mutable pertenece a una de 6 categorías (explosive, strength,
endurance, technical, cognitive, social — `CONFIG_BASE.playerDevelopment.attributeCategories`),
cada una con su propia curva de **aprendizaje positivo** y su propia curva
de **declive por edad** (puntos `[edad, factor]`, interpolación lineal,
sin extrapolar fuera de rango). Ambos procesos son independientes en el
mismo tick — un jugador puede perder Salto mientras mejora Pase el mismo
periodo. El **declive** nunca se multiplica por mindset/exposición/
instalaciones (ninguno de los motores de aprendizaje positivo frena el
declive físico); `learningPersistence` (9.7) sí amortigua el declive de
technical/cognitive/social exclusivamente, nunca explosive/strength/
endurance.

### 9.6 Longevidad individual (`agingOffsetYears`)

Parámetro latente por jugador, generado una sola vez de forma determinista
(rango -3 a +6 años, distribución centrada en 0), **independiente** de
Potencial/TMB/learningRate/learningPersistence/Profesionalidad/Ambición.
Las curvas de declive se consultan con `effectiveDeclineAge = edad real -
agingOffsetYears`, nunca con la edad real directa — desplaza cuándo entra
el jugador en su ventana de declive sin cambiar la forma de la curva ni
hacerlo inmortal. Dos jugadores con el mismo PA pueden así tener picos de
carrera separados por varios años.

### 9.7 Profesionalidad, Ambición y velocidad/persistencia de aprendizaje

Cuatro señales distintas, ninguna sustituye al talento (Potencial):

- **Profesionalidad** y **Ambición** (`hidden`, 1-20 cada una) se combinan
  en `mindsetFactor` (media aritmética 50/50 de dos factores lineales
  1-20 → [0.75, 1.25]) — ambos altos forman el entorno óptimo; ambición
  alta con poca profesionalidad no "explota" el desarrollo por sí sola.
- **learningRate** (`hidden`, 1-20): velocidad intrínseca para convertir
  estímulo en aprendizaje, independiente del Potencial.
- **learningPersistence** (`hidden`, 1-20): cuánto tiempo conserva
  capacidad de mejora en technical/cognitive/social con la edad — no
  protege nunca contra el declive físico.

Si faltan en los datos, se generan una sola vez de forma determinista a
partir de `developmentState.developmentSeed` (distribución centrada
10-11) y se persisten.

### 9.8 Minutos y exposición competitiva

`developmentState.matchExposures` registra `{date, minutes, competition,
division}` de cada partido con minutos reales jugados — se alimenta desde
`applyRecoveryForResolvedMatch()` (game.js), el único punto de
post-procesado compartido por las 4 competiciones y las 36 plantillas.
LIFE-2 (9.13) añade un campo opcional `positionMinutes` al mismo registro
— minutos reales por posición ocupada en pista — sin crear una estructura
paralela.
`exposureFactor` es una función cóncava (raíz cuadrada) de los minutos
semanales recientes (ventana de 30 días) ponderados por división (1ª pesa
más que 2ª, de forma moderada): salta con claridad entre 0 y ~12-15
minutos, se aplana progresivamente después (sin tope duro) — jugar 40
minutos no duplica el estímulo de jugar 12-15. El rendimiento de esa noche
concreta **nunca** afecta al desarrollo, solo minutos/competición/
división. Las exposiciones fuera de la ventana se descartan (no crecen
indefinidamente).

### 9.9 Instalaciones y hook de Staff

`facilityFactor` reutiliza `team.facilities.trainingCenter.level` (6.2.2,
ya existente) con un efecto moderado (nivel 1 → 0.9, nivel 20 → 1.1).
`staffFactor` es un multiplicador fijo (1.0) en la fórmula, dejado como
punto de extensión explícito para un futuro sistema de Staff — no
implementado todavía. LIFE-2 (9.13) añade, en paralelo y sin sustituirlo,
`config.training.staffContext` — un mecanismo NUEVO y distinto, usado solo
por los sistemas de posición/rol de esa entrega, nunca por el crecimiento
general de atributos (evita doble contabilización del mismo Staff futuro).

### 9.10 Límite de Potencial (headroom)

Antes de aplicar el crecimiento de un tick, se calcula el `uncappedTmb`
proyectado (sin el clamp visual a 200); si superaría el Potencial, el
crecimiento de ese tick se recorta proporcionalmente entre los atributos
que crecen para que `uncappedTmb` nunca lo supere. El declive, en cambio,
puede bajar TMB estando ya en el propio Potencial, sin ninguna restricción
de este tipo.

### 9.11 Calendario, ticks y determinismo

El desarrollo se procesa internamente en bloques de 7 días
(`tickDays`), disparado desde `game.js` en el único punto que avanza el
reloj de mundo (`advanceGameClockTo()`, envoltorio de
`Calendar.advanceTo()`) — nunca un segundo reloj propio. Si transcurren
más de 7 días de una vez, se procesan todos los ticks completos que quepan
y se conserva el remanente. Toda la aleatoriedad de LIFE-1 (residuales
iniciales, generación de learningRate/learningPersistence/
agingOffsetYears, ruido de crecimiento) sale de una función hash
determinista a partir de `developmentState.developmentSeed` — nunca de
`Math.random()` en el camino de progresión. Misma partida + mismas
decisiones = misma trayectoria futura; una partida nueva puede producir
otro seed.

El cierre de temporada (`closeSeasonAndPrepareNext()`) procesa el
desarrollo de las 36 plantillas existentes hasta el instante exacto de
cierre **antes** de que `Team.generateAcademyIntake()` añada canteranos
nuevos — un canterano recién generado no recibe progreso retroactivo.

LIFE-2 (9.13) corrige un orden real de esta entrega: la recuperación de
Energía por descanso entre partidos se resuelve ahora **antes** de simular
cada partido (`Training.prepareTeamForMatch()`, llamado desde el resolver
de opciones de partido de `game.js`), no después — un partido ya no
consume la Energía "sin recuperar" del hueco anterior. El resto de esta
sección (ticks de 7 días, determinismo por seed, cierre de temporada) sigue
tal cual.

### 9.12 Límites explícitos de LIFE-1

No incluye (quedan para entregas futuras, ver más abajo): entrenamiento
configurable, lesiones/medicina, Staff contratable, scouting, aprendizaje
de posiciones, ni histórico completo de carrera. `Experience`
(`Player.addExperience()`) queda conectada de forma mínima: cada partido
con minutos jugados suma 1 punto — no es una fórmula nueva de progresión
de experiencia, solo se dejó de dejar la API sin ningún llamador.

- **LIFE-2 — Entrenamiento**: implementado, ver 9.13.
- **LIFE-3 — Lesiones/Medicina**: implementado, ver 9.14.
- **LIFE-4 — Histórico de carrera**: pendiente (`Player.medicalState.injuryHistory`,
  ya introducido por LIFE-3, queda reservado para que LIFE-4 lo reutilice
  sin crear un segundo histórico).
