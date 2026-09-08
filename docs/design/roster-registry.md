# Player Registry y núcleo normativo multi-liga (ROSTER-1)

_Migrado de `DESIGN.md` (líneas 5250-5548 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.16 ROSTER-1 — Estabilización LIFE-4, registro mundial y núcleo normativo multi-liga

Primera entrega de la **EPIC "Ciclo profesional de plantilla"**, que
transformará las plantillas actuales (hoy estáticas) en un ecosistema
profesional europeo vivo: jugadores que existen aunque no pertenezcan a un
club, contratos laborales reales, inscripción por competición, mercado,
traspasos, cesiones y renovación natural de las plantillas a lo largo de
muchas temporadas. Objetivo de producto: **realismo de simulador, no
comportamiento arcade** — una operación de plantilla nunca se reduce a
"pagar una cantidad y mover un jugador".

#### Partes de la EPIC

1. **ROSTER-1** — estabilización de LIFE-4, registro mundial de jugadores
   y núcleo normativo multi-liga (**hecha**, esta sección).
2. **CONTRACT-1** — contrato profesional, vigencia, salario y cláusulas
   (**hecha**, ver 9.17).
3. **REG-1** — inscripción, licencias, elegibilidad, cupos y vinculados
   (**hecha**, ver 9.18).
4. **MARKET-1** — negociación, agentes, libres y derechos preferentes
   (tanteo como procedimiento temporal, no un booleano) (**hecha**, ver
   9.19).
5. **TRANSFER-1** — traspasos, buyouts, rescisión y compensaciones
   (**hecha**, ver 9.20).
6. **LOAN-1** — cesiones, subrogación y vinculación temporal (**hecha**,
   ver 9.21).
7. **CYCLE-1** — ciclo anual: expiración/renovación de contratos, tanteo
   orgánico, retiros, cantera como pool separado y equilibrio acotado de
   población (**hecha**, ver 9.22; el clearinghouse CPU cubre renovación,
   fichaje de libres y cantera — traspasos/cesiones CPU-a-CPU orgánicos
   quedan fuera, ver 9.22 "limitación conocida").
8. **EUROPE-1** — mercado internacional, transfer FIBA (Letter of
   Clearance) y competiciones superpuestas (liga doméstica + Europa).
9. **HARDEN-1** — persistencia/migraciones, simulación larga (10-20
   temporadas), calibración y endurecimiento de invariantes.

Dependencias: ROSTER-1 (identidad global + núcleo de reglas) es
prerrequisito de todo lo demás; CONTRACT-1 y REG-1 son prerrequisito de
MARKET-1/TRANSFER-1/LOAN-1; CYCLE-1 necesita las cinco anteriores (**ya
entregada**); EUROPE-1 necesita REG-1 + CYCLE-1; HARDEN-1 cierra la Epic.
Un contrato no concede
por sí solo una licencia, y una licencia no sustituye al contrato — ambos
conceptos, junto con la afiliación de plantilla y el transfer
internacional, se mantienen deliberadamente separados desde esta entrega
(ver "Conceptos distintos" más abajo).

#### Bugs corregidos de LIFE-4 (PR #37)

- **BUG-LIFE4-01**: fechas de histórico mostradas como hora — corregido
  con `formatHistoryDate()` (ver nota en 9.15).
- **BUG-LIFE4-02**: comentarios de código citando "DESIGN.md 9.4" en vez
  de 9.15 (LIFE-4 quedó numerado 9.15, no 9.4 — ver nota en el propio
  9.15) — auditados y corregidos todos los archivos tocados por LIFE-4.
- **BUG-LIFE4-03**: `findPlayerById()` dependía de que el jugador siguiera
  en `Team.roster` — corregido con el Player Registry (ver más abajo).

#### Player Registry — identidad mundial de jugadores

Un `Player` pertenece al **mundo de la partida**, no a un array concreto.
`Team.roster` sigue siendo la afiliación deportiva ACTUAL de un club, pero
deja de ser el directorio mundial de jugadores: quitar a un jugador de una
plantilla (operación de TRANSFER-1, todavía no implementada — CONTRACT-1 y
MARKET-1 ya existen pero ninguna de las dos toca `Team.roster`) nunca debe
destruirlo ni volverlo ilocalizable.

`src/core/PlayerRegistry.js` (módulo puro, sin conocer Player/Team como
clases) indexa por `player.id` la MISMA instancia viva usada por los
equipos. La partida posee una instancia EXPLÍCITA
(`state.playerRegistry`, construida en `startSeason()`) — nunca un
singleton global oculto; dos partidas o dos tests pueden tener registros
independientes. API: `register`/`registerMany`/`get`/`require`/`has`/
`all`/`forTeam`/`setAffiliation`/`validateAgainstTeams`/`snapshot`.
`forTeam()` es una vista DERIVADA de `all()` (nunca un segundo índice que
pueda desincronizarse). `snapshot()` es mínimo (solo id+teamId) — no es
todavía un sistema de guardado (eso es HARDEN-1).

**Invariantes** (verificados en `scripts/test-roster1.js`/
`scripts/smoke-roster1.js`): cada jugador de cada plantilla aparece
exactamente una vez en el registro; dos plantillas nunca comparten un
`player.id`; `player.teamId` coincide siempre con el equipo en cuyo
roster está; un jugador sin club puede seguir en el registro con
`teamId === null` y no aparece en ningún `Team.roster`; ascender/descender
un club no recrea jugadores; el intake de cantera registra cada newgen
sin colisionar; liberar y reincorporar a un jugador conserva la misma
instancia y su `careerHistory`/`developmentState`/`medicalState`
completos; un id duplicado con otra instancia se rechaza con error
descriptivo; `validateAgainstTeams()` detecta `teamId` incoherente y doble
afiliación. `data/real/` permanece inmutable — el registro se construye
en memoria a partir de instancias ya creadas, nunca reescribiendo los
JSON de origen.

Integración: `startSeason()` construye los 36 equipos (con el puente de
cobertura de datos de Primera FEB, ver más abajo) y registra el universo
completo; `closeSeasonAndPrepareNext()` registra inmediatamente los
newgens de `generateAcademyIntake()`. `Team.addPlayer()`/`removePlayer()`
NO sincronizan el registro por sí solos todavía (acoplaría la entidad a
`game.js`) — la sincronización explícita (`registry.setAffiliation()`)
queda para el futuro servicio/orquestador de fichajes de TRANSFER-1
(MARKET-1, ya hecha, se detiene deliberadamente antes de tocar la
afiliación de plantilla).

#### Núcleo normativo multi-liga

Hoy el juego solo instancia dos competiciones domésticas españolas (ACB y
Primera FEB), identificadas legacy como `1ª`/`2ª`. **Eso es solo el punto
de partida**: en el futuro convivirán muchas ligas, federaciones, países y
competiciones supranacionales, algunas con reglas de contratación,
inscripción y transferencia diferentes, incluso varias normativas
aplicables al mismo club a la vez (liga doméstica + EuroLeague). **Nota
posterior (WORLD-CORE-1, sección 10):** la identidad de esas dos
competiciones (antes una segunda tabla dentro de este mismo archivo) ya
vive en el catálogo mundial canónico (`CompetitionCatalog.js`) — este
archivo (`CompetitionRules.js`) importa esa identidad por referencia y
sigue siendo la única fuente de la NORMATIVA (registro, empleo, mercado,
traspaso, cesión) descrita en el resto de esta sección y en 9.17-9.22, sin
cambios. Por eso:

- `1ª`/`2ª` **no vuelven a usarse como claves de lógica nueva** — quedan
  como compatibilidad/presentación de calendario/ascensos (sin
  reescribirlos en esta entrega). Toda regla NUEVA usa `competitionId`
  (`acb`, `primera-feb`), estable e independiente del nombre visible o del
  orden de división.
- El adaptador de frontera `competitionIdFromLegacyDivision()`
  (`src/core/CompetitionRules.js`) es el ÚNICO punto que traduce
  `1ª`/`2ª` → `competitionId` — lanza explícito ante una división
  desconocida, nunca asume ACB.
- Una competición desconocida o un `bundleId`/versión inexistente generan
  error explícito — **nunca hereda el comportamiento de ACB por
  defecto**.

**Capas de identidad de competición** (`src/core/CompetitionRules.js`):

- `CompetitionDefinition` (catálogo `CompetitionCatalog`): identidad pura
  — id, nombre, país, tier — sin ninguna regla.
- `RuleModule` (catálogo `RuleModuleCatalog`, por ahora solo dominio
  `registration`): una pieza de normativa versionada — versión, temporada
  de vigencia, estado (`verified`/`provisional`/`deprecated`), fuente(s)
  oficial(es) con URL y fecha de consulta, y qué partes de la norma real
  quedan explícitamente `notImplemented` (nunca una regla vacía que
  parezca activa).
- `RulesetBundle` (catálogo `RulesetBundleCatalog`): compone módulos de
  ÁMBITOS DISTINTOS para una competición+temporada —
  `jurisdictionId`/`federationId`/`collectiveAgreementId` (declarados,
  todavía sin `RuleModule` real detrás — CONTRACT-1 los rellenará) +
  `modules.{registration, employment, market, transfer,
  internationalTransfer}` (cada uno `null` hasta que exista el módulo
  real).
- `resolveRules(context)`: punto de entrada único, recibe CONTEXTO
  explícito (`competitionId`, `seasonKey`, `date`, `operation`, `clubId`,
  `playerId`, `overlays`) — nunca lee `state`/variables globales, usable
  igual desde `game.js` que desde tests Node. Devuelve
  `{bundleId, version, effectiveSeason, squadRules, capabilities,
  notImplemented, trace}`.
- **Capacidad ≠ comportamiento** (sección 5.3 del prompt de ROSTER-1): la
  UI podrá consultar `resolved.capabilities.has('matchSquadSizeLimit')`
  para saber qué mostrar, pero la capacidad se DERIVA siempre de qué
  módulo está realmente presente — nunca se mantiene una lista aparte que
  pueda divergir, y nunca aparece "activa" una capacidad sin política real
  detrás.
- **Composición por capas, nunca `Object.assign`/spread "el último
  gana"**: cada tipo de regla tiene su propia estrategia semántica
  (`MERGE_STRATEGIES`) — mínimos concurrentes conservan el MAYOR, máximos
  concurrentes conservan el MENOR. `overlays` (competiciones superpuestas,
  EUROPE-1) se componen así sobre el módulo base; ROSTER-1 no genera
  overlays todavía, pero el mecanismo ya está probado
  (`scripts/test-roster1.js`).
- **Trazabilidad**: `trace.{sourceRuleIds, bundleId, version}` en todo
  resultado — de dónde sale cada decisión, útil para tests y futuros
  tooltips de UI.
- **Versionado temporal** (sección 5.5 del prompt): cada `RuleModule`/
  `RulesetBundle` tiene id estable + versión + temporada de vigencia +
  fuentes oficiales + estado. `resolveRules()` sin `bundleId` explícito
  resuelve el de versión más alta para esa competición — nunca el de otra
  competición. Queda fijado (no implementado todavía) que una carrera
  guardada futura (HARDEN-1) congelará `rulesetBundleId`+versión al
  empezar cada temporada, para que un cambio normativo no altere
  retroactivamente una temporada ya iniciada.
- **Perfil ficticio de test** (`bm-test-fictional-league`, límites 6-9):
  registrado en los mismos catálogos que ACB/FEB — demuestra que añadir
  una liga nueva es dato de catálogo, nunca una rama nueva en `Team.js`/
  `game.js`/UI.

#### Primera vertical real: convocatoria por competición

`Team.buildMatchSquad(playerIds, minOverride, maxOverride)` ya NO decide
qué normativa aplicar — solo valida el rango recibido. `MATCH_SQUAD_MIN`/
`MATCH_SQUAD_MAX` (8/12) quedan como default LEGACY (tests antiguos,
`MatchEngine.js` en modo prueba, `buildMatchSquadExcludingPosition()`),
nunca como fuente para producción multi-liga. `CpuLineup.buildCpuLineup()`
recibe un 5º parámetro opcional `squadRules` (mismo default legacy si se
omite) — la CPU consulta EXACTAMENTE la misma fuente de reglas que el
usuario.

- **ACB**: convocatoria normal **8-12** — fuente: *ACB — Normas Internas
  2025-26*, artículos 15 y 17
  (<https://www.acb.com/docs/descarga/pdf/transparencia/normas_internas_25-26_180825.pdf>,
  consultado 2026-08-24). Cupos de formación (3 con 8-9 inscritos / 4 con
  10-12), máximo 2 extranjeros no comunitarios, máximo acumulado de 20
  inscripciones/temporada y sustituciones de no computables quedan
  declarados `notImplemented` — alcance de REG-1.
- **Primera FEB**: convocatoria normal **10-12** — fuente: *FEB — Bases de
  Competición Primera FEB 2026-27*, apartados 2.2/2.3
  (<https://www.feb.es/Documentos/Enlaces/%5B6537%5DBBCC%20Primera%20FEB%2026-27%20-%20Versi%C3%B3n%20Web.pdf>,
  consultado 2026-08-24). El propio PDF incluye una fila "13-15
  jugadores" en esa tabla que contradice el máximo de 12 fijado en el
  texto inmediatamente anterior — **discrepancia real del documento
  oficial, registrada en `knownSourceInconsistency` del módulo, no
  resuelta por interpretación propia**; se mantiene el máximo inequívoco
  (12) hasta que haya aclaración oficial. Formación, no comunitarios,
  máximo de 20 altas, mínimo de 10 en acta (concepto distinto del rango de
  inscripción) y ventanas de fecha límite quedan `notImplemented` —
  alcance de REG-1.
- **Excepción médica** (LIFE-3, ver corrección en 9.14): el mínimo NORMAL
  ahora lo aporta la competición; el mínimo ABSOLUTO (5) y la reducción
  siguen siendo política médica, combinados en
  `Medical.resolveEffectiveSquadMinimum()`.

**Puente de cobertura de datos (Primera FEB)**: el snapshot del bundle
real de Primera FEB tiene 8 clubes con menos de 10 jugadores cargados
(8-9) — limitación de COBERTURA del dataset, no una lesión, y no autoriza
a bajar el mínimo normativo. `playerGenerator.padRosterToMinimum(roster,
targetMinimum, options)` completa EN MEMORIA (nunca `data/real/`, nunca
más allá del mínimo REAL resuelto por `CompetitionRules`) cada roster
corto con el generador ficticio ya existente. Cada jugador añadido: se
marca `dataSource = 'fictional-fallback-incomplete-roster'`
(`FICTIONAL_FALLBACK_DATA_SOURCE`) y se muestra como tal en la interfaz
(badge "Ficticio (relleno de plantilla)" en la Alineación, nota en la
ficha universal) — nunca como jugador real; es una instancia normal de
`Player`, se inscribe en Player Registry igual que cualquier otro; recibe
histórico `complete` desde su creación (sin pasado inventado, mismo
criterio que la cantera nueva); NO recibe contrato/licencia/vinculado
ficticio (esas entidades no existen todavía); desaparece por sí solo
(deja de generarse) en cuanto el dataset real de ese club alcance el
mínimo, sin cambiar ninguna regla de competición. Un roster de 10
jugadores reales con varias bajas médicas NO activa este puente (se
distingue explícitamente en `scripts/test-roster1.js`) — ese caso es
disponibilidad médica, no cobertura de datos.

#### Conceptos distintos (para las entregas futuras)

Esta entrega fija la separación conceptual que CONTRACT-1/REG-1/
MARKET-1/TRANSFER-1/LOAN-1/EUROPE-1 desarrollarán, para no confundirlos
entre sí desde ahora:

- **Afiliación de plantilla** (`Team.roster`/`player.teamId`, ya
  existente): pertenencia deportiva actual a un club — no implica
  contrato ni licencia.
- **Identidad mundial** (Player Registry, esta entrega): que un jugador
  exista y sea localizable, tenga o no club.
- **Contrato/relación laboral** (CONTRACT-1, todavía no implementado):
  vínculo laboral club-jugador — duración, salario, cláusulas.
- **Licencia/inscripción por competición** (REG-1, todavía no
  implementado): derecho a competir en una competición concreta —
  cupos, acta, formación, extranjeros, vinculados. Un jugador puede estar
  contratado por un club y ser elegible en unas competiciones pero no en
  otras (ej. liga doméstica sí, EuroLeague no, hasta que se resuelva el
  transfer/LOC correspondiente).
- **Transfer internacional/Letter of Clearance** (EUROPE-1, todavía no
  implementado): movimiento entre federaciones — requiere LOC; un
  movimiento doméstico no.

Ninguna de estas cinco entidades sustituye a otra: un contrato no concede
licencia, una licencia no sustituye al contrato.

#### Fuentes consultadas ya estudiadas para entregas futuras (anexo)

No implementadas todavía — registradas aquí para no repetir la
investigación quando toque cada entrega:

- *Real Decreto 1006/1985* (relación laboral especial de deportistas
  profesionales) — base de CONTRACT-1/LOAN-1.
- *Convenio colectivo ACB–ABP* (BOE-A-2021-4226) — contrato tipo, mínimos
  y tanteo — base de CONTRACT-1/MARKET-1 (ambas ya implementadas: ver
  9.17/9.19; la parte de tanteo quedó codificada como módulo `provisional`
  en `CompetitionRules.js`, sección 9.19).
- *ACB — procedimiento operativo de tanteo* — evidencia de estados/plazos
  reales — base de MARKET-1 (ya implementada, ver 9.19).
- *FIBA Internal Regulations, Book 3* (Players and Officials) — LOC,
  federación de licencia, agentes — base de EUROPE-1.
- *EuroLeague Players Association — Standard Player Contract* —
  referencia de estructura contractual europea — base de CONTRACT-1 (no
  sustituye la ley nacional).
- *LNB Francia — reglamentación 2025-26* — prueba de arquitectura (otras
  ligas admiten cláusulas/límites distintos) — no implementado, no
  extrapolado a España.
- *FEB — Reglamento General y de Competiciones* — definiciones
  federativas, licencias, formación y vinculaciones — base de REG-1/
  LOAN-1.

#### Fuera de alcance de ROSTER-1

Entidad `Contract`/salarios, negociación jugador/agente, derecho de
tanteo/ofertas cualificadas, licencias completas/cupos de formación o no
comunitarios/máximo de 20 altas, transfer fees/buyouts/rescisiones,
cesiones, Letter of Clearance, ligas extranjeras reales, retiros/IA de
mercado, reducción del intake de cantera, UI de mercado/contratos,
save/load nuevo. Siguiente entrega: **CONTRACT-1** (ver 9.17, ya
entregada; corrigió además BUG-ROSTER1-01/02/03 de esta sección).
