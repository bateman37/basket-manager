// src/ui/FinanceScreen.js
// SQUAD-BUDGET-1 — pantalla "Finanzas": solo lectura del presupuesto
// salarial de plantilla del club del usuario. Módulo ENFOCADO y separado de
// `src/ui/game.js` (que solo hace la navegación/ciclo de vida, ver
// `renderFinanceScreen()` ahí) — toda la lógica de lectura y de
// renderizado vive aquí. Convención del proyecto: identificadores en
// inglés, comentarios en español.
//
// Nunca muta ningún registro: `render()` solo lee `SquadBudgetService.
// deriveBudgetView()` y el historial de `SquadBudgetRegistry` — igual
// criterio que el resto de pantallas de solo lectura del proyecto
// (Contratos/Inscripciones).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const { SquadBudgetService } = dep('../core/SquadBudgetService.js');
  const { Money } = dep('../utils/Money.js');
  const { LocalDate } = dep('../utils/LocalDate.js');

  function fmt(amountMinor, currency) {
    return Money.format(amountMinor || 0, currency || 'EUR', { compact: true });
  }

  function esc(escapeHtml, value) {
    return typeof escapeHtml === 'function' ? escapeHtml(String(value)) : String(value);
  }

  function renderAllocationHistory(chain, escapeHtml) {
    if (!chain.length) return '<p class="gm-muted">Sin historial de asignaciones.</p>';
    const rows = chain.map((allocation) => `
      <tr>
        <td>${esc(escapeHtml, allocation.seasonKey)}</td>
        <td>${esc(escapeHtml, allocation.effectiveDate)}</td>
        <td>${fmt(allocation.amountMinor, allocation.currency)}</td>
        <td>${esc(escapeHtml, allocation.revisionKind)}</td>
        <td>${esc(escapeHtml, allocation.decisionAuthority)}</td>
        <td>${esc(escapeHtml, (allocation.provenance && allocation.provenance.policyVersion) || '—')}</td>
      </tr>`).join('');
    return `<div class="gm-table-scroll"><table class="gm-table">
      <thead><tr><th>Temporada</th><th>Vigente desde</th><th>Importe</th><th>Tipo</th><th>Autoridad</th><th>Política</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function renderPlayerRows(playerRows, playerRegistry, escapeHtml) {
    if (!playerRows.length) return '<p class="gm-muted">Sin jugadores con coste salarial en esta temporada.</p>';
    const rows = playerRows.map((row) => {
      const player = playerRegistry && playerRegistry.has(row.playerId) ? playerRegistry.get(row.playerId) : null;
      const name = player ? player.fullName : row.playerId;
      const badge = row.loanBadge === 'loaned-out'
        ? '<span class="gm-badge gm-badge--info">Cedido fuera</span>'
        : row.loanBadge === 'loaned-in'
          ? '<span class="gm-badge gm-badge--info">Cedido a este club</span>' : '';
      return `<tr>
        <td>${esc(escapeHtml, name)} ${badge}</td>
        <td>${fmt(row.guaranteedTotalMinor, row.currency)}</td>
        <td>${fmt(row.variableMaxMinor, row.currency)}</td>
        <td>${fmt(row.chargedToThisClubMinor, row.currency)}</td>
      </tr>`;
    }).join('');
    return `<div class="gm-table-scroll"><table class="gm-table">
      <thead><tr><th>Jugador</th><th>Garantizado</th><th>Variable máx.</th><th>Cargado a este club</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function renderFutureSeasonRows(rows, escapeHtml) {
    if (!rows.length) return '<p class="gm-muted">Sin otras temporadas con asignación, compromiso o reserva.</p>';
    const body = rows.map((r) => `
      <tr>
        <td>${esc(escapeHtml, r.seasonKey)}</td>
        <td>${r.hasAllocation ? fmt(r.limitMinor, r.currency) : '<span class="gm-muted">Sin asignar</span>'}</td>
        <td>${fmt(r.committedMinor, r.currency)}</td>
        <td>${fmt(r.reservedMinor, r.currency)}</td>
        <td>${fmt(r.availableMinor, r.currency)}</td>
      </tr>`).join('');
    return `<div class="gm-table-scroll"><table class="gm-table">
      <thead><tr><th>Temporada</th><th>Asignado</th><th>Comprometido</th><th>Reservado</th><th>Disponible</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  // `deps`: { team, seasonKey, isoDate, squadBudgetRegistry, contractRegistry,
  //   marketRegistry, loanRegistry, playerRegistry, escapeHtml }.
  function render(container, deps) {
    const {
      team, seasonKey, isoDate, squadBudgetRegistry, contractRegistry, marketRegistry, loanRegistry, playerRegistry, escapeHtml,
    } = deps;
    const clubId = team.clubId;
    const view = SquadBudgetService.deriveBudgetView({
      registry: squadBudgetRegistry, clubId, seasonKey, currency: 'EUR', atGameDate: isoDate,
      contractRegistry, marketRegistry, loanRegistry,
    });

    const futureSeasonKeys = [...new Set([
      seasonKey,
      ...squadBudgetRegistry.seasonKeysForClub(clubId),
      ...(contractRegistry ? contractRegistry.forClub(clubId).reduce((acc, c) => acc.concat(c.coveredSeasonKeys), []) : []),
    ])]
      .filter((k) => LocalDate.compareSeasonKeys(k, seasonKey) >= 0)
      .sort((a, b) => LocalDate.compareSeasonKeys(a, b));
    const futureRows = futureSeasonKeys
      .filter((k) => k !== seasonKey)
      .map((k) => SquadBudgetService.deriveBudgetView({
        registry: squadBudgetRegistry, clubId, seasonKey: k, currency: 'EUR', atGameDate: isoDate, contractRegistry, marketRegistry, loanRegistry,
      }));

    const chain = squadBudgetRegistry.chainFor(clubId, seasonKey, 'EUR').map((a) => a.toJSON());

    const overcommittedHtml = view.overcommittedMinor > 0
      ? `<div class="gm-stat gm-stat--warn"><span class="gm-stat__label">Excedido sobre el límite</span>
         <span class="gm-stat__value">${fmt(view.overcommittedMinor, view.currency)}</span></div>`
      : '';

    const provenanceWarningHtml = (view.allocation && view.allocation.revisionKind !== 'board-revision')
      ? `<div class="gm-card gm-card--warn">
          <p><strong>Estimación de compatibilidad</strong> — esta asignación no es un dato financiero real del
          club: se congeló a partir de una fórmula provisional de la partida (política
          "${esc(escapeHtml, (view.allocation.provenance && view.allocation.provenance.policyVersion) || '—')}").</p>
        </div>`
      : '';

    container.innerHTML = `
      <h2>Finanzas — ${esc(escapeHtml, team.fullName)}</h2>
      <p class="gm-muted">Presupuesto salarial de plantilla (sporting salary budget) para ${esc(escapeHtml, seasonKey)} —
        no es caja del club, ingresos ni beneficio.</p>
      ${provenanceWarningHtml}
      <div class="gm-card">
        <h3>Presupuesto salarial — ${esc(escapeHtml, seasonKey)}</h3>
        <div class="gm-stats-row">
          <div class="gm-stat"><span class="gm-stat__label">Asignado</span><span class="gm-stat__value">${view.hasAllocation ? fmt(view.limitMinor, view.currency) : 'Sin asignar'}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Comprometido</span><span class="gm-stat__value">${fmt(view.committedMinor, view.currency)}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Reservado</span><span class="gm-stat__value">${fmt(view.reservedMinor, view.currency)}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Disponible</span><span class="gm-stat__value">${fmt(view.availableMinor, view.currency)}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">% usado</span><span class="gm-stat__value">${view.percentageUsed === null ? '—' : `${view.percentageUsed}%`}</span></div>
          ${overcommittedHtml}
        </div>
      </div>
      <div class="gm-card">
        <h3>Exposición de riesgo (no consume el límite duro)</h3>
        <div class="gm-stats-row">
          <div class="gm-stat"><span class="gm-stat__label">Variable máx.</span><span class="gm-stat__value">${fmt(view.variableMaxMinor, view.currency)}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Beneficios</span><span class="gm-stat__value">${fmt(view.benefitsValueMinor, view.currency)}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Costes de agente</span><span class="gm-stat__value">${fmt(view.agentCostsMinor, view.currency)}</span></div>
        </div>
      </div>
      <div class="gm-card">
        <h3>Otras temporadas</h3>
        ${renderFutureSeasonRows(futureRows, escapeHtml)}
      </div>
      <div class="gm-card">
        <h3>Contribución por jugador — ${esc(escapeHtml, seasonKey)}</h3>
        ${renderPlayerRows(view.playerRows, playerRegistry, escapeHtml)}
      </div>
      <div class="gm-card">
        <h3>Historial de asignaciones/revisiones</h3>
        ${renderAllocationHistory(chain, escapeHtml)}
      </div>
      <p class="gm-muted">Las peticiones de ampliación de presupuesto a la junta no están disponibles todavía —
        llegarán en la próxima entrega de economía/junta.</p>`;
  }

  const exportsObj = { FinanceScreen: { render } };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
