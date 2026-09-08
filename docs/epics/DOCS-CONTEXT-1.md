# Ficha de Epic — DOCS-CONTEXT-1 (reorganización documental)

- **Identificador**: `DOCS-CONTEXT-1`
- **Estado**: cerrada
- **Objetivo**: reorganizar `CLAUDE.md`/`DESIGN.md`/`CHANGELOG.md` (crecidos
  a monolitos de ~1655/10696/7907 líneas) en un sistema documental
  navegable bajo `docs/`, sin perder conocimiento sustantivo (reglas,
  fórmulas, decisiones, excepciones, histórico, pendientes) y reduciendo
  el contexto necesario para empezar a trabajar.
- **Alcance y exclusiones**: solo documentación y, opcionalmente, un
  verificador Node pequeño. Sin cambios de código productivo, datos,
  configuración ni pruebas del juego.
- **Archivos permitidos**: `CLAUDE.md`, `DESIGN.md`, `CHANGELOG.md`,
  `README.md`, todo bajo `docs/`, y opcionalmente
  `scripts/check-docs-context.js`.
- **Dependencias**: base `origin/main` en `83b85d1` (PR #57,
  `REPO-HARDEN-1`, fusionada) — verificado contra el estado real de Git y
  de la API de GitHub antes de empezar, no asumido del enunciado.
- **Decisiones cerradas**:
  - Estructura final: `CLAUDE.md`/`DESIGN.md` como entradas breves,
    `docs/STATUS.md`/`EPIC_CONTEXT.md`/`ROADMAP.md`/`CODE_MAP.md` como
    índices de estado, `docs/design/` por funcionalidad, `docs/architecture/`
    por contrato transversal, `docs/epics/` como historial por Epic,
    `docs/history/` para sesiones sin Epic identificable, `docs/reference/
    LEGACY_MAP.md` como mapa de referencias antiguas, `docs/code/` como
    guías de navegación de los tres archivos grandes no divididos
    (`src/ui/game.js`, `src/core/Tactics.js`, `src/core/CompetitionRules.js`).
  - Migración por extracción literal de bloques (por rango de línea,
    delimitado por los encabezados originales) hacia el documento
    temático que le corresponde, seguida de framing breve (título, nota
    de procedencia, enlaces) — nunca resumen que pierda contenido.
  - Reglas de la misma área repartidas entre `DESIGN.md` (contenido de
    diseño) y `CLAUDE.md` (convenciones de ingeniería/UI) se fusionaron en
    el MISMO documento temático cuando describían la misma funcionalidad
    desde dos ángulos (p. ej. `docs/design/contracts.md` reúne el diseño
    de CONTRACT-1 y las convenciones permanentes de `CLAUDE.md` sobre
    contratos).
  - Las secciones "resultado"/"bugs corregidos"/"pruebas"/"archivos" de
    cada entrega de World Architecture (`DESIGN.md` 10.12-10.21) se
    trataron como historial de Epic (→ `docs/epics/`), mientras que las
    convenciones permanentes en forma de regla de `CLAUDE.md` para esa
    misma entrega se trataron como contrato vigente (→
    `docs/architecture/`) — evita duplicar la misma norma en dos sitios.
  - Las ocho contradicciones señaladas en el encargo se investigaron
    contra el código real (no se asumió la caracterización del enunciado)
    y su estado real quedó publicado en `docs/STATUS.md` — sin corregir
    el código subyacente (fuera de alcance de esta Epic).
- **Preguntas abiertas**: ninguna de producto. Las contradicciones de
  código detectadas (persistencia, quarter-reveal, flaky de convocatoria,
  script de Playwright sin migrar) quedan documentadas como deuda
  conocida en `docs/STATUS.md`/`docs/ROADMAP.md`, pendientes de que una
  Epic futura las corrija — no de esta.
- **Documentos canónicos**: todo `docs/` es el resultado de esta Epic;
  no hay un documento "externo" al que esta ficha remita.
- **Pruebas mínimas**: exclusivamente documentales (ver sección
  "Validación" abajo) — nunca tests/smokes/Playwright del juego real.
- **Criterios de aceptación**: estructura completa publicada (no solo el
  esquema), sin pérdida de contenido verificable por lectura de los
  bloques migrados, enlaces internos existentes, PR abierta sin fusionar.

## Resultado

### Qué se implementó

- Migración completa de `DESIGN.md` (10 696 líneas) y de los bloques de
  convención permanente de `CLAUDE.md` (1 655 líneas) hacia
  `docs/design/` (24 documentos temáticos, 7 de ellos bajo `docs/design/
  tactics/`) y `docs/architecture/` (10 documentos de contrato
  transversal).
- Migración completa de `CHANGELOG.md` (7 907 líneas) hacia `docs/epics/`
  (26 fichas, una por Epic identificable, con cabecera histórica
  estandarizada) y `docs/history/2026-08-foundation.md` (sesiones sin
  Epic identificable de agosto 2026).
- `CLAUDE.md` reescrito como contrato breve (protocolo de lectura,
  invariantes transversales realmente estables, qué no hacer sin
  Dennis) — de 1 655 a 149 líneas.
- `DESIGN.md` reescrito como entrada pequeña (visión, principios, índice
  por funcionalidad, enlaces a arquitectura/estado/roadmap/mapa de
  referencias) — de 10 696 a 99 líneas.
- `docs/STATUS.md`, `docs/EPIC_CONTEXT.md`, `docs/ROADMAP.md`,
  `docs/CODE_MAP.md` creados desde cero con contenido real (no plantillas
  vacías).
- `docs/code/game-ui.md`, `docs/code/tactics.md`,
  `docs/code/competition-rules.md` creados con símbolos reales
  comprobados en el código (`rg`), no inventados.
- `docs/reference/LEGACY_MAP.md` con la correspondencia completa
  sección-por-sección de los tres documentos originales hacia su destino.
- `CHANGELOG.md` reescrito con entradas breves + enlaces, sin volver a
  pegar diarios de implementación completos.
- Ocho contradicciones del encargo investigadas contra el código real y
  publicadas en `docs/STATUS.md`.

### Pruebas realmente ejecutadas

- Lectura manual de los bloques migrados (muestreo de cabecera/cola de
  cada archivo generado) para confirmar que el contenido no se cortó ni
  se resumió por accidente.
- Comprobación de enlaces internos y de la cobertura de
  `docs/reference/LEGACY_MAP.md` (script `scripts/check-docs-context.js`,
  documental, sin dependencias).
- `git diff --check` (sin espacios en blanco conflictivos).
- Investigación de las ocho contradicciones contra código real vía `rg`
  (no contra la caracterización del enunciado).
- **No se ejecutó** ningún `scripts/test-*.js`/`scripts/smoke-*.js`/
  Playwright/auditoría de temporadas — explícitamente fuera de alcance.

### Deuda aplazada

- Las contradicciones de código detectadas (persistencia no implementada
  pese a lo que decía la documentación antigua, revelado por cuartos
  matizado, `FORMATION_QUOTA_INFEASIBLE` flaky, `verify-cycle1-playwright.js`
  sin migrar) se documentaron pero **no se corrigieron** — corregirlas es
  trabajo de código, fuera del alcance documental de esta Epic.
- Ninguna Epic de funcionalidad se seleccionó ni se arrancó a
  continuación — `docs/EPIC_CONTEXT.md` queda sin Epic activa, a la
  espera de instrucción explícita de Dennis.
