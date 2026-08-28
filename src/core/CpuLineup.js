// src/core/CpuLineup.js
// Alineación automática de equipos gestionados por la CPU — ver DESIGN.md
// 7.11.7. Cierra la limitación señalada en el cierre de 7.11.5: sin esto,
// los equipos que el usuario no controla nunca tenían una alineación real
// (`lineup.entries`, el mismo shape que ya valida Rotation.validateLineup),
// así que MatchEngine caía en `selectOnCourtFive` (sin reparto de minutos
// por jugador) y Recovery.js nunca podía actualizar su `lastMatchDate`.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.

(function (global) {
  const PlayerCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Player.js')
    : global.BasketManager;
  const TeamCore = (typeof module !== 'undefined' && module.exports)
    ? require('../entities/Team.js')
    : global.BasketManager;
  // LIFE-3 (DESIGN.md 9.14, sección 24 del prompt de esa sesión): la CPU
  // usa EXACTAMENTE `Medical.getAvailability()` — nunca una segunda IA
  // médica ni un `isInjured` propio.
  function MedicalCore() {
    return (typeof module !== 'undefined' && module.exports) ? require('./Medical.js') : global.BasketManager;
  }

  const { POSITIONS } = PlayerCore;
  // REG-1 (DESIGN.md 9.18, BUG-CONTRACT1-03): fixture de prueba NOMBRADO
  // (nunca un "12 regulatorio" oculto) — solo lo usan llamadores legacy de
  // LIFE-1..4 que todavía no pasan `squadRules` explícito; cualquier
  // llamador multi-liga real (game.js) SIEMPRE pasa el rango ya resuelto.
  const { TEST_MATCH_SQUAD_POLICY } = TeamCore;

  // Penalización SUAVE (no exclusión) de un jugador `limited` al elegir
  // TITULAR — sección 24: "no fuerza a un limitado como titular si hay
  // alternativa razonable". Como suplente compite sin penalización (sigue
  // siendo la mejor forma de aprovechar sus minutos permitidos); el tope
  // real de minutos totales lo aplica Rotation.buildRotationState
  // (clamp de quotaSeconds a minuteCap*60), nunca este módulo.
  const LIMITED_STARTER_SCORE_PENALTY = 0.7;

  // --- Valoración de jugador ---
  //
  // NOTA (mismatch con DESIGN.md señalado explícitamente, ver respuesta
  // final): 7.11.7 pide reutilizar "el mismo criterio ya usado para las
  // valoraciones en estrellas de 7.11.6", pero 7.11.6 no tiene en realidad
  // ninguna fórmula compuesta de la que extraer nada — la pantalla de
  // Alineación muestra Técnica/Física/Mental como 3 medias SEPARADAS
  // (Player.technicalAverage/physicalAverage/mentalAverage) sin combinarlas
  // en un único número; solo "Forma" (competitionRhythm) se convierte a
  // estrellas, y Energía se muestra como número crudo. No había nada que
  // extraer a una función compartida. Esta función es NUEVA — combina esas
  // 3 medias ya existentes (sin duplicar su cálculo) en una sola puntuación
  // de calidad general 1-20, específicamente para decidir convocatoria y
  // quintetos CPU.
  function playerQualityScore(player) {
    return (player.technicalAverage + player.physicalAverage + player.mentalAverage) / 3;
  }

  // Puntuación de un jugador para UNA posición concreta: combina afinidad
  // posicional (Player.positionLevel — el mismo mapa de posiciones 1-20
  // que ya usa Rotation.js para la polivalencia de emergencia, no se
  // inventa un criterio de afinidad nuevo), calidad general y Energía
  // actual — para que una nota alta con Energía muy baja pueda perder
  // frente a una nota algo menor pero descansada (DESIGN.md 7.11.7).
  function playerPositionScore(player, position, config) {
    const weights = config.cpuLineup.ratingWeights;
    const affinity = player.positionLevel(position); // 1-20
    const quality = playerQualityScore(player); // 1-20
    const energyScore = (player.dynamicState.energy / 100) * 20; // 0-20
    return affinity * weights.affinity + quality * weights.quality + energyScore * weights.energy;
  }

  // Elige por sorteo ponderado entre los N mejores candidatos restantes de
  // una lista ya ordenada de mejor a peor (más peso al mejor, no
  // determinista — DESIGN.md 7.11.7, "variedad deliberada"). Se recorta al
  // tamaño real de `ranked` si hay menos candidatos que `poolSize`.
  function pickFromTopCandidates(ranked, poolSize, poolWeights) {
    const pool = ranked.slice(0, poolSize);
    const weights = poolWeights.slice(0, pool.length);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < pool.length; i += 1) {
      if (roll < weights[i]) return pool[i];
      roll -= weights[i];
    }
    return pool[pool.length - 1];
  }

  // --- Convocatoria ---
  //
  // NOTA (infraestructura necesaria, no una decisión de diseño nueva): el
  // `lineup.entries` generado abajo tiene que referenciar exactamente a los
  // jugadores del `squad` que se pasa como `options.homeSquad`/`awaySquad`
  // a MatchEngine.simulateMatch — si no coinciden, Rotation.buildRotationState
  // construye su mapa de jugadores a partir de ESE squad, y cualquier
  // playerId del lineup que no esté ahí queda huérfano. Por eso
  // buildCpuLineup también decide la convocatoria (no solo el reparto de
  // minutos): se garantiza el mejor jugador de cada una de las 5 posiciones
  // (para que ninguna quede sin ningún especialista razonable) y se
  // completa hasta 12 (o el tamaño de plantilla si es menor) con los
  // mejores por calidad general.
  // LIFE-3 (DESIGN.md 9.14, sección 23/24 del prompt de esa sesión):
  // `availablePlayers` — roster YA filtrado a médicamente convocables
  // (`status !== 'unavailable'`, ver buildCpuLineup). `effectiveMin`:
  // mínimo real de convocatoria para ESTA fecha (8 normal, 5-7 solo por
  // escasez médica real, nunca por elección de la CPU).
  function pickMatchSquadIds(availablePlayers, effectiveMin, max) {
    const desiredSize = Math.max(effectiveMin, Math.min(max, availablePlayers.length));
    const bestByPosition = {};
    const guaranteed = new Set();
    POSITIONS.forEach((position) => {
      if (!availablePlayers.length) return;
      let best = availablePlayers[0];
      availablePlayers.forEach((player) => {
        if (player.positionLevel(position) > best.positionLevel(position)) best = player;
      });
      bestByPosition[position] = best.id;
      guaranteed.add(best.id);
    });
    // Cobertura real de las 5 posiciones (mini-EPIC POS: con el nuevo
    // modelo de múltiples posiciones en 20, un mismo polivalente puede
    // "ganar" el bucle de arriba en más de una posición a la vez, dejando
    // guaranteed con menos de 5 jugadores DISTINTOS). Para cada posición
    // cuyo mejor candidato ya quedó reservado por OTRA posición, se busca
    // el siguiente mejor candidato de ESA posición que aún no esté
    // garantizado, y se añade también. No cambia nada para jugadores con
    // una sola posición en 20 (el caso de siempre, donde guaranteed.size ya
    // sale en 5 directamente).
    if (guaranteed.size < POSITIONS.length) {
      const claimedBy = new Map(); // playerId -> primera posición que lo reservó
      POSITIONS.forEach((position) => {
        const playerId = bestByPosition[position];
        if (!claimedBy.has(playerId)) {
          claimedBy.set(playerId, position);
          return;
        }
        const nextBest = availablePlayers
          .filter((player) => !guaranteed.has(player.id))
          .sort((a, b) => b.positionLevel(position) - a.positionLevel(position))[0];
        if (nextBest) guaranteed.add(nextBest.id);
      });
    }
    const ranked = availablePlayers
      .filter((player) => !guaranteed.has(player.id))
      .sort((a, b) => playerQualityScore(b) - playerQualityScore(a));
    const ids = [...guaranteed];
    ranked.forEach((player) => {
      if (ids.length < desiredSize) ids.push(player.id);
    });
    return ids.slice(0, desiredSize);
  }

  // --- Generación de quinteto/rotación (DESIGN.md 7.11.7) ---
  //
  // `matchImportance` (booleano — decisión de implementación: DESIGN.md
  // deja explícitamente a elección "booleano simple, o 0-1 más granular";
  // se elige booleano porque la propia sección 7.11.7 solo describe dos
  // comportamientos discretos, "clave" / "no clave", nunca una gradación
  // intermedia).
  // `date` (LIFE-3, DESIGN.md 9.14, sección 24 del prompt de esa sesión):
  // fecha real del partido — necesaria para `Medical.getAvailability()`.
  // Opcional por compatibilidad con llamadores de modo prueba que no
  // manejan fecha real (usa el reloj de la máquina, comportamiento
  // idéntico al de antes de esta entrega si `config.medical.enabled` es
  // `false` o el jugador nunca ha tenido estado médico).
  // `squadRules` (ROSTER-1, DESIGN.md 9.16): `{min, max}` YA resuelto por
  // `CompetitionRules.resolveRules()` para la competición real de `team`
  // — nunca decidido aquí. Sin indicar (llamadores legacy de LIFE-1/2/3/4,
  // sin multi-liga), reproduce el default legacy 8-12 de `Team.js`,
  // comportamiento idéntico al de antes de esta entrega.
  //
  // `eligibility` (REG-1, DESIGN.md 9.18, sección 11.3 del prompt) — OPCIONAL,
  // por compatibilidad con llamadores de modo prueba: `{ pool, resolved }`.
  // `pool`: [{ player, accessCategory, evaluation }] — el pool REGULADO del
  // partido (senior + propios + vinculados, ya evaluados por
  // `EligibilityService`), NUNCA solo `team.roster`. `resolved`: salida de
  // `CompetitionRules.resolveRules({domain:'registration', ...})`. Cuando se
  // aporta, la CPU consulta EXACTAMENTE `SquadEligibilityService.
  // selectLegalSquad()` — el MISMO servicio que valida al usuario.
  //
  // BUG-LOAN1-01 (CYCLE-1, DESIGN.md 9.22) — CORREGIDO: hasta esta entrega,
  // si `selectLegalSquad()` respondía `ok: false` (o si `eligibility.pool`
  // llegaba VACÍO, caso en el que ni siquiera se entraba al camino
  // regulado), esta función caía al selector legacy sobre `team.roster`.
  // Esa "red de seguridad" violaba la separación de REG-1: podía incluir
  // jugadores individualmente NO elegibles, ignorar cupos de formación/no
  // comunitarios y producir un acta fuera de rango. En la auditoría externa
  // `smoke-loan1.js` falló UNA vez en un playoff exactamente por ese camino
  // y pasó varias veces después — prueba de que el arnés no garantizaba el
  // invariante. (Causa raíz determinista encontrada en CYCLE-1: el último
  // partido posible del playoff caía el 1 de julio, FUERA de la ventana
  // civil de la temporada, así que licencias e inscripciones ya habían
  // expirado y el pool regulado quedaba vacío — ver BUG-CYCLE1-06 en
  // `LocalDate.seasonWindow`.)
  //
  // Ahora: si el partido aporta contexto regulado, NUNCA se selecciona desde
  // `team.roster`. Un pool vacío sigue siendo un resultado REGULADO e
  // inviable, no permiso para ignorar la norma. El resultado es TIPADO:
  //   `outcome: 'legal' | 'medical-exception' | 'infeasible'`
  // con `diagnostic` estructurado en el caso inviable — usuario y CPU
  // consumen el MISMO diagnóstico, y el motor no juega un partido con acta
  // ilegal. Resolver la imposibilidad ANTES del primer partido es
  // responsabilidad de la fase de legalidad de CYCLE-1
  // (`RosterLegalityService`), no de esconderla aquí.
  function buildCpuLineup(team, matchImportance, config, date, squadRules, eligibility) {
    const matchDate = date || new Date();
    const limits = squadRules || TEST_MATCH_SQUAD_POLICY;
    const Medical = MedicalCore();

    let availablePlayers;
    let squadIds;
    let squad;
    const squadWarnings = [];
    let effectiveMinUsed = limits.min;
    let outcome = 'legal';

    // El camino REGULADO se activa por la presencia de `resolved` (contexto
    // normativo del partido), NO por que el pool traiga jugadores: un pool
    // vacío es precisamente el caso que antes se escapaba.
    const regulated = Boolean(eligibility && eligibility.resolved);

    if (regulated) {
      const SquadEligibility = (typeof module !== 'undefined' && module.exports)
        ? require('./SquadEligibilityService.js') : global.BasketManager;
      const pool = eligibility.pool || [];
      const { resolved } = eligibility;
      const availabilityMap = new Map(
        pool.map((entry) => [entry.player.id, Medical.getAvailability(entry.player, matchDate, config, { team })]),
      );
      const eligibleAndAvailable = pool.filter((entry) => (
        entry.evaluation.eligible && availabilityMap.get(entry.player.id).status !== 'unavailable'
      ));
      const callableCount = eligibleAndAvailable.length;
      // La excepción médica SOLO puede reducir el mínimo por esta vía —
      // nunca vuelve elegible a quien no lo era.
      const effectiveMin = Medical.resolveEffectiveSquadMinimum(limits.min, config, callableCount);
      effectiveMinUsed = effectiveMin;
      const desiredSize = Math.max(effectiveMin, Math.min(limits.max, callableCount));
      const candidates = eligibleAndAvailable.map((entry) => ({
        playerId: entry.player.id, qualityScore: playerQualityScore(entry.player), evaluation: entry.evaluation,
      }));
      const Squad = SquadEligibility.SquadEligibilityService;
      // CYCLE-1: el cupo de formación depende de la BANDA de tamaño de acta,
      // así que se busca un tamaño LEGAL recorriendo el rango
      // [effectiveMin..desiredSize] con la MISMA función compartida que usa
      // la auditoría de legalidad — nunca un único tamaño fijo.
      let selection = candidates.length
        ? Squad.selectLegalSquadWithinRange(candidates, {
          minSize: effectiveMin, maxSize: limits.max, preferredSize: desiredSize, resolved,
        })
        : { ok: false, diagnostic: { code: 'REGULATED_POOL_EMPTY', available: 0, required: desiredSize } };

      // --- Escasez MÉDICA que hace inalcanzable un cupo colectivo --------
      // Si el acta es imposible con los disponibles pero SÍ sería posible con
      // la plantilla reglamentariamente elegible SANA, la carencia no es
      // reglamentaria: es médica. El partido se juega entonces bajo excepción
      // médica de convocatoria con el acta de MEJOR ESFUERZO y el
      // incumplimiento DECLARADO (nunca escondido, nunca cayendo al selector
      // no regulado). Si el cupo tampoco se cumpliría con la plantilla sana,
      // la imposibilidad es REGLAMENTARIA y el partido no se juega
      // (BUG-LOAN1-01) — resolverlo antes del primer partido es de
      // `RosterLegalityService`, no de aquí.
      let medicallyForcedShortfalls = null;
      if (!selection.ok && candidates.length) {
        const healthyCandidates = pool.filter((entry) => entry.evaluation.eligible).map((entry) => ({
          playerId: entry.player.id, qualityScore: playerQualityScore(entry.player), evaluation: entry.evaluation,
        }));
        const healthySelection = Squad.selectLegalSquadWithinRange(healthyCandidates, {
          minSize: limits.min, maxSize: limits.max, preferredSize: Math.min(limits.max, healthyCandidates.length), resolved,
        });
        if (healthySelection.ok) {
          const bestEffort = Squad.selectBestEffortSquad(candidates, desiredSize, resolved);
          if (bestEffort.ok) {
            selection = bestEffort;
            medicallyForcedShortfalls = bestEffort.shortfalls;
          }
        }
      }
      if (!selection.ok) {
        // Resultado REGULADO e inviable — nunca una convocatoria legacy.
        return {
          squad: null,
          lineup: null,
          outcome: 'infeasible',
          effectiveMin,
          diagnostic: {
            code: selection.diagnostic.code,
            teamId: team.id,
            teamName: team.fullName || team.id,
            poolSize: pool.length,
            eligibleAndAvailable: callableCount,
            requiredMin: limits.min,
            effectiveMin,
            max: limits.max,
            detail: selection.diagnostic,
          },
          warnings: [
            `CpuLineup: convocatoria regulada INVIABLE para "${team.fullName || team.id}" `
            + `(${selection.diagnostic.code}; pool ${pool.length}, elegibles y disponibles ${callableCount}, `
            + `mínimo efectivo ${effectiveMin}) — BUG-LOAN1-01: NUNCA se cae al selector no regulado.`,
          ],
        };
      }
      squadIds = selection.playerIds;
      squad = squadIds.map((id) => pool.find((entry) => entry.player.id === id).player);
      availablePlayers = eligibleAndAvailable.map((entry) => entry.player);
      if (effectiveMin < limits.min) {
        outcome = 'medical-exception';
        squadWarnings.push(
          `CpuLineup: excepción médica de convocatoria para "${team.fullName || team.id}" — mínimo reducido de `
          + `${limits.min} a ${effectiveMin} por escasez médica real (Medical.resolveEffectiveSquadMinimum).`,
        );
      }
      if (medicallyForcedShortfalls && medicallyForcedShortfalls.length) {
        outcome = 'medical-exception';
        squadWarnings.push(
          `CpuLineup: acta de MEJOR ESFUERZO para "${team.fullName || team.id}" — la escasez MÉDICA hace inalcanzable `
          + `${medicallyForcedShortfalls.map((s) => s.code).join(', ')} (la plantilla sana SÍ cumpliría el cupo). `
          + 'El incumplimiento queda declarado en el acta; nunca se oculta ni se cae al selector no regulado.',
        );
      }
    } else {
      // Camino LEGACY: SOLO para llamadores sin contexto regulado (pruebas
      // de motor de LIFE-1..4 y "modo prueba" de index.html). Cualquier
      // llamador multi-liga real de producción pasa siempre `eligibility`.
      availablePlayers = team.roster.filter((player) => (
        Medical.getAvailability(player, matchDate, config, { team }).status !== 'unavailable'
      ));
      const callableCount = availablePlayers.length;
      const effectiveMin = Medical.resolveEffectiveSquadMinimum(limits.min, config, callableCount);
      effectiveMinUsed = effectiveMin;
      squadIds = pickMatchSquadIds(availablePlayers, effectiveMin, limits.max);
      squad = team.buildMatchSquad(squadIds, effectiveMin, limits.max);
    }

    const availabilityMap = new Map(
      squad.map((player) => [player.id, Medical.getAvailability(player, matchDate, config, { team })]),
    );
    const cfg = config.cpuLineup;
    const totalMinutes = config.match.durationMinutes;

    const split = matchImportance ? cfg.minutesSplitKeyMatch : cfg.minutesSplit;
    const starterMinutes = Math.round(totalMinutes * split.starter);
    const sub1Minutes = Math.round(totalMinutes * split.sub1);
    const sub2Minutes = totalMinutes - starterMinutes - sub1Minutes;

    // Partido clave: menos aleatoriedad (más peso a la valoración pura).
    // Partido no clave: grupo de candidatos más amplio, más variedad.
    const poolSize = matchImportance ? cfg.keyMatchCandidatePoolSize : cfg.candidatePoolSize;

    const entries = {};

    // Paso 1: quinteto titular — 5 jugadores DISTINTOS (invariante real:
    // nadie puede empezar el partido ocupando dos posiciones a la vez).
    const usedStarters = new Set();
    const starterIdByPosition = {};
    // Sección 24: "no fuerza a un limitado como titular si hay
    // alternativa razonable" — penalización suave (no exclusión) solo en
    // la elección de TITULAR, ver LIMITED_STARTER_SCORE_PENALTY arriba.
    const starterScore = (player, position) => {
      const base = playerPositionScore(player, position, config);
      return availabilityMap.get(player.id).status === 'limited' ? base * LIMITED_STARTER_SCORE_PENALTY : base;
    };
    POSITIONS.forEach((position) => {
      const ranked = squad
        .filter((player) => !usedStarters.has(player.id))
        .sort((a, b) => starterScore(b, position) - starterScore(a, position));
      const pick = pickFromTopCandidates(ranked, poolSize, cfg.candidatePoolWeights);
      starterIdByPosition[position] = pick.id;
      usedStarters.add(pick.id);
    });

    // Pasos 2-3: suplente 1 y 2 — cada posición se puntúa sobre TODA la
    // plantilla convocada de nuevo (sin excluir a quien ya sea titular o
    // suplente en OTRA fila). Un mismo jugador puede repetirse en varias
    // filas/slots de banquillo sin restricción — mismo modelo ya aceptado
    // para la pantalla de Alineación humana (ver CLAUDE.md, "Interfaz de
    // juego"), y refleja con realismo la profundidad de banco corta de una
    // plantilla de 8-12 convocados repartida en 5 posiciones × 3 slots.
    // "Si la plantilla en esa posición tiene menos de `poolSize` jugadores
    // con afinidad, usa los que haya sin bloquear la generación" (DESIGN.md
    // 7.11.7) queda cubierto de forma natural: se puntúa siempre sobre el
    // squad COMPLETO, así que nunca hay "candidatos insuficientes" — un
    // jugador de otra posición con menos afinidad simplemente puntúa más
    // bajo, pero sigue siendo un candidato válido.
    POSITIONS.forEach((position) => {
      const ranked = squad
        .slice()
        .sort((a, b) => playerPositionScore(b, position, config) - playerPositionScore(a, position, config));

      const startedId = starterIdByPosition[position];
      const sub1Pick = pickFromTopCandidates(ranked, poolSize, cfg.candidatePoolWeights);
      const sub2Pick = pickFromTopCandidates(ranked, poolSize, cfg.candidatePoolWeights);

      let starterQuota = starterMinutes;
      let sub1Quota = sub1Minutes;
      const starter = squad.find((player) => player.id === startedId);

      // DESIGN.md 7.11.7: en partido NO clave, un titular con Energía muy
      // baja reduce su cuota en favor del siguiente candidato (sub1) — en
      // partido clave se acepta jugarlo igual con más minutos de lo
      // habitual, así que esta reducción no se aplica.
      if (!matchImportance && starter.dynamicState.energy < cfg.lowEnergyThreshold) {
        starterQuota = sub1Minutes;
        sub1Quota = starterMinutes;
      }

      entries[position] = {
        starter: { playerId: startedId, minutesQuota: starterQuota },
        sub1: { playerId: sub1Pick.id, minutesQuota: sub1Quota },
        sub2: { playerId: sub2Pick.id, minutesQuota: sub2Minutes },
      };
    });

    // REG-1 (sección 11.4 del prompt): Primera FEB exige AL MENOS dos
    // jugadores de formación en pista durante todo el tiempo de juego — se
    // repara cada "quinteto" declarado (titular/sub1/sub2, uno por slot,
    // cruzando las 5 posiciones) para cumplirlo. Solo se aplica cuando el
    // módulo resuelto declara la capacidad (ACB no la tiene).
    if (eligibility && eligibility.pool && eligibility.resolved) {
      const minOnCourt = eligibility.resolved.registration
        && eligibility.resolved.registration.onCourtConstraints
        && eligibility.resolved.registration.onCourtConstraints.minFormationOnCourtAtAllTimes;
      if (minOnCourt) enforceOnCourtFormationQuota(entries, squad, eligibility.pool, minOnCourt);
    }

    return {
      squad,
      lineup: { entries, fixedSegments: [], garbageTime: { enabled: false } },
      warnings: squadWarnings,
      effectiveMin: effectiveMinUsed,
      // BUG-LOAN1-01: resultado TIPADO consumido igual por CPU y usuario.
      outcome,
      diagnostic: null,
    };
  }

  // Repara UN slot (titular/sub1/sub2) cruzando las 5 posiciones para que
  // contenga al menos `minRequired` jugadores de formación — sustituye a
  // los NO formación de peor calidad por candidatos de formación del
  // mismo `squad` que todavía no ocupen ese slot. Deterministo (desempate
  // por `playerQualityScore` y luego por id).
  function enforceOnCourtFormationQuota(entries, squad, pool, minRequired) {
    const isFormationQualifying = (playerId) => {
      const entry = pool.find((p) => p.player.id === playerId);
      return Boolean(entry && entry.evaluation && entry.evaluation.classification
        && entry.evaluation.classification.formation.status === 'qualifies');
    };
    ['starter', 'sub1', 'sub2'].forEach((slotKey) => {
      const idsInSlot = POSITIONS.map((pos) => entries[pos][slotKey].playerId).filter(Boolean);
      let formationCount = idsInSlot.filter(isFormationQualifying).length;
      if (formationCount >= minRequired) return;
      const inSlotSet = new Set(idsInSlot);
      const replacements = squad
        .filter((player) => isFormationQualifying(player.id) && !inSlotSet.has(player.id))
        .sort((a, b) => (playerQualityScore(b) - playerQualityScore(a)) || (a.id < b.id ? -1 : 1));
      const removablePositions = POSITIONS
        .filter((pos) => entries[pos][slotKey].playerId && !isFormationQualifying(entries[pos][slotKey].playerId))
        .sort((a, b) => {
          const playerA = squad.find((p) => p.id === entries[a][slotKey].playerId);
          const playerB = squad.find((p) => p.id === entries[b][slotKey].playerId);
          return (playerQualityScore(playerA) - playerQualityScore(playerB)) || (a < b ? -1 : 1);
        });
      let r = 0;
      while (formationCount < minRequired && r < replacements.length && r < removablePositions.length) {
        entries[removablePositions[r]][slotKey].playerId = replacements[r].id;
        formationCount += 1;
        r += 1;
      }
    });
  }

  // --- Importancia del partido (DESIGN.md 7.11.7, apartado 2.2) ---
  //
  // NOTA HISTÓRICA (resuelta, ver DESIGN.md 3.4.3): en la sesión original
  // de CPU Lineup, `team.board.sportingGoal` solo variaba de verdad para
  // equipos FICTICIOS (generados por teamGenerator.js, uno de 'Evitar el
  // descenso'/'Consolidarse en la categoría'/'Optar a playoffs'/'Pelear
  // por el título'). Los equipos REALES (los únicos seleccionables desde
  // "Empezar temporada", ver CLAUDE.md) no traían `board` en los datos
  // importados, así que Team.js les asignaba el valor por defecto fijo
  // 'Permanencia' — un 5º valor que ni siquiera pertenecía al vocabulario
  // de teamGenerator.js. Con eso, TODOS los equipos (usuario y rivales)
  // tenían literalmente el mismo objetivo, así que esta señal quedaba
  // inerte en una partida real: siempre resolvía a la zona baja de tabla
  // para todo el mundo — se implementó la lógica exactamente como la
  // describe 7.11.7, lista para funcionar en cuanto existieran objetivos
  // de temporada reales, señalando explícitamente que todavía no
  // discriminaba nada entre equipos reales.
  //
  // Ya resuelto (sesión de cierre de ciclo de temporada): `SeasonGoals.js`
  // calcula `sportingGoal` real y variable por equipo (percentil de
  // overall + reputación), y `startSeason()` en `game.js` lo recalcula
  // tanto al arrancar una partida nueva como en cada cierre de ciclo — la
  // señal que consume esta función ya es real para los 36 equipos,
  // incluidos los reales.
  const HIGH_ZONE_GOALS = new Set(['Pelear por el título', 'Optar a playoffs']);
  const LOW_ZONE_GOALS = new Set(['Evitar el descenso', 'Permanencia']);

  function findTeamRank(team, standingsTable) {
    const index = standingsTable.findIndex((row) => row.team.id === team.id);
    return index === -1 ? null : index + 1; // 1-indexed, coincide con "posición" de la tabla
  }

  // `competition`: 'league' para partidos de liga regular (única para la
  // que se evalúa clasificación/objetivo); cualquier otro valor
  // (convención de esta integración: 'bracket', cubre Copa desde cuartos,
  // Playoff por el título y Playoff de ascenso — ver nota en la respuesta
  // final sobre por qué no se distingue cuál de los tres) se trata siempre
  // como partido clave, sin mirar la tabla.
  function computeMatchImportance(team, opponent, competition, standingsTable, config) {
    if (competition !== 'league') return true;

    const goal = team.board.sportingGoal;
    let frontier;
    if (HIGH_ZONE_GOALS.has(goal)) {
      frontier = 8; // corte de Copa/Playoff por el título (Cup.js/Playoffs.js: top8)
    } else if (LOW_ZONE_GOALS.has(goal)) {
      frontier = standingsTable.length - 1; // DESIGN.md 3.2: 2 plazas de descenso, los 2 últimos
    } else {
      return false; // objetivo neutro ('Consolidarse en la categoría' u otro no reconocido): sin señal de zona
    }

    const band = config.cpuMatchImportance.standingsBandSize;
    const teamRank = findTeamRank(team, standingsTable);
    const opponentRank = findTeamRank(opponent, standingsTable);
    if (teamRank === null || opponentRank === null) return false;

    return Math.abs(teamRank - frontier) <= band && Math.abs(opponentRank - frontier) <= band;
  }

  const exportsObj = {
    buildCpuLineup,
    computeMatchImportance,
    playerQualityScore,
    enforceOnCourtFormationQuota,
    pickMatchSquadIds,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
