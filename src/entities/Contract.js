// src/entities/Contract.js
// CONTRACT-1 (DESIGN.md 9.17) — Entidad Contrato profesional: relación
// LABORAL canónica entre un club y un jugador. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Separación de conceptos que esta EPIC mantiene desde ROSTER-1 (DESIGN.md
// 9.16/9.17) y que este archivo NO debe romper nunca:
//
//   identidad del jugador != afiliación al club != contrato laboral
//                          != licencia/inscripción != elegibilidad de partido
//                          != autorización internacional de transferencia
//
// Un contrato NO concede una licencia (REG-1), no mueve a nadie de
// `Team.roster`, no ejecuta traspasos/cesiones/rescisiones (TRANSFER-1/
// LOAN-1) y no simula pagos realizados, impagos ni caja.
//
// Reglas estructurales (secciones 6.1-6.7 del prompt de CONTRACT-1):
//  - todo importe es ENTERO en unidad mínima (`...Minor`) + moneda ISO;
//  - las fechas son civiles ISO `YYYY-MM-DD` e INCLUSIVAS en ambos extremos;
//  - el ESTADO se DERIVA de fechas + eventos, no se guarda como verdad
//    mutable ("expira pronto" es una etiqueta de UI, nunca un estado);
//  - las cláusulas son una UNIÓN DISCRIMINADA con validador propio, nunca
//    un objeto libre ni booleanos tipo `hasTanteo`;
//  - los totales son DERIVADOS, nunca campos editables duplicados.
//
// Este archivo valida la FORMA y la coherencia interna del contrato. La
// validación NORMATIVA (mínimos salariales, duración máxima, periodo de
// prueba, cláusulas permitidas, menores) vive en ContractService.js, que es
// quien resuelve las reglas aplicables con CompetitionRules.

(function (global) {
  const MoneyModule = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/Money.js')
    : global.BasketManager;
  const LocalDateModule = (typeof module !== 'undefined' && module.exports)
    ? require('../utils/LocalDate.js')
    : global.BasketManager;

  function M() { return MoneyModule.Money; }
  function LD() { return LocalDateModule.LocalDate; }

  const CONTRACT_TYPES = ['professional-player'];

  const GUARANTEE_TYPES = ['fully-guaranteed', 'partially-guaranteed', 'non-guaranteed'];

  // Estados DERIVADOS (nunca persistidos como verdad mutable).
  const CONTRACT_STATUSES = ['pending', 'active', 'expired', 'terminated', 'void'];

  // Componentes de remuneración — nombres estables usados también por los
  // RuleModule laborales (`countingComponents`) para decidir QUÉ cuenta
  // como salario a efectos de cada mínimo. Que una partida sea
  // "garantizada" no la convierte en salario a todos los efectos.
  const COMPENSATION_COMPONENTS = [
    'guaranteedBaseSalary',
    'guaranteedImageRights',
    'guaranteedSalaryInKind',
    'signingBonus',
    'variableBonuses',
    'nonSalaryBenefits',
    'agentCosts',
  ];

  // --- Cláusulas tipadas (unión discriminada) ----------------------------
  // Cada tipo declara quién es el titular del derecho, si necesita importe
  // o ventana de ejercicio, y su propio validador. Ninguna cláusula es
  // ejecutable en CONTRACT-1: todas son `modeled-only`.
  //
  // El derecho de TANTEO no está aquí a propósito: no es una cláusula
  // booleana, será una máquina de estados (oferta, plazo, igualación,
  // resolución) en MARKET-1.
  const CLAUSE_SUPPORT_LEVELS = ['modeled-only', 'executable-later'];

  const CLAUSE_TYPE_DEFINITIONS = {
    'player-release': {
      type: 'player-release',
      label: 'Cláusula de rescisión del jugador (buyout)',
      allowedHolders: ['player'],
      requiresAmount: true,
      requiresWindow: false,
      // Un buyout contractual NO es un transfer fee: lo paga el jugador (o
      // un tercero por él) para extinguir su contrato, no es el precio de
      // un acuerdo entre clubes (TRANSFER-1).
      notes: 'Importe de salida del jugador; distinto de un traspaso club-club.',
    },
    'player-option': {
      type: 'player-option',
      label: 'Opción del jugador',
      allowedHolders: ['player'],
      requiresAmount: false,
      requiresWindow: true,
    },
    'club-option': {
      type: 'club-option',
      label: 'Opción del club',
      allowedHolders: ['club'],
      requiresAmount: false,
      requiresWindow: true,
    },
    'mutual-option': {
      type: 'mutual-option',
      label: 'Opción mutua',
      allowedHolders: ['mutual'],
      requiresAmount: false,
      requiresWindow: true,
    },
    'automatic-renewal': {
      type: 'automatic-renewal',
      label: 'Renovación automática',
      allowedHolders: ['none', 'club', 'player', 'mutual'],
      requiresAmount: false,
      requiresWindow: false,
    },
    'relegation-or-nonqualification-out': {
      type: 'relegation-or-nonqualification-out',
      label: 'Salida por descenso o no clasificación',
      allowedHolders: ['player', 'club', 'mutual'],
      requiresAmount: false,
      requiresWindow: false,
    },
    'nba-out': {
      type: 'nba-out',
      label: 'Salida NBA',
      allowedHolders: ['player'],
      requiresAmount: false,
      requiresWindow: true,
    },
    'medical-condition': {
      type: 'medical-condition',
      label: 'Condición médica',
      allowedHolders: ['club', 'mutual'],
      requiresAmount: false,
      requiresWindow: false,
    },
    'team-performance-bonus': {
      type: 'team-performance-bonus',
      label: 'Prima por rendimiento de equipo',
      allowedHolders: ['player'],
      requiresAmount: true,
      requiresWindow: false,
    },
    'individual-performance-bonus': {
      type: 'individual-performance-bonus',
      label: 'Prima por rendimiento individual',
      allowedHolders: ['player'],
      requiresAmount: true,
      requiresWindow: false,
    },
  };

  function isKnownClauseType(type) {
    return Object.prototype.hasOwnProperty.call(CLAUSE_TYPE_DEFINITIONS, type);
  }

  function validateClause(clause, options) {
    const opts = options || {};
    const errors = [];
    if (!clause || typeof clause !== 'object') {
      return { valid: false, errors: ['Cláusula vacía o no es un objeto.'] };
    }
    if (!clause.id) errors.push('Cláusula sin id.');
    if (!isKnownClauseType(clause.type)) {
      errors.push(
        `Tipo de cláusula desconocido "${clause.type}" — solo se aceptan tipos del catálogo `
        + `(${Object.keys(CLAUSE_TYPE_DEFINITIONS).join(', ')}); una cláusula desconocida nunca se acepta en silencio.`,
      );
      return { valid: false, errors };
    }
    const definition = CLAUSE_TYPE_DEFINITIONS[clause.type];
    if (!definition.allowedHolders.includes(clause.holder)) {
      errors.push(`La cláusula "${clause.type}" no admite el titular "${clause.holder}" (permitidos: ${definition.allowedHolders.join(', ')}).`);
    }
    if (definition.requiresAmount) {
      if (!clause.amount || !M().isValidAmountMinor(clause.amount.amountMinor)) {
        errors.push(`La cláusula "${clause.type}" exige un importe entero en unidad mínima.`);
      } else {
        M().requireCurrency(clause.amount.currency);
        if (opts.currency && clause.amount.currency !== opts.currency) {
          errors.push(`La cláusula "${clause.type}" usa la moneda ${clause.amount.currency}, distinta de la del contrato (${opts.currency}).`);
        }
      }
    }
    if (definition.requiresWindow) {
      if (!clause.window || !LD().isValidIsoDate(clause.window.fromDate) || !LD().isValidIsoDate(clause.window.toDate)) {
        errors.push(`La cláusula "${clause.type}" exige una ventana de ejercicio con fechas ISO válidas.`);
      } else if (LD().isAfter(clause.window.fromDate, clause.window.toDate)) {
        errors.push(`La ventana de ejercicio de la cláusula "${clause.type}" empieza después de terminar.`);
      }
    }
    if (!CLAUSE_SUPPORT_LEVELS.includes(clause.support)) {
      errors.push(`La cláusula "${clause.type}" debe declarar su nivel de soporte (${CLAUSE_SUPPORT_LEVELS.join(' | ')}).`);
    }
    if (clause.support === 'executable-later') {
      // CONTRACT-1 no ejecuta ninguna cláusula: se admite declararla como
      // "ejecutable más adelante", pero nunca se ejecuta aquí.
    }
    return { valid: errors.length === 0, errors };
  }

  // --- Calendario de pagos (generador PURO) ------------------------------
  // No crea estado paid/unpaid, no mueve caja, no simula mora ni impago.
  // La suma del calendario es SIEMPRE exactamente `totalMinor`.
  const PAYMENT_FREQUENCY_STEPS = { weekly: null, biweekly: null, monthly: 1, quarterly: 3 };

  function buildPaymentSchedule(options) {
    const {
      totalMinor, installmentCount, firstDueDate, frequency, currency, seasonKey,
    } = options || {};
    M().requireAmountMinor(totalMinor, 'totalMinor');
    M().requireCurrency(currency);
    LD().requireIsoDate(firstDueDate, 'firstDueDate');
    if (!Number.isInteger(installmentCount) || installmentCount <= 0) {
      throw new Error(`buildPaymentSchedule: "installmentCount" debe ser un entero positivo (recibido ${JSON.stringify(installmentCount)}).`);
    }
    const monthStep = PAYMENT_FREQUENCY_STEPS[frequency];
    if (!monthStep) {
      throw new Error(
        `buildPaymentSchedule: periodicidad "${frequency}" no soportada todavía `
        + `(soportadas: ${Object.keys(PAYMENT_FREQUENCY_STEPS).filter((k) => PAYMENT_FREQUENCY_STEPS[k]).join(', ')}).`,
      );
    }
    const amounts = M().allocate(totalMinor, installmentCount);
    // Si la primera fecha es fin de mes, TODAS las cuotas caen a fin de mes
    // (31-01 -> 28/29-02 -> 31-03...), en vez de arrastrar el día 28.
    const anchorIsEndOfMonth = firstDueDate === LD().endOfMonth(firstDueDate);
    return amounts.map((amountMinor, index) => {
      let dueDate = LD().addMonths(firstDueDate, monthStep * index);
      if (anchorIsEndOfMonth) dueDate = LD().endOfMonth(dueDate);
      return {
        seasonKey: seasonKey || null,
        index: index + 1,
        dueDate,
        amountMinor,
        currency,
      };
    });
  }

  // --- Entidad -----------------------------------------------------------
  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'contract-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function normalizeAmountList(list, label, currency) {
    return (list || []).map((entry, index) => {
      const amountMinor = entry.amountMinor !== undefined && entry.amountMinor !== null ? entry.amountMinor : null;
      if (amountMinor !== null) M().requireAmountMinor(amountMinor, `${label}[${index}].amountMinor`);
      const entryCurrency = entry.currency || currency;
      M().requireCurrency(entryCurrency);
      if (entryCurrency !== currency) {
        throw new Error(`Contract: "${label}[${index}]" usa la moneda ${entryCurrency}, distinta de la del contrato (${currency}).`);
      }
      return {
        id: entry.id || `${label}-${index + 1}`,
        type: entry.type || null,
        label: entry.label || null,
        amountMinor,
        currency: entryCurrency,
        basis: entry.basis || null,
        condition: entry.condition || null,
        valued: entry.valued !== undefined ? Boolean(entry.valued) : amountMinor !== null,
        paidBy: entry.paidBy || null, // costes de agente: 'club' | 'player'
        countsAsSalary: entry.countsAsSalary !== undefined ? Boolean(entry.countsAsSalary) : false,
      };
    });
  }

  class Contract {
    constructor(data = {}) {
      const d = data || {};
      this.id = d.id || generateId();
      if (!d.playerId) throw new Error('Contract: falta "playerId" (un contrato siempre referencia a un jugador existente).');
      if (!d.clubId) throw new Error('Contract: falta "clubId" (un contrato siempre referencia a un club existente).');
      this.playerId = d.playerId;
      this.clubId = d.clubId;
      this.contractType = d.contractType || 'professional-player';
      if (!CONTRACT_TYPES.includes(this.contractType)) {
        throw new Error(`Contract: tipo de contrato no soportado "${this.contractType}" (disponibles: ${CONTRACT_TYPES.join(', ')}).`);
      }

      // --- Vigencia: fechas civiles ISO, ambas INCLUSIVAS ---------------
      this.signedDate = LD().requireIsoDate(d.signedDate, 'signedDate');
      this.startDate = LD().requireIsoDate(d.startDate, 'startDate');
      this.endDate = LD().requireIsoDate(d.endDate, 'endDate');
      if (LD().isAfter(this.startDate, this.endDate)) {
        throw new Error(`Contract: startDate (${this.startDate}) no puede ser posterior a endDate (${this.endDate}).`);
      }
      if (LD().isAfter(this.signedDate, this.startDate)) {
        // Firmar DESPUÉS del inicio de vigencia no es un caso soportado en
        // esta entrega (no hay altas retroactivas): se rechaza explícito.
        throw new Error(`Contract: signedDate (${this.signedDate}) no puede ser posterior a startDate (${this.startDate}).`);
      }
      this.coveredSeasonKeys = Array.isArray(d.coveredSeasonKeys) && d.coveredSeasonKeys.length
        ? [...d.coveredSeasonKeys]
        : LD().seasonKeysCovered(this.startDate, this.endDate);

      // --- Garantía y periodo de prueba ---------------------------------
      this.guaranteeType = d.guaranteeType || 'fully-guaranteed';
      if (!GUARANTEE_TYPES.includes(this.guaranteeType)) {
        throw new Error(`Contract: guaranteeType no válido "${this.guaranteeType}" (disponibles: ${GUARANTEE_TYPES.join(', ')}).`);
      }
      const probation = d.probation || null;
      this.probation = probation && probation.enabled ? {
        enabled: true,
        startDate: LD().requireIsoDate(probation.startDate, 'probation.startDate'),
        endDate: LD().requireIsoDate(probation.endDate, 'probation.endDate'),
        durationDays: probation.durationDays,
        legalBasisRuleIds: [...(probation.legalBasisRuleIds || [])],
      } : { enabled: false, startDate: null, endDate: null, durationDays: 0, legalBasisRuleIds: [] };
      if (this.probation.enabled) {
        if (LD().isBefore(this.probation.startDate, this.startDate) || LD().isAfter(this.probation.endDate, this.endDate)) {
          throw new Error('Contract: el periodo de prueba debe quedar DENTRO de la vigencia del contrato.');
        }
      }

      // --- Remuneración --------------------------------------------------
      const compensation = d.compensation || {};
      const currency = compensation.currency || 'EUR';
      M().requireCurrency(currency);
      const declaredBasis = compensation.declaredBasis || 'gross';
      M().requireBasis(declaredBasis);
      this.compensation = {
        currency,
        declaredBasis,
        // Un futuro contrato NETO debe conservar aparte el bruto estimado —
        // CONTRACT-1 no implementa motor fiscal (queda declarado, no usado).
        estimatedGrossReference: compensation.estimatedGrossReference || null,
        seasons: (compensation.seasons || []).map((season) => {
          if (!LD().isValidSeasonKey(season.seasonKey)) {
            throw new Error(`Contract: clave de temporada inválida en la remuneración: "${season.seasonKey}".`);
          }
          return {
            seasonKey: season.seasonKey,
            guaranteedBaseSalaryMinor: M().requireAmountMinor(season.guaranteedBaseSalaryMinor || 0, 'guaranteedBaseSalaryMinor'),
            guaranteedImageRightsMinor: M().requireAmountMinor(season.guaranteedImageRightsMinor || 0, 'guaranteedImageRightsMinor'),
            guaranteedSalaryInKindMinor: M().requireAmountMinor(season.guaranteedSalaryInKindMinor || 0, 'guaranteedSalaryInKindMinor'),
            signingBonusMinor: M().requireAmountMinor(season.signingBonusMinor || 0, 'signingBonusMinor'),
            variableBonuses: normalizeAmountList(season.variableBonuses, 'variableBonuses', currency),
            nonSalaryBenefits: normalizeAmountList(season.nonSalaryBenefits, 'nonSalaryBenefits', currency),
            agentCosts: normalizeAmountList(season.agentCosts, 'agentCosts', currency),
          };
        }),
      };
      const compensationSeasons = this.compensation.seasons.map((s) => s.seasonKey);
      this.coveredSeasonKeys.forEach((seasonKey) => {
        if (!compensationSeasons.includes(seasonKey)) {
          throw new Error(`Contract: la temporada cubierta "${seasonKey}" no tiene desglose de remuneración.`);
        }
      });

      // --- Política y calendario de pagos --------------------------------
      const paymentPolicy = d.paymentPolicy || {};
      this.paymentPolicy = {
        installmentCount: paymentPolicy.installmentCount || null,
        frequency: paymentPolicy.frequency || null,
        // Qué componentes se pagan a plazos (el resto —especie, primas
        // variables, beneficios— no forma parte del calendario).
        scheduledComponents: paymentPolicy.scheduledComponents
          ? [...paymentPolicy.scheduledComponents]
          : ['guaranteedBaseSalary', 'guaranteedImageRights'],
        schedule: (paymentPolicy.schedule || []).map((installment) => ({
          seasonKey: installment.seasonKey,
          index: installment.index,
          dueDate: LD().requireIsoDate(installment.dueDate, 'schedule.dueDate'),
          amountMinor: M().requireAmountMinor(installment.amountMinor, 'schedule.amountMinor'),
          currency: installment.currency || currency,
        })),
      };
      this.paymentPolicy.firstDueDate = this.paymentPolicy.schedule.length
        ? this.paymentPolicy.schedule[0].dueDate : (paymentPolicy.firstDueDate || null);

      // --- Cláusulas tipadas ---------------------------------------------
      this.clauses = (d.clauses || []).map((clause, index) => {
        const normalized = {
          id: clause.id || `clause-${index + 1}`,
          type: clause.type,
          holder: clause.holder,
          window: clause.window ? { fromDate: clause.window.fromDate, toDate: clause.window.toDate } : null,
          amount: clause.amount ? {
            amountMinor: clause.amount.amountMinor,
            currency: clause.amount.currency || currency,
            basis: clause.amount.basis || declaredBasis,
          } : null,
          conditions: clause.conditions || {},
          sourceRuleIds: [...(clause.sourceRuleIds || [])],
          status: clause.status || 'simulated',
          support: clause.support || 'modeled-only',
        };
        const validation = validateClause(normalized, { currency });
        if (!validation.valid) {
          throw new Error(`Contract: cláusula inválida — ${validation.errors.join(' ')}`);
        }
        return normalized;
      });

      // --- Representación (MARKET-1) --------------------------------------
      // Se modela la forma, no el comportamiento: CONTRACT-1 no crea
      // agentes ni comisiones.
      const representation = d.representation || {};
      this.representation = { agentId: representation.agentId || null, mandateId: representation.mandateId || null };

      // --- Documentación declarada ----------------------------------------
      // Qué documentos declara aportar el contrato (forma escrita, copia de
      // depósito en la competición...). Son MARCADORES: CONTRACT-1 no
      // genera ni almacena documentos reales, y esto NO es una licencia ni
      // una inscripción (REG-1).
      this.declaredDocuments = [...(d.declaredDocuments || [])];

      // --- Protecciones de menores (marcadores SIMULADOS) -----------------
      this.minorProtections = d.minorProtections ? { ...d.minorProtections } : null;

      // --- Contexto normativo CONGELADO en la firma -----------------------
      // Un ascenso/descenso posterior NO reescribe la ley histórica de un
      // contrato ya firmado (sección 2 del prompt).
      this.signingContext = d.signingContext ? Object.freeze({ ...d.signingContext }) : null;

      // --- Eventos de ciclo de vida ---------------------------------------
      this.lifecycleEvents = (d.lifecycleEvents || []).map((event) => ({
        id: event.id || `event-${Math.random().toString(36).slice(2, 9)}`,
        type: event.type,
        date: LD().requireIsoDate(event.date, 'lifecycleEvent.date'),
        note: event.note || null,
      }));

      // --- Procedencia (honestidad de datos) ------------------------------
      const provenance = d.provenance || {};
      this.provenance = {
        dataSource: provenance.dataSource || null,
        isReal: provenance.isReal === true,
        generatorVersion: provenance.generatorVersion || null,
        seedFingerprint: provenance.seedFingerprint || null,
      };
    }

    // --- Estado DERIVADO ---------------------------------------------------
    statusOn(date) {
      const iso = typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
      const voidEvent = this.lifecycleEvents.find((e) => e.type === 'voided' && !LD().isAfter(e.date, iso));
      if (voidEvent) return 'void';
      const terminationEvent = this.lifecycleEvents.find((e) => e.type === 'terminated' && !LD().isAfter(e.date, iso));
      if (terminationEvent) return 'terminated';
      if (LD().isBefore(iso, this.startDate)) return 'pending';
      if (LD().isAfter(iso, this.endDate)) return 'expired';
      return 'active';
    }

    isActiveOn(date) { return this.statusOn(date) === 'active'; }

    // "Vigente o pendiente": un contrato ya firmado que todavía no ha
    // empezado sigue siendo un compromiso vivo del club.
    isCurrentOn(date) {
      const status = this.statusOn(date);
      return status === 'active' || status === 'pending';
    }

    // Se SOLAPA con otro contrato del mismo jugador (fechas inclusivas).
    overlaps(other) {
      return !(LD().isAfter(this.startDate, other.endDate) || LD().isAfter(other.startDate, this.endDate));
    }

    get termYears() {
      return LD().inclusiveTermYears(this.startDate, this.endDate);
    }

    remainingSeasonKeys(seasonKey) {
      return this.coveredSeasonKeys.filter((key) => LD().compareSeasonKeys(key, seasonKey) >= 0);
    }

    compensationForSeason(seasonKey) {
      return this.compensation.seasons.find((season) => season.seasonKey === seasonKey) || null;
    }

    // --- Totales DERIVADOS (nunca campos editables duplicados) -----------
    breakdownForSeason(seasonKey) {
      const season = this.compensationForSeason(seasonKey);
      const currency = this.compensation.currency;
      if (!season) {
        return {
          seasonKey, currency, basis: this.compensation.declaredBasis,
          guaranteedCashMinor: 0, guaranteedInKindMinor: 0, guaranteedTotalMinor: 0,
          signingBonusMinor: 0, variableMaxMinor: 0, benefitsValueMinor: 0, agentCostsMinor: 0,
        };
      }
      const guaranteedCashMinor = M().sumMinor([
        season.guaranteedBaseSalaryMinor, season.guaranteedImageRightsMinor, season.signingBonusMinor,
      ], 'guaranteedCash');
      const variableMaxMinor = M().sumMinor(
        season.variableBonuses.map((b) => b.amountMinor || 0), 'variableBonuses',
      );
      const benefitsValueMinor = M().sumMinor(
        season.nonSalaryBenefits.map((b) => b.amountMinor || 0), 'nonSalaryBenefits',
      );
      const agentCostsMinor = M().sumMinor(
        season.agentCosts.map((c) => c.amountMinor || 0), 'agentCosts',
      );
      return {
        seasonKey,
        currency,
        basis: this.compensation.declaredBasis,
        guaranteedBaseSalaryMinor: season.guaranteedBaseSalaryMinor,
        guaranteedImageRightsMinor: season.guaranteedImageRightsMinor,
        guaranteedSalaryInKindMinor: season.guaranteedSalaryInKindMinor,
        signingBonusMinor: season.signingBonusMinor,
        guaranteedCashMinor,
        guaranteedInKindMinor: season.guaranteedSalaryInKindMinor,
        guaranteedTotalMinor: guaranteedCashMinor + season.guaranteedSalaryInKindMinor,
        variableMaxMinor,
        benefitsValueMinor,
        agentCostsMinor,
      };
    }

    // Importe de la temporada que SÍ entra en el calendario de pagos.
    scheduledAmountForSeason(seasonKey) {
      const season = this.compensationForSeason(seasonKey);
      if (!season) return 0;
      const map = {
        guaranteedBaseSalary: season.guaranteedBaseSalaryMinor,
        guaranteedImageRights: season.guaranteedImageRightsMinor,
        guaranteedSalaryInKind: season.guaranteedSalaryInKindMinor,
        signingBonus: season.signingBonusMinor,
      };
      return M().sumMinor(
        this.paymentPolicy.scheduledComponents.map((component) => map[component] || 0),
        'scheduledComponents',
      );
    }

    // Suma de los componentes que una regla concreta clasifica como salario
    // a efectos de SU mínimo (sección 6.4: "el resolver define qué
    // componentes cuentan para cada mínimo").
    salaryForMinimumCheck(seasonKey, countingComponents) {
      const season = this.compensationForSeason(seasonKey);
      if (!season) return 0;
      const map = {
        guaranteedBaseSalary: season.guaranteedBaseSalaryMinor,
        guaranteedImageRights: season.guaranteedImageRightsMinor,
        guaranteedSalaryInKind: season.guaranteedSalaryInKindMinor,
        signingBonus: season.signingBonusMinor,
        variableBonuses: M().sumMinor(season.variableBonuses.map((b) => b.amountMinor || 0), 'variableBonuses'),
      };
      return M().sumMinor((countingComponents || []).map((c) => map[c] || 0), 'salaryForMinimumCheck');
    }

    scheduleForSeason(seasonKey) {
      return this.paymentPolicy.schedule.filter((installment) => installment.seasonKey === seasonKey);
    }

    // Coherencia interna del calendario: cada temporada cuadra al céntimo.
    validatePaymentScheduleIntegrity() {
      const errors = [];
      this.coveredSeasonKeys.forEach((seasonKey) => {
        const installments = this.scheduleForSeason(seasonKey);
        const scheduled = this.scheduledAmountForSeason(seasonKey);
        const sum = M().sumMinor(installments.map((i) => i.amountMinor), 'schedule');
        if (sum !== scheduled) {
          errors.push(
            `El calendario de pagos de ${seasonKey} suma ${sum} pero la remuneración planificada incluida en pagos `
            + `es ${scheduled} (deben coincidir exactamente al céntimo).`,
          );
        }
        installments.forEach((installment) => {
          if (LD().isBefore(installment.dueDate, this.startDate) || LD().isAfter(installment.dueDate, this.endDate)) {
            errors.push(
              `La cuota ${installment.index} de ${seasonKey} vence el ${installment.dueDate}, fuera de la vigencia `
              + `del contrato (${this.startDate}..${this.endDate}).`,
            );
          }
        });
      });
      return { valid: errors.length === 0, errors };
    }

    addLifecycleEvent(event) {
      const normalized = {
        id: event.id || `event-${this.lifecycleEvents.length + 1}`,
        type: event.type,
        date: LD().requireIsoDate(event.date, 'lifecycleEvent.date'),
        note: event.note || null,
      };
      this.lifecycleEvents.push(normalized);
      return normalized;
    }

    // BUG-TRANSFER1-13 (DESIGN.md 9.21): reversión EXACTA de un
    // addLifecycleEvent — un rollback de TRANSFER-1/LOAN-1 nunca debe tocar
    // `this.lifecycleEvents` desde fuera (array privado del agregado); esta
    // es la única API reversible. Devuelve el evento eliminado, o `null` si
    // no existía (idempotente).
    removeLifecycleEvent(id) {
      const index = this.lifecycleEvents.findIndex((e) => e.id === id);
      if (index === -1) return null;
      return this.lifecycleEvents.splice(index, 1)[0];
    }

    // --- DTO comparable para MARKET-1 (proyección PURA, nunca otra fuente
    // de verdad: siempre se deriva del contrato).
    toComparableOffer(seasonKey) {
      const breakdown = this.breakdownForSeason(seasonKey);
      const releaseClause = this.clauses.find((c) => c.type === 'player-release') || null;
      return {
        contractId: this.id,
        playerId: this.playerId,
        clubId: this.clubId,
        seasonKey,
        remainingSeasons: this.remainingSeasonKeys(seasonKey).length,
        currency: breakdown.currency,
        basis: breakdown.basis,
        guaranteedFixedMinor: breakdown.guaranteedBaseSalaryMinor,
        imageAndInKindMinor: breakdown.guaranteedImageRightsMinor + breakdown.guaranteedSalaryInKindMinor,
        guaranteeType: this.guaranteeType,
        buyoutMinor: releaseClause && releaseClause.amount ? releaseClause.amount.amountMinor : null,
        variableMaxMinor: breakdown.variableMaxMinor,
        agentCostsMinor: breakdown.agentCostsMinor,
        // CONTRACT-1 no implementa ofertas, contraofertas ni tanteo.
        notImplemented: ['negotiation', 'counterOffer', 'rightOfFirstRefusal'],
      };
    }

    toJSON() {
      return {
        id: this.id,
        playerId: this.playerId,
        clubId: this.clubId,
        contractType: this.contractType,
        signedDate: this.signedDate,
        startDate: this.startDate,
        endDate: this.endDate,
        coveredSeasonKeys: [...this.coveredSeasonKeys],
        guaranteeType: this.guaranteeType,
        probation: { ...this.probation },
        compensation: JSON.parse(JSON.stringify(this.compensation)),
        paymentPolicy: JSON.parse(JSON.stringify(this.paymentPolicy)),
        clauses: JSON.parse(JSON.stringify(this.clauses)),
        declaredDocuments: [...this.declaredDocuments],
        representation: { ...this.representation },
        minorProtections: this.minorProtections ? { ...this.minorProtections } : null,
        signingContext: this.signingContext ? { ...this.signingContext } : null,
        lifecycleEvents: this.lifecycleEvents.map((e) => ({ ...e })),
        provenance: { ...this.provenance },
      };
    }
  }

  const exportsObj = {
    Contract,
    CONTRACT_TYPES,
    CONTRACT_STATUSES,
    GUARANTEE_TYPES,
    COMPENSATION_COMPONENTS,
    CLAUSE_TYPE_DEFINITIONS,
    CLAUSE_SUPPORT_LEVELS,
    isKnownClauseType,
    validateClause,
    buildPaymentSchedule,
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
