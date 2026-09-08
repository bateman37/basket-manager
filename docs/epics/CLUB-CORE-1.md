# Ficha de Epic — CLUB-CORE-1 (Club, Team y Squad)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `CLUB-CORE-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Separar Club, Team y Squad como entidades distintas.
- **Documento(s) canónico(s) vigente(s)**: `docs/architecture/club-team-squad.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `DESIGN.md` (líneas 8370-8490 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 10.12 CLUB-CORE-1 — resultado

Segunda entrega de la EPIC (ver 10.1). Retira la deuda que WORLD-CORE-1
dejó señalada explícitamente en 10.3/10.8: `club.id === primaryTeam.id`
como invariante de `spain-2026.1`, y finanzas/instalaciones/junta/afición
viviendo en `Team` en vez de en `Club`.

**Modelo**: `Club` (identidad institucional — quién emplea, quién negocia,
quién tiene la cantera) y `Team` (sección deportiva — quién compite, quién
entrena) son entidades DISTINTAS con ids DISTINTOS, vinculadas por
`team.clubId`/`team.club`. `Squad` (nueva, `src/entities/Squad.js`) es el
contenedor operativo real de jugadores de un `Team` — `Team.roster` pasa a
ser una vista de compatibilidad sobre el squad activo, nunca un array
paralelo. Tabla de identidad (nunca violada, auditada por los tests
dirigidos): contrato/mandato/negociación/tanteo/traspaso/cesión/cantera/
licencia federativa → **clubId**; `CompetitionEntry`/inscripción/partido/
táctica/entrenamiento/`Player.teamId` → **teamId**; contenedor operativo →
**squadId**.

**BUG-WORLDCORE-09 corregido**: `Team.validateDivision(undefined)` ya no
devuelve `'1ª'` en silencio — devuelve `null` (y por tanto
`legacyDivision: null`); un valor explícito no reconocido sigue lanzando;
el contenido español sigue pasando `'1ª'`/`'2ª'` explícitos sin cambiar de
forma.

**Migración de los 36 clubes/equipos reales**: `data/world/spain-2026.1.js`
declara una tabla EXPLÍCITA de 36 pares `clubId`/`teamId` distintos
(`SPAIN_CLUB_CONTENT`, nunca derivada por sufijo/regla genérica) —
`club-real-madrid`/`team-real-madrid`, `club-morabanc-andorra`/
`team-morabanc-andorra`, etc. Cada equipo real conserva su estado
institucional de bootstrap (facilities/board/fanbase/finances/budget/
foundationYear/clubDNA/reputación financiera y de cantera) LEÍDO antes de
enlazar un `Club` real, así que ningún dato institucional generado se
pierde ni se recalibra al migrar. `ClubEmploymentContextCatalog.js` deja de
ser una segunda tabla de 36 entradas indexada por `teamId`: la identidad,
jurisdicción y afiliación de cada club se resuelven SIEMPRE desde el `Club`
real instalado (`team.club`) y las áreas/organizaciones del mundo — un
equipo vivo sin `Club` real enlazado falla explícito
(`CLUB-CORE-1 exige un Club real enlazado`), nunca hereda España/ACB por
defecto.

**Migración de dominio**: Contract/Registration/Market/Transfer/Loan/
Academy/Cycle (ROSTER-1..CYCLE-1) migrados campo a campo, por semántica,
nunca mecánicamente: todo campo `clubId`-shaped (empleador, mandato,
negociación, tanteo, compra-venta, cesión propietaria/cesionaria, cantera,
licencia) pasa a usar el `clubId` real; todo campo `teamId`-shaped
(inscripción, `CompetitionEntry`, afiliación de plantilla, `Player.teamId`)
sigue usando el `teamId` real. `RosterMutationService` sigue siendo la
ÚNICA frontera de `Team.roster`/`player.teamId`, ahora operando sobre
`Squad` por debajo. `EligibilityService.evaluateEligibility()` exige un
`deps.clubId` explícito (el Club real del equipo evaluado) para resolver el
empleador del contrato — sin él, ningún jugador con contrato real puede
declararse elegible (detectado y corregido en varios scripts de humo
durante la regresión, ver más abajo).

**Compatibilidad que permanece** (documentada, con destino de retirada
cuando corresponda): `Team.roster` como vista del `Squad` activo
(decisión PERMANENTE, no deuda); accesores institucionales legacy en
`Team` que delegan en `Club` (permanente, mismo criterio); un `Team`
aislado de tests/modo prueba sin `Club` real conserva un pequeño estado de
bootstrap institucional antes de enlazar (permanente, documentado en
CLAUDE.md); fixtures de test antiguos con `clubId === teamId` explícito
(legacy, nunca contenido nuevo real). **Deuda identificada pero
DELIBERADAMENTE no tocada esta entrega** (naming-only, campos
`clubId`/`opponentClubId` que en realidad guardan un `team.id` en
entidades de contabilidad/diagnóstico del dominio Cycle —
`ClubCycleCase`, `RosterLegalityReport`, `EmergencyRosterAction`, la
evidencia de `SeasonHistoryService`/`cycle1-harness.js` —, nunca
cruzados contra un `Club` real en ningún sitio, así que no rompen ninguna
regla; se dejan para una entrega futura que documente y renombre esta
categoría completa en vez de tocarla campo a campo sin plan).

**Verificación dirigida** (nunca la matriz completa de la EPIC anterior):

- `node scripts/test-club-core1.js`: 36 comprobaciones dirigidas — ids
  distintos Club/Team/Squad, un Club con varias secciones, unicidad de
  squad activo por equipo y de jugador por squad activo, `Team.roster`
  como vista real del squad, serialización por ids, migración
  institucional sin copias mutables, BUG-WORLDCORE-09,
  `ClubEmploymentContextCatalog` sin fallback a España, `ClubStructureService`
  (frontera pura Club↔Team↔Squad), paquete de test SIN España/ACB, y los
  36 clubes/equipos reales (MoraBanc Andorra, Contract.clubId/
  License.clubId/Registration.teamId, AcademyMembership.clubId +
  promoción real al Team). **36 OK, 0 fallos.**
- `node scripts/smoke-club-core1.js`: reutiliza EXACTAMENTE la
  construcción de `smoke-world-core1.js` (36 equipos reales, `world-core-
  2026.1`+`spain-2026.1`, registros de dominio) y añade las
  comprobaciones específicas de esta entrega, UNA temporada completa +
  UNA transición anual con el arnés de CYCLE-1, revalidando identidad
  Club/Team/Squad y el caso MoraBanc Andorra tanto antes como después de
  la transición (sin cambio de división en la ejecución registrada).
  **OK en ~6s.**
- Regresión completa de la EPIC anterior, TODA vuelta a pasar tras
  parchear sus fixtures (helpers de construcción de equipo de prueba
  actualizados para enlazar un `Club` real — legacy `clubId === teamId` —
  y, donde hacía falta, pasar `deps.clubId`/`opponentClubId` real a
  `EligibilityService`, nunca lógica de dominio nueva): `test-world-core1.js`
  (27 OK, 2 fixtures corregidos: MoraBanc/Real Madrid ya no comparten
  `clubId`/`teamId`), `smoke-world-core1.js` (OK), `test-roster1.js` (31 OK,
  sin cambios), `test-contract1.js` (102 OK, 2 fixtures corregidos),
  `smoke-contract1.js` (OK, 3 temporadas), `test-reg1.js` (88 OK, 3
  fixtures corregidos), `smoke-reg1.js` (OK, 3 temporadas — bug real
  detectado y corregido: el pool elegible del smoke no pasaba `deps.clubId`),
  `test-transfer1.js` (67 OK, 1 fixture corregido), `smoke-transfer1.js`
  (OK, 3 temporadas), `test-loan1.js` (52 OK, 2 fixtures corregidos),
  `smoke-loan1.js` (OK, 3 temporadas), `test-market1.js` (82 OK, 3 fixtures
  corregidos), `smoke-market1.js` (OK, 3 temporadas), `test-cycle1.js` (42
  OK, 1 fixture corregido), `smoke-cycle1.js` (OK, 10 temporadas
  completas). `node --check` sobre todos los archivos `.js` modificados/
  nuevos y `git diff --check`: sin errores. **0 fallos en toda la
  regresión.** Checklist manual (móvil/escritorio, Playwright) sigue
  diferida a Dennis al terminar la EPIC completa (mismo criterio que
  10.11).

**Fuera de alcance de esta entrega** (igual que 10.7, sin cambios):
persistencia SQL/save-load real, motor genérico de competiciones
(COMP-CORE-1), calendario mundial único (WORLD-CALENDAR-1), transfer
internacional (EUROPE-1 replanteado), traspasos/cesiones CPU-a-CPU
orgánicos, `SpainLegacyCompetitionRuntime`/`League`/`Bracket`/`Cup`/
`Playoffs`/`Promotion` (siguen intactos), datos reales modificados.

_Migrado de `CHANGELOG.md` (líneas 1656-1813 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-09-05 — CLUB-CORE-1: separar Club, Team y Squad (DESIGN.md sección 10.12)

Segunda entrega de la EPIC **World Architecture** (WORLD-CORE-1 →
**CLUB-CORE-1** → COMP-CORE-1 → WORLD-CALENDAR-1 → PATHWAYS-1 →
WORLD-SIM-1 → NATIONAL-TEAMS-1 → WORLD-UI-1 → WORLD-HARDEN-1). Base:
`dd18234` (`origin/main`, merge de la PR #46 WORLD-CORE-1). Rama
`feat/club-core-1`. Retira la deuda que WORLD-CORE-1 dejó señalada
explícitamente (DESIGN.md 10.3/10.8 de entonces): `club.id ===
primaryTeam.id` como invariante de `spain-2026.1`, y finanzas/
instalaciones/junta/afición viviendo en `Team` en vez de en `Club`.

### BUG-WORLDCORE-09 (corregido)

`Team.validateDivision(undefined)` devolvía `'1ª'` en silencio pese a que
WORLD-CORE-1 ya afirmaba que no había fallback universal a la primera
división. Corregido: sin división explícita, `division`/`legacyDivision`
quedan `null`; un valor explícito no reconocido sigue lanzando; el
contenido español sigue pasando `'1ª'`/`'2ª'` explícitos sin cambiar de
forma.

### Modelo: Club, Team y Squad

- **`Club`** (`src/entities/Club.js`, ampliada): además de identidad/
  jurisdicción/afiliación (WORLD-CORE-1), pasa a ser la fuente CANÓNICA de
  `foundationYear`, `budget`, `reputationFinancial`/`reputationYouth`,
  `facilities` (las 7), `board`, `fanbase`, `finances`, `clubDNA` — antes
  vivían en `Team`.
- **`Squad`** (`src/entities/Squad.js`, nueva): contenedor operativo real
  de jugadores de un `Team` — `id`, `teamId`, `squadType`, `status`,
  `players` (instancias reales), `dataSource`/`provenance`.
  `Team.roster` pasa a ser una VISTA de compatibilidad del squad activo
  (misma referencia de array). `SquadRegistry` (nueva colección de
  `WorldRegistries`) exige un squad activo por equipo y un jugador en como
  máximo un squad activo de todo el mundo.
- **`Team`** (ampliado): `role` (`first-team|reserve|youth|other`),
  `category` (`{gender, ageTier}`), `teamType` legacy derivado (sigue
  produciendo `'senior-men-first-team'` por defecto — ninguna forma
  existente cambia), `squad`/`primarySquadId`. Las antiguas propiedades
  institucionales sobreviven como accesores que DELEGAN en la MISMA
  instancia de `Club` en cuanto `team.club` está enlazado (nunca una
  segunda copia mutable); un `Team` aislado (modo bootstrap/tests legacy)
  conserva su propio estado institucional pequeño con la misma forma de
  antes.
- **`ClubStructureService.js`** (nuevo): frontera PURA que resuelve
  relaciones Club↔Team↔Squad a partir de `WorldRegistries` — nunca lee
  `state`/DOM, nunca asume `clubId === teamId`.

### Migración de los 36 clubes/equipos reales

`data/world/spain-2026.1.js` declara una tabla EXPLÍCITA de 36 pares
`clubId`/`teamId` DISTINTOS (`SPAIN_CLUB_CONTENT`, nunca derivada por
sufijo) — `club-real-madrid`/`team-real-madrid`,
`club-morabanc-andorra`/`team-morabanc-andorra`, etc. Cada equipo real
conserva su estado institucional de bootstrap (facilities/board/fanbase/
finances/budget/foundationYear/clubDNA/reputación) LEÍDO antes de enlazar
un `Club` real — ningún dato generado se pierde ni se recalibra.
`ClubEmploymentContextCatalog.js` deja de ser una segunda tabla de 36
entradas indexada por `teamId`: identidad/jurisdicción/afiliación se
resuelven SIEMPRE desde el `Club` real instalado (`team.club`) — un
equipo vivo sin Club real enlazado falla explícito, nunca hereda España/
ACB por defecto. Se añade el perfil de jurisdicción `XX`/
`TEST_JURISDICTION_AREA_ID` (ya declarado antes, sin cablear) para
demostrar que un país nuevo es una entrada de catálogo, nunca una rama de
código.

### Migración de dominio (Contract/Registration/Market/Transfer/Loan/Academy/Cycle)

Todo campo `clubId`-shaped (empleador, mandato, negociación, tanteo,
compra-venta, cesión propietaria/cesionaria, cantera, licencia federativa)
migrado a usar el `clubId` real; todo campo `teamId`-shaped (inscripción,
`CompetitionEntry`, afiliación de plantilla, `Player.teamId`) sigue con el
`teamId` real — auditado por SEMÁNTICA, nunca mecánicamente (`ContractService`,
`ContractSeeder`, `ContractRegistry`, `RegistrationService`,
`RegistrationSeeder`, `RegistrationRegistry`, `EligibilityService`,
`RosterLegalityService`, `AcademyService`, `AcademyRegistry`,
`WorldLifecycleService`, `TransferService`, `TransferExecutionService`,
`TransferRegistry`, `LoanService`, `LoanExecutionService`, `LoanRegistry`,
`MarketService`, `MarketClearinghouse`, `MarketRegistry`,
`CpuRosterPlanner`, `AnnualCycleService`, `ContractExpiryService`).
`EligibilityService.evaluateEligibility()` exige `deps.clubId` explícito
(el Club real del equipo evaluado) — sin él, la comparación
`contract.clubId !== deps.clubId` declara ineligible a casi cualquier
jugador con contrato real. `game.js` añade `state.userClubId` junto a
`state.userTeamId` (nunca intercambiados: pantallas institucionales usan
el primero, pantallas deportivas el segundo, ambos se limpian juntos al
volver a selección de equipo) y un bloque de solo lectura "Club y
estructura deportiva" en Home (club, primer equipo controlado, secciones
del club, squad activo + jugadores, cantera activa, jurisdicción/
afiliación con etiquetas legibles, ids técnicos en un `<details>`
plegado).

### Compatibilidad que permanece (y deuda deliberadamente no tocada)

`Team.roster` como vista del squad activo y los accesores institucionales
delegados son decisiones PERMANENTES, no deuda. Un `Team` aislado de
tests/modo prueba sin `Club` real sigue con su bootstrap propio
(documentado). Fixtures de test antiguos con `clubId === teamId` explícito
siguen permitidos. **Deuda identificada pero deliberadamente NO tocada
esta entrega** (naming-only, nunca cruzada contra un Club real): campos
`clubId` que en realidad guardan un `team.id` en entidades de
contabilidad/diagnóstico del dominio Cycle (`ClubCycleCase`,
`RosterLegalityReport`, `EmergencyRosterAction`, evidencia de
`SeasonHistoryService`/`cycle1-harness.js`) — para una entrega futura que
lo documente y renombre de una vez, nunca campo a campo sin plan.

### Verificación

`node scripts/test-club-core1.js`: 36 comprobaciones dirigidas (ids
distintos Club/Team/Squad, secciones múltiples de un Club, unicidad de
squad activo/jugador, `Team.roster` como vista real, serialización por
ids, migración institucional sin copias, BUG-WORLDCORE-09, contexto
laboral sin fallback a España, `ClubStructureService`, paquete de test sin
España/ACB, los 36 reales con MoraBanc/Contract/Registration/Academy).
**36 OK, 0 fallos.** `node scripts/smoke-club-core1.js`: reutiliza la
construcción de `smoke-world-core1.js` (36 equipos reales) + comprobaciones
propias, UNA temporada completa + UNA transición anual con el arnés de
CYCLE-1, MoraBanc Andorra revalidado antes y después de la transición.
**OK en ~6s.**

Regresión completa de la EPIC anterior, TODA vuelta a pasar tras parchear
sus fixtures (helpers de equipo de prueba enlazan ahora un Club real —
legacy `clubId === teamId` — y, donde hacía falta, pasan `deps.clubId`/
`opponentClubId` reales a `EligibilityService`; nunca lógica de dominio
nueva): `test-world-core1.js` (27 OK), `smoke-world-core1.js` (OK),
`test-roster1.js`/`smoke-roster1.js` (31 OK / OK, sin cambios),
`test-contract1.js` (102 OK), `smoke-contract1.js` (OK, 3 temporadas),
`test-reg1.js` (88 OK), `smoke-reg1.js` (OK, 3 temporadas — bug real
detectado y corregido: el pool elegible del smoke no pasaba `deps.clubId`),
`test-transfer1.js` (67 OK), `smoke-transfer1.js` (OK, 3 temporadas),
`test-loan1.js` (52 OK), `smoke-loan1.js` (OK, 3 temporadas),
`test-market1.js` (82 OK), `smoke-market1.js` (OK, 3 temporadas),
`test-cycle1.js` (42 OK), `smoke-cycle1.js` (OK, 10 temporadas completas).
`node --check` sobre todos los `.js` modificados/nuevos y `git diff
--check`: sin errores. **0 fallos en toda la regresión ejecutada.**
Checklist manual (móvil/escritorio, Playwright) diferida a Dennis al
terminar la EPIC completa.

### Archivos nuevos/modificados (principales)

Nuevos: `src/entities/Squad.js`, `src/core/ClubStructureService.js`,
`scripts/test-club-core1.js`, `scripts/smoke-club-core1.js`. Modificados:
`src/entities/Club.js`, `src/entities/Team.js`, `src/core/WorldRegistry.js`,
`src/core/ClubEmploymentContextCatalog.js`, `data/world/spain-2026.1.js`,
`src/utils/teamGenerator.js`, `index.html`, y los servicios/registros de
dominio listados arriba, además de `src/ui/game.js` (state.userClubId,
bloque Home, y todos los call-sites de mercado/traspasos/cesiones/
contratos que ahora resuelven equipos por `clubId`). Scripts de
prueba/humo existentes parcheados para enlazar un Club real: `test-
contract1.js`, `smoke-contract1.js`, `test-reg1.js`, `smoke-reg1.js`,
`test-transfer1.js`, `smoke-transfer1.js`, `test-loan1.js`,
`smoke-loan1.js`, `test-market1.js`, `smoke-market1.js`, `test-cycle1.js`,
`smoke-cycle1.js`, `test-world-core1.js` (2 fixtures de MoraBanc/Real
Madrid corregidos a sus `clubId` reales).

**Confirmado**: `data/real/*` no se ha tocado; no se ha introducido SQL ni
save/load; no se ha inventado ninguna competición ni sección de club
nueva; PR preparada sin fusionar.
