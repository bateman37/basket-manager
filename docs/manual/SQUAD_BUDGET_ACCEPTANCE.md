# Prueba manual — SQUAD-BUDGET-1 (presupuesto salarial de plantilla)

Checklist para Dennis. Es documental: nada aquí se ha ejecutado por esta
sesión (no hay navegador/Playwright en este entorno) — la batería
automatizada (`scripts/test-squad-budget1.js`, 16/16 OK, más
`test-market1.js`/`test-cycle1.js`/`test-save-load1.js` sin regresiones
nuevas) verifica la aritmética y la persistencia a nivel de motor; esta
guía es la validación JUGABLE que solo un navegador real puede confirmar.

## Qué es y qué NO es esta pantalla

Finanzas muestra el **presupuesto salarial de plantilla** (cuánto puedes
gastar en salarios de jugadores esta temporada) — no es la caja del club,
ni sus ingresos, ni su beneficio. Esos conceptos llegarán en una entrega
futura de economía completa.

## Checklist

1. **Abrir la pestaña "Finanzas" desde cualquier club.** Confirmar que
   aparece sin error de consola y muestra la tarjeta principal (Asignado/
   Comprometido/Reservado/Disponible/% usado) con números que cuadran
   (Comprometido + Reservado + Disponible mostrado — el "excedido", si
   aparece, es la diferencia positiva).

2. **El aviso de estimación aparece cuando corresponde.** Al empezar una
   carrera nueva (o justo tras abrir una temporada nueva), la tarjeta de
   arriba debe mostrar un aviso de que la asignación es una "estimación de
   compatibilidad" — nunca presentada como un dato financiero real.

3. **Fichar (o intentar fichar) un jugador desde Mercado consume el
   presupuesto real.** Enviar una oferta y comprobar que "Reservado" sube
   en Finanzas; al aceptarse (Agreement in Principle) y formalizarse el
   fichaje, "Reservado" baja y "Comprometido" sube en la misma cuantía
   (nunca los dos a la vez para el mismo jugador).

4. **Una oferta que no cabe se bloquea con el mensaje correcto.** Intentar
   una oferta claramente por encima del disponible: el formulario debe
   mostrar un error que diga que supera el presupuesto salarial
   disponible, que no puede completarse, y que haría falta autorización de
   la junta para ampliarlo — y que las peticiones a la junta todavía no
   están disponibles. Confirmar que NO se crea ninguna oferta ni reserva
   parcial (recargar Mercado y comprobar que no queda nada a medias).

5. **Una cesión reparte el coste correctamente.** Con un jugador cedido
   (propio o entrante), confirmar en la tabla "Contribución por jugador"
   que el club propietario muestra solo su parte retenida (badge "Cedido
   fuera") y el club cesionario muestra solo la parte que asume (badge
   "Cedido a este club") — nunca el salario completo duplicado en ambos.

6. **"Otras temporadas" muestra lo esperado.** Debe listar cualquier
   temporada con asignación, compromiso (contrato multi-temporada) o
   reserva viva — no solo la temporada actual.

7. **Historial de asignaciones/revisiones es legible.** Debe mostrar al
   menos la fila de apertura de la temporada actual, con su política y
   autoridad.

8. **Cerrar temporada y comprobar la apertura de la siguiente.** Tras
   cerrar temporada (ciclo anual completo), la pantalla Finanzas de la
   temporada nueva debe mostrar ya una asignación (congelada desde la
   referencia de nómina de apertura), sin que haga falta ninguna acción
   manual.

9. **Guardar, recargar la página y cargar la partida.** Confirmar que
   Finanzas muestra exactamente los mismos números que antes de guardar
   (asignación, historial, contribución por jugador).

10. **Anchura móvil.** Con la ventana estrecha (o el modo móvil del
    navegador), confirmar que las tablas de Finanzas se desplazan
    horizontalmente dentro de su propio contenedor — la página en sí no
    debe desplazarse lateralmente.

## Pendiente (no forma parte de esta checklist)

Peticiones jugables de ampliación de presupuesto a la junta, confianza de
junta, caja/ingresos reales del club — ver `docs/epics/SQUAD-BUDGET-1.md`,
sección "Deuda aplazada".
