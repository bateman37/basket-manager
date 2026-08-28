#!/usr/bin/env node
// scripts/verify-cycle1-playwright.js
// Verificación CYCLE-1 (DESIGN.md 9.22) contra la interfaz real, sobre
// file:// (sin servidor) — mismo criterio que verify-loan1-playwright.js.
// Cubre la pantalla "Planificación" (fase/fecha/deadlines, renovación real,
// academia, retiradas, legalidad), el cierre de temporada que abre el ciclo
// (nunca la siguiente liga directamente) y ausencia de scroll horizontal /
// excepciones de consola, en escritorio y móvil.
//
// El avance de temporada completa (34 jornadas + Copa + playoffs) se hace
// llamando repetidamente a `simulateNextRound()` vía `page.evaluate` — la
// MISMA función que ya usa la interfaz real al pulsar "Continuar" — nunca
// fabricando un estado de UI aparte ni llamando a servicios de dominio
// directamente para fingir una pantalla.
//
// Ejecutar con:
//   node scripts/verify-cycle1-playwright.js [desktop|mobile]

const path = require('path');
const { chromium } = require('playwright');

const consoleErrors = [];
let failures = 0;

function summarize(label, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
}

async function pickTeam(page, teamDataId) {
  await page.waitForSelector('.team-card', { timeout: 20000 });
  await page.click(`.team-card[data-team-id="${teamDataId}"]`);
  await page.waitForSelector('#gm-nav .gm-nav__btn[data-screen="home"]', { timeout: 20000 });
}

// Avanza la temporada REGULAR + Copa/playoffs de AMBAS divisiones hasta que
// quede lista para cerrar. Usa el MISMO motor de producción que ya resuelve
// la división de fondo de golpe (`simulateBackgroundRound`/
// `drainBackgroundBrackets`, DESIGN.md 3.4.1) para las 36 plantillas —
// nunca un resolver de prueba aparte ni lineups vacíos.
async function fastForwardSeasonToClose(page, maxRounds) {
  return page.evaluate((max) => {
    const {
      state, simulateNextRound, simulateBackgroundRound, drainBackgroundBrackets, getLeague, getBrackets, buildCpuOnlyResolver,
    } = window.BasketManagerGame;
    const otherDivision = state.division === '1ª' ? '2ª' : '1ª';
    let rounds = 0;
    while (rounds < max) {
      const userLeague = getLeague(state.division);
      const otherLeague = getLeague(otherDivision);
      const bothComplete = userLeague.isSeasonComplete && otherLeague.isSeasonComplete;
      if (!bothComplete) {
        if (!userLeague.isSeasonComplete) {
          simulateNextRound();
          state.pendingUserMatch = null;
          state.matchReveal = null;
        }
        if (!otherLeague.isSeasonComplete) simulateBackgroundRound(otherDivision);
        rounds += 1;
        continue;
      }
      // Ligas regulares completas en ambas divisiones: drena Copa/playoffs
      // de la división de fondo (ya automático en producción) y de la
      // división visible (normalmente un click de usuario por partido —
      // aquí se agota de golpe con el MISMO resolver real).
      drainBackgroundBrackets(otherDivision, buildCpuOnlyResolver(otherLeague));
      drainBackgroundBrackets(state.division, buildCpuOnlyResolver(userLeague));
      break;
    }
    const brackets = getBrackets(state.division);
    const otherBrackets = getBrackets(otherDivision);
    const allBracketsDone = ['cup', 'titlePlayoff', 'promotionPlayoff'].every((key) => (
      (!brackets[key] || brackets[key].isComplete) && (!otherBrackets[key] || otherBrackets[key].isComplete)
    ));
    return {
      rounds, seasonComplete: getLeague(state.division).isSeasonComplete && getLeague(otherDivision).isSeasonComplete, allBracketsDone,
    };
  }, maxRounds);
}

async function main(mode) {
  const isMobile = mode === 'mobile';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}\n${err.stack}`));

  const filePath = `file://${path.resolve(__dirname, '..', 'index.html')}`;
  await page.goto(filePath);
  console.log(`\n=== Modo: ${mode} ===`);

  await page.click('#gm-goto-season-btn');
  await pickTeam(page, 'team-real-madrid');

  // -------------------------------------------------------------------
  // 1. Planificación: fase/fecha visibles al arrancar la carrera.
  // -------------------------------------------------------------------
  await page.click('[data-screen="cycle"]');
  await page.waitForSelector('#gm-screen-cycle.is-active', { timeout: 20000 });
  const initialText = await page.evaluate(() => document.getElementById('gm-cycle').textContent);
  summarize('Existe la pantalla "Planificación" y muestra fase/fecha del mundo', /Fase:/.test(initialText) && /Fecha del mundo/.test(initialText));
  summarize('La pantalla "Planificación" muestra el estado de legalidad de la plantilla', /Legalidad de la plantilla/.test(initialText));

  // -------------------------------------------------------------------
  // 2. Cerrar temporada abre el CICLO — nunca la siguiente liga directa.
  // -------------------------------------------------------------------
  const seasonKeyBefore = await page.evaluate(() => window.BasketManagerGame.state.seasonStartYear);
  const ffResult = await fastForwardSeasonToClose(page, 40);
  console.log(`   (avance de temporada: ${ffResult.rounds} rondas simuladas, liga completa=${ffResult.seasonComplete}, brackets completos=${ffResult.allBracketsDone})`);

  await page.click('[data-screen="home"]');
  await page.waitForTimeout(200);
  const closeBtn = page.locator('#gm-close-season-btn');
  const closeBtnVisible = await closeBtn.count() > 0;
  summarize('Al terminar liga+Copa+playoffs, Home ofrece "Cerrar temporada"', closeBtnVisible);
  if (closeBtnVisible) {
    await closeBtn.click();
    await page.waitForTimeout(300);
    const afterClose = await page.evaluate(() => ({
      screen: window.BasketManagerGame.state.screen,
      seasonStartYear: window.BasketManagerGame.state.seasonStartYear,
      hasCycle: Boolean(window.BasketManagerGame.state.annualCycle) || Boolean((window.BasketManagerGame.state.cycleLastTransition || {}).phaseResults),
      warnings: window.BasketManagerGame.state.cycleWarnings || [],
    }));
    summarize(
      'Cerrar temporada NO salta directo a la siguiente liga sin pasar por el ciclo real',
      afterClose.hasCycle,
      `screen=${afterClose.screen}`,
    );
    // Invariante 26 (nunca empezar con un club ilegal): el ciclo puede
    // completar de golpe (año avanza, vuelve a Home) O detenerse con
    // diagnóstico claro si algún club (nunca "silenciosamente") no puede
    // construir un acta legal — ambos son resultados correctos; lo único
    // inaceptable sería avanzar el año SIN completar o quedarse sin avisar.
    const seasonAdvanced = afterClose.seasonStartYear === seasonKeyBefore + 1;
    const pausedWithDiagnostic = afterClose.screen === 'cycle' && afterClose.warnings.length > 0;
    summarize(
      'El ciclo completa (año avanza) o se detiene con diagnóstico claro — nunca en silencio',
      seasonAdvanced || pausedWithDiagnostic,
      seasonAdvanced ? 'completado' : `pausado: ${afterClose.warnings[0]}`,
    );
  }

  // -------------------------------------------------------------------
  // 3. Contratos que vencen + renovación real desde Planificación.
  // -------------------------------------------------------------------
  await page.click('[data-screen="cycle"]');
  await page.waitForTimeout(300);
  // Fixture determinista: fuerza un contrato a estar dentro de la ventana
  // de renovación (mismo criterio que test-cycle1.js) para poder pulsar
  // el botón real "Proponer renovación".
  const renewalFixture = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    const BM = window.BasketManager;
    const team = state.playerRegistry ? null : null;
    const userTeam = window.BasketManagerGame.getUserTeam();
    const contract = state.contractRegistry.forClub(userTeam.id).find((c) => c.isCurrentOn(BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime)));
    if (!contract) return { ok: false };
    contract.endDate = BM.LocalDate.addDays(BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime), 60);
    return { ok: true, playerId: contract.playerId };
  });
  summarize('Fixture: un contrato queda dentro de ventana de renovación', renewalFixture.ok);
  await page.evaluate(() => { window.BasketManagerGame.state.screen = null; });
  await page.click('[data-screen="cycle"]');
  await page.waitForTimeout(200);
  const renewBtn = page.locator('.cycle-renew-btn').first();
  const renewBtnPresent = await renewBtn.count() > 0;
  summarize('Contratos que vencen muestra la acción real "Proponer renovación"', renewBtnPresent);
  if (renewBtnPresent) {
    page.once('dialog', (dialog) => dialog.accept());
    await renewBtn.click();
    await page.waitForTimeout(300);
    const postRenewal = await page.evaluate((pid) => {
      const { state } = window.BasketManagerGame;
      const contracts = state.contractRegistry.forPlayer(pid);
      return contracts.length;
    }, renewalFixture.playerId);
    summarize('Tras negociar, el jugador tiene contrato(s) reales registrados', postRenewal >= 1, `contratos=${postRenewal}`);
  }

  // -------------------------------------------------------------------
  // 4. Academia separada del roster senior.
  // -------------------------------------------------------------------
  const academyFixture = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    const BM = window.BasketManager;
    const userTeam = window.BasketManagerGame.getUserTeam();
    if (!state.academyRegistry) return { ok: false };
    const isoDate = BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
    const seasonKey = state.leagues && state.division ? null : null;
    const cycle = { id: `verify-fixture:${isoDate}` };
    const seasonKeyReal = BM.seasonKeyFromStartYear(state.seasonStartYear);
    const result = BM.AcademyService.runAnnualIntake({
      academyRegistry: state.academyRegistry, playerRegistry: state.playerRegistry, team: userTeam, cycle,
      date: isoDate, seasonKey: seasonKeyReal, config: BM.CONFIG_BASE, careerSeed: 'verify-cycle1-playwright',
    });
    void seasonKey;
    return { ok: true, created: result.created.length, rosterHasNew: result.created.some(({ player }) => userTeam.roster.some((p) => p.id === player.id)) };
  });
  summarize('Fixture: intake real de academia para el club del usuario', academyFixture.ok && academyFixture.created >= 0);
  summarize('Un miembro de academia NUNCA entra en Team.roster por el intake', academyFixture.ok ? !academyFixture.rosterHasNew : true);
  await page.click('[data-screen="cycle"]');
  await page.waitForTimeout(200);
  const academyText = await page.evaluate(() => document.getElementById('gm-cycle').textContent);
  summarize('La pantalla Academia muestra el pool separado del primer equipo', /Academia/.test(academyText));
  const promoteBtn = page.locator('.cycle-promote-btn').first();
  if (await promoteBtn.count() > 0) {
    const playerId = await promoteBtn.getAttribute('data-player-id');
    page.once('dialog', (dialog) => dialog.accept());
    await promoteBtn.click();
    await page.waitForTimeout(300);
    const promoted = await page.evaluate((pid) => {
      const userTeam = window.BasketManagerGame.getUserTeam();
      return userTeam.roster.some((p) => p.id === pid);
    }, playerId);
    summarize('Promocionar desde Academia SÍ añade al roster real del primer equipo', promoted);
    const badgeCheck = await page.evaluate((pid) => {
      const player = window.BasketManagerGame.state.playerRegistry.get(pid);
      return player ? player.dataSource : null;
    }, playerId);
    summarize('El jugador promocionado conserva su procedencia (dataSource) simulada visible', typeof badgeCheck === 'string');
  }

  // -------------------------------------------------------------------
  // 5. Retirado no aparece como fichable / sigue localizable.
  // -------------------------------------------------------------------
  const retirementFixture = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    const BM = window.BasketManager;
    const userTeam = window.BasketManagerGame.getUserTeam();
    const player = userTeam.roster[userTeam.roster.length - 1];
    if (!player) return { ok: false };
    const isoDate = BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
    const cycle = { id: `verify-retire-fixture:${isoDate}` };
    const announcement = BM.RetirementService.announceRetirement({
      annualCycleRegistry: state.annualCycleRegistry, cycle, player, clubId: userTeam.id, date: isoDate,
      currentContract: state.contractRegistry.currentForPlayer(player.id, isoDate), reasons: ['fixture de verificación'], forced: false,
    });
    const record = BM.RetirementService.commitRetirement({
      annualCycleRegistry: state.annualCycleRegistry, academyRegistry: state.academyRegistry, playerRegistry: state.playerRegistry,
      contractRegistry: state.contractRegistry, registrationRegistry: state.registrationRegistry, marketRegistry: state.marketRegistry,
      loanRegistry: state.loanRegistry, teams: [...state.leagues['1ª'].teams, ...state.leagues['2ª'].teams],
      announcement, date: announcement.effectiveDate, seasonKey: BM.seasonKeyFromStartYear(state.seasonStartYear), lineup: state.lineup, cycleId: cycle.id,
    });
    return {
      ok: true, playerId: player.id, committed: Boolean(record.record),
      stillInRegistry: Boolean(state.playerRegistry.get(player.id)),
      stillOnRoster: userTeam.roster.some((p) => p.id === player.id),
    };
  });
  summarize('Fixture: retirada anunciada y efectiva vía servicios reales', retirementFixture.ok && retirementFixture.committed);
  summarize('Un jugador retirado sigue en el Player Registry (localizable)', retirementFixture.ok ? retirementFixture.stillInRegistry : false);
  summarize('Un jugador retirado sale del roster (ya no fichable/convocable)', retirementFixture.ok ? !retirementFixture.stillOnRoster : false);

  // -------------------------------------------------------------------
  // 6. Sin exposición de hidden.*/PA/utilidad exacta en el DOM.
  // -------------------------------------------------------------------
  await page.click('[data-screen="cycle"]');
  await page.waitForTimeout(200);
  const cycleFullText = await page.evaluate(() => document.getElementById('gm-cycle').innerHTML);
  const leaksHidden = /hidden\.(potential|ambition|professionalism)/.test(cycleFullText);
  summarize('La pantalla Planificación nunca expone hidden.*/Potencial/Ambición en su HTML', !leaksHidden);

  // -------------------------------------------------------------------
  // 7. Sin scroll horizontal / errores de consola.
  // -------------------------------------------------------------------
  const overflow = await page.evaluate(() => ({ docWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  summarize('La pantalla Planificación no provoca scroll horizontal del documento', overflow.docWidth <= overflow.viewport + 2, `${overflow.docWidth} <= ${overflow.viewport}`);

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
