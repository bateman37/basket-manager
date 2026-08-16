// scripts/rescale-real-attributes.js
// Reescalado proporcional de atributos de la base de datos real (ACB +
// Primera FEB) — ver data/real/team_tiers.json (tiers validados con
// Dennis, basados en presupuesto real e historial de clasificaciones).
// Problema que corrige: los atributos importados quedaban demasiado
// comprimidos en la escala 1-20 (equipos top y modestos con overall casi
// idéntico), así que el resultado de los partidos dependía casi
// enteramente del azar. Script de utilidad Node — no forma parte del
// arranque del juego, se ejecuta a mano cuando haga falta re-aplicar el
// reescalado (ej. si se reimportan datos nuevos).
//
// IMPORTANTE (alcance deliberado de esta tarea): esto NO toca
// MatchConfig.js ni ninguna fórmula del motor — solo los datos de
// atributos ya importados en data/real/teams/.
//
// Uso: node scripts/rescale-real-attributes.js

const fs = require('fs');
const path = require('path');

const { TECHNICAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, MENTAL_ATTRIBUTES, ATTRIBUTE_MIN, ATTRIBUTE_MAX } = require('../src/entities/Player.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEAMS_DIR = path.join(REPO_ROOT, 'data/real/teams');
const INDEX_FILE = path.join(REPO_ROOT, 'data/real/index.json');
const TIERS_FILE = path.join(REPO_ROOT, 'data/real/team_tiers.json');
const BUNDLE_FILE = path.join(REPO_ROOT, 'data/real/real-data-bundle.js');

const RESCALED_GROUPS = ['technical', 'physical', 'mental'];
const TOP_N = 8;
const TOLERANCE = 0.3; // ver Verificación pedida: ±0.3 respecto al targetTop8

function clampAttribute(value) {
  return Math.min(ATTRIBUTE_MAX, Math.max(ATTRIBUTE_MIN, Math.round(value)));
}

// Media simple de TODOS los atributos numéricos de technical/physical/
// mental de un jugador (NO hidden, NO dynamicState — no participan).
function playerOverall(player) {
  const values = [];
  RESCALED_GROUPS.forEach((group) => {
    Object.values(player[group]).forEach((value) => values.push(value));
  });
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Media del top8 (los TOP_N jugadores de mayor overall) de una plantilla.
function top8Rating(roster) {
  const sorted = [...roster].map(playerOverall).sort((a, b) => b - a);
  const top = sorted.slice(0, TOP_N);
  return top.reduce((sum, v) => sum + v, 0) / top.length;
}

function loadTierMap() {
  const tiers = JSON.parse(fs.readFileSync(TIERS_FILE, 'utf8'));
  const map = new Map();
  ['division1', 'division2'].forEach((divisionKey) => {
    Object.entries(tiers[divisionKey]).forEach(([teamId, entry]) => map.set(teamId, entry));
  });
  return map;
}

function rescalePlayer(player, factor) {
  RESCALED_GROUPS.forEach((group) => {
    Object.keys(player[group]).forEach((attrName) => {
      player[group][attrName] = clampAttribute(player[group][attrName] * factor);
    });
  });
}

function serializeTeamForRealData(teamJson) {
  // El propio JSON ya está en el formato de salida de team.toJSON() +
  // dataSource por jugador (ver scripts/import-real-data.js) — no hace
  // falta reconstruir instancias de Team/Player para reescribirlo, solo
  // mutar los atributos y volver a guardar el mismo objeto.
  return teamJson;
}

function main() {
  const tierMap = loadTierMap();
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));

  const report = [];
  const teamsById = {};

  index.forEach(({ id }) => {
    const teamPath = path.join(TEAMS_DIR, `${id}.json`);
    const teamJson = JSON.parse(fs.readFileSync(teamPath, 'utf8'));
    const tier = tierMap.get(id);
    if (!tier) throw new Error(`No hay entrada en team_tiers.json para el equipo ${id}`);

    const before = top8Rating(teamJson.roster);
    const factor = tier.targetTop8 / before;

    teamJson.roster.forEach((player) => rescalePlayer(player, factor));

    const after = top8Rating(teamJson.roster);

    fs.writeFileSync(teamPath, JSON.stringify(serializeTeamForRealData(teamJson), null, 2) + '\n');
    teamsById[id] = teamJson;

    report.push({
      id,
      name: teamJson.name,
      division: teamJson.division,
      targetTop8: tier.targetTop8,
      before,
      after,
      factor,
    });
  });

  // --- Regenerar el bundle cargable con <script> (mismo formato que
  // scripts/import-real-data.js), para que index.html vea los datos
  // reescalados sin tener que reimportar desde los ficheros de origen. ---
  const bundleSource = [
    '// data/real/real-data-bundle.js',
    '// GENERADO por scripts/import-real-data.js / rescale-real-attributes.js —',
    '// no editar a mano, volver a ejecutar el script correspondiente si hace',
    '// falta actualizar estos datos.',
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

  printVerification(report);
}

function printVerification(report) {
  console.log('=== Reescalado proporcional de atributos — antes / después ===\n');

  ['1ª', '2ª'].forEach((division) => {
    console.log(`--- División ${division} ---`);
    const divisionReport = report.filter((r) => r.division === division);
    divisionReport
      .slice()
      .sort((a, b) => b.after - a.after)
      .forEach((r) => {
        const diff = Math.abs(r.after - r.targetTop8);
        const flag = diff > TOLERANCE ? '  ⚠️ FUERA DE TOLERANCIA' : '';
        console.log(
          `  ${r.name.padEnd(38)} antes ${r.before.toFixed(2).padStart(6)}  →  después ${r.after.toFixed(2).padStart(6)}  `
          + `(objetivo ${r.targetTop8.toFixed(2)}, factor ${r.factor.toFixed(3)})${flag}`,
        );
      });
    console.log('');
  });

  // --- Comprobación de tolerancia ±0.3 ---
  const outOfTolerance = report.filter((r) => Math.abs(r.after - r.targetTop8) > TOLERANCE);
  if (outOfTolerance.length === 0) {
    console.log(`OK: los 36 equipos quedaron a ±${TOLERANCE} de su targetTop8.\n`);
  } else {
    console.log(`⚠️  ${outOfTolerance.length} equipo(s) fuera de ±${TOLERANCE} de su targetTop8:`);
    outOfTolerance.forEach((r) => console.log(`  - ${r.name}: después ${r.after.toFixed(2)} vs objetivo ${r.targetTop8.toFixed(2)}`));
    console.log('');
  }

  // --- Comprobación de orden esperado por tiers de team_tiers.json ---
  // Comparar como lista estrictamente ordenada NO vale: varios equipos
  // comparten el mismo targetTop8 (mismo tier) y entre ellos el orden es
  // indiferente por diseño — solo cuenta como violación real que un
  // equipo de un tier ACABE por encima de uno de un tier superior
  // (targetTop8 mayor).
  function findTierOrderViolations(divisionReport) {
    const violations = [];
    for (let i = 0; i < divisionReport.length; i++) {
      for (let j = i + 1; j < divisionReport.length; j++) {
        const a = divisionReport[i];
        const b = divisionReport[j];
        if (a.targetTop8 === b.targetTop8) continue; // mismo tier: orden indiferente
        const higherTierTeam = a.targetTop8 > b.targetTop8 ? a : b;
        const lowerTierTeam = a.targetTop8 > b.targetTop8 ? b : a;
        if (lowerTierTeam.after > higherTierTeam.after) {
          violations.push({ higherTierTeam, lowerTierTeam });
        }
      }
    }
    return violations;
  }

  ['1ª', '2ª'].forEach((division) => {
    const divisionReport = report.filter((r) => r.division === division);
    const violations = findTierOrderViolations(divisionReport);
    if (violations.length === 0) {
      console.log(`Orden por rating top8 en ${division} división: SIN violaciones de tier (ningún equipo de tier inferior superó a uno de tier superior).`);
    } else {
      console.log(`Orden por rating top8 en ${division} división: ${violations.length} violación(es) de tier detectada(s):`);
      violations.forEach((v) => {
        console.log(
          `  - ${v.lowerTierTeam.name} (tier inferior, objetivo ${v.lowerTierTeam.targetTop8}, después ${v.lowerTierTeam.after.toFixed(2)}) `
          + `quedó por encima de ${v.higherTierTeam.name} (tier superior, objetivo ${v.higherTierTeam.targetTop8}, después ${v.higherTierTeam.after.toFixed(2)})`,
        );
      });
    }
  });

  // --- Rango final por división ---
  console.log('');
  ['1ª', '2ª'].forEach((division) => {
    const values = report.filter((r) => r.division === division).map((r) => r.after);
    const min = Math.min(...values);
    const max = Math.max(...values);
    console.log(`Rango final rating top8 — división ${division}: ${min.toFixed(2)} – ${max.toFixed(2)} (amplitud ${(max - min).toFixed(2)})`);
  });

  // --- Mayores ajustes (positivo y negativo) ---
  console.log('');
  const byFactorDesc = report.slice().sort((a, b) => b.factor - a.factor);
  console.log('Mayor factor al ALZA:', byFactorDesc.slice(0, 3).map((r) => `${r.name} (x${r.factor.toFixed(3)})`).join(', '));
  console.log('Mayor factor a la BAJA:', byFactorDesc.slice(-3).reverse().map((r) => `${r.name} (x${r.factor.toFixed(3)})`).join(', '));
}

main();
