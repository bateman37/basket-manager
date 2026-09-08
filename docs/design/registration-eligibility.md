# Inscripción, licencias y elegibilidad (REG-1)

_Migrado de `DESIGN.md` (líneas 5942-6338 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.18 REG-1 — Inscripción, licencias, elegibilidad, cupos y vinculados

Tercera entrega de la **EPIC "Ciclo profesional de plantilla"** (roadmap de
nueve partes en 9.16). ROSTER-1 dio identidad mundial; CONTRACT-1 creó la
relación laboral; **REG-1 añade el eje FEDERATIVO**: licencia, inscripción
por competición, elegibilidad de partido, cupos colectivos (formación/no
comunitarios/acumulado), jugadores propios de categoría inferior y
vinculados, y el acta de partido — todo separado de identidad, afiliación y
contrato.

```text
identidad != afiliación != contrato laboral != licencia/inscripción
          != elegibilidad de partido != autorización internacional
```

Un contrato **nunca** concede licencia ni inscripción; una licencia **no**
sustituye al contrato; la afiliación de plantilla (`Team.roster`) y el
registro/licencia por competición son conceptos separados. En esta entrega
la pantalla **Inscripciones** y la pestaña **Licencia y elegibilidad** son
de **SOLO LECTURA** — sin alta, baja, suspensión, vinculación, fichaje,
renovación, cesión, tanteo ni transfer (MARKET-1/TRANSFER-1/LOAN-1/
EUROPE-1).

#### Bugs corregidos de CONTRACT-1

- **BUG-CONTRACT1-01 — máximo de convocatoria hardcodeado a 12.** La tabla
  de "Alineación por posición" y `toggleSquadMember()` usaban un `12`
  literal como tope de selección para CUALQUIER competición. Ahora el
  máximo (y el mínimo) proceden siempre de
  `resolveTeamSquadRules(team)`/`resolved.squadRules`, resuelto para la
  competición y fecha REALES del próximo partido — ACB muestra 8-12,
  Primera FEB 10-12, y una competición de test-fixture (`reference-only-
  max-act-9-v1`, ver más abajo) mostraría 9 sin tocar código.
- **BUG-CONTRACT1-02 — reglas resueltas por `team.division` + reloj
  global.** `resolveTeamSquadRules()` leía `state.calendar.
  currentGameDateTime` y `team.division` dentro del propio resolver, así
  que dos llamadas en el mismo instante para partidos de fases distintas
  (liga visible vs. Copa/Playoff de fondo) podían devolver una fecha o
  fase incorrecta. Se introduce `buildMatchCompetitionContext(team,
  options)` como **único adaptador de frontera** que exige `options.date`
  explícita (lanza si falta) y expone `phaseId`/`roundId`/`matchId`
  declarados por quien conoce el partido real — nunca leídos de un reloj
  global ni adivinados con un literal `'bracket'` genérico.
- **BUG-CONTRACT1-03 — el fallback legacy 8-12 de `Team.buildMatchSquad()`
  seguía siendo alcanzable desde producción.** Sin `minOverride`/
  `maxOverride` explícitos, el método reproducía en silencio el rango
  universal antiguo. Ahora **exige** ambos parámetros (lanza si faltan);
  el único lugar que reproduce el comportamiento legacy es la red de
  seguridad **explícita** de `CpuLineup.js` cuando la selección regulada es
  matemáticamente infeasible, usando la constante nombrada
  `TEST_MATCH_SQUAD_POLICY` (documentada como política de TEST, no un
  segundo origen de verdad).

#### Bugs encontrados y corregidos durante esta entrega (BUG-REG1-\*)

Ninguno de estos cinco bugs lo detectaron los tests unitarios aislados —
los cuatro primeros solo aparecieron simulando **temporadas completas**
(`smoke-reg1.js`, 36 clubes reales × 3 temporadas) y el quinto solo en
**verificación de interfaz real** (`verify-reg1-playwright.js`), motivo por
el que ambos pasos son obligatorios en esta EPIC y no opcionales:

- **BUG-REG1-01 — el cierre de temporada expiraba inscripciones recorriendo
  `Team.roster`.** Un propio de categoría inferior (`teamId === null`, sin
  equipo `Team` que lo modele) o un vinculado (afiliado a SU club de
  origen, nunca al beneficiario) nunca aparecen en `Team.roster` — el
  barrido de cierre de temporada, escrito recorriendo plantillas, los
  dejaba huérfanos: su LICENCIA expiraba (búsqueda por jugador, sin
  ámbito) pero su INSCRIPCIÓN quedaba "activa" para siempre.
  `RegistrationRegistry.validateIntegrity()` lo detectó tras el primer
  cierre de temporada del smoke. Corregido: `expireRegistrationsForSeasonClose()`
  (game.js) y su equivalente del smoke recorren ahora el **REGISTRO**
  (`registrationsForScope(scopeId)` filtrado por `seasonKey`), nunca
  `team.roster`.
- **BUG-REG1-02 — un newgen podía reclasificarse a sí mismo por encima del
  cupo ya congelado del club.** `seedRegistrationForNewPlayer()` sin
  `existingClassification` recalculaba `classifyRosterForClub()` sobre el
  roster YA AMPLIADO con los newgens de ese cierre — un sorteo
  independiente de formación/no comunitario que podía "robar" una plaza ya
  concedida a un senior cuya inscripción había quedado **congelada** en la
  re-siembra masiva del mismo cierre, produciendo más no comunitarios de
  los permitidos (visto en jornada 1 de una temporada nueva:
  `NON_COMMUNITY_CAP_EXCEEDED` con actual=3/máximo=2). Corregido: la
  clasificación del intake de cantera se calcula **una sola vez por club**,
  ANTES de `generateAcademyIntake()`, sobre el mismo roster senior que
  acaba de usar la re-siembra masiva — un newgen nunca dispara su propio
  sorteo.
- **BUG-REG1-03 — actas de bracket con `roundId: null` fijo y `matchId`
  dependiente de local/visitante.** Copa/Playoff/Ascenso usaban
  `roundId: null` siempre (por eso `EligibilityService` nunca ejecutaba la
  comprobación de doble acta con brackets — la condición de guarda salta
  cuando `roundId == null`), y el `matchId` que sí se generaba variaba
  entre partidos de una misma serie a mejor de N cuando la sede local
  alternaba, rompiendo la exclusión de "esta misma acta" del propio
  jugador. Además, `drainBackgroundBrackets()` (división de fondo)
  reutilizaba un único resolver para Copa/Playoff/Ascenso etiquetando
  SIEMPRE `phaseId: 'cup'`, aunque el bracket en curso fuera el Playoff o
  el Ascenso. Corregido: `currentBracketRoundKey(phaseId, bracket)` deriva
  un `roundId` real (`{phase}:round-N`, o `{phase}:quarterfinals-N` /
  `{phase}:finalfour-N` para `PromotionPlayoff`, que compone dos
  `Bracket`), y `matchId` se construye con los ids de equipo en orden
  **canónico** (ordenados, nunca home/away). `resolveBracketOptionsFor(bracket,
  phaseId)` sustituye al resolver fijo, declarado por quien conoce el
  bracket y fase reales en cada llamada.
- **BUG-REG1-04 — la comprobación de doble acta no incluía la temporada.**
  `playerAlreadyOnActThisRound()`/`validateIntegrity()` agrupaban por
  `registrationScopeId + roundId` — como la jornada de Liga (`match.round`)
  y el índice de ronda de un bracket se reinician cada temporada, la
  jornada 1 de una temporada nueva colisionaba con la jornada 1 de la
  anterior: cualquier jugador que hubiera jugado esa jornada el año pasado
  aparecía "ya convocado" en la primera jornada de TODAS las temporadas
  futuras. Corregido añadiendo `seasonKey` a ambas claves.
- **BUG-REG1-05 — una inscripción suspendida era indistinguible de "nunca
  inscrito".** `RegistrationRegistry.currentRegistration()` (deliberadamente
  solo-activas, pensada para "¿puede jugar AHORA?") era también la única
  consulta que usaban `EligibilityService`/la pantalla de Inscripciones
  para decidir el motivo de no-elegibilidad: al filtrar por activa ANTES
  de que nadie pudiera leer `statusOn()`, el código de motivo
  `REGISTRATION_SUSPENDED` era papel muerto — inalcanzable — y un jugador
  sancionado mostraba "sin inscripción en este ámbito" en vez de
  "inscripción suspendida". Detectado con un fixture dirigido en
  `verify-reg1-playwright.js` (sanción disciplinaria de un jugador
  cualquiera de la convocatoria), no por ningún test unitario aislado.
  Corregido con un nuevo método `registrationForScopeSeason()` (cualquier
  estado) que usan `EligibilityService` y la pantalla de Inscripciones para
  diagnóstico, dejando `currentRegistration()` sin cambios para quien
  necesita "activa ahora mismo" (pool/selección de convocatoria).

Además, el cupo acumulado de la temporada (`cumulativeRegistrationCap`) sí
funciona como estaba previsto pero puede **agotarse legítimamente** tras
varias temporadas de cantera sin ningún sistema de baja/retirada todavía
(CYCLE-1, sección 9.16, "equilibrio de población" — fuera de alcance de
REG-1 en su momento; **CYCLE-1 lo cubre ahora**, ver 9.22, con retirada
individual determinista y salida de la vía profesional acotando la
población activa): `RegistrationService.createRegistration()` sigue
rechazando con
excepción dura a cualquier llamador que no compruebe antes (API estricta,
nunca inventa un cupo mayor), pero el seeder de mejor esfuerzo comprueba el
cupo ANTES de llamar y, si está agotado, **degrada con gracia**: el newgen
recibe perfil y licencia (puede entrenar/tener contrato) pero su
inscripción de competición queda diferida hasta que exista un mercado real
o un sistema de bajas. Verificado en el smoke de 3 temporadas (43
inscripciones diferidas sobre 324 newgens, ninguna caída del proceso).

**Nota de transparencia (no es un bug de REG-1):** verificando el motor con
alineaciones realistas se confirmó de forma incidental, comparando contra
la rama base con `git stash`, un bug PREEXISTENTE en `Tactics.js`
(`computeAdvantageScore` lanza si dos slots de la misma alineación
comparten el mismo jugador — una alineación degenerada, nunca producida
por `CpuLineup.js` ni por la pantalla de Alineación real). Reproducible,
data-dependiente, no relacionado con REG-1; no se ha tocado `Tactics.js`
(explícitamente fuera de alcance de esta entrega) — señalado aquí para que
una sesión futura lo repare si procede.

#### Separación conceptual y contexto de partido explícito

Seis conceptos permanecen deliberadamente distintos, cada uno con su propio
almacén y su propio ciclo de vida: **identidad** (`PlayerRegistry`),
**afiliación** (`Team.roster`), **contrato** (`ContractRegistry`),
**licencia federativa** (`FederationLicense`, por jugador+temporada),
**inscripción de competición** (`CompetitionRegistration`, por
jugador+ámbito+temporada) y **acta de partido** (`MatchActSnapshot`, por
partido+equipo). Un `ClubLinkAgreement` autoriza a un club a convocar a un
jugador de otro club sin mover ninguno de los seis almacenes anteriores.

Todo servicio de este dominio recibe un **contexto de partido explícito**
— `{competitionId, competitionInstanceId, registrationScopeId, seasonKey,
date, phaseId, roundId, matchId, operation}` — construido por quien conoce
el partido real (`buildMatchCompetitionContext()` en game.js). Ningún
servicio de `src/core/` lee `state`, el DOM ni un reloj global.
`registrationScopeId` es un dato **declarado** en cada `RulesetBundle`
(nunca deducido): ACB comparte un único ámbito entre Liga, Copa y Playoff
por el título; Primera FEB tiene el suyo propio.

#### Entidades, servicios y máquina de estados

`src/entities/Registration.js`: `FederationLicense`, `CompetitionRegistration`
(`accessCategory` ∈ senior/own-lower-category/linked/additional-list, con
`classificationSnapshot` **inmutable** en el momento del alta),
`ClubLinkAgreement`, `MatchActSnapshot` (idempotente por id),
`PlayerRegulatoryProfile`. `RegistrationEventTypes.js` modela el estado
como una **unión discriminada con máquina de estados**
(submitted→validated→provisionally-authorized/activated→suspended/
deactivated/expired, más `document-corrected` como evento evidencial que no
cambia el estado) — nunca un booleano ni un campo mutado a mano.
`RegistrationRegistry.js` es el registro CANÓNICO, indexado por
jugador/club/ámbito/competición, con `cumulativeCountForClub()`,
`linkAgreementsAsBeneficiary()`, `playerAlreadyOnActThisRound()` (ahora
también por `seasonKey`, BUG-REG1-04), `registerMatchAct()` idempotente y
`validateIntegrity()`.

`RegistrationService.js` implementa los comandos (`issueLicense`,
`createRegistration`, `advanceRegistrationEvent`, `suspendRegistrationForStatus`
— exige un motivo declarado por el módulo resuelto, nunca libre —,
`createLinkAgreement`, `evaluateSubmissionWindow`, `checkMandatoryDocuments`,
`determineCumulativeCapImpact`/`assertCumulativeCapNotExceeded`).
`RegulatoryClassificationService.js` resuelve formación/no-comunitario:
primero comprueba si el perfil del jugador declara una
`organizerApprovedClassification` para esa competición+temporada (la vía
REAL en cualquier competición con datos simulados/aprobados) y solo cae al
cómputo real del art. 28 FEB cuando no hay override Y la competición es
Primera FEB — nunca reutiliza una clasificación de una competición en otra.
`EligibilityService.js` evalúa a UN jugador con 18 códigos de motivo
estables (licencia/inscripción/contrato/clasificación/vinculación/doble
acta/médico/disciplinario) — el mismo servicio para usuario y CPU.
`SquadEligibilityService.js` valida el CONJUNTO (`validateSquad`) y
selecciona por restricciones (`selectLegalSquad`, dos reparaciones:
formación primero, no comunitarios después, desempate determinista por
`playerId`) — nunca decide posición/rotación, eso sigue en `CpuLineup.js`.

#### Reglas reales de ACB y Primera FEB (con fuente oficial)

Ambos módulos de `CompetitionRules.js` (`acb-registration-2025-26-v1`,
`primera-feb-registration-2026-27-v1`) declaran: plantilla activa vs. rango
de acta (ACB 8-12, Primera FEB 10-12, distintos entre sí), bandas de cupo
de formación por tamaño de acta, máximo de no comunitarios, máximo
acumulado de la temporada (con categorías exentas), ventanas de
presentación (evaluables con `RegulatoryCalendar.js`, nunca festivos
inventados), plazos finales, documentos exigidos, política de autorización
provisional, reglas de jugadores propios/vinculados,
`sameRoundMultiClubRestrictions`, `statusRestrictions` (motivos de baja
declarados) y **solo Primera FEB** declara `onCourtConstraints:
{minFormationOnCourtAtAllTimes: 2}` — la restricción "2 de formación en
pista en todo momento" no existe en ACB, y la capacidad derivada
(`onCourtFormationQuota`) refleja exactamente esa asimetría. Cada módulo
lleva `sourceRefs` (ACB — Normas Internas 2025-26; FEB — Bases de
Competición/Reglamento General/Manual de Competiciones 2026-27) y
`knownSourceInconsistencies` (tres, para Primera FEB) — inconsistencias
REALES entre documentos oficiales, señaladas explícitamente en vez de
resueltas por criterio propio.

Cuatro módulos **`reference-only`** (acta máxima 9, máximo 1 no
comunitario, desarrollo U22 12-20/25, ámbito internacional) demuestran que
el motor soporta otra competición sin tocar código — nunca se autoseleccionan
sin fijarlos explícitamente (`pinnedModuleIds`), y ningún bundle real los
usa.

#### Formación, no comunitarios, propios y vinculados

La clasificación de formación/no-comunitario es **contextual**: se resuelve
por competición+temporada+fecha, nunca es un atributo universal del
jugador (`player.isHomegrown` sigue prohibido, auditado estáticamente). Un
propio de categoría inferior (`accessCategory: 'own-lower-category'`) no
computa para el máximo acumulado y, al no existir todavía una entidad
`Team` para equipos de cantera/inferiores en este motor, es un jugador
**sin afiliación senior** (`teamId === null`) — nunca un id de equipo
inventado. Un vinculado conserva su afiliación y contrato REALES con su
club de origen; el `ClubLinkAgreement` solo autoriza su convocatoria por el
club beneficiario (`accessCategory: 'linked'`, inscripción de partido a
nombre del beneficiario) sin mover ni `player.teamId` ni `Team.roster` — y
es ineficaz si origen y beneficiario compiten en la misma competición
(sección real de vinculación). El pool regulado de un partido
(`buildEligiblePoolForMatch`) es siempre **senior + propios + vinculados
autorizados**, cada uno evaluado por el mismo `EligibilityService` — nunca
solo `team.roster`.

#### Bootstrap determinista y honestidad de los datos

`RegistrationSeeder.js` es 100% determinista (hash FNV-1a de
`playerId|clubId|seasonKey|generatorVersion`, sin `Math.random`, sin
inferir ciudadanía/formación por nombre o apellido) y garantiza que los 36
clubes reales arrancan con una solución legal (margen de +2 sobre la banda
más exigente de formación, cuenta de no comunitarios variada por club
dentro de su máximo). Todo dato generado lleva
`dataSource: 'simulated-registration-v1'`, `isReal: false` y el aviso "no
son datos federativos reales" — visible en la pantalla de Inscripciones,
en la pestaña de la ficha y en cada badge "Simulado". Si no hay cobertura
real para un jugador/club, se usa el generador ficticio y se señala — nunca
se presenta un dato inventado como oficial.

#### Integración con el partido, la CPU, la rotación y el acta

La CPU consulta **exactamente** `EligibilityService`/`SquadEligibilityService`
sobre el pool regulado — nunca un "los 12 mejores" greedy que ignore un
cupo. Cuando no existe solución legal (crisis médica real que deje al club
sin margen de formación o por debajo del máximo no comunitario — sin
excepción oficial declarada para estos dos cupos, a diferencia del mínimo
de convocatoria, ver más abajo), `CpuLineup.js` lo diagnostica
(`selection.ok: false` con código estructurado), avisa explícitamente y
cae a un selector legacy sobre `team.roster` como red de seguridad — nunca
bloquea la simulación ni finge una convocatoria legal. Verificado como
**raro** (<1% de las actas) sobre 3 temporadas completas de 36 clubes.

La **excepción médica de convocatoria** (mínimo normal reducido hasta el
absoluto de 5 por escasez médica real, sección 9.14/9.16) se propaga ahora
también a `SquadEligibilityService.validateSquad()`
(`options.effectiveMin`) — sin este dato el acta exigía el mínimo normal
incluso en una crisis médica genuina, y `game.js`/`CpuLineup.js`/el smoke
calculan el mismo `effectiveMin` que ya usaban para construir la
convocatoria.

Primera FEB exige **2 de formación en pista en todo momento**
(titular/suplente 1/suplente 2, cruzando las 5 posiciones) —
`Rotation.validateOnCourtFormationQuota()` (función pura) lo valida y
`CpuLineup.enforceOnCourtFormationQuota()` lo repara determinísticamente
(sustituye al no-formación de peor calidad por un formación disponible del
mismo `squad`); ACB, sin esa capacidad declarada, no ejecuta ninguna
comprobación. Cada acta (`MatchActSnapshot`) se registra de forma
**idempotente** justo antes de entregar la convocatoria a `MatchEngine`
— nunca se decide normativa dentro del motor de partido.

#### Temporada, ascensos y descensos

Al cierre de temporada: expiran por evento las licencias/inscripciones de
la temporada que TERMINA (recorriendo el REGISTRO por ámbito, BUG-REG1-01
— nunca `team.roster`), se resiembra el ámbito nuevo para la plantilla YA
en su división actualizada, y la cantera recibe licencia/inscripción
propias tras su contrato (clasificación calculada UNA vez por club antes
del intake, BUG-REG1-02). Un ascenso/descenso nunca reescribe la
clasificación congelada de una inscripción ya existente.

#### Interfaz

Pantalla **Inscripciones** (solo lectura): ámbito y normativa aplicable
(competición, ámbito de inscripción, rango de plantilla activa, rango de
acta, máximo no comunitarios, regla en pista si aplica), bandas de cupo de
formación, documentos exigidos, fuente/versión del módulo, máximo acumulado
de la temporada con contador real, acuerdos de vinculación, tabla de
jugadores (contrato/licencia/inscripción/estado/clasificación/procedencia/
elegibilidad para el próximo partido) y alertas de integridad. Pestaña
**Licencia y elegibilidad** en la ficha universal: licencia federativa,
tabla de inscripciones con su clasificación (con la nota explícita de que
es contextual), elegibilidad para el próximo partido con motivos legibles,
histórico de licencias. Pantalla de **Alineación**: badges de categoría de
acceso, clasificación (formación/no comunitario), procedencia simulada y
motivo de no-elegibilidad por candidato; contadores en vivo
(seleccionados/mínimo/máximo, formación requerida/actual, no comunitarios
actual/máximo, restricción en pista si existe); un candidato inelegible se
muestra deshabilitado con su motivo, nunca desaparece sin explicación.
Ningún botón de alta/baja/suspensión/vinculación/fichaje/renovación/
cesión/tanteo/transfer en ninguna de las tres superficies. Verificado en
escritorio (1280×900) y móvil (390×844): sin scroll horizontal del
documento.

#### Invariantes verificadas

Ningún jugador con `teamId` no nulo queda fuera de la plantilla de
exactamente un equipo vivo (propios/vinculados usan `teamId === null`/el
club de origen, nunca un id inventado); licencia y contrato son entidades
separadas; una inscripción de partido nunca muta `Team.roster` ni
`player.teamId`; el ámbito de inscripción es siempre el declarado por el
bundle, nunca deducido; una clasificación congelada en el alta no cambia
retroactivamente; el cupo de formación/no comunitarios/acumulado nunca se
supera en un acta válida; doble acta del mismo jugador en la misma
jornada+ámbito+temporada se rechaza, salvo que sea la propia acta en
construcción; una vinculación entre clubes de la misma competición es
ineficaz; una baja/reactivación exige siempre un evento explícito (nunca
automática desde Medical); ninguna clasificación simulada se presenta como
verificada; el seeder es determinista y reproducible; MoraBanc Andorra
resuelve inscripción ACB y contrato AD sin mezclar ejes; una competición
desconocida nunca hereda ACB; `data/real/` no se modifica; toda acta
inválida que llega a producción viene acompañada de un aviso explícito
(nunca una infeasibilidad silenciosa).

#### Pruebas y resultados reales

`scripts/test-reg1.js`: **88 comprobaciones, 0 fallos**, en 11 grupos
(bugs de origen, entidades/registro, clasificación FEB, separación
ACB/FEB, ACB, Primera FEB, reglas y composición, RegulatoryCalendar,
seeder/datos, actas/CPU/rotación, auditorías estáticas de alcance).
`scripts/smoke-reg1.js 3`: 36 clubes reales, **3 temporadas completas**
con Copa+Playoffs+Ascenso+cantera — 754 jugadores mundiales, 753 contratos,
2365 licencias, 2317 inscripciones, 17267 eventos regulatorios, **3966**
actas de partido registradas (17 infeasibilidades médicas conocidas y
avisadas, <1%, nunca silenciosas), 324 newgens contratados/inscritos (43
con inscripción diferida por cupo acumulado agotado, degradación esperada
sin CYCLE-1), fixtures dirigidos de lesión/reactivación y de
propio/vinculado verificados, todos los datos regulatorios simulados
correctamente etiquetados. `scripts/verify-reg1-playwright.js` (escritorio
y móvil sobre `file://`): **TODO OK** en ambos modos, incluyendo el
fixture dirigido que encontró BUG-REG1-05. Regresión sin fallos:
`test-roster1.js` (31 OK), `test-contract1.js` (102 OK), `test-life1..4.js`
(22/28/23/26 OK), `smoke-roster1.js 3`, `smoke-contract1.js 3`.

#### Archivos nuevos

`src/entities/Registration.js`, `src/core/RegistrationEventTypes.js`,
`src/core/RegistrationRegistry.js`, `src/core/RegistrationService.js`,
`src/core/RegulatoryClassificationService.js`,
`src/core/EligibilityService.js`, `src/core/SquadEligibilityService.js`,
`src/core/RegistrationSeeder.js`, `src/utils/RegulatoryCalendar.js`,
`scripts/test-reg1.js`, `scripts/smoke-reg1.js`,
`scripts/verify-reg1-playwright.js`.

#### Fuera de alcance de REG-1

Alta/baja/suspensión/vinculación/fichaje/renovación/cesión/tanteo/
transfer como ACCIONES de usuario, negociación jugador/agente, mercado CPU,
Letter of Clearance y transfer internacional real, sistema de
retiro/liberación de jugadores (CYCLE-1 — el cupo acumulado ya puede
agotarse legítimamente sin él, degradado con gracia; **entregado en
CYCLE-1, ver 9.22**), entidad `Team` para
categorías inferiores/cantera, granularidad por juego individual dentro de
una serie de bracket (se trata toda la serie como una jornada), corrección
del bug preexistente de `Tactics.js` (nota de transparencia más arriba,
ver §"Bugs encontrados"), save/load. Siguiente entrega: **MARKET-1**
(negociación, agentes, libres y derecho de tanteo como procedimiento).

_Migrado de `CLAUDE.md` (líneas 318-395 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### Inscripción, licencias y elegibilidad (REG-1, DESIGN.md 9.18)

- `RegistrationRegistry` (`src/core/RegistrationRegistry.js`,
  `state.registrationRegistry`) es la fuente CANÓNICA de licencias
  (`FederationLicense`), inscripciones (`CompetitionRegistration`),
  acuerdos de vinculación (`ClubLinkAgreement`) y actas de partido
  (`MatchActSnapshot`). Licencia, inscripción, contrato y afiliación de
  plantilla son CUATRO conceptos distintos — un contrato no concede
  licencia ni inscripción, una licencia no sustituye al contrato.
- `currentRegistration(playerId, scope, seasonKey, date)` devuelve SOLO
  inscripciones ACTIVAS ("¿puede jugar ahora?") — para diagnosticar o
  mostrar el motivo real de una no-disponibilidad (suspendida,
  desactivada, expirada) se usa siempre
  `registrationForScopeSeason(playerId, scope, seasonKey)` (cualquier
  estado). Confundir ambas dejó `REGISTRATION_SUSPENDED` como código de
  motivo inalcanzable (BUG-REG1-05) — cualquier consulta nueva que
  necesite explicar POR QUÉ un jugador no está disponible debe usar la
  segunda, nunca la primera.
- La clasificación de formación/no comunitario es CONTEXTUAL (por
  competición+temporada+fecha) — nunca un booleano universal del jugador
  (`player.isHomegrown` y equivalentes están prohibidos y auditados
  estáticamente). Un propio de categoría inferior no tiene equipo `Team`
  que lo modele todavía: es un jugador con `teamId === null` (sin
  afiliación senior), nunca un id de equipo inventado. Un vinculado
  conserva SIEMPRE su afiliación/contrato reales con su club de origen —
  la vinculación solo autoriza su convocatoria por el club beneficiario
  (`accessCategory: 'linked'`), nunca mueve `player.teamId` ni
  `Team.roster`.
- El pool regulado de CUALQUIER partido (usuario o CPU) es
  senior+propios+vinculados evaluados por `EligibilityService` — nunca
  solo `team.roster`. CPU y usuario consultan EXACTAMENTE el mismo
  `EligibilityService`/`SquadEligibilityService`; la CPU selecciona
  convocatoria con `SquadEligibilityService.selectLegalSquad` (reparación
  determinista por restricciones), nunca un greedy "los N mejores" que
  ignore un cupo.
- `roundId`/`matchId` de un acta de bracket (Copa/Playoff/Ascenso) se
  derivan de `currentBracketRoundKey(phaseId, bracket)` (prefijo de fase +
  ronda real, o sub-fase cuartos/Final Four para `PromotionPlayoff`) y de
  los ids de equipo en orden CANÓNICO (ordenados, nunca home/away) — un
  `roundId: null` fijo o un `matchId` sensible al orden local/visitante
  rompe la detección de doble acta entre rondas/temporadas/series
  (BUG-REG1-03). Toda comprobación de "misma jornada" incluye SIEMPRE
  `seasonKey` en la clave (BUG-REG1-04) — la jornada 1 de una temporada
  nunca es la misma jornada que la 1 de otra.
- El cierre de temporada expira licencias/inscripciones recorriendo el
  REGISTRO por ámbito (`registrationsForScope(scopeId)` filtrado por
  `seasonKey`), nunca `Team.roster` — un propio/vinculado no vive ahí
  (BUG-REG1-01). La re-siembra de un nuevo ámbito/temporada se ejecuta
  ANTES del intake de cantera; la clasificación de los newgens de ese
  cierre se calcula UNA sola vez por club (sobre el roster senior previo
  al intake) y se pasa como `existingClassification` a cada newgen —
  nunca un sorteo independiente por jugador, que podía superar el cupo ya
  congelado del club (BUG-REG1-02).
- El cupo acumulado de la temporada (`cumulativeRegistrationCap`) puede
  agotarse legítimamente sin ningún sistema de baja/retirada todavía
  (CYCLE-1). `RegistrationService.createRegistration()` sigue siendo una
  API estricta que rechaza con excepción dura si no se comprueba antes;
  el seeder de mejor esfuerzo comprueba el cupo y, si está agotado,
  degrada con gracia (licencia sí, inscripción de competición diferida)
  en vez de tirar la partida abajo — nunca inventa un cupo mayor.
- La excepción médica de convocatoria (mínimo reducido hasta el absoluto
  por escasez médica real) se propaga a
  `SquadEligibilityService.validateSquad()`/`buildLiveCounters()` vía
  `options.effectiveMin` — sin ese dato el acta exigía el mínimo normal
  incluso en una crisis médica genuina.
- Toda regla real (cupos, ventanas, documentos, vinculación...) incluye
  `sourceRefs` y, cuando las fuentes oficiales se contradicen entre sí,
  se declara en `knownSourceInconsistencies` — nunca se resuelve la
  contradicción por criterio propio sin señalarlo. Los cuatro módulos
  `reference-only` (acta máxima 9, máximo 1 no comunitario, U22, ámbito
  internacional) nunca se autoseleccionan sin fijarlos explícitamente —
  demuestran extensibilidad, no se activan en ninguna partida real.
- No hay alta, baja, suspensión, vinculación, fichaje, renovación, cesión,
  tanteo ni transfer como ACCIONES de usuario antes de sus entregas
  (TRANSFER-1/LOAN-1/EUROPE-1 — MARKET-1 ya añade la NEGOCIACIÓN, pero
  nunca ejecuta el fichaje); la pantalla Inscripciones y la pestaña de la
  ficha son de solo lectura.
