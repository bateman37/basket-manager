# Táctica — fundamentos y núcleo de posesión

_Migrado de `DESIGN.md` (líneas 2368-2636 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

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
