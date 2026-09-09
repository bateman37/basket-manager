# Ficha de equipo/club

_Migrado de `DESIGN.md` (líneas 1235-1464 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 6.2 Ficha de equipo

Diseño ampliado tras sesión de análisis de referentes (Football Manager,
NBA 2K MyNBA/MyGM, Basketball GM, PC Basket/PC Fútbol, Pro Basketball
Manager) — el enfoque es **europeo/ACB**, evitando deliberadamente
mecánicas específicas de NBA (salary cap, draft, franquicias sin
ascenso/descenso). La adaptación de una eventual comparación con clubes
americanos queda pendiente para cuando se aborde esa parte del proyecto.
Esta ficha describe el CONCEPTO de "club" tal como lo ve el usuario —
técnicamente, desde CLUB-CORE-1 (sección 10.12), vive repartida entre TRES
entidades distintas: `Club` (identidad institucional — presupuesto,
instalaciones, junta, afición, finanzas, ADN de club, reputación
financiera/de cantera), `Team` (sección deportiva — reputación deportiva,
perfil táctico, rivalidades, histórico de títulos/leyendas) y `Squad`
(contenedor operativo real de la plantilla que juega, `src/entities/
Squad.js`). `Team.roster` sigue siendo la forma de leer "la plantilla del
club" para cualquier pantalla — es una vista de compatibilidad sobre el
`Squad` activo del equipo, nunca un array paralelo. Ninguna de las reglas
de diseño de esta sección cambia por esa separación técnica; solo cambia
DÓNDE vive cada dato en el código (ver 10.3 para el detalle técnico
completo).

#### Datos básicos
Nombre, ciudad, año de fundación, división actual (1ª o 2ª), presupuesto
(ver desglose económico en 6.2.6). **`división` es el `legacyDivision` de
ACB/Primera FEB** (sección 10.6) — la fuente real de en qué competición
participa un equipo es `CompetitionEntry`, nunca este campo.

**Estadio/pabellón**: sigue siendo una **entidad separada** asociada al
equipo (no integrada directamente en esta ficha), tal como se decidió
originalmente. Se detallará cuando se implemente su propio diseño; el
equipo solo referencia su instancia de estadio, y variables como aforo y
ocupación (usadas en 6.2.5, factor cancha, y 6.2.6, ingresos de
taquilla) viven en esa entidad, no aquí.

#### Plantilla
Agrupa jugadores (entidad `Jugador`, ver 6.1).
- **Plantilla total del club**: sin límite duro por ahora.
- **Convocatoria de partido**: rango real de la competición donde juega el
  club — ACB 8-12, Primera FEB 10-12 (ROSTER-1, ver 9.16, primera vertical
  del núcleo normativo multi-liga). "8-12" NO es una cifra universal del
  motor: es el rango de ACB, resuelto por `CompetitionRules.resolveRules()`
  igual que cualquier otra competición futura. Se aplica solo a la
  selección de partido, no a la plantilla total.

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
expectativas que fija la junta/propietario (ver 6.2.4). **Nota técnica
(CLUB-CORE-1)**: `team.reputation` sigue exponiendo los 3 juntos como
vista compuesta de solo lectura — deportiva vive en `Team`
(`_sportingReputation`), financiera y de cantera viven en `Club`
(`reputationFinancial`/`reputationYouth`).

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

**Estado original (placeholder para poder jugar ya, antes de CYCLE-1):**
cada temporada, la instalación Cantera/Academia generaba **3 jugadores
jóvenes aleatorios**, con atributos coherentes según las reglas ya
definidas en 6.1 (multi-posición, escala 1-20, atributos ocultos,
potencial, etc.). Sin filial ni categorías todavía — estos jugadores se
incorporaban directamente a la plantilla total del club.

**Estado actual desde CYCLE-1 (9.22)**: la cantera ya NO entra
directamente a la plantilla del primer equipo — `AcademyService.
runAnnualIntake()` la mantiene como un **pool separado**
(`AcademyRegistry`, cupo real de hasta 8 por club) hasta que una decisión
explícita (anual, o una promoción real desde la pantalla "Planificación")
la incorpora al roster senior vía `promoteToFirstTeam()`. Sigue sin existir
filial ni categorías inferiores reales — eso sigue pendiente de la sesión
de diseño dedicada mencionada arriba —, pero el pool de cantera ya no se
confunde con la plantilla que juega los partidos. **Nota técnica
(CLUB-CORE-1)**: `AcademyMembership.clubId` (y el pool de
`AcademyRegistry.activePoolForClub()`) es SIEMPRE el `clubId` institucional
real — la cantera pertenece al Club, nunca a un `teamId` deportivo;
`promoteToFirstTeam()` sigue afiliando al jugador al `Team` real (roster/
`Squad`) a través de `RosterMutationService`.

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

**Nota técnica (SQUAD-BUDGET-1)**: el primer recurso REAL que la junta
asigna al manager ya está implementado — el presupuesto salarial de
plantilla (`clubId+seasonKey+currency`, congelado por temporada,
`SquadBudgetRegistry`/`SquadBudgetService`, ver
`docs/architecture/squad-budget.md`). Es deliberadamente estrecho: solo
cubre salario garantizado de jugadores, no caja/ingresos/gastos generales
del club. Las peticiones jugables de ampliación de presupuesto, la
confianza de junta dinámica y la comparación rendimiento-vs-expectativa
mencionadas en esta sección siguen sin implementar — quedan como la
entrega siguiente requerida (ver "Deuda aplazada" en
`docs/epics/SQUAD-BUDGET-1.md`).

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

**Nota técnica (SQUAD-BUDGET-1)**: de este desglose completo, hoy solo
existe una implementación REAL y acotada del primer gasto — "Salarios de
jugadores" como presupuesto salarial de plantilla asignado por la junta
(ver nota técnica de 6.2.4 y `docs/architecture/squad-budget.md`). El resto
de ingresos/gastos de esta sección (patrocinio, TV, taquilla, merchandising,
mantenimiento de instalaciones, cuerpo técnico) sigue siendo diseño sin
implementar — no hay caja, ingresos ni beneficio reales en el motor
todavía; la pantalla Finanzas lo declara explícitamente para no
confundirlo con este desglose conceptual.

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
