# Arquitectura — niveles de detalle y simulación mundial (WORLD-SIM-1)

_Migrado de `CLAUDE.md` (líneas 1204-1301 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### WORLD-SIM-1 (DESIGN.md 10.16) — niveles de detalle y simulación mundial acotada

Convenciones permanentes de WORLD-SIM-1 (6ª entrega de World Architecture)
— aplican a toda sesión futura que toque cuánto se simula una
competición/equipo, `CompetitionSimulationService.js`,
`AbstractCompetitionStageRuntime.js`, `WorldSimulation.js`, población
mundial o disponibilidad de mercado:

- Vocabulario CERRADO `playable > full > standard > abstract`
  (`src/entities/WorldSimulation.js`, `DETAIL_LEVELS`) — ningún nivel
  desconocido recibe fallback. `capabilitiesForDetailLevel(level)` deriva
  SIEMPRE las capacidades (`allowsUserMatchStop`, `resolutionKind`,
  `hasIndividualMatchDetail`, `requiredRosterCoverage`) — nunca un
  booleano suelto guardado aparte que pueda contradecir al nivel.
- `WorldSimulationProfile` pertenece a la CARRERA (`GameWorld.
  simulationProfile`, asignado ANTES de instalar ningún paquete de
  contenido), nunca al paquete — un paquete declara formato/calendario/
  reglas/pathways, nunca cuánto quiere simular el usuario. Resolución
  SIEMPRE por identidad: competición exacta → área más cercana → default
  explícito, nunca por `division`/nombre/país supuesto.
  `CompetitionEdition.detailLevel` es OBLIGATORIO y se congela al crearse
  (BUG-WORLDSIM-01) — código nuevo que cree una Edition SIEMPRE resuelve
  el nivel explícito primero (`CompetitionSimulationService.
  resolveDetailLevelForCompetition()`), nunca omite el campo ni lo copia
  de otra Edition (un pathway/transición anual resuelve el nivel del
  DESTINO, nunca hereda el de la fuente).
- `playable`/`full` reutilizan el `MatchEngine` actual SIN CAMBIOS
  (mismo balance, mismo shape de resultado) — nunca pasan por
  `CompetitionSimulationService`. `standard` produce un marcador COMPACTO
  determinista (`computeStandardResult()`, algoritmo `standard-score-v1`,
  fingerprint `careerSeed+algoritmo+editionId+stageId+matchId` vía
  `DeterministicRandom`, nunca `Math.random()`) inyectado como
  `MatchEngine.options.precomputedResult` — nunca fabrica
  `quarterScores`/box score, nunca deja empate. `abstract` NUNCA crea
  partidos individuales: `AbstractCompetitionStageRuntime` resuelve una
  fase entera en un ÚNICO hito con fecha/huso explícitos, dejando
  EXACTAMENTE un `CompetitionSimulationReceipt` plano
  (`provenance: 'estimated'`), idempotente por id de hito. Usa
  `WorldSimulation.hasIndividualMatchDetail(result)` para distinguir un
  resultado completo de uno compacto — nunca adivinar mirando campos
  ausentes.
- **Límite consciente de esta entrega**: `abstract` solo soporta formatos
  de UNA sola fase resoluble (round-robin, o bracket con participantes en
  potencia de 2) — un formato multi-fase o un bracket de tamaño no
  potencia de 2 bloquean ANTES de mutar nada. Una fase abstracta
  multi-stage con hitos intermedios queda fuera de alcance; proponerlo
  antes de construirlo.
- Un solo `WorldCalendar` ordena TODO — la fuente nueva
  `competition-simulation` (`WorldCalendarCoordinator.js`) nunca es parada
  del usuario. Un Team controlado inscrito en una Edition NO `playable` es
  configuración inválida, detectada por `requiresUser()` ANTES de avanzar
  (lanza explícito) — nunca se autosimula a escondidas.
- Un Club/Team/Squad exterior (nivel `standard`/`abstract`) sigue siendo
  un Club/Team/Squad NORMAL del mismo modelo mundial — la categoría
  `'external-abstract'` de `WorldLifecycleService` y su hook
  `externalClubMembership` quedan RETIRADOS (BUG-WORLDSIM-04, sin
  call-sites reales nunca). Un Player en el Squad activo de cualquier Team
  clasifica `senior-service-roster` en cuanto ese Team llega en
  `deps.teams` — nunca una categoría/ontología aparte.
- Población MATERIALIZADA (Player Registry) frente a ESTIMADA
  (`TeamSimulationSnapshot.estimatedRosterSize`) son conceptos DISTINTOS —
  la estimación nunca crea identidades ni infla el Player Registry.
- `MarketService.resolveMarketAvailability()`: un Player afiliado
  (`player.teamId` no nulo) sin contrato vigente devuelve
  `'affiliated-contract-unknown'` (BUG-WORLDSIM-05) — NUNCA `'free'`. Ese
  estado no permite negociación ni traspaso; en la partida española esto
  nunca ocurre en la práctica (expiración orgánica limpia `teamId`), pero
  protege cualquier Team `standard`/`abstract` futuro sin bootstrap
  contractual propio.
- Cohorte INTERACTIVO (`CompetitionSimulationService.
  interactiveCohortTeams(seasonKey)`, BUG-WORLDSIM-06): los sistemas
  españoles que aplican bootstrap a TODOS los equipos (contratos,
  inscripción, ciclo anual — `bootstrapContractsForNewCareer()`,
  `bootstrapRegistrationsForNewCareer()`, `closeSeasonAndPrepareNext()` en
  `game.js`, vía el helper `interactiveCohortTeams()`) usan SIEMPRE este
  cohorte (equipos con Entry en una Edition `playable`), nunca
  `getAllTeams()` a secas — instalar un Team `standard`/`abstract` no le
  aplica reglas españolas por accidente. `getAllTeams()` conserva su
  semántica de "todos los Teams registrados" para búsquedas/diagnóstico,
  sin cambios.
- Todo resultado/resumen `standard`/`abstract` depende del fingerprint
  estable, nunca del orden de arrays/`Map`/registro — auditado con
  fixtures de orden invertido en `scripts/test-world-sim1.js`/
  `scripts/smoke-world-sim1.js`. Consultar/renderizar (hitos pendientes,
  standings antes de resolver) nunca muta ni consume aleatoriedad.
- `CompetitionEngine` recibe `simulationService`
  (`CompetitionSimulationService`) INYECTADO y OPCIONAL — sin él, se
  comporta exactamente igual que antes de esta entrega (todo fixture/test
  histórico que no lo inyecta nunca construye una Edition
  `standard`/`abstract`). La partida española SÍ lo construye e inyecta
  (`state.competitionSimulationService`), aunque hoy quede inerte (ACB/
  Primera FEB/Copa son `playable`).
- Perfil transitorio de la partida actual (`game.js`, `startSeason()`):
  ACB/Primera FEB/Copa ACB → `playable`; default → `abstract`. Es
  configuración de ARRANQUE de interfaz, no regla de `DESIGN.md` — no
  reinterpretarla como si fuera selección real de nivel (eso es
  WORLD-UI-1).
