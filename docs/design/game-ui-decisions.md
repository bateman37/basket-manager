# Decisiones de interfaz de juego (src/ui/game.js)

_Migrado de `CLAUDE.md` (líneas 75-220 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## Interfaz de juego (`src/ui/game.js` + `src/ui/game.css`)

`index.html` tiene dos entradas independientes, elegidas desde una landing
con dos botones:

- **Modo prueba**: todo el contenido técnico original de `index.html`
  (generación de jugadores/equipos, simulación de un partido suelto,
  pruebas de estrés del motor, pruebas de Liga/Playoffs/Copa/Ascenso). Vive
  tal cual estaba, sin lógica propia añadida — solo queda envuelto en un
  contenedor que se oculta/muestra. Cualquier sesión que añada una nueva
  prueba técnica de un sistema del motor debe seguir añadiéndola aquí,
  como hasta ahora.
- **Empezar temporada**: la interfaz real de juego, implementada en
  `src/ui/game.js` (lógica) y `src/ui/game.css` (estilos). Es una capa de
  presentación sobre el motor existente — no contiene ninguna regla de
  juego propia, todas las reglas activas ya estaban en `DESIGN.md` antes
  de escribir esta interfaz (Liga 3.1, Playoffs/Copa/Ascenso 3.2). Si una
  sesión futura necesita tocar esta interfaz, debe seguir estas
  decisiones ya tomadas, en vez de reinterpretarlas:
  - Selección de equipo: **solo datos reales** del bundle
    (`data/real/real-data-bundle.js`), nunca ficticios — decisión de
    producto, no está en `DESIGN.md` porque es de interfaz, no de reglas
    de juego.
  - Jugadores/equipos se reconstruyen siempre como **instancias reales**
    de `Player`/`Team` (nunca objetos planos) a partir del bundle — mismo
    patrón que ya usa `scripts/import-real-data.js` y la antigua sección
    de prueba de la Liga real. Si se añade otra fuente de datos (por
    ejemplo, un futuro roster editado en partida), debe reconstruirse
    igual, nunca operarse como JSON plano directamente en la UI.
  - El campo `dataSource` de cada jugador sigue **fuera** del constructor
    de `Player` (se asigna aparte tras instanciar) — no integrarlo dentro
    del constructor si se toca este archivo.
  - Revelado progresivo por cuartos en la pantalla de partido: el motor
    (`MatchEngine.simulateMatch`) no tiene punto de entrada por cuartos y
    no se le debe añadir uno solo para esto — resuelve el partido entero
    de una vez. La pantalla simula primero de golpe y luego **revela**
    `result.quarterScores` cuarto a cuarto en la interfaz. Cualquier
    "simulación en vivo" futura debe seguir este mismo patrón (calcular
    ya, revelar poco a poco), no forzar al motor a pararse a mitad de
    partido.
  - La progresión de jornada (Copa en jornada 17, Playoff por el título /
    Playoff de ascenso al terminar la liga regular) se dispara desde
    `simulateNextRound()` en `game.js`, reutilizando `createCup`,
    `createTitlePlayoff` y `PromotionPlayoff` tal cual — no se ha tocado
    ninguno de los tres.
  - Alineación por slots (sesión "Alineación por slots + Minutos de la
    basura"): la tabla de "Alineación por posición" tiene 5 filas (una por
    posición) × 3 columnas de slot (Titular, Suplente 1, Suplente 2). Cada
    slot es un desplegable de convocado + minutos, independiente de los
    demás — un mismo jugador puede repetirse en varios slots/filas sin
    restricción. Esto sustituye al modelo anterior de "una entrada por
    jugador" (una posición declarada + una cuota) tanto en
    `src/core/Rotation.js` (`lineup.entries`) como en la pantalla. Si una
    sesión futura toca esta pantalla, debe seguir este modelo de slots, no
    volver al de una entrada por jugador. Las valoraciones en estrellas
    (Técnica/Física/Mental/Resistencia/Energía/Forma, DESIGN.md 7.11.6) se
    muestran en la lista de convocatoria (checkboxes), no en una tarjeta
    aparte por jugador — esa tarjeta desapareció al introducir la tabla de
    slots.
  - Checkbox "Permitir minutos de la basura" (DESIGN.md 7.11.2-bis): vive
    en `lineup.garbageTime.enabled`, por defecto desactivado, opción de
    partido (no de club/global).
  - Player Registry (ROSTER-1, DESIGN.md 9.16): `state.playerRegistry`
    se construye en `startSeason()` y se rellena registrando el roster de
    cada equipo (`getRealTeamsByDivision()`) y, en cada cierre de
    temporada, los newgens de `generateAcademyIntake()`. La ficha
    universal (`findPlayerById()`) resuelve SIEMPRE desde ahí, nunca
    recorriendo `Team.roster` de los equipos actuales.
  - Convocatoria por competición (ROSTER-1, DESIGN.md 9.16): el rango
    real (min/max) se resuelve con `resolveTeamSquadRules(team)` →
    `CompetitionRules.resolveRules()`, nunca con un 8-12 fijo en la
    pantalla ni en `Team.js`. Un roster real con cobertura de datos
    incompleta se completa en memoria con `padRosterToMinimum()`
    (`src/utils/playerGenerator.js`) — los jugadores añadidos se marcan
    con `dataSource = FICTIONAL_FALLBACK_DATA_SOURCE` y se muestran como
    tales (badge en Alineación, nota en la ficha).
  - Contratos (CONTRACT-1, DESIGN.md 9.17): `state.contractRegistry` se
    construye en `startSeason()` y se rellena con `ContractSeeder`; la
    cantera firma en `closeSeasonAndPrepareNext()` vía `ContractService`,
    nunca desde `Player`/`Team.addPlayer()`. La pantalla **Contratos** y la
    pestaña **Contrato** de la ficha son de SOLO LECTURA: no pueden
    incorporar botones de renovar/fichar/liberar/ejecutar/tantear/ceder
    (TRANSFER-1/LOAN-1) — MARKET-1 (DESIGN.md 9.19) ya permite NEGOCIAR
    desde la pantalla Mercado y crear un Agreement in Principle, pero ese
    acuerdo nunca escribe en `ContractRegistry`; formalizarlo sigue siendo
    de TRANSFER-1, así que Contratos sigue sin botones de acción.
    `team.finances.expenses.playerSalaries`
    es una PROYECCIÓN refrescada desde el registro
    (`ContractService.refreshTeamSalaryProjection`), no un valor editable.
  - Inscripción/licencias/elegibilidad (REG-1, DESIGN.md 9.18):
    `state.registrationRegistry` se construye en `startSeason()`
    (`RegistrationSeeder.seedRegistrationsForTeams`) y se resiembra en
    cada cierre de temporada (`bootstrapRegistrationsForSeasonTransition`),
    ANTES del intake de cantera — la clasificación de formación/no
    comunitario de los newgens de ese cierre se calcula UNA sola vez por
    club (`RegistrationSeeder.classifyRosterForClub`) y se pasa como
    `existingClassification`, nunca recalculada por newgen (BUG-REG1-02).
    La pantalla **Inscripciones** y la pestaña **Licencia y elegibilidad**
    de la ficha son de SOLO LECTURA: no pueden incorporar botones de
    alta/baja/suspensión/vinculación/fichaje/renovación/cesión/tanteo/
    transfer (TRANSFER-1/LOAN-1/EUROPE-1) — igual que Contratos, MARKET-1
    puede generar un Agreement in Principle desde Mercado sin que estas
    pantallas ganen ninguna acción: inscribir sigue siendo de TRANSFER-1.
    El pool regulado de
    un partido (`buildEligiblePoolForMatch(team, context)`, sección 11.1
    del prompt de REG-1) es siempre senior+propios+vinculados evaluados
    por `EligibilityService` — nunca solo `team.roster`; tanto el usuario
    (`getConvocatedPlayers`) como la CPU (`CpuLineup.buildCpuLineup` con
    `eligibility: {pool, resolved}`) consultan el MISMO servicio, nunca
    reglas paralelas. Para actas de Copa/Playoff/Ascenso,
    `resolveBracketOptionsFor(bracket, phaseId)` (no un resolver fijo por
    `bracketPhaseId`) declara el bracket y fase reales en cada llamada, y
    `currentBracketRoundKey(phaseId, bracket)` deriva el `roundId` real —
    nunca `null` fijo ni un id de partido dependiente de qué equipo fue
    local (BUG-REG1-03/04, ver DESIGN.md 9.18).
  - Traspasos y fichajes (TRANSFER-1, DESIGN.md 9.20): `state.transferRegistry`
    se construye en `bootstrapMarketForNewCareer()` y se limpia al volver
    a selección de equipo, igual criterio que `agentRegistry`/
    `marketRegistry`. Un AIP vivo en Mercado > Negociaciones muestra el
    asistente de formalización real (`renderAgreementFormalizationHtml()`,
    `determineTransferMechanism()`) en vez del texto estático anterior —
    llama SIEMPRE a `TransferService`/`TransferExecutionService`, nunca
    escribe en `ContractRegistry`/`RegistrationRegistry`/`Team.roster`/
    `player.teamId` directamente. Mercado > Operaciones
    (`renderMarketOperationsTab()`) es de SOLO LECTURA — expedientes del
    club por estado, sin ninguna acción propia. La ficha universal
    (pestaña "Mercado y representación") añade expediente activo y
    traspasos/liberaciones históricos (`renderPlayerTransferHistoryHtml()`),
    resueltos siempre desde `state.transferRegistry`/Player Registry,
    nunca desde `Team.roster` de los equipos actuales. Contratos e
    Inscripciones siguen de solo lectura tal cual se documentó en REG-1/
    CONTRACT-1 más arriba — ninguna de las dos gana botones de acción con
    esta entrega.
  - Cesiones (LOAN-1, DESIGN.md 9.21): Mercado gana la pestaña
    **Cesiones** (`renderMarketLoansTab()`) — formulario "Ceder un jugador
    propio" que negocia y activa en un único envío
    (`runLoanNegotiation()`/`wireMarketLoansTabActions()`), siempre vía
    `LoanService`/`LoanExecutionService`, nunca escribiendo en
    `LoanRegistry`/`ContractRegistry`/`RegistrationRegistry`/`Team.roster`
    directamente. Contratos gana el badge "Cedido fuera" en la fila del
    propietario mientras la cesión está activa, y una tarjeta "Jugadores
    cedidos que refuerzan tu plantilla" para las cesiones entrantes —
    ambas resueltas siempre desde `state.loanRegistry`, nunca desde
    `Team.roster` de los equipos actuales. Contratos e Inscripciones
    siguen sin ganar ningún botón de acción con esta entrega.
