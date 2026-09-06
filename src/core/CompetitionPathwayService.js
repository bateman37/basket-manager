// src/core/CompetitionPathwayService.js
// PATHWAYS-1 (DESIGN.md 10.15) — servicio GENÉRICO que evalúa, valida y
// aplica `CompetitionPathwayRule`s: quién avanza de fase, quién entra en
// otra competición, quién ocupa una plaza de liga la temporada siguiente.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Instancia EXPLÍCITA por carrera (nunca singleton), con dependencias
// INYECTADAS (`world`, `competitionEngine`, catálogo, reloj/instante
// aportado, resolutor de bindings de edición) — nunca lee `state`/DOM,
// `Team.division`, nombre visible, país, reloj de sistema ni
// `Math.random()`. Ningún literal de país/competición aparece en este
// archivo (auditado en `scripts/test-pathways1.js`).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const PathwayEntitiesModule = dep('../entities/CompetitionPathway.js');
  const PathwayCatalogModule = dep('./CompetitionPathwayCatalog.js');

  function Entities() { return PathwayEntitiesModule; }
  function Catalog() { return PathwayCatalogModule; }

  function requireDep(value, label) {
    if (!value) throw new Error(`CompetitionPathwayService: falta "${label}" explícito.`);
    return value;
  }

  // Emparejamiento best-vs-worst por SEED (mismo algoritmo que ya usaba
  // `CompetitionEngine._resolveBracketEntries` para
  // "stage-bracket-final-round-winners", generalizado aquí como seedPolicy
  // de contenido, nunca incrustado en el engine).
  function bestVsWorstPairing(qualifiers) {
    const bySeedAscending = [...qualifiers].sort((a, b) => a.seed - b.seed);
    const pairing = [];
    for (let i = 0; i < Math.floor(bySeedAscending.length / 2); i++) {
      pairing.push([bySeedAscending[i].seed, bySeedAscending[bySeedAscending.length - 1 - i].seed]);
    }
    return pairing;
  }

  class CompetitionPathwayService {
    constructor({
      world, competitionEngine, pathwayCatalog, now, resolveEditionBindings,
    } = {}) {
      this.world = requireDep(world, 'world');
      this.engine = requireDep(competitionEngine, 'competitionEngine');
      this.catalog = pathwayCatalog || Catalog();
      // `now()` -> { instant: 'YYYY-MM-DDTHH:mm:ssZ', timeZoneId }. Aportado
      // SIEMPRE por el llamador (calendario de la carrera) — nunca
      // `Date.now()` dentro de este servicio.
      this._now = requireDep(now, 'now');
      // `resolveEditionBindings(competitionDefinitionId)` -> { formatBindingId,
      // scheduleProfileId, rulesetBundleId, pathwayBindingIds } — quién sabe
      // qué formato/calendario/ruleset/pathways congela una Edition nueva de
      // esa competición es SIEMPRE el paquete de contenido, nunca este
      // servicio genérico.
      this._resolveEditionBindings = requireDep(resolveEditionBindings, 'resolveEditionBindings');
    }

    // -----------------------------------------------------------------
    // Handler de hechos del engine (`stage-qualification`/
    // `competition-qualification`) — invocado SIEMPRE por
    // `CompetitionEngine.setFactHandler()`. Nunca procesa reglas de
    // `next-season-membership` aquí (esas se confirman explícitamente vía
    // `applyTransitionGroup`, trigger `season-transition`).
    // -----------------------------------------------------------------
    handleEngineFact(fact) {
      const edition = this.world.registries.competitionEditions.require(fact.editionId);
      (edition.pathwayBindingIds || []).forEach((pathwayId) => {
        const definition = this.catalog.requirePathwayDefinition(pathwayId);
        const trigger = fact.type === 'round-completed'
          ? {
            type: 'round-completed',
            stageRef: { competitionDefinitionId: edition.competitionDefinitionId, stageKey: fact.stageKey },
            round: fact.round,
          }
          : {
            type: 'stage-completed',
            stageRef: { competitionDefinitionId: edition.competitionDefinitionId, stageKey: fact.stageKey },
          };
        definition.rulesMatchingTrigger(trigger).forEach((rule) => {
          this._applyProgressionRule(definition, rule, { sourceSeasonKey: edition.seasonKey });
        });
      });
    }

    // -----------------------------------------------------------------
    // Resolución PURA de qualifiers desde un selector — nunca muta, nunca
    // consume RNG (invariante 4/5 de PATHWAYS-1).
    // -----------------------------------------------------------------
    _resolveQualifiers(selector, context) {
      if (selector.type === 'standings-range') {
        const standings = this.engine.getStandingsFacts(
          selector.stageRef.competitionDefinitionId, context.seasonKey, selector.stageRef.stageKey,
        );
        const slice = standings.slice(selector.fromRank - 1, selector.toRank);
        const expected = selector.toRank - selector.fromRank + 1;
        if (slice.length !== expected) {
          throw new Error(
            `CompetitionPathwayService: selector "standings-range" de "${selector.stageRef.competitionDefinitionId}"`
            + `/"${selector.stageRef.stageKey}" esperaba ${expected} clasificados (${selector.fromRank}-${selector.toRank}) `
            + `y encontró ${slice.length}.`,
          );
        }
        return slice.map((s, i) => ({ participantId: s.participantId, seed: selector.fromRank + i }));
      }
      if (selector.type === 'bracket-final-round-winners') {
        const winners = this.engine.getBracketFinalRoundWinners(
          selector.stageRef.competitionDefinitionId, context.seasonKey, selector.stageRef.stageKey,
        );
        if (!winners) {
          throw new Error(
            `CompetitionPathwayService: selector "bracket-final-round-winners" de "${selector.stageRef.stageKey}" `
            + 'todavía no tiene ronda final decidida.',
          );
        }
        return winners;
      }
      if (selector.type === 'bracket-champion') {
        const champion = this.engine.getBracketChampion(
          selector.stageRef.competitionDefinitionId, context.seasonKey, selector.stageRef.stageKey,
        );
        if (!champion) {
          throw new Error(`CompetitionPathwayService: selector "bracket-champion" de "${selector.stageRef.stageKey}" sin campeón todavía.`);
        }
        return [{ participantId: champion.participantId, seed: champion.seed }];
      }
      throw new Error(`CompetitionPathwayService: selector "${selector.type}" no resoluble fuera de una transición de temporada.`);
    }

    _applySeedPolicy(seedPolicy, qualifiers) {
      if (seedPolicy === 'best-vs-worst-by-seed') return { qualifiers, firstRoundPairing: bestVsWorstPairing(qualifiers) };
      // 'source-rank'/'preserve-source-seed'/'none': se conserva el seed ya
      // calculado por el selector (rango real o seed de origen) — el
      // pairing lo declara SIEMPRE el formato (cuadro fijo), nunca este
      // servicio.
      return { qualifiers, firstRoundPairing: null };
    }

    _buildReceiptId(definition, rule, sourceSeasonKey) {
      return `pathway:${definition.id}:${rule.id}:${sourceSeasonKey}`;
    }

    // Aplica una regla `stage-qualification`/`competition-qualification` —
    // idempotente: si el receipt ya existe para este hecho, no repite nada
    // (invariante 3/14 de PATHWAYS-1).
    _applyProgressionRule(definition, rule, { sourceSeasonKey }) {
      const receiptId = this._buildReceiptId(definition, rule, sourceSeasonKey);
      const existing = this.world.registries.pathwayReceipts.get(receiptId);
      if (existing) return existing;

      const qualifiers = this._resolveQualifiers(rule.selector, { seasonKey: sourceSeasonKey });
      const { qualifiers: finalQualifiers, firstRoundPairing } = this._applySeedPolicy(rule.seedPolicy, qualifiers);
      const { instant, timeZoneId } = this._now();

      if (rule.kind === 'stage-qualification') {
        const edition = this.world.registries.competitionEditions.require(
          `edition:${rule.selector.stageRef.competitionDefinitionId}:${sourceSeasonKey}`,
        );
        this.engine.activateStageFromQualifiers(edition.id, rule.destination.stageKey, finalQualifiers, {
          receiptId, firstRoundPairing,
        });
      } else if (rule.kind === 'competition-qualification') {
        const bindings = this._resolveEditionBindings(rule.destination.competitionDefinitionId);
        this.engine.activateEditionFromDecision({
          competitionDefinitionId: rule.destination.competitionDefinitionId,
          seasonKey: sourceSeasonKey,
          startDate: null,
          formatBindingId: bindings.formatBindingId,
          scheduleProfileId: bindings.scheduleProfileId,
          rulesetBundleId: bindings.rulesetBundleId,
          pathwayBindingIds: bindings.pathwayBindingIds || [],
          qualifiers: finalQualifiers,
          receiptId,
        });
      } else {
        throw new Error(`CompetitionPathwayService: kind "${rule.kind}" no se aplica vía hecho del engine (usa applyTransitionGroup).`);
      }

      const receipt = new (Entities().CompetitionPathwayReceipt)({
        id: receiptId,
        pathwayDefinitionId: definition.id,
        pathwayVersion: definition.version,
        ruleId: rule.id,
        kind: rule.kind,
        sourceSeasonKey,
        trigger: rule.trigger,
        destination: rule.destination,
        qualifiers: finalQualifiers,
        firstRoundPairing,
        outcomeCode: rule.outcomeCode,
        resolvedAt: instant,
        timeZoneId,
        status: 'applied',
      });
      this.world.registries.registerPathwayReceipt(receipt);
      return receipt;
    }

    // -----------------------------------------------------------------
    // Consulta PURA de disposición — nunca muta. Un llamador (cierre de
    // temporada) la usa para decidir si ya puede confirmar el grupo.
    // -----------------------------------------------------------------
    isTransitionGroupReady(pathwayId, groupId, { sourceSeasonKey }) {
      const definition = this.catalog.requirePathwayDefinition(pathwayId);
      const rules = definition.rulesForTransitionGroup(groupId);
      if (!rules.length) throw new Error(`CompetitionPathwayService: el pathway "${pathwayId}" no declara transitionGroupId "${groupId}".`);
      const notReady = [];
      rules.forEach((rule) => {
        if (rule.selector.type === 'remaining-participants') return;
        const { stageRef } = rule.selector;
        if (!this.engine.isStageCompleted(stageRef.competitionDefinitionId, sourceSeasonKey, stageRef.stageKey)) {
          notReady.push({ ruleId: rule.id, stageRef });
        }
      });
      return { ready: notReady.length === 0, notReady };
    }

    // -----------------------------------------------------------------
    // Confirma un transition group COMPLETO (sección 7/8/10.3 del prompt):
    // preflight puro (sin ninguna escritura) -> validación de
    // cardinalidad/exclusividad -> commit atómico (Editions/Stages/Entries
    // de la temporada siguiente + receipt). Idempotente por
    // (transitionGroupId, fromSeasonKey, targetSeasonKey).
    // -----------------------------------------------------------------
    applyTransitionGroup(pathwayId, groupId, { fromSeasonKey, targetSeasonKey }) {
      const existingReceipt = this.world.registries.seasonTransitionReceipts.existingFor(groupId, fromSeasonKey, targetSeasonKey);
      if (existingReceipt) return { receipt: existingReceipt, idempotent: true };

      const definition = this.catalog.requirePathwayDefinition(pathwayId);
      const rules = definition.rulesForTransitionGroup(groupId);
      if (!rules.length) throw new Error(`CompetitionPathwayService: el pathway "${pathwayId}" no declara transitionGroupId "${groupId}".`);
      const groupMeta = definition.transitionGroups[groupId];

      const readiness = this.isTransitionGroupReady(pathwayId, groupId, { sourceSeasonKey: fromSeasonKey });
      if (!readiness.ready) {
        throw new Error(
          `CompetitionPathwayService: transitionGroupId "${groupId}" todavía no está resoluble — faltan `
          + `${readiness.notReady.map((n) => n.ruleId).join(', ')}.`,
        );
      }

      // --- PREFLIGHT (puro, sin escrituras) --------------------------------
      const explicitRules = rules.filter((rule) => rule.selector.type !== 'remaining-participants');
      const remainingRules = rules.filter((rule) => rule.selector.type === 'remaining-participants');

      const explicitByRule = [];
      const movedOutOf = new Map(); // competitionDefinitionId -> Set(participantId)
      const movedIntoOf = new Map(); // competitionDefinitionId -> [{participantId, seed}]
      const participantDestinations = new Map(); // participantId -> destination competitionDefinitionId

      explicitRules.forEach((rule) => {
        const qualifiers = this._resolveQualifiers(rule.selector, { seasonKey: fromSeasonKey });
        const sourceCompetitionDefinitionId = rule.selector.stageRef.competitionDefinitionId;
        const destinationCompetitionDefinitionId = rule.destination.competitionDefinitionId;
        qualifiers.forEach((q) => {
          if (participantDestinations.has(q.participantId)) {
            throw new Error(
              `CompetitionPathwayService: el participante "${q.participantId}" clasifica para más de una plaza `
              + `en el grupo "${groupId}" (invariante 11 — una sola liga destino por temporada).`,
            );
          }
          participantDestinations.set(q.participantId, destinationCompetitionDefinitionId);
        });
        if (!movedOutOf.has(sourceCompetitionDefinitionId)) movedOutOf.set(sourceCompetitionDefinitionId, new Set());
        qualifiers.forEach((q) => movedOutOf.get(sourceCompetitionDefinitionId).add(q.participantId));
        if (!movedIntoOf.has(destinationCompetitionDefinitionId)) movedIntoOf.set(destinationCompetitionDefinitionId, []);
        movedIntoOf.get(destinationCompetitionDefinitionId).push(...qualifiers);
        explicitByRule.push({
          rule, qualifiers, sourceCompetitionDefinitionId, destinationCompetitionDefinitionId,
        });
      });

      const membershipByCompetitionDefinitionId = new Map();
      remainingRules.forEach((rule) => {
        const sourceCompetitionDefinitionId = rule.selector.sourceCompetitionDefinitionId;
        const destinationCompetitionDefinitionId = rule.destination.competitionDefinitionId;
        const sourceEdition = this.world.registries.competitionEditions.require(
          `edition:${sourceCompetitionDefinitionId}:${fromSeasonKey}`,
        );
        const currentMembers = [...new Set(
          this.world.registries.competitionEntries.forEdition(sourceEdition.id).map((e) => e.participantId),
        )];
        const outIds = movedOutOf.get(sourceCompetitionDefinitionId) || new Set();
        const retained = currentMembers.filter((id) => !outIds.has(id));
        const incoming = movedIntoOf.get(destinationCompetitionDefinitionId) || [];
        const combinedIds = [...new Set([...retained, ...incoming.map((q) => q.participantId)])].sort();
        const membership = combinedIds.map((participantId, index) => ({ participantId, seed: index + 1 }));
        membershipByCompetitionDefinitionId.set(destinationCompetitionDefinitionId, membership);
      });

      // Cardinalidad EXACTA declarada por el grupo (si el contenido la fija).
      membershipByCompetitionDefinitionId.forEach((membership, competitionDefinitionId) => {
        const expected = groupMeta.expectedCardinalityByCompetitionDefinitionId[competitionDefinitionId];
        if (expected !== undefined && membership.length !== expected) {
          throw new Error(
            `CompetitionPathwayService: la competición "${competitionDefinitionId}" esperaba ${expected} `
            + `participantes en "${targetSeasonKey}" y el pathway calculó ${membership.length}.`,
          );
        }
      });
      // Exclusividad de pirámide: un participante en como máximo una plaza.
      if (groupMeta.exclusivePyramid) {
        const seen = new Map();
        membershipByCompetitionDefinitionId.forEach((membership, competitionDefinitionId) => {
          membership.forEach(({ participantId }) => {
            if (seen.has(participantId)) {
              throw new Error(
                `CompetitionPathwayService: el participante "${participantId}" aparece en más de una plaza de "${groupId}" `
                + `("${seen.get(participantId)}" y "${competitionDefinitionId}").`,
              );
            }
            seen.set(participantId, competitionDefinitionId);
          });
        });
      }

      // --- COMMIT ATÓMICO --------------------------------------------------
      // Toda la validación de arriba es PURA (ninguna escritura todavía) —
      // solo a partir de aquí se registra algo, y solo si TODO lo anterior
      // pasó (sección 8.4 del prompt).
      const { instant, timeZoneId } = this._now();
      const transitionReceiptId = `season-transition:${groupId}:${fromSeasonKey}:${targetSeasonKey}`;

      const ruleReceipts = explicitByRule.map(({
        rule, qualifiers, sourceCompetitionDefinitionId, destinationCompetitionDefinitionId,
      }) => {
        const receiptId = this._buildReceiptId(definition, rule, fromSeasonKey);
        const existing = this.world.registries.pathwayReceipts.get(receiptId);
        if (existing) return existing;
        const receipt = new (Entities().CompetitionPathwayReceipt)({
          id: receiptId,
          pathwayDefinitionId: definition.id,
          pathwayVersion: definition.version,
          ruleId: rule.id,
          kind: rule.kind,
          sourceSeasonKey: fromSeasonKey,
          trigger: rule.trigger,
          destination: rule.destination,
          qualifiers,
          outcomeCode: rule.outcomeCode,
          resolvedAt: instant,
          timeZoneId,
          status: 'applied',
          trace: { sourceCompetitionDefinitionId, destinationCompetitionDefinitionId, transitionGroupId: groupId },
        });
        this.world.registries.registerPathwayReceipt(receipt);
        return receipt;
      });

      const createdEditionIds = [];
      const createdEntryIds = [];
      const memberships = [];
      [...membershipByCompetitionDefinitionId.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .forEach(([competitionDefinitionId, membership]) => {
          this.engine.completePreviousEditions(competitionDefinitionId);
          const bindings = this._resolveEditionBindings(competitionDefinitionId);
          const { edition } = this.engine.activateEditionFromDecision({
            competitionDefinitionId,
            seasonKey: targetSeasonKey,
            startDate: null,
            formatBindingId: bindings.formatBindingId,
            scheduleProfileId: bindings.scheduleProfileId,
            rulesetBundleId: bindings.rulesetBundleId,
            pathwayBindingIds: bindings.pathwayBindingIds || [],
            qualifiers: membership,
            receiptId: transitionReceiptId,
          });
          createdEditionIds.push(edition.id);
          this.world.registries.competitionEntries.forEdition(edition.id).forEach((entry) => createdEntryIds.push(entry.id));
          memberships.push({
            competitionDefinitionId, editionId: edition.id, participantIds: membership.map((m) => m.participantId),
          });
        });

      const moves = explicitByRule.flatMap(({
        rule, qualifiers, sourceCompetitionDefinitionId, destinationCompetitionDefinitionId,
      }) => qualifiers.map((q) => ({
        participantId: q.participantId,
        outcomeCode: rule.outcomeCode,
        fromCompetitionDefinitionId: sourceCompetitionDefinitionId,
        toCompetitionDefinitionId: destinationCompetitionDefinitionId,
        sourceReceiptId: this._buildReceiptId(definition, rule, fromSeasonKey),
      })));

      const transitionReceipt = new (Entities().CompetitionSeasonTransitionReceipt)({
        id: transitionReceiptId,
        pathwayDefinitionId: definition.id,
        pathwayVersion: definition.version,
        transitionGroupId: groupId,
        fromSeasonKey,
        targetSeasonKey,
        committedAt: instant,
        memberships,
        moves,
        createdEditionIds,
        createdEntryIds,
        status: 'committed',
      });
      this.world.registries.registerSeasonTransitionReceipt(transitionReceipt);
      void ruleReceipts;
      return { receipt: transitionReceipt, idempotent: false };
    }
  }

  const exportsObj = { CompetitionPathwayService };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
