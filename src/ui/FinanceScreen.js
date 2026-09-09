// src/ui/FinanceScreen.js
// SQUAD-BUDGET-1 (presupuesto salarial) + ECONOMY-BOARD-1 (economía real
// del club, proyección y peticiones de ampliación) — pantalla "Finanzas"
// del club del usuario. Módulo ENFOCADO y separado de `src/ui/game.js`
// (que solo hace la navegación/ciclo de vida, ver `renderFinanceScreen()`
// ahí) — toda la lógica de lectura/renderizado vive aquí. Convención del
// proyecto: identificadores en inglés, comentarios en español.
//
// Nunca muta ningún registro por sí sola — el envío de una petición de
// ampliación se delega SIEMPRE en el callback `onSubmitRequest` (dominio
// real en `BoardBudgetRequestService`, orquestado por `game.js`).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const { SquadBudgetService } = dep('../core/SquadBudgetService.js');
  const { ClubFinanceService } = dep('../core/ClubFinanceService.js');
  const { FinancialCapacityService } = dep('../core/FinancialCapacityService.js');
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

  // --- ECONOMY-BOARD-1 -----------------------------------------------------

  function renderTreasuryTab(params) {
    const {
      clubId, currency, clubFinanceRegistry, escapeHtml,
    } = params;
    const pending = clubFinanceRegistry.pendingScheduledItemsForClub(clubId).filter((i) => i.currency === currency);
    const upcoming = pending.filter((i) => i.status === 'scheduled').slice(0, 12);
    const overdue = pending.filter((i) => i.status === 'overdue');
    const unscheduled = ClubFinanceService.unscheduledExposureForClub(clubId, params.transferRegistry);
    const upcomingRows = upcoming.length ? upcoming.map((i) => `
      <tr>
        <td>${esc(escapeHtml, i.dueDate)}</td>
        <td>${i.direction === 'inflow' ? 'Cobro' : 'Pago'}</td>
        <td>${esc(escapeHtml, i.category)}</td>
        <td>${fmt(i.amountMinor, i.currency)}</td>
      </tr>`).join('') : '<tr><td colspan="4" class="gm-muted">Sin movimientos fechados próximos.</td></tr>';
    const overdueRows = overdue.length ? overdue.map((i) => `
      <tr>
        <td>${esc(escapeHtml, i.dueDate)}</td>
        <td>${esc(escapeHtml, i.category)}</td>
        <td>${fmt(i.amountMinor, i.currency)}</td>
      </tr>`).join('') : '<tr><td colspan="3" class="gm-muted">Sin impagos pendientes.</td></tr>';
    const unscheduledHtml = unscheduled.length
      ? `<ul>${unscheduled.map((o) => `<li>${esc(escapeHtml, o.concept)} — ${fmt(o.amountMinor, o.currency)} (sin fecha resoluble)</li>`).join('')}</ul>`
      : '<p class="gm-muted">Sin compromisos sin fecha.</p>';
    return `
      <div class="gm-card">
        <h3>Tesorería — próximos movimientos</h3>
        <div class="gm-table-scroll"><table class="gm-table">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Importe</th></tr></thead>
          <tbody>${upcomingRows}</tbody>
        </table></div>
      </div>
      <div class="gm-card ${overdue.length ? 'gm-card--warn' : ''}">
        <h3>Impagos pendientes</h3>
        <div class="gm-table-scroll"><table class="gm-table">
          <thead><tr><th>Vencía</th><th>Categoría</th><th>Importe</th></tr></thead>
          <tbody>${overdueRows}</tbody>
        </table></div>
        ${overdue.length ? '<p class="gm-muted">Un impago obligatorio bloquea nuevas peticiones de ampliación hasta liquidarse.</p>' : ''}
      </div>
      <div class="gm-card">
        <h3>Compromisos sin fecha resoluble</h3>
        ${unscheduledHtml}
      </div>`;
  }

  function renderBudgetPlanTab(plan, escapeHtml) {
    if (!plan) return '<div class="gm-card"><p class="gm-muted">Sin plan financiero todavía para esta temporada.</p></div>';
    const incomeRows = Object.keys(plan.incomeByCategoryMinor).map((k) => `
      <tr><td>${esc(escapeHtml, k)}</td><td>${fmt(plan.incomeByCategoryMinor[k], plan.currency)}</td></tr>`).join('');
    const expenseRows = Object.keys(plan.expenseByCategoryMinor).map((k) => `
      <tr><td>${esc(escapeHtml, k)}</td><td>${fmt(plan.expenseByCategoryMinor[k], plan.currency)}</td></tr>`).join('');
    return `
      <div class="gm-card">
        <h3>Presupuesto planificado — ${esc(escapeHtml, plan.seasonKey)}</h3>
        <p class="gm-muted">Simulación de juego (${esc(escapeHtml, plan.provenance.dataSource)}, arquetipo
          "${esc(escapeHtml, plan.archetype)}") — no son cuentas reales verificadas ni cumplimiento regulatorio
          completo.</p>
        <div class="gm-stats-row">
          <div class="gm-stat"><span class="gm-stat__label">Ingreso planificado</span><span class="gm-stat__value">${fmt(plan.plannedIncomeMinor, plan.currency)}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Margen objetivo</span><span class="gm-stat__value">${fmt(plan.targetMarginMinor, plan.currency)}</span></div>
        </div>
        <h4>Ingresos por categoría</h4>
        <div class="gm-table-scroll"><table class="gm-table"><tbody>${incomeRows}</tbody></table></div>
        <h4>Gastos por categoría</h4>
        <div class="gm-table-scroll"><table class="gm-table"><tbody>${expenseRows}</tbody></table></div>
      </div>`;
  }

  function renderProjectionTab(projection, capacity, escapeHtml) {
    const rows = projection.seasons.map((s) => `
      <tr>
        <td>${esc(escapeHtml, s.seasonKey)}</td>
        <td>${fmt(s.plannedIncomeMinor, s.currency)}</td>
        <td>${fmt(s.plannedExpenseMinor, s.currency)}</td>
        <td>${fmt(s.plannedIncomeMinor - s.plannedExpenseMinor, s.currency)}</td>
        <td>${fmt(s.projectedClosingCashMinor, s.currency)}</td>
        <td>${fmt(capacity.headroomMinorBySeasonKey[s.seasonKey] || 0, s.currency)}</td>
      </tr>`).join('');
    return `
      <div class="gm-card">
        <h3>Proyección a 3 temporadas</h3>
        <p class="gm-muted">Simulación interna — el umbral de déficit acumulado (5% del ingreso base a 3 temporadas)
          es una salvaguarda de juego inspirada en el control económico ACB, no una certificación de ese reglamento.</p>
        <div class="gm-table-scroll"><table class="gm-table">
          <thead><tr><th>Temporada</th><th>Ingreso</th><th>Gasto</th><th>Resultado</th><th>Caja proyectada</th><th>Margen de ampliación</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  }

  function renderRequestTab(params) {
    const {
      clubId, currency, isoDate, seasonOptions, squadBudgetRegistry, pendingRequest, eligibility, escapeHtml,
    } = params;
    if (pendingRequest) {
      return `<div class="gm-card">
        <h3>Solicitar ampliación</h3>
        <p><strong>Petición pendiente</strong> — enviada ${esc(escapeHtml, pendingRequest.submittedGameDate)},
          respuesta esperada ${esc(escapeHtml, pendingRequest.dueGameDate)}.</p>
      </div>`;
    }
    const optionsHtml = seasonOptions.map((seasonKey) => {
      const allocation = squadBudgetRegistry.effectiveAllocationFor(clubId, seasonKey, currency, isoDate);
      const limitMinor = allocation ? allocation.amountMinor : 0;
      return `<option value="${esc(escapeHtml, seasonKey)}" data-limit-minor="${limitMinor}">${esc(escapeHtml, seasonKey)} (límite actual ${fmt(limitMinor, currency)})</option>`;
    }).join('');
    const disabledAttr = eligibility.eligible ? '' : 'disabled';
    const blockedHtml = eligibility.eligible ? '' : `<p class="gm-card--warn gm-muted">${esc(escapeHtml, eligibility.reason)}</p>`;
    return `<div class="gm-card">
      <h3>Solicitar ampliación de presupuesto</h3>
      ${blockedHtml}
      <form class="gm-board-request-form">
        <label>Temporada
          <select name="seasonKey" class="gm-board-request-season" ${disabledAttr}>${optionsHtml}</select>
        </label>
        <div class="gm-board-request-suggestions">
          <button type="button" class="gm-board-request-suggest" data-pct="5" ${disabledAttr}>+5%</button>
          <button type="button" class="gm-board-request-suggest" data-pct="10" ${disabledAttr}>+10%</button>
          <button type="button" class="gm-board-request-suggest" data-pct="20" ${disabledAttr}>+20%</button>
        </div>
        <label>Importe solicitado (EUR)
          <input type="number" min="1" step="1000" name="amountEuros" class="gm-board-request-amount" ${disabledAttr}>
        </label>
        <p class="gm-board-request-error gm-muted"></p>
        <button type="submit" class="gm-board-request-submit" ${disabledAttr}>Enviar petición a la junta</button>
      </form>
    </div>`;
  }

  function renderRequestHistory(requests, escapeHtml) {
    if (!requests.length) return '<div class="gm-card"><h3>Historial de peticiones</h3><p class="gm-muted">Sin peticiones todavía.</p></div>';
    const rows = requests.map((r) => `
      <tr>
        <td>${esc(escapeHtml, r.submittedGameDate)}</td>
        <td>${esc(escapeHtml, r.source)}</td>
        <td>${esc(escapeHtml, r.status === 'pending' ? 'pendiente' : r.outcome)}</td>
        <td>${esc(escapeHtml, r.explanationEs || '—')}</td>
      </tr>`).join('');
    return `<div class="gm-card"><h3>Historial de peticiones</h3>
      <div class="gm-table-scroll"><table class="gm-table">
        <thead><tr><th>Enviada</th><th>Origen</th><th>Resultado</th><th>Explicación</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>`;
  }

  // `deps`: { team, seasonKey, isoDate, squadBudgetRegistry, contractRegistry,
  //   marketRegistry, loanRegistry, transferRegistry, clubFinanceRegistry,
  //   boardBudgetRequestRegistry, playerRegistry, escapeHtml, eligibility,
  //   onSubmitRequest(seasonKey, amountMinor) }.
  function render(container, deps) {
    const {
      team, seasonKey, isoDate, squadBudgetRegistry, contractRegistry, marketRegistry, loanRegistry, transferRegistry,
      clubFinanceRegistry, boardBudgetRequestRegistry, playerRegistry, escapeHtml, eligibility, onSubmitRequest,
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

    let treasuryHtml = '';
    let planHtml = '';
    let projectionHtml = '';
    let requestHtml = '';
    let historyHtml = '';

    if (clubFinanceRegistry) {
      const treasuryMinor = clubFinanceRegistry.treasuryBalance(clubId, 'EUR');
      const plan = clubFinanceRegistry.effectivePlanFor(clubId, seasonKey, 'EUR');
      const seasonProjection = plan ? ClubFinanceService.projectSeason({
        registry: clubFinanceRegistry, clubId, seasonKey, currency: 'EUR', openingCashMinor: treasuryMinor, transferRegistry,
      }) : null;
      const overdueCount = clubFinanceRegistry.overdueItemsForClub(clubId).length;

      const resumenHtml = `<div class="gm-card">
        <h3>Resumen económico simulado</h3>
        <p class="gm-muted">Finanzas de simulación de juego — no son cuentas reales verificadas ni cumplimiento
          regulatorio completo del club.</p>
        <div class="gm-stats-row">
          <div class="gm-stat"><span class="gm-stat__label">Caja actual</span><span class="gm-stat__value">${fmt(treasuryMinor, 'EUR')}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Reserva mínima requerida</span><span class="gm-stat__value">${seasonProjection ? fmt(seasonProjection.requiredMonthlyReserveMinor, 'EUR') : '—'}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Caja proyectada a cierre</span><span class="gm-stat__value">${seasonProjection ? fmt(seasonProjection.projectedClosingCashMinor, 'EUR') : '—'}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Resultado de temporada (plan)</span><span class="gm-stat__value">${seasonProjection ? fmt(seasonProjection.plannedIncomeMinor - seasonProjection.plannedExpenseMinor, 'EUR') : '—'}</span></div>
          <div class="gm-stat ${overdueCount ? 'gm-stat--warn' : ''}"><span class="gm-stat__label">Impagos pendientes</span><span class="gm-stat__value">${overdueCount}</span></div>
        </div>
      </div>`;

      treasuryHtml = resumenHtml + renderTreasuryTab({
        clubId, currency: 'EUR', clubFinanceRegistry, transferRegistry, escapeHtml,
      });
      planHtml = renderBudgetPlanTab(plan, escapeHtml);

      if (boardBudgetRequestRegistry) {
        const capacity = FinancialCapacityService.evaluateFinancialCapacity({
          registry: clubFinanceRegistry, clubId, currency: 'EUR', currentSeasonKey: seasonKey, transferRegistry,
        });
        const rollingProjection = ClubFinanceService.buildRollingProjection({
          registry: clubFinanceRegistry, clubId, currency: 'EUR', currentSeasonKey: seasonKey, transferRegistry,
        });
        projectionHtml = renderProjectionTab(rollingProjection, capacity, escapeHtml);
        const pendingRequest = boardBudgetRequestRegistry.unresolvedForClub(clubId);
        requestHtml = renderRequestTab({
          clubId,
          currency: 'EUR',
          isoDate,
          seasonOptions: capacity.horizonSeasonKeys,
          squadBudgetRegistry,
          pendingRequest,
          eligibility: eligibility || { eligible: false, reason: 'No disponible.' },
          escapeHtml,
        });
        historyHtml = renderRequestHistory(boardBudgetRequestRegistry.requestsForClub(clubId), escapeHtml);
      }
    }

    container.innerHTML = `
      <h2>Finanzas — ${esc(escapeHtml, team.fullName)}</h2>
      <p class="gm-muted">Presupuesto salarial de plantilla (sporting salary budget) para ${esc(escapeHtml, seasonKey)} —
        no es caja del club, ingresos ni beneficio real verificado.</p>
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
      ${treasuryHtml}
      ${planHtml}
      ${projectionHtml}
      ${requestHtml}
      ${historyHtml}
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
      </div>`;

    const form = container.querySelector('.gm-board-request-form');
    if (form && typeof onSubmitRequest === 'function') {
      const seasonSelect = form.querySelector('.gm-board-request-season');
      const amountInput = form.querySelector('.gm-board-request-amount');
      form.querySelectorAll('.gm-board-request-suggest').forEach((btn) => {
        btn.addEventListener('click', () => {
          const selectedOption = seasonSelect.options[seasonSelect.selectedIndex];
          const limitMinor = selectedOption ? Number(selectedOption.dataset.limitMinor) : 0;
          const pct = Number(btn.dataset.pct);
          amountInput.value = Math.round((limitMinor * pct) / 100 / 100);
        });
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const errorEl = form.querySelector('.gm-board-request-error');
        const amountEuros = Number(amountInput.value);
        if (!amountEuros || amountEuros <= 0) {
          errorEl.textContent = 'Introduce un importe válido.';
          return;
        }
        const result = onSubmitRequest(seasonSelect.value, Math.round(amountEuros * 100));
        if (!result || !result.ok) {
          errorEl.textContent = (result && result.message) || 'No se pudo enviar la petición.';
        }
      });
    }
  }

  const exportsObj = { FinanceScreen: { render } };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
