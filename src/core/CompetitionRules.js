// src/core/CompetitionRules.js
// ROSTER-1 (DESIGN.md 9.16) + CONTRACT-1 (DESIGN.md 9.17) — Núcleo
// normativo multi-liga y multi-DOMINIO: identidad de competición, catálogo
// de módulos de reglas versionados y fechados, resolución temporal real por
// temporada/fecha y composición semántica con trazabilidad.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Principio rector (DESIGN.md 9.16/9.17 y CLAUDE.md): ACB y Primera FEB NO
// son el comportamiento universal del motor — son dos competiciones más,
// identificadas por `competitionId`. Nada en este archivo conoce el DOM ni
// `state` de game.js.
//
// CONTRACT-1 añade DOS cosas a este archivo, sin crear un segundo motor de
// política (sección 5.1 del prompt de CONTRACT-1):
//
//  1. **Resolución temporal de verdad (BUG-ROSTER1-01)**: cada RuleModule y
//     RulesetBundle declara su vigencia (`validity`: temporadas y/o fechas)
//     y el resolver selecciona POR LA TEMPORADA/FECHA SOLICITADA — nunca
//     "la versión más alta". Sin coincidencia exacta no hay fallback
//     silencioso: solo un módulo que declare explícitamente
//     `carryForwardUntilSuperseded` continúa, y lo hace con
//     `resolutionMode: 'provisionalCarryForward'`, warning y traza. Una
//     norma con vigencia futura nunca actúa retroactivamente; una
//     `deprecated` puede seguir resolviendo un contrato histórico FIJADO
//     (`pinned`), pero nunca se elige para una firma nueva.
//
//  2. **Dominio `employment` (BUG-ROSTER1-02)**: la ley laboral aplicable
//     NO cuelga de la competición, sino del EMPLEADOR — su país
//     (`employerJurisdictionId`, ver ClubEmploymentContextCatalog.js). Un
//     club puede competir en ACB (organizada en España) y tener su
//     empleador en Andorra (MoraBanc). `CompetitionDefinition.organizerCountry`
//     describe al ORGANIZADOR de la competición y NUNCA debe usarse como
//     jurisdicción laboral.
//
// `resolveRules(context)` sigue siendo el ÚNICO punto de entrada;
// `resolveEmploymentRules(context)` es un wrapper fino que construye
// contexto y delega en él.

(function (global) {
  const LocalDateModule = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/LocalDate.js')
    : global.BasketManager;
  const MoneyModule = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/Money.js')
    : global.BasketManager;

  // Acceso perezoso (mismo patrón que Team.js con Tactics.js): en el
  // navegador estos scripts pueden cargar en cualquier orden.
  function LD() { return LocalDateModule.LocalDate; }
  function MoneyOf() { return MoneyModule.Money; }

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
  // (DESIGN.md 9.16). Ninguna lógica NUEVA debe volver a ramificar sobre
  // '1ª'/'2ª' fuera de este único punto.
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
  //    CONTRACT-1: `country` pasa a llamarse `organizerCountry` para que
  //    ningún código futuro lo confunda con la jurisdicción laboral del
  //    empleador (BUG-ROSTER1-02). Describe QUIÉN organiza la competición.
  // ---------------------------------------------------------------------
  const COMPETITION_DEFINITIONS = {
    [COMPETITION_IDS.ACB]: {
      id: COMPETITION_IDS.ACB,
      name: 'Liga ACB',
      organizerCountry: 'ES',
      organizerId: 'acb',
      federationId: 'feb-general',
      tier: 1,
      legacyDivision: '1ª',
    },
    [COMPETITION_IDS.PRIMERA_FEB]: {
      id: COMPETITION_IDS.PRIMERA_FEB,
      name: 'Primera FEB',
      organizerCountry: 'ES',
      organizerId: 'feb',
      federationId: 'feb-general',
      tier: 2,
      legacyDivision: '2ª',
    },
    [COMPETITION_IDS.TEST_FICTIONAL]: {
      id: COMPETITION_IDS.TEST_FICTIONAL,
      name: '[SOLO TEST] Liga ficticia de prueba',
      organizerCountry: 'XX',
      organizerId: 'bm-test',
      federationId: null,
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
  // 3. Vigencia (`validity`) y selección temporal — CONTRACT-1,
  //    BUG-ROSTER1-01.
  //
  //    Forma canónica de `validity` (misma para módulos y bundles):
  //      {
  //        seasonFrom: '2025-26',        // temporada desde la que rige
  //        seasonTo:   '2025-26'|null,   // última temporada verificada
  //        dateFrom:   'YYYY-MM-DD'|null,// vigencia civil (leyes/SMI)
  //        dateTo:     'YYYY-MM-DD'|null,
  //        carryForwardUntilSuperseded: true|false,
  //      }
  //
  //    `carryForwardUntilSuperseded` es un DATO, no una rama del resolver
  //    (sección 2 del prompt de CONTRACT-1): declara si esa norma puede
  //    seguir aplicándose provisionalmente más allá de su vigencia
  //    verificada mientras no exista una posterior.
  // ---------------------------------------------------------------------
  const RESOLUTION_MODES = {
    EXACT: 'exact',
    PINNED: 'pinned',
    PROVISIONAL_CARRY_FORWARD: 'provisionalCarryForward',
  };

  function buildValidity(spec) {
    const v = spec || {};
    return {
      seasonFrom: v.seasonFrom || null,
      seasonTo: v.seasonTo !== undefined ? v.seasonTo : null,
      dateFrom: v.dateFrom || null,
      dateTo: v.dateTo !== undefined ? v.dateTo : null,
      carryForwardUntilSuperseded: Boolean(v.carryForwardUntilSuperseded),
    };
  }

  // ¿La vigencia declarada CUBRE EXACTAMENTE la temporada/fecha pedida?
  function coversExactly(validity, request) {
    const { seasonKey, date } = request;
    if (seasonKey && validity.seasonFrom) {
      if (LD().compareSeasonKeys(seasonKey, validity.seasonFrom) < 0) return false;
      if (validity.seasonTo && LD().compareSeasonKeys(seasonKey, validity.seasonTo) > 0) return false;
    }
    if (date && (validity.dateFrom || validity.dateTo)) {
      if (!LD().isWithinInclusive(date, validity.dateFrom, validity.dateTo)) return false;
    }
    // Sin `seasonTo` ni `dateTo` la norma es de vigencia abierta: cubre
    // exactamente cualquier momento posterior a su inicio.
    return true;
  }

  // ¿La petición es ANTERIOR al inicio de vigencia? (una norma futura nunca
  // puede actuar retroactivamente).
  function isRequestBeforeValidity(validity, request) {
    const { seasonKey, date } = request;
    if (seasonKey && validity.seasonFrom && LD().compareSeasonKeys(seasonKey, validity.seasonFrom) < 0) return true;
    if (date && validity.dateFrom && LD().isBefore(date, validity.dateFrom)) return true;
    return false;
  }

  // ¿La petición es POSTERIOR al final de vigencia verificada?
  function isRequestAfterValidity(validity, request) {
    const { seasonKey, date } = request;
    if (seasonKey && validity.seasonTo && LD().compareSeasonKeys(seasonKey, validity.seasonTo) > 0) return true;
    if (date && validity.dateTo && LD().isAfter(date, validity.dateTo)) return true;
    return false;
  }

  function validityLabel(validity) {
    const seasonPart = validity.seasonFrom
      ? `${validity.seasonFrom}${validity.seasonTo ? `..${validity.seasonTo}` : '..(abierta)'}`
      : '(sin temporada declarada)';
    const datePart = validity.dateFrom || validity.dateTo
      ? ` [${validity.dateFrom || '…'} .. ${validity.dateTo || '…'}]` : '';
    return `${seasonPart}${datePart}`;
  }

  // Selección temporal genérica, usada IGUAL por bundles de competición y
  // por módulos laborales. Nunca devuelve "el de versión más alta" sin
  // comprobar vigencia (ese era exactamente BUG-ROSTER1-01).
  //
  // `request`: { seasonKey, date, operation, pinnedId, label }
  function selectByValidity(candidates, request) {
    const label = request.label || 'norma';
    const list = candidates || [];
    if (request.pinnedId) {
      const pinned = list.find((c) => c.id === request.pinnedId);
      if (!pinned) {
        throw new Error(
          `CompetitionRules: la ${label} fijada "${request.pinnedId}" no existe o no es compatible con el `
          + 'contexto solicitado (bundle/módulo/versión inexistente).',
        );
      }
      // Una versión FIJADA se conserva EXACTAMENTE mientras exista —
      // incluso `deprecated` (contrato histórico ya firmado bajo ella).
      const warnings = [];
      if (pinned.status === 'deprecated') {
        warnings.push(
          `La ${label} "${pinned.id}" está marcada como deprecated: solo puede usarse para resolver un `
          + 'compromiso histórico ya fijado, nunca para una firma nueva.',
        );
      }
      return { entity: pinned, resolutionMode: RESOLUTION_MODES.PINNED, warnings };
    }

    if (!list.length) {
      throw new Error(`CompetitionRules: no hay ninguna ${label} registrada para el contexto solicitado.`);
    }

    // Una norma `deprecated` o `reference-only` NUNCA se autoselecciona.
    const selectable = list.filter((c) => c.status !== 'deprecated' && c.status !== 'reference-only');

    const exact = selectable.filter((c) => coversExactly(c.validity, request) && !isRequestBeforeValidity(c.validity, request));
    if (exact.length) {
      const chosen = exact.reduce((best, c) => (c.version > best.version ? c : best), exact[0]);
      return { entity: chosen, resolutionMode: RESOLUTION_MODES.EXACT, warnings: [] };
    }

    // Sin coincidencia exacta: SOLO continúa quien lo declara en datos.
    const carryForward = selectable.filter((c) => (
      c.validity.carryForwardUntilSuperseded
      && !isRequestBeforeValidity(c.validity, request)
      && isRequestAfterValidity(c.validity, request)
    ));
    if (carryForward.length) {
      const chosen = carryForward.reduce((best, c) => {
        const bestSeason = best.validity.seasonTo || best.validity.seasonFrom || '';
        const cSeason = c.validity.seasonTo || c.validity.seasonFrom || '';
        if (cSeason && bestSeason && cSeason !== bestSeason) {
          return LD().compareSeasonKeys(cSeason, bestSeason) > 0 ? c : best;
        }
        return c.version > best.version ? c : best;
      }, carryForward[0]);
      return {
        entity: chosen,
        resolutionMode: RESOLUTION_MODES.PROVISIONAL_CARRY_FORWARD,
        warnings: [
          `Continuidad provisional: la ${label} "${chosen.id}" (vigencia declarada ${validityLabel(chosen.validity)}) `
          + `se aplica a ${request.seasonKey || request.date} porque declara carryForwardUntilSuperseded y no existe `
          + 'una norma posterior. No está verificada para ese periodo.',
        ],
      };
    }

    const futureOnly = selectable.filter((c) => isRequestBeforeValidity(c.validity, request));
    if (futureOnly.length === selectable.length && selectable.length > 0) {
      throw new Error(
        `CompetitionRules: la ${label} más antigua registrada empieza a regir en `
        + `${validityLabel(futureOnly[0].validity)} — una norma de vigencia futura nunca se aplica `
        + `retroactivamente a ${request.seasonKey || request.date}.`,
      );
    }

    throw new Error(
      `CompetitionRules: ninguna ${label} registrada cubre ${request.seasonKey || request.date || '(sin temporada ni fecha)'} `
      + 'y ninguna declara carryForwardUntilSuperseded — no se aplica ningún fallback silencioso.',
    );
  }

  // ---------------------------------------------------------------------
  // 4. RuleModuleCatalog — dominio `registration` (ROSTER-1 + REG-1,
  //    DESIGN.md 9.18).
  //
  //    REG-1 amplía el módulo de inscripción con los campos de la sección 9
  //    del prompt de REG-1 (quotaTables, nonCommunityCap,
  //    cumulativeRegistrationCap, onCourtConstraints, submissionWindows,
  //    documentRequirements, provisionalAuthorizationPolicy,
  //    registrationEffectiveWhen, ownLowerCategoryRules,
  //    additionalListRules, linkedPlayerRules,
  //    sameRoundMultiClubRestrictions, statusRestrictions). No todos los
  //    módulos declaran todos los campos — las capacidades se DERIVAN de
  //    qué campos están de verdad presentes (ver
  //    deriveRegistrationCapabilities más abajo), nunca de una lista
  //    aparte que pueda desincronizarse.
  //
  //    `matchSquad` sigue siendo el rango del ACTA de partido (lo que ya
  //    consumía `Team.buildMatchSquad()` desde ROSTER-1) — REG-1 NO lo
  //    renombra para no romper compatibilidad. `activeRosterRange` es un
  //    campo NUEVO y DISTINTO: el rango de plantilla ACTIVA de temporada
  //    (Primera FEB los declara con anchura distinta al acta: 8-12 de
  //    plantilla activa vs. 10-12 de acta — ver sección 5.2 del prompt de
  //    REG-1).
  // ---------------------------------------------------------------------
  const REGISTRATION_MODULES = {
    'acb-registration-2025-26-v1': {
      id: 'acb-registration-2025-26-v1',
      domain: 'registration',
      familyId: 'acb-registration',
      version: 2,
      status: 'verified',
      competitionId: COMPETITION_IDS.ACB,
      // CONTRACT-1 (BUG-ROSTER1-01): vigencia explícita. La temporada
      // verificada es 2025-26; su continuidad a temporadas posteriores es
      // un DATO declarado aquí (no una excepción del resolver) y se
      // resuelve como `provisionalCarryForward` con warning y traza.
      validity: buildValidity({
        seasonFrom: '2025-26', seasonTo: '2025-26', carryForwardUntilSuperseded: true,
      }),
      // Acta de partido (8-12) y plantilla activa de temporada: en ACB son
      // el MISMO rango (a diferencia de Primera FEB) — Normas Internas
      // 2025-26, art. 15/17: "en cada jornada hay entre 8 y 12 jugadores
      // activos".
      matchSquad: { min: 8, max: 12 },
      activeRosterRange: { min: 8, max: 12 },
      // Bandas de cupo de formación (REG-1, art. 15/17 Normas Internas):
      // aplican TANTO a la plantilla activa como al acta, porque ambas
      // comparten el mismo rango 8-12 en ACB.
      quotaBands: [
        { rosterMin: 8, rosterMax: 9, formationMinimum: 3 },
        { rosterMin: 10, rosterMax: 12, formationMinimum: 4 },
      ],
      nonCommunityCap: { max: 2, scope: ['activeRoster', 'matchAct'] },
      // Máximo acumulado de inscripciones de la temporada — los jugadores
      // propios de categorías inferiores y los vinculados NO computan aquí
      // (sección 4 del prompt de REG-1, "deuda de integración").
      cumulativeRegistrationCap: {
        max: 20,
        nonCountingCategories: ['own-lower-category', 'linked'],
      },
      // ACB no tiene regla de formación EN PISTA (a diferencia de Primera
      // FEB) — capacidad ausente a propósito, nunca `null` engañoso.
      onCourtConstraints: null,
      // Franjas ordinarias de alta (art. 17): desde el 1 de septiembre,
      // corte a las 14:00 del mismo día si es laborable, o 14:00 del día
      // hábil anterior si el partido cae en festivo/sábado/domingo. Hora
      // PENINSULAR explícita (Europe/Madrid) — nunca medianoche UTC
      // implícita (sección 6.5 del prompt de REG-1).
      submissionWindows: [{
        id: 'acb-ordinary-window',
        appliesFromDate: '2026-09-01',
        cutoff: { time: '14:00', timeZone: 'Europe/Madrid', businessDayRule: 'sameDayIfBusiness-elsePriorBusinessDay' },
        note: 'Corte a las 14:00 del mismo día si el partido es laborable; 14:00 del día hábil anterior si es festivo/sábado/domingo.',
      }, {
        id: 'acb-playoff-window',
        // Ventana especial declarada como DATO (sección 5.1 del prompt de
        // REG-1): entre el fin de la liga regular y el primer partido de
        // playoff se permite UNA nueva inscripción si el club no ha
        // llegado a las 20 — RegistrationService la evalúa por fase
        // (`phaseId`), nunca por fecha calendario suelta.
        appliesToPhaseId: 'title-playoff',
        allowsOneAdditionalRegistrationIfBelowCap: true,
      }],
      // El acta se configura entre 2h y 1h antes; los activos de la
      // jornada, hasta 2h antes (art. 17).
      matchDaySelectionWindow: { activeRosterCutoffMinutesBeforeTipOff: 120 },
      matchActConfigurationWindow: { fromMinutesBeforeTipOff: 120, toMinutesBeforeTipOff: 60 },
      documentRequirements: [
        'identity-document', 'medical-clearance', 'player-federation-request',
        'club-federation-request', 'contract-copy', 'photograph',
      ],
      provisionalAuthorizationPolicy: {
        requiresFederationValidation: true,
        // Art. 15.5: documentos imprescindibles — nunca se omiten para la
        // autorización provisional, aunque el resto de trámite quede
        // pendiente.
        mandatoryDocumentCodes: ['identity-document', 'medical-clearance', 'contract-copy'],
        newPlayerMatchDayException: true,
      },
      // Una inscripción surte efecto cuando ACB valida la documentación
      // (excepción reglada de nuevos jugadores incorporados al acta, ver
      // `provisionalAuthorizationPolicy.newPlayerMatchDayException`).
      registrationEffectiveWhen: 'onFederationValidation',
      ownLowerCategoryRules: {
        allowed: true,
        countsTowardCumulativeCap: false,
        note: 'Jugadores propios de categorías inferiores: artefacto regulatorio distinto de la plantilla senior.',
      },
      additionalListRules: {
        allowed: true,
        note: 'Nuevos jugadores presentados y validados en plazo (excepción del art. 15.5), además de los inscritos ordinarios.',
      },
      // Vinculación (REG-1, sección 5.4 del prompt): hasta 4 vinculados
      // senior sub-22 del club vinculado, bajo relación/lista autorizadas
      // de la temporada. La especialidad ACB puede actualizar su relación
      // de elegibles dentro de su ventana — declarado como OVERLAY
      // explícito (`allowsWindowUpdate`), nunca "el último objeto gana".
      linkedPlayerRules: {
        maxLinkedSeniorSubU22FromLowerClub: 4,
        ageCategory: 'sub-22',
        citizenshipRequirement: 'community-or-equal-treatment',
        allowsWindowUpdateOverlay: true,
        ineffectiveIfSameCompetitionAsLinkedClub: true,
        notCountingTowardCumulativeCap: true,
      },
      sameRoundMultiClubRestrictions: {
        enabled: true,
        // ACB, Copa y Playoff por el título COMPARTEN ámbito de inscripción
        // porque las Normas Internas ACB se aplican a las tres — DATO
        // declarado en el bundle (`registrationScopeId`), nunca deducido
        // por ser el equipo de Primera División (BUG-CONTRACT1-02).
        note: 'Un jugador no puede figurar en el acta de dos clubes ACB en la misma jornada.',
      },
      statusRestrictions: {
        // Bajas por lesión/enfermedad, contrato suspendido o sanción de
        // suspensión: no ocupan el máximo simultáneo y permiten
        // sustitución, pero la baja/sustitución es SIEMPRE un evento
        // regulatorio explícito (nunca derivado automáticamente de
        // Medical.js — sección 5.1 del prompt de REG-1).
        nonSimultaneousStatuses: ['injury-or-illness', 'contract-suspended', 'disciplinary-suspension'],
        requiresExplicitEvent: true,
      },
      matchActRange: { min: 8, max: 12 },
      sourceRefs: [{
        title: 'ACB — Normas Internas 2025-26 (artículos 15 y 17)',
        url: 'https://www.acb.com/docs/descarga/pdf/transparencia/normas_internas_25-26_180825.pdf',
        retrievedAt: '2026-08-26',
      }, {
        title: 'CSD — Resolución de 16 de julio de 2014 (cupos, BOE-A-2014-7597)',
        url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2014-7597',
        retrievedAt: '2026-08-26',
      }],
      notImplemented: [
        'realTimeFederationValidationWorkflow', // el trámite real de validación FEB/ACB queda fuera de alcance
      ],
    },
    'primera-feb-registration-2026-27-v1': {
      id: 'primera-feb-registration-2026-27-v1',
      domain: 'registration',
      familyId: 'primera-feb-registration',
      version: 2,
      status: 'verified',
      competitionId: COMPETITION_IDS.PRIMERA_FEB,
      validity: buildValidity({
        seasonFrom: '2026-27', seasonTo: '2026-27', carryForwardUntilSuperseded: true,
      }),
      // Acta de partido: mínimo 10, máximo 12 (distinto de la plantilla
      // activa 8-12 — sección 5.2 del prompt de REG-1).
      matchSquad: { min: 10, max: 12 },
      matchActRange: { min: 10, max: 12 },
      activeRosterRange: { min: 8, max: 12 },
      quotaBands: [
        { rosterMin: 8, rosterMax: 9, formationMinimum: 3 },
        { rosterMin: 10, rosterMax: 12, formationMinimum: 4 },
      ],
      nonCommunityCap: { max: 2, scope: ['activeRoster', 'matchAct'] },
      cumulativeRegistrationCap: {
        max: 20,
        nonCountingCategories: ['own-lower-category', 'linked'],
      },
      // Manual de Licencias 2026-27 (regla que NO existe en ACB): al menos
      // dos jugadores de formación en pista durante TODO el tiempo de
      // juego — llega a Rotation.js como política por competición, nunca
      // como un `if (Primera FEB)` (sección 5.2/11.4 del prompt de REG-1).
      onCourtConstraints: { minFormationOnCourtAtAllTimes: 2 },
      submissionWindows: [{
        id: 'primera-feb-ordinary-window',
        cutoff: {
          time: '18:00', timeZone: 'Europe/Madrid', businessDayRule: 'priorBusinessDay',
        },
        weekendCutoff: {
          time: '14:00', timeZone: 'Europe/Madrid', businessDayRule: 'fridayForWeekend',
        },
        note: '18:00 del día hábil anterior; viernes 14:00 para partidos de sábado/domingo; reglas especiales si '
          + 'el viernes es inhábil; determinados festivos locales/regionales de la sede FEB cortan a las 13:00.',
      }],
      finalRegistrationDeadlines: [{
        id: 'primera-feb-february-general-limit',
        cutoff: { time: '14:00', timeZone: 'Europe/Madrid', businessDayRule: 'lastBusinessDayOfMonth', month: 2 },
        note: 'Límite general: 14:00 del último día hábil de febrero.',
      }, {
        id: 'primera-feb-march-restricted-window',
        cutoff: { time: '14:00', timeZone: 'Europe/Madrid', businessDayRule: 'lastBusinessDayOfMonth', month: 3 },
        // Sección 5.5 del prompt: el "31 de marzo de 2026" del Manual es un
        // error de fecha (imposible dentro de la temporada 2026-27); se
        // deriva de la formulación correcta de las Bases (último día hábil
        // de marzo), nunca del literal del Manual.
        restrictedToCategories: ['from-higher-category', 'requires-international-transfer', 'no-feb-license-this-season'],
        note: 'Hasta el último día hábil de marzo SOLO tres categorías: procedencia de categoría superior, '
          + 'operación que exige transfer internacional, o jugador sin licencia FEB esa temporada.',
      }],
      documentRequirements: [
        'identity-document', 'residence-or-work-permit-if-applicable', 'medical-request', 'player-request',
        'release-or-transfer-document', 'contract-copy', 'dues-or-canon-if-applicable', 'photograph',
      ],
      provisionalAuthorizationPolicy: {
        requiresFederationValidation: true,
        mandatoryDocumentCodes: ['identity-document', 'medical-request', 'contract-copy'],
        newPlayerMatchDayException: false,
      },
      registrationEffectiveWhen: 'onFederationValidation',
      ownLowerCategoryRules: { allowed: true, countsTowardCumulativeCap: false },
      additionalListRules: { allowed: false },
      linkedPlayerRules: {
        // RGyC FEB art. 18: hasta 4 comunitarios sub-22 con licencia senior
        // del club INFERIOR hacia el superior, y hasta 5 junior/cadete del
        // club SUPERIOR hacia el inferior — direcciones DISTINTAS, nunca un
        // único número.
        maxLinkedSeniorSubU22FromLowerClub: 4,
        maxLinkedJuniorOrCadeteFromUpperClub: 5,
        ageCategory: 'sub-22-or-junior-cadete',
        citizenshipRequirement: 'community-for-senior-link',
        listsFrozenDuringSeason: true,
        ineffectiveIfSameCompetitionAsLinkedClub: true,
        notCountingTowardCumulativeCap: true,
      },
      sameRoundMultiClubRestrictions: { enabled: true },
      statusRestrictions: {
        nonSimultaneousStatuses: ['injury-or-illness', 'contract-suspended', 'disciplinary-suspension'],
        requiresExplicitEvent: true,
        // Sección 5.2: una nueva alta de un jugador previamente dado de
        // baja por lesión NO exime de recomputar salvo que la relación
        // contractual no se haya interrumpido durante TODO el periodo
        // exigido — se demuestra con el ledger + ContractRegistry, nunca
        // con un booleano manual.
        reactivationExemptionRequiresUninterruptedContract: true,
      },
      // Discrepancias REALES del propio documento oficial (sección 5.5 del
      // prompt de REG-1) — se registran, NUNCA se resuelven por
      // interpretación propia ni se activan.
      knownSourceInconsistencies: [
        'Las Bases de Primera FEB fijan máximo 12 en el texto, pero su propia tabla de 2.2/2.3 incluye una fila '
        + '"13-15 jugadores". No habilitado — se conserva el máximo inequívoco (12).',
        'El Manual de Licencias 2026-27 declara para Primera FEB máximo 15 (con cinco movimientos tras '
        + 'alcanzarlo), mientras las Bases específicas fijan máximo 12 y el acumulado sigue en 20. Gobierna la '
        + 'fuente ESPECÍFICA de competición (Bases): plantilla 8-12, acta 10-12, acumulado 20.',
        'El Manual contiene la fecha "31 de marzo de 2026" dentro de la temporada 2026-27 (imposible: marzo de '
        + '2026 no pertenece a la temporada 2026-27). El límite se deriva de la formulación de las Bases '
        + '("último día hábil de marzo"), nunca de ese literal.',
      ],
      resolutionRationale: 'La fuente ESPECÍFICA de la competición (Bases de Competición Primera FEB 2026-27) '
        + 'gobierna el comportamiento activo sobre el Manual general de Licencias cuando ambas discrepan: '
        + 'plantilla 8-12, acta 10-12, acumulado 20. La fila 13-15 y el máximo 15 del Manual quedan sin activar.',
      matchDaySelectionWindow: { activeRosterCutoffMinutesBeforeTipOff: 120 },
      matchActConfigurationWindow: { fromMinutesBeforeTipOff: 120, toMinutesBeforeTipOff: 60 },
      sourceRefs: [{
        title: 'FEB — Bases de Competición Primera FEB 2026-27 (apartados 2.2 y 2.3)',
        url: 'https://www.feb.es/Documentos/Enlaces/%5B6537%5DBBCC%20Primera%20FEB%2026-27%20-%20Versi%C3%B3n%20Web.pdf',
        retrievedAt: '2026-08-26',
      }, {
        title: 'FEB — Reglamento General y de Competiciones (versión CSD)',
        url: 'https://www.feb.es/Documentos/Enlaces/%5B6692%5DReglamento%20General%20y%20de%20Competiciones%20FEB.%20Version%20CSD%20%28limpio%29.pdf',
        retrievedAt: '2026-08-26',
      }, {
        title: 'FEB — Manual de Expedición de Licencias 2026-27',
        url: 'https://www.feb.es/Documentos/Enlaces/%5B6697%5DMANUAL%20LICENCIAS%202026-2027%20Revisado.pdf',
        retrievedAt: '2026-08-26',
      }, {
        title: 'FEB — Modelo oficial de vinculación',
        url: 'https://www.feb.es/Documentos/Enlaces/%5B5649%5DMODELO%20DE%20VINCULACION.pdf',
        retrievedAt: '2026-08-26',
      }],
      notImplemented: [
        'realTimeFederationValidationWorkflow',
      ],
    },
    // Perfil SOLO DE TEST (ver COMPETITION_IDS.TEST_FICTIONAL arriba).
    'bm-test-fictional-registration-v1': {
      id: 'bm-test-fictional-registration-v1',
      domain: 'registration',
      familyId: 'bm-test-fictional-registration',
      version: 1,
      status: 'provisional',
      competitionId: COMPETITION_IDS.TEST_FICTIONAL,
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null, carryForwardUntilSuperseded: true }),
      matchSquad: { min: 6, max: 9 },
      activeRosterRange: { min: 6, max: 9 },
      quotaBands: [{ rosterMin: 6, rosterMax: 9, formationMinimum: 1 }],
      nonCommunityCap: { max: 1, scope: ['matchAct'] },
      cumulativeRegistrationCap: { max: 15, nonCountingCategories: [] },
      onCourtConstraints: null,
      sourceRefs: [],
      notImplemented: [],
    },
    // --- Perfiles de referencia (REG-1, sección 5.6 del prompt) — NUNCA
    // activados en una partida real, NUNCA competiciones jugables. Sirven
    // solo para demostrar en tests que el motor admite combinaciones de
    // reglas distintas de ACB/FEB sin tocar Team/Player/EligibilityService/
    // Rotation/CPU/UI: añadir una liga nueva es dato de catálogo.
    'reference-only-max-act-9-v1': {
      id: 'reference-only-max-act-9-v1',
      domain: 'registration',
      familyId: 'reference-only-max-act-9',
      version: 1,
      status: 'reference-only',
      competitionId: COMPETITION_IDS.TEST_FICTIONAL,
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null }),
      matchSquad: { min: 7, max: 9 },
      activeRosterRange: { min: 7, max: 9 },
      quotaBands: [{ rosterMin: 7, rosterMax: 9, formationMinimum: 2 }],
      nonCommunityCap: { max: 2, scope: ['matchAct'] },
      cumulativeRegistrationCap: { max: 18, nonCountingCategories: [] },
      onCourtConstraints: null,
      sourceRefs: [],
      notImplemented: ['everything'],
      derivedInterpretations: ['reference-only: demuestra un acta máxima de 9, nunca activado en una partida real.'],
    },
    'reference-only-max-1-noncommunity-v1': {
      id: 'reference-only-max-1-noncommunity-v1',
      domain: 'registration',
      familyId: 'reference-only-max-1-noncommunity',
      version: 1,
      status: 'reference-only',
      competitionId: COMPETITION_IDS.TEST_FICTIONAL,
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null }),
      matchSquad: { min: 8, max: 12 },
      activeRosterRange: { min: 8, max: 12 },
      quotaBands: [{ rosterMin: 8, rosterMax: 12, formationMinimum: 3 }],
      nonCommunityCap: { max: 1, scope: ['activeRoster', 'matchAct'] },
      cumulativeRegistrationCap: { max: 20, nonCountingCategories: [] },
      onCourtConstraints: null,
      sourceRefs: [],
      notImplemented: ['everything'],
      derivedInterpretations: ['reference-only: demuestra un máximo de 1 no comunitario, nunca activado en una partida real.'],
    },
    'reference-only-u22-development-v1': {
      id: 'reference-only-u22-development-v1',
      domain: 'registration',
      familyId: 'reference-only-u22-development',
      version: 1,
      status: 'reference-only',
      competitionId: COMPETITION_IDS.TEST_FICTIONAL,
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null }),
      // Competición de formación/U22 con plantilla simultánea 12-20, cupo
      // de formación distinto y máximo acumulado 25 — inspirada en las
      // referencias inactivas de Segunda/Tercera FEB y Liga U22 del Manual
      // FEB 2026-27 (sección 5.6 del prompt), NUNCA jugable en esta partida.
      matchSquad: { min: 10, max: 15 },
      activeRosterRange: { min: 12, max: 20 },
      quotaBands: [{ rosterMin: 12, rosterMax: 20, formationMinimum: 8 }],
      nonCommunityCap: { max: 3, scope: ['activeRoster'] },
      cumulativeRegistrationCap: { max: 25, nonCountingCategories: ['own-lower-category'] },
      onCourtConstraints: null,
      sourceRefs: [{
        title: 'FEB — Manual de Expedición de Licencias 2026-27 (referencias Segunda/Tercera FEB y Liga U22)',
        url: 'https://www.feb.es/Documentos/Enlaces/%5B6697%5DMANUAL%20LICENCIAS%202026-2027%20Revisado.pdf',
        retrievedAt: '2026-08-26',
      }],
      notImplemented: ['everything'],
      derivedInterpretations: ['reference-only: plantilla 12-20/cupo 25, nunca activado en una partida real.'],
    },
    'reference-only-international-scope-v1': {
      id: 'reference-only-international-scope-v1',
      domain: 'registration',
      familyId: 'reference-only-international-scope',
      version: 1,
      status: 'reference-only',
      competitionId: COMPETITION_IDS.TEST_FICTIONAL,
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null }),
      // Ámbito de inscripción y fecha límite PROPIOS de una competición
      // internacional — el calendario público ELPA/EuroLeague 2025-26 fija
      // el 25 de febrero como límite de altas (sección 5.6 del prompt).
      // NUNCA se activa EuroLeague ni ninguna liga extranjera (EUROPE-1).
      matchSquad: { min: 10, max: 12 },
      activeRosterRange: { min: 10, max: 14 },
      quotaBands: [],
      nonCommunityCap: null,
      cumulativeRegistrationCap: null,
      onCourtConstraints: null,
      finalRegistrationDeadlines: [{
        id: 'reference-only-euroleague-style-deadline',
        cutoff: { date: '2027-02-25', time: '23:59', timeZone: 'Europe/Madrid' },
        note: 'Inspirado en el límite de altas del calendario público ELPA/EuroLeague 2025-26 (25 de febrero).',
      }],
      sourceRefs: [{
        title: 'ELPA — Calendario EuroLeague 2025-26 (referencia pública de fecha límite de altas)',
        url: 'https://elpa.basketball/calendar/',
        retrievedAt: '2026-08-26',
      }],
      notImplemented: ['everything'],
      derivedInterpretations: ['reference-only: ámbito internacional con fecha límite propia, nunca activado en una partida real.'],
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
  // 5. RuleModuleCatalog — dominio `employment` (CONTRACT-1).
  //
  //    CAPAS (`layer`), de menos a más específica:
  //      - 'global-sport'                  : FIBA (convive con la ley nacional)
  //      - 'national-statutory'            : ley laboral del país del EMPLEADOR
  //      - 'national-minimum-wage'         : salario mínimo del país, POR FECHA
  //      - 'national-minor-protection'     : normas de menores del país
  //      - 'collective-agreement-membership': convenio/normativa de la
  //        competición — NUNCA sustituye la ley del país del empleador.
  //
  //    Cada módulo declara su ámbito (`scope`), su vigencia (`validity`),
  //    su estado de certeza (`status`), sus fuentes (`sourceRefs`), lo que
  //    NO implementa (`notImplemented`) y, cuando procede, qué partes son
  //    lectura del proyecto y no texto literal (`derivedInterpretations`).
  //
  //    IMPORTANTE: ningún módulo `reference-only` se activa nunca por sí
  //    solo — solo puede usarse fijándolo explícitamente en un fixture.
  // ---------------------------------------------------------------------
  const EUR = 'EUR';

  const EMPLOYMENT_MODULES = {
    // --- Capa global de baloncesto profesional ---------------------------
    'fiba-book3-2026-v1': {
      id: 'fiba-book3-2026-v1',
      domain: 'employment',
      familyId: 'fiba-book3',
      layer: 'global-sport',
      version: 1,
      status: 'verified',
      scope: { jurisdictionIds: null, competitionIds: null, personalScope: 'professional-basketball-player' },
      validity: buildValidity({ seasonFrom: '2026-27', seasonTo: null, dateFrom: '2026-04-22', carryForwardUntilSuperseded: true }),
      rules: {
        // Tope deportivo global de duración contractual.
        maxTermYears: 4,
        requiresWrittenForm: true,
        requiredContractFields: ['parties', 'term', 'remuneration'],
      },
      sourceRefs: [{
        title: 'FIBA — Internal Regulations, Book 3 (Players and Officials), edición en vigor desde 22-04-2026',
        url: 'https://assets.fiba.basketball/image/upload/documents-corporate-fiba-regulations-internal-regulations-book-3.pdf',
        retrievedAt: '2026-08-26',
        articles: ['duración máxima de contrato', 'forma escrita', 'representación de jugadores'],
      }],
      knownSourceInconsistencies: [],
      // FIBA NO es una jurisdicción laboral: es una capa deportiva que
      // convive con la ley nacional y el convenio aplicable.
      notImplemented: [
        'playerAgentMandate', // mandato máximo de 2 años — documentado para MARKET-1
        'playerAgentCommissionCap', // límite de comisión — MARKET-1
        'letterOfClearance', // transfer internacional — EUROPE-1
      ],
      derivedInterpretations: [],
    },

    // --- España: ley laboral del deportista profesional ------------------
    'es-rd1006-1985-v1': {
      id: 'es-rd1006-1985-v1',
      domain: 'employment',
      familyId: 'es-sport-labour-statute',
      layer: 'national-statutory',
      version: 1,
      status: 'verified',
      scope: { jurisdictionIds: ['ES'], competitionIds: null, personalScope: 'professional-sportsperson' },
      validity: buildValidity({ seasonFrom: '1985-86', seasonTo: null, dateFrom: '1985-08-12', carryForwardUntilSuperseded: true }),
      rules: {
        requiresWrittenForm: true,
        requiredContractFields: ['parties', 'object', 'remuneration', 'startDate', 'endDate'],
        requiredDocuments: ['written-contract'],
        // Duración determinada; las prórrogas exigen acuerdo sucesivo (de
        // ahí que la renovación AUTOMÁTICA quede prohibida, ver
        // derivedInterpretations).
        requiresFixedTerm: true,
        // Máximo legal general de periodo de prueba: tres meses. Una capa
        // aplicable puede imponer uno MENOR (estrategia `min`).
        probationPolicy: { type: 'fixed', maxDays: 90 },
        // El salario puede ser en dinero o en especie; qué componentes
        // cuentan para un mínimo lo decide cada capa que fije ese mínimo.
        salaryInKindAllowed: true,
        allowedCurrencies: [EUR],
        allowedBases: ['gross'],
        paymentFrequency: 'monthly',
        clausePolicy: {
          'player-release': 'allowed',
          'automatic-renewal': 'forbidden',
        },
      },
      sourceRefs: [{
        title: 'España — Real Decreto 1006/1985, relación laboral especial de los deportistas profesionales (texto consolidado)',
        url: 'https://www.boe.es/buscar/pdf/1985/BOE-A-1985-12313-consolidado.pdf',
        retrievedAt: '2026-08-26',
        articles: ['forma escrita y contenido mínimo', 'duración determinada y prórrogas', 'retribución (dinero y especie)', 'periodo de prueba'],
      }],
      knownSourceInconsistencies: [],
      notImplemented: [
        'temporaryAssignmentProcedure', // cesión temporal — LOAN-1
        'transferCompensation', // compensación por transferencia — TRANSFER-1
        'terminationIndemnityCalculation', // extinción e indemnizaciones — TRANSFER-1
        'imageRightsTaxTreatment', // sin motor fiscal en CONTRACT-1
      ],
      derivedInterpretations: [
        'clausePolicy["automatic-renewal"] = forbidden es LECTURA DEL PROYECTO de la exigencia de prórroga '
        + 'por acuerdo sucesivo (duración determinada), no una prohibición literal del texto.',
      ],
    },

    // --- España: salario mínimo interprofesional, POR FECHA ---------------
    'es-smi-2026-v1': {
      id: 'es-smi-2026-v1',
      domain: 'employment',
      familyId: 'es-minimum-wage',
      layer: 'national-minimum-wage',
      version: 1,
      status: 'verified',
      scope: { jurisdictionIds: ['ES'], competitionIds: null, personalScope: 'employee' },
      // Vigencia CIVIL acotada al año natural 2026: una temporada deportiva
      // cruza dos años naturales, así que este módulo se resuelve POR FECHA.
      // Su continuidad más allá de 2026 es provisional y trazada (nunca una
      // constante eterna).
      validity: buildValidity({
        seasonFrom: '2025-26', seasonTo: null, dateFrom: '2026-01-01', dateTo: '2026-12-31', carryForwardUntilSuperseded: true,
      }),
      rules: {
        minimumSalary: {
          monthlyAmountMinor: 122100, // 1.221,00 EUR/mes
          annualAmountMinor: 1709400, // 17.094,00 EUR/año
          currency: EUR,
          basis: 'gross',
          // La retribución en especie NO puede reducir el mínimo monetario.
          countingComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'],
          inKindCanReduceCashMinimum: false,
        },
      },
      sourceRefs: [{
        title: 'España — Real Decreto 126/2026, salario mínimo interprofesional para 2026',
        url: 'https://www.boe.es/eli/es/rd/2026/02/18/126',
        retrievedAt: '2026-08-26',
        articles: ['cuantía del SMI 2026', 'reglas de afectación'],
      }],
      knownSourceInconsistencies: [],
      notImplemented: ['proRataForPartialYearEmployment'],
      derivedInterpretations: [
        'El mínimo ANUAL se compara contra la remuneración monetaria garantizada de la temporada; el '
        + 'prorrateo por alta/baja parcial dentro del año natural queda notImplemented.',
      ],
    },

    // --- España: menores ---------------------------------------------------
    'es-workers-statute-minors-v1': {
      id: 'es-workers-statute-minors-v1',
      domain: 'employment',
      familyId: 'es-minor-protection',
      layer: 'national-minor-protection',
      version: 1,
      status: 'verified',
      scope: { jurisdictionIds: ['ES'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({ seasonFrom: '2015-16', seasonTo: null, dateFrom: '2015-10-24', carryForwardUntilSuperseded: true }),
      rules: {
        minorRules: {
          minimumWorkingAge: 16,
          consentRequiredUpToAge: 17, // 16-17 años, salvo emancipación suficiente
          requiredMarkers: ['guardian-consent'],
          prohibitions: ['night-work', 'overtime'],
        },
      },
      sourceRefs: [{
        title: 'España — Estatuto de los Trabajadores (texto refundido, Real Decreto Legislativo 2/2015)',
        url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430',
        retrievedAt: '2026-08-26',
        articles: ['edad mínima de admisión al trabajo', 'trabajo nocturno y horas extraordinarias de menores'],
      }],
      knownSourceInconsistencies: [],
      notImplemented: ['minorPublicPerformanceAuthorization'],
      derivedInterpretations: [],
    },

    // --- ACB/ABP: convenio colectivo, capa de COMPETICIÓN (provisional) ---
    'acb-abp-cba-2018-22-operational-provisional-v1': {
      id: 'acb-abp-cba-2018-22-operational-provisional-v1',
      domain: 'employment',
      familyId: 'acb-collective-agreement',
      layer: 'collective-agreement-membership',
      version: 1,
      // NUNCA 'verified' para 2026-27: su periodo formal publicado terminó
      // el 30-06-2022. Hay evidencia operativa de que ACB sigue utilizando
      // su procedimiento (tanteo), pero eso no verifica sus importes ni sus
      // condiciones laborales para hoy.
      status: 'provisional',
      scope: { jurisdictionIds: null, competitionIds: [COMPETITION_IDS.ACB], personalScope: 'acb-registered-player' },
      // Ámbito TERRITORIAL del convenio: España. Para un club cuyo empleador
      // está fuera (MoraBanc/AD) solo puede actuar como capa de MEMBRESÍA de
      // la competición, y únicamente sobre las reglas declaradas abajo —
      // jamás sustituyendo la ley del país del empleador.
      territorialJurisdictionIds: ['ES'],
      membershipScope: {
        appliesOutsideTerritory: true,
        ruleKeys: ['requiresWrittenForm', 'requiredDocuments', 'paymentInstallmentRange', 'allowedBases', 'remunerationComponents'],
      },
      validity: buildValidity({
        seasonFrom: '2018-19', seasonTo: '2021-22', dateTo: '2022-06-30', carryForwardUntilSuperseded: true,
      }),
      rules: {
        requiresWrittenForm: true,
        requiredDocuments: ['written-contract', 'competition-deposit-copy'],
        requiresFixedTerm: true,
        // Periodo de prueba máximo de UN MES (más restrictivo que el máximo
        // general de tres meses del RD 1006 — la composición se queda con
        // el MENOR).
        probationPolicy: { type: 'fixed', maxDays: 30 },
        minimumSalary: {
          annualAmountMinor: 2800000, // 28.000,00 EUR brutos (mínimo histórico publicado)
          currency: EUR,
          basis: 'gross',
          countingComponents: ['guaranteedBaseSalary', 'guaranteedImageRights', 'guaranteedSalaryInKind'],
          inKindCanReduceCashMinimum: true,
        },
        // Salario de temporada pagado por defecto en DIEZ mensualidades
        // consecutivas, con posibilidad prevista de ocho a doce.
        paymentInstallmentRange: { min: 8, max: 12, default: 10 },
        paymentFrequency: 'monthly',
        allowedBases: ['gross'],
        remunerationComponents: ['guaranteedBaseSalary', 'guaranteedImageRights', 'guaranteedSalaryInKind', 'variableBonuses'],
        mandatoryBenefits: ['disability-coverage', 'sports-insurance'],
        clausePolicy: {
          'player-release': 'allowed', // indemnización de salida del jugador prevista en el contrato tipo
        },
      },
      sourceRefs: [
        {
          title: 'España — IV Convenio colectivo ACB–ABP (BOE-A-2021-4226)',
          url: 'https://www.boe.es/buscar/doc.php?id=BOE-A-2021-4226',
          retrievedAt: '2026-08-26',
          articles: ['forma y duración del contrato', 'periodo de prueba', 'retribución y mínimo', 'número de mensualidades', 'contrato tipo y coberturas'],
        },
        {
          title: 'ACB — Jugadores sujetos al derecho de tanteo (evidencia operativa del procedimiento del IV Convenio)',
          url: 'https://www.acb.com/es/liga/noticias/jugadores-sujetos-al-derecho-de-tanteo-145528',
          retrievedAt: '2026-08-26',
          articles: ['uso operativo vigente del procedimiento de tanteo'],
        },
      ],
      knownSourceInconsistencies: [
        'El periodo formal publicado del IV Convenio terminó el 30-06-2022, pero ACB sigue utilizando '
        + 'operativamente su procedimiento de tanteo en 2026. Eso NO verifica automáticamente sus importes '
        + 'ni sus condiciones laborales para 2026-27: el módulo se aplica como continuidad PROVISIONAL, '
        + 'con warning visible, y su mínimo de 28.000 EUR no se presenta como dato legal actualizado.',
      ],
      notImplemented: [
        'rightOfFirstRefusalProcedure', // tanteo = máquina de estados — MARKET-1
        'qualifyingOfferRules', // MARKET-1
        'disabilityInsuranceAmounts', // importes concretos de coberturas
        'exitIndemnityCalculation', // TRANSFER-1
      ],
      derivedInterpretations: [],
    },

    // --- Andorra: relaciones laborales -------------------------------------
    'ad-labour-31-2018-v1': {
      id: 'ad-labour-31-2018-v1',
      domain: 'employment',
      familyId: 'ad-labour-statute',
      layer: 'national-statutory',
      version: 1,
      status: 'verified',
      scope: { jurisdictionIds: ['AD'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({ seasonFrom: '2019-20', seasonTo: null, dateFrom: '2019-01-01', carryForwardUntilSuperseded: true }),
      rules: {
        requiresWrittenForm: true,
        requiredContractFields: ['parties', 'object', 'remuneration', 'startDate', 'endDate'],
        requiredDocuments: ['written-contract'],
        requiresFixedTerm: true,
        // Periodo de prueba GENERAL de dos meses. La ley andorrana prevé
        // escalones superiores ligados a múltiplos del salario mínimo: se
        // modela como POLÍTICA EVALUABLE (no una constante), con la tabla de
        // escalones declarada `notImplemented` mientras no exista una fuente
        // exacta — nunca se inventa un umbral.
        probationPolicy: {
          type: 'salary-multiple-tiers',
          baseDays: 60,
          tiers: [], // sin fuente exacta: vacío, NUNCA un umbral inventado
          tiersStatus: 'notImplemented',
        },
        // Pago con periodicidad AL MENOS mensual: un contrato que cubre el
        // año completo se paga en doce mensualidades.
        paymentFrequency: 'monthly',
        paymentInstallmentRange: { min: 12, max: 12, default: 12, scope: 'full-season-contract' },
        salaryInKindAllowed: true,
        // Alojamiento y manutención en especie limitados conforme a la ley
        // (el tope concreto queda notImplemented, ver abajo).
        inKindBenefitLimits: ['accommodation', 'board'],
        allowedCurrencies: [EUR],
        allowedBases: ['gross'],
        minorRules: {
          minimumWorkingAge: 16,
          consentRequiredUpToAge: 17,
          requiredMarkers: ['guardian-consent', 'administrative-authorization', 'medical-certificate'],
          prohibitions: ['night-work', 'overtime'],
        },
      },
      sourceRefs: [{
        title: 'Andorra — Llei 31/2018, de relacions laborals (text consolidat)',
        url: 'https://www.portaljuridicandorra.ad/L2018031_11',
        retrievedAt: '2026-08-26',
        articles: ['forma escrita del contracte', 'període de prova', 'contractes de durada determinada i de temporada', 'periodicitat del pagament', 'salari en espècie', 'treball de menors'],
      }],
      knownSourceInconsistencies: [],
      notImplemented: [
        'probationSalaryMultipleTiers', // escalones por múltiplo salarial — sin fuente exacta
        'inKindBenefitCapAmounts', // topes concretos de alojamiento/manutención
        'seasonalContractSpecificRegime', // régimen específico completo del contrato de temporada
      ],
      derivedInterpretations: [
        'paymentInstallmentRange 12/12 es la traducción de "periodicitat almenys mensual" a un contrato que '
        + 'cubre el año completo — no un número de mensualidades fijado literalmente por la ley.',
      ],
    },

    // --- Andorra: salario mínimo desde 01-07-2026 --------------------------
    'ad-smi-2026-07-v1': {
      id: 'ad-smi-2026-07-v1',
      domain: 'employment',
      familyId: 'ad-minimum-wage',
      layer: 'national-minimum-wage',
      version: 1,
      status: 'verified',
      scope: { jurisdictionIds: ['AD'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({
        seasonFrom: '2026-27', seasonTo: null, dateFrom: '2026-07-01', carryForwardUntilSuperseded: true,
      }),
      rules: {
        minimumSalary: {
          monthlyAmountMinor: 156867, // 1.568,67 EUR/mes
          hourlyAmountMinor: 905, // 9,05 EUR/hora
          annualAmountMinor: 1882404, // 12 x 1.568,67 EUR
          currency: EUR,
          basis: 'gross',
          countingComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'],
          inKindCanReduceCashMinimum: false,
        },
      },
      sourceRefs: [{
        title: 'Andorra — Increment extraordinari del salari mínim fins als 1.568,67 EUR mensuals (des de 01-07-2026)',
        url: 'https://www.govern.ad/ca/w/el-govern-aprova-un-increment-extraordinari-del-salari-minim-del-2-8-fins-als-1-568-67-euros-mensuals',
        retrievedAt: '2026-08-26',
        articles: ['import mensual', 'import per hora', 'data d’entrada en vigor'],
      }],
      knownSourceInconsistencies: [],
      notImplemented: ['hourlyMinimumEnforcement'],
      derivedInterpretations: [
        'El mínimo ANUAL (1.882.404 céntimos) se deriva de 12 mensualidades del mínimo publicado — la fuente '
        + 'publica importes mensual y por hora, no un anual.',
      ],
    },

    // --- Módulo anterior de SMI andorrano (fixture de "no retroactividad") -
    // Existe para demostrar que una actualización de salario mínimo NO se
    // aplica hacia atrás: una firma anterior a 01-07-2026 resuelve ESTE, no
    // el de julio. Su importe corresponde al mínimo previo al incremento
    // extraordinario y se marca `deprecated` (solo histórico fijado o
    // resolución por fecha dentro de su vigencia).
    'ad-smi-2026-01-v1': {
      id: 'ad-smi-2026-01-v1',
      domain: 'employment',
      familyId: 'ad-minimum-wage',
      layer: 'national-minimum-wage',
      version: 1,
      status: 'provisional',
      scope: { jurisdictionIds: ['AD'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({ seasonFrom: '2025-26', seasonTo: null, dateFrom: '2026-01-01', dateTo: '2026-06-30' }),
      rules: {
        minimumSalary: {
          monthlyAmountMinor: 152594, // 1.525,94 EUR/mes (importe previo al incremento del 2,8%)
          annualAmountMinor: 1831128,
          currency: EUR,
          basis: 'gross',
          countingComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'],
          inKindCanReduceCashMinimum: false,
        },
      },
      sourceRefs: [{
        title: 'Andorra — salari mínim anterior a l’increment extraordinari de 01-07-2026 (derivado de la misma nota de Govern)',
        url: 'https://www.govern.ad/ca/w/el-govern-aprova-un-increment-extraordinari-del-salari-minim-del-2-8-fins-als-1-568-67-euros-mensuals',
        retrievedAt: '2026-08-26',
        articles: ['import anterior implícit en l’increment del 2,8%'],
      }],
      knownSourceInconsistencies: [
        'El importe anterior (1.525,94 EUR) se DERIVA del incremento publicado del 2,8% hasta 1.568,67 EUR; '
        + 'no procede de una publicación propia consultada. Estado provisional.',
      ],
      notImplemented: [],
      derivedInterpretations: [],
    },

    // --- Referencia arquitectónica: NUNCA activada ------------------------
    'euroleague-spc-2024-reference-v1': {
      id: 'euroleague-spc-2024-reference-v1',
      domain: 'employment',
      familyId: 'euroleague-standard-player-contract',
      layer: 'collective-agreement-membership',
      version: 1,
      status: 'reference-only',
      scope: { jurisdictionIds: null, competitionIds: ['euroleague-not-implemented'], personalScope: 'euroleague-player' },
      validity: buildValidity({ seasonFrom: '2024-25', seasonTo: null }),
      rules: {
        paymentInstallmentRange: { min: 10, max: 12, default: 10 },
        paymentFrequency: 'monthly',
        allowedBases: ['net', 'estimated-gross'],
        guaranteeTypes: ['fully-guaranteed'],
        clausePolicy: {
          'player-release': 'allowed',
          'club-option': 'allowed',
          'player-option': 'allowed',
          'medical-condition': 'allowed',
        },
      },
      sourceRefs: [{
        title: 'EuroLeague Players Association — Standard Player Contract 2024',
        url: 'https://elpa.basketball/wp-content/uploads/2024/09/SPC-2024.pdf',
        retrievedAt: '2026-08-26',
        articles: ['importe neto y bruto estimado', 'mínimo de pagos mensuales', 'primas', 'contrato garantizado', 'anexos'],
      }],
      knownSourceInconsistencies: [],
      notImplemented: ['everything'], // reference-only: no se activa para ningún club actual
      derivedInterpretations: [],
    },
    'fr-lnb-ccbp-reference-v1': {
      id: 'fr-lnb-ccbp-reference-v1',
      domain: 'employment',
      familyId: 'fr-basketball-collective-agreement',
      layer: 'national-statutory',
      version: 1,
      status: 'reference-only',
      scope: { jurisdictionIds: ['FR'], competitionIds: null, personalScope: 'professional-basketball-player' },
      validity: buildValidity({ seasonFrom: '2025-26', seasonTo: null }),
      rules: {
        // Duración aparente MAYOR que el tope FIBA: sirve de fixture para
        // comprobar que la composición aplica la INTERSECCIÓN (el menor) y
        // muestra la colisión, en vez de codificar un maxTermYears
        // universal en Contract.js.
        maxTermYears: 5,
        paymentFrequency: 'monthly',
        clausePolicy: {
          'nba-out': 'allowed',
          'relegation-or-nonqualification-out': 'allowed',
          'player-release': 'allowed',
        },
      },
      sourceRefs: [{
        title: 'Francia — LNB / Convention collective du basket professionnel (documentación)',
        url: 'https://cdn.lnb.fr/uploads/content-library/ee8de036b647401bc99a88247438e4ed25de7e000b87709ec31615843b8fbaa9.pdf',
        retrievedAt: '2026-08-26',
        articles: ['durée du contrat', 'renouvellement', 'clauses de sortie', 'impayés'],
      }],
      knownSourceInconsistencies: [
        'La duración aparente admitida por la fuente francesa (5 temporadas) colisiona con el tope de 4 años '
        + 'de FIBA Book 3 en vigor desde 22-04-2026. El resolver muestra la colisión y aplica la intersección.',
      ],
      notImplemented: ['everything'],
      derivedInterpretations: [],
    },

    // --- Perfil SOLO DE TEST: otro país, reglas distintas -----------------
    // Demuestra (sección 5.3 del prompt) que un perfil de otra jurisdicción
    // resuelve reglas distintas sin tocar Contract, Team, Player ni game.js.
    'bm-test-jurisdiction-employment-v1': {
      id: 'bm-test-jurisdiction-employment-v1',
      domain: 'employment',
      familyId: 'bm-test-jurisdiction-employment',
      layer: 'national-statutory',
      version: 1,
      status: 'provisional',
      scope: { jurisdictionIds: ['XX'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null, carryForwardUntilSuperseded: true }),
      rules: {
        maxTermYears: 2,
        requiresWrittenForm: true,
        requiredDocuments: ['written-contract', 'bm-test-document'],
        // Política de prueba DINÁMICA de verdad (con escalones), para
        // probar el mecanismo sin inventar umbrales de una ley real.
        probationPolicy: {
          type: 'salary-multiple-tiers',
          baseDays: 30,
          tiers: [
            { minAnnualSalaryMultipleOfMinimum: 3, days: 45 },
            { minAnnualSalaryMultipleOfMinimum: 10, days: 60 },
          ],
          tiersStatus: 'test-fixture',
        },
        minimumSalary: {
          annualAmountMinor: 1000000,
          currency: EUR,
          basis: 'gross',
          countingComponents: ['guaranteedBaseSalary'],
          inKindCanReduceCashMinimum: false,
        },
        paymentInstallmentRange: { min: 4, max: 6, default: 4 },
        paymentFrequency: 'quarterly',
        allowedCurrencies: [EUR],
        allowedBases: ['gross'],
        clausePolicy: { 'club-option': 'allowed', 'player-release': 'forbidden' },
      },
      sourceRefs: [],
      knownSourceInconsistencies: [],
      notImplemented: [],
      derivedInterpretations: ['Perfil ficticio SOLO DE TEST — nunca aplicable a un club real.'],
    },
    // Versión FUTURA del perfil de test (misma familia, versión 2): sirve
    // para comprobar que una norma de vigencia futura NO se aplica
    // retroactivamente y que fijar un moduleId conserva exactamente esa
    // versión (BUG-ROSTER1-01).
    'bm-test-jurisdiction-employment-v2': {
      id: 'bm-test-jurisdiction-employment-v2',
      domain: 'employment',
      familyId: 'bm-test-jurisdiction-employment',
      layer: 'national-statutory',
      version: 2,
      status: 'provisional',
      scope: { jurisdictionIds: ['XX'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({ seasonFrom: '2030-31', seasonTo: null, carryForwardUntilSuperseded: true }),
      rules: {
        maxTermYears: 3,
        requiresWrittenForm: true,
        requiredDocuments: ['written-contract', 'bm-test-document', 'bm-test-future-document'],
        probationPolicy: { type: 'fixed', maxDays: 15 },
        minimumSalary: {
          annualAmountMinor: 2000000,
          currency: EUR,
          basis: 'gross',
          countingComponents: ['guaranteedBaseSalary'],
          inKindCanReduceCashMinimum: false,
        },
        paymentInstallmentRange: { min: 4, max: 6, default: 6 },
        paymentFrequency: 'quarterly',
        allowedCurrencies: [EUR],
        allowedBases: ['gross'],
      },
      sourceRefs: [],
      knownSourceInconsistencies: [],
      notImplemented: [],
      derivedInterpretations: ['Perfil ficticio SOLO DE TEST (versión futura).'],
    },
    // Fixture DEPRECATED: puede resolver un compromiso histórico ya fijado
    // (`pinnedModuleIds`), pero nunca se autoselecciona ni sirve para una
    // firma nueva.
    'bm-test-deprecated-v1': {
      id: 'bm-test-deprecated-v1',
      domain: 'employment',
      familyId: 'bm-test-deprecated',
      layer: 'national-statutory',
      version: 1,
      status: 'deprecated',
      scope: { jurisdictionIds: ['bm-test-deprecated-jur'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({ seasonFrom: '2018-19', seasonTo: '2021-22', carryForwardUntilSuperseded: true }),
      rules: { maxTermYears: 1, requiresWrittenForm: true, allowedCurrencies: [EUR], allowedBases: ['gross'] },
      sourceRefs: [],
      knownSourceInconsistencies: [],
      notImplemented: [],
      derivedInterpretations: ['Fixture SOLO DE TEST (norma derogada).'],
    },
    // Fixture SIN `carryForwardUntilSuperseded`: al pedir una temporada
    // posterior a su vigencia NO continúa — falla explícito, sin fallback.
    'bm-test-no-carryforward-v1': {
      id: 'bm-test-no-carryforward-v1',
      domain: 'employment',
      familyId: 'bm-test-no-carryforward',
      layer: 'national-statutory',
      version: 1,
      status: 'provisional',
      scope: { jurisdictionIds: ['bm-test-nocarry-jur'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({ seasonFrom: '2020-21', seasonTo: '2020-21', carryForwardUntilSuperseded: false }),
      rules: { maxTermYears: 2, requiresWrittenForm: true, allowedCurrencies: [EUR], allowedBases: ['gross'] },
      sourceRefs: [],
      knownSourceInconsistencies: [],
      notImplemented: [],
      derivedInterpretations: ['Fixture SOLO DE TEST (sin continuidad provisional declarada).'],
    },
    // Fixture de moneda incompatible (test de conflicto irresoluble).
    'bm-test-foreign-currency-v1': {
      id: 'bm-test-foreign-currency-v1',
      domain: 'employment',
      familyId: 'bm-test-foreign-currency',
      layer: 'collective-agreement-membership',
      version: 1,
      status: 'provisional',
      // Jurisdicción ficticia PROPIA: así nunca se activa sola sobre el
      // perfil de test 'XX'. Los tests la fuerzan con `extraModuleIds` para
      // provocar el conflicto de monedas a propósito.
      scope: { jurisdictionIds: ['bm-test-currency-fixture'], competitionIds: null, personalScope: 'employee' },
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null, carryForwardUntilSuperseded: true }),
      rules: { allowedCurrencies: ['GBP'] },
      sourceRefs: [],
      knownSourceInconsistencies: [],
      notImplemented: [],
      derivedInterpretations: ['Fixture SOLO DE TEST: moneda incompatible con EUR para probar el conflicto explícito.'],
    },
  };

  function getEmploymentModule(moduleId) {
    const module_ = EMPLOYMENT_MODULES[moduleId];
    if (!module_) {
      throw new Error(`CompetitionRules: no existe el módulo laboral "${moduleId}" en el catálogo.`);
    }
    return module_;
  }

  // ---------------------------------------------------------------------
  // 5-bis. RuleModuleCatalog — dominio `market` (MARKET-1, DESIGN.md 9.19,
  //    sección 6/7 del prompt). Tres capas DISTINTAS, nunca fusionadas:
  //
  //   - `agent-principles` (FIBA, Internal Regulations Book 3): rige al
  //     AGENTE, universal — jamás depende de `competitionId`. La licencia
  //     FIBA solo se exige para transfer INTERNACIONAL (bloqueado hasta
  //     EUROPE-1), nunca a una negociación doméstica.
  //   - `domestic-procedure` (ACB derecho de tanteo/inscripción
  //     preferente/retorno): rige por COMPETICIÓN — se declara en
  //     `bundle.modules.market`, exactamente igual que `registration`.
  //     Ninguna competición hereda el de otra por defecto (invariante 32).
  //   - `membership-overlay` (EuroLeague EFA): capa que puede superponerse
  //     a la doméstica sin sustituirla — SIEMPRE `reference-only` en esta
  //     entrega, nunca auto-seleccionada, solo activable fijando su
  //     módulo explícitamente (`ctx.pinnedModuleIds`).
  //
  //    Política de JUEGO (tiempos de respuesta, paciencia, límite interno
  //    de plantilla) NUNCA vive aquí — eso es `simulated-policy`
  //    (sección 7.4 del prompt), ver `src/core/NegotiationService.js` y
  //    `src/core/MarketService.js`.
  // ---------------------------------------------------------------------
  const MARKET_MODULES = {
    'fiba-agents-book3-2026-v1': {
      id: 'fiba-agents-book3-2026-v1',
      domain: 'market',
      familyId: 'fiba-agents-book3',
      layer: 'agent-principles',
      version: 1,
      status: 'verified',
      // Universal a propósito: ningún agente FIBA queda fuera por
      // competición/jurisdicción — nunca `null` por omisión, `null`
      // declarado explícitamente como "sin restricción de ámbito".
      scope: { jurisdictionIds: null, competitionIds: null, personalScope: 'agent' },
      validity: buildValidity({ dateFrom: '2026-04-22', dateTo: null, carryForwardUntilSuperseded: true }),
      agentPrinciples: {
        mandateMaxYears: 2,
        mandateRequiresWrittenContract: true,
        mandateRenewalRequiresNewWrittenAgreement: true,
        mandateTerminationNoticeDays: 30,
        commissionMaxBasisPoints: 1000,
        commissionPayerMustBeClient: true,
        conflictOfInterest: {
          prohibitsMultiPartyRepresentationSameOperation: true,
          prohibitsClubRepresentationIfAgentHasContractWithClubPlayer: true,
          prohibitsUsingThirdPartiesToEvade: true,
          prohibitsInducingBreachOfExistingContract: true,
        },
        minorProtection: {
          minimumAgeForApproach: 18,
          prohibitedDuringCampsOrCompetitions: true,
        },
        dutyOfGoodFaithAndTransparency: true,
        playerSignsPersonallyAndRetainsFinalDecision: true,
        // Sección 6.1 del prompt: declarado ahora, ejecución bloqueada
        // hasta EUROPE-1 (transfer internacional real).
        requiresFibaLicenseForOperations: ['internationalTransfer'],
      },
      sourceRefs: [
        {
          title: 'FIBA Internal Regulations, Book 3 — Players and Officials (arts. 3-298 a 3-327), vigente desde 22-04-2026',
          url: 'https://assets.fiba.basketball/image/upload/documents-corporate-fiba-regulations-internal-regulations-book-3.pdf',
          retrievedAt: '2026-08-26',
        },
        {
          title: 'FIBA — Directorio oficial de agentes (verificación humana)',
          url: 'https://about.fiba.basketball/en/search/agents',
          retrievedAt: '2026-08-26',
        },
      ],
      knownSourceInconsistencies: [],
      notImplemented: ['domesticAgentLicenseRequirement'],
      derivedInterpretations: [
        'La licencia FIBA se exige SOLO para transfer internacional (bloqueado hasta EUROPE-1) — nunca se '
        + 'convierte en obligación universal para negociación doméstica ACB/FEB sin una fuente adicional verificada.',
      ],
    },
    'acb-right-of-first-refusal-2026-27-provisional-v1': {
      id: 'acb-right-of-first-refusal-2026-27-provisional-v1',
      domain: 'market',
      familyId: 'acb-right-of-first-refusal',
      layer: 'domestic-procedure',
      version: 1,
      // El convenio (BOE) tuvo vigencia formal 2018-07-01/2022-06-30; ACB
      // seguía aplicando el procedimiento operativamente en julio de 2026
      // (14 jugadores publicados, 06-07-2026) — NUNCA "verified" para
      // 2026-27, siempre "provisional" con warning visible (sección 6.2).
      status: 'provisional',
      scope: { jurisdictionIds: null, competitionIds: [COMPETITION_IDS.ACB], personalScope: 'player' },
      validity: buildValidity({ seasonFrom: '2026-27', seasonTo: '2026-27', carryForwardUntilSuperseded: true }),
      procedureFamily: 'acb-right-of-first-refusal',
      qualifyingOffer: {
        firstExtensionMinimumPercentOfLastMonetizedAnnual: 100,
        ageComputedOnMonthDay: '07-01',
        maxConsecutiveExercisesUpToAge30: 3,
        maxConsecutiveExercisesFromAge30: 3,
      },
      debtChallenge: {
        windowDaysBeforeLastMatch: 15,
        deadlineTimeOnLastMatchDay: '20:00',
      },
      // Días NATURALES (art. 14) — nunca desplazados por fin de semana.
      generalProcedureDeadlinesNaturalDays: {
        clubStatusReportingDays: 3,
        listPublicationDays: 3,
        qualifyingOfferAccreditationDays: 3,
        thirdPartyOfferSheetDays: 13,
        forwardToOriginClubDays: 1,
        originClubMatchingWindowDays: 5,
        contractDepositIfMatchedDays: 5,
        contractDepositIfNotMatchedDays: 10,
      },
      offerSheetRequiredFields: [
        'duration', 'grossAnnualRemunerationPerSeason', 'fixedComponents', 'inKindValuation',
        'imageRights', 'unilateralTerminationClause', 'agentFees',
      ],
      matchableComponents: [
        'economicTotalDividedInTenInstallments', 'inKindAmounts', 'duration', 'terminationClause', 'agentFees',
      ],
      ignoredForMatchingComponents: ['rolePromise', 'expectedMinutes', 'nonSalaryHousing', 'personalPreferences'],
      preferredRegistrationRight: {
        procedureFamily: 'acb-preferred-registration',
        requiresAtLeastOneFullJuniorSeasonAtOriginClub: true,
        maxAgeInclusive: 21,
        maxConsecutiveExercises: 3,
        communicationDeadlineMonthDay: '03-31',
        qualifyingOfferWithinFirstDaysOfWindow: 2,
        qualifyingOfferMinimumMultiplierBySeason: [1, 1.5, 2],
        // Art. 15.3.2: 12 días — DISTINTO de los 13 del procedimiento
        // general (art. 14.4). Particularidad REAL de la fuente,
        // conservada tal cual, nunca "corregida" por intuición.
        thirdPartyOfferSheetDays: 12,
      },
      returnRights: {
        procedureFamily: 'acb-return-rights',
        originClubDecisionWindowDays: 3,
        options: ['do-not-maintain', 'maintain-and-use-general-procedure', 'wait-for-third-party-offer'],
        matchingSurchargePercentOnWaitOption: 10,
      },
      sourceRefs: [
        {
          title: 'BOE — IV Convenio colectivo de baloncesto profesional ACB, arts. 13 a 17',
          url: 'https://www.boe.es/eli/es/res/2021/03/03/(6)',
          retrievedAt: '2026-08-26',
        },
        {
          title: 'ACB — Jugadores sujetos al derecho de tanteo (publicación operativa 06-07-2026)',
          url: 'https://www.acb.com/es/liga/noticias/jugadores-sujetos-al-derecho-de-tanteo-145528',
          retrievedAt: '2026-08-26',
        },
      ],
      knownSourceInconsistencies: [
        'El convenio publicado (BOE) tuvo vigencia formal 2018-07-01/2022-06-30; ACB seguía aplicando el '
        + 'procedimiento operativamente en julio de 2026 — continuidad declarada "provisional", nunca "verified".',
        'El art. 15.3.2 declara 12 días para documentos de terceros en inscripción preferente, frente a los 13 '
        + 'del procedimiento general (art. 14.4) — diferencia real entre artículos del propio convenio.',
      ],
      notImplemented: ['contractDepositRegistration', 'compensationPaymentExecution'],
      derivedInterpretations: [],
    },
    'euroleague-efa-contact-overlay-2024-27-reference-only-v1': {
      id: 'euroleague-efa-contact-overlay-2024-27-reference-only-v1',
      domain: 'market',
      familyId: 'euroleague-efa-contact-overlay',
      layer: 'membership-overlay',
      version: 1,
      // Sección 6.3: demuestra overlays futuros — nunca se autoselecciona,
      // ningún bundle real lo referencia en `modules.market`.
      status: 'reference-only',
      scope: { jurisdictionIds: null, competitionIds: ['euroleague'], personalScope: 'player' },
      validity: buildValidity({ seasonFrom: '2024-25', seasonTo: '2026-27', carryForwardUntilSuperseded: true }),
      contactOverlay: {
        requiresPriorClubAuthorization: true,
        authorizationAppliesToClubAndAgent: true,
        exemptWithinDaysBeforeContractExpiry: 60,
        agentIdentityMustBeDisclosedAtSeasonStart: true,
        compensationTransparencyForLegitimateInterestClubs: true,
        compensationTransparencyUnderConfidentiality: true,
      },
      sourceRefs: [
        { title: 'ELPA — EuroLeague Framework Agreement', url: 'https://elpa.basketball/efa/', retrievedAt: '2026-08-26' },
        {
          title: 'EFA 2024-27',
          url: 'https://elpa.basketball/wp-content/uploads/2024/09/EFA-2024-27-DEF.pdf',
          retrievedAt: '2026-08-26',
        },
      ],
      knownSourceInconsistencies: [],
      notImplemented: ['euroleaguePlayableCompetition'],
      derivedInterpretations: [
        'Módulo de REFERENCIA: prueba que una regla de negociación puede superponerse a la liga doméstica sin '
        + 'convertir Team.division en clave universal. Nunca se aplica a un club real hasta EUROPE-1.',
      ],
    },
    // Sección 6.4 del prompt: fixture `reference-only` de una competición
    // FICTICIA con una regla de contacto/ventana DISTINTA — demuestra que
    // se activa fijando su módulo (`ctx.marketModuleId`/`pinnedModuleIds`)
    // sin editar MarketService/UI/Team.js ni ninguna rama
    // `if (competitionId === ...)`. Nunca asociado a ningún RulesetBundle real.
    'bm-test-fictional-market-window-reference-only-v1': {
      id: 'bm-test-fictional-market-window-reference-only-v1',
      domain: 'market',
      familyId: 'bm-test-fictional-market-window',
      layer: 'domestic-procedure',
      version: 1,
      status: 'reference-only',
      scope: { jurisdictionIds: null, competitionIds: [COMPETITION_IDS.TEST_FICTIONAL], personalScope: 'player' },
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null, carryForwardUntilSuperseded: true }),
      procedureFamily: 'bm-test-fictional-market-window',
      marketWindow: { opensMonthDay: '07-01', closesMonthDay: '09-15' },
      contactRequiresOpenWindow: true,
      sourceRefs: [],
      knownSourceInconsistencies: [],
      notImplemented: [],
      derivedInterpretations: [
        'Fixture SOLO DE TEST (sección 6.4 del prompt de MARKET-1) — NUNCA usar en una partida real.',
      ],
    },
  };

  function getMarketModule(moduleId) {
    const module_ = MARKET_MODULES[moduleId];
    if (!module_) {
      throw new Error(`CompetitionRules: no existe el módulo de mercado "${moduleId}" en el catálogo.`);
    }
    return module_;
  }

  // Encuentra, dentro de una lista de ids fijados explícitamente, el que
  // pertenece a una familia concreta — permite pinnear varios módulos de
  // mercado de capas distintas (agente/procedimiento/overlay) a la vez sin
  // ambigüedad, igual que `pinnedModuleIds` del contexto de sección 7.1.
  function findPinnedIdForFamily(pinnedModuleIds, familyId) {
    if (!pinnedModuleIds || !pinnedModuleIds.length) return null;
    const found = pinnedModuleIds.find((id) => {
      const mod = MARKET_MODULES[id];
      return mod && mod.familyId === familyId;
    });
    return found || null;
  }

  // ---------------------------------------------------------------------
  // 6. RulesetBundleCatalog — compone módulos de ÁMBITOS DISTINTOS para una
  //    competición+temporada.
  //
  //    CONTRACT-1 (BUG-ROSTER1-02): el bundle de una competición ya NO
  //    declara `jurisdictionId` — la jurisdicción LABORAL es del EMPLEADOR
  //    (ClubEmploymentContextCatalog.js), no de la competición. Lo que sí
  //    puede aportar una competición es una capa de convenio/membresía
  //    (`modules.employmentMembershipOverlay`).
  // ---------------------------------------------------------------------
  const RULESET_BUNDLES = {
    'acb-domestic-2025-26-v1': {
      id: 'acb-domestic-2025-26-v1',
      version: 1,
      status: 'verified',
      competitionId: COMPETITION_IDS.ACB,
      validity: buildValidity({ seasonFrom: '2025-26', seasonTo: '2025-26', carryForwardUntilSuperseded: true }),
      organizerCountry: 'ES',
      federationId: 'feb-general',
      collectiveAgreementId: 'acb-abp',
      // REG-1 (BUG-CONTRACT1-02): ámbito de inscripción DECLARADO como dato
      // — Liga, Copa y Playoff por el título comparten este mismo
      // `registrationScopeId` porque las Normas Internas ACB se aplican a
      // las tres competiciones organizadas por ACB (nunca deducido por ser
      // "el equipo de Primera División").
      registrationScopeId: 'acb-domestic-registration-2025-26',
      modules: {
        registration: 'acb-registration-2025-26-v1',
        // Capa de convenio de la COMPETICIÓN (no la ley del empleador).
        employmentMembershipOverlay: 'acb-abp-cba-2018-22-operational-provisional-v1',
        // MARKET-1 (DESIGN.md 9.19): procedimiento doméstico de derecho de
        // tanteo/inscripción preferente/retorno — declarado como dato del
        // bundle, exactamente igual que `registration`.
        market: 'acb-right-of-first-refusal-2026-27-provisional-v1',
        // Ámbitos todavía SIN ningún módulo real — ausentes explícitamente.
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
      status: 'verified',
      competitionId: COMPETITION_IDS.PRIMERA_FEB,
      validity: buildValidity({ seasonFrom: '2026-27', seasonTo: '2026-27', carryForwardUntilSuperseded: true }),
      organizerCountry: 'ES',
      federationId: 'feb-general',
      // Primera FEB NO tiene convenio ACB: no hereda su mínimo ni sus diez
      // mensualidades por ser "baloncesto español".
      collectiveAgreementId: null,
      // REG-1: Primera FEB (liga regular + Playoff de ascenso) tiene su
      // PROPIO ámbito de inscripción — nunca el mismo que ACB por ser
      // "la otra división".
      registrationScopeId: 'primera-feb-domestic-registration-2026-27',
      modules: {
        registration: 'primera-feb-registration-2026-27-v1',
        employmentMembershipOverlay: null,
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
      status: 'provisional',
      competitionId: COMPETITION_IDS.TEST_FICTIONAL,
      validity: buildValidity({ seasonFrom: '2000-01', seasonTo: null, carryForwardUntilSuperseded: true }),
      organizerCountry: 'XX',
      federationId: null,
      collectiveAgreementId: null,
      registrationScopeId: 'bm-test-fictional-registration-scope',
      modules: {
        registration: 'bm-test-fictional-registration-v1',
        employmentMembershipOverlay: null,
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

  // Resuelve el RulesetBundle para un contexto POR VIGENCIA (CONTRACT-1,
  // BUG-ROSTER1-01) — nunca "el de versión más alta". `context.bundleId`
  // FIJA (congela) un bundle concreto, pieza que HARDEN-1 necesitará para
  // congelar `rulesetBundleId`+versión al inicio de cada temporada.
  function resolveBundleDetailed(context) {
    const { competitionId, bundleId } = context;
    getCompetitionDefinition(competitionId); // valida que la competición existe; lanza si no.
    const candidates = findBundlesForCompetition(competitionId);
    if (bundleId && !candidates.some((b) => b.id === bundleId)) {
      throw new Error(
        `CompetitionRules: no existe el bundle "${bundleId}" para la competición "${competitionId}" `
        + '(bundle/version inexistente).',
      );
    }
    if (!candidates.length) {
      throw new Error(`CompetitionRules: la competición "${competitionId}" no tiene ningún RulesetBundle registrado.`);
    }
    return selectByValidity(candidates, {
      seasonKey: context.seasonKey || null,
      date: context.date ? toIsoDate(context.date) : null,
      pinnedId: bundleId || null,
      label: 'RulesetBundle',
    });
  }

  // Compatibilidad con ROSTER-1: devuelve solo el bundle.
  function resolveBundle(context) {
    return resolveBundleDetailed(context).entity;
  }

  // Acepta `Date` del reloj de mundo o un string ISO date-only.
  function toIsoDate(value) {
    if (!value) return null;
    if (typeof value === 'string') return LD().requireIsoDate(value, 'date');
    return LD().fromJsDate(value);
  }

  // ---------------------------------------------------------------------
  // 7. Estrategias de composición por tipo de regla (DESIGN.md 9.16/9.17):
  //    "no resolver con Object.assign/spread, el último gana — cada tipo de
  //    regla necesita una estrategia semántica".
  // ---------------------------------------------------------------------
  const MERGE_STRATEGIES = {
    // Mínimos concurrentes: se conserva el mayor (más restrictivo).
    min: (a, b) => Math.max(a, b),
    // Máximos concurrentes: se conserva el menor (más restrictivo).
    max: (a, b) => Math.min(a, b),
  };

  // Orden de "protección" de periodicidades de pago: más frecuente = más
  // protector para el trabajador. La composición se queda con el más
  // protector compatible.
  const PAYMENT_FREQUENCY_PROTECTION = { weekly: 4, biweekly: 3, monthly: 2, quarterly: 1 };

  // `overlays`: array de parches `{ matchSquad: { min?, max? } }` — ROSTER-1
  // nunca los produce todavía, pero el mecanismo real ya existe para
  // EUROPE-1 sin reescribir el resolver.
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
  // 8. Capacidades derivadas: "capacidad para interfaz, política para
  //    comportamiento". Se derivan SIEMPRE de qué módulos/campos están de
  //    verdad presentes — nunca una lista a mano que pueda divergir.
  // ---------------------------------------------------------------------
  function deriveRegistrationCapabilities(registrationModule) {
    const capabilities = new Set();
    if (!registrationModule) return capabilities;
    if (registrationModule.matchSquad) capabilities.add('matchSquadSizeLimit');
    if (registrationModule.activeRosterRange) capabilities.add('federationLicense');
    if (registrationModule.activeRosterRange || registrationModule.matchSquad) capabilities.add('competitionRegistration');
    if (registrationModule.cumulativeRegistrationCap) capabilities.add('seasonRegistrationLedger');
    if (registrationModule.matchActRange || registrationModule.matchSquad) capabilities.add('matchAct');
    if (registrationModule.quotaBands && registrationModule.quotaBands.length) capabilities.add('formationQuota');
    if (registrationModule.nonCommunityCap) capabilities.add('nonCommunityCap');
    if (registrationModule.onCourtConstraints && registrationModule.onCourtConstraints.minFormationOnCourtAtAllTimes) {
      capabilities.add('onCourtFormationQuota');
    }
    if ((registrationModule.submissionWindows && registrationModule.submissionWindows.length)
      || (registrationModule.finalRegistrationDeadlines && registrationModule.finalRegistrationDeadlines.length)) {
      capabilities.add('registrationDeadlines');
    }
    if (registrationModule.provisionalAuthorizationPolicy) capabilities.add('provisionalAuthorization');
    if (registrationModule.ownLowerCategoryRules && registrationModule.ownLowerCategoryRules.allowed) {
      capabilities.add('ownLowerCategoryPlayers');
    }
    if (registrationModule.linkedPlayerRules) capabilities.add('linkedPlayers');
    if (registrationModule.additionalListRules && registrationModule.additionalListRules.allowed) {
      capabilities.add('additionalPlayerLists');
    }
    return capabilities;
  }

  function deriveEmploymentCapabilities(employment, appliedModules) {
    const capabilities = new Set();
    if (appliedModules.length) capabilities.add('employmentContractRules');
    if (employment.maxTermYears !== null) capabilities.add('contractTermLimit');
    if (employment.minimumSalaryRequirements.length) capabilities.add('minimumSalaryFloor');
    if (employment.probation && employment.probation.maxDays !== null) capabilities.add('probationPeriodLimit');
    if (employment.payments && employment.payments.installmentRange) capabilities.add('paymentScheduleRules');
    if (appliedModules.some((m) => m.layer === 'collective-agreement-membership')) {
      capabilities.add('collectiveAgreementOverlay');
    }
    if (employment.minorRules && employment.minorRules.minimumWorkingAge !== null) {
      capabilities.add('minorEmploymentProtections');
    }
    if (employment.clausePolicy && Object.keys(employment.clausePolicy).length) {
      capabilities.add('typedContractClauses');
    }
    return capabilities;
  }

  // ---------------------------------------------------------------------
  // 9. Composición del dominio `employment`.
  // ---------------------------------------------------------------------

  // Un módulo es APLICABLE a un contexto laboral si su ámbito coincide.
  // `reference-only` no se activa NUNCA por ámbito (solo fijándolo).
  function isEmploymentModuleApplicable(module_, ctx) {
    if (module_.status === 'reference-only') return false;
    const scope = module_.scope || {};
    if (scope.jurisdictionIds && !scope.jurisdictionIds.includes(ctx.employerJurisdictionId)) return false;
    if (scope.competitionIds && !scope.competitionIds.includes(ctx.domesticCompetitionId)) return false;
    if (scope.federationIds && !scope.federationIds.includes(ctx.federationId)) return false;
    return true;
  }

  // Qué reglas aporta un módulo a ESTE contexto. Si el módulo tiene ámbito
  // territorial y el empleador está fuera de él, solo aporta las reglas de
  // MEMBRESÍA declaradas — nunca sustituye la ley del país del empleador
  // (caso MoraBanc: el convenio ACB no le trae RD 1006 ni el SMI español).
  function contributedRules(module_, ctx) {
    const territorial = module_.territorialJurisdictionIds;
    if (!territorial || territorial.includes(ctx.employerJurisdictionId)) {
      return { rules: module_.rules || {}, membershipOnly: false };
    }
    const membershipScope = module_.membershipScope;
    if (!membershipScope || !membershipScope.appliesOutsideTerritory) {
      return { rules: null, membershipOnly: false };
    }
    const filtered = {};
    (membershipScope.ruleKeys || []).forEach((key) => {
      if (module_.rules && module_.rules[key] !== undefined) filtered[key] = module_.rules[key];
    });
    return { rules: filtered, membershipOnly: true };
  }

  function pushTrace(trace, field, entry) {
    if (!trace.fields[field]) trace.fields[field] = [];
    trace.fields[field].push(entry);
  }

  // Prioridad de capa para elegir un VALOR POR DEFECTO cuando varias capas
  // declaran uno compatible (nunca para decidir qué es legal: eso ya lo
  // resuelve la intersección/estrategia de cada campo).
  const LAYER_DEFAULT_PRIORITY = {
    'national-statutory': 40,
    'national-minimum-wage': 30,
    'collective-agreement-membership': 20,
    'national-minor-protection': 15,
    'global-sport': 10,
  };

  function composeEmployment(appliedModules, ctx, warnings, conflicts) {
    const trace = { fields: {} };
    const declaredInstallmentDefaults = [];
    const employment = {
      maxTermYears: null,
      requiresWrittenForm: false,
      requiresFixedTerm: false,
      requiredContractFields: [],
      requiredDocuments: [],
      mandatoryBenefits: [],
      prohibitions: [],
      allowedCurrencies: null,
      allowedBases: null,
      salaryInKindAllowed: false,
      inKindBenefitLimits: [],
      minimumSalaryRequirements: [],
      effectiveMinimumAnnual: null,
      probation: { maxDays: null, policies: [], dynamic: false, sourceRuleIds: [] },
      payments: { installmentRange: null, defaultInstallmentCount: null, frequency: null },
      clausePolicy: {},
      minorRules: {
        minimumWorkingAge: null, consentRequiredUpToAge: null, requiredMarkers: [], prohibitions: [],
      },
    };

    appliedModules.forEach((applied) => {
      const { module: mod, rules } = applied;
      const traceBase = { ruleModuleId: mod.id, version: mod.version, status: mod.status, membershipOnly: applied.membershipOnly };

      // --- duración máxima: MÍNIMO de los topes aplicables --------------
      if (rules.maxTermYears !== undefined) {
        employment.maxTermYears = employment.maxTermYears === null
          ? rules.maxTermYears : MERGE_STRATEGIES.max(employment.maxTermYears, rules.maxTermYears);
        pushTrace(trace, 'maxTermYears', { ...traceBase, value: rules.maxTermYears, strategy: 'min' });
      }

      // --- banderas: unión (cualquier capa que lo exija, se exige) ------
      ['requiresWrittenForm', 'requiresFixedTerm', 'salaryInKindAllowed'].forEach((key) => {
        if (rules[key] !== undefined) {
          employment[key] = employment[key] || Boolean(rules[key]);
          pushTrace(trace, key, { ...traceBase, value: rules[key], strategy: 'anyOf' });
        }
      });

      // --- uniones sin duplicar ------------------------------------------
      [
        ['requiredContractFields', 'requiredContractFields'],
        ['requiredDocuments', 'requiredDocuments'],
        ['mandatoryBenefits', 'mandatoryBenefits'],
        ['prohibitions', 'prohibitions'],
        ['inKindBenefitLimits', 'inKindBenefitLimits'],
      ].forEach(([ruleKey, targetKey]) => {
        if (Array.isArray(rules[ruleKey])) {
          rules[ruleKey].forEach((value) => {
            if (!employment[targetKey].includes(value)) employment[targetKey].push(value);
          });
          pushTrace(trace, targetKey, { ...traceBase, value: rules[ruleKey], strategy: 'union' });
        }
      });

      // --- intersecciones de conjuntos -----------------------------------
      [['allowedCurrencies', 'allowedCurrencies'], ['allowedBases', 'allowedBases']].forEach(([ruleKey, targetKey]) => {
        if (Array.isArray(rules[ruleKey])) {
          employment[targetKey] = employment[targetKey] === null
            ? [...rules[ruleKey]]
            : employment[targetKey].filter((value) => rules[ruleKey].includes(value));
          pushTrace(trace, targetKey, { ...traceBase, value: rules[ruleKey], strategy: 'intersection' });
          if (employment[targetKey].length === 0) {
            conflicts.push({
              field: targetKey,
              ruleModuleIds: appliedModules.map((a) => a.module.id),
              message: `Conflicto irresoluble en "${targetKey}": la intersección de las capas aplicables es vacía.`,
            });
          }
        }
      });

      // --- mínimos salariales: se conservan TODOS (cada uno con su propia
      // clasificación de componentes) y además se deriva el mayor exigible.
      if (rules.minimumSalary) {
        const min = rules.minimumSalary;
        employment.minimumSalaryRequirements.push({
          ruleModuleId: mod.id,
          status: mod.status,
          annualAmountMinor: min.annualAmountMinor !== undefined ? min.annualAmountMinor : null,
          monthlyAmountMinor: min.monthlyAmountMinor !== undefined ? min.monthlyAmountMinor : null,
          currency: min.currency,
          basis: min.basis,
          countingComponents: [...(min.countingComponents || [])],
          inKindCanReduceCashMinimum: Boolean(min.inKindCanReduceCashMinimum),
        });
        pushTrace(trace, 'minimumAnnualSalaryMinor', {
          ...traceBase, value: min.annualAmountMinor, currency: min.currency, strategy: 'max',
        });
      }

      // --- periodo de prueba: MÍNIMO de los topes, admitiendo políticas
      // dinámicas (se evalúan más abajo, con el salario ya conocido).
      if (rules.probationPolicy) {
        employment.probation.policies.push({ ruleModuleId: mod.id, status: mod.status, policy: rules.probationPolicy });
        employment.probation.sourceRuleIds.push(mod.id);
        if (rules.probationPolicy.type !== 'fixed') employment.probation.dynamic = true;
        pushTrace(trace, 'probationMaxDays', {
          ...traceBase, value: rules.probationPolicy, strategy: 'min(dynamic-aware)',
        });
      }

      // --- rango de cuotas: INTERSECCIÓN ---------------------------------
      if (rules.paymentInstallmentRange) {
        const range = rules.paymentInstallmentRange;
        if (range.default !== undefined && range.default !== null) {
          declaredInstallmentDefaults.push({
            ruleModuleId: mod.id, value: range.default, priority: LAYER_DEFAULT_PRIORITY[mod.layer] || 0,
          });
        }
        if (!employment.payments.installmentRange) {
          employment.payments.installmentRange = { min: range.min, max: range.max, default: null, sourceRuleIds: [mod.id] };
        } else {
          const current = employment.payments.installmentRange;
          const merged = {
            min: MERGE_STRATEGIES.min(current.min, range.min),
            max: MERGE_STRATEGIES.max(current.max, range.max),
            default: null,
            sourceRuleIds: [...current.sourceRuleIds, mod.id],
          };
          if (merged.min > merged.max) {
            conflicts.push({
              field: 'paymentInstallmentRange',
              ruleModuleIds: merged.sourceRuleIds,
              message: `Conflicto irresoluble en el número de cuotas: la intersección de los rangos aplicables es vacía (${merged.min}-${merged.max}).`,
            });
          }
          employment.payments.installmentRange = merged;
        }
        pushTrace(trace, 'paymentInstallmentRange', { ...traceBase, value: range, strategy: 'intersection' });
      }

      // --- periodicidad de pago: la MÁS protectora -----------------------
      if (rules.paymentFrequency) {
        const currentScore = PAYMENT_FREQUENCY_PROTECTION[employment.payments.frequency] || 0;
        const candidateScore = PAYMENT_FREQUENCY_PROTECTION[rules.paymentFrequency] || 0;
        if (candidateScore > currentScore) employment.payments.frequency = rules.paymentFrequency;
        pushTrace(trace, 'paymentFrequency', { ...traceBase, value: rules.paymentFrequency, strategy: 'mostProtective' });
      }

      // --- cláusulas: tri-estado, `forbidden` gana a `allowed`, y
      // `allowed` gana a la ausencia (`unspecified`).
      if (rules.clausePolicy) {
        Object.entries(rules.clausePolicy).forEach(([clauseType, policy]) => {
          const current = employment.clausePolicy[clauseType];
          if (current === 'forbidden' || policy === 'forbidden') {
            employment.clausePolicy[clauseType] = 'forbidden';
          } else if (policy === 'allowed' || current === 'allowed') {
            employment.clausePolicy[clauseType] = 'allowed';
          } else {
            employment.clausePolicy[clauseType] = 'unspecified';
          }
          pushTrace(trace, `clausePolicy.${clauseType}`, { ...traceBase, value: policy, strategy: 'forbiddenWins' });
        });
      }

      // --- menores: edad mínima MAYOR, marcadores/prohibiciones en unión -
      if (rules.minorRules) {
        const mr = rules.minorRules;
        if (mr.minimumWorkingAge !== undefined) {
          employment.minorRules.minimumWorkingAge = employment.minorRules.minimumWorkingAge === null
            ? mr.minimumWorkingAge : MERGE_STRATEGIES.min(employment.minorRules.minimumWorkingAge, mr.minimumWorkingAge);
          pushTrace(trace, 'minorRules.minimumWorkingAge', { ...traceBase, value: mr.minimumWorkingAge, strategy: 'min' });
        }
        if (mr.consentRequiredUpToAge !== undefined) {
          employment.minorRules.consentRequiredUpToAge = employment.minorRules.consentRequiredUpToAge === null
            ? mr.consentRequiredUpToAge : MERGE_STRATEGIES.min(employment.minorRules.consentRequiredUpToAge, mr.consentRequiredUpToAge);
        }
        (mr.requiredMarkers || []).forEach((marker) => {
          if (!employment.minorRules.requiredMarkers.includes(marker)) employment.minorRules.requiredMarkers.push(marker);
        });
        (mr.prohibitions || []).forEach((p) => {
          if (!employment.minorRules.prohibitions.includes(p)) employment.minorRules.prohibitions.push(p);
        });
        pushTrace(trace, 'minorRules', { ...traceBase, value: mr, strategy: 'union+min' });
      }
    });

    // --- Mínimo anual EFECTIVO: el MAYOR exigible entre capas (misma
    // moneda; monedas distintas serían un conflicto explícito).
    const annualMinimums = employment.minimumSalaryRequirements.filter((r) => r.annualAmountMinor !== null);
    if (annualMinimums.length) {
      const currencies = [...new Set(annualMinimums.map((r) => r.currency))];
      if (currencies.length > 1) {
        conflicts.push({
          field: 'effectiveMinimumAnnual',
          ruleModuleIds: annualMinimums.map((r) => r.ruleModuleId),
          message: `Conflicto irresoluble: hay mínimos salariales concurrentes en monedas distintas (${currencies.join(', ')}).`,
        });
      } else {
        const best = annualMinimums.reduce((acc, r) => (r.annualAmountMinor > acc.annualAmountMinor ? r : acc), annualMinimums[0]);
        employment.effectiveMinimumAnnual = {
          amountMinor: best.annualAmountMinor,
          currency: best.currency,
          basis: best.basis,
          ruleModuleId: best.ruleModuleId,
          status: best.status,
        };
        if (best.status === 'provisional') {
          warnings.push(
            `El salario mínimo aplicado (${MoneyOf().format(best.annualAmountMinor, best.currency, { compact: true })}/temporada) `
            + `proviene de una fuente PROVISIONAL (${best.ruleModuleId}) — no es un dato legal actualizado y confirmado.`,
          );
        }
      }
    }

    // --- Periodo de prueba: se evalúa cada política y se aplica el MENOR.
    const probationDays = employment.probation.policies.map((entry) => ({
      ruleModuleId: entry.ruleModuleId,
      days: evaluateProbationPolicy(entry.policy, {
        annualSalaryMinor: ctx.annualSalaryMinor !== undefined ? ctx.annualSalaryMinor : null,
        minimumAnnualMinor: employment.effectiveMinimumAnnual ? employment.effectiveMinimumAnnual.amountMinor : null,
      }),
    })).filter((entry) => entry.days !== null);
    if (probationDays.length) {
      const min = probationDays.reduce((acc, e) => (e.days < acc.days ? e : acc), probationDays[0]);
      employment.probation.maxDays = min.days;
      employment.probation.decidedBy = min.ruleModuleId;
      employment.probation.evaluated = probationDays;
    }

    // --- Número de cuotas por defecto: del rango compuesto, recortado a la
    // intersección. Si NINGUNA capa declara rango, se DERIVA de la
    // periodicidad (12 mensualidades para un contrato de temporada
    // completa) — nunca se hereda el 10 de ACB por ser "baloncesto
    // español".
    const range = employment.payments.installmentRange;
    if (range && range.min <= range.max) {
      // Entre los defaults declarados por las capas se elige, de forma
      // determinista, el de mayor prioridad de capa que CABE en la
      // intersección; si ninguno cabe, se recorta el de mayor prioridad y
      // se avisa. Nunca "el último que se haya iterado".
      const ordered = [...declaredInstallmentDefaults].sort((a, b) => (b.priority - a.priority) || (a.value - b.value));
      const inRange = ordered.filter((d) => d.value >= range.min && d.value <= range.max);
      let chosen;
      let decidedBy;
      if (inRange.length) {
        chosen = inRange[0].value;
        decidedBy = inRange[0].ruleModuleId;
      } else if (ordered.length) {
        chosen = Math.min(range.max, Math.max(range.min, ordered[0].value));
        decidedBy = ordered[0].ruleModuleId;
        warnings.push(
          `El número de cuotas por defecto declarado por "${ordered[0].ruleModuleId}" (${ordered[0].value}) queda fuera `
          + `de la intersección aplicable (${range.min}-${range.max}); se aplica ${chosen}.`,
        );
      } else {
        chosen = range.min;
        decidedBy = range.sourceRuleIds.join('+');
      }
      range.default = chosen;
      employment.payments.defaultInstallmentCount = chosen;
      pushTrace(trace, 'defaultInstallmentCount', { value: chosen, strategy: 'intersectedRange', ruleModuleId: decidedBy });
    } else if (employment.payments.frequency) {
      const derived = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4 }[employment.payments.frequency] || null;
      employment.payments.defaultInstallmentCount = derived;
      employment.payments.installmentRange = derived ? { min: derived, max: derived, default: derived, sourceRuleIds: ['derivedFromFrequency'] } : null;
      pushTrace(trace, 'defaultInstallmentCount', { value: derived, strategy: 'derivedFromFrequency' });
    }

    return { employment, trace };
  }

  // Política de periodo de prueba EVALUABLE (nunca una constante global):
  // admite topes fijos y escalones por múltiplo del salario mínimo.
  function evaluateProbationPolicy(policy, context) {
    if (!policy) return null;
    if (policy.type === 'fixed') return policy.maxDays;
    if (policy.type === 'salary-multiple-tiers') {
      const tiers = policy.tiers || [];
      if (!tiers.length) return policy.baseDays;
      const { annualSalaryMinor, minimumAnnualMinor } = context || {};
      if (!annualSalaryMinor || !minimumAnnualMinor) return policy.baseDays;
      const multiple = annualSalaryMinor / minimumAnnualMinor;
      const applicable = tiers
        .filter((tier) => multiple >= tier.minAnnualSalaryMultipleOfMinimum)
        .sort((a, b) => b.minAnnualSalaryMultipleOfMinimum - a.minAnnualSalaryMultipleOfMinimum)[0];
      return applicable ? applicable.days : policy.baseDays;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // 10. Punto de entrada ÚNICO — recibe CONTEXTO explícito (nunca lee
  //     `state`/variables globales), usable igual desde game.js (navegador)
  //     que desde tests Node.
  // ---------------------------------------------------------------------
  function resolveRules(context) {
    const ctx = context || {};
    const domain = ctx.domain || 'registration';
    if (domain === 'employment') return resolveEmploymentDomain(ctx);
    if (domain === 'market') return resolveMarketDomain(ctx);
    if (domain !== 'registration') {
      throw new Error(
        `CompetitionRules.resolveRules: dominio "${domain}" no implementado — dominios disponibles: `
        + 'registration, employment, market.',
      );
    }
    return resolveRegistrationDomain(ctx);
  }

  function resolveRegistrationDomain(ctx) {
    const { competitionId, operation } = ctx;
    if (!competitionId) {
      throw new Error('CompetitionRules.resolveRules: falta "competitionId" en el contexto.');
    }

    const bundleResolution = resolveBundleDetailed(ctx);
    const bundle = bundleResolution.entity;
    const warnings = [...bundleResolution.warnings];
    const knownSourceInconsistencies = [];

    const registrationModuleId = ctx.registrationModuleId || bundle.modules.registration;
    let registrationModule = null;
    let moduleResolutionMode = null;
    if (registrationModuleId) {
      // El módulo también se selecciona POR VIGENCIA dentro de su familia:
      // fijar el bundle no congela por sí solo la versión del módulo si esa
      // familia tuviera versiones nuevas (por eso `pinnedId` se propaga).
      const declared = getRegistrationModule(registrationModuleId);
      const family = Object.values(REGISTRATION_MODULES)
        .filter((m) => m.familyId === declared.familyId && m.competitionId === declared.competitionId);
      const resolution = selectByValidity(family, {
        seasonKey: ctx.seasonKey || null,
        date: ctx.date ? toIsoDate(ctx.date) : null,
        pinnedId: ctx.registrationModuleId || (ctx.bundleId ? registrationModuleId : null),
        label: 'RuleModule de inscripción',
      });
      registrationModule = resolution.entity;
      moduleResolutionMode = resolution.resolutionMode;
      warnings.push(...resolution.warnings);
      (registrationModule.knownSourceInconsistencies || []).forEach((k) => knownSourceInconsistencies.push(k));
    }

    const notImplemented = [];
    // `employment` YA NO figura aquí: CONTRACT-1 implementa ese dominio
    // (por jurisdicción del empleador + overlay de convenio), no la
    // competición. Ver `resolveEmploymentRules()`.
    ['market', 'transfer', 'internationalTransfer'].forEach((d) => {
      if (!bundle.modules[d]) notImplemented.push(d);
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

    const resolutionMode = [bundleResolution.resolutionMode, moduleResolutionMode]
      .includes(RESOLUTION_MODES.PROVISIONAL_CARRY_FORWARD)
      ? RESOLUTION_MODES.PROVISIONAL_CARRY_FORWARD
      : bundleResolution.resolutionMode;

    // REG-1 (sección 9 del prompt): campos normativos completos del
    // dominio `registration`, expuestos bajo `resolved.registration` con
    // el MISMO criterio que `resolved.employment` en el dominio laboral —
    // ningún campo ausente en el módulo se inventa aquí; se propaga tal
    // cual (`null`/`undefined` explícito) para que quien consuma decida.
    const registration = registrationModule ? {
      activeRosterRange: registrationModule.activeRosterRange || null,
      matchActRange: registrationModule.matchActRange || registrationModule.matchSquad || null,
      quotaBands: registrationModule.quotaBands || [],
      nonCommunityCap: registrationModule.nonCommunityCap || null,
      cumulativeRegistrationCap: registrationModule.cumulativeRegistrationCap || null,
      onCourtConstraints: registrationModule.onCourtConstraints || null,
      submissionWindows: registrationModule.submissionWindows || [],
      finalRegistrationDeadlines: registrationModule.finalRegistrationDeadlines || [],
      matchDaySelectionWindow: registrationModule.matchDaySelectionWindow || null,
      matchActConfigurationWindow: registrationModule.matchActConfigurationWindow || null,
      documentRequirements: registrationModule.documentRequirements || [],
      provisionalAuthorizationPolicy: registrationModule.provisionalAuthorizationPolicy || null,
      registrationEffectiveWhen: registrationModule.registrationEffectiveWhen || null,
      ownLowerCategoryRules: registrationModule.ownLowerCategoryRules || null,
      additionalListRules: registrationModule.additionalListRules || null,
      linkedPlayerRules: registrationModule.linkedPlayerRules || null,
      sameRoundMultiClubRestrictions: registrationModule.sameRoundMultiClubRestrictions || null,
      statusRestrictions: registrationModule.statusRestrictions || null,
      resolutionRationale: registrationModule.resolutionRationale || null,
    } : null;

    return {
      domain: 'registration',
      competitionId,
      bundleId: bundle.id,
      // REG-1 (BUG-CONTRACT1-02): ámbito de inscripción DECLARADO en el
      // bundle — nunca deducido de `team.division` ni del nombre visible.
      registrationScopeId: bundle.registrationScopeId || null,
      phaseId: ctx.phaseId || null,
      version: bundle.version,
      // Compatibilidad de lectura con ROSTER-1: primera temporada de
      // vigencia declarada del bundle resuelto.
      effectiveSeason: bundle.validity.seasonFrom,
      validity: bundle.validity,
      requestedSeasonKey: ctx.seasonKey || null,
      requestedDate: ctx.date ? toIsoDate(ctx.date) : null,
      operation: operation || null,
      resolutionMode,
      warnings,
      knownSourceInconsistencies,
      squadRules,
      registration,
      capabilities: deriveRegistrationCapabilities(registrationModule),
      notImplemented,
      sourceRefs: registrationModule ? registrationModule.sourceRefs : [],
      trace: {
        sourceRuleIds,
        bundleId: bundle.id,
        registrationScopeId: bundle.registrationScopeId || null,
        version: bundle.version,
        moduleVersions: registrationModule ? { [registrationModule.id]: registrationModule.version } : {},
        resolutionMode,
      },
    };
  }

  // ---------------------------------------------------------------------
  // MARKET-1 (DESIGN.md 9.19, sección 7.1 del prompt) — `context` esperado:
  //   { domain: 'market', actingClubId, targetPlayerId, currentClubId,
  //     employerJurisdictionId, domesticCompetitionId, prospectiveCompetitionIds,
  //     membershipCompetitionIds, rightsCaseId, seasonKey, date, operation,
  //     transactionScope, proposedStartDate, pinnedBundleId, pinnedModuleIds,
  //     marketModuleId }
  //
  // Compone TRES capas independientes, NUNCA fusionadas con Object.assign
  // (sección 7.3): `agentPrinciples` (FIBA, universal — nunca depende de
  // `competitionId`), `domesticProcedure` (declarado en
  // `bundle.modules.market`, por competición, igual que `registration` —
  // una competición desconocida NUNCA hereda el de otra, invariante 32) y
  // `membershipOverlay` (SIEMPRE reference-only en esta entrega, solo
  // activable fijando su módulo explícitamente en `pinnedModuleIds` —
  // invariante 22, nunca se autoselecciona).
  // ---------------------------------------------------------------------
  function resolveMarketDomain(ctx) {
    const { domesticCompetitionId, operation } = ctx;
    const pinnedModuleIds = ctx.pinnedModuleIds || [];
    const warnings = [];
    const knownSourceInconsistencies = [];
    const trace = { fields: {} };
    const sourceRefs = [];
    const appliedModules = [];

    function pushFieldTrace(field, entry) {
      if (!trace.fields[field]) trace.fields[field] = [];
      trace.fields[field].push(entry);
    }

    // 1) Principios FIBA de agente — SIEMPRE se resuelven, universales.
    const fibaFamily = Object.values(MARKET_MODULES).filter((m) => m.familyId === 'fiba-agents-book3');
    const fibaResolution = selectByValidity(fibaFamily, {
      seasonKey: ctx.seasonKey || null,
      date: ctx.date ? toIsoDate(ctx.date) : null,
      pinnedId: findPinnedIdForFamily(pinnedModuleIds, 'fiba-agents-book3'),
      label: 'RuleModule de principios de agente (FIBA)',
    });
    const agentPrinciplesModule = fibaResolution.entity;
    warnings.push(...fibaResolution.warnings);
    sourceRefs.push(...agentPrinciplesModule.sourceRefs);
    (agentPrinciplesModule.knownSourceInconsistencies || []).forEach((k) => knownSourceInconsistencies.push(k));
    appliedModules.push(agentPrinciplesModule);
    pushFieldTrace('agentPrinciples', {
      ruleModuleId: agentPrinciplesModule.id, version: agentPrinciplesModule.version,
      status: agentPrinciplesModule.status, strategy: 'single-universal-module',
    });

    // 2) Procedimiento doméstico — declarado en el bundle de la competición
    //    doméstica, exactamente igual que `registration`.
    let domesticProcedureModule = null;
    let bundle = null;
    if (domesticCompetitionId) {
      const bundleResolution = resolveBundleDetailed({ ...ctx, competitionId: domesticCompetitionId });
      bundle = bundleResolution.entity;
      warnings.push(...bundleResolution.warnings);
      const marketModuleId = ctx.marketModuleId || bundle.modules.market;
      if (marketModuleId) {
        const declared = getMarketModule(marketModuleId);
        const family = Object.values(MARKET_MODULES).filter((m) => m.familyId === declared.familyId);
        const resolution = selectByValidity(family, {
          seasonKey: ctx.seasonKey || null,
          date: ctx.date ? toIsoDate(ctx.date) : null,
          pinnedId: ctx.marketModuleId || findPinnedIdForFamily(pinnedModuleIds, declared.familyId)
            || (ctx.pinnedBundleId ? marketModuleId : null),
          label: 'RuleModule de procedimiento doméstico de mercado',
        });
        domesticProcedureModule = resolution.entity;
        warnings.push(...resolution.warnings);
        sourceRefs.push(...domesticProcedureModule.sourceRefs);
        (domesticProcedureModule.knownSourceInconsistencies || []).forEach((k) => knownSourceInconsistencies.push(k));
        appliedModules.push(domesticProcedureModule);
        if (domesticProcedureModule.status === 'provisional') {
          warnings.push(
            `El procedimiento doméstico de mercado "${domesticProcedureModule.id}" tiene continuidad `
            + 'PROVISIONAL (no "verified") — ver knownSourceInconsistencies.',
          );
        }
        pushFieldTrace('domesticProcedure', {
          ruleModuleId: domesticProcedureModule.id, version: domesticProcedureModule.version,
          status: domesticProcedureModule.status, strategy: 'single-domestic-module',
        });
      }
    } else if (ctx.marketModuleId) {
      // Resolver un módulo de mercado SIN bundle doméstico — fixtures/tests
      // dirigidos (sección 6.4), nunca usado en producción.
      const declared = getMarketModule(ctx.marketModuleId);
      const family = Object.values(MARKET_MODULES).filter((m) => m.familyId === declared.familyId);
      const resolution = selectByValidity(family, {
        seasonKey: ctx.seasonKey || null,
        date: ctx.date ? toIsoDate(ctx.date) : null,
        pinnedId: ctx.marketModuleId,
        label: 'RuleModule de procedimiento doméstico de mercado (fixture)',
      });
      domesticProcedureModule = resolution.entity;
      warnings.push(...resolution.warnings);
      if (domesticProcedureModule.status === 'reference-only') {
        warnings.push(
          `El módulo de mercado "${domesticProcedureModule.id}" es reference-only (fixture de test) — fijado `
          + 'explícitamente, nunca se autoselecciona en una partida real.',
        );
      }
      sourceRefs.push(...domesticProcedureModule.sourceRefs);
      appliedModules.push(domesticProcedureModule);
      pushFieldTrace('domesticProcedure', {
        ruleModuleId: domesticProcedureModule.id, version: domesticProcedureModule.version,
        status: domesticProcedureModule.status, strategy: 'pinned-fixture',
      });
    }

    // 3) Overlay de membresía (EuroLeague) — solo se resuelve si el club/
    //    negociación declara membresía en esa competición Y se fija
    //    explícitamente su módulo (invariante 22: nunca se autoselecciona).
    let membershipOverlayModule = null;
    const membershipCompetitionIds = ctx.membershipCompetitionIds || [];
    Object.values(MARKET_MODULES).forEach((mod) => {
      if (membershipOverlayModule) return;
      if (mod.layer !== 'membership-overlay') return;
      const scopeCompetitionIds = (mod.scope && mod.scope.competitionIds) || [];
      const membershipMatches = scopeCompetitionIds.some((id) => membershipCompetitionIds.includes(id));
      const explicitlyPinned = pinnedModuleIds.includes(mod.id);
      if (!membershipMatches || !explicitlyPinned) return;
      const family = Object.values(MARKET_MODULES).filter((m) => m.familyId === mod.familyId);
      const resolution = selectByValidity(family, {
        seasonKey: ctx.seasonKey || null,
        date: ctx.date ? toIsoDate(ctx.date) : null,
        pinnedId: mod.id,
        label: 'RuleModule de overlay de membresía de mercado',
      });
      membershipOverlayModule = resolution.entity;
      warnings.push(...resolution.warnings);
      warnings.push(
        `El overlay de membresía "${membershipOverlayModule.id}" (${membershipOverlayModule.status}) se ha `
        + 'activado explícitamente por fijación — nunca se autoselecciona.',
      );
      sourceRefs.push(...membershipOverlayModule.sourceRefs);
      appliedModules.push(membershipOverlayModule);
      pushFieldTrace('membershipOverlay', {
        ruleModuleId: membershipOverlayModule.id, version: membershipOverlayModule.version,
        status: membershipOverlayModule.status, strategy: 'pinned-membership-overlay',
      });
    });

    const market = {
      agentPrinciples: agentPrinciplesModule.agentPrinciples,
      domesticProcedure: domesticProcedureModule ? {
        procedureFamily: domesticProcedureModule.procedureFamily,
        qualifyingOffer: domesticProcedureModule.qualifyingOffer || null,
        debtChallenge: domesticProcedureModule.debtChallenge || null,
        generalProcedureDeadlinesNaturalDays: domesticProcedureModule.generalProcedureDeadlinesNaturalDays || null,
        offerSheetRequiredFields: domesticProcedureModule.offerSheetRequiredFields || [],
        matchableComponents: domesticProcedureModule.matchableComponents || [],
        ignoredForMatchingComponents: domesticProcedureModule.ignoredForMatchingComponents || [],
        preferredRegistrationRight: domesticProcedureModule.preferredRegistrationRight || null,
        returnRights: domesticProcedureModule.returnRights || null,
        marketWindow: domesticProcedureModule.marketWindow || null,
        contactRequiresOpenWindow: Boolean(domesticProcedureModule.contactRequiresOpenWindow),
      } : null,
      // Ventana concurrente (sección 7.3: "ventanas concurrentes:
      // intersección") — cuando hay overlay Y procedimiento doméstico con
      // ventana propia, la ventana EFECTIVA de contacto la calcula quien
      // evalúa fechas reales (NegotiationService/MarketService) por
      // intersección de `domesticProcedure.marketWindow` y
      // `membershipOverlay.exemptWithinDaysBeforeContractExpiry`, nunca
      // "el último módulo gana" — CompetitionRules solo expone ambas capas
      // por separado.
      membershipOverlay: membershipOverlayModule ? membershipOverlayModule.contactOverlay : null,
    };

    const capabilities = deriveMarketCapabilities(market, appliedModules);

    return {
      domain: 'market',
      domesticCompetitionId: domesticCompetitionId || null,
      bundleId: bundle ? bundle.id : null,
      registrationScopeId: bundle ? (bundle.registrationScopeId || null) : null,
      requestedSeasonKey: ctx.seasonKey || null,
      requestedDate: ctx.date ? toIsoDate(ctx.date) : null,
      operation: operation || null,
      resolutionMode: fibaResolution.resolutionMode,
      warnings,
      knownSourceInconsistencies,
      market,
      capabilities,
      notImplemented: domesticProcedureModule ? [] : ['market.domesticProcedure'],
      sourceRefs,
      trace,
      // Política de JUEGO, nunca norma legal (sección 7.4) — declarada
      // aquí solo como referencia de versión para que quien abra un
      // hilo/caso pueda congelarla junto al resto de `trace`; el VALOR
      // real (tiempos de respuesta, paciencia, límite interno de
      // plantilla) vive en NegotiationService/MarketService.
      marketPolicyVersion: 'simulated-market-policy-v1',
    };
  }

  // Sección 7.2 del prompt: capacidad DERIVADA, nunca una lista a mano que
  // pueda divergir de qué campos están de verdad resueltos — mismo
  // criterio que deriveEmploymentCapabilities/deriveRegistrationCapabilities.
  function deriveMarketCapabilities(market, appliedModules) {
    const capabilities = new Set();
    if (appliedModules.length) capabilities.add('canOpenNegotiation');
    const ap = market.agentPrinciples;
    if (ap && ap.requiresFibaLicenseForOperations && ap.requiresFibaLicenseForOperations.includes('internationalTransfer')) {
      capabilities.add('requiresFibaLicensedAgentForInternationalTransfer');
    }
    const dp = market.domesticProcedure;
    if (dp) {
      capabilities.add('hasAdditionalDomesticProcedure');
      if (dp.qualifyingOffer) capabilities.add('supportsQualifyingOffer');
      if (dp.generalProcedureDeadlinesNaturalDays) capabilities.add('supportsRightOfFirstRefusal');
      if (dp.preferredRegistrationRight) capabilities.add('supportsPreferredRegistrationRight');
      if (dp.returnRights) capabilities.add('supportsReturnRights');
      if (dp.marketWindow) capabilities.add('hasMarketWindow');
    }
    if (market.membershipOverlay) {
      capabilities.add('requiresPriorClubAuthorization');
      if (market.membershipOverlay.exemptWithinDaysBeforeContractExpiry) capabilities.add('hasMarketWindow');
    }
    return capabilities;
  }

  // Wrapper fino (sección 7.1 del prompt): construye el contexto de
  // dominio `market` y delega en `resolveRules`, mismo patrón que
  // `resolveEmploymentRules()`.
  function resolveMarketRules(context) {
    return resolveRules({ ...(context || {}), domain: 'market' });
  }

  // Contexto laboral esperado (sección 5.1 del prompt de CONTRACT-1):
  //   { domain: 'employment', clubId, employerJurisdictionId,
  //     domesticCompetitionId, federationId, employmentProfileId, seasonKey,
  //     date, operation, pinnedModuleIds }
  //
  // NUNCA se resuelve employment por "la competición del próximo partido":
  // un club puede jugar ACB y EuroLeague el mismo mes y seguir teniendo un
  // único empleador.
  function resolveEmploymentDomain(ctx) {
    if (!ctx.employerJurisdictionId) {
      throw new Error(
        'CompetitionRules.resolveEmploymentRules: falta "employerJurisdictionId" — la ley laboral aplicable '
        + 'depende del EMPLEADOR, nunca del país que organiza la competición '
        + '(CompetitionDefinition.organizerCountry no es una jurisdicción laboral).',
      );
    }
    const seasonKey = ctx.seasonKey || null;
    const date = ctx.date ? toIsoDate(ctx.date) : null;
    if (!seasonKey && !date) {
      throw new Error('CompetitionRules.resolveEmploymentRules: hace falta "seasonKey" y/o "date" para resolver la vigencia.');
    }
    if (ctx.domesticCompetitionId) getCompetitionDefinition(ctx.domesticCompetitionId);

    const warnings = [];
    const conflicts = [];
    const pinnedModuleIds = ctx.pinnedModuleIds || [];
    const extraModuleIds = ctx.extraModuleIds || []; // fixtures: activar un módulo reference-only a propósito

    // 1. Familias de módulos aplicables por ÁMBITO.
    const applicableModules = Object.values(EMPLOYMENT_MODULES)
      .filter((m) => isEmploymentModuleApplicable(m, ctx));
    const pinnedOrExtra = [...pinnedModuleIds, ...extraModuleIds].map((id) => getEmploymentModule(id));
    pinnedOrExtra.forEach((m) => {
      if (!applicableModules.some((a) => a.id === m.id)) applicableModules.push(m);
    });

    const families = [...new Set(applicableModules.map((m) => m.familyId))];

    // 2. Dentro de cada familia, selección TEMPORAL (nunca "la versión más
    //    alta"): la que cubre la temporada/fecha pedida, o la que declara
    //    continuidad provisional.
    const applied = [];
    const moduleResolutions = [];
    families.forEach((familyId) => {
      const candidates = applicableModules.filter((m) => m.familyId === familyId);
      const pinnedId = pinnedModuleIds.find((id) => candidates.some((c) => c.id === id)) || null;
      const forcedExtraId = extraModuleIds.find((id) => candidates.some((c) => c.id === id)) || null;
      const resolution = selectByValidity(candidates, {
        seasonKey, date, pinnedId: pinnedId || forcedExtraId, label: `RuleModule laboral (familia "${familyId}")`,
      });
      const mod = resolution.entity;
      if (resolution.resolutionMode !== RESOLUTION_MODES.PINNED
        && ctx.operation === 'signContract' && mod.status === 'deprecated') {
        throw new Error(
          `CompetitionRules: el módulo laboral "${mod.id}" está deprecated y no puede elegirse para una firma nueva.`,
        );
      }
      const contribution = contributedRules(mod, ctx);
      if (contribution.rules === null) return; // fuera de su ámbito territorial y sin capa de membresía
      applied.push({ module: mod, rules: contribution.rules, membershipOnly: contribution.membershipOnly });
      moduleResolutions.push({ moduleId: mod.id, familyId, resolutionMode: resolution.resolutionMode, version: mod.version, status: mod.status });
      warnings.push(...resolution.warnings);
      if (contribution.membershipOnly) {
        warnings.push(
          `El módulo "${mod.id}" se aplica SOLO como capa de membresía de la competición `
          + `(${(mod.membershipScope.ruleKeys || []).join(', ')}): su ámbito territorial es `
          + `${mod.territorialJurisdictionIds.join('/')} y el empleador está en ${ctx.employerJurisdictionId}. `
          + 'Nunca sustituye la ley laboral del país del empleador.',
        );
      }
    });

    if (!applied.length) {
      throw new Error(
        `CompetitionRules: no hay ningún módulo laboral aplicable a la jurisdicción "${ctx.employerJurisdictionId}"`
        + `${ctx.domesticCompetitionId ? ` / competición "${ctx.domesticCompetitionId}"` : ''} — `
        + 'no se hereda ningún perfil por defecto (nunca ACB ni España).',
      );
    }

    const { employment, trace } = composeEmployment(applied, ctx, warnings, conflicts);

    const resolutionMode = moduleResolutions.some((r) => r.resolutionMode === RESOLUTION_MODES.PROVISIONAL_CARRY_FORWARD)
      ? RESOLUTION_MODES.PROVISIONAL_CARRY_FORWARD
      : (moduleResolutions.some((r) => r.resolutionMode === RESOLUTION_MODES.PINNED) ? RESOLUTION_MODES.PINNED : RESOLUTION_MODES.EXACT);

    const notImplemented = [];
    applied.forEach(({ module: mod }) => {
      (mod.notImplemented || []).forEach((feature) => {
        const entry = `employment.${feature}`;
        if (!notImplemented.includes(entry)) notImplemented.push(entry);
      });
    });
    ['market', 'transfer', 'internationalTransfer', 'registrationLicence'].forEach((d) => notImplemented.push(d));

    const knownSourceInconsistencies = [];
    applied.forEach(({ module: mod }) => {
      (mod.knownSourceInconsistencies || []).forEach((k) => {
        if (!knownSourceInconsistencies.includes(k)) knownSourceInconsistencies.push(k);
      });
    });

    applied.forEach(({ module: mod }) => {
      if (mod.status === 'provisional' && !warnings.some((w) => w.includes(mod.id))) {
        warnings.push(`El módulo laboral "${mod.id}" tiene estado PROVISIONAL — sus valores no están verificados para este periodo.`);
      }
    });

    // `employmentProfileId` DERIVADO por composición declarativa de capas —
    // nunca un `if` de ACB/FEB/Andorra en ContractService.
    const profileId = ctx.employmentProfileId
      || `employment:${ctx.employerJurisdictionId}:${ctx.domesticCompetitionId || 'no-domestic-competition'}`;

    return {
      domain: 'employment',
      profileId,
      requestedContext: {
        clubId: ctx.clubId || null,
        employerJurisdictionId: ctx.employerJurisdictionId,
        domesticCompetitionId: ctx.domesticCompetitionId || null,
        federationId: ctx.federationId || null,
        seasonKey,
        date,
        operation: ctx.operation || null,
      },
      resolutionMode,
      resolvedForSeasonKey: seasonKey,
      resolvedForDate: date,
      ruleModuleIds: applied.map((a) => a.module.id),
      ruleVersions: applied.reduce((acc, a) => { acc[a.module.id] = a.module.version; return acc; }, {}),
      moduleResolutions,
      sourceRefs: applied.reduce((acc, a) => acc.concat((a.module.sourceRefs || []).map((ref) => ({ ...ref, ruleModuleId: a.module.id }))), []),
      derivedInterpretations: applied.reduce((acc, a) => acc.concat((a.module.derivedInterpretations || []).map((t) => ({ ruleModuleId: a.module.id, text: t }))), []),
      warnings,
      knownSourceInconsistencies,
      conflicts,
      employment,
      capabilities: deriveEmploymentCapabilities(employment, applied.map((a) => a.module)),
      notImplemented,
      trace: {
        ...trace,
        moduleIds: applied.map((a) => a.module.id),
        moduleVersions: applied.reduce((acc, a) => { acc[a.module.id] = a.module.version; return acc; }, {}),
        resolutionMode,
        profileId,
      },
    };
  }

  // Wrapper FINO exigido por la sección 5.1 del prompt: construye contexto y
  // delega en `resolveRules()` — nunca implementa política por su cuenta.
  function resolveEmploymentRules(context) {
    return resolveRules({ ...(context || {}), domain: 'employment' });
  }

  // Congelación de la traza normativa de una firma (sección 5.4/6.1): el
  // objeto fijado en cada contrato conserva IDs/versiones/contexto y un
  // resumen INMUTABLE de las reglas críticas — nunca textos legales.
  function buildSigningSnapshot(resolved) {
    return Object.freeze({
      employmentProfileId: resolved.profileId,
      employerJurisdictionId: resolved.requestedContext.employerJurisdictionId,
      domesticCompetitionId: resolved.requestedContext.domesticCompetitionId,
      federationId: resolved.requestedContext.federationId,
      ruleModuleIds: [...resolved.ruleModuleIds],
      ruleVersions: { ...resolved.ruleVersions },
      resolutionMode: resolved.resolutionMode,
      resolvedForSeasonKey: resolved.resolvedForSeasonKey,
      resolvedForDate: resolved.resolvedForDate,
      warnings: [...resolved.warnings],
      knownSourceInconsistencies: [...resolved.knownSourceInconsistencies],
      criticalRules: Object.freeze({
        maxTermYears: resolved.employment.maxTermYears,
        effectiveMinimumAnnual: resolved.employment.effectiveMinimumAnnual
          ? { ...resolved.employment.effectiveMinimumAnnual } : null,
        probationMaxDays: resolved.employment.probation.maxDays,
        installmentRange: resolved.employment.payments.installmentRange
          ? { ...resolved.employment.payments.installmentRange } : null,
        paymentFrequency: resolved.employment.payments.frequency,
      }),
    });
  }

  const exportsObj = {
    COMPETITION_IDS,
    RESOLUTION_MODES,
    competitionIdFromLegacyDivision,
    getCompetitionDefinition,
    listCompetitions,
    getRegistrationModule,
    getEmploymentModule,
    getMarketModule,
    resolveBundle,
    resolveBundleDetailed,
    resolveRules,
    resolveEmploymentRules,
    resolveMarketRules,
    buildSigningSnapshot,
    evaluateProbationPolicy,
    MERGE_STRATEGIES,
    REGISTRATION_MODULES,
    EMPLOYMENT_MODULES,
    MARKET_MODULES,
    RULESET_BUNDLES,
    COMPETITION_DEFINITIONS,
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
