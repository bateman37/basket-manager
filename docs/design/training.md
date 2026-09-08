# Entrenamiento y desarrollo dirigido (LIFE-2)

_Migrado de `DESIGN.md` (líneas 4771-4894 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.13 LIFE-2 — Entrenamiento, desarrollo dirigido y aprendizaje táctico/posicional

Módulo nuevo (`src/core/Training.js` + `src/core/TrainingAI.js`), montado
ENCIMA de LIFE-1/POS/TAC-6 sin recalcular ninguna de sus reglas
(Professionalism/Ambition/learningRate/learningPersistence/PA/facilities/
staffFactor/curvas de edad siguen siendo responsabilidad exclusiva de
`PlayerDevelopment.js`). Training solo construye el ESTÍMULO de
entrenamiento y los sistemas nuevos de posición/rol/Energy.

**Plan colectivo persistente** (`Team.trainingPlan`, con fallback legacy a
Balanced/Normal/sin focos): un `teamFocus` (Balanced/Offense/Defense/
Physical/Tactical) y una `intensity` (Recovery/Light/Normal/High), más
`individualFocuses` (como mucho un foco activo por jugador: atributo,
posición o rol). Cambiar el plan siempre procesa primero el desarrollo
pendiente con el plan ANTERIOR (`Team.trainingState.planSegments`,
podados al consumirse) antes de aplicar el nuevo — cambiar de plan nunca
reescribe semanas ya transcurridas.

**Densidad competitiva** (`Team.trainingState.recentTeamMatchDates`, una
fecha por partido real de cualquier competición): cada tick de 7 días
calcula cuántos partidos del equipo caen en esa ventana y aplica una tabla
`opportunityFactor`/`loadUnits` (0 partidos favorece más entrenamiento que
2-3) — una semana congestionada deja menos margen de desarrollo, sin
necesidad de un segundo calendario de gimnasio visible.

**Trade-off intensidad ↔ Energy/Recovery**: `developmentMultiplier` sube el
estímulo con la intensidad, a cambio de más coste de Energy
(`loadUnits × energyCostPerLoadUnit`, más un extra por foco individual) y
menos margen de Recovery real (`Recovery.applyRestRecovery`, hook
`trainingModifier` ya reservado por 7.11.5, nunca una segunda fórmula).
`readinessFactorByEnergy` modula además el estímulo POSITIVO según la
Energy del jugador (nunca el declive).

**Presupuesto neutral de Team Focus**: Balanced deja el estímulo en 1.00
para los 29 mutables; Offense/Defense/Physical redistribuyen un vector
bruto normalizado contra el presupuesto TMB del jugador
(`PlayerDevelopment.getPositionWeights`) para que la media ponderada del
estímulo vuelva a 1.00 — cambian QUÉ mejora, no cuánto talento total se
crea. Tactical es la excepción deliberada: su presupuesto de atributos NO
se normaliza (queda por debajo de 1.00), a cambio del mayor estímulo de
familiaridad táctica.

**Foco individual único** (`{type: 'none'|'attribute'|'position'|'role', target, side?}`,
validado/normalizado por `Training.normalizeIndividualFocus` — fallback
seguro a `none` si el target deja de existir, nunca crash de save):
- **Atributo**: concentra presupuesto (×1.35 sobre el target, resto
  reducido proporcionalmente para conservar el mismo presupuesto
  ponderado) — no crea desarrollo extra total.
- **Posición**: aprendizaje real de competencia POS 1-20
  (`player.developmentState.positionProgress`, residual persistente
  independiente de `attributeProgress`) — sin distancia geométrica ni techo
  por altura/atributos, `nominalPosition` nunca cambia automáticamente,
  posición nunca consume PA/TMB. Headroom
  `sqrt((20-nivel)/19)`, edad/mindset reutilizados de
  `PlayerDevelopment.computeLearningFactor` + curva `cognitive`, entorno de
  coaching posicional (Training Center + `staffContext`, mismos mappings
  1-20→factor que facilities), y un `matchRepFactor` que acelera con
  minutos REALES en la posición entrenada (`Rotation.js`/
  `MatchEngine.rotationSummary` exponen `positionSecondsByPlayer`,
  registrado en `matchExposures.positionMinutes`) — sin minutos, progreso
  más lento pero real. Desvía parte del desarrollo general de atributos
  (×0.92).
- **Rol**: entrena la familiaridad REAL ya introducida por TAC-6
  (`profile.familiarity.byPlayerRole`, misma inicialización 35/reset 15 que
  el camino de partido) — nunca toca `roleFit` (que sigue derivando solo de
  atributos + POS). Un jugador con foco de rol recibe ×1.75 sobre la
  ganancia de familiaridad de ESE rol, y desvía parte de su desarrollo
  general de atributos (×0.94).

**Entrenamiento táctico colectivo**: alimenta exactamente los datos ya
existentes de TAC-6 (`offensiveSystem`/`defensiveSystem`/`byPlayFamily`/
`byCoverage`/`byPlayerRole`, vía `Tactics.growFamiliarityValue` —
diminishing returns hacia 100, sin techo aparte) según el perfil táctico
ACTIVO del equipo (familias del playbook con peso real, cobertura de P&R
activa), con velocidad semanal propia (`config.training.tactical`,
separada de `config.tactics.familiarity`, que sigue rigiendo el aprendizaje
por posesión jugando partidos — ambas fuentes conviven, nunca se sustituyen
una a otra). La complejidad de la jugada/cobertura ralentiza el
aprendizaje (factor 1.00-0.65), nunca cambia `tacticalExecution`.

**Orden temporal central** (`Training.prepareTeamForMatch`, llamado desde
el resolver de opciones de partido de `game.js` para AMBOS lados de
CUALQUIER partido — liga visible, liga de fondo, brackets, usuario y CPU):
recuperación de Energy → estímulo de entrenamiento → PlayerDevelopment
(crecimiento/declive) → progreso POS/táctico → el partido se simula. La
misma función es idempotente (`Team.trainingState.lastProcessedDate`), así
que también sirve de respaldo genérico en el punto ya existente que avanza
el reloj de mundo (`advanceGameClockTo`) para huecos sin partido
inminente — la pretemporada entre temporadas, en particular.

**Offseason**: el plan sigue activo, pero la intensidad efectiva se fuerza
a Normal (detectado automáticamente comparando la fecha del tick con
`Calendar.seasonStartDate` de la temporada vigente, sin ningún campo nuevo
de "estamos en pretemporada") y no se aplica coste de Energy de
entrenamiento; la familiaridad táctica y el progreso posicional/de rol
siguen progresando con un multiplicador reducido (0.60). LIFE-1 no dejó
ningún `offseasonLearningMultiplier` real que conservar (verificado contra
HEAD) — desviación frente al prompt original de esta sesión, documentada
en el CHANGELOG.

**CPU** (`TrainingAI.js`, nunca en `game.js`): revisa el plan colectivo de
los 35 clubes no controlados cada 28 días (heurística explicable: Energy
baja → Recovery; calendario congestionado → Light; familiaridad táctica
baja → Tactical; plantilla joven con margen → Balanced/High si el
calendario lo permite; si no, el enfoque que cubre la debilidad relativa
del roster) y los focos individuales cada 56 días (atributo relevante bajo
el propio perfil por defecto; posición/rol solo bajo condiciones
explícitas de cobertura pobre/familiaridad baja), más una revisión
defensiva si un foco deja de ser válido. El equipo del usuario nunca pasa
por `TrainingAI`.

**Pantalla nueva** ("Entrenamiento", `src/ui/game.js`/`game.css`): capa de
presentación pura sobre `Training.js` — plan colectivo con guardado
explícito, próximo microciclo (margen/carga + alertas de Energy baja vía
`Training.projectEnergyToDate`, sin mutar estado) y focos individuales por
jugador. Modo prueba (`index.html`) añade una comparativa de 12 escenarios
con seed controlada.

**Fuera de alcance de LIFE-2** (quedan explícitamente para LIFE-3 o
posterior): lesiones/injuryProneness/riesgo por carga, Staff como
entidades reales, decaimiento de posiciones/táctica por no uso,
familiaridad de quinteto, entrenamiento diario editable, cambio automático
de `nominalPosition`.
