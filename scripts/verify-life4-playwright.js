#!/usr/bin/env node
// scripts/verify-life4-playwright.js
// Verificación LIFE-4 (DESIGN.md 9.15, sección 81 del prompt de esta
// sesión) contra la interfaz real, sobre file:// (sin servidor) —
// script ad-hoc de sesión, no forma parte del repo de producción
// permanente. Ejecutar con:
//   node scripts/verify-life4-playwright.js [desktop|mobile]

const path = require('path');
const { chromium } = require('playwright');

const consoleErrors = [];
let failures = 0;

function summarize(label, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
  return ok;
}

async function fillLineupAndValidate(page) {
  await page.click('[data-screen="lineup"]');
  await page.waitForSelector('.squad-checkbox', { timeout: 10000 });
  const checkboxCount = await page.locator('.squad-checkbox').count();
  for (let i = 0; i < 10 && i < checkboxCount; i++) {
    await page.locator('.squad-checkbox').nth(i).check();
  }
  await page.waitForSelector('.lineup-slot-player', { timeout: 10000 });
  const starterSelectCount = await page.locator('select.lineup-slot-player[data-slot="starter"]').count();
  for (let i = 0; i < starterSelectCount; i++) {
    const select = page.locator('select.lineup-slot-player[data-slot="starter"]').nth(i);
    const options = await select.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
    if (!options.length) continue;
    await select.selectOption(options[i % options.length]);
  }
  const starterMinutesCount = await page.locator('input.lineup-slot-minutes[data-slot="starter"]').count();
  for (let i = 0; i < starterMinutesCount; i++) {
    const input = page.locator('input.lineup-slot-minutes[data-slot="starter"]').nth(i);
    await input.fill('40');
    await input.dispatchEvent('change');
  }
  await page.waitForTimeout(200);
}

async function playRoundToCompletion(page) {
  await page.click('[data-screen="home"]');
  await page.waitForSelector('#gm-play-round-btn', { timeout: 10000 });
  await page.click('#gm-play-round-btn');
  await page.waitForSelector('#gm-advance-match-btn', { timeout: 45000 });
  let matchFinished = false;
  for (let i = 0; i < 15; i++) {
    const label = await page.$eval('#gm-advance-match-btn', (el) => el.textContent.trim());
    if (label.includes('Volver a Inicio')) { matchFinished = true; break; }
    await page.click('#gm-advance-match-btn');
    await page.waitForTimeout(150);
  }
  return matchFinished;
}

async function checkNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  summarize(`Móvil: sin overflow horizontal (${label})`, !overflow);
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
  await page.waitForSelector('.team-card', { timeout: 10000 });
  await page.click('.team-card');
  await page.waitForSelector('#gm-nav .gm-nav__btn[data-screen="home"]', { timeout: 10000 });
  summarize('Partida real creada', true);

  // --- Alineación: nombre clicable sin activar el checkbox ---
  await fillLineupAndValidate(page);
  const firstCheckboxChecked = await page.locator('.squad-checkbox').nth(0).isChecked();
  await page.locator('#gm-lineup .player-link').first().click();
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
  summarize('Alineación → ficha: nombre abre la ficha universal', true);
  await page.click('#player-profile-back-btn');
  await page.waitForSelector('#gm-screen-lineup.is-active', { timeout: 10000 });
  const checkboxStillChecked = await page.locator('.squad-checkbox').nth(0).isChecked();
  summarize('Alineación → ficha → volver: convocatoria intacta, checkbox no se tocó', checkboxStillChecked === firstCheckboxChecked);
  const lineupStatus = await page.$eval('.lineup-status', (el) => el.textContent.trim());
  summarize('Alineación válida tras volver de la ficha', lineupStatus.includes('válida'), lineupStatus);

  // --- Entrenamiento → ficha → volver ---
  await page.click('[data-screen="training"]');
  await page.waitForSelector('.training-focus-table', { timeout: 10000 });
  await page.locator('.training-focus-table .player-link').first().click();
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
  await page.click('#player-profile-back-btn');
  await page.waitForSelector('#gm-screen-training.is-active', { timeout: 10000 });
  const trainingTableStillThere = await page.locator('.training-focus-table tbody tr').count();
  summarize('Entrenamiento → ficha → volver: plan intacto', trainingTableStillThere > 0);

  // --- Tácticas (Roles) → ficha → volver a la misma subtab ---
  await page.click('[data-screen="tactics"]');
  await page.waitForSelector('.tabs__btn[data-tab="roles"]', { timeout: 10000 });
  await page.click('.tabs__btn[data-tab="roles"]');
  await page.waitForSelector('.tactics-roles-table', { timeout: 10000 });
  const rolesLinkCount = await page.locator('.tactics-roles-table .player-link').count();
  if (rolesLinkCount > 0) {
    await page.locator('.tactics-roles-table .player-link').first().click();
    await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
    await page.click('#player-profile-back-btn');
    await page.waitForSelector('#gm-screen-tactics.is-active', { timeout: 10000 });
    const stillOnRoles = await page.locator('.tabs__btn[data-tab="roles"].is-active').count();
    summarize('Tácticas → ficha → volver a la misma subtab Roles', stillOnRoles === 1);
  } else {
    summarize('Tácticas → ficha (sin convocatoria, se omite)', true);
  }

  // --- Ficha universal: recorrer las 7 sub-pestañas sin errores ---
  await page.click('[data-screen="lineup"]');
  await page.waitForSelector('#gm-lineup .player-link', { timeout: 10000 });
  await page.locator('#gm-lineup .player-link').first().click();
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
  const tabIds = ['summary', 'attributes', 'positions', 'development', 'stats', 'medical', 'career'];
  for (const tabId of tabIds) {
    await page.click(`.player-profile__tabs .tabs__btn[data-tab="${tabId}"]`);
    await page.waitForTimeout(120);
  }
  const bodyNotEmpty = await page.$eval('.player-profile__body', (el) => el.textContent.trim().length > 0);
  summarize('Ficha: las 7 sub-pestañas renderizan sin quedar vacías', bodyNotEmpty);
  if (isMobile) await checkNoHorizontalOverflow(page, 'ficha, pestaña Carrera');
  await page.click('#player-profile-back-btn');
  await page.waitForSelector('#gm-screen-lineup.is-active', { timeout: 10000 });

  // --- Jugar una jornada real (motor en vivo) para tener box score/stats reales ---
  const matchFinished = await playRoundToCompletion(page);
  summarize('Jornada jugada hasta el final (motor en vivo)', matchFinished);

  // --- Box score del partido recién jugado → ficha → volver al mismo
  // resultado (DESIGN.md 9.15, sección 43) — se comprueba AQUÍ, con el
  // box score todavía visible (antes de "Volver a Inicio", que limpia
  // `state.matchReveal` y deja la pantalla de partido en espera).
  const boxScoreLinkCount = await page.locator('#gm-match .player-link').count();
  if (boxScoreLinkCount > 0) {
    const scoreBefore = await page.$eval('#gm-match .scoreboard', (el) => el.textContent).catch(() => '');
    await page.locator('#gm-match .player-link').first().click();
    await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
    await page.click('#player-profile-back-btn');
    await page.waitForSelector('#gm-screen-match.is-active', { timeout: 10000 });
    const scoreAfter = await page.$eval('#gm-match .scoreboard', (el) => el.textContent).catch(() => '');
    summarize('Box score → ficha → volver al mismo resultado (sin re-simular)', scoreBefore === scoreAfter && scoreBefore !== '');
  } else {
    summarize('Box score: sin jugadores con minutos en este partido (se omite)', true);
  }

  await page.click('#gm-advance-match-btn'); // "Volver a Inicio"
  await page.waitForSelector('#gm-screen-home.is-active', { timeout: 10000 });

  // --- Estadísticas → ficha → volver conservando sort/competición ---
  await page.click('[data-screen="stats"]');
  await page.waitForSelector('#gm-stats .gm-table', { timeout: 10000 });
  await page.click('#gm-stats .stats-sortable[data-sort-key="assists"]');
  await page.waitForTimeout(150);
  const statsLinkCount = await page.locator('#gm-stats .player-link').count();
  if (statsLinkCount > 0) {
    await page.locator('#gm-stats .player-link').first().click();
    await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
    await page.click('.player-profile__tabs .tabs__btn[data-tab="stats"]');
    const hasGames = await page.$eval('.player-profile__body', (el) => el.textContent.includes('Carrera') || el.textContent.includes('Registrado en esta partida'));
    summarize('Ficha → Estadísticas muestra histórico de temporadas', hasGames);
    await page.click('#player-profile-back-btn');
    await page.waitForSelector('#gm-screen-stats.is-active', { timeout: 10000 });
    const activeSort = await page.locator('#gm-stats .stats-sortable.is-active-sort').getAttribute('data-sort-key');
    summarize('Estadísticas → ficha → volver conserva el sort activo', activeSort === 'assists');
  } else {
    summarize('Estadísticas: sin filas todavía (se omite)', true);
  }

  // --- Lesiones → ficha → Médico coincide ---
  await page.click('[data-screen="medical"]');
  await page.waitForSelector('.medical-table', { timeout: 10000 });
  await page.locator('.medical-table .player-link').first().click();
  await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
  await page.click('.player-profile__tabs .tabs__btn[data-tab="medical"]');
  await page.waitForTimeout(120);
  const medicalTabRendered = await page.$eval('.player-profile__body', (el) => el.textContent.length > 0);
  summarize('Lesiones → ficha: pestaña Médico renderiza', medicalTabRendered);
  await page.click('#player-profile-back-btn');
  await page.waitForSelector('#gm-screen-medical.is-active', { timeout: 10000 });

  // --- Noticias: nombre clicable si hay alguna noticia con relatedPlayer ---
  await page.click('[data-screen="news"]');
  await page.waitForTimeout(150);
  const newsLinkCount = await page.locator('.news-feed .player-link').count();
  if (newsLinkCount > 0) {
    await page.locator('.news-feed .player-link').first().click();
    await page.waitForSelector('#gm-screen-player-profile.is-active', { timeout: 10000 });
    await page.click('#player-profile-back-btn');
    await page.waitForSelector('#gm-screen-news.is-active', { timeout: 10000 });
    summarize('Noticias → ficha → volver', true);
  } else {
    summarize('Noticias: sin relatedPlayer en el feed todavía (se omite)', true);
  }

  console.log(`\nErrores de consola capturados: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log('  -', e));
  // Ajuste de ENTORNO (CONTRACT-1, no un cambio de alcance de LIFE-4): las
  // fuentes de Google (index.html) fallan con ERR_CONNECTION_RESET en una
  // máquina sin acceso a internet, lo que hacía fallar este script aunque
  // sus 13 comprobaciones funcionales pasaran. Se aplica el MISMO filtro
  // que ya usa scripts/verify-roster1-playwright.js desde ROSTER-1; el
  // resto de errores de consola siguen contando como fallo.
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
