# Prueba manual — cierre de World Architecture (WORLD-HARDEN-1)

Checklist para Dennis. Es documental: nada aquí se ha ejecutado por esta
sesión (no hay Playwright ni navegador en este entorno) — es la guía para
la prueba manual amplia antes de dar por buena la entrega. No expone
ningún botón técnico ni fingerprint al jugador; solo describe qué probar
y qué anotar si algo falla.

Recuerda: esta entrega quedó **parcial** (ver `DESIGN.md` sección 10.19.2
y `CHANGELOG.md`) — hay deuda pendiente explícita que NO afecta a la
partida española observable, pero sí a limpieza interna. La prueba
manual de abajo se centra en confirmar que la partida española sigue
funcionando exactamente igual que antes.

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

- Abrir la ficha de un jugador ANTES de cerrar una temporada — anotar su
  división/competición mostrada.
- Cerrar la temporada (paso 4).
- Reabrir la MISMA ficha — confirmar que el histórico de temporada
  cerrada muestra la división/club correctos de la temporada que
  terminó (no la nueva), y que la temporada nueva ya aparece activa.

## 7. Repetir en móvil

- Repetir los pasos 1, 2 y 3 (arranque, navegación Mundo, un partido) en
  una ventana estrecha o un móvil real.
- Anotar cualquier elemento cortado, botón inalcanzable o tabla que
  desborde la pantalla.

## Cómo anotar una incidencia

Para cada fallo, anotar:

1. Pantalla donde ocurrió (nombre exacto del menú/pestaña).
2. Equipo controlado y competición.
3. Fecha de juego exacta (la que muestra la cabecera, no la fecha real).
4. Pasos exactos para reproducirlo desde "Comenzar carrera".
5. Qué se esperaba vs. qué pasó.
