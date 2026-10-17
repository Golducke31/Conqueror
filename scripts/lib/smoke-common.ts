/**
 * Libreria compartida de los smoke tests.
 *
 * Dos scripts la usan, y van por separado a proposito: cada uno levanta su
 * propio navegador y su propio servidor. Correr todo en un solo proceso los
 * degradaba (una partida larga deja el contexto con mucho estado y las
 * secciones siguientes se colgaban).
 *
 *   - `smoke-client.ts`: pantallas y sandboxes (setup, tablero, combate, etc.)
 *   - `smoke-match.ts`:  partida local de punta a punta.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from 'playwright';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DIST_DIR = join(REPO_ROOT, 'apps', 'client', 'dist');
export const OUTPUT_DIR = join(REPO_ROOT, 'test-results');

/** Semilla fija: la partida de bots del smoke es reproducible. */
export const SEMILLA = 20261017;

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

/** Los 19 slots del manifiesto de audio (ADR 0011). */
export const SLOTS_SONIDO: readonly string[] = [
  'dice.roll',
  'dice.land',
  'dice.win',
  'dice.lose',
  'infantry.march',
  'infantry.volley',
  'infantry.death',
  'cavalry.charge',
  'cavalry.impact',
  'cannon.fire',
  'cannon.impact',
  'ship.sail',
  'ship.cannon',
  'ship.landing',
  'flag.plant',
  'territory.conquered',
  'battle.ambience.low',
  'battle.ambience.mid',
  'battle.ambience.high',
];

/** Los cuatro tipos de unidad que pueden tener modelo propio (ADR 0012). */
export const TIPOS_MODELO: readonly string[] = ['infantry', 'cavalry', 'artillery', 'ship'];

export interface Failure {
  readonly check: string;
  readonly detail: string;
}

/** Reescribe las rutas de depuracion sin `.html`, igual que el dev server. */
export function rewriteDebugRoute(url: string): string {
  if (url === '/debug/combat' || url === '/debug/combat/') return '/debug/combat.html';
  if (url === '/debug/sounds' || url === '/debug/sounds/') return '/debug/sounds.html';
  if (url === '/debug/models' || url === '/debug/models/') return '/debug/models.html';
  return url;
}

export function startStaticServer(): Promise<{ url: string; close: () => Promise<void> }> {
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

/** Recolector de errores de consola y red, por pagina. */
export class Errores {
  readonly consola: string[] = [];
  readonly red: string[] = [];

  escuchar(page: Page): void {
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const ubicacion = message.location().url;
      this.consola.push(ubicacion === '' ? message.text() : `${message.text()} <${ubicacion}>`);
    });
    page.on('pageerror', (error) => this.consola.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      // Los 404 esperados (los archivos que el usuario todavia no aporto) no
      // cuentan: el juego tiene que funcionar sin ellos.
      if (response.status() < 400) return;
      const responseUrl = response.url();
      if (responseUrl.includes('/audio/combat/') || responseUrl.includes('/models/combat/')) return;
      this.red.push(`${response.status()} ${responseUrl}`);
    });
  }
}

/** Espera a que el cartel de relevo no este visible (turno de un humano activo). */
export async function esperarSinRelevo(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const el = document.getElementById('relevo');
        return el === null || el.className.includes('hidden') || el.children.length === 0;
      },
      undefined,
      { timeout: 20_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Coloca una tanda completa del jugador de turno con el atajo "Colocar todo". */
export async function colocarTodo(page: Page): Promise<boolean> {
  // El relevo tapa el HUD: si esta visible, no se puede colocar (y quien llama
  // debe pasarlo). Se espera a que desaparezca antes del primer clic.
  if (!(await esperarSinRelevo(page))) return false;

  const territorio = page.locator('#hud button[data-territorio]').first();
  if ((await territorio.count()) === 0) return false;
  // Reintento: el relevo puede aparecer entre la espera y el clic.
  for (let intento = 0; intento < 5; intento += 1) {
    try {
      await territorio.click({ timeout: 5000 });
      break;
    } catch {
      if (!(await esperarSinRelevo(page))) return true;
    }
  }

  for (let intento = 0; intento < 30; intento += 1) {
    // Si aparecio el relevo (el turno paso a otro humano), se detiene.
    const cartel = page.locator('#relevo');
    if ((await cartel.count()) > 0 && (await cartel.first().isVisible())) return true;
    const boton = page.locator('#hud button[data-accion="colocar-todo"]');
    if ((await boton.count()) === 0) break;
    if (!(await boton.first().isEnabled())) break;
    await boton.first().click();
    await page.waitForTimeout(80);
  }
  return true;
}

/**
 * Juega el despliegue inicial: coloca solo en los turnos de los humanos
 * indicados (los bots los juega el motor) y pasa los relevos que aparezcan.
 * Termina cuando la partida sale de `setup-placement`.
 */
export async function desplegarCompleto(
  page: Page,
  faseHeader: ReturnType<Page['locator']>,
  humanos: readonly string[],
): Promise<boolean> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const fase = await faseHeader.getAttribute('data-fase');
    if (fase !== 'setup-placement') return true;

    const cartel = page.locator('#relevo');
    if ((await cartel.count()) > 0 && (await cartel.first().isVisible())) {
      await page.locator('#relevo button').first().click();
      await page.waitForTimeout(300);
      continue;
    }

    const activo = await faseHeader.getAttribute('data-activo');
    if (activo === null || !humanos.includes(activo)) {
      await page.waitForTimeout(250);
      continue;
    }
    await colocarTodo(page);
    await page.waitForTimeout(250);
  }
  return false;
}

/** Imprime el resultado y fija el codigo de salida. */
export function reportar(nombre: string, failures: Failure[], errores: Errores): void {
  if (errores.consola.length > 0) {
    failures.push({ check: 'consola', detail: errores.consola.slice(0, 5).join(' | ') });
  }
  if (errores.red.length > 0) {
    failures.push({ check: 'recursos', detail: errores.red.slice(0, 5).join(' | ') });
  }

  if (failures.length > 0) {
    console.error(`[${nombre}] FALLO con ${failures.length} problema(s):`);
    for (const failure of failures) console.error(`  - ${failure.check}: ${failure.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[${nombre}] OK`);
}
