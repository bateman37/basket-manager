# Ficha de Epic — LIFE-3 (lesiones, carga médica, rehabilitación)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `LIFE-3`
- **Estado**: cerrada (histórica)
- **Objetivo**: Lesiones, carga médica, rehabilitación y vuelta a competir.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/injuries-recovery.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 3172-3407 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-24 — LIFE-3: Lesiones, carga médica, rehabilitación y vuelta a competir (DESIGN.md 9.14)

Tercera entrega de STEP 3 — PLAYER LIFE, montada encima de LIFE-1/LIFE-2/
POS/TAC-6/Recovery/Calendar/Rotation/CpuLineup/motor pausable TAC-5 ya
mergeados. Toda la lógica médica vive en `src/core/Medical.js` (nuevo);
`Recovery.js` sigue siendo solo Energy; `PlayerDevelopment.js` sigue
siendo la única fuente de crecimiento/declive normal de atributos/TMB/PA
— una lesión nunca los toca directamente.

### Arquitectura real final

- **`src/core/Medical.js`** (nuevo, ~700 líneas): inicializa/migra
  `medicalState`, calcula disponibilidad (`getAvailability`), riesgo
  compuesto por mecanismo (`computeMechanismRisk`), carga individual
  (`registerLoad`/`computeLoadFactor`), historial/recurrencia
  (`computeHistoryFactor`), lesiones de entrenamiento
  (`evaluateWeeklyTrainingTick`) y de partido
  (`evaluateMatchPossessionInjuries`), rehabilitación por días reales
  (`processPlayerMedicalToDate`/`processTeamMedicalToDate` — nombres
  deliberadamente distintos de los de `PlayerDevelopment.js`, ver
  desviación real documentada más abajo), cierre + secuela
  (`closeInjury`), setback (`applySetback`), rango de vuelta estimado
  (`getEstimatedReturnRange`) y bandas para UI
  (`describeRiskBand`/`describeLoadBand`). Ningún otro módulo reimplementa
  disponibilidad médica — todos consumen esta única API.
- **`CONFIG_BASE.medical`** (`MatchConfig.js`): curvas de Durability/
  Recovery/Energy, modelo de carga, historial/recurrencia, entorno
  (Centro Médico/Preparación Física/hook de staff), hazard de
  partido/entrenamiento, catálogo de 10 diagnósticos, fases/minute cap,
  secuelas, excepción de convocatoria, factores de estímulo de
  entrenamiento por fase y decay de Competition Rhythm. `enabled: true`
  por defecto; con `false` el motor de partido es equivalente al HEAD
  previo a esta entrega (invariante 33).

### `medicalState` (`Player.js`)

Estado nuevo y separado de `dynamicState`/`developmentState`:
`medicalSeed`, `lastProcessedDate` (rehabilitación, por días reales),
`lastTrainingTickDate` (idempotencia propia del sorteo semanal de
entrenamiento, cursor separado del anterior), `currentInjury`,
`injuryHistory` (permanente, reservado también para LIFE-4),
`loadHistory` (ventana de 42 días). Serializa/reconstruye igual que
`developmentState`; legacy sin `medicalState` se inicializa sin inventar
lesiones pasadas. `Team.medicalStaffContext` (`{doctor, physiotherapy,
physicalPreparation}`, 1-20, default 10) es el hook neutro de Staff
médico, mismo criterio que `training.staffContext` de LIFE-2.

### Durability como única predisposición — decisión cerrada

No se crea `injuryProneness`. `player.physical.durability` (1-20) es la
predisposición basal (factor de incidencia 1.70→1.00→0.55, nunca 0);
`player.physical.recovery` modula solo la velocidad de rehabilitación.
Verificado con cohortes controladas (`scripts/test-life3.js`).

### Modelo de carga

Sin ACWR/ratios: carga absoluta reciente de 7 días + pico frente a la
media de las 3 semanas anteriores, ambas señales continuas y acotadas
(`config.medical.load`). Se extrajo `Training.computeWeeklyTrainingLoadUnits()`
como helper puro compartido — Medical.js reutiliza literalmente esa
cifra (la misma que ya decide el coste de Energy semanal), nunca
reimplementa intensidad/densidad/foco desde sus nombres. Partido añade
carga por minutos reales jugados.

### Catálogo/mecanismos

10 diagnósticos como datos en `config.medical.catalog` (`ankleSprain`,
`kneeSprain`, `majorKneeLigament`, `muscleStrain`, `tendonOveruse`,
`backIssue`, `handFingerInjury`, `contusion`, `shoulderSprain`,
`concussion`), cada uno con mecanismos/severidades/rangos de días/
atributos de secuela permitidos propios. Tres mecanismos
(`acuteContact`/`acuteNonContact`/`overuse`) con modificadores
diferenciados (contacto recibe solo el 20% del exceso de carga/Energy
sobre 1.0, nunca efecto de Preparación Física).

### Integración Training/MatchEngine/Rotation/CpuLineup/TrainingAI

- **`Training.js`**: `buildPlayerTickContext()` consulta
  `Medical.getAvailability()` antes de construir el resto del contexto
  (avanza también la rehabilitación hasta ese `tickDate`), aplica los
  factores de estímulo/coste de Energy por fase médica
  (`config.medical.trainingStimulusByPhase`, nunca al `declineDelta` de
  edad) y dispara `Medical.evaluateWeeklyTrainingTick()` con la carga ya
  calculada de esa semana. `prepareTeamForMatch()` llama además a
  `Medical.processTeamMedicalToDate()` — rehabilitación por DÍAS REALES,
  cursor propio independiente de la cadencia semanal de LIFE-2 (una baja
  corta no espera al próximo tick de desarrollo para dar el alta).
- **`MatchEngine.js`**: `createMatchState()` acepta `options.matchDate` y
  construye el mapa de disponibilidad médica de la convocatoria antes de
  `Rotation.buildRotationState()`. `simulateOnePossessionStep()` evalúa
  riesgo en los 10 jugadores realmente en pista con el tiempo realmente
  transcurrido; una lesión dispara `Rotation.markPlayerUnavailable()` y
  queda en `state.injuries`. `buildMatchResult()` expone `injuries`
  (array compacto) sin eliminar ningún campo previo.
- **`Rotation.js`** (cambio mínimo, retrocompatible — parámetros nuevos
  opcionales): `unavailablePlayerIds` en el estado, `markPlayerUnavailable()`
  (sustitución forzada, ignora cuota, bloquea el jugador globalmente en
  cualquier slot), `quotaSeconds` de un jugador `limited` acotado a su
  `minuteCap` (reutiliza el mecanismo de cuota/ritmo ya existente en vez
  de un sistema de tope paralelo), fixed segments/garbage time/
  polivalencia de emergencia respetan la exclusión.
- **`CpuLineup.js`**: usa exactamente `Medical.getAvailability()` —
  excluye `unavailable`, penaliza (no excluye) a `limited` solo al elegir
  titular, aplica la excepción de convocatoria 5-7 (`Team.buildMatchSquad()`
  ahora acepta un `minOverride`).
- **`TrainingAI.js`**: nunca elige intensidad `High` si ≥3 jugadores de
  la rotación principal tienen `riskBand` Alto/Muy alto; no asigna focos
  individuales nuevos a un jugador `unavailable` (el foco existente queda
  suspendido, nunca borrado). No se crea `MedicalAI.js`.

### Return to Play / minute caps

Fases derivadas de `recoveryProgress` (nunca relojes duplicados):
`treatment`→`rehab`→`modifiedTraining`→`limited`→`available`. En
`limited`, tope real de minutos (12→30 progresivo, Preparación Física
acelera moderadamente) aplicado directamente en `quotaSeconds` de
Rotation. `Medical.getEstimatedReturnRange()` da un rango (nunca fecha
exacta), con incertidumbre según Centro Médico.

### Secuelas

Raras (probabilidad base 0/0.01/0.06/0.18 por severidad, +0.05 si hubo
recurrencia reciente, reducida por Centro Médico/staff), aplicadas vía
`PlayerDevelopment.applyResidualDelta()` (exportada desde
`PlayerDevelopment.js` en esta entrega específicamente para esto) —
nunca un bypass, nunca toca PA/POS/`bodyMeasurements`.

### Events/UI

`Events.js`: `type:'medical'` sale de reservado a implementado
(lesión/alta, derivadas siempre de datos reales). Pantalla nueva
"Lesiones" (resumen + tabla + historial por jugador, bandas de riesgo/
carga, rango de vuelta, nunca probabilidades ni `medicalSeed`
expuestos). Badges médicos de solo lectura en Alineación (bloquea
convocar/asignar minutos por encima del cap vía `getLineupValidity()`) y
Entrenamiento (foco suspendido/reducido).

### Calibración observada (`scripts/smoke-life3.js`, 36 equipos/414
jugadores reales, temporada regular completa + Copa + Playoff por el
título + Playoff de ascenso)

- Lesiones totales: ~4.7/equipo/temporada (objetivo orientativo 5-8;
  varianza amplia entre equipos, no se fuerza el número).
- Cuota sin contacto directo (entrenamiento+partido): ~69% (objetivo
  65-75%).
- Cuota severa: ~12% (objetivo 10-18%).
- Miembros inferiores: ~74% del total (objetivo 65-80%).
- Cero equipos bloqueados por debajo de 5 jugadores médicamente
  disponibles, en ningún momento de la simulación.
- Estas cifras varían de una tirada a otra (`Math.random()` real, sin
  seed, para las lesiones de partido) — ejecuciones repetidas del script
  oscilan aproximadamente entre 4-5 lesiones/equipo, 65-79% sin contacto
  directo y 7-15% severas; siempre dentro del orden de magnitud
  perseguido, nunca forzado a un número exacto (sección 36/37 del
  prompt de esta sesión, explícitamente).
- El `contactShare`/`nonContactShare` de `config.medical.match` (52/48)
  y el `hazardPerThousandPlayerHours` (30) quedaron por encima del "35/
  65" y "24" de ancla inicial del prompt de esta sesión: los
  modificadores de `acuteContact` están deliberadamente amortiguados
  (sección 6 del prompt), así que un share "de catálogo" igual al
  objetivo real se queda corto en la práctica — documentado en
  `MatchConfig.js` en el propio bloque `medical.match`.

### Tests

- `scripts/test-life3.js`: 23 invariantes dirigidos (Durability/Recovery,
  no-injuryProneness, PA/TMB/learning intactos al lesionarse,
  serialización, idempotencia de tick/rehab, retirada+sustitución
  forzada en partido, exclusión de `unavailable`, minute cap de
  `limited`, exclusión/excepción de convocatoria en CpuLineup, guarda de
  mínimo 5, historial/recurrencia, decaimiento de historial antiguo,
  Centro Médico nunca en riesgo 0, minor sin secuela, severe con/sin
  secuela, secuela vía residuales sin tocar PA/POS/body, estímulo de
  entrenamiento reducido por fase, `simulateMatch()`/`medical.enabled=false`)
  — 23/23 OK.
- `scripts/smoke-life3.js`: temporada completa de las dos divisiones
  reales + Copa + Playoffs + Ascenso, más 5 temporadas sintéticas rápidas
  de `prepareTeamForMatch()` encadenado (colas/acumulación de riesgo) —
  sin excepciones.

### Desviaciones reales frente al prompt de esta sesión

- **Hallazgo real durante la verificación Playwright (sección 43)**:
  `Medical.js` había nombrado sus funciones de rehabilitación
  `processPlayerToDate`/`processTeamToDate` — nombres IDÉNTICOS a los ya
  exportados por `PlayerDevelopment.js`. En Node (`require()` por
  módulo) esto pasa desapercibido, pero en el navegador TODOS los
  módulos vuelcan sus exports sobre el MISMO `global.BasketManager`
  (`Object.assign`), así que el módulo cargado más tarde (`Medical.js`,
  después de `PlayerDevelopment.js` en `index.html`) sobrescribía
  silenciosamente la función de LIFE-1 — rompía la herramienta de
  depuración de LIFE-1 (`index.html`, sección "Prueba: LIFE-1") con
  `TypeError` real en el navegador. Renombradas a
  `processPlayerMedicalToDate`/`processTeamMedicalToDate` en todo
  `Medical.js` y sus llamadores (`Training.js`, `scripts/test-life3.js`,
  herramienta de prueba LIFE-3 de `index.html`). Ninguna prueba en Node
  (`scripts/test-life3.js`/`scripts/smoke-life3.js`) lo detectó por esta
  misma razón — solo la verificación Playwright contra la interfaz real
  lo hizo, confirmando por qué esa verificación es parte obligatoria de
  esta entrega y no un paso opcional.
- El prompt describe `Medical.getAvailability(player, date, context)`;
  la firma real es `getAvailability(player, date, config, context)` —
  mismo criterio que el resto de módulos del proyecto (`config` siempre
  explícito, nunca escondido dentro de un `context` genérico).
- La sección 10 pide que el historial influya "para la MISMA zona/tipo"
  al decidir SI ocurre una lesión — en la práctica eso exigiría conocer
  qué lesión concreta va a ocurrir antes de decidir si ocurre (circular).
  Se implementó como: el factor de riesgo agregado usa la entrada de
  historial más "caliente" (mayor factor por antigüedad, tratada de forma
  conservadora); la SELECCIÓN del diagnóstico concreto sesga su peso a
  favor de la misma zona/tipo de esa entrada (`biasCatalogWeight()`) —
  mismo efecto observable (recurrencia real en la misma zona), arquitectura
  no circular. Documentado en el propio comentario de
  `computeHistoryFactor()`.
- `config.medical.match.contactShare`/`hazardPerThousandPlayerHours` y
  varios pesos `severe` del catálogo se recalibraron tras
  `scripts/smoke-life3.js` (ver sección de calibración arriba) — el
  prompt ya señalaba estos números como "calibrable"/"punto de partida".
- No se tocó ninguna fórmula de `MatchEngine`/POS/`roleFit`/
  `tacticalExecution`/GamePlan/Tactics/Recovery/PlayerDevelopment normal/
  Calendar/League/Cup/Playoffs/Promotion — solo se leen disponibilidad/
  carga en los puntos ya señalados.

### Pendiente explícitamente para LIFE-4

- Histórico completo de carrera más allá de `injuryHistory` (ya
  reservado, con el mismo shape, para que LIFE-4 lo reutilice sin crear
  un segundo histórico).
- Staff contratable real (el hook `medicalStaffContext`/`staffContext`
  queda neutro en 10 hasta entonces).
- Forfeits/aplazamientos por escasez médica extrema — deliberadamente
  fuera de alcance de esta entrega (sección 23 del prompt).
- Resfriados/enfermedades sin impacto competitivo — deliberadamente
  fuera de alcance (sección 1 del prompt: "no añadas... sin impacto
  competitivo").
