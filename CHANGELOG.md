# CHANGELOG.md

## 2026-08-14

- Estructura inicial del proyecto: `DESIGN.md`, `CLAUDE.md`, carpetas de
  `data/` y `src/`, `index.html` placeholder y este `CHANGELOG.md`.

## 2026-08-15

- Entidad `Player` (`src/entities/Player.js`): ficha de jugador completa
  según DESIGN.md 6.1 — datos básicos, atributos Técnicos/Físicos/Mentales
  (escala 1-20), rasgos, experiencia (solo crece), atributos ocultos
  (Potencial, Profesionalidad, Ambición) y estados dinámicos (Energía,
  Ritmo de competición, Racha/momento anímico).
- Generador de jugadores ficticios (`src/utils/playerGenerator.js`): crea
  jugadores aleatorios con atributos coherentes según posición (ej. Base
  con más Pase/Manejo de balón, Pívot con más Rebote/Tapón), para probar
  el motor sin depender todavía de la base de datos real.
- Sección de prueba temporal en `index.html` que genera 3 jugadores
  ficticios al cargar la página y muestra sus datos en pantalla y consola
  (se quitará cuando exista una pantalla real de plantilla/roster).
- Entidad `Team` (`src/entities/Team.js`): ficha de equipo completa según
  DESIGN.md 6.2 — datos básicos (con estadio como referencia aún
  placeholder), plantilla con convocatoria validada (8-12 jugadores),
  reputación (deportiva/financiera/cantera), las 7 instalaciones (nivel
  1-20, mantenimiento anual, flag de obsolescencia), generación de
  cantera/academia (3 jóvenes reutilizando el generador de jugadores),
  junta/propietario (paciencia, objetivos, plan plurianual), afición,
  el desglose completo de ingresos/gastos de 6.2.6, ADN de club,
  rivalidades (fijas y dinámicas) e historial/leyendas de club.
- Generador de equipos ficticios (`src/utils/teamGenerator.js`): crea
  equipos completos de ejemplo, con plantilla generada reutilizando
  `playerGenerator.js`.
- `playerGenerator.js` ahora acepta un rango de edad opcional
  (`minAge`/`maxAge`), usado por `Team.generateAcademyIntake()` para
  generar jugadores jóvenes de cantera.
- Sección de prueba temporal en `index.html` que genera 2 equipos
  ficticios y muestra un resumen (nombre, ciudad, reputación,
  instalaciones y plantilla).

## 2026-08-16

- `Player` (`src/entities/Player.js`): añadidos los **Datos Físicos
  Corporales** de DESIGN.md 6.1 — Altura, Envergadura y Peso (medidas
  reales en cm/kg, distintas de los Atributos Físicos en escala 1-20).
  Confirmado que `insideShot` (tiro interior) y `layup` (bandeja) ya
  eran campos separados, tal como exige DESIGN.md.
- `playerGenerator.js`: genera Altura/Peso con rangos realistas según
  posición (interpolados entre Base 178-195cm y Pívot 195-215cm, con
  solape deliberado entre posiciones vecinas) y Envergadura como la
  altura más una variación aleatoria mayoritariamente positiva —
  aproximación de diseño documentada en el código, no validada aún con
  Dennis en sus valores exactos.
- `Team` (`src/entities/Team.js`): pasada de verificación completa
  contra DESIGN.md 6.2 (6.2.1 a 6.2.10) — no se encontraron campos
  ausentes. Se añadió el comentario de asignación factor→componente de
  Reputación (deportiva/financiera/cantera) aclarado en 6.2.1, y una
  nota documentando que el ADN de Club todavía no sesga la generación
  de la Cantera/Academia (pendiente, ver resumen de la sesión).
- `index.html`: la prueba de jugadores ahora muestra también
  Altura/Envergadura/Peso.
- **Motor de simulación de partidos — Fase 1** (DESIGN.md sección 7):
  - `src/entities/Player.js`: añadidos `perimeterDefense` (defensa
    perimetral) e `interiorDefense` (defensa interior) como nuevos
    Atributos Técnicos — DESIGN.md 7.6 los usaba en 6 de las 10 acciones
    del Bloque A pero no existían en la ficha de 6.1; confirmado con
    Dennis, añadidos también al generador (rangos coherentes por
    posición) y documentados en DESIGN.md 6.1.
  - `src/core/MatchConfig.js` (nuevo): `CONFIG_BASE` como entidad propia
    (7.2) — duración de partido, reloj de posesión 24s/14s, interceptos
    base por tipo de tiro (7.3-bis), y la mezcla de atributos
    ofensiva/defensiva, pesos y método de combinación (resta o cociente)
    de las 10 acciones del Bloque A y los 3 caminos del Bloque B (7.6).
    Hueco vacío para un futuro `CONFIG_MODIFIERS_NBA`, sin rellenar.
  - `src/core/MatchEngine.js` (nuevo): bucle de posesión basado en el
    reloj real (no un número fijo de posesiones), con las 10 acciones del
    Bloque A (Triple, Media distancia, Tiro interior, Bandeja, Tiro
    libre, Pérdida de balón, Robo, Rebote, Tapón, Lucha por balón suelto)
    y los 3 caminos del Bloque B (Falta defensiva con bonus, Falta en
    tiro con sus 3 variantes, Violación de reloj), todo leído desde
    MatchConfig. Selección de quinteto en pista con un placeholder simple
    (titulares con más cuota que banquillo), sin rotaciones/tácticas
    reales. Devuelve marcador final, marcador por cuartos y box score
    básico por jugador. Bloque C, sistemas transversales (Presión de
    Momento, Consistencia/Fatiga, modificador de Altura/Envergadura/Peso),
    eventos destacados, factor cancha y racha quedan fuera de esta fase.
  - `index.html`: nueva sección de prueba que simula un partido completo
    entre 2 equipos ficticios y muestra marcador, cuartos y máximos
    anotadores.
- **Motor de simulación de partidos — Fase 2** (DESIGN.md sección 7):
  - `src/entities/Player.js`: sin cambios de esquema.
  - `src/core/MatchConfig.js`: añadidos los parámetros de Altura/
    Envergadura/Peso (7.4: umbral del Eje 2 ~2.05-2.10m, magnitudes de
    los bonos/impuestos), Presión de Momento (7.5), Consistencia y
    Fatiga (7.5-bis), y todo el Bloque C (7.6: contraataque, ritmo de
    posesión ligado a ADN de Club, últimos segundos, parcial de
    anotación, falta técnica). Cada acción de Bloque A/B ya existente
    lleva ahora las banderas `heightAxis1`/`heightAxis2` que le
    correspondan según 7.4.
  - `src/core/MatchEngine.js`: integra los 3 sistemas transversales en
    el cálculo de cada acción (mezcla de atributos con Fatiga aplicada,
    reponderación de mentales + bonus de Experiencia acotado bajo
    Presión, ruido de Consistencia sobre la probabilidad final) y el
    Bloque C completo dentro del bucle de posesión: contraataque (con
    una ventana de reloj más corta y realista tras detectar el problema
    de que el suelo de 3s del paso normal casi nunca solapaba con la
    ventana de contraataque), tapón con mate y tiro sobre bocina
    marcados como flags para la futura Fase 3 (sin sistema de
    notabilidad todavía), últimos segundos sin jugada completa, parcial
    de anotación (modificador de equipo simplificado, no
    `dynamicState.momentum` individual — decisión documentada en el
    código) y falta técnica (solo la probabilidad, sin escalado a
    expulsión, tal como marca DESIGN.md como pendiente).
  - Calibración: el consumo de energía por fatiga se ajustó a la baja
    tras comprobar que los titulares llegaban a 0 antes de acabar el
    partido; la probabilidad de "rebote largo" (contraataque) también
    se ajustó a la baja tras comprobar que casi la mitad de las
    posesiones quedaban elegibles para contraataque, acelerando el
    ritmo del partido muy por encima de lo esperado.
  - `index.html`: la prueba de partido ahora muestra también la energía
    final de los titulares (para verificar que la Fatiga sube con los
    minutos) y un resumen del log de eventos del Bloque C detectados
    durante la simulación (contraataques, tapones con mate, tiros sobre
    bocina, faltas técnicas...).
- **Corrección de ritmo de posesión + Prórroga** (DESIGN.md 7.1 corregida
  y 7.10 nueva):
  - `src/core/MatchConfig.js`/`MatchEngine.js`: DESIGN.md 7.1 tenía un
    error aritmético (la duración media de posesión se calculaba
    dividiendo el partido entre las posesiones de UN equipo, cuando hay
    que dividir entre las de LOS DOS combinados) — la cifra correcta es
    ~14-15s de media, no ~29-30s. Se subió el rango del "paso" de
    posesión normal (`tempo.stepMinSeconds`/`stepBaseMaxSeconds`, antes
    3-18s, ahora 8-26s) hasta que el número de posesiones por equipo y
    partido rondó las 82-83 reales.
  - Los interceptos de Tiro interior y Bandeja se subieron de 0.58 a
    0.65 (el ~58% "puro" de 7.3-bis se quedaba en ~49-53% real de
    partido una vez restado el efecto acumulado de Tapón y Fatiga a lo
    largo del partido).
  - **Cifras finales verificadas por simulación (40 partidos)**:
    posesiones ~85/equipo, marcador ~88 pts/equipo (antes ~128), Triple
    34%, Media 41%, Interior 60.5%, Bandeja 57.2%, Tiro libre 78% — todo
    dentro de rango realista ACB/Euroliga, sin errores de consistencia
    interna (cuartos y box score cuadran con el marcador) en ningún
    partido, y ninguno terminó empatado.
  - `Team`/`Player`: sin cambios de esquema.
  - **Prórroga (7.10, nueva)**: si el marcador está empatado al final
    del 4º cuarto, se juegan prórrogas de 5 minutos (`match.
    overtimeMinutes`) hasta desempatar — verificado con 40 partidos: 2
    llegaron a prórroga, ninguno terminó en empate. Las faltas de
    equipo se resetean en cada prórroga igual que en cada cuarto; las
    faltas personales de cada jugador NO se resetean entre períodos
    (nunca lo hicieron: `boxScore` es el mismo `Map` durante todo el
    partido, solo se reinicia `teamFouls`). `quarterScores` ahora puede
    tener más de 4 posiciones si hay prórroga.
  - Nuevos campos en el resultado de `simulateMatch`: `possessionCount`
    (posesiones por equipo, útil para verificar el ritmo), `wentToOvertime`
    y `overtimePeriods`.
  - `index.html`: la prueba de partido muestra ahora las posesiones por
    equipo y, si hubo prórroga, cuántas.
  - **Confirmado** (sin cambio de código): la implementación del Eje 2
    (7.4) ya restaba el impuesto físico sobre el rating compuesto final
    del lado marcado, no sobre un atributo suelto de Agilidad — coincide
    con la aclaración añadida a DESIGN.md 7.4 tras esta sesión.
- **Herramienta de prueba de estrés del motor** (diagnóstico/depuración,
  no parte del juego):
  - `src/utils/playerGenerator.js`: `generateFictionalPlayer()` acepta un
    `options.attributeRange` opcional ({min,max} en escala 1-20) que
    comprime los atributos Técnicos/Físicos/Mentales generados dentro de
    ese rango (perfiles por posición reescalados proporcionalmente, para
    que un rango estrecho no empuje los valores fuera de él) — usado para
    generar equipos "sesgados" (súper/flojo) de prueba, sin tocar el
    comportamiento por defecto.
  - `src/utils/teamGenerator.js`: `generateFictionalTeam()` acepta ahora
    `options.playerOptions`, pasado tal cual a la generación de plantilla.
  - `src/utils/skewedTeamGenerator.js` (nuevo): `generateSkewedTeam(range)`,
    envoltorio fino sobre `generateFictionalTeam` para generar equipos
    "sesgados".
  - `src/entities/Team.js`: nuevo método
    `buildMatchSquadExcludingPosition(position)` — construye la
    convocatoria (reutilizando la validación 8-12 de `buildMatchSquad`)
    excluyendo a los jugadores cuya ÚNICA posición (o todas sus
    posiciones) sea la indicada; lanza un error descriptivo si quedan
    menos de 8 elegibles. Genérico por posición.
  - `src/core/MatchEngine.js`: `simulateMatch()` acepta un `options`
    opcional (`homeSquad`/`awaySquad`) para poder simular con una
    convocatoria ya construida (ej. la de `buildMatchSquadExcludingPosition`)
    en vez de la convocatoria por defecto — retrocompatible.
  - `index.html`: nueva sección "Pruebas de estrés del motor", separada de
    las demás, con dos botones que simulan 30 partidos cada uno
    (alternando local/visitante 15/15, regenerando equipos frescos en
    cada partido para no arrastrar Fatiga acumulada entre partidos, ya
    que la recuperación entre partidos todavía no existe): súper equipo
    (16-20) vs flojo (3-8), y equipo fuerte sin pívots (14-19) vs equipo
    normal, este último con un desglose diagnóstico agregado (rebotes,
    tapones, % de tiro interior/bandeja permitido al rival).
  - **Resultados observados (30 partidos cada prueba)**: el súper equipo
    ganó el 100% de las veces (diferencia media +110 pts) y el equipo
    fuerte sin pívots TAMBIÉN ganó el 100% de las veces (diferencia media
    +54 pts) pese a la exclusión — el desglose diagnóstico sí muestra la
    grieta esperada (equipo normal tira ~50% en interior/bandeja contra la
    defensa sin pívots, frente a un ~70% del propio equipo fuerte, y saca
    más rebotes defensivos de forma desproporcionada), pero la brecha de
    atributos (14-19 vs ~10 de base) es demasiado grande para que la
    ausencia de una sola posición cambie el resultado. Cero sorpresas en
    60 partidos combinados — señalado explícitamente para que se valore
    si el motor necesita más variables antes de decidir si es o no un
    problema de calibración.
- **Entidad Liga y Calendario — Fase 1** (DESIGN.md 3.1, nueva): solo 1ª
  división, sin playoffs/ascensos/descensos/Copa todavía (ver
  "Pendiente" en DESIGN.md 3.1).
  - `src/core/League.js` (nuevo):
    - Generación de calendario con el algoritmo del círculo
      (round-robin estándar) para 18 equipos: 34 jornadas (17 ida + 17
      vuelta), cada equipo juega exactamente una vez por jornada.
      Verificado por simulación: 306 partidos totales, cada pareja de
      equipos se enfrenta exactamente 2 veces (una en cada campo).
    - `League.simulateNextRound()`: simula de golpe todos los partidos
      pendientes de la jornada actual (reutilizando
      `MatchEngine.simulateMatch`), actualiza la clasificación y avanza
      el puntero de jornada. Lanza un error descriptivo si se intenta
      simular más allá de la jornada 34.
    - Clasificación con puntuación real FIBA/ACB (2 puntos victoria, 1
      derrota, no el 3-1-0 de fútbol), actualizada automáticamente tras
      cada partido: jugados, victorias, derrotas, puntos a favor/en
      contra, diferencia, y la suma de cocientes PF/PA por partido
      (necesaria para el paso 5 del desempate).
    - Criterio de desempate completo de 5 pasos (DESIGN.md 3.1): balance
      mutuo, diferencia mutua, diferencia general, puntos anotados
      generales, suma de cocientes generales — implementado de forma
      recursiva para que los empates de 3+ equipos se resuelvan como
      mini-liga (pasos 1-2 restringidos a los enfrentamientos mutuos del
      subgrupo que sigue empatado en cada momento) y, si tras los 5
      pasos un subgrupo sigue empatado, se reinicie el proceso desde el
      paso 1 para ese subgrupo más pequeño. Con una guarda de seguridad
      para el caso extremo (no debería ocurrir en la práctica) de un
      empate genuinamente irresoluble con estos criterios, para no
      entrar en bucle infinito.
    - **Verificado con escenarios fabricados a mano** (no solo con
      partidos aleatorios): un equipo que gana el enfrentamiento directo
      queda por delante pese a tener peor diferencia general de puntos
      (pasos 1-2 priman sobre el 3); un empate a 3 con balance mutuo
      también empatado (1-1 cada uno) se resuelve correctamente por
      diferencia de puntos mutua (paso 2).
  - `index.html`: nueva sección de prueba que genera una Liga de 18
    equipos ficticios al cargar la página, con un botón para simular la
    siguiente jornada (muestra resultados + clasificación actualizada) y
    otro para simular la temporada completa de golpe (34 jornadas, ~1s).
    Verificado que intentar simular más allá de la jornada 34 se
    gestiona sin error visible (aviso de "temporada completa").
  - `CHANGELOG.md` actualizado (esta entrada).

- **Relación bidireccional Player↔Team**. Cambio pequeño y acotado de
  integridad de datos, sin afectar a ninguna regla de DESIGN.md (calendario,
  ascensos/descensos, etc.).
  - `src/entities/Player.js`: nuevo campo `teamId` (string o `null`) en el
    constructor, junto al resto de datos básicos. Por defecto `null`
    (jugador sin equipo). Incluido en `toJSON()`.
  - `src/entities/Team.js`: `this.roster` sigue guardando los objetos
    `Player` completos como hasta ahora; Team se encarga de mantener
    `player.teamId` sincronizado con su propio `this.id` en cada punto
    donde el roster cambia: `addPlayer()`, `removePlayer()` (lo deja en
    `null` al salir), `generateAcademyIntake()` (Cantera/Academia), y el
    propio constructor si recibe un `roster` ya poblado en `data` (por si
    viene de una fuente que no lo puso).
  - **Verificado con un script Node dedicado**: `addPlayer`/`removePlayer`
    dejan el `teamId` correcto, los canteranos de `generateAcademyIntake`
    salen con `teamId` ya asignado, un roster pasado directamente al
    constructor queda sincronizado, y los generadores existentes
    (`teamGenerator`, `skewedTeamGenerator`, `playerGenerator`) siguen
    funcionando sin romperse, con `teamId` bien puesto en todos los
    jugadores de sus rosters. También comprobado con Playwright headless
    que `index.html` sigue sin errores de consola tras el cambio.

- **Playoffs, Copa y Playoff de ascenso — Fase 2 de Liga/Calendario
  (DESIGN.md 3.2)**. Reutiliza `League.js` y `MatchEngine.js` tal cual,
  sin ninguna modificación.
  - `src/core/Bracket.js` (nuevo) — pieza genérica reutilizable, base de
    las tres competiciones:
    - `Series`: eliminatoria al mejor de N partidos entre dos equipos,
      con un patrón de campo configurable (`SINGLE_GAME`,
      `BEST_OF_3_1_1_1`, `BEST_OF_5_2_2_1`). Cada partido se simula de
      verdad con `MatchEngine.simulateMatch` (nunca en bloque);
      `playNextGame()` juega el siguiente partido pendiente respetando
      el patrón, y `isDecided`/`winner` detectan cuándo hay ganador.
      Un partido único es simplemente una serie al mejor de 1.
    - `Bracket`: encadena rondas de `Series` a partir de un conjunto de
      entradas semilladas (`{team, seed}`) y un emparejamiento de
      primera ronda, con avance **fijo** entre rondas — nunca se
      reordena por resultado, tal como exige DESIGN.md para playoffs y
      Copa. Cada entrada conserva su seed original de principio a fin,
      así que la ventaja de campo en cualquier ronda siempre recae en
      el mejor clasificado real, sin importar de qué lado del bracket
      venga el rival. `playNextGame()`/`getStatus()` exponen jugar el
      siguiente partido de todo el bracket y consultar el estado
      completo (marcador de cada serie, ronda actual, campeón).
  - `src/core/Playoffs.js` (nuevo): `createTitlePlayoff(league)`
    construye el playoff por el título de 1ª división a partir de una
    `League` con la temporada regular completa — top 8 de
    `getStandingsTable()`, bracket fijo 1v8/4v5/2v7/3v6 (orden de
    bracket estándar: el 1º y el 2º solo pueden cruzarse en la final),
    cuartos al mejor de 3 (1-1-1), semis y final al mejor de 5 (2-2-1).
  - `src/core/Cup.js` (nuevo): `createCup(league)` construye la Copa a
    partir de una `League` justo con la jornada 17 recién completada —
    top 8 de la clasificación en ESE momento, bracket fijo igual que el
    playoff pero todas las rondas a partido único. No toca el estado de
    la Liga: solo lee una foto de la clasificación; la Liga sigue
    avanzando con normalidad después (verificado que la clasificación y
    `currentRound` no cambian tras jugar la Copa, y que la jornada 18
    se simula con normalidad a continuación).
    **Nota de implementación señalada, no confirmada por Dennis:**
    DESIGN.md 3.2.2 no especifica quién es local en cada partido de
    Copa (a diferencia de los playoffs, donde sí lo dice explícitamente)
    — se ha asumido que el mejor clasificado en ese momento hace de
    local, por coherencia con el resto de 3.2.
  - `src/core/Promotion.js` (nuevo): 2ª división ficticia mínima (18
    equipos con el generador ya existente + su propia instancia de
    `League`, solo como infraestructura para alimentar el playoff, no
    un modo de juego). `PromotionPlayoff`: el 1º de la liga regular
    asciende directo (dato simple); los clasificados 2º-9º juegan
    cuartos (bracket fijo, al mejor de 5, patrón 2-2-1: 2v9/3v8/4v7/5v6)
    y una Final Four cuyas semifinales se REORDENAN por la
    clasificación regular ORIGINAL de los 4 ganadores de cuartos (mejor
    de los 4 vs peor de los 4, los dos intermedios entre sí) — no por
    posición de bracket, la única excepción explícita de DESIGN.md 3.2
    a la regla de bracket fijo. El campeón de la Final Four es el 2º
    equipo ascendido; de momento solo se puede consultar (sin lógica de
    temporada siguiente).
  - **Verificado con un script Node dedicado**: orden de bracket
    correcto (1v8 y 4v5 en la misma mitad, 2v7 y 3v6 en la otra, para
    que el 1º y el 2º solo se crucen en la final), el local de cada
    partido de la serie sigue siempre el patrón de campo declarado, la
    Copa no altera la clasificación ni el `currentRound` de la Liga, y
    el cruce de semifinal de la Final Four de ascenso queda reordenado
    por seed original y no por posición de bracket de cuartos.
  - `index.html`: nueva sección de prueba ("Playoffs, Copa y Playoff de
    ascenso") separada de las anteriores. Un botón genera y simula una
    Liga de 1ª división completa (dispara la Copa en la jornada 17 de
    esa misma liga sin alterarla, y arma el playoff por el título al
    terminar la temporada), con botones para jugar el playoff y la Copa
    partido a partido o de una vez, mostrando el bracket completo y los
    marcadores de cada serie en vivo. Otro botón genera y simula la 2ª
    división ficticia completa y arma el playoff de ascenso, con
    botones equivalentes que muestran cuartos, Final Four y quién
    asciende al terminar. Verificado con Playwright headless (`file://`,
    sin servidor): cero errores de consola tras generar/jugar las tres
    competiciones de principio a fin.
  - `CHANGELOG.md` actualizado (esta entrada).

- **Primera base de datos real: ACB + Primera FEB (36 equipos, 405
  jugadores)** — ver DESIGN.md sección 2 y 6 ("datos reales de
  jugadores/clubes") y CLAUDE.md (misma sección).
  - `scripts/import-real-data.js` (nuevo, script de utilidad Node — no
    forma parte del arranque del juego): parsea los dos ficheros de
    origen (`data/real/sources/equipos_acb_y_feb.txt` y
    `todos_los_jugadores_acb_y_feb.txt`, texto con separadores de sección
    y bloques JSON de un objeto cada uno), instancia cada jugador y
    equipo con los constructores REALES de `Player.js`/`Team.js` (no
    objetos planos, para heredar toda su validación: posiciones,
    división, clamps de atributos 1-20...), y guarda el resultado en
    `data/real/`: un fichero por equipo (`data/real/teams/<id>.json`) y
    un índice (`data/real/index.json`).
  - **18 equipos ACB (1ª) + 18 Primera FEB (2ª), 405 jugadores reales**
    con atributos estimados a partir de datasets de mercado de la
    competición (`dataSource.type: "estimated"`, con su nivel de
    confianza). 4 equipos de 2ª división llegaban con la plantilla
    incompleta en el dataset importado (menos de los 8 mínimos de
    convocatoria — `Bueno Arenas Albacete Basket`, `Flexicar
    Fuenlabrada`, `Caja Rural CB Zamora`, `Palmer Basket Mallorca
    Palma`): se completaron hasta 8 con jugadores ficticios del
    generador ya existente (nombres ficticios de verdad, nunca nombres
    que parezcan reales), cubriendo primero cualquier posición que
    faltase del todo en la plantilla real y marcados explícitamente con
    `dataSource.type: "placeholder"` para que quede clara la diferencia
    — 9 jugadores placeholder en total, ninguno en el resto de equipos.
  - Comprobación de integridad pedida explícitamente: el `teamId` que ya
    traía cada jugador en el JSON de origen se compara contra el equipo
    que lo referencia por `playerIds` ANTES de construir el `Team`, para
    avisar de inconsistencias en vez de sobrescribirlas en silencio — en
    esta importación no se encontró ninguna.
  - `src/utils/playerGenerator.js`: pequeño añadido (no rompe compatibilidad,
    ningún llamante existente lo usaba) — `generateFictionalPlayer()`
    acepta ahora `options.positions` para forzar la posición del
    jugador generado en vez de sortearla, necesario para completar de
    forma dirigida las posiciones que faltasen en una plantilla
    incompleta.
  - `data/real/real-data-bundle.js` (nuevo, generado automáticamente por
    el script de importación, no editar a mano): mismos datos que los
    JSON de `data/real/`, pero cargables con un `<script>` normal en vez
    de `fetch()` — comprobado que `fetch()` de un JSON local falla por
    CORS cuando `index.html` se abre con `file://` (la forma habitual de
    probar este proyecto, ver CLAUDE.md), así que sin este bundle la
    nueva sección de prueba no funcionaría fuera de un servidor.
  - **`Player.js` NO se ha tocado**: el campo `dataSource` se conserva
    como propiedad añadida después de instanciar cada `Player` (no
    dentro del constructor). **Pendiente de decidir con Dennis**: si se
    formaliza como campo propio de la ficha de jugador (constructor +
    `toJSON()`) o se queda solo como metadato de origen de los datos
    importados — no se ha tomado esa decisión aquí.
  - `index.html`: nueva sección de prueba ("Liga real de 1ª división
    (ACB) con datos importados") que carga los 18 equipos reales de 1ª
    división desde `data/real/` (vía el bundle, reconstruyendo instancias
    reales de `Player`/`Team`), arma una `League` real y permite
    simular jornada a jornada o la temporada completa, igual que ya
    podía hacerse con equipos ficticios.
  - **Verificado con un script Node dedicado** (releyendo desde disco,
    no solo confiando en la ejecución del propio importador): los 36
    equipos cargan sin errores de constructor, los 4 equipos parcheados
    tienen exactamente 8 jugadores, ningún equipo fuera de esos 4 tiene
    ningún jugador `placeholder`, los 405 jugadores reales conservan su
    `dataSource` de origen, y la Liga real de 1ª división simula al
    menos una jornada sin errores. También verificado con Playwright
    headless (`file://`, sin servidor) que la nueva sección de
    `index.html` genera la liga, simula jornadas y la temporada completa
    sin errores de consola.
  - `CHANGELOG.md` actualizado (esta entrada). `DESIGN.md` no se ha
    tocado.

- **Reescalado proporcional de atributos de la base de datos real**
  (corrige que equipos top y modestos de 1ª división tuvieran un
  overall casi idéntico, dejando el resultado de los partidos casi
  todo al azar). Basado en `data/real/team_tiers.json` (tiers ya
  validados con Dennis, `targetTop8` por equipo). El motor de
  simulación (`MatchConfig.js`) **no se ha tocado** — cambio
  deliberadamente aislado a los datos.
  - `scripts/rescale-real-attributes.js` (nuevo): para cada uno de los
    36 equipos, calcula el overall de cada jugador (media simple de
    todos sus atributos de `technical`/`physical`/`mental` — `hidden` y
    `dynamicState` no participan ni se tocan), calcula el rating medio
    de sus 8 mejores jugadores, y aplica el factor
    `targetTop8 / top8_actual` MULTIPLICATIVAMENTE a cada atributo de
    CADA jugador del roster (incluidos los 9 jugadores placeholder de
    las 4 plantillas parcheadas, para que queden coherentes con el
    nivel de su equipo), redondeando a entero y con clamp estricto a
    1-20. Ningún otro campo se toca (posiciones, medidas corporales,
    rasgos, experiencia, ocultos, estados dinámicos, `dataSource`...).
  - **Rango final de rating top8** — 1ª división: 11.84 – 15.93
    (amplitud ~4.1, antes ~0.6); 2ª división: 11.44 – 13.60 (amplitud
    ~2.2).
  - Mayor ajuste al alza: Flexicar Fuenlabrada (x1.084) y Real Madrid
    (x1.038). Mayor ajuste a la baja: Leyma Coruña (x0.820), MoraBanc
    Andorra (x0.823) y Casademont Zaragoza (x0.826) — los tres eran
    equipos de la parte baja de la tabla real cuyo dataset importado
    los dejaba con un overall demasiado alto para su tier.
  - **Verificado**: los 414 jugadores (405 reales + 9 placeholder)
    comprobados uno a uno contra la versión anterior — cero atributos
    fuera de 1-20, cero no-enteros, y los campos que no debían tocarse
    quedan exactamente iguales que antes del reescalado. 33 de los 36
    equipos quedan dentro de ±0.3 de su `targetTop8`; **3 quedan justo
    fuera de tolerancia por el redondeo a entero de cada atributo**
    (factor muy cercano a 1.0, así que muchos atributos no llegan a
    cambiar de entero): Valencia Basket (14.77 vs objetivo 15.10, -0.33),
    Caja Rural CB Zamora (11.81 vs objetivo 11.50, +0.31) y Palencia
    Baloncesto (13.02 vs objetivo 12.70, +0.32). Esto provoca 4 cruces
    de orden puntuales en 2ª división (Caja Rural CB Zamora y Palencia
    Baloncesto quedan por encima de algún equipo de tier nominalmente
    superior); en 1ª división el orden por tiers se respeta sin
    ninguna excepción. Señalado aquí en vez de forzarlo en silencio —
    no se ha aplicado ningún ajuste adicional no pedido en la tarea.
  - `data/real/real-data-bundle.js` regenerado a partir de los equipos
    ya reescalados. Verificado con Playwright headless (`file://`) que
    la Liga real de 1ª división sigue simulando sin errores tras el
    cambio, y que ahora el campeón de una temporada de prueba es Real
    Madrid con una diferencia de puntos mucho más amplia que antes.

- **Nuevo frontend de juego** (diseñado y probado aparte, aplicado aquí
  vía `apply_frontend.sh` tras revisar su contenido — ver nota de
  auditoría abajo). Reescribe `index.html` y añade `src/ui/game.js` +
  `src/ui/game.css`; no toca `src/core/`, `src/entities/` ni
  `src/utils/`.
  - `index.html` pasa a ser una landing con dos botones: "Empezar
    temporada" (modo juego nuevo) y "Modo prueba" (todo el contenido
    técnico que ya existía, intacto, solo oculto por defecto detrás del
    botón).
  - Modo juego (`src/ui/game.js`): elegir club real de 1ª o 2ª división
    (del bundle `data/real/`), avanzar jornada a jornada, partido del
    usuario con marcador revelándose cuarto a cuarto y box score
    completo (individual + totales de equipo) al terminar, calendario,
    competiciones (liga + Copa + Playoff por el título en 1ª; liga +
    Playoff de ascenso en 2ª) y estadísticas de jugadores por
    competición — todo reutilizando `League.js`/`Cup.js`/`Playoffs.js`/
    `Promotion.js`/`MatchEngine.js` tal cual, sin modificarlos.
  - **Auditoría antes de ejecutar el script** (entregado como
    `.sh` con el contenido de los 3 ficheros en base64): confirmado que
    solo escribe esos 3 ficheros (nada de red, nada destructivo);
    decodificado y revisado el contenido de los 3 antes de aplicarlo.
  - **Verificado con Playwright headless** (`file://`, sin servidor):
    modo prueba sigue funcionando igual que antes; modo juego completo
    de punta a punta — selección de equipo, simulación de jornada con
    reveal cuarto a cuarto (suma de parciales cuadra con el marcador
    final), box score individual + totales de equipo, calendario,
    estadísticas, y las pestañas de Copa/Playoff/Ascenso muestran el
    aviso de "todavía no disponible" correctamente antes de
    desbloquearse. Cero errores de consola/página.
  - **Nota externa al proyecto, no bloqueante**: `index.html` enlaza a
    Google Fonts (`fonts.googleapis.com`) — funciona, pero introduce
    una dependencia de red que antes no existía (sin conexión, cae a
    fuentes por defecto sin romper nada). No decidido aquí si se quiere
    mantener o quitar.
  - **Bug menor detectado, no corregido** (fuera del alcance pedido de
    esta tarea): si se cambia de equipo de 1ª a 2ª división (o
    viceversa) mientras está activa una pestaña de competición que solo
    existe en la otra división (ej. "Playoff por el título"), la
    pantalla de Competiciones sigue mostrando el contenido de esa
    pestaña obsoleta hasta que el usuario pulsa otra pestaña — no da
    error, solo un resto visual. Pendiente de decidir si se corrige.

## 2026-08-17

- **Bloque A — Fechas de nacimiento reales cargadas** (`data/real/real-data-bundle.js`
  y `data/real/teams/*.json`): los 405 jugadores reales con `id` tipo
  `player-<team-slug>-NN` tenían `birthDate: null`; Dennis aportó el
  fichero con las 405 fechas reales (formato `YYYY-MM-DD`), emparejadas
  por `id` (nunca por nombre, para evitar duplicados). Los 405 hicieron
  match exacto con el bundle — cero IDs sin correspondencia en ningún
  sentido. No se ha tocado ningún otro campo (`technical`, `physical`,
  `mental`, `hidden`, `traits`, `experience`, `dynamicState`,
  `bodyMeasurements`), verificado campo a campo tras la carga.
  - Actualizado también `dataSource.basis` en esos 405 registros: la
    frase "Fecha de nacimiento no recuperada con seguridad en esta
    consolidación y se deja vacía" se sustituye por "Fecha de nacimiento
    verificada en la consolidación posterior del dataset.", conservando
    el resto de la frase original (p. ej. la cláusula sobre medidas
    físicas que en 173 de los 405 iba unida por punto y coma).
  - **Añadido no pedido explícitamente pero necesario para evitar una
    regresión silenciosa**: `data/real/real-data-bundle.js` se genera a
    partir de `data/real/teams/*.json` vía
    `scripts/import-real-data.js`/`rescale-real-attributes.js`. Esos 36
    ficheros por equipo son la fuente de verdad y también tenían
    `birthDate: null` en los mismos 405 registros. Si solo se actualiza
    el bundle, la próxima vez que se ejecute cualquiera de esos dos
    scripts se regeneraría el bundle desde los JSON de equipo y las 405
    fechas cargadas hoy desaparecerían sin aviso. Se han actualizado
    también esos 36 ficheros con los mismos 405 `birthDate` y el mismo
    cambio de `dataSource.basis`, verificando que bundle y ficheros de
    equipo quedan byte a byte equivalentes (como ya lo estaban antes de
    tocar nada).
  - Verificado tras la carga: JSON válido en los 37 ficheros afectados,
    sin IDs duplicados, sin referencias `teamId` rotas, sin
    `birthDate: null` restante en jugadores `player-*`, y las 9 fichas
    de jugadores con `id` en formato UUID (fuera del alcance de este
    bloque, plantilla adicional de Primera FEB con fechas ya cargadas
    por otra vía anterior) intactas.
  - Confirmado explícitamente con Dennis en el encargo: la fecha de
    nacimiento no se usa todavía para nada (no hay cálculo de edad, no
    se muestra en ninguna pantalla, no se conecta a ninguna fórmula del
    motor) — `DESIGN.md` no define ningún uso de la edad todavía.

- **Bloque B — Liga, Copa y Playoffs como un único flujo** (`src/ui/game.js`):
  antes, el botón principal de Home solo avanzaba la liga regular, y
  Copa/Playoff/Ascenso solo se podían jugar partido a partido desde sus
  pestañas en Competiciones, resueltos de golpe (sin el revelado
  progresivo por cuartos que sí tiene la liga). Ahora es un único flujo:
  - Nueva `getActiveBracket()`: mientras exista una Copa o un
    Playoff/Ascenso activo y sin terminar (prioridad fija Copa >
    Playoff por el título > Playoff de ascenso), el botón principal de
    Home deja de decir "Jugar siguiente jornada" y pasa a avanzar ESE
    bracket un partido a la vez, con la tarjeta rotulada según la ronda
    en curso (ej. "Copa — Cuartos de final", "Playoff de ascenso — Final
    (Final Four)"). Cuando no hay ningún bracket activo, el botón vuelve
    a comportarse exactamente como antes (jornada de liga regular).
  - Nueva `playBracketGameWithReveal()`: puente que convierte el
    `{ gameNumber, homeEntry, awayEntry, result }` que devuelve
    `Bracket.playNextGame()`/`PromotionPlayoff.playNextGame()` en el
    `{ homeTeam, awayTeam, result }` que ya esperan
    `startMatchReveal()`/`renderMatchScreen()` — así cualquier partido de
    Copa/Playoff/Ascenso se revela cuarto a cuarto exactamente igual que
    un partido de liga, sin tocar `Bracket.js`/`Cup.js`/`Playoffs.js`/
    `Promotion.js`.
  - Los tres botones de "Jugar siguiente partido de la Copa/playoff/
    ascenso" que ya existían en la pestaña Competiciones (que antes
    resolvían el partido de golpe) ahora pasan por el mismo puente — un
    único camino para jugar un partido de bracket, no dos con
    comportamiento distinto. La pestaña Competiciones sigue existiendo
    igual que antes para consultar clasificación/cruces/resultados.
  - La creación automática de brackets en `simulateNextRound()`
    (jornada 17→18 para la Copa, fin de liga regular para Playoff/
    Ascenso) no se ha tocado.
  - **Verificado con Playwright headless** (`file://`, sin servidor), en
    los tres frentes pedidos: 1ª división completa (liga hasta jornada
    17, Copa creada y jugada entera desde el botón de Home con revelado
    por cuartos visible, vuelta a la liga regular, liga hasta jornada 34,
    Playoff por el título jugado entero igual desde Home); 2ª división
    completa (liga hasta jornada 34, Playoff de ascenso — cuartos y
    Final Four — jugado entero desde Home); y el botón de Copa en la
    pestaña Competiciones pasando también por el revelado por cuartos.
    Al terminar liga + Copa + Playoff en 1ª, el botón principal vuelve a
    su estado ya existente de "Temporada regular terminada" (deshabilitado),
    sin dejar ningún estado ambiguo. Cero errores de página (el único
    error de consola es la carga externa ya conocida de Google Fonts, no
    relacionado con este cambio).
  - **Decisión de UI tomada sin estar 100% especificada, a confirmar con
    Dennis**: al pulsar "Volver a Inicio" tras revelar un partido de
    bracket jugado desde la pestaña Competiciones (no desde Home), el
    flujo lleva a la pantalla de Inicio (Home), no de vuelta a
    Competiciones — mismo destino que ya tenían los partidos de liga.
    Parece razonable por consistencia, pero no estaba explícitamente
    pedido para el caso "iniciado desde Competiciones".
  - No se ha tocado `Bracket.js`, `Cup.js`, `Playoffs.js`,
    `Promotion.js` ni `League.js`.

- **Bloque C: Alineaciones, Rotación y Desgaste/Energía** (DESIGN.md
  6.1 actualizado + nueva sección 7.11). Continuación tras un corte de
  contexto de la sesión — se retomó desde el estado en disco (3 commits
  ya fusionados de Bloques A/B + un WIP sin terminar de este Bloque C)
  releyendo el nuevo `DESIGN.md` como especificación.
  - **C.0 — Posiciones como mapa** (`Player.js`): `positions` deja de
    ser una lista de 1-5 entradas y pasa a un mapa con las 5 posiciones
    SIEMPRE presentes, nivel 1-20 cada una, exactamente una a 20 (la
    principal, `player.primaryPosition`). `Team.js`
    (`buildMatchSquadExcludingPosition`) y `playerGenerator.js`
    (`generatePositionMap`, ponderado por distancia a la principal)
    adaptados. `scripts/migrate-positions-to-map.js` (nuevo, migración
    de una sola vez) ya ejecutado sobre los 414 jugadores de
    `data/real/teams/*.json` y `data/real/sources/`, regenerando
    `real-data-bundle.js`.
  - **C.1/C.2 — `src/core/Rotation.js`** (nuevo): convocatoria + posición
    declarada por partido; cuota de minutos por jugador con validación
    ESTRICTA (cada una de las 5 posiciones debe sumar exactamente la
    duración del partido, sin normalizar en silencio); quintetos fijos
    opcionales por franja; sustitución automática solo en ventanas
    reales (fin de cuarto o parada de juego — falta/violación — nunca a
    mitad de jugada viva).
  - **C.3 — Polivalencia de emergencia**: cuando una posición se queda
    sin cobertura, el motor elige, entre los convocados con minutos
    disponibles, el de mayor nivel en esa posición combinado con menor
    distancia posicional (Base–Escolta–Alero–Ala-pívot–Pívot);
    penalización de rendimiento proporcional a la distancia y al nivel
    real del jugador ahí (`MatchConfig.emergencyVersatility`).
  - **C.4 — Desgaste en dos componentes** (`MatchEngine.js`/
    `MatchConfig.js`): desgaste GENERAL (mayor) con jerarquía por la
    posición ocupada EN CADA JUGADA (exterior desgasta más que
    interior) + desgaste por INTERVENCIÓN (menor) para quien participa
    directamente en la acción resuelta esa posesión; ambos modulados
    por Resistencia, acotada para que nunca llegue a desgaste cero.
  - **C.5 — `src/core/Recovery.js`** (nuevo): curva de recuperación de
    Energía entre partidos, decaimiento exponencial inverso sobre el
    hueco restante (más rápida el primer día), Recuperación (1-20) como
    multiplicador de velocidad, con gancho neutro (`trainingModifier`)
    para el futuro módulo de Entrenamiento.
  - **Integración en `MatchEngine.js`** (lo que quedaba sin terminar
    del WIP): `simulateMatch`/`simulatePossession` aceptan
    `options.homeLineup`/`awayLineup` — TOTALMENTE OPCIONAL y
    retrocompatible: sin alineación, el equipo se comporta exactamente
    igual que hasta ahora (`selectOnCourtFive` placeholder, sin
    penalización). Con alineación: valida antes de simular (error
    descriptivo si no cuadra, nunca una simulación silenciosamente
    incorrecta), usa el quinteto real en pista, aplica penalización de
    polivalencia en tiros/faltas/robos/rebotes/tapones del jugador que
    corresponda, acumula minutos jugados y dispara sustituciones en las
    ventanas correctas. Bug encontrado y corregido durante la
    integración: `resolveReboundContest` recibía una única función de
    penalización para dos reboteadores de equipos (y rotaciones)
    distintos — no podía funcionar correctamente; ahora recibe ambos
    `rotationState` por separado. Otro bug corregido: `index.html` no
    cargaba `Rotation.js`/`Recovery.js` con `<script>` (aunque
    `MatchEngine.js` ya los requería) — sin esto, cualquier flujo del
    juego real fallaba en el navegador con `getPenalty is not a
    function`; detectado con Playwright, no solo en Node.
  - **Deliberadamente NO incluido en este Bloque** (score de la propia
    tarea, no un olvido):
    - `Recovery.js` está listo y probado pero **no conectado a
      `League.js`** — no existe todavía un concepto de "días entre
      jornadas" en el calendario, y DESIGN.md 7.11.5 no lo fija; conectar
      la recuperación real entre jornadas es una decisión pendiente de
      Dennis (cadencia semanal, fechas reales, etc.), no algo que deba
      asumir en silencio.
    - La **pantalla de Alineación** (DESIGN.md 7.11.6, Valoración
      Técnica/Física/Mental, Energía, Forma en estrellas) — el propio
      DESIGN.md la marca como "aún por construir"; `game.js` sigue sin
      lineup (comportamiento de siempre) hasta que exista esa pantalla.
  - **Verificado con un script Node dedicado**: reparto automático de
    minutos válido, partido completo con alineación en ambos equipos
    (minutos totales jugados ≈ 5 × duración del partido, ningún
    jugador se pasa de su cuota por más de unos segundos), alineación
    inconsistente lanza el error descriptivo real (no un fallo interno
    — se detectó y corrigió que faltaba ese caso), posición sin nadie
    declarado detectada por `validateLineup`, curva de recuperación no
    lineal y más rápida con mejor Recuperación. Además, re-verificados
    sin regresiones los tests ya existentes de datos reales,
    Bracket/Playoffs/Cup/Promotion, y toda la interfaz de juego con
    Playwright headless (selección de equipo, jornada con reveal por
    cuartos, calendario, competiciones, estadísticas) — cero errores de
    consola aparte del ya conocido fallo de red a Google Fonts en este
    sandbox sin internet.
  - **Nota sobre `DESIGN.md`, señalada para que Dennis confirme**: la
    misma subida que añadió 6.1/7.11 también sustituyó la sección 3.2
    completa (Playoffs/Copa/Ascenso, ya implementada y en producción)
    por una entrada genérica de "Pendiente" que la da por no
    diseñada/no implementada — parece un posible descuido al subir una
    versión desactualizada del fichero, ya que contradice el código
    real (`Bracket.js`/`Cup.js`/`Playoffs.js`/`Promotion.js`, fusionados
    hace tiempo, y el propio flujo unificado de Home de Bloque B). No se
    ha tocado nada del código de Playoffs/Copa/Ascenso por esto — solo
    se deja constancia aquí en vez de asumir en silencio que hay que
    revertirlo.

## 2026-08-19

- **Cierre del Bloque C: pantalla de Alineación** (DESIGN.md 7.11.6) — la
  única pieza que quedaba pendiente de Bloque C. Usa `src/core/Rotation.js`
  tal cual (nueva pantalla en `src/ui/game.js`, sin reimplementar nada de
  su lógica), añadida a la navegación existente (`SCREENS`, `gm-nav`,
  `index.html`).
  - **Convocatoria**: selector de 8-12 jugadores de la plantilla real del
    usuario, reutilizando la validación de `Team.buildMatchSquad()` tal
    cual (no se reimplementa el rango 8-12 en la UI).
  - **Por convocado**: selector de posición declarada entre las 5 del mapa
    (`Player.POSITIONS`), mostrando el nivel del jugador en cada una;
    cuota de minutos (0 a `config.match.durationMinutes`, nunca 40 fijo);
    marcado informativo de titular/banquillo (mayor cuota declarada por
    posición) — no bloqueante, `Rotation.js` resuelve el quinteto real
    internamente.
  - **Datos mostrados por convocado (7.11.6)**: Valoración Técnica/Física/
    Mental (nuevos getters `technicalAverage`/`physicalAverage`/
    `mentalAverage` en `Player.js`, media simple de cada grupo de
    atributos), Resistencia (`player.physical.stamina`, confirmado el
    nombre exacto del campo antes de usarlo), Energía actual
    (`dynamicState.energy`) y Forma (`dynamicState.competitionRhythm`
    traducido a 1-5 estrellas, excepción explícita de 7.11.6 — en ningún
    otro sitio de la pantalla se muestra el número crudo).
  - **Quintetos fijos** (`fixedSegments`): opcionales, formulario para
    añadir uno o varios (etiqueta, período de activación, condición de
    marcador, quinteto por posición entre los convocados), con opción de
    dejar posiciones "sin fijar" dentro de un mismo quinteto fijo.
  - **Validación antes de jugar/guardar**: `Rotation.validateLineup()` +
    `Rotation.describeValidationErrors()` reutilizados tal cual (mensaje
    no reformulado); el botón de jugar queda deshabilitado mientras la
    alineación no sea válida.
  - **Ajuste quirúrgico necesario, señalado explícitamente** (la pantalla
    resuelve el partido de la jornada de liga o del bracket activo vía
    `League.simulateNextRound()`/`Bracket.playNextGame()`/
    `Series.playNextGame()`/`PromotionPlayoff.playNextGame()`, ninguno de
    los cuales aceptaba antes un `options` para pasar a
    `MatchEngine.simulateMatch()` — solo `MatchEngine.simulateMatch()` en
    sí ya soportaba `homeLineup`/`awayLineup` desde el Bloque C anterior):
    los cuatro métodos aceptan ahora un parámetro opcional adicional
    (`resolveMatchOptions`/`resolveOptions`, un callback que recibe el
    partido/las entradas de la serie y devuelve las `options` de
    MatchEngine o `undefined`), 100% retrocompatible — sin ese argumento
    el comportamiento es idéntico al de antes. No se ha tocado ninguna
    otra lógica de `League.js`/`Bracket.js`/`Promotion.js`.
  - `Player.js`: además de los 3 getters de medias, sin más cambios de
    esquema — `dataSource` sigue fuera del constructor.
  - **Decisión de producto no fijada en DESIGN.md, señalada para
    confirmar con Dennis**: la alineación construida persiste en memoria
    entre jornadas (no se resetea automáticamente tras cada partido) para
    no obligar a reconstruirla partido a partido — el usuario puede volver
    a la pantalla y ajustarla cuando quiera. Si se prefiere que se pida
    reconstruirla antes de cada partido, es un cambio pequeño y localizado.
  - Jugar sin pasar por la pantalla de Alineación sigue funcionando exactamente
    igual que hasta ahora (comportamiento placeholder, sin lineup) — no se ha
    hecho obligatoria en ningún punto del flujo.
  - **No conectado en este cierre** (fuera de alcance, confirmado con
    Dennis desde el propio encargo): `Recovery.js` sigue sin conectarse a
    `League.js` — se aplaza a la sesión de diseño de calendario real.
  - **Verificado**: script Node dedicado (medias de `Player`, `League.
    simulateNextRound()`/`Bracket.playNextGame()` con y sin
    `resolveOptions`, retrocompatibilidad sin el argumento, lineup
    inválida bloqueada con el mensaje esperado) + Playwright headless
    (`file://`, sin servidor) con los tres escenarios pedidos: alineación
    válida jugada con minutos jugados coherentes con las cuotas
    declaradas (leído del `rotationSummary` real del resultado del
    motor), alineación descuadrada con el botón de jugar bloqueado y el
    mensaje de error correcto, y partido jugado sin pasar por Alineación
    sin regresiones. También verificado añadir/quitar un quinteto fijo
    desde la UI y que el modo prueba sigue cargando sin errores. Cero
    errores de consola/página en todos los casos (aparte del ya conocido
    fallo de red a Google Fonts en este sandbox sin internet).

## 2026-08-19 (2) — Alineación por slots + Minutos de la basura

- **Aviso encontrado al empezar, señalado antes que nada**: el encargo de
  esta sesión citaba `DESIGN.md` 7.11.2-bis ("Minutos de la basura") y una
  "ampliación de 7.11.6 sobre convocatoria/quintetos" como si ya
  existieran en el documento — no era así, `DESIGN.md` no tenía ninguna de
  las dos antes de esta sesión (comprobado con búsqueda completa del
  archivo). Se ha tratado la especificación del encargo como la regla
  dictada directamente por Dennis y se ha añadido **7.11.2-bis** a
  `DESIGN.md` con el contenido exacto pedido, para que quede fijada para
  sesiones futuras. No se ha encontrado ni inventado ninguna "ampliación
  de 7.11.6" — 7.11.6 queda igual que estaba.
- **`src/core/Rotation.js` — nuevo modelo de slots** (sustituye "una
  entrada por jugador" por "slots por posición"): `lineup.entries` pasa a
  ser `{ [posición]: { starter, sub1, sub2 } }`, cada slot
  `{ playerId, minutesQuota }`. Un mismo `playerId` puede repetirse en
  varios slots/filas sin bloquearlo — el motivo original del cambio: un
  jugador no podía antes ser titular en una posición y suplente en otra a
  la vez, con minutos independientes que se suman a su total.
  - `validateLineup()`: ahora suma los 3 slots de cada fila (antes sumaba
    entradas sueltas por jugador); mismo comportamiento de bloqueo con
    detalle de qué posición falla y en cuánto.
  - Nueva `totalMinutesByPlayer(lineup)`: recorre las 5×3 slots y devuelve
    el total de minutos de cada jugador sumando todas sus apariciones —
    la usan tanto la UI (resumen de minutos totales) como el propio
    `buildRotationState()` para `quotaSeconds`.
  - `buildRotationState()`: `bySlot`/`quotaSeconds` adaptados al nuevo
    shape; el quinteto inicial usa directamente el slot `starter` de cada
    fila (ya no hace falta inferirlo por mayor cuota).
  - **Decisión de implementación NO fijada en DESIGN.md, señalada
    explícitamente**: `chooseEmergencyCandidate()`/
    `considerSlotSubstitution()` ya no leen una `declaredPosition` única
    por jugador (no existe con el modelo de slots) — se añade
    `referencePositionForPlayer()`, que usa la fila donde el jugador tiene
    más minutos asignados como su posición de referencia para la distancia
    posicional de la polivalencia de emergencia (7.11.3). Empate resuelto
    por orden de posición (Base→Pívot), también sin fijar en DESIGN.md.
- **`src/core/Rotation.js` — Minutos de la basura (7.11.2-bis)**: nuevas
  `updateGarbageTimeState()` (activación/desactivación por equipo, umbrales
  de tiempo calculados en segundos totales de partido para que sigan
  siendo válidos si hay prórroga) y `considerGarbageTimeSubstitution()`
  (orden Suplente 2 > Suplente 1 > Titular, sin exigir cuota). Se evalúa en
  cada `runSubstitutionWindow()`, incluso durante una franja fija activa
  (para no perder la marca), pero un quinteto fijo sigue mandando sobre la
  sustitución en sí mientras esté activo — **decisión de implementación no
  fijada en DESIGN.md**, señalada explícitamente: un quinteto de cierre
  fijado a propósito por el usuario no debería deshacerse solo porque se
  activen minutos de la basura.
  - **Pendiente explícito** (ya señalado en el propio 7.11.2-bis y en el
    encargo): no existe sistema de disponibilidad por lesión/expulsión en
    el motor — cualquier slot con jugador asignado se trata como
    disponible.
- **`src/core/MatchConfig.js`**: nuevo bloque `garbageTime: { marginToEnter:
  20, marginToExit: 10 }` en `CONFIG_BASE`, en vez de números sueltos.
- **`src/ui/game.js` — pantalla de Alineación**:
  - La convocatoria (checkboxes de nombre + posición) se mantiene igual;
    las valoraciones en estrellas (Técnica/Física/Mental/Resistencia/
    Energía/Forma, DESIGN.md 7.11.6) se han trasladado aquí desde la
    tarjeta "Convocados" que desaparece — **señalado explícitamente**: el
    encargo decía que la convocatoria "ya" mostraba estas valoraciones y
    debía quedar igual, pero en el código real solo vivían en la tarjeta
    de Convocados (la que este mismo encargo pide sustituir); para no
    perder ese dato exigido por 7.11.6 se han movido al bloque de
    checkboxes en vez de eliminarlas.
  - Bloque "Convocados" (una tarjeta por jugador) sustituido por una tabla
    de 5 filas (una por posición) × 3 columnas de slot (Titular, Suplente
    1, Suplente 2), cada slot con desplegable de convocado + minutos, sin
    exclusión entre desplegables de la misma fila ni de otras filas.
  - Contador en vivo "35/40"/"40/40" por fila, con clase CSS
    `is-ok`/`is-bad`: se actualiza en el evento `input` (cada pulsación,
    sin esperar a perder el foco) actualizando solo el nodo del contador y
    el resumen de abajo, sin re-renderizar la pantalla entera (se perdería
    el foco del campo mientras se escribe); el `change` (blur) sigue
    haciendo el commit final clampado + re-render completo, para refrescar
    la validez global y el botón de jugar.
  - Nuevo resumen "Minutos totales por jugador" debajo de la tabla, usando
    `Rotation.totalMinutesByPlayer()`.
  - Quintetos fijos por franja: sin cambios funcionales, comprobados con
    el nuevo shape de `entries` (no dependían de él, solo de IDs de
    jugador sueltos).
  - Nuevo checkbox "Permitir minutos de la basura" →
    `lineup.garbageTime.enabled` (por defecto `false`, opción de partido);
    se reenvía en `buildUserSideOptions()` junto con `entries`/
    `fixedSegments`.
- **`src/ui/game.css`**: estilos nuevos para la tabla de slots
  (`.lineup-slots-table`, `.lineup-slot-cell`, `.lineup-slot-total.is-ok/
  .is-bad`), el resumen de minutos totales y el checkbox de minutos de la
  basura (`.gm-checkbox`); las reglas de la antigua tarjeta por jugador
  (`.lineup-card*`) se han retirado (ya no se usan) salvo las de
  valoraciones/forma, renombradas a `.squad-picker__ratings`/
  `.squad-picker__form` al trasladarse al bloque de convocatoria.
- **`CLAUDE.md`**: añadidas dos decisiones de interfaz ya tomadas a la
  sección "Interfaz de juego" (modelo de slots de la tabla de Alineación,
  checkbox de minutos de la basura) para que sesiones futuras no las
  reinterpreten.
- **Verificado**: script Node dedicado sobre `Rotation.js`/
  `MatchConfig.js` (validación 40/40 por fila y detección de descuadre,
  `totalMinutesByPlayer` sumando slots repetidos del mismo jugador,
  quinteto inicial = slots `starter`, sustitución normal por cuota
  agotada, activación/mantenimiento/desactivación de minutos de la basura
  con los umbrales de tiempo y margen correctos para el equipo que gana y
  para el que pierde) + Playwright headless (`file://`, sin servidor):
  convocatoria, tabla de slots con 5 filas y desplegables repoblados,
  contador en vivo actualizándose con el evento `input` sin blur, resumen
  de minutos totales en vivo, checkbox de minutos de la basura, mismo
  jugador repetido en dos slots de la misma fila sin bloquearse, y un
  partido completo jugado de principio a fin con una alineación válida de
  10 convocados (sin errores de consola/página, aparte del ya conocido
  fallo de red a Google Fonts en este sandbox sin internet).
- **Actualización tras terminar, antes de abrir el PR**: mientras se
  trabajaba, Dennis subió directamente a `main` (commit "Add files via
  upload") el contenido real de 7.11.2-bis y una ampliación de 7.11.6 —
  las mismas secciones que el encargo citaba como ya existentes. Al
  traer `main` a esta rama:
  - Se ha retirado la versión de 7.11.2-bis añadida en este cierre (era
    redundante, coincidía en cifras con la de Dennis) y se ha mantenido
    la de `main` como texto canónico.
  - La ampliación real de 7.11.6 pide **dos pantallas separadas**
    (Convocatoria / Quintetos); esta sesión había construido **una sola
    pantalla combinada**. Consultado con Dennis, decide mantener una
    sola pantalla ("le parece innecesariamente engorroso" separarlas) —
    se ha anotado esa decisión directamente en el propio DESIGN.md junto
    a la ampliación, para que no quede una contradicción escrita entre
    el documento y la interfaz real.

## 2026-08-19 (3) — Fix: "Jugar siguiente jornada" ignoraba la alineación guardada

- **Bug corregido** en `src/ui/game.js`: el botón "Jugar siguiente
  jornada" de Home llamaba a `simulateNextRound()` sin resolver de
  alineación, así que el motor caía en su convocatoria por defecto
  (`defaultMatchSquad`) en vez de usar la última alineación guardada por
  el usuario (`state.lineup`) — jugadores desconvocados aparecían
  jugando y jugadores con minutos asignados no aparecían en el box
  score. Los botones "Jugar siguiente partido" de bracket (Home y
  Competiciones: Copa, Playoff por el título, Playoff de ascenso) tenían
  el mismo problema.
- Se ha extraído la construcción del resolver (antes solo existía
  anidada dentro de la pantalla de Alineación) a una única función
  compartida, `buildLineupMatchOptionsResolver(team)`, que devuelve
  `resolveMatchOptions` (para `League.simulateNextRound`) y
  `resolveBracketOptions` (para `Bracket.playNextGame`), ambos
  construidos a partir de `state.lineup` tal cual esté guardado. Todos
  los puntos que juegan un partido (Home: jornada y bracket;
  Competiciones: Copa/Playoff/Ascenso; pantalla de Alineación) llaman
  ahora a esta misma función — no queda ninguna llamada a
  `simulateNextRound(` ni `playBracketGameWithReveal(` sin resolver
  (verificado con grep sobre el archivo completo).
- Añadida validación antes de jugar desde cualquiera de esos botones:
  si `state.lineup` no tiene todavía una alineación válida guardada
  (`getLineupValidity`, ya existente), se bloquea la acción y se lleva
  al usuario a "Configurar alineación" en vez de jugar con una
  convocatoria a medias. Si ya existe una alineación válida de una
  jornada anterior, se usa directamente sin pedir nada — nunca hay que
  reconfigurar cada jornada.
- **Revisado si `state.lineup` se reseteaba en algún punto no pedido por
  el usuario**: el único sitio que reasigna `state.lineup` es
  `startSeason()`, al empezar una partida nueva — comportamiento
  correcto (una temporada nueva necesita alineación nueva). No se ha
  encontrado ningún reseteo entre jornadas ni al cambiar de pantalla; la
  alineación persiste tal cual hasta que el usuario la edite en la
  pantalla de Alineación, como ya estaba documentado en `CLAUDE.md`. No
  se ha corregido nada en este punto porque no había nada que corregir.
- No se ha tocado `MatchEngine.simulateMatch()` ni el bucle de
  posesión, ni se ha añadido ningún fallback propio de convocatoria o
  minutos.

## 2026-08-19 (4) — Entidad Calendario + integración de Recovery.js (DESIGN.md 3.3 / 7.11.5)

- **Nota previa señalada, no asumida en silencio**: el prompt de esta
  tarea decía que `DESIGN.md` ya tenía escrita y aprobada la sección
  3.3 ("Entidad Calendario") y una actualización de 7.11.5 ("Cierre de
  integración"). Comprobado antes de tocar nada: **ninguna de las dos
  existe hoy en `DESIGN.md`** (la sección 3 solo llega hasta 3.2, y
  7.11.5 sigue con el texto de la sesión anterior). No se ha bloqueado
  el trabajo por esto — el propio prompt traía suficiente detalle
  operativo (claves de `CONFIG_BASE.calendar` con valores, forma de la
  API de `Calendar`, puntos de integración exactos) para implementar sin
  inventar reglas de diseño no confirmadas — pero Dennis debería subir
  esas dos secciones a `DESIGN.md` para que quede como fuente de verdad
  real, no solo en este CHANGELOG.
- **`src/core/Calendar.js`** (nuevo): asigna fecha real (`Date`) a
  cualquier partido de las 4 competiciones. `leagueRoundDate(round)`,
  `cupRoundDates()` (3 fechas en el hueco entre jornada 17 y 18),
  `titlePlayoffStartDate(fechaFinLigaRegular)`, y
  `buildBracketDateResolver(startDate, roundPatterns)`.
  - **Desviación deliberada de la firma sugerida en el prompt**:
    `buildBracketDateResolver` recibe también `roundPatterns` (no solo
    `startDate`) — sin conocer cuántos partidos puede llegar a tener
    cada ronda (1, 3 o 5 según el patrón de campo), una ronda siguiente
    fija a `roundIndex * seriesRoundGapDays` podría empezar ANTES de que
    la ronda anterior hubiera podido terminar en su desarrollo más
    largo. Comportamiento pedido (separación entre partidos de una
    Series y entre rondas) preservado igual; solo cambia qué necesita
    para calcularlo bien — documentado en el propio archivo.
  - `MatchConfig.js` gana el bloque `calendar` (año/mes de inicio de
    temporada, separación entre jornadas, huecos de Copa/Series/Playoff)
    — valores de partida razonables, **no cifras cerradas**, pendientes
    de calibración.
  - **Nota de calibración detectada por el test dedicado**: con los
    valores de partida `daysBetweenRounds: 7` y `cupRoundGapDays: 3`,
    las 3 rondas de Copa (cuartos+3+3+3 días) no caben enteras antes de
    la jornada 18 — la final de Copa cae 2 días después. No es un fallo
    de `Calendar.js`: es que esos dos valores de partida no encajan
    entre sí con 3 rondas. Pendiente de que Dennis los recalibre.
  - **Integrado en las 4 competiciones**, todas con el mismo patrón:
    parámetro nuevo OPCIONAL (`dateResolver`/`cupDates`), sin `date`
    queda en `null` — comportamiento retrocompatible, ninguna llamada
    existente `new League(teams)`/`new Bracket(...)` se rompe:
    - `League.js`: `createMatch`/`generateSchedule`/`new League(teams,
      dateResolver)` — 2º parámetro nuevo del constructor.
    - `Cup.js`: `createCup(league, cupDates)`.
    - `Bracket.js`: `Series`/`Bracket` ganan `dateResolver`; cada
      `game.date` sale del resolver ligado a su ronda.
    - `Playoffs.js`/`Promotion.js`: `createTitlePlayoff(league,
      dateResolver)` / `new PromotionPlayoff(league, dateResolver)`.
      Exportan `TITLE_PLAYOFF_ROUND_PATTERNS`/`PROMOTION_ROUND_PATTERNS`
      para que quien construye el resolver no duplique los patrones.
      **Bug evitado antes de que llegara a pasar**: ambos módulos
      exportaban originalmente una constante `ROUND_PATTERNS` con el
      mismo nombre — en el navegador (`global.BasketManager` compartido)
      la que cargara segunda habría pisado a la primera. Renombradas
      antes de que ninguna sesión llegara a depender del nombre
      colisionado.
    - `Promotion.js` en concreto: la Final Four (creada más tarde, al
      completar cuartos) reutiliza el MISMO resolver desplazando
      `roundIndex + 1`, para que sus fechas sigan la numeración continua
      de rondas del playoff completo en vez de reiniciar desde cero.
- **`Player.js`**: nuevo `dynamicState.lastMatchDate` (`Date | null`,
  `null` hasta el debut) y `player.recordMatchDate(date)`. Serializado
  en `toJSON()` como fecha simple (`YYYY-MM-DD`, igual que `birthDate`),
  no como ISO completo con hora — para no romper la consistencia de
  guardado con el resto de la ficha.
- **Enganche real de `Recovery.js`** (el hueco que llevaba huérfano
  desde que se escribió — confirmado con `grep` antes de empezar: cero
  llamadas a `applyRestRecovery`/`computeRecoveredEnergy` fuera de su
  propio archivo): nueva función `applyRecoveryForResolvedMatch()` en
  `src/ui/game.js`, llamada tras CADA partido resuelto de las 4
  competiciones (jornada de liga completa, no solo el partido del
  usuario; y cada partido de bracket de Copa/Playoff/Ascenso). Por cada
  jugador con minutos > 0 en ese partido: si ya tenía `lastMatchDate`,
  aplica `Recovery.applyRestRecovery` con los días reales transcurridos
  desde su ÚLTIMO partido jugado (no desde la última jornada del
  calendario); actualiza `lastMatchDate` en cualquier caso. Los
  convocados sin minutos (o no convocados) NO actualizan su fecha — su
  descanso se sigue midiendo desde su último partido real la próxima
  vez que juegue, sea cuando sea (DESIGN.md 3.3.4), en vez de
  recalcularse jornada a jornada sin que hayan jugado.
  - **Limitación real señalada, no un olvido**: `result.rotation` (de
    donde sale qué jugador jugó cuántos minutos) solo existe cuando ESE
    lado del partido tuvo una alineación real. Hoy
    `buildLineupMatchOptionsResolver()` solo construye alineación para
    el EQUIPO DEL USUARIO — nunca para el rival ni para el resto de
    partidos de la jornada (17 equipos IA). Por tanto, esta integración
    de momento solo puede aplicar recuperación real al equipo del
    usuario cuando tiene alineación configurada; el resto de la liga no
    actualiza `lastMatchDate` todavía, porque no hay manera de saber
    quién jugó cuántos minutos sin inventar un reparto que nadie ha
    pedido.
- `src/ui/game.js`: `state.seasonStartYear` (año real en que empieza la
  partida, decisión no fijada en `DESIGN.md`: se usa el año en curso al
  llamar a `startSeason()`) y `state.calendar` (instancia de
  `Calendar`), construidos en `startSeason()` y usados para pasar
  `dateResolver` a `League`/`Cup`/`Playoffs`/`Promotion` en los puntos
  donde ya se creaban. `renderCalendarScreen()` gana una columna
  "Fecha" (encajaba de forma trivial, sin rediseñar la pantalla).
- **Verificado con dos scripts Node dedicados**: fechas de jornada 1,
  17, 18 y 34 correctas; hueco de Copa/Series/Playoff con la separación
  configurada; Final Four del ascenso con `startDate` propio,
  independiente del playoff de 1ª división; y el escenario de
  integración pedido — un jugador que juega jornada tras jornada
  termina con MÁS energía almacenada que uno que descansa pero no
  vuelve a jugar dentro de la ventana observada (su valor queda
  congelado hasta que juega de nuevo, momento en el que se recalcula de
  golpe con todo el hueco acumulado). Confirmado con `grep`/`diff` que
  `MatchEngine.js`, `Rotation.js` y la pantalla de Alineación no se han
  tocado. Sin regresiones en los tests existentes (Bracket/Playoffs/
  Cup/Promotion, datos reales, Playwright de toda la interfaz).

## 2026-08-19 (5) — Corrección de calibración de Copa + IA de alineación CPU (DESIGN.md 3.3.2 / 7.11.7)

- **Corrección de calibración de Copa** (`Calendar.cupRoundDates()`): el
  bug real señalado en la sesión anterior (con `daysBetweenRounds: 7` y
  `cupRoundGapDays: 3`, la 3ª fecha de Copa caía 2 días DESPUÉS de la
  jornada 18) queda corregido. Ahora el hueco total de Copa es siempre
  exactamente el mismo que separa la jornada 17 de la 18 (no una
  duración derivada de sumar `cupRoundGapDays` × rondas), y se garantiza
  un mínimo de `cupFinalCushionDays` (2, nueva constante de `CONFIG`)
  días de descanso real entre la final de Copa y la jornada 18 —
  comprimiendo la separación entre rondas de Copa cuando no cabe, nunca
  alargando el hueco total ni reduciendo el colchón mínimo. Con los
  valores de partida, el reparto resultante es cuartos +3, semis +4,
  final +5 (jornada 18 en +7) — reparto distinto al ejemplo ilustrativo
  del encargo (+2/+4/+5), pero cumple igual las dos reglas duras; el
  propio DESIGN.md señala que no es la única distribución válida.
  Verificado con el script Node dedicado a `Calendar.js` (caso de Copa
  actualizado: fechas crecientes, dentro del hueco fijo, con el colchón
  mínimo respetado).
- **Nuevo módulo `src/core/CpuLineup.js`** (DESIGN.md 7.11.7):
  alineación automática para los equipos que el usuario no controla —
  cierra la limitación señalada explícitamente en el cierre de 7.11.5 de
  la sesión anterior (sin esto, cualquier lado de un partido que no
  fuera el equipo del usuario caía en `MatchEngine.selectOnCourtFive`,
  sin reparto de minutos por jugador, así que Recovery.js nunca podía
  actualizar su `lastMatchDate`).
  - `buildCpuLineup(team, matchImportance, config)`: construye
    convocatoria (garantiza el mejor jugador de cada una de las 5
    posiciones, completa hasta 12 por calidad general) y el
    `lineup.entries` de 5 posiciones × 3 slots (mismo shape que ya
    valida `Rotation.validateLineup`, no se inventa uno nuevo). El
    quinteto titular usa 5 jugadores distintos (invariante real: nadie
    puede empezar el partido en dos posiciones a la vez); los slots de
    banquillo pueden repetir jugador entre filas, igual que ya acepta la
    pantalla de Alineación humana (ver CLAUDE.md). Selección por sorteo
    ponderado entre los 2-3 mejores candidatos de cada slot (variedad
    partido a partido, menos aleatoriedad en partido clave). Reparto de
    minutos por fila (60/25/15% en partido normal, 70/20/10% en partido
    clave — constantes de `CONFIG.cpuLineup`, valores de partida
    pendientes de calibración) y reducción de cuota de un titular con
    Energía por debajo de `lowEnergyThreshold` (30) en partido NO clave,
    en favor del siguiente candidato.
  - `computeMatchImportance(team, opponent, competition, standingsTable, config)`:
    booleano (decisión de implementación — 7.11.7 deja elegir entre
    booleano simple o 0-1 graduado; se elige booleano porque el propio
    diseño solo describe dos comportamientos discretos). Copa (desde
    cuartos), Playoff por el título y Playoff de ascenso son SIEMPRE
    clave. En liga regular, cruza `team.board.sportingGoal` (mapeado a
    la zona alta de tabla — corte de Copa/Playoff, posición 8 — o la
    zona baja — corte de descenso, penúltima posición) con la distancia
    en la tabla entre ambos equipos y esa frontera (banda configurable,
    `CONFIG.cpuMatchImportance.standingsBandSize`, 4 posiciones).
  - **Integración real** (`src/ui/game.js`,
    `buildLineupMatchOptionsResolver`): antes, esta función solo
    construía alineación para el lado del equipo del usuario y devolvía
    `undefined` para cualquier otro; ahora construye siempre una
    alineación real para AMBOS lados de CUALQUIER partido (liga, Copa,
    Playoff, Ascenso) — la del usuario si le toca, o una de
    `CpuLineup.buildCpuLineup` en cualquier otro caso. No hizo falta
    tocar `League.simulateNextRound` ni `Bracket.playNextGame`: ambos ya
    reenviaban un `resolveOptions`/`resolveMatchOptions` por partido
    desde antes de esta sesión; el hueco estaba solo en que el resolver
    de `game.js` ignoraba los lados que no eran del usuario.
- **Mismatches con DESIGN.md señalados explícitamente** (no resueltos
  aquí por decisión de diseño ajena a esta tarea):
  - 7.11.7 pide reutilizar "el mismo criterio ya usado para las
    valoraciones en estrellas de 7.11.6" para la calidad de un jugador —
    pero 7.11.6 no tiene ninguna fórmula compuesta de la que extraer
    nada: la pantalla de Alineación muestra Técnica/Física/Mental como 3
    medias SEPARADAS (`Player.technicalAverage/physicalAverage/mentalAverage`),
    sin combinarlas en un único número; solo "Forma" se convierte a
    estrellas. `CpuLineup.playerQualityScore()` es una función NUEVA
    (media de esas 3 medias ya existentes), no una extracción de código
    que ya existiera.
  - El cruce con `team.board.sportingGoal` está implementado tal cual lo
    describe 7.11.7, pero hoy es una señal INERTE para una partida real:
    los equipos reales (los únicos seleccionables desde "Empezar
    temporada") no traen `board` en los datos importados, así que
    `Team.js` les asigna a TODOS el mismo valor por defecto
    (`'Permanencia'` — que ni siquiera pertenece al vocabulario de 4
    valores de `teamGenerator.js`). Con los datos de hoy, todo equipo
    real cae en la misma zona ("baja") frente a cualquier rival cercano
    al corte de descenso. Asignar objetivos de temporada reales por
    equipo es una decisión de diseño/económica que no corresponde tomar
    en esta tarea — señalada para que Dennis la confirme, no asumida.
- **Verificado**:
  - Script Node dedicado a `CpuLineup.js`: 8 lineups generados pasan
    `Rotation.validateLineup`; 7 de 8 quintetos titulares distintos
    (variedad real); cuota media de minutos de titulares sube en
    partido clave frente a no clave; `computeMatchImportance` correcto
    en los 3 escenarios (clave por banda de tabla, no clave por
    distancia, siempre clave en Copa/Playoff/Ascenso).
  - Script Node de integración: simulada una temporada CPU vs CPU (sin
    ningún equipo de usuario) durante 3 jornadas — los 18 equipos
    (no solo uno) terminan con al menos un jugador con `lastMatchDate`
    actualizado, y ningún partido jugado se queda con `result.rotation`
    a `null` en ningún lado.
  - `grep` confirma que `MatchEngine.selectOnCourtFive` ya solo es
    alcanzable cuando no se pasa ninguna alineación — el "modo prueba"
    (motor sin tocar, ver CLAUDE.md), nunca el camino normal de
    Liga/Copa/Playoff/Ascenso.
  - Confirmado con `git diff` que `MatchEngine.js` y `Rotation.js` NO se
    han tocado en absoluto (ni siquiera lo mínimo que se esperaba para
    aceptar `homeLineup`/`awayLineup` en partidos donde antes no se
    pasaban — ya lo aceptaban desde antes, para cualquier partido).
  - Playwright: creada partida, convocados 10 jugadores, alineación de 5
    titulares distintos con 40 minutos cada uno, y partido jugado con
    esa alineación real contra un rival con su propia alineación CPU —
    sin errores de consola ni de página (aparte del error de red, ya
    conocido y no relacionado, al bloquear la carga de Google Fonts en
    este entorno). La pantalla de Alineación del usuario, no tocada en
    esta sesión, sigue funcionando exactamente igual.

## 2026-08-19 (6) — Retoques de estadísticas: Asistencia, Valoración, +/-, minutos y medias de temporada

- **Asistencia** (nueva, DESIGN.md 7.6, Bloque D — entrada 22, junto con
  la nota de alcance sobre la mejora futura del tiro del receptor, ya
  redactada en la propia sección): estadística simplificada, no un pase
  real simulado dentro del bucle de posesión. Al anotar cualquier tiro
  de campo (incluido el "y-uno" con falta), se sortea una probabilidad
  según el tipo de tiro (`ASSIST_PROBABILITY_BY_SHOT_TYPE` en
  `MatchEngine.js`: 0.55 bandeja, 0.5 tiro interior, 0.4 triple, 0.3
  media distancia — valores de partida, pendientes de calibración) y,
  si se cumple, se asigna a un compañero en pista distinto del anotador,
  por sorteo ponderado según VisiónJuego + Pase. Nunca en tiros libres.
  - **Decisión de encaje del prompt**: las probabilidades viven como
    constantes locales de `MatchEngine.js` (mismo patrón que
    `STARTER_WEIGHT`/`BENCH_WEIGHT`), no en `MatchConfig.js` — el propio
    prompt de esta sesión pedía explícitamente no tocar ese archivo.
- **Minutos jugados por jugador**: ya existían en `Rotation.js`
  (`playedSeconds`), solo se exponen ahora en cada línea de `boxScore`
  (`minutesPlayed`, en segundos) como paso de enriquecimiento al final
  de `simulateMatch()`. `null` (no `0`) cuando ese lado del partido no
  tuvo alineación real — para distinguir "no disponible" de "0 minutos
  jugados". Formato de UI elegido (minutos con un decimal, ej. "32.4"):
  **decisión NO confirmada con Dennis**, señalada explícitamente en el
  código (`formatMinutesSingle`/`formatMinutesDecimal`, `game.js`) — si
  prefiere MM:SS, es el único punto a cambiar.
- **+/- por jugador**: `Map<playerId, number>` inicializado a 0 para
  toda la convocatoria, acumulado posesión a posesión en el bucle
  principal de `simulateMatch()` (diferencial de puntos de esa posesión,
  sumado a los 5 en pista del lado ofensivo y restado a los 5 del lado
  defensivo). Con alineación real usa el `onCourt` ya vigente; sin ella,
  un nuevo sorteo de `selectOnCourtFive` (mismo placeholder de siempre)
  para que nunca quede sin calcular. Verificado con script Node: la suma
  de +/- de todos los jugadores de un equipo es exactamente
  `5 × diferencial final` (invariante matemática del +/-, confirma que
  el reparto posesión a posesión es correcto).
- **Valoración (PIR, índice FIBA/ACB/Euroliga)**: función pura
  `computeValoracion(stat)` en `MatchEngine.js`, sobre una línea de
  boxScore ya enriquecida. Dos campos nuevos necesarios para la fórmula:
  `foulsDrawn` (falta recibida, en falta en tiro/defensiva — no en
  técnica, que no tiene un "atacante" que la reciba) y
  `blockedAttempts` (tapón recibido por el lanzador, separado de
  `blocks` que ya solo contaba al taponador). Se usa solo
  `personalFouls` (ya incluye las técnicas, confirmado en
  `handleTechnicalFoul`) para no contar faltas dobles.
- **Enganche real** (`game.js`, `renderTeamBoxScore`): nuevas columnas
  Min (primera estadística tras el nombre), Val y +/- (con signo
  explícito y color verde/rojo, clases `.is-plus`/`.is-minus` en
  `game.css`, mismo par de colores que `.is-win`/`.is-loss`).
  `renderTeamTotals`: rebotes ofensivos/defensivos/totales en filas
  separadas, T2/T3/TL como `made/attempted (pct%)` (`0/0 (—)` si no hubo
  intentos), Asistencias y Valoración de equipo.
- **Medias de temporada** (`aggregatePlayerStats`/`renderStatsScreen`):
  nuevas columnas Min, Reb Of, Reb Def, Reb Tot, Ast, T2%, T3%, TL%, Val,
  +/- — los tres porcentajes se calculan SIEMPRE sobre los acumulados de
  temporada (`fg2Made/fg3Made/ftMade` y sus `*Attempted`), nunca como
  media de porcentajes partido a partido. Top 20 (antes 30). Cabeceras
  de columna clicables (`data-sort-key`, clase `.is-active-sort` en la
  activa): ordena `playerStats` por esa columna, descendente, ANTES de
  recortar a 20 — el ranking siempre refleja la columna elegida, incluso
  para los tres porcentajes (por el valor ya calculado, no por
  conseguidos en bruto). `state.statsSortKey` (nuevo, por defecto
  `'points'`) guarda la columna activa entre renders.
- **Manejo defensivo para partidos guardados antes de este cambio**:
  `?? 0`/`?? null` en `aggregatePlayerStats`, `renderTeamBoxScore` y
  `renderTeamTotals` — hoy no hay ningún sistema de guardado real
  todavía (CLAUDE.md: localStorage llega más adelante), así que este
  caso no es alcanzable en la práctica actual, pero queda protegido para
  cuando exista.
- **Verificado**: script Node sobre `MatchEngine.simulateMatch` (línea
  de boxScore con todos los campos nuevos, invariante de suma de +/-,
  ratio de asistencias/tiros anotados plausible); toda la suite de
  regresión existente (Calendar, CpuLineup, Recovery, Rotation, Fase 2,
  datos reales) sigue en verde; Playwright: convocatoria + alineación de
  5 titulares + partido completo revelado con boxScore/totales de
  equipo visibles (capturas de pantalla), y tabla de medias de temporada
  tras 2-3 jornadas con Top 20, ordenación por clic en varias columnas
  (incluidos los porcentajes) confirmada como descendente, sin errores
  de consola ni de página.
- **Confirmado**: no se ha tocado `src/core/MatchConfig.js` ni ninguna
  fórmula de acción de 7.6 ya calibrada — solo se añadieron campos de
  tracking y un paso de enriquecimiento posterior a la simulación.

## 2026-08-20 — Cierre de ciclo de temporada y pretemporada (DESIGN.md 3.4)

Cierra el ciclo abierto desde el inicio del proyecto: hasta ahora una
temporada terminaba y no pasaba nada (sin ascensos/descensos reales, sin
temporada siguiente). Cambio de orquestación puro en `src/ui/game.js` —
ninguno de `League.js`/`Bracket.js`/`Cup.js`/`Playoffs.js`/`Promotion.js`/
`Calendar.js`/`MatchEngine.js`/`Rotation.js`/`Recovery.js`/`CpuLineup.js`
se ha tocado (confirmado con `git diff --stat`).

- **Dos ligas reales en paralelo** (DESIGN.md 3.4.1): `state.leagues =
  { '1ª': League, '2ª': League }` sustituye al `state.league` singular
  de antes — las DOS divisiones están vivas desde que arranca la
  partida, no solo la del usuario. Accesores nuevos
  (`getUserLeague()`/`getBackgroundLeague()`/`getBrackets(division)`)
  centralizan la lectura; se revisaron y actualizaron todos los sitios
  que leían `state.league`/`state.cup`/`state.titlePlayoff`/
  `state.promotionPlayoff` a secas (Home, Calendario, Competiciones,
  Estadísticas, Alineación, `getActiveBracket`, `simulateNextRound`...).
  - `simulateBackgroundRound(division)`: resuelve de golpe, sin reveal,
    la jornada de la división que el usuario NO tiene abierta —
    disparada automáticamente al final de cada `simulateNextRound()`
    visible, nunca por separado. `createBracketsIfDue(division, league)`
    (Copa en jornada 17→18, Playoff/Ascenso al terminar jornada 34) se
    extrajo como función COMPARTIDA entre el camino visible y el de
    fondo — no se duplicó esa lógica.
  - `buildMatchOptionsResolver(league, userTeam)` generaliza el antiguo
    `buildLineupMatchOptionsResolver`: con `userTeam`, ese lado usa la
    alineación guardada por el usuario y cualquier otro lado usa
    `CpuLineup.buildCpuLineup`; sin `userTeam` (`buildCpuOnlyResolver`,
    usado por la división de fondo), TODOS los lados usan CPU. Mismo
    resolver, no uno nuevo por camino.
  - Los brackets de la división de fondo se resuelven de golpe
    (`drainBackgroundBrackets`, bucle `playNextGame()` hasta
    `isComplete`) en el mismo instante en que se crean — a diferencia
    del bracket visible, que sigue avanzándose partido a partido con el
    botón de siempre.
- **`sportingGoal` calculado** (DESIGN.md 3.4.3, nuevo
  `src/core/SeasonGoals.js`): sustituye el valor fijo `'Permanencia'`
  que `Team.js` asignaba a todo equipo real (señalado como señal inerte
  en el CHANGELOG de `CpuLineup.js`/7.11.7). Fórmula exacta de 3.4.3
  (`percentilPlantilla` vía el mismo cálculo de "overall del top8" que
  ya usa `scripts/rescale-real-attributes.js` — reimplementado aquí, no
  requerido desde ese script, que es un CLI de Node con `fs`/`path`, no
  cargable en el navegador) mapeada a los 4 `SPORTING_GOALS` por los
  umbrales de `CONFIG_BASE.seasonGoals` (nuevos, calibrables).
  - **Decisión no pedida explícitamente, señalada aquí**: además de
    ejecutarse en el cierre de ciclo (3.4.4), se ejecuta también una vez
    en `startSeason()` al arrancar una partida nueva — si no, la
    primera temporada de cualquier partida arrancaría con los 36
    equipos en `'Permanencia'` (el propio hueco que 3.4.3 dice cerrar),
    dejando inerte `CpuLineup.computeMatchImportance()` hasta el primer
    cierre de ciclo. Arrancar una partida es, conceptualmente, también
    una "pretemporada".
- **`closeSeasonAndPrepareNext()`** (DESIGN.md 3.4.2/3.4.4): disparado
  explícitamente por un botón en Inicio ("Cerrar temporada y empezar la
  siguiente"), visible solo cuando `isSeasonFullyClosable()` (las DOS
  divisiones han terminado su liga regular Y todos sus brackets). En
  orden: descienden los 2 últimos de 1ª, ascienden el campeón de liga
  regular de 2ª y el campeón del Playoff de ascenso (reutilizando
  `PromotionPlayoff.directPromotion`/`secondPromotedEntry` ya
  calculados, en vez de recalcular el campeón por cuenta propia) — SOLO
  cambia `team.division`, ningún atributo de jugador/equipo se toca;
  recalcula `sportingGoal` de los 36 con la composición ya actualizada;
  genera Cantera/Academia (`Team.generateAcademyIntake()`, conectado sin
  ninguna regla nueva); construye `Calendar`/`League` nuevas
  (`seasonStartYear + 1`); resetea los brackets de ambas divisiones. Si
  el equipo del usuario asciende/desciende, `state.division` le sigue —
  sigue viendo SU equipo, en la división que le corresponda ahora.
  - Pantalla/aviso simple pedido explícitamente por el prompt ("el
    usuario debe ver que ha pasado algo"): tarjeta de resumen en Inicio
    (quién asciende, quién desciende, la división nueva del propio
    equipo) — reutiliza el patrón visual ya existente de tarjetas
    (`.gm-card`) en vez de una pantalla nueva; no se tocó `game.css`.
    Visible hasta que el usuario juega la siguiente jornada.
- **Formato de minutos jugados** (Bloque 4, decisión ya tomada por
  Dennis, sustituye la decisión pendiente de la sesión de retoques de
  estadísticas): `MM:SS` (ej. `"32:24"`) en vez de decimal (`"32.4"`) —
  un único punto tocado (`formatMinutesMMSS`/`formatMinutesSingle`),
  usado tanto en el boxScore de partido como en las medias de temporada.
  Los datos de origen (segundos) no cambian.
- **Verificado**:
  - Script Node dedicado (`test-season-cycle.js`, reproduce la
    orquestación de `game.js` sobre los mismos módulos del motor, ya que
    `game.js` depende del DOM y no es requireable en Node): una
    temporada regular completa en las DOS divisiones sin que "el
    usuario" abriera nunca la de fondo — 34 jornadas, Copa/Playoff/
    Ascenso resueltos solos; ascienden/descienden los equipos correctos;
    ascender/descender NO modifica ningún atributo de ningún jugador
    (solo `division`); `sportingGoal` recalculado varía entre equipos
    (forzando un equipo con overall+reputación altísimos → "Pelear por
    el título" y uno bajísimo → "Evitar el descenso", confirmados);
    Cantera/Academia añade 3 jugadores por equipo.
  - Playwright (datos reales, sin servidor): partida completa de
    principio a fin — 34 jornadas + Copa + Playoff por el título +
    Playoff de ascenso de la división de fondo resuelto solo, cierre de
    temporada con resumen visible, y la temporada siguiente arrancando
    ya en jornada 1/34 (con el recién ascendido emparejado contra el
    equipo del usuario en la primera jornada) — sin errores de consola
    ni de página (aparte del ya conocido de Google Fonts).
  - Confirmado con `git diff --stat` que `League.js`, `Bracket.js`,
    `Cup.js`, `Playoffs.js`, `Promotion.js`, `Calendar.js`,
    `MatchEngine.js`, `Rotation.js`, `Recovery.js` y `CpuLineup.js` no se
    han tocado — todo el cambio vive en `game.js` y en el `SeasonGoals.js`
    nuevo (más una constante nueva en `MatchConfig.js`, pedida
    explícitamente por el Bloque 2).
