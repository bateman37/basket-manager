# Táctica — defensa

_Migrado de `DESIGN.md` (líneas 2960-3215 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 7.12.13 Sistema defensivo — capas

La defensa tiene la misma profundidad estructural que el ataque. Se divide en:

1. **Shell/base scheme** — organización de media pista.
2. **Pickup point / presión** — dónde empieza a incomodar al balón.
3. **Cobertura de P&R/DHO** — respuesta a bloqueos directos.
4. **Reglas on-ball** — presión, orientación, distancia y navegación.
5. **Reglas off-ball** — ayudas, negación, closeouts y bloqueos indirectos.
6. **Defensa del poste** — posición y reglas de doble ayuda.
7. **Transición defensiva** — prioridades al perder/cambiar posesión.
8. **Press** — estructuras de presión a toda/3/4 pista.
9. **Matchups e instrucciones individuales** — overrides por jugador rival.

Como en ataque, ninguna opción otorga automáticamente una ventaja general.
Cada decisión protege unas situaciones y concede otras.

### 7.12.14 Shell/base scheme defensivo

Opciones iniciales:

- **Man-to-Man** — referencia principal.
- **Match-up Zone** — responsabilidades zonales con emparejamientos dinámicos.
- **2-3 Zone** — protege pintura y fuerza decisiones exteriores, con riesgos en
  high post/esquinas/rebote según ejecución.
- **3-2 Zone** — mayor presencia alta/perimetral, distinta vulnerabilidad
  interior/baseline.
- **1-3-1 Zone** — presión de líneas/pases y traps, exige rotaciones largas.
- **Box-and-One** — cuatro en zona + perseguidor sobre una estrella rival.

Una zona NO se implementa como `opponent3P +X / opponentInside -Y`. Debe cambiar
qué defensor es responsable de cada área, cuándo se activa una ayuda, qué
líneas de pase están disponibles, dónde aparece una sobrecarga y quién cierra
el rebote.

**Box-and-One** requiere seleccionar objetivo; si ese jugador abandona pista o
cambia su rol, la CPU/usuario puede volver al shell base o seleccionar otro.

Sistemas más específicos como Triangle-and-Two pueden añadirse posteriormente
sobre la misma arquitectura sin alterar el núcleo.

### 7.12.15 Pickup point, presión y pressing

El punto donde comienza la defensa es independiente del shell de media pista:

- **Media pista**
- **3/4 de pista**
- **Toda la pista**

Y la intensidad:

- conservadora;
- normal;
- alta;
- asfixiante.

La presión alta:

- puede consumir segundos de posesión antes de iniciar sistema;
- aumenta opciones de pérdida/robo si los defensores tienen perfil adecuado;
- exige `DefensaPerimetral`, `Agilidad`, `Aceleración`, `Resistencia`,
  `Anticipación`, `ÉticaDeTrabajo` y `TrabajoEnEquipo` de forma táctica;
- aumenta desgaste de Energía;
- deja una defensa más vulnerable si se supera la primera línea.

No se trata como un multiplicador universal de robos.

Esquemas de press previstos:

- **Man-to-Man Press**
- **2-2-1 Press**
- **1-2-1-1 Press**
- **Match-up Press**

Cada press define puntos de trap/rotación y una condición de salida hacia el
shell de media pista. La defensa puede, por ejemplo, presionar 2-2-1 y después
caer a Man-to-Man; una no sustituye conceptualmente a la otra.

### 7.12.16 Pick & Roll / DHO — cobertura defensiva

El bloqueo directo es la interacción táctica más importante de esta primera
versión. La cobertura depende de:

- localización (central/lateral);
- handler;
- screener;
- resto del spacing;
- capacidades de los dos defensores implicados;
- plan del partido.

La interfaz puede ofrecer **presets reconocibles**, pero internamente conviene
separar dos decisiones para evitar simplificaciones:

1. **Ruta del defensor del balón** — `over`, `under`, perseguir/recuperar.
2. **Comportamiento del defensor del bloqueador** — drop, high/flat, show,
   hedge, switch, blitz, ICE en lateral, etc.

Presets iniciales:

- **Drop + Over** — big protege profundidad/aro, defensor persigue por encima.
- **Drop + Under** — concede más espacio exterior para contener penetración.
- **High Drop / Flat** — big más alto que en Drop profundo.
- **Show & Recover** — big contiene temporalmente y vuelve a su hombre.
- **Hard Hedge** — salida agresiva, exige recuperación/rotación.
- **Switch** — cambio directo de asignaciones.
- **Blitz / Trap** — dos defensores comprometen al balón.
- **ICE / Push** — en P&R lateral, negar pantalla y orientar el balón hacia
  banda/baseline según la regla definida.

**Aplicabilidad:** ICE es una solución lateral; la UI no debe permitir una
combinación absurda simplemente porque existe en el catálogo. Las jugadas y
coberturas declaran contextos compatibles.

Cada cobertura tiene vulnerabilidades emergentes:

- Drop: pull-up/midrange/floater si el handler los domina.
- Under: triple/pull-up si el handler tiene rango.
- Hedge/Blitz: short roll y juego 4v3 si el pase/roller leen bien.
- Switch: reduce ventaja inicial, pero puede crear mismatch exterior/interior.
- ICE: limita uso normal de pantalla lateral, pero abre reject/re-screen,
  short corner u otros counters según spacing.

La respuesta no se codifica como `Coverage A pierde contra Action B`; depende
de jugadores y lecturas.

### 7.12.17 Reglas on-ball y matchups individuales

Cada matchup puede tener overrides sobre la defensa general:

- **Presión al balón:** baja / normal / alta.
- **Distancia:** flotar / normal / pegarse.
- **Orientación:** negar centro / orientar a banda / neutral.
- **Bloqueo:** over / under / seguir regla del equipo.
- **Negar recepción:** normal / agresiva.
- **Forzar mano/dirección** — opcional cuando los datos/tendencies permitan
  justificarlo; no se introduce como dato real obligatorio en TAC-1.

Ejemplo:

```
Tirador élite:
  pegarse
  over
  negar recepción

Base con poco tiro:
  flotar
  under
  cerrar penetración
```

El `GamePlan` permite asignar un defensor específico a una estrella rival. El
motor respeta esa intención siempre que ambos estén en pista, salvo que una
rotación/cambio defensivo obligue temporalmente a otro matchup.

### 7.12.18 Reglas off-ball, ayudas y ejecución colectiva

La defensa sin balón se modela mediante reglas de equipo y roles, no mediante
una bonificación global de `Defensa`.

Instrucciones iniciales:

- **Intensidad de ayuda:** baja / normal / agresiva.
- **Negación de líneas de pase:** conservadora / normal / negar.
- **Corner help:** quedarse / situacional / ayudar agresivamente.
- **Protección de pintura:** normal / colapsar.
- **Closeout:** contener penetración / expulsar de triple.
- **Bloqueos indirectos:** perseguir / pasar por debajo / cambiar / top-lock
  cuando sea compatible.
- **DHO:** perseguir / cambiar / pasar por debajo / contener según perfil.
- **Stunt & recover:** permitido según rol/ayuda.
- **Prioridad de low man:** quién toma la primera ayuda al roller.
- **Nail help:** apoyo central frente a penetraciones/short roll.

La defensa debe poder entrar en **rotación**. Cuando un jugador ayuda, otro debe
cubrir temporalmente el espacio/hombre abandonado. El `AdvantageState` mide si
esas rotaciones recuperan la posesión o el ataque mantiene la ventaja mediante
pase extra/corte.

#### Revisión explícita de `Trabajo en equipo`

7.6 excluyó `TrabajoEnEquipo` de las fórmulas individuales del partido. Esa
regla **se mantiene para las acciones individuales**, pero 7.12 introduce una
excepción necesaria y limitada:

> `TrabajoEnEquipo` participa en `tacticalExecution`, sincronización de
> bloqueos/cortes, spacing, ayudas y rotaciones colectivas; NO aumenta la
> probabilidad técnica de meter un tiro, robar, taponar o rebotear por sí solo.

Esto evita duplicar talento individual y, al mismo tiempo, permite distinguir
a cinco grandes atletas que defienden descoordinados de un quinteto que rota
como una unidad.

### 7.12.19 Defensa del poste

Opciones de posición inicial:

- **Behind** — defensa por detrás.
- **3/4 Front** — negar parcialmente entrada.
- **Front** — negar por delante, asumiendo riesgo de pase alto/ayuda trasera.

Reglas de double-team:

- nunca;
- solo contra jugador marcado como estrella/amenaza;
- al recibir;
- al primer bote;
- siempre que reciba en zona objetivo.

El double-team crea una ventaja defensiva contra la finalización individual a
cambio de poner **dos defensores sobre un jugador** y forzar rotaciones. La
Visión/Pase/Decisión del jugador posteado y el spacing del ataque deciden si
puede castigar esa superioridad.

No se añade un `-X% post` directo por hacer 2v1.

### 7.12.20 Transición defensiva y balance

Al terminar una posesión ofensiva, el equipo debe decidir cuántos jugadores y
qué perfiles priorizan:

- **Proteger aro**
- **Parar balón**
- **Localizar tiradores**
- **Replegar antes que cargar rebote**
- **Cross-match rápido** cuando no se puede recuperar el matchup original

La calidad de la transición defensiva depende del compromiso ofensivo al
rebote (7.12.12), velocidad/agilidad, posicionamiento, concentración,
TrabajoEnEquipo y roles defensivos.

Un equipo que carga el rebote con tres/cuatro jugadores puede dominar el
rebote ofensivo, pero si pierde la pugna su `DefensiveTransitionState` comienza
con menos jugadores detrás del balón. Esta relación debe ser causal y medible
en el Data Hub.

### 7.12.21 Roles defensivos

Cada jugador recibe un rol defensivo principal dentro de la táctica:

- **POA Stopper** — defensor principal del manejador.
- **Screen Navigator** — especialista en perseguir/navegar bloqueos.
- **Switch Defender** — capaz de asumir cambios y sobrevivir mismatches.
- **Perimeter Disruptor** — presión, líneas de pase, actividad exterior.
- **Nail Helper** — ayuda central y recuperación.
- **Low Man** — última ayuda frente al roller/aro.
- **Rim Protector** — protección de aro y ayudas interiores.
- **Post Anchor** — defensa de poste/posición interior.
- **Roamer** — puede abandonar una amenaza débil para generar ayudas.
- **Defensive Rebounder** — prioridad en cierre y rebote defensivo.

Como en ataque, `roleFit` se calcula en estrellas a partir de los atributos ya
existentes; no es un atributo fijo adicional. Un jugador puede ser excelente
POA pero mediocre Switch Defender, o gran Rim Protector pero mal defensor en
espacio. Misma tabla de conversión puntuación→estrellas que 7.12.9.
