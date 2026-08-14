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

## Qué NO hacer sin confirmar con Dennis primero

- No introducir frameworks, librerías de pago, o dependencias pesadas sin
  preguntar.
- No tomar decisiones de diseño de juego (economía, reglas, progresión)
  que no estén ya en `DESIGN.md` — proponerlas y esperar confirmación.
- No borrar ni sobrescribir datos en `data/real/` al generar datos
  ficticios de prueba.
