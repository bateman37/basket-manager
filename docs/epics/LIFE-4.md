# Ficha de Epic — LIFE-4 (ficha universal, carrera e histórico)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `LIFE-4`
- **Estado**: cerrada (histórica)
- **Objetivo**: Ficha universal de jugador, carrera, histórico e hitos.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/career-history.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 3079-3171 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-24 — LIFE-4: Ficha universal, carrera, histórico e hitos (DESIGN.md 9.15)

Cuarta y última entrega de STEP 3 — PLAYER LIFE, montada encima de
LIFE-1/LIFE-2/LIFE-3/POS/Tácticas/Calendar/Events ya mergeados. **Con
esta entrega, STEP 3 — PLAYER LIFE queda cerrado.**

- **`src/core/PlayerCareer.js`** (nuevo): inicialización/migración
  idempotente de `player.careerHistory` (`ensureCareerHistory`),
  acumulación por partido resuelto desde el box score real
  (`recordResolvedMatch`, con dedupe por `matchKey` — invariante "un
  partido suma una sola vez"), cierre de temporada con snapshot final de
  TMB/atributos/posiciones/roles/honores (`closeSeason`), totales
  derivados (`computeCareerTotals`), tendencias (`describeAttributeTrend`/
  `summarizeGroupTrends`) y honores idempotentes (`registerHonour`). No
  calcula crecimiento, lesiones, partidos ni roles — solo los fotografía.
- **Formato histórico compacto**: baseline + un snapshot final por
  temporada (nunca por partido ni por semana). Atributos (29 mutables de
  LIFE-1), posiciones (5) y estadísticas (20 campos: partidos,
  titularidades factuales, segundos, puntos, rebotes of./def.,
  asistencias, robos, tapones, pérdidas, faltas cometidas/recibidas,
  valoración, +/-, tiros de 2/3/libres hechos-intentados) se persisten
  como arrays de orden fijo — nunca porcentajes ni rebotes totales
  duplicados (se derivan al leer). `PlayerCareer.STAT_SNAPSHOT_KEYS`/
  `ATTRIBUTE_SNAPSHOT_KEYS`/`POSITION_SNAPSHOT_KEYS` documentan el orden;
  ningún otro módulo usa índices mágicos.
- **`partial` vs `complete`**: jugadores reales ya existentes al arrancar
  la partida reciben histórico `partial` (nunca "debut profesional" ni
  "récord de carrera" inventados — la UI rotula "Registrado en esta
  partida"); cantera nueva (`Team.generateAcademyIntake()`) recibe
  histórico `complete` desde su fecha real de incorporación, con
  debut/hitos/récords de carrera de verdad.
- **Titularidad factual**: `Rotation.buildRotationState()` fotografía el
  quinteto inicial real como `starterIds`, expuesto por
  `MatchEngine.rotationSummary()` — nunca inferida por minutos.
- **Hitos y récords**: debut/primera titularidad/umbrales de partidos
  (50/100/250/500) y minutos (1.000/5.000/10.000) solo para histórico
  `complete`, cada uno como mucho una vez (IDs estables). Récords
  personales (puntos/rebotes/asistencias/tapones/robos/valoración) se
  registran para cualquier histórico, con milestone/candidato a noticia
  solo al superar un mínimo real (nunca 6 hitos en el primer partido).
- **Honores**: campeón de Copa/Playoff por el título/liga regular de 2ª,
  ascenso directo/vía playoff — hechos ya calculados por League/Bracket/
  Promotion, registrados al roster real del momento del cierre. Un honor
  de equipo nunca genera noticia por jugador.
- **Cierre de temporada** (`closeSeasonAndPrepareNext()`, `game.js`):
  división/equipo capturados ANTES de ascensos/descensos, cierre de
  histórico de los 36 equipos con snapshot completo, y solo DESPUÉS la
  cantera nueva (con histórico `complete` desde ya, nunca temporadas
  vacías previas). `seasonKey` real (`"2026-27"`, `seasonKeyFromStartYear`),
  nunca "Temporada 1".
- **`Events.js`**: `newsCategory:'career'` con dos builders puros
  (`buildCareerMilestoneNewsEvent`/`buildPersonalBestNewsEvent`) — cierra
  el hueco que CAL-2 había dejado explícitamente pendiente por falta de
  histórico real. Solo equipo del usuario; `partial` nunca genera
  "debut"/"X partidos de carrera", solo "mejor actuación registrada en
  esta partida" con un umbral propio más estricto. Deduplicado por el
  propio milestone (IDs estables en `PlayerCareer.js`), nunca por un
  campo nuevo en el shape de evento.
- **Ficha universal de jugador** (`player-profile`, pantalla contextual
  sin botón propio en la navegación): `openPlayerProfile()`/
  `closePlayerProfile()`, 7 sub-pestañas (Resumen, Atributos, Posiciones
  y roles, Desarrollo, Estadísticas, Médico, Carrera). TMB visible
  (1-200, mismo tooltip ya existente); Potencial/`learningRate`/
  `learningPersistence`/Profesionalidad/Ambición/seeds/residuales nunca
  se muestran. Gráficos de evolución (TMB por temporada, atributo
  seleccionado) en SVG/CSS puro con tabla accesible debajo, sin
  dependencias externas. Pestaña Médico lee `medicalState` directamente
  (nunca copiado). Nombre clicable (`playerLinkHtml()`/
  `playerLinkHtmlById()`) desde Alineación (checkbox y nombre ya no
  comparten el mismo `<label>`, para no activar la convocatoria por
  accidente), Entrenamiento, Tácticas (pestaña Roles), Estadísticas,
  Lesiones, box score y Noticias — un único listener delegado en
  `#gm-app` cubre los siete puntos. Abrir/cambiar de pestaña nunca avanza
  el calendario ni procesa Training/Medical/Development/roles/
  alineación; volver preserva el estado de la pantalla de origen porque
  ya era duradero por sí mismo.
- **`scripts/test-life4.js`** (26 checks) y **`scripts/smoke-life4.js`**
  (36 equipos/414+ jugadores reales, 3 temporadas completas con Copa/
  Playoff por el título/Playoff de ascenso/ascensos-descensos/cantera):
  ambos en verde. Tamaño observado: ~640 bytes/temporada en el test
  dirigido (estadísticas constantes); ~2,8 MB acumulados en el smoke test
  tras 3 temporadas reales (738 jugadores, con hitos/récords/honores de
  verdad), proyección lineal a 20 temporadas ~18 MB — por encima del
  objetivo orientativo de 2,5 MB (desviación señalada explícitamente: ya
  se aplican arrays de orden fijo, cero porcentajes/totales duplicados y
  deduplicación de milestones; el margen restante lo consumen
  `milestones`/`personalBests` acumulados por muchas temporadas reales,
  optimización pendiente para una sesión futura).
- **Desviación de numeración en DESIGN.md**: el prompt pedía documentar
  esto como "9.4", pero esa subsección ya existía (Atributos mutables,
  LIFE-1) — se documenta como **9.15**, siguiendo la numeración
  secuencial real de HEAD (LIFE-2 = 9.13, LIFE-3 = 9.14).
