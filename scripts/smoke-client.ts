/// <reference lib="dom" />
/**
 * Smoke test de las pantallas y los sandboxes.
 *
 * Levanta un servidor estatico sobre `apps/client/dist`, abre la app en
 * Chromium y comprueba lo minimo que tiene que funcionar siempre:
 *
 *   - la pantalla de configuracion local monta con el nombre del juego
 *   - el tablero se carga y el lienzo WebGL dibuja (`?explorar=1`)
 *   - el HUD se monta con el nombre del juego, los jugadores y el selector de
 *     idioma, y el cambio de idioma re-renderiza
 *   - al hacer clic en un territorio se abre su detalle
 *   - el sandbox `/debug/combat` tambien carga sin errores
 *   - el sandbox `/debug/sounds` lista los slots del manifiesto y todos
 *     figuran sin archivo (el juego viaja en silencio, ADR 0011)
 *   - el sandbox `/debug/models` lista los cuatro tipos de unidad y todos
 *     figuran sin modelo (el juego viaja con primitivas, ADR 0012)
 *
 * La partida local de punta a punta se prueba aparte, en `smoke-match.ts`.
 *
 * Deja capturas en `test-results/`.
 *
 * Uso: `pnpm build && pnpm smoke`
 */

import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type Page } from 'playwright';

import {
  DIST_DIR,
  Errores,
  OUTPUT_DIR,
  SLOTS_SONIDO,
  TIPOS_MODELO,
  reportar,
  startStaticServer,
  type Failure,
} from './lib/smoke-common.js';

async function main(): Promise<void> {
  if (!existsSync(join(DIST_DIR, 'index.html'))) {
    throw new Error('Falta apps/client/dist. Corre `pnpm build` antes del smoke test.');
  }

  const { url, close } = await startStaticServer();
  const errores = new Errores();
  const fallas: Failure[] = [];

  const browser = await chromium.launch();
  const abrir = async (): Promise<Page> => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    errores.escuchar(page);
    return page;
  };

  // --- Landing (pantalla inicial, Hito 5) --------------------------------------
  let page = await abrir();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const tituloLanding = page.locator('#landing h1');
  if ((await tituloLanding.count()) === 0) {
    fallas.push({ check: 'landing', detail: 'no aparece el titulo del hero' });
  }

  // Accesibilidad basica: un solo h1, jerarquia sin saltos y todo control con
  // nombre accesible. OJO: dentro de `evaluate` no van funciones con nombre;
  // el bundler las envuelve con un helper (`__name`) que no existe en la pagina.
  const a11y = await page.evaluate(() => {
    const raiz = document.getElementById('landing');
    if (raiz === null) return { h1: 0, saltos: [] as string[], sinNombre: [] as string[] };
    const encabezados = Array.from(raiz.querySelectorAll('h1, h2, h3, h4'));
    const saltos: string[] = [];
    for (let i = 1; i < encabezados.length; i += 1) {
      const anterior = Number((encabezados[i - 1] as Element).tagName.slice(1));
      const actual = Number((encabezados[i] as Element).tagName.slice(1));
      if (actual - anterior > 1) saltos.push(`h${anterior} -> h${actual}`);
    }
    const sinNombre = Array.from(raiz.querySelectorAll('button, a'))
      .filter((elemento) => {
        const texto = (elemento.textContent ?? '').trim();
        return texto === '' && elemento.getAttribute('aria-label') === null;
      })
      .map((elemento) => elemento.outerHTML.slice(0, 60));
    return { h1: raiz.querySelectorAll('h1').length, saltos, sinNombre };
  });
  if (a11y.h1 !== 1) {
    fallas.push({ check: 'landing', detail: `la landing tiene ${a11y.h1} h1 (esperado 1)` });
  }
  if (a11y.saltos.length > 0) {
    fallas.push({ check: 'landing', detail: `saltos de nivel: ${a11y.saltos.join(', ')}` });
  }
  if (a11y.sinNombre.length > 0) {
    fallas.push({
      check: 'landing',
      detail: `controles sin nombre: ${a11y.sinNombre.join(' | ')}`,
    });
  }

  await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-landing.png') });

  // El boton de jugar tiene que llevar a la configuracion (y cambiar la URL).
  // Se busca por atributo, no por texto: en CI el navegador arranca en ingles.
  const jugar = page.locator('#landing button[data-accion="jugar"]').first();
  if ((await jugar.count()) === 0) {
    fallas.push({ check: 'landing', detail: 'no aparece el boton de jugar' });
  } else {
    await jugar.click();
    await page.waitForTimeout(700);
    if (!page.url().includes('jugar=1')) {
      fallas.push({ check: 'landing', detail: `la URL no cambio a ?jugar=1 (${page.url()})` });
    }
    if ((await page.locator('#hud button[data-accion="empezar"]').count()) === 0) {
      fallas.push({ check: 'landing', detail: 'jugar no lleva a la configuracion' });
    }
    // La landing se va y el lienzo vuelve a estar disponible.
    if ((await page.locator('#landing').count()) > 0) {
      fallas.push({ check: 'landing', detail: 'la landing no se desmonta al jugar' });
    }
    const lienzoVisible = await page.evaluate(() => {
      const lienzo = document.getElementById('lienzo');
      return lienzo !== null && getComputedStyle(lienzo).display !== 'none';
    });
    if (!lienzoVisible) {
      fallas.push({ check: 'landing', detail: 'el lienzo sigue oculto tras entrar a jugar' });
    }
  }
  await page.close();

  // --- Configuracion local -----------------------------------------------------
  // Con `?jugar=1` se entra directo, sin pasar por la landing.
  page = await abrir();
  await page.goto(`${url}?jugar=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const setupText =
    (await page
      .locator('#hud')
      .innerText()
      .catch(() => '')) || '';
  if (!setupText.includes('Conqueror')) {
    fallas.push({ check: 'setup', detail: 'no aparece el nombre del juego' });
  }
  // Se busca por atributo, no por texto: el idioma depende del navegador
  // (en CI arranca en ingles y el boton dice "Start match").
  if ((await page.locator('#hud button[data-accion="empezar"]').count()) === 0) {
    fallas.push({ check: 'setup', detail: 'no aparece el boton de empezar partida' });
  }
  await page.close();

  // --- Tablero modo exploracion --------------------------------------------------
  // `/` ahora arranca en la configuracion; el tablero con datos de prueba
  // (herramienta del Hito 2) sigue disponible con `?explorar=1`.
  page = await abrir();
  await page.goto(`${url}?explorar=1`, { waitUntil: 'networkidle' });

  // El tablero tarda en cargar: se espera a que el HUD muestre el resumen.
  await page
    .waitForFunction(() => document.body.innerText.includes('terr.'), undefined, {
      timeout: 30_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(1200);

  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector('#lienzo');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    return {
      width: canvas.width,
      height: canvas.height,
      hasWebGL: canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null,
      painted: canvas.toDataURL().length > 1000,
    };
  });

  const hud = page.locator('#hud');
  const hudText = (await hud.innerText().catch(() => '')) || '';
  if (canvasInfo === null) {
    fallas.push({ check: 'lienzo', detail: 'no se encontro #lienzo' });
  } else {
    if (canvasInfo.width === 0 || canvasInfo.height === 0) {
      fallas.push({ check: 'lienzo', detail: `tamano ${canvasInfo.width}x${canvasInfo.height}` });
    }
    if (!canvasInfo.hasWebGL) {
      fallas.push({ check: 'webgl', detail: 'el lienzo no tiene contexto WebGL' });
    }
    if (!canvasInfo.painted) {
      fallas.push({ check: 'render', detail: 'el lienzo no dibujo nada' });
    }
  }
  if (!hudText.includes('Conqueror')) {
    fallas.push({ check: 'hud', detail: 'no aparece el nombre del juego' });
  }
  if (!hudText.includes('terr.')) {
    fallas.push({ check: 'tablero', detail: 'el HUD no muestra el resumen de jugadores' });
  }
  if ((await page.locator('button[data-locale]').count()) !== 2) {
    fallas.push({ check: 'idioma', detail: 'no hay exactamente dos botones de idioma' });
  }

  // Seleccion de un territorio: el panel de detalle tiene que abrirse.
  const box = await page.locator('#lienzo').boundingBox();
  if (box !== null) {
    await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.48);
    await page.waitForTimeout(2200);
  }
  const hudTrasClic = (await hud.innerText().catch(() => '')) || '';
  if (!/Dueño|Owner/.test(hudTrasClic)) {
    fallas.push({
      check: 'seleccion',
      detail: `el detalle del territorio no se abrio (texto: "${hudTrasClic.slice(0, 90)}")`,
    });
  }

  // Cambio de idioma.
  await page.locator('button[data-locale="en"]').click();
  await page.waitForTimeout(500);
  const hudIngles = (await hud.innerText().catch(() => '')) || '';
  if (!hudIngles.toLowerCase().includes('war of empires')) {
    fallas.push({
      check: 'i18n',
      detail: `el HUD no cambio de idioma (texto: "${hudIngles.slice(0, 90)}")`,
    });
  }
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (lang !== 'en') {
    fallas.push({ check: 'i18n', detail: `html[lang] quedo en "${lang}"` });
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-tablero.png') });
  await page.close();

  // --- Sandbox de combate -------------------------------------------------------------
  page = await abrir();
  await page.goto(`${url}debug/combat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3400);
  const sandboxHud = page.locator('#hud');
  const sandboxText = (await sandboxHud.innerText().catch(() => '')) || '';
  if (!sandboxText.includes('Sandbox')) {
    fallas.push({
      check: 'sandbox',
      detail: `el sandbox no monto el panel (texto: "${sandboxText.slice(0, 90)}")`,
    });
  }
  const ronda = page.locator('button', { hasText: 'Tirar ronda' });
  if ((await ronda.count()) > 0) {
    await ronda.first().click();
    await page.waitForTimeout(1600);
    await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-combate.png') });
  } else {
    fallas.push({ check: 'sandbox', detail: 'no se encontro el boton de tirar ronda' });
  }
  await page.close();

  // --- Sandbox de sonidos ---------------------------------------------------------------
  page = await abrir();
  await page.goto(`${url}debug/sounds`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const sonidosText =
    (await page
      .locator('#hud')
      .innerText()
      .catch(() => '')) || '';
  const faltan = SLOTS_SONIDO.filter((slot) => !sonidosText.includes(slot));
  if (faltan.length > 0) {
    fallas.push({ check: 'sonidos', detail: `faltan slots en la pagina: ${faltan.join(', ')}` });
  }
  const sinArchivo = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('#hud span')).filter(
        (span) => span.textContent === 'Sin archivo' || span.textContent === 'No file',
      ).length,
  );
  if (sinArchivo !== SLOTS_SONIDO.length) {
    fallas.push({
      check: 'sonidos',
      detail: `${sinArchivo} de ${SLOTS_SONIDO.length} slots figuran sin archivo`,
    });
  }
  await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-sonidos.png') });
  await page.close();

  // --- Sandbox de modelos -------------------------------------------------------------------
  page = await abrir();
  await page.goto(`${url}debug/models`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const modelosText =
    (await page
      .locator('#hud')
      .innerText()
      .catch(() => '')) || '';
  const faltanTipos = TIPOS_MODELO.filter((tipo) => !modelosText.includes(tipo));
  if (faltanTipos.length > 0) {
    fallas.push({
      check: 'modelos',
      detail: `faltan tipos en la pagina: ${faltanTipos.join(', ')}`,
    });
  }
  const sinModelo = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('#hud span')).filter(
        (span) => span.textContent === 'Sin modelo' || span.textContent === 'No model',
      ).length,
  );
  if (sinModelo !== TIPOS_MODELO.length) {
    fallas.push({
      check: 'modelos',
      detail: `${sinModelo} de ${TIPOS_MODELO.length} tipos figuran sin modelo`,
    });
  }
  await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-modelos.png') });

  await browser.close();
  await close();

  for (const nombre of [
    'smoke-tablero.png',
    'smoke-combate.png',
    'smoke-sonidos.png',
    'smoke-modelos.png',
  ]) {
    const path = join(OUTPUT_DIR, nombre);
    if (existsSync(path)) {
      const size = await readFile(path);
      console.log(`[smoke] captura: ${nombre} (${(size.byteLength / 1024).toFixed(0)} KB)`);
    }
  }

  reportar('smoke', fallas, errores);
}

main().catch((error: unknown) => {
  console.error('[smoke] error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
