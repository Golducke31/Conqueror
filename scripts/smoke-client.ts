/// <reference lib="dom" />
/**
 * Smoke test del cliente.
 *
 * Levanta un servidor estatico sobre `apps/client/dist`, abre la app en
 * Chromium y comprueba lo minimo que tiene que funcionar siempre:
 *
 *   - la pagina carga sin errores de consola
 *   - el tablero se carga y el lienzo WebGL dibuja
 *   - el HUD se monta con el nombre del juego, los jugadores y el selector de
 *     idioma, y el cambio de idioma re-renderiza
 *   - al hacer clic en un territorio se abre su detalle
 *   - el sandbox `/debug/combat` tambien carga sin errores
 *
 * Deja capturas en `test-results/`.
 *
 * La referencia a `lib="dom"` es solo para tipar los callbacks que corren
 * dentro de la pagina (`page.evaluate`).
 *
 * Uso: `pnpm build && pnpm smoke`
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(REPO_ROOT, 'apps', 'client', 'dist');
const OUTPUT_DIR = join(REPO_ROOT, 'test-results');

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/** Reescribe las rutas de depuracion sin `.html`, igual que el dev server. */
function rewriteDebugRoute(url: string): string {
  if (url === '/debug/combat' || url === '/debug/combat/') return '/debug/combat.html';
  return url;
}

function startStaticServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requested = rewriteDebugRoute((request.url ?? '/').split('?')[0] ?? '/');
    const relative = requested === '/' ? '/index.html' : requested;
    const filePath = join(DIST_DIR, normalize(relative).replace(/^(\.\.[/\\])+/, ''));

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }

    response.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no se pudo obtener el puerto'));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

interface Failure {
  readonly check: string;
  readonly detail: string;
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST_DIR, 'index.html'))) {
    throw new Error('Falta apps/client/dist. Corre `pnpm build` antes del smoke test.');
  }

  const { url, close } = await startStaticServer();
  const failures: Failure[] = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(url, { waitUntil: 'networkidle' });

  // El tablero tarda en cargar: se espera a que el HUD muestre el resumen.
  const hud = page.locator('#hud');
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

  if (canvasInfo === null) {
    failures.push({ check: 'lienzo', detail: 'no se encontro #lienzo' });
  } else {
    if (canvasInfo.width === 0 || canvasInfo.height === 0) {
      failures.push({ check: 'lienzo', detail: `tamano ${canvasInfo.width}x${canvasInfo.height}` });
    }
    if (!canvasInfo.hasWebGL) {
      failures.push({ check: 'webgl', detail: 'el lienzo no tiene contexto WebGL' });
    }
    if (!canvasInfo.painted) {
      failures.push({ check: 'render', detail: 'el lienzo no dibujo nada' });
    }
  }

  const hudText = (await hud.innerText().catch(() => '')) || '';
  if (!hudText.includes('Conqueror')) {
    failures.push({
      check: 'hud',
      detail: `no aparece el nombre del juego (texto: "${hudText.slice(0, 90)}")`,
    });
  }
  if (!hudText.includes('terr.')) {
    failures.push({ check: 'tablero', detail: 'el HUD no muestra el resumen de jugadores' });
  }
  if ((await page.locator('button[data-locale]').count()) !== 2) {
    failures.push({ check: 'idioma', detail: 'no hay exactamente dos botones de idioma' });
  }

  // Seleccion de un territorio: el panel de detalle tiene que abrirse.
  const box = await page.locator('#lienzo').boundingBox();
  if (box !== null) {
    await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.48);
    await page.waitForTimeout(2200);
  }
  const hudTrasClic = (await hud.innerText().catch(() => '')) || '';
  if (!/Dueño|Owner/.test(hudTrasClic)) {
    failures.push({
      check: 'seleccion',
      detail: `el detalle del territorio no se abrio (texto: "${hudTrasClic.slice(0, 90)}")`,
    });
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: join(OUTPUT_DIR, 'smoke-tablero.png') });

  // Cambio de idioma.
  await page.locator('button[data-locale="en"]').click();
  await page.waitForTimeout(500);
  const hudIngles = (await hud.innerText().catch(() => '')) || '';
  if (!hudIngles.toLowerCase().includes('war of empires')) {
    failures.push({
      check: 'i18n',
      detail: `el HUD no cambio de idioma (texto: "${hudIngles.slice(0, 90)}")`,
    });
  }
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (lang !== 'en') {
    failures.push({ check: 'i18n', detail: `html[lang] quedo en "${lang}"` });
  }

  // Sandbox de combate.
  await page.goto(`${url}debug/combat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3400);
  const sandboxText = (await hud.innerText().catch(() => '')) || '';
  if (!sandboxText.includes('Sandbox')) {
    failures.push({
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
    failures.push({ check: 'sandbox', detail: 'no se encontro el boton de tirar ronda' });
  }

  if (consoleErrors.length > 0) {
    failures.push({ check: 'consola', detail: consoleErrors.slice(0, 5).join(' | ') });
  }

  await browser.close();
  await close();

  for (const name of ['smoke-tablero.png', 'smoke-combate.png']) {
    const path = join(OUTPUT_DIR, name);
    if (existsSync(path)) {
      const size = (await readFile(path)).byteLength;
      console.log(`[smoke] captura: ${name} (${(size / 1024).toFixed(0)} KB)`);
    }
  }

  if (failures.length > 0) {
    console.error(`[smoke] FALLO con ${failures.length} problema(s):`);
    for (const failure of failures) console.error(`  - ${failure.check}: ${failure.detail}`);
    process.exitCode = 1;
    return;
  }

  console.log('[smoke] OK: tablero dibujando, HUD con jugadores, seleccion, i18n y sandbox');
}

main().catch((error: unknown) => {
  console.error('[smoke] error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
