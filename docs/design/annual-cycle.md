# Ciclo anual: expiración, renovación, retirada, cantera y clearinghouse (CYCLE-1)

_Migrado de `DESIGN.md` (líneas 7272-7614 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.22 CYCLE-1 — Ciclo anual de plantilla: expiración, renovación, retirada, cantera y clearinghouse

Séptima entrega (de nueve) de la EPIC "Ciclo profesional de plantilla" (ver
9.16), construida sobre LOAN-1 (9.21, ya fusionado). Hasta esta entrega el
"cierre de temporada" era un monolito directo (ascender/descender clubes →
resembrar inscripciones a mano → `team.generateAcademyIntake(3, fecha)` en
los 36 clubes → sustituir el `Calendar`), y CONTRACT-1 garantizaba un
puente temporal (`MINIMUM_PLAYABLE_REMAINING_SEASONS = 3`) para que ningún
contrato expirase nunca de verdad. CYCLE-1 retira ambos supuestos: sustituye
el monolito por una máquina de estados de 13 fases con fechas reales, y deja
que contratos, licencias, tanteo, plantillas de academia y jugadores
individuales vivan y mueran orgánicamente, siempre con datos VISIBLES
(nunca Potencial/Ambición/Profesionalidad ocultos) y siempre de forma
determinista dada una `careerSeed` explícita.

Fuera de alcance explícito de esta entrega (ver "Fuera de alcance" al
final): transfer internacional real (EUROPE-1); traspasos/cesiones
CPU-a-CPU orgánicos fuera del clearinghouse de agentes libres (ver
limitación conocida más abajo); save/load real (HARDEN-1, la congelación
de reglas por `rulesetBundleId+version` de una temporada ya iniciada queda
para esa entrega).

#### El ciclo anual: 13 fases con fechas reales

`CycleConfig.CYCLE_PHASES` fija el orden canónico, nunca reordenable por
un caller:

```
competitions-complete → snapshot-frozen → season-history-closed →
loans-and-options-reviewed → rights-and-retention-open →
retirements-reviewed → renewals-and-free-agency → academy-decisions →
clearing-rounds → roster-legality-audit → licenses-and-registrations →
preseason-ready → new-season-started
```

Cada fase tiene un desplazamiento en DÍAS CIVILES respecto a la fecha del
ÚLTIMO partido oficial del mundo (`PHASE_DAY_OFFSETS`) — el verano se
recorre por fechas reales, nunca por "pasos" abstractos. `AnnualCycleService.
openCycle()` exige evidencia real de cierre por club (`missingClubIds`
lanza si falta alguno) y es idempotente por `fromSeasonKey`. Cada fase
tiene su propia función (`closeSeasonHistory`, `reviewLoansAndOptions`,
`openRightsAndRetention`, `reviewRetirements`, `runRenewalsAndFreeAgency`,
`runAcademyDecisions`, `runClearingRounds`, `runRosterLegalityAudit`,
`runLicensesAndRegistrations`, `markPreseasonReady`, `startNewSeason`) y
`runPhase({...cycleParams, phaseId, date})` es el único punto de entrada
real (usado tanto por `game.js` como por todos los scripts de prueba, vía
`scripts/cycle1-harness.js`). Una fase que deja clubes NOT READY nunca dejar
pasar la temporada en silencio: `runRosterLegalityAudit`/
`markPreseasonReady` lanzan un error descriptivo listando cada club y su
motivo bloqueante — invariante 26 (ninguna temporada empieza con un club
ilegal).

`src/entities/Cycle.js` (nuevo) define las entidades: `AnnualRosterCycle`
(máquina de estados por EVENTOS — `phase:<id>` en el orden fijo del array
de fases, más `cycle-blocked`; un id de evento duplicado lanza una colisión
descriptiva, nunca un no-op silencioso; un terminal nunca vuelve a un
estado vivo), `ClubCycleCase` (expediente por club dentro del ciclo),
`ClubSquadPlan` (plan CPU congelado), `RenewalCase`/`ContractOptionDecision`
(procedimientos con plazos fechados, mismo patrón de eventos que
`RightOfFirstRefusalCase` de MARKET-1), `RetirementProfile`/
`RetirementAnnouncement`/`RetirementRecord`, `AcademyMembership`/
`AcademyDecision`, `ClearingRound`/`ClearingDecision`,
`RosterLegalityReport`/`EmergencyRosterAction`, `ContractExpiryRecord`,
`ProfessionalPathwayExitRecord`. `src/core/AnnualCycleRegistry.js` y
`src/core/AcademyRegistry.js` (nuevos) son las fuentes CANÓNICAS —
`state.annualCycleRegistry`/`state.academyRegistry`, creados en
`startSeason()`, con `validateIntegrity()` propio (mismo `RegistryIndexAudit`
compartido que Contract/Registration/Transfer/Loan Registry).

`src/core/CycleTransaction.js` (nuevo) extrae el patrón saga atómica
(`planTransaction`/`commitTransaction`, `registerUndo()` que solo
ALMACENA el cierre de reversión, rollback en orden inverso, acumulando
fallos de un `undo` sin tragárselos) ya probado en
`TransferExecutionService`/`LoanExecutionService` — nunca un tercer motor
de saga duplicado. Lo reutilizan expiración de contrato, retirada
efectiva, promoción de academia y altas de emergencia de plantilla.

#### Expiración, renovación y opciones contractuales (`ContractExpiryService`, `RenewalService`)

`ContractExpiryService.findDueExpirations()`/`processExpiration()`/
`processDueExpirationsToDate()` cierran orgánicamente todo contrato cuya
`endDate` ya pasó, dentro de la fase `loans-and-options-reviewed`/
`renewals-and-free-agency` — retira definitivamente el suelo
`MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` de CONTRACT-1 (documentado ahí
como puente temporal). Un jugador cuyo contrato expira sin renovación ni
opción ejercida pasa a agente libre (`player.teamId = null` vía
`RosterMutationService`, la MISMA frontera de TRANSFER-1/LOAN-1) —
**consecuencia arquitectónica importante**: esto crea una vía LEGÍTIMA de
cambio de `player.teamId` sin ningún `TransactionRecord` en
`TransferRegistry`, que `TransferRegistry.validateIntegrity()` necesitó una
excepción explícita para reconocer (ver "Bugs encontrados y corregidos").

`RenewalService` implementa una negociación de un solo turno por ronda,
mismo espíritu que MARKET-1: `isRenewable(contract, ...)` (ventana fechada,
`renewalWindowFor`) → `openRenewalCase()` → rondas de
`sendRenewalOfferAndResolve()` (resultados tipados: `'agreement-in-principle'`
— éxito, nunca `'accepted'` —, `'rejected'`, `'expired'`, `'blocked'`,
`'countered'` con `counterRequestMinor` para la siguiente ronda) →
`commitRenewal()` registra el contrato nuevo en `ContractRegistry`.
`ContractOptionDecision`/`buildOptionDecision()`/`exerciseOption()`/
`decideOptionForCpu()` cubren cláusulas de opción congeladas en la firma
(`OPTION_CLAUSE_TYPES`) — `describeExecutability()` distingue una decisión
incompleta (faltan campos) de una completa, nunca un booleano suelto.
Dinero SIEMPRE en unidad mínima entera + moneda ISO 4217; fechas SIEMPRE
civiles ISO — mismo criterio que CONTRACT-1/MARKET-1/TRANSFER-1/LOAN-1.

#### Tanteo orgánico

`AnnualCycleService.openRightsAndRetention()` abre casos de tanteo REALES
(`RightOfFirstRefusalService` de MARKET-1) durante la fase
`rights-and-retention-open`, para el subconjunto de contratos elegibles que
antes nunca expiraban — el gancho de apertura orgánica que MARKET-1 dejó
explícitamente pendiente ("ningún caso de tanteo se abre orgánicamente
todavía en una carrera normal") queda cerrado aquí. La prueba de humo de 10
temporadas registra 788 casos de tanteo abiertos orgánicamente sobre 1629
expiraciones — cifra real, no estimada.

#### Retirada individual y determinista (`RetirementService`)

`RetirementService.ensureProfile()` construye un `RetirementProfile` por
jugador usando SOLO señales VISIBLES (`computeTmbTrend`,
`computeMedicalLoadSignal`, `computeRecentMinutesSignal`, edad vía
`CareerAge`) — **nunca Potencial oculto**, auditado estáticamente en
`test-cycle1.js`. `buildProfileFingerprint()` + una `careerSeed` explícita
hacen la decisión DETERMINISTA y distinta por jugador (nunca la misma
probabilidad para toda la liga). `evaluateRetirementIntent()` →
`resolveEffectiveDate()` → `announceRetirement()` (idempotente por
jugador) → `commitRetirement()` (efectivo, saca al jugador de
`Team.roster` vía `RosterMutationService`, pero lo deja siempre localizable
en el Player Registry — un retirado nunca desaparece del histórico).
`describeRetirementStatus()` resuelve el estado para UI sin duplicar
lógica.

#### Cantera como pool separado (`AcademyService`)

`AcademyService.runAnnualIntake()` sustituye
`team.generateAcademyIntake(3, fecha)` en los 36 clubes — BUG-CYCLE1-05,
ahora retirado: la cantera YA NO entra directamente al primer equipo. Cada
newgen entra en `AcademyRegistry` como `AcademyMembership`, con cupo
(`CycleConfig.ACADEMY`, máximo 8 por club) y nunca duplicado en
`Team.roster`. `decideForMembership()`/`applyContinue()`/`applyRelease()`/
`applyLeftPathway()` resuelven la decisión anual (continuar en la vía,
liberar, o que el propio jugador abandone) — solo `promoteToFirstTeam()`
mueve a un académico al roster real del primer equipo, vía el mismo
`Team.addPlayer()`/`RosterMutationService` que cualquier otra afiliación,
NUNCA como parte del intake. `promoteToFirstTeam()` es atómica: si falla,
LANZA (nunca devuelve `{succeeded:false}`) — la UI debe usar try/catch, no
comprobar un campo de éxito.

#### Planificación CPU y clearinghouse (`CpuRosterPlanner`, `runClearingRounds`)

`CpuRosterPlanner` es de dos fases y PURA (nunca muta ni llama a un
registro directamente — auditado estáticamente en `test-cycle1.js`):
`buildSnapshot()` (foto del mundo elegible) → `buildAllPlans()` (un
`ClubSquadPlan` por club, determinista dado `careerSeed`, **orden-
independiente**: verificado con una huella canónica byte-a-byte que da el
mismo resultado con los clubes/jugadores barajados) → `buildProposals()`.
`runClearingRounds()` ejecuta rondas de asignación determinista sobre esos
planes (renovaciones, fichajes de agentes libres, promociones de cantera)
— **limitación conocida y documentada, no oculta**: el clearinghouse de
esta entrega resuelve renovación/fichaje-de-libre/promoción-de-cantera,
pero NO abre traspasos o cesiones CPU-a-CPU orgánicos entre clubes
(TRANSFER-1/LOAN-1 siguen existiendo solo como acciones dirigidas por el
usuario vía Mercado). Se documenta así explícitamente en vez de simular
una cobertura que no existe — ver "Fuera de alcance" y CHANGELOG.md.

#### Legalidad de plantilla y escalera de emergencia (`RosterLegalityService`)

`buildRegulatedPool()`/`buildReport()` evalúan el mismo pool regulado de
REG-1 (senior+propios+vinculados vía `EligibilityService`) contra los
cupos reales de la competición del club. `applyEmergencyLadder()` aplica,
en orden, hasta 3 medidas antes de declarar una plantilla genuinamente
inviable (`buildForcedClassification`, `signPlayerForEmergency` — esta
última llama a `RosterMutationService.transferPlayer()` DIRECTAMENTE, una
segunda vía legítima de cambio de `player.teamId` sin
`TransactionRecord`, igual que la expiración orgánica). Devuelve
`{actions, resolved, remaining}` — **`resolved` es la señal de éxito real,
nunca `actions.length`** (un intento fallido también se empuja a
`actions`; confundir ambos fue un bug propio de esta sesión, corregido
antes de publicarse, ver más abajo).

**Legalidad como propiedad viva, no solo de arranque de temporada**: un
roster legal al empezar la temporada puede volverse ilegal A MITAD de
temporada sin ningún evento explícito de cambio de plantilla (ejemplo real
encontrado en la prueba de humo de 10 temporadas: un jugador cruza un
umbral de edad y dejar de contar como "de formación" hace que el club caiga
por debajo del cupo de formación vigente). La construcción de convocatoria
para CUALQUIER partido (usuario o CPU) reintenta la MISMA escalera de
emergencia en el momento del partido antes de declarar infeasibilidad —
nunca cae a un selector no regulado.

#### Población acotada (`WorldLifecycleService`)

`initializePlayerLifecycle()` sigue siendo el ÚNICO punto de inicialización
real por jugador (desarrollo + estado médico + histórico de carrera + perfil
de retirada + procedencia) — llamado en el sweep de
`bootstrapCycleForNewCareer()`, en `AcademyService.runAnnualIntake()` y en
la generación de emergencia de `RosterLegalityService`; los renders NUNCA
lo llaman (BUG-CYCLE1-03, ver abajo). `classifyWorld()`/`describePopulation()`
distinguen SIEMPRE población ACTIVA (`activeTotal`) de HISTÓRICA
(`historicalTotal`) contra una cota (`activeBound`) — nunca un único
contador ambiguo. Sobre 10 temporadas simuladas la población activa se
mantiene acotada (379 activos finales sobre una cota de 1140, partiendo de
458) pese a que el histórico mundial crece a 1538 — la cantera + retirada +
salida de la vía profesional compensan la entrada.

**Nota posterior (WORLD-CORE-1, sección 10.8):** `external-abstract` sigue
siendo, en esta entrega, un NIVEL DE SIMULACIÓN transitorio (nadie lo ocupa
todavía, no existen plantillas extranjeras) — nunca un tipo de club
distinto ontológicamente. WORLD-SIM-1 lo sustituirá por clubes/equipos
NORMALES del mismo modelo mundial con un nivel de detalle `abstract`, no por
una segunda clase de entidad.

#### Interfaz — pantalla "Planificación" (`src/ui/game.js`)

Nueva pantalla (`renderCycleScreen()`, entre Mercado y Agenda en `SCREENS`)
con acciones REALES, no solo lectura: legalidad de plantilla del club del
usuario (con botón "Delegar medidas de emergencia" — consentimiento
EXPLÍCITO, ver bug de consentimiento más abajo), contratos que vencen con
"Proponer renovación" real (`runRenewalNegotiation()` → `RenewalService`),
Academia con "Promocionar" real (`AcademyService.promoteToFirstTeam()`),
y retiradas anunciadas de la propia plantilla. Al cerrar temporada,
`closeSeasonAndPrepareNext()` YA NO salta directo a la siguiente liga:
pasa por el ciclo real fase a fase; si alguna fase deja un club NOT READY,
la partida se detiene en la pantalla "Planificación" con el diagnóstico
real, nunca en silencio ni con un año que avanza a medias (invariante 26).

#### Bugs encontrados y corregidos durante esta entrega

- **BUG-LOAN1-01 (estabilizado)**: `CpuLineup.buildCpuLineup()` ya
  devolvía un `outcome` tipado (`'legal'|'medical-exception'|'infeasible'`)
  usando `SquadEligibilityService` en vez de caer al selector no regulado
  — verificado con pruebas dirigidas, no solo revisado por inspección.
- **BUG-CYCLE1-01..02 (reloj de sistema)**: generación de edad y fecha de
  nacimiento de newgens ya usaban `CareerAge`/semilla determinista en vez
  de `Date.now()`/`Math.random()` — verificado con una prueba de dos
  cohortes (2026 y 2036) que produce la MISMA distribución de edades
  relativa a la fecha de referencia explícita.
- **BUG-CYCLE1-03 (mutación en render, NO corregida en el punto de partida
  de esta sesión pese a estar documentada como resuelta)**: `renderPlayer
  ProfileScreen()` seguía llamando a `BM.ensureCareerHistory(...)` cada vez
  que se abría una ficha — confirmado con `git diff` contra la base de la
  entrega, era código heredado sin tocar. Corregido eliminando la llamada:
  el render ahora es puro (`const ch = player.careerHistory`), con
  degradación visible si de verdad falta el histórico, en vez de crearlo
  como efecto secundario de mirar una pantalla.
- **BUG-CYCLE1-04 (mundo de plantilla ilegal)**: consentimiento del
  usuario para delegar medidas de emergencia estaba correctamente resuelto
  en el CORE (`AnnualCycleService.auditAllClubs({..., delegate
  EmergencyForUserClub})`) pero `game.js` lo llamaba con `true` fijo,
  saltándose el consentimiento real. Corregido a `false` + botón explícito
  "Delegar medidas de emergencia" en la pantalla Planificación.
- **BUG-CYCLE1-05 (cierre de temporada monolítico)**: retirado — sustituido
  por el ciclo real de 13 fases (ver arriba).
- **Deriva de legalidad a mitad de temporada** (no numerada en el prompt
  original, encontrada en la prueba de humo de 10 temporadas): la
  auditoría de legalidad solo corría una vez, al principio de temporada;
  un club podía volverse ilegal más tarde sin ningún evento explícito
  (reclasificación de formación por edad). Corregido con reintento de la
  MISMA escalera de emergencia en el momento de construir cada
  convocatoria (`selfHealClubLegality`, compartido por `game.js` y todos
  los arneses de prueba vía `scripts/cycle1-harness.js`) antes de declarar
  infeasibilidad — nunca relajando la comprobación del acta.
- **`TransferRegistry.validateIntegrity()` no reconocía las nuevas vías
  legítimas de cambio de `player.teamId` sin `TransactionRecord`**
  (expiración orgánica de contrato, alta de emergencia de plantilla) —
  ampliada la excepción existente ("sin contrato activo") a
  `explainedByCurrentContract` (el `clubId` del contrato VIGENTE del
  jugador coincide con `player.teamId`, o ambos son `null`), que subsume y
  reemplaza la excepción anterior más estrecha.
- **Bug propio de esta sesión** (nunca publicado): la primera versión de
  `selfHealClubLegality` comprobaba `healed.actions.length` en vez de
  `healed.resolved` para decidir si el reintento tuvo éxito — un intento
  fallido también empuja a `actions`. Corregido en `cycle1-harness.js` y
  en `smoke-loan1.js` antes de cualquier ejecución reportada como buena.

#### Limitación conocida y documentada (no oculta)

El clearinghouse CPU de esta entrega decide renovación, fichaje de agente
libre y promoción de cantera de forma determinista, pero **no abre
traspasos ni cesiones CPU-a-CPU orgánicos** entre clubes fuera de las
acciones que el usuario dirige por Mercado (MARKET-1/TRANSFER-1/LOAN-1).
Es una limitación de alcance real de esta entrega, no un bug — se declara
aquí explícitamente en vez de simular una cobertura de mercado CPU que no
existe. Cualquier sesión futura que quiera cerrar esta brecha debe
proponerlo primero (no está en `DESIGN.md` hasta ahora) y seguir el mismo
patrón de dos fases (`CpuRosterPlanner` puro + `runClearingRounds`
determinista) ya establecido aquí.

#### Prueba de humo — 10 temporadas + determinismo (`scripts/smoke-cycle1.js`)

36 equipos reales, 10 temporadas completas (Liga+Copa+Playoffs+Ascenso+
ciclo anual completo cada una). Cifras reales de la última ejecución
verificada:

- Jugadores mundiales (histórico): 458 → 1538 · Contratos (histórico): 1981
- Expiraciones orgánicas de contrato: 1629 · Renovaciones comprometidas: 172
- Casos de tanteo abiertos orgánicamente: 788
- Retiradas anunciadas / efectivas: 116 / 112
- Pertenencias de academia (histórico): 1080 · Salidas de la vía
  profesional: 1047
- Acciones de emergencia de plantilla: 854
- Actas de partido registradas: 13182
- Población ACTIVA final: 379 (cota 1140) — por categoría:
  `{"senior-service-roster":324,"academy":26,"free-agent":29,
  "external-abstract":0,"retired":112,"left-professional-pathway":1047}`
- Determinismo: misma semilla + misma entrada → decisiones IDÉNTICAS;
  misma semilla + clubes/jugadores barajados → decisiones EQUIVALENTES;
  semilla de carrera distinta → decisiones distintas (verificado con
  triple ejecución).

#### Archivos nuevos

`src/entities/Cycle.js`, `src/core/CycleConfig.js`,
`src/core/CycleEventTypes.js`, `src/core/CycleTransaction.js`,
`src/core/AnnualCycleRegistry.js`, `src/core/AnnualCycleService.js`,
`src/core/AcademyRegistry.js`, `src/core/AcademyService.js`,
`src/core/ContractExpiryService.js`, `src/core/RenewalService.js`,
`src/core/RetirementService.js`, `src/core/RosterLegalityService.js`,
`src/core/CpuRosterPlanner.js`, `src/core/MarketClearinghouse.js`
(ejecuta las propuestas ganadoras de `CpuRosterPlanner` por rondas
deterministas, SOLO vía `RenewalService`/`TransferService.
formalizeFreeAgentSigning`/`AcademyService.promoteToFirstTeam` — nunca
escribe directamente en un registro ajeno "para simplificar"),
`src/core/SeasonHistoryService.js` (cierre deportivo de temporada —
ascensos/descensos, honores, cierre de histórico de carrera y evidencia
del último partido oficial por club — extraído del monolito original de
`game.js` sin cambiar ningún resultado, consumido tanto por la interfaz
como por todos los arneses de prueba), `src/core/WorldLifecycleService.js`,
`src/utils/CareerAge.js`, `scripts/cycle1-harness.js` (arnés compartido de
transición anual, reutilizado por todos los scripts de prueba de la EPIC),
`scripts/test-cycle1.js` (42 comprobaciones), `scripts/smoke-cycle1.js`
(36 equipos, 10 temporadas — cifras arriba), `scripts/verify-cycle1-
playwright.js` (19 comprobaciones × desktop+mobile).

#### Fuera de alcance de CYCLE-1

Transfer internacional real y licencia FIBA para la operación — **EUROPE-1**;
traspasos/cesiones CPU-a-CPU orgánicos fuera del clearinghouse de agentes
libres (ver limitación conocida arriba) — sin entrega asignada todavía,
proponer antes de construir; save/load real y congelación de reglas por
versión de una temporada ya iniciada — **HARDEN-1**.

_Migrado de `CLAUDE.md` (líneas 693-808 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### Ciclo anual: expiración, renovación, retirada, cantera y clearinghouse (CYCLE-1, DESIGN.md 9.22)

Convenciones permanentes de CYCLE-1 — aplican a toda sesión futura que
toque el cierre de temporada, expiración/renovación de contratos, opciones
contractuales, apertura de tanteo, retirada de jugadores, cantera/academia,
legalidad de plantilla, planificación CPU o el clearinghouse anual, y a
EUROPE-1/HARDEN-1 cuando construyan sobre esta entrega:

- El cierre de temporada NUNCA vuelve a ser un monolito directo
  (ascender/descender → resembrar inscripciones a mano →
  `team.generateAcademyIntake(N, fecha)` en los 36 clubes → sustituir el
  `Calendar`). Todo cierre real pasa por `AnnualCycleService.runPhase()` en
  el orden fijo de `CycleConfig.CYCLE_PHASES` (13 fases) — nunca una copia
  local del ciclo. `game.js` y CUALQUIER script de prueba usan el mismo
  arnés compartido `scripts/cycle1-harness.js`
  (`collectSeasonEvidence()`/`runAnnualCycleTransition()`) — nunca su
  propio atajo de transición de temporada copiado.
- `state.annualCycleRegistry`/`state.academyRegistry`
  (`src/core/AnnualCycleRegistry.js`/`src/core/AcademyRegistry.js`) son las
  fuentes CANÓNICAS del ciclo — instancias EXPLÍCITAS por carrera (creadas
  en `startSeason()`), nunca singletons.
- El suelo `MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` de CONTRACT-1 está
  RETIRADO — los contratos expiran orgánicamente
  (`ContractExpiryService`). Código nuevo nunca asume que un contrato
  sobrevive sin cambios de una temporada a la siguiente.
- `AnnualRosterCycle`/`ClubCycleCase`/`RenewalCase`/`ContractOptionDecision`
  (`src/entities/Cycle.js`) son máquinas de estados por EVENTOS en el orden
  fijo declarado — nunca un campo de estado mutable libre. Un id de evento
  duplicado LANZA una colisión descriptiva, nunca un no-op silencioso. Un
  terminal nunca vuelve a un estado vivo.
- **Legalidad de plantilla es una propiedad VIVA, no solo de arranque de
  temporada**: un roster legal al empezar la temporada puede volverse
  ilegal a mitad de temporada sin ningún evento explícito de cambio de
  plantilla (ejemplo real: un jugador cruza un umbral de edad y deja de
  contar como "de formación"). La construcción de convocatoria para
  CUALQUIER partido (usuario o CPU) reintenta la MISMA escalera de
  emergencia (`RosterLegalityService.applyEmergencyLadder()`,
  `resolved` — NUNCA `actions.length` — es la señal de éxito) antes de
  declarar infeasibilidad — nunca cae a un selector no regulado. El mismo
  reintento (`selfHealClubLegality` en `cycle1-harness.js`) es obligatorio
  en cualquier arnés de prueba nuevo que construya convocatorias CPU a lo
  largo de varias temporadas.
- Dos vías LEGÍTIMAS de cambio de `player.teamId` sin ningún
  `TransactionRecord` en `TransferRegistry`: expiración orgánica de
  contrato (agente libre) y alta de emergencia de plantilla
  (`RosterLegalityService.signPlayerForEmergency()`, que llama a
  `RosterMutationService.transferPlayer()` DIRECTAMENTE). Cualquier
  comprobación de integridad nueva sobre `TransferRegistry`/roster debe
  contemplar ambas — `TransferRegistry.validateIntegrity()` ya lo hace vía
  `explainedByCurrentContract` (el `clubId` del contrato VIGENTE coincide
  con `player.teamId`, o ambos son `null`).
- La cantera/academia YA NO entra directamente a `Team.roster` por el
  intake anual (BUG-CYCLE1-05, retirado) — vive como pool separado en
  `AcademyRegistry` (`AcademyService.runAnnualIntake()`, cupo real vía
  `CycleConfig.ACADEMY`). Solo `AcademyService.promoteToFirstTeam()` mueve
  a un académico al roster real, vía `Team.addPlayer()`/
  `RosterMutationService` — nunca como efecto colateral del intake.
  `promoteToFirstTeam()` LANZA en fallo (nunca devuelve
  `{succeeded:false}`) — cualquier botón de UI que la llame usa
  try/catch, nunca comprueba un campo de éxito.
- `RetirementService` decide retirada usando SOLO señales VISIBLES
  (tendencia de TMB, carga médica, minutos recientes, edad) — **nunca
  Potencial oculto** (auditado estáticamente en `test-cycle1.js`), y
  SIEMPRE de forma determinista dada una `careerSeed` explícita. Un
  jugador retirado sale de `Team.roster` pero permanece SIEMPRE
  localizable en el Player Registry — nunca desaparece del histórico.
- `CpuRosterPlanner` es PURO (nunca muta, nunca llama a un registro
  directamente) y ORDEN-INDEPENDIENTE (mismo resultado con
  clubes/jugadores barajados) — auditado estáticamente. `runClearingRounds()`
  ejecuta la asignación determinista sobre esos planes.
  **Limitación de alcance conocida y documentada, no oculta**: el
  clearinghouse de CYCLE-1 resuelve renovación, fichaje de agente libre y
  promoción de cantera — NO abre traspasos ni cesiones CPU-a-CPU orgánicos
  entre clubes (esos siguen siendo solo acciones dirigidas por el usuario
  vía Mercado, TRANSFER-1/LOAN-1). Cualquier sesión futura que quiera
  cerrar esa brecha debe proponerlo primero (no está en `DESIGN.md`) y
  seguir el mismo patrón de dos fases (planificador puro + ronda de
  clearing determinista) ya establecido aquí — nunca un motor de mercado
  CPU paralelo.
- `WorldLifecycleService.initializePlayerLifecycle()` sigue siendo el
  ÚNICO punto de inicialización real por jugador (desarrollo + estado
  médico + histórico de carrera + perfil de retirada + procedencia) —
  llamado en el sweep de arranque de carrera, en
  `AcademyService.runAnnualIntake()` y en la generación de emergencia de
  `RosterLegalityService`. **Los renders de `src/ui/game.js` NUNCA lo
  llaman ni llaman a ninguna de las funciones `ensure*` que envuelve**
  (BUG-CYCLE1-03) — auditado estáticamente en `test-cycle1.js`; un render
  que necesita datos de un jugador que en teoría siempre debería tenerlos
  ya inicializados degrada visiblemente en vez de inicializar como efecto
  secundario de abrir una pantalla.
- `describePopulation()` distingue SIEMPRE población ACTIVA
  (`activeTotal`) de HISTÓRICA (`historicalTotal`) contra una cota
  (`activeBound`) — nunca un único contador ambiguo.
- Toda generación nueva (edad, fecha de nacimiento, decisiones CPU,
  retirada) es DETERMINISTA dada una `careerSeed`/`referenceDate`
  explícitas (`CareerAge.js`, `DeterministicRandom.js`) — nunca
  `Math.random()`/`Date.now()`/`new Date()` dentro del motor del ciclo
  (auditado estáticamente).
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217;
  fechas SIEMPRE civiles ISO vía `LocalDate` — mismo criterio que
  CONTRACT-1/MARKET-1/TRANSFER-1/LOAN-1.
- El consentimiento del usuario para delegar medidas de emergencia sobre
  SU PROPIO club (`delegateEmergencyForUserClub`) nunca se asume `true`
  por defecto desde un call-site de `game.js` — el CORE
  (`AnnualCycleService.auditAllClubs()`) ya lo respeta correctamente; un
  call-site que lo fuerce a `true` sin pasar por el botón real "Delegar
  medidas de emergencia" de la pantalla Planificación es un bug de
  consentimiento (BUG-CYCLE1-04, ya corregido una vez — no reintroducirlo).
- No se ejecuta transfer internacional real ni licencia FIBA para la
  operación (EUROPE-1), ni save/load real con congelación de reglas por
  versión de una temporada ya iniciada (HARDEN-1) antes de sus entregas —
  CYCLE-1 se detiene en el ámbito doméstico verificable con el clearinghouse
  descrito arriba.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura del ciclo anual o las reglas activas.
