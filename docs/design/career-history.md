# Ficha universal, carrera e histórico (LIFE-4)

_Migrado de `DESIGN.md` (líneas 5076-5249 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.15 LIFE-4 — Ficha universal, carrera, histórico e hitos

> Desviación de numeración señalada explícitamente (sección 84 del
> prompt de esta sesión): el prompt pedía "9.4", pero esa subsección ya
> existía (Atributos mutables, LIFE-1) — sigue la numeración secuencial
> real de HEAD, igual que LIFE-2/LIFE-3 ocuparon 9.13/9.14.

Módulo nuevo (`src/core/PlayerCareer.js`), responsable ÚNICO de
persistencia histórica de carrera + cálculos puros derivados (totales,
tendencias, hitos, récords, honores). No modifica atributos
(`PlayerDevelopment.js` sigue siendo la única fuente de TMB/crecimiento),
no calcula lesiones (`Medical.js` sigue siendo la única fuente médica),
no resuelve partidos, no decide roles tácticos (`Tactics.js`) y no
escribe `newsLog` directamente — `Events.js` sigue construyendo noticias,
`src/ui/game.js` decide cuándo llamarlo a partir de los hitos que este
módulo detecta.

**No inventar pasado**: `player.careerHistory.historyCompleteness` es
`'partial'` (jugadores reales ya existentes al arrancar la partida — su
primer partido simulado NO es su debut profesional, la UI lo rotula
"Registrado en esta partida") o `'complete'` (jugadores creados DENTRO de
la partida — cantera nueva vía `Team.generateAcademyIntake()`, con
debut/hitos/récords de carrera reales). Nunca se retrocede la fecha de
inicio de histórico (`historyStartDate`) a `birthDate`.

**`careerHistory`** (separado de `dynamicState`/`developmentState`/
`medicalState`, en `Player.js`): `version`, `historyCompleteness`,
`historyStartDate`, `baseline` (snapshot inicial: fecha, `seasonKey`,
TMB, atributos, posiciones), `currentSeason` (temporada en curso:
`stats`, `teamStints`, `honours`, dedupe de partidos ya sumados),
`seasons` (array de temporadas cerradas), `milestones`, `personalBests`.
Sobrevive `toJSON()`/reconstrucción igual que `developmentState`/
`medicalState`; legacy sin `careerHistory` se inicializa vía
`ensureCareerHistory()` sin inventar pasado (baseline en la fecha real
de esa llamada).

**Histórico compacto — sin snapshots semanales**: solo baseline + un
snapshot final por temporada (`closeSeason()`), nunca por partido ni por
tick de entrenamiento. Los 29 atributos mutables (mismas listas de
LIFE-1, `PlayerCareer.ATTRIBUTE_SNAPSHOT_KEYS`), las 5 posiciones
(`POSITION_SNAPSHOT_KEYS`) y 20 campos estadísticos acumulados
(`STAT_SNAPSHOT_KEYS`: partidos, titularidades factuales, segundos,
puntos, rebotes of./def., asistencias, robos, tapones, pérdidas, faltas
cometidas/recibidas, valoración, +/-, tiros de 2/3/libres hechos-
intentados) se persisten como **arrays de orden fijo**, nunca objetos
con claves repetidas ni porcentajes (se calculan sobre los acumulados,
nunca al revés) ni rebotes totales duplicados (se derivan de
ofensivos+defensivos vía `totalReboundsOf()`). TMB histórico siempre
sale de `PlayerDevelopment.computeTmbRating()` en el instante del
snapshot — nunca una fuente viva persistida, el TMB actual se recalcula
siempre al leer.

**Titularidad factual**: `Rotation.buildRotationState()` fotografía el
quinteto inicial real (slot "starter" de cada fila, ya disponible
médicamente) en `state.starterIds`, expuesto por
`MatchEngine.rotationSummary()` — nunca se infiere titularidad por
minutos jugados. No cambia selección/sustitución.

**Acumulación por partido** (`PlayerCareer.recordResolvedMatch()`),
llamada desde el ÚNICO punto de post-procesado común que ya existía
(`applyRecoveryForResolvedMatch()` en `game.js`, junto a
`recordMatchExposure`/`addExperience`) — cubre liga, Copa, Playoff por
el título y Playoff de ascenso, usuario y CPU, división visible y de
fondo, sin duplicar hooks. Dedupe por `matchKey` (el `gameId`
determinista de `MatchEngine`) evita sumar dos veces el mismo partido.
`teamStints` (varios equipos en la misma temporada, preparado para un
futuro mercado sin implementarlo) se acumula en paralelo al total de
temporada.

**Hitos y récords — solo para historia completa**: debut, primera
titularidad real, umbrales de partidos (50/100/250/500) y minutos
(1.000/5.000/10.000) — cada uno como mucho una vez (IDs estables).
Récords personales (puntos, rebotes totales, asistencias, tapones,
robos, valoración) se registran para CUALQUIER histórico (`partial`
etiquetado "Mejor registro en esta partida", `complete` "Récord personal
de carrera"), pero solo se convierten en milestone/candidato a noticia
al superar un mínimo (20 pts/10 reb/8 ast/4 tap/4 rob/20 val) — el
primer partido de un jugador nunca genera 6 hitos de golpe.

**Honores** (`registerHonour()`, idempotente): campeón de Copa/Playoff
por el título/liga regular de 2ª, ascenso directo/vía playoff — hechos
reales ya calculados por `League.js`/`Bracket.js`/`Promotion.js`, nunca
recalculados aquí, registrados al roster real en el momento del cierre.
Un honor de equipo NUNCA genera una noticia por cada jugador
(invariante "honor != noticia individual") — solo queda en la ficha.

**Cierre de temporada** (`closeSeasonAndPrepareNext()` en `game.js`):
división/equipo capturados ANTES de aplicar ascensos/descensos (un
ascendido cierra con la división en la que jugó), snapshot final
(TMB/atributos/posiciones/`nominalPosition`/roles vía
`Tactics.roleAssignments`+`familiarity.byPlayerRole`, nunca
recalculados), honores, reinicio de `currentSeason` — todo ANTES de la
cantera nueva (que arranca con histórico `complete` desde
`seasonEndDateTime`, nunca con temporadas anteriores vacías).
`seasonKey` sigue el formato real `"2026-27"` (`seasonKeyFromStartYear`),
nunca "Temporada 1".

**Noticias de carrera cierran el hueco de CAL-2**: `Events.js` añade
`newsCategory:'career'` y dos builders puros
(`buildCareerMilestoneNewsEvent`/`buildPersonalBestNewsEvent`) — solo
para el equipo del usuario (evita "fluff" de los otros 35 clubes).
`complete`: debut/100/250/500 partidos generan noticia (prioridad
media/media/alta/alta); 50 partidos y los umbrales de minutos quedan en
el timeline pero nunca generan noticia; un récord significativo genera
noticia de prioridad media. `partial`: nunca "debut" ni "X partidos de
carrera" — solo "mejor actuación registrada en esta partida" con un
umbral propio más estricto (30 pts/15 reb/12 ast/30 val). La
deduplicación de noticia queda garantizada por la deduplicación de
milestone en `PlayerCareer.js` (IDs estables) — `game.js` solo construye
noticia para los milestones NUEVOS que `recordResolvedMatch()` devuelve.

**Ficha universal de jugador** (`player-profile`, pantalla CONTEXTUAL sin
botón propio en `#gm-nav`): `openPlayerProfile(playerId, returnContext)` /
`closePlayerProfile()`, con 7 sub-pestañas (Resumen, Atributos, Posiciones
y roles, Desarrollo, Estadísticas, Médico, Carrera). TMB visible en la
ficha (1-200, con el mismo tooltip ya existente: "TMB mide la capacidad
actual del jugador..., no es su potencial"); Potencial/`learningRate`/
`learningPersistence`/Profesionalidad/Ambición/`agingOffsetYears`/seeds/
residuales NUNCA se muestran. Gráficos de evolución (TMB por temporada,
atributo seleccionado) en SVG/CSS puro, sin librerías externas, siempre
con tabla accesible debajo. Pestaña Médico lee `medicalState` directamente
(nunca copiado a `careerHistory`). `findPlayerById()` resuelve la
instancia viva desde el **Player Registry mundial** de la partida
(`state.playerRegistry`, ROSTER-1 — ver 9.16), **corrección de
BUG-LIFE4-03**: la versión original de esta entrega recorría los 36
equipos actuales como si fuera un directorio global, lo que dejaba de
funcionar en el instante en que un jugador quedara sin club (todavía
imposible en ROSTER-1; MARKET-1, ya hecha, lo hace posible para el pool de
libres ficticios del bootstrap — ver 9.19 —, y TRANSFER-1 lo hará posible
también para un jugador que SALE de una plantilla existente). El
equipo actual se resuelve aparte por `player.teamId` contra los equipos
vivos — `null` si no tiene club, y la ficha lo refleja como "Sin club"
en la cabecera sin inventar equipo/división; roles/entrenamiento
degradan a "Sin rol de club actual"/"No disponible sin club";
estadísticas, desarrollo y carrera siguen visibles (no dependen del
club). Nombre clicable (`playerLinkHtml()`/`playerLinkHtmlById()`,
botón semántico accesible) desde Alineación, Entrenamiento, Tácticas
(pestaña Roles), Estadísticas, Lesiones, box score y Noticias — abrir la
ficha o cambiar de pestaña NUNCA avanza el calendario ni procesa
Training/Medical/Development/roles/alineación. Volver preserva el estado
de la pantalla de origen porque ese estado ya es duradero por sí mismo
(`state.statsSortKey`, `team.trainingPlan`, `container.dataset.activeTab`
de Tácticas/Competiciones...) — `openPlayerProfile()` solo necesita
recordar `returnScreen`.

**Corrección de BUG-LIFE4-01**: el histórico médico, el timeline de
carrera (hitos/honores) y la fecha de inicio de histórico (`partial`)
reutilizaban por error `formatMatchTime()` (formateador de HORA de
partido, `HH:mm`) para mostrar FECHAS de carrera — el resultado visible
era una hora ("18:30") donde hacía falta una fecha. `formatHistoryDate()`
(nuevo, día/mes/año) es ahora el formateador único para estas tres
categorías de fecha histórica; `formatMatchTime()` sigue siendo solo para
horarios de partido.

**Tamaño observado**: `scripts/test-life4.js` mide ~640 bytes/temporada
para un jugador con estadísticas constantes; `scripts/smoke-life4.js`
(36 equipos/738 jugadores tras 3 temporadas reales con partidos/hitos/
honores de verdad) mide ~2,8 MB acumulados, con una proyección lineal a
20 temporadas de ~18 MB — por encima del objetivo orientativo de 2,5 MB
de la sección 55 del prompt de esta sesión (desviación señalada
explícitamente, no silenciosa: ya se aplican arrays de orden fijo, cero
duplicación de totales/porcentajes/snapshots intermedios y deduplicación
de milestones — el resto del margen lo consume `milestones`/
`personalBests` acumulados a lo largo de muchas temporadas reales; queda
como optimización pendiente para una sesión futura si Dennis lo pide).

**Fuera de alcance de LIFE-4** (ver sección 77 del prompt de esta
sesión): scouting/PA estimado, mercado/contratos/agentes, Staff
contratable real, retiros, premios individuales/Hall of Fame,
comparación de jugadores, editor de histórico, fotos, nuevas reglas de
TMB/progresión/médicas/roles, decay de POS/táctica por no uso,
fama/popularidad. **Con LIFE-4, STEP 3 — PLAYER LIFE queda cerrado**
(LIFE-1 + LIFE-2 + LIFE-3 + LIFE-4).
