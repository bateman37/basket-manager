# Ficha de Epic — SQUAD-BUDGET-1 (presupuesto salarial de plantilla)

- **Identificador**: `SQUAD-BUDGET-1`
- **Estado**: cerrada
- **Objetivo**: crear un presupuesto salarial de plantilla canónico y
  durable por club+temporada, migrar los límites provisionales existentes
  de mercado/ciclo anual a ese contrato, hacerlo cumplir de forma
  consistente para usuario y CPU, y exponerlo en una pantalla Finanzas
  independiente, de solo lectura.
- **Alcance y exclusiones**: incluye el registro/entidad/servicio del
  presupuesto salarial, la migración de `MarketService.
  computeInternalBudgetLimit()`/`CpuRosterPlanner.computeCycleBudget()` a
  consumir la asignación canónica, validación atómica multi-temporada con
  detalle estructurado de déficit, reparto de coste de cesiones vía
  `LoanCostService` (sin duplicar su aritmética), persistencia (nueva
  colección durable + migración v1→v2) y la pantalla Finanzas. Excluye
  explícitamente: caja/ingresos/gastos reales del club, pagos/impagos,
  deuda, confianza de junta, mandato/antigüedad del manager, peticiones
  jugables de ampliación de presupuesto, modo presidente/propietario
  jugable, presupuesto de operaciones/traspasos, e investigación de datos
  financieros reales — ver "Deuda aplazada" para la lista completa.
- **Archivos permitidos**: `src/entities/SquadBudget.js` (nuevo),
  `src/core/SquadBudgetRegistry.js` (nuevo), `src/core/
  SquadBudgetService.js` (nuevo), `src/ui/FinanceScreen.js` (nuevo),
  `src/ui/finance.css` (nuevo), secciones acotadas de `src/core/
  MarketService.js` (canonicalización del límite + shortfalls
  estructurados), `src/core/CpuRosterPlanner.js` (límite canónico en el
  snapshot), `src/core/AnnualCycleService.js` (congelación de apertura en
  `freezeSnapshot()` + lectura canónica en la decisión de opción de
  `reviewLoansAndOptions()`), `src/core/CareerPersistenceBoundary.js`
  (colección `squadBudget`), `src/core/CareerHydrationService.js`
  (restauración + migración v1→v2), secciones acotadas de `src/ui/game.js`
  (bootstrap, navegación, wiring de dependencias — nunca lógica de
  dominio), `index.html` (scripts/estilo/nav nuevos),
  `scripts/test-squad-budget1.js` (nuevo), y la documentación listada
  abajo.
- **Dependencias**: `CONTRACT-1` (`ContractService.
  guaranteedPayrollForClub()`/`potentialVariableCompensationForClub()`/
  `benefitsValueForClub()`/`agentCostsForClub()`), `MARKET-1`
  (`MarketRegistry.reservedTotalForClubSeason()`, reservas/AIP), `LOAN-1`
  (`LoanCostService.salaryAllocationForSeason()`), `CYCLE-1`
  (`AnnualCycleService.freezeSnapshot()`/referencia de nómina de apertura
  congelada), `CLUB-CORE-1` (`clubId` como identidad institucional),
  `SAVE-LOAD-1`/`WORLD-HARDEN-1` (contrato de persistencia/inventario).
- **Decisiones cerradas**:
  - El límite salarial se asigna por `clubId+seasonKey+currency`, queda
    CONGELADO para esa temporada y solo cambia mediante una revisión
    explícita y auditable (`SquadBudgetService.recordRevision()`) — nunca
    se recalcula al cambiar el payroll/roster.
  - La asignación de apertura reutiliza EXACTAMENTE las fórmulas de
    compatibilidad ya existentes (`computeMarketCompatibilityAmount` copia
    `MarketService.computeInternalBudgetLimit()`;
    `computeCycleCompatibilityAmount` reutiliza `CycleConfig.BUDGET`
    directamente) — nunca un multiplicador nuevo ni un promedio de ambas.
  - El límite duro incluye SOLO salario garantizado (ajustado por reparto
    de cesiones); el máximo variable, los beneficios y los costes de
    agente se muestran aparte y nunca bloquean por sí solos.
  - Una oferta multi-temporada se valida temporada a temporada y falla
    ATÓMICAMENTE si cualquiera excede su límite — el fallo estructurado
    (`shortfalls[]`) incluye temporada, límite, comprometido, reservado,
    intento y déficit.
  - `squadBudgetRegistry` es OPCIONAL en `MarketService`/`CpuRosterPlanner`
    — sin él, el comportamiento es idéntico al de antes de esta entrega
    (compatibilidad con scripts/tests históricos que no lo pasan).
  - Persistencia: nueva colección durable `squadBudget`
    (`schemaVersion: 2`); un guardado `schemaVersion: 1` se migra
    reconstruyendo la apertura de compatibilidad desde los contratos y la
    fecha de calendario ya restaurados, marcada `revisionKind:
    'migration-backfill'`/`decisionAuthority: 'migration'` — nunca falla
    ni deja un guardado antiguo inservible.
  - No se implementa ningún flujo jugable de petición de ampliación de
    presupuesto — la pantalla Finanzas lo declara explícitamente como
    pendiente, sin botón simulado.
- **Preguntas abiertas**: ninguna para esta entrega — ver "Deuda
  aplazada" para las decisiones de diseño de la Epic siguiente.
- **Documentos canónicos**: `docs/architecture/squad-budget.md` (contrato
  técnico completo), `docs/design/economy-and-modes.md` (rol
  manager-primero), `docs/design/club-team.md` §6.2.4/§6.2.6 (Junta/
  Finanzas — puntero a la implementación real).
- **Pruebas mínimas**: `node scripts/test-squad-budget1.js`,
  `node scripts/test-market1.js`, `node scripts/test-cycle1.js`,
  `node scripts/test-save-load1.js`, `node --check` de cada archivo
  modificado, `node scripts/check-docs-context.js`, `git diff --check`.
- **Criterios de aceptación**: todo club activo tiene una asignación
  durable por temporada; mercado y ciclo anual/planificación CPU consumen
  el MISMO contrato canónico; una oferta que necesita más presupuesto se
  bloquea atómicamente con mensaje claro de permiso de junta; garantizado/
  reservado/contingente se distinguen correctamente; el reparto salarial
  de cesión no duplica coste; Finanzas es una pantalla independiente,
  veraz y de solo lectura; guardado/carga y la migración de guardados
  existentes preservan el nuevo estado; no se ha introducido caja/ingreso
  de club inventados; el rol manager-primero y el futuro modo combinado
  están documentados correctamente; las peticiones de presupuesto a la
  junta quedan registradas como la entrega siguiente requerida, nunca
  insinuadas como ya existentes.

## Resultado (al cerrar)

- **Qué se implementó**:
  1. Dominio: `SquadBudgetAllocation` (entidad inmutable de revisión),
     `SquadBudgetRegistry` (cadena por club+temporada+moneda,
     `exportState()`/`restoreState()`/`validateIntegrity()`),
     `SquadBudgetService` (fórmulas de compatibilidad, apertura/revisión
     idempotentes, `deriveBudgetView()` de solo lectura,
     `validateAdditionsAgainstBudget()` atómico).
  2. Consumidores migrados: `MarketService.computeSquadCostPlan()`
     resuelve el límite CANÓNICO cuando se le pasa `squadBudgetRegistry`
     (game.js ya lo hace en el flujo real de oferta);
     `CpuRosterPlanner.buildSnapshot()`/`computeCycleBudget()` leen
     `canonicalBudgetLimitMinor` del snapshot en vez de recalcular;
     `AnnualCycleService.freezeSnapshot()` congela la asignación de
     apertura de la temporada que se abre exactamente una vez, y
     `reviewLoansAndOptions()` usa esa misma asignación para decidir
     opciones contractuales de CPU en vez de una tercera fórmula ad-hoc.
  3. UI: pantalla **Finanzas** (`src/ui/FinanceScreen.js` + `finance.css`),
     navegación nueva en `index.html`/`game.js` — solo lectura, con
     tarjetas de asignado/comprometido/reservado/disponible/% usado,
     excedido visible, exposición de riesgo separada, tabla de otras
     temporadas, contribución por jugador con badges de cesión, historial
     de revisiones y aviso de procedencia cuando la asignación es una
     estimación de compatibilidad.
  4. Persistencia: colección durable `squadBudget` en
     `CareerPersistenceBoundary`, restauración/migración en
     `CareerHydrationService` (`schemaVersion` 1→2), `game.js` escribe
     ahora `schemaVersion: 2`.
- **Pruebas realmente ejecutadas**: `node scripts/test-squad-budget1.js`
  (16/16 OK, cubre los 12 puntos exigidos); `node scripts/test-market1.js`
  (68 OK / 14 FAIL — MISMOS 14 fallos que en `origin/main` antes de esta
  entrega, confirmado con `git stash` sobre `MarketService.js`; deuda
  preexistente no tocada por esta Epic); `node scripts/test-cycle1.js`
  (25 OK / 17 FAIL — mismo criterio, confirmado sin regresión con `git
  stash` sobre `CpuRosterPlanner.js`); `node scripts/test-save-load1.js`
  (12/12 OK, incluida la actualización del test 9 —
  "schemaVersion futura" pasa de `2` a `3` porque `2` ya es una versión
  soportada real); `node --check` de los 13 archivos tocados/nuevos;
  `node scripts/check-docs-context.js` (0 referencias rotas);
  `git diff --check` (limpio). No se ejecutó ningún checklist manual en
  navegador — pendiente de Dennis (ver `docs/manual/
  SQUAD_BUDGET_ACCEPTANCE.md`).
- **Deuda aplazada** (documentada explícitamente, nunca insinuada como ya
  resuelta):
  1. Peticiones jugables de ampliación de presupuesto (manager pide más a
     la junta).
  2. Mandato/antigüedad real del manager como señal de aprobación.
  3. Confianza de junta dinámica y comparación rendimiento-vs-expectativa.
  4. Cálculo de margen financiero real desde la economía completa del
     club (caja/ingresos/gastos reales).
  5. Aprobación parcial, cooldowns y personalidad de junta.
  6. Caja, ingresos, pagos, deuda, impagos y planes de viabilidad.
  7. Modo combinado manager+propiedad jugable.
  8. Presupuesto de operaciones/traspasos separado del salarial.
  9. Sustitución de las estimaciones de compatibilidad por datos
     financieros reales investigados/curados.
  10. Checklist manual en navegador real (`docs/manual/
      SQUAD_BUDGET_ACCEPTANCE.md`), pendiente de ejecución por Dennis.
  11. El clearinghouse de `MarketClearinghouse.js`/`CpuRosterPlanner`
      sigue usando su propio `computeCycleBudget()` con la fórmula de
      compatibilidad como *fallback* cuando no hay `squadBudgetRegistry`
      — el consumidor productivo real (`AnnualCycleService`, que SÍ pasa
      el registro) ya usa el límite canónico; un script/harness histórico
      que no lo pase conserva el comportamiento previo sin cambios, por
      diseño (compatibilidad, no una migración parcial olvidada).
