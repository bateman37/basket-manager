#!/usr/bin/env node
// scripts/verify-life3-playwright.js
// Verificación LIFE-3 (DESIGN.md 9.14, sección 43 del prompt de esta
// sesión) contra la interfaz real, sobre file:// (sin servidor), viewport
// móvil — script ad-hoc de sesión, no forma parte del repo de producción
// permanente. Ejecutar con:
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/verify-life3-playwright.js

const path = require('path');
const { chromium } = require('playwright');

const consoleErrors = [];

function summarize(label, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  return ok;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}\n${err.stack}`));

  const filePath = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(filePath);

  // 1. Landing -> Empezar temporada.
  await page.click('#gm-goto-season-btn');
  await page.waitForSelector('.team-card', { timeout: 10000 });

  // 2. Selección de equipo real (primer equipo de 1ª división visible).
  const teamName = await page.$eval('.team-card', (el) => el.querySelector('.team-card__name').textContent);
  await page.click('.team-card');
  await page.waitForSelector('#gm-nav .gm-nav__btn[data-screen="home"]', { timeout: 10000 });
  summarize('1. Partida real creada', true, teamName);

  // 3. Abrir Lesiones — roster sano (sin partidas jugadas todavía).
  await page.click('[data-screen="medical"]');
  await page.waitForSelector('#gm-medical .medical-summary', { timeout: 10000 });
  const summaryBefore = await page.$$eval('#gm-medical .medical-summary strong', (els) => els.map((e) => e.textContent));
  summarize('2/3. Pantalla Lesiones abre y roster sano', summaryBefore[2] === '0', `resumen=${summaryBefore.join(',')}`);

  // 4. Alineación: convocar 10 jugadores + 5 titulares con minutos válidos.
  await page.click('[data-screen="lineup"]');
  await page.waitForSelector('.squad-checkbox', { timeout: 10000 });
  // Cada check() re-renderiza toda la pantalla (renderLineupScreen()
  // reemplaza el innerHTML) — se usa `page.locator().nth()` en vez de
  // ElementHandle cacheados, que quedarían desconectados del DOM tras el
  // primer click.
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
  const lineupStatus = await page.$eval('.lineup-status', (el) => el.textContent.trim());
  summarize('4. Alineación válida tras convocar/asignar', lineupStatus.includes('válida'), lineupStatus);

  // 5. Entrenamiento — sin errores, badges médicos ausentes (roster sano).
  await page.click('[data-screen="training"]');
  await page.waitForSelector('.training-focus-table', { timeout: 10000 });
  const injuryBadgesBefore = await page.$$('.training-focus-table .gm-badge--injury');
  summarize('5. Entrenamiento renderiza sin badges médicos (roster sano)', injuryBadgesBefore.length === 0);

  // 6. Forzar una lesión EN DIRECTO durante el partido real del usuario:
  // sube el hazard de partido a un valor absurdamente alto justo antes de
  // jugar la jornada — la probabilidad de lesión por posesión pasa a ser
  // ~1 en la primera posesión con jugadores en pista, sin tocar código de
  // producción (solo `CONFIG_BASE.medical` en memoria de esta página) NI
  // la aleatoriedad real del resto del partido (tiros/rebotes/decisiones
  // de la CPU siguen exactamente igual — NUNCA se toca Math.random, que sí
  // haría el partido determinista y podría empatar en prórroga para
  // siempre, un artefacto de test, no un bug real).
  await page.evaluate(() => {
    window.__origHazard = window.BasketManager.CONFIG_BASE.medical.match.hazardPerThousandPlayerHours;
    // ~130x el ancla real (30) — sube mucho la probabilidad sin decimar
    // convocatorias enteras posesión a posesión (eso ya se cubre aparte
    // en scripts/test-life3.js con un hazard aún más extremo, en
    // partidos sintéticos aislados sin el resto de la interfaz real).
    window.BasketManager.CONFIG_BASE.medical.match.hazardPerThousandPlayerHours = 4000;
  });

  await page.click('[data-screen="home"]');
  await page.waitForSelector('#gm-play-round-btn', { timeout: 10000 });
  await page.click('#gm-play-round-btn');
  try {
    await page.waitForSelector('#gm-advance-match-btn', { timeout: 45000 });
  } catch (err) {
    console.log('     [debug] no llegó a la pantalla de partido en 45s. Errores de consola hasta ahora:');
    consoleErrors.forEach((e) => console.log('       -', e));
    throw err;
  }

  let matchFinished = false;
  for (let i = 0; i < 12; i++) {
    const label = await page.$eval('#gm-advance-match-btn', (el) => el.textContent.trim());
    if (label.includes('Volver a Inicio')) { matchFinished = true; break; }
    await page.click('#gm-advance-match-btn');
    await page.waitForTimeout(150);
  }
  summarize('6a. Partido en vivo avanza hasta el final', matchFinished);

  // Evento de lesión visible en el reveal, si el motor lo generó ya
  // (puede aparecer en cualquier cuarto revelado, buscamos en todo el DOM
  // de la pantalla de partido antes de volver a Inicio).
  const injuryEventVisible = await page.$$eval('#gm-match *', (nodes) => (
    nodes.some((n) => n.textContent && n.textContent.toLowerCase().includes('lesión'))
  )).catch(() => false);

  await page.click('#gm-advance-match-btn'); // "Volver a Inicio"
  await page.waitForSelector('#gm-screen-home.is-active', { timeout: 10000 });

  await page.evaluate(() => { window.BasketManager.CONFIG_BASE.medical.match.hazardPerThousandPlayerHours = window.__origHazard; });

  // 7. Lesiones: comprobar si ahora hay algún lesionado/limitado real.
  await page.click('[data-screen="medical"]');
  await page.waitForSelector('#gm-medical .medical-summary', { timeout: 10000 });
  const summaryAfter = await page.$$eval('#gm-medical .medical-summary strong', (els) => els.map((e) => e.textContent));
  const anyInjuredNow = Number(summaryAfter[1]) > 0 || Number(summaryAfter[2]) > 0;
  summarize('6b/7. Lesión en directo detectada (reveal + pantalla Lesiones)', anyInjuredNow || injuryEventVisible,
    `resumen tras partido=${summaryAfter.join(',')}, evento visible=${injuryEventVisible}`);

  if (anyInjuredNow) {
    // 8. Historial del jugador afectado.
    await page.click('.medical-history-toggle');
    await page.waitForTimeout(150);
    const historyVisible = await page.$eval('.medical-history-row', (el) => !el.classList.contains('is-hidden'));
    summarize('8. Historial médico se despliega', historyVisible);

    // 9. Alineación: si quedó alguien no disponible, debe aparecer marcado
    // y la alineación anterior (con ese jugador convocado) debe invalidarse.
    await page.click('[data-screen="lineup"]');
    await page.waitForSelector('.squad-picker__item', { timeout: 10000 });
    const injuryBadgeInLineup = await page.$('.gm-badge--injury');
    const lineupStatusAfter = await page.$eval('.lineup-status', (el) => el.textContent.trim());
    summarize('9. Alineación refleja disponibilidad médica real', !!injuryBadgeInLineup || !lineupStatusAfter.includes('válida'),
      `badge=${!!injuryBadgeInLineup}, status=${lineupStatusAfter}`);
  } else {
    console.log('     (nota: esta tirada concreta no produjo una lesión de partido con time-loss —');
    console.log('      el guard de integridad de 5 disponibles o la selección de mecanismo pudo');
    console.log('      absorber la probabilidad forzada; ver invariantes dirigidos en test-life3.js)');
  }

  // 10. Agenda/Noticias: si hubo lesión, debe existir al menos un evento
  // médico coherente con el hecho real.
  await page.click('[data-screen="agenda"]');
  await page.waitForTimeout(150);
  const agendaHasMedical = await page.$$eval('.agenda-event', (els) => els.some((e) => e.textContent.toLowerCase().includes('lesión')));
  await page.click('[data-screen="news"]');
  await page.waitForTimeout(150);
  const newsHasMedical = await page.$$eval('.news-feed *', (els) => els.some((e) => e.textContent && e.textContent.toLowerCase().includes('lesión'))).catch(() => false);
  if (anyInjuredNow) {
    summarize('10. Agenda/Noticias reflejan el hecho médico', agendaHasMedical || newsHasMedical,
      `agenda=${agendaHasMedical}, news=${newsHasMedical}`);
  }

  console.log(`\nErrores de consola capturados: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log('  -', e));

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
