# Checklist manual — ECONOMY-BOARD-1 (Dennis, navegador real)

Ninguna sesión de Claude Code ha ejecutado este checklist — se declara
pendiente explícitamente (CLAUDE.md, sección "Trabajo ajeno y fusiones").
Recuerda que todas las cifras que verás son **simulación de juego**
(`simulated-club-finance-v1`/`simulated-manager-board-v1`/
`simulated-board-budget-request-v1`) — no son cuentas reales del club ni
una certificación del reglamento económico de ninguna competición real.

## 1. Pantalla Finanzas

- [ ] Abre "Finanzas" con tu club. Debe verse el presupuesto salarial de
      siempre (SQUAD-BUDGET-1) MÁS: resumen económico (caja actual,
      reserva mínima, caja proyectada, resultado de temporada, contador
      de impagos), tesorería (próximos movimientos, impagos pendientes,
      compromisos sin fecha), presupuesto planificado por categoría y
      proyección a 3 temporadas con margen de ampliación por temporada.
- [ ] Los avisos de "simulación, no cuentas reales" son visibles y
      legibles, no solo en un tooltip oculto.

## 2. Solicitar ampliación desde Finanzas

- [ ] En la pestaña "Solicitar ampliación", elige una temporada, prueba
      los botones +5%/+10%/+20% (deben rellenar el importe) y envía una
      petición con un importe propio.
- [ ] Tras enviar, la pestaña muestra "petición pendiente" con la fecha
      de respuesta esperada, y el botón de enviar desaparece/se
      deshabilita mientras esté pendiente.
- [ ] Avanza el mundo ("Continuar") hasta pasar la fecha de respuesta —
      Continuar NO debe detenerse por esto (es un evento automático); al
      terminar de avanzar, revisa "Noticias": debe haber una entrada de
      la decisión de la junta (aprobada/parcial/rechazada) con una
      explicación en español.
- [ ] Si la decisión aprobó o aprobó parcialmente, comprueba en Finanzas
      que el límite del presupuesto salarial (SQUAD-BUDGET-1) subió
      exactamente el importe aprobado.
- [ ] Intenta enviar otra petición inmediatamente — debe rechazarse por
      cooldown compartido (60 días si hubo aprobación/parcial, 30 si fue
      rechazo), con el motivo visible.

## 3. Solicitar autorización desde una oferta de mercado bloqueada

- [ ] En "Mercado", construye una oferta que exceda claramente el
      presupuesto salarial disponible. Debe aparecer el error de
      presupuesto de siempre MÁS un botón "Solicitar autorización a la
      directiva".
- [ ] Si ya hay una petición pendiente (por ejemplo, tras el paso 2), el
      botón debe mostrar el motivo por el que está bloqueado en vez de
      permitir un segundo envío.
- [ ] Envía la petición desde aquí (con el cooldown ya libre) y confirma
      que reutiliza el MISMO mecanismo — no debe crear ninguna oferta,
      AIP o reserva de presupuesto por sí sola.
- [ ] Tras la resolución, la oferta original bloqueada NO se reenvía
      sola — debes volver a construirla y enviarla manualmente contra el
      nuevo límite.

## 4. Pantalla Directiva

- [ ] Abre "Directiva": debe mostrar desde cuándo está empleado el
      manager, el estilo fiscal de la junta, los objetivos deportivo y
      financiero (en español, coherente), las 3 barras de confianza
      (deportiva/disciplina financiera/relación) con su desglose y la
      confianza global, y el historial de peticiones.
- [ ] No debe haber ningún control de propietario (fijar presupuesto,
      sponsors, precios) — es una pantalla de solo lectura salvo el
      enlace conceptual a Finanzas.

## 5. Impagos visibles

- [ ] Si es posible forzar un impago (una temporada con caja muy
      ajustada, o esperar varios meses de mundo sin ingresos suficientes),
      confirma que aparece en "Tesorería" y que produce una noticia
      cuando afecta a tu club — sin bloquear "Continuar".
- [ ] Confirma que, mientras haya un impago obligatorio pendiente, el
      botón de solicitar ampliación queda bloqueado con el motivo
      explícito.

## 6. Cierre de temporada

- [ ] Cierra una temporada completa ("Cerrar temporada" en Home/
      Planificación). Al reabrir Finanzas/Directiva en la temporada
      nueva: debe existir un plan financiero para la temporada que
      empieza (y las 2 siguientes dentro del horizonte), y en Directiva
      debe verse una nueva entrada en el historial de evaluación de
      temporada del manager (implícita en la confianza de
      relación/antigüedad, que debería reflejar el resultado deportivo
      real de la temporada cerrada).

## 7. Guardado/carga y migración

- [ ] Guarda la partida, recarga la página y carga esa misma ranura —
      Finanzas/Directiva deben mostrar exactamente el mismo estado
      (mismo presupuesto, misma caja, mismas peticiones/historial).
- [ ] Si tienes una partida guardada ANTES de esta entrega (schemaVersion
      1 o 2), cárgala: debe abrir sin error, con un perfil/plan
      financiero y un manager/junta recién creados en la fecha actual de
      esa partida (nunca con impagos históricos inventados ni meses ya
      pasados programados retroactivamente). Guárdala de nuevo y confirma
      que la ranura ya queda en el formato nuevo.

## 8. Anchura móvil

- [ ] Reduce la ventana al ancho de un móvil — Finanzas y Directiva deben
      seguir siendo usables (tablas con scroll horizontal propio, botones
      accesibles, sin desbordar la página).
