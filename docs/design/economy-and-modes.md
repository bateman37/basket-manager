# Inicio de partida, economía, roles, modo Manager y plataforma

_Migrado de `DESIGN.md` (líneas 1002-1020 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 4. Inicio de partida

- El usuario **elige libremente** con qué club empezar, de primera o
  segunda división, sin restricciones de nivel ni de presupuesto.
- La carrera **no está atada a un solo club**: el usuario puede ser
  despedido (por malos resultados/directiva descontenta) o fichar por
  otro club, como en Football Manager.

## 5. Economía del club

**Sustituida por el desglose completo de la sección 6.2.6.** Aquella
sesión de diseño (análisis de referentes de club) definió las 7 fuentes
de ingreso y las 3 categorías de gasto ancladas a la estructura real de
la ACB (patrocinio como primera fuente, no la TV), sustituyendo por
completo el planteamiento genérico que había aquí originalmente. Esta
sección se deja como puntero explícito para que nadie implemente contra
una versión desactualizada: **la referencia vigente es 6.2.6**, no este
apartado.

_Migrado de `DESIGN.md` (líneas 4551-4568 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 8. Roles y control del club

Un único rol de usuario que controla:

- Fichajes y renovaciones
- Tácticas y alineaciones
- Entrenamientos y desarrollo de jugadores
- Finanzas y presupuesto
- Contratación de staff (cuerpo técnico, scouts, médicos)
- Relación con la directiva/afición (objetivos de temporada, presión)

**Nota de coherencia con 6.2.7**: "contratación de cuerpo técnico" aquí
describe la intención de diseño a largo plazo, no un sistema ya
implementable — el cuerpo técnico **no existe todavía como entidad
propia** (ver 6.2.7); de momento el usuario asume ese rol íntegramente.
Este punto se activará cuando se diseñe esa entidad en una sesión
futura.

_Migrado de `DESIGN.md` (líneas 10672-10696 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

**Corrección de rol vigente (SQUAD-BUDGET-1, ampliada por
ECONOMY-BOARD-1)**: la sección 8 de arriba describía un único rol
fusionado presidente+entrenador con autoridad total sobre finanzas/
presupuesto — ese planteamiento queda **sustituido**. El rol jugable
ACTUAL es un **manager deportivo completo** (táctica, plantilla,
fichajes, cesiones, traspasos, contratos y renovaciones) que opera
**dentro de los recursos que le asigna la junta** — el manager no es
todavía el presidente/propietario, y "Finanzas y presupuesto" de la
sección 8 significa hoy **consultar, ejecutar dentro del, y PEDIR
ampliación del** presupuesto salarial ya asignado
(`docs/architecture/squad-budget.md`,
`docs/architecture/board-budget-requests.md`) — nunca fijarlo
unilateralmente ni fijar el resto del presupuesto del club (fijar
sponsors/precios/deuda/objetivos financieros sigue siendo autoridad de
junta, ver `docs/architecture/club-finance.md`). Un futuro modo combinado
dará al mismo usuario también las decisiones de junta/propiedad (fijar
presupuestos, resolver peticiones, objetivos financieros) — ver la
corrección de la sección 11 más abajo.

## 11. Modo Manager (VIGENTE, no futuro) — corrección de SQUAD-BUDGET-1

**Contenido original de esta sección invertido**: describía "Modo Manager"
como una variante futura y recortada de un "modo Completo" que sería el
punto de partida. Es al revés — el **modo Manager (deportivo) es el ÚNICO
modo jugable hoy** (ver corrección de arriba); el "modo Completo" (manager
+ junta/propiedad en el mismo usuario) es el que está pendiente de
construir, sobre el motor ya existente, añadiendo pantallas de junta/
propiedad en vez de duplicar lógica — nunca al revés. Ambos modos
compartirán la MISMA economía, calendario, persistencia y reglas; solo
cambia la autoridad de decisión (quién puede fijar/revisar el presupuesto
salarial o resolver una petición de ampliación, por ejemplo). Ver
`docs/architecture/squad-budget.md` y `docs/architecture/
board-budget-requests.md` para la costura de autoridad ya dejada
explícita (`decisionAuthority: 'board-system'` para toda decisión de
junta resuelta por el sistema, distinta de `board-manual`).

## 12. Plataforma

- Desarrollo en **JavaScript/HTML** (sin frameworks pesados), pensado para
  jugarse en navegador de escritorio y móvil.
- Posibilidad futura de empaquetar como app móvil (PWA o similar) sin
  rehacer el motor.

## 13. Nota sobre comercialización futura

Proyecto privado por ahora. Si se decide comercializar en el futuro:

- Quitar todos los logos/escudos oficiales (ya contemplado desde el
  principio).
- Revisar el uso de nombres reales de jugadores y clubes — probablemente
  sustituir por una capa de nombres ficticios/generados, manteniendo los
  atributos y la estructura de datos ya construida.
- Esta decisión se pospone deliberadamente; no bloquea el desarrollo
  actual.
