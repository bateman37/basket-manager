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
