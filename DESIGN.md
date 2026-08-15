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

- **Copa**: a mitad del calendario de liga, participan los **8 primeros
  clasificados** de la liga regular en ese momento (igual que la Copa del
  Rey actual de la ACB).
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

Presupuesto **dinámico**, calculado a partir de ingresos reales del club:

- Taquilla (entradas vendidas, según aforo, resultados recientes, rival)
- Ingresos por TV/retransmisión
- Patrocinios
- Méritos deportivos (premios por clasificación, competiciones europeas)

Gastos: salarios de jugadores, cuerpo técnico, instalaciones,
scouting, cláusulas de fichaje.

*(Fórmulas exactas de cada partida se definirán en detalle cuando se
implemente el módulo económico — este documento se ampliará entonces.)*

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

#### Atributos Técnicos (fijos, mejoran con entrenamiento/edad)
Tiro exterior, tiro media distancia, tiro interior, tiro libre,
bandeja/finalización, pase, manejo de balón, rebote ofensivo, rebote
defensivo, tapón, robo, tendencia a falta.

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

6.2 Ficha de equipo
Diseño ampliado tras sesión de análisis de referentes (Football Manager,
NBA 2K MyNBA/MyGM, Basketball GM, PC Basket/PC Fútbol, Pro Basketball
Manager) — el enfoque es europeo/ACB, evitando deliberadamente
mecánicas específicas de NBA (salary cap, draft, franquicias sin
ascenso/descenso). La adaptación de una eventual comparación con clubes
americanos queda pendiente para cuando se aborde esa parte del proyecto.
Datos básicos
Nombre, ciudad, año de fundación, división actual (1ª o 2ª), presupuesto
(ver desglose económico en 6.2.6).
Estadio/pabellón: sigue siendo una entidad separada asociada al
equipo (no integrada directamente en esta ficha), tal como se decidió
originalmente. Se detallará cuando se implemente su propio diseño; el
equipo solo referencia su instancia de estadio, y variables como aforo y
ocupación (usadas en 6.2.5, factor cancha, y 6.2.6, ingresos de
taquilla) viven en esa entidad, no aquí.
Plantilla
Agrupa jugadores (entidad Jugador, ver 6.1).
Plantilla total del club: sin límite duro por ahora.
Convocatoria de partido: mínimo 8, máximo 12 jugadores, fiel al
reglamento real de la ACB. Se aplica solo a la selección de partido,
no a la plantilla total.
6.2.1 Reputación (el "número maestro")
Se muestra al usuario como 3 sub-componentes visibles por separado:
Reputación deportiva
Reputación financiera
Reputación de cantera
Factores que la alimentan (inspirado en el sistema de FM): títulos
ganados/división en la que compite, calidad de la plantilla (actual e
histórica), éxito desarrollando canteranos propios, e
instalaciones/poder económico del club. La reputación gobierna la
atracción de jugadores en fichajes, el interés de patrocinadores, y las
expectativas que fija la junta/propietario (ver 6.2.4).
6.2.2 Instalaciones (escala 1-20 cada una)
Siete instalaciones internas del club, cada una mejorable con dinero
(sujeto a aprobación de la junta si el gasto es grande), con coste de
mantenimiento anual y posibilidad de quedar obsoleta con el tiempo
si no se actualiza (igual que en Football Manager):
Centro de Entrenamiento — progresión técnica/táctica del primer
equipo, prevención de fatiga.
Centro Médico — prevención y recuperación de lesiones.
Preparación Física — rendimiento físico general y puesta a punto
en pretemporada (distinto del Centro Médico: esta es sobre rendir
mejor, la otra sobre no lesionarse/recuperarse).
Cantera/Academia — calidad de los jugadores jóvenes generados
(ver 6.2.3). En el futuro será la puerta de entrada al sistema
completo de categorías inferiores.
Red de Scouting — ojeadores de campo: descubrimiento de jugadores
externos y velocidad/precisión para revelar los atributos ocultos de
la ficha de jugador (Potencial, Profesionalidad, Ambición).
Departamento de Análisis/Dirección Deportiva — analítica de datos
y oficinas de dirección deportiva. Efecto: mejora general de calidad
de decisiones (fichajes, tácticas). El efecto concreto/numérico se
detallará cuando se diseñe el módulo de fichajes y el de tácticas —
no inventar una fórmula todavía.
Hospitality/Patrocinio — zonas VIP y relación con patrocinadores;
alimenta los ingresos de Publicidad extra (ver 6.2.6).
6.2.3 Cantera/Academia — placeholder actual
Ambición declarada del proyecto (diferenciador frente a otros
managers): más adelante se diseñará un sistema completo de gestión de
categorías inferiores reales (infantil, cadete, junior, etc., cada
una con su propia plantilla y progresión), algo que prácticamente ningún
manager del mercado aborda con profundidad. Este sistema es complejo y
queda pendiente de una sesión de diseño dedicada, junto con la
decisión de si existe un club filial/vinculado en 2ª división para ceder
jóvenes (también pendiente, ver nota abajo).
Mientras tanto (placeholder para poder jugar ya): cada temporada, la
instalación Cantera/Academia genera 3 jugadores jóvenes aleatorios,
con atributos coherentes según las reglas ya definidas en 6.1
(multi-posición, escala 1-20, atributos ocultos, potencial, etc.). Sin
filial ni categorías todavía — estos jugadores se incorporan
directamente a la plantilla total del club.
6.2.4 Junta/Propietario y objetivos de temporada
Existe una junta/propietario por encima del usuario (que ocupa el
rol fusionado presidente+entrenador, ver sección 8) que puede
despedirle si no se cumplen los objetivos. Detalle equivalente al
Club Vision de FM:
Nivel de paciencia (se erosiona con malos resultados sostenidos).
Objetivo deportivo de la temporada (ej. posición en liga,
permanencia, clasificación europea).
Objetivo financiero de la temporada (ej. equilibrio
presupuestario, no superar deuda).
Plan a varias temporadas (visión plurianual, similar al "plan a
cinco años" de FM).
Esto conecta con la regla ya establecida en la sección 4: el usuario
puede ser despedido y fichar por otro club durante la partida.
6.2.5 Afición y factor cancha
Variables de afición en la ficha de club:
Base de abonados
Satisfacción de la afición (dinámica, sube/baja con resultados,
fichajes, precio de entradas, etc.)
Ocupación media del pabellón
Factor cancha: modula el rendimiento del equipo local con una
fórmula basada en ocupación × satisfacción × importancia del
partido, con más efecto en derbis y playoffs. Ver nota de investigación:
estudios reales (Ganz y Allsop, 2024) cifran la ventaja real de jugar en
casa en torno a ~2.1 puntos con público lleno frente a ~0.4 puntos sin
público — usar esta magnitud como referencia de calibración cuando se
implemente la fórmula en el motor de simulación, no un número arbitrario.
6.2.6 Finanzas — desglose completo de ingresos y gastos
Sustituye el "presupuesto dinámico" genérico de la sección 5 por este
desglose, fiel a la estructura económica real de la ACB (donde, a
diferencia de la NBA, el patrocinio es la primera fuente de ingresos,
no la televisión):
Ingresos:
Patrocinio principal (naming del club/camiseta) — depende de
reputación financiera.
Publicidad extra (patrocinadores secundarios) — depende de
reputación y de la instalación Hospitality/Patrocinio.
Televisión/retransmisión — parte fija de liga + parte variable
por reparto por méritos deportivos (posición final de temporada).
Contrato de liga (reparto centralizado de la ACB, distinto de
TV) — también con componente por méritos.
Competición europea — premios propios de participar/avanzar en
competición europea, aparte de la liga nacional.
Taquilla — según ocupación del pabellón × precio de entrada,
conectado con la sección de afición (6.2.5).
Merchandising — depende de reputación y de tener jugadores
populares/estrella en plantilla.
Gastos:
Salarios de jugadores.
Mantenimiento anual de las 7 instalaciones (6.2.2).
Cuerpo técnico — partida ya anotada pero con importe pendiente de
definir cuando se diseñe esa entidad (ver 6.2.7).
6.2.7 Cuerpo técnico
No existe todavía como entidad propia — de momento el usuario ES el
entrenador/presidente (rol único, ver sección 8). Pendiente de sesión de
diseño futura (ayudantes, preparador físico dedicado, etc.), momento en
el que también se definirá su coste salarial exacto dentro de gastos.
6.2.8 ADN de Club
Cada club tiene un rasgo de identidad histórica (ej. cantera, ritmo
alto, defensa, veteranía) que:
Sesga el tipo de jugadores que genera la Cantera/Academia (6.2.3).
Da un bonus de moral cuando el equipo juega conforme a su
tradición, y una penalización (descontento de afición) cuando la
traiciona sistemáticamente.
6.2.9 Rivalidades
Dos tipos, ambos activos desde ya:
Rivalidades fijas, por historia/geografía (derbis tradicionales).
Rivalidades dinámicas, que emergen durante la partida por competir
repetidamente por los mismos objetivos (título, permanencia, plaza
europea).
Efecto: bonus de moral y de asistencia/ocupación del pabellón en esos
partidos concretos.
6.2.10 Historia y leyendas de club
Sistema completo de niveles automáticos, inspirado en Football Manager:
Predilecto → Ídolo → Leyenda, calculado según títulos ganados,
premios individuales, y actuaciones destacadas en derbis/rivalidades. El
estatus puede mantenerse aunque el jugador abandone el club.
Pendiente para sesiones de diseño futuras (Equipo)
Sistema completo de categorías inferiores reales (infantil, cadete,
junior...) con sus propias plantillas y progresión — ver 6.2.3.
Club filial/vinculado en 2ª división para ceder canteranos — ver
6.2.3.
Cuerpo técnico como entidad propia y su coste salarial — ver 6.2.7.
Fórmula numérica exacta del efecto del Departamento de
Análisis/Dirección Deportiva sobre fichajes y tácticas — ver 6.2.2.

## 7. Simulación de partidos

Nivel de detalle: **medio** — por cuartos, con eventos destacados
(ej. tapón decisivo, triple sobre la bocina, parcial de anotación,
lesión durante el partido). No es simulación jugada a jugada completa,
pero tampoco es solo un resultado final frío.

## 8. Roles y control del club

Un único rol de usuario que controla:

- Fichajes y renovaciones
- Tácticas y alineaciones
- Entrenamientos y desarrollo de jugadores
- Finanzas y presupuesto
- Contratación de staff (cuerpo técnico, scouts, médicos)
- Relación con la directiva/afición (objetivos de temporada, presión)

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
