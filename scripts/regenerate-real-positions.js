// scripts/regenerate-real-positions.js
// Sesión de consolidación: regenera el mapa de posiciones SECUNDARIAS de
// los 414 jugadores reales (data/real/teams/*.json) con variación real por
// jugador, sustituyendo los valores planos que dejó
// scripts/migrate-positions-to-map.js (12 para "secundaria conocida", 2
// para "no habilitada", el mismo par de números para TODOS los jugadores
// del planeta) — confirmado por auditoría: solo 3 patrones de posición
// distintos en toda la base de datos (56.8% con 20/12/2/2/2, 42.8% con
// 20/2/2/2/2, 0.5% con 20/12/12/2/2), una de las dos causas de que
// `roleFit` sature en 5 estrellas (la otra, la escala de conversión
// puntuación→estrellas, se corrige por separado en
// src/core/Tactics.js/MatchConfig.js esta misma sesión).
//
// Adapta la lógica de src/utils/playerGenerator.js::generatePositionMap()
// (base + dispersión de ruido aleatorio) en vez de inventar una fórmula
// nueva — pero ANCLADA a si la posición es HOY 12 o 2 (no a la distancia
// geométrica al índice del jugador, que generatePositionMap usa porque
// genera jugadores desde cero): esto preserva la información real que la
// migración anterior sí capturó sobre qué posiciones jugaba cada jugador,
// en vez de destruirla y volver a inventarla desde cero.
//
// Toca ÚNICAMENTE el campo `positions` de cada jugador en
// data/real/teams/*.json, y regenera data/real/real-data-bundle.js a
// partir de esos ficheros ya actualizados (mismo formato exacto que
// scripts/migrate-positions-to-map.js/import-real-data.js). NO toca
// data/real/sources/todos_los_jugadores_acb_y_feb.txt: a diferencia de la
// migración de esquema anterior, esto es una recalibración de valores
// dentro del esquema ya vigente, no necesita sincronizarse con el fichero
// de origen de texto plano.
//
// Uso: node scripts/regenerate-real-positions.js

const fs = require('fs');
const path = require('path');

const { POSITIONS } = require('../src/entities/Player.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEAMS_DIR = path.join(REPO_ROOT, 'data/real/teams');
const INDEX_FILE = path.join(REPO_ROOT, 'data/real/index.json');
const BUNDLE_FILE = path.join(REPO_ROOT, 'data/real/real-data-bundle.js');

const PRIMARY_LEVEL = 20;
const OLD_SECONDARY_LEVEL = 12; // valor plano que dejó migrate-positions-to-map.js
const OLD_LOW_LEVEL = 2; // valor plano que dejó migrate-positions-to-map.js

// Rango final aproximado pedido por el prompt de esta sesión: 8-17 para
// posiciones secundarias CONOCIDAS (hoy 12), 1-6 para NO habilitadas (hoy
// 2). Base/dispersión elegidos para que el ruido natural (antes de
// clamp) caiga ya casi siempre dentro de ese rango, sin que sea el propio
// clamp quien dé forma a la distribución (mismo criterio de diseño que
// playerGenerator.generatePositionMap: ADJACENT_LEVEL_BASE/SPREAD y
// DISTANT_LEVEL_BASE/SPREAD, aquí re-ajustados a los nuevos límites en
// vez de reutilizados tal cual, porque esos límites están pensados para
// generación desde cero con techo 19, no para este rango 8-17/1-6).
const KNOWN_SECONDARY_BASE = 12;
const KNOWN_SECONDARY_SPREAD = 5; // rango crudo 7-17
const KNOWN_SECONDARY_MIN = 8;
const KNOWN_SECONDARY_MAX = 17;

const NOT_ENABLED_BASE = 3.5;
const NOT_ENABLED_SPREAD = 2.5; // rango crudo 1-6
const NOT_ENABLED_MIN = 1;
const NOT_ENABLED_MAX = 6;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// PRNG determinista (mulberry32) — reproducible sin depender de
// Math.random() puro, pedido explícito del prompt ("para que el script
// sea reproducible si hace falta volver a ejecutarlo o auditarlo").
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Semilla determinista por jugador, derivada de su `id` real (pedido
// explícito del prompt) — un hash de string simple (djb2-like) basta, no
// hace falta criptográfico para esto.
function hashStringToSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// Ruido uniforme en [-spread, spread] — mismo criterio que
// playerGenerator.randomNoise, con el PRNG determinista en vez de
// Math.random().
function seededNoise(rng, spread) {
  return (rng() * 2 - 1) * spread;
}

function regeneratePositionValue(currentValue, rng) {
  if (currentValue === PRIMARY_LEVEL) return currentValue; // principal: nunca se toca
  if (currentValue === OLD_SECONDARY_LEVEL) {
    const raw = KNOWN_SECONDARY_BASE + seededNoise(rng, KNOWN_SECONDARY_SPREAD);
    return clamp(Math.round(raw), KNOWN_SECONDARY_MIN, KNOWN_SECONDARY_MAX);
  }
  // OLD_LOW_LEVEL (2) es el único otro valor que debería existir tras la
  // migración anterior — cualquier otro valor bajo no reconocido se trata
  // igual, como "no habilitada", en vez de lanzar un error que pararía
  // todo el script por un dato inesperado.
  const raw = NOT_ENABLED_BASE + seededNoise(rng, NOT_ENABLED_SPREAD);
  return clamp(Math.round(raw), NOT_ENABLED_MIN, NOT_ENABLED_MAX);
}

// Un PRNG POR JUGADOR (nunca uno global reutilizado posición a posición
// ni jugador a jugador) — sembrado por su id real, para que regenerar el
// mismo jugador dos veces produzca el mismo resultado.
function regeneratePlayerPositions(player) {
  const rng = mulberry32(hashStringToSeed(player.id));
  const newPositions = {};
  POSITIONS.forEach((pos) => {
    newPositions[pos] = regeneratePositionValue(player.positions[pos], rng);
  });
  return newPositions;
}

function positionPattern(positions) {
  return POSITIONS.map((pos) => positions[pos]).slice().sort((a, b) => b - a).join('/');
}

// Todos los campos de un jugador SALVO `positions`, para el diff campo a
// campo pedido por el prompt (mismo rigor que ya aplicó
// scripts/rescale-real-attributes.js en su propia verificación, sin
// reutilizar su código).
function withoutPositions(player) {
  const { positions, ...rest } = player;
  return rest;
}

function main() {
  const files = fs.readdirSync(TEAMS_DIR).filter((f) => f.endsWith('.json'));
  let playersProcessed = 0;
  const patternsBefore = {};
  const patternsAfter = {};
  const fieldDiffErrors = [];
  const primaryCountErrors = [];

  files.forEach((file) => {
    const filePath = path.join(TEAMS_DIR, file);
    const team = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    team.roster.forEach((player) => {
      const before = JSON.parse(JSON.stringify(player));
      patternsBefore[positionPattern(before.positions)] = (patternsBefore[positionPattern(before.positions)] || 0) + 1;

      player.positions = regeneratePlayerPositions(player);
      playersProcessed += 1;

      // --- Verificación 1: exactamente una posición en 20 ---
      const primaryCount = Object.values(player.positions).filter((v) => v === PRIMARY_LEVEL).length;
      if (primaryCount !== 1) {
        primaryCountErrors.push(`${player.id} (${file}): ${primaryCount} posiciones en ${PRIMARY_LEVEL}`);
      }

      // --- Verificación 2: ningún otro campo cambió ---
      const beforeRest = JSON.stringify(withoutPositions(before));
      const afterRest = JSON.stringify(withoutPositions(player));
      if (beforeRest !== afterRest) {
        fieldDiffErrors.push(`${player.id} (${file}): un campo distinto de "positions" cambió`);
      }

      patternsAfter[positionPattern(player.positions)] = (patternsAfter[positionPattern(player.positions)] || 0) + 1;
    });
    fs.writeFileSync(filePath, JSON.stringify(team, null, 2) + '\n');
  });

  console.log(`Regeneradas las posiciones de ${playersProcessed} jugadores en ${files.length} ficheros de data/real/teams/.`);
  console.log(`Patrones de posición distintos ANTES: ${Object.keys(patternsBefore).length}`);
  console.log(`Patrones de posición distintos DESPUÉS: ${Object.keys(patternsAfter).length}`);

  if (primaryCountErrors.length > 0) {
    console.log(`\n⚠️  ${primaryCountErrors.length} jugador(es) sin exactamente una posición en ${PRIMARY_LEVEL}:`);
    primaryCountErrors.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 1;
  } else {
    console.log(`OK: los ${playersProcessed} jugadores mantienen exactamente una posición en ${PRIMARY_LEVEL}.`);
  }

  if (fieldDiffErrors.length > 0) {
    console.log(`\n⚠️  ${fieldDiffErrors.length} jugador(es) con un campo distinto de "positions" modificado:`);
    fieldDiffErrors.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 1;
  } else {
    console.log(`OK: ningún campo distinto de "positions" cambió en ninguno de los ${playersProcessed} jugadores.`);
  }

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
    console.log('\nOK: regeneración de posiciones completa y verificada.');
  }
}

main();
