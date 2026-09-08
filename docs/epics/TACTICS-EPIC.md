# Ficha de Epic — Sistema táctico (TAC-1 a TAC-7)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `TACTICS-EPIC`
- **Estado**: cerrada (histórica)
- **Objetivo**: Sistema táctico completo, TAC-1 a TAC-7 (núcleo de posesión, identidad+roles, playbook, defensa avanzada, partido vivo, familiaridad, Data Hub).
- **Documento(s) canónico(s) vigente(s)**: `docs/design/tactics/roadmap.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 5405-7217 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-20 (2) — TAC-1: núcleo táctico de posesión — Pick & Roll (DESIGN.md 7.12.33)

Primera entrega de las 7 planificadas del sistema táctico (7.12). Solo lo
mínimo de esta entrega: cobertura de P&R por equipo, quién participa en un
Pick & Roll central y con qué ventaja/lectura se resuelve — sin spacing,
roles, playbook, defensa avanzada, IA táctica ni Data Hub (eso es TAC-2 a
TAC-7, no adelantado).

- **`src/core/Tactics.js`** (módulo nuevo, `MatchEngine.js` importa de
  aquí, nunca al revés — 7.12.2):
  - `TacticalProfile`: solo la cobertura de P&R por defecto del equipo
    (`drop`/`under`/`switch`/`hedge`/`blitz`; `hedge` es alias de
    comportamiento de `blitz` en esta entrega — High Drop/Show/ICE quedan
    reservados en el catálogo pero sin comportamiento propio todavía).
  - `PossessionPlan`: sortea si la posesión es un P&R central
    (`config.tactics.pnrFrequency`) y elige `handler`/`screener` del
    quinteto real (`getOnCourtFive` vía `MatchEngine`), con los mismos
    criterios de peso que ya usaban `usageWeight`/`onBallDefenderWeight`.
  - `DefensivePlan`: lee la cobertura del equipo defensor (fallback
    `'drop'` si no tiene perfil) y elige `screenerDefender` del quinteto
    real defensivo.
  - `AdvantageState`: `advantageScore` (-1..+1) calculado UNA vez por
    posesión de P&R, reutilizando `computeMixRating` (con Fatiga/
    Consistencia/Presión de Momento ya incluidos, igual que el resto del
    motor) y `Rotation.getPenalty()` (penalización de versatilidad,
    7.11.3) — nunca reimplementados. Switch se modela como un
    intercambio real de a quién se evalúa en qué rol (el defensor del
    bloqueador pasa a ser el defensor de perímetro efectivo y viceversa),
    no solo una etiqueta.
  - Bifurcación de lectura en 3 ramas (`low`/`small`/`clear`) que decide
    QUIÉN tira y CONTRA QUIÉN, resuelto siempre por el catálogo de
    acciones YA EXISTENTE en `simulatePossession` (7.6) — esta capa nunca
    decide si el tiro entra, ni inventa un resolver de tiro/pérdida/falta
    nuevo (regla de integración #1, 7.12.30).
- **`src/core/MatchEngine.js`**: puntos de enganche mínimos —
  `options.homeTacticalProfile`/`awayTacticalProfile` en
  `simulateMatch()`, `offenseTacticalProfile`/`defenseTacticalProfile` en
  el contexto de posesión, y en `simulatePossession()` un `tacticalPlan`
  que (solo si hay P&R) reasigna `ballHandler`/`onBallDefender`/
  `shotDefender`/`shotType` justo antes de la selección de tiro existente,
  sin duplicar ningún resolver de 7.6. Sin `TacticalProfile` asignado, el
  bucle 1v1 de siempre queda exactamente igual (7.12.34).
- **`src/core/MatchConfig.js`**: bloque `tactics` nuevo (pesos de mezcla
  por cobertura, `pnrFrequency`, `advantageScore` — sensibilidad, ruido,
  umbrales `smallAdvantage`/`clearAdvantage` — todo como datos, no lógica
  hardcodeada en `MatchEngine.js`).
- **`index.html`**: añadido `<script src="src/core/Tactics.js">` antes de
  `MatchEngine.js` — **cambio no incluido en la lista de archivos
  permitidos que pedía el prompt de esta sesión (solo `MatchConfig.js`/
  `MatchEngine.js`/`Tactics.js`), señalado explícitamente aquí**: sin esta
  línea, `MatchEngine.js` no encuentra `planPnrPossession` en el
  navegador (patrón UMD, `global.BasketManager`) y CUALQUIER partido real
  rompería. Es un cambio de cableado obligatorio, no una decisión de
  diseño nueva.

### Invariantes de balance demostrados (7.12.31), con script Node dedicado

Script de verificación en el scratchpad de la sesión (no forma parte del
repo, reutiliza `computeMixRating`/`getAttribute` — exportados de
`MatchEngine.js` solo para poder testear `AdvantageState` en aislamiento
sin el ruido de un partido completo):

- **Invariante #1** (Drop explotable por un tirador): mismo handler y
  screener, `advantageScore` medio: Drop `0.45`, Under `0.65`, Switch
  `-0.07`, Blitz `-0.18` — un handler con gran tiro exterior saca más
  ventaja de Drop/Under que de Switch/Blitz; sin amenaza exterior, Under
  deja de ser aprovechable (invariante #4, usado para reforzar #1).
- **Invariante #2** (Blitz premia pasadores capaces): con un roller de
  gran VisiónJuego+Pase, Blitz sube a `advantageScore≈0.27` (frente a
  `≈0.00` con un roller que no lee); en frecuencia de lectura sobre 300
  posesiones, el roller inteligente produce lecturas `small`/`clear` en
  ~287/300 frente a ~13/300 del roller que no lee.
- **Invariante #3** (mismatch real de Switch): con un pívot lento de
  defensor del bloqueador, Switch sube a `advantageScore≈0.28` (frente a
  `≈-0.56` con un pívot móvil); en 60 posesiones de prueba forzando
  Switch, ese pívot lento termina siendo el defensor real y efectivo del
  balón (`effectiveOnBallDefender`) en ~53/60 — mismatch visible en el
  resultado final, no solo en el número.
- **Regresión**: sin `TacticalProfile` en ningún equipo,
  `planPnrPossession()` devuelve `null` siempre (nunca sortea P&R); 12
  partidos completos simulados sin ninguna opción táctica dan medias de
  puntos/pérdidas por equipo en rango realista, igual que antes de esta
  sesión.
- Suite de regresión previa re-ejecutada
  (`verify-real-data-import.js`, `test-season-cycle.js`, `test-phase2.js`):
  sin cambios de comportamiento. Dos scripts de scratchpad muy antiguos
  (`test-rotation-engine.js`, `test-player-team-relation.js`) fallan por
  un formato de posiciones obsoleto anterior a la migración a mapa de
  posiciones (6.1) — confirmado que fallan igual SIN los cambios de esta
  sesión (`git stash`), no es una regresión de TAC-1.
- Playwright: sesión completa (selección de equipo real, varias jornadas
  jugadas sin ningún perfil táctico asignado) sin errores nuevos de
  consola/página.
- Confirmado con `git diff --stat` que solo `MatchConfig.js`,
  `MatchEngine.js`, `Tactics.js` (nuevo) e `index.html` (una línea de
  cableado, ver arriba) cambiaron — `Rotation.js`, `Recovery.js`,
  `Calendar.js`, `League.js`, `Bracket.js`, `Cup.js`, `Playoffs.js`,
  `Promotion.js`, `CpuLineup.js`, `game.js`, `Team.js` y `Player.js` no se
  tocaron.

### Decisiones/interpretaciones señaladas explícitamente (no cerradas como diseño definitivo)

- **Todos los valores numéricos de `config.tactics`** (`pnrFrequency:
  0.3`, `coverageBaseScore` por cobertura, `sensitivity: 0.1`,
  `noiseSigma: 0.08`, `handlerWeight`/`screenerWeight`/
  `onBallDefenderWeight`/`screenerDefenderWeight`, `thresholds.
  smallAdvantage: 0.15`/`clearAdvantage: 0.5`, `recoveringDefenderPenalty:
  1.5`) son valores de partida elegidos para poder demostrar los
  invariantes de 7.12.31 con margen — **pendientes de calibración
  (7.12.31)**, comentados así en el propio `MatchConfig.js`. `sensitivity`
  y `clearAdvantage` se recalibraron una vez durante esta sesión
  (`0.025→0.1`, `0.45→0.5`) porque los valores iniciales nunca dejaban que
  ninguna diferencia de atributos realista cruzara el umbral.
- **`hedge` como alias de comportamiento de `blitz`**: el catálogo de
  7.12.16 los distingue, pero esta entrega no diferencia su
  comportamiento — ambos usan las mismas fórmulas de `AdvantageState`.
- **`TacticalProfile` no vive en `Team.js`**: 7.12.2 lo describe como
  estado persistente del equipo/partida, pero la lista de archivos
  permitidos de esta entrega no incluía `Team.js`/`Player.js`. Se pasa de
  forma efímera por partido vía `options.homeTacticalProfile`/
  `awayTacticalProfile` de `simulateMatch()` — mismo patrón que
  `homeLineup`/`awayLineup` (7.11.5). Persistirlo en el equipo (con
  pantalla propia) queda para una sesión de UI/estado futura (TAC-2+).
- **Un P&R táctico solo se activa si el equipo OFENSIVO tiene
  `TacticalProfile`** (`buildPossessionPlan` devuelve `null` si no); el
  equipo defensivo, en cambio, cae a `'drop'` si no tiene perfil propio.
  Como hoy no existe ninguna pantalla que asigne perfiles, esto satisface
  literalmente el requisito de regresión (100% de las partidas reales de
  hoy no activan nunca la rama de P&R).
- **Secuenciación de pérdida/robo/falta**: los chequeos de pérdida/robo/
  falta de la posesión siguen usando siempre al `handler` original y al
  defensor de cobertura calculado ANTES de cualquier reasignación de la
  rama "ventaja clara" — solo el momento de tirar puede pasar el balón al
  `screener` (roller). No está en DESIGN.md literalmente; es la
  secuencia real de un P&R (el riesgo de pérdida es del bote en vivo,
  antes de decidir si se entrega al rodador).
- **Heurísticas nuevas** `screenerWeight`/`screenerDefenderWeight`
  (análogas a `usageWeight`/`onBallDefenderWeight` ya existentes, sin
  equivalente previo) y `pickRollFinishType` (selector de 2 vías,
  Tiro interior/Bandeja, para el rodador — deliberadamente más pequeño
  que el `pickShotType` de 4 vías existente, porque el rodador siempre
  termina cerca del aro).
- **Exportación de `computeMixRating`/`getAttribute` desde
  `MatchEngine.js`**: añadida únicamente para poder testear
  `AdvantageState` en aislamiento con la fórmula real (sin el ruido de
  simular partidos completos) — no cambia ningún comportamiento de
  producción.

### Pendiente explícitamente para entregas futuras

- **TAC-2**: spacing, roles ofensivos/defensivos, familiaridad táctica,
  ClubDNA como sesgo de identidad.
- **TAC-3**: playbook completo (Horns, Spain P&R, Floppy...), continuidad/
  contras dentro de una misma jugada (7.12.10-11 — esta entrega solo hace
  UNA lectura por posesión de P&R), asistencia basada en `shotQuality`
  real (sustituyendo la asignación post-hoc actual, que 7.12.5 confirma
  que sigue siendo correcta hasta entonces).
- **TAC-4 a TAC-7**: defensa avanzada/zonas/press, tiempos muertos/ATO/
  BLOB/SLOB, IA táctica de la CPU, Data Hub — ninguno tocado.
- Sin frontend/pantalla de Tactics todavía (pedido explícitamente así por
  el prompt) — solo verificación por script/consola.

## 2026-08-20 (3) — TAC-2: identidad + spacing + roles (DESIGN.md 7.12.33)

Segunda entrega de las 7 planificadas del sistema táctico (7.12). Amplía
`Tactics.js`/`MatchConfig.js` de TAC-1 (no los reescribe) y por primera vez
persiste el perfil táctico en `Team.js` y le da una pantalla propia.

- **`src/entities/Team.js`**: `this.tacticalProfile` pasa a ser una
  instancia real de `Tactics.TacticalProfile` (nunca un objeto plano),
  inicializada con valores por defecto en el constructor — mismo patrón
  que `clubDNA`/`reputation`. Esto es exactamente el hueco que TAC-1 dejó
  señalado explícitamente ("persistirlo en el equipo... queda para una
  sesión de UI/estado futura"): esta es esa sesión. `Team.js` NO
  destructura `TacticalProfile` a la carga del script (rompería en el
  navegador, donde `Team.js` carga ANTES que `Tactics.js` en `index.html`)
  — guarda la referencia al objeto compartido `global.BasketManager` y
  accede a `.TacticalProfile` dentro del propio constructor, en tiempo de
  ejecución. `toJSON()` incluye el nuevo campo.
- **`src/core/Tactics.js`**:
  - `TacticalProfile` amplía su shape con `spacing` (catálogo
    `SPACING_OPTIONS`: `5-out`/`4-out-1-in`/`3-out-2-in`/`dynamic`,
    validado igual que `pnrCoverage`), `identity` (objeto ABIERTO con
    `pace`/`earlyOffense`/`ballMovement`/`pickAndRollUsage` como mínimo,
    0-100, acepta claves extra sin romper el shape — 7.12.7 completo no se
    implementa), `playTypeWeights` (idem, mínimo
    `pickAndRoll`/`isolation`/`postUp`/`transition` — 7.12.8) y
    `roleAssignments` (`RoleAssignment`, mapa `playerId → { offensiveRole,
    defensiveRole }`, no una entidad de fichero propia).
  - `resolvePnrFrequency()`: `identity.pickAndRollUsage` MODULA
    `config.tactics.pnrFrequency` en vez de un valor fijo global
    (`multiplier = pickAndRollUsage / pickAndRollUsageNeutral`, acotado a
    `[0, pickAndRollUsageMaxMultiplier]`) — con el valor neutro por
    defecto (50) reproduce EXACTAMENTE la frecuencia de TAC-1
    (verificado: `0.3 → 0.3`), así que el requisito de regresión de esta
    entrega ("con perfil por defecto = comportamiento equivalente") se
    cumple por construcción, no por casualidad.
  - `effectiveSpacing(spacing, five, config)`: cruza el spacing declarado
    con la "amenaza de tiro real" (`outsideShot`×0.7 +
    `midRangeShot`×0.3) de los N jugadores del quinteto REAL que ese
    spacing exige respetar (5/4/3 para 5-Out/4-Out-1-In/3-Out-2-In;
    `dynamic` usa el mejor ajuste real de los tres para ese quinteto) y
    aplica un techo propio por arquetipo (`archetypeCeiling`, 7.12.31
    invariante 6: 3-Out-2-In < 4-Out-1-In < 5-Out incluso con jugadores
    idénticos). Verificado en dirección (ver invariantes abajo), no en
    cifra cerrada (7.12.34).
  - Catálogo `OFFENSIVE_ROLES` (15 roles de 7.12.9) y `DEFENSIVE_ROLES`
    (10 roles de 7.12.21): id/etiqueta/posiciones preferentes como datos
    (mismo criterio que `PNR_COVERAGES`); las MEZCLAS de atributos de cada
    rol viven en `MatchConfig.js` (`config.tactics.roles.offensiveMix`/
    `defensiveMix`, mismo criterio que `coverageHandlerMix`).
  - `roleFit(player, roleId, config)`: 1-5 estrellas = mezcla de atributos
    del rol (70%) + competencia posicional real (6.1, la mejor de las
    posiciones preferentes del rol, 30%) × un factor pequeño de Energía
    actual (0.9-1.0) — nunca un atributo nuevo de `Player.js`. Funciona
    para CUALQUIER rol contra cualquier jugador (`bestRolesForPlayer()`
    devuelve los N de mejor encaje, para que la UI compare candidatos).
  - `computeLineupRatings(five, tacticalProfile, config)`: subset de
    7.12.28 — Creación, Spacing, Tiro exterior, Finalización interior,
    Rebote ofensivo, Rebote defensivo. Deja fuera Switchability/Rim
    Protection/Transition Offense/Transition Defense/Tactical Execution
    porque dependen de piezas que no existen todavía (defensa avanzada es
    TAC-4, familiaridad/`tacticalExecution` es TAC-6) — no se inventan con
    datos que no hay.
  - `computeSimpleMix`/`getPlayerAttribute` propios (NO reutilizan
    `MatchEngine.computeMixRating`/`getAttribute`): estas funciones nuevas
    se llaman directamente desde `game.js` sin partido en curso, así que
    necesitan su propio lector de atributos — mismo criterio de
    duplicación deliberada que `pickWeighted`/`gaussianRandom` de TAC-1, no
    una divergencia de la fórmula real de rating de una posesión (que sí
    incluye Fatiga/Consistencia/Presión de Momento, deliberadamente
    ausentes aquí porque esto es una foto de aptitud, no una previsión de
    rendimiento en la jugada).
- **`src/core/MatchEngine.js`**: `options.homeTacticalProfile`/
  `awayTacticalProfile` sigue existiendo para tests dirigidos, pero ahora
  cae a `homeTeam.tacticalProfile`/`awayTeam.tacticalProfile` si `options`
  no los especifica — una partida real ya usa el perfil del equipo sin
  pasarlo a mano. Sin cambios en `simulatePossession()` (la modulación de
  `pnrFrequency` vive entera en `Tactics.buildPossessionPlan`, TAC-1 no se
  reescribe).
- **`src/core/MatchConfig.js`**: bloque `tactics` ampliado con
  `identity`/`playTypeWeights`/`spacing`/`roles` (defaults, mezclas de
  atributos por rol, pesos de `roleFit`, requisitos de spacing por
  arquetipo) — todo como datos, ninguna cifra hardcodeada en `Tactics.js`.
- **`src/ui/game.js`** + **`src/ui/game.css`** + **`index.html`**: nueva
  pantalla `tactics` en `SCREENS` (junto a `lineup` en `gm-nav`), con
  `renderTacticsScreen()` y 3 sub-pestañas (subset de las 7 vistas de
  7.12.32 — Defensa/Playbook/Situaciones/Rival son TAC-3/TAC-4/TAC-5/TAC-7):
  - **Resumen**: identidad (spacing, cobertura de P&R, ejes) + valoraciones
    en estrellas del quinteto TITULAR actual, leído del slot `starter` de
    `state.lineup.entries` (mismo criterio que usa
    `Rotation.buildRotationState` para el `onCourt` inicial — no se
    reinventa cómo se sabe "quién está en pista", pedido explícito del
    prompt).
  - **Ataque**: selector de spacing (4 opciones), sliders 0-100 de los 4
    ejes de identidad mínimos y de los 4 pesos de play-type mínimos (solo
    Pick & Roll tiene efecto real en el motor hoy; el resto se guarda para
    que una entrega futura lo consuma). Mismo patrón commit-on-change que
    ya usa la pantalla de Alineación para los minutos de cada slot
    ('input' solo refresca la etiqueta en vivo, 'change' muta el perfil y
    re-renderiza).
  - **Roles**: tabla de convocados con selector de rol ofensivo/defensivo,
    estrellas de `roleFit` para el rol seleccionado y los 3 de mejor
    encaje de cada jugador (ofensivo y defensivo por separado).
  - Media cancha gráfica explicativa de 7.12.32 (visualizar ocupación de
    espacio al cambiar spacing): **dejada fuera deliberadamente en esta
    entrega** (el prompt lo permitía explícitamente) — la vista Ataque usa
    texto plano en su lugar; una representación gráfica queda para una
    sesión futura de esta misma pantalla.
  - Estilo: reutiliza el sistema visual existente (parquet `#EFE6D3`,
    ladrillo `#B8451F`, verde pizarra `#2E4238`, Oswald condensada) — sin
    paleta/tipografía nueva.

### Invariantes demostrados (script Node dedicado, scratchpad de la sesión)

- **effectiveSpacing, dirección correcta (7.12.6/7.12.31 #5)**: mismo
  spacing `5-out`, quinteto con 5 tiradores reales → `0.740`; mismo
  quinteto sustituyendo el pívot por uno con `outsideShot`/`midRangeShot`
  muy bajos → `0.619` (menor, como exige el prompt).
- **3-Out-2-In < 5-Out para el MISMO quinteto (7.12.31 #6)**: `0.490` vs
  `0.740` — el techo de arquetipo reduce el espacio incluso sin cambiar
  ningún jugador.
- **`dynamic` iguala el mejor ajuste real disponible**: confirmado exacto
  (diferencia `<1e-9`) contra el máximo de los 3 arquetipos fijos para ese
  quinteto.
- **roleFit coherente (7.12.9)**: Base con `ballHandling`/`gameVision`
  altos (18/18) puntúa `18.18` (5★) en PnR Handler; un Pívot con esos
  mismos atributos muy bajos (3-4) puntúa `4.92` (2★) — mismo rol,
  dirección correcta. Funciona igual para roles defensivos (Pívot
  taponador → Rim Protector: `18.11`, 5★). `bestRolesForPlayer()` devuelve
  los 3 mejores ordenados descendente, confirmado.
- **resolvePnrFrequency reproduce TAC-1 exactamente con perfil por
  defecto**: `pnrFrequency=0.3` base, resuelta con `identity` por defecto
  (`pickAndRollUsage=50`) = `0.3` exacto. `pickAndRollUsage=100` → `0.6`
  (sube), `pickAndRollUsage=0` → `0` (anula el P&R táctico para ese
  equipo).
- **Regresión, equipo con `TacticalProfile` por defecto**: 12 partidos
  completos (`generateFictionalTeams`, sin tocar la nueva pantalla) —
  media de puntos por equipo 87.6/86.3 (rango realista), media de
  posesiones combinadas 166.5/partido, media de pérdidas combinadas
  43.4/partido. Confirmado además que TODOS los equipos generados
  (`teamGenerator`/`skewedTeamGenerator`/datos reales vía
  `real-data-bundle.js`) ya construyen un `TacticalProfile` por defecto al
  pasar por `new Team()` — se probó explícitamente simulando una jornada
  completa de la Liga real (18 equipos ACB) sin errores.
- **`options.homeTacticalProfile` explícito sigue aceptado y con
  prioridad** sobre `team.tacticalProfile` (revisado en el propio código
  de `MatchEngine.js`: `options.homeTacticalProfile || homeTeam.
  tacticalProfile || null`).
- Playwright: sesión completa (elegir club real → convocar 10 jugadores →
  fijar titulares → Tácticas: cambiar spacing a 5-Out, mover el slider de
  Ritmo a 80, asignar un rol ofensivo con estrellas de encaje visibles →
  volver a Resumen y confirmar que los cambios persisten → volver a
  Alineación y confirmar que sigue intacta) sin errores nuevos de
  consola/página (los dos únicos mensajes de red — Google Fonts bloqueado
  y un 404 de favicon — son preexistentes, no relacionados con esta
  sesión).
- Confirmado con `git diff --stat` que solo `Tactics.js`, `MatchConfig.js`,
  `MatchEngine.js`, `Team.js`, `game.js`, `game.css`, `index.html`,
  `DESIGN.md` y `CHANGELOG.md` cambiaron — `Rotation.js`, `Player.js`,
  `Recovery.js`, `Calendar.js`, `League.js`, `Bracket.js`, `Cup.js`,
  `Playoffs.js`, `Promotion.js`, `CpuLineup.js` y `SeasonGoals.js` no se
  tocaron.

### Decisiones/interpretaciones señaladas explícitamente (no cerradas como diseño definitivo)

- **`effectiveSpacing` NO se conecta a `computeAdvantageScore()` en esta
  entrega**, a pesar de que el prompt lo permitía si se encontraba una
  forma limpia (punto 4). Motivo: desde esta entrega TODO equipo real
  tiene un `TacticalProfile` por defecto, así que cualquier término
  añadido aquí afectaría a TODOS los partidos del juego — calibrarlo sin
  doble contar el efecto que 7.12.4 ya describe (el spacing se refleja
  cambiando qué defensor ayuda, no como bonus aparte) exige simulación
  masiva que esta entrega no puede validar sin arriesgar el invariante de
  regresión. Señalado también en `DESIGN.md` 7.12.34 como pendiente
  explícito para TAC-3.
- **Todos los valores numéricos nuevos de `config.tactics`**
  (`identity.pickAndRollUsageNeutral`/`pickAndRollUsageMaxMultiplier`,
  `spacing.shotThreatMix`/`shooterRequirement`/`archetypeCeiling`,
  `roles.fitWeights`, mezclas de atributos por rol) son puntos de partida
  con DIRECCIÓN verificada, no cifras cerradas — **pendientes de
  calibración (7.12.31/7.12.34)**, comentados así en `MatchConfig.js`.
- **`roleFit`/`effectiveSpacing`/`computeLineupRatings` NO aplican Fatiga/
  Consistencia/Presión de Momento** (a diferencia de
  `MatchEngine.computeMixRating`, que sí las aplica): son una foto de
  APTITUD para una pantalla fuera de partido, no una previsión de
  rendimiento en una jugada concreta — solo se incluye un factor pequeño
  de Energía actual en `roleFit` (pedido explícito del prompt, "estado
  físico"), nada más.
- **Defaults de `TacticalProfile` duplicados como constantes literales en
  `Tactics.js`** (`DEFAULT_SPACING`/`DEFAULT_IDENTITY`/
  `DEFAULT_PLAY_TYPE_WEIGHTS`) en vez de leerlos de `MatchConfig.js`:
  `Team.js` construye un `TacticalProfile` sin recibir ningún `config`
  (mismo patrón que el resto de defaults de `Team.js`, ej. facilities).
  Deben coincidir con `config.tactics.identity.defaults`/
  `playTypeWeights.defaults`/`spacing.default` de `MatchConfig.js` (mismas
  cifras, documentadas en los dos sitios) — ese bloque de `MatchConfig.js`
  es el que consumen las funciones que SÍ reciben `config` explícito
  (`resolvePnrFrequency`, `effectiveSpacing`, `roleFit`).
- **Media cancha gráfica de 7.12.32 omitida** en la vista Ataque —
  representación de texto plano en su lugar, el prompt lo permitía
  explícitamente si añadía riesgo/tiempo desproporcionado.
- **Mutación directa de `team.tacticalProfile`** desde los manejadores de
  eventos de `game.js` (sin una capa de "draft" intermedia como la que
  usa el formulario de quinteto fijo de Alineación): los cambios de
  spacing/identidad/pesos/roles se aplican inmediatamente al perfil real
  del equipo al soltar el control — mismo criterio que ya usa Alineación
  para `state.lineup.entries` (mutación directa, sin deshacer).

### Pendiente explícitamente para entregas futuras

- **TAC-3**: playbook completo (Horns, Spain P&R, Floppy...), continuidad/
  contras dentro de una misma jugada, reemplazo de la asistencia post-hoc
  por `shotQuality` real, conexión de `effectiveSpacing` a
  `AdvantageState` (señalado arriba como pendiente explícito), uso real de
  los play-types más allá de Pick & Roll.
- **TAC-4**: defensa avanzada (zonas, press, matchups individuales,
  transición defensiva) — `computeLineupRatings` no calcula todavía
  Switchability/Rim Protection/Transition Defense por depender de esto.
- **TAC-5**: tiempos muertos, ajustes en vivo, ATO/BLOB/SLOB.
- **TAC-6**: familiaridad táctica/`tacticalExecution` — `computeLineupRatings`
  no calcula todavía Tactical Execution por depender de esto; los
  roles/spacing de esta entrega se aplican con encaje pleno desde el
  primer partido, sin curva de aprendizaje.
- **TAC-7**: IA táctica de la CPU (los equipos CPU generados por
  `teamGenerator`/`skewedTeamGenerator` ya tienen un `TacticalProfile` por
  defecto, pero nadie decide todavía "la identidad según su plantilla") y
  Data Hub táctico.
- Editor visual de jugadas y media cancha gráfica interactiva de 7.12.32 —
  fuera de alcance explícito hasta que exista playbook (TAC-3) que
  visualizar.

## 2026-08-20 (4) — TAC-3: playbook + generación real de oportunidades (DESIGN.md 7.12.33)

Tercera entrega de las 7 planificadas del sistema táctico (7.12), la más
grande hasta ahora. Amplía `Tactics.js`/`MatchConfig.js`/`MatchEngine.js` de
TAC-1/TAC-2 (no los reescribe) e introduce el playbook, comportamiento real
para Isolation/Post Up (además de Pick & Roll), las 6 categorías completas
de `AdvantageState` con una cadena de continuidad acotada, asistencia
causal, y conecta `effectiveSpacing` a `AdvantageState` (pendiente heredado
de TAC-2).

- **`src/core/Tactics.js`**:
  - `PLAY_DEFINITIONS` (7.12.10): catálogo de 9 jugadas (Basic High P&R,
    Horns, Spain Pick & Roll, Double Drag, DHO/Zoom, Floppy, Post Entry,
    5-Out Motion, Isolation Clearout) como datos — `id`/nombre/familia
    (play-type)/participantes/spacing compatible/complejidad/2-4 lecturas
    representativas con su cobertura objetivo (`vs`). **Fuera de esta
    entrega, señalado explícitamente**: Flex, Princeton Elbow/entry, Post
    Split, High-Low y Pistol (5 de las 14 familias del catálogo objetivo de
    DESIGN.md); dentro de cada jugada implementada, solo las lecturas MÁS
    representativas (2-4), no la tabla completa de 7.12.10 (ej. re-screen
    de Basic P&R, cambio de ángulo de Horns quedan fuera). Las lecturas
    (`reads`) se usan solo para telemetría/etiqueta (`playDefinitionId`),
    nunca para bifurcar la fórmula real ("no scripting", 7.12.10).
  - `selectPlayType()` (7.12.8): sortea el play-type de la posesión
    (Pick & Roll/Isolation/Post Up) ponderando por `playTypeWeights` sobre
    un presupuesto de referencia de 100 "posesiones conceptuales"
    (`config.tactics.playTypeSelection.budget`) — el peso efectivo de
    Pick & Roll reutiliza `resolvePnrFrequency` (TAC-2, ya modulado por
    `identity.pickAndRollUsage`) expresado en esa misma escala, lo que
    reproduce EXACTAMENTE la frecuencia de TAC-1/TAC-2 con perfil por
    defecto (30 de presupuesto 100 = 0.3, idéntico a `pnrFrequency`). El
    presupuesto no consumido por los 3 play-types reales cae a "ninguno"
    → bucle 1v1 de siempre (7.12.34, compatibilidad).
  - `buildIsolationPlan()`/`computeIsolationAdvantageScore()` (7.12.8/
    7.12.9): anotador = jugador con rol `isolationScorer` asignado si
    existe, si no el de mayor `usageWeight` (TAC-2 no implementó jerarquía
    de uso primera/segunda opción). Sin cobertura (1v1 directo, sin
    bloqueo): `advantageScore` = diferencia de rating anotador/defensor.
    Si la ventaja colapsa la ayuda (`rotatingDefense`/`brokenDefense`):
    kick-out a un tirador del lado débil con asistencia al anotador; en
    cualquier otro caso, Isolation puro — el propio anotador crea y remata
    su tiro, sin asistencia (7.12.5).
  - `buildPostUpPlan()`/`computePostUpAdvantageScore()` (7.12.8/7.12.9):
    anotador = jugador con rol `postScorer`/`postHub` si existe, si no
    ponderado por Tiro interior+Fuerza; defensor interior dedicado (no el
    `onBallDefender` perimetral genérico). Doble equipo simple (7.12.19
    completo es TAC-4): si el anotador supera claramente a su defensor
    (margen de rating, `doubleTeamRatingMargin`) Y el sorteo lo activa
    (`doubleTeamProbability`), fuerza un kick-out con asistencia — reglas
    completas de doble equipo quedan para TAC-4.
  - `resolveRead6()`/`collapseRead6To3()` (7.12.4): las 6 categorías reales
    de `AdvantageState` (ventaja defensiva clara / defensa estable /
    pequeña ventaja ofensiva / ventaja ofensiva clara / defensa en rotación
    / defensa rota) sustituyen a las 3 ramas de TAC-1 como fuente de
    verdad. **Decisión de encaje señalada explícitamente**: en vez de
    migrar `planPnrPossession`/`resolveRead` (legacy) a las 6 categorías,
    se mantiene `collapseRead6To3()` como colapso 6→3 — con los MISMOS
    umbrales `smallAdvantage`(0.15)/`clearAdvantage`(0.5) sin cambiar de
    valor, `resolveRead()`/`planPnrPossession()` (legacy, sigue exportado
    para tests dirigidos de TAC-1/TAC-2) devuelven resultados numéricamente
    IDÉNTICOS a antes de esta entrega.
  - `resolveContinuityState()`/`planPickAndRollTactical()` (7.12.11):
    cadena de continuidad acotada a un MÁXIMO de 2 acciones por posesión
    (límite duro explícito de 7.12.11). Estados: `Advantage created`
    (atacar ya — roller finaliza en `clearOffenseAdvantage`/`brokenDefense`,
    handler tira con penalización de "recuperación" en
    `smallOffenseAdvantage`), `Two on ball` (Blitz/Hedge con ventaja alta —
    short-roll inmediato, igual que la rama `clear` de TAC-1), `Mismatch
    created` (Switch — segunda lectura real de Isolation contra el
    defensor mismatcheado si queda reloj, sin asistencia), `Rotation
    forced` (extra-pass a tirador del lado débil con asistencia si queda
    reloj), `Neutral`/`Defense wins` (repite la lectura de P&R con un
    segundo sorteo de `AdvantageState` si queda reloj, o tiro forzado si
    no). El coste de reloj de una segunda acción
    (`config.tactics.continuity.secondActionClockCost`/
    `extraPassClockCost`) se resta del MISMO reloj de posesión ya existente
    (no uno paralelo) — puede disparar la violación de posesión si no
    queda margen.
  - `resolveTransitionAttempt()` (7.12.12): el peso de
    `playTypeWeights.transition` decide si el equipo REALMENTE intenta
    explotar una ventana de contraataque ya elegible (7.6 acción 14, sin
    tocar la ventana en sí) — con el peso neutro por defecto (15, igual al
    default de `playTypeWeights.transition`) siempre la intenta, IDÉNTICO
    al comportamiento de antes de esta entrega; un peso menor reduce esa
    probabilidad. Un peso mayor no puede superar el 100% (ya era el techo
    del comportamiento anterior) — señalado explícitamente como límite de
    diseño, no un error.
  - `computeSpacingAdvantageTerm()` (7.12.6/7.12.34, **pendiente heredado
    de TAC-2, conectado en esta entrega**): término ACOTADO y pequeño
    (`config.tactics.advantage.spacing.sensitivity`/`neutral`/`maxEffect`)
    añadido UNA sola vez dentro de `computeAdvantageScore`/
    `computeIsolationAdvantageScore`/`computePostUpAdvantageScore` (evita
    doble conteo, 7.12.4) — más `effectiveSpacing` real del quinteto
    ofensivo en pista → más ventaja disponible. Sin `offenseFive`/
    `offenseSpacing` (llamadas legacy de TAC-1/TAC-2 que no los pasan),
    devuelve 0 — comportamiento idéntico al de antes.
  - `planTacticalPossession()`: punto de enganche NUEVO de producción para
    `MatchEngine.simulatePossession()` — sustituye a `planPnrPossession`
    como llamada real (que sigue exportado tal cual, sin cambios, para
    tests dirigidos de TAC-1/TAC-2). Forma unificada del plan devuelto
    (`initialHandler`/`initialOnBallDefender`/`shooter`/`shotDefender`/
    `shotDefenderPenalty`/`forcedShotType`/`assistCandidate`/
    `shotAdjustment`/`clockCost`) común a los 3 play-types con motor real,
    para que `MatchEngine.js` no necesite ramas específicas por play-type.
- **`src/core/MatchEngine.js`**: `simulatePossession()` llama a
  `planTacticalPossession` en vez de `planPnrPossession`; el bloque que
  antes reasignaba `ballHandler`/`shotDefender`/`forcedShotType` SOLO para
  la rama `clear` de P&R ahora es genérico (`tacticalPlan.shooter`/
  `shotDefender`/`shotDefenderPenalty`/`forcedShotType`/`shotAdjustment`)
  y vale para los 3 play-types. Nueva `resolveTacticalAssist()` (7.12.5):
  sustituye a `resolveAssist()` SOLO cuando hay `tacticalPlan` — acredita
  la asistencia directamente al `assistCandidate` que ya resolvió
  Tactics.js (nunca un sorteo entre 4 compañeros como `resolveAssist()`),
  con una probabilidad ajustada por la calidad de pase del creador
  (VisiónJuego+Pase+DecisiónBajoPresión, "regla dura" de 7.12.5: el bonus
  decide SI se acredita, nunca A QUIÉN). Sin `tacticalPlan` (posesión no
  táctica), `resolveAssist()` sigue exactamente igual (7.12.5,
  compatibilidad explícita, no se elimina). La ventana de contraataque
  (`isFastBreakWindow`) ahora depende de `fastBreakAttempt`
  (`resolveTransitionAttempt`) en vez de solo `context.fastBreakEligible`.
- **`src/core/MatchConfig.js`**: `tactics.advantage.thresholds` ampliado de
  2 a 4 umbrales (6 categorías); `tactics.advantage.spacing` nuevo (término
  de spacing); `tactics.isolation`/`tactics.postUp` nuevos (mezclas de
  atributos + doble equipo); `tactics.playTypeSelection`/
  `tactics.transitionAttempt`/`tactics.continuity`/`tactics.assist` nuevos
  — todo como datos, ninguna cifra hardcodeada en `Tactics.js`/
  `MatchEngine.js`.
- **`src/ui/game.js`**: nueva sub-pestaña **Playbook** en
  `renderTacticsScreen()` (junto a Resumen/Ataque/Roles de TAC-2, sin
  reconstruirlas) — tabla de las 9 `PlayDefinition` del catálogo
  (jugada/familia/participantes/spacing compatible/complejidad/lecturas
  principales), marcando qué familias tienen motor real (Pick & Roll/
  Isolation/Post Up) frente a las que son solo catálogo (Handoff/DHO, Off
  Screen, Motion/Flow). **Prioridad/peso editable por jugada individual
  DEJADA FUERA** de esta entrega (el prompt lo permitía explícitamente si
  el tiempo/riesgo no lo permitía) — el motor ya elige automáticamente
  entre jugadas de una familia según el spacing declarado
  (`Tactics.choosePlayDefinition`). Mismo estilo visual que TAC-2 (parquet
  `#EFE6D3`, ladrillo `#B8451F`, verde pizarra `#2E4238`, Oswald
  condensada), sin CSS nuevo.
- **`DESIGN.md`**: corregida la nota de 7.12.34 que decía
  "`effectiveSpacing` NO conectado" — ahora documenta que TAC-3 sí lo
  conecta, con el detalle de dónde y con qué guardas. Añadido un bloque
  nuevo de pendientes propio de TAC-3 (catálogo incompleto, familias sin
  motor, prioridad de playbook no editable, eje Rigidez↔Read&React sin
  efecto, presupuesto/umbrales de selección de play-type y coste de reloj
  de continuidad como puntos de partida).

### Invariantes demostrados (script Node dedicado, scratchpad de la sesión)

- **Invariantes #1-#4 heredados de TAC-1 (Drop/Under explotables por un
  tirador, mismatch de Switch) siguen intactos**: con un handler de gran
  tiro exterior, `advantageScore` medio Drop `0.335`/Under `0.569`/Switch
  `-0.150`/Blitz `-0.280` — misma dirección que TAC-1 (Under > Drop »
  Switch/Blitz negativos). Mismatch de Switch: pívot lento de
  `screenerDefender` `0.106` frente a pívot móvil `-0.135` (lento > móvil,
  como exige el invariante).
- **Nuevo invariante — effectiveSpacing conectado a AdvantageState**: MISMO
  quinteto real (5 tiradores reales), spacing `5-out` → `advantageScore`
  medio `0.159` frente a `3-out-2-in` → `0.127` (5-out > 3-out-2-in, misma
  dirección que pedía el prompt de esta sesión). Invariantes #5/#6 de
  TAC-2 (`effectiveSpacing` en sí, 3-Out-2-In < 5-Out) no tocados, siguen
  intactos (no se modificó `Tactics.effectiveSpacing()`).
- **Nuevo invariante — selección real de play-type por peso**: con
  `playTypeWeights.isolation=60`, 1788-1848/3000 posesiones sortean
  Isolation (≈60%, coherente con el presupuesto de 100); con
  `isolation=0`, exactamente 0/3000 — el peso decide con comportamiento
  real, no solo se guarda.
- **Nuevo invariante — asistencia causal**: escenario de kick-out real
  (Isolation que colapsa la ayuda del defensor) acredita la asistencia al
  creador en 400/400 casos de prueba dirigidos (`buildIsolationPlan`
  directo); escenario de Isolation puro (anotador/defensor equilibrados,
  sin colapso) NO acredita ninguna asistencia en 400/400 casos — el propio
  anotador crea y remata su tiro. Mismo patrón confirmado para el doble
  equipo de Post Up: 52/52 casos con doble equipo acreditan la asistencia
  al post scorer, nunca al tirador.
- **Regresión, equipo con `TacticalProfile` por defecto**: 40 partidos
  completos (`generateFictionalTeams`) — media de puntos por equipo
  `89.0` (TAC-2: `87.6`/`86.3`), posesiones combinadas `167.8` (TAC-2:
  `166.5`), pérdidas combinadas `42.9` (TAC-2: `43.4`) — todo dentro de
  rango realista y muy próximo a TAC-1/TAC-2 pese a que ahora Isolation/
  Post Up/continuidad tienen comportamiento real (no solo Pick & Roll).
  Estabilidad: 30 partidos adicionales generados aleatoriamente sin
  ninguna excepción.
- Playwright: sesión completa (elegir club real → Tácticas → confirmar que
  Resumen/Ataque/Roles de TAC-2 siguen intactas → abrir la nueva
  sub-pestaña Playbook, confirmar las 9 filas del catálogo con familia/
  participantes/spacing/complejidad/lecturas → volver a Resumen) sin
  errores nuevos de consola — el único mensaje de red
  (`ERR_CONNECTION_RESET` de Google Fonts) es preexistente y no
  relacionado con esta sesión (igual que TAC-1/TAC-2).
- Confirmado con `git diff --stat` que solo `Tactics.js`, `MatchConfig.js`,
  `MatchEngine.js`, `game.js`, `DESIGN.md` (y este `CHANGELOG.md`)
  cambiaron — `Rotation.js`, `Recovery.js`, `Calendar.js`, `League.js`,
  `Bracket.js`, `Cup.js`, `Playoffs.js`, `Promotion.js`, `CpuLineup.js`,
  `SeasonGoals.js`, `Player.js` y `Team.js` no se tocaron (ningún atributo
  1-20 nuevo, ninguna de las entidades vetadas explícitamente por el
  prompt).

### Decisiones/interpretaciones señaladas explícitamente (no cerradas como diseño definitivo)

- **Todos los valores numéricos nuevos de `config.tactics`**
  (`advantage.thresholds` ampliados, `advantage.spacing.*`,
  `isolation.*`/`postUp.*`, `playTypeSelection.budget`,
  `transitionAttempt.weightNeutral`, `continuity.*`, `assist.
  playmakingBoostMax`) son puntos de partida con DIRECCIÓN verificada, no
  cifras cerradas — **pendientes de calibración (7.12.31/7.12.34)**.
- **Colapso 6→3 en vez de migrar TAC-1 a las 6 categorías**: elegido para
  no arriesgar el contrato/comportamiento exacto de `planPnrPossession`/
  `resolveRead` (legacy, sigue exportado). La producción usa
  `planPickAndRollTactical` (dentro de `planTacticalPossession`), que sí
  consume las 6 categorías completas para la cadena de continuidad.
- **"Rotation forced" aplicado a Isolation/Post Up sin cobertura**: 7.12.11
  describe la continuidad en términos de cobertura de P&R (Switch/Blitz/
  Hedge); para Isolation (sin bloqueo, sin cobertura) y el doble equipo de
  Post Up se interpretó que una ventaja que colapsa la ayuda del defensor
  (`rotatingDefense`/`brokenDefense`) es análoga a "Rotation forced" →
  kick-out con asistencia — interpretación razonable, no una regla ya
  escrita literalmente en 7.12.11 para estas dos familias.
- **Coste de reloj de la segunda acción como resta fija** (`secondActionClockCost`/
  `extraPassClockCost`) en vez de simular una segunda acción con su propio
  `pickPossessionStepSeconds`: más simple y acotado, coherente con el
  límite duro de 2 acciones de 7.12.11 — resta del MISMO reloj de
  posesión, puede disparar la violación de posesión si no queda margen.
- **`resolveTransitionAttempt` no puede superar la frecuencia de contraataque
  de antes de esta entrega**: un peso de `playTypeWeights.transition` por
  encima del neutro (15) no aumenta más allá de "siempre lo intenta" — el
  techo ya era ese antes de TAC-3; señalado explícitamente como límite de
  diseño, no un error de calibración.
- **Selección de jugada concreta dentro de una familia
  (`choosePlayDefinition`)** solo afecta a telemetría/etiqueta
  (`playDefinitionId`), nunca a la fórmula real — ponderada por
  compatibilidad de spacing declarado y, en igualdad, por menor
  complejidad; pendiente de calibración/decisión (7.12.34), como el resto
  de pesos de esta entrega.
- **Pantalla de Playbook sin prioridad/peso editable por jugada**: el
  prompt de esta sesión permitía explícitamente una primera versión más
  simple (solo mostrar el catálogo) si el editor de prioridad añadía
  riesgo/tiempo desproporcionado — se optó por eso.

### Pendiente explícitamente para entregas futuras

- **TAC-4**: defensa avanzada (zonas, press, matchups individuales, reglas
  completas de defensa de poste de 7.12.19 — el doble equipo simple de
  esta entrega queda como base, no como la regla completa —, transición
  defensiva).
- **TAC-5**: tiempos muertos, ajustes en vivo entre cuartos, ATO/BLOB/SLOB,
  falta táctica intencionada.
- **TAC-6**: familiaridad táctica/`tacticalExecution` — el campo
  `complexity` de `PlayDefinition` se guarda como dato pero no afecta
  todavía a ninguna probabilidad; el eje Rigidez↔Read&React de 7.12.7
  sigue sin efecto real (7.12.11 ya lo señalaba explícitamente).
- **TAC-7**: IA táctica de la CPU, Data Hub táctico completo (telemetría de
  7.12.27, PPP/frequency por play-type, coverage efficiency...).
- Catálogo de playbook ampliado a las 14 familias completas de 7.12.10
  (Flex, Princeton Elbow/entry, Post Split, High-Low, Pistol); motor real
  para Handoff/DHO, Off Screen y Motion/Flow (hoy solo catálogo de datos);
  prioridad/peso editable por jugada en la pantalla de Playbook.

## 2026-08-21 — TAC-4: defensa avanzada (DESIGN.md 7.12.33)

Cuarta entrega de las 7 planificadas del sistema táctico (7.12). Introduce
por primera vez un `DefensiveScheme` real (esquema base + press), matchups
individuales declarados, doble equipo de poste completo (sustituye la
versión simple de TAC-3) y transición defensiva — todo enganchado dentro
de las piezas ya existentes de TAC-1/TAC-2/TAC-3 (`AdvantageState`,
`resolveTacticalAssist`, la ventana de contraataque de 7.6), sin duplicar
ningún resolver de 7.6.

- **`TacticalProfile.defensiveScheme`** (7.12.13/7.12.14/7.12.15/7.12.19):
  `baseScheme` (`man-to-man`/`2-3`/`3-2`/`1-3-1`), `press: { active, type
  }` (`halfCourt`/`fullCourt`) y `postDoubleTeamRule` (`never`/`starOnly`/
  `always`). `man-to-man` + press inactivo + `starOnly` (con el MISMO
  umbral/probabilidad que TAC-3) reproducen exactamente el comportamiento
  de antes de esta entrega (7.12.34, compatibilidad) — verificado con el
  script de esta sesión.
- **Defensa de zona con efecto real** (7.12.14):
  `Tactics.computeZoneAdvantageTerm()` — término ACOTADO y aditivo (mismo
  patrón que `computeSpacingAdvantageTerm`, evita doble conteo, 7.12.4),
  NUNCA un `opponent3P+X`/`opponentInside-Y` directo. La pieza dominante
  es la sensibilidad al `effectiveSpacing` REAL del ataque: una zona es
  más vulnerable a un quinteto con tiradores de verdad (la estira) que a
  uno sin amenaza exterior (se contrae sin coste) — invariante nuevo,
  verificado. Conectado en los 3 play-types con motor real (Pick & Roll/
  Isolation/Post Up). Dos contramedidas mínimas por play-type (pedidas
  explícitamente como "1-2 contramedidas reales"): Post Up castiga más
  una 2-3 (alto poste libre) que Isolation; Pick & Roll/Isolation
  explotan más una 1-3-1 (rotaciones largas tras el trap) que Post Up.
- **Press con efecto real** (7.12.15): `Tactics.computePressEffect()` —
  MODULA la probabilidad del `rollTurnover()` YA EXISTENTE de
  `MatchEngine.js` (nunca un resolver nuevo) y el reloj consumido en
  cruzar medio campo, según la calidad de manejo/decisión
  (ballHandling+gameVision+pressureDecisionMaking) del equipo atacante —
  castiga más a un equipo con mal manejo que a uno con buen manejo.
  Neutro `{1, 0}` sin press activo. El desgaste extra de Energía por
  presionar (7.12.15) queda fuera explícitamente — exigiría tocar
  `Rotation.js`/`Recovery.js`, vetado para esta entrega.
- **Doble equipo de poste completo** (7.12.19, sustituye la versión
  simple de TAC-3): `Tactics.pickDoubleTeamHelper()` elige AL AYUDANTE
  que dobla por su ROL DEFENSIVO (`lowMan`/`nailHelper`/`roamer` de
  `DEFENSIVE_ROLES`, TAC-2) — primera vez que `roleAssignments` se
  consume REALMENTE en el motor (antes solo alimentaba `roleFit`/UI); ese
  mismo ayudante, por construcción, es quien contesta el kick-out si el
  postScorer encuentra el hueco (no un segundo sorteo genérico
  independiente). `Tactics.resolvePostReadSuccess()` condiciona el
  kick-out a la calidad de lectura/pase del propio postScorer
  (VisiónJuego+Pase) — TAC-3 lo acreditaba el 100% de las veces; si falla
  la lectura, tiro forzado con penalización de calidad (canal
  `shotAdjustment` ya existente, ningún resolver de pérdida nuevo).
  `Tactics.resolvePostDoubleTeamDecision()` con 3 reglas reales
  (`never`/`starOnly`/`always`); `onCatch`/`onFirstDribble` (matices de
  timing de 7.12.19) quedan fuera, señalado explícitamente.
- **Matchups individuales declarados** (7.12.17):
  `TacticalProfile.matchupOverrides` (`defenderId -> targetPlayerId`) —
  prioridad sobre la selección ponderada genérica SOLO para ese jugador
  concreto, aplicado en `MatchEngine.js` en los dos puntos donde antes se
  usaba un `pickWeighted` genérico (defensor inicial para pérdida/falta,
  defensor final del tiro) vía `Tactics.resolveMatchupOverride()` — CEDE
  ante cualquier reasignación por cobertura/rotación que Tactics.js ya
  haya decidido (Switch, roller, doble equipo...), tal como reconoce
  explícitamente el propio 7.12.17 ("salvo que una rotación/cambio
  defensivo obligue temporalmente a otro matchup").
- **Transición defensiva** (7.12.20): `Tactics.computeTransitionDefenseAdjustment()`
  — modificador DENTRO de la ventana de contraataque YA EXISTENTE (7.6
  acción 14, nunca la ventana en sí), según el atletismo agregado
  (Velocidad+ÉticaDeTrabajo+Posicionamiento) del quinteto que acaba de
  perder el balón: un repliegue malo amplía la ventaja de contraataque
  más allá de lo que ya da la ventana; uno excelente puede neutralizarla
  parcialmente. Aproximación por atletismo agregado del quinteto — este
  motor no distingue por jugador quién cargó el rebote ofensivo vs quién
  se replegó, señalado como simplificación explícita.
- **Valoraciones derivadas de quinteto completadas** (7.12.28): TAC-2 dejó
  fuera Switchability/Rim Protection/Transition Defense por falta de
  piezas de defensa avanzada — ya hay una base de datos sólida
  (`DefensiveScheme`, matchups, transición defensiva) para completarlas
  con sentido; Transition Defense reutiliza LITERALMENTE la misma mezcla
  que `computeTransitionDefenseAdjustment`, no una aproximación nueva.
  Transition Offense/POA Defense/Tactical Execution siguen sin
  implementar (ninguna pedida por el prompt de esta entrega).
- **`src/ui/game.js`**: nueva sub-pestaña **Defensa** en
  `renderTacticsScreen()` (junto a Resumen/Ataque/Roles/Playbook ya
  existentes) — selector de esquema base, toggle+tipo de press, regla de
  doble equipo, y un selector simple de matchups (mi defensor + jugador
  rival real de CUALQUIER equipo de ambas divisiones, reutilizando
  `getRealTeamsByDivision` — instancias reales de Team/Player, nunca
  datos planos en la UI, CLAUDE.md). Sin prioridad/peso editable por
  jugada nuevo más allá de lo ya existente; mismo estilo visual que las
  sub-pestañas anteriores, sin CSS nuevo.
- **`DESIGN.md`**: añadido un nuevo bloque de pendientes de TAC-4 en
  7.12.34 (catálogo de zona/press/doble equipo parcial, matchups por ID
  no por rol, sin desgaste de Energía del press, transición defensiva
  aproximada, valoraciones de quinteto pendientes que siguen sin
  implementar).

### Invariantes demostrados (script Node dedicado, scratchpad de la sesión)

- **Zona vulnerable al spacing real**: con el MISMO quinteto ofensivo
  (5 tiradores reales), el término de zona 2-3 es `0.030` frente a
  `-0.140` con un quinteto sin amenaza exterior — más vulnerable con
  tiradores de verdad, como exige el invariante. Sin esquema o
  man-to-man, el término es exactamente `0` (regresión). Contramedidas:
  Post Up vs 2-3 (`0.090`) > Isolation vs 2-3 (`0.030`); Pick & Roll vs
  1-3-1 (`0.140`) > Post Up vs 1-3-1 (`0.110`).
- **Doble equipo dirigido por la lectura del postScorer**: un postScorer
  con VisiónJuego+Pase altos encuentra el hueco en el 83.6% de 500
  intentos, frente al 31.2% de uno con lectura pobre — no una
  probabilidad fija ciega. Reglas `never`/`always` se comportan como su
  nombre indica en cualquier escenario de rating. Con un ayudante con rol
  Low Man declarado, ese jugador dobla en 60/60 casos de prueba.
- **Transición defensiva**: mismo tipo de comparación de quintetos —
  ajuste de `+0.120` (mal repliegue, amplía la ventaja del rival) frente
  a `-0.120` (buen repliegue, la neutraliza parcialmente).
- **Press**: neutro `{1, 0}` sin press activo (regresión). Con press a
  toda pista, un equipo con mal manejo sufre `x2.02` de multiplicador de
  pérdida frente a `x1.12` de uno con buen manejo — castiga más a los
  manejadores débiles, como describe 7.12.15.
- **Matchup individual**: el defensor declarado se fuerza exactamente
  cuando el objetivo declarado tiene el balón; sin ese objetivo en pista,
  o sin ningún matchup declarado, el motor sigue con su criterio
  ponderado genérico de siempre (no-op total).
- **Regresión de TAC-1/TAC-2/TAC-3**: invariante #1 de Drop/Switch sigue
  intacto con el perfil por defecto (`drop=0.438 switch=-0.078`); 16
  partidos completos con perfil por defecto (man-to-man, sin press) dan
  media de puntos `90.3`/equipo y pérdidas `21.7`/equipo — mismo rango
  realista que TAC-3 (87-89 pts/equipo).
- Playwright: sesión completa (equipo real → convocatoria en Alineación →
  pantalla de Tácticas → Resumen/Ataque/Roles/Playbook intactas → nueva
  sub-pestaña Defensa → cambiar esquema a zona 2-3, activar press a toda
  pista, regla de doble equipo "siempre", declarar y confirmar un
  matchup real) sin errores nuevos de consola/página.
- Confirmado con `git diff --stat` que solo `MatchConfig.js`,
  `MatchEngine.js`, `Tactics.js`, `game.js` y `DESIGN.md` (y este
  `CHANGELOG.md`) cambiaron — `Rotation.js`, `Recovery.js`, `Calendar.js`,
  `League.js`, `Bracket.js`, `Cup.js`, `Playoffs.js`, `Promotion.js`,
  `CpuLineup.js`, `SeasonGoals.js`, `Player.js` y `Team.js` no se
  tocaron (ningún atributo 1-20 nuevo).

### Decisiones/interpretaciones señaladas explícitamente (no cerradas como diseño definitivo)

- **Catálogo mínimo de esquema defensivo base**: solo `man-to-man`/`2-3`/
  `3-2`/`1-3-1` — Match-up Zone (híbrido zona/hombre) y Box-and-One
  (exige un jugador objetivo marcado, mecánica propia no modelada) quedan
  fuera, permitido explícitamente por el prompt ("catálogo mínimo
  razonable" cuando 7.12 no cierra el catálogo exacto).
- **Todos los valores numéricos nuevos** de `config.tactics.defense`
  (zona)/`press`/`transitionDefense`/`postUp` (reglas de doble equipo,
  lectura) son puntos de partida con dirección verificada, no cifras
  cerradas — pendientes de calibración (7.12.31/7.12.34).
- **Solo 2 contramedidas anti-zona mínimas** (Post Up vs 2-3, Pick &
  Roll/Isolation vs 1-3-1) — sin construir un sub-sistema de jugadas
  anti-zona completo (Overload, Skip pass como jugada propia), permitido
  explícitamente por el prompt ("1-2 contramedidas reales" como mínimo).
- **Doble equipo: solo 3 reglas de activación con comportamiento real**
  (`never`/`starOnly`/`always`) — `onCatch`/`onFirstDribble` (matices de
  timing de 7.12.19) quedan fuera porque este motor resuelve el poste en
  una sola pasada, sin sub-pasos de catch/dribble sobre los que
  distinguirlos.
- **Matchups declarados por ID de jugador real, no por nombre/rol**
  ("la estrella rival"): la pantalla de Tácticas no tiene un rival fijo
  de partido (se edita fuera de un partido concreto), así que el
  override solo tiene efecto los partidos en los que ese jugador
  concreto aparezca en pista — decisión de encaje señalada
  explícitamente, no un cierre de 7.12.17/`GamePlan` (que no existe
  todavía como entidad propia).
- **El matchup NO alimenta el cálculo interno de `AdvantageState`** de
  Tactics.js (que sigue usando el defensor genéricamente elegido para su
  propia comparación de rating) — solo determina QUIÉN aparece como
  defensor final en turnover/falta/tiro. Restructurar el pipeline interno
  de `planTacticalPossession` para que el matchup alimente también esa
  comparación de rating se dejó fuera por superar los "puntos de
  enganche mínimos" que pedía el prompt.
- **Ayudante del doble equipo elegido por rol declarado, con fallback
  heurístico** (anticipación+posicionamiento+ética de trabajo) si nadie
  tiene declarado un rol de ayuda — mismo criterio de heurística nueva
  mínima que `screenerWeight`/`screenerDefenderWeight` de TAC-1.
- **Transición defensiva aproximada por atletismo agregado del
  quinteto**, no por seguimiento individual de "quién cargó el rebote
  ofensivo vs quién se replegó" (7.12.20 lo describe por jugador) — este
  motor no distingue esa participación individual, señalado
  explícitamente como simplificación.
- **Desgaste extra de Energía del press NO implementado** (7.12.15 lo
  describe) — exigiría tocar `Rotation.js`/`Recovery.js`, vetado
  explícitamente para esta entrega.
- **`averageMixWithAttribute` nueva utilidad genérica mínima** (Tactics.js)
  — mezcla de atributos ponderada parametrizada por `getAttribute`, sin
  Fatiga/Consistencia/Presión de Momento, para poder calcular
  press/transición defensiva DURANTE una posesión sin reimplementar el
  tratamiento completo de `computeMixRating` (que sí seguiría siendo una
  duplicación real de fórmula, a diferencia de esta mezcla genérica).

### Pendiente explícitamente para entregas futuras

- **TAC-5**: tiempos muertos, ajustes en vivo entre cuartos, ATO/BLOB/
  SLOB, falta táctica intencionada.
- **TAC-6**: familiaridad táctica/`tacticalExecution` — sigue sin efecto
  real; el eje Rigidez↔Read&React de 7.12.7 también.
- **TAC-7**: IA táctica de la CPU (los equipos CPU siguen con
  `DefensiveScheme` por defecto, `man-to-man`, sin press — no se
  construyó lógica de "la CPU elige zona según su plantilla" en esta
  entrega, pedido explícito del prompt), Data Hub táctico completo.
- Match-up Zone y Box-and-One (catálogo de esquema base); reglas de
  timing "al recibir"/"al primer bote" del doble equipo de poste;
  sub-sistema de jugadas anti-zona completo (Overload, etc.); desgaste de
  Energía del press; seguimiento individual de compromiso al rebote
  ofensivo para transición defensiva; Transition Offense/POA Defense/
  Tactical Execution de las valoraciones de quinteto (7.12.28); un
  `GamePlan` propio del que los matchups podrían colgar de forma más
  natural (hoy viven en `TacticalProfile`).

## 2026-08-21 (2) — TAC-5: partido vivo y situaciones (DESIGN.md 7.12.33)

Quinta entrega de las 7 planificadas del sistema táctico (7.12). A
diferencia de TAC-1 a TAC-4 (todas ampliaciones de `Tactics.js` sobre el
mismo motor de posesión de siempre), esta entrega parte de una decisión
arquitectónica explícita de Dennis, no negociable: **el motor de partido
tenía que dejar de ser una función síncrona monolítica y convertirse en
algo REALMENTE pausable y reanudable**, no una aproximación que solo
resolviera ajustes entre cuartos — el plan a futuro (velocidades x4/x8/
x16/x32, cambios de táctica mid-partido, tiempos muertos anti-racha)
depende de ello, y romper `simulateMatch()` una segunda vez para eso más
adelante era peor que hacerlo bien ahora.

### 1. Motor de simulación por tramos (`src/core/MatchEngine.js`)

Confirmado por auditoría del código real (no memoria de sesiones
anteriores): antes de esta entrega, `simulateMatch()` era un
`do{...}while()` (períodos) anidando un `while(clockRemaining>0)`
(posesiones) con TODO el estado del partido como variables locales de esa
única función — nunca devolvía el control hasta terminar el partido
entero. El "reveal por cuartos" de `game.js` no pausaba nada real, solo
reproducía `quarterScores` ya calculados de antemano.

- **`createMatchState(homeTeam, awayTeam, config, options)`**: extrae TODO
  ese estado mutable a un objeto `MatchState` plano y serializable —
  `boxScore` (Map), `plusMinus` (Map), `quarterScores`, `runningScore`,
  `scoringRun`, `fastBreakEligible`, `eventLog`, `possessionCount`,
  `offenseSide`, `period`, `isOvertime`, `teamFouls`, `clockRemaining`,
  `periodPoints`, `totalElapsedSeconds`, `home/awayRotationState`, más los
  campos nuevos de esta entrega: `home/awayGamePlan`, `timeouts`
  (consumo por equipo/segmento), `pendingAto`, `lastTimeoutSide`,
  `lastTimeoutReason`, `lastPossessionWasDeadBall`,
  `previousPossessionInboundType`, y `phase`
  (`'beforePeriod'`/`'inPeriod'`/`'finished'`).
- **`advanceMatch(state, options)`**: avanza la simulación posesión a
  posesión (`simulateOnePossessionStep`, extraída literalmente del cuerpo
  del `while` de antes) hasta el punto de corte pedido en
  `options.stopAt`: `'possession'` (unidad mínima) | `'quarterEnd'` |
  `'timeoutTrigger'` | `'matchEnd'` (por defecto). Devuelve
  `{ state, stoppedReason }` — `state` es el MISMO objeto mutado in situ,
  se reutiliza la misma referencia en la siguiente llamada. Idempotente
  una vez `state.phase === 'finished'`.
- **`buildMatchResult(state)`**: construye el mismo shape de resultado que
  ya devolvía `simulateMatch()` (`finalScore`/`quarterScores`/
  `wentToOvertime`/`overtimePeriods`/`possessionCount`/`boxScore`/
  `eventLog`/`rotation`) — puede llamarse en CUALQUIER instante de
  `state`, terminado o en pausa, no solo al final.
- **`simulateMatch()` pasa a ser un wrapper de compatibilidad**:
  `createMatchState` + `advanceMatch(state, {stopAt:'matchEnd'})` +
  `buildMatchResult(state)` — MISMA firma, MISMAS `options`, MISMO shape
  de salida. `League.js`/`Bracket.js`/`Playoffs.js`/`Cup.js`/
  `Promotion.js`/`CpuLineup.js` no necesitan NINGÚN cambio (confirmado con
  `git diff --stat`: ninguno de esos archivos aparece en el diff de esta
  entrega).
- **Requisito de equivalencia (no negociable), verificado**: simular un
  partido de una sola llamada y simular el MISMO partido (misma semilla)
  cortando en cada posesión, por cuarto, o sin ningún timeout disponible
  (equivalente a por-cuarto) dan el resultado EXACTO — mismo marcador,
  mismo `quarterScores`, mismo `eventLog` (longitud y contenido
  idénticos), mismo `boxScore`, mismo `possessionCount`. Verificado con un
  script Node dedicado (scratchpad de esta sesión, PRNG determinista
  mulberry32 sustituyendo `Math.random` temporalmente, con reset de
  `dynamicState.energy` entre simulaciones para no arrancar la segunda ya
  desgastada por la primera). Un partido sin timeouts solicitados, sin
  GamePlan y con Auto Timeouts desactivado da el MISMO resultado que antes
  de esta entrega (`simulatePossession` no cambia, solo se hace pausable
  el bucle que la envuelve).

### 2. `GamePlan` — overrides de partido (`src/core/Tactics.js`)

- **`Tactics.GamePlan`** (7.12.23): overrides de UN partido concreto, sin
  tocar el `TacticalProfile` persistente del equipo. Alcance mínimo con
  pieza real de motor detrás (los 4 campos pedidos explícitamente):
  `playTypeWeights`, `matchupOverrides`, `pnrCoverage`,
  `defensiveScheme` (+ `situationalPlays`, ver punto 5). El resto del
  catálogo de 7.12.23 (target de mismatch, ritmo específico, orientación
  de shot profile, prioridad de rebote ofensivo, cobertura por jugador
  rival, over/under por handler, presión/distancia por jugador, negar
  recepción a estrella...) queda como catálogo de datos SIN
  comportamiento real, señalado explícitamente.
- **`Tactics.effectiveTacticalProfile(baseProfile, gamePlan)`**: vista
  MERGEADA con la MISMA forma que `TacticalProfile` — sin `gamePlan`
  (`null`, el caso de siempre), devuelve `baseProfile` tal cual, coste
  cero. El resto de `Tactics.js`/`MatchEngine.js` sigue leyendo
  `offenseTacticalProfile.*` exactamente igual que antes, sin saber que
  puede haber un GamePlan detrás — se llama en cada posesión desde
  `simulateOnePossessionStep`, así que un ajuste del usuario a mitad de
  partido YA se refleja en la siguiente posesión (el motor pausable del
  punto 1 es lo que lo hace posible de verdad).
- **`Tactics.applyGamePlanToProfile(profile, gamePlan)`**: "guardar como
  táctica base" — el ÚNICO camino explícito para que un GamePlan
  sobreviva al partido. Sin llamarlo, el GamePlan se descarta al terminar
  (nunca se persiste en ningún sitio) — regla de persistencia de 7.12.23
  cumplida por construcción, verificada con el script de invariantes.

### 3. Tiempos muertos como CONFIG (`src/core/MatchConfig.js`)

- **`config.match.timeouts`**: `perHalf: {first:2, second:3}`,
  `perOvertime:1`, `durationSeconds:60` (referencia FIBA/ACB citada
  literalmente por 7.12.24), más `lastMinutesThresholdSeconds:120` y
  `maxInLastMinutesOfFourthQuarter:2` (interpretación de partida de la
  restricción de "los últimos 2 minutos del 4º cuarto" — 7.12.24 no cierra
  la cifra exacta, "CONFIG/UX a calibrar después", señalado explícitamente
  como pendiente de calibración/decisión, 7.12.34) y
  `autoTriggerRunPoints:8` (el ejemplo literal del prompt, "parcial de
  8-0", reutilizando el mismo `scoringRun` ya trackeado por 7.6.20 en vez
  de un segundo contador de racha paralelo).
- **Seguimiento de consumo en `MatchState.timeouts`**: por equipo y
  segmento (`firstHalf`/`secondHalf`/`overtime<N>`, cada prórroga con su
  propio cupo independiente) + contador aparte
  `usedInLastMinutesOfFourthQuarter` para la restricción adicional.
  `MatchEngine.canCallTimeout(state, side)` (exportada, para que la UI
  pueda deshabilitar el botón sin duplicar la validación) y
  `consumeTimeout`/`requestTimeoutNow` validan siempre contra el máximo
  configurado — verificado con el script de invariantes (nunca se
  exceden los máximos, ni la restricción de los últimos 2 minutos).
- **Regla dura respetada**: ningún tiempo muerto toca `scoringRun` ni
  `dynamicState.momentum` — su único efecto real es marcar `pendingAto`
  (para el ATO del punto 5) y habilitar la ventana de intervención de
  `game.js`.

### 4. Ventanas de intervención — entre cuartos y en tiempo muerto

- **`advanceMatch(state, {stopAt:'timeoutTrigger', autoTimeouts})`**: se
  detiene en CUALQUIER granularidad que no sea `'matchEnd'` al llegar a un
  límite de cuarto (`stoppedReason:'quarterEnd'`), y además, dentro de un
  cuarto, cuando `evaluateTimeoutStop` decide que corresponde un tiempo
  muerto (`stoppedReason:'timeoutTrigger'`) — reutiliza LITERALMENTE
  `isDeadBallStoppage` (Rotation.js, el mismo criterio que ya usan las
  ventanas de sustitución automática, 7.11.2) para saber si el punto
  actual admite un tiempo muerto real.
- **`Auto Timeouts`** (`TacticalProfile.situations.autoTimeouts.enabled`,
  por equipo, desactivado por defecto): si está activo, `advanceMatch`
  concede el tiempo muerto automáticamente en la primera parada de juego
  disponible tras un parcial rival de `autoTriggerRunPoints`-0, sin abrir
  ninguna ventana — 1 regla mínima real, tal como pedía el prompt
  explícitamente ("1-2 reglas reales... sin abrir ventana de
  intervención").
- **`game.js`**: `startLiveMatch()`/`advanceLiveMatch()` conducen el
  partido de LIGA del usuario sobre este motor; `renderLiveMatchScreen()`
  muestra el marcador/quarterScores reales hasta el instante en que se
  pausó y una ventana de intervención (`renderMatchInterventionPanel`) con
  ajustes de GamePlan (cobertura de P&R, peso de Isolation) para el lado
  del usuario, botón "Pedir tiempo muerto"
  (`MatchEngine.requestTimeoutNow`, deshabilitado si `canCallTimeout`
  devuelve `false`) y "Guardar cambios como táctica base"
  (`applyGamePlanToProfile`). El reveal sigue mostrándose por cuartos, sin
  narrar cada posesión intermedia, tal como pedía explícitamente el
  prompt.
- **Encaje con `League.js` sin tocarlo**: `MatchEngine.simulateMatch()`
  acepta `options.precomputedResult` — si se pasa, devuelve ese resultado
  tal cual en vez de volver a simular. `game.js` juega el partido del
  usuario de verdad sobre `createMatchState`/`advanceMatch` ANTES de
  llamar a `league.simulateNextRound()`, y le pasa ese resultado ya
  resuelto para el partido del usuario (`resolveMatchOptions` devuelve
  `{precomputedResult}` solo para ese `match`, por referencia — el resto
  de la jornada se resuelve de golpe, como siempre). Sin esto, League.js
  volvería a simular el mismo partido con otra secuencia aleatoria —
  DISTINTO al que el usuario acaba de ver, rompiendo la coherencia con la
  clasificación. `league.getCurrentRoundMatches()` (ya existente, consulta
  pura sin efectos secundarios) se usa para saber si/contra quién juega el
  usuario esta jornada ANTES de pedirle a `League.js` que la resuelva.
- **Decisión de encaje explícita, señalada en 7.12.24-bis de
  `DESIGN.md`**: esta entrega solo expone el motor pausable/GamePlan/
  ventanas de intervención reales para el partido de LIGA del usuario —
  Copa/Playoff/Ascenso (`Bracket.js`/`Playoffs.js`/`Cup.js`/
  `Promotion.js`, ninguno tocado) siguen resolviéndose de golpe con el
  reveal cosmético de siempre (`renderReplayMatchScreen`, código
  preexistente sin cambios de comportamiento). Motivo: esos módulos
  resuelven el partido completo dentro de la misma llamada síncrona que
  decide el emparejamiento home/away del siguiente partido de la serie
  — no hay forma de saber de antemano contra quién/en qué lado juega el
  usuario sin tocarlos, a diferencia de `League.js` que sí expone
  `getCurrentRoundMatches()` por adelantado.

### 5. ATO/BLOB/SLOB/Late Clock/Last Possession (`src/core/Tactics.js`)

- **6 `PlayDefinition` nuevas** en `PLAY_DEFINITIONS`, misma arquitectura
  que el resto del catálogo (7.12.10) — cada una con `situationType`
  (`Tactics.SITUATION_TYPES`) y `resolvesAs` (a qué de los 3
  `REAL_PLAY_FAMILIES` con motor real se resuelve: `pickAndRoll`/
  `isolation`/`postUp`). Solo 1-2 jugadas por situación (catálogo mínimo,
  señalado explícitamente como ampliable).
- **`Tactics.resolveSituationType(situationContext, config)`**: clasifica
  la posesión — precedencia ATO > Last Possession > Late Clock > BLOB/
  SLOB. Reutiliza `config.pressure.buzzerBeaterSecondsThreshold` (Last
  Possession) y `config.lateClock.noFullPlayThresholdSeconds` (Late
  Clock), ya calibrados para otro propósito — solo
  `config.tactics.situational.lastPossessionMarginPoints` es una cifra
  nueva.
- **`Tactics.planSituationalPossession(params, situationType)`**:
  sustituye a `planTacticalPossession` SOLO para esa posesión —
  reutiliza LITERALMENTE `planPickAndRollTactical`/`buildIsolationPlan`/
  `buildPostUpPlan` (nunca un segundo selector de play-type paralelo,
  pedido explícito del prompt), con `forcePlay:true` para Pick & Roll
  (`buildPossessionPlan` gana un parámetro `forcePlay` opcional que salta
  el sorteo de frecuencia — la jugada se dibuja deliberadamente, no
  depende de que "toque" el sorteo normal). Sin jugada disponible para
  esa situación, cae a `planTacticalPossession` normal.
  `Tactics.chooseSituationalPlayType` prioriza la preferencia declarada
  por el equipo (`TacticalProfile.situations.preferredPlays`, ya fusionada
  con el `GamePlan.situationalPlays` de este partido si lo hay).
- **BLOB/SLOB inferido, aproximación señalada explícitamente**: este
  motor no modela el saque de banda/fondo como un suceso propio —
  `MatchEngine` infiere del ÚLTIMO evento de la posesión anterior
  (canasta de campo anotada = BLOB; cualquier otro final = SLOB). ATO se
  marca vía `state.pendingAto[side]` (fijado por `consumeTimeout`,
  consumido en la siguiente posesión EN ATAQUE de ese equipo, sin
  importar cuántas posesiones defensivas medien).

### 6. Falta táctica intencionada (`src/core/MatchEngine.js`)

- **`evaluateIntentionalFoul()`** (no un resolver de falta nuevo, pedido
  explícito del prompt): decisión que se evalúa AL PRINCIPIO de la
  posesión (antes de cualquier planificación táctica normal, para no
  gastar un sorteo de play-type que no se va a completar), gatillada por
  `TacticalProfile.situations.tacticalFoul` (`enabled`/`marginPoints`/
  `secondsRemaining`, desactivado por defecto — pestaña Situaciones).
  Objetivo: el rival EN PISTA con peor `freeThrows`. Committer: se evita
  al jugador propio con 4 faltas personales SI hay alternativa razonable
  en pista (si es el único disponible, se usa igual). La CPU usa
  exactamente esta misma función — solo lee `defenseTacticalProfile`, no
  distingue si el equipo es del usuario o gestionado por la CPU.
  Decisión de encaje señalada explícitamente: solo se evalúa en el último
  período regular o en prórroga (`period >= quartersTotal`) — 7.12.24 no
  cierra el umbral óptimo de segundos/margen, verificado con un
  escenario dirigido en el script de invariantes.
- Registra la falta reutilizando el MISMO camino que una falta defensiva
  normal (`recordPersonalFoul`/`handleFreeThrowSequence`, con/sin bonus),
  nunca un resolver nuevo.

### 7. Pantalla de Tácticas — sub-pestaña Situaciones (`src/ui/game.js`)

- **6ª sub-pestaña** `renderTacticsSituationsTab()` (mismo criterio visual
  que las 5 anteriores, confirmadas intactas con Playwright): checkbox de
  Auto Timeouts, checkbox + 2 inputs numéricos de falta táctica
  intencionada, y un `<select>` por cada una de las 5 situaciones
  especiales para elegir la jugada preferida del catálogo situacional
  (`preferredPlays`) o dejarlo en "Elegir automáticamente". Todo muta
  `team.tacticalProfile.situations.*` directamente, mismo patrón que la
  sub-pestaña Defensa.

### Verificación

- **Script Node de invariantes** (scratchpad de la sesión, no forma parte
  del repo — mismo criterio que TAC-2/TAC-3/TAC-4): equivalencia
  partido-completo vs. por-tramos (posesión/cuarto) EXACTA con semilla
  controlada; reglas de tiempos muertos (máximos por mitad/prórroga y
  restricción de últimos 2 minutos nunca excedidos, en un partido
  completo pidiendo tiempo muerto en cada oportunidad); falta táctica
  intencionada (objetivo = peor `freeThrows` en pista, jugador con 4
  faltas evitado con alternativa) en un escenario dirigido; `GamePlan`
  aplicado de verdad (`effectiveTacticalProfile` refleja el override) y
  no persistente salvo `applyGamePlanToProfile` explícito. Además, tres
  simulaciones de temporada/partido completas (18 equipos ficticios/34
  jornadas vía `League.js` sin cambios; 20 partidos con
  GamePlan+AutoTimeouts+falta táctica+petición de tiempo muerto activos
  simultáneamente; un partido con alineaciones reales de `Rotation.js` de
  ambos lados) sin errores.
- **Playwright** (scratchpad de la sesión): landing → "Empezar
  temporada" → selección de equipo real → pantalla de Tácticas (confirma
  las 5 sub-pestañas anteriores intactas + navega Situaciones, activa
  Auto Timeouts y falta táctica) → alineación válida asignada
  directamente sobre el estado (reutilizando `CpuLineup.buildCpuLineup`,
  no es el objetivo de este test cubrir la pantalla de Alineación) →
  "jugar siguiente jornada" → partido completo con 3 ventanas de
  intervención reales (fin de cuarto) hasta el marcador final, sin
  errores de consola (filtrado el único error de red esperable en este
  entorno: la Google Font externa de `index.html`, sin red saliente a
  fonts.googleapis.com, nada que ver con esta entrega).
- **`git diff --stat`**: solo `DESIGN.md`, `src/core/MatchConfig.js`,
  `src/core/MatchEngine.js`, `src/core/Tactics.js`, `src/ui/game.css`,
  `src/ui/game.js`. Ninguno de `League.js`/`Bracket.js`/`Playoffs.js`/
  `Cup.js`/`Promotion.js`/`CpuLineup.js`/`Rotation.js`/`Recovery.js`/
  `Calendar.js`/`Player.js`/`Team.js` aparece en el diff — el shape de
  `simulateMatch()` no cambió, así que ninguno de esos archivos necesitó
  ningún ajuste.

### Pendiente explícitamente para entregas futuras (ver también DESIGN.md 7.12.24-bis y 7.12.34)

- **TAC-6**: familiaridad táctica/`tacticalExecution` (el gancho
  `GamePlan.tacticalExecutionOverride` queda preparado, sin efecto) — el
  eje Rigidez↔Read&React de 7.12.7 también.
- **TAC-7**: IA táctica de la CPU más allá de Auto Timeouts/falta táctica
  (los equipos CPU llegan con ambos desactivados por defecto, igual que
  el usuario — que la CPU los tenga activados por defecto es una
  decisión de calibración de IA señalada, no resuelta), Data Hub táctico
  completo.
- Velocidades de reproducción x4/x8/x16/x32; cambios de táctica
  posesión-a-posesión (el `GamePlan` ya lo permite estructuralmente, el
  frontend de esta entrega no lo expone); tiempos muertos conectados a
  un efecto real sobre Racha/Momento (prohibido explícitamente por
  7.12.24, no implementado); extender el motor pausable/ventanas de
  intervención reales a Copa/Playoff/Ascenso.

## 2026-08-21 (3) — TAC-6: Familiaridad Táctica, `tacticalExecution` y complejidad (DESIGN.md 7.12.33)

Sexta de las siete entregas del sistema táctico (7.12). A diferencia de
TAC-1 a TAC-5, la sección de diseño que cubre esta entrega (7.12.22) es
deliberadamente abierta — el propio `DESIGN.md` admite explícitamente "no se
cierra todavía la curva matemática". Esto no es una omisión a rellenar de
golpe: significa que esta entrega construye una PRIMERA VERSIÓN concreta con
mecanismos simples y explicables, documentada como tal, no una fórmula
cerrada que nadie ha validado. Cada decisión de modelado de abajo se marca
explícitamente como punto de partida pendiente de calibración (7.12.34),
igual que se hizo con la Ruta A del motor pausable en TAC-5.

### 1. Dónde vive la Familiaridad (`src/core/Tactics.js`)

Decisión de encaje explícita, pedida por el prompt de esta sesión: la
familiaridad de EQUIPO/SISTEMA vive dentro de `TacticalProfile.familiarity`,
persistida en `Team.js` junto al resto del perfil pero deliberadamente
SEPARADA (el usuario declara la táctica; `familiarity` mide cuánto la
domina):

```
familiarity: {
  offensiveSystem: 0-100,
  defensiveSystem: 0-100,
  byPlayFamily: { pickAndRoll, isolation, postUp, handoff, offScreen, motionFlow },
  byCoverage: { drop, under, switch, hedge, blitz },
  byPlayerRole: { [playerId]: { offensiveRoleId, offensiveLevel, defensiveRoleId, defensiveLevel } },
}
```

- **`byPlayerRole`** es la familiaridad INDIVIDUAL del jugador con su rol
  (7.12.9/7.12.21) — no puede vivir en `Player.js` (vetado para atributos
  1-20 nuevos), así que vive aquí como mapa por `playerId`, mismo patrón que
  `roleAssignments` ya usa. Empieza VACÍO (como `roleAssignments`/
  `matchupOverrides`) — se rellena la primera vez que ese jugador participa
  en una posesión con un rol asignado, no al crear el perfil.
- **Familiaridad de QUINTETO con estructuras específicas**: NO implementada
  (7.12.22 la marca explícitamente como opcional en la primera
  implementación). El shape elegido no obliga a enumerar combinaciones de
  cinco jugadores para añadirla después — podría vivir como un mapa
  adicional `byLineupKey` sin tocar ninguno de los campos de arriba.
- **Valores de partida** (`config.tactics.familiarity` en `MatchConfig.js`,
  duplicados como constantes en `Tactics.js` siguiendo el mismo patrón que
  `DEFAULT_IDENTITY`/`DEFAULT_PLAY_TYPE_WEIGHTS`): 55/100 para
  `offensiveSystem`/`defensiveSystem`/cada entrada de `byPlayFamily`/
  `byCoverage` de un `TacticalProfile` recién creado — ni cero total ni
  máxima, pedido explícito del prompt. 35/100 la primera vez que un jugador
  recibe un `roleAssignment` (más bajo que el de sistema/familia: es más
  específico, se empieza a aprender jugando el rol). 15/100 cuando el
  `roleAssignment` de un jugador CAMBIA de un partido a otro (no hereda la
  familiaridad del rol anterior — invariante explícito verificado en el
  script de esta sesión).

### 2. Crecimiento y caída (`Tactics.computeFamiliarityGrowth`/`growFamiliarityValue`/`updateFamiliarityAfterPossession`)

7.12.22 lista 4 causas de crecimiento y 5 de caída/límite; esta entrega solo
tenía pieza real de motor para dos, tal como el prompt anticipaba:

- **Minutos reales ejecutando el sistema**: se acumula POSESIÓN A POSESIÓN
  dentro de `MatchEngine.simulateOnePossessionStep` (nivel de granularidad
  elegido de los dos que permitía el prompt — más fino que "agregar el uso
  al final del partido", sin necesitar un contador aparte). Cada posesión
  resuelta con play-type táctico real (P&R/Isolation/Post Up) hace crecer:
  la familia de jugada correspondiente (`byPlayFamily`) y, a ritmo atenuado
  (`systemGrowthShare`), el sistema ofensivo global; la cobertura defensiva
  ejecutada (`byCoverage`, solo P&R — Isolation/Post Up no tienen
  "cobertura" que aprender, alimentan solo el sistema defensivo global) y,
  atenuado, el sistema defensivo global; la familiaridad individual de rol
  de los participantes con un `roleAssignment` declarado. Fórmula de
  crecimiento: rendimientos decrecientes hacia 100
  (`growth *= (1 - nivel/100)^diminishingExponent`, así que el nivel se
  ESTABILIZA cerca del techo sin necesitar un tope duro aparte) frenados por
  la Complejidad (`PlayDefinition.complexity` para familias; una
  complejidad NOMINAL propia por cobertura —
  `coverageComplexity: {drop:15, under:15, switch:45, hedge:65, blitz:65}`,
  decisión de encaje propia: 7.12.16 no da una cifra de complejidad por
  cobertura como sí hace `PlayDefinition` para el playbook).
- **Alta complejidad limita la velocidad de subida** (no un techo aparte,
  que ya cubre el exponente de rendimientos decrecientes): reutiliza
  literalmente `PlayDefinition.complexity`, ya existente desde TAC-3 sin
  efecto real hasta ahora salvo desempatar selección — verificado con
  script de invariantes: la misma familia con el mismo número de usos
  alcanza un nivel más bajo si la jugada elegida es de complejidad alta.
- **Cambio de `roleAssignment` de un partido a otro**: implementado como el
  reinicio bajo descrito en el punto 1 — si el rol declarado de un jugador
  para un lado (ofensivo/defensivo) cambia respecto al último valor
  registrado, su familiaridad de ese rol se reinicia a
  `roleChangeResetValue` (15) en vez de heredar el nivel anterior; si no
  cambia, sigue acumulando con normalidad.
- **Entrenamiento táctico futuro / pretemporada**: FUERA de esta entrega —
  dependen de la sección 9 (Progresión) y del cierre de ciclo de temporada,
  ninguno de los dos existe todavía. Comentario de gancho dejado en el
  código (`growPlayerRoleFamiliarity`/`updateFamiliarityAfterPossession`),
  sin implementar nada.
- **Nuevos fichajes / periodos largos sin usar una familia**: FUERA de esta
  entrega — exigirían enganchar el módulo de fichajes (no existe todavía) y
  el ciclo de temporada; sin un punto de enganche limpio con lo que ya
  existe, se señala como pendiente en vez de forzar un acoplamiento
  improvisado con `SeasonGoals.js`/cierre de ciclo (3.4).

### 3. `tacticalExecution` (`Tactics.computeTacticalExecution`)

Rango 0-1 (elección de esta entrega, documentada en `MatchConfig.js`: mismo
rango que `advantageScore`/probabilidades del motor, se combina
directamente sin reescalar). Cruza, en la mezcla ponderada que pide
7.12.22:

- **Familiaridad relevante** (`Tactics.resolveRelevantFamiliarity`): media
  de sistema + familia/cobertura + individual de rol de los participantes
  de ESTA jugada (0-1), elevada a un exponente y multiplicada por un techo
  que dependen del eje Rigidez↔Read & React (ver punto 4).
- **`TrabajoEnEquipo`/`Concentración`/`Posicionamiento`/`VisiónJuego`/
  `DecisiónBajoPresión`**: mezcla ponderada de los participantes
  (`config.tactics.tacticalExecution.attributeMix`) — `TrabajoEnEquipo`
  entra aquí precisamente por la excepción que 7.12.18 ya reservaba
  ("participa en `tacticalExecution`... NO aumenta la probabilidad técnica
  de tiro/robo/tapón/rebote por sí solo"), confirmado en `DESIGN.md` antes
  de usarlo.
- **Energía**: `dynamicState.energy` directo de los participantes — NO se
  duplica el cálculo de Fatiga de 7.5-bis (pedido explícito del prompt),
  solo se usa el dato ya existente como factor de entrada.
- **Experiencia**: `player.experience` normalizado con el MISMO divisor que
  ya usa `computeMixRating` (`pressure.experienceBonusDivisor`, 7.5) — no
  se inventa una segunda escala de "veteranía".
- **Complejidad requerida**: penalización DIRECTA (no solo vía familiaridad)
  de `PlayDefinition.complexity` de la jugada elegida esta posesión.

**Regla dura respetada** (verificada revisando cada punto de enganche antes
de escribirlo): NUNCA una resta plana a un atributo de la jugada. Los 3
errores reconocibles con mecanismo real esta entrega (de los 10 que lista
7.12.22 — priorizados por tener ya un punto de enganche real en el motor,
tal como pedía el prompt):

- **Pérdida ofensiva de sistema**: `tacticalPlan.turnoverExecutionMultiplier`
  modula `MatchEngine.rollTurnover()` YA EXISTENTE (se combina
  multiplicativamente con `pressEffect.turnoverMultiplier` de TAC-4, nunca
  un segundo resolver) — 1 (sin efecto) con ejecución perfecta, hasta
  `turnoverMaxMultiplier` (1.4) con ejecución nula.
- **Lectura incorrecta / pérdida de continuidad**:
  `Tactics.applyTacticalExecutionMisread` degrada la lectura de
  `AdvantageState` (6 categorías, 7.12.4) un escalón hacia el peor
  resultado para el ataque, con probabilidad inversa al tacticalExecution
  ofensivo (`misreadMaxProbability`, 0.25 máximo) — se aplica SOLO a la
  primera lectura de cada posesión (no a las lecturas de la segunda acción
  de continuidad, para no acumular dos degradaciones seguidas); con doble
  equipo de poste activo tampoco se aplica (esa lectura ya es una decisión
  deliberada de la defensa, no algo que el ataque pueda "leer mal" por su
  cuenta).
- **Ayuda defensiva tarde / error de switch / dos defensores ayudando al
  mismo jugador** (los tres fusionados en un único mecanismo, mismo punto
  de enganche): `Tactics.resolveDefensiveExecutionOverride` sustituye, con
  probabilidad inversa al tacticalExecution defensivo
  (`defensiveMisexecutionMaxProbability`, 0.2 máximo), la selección YA
  HECHA de `screenerDefender` (`buildDefensivePlan`, estimando el
  tacticalExecution defensivo solo con `onBallDefender` — el propio
  `screenerDefender` es la pieza que se puede corromper, no puede depender
  de sí mismo) o del ayudante del doble equipo de poste
  (`pickDoubleTeamHelper`, estimando con `postDefender` antes de conocer al
  ayudante) por el candidato MENOS preparado disponible (mismo criterio que
  `pickLeastContestedDefender` ya usa para el closeout tardío).

Quedan SIN mecanismo propio en esta primera versión (señalado explícitamente
en vez de inventar un resolver nuevo para forzarlos): mal timing de
pantalla/corte, spacing roto, pase tarde, dos jugadores ocupando el mismo
espacio, closeout equivocado. Ninguno tenía ya un punto de enganche real en
el motor existente sin crear un resolver nuevo — 7.12.22 no exige modelar
los 10, solo priorizar los que sí lo tienen.

`GamePlan.tacticalExecutionOverride` (7.12.23): TAC-5 dejó este campo
preparado sin efecto ("gancho explícito para TAC-6"); esta entrega le da su
primer uso — un número 0-1 sustituye directamente el `tacticalExecution`
calculado, SOLO para el partido de ese `GamePlan`, sin editor propio en la
pantalla de Tácticas todavía (pensado para casos manuales/futuros, ej. una
IA de scouting de TAC-7).

### 4. Eje Rigidez↔Read & React (`DESIGN.md` 7.12.7)

Tercera vez que se menciona este eje (TAC-2, TAC-3) y primera en la que
tiene efecto real — antes ni siquiera existía como campo en `identity`, solo
estaba señalado en el texto de `DESIGN.md`. Se añade
`identity.rigidity` (0-100, 50 neutro, mismo criterio que el resto de ejes)
y se conecta a `computeTacticalExecution`: interpola el TECHO
(`readAndReactCeiling` 0.85 ↔ `rigidityCeiling` 0.95) y el EXPONENTE
(`readAndReactExponent` 0.65 ↔ `rigidityExponent` 1.6) de la curva
familiaridad→ejecución. Un equipo más Rigidez alcanza un techo más alto con
familiaridad alta, pero el exponente >1 (convexo) castiga con más dureza la
familiaridad baja ("sufre más los errores"); un equipo más Read & React
tiene un techo algo más bajo, pero el exponente <1 (cóncavo) "levanta" el
resultado con familiaridad baja ("más tolerante", menos dependiente de un
guion fijo). `rigidity=50` (neutro) interpola a medio camino entre ambos
pares, sin caso especial. Solo se aplica al lado OFENSIVO (la defensa usa
rigidez neutra fija — 7.12.13/7.12.14 no define un eje de identidad
defensiva equivalente).

### 5. Pantalla de Tácticas (`src/ui/game.js`/`game.css`)

Nueva sección "Familiaridad" dentro de la sub-pestaña Resumen (ya
existente, ninguna sub-pestaña nueva — 7.12.22 la describe como "estado que
se observa", no se configura): familiaridad de sistema ofensivo/defensivo
(barras 0-100) y las 2-3 familias de jugada / coberturas defensivas MÁS
ENTRENADAS. Como esta entrega no registra un contador de uso/frecuencia
aparte (eso es telemetría de 7.12.27, TAC-7/Data Hub), "más entrenadas" se
aproxima con la mayor desviación absoluta respecto al valor de partida —
una familia/cobertura nunca usada se queda exactamente en el valor inicial,
así que cualquier desviación real solo puede venir de haberla jugado
(decisión de encaje señalada explícitamente, no una cifra de diseño).
Sin ningún uso todavía, muestra un mensaje explicativo en vez de una lista
vacía. Sección de solo lectura, sin ningún editor — mismo criterio visual
(`gm-card`/`gm-muted`) que el resto de la pantalla.

### Verificación

- **Script Node de invariantes** (scratchpad de la sesión, no forma parte
  del repo — mismo criterio que TAC-1 a TAC-5): balance de TAC-1 a TAC-5
  intacto con familiaridad en su valor inicial por defecto (6 partidos de
  prueba, puntuación total por partido en rango realista); familiaridad de
  una familia de jugada sube con uso repetido y se estabiliza cerca de un
  techo (60 usos simulados, el último incremento cae por debajo de 0.5
  puntos); una jugada de complejidad alta (70) alcanza un nivel más bajo
  que una de complejidad baja (15) con el mismo número de usos (60);
  cambio de `roleAssignment` arranca con familiaridad de rol baja, no
  hereda la del rol anterior; `tacticalExecution` bajo (familiaridad 0)
  produce multiplicador de pérdida de balón mayor y frecuencia medible
  mayor de "lectura incorrecta" (2000 tiradas) que `tacticalExecution` alto
  (familiaridad 100), mismo mecanismo. Además, comparación de balance
  agregada (20 partidos con los 3 mecanismos de TAC-6 neutralizados vs. 20
  con sus valores reales): puntuación total por partido 172.6→167.0
  (-3.2%), pérdidas de balón por partido 44.8→49.4 (+10.3%) — cambio real y
  medible (el objetivo explícito de esta entrega) pero no un desequilibrio
  perceptible del balance ya demostrado en TAC-1 a TAC-5.
- **Playwright** (scratchpad de la sesión): landing → "Empezar temporada"
  → selección de equipo real → pantalla de Tácticas, confirmando las 6
  sub-pestañas anteriores intactas (Resumen/Ataque/Roles/Playbook/
  Defensa/Situaciones) y que Resumen ahora muestra la sección
  "Familiaridad" (sistema ofensivo/defensivo en 55, sin familias/
  coberturas por encima del punto de partida en un perfil recién creado,
  como se espera) sin errores de consola relevantes (el único error de red
  observado es la Google Font externa de `index.html` sin salida a
  fonts.googleapis.com en este entorno, nada que ver con esta entrega,
  igual que en el Playwright de TAC-5).
- **`git diff --stat`**: `DESIGN.md`, `src/core/MatchConfig.js`,
  `src/core/MatchEngine.js`, `src/core/Tactics.js`, `src/ui/game.css`,
  `src/ui/game.js`. Ninguno de `Rotation.js`/`Recovery.js`/`Calendar.js`/
  `League.js`/`Bracket.js`/`Cup.js`/`Playoffs.js`/`Promotion.js`/
  `CpuLineup.js`/`Player.js`/`Team.js` aparece en el diff — el
  `TacticalProfile` que ya persiste en `Team.js` desde TAC-2 absorbe el
  nuevo shape de familiaridad sin tocar `Team.js` en sí, mismo patrón que
  TAC-4 usó con `defensiveScheme`.

### Pendiente explícitamente para entregas futuras (ver también DESIGN.md 7.12.34)

- Familiaridad de QUINTETO con estructuras específicas (explícitamente
  opcional en la primera implementación de 7.12.22); entrenamiento táctico
  detallado (sección 9, sin diseñar); decaimiento de familiaridad por
  fichajes/cambios de plantilla ligado al ciclo de temporada (sin punto de
  enganche limpio todavía).
- Los 5 errores reconocibles de 7.12.22 sin mecanismo propio (mal timing de
  pantalla/corte, spacing roto, pase tarde, dos jugadores en el mismo
  espacio, closeout equivocado).
- **TAC-7**: telemetría completa de 7.12.27 (Data Hub), incluida la
  frecuencia de uso real de cada familia/cobertura que permitiría mostrar
  "más usadas recientemente" con datos reales en vez de la aproximación por
  desviación de esta entrega; IA táctica de la CPU más allá de lo ya
  existente.
- Calibración cuantitativa final de todos los valores numéricos nuevos de
  `config.tactics.familiarity`/`tacticalExecution` contra datos reales tras
  simulación masiva (7.12.31) — esta entrega solo verifica DIRECCIÓN, no
  cifras cerradas, tal como 7.12.22 admite explícitamente.

## 2026-08-21 (4) — TAC-7: Data Hub táctico, informe de rival e identidad automática de la CPU (DESIGN.md 7.12.33)

Séptima y ÚLTIMA entrega planificada del sistema táctico (7.12) — 7.12.33
no define una TAC-8. Auditado el repo real antes de escribir código (no
memoria de sesiones anteriores): TAC-1 a TAC-6 estaban íntegras en
`src/core/Tactics.js` (2502 líneas), `MatchEngine.createMatchState()`/
`advanceMatch()`/`simulateOnePossessionStep()` ya pausables desde TAC-5, y
NINGÚN equipo CPU tenía un `TacticalProfile` distinto del default universal
(confirmado revisando `CpuLineup.js`/`Team.js`: 35 de 36 equipos jugaban con
exactamente la misma identidad táctica).

### Resolución de alcance — 7.12.33 vs. CHANGELOG informal de TAC-6

7.12.33 define TAC-7 oficialmente como "Data Hub y scouting táctico", sin
incluir la IA táctica completa de 7.12.25 en su alcance obligatorio. El
CHANGELOG de TAC-6 apuntaba, de forma más informal, "IA táctica de la CPU
más allá de lo ya existente" hacia TAC-7 sin que 7.12.33 lo confirme como
obligatorio. Al ser la última entrega planificada, se resuelve así:

- **Obligatorio** (7.12.33 lo exige explícitamente): telemetría completa
  de 7.12.27 (subconjunto representativo, ver más abajo), PPP/frequency
  por play-type, coverage efficiency, shot profile/quality, lineups,
  informe de rival, alertas de muestra pequeña, gancho estructural de
  Scouting.
- **Incluido, acotado a su mínimo real**: Construcción de identidad CPU
  (7.12.25, primera de sus tres piezas) — sin esto, "scoutear" a un rival
  CPU siempre descubre la misma identidad genérica, así que el resto de
  esta entrega no tendría sentido jugar.
- **Explícitamente FUERA, con nota de visión futura en `DESIGN.md`
  7.12.25**: Plan de partido CPU basado en scouting real y Ajustes en vivo
  CPU con anti-sobrerreacción (las otras dos piezas de 7.12.25) —
  requieren su propia sesión de diseño/calibración, no un cierre
  apresurado. `playerTendencies` (7.12.26) sigue fuera de la EPIC, el
  propio `DESIGN.md` lo confirma arquitectura futura.

### 1. Registro de telemetría por posesión (`src/core/MatchEngine.js`)

- **`MatchState.gameId`/`telemetryEnabled`/`telemetryLog`** (nuevos campos
  de `createMatchState`): `gameId` es un contador determinista
  (`match-${homeId}-${awayId}-${n}`) — **nunca** `Math.random()`, que
  desplazaría la secuencia de tiradas de todo el partido. `telemetryEnabled`
  (`options.telemetryEnabled !== false`, por defecto `true`) controla el
  bloque entero de registro; `telemetryLog` es el array de registros crudos
  de ESE partido (nunca persiste entre partidos, ver punto 2).
- **`buildPossessionTelemetryRecord()`** (nueva, `MatchEngine.js`): se
  construye en `simulateOnePossessionStep`, justo después de
  `updateFamiliarityAfterPossession`, reutilizando el quinteto real ya
  calculado para +/- (`offenseFiveForPlusMinus`/`defenseFiveForPlusMinus`,
  adelantado en el código para no duplicar `getOnCourtFive`) y los campos
  ya expuestos por `result.tacticalUsage` (ampliado, ver más abajo).
  Campos capturados: `gameId`/período/reloj/marcador, quinteto ofensivo y
  defensivo real, fase (transición/media pista, vía
  `context.fastBreakEligible`), `playType`/`playId`, initiator/screener,
  roles activos (`offense/defenseParticipantIds`), cobertura P&R,
  `advantageScore` (única pieza ya calculada equivalente a "AdvantageState
  en un punto de la cadena"), counter/continuación (`continuityState`),
  `shotQuality` (proxy, ver más abajo), tipo de acción final, defensor
  real del tiro (parcial, ver gap), resultado (`outcome`), asistencia y
  por quién, situación especial si la hubo, `GamePlan` vigente
  (`gamePlanActive`). Campos de 7.12.27 explícitamente FUERA, sin dato real
  disponible sin inventarlo o sin instrumentar más `simulatePossession` de
  lo prudente: "número de pases relevantes" (no se simulan pases
  individuales fuera del propio P&R/Post Up); "reloj de posesión al
  finalizar" (`shotClock` es una variable interna que nunca se devuelve,
  los rebotes ofensivos la resetean a mitad de posesión); `shotDefenderId`
  de una posesión NO táctica sin tapón (la rama 1v1 de siempre no expone su
  defensor de tiro elegido — solo se captura vía `tacticalPlan` o vía el
  evento `blockedShot`, que sí lleva `defenderId`).
- **`buildTacticalUsage()` ampliada** (ya existía desde TAC-6, solo
  exponía 5 campos para familiaridad): añade `shooterId`/`shotDefenderId`/
  `assistCandidateId`/`forcedShotType`/`read3`/`continuityState`/
  `advantageScore`/`situational` — TODOS ya calculados por
  `Tactics.planPickAndRollTactical`/`buildIsolationPlan`/`buildPostUpPlan`
  para esta jugada concreta, cero cálculo nuevo (regla de integración #1,
  7.12.30, aplicada igual que a los 5 campos existentes).
- **`shotQuality` (7.12.5/7.12.34)**: no existe todavía el valor numérico
  cerrado que pide el diseño (7.12.34 lo confirmaba pendiente antes de esta
  entrega) — se aproxima con `advantageScore` reescalado de -1..1 a 0..1,
  SOLO cuando la posesión tuvo un `tacticalPlan` real (es la pieza más
  parecida ya calculada, evita inventar un segundo cálculo). Sin
  `tacticalPlan`, queda `null` en vez de un número inventado.
- **Regla dura de esta entrega, verificada**: el registro de telemetría es
  observación pura — nunca llama a `Math.random()`, nunca decide nada del
  partido, solo reorganiza datos que `context`/`result` ya tenían
  calculados. Verificado con un script de equivalencia (semilla mulberry32
  fija, mismo par de equipos, energía reseteada entre tiradas): mismo
  marcador final, mismo `quarterScores`, mismo `eventLog` (longitud y
  contenido idénticos), mismo `possessionCount` con `telemetryEnabled`
  `true`/`false`.

### 2. Agregación persistente por equipo (`src/core/Tactics.js`)

- **`TacticalProfile.tacticsTelemetry`** (nuevo campo, mismo patrón de
  encaje que `familiarity` en TAC-6): agregados por equipo —
  `offense.{possessions, points, byPlayType, byPlayDefinition, shotZones,
  assistedMade, unassistedMade, turnovers, shotQualitySum/Count}`,
  `defense.{possessions, pointsAllowed, byCoverage, shotZonesAllowed}`,
  `lineups` (mapa por clave de quinteto = ids ordenados y unidos). Empieza
  en CERO ABSOLUTO (a diferencia de `familiarity`, que arranca en un valor
  neutro): no hay telemetría real antes del primer partido, cero es el
  dato correcto, no una aproximación. `games` se incrementa EXACTAMENTE
  una vez por partido, en la transición a `state.phase = 'finished'` dentro
  de `advanceMatch` (nunca en `buildMatchResult`, que puede llamarse varias
  veces sobre el mismo `state` en pausa).
- **`Tactics.updateTacticsTelemetryAfterPossession()`** (nueva): mutación
  in situ sobre los perfiles PERSISTENTES (nunca la vista efectiva
  fusionada con `GamePlan`, mismo criterio que la familiaridad), llamada
  desde `simulateOnePossessionStep` justo después de
  `updateFamiliarityAfterPossession`. Solo se acumulan AGREGADOS (decisión
  de encaje explícita, 7.12.27 lo permite: "no necesariamente cada
  posesión cruda de cada partido histórico") — el log crudo posesión a
  posesión vive únicamente en `MatchState.telemetryLog` mientras dura CADA
  partido, nunca se persiste entre partidos.
- Verificado con una temporada ficticia completa (18 equipos, 34 jornadas,
  vía `League.js` sin tocar): `tacticsTelemetry.games` de un equipo = 34
  jornadas jugadas, `offense.n`/`defense.n` en el rango esperado (~83
  posesiones/partido), cientos de lineups distintos registrados (rotación
  real de minutos genera muchas combinaciones de quinteto a lo largo de
  una temporada).

### 3. Derivadas de Ataque/Defensa/Lineups con tamaño de muestra (`Tactics.js`)

- **`Tactics.summarizeTacticsTelemetry(profile, config)`** (nueva):
  subconjunto representativo de 7.12.27, priorizado por valor para el
  informe de rival (punto 4) — Ataque: frecuencia+PPP por play-type
  (incluye `'none'` = posesión sin play-type táctico, para que la
  frecuencia sea sobre el TOTAL de posesiones, no solo las tácticas),
  rim/midrange/3P frequency+FG%, assisted FG%, turnover rate, calidad de
  tiro media, efectividad por `playDefinitionId`. Defensa: PPP concedido
  por cobertura, frecuencia de cada cobertura, shot profile permitido,
  "eficiencia de mismatch concedida" (aproximada explícitamente como PPP
  concedido en posesiones con cobertura Switch — el único mismatch real
  que el motor modela hoy, 7.12.31 invariante 3; 7.12.27 no da una fórmula
  cerrada de "mismatch efficiency", señalado explícitamente). Lineups:
  ORtg/DRtg/Net aproximado (puntos/posesión × 100) y spacing efectivo medio
  por quinteto real usado.
- **Regla dura de 7.12.27, no negociable, cumplida por construcción**:
  CADA derivada devuelve su `n` (tamaño de muestra) junto al valor — no
  existe ninguna función de este módulo que devuelva un promedio/frecuencia
  sin su `n` acompañante. Verificado con un caso dirigido (2 registros
  manuales con resultado conocido: 3 puntos en Pick & Roll vs Switch, 0
  puntos en Post Up) contra las 3 categorías: PPP total = 1.5, PPP
  Pick&Roll = 3, frecuencia Pick&Roll = 0.5, PPP concedido en Switch = 3,
  ORtg del lineup = 150 — todos coinciden exactamente con el cálculo
  manual.
- **`config.tactics.telemetry.minReliableGames`/`minReliablePossessions`**
  (`MatchConfig.js`, 3 y 15 respectivamente): umbral de "muestra pequeña"
  — cifras propias, pendientes de calibración/decisión (7.12.34), no un
  intervalo de confianza estadístico real, solo "hay muy poco que mirar
  todavía".
- Métricas del catálogo completo de 7.12.27 dejadas para una ampliación
  futura del Data Hub, señaladas explícitamente (la arquitectura de
  telemetría no bloquea añadirlas): efficiency tras DHO/Off Screen/Post/
  Isolation por separado, Transition Frequency/PPP detallado, FT rate por
  play-type, ATO PPP, rebote ofensivo vs. puntos concedidos en transición,
  puntos concedidos tras superar primera línea, eficiencia de zona/man por
  separado, rebote defensivo por shell.

### 4. Informe de rival — sub-pestaña "Rival" (`src/ui/game.js`/`game.css`)

- **Séptima y última sub-pestaña** de la pantalla de Tácticas
  (`renderTacticsRivalTab`), junto a las 6 ya existentes (confirmadas
  intactas con Playwright).
- **Selección del rival**: `getNextLeagueOpponent(team)` (nueva) consulta
  `league.getCurrentRoundMatches()` — ya existente, consulta pura, sin
  tocar `League.js` — para encontrar el próximo rival de LIGA real del
  usuario; los objetos `Team` devueltos son los MISMOS en memoria que la
  liga (a diferencia de `getAllRealTeamsForMatchupTarget()`, que
  RECONSTRUYE equipos desde el bundle solo para nombres de jugador en el
  formulario de matchups — no vale para esto, perdería toda la telemetría
  acumulada). Sin partido esta jornada o liga terminada, cae a un selector
  manual entre los equipos de la división del usuario (`<select
  id="tactics-rival-select">`), tal como permitía explícitamente el prompt
  de esta sesión.
- **Contenido**: play-types dominantes (frecuencia+PPP), coberturas
  habituales (frecuencia+PPP concedido), shot profile propio/permitido,
  mismatches potenciales contra el quinteto titular propio, quinteto más
  usado (ORtg/DRtg/Net) — todo reutilizando
  `Tactics.summarizeTacticsTelemetry`/`roleFit`/`bestRolesForPlayer` ya
  existentes, sin ningún cálculo de encaje nuevo.
- **Mismatches potenciales** (`computeMismatchRows`): para cada titular
  propio, su MEJOR rol ofensivo (`bestRolesForPlayer`) contra el mejor
  encaje rival en la contraparte defensiva directa (`roleFit` sobre TODA
  la plantilla rival convocable, no un quinteto fijo) — el mapeo rol
  ofensivo → contraparte defensiva (`OFFENSE_TO_DEFENSE_COUNTERPART`) es
  una decisión de encaje INTERPRETATIVA propia, señalada explícitamente
  (7.12.25/7.12.32 no cierran qué rol defensivo "responde" a cada rol
  ofensivo) — el NÚMERO en sí siempre viene de `roleFit`, nunca se
  recalcula. "Posible ventaja" con diferencia de ≥2 estrellas, umbral
  propio pendiente de calibración.
- **Alerta de muestra pequeña, obligatoria** (7.12.27, cita literal: "no
  presentar 2 posesiones, 1.50 PPP como una verdad táctica estable"): un
  banner visible cuando `summary.smallSample` (partidos/posesiones por
  debajo del umbral de `config.tactics.telemetry`), además de un badge por
  métrica individual con `n` insuficiente — verificado con Playwright en
  una partida recién empezada (0 partidos contra cualquier rival): el
  banner aparece.
- **Gancho de visibilidad limitada por Scouting** (7.12.27, "futura capa"
  — el módulo de Scouting no existe todavía, 6.2.2 punto 5 lo deja para
  sesión futura): NO se implementa ningún sistema de visibilidad parcial
  en esta entrega — el informe se muestra siempre completo. El gancho
  estructural es la separación entre "dato calculado"
  (`Tactics.summarizeTacticsTelemetry`, siempre completo) y "dato
  mostrado" (`game.js`, capa de presentación pura sobre ese objeto) — una
  futura capa de Scouting podría ocultar/difuminar partes del segundo sin
  tocar el primero, señalado explícitamente como el gancho dejado, sin
  implementarlo.
- **Corrección de una nota obsoleta de TAC-6** (pedido explícito de esta
  sesión): la sección "Familiaridad" de Resumen mostraba "familias/
  coberturas más entrenadas" aproximado por desviación de familiaridad
  (sin contador de uso real, señalado en su momento como pendiente de
  TAC-7). Con `tacticsTelemetry` ya construido, `topUsedFamiliarityEntries`
  ordena ahora por el CONTADOR REAL de posesiones — "más entrenadas" pasa
  a "más usadas", con datos reales en vez de una aproximación.

### 5. Construcción de identidad CPU (`Tactics.buildCpuTacticalIdentity`)

- Se llama UNA VEZ por equipo, dentro de `game.js` `startSeason()`, justo
  después de construir los equipos reales de cada división y ANTES de
  crear la `League` — "arrancar una partida nueva" es la pretemporada
  conceptual de esta primera temporada (mismo criterio ya usado para
  `recalculateSportingGoalsForDivision` en ese mismo punto). Excluye
  explícitamente al equipo del usuario (`teamId === state.userTeamId`,
  comprobado antes de asignar). `CpuLineup.js` NO se toca — decide
  quinteto/minutos PARTIDO A PARTIDO reutilizando el `tacticalProfile` ya
  asignado aquí, son eventos de granularidad distinta (confirmado en
  auditoría, punto 4 del prompt de esta sesión). Persiste sola en
  `closeSeasonAndPrepareNext()` sin ningún enganche adicional: esa función
  reutiliza las MISMAS instancias de `Team` (nunca las reconstruye desde
  el bundle), así que `team.tacticalProfile` sobrevive a cada cierre de
  ciclo — no se necesitó ningún punto de enganche en `League.js`/
  `SeasonGoals.js` (de la lista vetada), `game.js` ya bastaba.
- **Heurística** (`config.tactics.cpuIdentity`, `MatchConfig.js`): evalúa
  la plantilla real completa (`team.roster`, no solo 5 titulares) contra
  el catálogo de roles YA EXISTENTE (`Tactics.roleFit`/
  `bestRolesForPlayer`, nunca un segundo cálculo de encaje) — creador real
  (`primaryCreator`/`pnrHandler`), interiores con encaje Roll/Pop
  (`rollMan`/`pickAndPopBig`) vs. interior tradicional (`postScorer`),
  tiro/spacers (`spotUpShooter`/`movementShooter`), movilidad perimetral
  (`switchDefender`/`perimeterDisruptor`), protector de aro LENTO
  (`rimProtector` + movilidad física propia del MISMO jugador, agilidad+
  aceleración media, sin blend de posición). `clubDNA` aplica un sesgo
  PEQUEÑO y acotado (`config.tactics.cpuIdentity.dnaBias`, nunca una orden
  obligatoria — cita literal de 7.12.25) sobre pace/uso de P&R/probabilidad
  de press, mismo criterio de mapeo por texto exacto que `tempo.dnaBias`
  (TAC-1).
- **Umbral `specialistThreshold` = 15 (escala `roleFit` 1-20), no 13**:
  decisión de calibración verificada durante esta misma sesión —
  `roleFit` combina 70% mezcla de atributos + 30% competencia posicional,
  así que CUALQUIER jugador con atributos neutros (10) en su posición
  "natural" ya puntúa ~13 solo por el blend posicional (verificado con el
  script de esta entrega). Un umbral de 13 hacía que "tener un jugador en
  cada posición" (cualquier plantilla de 5+) se leyera como "tener un
  especialista real" en casi cualquier rol — 15 sí distingue un
  especialista genuino de "alguien que ocupa esa posición sin más".
  `weakThreshold` = 9 se usa SOLO contra medias de atributo físico directas
  (movilidad del protector de aro), nunca contra un `roleFit` ya blendeado
  con posición (mismo suelo que distorsiona el umbral alto).
- **Dirección verificada con 4 arquetipos de prueba** (script Node
  dedicado, scratchpad de esta sesión): (A) base creador + interiores con
  encaje Roll/Pop + tiradores → más peso de Pick & Roll,
  `pickAndRollUsage` por encima del neutro; (B) interior dominante + sin
  especialista de tiro real → `spacing = '3-out-2-in'`, más peso de Post
  Up, `pnrCoverage = 'drop'`; (C) wings con switchability/perimeterDefense
  altos → `pnrCoverage = 'switch'`, más peso de Transition + press activo
  con mayor probabilidad; (D) pívot con `rimProtector` alto y movilidad
  física baja (agilidad/aceleración) → `pnrCoverage = 'drop'`, nunca
  `'switch'`. Los 4 resultan en la dirección que describe 7.12.25, no solo
  "sin romper nada".
- **Requisito de regresión, verificado**: la identidad recién asignada
  nunca combina `spacing = '5-out'` con `playTypeWeights.postUp`
  dominante (los dos branches que los asignan son mutuamente excluyentes
  en la heurística) — ninguno de los 4 arquetipos ni el smoke test de 6
  partidos completos con identidades reales produjo una combinación
  reconocible como rota.
- Rebote y Energía/edad de rotación (7.12.25, señales listadas) se evalúan
  como criterio de auditoría de plantilla pero NO mueven ninguna decisión
  de esta heurística — no hay todavía un eje de `TacticalProfile` con
  comportamiento real al que conectarlos (ej. "prioridad de rebote
  ofensivo" es catálogo de `GamePlan` sin pieza de motor, 7.12.23) sin
  inventar uno, señalado explícitamente en vez de forzar un acoplamiento.

### 6. Valoraciones de quinteto pendientes cerradas (7.12.28, `Tactics.computeLineupRatings`)

- **Transition Offense**: nueva mezcla mínima
  (`config.tactics.lineupRatings.transitionOffenseMix`: aceleración/
  velocidad punta/visión de juego/bandeja) — valoración de APTITUD de
  plantilla, se recalcula al cambiar un jugador sin depender de partidos
  jugados (mismo criterio que el resto de `computeLineupRatings`).
- **POA Defense**: reutiliza LITERALMENTE `config.tactics.roles.
  defensiveMix.poaStopper` (7.12.21) — es exactamente lo que ese rol ya
  mide, no una mezcla nueva.
- **Tactical Execution**: única de las tres que SÍ depende de
  `tacticalProfile` — reutiliza literalmente `Tactics.computeTacticalExecution`
  (7.12.22) con familiaridad = media de sistema ofensivo/defensivo,
  complejidad = 0 (foto en reposo del quinteto, sin ninguna jugada
  concreta elegida todavía, a diferencia de una posesión real) y el eje
  Rigidez↔Read&React del propio equipo.
- Las tres eran las últimas 3 de las 12 valoraciones de 7.12.28 sin
  implementar (TAC-2 dejó las 8 primeras con reservas, TAC-4 cerró
  Switchability/Rim Protection/Transition Defense) — con esta entrega,
  7.12.28 queda completo.

### Verificación

- **Script Node de invariantes** (scratchpad de la sesión, no forma parte
  del repo — mismo criterio que TAC-1 a TAC-6): equivalencia exacta
  con/sin telemetría (marcador, `quarterScores`, `eventLog`,
  `possessionCount` idénticos, semilla mulberry32 fija); derivadas de las
  3 categorías con `n` en cada entrada; caso dirigido con resultado
  conocido de antemano (PPP/frecuencia/ORtg exactos); identidad CPU
  verificada por arquetipo (4 rosters de prueba, dirección esperada +
  regresión de combinación rota); balance TAC-1 a TAC-6 intacto (6
  partidos ficticios completos, puntuación total en rango realista);
  temporada ficticia completa de 34 jornadas sin errores, con telemetría
  agregada coherente al final.
- **Playwright** (scratchpad de la sesión): landing → "Empezar temporada"
  → selección de equipo real → pantalla de Tácticas, confirmando las 6
  sub-pestañas anteriores intactas y navegando la nueva sub-pestaña Rival
  — el selector auto-detecta el próximo rival REAL de calendario (Liga,
  vía `getCurrentRoundMatches()`, verificado mostrando su nombre marcado
  como "(próximo rival de liga)"), la alerta de muestra pequeña aparece en
  una partida recién empezada (0 partidos contra cualquier rival), la
  tabla de play-types y la sección de Familiaridad corregida ("más
  usadas") se renderizan, sin errores de consola relevantes (único error
  de red esperable en este entorno: la Google Font externa de
  `index.html`, sin salida a fonts.googleapis.com, nada que ver con esta
  entrega, igual que en Playwright de TAC-5/TAC-6).
- **`git diff --stat`** (7 archivos, confirmado con el comando real):
  `DESIGN.md`, `CHANGELOG.md`, `src/core/MatchConfig.js`, `src/core/
  MatchEngine.js`, `src/core/Tactics.js`, `src/ui/game.css`, `src/ui/
  game.js`. Ninguno de `Rotation.js`/`Recovery.js`/`Calendar.js`/
  `Player.js`/`League.js`/`Bracket.js`/`Cup.js`/`Playoffs.js`/
  `Promotion.js`/`CpuLineup.js`/`SeasonGoals.js`/`Team.js` (la lista
  vetada del prompt de esta sesión) aparece en el diff — la Construcción
  de identidad CPU encontró un punto de enganche limpio dentro de
  `game.js` (`startSeason()`, ya construye los equipos de cada división
  ahí mismo, y ya asigna `team.tacticalProfile` — que es un campo mutable
  público de `Team`, no algo que exigiera cambiar el constructor de
  `Team.js`) sin necesitar tocar ninguno de los archivos vetados, tal
  como permitía el prompt si se encontraba uno.

### Resumen final de la EPIC completa (TAC-1 a TAC-7)

Para que una futura sesión de diseño no tenga que releer los 7 CHANGELOG
completos:

- **TAC-1** — Núcleo táctico de posesión: `PossessionPlan`/`DefensivePlan`/
  `AdvantageState` (3 ramas) y primera integración real de Pick & Roll con
  varias coberturas (Drop/Under/Switch/Hedge/Blitz).
- **TAC-2** — Identidad + spacing + roles: `TacticalProfile` completo
  (spacing, ejes de identidad, pesos de play-type), `effectiveSpacing()`,
  catálogo de roles ofensivos/defensivos + `roleFit()`, primeras
  valoraciones derivadas de quinteto.
- **TAC-3** — Playbook + generación real de oportunidades: 9 familias de
  `PlayDefinition`, `AdvantageState` de 6 categorías con continuidad/
  counters, asistencia causal, Isolation/Post Up con motor real.
- **TAC-4** — Defensa avanzada: zonas (2-3/3-2/1-3-1), press, doble equipo
  de poste, matchups individuales, transición defensiva, Switchability/
  Rim Protection/Transition Defense.
- **TAC-5** — Partido vivo y situaciones: motor de simulación pausable
  (`createMatchState`/`advanceMatch`), `GamePlan` de partido, tiempos
  muertos reales, ATO/BLOB/SLOB/Late Clock/Last Possession, falta táctica
  intencionada.
- **TAC-6** — Familiaridad Táctica: `TacticalProfile.familiarity`,
  `tacticalExecution` (familiaridad+atributos+energía+experiencia+
  complejidad), eje Rigidez↔Read&React, 3 errores reconocibles con
  mecanismo real.
- **TAC-7** — Data Hub y scouting táctico: telemetría por posesión +
  agregado persistente por equipo, derivadas con tamaño de muestra,
  informe de rival, identidad automática de equipos CPU (alcance acotado
  de 7.12.25), cierre de las 3 valoraciones de quinteto pendientes
  (7.12.28).

### Pendiente explícitamente para sesiones futuras (ver también DESIGN.md 7.12.34)

- Plan de partido CPU basado en scouting real y Ajustes en vivo CPU con
  anti-sobrerreacción/histéresis/inercia táctica (7.12.25, resto de la IA
  táctica CPU) — nota de visión futura añadida en `DESIGN.md` 7.12.25,
  requieren su propia sesión de diseño/calibración.
- `playerTendencies` (7.12.26) — arquitectura futura fuera de esta EPIC.
- Sistema real de visibilidad limitada por Scouting (6.2.2 punto 5) —
  solo el gancho estructural queda dejado en esta entrega.
- Resto del catálogo de métricas de 7.12.27 no implementadas esta entrega
  (ver sección 3 arriba) y calibración cuantitativa final de
  `config.tactics.telemetry`/`cpuIdentity` contra datos reales tras
  simulación masiva (7.12.31) — esta entrega solo verifica DIRECCIÓN.
