# DESIGN.md — Basket Manager

Documento de diseño del juego. Este archivo es la referencia de reglas para
cualquier sesión de desarrollo (humana o de Claude Code). Si una duda de
implementación no está resuelta aquí, hay que preguntar al diseñador (Dennis)
antes de asumir una respuesta.

## 1. Visión general

Manager de baloncesto al estilo **PC Basket / PC Fútbol**, con un modo
completo que fusiona presidencia + entrenador en un único rol de jugador
(no hay "sombreros" separados: el usuario decide fichajes, finanzas,
tácticas y entrenamientos desde el mismo perfil).

Más adelante se derivará un **modo Manager simple** (estilo Football
Manager: solo gestión, sin pantallas de presidencia) reutilizando el mismo
motor, quitando funciones en vez de añadirlas.

## 2. Estado del proyecto

- **Fase actual:** motor jugable con datos de prueba/ficticios.
- **En paralelo:** construcción progresiva de una base de datos con
  jugadores y equipos reales (ACB primero, luego LEB y clubes europeos
  relevantes), estadística por estadística, como proceso de contenido
  separado del desarrollo del motor.
- Los datos reales se cargan en el mismo formato que los datos ficticios,
  así que el motor no necesita cambios cuando se sustituyen.

⚠️ **Nota legal activa:** el proyecto usa nombres reales de jugadores y
clubes para uso privado. Si en el futuro se comercializa, hay que revisar
esto (ver sección 12).

## 3. Estructura de competición (primer hito)

- **1ª división** (18 equipos, estructura tipo ACB) + **2ª división**
  (18 equipos, estructura tipo Primera FEB / LEB Oro), cada una con
  calendario completo ida y vuelta.

### Ascensos y descensos (basado en el sistema real ACB / Primera FEB)

- **2 plazas de ascenso** de 2ª a 1ª división por temporada:
  1. El **campeón de la liga regular** de 2ª división asciende directo.
  2. La segunda plaza se decide por un **playoff de ascenso** entre los
     siguientes mejores clasificados de la liga regular de 2ª división
     (formato completo real: **cuartos de final + Final Four**, número de
     equipos participantes y bombos a definir en detalle al implementar
     este sistema).
  3. El subcampeón de la Copa de 2ª división obtiene mejor posición
     (ventaja de cuadro) en el playoff de ascenso, pero no asciende
     directo por ganar la copa — solo mejora su cabeza de serie.
- **2 plazas de descenso** de 1ª a 2ª división: los 2 últimos clasificados
  de la liga regular de 1ª división.
- **Playoffs por el título de 1ª división**: los **8 primeros** de la liga
  regular disputan el playoff por el campeonato, bracket fijo sin
  repesca (igual que el playoff real de ACB).
- **2ª división NO tiene playoff por el título**: el campeón de la liga
  regular de 2ª división es directamente el campeón de esa división (los
  únicos playoffs en 2ª división son los de ascenso, ver arriba).

### Copa y Supercopa

- **Copa**: a mitad del calendario de liga, participan los **8 primeros
  clasificados** de la liga regular en ese momento (igual que la Copa del
  Rey actual de la ACB).
- **Supercopa** (formato corto, equipos clasificados por resultados de la
  temporada anterior — a definir criterio exacto más adelante).
- **Competición europea**: los clubes "grandes" están siempre asignados a
  la misma competición europea cada año (sin sistema de clasificación
  dinámico todavía — se revisará más adelante). Un ascenso/descenso de
  división no afecta, por ahora, a la participación europea de estos
  clubes fijos.

## 4. Inicio de partida

- El usuario **elige libremente** con qué club empezar, de primera o
  segunda división, sin restricciones de nivel ni de presupuesto.
- La carrera **no está atada a un solo club**: el usuario puede ser
  despedido (por malos resultados/directiva descontenta) o fichar por
  otro club, como en Football Manager.

## 5. Economía del club

Presupuesto **dinámico**, calculado a partir de ingresos reales del club:

- Taquilla (entradas vendidas, según aforo, resultados recientes, rival)
- Ingresos por TV/retransmisión
- Patrocinios
- Méritos deportivos (premios por clasificación, competiciones europeas)

Gastos: salarios de jugadores, cuerpo técnico, instalaciones,
scouting, cláusulas de fichaje.

*(Fórmulas exactas de cada partida se definirán en detalle cuando se
implemente el módulo económico — este documento se ampliará entonces.)*

## 6. Jugadores y equipos

- **Nombres y datos reales** para las dos primeras ligas españolas y los
  clubes europeos más relevantes que participan en competición europea.
- Atributos de juego (tiro, defensa, físico, potencial, etc.) derivados de
  estadísticas y reportajes reales, lo más fieles posible al rendimiento
  real de cada jugador — construidos progresivamente, no todos de golpe.
- Los clubes europeos "grandes" están fijos en su competición europea cada
  temporada por ahora (sin lógica de clasificación aún).
- **Fase de arranque:** mientras se construye la base de datos real, el
  motor funciona con jugadores y equipos ficticios generados para poder
  probar y jugar desde ya.

## 7. Simulación de partidos

Nivel de detalle: **medio** — por cuartos, con eventos destacados
(ej. tapón decisivo, triple sobre la bocina, parcial de anotación,
lesión durante el partido). No es simulación jugada a jugada completa,
pero tampoco es solo un resultado final frío.

## 8. Roles y control del club

Un único rol de usuario que controla:

- Fichajes y renovaciones
- Tácticas y alineaciones
- Entrenamientos y desarrollo de jugadores
- Finanzas y presupuesto
- Contratación de staff (cuerpo técnico, scouts, médicos)
- Relación con la directiva/afición (objetivos de temporada, presión)

## 9. Progresión de jugadores

*(Pendiente de definir en detalle: curvas de edad, entrenamiento,
lesiones, decadencia por edad. Se completará en una próxima sesión de
diseño antes de programar el módulo de progresión.)*

## 10. Modo Manager (futuro, derivado del modo Completo)

Mismo motor, pero sin pantallas de gestión de presidencia — pensado para
quien solo quiere las decisiones deportivas. Se construirá después de
tener el modo Completo funcional, quitando pantallas en vez de duplicando
lógica.

## 11. Plataforma

- Desarrollo en **JavaScript/HTML** (sin frameworks pesados), pensado para
  jugarse en navegador de escritorio y móvil.
- Posibilidad futura de empaquetar como app móvil (PWA o similar) sin
  rehacer el motor.

## 12. Nota sobre comercialización futura

Proyecto privado por ahora. Si se decide comercializar en el futuro:

- Quitar todos los logos/escudos oficiales (ya contemplado desde el
  principio).
- Revisar el uso de nombres reales de jugadores y clubes — probablemente
  sustituir por una capa de nombres ficticios/generados, manteniendo los
  atributos y la estructura de datos ya construida.
- Esta decisión se pospone deliberadamente; no bloquea el desarrollo
  actual.
