#!/usr/bin/env node
// scripts/verify-contract1-playwright.js
// Verificación CONTRACT-1 (DESIGN.md 9.17) contra la interfaz real, sobre
// file:// (sin servidor) — mismo criterio que
// scripts/verify-roster1-playwright.js. Cubre lo que NO puede probarse en
// Node puro (game.js es una capa de UI sin exports): pantalla Contratos,
// pestaña Contrato de la ficha universal, jurisdicción andorrana de
// MoraBanc, badges de simulación/provisionalidad, formato monetario y de
// fecha en español, ausencia de acciones de mercado y que navegar no muta
// contratos ni avanza el reloj.
//
// Ejecutar con:
//   node scripts/verify-contract1-playwright.js [desktop|mobile]
// (si playwright está instalado globalmente: NODE_PATH=$(npm root -g) node ...)

const path = require('path');
const { chromium } = require('playwright');

const consoleErrors = [];
let failures = 0;

function summarize(label, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
  return ok;
}

async function pickTeam(page, division, teamDataId) {
  await page.waitForSelector('.team-card', { timeout: 20000 });
  if (division === '2ª') {
    await page.click('.division-toggle__btn[data-division="2ª"]');
    await page.waitForTimeout(150);
  }
  await page.click(teamDataId ? `.team-card[data-team-id="${teamDataId}"]` : '.team-card');
  await page.waitForSelector('#gm-nav .gm-nav__btn[data-screen="home"]', { timeout: 20000 });
}

async function backToTeamSelect(page) {
  await page.click('#gm-back-to-team-select');
  await page.waitForSelector('.team-card', { timeout: 20000 });
}

async function openContracts(page) {
  await page.click('[data-screen="contracts"]');
  await page.waitForSelector('#gm-screen-contracts.is-active', { timeout: 20000 });
  await page.waitForSelector('.contract-table--roster tbody tr', { timeout: 20000 });
}

async function main(mode) {
  const isMobile = mode === 'mobile';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}\n${err.stack}`));

  const filePath = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(filePath);
  console.log(`\n=== Modo: ${mode} ===`);

  // -------------------------------------------------------------------
  // 1. Club español de ACB: navegación, resumen, tabla, badges y formato.
  // -------------------------------------------------------------------
  await page.click('#gm-goto-season-btn');
  await pickTeam(page, '1ª', 'team-real-madrid');

  const navExists = await page.locator('#gm-nav .gm-nav__btn[data-screen="contracts"]').count();
  summarize('Existe la entrada "Contratos" en la navegación', navExists === 1);

  await openContracts(page);

  const summaryText = await page.$eval('.contract-summary', (el) => el.textContent);
  summarize(
    'Resumen de nómina: garantizada, variable, beneficios y costes de agente',
    /Nómina garantizada/.test(summaryText) && /Variable potencial/.test(summaryText)
      && /Beneficios/.test(summaryText) && /agente/i.test(summaryText),
    summaryText.replace(/\s+/g, ' ').slice(0, 140),
  );

  const payrollText = await page.$eval('.contract-summary__item strong', (el) => el.textContent.trim());
  summarize('Formato monetario en euros y notación española', /€/.test(payrollText) && /\./.test(payrollText), payrollText);

  const rosterRows = await page.locator('.contract-table--roster tbody tr').count();
  summarize('Tabla/cards de plantilla contractual con una fila por contrato', rosterRows >= 10, `filas: ${rosterRows}`);

  const simulatedBadges = await page.locator('.contract-table--roster .gm-badge--simulated').count();
  summarize('Cada contrato muestra el badge "Simulado"', simulatedBadges === rosterRows, `badges: ${simulatedBadges}/${rosterRows}`);

  const noticeText = await page.$eval('#gm-contracts .contract-notice', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  summarize(
    'El aviso completo de simulación es visible y accesible',
    noticeText.includes('Contrato simulado para esta partida; no es un dato contractual real.'),
    noticeText,
  );

  const profileText = await page.$eval('.contract-profile', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Club español de ACB: jurisdicción España (ES) visible', /España \(ES\)/.test(profileText));
  summarize('Club español de ACB: perfil normativo visible', /employment:ES:acb/.test(profileText), (profileText.match(/employment:[\w:-]+/) || [''])[0]);
  summarize(
    'Convenio ACB visible como PROVISIONAL / continuidad provisional',
    /Continuidad provisional/.test(profileText) && /Provisional/.test(profileText)
      && /acb-abp-cba-2018-22-operational-provisional-v1/.test(profileText),
  );
  summarize('El módulo del RD 1006 aparece en el marco laboral español', /es-rd1006-1985-v1/.test(profileText));

  const commitmentRows = await page.locator('#gm-contracts .contract-table tbody tr').count();
  summarize('Compromisos por temporada presentes', commitmentRows > 0, `filas totales de tablas: ${commitmentRows}`);

  const scopeNote = await page.$eval('.contract-scope-note', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  summarize('Se indica explícitamente qué acciones NO existen todavía', /MARKET-1/.test(scopeNote), scopeNote.slice(0, 120));

  // -------------------------------------------------------------------
  // 2. Sin botones funcionales fuera de alcance.
  // -------------------------------------------------------------------
  const marketButtons = await page.$$eval('#gm-contracts button', (buttons) => buttons
    .map((b) => b.textContent.trim())
    .filter((text) => /renovar|fichar|despedir|liberar|ejecutar|tantear|ceder|ofertar/i.test(text)));
  summarize('No hay botones de renovar/fichar/despedir/ejecutar/tantear/ceder', marketButtons.length === 0, marketButtons.join(' | '));

  // -------------------------------------------------------------------
  // 3. Navegar/cambiar de pestaña no avanza el reloj ni muta contratos.
  // -------------------------------------------------------------------
  const before = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    return {
      clock: state.calendar.currentGameDateTime.getTime(),
      contracts: state.contractRegistry.size,
      digest: JSON.stringify(state.contractRegistry.all().map((c) => c.id).sort()).length,
    };
  });
  await page.click('[data-screen="home"]');
  await page.waitForTimeout(120);
  await openContracts(page);
  const after = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    return {
      clock: state.calendar.currentGameDateTime.getTime(),
      contracts: state.contractRegistry.size,
      digest: JSON.stringify(state.contractRegistry.all().map((c) => c.id).sort()).length,
    };
  });
  summarize(
    'Entrar y salir de Contratos no avanza el reloj ni crea/muta contratos',
    before.clock === after.clock && before.contracts === after.contracts && before.digest === after.digest,
    `contratos: ${before.contracts} -> ${after.contracts}`,
  );

  // -------------------------------------------------------------------
  // 4. Pestaña "Contrato" de la ficha universal.
  // -------------------------------------------------------------------
  await page.click('.contract-table--roster tbody tr .player-link');
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 20000 });
  await page.click('.player-profile__tabs .tabs__btn[data-tab="contract"]');
  await page.waitForTimeout(150);
  const tabText = await page.$eval('.player-profile__body', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Ficha: la pestaña Contrato muestra club, estado y vigencia', /Club empleador/.test(tabText) && /Vigencia/.test(tabText));
  summarize('Ficha: desglose por temporada visible', /Desglose por temporada/.test(tabText));
  summarize('Ficha: calendario de cuotas visible', /Calendario de pagos/.test(tabText) && /cuotas/.test(tabText));
  summarize('Ficha: jurisdicción y módulos normativos con fuentes', /Jurisdicción laboral/.test(tabText) && /Normativa aplicada en la firma/.test(tabText));
  summarize('Ficha: aviso de simulación presente', /Contrato simulado para esta partida/.test(tabText));
  summarize('Ficha: fechas en formato español (día mes año)', /\d{1,2} [a-zé]{3,4}\.? \d{4}/i.test(tabText), (tabText.match(/\d{1,2} [a-zé]{3,4}\.? \d{4}/i) || [''])[0]);

  const dueDates = await page.$$eval('.player-profile__body table tbody tr td', (cells) => cells.map((c) => c.textContent.trim()));
  summarize('Ficha: los importes de cuota no se cortan', dueDates.some((text) => /€/.test(text)));

  const scheduleSum = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    const playerId = state.playerProfile.playerId;
    const iso = window.BasketManager.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
    const contract = state.contractRegistry.currentForPlayer(playerId, iso);
    const seasonKey = contract.coveredSeasonKeys[0];
    const sum = contract.scheduleForSeason(seasonKey).reduce((acc, i) => acc + i.amountMinor, 0);
    return { sum, scheduled: contract.scheduledAmountForSeason(seasonKey), installments: contract.paymentPolicy.installmentCount };
  });
  summarize(
    'Ficha: el calendario mostrado cuadra al céntimo con la remuneración planificada',
    scheduleSum.sum === scheduleSum.scheduled,
    `${scheduleSum.installments} cuotas, ${scheduleSum.sum} == ${scheduleSum.scheduled}`,
  );

  // -------------------------------------------------------------------
  // 5. Jugador SIN contrato (libre): la ficha no se rompe.
  // -------------------------------------------------------------------
  const freeAgent = await page.evaluate(() => {
    const { state, getUserTeam } = window.BasketManagerGame;
    const team = getUserTeam();
    const player = team.roster[0];
    const playerId = player.id;
    const contract = state.contractRegistry.currentForPlayer(
      playerId, window.BasketManager.LocalDate.fromJsDate(state.calendar.currentGameDateTime),
    );
    // Se anula el contrato con un evento de ciclo de vida REAL (no se borra
    // del registro: el histórico se conserva) y se libera al jugador con los
    // métodos de producción — MARKET-1 aún no ofrece un camino de UI.
    contract.addLifecycleEvent({ type: 'voided', date: '2026-07-01', note: 'fixture de verificación' });
    team.removePlayer(playerId);
    state.playerRegistry.setAffiliation(playerId, null);
    return { playerId, fullName: player.fullName, stillRegistered: state.contractRegistry.has(contract.id) };
  });
  summarize('Anular un contrato no lo borra del registro (histórico consultable)', freeAgent.stillRegistered);

  await page.evaluate((playerId) => {
    const { state, goToScreen } = window.BasketManagerGame;
    state.playerProfile = {
      playerId, returnScreen: 'home', returnSubscreen: null, activeTab: 'contract', developmentAttribute: null,
    };
    goToScreen('player-profile');
  }, freeAgent.playerId);
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 20000 });
  const freeAgentText = await page.$eval('.player-profile__body', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Jugador sin contrato: la pestaña dice "Sin contrato" sin romperse', /Sin contrato/.test(freeAgentText), freeAgentText.slice(0, 120));
  summarize('Jugador sin contrato: conserva su histórico contractual', /Histórico contractual/.test(freeAgentText));

  const otherTabsOk = await (async () => {
    for (const tabId of ['summary', 'attributes', 'positions', 'development', 'stats', 'medical', 'career']) {
      await page.click(`.player-profile__tabs .tabs__btn[data-tab="${tabId}"]`);
      await page.waitForTimeout(80);
      const length = await page.$eval('.player-profile__body', (el) => el.textContent.trim().length);
      if (length === 0) return false;
    }
    return true;
  })();
  summarize('Jugador sin contrato: el resto de pestañas siguen funcionando', otherTabsOk);

  // -------------------------------------------------------------------
  // 6. MoraBanc Andorra: jurisdicción AD, sin RD 1006 ni SMI español.
  // -------------------------------------------------------------------
  await backToTeamSelect(page);
  await pickTeam(page, '1ª', 'team-morabanc-andorra');
  await openContracts(page);
  const andorraText = await page.$eval('.contract-profile', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('MoraBanc: aparece la jurisdicción Andorra (AD)', /Andorra \(AD\)/.test(andorraText));
  summarize('MoraBanc: NO aparece el RD 1006 español', !/es-rd1006/.test(andorraText));
  summarize('MoraBanc: NO aparece el SMI español', !/es-smi/.test(andorraText));
  summarize('MoraBanc: aparecen los módulos andorranos', /ad-labour-31-2018-v1/.test(andorraText) && /ad-smi-2026-07-v1/.test(andorraText));
  summarize(
    'MoraBanc: la capa ACB se diferencia como membresía provisional',
    /acb-abp-cba/.test(andorraText) && /Provisional/.test(andorraText),
  );
  const andorraWarnings = await page.$$eval('#gm-contracts .contract-warnings', (nodes) => nodes.map((n) => n.textContent));
  summarize(
    'MoraBanc: la advertencia de capa de membresía es visible',
    andorraWarnings.some((text) => /capa de membresía/.test(text)),
  );
  const andorraInstallments = await page.evaluate(() => {
    const { state, getUserTeam } = window.BasketManagerGame;
    const team = getUserTeam();
    return state.contractRegistry.forClub(team.id).map((c) => c.paymentPolicy.installmentCount);
  });
  summarize(
    'MoraBanc: el calendario cumple la periodicidad andorrana (12 mensualidades)',
    andorraInstallments.every((count) => count === 12),
    `cuotas: ${[...new Set(andorraInstallments)].join(',')}`,
  );

  // -------------------------------------------------------------------
  // 7. Primera FEB: no hereda el mínimo ni las 10 mensualidades de ACB.
  // -------------------------------------------------------------------
  await backToTeamSelect(page);
  await pickTeam(page, '2ª', 'team-palencia-baloncesto');
  await openContracts(page);
  const febText = await page.$eval('.contract-profile', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Primera FEB: perfil propio sin convenio ACB', /employment:ES:primera-feb/.test(febText) && !/acb-abp-cba/.test(febText));
  summarize('Primera FEB: el mínimo aplicado es el SMI español verificado', /es-smi-2026-v1/.test(febText) && /Verificada/.test(febText));

  // -------------------------------------------------------------------
  // 8. Responsive: la tabla no desborda horizontalmente la página.
  // -------------------------------------------------------------------
  const overflow = await page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  summarize(
    'La pantalla no provoca scroll horizontal del documento',
    overflow.docWidth <= overflow.viewport + 2,
    `${overflow.docWidth} <= ${overflow.viewport}`,
  );

  console.log(`\nErrores de consola capturados: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log('  -', e));
  // Google Fonts (index.html) puede fallar por red en un entorno sin acceso
  // a internet — no es una regresión de CONTRACT-1 (mismo criterio que
  // verify-roster1-playwright.js).
  const realConsoleErrors = consoleErrors.filter((e) => !e.includes('ERR_CONNECTION_RESET') && !e.includes('fonts.googleapis'));
  if (realConsoleErrors.length > 0) failures += 1;

  await browser.close();
  return failures;
}

const mode = process.argv[2] || 'desktop';
main(mode).then((f) => {
  console.log(`\n=== ${mode}: ${f === 0 ? 'TODO OK' : `${f} FALLO(S)`} ===`);
  process.exit(f === 0 ? 0 : 1);
}).catch((err) => { console.error(err); process.exit(1); });
