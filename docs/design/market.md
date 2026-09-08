# Mercado, agentes y derechos preferentes (MARKET-1)

_Migrado de `DESIGN.md` (líneas 6339-6785 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.19 MARKET-1 — Mercado profesional, agentes, negociación, ofertas y derechos preferentes

Cuarta entrega (de nueve) de la EPIC "Ciclo profesional de plantilla" (ver
9.16). Con ROSTER-1/CONTRACT-1/REG-1 ya hechas, un jugador existe en el
mundo, tiene contrato laboral real y licencia/inscripción — pero no había
ninguna forma de que dos partes NEGOCIEN. MARKET-1 añade esa vertical:
búsqueda de jugadores en el Player Registry mundial, representación por
agentes (principios FIBA), hilos de negociación con respuesta de CPU
diferida en el reloj real, ofertas de contrato inmutables y versionadas,
reservas presupuestarias contra un límite interno simulado, y el
procedimiento ACB completo de derecho de tanteo (arts. 13-17 del convenio
colectivo) como máquina de estados fechada — nunca un booleano. El
resultado final de una negociación exitosa es un **Agreement in
Principle (AIP)**: nunca toca `Team.roster`, `ContractRegistry` ni
`RegistrationRegistry` — formalizar el fichaje (mover al jugador, firmar el
contrato definitivo, inscribirlo) es trabajo de **TRANSFER-1**, la próxima
entrega.

#### Bugs de REG-1/táctico corregidos antes de construir MARKET-1 (PR previa)

Auditoría previa a esta entrega, corregidos con regresión completa antes de
tocar código nuevo de mercado:

- **BUG-REG1-06 — caché/registros de carrera sin declarar en `state` ni
  limpiados al volver a selección de equipo.** `registrationClassificationCache`
  se creaba de forma perezosa desde varios renderizadores y podía
  sobrevivir a un cambio de carrera (una clasificación de formación/no
  comunitario de la partida ANTERIOR filtrándose a la nueva). Corregido:
  `registrationRegistry`/`registrationBootstrapWarnings`/
  `registrationClassificationCache` (y los nuevos `agentRegistry`/
  `marketRegistry`/`marketBootstrapWarnings`/`marketAgendaLog`) se declaran
  en el `state` canónico, se crean en un único punto
  (`bootstrapRegistrationsForNewCareer()`) y se limpian todos al pulsar
  "volver a selección de equipo".
- **BUG-REG1-07 — una inscripción podía referenciar el contrato de OTRO
  jugador/club.** `RegistrationService.createRegistration()` aceptaba
  cualquier `contractId` sin comprobar que el contrato referenciado fuera
  realmente de ese jugador y ese club. Corregido con una comprobación
  cruzada (contrato opcional, pero si se pasa `contractRegistry` se exige
  coincidencia) que lanza `REGISTRATION_CONTRACT_PLAYER_MISMATCH`/
  `REGISTRATION_CONTRACT_CLUB_MISMATCH`; `RegistrationRegistry.validateIntegrity()`
  audita lo mismo para toda inscripción con `contractId`.
- **BUG-REG1-08 — un contrato `pending` (firmado pero todavía sin empezar)
  acreditaba elegibilidad de partido HOY.** La comprobación de elegibilidad
  usaba `contract.isCurrentOn(date)` (pensado para nómina/compromisos
  futuros) en vez de `contract.isActiveOn(date)` (relación laboral activa
  hoy). Corregido en el chequeo senior de `EligibilityService`, con nuevos
  motivos `CONTRACT_PLAYER_MISMATCH`/`CONTRACT_CLUB_MISMATCH` junto al
  fix anterior.
- **BUG-REG1-09 — un código de motivo de doble acta llevaba "ACB" en el
  nombre dentro de un core agnóstico de competición.** Renombrado
  `ALREADY_ON_OTHER_ACB_ACT_SAME_ROUND` → `ALREADY_ON_OTHER_ACT_SAME_ROUND`
  en `EligibilityService`/`game.js`/`test-reg1.js` — la regla de doble acta
  no es exclusiva de ACB.
- **BUG-PREEXISTING-TAC-01 — una alineación degenerada (un mismo jugador
  titular en dos posiciones a la vez) llegaba hasta
  `Tactics.computeAdvantageScore()` y lanzaba un `TypeError` dependiente de
  los datos, en vez de un error de dominio.** `Rotation.validateLineup()`
  detecta ahora el duplicado (`type: 'duplicate-on-court-starter'`) y lo
  rechaza antes de llegar al motor táctico. No cambia fórmulas, pesos ni el
  resultado de ninguna alineación válida.

Regresión sin fallos tras el fix: `test-reg1.js` (88), `test-contract1.js`
(102), `test-roster1.js` (31), `test-life1..4.js` (22/28/23/26).

#### Separación conceptual (quinto concepto distinto)

Contrato (CONTRACT-1), afiliación de plantilla (`Team.roster`), licencia/
inscripción (REG-1) y ahora **negociación/oferta/AIP** (MARKET-1) son
CUATRO conceptos distintos que ninguna sesión debe fusionar:

- una `NegotiationThread`/`ContractOffer`/`AgreementInPrinciple` nunca
  registra un contrato, nunca mueve `player.teamId`, nunca crea una
  licencia ni una inscripción;
- un agente/mandato de representación (`Agent`/`RepresentationMandate`)
  autoriza a alguien a negociar EN NOMBRE del jugador — nunca sustituye la
  decisión final del jugador (`playerSignsPersonallyAndRetainsFinalDecision`,
  principio FIBA universal);
- el derecho de tanteo (`RightOfFirstRefusalCase`) es un PROCEDIMIENTO con
  plazos reales, nunca un booleano `hasTanteo` en `Player`;
- un `AgreementInPrinciple` es el artefacto FINAL de MARKET-1 y el punto de
  ENTRADA de TRANSFER-1 — MARKET-1 se detiene justo antes de mutar
  cualquier registro de dominio.

#### Fuentes normativas y estado

- **FIBA** — Internal Regulations Book 3 (arts. 3-298 a 3-327, vigente
  desde 22-04-2026) + directorio oficial de agentes: principios de
  representación **universales** (`verified`), aplicables a cualquier
  competición/jurisdicción — mandato máximo 2 años, forma escrita,
  comisión máx. 10% pagada por el cliente, conflicto de interés,
  protección de menores (<18 sin captación), licencia FIBA exigida
  **solo** para transfer internacional (bloqueado hasta EUROPE-1, nunca
  para negociación doméstica sin ese contexto).
- **ACB — derecho de tanteo (arts. 13-17)** — BOE, IV Convenio colectivo
  de baloncesto profesional ACB (vigencia formal 2018-07-01/2022-06-30) +
  publicación operativa ACB del 06-07-2026 (14 jugadores, 13 días de
  documentos, 5 días para igualar). ACB seguía aplicando el procedimiento
  en 2026-27 pese a que el convenio publicado ya no está formalmente en
  vigor: módulo `acb-right-of-first-refusal-2026-27-provisional-v1`,
  estado **`provisional`** (nunca `verified`), con warning visible en toda
  pantalla que lo muestre y `knownSourceInconsistencies` declarando esa
  discontinuidad y la particularidad del art. 15.3.2 (12 días de terceros
  en inscripción preferente, frente a los 13 del procedimiento general).
- **EuroLeague** — ELPA, EuroLeague Framework Agreement 2024-27: overlay
  de contacto `reference-only`
  (`euroleague-efa-contact-overlay-2024-27-reference-only-v1`) — exige
  autorización previa del club empleador para negociar con un jugador
  EuroLeague bajo contrato, exención en los últimos 60 días antes de
  expirar. Nunca referenciado por ningún `RulesetBundle` real; demuestra
  que un overlay de negociación puede superponerse a la liga doméstica sin
  convertir `Team.division` en clave universal.
- **Primera FEB** — no hereda el tanteo ACB. Usa la negociación genérica
  del juego + normativa laboral CONTRACT-1 + principios FIBA cuando
  interviene un agente; la UI y la traza dicen explícitamente que no hay
  procedimiento doméstico adicional codificado (nunca "no tiene
  particularidades legales").
- **Competición ficticia de test** — fixture `reference-only`
  (`bm-test-fictional-market-window-reference-only-v1`) con una ventana de
  contacto distinta, activable fijando su id sin tocar `MarketService`, UI
  ni `Team.js` — prueba de extensibilidad, nunca asociada a un
  `RulesetBundle` real.

#### Arquitectura multi-liga (dominio `market` en `CompetitionRules.js`)

Nuevo dominio junto a `registration`/`employment` (REG-1/CONTRACT-1), con
el mismo patrón de catálogo/composición — nunca `if (division === '1ª')`:

- `MARKET_MODULES`: catálogo de `RuleModule`s de dominio `market`, cada
  uno con `familyId`/`layer`/`version`/`status`/`validity`/`sourceRefs`/
  `knownSourceInconsistencies`/`notImplemented`. Capas: `agent-principles`
  (FIBA, universal), `domestic-procedure` (ACB tanteo / ficticio de test),
  `membership-overlay` (EuroLeague).
- `resolveMarketDomain(ctx)`/`resolveMarketRules(context)`: resuelve
  agentPrinciples (siempre FIBA) + domesticProcedure (según
  `competitionId`, `null` si no hay módulo doméstico verificado) +
  overlays de membresía activos (solo si `membershipCompetitionIds` los
  declara Y están fijados explícitamente) + `agentPrinciples`/
  `domesticProcedure` congelados con `bundleId`+versión en `trace.fields`.
  Una competición desconocida lanza explícito — nunca hereda ACB.
- `deriveMarketCapabilities()`: `supportsQualifyingOffer`/
  `supportsRightOfFirstRefusal`/`requiresFibaLicensedAgentForInternationalTransfer`/
  etc. — la UI las consulta para decidir QUÉ MOSTRAR (p. ej. ocultar la
  pestaña "Derechos"), pero el CORE valida siempre con la política real
  (`RightOfFirstRefusalService.openCase()` lanza explícito si
  `marketContext.market.domesticProcedure` es `null`, con independencia de
  lo que la UI decida mostrar — la capacidad nunca es la única barrera,
  auditado en `test-market1.js` sección 6).
- ACB: `RulesetBundleCatalog` fija `modules.market` al id real. Primera
  FEB: no lo fija (permanece `null`) — nunca hereda por defecto.

#### Entidades, registros y ledger (event-sourced, mismo patrón que REG-1)

- `src/core/MarketEventTypes.js`: motor genérico `makeEventMachine()`
  reutilizado por dos máquinas — `ThreadEvents` (ciclo de vida de la
  conversación: consulta → permiso de contacto (si el overlay lo exige) →
  contacto → respuesta de interés diferida → confirmado/declinado →
  acuerdo/cierre) y `OfferEvents` (una versión de oferta: enviada →
  aceptada/rechazada/contraofertada/retirada/expirada — nunca mutada, una
  contraoferta es SIEMPRE una nueva `ContractOffer` con id/versión
  nuevos); `RightsCaseEvents` para el procedimiento de tanteo.
- `src/entities/Agent.js`: `Agent` (identidad simulada + licencia FIBA
  simulada) y `RepresentationMandate` (relación agente↔jugador, con
  vigencia y comisión).
- `src/entities/Market.js`: `NegotiationThread`, `ContractOffer`
  (`contractDraft` **congelado** con `Object.freeze()` al enviarse —
  invariante verificado por asignación-sin-efecto, no por
  `assert.throws()`, porque los módulos no-strict de Node no lanzan al
  reasignar una propiedad congelada), `AgreementInPrinciple`,
  `QualifyingOfferCase`, `RightOfFirstRefusalCase`, `ReturnRightsCase`,
  `DebtChallenge`, `PotentialCompensationClaim`.
- `src/core/AgentRegistry.js` / `src/core/MarketRegistry.js`: instancias
  EXPLÍCITAS por carrera (`state.agentRegistry`/`state.marketRegistry`,
  nunca singletons), con `validateIntegrity()` propio. `AgentRegistry`
  detecta conflicto de interés consultando `PlayerRegistry`
  (`player.teamId === involvedClubId`, nunca tratando un id de club como
  un `registrationScopeId`) y menores de edad vía
  `PlayerModule.calculateAge(player.birthDate, referenceDate)` — nunca
  `player.age` (lee reloj de sistema, prohibido en el core).
- `src/core/ContractService.js`: nueva función pura `validateDraft()` —
  valida un borrador de contrato con las MISMAS reglas de empleo de
  CONTRACT-1 (jurisdicción del empleador, moneda, forma escrita,
  documentos requeridos...) **sin registrar nada**; MARKET-1 la usa para
  decir "esta oferta sería legal" antes de enviarla, nunca para crear un
  `Contract` real.

#### Negociación, evaluación y determinismo

`src/utils/DeterministicRandom.js`: PRNG por hash FNV-1a
(`hash32`/`unitFrom`/`intFrom`/`pickFrom`) — **cero** `Math.random()` en
todo el árbol de mercado. Toda decisión de CPU deriva de un fingerprint
`careerSeed|playerId|threadId|offerVersion|decisionDate|policyVersion`:
misma semilla + mismos datos = misma negociación, siempre (verificado en
`smoke-market1.js`).

`src/core/NegotiationService.js`: `evaluateOffer()` calcula un
`fitScore = economicRatio*0.6 + durationScore*0.15 + roleScore*0.15 +
stabilityScore*0.10` (el económico domina deliberadamente — con pesos
más parejos una oferta al 30% del salario objetivo "aceptaba" por pura
duración/rol). `economicRatio` compara el **total garantizado de la
oferta contra el objetivo multiplicado por el número real de temporadas**
(`target = targetGuaranteedMinor(player) * Math.max(1, seasonsCount)`) —
comparar un total multi-temporada contra un objetivo de una sola
temporada hacía que cualquier contrato largo pareciese generoso sin
serlo. `generateCounterAdjustment()` decide accept/reject/counter de forma
determinista por ronda.

#### Presupuesto simulado y reservas

`computeInternalBudgetLimit()`: límite SIMULADO (nunca un presupuesto real
del club ni una regla de competición, advertencia visible en toda
pantalla que lo muestre) = `max(nómina garantizada comprometida, suelo de
staging 200.000€) * multiplicador [1.15, 2.0]` según
`team.reputation.financial`. `computeSquadCostPlan()` = comprometido
(`ContractRegistry`) + reservado (ofertas vivas + AIP, por
`marketRegistry.reservedTotalForClubSeason()`) + disponible.
`validateOfferBeforeSend()` combina esto con `ContractService.validateDraft()`
— una oferta que excede el disponible o viola las reglas de empleo se
rechaza ANTES de enviarse, con el error visible en el formulario.

#### Máquina ACB de derecho de tanteo (arts. 13-17)

`src/core/RightOfFirstRefusalService.js`, construido sobre
`resolved.market.domesticProcedure` — nunca `if (division === '1ª')`.
Plazos en **días naturales**, sin desplazar por fin de semana, congelados
al abrir el caso:

1. Día siguiente al último partido oficial: 3 días para que los clubes
   comuniquen la situación contractual.
2. 3 días más: ACB publica la lista de jugadores sin contrato.
3. Inmediatamente después: 3 días para acreditar la oferta cualificada
   (mínimo 100% del valor monetizado de la última retribución anual;
   máximo 3 ejercicios consecutivos hasta los 30 años — edad computada a 1
   de julio —, 3 más a partir de esa edad).
4. Tras ese plazo: 13 días para que un tercero presente un único
   documento de oferta firmado por jugador y club (duración, retribución
   bruta anual, conceptos fijos, especie, imagen, indemnización de
   extinción, honorarios del agente).
5. Traslado al club de origen al día natural siguiente.
6. 5 días naturales improrrogables para igualar — comparación EXACTA por
   componentes (10 mensualidades, especie, duración, cláusula de salida,
   honorarios), nunca un "valor total" ponderado por IA; nunca obliga a
   igualar promesa de rol/minutos/vivienda/preferencias personales.
7. Si iguala: depósito en 5 días. Si no iguala: el ofertante dispone de 10
   días. En ningún caso se registra todavía un contrato — el resultado
   queda como `legalOutcome pending-transfer-1`.

Variantes con máquinas/`procedureType` propios, no forzados dentro de la
secuencia general: **inscripción preferente** (art. 15 — hasta 21 años,
al menos una temporada junior completa en el club de origen, máximo 3
ejercicios, comunicación antes del 31 de marzo, oferta cualificada mínima
1x/1,5x/2x el salario mínimo según ejercicio, y **12 días** — no 13 — para
terceros, particularidad real del art. 15.3.2 conservada tal cual) y
**retorno** (art. 17 — 3 días para que el club de origen elija entre no
mantener la oferta, mantenerla, o esperar oferta de tercero con recargo
del 10% si decide igualarla). Una renuncia (art. 16) solo emite una
`PotentialCompensationClaim` **trazada, nunca pagada** — cálculo, cargo y
pago pertenecen a TRANSFER-1. El derecho iniciado conserva origen, módulo,
versión y procedimiento aunque el club ascienda/descienda después; Primera
FEB nunca adquiere tanteo por reutilizar el mismo `Player`/`Contract`.

**Deliberadamente sin gancho de apertura orgánica todavía**: en una
carrera normal, ningún `RightOfFirstRefusalCase` se abre solo todavía —
`openCase()`/`fileQualifyingOffer()` solo se ejercitan desde
tests/smoke con fixtures dirigidos (sección 14.3 del prompt: "no asignes
tanteo real... sin datos que lo acrediten"). No es un descuido: CONTRACT-1
garantiza `MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` (puente de
staging documentado hacia CYCLE-1) en TODO contrato firmado, bootstrap o
cantera — ningún contrato del mundo puede expirar antes de esa cota, así
que no existe todavía ningún "historial contractual real que sustente" la
apertura automática de un caso. El gancho de cierre de temporada que
recorrería contratos expirando y decidiría determinísticamente qué club
presenta oferta cualificada queda para cuando exista expiración/renovación
real de contratos (CYCLE-1) — construirlo ahora sería código inalcanzable
e imposible de verificar con los tests de esta entrega. **Este gancho ya
existe**: `AnnualCycleService.openRightsAndRetention()` (CYCLE-1, ver
9.22) abre estos casos orgánicamente dentro del ciclo anual.

#### Reloj, Agenda y "Continuar"

`market` se mueve de `RESERVED_FUTURE_EVENT_TYPES` a `EVENT_TYPES`
(`src/core/Events.js`). Los eventos programados (`interest-response`,
`offer-expiry`, `contact-permission-expiry`, ventanas de tanteo...) viven
en `MarketRegistry` (nunca en `newsLog`) y Agenda los deriva vía
`buildMarketAgendaEvent()`. `advanceGameClockTo()` (game.js) — el ÚNICO
punto que avanza `state.calendar` en las 7 llamadas existentes de
Liga/Copa/Playoffs/Ascenso/cierre — es también el único punto que
necesitó tocarse para que "Continuar" se detenga ante una contraoferta
viva del jugador o una decisión de igualar pendiente
(`computeMarketAttentionForClub()`); ningún motor de Liga/Copa/Playoffs/
Ascenso se tocó. Ninguna decisión usa `Date.now()`/timers/polling — toda
fecha viene de `state.calendar.currentGameDateTime` adaptada en la
frontera, y procesar el mismo intervalo dos veces es idempotente
(`processDueMarketEventsToDate()`). El botón principal de Home cambia
contextualmente a "Responder negociación"/"Decidir tanteo" y lleva
directamente a Mercado en vez de al siguiente partido.

#### Bootstrap ficticio y honestidad

`src/core/MarketSeeder.js`, determinista por fingerprint
(`careerSeed|generatorVersion|índice`), ejecutado **una sola vez** al
crear la carrera:

- 30 libres ficticios (6 por posición primaria, edades 18-34, nivel
  calibrado contra ACB/Primera FEB) — `teamId === null`, sin contrato,
  registrados en el Player Registry como instancia viva,
  `dataSource: 'simulated-market-free-agent-v1'`, `isReal: false`, badge y
  texto "Jugador ficticio generado para el mercado de esta partida; no es
  un dato real" visibles en toda fila que lo muestre.
- Agentes/mandatos simulados repartiendo una parte de los jugadores
  adultos (menores de 18 nunca reciben captación simulada, algunos
  adultos quedan autorrepresentados), procedencia simulada visible; nunca
  modifica retroactivamente el `representation` de un contrato ya firmado
  (el registro refleja la relación ACTUAL, el contrato conserva su
  snapshot de firma).

No repone el pool cada temporada (retiros/entradas/equilibrio son de
CYCLE-1) y no escribe nada en `data/real/`.

#### Interfaz

Pantalla **Mercado** (`src/ui/game.js` + `game.css`), 5 pestañas
responsive: Buscar jugadores, Seguimiento, Negociaciones, Agentes,
Derechos (esta última oculta cuando `!capabilities.has('supportsRightOfFirstRefusal')`
— incluida la corrección de que una pestaña "Derechos" activa al cambiar
de club a una competición sin procedimiento doméstico se reconducía sola a
"Buscar jugadores", nunca queda "atascada" mostrando el caso del club
anterior, ver bugs de esta entrega más abajo). Pestaña **"Mercado y
representación"** en la ficha universal del jugador. Nunca "Fichar" como
CTA fijo — el botón cambia según disponibilidad/estado real. Ningún
atributo oculto (potencial/ambición/profesionalidad) se imprime numérico
en Mercado.

#### Invariantes verificados

Contrato/afiliación/licencia/oferta/AIP siguen siendo cinco conceptos
distintos; un `ContractOffer` enviado es inmutable (una contraoferta es
SIEMPRE una nueva entidad); un AIP nunca toca `Team.roster`/
`ContractRegistry`/`RegistrationRegistry`/`player.teamId`; ninguna
decisión de mercado usa `Math.random()`/`Date.now()`; toda cantidad
monetaria es entera en unidad mínima (Minor); la licencia FIBA nunca se
exige a negociación doméstica sin `transactionScope === 'international'`;
el módulo EuroLeague `reference-only` nunca se autoselecciona en un
`RulesetBundle` real; ACB nunca es fallback de una competición
desconocida; el tanteo ACB es una máquina de estados fechada, nunca un
booleano; la capacidad de UI nunca es la única barrera de una regla de
dominio (el core valida siempre, verificado con
`RightOfFirstRefusalService.openCase()` lanzando explícito para Primera
FEB); `data/real/` permanece inmutable.

#### Pruebas y resultados reales

`scripts/test-market1.js`: **82 comprobaciones, 0 fallos**, en 9 grupos
(bugs base REG-1/táctico estabilizado, agentes, mercado/registro,
negociación, oferta/empleo/presupuesto, multi-liga, tanteo ACB, reloj,
auditorías estáticas de alcance). `scripts/smoke-market1.js 3`: 36 clubes
reales, **3 temporadas completas** con Liga+Copa+Playoffs+Ascenso+cantera+
mercado — 782 jugadores mundiales (30 libres ficticios del pool), 752
contratos, 2360 licencias / 2313 inscripciones, 5 agentes / 19 mandatos,
5 reservas de presupuesto, 1 Agreement in Principle, 4 casos de derecho
preferente y 1 de retorno (todos de fixtures dirigidos del propio smoke,
determinismo verificado con la misma semilla), 52 eventos de mercado
totales, fixture completo libre→consulta→oferta→AIP, fixture de rechazo,
fixture bajo contrato (condicionado a transfer), fixtures de tanteo ACB
(igualado/no igualado/decisión de usuario) y de inscripción
preferente/retorno, ascenso/descenso verificado sin heredar tanteo en
Primera FEB, registros conjuntos íntegros — **105.4s**.
`scripts/verify-market1-playwright.js` (escritorio y móvil sobre
`file://`): **TODO OK** en ambos modos — pantalla Mercado con 5 pestañas,
badges de simulación, seguimiento, ficha universal con pestaña de mercado
conservando estado al volver, apertura de consulta, contraoferta viva
del jugador inyectada deteniendo "Continuar", constructor de oferta con
error de presupuesto visible, oferta válida hasta AIP con roster
combinado invariante, fixture de tanteo ACB con deadline/warning
provisional visibles, Primera FEB sin pestaña Derechos, carrera nueva sin
arrastrar hilos/casos de la anterior, sin scroll horizontal, sin errores
de consola reales. Regresión sin fallos: `test-roster1.js` (31 OK),
`test-contract1.js` (102 OK), `test-reg1.js` (88 OK), `test-life1..4.js`
(22/28/23/26 OK), `smoke-roster1.js 3`, `smoke-contract1.js 3`,
`smoke-reg1.js 3`.

#### Bugs encontrados y corregidos durante esta entrega (BUG-MARKET1-\*)

Ninguno de estos dos bugs lo detectaron los tests unitarios/smoke
aislados — ambos solo aparecieron ejercitando el flujo real de firma en
`verify-market1-playwright.js` (verificación de interfaz real), motivo por
el que este paso es obligatorio y no opcional:

- **BUG-MARKET1-01 — una oferta de mercado firmada después del inicio de
  temporada era siempre irrealizable.** `buildMarketOfferDraft()`
  (game.js) fijaba SIEMPRE `startDate` en el 1 de julio de la primera
  temporada cubierta, con independencia de la fecha real de firma — pero
  `Contract.js` rechaza explícitamente cualquier firma retroactiva
  (`signedDate` posterior a `startDate`, "no hay altas retroactivas en
  esta entrega"). Como una firma de mercado casi nunca cae el primer día
  de temporada, CUALQUIER fichaje de un libre a mitad de temporada
  lanzaba ese error — el camino "feliz" de la pantalla Mercado estaba roto
  desde el primer uso real. Corregido: `startDate` es ahora la fecha de
  firma real cuando esta cae después del inicio de la primera temporada
  cubierta (nunca antes de ese inicio); el calendario de pagos de esa
  primera temporada ancla su primera cuota en esa misma fecha corregida en
  vez del inicio natural de temporada, y el número de cuotas de esa
  temporada se acota a los periodos que realmente caben hasta su fin (el
  número de cuotas por defecto asume una temporada completa desde julio;
  sin este ajuste, firmar en octubre generaba cuotas mensuales que
  vencían más allá del fin de esa misma temporada, otra vez rechazadas por
  `Contract.js` como fuera de vigencia). No toca `ContractSeeder`/
  CONTRACT-1: el ajuste vive solo en el constructor de borradores de
  MARKET-1.
- **BUG-MARKET1-02 — la pestaña "Derechos" quedaba visible al cambiar a un
  club sin procedimiento doméstico de tanteo.** `renderMarketScreen()`
  solo ocultaba la pestaña cuando la pestaña activa NO era ya "Derechos"
  (`container.dataset.activeTab` persiste entre renders para conservar la
  pestaña al volver de la ficha, decisión ya tomada en esta misma
  entrega) — así que dejar la pestaña Derechos activa en un club ACB y
  luego cambiar a un club de Primera FEB (competición sin
  `supportsRightOfFirstRefusal`) la dejaba "atascada" visible, aunque
  vacía. Corregido: la pestaña activa se reconduce a "Buscar jugadores" en
  el mismo render si la competición del club actual no soporta tanteo,
  independientemente de cuál fuera la pestaña anterior.

#### Archivos nuevos

`src/core/MarketEventTypes.js`, `src/entities/Agent.js`,
`src/entities/Market.js`, `src/core/AgentRegistry.js`,
`src/core/MarketRegistry.js`, `src/core/NegotiationService.js`,
`src/core/MarketService.js`, `src/core/MarketSeeder.js`,
`src/core/RightOfFirstRefusalService.js`, `src/utils/DeterministicRandom.js`,
`scripts/test-market1.js`, `scripts/smoke-market1.js`,
`scripts/verify-market1-playwright.js`.

#### Fuera de alcance de MARKET-1

Ejecutar el fichaje (mover `player.teamId`, registrar el contrato
definitivo, inscribir) — eso es **TRANSFER-1**; traspasos con club
tercero, buyouts, rescisión, cálculo/cargo/pago de compensación por
renuncia (art. 16) — TRANSFER-1; cesiones/subrogación — LOAN-1; transfer
internacional real y ejecución de la licencia FIBA para esa operación —
EUROPE-1; renovaciones/retiros/equilibrio de población y apertura orgánica
de casos de tanteo en cierre de temporada (bloqueada en su momento por el
suelo de `MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` de CONTRACT-1, ver más
arriba; **entregado en CYCLE-1, ver 9.22**) — CYCLE-1; save/load; ledger de
pagos/impagos real para el procedimiento
paralelo de deuda del art. 13.2 (se modela el procedimiento y sus
evidencias, nunca se inventan impagos). Siguiente entrega: **TRANSFER-1**
(traspasos, buyouts, rescisión y compensaciones).

_Migrado de `CLAUDE.md` (líneas 396-483 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### Mercado, agentes y derechos (MARKET-1, DESIGN.md 9.19)

Convenciones permanentes de MARKET-1 — aplican a toda sesión futura que
toque negociación, agentes/representación, ofertas, Agreement in
Principle o el procedimiento de tanteo ACB, y a TRANSFER-1/LOAN-1/
EUROPE-1 cuando construyan sobre esta entrega:

- Todo jugador negociable se resuelve desde el Player Registry mundial
  (`state.playerRegistry`) — código nuevo nunca busca un jugador
  recorriendo `Team.roster` de los equipos actuales como si fuera un
  índice global (mismo principio que ROSTER-1/REG-1).
- `state.agentRegistry` y `state.marketRegistry` son instancias
  EXPLÍCITAS por carrera (creadas en `bootstrapMarketForNewCareer()`,
  limpiadas al volver a selección de equipo) — nunca singletons, nunca
  recreadas de forma perezosa desde un renderizador.
- Un agente, una oferta o un derecho de tanteo NUNCA se duplican como
  campo suelto en `Player`/`Team` (`player.agent`, `player.currentOffer`,
  `team.offers`, `hasTanteo` y equivalentes están prohibidos y auditados
  estáticamente en `scripts/test-market1.js`) — viven solo en
  `AgentRegistry`/`MarketRegistry`.
- Oferta (`ContractOffer`), Agreement in Principle, contrato
  (`ContractRegistry`, CONTRACT-1), afiliación de plantilla
  (`Team.roster`) y licencia/inscripción (`RegistrationRegistry`, REG-1)
  son CUATRO conceptos distintos — un AIP nunca registra un contrato,
  nunca mueve `player.teamId`, nunca crea licencia ni inscripción. Esa
  ejecución es de TRANSFER-1, no de MARKET-1.
- Lógica de mercado nueva usa `competitionId`/módulos de
  `CompetitionRules.js` (dominio `market`) — nunca `division`
  (`1ª`/`2ª`), el nombre visible de una liga, ni ACB como comportamiento
  por defecto de una competición desconocida (lanza explícito).
- Un `NegotiationThread`/`RightOfFirstRefusalCase` congela sus módulos de
  reglas (`rulesSnapshot`/`procedureRules`) al abrirse — un ascenso/
  descenso posterior del club no reescribe la normativa de un hilo o caso
  ya abierto.
- Una `ContractOffer` enviada es INMUTABLE (`Object.freeze()` sobre su
  `contractDraft`) — una contraoferta es SIEMPRE una entidad nueva con id
  y versión propios, nunca una mutación de la anterior.
- Un borrador de oferta se valida con `ContractService.validateDraft()`
  (pura, sin registrar) — nunca se llama a
  `ContractRegistry.register()`/`ContractService.createContract()`/
  `Team.addPlayer()`/`removePlayer()`/`RegistrationService` desde un
  comando de Market ni desde la resolución de un AIP.
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217;
  fechas SIEMPRE civiles ISO vía `LocalDate`, nunca `Date.now()`/reloj de
  sistema dentro del core de mercado — toda fecha llega explícita desde
  `state.calendar.currentGameDateTime` adaptada en la frontera.
- El jugador conserva SIEMPRE la decisión final
  (`playerSignsPersonallyAndRetainsFinalDecision`, principio FIBA
  universal) — un agente/mandato autoriza a negociar en su nombre, nunca
  decide por él. Los conflictos de interés (mismo agente en ambos lados,
  representar a un club y a un jugador de ese club a la vez) se validan
  contra `PlayerRegistry`/afiliación real, nunca se asumen ausentes.
- La licencia FIBA de un agente NUNCA se exige para negociación
  doméstica sin `transactionScope === 'international'` — sigue bloqueada
  para transfer internacional real hasta EUROPE-1.
- El tanteo ACB (y sus variantes de inscripción preferente/retorno) es un
  PROCEDIMIENTO con máquina de estados y plazos fechados
  (`RightOfFirstRefusalService`) — nunca un booleano. El core valida
  siempre con la política real (`openCase()` lanza explícito si la
  competición no resuelve procedimiento doméstico) — una capacidad de UI
  (`capabilities.has('supportsRightOfFirstRefusal')`) decide solo qué
  MOSTRAR, nunca es la única barrera de una regla de dominio.
- `advanceGameClockTo()` sigue siendo el ÚNICO punto que avanza
  `state.calendar` — cualquier nueva parada obligatoria ante mercado
  (contraoferta viva, plazo de tanteo) se añade ahí, nunca repartida por
  los call-sites de Liga/Copa/Playoffs/Ascenso.
- No se ejecuta fichaje/traspaso/cesión/inscripción/contrato real antes
  de sus entregas (TRANSFER-1/LOAN-1) — MARKET-1 se detiene siempre en el
  Agreement in Principle.
- Todo dato simulado de mercado (libres ficticios, agentes, mandatos,
  contratos de fixture) lleva `dataSource`/dataSource simulado y
  `isReal: false` visibles — nunca se presenta como un dato real, y
  `data/real/` no se toca nunca desde este dominio.
- Los módulos `reference-only` (overlay EuroLeague, ventana de
  competición ficticia de test) nunca se autoseleccionan en un
  `RulesetBundle` real — solo se activan fijando su id explícitamente,
  como demostración de extensibilidad.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura de mercado o las reglas activas.
- Ningún caso de tanteo se abre orgánicamente todavía en una carrera
  normal (`openCase()` solo se ejercita desde tests/smoke con fixtures
  dirigidos) — CONTRACT-1 garantiza un mínimo de 3 temporadas restantes en
  todo contrato (`MINIMUM_PLAYABLE_REMAINING_SEASONS`, puente de staging),
  así que ningún contrato expira todavía dentro de un horizonte
  verificable. El gancho de apertura orgánica en cierre de temporada queda
  para CYCLE-1 (cuando exista expiración/renovación real) — no lo
  construyas antes, sería código inalcanzable e imposible de verificar.
