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
  const SpainLegacyRuntimeModule = dep('../../src/core/SpainLegacyCompetitionRuntime.js');
  const WorldCoreManifestModule = dep('./world-core-2026.1.js');

  function Geo() { return GeographyModule; }
  function Org() { return OrganizationModule; }
  function ClubEntity() { return ClubModule; }
  function SquadEntity() { return SquadModule; }
  function Catalog() { return CompetitionCatalogModule; }
  function Runtime() { return SpainLegacyRuntimeModule.SpainLegacyCompetitionRuntime; }
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

    // Ediciones/stages/entries de la temporada de arranque (Liga regular de
    // ACB + Primera FEB). Copa/playoff por el título/playoff de ascenso se
    // enlazan más tarde, cuando el runtime real los crea de verdad (jornada
    // 17 / fin de liga regular) — ver `SpainLegacyCompetitionRuntime.bindCup/
    // bindTitlePlayoff/bindPromotionPlayoff`, llamados desde `game.js`.
    Runtime().bindCareerStart(world, {
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
    SPAIN_MANIFEST, SPAIN_AREA_IDS: AREA_IDS, SPAIN_ORG_IDS: ORG_IDS, SPAIN_CLUB_CONTENT: CLUB_CONTENT,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
