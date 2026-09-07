// src/core/NationalTeamService.js
// NATIONAL-TEAMS-1 (DESIGN.md 10.17) — único dueño de las transiciones y
// commits del dominio nacional: abrir ventana, guardar lista preliminar,
// finalizar lista, notificar convocatorias, iniciar/terminar servicio
// internacional, retirar justificadamente y registrar una aparición
// oficial. Convención del proyecto: identificadores en inglés, comentarios
// en español.
//
// Cada comando valida TODO primero y solo entonces muta — un fallo no deja
// squad/callups/estados parciales (sección 4.3 del prompt). No implementa
// una IA de seleccionador: recibe SIEMPRE `playerIds`/decisiones ya
// tomadas por su caller — nunca elige por overall/reputación/club/posición
// ni simula negativas/sanciones/dietas/primas/seguros/disputas.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const EntitiesModule = dep('../entities/NationalTeam.js');
  const RulesModule = dep('./NationalTeamRules.js');
  const NationalEligibilityModule = dep('./NationalTeamEligibilityService.js');

  function requireDep(value, label) {
    if (!value) throw new Error(`NationalTeamService: falta "${label}" explícito.`);
    return value;
  }

  class NationalTeamService {
    constructor({
      nationalTeamRegistry, world, playerRegistry, rulesetBundleId,
    } = {}) {
      this.registry = requireDep(nationalTeamRegistry, 'nationalTeamRegistry');
      this.world = requireDep(world, 'world');
      // Opcional: sin ella, `notifyCallUps()` exige que el caller aporte
      // `clubTeamId` explícito por jugador (nunca inventa una afiliación).
      this.playerRegistry = playerRegistry || null;
      this.rulesetBundleId = rulesetBundleId || RulesModule.FIBA_NATIONAL_TEAMS_RULESET_ID;
    }

    _requireNationalTeam(nationalTeamId) {
      const team = this.world.registries.teams.require(nationalTeamId);
      if (team.teamKind !== 'national-team') {
        throw new Error(`NationalTeamService: "${nationalTeamId}" no es un equipo "national-team" (es "${team.teamKind}").`);
      }
      return team;
    }

    // --- Ventana -----------------------------------------------------------
    openWindow(data) {
      const window = new EntitiesModule.NationalTeamWindow({
        ...data,
        rulesetBundleId: data.rulesetBundleId || this.rulesetBundleId,
        status: 'planned',
      });
      return this.registry.registerWindow(window);
    }

    setWindowStatus(windowId, status) {
      const window = this.registry.requireWindow(windowId);
      window.setStatus(status);
      return window;
    }

    // --- Lista preliminar/final ---------------------------------------------
    createSelection({
      id, nationalTeamId, windowId, seasonKey,
    }) {
      this._requireNationalTeam(nationalTeamId);
      const window = this.registry.requireWindow(windowId);
      const selection = new EntitiesModule.NationalTeamSelection({
        id, nationalTeamId, windowId, seasonKey, rulesetBundleId: window.rulesetBundleId,
      });
      return this.registry.registerSelection(selection);
    }

    savePreliminaryList(selectionId, playerIds, options = {}) {
      const selection = this.registry.requireSelection(selectionId);
      const rules = RulesModule.requireNationalTeamRuleset(selection.rulesetBundleId).rules;
      const unique = [...new Set(playerIds)];
      if (unique.length !== playerIds.length) {
        throw new Error(`NationalTeamService.savePreliminaryList: "${selectionId}" — la lista preliminar contiene jugadores duplicados.`);
      }
      if (!unique.length || unique.length > rules.preliminaryListMax.value) {
        throw new Error(
          `NationalTeamService.savePreliminaryList: "${selectionId}" — la lista preliminar debe tener entre 1 y `
          + `${rules.preliminaryListMax.value} jugadores (recibidos ${unique.length}).`,
        );
      }
      // Validar TODO antes de mutar (sección 4.3): el propio `setStatus`
      // ya rechaza la transición si `selection.status` no es 'draft'.
      selection.preliminaryPlayerIds = unique;
      selection.preliminaryFiledAt = options.filedAtGameDate || null;
      selection.setStatus('preliminary-filed');
      return selection;
    }

    // `evaluateEligibilityFn(playerId) -> resultado de
    // NationalTeamEligibilityService.evaluateNationalEligibility` — inyectado
    // por el caller (que ya tiene los `deps` reales); este servicio nunca
    // construye esa dependencia por sí mismo.
    finalizeList(selectionId, finalPlayerIds, evaluateEligibilityFn, options = {}) {
      const selection = this.registry.requireSelection(selectionId);
      if (selection.status !== 'preliminary-filed') {
        throw new Error(`NationalTeamService.finalizeList: "${selectionId}" — hace falta una lista preliminar presentada primero (estado actual "${selection.status}").`);
      }
      const rules = RulesModule.requireNationalTeamRuleset(selection.rulesetBundleId).rules;
      const unique = [...new Set(finalPlayerIds)];
      if (unique.length !== finalPlayerIds.length) {
        throw new Error(`NationalTeamService.finalizeList: "${selectionId}" — la lista final contiene jugadores duplicados.`);
      }
      if (unique.length < rules.finalListMin.value || unique.length > rules.finalListMax.value) {
        throw new Error(
          `NationalTeamService.finalizeList: "${selectionId}" — la lista final debe tener entre `
          + `${rules.finalListMin.value} y ${rules.finalListMax.value} jugadores (recibidos ${unique.length}).`,
        );
      }
      const notInPreliminary = unique.filter((id) => !selection.preliminaryPlayerIds.includes(id));
      if (notInPreliminary.length) {
        throw new Error(`NationalTeamService.finalizeList: "${selectionId}" — jugadores fuera de la lista preliminar aprobada: ${notInPreliminary.join(', ')}.`);
      }
      // Invariante 9: "unknown"/"pending-decision" nunca se convierten en
      // elegibles — cada jugador de la lista final se evalúa AQUÍ, antes de
      // mutar nada.
      let restrictedCount = 0;
      const evaluations = unique.map((playerId) => {
        const evaluation = evaluateEligibilityFn(playerId);
        if (!NationalEligibilityModule.NationalTeamEligibilityService.isFinalListEligible(evaluation.status)) {
          throw new Error(
            `NationalTeamService.finalizeList: "${selectionId}" — el jugador "${playerId}" no es elegible para la `
            + `lista final (status "${evaluation.status}").`,
          );
        }
        if (evaluation.status === 'eligible-restricted') restrictedCount += 1;
        return { playerId, evaluation };
      });
      if (restrictedCount > rules.maxRestrictedInFinalList.value) {
        throw new Error(
          `NationalTeamService.finalizeList: "${selectionId}" — la lista final supera el máximo de `
          + `${rules.maxRestrictedInFinalList.value} jugador(es) con condición "restricted" (tiene ${restrictedCount}).`,
        );
      }
      selection.finalPlayerIds = unique;
      selection.finalFiledAt = options.filedAtGameDate || null;
      selection.warnings = evaluations.filter((e) => e.evaluation.warnings.length).flatMap((e) => e.evaluation.warnings);
      selection.setStatus('final-filed');
      return selection;
    }

    // --- Convocatorias -------------------------------------------------
    // `resolveClubTeamId(playerId)` opcional — por defecto usa
    // `this.playerRegistry.get(playerId).teamId` (la foto REAL de afiliación
    // de club en el momento de convocar, nunca inventada).
    notifyCallUps(selectionId, options = {}) {
      const selection = this.registry.requireSelection(selectionId);
      if (selection.status !== 'final-filed') {
        throw new Error(`NationalTeamService.notifyCallUps: "${selectionId}" — hace falta una lista final presentada primero (estado actual "${selection.status}").`);
      }
      const resolveClubTeamId = options.resolveClubTeamId || ((playerId) => {
        const player = this.playerRegistry ? this.playerRegistry.get(playerId) : null;
        return player ? player.teamId : null;
      });
      const callUps = selection.finalPlayerIds.map((playerId) => {
        const id = options.callUpIdFor ? options.callUpIdFor(playerId) : `callup:${selection.id}:${playerId}`;
        const callUp = new EntitiesModule.NationalTeamCallUp({
          id,
          selectionId: selection.id,
          windowId: selection.windowId,
          nationalTeamId: selection.nationalTeamId,
          playerId,
          clubTeamId: resolveClubTeamId(playerId),
          status: 'selected',
        });
        this.registry.registerCallUp(callUp);
        callUp.setStatus('notified', { notifiedAt: options.notifiedAtGameDate || null });
        return callUp;
      });
      return callUps;
    }

    // Retirada justificada ANTES de incorporarse (sección 4.3: "retirar
    // justificadamente antes de incorporarse") — nunca disponible una vez
    // `joined` (eso es terminación anticipada, fuera de alcance de esta
    // entrega, no una retirada).
    withdrawJustified(callUpId, reasonCode, options = {}) {
      const callUp = this.registry.requireCallUp(callUpId);
      if (callUp.status !== 'selected' && callUp.status !== 'notified') {
        throw new Error(`NationalTeamService.withdrawJustified: "${callUpId}" — solo se puede retirar antes de incorporarse (estado actual "${callUp.status}").`);
      }
      callUp.setStatus('withdrawn', { withdrawalReason: { code: reasonCode || 'unspecified', notes: options.notes || null } });
      return callUp;
    }

    // --- Servicio internacional -------------------------------------------
    // Convierte los callups 'notified' de la ventana a 'joined' y activa (o
    // reutiliza) el squad `national-team-duty` de cada selección afectada,
    // con las MISMAS instancias de `Player` — nunca toca `player.teamId`
    // (invariante 3). Idempotente: un callup ya 'joined' se ignora.
    startInternationalService(windowId, options = {}) {
      const window = this.registry.requireWindow(windowId);
      window.setStatus('active');
      const pending = this.registry.callUpsForWindow(windowId).filter((c) => c.status === 'notified');
      const squadsByNationalTeam = new Map();
      pending.forEach((callUp) => {
        if (!this.playerRegistry) {
          throw new Error('NationalTeamService.startInternationalService: falta "playerRegistry" para resolver la instancia real del jugador.');
        }
        const player = this.playerRegistry.require(callUp.playerId);
        let squad = squadsByNationalTeam.get(callUp.nationalTeamId);
        if (!squad) {
          squad = this.world.registries.squads.forTeam(callUp.nationalTeamId)
            .find((s) => s.status === 'active' && s.membershipContext === 'national-team-duty') || null;
          if (!squad) {
            const SquadModule = dep('../entities/Squad.js');
            squad = new SquadModule.Squad({
              id: options.squadIdFor ? options.squadIdFor(callUp.nationalTeamId, windowId) : `squad:${callUp.nationalTeamId}:${windowId}`,
              teamId: callUp.nationalTeamId,
              squadType: 'national-team-duty',
              status: 'active',
              membershipContext: 'national-team-duty',
            });
            this.world.registries.registerSquad(squad);
          }
          squadsByNationalTeam.set(callUp.nationalTeamId, squad);
        }
        // Invariante 4: puede haber un squad de club Y uno nacional
        // simultáneos, nunca dos del MISMO contexto — la propia
        // `WorldRegistries.registerSquad()` ya lo protegió al crear el
        // squad; aquí solo evitamos añadir dos veces al mismo jugador.
        if (!squad.hasPlayer(player.id)) squad.addPlayer(player);
        callUp.setStatus('joined', { joinedAt: options.nowGameDate || null });
      });
      return pending;
    }

    // Libera los callups 'joined' de la ventana y deja el squad nacional
    // histórico/inactivo — el jugador NUNCA salió de su club, así que no
    // hace falta "devolverlo" a ningún sitio (invariante 3/14).
    endInternationalService(windowId, options = {}) {
      const window = this.registry.requireWindow(windowId);
      window.setStatus('completed');
      const joined = this.registry.callUpsForWindow(windowId).filter((c) => c.status === 'joined');
      const nationalTeamIds = new Set();
      joined.forEach((callUp) => {
        callUp.setStatus('released', { releasedAt: options.nowGameDate || null });
        nationalTeamIds.add(callUp.nationalTeamId);
      });
      nationalTeamIds.forEach((nationalTeamId) => {
        const squad = this.world.registries.squads.forTeam(nationalTeamId)
          .find((s) => s.status === 'active' && s.membershipContext === 'national-team-duty');
        if (squad) squad.status = 'historical';
      });
      return joined;
    }

    // --- Apariciones oficiales -------------------------------------------
    // Evidencia INMUTABLE de una aparición individual REAL — el propio
    // constructor de `NationalTeamAppearanceReceipt` ya rechaza
    // `detailLevel` "standard"/"abstract" (invariante 15).
    registerAppearance(data) {
      const receipt = new EntitiesModule.NationalTeamAppearanceReceipt(data);
      return this.registry.registerAppearanceReceipt(receipt);
    }
  }

  const exportsObj = { NationalTeamService };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
