# Cesiones, retorno, recall y opción de compra (LOAN-1)

_Migrado de `DESIGN.md` (líneas 7027-7271 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.21 LOAN-1 — Cesiones, retorno, recall y opción de compra

Sexta entrega (de nueve) de la EPIC "Ciclo profesional de plantilla" (ver
9.16), construida sobre TRANSFER-1 (9.20, ya fusionado). Una cesión NO es
un traspaso corto: el contrato matriz nunca se mueve, el club propietario
sigue siendo el empleador real durante toda la cesión, y solo la
**afiliación de plantilla** (`Team.roster`/`player.teamId`) y la
**licencia/inscripción de competición** pasan temporalmente al club de
servicio (cesionario). LOAN-1 separa explícitamente diez conceptos que
antes no existían o se habrían mezclado: club empleador/propietario ≠ club
de servicio/cesionario ≠ contrato matriz ≠ licencia federativa ≠
inscripción por competición ≠ propuesta de cesión ≠ consentimiento de cada
parte ≠ acuerdo de cesión ≠ movimiento de salida/retorno ≠ opción/
obligación de compra. Fuera de alcance en su momento: cesión/subrogación
con transfer internacional real (EUROPE-1, sigue pendiente); expiración
orgánica de contratos y apertura orgánica de tanteo (bloqueada entonces por
el suelo de `MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` de CONTRACT-1 —
**entregado en CYCLE-1, ver 9.22**); save/load (HARDEN-1, sigue
pendiente).

#### Modelo de fechas semiabierto

Una cesión está activa en una fecha `d` cuando `serviceStartDate <= d <
returnEffectiveDate` (`LoanAgreement.isActiveOn(date)`) — el día del
retorno YA cuenta como devuelto al propietario, nunca un día "en el aire"
sin club de servicio. El `LoanAgreement.currentStatus()` se DERIVA siempre
de sus referencias reales (`outboundTransactionId`, `returnTransactionId`,
`earlyTerminationRecordId`, `convertedTransferCaseId`) — nunca un campo de
estado mutable libre.

#### Motor legal multi-jurisdicción (`CompetitionRules.js`, dominio `loan`)

Mismo criterio que `transfer`/`employment`/`market`: `resolveLoanRules(context)`
resuelve por jurisdicción del empleador + competiciones origen/destino +
temporada/fecha explícitas — nunca por `division`/`1ª`/`2ª` ni un
comportamiento ACB por defecto. Tres módulos reales:

- **España — RD 1006/1985, art. 11 (cesión temporal)**: régimen doméstico
  de cesión con participación del jugador del 15 % sobre el canon
  (`playerParticipationOnFee`), calculada EXACTA sobre el importe pactado
  — cuando no hay canon (cesión sin contraprestación económica, habitual
  entre filiales), nunca se inventa una participación.
- **Andorra — bloqueo explícito (test transfronterizo obligatorio)**: el
  empleador andorrano (MoraBanc Andorra) NUNCA hereda el régimen español
  del RD 1006 art. 11 ni ningún comportamiento ACB por defecto —
  `resolveLoanRules()` devuelve el blocker `AD_NO_LOAN_REGIME_SOURCED`
  explícito en vez de inventar el procedimiento, verificado en
  `test-loan1.js`, `smoke-loan1.js` y `verify-loan1-playwright.js`.
- **Módulo ficticio de test** (`bm-test-fictional-loan-employment-law-v1`):
  demuestra extensibilidad para una jurisdicción sin fuente real — nunca
  se autoselecciona en un `RulesetBundle` real.
- ACB/Primera FEB reutilizan sus módulos administrativos/de membresía ya
  existentes de TRANSFER-1 (`TRANSFER_MODULES`) para la capa de
  documentación/plazos — nunca duplicados.

#### Entidades y registro canónico

`src/entities/Loan.js` (nuevo): `LoanCase` (expediente, máquina de estados
por eventos igual criterio que `TransferCase` — `draft → proposed →
[countered] → awaitingOwnerConsent/awaitingBorrowerConsent/
awaitingPlayerConsent → agreed → activo`, o un terminal `rejected`/
`withdrawn`/`expired`/`failed`), `LoanProposal` (inmutable y versionada,
`termsHash` propio — una contrapropuesta es SIEMPRE una entidad nueva),
`LoanPartyConsent` (congelado, `isLiveFor(termsHash)` — un consentimiento
sobre unos términos superados por una contrapropuesta deja de contar),
`LoanAgreement`, `PurchaseOptionExercise`, y una unión discriminada de
cláusulas (`validateLoanClause`/`validateLoanClauses`): derecho de recall
con ventanas fechadas, opción/obligación de compra con ventana y precio,
terminación anticipada, prohibición de jugar contra el propietario
(`parent-club-match-eligibility`), rol prometido, participación mínima,
responsabilidad médica/de seguro y asignación de bonus — todas
`modeled-only`, nunca un booleano tipo `hasRecall`. `validateSalaryAllocation`
exige que el reparto salarial propietario/cesionario sume EXACTO 10000
puntos básicos. `src/core/LoanRegistry.js` (nuevo) es la fuente CANÓNICA,
con `activeAgreementForPlayer(playerId, date)` (lanza si encuentra más de
una — invariante de guardia) y `validateIntegrity()` propio (índices
secundarios simétricos, mismo `RegistryIndexAudit` compartido con
Contract/Registration/Transfer Registry).

#### Motor de ejecución atómico

`src/core/LoanExecutionService.js` (nuevo) reutiliza el MISMO patrón
`planTransaction()`/`commitTransaction()` de TRANSFER-1 (replanificación en
commit, `registerUndo()` que solo almacena el cierre de reversión,
saga revertida en orden inverso ante cualquier fallo) para tres tipos de
movimiento: `activation`, `return` y `early-termination`. La licencia +
inscripción de DESTINO en la activación son obligatorias dentro del bloque
atómico; en retorno/terminación anticipada, la RE-inscripción del
propietario es una fase administrativa NO atómica aparte (un fallo ahí
nunca revierte el movimiento de roster ya completado — el resultado queda
tipado `registrationOutcome: 'active'|'pending-registration'`, igual
criterio que TRANSFER-1 sección 14.2). `src/core/RosterMutationService.js`
sigue siendo la ÚNICA frontera autorizada de `Team.roster`/`player.teamId`,
reutilizada tal cual (nunca una segunda frontera para cesiones).
`src/utils/CanonicalHash.js` (nuevo, extraído de la copia local que tenía
TRANSFER-1) centraliza la serialización canónica/hash estable usada por
ambos motores de ejecución — nunca duplicada.

**Opción de compra ejercida por el propio cesionario** (el caso habitual):
`TransferService.formalizeNegotiatedTransfer()` asume que el club de
ORIGEN tiene físicamente al jugador — pero durante una cesión la instancia
real vive en el roster del CESIONARIO, no del propietario. El handoff
definitivo (una vez el jugador consiente) se compone de DOS pasos atómicos
ENCADENADOS, nunca un tercer motor nuevo: primero `LoanService.returnLoan()`
(la misma instancia vuelve al propietario, cierra la cesión), y ACTO
SEGUIDO el traspaso definitivo normal propietario→cesionario vía
TRANSFER-1. Cada paso tiene su propio rollback exacto — documentado como
comentario permanente encima de `LoanService.exercisePurchaseOption` en el
código.

#### Contrato, inscripción y elegibilidad durante la cesión

`CompetitionRegistration` gana un campo tipado `employmentBasis`
(`{type: 'direct-contract'|'temporary-assignment'|'regulatory-exception',
contractId, employerClubId, serviceClubId}`, por defecto
`'direct-contract'` — preserva TRANSFER-1/REG-1 sin cambios). Cuando
`employmentBasis.type === 'temporary-assignment'`, tanto
`RegistrationService.createRegistration()` como
`RegistrationRegistry.validateIntegrity()` y
`ContractRegistry.validateIntegrity()` (vía `loanRegistry.
activeAgreementForPlayer()`) aceptan EXPLÍCITAMENTE que el contrato
referenciado pertenezca al club EMPLEADOR mientras la inscripción es del
club de SERVICIO — nunca como excepción genérica "cualquier discordancia
vale", solo cuando `employmentBasis` declara exactamente ese reparto y
coincide con un `LoanAgreement` activo real. El pool regulado de
elegibilidad (`EligibilityService.evaluateEligibility()`) gana la cláusula
`parent-club-match-eligibility`: si el rival de un partido es el propio
club propietario y la cesión pacta la prohibición, el jugador queda
inelegible con el motivo `PARENT_CLUB_MATCH_RESTRICTED` — comprobado tanto
para el usuario como para la CPU, mismo `EligibilityService` único de
REG-1 (nunca una regla paralela). `Medical.getAvailability()` sigue
funcionando con normalidad sobre un jugador cedido (una lesión no
extingue la cesión ni el contrato matriz por sí sola).

#### Reloj único y noticias

`advanceGameClockTo()` (game.js) sigue siendo el ÚNICO punto que avanza
`state.calendar` — el retorno automático de una cesión al alcanzar su
`returnEffectiveDate` se dispara ahí (`processDueLoanReturnsToDate()`),
mismo criterio EXACTO que `processDueScheduledTransfersToDate()` de
TRANSFER-1, nunca repartido por los call-sites de Liga/Copa/Playoffs/
Ascenso. Las noticias de cesión (activación/retorno) se publican SOLO tras
un commit real (`pushLoanNews()` en game.js) — el dominio de cesión nunca
construye noticias.

#### Interfaz

Mercado gana una pestaña nueva **Cesiones**: formulario "Ceder un jugador
propio" (candidato + club receptor + fechas + canon opcional + cláusulas)
que negocia y activa en un único envío
(`runLoanNegotiation()`/`wireMarketLoansTabActions()`), listado de
expedientes/acuerdos propios por estado. Contratos gana el badge "Cedido
fuera" en la fila del propietario mientras la cesión está activa, y una
tarjeta nueva "Jugadores cedidos que refuerzan tu plantilla" para las
cesiones entrantes — ambas de solo lectura, resueltas siempre desde
`state.loanRegistry`, nunca desde `Team.roster` de los equipos actuales.
Contratos e Inscripciones siguen sin botones de acción (mismo criterio que
TRANSFER-1/MARKET-1) — LOAN-1 tampoco les añade ninguno.

#### Bugs encontrados y corregidos

**Regresión previa reproducida y corregida ANTES de construir LOAN-1**
(BUG-TRANSFER1-13 a 19, en `TransferExecutionService.js`/`TransferService.js`/
`TransferRegistry.js`/`RosterMutationService.js`): comparaciones de fecha
no inclusivas, reversión de undo ejecutada de inmediato en dos sitios
distintos, fuga de `pinnedModuleIds` entre dominios, consentimiento del
jugador deducible, `TransactionRecord` con `destinationClubId` obligatorio
incluso en liberación pura, fecha equivocada pasada a
`Contract.remainingSeasonKeys()`, y una cadena histórica de traspasos que
no reconocía una cesión activa como explicación legítima de una
discordancia `player.teamId` — las 7 con test rojo→verde antes de tocar
código nuevo de cesiones, verificadas en `test-transfer1.js` (67
comprobaciones).

**Bugs propios de LOAN-1**, la mayoría encontrados por `smoke-loan1.js`
ejercitando el motor contra los 36 equipos reales durante 3 temporadas
completas:

- **`evaluatePlayerReaction` ramificaba por `borrowerTeam.division === '1ª'`**
  — viola la convención de todo el proyecto (nunca `division` fuera del
  adaptador legacy); corregido a
  `CompetitionRules.competitionIdFromLegacyDivision(...) ===
  CompetitionRules.COMPETITION_IDS.ACB`, auditado estáticamente en
  `test-loan1.js`.
- **Reenvío de un mismo formulario de negociación tras un rechazo
  colisionaba de id**: `LoanCase` usaba un id determinista solo por
  `(playerId, ownerId, borrowerId, serviceStartDate)`, sin discriminador de
  intento — corregido con `state.loanNegotiationAttemptSequence` (mismo
  patrón que BUG-TRANSFER1-18 en MARKET-1/TRANSFER-1).
- **Colisión de id de LICENCIA en un re-licenciamiento al MISMO club en la
  misma temporada** (BUG-TRANSFER1-20, latente en TRANSFER-1 desde su
  origen, solo destapada por el fixture de opción de compra de LOAN-1: un
  jugador cedido y devuelto, y ACTO SEGUIDO comprado en firme por el
  propio excesionario, dispara DOS licencias en el mismo club+temporada).
  `RegistrationService.issueLicense()` ya aceptaba un `id` explícito
  opcional, igual que `createRegistration()`, pero
  `TransferExecutionService.js` nunca lo usaba — corregido con
  `id: \`license:${transactionId}\`` (y el equivalente `license:return:...`
  en `LoanExecutionService.js`), mismo criterio ya aplicado a la
  inscripción.
- **La re-inscripción de retorno de una cesión nunca referenciaba el
  contrato matriz** (`contractId: null` fijo en
  `LoanExecutionService.commitTransaction()`) — rompía la invariante "toda
  inscripción senior activa exige contrato" en cuanto se comprobaba
  integridad tras un retorno real; corregido a
  `agreement.masterContractId` (el contrato nunca se movió durante la
  cesión, sigue siendo el vigente del propietario al volver).
- **`RegistrationRegistry.validateIntegrity()` no conocía `employmentBasis`**:
  el chequeo BUG-REG1-07 (contrato.clubId debe ser igual a
  inscripción.teamId) no tenía excepción para una cesión real — corregido
  para aceptar la discordancia SOLO cuando `employmentBasis` declara
  exactamente ese reparto empleador/servicio.
- **`LoanService.returnLoan()` invocado sin `commit: true`** en el punto
  único del reloj de `smoke-loan1.js` — el retorno programado nunca se
  ejecutaba (quedaba en `plan`/`result: null`); corregido en el propio
  script de prueba de humo (bug del arnés de prueba, no del motor: la
  integración real en `game.js`/`processDueLoanReturnsToDate()` ya pasaba
  `commit: true` correctamente).
- **`smoke-transfer1.js` llevaba roto desde BUG-TRANSFER1-16** (contexto
  operacional obligatorio): ninguno de sus 5 fixtures dirigidos ni el
  reintento de fichaje futuro pasaban `operationalContext` — la prueba de
  humo de TRANSFER-1 nunca había llegado a ejecutarse completa tras esa
  entrega; corregida como parte de la regresión completa de esta sesión
  (67 comprobaciones Node + 3 temporadas de humo, ahora realmente
  verificadas de extremo a extremo).

#### Archivos nuevos

`src/core/LoanEventTypes.js`, `src/entities/Loan.js`,
`src/core/LoanRegistry.js`, `src/core/LoanExecutionService.js`,
`src/core/LoanService.js`, `src/core/LoanCostService.js`,
`src/utils/CanonicalHash.js`, `scripts/test-loan1.js` (52
comprobaciones), `scripts/smoke-loan1.js` (36 equipos, 3 temporadas: 782
jugadores mundiales, 753 contratos, 8 acuerdos de cesión — 6 devueltos, 1
convertido a traspaso definitivo, 1 vigente; 5 retornos procesados
automáticamente vía el reloj único), `scripts/verify-loan1-playwright.js`
(18 comprobaciones × desktop+mobile).

#### Fuera de alcance de LOAN-1

Cesión/subrogación con transfer internacional real y licencia FIBA para
la operación — **EUROPE-1**; expiración orgánica de contratos y apertura
orgánica de casos de tanteo (bloqueada por el suelo de 3 temporadas de
CONTRACT-1) — **CYCLE-1**; save/load — **HARDEN-1**.

_Migrado de `CLAUDE.md` (líneas 590-692 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### Cesiones, retorno, recall y opción de compra (LOAN-1, DESIGN.md 9.21)

Convenciones permanentes de LOAN-1 — aplican a toda sesión futura que
toque cesiones domésticas, retorno, recall, terminación anticipada u
opción/obligación de compra sobre un jugador cedido, y a CYCLE-1/EUROPE-1
cuando construyan sobre esta entrega:

- `LoanRegistry` (`src/core/LoanRegistry.js`, `state.loanRegistry`) es la
  fuente CANÓNICA de `LoanCase`/`LoanProposal`/`LoanPartyConsent`/
  `LoanAgreement`/`PurchaseOptionExercise` — instancia EXPLÍCITA por
  carrera (creada en `bootstrapMarketForNewCareer()`, limpiada al volver a
  selección de equipo), nunca un singleton.
- Una cesión NUNCA mueve el contrato matriz — solo afiliación de plantilla
  (`Team.roster`/`player.teamId`, vía `RosterMutationService`, la MISMA
  frontera de TRANSFER-1) y licencia/inscripción de competición. Código
  nuevo nunca asume que "cedido" implica un contrato nuevo con el
  cesionario.
- El modelo de fechas es SIEMPRE semiabierto:
  `serviceStartDate <= date < returnEffectiveDate`
  (`LoanAgreement.isActiveOn(date)`) — el día del retorno cuenta como ya
  devuelto. `currentStatus()` se DERIVA siempre de las referencias reales
  (`outboundTransactionId`/`returnTransactionId`/
  `earlyTerminationRecordId`/`convertedTransferCaseId`) — nunca un campo
  de estado mutable libre.
- Lógica de cesión nueva usa `resolveLoanRules()`/módulos de
  `CompetitionRules.js` (dominio `loan`) — nunca `division` (`1ª`/`2ª`),
  el nombre visible de una liga, ni ACB como comportamiento por defecto de
  una jurisdicción/competición desconocida (lanza explícito). El empleador
  andorrano (MoraBanc Andorra) NUNCA hereda el régimen español del RD 1006
  art. 11 — sigue siendo el test transfronterizo obligatorio de la EPIC,
  bloqueado con `AD_NO_LOAN_REGIME_SOURCED` explícito.
- `LoanExecutionService.js` reutiliza el MISMO patrón
  `planTransaction()`/`commitTransaction()` de TRANSFER-1 (replan-at-commit,
  `registerUndo()` que solo almacena el cierre, saga revertida en orden
  inverso) — nunca un segundo motor de saga duplicado. La licencia +
  inscripción de destino en la ACTIVACIÓN son obligatorias dentro del
  bloque atómico; en RETORNO/terminación anticipada, la re-inscripción del
  propietario es una fase administrativa NO atómica aparte
  (`registrationOutcome: 'active'|'pending-registration'`), mismo criterio
  que TRANSFER-1 sección 14.2.
- Toda emisión de licencia/inscripción nueva (activación Y retorno) fija
  su `id` EXPLÍCITO por transacción (`license:${transactionId}`,
  `license:return:${transactionId}`, `registration:${transactionId}`,
  `registration:return:${transactionId}`) — nunca el id determinista por
  defecto (BUG-TRANSFER1-20): el mismo jugador puede re-licenciarse en el
  MISMO club dentro de la misma temporada más de una vez a lo largo de una
  cesión (activación → retorno → nueva cesión, o activación → retorno →
  compra en firme por el propio excesionario).
- La re-inscripción de RETORNO siempre referencia el contrato matriz
  (`agreement.masterContractId`) — nunca `contractId: null`: el contrato
  nunca se movió durante la cesión, sigue siendo el vigente del
  propietario al volver, y una inscripción senior activa exige contrato
  (BUG-REG1-07).
- `CompetitionRegistration.employmentBasis` (`{type:
  'direct-contract'|'temporary-assignment'|'regulatory-exception',
  contractId, employerClubId, serviceClubId}`, por defecto
  `'direct-contract'`) es el ÚNICO mecanismo que explica que el contrato
  de una inscripción pertenezca a un club distinto de `registration.teamId`
  — tanto en `RegistrationService.createRegistration()` como en
  `RegistrationRegistry.validateIntegrity()` y
  `ContractRegistry.validateIntegrity()` (esta última vía
  `loanRegistry.activeAgreementForPlayer()`). Nunca una excepción genérica
  "cualquier discordancia vale" — solo cuando `employmentBasis` declara
  exactamente ese reparto y coincide con un `LoanAgreement` real.
- El pool regulado de un partido sigue evaluándose SIEMPRE por
  `EligibilityService` (REG-1) — la cláusula `parent-club-match-eligibility`
  se comprueba ahí (motivo `PARENT_CLUB_MATCH_RESTRICTED`), nunca en una
  regla paralela de UI o de la CPU.
- **Opción de compra ejercida por el propio cesionario** (caso habitual):
  `TransferService.formalizeNegotiatedTransfer()` asume que el club de
  ORIGEN tiene físicamente al jugador — como la instancia real está en el
  roster del CESIONARIO durante la cesión, el handoff definitivo se
  compone SIEMPRE de dos pasos atómicos encadenados
  (`LoanService.returnLoan()` primero, después el traspaso definitivo
  normal propietario→cesionario de TRANSFER-1) — nunca un tercer motor de
  ejecución nuevo. Ejercer la opción NUNCA mueve roster ni crea contrato
  por sí solo — solo el consentimiento real del jugador dispara el
  handoff.
- `advanceGameClockTo()` sigue siendo el ÚNICO punto que avanza
  `state.calendar` — el retorno automático de una cesión al alcanzar su
  `returnEffectiveDate` se dispara ahí
  (`processDueLoanReturnsToDate()`), nunca repartido por los call-sites de
  Liga/Copa/Playoffs/Ascenso. Ninguna noticia de cesión se construye
  dentro del dominio de cesión — game.js la publica SOLO tras un commit
  real (`pushLoanNews()`), auditado estáticamente.
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217;
  fechas SIEMPRE civiles ISO vía `LocalDate`, nunca `Date.now()`/reloj de
  sistema dentro del motor de cesiones. El reparto salarial
  propietario/cesionario (`Money.allocateByWeights`) siempre suma EXACTO
  10000 puntos básicos.
- Todo dato simulado de cesión (canon, participación, cláusulas de
  fixture) lleva `dataSource`/`isReal: false` visibles — nunca se presenta
  como un dato real, y `data/real/` no se toca nunca desde este dominio.
- No se ejecuta cesión/subrogación con transfer internacional real ni
  licencia FIBA para la operación (EUROPE-1, hoy solo bloquea, nunca
  concede completado) antes de esa entrega — LOAN-1 se detiene en el
  ámbito doméstico verificable. (Nota posterior: la expiración orgánica de
  contrato y la apertura orgánica de tanteo, entonces bloqueadas por el
  suelo de 3 temporadas de CONTRACT-1, ya están entregadas — ver CYCLE-1,
  DESIGN.md 9.22, bloque de convenciones más abajo.)
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura de cesiones o las reglas activas.
