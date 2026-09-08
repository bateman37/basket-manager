# Arquitectura — Club, Team y Squad como entidades distintas (CLUB-CORE-1)

_Migrado de `CLAUDE.md` (líneas 901-970 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### CLUB-CORE-1 (DESIGN.md 10.12) — Club, Team y Squad son entidades DISTINTAS

Convenciones permanentes de CLUB-CORE-1 (2ª entrega de World Architecture)
— aplican a toda sesión futura que toque Club/Team/Squad, o cualquier
dominio de ROSTER-1..CYCLE-1/MARKET-1/TRANSFER-1/LOAN-1 que use un campo
`clubId`/`teamId`/`squadId`:

- `Club` (institucional: quién emplea, quién negocia, quién tiene la
  cantera, quién tantea), `Team` (deportivo: quién compite, quién
  entrena, quién juega el partido) y `Squad` (`src/entities/Squad.js`,
  contenedor operativo real de jugadores) son TRES entidades con ids
  DISTINTOS — nunca asumir `clubId === teamId` ni traducir uno a otro por
  prefijo/sufijo. `data/world/spain-2026.1.js` declara los 36 pares reales
  de forma EXPLÍCITA (`SPAIN_CLUB_CONTENT`), nunca derivada.
- Tabla de semántica de id (auditar por SIGNIFICADO, nunca por nombre de
  variable): contrato/mandato/negociación/tanteo/compra-venta/cesión
  (propietario y cesionario)/cantera/licencia federativa → **clubId**;
  `CompetitionEntry`/inscripción de competición/acta de partido/táctica/
  entrenamiento/`Player.teamId` → **teamId**; contenedor operativo actual
  de jugadores → **squadId**.
- `Team.roster` es SIEMPRE una vista de compatibilidad del `Squad` ACTIVO
  del equipo (misma referencia de array) — nunca un array paralelo. Un
  `Team` sin `Squad` enlazado (modo bootstrap/tests legacy) usa
  `_legacyRoster`, nunca confundido con el modelo real una vez hay mundo.
- Las propiedades institucionales de `Team` (`foundationYear`, `budget`,
  `clubDNA`, `facilities`, `board`, `fanbase`, `finances` y sus totales
  derivados) son accesores LEGACY que DELEGAN en la MISMA instancia de
  `Club` en cuanto `team.club` está enlazado — nunca una segunda copia
  mutable. `team.reputation` sigue siendo una vista compuesta de solo
  lectura: `sporting` es de `Team`, `financial`/`youth` son de `Club`.
- `EligibilityService.evaluateEligibility(playerId, teamId, context, deps)`
  exige `deps.clubId` explícito (el Club real del equipo evaluado) para
  resolver el empleador del contrato — un llamador nuevo que lo omita
  declara a casi todos los jugadores con contrato real como no elegibles
  (`CONTRACT_CLUB_MISMATCH`), un bug ya detectado y corregido varias veces
  durante esta entrega. `context.opponentClubId` y cualquier
  `ClubLinkAgreement.lowerClubId`/`upperClubId`/`LoanAgreement.
  ownerClubId`/`borrowerClubId` son SIEMPRE Club ids reales, nunca
  `team.id`.
- `ClubEmploymentContextCatalog.js` YA NO es una segunda tabla de 36
  "clubes" indexada por `teamId` — la identidad/jurisdicción/afiliación de
  cada club se resuelven SIEMPRE desde el `Club` real instalado
  (`team.club`) y las áreas/organizaciones del mundo. Un equipo vivo sin
  `Club` real enlazado falla explícito, nunca hereda España/ACB por
  defecto. Añadir un país/jurisdicción de test es una entrada de catálogo
  (`JURISDICTIONS`/`AREA_TO_JURISDICTION`) — el perfil `XX`/
  `TEST_JURISDICTION_AREA_ID` ya existe para eso, nunca una rama de código.
- `AcademyMembership.clubId` (y `AcademyRegistry.activePoolForClub()`) es
  SIEMPRE el `clubId` institucional real — la cantera pertenece al Club,
  nunca a un `teamId` deportivo; `promoteToFirstTeam()` sigue afiliando al
  `Team` real (roster/`Squad`) vía `RosterMutationService`.
- BUG-WORLDCORE-09 (corregido): `Team.validateDivision(undefined)` ya NO
  devuelve `'1ª'` en silencio — devuelve `null` (y `legacyDivision: null`).
  Un valor explícito no reconocido sigue lanzando. El contenido español
  sigue pasando `'1ª'`/`'2ª'` explícitos.
- Test/fixtures NUEVOS deben usar `clubId`/`teamId` DISTINTOS siempre que
  sea posible; un fixture legacy con `clubId === teamId` explícito sigue
  permitido (documentado como tal), pero un `Team` vivo SIEMPRE necesita un
  `Club` real enlazado (`team.club`) antes de pasar por
  `ContractService`/`RegistrationService` — sin él, ambos fallan
  explícito en vez de inferir clubId de teamId.
- Deuda identificada y DELIBERADAMENTE no tocada en esta entrega (naming
  únicamente, nunca cruzada contra un Club real en ningún sitio): campos
  `clubId` que en realidad guardan un `team.id` en entidades de
  contabilidad/diagnóstico del dominio Cycle (`ClubCycleCase`,
  `RosterLegalityReport`, `EmergencyRosterAction`, la evidencia de
  `SeasonHistoryService`/`cycle1-harness.js`) — una entrega futura que
  quiera limpiar esta categoría debe documentarlo y renombrarlo de una
  vez, nunca campo a campo sin plan.
