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

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const GeographyModule = dep('../../src/entities/Geography.js');
  const OrganizationModule = dep('../../src/entities/Organization.js');
  const ClubModule = dep('../../src/entities/Club.js');
  const CompetitionCatalogModule = dep('../../src/core/CompetitionCatalog.js');
  const SpainLegacyRuntimeModule = dep('../../src/core/SpainLegacyCompetitionRuntime.js');
  const WorldCoreManifestModule = dep('./world-core-2026.1.js');
  const ClubEmploymentModule = dep('../../src/core/ClubEmploymentContextCatalog.js');

  function Geo() { return GeographyModule; }
  function Org() { return OrganizationModule; }
  function ClubEntity() { return ClubModule; }
  function Catalog() { return CompetitionCatalogModule; }
  function Runtime() { return SpainLegacyRuntimeModule.SpainLegacyCompetitionRuntime; }
  function EmploymentCatalog() { return ClubEmploymentModule.ClubEmploymentContextCatalog; }
  function EuropeAreaId() {
    return (WorldCoreManifestModule.WORLD_CORE_AREA_IDS || { EUROPE: 'area-continent-europe' }).EUROPE;
  }

  const MANIFEST_ID = 'spain-2026.1';

  const AREA_IDS = { SPAIN: 'area-country-es', ANDORRA: 'area-country-ad' };
  const ORG_IDS = { FEB: 'org-feb', ACB: 'org-acb' };

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

  // Registra Club + Team para cada equipo YA CONSTRUIDO por game.js.
  // `club.id === team.id` es la decisión de COMPATIBILIDAD documentada en
  // `src/entities/Club.js` — no una invariante universal.
  function registerClubsAndTeams(world, teamsByDivision) {
    const allTeams = [...teamsByDivision['1ª'], ...teamsByDivision['2ª']];
    allTeams.forEach((team) => {
      const employment = EmploymentCatalog().requireClubEmploymentContext(team.id);
      const homeAreaId = employment.employerJurisdictionId === 'AD' ? AREA_IDS.ANDORRA : AREA_IDS.SPAIN;
      const club = new (ClubEntity().Club)({
        id: team.id,
        name: team.name,
        shortName: team.name,
        homeAreaId,
        employerJurisdictionAreaId: homeAreaId,
        federationMembershipOrganizationIds: [ORG_IDS.FEB],
        primaryTeamId: team.id,
        status: 'active',
        dataSource: MANIFEST_ID,
        provenance: { dataSource: MANIFEST_ID, status: 'verified' },
      });
      world.registries.registerClub(club);

      // Campos puente en la instancia REAL de Team, asignados APARTE tras
      // construirla (mismo patrón que `player.dataSource`, ver Team.js) —
      // nunca se reconstruye el equipo.
      team.clubId = club.id;
      team.teamType = 'senior-men-first-team';
      team.homeAreaId = club.homeAreaId;
      team.legacyDivision = team.division;
      world.registries.registerTeam(team);
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
      clubs: EmploymentCatalog().listClubEmploymentContexts().map((c) => c.clubId),
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

  const exportsObj = { SPAIN_MANIFEST, SPAIN_AREA_IDS: AREA_IDS, SPAIN_ORG_IDS: ORG_IDS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
