# Lesiones, carga médica y rehabilitación (LIFE-3)

_Migrado de `DESIGN.md` (líneas 4895-5075 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.14 LIFE-3 — Lesiones, carga médica, rehabilitación y vuelta a competir

Módulo nuevo (`src/core/Medical.js` + `CONFIG_BASE.medical`), responsable
ÚNICO de todo lo médico. `Recovery.js` sigue siendo Energy (batería
física); `PlayerDevelopment.js` sigue siendo la única fuente de
crecimiento normal de atributos/TMB/PA — **una lesión nunca cambia PA,
`learningRate`, `learningPersistence`, Profesionalidad, Ambición ni
`agingOffsetYears`**, y nunca resta TMB directamente (el jugador pierde
TMB solo si cambian atributos reales, por exposición perdida o por una
secuela real).

**Predisposición basal — decisión cerrada**: no existe un segundo
atributo `injuryProneness`. `player.physical.durability` (1-20) pasa a
ser la predisposición basal frente a lesión (interpolación lineal
1→1.70, 10→1.00, 20→0.55 de factor de incidencia — nunca 0). `Recovery`
(1-20) modula solo la VELOCIDAD de rehabilitación una vez producida la
lesión, nunca la incidencia basal.

**Tres mecanismos de lesión**, nunca una probabilidad única:
`acuteContact` (contacto — sobre todo en partido, apenas influido por
carga/Energy, nunca eliminable por buena preparación), `acuteNonContact`
(giro/salto/aceleración sin contacto — partido o entrenamiento, sí
sensible a carga/Energy/Durability/historial) y `overuse` (sobrecarga
progresiva — solo se genera en el procesamiento semanal de entrenamiento).
Calibrado (`scripts/smoke-life3.js`, 36 equipos/414 jugadores reales,
temporada completa) para que la mayoría de las lesiones agregadas
(entrenamiento+partido) sean sin contacto directo.

**Riesgo**: una sola fórmula compuesta y acotada por `CONFIG_BASE.medical`
(sin números mágicos en `Medical.js`) — `baseExposureRisk ×
durabilityFactor × historyFactor × energyFactor × loadFactor ×
environmentFactor`. `acuteContact` recibe solo el 20% del exceso de
`loadFactor`/`energyFactor` sobre 1.0 (y no recibe efecto de Preparación
Física en absoluto); el resto de mecanismos recibe el factor completo.

**Carga individual** (`medicalState.loadHistory`, ventana de 42 días):
sin ACWR/ratios — dos señales continuas y acotadas, carga absoluta
reciente de 7 días y pico frente a la media de las 3 semanas anteriores.
Reutiliza literalmente la unidad de carga semanal que ya calcula
`Training.computeWeeklyTrainingLoadUnits()` para el coste de Energy
(nunca reimplementada por intensidad/densidad/foco); partido añade carga
por minutos reales jugados (`config.medical.load.matchLoadPerMinute`).

**Historial/recurrencia**: una lesión previa importa especialmente para
la MISMA zona/tipo (factor por antigüedad desde la recuperación:
<90 días 1.70, 90-365 1.40, 1-2 años 1.20, >2 años 1.05, clamp global
1.80); misma zona con tipo distinto aplica solo la mitad del exceso.
Nunca hay bonus por "cualquier lesión alguna vez". Cada lesión nueva
guarda `recurrenceOf` apuntando a la más relevante de su histórico.

**Centro Médico / Preparación Física / hook de Staff**: medias
ponderadas (nunca varios factores multiplicados entre sí) sobre mapeos
lineales 1-20→factor propios de esta entrega. Centro Médico afecta
prevención general moderada, velocidad/calidad de rehabilitación, riesgo
de recurrencia y precisión del rango de vuelta estimado — nunca mejora
rendimiento físico. Preparación Física afecta solo prevención de
`acuteNonContact`/`overuse` y tolerancia a carga — nunca cura una lesión
ya producida. `Team.medicalStaffContext` (`{doctor, physiotherapy,
physicalPreparation}`, 1-20, default 10) es el mismo tipo de hook neutro
que `training.staffContext` de LIFE-2 — sin Staff real todavía. Ningún
entorno hace inmune a nadie.

**Estado médico persistente** (`Player.medicalState`, separado de
`dynamicState`/`developmentState`): `currentInjury` (o `null`),
`injuryHistory` (histórico permanente y compacto, reservado también para
LIFE-4), `loadHistory` (ventana de 42 días) y los cursores de
determinismo/idempotencia (`medicalSeed`, `lastProcessedDate` propio para
la rehabilitación por días reales, `lastTrainingTickDate` propio para no
resortear la misma semana de entrenamiento dos veces). Sobrevive
`toJSON()`/reconstrucción igual que `developmentState`; legacy sin
`medicalState` se inicializa sin inventar lesiones pasadas.

**Lesiones de entrenamiento**: se evalúan UNA vez por tick semanal real de
LIFE-2 (`Training.buildPlayerTickContext()` llama a
`Medical.evaluateWeeklyTrainingTick()` con la carga YA calculada de esa
semana) — nunca un calendario de gimnasio diario. Mientras exista
`currentInjury` en fase `treatment`/`rehab`/`modifiedTraining` no se
sortea nada nuevo; en fase `limited` puede producirse una recaída
(`setbackCount`, `recoveryProgress` retrocede a un rango CONFIG en vez de
crear una segunda lesión).

**Lesiones de partido**: integradas en el motor pausable de TAC-5
(`MatchEngine.simulateOnePossessionStep`) — riesgo evaluado en los 10
jugadores realmente en pista, con el tiempo realmente transcurrido
(convertido correctamente de segundos a probabilidad, nunca "% fijo por
posesión"), ancla `hazardPerThousandPlayerHours` (CONFIG). Al ocurrir:
`Rotation.markPlayerUnavailable()` retira al jugador DE VERDAD (bloqueado
globalmente en cualquier slot/posición, incluso en un quinteto fijo) y
fuerza sustitución inmediata saltándose cuota — nunca vuelve a esa pista.
`buildMatchResult()` expone un array compacto `injuries` además del
`eventLog`. Con `config.medical.enabled=false`, el motor de partido es
equivalente al HEAD previo a esta entrega.

**Rehabilitación progresiva / Return to Play**: nunca
`injured→fecha→100%`. `Medical.processPlayerMedicalToDate()` avanza
`recoveryProgress` (0→1) por DÍAS REALES transcurridos (no por tick
semanal — una baja de 3 días no espera a la próxima semana de desarrollo
para dar el alta), según Recovery del jugador y el entorno médico. Fases
derivadas de `recoveryProgress` (nunca relojes duplicados): `treatment`
(<0.25) → `rehab` (0.25-0.75) → `modifiedTraining` (0.75-`limitedThreshold`,
que sube con la severidad) → `limited` (hasta 1.0) → `available`. En
`limited`, tope real de minutos (`Medical.getAvailability().minuteCap`,
12→30 progresivo, Preparación Física acelera moderadamente sin saltarse
el umbral) — aplicado en `Rotation.buildRotationState()` acotando
directamente `quotaSeconds`, reutilizando el mecanismo de cuota/ritmo ya
existente en vez de un sistema de tope paralelo.

**Disponibilidad — API única**: `Medical.getAvailability(player, date,
config, context)` devuelve `{status, phase, minuteCap, injury,
riskBand}` — TODOS los consumidores (Rotation, CpuLineup, TrainingAI,
Alineación, Entrenamiento, pantalla Lesiones) la usan igual, nunca un
`isInjured` duplicado.

**Excepción médica de convocatoria**: `Team.buildMatchSquad()` acepta un
`minOverride` — el mínimo NORMAL de la competición real del club (8 ACB,
10 Primera FEB desde ROSTER-1, ver 9.16 — **corrección**: esta sección
decía "8 normal" como si fuera universal; nunca lo fue, era solo el caso
de ACB, la única competición que existía al escribir LIFE-3); si solo hay
escasez médica real por debajo de ese mínimo normal se permite convocar a
todos los disponibles, nunca por debajo del mínimo ABSOLUTO de 5. El
mínimo normal lo resuelve `CompetitionRules.resolveRules()`; el mínimo
absoluto (5) y la lógica de reducción siguen siendo política médica de
`CONFIG_BASE.medical.squadException` — combinados en el único punto que
antes los duplicaba a mano tres veces
(`Medical.resolveEffectiveSquadMinimum()`). El propio motor de riesgo
(`Medical.wouldDropBelowMinimum()`) se niega a generar una lesión nueva
que dejaría al club por debajo de 5 disponibles — protección de
integridad, no probabilidad de gameplay.

**CPU** (`CpuLineup.js`): usa exactamente `Medical.getAvailability()` —
excluye `unavailable`, puede usar `limited` (con penalización suave, no
exclusión, para no forzarlo de titular si hay alternativa razonable; el
tope real de minutos lo aplica Rotation, no CpuLineup), aplica la misma
excepción 5-7 por escasez real. `TrainingAI.js` nunca elige intensidad
`High` si ≥3 jugadores de la rotación principal tienen `riskBand`
Alto/Muy alto, y no asigna focos individuales nuevos a un jugador
`unavailable` (el foco ya asignado queda suspendido, nunca borrado).

**Secuelas** (sección 27): raras y basadas en la lesión concreta —
probabilidad base por severidad (minor 0, moderate 0.01, major 0.06,
severe 0.18, +0.05 si hubo recurrencia reciente), reducida por Centro
Médico/staff, nunca eliminada. Si ocurre, afecta solo a
`catalog[type].sequelaAttributes` (atributos físicos coherentes con la
lesión), aplicada vía `PlayerDevelopment.applyResidualDelta()` (mismo
mecanismo de residuales/clamps que el crecimiento normal, nunca un
bypass) — nunca toca PA/POS/`bodyMeasurements`.

**Competition Rhythm**: LIFE-1/2 no dejaron ningún decay temporal real
por inactividad (verificado contra HEAD) — LIFE-3 añade uno mínimo, SOLO
durante días de indisponibilidad médica real
(`competitionRhythmDecayPerDayUnavailable`, CONFIG). El alta completa
nunca fija Competition Rhythm a 100 — los minutos reales lo reconstruyen
con su mecanismo ya existente.

**Events/Agenda/Noticias**: `Events.js` extiende el catálogo con
`type:'medical'` (que CAL-2 ya había reservado) — lesión/diagnóstico y
alta completa (solo si estuvo fuera ≥14 días), ambas derivadas del hecho
médico real, nunca inventadas. Noticias: cualquier lesión time-loss del
equipo del usuario (prioridad alta si major/severe, media si
minor/moderate); de un rival de la división visible solo major/severe
(prioridad media); la división de fondo nunca genera noticia médica.

**Pantalla nueva "Lesiones"** (`src/ui/game.js`): resumen
(Disponibles/Limitados/Lesionados/riesgo Alto-Muy alto), tabla por
jugador (estado, lesión actual, vuelta estimada como RANGO —
`Medical.getEstimatedReturnRange()`, nunca fecha exacta — límite de
minutos si `limited`, Energy, carga reciente y riesgo actual como bandas
Bajo/Normal/Alto/Muy alto vía `describeRiskBand`/`describeLoadBand`,
nunca fórmulas duplicadas en UI) e historial médico por jugador. Nunca
muestra probabilidades exactas ni `medicalSeed`. Alineación/Entrenamiento
reciben badges médicos de solo lectura (jugador no disponible/límite de
minutos/foco suspendido), sin controles médicos propios en esas
pantallas.

**Fuera de alcance de LIFE-3** (quedan explícitamente para LIFE-4 o
posterior): histórico completo de carrera más allá de
`injuryHistory`, Staff contratable real, decaimiento de posiciones/
táctica por no uso, resfriados/enfermedades sin impacto competitivo
(deliberadamente fuera de alcance, ver sección 1 del prompt de esta
sesión), forfeits/aplazamientos por escasez médica extrema.
