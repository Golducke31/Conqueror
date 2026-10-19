/// <reference lib="dom" />
/**
 * Smoke del modo online (Hito 6).
 *
 * Levanta un servidor Colyseus y un `vite preview` en puertos de prueba,
 * conecta DOS clientes reales y verifica el flujo completo:
 *
 *   1. El host crea una sala y aparece el link compartible.
 *   2. El amigo se une con el codigo: ve los dos asientos y NO puede arrancar.
 *   3. El host arranca: los dos llegan al tablero (mismo transporte, distinta
 *      vista).
 *   4. Una jugada del host se ve en la pantalla del amigo: el estado viaja por
 *      el servidor, no por el cliente.
 *
 * Uso: `pnpm build && pnpm smoke:online`
 */

import { spawn, type ChildProcess } from 'node:child_process';

import { chromium } from 'playwright';

import { OUTPUT_DIR, type Failure } from './lib/smoke-common.js';

const PUERTO_SERVER = 2571;
const PUERTO_WEB = 4188;
const WEB = `http://127.0.0.1:${PUERTO_WEB}`;

const fallas: Failure[] = [];

function fallar(mensaje: string): void {
  fallas.push({ check: 'online', detail: mensaje });
}

/** Baja el proceso hijo (y su arbol en Windows). */
function matar(proceso: ChildProcess): void {
  if (proceso.pid === undefined) return;
  try {
    proceso.kill();
  } catch {
    /* ya estaba muerto */
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(proceso.pid), '/T', '/F'], { shell: true });
  }
}

async function esperarServicio(url: string, segundos: number): Promise<boolean> {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    try {
      const respuesta = await fetch(url);
      if (respuesta.ok) return true;
    } catch {
      /* todavia no escucha */
    }
    await new Promise((listo) => setTimeout(listo, 400));
  }
  return false;
}

async function main(): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(OUTPUT_DIR, { recursive: true });

  const server = spawn('pnpm', ['--filter', '@conqueror/server', 'start'], {
    shell: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PUERTO_SERVER), HOST: '127.0.0.1' },
  });
  const vite = spawn(
    'pnpm',
    [
      '--filter',
      '@conqueror/client',
      'preview',
      '--port',
      String(PUERTO_WEB),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    {
      shell: true,
      stdio: 'ignore',
      env: { ...process.env, VITE_COLYSEUS: `ws://127.0.0.1:${PUERTO_SERVER}` },
    },
  );

  try {
    if (!(await esperarServicio(`http://127.0.0.1:${PUERTO_SERVER}/health`, 60))) {
      fallar('el servidor online no arranco');
      return;
    }
    if (!(await esperarServicio(WEB, 60))) {
      fallar('vite preview no arranco');
      return;
    }

    const browser = await chromium.launch();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const A = await ctxA.newPage();
    const B = await ctxB.newPage();

    for (const page of [A, B]) {
      page.on('pageerror', (error) => fallar(`pageerror: ${error.message}`));
    }

    // --- 1. El host crea la sala -------------------------------------------
    await A.goto(`${WEB}/?online=1&debug=1`);
    await A.locator('button[data-accion="crear-sala"]').click({ timeout: 15_000 });
    await A.locator('button[data-accion="empezar-online"]').waitFor({ timeout: 15_000 });

    const link = await A.locator('p.break-all').first().textContent();
    const codigo = /\?sala=([A-Za-z0-9_-]+)/.exec(link ?? '')?.[1];
    if (codigo === undefined) {
      fallar('no se encontro el link compartible en la sala');
      return;
    }

    // --- 2. El amigo se une con el codigo -----------------------------------
    await B.goto(`${WEB}/?sala=${codigo}&debug=1`);
    await B.locator('button[data-accion="empezar-online"]').waitFor({ timeout: 20_000 });
    // El amigo no es el host: el boton de arrancar tiene que estar apagado.
    if (await B.locator('button[data-accion="empezar-online"]').isEnabled()) {
      fallar('el amigo (no host) puede arrancar la partida');
    }
    const asientos = await B.locator('#hud div.grid.gap-2 > div').count();
    if (asientos !== 2) {
      fallar(`se esperaban 2 asientos en la sala y se vieron ${asientos}`);
    }

    // --- 3. El host arranca: los dos llegan al tablero ----------------------
    await A.locator('button[data-accion="empezar-online"]').click();
    const headerA = A.locator('#hud header[data-fase]');
    const headerB = B.locator('#hud header[data-fase]');
    await headerA.waitFor({ timeout: 90_000 });
    await headerB.waitFor({ timeout: 90_000 });

    for (const [nombre, header] of [
      ['host', headerA],
      ['amigo', headerB],
    ] as const) {
      const fase = await header.getAttribute('data-fase');
      if (fase !== 'setup-placement') {
        fallar(`${nombre}: fase inicial ${fase ?? '?'} (se esperaba setup-placement)`);
      }
    }

    // --- 4. Una jugada del host se ve en la pantalla del amigo -----------------
    // El estado viaja por el servidor: cuando el host coloca ejercitos, el
    // registro del amigo tiene que crecer con el mismo suceso.
    const lineas = (): Promise<number> => B.locator('#hud div.font-mono > div').count();
    const amigoAntes = await lineas();

    await A.locator('#hud button[data-territorio]').first().click({ timeout: 15_000 });
    await A.locator('#hud button[data-accion="colocar-todo"]').click({ timeout: 15_000 });

    let sincronizado = false;
    const limite = Date.now() + 30_000;
    while (Date.now() < limite && !sincronizado) {
      if ((await lineas()) > amigoAntes) sincronizado = true;
      else await A.waitForTimeout(300);
    }
    if (!sincronizado) {
      fallar('la jugada del host no se reflejo en la pantalla del amigo');
    }

    await A.screenshot({ path: `${OUTPUT_DIR}/smoke-online-host.png` });
    await B.screenshot({ path: `${OUTPUT_DIR}/smoke-online-amigo.png` });

    await browser.close();
  } finally {
    matar(vite);
    matar(server);
  }
}

// Watchdog: si algo se cuelga, el smoke no se queda colgado para siempre.
const watchdog = setTimeout(() => {
  console.error('[smoke:online] watchdog: tiempo agotado');
  process.exit(2);
}, 480_000);
watchdog.unref();

main().then(
  () => {
    if (fallas.length > 0) {
      for (const falla of fallas) console.error(`[online] ${falla.check}: ${falla.detail}`);
      process.exitCode = 1;
      return;
    }
    console.log('[smoke:online] OK');
  },
  (error: unknown) => {
    console.error('[smoke:online] error:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
