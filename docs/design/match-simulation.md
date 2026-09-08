# Motor de simulación de partidos — núcleo

_Migrado de `DESIGN.md` (líneas 1465-1945 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

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

### 7.4 Modificador de Envergadura (revisión mini-EPIC POS)

Sistema aparte, no uno de los 2-5 atributos de la mezcla — se aplica
DESPUÉS de calcular la fórmula base de atributos de cada acción. Se
apoya en los Datos Físicos Corporales de 6.1 (Altura, Envergadura, Peso).

**Un único eje — Envergadura relativa** (envergadura − altura del
propio jugador):
- **Beneficia**: Tiro interior, Bandeja/finalización, Rebote (ofensivo y
  defensivo), Tapón (con un multiplicador mayor), Robo defensivo.
- **Perjudica levemente**: precisión de Tiro exterior (triple) — ver
  nota de evidencia más abajo sobre por qué este efecto se modela solo
  en generación, nunca en partido.
- En acciones donde **ambos jugadores enfrentados** tienen envergadura
  relevante (ej. Tiro interior, Rebote), el eje se aplica a AMBOS por
  separado — el efecto neto es la diferencia entre ambos modificadores,
  ya construyendo una comparación relativa sin necesitar una función de
  comparación explícita aparte.

**Se retira el antiguo "Eje 2" (Altura/Peso vs Agilidad)**: tras
investigación específica de esta sesión de diseño (evidencia real
disponible sobre altura/peso y agilidad/cambio de dirección: moderada y
contradictoria entre estudios —correlaciones entre 0.35 y 0.53 según el
estudio, sin umbral universal publicado—, con fuerza y potencia como
predictores más consistentes que la altura aislada), se elimina el
descuento fijo por superar un umbral absoluto de altura. Los atributos
físicos explícitos del jugador (`agility`, `topSpeed`, `acceleration`,
`strength`, `balance`) ya describen su movilidad real, y el generador de
jugadores ya sesga estos atributos de forma razonable según el cuerpo
generado — un segundo descuento genérico no añade información, solo
penaliza artificialmente por segunda vez la misma limitación (o su
ausencia, en el caso de un jugador alto generado deliberadamente ágil,
el antiguo "caso Wembanyama" que el Eje 2 quería proteger y que deja de
necesitar protección especial porque deja de existir el impuesto del
que protegerse).

**Envergadura y tiro exterior — modelo adoptado (Modelo B, generación)**:
tras investigación específica (única fuente cuantitativa publicada
encontrada, preprint no revisado por pares, con coeficiente de
determinación bajo —aproximadamente 0.18— y que mide tiro libre en vez
de tiro exterior, sin control explícito de posición), la evidencia es
direccionalmente real pero débil. La envergadura relativa NO modifica
el tiro durante un partido; en generación de jugadores ficticios (y
cantera futura) sesga levemente y de forma NO determinista la
distribución de partida de `outsideShot` (a la baja) y de
`interiorDefense`/`blocking`/rebote (al alza) — un jugador de brazos
largos puede seguir generándose con `outsideShot=20`.

**Peso**: se genera y guarda, pero no interviene todavía en ninguna
fórmula del motor. Queda como hook explícito para el futuro (ej. juego
de contacto/poste) — no se inventa un coeficiente sin evidencia
adicional en esta sesión.

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
