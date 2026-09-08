# Ficha de Epic — CAL-1 y CAL-2 (calendario vivo, Agenda y Noticias)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `CAL-1-CAL-2`
- **Estado**: cerrada (histórica)
- **Objetivo**: Calendario vivo y avance temporal (CAL-1); Agenda, Noticias y Home vivo definitivo (CAL-2).
- **Documento(s) canónico(s) vigente(s)**: `docs/design/competitions-spain.md`, `docs/design/events-agenda-news.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 7574-7907 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-22 (2) — CAL-1: calendario vivo y avance temporal (DESIGN.md 3.3)

Primera de dos entregas de una fase corta de UX+tiempo, antes de "STEP 3"
(Jugador Vivo/Progresión/Entrenamiento/Lesiones, sesión de diseño aparte
todavía sin hacer — no se ha adelantado ninguna mecánica suya aquí). El
objetivo: que el calendario deje de ser "jornada = bloque atómico que se
resuelve entero de golpe" y pase a ser "el tiempo avanza cronológicamente,
evento a evento, y los partidos CPU se resuelven cuando les toca su horario
real". Evoluciona `Calendar.js`/`League.js` existentes — no se crea ninguna
segunda infraestructura temporal paralela.

### 1. `Calendar.js` — fecha+hora real por partido (DESIGN.md 3.3.1)

- Sustituida la decisión anterior ("el motor no modela horarios distintos
  por partido, solo fecha") por horario real POR PARTIDO —
  `leagueMatchDateTime(round, matchIndexInRound, matchesInRound,
  totalRounds, division)`, nuevo.
- `scheduleProfile` nuevo en `config.calendar.scheduleProfiles` (por
  división, `MatchConfig.js`): franjas de fin de semana ponderadas
  (`weekendSlots`), franja entre semana (`midweek`, 1 de cada 8 jornadas,
  nunca en jornada 1/última/17/18) y horario único de última jornada
  (`lastRoundSlot`). El algoritmo de `Calendar.js` no tiene ninguna
  franja/hora hardcodeada — todo sale del perfil, pensado para poder añadir
  Europa/Supercopa sin tocar el algoritmo.
- Slot elegido con hash determinista (FNV-1a) ponderado por `weight` —
  reproducible (misma temporada = mismo calendario siempre), sin
  `Math.random()`.
- Jornada 34: mismo horario para TODOS los partidos de la división
  (regla dura, sin excepción) — nadie puede conocer resultados con
  implicaciones clasificatorias antes de terminar su propio partido.
- Copa/Playoffs/Ascenso: horario real vía `config.calendar.
  knockoutKickoff` (un único horario de prime time). Limitación de
  alcance señalada explícitamente: `Bracket.js` no expone a su
  `dateResolver` qué Series concreta pide la fecha, así que no hay
  variedad horaria ENTRE series simultáneas de una misma ronda sin tocar
  `Bracket.js` (fuera de la lista de archivos a tocar en esta entrega).
- Reloj de mundo (`calendar.currentGameDateTime` + `calendar.
  advanceTo(dateTime)`, protegido contra retrocesos) — vive en `Calendar`,
  no en `state` de `game.js` (justificación completa en DESIGN.md 3.3.5:
  ya es la entidad que conoce el eje temporal compartido por las dos
  divisiones).

### 2. `League.js` — resolución cronológica y parcial de jornada (DESIGN.md 3.3.6)

- `resolveMatch(match, config, resolveMatchOptions)`: resuelve UN partido
  pendiente concreto (mismo patrón que `Bracket/Series.playNextGame()`).
  Avanza `currentRound` en cuanto la jornada que señala queda completa
  (`advanceCurrentRoundPointer()`, nuevo).
- `getPendingMatchesBefore(beforeDateTime)` / `resolveMatchesBefore(...)`:
  consulta/resuelve en orden cronológico todo lo pendiente anterior a un
  instante — la pieza que usa el reloj de mundo para "saltar" partidos
  CPU-CPU sin resolver la jornada entera de golpe.
- `simulateNextRound()` se conserva como **wrapper de compatibilidad**:
  mismo nombre/firma/contrato desde fuera, por dentro delega en
  `resolveMatch` sobre lo que siga `'pending'`. Lo siguen usando tal cual
  `simulateBackgroundRound()` (división de fondo, sin cambios de
  comportamiento) y el camino defensivo de "jornada sin partido para el
  usuario" en `game.js`.
- `createMatch`/`generateSchedule`: firma del `dateResolver` ampliada a
  `(round, matchIndexInRound, matchesInRound, totalRounds)` — contrato
  interno entre `League.js` y quien construye la Liga (`game.js`), no una
  API pública documentada en otro sitio, así que ampliarla no rompe nada
  externo (`scripts/import-real-data.js` sigue llamando `new
  League(teams)` sin `dateResolver`, sin cambios).

### 3. `game.js` — orquestación invertida + botón "Continuar"

- **Cambio de orquestación central**: antes, `startUserLeagueMatch()`
  jugaba el partido del usuario SIEMPRE primero y resolvía el resto de la
  jornada después. Ahora es al revés — `resolvePreUserMatches()` (nuevo)
  resuelve, vía `League.resolveMatchesBefore()`, todos los partidos de la
  jornada (su propia liga) con fecha anterior a la del usuario ANTES de
  arrancar el motor pausable de TAC-5 sobre el suyo. Los partidos
  posteriores de la misma jornada se resuelven después, al terminar el
  suyo (`finishUserLeagueMatch()`, mismo `simulateNextRound()` de
  siempre sobre lo que quede).
- Botón principal de Home renombrado de "Jugar siguiente jornada"/"Jugar
  siguiente partido" a **"Continuar"** — mismo botón, mismo flujo
  (liga/bracket unificados como ya hacía `playNextMatchWithLineup()`),
  título coherente con lo que hace de verdad ahora. Con 18 equipos por
  división el round-robin no genera byes, así que en la práctica
  "Continuar" resuelve como mucho una jornada por click antes de parar —
  no hizo falta un bucle de "saltar varias jornadas".
- Mecanismo genérico `requiresAttention` (`buildUserMatchStopEvent()`,
  nuevo): representación mínima de un punto de parada obligatoria — hoy
  solo lo produce el partido del usuario, dejado como gancho explícito
  para que CAL-2 pueda ampliarlo a un catálogo de eventos real sin
  rehacerlo.
- Home: reloj de mundo visible (`.home-clock`, `game.css` nuevo) y
  próximo partido del usuario con horario real
  (`findNextPendingMatchForTeam()`, nuevo — busca cronológicamente en
  todo el calendario, no solo en la jornada actual). Pantalla Calendario:
  columna "Hora" nueva junto a la de fecha.
- `finishRoundBookkeeping()` reestructurada para distinguir partidos
  "recién resueltos en esta llamada" (recuperación de Energía/reloj de
  mundo se aplican solo a estos, nunca dos veces) de "la jornada
  completa" (lo que ve Home en "Última jornada" y de donde se busca el
  partido del usuario) — antes de CAL-1 ambos conjuntos coincidían
  siempre, ahora no necesariamente.

### 4. Recovery — decisión tomada, sin tocar `Recovery.js` (DESIGN.md 3.3.7)

Se mantiene el cálculo en **días enteros** (`Math.round`, sin cambios de
fórmula): las eliminatorias usan un único horario fijo por ronda (sin
resto de horas que distorsione un redondeo a día completo entre
partidos separados por solo 2-3 días) y en liga regular un mismo equipo
juega una sola vez por jornada, así que la variedad horaria solo afecta a
gaps de 7±3 días entre jornadas, donde unas horas de diferencia son
despreciables. Decisión documentada en DESIGN.md, no un descuido.

`Player.toJSON()` SÍ se corrigió: `dynamicState.lastMatchDate` ahora
lleva hora real con significado (antes se truncaba a solo fecha al
serializar, "consistencia de guardado" — habría destruido esa hora en
cualquier guardado/carga futuro); se serializa como ISO completo.
`birthDate` (sin significado horario) sigue truncado a solo fecha.

### 5. Verificación (scripts de scratchpad de sesión, no en el repo)

- **Node**: 34 jornadas × 9 partidos generadas sin partidos perdidos ni
  duplicados; todas las fechas válidas; variedad real de franjas dentro
  de una jornada normal; jornada 34 con un único instante para toda la
  división; jornadas entre semana presentes (miércoles) en la temporada
  generada; escenario controlado de cronología (A/B antes del usuario, C
  después) — `resolveMatchesBefore` resuelve exactamente A y B, el
  partido del usuario y C quedan pendientes, la clasificación parcial
  solo cuenta lo ya jugado, la jornada no avanza hasta que se completa el
  último partido pendiente; reloj de mundo arranca en el inicio de
  temporada y `advanceTo` nunca retrocede; 2ª división admite la misma
  resolución cronológica parcial; `Recovery.computeRecoveredEnergy` sigue
  operando en días enteros sin tocar la fórmula; temporada completa (306
  partidos, 18 equipos en la clasificación final) sin errores. Integración
  completa Liga+Copa+Playoff por el título+Playoff de ascenso con
  `Calendar`/`buildBracketDateResolver` reales, sin errores, con horario
  real (`knockoutKickoff`) en las fechas de bracket.
- **Playwright** (landing → Empezar temporada → equipo real → convocar 10
  jugadores + 5 titulares con minutos válidos en Alineación → Inicio):
  reloj de mundo visible en Home desde el arranque ("sáb 3 oct, 00:00");
  botón principal dice "Continuar"; al pulsarlo se detiene correctamente
  en la pantalla de partido del usuario (nunca se simula automáticamente);
  tras terminar el partido y volver a Inicio el reloj de mundo avanzó a un
  instante posterior con hora real ("dom 4 oct, 19:00"); pantalla
  Calendario muestra la columna "Hora" nueva; cero errores de consola
  nuevos (descartada solo la Google Font externa sin salida de red de
  este entorno).

### Pendiente explícitamente fuera de esta entrega

- No hay CAL-3 de este bloque salvo lo ya anunciado: la siguiente entrega
  (CAL-2) construye Agenda/Noticias/Home definitivo sobre esta misma
  infraestructura temporal — no se adelanta nada de esas pantallas aquí.
- Ningún catálogo de eventos de parada obligatoria más allá del partido
  del usuario — `requiresAttention` es un mecanismo genérico, no un
  catálogo de casos de uso reales todavía.
- Ninguna mecánica de STEP 3 (entrenamiento, lesiones, progresión,
  mercado, contratos, directiva) — sesión de diseño aparte, sin diseñar.
- Variedad horaria entre series simultáneas de una misma ronda de bracket
  — limitación real de `Bracket.js` (no expone qué Series pide la fecha),
  señalada explícitamente, no un olvido.
- Controles secundarios de "Continuar 1 día/3 días/1 semana" — estudiados
  en el diseño, no implementados (no hacían falta con 18 equipos sin
  byes; un "Continuar" sólido bastó).
- `Rotation.js`, `CpuLineup.js`, `Bracket.js`, `Cup.js`, `Playoffs.js`,
  `Promotion.js`, `SeasonGoals.js` no se han tocado.

## 2026-08-22 (3) — CAL-2: Agenda, Noticias y Home vivo definitivo (DESIGN.md 3.5)

Segunda y última entrega del bloque temporal abierto por CAL-1. Construye,
sobre el reloj de mundo y la resolución cronológica ya existentes, un
modelo de evento único y dos pantallas nuevas (Agenda, Noticias), y deja
Home en su versión definitiva de este bloque. **No hay CAL-3** — el
bloque termina aquí; "STEP 3" (Jugador Vivo/Progresión/Entrenamiento/
Lesiones) sigue siendo una sesión de diseño aparte, sin diseñar.

### 1. `src/core/Events.js` (nuevo) — modelo de evento único

- Módulo puro: no conoce `state`/`BasketManager`/el DOM, solo construye
  objetos `{ id, type, dateTime, title, relatedCompetition, relatedTeam,
  relatedPlayer, requiresAttention, status, newsCategory, priority, body }`
  a partir de datos reales que le pasa `game.js`.
- `type`: `'match' | 'competition' | 'news'` (catálogo abierto). Reservado
  y documentado, NUNCA generado: `training`/`medical`/`scouting`/
  `market`/`contract`/`board` (STEP 3). Desviación deliberada de la forma
  orientativa del prompt (que sugería un `type` por competición): aquí
  `type` es la naturaleza del evento, `relatedCompetition` dice de qué
  competición — evita una explosión de tipos que se comportan igual.
- Builders: `buildMatchAgendaEvent`, `buildResultNewsEvent`,
  `buildBigPerformanceNewsEvents`, `detectStreak`/`buildStreakNewsEvent`,
  `buildStandingsNewsEvents`, `buildUpsetNewsEvent` (sorpresas, por
  reputación deportiva + posición en tabla, ambos datos reales),
  `buildChampionNewsEvent`, `buildEliminationNewsEvent`,
  `buildBracketRoundReachedNewsEvent`, `buildBracketCreatedNewsEvent`,
  `buildPromotionRelegationNewsEvents`, `buildTacticalTrendNewsEvent`.
- **NO implementado, señalado explícitamente**: noticias de "hitos"
  (récords de carrera) — no existe histórico real de estadísticas
  acumuladas por jugador entre partidos/temporadas en el proyecto
  (`Player.js` no lo guarda), inventarlo sería narrativa, no un hecho
  real.
- `config.news` nuevo en `MatchConfig.js` (`bigPerformanceMinValoracion`,
  `minStreakLength`, `upsetReputationGapMin`/`upsetStandingsGapMin`). La
  noticia táctica reutiliza LITERALMENTE `config.tactics.telemetry.
  minReliablePossessions` — nunca un segundo umbral propio.

### 2. Fuente única: Agenda deriva, Noticias registra

- **Agenda** deriva sus eventos de tipo `match`/`competition` BAJO
  DEMANDA en cada render, de `league.schedule`/brackets — siempre
  reconstruibles sin pérdida a partir del estado real, no hace falta
  guardarlos.
- **Noticias** se registra INCREMENTALMENTE en `state.newsLog` (nuevo),
  justo en el instante real en que ocurre cada hecho — necesario porque
  clasificación/rachas comparan un "antes"/"después" que solo existe en
  ese instante (`League.js` muta sus `standing` in situ, sin histórico por
  jornada). `pushNews()`/`captureStandingsSnapshot()`/`normalizeBracketGame()`/
  `pushLeagueMatchNews()` (nuevos, `game.js`) son las únicas utilidades de
  encaje — esta última compartida entre `resolvePreUserMatches()` (los
  partidos de la jornada anteriores al del usuario, CAL-1) y
  `finishRoundBookkeeping()` (el resto), para que TODOS los partidos de
  liga generen su noticia de resultado/actuación/sorpresa, no solo los
  que se resuelven después del partido del usuario.
- Puntos de resolución reales que ahora generan noticia (todos ya
  existentes, ninguno nuevo): `finishRoundBookkeeping()` (resultado,
  actuación, sorpresa, racha, clasificación — SOLO división visible),
  `createBracketsIfDue()` (Copa creada), `playBracketGameWithReveal()`
  (resultado/actuación de bracket + campeón/eliminación de Copa y Playoff
  por el título), `closeSeasonAndPrepareNext()` (ascenso/descenso),
  `startUserLeagueMatch()` (noticia táctica ocasional sobre el próximo
  rival, vía `pushTacticalTrendNewsIfAny()`, nuevo).
- Decisiones de alcance para no generar ruido ("NO NEWS FLUFF"):
  streak/standings solo para el equipo del usuario; competición
  (campeón/eliminación) solo Copa/Playoff por el título (el Playoff de
  ascenso ya tiene su propia noticia de ascenso, generar las dos duplicaría
  el mismo hecho); ninguna noticia de la división de fondo.

### 3. Pantalla Agenda (`renderAgendaScreen()`, nueva)

- Formato **timeline vertical por día**, no calendario mensual en
  cuadrícula — justificado por móvil (CLAUDE.md): una cuadrícula de mes da
  celdas diminutas y touch targets pequeños, una lista vertical se lee y
  se toca bien en pantalla estrecha.
- Ventana: 3 días atrás + 10 adelante desde `state.agendaAnchorDate`
  (`null` = reloj de mundo actual, siempre vuelve a "Hoy" al reabrirse).
  Navegación "Antes"/"Después" (±7 días) / "Hoy".
- Contenido: partidos de liga SOLO del equipo del usuario (la liga
  completa ya tiene su propia pantalla, Calendario — no es un
  renombrado, decisión explícita) + todos los partidos de Copa/Playoff/
  Ascenso de la división visible (jugados, y el siguiente pendiente de
  cada serie sin decidir, con fecha real "espiada" vía
  `series.dateResolver` sin jugarlo, sin tocar `Bracket.js`) + eventos de
  `state.newsLog` del rango (misma fuente que Noticias).
- El próximo partido del usuario lleva `requiresAttention: true` y una
  insignia visual ("Tu partido").

### 4. Pantalla Noticias (`renderNewsScreen()`, nueva)

- Feed completo de `state.newsLog`, más reciente primero. Cada tarjeta
  muestra categoría, prioridad (borde de color) y fecha/hora reales.
- Prioridad calculada en el momento de construir cada evento (nunca
  recalculada por la interfaz): alta (implica al equipo del usuario con
  peso real), media (terceros con peso — actuación propia de un jugador
  cuenta como media, no alta), baja (el resto, incluida siempre la
  noticia táctica).

### 5. Home vivo definitivo

- "Última jornada" (CAL-1) sustituida por **"Noticias destacadas"**
  (prioridad alta, máximo 3) + accesos directos a Agenda y Noticias.
  Decisión documentada: los resultados ya aparecen como noticia de
  resultado, mantener las dos tarjetas duplicaba la misma información en
  dos formatos. `renderMatchList()` (ya sin ningún uso) eliminada.
- Resto de Home (reloj de mundo, tarjeta principal, "Continuar") sin
  cambios respecto a CAL-1.

### 6. Verificación (scripts de scratchpad de sesión, no en el repo)

- **Node** (`Events.js` en aislamiento, sin cargar toda la pila de BM):
  cada noticia generada en un escenario controlado reproduce el dato REAL
  del hecho (marcador, nombre/puntos de boxScore) — nunca inventado; sin
  diferencia real de reputación/clasificación, `buildUpsetNewsEvent`
  devuelve `null` (no fabrica una sorpresa); umbral de muestra táctica
  verificado como el MISMO campo de config que TAC-7 (por debajo no
  genera, en el umbral sí, siempre prioridad baja); un caso dirigido de
  cada nivel de prioridad (alta: ascenso propio; media: actuación propia;
  baja: resultado/actuación ajenos) con el evento real que lo justifica;
  Agenda y Noticias consultadas sobre el mismo partido citan literalmente
  el mismo resultado y la misma fecha (mismo objeto `match`); regresión de
  CAL-1 (League sigue generando 9 partidos/jornada, el reloj de mundo solo
  avanza cuando `game.js` llama a `advanceTo()` explícitamente, `Events.js`
  no lo toca por su cuenta).
- **Playwright** (viewport móvil 390×844, sin servidor): landing →
  Empezar temporada → equipo real → convocar 10 jugadores + 5 titulares
  con minutos válidos → Inicio enlaza correctamente a Agenda y Noticias;
  navegación "Después" en Agenda cambia el contenido mostrado; tras jugar
  2 jornadas reales con "Continuar" se generan noticias (43) y eventos de
  Agenda (22) reales, no vacíos; cero errores de consola nuevos
  (descartada solo la Google Font externa sin salida de red de este
  entorno).

### Resumen de cierre del bloque CAL-1 + CAL-2 (calendario vivo)

- **CAL-1**: `Calendar.js` con fecha+hora real por partido
  (`scheduleProfile`, jornada 34 unificada, horario real en Copa/
  Playoffs/Ascenso); `League.js` con resolución cronológica/parcial de
  jornada (`resolveMatch`/`resolveMatchesBefore`, `simulateNextRound`
  como wrapper de compatibilidad); reloj de mundo en `Calendar`; botón
  "Continuar" con parada obligatoria antes del partido del usuario;
  orquestación invertida (lo anterior de la jornada se resuelve antes que
  el partido del usuario, no después); Recovery.js mantenido en días
  enteros (decisión documentada, sin tocar la fórmula);
  `Player.toJSON()` ya no trunca `lastMatchDate` a solo fecha.
- **CAL-2**: modelo de evento único (`Events.js`) consumido por Agenda
  (derivada bajo demanda) y Noticias (registrada incrementalmente en
  `state.newsLog`); catálogo de noticias con fuente real auditada
  (resultado, actuación, racha, clasificación, sorpresa, competición,
  táctica) y prioridad alta/media/baja; Home definitivo con resumen de
  noticias destacadas y accesos directos.
- **No hay CAL-3.** STEP 3 (Jugador Vivo/Progresión/Entrenamiento/
  Lesiones) es una sesión de diseño completamente aparte, todavía sin
  diseñar — ninguna mecánica suya se ha adelantado en ninguna de las dos
  entregas; los tipos de evento reservados en `Events.js` son solo
  catálogo, no implementación.

### Pendiente explícitamente fuera de esta entrega

- Noticias de "hitos" de carrera — sin histórico real de estadísticas
  acumuladas por jugador que las sostenga.
- Noticias/eventos de Agenda de la división de fondo — ruido de baja
  relevancia para el usuario, decisión de alcance documentada.
- Campeón/eliminación del Playoff de ascenso como noticia propia — ya
  cubierto por la noticia de ascenso al cerrar temporada.
- Variedad horaria entre series simultáneas de bracket en Agenda —
  limitación heredada de `Bracket.js`, ya señalada en CAL-1.
- `Rotation.js`, `CpuLineup.js`, `Bracket.js`, `Cup.js`, `Playoffs.js`,
  `Promotion.js`, `SeasonGoals.js`, `Player.js` (salvo el fix de
  `toJSON()` en CAL-1) no se han tocado.
