// src/core/RegistrationRegistry.js
// REG-1 (DESIGN.md 9.18) — Registro canónico de licencias, inscripciones,
// acuerdos de vinculación y actas de la partida. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// Mismo principio que PlayerRegistry (ROSTER-1) y ContractRegistry
// (CONTRACT-1): la partida posee una instancia EXPLÍCITA
// (`state.registrationRegistry`, construida en `startSeason()`), nunca un
// singleton oculto. El registro solo guarda IDs hacia jugador/club/
// contrato — nunca clona `Player`/`Contract`.
//
// Módulo puro: no lee DOM, ni `state`, ni variables globales.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }

  function toIso(date) {
    if (!date) throw new Error('RegistrationRegistry: hace falta una fecha para resolver el estado.');
    return typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
  }

  function pushIndex(map, key, value) {
    if (key === null || key === undefined) return;
    const list = map.get(key) || [];
    list.push(value);
    map.set(key, list);
  }

  class RegistrationRegistry {
    constructor() {
      this._licenses = new Map(); // id -> FederationLicense
      this._registrations = new Map(); // id -> CompetitionRegistration
      this._linkAgreements = new Map(); // id -> ClubLinkAgreement
      this._matchActs = new Map(); // id -> MatchActSnapshot
      this._profiles = new Map(); // playerId -> PlayerRegulatoryProfile

      this._licensesByPlayer = new Map();
      this._licensesByClub = new Map();
      this._registrationsByPlayer = new Map();
      this._registrationsByClub = new Map();
      this._registrationsByScope = new Map(); // registrationScopeId -> [id]
      this._registrationsByCompetition = new Map();
      this._linkAgreementsByClub = new Map(); // clubId -> [id] (como inferior o superior)
      this._matchActsByMatch = new Map(); // matchId -> [id] (para prohibir doble acta misma jornada)
    }

    // --- Licencias ---------------------------------------------------------
    registerLicense(license) {
      if (!license || !license.id) throw new Error('RegistrationRegistry.registerLicense: falta un id válido.');
      const existing = this._licenses.get(license.id);
      if (existing && existing !== license) {
        throw new Error(`RegistrationRegistry.registerLicense: ya existe una licencia distinta con id "${license.id}".`);
      }
      if (existing === license) return license;
      this._licenses.set(license.id, license);
      pushIndex(this._licensesByPlayer, license.playerId, license.id);
      pushIndex(this._licensesByClub, license.clubId, license.id);
      return license;
    }

    getLicense(id) { return this._licenses.get(id) || null; }

    requireLicense(id) {
      const license = this.getLicense(id);
      if (!license) throw new Error(`RegistrationRegistry.requireLicense: no existe la licencia "${id}".`);
      return license;
    }

    licensesForPlayer(playerId) {
      return (this._licensesByPlayer.get(playerId) || []).map((id) => this._licenses.get(id));
    }

    // Licencia VIGENTE de un jugador en una fecha (temporada/club pueden
    // discriminar cuando exista más de una en la vida del jugador).
    currentLicenseForPlayer(playerId, date) {
      const iso = toIso(date);
      return this.licensesForPlayer(playerId).find((license) => license.isValidOn(iso)) || null;
    }

    allLicenses() { return [...this._licenses.values()]; }

    // --- Inscripciones -------------------------------------------------------
    registerRegistration(registration) {
      if (!registration || !registration.id) throw new Error('RegistrationRegistry.registerRegistration: falta un id válido.');
      const existing = this._registrations.get(registration.id);
      if (existing && existing !== registration) {
        throw new Error(`RegistrationRegistry.registerRegistration: ya existe una inscripción distinta con id "${registration.id}".`);
      }
      if (existing === registration) return registration;
      this._registrations.set(registration.id, registration);
      pushIndex(this._registrationsByPlayer, registration.playerId, registration.id);
      pushIndex(this._registrationsByClub, registration.teamId, registration.id);
      pushIndex(this._registrationsByScope, registration.registrationScopeId, registration.id);
      pushIndex(this._registrationsByCompetition, registration.competitionId, registration.id);
      return registration;
    }

    getRegistration(id) { return this._registrations.get(id) || null; }

    requireRegistration(id) {
      const registration = this.getRegistration(id);
      if (!registration) throw new Error(`RegistrationRegistry.requireRegistration: no existe la inscripción "${id}".`);
      return registration;
    }

    registrationsForPlayer(playerId) {
      return (this._registrationsByPlayer.get(playerId) || []).map((id) => this._registrations.get(id));
    }

    registrationsForClub(clubId) {
      return (this._registrationsByClub.get(clubId) || []).map((id) => this._registrations.get(id));
    }

    registrationsForScope(registrationScopeId) {
      return (this._registrationsByScope.get(registrationScopeId) || []).map((id) => this._registrations.get(id));
    }

    // Inscripción EFECTIVA de un jugador en un ámbito concreto, en una
    // fecha dada — como mucho una por ámbito+temporada (RegistrationService
    // es responsable de no crear duplicadas activas simultáneas).
    currentRegistration(playerId, registrationScopeId, seasonKey, date) {
      const iso = toIso(date);
      return this.registrationsForPlayer(playerId).find((registration) => (
        registration.registrationScopeId === registrationScopeId
        && registration.seasonKey === seasonKey
        && registration.isEffectiveOn(iso)
      )) || null;
    }

    // Inscripción de este jugador para este ámbito+temporada SEA CUAL SEA
    // su estado (activa, suspendida, desactivada, expirada) — a diferencia
    // de `currentRegistration()` (solo activas, pensada para "¿puede jugar
    // AHORA MISMO?"), esta se usa donde hace falta DIAGNOSTICAR/MOSTRAR el
    // motivo real de una no-disponibilidad (EligibilityService, pantalla de
    // Inscripciones): sin ella, un jugador suspendido era indistinguible de
    // uno nunca inscrito (`currentRegistration` lo filtraba fuera antes de
    // que nadie pudiera leer `statusOn()==='suspended'`), ambas se leían
    // como "sin inscripción en este ámbito" — bug detectado en verificación
    // de interfaz real (REG-1). `buildRegistrationId()` es determinista por
    // jugador+ámbito+temporada, así que solo puede existir UNA inscripción
    // aquí (los cambios de estado son eventos sobre la MISMA entidad, nunca
    // una entidad nueva).
    registrationForScopeSeason(playerId, registrationScopeId, seasonKey) {
      return this.registrationsForPlayer(playerId).find((registration) => (
        registration.registrationScopeId === registrationScopeId && registration.seasonKey === seasonKey
      )) || null;
    }

    // Cuenta cuántas altas de un club COMPUTAN para el máximo acumulado de
    // la temporada (sección 6.4: el resultado se CONGELA por registro en
    // `cumulativeCap.counted`, nunca se recalcula desde cero aquí).
    cumulativeCountForClub(clubId, registrationScopeId, seasonKey) {
      return this.registrationsForClub(clubId).filter((registration) => (
        registration.registrationScopeId === registrationScopeId
        && registration.seasonKey === seasonKey
        && registration.cumulativeCap.counted
      )).length;
    }

    allRegistrations() { return [...this._registrations.values()]; }

    // --- Acuerdos de vinculación --------------------------------------------
    registerLinkAgreement(agreement) {
      if (!agreement || !agreement.id) throw new Error('RegistrationRegistry.registerLinkAgreement: falta un id válido.');
      const existing = this._linkAgreements.get(agreement.id);
      if (existing && existing !== agreement) {
        throw new Error(`RegistrationRegistry.registerLinkAgreement: ya existe un acuerdo distinto con id "${agreement.id}".`);
      }
      if (existing === agreement) return agreement;
      this._linkAgreements.set(agreement.id, agreement);
      pushIndex(this._linkAgreementsByClub, agreement.lowerClubId, agreement.id);
      pushIndex(this._linkAgreementsByClub, agreement.upperClubId, agreement.id);
      return agreement;
    }

    getLinkAgreement(id) { return this._linkAgreements.get(id) || null; }

    linkAgreementsForClub(clubId) {
      return (this._linkAgreementsByClub.get(clubId) || []).map((id) => this._linkAgreements.get(id));
    }

    // Acuerdos donde `clubId` es el club BENEFICIARIO (superior) — el pool
    // elegible de un partido consulta esto para sumar vinculados.
    linkAgreementsAsBeneficiary(clubId) {
      return this.linkAgreementsForClub(clubId).filter((agreement) => agreement.upperClubId === clubId);
    }

    allLinkAgreements() { return [...this._linkAgreements.values()]; }

    // --- Actas de partido ----------------------------------------------------
    // Idempotente por `id` (sección 7.6: "regístrala de forma idempotente").
    registerMatchAct(snapshot) {
      if (!snapshot || !snapshot.id) throw new Error('RegistrationRegistry.registerMatchAct: falta un id válido.');
      const existing = this._matchActs.get(snapshot.id);
      if (existing) return existing; // idempotente: la primera instantánea gana, nunca se sobrescribe
      this._matchActs.set(snapshot.id, snapshot);
      pushIndex(this._matchActsByMatch, snapshot.matchId, snapshot.id);
      return snapshot;
    }

    getMatchAct(id) { return this._matchActs.get(id) || null; }

    matchActsForMatch(matchId) {
      return (this._matchActsByMatch.get(matchId) || []).map((id) => this._matchActs.get(id));
    }

    // ¿Ya existe un acta de ESTE club para esta jornada en este ámbito de
    // inscripción? — usado para la prohibición "un jugador no puede
    // aparecer en el acta de dos clubes ACB en la misma jornada" (se
    // consulta por jugador, ver `playerAlreadyOnActThisRound`).
    // `seasonKey` es obligatorio en la clave: el número de jornada de Liga
    // (`match.round`) y el índice de ronda de un bracket se REINICIAN cada
    // temporada — sin `seasonKey`, la jornada 1 de una temporada y la
    // jornada 1 de la siguiente colisionarían y cualquier jugador que
    // jugara la jornada 1 el año pasado aparecería "ya convocado" para
    // siempre en la jornada 1 de todas las temporadas futuras.
    playerAlreadyOnActThisRound(playerId, registrationScopeId, seasonKey, roundId, excludingMatchId) {
      return this.allMatchActs().some((act) => (
        act.registrationScopeId === registrationScopeId
        && act.seasonKey === seasonKey
        && act.roundId === roundId
        && act.matchId !== excludingMatchId
        && act.includesPlayer(playerId)
      ));
    }

    allMatchActs() { return [...this._matchActs.values()]; }

    // --- Perfiles regulatorios -----------------------------------------------
    registerProfile(profile) {
      if (!profile || !profile.playerId) throw new Error('RegistrationRegistry.registerProfile: falta "playerId".');
      this._profiles.set(profile.playerId, profile);
      return profile;
    }

    getProfile(playerId) { return this._profiles.get(playerId) || null; }

    requireProfile(playerId) {
      const profile = this.getProfile(playerId);
      if (!profile) throw new Error(`RegistrationRegistry.requireProfile: no existe perfil regulatorio para "${playerId}".`);
      return profile;
    }

    allProfiles() { return [...this._profiles.values()]; }

    // ------------------------------------------------------------------------
    // Informe de integridad — NUNCA lanza por sí solo (mismo criterio que
    // ContractRegistry/PlayerRegistry): devuelve errores/warnings estructurados.
    // ------------------------------------------------------------------------
    validateIntegrity(options) {
      const opts = options || {};
      const { playerRegistry, contractRegistry, teams, date } = opts;
      const errors = [];
      const warnings = [];
      const iso = date ? toIso(date) : null;
      const teamIds = new Set((teams || []).map((team) => team.id));

      this.allLicenses().forEach((license) => {
        if (playerRegistry && !playerRegistry.has(license.playerId)) {
          errors.push(`La licencia "${license.id}" referencia al jugador "${license.playerId}", ausente de PlayerRegistry.`);
        }
        if (teams && !teamIds.has(license.clubId)) {
          errors.push(`La licencia "${license.id}" referencia al club "${license.clubId}", ausente de los equipos vivos.`);
        }
      });

      this.allRegistrations().forEach((registration) => {
        if (playerRegistry && !playerRegistry.has(registration.playerId)) {
          errors.push(`La inscripción "${registration.id}" referencia al jugador "${registration.playerId}", ausente de PlayerRegistry.`);
        }
        if (teams && !teamIds.has(registration.teamId)) {
          errors.push(`La inscripción "${registration.id}" referencia al club "${registration.teamId}", ausente de los equipos vivos.`);
        }
        if (!this.getLicense(registration.licenseId)) {
          errors.push(`La inscripción "${registration.id}" referencia la licencia "${registration.licenseId}", inexistente.`);
        }
        // Invariante: inscripción senior activa sin contrato cuando la
        // regla lo exige (sección 8.1) — se comprueba solo para 'senior'.
        if (contractRegistry && registration.accessCategory === 'senior' && iso && registration.isEffectiveOn(iso)) {
          if (!registration.contractId || !contractRegistry.get(registration.contractId)) {
            errors.push(
              `La inscripción senior "${registration.id}" está activa a ${iso} sin contrato vigente referenciado `
              + '(una inscripción senior activa exige contrato).',
            );
          }
        }
        // BUG-REG1-07 (DESIGN.md 9.19): el contrato referenciado, cuando
        // existe, debe ser REALMENTE del jugador y club de esta inscripción
        // — comprobado para cualquier `contractId` presente (no solo
        // senior/activa), nunca "corregido" en silencio.
        if (contractRegistry && registration.contractId) {
          const contract = contractRegistry.get(registration.contractId);
          if (contract && contract.playerId !== registration.playerId) {
            errors.push(
              `La inscripción "${registration.id}" referencia el contrato "${registration.contractId}", que pertenece `
              + `al jugador "${contract.playerId}", no a "${registration.playerId}".`,
            );
          }
          if (contract && contract.clubId !== registration.teamId) {
            errors.push(
              `La inscripción "${registration.id}" referencia el contrato "${registration.contractId}", que pertenece `
              + `al club "${contract.clubId}", no a "${registration.teamId}".`,
            );
          }
        }
        // Invariante: no hay inscripción activa fuera de la vigencia de la
        // licencia asociada.
        const license = this.getLicense(registration.licenseId);
        if (license && iso && registration.isEffectiveOn(iso) && !license.isValidOn(iso)) {
          errors.push(
            `La inscripción "${registration.id}" está activa a ${iso} pero su licencia "${license.id}" `
            + 'no está vigente/activa en esa fecha.',
          );
        }
        // Ninguna clasificación simulada se presenta como verificada.
        if (registration.classificationSnapshot && registration.classificationSnapshot.provenance === 'simulated'
          && registration.classificationSnapshot.presentedAsVerified) {
          errors.push(`La inscripción "${registration.id}" presenta una clasificación simulada como verificada.`);
        }
      });

      // No hay IDs duplicados entre colecciones (por construcción del Map
      // ya es imposible dentro de cada colección; se comprueba cruce).
      const allIds = [
        ...this._licenses.keys(), ...this._registrations.keys(),
        ...this._linkAgreements.keys(), ...this._matchActs.keys(),
      ];
      const seen = new Set();
      allIds.forEach((id) => {
        if (seen.has(id)) errors.push(`ID "${id}" duplicado entre colecciones del RegistrationRegistry.`);
        seen.add(id);
      });

      // Doble acta misma jornada, mismo ámbito: ningún jugador debería
      // aparecer en dos actas del mismo ámbito+temporada+jornada a la vez
      // (misma clave que `playerAlreadyOnActThisRound` — `seasonKey`
      // incluido: la jornada 1 se reinicia cada temporada).
      const actsByScope = new Map();
      this.allMatchActs().forEach((act) => {
        const key = `${act.registrationScopeId}|${act.seasonKey}|${act.roundId}`;
        const list = actsByScope.get(key) || [];
        list.push(act);
        actsByScope.set(key, list);
      });
      actsByScope.forEach((acts) => {
        const seenPlayers = new Map();
        acts.forEach((act) => {
          act.selectedPlayers.forEach((entry) => {
            if (seenPlayers.has(entry.playerId) && seenPlayers.get(entry.playerId) !== act.matchId) {
              errors.push(
                `El jugador "${entry.playerId}" aparece en más de un acta del mismo ámbito/jornada `
                + `("${seenPlayers.get(entry.playerId)}" y "${act.matchId}").`,
              );
            }
            seenPlayers.set(entry.playerId, act.matchId);
          });
        });
      });

      return { valid: errors.length === 0, errors, warnings };
    }

    snapshot() {
      return {
        licenses: this.allLicenses().length,
        registrations: this.allRegistrations().length,
        linkAgreements: this.allLinkAgreements().length,
        matchActs: this.allMatchActs().length,
        profiles: this.allProfiles().length,
      };
    }
  }

  const exportsObj = { RegistrationRegistry };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
