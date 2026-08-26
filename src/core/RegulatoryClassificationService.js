// src/core/RegulatoryClassificationService.js
// REG-1 (DESIGN.md 9.18, sección 8.3 del prompt) — clasifica a un jugador
// (formación / plaza de extranjero no comunitario) bajo un CONTEXTO
// explícito (competición + temporada/fecha + módulo). Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Principios que este archivo NUNCA rompe:
//  - nunca usa el nombre del jugador para inferir país/ciudadanía/formación;
//  - la clasificación FEB (art. 28 RGyC) NUNCA se reutiliza para ACB — ACB
//    usa clasificaciones aprobadas por el organizador o snapshots de
//    simulación (sección 5.1/6.3 del prompt de REG-1);
//  - un dato ausente produce `unknown`, NUNCA se convierte silenciosamente
//    en favorable;
//  - el mismo jugador puede obtener otra clasificación bajo otra
//    competición — la caché SIEMPRE incluye competición+temporada/fecha+
//    módulo+versión de datos en su clave.
//
// Módulo puro: no lee DOM, ni `state`, ni variables globales.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const CompetitionRulesModule = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function CR() { return CompetitionRulesModule; }

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // Lista de trabajo (sección 5.3 del prompt de REG-1): países UE + EEE +
  // Suiza. Simulación de referencia — NO es asesoramiento jurídico ni una
  // lista oficial mantenida; documentado como tal en DESIGN.md 9.18.
  const EU_EEA_SWITZERLAND = new Set([
    'ES', 'FR', 'PT', 'IT', 'DE', 'BE', 'NL', 'LU', 'IE', 'DK', 'SE', 'FI', 'AT', 'PL', 'CZ', 'SK',
    'HU', 'SI', 'HR', 'RO', 'BG', 'GR', 'EE', 'LV', 'LT', 'CY', 'MT', 'IS', 'NO', 'LI', 'CH',
  ]);

  // Países con acuerdo de igualdad de trato laboral declarado para esta
  // simulación (sección 5.3: "país con acuerdo de igualdad de trato
  // laboral"). Lista VACÍA por defecto — extensible por datos, nunca una
  // suposición.
  const EQUAL_TREATMENT_AGREEMENT_COUNTRIES = new Set([]);

  function isCommunityOrEqualTreatment(countryCode) {
    return EU_EEA_SWITZERLAND.has(countryCode) || EQUAL_TREATMENT_AGREEMENT_COUNTRIES.has(countryCode);
  }

  // Bandas de edad "segundo año infantil .. segundo año junior" (sección
  // 5.3) — traducidas a categorías de cantera declaradas en cada periodo
  // de formación (`trainingPeriods[].category`), nunca calculadas por edad
  // exacta (el Manual las define por categoría de competición, no por
  // cumpleaños). Categorías reconocidas por esta simulación:
  const FORMATION_AGE_CATEGORIES = new Set(['infantil-2', 'cadete-1', 'cadete-2', 'junior-1', 'junior-2']);

  // ---------------------------------------------------------------------
  // Formación — artículo 28 RGyC FEB (sección 5.3 del prompt). NUNCA se usa
  // para ACB (sección 5.1: "la definición FEB del art. 28 no se puede
  // reutilizar ciegamente para ACB").
  // ---------------------------------------------------------------------
  function classifyFormationFeb28(profile, context) {
    if (!profile) return { status: 'unknown', basis: 'training-history', evidenceIds: [] };

    // Excepción: participación oficial con una selección FEB.
    const nationalTeamEvidence = (profile.nationalTeamAppearances || [])
      .find((a) => a.federationId === 'feb-general' && a.official);
    if (nationalTeamEvidence) {
      return { status: 'qualifies', basis: 'national-team', evidenceIds: [nationalTeamEvidence.id].filter(Boolean) };
    }

    const relevantPeriods = (profile.trainingPeriods || []).filter((period) => (
      period.federationId === 'feb-general'
      && FORMATION_AGE_CATEGORIES.has(period.category)
      && period.monthsCounted !== null && period.monthsCounted >= 8
    ));

    if (!(profile.trainingPeriods || []).length) {
      return { status: 'unknown', basis: 'training-history', evidenceIds: [] };
    }

    const distinctSeasons = new Set(relevantPeriods.map((period) => LD().seasonKeysCovered(period.fromDate, period.toDate)[0]));
    if (distinctSeasons.size < 3) {
      return {
        status: 'does-not-qualify',
        basis: 'training-history',
        evidenceIds: relevantPeriods.map((p) => p.id).filter(Boolean),
      };
    }

    const citizenships = profile.citizenshipsOn ? profile.citizenshipsOn(context.date) : [];
    if (!citizenships.length) {
      return { status: 'unknown', basis: 'training-history', evidenceIds: [] };
    }
    const citizenshipOk = citizenships.some((c) => isCommunityOrEqualTreatment(c.countryCode));
    if (!citizenshipOk) {
      return { status: 'does-not-qualify', basis: 'citizenship', evidenceIds: [] };
    }
    return {
      status: 'qualifies',
      basis: 'training-history',
      evidenceIds: relevantPeriods.map((p) => p.id).filter(Boolean),
    };
  }

  // ---------------------------------------------------------------------
  // Plaza de extranjero no comunitario — sección 5.3 del prompt.
  // ---------------------------------------------------------------------
  function classifyNonCommunitySlotFeb(profile, context) {
    if (!profile) return { status: 'unknown', basis: 'citizenship', evidenceIds: [] };
    const citizenships = profile.citizenshipsOn ? profile.citizenshipsOn(context.date) : [];
    if (!citizenships.length) return { status: 'unknown', basis: 'citizenship', evidenceIds: [] };

    if (citizenships.some((c) => isCommunityOrEqualTreatment(c.countryCode))) {
      return { status: 'does-not-count', basis: 'citizenship', evidenceIds: [] };
    }

    const evidences = profile.equalTreatmentEvidences || [];
    const familyExemption = evidences.find((e) => e.type === 'family-member-of-eu-citizen' && e.status === 'documented');
    if (familyExemption) {
      return { status: 'does-not-count', basis: 'family-exemption', evidenceIds: [familyExemption.id].filter(Boolean) };
    }

    // Ciudadanía de ADOPCIÓN sin vínculo personal/familiar/deportivo
    // acreditado (sección 5.3: control explícito, NUNCA exime).
    const adoptionEvidence = evidences.find((e) => e.type === 'adoption-of-convenience-citizenship');
    if (adoptionEvidence) {
      return { status: 'counts', basis: 'citizenship', evidenceIds: [adoptionEvidence.id].filter(Boolean) };
    }

    // Régimen transitorio Brexit: contrato/visado ANTERIOR al 1 de febrero
    // de 2021, vigente en la fecha evaluada.
    const brexitEvidence = evidences.find((e) => e.type === 'brexit-transitional-contract');
    if (brexitEvidence && citizenships.some((c) => c.countryCode === 'GB')) {
      const signedBeforeCutoff = brexitEvidence.contractStartDate
        ? LD().isBefore(brexitEvidence.contractStartDate, '2021-02-01') : false;
      const stillWithinContract = brexitEvidence.contractStartDate && brexitEvidence.contractEndDate
        ? LD().isWithinInclusive(context.date, brexitEvidence.contractStartDate, brexitEvidence.contractEndDate)
        : false;
      if (signedBeforeCutoff && stillWithinContract) {
        return { status: 'does-not-count', basis: 'legacy-transition', evidenceIds: [brexitEvidence.id].filter(Boolean) };
      }
    }

    return { status: 'counts', basis: 'citizenship', evidenceIds: [] };
  }

  // ---------------------------------------------------------------------
  // ACB — nunca reutiliza el art. 28 FEB. Usa clasificación aprobada por el
  // organizador o snapshot de simulación, ambos guardados en
  // `profile.organizerApprovedClassifications` (sección 6.3 del prompt).
  // ---------------------------------------------------------------------
  function classifyForOrganizerApproved(profile, context) {
    const approved = profile && profile.organizerApprovedClassificationFor
      ? profile.organizerApprovedClassificationFor(context.competitionId, context.seasonKey) : null;
    if (!approved) {
      return {
        formation: { status: 'unknown', basis: 'organizer-approved', evidenceIds: [] },
        nonCommunitySlot: { status: 'unknown', basis: 'organizer-approved', evidenceIds: [] },
      };
    }
    const basis = approved.basis || 'organizer-approved';
    return {
      formation: { status: approved.formation || 'unknown', basis, evidenceIds: [approved.id].filter(Boolean) },
      nonCommunitySlot: { status: approved.nonCommunity || 'unknown', basis, evidenceIds: [approved.id].filter(Boolean) },
    };
  }

  const FEB_ART28_COMPETITION_ID = () => CR().COMPETITION_IDS.PRIMERA_FEB;

  // ---------------------------------------------------------------------
  // Caché contextual — clave incluye jugador+competición+temporada/fecha+
  // módulo/versión de datos (sección 8.3: "una nueva evidencia o versión
  // invalida el caché").
  // ---------------------------------------------------------------------
  function buildCacheKey(playerId, context, classifierVersion) {
    return [
      playerId, context.competitionId, context.seasonKey || context.date, classifierVersion,
    ].join('|');
  }

  const CLASSIFIER_VERSION = 'reg-classification-v1';

  function classifyPlayer(playerId, profile, context, cache) {
    const cacheKey = cache ? buildCacheKey(playerId, context, CLASSIFIER_VERSION) : null;
    if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

    const warnings = [];
    let formation;
    let nonCommunitySlot;

    // Un snapshot aprobado por el organizador o SIMULADO (sección 6.3/10.2
    // del prompt de REG-1) es un OVERRIDE universal — válido para CUALQUIER
    // competición, incluida Primera FEB: el bootstrap de partida no tiene
    // historial formativo/ciudadanía real que darle al clasificador art. 28,
    // así que la partida sería reglamentariamente inviable sin un snapshot
    // explícito. El clasificador art. 28 REAL (`classifyFormationFeb28`)
    // sigue siendo el único camino para Primera FEB cuando NO existe
    // snapshot — nunca se reutiliza para ACB (sección 5.1 del prompt).
    const approvedOverride = profile && profile.organizerApprovedClassificationFor
      ? profile.organizerApprovedClassificationFor(context.competitionId, context.seasonKey) : null;
    if (approvedOverride) {
      const basis = approvedOverride.basis || 'organizer-approved';
      formation = { status: approvedOverride.formation || 'unknown', basis, evidenceIds: [approvedOverride.id].filter(Boolean) };
      nonCommunitySlot = { status: approvedOverride.nonCommunity || 'unknown', basis, evidenceIds: [approvedOverride.id].filter(Boolean) };
    } else if (context.competitionId === FEB_ART28_COMPETITION_ID()) {
      formation = classifyFormationFeb28(profile, context);
      nonCommunitySlot = classifyNonCommunitySlotFeb(profile, context);
    } else {
      formation = { status: 'unknown', basis: 'organizer-approved', evidenceIds: [] };
      nonCommunitySlot = { status: 'unknown', basis: 'organizer-approved', evidenceIds: [] };
    }

    if (formation.status === 'unknown' || nonCommunitySlot.status === 'unknown') {
      warnings.push(
        `Clasificación regulatoria de "${playerId}" incompleta para ${context.competitionId}/${context.seasonKey || context.date}: `
        + 'dato ausente tratado como "unknown" (nunca favorable por omisión).',
      );
    }

    const decision = {
      playerId,
      contextKey: `${context.competitionId}:${context.seasonKey || context.date}`,
      formation,
      nonCommunitySlot,
      trace: {
        sourceRuleIds: approvedOverride
          ? ['organizer-approved-classification']
          : (context.competitionId === FEB_ART28_COMPETITION_ID() ? ['feb-rgyc-art28-classification'] : ['organizer-approved-classification']),
        classifierVersion: CLASSIFIER_VERSION,
        resolutionMode: approvedOverride
          ? 'organizer-approved'
          : (context.competitionId === FEB_ART28_COMPETITION_ID() ? 'computed' : 'organizer-approved'),
      },
      warnings,
    };

    if (cache) cache.set(cacheKey, decision);
    return decision;
  }

  const exportsObj = {
    RegulatoryClassificationService: {
      EU_EEA_SWITZERLAND,
      EQUAL_TREATMENT_AGREEMENT_COUNTRIES,
      FORMATION_AGE_CATEGORIES,
      CLASSIFIER_VERSION,
      isCommunityOrEqualTreatment,
      classifyFormationFeb28,
      classifyNonCommunitySlotFeb,
      classifyForOrganizerApproved,
      classifyPlayer,
      buildCacheKey,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
