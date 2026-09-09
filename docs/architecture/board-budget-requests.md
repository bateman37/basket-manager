# Arquitectura — manager, confianza de junta y peticiones de ampliación (ECONOMY-BOARD-1)

Contrato VIGENTE del manager humano, la confianza/personalidad de junta y
las peticiones jugables de ampliación de presupuesto salarial. Depende de
`docs/architecture/club-finance.md` (capacidad financiera) y
`docs/architecture/squad-budget.md` (el límite que se revisa).

## Rol jugable (sin cambios de fondo)

El manager sigue siendo un manager deportivo completo — este contrato
añade la posibilidad de PEDIR más presupuesto, nunca de fijarlo
unilateralmente. La junta sigue siendo quien decide (`decisionAuthority:
'board-system'` cuando resuelve el sistema). Costura explícita para un
futuro modo manager+junta/propiedad: cambiar quién invoca
`BoardBudgetRequestService.submitRequest()`/quién sería el actor de
`resolveRequest()` no toca el cálculo de capacidad ni el de confianza.

## Empleo del manager — `src/entities/ManagerBoard.js` +
`src/core/{ManagerBoardRegistry,ManagerEmploymentService}.js`

- `ManagerProfile`: identidad ÚNICA por carrera (`manager:<careerSeed>`),
  creada al arrancar la carrera nueva (o al migrar un guardado v1/v2)
  para el club controlado — nunca para los clubes CPU.
- `EmploymentSpell`: registro de una etapa de empleo (`startGameDate`/
  `endGameDate`, `authorityRole: 'manager'`). `startSpell()`/`endSpell()`
  son comandos EXPLÍCITOS listos para una futura mecánica de despido/
  cambio de club — no jugables todavía.
- `SeasonEvaluation`: INMUTABLE, registrada una vez por temporada cerrada
  (`ManagerEmploymentService.recordSeasonEvaluationIfMissing()`,
  idempotente por spell+temporada — cerrar/reanudar nunca la duplica).
  `classifySeasonSportingOutcome()` compara la posición final REAL contra
  el objetivo (`board.sportingGoal`) que estaba vigente para ESA
  temporada, capturado en `game.js` ANTES de que
  `SeasonGoals.recalculateSportingGoalsForCohort()` lo sobrescriba con el
  de la temporada que empieza.
- `BoardPolicyProfile`: estilo fiscal simulado (`conservative`/
  `balanced`/`ambitious`), determinista por `careerSeed+clubId`
  (`BoardConfidenceService.assignFiscalStyles()`, mismo criterio de hash+
  round-robin acotado que el arquetipo financiero, espacio de hash
  independiente).

## Confianza de junta — `src/core/BoardConfidenceService.js`
(`POLICY_VERSION: 'board-confidence-policy-v1'`)

Tres dimensiones, enteras `0..100`:

- **Deportiva**: sin partidos oficiales, 50 fijo. Con partidos, el
  percentil REAL de standings (`runner.getStandings()`, nunca texto de
  UI ni `team.division`) se compara contra la banda objetivo del texto
  YA existente de `board.sportingGoal` (título ≈ top 15%, playoffs ≈ top
  45%, consolidación por encima del 25% inferior, permanencia por encima
  del 10% inferior) y se REGRESA hacia 50 según el progreso de temporada
  (un partido no puede mover la confianza de golpe). Modificador de forma
  reciente acotado a ±10 — v1 lo deja en 0 (refinamiento pendiente,
  requeriría reconstruir el histórico de los últimos 5 resultados reales).
- **Disciplina financiera**: 0 si hay un impago obligatorio bloqueante
  (`FinancialCapacityService`); si no, base 70 (dentro de presupuesto,
  sin impagos, previsión cumple el objetivo), +10 si el resultado
  proyectado de temporada es ≥5% del ingreso planificado, −15 si la caja
  proyectada cae bajo la reserva requerida, −25 si comprometido+reservado
  supera la asignación canónica (`SquadBudgetService.deriveBudgetView().
  overcommittedMinor > 0`).
- **Relación/antigüedad**: 40 base + 1 punto por mes de empleo completado
  (tope +24) + ajuste por temporada evaluada (+10 supera el objetivo, +5
  lo cumple, −10 lo incumple; tope acumulado ±25).

Global = `round(45% deportiva + 35% disciplina + 20% relación)`. El
objetivo financiero se genera desde `structuredFinancialGoal()` (una
estructura fija: sin impagos bloqueantes, reserva mínima, déficit máximo
simulado) — el texto español (`describeFinancialGoalEs()`) se DERIVA de
ahí, nunca la prosa legacy de `Club.board.financialGoal` usada como
autoridad.

## Petición de ampliación — `src/entities/BoardBudgetRequest.js` +
`src/core/BoardBudgetRequest{Registry,Service}.js`
(`POLICY_VERSION: 'board-budget-request-policy-v1'`)

- **Dos orígenes, un comando**: `source: 'blocked-operation'` (desde
  `shortfalls[]` real de `MarketService.validateOfferBeforeSend()`, con
  `operationSnapshot` no vinculante — nunca crea oferta/AIP/reserva) o
  `source: 'finance-screen'` (importe libre + sugerencias 5/10/20% de UI,
  cualquier temporada del horizonte de 3). Ambos llaman al MISMO
  `BoardBudgetRequestService.submitRequest()`/registro — el cooldown
  nunca se puede saltar cambiando de pantalla.
- **Envío ATÓMICO**: rechaza sin crear NADA si hay una petición sin
  resolver del club (`REQUEST_PENDING`), si el cooldown compartido sigue
  activo (`COOLDOWN_ACTIVE`), si hay un impago obligatorio bloqueante
  (`OVERDUE_PAYMENT_BLOCK`) o si alguna temporada solicitada está fuera
  del horizonte de 3 temporadas construido (`FORECAST_HORIZON_UNAVAILABLE`).
- **Retraso determinista**: 1 día si el ratio máximo solicitado (sobre el
  límite efectivo de esa temporada) es ≤5%, 2 días si es ≤10%, 3 días en
  el resto — calculado al ENVÍO, guardado en `dueDateBasis`.
- **Resolución en el vencimiento** (nunca al envío, snapshots de
  confianza/capacidad conservados en ambos momentos): capacidad
  financiera PRIMERO (`FinancialCapacityService`, bloqueo total si hay
  impago) — la disposición de la junta (techo por confianza global,
  tabla exacta 0/5/10/15/20% según banda `<35/35-49/50-64/65-79/80-100`,
  ajuste ±5 puntos por estilo fiscal, clamp final 0..20%) SOLO puede
  RECORTAR, nunca ampliar, ese headroom.
- **Clasificación determinista**: si TODAS las temporadas quedan en 0 →
  `rejected`; si TODAS igualan lo pedido → `approved`; si al menos una es
  positiva pero no todas completas → `partially-approved` (cada importe
  parcial se redondea a la baja a 1.000 EUR — `Money.roundToMultiple`;
  si eso da 0, esa temporada se rechaza con razón explícita en vez de
  crear una revisión sin sentido).
- **Razones estructuradas**: `OVERDUE_PAYMENT_BLOCK`,
  `NO_FINANCIAL_HEADROOM`, `LOW_BOARD_CONFIDENCE`, `BOARD_WILLINGNESS_CAP`,
  `PARTIAL_FINANCIAL_CAPACITY`, `COOLDOWN_ACTIVE`, `REQUEST_PENDING`,
  `FORECAST_HORIZON_UNAVAILABLE`, `APPROVED_WITHIN_LIMITS` — siempre
  acompañadas de `explanationEs` en español.
- **Aplicación atómica**: cada temporada aprobada revisa
  `SquadBudgetService.recordRevision()` (`revisionKind: 'board-revision'`,
  `decisionAuthority: 'board-system'`, `amountMinor = límite efectivo +
  aprobado`); las revisiones de todas las temporadas aprobadas se
  construyen ANTES de registrar ninguna — un rechazo nunca crea ninguna
  revisión, una aprobación nunca reenvía la oferta de mercado bloqueada
  (el manager la reintenta manualmente contra el nuevo límite).
- **Cooldown compartido**: 60 días de mundo tras una resolución
  aprobada/parcial, 30 tras un rechazo — el bloqueo por impago persiste
  aunque la fecha de cooldown ya haya expirado.

## Integración con calendario mundial

`BoardBudgetRequestService.createBoardEventSource()` implementa el
protocolo `WorldCalendarSource` con `sourceType: 'board-event'` —
AUTOMÁTICA (nunca para "Continuar", mismo criterio que
`club-finance-event`). Una resolución del club CONTROLADO produce una
noticia (`Events.buildBoardRequestResolvedNewsEvent()`,
`newsCategory: 'board'`).

## Integración productiva

- **Mercado bloqueado**: `game.js` añade un CTA "Solicitar autorización a
  la directiva" tras un `shortfalls[]` real — deshabilitado con motivo
  explícito si ya hay petición pendiente, cooldown activo o impago
  bloqueante (`describeBoardRequestEligibility()`).
- **Finanzas**: pestaña "Solicitar ampliación" (temporada + importe
  libre + sugerencias 5/10/20% + estado/cooldown/historial).
- **Directiva**: pantalla nueva, solo lectura — empleo/antigüedad, estilo
  fiscal, objetivos, las 3 dimensiones de confianza con desglose y el
  historial de peticiones. Sin controles de propietario.
- **CPU**: los clubes CPU tienen `BoardPolicyProfile` pero NO abren
  petición jugable — su planificación de presupuesto futura podrá
  reutilizar la misma política de junta directamente (follow-up, sección
  9.3 del prompt), no implementado en esta Epic.

## Persistencia (`schemaVersion` 2 → 3)

`managerBoard` (`dependsOn: ['worldRegistries']`) y `boardBudgetRequests`
(`dependsOn: ['managerBoard', 'squadBudget']`) son colecciones durables
nuevas. Un guardado v1/v2 migra creando el manager/spell activo desde
`careerSetup.createdAtGameDate` y el club controlado (nunca el reloj de
sistema) y los `BoardPolicyProfile` de los 36 clubes — sin ninguna
petición ni evaluación de temporada histórica (invariante: la migración
nunca fabrica historia que no ocurrió).

## Qué NO cubre esta Epic

Ver `docs/epics/ECONOMY-BOARD-1.md`, sección "Deuda aplazada" —
despido/contratación de manager, modo presidente/propietario jugable,
negociación multi-ronda con la junta, planificación de presupuesto CPU
reutilizando `BoardPolicyProfile` directamente.
