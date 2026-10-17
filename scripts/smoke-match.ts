/// <reference lib="dom" />
/**
 * Smoke test de la partida local (Hito 4).
 *
 * Prueba el criterio de terminado del hito con tres flujos, cada uno en su
 * propia pagina (una partida larga deja el contexto con mucho estado):
 *
 *   1. Un humano y dos bots: el humano juega un turno COMPLETO desde el HUD
 *      (despliegue, refuerzos, pasar a ataque, terminar turno) y el turno pasa
 *      a un bot, que sigue jugando solo.
 *   2. Dos humanos y un bot: el cartel de relevo anuncia cada cambio de turno
 *      entre humanos, y con un solo humano no aparece (no hay nada que ocultar).
 *   3. Tres bots: la partida se juega de inicio a fin y termina con victoria.
 *
 * Uso: `pnpm build && pnpm smoke:match`
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium, type Page } from 'playwright';

import {
  Errores,
  OUTPUT_DIR,
  SEMILLA,
  colocarTodo,
  desplegarCompleto,
  reportar,
  startStaticServer,
  type Failure,
} from './lib/smoke-common.js';

/** Encabezado del HUD de una pagina concreta (los locators no sobreviven al cierre). */
const encabezado = (p: Page): ReturnType<Page['locator']> => p.locator('#hud header[data-fase]');

async function main(): Promise<void> {
  const { url, close } = await startStaticServer();
  const errores = new Errores();
  const fallas: Failure[] = [];

  const browser = await chromium.launch();
  const abrir = async (): Promise<Page> => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    errores.escuchar(page);
    return page;
  };

  // --- 1. Un humano juega un turno completo -------------------------------------------
  console.log('[match] flujo 1: un humano, dos bots');
  let page = await abrir();
  await page.goto(`${url}?auto=1&jugadores=3&humanos=1&delay=0&semilla=${SEMILLA}`, {
    waitUntil: 'networkidle',
  });

  const faseHeader = encabezado(page);
  await faseHeader.waitFor({ timeout: 30_000 });
  const faseInicial = await faseHeader.getAttribute('data-fase');
  if (faseInicial !== 'setup-placement') {
    fallas.push({ check: 'partida', detail: `fase inicial: ${faseInicial ?? '?'}` });
  }

  // Con un solo humano no tiene que aparecer el relevo.
  const relevoVisible = await page.evaluate(() => {
    const el = document.getElementById('relevo');
    return el !== null && el.children.length > 0;
  });
  if (relevoVisible) {
    fallas.push({ check: 'relevo', detail: 'con un solo humano aparece el relevo' });
  }

  // El despliegue rota por los tres jugadores: el humano coloca en su turno y
  // los bots en el suyo, hasta que arranca el refuerzo.
  if (!(await desplegarCompleto(page, faseHeader, ['p1']))) {
    fallas.push({ check: 'partida', detail: 'el despliegue inicial no termino' });
  }
  const faseTrasDespliegue = await encabezado(page).getAttribute('data-fase');
  if (faseTrasDespliegue !== 'reinforce') {
    fallas.push({
      check: 'partida',
      detail: `tras el despliegue la fase es ${faseTrasDespliegue ?? '?'}`,
    });
  }
  if (!(await colocarTodo(page))) {
    fallas.push({ check: 'partida', detail: 'no se pudieron colocar los refuerzos' });
  }

  const ataque = page.locator('#hud button[data-accion="fin-fase"]');
  await ataque.first().waitFor({ timeout: 30_000 });
  await ataque.first().click();
  await page.waitForTimeout(300);

  // Turno completo: terminar el turno (paso por reagrupe tambien).
  const finTurno = page.locator('#hud button[data-accion="fin-turno"]');
  if ((await finTurno.count()) > 0) {
    await finTurno.first().click();
  } else {
    // Estamos en ataque: primero pasar a reagrupe y recien ahi cerrar.
    await page.locator('#hud button[data-accion="fin-fase"]').first().click();
    await page.waitForTimeout(300);
    await finTurno.first().click();
  }
  await page.waitForTimeout(600);

  // El turno paso a un bot: la partida sigue sola.
  const activoTrasTurno = await encabezado(page).getAttribute('data-activo');
  if (activoTrasTurno === 'p1') {
    fallas.push({
      check: 'turno',
      detail: `el turno no paso de p1 (activo: ${activoTrasTurno})`,
    });
  }
  await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-partida.png') });
  await page.close();
  console.log('[match] flujo 1 listo');

  // --- 2. Relevo hot-seat con dos humanos ----------------------------------------------
  console.log('[match] flujo 2: dos humanos, relevo');
  page = await abrir();
  await page.goto(`${url}?auto=1&jugadores=3&humanos=2&delay=0&semilla=${SEMILLA}`, {
    waitUntil: 'networkidle',
  });
  const cartel = page.locator('#relevo');
  await cartel.filter({ hasText: 'Jugador 1' }).waitFor({ timeout: 30_000 });

  let relevosVistos = 0;
  const deadlineRelevo = Date.now() + 150_000;
  while (Date.now() < deadlineRelevo) {
    const fase = await encabezado(page)
      .getAttribute('data-fase')
      .catch(() => null);
    if (fase !== null && fase !== 'setup-placement') break;
    const visible = (await cartel.count()) > 0 && (await cartel.first().isVisible());
    if (visible) {
      relevosVistos += 1;
      await page.locator('#relevo button').first().click();
      await page.waitForTimeout(300);
      continue;
    }
    const activo = await encabezado(page).getAttribute('data-activo');
    if (activo === 'p1' || activo === 'p2') await colocarTodo(page);
    await page.waitForTimeout(250);
  }

  if (relevosVistos < 2) {
    fallas.push({
      check: 'relevo',
      detail: `se vieron ${relevosVistos} relevos (se esperaban 2 o mas)`,
    });
  }
  const faseTrasRelevos = await encabezado(page).getAttribute('data-fase');
  if (faseTrasRelevos !== 'reinforce') {
    fallas.push({
      check: 'relevo',
      detail: `con 2 humanos la fase quedo en ${faseTrasRelevos ?? '?'}`,
    });
  }
  await page.close();
  console.log('[match] flujo 2 listo, relevos:', relevosVistos);

  // --- 3. Tres bots de inicio a fin ------------------------------------------------------
  console.log('[match] flujo 3: tres bots de inicio a fin');
  page = await abrir();
  await page.goto(`${url}?auto=1&jugadores=3&humanos=0&delay=0&semilla=${SEMILLA}`, {
    waitUntil: 'networkidle',
  });
  const faseBots = page.locator('#hud header[data-fase]');
  await faseBots.waitFor({ timeout: 30_000 });
  await page
    .waitForFunction(
      () =>
        document.querySelector('#hud header[data-fase]')?.getAttribute('data-fase') === 'game-over',
      undefined,
      { timeout: 180_000 },
    )
    .catch(() => undefined);
  const faseFinal = await faseBots.getAttribute('data-fase');
  if (faseFinal !== 'game-over') {
    fallas.push({
      check: 'partida-completa',
      detail: `la partida no termino (fase: ${faseFinal ?? '?'})`,
    });
  }
  const hudFinal =
    (await page
      .locator('#hud')
      .innerText()
      .catch(() => '')) || '';
  if (!/Victoria|Victory/.test(hudFinal)) {
    fallas.push({
      check: 'victoria',
      detail: `el HUD no muestra la victoria (texto: "${hudFinal.slice(0, 90)}")`,
    });
  }
  await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-victoria.png') });

  await browser.close();
  await close();

  await mkdir(OUTPUT_DIR, { recursive: true });
  reportar('smoke:match', fallas, errores);
}

main().catch((error: unknown) => {
  console.error('[smoke:match] error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
