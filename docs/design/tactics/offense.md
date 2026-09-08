# Táctica — ataque

_Migrado de `DESIGN.md` (líneas 2637-2959 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

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
  Campo real en `TacticalProfile.identity.rigidity` desde TAC-6 (0-100, 50
  neutro) — TAC-2/TAC-3 lo dejaron señalado en este texto sin campo ni
  efecto; TAC-6 lo conecta a `tacticalExecution` (ver 7.12.22, "Primera
  implementación"): Rigidez alta alcanza un techo de ejecución más alto con
  familiaridad alta pero sufre más con familiaridad baja; Read & React
  tiene un techo algo más bajo pero es más tolerante a familiaridad baja.
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

**Conversión de puntuación (1-20) a estrellas** — vive en `CONFIG_BASE`
(`config.tactics.starRating.thresholds`) como cualquier otro coeficiente
calibrable del sistema táctico, punto de partida no cerrado (ver 7.12.31/
7.12.34):

| Estrellas | Rango de puntuación (1-20) |
|---|---|
| 1★ | 1-6 |
| 2★ | 7-10 |
| 3★ | 11-14 |
| 4★ | 15-17 |
| 5★ | 18-20 |

Misma conversión usada por todas las valoraciones en estrellas del sistema
táctico (`roleFit`, valoraciones derivadas de quinteto de 7.12.28), no solo
por los roles de esta sección.

**Revisión de `roleFit` (mini-EPIC POS)**: la fórmula anterior sumaba
competencia posicional ponderada (30%) a la mezcla de atributos del rol
(70%), lo que permitía que un jugador con atributos neutros pero
posición natural obtuviera un `roleFit` artificialmente alto —
violando el principio de que saber jugar una posición no implica
encajar en un rol que exige atributos concretos.

Nueva fórmula: la mezcla de atributos del rol (`mixScore`) es la base
del score. La competencia posicional (la mejor entre las
`preferredPositions` del rol) actúa como **techo con penalización
acotada**: si el jugador tiene competencia funcional o mejor (≥14,
tabla de 6.1) en alguna posición preferente del rol, no hay
penalización. Por debajo de ese umbral, se resta una penalización con
la misma curva no lineal de 6.1, acotada a un máximo pequeño en CONFIG
(`config.tactics.roles.fitWeights.positionShortfallMaxPenalty`, punto
de partida orientativo: 3-4 puntos sobre 20). El factor de Energía
(`energyBaseline`/`energyRange`) no cambia.

Esto protege dos principios simultáneos: saber jugar de Base con nivel
alto no mejora automáticamente un `roleFit` de rol que exige atributos
que el jugador no tiene; y un gran especialista de rol cuya posición
nominal no es la preferente del catálogo apenas se penaliza, salvo que
su competencia real en las posiciones del rol sea muy baja.

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
