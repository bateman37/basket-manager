# Alineaciones, rotación y desgaste/energía

_Migrado de `DESIGN.md` (líneas 1946-2367 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 7.11 Alineaciones, Rotación y Desgaste/Energía

Sesión de diseño dedicada: el motor asumía (7.1, 7.5-bis) que existía
una asignación de minutos/posición en pista por jugador, sin haberla
definido nunca formalmente. Esta sección la cierra, junto con el modelo
de desgaste y recuperación de Energía que depende directamente de ella.

#### 7.11.1 Convocatoria y posición declarada

- La convocatoria de partido sigue la regla ya fijada en 6.2: rango real
  de la competición (ACB 8-12, Primera FEB 10-12 — ROSTER-1, 9.16), nunca
  un 8-12 fijo para toda la plantilla total.
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

#### 7.11.3 Polivalencia de emergencia (revisión mini-EPIC POS)

Cuando, durante el reparto automático de rotación, una posición se
queda sin cobertura (los jugadores asignados a ella agotaron su cuota,
o no hay convocados suficientes en ella):

- El motor busca, entre los convocados que **todavía tengan minutos
  disponibles**, el que tenga el **mayor nivel de competencia real** en
  esa posición (mapa de 6.1). **La distancia posicional geométrica ya
  no interviene en esta selección** — una vez existe un mapa 1-20
  explícito y siempre presente, el nivel real es toda la información
  necesaria; añadir distancia geométrica encima sería contabilizar dos
  veces la misma idea.
- **Desempate**: si hay varios candidatos con el mismo nivel, gana el
  que tenga más cuota de minutos restante.

**Penalización por polivalencia — diferenciada por tipo de atributo,
no plana sobre todo el jugador**: revisión central de esta sesión de
diseño. La versión anterior restaba un único valor de rating al
resultado final de CUALQUIER mezcla de atributos en la que el jugador
participara, sin distinguir el tipo de acción. Esto no refleja bien lo
que realmente falla cuando un jugador cubre una posición ajena: su tiro
o su velocidad no cambian por jugar en otro sitio del campo — lo que le
falla es la lectura del juego, el posicionamiento y la ejecución de
responsabilidades específicas de esa posición.

- Los atributos de cada mezcla se clasifican en dos categorías
  (`config.positions.attributeCategory`, catálogo fijo en CONFIG):
  - **Responsabilidad posicional**: `positioning`, `gameVision`,
    `pressureDecisionMaking`, `anticipation`, `interiorDefense`,
    `perimeterDefense`, `teamwork` — reciben la penalización completa
    de la curva no lineal de 6.1.
  - **Habilidad pura**: el resto de atributos técnicos y físicos
    (tiro en sus variantes, pase, manejo, atributos físicos) — reciben
    una fracción reducida de esa penalización
    (`config.positions.pureSkillPenaltyFraction`, punto de partida
    orientativo: 0.2, no una cifra cerrada), reflejando que el cuerpo y
    la técnica del jugador no desaparecen por jugar fuera de su
    posición habitual.
- Esta diferenciación es coherente con cómo simuladores de gestión
  deportiva maduros de otros deportes (Football Manager) ya modelan el
  mismo problema: la penalización por jugar fuera de posición se
  concentra en atributos de posicionamiento y decisión, no se aplica
  de forma uniforme a todos los atributos del jugador.
- **Fórmula estructural**:
  ```
  basePenalty = config.emergencyVersatility.basePenalty ×
                (1 − nivel/20)^config.positions.competencePenaltyExponent
  responsibilityPenalty = basePenalty
  pureSkillPenalty = basePenalty × config.positions.pureSkillPenaltyFraction
  ```
- Efecto práctico: un jugador con nivel alto en la posición de
  emergencia apenas sufre penalización en ningún atributo; un jugador
  con nivel bajo sufre penalización fuerte en lectura/posicionamiento/
  defensa específica, pero conserva la mayor parte de su calidad de
  tiro, pase y atributos físicos.
- **La distancia posicional geométrica se conserva únicamente como
  heurística de GENERACIÓN** (playerGenerator) y como criterio de
  derivación para datos reales (ver sección de datos reales, 6) —
  nunca vuelve a aparecer en un cálculo de selección o rendimiento
  durante un partido ya simulado.

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
  **Gancho cerrado por LIFE-2 (9.13)**: `Recovery.applyRestRecovery`
  recibe el `trainingModifier` real que la intensidad de entrenamiento
  calcula (`effectiveRecoveryMultiplier`, atenuado por la densidad
  competitiva de la semana) — la fórmula de `Recovery.js` en sí no se
  tocó, solo se le empezó a pasar un valor real en vez del neutro (1) de
  siempre.

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
`Player.js` + enganche en el resolver compartido de `game.js`), en
producción desde hace varias sesiones. CAL-1 (ver 3.3.7): `lastMatchDate`
lleva ahora hora real con significado (horario real de partido), y
`Player.toJSON()` se corrigió para serializarla completa (antes se
truncaba a solo fecha).

**Reordenado por LIFE-2 (9.13)**: hasta esa entrega, `applyRestRecovery`
se invocaba DESPUÉS de simular el partido (bug real detectado: el partido
consumía la Energía sin recuperar del hueco de descanso anterior). Ahora
se invoca ANTES, desde `Training.prepareTeamForMatch()` — y para la
plantilla COMPLETA de cada equipo (no solo los jugadores con minutos>0 en
ESE partido), avanzando `lastMatchDate` de todos a la fecha del partido:
evita el doble cómputo de recuperación que existiría si el "reloj de
descanso" de un jugador se quedara parado hasta su siguiente aparición
real en pista. El registro de exposición/Experience (que sí depende del
resultado ya simulado) sigue resolviéndose después, sin cambios.

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

**Estado: implementado** (`src/core/CpuLineup.js`), en producción para
todo partido de cualquier división desde la sesión de CPU Lineup (ver
CHANGELOG).
