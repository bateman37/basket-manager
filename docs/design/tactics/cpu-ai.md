# Táctica — IA de equipos CPU

_Migrado de `DESIGN.md` (líneas 3593-3732 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 7.12.25 IA táctica de equipos CPU

Los equipos CPU utilizan **exactamente el mismo sistema táctico**, sin bonuses
ocultos ni conocimiento omnisciente de estados que el usuario no podría
obtener.

#### Construcción de identidad

Al comenzar una partida/pretemporada, la CPU evalúa:

- mejores jugadores;
- distribución de roles disponibles;
- calidad de creación;
- tiro/spacers;
- interiores Roll/Pop/Post;
- defensa perimetral/interior;
- movilidad/switchability;
- rebote;
- Energía/edad de rotación;
- `clubDNA` como sesgo, no como orden obligatoria.

Y selecciona una identidad que maximice el encaje de plantilla. Ejemplos:

- base creador + pívot móvil + tiradores → más P&R/4-Out/5-Out;
- interior dominante + poco tiro → más 4-Out-1-In/Post/High-Low;
- muchos wings móviles → más switch/pressure/transition;
- pívot protector lento → más Drop que Switch Everything.

La CPU puede mantener 1 táctica principal y variantes secundarias preparadas.
No necesita copiar al usuario ni cambiar de identidad cada partido.

#### Plan de partido CPU

Usa estadísticas disponibles y conocimiento/scouting cuando exista ese módulo.
Busca:

- play-types dominantes del rival;
- estrellas y roles;
- coberturas habituales;
- mismatches;
- tendencias de tiro;
- lineups frecuentes.

En la fase previa a Scouting, puede usar el mismo informe estadístico objetivo
que está disponible al usuario para evitar asimetría de información.

#### Ajustes en vivo CPU

La CPU analiza:

- calidad de las oportunidades, NO solo si los tiros entraron;
- frecuencia/PPP por play-type;
- generación de ventaja;
- pérdidas;
- rebote;
- faltas;
- Energía;
- matchup dominante.

**Regla anti-sobrerreacción:** no cambia de cobertura porque el rival meta 3
tiros difíciles seguidos. Distingue resultado de proceso. Un rival puede ir
3/4 en triples muy contestados sin que el GamePlan esté roto; en cambio, cinco
triples abiertos consecutivos sí son señal de fallo estructural aunque solo
entren dos.

Se requieren:

- tamaño mínimo de muestra/confianza;
- histéresis para no alternar Drop↔Switch cada dos posesiones;
- coste de familiaridad;
- inercia táctica.

Una CPU cuyo equipo apenas conoce Switch puede usarlo como emergencia, pero
con peor `tacticalExecution` que su Drop habitual.

**Actualización TAC-7 (7.12.33: última entrega de la EPIC) — alcance real
implementado y nota de visión futura.** De las tres piezas de esta sección
(Construcción de identidad / Plan de partido CPU / Ajustes en vivo CPU),
TAC-7 implementa solo la primera, en su mínimo real: cada equipo CPU recibe
un `TacticalProfile` inicial derivado de su plantilla real
(`Tactics.buildCpuTacticalIdentity`, evaluada UNA VEZ al arrancar
partida/pretemporada, nunca cada partido) en vez del perfil por defecto
universal — ver CHANGELOG de esta entrega para la heurística exacta y su
verificación por arquetipo. **Plan de partido CPU** y **Ajustes en vivo
CPU** quedan explícitamente FUERA de esta EPIC (7.12.33 no define una
TAC-8), señalados aquí como diseño pendiente de una sesión futura dedicada,
no como un olvido:

- **Plan de partido CPU basado en scouting real**: la CPU debería, antes de
  cada partido, consultar el mismo Data Hub que TAC-7 construye para el
  usuario (`Tactics.summarizeTacticsTelemetry`, ya existe y es simétrico —
  "el mismo informe estadístico objetivo... para evitar asimetría de
  información", cita literal de arriba) y traducir eso en un `GamePlan`
  concreto de ese partido. Falta diseñar QUÉ señales del informe pesan más
  (¿coverage más castigado del rival? ¿su play-type más eficiente?) y CÓMO
  se traduce eso en overrides concretos de `GamePlan` — la pieza de datos
  ya existe, falta la lógica de decisión.
- **Ajustes en vivo CPU con anti-sobrerreacción**: exige diseñar
  explícitamente tamaño mínimo de muestra/confianza, histéresis (evitar
  alternar Drop↔Switch cada dos posesiones), coste de familiaridad al
  cambiar de cobertura mid-partido (una CPU que apenas conoce Switch puede
  usarlo de emergencia pero con peor `tacticalExecution`, ya construido en
  TAC-6 — la pieza existe, falta la lógica de decisión que la dispare) e
  inercia táctica general. Es la pieza de mayor riesgo de toda la IA CPU
  (fácil que sobrerreaccione o infrarreaccione de forma perceptible para el
  usuario) y merece su propia sesión de calibración dedicada, no un cierre
  apresurado en la última entrega de la EPIC.

### 7.12.26 Tendencies de jugador — arquitectura futura

Capacidad y comportamiento no son equivalentes. Un jugador puede tener
`TiroExterior = 17` y lanzar poco; otro `TiroExterior = 14` y buscar ocho
triples por partido.

7.12 reserva explícitamente un futuro sistema de `playerTendencies`, separado
de los atributos 1-20 de capacidad. Posibles tendencies:

- `threePointFrequency`
- `pullUpFrequency`
- `driveFrequency`
- `rimAttackFrequency`
- `postUpFrequency`
- `passFirst`
- `cutFrequency`
- `rollVsPop`
- `offBallMovement`
- `extraPassTendency`
- `defensiveGamble`
- `helpDiscipline`
- `foulAggressiveness`

**No se implementan en TAC-1**. La selección táctica inicial puede usar roles
y atributos. Pero el diseño no debe asumir que "habilidad = frecuencia" para
siempre, porque esa equivalencia impediría representar fielmente perfiles
reales más adelante.

Cuando existan tendencies, el entrenador puede sesgarlas mediante instrucciones,
pero no borrarlas completamente: un anotador agresivo sigue teniendo una
personalidad de juego distinta a un jugador pasivo bajo el mismo sistema.
