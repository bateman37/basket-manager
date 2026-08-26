// src/utils/Money.js
// CONTRACT-1 (DESIGN.md 9.17) — Modelo de dinero del juego: SIEMPRE entero
// en la unidad mínima de la moneda (`amountMinor`) + código ISO 4217.
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Reglas no negociables (sección 6.4 del prompt de CONTRACT-1):
//  - nunca se almacena un importe como float de euros (0.1 + 0.2 !== 0.3);
//  - EUR usa céntimos (exponente 2);
//  - toda cantidad declara su base: 'gross' | 'net' | 'estimated-gross';
//  - sumar/prorratear detecta monedas incompatibles en vez de mezclarlas;
//  - los totales son DERIVADOS, nunca un campo editable duplicado;
//  - al repartir un total entre cuotas, el resto de céntimos se asigna de
//    forma determinista para que la suma sea EXACTA;
//  - `Intl.NumberFormat` se usa SOLO en presentación (`format()`), nunca
//    para calcular ni para persistir.
//
// Módulo puro: no conoce Contract, ni el DOM, ni `state`.

(function (global) {
  // Exponente decimal por moneda (ISO 4217). Solo se declaran las monedas
  // que el juego usa de verdad — una moneda desconocida lanza en vez de
  // asumir 2 decimales por defecto (mismo criterio que CompetitionRules
  // con una competición desconocida: nunca un fallback silencioso).
  const CURRENCY_EXPONENTS = {
    EUR: 2,
    // Declaradas para fixtures de test de "monedas incompatibles" —
    // ninguna liga activa las usa todavía.
    GBP: 2,
    USD: 2,
  };

  const AMOUNT_BASES = ['gross', 'net', 'estimated-gross'];

  function isSupportedCurrency(currency) {
    return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, currency);
  }

  function requireCurrency(currency) {
    if (!isSupportedCurrency(currency)) {
      throw new Error(`Money: moneda ISO 4217 no soportada "${currency}" — regístrala en CURRENCY_EXPONENTS antes de usarla.`);
    }
    return currency;
  }

  function requireBasis(basis) {
    if (!AMOUNT_BASES.includes(basis)) {
      throw new Error(`Money: base de importe inválida "${basis}" — debe ser una de ${AMOUNT_BASES.join(', ')}.`);
    }
    return basis;
  }

  // Un importe válido es un ENTERO seguro no negativo. Rechaza floats
  // (1234.5), NaN, Infinity, strings numéricas y negativos — el dominio
  // Contract no tiene todavía ningún concepto de importe negativo (una
  // deducción futura se modelará como su propio componente, no como un
  // salario en negativo).
  function isValidAmountMinor(amountMinor) {
    return Number.isInteger(amountMinor) && Number.isSafeInteger(amountMinor) && amountMinor >= 0;
  }

  function requireAmountMinor(amountMinor, label) {
    if (!isValidAmountMinor(amountMinor)) {
      throw new Error(
        `Money: "${label || 'importe'}" debe ser un entero no negativo en unidad mínima `
        + `(céntimos para EUR) — recibido ${JSON.stringify(amountMinor)}.`,
      );
    }
    return amountMinor;
  }

  function of(amountMinor, currency, basis) {
    requireAmountMinor(amountMinor, 'amountMinor');
    requireCurrency(currency);
    if (basis !== undefined && basis !== null) requireBasis(basis);
    return { amountMinor, currency, basis: basis || null };
  }

  function requireSameCurrency(amounts, label) {
    const currencies = [...new Set(amounts.map((a) => a.currency))];
    if (currencies.length > 1) {
      throw new Error(
        `Money: no se pueden combinar importes de monedas distintas (${currencies.join(', ')})`
        + `${label ? ` en "${label}"` : ''}.`,
      );
    }
    return currencies[0];
  }

  // Suma de objetos `{ amountMinor, currency }`. Devuelve `null` para una
  // lista vacía (no existe "0 sin moneda": quien llama decide la moneda).
  function sum(amounts, label) {
    const list = (amounts || []).filter((a) => a && a.amountMinor !== undefined);
    if (!list.length) return null;
    const currency = requireSameCurrency(list, label);
    const total = list.reduce((acc, a) => acc + requireAmountMinor(a.amountMinor, label), 0);
    return { amountMinor: total, currency };
  }

  // Suma de enteros ya conocidos como de la MISMA moneda (uso interno del
  // desglose de una temporada, donde `compensation.currency` es única).
  function sumMinor(values, label) {
    return (values || []).reduce((acc, value) => acc + requireAmountMinor(value, label), 0);
  }

  // Reparto DETERMINISTA de un total entre `parts` cuotas, en unidad
  // mínima y sin perder ni inventar un céntimo: base = floor(total/parts),
  // y el resto se asigna de uno en uno a las PRIMERAS cuotas (criterio
  // fijo, nunca aleatorio ni dependiente del orden de iteración de un
  // objeto). La suma del resultado es SIEMPRE exactamente `totalMinor`.
  function allocate(totalMinor, parts) {
    requireAmountMinor(totalMinor, 'totalMinor');
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new Error(`Money.allocate: "parts" debe ser un entero positivo (recibido ${JSON.stringify(parts)}).`);
    }
    const base = Math.floor(totalMinor / parts);
    let remainder = totalMinor - (base * parts);
    const result = [];
    for (let i = 0; i < parts; i += 1) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      result.push(base + extra);
    }
    return result;
  }

  // Reparto proporcional a pesos adimensionales, con resto determinista
  // (mayor resto fraccionario primero; empates por índice ascendente).
  // Los pesos pueden ser decimales — el RESULTADO nunca lo es.
  function allocateByWeights(totalMinor, weights) {
    requireAmountMinor(totalMinor, 'totalMinor');
    const list = (weights || []).map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
    if (!list.length) return [];
    const weightSum = list.reduce((acc, w) => acc + w, 0);
    if (weightSum <= 0) return allocate(totalMinor, list.length);
    const exact = list.map((w) => (totalMinor * w) / weightSum);
    const floors = exact.map((value) => Math.floor(value));
    let remainder = totalMinor - floors.reduce((acc, v) => acc + v, 0);
    const order = exact
      .map((value, index) => ({ index, frac: value - Math.floor(value) }))
      .sort((a, b) => (b.frac - a.frac) || (a.index - b.index));
    for (let i = 0; i < order.length && remainder > 0; i += 1) {
      floors[order[i].index] += 1;
      remainder -= 1;
    }
    return floors;
  }

  // Redondeo a un múltiplo de unidad mínima (p. ej. 100000 céntimos =
  // 1.000 EUR) — `mode`: 'nearest' | 'floor' | 'ceil'. Determinista y sin
  // floats: opera sobre enteros.
  function roundToMultiple(amountMinor, multiple, mode) {
    requireAmountMinor(amountMinor, 'amountMinor');
    if (!Number.isInteger(multiple) || multiple <= 0) {
      throw new Error(`Money.roundToMultiple: "multiple" debe ser un entero positivo (recibido ${JSON.stringify(multiple)}).`);
    }
    const quotient = Math.floor(amountMinor / multiple);
    const rest = amountMinor - (quotient * multiple);
    if (rest === 0) return amountMinor;
    if (mode === 'floor') return quotient * multiple;
    if (mode === 'ceil') return (quotient + 1) * multiple;
    return rest * 2 >= multiple ? (quotient + 1) * multiple : quotient * multiple;
  }

  function fromMajorUnits(majorAmount, currency) {
    requireCurrency(currency);
    const factor = 10 ** CURRENCY_EXPONENTS[currency];
    const minor = Math.round(majorAmount * factor);
    return requireAmountMinor(minor, 'fromMajorUnits');
  }

  function toMajorUnits(amountMinor, currency) {
    requireAmountMinor(amountMinor, 'amountMinor');
    requireCurrency(currency);
    return amountMinor / (10 ** CURRENCY_EXPONENTS[currency]);
  }

  // SOLO presentación (sección 6.4). Nunca se usa el resultado para
  // calcular ni se guarda en ninguna entidad.
  function format(amountMinor, currency, options) {
    requireCurrency(currency);
    const opts = options || {};
    const value = toMajorUnits(amountMinor, currency);
    const formatter = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      minimumFractionDigits: opts.compact ? 0 : CURRENCY_EXPONENTS[currency],
      maximumFractionDigits: opts.compact ? 0 : CURRENCY_EXPONENTS[currency],
    });
    return formatter.format(value);
  }

  const exportsObj = {
    Money: {
      CURRENCY_EXPONENTS,
      AMOUNT_BASES,
      isSupportedCurrency,
      requireCurrency,
      requireBasis,
      isValidAmountMinor,
      requireAmountMinor,
      of,
      requireSameCurrency,
      sum,
      sumMinor,
      allocate,
      allocateByWeights,
      roundToMultiple,
      fromMajorUnits,
      toMajorUnits,
      format,
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
