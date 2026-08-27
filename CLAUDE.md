# CLAUDE.md — Instrucciones técnicas del proyecto

Este archivo lo lee cualquier sesión de Claude Code antes de trabajar en
este repositorio. Contiene convenciones técnicas. Las reglas de diseño del
juego están en `DESIGN.md` — léelo también antes de implementar cualquier
sistema de juego (economía, fichajes, simulación, etc.).

## Sobre el usuario de este proyecto

Dennis es el diseñador/product owner del proyecto, no programador (lleva
20 años sin tocar código). Todo el código lo escribe Claude Code. Dennis
revisa, prueba y decide, pero no espera tener que leer o editar código él
mismo. Explica los cambios en términos de qué hacen y por qué, no solo en
términos técnicos.

## Stack técnico

- **JavaScript + HTML/CSS puro**, sin frameworks pesados (nada de React,
  Vue, build steps complejos) — el objetivo es que cualquier sesión pueda
  abrir un archivo `.html` en el navegador y ver el resultado
  inmediatamente, sin pasos de compilación.
- Node.js solo se usa si hace falta para scripts de utilidad (por ejemplo,
  generar datos, procesar JSON de jugadores), no para servir el juego.
- Persistencia de partidas: localStorage del navegador por ahora (no hay
  backend ni base de datos externa en esta fase).

## Estructura de carpetas

```
basket-manager/
├── DESIGN.md              # reglas del juego — leer antes de implementar sistemas
├── CLAUDE.md               # este archivo
├── CHANGELOG.md            # registro de qué se hizo en cada sesión
├── index.html              # punto de entrada del juego
├── data/
│   ├── fictional/           # jugadores/equipos ficticios (fase de arranque)
│   └── real/                # datos reales (ACB, LEB, clubes europeos) — se construye progresivamente
├── src/
│   ├── core/                # motor de simulación (partidos, temporadas, calendario)
│   ├── entities/             # clases/estructuras: Jugador, Equipo, Liga, Directiva
│   ├── economy/              # módulo económico (presupuesto, ingresos, gastos)
│   ├── ui/                   # pantallas e interfaz
│   └── utils/
└── saves/                   # exports/imports de partidas guardadas (JSON)
```

## Convenciones

- Nombres de archivos y variables en inglés (estándar de programación),
  comentarios de código en español.
- Cada sistema nuevo grande (economía, fichajes, simulación de partidos...)
  debe poder probarse abriendo `index.html` sin configuración adicional.
- Antes de implementar cualquier regla de juego, comprobar `DESIGN.md`.
  Si `DESIGN.md` no cubre el caso, señalarlo explícitamente en la
  respuesta en vez de asumir una regla no acordada.
- Actualizar `CHANGELOG.md` al final de cada sesión con un resumen breve
  de qué se implementó.

## Datos reales de jugadores/clubes (importante)

Este proyecto usa **nombres reales** de jugadores y clubes para uso
privado (ver nota legal en `DESIGN.md`, sección 12). La construcción de
esta base de datos real es un proceso progresivo y separado del
desarrollo del motor — no generar de golpe cientos de jugadores reales
"inventándose" estadísticas; si no hay datos reales disponibles para un
jugador/equipo, usar el generador ficticio y señalarlo claramente en vez
de presentar datos inventados como si fueran reales.

## Sobre nombres oficiales de marcas/competiciones

Evitar el uso de logos, escudos o assets gráficos con marcas registradas.
Los nombres de ligas y competiciones ficticias (si se usan en vez de los
reales) deben quedar claramente diferenciados en `DESIGN.md`.

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

## Ciclo profesional de plantilla (ROSTER-1, CONTRACT-1, REG-1, MARKET-1, TRANSFER-1, LOAN-1 y siguientes)

Convenciones permanentes de la EPIC iniciada en ROSTER-1 (DESIGN.md 9.16),
ampliada en CONTRACT-1 (DESIGN.md 9.17), en REG-1 (DESIGN.md 9.18), en
MARKET-1 (DESIGN.md 9.19), en TRANSFER-1 (DESIGN.md 9.20) y en LOAN-1
(DESIGN.md 9.21) — aplican a toda sesión futura que toque contratos,
licencias, inscripción, elegibilidad, mercado, traspasos, cesiones o
transfer internacional:

- Todo jugador vive en el Player Registry mundial
  (`src/core/PlayerRegistry.js`, `state.playerRegistry`); una plantilla
  (`Team.roster`) solo contiene referencias afiliadas, nunca es el
  directorio global de jugadores.
- Código nuevo nunca busca a un jugador recorriendo los rosters de los
  equipos actuales como si fueran un índice global — se resuelve desde el
  registro.
- Lógica normativa nueva usa `competitionId` (`src/core/
  CompetitionRules.js`) y `RulesetBundle`/`RuleModule` — nunca `division`
  (`1ª`/`2ª`), el nombre visible de una liga, ni un comportamiento ACB
  aplicado por defecto a una competición desconocida.
- La UI consulta CAPACIDADES derivadas (`resolved.capabilities.has(...)`)
  para decidir qué mostrar, pero el CORE siempre valida con la política
  real correspondiente — una capacidad nunca implementa el
  comportamiento por sí sola.
- La relación laboral (contrato) y el registro/licencia por competición
  son conceptos separados — un contrato no concede una licencia, una
  licencia no sustituye a un contrato.
- Toda norma codificada (cupos, convocatoria, altas, ventanas...) incluye
  fuente oficial, versión/temporada de vigencia y estado
  (`verified`/`provisional`/`deprecated`) — nunca un número sin
  procedencia.
- No se mezclan perfiles normativos con `Object.assign()`/spread
  genérico — cada tipo de regla usa la estrategia de composición que le
  corresponde (mínimos concurrentes → el mayor; máximos concurrentes → el
  menor; ventanas → intersección; procedimientos como el tanteo → state
  machine, nunca merge de campos).
- Las reglas de una temporada ya iniciada quedarán congeladas por
  versión (`rulesetBundleId`+`version`) cuando exista persistencia real
  (HARDEN-1) — no se implementa guardado nuevo antes de esa entrega.

### Contratos (CONTRACT-1, DESIGN.md 9.17)

- `ContractRegistry` (`src/core/ContractRegistry.js`,
  `state.contractRegistry`) es la fuente CANÓNICA de contratos: nunca
  duplicar un `currentContract` en `Player`/`Team` ni mantener un array
  paralelo de contratos en el equipo. "Contrato actual", "contratos del
  club" y "nómina" son consultas derivadas del registro.
- Contrato, afiliación de plantilla, licencia/inscripción y clearance
  internacional son cuatro conceptos DISTINTOS. Un contrato no concede
  licencia ni mueve a nadie de `Team.roster`.
- El dominio `employment` se resuelve por CLUB + jurisdicción del
  EMPLEADOR + fecha (`ClubEmploymentContextCatalog.js`), nunca por "la
  competición del próximo partido".
- `CompetitionDefinition.organizerCountry` describe al ORGANIZADOR de la
  competición: jamás usarlo como `employerJurisdictionId`.
- **MoraBanc Andorra es el test transfronterizo obligatorio**: compite en
  ACB con empleador en Andorra. Cualquier cambio normativo debe seguir
  resolviéndole AD, sin RD 1006 ni SMI español, con el convenio ACB solo
  como capa de membresía.
- Toda regla está versionada, fechada (`validity`), trazada
  (`trace.fields`) y con `status`. No hay fallback ACB ni selección
  silenciosa de "la última versión": sin coincidencia exacta solo continúa
  quien declare `carryForwardUntilSuperseded`, y con warning.
- Un contrato congela sus módulos de firma (`signingContext`): un
  ascenso/descenso no reescribe la normativa de un contrato anterior; solo
  una firma nueva usa el contexto nuevo.
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217
  (`src/utils/Money.js`); nunca floats de euros. Los totales se derivan,
  no se guardan.
- Fechas contractuales SIEMPRE civiles ISO `YYYY-MM-DD` e inclusivas
  (`src/utils/LocalDate.js`); el estado del contrato se DERIVA de fechas y
  eventos, nunca se persiste ("expira pronto" es etiqueta de UI).
- Los datos simulados nunca se presentan como reales: todo contrato
  generado lleva `dataSource: 'simulated-contract-v1'`, `isReal: false` y
  el aviso "Contrato simulado para esta partida; no es un dato contractual
  real.". Nunca escribir contratos en `data/real/`.
- El seeder es DETERMINISTA (hash de `playerId+clubId+seasonKey+
  generatorVersion`, sin `Math.random`) y solo usa señales VISIBLES (TMB,
  edad, percentiles de su competición): nunca Potencial, Ambición,
  Profesionalidad, `team.reputation` ni `budget` del dataset.
- Las cláusulas son una unión discriminada tipada con validador propio, y
  hoy todas `modeled-only`. Nunca un booleano tipo `hasTanteo`: el tanteo
  será una máquina de estados en MARKET-1. Un buyout no es un transfer fee.
- No hay renovaciones, traspasos, cesiones ni ejecución de cláusulas
  automáticas antes de sus entregas (MARKET-1/TRANSFER-1/LOAN-1/CYCLE-1);
  la interfaz no debe mostrar controles falsos de esas acciones.
- El puente `minimumPlayableRemainingSeasons = 3` del seeder es staging
  temporal documentado, no una distribución contractual real: CYCLE-1 lo
  retirará.
- Añadir una liga/competición nueva es registrar su
  `CompetitionDefinition`/`RuleModule`/`RulesetBundle` en los catálogos
  existentes — nunca editar `Team.js`, `game.js` ni introducir una rama
  nueva repartida por la UI.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura normativa o las reglas activas.

### Inscripción, licencias y elegibilidad (REG-1, DESIGN.md 9.18)

- `RegistrationRegistry` (`src/core/RegistrationRegistry.js`,
  `state.registrationRegistry`) es la fuente CANÓNICA de licencias
  (`FederationLicense`), inscripciones (`CompetitionRegistration`),
  acuerdos de vinculación (`ClubLinkAgreement`) y actas de partido
  (`MatchActSnapshot`). Licencia, inscripción, contrato y afiliación de
  plantilla son CUATRO conceptos distintos — un contrato no concede
  licencia ni inscripción, una licencia no sustituye al contrato.
- `currentRegistration(playerId, scope, seasonKey, date)` devuelve SOLO
  inscripciones ACTIVAS ("¿puede jugar ahora?") — para diagnosticar o
  mostrar el motivo real de una no-disponibilidad (suspendida,
  desactivada, expirada) se usa siempre
  `registrationForScopeSeason(playerId, scope, seasonKey)` (cualquier
  estado). Confundir ambas dejó `REGISTRATION_SUSPENDED` como código de
  motivo inalcanzable (BUG-REG1-05) — cualquier consulta nueva que
  necesite explicar POR QUÉ un jugador no está disponible debe usar la
  segunda, nunca la primera.
- La clasificación de formación/no comunitario es CONTEXTUAL (por
  competición+temporada+fecha) — nunca un booleano universal del jugador
  (`player.isHomegrown` y equivalentes están prohibidos y auditados
  estáticamente). Un propio de categoría inferior no tiene equipo `Team`
  que lo modele todavía: es un jugador con `teamId === null` (sin
  afiliación senior), nunca un id de equipo inventado. Un vinculado
  conserva SIEMPRE su afiliación/contrato reales con su club de origen —
  la vinculación solo autoriza su convocatoria por el club beneficiario
  (`accessCategory: 'linked'`), nunca mueve `player.teamId` ni
  `Team.roster`.
- El pool regulado de CUALQUIER partido (usuario o CPU) es
  senior+propios+vinculados evaluados por `EligibilityService` — nunca
  solo `team.roster`. CPU y usuario consultan EXACTAMENTE el mismo
  `EligibilityService`/`SquadEligibilityService`; la CPU selecciona
  convocatoria con `SquadEligibilityService.selectLegalSquad` (reparación
  determinista por restricciones), nunca un greedy "los N mejores" que
  ignore un cupo.
- `roundId`/`matchId` de un acta de bracket (Copa/Playoff/Ascenso) se
  derivan de `currentBracketRoundKey(phaseId, bracket)` (prefijo de fase +
  ronda real, o sub-fase cuartos/Final Four para `PromotionPlayoff`) y de
  los ids de equipo en orden CANÓNICO (ordenados, nunca home/away) — un
  `roundId: null` fijo o un `matchId` sensible al orden local/visitante
  rompe la detección de doble acta entre rondas/temporadas/series
  (BUG-REG1-03). Toda comprobación de "misma jornada" incluye SIEMPRE
  `seasonKey` en la clave (BUG-REG1-04) — la jornada 1 de una temporada
  nunca es la misma jornada que la 1 de otra.
- El cierre de temporada expira licencias/inscripciones recorriendo el
  REGISTRO por ámbito (`registrationsForScope(scopeId)` filtrado por
  `seasonKey`), nunca `Team.roster` — un propio/vinculado no vive ahí
  (BUG-REG1-01). La re-siembra de un nuevo ámbito/temporada se ejecuta
  ANTES del intake de cantera; la clasificación de los newgens de ese
  cierre se calcula UNA sola vez por club (sobre el roster senior previo
  al intake) y se pasa como `existingClassification` a cada newgen —
  nunca un sorteo independiente por jugador, que podía superar el cupo ya
  congelado del club (BUG-REG1-02).
- El cupo acumulado de la temporada (`cumulativeRegistrationCap`) puede
  agotarse legítimamente sin ningún sistema de baja/retirada todavía
  (CYCLE-1). `RegistrationService.createRegistration()` sigue siendo una
  API estricta que rechaza con excepción dura si no se comprueba antes;
  el seeder de mejor esfuerzo comprueba el cupo y, si está agotado,
  degrada con gracia (licencia sí, inscripción de competición diferida)
  en vez de tirar la partida abajo — nunca inventa un cupo mayor.
- La excepción médica de convocatoria (mínimo reducido hasta el absoluto
  por escasez médica real) se propaga a
  `SquadEligibilityService.validateSquad()`/`buildLiveCounters()` vía
  `options.effectiveMin` — sin ese dato el acta exigía el mínimo normal
  incluso en una crisis médica genuina.
- Toda regla real (cupos, ventanas, documentos, vinculación...) incluye
  `sourceRefs` y, cuando las fuentes oficiales se contradicen entre sí,
  se declara en `knownSourceInconsistencies` — nunca se resuelve la
  contradicción por criterio propio sin señalarlo. Los cuatro módulos
  `reference-only` (acta máxima 9, máximo 1 no comunitario, U22, ámbito
  internacional) nunca se autoseleccionan sin fijarlos explícitamente —
  demuestran extensibilidad, no se activan en ninguna partida real.
- No hay alta, baja, suspensión, vinculación, fichaje, renovación, cesión,
  tanteo ni transfer como ACCIONES de usuario antes de sus entregas
  (TRANSFER-1/LOAN-1/EUROPE-1 — MARKET-1 ya añade la NEGOCIACIÓN, pero
  nunca ejecuta el fichaje); la pantalla Inscripciones y la pestaña de la
  ficha son de solo lectura.

### Mercado, agentes y derechos (MARKET-1, DESIGN.md 9.19)

Convenciones permanentes de MARKET-1 — aplican a toda sesión futura que
toque negociación, agentes/representación, ofertas, Agreement in
Principle o el procedimiento de tanteo ACB, y a TRANSFER-1/LOAN-1/
EUROPE-1 cuando construyan sobre esta entrega:

- Todo jugador negociable se resuelve desde el Player Registry mundial
  (`state.playerRegistry`) — código nuevo nunca busca un jugador
  recorriendo `Team.roster` de los equipos actuales como si fuera un
  índice global (mismo principio que ROSTER-1/REG-1).
- `state.agentRegistry` y `state.marketRegistry` son instancias
  EXPLÍCITAS por carrera (creadas en `bootstrapMarketForNewCareer()`,
  limpiadas al volver a selección de equipo) — nunca singletons, nunca
  recreadas de forma perezosa desde un renderizador.
- Un agente, una oferta o un derecho de tanteo NUNCA se duplican como
  campo suelto en `Player`/`Team` (`player.agent`, `player.currentOffer`,
  `team.offers`, `hasTanteo` y equivalentes están prohibidos y auditados
  estáticamente en `scripts/test-market1.js`) — viven solo en
  `AgentRegistry`/`MarketRegistry`.
- Oferta (`ContractOffer`), Agreement in Principle, contrato
  (`ContractRegistry`, CONTRACT-1), afiliación de plantilla
  (`Team.roster`) y licencia/inscripción (`RegistrationRegistry`, REG-1)
  son CUATRO conceptos distintos — un AIP nunca registra un contrato,
  nunca mueve `player.teamId`, nunca crea licencia ni inscripción. Esa
  ejecución es de TRANSFER-1, no de MARKET-1.
- Lógica de mercado nueva usa `competitionId`/módulos de
  `CompetitionRules.js` (dominio `market`) — nunca `division`
  (`1ª`/`2ª`), el nombre visible de una liga, ni ACB como comportamiento
  por defecto de una competición desconocida (lanza explícito).
- Un `NegotiationThread`/`RightOfFirstRefusalCase` congela sus módulos de
  reglas (`rulesSnapshot`/`procedureRules`) al abrirse — un ascenso/
  descenso posterior del club no reescribe la normativa de un hilo o caso
  ya abierto.
- Una `ContractOffer` enviada es INMUTABLE (`Object.freeze()` sobre su
  `contractDraft`) — una contraoferta es SIEMPRE una entidad nueva con id
  y versión propios, nunca una mutación de la anterior.
- Un borrador de oferta se valida con `ContractService.validateDraft()`
  (pura, sin registrar) — nunca se llama a
  `ContractRegistry.register()`/`ContractService.createContract()`/
  `Team.addPlayer()`/`removePlayer()`/`RegistrationService` desde un
  comando de Market ni desde la resolución de un AIP.
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217;
  fechas SIEMPRE civiles ISO vía `LocalDate`, nunca `Date.now()`/reloj de
  sistema dentro del core de mercado — toda fecha llega explícita desde
  `state.calendar.currentGameDateTime` adaptada en la frontera.
- El jugador conserva SIEMPRE la decisión final
  (`playerSignsPersonallyAndRetainsFinalDecision`, principio FIBA
  universal) — un agente/mandato autoriza a negociar en su nombre, nunca
  decide por él. Los conflictos de interés (mismo agente en ambos lados,
  representar a un club y a un jugador de ese club a la vez) se validan
  contra `PlayerRegistry`/afiliación real, nunca se asumen ausentes.
- La licencia FIBA de un agente NUNCA se exige para negociación
  doméstica sin `transactionScope === 'international'` — sigue bloqueada
  para transfer internacional real hasta EUROPE-1.
- El tanteo ACB (y sus variantes de inscripción preferente/retorno) es un
  PROCEDIMIENTO con máquina de estados y plazos fechados
  (`RightOfFirstRefusalService`) — nunca un booleano. El core valida
  siempre con la política real (`openCase()` lanza explícito si la
  competición no resuelve procedimiento doméstico) — una capacidad de UI
  (`capabilities.has('supportsRightOfFirstRefusal')`) decide solo qué
  MOSTRAR, nunca es la única barrera de una regla de dominio.
- `advanceGameClockTo()` sigue siendo el ÚNICO punto que avanza
  `state.calendar` — cualquier nueva parada obligatoria ante mercado
  (contraoferta viva, plazo de tanteo) se añade ahí, nunca repartida por
  los call-sites de Liga/Copa/Playoffs/Ascenso.
- No se ejecuta fichaje/traspaso/cesión/inscripción/contrato real antes
  de sus entregas (TRANSFER-1/LOAN-1) — MARKET-1 se detiene siempre en el
  Agreement in Principle.
- Todo dato simulado de mercado (libres ficticios, agentes, mandatos,
  contratos de fixture) lleva `dataSource`/dataSource simulado y
  `isReal: false` visibles — nunca se presenta como un dato real, y
  `data/real/` no se toca nunca desde este dominio.
- Los módulos `reference-only` (overlay EuroLeague, ventana de
  competición ficticia de test) nunca se autoseleccionan en un
  `RulesetBundle` real — solo se activan fijando su id explícitamente,
  como demostración de extensibilidad.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura de mercado o las reglas activas.
- Ningún caso de tanteo se abre orgánicamente todavía en una carrera
  normal (`openCase()` solo se ejercita desde tests/smoke con fixtures
  dirigidos) — CONTRACT-1 garantiza un mínimo de 3 temporadas restantes en
  todo contrato (`MINIMUM_PLAYABLE_REMAINING_SEASONS`, puente de staging),
  así que ningún contrato expira todavía dentro de un horizonte
  verificable. El gancho de apertura orgánica en cierre de temporada queda
  para CYCLE-1 (cuando exista expiración/renovación real) — no lo
  construyas antes, sería código inalcanzable e imposible de verificar.

### Traspasos, fichajes y ejecución (TRANSFER-1, DESIGN.md 9.20)

Convenciones permanentes de TRANSFER-1 — aplican a toda sesión futura que
toque fichajes, traspasos, cláusulas de rescisión, terminación de
contrato, compensaciones, y a LOAN-1/CYCLE-1/EUROPE-1 cuando construyan
sobre esta entrega:

- `TransferRegistry` (`src/core/TransferRegistry.js`,
  `state.transferRegistry`) es la fuente CANÓNICA de `TransferCase`/
  `ClubTransferOffer`/`TransferAgreement`/`ReleaseClauseExercise`/
  `ContractTerminationRecord`/`FinancialObligation`/`TransactionRecord` —
  instancia EXPLÍCITA por carrera (creada en `bootstrapMarketForNewCareer()`,
  limpiada al volver a selección de equipo), nunca un singleton.
- La UI SOLO llama a `TransferService`/`TransferExecutionService` — nunca
  escribe directamente en `TransferRegistry`/`ContractRegistry`/
  `RegistrationRegistry`/`Team.roster`/`player.teamId`. `Team.roster`/
  `player.teamId` tienen una única frontera autorizada,
  `RosterMutationService.js` — ninguna otra parte del dominio de
  transferencia los toca (auditado estáticamente en
  `scripts/test-transfer1.js`).
- Toda operación pasa por `planTransaction()` (puro, nunca muta ni
  reserva) antes de `commitTransaction()` (revalida los fingerprints del
  plan contra el estado REAL antes de tocar nada — un plan obsoleto se
  rechaza con `PLAN_STALE_*`, nunca se ejecuta a ciegas). El commit es una
  saga: cada paso muta y ACTO SEGUIDO **almacena** su cierre de reversión
  (nunca lo ejecuta ahí mismo) — si un paso posterior falla, se deshace en
  orden inverso y el mundo queda EXACTAMENTE como estaba. Idempotente por
  `transactionId`.
- AIP (MARKET-1), `TransferAgreement`/`ClubTransferOffer` (oferta
  club-club), contrato definitivo (`ContractRegistry`) y afiliación de
  plantilla (`Team.roster`) son CUATRO conceptos distintos — formalizar
  nunca colapsa dos en uno.
- `TransferCase` (y `ClubTransferOffer`/`ReleaseClauseExercise`/
  `ContractTerminationRecord`) son máquinas de estados por EVENTOS
  validados y ordenados (mismo patrón que `MarketEventTypes.js`/
  `RegistrationEventTypes.js`) — nunca un campo de estado mutable libre.
  Un terminal (`completed`/`rejected`/`withdrawn`/`expired`/`failed`)
  nunca vuelve a un estado vivo. Los eventos ADMINISTRATIVOS del
  expediente (`case-opened`/`ready-to-plan`/`planned`/`scheduled`/
  `blocked`) se fechan en el momento REAL de la acción (`now`) — nunca en
  `effectiveDate` (la fecha en que la operación surte efecto, que puede
  ser posterior en un fichaje futuro); confundir ambas deja un expediente
  `scheduled` invisible hasta su propia fecha efectiva.
- Un reintento de expediente `scheduled` (`retryScheduledTransferCase()`)
  SIEMPRE replanifica y revalida desde cero contra el estado real del
  momento del reintento — nunca ejecuta a ciegas el plan antiguo. Decide
  si un expediente sigue `scheduled` con `statusOn(null)` (estado real,
  sin filtrar por fecha) — nunca `statusOn(fechaDeLlamada)`: dos
  divisiones/ligas pueden procesar sus rondas en fechas que no avanzan en
  el mismo orden estricto, y un expediente ya completado con fecha
  posterior podría parecer `scheduled` otra vez ante una fecha anterior.
- Lógica de traspaso nueva usa `resolveTransferRules()`/módulos de
  `CompetitionRules.js` (dominio `transfer`) — nunca `division`
  (`1ª`/`2ª`), el nombre visible de una liga, ni ACB como comportamiento
  por defecto de una jurisdicción/competición desconocida (lanza
  explícito). El empleador andorrano (MoraBanc Andorra) NUNCA hereda el
  15 % español del RD 1006 art. 13.a ni su procedimiento — sigue siendo el
  test transfronterizo obligatorio de toda la EPIC.
- Fee, participación del jugador (RD 1006 art. 13.a), buyout de cláusula,
  settlement de mutuo acuerdo, compensación de terminación, compensación
  ACB por renuncia de derechos (art. 16) y comisión de agente son
  conceptos SEPARADOS — nunca colapsados en un único importe ni sumados
  entre sí. La compensación ACB por renuncia NUNCA concede participación
  al jugador (invariante 13 del prompt de TRANSFER-1).
- El consentimiento del jugador a un traspaso NUNCA se deduce de haber
  aceptado una oferta salarial — sin `playerConsentGrantedAt` explícito,
  no hay consentimiento y el plan bloquea.
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217;
  fechas SIEMPRE civiles ISO vía `LocalDate`, nunca `Date.now()`/reloj de
  sistema dentro del motor de traspasos.
- `advanceGameClockTo()` sigue siendo el ÚNICO punto que avanza
  `state.calendar` — el reintento de un fichaje futuro
  (`processDueScheduledTransfersToDate()`) se dispara ahí, nunca repartido
  por los call-sites de Liga/Copa/Playoffs/Ascenso. Ninguna noticia de
  mercado se construye dentro del dominio de transferencia — game.js la
  publica SOLO tras un commit real, nunca antes (auditado estáticamente).
- No se ejecuta cesión/subrogación (LOAN-1), renovación/expiración
  orgánica de contrato ni apertura orgánica de tanteo (CYCLE-1, sigue
  bloqueada por el suelo de `MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` de
  CONTRACT-1) ni transfer internacional real/licencia FIBA para la
  operación (EUROPE-1, hoy solo bloquea, nunca concede completado) antes
  de sus entregas — TRANSFER-1 se detiene en el ámbito doméstico
  verificable.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura de traspasos o las reglas activas.
- **Corrección (BUG-TRANSFER1-20, detectada durante LOAN-1)**: la licencia
  de DESTINO en `TransferExecutionService.js`'s `commitTransaction()` usaba
  el id determinista por defecto de `RegistrationService.issueLicense()`
  (`playerId+clubId+seasonKey`) en vez de un id explícito por transacción
  — igual fallo que ya se había corregido para la inscripción de destino
  (comentario ya presente en el código), pero nunca replicado a la
  licencia. Choca en cuanto el mismo jugador se re-licencia en el MISMO
  club dentro de la misma temporada (p.ej. cedido y devuelto, y ACTO
  SEGUIDO comprado en firme por su propio excesionario). Corregido con
  `id: \`license:${transactionId}\`` — cualquier código nuevo que emita
  una licencia debe seguir fijando su id explícito por transacción, nunca
  confiar en el default determinista cuando el mismo club+temporada puede
  repetirse.
- **Corrección**: `scripts/smoke-transfer1.js` llevaba roto desde
  BUG-TRANSFER1-16 (contexto operacional obligatorio) — sus fixtures nunca
  pasaban `operationalContext`, así que la prueba de humo de 3 temporadas
  nunca se había vuelto a ejecutar completa desde esa entrega. Cualquier
  script de prueba de humo nuevo que llame a `TransferService`/
  `LoanService` debe declarar `operationalContext` explícito (mismo
  criterio que `game.js`), nunca asumir que el motor lo hace opcional.

### Cesiones, retorno, recall y opción de compra (LOAN-1, DESIGN.md 9.21)

Convenciones permanentes de LOAN-1 — aplican a toda sesión futura que
toque cesiones domésticas, retorno, recall, terminación anticipada u
opción/obligación de compra sobre un jugador cedido, y a CYCLE-1/EUROPE-1
cuando construyan sobre esta entrega:

- `LoanRegistry` (`src/core/LoanRegistry.js`, `state.loanRegistry`) es la
  fuente CANÓNICA de `LoanCase`/`LoanProposal`/`LoanPartyConsent`/
  `LoanAgreement`/`PurchaseOptionExercise` — instancia EXPLÍCITA por
  carrera (creada en `bootstrapMarketForNewCareer()`, limpiada al volver a
  selección de equipo), nunca un singleton.
- Una cesión NUNCA mueve el contrato matriz — solo afiliación de plantilla
  (`Team.roster`/`player.teamId`, vía `RosterMutationService`, la MISMA
  frontera de TRANSFER-1) y licencia/inscripción de competición. Código
  nuevo nunca asume que "cedido" implica un contrato nuevo con el
  cesionario.
- El modelo de fechas es SIEMPRE semiabierto:
  `serviceStartDate <= date < returnEffectiveDate`
  (`LoanAgreement.isActiveOn(date)`) — el día del retorno cuenta como ya
  devuelto. `currentStatus()` se DERIVA siempre de las referencias reales
  (`outboundTransactionId`/`returnTransactionId`/
  `earlyTerminationRecordId`/`convertedTransferCaseId`) — nunca un campo
  de estado mutable libre.
- Lógica de cesión nueva usa `resolveLoanRules()`/módulos de
  `CompetitionRules.js` (dominio `loan`) — nunca `division` (`1ª`/`2ª`),
  el nombre visible de una liga, ni ACB como comportamiento por defecto de
  una jurisdicción/competición desconocida (lanza explícito). El empleador
  andorrano (MoraBanc Andorra) NUNCA hereda el régimen español del RD 1006
  art. 11 — sigue siendo el test transfronterizo obligatorio de la EPIC,
  bloqueado con `AD_NO_LOAN_REGIME_SOURCED` explícito.
- `LoanExecutionService.js` reutiliza el MISMO patrón
  `planTransaction()`/`commitTransaction()` de TRANSFER-1 (replan-at-commit,
  `registerUndo()` que solo almacena el cierre, saga revertida en orden
  inverso) — nunca un segundo motor de saga duplicado. La licencia +
  inscripción de destino en la ACTIVACIÓN son obligatorias dentro del
  bloque atómico; en RETORNO/terminación anticipada, la re-inscripción del
  propietario es una fase administrativa NO atómica aparte
  (`registrationOutcome: 'active'|'pending-registration'`), mismo criterio
  que TRANSFER-1 sección 14.2.
- Toda emisión de licencia/inscripción nueva (activación Y retorno) fija
  su `id` EXPLÍCITO por transacción (`license:${transactionId}`,
  `license:return:${transactionId}`, `registration:${transactionId}`,
  `registration:return:${transactionId}`) — nunca el id determinista por
  defecto (BUG-TRANSFER1-20): el mismo jugador puede re-licenciarse en el
  MISMO club dentro de la misma temporada más de una vez a lo largo de una
  cesión (activación → retorno → nueva cesión, o activación → retorno →
  compra en firme por el propio excesionario).
- La re-inscripción de RETORNO siempre referencia el contrato matriz
  (`agreement.masterContractId`) — nunca `contractId: null`: el contrato
  nunca se movió durante la cesión, sigue siendo el vigente del
  propietario al volver, y una inscripción senior activa exige contrato
  (BUG-REG1-07).
- `CompetitionRegistration.employmentBasis` (`{type:
  'direct-contract'|'temporary-assignment'|'regulatory-exception',
  contractId, employerClubId, serviceClubId}`, por defecto
  `'direct-contract'`) es el ÚNICO mecanismo que explica que el contrato
  de una inscripción pertenezca a un club distinto de `registration.teamId`
  — tanto en `RegistrationService.createRegistration()` como en
  `RegistrationRegistry.validateIntegrity()` y
  `ContractRegistry.validateIntegrity()` (esta última vía
  `loanRegistry.activeAgreementForPlayer()`). Nunca una excepción genérica
  "cualquier discordancia vale" — solo cuando `employmentBasis` declara
  exactamente ese reparto y coincide con un `LoanAgreement` real.
- El pool regulado de un partido sigue evaluándose SIEMPRE por
  `EligibilityService` (REG-1) — la cláusula `parent-club-match-eligibility`
  se comprueba ahí (motivo `PARENT_CLUB_MATCH_RESTRICTED`), nunca en una
  regla paralela de UI o de la CPU.
- **Opción de compra ejercida por el propio cesionario** (caso habitual):
  `TransferService.formalizeNegotiatedTransfer()` asume que el club de
  ORIGEN tiene físicamente al jugador — como la instancia real está en el
  roster del CESIONARIO durante la cesión, el handoff definitivo se
  compone SIEMPRE de dos pasos atómicos encadenados
  (`LoanService.returnLoan()` primero, después el traspaso definitivo
  normal propietario→cesionario de TRANSFER-1) — nunca un tercer motor de
  ejecución nuevo. Ejercer la opción NUNCA mueve roster ni crea contrato
  por sí solo — solo el consentimiento real del jugador dispara el
  handoff.
- `advanceGameClockTo()` sigue siendo el ÚNICO punto que avanza
  `state.calendar` — el retorno automático de una cesión al alcanzar su
  `returnEffectiveDate` se dispara ahí
  (`processDueLoanReturnsToDate()`), nunca repartido por los call-sites de
  Liga/Copa/Playoffs/Ascenso. Ninguna noticia de cesión se construye
  dentro del dominio de cesión — game.js la publica SOLO tras un commit
  real (`pushLoanNews()`), auditado estáticamente.
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217;
  fechas SIEMPRE civiles ISO vía `LocalDate`, nunca `Date.now()`/reloj de
  sistema dentro del motor de cesiones. El reparto salarial
  propietario/cesionario (`Money.allocateByWeights`) siempre suma EXACTO
  10000 puntos básicos.
- Todo dato simulado de cesión (canon, participación, cláusulas de
  fixture) lleva `dataSource`/`isReal: false` visibles — nunca se presenta
  como un dato real, y `data/real/` no se toca nunca desde este dominio.
- No se ejecuta cesión/subrogación con transfer internacional real ni
  licencia FIBA para la operación (EUROPE-1, hoy solo bloquea, nunca
  concede completado), ni expiración orgánica de contrato/apertura
  orgánica de tanteo (CYCLE-1, sigue bloqueada por el suelo de 3
  temporadas de CONTRACT-1) antes de sus entregas — LOAN-1 se detiene en
  el ámbito doméstico verificable.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura de cesiones o las reglas activas.

## Qué NO hacer sin confirmar con Dennis primero

- No introducir frameworks, librerías de pago, o dependencias pesadas sin
  preguntar.
- No tomar decisiones de diseño de juego (economía, reglas, progresión)
  que no estén ya en `DESIGN.md` — proponerlas y esperar confirmación.
- No borrar ni sobrescribir datos en `data/real/` al generar datos
  ficticios de prueba.
- No reinterpretar las decisiones ya tomadas en "Interfaz de juego" de
  este archivo (selección solo de datos reales, instancias reales de
  Player/Team, dataSource fuera del constructor, revelado progresivo por
  cuartos) sin comentarlo antes con Dennis.
