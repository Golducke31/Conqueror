/// <reference lib="dom" />
/**
 * Captura especifica del Hito C2: dados, duelos y bajas.
 *
 * Levanta el dist, abre el sandbox de combate, dispara una ronda Tactica y
 * toma tres cuadros en momentos clave: despliegue, impacto de los duelos y
 * reacomodo (donde ya se ven las bajas en el suelo).
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

  const ronda = page.locator('button', { hasText: 'Tirar ronda' }).first();
  await ronda.click();
  await mkdir(OUT, { recursive: true });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, 'c2-despliegue.png') });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'c2-duelos.png') });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, 'c2-bajas.png') });

  if (errs.length > 0) {
    console.error('errores de consola:', errs.slice(0, 5).join(' | '));
  }
  console.log('capturas C2 escritas en test-results/');
  await browser.close();
  await close();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
