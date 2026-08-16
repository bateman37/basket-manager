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
