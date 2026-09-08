# DESIGN.md — Basket Manager

Entrada al diseño del juego. Este documento es pequeño a propósito: visión,
principios transversales y el índice hacia el diseño vigente por
funcionalidad. Si una duda de implementación no se resuelve en el
documento canónico enlazado, pregunta a Dennis antes de asumir una regla
no acordada — no la inventes.

## 1. Visión general

Manager de baloncesto al estilo **PC Basket / PC Fútbol**: modo completo
que fusiona presidencia + entrenador en un único rol de jugador (sin
"sombreros" separados). Más adelante se derivará un **modo Manager simple**
(estilo Football Manager) reutilizando el mismo motor, quitando funciones
en vez de añadirlas — ver `docs/design/economy-and-modes.md`.

Enfoque **europeo/FIBA/ACB** de forma deliberada, evitando mecánicas
específicas de NBA (salary cap, draft) salvo que se aborden explícitamente
más adelante.

⚠️ **Nota legal activa**: el proyecto usa nombres reales de jugadores y
clubes para uso privado. Si se comercializa en el futuro, revisar esto
antes (`docs/design/economy-and-modes.md`, nota de comercialización).

## 2. Principios de producto transversales

- **España es contenido, nunca el alcance del motor.** El núcleo modela un
  mundo genérico (geografía, organizaciones, clubes, competiciones de
  clubes y de selecciones); ACB/Primera FEB es el primer paquete de
  contenido instalado sobre él (`data/world/spain-2026.1.js`). Ver
  `docs/architecture/world-model.md`.
- **Una decisión de producto no queda anulada porque el código difiera.**
  Distingue siempre lo acordado (este árbol de documentos) de lo
  implementado (`docs/STATUS.md` lo declara explícitamente).
- **Los datos simulados nunca se presentan como reales** — todo dato
  generado (contratos, agentes, cesiones de prueba) lleva su
  `dataSource`/`isReal` visible. `data/real/` es la única fuente de datos
  reales y se construye progresivamente, nunca de golpe con estadísticas
  inventadas.
- **Contrato, licencia/inscripción, afiliación de plantilla y acuerdo de
  mercado son conceptos distintos** en todo el ciclo profesional de
  plantilla — ninguno de ellos concede ni sustituye a otro.

## 3. Cómo interpretar estados y decisiones

- Un documento de `docs/design/` o `docs/architecture/` describe la regla
  **vigente**. Cuando una entrega posterior cambia una decisión, el
  documento se actualiza en sitio y el antecedente queda como histórico en
  la ficha de Epic correspondiente (`docs/epics/`) — nunca las dos
  versiones compitiendo como vigentes a la vez.
- `docs/STATUS.md` distingue expresamente implementado / verificado
  automáticamente / pendiente de validación manual / diseñado pero no
  implementado / deuda conocida — nunca asumas "vigente en diseño" implica
  "verificado en código".
- Un pendiente sin fórmula/decisión cerrada se marca como tal en su propio
  documento ("Pendiente para sesiones de diseño futuras") y se referencia
  desde `docs/ROADMAP.md` — no se resuelve por inferencia.

## 4. Índice de diseño por funcionalidad

| Funcionalidad | Documento canónico |
|---|---|
| Competiciones españolas (Liga, Copa, Playoffs, Ascenso, calendario) | `docs/design/competitions-spain.md` |
| Agenda, eventos y noticias | `docs/design/events-agenda-news.md` |
| Inicio de partida, economía, roles, modo Manager, plataforma | `docs/design/economy-and-modes.md` |
| Jugadores — ficha, posiciones, polivalencia, antropometría | `docs/design/players-attributes.md` |
| Ficha de equipo/club (reputación, instalaciones, finanzas, junta...) | `docs/design/club-team.md` |
| Motor de simulación de partidos — núcleo | `docs/design/match-simulation.md` |
| Alineaciones, rotación y desgaste/energía | `docs/design/lineups-rotation-energy.md` |
| Sistema táctico (índice propio) | `docs/design/tactics/README.md` |
| Desarrollo, potencial y declive (TMB, LIFE-1) | `docs/design/player-development.md` |
| Entrenamiento (LIFE-2) | `docs/design/training.md` |
| Lesiones y recuperación (LIFE-3) | `docs/design/injuries-recovery.md` |
| Ficha universal, carrera e histórico (LIFE-4) | `docs/design/career-history.md` |
| Player Registry, convocatoria y núcleo normativo (ROSTER-1) | `docs/design/roster-registry.md` |
| Contratos (CONTRACT-1) | `docs/design/contracts.md` |
| Inscripción, licencias y elegibilidad (REG-1) | `docs/design/registration-eligibility.md` |
| Mercado, agentes y negociación (MARKET-1) | `docs/design/market.md` |
| Traspasos y fichajes (TRANSFER-1) | `docs/design/transfers.md` |
| Cesiones (LOAN-1) | `docs/design/loans.md` |
| Ciclo anual, cantera y retirada (CYCLE-1) | `docs/design/annual-cycle.md` |
| Decisiones de interfaz de juego (`src/ui/game.js`) | `docs/design/game-ui-decisions.md` |

## 5. Arquitectura, estado y roadmap

- **Arquitectura transversal** (mundo, Club/Team/Squad, motor de
  competiciones, calendario, pathways, niveles de simulación, selecciones,
  contexto competitivo, frontera de persistencia): `docs/architecture/` —
  índice y detalle en cada documento temático.
- **Estado actual verificable**: `docs/STATUS.md`.
- **Pendientes, propuestas y deuda**: `docs/ROADMAP.md`.
- **Historial por Epic** (qué se implementó, bugs, pruebas ejecutadas):
  `docs/epics/README.md` (índice) y `docs/epics/<ID>.md`.
- **Mapa de código** (qué archivo/símbolo toca cada funcionalidad):
  `docs/CODE_MAP.md`, con guías dedicadas en `docs/code/` para
  `src/ui/game.js`, `src/core/Tactics.js` y `src/core/CompetitionRules.js`.
- **Referencias antiguas** (`DESIGN.md 7.12.24`, `10.21`, etc.):
  `docs/reference/LEGACY_MAP.md` mapea cada sección original a su destino
  nuevo.
