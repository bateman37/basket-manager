// src/core/SquadEligibilityService.js
// REG-1 (DESIGN.md 9.18, sección 8.5 del prompt) — valida el CONJUNTO de
// una convocatoria (no solo cada jugador por separado) y ofrece la
// selección determinista por restricciones que usan CPU y usuario POR
// IGUAL. Convención del proyecto: identificadores en inglés, comentarios
// en español.
//
// No decide normativa por su cuenta — consume `resolved.registration` de
// `CompetitionRules.resolveRules()` (vía RegistrationService) y las
// evaluaciones individuales de `EligibilityService`.

(function (global) {
  function findQuotaBand(resolved, squadSize) {
    const bands = (resolved.registration && resolved.registration.quotaBands) || [];
    return bands.find((band) => squadSize >= band.rosterMin && squadSize <= band.rosterMax) || null;
  }

  function isFormationQualifying(evaluation) {
    return evaluation && evaluation.classification && evaluation.classification.formation.status === 'qualifies';
  }

  function isNonCommunityCounting(evaluation) {
    return evaluation && evaluation.classification && evaluation.classification.nonCommunitySlot.status === 'counts';
  }

  // ---------------------------------------------------------------------
  // Validación del CONJUNTO — `evaluations`: Map<playerId, resultado de
  // EligibilityService.evaluateEligibility>. Devuelve un INFORME completo
  // (nunca solo el primer error, sección 8.5 del prompt).
  // ---------------------------------------------------------------------
  function validateSquad(playerIds, evaluations, resolved, options) {
    const findings = [];
    const range = (resolved.registration && resolved.registration.matchActRange) || resolved.squadRules;
    // `options.effectiveMin`: mínimo real de ESTE partido tras aplicar la
    // excepción médica de convocatoria (DESIGN.md, "Excepción médica de
    // convocatoria" — `Medical.resolveEffectiveSquadMinimum()`), nunca por
    // encima del mínimo normal de la competición ni calculado aquí (lo
    // resuelve quien conoce la disponibilidad médica real: CpuLineup para
    // la CPU, game.js para el usuario). Sin este dato se exige el mínimo
    // normal, igual que antes de esta corrección.
    const effectiveMin = range
      ? Math.min(range.min, options && options.effectiveMin != null ? options.effectiveMin : range.min)
      : null;

    if (range && (playerIds.length < effectiveMin || playerIds.length > range.max)) {
      findings.push({
        code: 'SQUAD_SIZE_OUT_OF_RANGE', severity: 'blocking',
        params: { min: effectiveMin, max: range.max, actual: playerIds.length },
      });
    }

    const seen = new Set();
    const duplicates = new Set();
    playerIds.forEach((id) => {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    });
    if (duplicates.size) {
      findings.push({ code: 'DUPLICATE_PLAYER_IN_SQUAD', severity: 'blocking', params: { playerIds: [...duplicates] } });
    }

    const evaluationList = playerIds.map((id) => evaluations.get(id)).filter(Boolean);
    const ineligible = evaluationList.filter((evaluation) => !evaluation.eligible).map((evaluation) => evaluation.playerId);
    if (ineligible.length) {
      findings.push({ code: 'INELIGIBLE_PLAYER_IN_SQUAD', severity: 'blocking', params: { playerIds: ineligible } });
    }

    const band = findQuotaBand(resolved, playerIds.length);
    const formationCount = evaluationList.filter(isFormationQualifying).length;
    if (band && formationCount < band.formationMinimum) {
      findings.push({
        code: 'FORMATION_QUOTA_NOT_MET', severity: 'blocking',
        params: { required: band.formationMinimum, actual: formationCount, band },
      });
    }

    const nonCommunityCap = resolved.registration && resolved.registration.nonCommunityCap;
    const nonCommunityCount = evaluationList.filter(isNonCommunityCounting).length;
    if (nonCommunityCap && nonCommunityCount > nonCommunityCap.max) {
      findings.push({
        code: 'NON_COMMUNITY_CAP_EXCEEDED', severity: 'blocking',
        params: { max: nonCommunityCap.max, actual: nonCommunityCount },
      });
    }

    return {
      valid: findings.filter((f) => f.severity === 'blocking').length === 0,
      findings,
      counts: {
        squadSize: playerIds.length,
        formationCount,
        formationRequired: band ? band.formationMinimum : null,
        nonCommunityCount,
        nonCommunityMax: nonCommunityCap ? nonCommunityCap.max : null,
      },
    };
  }

  function stableSort(list) {
    return [...list].sort((a, b) => (b.qualityScore - a.qualityScore) || (a.playerId < b.playerId ? -1 : 1));
  }

  // ---------------------------------------------------------------------
  // Selección determinista por restricciones (sección 11.3 del prompt de
  // REG-1) — usada por CPU y disponible para validar la elección del
  // usuario. Orden de objetivos: (1) encontrar una solución LEGAL con
  // (2) el tamaño deseado, luego (3) reparar cupos con el MENOR coste de
  // calidad posible, desempatando siempre por `playerId` (determinista).
  //
  // `candidates`: [{ playerId, qualityScore, evaluation }] — SOLO
  // candidatos ya individualmente elegibles (filtrar antes de llamar).
  // Nunca decide posición/rotación (eso sigue siendo CpuLineup.js).
  //
  // Devuelve `{ ok: true, playerIds }` o `{ ok: false, diagnostic }` — NUNCA
  // una convocatoria que ignore un cupo en silencio.
  // ---------------------------------------------------------------------
  function selectLegalSquad(candidates, desiredSize, resolved) {
    if (candidates.length < desiredSize) {
      return {
        ok: false,
        diagnostic: { code: 'NOT_ENOUGH_ELIGIBLE_CANDIDATES', available: candidates.length, required: desiredSize },
      };
    }
    const ranked = stableSort(candidates);
    const band = findQuotaBand(resolved, desiredSize);
    const formationMinimum = band ? band.formationMinimum : 0;
    const nonCommunityCap = resolved.registration && resolved.registration.nonCommunityCap;
    const nonCommunityMax = nonCommunityCap ? nonCommunityCap.max : Infinity;

    let selected = ranked.slice(0, desiredSize);
    const outside = () => ranked.filter((c) => !selected.some((s) => s.playerId === c.playerId));

    const formationCountOf = (list) => list.filter((c) => isFormationQualifying(c.evaluation)).length;
    const nonCommunityCountOf = (list) => list.filter((c) => isNonCommunityCounting(c.evaluation)).length;

    // --- Reparación 1: cupo de formación --------------------------------
    if (formationCountOf(selected) < formationMinimum) {
      const replacements = outside()
        .filter((c) => isFormationQualifying(c.evaluation))
        .sort((a, b) => (b.qualityScore - a.qualityScore) || (a.playerId < b.playerId ? -1 : 1));
      // Se retira primero a quien NO es de formación (para no deshacer esta
      // misma reparación), de peor a mejor calidad.
      const removable = [...selected]
        .filter((c) => !isFormationQualifying(c.evaluation))
        .sort((a, b) => (a.qualityScore - b.qualityScore) || (b.playerId < a.playerId ? -1 : 1));
      let r = 0;
      while (formationCountOf(selected) < formationMinimum && r < replacements.length && r < removable.length) {
        const idx = selected.findIndex((c) => c.playerId === removable[r].playerId);
        selected[idx] = replacements[r];
        r += 1;
      }
    }

    // --- Reparación 2: máximo de no comunitarios ------------------------
    if (nonCommunityCountOf(selected) > nonCommunityMax) {
      const replacements = outside()
        // Prioriza sustitutos que TAMBIÉN sean de formación (para no
        // deshacer la reparación 1).
        .filter((c) => !isNonCommunityCounting(c.evaluation))
        .sort((a, b) => (Number(isFormationQualifying(b.evaluation)) - Number(isFormationQualifying(a.evaluation)))
          || (b.qualityScore - a.qualityScore) || (a.playerId < b.playerId ? -1 : 1));
      const removable = [...selected]
        .filter((c) => isNonCommunityCounting(c.evaluation))
        // Se retira primero a quien NO es de formación, de peor calidad.
        .sort((a, b) => (Number(isFormationQualifying(a.evaluation)) - Number(isFormationQualifying(b.evaluation)))
          || (a.qualityScore - b.qualityScore) || (b.playerId < a.playerId ? -1 : 1));
      let r = 0;
      while (nonCommunityCountOf(selected) > nonCommunityMax && r < replacements.length && r < removable.length) {
        const idx = selected.findIndex((c) => c.playerId === removable[r].playerId);
        selected[idx] = replacements[r];
        r += 1;
      }
    }

    // --- Verificación FINAL: nunca se devuelve una convocatoria ilegal --
    const finalFormation = formationCountOf(selected);
    const finalNonCommunity = nonCommunityCountOf(selected);
    if (finalFormation < formationMinimum) {
      return {
        ok: false,
        diagnostic: { code: 'FORMATION_QUOTA_INFEASIBLE', required: formationMinimum, best: finalFormation },
      };
    }
    if (finalNonCommunity > nonCommunityMax) {
      return {
        ok: false,
        diagnostic: { code: 'NON_COMMUNITY_CAP_INFEASIBLE', max: nonCommunityMax, best: finalNonCommunity },
      };
    }

    return { ok: true, playerIds: selected.map((c) => c.playerId), selected };
  }

  // Contadores en vivo para la UI (sección 11.2 del prompt): seleccionados/
  // mínimo/máximo, formación requerida/actual, no comunitarios actual/
  // máximo. Reutiliza `validateSquad` para no duplicar el cómputo.
  function buildLiveCounters(playerIds, evaluations, resolved, options) {
    const validation = validateSquad(playerIds, evaluations, resolved, options);
    const range = (resolved.registration && resolved.registration.matchActRange) || resolved.squadRules;
    const effectiveMin = range
      ? Math.min(range.min, options && options.effectiveMin != null ? options.effectiveMin : range.min)
      : null;
    return {
      squadSize: playerIds.length,
      min: effectiveMin,
      max: range ? range.max : null,
      formationCurrent: validation.counts.formationCount,
      formationRequired: validation.counts.formationRequired,
      nonCommunityCurrent: validation.counts.nonCommunityCount,
      nonCommunityMax: validation.counts.nonCommunityMax,
      onCourtConstraint: (resolved.registration && resolved.registration.onCourtConstraints) || null,
    };
  }

  const exportsObj = {
    SquadEligibilityService: {
      findQuotaBand,
      isFormationQualifying,
      isNonCommunityCounting,
      validateSquad,
      selectLegalSquad,
      buildLiveCounters,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
