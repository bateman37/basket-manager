// src/core/ManagerEmploymentService.js
// ECONOMY-BOARD-1 — comandos de dominio sobre `ManagerBoardRegistry`:
// arranque de manager/spell de una carrera nueva (o migración v1/v2->v3),
// alta/baja EXPLÍCITA de un spell (sin despido/cambio de club jugable
// todavía — ver docs), registro IDEMPOTENTE de la evaluación de temporada
// y alta del perfil de política de junta por club. Convención del
// proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const ManagerBoardEntities = isNode ? require('../entities/ManagerBoard.js') : global.BasketManager;
  const BoardConfidenceServiceModule = isNode ? require('./BoardConfidenceService.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function BoardConfidenceSvc() { return BoardConfidenceServiceModule.BoardConfidenceService; }

  const {
    ManagerProfile, EmploymentSpell, SeasonEvaluation, BoardPolicyProfile,
  } = ManagerBoardEntities;

  function toIso(date) {
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // Manager único de la carrera + spell activo en `controlledClubId` desde
  // `startGameDate` — idempotente por `careerSeed` (una carrera nunca crea
  // un segundo manager, ni al bootstrap ni al migrar un guardado v1/v2).
  function ensureManagerAndActiveSpell(params) {
    const {
      registry, careerSeed, controlledClubId, startGameDate,
    } = params;
    const managerId = `manager:${careerSeed}`;
    let manager = registry.getManager(managerId);
    let createdManager = false;
    if (!manager) {
      manager = new ManagerProfile({ id: managerId, careerSeed, createdAtGameDate: toIso(startGameDate) });
      registry.registerManager(manager);
      createdManager = true;
    }
    let spell = registry.activeSpellForManager(managerId);
    let createdSpell = false;
    if (!spell) {
      spell = new EmploymentSpell({
        id: `employment-spell:${managerId}:${controlledClubId}:${toIso(startGameDate)}`,
        managerId,
        clubId: controlledClubId,
        authorityRole: 'manager',
        startGameDate: toIso(startGameDate),
      });
      registry.registerSpell(spell);
      createdSpell = true;
    }
    return {
      manager, spell, createdManager, createdSpell,
    };
  }

  function startSpell(params) {
    const {
      registry, managerId, clubId, startGameDate,
    } = params;
    const id = `employment-spell:${managerId}:${clubId}:${toIso(startGameDate)}`;
    if (registry.getSpell(id)) return registry.getSpell(id);
    const spell = new EmploymentSpell({
      id, managerId, clubId, authorityRole: 'manager', startGameDate: toIso(startGameDate),
    });
    registry.registerSpell(spell);
    return spell;
  }

  function endSpell(params) {
    const { registry, spellId, endGameDate } = params;
    const spell = registry.getSpell(spellId);
    if (!spell) throw new Error(`ManagerEmploymentService.endSpell: no existe el spell "${spellId}".`);
    if (!spell.isActive) return spell;
    spell.end(toIso(endGameDate));
    return spell;
  }

  // Evaluación de temporada — IDEMPOTENTE por spell+temporada (cerrar/
  // reanudar nunca la duplica, sección 7.2 del prompt).
  function recordSeasonEvaluationIfMissing(params) {
    const {
      registry, employmentSpellId, seasonKey, sportingOutcome, overallConfidenceAtClose, confidenceBreakdownAtClose, atGameDate,
    } = params;
    if (registry.hasEvaluationForSpellSeason(employmentSpellId, seasonKey)) {
      return { created: false, evaluation: registry.evaluationsForSpell(employmentSpellId).find((e) => e.seasonKey === seasonKey) };
    }
    const evaluation = new SeasonEvaluation({
      id: `season-evaluation:${employmentSpellId}:${seasonKey}`,
      employmentSpellId,
      seasonKey,
      sportingOutcome,
      overallConfidenceAtClose,
      confidenceBreakdownAtClose,
      createdAtGameDate: toIso(atGameDate),
    });
    registry.registerEvaluation(evaluation);
    return { created: true, evaluation };
  }

  function ensureBoardPolicyProfile(params) {
    const {
      registry, clubId, fiscalStyle, careerSeed, calculatedAtGameDate,
    } = params;
    if (registry.hasBoardPolicy(clubId)) return { created: false, profile: registry.boardPolicyFor(clubId) };
    const profile = new BoardPolicyProfile({
      id: `board-policy:${clubId}`,
      clubId,
      fiscalStyle,
      provenance: { policyVersion: BoardConfidenceSvc().POLICY_VERSION, careerSeed },
    });
    registry.registerBoardPolicy(profile);
    void calculatedAtGameDate;
    return { created: true, profile };
  }

  // Compara la posición final normalizada de una temporada YA cerrada
  // contra el objetivo deportivo que estaba vigente para ESA temporada
  // (capturado ANTES de que `SeasonGoals.recalculateSportingGoalsForCohort`
  // lo sobrescriba con el de la temporada siguiente) — nunca el texto ya
  // actualizado.
  function classifySeasonSportingOutcome(params) {
    const {
      sportingGoalTextForClosedSeason, rank, totalParticipants,
    } = params;
    if (!totalParticipants || totalParticipants < 2 || !rank) return 'met';
    const targetPercentile = BoardConfidenceSvc().SPORTING_GOAL_TARGET_PERCENTILE[sportingGoalTextForClosedSeason];
    const target = targetPercentile !== undefined ? targetPercentile : 0.25;
    const actual = Math.min(1, Math.max(0, 1 - ((rank - 1) / (totalParticipants - 1))));
    if (actual >= target + 0.15) return 'exceeded';
    if (actual >= target) return 'met';
    return 'failed';
  }

  const exportsObj = {
    ManagerEmploymentService: {
      ensureManagerAndActiveSpell,
      startSpell,
      endSpell,
      recordSeasonEvaluationIfMissing,
      ensureBoardPolicyProfile,
      classifySeasonSportingOutcome,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
