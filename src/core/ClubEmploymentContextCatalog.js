// src/core/ClubEmploymentContextCatalog.js
// CONTRACT-1 (DESIGN.md 9.17) — Catálogo EXPLÍCITO de contexto laboral por
// club. Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Por qué existe (BUG-ROSTER1-02, sección 2 del prompt de CONTRACT-1): la
// ley laboral aplicable a un contrato depende del EMPLEADOR (el club y el
// país donde está domiciliado), NO de la competición en la que juega.
// **MoraBanc Andorra compite en la ACB —organizada en España— pero su
// empleador está en Andorra**: aplicarle el RD 1006/1985 o el SMI español
// por el mero hecho de competir en ACB sería un error de dominio.
//
// Este archivo es DATO DE CONFIGURACIÓN, no lógica ramificada:
//  - nunca infiere la jurisdicción por el nombre o la ciudad del equipo;
//  - nunca deriva la jurisdicción de `CompetitionDefinition.organizerCountry`;
//  - un club desconocido NO hereda España, ACB ni ningún otro perfil: se
//    detecta como error explícito (`validateCatalog`/`requireContext`).
//
// La competición doméstica (`domesticCompetitionId`) NO se declara aquí:
// cambia con ascensos/descensos y se obtiene en cada momento del ÚNICO
// adaptador de frontera existente (`competitionIdFromLegacyDivision`), ver
// `buildEmploymentContext()`.

(function (global) {
  const CompetitionRules = (typeof module !== 'undefined' && module.exports)
    ? require('./CompetitionRules.js')
    : global.BasketManager;

  // Jurisdicciones laborales usadas hoy (ISO 3166-1 alfa-2 del país del
  // EMPLEADOR). Añadir una liga/país nuevo es añadir entradas aquí, nunca
  // tocar Contract.js/Team.js/game.js.
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
  };

  // Federación de afiliación deportiva del club — dato distinto de la
  // jurisdicción laboral y distinto del organizador de la competición.
  // MoraBanc está afiliado a la FEB a efectos de competición española
  // (juega la ACB) aunque su empleador esté en Andorra: son dos ejes
  // independientes, y por eso se declaran por separado.
  const FEDERATIONS = {
    'feb-general': { id: 'feb-general', name: 'Federación Española de Baloncesto', country: 'ES' },
  };

  // --- Los 36 clubes reales actuales -------------------------------------
  // 35 con empleador domiciliado en España (ES) + MoraBanc Andorra (AD).
  // `legalEntityCity` documenta la sede del empleador (por qué se declara
  // esa jurisdicción), nunca se usa como fuente de la regla.
  const ES_CLUBS = [
    ['team-asisa-joventut', 'Badalona'],
    ['team-barca', 'Barcelona'],
    ['team-casademont-zaragoza', 'Zaragoza'],
    ['team-fiatc-girona', 'Girona'],
    ['team-ilerna-lleida', 'Lleida'],
    ['team-kids-and-us-manresa', 'Manresa'],
    ['team-kosner-baskonia', 'Vitoria-Gasteiz'],
    ['team-la-laguna-tenerife', 'San Cristóbal de La Laguna'],
    ['team-leyma-coruna', 'A Coruña'],
    ['team-monbus-obradoiro', 'Santiago de Compostela'],
    ['team-real-madrid', 'Madrid'],
    ['team-recoletas-salud-san-pablo-burgos', 'Burgos'],
    ['team-rio-breogan', 'Lugo'],
    ['team-surne-bilbao-basket', 'Bilbao'],
    ['team-ucam-murcia', 'Murcia'],
    ['team-unicaja', 'Málaga'],
    ['team-valencia-basket', 'Valencia'],
    ['team-alimerka-oviedo', 'Oviedo'],
    ['team-grupo-alega-cantabria', 'Santander'],
    ['team-bueno-arenas-albacete', 'Albacete'],
    ['team-grupo-ureta-tizona-burgos', 'Burgos'],
    ['team-caja-rural-cb-zamora', 'Zamora'],
    ['team-basquet-menorca', 'Maó'],
    ['team-cajasol-coto-cordoba', 'Córdoba'],
    ['team-insolac-caja87', 'Huelva'],
    ['team-club-ourense-baloncesto', 'Ourense'],
    ['team-inveready-askatuak-gipuzkoa', 'San Sebastián'],
    ['team-coviran-granada', 'Granada'],
    ['team-hla-alicante', 'Alicante'],
    ['team-fibwi-mallorca-basquet-palma', 'Palma'],
    ['team-movistar-estudiantes', 'Madrid'],
    ['team-flexicar-fuenlabrada', 'Fuenlabrada'],
    ['team-palmer-basket-mallorca-palma', 'Palma'],
    ['team-gran-canaria', 'Las Palmas de Gran Canaria'],
    ['team-palencia-baloncesto', 'Palencia'],
  ];

  const CLUB_EMPLOYMENT_CONTEXTS = {};
  ES_CLUBS.forEach(([clubId, city]) => {
    CLUB_EMPLOYMENT_CONTEXTS[clubId] = {
      clubId,
      employerJurisdictionId: 'ES',
      legalEntityCity: city,
      federationId: 'feb-general',
      // Membresías declaradas de competición (además de la doméstica
      // vigente, que llega del adaptador de frontera). Vacío hoy: ninguna
      // competición europea está implementada (EUROPE-1).
      competitionMemberships: [],
    };
  });

  // El caso transfronterizo obligatorio de esta EPIC.
  CLUB_EMPLOYMENT_CONTEXTS['team-morabanc-andorra'] = {
    clubId: 'team-morabanc-andorra',
    employerJurisdictionId: 'AD',
    legalEntityCity: 'Andorra la Vella',
    // Afiliación deportiva española (juega la ACB) — eje INDEPENDIENTE de
    // la jurisdicción laboral andorrana.
    federationId: 'feb-general',
    competitionMemberships: [],
    note: 'Compite en la ACB (organizada en España) con empleador domiciliado en Andorra: '
      + 'su contrato NUNCA incorpora el RD 1006/1985 ni el SMI español. El convenio ACB/ABP '
      + 'solo puede actuar como capa de MEMBRESÍA de la competición.',
  };

  // Perfil SOLO DE TEST — demuestra que dar de alta un club de otro país es
  // añadir una entrada de catálogo, nunca una rama nueva de código.
  const TEST_CLUB_ID = 'bm-test-club-xx';
  CLUB_EMPLOYMENT_CONTEXTS[TEST_CLUB_ID] = {
    clubId: TEST_CLUB_ID,
    employerJurisdictionId: 'XX',
    legalEntityCity: '[SOLO TEST]',
    federationId: null,
    competitionMemberships: [],
    testOnly: true,
  };

  function getClubEmploymentContext(clubId) {
    return CLUB_EMPLOYMENT_CONTEXTS[clubId] || null;
  }

  function requireClubEmploymentContext(clubId) {
    const context = getClubEmploymentContext(clubId);
    if (!context) {
      throw new Error(
        `ClubEmploymentContextCatalog: el club "${clubId}" no tiene contexto laboral declarado — `
        + 'un club desconocido NO hereda España, ACB ni ningún otro perfil por defecto '
        + '(declara su employerJurisdictionId en el catálogo).',
      );
    }
    return context;
  }

  function listClubEmploymentContexts() {
    return Object.values(CLUB_EMPLOYMENT_CONTEXTS).filter((c) => !c.testOnly);
  }

  function getJurisdiction(jurisdictionId) {
    return JURISDICTIONS[jurisdictionId] || null;
  }

  function jurisdictionLabel(jurisdictionId) {
    const jurisdiction = getJurisdiction(jurisdictionId);
    return jurisdiction ? jurisdiction.label : jurisdictionId;
  }

  // Contexto laboral COMPLETO de un club en un instante concreto de la
  // partida: catálogo (estable) + competición doméstica vigente (cambia con
  // ascensos/descensos, y llega del ÚNICO adaptador de frontera legacy).
  //
  // `team`: instancia real de Team (usa `team.id` y `team.division`).
  // Nunca se infiere nada del nombre/ciudad del equipo.
  function buildEmploymentContext(team, options) {
    const opts = options || {};
    const context = requireClubEmploymentContext(team.id);
    const domesticCompetitionId = opts.domesticCompetitionId
      || CompetitionRules.competitionIdFromLegacyDivision(team.division);
    return {
      clubId: context.clubId,
      clubName: team.fullName || team.name || context.clubId,
      employerJurisdictionId: context.employerJurisdictionId,
      federationId: context.federationId,
      domesticCompetitionId,
      competitionMemberships: [domesticCompetitionId, ...context.competitionMemberships],
      // Perfil DERIVADO por composición declarativa de capas (jurisdicción
      // del empleador + competición doméstica) — nunca un `if` de
      // ACB/FEB/Andorra en ContractService.
      employmentProfileId: `employment:${context.employerJurisdictionId}:${domesticCompetitionId}`,
    };
  }

  // Validación del catálogo (sección 5.2): ningún club sin contexto, ningún
  // contexto con jurisdicción no registrada, ninguna duplicidad.
  function validateCatalog(teams) {
    const errors = [];
    const seen = new Set();
    Object.values(CLUB_EMPLOYMENT_CONTEXTS).forEach((context) => {
      if (seen.has(context.clubId)) errors.push(`Club "${context.clubId}" declarado dos veces en el catálogo.`);
      seen.add(context.clubId);
      if (!context.employerJurisdictionId) {
        errors.push(`Club "${context.clubId}" sin employerJurisdictionId explícito.`);
      }
      if (!context.testOnly && !getJurisdiction(context.employerJurisdictionId)) {
        errors.push(
          `Club "${context.clubId}" declara la jurisdicción "${context.employerJurisdictionId}", `
          + 'que no está registrada en JURISDICTIONS.',
        );
      }
      if (context.federationId && !FEDERATIONS[context.federationId] && !context.testOnly) {
        errors.push(`Club "${context.clubId}" declara la federación "${context.federationId}", no registrada.`);
      }
    });
    (teams || []).forEach((team) => {
      if (!getClubEmploymentContext(team.id)) {
        errors.push(
          `El equipo "${team.fullName || team.id}" está vivo en la partida pero no tiene contexto laboral `
          + 'declarado en ClubEmploymentContextCatalog.',
        );
      }
    });
    return { valid: errors.length === 0, errors };
  }

  const exportsObj = {
    ClubEmploymentContextCatalog: {
      JURISDICTIONS,
      FEDERATIONS,
      CLUB_EMPLOYMENT_CONTEXTS,
      TEST_CLUB_ID,
      getClubEmploymentContext,
      requireClubEmploymentContext,
      listClubEmploymentContexts,
      getJurisdiction,
      jurisdictionLabel,
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
