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
  const CompetitionEngineModule = dep('../../src/core/CompetitionEngine.js');
  const WorldCoreManifestModule = dep('./world-core-2026.1.js');

  function Geo() { return GeographyModule; }
  function Org() { return OrganizationModule; }
  function ClubEntity() { return ClubModule; }
  function SquadEntity() { return SquadModule; }
  function Catalog() { return CompetitionCatalogModule; }
  function FormatCatalog() { return CompetitionFormatCatalogModule; }
  function Engine() { return CompetitionEngineModule; }
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
          activation: { type: 'stage-completed', sourceStageKey: 'regular-season' },
          entrySource: {
            type: 'stage-standings-range', sourceStageKey: 'regular-season', fromRank: 1, toRank: 8, sourceScope: 'same-edition',
          },
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
          activation: { type: 'stage-completed', sourceStageKey: 'regular-season' },
          entrySource: {
            type: 'stage-standings-range', sourceStageKey: 'regular-season', fromRank: 2, toRank: 9, sourceScope: 'same-edition',
          },
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
          activation: { type: 'stage-completed', sourceStageKey: 'promotion-quarterfinals' },
          entrySource: {
            type: 'stage-bracket-final-round-winners', sourceStageKey: 'promotion-quarterfinals', reseedStrategy: 'best-vs-worst-by-seed',
          },
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

  // Bindings congelados por edición (sección 11.2 del prompt): ids de
  // formato/calendario/ruleset EXPLÍCITOS, nunca el objeto de reglas
  // incrustado. `scheduleProfileId` usa el MISMO id ya declarado en
  // `CompetitionCatalog.js` (`bindings.scheduleProfileId`) — `Calendar`
  // ya sabe resolverlo (alias añadido a `MatchConfig.js`, sección 11.2).
  function editionBindings(competitionId) {
    const definition = Catalog().getCompetitionDefinition(competitionId);
    if (competitionId === Catalog().COMPETITION_IDS.ACB) {
      return { formatBindingId: FORMAT_IDS.ACB_LIGA_PLAYOFF, scheduleProfileId: definition.bindings.scheduleProfileId, rulesetBundleId: 'acb-domestic-2025-26-v1' };
    }
    if (competitionId === Catalog().COMPETITION_IDS.PRIMERA_FEB) {
      return { formatBindingId: FORMAT_IDS.PRIMERA_FEB_LIGA_ASCENSO, scheduleProfileId: definition.bindings.scheduleProfileId, rulesetBundleId: 'primera-feb-domestic-2026-27-v1' };
    }
    if (competitionId === Catalog().COMPETITION_IDS.COPA_ACB) {
      return { formatBindingId: FORMAT_IDS.COPA_ACB_KNOCKOUT, scheduleProfileId: null, rulesetBundleId: 'copa-acb-domestic-2025-26-v1' };
    }
    throw new Error(`spain-2026.1: sin bindings declarados para la competición "${competitionId}".`);
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
    registerSpainFormats: registerFormats,
    bindCareerStartEditions,
    bindNewSeasonEditions,
    buildSeasonActivationPlan,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
