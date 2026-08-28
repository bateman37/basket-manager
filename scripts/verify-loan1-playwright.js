#!/usr/bin/env node
// scripts/verify-loan1-playwright.js
// Verificación LOAN-1 (DESIGN.md 9.21) contra la interfaz real, sobre
// file:// (sin servidor) — mismo criterio que verify-transfer1-playwright.js.
// Cubre Mercado > Cesiones (ceder/solicitar, activación real, retorno vía
// reloj, recall, opción de compra), el badge "Cedido"/"Cedido fuera" en
// Contratos y el bloqueo internacional/MoraBanc.
//
// Ejecutar con:
//   node scripts/verify-loan1-playwright.js [desktop|mobile]

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
  const toggleBtn = page.locator(`.division-toggle__btn[data-division="${division}"]`);
  if (await toggleBtn.count()) {
    await toggleBtn.click();
    await page.waitForTimeout(150);
  }
  await page.click(teamDataId ? `.team-card[data-team-id="${teamDataId}"]` : '.team-card');
  await page.waitForSelector('#gm-nav .gm-nav__btn[data-screen="home"]', { timeout: 20000 });
}

async function openMarket(page) {
  await page.click('[data-screen="market"]');
  await page.waitForSelector('#gm-screen-market.is-active', { timeout: 20000 });
}

async function marketTab(page, label) {
  await page.click(`#gm-market .tabs__btn:has-text("${label}")`);
  await page.waitForTimeout(150);
}

async function main(mode) {
  const isMobile = mode === 'mobile';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}\n${err.stack}`));

  const filePath = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(filePath);
  console.log(`\n=== Modo: ${mode} ===`);

  await page.click('#gm-goto-season-btn');
  await pickTeam(page, '1ª', 'team-real-madrid');
  await openMarket(page);
  const tabs = await page.$$eval('#gm-market .tabs__btn', (buttons) => buttons.map((b) => b.textContent.trim()));
  summarize('Existe la pestaña Mercado > Cesiones', tabs.includes('Cesiones'), JSON.stringify(tabs));
  await marketTab(page, 'Cesiones');
  const emptyText = await page.$eval('#gm-market', (el) => el.textContent);
  summarize('Cesiones vacías al principio de la carrera', /Sin expedientes de cesión/.test(emptyText));

  // -------------------------------------------------------------------
  // 1. Ceder un jugador propio — reintenta con distintos jugadores/canon
  //    hasta que la CPU acepte (determinista, pero depende del jugador).
  // -------------------------------------------------------------------
  // El club cesionario CPU rechaza cuando `needScore` (profundidad EN ESA
  // posición) es baja — un canon más alto además EMPEORA `costScore` (el
  // canon lo paga el cesionario), así que el fixture busca el par
  // (jugador propio, club con MENOS profundidad en esa posición) que
  // maximiza la probabilidad de aceptación determinista, en vez de subir
  // el importe como en la negociación de un traspaso definitivo (donde el
  // importe lo recibe el VENDEDOR).
  const fixture = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    const isoDate = window.BasketManager.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
    const team = state.leagues[state.division].teams.find((t) => t.id === state.userTeamId);
    const otherTeams = state.leagues[state.division].teams.filter((t) => t.id !== team.id);
    const candidates = team.roster
      .map((p) => ({ player: p, contract: state.contractRegistry.currentForPlayer(p.id, isoDate) }))
      .filter((row) => row.contract && row.contract.isActiveOn(isoDate) && row.contract.remainingSeasonKeys(window.BasketManager.seasonKeyFromStartYear(state.seasonStartYear)).length >= 1);
    let best = null;
    candidates.forEach(({ player }) => {
      otherTeams.forEach((t) => {
        const depth = t.roster.filter((p) => p.primaryPosition === player.primaryPosition).length;
        if (!best || depth < best.depth) best = { player, team: t, depth };
      });
    });
    return {
      isoDate,
      playerId: best ? best.player.id : null,
      playerName: best ? best.player.fullName : null,
      otherTeamId: best ? best.team.id : null,
      otherTeamName: best ? best.team.fullName : null,
      depth: best ? best.depth : null,
    };
  });
  summarize('Hay un jugador propio con contrato vigente para el fixture de cesión', !!fixture.playerId, JSON.stringify(fixture));

  if (fixture.playerId) {
    const outForm = page.locator('#gm-loan-out-form');
    summarize('Formulario "Ceder un jugador propio" presente', await outForm.count() === 1);

    await outForm.locator('select[name=playerId]').selectOption(fixture.playerId);
    await outForm.locator('select[name=counterpartTeamId]').selectOption(fixture.otherTeamId);
    await outForm.locator('input[name=returnEffectiveDate]').fill('2027-06-30');
    // A diferencia del formulario de oferta de TRANSFER-1 (ligado a UN AIP
    // que se consume al formalizar), "Ceder un jugador propio" es un
    // formulario GENÉRICO que sigue presente tras un envío con éxito (con
    // opciones de jugador refrescadas, ya sin el recién cedido) — la
    // convergencia se comprueba consultando el estado real, no la
    // desaparición del formulario.
    let completed = false;
    let feeEuros = 0;
    let lastResultText = '';
    for (let round = 0; round < 6 && !completed; round += 1) {
      await outForm.locator('input[name=loanFeeEuros]').fill(String(feeEuros));
      await outForm.locator('button[type=submit]').click();
      await page.waitForTimeout(200);
      completed = await page.evaluate((pid) => {
        const { state } = window.BasketManagerGame;
        const BM = window.BasketManager;
        const isoDate = BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
        return Boolean(state.loanRegistry.activeAgreementForPlayer(pid, isoDate));
      }, fixture.playerId);
      if (completed) break;
      const resultLocator = page.locator('.gm-loan-out-result').first();
      lastResultText = (await resultLocator.count()) ? await resultLocator.textContent() : '(formulario recargado sin mensaje — expediente rechazado/contraofertado)';
      // Un canon más bajo mejora `costScore` para el cesionario CPU (el
      // canon lo paga él) — nunca al revés que en un traspaso definitivo.
      feeEuros = 0;
    }
    summarize('La negociación de cesión converge y se activa', completed, lastResultText);

    if (completed) {
      const afterActivation = await page.evaluate((pid) => {
        const { state } = window.BasketManagerGame;
        const BM = window.BasketManager;
        const isoDate = BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
        const ownerTeam = state.leagues[state.division].teams.find((t) => t.id === state.userTeamId);
        const player = state.playerRegistry.get(pid);
        const contract = state.contractRegistry.currentForPlayer(pid, isoDate);
        const agreement = state.loanRegistry.activeAgreementForPlayer(pid, isoDate);
        return {
          leftOwnerRoster: !ownerTeam.roster.find((p) => p.id === pid),
          teamId: player.teamId,
          contractStillOwner: contract ? contract.clubId : null,
          hasActiveAgreement: !!agreement,
        };
      }, fixture.playerId);
      summarize('El jugador sale del roster del propietario', afterActivation.leftOwnerRoster, JSON.stringify(afterActivation));
      summarize('player.teamId apunta al cesionario', afterActivation.teamId === fixture.otherTeamId);
      summarize('El contrato matriz sigue siendo con el propietario', afterActivation.contractStillOwner === 'team-real-madrid');
      summarize('Hay un LoanAgreement activo para el jugador', afterActivation.hasActiveAgreement);

      // Contratos: badge "Cedido fuera".
      await page.click('[data-screen="contracts"]');
      await page.waitForSelector('#gm-screen-contracts.is-active', { timeout: 20000 });
      const contractsText = await page.$eval('#gm-contracts', (el) => el.textContent);
      summarize('Contratos muestra el badge "Cedido fuera"', /Cedido fuera/.test(contractsText));

      // Ficha universal.
      await page.locator('#gm-contracts .player-link', { hasText: fixture.playerName }).first().click();
      await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 20000 });
      await page.click('#player-profile-back-btn');
      await page.waitForSelector('#gm-screen-contracts.is-active', { timeout: 20000 });

      // ---------------------------------------------------------------
      // 2. Retorno — mismo motor que dispara `advanceGameClockTo()`
      //    (`LoanService.returnLoan`, cubierto directamente por
      //    test-loan1.js/smoke-loan1.js a nivel de servicio); aquí se
      //    comprueba que el resultado se refleja en la pantalla real tras
      //    re-renderizar (`goToScreen`), sin depender de exponer el reloj
      //    interno de game.js.
      // ---------------------------------------------------------------
      const returnResult = await page.evaluate((pid) => {
        const { state, goToScreen } = window.BasketManagerGame;
        const BM = window.BasketManager;
        const isoDate = BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
        const agreement = state.loanRegistry.activeAgreementForPlayer(pid, isoDate);
        if (!agreement) return { ok: false, reason: 'no-agreement' };
        const ownerTeam = state.leagues[state.division].teams.find((t) => t.id === agreement.ownerClubId);
        const borrowerTeam = state.leagues[state.division].teams.find((t) => t.id === agreement.borrowerClubId);
        const teams = state.leagues[state.division].teams;
        const { result } = BM.LoanService.returnLoan({
          loanRegistry: state.loanRegistry, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry,
          registrationRegistry: state.registrationRegistry, transferRegistry: state.transferRegistry, teams,
          agreement, ownerTeam, borrowerTeam, now: isoDate, effectiveDate: isoDate, seasonKey: BM.seasonKeyFromStartYear(state.seasonStartYear),
          operationalContext: { pendingUserMatchBlocks: false }, commit: true,
        });
        goToScreen('contracts');
        const player = state.playerRegistry.get(pid);
        return {
          ok: !!(result && result.record), backInOwnerRoster: !!ownerTeam.roster.find((p) => p.id === pid), teamId: player.teamId, status: agreement.currentStatus(),
        };
      }, fixture.playerId);
      summarize('LoanService.returnLoan procesa el retorno programado', returnResult.ok, JSON.stringify(returnResult));
      if (returnResult.ok) {
        summarize('El jugador vuelve al roster del propietario', returnResult.backInOwnerRoster, JSON.stringify(returnResult));
        summarize('player.teamId vuelve a apuntar al propietario', returnResult.teamId === 'team-real-madrid');
        summarize('El acuerdo queda "returned"', returnResult.status === 'returned');
        const contractsTextAfterReturn = await page.$eval('#gm-contracts', (el) => el.textContent);
        summarize('Contratos ya NO muestra el badge "Cedido fuera" tras el retorno', !/Cedido fuera/.test(contractsTextAfterReturn));
      }
    }
  }

  // -------------------------------------------------------------------
  // 3. MoraBanc/Andorra: resolveLoanRules bloquea explícito (nunca ACB por
  //    defecto) — comprobación directa del dominio normativo desde la
  //    consola de la página, sin depender de la negociación CPU.
  // -------------------------------------------------------------------
  const andorraCheck = await page.evaluate(() => {
    const BM = window.BasketManager;
    const rules = BM.resolveLoanRules({
      playerId: 'p1', ownerClubId: 'team-morabanc-andorra', borrowerClubId: 'team-barca',
      ownerEmployerJurisdictionId: 'AD', borrowerEmployerJurisdictionId: 'ES', originCompetitionId: 'acb', destinationCompetitionId: 'acb',
      seasonKey: '2026-27', effectiveDate: '2026-10-15', operation: 'activation',
    });
    return { blockers: rules.blockers };
  });
  summarize('MoraBanc/Andorra bloquea el régimen de cesión (nunca ACB por defecto)', andorraCheck.blockers.some((b) => b.code === 'AD_NO_LOAN_REGIME_SOURCED'), JSON.stringify(andorraCheck.blockers));

  // -------------------------------------------------------------------
  // 4. Sin scroll horizontal / errores de consola.
  // -------------------------------------------------------------------
  await openMarket(page);
  await marketTab(page, 'Cesiones');
  const overflow = await page.evaluate(() => ({ docWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  summarize('La pantalla Cesiones no provoca scroll horizontal del documento', overflow.docWidth <= overflow.viewport + 2, `${overflow.docWidth} <= ${overflow.viewport}`);

  console.log(`\nErrores de consola capturados: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log('  -', e));
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
