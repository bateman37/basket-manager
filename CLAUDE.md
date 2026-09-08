# CLAUDE.md — Contrato de trabajo del proyecto

Este archivo lo lee cualquier sesión de Claude Code antes de trabajar en
este repositorio. Es un contrato **breve**: reglas globales estables y el
protocolo de lectura. Las reglas de diseño, la arquitectura vigente y el
histórico detallado viven en documentos propios — sigue el protocolo de
lectura de la sección 6, no leas todo de golpe.

## 1. Sobre el usuario de este proyecto

Dennis es el diseñador/product owner, no programador (20 años sin tocar
código). Todo el código lo escribe Claude Code. Dennis revisa, prueba y
decide, pero no espera leer o editar código él mismo. Explica los cambios
en términos de qué hacen y por qué, no solo en términos técnicos. **No
tomes decisiones de diseño de juego (economía, reglas, progresión) que no
estén ya documentadas como vigentes — proponlas y espera confirmación.**

## 2. Stack técnico

- **JavaScript + HTML/CSS puro**, sin frameworks pesados — cualquier
  sesión debe poder abrir `index.html` en el navegador y ver el resultado
  sin pasos de compilación.
- Node.js solo para scripts de utilidad (datos, pruebas), no para servir
  el juego.
- **Persistencia real de partidas: implementada (SAVE-LOAD-1)** vía
  IndexedDB (3 ranuras manuales + autoguardado) — nunca `localStorage`
  para el payload principal, nunca `saves/` (reservado, sin uso real).
  `CareerPersistenceBoundary.js` es el proyector canónico REAL (dejó de
  ser una sonda); `CareerHydrationService.js` hidrata en dos fases;
  `src/storage/IndexedDbCareerSaveRepository.js` es el único punto que
  toca IndexedDB. Contrato completo: `docs/architecture/
  persistence-boundary.md`. No reinterpretes estas decisiones (formato de
  guardado, orden de reconstrucción, reproducción silenciosa de
  partidos ya jugados) sin comentarlo antes.

## 3. Estructura de carpetas

```
basket-manager/
├── DESIGN.md, CLAUDE.md, CHANGELOG.md   # entrada — ver protocolo abajo
├── docs/                                # diseño, arquitectura, histórico
├── index.html                           # punto de entrada del juego
├── data/{fictional,real}/                # jugadores/equipos — real/ nunca se pisa
├── src/{core,entities,economy,ui,utils}/ # motor, entidades, interfaz
├── scripts/                              # utilidades, pruebas, smokes
└── saves/                                # reservado — sin uso real todavía
```

## 4. Convenciones

- Nombres de archivos y variables en inglés; comentarios de código en
  español.
- Cada sistema nuevo grande debe poder probarse abriendo `index.html` sin
  configuración adicional (pestaña "Modo prueba", ver `docs/design/
  game-ui-decisions.md`).
- **Datos reales** (`data/real/`): nunca se sobrescriben ni se rellenan
  con datos inventados presentados como reales. Sin datos reales
  disponibles, usa el generador ficticio y señálalo explícitamente
  (`dataSource`). Evita logos/escudos con marcas registradas.

## 5. Separación de dominios (siempre vigente)

- **Interfaz** (`src/ui/game.js`) nunca contiene una regla de juego
  propia — es una capa de presentación sobre el motor/dominio ya
  existente.
- **Un jugador vive en el Player Registry mundial**
  (`state.playerRegistry`); `Team.roster` son solo referencias afiliadas,
  nunca el índice global.
- **Participación en competición se resuelve SOLO por `CompetitionEntry`**
  — nunca por división, nombre visible de liga, ni "la primera del
  array". `clubId` identifica un `Club` (empleador/negociación/cantera);
  `teamId` identifica un `Team` (participación deportiva/plantilla/acta).
  Ver `docs/architecture/` para el detalle completo de estos contratos.
- Contrato, licencia/inscripción, afiliación de plantilla (roster) y AIP
  de mercado son conceptos DISTINTOS — ninguno de ellos concede o
  sustituye a otro. El detalle vive en `docs/design/contracts.md`,
  `registration-eligibility.md`, `market.md`, `transfers.md`, `loans.md`.
- Dinero siempre en unidad mínima entera + ISO 4217; fechas contractuales
  siempre civiles ISO — nunca floats de euros ni `Date.now()` dentro del
  dominio (`src/utils/Money.js`, `LocalDate.js`).
- España (ACB/Primera FEB) es **contenido** instalado sobre un mundo
  genérico (`GameWorld`), nunca el alcance ontológico del motor — ver
  `docs/architecture/world-model.md`.

## 6. Protocolo de lectura al empezar una sesión

1. Lee este archivo.
2. Lee `docs/STATUS.md` (foto del estado actual, qué está verificado).
3. Lee `docs/EPIC_CONTEXT.md` (tarea activa, si la hay, y su alcance
   autorizado).
4. Abre la ficha de la Epic activa (`docs/epics/`) y **solo** los
   documentos de diseño/arquitectura que esa ficha señale como
   imprescindibles.
5. Si falta una ruta, consulta el índice de `DESIGN.md` o
   `docs/CODE_MAP.md` — no hay que leer `DESIGN.md` entero antes de
   implementar nada; consulta el índice y abre solo el documento
   temático relevante.
6. Busca símbolos reales (`rg`) y lee el código con contexto suficiente
   antes de tocarlo.

No recorras recursivamente todos los enlaces ni leas por defecto
`docs/history/`, el roadmap completo o un archivo `.js` grande entero. Si
el paquete inicial no basta para trabajar con seguridad, amplía la
lectura de forma dirigida — el ahorro de contexto nunca justifica ignorar
una dependencia real.

## 7. Durante el trabajo

- Actualiza cada regla en su ubicación canónica (un documento la define;
  los demás enlazan) — nunca la copies a la vez a `CLAUDE.md`,
  `DESIGN.md`, `docs/STATUS.md` y `CHANGELOG.md`.
- Consulta `docs/history/`/fichas de Epic pasadas solo para una duda
  concreta, no como lectura de fondo.
- No lances varios agentes a releer los mismos documentos grandes sin
  necesidad.
- **Pruebas según impacto**: si tocas dominio/motor, ejecuta como mínimo
  los scripts de prueba que cubran ese dominio (`scripts/test-*.js`,
  `scripts/smoke-*.js` relevantes) — no la matriz completa del repo por
  rutina. El alcance mínimo exigido para la Epic activa lo fija su ficha.

## 8. Al cerrar una Epic o sesión

- Actualiza la ficha de la Epic (`docs/epics/<ID>.md`) con resultado,
  pruebas realmente ejecutadas y deuda aplazada.
- Actualiza `docs/STATUS.md` solo en lo que cambió — no marques nada como
  verificado porque la Epic se haya fusionado.
- Actualiza el documento de diseño/arquitectura si cambió una decisión, y
  `docs/CODE_MAP.md` si cambió una responsabilidad o símbolo relevante.
- Añade una entrada breve a `CHANGELOG.md` (resumen + enlace a la ficha)
  — no vuelvas a pegar el informe completo en la raíz.
- Deja `docs/EPIC_CONTEXT.md` limpio y coherente; no arranques la
  siguiente Epic sin instrucción explícita de Dennis.

## 9. Trabajo ajeno y fusiones

Respeta el trabajo de otras sesiones/ramas — no fusiones automáticamente
cambios ajenos ni asumas que una rama antigua debe rehacerse. Si continúas
una sesión anterior sobre la misma Epic, comprueba primero su ficha y el
estado real de Git antes de repetir trabajo ya hecho.

## 10. Qué NO hacer sin confirmar con Dennis primero

- No introducir frameworks, librerías de pago ni dependencias pesadas.
- No tomar decisiones de diseño de juego que no estén ya documentadas
  como vigentes.
- No borrar ni sobrescribir `data/real/` con datos ficticios.
- No reinterpretar decisiones ya tomadas en `docs/design/
  game-ui-decisions.md` (datos reales en selección de equipo, instancias
  reales de `Player`/`Team`, `dataSource` fuera del constructor, modelo
  de revelado de partido) sin comentarlo antes.
- No reinterpretar la arquitectura de guardado de SAVE-LOAD-1 (formato de
  envelope, orden de reconstrucción por dependencias, reproducción
  silenciosa de partidos ya jugados sin RNG/callbacks) sin comentarlo
  antes — ver `docs/architecture/persistence-boundary.md`. `saves/` sigue
  sin uso real (la persistencia vive en IndexedDB).
