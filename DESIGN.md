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

### Ascensos y descensos (basado en el sistema real ACB / Primera FEB)

- **2 plazas de ascenso** de 2ª a 1ª división por temporada:
  1. El **campeón de la liga regular** de 2ª división asciende directo.
  2. La segunda plaza se decide por un **playoff de ascenso** entre los
     siguientes mejores clasificados de la liga regular de 2ª división
     (formato completo real: **cuartos de final + Final Four**, número de
     equipos participantes y bombos a definir en detalle al implementar
     este sistema).
  3. El subcampeón de la Copa de 2ª división obtiene mejor posición
     (ventaja de cuadro) en el playoff de ascenso, pero no asciende
     directo por ganar la copa — solo mejora su cabeza de serie.
- **2 plazas de descenso** de 1ª a 2ª división: los 2 últimos clasificados
  de la liga regular de 1ª división.
- **Playoffs por el título de 1ª división**: los **8 primeros** de la liga
  regular disputan el playoff por el campeonato, bracket fijo sin
  repesca (igual que el playoff real de ACB).
- **2ª división NO tiene playoff por el título**: el campeón de la liga
  regular de 2ª división es directamente el campeón de esa división (los
  únicos playoffs en 2ª división son los de ascenso, ver arriba).

### Copa y Supercopa

- **Copa** (de 1ª división): a mitad del calendario de liga, participan
  los **8 primeros clasificados** de la liga regular en ese momento
  (igual que la Copa del Rey actual de la ACB).
- **Copa de 2ª división**: referenciada más arriba (su subcampeón obtiene
  ventaja de cuadro en el playoff de ascenso), pero **su propio formato
  (participantes, calendario, número de rondas) no se ha definido
  todavía** — solo se ha decidido este efecto colateral sobre el playoff
  de ascenso. Pendiente de sesión de diseño dedicada, igual que el
  formato exacto del playoff de ascenso (cuartos + Final Four, ver
  arriba).
- **Supercopa** (formato corto, equipos clasificados por resultados de la
  temporada anterior — a definir criterio exacto más adelante).
- **Competición europea**: los clubes "grandes" están siempre asignados a
  la misma competición europea cada año (sin sistema de clasificación
  dinámico todavía — se revisará más adelante). Un ascenso/descenso de
  división no afecta, por ahora, a la participación europea de estos
  clubes fijos.

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
  del equipo.
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
  cada 48 minutos (~2.06 posesiones por equipo y minuto). El reloj de
  tiro es el mismo en FIBA (24s), así que el ritmo por minuto debería ser
  similar; lo que cambia es el total de minutos jugados. En un partido
  FIBA de 40 minutos, esto da aproximadamente **82-83 posesiones por
  equipo por partido**, con cada posesión durando de media unos ~29-30s
  de reloj real (contando saques y tiempo entre jugadas, no solo el
  reloj de tiro puro). Esta cifra es un punto de partida para
  calibración, no un valor final cerrado.
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
6.1), antes solo mencionado conceptualmente:
- **Consumo**: cada posesión que un jugador está en pista consume una
  pequeña cantidad de Energía, modulada por su atributo Resistencia
  (mayor Resistencia = consume menos Energía por posesión).
- **Efecto**: afecta con **impacto leve** a las acciones de precisión de
  tiro (Tiro exterior, Tiro media distancia, Tiro interior, Bandeja) y
  con **impacto mayor** a las acciones físicas puras (Salto, Velocidad,
  Agilidad, y por tanto Rebote, Robo, Defensa perimetral).
- **Conexión con Falta defensiva (7.6, Bloque B)**: la Fatiga también
  sube la `TendenciaAFalta` efectiva de un defensor — un jugador cansado
  llega tarde a las ayudas y comete más faltas.
- **Recuperación**: fuera del ámbito de un partido concreto — pertenece
  al ciclo de calendario/temporada (cuánto tarda en reponerse ENTRE
  partidos), no a este bucle de posesión. Pendiente de detalle en el
  módulo de calendario/temporada.

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

### Pendiente para sesiones de diseño futuras (Simulación)
- Pesos numéricos finales calibrados de las 21 piezas del catálogo
  (7.6) — la estructura está fijada, faltan los números definitivos
  tras pruebas de simulación masiva.
- Bloqueo/pick-and-roll, Tiempo muerto táctico, Falta táctica
  intencionada — pendientes del futuro módulo de Tácticas (7.6).
- Constantes exactas del `CONFIG_MODIFIERS_NBA` — pendiente hasta que se
  aborde esa parte del proyecto.
- Detalle exacto de Recuperación (ciclo de calendario/temporada, fuera
  del bucle de un partido concreto) — ver 7.5-bis.
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
