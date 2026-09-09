# Ficha de Epic — ECONOMY-BOARD-1 (economía real del club + junta)

- **Identificador**: `ECONOMY-BOARD-1`
- **Estado**: cerrada
- **Objetivo**: dar al club una economía real simulada (plan anual,
  tesorería, impagos, proyección a 3 temporadas), una junta con confianza
  dinámica y un manager con empleo/antigüedad, y peticiones jugables de
  ampliación del presupuesto salarial ya entregado por `SQUAD-BUDGET-1`.
- **Alcance y exclusiones**: ver secciones 4.2/4.3/13 del prompt original —
  incluye finanzas/tesorería/impagos/proyección, manager/junta/confianza y
  peticiones de ampliación; excluye modo presidente/propietario jugable,
  inyecciones de capital/deuda/refinanciación, sanciones por impago,
  precios de entrada/aforo/patrocinio negociable, cuerpo técnico como
  entidad propia, presupuesto de operaciones/traspasos separado y despido/
  contratación de manager.
- **Archivos permitidos**: `src/entities/ClubFinance.js`,
  `src/core/ClubFinance{Policy,Registry,Service}.js`,
  `src/core/FinancialCapacityService.js`, `src/entities/ManagerBoard.js`,
  `src/core/ManagerBoardRegistry.js`, `src/core/ManagerEmploymentService.js`,
  `src/core/BoardConfidenceService.js`, `src/entities/BoardBudgetRequest.js`,
  `src/core/BoardBudgetRequest{Registry,Service}.js`,
  `src/ui/{FinanceScreen,DirectivaScreen}.js`, `src/entities/SquadBudget.js`
  (enums nuevos), `src/core/{CareerPersistenceBoundary,
  CareerHydrationService}.js`, `src/core/Events.js` (noticias), `src/ui/
  game.js` (solo wiring), `index.html`, `scripts/test-economy-board1.js`,
  documentación.
- **Dependencias**: `SQUAD-BUDGET-1` (presupuesto salarial canónico),
  `SAVE-LOAD-1`/`WORLD-HARDEN-1` (frontera de persistencia), `SIM-CAL-1`/
  `WORLD-CALENDAR-1` (protocolo `WorldCalendarSource`), `CONTRACT-1`/
  `TRANSFER-1`/`LOAN-1` (`Contract.paymentPolicy`, `FinancialObligation`).
- **Decisiones cerradas**:
  - Finanzas/tesorería/impagos son SIMULACIÓN de juego
    (`dataSource: 'simulated-club-finance-v1'`), nunca datos reales del
    club ni certificación del reglamento ACB.
  - `club-finance-event`/`board-event` son fuentes de calendario
    AUTOMÁTICAS (nunca paran "Continuar") — el aviso al usuario es
    siempre una noticia (`newsCategory: 'finance'|'board'`).
  - Capacidad financiera (`FinancialCapacityService`) es un gate DURO,
    siempre evaluado antes que confianza/personalidad de junta.
  - Autoridad de decisión de junta resuelta por el SISTEMA usa
    `decisionAuthority: 'board-system'` (nuevo, distinto de
    `board-system-seed`/`board-manual`), dejando la costura lista para un
    futuro modo manager+propiedad.
  - Save schema v2 → v3; v1/v2 siguen siendo legibles vía migración.
- **Preguntas abiertas**: ninguna bloqueante — ver "Deuda aplazada".
- **Documentos canónicos**: `docs/architecture/club-finance.md`,
  `docs/architecture/board-budget-requests.md`.
- **Pruebas mínimas**: `node scripts/test-economy-board1.js`,
  `node scripts/test-squad-budget1.js`, `node scripts/test-save-load1.js`,
  `node scripts/test-world-calendar1.js`, `node scripts/test-sim-cal1.js`,
  `node --check` de cada archivo modificado, `node scripts/
  check-docs-context.js`, `git diff --check`.
- **Criterios de aceptación**: ver sección 16 del prompt original —
  resumidos en "Resultado" abajo.

## Resultado (al cerrar)

### Qué se implementó

**Fase A — economía real del club** (`src/entities/ClubFinance.js`,
`src/core/ClubFinance{Policy,Registry,Service}.js`,
`src/core/FinancialCapacityService.js`):

- `ClubFinanceProfile` (arquetipo `tight`/`balanced`/`comfortable`, fijado
  una vez por `careerSeed+clubId` mediante hash + round-robin acotado,
  nunca `Math.random()`), `SeasonFinancialPlan` (plan anual INMUTABLE,
  categorías exactas de la sección 5.2, `Money.allocateByWeights()` para
  que las categorías sumen EXACTO el ingreso planificado), `ScheduledCashFlowItem`
  (movimiento fechado, idempotente por `sourceRef`) y `FinancePosting`
  (ledger append-only; la tesorería SIEMPRE se deriva sumando postings,
  nunca un total mutable).
- `ClubFinanceService.resolveSalaryAnchor()` crea, cuando falta, una
  `SquadBudgetAllocation` `forward-board-allocation` (`decisionAuthority:
  'board-system'`) trasladando sin crecimiento el límite de la temporada
  anterior — nunca la fórmula de compatibilidad en directo para una
  temporada futura del horizonte.
- Calendario de cobros/pagos: patrocinio/merchandising mensuales, TV/
  reparto de liga en 3 tramos iguales (ajuste por méritos del tramo de
  cierre queda como refinamiento explícito pendiente), taquilla por
  partido en casa REALMENTE jugado (`recordHomeMatchTicketReceipt()`, un
  `matchId` → a lo sumo un recibo), salarios desde
  `Contract.paymentPolicy.schedule` real o backfill mensual etiquetado
  `simulated-payment-schedule-backfill-v1` (nunca reescribe `Contract`),
  obligaciones de traspaso/cesión/agente con fecha real
  (`FinancialObligation.dueDate`/`schedule`) — las que no tienen fecha
  quedan como exposición NO programada, nunca con fecha inventada.
  IDs construidos para que un `inflow` ordene siempre antes que un
  `outflow` del mismo club/fecha (procesamiento correcto sin lógica extra).
- Impagos: un pago que no cabe se convierte en UN impago durable (nunca
  parcial, nunca negativo); el siguiente movimiento resuelto del mismo
  club reintenta (en orden estable) los impagos que ya quepan —
  liquidación NUEVA, evidencia original nunca reescrita.
- `FinancialCapacityService.evaluateFinancialCapacity()`: gate duro
  independiente de confianza — bloqueo total por impago obligatorio,
  cap por reserva mínima de caja (mensual real en la temporada actual,
  anual en las 2 siguientes) y cap por un pool compartido de déficit
  acumulado máximo (5% del ingreso base a 3 temporadas, salvaguarda de
  simulación inspirada en ACB, nunca una certificación de ese reglamento).

**Fase B — manager y junta** (`src/entities/ManagerBoard.js`,
`src/core/ManagerBoardRegistry.js`, `src/core/ManagerEmploymentService.js`,
`src/core/BoardConfidenceService.js`):

- `ManagerProfile`+`EmploymentSpell` (comandos explícitos de alta/baja,
  sin despido/cambio de club jugable todavía) + `SeasonEvaluation`
  INMUTABLE registrada una vez por temporada cerrada (idempotente por
  spell+temporada).
- `BoardPolicyProfile` (estilo fiscal `conservative`/`balanced`/
  `ambitious`, mismo criterio hash+round-robin, espacio de hash
  independiente del arquetipo financiero).
- Tres dimensiones de confianza (0..100, política v1 versionada): deportiva
  (percentil real de standings vs banda del texto de
  `board.sportingGoal`, regresión hacia 50 según progreso de temporada,
  modificador de forma reciente acotado a ±10 — v1 lo deja en 0,
  refinamiento pendiente), disciplina financiera (base 70, +10 superávit,
  −15 reserva insuficiente, −25 sobrecompromiso, 0 si hay impago
  bloqueante) y relación/antigüedad (40 base, +1/mes hasta +24,
  ±10/±5 por temporada evaluada, tope ±25). Global =
  `round(45% deportiva + 35% disciplina + 20% relación)`.
- Objetivo financiero ESTRUCTURADO (`structuredFinancialGoal()`) — el
  texto español se genera desde ahí, nunca al revés.

**Fase C — peticiones de ampliación** (`src/entities/BoardBudgetRequest.js`,
`src/core/BoardBudgetRequest{Registry,Service}.js`):

- Envío atómico/idempotente desde dos orígenes (`blocked-operation`/
  `finance-screen`), mismo comando y registro, mismo cooldown compartido
  (60 días tras aprobación total/parcial, 30 tras rechazo) y bloqueo por
  impago obligatorio independiente de la fecha de cooldown.
- Retraso de respuesta 1/2/3 días según el ratio máximo solicitado sobre
  el límite efectivo; resuelto por `board-event` en su fecha de
  vencimiento (nunca al envío).
- Decisión: headroom financiero PRIMERO, disposición de la junta después
  (techo por confianza global + ajuste de ±5 puntos por estilo fiscal,
  clamp 0..20%) — nunca supera el headroom. Aprobación parcial se
  redondea a la baja a 1.000 EUR; si eso da 0, se rechaza con razón
  explícita en vez de crear una revisión sin sentido.
- Aplicación atómica multi-temporada vía
  `SquadBudgetService.recordRevision()` (`revisionKind: 'board-revision'`,
  `decisionAuthority: 'board-system'`) — un rechazo no crea ninguna
  revisión; una aprobación nunca reenvía la oferta de mercado bloqueada.

**Integración productiva**: bootstrap de carrera construye perfil+plan de
3 temporadas y el manager/junta de los 36 clubes; `closeSeasonAndPrepareNext()`
rueda el horizonte financiero (+1 temporada nueva) y registra la
evaluación de temporada del manager ANTES de recalcular
`board.sportingGoal`; `MarketService.validateOfferBeforeSend()` expone
`shortfalls[]` ya consumido por un CTA real "Solicitar autorización a la
directiva" en Mercado; pantallas Finanzas (extendida: resumen/tesorería/
presupuesto/proyección/solicitud) y Directiva (nueva, solo lectura) nuevas.

**Persistencia**: schema v2 → v3, tres colecciones durables nuevas
(`clubFinance`/`managerBoard`/`boardBudgetRequests`) en
`CareerPersistenceBoundary`; `CareerHydrationService` migra v1/v2
inicializando la economía EN LA FECHA del guardado (`notBeforeDate`, nunca
programa retroactivamente un mes ya pasado ni fabrica un impago
histórico) y crea el manager/spell desde `careerSetup.createdAtGameDate`.

### Pruebas realmente ejecutadas

```
node scripts/test-economy-board1.js   → 37 OK, 0 FAIL
node scripts/test-squad-budget1.js    → 16 OK, 0 FAIL
node scripts/test-save-load1.js       → 12 OK (test 9 actualizado: la
                                          "versión futura" de referencia
                                          pasa de 3 a 4, porque v3 ya es
                                          la versión soportada)
node scripts/test-world-calendar1.js  → 25 OK, 0 FAIL
node scripts/test-sim-cal1.js         → 10 OK, 0 FAIL
node --check <cada archivo modificado/nuevo>  → sin errores
node scripts/check-docs-context.js    → sin referencias rotas
git diff --check                      → sin espacios en blanco residuales
```

Ninguna sesión de Claude Code ha ejecutado Playwright ni el checklist
manual en navegador real — pendiente de Dennis
(`docs/manual/ECONOMY_BOARD_ACCEPTANCE.md`).

### Deuda aplazada (explícita, ver sección 12 del prompt original)

1. Modo jugable manager+junta/propiedad (owner-mode) — la costura de
   autoridad (`decisionAuthority: 'board-system'`) ya está lista.
2. Inyecciones de capital del propietario, deuda bancaria, refinanciación
   y plan de viabilidad — nunca implementados, ni siquiera como fallback
   silencioso.
3. Sanciones/consecuencias reales de un impago (deportivas,
   administración, venta forzosa, despido, refinanciación) — hoy solo se
   registra y bloquea la ampliación de presupuesto.
4. Presupuesto de operaciones/traspasos separado del salarial antes de
   comprometer una comisión — las obligaciones ya dadas entran en
   tesorería y pueden caer en impago, pero no hay un pre-commit de caja.
5. Ticket pricing, negociación de patrocinio y controles de inversión en
   instalaciones — siguen sin autoridad jugable.
6. Cuerpo técnico como entidad propia y coste salarial individual.
7. Datos financieros reales/investigados que sustituyan la política
   simulada v1.
8. Reglas de control económico específicas de ACB/FEB/competición europea
   — el 5% de esta Epic es una salvaguarda de simulación, no una
   certificación.
9. Despido/contratación de manager, mercado de trabajo de entrenadores,
   cambio de club jugable.
10. Liquidación avanzada de bonus variables y amortización/impuestos
    contables.
11. Ajuste por méritos deportivos del tramo de cierre de TV/reparto de
    liga (v1 usa tercios iguales) y modificador de forma reciente de la
    confianza deportiva (v1 lo deja en 0, acotado ±10 por diseño).
12. Checklist manual en navegador real — pendiente de Dennis.
