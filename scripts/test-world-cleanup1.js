// scripts/test-world-cleanup1.js
// WORLD-CLEANUP-1 (DESIGN.md 10.21) — batería DIRIGIDA y deliberadamente
// MÍNIMA (sección 13 del prompt): máximo 10 comprobaciones agrupadas, puras
// y rápidas. No arranca ninguna carrera, no simula partidos, no recorre
// temporadas y no abre navegador. Convención del proyecto: identificadores
// en inglés, comentarios en español.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Team } = require('../src/entities/Team.js');
const {
  CompetitionDefinition, CompetitionStage, CompetitionStageTemplate, CompetitionFormatDefinition,
} = require('../src/entities/Competition.js');
const { GeographicArea } = require('../src/entities/Geography.js');
const { Organization } = require('../src/entities/Organization.js');
const { Club } = require('../src/entities/Club.js');
const { Squad } = require('../src/entities/Squad.js');
const { GameWorld } = require('../src/entities/World.js');
const FormatCatalog = require('../src/core/CompetitionFormatCatalog.js');
const {
  CompetitionEngine, registerEditionWithInitialEntries, buildStageId, describeCompetitionContext,
} = require('../src/core/CompetitionEngine.js');
const CompetitionParticipationService = require('../src/core/CompetitionParticipationService.js');
const PathwayCatalog = require('../src/core/CompetitionPathwayCatalog.js');
const CareerSetupService = require('../src/core/CareerSetupService.js');
const PlayerCareer = require('../src/core/PlayerCareer.js');
const { Player } = require('../src/entities/Player.js');
const { generateFictionalPlayers } = require('../src/utils/playerGenerator.js');
const { generateFictionalTeams } = require('../src/utils/teamGenerator.js');
const { CONFIG_BASE } = require('../src/core/MatchConfig.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

// =========================================================================
// 1. Símbolos legacy ausentes de la ruta productiva (src/ y data/world/) —
//    auditoría estática, nunca ejecuta el código auditado.
// =========================================================================
check('cero símbolos legacy de división/UI en src/ y data/world/', () => {
  const roots = ['src', 'data/world'];
  const files = [];
  (function walk(dir) {
    fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true }).forEach((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.js')) files.push(rel);
    });
  }(roots[0]));
  (function walk(dir) {
    fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true }).forEach((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.js')) files.push(rel);
    });
  }(roots[1]));

  const FORBIDDEN = [
    /legacyDivision/,
    /\bDIVISIONS\b/,
    /validateDivision/,
    /competitionIdFromLegacyDivision/,
    /UI_COMPETITION_KEY_BY_STAGE_KEY/,
    /competitionKeyForStageKey/,
    /BRACKET_PHASE_IDS/,
    /relatedCompetition:\s*'(league|cup|playoff|promotion)'/,
  ];
  const offenders = [];
  files.forEach((rel) => {
    const content = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    FORBIDDEN.forEach((re) => {
      if (re.test(content)) offenders.push(`${rel}: ${re}`);
    });
  });
  assert.deepStrictEqual(offenders, []);

  // `.division` con semántica de competición: cero accesos de PROPIEDAD
  // reales (comentarios/mensajes de error mencionando "team.division" como
  // ejemplo negativo se toleran — se filtran por no llevar `.division` tras
  // un identificador de variable seguido de operador/uso real).
  const divisionAccessRe = /\bteam\.division\s*[=!<>[]|\.division\b(?!-toggle)/;
  const divisionOffenders = [];
  files.forEach((rel) => {
    if (rel.includes('game.css')) return;
    const content = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    content.split('\n').forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (!/\.division\b/.test(line)) return;
      // Permitido: mención dentro de un literal de string (mensaje de error
      // documentando la invariante), nunca acceso real de propiedad.
      if (/['"`][^'"`]*\.division[^'"`]*['"`]/.test(line)) return;
      divisionOffenders.push(`${rel}:${idx + 1}: ${trimmed}`);
    });
  });
  assert.deepStrictEqual(divisionOffenders, []);
});

// =========================================================================
// 2. Team sin división y participación múltiple por Entries.
// =========================================================================
check('Team no tiene division/legacyDivision; un Team participa en dos competiciones a la vez por Entries', () => {
  const world = new GameWorld({ id: 'world:test-world-cleanup1', careerSeed: 'cleanup1-seed' });
  world.registries.registerArea(new GeographicArea({
    id: 'area-world-c1', type: 'world', parentAreaId: null, name: 'Mundo',
  }));
  world.registries.registerArea(new GeographicArea({
    id: 'area-country-c1', type: 'country', parentAreaId: 'area-world-c1', name: 'Fixtureland', isoCode: 'XX',
  }));
  world.registries.registerOrganization(new Organization({
    id: 'org-c1', name: 'Fixtureland Federation', type: 'national-federation',
    headquartersAreaId: 'area-country-c1', scopeAreaId: 'area-country-c1',
  }));
  const league = new CompetitionDefinition({
    id: 'fixture-c1-league', name: '[TEST] Fixture League', scopeLevel: 'national', scopeAreaId: 'area-country-c1',
    organizerId: 'org-c1', participantType: 'club-team', kind: 'league', implementationStatus: 'active-runtime', bindings: {},
  });
  const cup = new CompetitionDefinition({
    id: 'fixture-c1-cup', name: '[TEST] Fixture Cup', scopeLevel: 'national', scopeAreaId: 'area-country-c1',
    organizerId: 'org-c1', participantType: 'club-team', kind: 'cup', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(league);
  world.registries.registerCompetitionDefinition(cup);

  const [team] = generateFictionalTeams(1, { seed: 'c1-team' });
  assert.strictEqual(team.division, undefined, 'Team no debe exponer "division"');
  assert.strictEqual(team.legacyDivision, undefined, 'Team no debe exponer "legacyDivision"');
  assert.strictEqual(Team.DIVISIONS, undefined, 'Team no debe exportar "DIVISIONS"');

  const club = new Club({
    id: 'club-c1', name: team.name, homeAreaId: 'area-country-c1', employerJurisdictionAreaId: 'area-country-c1',
    primaryTeamId: team.id, dataSource: 'test-fixture',
  });
  world.registries.registerClub(club);
  team.clubId = club.id;
  team.club = club;
  world.registries.registerTeam(team);
  world.registries.registerSquad(new Squad({ id: `squad-${team.id}`, teamId: team.id, players: team.roster, dataSource: 'test-fixture' }));

  const engine = new CompetitionEngine({ world });
  if (!FormatCatalog.hasFormat('test-fixture:format:cleanup1-solo-league')) {
    FormatCatalog.registerFormat({
      id: 'test-fixture:format:cleanup1-solo-league',
      version: '1.0.0',
      status: 'active',
      participantType: 'club-team',
      stageTemplates: [{
        key: 'regular-season', name: 'Regular', stageType: 'round-robin', runnerType: 'round-robin', sequence: 1,
        activation: { type: 'edition-start' }, entrySource: { type: 'initial-participants' },
        runnerConfig: { legs: 1, pointsWin: 2, pointsLoss: 0, requireExactParticipantCount: 1 },
        completesEdition: true, rulesPhaseId: 'league',
      }],
    });
  }
  registerEditionWithInitialEntries(world, {
    competitionDefinitionId: league.id, seasonKey: '2099-01', formatBindingId: 'test-fixture:format:cleanup1-solo-league',
    participants: [{ id: team.id }], detailLevel: 'playable',
  });
  registerEditionWithInitialEntries(world, {
    competitionDefinitionId: cup.id, seasonKey: '2099-01', formatBindingId: 'test-fixture:format:cleanup1-solo-league',
    participants: [{ id: team.id }], detailLevel: 'playable',
  });
  const competitions = CompetitionParticipationService.activeCompetitionsForParticipant(
    world.registries, team.id, { seasonKey: '2099-01' },
  );
  assert.strictEqual(competitions.length, 2, 'un Team debe poder tener Entry simultánea en liga y copa');
  void engine;
});

// =========================================================================
// 3. Exposición por tier sin ids españoles — incluye tier 3 ficticio.
// =========================================================================
check('recordMatchExposure/computeExposureFactor resuelven por tier, ninguna competición española implicada', () => {
  const { computeExposureFactor, recordMatchExposure, ensureDevelopmentState } = require('../src/core/PlayerDevelopment.js');
  const [p1] = generateFictionalPlayers(1, {});
  const [p2] = generateFictionalPlayers(1, {});
  const [p3] = generateFictionalPlayers(1, {});
  const [p4] = generateFictionalPlayers(1, {});
  const refDate = new Date('2026-10-01');
  [p1, p2, p3, p4].forEach((p) => ensureDevelopmentState(p, CONFIG_BASE, refDate));

  recordMatchExposure(p1, {
    date: refDate, minutes: 30, competitionDefinitionId: 'fixture-tier1-league', competitionTier: 1, stageId: 'fixture-stage-1',
  }, CONFIG_BASE);
  recordMatchExposure(p2, {
    date: refDate, minutes: 30, competitionDefinitionId: 'fixture-tier3-league', competitionTier: 3, stageId: 'fixture-stage-3',
  }, CONFIG_BASE);
  recordMatchExposure(p3, {
    date: refDate, minutes: 30, competitionDefinitionId: 'fixture-no-tier-league', competitionTier: null, stageId: 'fixture-stage-x',
  }, CONFIG_BASE);
  recordMatchExposure(p4, {
    date: refDate, minutes: 30, competitionDefinitionId: 'fixture-tier2-league', competitionTier: 2, stageId: 'fixture-stage-2',
  }, CONFIG_BASE);

  assert.strictEqual(p1.developmentState.matchExposures[0].weight, CONFIG_BASE.playerDevelopment.exposure.competitionTierWeight[1]);
  // Tier 3 (ficticio, sin id español) sin peso declarado -> política genérica.
  assert.strictEqual(p2.developmentState.matchExposures[0].weight, CONFIG_BASE.playerDevelopment.exposure.defaultCompetitionTierWeight);
  assert.strictEqual(p3.developmentState.matchExposures[0].weight, CONFIG_BASE.playerDevelopment.exposure.defaultCompetitionTierWeight);
  assert.strictEqual(p4.developmentState.matchExposures[0].weight, CONFIG_BASE.playerDevelopment.exposure.competitionTierWeight[2]);
  assert.ok(!JSON.stringify(CONFIG_BASE.playerDevelopment.exposure).includes('1ª'));

  const laterDate = new Date('2026-10-05');
  const factor1 = computeExposureFactor(p1, laterDate, CONFIG_BASE);
  const factor4 = computeExposureFactor(p4, laterDate, CONFIG_BASE);
  assert.ok(factor1 > factor4, 'tier 1 (peso 1.0) debe pesar más que tier 2 (peso 0.7), mismo balance observable que antes');
});

// =========================================================================
// 4. Un teamStint con dos competiciones sin doble contabilización.
// =========================================================================
check('PlayerCareer: un mismo Team en liga+copa produce un stint con dos competitionStats, sin doble contabilización', () => {
  const [player] = generateFictionalPlayers(1, {});
  PlayerCareer.ensureCareerHistory(player, CONFIG_BASE, new Date('2026-09-01'), { historyCompleteness: 'complete', seasonKey: '2026-27' });
  const teamRef = { id: 'fixture-team-1', name: 'Fixture FC', clubId: 'fixture-club-1', clubName: 'Fixture FC (club)' };
  const opponent = { id: 'fixture-opp-1', name: 'Rival FC' };
  const line = {
    playerId: player.id, minutesPlayed: 20, points: 10, reboundsOffensive: 1, reboundsDefensive: 2, assists: 3,
  };
  PlayerCareer.recordResolvedMatch(player, {
    date: new Date('2026-09-10'), team: teamRef, opponent, competitionDefinitionId: 'fixture-league', competitionName: 'Fixture League',
    boxScoreLine: line, isStarter: true, matchKey: 'match-1',
  }, CONFIG_BASE);
  PlayerCareer.recordResolvedMatch(player, {
    date: new Date('2026-09-17'), team: teamRef, opponent, competitionDefinitionId: 'fixture-cup', competitionName: 'Fixture Cup',
    boxScoreLine: line, isStarter: true, matchKey: 'match-2',
  }, CONFIG_BASE);

  const cs = player.careerHistory.currentSeason;
  assert.strictEqual(cs.teamStints.length, 1, 'debe seguir siendo UN SOLO stint de servicio');
  const stint = cs.teamStints[0];
  assert.strictEqual(stint.clubId, 'fixture-club-1');
  assert.strictEqual(stint.competitionStats.length, 2, 'dos acumulados de competición dentro del mismo stint');
  const totalPoints = BM_statValue(stint.stats, 'points');
  const compPointsSum = stint.competitionStats.reduce((sum, c) => sum + BM_statValue(c.stats, 'points'), 0);
  assert.strictEqual(totalPoints, 20, 'el total del stint es la suma real de los dos partidos (2 x 10 puntos)');
  assert.strictEqual(compPointsSum, totalPoints, 'el desglose por competición no duplica ni pierde el total del stint');

  function BM_statValue(arr, key) { return PlayerCareer.statValue(arr, key); }
});

// =========================================================================
// 5. Descriptor de Stage declarado por contenido con una stageKey ficticia.
// =========================================================================
check('describeCompetitionContext() resuelve rulesPhaseId/nombres desde el contenido, con una stageKey ficticia', () => {
  const world = new GameWorld({ id: 'world:test-world-cleanup1-stage', careerSeed: 'cleanup1-stage-seed' });
  world.registries.registerArea(new GeographicArea({ id: 'area-world-c5', type: 'world', parentAreaId: null, name: 'Mundo' }));
  world.registries.registerArea(new GeographicArea({
    id: 'area-country-c5', type: 'country', parentAreaId: 'area-world-c5', name: 'Fixtureland', isoCode: 'XX',
  }));
  world.registries.registerOrganization(new Organization({
    id: 'org-c5', name: 'Fixtureland Federation', type: 'national-federation',
    headquartersAreaId: 'area-country-c5', scopeAreaId: 'area-country-c5',
  }));
  const definition = new CompetitionDefinition({
    id: 'fixture-c5-league', name: '[TEST] Fixture League C5', scopeLevel: 'national', scopeAreaId: 'area-country-c5',
    organizerId: 'org-c5', participantType: 'club-team', kind: 'league', implementationStatus: 'active-runtime', bindings: {},
  });
  world.registries.registerCompetitionDefinition(definition);
  const [team] = generateFictionalTeams(1, { seed: 'c5-team' });
  const club = new Club({
    id: 'club-c5', name: team.name, homeAreaId: 'area-country-c5', employerJurisdictionAreaId: 'area-country-c5',
    primaryTeamId: team.id, dataSource: 'test-fixture',
  });
  world.registries.registerClub(club);
  team.clubId = club.id;
  team.club = club;
  world.registries.registerTeam(team);
  world.registries.registerSquad(new Squad({ id: `squad-${team.id}`, teamId: team.id, players: team.roster, dataSource: 'test-fixture' }));

  const FIXTURE_STAGE_KEY = 'fixture-nonstandard-clasificatoria';
  const formatId = 'test-fixture:format:cleanup1-stage-descriptor';
  if (!FormatCatalog.hasFormat(formatId)) {
    FormatCatalog.registerFormat({
      id: formatId,
      version: '1.0.0',
      status: 'active',
      participantType: 'club-team',
      stageTemplates: [{
        key: FIXTURE_STAGE_KEY,
        name: 'Fase clasificatoria ficticia',
        stageType: 'round-robin',
        runnerType: 'round-robin',
        sequence: 1,
        activation: { type: 'edition-start' },
        entrySource: { type: 'initial-participants' },
        runnerConfig: { legs: 1, pointsWin: 2, pointsLoss: 0, requireExactParticipantCount: 1 },
        completesEdition: true,
        rulesPhaseId: 'fixture-custom-phase',
      }],
    });
  }
  const { edition } = registerEditionWithInitialEntries(world, {
    competitionDefinitionId: definition.id, seasonKey: '2099-05', formatBindingId: formatId,
    participants: [{ id: team.id }], detailLevel: 'playable',
  });
  const stageId = buildStageId(definition.id, '2099-05', FIXTURE_STAGE_KEY);
  const ctx = describeCompetitionContext(world.registries, stageId);
  assert.strictEqual(ctx.competitionDefinitionId, definition.id);
  assert.strictEqual(ctx.stageKey, FIXTURE_STAGE_KEY);
  assert.strictEqual(ctx.rulesPhaseId, 'fixture-custom-phase');
  assert.strictEqual(ctx.stageType, 'round-robin');
  void edition;
});

// =========================================================================
// 6. Recorrido de pathway de dos saltos y ciclo, sin mutación.
// =========================================================================
check('Career Setup: grafo de pathways de dos saltos y un ciclo, ignora catalog-only, sin mutar nada', () => {
  const PATHWAY_ID = 'test-fixture:pathway:cleanup1-two-hop-cycle';
  const manifest = {
    id: 'fixture-cleanup1-pack',
    version: '1.0.0',
    dependencies: [],
    install() {},
    hooks: {
      registerPathways() {
        if (PathwayCatalog.hasPathwayDefinition(PATHWAY_ID)) return;
        const ref = (competitionDefinitionId) => ({ competitionDefinitionId, stageKey: 'regular-season' });
        PathwayCatalog.registerPathwayDefinition({
          id: PATHWAY_ID,
          version: '1.0.0',
          status: 'active',
          participantType: 'club-team',
          transitionGroups: {
            'fixture-cleanup1-group': {
              expectedCardinalityByCompetitionDefinitionId: { 'fixture-cleanup1-a': 1, 'fixture-cleanup1-b': 1 },
              exclusivePyramid: false,
            },
          },
          rules: [
            {
              id: 'fixture-a-to-mid',
              kind: 'competition-qualification',
              trigger: { type: 'stage-completed', stageRef: ref('fixture-cleanup1-a') },
              selector: { type: 'standings-range', stageRef: ref('fixture-cleanup1-a'), fromRank: 1, toRank: 1 },
              destination: { type: 'competition-edition', competitionDefinitionId: 'fixture-cleanup1-mid', seasonRelation: 'same-season' },
            },
            {
              id: 'fixture-mid-to-b',
              kind: 'competition-qualification',
              trigger: { type: 'stage-completed', stageRef: ref('fixture-cleanup1-mid') },
              selector: { type: 'standings-range', stageRef: ref('fixture-cleanup1-mid'), fromRank: 1, toRank: 1 },
              destination: { type: 'competition-edition', competitionDefinitionId: 'fixture-cleanup1-b', seasonRelation: 'same-season' },
            },
            // Ciclo: B vuelve a A — el recorrido no debe entrar en bucle infinito.
            {
              id: 'fixture-b-to-a-cycle',
              kind: 'next-season-membership',
              transitionGroupId: 'fixture-cleanup1-group',
              trigger: { type: 'season-transition' },
              selector: { type: 'remaining-participants', sourceCompetitionDefinitionId: 'fixture-cleanup1-b' },
              destination: { type: 'next-season-competition', competitionDefinitionId: 'fixture-cleanup1-a' },
            },
            // catalog-only: alcanzable, pero nunca puede programar al Team —
            // debe ser IGNORADA, nunca bloquear "Comenzar carrera".
            {
              id: 'fixture-b-to-catalog-only',
              kind: 'competition-qualification',
              trigger: { type: 'stage-completed', stageRef: ref('fixture-cleanup1-b') },
              selector: { type: 'standings-range', stageRef: ref('fixture-cleanup1-b'), fromRank: 1, toRank: 1 },
              destination: { type: 'competition-edition', competitionDefinitionId: 'fixture-cleanup1-catalog-only', seasonRelation: 'same-season' },
            },
          ],
        });
      },
    },
  };
  const manifestsById = new Map([[manifest.id, manifest]]);
  const catalog = {
    packs: [{ id: manifest.id, name: 'Fixture pack', isRootRequired: false, hasCareerSetupContent: true, dependencies: [] }],
    seasons: [{ seasonKey: '2099-06', seasonStartYear: 2099, isDefault: true }],
    timeZones: [{ timeZoneId: 'UTC', isDefault: true }],
    competitions: [
      { competitionDefinitionId: 'fixture-cleanup1-a', name: 'Fixture A', implementationStatus: 'active-runtime', recommendedDetailLevel: 'playable', allowedDetailLevels: ['playable', 'standard'] },
      { competitionDefinitionId: 'fixture-cleanup1-mid', name: 'Fixture Mid', implementationStatus: 'active-runtime', recommendedDetailLevel: 'playable', allowedDetailLevels: ['playable', 'standard'] },
      { competitionDefinitionId: 'fixture-cleanup1-b', name: 'Fixture B', implementationStatus: 'active-runtime', recommendedDetailLevel: 'standard', allowedDetailLevels: ['playable', 'standard'] },
      { competitionDefinitionId: 'fixture-cleanup1-catalog-only', name: 'Fixture Catalog-Only', implementationStatus: 'catalog-only', recommendedDetailLevel: null, allowedDetailLevels: [] },
    ],
    clubs: [{ clubId: 'fixture-club-cleanup1', teamId: 'fixture-team-cleanup1', name: 'Fixture Club', city: 'Fixture City', rosterSize: 15, dataCoverage: 'complete', initialCompetitionDefinitionId: 'fixture-cleanup1-a' }],
  };
  const draft = {
    selectedContentPackIds: [manifest.id],
    seasonKey: '2099-06',
    seasonStartYear: 2099,
    timeZoneId: 'UTC',
    defaultDetailLevel: 'abstract',
    competitionSelections: {
      'fixture-cleanup1-a': 'playable',
      'fixture-cleanup1-mid': 'playable',
      'fixture-cleanup1-b': 'standard', // NO permite parada de usuario -> debe bloquear
    },
    controlledClubId: 'fixture-club-cleanup1',
    controlledTeamId: 'fixture-team-cleanup1',
    careerSeed: 'fixture-seed-cleanup1',
    createdAtGameDate: '2099-08-01',
  };
  const beforeSnapshot = JSON.stringify(catalog);
  const result = CareerSetupService.validateDraft(catalog, manifestsById, draft);
  assert.strictEqual(JSON.stringify(catalog), beforeSnapshot, 'validar no debe mutar el catálogo');
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.code === 'CONTROLLED_CLUB_WITHOUT_USER_STOP');
  assert.ok(err, 'debe bloquear por la competición "B" alcanzable en dos saltos');
  assert.ok(err.message.includes('Fixture B'), `el mensaje debe nombrar "Fixture B": ${err.message}`);
  assert.ok(!err.message.includes('Fixture Catalog-Only'), 'una competición catalog-only nunca debe bloquear "Comenzar carrera"');

  // Ahora con "B" también en nivel jugable: el grafo completo (incluyendo el
  // ciclo B->A) debe validar limpio, sin bucle infinito.
  draft.competitionSelections['fixture-cleanup1-b'] = 'playable';
  const result2 = CareerSetupService.validateDraft(catalog, manifestsById, draft);
  assert.strictEqual(result2.valid, true, `debía validar limpio: ${JSON.stringify(result2.errors)}`);
});

// =========================================================================
// 7. Serialización JSON de las formas modificadas + auditoría estática de
//    determinismo (sección 12 del prompt) — agrupadas en una comprobación.
// =========================================================================
check('serialización JSON de Team/CompetitionStage/PlayerCareer + auditoría de determinismo en servicios administrativos', () => {
  const [team] = generateFictionalTeams(1, { seed: 'json-team' });
  const teamJson = team.toJSON();
  assert.ok(!('division' in teamJson), 'Team.toJSON() no debe incluir "division"');
  assert.ok(!('legacyDivision' in teamJson), 'Team.toJSON() no debe incluir "legacyDivision"');
  assert.ok(JSON.stringify(teamJson).length > 0);

  const stage = new CompetitionStage({
    id: 'stage:json-check', editionId: 'edition:json-check', stageType: 'round-robin', status: 'active',
    stageKey: 'fixture-json', rulesPhaseId: 'fixture-phase',
  });
  const stageJson = stage.toJSON();
  assert.strictEqual(stageJson.rulesPhaseId, 'fixture-phase');
  assert.ok(JSON.stringify(stageJson).length > 0);

  const [player] = generateFictionalPlayers(1, {});
  PlayerCareer.ensureCareerHistory(player, CONFIG_BASE, new Date('2026-09-01'), { historyCompleteness: 'complete', seasonKey: '2026-27' });
  PlayerCareer.recordResolvedMatch(player, {
    date: new Date('2026-09-10'),
    team: { id: 'fixture-team-json', name: 'Fixture JSON FC', clubId: 'fixture-club-json', clubName: 'Fixture JSON FC (club)' },
    opponent: { id: 'fixture-opp-json', name: 'Rival JSON FC' },
    competitionDefinitionId: 'fixture-league-json',
    competitionName: 'Fixture League JSON',
    boxScoreLine: { playerId: player.id, minutesPlayed: 10, points: 5 },
    isStarter: false,
    matchKey: 'match-json-1',
  }, CONFIG_BASE);
  const closed = PlayerCareer.closeSeason(player, {
    endDate: new Date('2027-06-01'), teamId: 'fixture-team-json', teamName: 'Fixture JSON FC',
    clubId: 'fixture-club-json', clubName: 'Fixture JSON FC (club)', nextSeasonKey: '2027-28',
  }, CONFIG_BASE);
  assert.ok(!('division' in closed.stints[0]), 'un stint cerrado no debe incluir "division"');
  assert.strictEqual(closed.stints[0].competitionStats[0].competitionDefinitionId, 'fixture-league-json');
  assert.ok(JSON.stringify(closed).length > 0, 'el registro de temporada cerrada debe ser JSON plano');

  // Auditoría estática de determinismo (sección 12 del prompt): ningún
  // servicio administrativo de contratos/mercado/ciclo/traspasos/cesiones
  // usa Date.now()/Math.random()/new Date() como reloj/RNG implícito.
  const ADMIN_SERVICE_FILES = [
    'src/core/ContractService.js', 'src/core/ContractSeeder.js',
    'src/core/RegistrationService.js', 'src/core/RegistrationSeeder.js',
    'src/core/MarketService.js', 'src/core/MarketClearinghouse.js',
    'src/core/TransferService.js', 'src/core/TransferExecutionService.js',
    'src/core/LoanService.js', 'src/core/LoanExecutionService.js',
    'src/core/AnnualCycleService.js', 'src/core/RosterLegalityService.js',
    'src/core/RenewalService.js', 'src/core/AcademyService.js',
    'src/core/RetirementService.js', 'src/core/CpuRosterPlanner.js',
  ];
  const NON_DETERMINISTIC = /Math\.random\(|Date\.now\(|new Date\(\)/;
  const offenders = [];
  ADMIN_SERVICE_FILES.forEach((rel) => {
    const content = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    content.split('\n').forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (NON_DETERMINISTIC.test(line)) offenders.push(`${rel}:${idx + 1}: ${trimmed}`);
    });
  });
  assert.deepStrictEqual(offenders, []);
});

console.log(`\n${passed} comprobaciones OK, ${failed} fallidas.`);
if (failed > 0) process.exit(1);
