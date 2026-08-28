// src/core/SeasonHistoryService.js
// CYCLE-1 (DESIGN.md 9.22, sección 29.4 del prompt) — cierre DEPORTIVO de
// la temporada, extraído del monolito `closeSeasonAndPrepareNext()` SIN
// cambiar ningún resultado. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Qué hace (exactamente lo que ya hacía game.js, ahora en un único sitio
// consumido por la interfaz Y por los scripts de humo compartidos):
//  - captura la división REAL con la que compitió cada club ANTES de
//    aplicar ascensos/descensos;
//  - aplica ascensos/descensos reutilizando los datos YA calculados por
//    `League`/`PromotionPlayoff` (nunca recalcula un campeón);
//  - construye los honores de la temporada a partir de hechos ya resueltos;
//  - cierra el histórico de carrera de cada jugador con su club/división
//    correctos (un cedido cierra con su club de SERVICIO, no con el
//    propietario);
//  - recoge la EVIDENCIA del último partido oficial de CADA club, que el
//    ciclo anual necesita para abrir los plazos desde la fecha de ese club
//    y nunca desde la final para los 36.
//
// Qué NO hace: no crea calendario nuevo, no toca contratos, no genera
// cantera, no expira licencias. Todo eso es del ciclo anual
// (`AnnualCycleService`).
//
// Módulo puro por duck typing: solo usa `getStandingsTable()`,
// `directPromotion`/`secondPromotedEntry`, `champion` y `team.roster` — no
// importa League/Bracket/Promotion como clases.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const LocalDateModule = isNode ? require('../utils/LocalDate.js') : global.BasketManager;
  const PlayerCareerModule = isNode ? require('./PlayerCareer.js') : global.BasketManager;

  function LD() { return LocalDateModule.LocalDate; }
  function PC() { return PlayerCareerModule; }

  // =====================================================================
  // 1. Evidencia del último partido oficial POR CLUB
  // =====================================================================
  // Se alimenta en cada partido resuelto de CUALQUIER competición (liga,
  // Copa, playoff por el título, playoff de ascenso) y conserva SIEMPRE la
  // fecha más tardía de cada club. Un club eliminado en cuartos tendrá una
  // fecha muy anterior a la del campeón: eso es exactamente lo que el ciclo
  // necesita (sección 7 del prompt).
  class LastOfficialMatchEvidenceCollector {
    constructor() {
      this._byClub = new Map();
    }

    record(params) {
      const {
        clubId, date, competitionId, phaseId, matchId, opponentClubId,
      } = params;
      if (!clubId || !date) return null;
      const iso = typeof date === 'string' ? LD().requireIsoDate(date, 'date') : LD().fromJsDate(date);
      const existing = this._byClub.get(clubId);
      if (existing && !LD().isAfter(iso, existing.date)) return existing;
      const row = {
        clubId,
        date: iso,
        competitionId: competitionId || null,
        phaseId: phaseId || null,
        matchId: matchId || null,
        opponentClubId: opponentClubId || null,
      };
      this._byClub.set(clubId, row);
      return row;
    }

    recordMatch(params) {
      const {
        homeClubId, awayClubId, date, competitionId, phaseId, matchId,
      } = params;
      this.record({
        clubId: homeClubId, date, competitionId, phaseId, matchId, opponentClubId: awayClubId,
      });
      this.record({
        clubId: awayClubId, date, competitionId, phaseId, matchId, opponentClubId: homeClubId,
      });
    }

    forClub(clubId) { return this._byClub.get(clubId) || null; }

    // Orden canónico por clubId — nunca el orden de inserción.
    toArray() {
      return [...this._byClub.values()].sort((a, b) => (a.clubId < b.clubId ? -1 : 1));
    }

    // Clubes que TODAVÍA no tienen evidencia (por ejemplo si una
    // competición no se ha jugado): se declara explícitamente, nunca se
    // rellena con una fecha inventada.
    missingClubIds(teams) {
      return (teams || []).map((team) => team.id).filter((clubId) => !this._byClub.has(clubId)).sort();
    }

    clear() { this._byClub.clear(); }
  }

  // =====================================================================
  // 2. Ascensos y descensos
  // =====================================================================
  function captureDivisionsBefore(teams) {
    const map = new Map();
    (teams || []).forEach((team) => map.set(team.id, team.division));
    return map;
  }

  // Reutiliza EXACTAMENTE los datos ya calculados: los 2 últimos de la liga
  // regular de 1ª y los dos ascendidos que ya resolvió `PromotionPlayoff`
  // (`directPromotion` = campeón de la liga regular de 2ª,
  // `secondPromotedEntry` = campeón del playoff de ascenso). No se
  // recalcula ningún campeón aquí.
  function applyPromotionsAndRelegations(params) {
    const { leagueA, promotionPlayoff } = params;
    const standingsA = leagueA.getStandingsTable();
    const relegatedTeams = [
      standingsA[standingsA.length - 1].team,
      standingsA[standingsA.length - 2].team,
    ];
    relegatedTeams.forEach((team) => { team.division = '2ª'; });
    const promotedTeams = [
      promotionPlayoff.directPromotion.team,
      promotionPlayoff.secondPromotedEntry.team,
    ];
    promotedTeams.forEach((team) => { team.division = '1ª'; });
    return { promotedTeams, relegatedTeams };
  }

  // =====================================================================
  // 3. Honores de la temporada (hechos YA calculados)
  // =====================================================================
  function buildSeasonHonoursByTeamId(params) {
    const {
      leagueB, cup, titlePlayoff, promotedTeams,
    } = params;
    const map = new Map();
    function add(teamId, code) {
      if (!teamId) return;
      const list = map.get(teamId) || [];
      list.push(code);
      map.set(teamId, list);
    }
    const standingsB = leagueB ? leagueB.getStandingsTable() : [];
    if (standingsB.length) add(standingsB[0].team.id, 'regularSeasonChampion2');
    if (cup && cup.champion) add(cup.champion.team.id, 'cupChampion');
    if (titlePlayoff && titlePlayoff.champion) add(titlePlayoff.champion.team.id, 'titlePlayoffChampion');
    if (promotedTeams && promotedTeams[0]) add(promotedTeams[0].id, 'promotedDirect');
    if (promotedTeams && promotedTeams[1]) add(promotedTeams[1].id, 'promotedPlayoff');
    return map;
  }

  // =====================================================================
  // 4. Cierre del histórico de carrera
  // =====================================================================
  // `rolesSnapshotFor(player, team)`: callback opcional (la interfaz aporta
  // el rol táctico real desde `team.tacticalProfile`). Sin él, se cierra
  // con roles nulos, exactamente el mismo criterio neutro de Tactics.js.
  function closeCareerHistories(params) {
    const {
      teams, honoursByTeamId, divisionsBefore, seasonEndDateTime, nextSeasonKey, config, rolesSnapshotFor,
    } = params;
    let closed = 0;
    (teams || []).forEach((team) => {
      const honours = (honoursByTeamId && honoursByTeamId.get(team.id)) || [];
      team.roster.forEach((player) => {
        if (!player.careerHistory) return;
        honours.forEach((honourCode) => PC().registerHonour(player, honourCode));
        PC().closeSeason(player, {
          endDate: seasonEndDateTime,
          teamId: team.id,
          teamName: team.fullName,
          division: (divisionsBefore && divisionsBefore.get(team.id)) || team.division,
          roles: rolesSnapshotFor ? rolesSnapshotFor(player, team) : { offense: null, defense: null },
          honours,
          nextSeasonKey,
        }, config);
        closed += 1;
      });
    });
    return { closed };
  }

  const exportsObj = {
    SeasonHistoryService: {
      LastOfficialMatchEvidenceCollector,
      captureDivisionsBefore,
      applyPromotionsAndRelegations,
      buildSeasonHonoursByTeamId,
      closeCareerHistories,
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
