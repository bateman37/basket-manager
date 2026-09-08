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

## 11. Modo Manager (futuro, derivado del modo Completo)

Mismo motor, pero sin pantallas de gestión de presidencia — pensado para
quien solo quiere las decisiones deportivas. Se construirá después de
tener el modo Completo funcional, quitando pantallas en vez de duplicando
lógica.

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
