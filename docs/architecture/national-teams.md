# Arquitectura — selecciones nacionales y ventanas FIBA (NATIONAL-TEAMS-1)

_Migrado de `CLAUDE.md` (líneas 1302-1383 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### NATIONAL-TEAMS-1 (DESIGN.md 10.17) — selecciones, elegibilidad y ventanas FIBA

Convenciones permanentes de la 7ª entrega de World Architecture — aplican a
toda sesión futura que toque selecciones nacionales, federaciones,
elegibilidad de nacionalidad deportiva, listas/convocatorias o ventanas
FIBA:

- `Team.teamKind: 'club-team' | 'national-team'` es la ÚNICA forma de
  distinguir un equipo de club de una selección — nunca una clase paralela
  `NationalTeam`. `national-team` nunca tiene `clubId`/`club`; exige
  `federationOrganizationId` (`Organization` real `type:
  'national-federation'`) y `representedAreaId` (área real) explícitos,
  validados tanto en el constructor de `Team` como en
  `WorldRegistries.registerTeam()`/`validateIntegrity()`.
- Doble pertenencia por CONTEXTO: `Squad.membershipContext:
  'club-service' | 'national-team-duty'` (por defecto `'club-service'`,
  ningún squad anterior a esta entrega cambia de forma). La unicidad de
  "un jugador en como máximo un squad activo" es POR CONTEXTO — puede
  haber uno de cada a la vez, nunca dos del mismo
  (`WorldRegistries.registerSquad()`/`validateIntegrity()`).
  `SquadRegistry.activeSquadForPlayer()` sigue siendo alias LEGACY de
  `activeClubSquadForPlayer()` — código nuevo que necesite el squad de
  selección usa `activeNationalTeamSquadForPlayer()`, nunca el alias.
- `Player.teamId` conserva EXACTAMENTE su significado — espejo del club de
  servicio. Ninguna operación de convocatoria/incorporación/liberación de
  `NationalTeamService` lo toca jamás; el jugador nunca "sale" de su club.
- Fuente de elegibilidad de NACIONALIDAD DEPORTIVA:
  `NationalTeamEligibilityService.evaluateNationalEligibility()` — PURO,
  nunca crea una `NationalStatusDecision`/convocatoria/receipt. Ciudadanía
  (`PlayerRegulatoryProfile.citizenships`), pasaporte
  (`passportEvidences[]`) y nacionalidad deportiva FIBA
  (`NationalStatusDecision`) son conceptos DISTINTOS — nunca se infiere
  uno de otro. `unknown` (dato ausente) y `pending-decision` (caso que
  exige resolución externa) NUNCA se convierten en elegibles — código
  nuevo nunca trata "unknown" como favorable por omisión.
- Un cambio de nacionalidad deportiva o un caso marginal (territorio
  dependiente, refugio/asilo, vínculo significativo) exige una
  `NationalStatusDecision` trazable y explícita — el motor NUNCA se
  arroga esa decisión ni la infiere de nombre/club/liga visible.
- Selecciones y clubes usan el MISMO `CompetitionEngine`,
  `WorldCalendar`, `CompetitionPathwayService` y niveles de detalle
  `playable/full/standard/abstract` — nunca un motor/calendario/pathway
  paralelo por ser selección. `WorldRegistries.registerCompetitionEntry()`
  exige, AL REGISTRAR, que el participante exista y que su `teamKind`
  coincida con `entry.participantType` (para ambos tipos, no solo
  `club-team`).
- `CompetitionSimulationService.interactiveCohortTeams()` filtra SIEMPRE
  por `teamKind === 'club-team'` además de por Edition `playable` — código
  nuevo que recorra "todos los equipos interactivos" (bootstrap de
  contratos/registros/mercado/ciclo anual) nunca usa `getAllTeams()` a
  secas ni olvida ese filtro: una selección `playable` futura no debe
  entrar por accidente en sistemas exclusivamente domésticos.
- Nunca se inventan appearances internacionales ni nacionalidades:
  `NationalTeamAppearanceReceipt` exige `detailLevel`
  `playable`/`full` explícito (su propio constructor rechaza
  `standard`/`abstract`) — un resultado compacto/agregado NUNCA fabrica
  una aparición individual. No se cargan pasaportes/decisiones de
  jugadores reales ya existentes sin datos reales que lo respalden — un
  dato ausente es `unknown`, nunca se completa con un valor inventado.
  `nationalTeamAppearances` en `PlayerRegulatoryProfile` es SOLO evidencia
  legacy de solo lectura — la fuente canónica nueva es
  `NationalTeamRegistry`/`NationalTeamAppearanceReceipt`.
- `state.nationalTeamRegistry` (`NationalTeamRegistry`) es una instancia
  EXPLÍCITA por carrera, creada en `startSeason()`, adjuntada por
  IDENTIDAD a `GameWorld.domainRegistries.nationalTeamRegistry` y limpiada
  al volver a selección de equipo — nunca un singleton. En la partida
  española está SIEMPRE vacío (no se instala ninguna federación/
  selección/ventana real): pasarlo como dependencia a
  `EligibilityService`/`RegulatoryClassificationService` es seguro y no
  cambia ningún comportamiento observable mientras siga vacío.
- `EligibilityService.evaluateEligibility()` consulta
  `deps.nationalTeamRegistry.activeDutyForPlayerOn()` para el reason code
  bloqueante `NATIONAL_TEAM_DUTY` — usuario y CPU consultan EXACTAMENTE el
  mismo registro, nunca una regla paralela. Al terminar la ventana el
  jugador recupera disponibilidad automáticamente porque nunca salió de su
  club — nunca se modela como lesión, sanción o baja federativa.
- No se instala contenido real de selecciones/torneos/ventanas FIBA en
  `data/world/spain-2026.1.js` ni en `game.js` — la vertical de prueba
  vive únicamente en `scripts/test-national-teams1.js`/
  `scripts/smoke-national-teams1.js`. La navegación/selector de
  selecciones es WORLD-UI-1.
