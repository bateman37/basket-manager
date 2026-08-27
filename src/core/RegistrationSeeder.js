// src/core/RegistrationSeeder.js
// REG-1 (DESIGN.md 9.18, sección 10.2 del prompt) — bootstrap DETERMINISTA
// de licencias/inscripciones SIMULADAS. Convención del proyecto:
// identificadores en inglés, comentarios en español.
//
// HONESTIDAD DE DATOS: en `data/real/` no existe ningún dato regulatorio
// real (ciudadanía, historial formativo, licencia). Todo lo que genera
// este archivo son datos de JUEGO, marcados como tales
// (`dataSource: 'simulated-registration-v1'`, `isReal: false`) y mostrados
// con el aviso "Inscripción y clasificación simuladas para esta partida;
// no son datos federativos reales." Nunca se escribe nada en `data/real/`.
//
// DETERMINISMO: no se usa `Math.random`. Toda decisión deriva de un hash
// estable de `playerId+clubId+seasonKey+generatorVersion` (mismo mecanismo
// FNV-1a que `ContractSeeder.js`). La clasificación de cupos se decide a
// nivel de CLUB (sección 10.2: "para que el punto de partida sea
// reglamentariamente viable"), nunca por moneda al aire por jugador que
// pudiera dejar a un club sin cupo de formación cumplido.
//
// VARIABLES PROHIBIDAS: nombre/apellido para inferir país/formación,
// `potential`/`ambition`/`professionalism`, `team.reputation`, `budget`.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const RegistrationEntities = isNode ? require('../entities/Registration.js') : global.BasketManager;
  const RegistrationServiceModule = isNode ? require('./RegistrationService.js') : global.BasketManager;
  const CompetitionRules = isNode ? require('./CompetitionRules.js') : global.BasketManager;
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;

  function RegSvc() { return RegistrationServiceModule.RegistrationService; }
  function LD() { return LocalDateModule.LocalDate; }

  const SIMULATED_REGISTRATION_DATA_SOURCE = 'simulated-registration-v1';
  const GENERATOR_VERSION = 'registration-seeder-v1';
  const SIMULATED_REGISTRATION_WARNING = 'Inscripción y clasificación simuladas para esta partida; no son datos federativos reales.';

  // --- Hash determinista (FNV-1a 32 bits) — idéntico mecanismo que
  // ContractSeeder.js, reimplementado aquí para que este archivo no
  // dependa de otro seeder (evita acoplar dos EPICs por un detalle interno).
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

  function unitFrom(fingerprint, discriminator) {
    return hash32(`${fingerprint}#${discriminator}`) / 0x100000000;
  }

  const DOCUMENT_STATUSES_ALL_VERIFIED = (codes) => codes.reduce((acc, code) => { acc[code] = 'verified'; return acc; }, {});

  // ---------------------------------------------------------------------
  // Clasificación de cupos SIMULADA a nivel de CLUB (sección 10.2): decide,
  // de forma determinista y ORDENADA por `playerId` (nunca por nombre), qué
  // subconjunto de la plantilla se etiqueta de formación / no comunitario
  // — con margen suficiente para que CUALQUIER selección de convocatoria
  // (8-12) pueda cumplir el cupo real de la competición.
  // ---------------------------------------------------------------------
  function classifyRosterForClub(team, resolved, seasonKey) {
    const bands = (resolved.registration && resolved.registration.quotaBands) || [];
    const maxFormationMinimum = bands.reduce((max, band) => Math.max(max, band.formationMinimum), 0);
    const nonCommunityMax = (resolved.registration && resolved.registration.nonCommunityCap
      && resolved.registration.nonCommunityCap.max) || 0;

    // Margen de +2 sobre el cupo más exigente: cubre bajas/lesiones sin
    // dejar al club sin solución legal (sección 11.3: "el smoke no debe
    // dejar a ninguno de los 36 clubes en softlock").
    const formationTargetCount = Math.min(team.roster.length, maxFormationMinimum + 2);

    const sortedByHash = [...team.roster].sort((a, b) => {
      const ha = hash32(seedFingerprint(a.id, team.id, seasonKey) + '#formation-rank');
      const hb = hash32(seedFingerprint(b.id, team.id, seasonKey) + '#formation-rank');
      return (ha - hb) || (a.id < b.id ? -1 : 1);
    });
    const formationPlayerIds = new Set(sortedByHash.slice(0, formationTargetCount).map((p) => p.id));

    // No comunitarios: 0-nonCommunityMax jugadores por club, variado por
    // hash del CLUB (nunca más que el cupo, nunca inferido del nombre).
    const clubRoll = unitFrom(`${team.id}|${seasonKey}|${GENERATOR_VERSION}`, 'non-community-count');
    const nonCommunityCount = nonCommunityMax > 0 ? Math.floor(clubRoll * (nonCommunityMax + 1)) : 0;
    const sortedForNonCommunity = [...team.roster]
      .filter((p) => !formationPlayerIds.has(p.id))
      .sort((a, b) => {
        const ha = hash32(seedFingerprint(a.id, team.id, seasonKey) + '#non-community-rank');
        const hb = hash32(seedFingerprint(b.id, team.id, seasonKey) + '#non-community-rank');
        return (ha - hb) || (a.id < b.id ? -1 : 1);
      });
    const nonCommunityPlayerIds = new Set(sortedForNonCommunity.slice(0, nonCommunityCount).map((p) => p.id));

    return { formationPlayerIds, nonCommunityPlayerIds };
  }

  // ---------------------------------------------------------------------
  // Bootstrap de UN jugador: perfil regulatorio + licencia + inscripción
  // senior. `accessCategory` por defecto 'senior' (afiliado ordinario);
  // section 10.3 (fallback/cantera) reutiliza esta misma función.
  // ---------------------------------------------------------------------
  function seedPlayerRegistration(params) {
    const {
      player, team, seasonKey, isoDate, resolved, registrationRegistry, contractRegistry,
      classification, accessCategory, licenseClass,
    } = params;
    const fingerprint = seedFingerprint(player.id, team.id, seasonKey);
    const documentCodes = (resolved.registration && resolved.registration.documentRequirements) || [];

    const profile = new RegistrationEntities.PlayerRegulatoryProfile({
      playerId: player.id,
      organizerApprovedClassifications: [{
        id: `regclass:${fingerprint}`,
        competitionId: resolved.competitionId,
        seasonKey,
        formation: classification.formationPlayerIds.has(player.id) ? 'qualifies' : 'does-not-qualify',
        nonCommunity: classification.nonCommunityPlayerIds.has(player.id) ? 'counts' : 'does-not-count',
        basis: 'simulated-snapshot',
      }],
      provenance: 'simulated',
      dataSource: SIMULATED_REGISTRATION_DATA_SOURCE,
    });
    registrationRegistry.registerProfile(profile);

    const license = RegSvc().issueLicense({
      registry: registrationRegistry,
      playerId: player.id,
      clubId: team.id,
      federationId: 'feb-general',
      seasonKey,
      licenseClass: licenseClass || 'professional-senior',
      validity: LD().seasonWindow(seasonKey),
      documentStatuses: DOCUMENT_STATUSES_ALL_VERIFIED(documentCodes),
      date: isoDate,
      provenance: {
        dataSource: SIMULATED_REGISTRATION_DATA_SOURCE, isReal: false, generatorVersion: GENERATOR_VERSION, seedFingerprint: fingerprint,
      },
    });

    const contract = contractRegistry ? contractRegistry.currentForPlayer(player.id, isoDate) : null;
    const finalAccessCategory = accessCategory || 'senior';
    // Cupo acumulado (sección 6.4/9.17 CONTRACT-1): comprobado ANTES de
    // llamar a `createRegistration()` (que SIGUE rechazando con excepción
    // dura a cualquier llamador que no compruebe antes — API estricta) para
    // que el seeder, que es de mejor esfuerzo y nunca debe tirar la partida
    // abajo, pueda DEGRADAR con gracia: sin hueco de inscripción esta
    // temporada (típicamente un club con varias altas de cantera seguidas y
    // sin ningún sistema de baja/retirada todavía — HARDEN-1/roster
    // lifecycle, fuera de alcance de REG-1), el jugador SÍ recibe perfil y
    // licencia (puede entrenar/estar bajo contrato) pero se difiere su
    // inscripción de competición — nunca se inventa un cupo mayor ni se
    // fuerza una inscripción que no computa cuando la regla real exige que
    // compute.
    const impact = RegSvc().determineCumulativeCapImpact(finalAccessCategory, resolved);
    const cap = resolved.registration && resolved.registration.cumulativeRegistrationCap;
    const capFull = impact.counted && cap
      && registrationRegistry.cumulativeCountForClub(team.id, resolved.registrationScopeId, seasonKey) >= cap.max;
    if (capFull) {
      return {
        license, registration: null, profile,
        warning: `Sin hueco de inscripción para "${player.id}" en "${team.id}" (cupo acumulado ${cap.max} agotado en `
          + `"${resolved.registrationScopeId}"/${seasonKey}) — licencia emitida, inscripción de competición diferida.`,
      };
    }
    const registration = RegSvc().createRegistration({
      registry: registrationRegistry,
      playerId: player.id,
      licenseId: license.id,
      teamId: team.id,
      competitionId: resolved.competitionId,
      registrationScopeId: resolved.registrationScopeId,
      seasonKey,
      accessCategory: finalAccessCategory,
      contractId: contract ? contract.id : null,
      contractRegistry,
      classificationSnapshot: {
        formation: classification.formationPlayerIds.has(player.id) ? 'qualifies' : 'does-not-qualify',
        nonCommunity: classification.nonCommunityPlayerIds.has(player.id) ? 'counts' : 'does-not-count',
        basis: 'simulated-snapshot',
        provenance: 'simulated',
      },
      date: isoDate,
      resolved,
      provenance: {
        dataSource: SIMULATED_REGISTRATION_DATA_SOURCE, isReal: false, generatorVersion: GENERATOR_VERSION, seedFingerprint: fingerprint,
      },
    });

    return { license, registration, profile };
  }

  // ---------------------------------------------------------------------
  // API pública: bootstrap de TODOS los jugadores afiliados de una lista
  // de equipos (sección 10.4, paso 6 del orden de inicialización).
  // ---------------------------------------------------------------------
  function seedRegistrationsForTeams(params) {
    const {
      teams, seasonKey, date, registrationRegistry, contractRegistry, config,
    } = params;
    const isoDate = typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
    const warnings = [];
    const results = [];

    teams.forEach((team) => {
      const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
      const resolved = RegSvc().resolveRegistrationRules({
        competitionId, seasonKey, date: isoDate, phaseId: 'league', operation: 'bootstrap',
      });
      warnings.push(...(resolved.warnings || []).map((w) => `[${team.id}] ${w}`));
      const classification = classifyRosterForClub(team, resolved, seasonKey);

      team.roster.forEach((player) => {
        const { license, registration, warning } = seedPlayerRegistration({
          player, team, seasonKey, isoDate, resolved, registrationRegistry, contractRegistry, classification,
          accessCategory: 'senior', licenseClass: 'professional-senior', config,
        });
        if (warning) warnings.push(warning);
        results.push({ playerId: player.id, licenseId: license.id, registrationId: registration ? registration.id : null });
      });
    });

    return { results, warnings };
  }

  // Jugador que se incorpora con la partida ya en marcha (cantera, relleno
  // ficticio de plantilla nuevo) — sección 10.3: "reciben perfil, contrato
  // ya existente y alta regulatoria mediante servicios, nunca por estar en
  // el array". Se ejecuta DESPUÉS de que `ContractService` ya haya creado
  // su contrato (CONTRACT-1 sigue creando el contrato; REG-1 va después).
  function seedRegistrationForNewPlayer(params) {
    const {
      player, team, seasonKey, date, registrationRegistry, contractRegistry, config, existingClassification,
    } = params;
    const isoDate = typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
    const competitionId = CompetitionRules.competitionIdFromLegacyDivision(team.division);
    const resolved = RegSvc().resolveRegistrationRules({
      competitionId, seasonKey, date: isoDate, phaseId: 'league', operation: 'bootstrap',
    });
    // Un newgen NO se convierte automáticamente en jugador de formación
    // senior por nacer en la cantera (sección 10.3) — sin clasificación
    // explícita heredada, se le asigna la MISMA lógica de club (nunca
    // favorable por defecto: se reevalúa dentro de `classifyRosterForClub`
    // del club actual si no se pasa una ya calculada).
    const classification = existingClassification || classifyRosterForClub(team, resolved, seasonKey);
    return seedPlayerRegistration({
      player, team, seasonKey, isoDate, resolved, registrationRegistry, contractRegistry, classification,
      accessCategory: params.accessCategory || 'senior', licenseClass: params.licenseClass || 'professional-senior', config,
    });
  }

  // ---------------------------------------------------------------------
  // Fixtures DIRIGIDOS (sección 14.2 del prompt: "al menos un fixture
  // dirigido de jugador propio y uno vinculado") — NO se ejecutan para los
  // 36 clubes, solo cuando el smoke/test los invoca explícitamente sobre
  // un par de clubes concreto.
  // ---------------------------------------------------------------------
  function seedOwnLowerCategoryFixture(params) {
    const {
      player, team, seasonKey, date, registrationRegistry, resolved,
    } = params;
    const isoDate = typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
    const fingerprint = seedFingerprint(player.id, team.id, seasonKey);
    const license = RegSvc().issueLicense({
      registry: registrationRegistry,
      playerId: player.id,
      clubId: team.id,
      federationId: 'feb-general',
      seasonKey,
      licenseClass: 'own-lower-category',
      validity: LD().seasonWindow(seasonKey),
      documentStatuses: DOCUMENT_STATUSES_ALL_VERIFIED((resolved.registration && resolved.registration.documentRequirements) || []),
      date: isoDate,
      provenance: {
        dataSource: SIMULATED_REGISTRATION_DATA_SOURCE, isReal: false, generatorVersion: GENERATOR_VERSION, seedFingerprint: fingerprint,
      },
    });
    const registration = RegSvc().createRegistration({
      registry: registrationRegistry,
      playerId: player.id,
      licenseId: license.id,
      teamId: team.id,
      competitionId: resolved.competitionId,
      registrationScopeId: resolved.registrationScopeId,
      seasonKey,
      accessCategory: 'own-lower-category',
      contractId: null,
      classificationSnapshot: null,
      date: isoDate,
      resolved,
      provenance: {
        dataSource: SIMULATED_REGISTRATION_DATA_SOURCE, isReal: false, generatorVersion: GENERATOR_VERSION, seedFingerprint: fingerprint,
      },
    });
    return { license, registration };
  }

  function seedLinkedPlayerFixture(params) {
    const {
      player, lowerClub, upperClub, seasonKey, date, registrationRegistry, resolved, direction,
    } = params;
    const isoDate = typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
    const dir = direction || 'lowerToUpper';
    const linkRules = resolved.registration && resolved.registration.linkedPlayerRules;
    const agreementId = `link:${lowerClub.id}:${upperClub.id}:${seasonKey}`;
    let agreement = registrationRegistry.getLinkAgreement(agreementId);
    if (!agreement) {
      agreement = RegSvc().createLinkAgreement({
        registry: registrationRegistry,
        id: agreementId,
        lowerClubId: lowerClub.id,
        upperClubId: upperClub.id,
        competitionId: resolved.competitionId,
        federationId: 'feb-general',
        seasonKey,
        formalizedDate: isoDate,
        limits: {
          lowerToUpper: (linkRules && linkRules.maxLinkedSeniorSubU22FromLowerClub) || 0,
          upperToLower: (linkRules && linkRules.maxLinkedJuniorOrCadeteFromUpperClub) || 0,
        },
        modifiable: {
          lowerToUpper: Boolean(linkRules && linkRules.allowsWindowUpdateOverlay),
          upperToLower: false,
        },
        windowUpdateOverlay: linkRules && linkRules.allowsWindowUpdateOverlay ? 'acb-eligible-list-window' : null,
        ageCategoryConstraint: linkRules ? linkRules.ageCategory : null,
        citizenshipRequirement: linkRules ? linkRules.citizenshipRequirement : null,
        provenance: { dataSource: SIMULATED_REGISTRATION_DATA_SOURCE, isReal: false },
      });
    }
    RegSvc().addPlayerToLinkAgreement(agreement, dir, player.id, { allowWindowOverlay: true });

    // El vinculado conserva su afiliación/contrato originales (con el club
    // ORIGEN, no el beneficiario) — su inscripción de partido en el club
    // beneficiario se registra con `accessCategory: 'linked'` SIN mover
    // `player.teamId` (sección 5.4: "no se añade permanentemente a
    // Team.roster del club beneficiario").
    const beneficiaryClub = dir === 'lowerToUpper' ? upperClub : lowerClub;
    const fingerprint = seedFingerprint(player.id, beneficiaryClub.id, seasonKey);
    const license = registrationRegistry.currentLicenseForPlayer(player.id, isoDate)
      || RegSvc().issueLicense({
        registry: registrationRegistry,
        playerId: player.id,
        clubId: player.teamId,
        federationId: 'feb-general',
        seasonKey,
        licenseClass: 'linked-player',
        validity: LD().seasonWindow(seasonKey),
        documentStatuses: DOCUMENT_STATUSES_ALL_VERIFIED((resolved.registration && resolved.registration.documentRequirements) || []),
        date: isoDate,
        provenance: {
          dataSource: SIMULATED_REGISTRATION_DATA_SOURCE, isReal: false, generatorVersion: GENERATOR_VERSION, seedFingerprint: fingerprint,
        },
      });
    const registration = RegSvc().createRegistration({
      registry: registrationRegistry,
      playerId: player.id,
      licenseId: license.id,
      teamId: beneficiaryClub.id,
      competitionId: resolved.competitionId,
      registrationScopeId: resolved.registrationScopeId,
      seasonKey,
      accessCategory: 'linked',
      contractId: null,
      classificationSnapshot: null,
      date: isoDate,
      resolved,
      provenance: {
        dataSource: SIMULATED_REGISTRATION_DATA_SOURCE, isReal: false, generatorVersion: GENERATOR_VERSION, seedFingerprint: fingerprint,
      },
    });
    return { agreement, license, registration };
  }

  const exportsObj = {
    RegistrationSeeder: {
      SIMULATED_REGISTRATION_DATA_SOURCE,
      GENERATOR_VERSION,
      SIMULATED_REGISTRATION_WARNING,
      hash32,
      seedFingerprint,
      unitFrom,
      classifyRosterForClub,
      seedPlayerRegistration,
      seedRegistrationsForTeams,
      seedRegistrationForNewPlayer,
      seedOwnLowerCategoryFixture,
      seedLinkedPlayerFixture,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
