# EPIC_CONTEXT — Ficha de continuación

Ficha de continuación, no un diario. Dice qué Epic está activa (si la hay),
su alcance autorizado y el punto exacto donde retomar. Para el histórico
completo de una Epic ya cerrada, ve a `docs/epics/<ID>.md`.

## Epic activa

**Ninguna.** `SIM-CAL-1` (avance cooperativo y cancelable de "Continuar")
quedó completada en esta sesión — ver `docs/epics/SIM-CAL-1.md` para el
resultado completo, las pruebas ejecutadas y los follow-ups aceptados.
Rama `claude/modest-gauss-ab8bat` (reiniciada desde `main`, ya que el PR
anterior de esta misma rama —`SAVE-LOAD-1`, PR #59— se fusionó antes de
empezar esta sesión), PR abierta sin fusionar — Dennis fusiona
manualmente.

No selecciones ni arranques automáticamente la siguiente Epic. Cuando
Dennis decida la siguiente funcionalidad, esta ficha se actualiza con su
identificador, objetivo y alcance autorizado antes de tocar ningún
archivo — usa `docs/epics/README.md` (plantilla) para crear su ficha
inicial y `docs/ROADMAP.md` para ver las opciones ya documentadas como
pendientes de decisión.

## Punto de continuación de SIM-CAL-1 (si una sesión futura retoma algo)

- **Pendiente de Dennis**: checklist manual completo en navegador real —
  `docs/manual/SIM_CAL_ACCEPTANCE.md`. Ninguna sesión de Claude Code la
  ha ejecutado (fuera de alcance: sin Playwright en esta Epic).
- **Follow-ups no bloqueantes** (ver `docs/epics/SIM-CAL-1.md`, sección
  "Deuda aplazada"): controles de avanzar 1/3/7 días, modo vacaciones,
  resolución automática de conflictos de calendario y fecha objetivo
  arbitraria quedaron explícitamente fuera de alcance — candidatos a Epic
  futura si Dennis los prioriza. `scripts/verify-cycle1-playwright.js`
  sigue sin migrar (ya estaba fuera de la ruta productiva antes de esta
  Epic).

## Punto de continuación de SAVE-LOAD-1 (histórico, ya fusionado)

- **Pendiente de Dennis**: checklist manual completo en navegador real —
  `docs/manual/SAVE_LOAD_ACCEPTANCE.md`. Ninguna sesión de Claude Code la
  ha ejecutado (fuera de alcance: sin Playwright en esa Epic).
- **Follow-ups no bloqueantes** (ver `docs/epics/SAVE-LOAD-1.md`, sección
  Resultado): cobertura de prueba de `transfers`/`loans`/`annualCycle`/
  `academy`/`nationalTeams` en el round-trip de guardado (hoy solo
  verificado por analogía de patrón, no con datos reales de esos
  dominios); contador de lesiones de `Medical.js` sin seedear
  explícitamente.

## Anterior Epic (histórico)

`SAVE-LOAD-1` (persistencia real de partidas) quedó completada y ya
fusionada en `main` (PR #59) antes de que empezara `SIM-CAL-1`. Ver
`docs/epics/SAVE-LOAD-1.md`. `DOCS-CONTEXT-1` (reorganización documental)
la precedió, también ya fusionada (PR #58). Ver
`docs/epics/DOCS-CONTEXT-1.md`.
