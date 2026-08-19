// scripts/import-real-data.js
// Utilidad de importación de la base de datos real ACB + Primera FEB —
// ver DESIGN.md sección 2 y 6 ("Jugadores y equipos", "datos reales de
// jugadores/clubes") y CLAUDE.md (misma sección). Convierte los dos
// ficheros de texto de origen (data/real/sources/) en instancias reales
// de Team/Player (heredando toda su validación) y las guarda en
// data/real/. Script de utilidad (CLAUDE.md: "Node.js solo para scripts
// de utilidad") — no forma parte del arranque del juego.
//
// Uso: node scripts/import-real-data.js [ficheroEquipos] [ficheroJugadores]
// Por defecto lee de data/real/sources/equipos_acb_y_feb.txt y
// data/real/sources/todos_los_jugadores_acb_y_feb.txt.

const fs = require('fs');
const path = require('path');

const { Player, POSITIONS } = require('../src/entities/Player.js');
const { Team, MATCH_SQUAD_MIN } = require('../src/entities/Team.js');
const { generateFictionalPlayer } = require('../src/utils/playerGenerator.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TEAMS_FILE = path.join(REPO_ROOT, 'data/real/sources/equipos_acb_y_feb.txt');
const DEFAULT_PLAYERS_FILE = path.join(REPO_ROOT, 'data/real/sources/todos_los_jugadores_acb_y_feb.txt');
const OUTPUT_TEAMS_DIR = path.join(REPO_ROOT, 'data/real/teams');
const OUTPUT_INDEX_FILE = path.join(REPO_ROOT, 'data/real/index.json');
// Bundle cargable con <script> (además de los JSON de arriba, que son el
// formato canónico de almacenamiento): index.html abre siempre por
// file://, y fetch() de un fichero local falla ahí por CORS (comprobado
// antes de tomar esta decisión) — así que la sección de prueba de la
// Parte 2 no puede leer los JSON con fetch. Este bundle expone los mismos
// datos como objeto JS de window.BasketManager, igual que el resto de
// generadores del proyecto (sin servidor, sin paso de compilación).
const OUTPUT_BUNDLE_FILE = path.join(REPO_ROOT, 'data/real/real-data-bundle.js');

const teamsFile = process.argv[2] || DEFAULT_TEAMS_FILE;
const playersFile = process.argv[3] || DEFAULT_PLAYERS_FILE;

// --- Parseo de los ficheros de origen ---
// Son texto con separadores de sección ("=== ACB / 1ª ===") y, dentro,
// bloques JSON de un objeto cada uno — no un array JSON válido. Se
// extraen contando llaves de nivel superior, ignorando las que aparecen
// dentro de cadenas de texto (para que un "}" en, por ejemplo, el texto
// de `dataSource.basis`, no cierre el bloque antes de tiempo). Cualquier
// texto que no sea JSON (los separadores, líneas en blanco) se salta sin
// más: solo se registran los tramos que empiezan en una "{" de nivel 0.
function parseJsonBlocks(text) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === '\\') escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return blocks.map((block) => JSON.parse(block));
}

// --- Completar plantillas incompletas (2ª división, dataset con menos de
// las 8 fichas mínimas de convocatoria) con jugadores ficticios ---
function markAsPlaceholder(player) {
  player.dataSource = {
    type: 'placeholder',
    basis: 'Jugador ficticio generado para completar la plantilla mínima de convocatoria (8), '
      + 'plantilla real incompleta en el dataset importado',
    confidence: 'n/a',
  };
  return player;
}

// Añade jugadores ficticios hasta cubrir, como mínimo, 1 de cada una de
// las 5 posiciones base y un total de `minimum` jugadores en el roster.
// Si ya cubre alguna posición con jugadores reales, no se toca esa
// posición — solo se rellenan los huecos genuinos.
function patchRosterToMinimum(roster, minimum) {
  const added = [];
  // "Cubierta" = alguna posición PRINCIPAL (mapa de 5, DESIGN.md 6.1) ya
  // presente en la plantilla real — no basta con tener nivel bajo ahí.
  const coveredPositions = new Set(roster.map((player) => player.primaryPosition));

  POSITIONS.filter((pos) => !coveredPositions.has(pos)).forEach((position) => {
    const player = markAsPlaceholder(generateFictionalPlayer({ primaryPosition: position }));
    roster.push(player);
    added.push(player);
  });

  while (roster.length < minimum) {
    const player = markAsPlaceholder(generateFictionalPlayer());
    roster.push(player);
    added.push(player);
  }
  return added;
}

// team.toJSON() no incluye dataSource en cada jugador (Player.toJSON()
// no lo conoce todavía — ver nota de la Parte 3 en el resumen final), así
// que se reconstruye el roster de salida a partir de los objetos Player
// EN MEMORIA (que sí tienen la propiedad, asignada tras instanciarlos)
// en vez de descartarlo silenciosamente.
function serializeTeamForRealData(team) {
  const json = team.toJSON();
  json.roster = team.roster.map((player) => ({
    ...player.toJSON(),
    dataSource: player.dataSource || null,
  }));
  return json;
}

function main() {
  const rawTeams = parseJsonBlocks(fs.readFileSync(teamsFile, 'utf8'));
  const rawPlayers = parseJsonBlocks(fs.readFileSync(playersFile, 'utf8'));

  // --- Jugadores: instancias reales de Player (constructor de Player.js,
  // no objetos planos) — dataSource se conserva aparte, no se pasa al
  // constructor (no existe como campo formal todavía, ver Parte 3). ---
  const playersById = new Map();
  rawPlayers.forEach((rawPlayer) => {
    const { dataSource, ...playerData } = rawPlayer;
    const player = new Player(playerData);
    player.dataSource = dataSource || null;
    playersById.set(rawPlayer.id, player);
  });

  const teamIdMismatches = [];
  const patchedTeams = [];
  let realPlayerCount = 0;
  let placeholderPlayerCount = 0;
  const divisionCounts = {};

  const teams = rawTeams.map((rawTeam) => {
    const roster = rawTeam.playerIds.map((playerId) => {
      const player = playersById.get(playerId);
      if (!player) {
        throw new Error(`Equipo ${rawTeam.id}: no se encontró el jugador ${playerId} en el fichero de jugadores`);
      }
      // Comprobación de integridad (pedida explícitamente): el teamId que
      // ya traía el jugador en el JSON de origen debe coincidir con el
      // equipo que lo referencia por playerIds. Se comprueba ANTES de
      // construir el Team (que sincronizaría teamId de todos modos) para
      // no enmascarar en silencio una inconsistencia real del dataset.
      if (player.teamId && player.teamId !== rawTeam.id) {
        teamIdMismatches.push({ playerId, playerTeamId: player.teamId, expectedTeamId: rawTeam.id });
      }
      return player;
    });
    realPlayerCount += roster.length;

    if (roster.length < MATCH_SQUAD_MIN) {
      const added = patchRosterToMinimum(roster, MATCH_SQUAD_MIN);
      placeholderPlayerCount += added.length;
      patchedTeams.push({
        teamId: rawTeam.id, teamName: rawTeam.name, playersAdded: added.length, finalRosterSize: roster.length,
      });
    }

    const team = new Team({ ...rawTeam, roster });
    divisionCounts[team.division] = (divisionCounts[team.division] || 0) + 1;
    return team;
  });

  // --- Guardar en data/real/ ---
  fs.mkdirSync(OUTPUT_TEAMS_DIR, { recursive: true });
  teams.forEach((team) => {
    const outputPath = path.join(OUTPUT_TEAMS_DIR, `${team.id}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(serializeTeamForRealData(team), null, 2) + '\n');
  });

  const index = teams.map((team) => ({
    id: team.id, name: team.name, city: team.city, division: team.division,
  }));
  fs.writeFileSync(OUTPUT_INDEX_FILE, JSON.stringify(index, null, 2) + '\n');

  const teamsById = {};
  teams.forEach((team) => { teamsById[team.id] = serializeTeamForRealData(team); });
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
  fs.writeFileSync(OUTPUT_BUNDLE_FILE, bundleSource);

  // --- Resumen ---
  console.log('=== Importación de base de datos real ACB + Primera FEB ===\n');
  console.log('Equipos por división:', divisionCounts);
  console.log(`Total equipos: ${teams.length}`);
  console.log(`Jugadores reales importados: ${realPlayerCount}`);
  console.log(`Jugadores placeholder generados: ${placeholderPlayerCount}`);
  console.log(`Total jugadores en data/real/: ${realPlayerCount + placeholderPlayerCount}`);

  if (patchedTeams.length > 0) {
    console.log('\nEquipos con plantilla incompleta en el dataset, completados hasta 8:');
    patchedTeams.forEach((p) => {
      console.log(`  - ${p.teamName} (${p.teamId}): +${p.playersAdded} placeholder → ${p.finalRosterSize} jugadores`);
    });
  } else {
    console.log('\n(Ningún equipo necesitó completarse: todos tenían ya 8+ jugadores reales.)');
  }

  if (teamIdMismatches.length > 0) {
    console.log('\n⚠️  INCONSISTENCIAS DE teamId DETECTADAS (no sobrescritas en silencio):');
    teamIdMismatches.forEach((m) => {
      console.log(`  - Jugador ${m.playerId}: teamId de origen "${m.playerTeamId}" != equipo que lo referencia "${m.expectedTeamId}"`);
    });
  } else {
    console.log('\nSin inconsistencias de teamId: todos los jugadores reales coincidían con el equipo que los referencia.');
  }

  console.log(`\nGuardado: ${teams.length} ficheros en ${path.relative(REPO_ROOT, OUTPUT_TEAMS_DIR)}/ + ${path.relative(REPO_ROOT, OUTPUT_INDEX_FILE)}`);
  console.log(`Bundle para index.html (carga sin fetch, ver comentario en el propio fichero): ${path.relative(REPO_ROOT, OUTPUT_BUNDLE_FILE)}`);
}

main();
