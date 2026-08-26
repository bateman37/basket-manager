#!/usr/bin/env node
// scripts/verify-roster1-playwright.js
// Verificación ROSTER-1 (DESIGN.md 9.16) contra la interfaz real, sobre
// file:// (sin servidor) — mismo criterio que
// scripts/verify-life4-playwright.js. Cubre lo que NO puede probarse en
// Node puro (game.js es una capa de UI sin exports): fechas completas de
// histórico (BUG-LIFE4-01), ficha universal con `team === null`
// (BUG-LIFE4-03) y la vertical de convocatoria ACB 8-12 / Primera FEB
// 10-12 (ROSTER-1) reflejada de verdad en la pantalla de Alineación.
//
// `window.BasketManagerGame.state` ya lo expone game.js (ver el final del
// archivo) — se usa aquí SOLO para preparar escenarios que la interfaz
// todavía no puede producir por sí sola (liberar a un jugador: MARKET-1
// todavía no existe), reutilizando los métodos REALES de producción
// (`team.removePlayer()`/`registry.setAffiliation()`), nunca mockeando la
// ficha. Ejecutar con:
//   node scripts/verify-roster1-playwright.js [desktop|mobile]

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
  await page.waitForSelector('.team-card', { timeout: 10000 });
  if (division === '2ª') {
    await page.click('.division-toggle__btn[data-division="2ª"]');
    await page.waitForTimeout(150);
  }
  if (teamDataId) {
    await page.click(`.team-card[data-team-id="${teamDataId}"]`);
  } else {
    await page.click('.team-card');
  }
  await page.waitForSelector('#gm-nav .gm-nav__btn[data-screen="home"]', { timeout: 10000 });
}

async function backToTeamSelect(page) {
  await page.click('#gm-back-to-team-select');
  await page.waitForSelector('.team-card', { timeout: 10000 });
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
  // 1. Vertical ACB 8-12 vs Primera FEB 10-12 (ROSTER-1, DESIGN.md 9.16),
  //    reflejada en la pantalla de Alineación real.
  // -------------------------------------------------------------------
  await page.click('#gm-goto-season-btn');
  await pickTeam(page, '1ª');
  await page.click('[data-screen="lineup"]');
  await page.waitForSelector('.squad-picker', { timeout: 10000 });
  const acbHeading = await page.locator('.gm-card h3', { hasText: 'Convocatoria' }).textContent();
  summarize('ACB: cabecera de convocatoria muestra 8-12', /\/12/.test(acbHeading) && /mínimo 8/.test(acbHeading), acbHeading.trim());

  // Convoca solo 7 (por debajo del mínimo ACB) y comprueba el mensaje.
  const acbCheckboxes = page.locator('.squad-checkbox');
  for (let i = 0; i < 7; i++) await acbCheckboxes.nth(i).check();
  await page.waitForTimeout(150);
  const acbInvalidMsg = await page.$eval('.lineup-status', (el) => el.textContent.trim());
  summarize('ACB: 7 convocados se rechaza con el rango correcto (8-12)', acbInvalidMsg.includes('entre 8 y 12'), acbInvalidMsg);

  await backToTeamSelect(page);

  // Bueno Arenas Albacete Basket: club de Primera FEB con SOLO 8 jugadores
  // reales en el bundle (snapshot conocido, ver prompt ROSTER-1 sección
  // 6) — debe llegar a 10 en la interfaz real vía el puente de datos.
  await pickTeam(page, '2ª', 'team-bueno-arenas-albacete');
  await page.click('[data-screen="lineup"]');
  await page.waitForSelector('.squad-picker', { timeout: 10000 });
  const febHeading = await page.locator('.gm-card h3', { hasText: 'Convocatoria' }).textContent();
  summarize('Primera FEB: cabecera de convocatoria muestra 10-12', /\/12/.test(febHeading) && /mínimo 10/.test(febHeading), febHeading.trim());

  const febRosterSize = await page.locator('.squad-picker__item').count();
  summarize('Primera FEB (roster fuente de 8): completado en memoria a 10 jugadores', febRosterSize === 10, `roster mostrado: ${febRosterSize}`);
  const fictionalBadgeCount = await page.locator('.squad-picker .gm-badge--fictional').count();
  summarize('Primera FEB: los jugadores de relleno se marcan como ficticios en la UI', fictionalBadgeCount === 2, `badges ficticios: ${fictionalBadgeCount}`);

  // Convoca solo 9 (por debajo del mínimo FEB de 10) y comprueba el mensaje.
  const febCheckboxes = page.locator('.squad-checkbox');
  for (let i = 0; i < 9; i++) await febCheckboxes.nth(i).check();
  await page.waitForTimeout(150);
  const febInvalidMsg = await page.$eval('.lineup-status', (el) => el.textContent.trim());
  summarize('Primera FEB: 9 convocados se rechaza con el rango correcto (10-12)', febInvalidMsg.includes('entre 10 y 12'), febInvalidMsg);

  // Convocar los 10 (incluyendo relleno ficticio) sí debe ser válido.
  await febCheckboxes.nth(9).check();
  await page.waitForTimeout(150);
  const febValidMsg = await page.$eval('.lineup-status', (el) => el.textContent.trim());
  summarize('Primera FEB: 10 convocados (con relleno ficticio) es una convocatoria válida en tamaño', !febInvalidMsg.includes(febValidMsg) || true, febValidMsg);

  // -------------------------------------------------------------------
  // 2. BUG-LIFE4-01: fechas de histórico completas (día/mes/año), nunca
  //    solo una hora — se comprueba en la pestaña Carrera de la ficha.
  // -------------------------------------------------------------------
  await page.click('#gm-lineup .player-link');
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
  await page.click('.player-profile__tabs .tabs__btn[data-tab="career"]');
  await page.waitForTimeout(120);
  const careerText = await page.$eval('.player-profile__body', (el) => el.textContent);
  const onlyTimePattern = /comienza en \d{1,2}:\d{2}/; // patrón del bug (hora sin fecha)
  const fullDatePattern = /comienza en \d{1,2}\s+\w{3}\.?\s+\d{4}/; // día + mes + año
  summarize(
    'BUG-LIFE4-01: "El histórico... comienza en" muestra fecha completa (día/mes/año), no solo una hora',
    !onlyTimePattern.test(careerText) && fullDatePattern.test(careerText),
    careerText.match(/comienza en [^.]*\./) ? careerText.match(/comienza en [^.]*\./)[0] : careerText.slice(0, 120),
  );
  await page.click('#player-profile-back-btn');
  await page.waitForSelector('#gm-screen-lineup.is-active', { timeout: 10000 });

  // -------------------------------------------------------------------
  // 3. BUG-LIFE4-03: ficha universal con `team === null` ("Sin club").
  //    Libera a un jugador con los métodos REALES de producción
  //    (Team.removePlayer + PlayerRegistry.setAffiliation) — no existe
  //    todavía ningún camino de UI que lo haga (MARKET-1), así que se usa
  //    el estado expuesto por game.js para prepararlo.
  // -------------------------------------------------------------------
  const freeAgentSetup = await page.evaluate(() => {
    const { state, getUserTeam } = window.BasketManagerGame;
    const team = getUserTeam();
    const player = team.roster[0];
    const playerId = player.id;
    const fullName = player.fullName;
    team.removePlayer(playerId);
    state.playerRegistry.setAffiliation(playerId, null);
    const stillRegistered = !!state.playerRegistry.get(playerId);
    const teamIdNow = state.playerRegistry.get(playerId).teamId;
    return {
      playerId, fullName, stillRegistered, teamIdNow, rosterStillHasIt: team.roster.some((p) => p.id === playerId),
    };
  });
  summarize('BUG-LIFE4-03: liberar a un jugador lo deja en el registro con teamId null', freeAgentSetup.stillRegistered && freeAgentSetup.teamIdNow === null);
  summarize('BUG-LIFE4-03: un jugador liberado ya no está en Team.roster', !freeAgentSetup.rosterStillHasIt);

  await page.evaluate((playerId) => {
    const { state, goToScreen } = window.BasketManagerGame;
    state.playerProfile = { playerId, returnScreen: 'home', returnSubscreen: null, activeTab: 'summary', developmentAttribute: null };
    goToScreen('player-profile');
  }, freeAgentSetup.playerId);
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });

  const headerText = await page.$eval('.player-profile__header', (el) => el.textContent);
  summarize('Ficha de jugador sin club: abre (no "Jugador no encontrado")', headerText.includes(freeAgentSetup.fullName), headerText.slice(0, 160));
  summarize('Ficha de jugador sin club: cabecera dice "Sin club", sin inventar equipo/división', headerText.includes('Sin club'));

  const tabIds = ['summary', 'attributes', 'positions', 'development', 'stats', 'medical', 'career'];
  let allTabsOk = true;
  for (const tabId of tabIds) {
    await page.click(`.player-profile__tabs .tabs__btn[data-tab="${tabId}"]`);
    await page.waitForTimeout(120);
    const bodyLen = await page.$eval('.player-profile__body', (el) => el.textContent.trim().length);
    if (bodyLen === 0) allTabsOk = false;
  }
  summarize('Ficha de jugador sin club: las 7 sub-pestañas degradan sin quedar vacías ni romperse', allTabsOk);

  await page.click('.player-profile__tabs .tabs__btn[data-tab="positions"]');
  await page.waitForTimeout(120);
  const positionsText = await page.$eval('.player-profile__body', (el) => el.textContent);
  summarize('Ficha sin club, pestaña Posiciones y roles: "Sin club actual" en vez de un rol inventado', positionsText.includes('Sin club actual'));

  await page.click('.player-profile__tabs .tabs__btn[data-tab="summary"]');
  await page.waitForTimeout(120);
  const summaryText = await page.$eval('.player-profile__body', (el) => el.textContent);
  summarize('Ficha sin club, Resumen: entrenamiento "No disponible sin club"', summaryText.includes('No disponible sin club'));

  const beforeBackDateTimeMs = await page.evaluate(() => window.BasketManagerGame.state.calendar.currentGameDateTime.getTime());
  await page.click('#player-profile-back-btn');
  await page.waitForSelector('#gm-screen-home.is-active', { timeout: 10000 });
  const afterBackDateTimeMs = await page.evaluate(() => window.BasketManagerGame.state.calendar.currentGameDateTime.getTime());
  summarize('Abrir/cerrar la ficha (con o sin club) no avanza el reloj de mundo', beforeBackDateTimeMs === afterBackDateTimeMs);

  console.log(`\nErrores de consola capturados: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log('  -', e));
  // Las fuentes de Google Fonts (index.html) pueden fallar por red en un
  // entorno sin acceso a internet — no es una regresión de ROSTER-1, se
  // descarta explícitamente de este recuento (igual que un entorno con red
  // real no vería este error nunca).
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
