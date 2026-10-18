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

/**
 * Comprueba que el clic sobre el mapa hace algo de verdad.
 *
 * Se apoya en el gancho `__conqueror.screenOf` (solo con `?debug=1`) para saber
 * donde cae cada territorio: asi el clic es un clic real sobre el lienzo y no
 * una llamada interna. Las comprobaciones son por atributos del DOM y no por
 * texto, para que no dependan del idioma del navegador.
 */
async function verificarClicEnMapa(page: Page, fallas: Failure[]): Promise<void> {
  /** Posicion en pantalla de un territorio, si cae sobre el lienzo. */
  const puntoDe = async (id: string | null): Promise<{ x: number; y: number } | null> => {
    if (id === null) return null;
    const punto = await page.evaluate(
      (territorio) =>
        (
          window as unknown as {
            __conqueror?: { screenOf: (t: string) => { x: number; y: number } | null };
          }
        ).__conqueror?.screenOf(territorio) ?? null,
      id,
    );
    if (punto === null) return null;
    // Si el HUD tapa el punto, el clic iria al panel y no al mapa.
    const libre = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.id === 'lienzo',
      punto,
    );
    return libre ? punto : null;
  };

  const origenes = page.locator('#hud button[data-ataque="origen"]');
  const total = await origenes.count();
  let origen: { id: string; punto: { x: number; y: number } } | null = null;
  for (let i = 0; i < total && origen === null; i += 1) {
    const id = await origenes.nth(i).getAttribute('data-territorio');
    const punto = await puntoDe(id);
    if (punto !== null && id !== null) origen = { id, punto };
  }

  if (origen === null) {
    fallas.push({
      check: 'clic-mapa',
      detail: 'ningun territorio propio quedo visible para tocar',
    });
    return;
  }

  // Antes del clic no hay destinos: sin origen elegido no hay a donde atacar.
  const destinosAntes = await page.locator('#hud button[data-ataque="destino"]').count();
  await page.mouse.click(origen.punto.x, origen.punto.y);
  await page.waitForTimeout(350);
  const destinosDespues = await page.locator('#hud button[data-ataque="destino"]').count();

  if (destinosAntes > 0 || destinosDespues === 0) {
    fallas.push({
      check: 'clic-mapa',
      detail: `el clic no eligio origen (destinos: ${destinosAntes} -> ${destinosDespues})`,
    });
    return;
  }

  // Ahora el destino: tocar un vecino enemigo tiene que disparar el ataque.
  const destinos = page.locator('#hud button[data-ataque="destino"]');
  const cuantos = await destinos.count();
  let objetivo: { x: number; y: number } | null = null;
  for (let i = 0; i < cuantos && objetivo === null; i += 1) {
    objetivo = await puntoDe(await destinos.nth(i).getAttribute('data-territorio'));
  }
  if (objetivo === null) {
    fallas.push({ check: 'clic-mapa', detail: 'ningun destino quedo visible para tocar' });
    return;
  }

  await page.mouse.click(objetivo.x, objetivo.y);

  // Una ronda resuelta deja los dados en el registro ("origen [a b] vs ...").
  // Se espera a que la animacion termine y el HUD vuelva a pintarse.
  const aparecio = await page
    .waitForFunction(
      () => document.querySelector('#hud')?.textContent?.includes('[') ?? false,
      undefined,
      { timeout: 12_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!aparecio) {
    fallas.push({ check: 'clic-mapa', detail: 'el clic en el destino no resolvio ninguna ronda' });
  }
  await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-clic-mapa.png') });

  // Si la conquista quedo pendiente hay que resolver el movimiento: la partida
  // tiene que quedar en una fase con cierre de turno para el resto del flujo.
  const faseAhora = await page.locator('#hud header[data-fase]').getAttribute('data-fase');
  if (faseAhora === 'conquest-move') {
    const mover = page.locator('#hud button[data-accion="mover"]');
    if ((await mover.count()) > 0) {
      await mover.first().click();
      await page.waitForTimeout(800);
    }
  }
}

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
  await page.goto(`${url}?auto=1&jugadores=3&humanos=1&delay=0&debug=1&semilla=${SEMILLA}`, {
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

  // --- Clic sobre el mapa: origen y destino ---------------------------------------
  // Regresion del bug "el clic dibuja la flecha pero no hace nada": tocar un
  // territorio propio tiene que elegirlo como origen, y tocar un vecino
  // enemigo tiene que atacar de verdad.
  await verificarClicEnMapa(page, fallas);

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
