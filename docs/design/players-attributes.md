# Jugadores — ficha, posiciones y polivalencia

_Migrado de `DESIGN.md` (líneas 1021-1234 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

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

**Posiciones secundarias de jugadores reales (revisión mini-EPIC POS)**:
decisión de producto — no se invierte tiempo en investigar fuentes
externas (ACB/FEB/scouting) para reconstruir con rigor histórico las
posiciones secundarias de los 414 jugadores reales. En su lugar, se
derivan por **similitud de perfil de atributos** contra los mismos
perfiles de posición (`POSITION_PROFILES`) que usa el generador de
jugadores ficticios: cada posición no-nominal de un jugador real recibe
un valor 1-20 proporcional a cuánto se parece su perfil de atributos ya
existente (técnicos/físicos/mentales, calibrados en sesiones anteriores)
al perfil típico de esa posición. Esto sustituye tanto al criterio de
la migración original (`migrate-positions-to-map.js`, valores planos
12/2) como al de la regeneración posterior (`regenerate-real-positions.js`,
ruido determinista sin correlación con nada) con un criterio que tiene
significado real sin necesitar ninguna fuente nueva. La posición nominal
(`nominalPosition`) de cada jugador real es la única posición que ya
tenía dato fiable (la reportada originalmente) y no se toca.

### 6.1 Ficha de jugador

Inspirada en el nivel de profundidad de Football Manager, adaptada a
baloncesto. Todos los atributos numéricos en **escala 1-20**.

**Posiciones** (revisión mini-EPIC POS): cada jugador tiene un **mapa
con nivel de competencia 1-20 para las 5 posiciones** (Base, Escolta,
Alero, Ala-pívot, Pívot), siempre presente — nunca una lista variable
de 1 a 5 entradas.

- **20 significa dominio/naturalidad completa para las responsabilidades
  de esa posición — NUNCA significa "es un gran jugador".** Un jugador
  con posición 20 y atributos mediocres sigue siendo mediocre; la
  competencia posicional no es un sustituto de Overall.
- **No existe restricción de unicidad**: un jugador puede tener 0, 1, 2,
  o más posiciones con valor 20, según su perfil real. El motor debe
  poder representar sin excepciones de código tanto a un especialista
  puro (una sola posición en 20, resto bajo) como a un jugador
  extremadamente polivalente (varias posiciones en 20 o en niveles
  altos no contiguos).
- **Los valores no tienen por qué ser contiguos** en el espectro
  Base-Escolta-Alero-Ala-pívot-Pívot. La cercanía funcional es una
  tendencia razonable para generación (ver más abajo), nunca una regla
  dura sobre datos ya conocidos de un jugador real.
- **Posición nominal** (`nominalPosition`, campo explícito, asignado por
  el generador o la migración de datos reales — nunca derivado ni
  inferido): representa la identidad posicional habitual/de ficha del
  jugador, la que se muestra en listados y convocatorias por defecto.
  Puede diferir de cuáles posiciones tienen valor 20 en su mapa.
- **Dominio completo** (qué posiciones tienen valor 20) es una propiedad
  derivada del mapa, consultable pero no declarada como campo aparte.
- **Posiciones secundarias**: las que tienen un valor entre 1 y 19,
  coherente con el resto de la ficha — un grado real de competencia,
  no una etiqueta plana de "habilitada/no habilitada" (ej. un base con
  Escolta a nivel 16 se defiende mucho mejor ahí que uno a nivel 6).
- Este shape simplifica el uso en el motor (7.11.3, polivalencia de
  emergencia): nunca hay que comprobar si una posición "existe" en los
  datos del jugador — siempre hay un valor que consultar, incluso para
  las posiciones no habilitadas (nivel 1 por defecto).
- El generador de jugadores (real o ficticio) decide el valor de cada
  una de las 5 posiciones. Para jugadores ficticios, distingue tres
  arquetipos de polivalencia (especialista, combo/polivalente moderado,
  positionless), con pesos de probabilidad en CONFIG — heurística de
  generación, no regla de diseño cerrada. Para jugadores reales, ver
  nota en la sección de datos reales (6, más arriba): las posiciones
  secundarias se derivan por similitud con el perfil de atributos que
  el generador ya usa, nunca de investigación externa.

**Semántica de los tramos 1-20** (`config.positions.competenceThresholds`,
CONFIG_BASE, punto de partida no cerrado, calibrable):

| Rango | Descriptor |
|---|---|
| 20 | Dominio natural completo |
| 18-19 | Prácticamente natural |
| 15-17 | Muy competente |
| 11-14 | Funcional |
| 7-10 | Emergencia |
| 1-6 | Claramente fuera de posición |

La penalización asociada a un nivel de competencia (usada en 7.11.3 y
7.12.9) sigue una curva **no lineal**, no una resta lineal proporcional
al nivel: la diferencia 20→18 debe pesar poco; la diferencia 10→5 debe
pesar mucho más. Fórmula estructural: `penalización_base × (1 −
nivel/20)^exponente`, con `exponente > 1` viviendo en CONFIG (punto de
partida orientativo: 1.6, sin validar con simulación aún).

**Referencia de diseño externa**: esta filosofía de tramos con curva no
lineal, en vez de una resta lineal proporcional, es coherente con cómo
simuladores de gestión deportiva maduros (Football Manager) modelan la
familiaridad posicional: la caída de rendimiento no es proporcional
punto a punto, sino que se acelera cuanto más lejos está el jugador de
su nivel natural.

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
liderazgo, trabajo en equipo, temperamento, consistencia, anticipación,
posicionamiento (movimiento sin balón), ética de trabajo (esfuerzo/energía
que invierte en el partido, distinto de profesionalidad, que es cómo
entrena).

Corrección (LIFE-1): esta lista duplicaba históricamente ambición y
profesionalidad, que en realidad viven solo como **ocultos** (ver más
abajo) — `hidden.professionalism`/`hidden.ambition` en el código, nunca
dentro de `mental`. Se retiran de aquí para que la fuente canónica sea una
sola.

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
Potencial (techo de mejora — escala 1-200 desde LIFE-1, ver sección 9),
profesionalidad, ambición, y (LIFE-1) velocidad de aprendizaje
(`learningRate`) y persistencia de aprendizaje (`learningPersistence`),
ambos 1-20. El scouting los revela progresivamente y con precisión
creciente según la calidad de los ojeadores del club (a definir en detalle
cuando se implemente el módulo de scouting).

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
- Sistema de lesiones — **cerrado en LIFE-3, ver 9.14**. `Durability`
  (`player.physical.durability`, 1-20) es la ÚNICA predisposición basal a
  lesión — no existe un segundo atributo `injuryProneness`; Durability
  alta reduce la incidencia (nunca la velocidad de rehabilitación, que
  depende de `Recovery`), sin hacer a nadie inmune.
