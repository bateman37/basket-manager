# Arquitectura — motor genérico de competiciones (COMP-CORE-1)

_Migrado de `CLAUDE.md` (líneas 971-1044 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### COMP-CORE-1 (DESIGN.md 10.13) — motor genérico de competiciones

Convenciones permanentes de COMP-CORE-1 (3ª entrega de World Architecture)
— aplican a toda sesión futura que toque Liga/Copa/Playoffs/Ascenso,
formato de competición, activación de fases, o el descriptor de partido:

- `CompetitionEdition`/`CompetitionStage`/`CompetitionEntry` son la
  AUTORIDAD de qué se juega y quién participa — nunca `runtimeBinding`
  (transitorio, solo para el shim histórico de scripts) ni un mapa fijo
  construido a mano. El runtime REAL vive en `RoundRobinStageRunner`/
  `BracketStageRunner` (`src/core/CompetitionRunners.js`), orquestados por
  `CompetitionEngine` (una instancia EXPLÍCITA por carrera, nunca
  singleton, nunca lee `state`/DOM/reloj de sistema/aleatoriedad propia).
- El FORMATO (qué fases tiene una competición, con qué algoritmo) vive en
  contenido (`CompetitionFormatDefinition`/`CompetitionStageTemplate`,
  registrados por `data/world/*.js` en `CompetitionFormatCatalog.js`); el
  ALGORITMO vive en el runner genérico. Un runner/engine/registry nuevo
  nunca contiene un literal de país/liga/nombre de fase — auditado
  estáticamente en `scripts/test-comp-core1.js`.
- Participación se resuelve SOLO por `CompetitionEntry`
  (`CompetitionParticipationService`, nunca `team.competitionId` ni "la
  primera del array") — un Team puede tener Entry simultánea en Liga y
  Copa. Ninguna rama nueva por `team.division`/nombre de país/competición
  concreta en código productivo; `competitionIdFromLegacyDivision()` sigue
  exportado solo para scripts/tests históricos, sin nuevos call-sites
  productivos (retirada definitiva en WORLD-HARDEN-1).
- El contexto de un partido concreto (`buildMatchCompetitionContext()` en
  `game.js`) recibe el `competitionId` REAL del descriptor canónico de ESE
  partido cuando existe (liga o eliminatoria) — nunca derivado de
  `team.division` (BUG-COMPCORE-02: eso daba SIEMPRE la Liga, incluso para
  un partido de Copa). Sin partido concreto todavía, resuelve la Liga
  doméstica PRINCIPAL vía `CompetitionParticipationService`.
- Todo partido tiene `id` global estable y fecha real ASIGNADOS antes de
  invocar `MatchEngine` (BUG-COMPCORE-03) — en ambos runners, no solo en
  round-robin. Consultar el siguiente partido pendiente
  (`peekNextPendingMatch()`/`Bracket.peekNextPendingGame()`) nunca lo
  juega ni consume aleatoriedad. Resolver dos veces el mismo partido está
  rechazado por el runner, nunca por una comprobación externa.
- `formatBindingId`/`scheduleProfileId`/`rulesetBundleId` quedan
  CONGELADOS en la `CompetitionEdition` al crearse — nunca reescritos
  después. Una `CompetitionFormatDefinition` registrada con la misma
  id+version es idempotente; con otra version, lanza (nunca "el último
  gana").
- `League.js`/`Bracket.js`/`Cup.js`/`Playoffs.js`/`Promotion.js` son
  fachadas FINAS sobre los runners genéricos (constructor con un
  parámetro opcional de runner ya construido) — el MISMO algoritmo,
  nunca duplicado. Siguen siendo el punto de construcción para scripts/
  tests históricos que las llaman de forma standalone; `game.js` en
  producción NUNCA construye `new League()`/`new Bracket()`/`createCup()`/
  `createTitlePlayoff()`/`new PromotionPlayoff()` directamente — obtiene
  el runner ya vivo de `state.competitionEngine` y lo envuelve.
  `SpainLegacyCompetitionRuntime.js` queda RETIRADO de la ruta productiva
  (`index.html`/`game.js`/`spain-2026.1.js` no lo cargan/llaman) — sigue
  existiendo solo como shim de `scripts/test-world-core1.js`/
  `smoke-world-core1.js`/`smoke-club-core1.js`.
- `state.leagues`/`state.brackets` son SIEMPRE vistas construidas por
  `game.js` a partir de los runners reales de `state.competitionEngine`
  (`buildLeagueFacadeForCompetition()`/`buildBracketFacadeForStage()`/
  `buildPromotionPlayoffCompatView()`) — nunca un segundo estado
  sincronizado a mano. `createBracketsIfDue()` ya no decide con ramas por
  división/`currentRound` cuándo crear Copa/playoff: solo drena los
  hechos de activación que el engine ya procesó
  (`drainCompetitionActivationEvents()`) y publica la noticia
  correspondiente DESPUÉS del commit real.
- Separación de frontera con las entregas siguientes: COMP-CORE-1 posee
  identidad/edición/fase/formato/ejecución deportiva y el descriptor
  estable de partido; la cola cronológica de TODAS las competiciones/
  eventos mundiales es WORLD-CALENDAR-1; clasificación genérica entre
  fases/torneos, ascensos/descensos y plazas continentales declarativas
  son PATHWAYS-1. No adelantes ninguna de las dos desde aquí.
- Los shims legacy documentados en esta sección y en DESIGN.md 10.8/10.13
  NO autorizan código productivo nuevo que los use — solo scripts/tests
  históricos ya existentes.
