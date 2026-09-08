# Prueba manual — SAVE-LOAD-1 (guardado y carga reales de una carrera)

Checklist para Dennis. Es documental: nada aquí se ha ejecutado por esta
sesión (no hay navegador/Playwright en este entorno) — la batería
automatizada (`scripts/test-save-load1.js`, 12/12 OK) verifica el
round-trip a nivel de motor; esta guía es la validación JUGABLE que solo
un navegador real puede confirmar.

## 1. Crear, guardar y recargar

1. Abrir `index.html` → "Empezar temporada" → elegir un club real (ACB o
   Primera FEB) → "Comenzar carrera". Anotar: ¿aparece Home sin errores
   en consola?
2. Abrir el menú "Partida" (nav) → comprobar que aparecen las 4 ranuras
   (`Ranura manual 1/2/3`, `Autoguardado`) — el autoguardado debería
   tener ya una entrada (checkpoint tras el bootstrap).
3. Pulsar "Guardar aquí" en `Ranura manual 1`. Anotar: ¿aparece con club/
   temporada/fecha correctos y la hora de guardado?

## 2. Alterar, avanzar y guardar de nuevo

1. Cambiar la alineación (pestaña "Alineación"), ajustar entrenamiento y
   táctica.
2. Avanzar hasta jugar y **confirmar** un partido completo del usuario
   (llegar a "Volver a Inicio" tras el resultado) — este es un checkpoint
   de autoguardado: comprobar en "Partida" que `Autoguardado` se
   actualizó a la fecha/jornada nueva.
3. Guardar manualmente en `Ranura manual 2` (sobrescribir si ya existía).

## 3. Recargar el navegador y continuar

1. Recargar `index.html` por completo (F5).
2. En la landing, deberían aparecer ahora los botones **"Continuar"** y
   **"Cargar partida"** (antes no estaban, porque no había ninguna
   ranura guardada). Pulsar **"Continuar"**.
3. Comprobar EXACTAMENTE contra el estado de antes de recargar: fecha de
   juego, club/plantilla, contratos (pestaña Contratos), tabla de la
   Liga, resultados ya jugados, noticias/agenda, alineación/táctica/
   entrenamiento tal como se dejaron.
4. Pulsar "Continuar"/avanzar un partido más y comprobar que **no se
   repite** ningún partido ni evento ya visto antes de recargar (ni
   duplicado en la tabla, ni noticia repetida).

## 4. Cargar una ranura manual concreta

1. Desde "Partida" (o desde la landing con "Cargar partida" sin haber
   entrado antes a la carrera), cargar `Ranura manual 1` (el guardado más
   antiguo del paso 1).
2. Comprobar que la carrera vuelve exactamente al punto de ESE guardado
   (fecha/jornada anterior a los cambios del paso 2) — confirma que
   cargar una ranura antigua no arrastra nada de una ranura más reciente.

## 5. Autoguardado, sobrescritura, borrado y errores

1. Cerrar temporada (si el avance de la carrera lo permite) y comprobar
   que `Autoguardado` se actualiza también en ese checkpoint.
2. Sobrescribir `Ranura manual 2` con la partida actual y confirmar el
   diálogo de confirmación.
3. Eliminar `Ranura manual 3` (vacía) y una ranura con contenido —
   confirmar el diálogo de "no se puede deshacer" y que desaparece de la
   lista tras eliminar.
4. Si el navegador tiene el almacenamiento local desactivado/bloqueado
   (modo privado estricto, cuota agotada): comprobar que la pantalla
   "Partida" muestra un error legible en vez de romper la interfaz, y que
   la carrera abierta sigue jugándose con normalidad (el fallo de guardado
   nunca debe tirar la partida).

## 6. Guardado bloqueado durante un partido

1. Empezar un partido del usuario (llegar a la pantalla de marcador antes
   de "Volver a Inicio").
2. Ir a "Partida" (nav) mientras el partido sigue en pantalla —
   confirmar que los botones de "Guardar aquí"/"Sobrescribir" aparecen
   deshabilitados con un aviso ("Hay un partido en curso...").

## 7. Carga inválida no destruye la carrera abierta

1. Con una carrera abierta y jugable, intentar cargar una ranura mientras
   la propia sesión de DevTools está simulando una IndexedDB fallando
   (opcional, solo si es cómodo de forzar) — o simplemente confirmar que
   cancelar el diálogo de confirmación de "Cargar" no cambia nada.
2. (Si es posible) Editar manualmente en DevTools → Application →
   IndexedDB → `basket-manager` → `career-saves` un registro para
   corromper su `fingerprint`, y confirmar que "Cargar" en esa ranura
   muestra un error legible y la carrera actualmente abierta sigue
   intacta (no se congela ni se resetea sola).

## 8. Anchura móvil

1. Reducir la ventana del navegador a ~375px de ancho (o usar el modo
   responsive de DevTools).
2. Comprobar que la landing (botones "Continuar"/"Empezar temporada"/
   "Cargar partida") y la pantalla "Partida" (tarjetas de ranura) se
   apilan en una columna legible, sin desbordamiento horizontal.

---

Si algo falla en cualquier paso, anota: paso exacto, mensaje de consola
(si lo hay), y si la carrera activa quedó afectada o no. Repórtalo para
que una sesión futura lo investigue contra `scripts/test-save-load1.js`
(añadiendo un caso si el fallo no estaba cubierto).
