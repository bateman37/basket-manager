# Prueba manual — SIM-CAL-1 (avance cooperativo y cancelable de "Continuar")

Checklist para Dennis. Es documental: nada aquí se ha ejecutado por esta
sesión (no hay navegador/Playwright en este entorno) — la batería
automatizada (`scripts/test-sim-cal1.js`, 10/10 OK, más
`test-world-calendar1.js`/`test-world-sim1.js`/`test-save-load1.js` sin
regresiones) verifica el algoritmo de calendario y el driver cooperativo a
nivel de motor; esta guía es la validación JUGABLE que solo un navegador
real puede confirmar.

## Checklist

1. **Arrancar o cargar una carrera y pulsar "Continuar".** Confirmar que
   el mundo avanza y llega a una parada real (partido del usuario,
   atención de mercado, cierre de temporada...) sin errores en consola.

2. **La interfaz sigue respondiendo y solo arranca UNA operación tras
   clicks rápidos.** Pulsar "Continuar" varias veces seguidas muy rápido
   (o hacer click repetido mientras el overlay está visible): comprobar
   que no aparecen dos overlays, no se duplican resultados, y la página no
   se congela mientras avanza.

3. **El overlay solo aparece en avances suficientemente largos y muestra
   fecha/contadores.** Un "Continuar" corto (un solo partido inmediato) no
   debería mostrar el overlay en absoluto; un avance largo (varias
   jornadas automáticas antes de la próxima parada) debería mostrar
   "Simulando mundo…" con la fecha simulada actual y "Eventos procesados"/
   "Partidos" creciendo.

4. **Pedir cancelación y comprobar que vuelve a Inicio en un estado
   válido.** Con el overlay visible, pulsar "Detener tras este bloque".
   Comprobar: el botón se deshabilita al momento, la simulación se para
   pronto (no espera a terminar toda la operación), y aparece en Inicio un
   aviso pequeño (no de error) indicando que el mundo se detuvo en un
   punto seguro.

5. **Continuar de nuevo tras cancelar y comprobar que nada se duplica.**
   Pulsar "Continuar" otra vez: debe seguir avanzando con normalidad desde
   donde se quedó, sin repetir ni perder ningún partido/evento ya resuelto
   (comprobar Agenda/Noticias/clasificación por si hay algo duplicado).

6. **Una decisión de mercado antes del próximo partido se alcanza aunque
   la alineación sea inválida.** Provocar (o esperar a) una atención de
   mercado con plazo antes del siguiente partido del usuario, con una
   alineación deliberadamente incompleta: "Continuar" debe llevar a la
   tarjeta de mercado en Inicio, NUNCA redirigir a "Alineación" solo
   porque esté inválida.

7. **Una alineación inválida solo redirige cuando la parada real es el
   partido del usuario.** Con alineación inválida y sin ninguna atención
   de mercado pendiente antes, "Continuar" debe llevar a la pantalla
   "Alineación" cuando la parada real alcanzada es, de hecho, el partido
   del usuario.

8. **Guardar/cargar están indisponibles mientras avanza y disponibles al
   parar.** Mientras el overlay está visible, comprobar que en la pantalla
   "Partida" los botones "Guardar aquí"/"Sobrescribir"/"Cargar"/"Eliminar"
   aparecen deshabilitados (o el intento de guardar es rechazado con un
   motivo legible); tras terminar/cancelar la simulación, deben volver a
   estar disponibles con normalidad.

9. **Completar el partido del usuario y confirmar que el autoguardado
   sigue funcionando.** Jugar y confirmar un partido completo del usuario;
   comprobar en "Partida" que la ranura `Autoguardado` se actualiza como
   antes de esta Epic (sin cambios de comportamiento aquí).

10. **Comprobar el overlay y el control de cancelación en anchura móvil.**
    Reducir la ventana (o usar las herramientas de dispositivo móvil del
    navegador) durante un avance largo: el overlay y el botón "Detener
    tras este bloque" deben seguir siendo legibles y usables, sin
    desbordar la pantalla.

## Notas

- Ningún resultado deportivo, orden de partidos ni regla de calendario
  cambia en esta Epic — si algo de eso parece distinto, es una regresión
  real, no un efecto esperado de SIM-CAL-1.
- Si el checklist descubre un caso no cubierto, anotarlo en
  `docs/epics/SIM-CAL-1.md` (sección "Deuda aplazada") antes de cerrarlo
  como resuelto.
