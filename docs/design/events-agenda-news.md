# Agenda, eventos y noticias (CAL-2)

_Migrado de `DESIGN.md` (líneas 759-1001 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 3.5 Modelo de evento, Agenda y Noticias (CAL-2)

Segunda y última entrega del bloque temporal abierto por CAL-1 (calendario
vivo). Construye, sobre el reloj de mundo y la resolución cronológica de
CAL-1 (3.3.5/3.3.6), dos pantallas nuevas — Agenda y Noticias — y la
versión definitiva de Home. **No hay CAL-3**: el bloque temporal termina
aquí (ver nota de cierre al final de esta sección).

#### 3.5.1 Modelo de evento

Shape final (`src/core/Events.js`, módulo puro — no conoce `state` ni el
DOM, solo construye objetos a partir de datos reales que le pasa
`game.js`):

```js
{
  id, type,               // 'match' | 'competition' | 'news' (catálogo abierto)
  dateTime, title,
  relatedCompetition,     // 'league' | 'cup' | 'playoff' | 'promotion' | null
  relatedTeam, relatedPlayer,
  requiresAttention,      // boolean — mecanismo genérico de CAL-1 (3.3.6)
  status,                 // 'pending' | 'resolved'
  // Solo si type === 'news':
  newsCategory, priority, body,
}
```

Desviación deliberada de la forma orientativa del prompt de esta sesión
(que sugería `type: 'match' | 'cup' | 'playoff' | ...`, un tipo distinto
por competición): aquí `type` distingue solo la NATURALEZA del evento
(partido / hito de competición / noticia), y `relatedCompetition` dice DE
QUÉ competición — evita una explosión de tipos que en la práctica se
comportan igual (un partido de Copa y uno de Liga son ambos "un partido
con fecha, equipos y resultado").

**Catálogo de `type` implementados hoy**: `match`, `competition`, `news`.
**Reservados, documentados pero NUNCA generados en esta entrega** (STEP 3
— Jugador Vivo/Progresión/Entrenamiento/Lesiones, sesión de diseño aparte
todavía sin hacer): `training`, `medical`, `scouting`, `market`,
`contract`, `board`.

**Mecanismo `requiresAttention`**: CAL-1 ya lo dejó como un booleano suelto
en un objeto ad-hoc (`buildUserMatchStopEvent()`, game.js) sin una entidad
de evento real detrás — no existía todavía un catálogo con el que
integrarlo. CAL-2 no lo cambia de comportamiento (sigue siendo el
mecanismo de parada obligatoria de "Continuar", ver 3.3.6): lo que hace es
darle un hogar dentro del modelo de evento ya construido (el evento de
Agenda del próximo partido del usuario lleva `requiresAttention: true`),
sin tocar la lógica de parada de CAL-1.

**Fuente única, no negociable**: Agenda y Noticias leen exactamente los
mismos datos subyacentes.
- Los eventos de tipo `match`/`competition` de Agenda se **derivan bajo
  demanda** de `league.schedule`/brackets en cada render — son siempre
  reconstruibles sin pérdida a partir del estado real ya existente, así
  que no hace falta guardarlos aparte.
- Los eventos de tipo `news` se **registran incrementalmente** en
  `state.newsLog` (array único, consumido tanto por la pantalla Noticias
  como por Agenda, que los incorpora literalmente al construir su
  timeline) justo en el instante real en que ocurre el hecho que los
  sostiene — necesario porque varias categorías (clasificación, rachas)
  comparan un "antes" y un "después" que solo existen en ese instante
  (`League.js` muta sus `standing` in situ, no guarda histórico por
  jornada).
- Ambos casos leen del MISMO objeto real subyacente (el `match`/`result`
  de `MatchEngine`, el `team` real): una noticia de resultado y el evento
  de Agenda del mismo partido citan literalmente `match.result.
  finalScore`, nunca dos números calculados por caminos distintos.

#### 3.5.2 Noticias — catálogo, fuente real y prioridad

**Regla absoluta**: toda noticia deriva de un hecho real ya existente en
el estado de la partida — ninguna se genera para "rellenar" el feed.
Arquitectura fija: primero ocurre el hecho (partido resuelto, clasificación
recalculada, bracket completado...) → después se construye el evento con
una plantilla que solo interpola datos de ese hecho.

| Categoría (`newsCategory`) | Fuente real | Dónde se dispara |
|---|---|---|
| `result` | `match.result.finalScore` (cualquier competición) | Tras resolver cada partido de la división visible |
| `performance` | `result.boxScore.home/away[].valoracion` (MatchEngine) | Igual, filtrado por `config.news.bigPerformanceMinValoracion` |
| `streak` | `league.schedule` ya jugado (resultados consecutivos reales del equipo del usuario) | Tras cada jornada del usuario |
| `standings` | `league.getStandingsTable()` antes/después de la jornada | Tras cada jornada del usuario |
| `surprise` (sorpresas) | `team.reputation.sporting` + posición en tabla ANTES del partido (ambos reales, 6.2.1/3.1) | Tras cada partido de la división visible |
| `competition` | `Cup.createCup`/`Bracket.champion`/`Series.loser`/`Bracket.rounds.length`/resumen de ascenso-descenso de `closeSeasonAndPrepareNext()` | Creación de Copa, campeón, eliminación propia, nueva ronda, ascenso/descenso |
| `tactical` | `Tactics.summarizeTacticsTelemetry()` (TAC-7), umbral `config.tactics.telemetry.minReliablePossessions` — **el mismo campo que ya usa `smallSampleBadgeHtml`/`renderTacticsRivalTab`, nunca un segundo umbral propio** | Justo antes de cada partido de liga del usuario, sobre la cobertura de P&R con peor `pppAllowed` del próximo rival |

**No implementado en CAL-2, señalado explícitamente** (DESIGN.md pedía no
implementar sin dato real de soporte):
- **Hitos** (récords de carrera de un jugador): en CAL-2 no existía
  ningún histórico de estadísticas acumuladas por jugador entre
  partidos/temporadas en el proyecto (`Player.js` no guardaba puntos/
  rebotes de carrera, solo `experience`, un contador sin desglose) —
  inventar un "récord superado" sin ese dato habría sido narrativa, no
  un hecho real. **Cerrado por LIFE-4** (sección 9.15): `PlayerCareer.js`
  construye ese histórico real, y `newsCategory:'career'` (`Events.js`)
  redacta la noticia SOLO a partir de un milestone/récord que
  `PlayerCareer.recordResolvedMatch()` ya detectó como hecho real.

**Alcance deliberadamente reducido de algunas categorías** (evitar ruido,
"NO NEWS FLUFF"):
- `streak`/`standings` solo se calculan para el equipo del usuario, no
  para los 17 rivales de su liga — evita un feed dominado por rachas/
  cambios de posición ajenos de bajo interés real.
- `competition` (campeón/eliminación) solo se genera para Copa y Playoff
  por el título — el Playoff de ascenso no genera su propio "campeón"/
  "eliminado" porque el hecho relevante (quién asciende) ya lo cubre la
  noticia de ascenso al cerrar temporada; generar las dos sería duplicar
  el mismo hecho con dos redacciones.
- Ninguna noticia se genera para la división de fondo (la que el usuario
  no tiene abierta, DESIGN.md 3.4.1) — es información que el usuario ni
  siquiera está mirando; Agenda tampoco muestra sus partidos individuales
  (si en el futuro se necesita, es una ampliación de alcance, no un bug).
- Variedad horaria entre series simultáneas de bracket sigue sin existir
  (limitación de `Bracket.js` ya señalada en 3.3.1) — no afecta a
  Noticias, solo a que dos partidos de la misma ronda compartan hora si
  Agenda los muestra el mismo día.

**Prioridad** (`alta`/`media`/`baja`, calculada por cada builder de
`Events.js` en el momento de construir el evento, nunca recalculada por
la interfaz):
- **Alta**: cualquier hecho que involucra directamente al equipo del
  usuario con implicación real — resultado propio, entrada/salida de
  puestos de cabeza o de descenso, nuevo líder si es el usuario, racha
  propia, campeón/eliminación propia, ascenso/descenso propio, sorpresa
  protagonizada por el usuario.
- **Media**: hechos de terceros con algo de peso — nuevo líder ajeno,
  actuación destacada de un jugador del propio equipo, ascenso/descenso
  ajeno, campeón ajeno de Copa/Playoff, sorpresa ajena.
- **Baja**: el resto — resultados/actuaciones/rachas ajenas, nueva ronda
  de competición alcanzada, la noticia táctica ocasional (nunca sube de
  prioridad, por diseño explícito de 4.2 del prompt de esta sesión).

Home muestra solo las de prioridad `alta` (máximo 3, más recientes
primero); la pantalla Noticias contiene el feed completo, más reciente
primero.

#### 3.5.3 Agenda

Formato elegido: **timeline vertical agrupada por día** (no un calendario
mensual en cuadrícula). Justificación: el usuario juega principalmente
desde móvil (CLAUDE.md), donde una cuadrícula de mes obliga a celdas
diminutas y touch targets pequeños; una lista vertical de días con sus
eventos se lee y se toca bien en una pantalla estrecha, y es el patrón que
ya usan la mayoría de agendas de referencia en móvil.

- Ventana visible: 3 días hacia atrás + 10 hacia delante desde una fecha
  ancla (`state.agendaAnchorDate`, `null` = el reloj de mundo actual —
  Agenda siempre vuelve a "Hoy" al reabrirse tras avanzar con Continuar,
  no se queda anclada donde se dejó la vista la última vez).
- Navegación: "Antes"/"Después" desplazan la ventana una semana;
  "Hoy" vuelve al reloj de mundo actual.
- El día de hoy (reloj de mundo) se resalta visualmente; el próximo
  partido del usuario lleva la insignia "Tu partido" (`requiresAttention`).
- Contenido (**reescrito en WORLD-CALENDAR-1**, ver 10.14): Agenda es una
  **PROYECCIÓN de la cronología mundial**, no un recorrido de mapas fijos
  por división. Muestra los partidos del equipo del usuario de **TODAS sus
  competiciones** (pendientes y jugados, con nombre de competición/fase
  reales), los **eventos futuros de mercado/traspaso/cesión** relevantes a
  su club leídos de la MISMA cola, el `marketAgendaLog` histórico y todos
  los eventos de tipo `news`/`medical` del rango (misma fuente que
  Noticias, ver 3.5.1) — sin duplicados.
  Hasta esta entrega el contenido se derivaba de `league.schedule` de la
  división visible más `state.brackets[state.division]`, y la proyección
  del siguiente partido de una serie usaba `series.dateResolver`, un campo
  que la vista legacy de `Bracket` nunca ha expuesto: esa rama estaba
  muerta. Además `buildAgendaEvents()` no leía ni los eventos programados
  de mercado ni `marketAgendaLog`, pese a que el comentario de
  `pushMarketAgenda()` afirmaba lo contrario (`BUG-WORLDCALENDAR-04`).

#### 3.5.4 `renderCalendarScreen()` y Agenda son pantallas distintas

No se ha fusionado ni renombrado `renderCalendarScreen()` (ya existente
desde antes de CAL-1/CAL-2). Responden preguntas distintas: Calendario
es "¿cuándo juego?" (lista simple jornada/fecha/hora/sede/rival/resultado
del equipo del usuario, con la columna de hora añadida en CAL-1); Agenda
es "¿qué está pasando en mi vida de manager?" (timeline con partidos,
competición y noticias). Ambas pueden convivir; sí comparten
`formatMatchDate()`/`formatMatchTime()`/`formatMatchDateTime()`, sin
necesidad de duplicar ese formato.

#### 3.5.5 Home vivo — versión definitiva de este bloque

Sobre lo que CAL-1 dejó (reloj de mundo visible, botón "Continuar", parada
obligatoria antes del partido de usuario), esta entrega:

- Sustituye la tarjeta "Última jornada" (CAL-1) por **"Noticias
  destacadas"** (las de prioridad alta, máximo 3) + accesos directos a
  Agenda y Noticias. Decisión documentada: los resultados de la última
  jornada ya aparecen como noticia de resultado (siempre alta prioridad si
  el usuario está involucrado), así que mantener las dos tarjetas
  duplicaba la misma información en dos formatos — se simplificó a una
  sola fuente de verdad visual en Home. `state.lastRoundMatches` se sigue
  guardando (sin coste, lo usaba solo esa tarjeta) por si una pantalla
  futura lo necesita, pero ya no tiene su propia tarjeta.
- El resto de Home (reloj de mundo, tarjeta principal de jornada/bracket/
  cierre de temporada, botón "Continuar") no cambia respecto a CAL-1.

#### Nota de cierre del bloque temporal (CAL-1 + CAL-2)

**No hay CAL-3.** El bloque corto de UX+tiempo abierto para sustituir la
limitación "el motor no modela horarios distintos por partido" (3.3.1
original) termina en esta entrega. "STEP 3" (Jugador Vivo/Progresión/
Entrenamiento/Lesiones) es una sesión de diseño completamente aparte,
todavía sin diseñar — ninguna mecánica suya se ha adelantado aquí; los
tipos de evento reservados en 3.5.1 son solo catálogo, no implementación.

### Supercopa y competición europea (pendiente)

- **Supercopa** (formato corto, equipos clasificados por resultados de
  la temporada anterior — a definir criterio exacto más adelante).
- **Competición europea**: los clubes "grandes" están siempre asignados
  a la misma competición europea cada año (sin sistema de clasificación
  dinámico todavía — se revisará más adelante). Un ascenso/descenso de
  división no afecta, por ahora, a la participación europea de estos
  clubes fijos.

### Pendiente para sesiones de diseño futuras (Liga/Calendario)
- Copa de 2ª división (formato completo: participantes, calendario,
  número de rondas) — solo se ha decidido su efecto colateral sobre el
  playoff de ascenso (3.2.3).
- Supercopa y competición europea (criterio de clasificación dinámico).
- Cierre de ciclo de temporada: ver 3.4, ya diseñado — quedan fuera de
  esa sección (pendientes de sesiones futuras) la renovación de
  contratos/fichajes entre temporadas, el envejecimiento/progresión de
  atributos por edad, la evolución de `reputation`/`facilities` entre
  temporadas, y el cálculo de `financialGoal`/`multiYearPlan` de la
  Junta.
- **CAL-1+CAL-2 (bloque de calendario vivo, 3.3.5/3.3.6/3.5) dejan
  explícitamente fuera**: cualquier catálogo de eventos de parada
  obligatoria más allá del partido del usuario (`requiresAttention` es un
  mecanismo genérico, no un catálogo — nada de entrenamientos/médico/
  scouting/mercado/contratos como eventos reales, eso es STEP 3, sesión de
  diseño aparte todavía sin hacer, ver nota de cierre al final de 3.5);
  noticias de "hitos" de carrera (en CAL-2, sin histórico real de
  estadísticas por jugador que las sostenga, ver 3.5.2 — cerrado por
  LIFE-4, sección 9.15); variedad horaria ENTRE series
  simultáneas de una misma ronda de bracket (limitación de `Bracket.js`,
  ver 3.3.1); controles secundarios de "Continuar 1 día/3 días/1 semana"
  (estudiados, no implementados — no hacían falta con el formato de 18
  equipos sin byes). La Agenda y las Noticias (CAL-2, ver 3.5) YA están
  implementadas — **no hay CAL-3**.
