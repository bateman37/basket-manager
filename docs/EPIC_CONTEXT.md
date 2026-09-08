# EPIC_CONTEXT — Ficha de continuación

Ficha de continuación, no un diario. Dice qué Epic está activa (si la hay),
su alcance autorizado y el punto exacto donde retomar. Para el histórico
completo de una Epic ya cerrada, ve a `docs/epics/<ID>.md`.

## Epic activa

**`DOCS-CONTEXT-1`** — reorganización documental del repositorio
(`CLAUDE.md`/`DESIGN.md`/`CHANGELOG.md` monolíticos → `docs/`), sin tocar
código productivo.

- **Estado**: completada en esta sesión (rama `docs/docs-context-1`, PR
  abierta sin fusionar — Dennis fusiona manualmente).
- **Ficha completa**: `docs/epics/DOCS-CONTEXT-1.md`.
- **Documentos imprescindibles para revisar el resultado**: este archivo,
  `docs/STATUS.md`, `docs/reference/LEGACY_MAP.md`, `docs/epics/README.md`.
- **Archivos autorizados en esta Epic**: `CLAUDE.md`, `DESIGN.md`,
  `CHANGELOG.md`, `README.md`, todo bajo `docs/`, y opcionalmente
  `scripts/check-docs-context.js`.
- **Exclusiones**: `src/`, `data/`, `index.html`, estilos, dependencias,
  configuración de ejecución, pruebas del juego — ninguno se tocó.
- **Decisiones pendientes**: ninguna decisión de producto quedó abierta
  por esta Epic — es reorganización documental, no diseño nuevo. Las
  contradicciones detectadas se documentaron (`docs/STATUS.md`) sin
  corregir el código subyacente, tal como pedía el encargo.
- **Pruebas mínimas realizadas**: exclusivamente documentales — enlaces
  internos, anclas, cobertura del mapa de migración, `git diff --check`,
  lectura manual de los bloques migrados para confirmar que el significado
  se conserva. **No se ejecutó ningún test/smoke/Playwright del juego.**
- **Punto de continuación**: ninguno — la Epic terminó su alcance
  documental completo en esta sesión.

## Siguiente Epic

**No hay ninguna Epic activa confirmada tras `DOCS-CONTEXT-1`.** No la
selecciones ni la arranques automáticamente. Cuando Dennis decida la
siguiente funcionalidad, esta ficha se actualiza con su identificador,
objetivo y alcance autorizado antes de tocar ningún archivo — usa
`docs/epics/README.md` (plantilla) para crear su ficha inicial y
`docs/ROADMAP.md` para ver las opciones ya documentadas como pendientes de
decisión (persistencia real, contenido europeo, transfer internacional,
ampliaciones tácticas, deuda de scripts...).
