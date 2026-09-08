# Prueba manual — cierre de World Architecture (hasta WORLD-CLEANUP-1) + REPO-HARDEN-1

Checklist para Dennis. Es documental: nada aquí se ha ejecutado por esta
sesión (no hay Playwright ni navegador en este entorno) — es la guía para
la prueba manual amplia antes de dar por buena la entrega. No expone
ningún botón técnico ni fingerprint al jugador; solo describe qué probar
y qué anotar si algo falla.

World Architecture se declaró **estructuralmente cerrada** con
`WORLD-CLEANUP-1` (DESIGN.md 10.21): ningún dominio productivo decide ya
por `Team.division`/división legacy/mapas fijos de UI — la interfaz
muestra siempre el nombre real de la competición, nunca "1ª"/"2ª"
división. La deuda estructural que sobrevive, documentada y no oculta,
es la retirada física del ARCHIVO `src/core/Calendar.js` — sigue
requerido por ~20 `scripts/*.js` históricos, así que se conserva en
disco; `REPO-HARDEN-1` solo confirmó que no tiene callers productivos
reales y quitó su `<script>` (carga en el navegador) de `index.html`
(ver paso 8 más abajo) — y la validación funcional manual completa de
abajo, que sigue pendiente de Dennis.

## 1. Crear una carrera nueva

- Abrir `index.html` → "Empezar temporada".
- Pantalla de configuración: pasos "Mundo" → "Competiciones" → "Club".
- Elegir un club de **ACB** (por ejemplo Unicaja) y confirmar "Comenzar
  carrera". Anotar: ¿se construye la carrera sin errores en consola?
- Repetir desde cero eligiendo un club de **Primera FEB**.
- Elegir **MoraBanc Andorra** específicamente (es el caso transfronterizo
  de referencia) y confirmar que la carrera arranca sin error.

## 2. Navegar Mundo/Europa/España/Andorra y volver

- Desde Inicio, abrir la pantalla "Mundo".
- Navegar Mundo → Europa → España → ACB / Primera FEB / Copa ACB.
- Navegar también hasta Andorra (MoraBanc).
- Volver atrás en cada nivel y confirmar que la navegación no deja la
  pantalla en un estado raro (breadcrumbs, competiciones listadas).

## 3. Jugar/continuar hasta Copa y playoff

- Pulsar "Continuar" repetidamente hasta la primera parada de partido del
  usuario. Jugar ese partido.
- Seguir "Continuar" hasta que se active la Copa (jornada 17) — comprobar
  que aparece la noticia de creación del bracket.
- Seguir hasta que se activen playoff por el título (ACB) / playoff de
  ascenso (Primera FEB).
- Anotar cualquier partido que no se resuelva, cualquier parada
  inesperada (CPU-vs-CPU parando al usuario, o al revés) o cualquier
  noticia con nombre de competición incorrecto.

## 4. Cerrar una temporada — ascenso/descenso y temporada siguiente

- Cuando la liga esté "lista para cerrar", pulsar "Cerrar temporada".
- Confirmar: 2 equipos ascienden desde Primera FEB, 2 descienden desde
  ACB; el resumen de cierre muestra los nombres correctos.
- Confirmar que la temporada siguiente arranca con 18+18 equipos, sin
  huecos ni duplicados, y que el calendario sigue avanzando (nunca vuelve
  a "jornada 1" del reloj real).
- Anotar la fecha de juego exacta del cierre si algo falla.

## 5. Contrato, inscripción, mercado, operación y cesión de un jugador

- Abrir la ficha de un jugador del club controlado — pestaña "Contrato"
  (solo lectura) y "Licencia y elegibilidad" (solo lectura).
- Ir a Mercado → Negociaciones: abrir una negociación con un jugador de
  otro club, llegar a un Agreement in Principle.
- Formalizar el traspaso (pestaña de formalización real).
- Ir a Mercado → Cesiones: ceder un jugador propio a otro club.
- Confirmar que Contratos/Inscripciones reflejan los cambios (badge
  "Cedido fuera", nueva ficha de contrato tras el traspaso) sin que
  ninguna de esas dos pantallas gane botones de acción nuevos.

## 6. Ficha e histórico antes/después del cambio

- Abrir la ficha de un jugador ANTES de cerrar una temporada — anotar el
  nombre de la competición mostrada (nunca debería aparecer "1ª"/"2ª"
  división como tal, `Team.division` está retirado del motor).
- Cerrar la temporada (paso 4).
- Reabrir la MISMA ficha — confirmar que el histórico de temporada
  cerrada muestra el club/competición correctos de la temporada que
  terminó (no la nueva), y que la temporada nueva ya aparece activa. Si
  el jugador jugó Liga + Copa esa temporada, confirmar que la ficha
  muestra AMBOS bloques de estadísticas por competición sin duplicar el
  total.

## 7. Repetir en móvil

- Repetir los pasos 1, 2 y 3 (arranque, navegación Mundo, un partido) en
  una ventana estrecha o un móvil real.
- Anotar cualquier elemento cortado, botón inalcanzable o tabla que
  desborde la pantalla.

## 8. Modo prueba (verificación técnica, no de diseño de juego)

- Abrir `index.html` → botón "Modo prueba" (la otra entrada de la
  landing, no "Empezar temporada").
- Confirmar que arranca sin errores en la consola del navegador — esto
  confirma que quitar el `<script src="src/core/Calendar.js">` de
  `index.html` (REPO-HARDEN-1, sin callers reales desde
  WORLD-CALENDAR-1) no rompe nada: el archivo se conserva en disco, solo
  se dejó de cargar en el navegador.

## Cómo anotar una incidencia

Para cada fallo, anotar:

1. Pantalla donde ocurrió (nombre exacto del menú/pestaña).
2. Equipo controlado y competición.
3. Fecha de juego exacta (la que muestra la cabecera, no la fecha real).
4. Pasos exactos para reproducirlo desde "Comenzar carrera".
5. Qué se esperaba vs. qué pasó.
