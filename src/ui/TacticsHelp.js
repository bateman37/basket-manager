// src/ui/TacticsHelp.js
// TOOLTIP-1 (DESIGN.md 7.12.36): fuente ÚNICA de contenido de ayuda contextual
// para la pantalla de Tácticas. Capa de presentación PURA sobre los catálogos
// reales de src/core/Tactics.js y src/core/MatchConfig.js — igual que
// src/ui/game.js es presentación pura sobre Tactics.js, este archivo NUNCA
// decide reglas de juego, solo describe en español lo que el motor real ya
// hace. No modifica Tactics.js/MatchConfig.js en absoluto (DESIGN.md 7.12.36,
// decisión de arquitectura B).
//
// Convención del proyecto: identificadores en inglés, comentarios en español.
// Los `id` de cada entrada son EXACTAMENTE los mismos ids internos que usan
// Tactics.js/MatchConfig.js (catálogo de roles, coberturas, jugadas, etc.) —
// nunca se traducen ni se renombran, para que añadir un idioma en el futuro
// sea solo añadir un segundo bloque de textos por id (DESIGN.md 7.12.36,
// sección de localización).
//
// Regla crítica (prompt de esta entrega, sección 3): NUNCA describir aquí un
// efecto que el código real no produzca. Cada `engineEffect` está derivado de
// código real de Tactics.js/MatchConfig.js — no de baloncesto real "tal como
// debería funcionar". Cuando un concepto existe en el catálogo pero SIN motor
// propio todavía (Handoff/DHO, Off Screen, Motion/Flow; los ejes de identidad
// Ritmo/Early offense/Movimiento de balón), `engineEffect` lo dice
// explícitamente en vez de inventar un efecto.

(function (global) {
  const CATEGORY_LABELS = {
    identity: 'Ejes de identidad ofensiva',
    spacing: 'Spacing',
    playType: 'Play-types y familias de jugada',
    coverage: 'Coberturas de Pick & Roll',
    roleOffensive: 'Roles ofensivos',
    roleDefensive: 'Roles defensivos',
    playbook: 'Playbook',
    defenseScheme: 'Esquemas defensivos',
    press: 'Presión (Press)',
    postDoubleTeam: 'Doble equipo de poste',
    situationType: 'Situaciones especiales',
    situationConcept: 'Reglas de situación',
    lineupRating: 'Valoraciones de quinteto',
    dataHub: 'Datos e informes (Data Hub)',
    concept: 'Conceptos generales',
  };

  const CATEGORY_ORDER = [
    'identity', 'spacing', 'playType', 'coverage', 'roleOffensive', 'roleDefensive',
    'playbook', 'defenseScheme', 'press', 'postDoubleTeam', 'situationType',
    'situationConcept', 'lineupRating', 'dataHub', 'concept',
  ];

  // Shape de cada entrada (DESIGN.md 7.12.36 / prompt sección 2):
  // { id, category, label, what, goal, engineEffect, whenUseful?, risks,
  //   suitablePlayers? }
  // `whenUseful`/`suitablePlayers` se omiten (nunca string vacío) cuando no
  // hay una afirmación real sostenible por el motor.
  const ENTRIES = {};
  function add(entry) { ENTRIES[entry.id] = entry; }

  // === Ejes de identidad ofensiva (DESIGN.md 7.12.7) =====================
  add({
    id: 'pace',
    category: 'identity',
    label: 'Ritmo',
    what: 'Cuán rápido quiere jugar el equipo en general: de un ritmo muy pausado a uno muy rápido.',
    goal: 'Reflejar la velocidad de juego preferida del entrenador, igual que un equipo real elige correr o pausar el partido.',
    engineEffect: 'Se guarda en el perfil táctico del equipo (TacticalProfile.identity.pace) y la CPU lo usa como punto de partida al construir automáticamente la identidad de un equipo generado (Tactics.buildCpuTacticalIdentity), pero el motor de partido todavía NO lo consulta al simular una posesión — no cambia ninguna probabilidad ni el ritmo real de juego todavía. DESIGN.md 7.12.34 lo señala como pendiente.',
    risks: 'Ninguno todavía: al no tener efecto real en el motor, moverlo no penaliza ni beneficia nada en el partido simulado.',
  });
  add({
    id: 'earlyOffense',
    category: 'identity',
    label: 'Early offense',
    what: 'Cuánto prioriza el equipo atacar antes de que la defensa termine de colocarse, frente a organizar siempre el ataque en media pista.',
    goal: 'Distinguir un equipo que busca el primer contraataque/ventaja temprana de uno que prefiere montar el sistema con calma.',
    engineEffect: 'Se guarda en el perfil táctico (identity.earlyOffense), pero, igual que Ritmo, el motor de partido no lo consulta todavía en ningún cálculo — no influye en la ventana de transición (que ya existe de forma independiente) ni en ninguna otra probabilidad. Pendiente (DESIGN.md 7.12.34).',
    risks: 'Ninguno todavía: sin efecto real.',
  });
  add({
    id: 'ballMovement',
    category: 'identity',
    label: 'Movimiento de balón',
    what: 'Cuánto circula el balón el equipo antes de tirar: de un ataque directo a uno con mucha circulación y pase extra.',
    goal: 'Reflejar la filosofía de compartir el balón frente a resolver rápido con el primer generador de ventaja.',
    engineEffect: 'Se guarda en el perfil táctico (identity.ballMovement), pero el motor todavía no lo consulta — el pase extra/kick-out que sí existe en el motor (continuidad de una posesión) se decide por el AdvantageState de cada jugada, no por este eje. Pendiente (DESIGN.md 7.12.34).',
    risks: 'Ninguno todavía: sin efecto real.',
  });
  add({
    id: 'pickAndRollUsage',
    category: 'identity',
    label: 'Uso de Pick & Roll',
    what: 'Cuánto quiere el equipo recurrir al Pick & Roll como jugada base, de bajo a muy alto.',
    goal: 'Ajustar con qué frecuencia el equipo monta un bloqueo directo en vez de dejar que el ataque resuelva de otras formas.',
    engineEffect: 'Es el único eje de identidad ofensiva con efecto real desde el principio: modula directamente la frecuencia de sorteo del Pick & Roll (Tactics.resolvePnrFrequency), multiplicando la probabilidad base de CONFIG (30% con el valor neutro de 50) hasta el doble o hasta anularla. Con el valor por defecto (50) el equipo se comporta exactamente igual que sin este eje.',
    whenUseful: 'Subirlo con un buen manejador especializado y un interior con buen Roll/Pop aumenta cuántas posesiones reales pasan por esa jugada; bajarlo deja más posesiones para Isolation/Post Up/Transition según sus propios pesos.',
    risks: 'Subirlo sin jugadores realmente aptos para el bloqueo directo no mejora el resultado — solo cambia la frecuencia con la que se intenta la jugada, no su eficacia.',
  });
  add({
    id: 'rigidity',
    category: 'identity',
    label: 'Rigidez ↔ Read & React',
    what: 'Cuánto se apoya el equipo en un sistema estructurado y muy ensayado (Rigidez) frente a jugar con libertad e improvisación colectiva (Read & React).',
    goal: 'Elegir entre un ataque muy predecible pero muy afinado con el tiempo, o uno más flexible que se adapta mejor sin apenas rodaje.',
    engineEffect: 'Modula el techo y la forma de la curva de ejecución táctica (Tactics.computeTacticalExecution): Rigidez alta (100) alcanza un techo de ejecución más alto cuando la Familiaridad Táctica es alta, pero cae con más dureza cuando la Familiaridad es baja; Read & React (0) tiene un techo algo más bajo pero se resiente menos con Familiaridad baja. Una ejecución táctica baja aumenta la probabilidad de perder el balón por fallo de sistema, de que la lectura de la jugada se degrade un escalón, y de errores de ayuda/switch en defensa.',
    whenUseful: 'Un equipo con plantilla estable y muchos partidos jugados con el mismo sistema puede permitirse más Rigidez (techo más alto); una plantilla joven, recién fichada o con muchos cambios de rol rinde más segura con más Read & React mientras gana Familiaridad.',
    risks: 'Rigidez alta con Familiaridad baja (fichajes recientes, táctica nueva) castiga más que Read & React en las mismas circunstancias — es una apuesta a largo plazo, no una mejora inmediata.',
    suitablePlayers: 'Read & React se apoya más en Visión de Juego, Decisión bajo presión, Posicionamiento, Trabajo en equipo y Concentración de los jugadores en pista; un quinteto flojo en esos atributos rinde relativamente mejor con más Rigidez.',
  });

  // === Spacing (DESIGN.md 7.12.6) =========================================
  add({
    id: '5-out',
    category: 'spacing',
    label: '5-Out',
    what: 'Los cinco jugadores en pista se colocan abiertos, maximizando la separación de la pintura — ninguno ocupa una posición fija de poste.',
    goal: 'Dar el máximo espacio posible para penetrar y forzar decisiones de ayuda largas a la defensa.',
    engineEffect: 'Techo estructural más alto que el resto de spacings pero exige que los CINCO jugadores en pista sean una amenaza real de tiro exterior para alcanzar ese techo — Tactics.effectiveSpacing cruza el spacing declarado con la amenaza de tiro real (Tiro exterior/Tiro media distancia) de los cinco jugadores realmente en pista. El resultado entra como un pequeño término acotado en el AdvantageState de Pick & Roll/Isolation/Post Up, y también en el efecto de las zonas defensivas (una zona sufre más contra spacing efectivo alto).',
    whenUseful: 'Con un quinteto donde los cinco jugadores tiran de verdad (incluidos los interiores), es el spacing con mayor ventaja ofensiva potencial.',
    risks: 'Con un pívot sin Tiro exterior real colocado en 5-Out, la defensa puede ignorarlo — el spacing EFECTIVO cae por debajo del declarado, así que elegir 5-Out no lo garantiza por sí solo.',
    suitablePlayers: 'Requiere amenaza de tiro exterior real (Tiro exterior/Tiro media distancia) en los cinco puestos, incluidos los interiores (Pick & Pop Big antes que Roll Man puro).',
  });
  add({
    id: '4-out-1-in',
    category: 'spacing',
    label: '4-Out 1-In',
    what: 'Cuatro jugadores abiertos y un interior con presencia real de zona/poste/dunker spot.',
    goal: 'Punto intermedio entre espacio exterior y presencia interior — spacing por defecto del juego.',
    engineEffect: 'Techo estructural intermedio y exige amenaza de tiro real en 4 de los 5 jugadores para acercarse a ese techo. Es compatible con más jugadas del Playbook que ningún otro spacing (Basic High P&R, Horns, Spain P&R, Double Drag, DHO/Zoom, Floppy, Post Entry, y varias jugadas de ATO/SLOB/Last Possession).',
    whenUseful: 'Es la opción más versátil si la plantilla no tiene un perfil extremo (ni cinco tiradores reales, ni varios interiores tradicionales).',
    risks: 'Ninguno específico — es el punto de partida neutro del sistema.',
  });
  add({
    id: '3-out-2-in',
    category: 'spacing',
    label: '3-Out 2-In',
    what: 'Dos interiores con presencia real en la pintura y solo tres jugadores abiertos — menos amplitud, más presencia bajo el aro.',
    goal: 'Priorizar rebote y juego de poste sobre espacio de penetración.',
    engineEffect: 'Techo estructural más bajo que los otros dos y exige menos amenaza real de tiro para llegar a su propio techo — por diseño, incluso con jugadores idénticos, 3-Out 2-In nunca alcanza el effectiveSpacing máximo que sí puede alcanzar 5-Out (invariante verificado por script de pruebas). A cambio, es el spacing compatible con Post Entry y con tener dos jugadores de poste a la vez.',
    whenUseful: 'Con dos interiores fuertes (Post Scorer/Post Hub, Primary Screener, Offensive Rebounder) y pocos tiradores reales en el perímetro, es el spacing con menos coste de effectiveSpacing.',
    risks: 'Reduce el espacio disponible para penetrar y para el Pick & Roll exterior — menos jugadas del Playbook lo declaran compatible.',
  });
  add({
    id: 'dynamic',
    category: 'spacing',
    label: 'Dynamic',
    what: 'El spacing cambia según el quinteto, la jugada y el rol de cada jugador en vez de fijarse en una sola estructura.',
    goal: 'Dejar que la ocupación de espacio se adapte automáticamente al quinteto real en pista en cada momento.',
    engineEffect: 'No tiene techo estructural propio: Tactics.effectiveSpacing usa el MEJOR ajuste real entre 5-Out/4-Out-1-In/3-Out-2-In para ese quinteto concreto. Es compatible con la mayoría de jugadas del Playbook.',
    whenUseful: 'Es una opción segura cuando la plantilla no encaja claramente en un solo arquetipo de spacing, o cuando cambia mucho de un partido a otro por rotaciones/lesiones.',
    risks: 'Ninguno adicional — es matemáticamente el mejor o igual resultado que fijar una estructura para ese quinteto concreto, nunca peor.',
  });

  // === Play-types y familias de jugada (DESIGN.md 7.12.8) ================
  add({
    id: 'pickAndRoll',
    category: 'playType',
    label: 'Pick & Roll',
    what: 'Bloqueo directo: un jugador (el bloqueador) se coloca junto al defensor del manejador para liberarlo, abriendo un hueco o forzando una decisión defensiva.',
    goal: 'Generar ventaja combinando a dos atacantes contra dos defensores, obligando a la defensa a elegir entre conceder el tiro del manejador o ayudar y abrir otra opción.',
    engineEffect: 'Es el play-type con más desarrollo del motor: Tactics.planPickAndRollTactical elige handler/screener reales, calcula un AdvantageState de 6 categorías cruzando la cobertura defensiva (Drop/Under/Switch/Hedge/Blitz) con los atributos de los cuatro jugadores implicados, y de ahí deriva qué jugada del Playbook se etiqueta, quién tira, con qué contestación y si hay asistencia real. Su frecuencia depende del eje Uso de Pick & Roll y del peso de play-type sobre un presupuesto conceptual de 100 posesiones.',
    whenUseful: 'Con un buen manejador (rol PnR Handler) y un interior capaz de Roll/Pop, es la vía más fiable de generar ventaja real contra cualquier cobertura.',
    risks: 'Un manejador con mala Visión de Juego/Pase no aprovecha bien las coberturas agresivas (Hedge/Blitz), que castigan precisamente esa lectura.',
  });
  add({
    id: 'isolation',
    category: 'playType',
    label: 'Isolation',
    what: 'Un jugador ataca 1 contra 1 en un espacio despejado, sin bloqueo.',
    goal: 'Aprovechar una ventaja individual de talento puro contra un defensor concreto.',
    engineEffect: 'Tactics.buildIsolationPlan elige al anotador (rol Isolation Scorer si existe, si no el de mayor uso) contra su defensor directo y calcula un AdvantageState propio. Si la ayuda defensiva llega tarde y colapsa, la jugada puede derivar en un pase a un tirador del lado débil con asistencia real; si no, el propio anotador crea y remata su tiro sin asistencia.',
    suitablePlayers: 'Manejo de balón, Tiro media distancia/interior, Bandeja y Agresividad del anotador frente a Defensa perimetral/Agilidad/Anticipación del defensor.',
    risks: 'Sin una ventaja física/técnica clara del anotador, reparte peor el balón que otros play-types (menos generación de asistencias reales salvo colapso defensivo).',
  });
  add({
    id: 'postUp',
    category: 'playType',
    label: 'Post Up',
    what: 'Un jugador recibe de espaldas al aro cerca de la pintura y busca anotar o generar una jugada desde ahí.',
    goal: 'Explotar ventajas de tamaño/fuerza cerca del aro en vez de en el perímetro.',
    engineEffect: 'Tactics.buildPostUpPlan elige al anotador (rol Post Scorer/Post Hub si existe) contra un defensor interior y calcula su propio AdvantageState. Según la regla de doble equipo del esquema defensivo, puede recibir ayuda de un segundo defensor — si llega, la probabilidad de que el propio anotador encuentre el hueco (kick-out) depende de su Visión de Juego y Pase, no es automática.',
    whenUseful: 'Con un interior fuerte y buen pasador bajo el aro (Post Hub) es la vía para castigar un doble equipo con extra-pass en vez de perder el balón.',
    risks: 'Un anotador posteado con mala Visión de Juego/Pase, doblado por dos defensores, sufre una penalización de calidad de tiro por tiro forzado si no encuentra el hueco.',
  });
  add({
    id: 'transition',
    category: 'playType',
    label: 'Transition',
    what: 'Jugar en contraataque, antes de que la defensa termine de colocarse en media pista.',
    goal: 'Anotar rápido aprovechando la ventana en la que la defensa todavía no está organizada.',
    engineEffect: 'La ventana de contraataque en sí es independiente de este peso; lo que controla el peso de Transition es la PROBABILIDAD de que el equipo decida intentar explotarla cuando aparece (Tactics.resolveTransitionAttempt) — con el valor neutro (15, el mismo que el peso por defecto) el equipo corre siempre que la ventana existe; un peso menor hace que el equipo decida montar media pista en su lugar.',
    risks: 'No puede subirse por encima de "correr siempre" — con la ventana ya limitada por el motor, no hay margen para ser más agresivo que el neutro subiendo el peso por encima de él.',
  });
  add({
    id: 'handoff',
    category: 'playType',
    label: 'Handoff / DHO',
    what: 'Handoff/DHO (Dribble Hand-Off): un jugador entrega el balón en mano a un compañero que pasa cerca, en vez de hacer un pase normal o un bloqueo directo.',
    goal: 'Generar una pequeña ventaja de entrada de bote para el receptor, con opción de tiro inmediato o penetración.',
    engineEffect: 'Existe como catálogo de jugadas en el Playbook (DHO / Zoom) pero todavía SIN motor de resolución propio — no se elige activamente en una posesión real; son datos preparados para una entrega futura del sistema táctico.',
    risks: 'Ninguno todavía: al no tener motor propio, no afecta al resultado del partido.',
  });
  add({
    id: 'offScreen',
    category: 'playType',
    label: 'Off Screen',
    what: 'Bloqueos indirectos lejos del balón: un jugador se libera de su defensor gracias a un bloqueo de un compañero, para recibir y tirar o atacar.',
    goal: 'Crear tiro para un especialista exterior mediante movimiento sin balón, en vez de un bloqueo directo sobre el balón.',
    engineEffect: 'Existe como catálogo de jugadas en el Playbook (Floppy) pero todavía SIN motor de resolución propio, mismo caso que Handoff/DHO.',
    risks: 'Ninguno todavía: sin motor propio.',
  });
  add({
    id: 'motionFlow',
    category: 'playType',
    label: 'Motion / Flow',
    what: 'Ataque de movimiento continuo (motion offense): el quinteto se reorganiza constantemente mediante cortes y pases en vez de seguir un guion fijo de jugada.',
    goal: 'Generar oportunidades a partir de la lectura colectiva y el movimiento, no de una jugada concreta con un final prefijado.',
    engineEffect: 'Existe como catálogo (5-Out Motion) pero todavía SIN motor de resolución propio, mismo caso que Handoff/DHO y Off Screen.',
    risks: 'Ninguno todavía: sin motor propio.',
  });

  // === Coberturas de Pick & Roll (DESIGN.md 7.12.16) =====================
  add({
    id: 'drop',
    category: 'coverage',
    label: 'Drop',
    what: 'El defensor del bloqueador se repliega hacia el aro para proteger la zona, mientras el defensor del balón persigue por encima del bloqueo.',
    goal: 'Proteger el aro por encima de todo, aceptando conceder tiro exterior/medio al manejador.',
    engineEffect: 'Punto de partida más neutro de AdvantageState de las 5 coberturas (el menos negativo para el ataque), pero mide al manejador con una mezcla orientada a Tiro medio/Tiro exterior/Visión de Juego — un manejador con buen tiro exterior/medio explota esta cobertura precisamente porque el hueco que deja Drop es ese tiro, no una jugada distinta.',
    whenUseful: 'Es la cobertura de referencia por defecto cuando un equipo rival no tiene perfil táctico propio.',
    risks: 'Castigable por un manejador con buen pull-up de media distancia o triple, ya que el interior no sale a presionarle.',
    suitablePlayers: 'El defensor interior en Drop necesita sobre todo Defensa interior/Fuerza/Tapón, no movilidad perimetral.',
  });
  add({
    id: 'under',
    category: 'coverage',
    label: 'Under',
    what: 'El defensor del balón pasa POR DEBAJO del bloqueo en vez de perseguir por encima, cediendo voluntariamente algo de distancia exterior.',
    goal: 'Negar la penetración/el bloqueo directo a cambio de conceder tiro exterior a un manejador sin amenaza real de tiro.',
    engineEffect: 'Base de AdvantageState ligeramente positiva para la defensa (la única de las cinco coberturas con signo positivo) pero mide al manejador ponderando MÁS el Tiro exterior que ninguna otra cobertura — el propio dato de CONFIG define su vulnerabilidad exacta: un buen tirador la castiga más que a cualquier otra cobertura.',
    whenUseful: 'Muy eficaz contra un manejador sin amenaza real de tiro exterior, ya que el espacio que cede no le sirve de nada.',
    risks: 'La cobertura más explotable por un gran tirador exterior — el propio diseño se lo concede a propósito.',
  });
  add({
    id: 'switch',
    category: 'coverage',
    label: 'Switch',
    what: 'Los dos defensores implicados en el bloqueo intercambian sus asignaciones: el defensor del bloqueador pasa a defender al manejador y viceversa.',
    goal: 'Eliminar la ventaja inmediata del bloqueo sin necesitar ayuda de un tercer defensor.',
    engineEffect: 'Tras un Switch, el motor intercambia realmente los ROLES de evaluación de los dos defensores: quien queda emparejado con el manejador se mide con la mezcla de defensor de bloqueo (perímetro) y quien queda con el rolo se mide con la mezcla de defensor de interior — si ese intercambio deja a un interior lento marcando a un base o a un base pequeño marcando a un pívot, la ventaja de ataque sube en consecuencia (mismatch real medido con atributos, no una etiqueta).',
    whenUseful: 'Elimina la ventaja de ritmo del bloqueo directo cuando los dos defensores son intercambiables (similares en tamaño/movilidad).',
    risks: 'Si los dos defensores NO son intercambiables, genera un mismatch real y medible a favor del ataque — el motor lo detecta evaluando al defensor equivocado con la mezcla de atributos que le corresponde en su nuevo rol.',
  });
  add({
    id: 'hedge',
    category: 'coverage',
    label: 'Hedge',
    what: 'El defensor del bloqueador sale agresivamente hacia el balón para frenar temporalmente al manejador, antes de recuperar a su hombre.',
    goal: 'Cortar en seco el ritmo del manejador sin llegar a doblar del todo, recuperando la marca original después.',
    engineEffect: 'Comparte EXACTAMENTE los mismos valores de CONFIG que Blitz — el motor no distingue todavía el matiz real entre "salir y recuperar" (Hedge) y "doblar de verdad" (Blitz), señalado explícitamente en el código.',
    whenUseful: 'Igual que Blitz: castiga a un manejador con mala Visión de Juego/Pase que no lee bien el 4 contra 3 resultante.',
    risks: 'Deja al roller con un "short roll" en un 4 contra 3 momentáneo — un pasador con buena Visión de Juego/Pase puede aprovechar ese hueco antes de que la defensa rote.',
  });
  add({
    id: 'blitz',
    category: 'coverage',
    label: 'Blitz',
    what: 'Dos defensores doblan por completo al manejador del balón, forzando que suelte el balón de inmediato.',
    goal: 'Quitarle el balón de las manos al manejador a cualquier precio, aceptando jugar temporalmente con inferioridad numérica.',
    engineEffect: 'Punto de partida más negativo de AdvantageState para el ataque de las cinco coberturas (empatado con Hedge) pero mide al manejador únicamente por Visión de Juego/Pase, sin ningún peso de tiro — la vulnerabilidad real es la lectura rápida del short-roll/4 contra 3, no el tiro directo del manejador.',
    whenUseful: 'Muy eficaz contra un manejador con mal manejo de balón bajo presión y mala lectura de pase.',
    risks: 'La cobertura más agresiva y más comprometida de las cinco: un manejador con buena lectura puede convertir el doblaje en una ventaja clara para su equipo (short-roll/4 contra 3/extra-pass).',
  });

  // === Roles ofensivos (DESIGN.md 7.12.9) ================================
  add({
    id: 'primaryCreator',
    category: 'roleOffensive',
    label: 'Creador primario',
    what: 'Inicia gran parte del ataque del equipo y toma la primera lectura de casi todas las posesiones.',
    goal: 'Concentrar la organización ofensiva en un jugador de confianza.',
    engineEffect: 'El encaje (roleFit) se calcula con una mezcla orientada a Manejo de balón/Visión de Juego (35% cada uno)/Pase (20%)/Decisión bajo presión (10%), combinada con su competencia en Base/Escolta y un pequeño factor de Energía actual.',
    suitablePlayers: 'Bases/escoltas con Manejo de balón y Visión de Juego altos.',
    risks: 'No tiene un mecanismo de "primera opción" real en el motor todavía — es una guía de encaje, no una orden que el motor obligue a cumplir.',
  });
  add({
    id: 'secondaryCreator',
    category: 'roleOffensive',
    label: 'Creador secundario',
    what: 'Organiza el ataque cuando el creador primario no está disponible o ataca la segunda ventaja tras la primera acción.',
    goal: 'Dar al equipo un segundo generador de juego sin depender de un único jugador.',
    engineEffect: 'Mezcla más repartida que el creador primario: Manejo de balón/Visión de Juego/Pase al 30% cada uno más Decisión bajo presión (10%).',
    risks: 'El motor no distingue todavía "primera" y "segunda" opción de creación en tiempo real — el rol describe la aptitud, no una jerarquía de uso activa.',
  });
  add({
    id: 'pnrHandler',
    category: 'roleOffensive',
    label: 'PnR Handler',
    what: 'Especialista en dirigir el bloqueo directo (Pick & Roll) como manejador.',
    goal: 'Ser el manejador preferente cada vez que el equipo monta un Pick & Roll.',
    engineEffect: 'Mezcla con más peso en Manejo de balón (40%) que el resto de creadores. La elección real del manejador en cada posesión de Pick & Roll sigue el criterio general de mayor uso del quinteto, no todavía una prioridad directa por este rol — roleFit mide la aptitud, útil para decidir a quién dársela.',
    risks: 'Asignar este rol no fuerza todavía que ese jugador maneje el balón en cada Pick & Roll real.',
  });
  add({
    id: 'isolationScorer',
    category: 'roleOffensive',
    label: 'Isolation Scorer',
    what: 'Anotador capaz de crear su propio tiro 1 contra 1 en un espacio despejado.',
    goal: 'Tener a quien recurrir cuando el equipo necesita una canasta individual sin depender de una jugada colectiva.',
    engineEffect: 'Si un jugador de la plantilla tiene este rol asignado, el motor lo prioriza como anotador real cada vez que el play-type Isolation se elige en una posesión (en vez de caer al criterio genérico de mayor uso).',
    suitablePlayers: 'Manejo de balón, Tiro media distancia/interior, Bandeja y Agresividad.',
    risks: 'Ninguno propio — asignar el rol a un jugador sin esos atributos no mejora su encaje, solo cambia a quién se le da el balón.',
  });
  add({
    id: 'spotUpShooter',
    category: 'roleOffensive',
    label: 'Spot-up Shooter',
    what: 'Especialista en recibir parado y tirar con solvencia (catch-and-shoot), y en atacar el hueco cuando un defensor cierra tarde (closeout).',
    goal: 'Dar una amenaza de tiro fiable que la defensa deba respetar incluso lejos del balón.',
    engineEffect: 'Mezcla orientada casi por completo a Tiro exterior (55%), Posicionamiento (25%) y Concentración (20%) — sin Manejo de balón, es un rol de recepción, no de creación.',
    suitablePlayers: 'Tiro exterior alto y buen Posicionamiento sin balón.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'movementShooter',
    category: 'roleOffensive',
    label: 'Movement Shooter',
    what: 'Recibe el balón saliendo de bloqueos (DHO/Off Screen/Floppy) en vez de parado.',
    goal: 'Generar tiro exterior a partir de movimiento sin balón, más difícil de negar que un tirador estático.',
    engineEffect: 'Mezcla de Tiro exterior (40%), Agilidad (20%), Posicionamiento (25%) y Resistencia (15%) — a diferencia del Spot-up Shooter, exige más condición física para moverse sin balón constantemente.',
    risks: 'Ninguno propio — Handoff/DHO y Off Screen (las jugadas donde más encaja este rol) todavía no tienen motor de resolución real, así que su aptitud no se explota hoy en una posesión real de esas familias.',
  });
  add({
    id: 'slasher',
    category: 'roleOffensive',
    label: 'Slasher',
    what: 'Ataca el aro en velocidad, penetrando y buscando espacios en vez de tirar desde fuera.',
    goal: 'Castigar la ayuda tardía y el desequilibrio defensivo atacando directo al aro.',
    engineEffect: 'Mezcla de Aceleración (30%), Agilidad (25%), Bandeja (30%) y Agresividad (15%) — es el rol ofensivo más orientado a atributos físicos puros de todo el catálogo.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'connector',
    category: 'roleOffensive',
    label: 'Connector',
    what: 'Recibe el balón, decide rápido y mantiene el ataque en movimiento (extra-pass, handoff, continuidad) en vez de buscar su propio tiro.',
    goal: 'Ser el eslabón que conserva o amplía una ventaja ya creada, sin necesitar ser el primer generador.',
    engineEffect: 'Mezcla de Pase/Visión de Juego (35% cada uno), Trabajo en equipo (20%) y Manejo de balón (10%).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'postScorer',
    category: 'roleOffensive',
    label: 'Post Scorer',
    what: 'Anotador que finaliza o crea individualmente desde el poste bajo, de espaldas al aro.',
    goal: 'Tener una opción de anotación fiable cerca del aro cuando el equipo entra el balón al poste.',
    engineEffect: 'Si está asignado, el motor lo prioriza como anotador real en cada posesión de Post Up. Mezcla de Tiro interior (40%), Fuerza (30%), Balance (20%) y Agresividad (10%).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'postHub',
    category: 'roleOffensive',
    label: 'Post Hub',
    what: 'Interior que distribuye desde el poste o el codo y activa cortes de sus compañeros, más que buscar su propio tiro.',
    goal: 'Usar el poste como punto de organización del ataque, no solo como final de la jugada.',
    engineEffect: 'Igual que Post Scorer, activa la prioridad del motor para elegir al anotador real de una posesión de Post Up. Mezcla de Pase/Visión de Juego (30% cada uno), Tiro interior (20%) y Trabajo en equipo (20%) — sin peso de Fuerza/Agresividad, a diferencia de Post Scorer.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'rollMan',
    category: 'roleOffensive',
    label: 'Roll Man',
    what: 'Bloquea para el manejador y continúa directo hacia el aro (roll) tras el bloqueo, buscando recibir cerca de la canasta.',
    goal: 'Ser la segunda amenaza inmediata de cada Pick & Roll, forzando a la defensa a elegir entre parar al manejador o al que corta al aro.',
    engineEffect: 'Mezcla de Bandeja (35%), Salto (25%), Fuerza (20%) y Rebote ofensivo (20%) — el propio motor de Pick & Roll ya restringe la finalización del rolo a Tiro interior o Bandeja, nunca un triple, coherente con este rol.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'shortRollPlaymaker',
    category: 'roleOffensive',
    label: 'Short-Roll Playmaker',
    what: 'Interior que, tras recibir con superioridad numérica momentánea (4 contra 3 típico de Hedge/Blitz), toma él mismo la siguiente decisión de pase.',
    goal: 'Convertir el hueco que dejan las coberturas agresivas de Pick & Roll en una segunda creación de juego, no solo en una finalización.',
    engineEffect: 'Mezcla de Pase/Visión de Juego (35%/30%), Bandeja (20%) y Decisión bajo presión (15%). El escenario que describe (4 contra 3 tras Hedge/Blitz) ya existe en el AdvantageState del motor, pero la elección de qué interior concreto recibe ese pase sigue hoy el criterio general de bloqueador, no todavía una prioridad de rol dedicada.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'pickAndPopBig',
    category: 'roleOffensive',
    label: 'Pick & Pop Big',
    what: 'Interior que, en vez de continuar al aro tras el bloqueo (roll), se abre a tirar desde el perímetro (pop).',
    goal: 'Amenazar con tiro exterior desde una posición interior, estirando la defensa de forma distinta a un Roll Man puro.',
    engineEffect: 'Mezcla de Tiro exterior (40%), Tiro media distancia (35%) y Fuerza (25%) — es también el arquetipo de interior que más sube el effectiveSpacing real de un 5-Out/4-Out-1-In, al ser una amenaza de tiro real desde una posición de poste.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'primaryScreener',
    category: 'roleOffensive',
    label: 'Primary Screener',
    what: 'Prioriza poner bloqueos de calidad y con frecuencia (incluidos re-screens) por encima de buscar su propio tiro.',
    goal: 'Ser el bloqueador de referencia del equipo, maximizando cuánta ventaja genera cada bloqueo directo.',
    engineEffect: 'Mezcla de Fuerza (35%), Balance (25%), Ética de trabajo (20%) y Rebote ofensivo (20%) — coincide en espíritu con el criterio genérico que ya usa el motor para elegir al bloqueador real de cada Pick & Roll (Fuerza/Tiro interior/Rebote ofensivo), aunque el encaje del rol usa su propia mezcla dedicada.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'offensiveRebounder',
    category: 'roleOffensive',
    label: 'Offensive Rebounder',
    what: 'Prioriza cargar la lucha por el rebote ofensivo sobre replegarse pronto en defensa.',
    goal: 'Maximizar segundas oportunidades de tiro tras un fallo propio.',
    engineEffect: 'Mezcla de Rebote ofensivo (45%), Salto (25%), Fuerza (15%) y Ética de trabajo (15%). DESIGN.md fija un trade-off duro: cargar el rebote ofensivo deja menos jugadores replegados, así que este rol tiene coste real en la transición defensiva del equipo, no es un beneficio gratuito.',
    risks: 'Más jugadores volcados al rebote ofensivo dejan al equipo más expuesto al contraataque rival si no se consigue el rebote.',
  });

  // === Roles defensivos (DESIGN.md 7.12.21) ==============================
  add({
    id: 'poaStopper',
    category: 'roleDefensive',
    label: 'POA Stopper',
    what: 'Defensor principal encargado de contener al manejador del balón rival (Point of Attack).',
    goal: 'Frenar al primer generador de juego rival antes de que la acción empiece.',
    engineEffect: 'Mezcla de Defensa perimetral (40%), Agilidad (25%), Anticipación (20%) y Robo (15%). Es también, literalmente, la valoración que usa la métrica de quinteto POA Defense — no es una mezcla nueva distinta, reutiliza esta misma.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'screenNavigator',
    category: 'roleDefensive',
    label: 'Screen Navigator',
    what: 'Especialista en perseguir a su hombre a través de bloqueos sin perderlo (navegar el bloqueo) en vez de cambiar o pasar por debajo.',
    goal: 'Poder defender por encima del bloqueo sin conceder un hueco real, incluso contra bloqueos repetidos.',
    engineEffect: 'Mezcla de Agilidad (35%), Defensa perimetral (30%), Ética de trabajo (20%) y Resistencia (15%).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'switchDefender',
    category: 'roleDefensive',
    label: 'Switch Defender',
    what: 'Defensor versátil capaz de asumir un cambio de marca (switch) y sobrevivir al mismatch resultante, sea contra un base o un interior.',
    goal: 'Permitir que el equipo cambie asignaciones libremente en el bloqueo directo sin generar un mismatch explotable.',
    engineEffect: 'Mezcla equilibrada entre Defensa perimetral (30%), Defensa interior (30%), Agilidad (25%) y Fuerza (15%) — precisamente el perfil que, si falta, es el que el motor detecta como mismatch real tras un Switch (evaluando a cada defensor con la mezcla del rol que le toca tras el cambio).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'perimeterDisruptor',
    category: 'roleDefensive',
    label: 'Perimeter Disruptor',
    what: 'Genera actividad defensiva agresiva en el perímetro: presión, robos y negación de líneas de pase.',
    goal: 'Incomodar la circulación de balón rival más que simplemente contener.',
    engineEffect: 'Mezcla de Robo (35%), Anticipación (30%), Agresividad (20%) y Defensa perimetral (15%).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'nailHelper',
    category: 'roleDefensive',
    label: 'Nail Helper',
    what: 'Defensor de ayuda central (en el "clavo", el codo de la zona), clave para cerrar penetraciones y short-rolls.',
    goal: 'Ser el primer recurso de ayuda cuando el balón penetra hacia el centro de la pintura.',
    engineEffect: 'Mezcla de Anticipación (35%), Visión de Juego (25%), Posicionamiento (25%) y Defensa interior (15%). Es uno de los tres roles que el motor prioriza a la hora de elegir quién dobla al poste (junto a Low Man y Roamer).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'lowMan',
    category: 'roleDefensive',
    label: 'Low Man',
    what: 'Última línea de ayuda antes del aro frente al rolo o a un atacante que ya superó su primera línea de defensa.',
    goal: 'Evitar la canasta fácil cuando la primera línea defensiva ya ha sido superada.',
    engineEffect: 'Mezcla de Defensa interior (35%), Salto (25%), Tapón (25%) y Anticipación (15%). Es, junto a Nail Helper y Roamer, uno de los roles que el motor prioriza para el doble equipo de poste.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'rimProtector',
    category: 'roleDefensive',
    label: 'Rim Protector',
    what: 'Protección de aro pura: tapones y disuasión de tiros cercanos, más que contención perimetral.',
    goal: 'Dar al equipo una última línea de defensa fiable bajo el aro.',
    engineEffect: 'Mezcla de Tapón (40%), Defensa interior (30%), Salto (20%) y Fuerza (10%) — reutilizada literalmente por la valoración de quinteto Rim Protection.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'postAnchor',
    category: 'roleDefensive',
    label: 'Post Anchor',
    what: 'Ancla defensiva en el poste bajo, especializado en defender de espaldas al aro contra otro interior.',
    goal: 'Poder defender un Post Up rival sin necesitar ayuda constante.',
    engineEffect: 'Mezcla muy concentrada en Defensa interior (50%), Fuerza (30%) y Balance (20%) — el rol defensivo más especializado del catálogo (solo 3 atributos, sin ninguno perimetral).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'roamer',
    category: 'roleDefensive',
    label: 'Roamer',
    what: 'Defensor capaz de abandonar temporalmente a un rival poco peligroso para generar ayudas en otras zonas de la pista.',
    goal: 'Aportar una ayuda extra sin comprometer del todo su propia asignación.',
    engineEffect: 'Mezcla de Anticipación (35%), Visión de Juego (25%), Robo (20%) y Agilidad (20%). Tercer rol, junto a Low Man y Nail Helper, que el motor prioriza para el doble equipo de poste.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'defensiveRebounder',
    category: 'roleDefensive',
    label: 'Defensive Rebounder',
    what: 'Prioriza cerrar el rebote defensivo por encima de otras responsabilidades defensivas.',
    goal: 'Asegurar la posesión tras un tiro fallado rival, evitando segundas oportunidades.',
    engineEffect: 'Mezcla de Rebote defensivo (45%), Salto (25%), Fuerza (15%) y Posicionamiento (15%).',
    risks: 'Ninguno propio.',
  });

  // === Playbook (DESIGN.md 7.12.10 / 7.12.24) ============================
  add({
    id: 'basicHighPnr',
    category: 'playbook',
    label: 'Basic High P&R',
    what: 'Bloqueo directo simple en la zona alta de la pista, con solo un manejador y un bloqueador.',
    goal: 'Generar una ventaja básica sin necesitar más de dos jugadores implicados — la jugada más simple del Playbook de Pick & Roll.',
    engineEffect: 'Complejidad baja (20/100) — se resuelve con el motor real de Pick & Roll, con lecturas representativas de pull-up del manejador (contra Drop/Under), finalización del rolo (contra Drop/Switch) y kick-out a tirador abierto (contra Blitz/Hedge).',
    whenUseful: 'Al ser la de menor complejidad, gana Familiaridad Táctica más rápido — buena base para un equipo con un manejador y un interior competentes, sin necesitar más piezas especializadas.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'horns',
    category: 'playbook',
    label: 'Horns',
    what: 'Formación con dos interiores en ambos codos y el manejador en el centro, que deriva en un Pick & Roll lateral tras un doble bloqueo inicial.',
    goal: 'Dar al manejador varias opciones desde el primer momento (doble bloqueo, pop del segundo interior) antes de decidir hacia qué lado atacar.',
    engineEffect: 'Complejidad media (45/100) — participan handler, screener y un segundo interior; lecturas representativas de Pick & Roll lateral tras el doble bloqueo (contra Drop/Switch), pop del segundo interior en el codo libre (contra Blitz/Hedge) y re-screen (contra Under). Se resuelve con el mismo motor de Pick & Roll que Basic High P&R.',
    suitablePlayers: 'Requiere dos interiores útiles a la vez (uno para el bloqueo directo, otro para el pop), por eso solo es compatible con spacing 4-Out 1-In o Dynamic.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'spainPnr',
    category: 'playbook',
    label: 'Spain Pick & Roll',
    what: 'Bloqueo directo con un tercer jugador que además bloquea POR DETRÁS al defensor del bloqueador (back-screen), complicando su ayuda.',
    goal: 'La jugada de Pick & Roll más completa del catálogo: crea ventaja incluso contra coberturas agresivas gracias al bloqueo adicional.',
    engineEffect: 'La complejidad más alta de todo el Playbook no situacional (70/100) — participan handler, screener y back-screener; cuatro lecturas representativas cubren las cuatro coberturas principales: pop del back-screener contra Drop, lob al rolo contra Drop/Under, kick-out al back-screener contra Blitz/Hedge, y atacar el mismatch generado contra Switch. Al ser tan compleja, tarda más en ganar Familiaridad Táctica que el resto del catálogo (el freno de complejidad es proporcional a este número).',
    whenUseful: 'Da respuesta real a las cuatro coberturas principales de Pick & Roll, pero exige más partidos jugados con ella (Familiaridad) para ejecutarse bien, precisamente por su alta complejidad.',
    risks: 'Ninguno propio adicional al coste de complejidad ya descrito.',
  });
  add({
    id: 'doubleDrag',
    category: 'playbook',
    label: 'Double Drag',
    what: 'Dos bloqueos directos consecutivos para el mismo manejador, normalmente en transición/inicio de ataque, en vez de uno solo.',
    goal: 'Generar una ventaja doble antes de que la defensa termine de organizarse.',
    engineEffect: 'Complejidad media-alta (55/100) — participan handler, screener y un segundo bloqueador; lecturas representativas de ataque tras el segundo bloqueo (doble ventaja, contra Drop/Switch) y short-roll del primer bloqueador (contra Blitz/Hedge).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'dhoZoom',
    category: 'playbook',
    label: 'DHO / Zoom',
    what: 'Entrega en mano (Dribble Hand-Off) rápida a un compañero que corta cerca, buscando tiro inmediato o penetración del receptor.',
    goal: 'Generar una ventaja pequeña y rápida a partir de movimiento sin necesitar un bloqueo directo clásico.',
    engineEffect: 'Complejidad media (40/100). Su familia (Handoff/DHO) todavía no tiene motor de resolución real — existe en el catálogo (con lecturas de catch-and-shoot y penetración tras el handoff) pero no se elige activamente en una posesión real todavía, a diferencia de las jugadas de Pick & Roll de arriba.',
    risks: 'Ninguno todavía en el resultado del partido — al no tener motor propio, aparecer en el Playbook es solo informativo por ahora.',
  });
  add({
    id: 'floppy',
    category: 'playbook',
    label: 'Floppy',
    what: 'Un tirador sale de un doble bloqueo (puede elegir el lado) para recibir el balón, buscando tiro exterior inmediato.',
    goal: 'Generar tiro exterior de calidad para un especialista mediante movimiento sin balón en vez de un Pick & Roll.',
    engineEffect: 'Complejidad media (35/100). Igual que DHO/Zoom, su familia (Off Screen) todavía no tiene motor de resolución real — el catálogo (con lecturas de curl hacia el aro si niegan el exterior, y catch-and-shoot tras el doble bloqueo) existe, pero no se elige activamente en una posesión real todavía.',
    risks: 'Ninguno todavía en el resultado del partido.',
  });
  add({
    id: 'postEntry',
    category: 'playbook',
    label: 'Post Entry',
    what: 'Entrada directa de balón al poste bajo para que el interior juegue 1 contra 1 o distribuya desde ahí.',
    goal: 'Usar una ventaja de tamaño/fuerza cerca del aro como opción principal de la posesión.',
    engineEffect: 'Complejidad baja (25/100) — participa solo el interior que recibe; se resuelve con el motor real de Post Up, con lecturas representativas de finalización directa 1 contra 1 (contra Drop/Under) y kick-out si llega el doble equipo (contra Switch/Blitz).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'fiveOutMotion',
    category: 'playbook',
    label: '5-Out Motion',
    what: 'Ataque de movimiento continuo con los cinco jugadores abiertos, sin posiciones fijas ni un guion de jugada concreto — cortes y pases constantes.',
    goal: 'Generar oportunidades a partir de la lectura colectiva del quinteto en vez de una jugada con participantes fijos.',
    engineEffect: 'Complejidad alta (60/100), sin participantes fijos declarados (a diferencia del resto del Playbook) y solo compatible con spacing 5-Out. Su familia (Motion/Flow) todavía no tiene motor de resolución real, mismo caso que DHO/Zoom y Floppy — existe como catálogo (con lecturas de corte backdoor y extra-pass) pero no se elige activamente en una posesión real todavía.',
    risks: 'Ninguno todavía en el resultado del partido.',
  });
  add({
    id: 'isolationClearout',
    category: 'playbook',
    label: 'Isolation Clearout',
    what: 'El resto del quinteto se aparta del balón para dejar un espacio despejado a un jugador que ataca 1 contra 1.',
    goal: 'Maximizar el espacio disponible para una creación puramente individual.',
    engineEffect: 'La complejidad más baja de todo el Playbook (15/100) — participa solo el anotador; se resuelve con el motor real de Isolation, con lecturas de ataque directo (contra Drop/Under/Switch) y kick-out si llega la ayuda tardía (contra Blitz/Hedge). Es también la jugada que se usa siempre que el play-type Isolation se elige en una posesión normal (no situacional).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'atoSidePnr',
    category: 'playbook',
    label: 'ATO — P&R lateral tras tiempo muerto',
    what: 'Pick & Roll lateral preparado específicamente durante un tiempo muerto, para ejecutar justo después.',
    goal: 'Aprovechar la pausa del tiempo muerto para dibujar una jugada concreta de bloqueo directo.',
    engineEffect: 'Jugada del sub-playbook de situaciones especiales (situación ATO) que se resuelve con el mismo motor real de Pick & Roll que Basic High P&R — nunca un cuarto motor de resolución paralelo. Se elige cuando el motor detecta que la posesión es justo después de un tiempo muerto (la prioridad más alta de las cinco situaciones especiales).',
    risks: 'Ninguno propio — sin garantía de tiro concreto, como el resto del Playbook.',
  });
  add({
    id: 'atoIsolationMismatch',
    category: 'playbook',
    label: 'ATO — Aislar el mismatch buscado en el tiempo muerto',
    what: 'Jugada preparada en el tiempo muerto para aislar deliberadamente a un jugador contra el mismatch que el entrenador quiere explotar.',
    goal: 'Convertir un tiempo muerto en una ventaja individual concreta y buscada, no genérica.',
    engineEffect: 'Se resuelve con el motor real de Isolation, con la misma lectura de ataque directo que Isolation Clearout — la diferencia es únicamente de contexto (tras tiempo muerto), y compite con la jugada de P&R de ATO por ser la preferida de esa situación (se elige en la pestaña Situaciones, o se sortea automáticamente).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'blobPostEntry',
    category: 'playbook',
    label: 'BLOB — Entrada directa al poste tras canasta rival',
    what: 'Jugada preparada para el saque de fondo (típicamente tras una canasta rival) que entra el balón directo al poste.',
    goal: 'Aprovechar el saque de fondo para buscar una ventaja de poste inmediata.',
    engineEffect: 'Se resuelve con el mismo motor real de Post Up que Post Entry, con la misma lectura de finalización directa. Se elige cuando el motor infiere BLOB del final de la posesión anterior (canasta de campo rival anotada).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'slobSidePnr',
    category: 'playbook',
    label: 'SLOB — P&R de saque de banda',
    what: 'Pick & Roll lateral preparado para ejecutarse justo tras un saque de banda.',
    goal: 'Aprovechar el saque de banda para iniciar una jugada de bloqueo directo concreta en vez de un simple pase de inicio.',
    engineEffect: 'Se resuelve con el mismo motor real de Pick & Roll que Basic High P&R. Se elige cuando el motor infiere SLOB (cualquier final de posesión anterior que no sea canasta de campo rival).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'lateClockIsolation',
    category: 'playbook',
    label: 'Late Clock — Isolation con poco reloj de posesión',
    what: 'Ataque 1 contra 1 forzado porque ya no queda tiempo de posesión para una jugada completa.',
    goal: 'Resolver la posesión con la opción más rápida disponible cuando el reloj obliga a decidir ya.',
    engineEffect: 'Se resuelve con el motor real de Isolation, con una única lectura de ataque forzado 1 contra 1 válida contra cualquier cobertura — se elige cuando queda menos reloj de posesión que el umbral de "jugada completa" del motor.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'lastPossessionSidePnr',
    category: 'playbook',
    label: 'Last Possession — P&R para el último tiro',
    what: 'Pick & Roll lateral pensado específicamente para el último tiro de un período o del partido.',
    goal: 'Buscar el mejor tiro posible en la posesión más decisiva, con dos lecturas disponibles (tiro del manejador o kick-out).',
    engineEffect: 'Se resuelve con el mismo motor real de Pick & Roll que el resto de variantes — se elige cuando el motor detecta que es la última posesión relevante del período/partido (último período o prórroga, pocos segundos, marcador dentro del margen configurado).',
    risks: 'Ninguno propio.',
  });

  // === Esquemas defensivos (DESIGN.md 7.12.14) ============================
  add({
    id: 'man-to-man',
    category: 'defenseScheme',
    label: 'Hombre a hombre',
    what: 'Cada defensor marca a un rival concreto durante toda la posesión, con posibilidad de ayudas y cambios puntuales.',
    goal: 'Referencia defensiva principal — responsabilidad individual clara sobre cada atacante.',
    engineEffect: 'Esquema por defecto: no añade ningún término de zona al AdvantageState — el comportamiento es exactamente el de las coberturas de Pick & Roll y los matchups individuales descritos en sus propias categorías, sin ningún efecto adicional de zona.',
    risks: 'Ninguno propio de esquema — hereda los riesgos normales de cada cobertura de Pick & Roll y de los matchups declarados.',
  });
  add({
    id: '2-3',
    category: 'defenseScheme',
    label: 'Zona 2-3',
    what: 'Zona con dos defensores arriba y tres abajo, protegiendo la pintura por defecto.',
    goal: 'Proteger el aro y forzar decisiones desde el exterior, aceptando cierto riesgo en el alto poste/esquinas/rebote según ejecución.',
    engineEffect: 'Punto de partida ligeramente negativo para el ataque, pero se vuelve MÁS vulnerable cuanto mayor sea el spacing efectivo real del rival (una 2-3 se estira y sufre contra un quinteto con tiradores de verdad, y se contrae sin coste extra contra uno sin amenaza exterior real). Además concede un pequeño extra a favor del ataque específicamente cuando el rival juega Post Up (contramedida real: atacar el alto poste que deja libre una 2-3).',
    risks: 'Vulnerable al alto poste y, sobre todo, a un rival con spacing efectivo alto (tiradores reales en las cinco posiciones).',
  });
  add({
    id: '3-2',
    category: 'defenseScheme',
    label: 'Zona 3-2',
    what: 'Zona con tres defensores arriba y dos abajo, con más presencia perimetral y menos protección interior directa que una 2-3.',
    goal: 'Presionar más el tiro exterior a costa de ceder algo más de presencia bajo el aro.',
    engineEffect: 'Punto de partida algo menos negativo que la 2-3, con la misma sensibilidad al spacing efectivo real del rival que el resto de zonas, pero sin ninguna contramedida de play-type específica en CONFIG (a diferencia de la 2-3 con Post Up o la 1-3-1 con Pick & Roll/Isolation).',
    risks: 'Menos protección interior directa que la 2-3, sin que el motor le añada todavía un extra explícito contra el juego de poste rival (solo el efecto general de spacing).',
  });
  add({
    id: '1-3-1',
    category: 'defenseScheme',
    label: 'Zona 1-3-1',
    what: 'Zona de presión con un defensor en punta, tres en línea intermedia y uno bajo el aro — prioriza negar líneas de pase y forzar dobles, a costa de rotaciones largas.',
    goal: 'Presionar la circulación de balón y generar pérdidas, aceptando huecos de media distancia si el rival supera el trap.',
    engineEffect: 'Es la única de las tres zonas con punto de partida POSITIVO para el ataque antes de mirar a los jugadores reales, reflejando que las rotaciones largas que exige dejan huecos reales. Concede además un extra explícito a favor del ataque si el rival juega Pick & Roll o Isolation (contramedida real: explotar el hueco tras el trap con skip-pass/kick-out), aunque comparte la misma sensibilidad al spacing efectivo que el resto de zonas.',
    risks: 'La zona más arriesgada de las tres frente a un rival que sabe leer el trap con Pick & Roll o Isolation — el propio motor se lo concede explícitamente.',
  });

  // === Press (DESIGN.md 7.12.15) ==========================================
  add({
    id: 'halfCourt',
    category: 'press',
    label: 'A 3/4 de pista',
    what: 'Presión a 3/4 de pista: la defensa incomoda al rival antes de llegar a medio campo, sin llegar a presionar desde el saque de fondo.',
    goal: 'Acelerar el ritmo y forzar pérdidas tempranas sin comprometer tanta energía/estructura como una presión a toda pista.',
    engineEffect: 'Sube el multiplicador de pérdida de balón temprana (hasta un 25% adicional en el mejor de los casos para la defensa) y añade 0,5s de coste de reloj al cruzar medio campo — ambos efectos se amplían automáticamente si el manejador rival tiene mal Manejo de balón/Visión de Juego/Decisión bajo presión, y se reducen si el manejador es bueno. El desgaste extra de Energía por presionar no está modelado todavía.',
    whenUseful: 'Castiga más a un rival con manejadores de balón débiles que a uno con buenos manejadores/pasadores.',
    risks: 'Ninguno modelado todavía en Energía — el único coste real hoy es el que ya describe el efecto (ninguno si el rival maneja bien el balón bajo presión).',
  });
  add({
    id: 'fullCourt',
    category: 'press',
    label: 'A toda pista',
    what: 'Presión a toda la pista, desde el propio saque de fondo rival.',
    goal: 'Maximizar la incomodidad al rival desde el primer segundo de la posesión, aceptando mayor riesgo/desgaste.',
    engineEffect: 'Mismo mecanismo que la presión a 3/4 pero con un impulso base mayor (hasta 60% adicional de multiplicador de pérdida) y más coste de reloj (1,5s) al cruzar medio campo — sigue amplificándose/reduciéndose según la calidad de manejo del rival, igual que la presión a 3/4.',
    risks: 'Mismo riesgo no modelado de desgaste físico; al ser el tipo de press más agresivo del catálogo, su efecto (para bien o para mal) es proporcionalmente mayor que el de 3/4 pista.',
  });

  // === Doble equipo de poste (DESIGN.md 7.12.19) =========================
  add({
    id: 'never',
    category: 'postDoubleTeam',
    label: 'Nunca',
    what: 'El poste rival nunca recibe ayuda de un segundo defensor, sin importar quién sea.',
    goal: 'Mantener siempre la estructura defensiva de base, aceptando que el poste juegue 1 contra 1 puro.',
    engineEffect: 'El motor devuelve directamente "sin doble equipo" — el anotador posteado se enfrenta solo a su defensor directo en el AdvantageState de Post Up, sin ninguna probabilidad de ayuda.',
    risks: 'Un interior rival claramente superior a su defensor directo no encuentra ninguna resistencia extra.',
  });
  add({
    id: 'starOnly',
    category: 'postDoubleTeam',
    label: 'Solo si supera claramente a su defensor',
    what: 'Solo se dobla al poste cuando el anotador supera claramente a su defensor directo (umbral de diferencia de nivel).',
    goal: 'Reservar el riesgo de doblar (dejar a otro rival sin marca) solo para las situaciones donde de verdad hace falta.',
    engineEffect: 'Si la diferencia de rating entre anotador y defensor supera un margen de CONFIG, hay una probabilidad del 50% de que llegue la ayuda; por debajo del margen, nunca dobla.',
    risks: 'Con el margen no alcanzado, un anotador algo superior (pero no "claramente") puede seguir jugando sin ayuda.',
  });
  add({
    id: 'always',
    category: 'postDoubleTeam',
    label: 'Siempre que reciba en el poste',
    what: 'El poste rival SIEMPRE recibe un segundo defensor en cuanto recibe el balón ahí, sea quien sea.',
    goal: 'Eliminar por completo el 1 contra 1 de poste, aceptando siempre el riesgo de dejar a otro jugador sin marca.',
    engineEffect: 'El doble equipo se activa siempre — el anotador posteado se enfrenta siempre a dos defensores, y su única salida es encontrar el hueco (kick-out) según su propia Visión de Juego y Pase.',
    risks: 'Doblar sistemáticamente, incluso contra un anotador mediocre, da al ataque rival un extra-pass gratuito cada vez que juegue al poste — el motor no distingue el nivel del anotador con esta regla.',
  });

  // === Situaciones especiales (DESIGN.md 7.12.24) ========================
  add({
    id: 'ATO',
    category: 'situationType',
    label: 'ATO (tras tiempo muerto)',
    what: 'After Time Out — la primera jugada que se ejecuta justo después de pedir un tiempo muerto.',
    goal: 'Aprovechar la pausa para preparar una jugada concreta en vez de dejar que el ataque se organice de forma espontánea.',
    engineEffect: 'Tiene la prioridad MÁS ALTA de las cinco situaciones especiales: si acaba de haber un tiempo muerto, la posesión siguiente siempre se resuelve como ATO, por delante de cualquier otra situación que también se cumpliera a la vez (por ejemplo, últimos segundos de partido).',
    risks: 'Ninguno propio — su eficacia depende, como el resto del Playbook, de los jugadores y la cobertura rival, sin garantía de tiro concreto.',
  });
  add({
    id: 'BLOB',
    category: 'situationType',
    label: 'BLOB (saque de fondo)',
    what: 'Baseline Out Of Bounds — jugada preparada para un saque de balón desde el fondo de la pista, normalmente tras una canasta rival.',
    goal: 'Aprovechar el saque de fondo para entrar el balón con una jugada concreta en vez de un simple pase de inicio.',
    engineEffect: 'Se infiere del ÚLTIMO evento de la posesión anterior: una canasta de campo anotada por el rival se interpreta como BLOB (aproximación deliberada — un último tiro libre anotado también sería BLOB en la realidad, pero el motor no distingue ese matiz dentro de una secuencia de tiros libres).',
    risks: 'Ninguno propio — mismas reglas de Playbook que cualquier otra jugada.',
  });
  add({
    id: 'SLOB',
    category: 'situationType',
    label: 'SLOB (saque de banda)',
    what: 'Sideline Out Of Bounds — jugada preparada para un saque de banda.',
    goal: 'Aprovechar el saque de banda para iniciar una jugada concreta en vez de un simple pase de inicio.',
    engineEffect: 'Se infiere de cualquier final de posesión anterior que NO sea una canasta de campo anotada (fallo, pérdida, falta...) — la contrapartida exacta de BLOB en la aproximación del motor.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'lateClock',
    category: 'situationType',
    label: 'Late Clock (pocos segundos de posesión)',
    what: 'Quedan pocos segundos de reloj de posesión (24s) para completar una jugada normal.',
    goal: 'Resolver la posesión con una acción rápida y de baja complejidad cuando ya no hay tiempo para un sistema completo.',
    engineEffect: 'Se activa cuando el reloj de posesión restante cae por debajo del mismo umbral que ya usa el motor para decidir que no cabe una jugada completa — reutilizado tal cual, no un umbral nuevo. Tiene prioridad sobre BLOB/SLOB, pero por debajo de ATO y Last Possession.',
    risks: 'Ninguno propio — jugadas de baja complejidad por diseño, coherente con la falta de tiempo.',
  });
  add({
    id: 'lastPossession',
    category: 'situationType',
    label: 'Last Possession (última posesión)',
    what: 'Última posesión relevante de un período o del partido, con el resultado todavía en juego.',
    goal: 'Buscar el mejor tiro posible sabiendo que puede no haber más oportunidades.',
    engineEffect: 'Se activa solo en el último período (o prórroga) cuando quedan pocos segundos (mismo umbral que el aviso de tiro sobre la bocina) Y el marcador está dentro de un margen de puntos configurable (3 por defecto) — un partido ya decidido por mucha diferencia NO activa esta situación aunque queden pocos segundos. Tiene prioridad sobre Late Clock y BLOB/SLOB, pero por debajo de ATO.',
    risks: 'Ninguno propio — mismas reglas de Playbook que cualquier otra jugada, sin garantía de acierto por ser "la jugada del último tiro".',
  });

  // === Reglas de situación (DESIGN.md 7.12.24) ===========================
  add({
    id: 'autoTimeouts',
    category: 'situationConcept',
    label: 'Auto Timeouts',
    what: 'El asistente pide tiempo muerto automáticamente por ti en la primera parada de juego disponible, sin abrir la ventana de intervención cada vez.',
    goal: 'Poder jugar más rápido sin perder la reacción táctica básica a un parcial rival.',
    engineEffect: 'Activado, dispara un tiempo muerto real (con las mismas reglas FIBA de CONFIG que uno pedido a mano) en cuanto el rival encadena un parcial de puntos sin respuesta propia (umbral configurable). Desactivado por defecto para TODO equipo, incluidos los gestionados por la CPU.',
    risks: 'Un tiempo muerto NUNCA aplica un bonus mágico de acierto ni resetea la racha del rival — solo habilita los mismos ajustes disponibles pidiéndolo a mano.',
  });
  add({
    id: 'tacticalFoul',
    category: 'situationConcept',
    label: 'Falta táctica intencionada',
    what: 'Cometer falta a propósito para detener el reloj cuando se va perdiendo por poco margen y con poco tiempo restante.',
    goal: 'Maximizar las posesiones restantes propias cuando perder tiempo sin hacer nada sería más perjudicial que conceder tiros libres.',
    engineEffect: 'Se evalúa SOLO en el último período regular o en prórroga, comparando el margen de puntos y los segundos restantes configurados contra el estado real del partido. El objetivo de la falta es siempre el rival EN PISTA con peor Tiro Libre (no de toda la plantilla), y un jugador propio con 4 faltas personales nunca es quien la comete si existe alternativa razonable. La CPU usa exactamente esta misma regla cuando la tiene activada.',
    risks: 'Mal calibrado (margen/segundos poco realistas), puede activarse demasiado pronto o demasiado tarde para tener sentido real.',
  });

  // === Valoraciones de quinteto (DESIGN.md 7.12.28) ======================
  add({
    id: 'creation',
    category: 'lineupRating',
    label: 'Creación',
    what: 'Capacidad del quinteto de generar juego para los demás mediante pase y visión.',
    goal: 'Medir cuánta creación real tiene el quinteto en pista, más allá de un solo jugador.',
    engineEffect: 'Media de los DOS mejores jugadores del quinteto (no los cinco) en Visión de Juego (40%)/Pase (35%)/Manejo de balón (25%) — se usa el promedio de los dos mejores porque lo que importa es tener a quién recurrir, no que los cinco sean creadores.',
    risks: 'Ninguno propio — es una valoración de aptitud de plantilla, se recalcula al cambiar un jugador.',
  });
  add({
    id: 'spacing',
    category: 'lineupRating',
    label: 'Spacing (quinteto)',
    what: 'Cuánto espacio real generan estos cinco jugadores concretos en pista, más allá del spacing declarado por el equipo.',
    goal: 'Mostrar el spacing efectivo real de ESTE quinteto, no una etiqueta genérica.',
    engineEffect: 'Es literalmente el mismo cálculo de effectiveSpacing (spacing declarado cruzado con la amenaza de tiro real del quinteto) que ya modula el AdvantageState de Pick & Roll/Isolation/Post Up y el efecto de las zonas defensivas, no un cálculo nuevo solo para mostrar en pantalla.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'outsideShooting',
    category: 'lineupRating',
    label: 'Tiro exterior (quinteto)',
    what: 'Amenaza media de tiro exterior de los cinco jugadores en pista.',
    goal: 'Medir cuánto respeto de tiro exterior genera el quinteto en su conjunto.',
    engineEffect: 'Media simple de Tiro exterior de los cinco (sin ponderar por posición ni por los dos mejores, a diferencia de Creación/Finalización interior).',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'insideFinishing',
    category: 'lineupRating',
    label: 'Finalización interior',
    what: 'Capacidad del quinteto de anotar cerca del aro.',
    goal: 'Medir la amenaza real de finalización interior del quinteto, no solo de un especialista.',
    engineEffect: 'Media de los DOS mejores jugadores en Tiro interior/Bandeja (50%/50%) — mismo criterio de "los dos mejores" que Creación.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'offensiveRebound',
    category: 'lineupRating',
    label: 'Rebote ofensivo (quinteto)',
    what: 'Capacidad del quinteto de capturar rebotes ofensivos.',
    goal: 'Medir cuánta segunda oportunidad de tiro genera el quinteto.',
    engineEffect: 'Media simple de Rebote ofensivo de los cinco jugadores en pista.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'defensiveRebound',
    category: 'lineupRating',
    label: 'Rebote defensivo (quinteto)',
    what: 'Capacidad del quinteto de capturar rebotes defensivos.',
    goal: 'Medir cuánto evita el quinteto las segundas oportunidades del rival.',
    engineEffect: 'Media simple de Rebote defensivo de los cinco jugadores en pista.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'switchability',
    category: 'lineupRating',
    label: 'Switchability',
    what: 'Cuánto puede este quinteto cambiar asignaciones (switch) en el bloqueo directo sin generar un mismatch explotable.',
    goal: 'Medir si el equipo puede jugar Switch como cobertura de Pick & Roll sin sufrir por ello.',
    engineEffect: 'Media de Defensa perimetral (35%)/Defensa interior (35%)/Agilidad (30%) de los cinco — la misma combinación de cualidades que hace que, tras un Switch real en una posesión, el defensor que queda emparejado con el rival equivocado NO sea un mismatch grave.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'rimProtection',
    category: 'lineupRating',
    label: 'Rim Protection',
    what: 'Capacidad del quinteto de proteger el aro.',
    goal: 'Medir cuánto tapón/disuasión real aporta el quinteto cerca de la canasta.',
    engineEffect: 'Media de Tapón (40%)/Defensa interior (40%)/Salto (20%) de los cinco — misma mezcla que usa el rol defensivo Rim Protector.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'transitionDefense',
    category: 'lineupRating',
    label: 'Transition Defense',
    what: 'Cuán bien se repliega el quinteto tras perder el balón, para evitar canastas fáciles en contraataque rival.',
    goal: 'Medir la disciplina de repliegue del quinteto, no solo su atletismo individual.',
    engineEffect: 'Reutiliza LITERALMENTE la misma mezcla (Velocidad punta/Ética de trabajo/Posicionamiento) que el ajuste real de transición defensiva dentro de la ventana de contraataque del motor — no es una aproximación distinta solo para mostrar en pantalla.',
    risks: 'Aproximación por atletismo agregado del quinteto: el motor no distingue por jugador quién cargó el rebote ofensivo frente a quién se replegó.',
  });
  add({
    id: 'transitionOffense',
    category: 'lineupRating',
    label: 'Transition Offense',
    what: 'Capacidad del quinteto de correr y finalizar en contraataque.',
    goal: 'Medir la amenaza real del equipo cuando ataca antes de que la defensa rival se coloque.',
    engineEffect: 'Media de Aceleración (35%)/Velocidad punta (25%)/Visión de Juego (20%)/Bandeja (20%) de los cinco — es una valoración de APTITUD de plantilla (se recalcula al cambiar un jugador), no telemetría de partidos jugados.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'poaDefense',
    category: 'lineupRating',
    label: 'POA Defense',
    what: 'Capacidad del quinteto de contener al manejador principal rival.',
    goal: 'Medir la fiabilidad defensiva sobre el balón del quinteto.',
    engineEffect: 'Reutiliza LITERALMENTE la misma mezcla que el rol defensivo POA Stopper (Defensa perimetral/Agilidad/Anticipación/Robo) — no es un cálculo nuevo, es exactamente lo que ese rol ya mide, aplicado a los cinco jugadores en pista.',
    risks: 'Ninguno propio.',
  });
  add({
    id: 'tacticalExecution',
    category: 'lineupRating',
    label: 'Tactical Execution',
    what: 'Cuán bien ejecutaría este quinteto la táctica declarada, en una foto en reposo sin ninguna jugada concreta elegida.',
    goal: 'Anticipar, antes de jugar, cuánta Familiaridad Táctica real y qué mezcla de atributos colectivos tiene el equipo.',
    engineEffect: 'Reutiliza LITERALMENTE el mismo cálculo de ejecución táctica que se aplica posesión a posesión durante un partido real, con complejidad 0 — combina la Familiaridad Táctica media del equipo (ofensiva+defensiva), la mezcla de Trabajo en equipo/Concentración/Posicionamiento/Visión de Juego/Decisión bajo presión, la Energía actual y la Experiencia de los cinco, modulado por el eje Rigidez ↔ Read & React.',
    risks: 'Un valor bajo aquí (por poca Familiaridad Táctica, no por talento) se traduce en el partido real como pérdidas de sistema, lecturas degradadas y errores de ayuda/switch — nunca como una penalización plana a los atributos individuales.',
  });

  // === Data Hub / informe de rival (DESIGN.md 7.12.27) ===================
  add({
    id: 'ppp',
    category: 'dataHub',
    label: 'PPP (Puntos Por Posesión)',
    what: 'Puntos anotados de media cada vez que el equipo (o una jugada/cobertura concreta) tiene la posesión del balón.',
    goal: 'Medir eficiencia real por oportunidad, no solo puntos totales — un equipo puede anotar mucho simplemente por jugar más posesiones.',
    engineEffect: 'Se calcula dividiendo los puntos reales anotados entre las posesiones reales registradas en la telemetría del Data Hub para cada play-type/cobertura, acumulada posesión a posesión durante los partidos jugados.',
    risks: 'Con pocas posesiones registradas, el PPP puede ser engañoso — por eso lleva el aviso de "muestra pequeña" cuando no alcanza el mínimo fiable.',
  });
  add({
    id: 'offensiveRating',
    category: 'dataHub',
    label: 'ORtg (Offensive Rating)',
    what: 'Puntos anotados por cada 100 posesiones ofensivas de un quinteto concreto.',
    goal: 'Comparar la producción ofensiva de distintos quintetos en una escala común, independiente de cuántas posesiones haya jugado cada uno.',
    engineEffect: 'Aproximado a partir de los puntos y posesiones ofensivas reales acumuladas por ese quinteto en la telemetría, escalado a 100 posesiones.',
    risks: 'Aproximado (no una fórmula NBA-style completa con todos los matices); sujeto al mismo aviso de muestra pequeña que el resto de la telemetría.',
  });
  add({
    id: 'defensiveRating',
    category: 'dataHub',
    label: 'DRtg (Defensive Rating)',
    what: 'Puntos concedidos por cada 100 posesiones defensivas de un quinteto concreto.',
    goal: 'Comparar la solidez defensiva de distintos quintetos en una escala común.',
    engineEffect: 'Misma aproximación que ORtg pero con los puntos concedidos y posesiones defensivas reales de ese quinteto.',
    risks: 'Mismas limitaciones que ORtg: aproximado, y con el mismo aviso de muestra pequeña.',
  });
  add({
    id: 'netRating',
    category: 'dataHub',
    label: 'Net Rating',
    what: 'Diferencia entre ORtg y DRtg de un quinteto: cuántos puntos de media saca (o cede) ese quinteto cada 100 posesiones.',
    goal: 'Resumir en un solo número si un quinteto concreto rinde mejor o peor que el rival cuando está en pista.',
    engineEffect: 'Resta directa de ORtg menos DRtg del mismo quinteto, ambos ya aproximados a partir de la telemetría real.',
    risks: 'Hereda las limitaciones de ambos: aproximado y sujeto a muestra pequeña.',
  });
  add({
    id: 'smallSample',
    category: 'dataHub',
    label: 'Muestra pequeña',
    what: 'Aviso de que el dato mostrado viene de muy pocos partidos o posesiones registradas todavía.',
    goal: 'Evitar que el usuario tome un dato puntual (por ejemplo, 2 posesiones con 1.50 PPP) como una tendencia táctica estable del rival.',
    engineEffect: 'Se activa cuando el número de partidos/posesiones registradas contra ese rival está por debajo de los mínimos de CONFIG (3 partidos/15 posesiones por defecto) — umbrales propios de diseño, no un intervalo de confianza estadístico riguroso.',
    risks: 'Ninguno propio — es precisamente el aviso que evita sacar conclusiones prematuras.',
  });

  // === Conceptos generales ================================================
  add({
    id: 'familiarity',
    category: 'concept',
    label: 'Familiaridad Táctica',
    what: 'Cuánto domina el equipo, en la práctica, la táctica que el usuario ha declarado — no es lo mismo declarar un sistema que ejecutarlo bien desde el primer partido.',
    goal: 'Reflejar que un sistema nuevo (o un rol/cobertura recién estrenados) se ejecuta peor al principio y mejora con partidos reales, sin inventar una curva de entrenamiento aparte.',
    engineEffect: 'Estado dinámico y persistente, separado de los atributos del jugador: sube posesión a posesión mientras se juega con ese sistema/familia de jugada/cobertura/rol (con rendimientos decrecientes hacia un techo de 100, más lento cuanto más compleja sea la jugada) y se resetea a un valor bajo cuando el rol de un jugador cambia de un partido a otro. Alimenta directamente la Ejecución Táctica (errores de sistema, lecturas degradadas, errores de ayuda/switch) — nunca se edita a mano, solo se observa.',
    risks: 'Cambiar de sistema, de coberturas o de roles con mucha frecuencia mantiene la Familiaridad baja de forma permanente, aunque los jugadores sean buenos — el coste es de ejecución colectiva, no de talento individual.',
  });
  add({
    id: 'roleFitStars',
    category: 'concept',
    label: 'Estrellas de encaje (roleFit)',
    what: 'Valoración en estrellas (1 a 5) de cuánto encaja un jugador concreto en un rol ofensivo o defensivo concreto.',
    goal: 'Ayudar a elegir rol sin tener que leer las puntuaciones internas de atributos.',
    engineEffect: 'Combina la mezcla de atributos propia del rol (70%) con la competencia posicional real del jugador (30%, la mejor de las posiciones asociadas al rol) y un pequeño ajuste por Energía actual, y convierte el resultado (escala 1-20) a estrellas por tramos: 1-6 → 1★, 7-10 → 2★, 11-14 → 3★, 15-17 → 4★, 18-20 → 5★.',
    risks: 'Ninguno propio — es una ayuda visual derivada; el motor de partido nunca usa las estrellas directamente, solo la puntuación numérica de la que salen.',
  });
  add({
    id: 'matchupOverride',
    category: 'concept',
    label: 'Matchups individuales',
    what: 'Asignar a un defensor propio la marca fija de un jugador rival concreto, en vez de dejar que el motor elija automáticamente cada vez.',
    goal: 'Poder decidir, por ejemplo, que tu mejor defensor perimetral se quede siempre con la estrella anotadora rival.',
    engineEffect: 'Tiene prioridad sobre la elección automática del motor para ese jugador rival concreto, salvo que una cobertura o rotación defensiva (Switch, doble equipo de poste...) obligue temporalmente a otro emparejamiento — esas excepciones representan precisamente el caso real en el que un cambio de asignación está justificado. Se declara por jugador real, así que solo tiene efecto los partidos en los que ese rival concreto aparezca en pista.',
    risks: 'No protege de un cambio forzado por una cobertura defensiva activa (Switch, doble equipo) — el matchup se recupera en cuanto la rotación termina, no está garantizado posesión a posesión.',
  });

  function getHelp(id) { return ENTRIES[id] || null; }
  function listEntries() { return Object.keys(ENTRIES).map((id) => ENTRIES[id]); }
  function listByCategory() {
    return CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABELS[category] || category,
      entries: listEntries().filter((e) => e.category === category),
    })).filter((group) => group.entries.length > 0);
  }

  const exportsObj = {
    CATEGORY_LABELS, CATEGORY_ORDER, ENTRIES, getHelp, listEntries, listByCategory,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    global.BasketManager.TacticsHelp = exportsObj;
  }
})(typeof window !== 'undefined' ? window : globalThis);
