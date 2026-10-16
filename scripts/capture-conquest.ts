/// <reference lib="dom" />
/**
 * Captura especifica del Hito C3: conquista terrestre, conquista maritima y
 * marcha posterior.
 *
 * Levanta el dist, abre el sandbox de combate y dispara la secuencia completa
 * de "Conquistar" dos veces: una sobre un frente terrestre y otra sobre uno
 * maritimo (navegacion, andanada y desembarco antes de la ronda final). En la
 * terrestre ademas se pulsa "Mover" para ver la marcha de ejercitos.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO, 'apps', 'client', 'dist');
const OUT = join(REPO, 'test-results');

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function start(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    const rel = url === '/' ? '/index.html' : url === '/debug/combat' ? '/debug/combat.html' : url;
    const fp = join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!existsSync(fp) || !statSync(fp).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(fp)] ?? 'application/octet-stream' });
    createReadStream(fp).pipe(res);
  });
  return new Promise((resolveP, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a === null || typeof a === 'string') return reject(new Error('puerto'));
      resolveP({
        url: `http://127.0.0.1:${a.port}/`,
        close: () => new Promise<void>((d) => server.close(() => d())),
      });
    });
  });
}

/** Valor de la opcion del selector de destinos cuyo texto contiene `trozo`. */
async function main(): Promise<void> {
  const { url, close } = await start();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));

  await page.goto(`${url}debug/combat`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.innerText.includes('Sandbox'), undefined, {
    timeout: 15_000,
  });
  await page.waitForTimeout(1500);
  await mkdir(OUT, { recursive: true });

  const botonConquistar = page.locator('button', { hasText: 'Conquistar' }).first();
  const selectorOrigen = page.locator('select').nth(0);
  const selectorDestino = page.locator('select').nth(1);

  // ---- Conquista terrestre ------------------------------------------------
  // Par con colores contrastados (mock con semilla 4242): Alemania (rojo)
  // contra Francia (verde), para que la onda y el estandarte se lean.
  await selectorOrigen.selectOption('alemania');
  await selectorDestino.selectOption('francia');

  // Tiempos medidos sobre el dist (nivel Tactico): despliegue ~0.9 s, ronda
  // en curso ~1.5 s, avance de la escuadra ~2.3 s, estandarte ~2.8 s, onda
  // ~3.3 s, conquistado ~4 s.
  await botonConquistar.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, 'c3-t-ronda.png') });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: join(OUT, 'c3-t-avance.png') });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'c3-t-estandarte.png') });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'c3-t-onda.png') });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'c3-t-conquistado.png') });

  // La marcha: la fila de mover aparece cuando la conquista termino.
  // El primer screenshot tras el click captura el lienzo ~0.6 s despues de
  // pedirlo (la GPU tarda en entrar en calor), asi que se pide temprano:
  // cae a mitad del camino, con las unidades sobre terreno de contraste.
  const botonMover = page.locator('button', { hasText: 'Mover' }).first();
  await page.waitForTimeout(800);
  await botonMover.click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(OUT, 'c3-t-marcha.png') });
  await page.waitForTimeout(1700);

  // ---- Conquista maritima -------------------------------------------------
  // Egipto (amarillo) contra Turquia (rojo) por el Mediterraneo.
  await selectorOrigen.selectOption('egipto');
  await selectorDestino.selectOption('turquia');
  {
    await botonConquistar.click();
    await page.waitForTimeout(1300);
    await page.screenshot({ path: join(OUT, 'c3-m-navegacion.png') });
    await page.waitForTimeout(1300);
    await page.screenshot({ path: join(OUT, 'c3-m-desembarco.png') });
    await page.waitForTimeout(1700);
    await page.screenshot({ path: join(OUT, 'c3-m-onda.png') });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, 'c3-m-conquistado.png') });
  }

  if (errs.length > 0) {
    console.error('errores de consola:', errs.slice(0, 5).join(' | '));
  }
  console.log('capturas C3 escritas en test-results/');
  await browser.close();
  await close();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
