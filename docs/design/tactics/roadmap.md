# Táctica — orden de implementación, pendientes y fuentes

_Migrado de `DESIGN.md` (líneas 4012-4550 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

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
- ~~entrenamiento táctico detallado que modifique familiaridad~~ —
  **implementado por LIFE-2 (9.13)**: `Training.js` entrena
  `offensiveSystem`/`defensiveSystem`/`byPlayFamily`/`byCoverage`/
  `byPlayerRole` reutilizando `Tactics.growFamiliarityValue` tal cual,
  nunca una familiaridad paralela. Siguen SIN resolver, explícitamente:
  familiaridad específica de quinteto y decaimiento por largos periodos
  sin usar (ver más abajo, no marcados como cerrados por esta entrega);
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
  **Actualización (sesión de consolidación):** los umbrales de conversión
  puntuación→estrellas (`config.tactics.starRating.thresholds`, tabla en
  7.12.9) se recalibraron de un escalón único cada 4 puntos (agrupaba
  17-20 en el mismo 5★) a 5 tramos desiguales que sí distinguen "muy
  competente" (17, 4★) de "el máximo posible" (18-20, 5★) — reduce, junto
  con la regeneración de posiciones reales de esta misma sesión, la
  saturación de 5★ en `roleFit` detectada por auditoría. Siguen siendo
  puntos de partida, no cifras cerradas — misma calibración pendiente que
  el resto de 7.12.31.
- **TAC-3, nuevos pendientes**: catálogo de playbook con solo 9/14 familias
  (Flex, Princeton Elbow/entry, Post Split, High-Low, Pistol quedan fuera);
  Handoff/DHO, Off Screen y Motion/Flow tienen `PlayDefinition` de catálogo
  pero SIN motor propio (solo Pick & Roll/Isolation/Post Up lo tienen esta
  entrega); prioridad/peso editable POR JUGADA dentro de una misma familia
  (pantalla Playbook, solo lista/muestra, no edita todavía); eje
  Rigidez↔Read & React de 7.12.7 sigue sin efecto real (7.12.11 ya lo
  confirmaba: "no se fija todavía una fórmula exacta"). **Actualización
  TAC-6: conectado.** El eje ya existe como campo real
  (`identity.rigidity`) y modula el techo/exponente de
  `Tactics.computeTacticalExecution` (ver 7.12.22/7.12.7) — tercera vez que
  se mencionaba este eje (TAC-2, TAC-3) y primera en la que tiene efecto
  real, tras dos entregas aplazándolo deliberadamente. Presupuesto de 100
  "posesiones conceptuales" de `Tactics.selectPlayType`
  (`config.tactics.playTypeSelection.budget`) y punto neutro de
  `Tactics.resolveTransitionAttempt` (`config.tactics.transitionAttempt.
  weightNeutral`) son puntos de partida, no cifras cerradas; el límite de 2
  acciones por posesión de 7.12.11 se implementó con un coste de reloj fijo
  (`config.tactics.continuity`), no una simulación real de la segunda
  acción — pendiente de calibración masiva junto al resto de 7.12.31.
- **TAC-4, nuevos pendientes**: catálogo de esquema defensivo base con
  solo 3 zonas reales (`2-3`/`3-2`/`1-3-1`) además de Man-to-Man — Match-up
  Zone (híbrido zona/hombre) y Box-and-One (exige un jugador objetivo
  marcado) quedan fuera; el efecto de zona sobre `AdvantageState` conecta
  solo 1-2 contramedidas mínimas por play-type (Post Up vs 2-3, Pick &
  Roll/Isolation vs 1-3-1) — un sub-sistema de jugadas anti-zona completo
  (Overload, etc.) no está modelado. Doble equipo de poste (7.12.19): solo
  3 reglas de activación con comportamiento real (`never`/`starOnly`/
  `always`) — los matices de timing "al recibir"/"al primer bote" quedan
  fuera (este motor resuelve el poste en una sola pasada, sin sub-pasos de
  catch/dribble sobre los que distinguirlos). Matchups individuales
  (7.12.17): se declaran por ID de jugador real, no por nombre de rol
  ("la estrella rival"). **Actualización TAC-5:** `GamePlan` (7.12.23) ya
  existe como entidad propia — `matchupOverrides` sigue viviendo también
  en `TacticalProfile` (identidad persistente del equipo, "mi defensor X
  marca siempre al jugador Y" fuera de un partido concreto), pero un
  `GamePlan` de partido puede declarar un `matchupOverrides` DISTINTO solo
  para ese partido (ver 7.12.23/7.12.24 más abajo), fusionado sobre el
  perfil base sin mutarlo (`Tactics.effectiveTacticalProfile`). No hace
  falta elegir entre los dos sitios: son la identidad base y el ajuste de
  partido, respectivamente, mismo patrón que `pnrCoverage`/
  `playTypeWeights`/`defensiveScheme`.
  Press (7.12.15): sin el desgaste extra de Energía que describe el
  propio 7.12.15 — exigiría tocar `Rotation.js`/`Recovery.js`, fuera de
  alcance de esta entrega. Transición defensiva (7.12.20): aproximada por
  atletismo agregado del quinteto, sin distinguir por jugador quién cargó
  el rebote ofensivo vs quién se replegó. De las valoraciones derivadas de
  quinteto de 7.12.28, esta entrega completa Switchability/Rim Protection/
  Transition Defense; Transition Offense, POA Defense y Tactical Execution
  siguen sin implementar. **Actualización TAC-7: cerradas.** Con Data Hub
  (7.12.27) y `tacticalExecution` (7.12.22, TAC-6) ya construidos, TAC-7
  completa las 3 restantes: Transition Offense/POA Defense son valoraciones
  de APTITUD de plantilla (mismo criterio que el resto de 7.12.28, se
  recalculan al cambiar un jugador sin depender de partidos jugados) —
  POA Defense reutiliza literalmente `roles.defensiveMix.poaStopper`
  (7.12.21); Tactical Execution reutiliza literalmente
  `Tactics.computeTacticalExecution` (7.12.22) con complejidad 0 (foto en
  reposo del quinteto, sin ninguna jugada concreta elegida). Todos los
  valores numéricos nuevos de
  `config.tactics.defense`/`press`/`transitionDefense`/`postUp` son puntos
  de partida con dirección verificada, no cifras cerradas — pendientes de
  calibración masiva junto al resto de 7.12.31.
- **TAC-5, nuevos pendientes**: BLOB/SLOB (7.12.24) se infiere del ÚLTIMO
  evento de la posesión anterior (canasta de campo anotada = BLOB,
  cualquier otro final = SLOB) — aproximación deliberada, señalada
  explícitamente: un último tiro libre anotado también sería BLOB en la
  realidad y este motor no distingue ese matiz dentro de una secuencia de
  tiros libres (ver `MatchEngine.simulateOnePossessionStep`). El catálogo
  de jugadas situacionales (ATO/BLOB/SLOB/Late Clock/Last Possession) tiene
  solo 1-2 `PlayDefinition` por situación, no un sub-playbook completo —
  ampliar el catálogo de datos después es barato. Los umbrales de
  `resolveSituationType` (Last Possession: margen de 3 puntos + últimos 5s,
  reutilizando `pressure.buzzerBeaterSecondsThreshold`; Late Clock:
  reutiliza literalmente `lateClock.noFullPlayThresholdSeconds`) y la
  precedencia ATO > Last Possession > Late Clock > BLOB/SLOB cuando varias
  condiciones se cumplen a la vez son decisiones de encaje razonables, no
  cifras/criterio cerrados. `Auto Timeouts`/falta táctica intencionada
  llegan desactivados por defecto en TODO equipo, incluidos los
  gestionados por la CPU (7.12.34, regresión exacta con el comportamiento
  de antes de TAC-5) — que la CPU deba tenerlos activados por defecto para
  jugar de forma más realista es una decisión de calibración de IA
  (7.12.25/TAC-7) que esta entrega deja señalada, no resuelta. El motor
  pausable/GamePlan/ventanas de intervención reales solo se exponen para
  el partido de LIGA del usuario — Copa/Playoff/Ascenso siguen
  resolviéndose de golpe con reveal cosmético como antes de TAC-5 (ver
  7.12.24-bis para el porqué exacto y qué haría falta para extenderlo).
  Velocidades x4/x8/x16/x32 y cambios de táctica mid-posesión: el motor ya
  lo permite estructuralmente (`advanceMatch` admite cualquier punto de
  corte, `GamePlan` se puede mutar entre llamadas), pero el frontend de
  esta entrega no lo expone — ver 7.12.24-bis.
- **TAC-6, nuevos pendientes**: familiaridad de QUINTETO con estructuras
  específicas, entrenamiento táctico/pretemporada, y decaimiento por
  fichajes/periodos largos sin usar una familia — los tres explícitamente
  fuera de alcance (dos de ellos, opcional/dependiente de secciones sin
  diseñar todavía; el tercero, sin punto de enganche limpio con el ciclo de
  temporada actual). De los 10 errores reconocibles de 7.12.22, solo 3
  tienen mecanismo real (pérdida ofensiva de sistema, lectura incorrecta,
  ayuda defensiva tarde/error de switch/doble ayuda al mismo jugador,
  fusionados en un único hook de selección de defensor) — mal timing de
  pantalla/corte, spacing roto, pase tarde, dos jugadores en el mismo
  espacio y closeout equivocado quedan sin mecanismo propio, señalado
  explícitamente (ninguno tenía un punto de enganche real sin crear un
  resolver nuevo). La familiaridad se acumula posesión a posesión dentro de
  `advanceMatch` (nivel de granularidad elegido de los dos que permitía el
  prompt de esta entrega), nunca agregada al final del partido. Los pesos
  de `computeTacticalExecution` (familiaridad/atributos/energía/
  experiencia/complejidad), los valores de partida de familiaridad (55
  sistema/familia/cobertura, 35 primer rol, 15 cambio de rol) y las
  probabilidades máximas de cada error reconocible
  (`config.tactics.familiarity`/`tacticalExecution` en `MatchConfig.js`)
  son puntos de partida razonables con dirección verificada (ver CHANGELOG
  de TAC-6), no cifras cerradas — 7.12.22 admite explícitamente que "no se
  cierra todavía la curva matemática", así que esta calibración queda
  pendiente junto al resto de 7.12.31.
- **TAC-7, nuevos pendientes** (última entrega de la EPIC, 7.12.33): del
  catálogo completo de campos de 7.12.27, quedan fuera del registro por
  posesión, señalados explícitamente (sin dato real disponible sin
  inventarlo, o sin instrumentar más `MatchEngine.simulatePossession` de lo
  que esta entrega considera prudente sobre una función ya delicada):
  "número de pases relevantes" (el motor no simula pases individuales
  fuera del propio P&R/Post Up); "reloj de posesión al finalizar" (variable
  interna de `simulatePossession` que nunca se devuelve); `shotDefenderId`
  de una posesión NO táctica sin tapón (la rama 1v1 de siempre no devuelve
  su defensor de tiro elegido). `shotQuality` no tiene todavía el valor
  numérico cerrado que pide 7.12.5 (7.12.34 ya lo confirmaba pendiente) —
  se aproxima con `advantageScore` reescalado a 0-1 SOLO en posesiones con
  play-type táctico real, señalado explícitamente como proxy, no como el
  cálculo final. De las ~25 métricas listadas en 7.12.27, esta entrega
  implementa un subconjunto representativo por categoría (Ataque: PPP/
  frecuencia por play-type, shot profile, FG% asistido, pérdidas, calidad
  de tiro media, efectividad por jugada del playbook; Defensa: PPP
  concedido por cobertura, shot profile permitido, eficiencia de mismatch
  aproximada por Switch; Lineups: ORtg/DRtg/Net aproximado, spacing
  efectivo medio) — quedan para una ampliación futura del Data Hub:
  efficiency tras DHO/Off Screen/Post/Isolation por separado, Transition
  Frequency/PPP detallado, FT rate por play-type, ATO PPP, rebote ofensivo
  vs. puntos concedidos en transición, puntos concedidos tras superar
  primera línea, eficiencia de zona/man por separado, rebote defensivo por
  shell. La arquitectura de telemetría (un registro por posesión +
  agregado persistente por equipo en `TacticalProfile.tacticsTelemetry`)
  no bloquea añadir ninguna de ellas después. El gancho de visibilidad
  limitada por Scouting (7.12.27) queda estructural únicamente: el informe
  de rival siempre se muestra completo en esta entrega — separar "dato
  calculado" (`Tactics.summarizeTacticsTelemetry`) de "dato mostrado"
  (`game.js`, capa de presentación) es la separación que permitiría
  ocultar/difuminar partes sin rediseñar el shape, pero ningún sistema de
  visibilidad real se implementa todavía (6.2.2 punto 5, Scouting, sigue
  sin diseñar). Construcción de identidad CPU: umbrales
  (`config.tactics.cpuIdentity.specialistThreshold`/`weakThreshold`) y
  sesgo de `clubDNA` por equipo/eje son puntos de partida con dirección
  verificada por arquetipo (ver CHANGELOG de esta entrega), no cifras
  cerradas — misma calibración masiva pendiente que el resto de 7.12.31;
  rebote y Energía/edad de rotación se evalúan como señal de auditoría de
  plantilla pero no mueven ninguna decisión de esta heurística todavía (no
  hay un eje de `TacticalProfile` con comportamiento real al que
  conectarlos sin inventar uno). Plan de partido CPU/Ajustes en vivo CPU:
  ver nota de visión futura al final de 7.12.25.

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
- Magnitud de `pureSkillPenaltyFraction` y del exponente de la curva no
  lineal de penalización posicional (`config.positions.
  competencePenaltyExponent`) — puntos de partida sin calibrar por
  simulación masiva todavía (mini-EPIC POS).
- ~~Pipeline de reconstrucción rigurosa de posiciones reales con fuentes
  externas~~ — descartado por decisión de producto (mini-EPIC POS): no
  es un objetivo del proyecto. Las posiciones secundarias de jugadores
  reales se derivan por similitud de atributos (ver sección 6), sin
  necesitar fuentes externas.
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

### 7.12.36 Ayuda táctica contextual

Entrega TOOLTIP-1: capa de ayuda contextual reutilizable para todo concepto
táctico visible en la pantalla de Tácticas que no es autoexplicativo para
alguien sin conocimiento previo de baloncesto profesional. Aplica
literalmente la filosofía ya fijada en 7.12.35: *"la UI puede ofrecer
presets, explicaciones y recomendaciones; el motor, sin embargo, conserva
la estructura profunda"* — esta entrega es únicamente esa capa de
explicaciones, no toca ninguna fórmula ni catálogo del motor.

**Decisión de arquitectura**: opción (B) — archivo nuevo `src/ui/
TacticsHelp.js`, capa de presentación PURA sobre los catálogos de
`Tactics.js`/`MatchConfig.js` (mismo patrón que `game.js` ya es presentación
pura sobre `Tactics.js`). Se descarta la opción (A) (meter la metadata de
ayuda junto a cada catálogo dentro de `Tactics.js`) porque `Tactics.js` es
el archivo más grande y crítico del proyecto (motor de posesión); mezclar
texto de presentación ahí aumenta el riesgo de que una sesión futura que
"solo edite el texto" toque algo del motor por accidente. `TacticsHelp.js`
NO modifica `Tactics.js`/`MatchConfig.js` en absoluto.

**Etiquetas cortas de UI (`SPACING_LABELS`, `PNR_COVERAGE_LABELS`, etc. en
`game.js`) NO se fusionan con esta fuente**: se auditó su uso real antes de
decidir — son etiquetas de una o dos palabras usadas en `<select>`/tablas
compactas por todas las sub-pestañas, mientras que el contenido de ayuda es
largo (varios campos de texto por concepto). Fusionarlas forzaría a
`game.js` a cargar/leer mucho texto que no necesita solo para renderizar un
desplegable, y `TacticsHelp.js` carga DESPUÉS de `Tactics.js` pero ANTES de
`game.js` en `index.html`, así que tampoco podría leer las labels de
`game.js` aunque quisiera (orden de carga inverso). Cada entrada de
`TacticsHelp.js` lleva su propio campo `label`, duplicado deliberadamente
(mismo valor de texto que la label corta correspondiente donde coincide),
señalado aquí explícitamente como desviación consciente, no como
inconsistencia.

**Única fuente de verdad**: `src/ui/TacticsHelp.js` exporta
`BasketManager.TacticsHelp` con `ENTRIES` (mapa por id), `CATEGORY_LABELS`,
`CATEGORY_ORDER` y los helpers `getHelp(id)`/`listEntries()`/
`listByCategory()`. Ni la pantalla de Tácticas ni el Glosario (ver abajo)
tienen una segunda copia del contenido — ambos leen de `ENTRIES`.

**Shape de cada entrada** (algunos campos opcionales, omitidos —nunca
rellenos genéricos— cuando el motor real no sostiene esa afirmación):

```js
{
  id,              // MISMO id interno que Tactics.js/MatchConfig.js — nunca traducido/renombrado
  category,        // agrupación del Glosario
  label,           // nombre corto en español
  what,            // qué es, en lenguaje llano
  goal,            // qué intenta conseguir
  engineEffect,    // qué provoca REALMENTE en el motor — derivado del código real
  whenUseful,      // opcional
  risks,           // qué puede conceder/comprometer
  suitablePlayers, // opcional
}
```

**Cobertura** (97 entradas, `CATEGORY_ORDER`): ejes de identidad ofensiva
(5: Ritmo/Early offense/Movimiento de balón/Uso de P&R/Rigidez — señalando
explícitamente que Ritmo/Early offense/Movimiento de balón NO tienen
todavía ningún consumidor real en el motor, solo se guardan en el perfil),
spacing (4), play-types/familias (7, incluyendo Handoff/Off Screen/Motion
Flow marcados como "sin motor propio todavía"), coberturas de P&R (5, con
Hedge/Blitz señalados como valores idénticos en CONFIG), roles ofensivos
(15) y defensivos (10), Playbook (15 `PlayDefinition`, incluidas las 6
variantes situacionales de ATO/BLOB/SLOB/Late Clock/Last Possession),
esquemas defensivos (4), press (2), reglas de doble equipo de poste (3),
tipos de situación especial (5), reglas de situación (Auto Timeouts/Falta
táctica, 2), valoraciones de quinteto (12, incluidas las 3 que faltaban en
`LINEUP_RATING_LABELS` de `game.js` — ver más abajo) y conceptos del
informe de rival/Data Hub (PPP, ORtg, DRtg, Net Rating, muestra pequeña —
5). Se añaden además 3 conceptos generales sin id de catálogo propio pero
con nombre de campo real en el motor: `familiarity` (Familiaridad Táctica),
`roleFitStars` (conversión puntuación→estrellas) y `matchupOverride`
(matchups individuales).

**Explícitamente fuera de cobertura**: la pestaña Rival es, en su mayoría,
un informe de solo lectura cuyos párrafos `gm-muted` ya explican el
contexto inmediato (frecuencia/PPP, shot profile) — se decidió NO poner un
icono en cada celda numérica de esas tablas, solo en los conceptos
realmente no autoexplicativos (PPP, ORtg/DRtg/Net, muestra pequeña) para no
saturar la pantalla de iconos redundantes con el texto que ya la acompaña.
`GamePlan`/matchups de PARTIDO (ventana de intervención en vivo, TAC-5) no
se tocan en esta entrega — sus controles no viven en la pantalla de
Tácticas.

**Corrección incidental descubierta en la auditoría** (no es una decisión
de diseño, es una etiqueta de presentación que faltaba): `LINEUP_RATING_LABELS`
en `game.js` solo tenía 9 de las 12 claves que devuelve
`Tactics.computeLineupRatings` desde TAC-7 (`transitionOffense`/
`poaDefense`/`tacticalExecution` quedaban sin label, mostrando el texto
literal "undefined" en la tabla de Resumen) — corregido añadiendo las 3
etiquetas que faltaban, imprescindible además para que esas 3 filas
pudieran tener un icono de ayuda coherente con su contenido.

**UX del tooltip**: icono "ⓘ" (`<button>` real, nunca un `<span>` solo con
`:hover` — funciona con click de ratón y con tap táctil de forma nativa, un
tap ya dispara un evento `click` en cualquier navegador moderno sin
necesitar un listener `touchstart` aparte). Estado de "qué tooltip está
abierto" en `container.dataset.openHelpId` (atributo del DOM del propio
`#gm-tactics`, mismo patrón ya usado por `dataset.activeTab`) — vive fuera
de `state` porque no es un dato de partida guardable. Como
`renderTacticsScreen()` hace `container.innerHTML = ...` completo en cada
cambio, este dataset es lo único que sobrevive intacto a ese re-render (vive
en el nodo contenedor, nunca sustituido por `innerHTML`): abrir/cerrar un
tooltip nunca pierde el valor de un slider/select que el usuario acabara de
cambiar (ya vive en `team.tacticalProfile`, mutado en su propio evento
`change`) y cambiar de sub-pestaña resetea `openHelpId` explícitamente, para
no dejar un tooltip fantasma de una pestaña anterior.

**Glosario**: 8ª sub-pestaña de `TACTICS_TABS` (`renderTacticsGlossaryTab`),
no un botón/acceso aparte — reutiliza el mismo mecanismo de navegación por
pestañas que ya usan las otras siete (7.12.32 ya las describe como
"sub-pestañas dentro de esa única pantalla"). Lista TODAS las entradas de
`BM.TacticsHelp.listByCategory()` ya expandidas (sin necesitar abrir cada
icono una a una), agrupadas por categoría, reutilizando literalmente
`tacticsHelpBodyHtml()` (la misma función que renderiza el contenido de un
tooltip individual) — cero segunda copia del texto.

**Localización**: todos los `id` de `ENTRIES` son exactamente los mismos
que usan `Tactics.js`/`MatchConfig.js` — ninguno se renombró ni se tradujo.
No se implementa un selector de idioma; la estructura (`id` en inglés →
texto en español dentro de la entrada) deja preparado que un segundo idioma
sea añadir un segundo bloque de textos por id, sin tocar el motor.

**Partidas guardadas**: no se añadió ningún campo nuevo a
`TacticalProfile`/`Team` — la ayuda es puramente de presentación
(`BM.TacticsHelp` no depende de qué táctica tenga declarada el usuario) y
`openHelpId` vive en el DOM, nunca en el objeto de partida. El formato de
`saves/` no cambia.

**Confirmación de alcance**: ningún id interno se renombró; `src/core/
Tactics.js` y `src/core/MatchConfig.js` no se tocaron en absoluto en esta
entrega (verificado con `git diff --stat` en el script de scratchpad de
esta sesión) — la única excepción a "solo archivos de UI" es la corrección
incidental de 3 etiquetas que faltaban en `LINEUP_RATING_LABELS`
(`game.js`), señalada arriba.
