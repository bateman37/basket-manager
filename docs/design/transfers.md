# Traspasos, fichajes y ejecución (TRANSFER-1)

_Migrado de `DESIGN.md` (líneas 6786-7026 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.20 TRANSFER-1 — Traspasos, fichajes, cláusulas, rescisiones y compensaciones

Quinta entrega (de nueve) de la EPIC "Ciclo profesional de plantilla" (ver
9.16). MARKET-1 ya negocia y produce un **Agreement in Principle (AIP)**,
pero se detiene ahí: nunca mueve `Team.roster`, nunca registra el contrato
definitivo, nunca inscribe. TRANSFER-1 es el motor que EJECUTA esa
operación de forma **atómica** — planifica, revalida y compromete todos
los pasos (contrato nuevo, terminación del anterior, movimiento de
plantilla, inscripción/licencia, obligaciones económicas) como una sola
unidad: o completan todos, o el mundo queda EXACTAMENTE igual que antes de
intentarlo, con el motivo del bloqueo explícito.

Mecanismos cubiertos: **fichaje de agente libre** (`free-agent-signing`),
**fichaje futuro tras expiración** (`future-signing`, un contrato con
inicio posterior a la fecha de formalización), **traspaso definitivo
negociado** (`negotiated-transfer`, dos patas: acuerdo club-club +
consentimiento del jugador), **ejercicio de cláusula de rescisión**
(`release-clause-exercise`, sin aceptación del vendedor), **mutuo
acuerdo/liberación** (`mutual-agreement`, con o sin destino nuevo),
**terminación por causa del empleador** (`employer-termination`),
**extinción unilateral del jugador** (`player-withdrawal`), **causa
controvertida verificada** (`verified-cause-termination`) y
**compensación ACB por renuncia de derechos** (art. 16, calculada pero sin
conceder participación al jugador — invariante 13). Fuera de alcance en su
momento: cesiones — **entregado en LOAN-1** (9.21); mercado/renovaciones
anuales de la CPU y apertura orgánica de tanteo — **entregado en CYCLE-1**
(9.22); transfer internacional real y licencia FIBA para esa operación
(EUROPE-1), save/load (HARDEN-1) siguen pendientes.

#### Motor legal multi-jurisdicción (`CompetitionRules.js`, dominio `transfer`)

Igual criterio que los dominios `employment`/`market` ya existentes:
`resolveTransferRules(context)` resuelve por
`(originEmployerJurisdictionId, destinationEmployerJurisdictionId,
originCompetitionId, destinationCompetitionId, seasonKey, effectiveDate)`
explícitos — nunca por `division`/`1ª`/`2ª` ni un valor por defecto ACB
para una competición desconocida (lanza explícito). Módulos reales
codificados con fuente/versión/estado:

- **España — RD 1006/1985, art. 13.a**: sin pacto expreso registrado, el
  jugador tiene derecho a un mínimo del **15 % bruto** del transfer fee en
  un traspaso definitivo; con pacto, se registra su texto tipado/fuente y
  se valida lo que ese pacto realmente disponga (nunca un 15 % genérico
  encima). Nunca se aplica a un buyout de cláusula de rescisión ni a un
  empleador fuera de esa jurisdicción.
- **Andorra — Llei 31/2018**: el empleador andorrano (MoraBanc Andorra,
  test transfronterizo obligatorio de toda la EPIC) NUNCA hereda el 15 %
  español ni el RD 1006 — se resuelve siempre AD, con el convenio ACB
  aplicado solo como capa de membresía de competición (documentos,
  formas), nunca como derecho laboral sustantivo.
- **ACB — Convenio colectivo, arts. 16/17.4.5/18**: reparto de la
  compensación por renuncia de derechos preferentes, calculado por tramos
  de edad (≤20: 75/50/25/10 % según el fee cruce ciertos umbrales; 21-23:
  15/30/50 % con los mismos umbrales; 24+ no aplica) — **el jugador nunca
  participa de esta compensación** (invariante 13, comprobado
  explícitamente en `test-transfer1.js`); un ejercicio de cláusula
  comunicado después del 15 de septiembre queda bloqueado por la
  restricción de inscripción ACB (art. 17.4.5) hasta la siguiente ventana.
- **Primera FEB — art. 20.2.b/21/24-27/33-35/36/37**: módulo de
  transferencia doméstica propio, sin el procedimiento de tanteo ACB ni su
  compensación por renuncia (esos artículos son exclusivos del convenio
  ACB).
- **ACB — Normas Internas de administración de traspasos**: módulo
  administrativo (`transferAdmin`) separado del módulo laboral —
  documentación/plazos de comunicación al organismo, nunca mezclado por
  `Object.assign()` con las reglas laborales del jugador.
- Dos módulos **`reference-only`** (overlay EuroLeague-style y ventana de
  competición ficticia de test) demuestran extensibilidad — nunca se
  autoseleccionan en un `RulesetBundle` real, solo si se fijan
  explícitamente por `pinnedModuleIds`.

#### Entidades y registro canónico

`src/entities/Transfer.js` (nuevo): `TransferCase` (expediente completo,
máquina de estados por eventos — `draft → …→ readyToPlan → planned →
[scheduled] → readyToExecute → completed`, o un terminal alternativo
`rejected`/`withdrawn`/`expired`/`blocked`/`failed`; un terminal nunca
vuelve a un estado vivo), `ClubTransferOffer` (oferta económica ENTRE
CLUBES — distinta de `ContractOffer`, jugador-club, de MARKET-1; inmutable
y versionada, una contraoferta es una entidad nueva), `TransferAgreement`
(acuerdo definitivo entre clubes, con el consentimiento del jugador
SIEMPRE explícito — nunca deducido de haber aceptado una oferta salarial),
`ReleaseClauseExercise`, `ContractTerminationRecord`,
`FinancialObligation` (fee, participación del jugador, buyout, settlement
de mutuo acuerdo, compensación de terminación, compensación ACB por
renuncia y comisión de agente son conceptos SEPARADOS, nunca colapsados en
un único importe — invariante 15), y `TransactionRecord` (recibo
canónico e inmutable de una operación completada). `src/core/
TransferRegistry.js` (nuevo) es la fuente CANÓNICA de todo lo anterior,
con `validateIntegrity()` propio (referencias cruzadas a Player/Contract/
Registration/Market Registry, unicidad de oferta club-club viva por
expediente, nunca un `TransactionRecord` con jugador ausente del Player
Registry).

#### Motor de ejecución atómico

`src/core/TransferExecutionService.js` (nuevo) separa **planificación**
(`planTransaction()`, pura — nunca muta ni reserva nada, solo produce un
`TransferExecutionPlan` inmutable con blockers/warnings y fingerprints del
estado actual) de **compromiso** (`commitTransaction()` — revalida los
fingerprints contra el estado REAL antes de tocar nada; si algo cambió
desde que se planificó, rechaza con `PLAN_STALE_*` en vez de ejecutar a
ciegas). El commit es una saga: cada paso muta y ACTO SEGUIDO registra su
propio cierre de reversión exacta (`registerUndo()`, que solo ALMACENA el
cierre — nunca lo ejecuta ahí mismo); si cualquier paso posterior falla,
se deshace en orden inverso y el mundo queda **exactamente** como estaba
(verificado con inyección de fallos en cada punto: `RegistrationService.
createRegistration`/`issueLicense`, registro del contrato nuevo, y tras
mover el roster). Idempotente por `transactionId`: repetir el mismo
comando nunca duplica nada. `src/core/RosterMutationService.js` (nuevo)
es la ÚNICA frontera autorizada de `Team.roster`/`player.teamId` para
TRANSFER-1 (mismo criterio que el resto de la EPIC — ninguna otra parte
del dominio toca esos campos directamente, auditado estáticamente).
`src/core/TransferService.js` (nuevo) ensambla los comandos por mecanismo,
resuelve la evaluación DETERMINISTA del club vendedor CPU
(`evaluateSellingClub()`/`generateCounterFee()` — nunca `Math.random()`,
nunca Potencial/Ambición/Profesionalidad visibles, razones siempre
cualitativas) y avanza el ciclo de vida real del `TransferCase`
(`advanceTransferCaseLifecycle()`).

**Fichaje futuro tras expiración (`future-signing`, sección 11.2)**: un
AIP puede formalizarse con `effectiveDate` posterior a "hoy" — el
expediente queda `scheduled` (visible ya HOY en Mercado > Operaciones/
Agenda, con sus eventos administrativos fechados en el momento real de la
acción, nunca en la fecha efectiva futura) sin mover nada del mundo
todavía. `advanceGameClockTo()` (game.js, punto único del reloj) reintenta
cada expediente `scheduled` cuya fecha efectiva ya se alcanzó
(`retryScheduledTransferCase()`) — SIEMPRE replanifica y revalida desde
cero contra el estado real de ese momento, nunca ejecuta a ciegas el plan
antiguo; si algo dejó de ser cierto entretanto, queda `blocked` con el
motivo, nunca a medias. La noticia de mercado se publica SOLO tras un
commit real (`pushTransferCompletionNews()` en game.js — el dominio de
transferencia nunca construye noticias, auditado estáticamente).

#### Interfaz

Mercado > Negociaciones: un AIP vivo muestra el asistente de
formalización real (`renderAgreementFormalizationHtml()`) — deriva el
mecanismo aplicable (agente libre / cláusula de rescisión / traspaso
negociado según haya o no contrato de origen y cláusula ejecutable),
resume la vía y expone la acción real ("Formalizar operación" o el
formulario de oferta club-club con negociación determinista visible).
Mercado > Operaciones (pestaña nueva): listado de solo lectura de
expedientes del club — activos/programados/completados/bloqueados con
motivo. Ficha universal, pestaña "Mercado y representación": añade
expediente activo (mecanismo + fecha efectiva) y traspasos/liberaciones
históricos con su compensación, resueltos siempre desde
`state.transferRegistry`/Player Registry — nunca desde `Team.roster` de
los equipos actuales, así que un jugador libre en pleno expediente sigue
mostrando su historial. Contratos e Inscripciones siguen de solo lectura
(sin botones de renovar/fichar/liberar/ceder) — MARKET-1 negocia, TRANSFER-1
ejecuta desde Mercado, ninguna de las dos pantallas pasivas gana acciones
propias.

#### Bugs encontrados y corregidos

**Auditoría previa (bugs de MARKET-1, corregidos antes de construir
TRANSFER-1)**: BUG-MARKET1-03 (`createAndSendOffer` no validaba siempre
internamente), BUG-MARKET1-04 (mandato de agente mal resuelto en algunos
casos), BUG-MARKET1-05 (fuga de reserva presupuestaria), BUG-MARKET1-06
(executionState de un AIP era una constante fija en vez de derivarse de su
ciclo de vida real), BUG-MARKET1-07 (regla de bloqueo de "Continuar" ante
atención de mercado usaba comparación exclusiva en vez de inclusiva) —
todos verificados con test-market1.js (82 comprobaciones), smoke-market1.js
y verify-market1-playwright.js antes de tocar código nuevo.

**Bugs propios de TRANSFER-1**, la mayoría encontrados por
`smoke-transfer1.js` ejercitando el motor contra el mundo real de 36
equipos ya sembrado (nunca reproducibles con fixtures aisladas, que es
justo lo que hace distinta a una prueba de humo de una suite unitaria):

- **`ContractRegistry.isClosedBefore()` con comparación estricta.**
  Bloqueaba el propio caso de uso central de TRANSFER-1 (terminar el
  contrato de origen y registrar el nuevo el MISMO día civil) — corregido
  a comparación inclusiva.
- **`registerUndo()` ejecutaba la reversión de inmediato en vez de
  almacenarla** (en `TransferExecutionService.js` y duplicado en
  `TransferService.js`'s `commitMutualReleaseWithoutAgreement`) — un
  contrato recién registrado se desregistraba en el acto, o un jugador
  recién liberado volvía a su equipo antes de terminar el commit.
- **`pinnedModuleIds` cruzaba dominios**: un id fijado para `transfer`
  se reenviaba también a la resolución `employment`, lanzando "módulo
  inexistente en el catálogo laboral".
- **`playerConsent` se deducía en vez de exigirse explícito** en un
  traspaso negociado — corregido para bloquear sin `playerConsentGrantedAt`
  real.
- **`TransactionRecord` exigía `destinationClubId` siempre**, rompiendo
  una liberación pura sin destino nuevo — el campo es opcional para ese
  caso.
- **`evaluateSellingClub()` pasaba una fecha civil ISO a
  `Contract.remainingSeasonKeys()`** (que espera una CLAVE de temporada) —
  lanzaba siempre que evaluaba una venta con un contrato de origen real;
  ahora recibe `seasonKey` explícito.
- **Un contrato nuevo de traspaso podía quedar con `startDate` retrocedida
  al inicio de temporada** en vez de la fecha real de la operación,
  solapando con el contrato de origen (que sigue vigente hasta esa fecha
  real) — mismo criterio de corrección mid-season ya aplicado en MARKET-1.
- **La inscripción de destino usaba el id determinista por defecto**
  (jugador+ámbito+temporada), que choca con la de ORIGEN cuando ambos
  clubes comparten competición/temporada (desactivar no libera el id) —
  ahora usa un id explícito por transacción.
- **`originRegistrationScopeId`/`originSeasonKey` eran opcionales que
  NINGÚN llamador real pasaba nunca** — la inscripción de origen no se
  desactivaba jamás en la práctica; `TransferService` ahora los resuelve
  solo desde el club de origen real.
- **`formalizeNegotiatedTransfer` nunca registraba un `ClubTransferOffer`
  real** en `TransferRegistry` — el expediente quedaba con `clubOfferId`
  apuntando a nada.
- **`retryScheduledTransferCase()` usaba `statusOn(fechaDeRonda)`** para
  decidir si un expediente seguía `scheduled` — con 1ª/2ª procesando
  rondas en fechas que no avanzan en el mismo orden estricto, un
  expediente YA completado con fecha posterior podía parecer `scheduled`
  otra vez ante una fecha anterior de la otra división, reintentando y
  lanzando por cronología incoherente; corregido a `statusOn(null)`
  (estado real, no filtrado por la fecha de la llamada).
- **Un importe de contraoferta sugerido en la UI no respetaba el
  `step="1000"` del campo** — el navegador bloquea en SILENCIO el
  siguiente envío si el usuario reenvía tal cual ese importe (validación
  nativa, sin disparar `submit` ni mostrar error propio); encontrado por
  `verify-transfer1-playwright.js`, corregido redondeando el importe
  sugerido al millar más cercano.

#### Archivos nuevos

`src/core/TransferEventTypes.js`, `src/entities/Transfer.js`,
`src/core/TransferRegistry.js`, `src/core/RosterMutationService.js`,
`src/core/TransferExecutionService.js`, `src/core/TransferService.js`,
`scripts/test-transfer1.js` (54 comprobaciones), `scripts/smoke-transfer1.js`
(36 equipos, 3 temporadas), `scripts/verify-transfer1-playwright.js`
(desktop+mobile).

#### Fuera de alcance de TRANSFER-1

Cesiones/subrogación temporal — **LOAN-1** (entregado, ver 9.21);
mercado/renovaciones anuales de la CPU, expiración orgánica de contratos y
apertura orgánica de casos de tanteo (bloqueada en su momento por el suelo
de `MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` de CONTRACT-1) — **CYCLE-1**
(entregado, ver 9.22); transfer internacional real (LOC, licencia FIBA
para la operación en sí — hoy solo bloquea, nunca concede completado) —
**EUROPE-1**; save/load — **HARDEN-1**.

_Migrado de `CLAUDE.md` (líneas 484-589 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### Traspasos, fichajes y ejecución (TRANSFER-1, DESIGN.md 9.20)

Convenciones permanentes de TRANSFER-1 — aplican a toda sesión futura que
toque fichajes, traspasos, cláusulas de rescisión, terminación de
contrato, compensaciones, y a LOAN-1/CYCLE-1/EUROPE-1 cuando construyan
sobre esta entrega:

- `TransferRegistry` (`src/core/TransferRegistry.js`,
  `state.transferRegistry`) es la fuente CANÓNICA de `TransferCase`/
  `ClubTransferOffer`/`TransferAgreement`/`ReleaseClauseExercise`/
  `ContractTerminationRecord`/`FinancialObligation`/`TransactionRecord` —
  instancia EXPLÍCITA por carrera (creada en `bootstrapMarketForNewCareer()`,
  limpiada al volver a selección de equipo), nunca un singleton.
- La UI SOLO llama a `TransferService`/`TransferExecutionService` — nunca
  escribe directamente en `TransferRegistry`/`ContractRegistry`/
  `RegistrationRegistry`/`Team.roster`/`player.teamId`. `Team.roster`/
  `player.teamId` tienen una única frontera autorizada,
  `RosterMutationService.js` — ninguna otra parte del dominio de
  transferencia los toca (auditado estáticamente en
  `scripts/test-transfer1.js`).
- Toda operación pasa por `planTransaction()` (puro, nunca muta ni
  reserva) antes de `commitTransaction()` (revalida los fingerprints del
  plan contra el estado REAL antes de tocar nada — un plan obsoleto se
  rechaza con `PLAN_STALE_*`, nunca se ejecuta a ciegas). El commit es una
  saga: cada paso muta y ACTO SEGUIDO **almacena** su cierre de reversión
  (nunca lo ejecuta ahí mismo) — si un paso posterior falla, se deshace en
  orden inverso y el mundo queda EXACTAMENTE como estaba. Idempotente por
  `transactionId`.
- AIP (MARKET-1), `TransferAgreement`/`ClubTransferOffer` (oferta
  club-club), contrato definitivo (`ContractRegistry`) y afiliación de
  plantilla (`Team.roster`) son CUATRO conceptos distintos — formalizar
  nunca colapsa dos en uno.
- `TransferCase` (y `ClubTransferOffer`/`ReleaseClauseExercise`/
  `ContractTerminationRecord`) son máquinas de estados por EVENTOS
  validados y ordenados (mismo patrón que `MarketEventTypes.js`/
  `RegistrationEventTypes.js`) — nunca un campo de estado mutable libre.
  Un terminal (`completed`/`rejected`/`withdrawn`/`expired`/`failed`)
  nunca vuelve a un estado vivo. Los eventos ADMINISTRATIVOS del
  expediente (`case-opened`/`ready-to-plan`/`planned`/`scheduled`/
  `blocked`) se fechan en el momento REAL de la acción (`now`) — nunca en
  `effectiveDate` (la fecha en que la operación surte efecto, que puede
  ser posterior en un fichaje futuro); confundir ambas deja un expediente
  `scheduled` invisible hasta su propia fecha efectiva.
- Un reintento de expediente `scheduled` (`retryScheduledTransferCase()`)
  SIEMPRE replanifica y revalida desde cero contra el estado real del
  momento del reintento — nunca ejecuta a ciegas el plan antiguo. Decide
  si un expediente sigue `scheduled` con `statusOn(null)` (estado real,
  sin filtrar por fecha) — nunca `statusOn(fechaDeLlamada)`: dos
  divisiones/ligas pueden procesar sus rondas en fechas que no avanzan en
  el mismo orden estricto, y un expediente ya completado con fecha
  posterior podría parecer `scheduled` otra vez ante una fecha anterior.
- Lógica de traspaso nueva usa `resolveTransferRules()`/módulos de
  `CompetitionRules.js` (dominio `transfer`) — nunca `division`
  (`1ª`/`2ª`), el nombre visible de una liga, ni ACB como comportamiento
  por defecto de una jurisdicción/competición desconocida (lanza
  explícito). El empleador andorrano (MoraBanc Andorra) NUNCA hereda el
  15 % español del RD 1006 art. 13.a ni su procedimiento — sigue siendo el
  test transfronterizo obligatorio de toda la EPIC.
- Fee, participación del jugador (RD 1006 art. 13.a), buyout de cláusula,
  settlement de mutuo acuerdo, compensación de terminación, compensación
  ACB por renuncia de derechos (art. 16) y comisión de agente son
  conceptos SEPARADOS — nunca colapsados en un único importe ni sumados
  entre sí. La compensación ACB por renuncia NUNCA concede participación
  al jugador (invariante 13 del prompt de TRANSFER-1).
- El consentimiento del jugador a un traspaso NUNCA se deduce de haber
  aceptado una oferta salarial — sin `playerConsentGrantedAt` explícito,
  no hay consentimiento y el plan bloquea.
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217;
  fechas SIEMPRE civiles ISO vía `LocalDate`, nunca `Date.now()`/reloj de
  sistema dentro del motor de traspasos.
- `advanceGameClockTo()` sigue siendo el ÚNICO punto que avanza
  `state.calendar` — el reintento de un fichaje futuro
  (`processDueScheduledTransfersToDate()`) se dispara ahí, nunca repartido
  por los call-sites de Liga/Copa/Playoffs/Ascenso. Ninguna noticia de
  mercado se construye dentro del dominio de transferencia — game.js la
  publica SOLO tras un commit real, nunca antes (auditado estáticamente).
- No se ejecuta cesión/subrogación (LOAN-1), renovación/expiración
  orgánica de contrato ni apertura orgánica de tanteo (CYCLE-1, sigue
  bloqueada por el suelo de `MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` de
  CONTRACT-1) ni transfer internacional real/licencia FIBA para la
  operación (EUROPE-1, hoy solo bloquea, nunca concede completado) antes
  de sus entregas — TRANSFER-1 se detiene en el ámbito doméstico
  verificable.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura de traspasos o las reglas activas.
- **Corrección (BUG-TRANSFER1-20, detectada durante LOAN-1)**: la licencia
  de DESTINO en `TransferExecutionService.js`'s `commitTransaction()` usaba
  el id determinista por defecto de `RegistrationService.issueLicense()`
  (`playerId+clubId+seasonKey`) en vez de un id explícito por transacción
  — igual fallo que ya se había corregido para la inscripción de destino
  (comentario ya presente en el código), pero nunca replicado a la
  licencia. Choca en cuanto el mismo jugador se re-licencia en el MISMO
  club dentro de la misma temporada (p.ej. cedido y devuelto, y ACTO
  SEGUIDO comprado en firme por su propio excesionario). Corregido con
  `id: \`license:${transactionId}\`` — cualquier código nuevo que emita
  una licencia debe seguir fijando su id explícito por transacción, nunca
  confiar en el default determinista cuando el mismo club+temporada puede
  repetirse.
- **Corrección**: `scripts/smoke-transfer1.js` llevaba roto desde
  BUG-TRANSFER1-16 (contexto operacional obligatorio) — sus fixtures nunca
  pasaban `operationalContext`, así que la prueba de humo de 3 temporadas
  nunca se había vuelto a ejecutar completa desde esa entrega. Cualquier
  script de prueba de humo nuevo que llame a `TransferService`/
  `LoanService` debe declarar `operationalContext` explícito (mismo
  criterio que `game.js`), nunca asumir que el motor lo hace opcional.
