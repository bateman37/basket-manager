// src/core/ClubEmploymentContextCatalog.js
// CONTRACT-1 (DESIGN.md 9.17) — Catálogo de contexto laboral. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Por qué existe (BUG-ROSTER1-02, sección 2 del prompt de CONTRACT-1): la
// ley laboral aplicable a un contrato depende del EMPLEADOR (el club y el
// país donde está domiciliado), NO de la competición en la que juega.
// **MoraBanc Andorra compite en la ACB —organizada en España— pero su
// empleador está en Andorra**: aplicarle el RD 1006/1985 o el SMI español
// por el mero hecho de competir en ACB sería un error de dominio.
//
// CLUB-CORE-1 (DESIGN.md sección 10, apartado 8.4 del prompt) — este
// archivo YA NO es una segunda tabla de 36 "clubes" indexada por ids de
// Team: la identidad, sede, jurisdicción y afiliación de cada club se
// obtienen SIEMPRE del `Club` real instalado (`team.club`, la MISMA
// instancia que vive en `state.world.registries.clubs`) y de las áreas/
// organizaciones del mundo — nunca de una tabla paralela aquí. Lo que
// permanece en este archivo son las definiciones NORMATIVAS reutilizables
// (jurisdicciones laborales, federaciones) — dato de configuración, no
// lógica ramificada:
//  - nunca infiere la jurisdicción por el nombre o la ciudad del equipo;
//  - nunca deriva la jurisdicción de `CompetitionDefinition.organizerCountry`;
//  - un Club sin `club` real enlazado, o cuya área laboral no está en
//    `JURISDICTIONS`, NO hereda España, ACB ni ningún otro perfil: se
//    detecta como error explícito (`buildEmploymentContext`/`validateCatalog`).
//
// La competición doméstica (`domesticCompetitionId`) NO se declara aquí:
// cambia con ascensos/descensos y, desde WORLD-CONTEXT-1 (DESIGN.md 10.20),
// llega SIEMPRE explícita desde el llamador — resuelta por sus
// `CompetitionEntry` reales (`CompetitionContextService`). Ya NO existe
// ningún adaptador legacy de división como fallback (WORLD-CLEANUP-1,
// DESIGN.md 10.21, retirado por completo junto con `Team.division`): un
// equipo puede competir a la vez en liga, Copa y Europa, así que su
// "división" nunca fue un dato de participación, solo una suposición.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const CompetitionContextModule = isNode ? require('./CompetitionContextService.js') : global.BasketManager;

  function CompetitionContext() {
    return (isNode ? CompetitionContextModule : global.BasketManager).CompetitionContextService;
  }

  // Jurisdicciones laborales usadas hoy (ISO 3166-1 alfa-2 del país del
  // EMPLEADOR). Añadir una liga/país nuevo es añadir entradas aquí, nunca
  // tocar Contract.js/Team.js/Club.js/game.js.
  const JURISDICTIONS = {
    ES: {
      id: 'ES',
      name: 'España',
      label: 'España (ES)',
      statutoryModuleFamilyId: 'es-sport-labour-statute',
    },
    AD: {
      id: 'AD',
      name: 'Andorra',
      label: 'Andorra (AD)',
      statutoryModuleFamilyId: 'ad-labour-statute',
    },
    // Perfil SOLO DE TEST (ver `TEST_JURISDICTION_AREA_ID` más abajo) — un
    // país/liga nuevo real se añade exactamente así: una entrada de
    // catálogo, nunca una rama nueva de código en Contract/Registration/
    // Market/Transfer/Loan ni en game.js.
    XX: {
      id: 'XX',
      name: 'Testland',
      label: '[TEST] Testland (XX)',
      statutoryModuleFamilyId: 'test-labour-statute',
    },
  };

  // Federación de afiliación deportiva del club — dato distinto de la
  // jurisdicción laboral y distinto del organizador de la competición.
  // MoraBanc está afiliado a la FEB a efectos de competición española
  // (juega la ACB) aunque su empleador esté en Andorra: son dos ejes
  // independientes, y por eso se declaran por separado.
  const FEDERATIONS = {
    'feb-general': { id: 'feb-general', name: 'Federación Española de Baloncesto', country: 'ES' },
  };

  // Traduce el `Organization.id` mundial (WORLD-CORE-1, ej. `org-feb`) al
  // módulo normativo de federación de ESTE dominio (CONTRACT-1). Dos
  // catálogos DISTINTOS a propósito (identidad mundial vs. módulo
  // normativo) — nunca colapsados en uno solo.
  const ORG_TO_FEDERATION_MODULE = { 'org-feb': 'feb-general' };

  // Traduce el `GeographicArea.id` del empleador (`club.
  // employerJurisdictionAreaId`, ej. `area-country-es`) a la jurisdicción
  // laboral ISO de este dominio. Dato de configuración de ESTE archivo
  // (CONTRACT-1/CLUB-CORE-1 siguen siendo dominio específico español, no
  // uno de los archivos mundiales genéricos auditados) — nunca se infiere
  // de otro sitio.
  const AREA_TO_JURISDICTION = { 'area-country-es': 'ES', 'area-country-ad': 'AD', 'area-test-xx': 'XX' };

  // Perfil SOLO DE TEST — demuestra que dar de alta un área/club de otro
  // país es añadir una entrada de catálogo, nunca una rama nueva de código.
  const TEST_JURISDICTION_AREA_ID = 'area-test-xx';

  function getJurisdiction(jurisdictionId) {
    return JURISDICTIONS[jurisdictionId] || null;
  }

  function jurisdictionLabel(jurisdictionId) {
    const jurisdiction = getJurisdiction(jurisdictionId);
    return jurisdiction ? jurisdiction.label : jurisdictionId;
  }

  // Resuelve la jurisdicción laboral ISO a partir del área del EMPLEADOR de
  // un Club real (`club.employerJurisdictionAreaId`) — nunca del nombre/
  // ciudad del club ni de la competición en la que juega.
  function requireJurisdictionIdForArea(areaId) {
    const jurisdictionId = AREA_TO_JURISDICTION[areaId];
    if (!jurisdictionId || !getJurisdiction(jurisdictionId)) {
      throw new Error(
        `ClubEmploymentContextCatalog: el área "${areaId}" no tiene jurisdicción laboral registrada — un área `
        + 'desconocida NO hereda España ni ningún otro perfil por defecto (declárala en AREA_TO_JURISDICTION).',
      );
    }
    return jurisdictionId;
  }

  // Resuelve el módulo normativo de federación a partir de las afiliaciones
  // REALES del Club (`club.federationMembershipOrganizationIds`) — `null`
  // si ninguna de sus afiliaciones tiene módulo normativo declarado (nunca
  // un valor por defecto).
  function resolveFederationId(club) {
    const orgId = (club.federationMembershipOrganizationIds || []).find((id) => ORG_TO_FEDERATION_MODULE[id]);
    return orgId ? ORG_TO_FEDERATION_MODULE[orgId] : null;
  }

  // Contexto laboral COMPLETO de un club en un instante concreto de la
  // partida: identidad/jurisdicción/afiliación REALES del `Club` enlazado +
  // competición doméstica vigente, que llega SIEMPRE explícita en
  // `options.domesticCompetitionId` (WORLD-CONTEXT-1).
  //
  // `team`: instancia real de Team (solo para diagnóstico y como respaldo
  // de nombre — su `division` ya no participa en ninguna resolución).
  // `club`: instancia real de Club YA enlazada (`team.club`) — CLUB-CORE-1
  // exige que exista explícita; ya no hay fallback silencioso a `team.id`
  // como clubId (ese puente era la deuda que esa entrega retiró).
  // `options.domesticCompetitionId`: OBLIGATORIO. La jurisdicción laboral
  // sigue dependiendo del CLUB empleador, nunca de esta competición
  // (MoraBanc Andorra: AD aunque compita en ACB).
  function buildEmploymentContext(team, club, options) {
    if (!club) {
      throw new Error(
        `ClubEmploymentContextCatalog.buildEmploymentContext: falta "club" para el equipo "${team ? team.id : '?'}" `
        + '— CLUB-CORE-1 exige un Club real enlazado (team.club), nunca team.id como clubId por defecto.',
      );
    }
    const opts = options || {};
    const employerJurisdictionId = requireJurisdictionIdForArea(club.employerJurisdictionAreaId);
    const federationId = resolveFederationId(club);
    const domesticCompetitionId = CompetitionContext().requireCompetitionId(opts.domesticCompetitionId, {
      operation: opts.operation || 'buildEmploymentContext',
      teamId: team ? team.id : null,
      clubId: club.id,
      seasonKey: opts.seasonKey || null,
    });
    return {
      clubId: club.id,
      clubName: club.name || (team && team.fullName) || club.id,
      employerJurisdictionId,
      federationId,
      domesticCompetitionId,
      competitionMemberships: [domesticCompetitionId],
      // Perfil DERIVADO por composición declarativa de capas (jurisdicción
      // del empleador + competición doméstica) — nunca un `if` de
      // ACB/FEB/Andorra en ContractService.
      employmentProfileId: `employment:${employerJurisdictionId}:${domesticCompetitionId}`,
    };
  }

  // Validación agregada (sección 5.2): ningún equipo vivo sin Club real
  // enlazado, ningún Club con un área laboral no registrada.
  function validateCatalog(teams) {
    const errors = [];
    (teams || []).forEach((team) => {
      if (!team.club) {
        errors.push(
          `El equipo "${team.fullName || team.id}" está vivo en la partida pero no tiene un Club real enlazado `
          + '(team.club) — CLUB-CORE-1 exige Club real, nunca team.id como clubId por defecto.',
        );
        return;
      }
      try {
        requireJurisdictionIdForArea(team.club.employerJurisdictionAreaId);
      } catch (error) {
        errors.push(error.message);
      }
    });
    return { valid: errors.length === 0, errors };
  }

  const exportsObj = {
    ClubEmploymentContextCatalog: {
      JURISDICTIONS,
      FEDERATIONS,
      ORG_TO_FEDERATION_MODULE,
      AREA_TO_JURISDICTION,
      TEST_JURISDICTION_AREA_ID,
      getJurisdiction,
      jurisdictionLabel,
      requireJurisdictionIdForArea,
      resolveFederationId,
      buildEmploymentContext,
      validateCatalog,
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
