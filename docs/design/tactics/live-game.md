# Táctica — partido vivo, familiaridad y ajustes

_Migrado de `DESIGN.md` (líneas 3216-3592 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 7.12.22 `tacticalExecution`, familiaridad y complejidad

Una táctica no se ejecuta igual el primer día que después de meses de trabajo.
Se introduce **Familiaridad Táctica** como estado dinámico/persistente del
savegame, separado de los atributos fijos del jugador.

Capas mínimas de familiaridad:

- familiaridad ofensiva global del sistema;
- familiaridad defensiva global;
- familiaridad por familia de jugada;
- familiaridad por cobertura defensiva;
- familiaridad individual del jugador con su rol;
- familiaridad del quinteto con estructuras muy específicas (opcional en
  primera implementación; la arquitectura debe permitirla sin obligar a
  almacenar todas las combinaciones de cinco jugadores).

La familiaridad crece por:

- entrenamiento táctico futuro (sección 9);
- minutos reales ejecutando el sistema;
- continuidad de jugadores/roles;
- pretemporada.

Y cae/queda limitada por:

- introducir demasiadas novedades simultáneas;
- cambios frecuentes de rol;
- alta complejidad;
- nuevos fichajes;
- periodos largos sin usar una familia.

**No se cierra todavía la curva matemática.**

La **Complejidad táctica** es derivada de:

- cantidad de familias del playbook;
- cantidad de variantes/counters;
- diversidad de coberturas defensivas;
- nivel de Read & React;
- frecuencia de cambios de plan;
- cantidad de instrucciones individuales.

`tacticalExecution` cruza, en dirección positiva/negativa según corresponda:

- Familiaridad;
- `TrabajoEnEquipo`;
- `Concentración`;
- `Posicionamiento`;
- `VisiónJuego` / `DecisiónBajoPresión` para lecturas;
- Experiencia;
- Energía/Fatiga;
- Complejidad requerida.

Un `tacticalExecution` bajo no debe convertirse en una penalización plana a
todos los atributos. Sus errores aparecen como:

- mal timing de pantalla/corte;
- spacing roto;
- lectura incorrecta;
- pase tarde;
- dos jugadores ocupando el mismo espacio;
- pérdida ofensiva de sistema;
- ayuda defensiva tarde;
- dos defensores ayudando al mismo jugador;
- error de switch;
- closeout equivocado.

Esto produce resultados tácticos reconocibles sin falsear la habilidad base
del jugador.

#### Primera implementación (TAC-6)

Esta sección seguía admitiendo explícitamente que "no se cierra todavía la
curva matemática". TAC-6 construye una PRIMERA VERSIÓN concreta de las piezas
mínimas — mecanismo de partida simple y explicable, no una fórmula cerrada —
y deja constancia aquí de qué se decidió, para que no se lea como si esta
sección hubiera estado siempre así de cerrada.

**Dónde vive la Familiaridad** (decisión de encaje, no de diseño de juego):
`TacticalProfile.familiarity` (`src/core/Tactics.js`), estado DINÁMICO
persistido en `Team.js` junto al resto del perfil, pero deliberadamente
separado del resto de campos (el usuario declara la táctica; `familiarity`
mide cuánto la domina). Shape:

```
familiarity: {
  offensiveSystem: 0-100,      // familiaridad ofensiva global
  defensiveSystem: 0-100,      // familiaridad defensiva global
  byPlayFamily: { pickAndRoll, isolation, postUp, handoff, offScreen, motionFlow },
  byCoverage: { drop, under, switch, hedge, blitz },
  byPlayerRole: { [playerId]: { offensiveRoleId, offensiveLevel, defensiveRoleId, defensiveLevel } },
}
```

`byPlayerRole` es la familiaridad INDIVIDUAL del jugador con su rol — no
puede vivir en `Player.js` (vetado para nuevos atributos 1-20), así que vive
aquí como mapa por `playerId`, mismo patrón que `roleAssignments`. Familiaridad
de QUINTETO con estructuras específicas: fuera de esta entrega (marcada
opcional explícitamente arriba) — el shape elegido no obliga a enumerar
combinaciones de cinco jugadores para añadirla después.

Valor inicial de un `TacticalProfile` recién creado: 55/100 para
`offensiveSystem`/`defensiveSystem`/cada entrada de `byPlayFamily`/
`byCoverage` (ni cero ni máximo); 35/100 la primera vez que un jugador recibe
un rol (`byPlayerRole`, más bajo porque es más específico); 15/100 cuando el
`roleAssignment` de un jugador CAMBIA de un partido a otro (no hereda la
familiaridad del rol anterior). Cifras de partida, pendientes de calibración
(7.12.34).

**Crecimiento**: solo dos de las causas listadas arriba tienen pieza real de
motor en esta entrega — minutos reales ejecutando el sistema (posesión a
posesión, dentro de `advanceMatch`) y alta complejidad (ralentiza, no limita
con un techo aparte, la velocidad de crecimiento vía
`Tactics.computeFamiliarityGrowth`: rendimientos decrecientes hacia 100,
frenados por `PlayDefinition.complexity`/complejidad nominal de la cobertura
ejecutada). Cambio de `roleAssignment` de un partido a otro: implementado
como el reinicio bajo descrito arriba. Entrenamiento táctico/pretemporada:
fuera de alcance (dependen de la sección 9, sin diseñar todavía) — gancho
comentado en el código. Nuevos fichajes / periodos largos sin usar una
familia: fuera de esta entrega, sin punto de enganche limpio con el ciclo de
temporada actual.

**`tacticalExecution`** (rango 0-1, `Tactics.computeTacticalExecution`):
cruza familiaridad relevante para la jugada en curso (media de sistema +
familia/cobertura + individual de los participantes), una mezcla de
`TrabajoEnEquipo`/`Concentración`/`Posicionamiento`/`VisiónJuego`/
`DecisiónBajoPresión`, Energía (`dynamicState.energy` directo, sin duplicar
la fórmula de Fatiga de 7.5-bis) y Experiencia (normalizada con el mismo
divisor que ya usa 7.5), menos una penalización directa de la Complejidad de
la jugada elegida. Regla dura respetada: nunca resta un porcentaje plano a
un atributo — solo sesga tres mecanismos ya existentes:

- **Pérdida ofensiva de sistema**: multiplicador sobre `rollTurnover()` ya
  existente (`turnoverExecutionMultiplier`, mismo patrón que el press de
  7.12.15).
- **Lectura incorrecta**: con probabilidad inversa al `tacticalExecution`
  ofensivo, la lectura de `AdvantageState` (6 categorías, 7.12.4) se degrada
  un escalón hacia el peor resultado para el ataque — la ventaja que el
  talento SÍ generó se pierde por mala ejecución colectiva.
- **Ayuda defensiva tarde / error de switch / dos defensores ayudando al
  mismo jugador**: con probabilidad inversa al `tacticalExecution` defensivo,
  la selección YA HECHA de `screenerDefender` (`buildDefensivePlan`) o del
  ayudante del doble equipo de poste (`pickDoubleTeamHelper`) se sustituye
  por el candidato MENOS preparado disponible.

Quedan sin mecanismo propio en esta primera versión (señalado
explícitamente, no inventado): mal timing de pantalla/corte, spacing roto,
pase tarde, dos jugadores ocupando el mismo espacio, closeout equivocado —
ninguno tenía un punto de enganche real ya existente en el motor sin crear
un resolver nuevo.

**Eje Rigidez↔Read & React** (7.12.7): primera conexión real tras dos
entregas aplazándolo. Interpola el TECHO y el EXPONENTE de la curva
familiaridad→`tacticalExecution`: Rigidez alta (identity.rigidity→100)
alcanza un techo más alto pero un exponente convexo (>1) que castiga con más
dureza la familiaridad baja; Read & React (→0) tiene un techo algo más bajo
pero un exponente cóncavo (<1) más tolerante a familiaridad baja. `rigidity`
(0-100, 50 neutro) se añade a `identity` — no existía como campo antes de
esta entrega, solo estaba señalado en el texto.

`GamePlan.tacticalExecutionOverride` (7.12.23): primer uso del gancho que
TAC-5 dejó preparado — un número 0-1 sustituye directamente el
`tacticalExecution` calculado, solo para ese partido, sin editor propio
todavía en la pantalla de Tácticas.

Ver CHANGELOG.md (entrega TAC-6) para el detalle completo de cada decisión
de modelado y qué queda pendiente de calibración cuantitativa (7.12.34).

### 7.12.23 Plan de partido (`GamePlan`) y scouting táctico

La táctica base NO se destruye cada semana. Antes de un partido el usuario
puede crear un `GamePlan` con overrides específicos.

Bloques de plan:

**Ataque**
- play-types a aumentar/reducir;
- target de mismatch;
- defensor rival a atacar en P&R;
- jugador interior/exterior a buscar;
- ritmo específico;
- orientación del shot profile;
- prioridad de rebote ofensivo.

**Defensa**
- matchup principal;
- cobertura P&R general para ese partido;
- cobertura por jugador rival;
- over/under por handler;
- presión/distancia por jugador;
- negar recepción a estrella;
- dobles al poste;
- ayudar o quedarse con tiradores;
- shell alternativo preparado.

**Regla de persistencia:** al terminar el partido se vuelve a la identidad base,
salvo que el usuario guarde explícitamente ese plan como nueva táctica.

#### Informe táctico del rival

El juego debe generar, a partir de datos REALES de las posesiones simuladas,
un informe como:

- frecuencia de cada play-type;
- PPP por play-type;
- perfil de tiro (aro/media/triple);
- transición;
- P&R handler/roller;
- uso de poste;
- porcentaje de tiros asistidos;
- pérdidas forzadas/cometidas por contexto;
- cobertura defensiva usada y frecuencia;
- eficiencia concedida por cobertura;
- quintetos/lineups más utilizados;
- jugadores con mayor creación.

En la primera versión, mientras Scouting no esté implementado, estos datos
pueden mostrarse con un nivel de acceso alto para probar el sistema. Cuando
exista el módulo de Scouting, **la base conoce todos los datos pero el usuario
solo ve el nivel de precisión/información que su scouting haya conseguido**.
No rediseñar 7.12 cuando llegue Scouting: solo cambiar la capa de visibilidad.

### 7.12.24 Ajustes durante el partido, tiempos muertos y situaciones especiales

El flujo actual revela el partido principalmente por cuartos. El sistema
mantiene ese nivel de presentación —no se convierte en narración jugada a
jugada—, pero añade **ventanas de intervención táctica**.

#### Entre cuartos

Siempre se puede revisar:

- play-type frequency/PPP hasta ese momento;
- shot profile;
- P&R rival;
- pérdidas;
- rebote;
- matchups;
- Energía/faltas;
- cobertura defensiva rival observada.

Y cambiar:

- quinteto/rotación dentro de las reglas de 7.11;
- roles activos;
- play-type priorities;
- ritmo;
- coverage;
- matchups;
- ayudas/presión;
- shell defensivo.

#### Tiempos muertos

Los tiempos muertos se modelan con las reglas FIBA de `CONFIG_BASE` y no con
números hardcodeados en la UI. Para FIBA/ACB la referencia actual es 2 en la
primera mitad, 3 en la segunda (con la restricción de los últimos 2 minutos del
4º cuarto) y 1 por prórroga; duración reglamentaria 1 minuto. Si otra
competición cambia las reglas, lo hace mediante CONFIG.

Un tiempo muerto **NO aplica un `momentum = 0` ni un bonus mágico de acierto**.
Su valor principal es permitir:

- ajuste inmediato de cobertura;
- cambio de matchup;
- cambio de quinteto;
- cambio de prioridad ofensiva;
- selección de una jugada ATO preparada;
- recordatorio táctico que puede mejorar temporalmente la ejecución de UNA
  acción conocida, condicionado por familiaridad.

El sistema de Racha/Momento de 7.9 y el parcial colectivo de 7.6-20 no se
borran automáticamente por pedir tiempo muerto. Si en pruebas futuras se
justifica un efecto psicológico menor, deberá calibrarse por separado; no se
asume aquí.

#### Compatibilidad con el reveal por cuartos

Para poder pedir un timeout dentro de un cuarto sin mostrar cada posesión:

- el motor sigue simulando posesión a posesión internamente;
- cuando aparece una oportunidad reglamentaria de timeout y se cumple un
  trigger configurado por usuario/CPU, el cuarto puede **pausarse** y devolver
  control con marcador, reloj y resumen agregado hasta ese instante;
- el usuario puede tener `Auto Timeouts` activado para mantener un flujo más
  rápido: la IA asistente usa reglas configuradas sin abrir una pantalla cada
  vez;
- los triggers exactos (parcial rival, deterioro de shot quality, faltas,
  final de cuarto, etc.) son CONFIG/UX y se calibran después.

#### ATO, BLOB, SLOB y finales

Se reserva un sub-playbook especial:

- **ATO** — After Time Out.
- **BLOB** — Baseline Out Of Bounds.
- **SLOB** — Sideline Out Of Bounds.
- **Late Clock** — pocos segundos de posesión.
- **Last Possession** — última posesión de cuarto/partido.

Estas jugadas utilizan la misma arquitectura `PlayDefinition`: no garantizan un
tiro concreto y su eficacia depende de jugadores, cobertura y familiaridad.

#### Falta táctica intencionada

Se cierra el hueco de 7.6 mediante reglas configurables:

- perdiendo por X margen con Y segundos: empezar a hacer falta;
- priorizar receptor/objetivo con peor TiroLibre cuando sea posible;
- evitar que el jugador propio con 4 faltas sea quien haga la falta si existe
  alternativa razonable;
- ganando por 3: futura opción de falta preventiva antes del triple, cuando el
  motor de situación final esté suficientemente calibrado;
- CPU usa las mismas reglas.

No se fija todavía el umbral óptimo de segundos/marcador: será decisión de
usuario/CPU y calibración de diseño.

**Actualización TAC-5 (implementado):** el umbral de partida es configurable
por equipo (`TacticalProfile.situations.tacticalFoul`, pestaña Situaciones,
7.12.32) — margen de puntos y segundos restantes, desactivado por defecto
(7.12.34, regresión). Decisión de encaje señalada explícitamente: solo se
evalúa en el último período regular o en prórroga (perder tiempo en un
cuarto intermedio no tiene sentido real), y el objetivo es siempre el rival
EN PISTA con peor TiroLibre (no de toda la plantilla). La opción de falta
preventiva ganando por 3 antes del triple sigue sin implementar, tal como
permite explícitamente este apartado.

### 7.12.24-bis Visión futura pendiente de esta sección (TAC-5)

Con el motor de partido ya pausable/reanudable por tramos (7.12.33, TAC-5),
quedan señaladas como diseño pendiente de una sesión futura dedicada — **no
implementadas en TAC-5**, con el mismo nivel de detalle que el resto de
"pendientes" de 7.12.34:

- **Velocidades de reproducción del partido (x4/x8/x16/x32):** una vez el
  motor es pausable/reanudable por tramos, el frontend podrá avanzar la
  simulación en tramos más grandes que un cuarto (`advanceMatch` ya admite
  cualquier punto de corte, no solo posesión/cuarto/timeout — un futuro
  "tramo de N segundos" es la misma función, otro criterio de parada),
  actualizando el marcador progresivamente sin reveal completo posesión a
  posesión, para partidos que el usuario quiere resolver rápido sin perder
  la posibilidad de intervenir. Pendiente: diseño de la UI de selector de
  velocidad, y de qué tan grueso es cada tramo a cada velocidad.
- **Cambios de táctica en mitad del partido, no solo entre cuartos o en
  tiempo muerto:** el `GamePlan` de TAC-5 ya se puede actualizar entre
  llamadas a `advanceMatch()` (el motor lee `homeGamePlan`/`awayGamePlan`
  en cada posesión, ver `Tactics.effectiveTacticalProfile`), pero el
  frontend de TAC-5 solo expone esa capacidad en los cortes de cuarto/
  timeout ya existentes. Pendiente: diseño de qué ajustes tienen sentido
  permitir sin parar el partido del todo (¿un cambio de cobertura
  instantáneo penaliza por sorpresa/falta de preparación? ¿todo ajuste
  requiere antes un tiempo muerto o parada de juego real, como en el
  baloncesto de verdad?).
- **Tiempos muertos para romper rachas del rival:** 7.9 (Racha/momento
  anímico) y 7.6-20 (parcial de anotación colectivo) existen y se
  actualizan durante la simulación, pero TAC-5 NO los conecta a ningún
  efecto de tiempo muerto (7.12.24 ya lo prohíbe explícitamente como bonus
  mágico — `MatchEngine.consumeTimeout`/`evaluateTimeoutStop` no tocan
  `scoringRun` ni `dynamicState.momentum` en ningún punto). Pendiente de
  diseño futuro: si un tiempo muerto debe tener algún efecto real y acotado
  sobre la racha activa (ej. cortarla de raíz, o solo ralentizar su
  decaimiento), y cómo evitar que se convierta en una herramienta mecánica
  de "resetear la suerte del rival" sin justificación de juego real —
  requiere su propia sesión de diseño y calibración, no una decisión de
  esta entrega.
- **Extender el motor pausable/GamePlan/ventanas de intervención reales a
  Copa/Playoff/Ascenso:** TAC-5 solo los expone para el partido de LIGA del
  usuario (decisión de encaje explícita, ver CHANGELOG) — los partidos de
  bracket siguen resolviéndose de golpe y revelándose por cuartos como
  antes de TAC-5. Ampliarlo exige que `Series.playNextGame`/
  `Bracket.playNextGame` (o quien los llame desde `game.js`) puedan conocer
  de antemano el emparejamiento home/away del siguiente partido antes de
  jugarlo — hoy solo se sabe en el momento de jugarlo — sin tocar
  `Bracket.js`/`Playoffs.js`/`Cup.js`/`Promotion.js` más de lo necesario.
