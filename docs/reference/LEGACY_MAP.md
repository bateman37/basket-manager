# LEGACY_MAP — referencias antiguas → destino nuevo

Correspondencia completa entre cada sección de los tres documentos
originales (commit base `83b85d1`) y su destino en la nueva estructura.
Los originales siguen recuperables en Git en ese commit
(`git show 83b85d1:DESIGN.md`, etc.) — esta migración trasladó el
conocimiento útil a los nuevos destinos, no se limitó a borrar y remitir
a Git.

Tratamientos usados: **trasladado** (contenido movido literalmente al
nuevo documento), **trasladado (histórico)** (movido a una ficha de Epic
o a `docs/history/`, porque describe una entrega ya cerrada), **consolidado**
(resumido/reescrito dentro de un documento de entrada corto —
`CLAUDE.md`/`DESIGN.md`/`docs/STATUS.md` — sin perder la regla, que vive
también en su documento temático si aplica), **sustituido, con evidencia**
(la afirmación antigua se reemplazó por la vigente, con la razón
documentada), **pendiente de aclaración** (no hay evidencia suficiente
para resolver una contradicción — señalada, no inventada).

Referencias como `DESIGN.md 7.12.24` o `10.21` se localizan buscando el
número de sección en la columna "Sección original" de la tabla
correspondiente.

## DESIGN.md (10 696 líneas originales)

| Línea original | Sección original | Destino | Tratamiento |
|---|---|---|---|
| 1 | DESIGN.md — Basket Manager | — | descartado (frontmatter) |
| 8 | 　1. Visión general | DESIGN.md (§1 Visión) | consolidado |
| 32 | 　2. Estado del proyecto | DESIGN.md (§2 Estado) / docs/STATUS.md | consolidado |
| 61 | 　3. Estructura de competición (primer hito) | docs/design/competitions-spain.md | trasladado |
| 86 | 　　3.1 Liga y Calendario | docs/design/competitions-spain.md | trasladado |
| 124 | 　　3.2 Playoffs, Copa y Playoff de ascenso | docs/design/competitions-spain.md | trasladado |
| 146 | 　　　3.2.1 Pieza base: `Bracket`/`Series` | docs/design/competitions-spain.md | trasladado |
| 164 | 　　　3.2.2 Playoff por el título (1ª división) | docs/design/competitions-spain.md | trasladado |
| 176 | 　　　3.2.3 Playoff de ascenso (2ª división) | docs/design/competitions-spain.md | trasladado |
| 204 | 　　　3.2.4 Copa (1ª división) | docs/design/competitions-spain.md | trasladado |
| 226 | 　　　3.2.5 Flujo de juego (interfaz) | docs/design/competitions-spain.md | trasladado |
| 238 | 　　3.3 Entidad Calendario (fechas reales de partido) | docs/design/competitions-spain.md | trasladado |
| 255 | 　　　3.3.1 Liga regular: generación de fechas | docs/design/competitions-spain.md | trasladado |
| 332 | 　　　3.3.2 Copa: interrupción real de la liga | docs/design/competitions-spain.md | trasladado |
| 367 | 　　　3.3.3 Playoffs y Ascenso: fechas dinámicas por serie | docs/design/competitions-spain.md | trasladado |
| 401 | 　　　3.3.4 Días de descanso de un jugador (para Recovery, 7.11.5) | docs/design/competitions-spain.md | trasladado |
| 426 | 　　　3.3.5 Reloj de mundo (CAL-1, reescrito en WORLD-CALENDAR-1) | docs/design/competitions-spain.md | trasladado |
| 456 | 　　　3.3.6 Resolución cronológica y parcial de jornada (CAL-1) | docs/design/competitions-spain.md | trasladado |
| 522 | 　　　3.3.7 Recovery y horario real: decisión tomada | docs/design/competitions-spain.md | trasladado |
| 551 | 　　3.4 Cierre de ciclo de temporada y pretemporada | docs/design/competitions-spain.md | trasladado |
| 568 | 　　　3.4.1 Las dos divisiones se simulan SIEMPRE, en paralelo | docs/design/competitions-spain.md | trasladado |
| 623 | 　　　3.4.2 Fin de temporada regular: ascensos y descensos reales | docs/design/competitions-spain.md | trasladado |
| 675 | 　　　3.4.3 Cálculo de `board.sportingGoal` (sustituye el valor fijo) | docs/design/competitions-spain.md | trasladado |
| 721 | 　　　3.4.4 Pretemporada: qué se recalcula antes del nuevo calendario | docs/design/competitions-spain.md | trasladado |
| 744 | 　　　Pendiente para sesiones de diseño futuras (Cierre de ciclo) | docs/design/competitions-spain.md | trasladado |
| 759 | 　　3.5 Modelo de evento, Agenda y Noticias (CAL-2) | docs/design/events-agenda-news.md | trasladado |
| 767 | 　　　3.5.1 Modelo de evento | docs/design/events-agenda-news.md | trasladado |
| 828 | 　　　3.5.2 Noticias — catálogo, fuente real y prioridad | docs/design/events-agenda-news.md | trasladado |
| 896 | 　　　3.5.3 Agenda | docs/design/events-agenda-news.md | trasladado |
| 929 | 　　　3.5.4 `renderCalendarScreen()` y Agenda son pantallas distintas | docs/design/events-agenda-news.md | trasladado |
| 940 | 　　　3.5.5 Home vivo — versión definitiva de este bloque | docs/design/events-agenda-news.md | trasladado |
| 957 | 　　　Nota de cierre del bloque temporal (CAL-1 + CAL-2) | docs/design/events-agenda-news.md | trasladado |
| 966 | 　　Supercopa y competición europea (pendiente) | docs/design/events-agenda-news.md | trasladado |
| 976 | 　　Pendiente para sesiones de diseño futuras (Liga/Calendario) | docs/design/events-agenda-news.md | trasladado |
| 1002 | 　4. Inicio de partida | docs/design/economy-and-modes.md | trasladado |
| 1010 | 　5. Economía del club | docs/design/economy-and-modes.md | trasladado |
| 1021 | 　6. Jugadores y equipos | docs/design/players-attributes.md | trasladado |
| 1051 | 　　6.1 Ficha de jugador | docs/design/players-attributes.md | trasladado |
| 1125 | 　　　Datos Físicos Corporales (reales, no en escala 1-20) | docs/design/players-attributes.md | trasladado |
| 1140 | 　　　Atributos Técnicos (fijos, mejoran con entrenamiento/edad) | docs/design/players-attributes.md | trasladado |
| 1159 | 　　　Atributos Físicos (fijos) | docs/design/players-attributes.md | trasladado |
| 1166 | 　　　Atributos Mentales (fijos) | docs/design/players-attributes.md | trasladado |
| 1179 | 　　　Rasgos (etiquetas, no numéricas) | docs/design/players-attributes.md | trasladado |
| 1184 | 　　　Experiencia | docs/design/players-attributes.md | trasladado |
| 1193 | 　　　Ocultos para el usuario (existen en los datos, revelados vía scouting) | docs/design/players-attributes.md | trasladado |
| 1201 | 　　　Estados dinámicos (cambian constantemente durante la simulación de temporada) | docs/design/players-attributes.md | trasladado |
| 1221 | 　　　Pendiente para sesiones de diseño futuras | docs/design/players-attributes.md | trasladado |
| 1235 | 　　6.2 Ficha de equipo | docs/design/club-team.md | trasladado |
| 1257 | 　　　Datos básicos | docs/design/club-team.md | trasladado |
| 1270 | 　　　Plantilla | docs/design/club-team.md | trasladado |
| 1280 | 　　　6.2.1 Reputación (el "número maestro") | docs/design/club-team.md | trasladado |
| 1302 | 　　　6.2.2 Instalaciones (escala 1-20 cada una) | docs/design/club-team.md | trasladado |
| 1328 | 　　　6.2.3 Cantera/Academia — placeholder actual | docs/design/club-team.md | trasladado |
| 1360 | 　　　6.2.4 Junta/Propietario y objetivos de temporada | docs/design/club-team.md | trasladado |
| 1383 | 　　　6.2.5 Afición y factor cancha | docs/design/club-team.md | trasladado |
| 1398 | 　　　6.2.6 Finanzas — desglose completo de ingresos y gastos | docs/design/club-team.md | trasladado |
| 1426 | 　　　6.2.7 Cuerpo técnico | docs/design/club-team.md | trasladado |
| 1432 | 　　　6.2.8 ADN de Club | docs/design/club-team.md | trasladado |
| 1440 | 　　　6.2.9 Rivalidades | docs/design/club-team.md | trasladado |
| 1450 | 　　　6.2.10 Historia y leyendas de club | docs/design/club-team.md | trasladado |
| 1456 | 　　　Pendiente para sesiones de diseño futuras (Equipo) | docs/design/club-team.md | trasladado |
| 1465 | 　7. Simulación de partidos | docs/design/match-simulation.md | trasladado |
| 1484 | 　　7.1 Arquitectura general del bucle | docs/design/match-simulation.md | trasladado |
| 1524 | 　　7.2 CONFIG como entidad propia del motor | docs/design/match-simulation.md | trasladado |
| 1542 | 　　7.3 Estructura de las fórmulas de acción | docs/design/match-simulation.md | trasladado |
| 1558 | 　　7.3-bis Interceptos base por tipo de tiro (dificultad intrínseca) | docs/design/match-simulation.md | trasladado |
| 1600 | 　　7.4 Modificador de Envergadura (revisión mini-EPIC POS) | docs/design/match-simulation.md | trasladado |
| 1653 | 　　7.5 Presión de Momento (sistema transversal) | docs/design/match-simulation.md | trasladado |
| 1681 | 　　7.5-bis Consistencia (ruido transversal) y Fatiga | docs/design/match-simulation.md | trasladado |
| 1718 | 　　7.6 Catálogo completo de acciones | docs/design/match-simulation.md | trasladado |
| 1728 | 　　　Bloque A — Acciones Base (10) | docs/design/match-simulation.md | trasladado |
| 1782 | 　　　Bloque B — Caminos de Reglamento (3) | docs/design/match-simulation.md | trasladado |
| 1798 | 　　　Bloque C — Acciones Especiales (moduladores contextuales, 8) | docs/design/match-simulation.md | trasladado |
| 1838 | 　　　Bloque D — Estadística derivada (no forma parte del bucle de posesión) | docs/design/match-simulation.md | trasladado |
| 1898 | 　　7.7 Eventos destacados (sin narrar cada posesión) | docs/design/match-simulation.md | trasladado |
| 1909 | 　　7.8 Factor cancha | docs/design/match-simulation.md | trasladado |
| 1920 | 　　7.9 Racha/momento anímico | docs/design/match-simulation.md | trasladado |
| 1928 | 　　7.10 Prórroga | docs/design/match-simulation.md | trasladado |
| 1946 | 　　7.11 Alineaciones, Rotación y Desgaste/Energía | docs/design/lineups-rotation-energy.md | trasladado |
| 1953 | 　　　7.11.1 Convocatoria y posición declarada | docs/design/lineups-rotation-energy.md | trasladado |
| 1970 | 　　　7.11.2 Rotación: cuotas de minutos + quintetos fijos | docs/design/lineups-rotation-energy.md | trasladado |
| 1997 | 　　　7.11.2-bis Minutos de la basura ("garbage time") | docs/design/lineups-rotation-energy.md | trasladado |
| 2034 | 　　　7.11.3 Polivalencia de emergencia (revisión mini-EPIC POS) | docs/design/lineups-rotation-energy.md | trasladado |
| 2096 | 　　　7.11.4 Desgaste de Energía dentro del partido | docs/design/lineups-rotation-energy.md | trasladado |
| 2129 | 　　　7.11.5 Recuperación de Energía entre partidos | docs/design/lineups-rotation-energy.md | trasladado |
| 2221 | 　　　7.11.6 Requisito de frontend — pantalla de alineación | docs/design/lineups-rotation-energy.md | trasladado |
| 2282 | 　　　7.11.7 Alineación automática de equipos gestionados por la CPU | docs/design/lineups-rotation-energy.md | trasladado |
| 2368 | 　7.12 Sistema táctico — ataque, defensa y generación de ventajas | docs/design/tactics/fundamentals.md | trasladado |
| 2400 | 　　7.12.1 Capas del sistema táctico | docs/design/tactics/fundamentals.md | trasladado |
| 2430 | 　　7.12.2 Entidades conceptuales nuevas | docs/design/tactics/fundamentals.md | trasladado |
| 2494 | 　　7.12.3 Nuevo orden de resolución de una posesión | docs/design/tactics/fundamentals.md | trasladado |
| 2537 | 　　7.12.4 `AdvantageState`: la pieza central | docs/design/tactics/fundamentals.md | trasladado |
| 2595 | 　　7.12.5 Calidad de tiro y creación real de la asistencia | docs/design/tactics/fundamentals.md | trasladado |
| 2637 | 　　7.12.6 Sistema ofensivo — estructura de spacing | docs/design/tactics/offense.md | trasladado |
| 2670 | 　　7.12.7 Identidad ofensiva | docs/design/tactics/offense.md | trasladado |
| 2710 | 　　7.12.8 Play Types ofensivos | docs/design/tactics/offense.md | trasladado |
| 2744 | 　　7.12.9 Roles ofensivos | docs/design/tactics/offense.md | trasladado |
| 2834 | 　　7.12.10 Playbook — familias de jugadas | docs/design/tactics/offense.md | trasladado |
| 2900 | 　　7.12.11 Continuidad, counters y Read & React | docs/design/tactics/offense.md | trasladado |
| 2934 | 　　7.12.12 Transición y early offense | docs/design/tactics/offense.md | trasladado |
| 2960 | 　　7.12.13 Sistema defensivo — capas | docs/design/tactics/defense.md | trasladado |
| 2977 | 　　7.12.14 Shell/base scheme defensivo | docs/design/tactics/defense.md | trasladado |
| 3001 | 　　7.12.15 Pickup point, presión y pressing | docs/design/tactics/defense.md | trasladado |
| 3038 | 　　7.12.16 Pick & Roll / DHO — cobertura defensiva | docs/design/tactics/defense.md | trasladado |
| 3085 | 　　7.12.17 Reglas on-ball y matchups individuales | docs/design/tactics/defense.md | trasladado |
| 3115 | 　　7.12.18 Reglas off-ball, ayudas y ejecución colectiva | docs/design/tactics/defense.md | trasladado |
| 3139 | 　　　Revisión explícita de `Trabajo en equipo` | docs/design/tactics/defense.md | trasladado |
| 3153 | 　　7.12.19 Defensa del poste | docs/design/tactics/defense.md | trasladado |
| 3176 | 　　7.12.20 Transición defensiva y balance | docs/design/tactics/defense.md | trasladado |
| 3196 | 　　7.12.21 Roles defensivos | docs/design/tactics/defense.md | trasladado |
| 3216 | 　　7.12.22 `tacticalExecution`, familiaridad y complejidad | docs/design/tactics/live-game.md | trasladado |
| 3287 | 　　　Primera implementación (TAC-6) | docs/design/tactics/live-game.md | trasladado |
| 3385 | 　　7.12.23 Plan de partido (`GamePlan`) y scouting táctico | docs/design/tactics/live-game.md | trasladado |
| 3415 | 　　　Informe táctico del rival | docs/design/tactics/live-game.md | trasladado |
| 3439 | 　　7.12.24 Ajustes durante el partido, tiempos muertos y situaciones especiales | docs/design/tactics/live-game.md | trasladado |
| 3445 | 　　　Entre cuartos | docs/design/tactics/live-game.md | trasladado |
| 3469 | 　　　Tiempos muertos | docs/design/tactics/live-game.md | trasladado |
| 3493 | 　　　Compatibilidad con el reveal por cuartos | docs/design/tactics/live-game.md | trasladado |
| 3507 | 　　　ATO, BLOB, SLOB y finales | docs/design/tactics/live-game.md | trasladado |
| 3520 | 　　　Falta táctica intencionada | docs/design/tactics/live-game.md | trasladado |
| 3545 | 　　7.12.24-bis Visión futura pendiente de esta sección (TAC-5) | docs/design/tactics/live-game.md | trasladado |
| 3593 | 　　7.12.25 IA táctica de equipos CPU | docs/design/tactics/cpu-ai.md | trasladado |
| 3599 | 　　　Construcción de identidad | docs/design/tactics/cpu-ai.md | trasladado |
| 3624 | 　　　Plan de partido CPU | docs/design/tactics/cpu-ai.md | trasladado |
| 3639 | 　　　Ajustes en vivo CPU | docs/design/tactics/cpu-ai.md | trasladado |
| 3701 | 　　7.12.26 Tendencies de jugador — arquitectura futura | docs/design/tactics/cpu-ai.md | trasladado |
| 3733 | 　　7.12.27 Data Hub táctico — qué se registra desde el principio | docs/design/tactics/analytics.md | trasladado |
| 3805 | 　　7.12.28 Valoraciones derivadas de quinteto | docs/design/tactics/analytics.md | trasladado |
| 3840 | 　　7.12.29 Forma conceptual de los datos tácticos | docs/design/tactics/analytics.md | trasladado |
| 3919 | 　　7.12.30 Reglas de integración con el motor existente | docs/design/tactics/analytics.md | trasladado |
| 3942 | 　　7.12.31 Principios de balance y calibración | docs/design/tactics/analytics.md | trasladado |
| 3978 | 　　7.12.32 Interfaz táctica | docs/design/tactics/analytics.md | trasladado |
| 4012 | 　　7.12.33 Orden de implementación — EPIC TÁCTICAS | docs/design/tactics/roadmap.md | trasladado |
| 4017 | 　　　TAC-1 — Núcleo táctico de posesión | docs/design/tactics/roadmap.md | trasladado |
| 4037 | 　　　TAC-2 — Identidad + roles | docs/design/tactics/roadmap.md | trasladado |
| 4050 | 　　　TAC-3 — Playbook + generación real de oportunidades | docs/design/tactics/roadmap.md | trasladado |
| 4067 | 　　　TAC-4 — Defensa avanzada | docs/design/tactics/roadmap.md | trasladado |
| 4081 | 　　　TAC-5 — Partido vivo y situaciones | docs/design/tactics/roadmap.md | trasladado |
| 4094 | 　　　TAC-6 — Familiaridad, complejidad y entrenamiento | docs/design/tactics/roadmap.md | trasladado |
| 4105 | 　　　TAC-7 — Data Hub y scouting táctico | docs/design/tactics/roadmap.md | trasladado |
| 4118 | 　　7.12.34 Pendientes deliberados del sistema táctico | docs/design/tactics/roadmap.md | trasladado |
| 4339 | 　　7.12.35 Fuentes y criterio de diseño | docs/design/tactics/roadmap.md | trasladado |
| 4372 | 　　Pendiente para sesiones de diseño futuras (Simulación) | docs/design/tactics/roadmap.md | trasladado |
| 4413 | 　　7.12.36 Ayuda táctica contextual | docs/design/tactics/roadmap.md | trasladado |
| 4551 | 　8. Roles y control del club | docs/design/economy-and-modes.md | trasladado |
| 4569 | 　9. Player Life — carrera, TMB, Potencial, desarrollo y declive | docs/design/player-development.md | trasladado |
| 4577 | 　　9.1 TMB Rating y Potencial: dos escalas 1-200 | docs/design/player-development.md | trasladado |
| 4608 | 　　9.2 Migración del Potencial legacy | docs/design/player-development.md | trasladado |
| 4624 | 　　9.3 Precisión interna: residuales | docs/design/player-development.md | trasladado |
| 4634 | 　　9.4 Atributos mutables | docs/design/player-development.md | trasladado |
| 4647 | 　　9.5 Curvas independientes de aprendizaje y declive | docs/design/player-development.md | trasladado |
| 4661 | 　　9.6 Longevidad individual (`agingOffsetYears`) | docs/design/player-development.md | trasladado |
| 4672 | 　　9.7 Profesionalidad, Ambición y velocidad/persistencia de aprendizaje | docs/design/player-development.md | trasladado |
| 4690 | 　　9.8 Minutos y exposición competitiva | docs/design/player-development.md | trasladado |
| 4708 | 　　9.9 Instalaciones y hook de Staff | docs/design/player-development.md | trasladado |
| 4719 | 　　9.10 Límite de Potencial (headroom) | docs/design/player-development.md | trasladado |
| 4728 | 　　9.11 Calendario, ticks y determinismo | docs/design/player-development.md | trasladado |
| 4756 | 　　9.12 Límites explícitos de LIFE-1 | docs/design/player-development.md | trasladado |
| 4771 | 　　9.13 LIFE-2 — Entrenamiento, desarrollo dirigido y aprendizaje táctico/posicional | docs/design/training.md | trasladado |
| 4895 | 　　9.14 LIFE-3 — Lesiones, carga médica, rehabilitación y vuelta a competir | docs/design/injuries-recovery.md | trasladado |
| 5076 | 　　9.15 LIFE-4 — Ficha universal, carrera, histórico e hitos | docs/design/career-history.md | trasladado |
| 5250 | 　　9.16 ROSTER-1 — Estabilización LIFE-4, registro mundial y núcleo normativo multi-liga | docs/design/roster-registry.md | trasladado |
| 5261 | 　　　Partes de la EPIC | docs/design/roster-registry.md | trasladado |
| 5296 | 　　　Bugs corregidos de LIFE-4 (PR #37) | docs/design/roster-registry.md | trasladado |
| 5306 | 　　　Player Registry — identidad mundial de jugadores | docs/design/roster-registry.md | trasladado |
| 5351 | 　　　Núcleo normativo multi-liga | docs/design/roster-registry.md | trasladado |
| 5432 | 　　　Primera vertical real: convocatoria por competición | docs/design/roster-registry.md | trasladado |
| 5488 | 　　　Conceptos distintos (para las entregas futuras) | docs/design/roster-registry.md | trasladado |
| 5514 | 　　　Fuentes consultadas ya estudiadas para entregas futuras (anexo) | docs/design/roster-registry.md | trasladado |
| 5539 | 　　　Fuera de alcance de ROSTER-1 | docs/design/roster-registry.md | trasladado |
| 5549 | 　　9.17 CONTRACT-1 — Contrato profesional, vigencia, salario y cláusulas | docs/design/contracts.md | trasladado |
| 5566 | 　　　Objetivo y límites | docs/design/contracts.md | trasladado |
| 5586 | 　　　Bugs corregidos de ROSTER-1 | docs/design/contracts.md | trasladado |
| 5624 | 　　　Arquitectura normativa multi-dominio (un solo motor) | docs/design/contracts.md | trasladado |
| 5664 | 　　　Estrategias de composición (nunca `Object.assign`) | docs/design/contracts.md | trasladado |
| 5686 | 　　　Fuentes normativas y estado de certeza | docs/design/contracts.md | trasladado |
| 5716 | 　　　Entidad `Contract` y `ContractRegistry` | docs/design/contracts.md | trasladado |
| 5744 | 　　　Dinero, fechas y calendario de pagos | docs/design/contracts.md | trasladado |
| 5768 | 　　　Garantía, periodo de prueba y menores | docs/design/contracts.md | trasladado |
| 5780 | 　　　Cláusulas tipadas | docs/design/contracts.md | trasladado |
| 5794 | 　　　Contratos simulados: procedencia y calibración | docs/design/contracts.md | trasladado |
| 5847 | 　　　Puente temporal de tres temporadas | docs/design/contracts.md | trasladado |
| 5859 | 　　　Integración con temporada, ascensos y cantera | docs/design/contracts.md | trasladado |
| 5879 | 　　　Interfaz | docs/design/contracts.md | trasladado |
| 5899 | 　　　Invariantes verificadas | docs/design/contracts.md | trasladado |
| 5919 | 　　　Pruebas | docs/design/contracts.md | trasladado |
| 5930 | 　　　Fuera de alcance de CONTRACT-1 | docs/design/contracts.md | trasladado |
| 5942 | 　　9.18 REG-1 — Inscripción, licencias, elegibilidad, cupos y vinculados | docs/design/registration-eligibility.md | trasladado |
| 5965 | 　　　Bugs corregidos de CONTRACT-1 | docs/design/registration-eligibility.md | trasladado |
| 5995 | 　　　Bugs encontrados y corregidos durante esta entrega (BUG-REG1-\*) | docs/design/registration-eligibility.md | trasladado |
| 6095 | 　　　Separación conceptual y contexto de partido explícito | docs/design/registration-eligibility.md | trasladado |
| 6115 | 　　　Entidades, servicios y máquina de estados | docs/design/registration-eligibility.md | trasladado |
| 6151 | 　　　Reglas reales de ACB y Primera FEB (con fuente oficial) | docs/design/registration-eligibility.md | trasladado |
| 6178 | 　　　Formación, no comunitarios, propios y vinculados | docs/design/registration-eligibility.md | trasladado |
| 6197 | 　　　Bootstrap determinista y honestidad de los datos | docs/design/registration-eligibility.md | trasladado |
| 6211 | 　　　Integración con el partido, la CPU, la rotación y el acta | docs/design/registration-eligibility.md | trasladado |
| 6242 | 　　　Temporada, ascensos y descensos | docs/design/registration-eligibility.md | trasladado |
| 6252 | 　　　Interfaz | docs/design/registration-eligibility.md | trasladado |
| 6275 | 　　　Invariantes verificadas | docs/design/registration-eligibility.md | trasladado |
| 6295 | 　　　Pruebas y resultados reales | docs/design/registration-eligibility.md | trasladado |
| 6315 | 　　　Archivos nuevos | docs/design/registration-eligibility.md | trasladado |
| 6325 | 　　　Fuera de alcance de REG-1 | docs/design/registration-eligibility.md | trasladado |
| 6339 | 　　9.19 MARKET-1 — Mercado profesional, agentes, negociación, ofertas y derechos preferentes | docs/design/market.md | trasladado |
| 6357 | 　　　Bugs de REG-1/táctico corregidos antes de construir MARKET-1 (PR previa) | docs/design/market.md | trasladado |
| 6404 | 　　　Separación conceptual (quinto concepto distinto) | docs/design/market.md | trasladado |
| 6423 | 　　　Fuentes normativas y estado | docs/design/market.md | trasladado |
| 6462 | 　　　Arquitectura multi-liga (dominio `market` en `CompetitionRules.js`) | docs/design/market.md | trasladado |
| 6490 | 　　　Entidades, registros y ledger (event-sourced, mismo patrón que REG-1) | docs/design/market.md | trasladado |
| 6525 | 　　　Negociación, evaluación y determinismo | docs/design/market.md | trasladado |
| 6546 | 　　　Presupuesto simulado y reservas | docs/design/market.md | trasladado |
| 6559 | 　　　Máquina ACB de derecho de tanteo (arts. 13-17) | docs/design/market.md | trasladado |
| 6617 | 　　　Reloj, Agenda y "Continuar" | docs/design/market.md | trasladado |
| 6636 | 　　　Bootstrap ficticio y honestidad | docs/design/market.md | trasladado |
| 6658 | 　　　Interfaz | docs/design/market.md | trasladado |
| 6672 | 　　　Invariantes verificados | docs/design/market.md | trasladado |
| 6689 | 　　　Pruebas y resultados reales | docs/design/market.md | trasladado |
| 6720 | 　　　Bugs encontrados y corregidos durante esta entrega (BUG-MARKET1-\*) | docs/design/market.md | trasladado |
| 6760 | 　　　Archivos nuevos | docs/design/market.md | trasladado |
| 6770 | 　　　Fuera de alcance de MARKET-1 | docs/design/market.md | trasladado |
| 6786 | 　　9.20 TRANSFER-1 — Traspasos, fichajes, cláusulas, rescisiones y compensaciones | docs/design/transfers.md | trasladado |
| 6815 | 　　　Motor legal multi-jurisdicción (`CompetitionRules.js`, dominio `transfer`) | docs/design/transfers.md | trasladado |
| 6857 | 　　　Entidades y registro canónico | docs/design/transfers.md | trasladado |
| 6880 | 　　　Motor de ejecución atómico | docs/design/transfers.md | trasladado |
| 6920 | 　　　Interfaz | docs/design/transfers.md | trasladado |
| 6940 | 　　　Bugs encontrados y corregidos | docs/design/transfers.md | trasladado |
| 7008 | 　　　Archivos nuevos | docs/design/transfers.md | trasladado |
| 7017 | 　　　Fuera de alcance de TRANSFER-1 | docs/design/transfers.md | trasladado |
| 7027 | 　　9.21 LOAN-1 — Cesiones, retorno, recall y opción de compra | docs/design/loans.md | trasladado |
| 7047 | 　　　Modelo de fechas semiabierto | docs/design/loans.md | trasladado |
| 7057 | 　　　Motor legal multi-jurisdicción (`CompetitionRules.js`, dominio `loan`) | docs/design/loans.md | trasladado |
| 7082 | 　　　Entidades y registro canónico | docs/design/loans.md | trasladado |
| 7106 | 　　　Motor de ejecución atómico | docs/design/loans.md | trasladado |
| 7137 | 　　　Contrato, inscripción y elegibilidad durante la cesión | docs/design/loans.md | trasladado |
| 7161 | 　　　Reloj único y noticias | docs/design/loans.md | trasladado |
| 7172 | 　　　Interfaz | docs/design/loans.md | trasladado |
| 7186 | 　　　Bugs encontrados y corregidos | docs/design/loans.md | trasladado |
| 7253 | 　　　Archivos nuevos | docs/design/loans.md | trasladado |
| 7265 | 　　　Fuera de alcance de LOAN-1 | docs/design/loans.md | trasladado |
| 7272 | 　　9.22 CYCLE-1 — Ciclo anual de plantilla: expiración, renovación, retirada, cantera y clearinghouse | docs/design/annual-cycle.md | trasladado |
| 7294 | 　　　El ciclo anual: 13 fases con fechas reales | docs/design/annual-cycle.md | trasladado |
| 7349 | 　　　Expiración, renovación y opciones contractuales (`ContractExpiryService`, `RenewalService`) | docs/design/annual-cycle.md | trasladado |
| 7378 | 　　　Tanteo orgánico | docs/design/annual-cycle.md | trasladado |
| 7389 | 　　　Retirada individual y determinista (`RetirementService`) | docs/design/annual-cycle.md | trasladado |
| 7405 | 　　　Cantera como pool separado (`AcademyService`) | docs/design/annual-cycle.md | trasladado |
| 7421 | 　　　Planificación CPU y clearinghouse (`CpuRosterPlanner`, `runClearingRounds`) | docs/design/annual-cycle.md | trasladado |
| 7438 | 　　　Legalidad de plantilla y escalera de emergencia (`RosterLegalityService`) | docs/design/annual-cycle.md | trasladado |
| 7463 | 　　　Población acotada (`WorldLifecycleService`) | docs/design/annual-cycle.md | trasladado |
| 7485 | 　　　Interfaz — pantalla "Planificación" (`src/ui/game.js`) | docs/design/annual-cycle.md | trasladado |
| 7499 | 　　　Bugs encontrados y corregidos durante esta entrega | docs/design/annual-cycle.md | trasladado |
| 7548 | 　　　Limitación conocida y documentada (no oculta) | docs/design/annual-cycle.md | trasladado |
| 7561 | 　　　Prueba de humo — 10 temporadas + determinismo (`scripts/smoke-cycle1.js`) | docs/design/annual-cycle.md | trasladado |
| 7583 | 　　　Archivos nuevos | docs/design/annual-cycle.md | trasladado |
| 7607 | 　　　Fuera de alcance de CYCLE-1 | docs/design/annual-cycle.md | trasladado |
| 7615 | 　10. World Architecture — mundo, geografía, organizaciones y competiciones | docs/architecture/world-model.md | trasladado |
| 7624 | 　　Por qué se hace ahora | docs/architecture/world-model.md | trasladado |
| 7639 | 　　10.1 Las nueve entregas | docs/architecture/world-model.md | trasladado |
| 7661 | 　　10.2 Modelo de dominio | docs/architecture/world-model.md | trasladado |
| 7688 | 　　10.3 Entidades | docs/architecture/world-model.md | trasladado |
| 7690 | 　　　`GeographicArea` (`src/entities/Geography.js`) | docs/architecture/world-model.md | trasladado |
| 7698 | 　　　`Organization` (`src/entities/Organization.js`) | docs/architecture/world-model.md | trasladado |
| 7707 | 　　　`Club` (`src/entities/Club.js`) — ARCH-WORLD-07, ampliada en CLUB-CORE-1 | docs/architecture/world-model.md | trasladado |
| 7725 | 　　　`Squad` (`src/entities/Squad.js`) — CLUB-CORE-1 | docs/architecture/world-model.md | trasladado |
| 7744 | 　　　`Team` (`src/entities/Team.js`, ampliado en WORLD-CORE-1, CLUB-CORE-1 y NATIONAL-TEAMS-1) | docs/architecture/world-model.md | trasladado |
| 7783 | 　　　`CompetitionDefinition` (`src/entities/Competition.js` + catálogo en | docs/architecture/world-model.md | trasladado |
| 7798 | 　　　`CompetitionEdition` / `CompetitionStage` / `CompetitionEntry` | docs/architecture/world-model.md | trasladado |
| 7859 | 　　　`CompetitionFormatDefinition` / `CompetitionStageTemplate` (COMP-CORE-1, `src/entities/Competition.js` + catálogo en `src/core/CompetitionFormatCatalog.js`) | docs/architecture/world-model.md | trasladado |
| 7878 | 　　　`GameWorld` (`src/entities/World.js`) | docs/architecture/world-model.md | trasladado |
| 7892 | 　　　`WorldRegistries` (`src/core/WorldRegistry.js`) | docs/architecture/world-model.md | trasladado |
| 7906 | 　　　`ContentPackManifest` | docs/architecture/world-model.md | trasladado |
| 7916 | 　　10.4 Paquetes iniciales | docs/architecture/world-model.md | trasladado |
| 7943 | 　　10.5 Adaptador legacy — `SpainLegacyCompetitionRuntime` | docs/architecture/world-model.md | trasladado |
| 7974 | 　　10.6 Integración con el runtime actual | docs/architecture/world-model.md | trasladado |
| 8052 | 　　10.7 Fuera de alcance de WORLD-CORE-1 | docs/architecture/world-model.md | trasladado |
| 8066 | 　　10.8 Migración legacy — puentes y su entrega de retirada | docs/architecture/world-model.md | trasladado |
| 8095 | 　　10.9 Plan superado | docs/architecture/world-model.md | trasladado |
| 8111 | 　　10.10 Invariantes | docs/architecture/world-model.md | trasladado |
| 8346 | 　　10.11 Verificación reducida (esta entrega) | docs/architecture/world-model.md | trasladado |
| 8370 | 　　10.12 CLUB-CORE-1 — resultado | docs/epics/CLUB-CORE-1.md | trasladado (histórico) |
| 8491 | 　　10.13 COMP-CORE-1 — resultado | docs/epics/COMP-CORE-1.md | trasladado (histórico) |
| 8677 | 　　10.14 WORLD-CALENDAR-1 — resultado | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8687 | 　　　10.14.1 Modelo temporal canónico | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8710 | 　　　10.14.2 Calendarios como contenido versionado | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8753 | 　　　10.14.3 `WorldCalendar` y modelo de item | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8771 | 　　　10.14.4 Fuentes y coordinador | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8800 | 　　　10.14.5 Semántica exacta de "Continuar" | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8830 | 　　　10.14.6 Bugs corregidos | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8869 | 　　　10.14.7 Pruebas de esta entrega | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8894 | 　　　10.14.8 Fuera de alcance de esta entrega | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 8917 | 　　10.15 PATHWAYS-1 — resultado | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 8927 | 　　　10.15.1 Modelo y vocabulario | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 8960 | 　　　10.15.2 Catálogo y servicio | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 8985 | 　　　10.15.3 Cambios mínimos en `CompetitionEngine` | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 9004 | 　　　10.15.4 Migración española | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 9051 | 　　　10.15.5 Bugs corregidos | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 9087 | 　　　10.15.6 Shims y límites | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 9100 | 　　　10.15.7 Invariantes ampliadas | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 9104 | 　　　10.15.8 Pruebas reales | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 9132 | 　　　10.15.9 Fuera de alcance de esta entrega | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 9144 | 　　10.16 WORLD-SIM-1 — resultado | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 9156 | 　　　10.16.1 Vocabulario y perfil | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 9187 | 　　　10.16.2 Edition congelada y snapshots de equipo | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 9216 | 　　　10.16.3 Servicio de simulación y adaptadores | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 9258 | 　　　10.16.4 Integración con el engine, el calendario y PATHWAYS | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 9287 | 　　　10.16.5 Población, ciclo de vida y mercado honestos | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 9321 | 　　　10.16.6 Pruebas de esta entrega | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 9360 | 　　　10.16.7 Fuera de alcance de esta entrega | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 9374 | 　　10.17 NATIONAL-TEAMS-1 — resultado | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9386 | 　　　10.17.1 `Team` es la entidad deportiva común | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9400 | 　　　10.17.2 Club y selección son afiliaciones simultáneas distintas | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9416 | 　　　10.17.3 El motor común ejecuta selecciones de verdad | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9446 | 　　　10.17.4 Modelo de dominio nacional | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9503 | 　　　10.17.5 Elegibilidad y reglas FIBA | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9543 | 　　　10.17.6 Calendario y disponibilidad para el club | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9580 | 　　　10.17.7 Fuera de alcance de esta entrega | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9595 | 　　　10.17.8 Pruebas de esta entrega | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 9643 | 　　10.18 WORLD-UI-1 — resultado | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9653 | 　　　10.18.1 Snapshot y servicio de configuración | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9694 | 　　　10.18.2 Contrato de manifiesto — metadatos `careerSetup` | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9722 | 　　　10.18.3 Arranque: `startCareerFromSetup(snapshot)` | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9752 | 　　　10.18.4 Pantalla de configuración (reemplaza la selección por división) | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9778 | 　　　10.18.5 Navegador mundial (`WorldNavigationService.js` + pantalla Mundo) | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9806 | 　　　10.18.6 Migración de Inicio/Calendario/Competiciones/Estadísticas | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9857 | 　　　10.18.7 Bugs verificados | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9863 | 　　　10.18.8 Pruebas de esta entrega | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9902 | 　　　10.18.9 Fuera de alcance de esta entrega | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 9915 | 　　10.19 WORLD-HARDEN-1 — resultado (parcial, deuda explícita) | docs/epics/WORLD-HARDEN-1.md | trasladado (histórico) |
| 9929 | 　　　10.19.1 Lo que SÍ quedó implementado y verificado | docs/epics/WORLD-HARDEN-1.md | trasladado (histórico) |
| 10051 | 　　　10.19.2 Deuda explícita NO resuelta en esta sesión (propietario: sesión de cierre siguiente) | docs/epics/WORLD-HARDEN-1.md | trasladado (histórico) |
| 10130 | 　　　10.19.3 Sobre el cierre de la EPIC | docs/epics/WORLD-HARDEN-1.md | trasladado (histórico) |
| 10159 | 　　　10.19.4 Frontera de persistencia — cobertura y límites exactos | docs/epics/WORLD-HARDEN-1.md | trasladado (histórico) |
| 10173 | 　　10.20 WORLD-CONTEXT-1 — contexto competitivo e identidades canónicas | docs/epics/WORLD-CONTEXT-1.md | trasladado (histórico) |
| 10182 | 　　　10.20.1 Problemas corregidos | docs/epics/WORLD-CONTEXT-1.md | trasladado (histórico) |
| 10217 | 　　　10.20.2 El contexto de competición es SIEMPRE explícito | docs/epics/WORLD-CONTEXT-1.md | trasladado (histórico) |
| 10273 | 　　　10.20.3 Tabla semántica Club vs Team (obligatoria en código nuevo) | docs/epics/WORLD-CONTEXT-1.md | trasladado (histórico) |
| 10307 | 　　　10.20.4 Bugs de comportamiento REALES que esta corrección destapó | docs/epics/WORLD-CONTEXT-1.md | trasladado (histórico) |
| 10341 | 　　　10.20.5 Compatibilidad y límites | docs/epics/WORLD-CONTEXT-1.md | trasladado (histórico) |
| 10366 | 　　　10.20.6 Verificación (resultados EXACTOS de esta sesión) | docs/epics/WORLD-CONTEXT-1.md | trasladado (histórico) |
| 10399 | 　　10.21 WORLD-CLEANUP-1 — retirada final de proyecciones legacy | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10407 | 　　　10.21.1 Retirada de `Team.division` | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10434 | 　　　10.21.2 Exposición competitiva por tier (BUG-WORLD-CLEANUP-03) | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10452 | 　　　10.21.3 Histórico de carrera multi-competición | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10481 | 　　　10.21.4 Metadatos de Stage y retirada de los mapas de UI | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10508 | 　　　10.21.5 Career Setup: grafo completo de pathways | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10525 | 　　　10.21.6 Shims retirados y nombres ambiguos resueltos (10.20.5) | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10561 | 　　　10.21.7 Contenido español existente vs. dependencia estructural | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10617 | 　　　10.21.8 Verificación (resultados EXACTOS de esta sesión) | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10653 | 　　　10.21.9 Checklist manual recomendado para Dennis (no ejecutado en esta sesión) | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 10672 | 　11. Modo Manager (futuro, derivado del modo Completo) | docs/design/economy-and-modes.md | trasladado |
| 10679 | 　12. Plataforma | docs/design/economy-and-modes.md | trasladado |
| 10686 | 　13. Nota sobre comercialización futura | docs/design/economy-and-modes.md | trasladado |

## CLAUDE.md (1 655 líneas originales)

| Línea original | Sección original | Destino | Tratamiento |
|---|---|---|---|
| 1 | CLAUDE.md — Instrucciones técnicas del proyecto | CLAUDE.md (nuevo) | consolidado |
| 8 | 　Sobre el usuario de este proyecto | CLAUDE.md §1 | consolidado |
| 16 | 　Stack técnico | CLAUDE.md §2 | consolidado |
| 27 | 　Estructura de carpetas | CLAUDE.md §3 | consolidado |
| 47 | 　Convenciones | CLAUDE.md §4 | consolidado |
| 59 | 　Datos reales de jugadores/clubes (importante) | CLAUDE.md §4 | consolidado |
| 69 | 　Sobre nombres oficiales de marcas/competiciones | CLAUDE.md §4 | consolidado |
| 75 | 　Interfaz de juego (`src/ui/game.js` + `src/ui/game.css`) | docs/design/game-ui-decisions.md | trasladado |
| 221 | 　Ciclo profesional de plantilla (ROSTER-1, CONTRACT-1, REG-1, MARKET-1, TRANSFER-1, LOAN-1, CYCLE-1 y siguientes) | docs/architecture/roster-lifecycle-domain.md | trasladado |
| 262 | 　　Contratos (CONTRACT-1, DESIGN.md 9.17) | docs/design/contracts.md | trasladado |
| 318 | 　　Inscripción, licencias y elegibilidad (REG-1, DESIGN.md 9.18) | docs/design/registration-eligibility.md | trasladado |
| 396 | 　　Mercado, agentes y derechos (MARKET-1, DESIGN.md 9.19) | docs/design/market.md | trasladado |
| 484 | 　　Traspasos, fichajes y ejecución (TRANSFER-1, DESIGN.md 9.20) | docs/design/transfers.md | trasladado |
| 590 | 　　Cesiones, retorno, recall y opción de compra (LOAN-1, DESIGN.md 9.21) | docs/design/loans.md | trasladado |
| 693 | 　　Ciclo anual: expiración, renovación, retirada, cantera y clearinghouse (CYCLE-1, DESIGN.md 9.22) | docs/design/annual-cycle.md | trasladado |
| 809 | 　World Architecture (WORLD-CORE-1 y siguientes) | docs/architecture/world-model.md | trasladado |
| 901 | 　　CLUB-CORE-1 (DESIGN.md 10.12) — Club, Team y Squad son entidades DISTINTAS | docs/architecture/club-team-squad.md | trasladado |
| 971 | 　　COMP-CORE-1 (DESIGN.md 10.13) — motor genérico de competiciones | docs/architecture/competition-engine.md | trasladado |
| 1045 | 　　WORLD-CALENDAR-1 (DESIGN.md 10.14) — cronología mundial única | docs/architecture/world-calendar.md | trasladado |
| 1121 | 　　PATHWAYS-1 (DESIGN.md 10.15) — clasificación y ascenso/descenso declarativos | docs/architecture/pathways.md | trasladado |
| 1204 | 　　WORLD-SIM-1 (DESIGN.md 10.16) — niveles de detalle y simulación mundial acotada | docs/architecture/simulation-levels.md | trasladado |
| 1302 | 　　NATIONAL-TEAMS-1 (DESIGN.md 10.17) — selecciones, elegibilidad y ventanas FIBA | docs/architecture/national-teams.md | trasladado |
| 1384 | 　　WORLD-UI-1 (DESIGN.md 10.18) — configuración de carrera y navegación mundial | docs/architecture/career-setup-and-navigation.md | trasladado |
| 1449 | 　　WORLD-HARDEN-1 (DESIGN.md 10.19) — orquestación genérica y frontera de persistencia | docs/architecture/persistence-boundary.md | trasladado |
| 1506 | 　　WORLD-CONTEXT-1 (DESIGN.md 10.20) — contexto competitivo explícito e identidades canónicas | docs/architecture/competitive-context-identity.md | trasladado |
| 1569 | 　　WORLD-CLEANUP-1 (DESIGN.md 10.21) — retirada final de proyecciones legacy | docs/architecture/competitive-context-identity.md | trasladado |
| 1644 | 　Qué NO hacer sin confirmar con Dennis primero | CLAUDE.md §10 | consolidado |

## CHANGELOG.md (7 907 líneas originales, solo cabeceras de sesión/Epic)

| Línea original | Sección original | Destino | Tratamiento |
|---|---|---|---|
| 3 | 　2026-09-08 — REPO-HARDEN-1: saneamiento técnico posterior a WORLD-CLEANUP-1 | docs/epics/REPO-HARDEN-1.md | trasladado (histórico) |
| 121 | 　2026-09-07 — WORLD-CLEANUP-1: retirada final de proyecciones legacy (DESIGN.md 10.21) | docs/epics/WORLD-CLEANUP-1.md | trasladado (histórico) |
| 261 | 　2026-09-07 — WORLD-CONTEXT-1: contexto competitivo explícito e identidades canónicas Club/Team (DESIGN.md 10.20) | docs/epics/WORLD-CONTEXT-1.md | trasladado (histórico) |
| 428 | 　2026-09-07 — WORLD-HARDEN-1 (parcial): orquestación genérica de arranque/cierre + frontera de persistencia (DESIGN.md sección 10.19) | docs/epics/WORLD-HARDEN-1.md | trasladado (histórico) |
| 517 | 　2026-09-07 — WORLD-UI-1: configuración de carrera y navegación mundial (DESIGN.md sección 10.18) | docs/epics/WORLD-UI-1.md | trasladado (histórico) |
| 671 | 　2026-09-07 — NATIONAL-TEAMS-1: selecciones, elegibilidad y ventanas FIBA (DESIGN.md sección 10.17) | docs/epics/NATIONAL-TEAMS-1.md | trasladado (histórico) |
| 820 | 　2026-09-06 — WORLD-SIM-1: niveles de detalle y simulación mundial acotada (DESIGN.md sección 10.16) | docs/epics/WORLD-SIM-1.md | trasladado (histórico) |
| 975 | 　2026-09-06 — PATHWAYS-1: clasificación y ascenso/descenso declarativos (DESIGN.md sección 10.15) | docs/epics/PATHWAYS-1.md | trasladado (histórico) |
| 1185 | 　2026-09-06 — WORLD-CALENDAR-1: cronología mundial única (DESIGN.md sección 10.14) | docs/epics/WORLD-CALENDAR-1.md | trasladado (histórico) |
| 1428 | 　2026-09-06 — COMP-CORE-1: motor genérico de competiciones (DESIGN.md sección 10.13) | docs/epics/COMP-CORE-1.md | trasladado (histórico) |
| 1656 | 　2026-09-05 — CLUB-CORE-1: separar Club, Team y Squad (DESIGN.md sección 10.12) | docs/epics/CLUB-CORE-1.md | trasladado (histórico) |
| 1814 | 　2026-08-31 — WORLD-CORE-1: mundo canónico y España como paquete de contenido (DESIGN.md sección 10) | docs/epics/WORLD-CORE-1.md | trasladado (histórico) |
| 1955 | 　2026-08-28 — CYCLE-1: ciclo anual de plantilla — expiración, renovación, retirada, cantera y clearinghouse (DESIGN.md 9.22) | docs/epics/CYCLE-1.md | trasladado (histórico) |
| 2119 | 　2026-08-27 — LOAN-1: cesiones, retorno, recall y opción de compra (DESIGN.md 9.21) | docs/epics/LOAN-1.md | trasladado (histórico) |
| 2233 | 　2026-08-27 — TRANSFER-1: traspasos, fichajes, cláusulas y compensaciones (DESIGN.md 9.20) | docs/epics/TRANSFER-1.md | trasladado (histórico) |
| 2338 | 　2026-08-26 — MARKET-1: mercado, agentes, negociación y derechos preferentes (DESIGN.md 9.19) | docs/epics/MARKET-1.md | trasladado (histórico) |
| 2466 | 　2026-08-26 — REG-1: inscripción, licencias, elegibilidad, cupos y vinculados (DESIGN.md 9.18) | docs/epics/REG-1.md | trasladado (histórico) |
| 2614 | 　2026-08-26 — CONTRACT-1: contrato profesional, vigencia, salario y cláusulas (DESIGN.md 9.17) | docs/epics/CONTRACT-1.md | trasladado (histórico) |
| 2863 | 　2026-08-24 — ROSTER-1: registro mundial de jugadores y núcleo normativo multi-liga (DESIGN.md 9.16) | docs/epics/ROSTER-1.md | trasladado (histórico) |
| 3079 | 　2026-08-24 — LIFE-4: Ficha universal, carrera, histórico e hitos (DESIGN.md 9.15) | docs/epics/LIFE-4.md | trasladado (histórico) |
| 3172 | 　2026-08-24 — LIFE-3: Lesiones, carga médica, rehabilitación y vuelta a competir (DESIGN.md 9.14) | docs/epics/LIFE-3.md | trasladado (histórico) |
| 3408 | 　2026-08-23 | docs/epics/LIFE-2.md | trasladado (histórico) |
| 3819 | 　2026-08-22 | docs/epics/POS.md | trasladado (histórico) |
| 4059 | 　2026-08-14 | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 4064 | 　2026-08-15 | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 4097 | 　2026-08-16 | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 4563 | 　2026-08-17 | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 4753 | 　2026-08-19 | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 4826 | 　2026-08-19 (2) — Alineación por slots + Minutos de la basura | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 4951 | 　2026-08-19 (3) — Fix: "Jugar siguiente jornada" ignoraba la alineación guardada | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 4992 | 　2026-08-19 (4) — Entidad Calendario + integración de Recovery.js (DESIGN.md 3.3 / 7.11.5) | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 5104 | 　2026-08-19 (5) — Corrección de calibración de Copa + IA de alineación CPU (DESIGN.md 3.3.2 / 7.11.7) | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 5217 | 　2026-08-19 (6) — Retoques de estadísticas: Asistencia, Valoración, +/-, minutos y medias de temporada | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 5299 | 　2026-08-20 — Cierre de ciclo de temporada y pretemporada (DESIGN.md 3.4) | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 5405 | 　2026-08-20 (2) — TAC-1: núcleo táctico de posesión — Pick & Roll (DESIGN.md 7.12.33) | docs/epics/TACTICS-EPIC.md | trasladado (histórico) |
| 5567 | 　2026-08-20 (3) — TAC-2: identidad + spacing + roles (DESIGN.md 7.12.33) | docs/epics/TACTICS-EPIC.md | trasladado (histórico) |
| 5797 | 　2026-08-20 (4) — TAC-3: playbook + generación real de oportunidades (DESIGN.md 7.12.33) | docs/epics/TACTICS-EPIC.md | trasladado (histórico) |
| 6056 | 　2026-08-21 — TAC-4: defensa avanzada (DESIGN.md 7.12.33) | docs/epics/TACTICS-EPIC.md | trasladado (histórico) |
| 6266 | 　2026-08-21 (2) — TAC-5: partido vivo y situaciones (DESIGN.md 7.12.33) | docs/epics/TACTICS-EPIC.md | trasladado (histórico) |
| 6561 | 　2026-08-21 (3) — TAC-6: Familiaridad Táctica, `tacticalExecution` y complejidad (DESIGN.md 7.12.33) | docs/epics/TACTICS-EPIC.md | trasladado (histórico) |
| 6830 | 　2026-08-21 (4) — TAC-7: Data Hub táctico, informe de rival e identidad automática de la CPU (DESIGN.md 7.12.33) | docs/epics/TACTICS-EPIC.md | trasladado (histórico) |
| 7218 | 　2026-08-21 (5) — Consolidación: corrección de textos de UI y regeneración de posiciones reales | docs/history/2026-08-foundation.md | trasladado (histórico) |
| 7410 | 　2026-08-22 — TOOLTIP-1: ayuda táctica contextual (DESIGN.md 7.12.36) | docs/epics/TOOLTIP-1.md | trasladado (histórico) |
| 7574 | 　2026-08-22 (2) — CAL-1: calendario vivo y avance temporal (DESIGN.md 3.3) | docs/epics/CAL-1-CAL-2.md | trasladado (histórico) |
| 7738 | 　2026-08-22 (3) — CAL-2: Agenda, Noticias y Home vivo definitivo (DESIGN.md 3.5) | docs/epics/CAL-1-CAL-2.md | trasladado (histórico) |

## Sustituido, con evidencia (contradicciones resueltas en esta migración)

- **World Architecture "en curso"** (`DESIGN.md` §2, línea 47) → sustituido
  por "cerrada estructuralmente" en `docs/STATUS.md` y en la nota de
  `docs/architecture/world-model.md`, con `WORLD-CLEANUP-1` (10.21) como
  evidencia. El texto "en curso" queda como antecedente histórico en
  `docs/epics/WORLD-CLEANUP-1.md`.
- **Persistencia en `localStorage`** (`CLAUDE.md`, antigua sección "Stack
  técnico") → sustituido por "no implementada" en `CLAUDE.md` §2 y en
  `docs/architecture/persistence-boundary.md`, con el comentario de
  `src/ui/game.js` y `CareerPersistenceBoundary.js` como evidencia.
- **Revelado por cuartos sin matizar** (`CLAUDE.md`, antigua sección
  "Interfaz de juego") → matizado en `docs/design/game-ui-decisions.md`:
  aplica solo al modo `'replay'` (Copa/Playoff/Ascenso); el partido de
  Liga del usuario usa el motor pausable real desde TAC-5, con evidencia
  en `src/ui/game.js` (`startLiveMatch`/`advanceLiveMatch`).

## Pendiente de aclaración

Ninguna de las ocho contradicciones señaladas en el encargo de
`DOCS-CONTEXT-1` quedó sin resolver contra el código real — ver
`docs/STATUS.md`, sección "Contradicciones detectadas". No hay, a fecha
de esta migración, ninguna afirmación antigua sin evidencia suficiente
para resolverla.
