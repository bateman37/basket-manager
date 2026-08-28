// src/core/ContractService.js
// CONTRACT-1 (DESIGN.md 9.17) — Servicio de dominio del contrato: único
// sitio donde un contrato se crea, se valida contra la normativa resuelta y
// se registra. Convención del proyecto: identificadores en inglés,
// comentarios en español.
//
// Qué SÍ hace (sección 7.2 del prompt de CONTRACT-1):
//  - resuelve el contexto laboral del club (ClubEmploymentContextCatalog);
//  - resuelve las reglas aplicables (CompetitionRules.resolveEmploymentRules);
//  - valida fechas, duración, dinero, salario mínimo, cuotas, periodo de
//    prueba, menores y cláusulas;
//  - crea el `Contract`, lo registra y proyecta nómina.
//
// Qué NO hace (fuera de alcance de esta entrega):
//  - NO añade ni quita jugadores de `Team.roster`;
//  - NO ejecuta traspasos, cesiones, rescisiones ni cláusulas;
//  - NO concede licencias ni elegibilidad (REG-1);
//  - NO mueve caja, ni simula pagos realizados, impagos o impuestos.
//
// Ningún constructor de UI debe fabricar contratos por su cuenta, y
// `Team.addPlayer()` tampoco crea uno de forma oculta.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const ContractModule = isNode ? require('../entities/Contract.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const CatalogModule = isNode ? require('./ClubEmploymentContextCatalog.js') : global.BasketManager;
  const MoneyModule = isNode ? require('../utils/Money.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const CareerAgeModule = isNode ? require('../utils/CareerAge.js') : global.BasketManager;

  function M() { return MoneyModule.Money; }
  function LD() { return LocalDateModule.LocalDate; }
  function Catalog() { return CatalogModule.ClubEmploymentContextCatalog; }

  function toIso(date) {
    if (!date) return null;
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  // Edad CIVIL a una fecha dada (sin depender del reloj de la máquina).
  // CYCLE-1 (BUG-CYCLE1-01): delega en la API ÚNICA `CareerAge` — misma
  // función pura para contratos, retiro, academia, planificación y UI; este
  // wrapper se conserva porque CONTRACT-1 ya lo exponía en su API pública.
  function ageOnDate(player, isoDate) {
    return CareerAgeModule.CareerAge.ageOnDate(player, isoDate, 'isoDate');
  }

  // ---------------------------------------------------------------------
  // 1. Contexto y reglas
  // ---------------------------------------------------------------------
  function resolveEmploymentContext(team, options) {
    return Catalog().buildEmploymentContext(team, options || {});
  }

  // Resuelve la normativa laboral de UN club en una temporada/fecha. Nunca
  // se resuelve por "la competición del próximo partido": el empleador es
  // uno solo aunque el club dispute varias competiciones.
  function resolveRulesForClub(team, options) {
    const opts = options || {};
    const context = resolveEmploymentContext(team, opts);
    return CompetitionRules.resolveEmploymentRules({
      clubId: context.clubId,
      employerJurisdictionId: context.employerJurisdictionId,
      domesticCompetitionId: context.domesticCompetitionId,
      federationId: context.federationId,
      employmentProfileId: context.employmentProfileId,
      seasonKey: opts.seasonKey,
      date: toIso(opts.date),
      operation: opts.operation || 'validateContract',
      annualSalaryMinor: opts.annualSalaryMinor,
      pinnedModuleIds: opts.pinnedModuleIds,
      extraModuleIds: opts.extraModuleIds,
    });
  }

  // ---------------------------------------------------------------------
  // 2. Validación normativa de un contrato ya construido
  // ---------------------------------------------------------------------
  function validateContractAgainstRules(contract, resolved, options) {
    const opts = options || {};
    const errors = [];
    const warnings = [...(resolved.warnings || [])];
    const employment = resolved.employment;

    // Conflictos irresolubles entre capas: nunca se elige una en silencio.
    (resolved.conflicts || []).forEach((conflict) => {
      errors.push(`Conflicto normativo sin resolver (${conflict.field}): ${conflict.message}`);
    });

    // --- Duración -------------------------------------------------------
    if (employment.maxTermYears !== null) {
      const years = contract.termYears;
      // Margen de un día para no penalizar el redondeo de años civiles.
      if (years > employment.maxTermYears + (1 / 365)) {
        errors.push(
          `La duración del contrato (${years.toFixed(2)} años) supera el máximo resuelto de `
          + `${employment.maxTermYears} años (${(resolved.trace.fields.maxTermYears || []).map((t) => t.ruleModuleId).join(', ')}).`,
        );
      }
    }

    // --- Moneda y base --------------------------------------------------
    if (employment.allowedCurrencies && !employment.allowedCurrencies.includes(contract.compensation.currency)) {
      errors.push(
        `La moneda del contrato (${contract.compensation.currency}) no está entre las admitidas por el perfil `
        + `(${employment.allowedCurrencies.join(', ') || '(intersección vacía)'}).`,
      );
    }
    if (employment.allowedBases && !employment.allowedBases.includes(contract.compensation.declaredBasis)) {
      errors.push(
        `La base declarada (${contract.compensation.declaredBasis}) no está admitida por el perfil `
        + `(${employment.allowedBases.join(', ')}).`,
      );
    }

    // --- Forma escrita y documentación ----------------------------------
    if (employment.requiresWrittenForm && !contract.declaredDocuments.includes('written-contract')) {
      errors.push('El perfil aplicable exige contrato ESCRITO y el contrato no declara el documento "written-contract".');
    }
    employment.requiredDocuments.forEach((document) => {
      if (!contract.declaredDocuments.includes(document)) {
        errors.push(`Falta el documento obligatorio declarado por el perfil: "${document}".`);
      }
    });

    // --- Salario mínimo, por CAPA (cada una con sus componentes) --------
    contract.coveredSeasonKeys.forEach((seasonKey) => {
      employment.minimumSalaryRequirements.forEach((requirement) => {
        if (requirement.annualAmountMinor === null) return;
        if (requirement.currency !== contract.compensation.currency) {
          errors.push(
            `El mínimo salarial de "${requirement.ruleModuleId}" está en ${requirement.currency} y el contrato en `
            + `${contract.compensation.currency}: no se pueden comparar sin conversión (no implementada).`,
          );
          return;
        }
        const counted = contract.salaryForMinimumCheck(seasonKey, requirement.countingComponents);
        if (counted < requirement.annualAmountMinor) {
          errors.push(
            `La remuneración computable de ${seasonKey} (${M().format(counted, requirement.currency, { compact: true })}) `
            + `no alcanza el mínimo de ${M().format(requirement.annualAmountMinor, requirement.currency, { compact: true })} `
            + `exigido por "${requirement.ruleModuleId}" (componentes computables: ${requirement.countingComponents.join(', ')}).`,
          );
        }
        // El salario en ESPECIE no puede reducir el mínimo MONETARIO
        // cuando la capa lo prohíbe: se comprueba que los componentes
        // computables no incluyen especie por sí solos.
        if (!requirement.inKindCanReduceCashMinimum && requirement.countingComponents.includes('guaranteedSalaryInKind')) {
          errors.push(
            `Configuración normativa incoherente en "${requirement.ruleModuleId}": declara que la especie NO puede `
            + 'reducir el mínimo monetario pero la incluye entre los componentes computables.',
          );
        }
      });
    });

    // --- Periodo de prueba ----------------------------------------------
    if (contract.probation.enabled) {
      if (employment.probation.maxDays === null) {
        warnings.push('El contrato declara periodo de prueba pero el perfil resuelto no fija ningún máximo.');
      } else if (contract.probation.durationDays > employment.probation.maxDays) {
        errors.push(
          `El periodo de prueba (${contract.probation.durationDays} días) supera el máximo resuelto de `
          + `${employment.probation.maxDays} días (${employment.probation.decidedBy}).`,
        );
      }
    }

    // --- Cuotas y calendario ---------------------------------------------
    const range = employment.payments.installmentRange;
    if (range && contract.paymentPolicy.installmentCount) {
      if (contract.paymentPolicy.installmentCount < range.min || contract.paymentPolicy.installmentCount > range.max) {
        errors.push(
          `El número de cuotas (${contract.paymentPolicy.installmentCount}) queda fuera del rango resuelto `
          + `${range.min}-${range.max} (${range.sourceRuleIds.join(', ')}).`,
        );
      }
    }
    const scheduleCheck = contract.validatePaymentScheduleIntegrity();
    if (!scheduleCheck.valid) scheduleCheck.errors.forEach((error) => errors.push(error));

    // --- Cláusulas: solo las que el perfil admite -------------------------
    contract.clauses.forEach((clause) => {
      const policy = employment.clausePolicy[clause.type] || 'unspecified';
      if (policy === 'forbidden') {
        errors.push(`La cláusula "${clause.type}" está PROHIBIDA por el perfil resuelto (${resolved.profileId}).`);
      } else if (policy === 'unspecified' && clause.status !== 'fixture') {
        errors.push(
          `La cláusula "${clause.type}" no está sustentada por ninguna capa aplicable (queda "unspecified"): `
          + 'una cláusula no indicada por una fuente nunca se admite automáticamente.',
        );
      }
      if (clause.support !== 'modeled-only') {
        warnings.push(`La cláusula "${clause.type}" se declara ejecutable más adelante: CONTRACT-1 no ejecuta ninguna cláusula.`);
      }
    });

    // --- Menores ----------------------------------------------------------
    const player = opts.player;
    if (player) {
      const age = ageOnDate(player, contract.startDate);
      const minorRules = employment.minorRules;
      if (age !== null && minorRules.minimumWorkingAge !== null && age < minorRules.minimumWorkingAge) {
        errors.push(
          `No se puede crear un contrato laboral ordinario para un menor de ${minorRules.minimumWorkingAge} años `
          + `(edad a ${contract.startDate}: ${age}). La operación falla como error de dominio; nunca se corrige la edad en silencio.`,
        );
      } else if (age !== null && minorRules.consentRequiredUpToAge !== null && age <= minorRules.consentRequiredUpToAge) {
        const markers = (contract.minorProtections && contract.minorProtections.markers) || [];
        minorRules.requiredMarkers.forEach((marker) => {
          if (!markers.includes(marker)) {
            errors.push(
              `El jugador tiene ${age} años a ${contract.startDate}: el perfil exige el marcador "${marker}" `
              + '(simulado) y el contrato no lo declara.',
            );
          }
        });
        minorRules.prohibitions.forEach((prohibition) => {
          const allowed = (contract.minorProtections && contract.minorProtections.allowances) || [];
          if (allowed.includes(prohibition)) {
            errors.push(`El contrato habilita "${prohibition}", prohibido para menores por el perfil resuelto.`);
          }
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ---------------------------------------------------------------------
  // 3. Creación + registro
  // ---------------------------------------------------------------------
  // `draft` es la forma completa del contrato (la construye el seeder o un
  // fixture de test). Este servicio resuelve reglas, valida y registra —
  // nunca inventa importes por su cuenta.
  function createContract(params) {
    const {
      draft, team, player, registry, playerRegistry, seasonKey, date, resolved: preResolved, options,
    } = params || {};
    const opts = options || {};
    if (!draft) throw new Error('ContractService.createContract: falta "draft".');
    if (!team) throw new Error('ContractService.createContract: falta el club (team).');

    if (playerRegistry && !playerRegistry.has(draft.playerId)) {
      throw new Error(
        `ContractService.createContract: el jugador "${draft.playerId}" no está en PlayerRegistry — `
        + 'un contrato siempre referencia a un jugador que existe en el registro mundial.',
      );
    }
    if (draft.clubId !== team.id) {
      throw new Error(`ContractService.createContract: el contrato declara el club "${draft.clubId}" pero se está firmando con "${team.id}".`);
    }

    const contract = new ContractModule.Contract(draft);
    const resolved = preResolved || resolveRulesForClub(team, {
      seasonKey: seasonKey || contract.coveredSeasonKeys[0],
      date: date || contract.signedDate,
      operation: 'signContract',
      annualSalaryMinor: contract.breakdownForSeason(contract.coveredSeasonKeys[0]).guaranteedCashMinor,
      pinnedModuleIds: opts.pinnedModuleIds,
      extraModuleIds: opts.extraModuleIds,
    });

    // La traza normativa se CONGELA en la firma: un ascenso/descenso
    // posterior no reescribe la ley histórica de este contrato.
    contract.signingContext = CompetitionRules.buildSigningSnapshot(resolved);

    const validation = validateContractAgainstRules(contract, resolved, { player });
    if (!validation.valid) {
      throw new Error(
        `ContractService.createContract: contrato inválido para el perfil ${resolved.profileId} — `
        + validation.errors.join(' | '),
      );
    }

    if (registry) registry.register(contract);
    return { contract, resolved, warnings: validation.warnings };
  }

  // ---------------------------------------------------------------------
  // 3-bis. MARKET-1 (DESIGN.md 9.19, sección 9.4 del prompt) — validación
  // PURA de un borrador de oferta, SIN registrar. `createContract()`
  // registra y por eso no puede usarse desde MARKET-1; esta función repite
  // exactamente los mismos cuatro pasos (construir/resolver/validar) pero
  // NUNCA llama a `registry.register()` ni a nómina — construye un
  // `Contract` EFÍMERO, solo para comparar/validar, que el llamador
  // descarta.
  //
  // Añade además la comprobación que CONTRACT-1 no necesitaba: el
  // borrador no puede solaparse con el contrato VIGENTE/PENDIENTE actual
  // del jugador. Si el contrato actual es del MISMO club, es un error
  // (una renovación real no es una oferta de mercado, pertenece a
  // CYCLE-1). Si es de OTRO club, no es un error — es exactamente el caso
  // de "jugador bajo contrato" (sección 12.2 del prompt): la oferta queda
  // marcada `requiresTransferResolution: true`, nunca se disfraza de
  // contrato ya válido para registrar.
  // ---------------------------------------------------------------------
  function validateDraft(params) {
    const {
      draft, team, player, playerRegistry, contractRegistry, seasonKey, date, resolved: preResolved, options,
    } = params || {};
    const opts = options || {};
    const errors = [];
    if (!draft) throw new Error('ContractService.validateDraft: falta "draft".');
    if (!team) throw new Error('ContractService.validateDraft: falta el club (team).');

    if (playerRegistry && !playerRegistry.has(draft.playerId)) {
      errors.push(`El jugador "${draft.playerId}" no está en PlayerRegistry.`);
    }
    if (draft.clubId !== team.id) {
      errors.push(`El borrador declara el club "${draft.clubId}" pero se está validando contra "${team.id}".`);
    }

    let contract = null;
    try {
      contract = new ContractModule.Contract(draft);
    } catch (err) {
      return {
        valid: false,
        errors: [...errors, err.message],
        warnings: [],
        contract: null,
        resolved: null,
        signingContext: null,
        requiresTransferResolution: false,
        overlapsCurrentContract: false,
      };
    }

    const resolved = preResolved || resolveRulesForClub(team, {
      seasonKey: seasonKey || contract.coveredSeasonKeys[0],
      date: date || contract.signedDate,
      operation: 'validateMarketOffer',
      annualSalaryMinor: contract.breakdownForSeason(contract.coveredSeasonKeys[0]).guaranteedCashMinor,
      pinnedModuleIds: opts.pinnedModuleIds,
      extraModuleIds: opts.extraModuleIds,
    });

    const rulesValidation = validateContractAgainstRules(contract, resolved, { player });
    errors.push(...rulesValidation.errors);

    let overlapsCurrentContract = false;
    let requiresTransferResolution = false;
    if (contractRegistry) {
      const current = contractRegistry.currentForPlayer(draft.playerId, date || contract.signedDate);
      if (current && current.overlaps(contract)) {
        overlapsCurrentContract = true;
        if (current.clubId !== draft.clubId) {
          // Incorporación inmediata bajo contrato ajeno — MARKET-1 puede
          // registrar interés/condiciones, pero la incorporación queda
          // condicionada a TRANSFER-1 (traspaso/rescisión/buyout).
          requiresTransferResolution = true;
        } else {
          errors.push(
            `El borrador se solapa con el contrato vigente/pendiente "${current.id}" del MISMO club — una `
            + 'renovación real no es una oferta de mercado (fuera de alcance de MARKET-1, ver CYCLE-1).',
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: rulesValidation.warnings || [],
      // Instancia EFÍMERA de comparación — NUNCA registrada, NUNCA pasada
      // a `ContractRegistry.register()`/`Team.addPlayer()` desde MARKET-1.
      contract,
      resolved,
      signingContext: CompetitionRules.buildSigningSnapshot(resolved),
      requiresTransferResolution,
      overlapsCurrentContract,
    };
  }

  // ---------------------------------------------------------------------
  // 4. Proyecciones económicas (funciones PURAS sobre el registro)
  //
  //    ContractRegistry es la fuente canónica del payroll contractual: la
  //    interfaz y `team.finances.expenses.playerSalaries` son PROYECCIONES
  //    derivadas, nunca una segunda verdad editable.
  // ---------------------------------------------------------------------
  function guaranteedPayrollForClub(registry, clubId, seasonKey) {
    const contracts = registry.forClubInSeason(clubId, seasonKey);
    const amountMinor = contracts.reduce(
      (acc, contract) => acc + contract.breakdownForSeason(seasonKey).guaranteedTotalMinor, 0,
    );
    return { amountMinor, currency: 'EUR', contracts: contracts.length, seasonKey };
  }

  function potentialVariableCompensationForClub(registry, clubId, seasonKey) {
    const amountMinor = registry.forClubInSeason(clubId, seasonKey)
      .reduce((acc, contract) => acc + contract.breakdownForSeason(seasonKey).variableMaxMinor, 0);
    return { amountMinor, currency: 'EUR', seasonKey };
  }

  function benefitsValueForClub(registry, clubId, seasonKey) {
    const amountMinor = registry.forClubInSeason(clubId, seasonKey)
      .reduce((acc, contract) => acc + contract.breakdownForSeason(seasonKey).benefitsValueMinor, 0);
    return { amountMinor, currency: 'EUR', seasonKey };
  }

  function agentCostsForClub(registry, clubId, seasonKey) {
    const amountMinor = registry.forClubInSeason(clubId, seasonKey)
      .reduce((acc, contract) => acc + contract.breakdownForSeason(seasonKey).agentCostsMinor, 0);
    return { amountMinor, currency: 'EUR', seasonKey };
  }

  // Compromisos por CADA temporada futura cubierta por algún contrato del
  // club (sin inventar un "presupuesto disponible" que no existe).
  function futureCommitmentsForClub(registry, clubId, fromSeasonKey) {
    const seasonKeys = [...new Set(
      registry.forClub(clubId).reduce((acc, contract) => acc.concat(contract.coveredSeasonKeys), []),
    )]
      .filter((seasonKey) => LD().compareSeasonKeys(seasonKey, fromSeasonKey) >= 0)
      .sort((a, b) => LD().compareSeasonKeys(a, b));
    return seasonKeys.map((seasonKey) => ({
      seasonKey,
      guaranteed: guaranteedPayrollForClub(registry, clubId, seasonKey),
      variableMax: potentialVariableCompensationForClub(registry, clubId, seasonKey),
      benefits: benefitsValueForClub(registry, clubId, seasonKey),
      agentCosts: agentCostsForClub(registry, clubId, seasonKey),
    }));
  }

  function compensationBreakdownForContract(contract, seasonKey) {
    return contract.breakdownForSeason(seasonKey);
  }

  // `team.finances.expenses.playerSalaries` YA EXISTÍA (DESIGN.md 6.2.6) y
  // en los datos reales vale 0. Aquí deja de ser un valor editable y pasa a
  // ser una PROYECCIÓN refrescada por esta única función desde el registro
  // (los tests comprueban que ambos coinciden). No se deduce de ninguna
  // caja: CONTRACT-1 no mueve dinero.
  function refreshTeamSalaryProjection(team, registry, seasonKey) {
    const payroll = guaranteedPayrollForClub(registry, team.id, seasonKey);
    team.finances.expenses.playerSalaries = M().toMajorUnits(payroll.amountMinor, payroll.currency);
    return payroll;
  }

  const exportsObj = {
    ContractService: {
      ageOnDate,
      resolveEmploymentContext,
      resolveRulesForClub,
      validateContractAgainstRules,
      createContract,
      validateDraft,
      guaranteedPayrollForClub,
      potentialVariableCompensationForClub,
      benefitsValueForClub,
      agentCostsForClub,
      futureCommitmentsForClub,
      compensationBreakdownForContract,
      refreshTeamSalaryProjection,
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
