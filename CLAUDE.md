# CLAUDE.md — Instrucciones técnicas del proyecto

Este archivo lo lee cualquier sesión de Claude Code antes de trabajar en
este repositorio. Contiene convenciones técnicas. Las reglas de diseño del
juego están en `DESIGN.md` — léelo también antes de implementar cualquier
sistema de juego (economía, fichajes, simulación, etc.).

## Sobre el usuario de este proyecto

Dennis es el diseñador/product owner del proyecto, no programador (lleva
20 años sin tocar código). Todo el código lo escribe Claude Code. Dennis
revisa, prueba y decide, pero no espera tener que leer o editar código él
mismo. Explica los cambios en términos de qué hacen y por qué, no solo en
términos técnicos.

## Stack técnico

- **JavaScript + HTML/CSS puro**, sin frameworks pesados (nada de React,
  Vue, build steps complejos) — el objetivo es que cualquier sesión pueda
  abrir un archivo `.html` en el navegador y ver el resultado
  inmediatamente, sin pasos de compilación.
- Node.js solo se usa si hace falta para scripts de utilidad (por ejemplo,
  generar datos, procesar JSON de jugadores), no para servir el juego.
- Persistencia de partidas: localStorage del navegador por ahora (no hay
  backend ni base de datos externa en esta fase).

## Estructura de carpetas

```
basket-manager/
├── DESIGN.md              # reglas del juego — leer antes de implementar sistemas
├── CLAUDE.md               # este archivo
├── CHANGELOG.md            # registro de qué se hizo en cada sesión
├── index.html              # punto de entrada del juego
├── data/
│   ├── fictional/           # jugadores/equipos ficticios (fase de arranque)
│   └── real/                # datos reales (ACB, LEB, clubes europeos) — se construye progresivamente
├── src/
│   ├── core/                # motor de simulación (partidos, temporadas, calendario)
│   ├── entities/             # clases/estructuras: Jugador, Equipo, Liga, Directiva
│   ├── economy/              # módulo económico (presupuesto, ingresos, gastos)
│   ├── ui/                   # pantallas e interfaz
│   └── utils/
└── saves/                   # exports/imports de partidas guardadas (JSON)
```

## Convenciones

- Nombres de archivos y variables en inglés (estándar de programación),
  comentarios de código en español.
- Cada sistema nuevo grande (economía, fichajes, simulación de partidos...)
  debe poder probarse abriendo `index.html` sin configuración adicional.
- Antes de implementar cualquier regla de juego, comprobar `DESIGN.md`.
  Si `DESIGN.md` no cubre el caso, señalarlo explícitamente en la
  respuesta en vez de asumir una regla no acordada.
- Actualizar `CHANGELOG.md` al final de cada sesión con un resumen breve
  de qué se implementó.

## Datos reales de jugadores/clubes (importante)

Este proyecto usa **nombres reales** de jugadores y clubes para uso
privado (ver nota legal en `DESIGN.md`, sección 12). La construcción de
esta base de datos real es un proceso progresivo y separado del
desarrollo del motor — no generar de golpe cientos de jugadores reales
"inventándose" estadísticas; si no hay datos reales disponibles para un
jugador/equipo, usar el generador ficticio y señalarlo claramente en vez
de presentar datos inventados como si fueran reales.

## Sobre nombres oficiales de marcas/competiciones

Evitar el uso de logos, escudos o assets gráficos con marcas registradas.
Los nombres de ligas y competiciones ficticias (si se usan en vez de los
reales) deben quedar claramente diferenciados en `DESIGN.md`.

## Interfaz de juego (`src/ui/game.js` + `src/ui/game.css`)

`index.html` tiene dos entradas independientes, elegidas desde una landing
con dos botones:

- **Modo prueba**: todo el contenido técnico original de `index.html`
  (generación de jugadores/equipos, simulación de un partido suelto,
  pruebas de estrés del motor, pruebas de Liga/Playoffs/Copa/Ascenso). Vive
  tal cual estaba, sin lógica propia añadida — solo queda envuelto en un
  contenedor que se oculta/muestra. Cualquier sesión que añada una nueva
  prueba técnica de un sistema del motor debe seguir añadiéndola aquí,
  como hasta ahora.
- **Empezar temporada**: la interfaz real de juego, implementada en
  `src/ui/game.js` (lógica) y `src/ui/game.css` (estilos). Es una capa de
  presentación sobre el motor existente — no contiene ninguna regla de
  juego propia, todas las reglas activas ya estaban en `DESIGN.md` antes
  de escribir esta interfaz (Liga 3.1, Playoffs/Copa/Ascenso 3.2). Si una
  sesión futura necesita tocar esta interfaz, debe seguir estas
  decisiones ya tomadas, en vez de reinterpretarlas:
  - Selección de equipo: **solo datos reales** del bundle
    (`data/real/real-data-bundle.js`), nunca ficticios — decisión de
    producto, no está en `DESIGN.md` porque es de interfaz, no de reglas
    de juego.
  - Jugadores/equipos se reconstruyen siempre como **instancias reales**
    de `Player`/`Team` (nunca objetos planos) a partir del bundle — mismo
    patrón que ya usa `scripts/import-real-data.js` y la antigua sección
    de prueba de la Liga real. Si se añade otra fuente de datos (por
    ejemplo, un futuro roster editado en partida), debe reconstruirse
    igual, nunca operarse como JSON plano directamente en la UI.
  - El campo `dataSource` de cada jugador sigue **fuera** del constructor
    de `Player` (se asigna aparte tras instanciar) — no integrarlo dentro
    del constructor si se toca este archivo.
  - Revelado progresivo por cuartos en la pantalla de partido: el motor
    (`MatchEngine.simulateMatch`) no tiene punto de entrada por cuartos y
    no se le debe añadir uno solo para esto — resuelve el partido entero
    de una vez. La pantalla simula primero de golpe y luego **revela**
    `result.quarterScores` cuarto a cuarto en la interfaz. Cualquier
    "simulación en vivo" futura debe seguir este mismo patrón (calcular
    ya, revelar poco a poco), no forzar al motor a pararse a mitad de
    partido.
  - La progresión de jornada (Copa en jornada 17, Playoff por el título /
    Playoff de ascenso al terminar la liga regular) se dispara desde
    `simulateNextRound()` en `game.js`, reutilizando `createCup`,
    `createTitlePlayoff` y `PromotionPlayoff` tal cual — no se ha tocado
    ninguno de los tres.
  - Alineación por slots (sesión "Alineación por slots + Minutos de la
    basura"): la tabla de "Alineación por posición" tiene 5 filas (una por
    posición) × 3 columnas de slot (Titular, Suplente 1, Suplente 2). Cada
    slot es un desplegable de convocado + minutos, independiente de los
    demás — un mismo jugador puede repetirse en varios slots/filas sin
    restricción. Esto sustituye al modelo anterior de "una entrada por
    jugador" (una posición declarada + una cuota) tanto en
    `src/core/Rotation.js` (`lineup.entries`) como en la pantalla. Si una
    sesión futura toca esta pantalla, debe seguir este modelo de slots, no
    volver al de una entrada por jugador. Las valoraciones en estrellas
    (Técnica/Física/Mental/Resistencia/Energía/Forma, DESIGN.md 7.11.6) se
    muestran en la lista de convocatoria (checkboxes), no en una tarjeta
    aparte por jugador — esa tarjeta desapareció al introducir la tabla de
    slots.
  - Checkbox "Permitir minutos de la basura" (DESIGN.md 7.11.2-bis): vive
    en `lineup.garbageTime.enabled`, por defecto desactivado, opción de
    partido (no de club/global).

## Qué NO hacer sin confirmar con Dennis primero

- No introducir frameworks, librerías de pago, o dependencias pesadas sin
  preguntar.
- No tomar decisiones de diseño de juego (economía, reglas, progresión)
  que no estén ya en `DESIGN.md` — proponerlas y esperar confirmación.
- No borrar ni sobrescribir datos en `data/real/` al generar datos
  ficticios de prueba.
- No reinterpretar las decisiones ya tomadas en "Interfaz de juego" de
  este archivo (selección solo de datos reales, instancias reales de
  Player/Team, dataSource fuera del constructor, revelado progresivo por
  cuartos) sin comentarlo antes con Dennis.
