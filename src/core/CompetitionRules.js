// src/core/CompetitionRules.js
// ROSTER-1 (DESIGN.md 9.16) — Núcleo normativo multi-liga: identidad de
// competición, catálogo de módulos de reglas, bundles versionados por
// temporada y resolución con trazabilidad. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Principio rector (ver DESIGN.md 9.16 y CLAUDE.md): ACB y Primera FEB NO
// son el comportamiento universal del motor — son dos competiciones más,
// identificadas por un `competitionId` estable, cuyas reglas viven en
// módulos/bundles versionados y se consultan por contexto. Nada en este
// archivo conoce el DOM ni `state` de game.js; nada en `Team.js`/`game.js`
// debe decidir por su cuenta qué normativa aplicar — solo consultarla aquí
// y validar/presentar el resultado.
//
// Alcance REAL de ROSTER-1 (no ampliar sin pasar antes por Dennis): el
// único dominio con una regla de comportamiento activada de verdad es
// `registration.matchSquad` (tamaño de convocatoria). Cupos de formación,
// extranjeros no comunitarios, máximo de altas por temporada, empleo/
// contrato, mercado, traspasos, cesiones y transfer internacional quedan
// declarados como `notImplemented` — nunca como reglas vacías que parezcan
// activas (DESIGN.md 9.16, sección 5.2 del prompt de esta sesión).

(function (global) {
  // ---------------------------------------------------------------------
  // 1. Identidad de competición — IDs estables, independientes del nombre
  //    visible o del orden de división legacy ('1ª'/'2ª').
  // ---------------------------------------------------------------------
  const COMPETITION_IDS = {
    ACB: 'acb',
    PRIMERA_FEB: 'primera-feb',
    // Perfil SOLO DE TEST (sección 5.1/8 del prompt de ROSTER-1): límites
    // de convocatoria distintos de ACB/FEB, registrado igual que cualquier
    // competición real — demuestra que añadir una liga nueva es dato de
    // catálogo, no una rama nueva en Team.js/game.js. NUNCA usar en una
    // partida real.
    TEST_FICTIONAL: 'bm-test-fictional-league',
  };

  // Adaptador de frontera ÚNICO legacy ('1ª'/'2ª') -> competitionId real
  // (DESIGN.md 9.16, sección 5.1 del prompt: "crea un adaptador claro desde
  // las claves legacy y documenta su retirada futura"). `state.division`/
  // `team.division` de game.js y League.js seguirán existiendo mientras no
  // se reescriba calendario/ascensos (fuera de alcance de ROSTER-1) — pero
  // ninguna lógica NUEVA debe volver a ramificar sobre '1ª'/'2ª' fuera de
  // este único punto.
  const LEGACY_DIVISION_TO_COMPETITION_ID = {
    '1ª': COMPETITION_IDS.ACB,
    '2ª': COMPETITION_IDS.PRIMERA_FEB,
  };

  function competitionIdFromLegacyDivision(division) {
    const competitionId = LEGACY_DIVISION_TO_COMPETITION_ID[division];
    if (!competitionId) {
      throw new Error(
        `competitionIdFromLegacyDivision: división legacy desconocida "${division}" — no hay adaptador `
        + 'registrado (nunca se asume ACB por defecto).',
      );
    }
    return competitionId;
  }

  // ---------------------------------------------------------------------
  // 2. CompetitionCatalog — identidad de cada competición, sin reglas.
  // ---------------------------------------------------------------------
  const COMPETITION_DEFINITIONS = {
    [COMPETITION_IDS.ACB]: {
      id: COMPETITION_IDS.ACB, name: 'Liga ACB', country: 'ES', tier: 1, legacyDivision: '1ª',
    },
    [COMPETITION_IDS.PRIMERA_FEB]: {
      id: COMPETITION_IDS.PRIMERA_FEB, name: 'Primera FEB', country: 'ES', tier: 2, legacyDivision: '2ª',
    },
    [COMPETITION_IDS.TEST_FICTIONAL]: {
      id: COMPETITION_IDS.TEST_FICTIONAL,
      name: '[SOLO TEST] Liga ficticia de prueba',
      country: 'XX',
      tier: null,
      legacyDivision: null,
    },
  };

  function getCompetitionDefinition(competitionId) {
    const definition = COMPETITION_DEFINITIONS[competitionId];
    if (!definition) {
      throw new Error(
        `CompetitionRules: competición desconocida "${competitionId}" — no existe CompetitionDefinition `
        + 'registrada (nunca se aplica ACB por defecto).',
      );
    }
    return definition;
  }

  function listCompetitions() {
    return Object.values(COMPETITION_DEFINITIONS);
  }

  // ---------------------------------------------------------------------
  // 3. RuleModuleCatalog — por ahora solo módulos de `registration`, con
  //    la única regla de comportamiento real de ROSTER-1: el tamaño de
  //    convocatoria (`matchSquad`). Cada módulo declara explícitamente qué
  //    partes de la norma real NO cubre todavía (`notImplemented`), fuente
  //    oficial (`sourceRefs`) y estado de verificación.
  // ---------------------------------------------------------------------
  const REGISTRATION_MODULES = {
    'acb-registration-2025-26-v1': {
      id: 'acb-registration-2025-26-v1',
      version: 1,
      effectiveSeason: '2025-26',
      status: 'verified',
      competitionId: COMPETITION_IDS.ACB,
      // DESIGN.md 9.16 / prompt ROSTER-1 sección 6: en esta entrega SOLO se
      // activa el rango de convocatoria normal.
      matchSquad: { min: 8, max: 12 },
      sourceRefs: [{
        title: 'ACB — Normas Internas 2025-26 (artículos 15 y 17)',
        url: 'https://www.acb.com/docs/descarga/pdf/transparencia/normas_internas_25-26_180825.pdf',
        retrievedAt: '2026-08-24',
      }],
      // Partes reales del reglamento (mismos artículos 15/17) que la norma
      // oficial sí regula pero ROSTER-1 NO implementa todavía — quedan para
      // REG-1 (cupos/altas) y CONTRACT-1 (vinculados). Declaradas aquí para
      // que ninguna UI/test las dé por activas sin querer.
      notImplemented: [
        'trainingPlayerQuota', // mínimo 3 (8-9 inscritos) / 4 (10-12) de formación
        'nonEuUnionForeignerCap', // máximo 2 extranjeros no comunitarios
        'seasonRegistrationCap', // máximo acumulado de 20 inscripciones/temporada
        'nonCountingSubstitutions', // sustituciones de jugadores no computables
      ],
    },
    'primera-feb-registration-2026-27-v1': {
      id: 'primera-feb-registration-2026-27-v1',
      version: 1,
      effectiveSeason: '2026-27',
      status: 'verified',
      competitionId: COMPETITION_IDS.PRIMERA_FEB,
      // DESIGN.md 9.16 / prompt ROSTER-1 sección 6: convocatoria normal
      // 10-12 (plantilla inscrita 8-12, pero acta mínima real de 10).
      matchSquad: { min: 10, max: 12 },
      sourceRefs: [{
        title: 'FEB — Bases de Competición Primera FEB 2026-27 (apartados 2.2 y 2.3)',
        url: 'https://www.feb.es/Documentos/Enlaces/%5B6537%5DBBCC%20Primera%20FEB%2026-27%20-%20Versi%C3%B3n%20Web.pdf',
        retrievedAt: '2026-08-24',
      }],
      // Discrepancia REAL del propio documento oficial (sección 6 del
      // prompt de ROSTER-1): la tabla de 2.2/2.3 incluye una fila
      // "13-15 jugadores" que contradice el máximo de 12 fijado en el texto
      // inmediatamente anterior. Se registra la inconsistencia en vez de
      // resolverla por interpretación propia — 13-15 NUNCA se habilita sin
      // aclaración oficial posterior (se conserva el máximo inequívoco, 12).
      knownSourceInconsistency: 'La tabla de 2.2/2.3 del PDF de Bases 26-27 incluye una fila "13-15 jugadores" '
        + 'que contradice el máximo de 12 fijado en el texto inmediatamente anterior. No habilitado hasta '
        + 'aclaración oficial — se conserva el máximo inequívoco (12).',
      notImplemented: [
        'trainingPlayerQuota', // mínimo 3 (8-9) / 4 (10-12) de formación
        'nonEuUnionForeignerCap', // máximo (no obligatorio) de 2 extranjeros no comunitarios
        'seasonRegistrationCap', // hasta 20 altas en la temporada
        'matchActMinimumTen', // mínimo de 10 disponibles en acta (distinto del rango de inscripción 8-12)
        'registrationDeadlines', // fecha límite general (último día hábil de febrero) + supuestos tasados a marzo
      ],
    },
    // Perfil SOLO DE TEST (ver COMPETITION_IDS.TEST_FICTIONAL arriba).
    'bm-test-fictional-registration-v1': {
      id: 'bm-test-fictional-registration-v1',
      version: 1,
      effectiveSeason: 'test',
      status: 'provisional',
      competitionId: COMPETITION_IDS.TEST_FICTIONAL,
      matchSquad: { min: 6, max: 9 },
      sourceRefs: [],
      notImplemented: [],
    },
  };

  function getRegistrationModule(moduleId) {
    const module_ = REGISTRATION_MODULES[moduleId];
    if (!module_) {
      throw new Error(`CompetitionRules: no existe el módulo de inscripción "${moduleId}" en el catálogo.`);
    }
    return module_;
  }

  // ---------------------------------------------------------------------
  // 4. RulesetBundleCatalog — compone módulos de ámbitos DISTINTOS para una
  //    competición+temporada. `jurisdictionId`/`federationId`/
  //    `collectiveAgreementId` quedan declarados como metadata inerte
  //    (todavía sin RuleModule real detrás, ver `modules.employment: null`)
  //    para fijar la forma que CONTRACT-1 rellenará, sin fingir que ya
  //    existe esa capa (DESIGN.md 9.16, sección 5.2 del prompt).
  // ---------------------------------------------------------------------
  const RULESET_BUNDLES = {
    'acb-domestic-2025-26-v1': {
      id: 'acb-domestic-2025-26-v1',
      version: 1,
      competitionId: COMPETITION_IDS.ACB,
      effectiveSeason: '2025-26',
      jurisdictionId: 'es-professional-sport',
      federationId: 'feb-general',
      collectiveAgreementId: 'acb-abp',
      modules: {
        registration: 'acb-registration-2025-26-v1',
        // Ámbitos todavía SIN ningún módulo real — ausentes explícitamente,
        // nunca simulados con un módulo vacío (CONTRACT-1/MARKET-1/
        // TRANSFER-1/EUROPE-1 los rellenarán uno a uno).
        employment: null,
        market: null,
        transfer: null,
        internationalTransfer: null,
      },
      sourceRefs: [{
        title: 'ACB — Normas Internas 2025-26',
        url: 'https://www.acb.com/docs/descarga/pdf/transparencia/normas_internas_25-26_180825.pdf',
        retrievedAt: '2026-08-24',
      }],
    },
    'primera-feb-domestic-2026-27-v1': {
      id: 'primera-feb-domestic-2026-27-v1',
      version: 1,
      competitionId: COMPETITION_IDS.PRIMERA_FEB,
      effectiveSeason: '2026-27',
      jurisdictionId: 'es-professional-sport',
      federationId: 'feb-general',
      collectiveAgreementId: null,
      modules: {
        registration: 'primera-feb-registration-2026-27-v1',
        employment: null,
        market: null,
        transfer: null,
        internationalTransfer: null,
      },
      sourceRefs: [{
        title: 'FEB — Bases de Competición Primera FEB 2026-27',
        url: 'https://www.feb.es/Documentos/Enlaces/%5B6537%5DBBCC%20Primera%20FEB%2026-27%20-%20Versi%C3%B3n%20Web.pdf',
        retrievedAt: '2026-08-24',
      }],
    },
    'bm-test-fictional-v1': {
      id: 'bm-test-fictional-v1',
      version: 1,
      competitionId: COMPETITION_IDS.TEST_FICTIONAL,
      effectiveSeason: 'test',
      jurisdictionId: null,
      federationId: null,
      collectiveAgreementId: null,
      modules: {
        registration: 'bm-test-fictional-registration-v1',
        employment: null,
        market: null,
        transfer: null,
        internationalTransfer: null,
      },
      sourceRefs: [],
    },
  };

  function findBundlesForCompetition(competitionId) {
    return Object.values(RULESET_BUNDLES).filter((bundle) => bundle.competitionId === competitionId);
  }

  // Resuelve el RulesetBundle para un contexto. `context.bundleId` permite
  // FIJAR (congelar) un bundle concreto — pieza que HARDEN-1 necesitará
  // para congelar `rulesetBundleId`+versión al inicio de cada temporada de
  // una carrera guardada (DESIGN.md 9.16, sección 5.5 del prompt: "evita
  // APIs que solo puedan consultar la última versión y cambien
  // retroactivamente temporadas ya iniciadas"). Sin `bundleId`, se resuelve
  // el de versión más alta para esa competición — nunca el de OTRA
  // competición ni un fallback silencioso.
  function resolveBundle(context) {
    const { competitionId, bundleId } = context;
    getCompetitionDefinition(competitionId); // valida que la competición existe; lanza si no.
    if (bundleId) {
      const bundle = RULESET_BUNDLES[bundleId];
      if (!bundle || bundle.competitionId !== competitionId) {
        throw new Error(
          `CompetitionRules: no existe el bundle "${bundleId}" para la competición "${competitionId}" `
          + '(bundle/version inexistente).',
        );
      }
      return bundle;
    }
    const candidates = findBundlesForCompetition(competitionId);
    if (!candidates.length) {
      throw new Error(`CompetitionRules: la competición "${competitionId}" no tiene ningún RulesetBundle registrado.`);
    }
    return candidates.reduce((best, bundle) => (bundle.version > best.version ? bundle : best), candidates[0]);
  }

  // ---------------------------------------------------------------------
  // 5. Estrategias de composición por tipo de regla (DESIGN.md 9.16,
  //    sección 5.4 del prompt: "no resolver con Object.assign/spread, el
  //    último gana — cada tipo de regla necesita una estrategia semántica").
  //    ROSTER-1 solo tiene overlays numéricos de convocatoria, pero la
  //    forma queda lista para que REG-1/MARKET-1 añadan más estrategias
  //    (unión documental, intersección de ventanas, state machines...) sin
  //    tocar la forma de `resolveRules()`.
  // ---------------------------------------------------------------------
  const MERGE_STRATEGIES = {
    // Mínimos concurrentes: se conserva el mayor (más restrictivo).
    min: (a, b) => Math.max(a, b),
    // Máximos concurrentes: se conserva el menor (más restrictivo).
    max: (a, b) => Math.min(a, b),
  };

  // `overlays`: array de parches `{ matchSquad: { min?, max? } }` — en
  // ROSTER-1 nunca los produce nadie todavía (ninguna competición europea
  // superpuesta implementada), pero el mecanismo de composición real ya
  // existe para EUROPE-1 sin reescribir este resolver.
  function composeSquadRules(baseSquadRules, overlays) {
    return (overlays || []).reduce((acc, overlay) => {
      if (!overlay || !overlay.matchSquad) return acc;
      const patch = overlay.matchSquad;
      return {
        min: patch.min !== undefined ? MERGE_STRATEGIES.min(acc.min, patch.min) : acc.min,
        max: patch.max !== undefined ? MERGE_STRATEGIES.max(acc.max, patch.max) : acc.max,
      };
    }, { ...baseSquadRules });
  }

  // ---------------------------------------------------------------------
  // 6. Capacidades derivadas (DESIGN.md 9.16, sección 5.3 del prompt):
  //    "capacidad para interfaz, política para comportamiento". Se derivan
  //    SIEMPRE de qué módulos/campos están de verdad presentes — nunca se
  //    mantienen a mano en una lista aparte que pueda divergir.
  // ---------------------------------------------------------------------
  function deriveCapabilities(registrationModule) {
    const capabilities = new Set();
    if (registrationModule && registrationModule.matchSquad) {
      capabilities.add('matchSquadSizeLimit');
    }
    // Deliberadamente NO se añaden aquí capacidades de dominios futuros
    // (rightOfFirstRefusal, loanEligible, internationalClearanceRequired...)
    // solo porque el bundle exista — solo aparecerán cuando MARKET-1/
    // LOAN-1/EUROPE-1 registren el RuleModule real correspondiente.
    return capabilities;
  }

  // ---------------------------------------------------------------------
  // 7. Punto de entrada único — recibe CONTEXTO explícito (nunca lee
  //    `state`/variables globales, DESIGN.md 9.16 sección 5.6 del prompt),
  //    usable igual desde game.js (navegador) que desde tests Node.
  // ---------------------------------------------------------------------
  function resolveRules(context) {
    const ctx = context || {};
    const { competitionId, operation } = ctx;
    if (!competitionId) {
      throw new Error('CompetitionRules.resolveRules: falta "competitionId" en el contexto.');
    }

    const bundle = resolveBundle(ctx);
    const registrationModuleId = bundle.modules.registration;
    const registrationModule = registrationModuleId ? getRegistrationModule(registrationModuleId) : null;

    const notImplemented = [];
    ['employment', 'market', 'transfer', 'internationalTransfer'].forEach((domain) => {
      if (!bundle.modules[domain]) notImplemented.push(domain);
    });
    if (registrationModule) {
      registrationModule.notImplemented.forEach((feature) => notImplemented.push(`registration.${feature}`));
    } else {
      notImplemented.push('registration');
    }

    let squadRules = null;
    const sourceRuleIds = [];
    if (registrationModule && registrationModule.matchSquad) {
      squadRules = composeSquadRules(registrationModule.matchSquad, ctx.overlays);
      sourceRuleIds.push(registrationModule.id);
    } else if (operation === 'buildMatchSquad') {
      throw new Error(
        `CompetitionRules: la competición "${competitionId}" no tiene reglas de convocatoria resueltas `
        + `en el bundle "${bundle.id}" (registration.matchSquad ausente).`,
      );
    }

    return {
      competitionId,
      bundleId: bundle.id,
      version: bundle.version,
      effectiveSeason: bundle.effectiveSeason,
      requestedSeasonKey: ctx.seasonKey || null,
      operation: operation || null,
      squadRules,
      capabilities: deriveCapabilities(registrationModule),
      notImplemented,
      trace: { sourceRuleIds, bundleId: bundle.id, version: bundle.version },
    };
  }

  const exportsObj = {
    COMPETITION_IDS,
    competitionIdFromLegacyDivision,
    getCompetitionDefinition,
    listCompetitions,
    getRegistrationModule,
    resolveBundle,
    resolveRules,
    MERGE_STRATEGIES,
    REGISTRATION_MODULES,
    RULESET_BUNDLES,
  };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
