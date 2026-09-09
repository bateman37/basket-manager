# Arquitectura — economía real del club (ECONOMY-BOARD-1)

Contrato VIGENTE de la economía real del club: plan financiero anual,
tesorería derivada, calendario de cobros/pagos, impagos y proyección a 3
temporadas. **Sigue siendo simulación de juego** (`dataSource:
'simulated-club-finance-v1'`) — no son cuentas reales verificadas ni
cumplimiento regulatorio completo. Complementa, nunca sustituye, el
presupuesto salarial de plantilla de `docs/architecture/squad-budget.md`
(ese límite sigue siendo la única autoridad de "cuánto se puede comprometer
en salarios"; esta economía decide "cuánta caja hay realmente").

## Separaciones que nunca se difuminan

`planned` (plan anual) ≠ `committed` (contratos/obligaciones reales) ≠
`due` (`ScheduledCashFlowItem`) ≠ `paid` (`FinancePosting`). Una
asignación salarial (`SquadBudgetAllocation`) no es caja. La tesorería
**nunca** es un total mutable guardado — siempre se deriva sumando
`FinancePosting.signedAmountMinor` (`ClubFinanceRegistry.treasuryBalance()`).

## Entidades — `src/entities/ClubFinance.js`

- `ClubFinanceProfile`: arquetipo (`tight`/`balanced`/`comfortable`) y
  moneda del club, fijado UNA vez por carrera.
- `SeasonFinancialPlan`: plan anual INMUTABLE por club+temporada+moneda
  (revisiones encadenadas por `predecessorId`, mismo patrón que
  `SquadBudgetAllocation`). Guarda `salaryAnchorMinor`,
  `plannedIncomeMinor`, `targetMarginMinor`, `nonSalaryExpensePoolMinor`,
  el desglose exacto por categoría y `openingCashMinor` (solo `!= null`
  en el plan de APERTURA de carrera de ese club, nunca en una apertura de
  temporada posterior).
- `ScheduledCashFlowItem`: movimiento de caja FECHADO todavía no
  liquidado — idempotente por `sourceRef` (clave de idempotencia real,
  nunca un contador).
- `FinancePosting`: evidencia INMUTABLE de un movimiento ya resuelto
  (`opening-balance`/`credit`/`debit`/`overdue-evidence`/`cancellation`)
  — ledger append-only, nunca se edita ni se borra.

Categorías canónicas (sección 5.2 del prompt): 7 de ingreso
(`mainSponsorship`, `secondarySponsorship`, `tvRights`,
`leagueRevenueShare`, `europeanCompetition`, `ticketSales`,
`merchandising`) y 6 de gasto (`playerSalaries`,
`coachingStaffAggregate`, `facilitiesMaintenance`, `clubOperations`,
`transferAndLoanObligations`, `agentAndSettlementObligations`).
`clubOperations` es agregado simulado (administración/viajes/matchday/
scouting/academia) — etiquetado como tal, nunca contabilidad itemizada
real.

## Registro — `src/core/ClubFinanceRegistry.js`

Instancia EXPLÍCITA por carrera (`state.clubFinanceRegistry`), nunca un
singleton. Posee perfiles, cadenas de planes, items fechados y el ledger
de postings. `exportState()`/`restoreState()` son el contrato de
persistencia completo (mismo criterio que `SquadBudgetRegistry`) —
`snapshot()`/`describe()` siguen siendo resúmenes aparte.

## Política — `src/core/ClubFinancePolicy.js` (`POLICY_VERSION:
'simulated-club-finance-v1'`)

Tabla exacta por arquetipo (cuota salarial sobre ingreso planificado,
margen operativo objetivo, colchón de apertura en meses de gasto anual):
`tight` 56%/1%/2m, `balanced` 52%/3%/3m, `comfortable` 48%/5%/4m. Mezcla
de ingresos por defecto en basis points (suma 10000):
patrocinio principal 3200, secundario 1300, TV 1200, reparto de liga
1300, taquilla 2000, merchandising 1000, competición europea 0 (solo se
cobra desde un evento/política real de competición europea, sin
call-sites hoy). Pool no-salarial: cuerpo técnico agregado 30%,
mantenimiento de instalaciones 20%, operaciones de club 50%. Capacidad
financiera: horizonte de 3 temporadas, reserva mínima 1 mes de gasto
obligatorio, déficit acumulado máximo simulado 5% del ingreso base —
salvaguarda de simulación inspirada en el control económico de la ACB,
**nunca una certificación de ese reglamento real**.

## Servicio de dominio — `src/core/ClubFinanceService.js`

- **Arquetipo/estilo**: `assignArchetypes(clubIds, careerSeed)` —
  determinista (hash FNV-1a de `careerSeed+clubId`, nunca
  `Math.random()`), reparto en round-robin ACOTADO por tercios sobre el
  orden de hash estable (una carrera no puede sembrar accidentalmente el
  mismo arquetipo a los 36 clubes).
- **Ancla salarial**: `resolveSalaryAnchor()` lee la asignación EFECTIVA
  canónica de `SquadBudgetRegistry`; si una temporada futura del
  horizonte no tiene límite propio, crea una `forward-board-allocation`
  (`decisionAuthority: 'board-system'`) trasladando el límite de la
  temporada anterior con crecimiento CERO — nunca la fórmula de
  compatibilidad en directo (`docs/architecture/squad-budget.md`) para
  una temporada dentro del horizonte.
- **Plan**: `buildSeasonPlan()` es IDEMPOTENTE por club+temporada+moneda;
  usa `Money.allocateByWeights()` para que las categorías sumen EXACTO el
  total declarado. Una revisión posterior (apertura de temporada) NUNCA
  recalcula `plannedIncomeMinor`/`openingCashMinor` de un plan ya fijado
  — aprobar más presupuesto salarial no fabrica ingreso.
- **Calendario de cobros/pagos**: `ensureScheduledItemsForClubPlan()`
  crea (IDEMPOTENTE) los items mensuales/tramos/salarios/obligaciones de
  un plan ya construido — se invoca en cada sincronización del calendario
  mundial (`createClubFinanceEventSource().listPendingItems()`), un
  patrón deliberado de "ensure-then-list" (no puramente de solo lectura
  como `market-event`, pero idempotente y determinista: nunca duplica,
  nunca inventa una fecha). IDs con prefijo de orden (`0-` inflow,
  `1-` outflow) para que, a igualdad de fecha, un cobro se procese
  siempre antes que un pago del mismo club (sección 5.6 del prompt).
- **Backfill de nómina**: `resolveContractCashSchedule()` usa
  `Contract.paymentPolicy.schedule` real cuando existe; si el contrato
  cubre la temporada sin calendario usable, deriva 12 cuotas mensuales
  SOLO para finanzas (`simulated-payment-schedule-backfill-v1`, nunca
  reescribe `Contract`).
- **Obligaciones**: `scheduleFinancialObligations()` lee
  `TransferRegistry.allObligations()` (transfer Y loan comparten esa
  colección) filtradas por deudor=club — las que tienen `dueDate`/
  `schedule` real generan un item fechado; las que no, quedan como
  `unscheduledExposureForClub()` (exposición comprometida SIN fecha
  inventada).
- **Resolución**: `resolveScheduledItem()` — un `inflow` siempre se
  postea; un `outflow` solo si `treasuryBalance >= amountMinor`
  (nunca negativo); si no cabe, UN `overdue-evidence` posting (nunca se
  duplica mientras el item siga `overdue`). Tras resolver CUALQUIER item
  de un club, `retryOverdueForClub()` reintenta (orden estable
  `dueDate`/`id`) los impagos que ahora quepan — liquidación NUEVA
  (posting nueva), la evidencia de impago original NUNCA se reescribe ni
  se borra.
- **Taquilla**: `recordHomeMatchTicketReceipt()` — un `matchId` genera A
  LO SUMO un recibo (idempotente por id), baseline fijado en el plan
  (`ticketBaselinePerGameMinor`, derivado de la cuota de taquilla del
  plan ÷ partidos en casa esperados — nunca una autoridad de aforo/precio
  nueva).
- **Proyección**: `projectSeason()`/`buildRollingProjection()` — modelo
  de LECTURA pura a 3 temporadas (actual con datos mensuales reales,
  las 2 siguientes solo anuales, sección 6.1 del prompt). Nunca persiste
  el resultado — se recalcula siempre desde postings/items/planes.

## Capacidad financiera dura — `src/core/FinancialCapacityService.js`

`evaluateFinancialCapacity()` es el ÚNICO gate de "cuánto salario
adicional cabe" — independiente de confianza/personalidad de junta
(`BoardBudgetRequestService` lo consulta SIEMPRE antes de aplicar
cualquier techo de disposición). Reglas: bloqueo TOTAL (headroom 0 en
todas las temporadas evaluadas) si hay algún impago obligatorio
bloqueante; si no, el headroom de cada temporada es el mínimo entre (a) el
margen sobre la reserva mínima de esa temporada (mensual real en la
actual, anual en las 2 siguientes) y (b) un pool COMPARTIDO de capacidad
de déficit acumulado a 3 temporadas (5% del ingreso base menos el
resultado acumulado ya proyectado). Una temporada fuera del horizonte de
3 temporadas construido devuelve `FORECAST_HORIZON_UNAVAILABLE` sin mutar
nada.

## Integración con calendario mundial

`ClubFinanceService.createClubFinanceEventSource()` implementa el
protocolo `WorldCalendarSource` (`docs/architecture/world-calendar.md`)
con `sourceType: 'club-finance-event'` — AUTOMÁTICA desde el punto de
vista del coordinador (mismo criterio que `transfer-event`/`loan-event`):
nunca para "Continuar". Un impago nuevo/liquidado del club CONTROLADO
produce una noticia (`Events.buildFinanceOverdueNewsEvent()`/
`buildFinanceOverdueSettledNewsEvent()`, `newsCategory: 'finance'`) — el
"stop/inbox/news result" de la sección 5.7 del prompt es esa noticia, no
una parada real de la cola cronológica (extender el estado finito del
coordinador para esto no estaba autorizado y hubiera sido un cambio de
mucho más riesgo). Un partido en casa REAL genera su recibo de taquilla
desde `applyPostMatchEffects()` en `game.js` (nunca desde la fuente de
calendario, que no conoce resultados de partido).

## Integración productiva

- **Bootstrap de carrera** (`bootstrapClubFinanceAndBoardForNewCareer()`
  en `game.js`): perfil + plan de las 3 temporadas del horizonte para los
  36 clubes, DESPUÉS de `bootstrapSquadBudgetForNewCareer()`.
- **Apertura de temporada** (`closeSeasonAndPrepareNext()`): rueda el
  horizonte construyendo (idempotente) el plan de la temporada nueva +2,
  ancladas en la asignación ya congelada/trasladada.
- **Ciclo anual**: no se duplica ninguna fase de `AnnualCycleService` —
  el roll de horizonte y la evaluación de manager (ver
  `docs/architecture/board-budget-requests.md`) se orquestan desde el
  MISMO punto único de cierre de temporada que ya existía.
- **CPU**: los 36 clubes usan la MISMA aritmética de finanzas/pagos/
  headroom — nunca una fórmula separada para el usuario.

## Persistencia (`schemaVersion` 2 → 3)

`CareerPersistenceBoundary` declara `clubFinance` como colección durable
(`dependsOn: ['squadBudget', 'contracts', 'transfers', 'worldRegistries']`).
`CareerHydrationService`: un guardado v3 restaura sin pérdida; un
guardado v1/v2 (sin la colección) inicializa el perfil/plan de las 36
clubes EN LA FECHA REAL del guardado — nunca retroactivamente. La fuente
`club-finance-event` recibe un `notBeforeDate` (la fecha de migración)
para que ningún mes ya pasado se programe con retraso ni fabrique un
impago histórico (invariante explícita: "save migration never creates
retroactive arrears").

## Qué NO cubre esta Epic

Ver `docs/epics/ECONOMY-BOARD-1.md`, sección "Deuda aplazada", para la
lista completa (inyecciones de capital, deuda, sanciones por impago,
presupuesto de operaciones/traspasos separado, ticket pricing/
patrocinio negociable, cuerpo técnico como entidad propia, reglas de
control económico específicas de competición).
