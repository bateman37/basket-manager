# Ficha de Epic — LIFE-2 (entrenamiento y desarrollo dirigido)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `LIFE-2`
- **Estado**: cerrada (histórica)
- **Objetivo**: Entrenamiento, desarrollo dirigido y aprendizaje táctico/posicional.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/training.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 3408-3818 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-23

### LIFE-2 — Entrenamiento, desarrollo dirigido y aprendizaje táctico/posicional

Segunda entrega de STEP 3 — PLAYER LIFE (DESIGN.md 9.13, montada encima de
LIFE-1/POS/TAC-6 ya mergeadas). Arquitectura: `src/core/Training.js`
(nuevo) construye el estímulo de entrenamiento y los sistemas de posición/
rol/Energy; `src/core/TrainingAI.js` (nuevo) es la única fuente de
heurísticas CPU; `CONFIG_BASE.training` (`MatchConfig.js`) todos los
coeficientes; `PlayerDevelopment.js` sigue siendo la única fuente de
reglas de crecimiento de atributos/TMB/PA.

#### Corrección de partida (sección 0 del prompt de esta sesión)

`staffContext`/`stimulusByAttribute` NO existían en LIFE-1 pese a que el
prompt original los daba por hechos — verificado contra HEAD real. Se
construyen aquí, dentro de `PlayerDevelopment.js` (no en `Training.js`,
que sigue sin tocar atributos 1-20 directamente):

- `processOneTick()` acepta un `context.stimulusByAttribute` opcional
  (mapa atributo → multiplicador, 1.00 = neutro/ausente) que se multiplica
  ENCIMA del `growthDelta` ya existente — nunca sustituye edad/PA/
  headroom/ruido, y nunca toca `declineDelta`.
- `processPlayerToDate()` admite `context` como función `(tickDate) =>
  context` además del objeto plano de siempre (compatibilidad total con
  llamadores existentes) — necesario porque Training recalcula densidad
  competitiva/estímulo POR SEMANA, no una vez por llamada.
- `staffRatingToFactor()` (nuevo, exportado): reutiliza el MISMO mapping
  1-20→factor de `computeFacilityFactor` (extraído a `mapLevelToFactor`
  compartida) — `config.training.staffContext` (rating 10 = neutro
  mientras no exista Staff real) es un mecanismo NUEVO y separado de
  `playerDevelopment.staffFactor` (LIFE-1, intacto), usado solo por
  posición/rol, nunca por el crecimiento general de atributos.

#### Plan de entrenamiento (`Team.trainingPlan`/`trainingState`)

- `trainingPlan`: `teamFocus` (Balanced/Offense/Defense/Physical/
  Tactical), `intensity` (Recovery/Light/Normal/High), `individualFocuses`
  (como mucho un foco por jugador). Fallback legacy a Balanced/Normal/sin
  focos en el constructor de `Team.js`, sin reescribir JSON reales.
- `trainingState`: `lastProcessedDate`, `planSegments` (podados al
  consumirse), `recentTeamMatchDates`, `nextCpuCollectiveReviewDate`/
  `nextCpuIndividualReviewDate`. Serializado completo en `Team.toJSON()`.
  `removePlayer()` limpia el foco huérfano del jugador que sale.
- `Training.setPlan`/`setTeamFocus`/`setIntensity`/`setIndividualFocus`:
  SIEMPRE procesan el desarrollo pendiente con el plan ANTERIOR
  (`processTeamDevelopmentToDate`) antes de aplicar el cambio y registrar
  el nuevo segmento — cambiar de plan nunca reescribe semanas pasadas.

#### Densidad competitiva, intensidad y Energy

- `matchDensity` (0-4+ partidos/semana → `opportunityFactor`/`loadUnits`)
  y `intensity` (developmentMultiplier/recoveryMultiplier/
  energyCostPerLoadUnit/tacticalMultiplier) tal cual las cifras del
  prompt, en `CONFIG_BASE.training`.
- Coste de Energy semanal (`loadUnits × energyCostPerLoadUnit` + extra por
  foco individual) aplicado por `Training.buildPlayerTickContext()` como
  efecto lateral de cada tick de atributos — mismo tick que produce el
  estímulo, así el readiness de la semana siguiente ya refleja el coste.
- `readinessFactorByEnergy` modula el estímulo POSITIVO según Energy
  actual (nunca el declive).

#### Corrección de orden temporal real (sección 9 del prompt)

Bug detectado en el código YA existente (no introducido por esta sesión):
`Recovery.applyRestRecovery` se invocaba DESPUÉS de simular cada partido,
así que el partido consumía la Energía sin recuperar del hueco de
descanso anterior. `Training.prepareTeamForMatch()` (nuevo, llamado desde
`buildMatchOptionsResolver()` en `game.js`, para AMBOS lados de CUALQUIER
partido — liga visible, liga de fondo, brackets, usuario y CPU) resuelve
recuperación → estímulo → PlayerDevelopment → progreso POS/táctico ANTES
de construir squad/lineup y simular. Se avanza `lastMatchDate` (y se
aplica recuperación) para la plantilla COMPLETA en cada partido del
equipo, no solo quien acabe jugando minutos — evita el doble cómputo que
existiría si el "reloj de descanso" de un jugador se quedara parado hasta
su siguiente aparición real (test dirigido en `scripts/smoke-life2.js`).
`applyRecoveryForResolvedMatch()` (game.js) queda solo con lo que depende
del resultado ya simulado: exposición competitiva y Experience.

Para partidos de bracket (`Bracket.Series.playNextGame`, sin tocar) no
hay fecha exacta disponible antes de simular — se usa el reloj de mundo
actual como referencia (aproximación razonable, partidos de una Series
separados solo unos días), documentado explícitamente en `game.js`.

#### Presupuesto neutral de Team Focus (sección 11)

`Training.computeTeamFocusStimulusVector()`: Balanced deja el vector en
1.00 uniforme; Offense/Defense/Physical usan un vector bruto
(`CONFIG_BASE.training.teamFocusVectors`) normalizado contra el
presupuesto TMB del jugador (`PlayerDevelopment.getPositionWeights`) para
que la media ponderada vuelva a 1.00 — cambian QUÉ mejora, no cuánto se
crea en total. Tactical es la excepción deliberada (sección 12): usa
`attributeBase` por categoría de curva, sin normalizar (queda por debajo
de 1.00 a propósito).

#### Foco individual único

- **Atributo**: `applyAttributeFocusRedistribution()` — concentra ×1.35 en
  el target, reduce el resto proporcionalmente para conservar el mismo
  presupuesto ponderado total (sección 15).
- **Posición**: `player.developmentState.positionProgress` (residual
  nuevo, independiente de `attributeProgress`, mismo patrón de cruce de
  entero que `applyResidualDelta`). Headroom `sqrt((20-nivel)/19)`, edad/
  mindset reutilizados de `PlayerDevelopment.computeLearningFactor` +
  curva `cognitive` (nunca reimplementados), entorno de coaching
  (Training Center + `staffContext`, pesos 40/40/20 adultos ó
  35/30/15/20 <21 años), `matchRepFactor` que acelera con minutos REALES
  en la posición entrenada. `nominalPosition` nunca cambia automáticamente;
  posición nunca consume PA/TMB; desvía ×0.92 del desarrollo general.
- **Rol**: entrena `profile.familiarity.byPlayerRole` (TAC-6 real, mismo
  init 35/reset 15 que el camino de partido — `growPlayerRoleFamiliarityFromTraining()`
  replica ese bookkeeping exacto), ×1.75 sobre la ganancia de ESE rol,
  nunca toca `roleFit`. Desvía ×0.94 del desarrollo general.

#### Minutos reales por posición (`Rotation.js`/`MatchEngine.js`)

`Rotation.accumulatePlayedTime()` ahora también acumula
`positionSeconds` (playerId → {posición: segundos}), expuesto en
`MatchEngine.rotationSummary()` como `positionSecondsByPlayer`. Solo
tracking factual — ninguna regla de sustitución/penalización POS se tocó.
`PlayerDevelopment.recordMatchExposure()` acepta un `positionMinutes`
opcional en el mismo registro de `matchExposures` (nunca una estructura
paralela).

#### Entrenamiento táctico colectivo/individual

`Training.applyWeeklyTacticalTraining()` (tick semanal a nivel de
equipo, separado de los ticks de atributo por jugador): alimenta
`offensiveSystem`/`byPlayFamily` según las familias con peso real en
`playTypeWeights`, `defensiveSystem`/`byCoverage` según la cobertura de
P&R activa, y `byPlayerRole` de los roles actualmente asignados —
siempre vía `Tactics.growFamiliarityValue` (reutilizado tal cual, nunca
una familiaridad paralela). Ritmo semanal propio
(`CONFIG_BASE.training.tactical`, separado de
`CONFIG_BASE.tactics.familiarity`, que sigue rigiendo el aprendizaje por
posesión jugando partidos — ambas fuentes conviven). Complejidad de
jugada/cobertura ralentiza el aprendizaje (factor 1.00-0.65); no se tocó
`computeTacticalExecution` ni ninguna fórmula de partido.

#### Offseason

Intensidad efectiva forzada a Normal y sin coste de Energy de
entrenamiento cuando el tick cae antes de `Calendar.seasonStartDate` de
la temporada vigente (detectado comparando fechas, sin ningún campo nuevo
de "pretemporada"); familiaridad táctica y progreso posicional/de rol
siguen avanzando con multiplicador reducido (0.60). **Desviación real
frente al prompt**: LIFE-1 no dejó ningún `offseasonLearningMultiplier`
que "conservar" (verificado contra HEAD, mismo tipo de hallazgo que
`staffContext`/`stimulusByAttribute`) — no se inventó ese multiplicador
para el crecimiento general de atributos, que sigue sin ningún ajuste de
temporada baja (nunca lo tuvo en LIFE-1).

#### IA de entrenamiento CPU (`TrainingAI.js`)

Revisión colectiva cada 28 días (Energy baja de los 10 con más minutos →
Recovery; 2+ partidos en 7 días → Light + Tactical/Balanced; familiaridad
táctica media baja → Tactical/Normal; plantilla joven con headroom amplio
→ Balanced/High si el calendario y la Energy lo permiten; si no, el
enfoque que cubre la debilidad relativa del roster) y focos individuales
cada 56 (atributo relevante bajo el propio perfil por defecto; posición
solo con cobertura pobre + competencia real ≥8; rol solo con familiarity
claramente por debajo de la media del equipo), más revisión defensiva si
un foco deja de ser válido. Nunca se llama para el equipo del usuario
(game.js filtra explícitamente en `reviewCpuTrainingForAllTeams()`).

#### UI — pantalla "Entrenamiento" (`game.js`/`game.css`/`index.html`)

Nueva pantalla (capa de presentación pura sobre `Training.js`, sin
ninguna regla propia): plan colectivo con guardado explícito
("Guardar plan"), próximo microciclo (margen/carga vía
`Training.describeMicrocycle`, alertas de Energy <70 al próximo partido
vía `Training.projectEnergyToDate`, puro) y focos individuales por
jugador (tipo + objetivo agrupado Técnico/Físico/Mental o Ataque/
Defensa, aplicados de inmediato al cambiar cada select). TMB no se
muestra (LIFE-1 ya lo mantiene interno). Tabla de focos envuelta en
`.gm-table-scroll` (mismo patrón que Estadísticas) tras detectar
desbordamiento horizontal real en móvil con Playwright.

#### Modo prueba (`index.html`)

Nueva sección "LIFE-2": comparativa de los 12 escenarios pedidos (enfoque
×5, Balanced/High, Balanced/Recovery, foco de atributo, posición sin/con
minutos reales, foco de rol, densidad 0/1/2/3 partidos/semana), con un
único jugador base compartido entre las 12 ramas (seed controlada real —
bug corregido durante esta sesión: la primera versión regeneraba un
jugador random dentro de cada rama, produciendo comparaciones sucias y,
en el caso de foco posicional, una mezcla de posición objetivo/jugador
base que en un caso llegó a mostrar un salto de nivel irreal).

#### Calibración observada

- Balanced/Normal vs baseline LIFE-1 (sin Training): delta TMB medio de
  temporada +10.3% sobre 36 equipos reales/414 jugadores — al límite del
  objetivo de la sección 41 ("no debe aumentar >10%"), no perfectamente
  dentro. Causa identificada: el calendario real (CAL-1) intercala
  jornadas "midweek" con separación irregular (3-11 días), así que la
  ventana de densidad de 7 días no siempre coincide 1:1 con "un partido
  por semana" — algunas semanas cuentan 0 partidos (`opportunityFactor`
  1.10) sin que la semana siguiente lo compense exactamente. Los números
  de `matchDensity` son los del prompt tal cual; no se ha tocado esta
  tabla para forzar el objetivo exacto.
- Offense/Defense/Physical: atributos del foco crecen claramente más que
  Balanced, TMB agregado similar (comparativa LIFE-2 del modo prueba).
- Posición con minutos reales: ~+1 punto de competencia en 8 semanas de
  foco continuo con minutos reales en el target (perfil medio, intensidad
  Normal) — dentro del orden de magnitud de la sección 41 (+1 a +2.5 por
  temporada completa de 34 semanas).
- Rol con foco individual: 35→~97/100 de familiaridad en una temporada
  completa (34 semanas) con ×1.75 sostenido — acelera claramente frente a
  sin foco, sin alcanzar el techo en pocas semanas.

#### Tests

- `scripts/smoke-life2.js` (nuevo): construye los 36 equipos/414
  jugadores reales, ejercita `Training.prepareTeamForMatch`/
  `TrainingAI.reviewTeamIfDue` en el mismo camino que `game.js`
  (`buildMatchOptionsResolver`) durante 34 jornadas en ambas divisiones,
  con planes/focos no-default en varios equipos (offense+atributo,
  tactical+rol, physical+posición) — verifica rangos de Energy/TMB/
  atributos/posiciones/familiaridad y que los focos activos realmente
  progresan. Sin excepciones.
- Verificación manual con Playwright `file://` (headless Chromium,
  desktop + viewport móvil): flujo completo Selección de equipo →
  Entrenamiento (cambiar plan/guardar, cambiar foco individual por
  jugador, los 3 tipos con sus catálogos de objetivo) → 8 jornadas reales
  jugadas de principio a fin (motor pausable incluido) → pantalla de
  Entrenamiento sigue coherente después. Consola limpia salvo el bloqueo
  de red preexistente de Google Fonts (no relacionado). Overflow
  horizontal detectado y corregido en móvil (tabla de focos).

#### Fuera de alcance de esta entrega (queda para LIFE-3/4)

Lesiones, `injuryProneness`, historial médico, riesgo de lesión por
carga, Staff como entidades reales/contratables, decaimiento de
posiciones o de familiaridad táctica por no uso, familiaridad de
quinteto, entrenamiento diario editable, cambio automático de
`nominalPosition`. No se ha tocado ninguna fórmula de partido de
MatchEngine/Tactics (`tacticalExecution`)/POS/Rotation (sustitución)/
League/Bracket/Cup/Playoffs/Promotion/Calendar/CpuLineup.

### LIFE-1 — Carrera, TMB, Potencial, desarrollo y declive

Primera entrega de STEP 3 — PLAYER LIFE (DESIGN.md sección 9, sustituye el
placeholder anterior). Arquitectura: `Player.js` guarda datos/estado,
`src/core/PlayerDevelopment.js` (nuevo) concentra TODAS las reglas,
`CONFIG_BASE.playerDevelopment` (`MatchConfig.js`) los coeficientes/curvas,
`game.js` solo orquesta desde los dos puntos de integración ya existentes.

#### TMB Rating y Potencial (escala 1-200)

- `TMB Rating` nuevo: capacidad actual, media ponderada de los 29
  atributos mutables según relevancia posicional (deltas normalizados de
  `POSITION_PROFILES`, rango global de deltas — mismo peso para el mismo
  delta en cualquier posición). No sustituye a los atributos 1-20 ni entra
  en MatchEngine/Tactics/Rotation; se calcula bajo demanda
  (`computeTmbRating`), nunca se persiste.
- `hidden.potential` migra de 1-20 a 1-200 (`×10` si `<=20`, idempotente).
  **Punto de intercepción resuelto** (bloqueante señalado en el prompt):
  se sacó `potential` de la lista genérica `HIDDEN_ATTRIBUTES` de
  `Player.js`, que aplica `clampAttribute()` (1-20) dentro del propio
  constructor — de haberse dejado ahí, cualquier valor migrado a escala
  nueva se habría recortado a 20 antes de que la migración pudiera actuar.
  `potential` ahora se construye aparte con su propio clamp 1-200
  (`migratePotentialRaw`, sin dependencia de PlayerDevelopment.js para
  evitar un ciclo de `require`); el suelo "PA nunca por debajo del TMB
  actual" (invariante 13) lo refuerza `PlayerDevelopment.ensureDevelopmentState()`
  en cada punto de integración, no el constructor de `Player`.
- PA 200 no obliga a ningún atributo a 20 — puede convivir con atributos
  claramente inferiores en zonas poco relevantes para la posición.

#### Nuevos ocultos y precisión interna

- `hidden.learningRate`/`hidden.learningPersistence` (1-20, nuevos):
  velocidad y persistencia de aprendizaje, independientes de PA/
  Profesionalidad/Ambición. Viven fuera de `HIDDEN_ATTRIBUTES` genérico
  por un motivo distinto a `potential`: necesitan generarse con el
  `developmentSeed` del jugador (no un valor fijo por defecto), así que
  `Player.js` los deja en `null` y `PlayerDevelopment.ensureDevelopmentState()`
  los genera una sola vez y los persiste.
- `player.developmentState.attributeProgress`: residual decimal por
  atributo mutable (`efectivo = visible + residual`); legacy se
  inicializa determinista en `±0.45` a partir del seed, nunca en 0 plano.
- `player.developmentState` (nuevo, separado de `dynamicState` de
  partido): `developmentSeed`, `lastProcessedDate`, `attributeProgress`,
  `matchExposures`, `agingOffsetYears`. Serializado completo en
  `toJSON()`.

#### Curvas, mindset y longevidad

- 6 categorías de atributo (explosive/strength/endurance/technical/
  cognitive/social), cada una con curva de aprendizaje positivo y curva de
  declive independientes (puntos `[edad, factor]`, CONFIG, sin cliff).
  Declive y crecimiento del MISMO tick se resuelven en ese orden (declive
  → recalcular headroom → crecimiento limitado por PA).
- `agingOffsetYears` (nuevo, -3 a +6 años): longevidad individual
  determinista, independiente de PA/learningRate/learningPersistence/
  Profesionalidad/Ambición — desplaza `effectiveDeclineAge`, nunca cambia
  la forma de la curva.
- `mindsetFactor` = media 50/50 de Profesionalidad/Ambición (mapeo lineal
  1-20 → [0.75, 1.25] cada una, cifras dadas por el prompt);
  `learningRateFactor` usa el MISMO mapeo lineal por consistencia (el
  prompt no daba cifras propias para él — decisión de calibración de esta
  sesión, en `CONFIG_BASE.playerDevelopment.mindset`).
  `learningPersistence` amortigua (hasta un 40%) el declive de
  technical/cognitive/social exclusivamente, nunca explosive/strength/
  endurance ni el crecimiento.

#### Minutos, instalaciones y hook de Staff

- `matchExposures` (`{date, minutes, competition, division}`) se alimenta
  desde `applyRecoveryForResolvedMatch()` (game.js) — el punto de
  post-procesado ya compartido por las 4 competiciones y las 36
  plantillas, sin crear un segundo hook. `minutes = round(playedSeconds/60)`.
  `competition` usa los valores reales del código (`'league'` por defecto,
  `'cup'`, `'playoff'`, `'promotion'`); `drainBackgroundBrackets()` se
  actualizó para saber cuál de los 3 brackets está resolviendo (antes los
  recorría sin distinguirlos).
- `exposureFactor`: raíz cuadrada de los minutos semanales recientes
  (ventana de 30 días) ponderados por división (1ª ×1.0, 2ª ×0.7) —
  salto claro 0→12-15min, se aplana después sin tope duro. Exposiciones
  fuera de ventana se descartan.
- `facilityFactor` reutiliza `team.facilities.trainingCenter` (ya
  existente, sin campo nuevo en `Team.js`); efecto moderado (0.9-1.1).
  `staffFactor` fijo en 1.0, hook explícito para un futuro Staff.

#### Integración temporal (`game.js`)

- Nuevo `advanceGameClockTo(date)`: único punto que llama a
  `Calendar.advanceTo()` en todo el archivo (sustituye 6 llamadas
  directas) — dispara `PlayerDevelopment.processTeamToDate()` sobre las 36
  plantillas cada vez que el reloj de mundo avanza, sin crear un segundo
  reloj. Barato en el caso común (no-op hasta que se acumula un tick de 7
  días completo por jugador).
- `closeSeasonAndPrepareNext()`: procesa el desarrollo de los 36 equipos
  hasta `seasonEndDateTime` justo ANTES de `generateAcademyIntake()` (que
  ahora recibe esa misma fecha) — un canterano nuevo no recibe progreso
  retroactivo.
- `buildRealTeamFromData()`: migra/inicializa `developmentState` de cada
  jugador real reconstruido desde el bundle (mismo punto donde ya se
  asigna `dataSource`).
- `Experience` (sección 28 del prompt): `addExperience()` no tenía ningún
  llamador real en el código — se conecta desde el mismo punto que
  `matchExposures` (+1 por partido con minutos jugados). Conexión menor,
  no una fórmula nueva de progresión de experiencia.

#### Generador ficticio (`playerGenerator.js`)

- Jugadores nuevos reciben `hidden.potential` ya en 1-200 (ruido más
  amplio que Profesionalidad/Ambición para cubrir bien el rango) y
  `developmentState` completo, inicializado llamando a
  `PlayerDevelopment.ensureDevelopmentState()` justo tras construir el
  `Player` — reutiliza la misma función que migra jugadores reales
  legacy, sin duplicar lógica de generación de learningRate/
  learningPersistence/agingOffsetYears/residuales. El suelo "potential >=
  TMB inicial" (sección 25) sale gratis de esa misma llamada.
- `Team.generateAcademyIntake(count, referenceDate)`: nuevo segundo
  parámetro opcional, reenviado a `generateFictionalPlayer()` — permite a
  `closeSeasonAndPrepareNext()` pasar la fecha real de cierre en vez del
  reloj de la máquina.

#### Modo prueba (`index.html`)

Nueva sección "LIFE-1 — Carrera, TMB y Potencial" (herramienta de
depuración, no pantalla de producto): inspeccionar TMB/Potencial/ocultos
de un jugador ficticio nuevo, avanzar 10 ticks sobre él con resumen de
cambios tick a tick, y un test dirigido visual (mismo jugador base
clonado en 4 escenarios de 16 años/0-12-40 min/1ª-2ª, invariantes 30-32).

#### Calibración observada

- `baseGrowthRate=0.075`, `baseDeclineRate=0.09` (subido desde 0.055 tras
  detectar por script que, sin la subida, un veterano de 38 años con
  potencial casi agotado podía seguir mostrando TMB agregado ligerísimamente
  al alza — el crecimiento residual de technical/cognitive/social a esa
  edad superaba al declive físico; contradecía la sección 30
  ("38+: declive agregado claro en la mayoría")).
- Cohorte sintética de 40 jugadores (17-26 años, minutos aleatorios
  10-35/semana, 12 temporadas): TMB final min~100/media~150-160/max=200,
  con solo un 15-30% en zona élite (>=180) — no deriva sistemáticamente
  hacia 180-200 (invariante 39).
- Test dirigido (16 años, 8 semanas sostenidas): 0min < 12min-2ª <
  12min-1ª < 40min-1ª, con 40min por debajo del doble de 12-15min
  (invariantes 30-32).

#### Tests

- `scripts/test-life1.js` (nuevo, sin framework — mismo criterio ad-hoc
  que el resto del proyecto): 22 comprobaciones cubriendo escala/clamps,
  migración+idempotencia, headroom, declive-en-PA, continuidad de edad,
  campos no tocados, determinismo por seed, remanente temporal,
  independencia de `agingOffsetYears`, mindset/learningRate, test dirigido
  de minutos (30-32), academy intake sin progreso retroactivo, y
  generador ficticio. Todas pasan.
- `scripts/smoke-life1.js` (nuevo): construye los 36 equipos/414
  jugadores reales, simula 12 jornadas en ambas divisiones con
  `CpuLineup` real en los dos lados (verifica invariantes 34/35), cierra
  temporada + academy intake (invariante 36) — sin excepciones.
- Verificación manual con Playwright `file://` (headless Chromium):
  landing → modo prueba/temporada real, los 3 botones nuevos de LIFE-1, y
  ~15 botones preexistentes de modo prueba — consola limpia salvo el
  bloqueo de red esperado de Google Fonts en este entorno (preexistente,
  no relacionado con LIFE-1).

#### Fuera de alcance de LIFE-1 (queda para LIFE-2/3/4)

Entrenamiento configurable, lesiones/medicina, Staff contratable/mercado,
scouting, aprendizaje de posiciones, retiros, histórico completo de
carrera. No se ha tocado ninguna fórmula de MatchEngine/Tactics/POS/
Rotation/Recovery/Calendar/League/Bracket/Cup/Playoffs/Promotion/
CpuLineup.
