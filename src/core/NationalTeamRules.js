// src/core/NationalTeamRules.js
// NATIONAL-TEAMS-1 (DESIGN.md 10.17) — ruleset VERSIONADO y TRAZABLE de
// selecciones nacionales, separado de la normativa doméstica
// (`CompetitionRules.js`) pero con el MISMO patrón de fuente oficial +
// versión/temporada de vigencia + estado (`verified`/`provisional`/
// `deprecated`) que CONTRACT-1/REG-1/MARKET-1/TRANSFER-1/LOAN-1. Convención
// del proyecto: identificadores en inglés, comentarios en español.
//
// Cada regla declara `kind: 'minimum'|'maximum'` para que un overlay de
// handbook por competición se componga de forma SEMÁNTICA — nunca
// `Object.assign()`/"el último gana" (CLAUDE.md, "no se mezclan perfiles
// normativos con Object.assign()/spread genérico").
//
// Módulo puro: no lee DOM, ni `state`, ni variables globales.

(function (global) {
  const FIBA_NATIONAL_TEAMS_RULESET_ID = 'fiba-national-teams-2026.1';
  const FICTIONAL_TEST_RULESET_ID = 'fictional-test-national-teams-1';

  // Fuentes oficiales — Book 1 (calendario/International Window), Book 2
  // (competiciones/handbook/seguro) y Book 3 (nacionalidad deportiva,
  // listas, convocatoria, liberación), en vigor 22-04-2026 (sección 5.1 del
  // prompt). Solo se codifican las reglas VERIFICADAS que esta vertical
  // necesita — el resto de cada Book queda fuera de alcance, sin inventar
  // números.
  const FIBA_SOURCES = Object.freeze([
    {
      book: 'FIBA Internal Regulations, Book 1',
      url: 'https://assets.fiba.basketball/image/upload/documents-corporate-fiba-regulations-internal-regulations-book-1.pdf',
      effectiveFrom: '2026-04-22',
      consultedOn: '2026-09-07',
      covers: 'Calendario y concepto de International Window.',
    },
    {
      book: 'FIBA Internal Regulations, Book 2',
      url: 'https://assets.fiba.basketball/image/upload/documents-corporate-fiba-regulations-internal-regulations-book-2.pdf',
      effectiveFrom: '2026-04-22',
      consultedOn: '2026-09-07',
      covers: 'Competiciones de selecciones, calendario/handbook y seguro.',
    },
    {
      book: 'FIBA Internal Regulations, Book 3',
      url: 'https://assets.fiba.basketball/image/upload/documents-corporate-fiba-regulations-internal-regulations-book-3.pdf',
      effectiveFrom: '2026-04-22',
      consultedOn: '2026-09-07',
      covers: 'Nacionalidad deportiva, listas, convocatoria y liberación.',
    },
  ]);

  function rule(id, kind, value, sourceBook, status) {
    return Object.freeze({
      id, kind, value, sourceBook, status: status || 'provisional',
    });
  }

  // Solo las reglas VERIFICADAS necesarias para esta vertical (sección 5.1
  // del prompt) — nunca se dispersan por `Team.js`/`game.js`/tests.
  const FIBA_NATIONAL_TEAMS_RULESET = Object.freeze({
    id: FIBA_NATIONAL_TEAMS_RULESET_ID,
    status: 'provisional',
    effectiveFrom: '2026-04-22',
    sources: FIBA_SOURCES,
    overlayOf: null,
    rules: Object.freeze({
      // Solicitud de decisión de nacionalidad con al menos N días antes de
      // la competición (mínimo — cuanto más alto exija el overlay, manda).
      nationalityDecisionMinNoticeDays: rule('fiba-b3-nationality-decision-notice', 'minimum', 14, 'Book 3'),
      // Lista preliminar de HASTA N jugadores (máximo — cuanto más bajo
      // exija el overlay, manda).
      preliminaryListMax: rule('fiba-b3-preliminary-list-max', 'maximum', 24, 'Book 3'),
      // Lista final de N a M jugadores.
      finalListMin: rule('fiba-b3-final-list-min', 'minimum', 10, 'Book 3'),
      finalListMax: rule('fiba-b3-final-list-max', 'maximum', 12, 'Book 3'),
      // Máximo de jugadores con condición "restricted" en la lista final
      // bajo el módulo base.
      maxRestrictedInFinalList: rule('fiba-b3-max-restricted-final-list', 'maximum', 1, 'Book 3'),
      // Solicitud de liberación al club con al menos N días.
      clubReleaseMinNoticeDays: rule('fiba-b3-club-release-notice', 'minimum', 30, 'Book 3'),
    }),
  });

  // Ruleset ficticio EXPLÍCITO de solo prueba — nunca se autoselecciona en
  // una carrera real, solo lo usan `scripts/test-national-teams1.js`/
  // `scripts/smoke-national-teams1.js` cuando quieren números distintos a
  // los reales sin tocar el bundle FIBA.
  const FICTIONAL_TEST_RULESET = Object.freeze({
    id: FICTIONAL_TEST_RULESET_ID,
    status: 'fictional-test',
    effectiveFrom: '2026-01-01',
    sources: Object.freeze([{ book: 'Fixture de prueba NATIONAL-TEAMS-1', url: null, effectiveFrom: '2026-01-01', consultedOn: '2026-09-07', covers: 'Ruleset ficticio para scripts/test|smoke-national-teams1.js.' }]),
    overlayOf: null,
    rules: Object.freeze({
      nationalityDecisionMinNoticeDays: rule('fictional-nationality-decision-notice', 'minimum', 3, 'fixture'),
      preliminaryListMax: rule('fictional-preliminary-list-max', 'maximum', 6, 'fixture'),
      finalListMin: rule('fictional-final-list-min', 'minimum', 4, 'fixture'),
      finalListMax: rule('fictional-final-list-max', 'maximum', 5, 'fixture'),
      maxRestrictedInFinalList: rule('fictional-max-restricted-final-list', 'maximum', 1, 'fixture'),
      clubReleaseMinNoticeDays: rule('fictional-club-release-notice', 'minimum', 2, 'fixture'),
    }),
  });

  const RULESETS_BY_ID = {
    [FIBA_NATIONAL_TEAMS_RULESET_ID]: FIBA_NATIONAL_TEAMS_RULESET,
    [FICTIONAL_TEST_RULESET_ID]: FICTIONAL_TEST_RULESET,
  };

  function requireNationalTeamRuleset(bundleId) {
    const found = RULESETS_BY_ID[bundleId];
    if (!found) {
      throw new Error(
        `NationalTeamRules: ruleset bundle desconocido "${bundleId}" — no hay fallback ACB/FEB/España para reglas `
        + 'FIBA (invariante: ninguna regla depende de España/ACB/FEB).',
      );
    }
    return found;
  }

  // Composición SEMÁNTICA de un overlay de handbook por competición sobre
  // el bundle base — NUNCA `Object.assign()`/"el último gana" (sección 5.1
  // del prompt). Cada regla del overlay se compone según su `kind`:
  // mínimos concurrentes -> el mayor; máximos concurrentes -> el menor
  // (mismo criterio que CLAUDE.md para el resto de dominios normativos).
  // Devuelve un bundle NUEVO (nunca muta el base ni el overlay).
  function composeOverlay(baseBundle, overlay) {
    if (!overlay) return baseBundle;
    if (!overlay.id) throw new Error('NationalTeamRules.composeOverlay: el overlay necesita "id".');
    const composedRules = { ...baseBundle.rules };
    Object.keys(overlay.rules || {}).forEach((key) => {
      const baseRule = baseBundle.rules[key];
      const overlayRule = overlay.rules[key];
      if (!baseRule) { composedRules[key] = overlayRule; return; }
      if (baseRule.kind !== overlayRule.kind) {
        throw new Error(
          `NationalTeamRules.composeOverlay: la regla "${key}" cambia de "kind" (${baseRule.kind} -> `
          + `${overlayRule.kind}) — un overlay no puede redefinir el TIPO de una regla, solo su valor.`,
        );
      }
      if (baseRule.kind === 'minimum') {
        composedRules[key] = overlayRule.value >= baseRule.value ? overlayRule : baseRule;
      } else if (baseRule.kind === 'maximum') {
        composedRules[key] = overlayRule.value <= baseRule.value ? overlayRule : baseRule;
      } else {
        throw new Error(`NationalTeamRules.composeOverlay: la regla "${key}" no declara "kind" minimum/maximum — no se puede componer semánticamente.`);
      }
    });
    return Object.freeze({
      id: `${baseBundle.id}+${overlay.id}`,
      status: overlay.status || baseBundle.status,
      effectiveFrom: baseBundle.effectiveFrom,
      sources: Object.freeze([...baseBundle.sources, ...(overlay.sources || [])]),
      overlayOf: baseBundle.id,
      rules: Object.freeze(composedRules),
    });
  }

  const exportsObj = {
    FIBA_NATIONAL_TEAMS_RULESET_ID,
    FIBA_NATIONAL_TEAMS_RULESET,
    FICTIONAL_TEST_RULESET_ID,
    FICTIONAL_TEST_RULESET,
    requireNationalTeamRuleset,
    composeOverlay,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
