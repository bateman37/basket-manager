// src/ui/DirectivaScreen.js
// ECONOMY-BOARD-1 — pantalla "Directiva": manager/tenure, estilo fiscal y
// objetivos de junta, confianza (3 dimensiones + global, con desglose) y
// petición pendiente/historial. Módulo ENFOCADO y separado de
// `src/ui/game.js` (que solo hace la navegación/ciclo de vida). Solo
// LECTURA — la reutilización del formulario de petición vive en
// `FinanceScreen.js`; esta pantalla enlaza a Finanzas, nunca duplica el
// formulario. Convención del proyecto: identificadores en inglés,
// comentarios en español.

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  function dep(path) { return isNode ? require(path) : global.BasketManager; }

  const { Money } = dep('../utils/Money.js');
  const { LocalDate } = dep('../utils/LocalDate.js');
  const { BoardConfidenceService } = dep('../core/BoardConfidenceService.js');

  function fmt(amountMinor, currency) {
    return Money.format(amountMinor || 0, currency || 'EUR', { compact: true });
  }

  function esc(escapeHtml, value) {
    return typeof escapeHtml === 'function' ? escapeHtml(String(value)) : String(value);
  }

  function confidenceBar(label, value, breakdown, escapeHtml) {
    const detail = breakdown && breakdown.reasons ? breakdown.reasons.join(', ')
      : (breakdown ? Object.entries(breakdown).filter(([k]) => k !== 'reasons').map(([k, v]) => `${k}: ${v}`).join(', ') : '');
    return `<div class="gm-confidence-row">
      <span class="gm-confidence-row__label">${esc(escapeHtml, label)}</span>
      <div class="gm-confidence-row__bar"><div class="gm-confidence-row__fill" style="width:${value}%"></div></div>
      <span class="gm-confidence-row__value">${value}</span>
      <p class="gm-muted gm-confidence-row__detail">${esc(escapeHtml, detail)}</p>
    </div>`;
  }

  function renderRequestHistory(requests, escapeHtml) {
    if (!requests.length) return '<p class="gm-muted">Sin peticiones todavía.</p>';
    const rows = requests.map((r) => `
      <tr>
        <td>${esc(escapeHtml, r.submittedGameDate)}</td>
        <td>${esc(escapeHtml, r.source)}</td>
        <td>${esc(escapeHtml, r.status === 'pending' ? `pendiente (resp. ${r.dueGameDate})` : r.outcome)}</td>
      </tr>`).join('');
    return `<div class="gm-table-scroll"><table class="gm-table">
      <thead><tr><th>Enviada</th><th>Origen</th><th>Resultado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  // `deps`: { team, manager, spell, boardPolicy, confidenceSnapshot,
  //   financialGoal, requests, isoDate, escapeHtml }.
  function render(container, deps) {
    const {
      team, manager, spell, boardPolicy, confidenceSnapshot, financialGoal, requests, isoDate, escapeHtml,
    } = deps;

    if (!manager || !spell) {
      container.innerHTML = '<p class="gm-muted">Sin manager empleado en este club todavía.</p>';
      return;
    }

    const completedMonths = spell.completedMonthsAsOf(isoDate);
    const fiscalStyleLabels = { conservative: 'Conservador', balanced: 'Equilibrado', ambitious: 'Ambicioso' };
    const pendingRequest = requests.find((r) => r.status === 'pending');

    container.innerHTML = `
      <h2>Directiva — ${esc(escapeHtml, team.fullName)}</h2>
      <p class="gm-muted">Confianza y política de junta SIMULADAS — no son datos reales del club ni una
        certificación de ningún reglamento económico oficial.</p>
      <div class="gm-card">
        <h3>Empleo del manager</h3>
        <div class="gm-stats-row">
          <div class="gm-stat"><span class="gm-stat__label">Empleado desde</span><span class="gm-stat__value">${esc(escapeHtml, spell.startGameDate)}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Meses completados</span><span class="gm-stat__value">${completedMonths}</span></div>
          <div class="gm-stat"><span class="gm-stat__label">Estilo fiscal de la junta</span><span class="gm-stat__value">${esc(escapeHtml, fiscalStyleLabels[boardPolicy.fiscalStyle] || boardPolicy.fiscalStyle)}</span></div>
        </div>
      </div>
      <div class="gm-card">
        <h3>Objetivos de la junta</h3>
        <p><strong>Objetivo deportivo:</strong> ${esc(escapeHtml, team.board.sportingGoal)}</p>
        <p><strong>Objetivo financiero:</strong> ${esc(escapeHtml, BoardConfidenceService.describeFinancialGoalEs(financialGoal))}</p>
      </div>
      <div class="gm-card">
        <h3>Confianza de la junta</h3>
        <div class="gm-confidence-row gm-confidence-row--overall">
          <span class="gm-confidence-row__label">Global</span>
          <div class="gm-confidence-row__bar"><div class="gm-confidence-row__fill" style="width:${confidenceSnapshot.overall}%"></div></div>
          <span class="gm-confidence-row__value">${confidenceSnapshot.overall}</span>
        </div>
        ${confidenceBar('Deportiva (45%)', confidenceSnapshot.sporting.value, confidenceSnapshot.sporting.breakdown, escapeHtml)}
        ${confidenceBar('Disciplina financiera (35%)', confidenceSnapshot.financialDiscipline.value, confidenceSnapshot.financialDiscipline.breakdown, escapeHtml)}
        ${confidenceBar('Relación/antigüedad (20%)', confidenceSnapshot.relationship.value, confidenceSnapshot.relationship.breakdown, escapeHtml)}
      </div>
      <div class="gm-card">
        <h3>Petición de ampliación</h3>
        ${pendingRequest
    ? `<p><strong>Pendiente</strong> — enviada ${esc(escapeHtml, pendingRequest.submittedGameDate)}, respuesta
            esperada ${esc(escapeHtml, pendingRequest.dueGameDate)}.</p>`
    : '<p class="gm-muted">Sin petición pendiente — usa la pestaña "Solicitar ampliación" de Finanzas.</p>'}
        <h4>Historial</h4>
        ${renderRequestHistory(requests, escapeHtml)}
      </div>`;
  }

  const exportsObj = { DirectivaScreen: { render } };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
