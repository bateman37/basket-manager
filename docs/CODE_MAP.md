# CODE_MAP — enrutamiento de funcionalidades a código

Lleva de una funcionalidad al archivo/símbolo pertinente. No enumera todas
las funciones del repositorio — para los tres archivos grandes que no se
dividen físicamente (`src/ui/game.js`, `src/core/Tactics.js`,
`src/core/CompetitionRules.js`) usa su guía dedicada en `docs/code/`.

## Núcleo del motor (`src/core/`)

| Área | Archivo(s) principal(es) | Diseño / arquitectura relacionados |
|---|---|---|
| Simulación de partidos (motor) | `MatchEngine.js` (`createMatchState`, `advanceMatch`, `simulateMatch`) | `docs/design/match-simulation.md` |
| Táctica | `Tactics.js` — ver `docs/code/tactics.md` | `docs/design/tactics/` |
| Rotación y alineación por slots | `Rotation.js` | `docs/design/lineups-rotation-energy.md` |
| Recuperación de energía entre partidos | `Recovery.js` | `docs/design/lineups-rotation-energy.md` |
| Entrenamiento | `Training.js`, `TrainingAI.js` | `docs/design/training.md` |
| Desarrollo/TMB/Potencial | `PlayerDevelopment.js` | `docs/design/player-development.md` |
| Carrera e histórico de jugador | `PlayerCareer.js` | `docs/design/career-history.md` |
| Lesiones y estado médico | `Medical.js` | `docs/design/injuries-recovery.md` |
| Calendario de temporada española (legacy) | `Calendar.js` (ya no cargado desde `index.html`, ver `docs/architecture/world-calendar.md`) | `docs/design/competitions-spain.md` |
| Calendario mundial | `WorldCalendar.js`, `WorldCalendarCoordinator.js` | `docs/architecture/world-calendar.md` |
| Liga/Copa/Playoffs/Ascenso (fachadas legacy) | `League.js`, `Bracket.js`, `Cup.js`, `Playoffs.js`, `Promotion.js` | `docs/design/competitions-spain.md`, `docs/architecture/competition-engine.md` |
| Motor genérico de competiciones | `CompetitionRunners.js`, `CompetitionEngine.js` | `docs/architecture/competition-engine.md` |
| Formato y calendario de competición | `CompetitionFormatCatalog.js`, `CompetitionScheduleService`/Catalog | `docs/architecture/competition-engine.md`, `docs/architecture/world-calendar.md` |
| Pathways (clasificación/ascenso-descenso) | `CompetitionPathwayService.js` (+ `src/entities/CompetitionPathway.js`) | `docs/architecture/pathways.md` |
| Contexto competitivo | `CompetitionContextService.js`, `CompetitionParticipationService.js` | `docs/architecture/competitive-context-identity.md` |
| Identidad de competición (catálogo) | `CompetitionCatalog.js` (canónico), `CompetitionRules.js` (reglas — ver `docs/code/competition-rules.md`) | `docs/architecture/world-model.md` |
| Simulación por nivel de detalle | `CompetitionSimulationService.js`, `AbstractCompetitionStageRuntime.js` | `docs/architecture/simulation-levels.md` |
| Player Registry mundial | `PlayerRegistry.js` | `docs/design/roster-registry.md` |
| Contratos | `ContractRegistry.js`, `ContractService.js`, `ContractSeeder.js`, `ContractExpiryService`, `RenewalService.js` | `docs/design/contracts.md` |
| Inscripción/licencias/elegibilidad | `RegistrationRegistry.js`, `RegistrationSeeder.js`, `EligibilityService.js`, `SquadEligibilityService.js` | `docs/design/registration-eligibility.md` |
| Mercado y agentes | `AgentRegistry.js`, `MarketRegistry.js`, `MarketService.js`, `RightOfFirstRefusalService.js` | `docs/design/market.md` |
| Traspasos | `TransferRegistry.js`, `TransferService.js`, `TransferExecutionService.js`, `RosterMutationService.js` | `docs/design/transfers.md` |
| Cesiones | `LoanRegistry.js`, `LoanService.js`, `LoanExecutionService.js` | `docs/design/loans.md` |
| Ciclo anual | `AnnualCycleService.js`, `AnnualCycleRegistry.js`, `AcademyRegistry.js`, `AcademyService.js`, `RetirementService.js`, `RosterLegalityService.js`, `CpuRosterPlanner.js`, `MarketClearinghouse.js` | `docs/design/annual-cycle.md` |
| Mundo/registros globales | `WorldRegistry.js` (`WorldRegistries`) | `docs/architecture/world-model.md` |
| Selecciones nacionales | `NationalTeamRegistry.js` (si existe), `NationalTeamEligibilityService.js` | `docs/architecture/national-teams.md` |
| Configuración de carrera | `CareerSetupService.js` (+ `src/entities/CareerSetup.js`) | `docs/architecture/career-setup-and-navigation.md` |
| Navegación mundial | `WorldNavigationService.js` | `docs/architecture/career-setup-and-navigation.md` |
| Frontera de persistencia (sonda) | `CareerPersistenceBoundary.js` | `docs/architecture/persistence-boundary.md` |

## Entidades (`src/entities/`)

`Player.js`, `Team.js`, `Club.js`, `Squad.js`, `World.js` (`GameWorld`),
`Geography.js`, `Organization.js`, `Competition.js`
(`CompetitionDefinition`/`Edition`/`Stage`/`Entry`), `CompetitionPathway.js`,
`Cycle.js` (`AnnualRosterCycle`/`ClubCycleCase`/`RenewalCase`), `CareerSetup.js`,
`WorldSimulation.js`.

## Interfaz (`src/ui/`)

`game.js` — ver `docs/code/game-ui.md`. `game.css` (estilos, sin lógica).
`TacticsHelp.js` (ayuda contextual, 97 entradas — ver `docs/design/tactics/roadmap.md` §7.12.36).

## Utilidades (`src/utils/`)

`Money.js` (unidad mínima entera + ISO 4217), `LocalDate.js` (fechas
civiles ISO), `GameDateTime.js` (instante ISO 8601 UTC + huso IANA),
`DeterministicRandom.js`, `CareerAge.js`, `playerGenerator.js`,
`teamGenerator.js`.

## Contenido (`data/`)

`data/real/real-data-bundle.js` (+ `data/real/teams/*.json`, datos reales
— nunca se sobrescriben con datos ficticios). `data/fictional/`
(generadores de prueba). `data/world/spain-2026.1.js` (paquete de
contenido español, `SPAIN_CLUB_CONTENT`), `data/world/content-pack-catalog.js`.

## Cómo usar este mapa

1. Busca tu funcionalidad en la tabla.
2. Abre el documento de diseño/arquitectura enlazado primero (la regla).
3. Localiza el símbolo real en el archivo señalado con `rg`, no por
   número de línea.
4. Si el archivo es uno de los tres grandes no divididos, usa su guía en
   `docs/code/` antes de leer el archivo entero.
