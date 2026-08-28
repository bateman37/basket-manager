// src/core/ContractSeeder.js
// CONTRACT-1 (DESIGN.md 9.17) — Bootstrap DETERMINISTA de contratos
// SIMULADOS. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// HONESTIDAD DE DATOS (sección 8.1 del prompt de CONTRACT-1): en
// `data/real/` NO existe ningún dato contractual real. Todo lo que genera
// este archivo son datos de JUEGO, marcados como tales en cada contrato
// (`dataSource: 'simulated-contract-v1'`, `isReal: false`) y mostrados
// siempre con el aviso:
//
//   "Contrato simulado para esta partida; no es un dato contractual real."
//
// Nunca se escribe nada de esto en `data/real/`.
//
// DETERMINISMO (sección 8.2): no se usa `Math.random` en ningún punto.
// Toda decisión deriva de un hash estable de
// `playerId + clubId + seasonKey + generatorVersion`; dos carreras nuevas
// con los mismos datos y la misma versión generan contratos IDÉNTICOS.
// Cambiar `GENERATOR_VERSION` permite una recalibración futura explícita.
//
// VARIABLES PERMITIDAS (sección 8.3): solo información VISIBLE o derivable
// — TMB, edad, percentil de calidad dentro de su competición, fuerza
// visible de la plantilla y perfil económico de simulación. NUNCA
// `potential`, `ambition`, `professionalism` ni ningún otro atributo
// oculto; tampoco `team.reputation` (igual para los 36 clubes) ni
// `budget`/`salary` del dataset (valen 0 y no son presupuestos reales).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const ContractModule = isNode ? require('../entities/Contract.js') : global.BasketManager;
  const ContractServiceModule = isNode ? require('./ContractService.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const PlayerDevelopment = isNode ? require('./PlayerDevelopment.js') : global.BasketManager;
  // CYCLE-1: la distribución de duración de los contratos simulados es
  // CALIBRACIÓN DE JUEGO y vive en `CycleConfig`, nunca en este seeder.
  const CycleConfigModule = isNode ? require('./CycleConfig.js') : global.BasketManager;

  function M() { return MoneyModule.Money; }
  function LD() { return LocalDateModule.LocalDate; }
  function Service() { return ContractServiceModule.ContractService; }

  // CYCLE-1 (DESIGN.md 9.22, sección 9 del prompt): procedencia y versión
  // NUEVAS del generador. La distribución de duración restante pasa a ser
  // variada y determinista (25/30/30/15 % para 1/2/3/4 temporadas, ver
  // `CycleConfig.INITIAL_CONTRACT_DURATION_WEIGHTS`), así que los contratos
  // del bootstrap YA NO son comparables con los de `simulated-contract-v1`.
  const SIMULATED_CONTRACT_DATA_SOURCE = 'simulated-contract-v2';
  const GENERATOR_VERSION = 'contract-seeder-v2';
  const SIMULATED_CONTRACT_WARNING = 'Contrato simulado para esta partida; no es un dato contractual real.';

  // RETIRADO en CYCLE-1 (sección 9 del prompt). Era el puente de staging de
  // CONTRACT-1 (sección 8.5, "tres transiciones completas de temporada
  // disponibles después del arranque") que garantizaba un suelo de 3
  // temporadas restantes en TODO contrato, para que ningún contrato pudiera
  // vencer dentro de un horizonte verificable. Con la expiración orgánica
  // real (`ContractExpiryService`) ese suelo desaparece: la constante se
  // conserva SOLO como referencia histórica documentada y ya NO participa
  // en ningún cálculo (auditado en `scripts/test-cycle1.js`).
  const MINIMUM_PLAYABLE_REMAINING_SEASONS = 3;
  const MINIMUM_PLAYABLE_REMAINING_SEASONS_RETIRED_IN = 'CYCLE-1';

  // Unidad de presentación de los importes generados: 1.000 EUR. Todos los
  // salarios simulados son múltiplos de esta unidad (más realista de leer),
  // y el reparto se hace EN esta unidad para que la suma cuadre exacta sin
  // dejar céntimos fraccionarios por el camino.
  const PRESENTATION_UNIT_MINOR = 100000; // 1.000,00 EUR en céntimos

  // --- Perfiles económicos de SIMULACIÓN ---------------------------------
  // Sección 8.4: esto es CALIBRACIÓN DE VIDEOJUEGO, no una fuente oficial
  // ni el presupuesto real de ningún club. Se declara por `competitionId`:
  // una competición sin perfil declarado NO hereda el de ACB.
  const SIMULATION_ECONOMIC_PROFILES = {
    [CompetitionRules.COMPETITION_IDS.ACB]: {
      competitionId: CompetitionRules.COMPETITION_IDS.ACB,
      label: 'ACB (simulación)',
      lowPayrollMinor: 160000000, // 1.600.000 EUR
      highPayrollMinor: 1800000000, // 18.000.000 EUR
    },
    [CompetitionRules.COMPETITION_IDS.PRIMERA_FEB]: {
      competitionId: CompetitionRules.COMPETITION_IDS.PRIMERA_FEB,
      label: 'Primera FEB (simulación)',
      lowPayrollMinor: 22000000, // 220.000 EUR
      highPayrollMinor: 125000000, // 1.250.000 EUR
    },
  };

  function getEconomicProfile(competitionId) {
    const profile = SIMULATION_ECONOMIC_PROFILES[competitionId];
    if (!profile) {
      throw new Error(
        `ContractSeeder: la competición "${competitionId}" no tiene perfil económico de simulación declarado `
        + '— no se hereda el de ACB ni el de ninguna otra.',
      );
    }
    return profile;
  }

  // --- Hash determinista (FNV-1a 32 bits) --------------------------------
  // Sustituye por completo a `Math.random`: misma entrada, misma salida,
  // en Node y en navegador.
  function hash32(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function seedFingerprint(playerId, clubId, seasonKey) {
    return `${playerId}|${clubId}|${seasonKey}|${GENERATOR_VERSION}`;
  }

  // Valor determinista en [0, 1) a partir de la huella + un discriminante
  // (para poder tomar varias decisiones independientes con la misma huella).
  function unitFrom(fingerprint, discriminator) {
    return hash32(`${fingerprint}#${discriminator}`) / 0x100000000;
  }

  // --- Señales VISIBLES usadas por la calibración ------------------------
  function playerTmb(player, config) {
    return PlayerDevelopment.computeTmbRating(player, config);
  }

  function percentileOfSorted(sortedValues, fraction) {
    if (!sortedValues.length) return 0;
    const index = (sortedValues.length - 1) * fraction;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    if (low === high) return sortedValues[low];
    return sortedValues[low] + ((sortedValues[high] - sortedValues[low]) * (index - low));
  }

  // Fuerza VISIBLE de plantilla: media de TMB de los ocho mejores.
  function clubStrength(team, config) {
    const tmbs = team.roster.map((player) => playerTmb(player, config)).sort((a, b) => b - a).slice(0, 8);
    if (!tmbs.length) return 0;
    return tmbs.reduce((acc, value) => acc + value, 0) / tmbs.length;
  }

  // Calibración por COMPETICIÓN: percentil de cada club dentro de su
  // competición + P10/P90 de calidad de jugador de esa misma competición.
  function buildCompetitionCalibration(teams, config) {
    const byCompetition = new Map();
    teams.forEach((team) => {
      const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
      const entry = byCompetition.get(competitionId) || { competitionId, teams: [], playerTmbs: [] };
      entry.teams.push({ team, strength: clubStrength(team, config) });
      team.roster.forEach((player) => entry.playerTmbs.push(playerTmb(player, config)));
      byCompetition.set(competitionId, entry);
    });

    const calibration = {};
    byCompetition.forEach((entry, competitionId) => {
      const sortedTmbs = [...entry.playerTmbs].sort((a, b) => a - b);
      // Orden estable: por fuerza y, a igualdad exacta, por id de club.
      const ranked = [...entry.teams].sort((a, b) => (a.strength - b.strength) || (a.team.id < b.team.id ? -1 : 1));
      const clubPercentiles = {};
      ranked.forEach((item, index) => {
        clubPercentiles[item.team.id] = ranked.length > 1 ? index / (ranked.length - 1) : 0.5;
      });
      calibration[competitionId] = {
        competitionId,
        clubPercentiles,
        clubStrengths: ranked.reduce((acc, item) => { acc[item.team.id] = item.strength; return acc; }, {}),
        playerP10: percentileOfSorted(sortedTmbs, 0.10),
        playerP90: percentileOfSorted(sortedTmbs, 0.90),
      };
    });
    return calibration;
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  // Peso de reparto de un jugador — fórmula de la sección 8.4, con señales
  // exclusivamente VISIBLES.
  function ageFactor(age) {
    if (age === null || age === undefined) return 1.00;
    if (age < 21) return 0.92;
    if (age <= 22) return 0.96;
    if (age <= 30) return 1.00;
    if (age <= 33) return 0.95;
    return 0.85;
  }

  function playerWeight(player, config, competitionCalibration, isoDate) {
    const tmb = playerTmb(player, config);
    const span = competitionCalibration.playerP90 - competitionCalibration.playerP10;
    const qualityIndex = span > 0 ? clamp((tmb - competitionCalibration.playerP10) / span, 0, 1) : 0.5;
    const roleWeight = 0.35 + (4.65 * (qualityIndex ** 2.4));
    const age = Service().ageOnDate(player, isoDate);
    return { weight: roleWeight * ageFactor(age), qualityIndex, tmb, age };
  }

  // --- Duración restante del contrato de bootstrap ------------------------
  // CYCLE-1 (sección 9 del prompt): distribución DETERMINISTA y VARIADA
  // (`CycleConfig.INITIAL_CONTRACT_DURATION_WEIGHTS`, calibración de juego:
  // 25 % una temporada, 30 % dos, 30 % tres, 15 % cuatro), SIEMPRE recortada
  // por el máximo normativo REAL que resuelva el contexto laboral aplicable
  // (si otra jurisdicción admite menos, gana el límite real). Sustituye el
  // suelo de 3 temporadas de CONTRACT-1, que impedía que venciera nadie.
  //
  // `fingerprint` es la huella estable del contrato
  // (`playerId|clubId|seasonKey|GENERATOR_VERSION`): la misma carrera y la
  // misma semilla generan los mismos contratos aunque cambie el orden de
  // los equipos.
  function bootstrapSeasonSpan(seasonKey, isoDate, maxTermYears, fingerprint) {
    void isoDate;
    if (!fingerprint) {
      throw new Error(
        'ContractSeeder.bootstrapSeasonSpan: falta "fingerprint" — CYCLE-1 exige una huella estable para la '
        + 'distribución determinista de duración (nunca un suelo fijo de 3 temporadas).',
      );
    }
    return CycleConfigModule.CycleConfig.resolveInitialContractSeasons(
      fingerprint, `initial-duration|${seasonKey}`, maxTermYears, null,
    );
  }

  // ---------------------------------------------------------------------
  // Construcción del borrador de contrato de UN jugador
  // ---------------------------------------------------------------------
  function buildContractDraft(params) {
    const {
      player, team, seasonKey, isoDate, resolved, salaryMinor, fingerprint, isFirstProfessionalContract,
    } = params;
    const employment = resolved.employment;
    const currency = (employment.allowedCurrencies && employment.allowedCurrencies[0]) || 'EUR';
    const declaredBasis = (employment.allowedBases && employment.allowedBases[0]) || 'gross';

    const maxTermYears = employment.maxTermYears || null;
    // Un contrato de INCORPORACIÓN (cantera, relleno, emergencia, fichaje
    // con la partida en marcha) usa la distribución de contratos NUEVOS; el
    // bootstrap inicial usa la de arranque (más larga).
    const seasonSpan = params.seasonSpanOverride || (isFirstProfessionalContract
      ? CycleConfigModule.CycleConfig.resolveInitialContractSeasons(
        fingerprint, `new-duration|${seasonKey}`, maxTermYears,
        CycleConfigModule.CycleConfig.NEW_CONTRACT_DURATION_WEIGHTS,
      )
      : bootstrapSeasonSpan(seasonKey, isoDate, maxTermYears, fingerprint));
    const firstWindow = LD().seasonWindow(seasonKey);
    const lastWindow = LD().seasonWindow(LD().addSeasons(seasonKey, seasonSpan - 1));
    const startDate = firstWindow.startDate;
    const endDate = lastWindow.endDate;
    // El bootstrap representa contratos YA EN VIGOR al empezar la partida:
    // se firman el mismo día en que arrancan (nunca antes del inicio de la
    // temporada, nunca después). Para un fichaje posterior (cantera), la
    // firma es la fecha real de incorporación.
    const signedDate = LD().isBefore(isoDate, startDate) ? isoDate : startDate;
    const coveredSeasonKeys = [];
    for (let i = 0; i < seasonSpan; i += 1) coveredSeasonKeys.push(LD().addSeasons(seasonKey, i));

    // --- Reparto interno de la remuneración de cada temporada ------------
    // Derechos de imagen: solo para jugadores de calidad alta y solo si
    // alguna capa aplicable los reconoce como remuneración computable.
    const imageRightsRecognised = employment.minimumSalaryRequirements
      .some((requirement) => requirement.countingComponents.includes('guaranteedImageRights'));
    const imageShareRoll = unitFrom(fingerprint, 'image-share');
    const imageShare = (imageRightsRecognised && params.qualityIndex >= 0.5)
      ? (imageShareRoll < 0.5 ? 0.10 : 0.15) : 0;

    const seasons = coveredSeasonKeys.map((key) => {
      const imageRightsMinor = M().roundToMultiple(Math.round(salaryMinor * imageShare), PRESENTATION_UNIT_MINOR, 'nearest');
      return {
        seasonKey: key,
        guaranteedBaseSalaryMinor: salaryMinor - imageRightsMinor,
        guaranteedImageRightsMinor: imageRightsMinor,
        // El bootstrap NO inventa salario en especie, primas variables,
        // beneficios ni costes de agente (sección 8.6/8.7): el modelo los
        // admite y los tests los cubren con fixtures.
        guaranteedSalaryInKindMinor: 0,
        signingBonusMinor: 0,
        variableBonuses: [],
        nonSalaryBenefits: [],
        agentCosts: [],
      };
    });

    // --- Calendario de pagos ---------------------------------------------
    const installmentCount = employment.payments.defaultInstallmentCount;
    const frequency = employment.payments.frequency || 'monthly';
    const scheduledComponents = ['guaranteedBaseSalary', 'guaranteedImageRights'];
    const schedule = [];
    coveredSeasonKeys.forEach((key) => {
      const window = LD().seasonWindow(key);
      const seasonCompensation = seasons.find((s) => s.seasonKey === key);
      const scheduledMinor = seasonCompensation.guaranteedBaseSalaryMinor + seasonCompensation.guaranteedImageRightsMinor;
      // Primera cuota: fin del primer mes de la temporada. Todas las cuotas
      // caen dentro de la vigencia del contrato.
      const firstDueDate = LD().endOfMonth(window.startDate);
      ContractModule.buildPaymentSchedule({
        totalMinor: scheduledMinor,
        installmentCount,
        firstDueDate,
        frequency,
        currency,
        seasonKey: key,
      }).forEach((installment) => schedule.push(installment));
    });

    // --- Periodo de prueba (solo primer contrato profesional) ------------
    // Un contrato bootstrap de un veterano que ya llevaba años en el club
    // no arranca un periodo de prueba nuevo; un primer contrato (cantera)
    // sí lo hace, y así se ejercita de verdad la política resuelta
    // (incluida la dinámica andorrana).
    let probation = { enabled: false };
    if (isFirstProfessionalContract && employment.probation.maxDays) {
      const probationEnd = LD().addDays(startDate, employment.probation.maxDays - 1);
      probation = {
        enabled: true,
        startDate,
        endDate: LD().isAfter(probationEnd, endDate) ? endDate : probationEnd,
        durationDays: employment.probation.maxDays,
        legalBasisRuleIds: [...employment.probation.sourceRuleIds],
      };
    }

    // --- Cláusula de rescisión simulada (limitada y determinista) --------
    const clauses = [];
    const releaseAllowed = employment.clausePolicy['player-release'] === 'allowed';
    const releaseRoll = unitFrom(fingerprint, 'release-clause');
    const eligibleForRelease = params.qualityIndex >= 0.75 || (params.age !== null && params.age <= 22);
    if (releaseAllowed && eligibleForRelease && releaseRoll < 0.5) {
      const remainingGuaranteedMinor = salaryMinor * coveredSeasonKeys.length;
      const factor = 2 + (unitFrom(fingerprint, 'release-factor') * 2); // 2x-4x
      const amountMinor = M().roundToMultiple(
        Math.round(remainingGuaranteedMinor * factor), PRESENTATION_UNIT_MINOR, 'nearest',
      );
      clauses.push({
        id: `release-${player.id}`,
        type: 'player-release',
        holder: 'player',
        amount: { amountMinor, currency, basis: declaredBasis },
        conditions: { note: 'Importe de salida simulado (2x-4x de la remuneración garantizada restante).' },
        sourceRuleIds: employment.clausePolicy['player-release'] === 'allowed'
          ? resolved.ruleModuleIds.filter((id) => id.startsWith('es-') || id.startsWith('acb-')) : [],
        status: 'simulated',
        support: 'modeled-only',
      });
    }

    // --- Menores ----------------------------------------------------------
    let minorProtections = null;
    const ageAtStart = Service().ageOnDate(player, startDate);
    const minorRules = employment.minorRules;
    if (ageAtStart !== null && minorRules.consentRequiredUpToAge !== null && ageAtStart <= minorRules.consentRequiredUpToAge) {
      minorProtections = {
        ageAtSigning: ageAtStart,
        // Marcadores SIMULADOS: no se guardan nombres ni firmas ficticias
        // de tutores, solo el estado del requisito.
        markers: [...minorRules.requiredMarkers],
        markerStatus: 'simulated-recorded',
        allowances: [],
        note: 'Marcadores simulados de protección de menores; no es documentación real obtenida.',
      };
    }

    const requiredDocuments = ['written-contract', ...employment.requiredDocuments];

    return {
      // Id DETERMINISTA (sección 8.2): dos carreras nuevas con los mismos
      // datos y la misma `GENERATOR_VERSION` producen contratos idénticos,
      // incluido el identificador — nunca un UUID aleatorio.
      id: `contract:${GENERATOR_VERSION}:${team.id}:${player.id}:${seasonKey}`,
      playerId: player.id,
      clubId: team.id,
      contractType: 'professional-player',
      signedDate,
      startDate,
      endDate,
      coveredSeasonKeys,
      guaranteeType: 'fully-guaranteed',
      probation,
      compensation: { currency, declaredBasis, seasons },
      paymentPolicy: { installmentCount, frequency, scheduledComponents, schedule },
      clauses,
      declaredDocuments: [...new Set(requiredDocuments)],
      representation: { agentId: null, mandateId: null },
      minorProtections,
      lifecycleEvents: [{ id: `signed-${player.id}`, type: 'signed', date: signedDate, note: SIMULATED_CONTRACT_WARNING }],
      provenance: {
        dataSource: SIMULATED_CONTRACT_DATA_SOURCE,
        isReal: false,
        generatorVersion: GENERATOR_VERSION,
        seedFingerprint: fingerprint,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Reparto de la nómina objetivo de UN club entre su plantilla
  // ---------------------------------------------------------------------
  function buildClubSalaryPlan(params) {
    const {
      team, config, calibration, seasonKey, isoDate, resolved, warnings,
    } = params;
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
    const economicProfile = getEconomicProfile(competitionId);
    const competitionCalibration = calibration[competitionId];
    const clubPercentile = competitionCalibration.clubPercentiles[team.id];

    const span = economicProfile.highPayrollMinor - economicProfile.lowPayrollMinor;
    const rawTargetMinor = economicProfile.lowPayrollMinor + (span * (clubPercentile ** 2.2));

    // Suelo normativo: el mínimo salarial REAL resuelto para este perfil,
    // redondeado HACIA ARRIBA a la unidad de presentación (subir por encima
    // del mínimo legal siempre es seguro; bajarlo, nunca).
    const legalFloorMinor = resolved.employment.effectiveMinimumAnnual
      ? resolved.employment.effectiveMinimumAnnual.amountMinor : 0;
    const floorUnits = Math.ceil(legalFloorMinor / PRESENTATION_UNIT_MINOR);

    const roster = team.roster;
    let targetUnits = Math.round(rawTargetMinor / PRESENTATION_UNIT_MINOR);
    const minimumUnits = floorUnits * roster.length;
    if (targetUnits < minimumUnits) {
      warnings.push(
        `Calibración: la nómina objetivo de ${team.fullName || team.id} `
        + `(${M().format(targetUnits * PRESENTATION_UNIT_MINOR, 'EUR', { compact: true })}) no permitía cumplir el mínimo `
        + `salarial resuelto para ${roster.length} jugadores; se eleva a `
        + `${M().format(minimumUnits * PRESENTATION_UNIT_MINOR, 'EUR', { compact: true })}. Nunca se rebaja el mínimo normativo.`,
      );
      targetUnits = minimumUnits;
    }

    const profiles = roster.map((player) => playerWeight(player, config, competitionCalibration, isoDate));
    const restUnits = targetUnits - minimumUnits;
    const shareUnits = M().allocateByWeights(restUnits, profiles.map((p) => p.weight));

    return roster.map((player, index) => ({
      player,
      salaryMinor: (floorUnits + shareUnits[index]) * PRESENTATION_UNIT_MINOR,
      qualityIndex: profiles[index].qualityIndex,
      age: profiles[index].age,
      tmb: profiles[index].tmb,
      payrollTargetMinor: targetUnits * PRESENTATION_UNIT_MINOR,
      clubPercentile,
      economicProfile,
    }));
  }

  // ---------------------------------------------------------------------
  // API pública del seeder
  // ---------------------------------------------------------------------

  // Contratos bootstrap de TODOS los jugadores afiliados de una lista de
  // equipos. Devuelve los contratos creados + warnings (calibración,
  // fuentes provisionales...).
  function seedContractsForTeams(params) {
    const {
      teams, seasonKey, date, registry, playerRegistry, config,
    } = params;
    const isoDate = typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
    const warnings = [];
    const contracts = [];
    const calibration = buildCompetitionCalibration(teams, config);

    teams.forEach((team) => {
      const resolved = Service().resolveRulesForClub(team, {
        seasonKey, date: isoDate, operation: 'signContract',
      });
      const plan = buildClubSalaryPlan({ team, config, calibration, seasonKey, isoDate, resolved, warnings });
      plan.forEach((entry) => {
        const fingerprint = seedFingerprint(entry.player.id, team.id, seasonKey);
        const draft = buildContractDraft({
          player: entry.player,
          team,
          seasonKey,
          isoDate,
          resolved,
          salaryMinor: entry.salaryMinor,
          qualityIndex: entry.qualityIndex,
          age: entry.age,
          fingerprint,
          isFirstProfessionalContract: false,
        });
        const created = Service().createContract({
          draft, team, player: entry.player, registry, playerRegistry, seasonKey, date: isoDate, resolved,
        });
        contracts.push(created.contract);
      });
    });

    return { contracts, warnings, calibration };
  }

  // Contrato de UN jugador que se incorpora ya empezada la partida (cantera
  // de `generateAcademyIntake()`, relleno ficticio de plantilla...). Usa
  // SIEMPRE el contexto doméstico vigente DESPUÉS de ascensos/descensos —
  // nunca reescribe los módulos de contratos anteriores.
  function seedContractForNewPlayer(params) {
    const {
      player, team, seasonKey, date, registry, playerRegistry, config, calibration, teams,
    } = params;
    const isoDate = typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
    const warnings = [];
    const activeCalibration = calibration || buildCompetitionCalibration(teams || [team], config);
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
    const competitionCalibration = activeCalibration[competitionId];
    const resolved = Service().resolveRulesForClub(team, {
      seasonKey, date: isoDate, operation: 'signContract',
    });

    const profile = playerWeight(player, config, competitionCalibration, isoDate);
    // Un jugador que entra ya empezada la partida cobra el mínimo del
    // perfil ajustado por su calidad visible dentro del rango bajo de su
    // competición — nunca se recalcula la nómina entera del club por él.
    const legalFloorMinor = resolved.employment.effectiveMinimumAnnual
      ? resolved.employment.effectiveMinimumAnnual.amountMinor : 0;
    const floorUnits = Math.ceil(legalFloorMinor / PRESENTATION_UNIT_MINOR);
    const economicProfile = getEconomicProfile(competitionId);
    // Banda de entrada: del mínimo legal a un múltiplo modesto del mínimo
    // según calidad visible (constante de simulación, no una fuente real).
    const entryBandUnits = Math.round(
      (economicProfile.lowPayrollMinor / PRESENTATION_UNIT_MINOR) * 0.06 * profile.qualityIndex,
    );
    const salaryMinor = (floorUnits + Math.max(0, entryBandUnits)) * PRESENTATION_UNIT_MINOR;

    const fingerprint = seedFingerprint(player.id, team.id, seasonKey);
    const draft = buildContractDraft({
      player,
      team,
      seasonKey,
      isoDate,
      resolved,
      salaryMinor,
      qualityIndex: profile.qualityIndex,
      age: profile.age,
      fingerprint,
      isFirstProfessionalContract: params.isFirstProfessionalContract !== false,
    });
    const created = Service().createContract({
      draft, team, player, registry, playerRegistry, seasonKey, date: isoDate, resolved,
    });
    return { contract: created.contract, warnings: warnings.concat(created.warnings || []) };
  }

  const exportsObj = {
    ContractSeeder: {
      SIMULATED_CONTRACT_DATA_SOURCE,
      GENERATOR_VERSION,
      SIMULATED_CONTRACT_WARNING,
      MINIMUM_PLAYABLE_REMAINING_SEASONS,
      MINIMUM_PLAYABLE_REMAINING_SEASONS_RETIRED_IN,
      PRESENTATION_UNIT_MINOR,
      SIMULATION_ECONOMIC_PROFILES,
      getEconomicProfile,
      hash32,
      seedFingerprint,
      unitFrom,
      buildCompetitionCalibration,
      clubStrength,
      playerWeight,
      ageFactor,
      bootstrapSeasonSpan,
      buildContractDraft,
      buildClubSalaryPlan,
      seedContractsForTeams,
      seedContractForNewPlayer,
    },
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
