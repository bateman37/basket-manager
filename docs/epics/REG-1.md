# Ficha de Epic — REG-1 (inscripción, licencias, elegibilidad)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `REG-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Inscripción, licencias, elegibilidad, cupos y vinculados.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/registration-eligibility.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 2466-2613 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-26 — REG-1: inscripción, licencias, elegibilidad, cupos y vinculados (DESIGN.md 9.18)

Tercera entrega de la EPIC "Ciclo profesional de plantilla" (9 partes:
ROSTER-1 → CONTRACT-1 → **REG-1** → MARKET-1 → TRANSFER-1 → LOAN-1 →
CYCLE-1 → EUROPE-1 → HARDEN-1). Base: CONTRACT-1 (ya fusionada en `main`).
Esta entrega añade el eje FEDERATIVO: licencia por jugador+temporada,
inscripción por competición+ámbito+temporada, elegibilidad de partido con
motivos estables, cupos colectivos (formación/no comunitarios/acumulado),
jugadores propios de categoría inferior y vinculados, y el acta de partido
idempotente — todo separado de identidad, afiliación y contrato.

En esta PR la pantalla Inscripciones y la pestaña "Licencia y elegibilidad"
de la ficha universal son **de solo lectura**; todavía no hay alta, baja,
suspensión, vinculación, fichaje, renovación, cesión, tanteo ni transfer
como acciones de usuario.

### Bugs heredados corregidos

- **BUG-CONTRACT1-01** — máximo de convocatoria `12` hardcodeado en la
  tabla de Alineación y `toggleSquadMember()`, aplicado a cualquier
  competición por igual. Ahora `resolveTeamSquadRules(team)` resuelve el
  rango REAL del próximo partido (ACB 8-12, Primera FEB 10-12).
- **BUG-CONTRACT1-02** — `resolveTeamSquadRules()` leía `team.division` y
  el reloj global (`state.calendar.currentGameDateTime`) dentro del propio
  resolver. Corregido con `buildMatchCompetitionContext(team, options)`
  como único adaptador de frontera, que exige `options.date` explícita
  (lanza si falta) y expone `phaseId`/`roundId`/`matchId` reales.
- **BUG-CONTRACT1-03** — `Team.buildMatchSquad()` sin overrides
  reproducía en silencio el fallback legacy 8-12 universal. Ahora exige
  `minOverride`/`maxOverride` explícitos (lanza si faltan); el único sitio
  que reproduce ese comportamiento es la red de seguridad EXPLÍCITA de
  `CpuLineup.js` (`TEST_MATCH_SQUAD_POLICY`, documentada como tal).

### Bugs encontrados y corregidos durante esta entrega

Los cuatro primeros solo aparecieron simulando 36 clubes reales durante
**3 temporadas completas** (`smoke-reg1.js`) y el quinto solo en
**verificación de interfaz real** (`verify-reg1-playwright.js`) — ningún
test unitario aislado los detectó, confirmando por qué ambos pasos son
obligatorios en esta EPIC:

- **BUG-REG1-01** — el cierre de temporada expiraba inscripciones
  recorriendo `Team.roster`: un propio de categoría inferior
  (`teamId === null`) o un vinculado (afiliado a su club de origen, nunca
  al beneficiario) nunca viven ahí, así que su licencia expiraba pero su
  inscripción quedaba "activa" para siempre. Corregido recorriendo el
  REGISTRO por ámbito+temporada.
- **BUG-REG1-02** — un newgen de cantera recalculaba su propia
  clasificación de formación/no comunitario sobre el roster YA AMPLIADO,
  pudiendo superar el cupo ya congelado en las inscripciones senior
  recién creadas (visto como `NON_COMMUNITY_CAP_EXCEEDED` real en jornada
  1 de la temporada siguiente). Corregido calculando la clasificación UNA
  sola vez por club, antes del intake de cantera.
- **BUG-REG1-03** — actas de Copa/Playoff/Ascenso con `roundId: null` fijo
  (por eso la comprobación de doble acta nunca se ejecutaba en brackets) y
  `matchId` dependiente de qué equipo era local, que cambiaba entre
  partidos de una misma serie a mejor de N y rompía la exclusión de "esta
  misma acta". La división de fondo, además, etiquetaba SIEMPRE
  `phaseId: 'cup'` aunque el bracket en curso fuera el Playoff o el
  Ascenso. Corregido con `currentBracketRoundKey(phaseId, bracket)` y
  `matchId` con los ids de equipo en orden canónico (ordenados, nunca
  home/away); `resolveBracketOptionsFor(bracket, phaseId)` sustituye al
  resolver fijo.
- **BUG-REG1-04** — la comprobación de doble acta no incluía la
  temporada: la jornada 1 de una temporada nueva colisionaba con la
  jornada 1 de la anterior. Corregido añadiendo `seasonKey` a la clave.
- **BUG-REG1-05** — `currentRegistration()` (deliberadamente solo
  activas) era también la única consulta que usaban
  `EligibilityService`/la pantalla de Inscripciones para diagnosticar por
  qué un jugador no estaba disponible: una inscripción suspendida era
  indistinguible de "nunca inscrito", dejando el código de motivo
  `REGISTRATION_SUSPENDED` inalcanzable. Encontrado con un fixture
  dirigido de sanción disciplinaria en Playwright. Corregido con un nuevo
  método `registrationForScopeSeason()` (cualquier estado) para
  diagnóstico, sin tocar `currentRegistration()`.

Además, el cupo acumulado de la temporada puede agotarse legítimamente
tras varias temporadas de cantera sin ningún sistema de baja/retirada
todavía (CYCLE-1) — `seedRegistrationForNewPlayer()` ahora comprueba el
cupo antes de inscribir y, si está agotado, degrada con gracia (licencia
sí, inscripción diferida) en vez de lanzar una excepción que tiraba abajo
el cierre de temporada completo.

**Nota de transparencia**: verificando con alineaciones realistas se
confirmó, comparando contra la rama base con `git stash`, un bug
PREEXISTENTE en `Tactics.js` (`computeAdvantageScore` lanza con una
alineación degenerada — el mismo jugador en dos slots a la vez — nunca
producida por el motor real). No relacionado con REG-1, no corregido en
esta entrega (`Tactics.js` fuera de alcance).

### Arquitectura

`src/entities/Registration.js` (`FederationLicense`,
`CompetitionRegistration`, `ClubLinkAgreement`, `MatchActSnapshot`,
`PlayerRegulatoryProfile`), `RegistrationEventTypes.js` (máquina de
estados por evento), `RegistrationRegistry.js` (registro canónico),
`RegistrationService.js` (comandos), `RegulatoryClassificationService.js`
(formación/no comunitario contextual, con override aprobado por
organizador antes que el cómputo real del art. 28 FEB),
`EligibilityService.js` (18 códigos de motivo estables),
`SquadEligibilityService.js` (validación de conjunto + selector
determinista por restricciones para la CPU), `RegistrationSeeder.js`
(bootstrap determinista, sin `Math.random`), `RegulatoryCalendar.js`
(ventanas/plazos con calendario explícito). `CompetitionRules.js` amplía
los módulos de inscripción de ACB y Primera FEB con fuentes oficiales
reales (ACB Normas Internas 2025-26; FEB Bases/Reglamento/Manual
2026-27), tres inconsistencias oficiales señaladas para Primera FEB, y
cuatro módulos `reference-only` que demuestran extensibilidad sin
activarse nunca en una partida real.

### Interfaz

Pantalla **Inscripciones** (solo lectura) y pestaña **Licencia y
elegibilidad** en la ficha universal; badges de categoría de
acceso/clasificación/procedencia simulada/no-elegibilidad en la pantalla
de Alineación, con contadores en vivo de formación/no comunitarios y un
candidato inelegible mostrado deshabilitado con su motivo (nunca
desaparece sin explicación). Ningún botón de mercado en ninguna de las
tres superficies. Verificado en escritorio (1280×900) y móvil (390×844)
sin scroll horizontal del documento.

### Pruebas — resultados reales

- `scripts/test-reg1.js`: **88 comprobaciones, 0 fallos** (11 grupos,
  incluida una nueva sección de auditorías estáticas de alcance).
- `scripts/smoke-reg1.js 3`: 36 clubes reales, 3 temporadas completas con
  Copa+Playoffs+Ascenso+cantera — 754 jugadores mundiales, 753 contratos,
  2365 licencias, 2317 inscripciones, 17267 eventos regulatorios, 3966
  actas de partido registradas (17 infeasibilidades médicas conocidas y
  avisadas, <1%, nunca silenciosas), 324 newgens contratados/inscritos
  (43 con inscripción diferida por cupo agotado), fixtures dirigidos de
  lesión/reactivación y de propio/vinculado verificados, todos los datos
  regulatorios simulados correctamente etiquetados.
- `scripts/verify-reg1-playwright.js`: **TODO OK** en escritorio y móvil,
  incluido el fixture que encontró BUG-REG1-05.
- Regresión sin fallos: `test-roster1.js` (31 OK), `test-contract1.js`
  (102 OK), `test-life1.js`/`test-life2.js`/`test-life3.js`/`test-life4.js`
  (22/28/23/26 OK), `smoke-roster1.js 3`, `smoke-contract1.js 3`.

### Fuera de alcance

Alta/baja/suspensión/vinculación/fichaje/renovación/cesión/tanteo/
transfer como acciones de usuario, mercado CPU, Letter of Clearance,
sistema de retiro/liberación de jugadores (CYCLE-1), entidad `Team` para
categorías inferiores/cantera, granularidad por juego individual dentro
de una serie de bracket, corrección del bug preexistente de `Tactics.js`,
save/load. Siguiente entrega: **MARKET-1**.
