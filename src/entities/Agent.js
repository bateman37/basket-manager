// src/entities/Agent.js
// MARKET-1 (DESIGN.md 9.19, sección 8.1/8.2 del prompt) — Entidades de
// representación: `Agent` (persona, nunca una agencia abstracta) y
// `RepresentationMandate` (contrato escrito entre agente y cliente).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Este archivo SOLO define forma/validación ESTRUCTURAL y estado
// DERIVADO de fechas/eventos — nunca aplica los límites normativos FIBA
// (mandato máximo 2 años, preaviso 30 días, comisión máxima 10%...): esos
// se validan en MarketService contra `CompetitionRules.resolveMarketRules()`
// (`resolved.market.agentPrinciples`), igual criterio que
// `ContractService.validateContractAgainstRules()` frente a `Contract.js`
// — el número "10%"/"2 años" vive en el módulo de reglas, nunca
// hardcodeado aquí.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function toIso(date) {
    if (!date) throw new Error('Agent/RepresentationMandate: hace falta una fecha.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  const CREDENTIAL_TYPES = ['fiba-agent-license', 'domestic-agent-registration', 'legal-bar-membership'];

  // Credencial individual — nunca un booleano "habilitado" eterno: el
  // estado se DERIVA de vigencia civil + revocación explícita.
  function normalizeCredential(data) {
    if (!data || !data.issuer) throw new Error('Agent: cada credencial exige "issuer".');
    if (!CREDENTIAL_TYPES.includes(data.type)) {
      throw new Error(`Agent: tipo de credencial desconocido "${data.type}" — admitidos: ${CREDENTIAL_TYPES.join(', ')}.`);
    }
    return {
      issuer: data.issuer,
      type: data.type,
      // Identificador SIMULADO o null — nunca un número real de agente
      // FIBA sin datos licenciados/verificables (sección 8.1 del prompt).
      identifier: data.identifier || null,
      validity: {
        startDate: data.validity && data.validity.startDate ? toIso(data.validity.startDate) : null,
        endDate: data.validity && data.validity.endDate ? toIso(data.validity.endDate) : null,
      },
      revokedDate: data.revokedDate ? toIso(data.revokedDate) : null,
      sourceRefs: [...(data.sourceRefs || [])],
    };
  }

  function credentialStatusOn(credential, date) {
    const iso = toIso(date);
    if (credential.revokedDate && LD().compare(iso, credential.revokedDate) >= 0) return 'revoked';
    if (credential.validity.startDate && LD().isBefore(iso, credential.validity.startDate)) return 'pending';
    if (credential.validity.endDate && LD().isAfter(iso, credential.validity.endDate)) return 'expired';
    return 'active';
  }

  class Agent {
    constructor(data = {}) {
      if (!data.id) throw new Error('Agent: falta "id".');
      if (!data.displayName) throw new Error('Agent: falta "displayName".');
      this.id = data.id;
      this.displayName = data.displayName;
      // Presentación únicamente (sección 8.1) — nunca sustituye a la
      // identidad de la PERSONA, que sigue siendo `id`/`displayName`.
      this.agencyName = data.agencyName || null;
      this.credentials = (data.credentials || []).map(normalizeCredential);
      // Simulado, nunca una prohibición jurídica real (sección 8.1).
      this.operatingRegions = [...(data.operatingRegions || [])];
      this.languages = [...(data.languages || [])];
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
        generatorVersion: data.provenance ? data.provenance.generatorVersion : null,
        seedFingerprint: data.provenance ? data.provenance.seedFingerprint : null,
      };
    }

    credentialsOfType(type) {
      return this.credentials.filter((c) => c.type === type);
    }

    // ¿Tiene AL MENOS una credencial de este tipo activa en la fecha dada?
    hasActiveCredentialOn(type, date) {
      return this.credentialsOfType(type).some((c) => credentialStatusOn(c, date) === 'active');
    }

    credentialStatusOn(type, date) {
      const matches = this.credentialsOfType(type);
      if (!matches.length) return 'none';
      // Si hay varias credenciales del mismo tipo (histórico), se informa
      // del estado de la más favorable — nunca se ocultan las demás.
      const statuses = matches.map((c) => credentialStatusOn(c, date));
      if (statuses.includes('active')) return 'active';
      if (statuses.includes('pending')) return 'pending';
      if (statuses.includes('expired')) return 'expired';
      return 'revoked';
    }

    toJSON() {
      return {
        id: this.id,
        displayName: this.displayName,
        agencyName: this.agencyName,
        credentials: this.credentials,
        operatingRegions: this.operatingRegions,
        languages: this.languages,
        provenance: this.provenance,
      };
    }
  }

  const MANDATE_CLIENT_TYPES = ['player', 'club'];
  const MANDATE_SCOPES = ['employment', 'transfer', 'region-or-competition'];

  class RepresentationMandate {
    constructor(data = {}) {
      ['id', 'agentId', 'clientType', 'clientId', 'startDate', 'feePayerClientId'].forEach((field) => {
        if (!data[field]) throw new Error(`RepresentationMandate: falta "${field}".`);
      });
      if (!MANDATE_CLIENT_TYPES.includes(data.clientType)) {
        throw new Error(`RepresentationMandate: clientType desconocido "${data.clientType}".`);
      }
      const scope = data.scope || 'employment';
      if (!MANDATE_SCOPES.includes(scope)) {
        throw new Error(`RepresentationMandate: scope desconocido "${scope}".`);
      }
      // Estructural (comisión debe ser un entero de basis points no
      // negativo) — el TOPE del 10% (1000bp) es una regla FIBA resuelta,
      // no una constante de esta clase.
      if (!Number.isInteger(data.commissionBasisPoints) || data.commissionBasisPoints < 0) {
        throw new Error('RepresentationMandate: "commissionBasisPoints" debe ser un entero >= 0 (basis points).');
      }
      this.id = data.id;
      this.agentId = data.agentId;
      this.clientType = data.clientType;
      this.clientId = data.clientId;
      this.scope = scope;
      // Sección 8.2: región/competición del ámbito, solo cuando
      // scope === 'region-or-competition'.
      this.scopeCompetitionIds = scope === 'region-or-competition' ? [...(data.scopeCompetitionIds || [])] : [];
      this.exclusive = Boolean(data.exclusive);
      this.startDate = toIso(data.startDate);
      this.endDate = data.endDate ? toIso(data.endDate) : null;
      if (this.endDate && LD().isBefore(this.endDate, this.startDate)) {
        throw new Error('RepresentationMandate: "endDate" no puede ser anterior a "startDate".');
      }
      this.commissionBasisPoints = data.commissionBasisPoints;
      this.feePayerClientId = data.feePayerClientId;
      // Sección 8.2: exige un Agent Contract ESCRITO — declarado, nunca
      // presumido por defecto.
      this.writtenContractDeclared = Boolean(data.writtenContractDeclared);
      // Eventos simples (no requieren la máquina de estados completa de
      // ThreadEvents/OfferEvents: un mandato solo tiene dos transiciones
      // reales — preaviso de terminación y terminación efectiva).
      this.lifecycleEvents = [...(data.lifecycleEvents || [])];
      // Congela el snapshot de reglas FIBA vigentes AL FIRMAR (sección 9.1
      // del prompt: "cada negociación y caso de derecho congela su
      // bundleId, módulos y versiones al abrirse") — nunca se recalcula
      // retroactivamente si las reglas cambian.
      this.rulesSnapshot = data.rulesSnapshot ? { ...data.rulesSnapshot } : null;
      this.provenance = {
        dataSource: data.provenance ? data.provenance.dataSource : null,
        isReal: data.provenance ? Boolean(data.provenance.isReal) : false,
        generatorVersion: data.provenance ? data.provenance.generatorVersion : null,
        seedFingerprint: data.provenance ? data.provenance.seedFingerprint : null,
      };
    }

    addLifecycleEvent(event) {
      if (!event || !event.type || !event.date) {
        throw new Error('RepresentationMandate: evento de ciclo de vida inválido (exige type y date).');
      }
      this.lifecycleEvents.push({ ...event, date: toIso(event.date) });
      return this;
    }

    // Preaviso de terminación declarado — usado por MarketService para
    // comprobar los 30 días naturales exigidos por FIBA antes de que la
    // terminación efectiva sea válida.
    terminationNoticeGivenOn() {
      const notice = this.lifecycleEvents.find((e) => e.type === 'termination-notice-given');
      return notice ? notice.date : null;
    }

    terminatedOn() {
      const terminated = this.lifecycleEvents.find((e) => e.type === 'terminated');
      return terminated ? terminated.date : null;
    }

    statusOn(date) {
      const iso = toIso(date);
      const terminated = this.terminatedOn();
      if (terminated && LD().compare(iso, terminated) >= 0) return 'terminated';
      if (LD().isBefore(iso, this.startDate)) return 'pending';
      if (this.endDate && LD().isAfter(iso, this.endDate)) return 'expired';
      return 'active';
    }

    isActiveOn(date) {
      return this.statusOn(date) === 'active';
    }

    // Duración total del mandato, en años civiles inclusivos — usada por
    // MarketService para comparar contra el máximo FIBA resuelto (2 años).
    get termYears() {
      if (!this.endDate) return null;
      return LD().inclusiveTermYears(this.startDate, this.endDate);
    }

    toJSON() {
      return {
        id: this.id,
        agentId: this.agentId,
        clientType: this.clientType,
        clientId: this.clientId,
        scope: this.scope,
        scopeCompetitionIds: this.scopeCompetitionIds,
        exclusive: this.exclusive,
        startDate: this.startDate,
        endDate: this.endDate,
        commissionBasisPoints: this.commissionBasisPoints,
        feePayerClientId: this.feePayerClientId,
        writtenContractDeclared: this.writtenContractDeclared,
        lifecycleEvents: this.lifecycleEvents,
        rulesSnapshot: this.rulesSnapshot,
        provenance: this.provenance,
      };
    }
  }

  const exportsObj = {
    Agent, RepresentationMandate, CREDENTIAL_TYPES, MANDATE_CLIENT_TYPES, MANDATE_SCOPES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
