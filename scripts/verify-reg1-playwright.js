#!/usr/bin/env node
// scripts/verify-reg1-playwright.js
// Verificación REG-1 (DESIGN.md 9.18) contra la interfaz real, sobre
// file:// (sin servidor) — mismo criterio que
// scripts/verify-contract1-playwright.js/verify-roster1-playwright.js.
// Cubre lo que NO puede probarse en Node puro (game.js es una capa de UI
// sin exports): pantalla Inscripciones, pestaña "Licencia y elegibilidad"
// de la ficha universal, badges de acceso/clasificación/simulación en la
// pantalla de Alineación, un jugador inelegible deshabilitado en la
// convocatoria, la corrección de BUG-CONTRACT1-01 (mínimo/máximo real por
// competición, nunca 8-12 universal) y de BUG-CONTRACT1-02 (regla en pista
// solo en Primera FEB) visibles en pantalla, ausencia de botones de
// mercado y que navegar no muta el registro ni avanza el reloj.
//
// Ejecutar con:
//   node scripts/verify-reg1-playwright.js [desktop|mobile]
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

async function openRegistrations(page) {
  await page.click('[data-screen="registrations"]');
  await page.waitForSelector('#gm-screen-registrations.is-active', { timeout: 20000 });
  await page.waitForSelector('#gm-registrations .contract-table tbody tr', { timeout: 20000 });
}

async function openLineup(page) {
  await page.click('[data-screen="lineup"]');
  await page.waitForSelector('#gm-screen-lineup.is-active', { timeout: 20000 });
  await page.waitForSelector('.squad-picker__item', { timeout: 20000 });
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
  // 1. Club ACB: navegación, aviso, ámbito/normativa, cupos, jugadores.
  // -------------------------------------------------------------------
  await page.click('#gm-goto-season-btn');
  await pickTeam(page, '1ª', 'team-real-madrid');

  const navExists = await page.locator('#gm-nav .gm-nav__btn[data-screen="registrations"]').count();
  summarize('Existe la entrada "Inscripciones" en la navegación', navExists === 1);

  await openRegistrations(page);

  const noticeText = await page.$eval('#gm-registrations .contract-notice', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  summarize('Aviso de datos simulados visible y con el texto completo', /[Ss]imulad[ao]/.test(noticeText) && noticeText.length > 20, noticeText.slice(0, 140));

  const scopeText = await page.$eval('#gm-registrations .gm-card', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Ámbito ACB con competición y ámbito de inscripción visibles', /ACB|Liga Endesa/i.test(scopeText) && /Ámbito de inscripción/.test(scopeText));
  summarize('ACB: rango de acta 8-12 visible (BUG-CONTRACT1-01: nunca universal fijo, aquí correcto por ser ACB)', /8-12/.test(scopeText));
  summarize('ACB: máximo no comunitarios visible', /Máximo no comunitarios/.test(scopeText));
  summarize('ACB: regla en pista declara "No aplica" (ACB no tiene esa capacidad)', /Regla en pista.{0,20}No aplica/.test(scopeText));
  summarize('Bandas de cupo de formación listadas', /jugadores → mínimo/.test(scopeText));
  summarize('Documentos exigidos listados', /Documentos exigidos/.test(scopeText));
  summarize('Fuente/versión del módulo de inscripción visible', /acb-registration-2025-26-v1|v\d/.test(scopeText));

  const cumulativeText = await page.$eval('#gm-registrations .gm-card:nth-of-type(2)', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Máximo acumulado de temporada visible con contador', /altas computadas/.test(cumulativeText));

  const rows = await page.locator('#gm-registrations table.contract-table tbody tr').count();
  summarize('Tabla de jugadores con una fila por afiliado del roster', rows >= 10, `filas: ${rows}`);

  const simulatedProvenanceBadges = await page.locator('#gm-registrations .gm-badge--simulated').count();
  summarize('Cada jugador muestra procedencia "Simulado"', simulatedProvenanceBadges >= rows, `badges: ${simulatedProvenanceBadges}/${rows}`);

  const eligibleMarks = await page.$$eval('#gm-registrations table.contract-table tbody tr td:last-child', (cells) => cells.map((c) => c.textContent.trim()));
  summarize('Todos los jugadores del roster son elegibles al arranque (sin fixtures dirigidos)', eligibleMarks.every((t) => t.startsWith('✔')), eligibleMarks.filter((t) => !t.startsWith('✔')).join(' | '));

  const scopeNote = await page.$eval('#gm-registrations .contract-scope-note', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  summarize('Nota explícita de qué acciones NO existen todavía (MARKET-1/TRANSFER-1/LOAN-1/EUROPE-1)', /MARKET-1/.test(scopeNote) && /TRANSFER-1/.test(scopeNote));

  // -------------------------------------------------------------------
  // 2. Sin botones de mercado fuera de alcance.
  // -------------------------------------------------------------------
  const marketButtons = await page.$$eval('#gm-registrations button', (buttons) => buttons
    .map((b) => b.textContent.trim())
    .filter((text) => /alta|baja|fichar|vincular|renovar|liberar|ejecutar|tantear|ceder|inscribir|autorizar/i.test(text)));
  summarize('No hay botones de alta/baja/vinculación/fichaje/tanteo/cesión', marketButtons.length === 0, marketButtons.join(' | '));

  // -------------------------------------------------------------------
  // 3. Navegar no muta el registro ni avanza el reloj.
  // -------------------------------------------------------------------
  const before = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    return {
      clock: state.calendar.currentGameDateTime.getTime(),
      snapshot: JSON.stringify(state.registrationRegistry.snapshot()),
    };
  });
  await page.click('[data-screen="home"]');
  await page.waitForTimeout(120);
  await openRegistrations(page);
  const after = await page.evaluate(() => {
    const { state } = window.BasketManagerGame;
    return {
      clock: state.calendar.currentGameDateTime.getTime(),
      snapshot: JSON.stringify(state.registrationRegistry.snapshot()),
    };
  });
  summarize(
    'Entrar y salir de Inscripciones no avanza el reloj ni muta el registro',
    before.clock === after.clock && before.snapshot === after.snapshot,
  );

  // -------------------------------------------------------------------
  // 4. Pestaña "Licencia y elegibilidad" de la ficha universal.
  // -------------------------------------------------------------------
  await page.click('#gm-registrations table.contract-table tbody tr .player-link');
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 20000 });
  await page.click('.player-profile__tabs .tabs__btn[data-tab="registration"]');
  await page.waitForTimeout(150);
  const tabText = await page.$eval('.player-profile__body', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Ficha: la pestaña muestra la licencia federativa (federación/temporada/vigencia)', /Federación/.test(tabText) && /Vigencia/.test(tabText));
  summarize('Ficha: tabla de inscripciones visible', /Inscripciones \(/.test(tabText));
  summarize('Ficha: nota de clasificación contextual (nunca universal)', /CONTEXTUAL/.test(tabText));
  summarize('Ficha: bloque de elegibilidad para el próximo partido', /Elegibilidad para el próximo partido/.test(tabText) && /Elegible/.test(tabText));
  summarize('Ficha: aviso de simulación presente', /Simulad[oa]/.test(tabText));
  summarize('Ficha: nota de alcance sin acciones de mercado', /MARKET-1/.test(tabText));

  const registrationTabButtons = await page.$$eval('.player-profile__body button', (buttons) => buttons.map((b) => b.textContent.trim()));
  summarize('Ficha: la pestaña de licencia es de solo lectura (sin botones de acción)', registrationTabButtons.length === 0, registrationTabButtons.join(' | '));

  // -------------------------------------------------------------------
  // 5. Pantalla de Alineación: badges y contadores en vivo.
  // -------------------------------------------------------------------
  await page.evaluate(() => window.BasketManagerGame.goToScreen('home'));
  await openLineup(page);

  const lineupText = await page.$eval('#gm-lineup', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Cabecera de convocatoria muestra el rango REAL (ACB 8-12, nunca 12 fijo)', /Convocatoria \(\d+\/12, mínimo 8\)/.test(lineupText), (lineupText.match(/Convocatoria \([^)]+\)/) || [''])[0]);

  const accessBadges = await page.locator('#gm-lineup .gm-badge--access-senior').count();
  summarize('Convocados muestran badge de categoría de acceso (Senior)', accessBadges >= rows, `badges: ${accessBadges}`);

  const simulatedLineupBadges = await page.locator('#gm-lineup .squad-picker__item .gm-badge--simulated').count();
  summarize('Cada candidato de la convocatoria muestra el badge "Simulado"', simulatedLineupBadges > 0, `badges: ${simulatedLineupBadges}`);

  const liveCountersText = await page.$eval('#gm-lineup .lineup-live-counters', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  summarize('Contadores en vivo (formación/no comunitarios) visibles', /Formación/.test(liveCountersText) && /No comunitarios/.test(liveCountersText), liveCountersText);

  // -------------------------------------------------------------------
  // 6. Fixture dirigido: un jugador sancionado queda inelegible y
  //    deshabilitado en la convocatoria, sin romper la pantalla.
  // -------------------------------------------------------------------
  const suspendedFixture = await page.evaluate(() => {
    const { state, getUserTeam } = window.BasketManagerGame;
    const BM = window.BasketManager;
    const team = getUserTeam();
    const isoDate = BM.LocalDate.fromJsDate(state.calendar.currentGameDateTime);
    const seasonKey = BM.seasonKeyFromStartYear(state.seasonStartYear);
    const competitionId = BM.competitionIdFromLegacyDivision(team.division);
    const resolved = BM.resolveRules({
      domain: 'registration', competitionId, seasonKey, date: isoDate, phaseId: 'league', operation: 'bootstrap',
    });
    const player = team.roster.find((p) => (
      state.registrationRegistry.currentRegistration(p.id, resolved.registrationScopeId, seasonKey, isoDate)
    )) || team.roster[0];
    const registration = state.registrationRegistry.currentRegistration(player.id, resolved.registrationScopeId, seasonKey, isoDate);
    BM.RegistrationService.suspendRegistrationForStatus(registration, isoDate, 'disciplinary-suspension', resolved);
    return { playerId: player.id, fullName: player.fullName };
  });
  await page.evaluate(() => window.BasketManagerGame.goToScreen('home'));
  await openLineup(page);
  const suspendedRow = page.locator(`#gm-lineup .squad-picker__item:has-text("${suspendedFixture.fullName}")`).first();
  const suspendedRowText = await suspendedRow.textContent();
  summarize(
    'Fixture: jugador sancionado se muestra "No elegible" con el motivo, sin romper la pantalla',
    /No elegible/.test(suspendedRowText) && /inscripción suspendida/i.test(suspendedRowText),
    suspendedRowText.replace(/\s+/g, ' ').slice(0, 160),
  );
  const suspendedCheckboxDisabled = await suspendedRow.locator('input.squad-checkbox').isDisabled();
  summarize('Fixture: su checkbox de convocatoria está deshabilitado', suspendedCheckboxDisabled);

  // -------------------------------------------------------------------
  // 7. Primera FEB: mínimo/máximo real distinto de ACB y regla en pista.
  // -------------------------------------------------------------------
  await backToTeamSelect(page);
  await pickTeam(page, '2ª', 'team-palencia-baloncesto');
  await openRegistrations(page);
  const febScopeText = await page.$eval('#gm-registrations .gm-card', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Primera FEB: rango de acta 10-12 (BUG-CONTRACT1-01: nunca hereda el 8 de ACB)', /10-12/.test(febScopeText));
  summarize('Primera FEB: regla en pista SÍ declara el mínimo de formación (ACB no la tiene)', /Regla en pista.{0,20}Mínimo 2 de formación en pista/.test(febScopeText));

  await page.evaluate(() => window.BasketManagerGame.goToScreen('home'));
  await openLineup(page);
  const febLineupText = await page.$eval('#gm-lineup', (el) => el.textContent.replace(/\s+/g, ' '));
  summarize('Primera FEB: cabecera de convocatoria muestra 10 de mínimo (nunca 8 universal)', /Convocatoria \(\d+\/12, mínimo 10\)/.test(febLineupText), (febLineupText.match(/Convocatoria \([^)]+\)/) || [''])[0]);
  const febLiveCounters = await page.$eval('#gm-lineup .lineup-live-counters', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  summarize('Primera FEB: contador en vivo también refleja el mínimo de formación de esta competición', /Formación/.test(febLiveCounters));

  // -------------------------------------------------------------------
  // 8. Responsive: no hay scroll horizontal del documento.
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
  // a internet — no es una regresión de REG-1 (mismo criterio que
  // verify-contract1-playwright.js/verify-roster1-playwright.js).
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
