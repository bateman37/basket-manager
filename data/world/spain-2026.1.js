// data/world/spain-2026.1.js
// WORLD-CORE-1 — paquete de contenido "España": ACB + Primera FEB pasan de
// ser el mundo del motor a ser el primer contenido instalado sobre él.
// Depende de `world-core-2026.1`. Reutiliza las instancias de `Team`/
// `Player` YA CONSTRUIDAS por `game.js` (nunca las recrea) y las 36
// referencias reales de `data/real/real-data-bundle.js` — no copia esos
// JSON aquí ni toca `data/real/*`. Convención del proyecto: identificadores
// en inglés, comentarios en español.
//
// Igual que `SpainLegacyCompetitionRuntime.js`, este archivo es uno de los
// DOS sitios permitidos para literales de España ('1ª'/'2ª'/ACB/Primera
// FEB) fuera del catálogo de identidad — ningún archivo mundial GENÉRICO
// nuevo puede contenerlos (auditado en `scripts/test-world-core1.js`).
//
// CLUB-CORE-1 (DESIGN.md sección 10): retira el puente
// `club.id === primaryTeam.id` — cada uno de los 36 clubes recibe un
// `clubId` institucional EXPLÍCITO, distinto de su `teamId` deportivo (ver
// `CLUB_CONTENT` más abajo), y un `Squad` senior activo con las MISMAS
// instancias de `Player` del roster ya construido. El estado institucional
// heredado de `Team` (presupuesto/instalaciones/junta/afición/finanzas/ADN)
// se migra al `Club` recién creado SIN duplicarlo — se lee UNA vez de la
// forma de "bootstrap" que `Team` ya construyó desde los mismos datos
// reales, y a partir de ahí `Team` delega en esta misma instancia (ver
// `src/entities/Team.js`).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const GeographyModule = dep('../../src/entities/Geography.js');
  const OrganizationModule = dep('../../src/entities/Organization.js');
  const ClubModule = dep('../../src/entities/Club.js');
  const SquadModule = dep('../../src/entities/Squad.js');
  const CompetitionCatalogModule = dep('../../src/core/CompetitionCatalog.js');
  const CompetitionFormatCatalogModule = dep('../../src/core/CompetitionFormatCatalog.js');
  const CompetitionScheduleCatalogModule = dep('../../src/core/CompetitionScheduleCatalog.js');
  const CompetitionEngineModule = dep('../../src/core/CompetitionEngine.js');
  const CompetitionPathwayCatalogModule = dep('../../src/core/CompetitionPathwayCatalog.js');
  const WorldCoreManifestModule = dep('./world-core-2026.1.js');

  function Geo() { return GeographyModule; }
  function Org() { return OrganizationModule; }
  function ClubEntity() { return ClubModule; }
  function SquadEntity() { return SquadModule; }
  function Catalog() { return CompetitionCatalogModule; }
  function FormatCatalog() { return CompetitionFormatCatalogModule; }
  function ScheduleCatalog() { return CompetitionScheduleCatalogModule.CompetitionScheduleCatalog; }
  function Engine() { return CompetitionEngineModule; }
  function PathwayCatalog() { return CompetitionPathwayCatalogModule; }
  function EuropeAreaId() {
    return (WorldCoreManifestModule.WORLD_CORE_AREA_IDS || { EUROPE: 'area-continent-europe' }).EUROPE;
  }

  const MANIFEST_ID = 'spain-2026.1';

  const AREA_IDS = { SPAIN: 'area-country-es', ANDORRA: 'area-country-ad' };
  const ORG_IDS = { FEB: 'org-feb', ACB: 'org-acb' };

  // --- CLUB-CORE-1 (DESIGN.md sección 10, apartado 8.1 del prompt) -------
  // Tabla de contenido EXPLÍCITA de los 36 clubes: `clubId` institucional
  // distinto de `teamId` deportivo, jurisdicción laboral del empleador y
  // ciudad institucional (documental, mismo dato que antes vivía en
  // `ClubEmploymentContextCatalog.ES_CLUBS` — CLUB-CORE-1 lo traslada aquí
  // porque es contenido de ESTE paquete, no una regla normativa
  // reutilizable). **No se deriva `clubId` de `teamId` con una
  // transformación genérica en tiempo de ejecución** (`teamId.replace(...)`
  // como regla universal está prohibido, sección 8.1 del prompt) — los 36
  // pares están listados aquí de forma explícita y estable.
  // MoraBanc Andorra sigue siendo el ÚNICO caso con
  // `employerJurisdictionId: 'AD'` — el test transfronterizo obligatorio de
  // toda la EPIC (organizador ACB/España, empleador domiciliado en
  // Andorra).
  const CLUB_CONTENT = [
    { teamId: 'team-asisa-joventut', clubId: 'club-asisa-joventut', city: 'Badalona', employerJurisdictionId: 'ES' },
    { teamId: 'team-barca', clubId: 'club-barca', city: 'Barcelona', employerJurisdictionId: 'ES' },
    { teamId: 'team-casademont-zaragoza', clubId: 'club-casademont-zaragoza', city: 'Zaragoza', employerJurisdictionId: 'ES' },
    { teamId: 'team-fiatc-girona', clubId: 'club-fiatc-girona', city: 'Girona', employerJurisdictionId: 'ES' },
    { teamId: 'team-ilerna-lleida', clubId: 'club-ilerna-lleida', city: 'Lleida', employerJurisdictionId: 'ES' },
    { teamId: 'team-kids-and-us-manresa', clubId: 'club-kids-and-us-manresa', city: 'Manresa', employerJurisdictionId: 'ES' },
    { teamId: 'team-kosner-baskonia', clubId: 'club-kosner-baskonia', city: 'Vitoria-Gasteiz', employerJurisdictionId: 'ES' },
    { teamId: 'team-la-laguna-tenerife', clubId: 'club-la-laguna-tenerife', city: 'San Cristóbal de La Laguna', employerJurisdictionId: 'ES' },
    { teamId: 'team-leyma-coruna', clubId: 'club-leyma-coruna', city: 'A Coruña', employerJurisdictionId: 'ES' },
    { teamId: 'team-monbus-obradoiro', clubId: 'club-monbus-obradoiro', city: 'Santiago de Compostela', employerJurisdictionId: 'ES' },
    { teamId: 'team-real-madrid', clubId: 'club-real-madrid', city: 'Madrid', employerJurisdictionId: 'ES' },
    { teamId: 'team-recoletas-salud-san-pablo-burgos', clubId: 'club-recoletas-salud-san-pablo-burgos', city: 'Burgos', employerJurisdictionId: 'ES' },
    { teamId: 'team-rio-breogan', clubId: 'club-rio-breogan', city: 'Lugo', employerJurisdictionId: 'ES' },
    { teamId: 'team-surne-bilbao-basket', clubId: 'club-surne-bilbao-basket', city: 'Bilbao', employerJurisdictionId: 'ES' },
    { teamId: 'team-ucam-murcia', clubId: 'club-ucam-murcia', city: 'Murcia', employerJurisdictionId: 'ES' },
    { teamId: 'team-unicaja', clubId: 'club-unicaja', city: 'Málaga', employerJurisdictionId: 'ES' },
    { teamId: 'team-valencia-basket', clubId: 'club-valencia-basket', city: 'Valencia', employerJurisdictionId: 'ES' },
    { teamId: 'team-alimerka-oviedo', clubId: 'club-alimerka-oviedo', city: 'Oviedo', employerJurisdictionId: 'ES' },
    { teamId: 'team-grupo-alega-cantabria', clubId: 'club-grupo-alega-cantabria', city: 'Santander', employerJurisdictionId: 'ES' },
    { teamId: 'team-bueno-arenas-albacete', clubId: 'club-bueno-arenas-albacete', city: 'Albacete', employerJurisdictionId: 'ES' },
    { teamId: 'team-grupo-ureta-tizona-burgos', clubId: 'club-grupo-ureta-tizona-burgos', city: 'Burgos', employerJurisdictionId: 'ES' },
    { teamId: 'team-caja-rural-cb-zamora', clubId: 'club-caja-rural-cb-zamora', city: 'Zamora', employerJurisdictionId: 'ES' },
    { teamId: 'team-basquet-menorca', clubId: 'club-basquet-menorca', city: 'Maó', employerJurisdictionId: 'ES' },
    { teamId: 'team-cajasol-coto-cordoba', clubId: 'club-cajasol-coto-cordoba', city: 'Córdoba', employerJurisdictionId: 'ES' },
    { teamId: 'team-insolac-caja87', clubId: 'club-insolac-caja87', city: 'Huelva', employerJurisdictionId: 'ES' },
    { teamId: 'team-club-ourense-baloncesto', clubId: 'club-ourense-baloncesto', city: 'Ourense', employerJurisdictionId: 'ES' },
    { teamId: 'team-inveready-askatuak-gipuzkoa', clubId: 'club-inveready-askatuak-gipuzkoa', city: 'San Sebastián', employerJurisdictionId: 'ES' },
    { teamId: 'team-coviran-granada', clubId: 'club-coviran-granada', city: 'Granada', employerJurisdictionId: 'ES' },
    { teamId: 'team-hla-alicante', clubId: 'club-hla-alicante', city: 'Alicante', employerJurisdictionId: 'ES' },
    { teamId: 'team-fibwi-mallorca-basquet-palma', clubId: 'club-fibwi-mallorca-basquet-palma', city: 'Palma', employerJurisdictionId: 'ES' },
    { teamId: 'team-movistar-estudiantes', clubId: 'club-movistar-estudiantes', city: 'Madrid', employerJurisdictionId: 'ES' },
    { teamId: 'team-flexicar-fuenlabrada', clubId: 'club-flexicar-fuenlabrada', city: 'Fuenlabrada', employerJurisdictionId: 'ES' },
    { teamId: 'team-palmer-basket-mallorca-palma', clubId: 'club-palmer-basket-mallorca-palma', city: 'Palma', employerJurisdictionId: 'ES' },
    { teamId: 'team-gran-canaria', clubId: 'club-gran-canaria', city: 'Las Palmas de Gran Canaria', employerJurisdictionId: 'ES' },
    { teamId: 'team-palencia-baloncesto', clubId: 'club-palencia-baloncesto', city: 'Palencia', employerJurisdictionId: 'ES' },
    // El caso transfronterizo obligatorio de esta EPIC.
    { teamId: 'team-morabanc-andorra', clubId: 'club-morabanc-andorra', city: 'Andorra la Vella', employerJurisdictionId: 'AD' },
  ];

  const CLUB_CONTENT_BY_TEAM_ID = new Map(CLUB_CONTENT.map((entry) => [entry.teamId, entry]));

  function registerAreas(world) {
    const europeAreaId = EuropeAreaId();
    world.registries.registerArea(new (Geo().GeographicArea)({
      id: AREA_IDS.SPAIN,
      type: 'country',
      parentAreaId: europeAreaId,
      name: 'España',
      isoCode: 'ES',
      status: 'active',
      provenance: { dataSource: MANIFEST_ID, status: 'verified' },
    }));
    // Andorra: país DISTINTO de España bajo Europa (sección 6 del prompt) —
    // MoraBanc Andorra es el test transfronterizo obligatorio de toda la
    // EPIC "Ciclo profesional de plantilla" (ver CLAUDE.md): compite en ACB
    // (España) con jurisdicción laboral y área de origen andorranas.
    world.registries.registerArea(new (Geo().GeographicArea)({
      id: AREA_IDS.ANDORRA,
      type: 'country',
      parentAreaId: europeAreaId,
      name: 'Andorra',
      isoCode: 'AD',
      status: 'active',
      provenance: { dataSource: MANIFEST_ID, status: 'verified' },
    }));
  }

  function registerOrganizations(world) {
    world.registries.registerOrganization(new (Org().Organization)({
      id: ORG_IDS.FEB,
      name: 'Federación Española de Baloncesto',
      type: 'national-federation',
      headquartersAreaId: AREA_IDS.SPAIN,
      scopeAreaId: AREA_IDS.SPAIN,
      provenance: { dataSource: MANIFEST_ID, status: 'verified' },
    }));
    world.registries.registerOrganization(new (Org().Organization)({
      id: ORG_IDS.ACB,
      name: 'Asociación de Clubs de Baloncesto (ACB)',
      type: 'league-operator',
      headquartersAreaId: AREA_IDS.SPAIN,
      scopeAreaId: AREA_IDS.SPAIN,
      // ACB opera bajo el paraguas federativo de la FEB a efectos de
      // competición doméstica — organización superior DECLARADA, nunca
      // inferida (ARCH-WORLD-08).
      parentOrganizationId: ORG_IDS.FEB,
      provenance: { dataSource: MANIFEST_ID, status: 'verified' },
    }));
  }

  // Registra Club + Team + Squad para cada equipo YA CONSTRUIDO por
  // game.js. CLUB-CORE-1 retira el puente `club.id === team.id`: cada club
  // recibe su `clubId` institucional real de `CLUB_CONTENT` (arriba),
  // distinto de `team.id`.
  function registerClubsAndTeams(world, teamsByDivision) {
    const allTeams = [...teamsByDivision['1ª'], ...teamsByDivision['2ª']];
    allTeams.forEach((team) => {
      const entry = CLUB_CONTENT_BY_TEAM_ID.get(team.id);
      if (!entry) {
        throw new Error(
          `spain-2026.1: el equipo "${team.id}" no tiene entrada en la tabla de contenido de clubes `
          + '(CLUB_CONTENT) — los 36 mapeos clubId/teamId deben declararse explícitamente.',
        );
      }
      const homeAreaId = entry.employerJurisdictionId === 'AD' ? AREA_IDS.ANDORRA : AREA_IDS.SPAIN;

      // El estado institucional se LEE de `team` (todavía sin `club`
      // enlazado, así que estos accesores devuelven el "bootstrap" ya
      // construido por Team.js desde los mismos datos reales, ver
      // `src/entities/Team.js`) — se migra al `Club` nuevo SIN duplicarlo:
      // en cuanto se asigne `team.club` más abajo, `team.budget`/
      // `team.facilities`/etc. delegarán en esta MISMA instancia.
      const club = new (ClubEntity().Club)({
        id: entry.clubId,
        name: team.name,
        shortName: team.name,
        homeAreaId,
        employerJurisdictionAreaId: homeAreaId,
        federationMembershipOrganizationIds: [ORG_IDS.FEB],
        primaryTeamId: team.id,
        status: 'active',
        dataSource: MANIFEST_ID,
        provenance: { dataSource: MANIFEST_ID, status: 'verified' },
        foundationYear: team.foundationYear,
        budget: team.budget,
        reputation: { financial: team.reputation.financial, youth: team.reputation.youth },
        facilities: team.facilities,
        board: team.board,
        fanbase: team.fanbase,
        finances: team.finances,
        clubDNA: team.clubDNA,
      });
      world.registries.registerClub(club);

      // Enlaza Club <-> Team (referencias VIVAS, nunca copias) — mismo
      // patrón que ya usaba `team.clubId` desde WORLD-CORE-1, ahora con un
      // id realmente distinto.
      team.clubId = club.id;
      team.club = club;
      team.homeAreaId = homeAreaId;
      team.legacyDivision = team.division;
      world.registries.registerTeam(team);

      // Squad senior activo — reutiliza las MISMAS instancias de Player
      // del roster ya construido (invariante 9: Squad/Team.roster/
      // PlayerRegistry referencian la misma instancia viva).
      const squad = new (SquadEntity().Squad)({
        id: `squad:${team.id}:senior`,
        teamId: team.id,
        name: `${team.fullName} — primer equipo`,
        squadType: 'first-team-senior',
        status: 'active',
        players: team.roster,
        dataSource: MANIFEST_ID,
        provenance: { dataSource: MANIFEST_ID, status: 'verified' },
      });
      world.registries.registerSquad(squad);
      team.primarySquadId = squad.id;
      team.squad = squad;
    });
  }

  function registerCompetitionDefinitions(world) {
    const ids = [
      Catalog().COMPETITION_IDS.ACB,
      Catalog().COMPETITION_IDS.PRIMERA_FEB,
      Catalog().COMPETITION_IDS.COPA_ACB,
      // catalog-only: identidad declarada sin edición jugable (sección 6/15
      // del prompt) — no se fabrican participantes/calendario/reglas.
      Catalog().COMPETITION_IDS.SUPERCOPA_ACB,
    ];
    // REFERENCIAS al catálogo canónico — nunca una copia (ARCH-WORLD-04).
    ids.forEach((id) => world.registries.registerCompetitionDefinition(Catalog().getCompetitionDefinition(id)));
  }

  // -----------------------------------------------------------------------
  // COMP-CORE-1 (DESIGN.md 10.13) — formato de cada competición como DATO,
  // registrado en el catálogo GENÉRICO de formatos (`CompetitionFormatCatalog.js`).
  // Ninguno de los runners/engine genéricos contiene estos números — viven
  // SOLO aquí, exactamente igual que el resto de literales de España
  // permitidos en este archivo (ver cabecera).
  //
  // Los 5 pasos de desempate son GENÉRICOS (ver CompetitionRunners.js:
  // ningún paso se llama "ACB" dentro del runner) — ACB y Primera FEB
  // declaran la MISMA secuencia por compatibilidad (DESIGN.md 3.1), nunca
  // presentada como normativa nueva si el repositorio no lo documentaba así.
  // -----------------------------------------------------------------------
  const TIEBREAK_STEPS = [
    { type: 'group-head-to-head-balance' },
    { type: 'group-head-to-head-point-diff' },
    { type: 'overall-point-diff' },
    { type: 'overall-points-for' },
    { type: 'overall-quotient-sum' },
  ];

  const FORMAT_IDS = {
    ACB_LIGA_PLAYOFF: 'spain-2026.1:format:acb-liga-playoff',
    PRIMERA_FEB_LIGA_ASCENSO: 'spain-2026.1:format:primera-feb-liga-ascenso',
    COPA_ACB_KNOCKOUT: 'spain-2026.1:format:copa-acb-knockout',
  };

  function registerFormats() {
    const FC = FormatCatalog();
    if (FC.hasFormat(FORMAT_IDS.ACB_LIGA_PLAYOFF)) return; // idempotente (recarga del mismo módulo)

    // ACB: Liga regular (18, ida/vuelta, 2/1 puntos) + Playoff por el
    // título (top 8, cuadro 1-8/4-5/2-7/3-6, cuartos BO3, semis/final BO5)
    // — DESIGN.md 3.1/3.2.2.
    FC.registerFormat({
      id: FORMAT_IDS.ACB_LIGA_PLAYOFF,
      version: '2026.1.0',
      status: 'active',
      participantType: 'club-team',
      provenance: { dataSource: MANIFEST_ID, status: 'verified', notes: 'DESIGN.md 3.1/3.2.2 — Liga ACB + Playoff por el título.' },
      stageTemplates: [
        {
          key: 'regular-season',
          name: 'Liga regular',
          stageType: 'round-robin',
          runnerType: 'round-robin',
          sequence: 1,
          activation: { type: 'edition-start' },
          entrySource: { type: 'initial-participants' },
          runnerConfig: {
            legs: 2, pointsWin: 2, pointsLoss: 1, requireExactParticipantCount: 18, tiebreakSteps: TIEBREAK_STEPS,
          },
          completesEdition: false,
        },
        {
          key: 'title-playoff',
          name: 'Playoff por el título',
          stageType: 'knockout',
          runnerType: 'bracket',
          sequence: 2,
          // PATHWAYS-1 (DESIGN.md 10.15, BUG-PATHWAYS-01): el FORMATO ya no
          // decide top-8 ni cuándo se activa — solo declara que la fase
          // EXISTE y CÓMO se disputa (cuadro fijo/patrones de campo). Quién
          // la alcanza lo decide `SPAIN_PATHWAY_ID` (regla
          // "acb-title-playoff-qualification").
          activation: { type: 'pathway-managed' },
          entrySource: { type: 'pathway-managed' },
          runnerConfig: {
            firstRoundPairing: [[1, 8], [4, 5], [2, 7], [3, 6]],
            roundPatterns: ['best-of-3-1-1-1', 'best-of-5-2-2-1', 'best-of-5-2-2-1'],
          },
          completesEdition: true,
        },
      ],
    });

    // Primera FEB: Liga regular (18, ida/vuelta, misma secuencia de
    // desempate) + Playoff de ascenso (campeón asciende directo; 2º-9º
    // juegan cuartos BO5 2-2-1 [2v9/3v8/4v7/5v6] + Final Four a partido
    // único, con reseed best-vs-worst de los 4 ganadores) — DESIGN.md
    // 3.1/3.2.3. El "1º asciende directo" es una vista de compatibilidad
    // (nunca una Entry/Stage) — ver `describeDirectPromotion()` en game.js.
    FC.registerFormat({
      id: FORMAT_IDS.PRIMERA_FEB_LIGA_ASCENSO,
      version: '2026.1.0',
      status: 'active',
      participantType: 'club-team',
      provenance: { dataSource: MANIFEST_ID, status: 'verified', notes: 'DESIGN.md 3.1/3.2.3 — Primera FEB + Playoff de ascenso.' },
      stageTemplates: [
        {
          key: 'regular-season',
          name: 'Liga regular',
          stageType: 'round-robin',
          runnerType: 'round-robin',
          sequence: 1,
          activation: { type: 'edition-start' },
          entrySource: { type: 'initial-participants' },
          runnerConfig: {
            legs: 2, pointsWin: 2, pointsLoss: 1, requireExactParticipantCount: 18, tiebreakSteps: TIEBREAK_STEPS,
          },
          completesEdition: false,
        },
        {
          key: 'promotion-quarterfinals',
          name: 'Cuartos de ascenso',
          stageType: 'knockout',
          runnerType: 'bracket',
          sequence: 2,
          // PATHWAYS-1 (BUG-PATHWAYS-01): igual que el playoff por el
          // título — el rango 2-9 vive en la regla de pathway
          // "feb-promotion-quarterfinals-qualification", nunca aquí.
          activation: { type: 'pathway-managed' },
          entrySource: { type: 'pathway-managed' },
          runnerConfig: {
            firstRoundPairing: [[2, 9], [3, 8], [4, 7], [5, 6]],
            roundPatterns: ['best-of-5-2-2-1'],
          },
          completesEdition: false,
        },
        {
          key: 'promotion-final-four',
          name: 'Final Four de ascenso',
          stageType: 'final-four',
          runnerType: 'bracket',
          sequence: 3,
          // PATHWAYS-1 (BUG-PATHWAYS-01): el reseed best-vs-worst de los 4
          // ganadores lo calcula el `seedPolicy` de la regla de pathway
          // "feb-promotion-final-four-qualification" — el formato solo
          // declara el patrón de campo (single-game/single-game).
          activation: { type: 'pathway-managed' },
          entrySource: { type: 'pathway-managed' },
          runnerConfig: { roundPatterns: ['single-game', 'single-game'] },
          completesEdition: true,
        },
      ],
    });

    // Copa ACB: `CompetitionDefinition`/Edition SEPARADA (invariante 12/13)
    // — mismo cuadro que el playoff por el título, tres rondas a partido
    // único, con la foto de clasificación de la jornada 17 de ACB
    // (activación CRUZADA, ver `buildSeasonActivationPlan()`). DESIGN.md
    // 3.2.4.
    FC.registerFormat({
      id: FORMAT_IDS.COPA_ACB_KNOCKOUT,
      version: '2026.1.0',
      status: 'active',
      participantType: 'club-team',
      provenance: { dataSource: MANIFEST_ID, status: 'verified', notes: 'DESIGN.md 3.2.4 — Copa ACB, foto de la jornada 17 de ACB.' },
      stageTemplates: [
        {
          key: 'knockout',
          name: 'Eliminatoria de Copa',
          stageType: 'knockout',
          runnerType: 'bracket',
          sequence: 1,
          activation: { type: 'edition-start' },
          entrySource: { type: 'initial-participants' },
          runnerConfig: {
            firstRoundPairing: [[1, 8], [4, 5], [2, 7], [3, 6]],
            roundPatterns: ['single-game', 'single-game', 'single-game'],
          },
          completesEdition: true,
        },
      ],
    });
  }

  // Jornada de ACB que dispara la Copa (DESIGN.md 3.2.4) — mismo número que
  // usaba `Cup.CUP_TRIGGER_ROUND`, declarado aquí como DATO del contenido
  // (no un literal dentro del engine genérico).
  const CUP_TRIGGER_ROUND = 17;

  // =======================================================================
  // WORLD-CALENDAR-1 (DESIGN.md 10.14) — CALENDARIOS como contenido
  // versionado de ESTE paquete. Los números que antes vivían en
  // `CONFIG_BASE.calendar` (`MatchConfig.js`) y las fórmulas que vivían en
  // `Calendar.js` se trasladan aquí SIN RECALIBRARLOS: mismas franjas
  // ponderadas, misma cadencia, misma jornada intersemanal, mismas
  // exclusiones, misma ventana de Copa y mismos arranques de playoff. El
  // resultado observable de la temporada española es el MISMO que antes de
  // esta entrega; lo que cambia es que el instante canónico es UTC y el
  // huso (`Europe/Madrid`) es un dato EXPLÍCITO del perfil
  // (BUG-WORLDCALENDAR-03), no el huso del ordenador.
  //
  // Ids ESTABLES (`…:schedule:1a`/`…:schedule:2a` ya existían como alias en
  // `MatchConfig.js` desde COMP-CORE-1). La Copa recibe id propio y
  // explícito: con runtime fechado no puede quedar con
  // `scheduleProfileId: null`.
  // =======================================================================
  const SCHEDULE_IDS = {
    ACB: 'spain-2026.1:schedule:1a',
    PRIMERA_FEB: 'spain-2026.1:schedule:2a',
    COPA_ACB: 'spain-2026.1:schedule:copa-acb',
  };

  const SPAIN_TIME_ZONE_ID = 'Europe/Madrid';
  // Ancla civil de temporada: primer sábado orientativo de octubre (mismo
  // valor que `CONFIG_BASE.calendar.seasonStartMonth/Day`, ahora 1-indexed).
  const SEASON_ANCHOR = { month: 10, day: 3 };
  const DAYS_BETWEEN_ROUNDS = 7;
  // 18 equipos, ida y vuelta -> 34 jornadas (DESIGN.md 3.1). Declarado como
  // DATO del calendario: el scheduler comprueba que coincide con las
  // jornadas que genera el FORMATO y falla si no (nunca ajusta una de las
  // dos en silencio).
  const LEAGUE_ROUNDS_COUNT = 34;
  // Copa/Playoffs/Ascenso: horario único de "prime time" para toda la ronda
  // (DESIGN.md 3.3.2/3.3.3, misma decisión y misma limitación documentada).
  const KNOCKOUT_KICKOFF = { hour: 21, minute: 0 };
  const SERIES_GAME_GAP_DAYS = 2;
  const SERIES_ROUND_GAP_DAYS = 5;
  const SEASON_END_TO_PLAYOFF_GAP_DAYS = 10;
  // Patrón de campo de cada ronda expresado como NÚMERO DE PARTIDOS
  // posibles — el calendario solo necesita la duración máxima de la ronda
  // para no arrancar la siguiente antes de que la anterior pudiera acabar.
  const TITLE_PLAYOFF_ROUND_LENGTHS = [3, 5, 5];
  const PROMOTION_ROUND_LENGTHS = [5, 1, 1];

  const SCHEDULE_PROVENANCE = {
    dataSource: MANIFEST_ID,
    status: 'design',
    notes: 'Calendario SIMULADO de diseño (DESIGN.md 3.3) — no es el calendario oficial de ACB/Primera FEB/Copa.',
  };

  function leagueSchedulePlans(profile) {
    return {
      'regular-season': {
        strategy: 'round-robin-cadence',
        params: {
          roundsCount: LEAGUE_ROUNDS_COUNT,
          daysBetweenRounds: DAYS_BETWEEN_ROUNDS,
          weekendSlots: profile.weekendSlots,
          midweek: {
            ...profile.midweek,
            // La semana de la Copa (jornada 17) y la siguiente nunca son
            // jornada intersemanal — mismo criterio que `Calendar.js`
            // histórico, ahora como DATO del perfil en vez de un literal
            // dentro del algoritmo.
            excludedRounds: [CUP_TRIGGER_ROUND, CUP_TRIGGER_ROUND + 1],
          },
          lastRoundSlot: profile.lastRoundSlot,
        },
      },
    };
  }

  // Franjas ponderadas reales de cada división (DESIGN.md 3.3.1) —
  // trasladadas literalmente desde `CONFIG_BASE.calendar.scheduleProfiles`.
  const ACB_LEAGUE_PROFILE = {
    weekendSlots: [
      { dayOffset: -1, hour: 21, minute: 0, weight: 1 }, // viernes noche (ocasional)
      { dayOffset: 0, hour: 17, minute: 0, weight: 3 }, // sábado tarde
      { dayOffset: 0, hour: 19, minute: 0, weight: 3 }, // sábado tarde-noche
      { dayOffset: 0, hour: 21, minute: 0, weight: 2 }, // sábado noche
      { dayOffset: 1, hour: 12, minute: 30, weight: 2 }, // domingo mediodía
      { dayOffset: 1, hour: 17, minute: 0, weight: 3 }, // domingo tarde
      { dayOffset: 1, hour: 19, minute: 0, weight: 2 }, // domingo tarde-noche
    ],
    midweek: {
      dayOffset: -3, // miércoles de la semana de ese sábado ancla
      slots: [{ hour: 20, minute: 30, weight: 1 }, { hour: 21, minute: 0, weight: 1 }],
      everyNRounds: 8,
    },
    // Última jornada: horario ÚNICO para toda la división (DESIGN.md 3.3.1).
    lastRoundSlot: { dayOffset: 0, hour: 18, minute: 0 },
  };

  const PRIMERA_FEB_LEAGUE_PROFILE = {
    weekendSlots: [
      { dayOffset: -1, hour: 20, minute: 30, weight: 2 }, // viernes noche
      { dayOffset: 0, hour: 12, minute: 0, weight: 1 }, // sábado mediodía
      { dayOffset: 0, hour: 17, minute: 0, weight: 2 }, // sábado tarde
      { dayOffset: 0, hour: 19, minute: 0, weight: 2 }, // sábado tarde-noche
      { dayOffset: 1, hour: 12, minute: 0, weight: 2 }, // domingo mediodía
      { dayOffset: 1, hour: 17, minute: 0, weight: 2 }, // domingo tarde
    ],
    midweek: {
      dayOffset: -3,
      slots: [{ hour: 20, minute: 0, weight: 1 }, { hour: 20, minute: 30, weight: 1 }],
      everyNRounds: 8,
    },
    lastRoundSlot: { dayOffset: 1, hour: 12, minute: 0 },
  };

  function registerSchedules() {
    const SC = ScheduleCatalog();
    if (SC.hasSchedule(SCHEDULE_IDS.ACB)) return; // idempotente (recarga del mismo módulo)

    SC.registerSchedule({
      id: SCHEDULE_IDS.ACB,
      version: '2026.1.0',
      status: 'active',
      timeZoneId: SPAIN_TIME_ZONE_ID,
      seasonAnchor: SEASON_ANCHOR,
      provenance: SCHEDULE_PROVENANCE,
      plans: {
        ...leagueSchedulePlans(ACB_LEAGUE_PROFILE),
        // Playoff por el título (DESIGN.md 3.3.3): arranca
        // `seasonEndToPlayoffGapDays` después de la ÚLTIMA jornada de SU
        // PROPIA liga regular — referencia PLANA al plan de esta misma
        // definición, nunca "la liga de 1ª división".
        'title-playoff': {
          strategy: 'bracket-offsets',
          params: {
            anchor: {
              type: 'round-robin-round', planKey: 'regular-season', round: 'last', offsetDays: SEASON_END_TO_PLAYOFF_GAP_DAYS,
            },
            offsetPolicy: 'series-cadence',
            roundPatternLengths: TITLE_PLAYOFF_ROUND_LENGTHS,
            seriesGameGapDays: SERIES_GAME_GAP_DAYS,
            seriesRoundGapDays: SERIES_ROUND_GAP_DAYS,
            kickoff: KNOCKOUT_KICKOFF,
          },
        },
      },
    });

    SC.registerSchedule({
      id: SCHEDULE_IDS.PRIMERA_FEB,
      version: '2026.1.0',
      status: 'active',
      timeZoneId: SPAIN_TIME_ZONE_ID,
      seasonAnchor: SEASON_ANCHOR,
      provenance: SCHEDULE_PROVENANCE,
      plans: {
        ...leagueSchedulePlans(PRIMERA_FEB_LEAGUE_PROFILE),
        // Cuartos de ascenso y Final Four comparten el MISMO tramo de
        // fechas (la Final Four continúa la numeración de rondas de sus
        // propios cuartos, `roundIndexOffset: 1`) — mismo criterio que ya
        // documentaba `Promotion.js`, ahora como dato del plan.
        'promotion-quarterfinals': {
          strategy: 'bracket-offsets',
          params: {
            anchor: {
              type: 'round-robin-round', planKey: 'regular-season', round: 'last', offsetDays: SEASON_END_TO_PLAYOFF_GAP_DAYS,
            },
            offsetPolicy: 'series-cadence',
            roundPatternLengths: PROMOTION_ROUND_LENGTHS,
            seriesGameGapDays: SERIES_GAME_GAP_DAYS,
            seriesRoundGapDays: SERIES_ROUND_GAP_DAYS,
            roundIndexOffset: 0,
            kickoff: KNOCKOUT_KICKOFF,
          },
        },
        'promotion-final-four': {
          strategy: 'bracket-offsets',
          params: {
            anchor: {
              type: 'round-robin-round', planKey: 'regular-season', round: 'last', offsetDays: SEASON_END_TO_PLAYOFF_GAP_DAYS,
            },
            offsetPolicy: 'series-cadence',
            roundPatternLengths: PROMOTION_ROUND_LENGTHS,
            seriesGameGapDays: SERIES_GAME_GAP_DAYS,
            seriesRoundGapDays: SERIES_ROUND_GAP_DAYS,
            roundIndexOffset: 1,
            kickoff: KNOCKOUT_KICKOFF,
          },
        },
      },
    });

    // Copa ACB (DESIGN.md 3.3.2): las tres rondas caben en el hueco FIJO
    // que separa la jornada 17 de la 18 de la Liga ACB, con un colchón
    // mínimo antes de la 18. Referencia PLANA a la jornada disparadora
    // (`anchor.scheduleId` + `planKey` + `round`) — el scheduler resuelve
    // el ancla sin saber que se trata de ACB.
    SC.registerSchedule({
      id: SCHEDULE_IDS.COPA_ACB,
      version: '2026.1.0',
      status: 'active',
      timeZoneId: SPAIN_TIME_ZONE_ID,
      seasonAnchor: SEASON_ANCHOR,
      provenance: SCHEDULE_PROVENANCE,
      plans: {
        knockout: {
          strategy: 'bracket-offsets',
          params: {
            anchor: {
              type: 'round-robin-round',
              scheduleId: SCHEDULE_IDS.ACB,
              planKey: 'regular-season',
              round: CUP_TRIGGER_ROUND,
              offsetDays: 0,
            },
            offsetPolicy: 'compressed-window',
            roundCount: 3,
            roundGapDays: 3, // separación ORIENTATIVA entre rondas; se comprime si no cabe
            windowDays: DAYS_BETWEEN_ROUNDS, // el hueco total NUNCA se alarga
            finalCushionDays: 2, // regla dura: descanso mínimo antes de la jornada 18
            kickoff: KNOCKOUT_KICKOFF,
          },
        },
      },
    });
  }

  // Bindings congelados por edición (sección 11.2 del prompt): ids de
  // formato/calendario/ruleset EXPLÍCITOS, nunca el objeto de reglas
  // incrustado. `scheduleProfileId` usa el MISMO id ya declarado en
  // `CompetitionCatalog.js` (`bindings.scheduleProfileId`) — `Calendar`
  // ya sabe resolverlo (alias añadido a `MatchConfig.js`, sección 11.2).
  // PATHWAYS-1 (DESIGN.md 10.15) — id ESTABLE del pathway doméstico de
  // clubes de España, y del transition group ACB<->Primera FEB (sección
  // 10.3 del prompt).
  const PATHWAY_IDS = { DOMESTIC_CLUB: 'spain-2026.1:pathway:domestic-club-v1' };
  const DOMESTIC_TRANSITION_GROUP_ID = 'acb-feb-domestic-v1';

  function editionBindings(competitionId) {
    const definition = Catalog().getCompetitionDefinition(competitionId);
    if (competitionId === Catalog().COMPETITION_IDS.ACB) {
      return {
        formatBindingId: FORMAT_IDS.ACB_LIGA_PLAYOFF,
        scheduleProfileId: definition.bindings.scheduleProfileId,
        rulesetBundleId: 'acb-domestic-2025-26-v1',
        // PATHWAYS-1: toda Edition de ACB congela el pathway doméstico — es
        // quien decide top-8/Copa/descenso, nunca el formato.
        pathwayBindingIds: [PATHWAY_IDS.DOMESTIC_CLUB],
      };
    }
    if (competitionId === Catalog().COMPETITION_IDS.PRIMERA_FEB) {
      return {
        formatBindingId: FORMAT_IDS.PRIMERA_FEB_LIGA_ASCENSO,
        scheduleProfileId: definition.bindings.scheduleProfileId,
        rulesetBundleId: 'primera-feb-domestic-2026-27-v1',
        pathwayBindingIds: [PATHWAY_IDS.DOMESTIC_CLUB],
      };
    }
    if (competitionId === Catalog().COMPETITION_IDS.COPA_ACB) {
      // WORLD-CALENDAR-1: la Copa YA tiene calendario propio congelado por
      // Edition (antes `null`) — su runtime tiene fechas reales. La Copa no
      // alimenta ninguna regla de pathway propia (invariante "la Copa no
      // altera la membership de liga") — sin pathwayBindingIds.
      return {
        formatBindingId: FORMAT_IDS.COPA_ACB_KNOCKOUT, scheduleProfileId: definition.bindings.scheduleProfileId, rulesetBundleId: 'copa-acb-domestic-2025-26-v1', pathwayBindingIds: [],
      };
    }
    throw new Error(`spain-2026.1: sin bindings declarados para la competición "${competitionId}".`);
  }

  // -----------------------------------------------------------------------
  // PATHWAYS-1 (DESIGN.md 10.15, sección 10 del prompt) — pathway doméstico
  // de clubes de España: playoff por el título, Copa (foto jornada 17),
  // playoff de ascenso y la transición conjunta ACB<->Primera FEB. Ningún
  // número de aquí vive en el core genérico (`CompetitionPathwayService.js`)
  // — auditado en `scripts/test-pathways1.js`.
  // -----------------------------------------------------------------------
  function registerPathways() {
    const PC = PathwayCatalog();
    if (PC.hasPathwayDefinition(PATHWAY_IDS.DOMESTIC_CLUB)) return; // idempotente

    const acbRef = (stageKey) => ({ competitionDefinitionId: Catalog().COMPETITION_IDS.ACB, stageKey });
    const febRef = (stageKey) => ({ competitionDefinitionId: Catalog().COMPETITION_IDS.PRIMERA_FEB, stageKey });

    PC.registerPathwayDefinition({
      id: PATHWAY_IDS.DOMESTIC_CLUB,
      version: '2026.1.0',
      status: 'active',
      participantType: 'club-team',
      provenance: { dataSource: MANIFEST_ID, status: 'verified', notes: 'DESIGN.md 3.2/3.4 — progresión doméstica ACB/Primera FEB/Copa.' },
      transitionGroups: {
        [DOMESTIC_TRANSITION_GROUP_ID]: {
          expectedCardinalityByCompetitionDefinitionId: {
            [Catalog().COMPETITION_IDS.ACB]: 18,
            [Catalog().COMPETITION_IDS.PRIMERA_FEB]: 18,
          },
          exclusivePyramid: true,
        },
      },
      rules: [
        // --- Dentro de temporada (stage-qualification/competition-qualification) ---
        {
          id: 'acb-title-playoff-qualification',
          kind: 'stage-qualification',
          trigger: { type: 'stage-completed', stageRef: acbRef('regular-season') },
          selector: { type: 'standings-range', stageRef: acbRef('regular-season'), fromRank: 1, toRank: 8 },
          destination: { type: 'stage', stageKey: 'title-playoff' },
          seedPolicy: 'source-rank',
          outcomeCode: 'title-playoff-qualified',
        },
        {
          id: 'acb-copa-qualification',
          kind: 'competition-qualification',
          trigger: { type: 'round-completed', stageRef: acbRef('regular-season'), round: CUP_TRIGGER_ROUND },
          selector: { type: 'standings-range', stageRef: acbRef('regular-season'), fromRank: 1, toRank: 8 },
          destination: { type: 'competition-edition', competitionDefinitionId: Catalog().COMPETITION_IDS.COPA_ACB, seasonRelation: 'same-season' },
          seedPolicy: 'source-rank',
          outcomeCode: 'copa-qualified',
        },
        {
          id: 'feb-promotion-quarterfinals-qualification',
          kind: 'stage-qualification',
          trigger: { type: 'stage-completed', stageRef: febRef('regular-season') },
          selector: { type: 'standings-range', stageRef: febRef('regular-season'), fromRank: 2, toRank: 9 },
          destination: { type: 'stage', stageKey: 'promotion-quarterfinals' },
          seedPolicy: 'source-rank',
          outcomeCode: 'promotion-quarterfinals-qualified',
        },
        {
          id: 'feb-promotion-final-four-qualification',
          kind: 'stage-qualification',
          trigger: { type: 'stage-completed', stageRef: febRef('promotion-quarterfinals') },
          selector: { type: 'bracket-final-round-winners', stageRef: febRef('promotion-quarterfinals') },
          destination: { type: 'stage', stageKey: 'promotion-final-four' },
          seedPolicy: 'best-vs-worst-by-seed',
          outcomeCode: 'promotion-final-four-qualified',
        },
        // --- Membresía de la temporada siguiente (transition group) --------
        {
          id: 'acb-relegation',
          kind: 'next-season-membership',
          transitionGroupId: DOMESTIC_TRANSITION_GROUP_ID,
          trigger: { type: 'season-transition' },
          selector: { type: 'standings-range', stageRef: acbRef('regular-season'), fromRank: 17, toRank: 18 },
          destination: { type: 'next-season-competition', competitionDefinitionId: Catalog().COMPETITION_IDS.PRIMERA_FEB },
          seedPolicy: 'none',
          outcomeCode: 'relegated',
        },
        {
          id: 'feb-direct-promotion',
          kind: 'next-season-membership',
          transitionGroupId: DOMESTIC_TRANSITION_GROUP_ID,
          trigger: { type: 'season-transition' },
          selector: { type: 'standings-range', stageRef: febRef('regular-season'), fromRank: 1, toRank: 1 },
          destination: { type: 'next-season-competition', competitionDefinitionId: Catalog().COMPETITION_IDS.ACB },
          seedPolicy: 'none',
          outcomeCode: 'promoted-direct',
        },
        {
          id: 'feb-playoff-promotion',
          kind: 'next-season-membership',
          transitionGroupId: DOMESTIC_TRANSITION_GROUP_ID,
          trigger: { type: 'season-transition' },
          selector: { type: 'bracket-champion', stageRef: febRef('promotion-final-four') },
          destination: { type: 'next-season-competition', competitionDefinitionId: Catalog().COMPETITION_IDS.ACB },
          seedPolicy: 'none',
          outcomeCode: 'promoted-playoff',
        },
        {
          id: 'acb-remaining-membership',
          kind: 'next-season-membership',
          transitionGroupId: DOMESTIC_TRANSITION_GROUP_ID,
          trigger: { type: 'season-transition' },
          selector: { type: 'remaining-participants', sourceCompetitionDefinitionId: Catalog().COMPETITION_IDS.ACB },
          destination: { type: 'next-season-competition', competitionDefinitionId: Catalog().COMPETITION_IDS.ACB },
          seedPolicy: 'none',
          outcomeCode: 'retained',
        },
        {
          id: 'feb-remaining-membership',
          kind: 'next-season-membership',
          transitionGroupId: DOMESTIC_TRANSITION_GROUP_ID,
          trigger: { type: 'season-transition' },
          selector: { type: 'remaining-participants', sourceCompetitionDefinitionId: Catalog().COMPETITION_IDS.PRIMERA_FEB },
          destination: { type: 'next-season-competition', competitionDefinitionId: Catalog().COMPETITION_IDS.PRIMERA_FEB },
          seedPolicy: 'none',
          outcomeCode: 'retained',
        },
      ],
    });
  }

  // Arranque de carrera (`startSeason()`): crea la Edition + stage de
  // Liga regular + 18 Entries de ACB y de Primera FEB — mismo id/esquema
  // que usaba `SpainLegacyCompetitionRuntime.bindCareerStart` (retirado de
  // la ruta productiva, sección 14 del prompt), ahora vía el helper
  // GENÉRICO del engine (`registerEditionWithInitialEntries`). El playoff
  // por el título / de ascenso y la Copa se activan más tarde, cuando el
  // engine procesa los hechos reales (`stage-completed`/`round-completed`)
  // — nunca se fabrican aquí de antemano.
  function bindCareerStartEditions(world, { seasonKey, teamsByDivision, startDate }) {
    const acbBindings = editionBindings(Catalog().COMPETITION_IDS.ACB);
    const febBindings = editionBindings(Catalog().COMPETITION_IDS.PRIMERA_FEB);
    const { edition: acbEdition } = Engine().registerEditionWithInitialEntries(world, {
      competitionDefinitionId: Catalog().COMPETITION_IDS.ACB,
      seasonKey,
      startDate: startDate || null,
      participants: teamsByDivision['1ª'].map((team) => ({ id: team.id })),
      ...acbBindings,
    });
    const { edition: febEdition } = Engine().registerEditionWithInitialEntries(world, {
      competitionDefinitionId: Catalog().COMPETITION_IDS.PRIMERA_FEB,
      seasonKey,
      startDate: startDate || null,
      participants: teamsByDivision['2ª'].map((team) => ({ id: team.id })),
      ...febBindings,
    });
    return { acbEdition, febEdition };
  }

  // Cierre de temporada (`closeSeasonAndPrepareNext()`): cierra las
  // ediciones/stages ACTIVOS previos de ACB/Primera FEB (nunca los borra,
  // sección 13.3) y abre las de la temporada nueva — mismo criterio que el
  // histórico `bindNewSeason`.
  function bindNewSeasonEditions(world, { seasonKey, teamsByDivision, startDate }) {
    [Catalog().COMPETITION_IDS.ACB, Catalog().COMPETITION_IDS.PRIMERA_FEB].forEach((competitionId) => {
      Engine().completePreviousEditions(world, competitionId);
    });
    return bindCareerStartEditions(world, { seasonKey, teamsByDivision, startDate });
  }

  // Plan de activación de TEMPORADA (sección 11.1 del prompt) — la ÚNICA
  // pieza de contenido que declara un checkpoint CRUZADO entre
  // competiciones (Copa disparada por la jornada 17 de ACB, invariante 12:
  // Copa es Definition/Edition separada). El core (`CompetitionEngine`)
  // procesa esto de forma GENÉRICA (`triggerType`/`triggerStageId`/
  // `triggerRound`) — nunca contiene `if (competitionId === 'acb')`.
  function buildSeasonActivationPlan(seasonKey) {
    const acbRegularSeasonStageId = Engine().buildStageId(Catalog().COMPETITION_IDS.ACB, seasonKey, 'regular-season');
    const copaBindings = editionBindings(Catalog().COMPETITION_IDS.COPA_ACB);
    return [
      {
        id: `copa-acb-activation:${seasonKey}`,
        triggerStageId: acbRegularSeasonStageId,
        triggerType: 'round-completed',
        triggerRound: CUP_TRIGGER_ROUND,
        action: {
          competitionDefinitionId: Catalog().COMPETITION_IDS.COPA_ACB,
          seasonKey,
          formatBindingId: FORMAT_IDS.COPA_ACB_KNOCKOUT,
          // WORLD-CALENDAR-1: la regla transporta también el CALENDARIO y
          // el ruleset que la Edition nueva debe congelar — datos planos,
          // el engine nunca sabe de qué competición se trata.
          scheduleProfileId: copaBindings.scheduleProfileId,
          rulesetBundleId: copaBindings.rulesetBundleId,
          // Referencia PLANA al stage/ronda disparador, para que el
          // scheduler pueda resolver el ancla de la ventana de Copa sin
          // conocer ACB (sección 8 del prompt).
          triggerReference: {
            stageId: acbRegularSeasonStageId,
            stageKey: 'regular-season',
            round: CUP_TRIGGER_ROUND,
            competitionDefinitionId: Catalog().COMPETITION_IDS.ACB,
          },
          entrySource: {
            type: 'stage-standings-range', sourceStageKey: 'regular-season', fromRank: 1, toRank: 8,
          },
        },
      },
    ];
  }

  function install(world, context) {
    const ctx = context || {};
    if (!ctx.teamsByDivision || !ctx.teamsByDivision['1ª'] || !ctx.teamsByDivision['2ª']) {
      throw new Error('spain-2026.1: falta "teamsByDivision" ({ "1ª": [...], "2ª": [...] }) en el contexto de instalación.');
    }
    if (!ctx.seasonKey) {
      throw new Error('spain-2026.1: falta "seasonKey" en el contexto de instalación.');
    }

    registerAreas(world);
    registerOrganizations(world);
    registerClubsAndTeams(world, ctx.teamsByDivision);
    registerCompetitionDefinitions(world);
    registerFormats();
    registerSchedules();
    registerPathways();

    // Ediciones/stage de Liga regular + Entries de la temporada de
    // arranque (ACB + Primera FEB) — declarativo, SIN construir ningún
    // runner todavía (eso lo hace `CompetitionEngine.initializeEdition()`,
    // llamado desde `game.js` una vez el engine existe, sección 13.1 del
    // prompt: paso 3 antes que el paso 4). Copa/playoff por el
    // título/playoff de ascenso se activan más tarde, cuando el engine
    // procesa el hecho real (jornada 17 / fin de liga regular) — nunca
    // fabricados aquí de antemano.
    bindCareerStartEditions(world, {
      seasonKey: ctx.seasonKey,
      teamsByDivision: ctx.teamsByDivision,
      startDate: ctx.seasonStartDate || null,
    });
  }

  const SPAIN_MANIFEST = {
    id: MANIFEST_ID,
    version: '2026.1.0',
    name: 'España — ACB y Primera FEB',
    status: 'active',
    dependencies: ['world-core-2026.1'],
    provides: {
      areas: [AREA_IDS.SPAIN, AREA_IDS.ANDORRA],
      organizations: [ORG_IDS.FEB, ORG_IDS.ACB],
      clubs: CLUB_CONTENT.map((entry) => entry.clubId),
      competitionDefinitions: [
        Catalog().COMPETITION_IDS.ACB,
        Catalog().COMPETITION_IDS.PRIMERA_FEB,
        Catalog().COMPETITION_IDS.COPA_ACB,
        Catalog().COMPETITION_IDS.SUPERCOPA_ACB,
      ],
      competitionSchedules: [SCHEDULE_IDS.ACB, SCHEDULE_IDS.PRIMERA_FEB, SCHEDULE_IDS.COPA_ACB],
      competitionPathways: [PATHWAY_IDS.DOMESTIC_CLUB],
    },
    dataSource: 'data/real/real-data-bundle.js',
    provenance: { status: 'verified', notes: 'No copia data/real/* — referencia las instancias ya construidas.' },
    install,
  };

  const exportsObj = {
    SPAIN_MANIFEST,
    SPAIN_AREA_IDS: AREA_IDS,
    SPAIN_ORG_IDS: ORG_IDS,
    SPAIN_CLUB_CONTENT: CLUB_CONTENT,
    // COMP-CORE-1 (DESIGN.md 10.13): API productiva que usa `game.js` para
    // el ciclo de vida de las competiciones españolas — ninguna de estas
    // funciones vive ya en `SpainLegacyCompetitionRuntime` (retirado de la
    // ruta productiva, sigue existiendo solo como shim de scripts
    // históricos, ver CLAUDE.md/DESIGN.md 10.8).
    SPAIN_FORMAT_IDS: FORMAT_IDS,
    SPAIN_CUP_TRIGGER_ROUND: CUP_TRIGGER_ROUND,
    // WORLD-CALENDAR-1 (DESIGN.md 10.14) — calendarios españoles como
    // contenido versionado de este paquete.
    SPAIN_SCHEDULE_IDS: SCHEDULE_IDS,
    SPAIN_TIME_ZONE_ID,
    SPAIN_SEASON_ANCHOR: SEASON_ANCHOR,
    registerSpainSchedules: registerSchedules,
    registerSpainFormats: registerFormats,
    bindCareerStartEditions,
    // PATHWAYS-1 (DESIGN.md 10.15): `bindNewSeasonEditions`/
    // `buildSeasonActivationPlan` quedan SIN call-sites productivos nuevos
    // (game.js migra a `CompetitionPathwayService.applyTransitionGroup()`/
    // la regla "acb-copa-qualification") — se conservan exportadas
    // exclusivamente para `scripts/test-world-calendar1.js`/
    // `scripts/smoke-world-calendar1.js` (fixtures históricos ya
    // existentes), auditado en `scripts/test-pathways1.js`.
    bindNewSeasonEditions,
    buildSeasonActivationPlan,
    // PATHWAYS-1: pathway doméstico de clubes + wiring que consume game.js.
    SPAIN_PATHWAY_IDS: PATHWAY_IDS,
    SPAIN_DOMESTIC_TRANSITION_GROUP_ID: DOMESTIC_TRANSITION_GROUP_ID,
    registerSpainPathways: registerPathways,
    resolveSpainEditionBindings: editionBindings,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
