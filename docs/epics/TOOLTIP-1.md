# Ficha de Epic — TOOLTIP-1 (ayuda táctica contextual)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `TOOLTIP-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Ayuda táctica contextual (tooltips, glosario).
- **Documento(s) canónico(s) vigente(s)**: `docs/design/tactics/roadmap.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 7410-7573 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-22 — TOOLTIP-1: ayuda táctica contextual (DESIGN.md 7.12.36)

Entrega corta de UX sobre el sistema táctico ya completo (TAC-1 a TAC-7),
no una octava entrega de la EPIC. Añade una capa de ayuda contextual
reutilizable para todo concepto táctico visible en la pantalla de
Tácticas que no es autoexplicativo sin conocimiento previo de baloncesto
profesional. No toca ninguna fórmula, catálogo ni archivo de `src/core/`
— confirmado por `git diff --stat` (ver más abajo) y por el script de
verificación de esta sesión.

### 1. Fuente única de contenido: `src/ui/TacticsHelp.js` (nuevo)

- **Decisión de arquitectura** (sección 7.12.36 de `DESIGN.md`, con el
  razonamiento completo): opción (B), archivo nuevo de presentación pura
  sobre `Tactics.js`/`MatchConfig.js`, en vez de (A) meter metadata dentro
  de `Tactics.js`. Se descartó (A) por ser el archivo más grande y crítico
  del proyecto — mezclar texto de presentación ahí aumenta el riesgo de
  que una sesión futura que "solo edite el texto" toque el motor por
  accidente.
- **97 entradas** (`ENTRIES`, mapa por id), cubriendo: los 5 ejes de
  identidad ofensiva (Ritmo/Early offense/Movimiento de balón/Uso de
  P&R/Rigidez — señalando explícitamente que los tres primeros NO tienen
  todavía ningún consumidor real en el motor, solo se guardan en el
  perfil, auditado leyendo `MatchEngine.js`/`Tactics.js` completos antes
  de escribir el texto), 4 spacings, 7 play-types/familias (incluidos
  Handoff/Off Screen/Motion Flow, marcados "sin motor propio todavía"), 5
  coberturas de P&R (Hedge/Blitz señalados como valores idénticos en
  CONFIG), 15 roles ofensivos y 10 defensivos, 15 `PlayDefinition` del
  Playbook (9 familias + 6 variantes situacionales de ATO/BLOB/SLOB/Late
  Clock/Last Possession), 4 esquemas defensivos, 2 tipos de press, 3
  reglas de doble equipo de poste, 5 tipos de situación especial, 2
  reglas de situación (Auto Timeouts/Falta táctica), 12 valoraciones de
  quinteto y 5 conceptos del informe de rival/Data Hub (PPP, ORtg, DRtg,
  Net Rating, muestra pequeña), más 3 conceptos generales (Familiaridad
  Táctica, conversión puntuación→estrellas, matchups individuales).
- **Regla seguida estrictamente**: cada `engineEffect` se redactó DESPUÉS
  de localizar el código real que lo implementa (funciones citadas en los
  comentarios de `Tactics.js`, valores de `config.tactics.*` en
  `MatchConfig.js`), nunca al revés. Cuando un concepto existe en el
  catálogo pero sin motor propio (Handoff/DHO, Off Screen, Motion/Flow;
  los 3 ejes de identidad sin consumidor), el texto lo dice explícitamente
  en vez de inventar un efecto — incluyendo el propio Hedge/Blitz, cuyo
  texto refleja que el motor comparte literalmente sus valores de CONFIG
  en vez de inventar una diferencia de comportamiento que no existe.
- **Etiquetas cortas de `game.js` (`SPACING_LABELS`, `PNR_COVERAGE_LABELS`,
  etc.) NO se fusionan con esta fuente** — auditado su uso real (docenas
  de usos en `<select>`/tablas compactas) antes de decidir NO fusionar,
  señalado explícitamente en `DESIGN.md` 7.12.36 con el motivo exacto
  (forzaría a `game.js` a cargar texto largo que no necesita para
  renderizar un desplegable, y el orden de carga en `index.html` va al
  revés de lo que exigiría la fusión).

### 2. Icono de ayuda + Glosario en `game.js`/`game.css`

- **Icono "ⓘ"** (`helpIconHtml(id)`, `game.js`): un `<button>` real junto a
  cada concepto con ayuda en las 7 sub-pestañas existentes de Tácticas
  (Resumen, Ataque, Roles, Playbook, Defensa, Situaciones, Rival) — 29
  puntos de inserción distintos. Al pulsarlo (click de ratón o tap táctil,
  ambos disparan el mismo evento `click` nativo del botón, sin necesitar
  un listener `touchstart` aparte) se abre un panel con el contenido de
  `BasketManager.TacticsHelp`; un botón de cerrar explícito además del
  propio icono en modo toggle.
- **Estado de "qué tooltip está abierto"**: `container.dataset.openHelpId`
  (atributo del propio `#gm-tactics`, mismo patrón que
  `dataset.activeTab`) — vive fuera de `state` porque no es un dato de
  partida guardable. Sobrevive al `container.innerHTML = ...` completo
  que dispara cualquier cambio en esta pantalla (vive en el nodo
  contenedor, nunca sustituido), así que abrir/cerrar un tooltip nunca
  pierde el valor de un slider/select recién cambiado; cambiar de
  sub-pestaña resetea `openHelpId` explícitamente para no dejar un
  tooltip fantasma de la pestaña anterior.
- **Bug real encontrado y corregido durante la propia verificación
  Playwright de esta sesión**: la primera versión del panel usaba
  `<div>`/`<p>` (bloque) anidados dentro del icono. Como varios puntos de
  inserción viven dentro de un `<p>` ancestro (ej. la línea "Spacing:" de
  Resumen) o de un `<label>`/`<h3>`, el parser HTML5 cierra
  IMPLÍCITAMENTE el `<p>` en cuanto encuentra el primer `<div>` en
  cualquier profundidad de anidamiento (regla de "implied end tag" de
  `<p>`) — esto sacaba el panel entero fuera de `.tactics-help-wrap` en el
  DOM real, rompiendo su `position:absolute` (perdía el ancestro
  `position:relative`) y haciendo que el panel apareciera en la esquina
  superior izquierda de la pantalla en vez de junto a su icono,
  bloqueando además el propio click de cierre. Detectado con
  `boundingBox()` de Playwright (el panel aparecía en `{x:0, y:24}` en vez
  de junto al icono) antes de escribir el resto del script de pruebas.
  Corregido sustituyendo `<div>`/`<p>` por `<span>` (contenido de fraseo,
  nunca dispara ese cierre implícito) tanto en el panel
  (`.tactics-help-panel`/`.tactics-help-panel__header`) como en cada fila
  de contenido (`tacticsHelpBodyHtml()`, ahora `.tactics-help-row`), con
  `display:block`/`display:flex` en CSS para conservar el mismo layout
  visual.
- **Glosario** (`renderTacticsGlossaryTab`, 8ª sub-pestaña de
  `TACTICS_TABS`): reutiliza literalmente `tacticsHelpBodyHtml()` sobre
  `BM.TacticsHelp.listByCategory()` — todas las entradas ya expandidas,
  agrupadas por categoría, sin necesitar abrir cada icono una a una. Se
  eligió una sub-pestaña más en vez de un botón/acceso aparte por ser el
  patrón de navegación que esta pantalla ya usa para sus 7 vistas
  existentes.
- **Corrección incidental descubierta en la auditoría** (no es una
  decisión de diseño): `LINEUP_RATING_LABELS` en `game.js` solo tenía 9 de
  las 12 claves que devuelve `Tactics.computeLineupRatings` desde TAC-7 —
  `transitionOffense`/`poaDefense`/`tacticalExecution` mostraban el texto
  literal "undefined" en la tabla de Resumen (la tabla itera TODAS las
  claves devueltas, no solo las 9 documentadas en el prompt de esta
  sesión). Corregidas las 3 etiquetas que faltaban, imprescindible además
  para que esas 3 filas pudieran tener un icono de ayuda coherente.
- `smallSampleBadgeHtml` (pestaña Rival) migrado de `title=` (tooltip
  nativo del navegador, no funciona con tap en móvil) al mismo patrón de
  icono/panel que el resto de la pantalla, por consistencia y soporte
  táctil real.

### 3. `DESIGN.md` — nueva subsección 7.12.36

Documenta la decisión de arquitectura completa (B, con el motivo de
descartar A y de no fusionar las labels de `game.js`), el shape de cada
entrada, la cobertura exacta (97 entradas por categoría) y lo
explícitamente fuera de alcance (celdas numéricas de tablas ya explicadas
por su propio párrafo `gm-muted`; `GamePlan`/matchups de partido en vivo,
que no viven en esta pantalla). Confirma que ningún id interno cambió y
que `Tactics.js`/`MatchConfig.js` no se tocaron.

### 4. Verificación (scripts de scratchpad de sesión, no en el repo)

- **Cobertura/integridad** (Node): recorre `OFFENSIVE_ROLES`,
  `DEFENSIVE_ROLES`, `PLAY_DEFINITIONS`, `PNR_COVERAGES`, `BASE_SCHEMES`,
  `PRESS_TYPES`, `POST_DOUBLE_TEAM_RULES`, `SITUATION_TYPES`,
  `SPACING_OPTIONS`, los 4 play-type weights y los 5 ejes de identidad —
  **97/97 ids cubiertos**, las 97 claves de `ENTRIES` coinciden
  exactamente con su propio campo `id`, shape mínimo completo en las 97.
  `git diff --stat`: `DESIGN.md`, `index.html`, `src/ui/game.css`,
  `src/ui/game.js` (+ `src/ui/TacticsHelp.js` nuevo, no listado por `git
  diff` al no estar trackeado) — ninguno de `Recovery.js`/`Calendar.js`/
  `League.js`/`CpuLineup.js`/`Rotation.js`/`Player.js`/`Team.js`/
  `MatchEngine.js`/`Bracket.js`/`Playoffs.js`/`Cup.js`/`Promotion.js`/
  `SeasonGoals.js`/`Tactics.js`/`MatchConfig.js` aparece en el diff.
- **Playwright** (recorrido completo: landing → Empezar temporada →
  equipo real → convocar 8 jugadores en Alineación → Tácticas): las 8
  sub-pestañas (7 + Glosario) presentes; en las 7 con icono visible en
  este estado de partida se abrió y cerró un tooltip con click, se abrió
  con tap y se cerró con el botón de cerrar del panel — sin excepciones.
  Cambiar el slider de Ritmo en Ataque DESPUÉS de abrir/cerrar un tooltip
  en esa misma pestaña aplicó el cambio correctamente (valor 80
  confirmado) sin dejar ningún tooltip residual; cambiar de sub-pestaña
  con un tooltip abierto lo cerró (sin tooltip fantasma de la pestaña
  anterior). Glosario listó las 97 entradas ya expandidas. Cero errores
  de consola nuevos (descartados solo la Google Font externa sin salida
  de red de este entorno y el favicon.ico que el servidor estático mínimo
  del propio script de scratchpad no sirve, ninguno de los dos real de la
  aplicación).

### Pendiente explícitamente fuera de esta entrega

- Selector de idioma real — la estructura (`id` interno en inglés → texto
  en español por entrada) queda preparada para añadir un segundo bloque
  de textos por id en el futuro, sin tocar el motor ni renombrar ids,
  pero no se implementa ningún selector ahora (fuera de alcance explícito
  del prompt de esta sesión).
- Persistir qué tooltips ha visto ya el usuario — no hay ninguna señal de
  que haga falta todavía; si aparece, es una propuesta a validar antes de
  añadir un campo nuevo a `TacticalProfile`/`Team` (esta entrega confirma
  que no hizo falta ninguno).
- Tooltips en pantallas distintas de Tácticas (ej. Alineación) — fuera de
  alcance de TOOLTIP-1.
