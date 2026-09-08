# ROADMAP — pendientes, propuestas y deuda

Consolida los pendientes ya documentados en las fuentes originales. No es
una planificación estratégica nueva de `DOCS-CONTEXT-1` — mantiene las
prioridades ya confirmadas y marca el resto como pendiente de decisión de
Dennis. Cada punto enlaza a su documento de origen.

## Decisiones aprobadas, pendientes de implementar

- **Cálculo de `board.sportingGoal`** ya tiene fórmula cerrada
  (`docs/design/club-team.md`/`docs/design/competitions-spain.md`,
  DESIGN §3.4.3) e implementación — `financialGoal`/`multiYearPlan` de la
  Junta siguen SIN fórmula de cálculo, pendiente de sesión de diseño.
- **Roles tácticos, Pick&Roll, tiempos muertos y falta táctica**: diseño
  cerrado en `docs/design/tactics/`, implementación repartida en TAC-1 a
  TAC-7 (`docs/epics/TACTICS-EPIC.md`) — los "nuevos pendientes" señalados
  al cierre de cada TAC-N siguen abiertos (ver
  `docs/design/tactics/roadmap.md`, sección "Pendientes deliberados").

## Propuestas por estudiar (sin decisión de Dennis todavía)

- ~~**Avance cooperativo y cancelable de "Continuar"**~~ — entregado en
  `SIM-CAL-1` (`docs/architecture/simulation-advance.md`). Quedan fuera de
  alcance, señalados explícitamente y pendientes de decisión: controles de
  avanzar 1/3/7 días, modo vacaciones, autogestión de partidos del
  usuario, fecha objetivo arbitraria, y resolución/reprogramación
  automática de conflictos de calendario (hoy solo se detectan y
  bloquean, `docs/architecture/world-calendar.md`).
- ~~**Persistencia real de partidas**~~ — entregada en `SAVE-LOAD-1`
  (IndexedDB, 3 ranuras manuales + autoguardado). Ver
  `docs/architecture/persistence-boundary.md` y
  `docs/epics/SAVE-LOAD-1.md`. Pendiente solo el checklist manual en
  navegador real (`docs/manual/SAVE_LOAD_ACCEPTANCE.md`) y ampliar la
  cobertura de prueba de `transfers`/`loans`/`annualCycle`/`academy`/
  `nationalTeams` en el round-trip con datos reales de esos dominios (hoy
  verificado solo por analogía de patrón).
- **Contenido europeo real** (`EUROPE-CONTENT-1`): competición europea
  como paquete de contenido sobre el motor genérico — hoy los clubes
  "grandes" están fijados a su competición europea sin lógica de
  clasificación dinámica (`docs/design/club-team.md`,
  `docs/design/economy-and-modes.md`). Supercopa (formato y criterio de
  clasificación) también pendiente.
- **Transfer internacional / Letter of Clearance real** (retomado como
  entrega futura de World Architecture, tras NATIONAL-TEAMS-1/
  COMP-CORE-1, ver `docs/architecture/world-model.md` §10.9 "Plan
  superado"): hoy bloquea explícito, nunca concede completado
  (`docs/design/transfers.md`, `docs/design/loans.md`).
- **Copa de 2ª división**: solo se decidió su efecto colateral sobre el
  playoff de ascenso (`docs/design/competitions-spain.md`); su propio
  formato (participantes, calendario, rondas) no está diseñado.
- **Categorías inferiores reales / club filial en 2ª división**: ambición
  declarada del proyecto, pendiente de sesión de diseño dedicada
  (`docs/design/club-team.md`, §6.2.3).
- **Cuerpo técnico como entidad propia** (ayudantes, preparador físico,
  coste salarial): pendiente, hoy el usuario ES el entrenador/presidente
  (`docs/design/club-team.md`, §6.2.7).
- **Departamento de Análisis/Dirección Deportiva**: efecto numérico sobre
  fichajes/tácticas sin definir todavía (`docs/design/club-team.md`,
  §6.2.2).
- **Evolución de `reputation`/`facilities` entre temporadas**: hoy
  persisten sin decaimiento/crecimiento automático por resultados
  (`docs/design/competitions-spain.md`, "Pendiente cierre de ciclo").
- **Cambio de arquitectura de persistencia (SQL/backend/microservicios)**:
  explícitamente NO aprobado ni implantado en ninguna entrega hasta hoy —
  candidato a estudio, sujeto a decisión de Dennis
  (`docs/architecture/world-model.md`, §10.9/10.10).
- Calibración numérica final de las 21 piezas del catálogo de acciones
  (§7.6), penalización de polivalencia posicional, `CONFIG_MODIFIERS_NBA`,
  y mecánica completa de tipos de Entrenamiento más allá del efecto en
  Energía — todos con estructura fijada, faltan números finales tras
  simulación masiva (`docs/design/tactics/roadmap.md`, `docs/design/
  match-simulation.md`).

## Deuda técnica

- **`FORMATION_QUOTA_INFEASIBLE` flaky**: sin reproducir con presupuesto
  disponible en REPO-HARDEN-1; diagnóstico acotado (hipótesis: callup CPU
  multi-temporada sin `careerSeed` explícito heredado), no confirmado.
  Ver `docs/epics/REPO-HARDEN-1.md`, `docs/STATUS.md`.
- **`scripts/verify-cycle1-playwright.js`**: `fastForwardSeasonToClose()`
  sigue usando APIs retiradas (`state.division`, `getLeague`/`getBrackets`
  por división, `simulateNextRound`/`simulateBackgroundRound`/
  `drainBackgroundBrackets`) — confirmado sin migrar (2026-09-08). Ver
  `docs/STATUS.md`.
- **Migración de `src/core/Calendar.js`**: ~20 scripts históricos siguen
  usando `require()` directo sobre el archivo; su retirada física está
  condicionada a migrar esos scripts primero — campaña explícitamente
  fuera de alcance de REPO-HARDEN-1/WORLD-CLEANUP-1. Ver
  `docs/architecture/world-calendar.md`, `docs/epics/WORLD-CLEANUP-1.md`.
- **Nombres ambiguos residuales de "clubId" usado como `teamId`** en
  entidades de diagnóstico/histórico (`docs/architecture/
  competitive-context-identity.md`, §10.20.5) — documentado, no corregido.
- **Checklist manual de World Architecture** (`docs/manual/
  WORLD_ARCHITECTURE_ACCEPTANCE.md`): pendiente de ejecución humana real
  en navegador — ninguna sesión de Claude Code la ha corrido.

## Planes sustituidos o cancelados (no reactivar sin decisión explícita)

- **Orden `EUROPE-1`/`HARDEN-1`** como entregas inmediatas tras CYCLE-1:
  **sustituido** por la EPIC "World Architecture" — ver `docs/architecture/
  world-model.md` §10.9 "Plan superado". El transfer internacional y la
  persistencia vuelven como entregas futuras de World Architecture, no
  con ese orden/nombre original.
- **Pipeline de reconstrucción rigurosa de posiciones secundarias reales
  con fuentes externas** (ACB/FEB/scouting): descartado por decisión de
  producto (mini-EPIC POS) — se deriva por similitud de atributos, no es
  un objetivo del proyecto.
