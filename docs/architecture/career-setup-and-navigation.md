# Arquitectura — configuración de carrera y navegación mundial (WORLD-UI-1)

_Migrado de `CLAUDE.md` (líneas 1384-1448 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### WORLD-UI-1 (DESIGN.md 10.18) — configuración de carrera y navegación mundial

Convenciones permanentes de la 8ª entrega de World Architecture — aplican
a toda sesión futura que toque la pantalla de configuración de carrera, la
selección de club, la pantalla Mundo, o cualquier pantalla que hoy
consulte `state.division`/`getLeague`/`getBrackets`:

- Arranque de carrera y temporada SIEMPRE desde un `CareerSetupSnapshot`
  explícito (`src/entities/CareerSetup.js`), nunca desde el reloj del
  sistema (`buildCareerSeasonKey()` ya no tiene fallback a
  `new Date().getFullYear()`) ni desde literales sueltos repartidos por
  `game.js`. `startCareerFromSetup(snapshot)` sustituye a la antigua
  `startSeason(teamId, division)` — un cambio nuevo que necesite
  temporada/huso/nivel de detalle al arrancar lo añade al snapshot/
  `CareerSetupService`, nunca como un parámetro suelto nuevo de esa
  función.
- Configurar o renderizar la pantalla de carrera NUNCA construye
  `Team`/`Player` ni consume RNG — el catálogo (`CareerSetupService.
  buildCatalog()`) y el borrador se leen SOLO de metadatos planos
  (`manifest.careerSetup`, `catalog.clubs`); la construcción real ocurre
  UNA vez, solo tras pulsar "Comenzar carrera" y validar completo.
- La navegación mundial (`src/core/WorldNavigationService.js`, pantalla
  Mundo) resuelve SIEMPRE por ids/registries reales (`AreaRegistry`,
  `OrganizationRegistry`, `ClubRegistry`, `CompetitionDefinitionRegistry`,
  `CompetitionEngine`) — nunca por nombre visible ni por `division`. Un
  club participando fuera de su área de origen (MoraBanc Andorra en ACB)
  nunca cambia el `scopeAreaId` real de la competición ni el `homeAreaId`
  real del club — geografía y participación son ejes DISTINTOS.
- Las capacidades de un nivel de detalle se DERIVAN SIEMPRE de
  `capabilitiesForDetailLevel()` — ninguna pantalla nueva mantiene un
  booleano paralelo (`isPlayable`, `hasBoxScore`...) que pueda
  desincronizarse. Una competición `catalog-only` nunca gana Edition,
  nivel seleccionable ni controles falsos — se muestra deshabilitada y
  explicada, nunca desaparece.
- `state.division` está PROHIBIDO como autoridad de cualquier pantalla
  nueva (selección de club, tabs de Competiciones/Estadísticas, filtro de
  noticias/lesiones, nombre de liga en Inicio) — sobrevive SOLO como
  proyección legacy (`team.legacyDivision`, escrita tras arrancar/cerrar
  temporada) y como puente interno de `closeSeasonAndPrepareNext()`
  (`getLeague(division)`/`getBrackets(division)`/
  `competitionIdForDivision()`, usado solo para honores de cierre vía
  `SeasonHistoryService`, sin ninguna pantalla que ya los consulte). Toda
  pantalla nueva que necesite "la liga/bracket del usuario (o de un
  equipo cualquiera)" usa `getUserLeague()`/`getLeagueForTeam(team)`/
  `isUserInTopFlight()`/`getUserBracketsReal()`
  (`teamLeagueCompetitionId(team)` vía `CompetitionParticipationService`
  por debajo) — nunca compara `team.division`.
- `spain-2026.1.js` instala con el contexto CANÓNICO `teamsByCompetitionId`
  (`{[competitionDefinitionId]: Team[]}`); `teamsByDivision` sigue
  aceptado por un normalizador privado SOLO para fixtures históricos
  (`scripts/test-world-calendar1.js`/`smoke-world-calendar1.js`/
  `test-club-core1.js` y similares) — ningún call-site productivo nuevo
  lo usa. `SPAIN_CLUB_CONTENT.initialCompetitionDefinitionId` es la fuente
  de pertenencia competitiva de cada `teamId` — nunca
  `REAL_DATA_INDEX.division`.
- Cualquier puente legacy que quede documentado en esta entrega
  (`getLeague`/`getBrackets`/`competitionIdForDivision` internos,
  `UI_COMPETITION_KEY_BY_STAGE_KEY`, `teamsByDivision` en fixtures
  históricos, `state.division` como proyección) tiene dueño
  **WORLD-HARDEN-1** — no se retira aquí, y ninguna sesión futura debe
  asumir que ya desapareció.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambien la configuración de carrera, el contrato de manifiesto
  `careerSetup` o la navegación mundial.
