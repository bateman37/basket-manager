# Ficha de Epic — WORLD-CONTEXT-1 (contexto competitivo e identidades canónicas)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `WORLD-CONTEXT-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Contexto competitivo explícito e identidades canónicas Club/Team.
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/competitive-context-identity.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 10173-10398 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.20 WORLD-CONTEXT-1 — contexto competitivo e identidades canónicas

Corrección arquitectónica POSTERIOR a WORLD-HARDEN-1 (no añade contenido
jugable). Base: `origin/main` en `6345f32`. Rama
`claude/modest-gauss-ab8bat`. Cierra dos de los puntos de deuda explícita
de 10.19.2 (1 y 3); el resto sigue pendiente para `WORLD-CLEANUP-1`, que
retirará shims, vocabulario `division`, los mapas de fase de la UI y hará
la auditoría final. **World Architecture sigue SIN declararse cerrada.**

#### 10.20.1 Problemas corregidos

- **BUG-WORLD-CONTEXT-01** — normativa resuelta desde una división legacy:
  los ~22 call-sites productivos de
  `CompetitionRules.competitionIdFromLegacyDivision(team.division)` en los
  nueve servicios profesionales (`AnnualCycleService`,
  `ClubEmploymentContextCatalog`, `ContractSeeder`, `RegistrationSeeder`,
  `CpuRosterPlanner`, `MarketClearinghouse`, `RosterLegalityService`,
  `TransferService`, `LoanService`) quedan RETIRADOS. Un equipo puede
  participar a la vez en liga, Copa y (en el futuro) Europa: no posee una
  "división" universal, así que esa traducción era una suposición oculta.
- **BUG-WORLD-CONTEXT-02** — `clubId` que en realidad contenía `team.id`
  en el ciclo de plantilla (`ClubCycleCase`, `RosterLegalityReport`,
  `EmergencyRosterAction`, `AnnualRosterCycle.competitionMembershipSnapshot`,
  `LastOfficialMatchEvidenceCollector`, diagnósticos/planes). Desde
  CLUB-CORE-1 `Club.id !== Team.id` en los 36 clubes españoles, así que
  esa confusión ya no era solo de naming: producía comportamiento
  incorrecto (ver 10.20.4).
- **BUG-WORLD-CONTEXT-03** — fixture CONTRACT-1 obsoleto: el mundo de
  `scripts/test-contract1.js` se construía sin el `simulationProfile` que
  `spain-2026.1` exige desde WORLD-SIM-1 (1 FAIL desde entonces). Se
  corrigió el FIXTURE (mismo perfil transitorio que `game.js`), nunca la
  validación productiva.
- **BUG-WORLD-CONTEXT-04** — bonus de cesión codificado como ACB:
  `LoanService.evaluatePlayerReaction()` comparaba la competición del
  cesionario con `COMPETITION_IDS.ACB`. Ahora la señal es el NIVEL
  competitivo declarado (`CompetitionDefinition.tier`) resuelto desde la
  competición EXPLÍCITA del cesionario, con una configuración neutral
  (`LoanService.LOAN_ATTRACTIVENESS`: `topTierMax: 1`,
  `topTierBonus: 0.15`). La máxima categoría de CUALQUIER pirámide
  conserva el atractivo que tenía la ACB; un tier inferior o una
  competición sin tier declarado no reciben bonus (mismo balance
  observable en ACB/Primera FEB). `CPU_LOAN_POLICY_VERSION` pasa a
  `simulated-cpu-loan-policy-v2`.

#### 10.20.2 El contexto de competición es SIEMPRE explícito

Fuente CANÓNICA durante una carrera: las `CompetitionEntry` reales del
equipo. `src/core/CompetitionContextService.js` (nuevo, PURO, sin
literales de país/liga — auditado estáticamente) es la única utilidad de
resolución:

| Función | Para qué |
|---|---|
| `requireCompetitionId(id, ctx)` | guarda de frontera: un id ausente NUNCA se sustituye por un valor por defecto |
| `resolveDomesticCompetitionId(registries, teamId, {seasonKey, operation})` | liga doméstica PRINCIPAL desde las Entries de esa temporada |
| `makeDomesticCompetitionResolver(registries, {operation, seasonKey})` | resolver puro `(team, seasonKey) => competitionId` para operaciones batch |
| `competitionIdForTeamWith(resolver, team, {seasonKey, operation})` | aplica el resolver del llamador y VALIDA el resultado |
| `projectCompetitionIdByTeamId(resolver, teams, opts)` | proyección plana `{teamId: competitionId}` con orden estable |
| `resolverFromProjection(map, opts)` | resolver a partir de una proyección ya construida (bootstrap antes de existir Entries) |
| `domesticCompetitionIdFromResolvedEmployment(resolved, opts)` | lee el contexto YA CONGELADO en una resolución `employment` (propagación, no inferencia) |

Contrato de las APIs migradas:

- Operación sobre UN equipo → `domesticCompetitionId` explícito:
  `ClubEmploymentContextCatalog.buildEmploymentContext(team, club, {domesticCompetitionId})`,
  `ContractService.resolveEmploymentContext/resolveRulesForClub/createContract/validateDraft`,
  `ContractSeeder.seedContractForNewPlayer`,
  `RegistrationSeeder.seedRegistrationForNewPlayer`,
  `RosterLegalityService.buildReport({competitionId})`/`signPlayerForEmergency`,
  `AcademyService.promoteToFirstTeam`, `RenewalService.openRenewalCase`,
  `MarketService.validateOfferBeforeSend/createAndSendOffer`,
  `LoanService.evaluatePlayerReaction({borrowerCompetitionId})`.
- Operación ENTRE equipos → ids por PAPEL:
  `TransferService.buildTransferRulesContext`/`formalize*`
  (`originCompetitionId`/`destinationCompetitionId`),
  `TransferService.buildDestinationRegistrationCommand({destinationCompetitionId})`,
  `TransferService.resolveOriginRegistrationScope(team, seasonKey, date, originCompetitionId)`,
  `LoanService.buildLoanRulesContext`/`openCaseAndPropose`/`activateLoan`/
  `returnLoan`/`recallLoan`/`earlyTerminateLoan`
  (`ownerCompetitionId`/`borrowerCompetitionId`).
- Operación BATCH → resolver OBLIGATORIO `competitionIdForTeam(team, seasonKey)`:
  `ContractSeeder.seedContractsForTeams`/`buildCompetitionCalibration`,
  `RegistrationSeeder.seedRegistrationsForTeams`,
  `CpuRosterPlanner.buildSnapshot`, `AnnualCycleService.*` (todas las
  fases, vía `params.competitionIdForTeam`).
- Transición anual: la competición se resuelve por PAPEL de temporada — la
  de ORIGEN con `cycle.fromSeasonKey` (nómina congelada, tanteo,
  instantánea de apertura) y la de DESTINO con `targetSeasonKey`
  (planificación, legalidad, licencias/inscripciones). `closeSeasonHistory`
  ya NO tiene respaldo silencioso a `team.division`.
- `MarketClearinghouse` no vuelve a inferir competición: la ronda usa el
  contexto CONGELADO en el snapshot (`{teamId, clubId, competitionId}`).
- Sin contexto suficiente, cero o varias ligas primarias, resolver ausente
  o Entry de otra temporada → error con diagnóstico (`teamId`,
  `seasonKey`, operación). Nunca ACB por defecto, nunca "la primera del
  array", nunca la competición del próximo partido, nunca
  `team.competitionId` como campo nuevo.
- Resolver/consultar es una CONSULTA: no muta registros, no proyecta
  división y no consume aleatoriedad (verificado).

#### 10.20.3 Tabla semántica Club vs Team (obligatoria en código nuevo)

| Concepto | Id canónico |
|---|---|
| contrato, empleador, jurisdicción laboral, nómina, presupuesto, cantera/academia, derechos (tanteo), mandato/negociación, propietario/cesionario de una cesión, licencia federativa | **clubId** (`Club`) |
| `CompetitionEntry`, inscripción de competición, plantilla/`Squad`, acta de partido, evidencia de último partido, legalidad de plantilla, táctica/entrenamiento, `Player.teamId` | **teamId** (`Team`) |

Formas durables corregidas en esta entrega:

- `AnnualRosterCycle.competitionMembershipSnapshot`:
  `[{teamId, clubId, competitionId}]` (sin `division`), orden estable por
  `teamId`; el `openingWorldFingerprint` usa esos ids canónicos.
- `AnnualRosterCycle.clubLastOfficialMatchEvidence` →
  **`teamLastOfficialMatchEvidence`**, cada fila
  `{teamId, clubId, date, competitionId, phaseId, matchId, opponentTeamId, opponentClubId}`;
  `lastOfficialMatchDateForClub()` → `lastOfficialMatchDateForTeam()`.
- `ClubCycleCase`: `clubId` (institución) + `teamId` (equipo senior
  operativo) + `targetCompetitionId` + `employerJurisdictionId`; su id
  deriva del ciclo y del CLUB (`club-cycle:{cycleId}:{clubId}`);
  `targetDivision` RETIRADO.
- `ClubSquadPlan`: añade `teamId` junto a `clubId`.
- `RosterLegalityReport` y `EmergencyRosterAction`: `teamId` + `clubId`
  por separado (ambos obligatorios).
- `AnnualCycleRegistry`: legalidad y emergencias se indexan por `teamId`
  (`legalityReportsForTeam`/`latestLegalityReportForTeam`/
  `emergencyActionsForTeam`); expedientes/planes/renovaciones siguen por
  `clubId` real. `snapshot()` publica los dos ids.
- `SeasonHistoryService.LastOfficialMatchEvidenceCollector`: indexado por
  `teamId` (`record({teamId, clubId, ...})`,
  `recordMatch({homeTeamId, homeClubId, awayTeamId, awayClubId, ...})`,
  `forTeam()`, `missingTeamIds()`).
- `CpuRosterPlanner.buildSnapshot()`: filas de club con
  `{teamId, clubId, competitionId}` — `division` retirada del snapshot.

#### 10.20.4 Bugs de comportamiento REALES que esta corrección destapó

La confusión `clubId`/`teamId` no era solo naming: desde CLUB-CORE-1
producía resultados incorrectos, todos corregidos aquí.

1. **Nómina de apertura del ciclo = 0**:
   `AnnualCycleService.freezeSnapshot()` agregaba la nómina con `team.id`
   (`guaranteedPayrollForClub(registry, team.id, ...)`), y los contratos
   se indexan por `clubId` real → `openingPayrollReference` valía 0 para
   los 36 clubes, así que el presupuesto interno de la CPU caía siempre al
   suelo (`CycleConfig.BUDGET.floorMinor`). Ahora usa `team.clubId`.
2. **Expediente de club inencontrable desde el plan**: el expediente se
   creaba con `clubId: team.id` y `runClearingRound`/`CpuRosterPlanner` lo
   buscaban por `plan.clubId` (Club real) → ningún plan quedaba registrado
   en su expediente. Ahora todo el ciclo usa el `clubId` institucional.
3. **Consentimiento del usuario ignorado (BUG-CYCLE1-04 reintroducido de
   facto)**: `auditAllClubs()`/`reviewLoansAndOptions()`/
   `runAcademyDecisions()` comparaban `team.id === userClubId` (un id de
   Club) — la comparación NUNCA coincidía, así que el club del usuario
   recibía medidas de emergencia y decisiones automáticas sin haberlas
   delegado. Ahora comparan `team.clubId === userClubId`.
4. **Pantallas del usuario vacías**: `game.js` consultaba
   `contractRegistry.forClub(team.id)`, `guaranteedPayrollForClub(...,
   team.id, ...)`, `academyRegistry.activePoolForClub(team.id)`,
   `marketRegistry.threadsForClub(team.id)`/`watchlistForClub(team.id)` —
   todas indexadas por Club real, así que Contratos (nómina/compromisos),
   la cantera de Planificación, la lista de seguimiento y las
   negociaciones de Mercado salían siempre a 0/vacías. Ahora usan
   `team.clubId`.
5. **`prospectiveCompetitionIds` siempre vacío**: `MarketClearinghouse` y
   `RenewalService` leían `resolved.competitionId`, que no existe en una
   resolución de dominio `employment` (su contexto vive en
   `requestedContext`). Ahora llevan la competición doméstica real.

#### 10.20.5 Compatibilidad y límites

- `CompetitionRules.competitionIdFromLegacyDivision()` sigue EXPORTADO,
  sin ningún call-site productivo: solo lo usan fixtures históricos de
  `scripts/` claramente marcados (`fixtureCompetitionIdFor(team)`, que
  deriva de la división VIGENTE del fixture — nunca congelada, para que un
  ascenso dentro del propio smoke cambie su competición). Su retirada es
  de `WORLD-CLEANUP-1`.
- NO se retiran `Team.division`/`DIVISIONS`, `src/core/Calendar.js`,
  `SpainLegacyCompetitionRuntime.js` ni los mapas `stageKey` de la UI
  (WORLD-CLEANUP-1).
- Deuda de naming que SIGUE viva (documentada, no agravada):
  `RegistrationRegistry.registrationsForClub(...)`/`cumulativeCountForClub(...)`
  están indexadas por `registration.teamId` (comportamiento correcto,
  nombre engañoso), `RetirementAnnouncement.clubIdAtAnnouncement` guarda
  `player.teamId`, y `ContractSeeder.seedFingerprint`/
  `RegistrationSeeder.seedFingerprint` usan `team.id` como componente de
  hash (cambiarlo reescribiría TODOS los contratos/licencias simulados de
  una partida, así que se conserva a propósito).
- `state.lastOfficialMatchEvidence` (acumulador en vivo de `game.js`)
  sigue sin declararse en el inventario de
  `CareerPersistenceBoundary.inventory()` — dato durable de temporada sin
  propietario declarado, deuda anterior a esta entrega, propietario:
  la entrega de persistencia real.

#### 10.20.6 Verificación (resultados EXACTOS de esta sesión)

- `scripts/test-world-context1.js` (nuevo, batería dirigida): **20 OK, 0 FAIL**.
- Regresiones autorizadas: `test-contract1.js` **102 OK, 0 FAIL** (antes
  101 OK/1 FAIL), `test-reg1.js` **88 OK, 0 FAIL**, `test-market1.js`
  **82 OK, 0 FAIL**, `test-transfer1.js` **67 OK, 0 FAIL**,
  `test-loan1.js` **52 OK, 0 FAIL**, `test-cycle1.js` **42 OK, 0 FAIL**,
  `test-world-harden1.js` **20 comprobaciones OK**,
  `smoke-world-harden1.js` **OK**.
- Además (no exigidas, ejecutadas por tocar sus dominios):
  `test-club-core1.js` **36 OK, 0 FAIL**, `test-roster1.js` 31 OK,
  `test-world-ui1.js` 20 OK, `test-pathways1.js` 19 OK,
  `test-world-sim1.js` 19 OK, `test-world-calendar1.js` 25 OK,
  `test-national-teams1.js` 19 OK.
- Los seis smokes por EPIC quedan MIGRADOS a los contratos nuevos y
  pasando: `smoke-contract1.js` OK, `smoke-reg1.js` OK,
  `smoke-market1.js` OK, `smoke-transfer1.js` OK, `smoke-loan1.js` OK
  (**flaky preexistente**: falló una ejecución con
  `FORMATION_QUOTA_INFEASIBLE` y pasó a la siguiente sin cambios de
  código — misma clase de fallo no determinista que `smoke-reg1.js` ya
  producía en `main`; ese no determinismo de la vía de legalidad es deuda
  ANTERIOR a esta entrega), `smoke-cycle1.js` **OK (10 temporadas,
  330 s)**. `smoke-roster1.js`/`smoke-world-ui1.js`/`smoke-world-sim1.js`/
  `smoke-national-teams1.js` siguen OK.
- Siguen ROTOS por deuda ajena a esta entrega (no se tocaron):
  `smoke-world-core1`/`smoke-club-core1`/`smoke-comp-core1`/
  `smoke-world-calendar1`/`smoke-pathways1` construyen un mundo sin
  `simulationProfile` (mismo fallo que 10.19.2 punto 7 ya documentaba, y
  que aquí solo se corrigió para `test-contract1.js`). Los verificadores
  Playwright (`verify-*-playwright.js`) reciben los parámetros nuevos pero
  NO se ejecutaron (fuera de alcance) y `verify-loan1-playwright.js` sigue
  usando `state.leagues[state.division]`, retirado en WORLD-HARDEN-1.

_Migrado de `CHANGELOG.md` (líneas 261-427 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-07 — WORLD-CONTEXT-1: contexto competitivo explícito e identidades canónicas Club/Team (DESIGN.md 10.20)

Corrección arquitectónica POSTERIOR a WORLD-HARDEN-1 — no añade contenido
jugable. Base real: `origin/main` en `6345f32` (merge de la PR de
WORLD-HARDEN-1). Rama `claude/modest-gauss-ab8bat`.

### Bugs corregidos

- **BUG-WORLD-CONTEXT-01** — la normativa (contratos, inscripciones,
  mercado, traspasos, cesiones, ciclo anual, planificación CPU, legalidad)
  se resolvía traduciendo `team.division` con
  `CompetitionRules.competitionIdFromLegacyDivision()`: ~22 call-sites
  productivos en nueve servicios. Un equipo puede competir a la vez en
  liga, Copa y (futuro) Europa, así que su "división" era una suposición,
  no un dato. Ya NO queda ningún call-site productivo.
- **BUG-WORLD-CONTEXT-02** — `clubId` contenía en realidad `team.id` en el
  ciclo de plantilla. Desde CLUB-CORE-1 los 36 clubes españoles tienen
  `Club.id !== Team.id`, así que no era solo naming: rompía comportamiento
  (ver "Bugs de comportamiento destapados").
- **BUG-WORLD-CONTEXT-03** — `scripts/test-contract1.js` construía un
  mundo sin `simulationProfile` (obligatorio desde WORLD-SIM-1) y llevaba
  `101 OK, 1 FAIL` desde entonces. Corregido el FIXTURE, nunca la
  validación productiva.
- **BUG-WORLD-CONTEXT-04** — `LoanService.evaluatePlayerReaction()` daba
  un bonus comparando con `COMPETITION_IDS.ACB`. Ahora usa el NIVEL
  competitivo declarado (`CompetitionDefinition.tier`) de la competición
  EXPLÍCITA del cesionario, con configuración neutral
  (`LOAN_ATTRACTIVENESS`: tier <= 1 → +0,15; resto → 0), mismo balance
  observable en ACB/Primera FEB. `CPU_LOAN_POLICY_VERSION` →
  `simulated-cpu-loan-policy-v2`.

### Qué se implementó

- **`src/core/CompetitionContextService.js`** (nuevo, PURO, sin literales
  de país/liga): `requireCompetitionId`, `resolveDomesticCompetitionId`,
  `makeDomesticCompetitionResolver`, `competitionIdForTeamWith`,
  `projectCompetitionIdByTeamId`, `resolverFromProjection`,
  `domesticCompetitionIdFromResolvedEmployment`. Resuelve SIEMPRE desde
  las `CompetitionEntry` reales (vía
  `CompetitionParticipationService.primaryLeagueCompetitionId`); no crea
  registro ni caché durable.
- **Nueve servicios migrados** a contexto explícito: `AnnualCycleService`,
  `ClubEmploymentContextCatalog`, `ContractSeeder`, `RegistrationSeeder`,
  `CpuRosterPlanner`, `MarketClearinghouse`, `RosterLegalityService`,
  `TransferService`, `LoanService`. Consumidores actualizados en cadena:
  `ContractService` (`resolveEmploymentContext`/`resolveRulesForClub`/
  `createContract`/`validateDraft`), `MarketService`
  (`validateOfferBeforeSend`/`createAndSendOffer`), `RenewalService`
  (`openRenewalCase`), `AcademyService` (`promoteToFirstTeam`),
  `TransferExecutionService` (revalidación del borrador de destino) y
  `src/ui/game.js`.
- **Contrato de las firmas**: un equipo → `domesticCompetitionId`; entre
  equipos → ids por PAPEL (`origin`/`destination`/`owner`/`borrower`);
  batch → resolver obligatorio `competitionIdForTeam(team, seasonKey)`.
  La transición anual distingue ORIGEN (`cycle.fromSeasonKey`) y DESTINO
  (`targetSeasonKey`). Sin contexto suficiente, cero o varias ligas
  primarias, o resolver ausente → error con diagnóstico (`teamId`,
  `seasonKey`, operación) y sin aplicar nada a medias.
- **`src/ui/game.js`**: punto ÚNICO `domesticCompetitionIdForTeam(team,
  seasonKey)` + `buildDomesticCompetitionResolver()` (resuelven por
  Entries reales). Ya no hay ninguna lectura productiva del adaptador
  legacy en la interfaz.

### Cambios de forma DURABLE (mismo PR: entidades, registro y proyector)

- `AnnualRosterCycle.competitionMembershipSnapshot`:
  `[{teamId, clubId, competitionId}]` (sin `division`), orden estable.
- `AnnualRosterCycle.clubLastOfficialMatchEvidence` →
  **`teamLastOfficialMatchEvidence`** `{teamId, clubId, date,
  competitionId, phaseId, matchId, opponentTeamId, opponentClubId}`;
  `lastOfficialMatchDateForClub()` → `lastOfficialMatchDateForTeam()`.
- `ClubCycleCase`: `clubId` + `teamId` + `targetCompetitionId` +
  `employerJurisdictionId`; id `club-cycle:{cycleId}:{clubId}`;
  `targetDivision` retirado.
- `ClubSquadPlan.teamId` nuevo; `RosterLegalityReport` y
  `EmergencyRosterAction` con `teamId` + `clubId` obligatorios.
- `AnnualCycleRegistry`: `legalityReportsForTeam`/
  `latestLegalityReportForTeam`/`emergencyActionsForTeam` (indexados por
  `teamId`); `snapshot()` publica ambos ids.
- `SeasonHistoryService.LastOfficialMatchEvidenceCollector` indexado por
  `teamId` (`record`/`recordMatch`/`forTeam`/`missingTeamIds`).
- `CpuRosterPlanner.buildSnapshot()`: filas de club
  `{teamId, clubId, competitionId}`, sin `division`.

### Bugs de comportamiento destapados (y corregidos) por la limpieza de identidades

1. `AnnualCycleService.freezeSnapshot()` agregaba la nómina con `team.id`
   → `openingPayrollReference` = 0 en los 36 clubes, así que el
   presupuesto CPU caía siempre al suelo.
2. El expediente de club se creaba con `clubId: team.id` y se buscaba por
   `plan.clubId` (Club real) → ningún plan CPU quedaba registrado en su
   expediente.
3. `auditAllClubs`/`reviewLoansAndOptions`/`runAcademyDecisions`
   comparaban `team.id === userClubId` (id de Club) → nunca coincidía, y
   el club del usuario recibía emergencias/decisiones automáticas sin
   delegarlas (BUG-CYCLE1-04 de facto reintroducido).
4. `game.js` consultaba contratos/nómina/cantera/mercado con `team.id` →
   Contratos, cantera de Planificación, seguimiento y negociaciones de
   Mercado salían vacías o a 0.
5. `MarketClearinghouse`/`RenewalService` leían `resolved.competitionId`
   (inexistente en dominio `employment`) → `prospectiveCompetitionIds`
   siempre vacío.
6. Detectados al verificar el ciclo completo: el clearinghouse abría el
   expediente de renovación y formalizaba fichajes de libre/promociones de
   cantera SIN contexto explícito (renovaciones y fichajes CPU se
   quedaban en `failed`) — corregido propagando la competición de la
   ronda.

### Pruebas y resultados EXACTOS

- `node scripts/test-world-context1.js` (nuevo): **25 OK, 0 FAIL**.
- `node scripts/test-contract1.js`: **102 OK, 0 FAIL** (antes 101 OK/1 FAIL).
- `node scripts/test-reg1.js`: **88 OK, 0 FAIL**.
- `node scripts/test-market1.js`: **82 OK, 0 FAIL**.
- `node scripts/test-transfer1.js`: **67 OK, 0 FAIL**.
- `node scripts/test-loan1.js`: **52 OK, 0 FAIL**.
- `node scripts/test-cycle1.js`: **42 OK, 0 FAIL**.
- `node scripts/test-world-harden1.js`: **OK (20 comprobaciones)**.
- `node scripts/smoke-world-harden1.js`: **OK**.
- Extras no exigidos, ejecutados por tocar sus dominios:
  `test-club-core1.js` **36 OK, 0 FAIL**, `test-roster1.js` 31 OK,
  `test-world-ui1.js` 20 OK, `test-pathways1.js` 19 OK,
  `test-world-sim1.js` 19 OK, `test-world-calendar1.js` 25 OK,
  `test-national-teams1.js` 19 OK.
- Smokes por EPIC migrados a los contratos nuevos y pasando:
  `smoke-contract1.js` OK, `smoke-reg1.js` OK, `smoke-market1.js` OK,
  `smoke-transfer1.js` OK, `smoke-loan1.js` OK (flaky PREEXISTENTE: una
  ejecución falló con `FORMATION_QUOTA_INFEASIBLE` y la siguiente pasó sin
  tocar código — mismo no determinismo que `smoke-reg1.js` ya producía en
  `main`), `smoke-cycle1.js` **OK (10 temporadas, 330 s)**,
  `smoke-roster1.js`/`smoke-world-ui1.js`/`smoke-world-sim1.js`/
  `smoke-national-teams1.js` OK.
- `node --check` sobre cada archivo modificado y `git diff --check`
  limpios.

### Fuera de alcance (sigue pendiente)

- `WORLD-CLEANUP-1`: retirada de `competitionIdFromLegacyDivision()`,
  `Team.division`/`DIVISIONS`, `Calendar.js`,
  `SpainLegacyCompetitionRuntime.js`, mapas `stageKey` de la UI, grafo
  completo de pathways en Career Setup y auditoría final de determinismo
  (puntos 2, 4, 5, 6, 7 y 8 de DESIGN.md 10.19.2).
- Deuda de naming que sigue viva (documentada en DESIGN.md 10.20.5):
  `RegistrationRegistry.registrationsForClub`/`cumulativeCountForClub`
  (indexados por `teamId`), `RetirementAnnouncement.clubIdAtAnnouncement`,
  y los `seedFingerprint` de `ContractSeeder`/`RegistrationSeeder` (usan
  `team.id` como componente de hash: cambiarlo reescribiría todos los
  contratos/licencias simulados, se conserva a propósito).
- `state.lastOfficialMatchEvidence` sigue sin propietario declarado en
  `CareerPersistenceBoundary.inventory()` (deuda anterior a esta entrega).
- Siguen rotos por deuda AJENA a esta entrega (no se tocaron):
  `smoke-world-core1`/`smoke-club-core1`/`smoke-comp-core1`/
  `smoke-world-calendar1`/`smoke-pathways1` construyen un mundo sin
  `simulationProfile` (mismo fallo que DESIGN.md 10.19.2 punto 7 ya
  documentaba; aquí solo se corrigió el de `test-contract1.js`).
- Los verificadores Playwright reciben los parámetros nuevos pero NO se
  ejecutaron (fuera de alcance); `verify-loan1-playwright.js` además sigue
  usando `state.leagues[state.division]`, retirado en WORLD-HARDEN-1.
- El no determinismo de la vía de legalidad de convocatoria en smokes
  largos (`FORMATION_QUOTA_INFEASIBLE` intermitente) es anterior a esta
  entrega y sigue sin diagnosticar.

### Estado

Queda pendiente **WORLD-CLEANUP-1**. **World Architecture NO se declara
cerrada** con esta entrega.
