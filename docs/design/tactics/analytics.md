# Táctica — Data Hub y análisis

_Migrado de `DESIGN.md` (líneas 3733-4011 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 7.12.27 Data Hub táctico — qué se registra desde el principio

Aunque la UI inicial no muestre toda esta información, **el motor debe guardar
la telemetría táctica desde la primera implementación**, porque datos históricos
no almacenados no pueden reconstruirse después.

Cada posesión debería poder registrar, como mínimo:

- `gameId` / periodo / reloj / marcador;
- quinteto ofensivo y defensivo;
- fase: transición / early offense / media pista;
- `playType`;
- `playId` si hubo jugada concreta;
- initiator/handler;
- screener;
- receptores/participantes principales;
- roles activos;
- shell defensivo;
- matchup del balón;
- cobertura P&R/DHO si aplica;
- ruta over/under si aplica;
- ayuda y help defender;
- `advantageStart` / `advantagePeak` / `advantageEnd`;
- counter/continuación utilizada;
- número de pases relevantes o cadena de creación;
- `shotQuality` contextual;
- tipo de acción final 7.6;
- defensor real del tiro/finalización;
- reloj de posesión al finalizar;
- resultado: canasta/fallo/pérdida/falta/rebote/etc.;
- si la canasta fue asistida y por quién;
- si hubo ATO/BLOB/SLOB/Last Possession;
- timeout/ajuste táctico vigente.

De ello se derivan, entre otras:

**Ataque**
- frecuencia y PPP por play-type;
- PPP de P&R handler / roll man;
- efficiency tras DHO / Off Screen / Post / Isolation;
- Transition Frequency / PPP;
- rim / midrange / 3P frequency;
- assisted FG%;
- turnover rate por contexto;
- FT rate por play-type;
- shot quality media;
- ATO PPP;
- efectividad de cada play del playbook;
- rebote ofensivo vs puntos concedidos en transición.

**Defensa**
- PPP concedido por coverage;
- frecuencia de Drop/Switch/Hedge/Blitz/ICE;
- shot profile permitido;
- rim frequency permitido;
- triples abiertos/contestados si el modelo de `shotQuality` lo permite;
- pérdidas forzadas por presión;
- puntos concedidos tras superar primera línea;
- eficiencia de zona/man;
- rebote defensivo por shell/quinteto;
- mismatch efficiency concedida.

**Lineups**
- ORtg/DRtg/Net aproximado;
- play-types más eficientes por quinteto;
- spacing efectivo;
- frecuencia de ventajas creadas/cedidas;
- rendimiento de cada cobertura.

La UI debe advertir cuando una muestra es pequeña. No presentar `2 posesiones,
1.50 PPP` como una verdad táctica estable.

### 7.12.28 Valoraciones derivadas de quinteto

Para ayudar al usuario sin crear nuevos atributos base, cada quinteto puede
mostrar índices calculados:

- **Creación**
- **Spacing**
- **Finalización interior**
- **Tiro exterior**
- **Rebote ofensivo**
- **Rebote defensivo**
- **POA Defense**
- **Switchability**
- **Rim Protection**
- **Transition Offense**
- **Transition Defense**
- **Tactical Execution**

Se muestran en estrellas/barras y se recalculan al cambiar un jugador.

Ejemplo conceptual:

```
Quinteto A
Creación         ★★★★★
Spacing          ★★★★★
Rebote           ★★☆☆☆
Switchability    ★★★★☆
Rim Protection   ★★☆☆☆
```

Cambiar un pívot abierto por un interior tradicional puede mejorar Roll,
rebote y protección de aro, pero reducir spacing. La táctica elegida no ha
cambiado; **su encaje con el quinteto sí**.

### 7.12.29 Forma conceptual de los datos tácticos

Mientras el proyecto siga usando JSON, el sistema puede representarse con un
shape equivalente al siguiente. Es una referencia de diseño, no obliga a usar
exactamente estos nombres de propiedades si la implementación existente exige
otro convenio:

```json
{
  "offense": {
    "spacing": "4-out-1-in",
    "pace": 60,
    "earlyOffense": 55,
    "ballMovement": 70,
    "freedom": 50,
    "offensiveRebound": 45,
    "mismatchHunting": 60,
    "playTypeWeights": {
      "pickAndRoll": 30,
      "handoff": 15,
      "offScreen": 12,
      "postUp": 10,
      "isolation": 8,
      "cut": 10,
      "transition": 15
    }
  },
  "defense": {
    "baseScheme": "man",
    "pickupPoint": "half-court",
    "ballPressure": 60,
    "helpIntensity": 55,
    "centralPnR": "drop-over",
    "sidePnR": "ice",
    "offBallScreenCoverage": "chase",
    "postDefense": "behind",
    "doublePost": "star-only"
  }
}
```

Los números del ejemplo son **solo ilustrativos**, no valores de balance.

El `GamePlan` vive separado:

```json
{
  "opponentId": "team-rival",
  "matchups": {
    "player-rival-01": {
      "defenderId": "player-own-03",
      "pressure": "high",
      "screenRoute": "over"
    }
  },
  "overrides": {
    "centralPnR": "high-drop",
    "mismatchHunting": 80
  }
}
```

El playbook también debe ser data-driven. Forma conceptual mínima:

```json
{
  "id": "spain-pnr",
  "family": "pick-and-roll",
  "participants": ["handler", "screener", "backScreener"],
  "complexity": "high",
  "reads": ["handlerShot", "roll", "shortRoll", "pop", "kickOut", "reset"],
  "counters": ["reScreen", "reject", "attackMismatch", "extraPass"]
}
```

Las ramas exactas contra cada cobertura pueden vivir en CONFIG/datos de
playbook. Añadir una nueva jugada debe ser principalmente **añadir una nueva
definición**, no reescribir el bucle central del motor.

### 7.12.30 Reglas de integración con el motor existente

1. **7.6 sigue siendo el resolver final.** No duplicar las fórmulas de tiro,
   robo, rebote, tapón, faltas, etc. dentro de Tactics.
2. **7.11 sigue siendo fuente de quintetos/minutos.** Tactics consulta quién
   está realmente en pista; no inventa titulares paralelos.
3. **Energía/Fatiga sigue siendo una única verdad.** Presión y esquemas más
   agresivos pueden elevar carga de acciones, pero no crean otra batería
   táctica.
4. **Position map de 6.1 sigue válido.** Los roles no sustituyen posición ni
   polivalencia.
5. **Presión de Momento de 7.5 sigue transversal.** Una táctica de final de
   partido no crea otro sistema de clutch.
6. **Consistencia sigue controlando varianza individual.** No se utiliza para
   familiaridad táctica.
7. **TrabajoEnEquipo solo entra por ejecución colectiva** según 7.12.18.
8. **Asistencia de 7.6-D se sustituirá progresivamente**, no se duplica para
   siempre.
9. **ClubDNA es un sesgo de identidad**, especialmente para CPU/cantera,
   nunca un bonus automático a una jugada.
10. **CONFIG contiene pesos y calibración.** La lógica estructural vive en las
    entidades; los coeficientes ajustables no deben desperdigarse por código.

### 7.12.31 Principios de balance y calibración

Antes de fijar coeficientes, el sistema debe cumplir invariantes cualitativos.
Estos son requisitos de validación, no números finales:

1. Contra un **Drop profundo**, un handler competente en pull-up debe aumentar
   su frecuencia de tiros intermedios/exteriores respecto a un baseline.
2. Contra **Blitz**, debe bajar la frecuencia de tiro directo del handler y
   aumentar short-roll/4v3 si el equipo tiene pasadores capaces; un handler con
   mala decisión puede aumentar pérdidas.
3. **Switch** debe reducir ventaja inmediata del P&R, pero aumentar la
   aparición de mismatch cuando los perfiles físicos/posicionales lo permitan.
4. **Under** debe ser castigable por un gran tirador y útil contra un handler
   sin amenaza exterior.
5. **5-Out** solo mejora spacing si el quinteto realmente obliga a respetar a
   los cinco jugadores.
6. **3-Out 2-In** debe tender a mayor presencia interior/rebote y menor espacio
   para penetración que 5-Out, sin recibir un porcentaje fijo artificial.
7. Aumentar **rebote ofensivo** debe aumentar ORB y también vulnerabilidad de
   transición si el rival consigue el rebote.
8. Un **press** agresivo debe poder elevar pérdidas rivales, pero consumir más
   Energía y conceder oportunidades mejores cuando es superado.
9. Familiaridad baja debe producir **errores de ejecución**, no una caída
   indiscriminada de todos los atributos del jugador.
10. Un gran pasador debe mejorar la **calidad de oportunidades creadas**, no
    solo acumular asistencias después de la canasta.
11. Una CPU debe poder llegar a los mismos resultados usando las mismas
    herramientas; no existen coberturas/bonuses exclusivos de la IA.
12. Los resultados deben depender de la interacción táctica + jugadores: no
    debe existir una tabla universal `táctica A > táctica B`.

La calibración cuantitativa posterior se hará mediante simulación masiva y
comparación con distribuciones reales: pace, shot profile, P&R frequency,
turnover rate, ORB%, FT rate, asistencias, eficiencia por play-type y eficiencia
por cobertura cuando exista evidencia suficiente.

### 7.12.32 Interfaz táctica

La pantalla principal de Tácticas se divide en siete vistas, manteniendo
profundidad sin mostrar todos los parámetros a la vez:

1. **Resumen** — identidad, media cancha visual y fortalezas del quinteto.
2. **Ataque** — spacing, ritmo, prioridades, rebote ofensivo y play-types.
3. **Defensa** — shell, presión, P&R, ayudas, poste y transición.
4. **Roles** — rol ofensivo y defensivo de cada jugador + `roleFit` en estrellas.
5. **Playbook** — jugadas activas, prioridad y familiaridad.
6. **Situaciones** — ATO, BLOB, SLOB, Late Clock, Last Possession y falta
   táctica.
7. **Rival** — `GamePlan`, matchups e informe de scouting/análisis.

La media cancha gráfica es explicativa, no un editor libre de dibujo en esta
fase. Al cambiar 4-Out-1-In → 5-Out debe visualizarse la ocupación de espacios;
al elegir Drop/Switch/ICE debe poder mostrarse esquemáticamente la cobertura.

**Futuro, no TAC-1:** editor visual de jugadas propio. La arquitectura
`PlayDefinition` debe permitirlo más adelante, pero no bloquear el módulo
actual esperando esa herramienta.

**Integración con la navegación existente** (confirmado contra `game.js`):
el juego ya tiene cinco pantallas de navegación (`home`, `lineup`,
`calendar`, `competitions`, `stats`) más `match` y `team-select`, gestionadas
por la constante `SCREENS` y un `renderXScreen()` por pantalla. La nueva
pantalla de Tácticas se añade a esa misma lista (`tactics`, junto a
`lineup` en el nav) con su propio `renderTacticsScreen()`, siguiendo el
patrón ya existente — no se introduce un sistema de navegación paralelo.
Las siete vistas de esta sección son sub-pestañas dentro de esa única
pantalla, igual que Alineación (7.11.6) ya unificó convocatoria y
quintetos en una sola pantalla con bloques internos en vez de dos
pantallas separadas.
