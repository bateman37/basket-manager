# Arquitectura — presupuesto salarial de plantilla (SQUAD-BUDGET-1)

Contrato VIGENTE del presupuesto salarial de plantilla ("sporting salary
budget"): cuánto puede comprometer un club en salarios garantizados de
jugadores por temporada. **No es caja del club, ingresos ni beneficio** —
eso pertenece a una entrega futura de economía completa (ver "Deuda
aplazada" en `docs/epics/SQUAD-BUDGET-1.md`).

## Rol del usuario (vigente desde esta entrega)

El rol jugable actual es un **manager deportivo completo**: táctica,
plantilla, fichajes, cesiones, traspasos, contratos y renovaciones dentro
de los recursos que asigna la junta. El manager **no es** todavía el
presidente/propietario. Un modo futuro permitirá al mismo usuario controlar
también las decisiones de junta/propiedad — ambos modos compartirán la
MISMA economía, calendario, persistencia y reglas; solo cambia quién tiene
autoridad de decisión. Esta entrega mantiene ya esa costura: la asignación
de apertura es una decisión "de la junta" registrada por el sistema
(`decisionAuthority: 'board-system-seed'`), nunca atribuida al manager — el
día que exista una política de autoridad real, esa costura no necesita
tocar el cálculo del presupuesto, solo quién puede invocar
`SquadBudgetService.recordRevision()`.

## Entidad y registro canónico

- `src/entities/SquadBudget.js` — `SquadBudgetAllocation`: registro
  INMUTABLE de una revisión (`id`, `clubId`, `seasonKey`, `currency`,
  `amountMinor`, `effectiveDate` civil ISO, `revisionKind`
  (`opening-allocation`/`season-opening-cycle-policy`/`board-revision`/
  `migration-backfill`), `decisionAuthority`
  (`board-system-seed`/`board-manual`/`migration`), `predecessorId`
  (encadena con la revisión anterior de la MISMA cadena), `provenance`
  (`dataSource`, `policyVersion`, `basisAmountMinor`, `multiplier`,
  `calculatedAtGameDate`, `note`). Nunca se edita un campo de una
  asignación ya registrada — una revisión nueva siempre es una instancia
  nueva con su propio id.
- `src/core/SquadBudgetRegistry.js` — fuente CANÓNICA, instancia EXPLÍCITA
  por carrera (`state.squadBudgetRegistry`, nunca un singleton). Cadena por
  `clubId|seasonKey|currency` en orden de creación real;
  `effectiveAllocationFor(clubId, seasonKey, currency, atGameDate)`
  devuelve la última revisión con `effectiveDate <= atGameDate` (o la más
  reciente sin fecha) — a lo sumo UN límite efectivo por club+temporada+
  moneda en cualquier punto de revisión. `exportState()`/`restoreState()`
  son el contrato de persistencia COMPLETO (mismo patrón que
  `MarketRegistry`/`LoanRegistry`), nunca un resumen diagnóstico —
  `snapshot()`/`describe()` siguen siendo esos resúmenes aparte.

## Servicio de dominio — `src/core/SquadBudgetService.js`

### Fórmulas de compatibilidad (congeladas, no recalculadas en directo)

- `computeMarketCompatibilityAmount({team, contractRegistry, seasonKey})`:
  copia EXACTA de la fórmula que usaba `MarketService.
  computeInternalBudgetLimit()` antes de esta entrega (multiplicador
  `[1.15, 2.0]` sobre `max(nómina garantizada comprometida, suelo
  20.000.000 céntimos)`, según `team.reputation.financial`). Se usa para
  la apertura de carrera (`bootstrapSquadBudgetForNewCareer()` en
  `game.js`) y para la migración de guardados `v1`.
- `computeCycleCompatibilityAmount({team, openingPayrollReferenceMinor,
  currency})`: reutiliza `CycleConfig.BUDGET` DIRECTAMENTE (multiplicador
  `[1.10, 1.95]`, mismo suelo) — la misma fórmula que ya usaba
  `CpuRosterPlanner.computeCycleBudget()`. Se usa para congelar la
  apertura de la temporada que se ABRE, a partir de la referencia de
  nómina ya congelada por `AnnualCycleService.freezeSnapshot()` ANTES de
  que expire ningún contrato.
- Ninguna de las dos fórmulas se promedia, ni se inventa un multiplicador
  nuevo — son la MISMA aritmética que ya jugaba el proyecto, solo que
  ahora se **congela** en un registro durable en vez de recalcularse en
  cada consulta.

### Apertura/revisión — `ensureOpeningAllocation()` / `recordRevision()`

- `ensureOpeningAllocation()` es IDEMPOTENTE por `clubId+seasonKey+
  currency`: si la cadena ya existe, devuelve la asignación efectiva sin
  crear nada (`created: false`) — repetir bootstrap, sincronización de
  calendario, render o cierre de temporada nunca duplica ni recalcula.
- `recordRevision()` es el mecanismo de una revisión EXPLÍCITA y auditable
  (encadena `predecessorId`). **ECONOMY-BOARD-1 le añade dos flujos
  jugables/de sistema reales**: `BoardBudgetRequestService.resolveRequest()`
  lo invoca (`revisionKind: 'board-revision'`, `decisionAuthority:
  'board-system'`) al aprobar total o parcialmente una petición de
  ampliación, y `ClubFinanceService.resolveSalaryAnchor()` lo invoca
  (`revisionKind: 'forward-board-allocation'`, `decisionAuthority:
  'board-system'`) para trasladar sin crecimiento el límite de una
  temporada futura del horizonte de planificación financiera que todavía
  no tiene asignación propia — ver
  `docs/architecture/board-budget-requests.md` y
  `docs/architecture/club-finance.md`. Sigue disponible también como
  mecanismo de prueba/depuración manual.

### Lectura pura — `deriveBudgetView()`

Nunca almacena ningún total — siempre deriva de `ContractRegistry`
(`guaranteedPayrollForClub`/`potentialVariableCompensationForClub`/
`benefitsValueForClub`/`agentCostsForClub`), `MarketRegistry.
reservedTotalForClubSeason()`, `LoanRegistry` (vía `LoanCostService.
salaryAllocationForSeason()`, NUNCA una segunda aritmética de reparto) y la
asignación efectiva de `SquadBudgetRegistry`:

```
limitMinor         = asignación efectiva (0 si no hay ninguna)
committedMinor     = nómina garantizada comprometida, AJUSTADA por cesiones:
                     - se resta la parte que retiene el CESIONARIO de cada
                       jugador cedido FUERA (el contrato matriz sigue
                       contando entero por `clubId`, pero el propietario
                       solo retiene su parte real);
                     + se suma la parte que asume este club por cada
                       jugador cedido DENTRO (el contrato es del
                       propietario, así que sin este ajuste el cesionario
                       no cargaría nada).
reservedMinor      = MarketRegistry.reservedTotalForClubSeason()
availableMinor     = max(0, limit - committed - reserved)
overcommittedMinor = max(0, committed + reserved - limit)   ← SIEMPRE visible,
                     nunca oculto detrás de `available = 0`
```

Además: `variableMaxMinor`/`benefitsValueMinor`/`agentCostsMinor` (nunca
consumen el límite duro, solo se muestran), `playerRows[]` (desglose por
jugador con `loanBadge: 'loaned-out'|'loaned-in'|null` y
`chargedToThisClubMinor`), y `warnings[]` (siempre incluye el aviso de que
esto es presupuesto salarial deportivo, no caja/beneficio).

### Validación atómica — `validateAdditionsAgainstBudget()`

Recibe `{ [seasonKey]: attemptedAdditionMinor }` y devuelve `{ok,
shortfalls[], viewsBySeasonKey, message}`. **Nunca corta en la primera
temporada que falla** — recorre todas y acumula el detalle estructurado de
cada una que excede su disponible (`seasonKey`, `currency`, `limitMinor`,
`committedMinor`, `reservedMinor`, `attemptedAdditionMinor`,
`shortfallMinor`). `MarketService.validateOfferBeforeSend()` usa el MISMO
patrón por temporada (`shortfalls[]` en su resultado) para una oferta de
mercado real — nunca dos implementaciones de la misma regla.

## Integración con consumidores productivos

- **Mercado** (`src/core/MarketService.js`): `computeSquadCostPlan()`
  acepta `squadBudgetRegistry`/`atGameDate` opcionales — si hay una
  asignación efectiva para `team.clubId+seasonKey`, GANA sobre
  `limitOverrideMinor` y sobre `computeInternalBudgetLimit()` (que sigue
  existiendo, sin cambios, como fallback de compatibilidad para
  llamadores que no aporten el registro). `game.js` ya pasa
  `state.squadBudgetRegistry` en el flujo real de construir/enviar una
  oferta. `validateOfferBeforeSend()` devuelve `shortfalls[]` estructurado
  además del string de error legado (compatibilidad de lectura).
- **Ciclo anual / planificación CPU**: `AnnualCycleService.
  freezeSnapshot()` congela, una vez, la asignación de la temporada que se
  ABRE (`ensureOpeningAllocation()` con `computeCycleCompatibilityAmount()`
  sobre la referencia de nómina recién congelada) cuando recibe
  `squadBudgetRegistry` en sus parámetros — `game.js`
  (`buildCycleParams()`) ya lo aporta en producción. `CpuRosterPlanner.
  buildSnapshot()` añade `canonicalBudgetLimitMinor` a cada fila de club
  cuando se le pasa el registro; `computeCycleBudget()` usa ese valor
  DIRECTAMENTE si existe, y solo cae a la fórmula de compatibilidad en
  directo cuando no hay registro (scripts/tests históricos). La decisión
  de ejercer una opción contractual de CPU en
  `reviewLoansAndOptions()` también resuelve su disponibilidad desde el
  mismo registro cuando existe, en vez de una tercera fórmula ad-hoc
  independiente.
- **Cesiones**: nunca se duplica la aritmética de `LoanCostService` — el
  servicio de presupuesto solo LEE `salaryAllocationForSeason()` para
  ajustar `committedMinor` en ambos lados de una cesión activa/acordada.

## Persistencia (`schemaVersion` 1 → 2; ECONOMY-BOARD-1 la eleva de nuevo a 3
sin tocar el contrato de esta colección — ver `docs/architecture/club-finance.md`)

- `CareerPersistenceBoundary.inventory()` declara `squadBudget` como
  colección DURABLE (`dependsOn: ['contracts', 'worldRegistries']`,
  proyectada vía `exportState()` como el resto de registros de dominio).
- `CareerHydrationService`: `SUPPORTED_SCHEMA_VERSION` es ahora `3`
  (ECONOMY-BOARD-1), `MIGRATABLE_SCHEMA_VERSIONS = [1, 2]`. Un guardado `v2`
  o `v3` restaura esta colección sin pérdida exactamente igual; un
  guardado `v1` (sin la colección) se migra reconstruyendo, para cada
  `Team` del mundo ya restaurado, una asignación de apertura de
  compatibilidad con `computeMarketCompatibilityAmount()`
  colección sin pérdida; un guardado `v1` (sin la colección) se migra
  reconstruyendo, para cada `Team` del mundo ya restaurado, una asignación
  de apertura de compatibilidad con `computeMarketCompatibilityAmount()`
  sobre los contratos y la fecha de calendario YA restaurados —
  `revisionKind: 'migration-backfill'`, `decisionAuthority: 'migration'`.
  El fingerprint/formato/content packs del guardado se validan ANTES de
  esto (`verifyEnvelopeIntegrity()`), igual que cualquier otra
  reconstrucción. Guardar de nuevo tras cargar un `v1` ya escribe
  `schemaVersion: 2` con la colección poblada — una carga posterior de ese
  mismo guardado ya no vuelve a migrar (`ensureOpeningAllocation()` es
  idempotente).
- `game.js`: `SAVE_SCHEMA_VERSION = 2`.

## Pantalla Finanzas (`src/ui/FinanceScreen.js`)

Solo lectura, módulo separado de `game.js` (que solo resuelve
dependencias/navegación — ver `renderFinanceScreen()` ahí). Muestra:
tarjetas de asignado/comprometido/reservado/disponible/% usado con el
excedido siempre visible; exposición de riesgo (variable máx./beneficios/
costes de agente) separada; tabla de otras temporadas con asignación,
compromiso o reserva; contribución por jugador con badges de cesión;
historial de asignaciones/revisiones; aviso de procedencia cuando la
asignación vigente es una estimación de compatibilidad; y nota explícita
de que esto es presupuesto salarial deportivo, no caja ni beneficio.
**ECONOMY-BOARD-1 extiende esta misma pantalla** con resumen económico
real/tesorería/presupuesto planificado/proyección a 3 temporadas y la
pestaña jugable "Solicitar ampliación" — ver
`docs/architecture/club-finance.md`/`docs/architecture/
board-budget-requests.md`; el botón de petición ya es funcional, no un
recordatorio de que llegará después.

## Qué NO cubre esta Epic (histórico — ver ECONOMY-BOARD-1 para lo entregado después)

Caja/ingresos/gastos reales del club, pagos/impagos/deuda, confianza de
junta dinámica, mandato/antigüedad del manager, peticiones jugables de
ampliación de presupuesto — **las cinco quedaron entregadas por
ECONOMY-BOARD-1** (`docs/architecture/club-finance.md`,
`docs/architecture/board-budget-requests.md`). Siguen sin implementar:
modo presidente/propietario jugable, presupuesto de operaciones/
traspasos separado del salarial, e investigación de datos financieros
reales. Ver `docs/epics/SQUAD-BUDGET-1.md`, sección "Deuda aplazada", para
el histórico completo del follow-up original.
