# Arquitectura — contexto competitivo explícito e identidades canónicas (WORLD-CONTEXT-1, WORLD-CLEANUP-1)

_Migrado de `CLAUDE.md` (líneas 1506-1568 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### WORLD-CONTEXT-1 (DESIGN.md 10.20) — contexto competitivo explícito e identidades canónicas

Convenciones permanentes de la corrección posterior a WORLD-HARDEN-1
(queda pendiente `WORLD-CLEANUP-1`; la EPIC NO está cerrada). Aplican a
TODA sesión futura que toque contratos, inscripciones, mercado, traspasos,
cesiones, ciclo anual, planificación CPU o legalidad de plantilla:

- **El contexto de competición es SIEMPRE explícito.** Una operación sobre
  UN equipo recibe `domesticCompetitionId`; una operación ENTRE equipos
  recibe ids por PAPEL (`originCompetitionId`/`destinationCompetitionId`/
  `ownerCompetitionId`/`borrowerCompetitionId`); una operación BATCH recibe
  el resolver OBLIGATORIO `competitionIdForTeam(team, seasonKey)` (o una
  proyección plana `{teamId: competitionId}` construida por el llamador).
  Ninguna función de dominio infiere competición por su cuenta.
- **Resolución canónica por Entries**: `CompetitionContextService`
  (`src/core/CompetitionContextService.js`, PURO, sin literales de país/
  liga) sobre `CompetitionParticipationService.primaryLeagueCompetitionId`.
  En la interfaz, el punto ÚNICO es `domesticCompetitionIdForTeam(team,
  seasonKey)`/`buildDomesticCompetitionResolver()` de `game.js`. No se
  crea ningún registro nuevo ni caché durable de contexto.
- **PROHIBIDO** derivar competición de `team.division`/`legacyDivision`,
  guardar un `team.competitionId` como supuesto único, elegir "la primera"
  competición de un array, usar ACB como default, usar la competición del
  próximo partido, o leer `state`/globales dentro de un resolver de
  dominio. Sin contexto suficiente se FALLA con diagnóstico (`teamId`,
  `seasonKey`, operación) y sin dejar nada aplicado a medias.
- Resolver/consultar NUNCA muta el mundo, NUNCA proyecta división y NUNCA
  consume aleatoriedad.
- La transición anual distingue SIEMPRE competición de ORIGEN
  (`cycle.fromSeasonKey`) y de DESTINO (`targetSeasonKey`) — un ascenso/
  descenso hace que sean distintas; nunca se reutiliza una sola id.
  `targetCompetitionId` de un `ClubCycleCase` se resuelve desde las
  Entries de la temporada destino, DESPUÉS del pathway.
- **`clubId` identifica SIEMPRE un `Club`; `teamId`, un `Team`** (tabla
  completa en DESIGN.md 10.20.3): contrato/empleador/nómina/presupuesto/
  academia/derechos/cesión (propietario y cesionario)/licencia federativa
  → `clubId`; `CompetitionEntry`/inscripción/plantilla/acta/evidencia de
  último partido/legalidad/táctica/`Player.teamId` → `teamId`. Un
  diagnóstico o snapshot nuevo lleva AMBOS ids cuando el consumidor pueda
  necesitarlos.
- Formas canónicas del ciclo (ya migradas, no volver atrás):
  `competitionMembershipSnapshot: [{teamId, clubId, competitionId}]`,
  `teamLastOfficialMatchEvidence` (nunca `clubLastOfficialMatchEvidence`),
  `lastOfficialMatchDateForTeam()`, `ClubCycleCase.teamId`,
  `ClubSquadPlan.teamId`, `RosterLegalityReport.teamId`+`clubId`,
  `EmergencyRosterAction.teamId`+`clubId`,
  `AnnualCycleRegistry.legalityReportsForTeam/emergencyActionsForTeam`,
  colector de evidencia indexado por `teamId` (`forTeam`/`missingTeamIds`,
  `recordMatch({homeTeamId, homeClubId, awayTeamId, awayClubId, ...})`).
- Ninguna decisión de IA pregunta "¿es ACB?": el nivel competitivo se
  deriva de `CompetitionDefinition.tier` con configuración neutral
  (`LoanService.LOAN_ATTRACTIVENESS`). Una competición sin `tier`
  declarado no recibe trato preferente por defecto.
- **Todo fixture/test NUEVO usa ids de Club y de Team DELIBERADAMENTE
  DISTINTOS** (`club:test` !== `team:test`) para que una confusión
  `clubId`/`teamId` no pueda volver a quedar oculta. `CompetitionRules.
  competitionIdFromLegacyDivision()` ya NO existe (retirado en
  WORLD-CLEANUP-1, ver más abajo) — ningún fixture nuevo debe reintroducir
  un adaptador de división, ni siquiera local.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambie el contrato de contexto competitivo o la semántica de
  identidades.

_Migrado de `CLAUDE.md` (líneas 1569-1643 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### WORLD-CLEANUP-1 (DESIGN.md 10.21) — retirada final de proyecciones legacy

Segunda y última corrección posterior a WORLD-HARDEN-1 (la primera fue
WORLD-CONTEXT-1, arriba). Con esta entrega, World Architecture se declara
estructuralmente cerrada — convenciones permanentes, breves y no
duplicadas con el resto de este archivo:

- **Participación se consulta SOLO por `CompetitionEntry`.** `Team.js` no
  tiene `division`/`legacyDivision`/`DIVISIONS`/`validateDivision` —
  ningún código nuevo los reintroduce, ni como campo ni como export.
  Agrupar/materializar equipos por `['1ª','2ª']` está PROHIBIDO en
  `game.js`; agrupa por `competitionDefinitionId` real
  (`CareerParticipantFactory.groupTeamsByCompetitionId()`).
- **Un Team no tiene una competición singular.** Puede tener Entry
  simultánea en liga y Copa; un histórico de carrera (`PlayerCareer.
  teamStints`) refleja eso con UN stint de servicio (`teamId`/`clubId`) y
  un `competitionStats[]` por competición real disputada — nunca
  `division`, nunca doble contabilización del total del stint.
- **Metadatos de fase declarados por CONTENIDO, nunca por un mapa de UI.**
  `CompetitionStageTemplate`/`CompetitionStage` llevan `rulesPhaseId`
  (string opaco, congelado al crear la Stage) + `presentationRole`
  opcional. `CompetitionEngine.describeCompetitionContext(registries,
  stageId)` es el ÚNICO punto que resuelve nombres/fase reales de un
  stage — `game.js` no vuelve a mantener
  `UI_COMPETITION_KEY_BY_STAGE_KEY`/`competitionKeyForStageKey()`/
  `BRACKET_PHASE_IDS`/`COMPETITION_LABELS` (retirados, no se reintroducen).
  Ningún evento nuevo lleva `relatedCompetition: 'league'/'cup'/'playoff'/
  'promotion'` — siempre un `competitionDefinitionId` real o `null`.
- **Exposición competitiva por `CompetitionDefinition.tier`, nunca por
  división.** `MatchConfig.playerDevelopment.exposure.competitionTierWeight`
  (antes `divisionWeight`) + `defaultCompetitionTierWeight` para una
  competición sin tier declarado. `recordMatchExposure()` congela el peso
  aplicable EN EL MOMENTO del partido (`exp.weight`) — cambiar el catálogo
  después nunca reescribe exposiciones pasadas.
- **Career Setup valida el grafo COMPLETO de pathways alcanzable**, no
  solo la competición inicial del club controlado
  (`CareerSetupService.validateReachableCompetitionsAllowUserStop()`,
  BFS puro con soporte de ciclos sobre `CompetitionPathwayRule` — nunca
  una segunda tabla manual de alcanzabilidad). Un destino `catalog-only`
  se ignora, nunca bloquea "Comenzar carrera".
- **Ningún adaptador de España en el core genérico.** El core
  (`Team.js`, `CompetitionParticipationService.js`, `CompetitionEngine.js`,
  `CareerSetupService.js`) no contiene ningún literal `'1ª'/'2ª'`/ACB/
  Primera FEB — el contenido español real (`data/world/spain-2026.1.js`)
  y `src/ui/game.js` (única capa de interfaz autorizada a conocerlos)
  siguen siendo los DOS únicos sitios permitidos, sin cambios de esa regla.
- **`src/core/SpainLegacyCompetitionRuntime.js` retirado de `src/core`**
  — vive en `scripts/fixtures/legacy/`, sin ningún call-site en `src/`.
  `src/core/Calendar.js` SIGUE en su sitio como ARCHIVO (~20 scripts
  todavía lo `require()` directamente; migrarlos es trabajo propio de una
  futura sesión, no un efecto colateral de otra) — pero su `<script>` ya
  NO se carga en `index.html` (REPO-HARDEN-1, DESIGN.md 10.21.7
  addendum): confirmado sin callers reales del global `Calendar` en el
  navegador. No reintroducir ese `<script>` sin confirmar antes que algo
  del navegador lo necesita de verdad.
- `RegistrationRegistry.registrationsForClub()`/`cumulativeCountForClub()`
  → `...ForTeam()`; `RetirementAnnouncement.clubIdAtAnnouncement` →
  `teamIdAtAnnouncement`; `ContractSeeder`/`RegistrationSeeder.
  seedFingerprint()` llaman `teamId` a su segundo componente — mismo
  valor/orden de hash, nunca regenerado.
- **`scripts/verify-*-playwright.js` (REPO-HARDEN-1)**: dentro de
  `page.evaluate()`, el equipo del usuario se resuelve SIEMPRE con
  `window.BasketManagerGame.getUserTeam()` (expuesto igual que `state`);
  un equipo cualquiera por id, con
  `state.world.registries.teams.get(id)`/`.all()`; una competición
  doméstica, con `BM.CompetitionContextService.resolveDomesticCompetitionId(
  state.world.registries, team.id, {seasonKey, operation})`. Nunca
  `state.leagues[state.division]`/`team.division`/
  `competitionIdFromLegacyDivision()` — ninguno de los tres existe ya
  (retirados en WORLD-CALENDAR-1/WORLD-CLEANUP-1); reaparecían en cinco
  verificadores hasta esta sesión.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambie la forma de exposición/histórico/Stage o la validación de
  Career Setup.
