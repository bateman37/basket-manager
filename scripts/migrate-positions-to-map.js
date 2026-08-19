// scripts/migrate-positions-to-map.js
// Migración ÚNICA del esquema de posiciones de jugador (DESIGN.md 6.1
// actualizado, Bloque C.0): convierte `positions` de lista plana (1-5
// entradas) al nuevo mapa con nivel 1-20 para las 5 posiciones, SIEMPRE
// presentes. Regla de migración (preserva la información existente, no es
// una regla de diseño definitiva — ver resumen de la tarea):
//   - 1ª posición de la lista antigua -> 20 (principal, por definición).
//   - Resto de posiciones que ya estaban en la lista antigua -> 12
//     (placeholder "competente pero no especialista", pendiente de revisión
//     de contenido real).
//   - Posiciones que NO estaban en la lista antigua -> 2 (placeholder bajo
//     uniforme; la generación con coherencia posicional real queda para
//     otra sesión, DESIGN.md 6.1).
//
// Toca: data/real/teams/*.json (dato canónico, ya reescalado por
// scripts/rescale-real-attributes.js — por eso esta migración NO reimporta
// desde data/real/sources/, que dejaría los atributos sin reescalar) y
// data/real/sources/todos_los_jugadores_acb_y_feb.txt (para que un futuro
// re-import parta ya del nuevo esquema). Regenera data/real/real-data-bundle.js
// a partir de los teams/*.json ya migrados. No toca data/real/index.json
// (no incluye `positions`, no le afecta).
//
// Uso: node scripts/migrate-positions-to-map.js

const fs = require('fs');
const path = require('path');

const { POSITIONS } = require('../src/entities/Player.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEAMS_DIR = path.join(REPO_ROOT, 'data/real/teams');
const INDEX_FILE = path.join(REPO_ROOT, 'data/real/index.json');
const BUNDLE_FILE = path.join(REPO_ROOT, 'data/real/real-data-bundle.js');
const SOURCES_PLAYERS_FILE = path.join(REPO_ROOT, 'data/real/sources/todos_los_jugadores_acb_y_feb.txt');

const PRIMARY_LEVEL = 20;
const SECONDARY_LEVEL = 12; // placeholder "competente pero no especialista"
const LOW_LEVEL = 2; // placeholder bajo uniforme

function migratePositionsArray(oldPositions) {
  const list = Array.isArray(oldPositions) ? oldPositions : [oldPositions];
  const map = {};
  POSITIONS.forEach((pos) => {
    if (pos === list[0]) {
      map[pos] = PRIMARY_LEVEL;
    } else if (list.includes(pos)) {
      map[pos] = SECONDARY_LEVEL;
    } else {
      map[pos] = LOW_LEVEL;
    }
  });
  return map;
}

function migrateTeamsJson() {
  const files = fs.readdirSync(TEAMS_DIR).filter((f) => f.endsWith('.json'));
  let playersMigrated = 0;
  files.forEach((file) => {
    const filePath = path.join(TEAMS_DIR, file);
    const team = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    team.roster.forEach((player) => {
      player.positions = migratePositionsArray(player.positions);
      playersMigrated += 1;
    });
    fs.writeFileSync(filePath, JSON.stringify(team, null, 2) + '\n');
  });
  console.log(`Migrados ${playersMigrated} jugadores en ${files.length} ficheros de data/real/teams/.`);
  return files;
}

// Reescribe el bloque `"positions": [...]` de cada jugador en el fichero de
// origen de texto plano (mismo formato que produce JSON.stringify(obj, null,
// 2) para un array de strings, indentado a partir de la clave "positions").
// No se reparsea el fichero entero (mezcla JSON + separadores "=== ... ==="
// no válidos como un solo documento JSON) — se sustituye solo el bloque de
// cada posición con una expresión regular no-greedy (los arrays de
// "positions" nunca anidan corchetes).
function migrateSourcesFile() {
  if (!fs.existsSync(SOURCES_PLAYERS_FILE)) {
    console.log('(No se encontró el fichero de origen de jugadores; se omite su migración.)');
    return;
  }
  const raw = fs.readFileSync(SOURCES_PLAYERS_FILE, 'utf8');
  let replaced = 0;
  const updated = raw.replace(/"positions":\s*\[([^\]]*)\]/g, (match, inner) => {
    const oldList = [...inner.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const map = migratePositionsArray(oldList);
    replaced += 1;
    const lines = POSITIONS.map((pos) => `    "${pos}": ${map[pos]}`).join(',\n');
    return `"positions": {\n${lines}\n  }`;
  });
  fs.writeFileSync(SOURCES_PLAYERS_FILE, updated);
  console.log(`Migrados ${replaced} bloques "positions" en ${path.relative(REPO_ROOT, SOURCES_PLAYERS_FILE)}.`);
}

// Regenera el bundle cargable con <script> a partir de los teams/*.json ya
// migrados — mismo formato exacto que escribe scripts/import-real-data.js.
function regenerateBundle() {
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
  console.log(`Regenerado ${path.relative(REPO_ROOT, BUNDLE_FILE)}.`);
}

function main() {
  migrateTeamsJson();
  migrateSourcesFile();
  regenerateBundle();
}

main();
