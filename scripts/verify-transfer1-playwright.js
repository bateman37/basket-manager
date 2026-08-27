#!/usr/bin/env node
// scripts/verify-transfer1-playwright.js
// Verificación TRANSFER-1 (DESIGN.md 9.20) contra la interfaz real, sobre
// file:// (sin servidor) — mismo criterio que verify-market1-playwright.js.
// Cubre lo que no puede probarse en Node puro: Mercado > Operaciones,
// el asistente de formalización dentro de Negociaciones (fichaje de
// agente libre y traspaso negociado), y la sección de historial de
// traspasos en la ficha universal.
//
// Ejecutar con:
//   node scripts/verify-transfer1-playwright.js [desktop|mobile]

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

// Abre un hilo, fuerza la respuesta de interés y la aceptación del
// jugador, y crea el AIP — mismo patrón que verify-market1-playwright.js
// (evita depender del muestreo determinista concreto de esta semilla para
// llegar a un AIP vivo, que es el punto de partida real de TRANSFER-1).
async function buildLiveAgreementForPlayer(page, playerId) {
  return page.evaluate((pid) => {
    const { state } = window.BasketManagerGame;
    const BM = window.BasketManager;
    const team = state.leagues[state.division].teams.find((t) => t.id === state.userTeamId);
    const player = state.playerRegistry.get(pid);
    const isoDate = BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
    const seasonKey = BM.seasonKeyFromStartYear(state.seasonStartYear || new Date().getFullYear());
    const marketContext = BM.MarketService.resolveMarketContext({ domesticCompetitionId: 'acb', seasonKey, date: isoDate });
    const thread = BM.MarketService.openInquiry({
      marketRegistry: state.marketRegistry, agentRegistry: state.agentRegistry, playerId: pid, actingClubId: team.id,
      prospectiveCompetitionIds: ['acb'], date: isoDate, marketContext, careerSeed: 'verify-transfer1',
    });
    thread.addEvent({ id: `${thread.id}:forced-confirmed`, type: 'interest-confirmed', date: isoDate });
    state.marketRegistry.markEventProcessed(`${thread.id}:interest-response`);
    const resolved = BM.ContractService.resolveRulesForClub(team, { seasonKey, date: isoDate, operation: 'validateMarketOffer' });
    const employment = resolved.employment;
    const currency = employment.allowedCurrencies[0];
    const seasonKeys = [0, 1, 2, 3].map((i) => BM.LocalDate.seasonKeyFromStartYear(BM.LocalDate.seasonStartYear(seasonKey) + i));
    const firstSeasonStart = BM.LocalDate.seasonWindow(seasonKeys[0]).startDate;
    const startDate = BM.LocalDate.isAfter(isoDate, firstSeasonStart) ? isoDate : firstSeasonStart;
    const endDate = BM.LocalDate.seasonWindow(seasonKeys[seasonKeys.length - 1]).endDate;
    const schedule = [];
    seasonKeys.forEach((sk, index) => {
      const window = BM.LocalDate.seasonWindow(sk);
      const anchorStartDate = index === 0 ? startDate : window.startDate;
      schedule.push(...BM.buildPaymentSchedule({
        totalMinor: 12000000, installmentCount: 8, firstDueDate: BM.LocalDate.endOfMonth(anchorStartDate), frequency: employment.payments.frequency || 'monthly', currency, seasonKey: sk,
      }));
    });
    const draft = {
      playerId: pid, clubId: team.id, signedDate: startDate, startDate, endDate, coveredSeasonKeys: seasonKeys, guaranteeType: 'fully-guaranteed',
      compensation: {
        currency, declaredBasis: 'gross',
        seasons: seasonKeys.map((sk) => ({ seasonKey: sk, guaranteedBaseSalaryMinor: 12000000, guaranteedImageRightsMinor: 0, guaranteedSalaryInKindMinor: 0, signingBonusMinor: 0, variableBonuses: [], nonSalaryBenefits: [], agentCosts: [] })),
      },
      paymentPolicy: { installmentCount: 8, frequency: employment.payments.frequency || 'monthly', scheduledComponents: ['guaranteedBaseSalary', 'guaranteedImageRights'], schedule },
      clauses: [], declaredDocuments: ['written-contract', ...employment.requiredDocuments],
      provenance: { dataSource: 'simulated-market-offer-v1', isReal: false },
    };
    const offer = BM.MarketService.createAndSendOffer({
      marketRegistry: state.marketRegistry, thread, draft, offeredBy: 'club', date: isoDate, careerSeed: 'verify-transfer1', marketContext,
      team, player, playerRegistry: state.playerRegistry, contractRegistry: state.contractRegistry, seasonKey,
    });
    offer.addEvent({ id: `${offer.id}:accept`, type: 'player-accepted', date: isoDate });
    const agreement = BM.MarketService.createAgreementInPrinciple({ marketRegistry: state.marketRegistry, thread, offer, date: isoDate, employmentSnapshot: { profileId: marketContext.bundleId } });
    return { ok: true, agreementId: agreement.id, threadId: thread.id, playerName: player.fullName };
  }, playerId);
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
  // 1. Arrancar carrera ACB, comprobar que Operaciones existe y está
  //    vacía al principio.
  // -------------------------------------------------------------------
  await page.click('#gm-goto-season-btn');
  await pickTeam(page, '1ª', 'team-real-madrid');
  await openMarket(page);
  const tabs = await page.$$eval('#gm-market .tabs__btn', (buttons) => buttons.map((b) => b.textContent.trim()));
  summarize('Existe la pestaña Mercado > Operaciones', tabs.includes('Operaciones'), JSON.stringify(tabs));
  await marketTab(page, 'Operaciones');
  const emptyOpsText = await page.$eval('#gm-market', (el) => el.textContent);
  summarize('Operaciones vacía al principio de la carrera', /Sin expedientes/.test(emptyOpsText));

  // -------------------------------------------------------------------
  // 2-4. Fichaje de agente libre: AIP -> Negociaciones muestra el
  //    asistente -> Formalizar -> roster/contrato/inscripción reales.
  // -------------------------------------------------------------------
  const freeAgentInfo = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    const BM = window.BasketManager;
    const player = state.playerRegistry.all().find((p) => p.teamId === null && p.dataSource === BM.MarketSeeder.SIMULATED_FREE_AGENT_DATA_SOURCE) || null;
    return player ? { id: player.id, fullName: player.fullName } : null;
  });
  summarize('Hay al menos un libre ficticio disponible en el Player Registry', !!freeAgentInfo, JSON.stringify(freeAgentInfo));

  if (freeAgentInfo) {
    const agreement = await buildLiveAgreementForPlayer(page, freeAgentInfo.id);
    summarize('AIP de agente libre construido vía MarketService real', agreement.ok, JSON.stringify(agreement));

    await openMarket(page);
    await marketTab(page, 'Negociaciones');
    await page.waitForTimeout(150);
    const formalizeText = await page.$eval('#gm-market', (el) => el.textContent);
    summarize('El AIP vivo muestra el asistente de formalización (mecanismo derivado)', /Mecanismo:/.test(formalizeText) && /Fichaje de agente libre/.test(formalizeText), formalizeText.slice(0, 300));

    const formalizeBtn = page.locator('.gm-transfer-formalize-btn[data-mechanism="free-agent-signing"]').first();
    const hasFormalizeBtn = await formalizeBtn.count();
    summarize('Botón "Formalizar operación" presente para el fichaje de libre', hasFormalizeBtn === 1);
    if (hasFormalizeBtn) {
      await formalizeBtn.click();
      await page.waitForTimeout(250);
      const afterFormalize2 = await page.evaluate((pid) => {
        const { state } = window.BasketManagerGame;
        const BM = window.BasketManager;
        const team = state.leagues[state.division].teams.find((t) => t.id === state.userTeamId);
        const player = state.playerRegistry.get(pid);
        const isoDate = BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
        return {
          inRoster: !!team.roster.find((p) => p.id === pid),
          teamId: player.teamId,
          hasContract: !!state.contractRegistry.currentForPlayer(pid, isoDate),
        };
      }, freeAgentInfo.id);
      summarize('Tras formalizar, el jugador aparece en el roster real del club', afterFormalize2.inRoster, JSON.stringify(afterFormalize2));
      summarize('Tras formalizar, player.teamId apunta al club', afterFormalize2.teamId === 'team-real-madrid');
      summarize('Tras formalizar, existe un contrato vigente real', afterFormalize2.hasContract);

      // ---------------------------------------------------------------
      // 5. Operaciones ahora muestra el expediente completado.
      // ---------------------------------------------------------------
      await marketTab(page, 'Operaciones');
      const opsText = await page.$eval('#gm-market', (el) => el.textContent);
      summarize('Operaciones muestra el expediente "Completada" tras formalizar', opsText.includes(freeAgentInfo.fullName) && /Completada/.test(opsText), opsText.slice(0, 300));

      // ---------------------------------------------------------------
      // 6. Ficha universal: historial de traspasos del jugador recién
      //    fichado.
      // ---------------------------------------------------------------
      await page.locator('#gm-market .player-link', { hasText: freeAgentInfo.fullName }).first().click();
      await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 20000 });
      await page.click('.player-profile__tabs .tabs__btn:has-text("Mercado y representación")');
      await page.waitForTimeout(150);
      const profileText = await page.$eval('#gm-player-profile', (el) => el.textContent);
      summarize('Ficha universal muestra "Traspasos y liberaciones históricos"', /Traspasos y liberaciones históricos/.test(profileText), profileText.slice(0, 300));
      summarize('Ficha universal NO muestra un expediente activo (ya completado, no queda ninguno vivo)', !/Expediente activo/.test(profileText));
      await page.click('#player-profile-back-btn');
      await page.waitForSelector('#gm-screen-market.is-active', { timeout: 20000 });
    }
  }

  // -------------------------------------------------------------------
  // 7-9. Traspaso negociado: AIP con un jugador YA bajo contrato en otro
  //    club -> el asistente muestra el formulario de oferta club-club ->
  //    enviar hasta que el vendedor CPU acepte (determinista) -> el
  //    traspaso completo mueve al jugador atómicamente.
  // -------------------------------------------------------------------
  const contractedTargetInfo = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    const team = state.leagues[state.division].teams.find((t) => t.id === state.userTeamId);
    const otherTeam = state.leagues[state.division].teams.find((t) => t.id !== team.id && state.contractRegistry.forClub(t.id).length > 0);
    if (!otherTeam) return null;
    const originContract = state.contractRegistry.forClub(otherTeam.id)[0];
    const player = state.playerRegistry.get(originContract.playerId);
    return { playerId: player.id, playerName: player.fullName, originTeamId: otherTeam.id, originTeamName: otherTeam.fullName };
  });
  summarize('Hay un jugador bajo contrato en OTRO club real disponible para el fixture de traspaso negociado', !!contractedTargetInfo, JSON.stringify(contractedTargetInfo));

  if (contractedTargetInfo) {
    const agreement2 = await buildLiveAgreementForPlayer(page, contractedTargetInfo.playerId);
    summarize('AIP de jugador bajo contrato construido vía MarketService real', agreement2.ok, JSON.stringify(agreement2));

    await openMarket(page);
    await marketTab(page, 'Negociaciones');
    await page.waitForTimeout(150);
    const negotiatedText = await page.$eval('#gm-market', (el) => el.textContent);
    summarize('El asistente deriva el mecanismo "Traspaso definitivo negociado"', /Traspaso definitivo negociado/.test(negotiatedText), negotiatedText.slice(0, 300));

    const offerForm = page.locator('.gm-transfer-offer-form').first();
    const hasOfferForm = await offerForm.count();
    summarize('Formulario de oferta club-club presente para el traspaso negociado', hasOfferForm === 1);
    if (hasOfferForm) {
      let completed = false;
      let feeEuros = 300000;
      for (let round = 0; round < 12 && !completed; round += 1) {
        // El campo declara step="1000" (renderAgreementFormalizationHtml) —
        // un valor no múltiplo de 1000 falla la validación nativa del
        // formulario y el navegador bloquea el submit SIN disparar el
        // evento 'submit' (ni error de consola): hay que redondear igual
        // que haría un usuario real.
        feeEuros = Math.round(feeEuros / 1000) * 1000;
        await offerForm.locator('input[name=feeEuros]').fill(String(feeEuros));
        await offerForm.locator('input[name=playerConsent]').check();
        await offerForm.locator('button[type=submit]').click();
        await page.waitForTimeout(200);
        // Un traspaso formalizado con éxito llama a renderMarketScreen(),
        // que RECONSTRUYE la pestaña entera — el formulario/el div de
        // resultado desaparecen del DOM. Se comprueba primero (nunca se
        // lee .textContent() de un elemento que puede haberse desmontado).
        if (!(await offerForm.count())) { completed = true; break; }
        const resultText = await page.locator('.gm-transfer-offer-result').first().textContent();
        if (/acepta/i.test(resultText || '') && !/falta el consentimiento/i.test(resultText || '')) {
          completed = true;
          break;
        }
        const currentValue = await offerForm.locator('input[name=feeEuros]').inputValue().catch(() => null);
        feeEuros = currentValue ? Number(currentValue) * 1.4 : feeEuros * 1.4;
      }
      summarize('La negociación club-club converge y el traspaso se formaliza', completed);
      if (completed) {
        const afterTransfer = await page.evaluate((info) => {
          const { state } = window.BasketManagerGame;
          const BM = window.BasketManager;
          const originTeam = state.leagues[state.division].teams.find((t) => t.id === info.originTeamId) || Object.values(state.leagues).filter(Boolean).flatMap((l) => l.teams).find((t) => t.id === info.originTeamId);
          const destinationTeam = state.leagues[state.division].teams.find((t) => t.id === state.userTeamId);
          const player = state.playerRegistry.get(info.playerId);
          return {
            leftOrigin: originTeam ? !originTeam.roster.find((p) => p.id === info.playerId) : null,
            joinedDestination: !!destinationTeam.roster.find((p) => p.id === info.playerId),
            teamId: player.teamId,
          };
        }, contractedTargetInfo);
        summarize('El jugador sale del roster de origen', afterTransfer.leftOrigin !== false, JSON.stringify(afterTransfer));
        summarize('El jugador entra en el roster del club del usuario', afterTransfer.joinedDestination);
        summarize('player.teamId apunta al club del usuario', afterTransfer.teamId === 'team-real-madrid');
      }
    }
  }

  // -------------------------------------------------------------------
  // 10. Sin scroll horizontal / errores de consola.
  // -------------------------------------------------------------------
  const overflow = await page.evaluate(() => ({ docWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  summarize('La pantalla Mercado no provoca scroll horizontal del documento', overflow.docWidth <= overflow.viewport + 2, `${overflow.docWidth} <= ${overflow.viewport}`);

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
