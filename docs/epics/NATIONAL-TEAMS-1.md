# Ficha de Epic — NATIONAL-TEAMS-1 (selecciones y ventanas FIBA)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `NATIONAL-TEAMS-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Selecciones nacionales, elegibilidad de nacionalidad deportiva y ventanas FIBA.
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/national-teams.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 9374-9642 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.17 NATIONAL-TEAMS-1 — resultado

Séptima entrega de la EPIC. Base: merge de la PR de WORLD-SIM-1 en
`origin/main`. Incorpora selecciones nacionales al MISMO mundo, motor de
competiciones, calendario y niveles de detalle ya existentes — no crea un
segundo juego paralelo ni vuelve a colocar España en el centro de la
arquitectura. La vertical de prueba es ficticia y vive únicamente en
`scripts/test-national-teams1.js`/`scripts/smoke-national-teams1.js`; la
partida española sigue teniendo únicamente ACB, Primera FEB y Copa ACB
como Editions jugables, sin ninguna federación/selección/ventana FIBA real
instalada.

#### 10.17.1 `Team` es la entidad deportiva común

`Team` gana `teamKind: 'club-team' | 'national-team'` (`src/entities/
Team.js`). `club-team` (fallback SOLO del constructor aislado de fixtures
legacy) exige `clubId`; `national-team` NUNCA tiene `clubId`/`club` y exige
`federationOrganizationId` (una `Organization` real `type: 'national-
federation'`) y `representedAreaId` (un área real) — ambas comprobaciones
viven tanto en el constructor de `Team` (falla rápido) como en
`WorldRegistries.registerTeam()`/`validateIntegrity()` (BUG-NATIONAL1-01,
antes exigía `clubId` a TODO equipo). `category.gender`/`ageTier` siguen
definiendo categoría — nunca un string que mezcle selección+federación+país.
No existe `NationalTeam` como clase paralela: nombre, roster, categoría,
táctica y participación siguen siendo de `Team`.

#### 10.17.2 Club y selección son afiliaciones simultáneas distintas

`Squad` gana `membershipContext: 'club-service' | 'national-team-duty'`
(`src/entities/Squad.js`, por defecto `'club-service'` — ningún squad
existente cambia de forma). `WorldRegistries.registerSquad()`/
`validateIntegrity()` (BUG-NATIONAL1-03) protegen las invariantes: máximo
un squad activo `club-service` por jugador, máximo uno `national-team-duty`,
ambos pueden coexistir, sigue habiendo máximo un squad activo por `Team`.
`SquadRegistry` gana `activeClubSquadForPlayer()`/
`activeNationalTeamSquadForPlayer()`; `activeSquadForPlayer()` sobrevive
como alias LEGACY documentado de `activeClubSquadForPlayer()` (sus
consumidores anteriores a esta entrega preguntan por afiliación laboral).
`Player.teamId` conserva EXACTAMENTE su significado — espejo del club de
servicio — y ninguna operación de convocatoria lo toca jamás (invariante
73); `Team.addPlayer()`/`removePlayer()` no cambiaron.

#### 10.17.3 El motor común ejecuta selecciones de verdad

`participantType: 'national-team'` (ya declarado desde WORLD-CORE-1) es
ahora ejecutable: todo `CompetitionEntry` debe referenciar un `Team`
existente cuyo `teamKind` coincida con `participantType`, comprobado AL
REGISTRAR (`WorldRegistries.registerCompetitionEntry()`, BUG-NATIONAL1-02
— antes solo se auditaba en `validateIntegrity()` y solo para `club-team`)
y revalidado de forma agregada. El resolver estándar de participantes de
`CompetitionEngine` (`world.registries.teams.require(id)`) ya servía para
ambos tipos sin cambios. No existe `NationalCompetitionEngine`, calendario
paralelo, standings paralelos ni pathway especial por país —
`CompetitionSimulationService` sigue siendo genérico para cualquier `Team`.
El smoke demuestra una competición continental `standard` y una mundial
`abstract` sobre el MISMO `CompetitionDefinition -> Edition -> Stage ->
Entry` y el mismo `CompetitionEngine` que ACB/Primera FEB.

`CompetitionSimulationService.interactiveCohortTeams(seasonKey)`
(BUG-NATIONAL1-05) filtra ahora también por `teamKind === 'club-team'` —
antes devolvía cualquier Team "playable" sin mirar su tipo, así que una
selección "playable" futura habría entrado por accidente en bootstrap de
contratos/licencias domésticas/mercado/ciclo anual de clubes (`game.js`
sigue llamando al mismo helper `interactiveCohortTeams()`, sin cambio de
comportamiento observable para los 36 equipos españoles).

**Límite documentado**: la posproducción actual de un partido `playable`
(estadísticas de carrera, contratos, licencias) sigue pensada solo para
`club-team` — esta entrega NO conecta partidos `playable` de selecciones
con esa ruta ni con la UI española; instalar contenido `playable` de
selecciones queda fuera de alcance (sección 10.17.7).

#### 10.17.4 Modelo de dominio nacional

`src/entities/NationalTeam.js` — cinco entidades planas y serializables
(BUG-NATIONAL1-04, antes `nationalTeamAppearances` era un array suelto sin
expediente canónico):

- **`NationalStatusDecision`**: única forma autorizada de cerrar un caso de
  vínculo significativo, territorio dependiente, refugio/asilo,
  nacionalidad dudosa o cambio de selección — `status`
  (`pending|approved-unrestricted|approved-restricted|denied|superseded`),
  vigencia, ruleset congelado, referencia a decisión anterior y contador de
  cambios aprobados. El motor NUNCA se arroga esta decisión.
- **`NationalTeamWindow`**: ventana FIBA — `noticeDueAt`/
  `preliminaryRosterDueAt`/`finalRosterDueAt`/`dutyStartsAt`/`dutyEndsAt`
  SIEMPRE con instante UTC + `timeZoneId` IANA explícito y cronología
  validada al construirse; `coversLocalDate()` resuelve el solapamiento con
  un partido de club por FECHA CIVIL en el huso de la ventana (semiabierto,
  mismo criterio que `LoanAgreement.isActiveOn`). `_resolvedSteps`
  (bookkeeping interno, nunca en `toJSON()`) evita que la fuente del
  calendario mundial relist un paso ya resuelto.
- **`NationalTeamSelection`**: lista preliminar/final por ventana+selección
  — máquina de estados `draft -> preliminary-filed -> final-filed ->
  released` (o `cancelled`); la lista final es SIEMPRE subconjunto de la
  preliminar y queda inmutable en cuanto `final-filed`.
- **`NationalTeamCallUp`**: convocatoria de un jugador — `clubTeamId` es
  una FOTO tomada al convocar (nunca se recalcula); `status`
  `selected -> notified -> joined -> released` (o `withdrawn` antes de
  incorporarse); referencias de seguro/gastos como metadatos, sin mutar
  economía.
- **`NationalTeamAppearanceReceipt`**: evidencia INMUTABLE de una aparición
  individual REAL — su propio constructor RECHAZA `detailLevel` distinto de
  `playable`/`full` (invariante 85): lista final, convocatoria o resultado
  agregado nunca equivalen a jugar.

`src/core/NationalTeamRegistry.js` — instancia EXPLÍCITA por carrera
(nunca singleton), `Map` solo como implementación interna; indexa y
consulta por jugador/federación/ventana/selección. `activeDutyForPlayerOn(
playerId, dateIso)` es la fuente ÚNICA de "¿está de servicio internacional
en esta fecha?" — consultada tanto por `EligibilityService` como por
cualquier diagnóstico futuro. Adjuntado por IDENTIDAD a
`GameWorld.domainRegistries.nationalTeamRegistry` y a `state.
nationalTeamRegistry`; `GameWorld.describe()` añade un resumen PLANO
(`nationalTeamRegistrySummary`, solo contadores).

`src/core/NationalTeamService.js` — único dueño de las transiciones:
abrir ventana, guardar lista preliminar, finalizar lista, notificar
convocatorias, iniciar/terminar servicio internacional, retirar
justificadamente antes de incorporarse, registrar una aparición oficial.
Cada comando valida TODO antes de mutar (invariante 82); no implementa una
IA de seleccionador — recibe siempre `playerIds` ya elegidos por su
caller, nunca simula negativas/sanciones/dietas/primas/seguros/disputas.
`startInternationalService()` activa (o reutiliza) el squad
`national-team-duty` de cada selección con las MISMAS instancias de
`Player`; `endInternationalService()` libera los callups y deja el squad
histórico — el jugador nunca "vuelve" a ningún sitio porque nunca salió de
su club.

#### 10.17.5 Elegibilidad y reglas FIBA

`src/core/NationalTeamRules.js` — bundle `fiba-national-teams-2026.1`
(estado `provisional`, vigente 22-04-2026), con fuentes oficiales citadas
(FIBA Internal Regulations Books 1-3) y reglas VERSIONADAS: decisión de
nacionalidad con ≥14 días de aviso, lista preliminar ≤24, lista final
10-12, máximo 1 "restricted" en la lista final, liberación al club con ≥30
días. Cada regla declara `kind: 'minimum'|'maximum'`; un overlay de
handbook por competición se compone SEMÁNTICAMENTE (`composeOverlay()`:
mínimos concurrentes -> el mayor, máximos concurrentes -> el menor) —
NUNCA `Object.assign()`/"el último gana". `requireNationalTeamRuleset()`
no tiene fallback ACB/FEB/España: un bundle desconocido lanza explícito.
Un `fictional-test-national-teams-1` separado (números más pequeños)
existe SOLO para los scripts de esta entrega.

`src/core/NationalTeamEligibilityService.js` — PURO, nunca crea una
decisión/convocatoria/receipt. Devuelve `{status, reasonCodes,
evidenceIds, warnings, trace}` con `status` en
`eligible|eligible-restricted|ineligible|pending-decision|unknown`:
pasaporte ausente -> `unknown`; pasaporte inválido/caducado ->
`ineligible`; caso que exige resolución externa sin ella -> `pending-
decision`; decisión aprobada restringida -> `eligible-restricted`;
compromiso oficial previo con otra federación -> `pending-decision`
(exige expediente de cambio). `isFinalListEligible()` es la única puerta
que usa `NationalTeamService.finalizeList()` — `unknown`/`pending-decision`
NUNCA se convierten en elegibles (invariante 79).

`src/entities/Registration.js` — `PlayerRegulatoryProfile` gana
`birthAreaId` (opcional, trazable) y `passportEvidences[]` (id, área/país,
fechas, `verificationStatus`, procedencia) — ciudadanía, pasaporte vigente
y nacionalidad deportiva FIBA son conceptos DISTINTOS (invariante 80).
`nationalTeamAppearances` pasa a ser SOLO evidencia legacy importada —
`RegulatoryClassificationService.classifyFormationFeb28(profile, context,
deps)` gana un cuarto parámetro opcional (`deps.nationalTeamRegistry`):
consulta primero los receipts reales, y solo si no hay dependencia
inyectada cae al array legacy — la excepción de formación FEB (aparición
oficial con la selección) sigue funcionando sin duplicar historial
mutable, y ningún fixture/test anterior a esta entrega cambia de
comportamiento (el parámetro es opcional en toda la cadena).

#### 10.17.6 Calendario y disponibilidad para el club

`WorldCalendarCoordinator.js` gana la fuente `national-team-duty`
(`createNationalTeamDutySource()`): lista los 5 pasos fechados de cada
`NationalTeamWindow` (aviso, lista preliminar, lista final, inicio y fin
de servicio) como items PLANOS y delega SIEMPRE en `NationalTeamService`
vía el callback inyectado — nunca contiene reglas propias, nunca es
parada del usuario (ninguna rama de `requiresUser()` la reconoce).
`window.markStepResolved()`/`hasResolvedStep()` (bookkeeping interno de la
propia ventana) hacen que reprocesar un paso ya resuelto sea idempotente,
mismo problema que ya resuelven los eventos "processed" de Market/Loan,
aquí resuelto en la ventana porque declara varios plazos distintos.

`EligibilityService.evaluateEligibility()` gana el reason code bloqueante
`NATIONAL_TEAM_DUTY`: si `deps.nationalTeamRegistry` está inyectado y hay
un callup `'joined'` cuya ventana cubre `context.date`, bloquea — usuario
y CPU consultan EXACTAMENTE el mismo registro (`buildEligiblePoolForMatch()`
en `game.js` ya lo pasa como dependencia). Sin `deps.nationalTeamRegistry`
(fixtures/tests históricos que no lo inyectan), el bloque nunca se activa
— comportamiento IDÉNTICO a antes de esta entrega. Al terminar la ventana
el jugador vuelve a estar disponible automáticamente (nunca se convierte
en lesión/sanción/baja federativa, invariante 83) porque nunca salió de
su plantilla.

`game.js` (`startSeason()`) crea `state.nationalTeamRegistry = new
BM.NationalTeamRegistry()` (instancia EXPLÍCITA por carrera, limpiada al
volver a selección de equipo) y la adjunta a `state.world.
domainRegistries` y a los tres puntos donde ya se llama a
`EligibilityService.evaluateEligibility()` — en la partida española el
registro está siempre VACÍO (no se instala ninguna ventana/selección
real), así que esto no cambia ningún comportamiento observable (invariante
90). La fuente `national-team-duty` del calendario NO se conecta al
`WorldCalendarCoordinator` de la partida española en esta entrega (no hay
ninguna `NationalTeamWindow` que listar ahí) — queda demostrada en el
módulo genérico y en el smoke; conectarla a un calendario con ventanas
reales es contenido, no motor, y queda fuera de alcance (sección 10.17.7).

#### 10.17.7 Fuera de alcance de esta entrega

Navegación/selector de selecciones (**WORLD-UI-1**); contenido real de
selecciones/torneos/ventanas FIBA (Mundial/JJOO/EuroBasket) y
enriquecimiento real de nacionalidades/pasaportes de jugadores reales ya
cargados; modo jugable de seleccionador o elección de convocados por IA;
estadísticas internacionales detalladas, récords, premios y
`PlayerCareer` internacional; rescheduling automático de ligas, sanciones
por negativa, primas, seguros y economía real; transfer internacional/
Letter of Clearance; cambios a balance/tácticas/`MatchEngine`/lesiones/
desarrollo; instalar el fixture ficticio en producción; conectar la fuente
`national-team-duty` a un calendario con ventanas reales; SQL/save-load/
backend/dependencias nuevas; limpieza general de shims legacy
(**WORLD-HARDEN-1**).

#### 10.17.8 Pruebas de esta entrega

`node scripts/test-national-teams1.js` — 19 comprobaciones agrupadas:
tipos/relaciones Team y Squad (incluida la doble pertenencia con identidad
estricta de Player y `Player.teamId` intacto), Entry nacional válido/
inválido al registrar, serialización, ciudadanía/pasaporte/decisión/
unknown, listas preliminar/final (máximo, subconjunto, máximo de
restricted), atomicidad e idempotencia, duty y reason code de club (con y
sin `nationalTeamRegistry` inyectado), apariciones solo con evidencia
individual (rechazo explícito de `standard`/`abstract`), excepción de
formación FEB con fallback legacy, orden de registro invertido sin cambiar
el resultado, composición semántica de un overlay de ruleset. **19 OK, 0
fallos.**

`node scripts/smoke-national-teams1.js` — fixture ficticio (dos clubes de
origen, cuatro federaciones/selecciones, nunca instalado en producción):
una ventana FIBA completa, una Copa Continental `standard` y un Mundial
`abstract` sobre el mismo `CompetitionEngine`, convocatoria (preliminar 6
-> final 5, una con condición "restricted") -> incorporación (squads
`national-team-duty` activos, doble pertenencia verificada) ->
disponibilidad de club bloqueada durante la ventana y recuperada después
-> simulación (`standard` sin empates/detalle individual, `abstract` en un
único hito/receipt, cero apariciones individuales fabricadas) ->
liberación (callups `released`, squads históricos, plantilla de club
intacta) -> integridad `World`/`NationalTeamRegistry` limpia ->
determinismo con orden de registro invertido. **OK en ~0.1s.**

Regresiones autorizadas ejecutadas, sin cambio de comportamiento
pretendido: `node scripts/test-club-core1.js` (**36 OK, 0 fallidas** — ver
nota abajo), `node scripts/test-reg1.js` (**88 OK, 0 FAIL**), `node
scripts/test-world-calendar1.js` (**25 OK, 0 FAIL**), `node
scripts/test-world-sim1.js` (**19 OK, 0 FAIL**). `node --check` sobre
todo el JS nuevo/modificado y `git diff --check`: sin errores.

**Corrección incidental encontrada al ejecutar la regresión obligatoria
(no es un BUG-NATIONAL1-0x, no tiene relación con selecciones)**:
`scripts/test-club-core1.js` fallaba 6 de sus comprobaciones (toda la
sección 9, "paquete español real") con `origin/main` tal cual, ANTES de
cualquier cambio de esta entrega (confirmado revirtiendo el árbol de
trabajo y re-ejecutando el script) — `buildSpainWorld()` construía el
mundo sin `simulationProfile`, y desde WORLD-SIM-1 `data/world/
spain-2026.1.js` exige esa dependencia para resolver `detailLevel`.
Corregido con el MISMO perfil transitorio que ya usan `game.js`/
`scripts/test-world-sim1.js` (ACB/Primera FEB/Copa ACB "playable"
explícito) — la regresión pasa a estar realmente verificada en vez de
reportarse en falso como "verde" (no formaba parte de la verificación
reducida obligatoria de WORLD-SIM-1, así que nunca se había detectado).

_Migrado de `CHANGELOG.md` (líneas 671-819 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-07 — NATIONAL-TEAMS-1: selecciones, elegibilidad y ventanas FIBA (DESIGN.md sección 10.17)

Séptima entrega de la EPIC **World Architecture** (WORLD-CORE-1 →
CLUB-CORE-1 → COMP-CORE-1 → WORLD-CALENDAR-1 → PATHWAYS-1 → WORLD-SIM-1 →
**NATIONAL-TEAMS-1** → WORLD-UI-1 → WORLD-HARDEN-1). Base: merge de la PR
de WORLD-SIM-1 en `origin/main` (`2314161`). Rama `claude/modest-gauss-ab8bat`.

Incorpora selecciones nacionales al MISMO mundo, motor de competiciones,
calendario y niveles de detalle ya existentes — no crea un segundo juego
paralelo ni vuelve a colocar España en el centro de la arquitectura. La
vertical de prueba es ficticia y vive únicamente en
`scripts/test-national-teams1.js`/`scripts/smoke-national-teams1.js`: la
partida española sigue teniendo únicamente ACB, Primera FEB y Copa ACB
como Editions jugables, sin ninguna federación/selección/ventana FIBA real
instalada.

### Bugs/deudas corregidos

- **`BUG-NATIONAL1-01`** — `WorldRegistries.registerTeam()` exigía
  `clubId` a TODO equipo, así que un `national-team` (que nunca tiene
  club) no podía registrarse pese a que `participantType: 'national-team'`
  ya existía desde WORLD-CORE-1. *Corrección*: `Team` gana `teamKind:
  'club-team' | 'national-team'` — `registerTeam()`/`validateIntegrity()`
  validan la rama correcta según el tipo (national-team exige
  `federationOrganizationId`/`representedAreaId` reales, nunca `clubId`).
- **`BUG-NATIONAL1-02`** — un `CompetitionEntry` "national-team" podía
  registrarse sin comprobar que su participante existiera de verdad ni que
  su `teamKind` coincidiera con `participantType` (la comprobación previa
  solo cubría `club-team`). *Corrección*: `WorldRegistries.
  registerCompetitionEntry()` valida AMBOS tipos al registrar, revalidado
  además en `validateIntegrity()`.
- **`BUG-NATIONAL1-03`** — la unicidad GLOBAL de squad activo por jugador
  impedía que un jugador estuviera a la vez en su plantilla de club y en
  una selección. *Corrección*: `Squad` gana `membershipContext:
  'club-service' | 'national-team-duty'` — la unicidad pasa a ser POR
  CONTEXTO (máximo uno de cada, nunca dos del mismo), con
  `activeClubSquadForPlayer()`/`activeNationalTeamSquadForPlayer()` nuevos
  y `activeSquadForPlayer()` conservado como alias legacy de club-service.
- **`BUG-NATIONAL1-04`** — `nationalTeamAppearances` era un array suelto
  en `PlayerRegulatoryProfile` sin expediente canónico ni fuente de
  verdad. *Corrección*: `NationalTeamAppearanceReceipt`
  (`NationalTeamRegistry`) es la fuente CANÓNICA nueva — inmutable, exige
  `detailLevel` `playable`/`full` (rechaza `standard`/`abstract` en el
  propio constructor); el array legacy sigue existiendo SOLO como
  fallback de solo lectura para fixtures/tests anteriores a esta entrega.
- **`BUG-NATIONAL1-05`** — `CompetitionSimulationService.
  interactiveCohortTeams()` devolvía cualquier Team de una Edition
  "playable" sin mirar su tipo — una selección "playable" futura habría
  entrado por accidente en bootstrap de contratos/licencias domésticas/
  mercado/ciclo anual de clubes. *Corrección*: filtra además
  explícitamente por `teamKind === 'club-team'`. Sin cambio observable
  hoy (mismos 36 equipos españoles).
- **`BUG-NATIONAL1-06`** — el calendario mundial no conocía ventanas ni
  servicio internacional. *Corrección*: nueva fuente `national-team-duty`
  (`WorldCalendarCoordinator.js`) que lista los 5 plazos de cada
  `NationalTeamWindow` como items planos y delega en `NationalTeamService`
  — nunca es parada del usuario, idempotente vía `window.
  markStepResolved()`. No se conecta al calendario de la partida española
  en esta entrega (no hay ninguna ventana real que listar ahí) — demostrada
  en el módulo genérico y en el smoke.
- **`BUG-NATIONAL1-07`** — la carga actual no contiene pasaportes/
  decisiones suficientes para inferir elegibilidad real sin inventar
  datos. *Corrección*: no se corrige inventando — `PlayerRegulatoryProfile`
  gana `birthAreaId`/`passportEvidences[]` (ambos vacíos por defecto para
  cualquier jugador real ya cargado) y
  `NationalTeamEligibilityService.evaluateNationalEligibility()` devuelve
  SIEMPRE `unknown` ante un pasaporte ausente — nunca elegible silencioso.
  No se enriquece ningún jugador real de `data/real/*` con nacionalidad/
  pasaporte inventados.
- Corrección incidental encontrada al ejecutar la regresión obligatoria
  (no es un `BUG-NATIONAL1-0x`, sin relación con selecciones):
  `scripts/test-club-core1.js` fallaba 6 de sus comprobaciones (sección 9,
  "paquete español real") en `origin/main` TAL CUAL, antes de cualquier
  cambio de esta sesión (confirmado revirtiendo el árbol de trabajo y
  reejecutando) — `buildSpainWorld()` construía el mundo sin
  `simulationProfile`, y desde WORLD-SIM-1 `data/world/spain-2026.1.js`
  exige esa dependencia para resolver `detailLevel`. Corregido con el
  MISMO perfil transitorio que ya usan `game.js`/
  `scripts/test-world-sim1.js` (ACB/Primera FEB/Copa ACB "playable"
  explícito) — la regresión pasa a estar realmente verificada.

### Entidades, registros y servicios añadidos

`src/entities/NationalTeam.js` (`NationalStatusDecision`,
`NationalTeamWindow`, `NationalTeamSelection`, `NationalTeamCallUp`,
`NationalTeamAppearanceReceipt`), `src/core/NationalTeamRegistry.js`
(instancia explícita por carrera, `Map` solo como implementación interna),
`src/core/NationalTeamRules.js` (bundle `fiba-national-teams-2026.1`,
fuentes FIBA Internal Regulations Books 1-3, composición semántica de
overlay de handbook — nunca `Object.assign()`), `src/core/
NationalTeamEligibilityService.js` (puro, `unknown`/`ineligible`/
`pending-decision`/`eligible`/`eligible-restricted`) y `src/core/
NationalTeamService.js` (único dueño de las transiciones: ventana, lista
preliminar/final, notificar convocatorias, incorporar/liberar servicio
internacional, retirada justificada, registrar aparición oficial —
válida-todo-antes-de-mutar, nunca elige jugadores por overall/reputación).

### Ficheros modificados

`src/entities/Team.js` (`teamKind`), `src/entities/Squad.js`
(`membershipContext`), `src/core/WorldRegistry.js` (`registerTeam`/
`registerSquad`/`registerCompetitionEntry`/`validateIntegrity` por tipo/
contexto), `src/entities/World.js` (`nationalTeamRegistry` en
`domainRegistries` + resumen en `describe()`), `src/core/
CompetitionSimulationService.js` (`interactiveCohortTeams` filtra por
`teamKind`), `src/entities/Registration.js` (`PlayerRegulatoryProfile.
birthAreaId`/`passportEvidences[]`), `src/core/
RegulatoryClassificationService.js` (`classifyFormationFeb28` consulta
`nationalTeamRegistry` con fallback legacy), `src/core/
EligibilityService.js` (reason code `NATIONAL_TEAM_DUTY`), `src/core/
WorldCalendarCoordinator.js` (fuente `national-team-duty`), `src/ui/
game.js` (`state.nationalTeamRegistry`, adjuntado a `domainRegistries` y
pasado como dependencia a los tres call-sites de
`EligibilityService.evaluateEligibility()`), `index.html` (carga de los
cinco módulos nuevos), `scripts/test-club-core1.js` (corrección incidental
de `simulationProfile`, ver arriba).

### Pruebas realmente ejecutadas

- `node scripts/test-national-teams1.js` — **19 OK, 0 fallos**.
- `node scripts/smoke-national-teams1.js` — **OK en ~0.1s** (4
  selecciones, 1 ventana FIBA, Copa Continental "standard" + Mundial
  "abstract", convocatoria→incorporación→simulación→liberación,
  integridad y determinismo).
- Regresión: `node scripts/test-club-core1.js` (**36 OK, 0 fallidas**,
  tras la corrección incidental de arriba), `node scripts/test-reg1.js`
  (**88 OK, 0 FAIL**), `node scripts/test-world-calendar1.js` (**25 OK, 0
  FAIL**), `node scripts/test-world-sim1.js` (**19 OK, 0 FAIL**).
- `node --check` sobre todos los `.js` nuevos/modificados de esta sesión:
  sin errores. `git diff --check`: sin errores.

### Límites de esta entrega

Sin navegación/selector de selecciones (WORLD-UI-1); sin contenido real
de selecciones/torneos/ventanas FIBA ni enriquecimiento real de
nacionalidades/pasaportes de jugadores reales ya cargados; sin modo
jugable de seleccionador ni elección de convocados por IA; sin
estadísticas internacionales detalladas/récords/`PlayerCareer`
internacional; sin transfer internacional/Letter of Clearance; sin
cambios a balance/tácticas/`MatchEngine`/lesiones/desarrollo; la fuente
`national-team-duty` del calendario no se conecta a la partida española
(no hay ninguna ventana real que listar). Confirmado explícitamente:
`data/real/*` no se modificó, no se añadió SQL/backend/save-load nuevo, no
se añadió ninguna dependencia nueva (sigue sin `package.json`).

Siguiente entrega: **WORLD-UI-1** (navegación Mundo → Continente → País →
Competición, configuración de carrera, selección de ligas/nivel de
detalle).
