// scripts/rebuild-real-positions-from-attributes.js
// Mini-EPIC POS (Bloque 8) — reconstruye el mapa de posiciones de los 414
// jugadores reales (data/real/teams/*.json) para el nuevo shape sin
// restricción de unicidad (Player.js, Bloque 1): añade `nominalPosition`
// explícito y deriva las 4 posiciones secundarias por SIMILITUD DE PERFIL
// DE ATRIBUTOS contra los mismos POSITION_PROFILES que usa el generador de
// jugadores ficticios (src/utils/playerGenerator.js) — decisión de producto
// (ver DESIGN.md 6, nota de posiciones secundarias de datos reales, y el
// prompt de esta sesión): NO se invierte tiempo en investigar fuentes
// externas (ACB/FEB/scouting) para reconstruir con rigor histórico estas
// posiciones secundarias; se derivan de los atributos que el jugador YA
// tiene en su ficha, con significado real (a diferencia de los valores
// planos de migrate-positions-to-map.js o el ruido determinista sin
// correlación de regenerate-real-positions.js, ambos conservados como
// artefactos históricos, no se borran ni se vuelven a ejecutar).
//
// nominalPosition = la posición que HOY tiene valor 20 (el único dato
// fiable de origen, no se toca). Para las 4 restantes:
//   score(pos) = Σ (jugador[atributo] - 10) × POSITION_PROFILES[pos][atributo]
// sumando sobre technical/physical/mental, buscando cada atributo en el
// grupo del jugador que corresponda. Los 4 scores se normalizan a un rango
// 1-17 (20 queda reservado para la nominal): resta el mínimo de los 4,
// divide por el rango, multiplica por 16, suma 1, redondea — si los 4
// scores son idénticos (rango 0), los 4 reciben el valor medio 9.
//
// Toca ÚNICAMENTE `positions`/`nominalPosition` de cada jugador en
// data/real/teams/*.json, y regenera data/real/real-data-bundle.js a
// partir de esos ficheros ya actualizados (mismo formato exacto que
// scripts/migrate-positions-to-map.js/regenerate-real-positions.js).
//
// Uso: node scripts/rebuild-real-positions-from-attributes.js

const fs = require('fs');
const path = require('path');

const { POSITIONS } = require('../src/entities/Player.js');
const { POSITION_PROFILES } = require('../src/utils/playerGenerator.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEAMS_DIR = path.join(REPO_ROOT, 'data/real/teams');
const INDEX_FILE = path.join(REPO_ROOT, 'data/real/index.json');
const BUNDLE_FILE = path.join(REPO_ROOT, 'data/real/real-data-bundle.js');

const PRIMARY_LEVEL = 20;
const SECONDARY_MIN = 1;
const SECONDARY_MAX = 17;
const SECONDARY_RANGE_WIDTH = SECONDARY_MAX - SECONDARY_MIN; // 16
const SECONDARY_MIDPOINT = (SECONDARY_MIN + SECONDARY_MAX) / 2; // 9, para el caso de rango 0

const ATTRIBUTE_GROUPS = ['technical', 'physical', 'mental'];
const NEUTRAL_ATTRIBUTE_VALUE = 10; // referencia neutra de POSITION_PROFILES (playerGenerator ATTRIBUTE_BASE)

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Score de similitud del jugador contra el perfil de UNA posición —
// mismos deltas que usa playerGenerator.blendProfiles, aquí en sentido
// inverso (dato ya conocido del jugador -> cuánto se parece al perfil).
function positionSimilarityScore(player, position) {
  const profile = POSITION_PROFILES[position];
  let score = 0;
  ATTRIBUTE_GROUPS.forEach((group) => {
    const groupProfile = profile[group] || {};
    const playerGroup = player[group] || {};
    Object.entries(groupProfile).forEach(([attr, weight]) => {
      // Todos los atributos están siempre presentes en un jugador real ya
      // migrado (CLAUDE.md/DESIGN.md 6.1) — el fallback a neutro (10) es
      // solo una salvaguarda, no debería darse nunca en la práctica.
      const value = playerGroup[attr] !== undefined ? playerGroup[attr] : NEUTRAL_ATTRIBUTE_VALUE;
      score += (value - NEUTRAL_ATTRIBUTE_VALUE) * weight;
    });
  });
  return score;
}

// Deriva el mapa completo de 5 posiciones para un jugador: nominalPosition
// (ya fiable, en 20) + las 4 restantes normalizadas 1-17 por similitud.
function derivePositions(player, nominalPosition) {
  const otherPositions = POSITIONS.filter((pos) => pos !== nominalPosition);
  const rawScores = otherPositions.map((pos) => positionSimilarityScore(player, pos));
  const min = Math.min(...rawScores);
  const max = Math.max(...rawScores);
  const range = max - min;

  const positions = { [nominalPosition]: PRIMARY_LEVEL };
  otherPositions.forEach((pos, index) => {
    if (range === 0) {
      positions[pos] = SECONDARY_MIDPOINT;
      return;
    }
    const normalized = ((rawScores[index] - min) / range) * SECONDARY_RANGE_WIDTH + SECONDARY_MIN;
    positions[pos] = clamp(Math.round(normalized), SECONDARY_MIN, SECONDARY_MAX);
  });
  return positions;
}

// Todos los campos de un jugador SALVO `positions`/`nominalPosition`, para
// el diff campo a campo (mismo rigor que scripts anteriores de esta
// carpeta).
function withoutPositionFields(player) {
  const { positions, nominalPosition, ...rest } = player;
  return rest;
}

// --- Selección de ejemplos para revisión manual (al menos 10 jugadores de
// perfiles claramente distintos, de al menos 3 equipos distintos) ---
function pickReviewExamples(allPlayersWithTeam) {
  const examples = [];
  const usedTeamFiles = new Set();
  // Primera pasada: un jugador por cada una de las 5 posiciones nominales,
  // priorizando SIEMPRE un equipo todavía no usado (diversidad de equipo).
  POSITIONS.forEach((position) => {
    const candidate = allPlayersWithTeam.find(
      (entry) => entry.player.nominalPosition === position && !usedTeamFiles.has(entry.teamFile),
    ) || allPlayersWithTeam.find((entry) => entry.player.nominalPosition === position);
    if (candidate) {
      examples.push(candidate);
      usedTeamFiles.add(candidate.teamFile);
    }
  });
  // Segunda pasada: completa hasta 10 repitiendo posiciones pero SIEMPRE de
  // un equipo distinto de los ya usados, para variar perfiles dentro de la
  // misma posición nominal sin repetir equipo.
  for (const entry of allPlayersWithTeam) {
    if (examples.length >= 10) break;
    if (usedTeamFiles.has(entry.teamFile)) continue;
    const alreadyPicked = examples.some((e) => e.player.id === entry.player.id);
    if (alreadyPicked) continue;
    examples.push(entry);
    usedTeamFiles.add(entry.teamFile);
  }
  return examples.slice(0, 10);
}

function formatPositions(positions) {
  return POSITIONS.map((pos) => `${pos}=${positions[pos]}`).join(', ');
}

function main() {
  const files = fs.readdirSync(TEAMS_DIR).filter((f) => f.endsWith('.json'));
  let playersProcessed = 0;
  const primaryCountErrors = [];
  const fieldDiffErrors = [];
  const allPlayersWithTeam = [];

  files.forEach((file) => {
    const filePath = path.join(TEAMS_DIR, file);
    const team = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    team.roster.forEach((player) => {
      const before = JSON.parse(JSON.stringify(player));

      const nominalPosition = POSITIONS.find((pos) => player.positions[pos] === PRIMARY_LEVEL);
      if (!nominalPosition) {
        throw new Error(`${player.id} (${file}): no tiene ninguna posición en ${PRIMARY_LEVEL} — dato de origen inconsistente`);
      }

      player.positions = derivePositions(player, nominalPosition);
      player.nominalPosition = nominalPosition;
      playersProcessed += 1;

      // --- Verificación 1: exactamente una posición en 20 ---
      const primaryCount = Object.values(player.positions).filter((v) => v === PRIMARY_LEVEL).length;
      if (primaryCount !== 1) {
        primaryCountErrors.push(`${player.id} (${file}): ${primaryCount} posiciones en ${PRIMARY_LEVEL}`);
      }

      // --- Verificación 2: ningún otro campo cambió ---
      const beforeRest = JSON.stringify(withoutPositionFields(before));
      const afterRest = JSON.stringify(withoutPositionFields(player));
      if (beforeRest !== afterRest) {
        fieldDiffErrors.push(`${player.id} (${file}): un campo distinto de "positions"/"nominalPosition" cambió`);
      }

      allPlayersWithTeam.push({ player, teamFile: file, teamName: team.name });
    });
    fs.writeFileSync(filePath, JSON.stringify(team, null, 2) + '\n');
  });

  console.log(`Reconstruidas las posiciones de ${playersProcessed} jugadores en ${files.length} ficheros de data/real/teams/.`);

  if (primaryCountErrors.length > 0) {
    console.log(`\n⚠️  ${primaryCountErrors.length} jugador(es) sin exactamente una posición en ${PRIMARY_LEVEL}:`);
    primaryCountErrors.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 1;
  } else {
    console.log(`OK: los ${playersProcessed} jugadores mantienen exactamente una posición en ${PRIMARY_LEVEL}.`);
  }

  if (fieldDiffErrors.length > 0) {
    console.log(`\n⚠️  ${fieldDiffErrors.length} jugador(es) con un campo distinto de "positions"/"nominalPosition" modificado:`);
    fieldDiffErrors.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 1;
  } else {
    console.log(`OK: ningún campo distinto de "positions"/"nominalPosition" cambió en ninguno de los ${playersProcessed} jugadores.`);
  }

  // --- Ejemplos para revisión manual (al menos 10, de al menos 3 equipos) ---
  const examples = pickReviewExamples(allPlayersWithTeam);
  const distinctTeams = new Set(examples.map((e) => e.teamFile));
  console.log(`\n=== Ejemplos de revisión manual (${examples.length} jugadores, ${distinctTeams.size} equipos distintos) ===`);
  examples.forEach(({ player, teamName }) => {
    const t = player.technical;
    const p = player.physical;
    console.log(`\n${player.firstName} ${player.lastName} (${teamName}) — nominal: ${player.nominalPosition}`);
    console.log(`  Posiciones: ${formatPositions(player.positions)}`);
    console.log(
      `  Atributos determinantes: ballHandling=${t.ballHandling} passing=${t.passing} `
      + `outsideShot=${t.outsideShot} interiorDefense=${t.interiorDefense} `
      + `offensiveRebound=${t.offensiveRebound} strength=${p.strength}`,
    );
  });

  // --- Regenerar el bundle cargable con <script> (mismo formato exacto
  // que scripts/migrate-positions-to-map.js/import-real-data.js). ---
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const teamsById = {};
  index.forEach((entry) => {
    const teamPath = path.join(TEAMS_DIR, `${entry.id}.json`);
    teamsById[entry.id] = JSON.parse(fs.readFileSync(teamPath, 'utf8'));
  });

  const bundleSource = [
    '// data/real/real-data-bundle.js',
    '// GENERADO por scripts/import-real-data.js — no editar a mano, volver a',
    '// ejecutar el script si hace falta actualizar estos datos.',
    '// Expone en window.BasketManager los mismos datos que data/real/index.json',
    '// y data/real/teams/*.json, pero cargables con un <script> normal (index.html',
    '// abre vía file:// y fetch() de un JSON local falla ahí por CORS).',
    '(function (global) {',
    `  const REAL_DATA_INDEX = ${JSON.stringify(index, null, 2)};`,
    `  const REAL_DATA_TEAMS = ${JSON.stringify(teamsById, null, 2)};`,
    '  const exportsObj = { REAL_DATA_INDEX, REAL_DATA_TEAMS };',
    '  if (typeof module !== \'undefined\' && module.exports) {',
    '    module.exports = exportsObj;',
    '  } else {',
    '    global.BasketManager = global.BasketManager || {};',
    '    Object.assign(global.BasketManager, exportsObj);',
    '  }',
    '})(typeof window !== \'undefined\' ? window : globalThis);',
    '',
  ].join('\n');
  fs.writeFileSync(BUNDLE_FILE, bundleSource);
  console.log(`\nRegenerado ${path.relative(REPO_ROOT, BUNDLE_FILE)}.`);

  if (process.exitCode === 1) {
    console.log('\n⚠️  Terminado con errores de verificación — revisar antes de continuar.');
  } else {
    console.log('\nOK: reconstrucción de posiciones reales completa y verificada.');
  }
}

main();
