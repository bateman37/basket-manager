# Arquitectura — clasificación y ascenso/descenso declarativos (PATHWAYS-1)

_Migrado de `CLAUDE.md` (líneas 1121-1203 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### PATHWAYS-1 (DESIGN.md 10.15) — clasificación y ascenso/descenso declarativos

Convenciones permanentes de la 5ª entrega de World Architecture — aplican
a toda sesión futura que toque qué equipos/participantes avanzan de fase,
entran en otra competición, ascienden, descienden o conservan plaza:

- Formato ≠ clasificación: un `CompetitionFormatDefinition` productivo
  declara SOLO qué stages existen y con qué algoritmo se disputan
  (`runnerConfig`) — nunca top-N, rangos, ganadores ni destinos. Una fase
  cuya clasificación decide un pathway usa `activation`/`entrySource`
  `'pathway-managed'` (nunca vuelve a mezclarse selección dentro del
  formato) — el engine NUNCA autoactiva una fase así por su cascada
  legacy interna.
- Toda regla de progresión nueva es una `CompetitionPathwayRule` dentro de
  una `CompetitionPathwayDefinition` (`src/entities/CompetitionPathway.js`,
  catálogo en `src/core/CompetitionPathwayCatalog.js`) — vocabulario
  CERRADO (`kind`/`trigger`/`selector`/`seedPolicy`/`destination`); un tipo
  desconocido lanza explícito, nunca se interpreta con un fallback. El
  core (`CompetitionPathway.js`/`CompetitionPathwayCatalog.js`/
  `CompetitionPathwayService.js`) NUNCA contiene un literal de país/liga/
  competición concreta — auditado estáticamente en
  `scripts/test-pathways1.js`.
- `CompetitionEngine` EMITE hechos (`setFactHandler()`, hecho plano
  `{type, editionId, stageId, stageKey, round}`) y expone consultas PURAS
  (`getStandingsFacts`/`getBracketFinalRoundWinners`/`getBracketChampion`/
  `isStageCompleted`) + una API pública de activación
  (`activateStageFromQualifiers`/`activateEditionFromDecision`, ambas
  idempotentes por id) — nunca decide POR QUÉ un conjunto de participantes
  clasifica. `CompetitionPathwayService` es quien resuelve selectors,
  aplica `seedPolicy` y llama a esa API — nunca al revés.
  `CompetitionEntry` registra SIEMPRE `qualificationReceiptId` cuando
  proviene de un pathway.
- Toda clasificación productiva deja un `CompetitionPathwayReceipt`
  (dentro de temporada) o, para la transición anual, un
  `CompetitionSeasonTransitionReceipt` (`WorldRegistries.pathwayReceipts`/
  `seasonTransitionReceipts`, registros por carrera, nunca singleton). Un
  receipt aplicado NUNCA se reescribe — recalcular el mismo hecho/
  transición devuelve el receipt existente (idempotencia real,
  `receiptId` determinista `pathway:{definitionId}:{ruleId}:{sourceSeasonKey}`
  para reglas dentro de temporada).
- Una transición anual (`CompetitionPathwayService.applyTransitionGroup()`)
  es un PREFLIGHT puro (resuelve qualifiers, calcula
  `remaining-participants` descontando movimientos ya explícitos, valida
  cardinalidad exacta y exclusividad de pirámide) seguido de un COMMIT
  atómico — un lote inválido no deja ningún target parcial (ninguna
  Edition/Entry a medias). `Team.division`/`legacyDivision` se PROYECTAN
  DESPUÉS del commit real, vía
  `CompetitionParticipationService.projectLegacyDivisionForTeams()` —
  NUNCA deciden la composición de la temporada siguiente, y un target sin
  `legacyDivision` proyecta `null`, nunca un valor fijo por defecto.
- `stageKey` (en `CompetitionStage`) y `pathwayBindingIds` (congelados en
  `CompetitionEdition` al crearse) son SIEMPRE explícitos — código nuevo
  nunca los deriva/parsea de un `id`. `teamId`/`clubId` no se sustituyen ni
  se derivan uno del otro en ningún receipt/move nuevo (mismo criterio que
  CLUB-CORE-1) — la deuda de naming YA EXISTENTE en `ClubCycleCase`/
  `RosterLegalityReport`/`EmergencyRosterAction`/
  `LastOfficialMatchEvidenceCollector` (documentada en el bloque
  CLUB-CORE-1 más arriba) sigue sin tocar: corregirla exige tocar
  `AnnualCycleService.freezeSnapshot()`, compartida por varios scripts de
  humo ajenos a esta entrega.
- Consultas/renders de pathway (`isTransitionGroupReady`, los hechos puros
  del engine) NUNCA mutan ni consumen RNG.
- Reglas de pathway nuevas se aportan SIEMPRE desde el paquete de
  contenido correspondiente (`data/world/*.js`, vía
  `registerPathwayDefinition()`) — nunca incrustadas en
  `CompetitionPathwayService.js`/`CompetitionEngine.js`.
- Shims retirados de producción por esta entrega —
  `buildSeasonActivationPlan()`/`registerCrossEditionActivation()`
  (activación de Copa), `bindNewSeasonEditions()` (temporada siguiente
  desde `team.division`), `SeasonHistoryService.
  applyPromotionsAndRelegations()` (mutaba `team.division`)— NO autorizan
  ningún call-site productivo nuevo: sobreviven exportados solo para
  `scripts/test-world-calendar1.js`/`scripts/smoke-world-calendar1.js` y
  scripts de humo anteriores a esta entrega, retirada definitiva en
  WORLD-HARDEN-1.
- Límites con entregas futuras: niveles de detalle/simulación del
  exterior (WORLD-SIM-1), selecciones (NATIONAL-TEAMS-1), navegación
  mundial/selector de ligas (WORLD-UI-1), persistencia (WORLD-HARDEN-1) y
  contenido europeo real (`EUROPE-CONTENT-1`, fuera de World Architecture)
  no se adelantan desde aquí — el fixture nacional→continental de
  `test-pathways1.js` demuestra extensibilidad, nunca instala contenido
  real nuevo.
