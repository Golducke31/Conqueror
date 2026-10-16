/// <reference lib="dom" />
/**
 * Capturas del Hito C4: mapa vivo (flecha de avance, frente caliente) y los
 * tres niveles de espectaculo, mas la calidad reducida forzada.
 *
 * Cuatro grupos, todos sobre el dist compilado:
 *
 *   1. FLECHA (pagina principal): con el territorio propio seleccionado se
 *      apunta un vecino enemigo: aparece la flecha de avance y el panel
 *      publica la probabilidad estimada de conquista. Las posiciones del
 *      mouse se calculan con la misma proyeccion del tablero y la misma pose
 *      de camara que usa el cliente: `focusOn` preserva el acimut, asi que la
 *      pose final es deterministica y se puede reproducir aca. El panel de
 *      depuracion (?debug=1) confirma que se toco el territorio correcto.
 *   2. CALOR (sandbox): cuatro rondas seguidas sobre el mismo par dejan el
 *      frente caliente; el shader oscurece los territorios y prende brasas
 *      en sus bordes. El panel del sandbox publica el calor numerico.
 *   3. NIVELES (sandbox): una ronda por nivel (Rapido, Tactico, Cinematico),
 *      capturada a mitad de la coreografia. Cada nivel reinicia el sandbox
 *      para jugar su secuencia completa (apertura + ronda).
 *   4. CALIDAD (sandbox): el casillero de calidad reducida fuerza lo que la
 *      calidad adaptativa aplica cuando baja el FPS (menos unidades y menos
 *      particulas), para poder verlo sin esperar a que la maquina se cuelgue.
 *
 * OJO con los tiempos: cada screenshot consume ~1.2 s de reloj (el readback
 * de WebGL en software es lento) y el cuadro capturado corresponde al estado
 * de la pagina ~1.2 s DESPUES del momento pedido. Los momentos de cada nivel
 * se esperan contra el RELOJ REAL y se eligen para que el cuadro real caiga
 * dentro de la ventana de coreografia buscada (duelo, reacomodo, resuelta)
 * con ese margen. La latencia de cada captura se imprime para verlo.
 */

import { createReadStream, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';
import { createMockGameState } from '../apps/client/src/app/fixtures.js';
import { createBoardProjection } from '../apps/client/src/map/projection.js';
import { estimateBattleOdds } from '../packages/rules/src/battle-odds.js';

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

// ---- Camara: la misma matematica que usa el cliente ----------------------

type Vec3 = readonly [number, number, number];

interface Pose {
  readonly cam: Vec3;
  readonly target: Vec3;
}

interface Punto {
  readonly x: number;
  readonly y: number;
}

/** Ventana del navegador (igual que el smoke test). */
const VIEWPORT = { width: 1440, height: 900 } as const;
/** fov vertical de la camara del cliente (renderer.ts: 45 grados). */
const FOV_TAN = Math.tan((45 * Math.PI) / 360);
const ASPECT = VIEWPORT.width / VIEWPORT.height;
/** Altura de la cara superior del relieve (boardGeometry: RELIEF). */
const RELIEF = 9;
const UP: Vec3 = [0, 1, 0];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const unit = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** Ejes de la camara (lookAt con up = +Y): x = up x z, y = z x x. */
function cameraAxes(pose: Pose): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = unit([
    pose.cam[0] - pose.target[0],
    pose.cam[1] - pose.target[1],
    pose.cam[2] - pose.target[2],
  ]);
  const x = unit(cross(UP, z));
  const y = cross(z, x);
  return { x, y, z };
}

/** Proyecta un punto del mundo a pixeles de pantalla (coordenadas CSS). */
function screenOf(pose: Pose, point: Vec3): Punto {
  const { x, y, z } = cameraAxes(pose);
  const view: Vec3 = [point[0] - pose.cam[0], point[1] - pose.cam[1], point[2] - pose.cam[2]];
  const vx = dot(view, x);
  const vy = dot(view, y);
  const vz = dot(view, z);
  const ndcX = vx / -vz / (FOV_TAN * ASPECT);
  const ndcY = vy / -vz / FOV_TAN;
  return {
    x: ((ndcX + 1) / 2) * VIEWPORT.width,
    y: ((1 - ndcY) / 2) * VIEWPORT.height,
  };
}

/** Pose inicial del tablero (createGameScene: 880 de distancia, 42 grados). */
const POSE_INICIAL: Pose = {
  cam: [0, 880 * Math.cos((42 * Math.PI) / 180), 880 * Math.sin((42 * Math.PI) / 180)],
  target: [0, 0, 0],
};

/**
 * Pose tras enfocar un territorio (main.ts: 320 de distancia, 44 grados).
 * `focusOn` preserva el acimut (0 en la pose inicial), asi que la camara
 * queda justo al sur del objetivo, mirando al norte.
 */
function poseEnfoque(x: number, z: number): Pose {
  const altura = 320 * Math.cos((44 * Math.PI) / 180);
  const sur = 320 * Math.sin((44 * Math.PI) / 180);
  return { cam: [x, altura, z + sur], target: [x, 0, z] };
}

// ---- Eleccion del par para la flecha --------------------------------------

interface ParFlecha {
  readonly from: string;
  readonly to: string;
  readonly fromArmies: number;
  readonly toArmies: number;
  /** Donde hacer clic para seleccionar el territorio propio. */
  readonly clic: Punto;
  /** Donde mover el mouse para apuntar el vecino enemigo. */
  readonly apuntar: Punto;
  /** Separacion entre anclas, para quedarse con la flecha mas larga. */
  readonly separacion: number;
}

/** True si el punto cae sobre una zona del HUD (no llega al lienzo). */
function sobreHud(punto: Punto): boolean {
  if (punto.y < 62) return true; // barra superior
  if (punto.x > 1136 && punto.y < 560) return true; // panel de detalle
  if (punto.x < 230 && punto.y > 790) return true; // panel de depuracion
  return false;
}

/**
 * Par para la captura de la flecha: un territorio PROPIO (p1, el jugador
 * activo de la pagina principal) con ejercitos de sobra y un vecino ENEMIGO
 * por frontera terrestre. Se elige el de anclas mas separadas entre los que
 * entran en el encuadre y quedan fuera de las zonas del HUD.
 */
function elegirPar(): ParFlecha {
  const lista = JSON.parse(
    readFileSync(join(REPO, 'apps/client/public/map/territories.json'), 'utf8'),
  ) as { territories: { id: string; labelAnchor: [number, number] }[] };
  const aristas = JSON.parse(
    readFileSync(join(REPO, 'apps/client/public/map/adjacency.json'), 'utf8'),
  ) as { edges: [string, string][] };
  const frentes = JSON.parse(
    readFileSync(join(REPO, 'apps/client/public/map/fronts.json'), 'utf8'),
  ) as { fronts: { a: string; b: string; kind: string }[] };

  const ids = lista.territories.map((entry) => entry.id);
  const neighbors: Record<string, string[]> = {};
  for (const [a, b] of aristas.edges) {
    (neighbors[a] ??= []).push(b);
    (neighbors[b] ??= []).push(a);
  }

  // Mismo estado que levanta la pagina principal (semilla 20261016, 4 jugadores).
  const state = createMockGameState({
    territoryIds: ids,
    neighbors,
    playerCount: 4,
    seed: 20261016,
  });
  const projection = createBoardProjection();

  const worldOf = (id: string): Vec3 => {
    const entry = lista.territories.find((candidate) => candidate.id === id);
    const point = projection.toWorld(entry?.labelAnchor[0] ?? 0, entry?.labelAnchor[1] ?? 0);
    return [point.x, RELIEF, point.z];
  };

  let mejor: ParFlecha | null = null;
  for (const from of ids) {
    const fromState = state.territories[from];
    // Propio (p1, el jugador activo) y con ejercitos de sobra para atacar.
    if (fromState === undefined || fromState.owner !== 'p1' || fromState.armies < 2) continue;
    const mundoFrom = worldOf(from);
    // Los limites de la camara recortan los bordes del tablero.
    if (Math.abs(mundoFrom[0]) > 550 || Math.abs(mundoFrom[2]) > 280) continue;

    for (const to of neighbors[from] ?? []) {
      const toState = state.territories[to];
      if (toState === undefined || toState.owner === null || toState.owner === 'p1') continue;
      const front = frentes.fronts.find(
        (candidate) =>
          (candidate.a === from && candidate.b === to) ||
          (candidate.a === to && candidate.b === from),
      );
      if (front === undefined || front.kind !== 'land') continue;

      const mundoTo = worldOf(to);
      const clic = screenOf(POSE_INICIAL, mundoFrom);
      const apuntar = screenOf(poseEnfoque(mundoFrom[0], mundoFrom[2]), mundoTo);
      const dentro =
        clic.x > 0 &&
        clic.x < VIEWPORT.width &&
        clic.y > 0 &&
        clic.y < VIEWPORT.height &&
        apuntar.x > 0 &&
        apuntar.x < VIEWPORT.width &&
        apuntar.y > 0 &&
        apuntar.y < VIEWPORT.height;
      if (!dentro || sobreHud(clic) || sobreHud(apuntar)) continue;

      const separacion = Math.hypot(mundoFrom[0] - mundoTo[0], mundoFrom[2] - mundoTo[2]);
      if (mejor === null || separacion > mejor.separacion) {
        mejor = {
          from,
          to,
          fromArmies: fromState.armies,
          toArmies: toState.armies,
          clic,
          apuntar,
          separacion,
        };
      }
    }
  }
  if (mejor === null) throw new Error('no se encontro un par propio -> enemigo para la flecha');
  return mejor;
}

async function main(): Promise<void> {
  const { url, close } = await start();
  const browser = await chromium.launch();
  // es-AR: el HUD y los paneles salen en espanol rioplatense.
  const contexto = await browser.newContext({ locale: 'es-AR', viewport: VIEWPORT });
  const page = await contexto.newPage();
  const errores: string[] = [];
  page.on('console', (mensaje) => {
    if (mensaje.type() === 'error') errores.push(mensaje.text());
  });
  page.on('pageerror', (error) => errores.push(`pageerror: ${error.message}`));

  const fallos: string[] = [];
  const comprobar = (nombre: string, ok: boolean, detalle: string): void => {
    if (!ok) fallos.push(`${nombre}: ${detalle}`);
  };

  const disparar = async (nombre: string): Promise<void> => {
    const inicio = Date.now();
    await page.screenshot({ path: join(OUT, nombre) });
    // La latencia del primer cuadro tras un clic delata el stall de la GPU.
    console.log(`[c4] ${nombre} (+${Date.now() - inicio} ms)`);
  };

  const hudTexto = async (): Promise<string> =>
    (await page
      .locator('#hud')
      .innerText()
      .catch(() => '')) || '';

  const depuracionTexto = async (): Promise<string> =>
    (await page
      .locator('#depuracion-lineas')
      .innerText()
      .catch(() => '')) || '';

  await mkdir(OUT, { recursive: true });

  // ---- 1. Flecha de avance y probabilidad estimada ------------------------
  const par = elegirPar();
  const probabilidad = Math.round(
    estimateBattleOdds(par.fromArmies, par.toArmies, DEFAULT_RULES_CONFIG).winProbability * 100,
  );
  console.log(
    `[c4] flecha: ${par.from} (${par.fromArmies} u) -> ${par.to} (${par.toArmies} u), ` +
      `probabilidad esperada ${probabilidad}%`,
  );

  await page.goto(`${url}?debug=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.innerText.includes('terr.'), undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  comprobar(
    'idioma',
    (await page.evaluate(() => document.documentElement.lang)) === 'es-AR',
    'la pagina no arranco en es-AR',
  );

  // Calentamiento: la primera captura de la sesion es la mas lenta (la GPU
  // de software entra en calor); se descarta.
  await disparar('c4-warmup.png');

  // Clic sobre el territorio propio: la camara lo encuadra (0.85 s).
  await page.mouse.click(par.clic.x, par.clic.y);
  await page.waitForTimeout(1900);
  const trasClic = await depuracionTexto();
  comprobar(
    'seleccion',
    trasClic.includes(`Seleccionado: ${par.from}`),
    `la depuracion no muestra ${par.from} (texto: "${trasClic.replace(/\n/g, ' | ')}")`,
  );

  // Apuntar el vecino enemigo: aparece la flecha y la probabilidad.
  await page.mouse.move(par.apuntar.x, par.apuntar.y);
  await page.waitForTimeout(700);
  const trasApuntar = await depuracionTexto();
  comprobar(
    'apuntado',
    trasApuntar.includes(`Apuntado: ${par.to}`),
    `la depuracion no muestra ${par.to} (texto: "${trasApuntar.replace(/\n/g, ' | ')}")`,
  );
  const panel = await hudTexto();
  // 'Ataque' lleva transformacion uppercase: innerText devuelve 'ATAQUE'.
  comprobar(
    'caja-ataque',
    panel.toLowerCase().includes('ataque'),
    `el panel no abre la caja de ataque (texto: "${panel.slice(0, 140)}")`,
  );
  comprobar(
    'probabilidad',
    panel.includes(`Probabilidad de conquista: ${probabilidad}%`),
    `el panel no muestra ${probabilidad}% (texto: "${panel.slice(0, 140)}")`,
  );

  await disparar('c4-flecha.png');
  await page.waitForTimeout(900);
  await disparar('c4-flecha-2.png');

  // ---- 2. Frente caliente (sandbox) ---------------------------------------
  await page.goto(`${url}debug/combat`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.innerText.includes('Sandbox'), undefined, {
    timeout: 15_000,
  });
  await page.waitForTimeout(1500);
  await disparar('c4-warmup.png');

  const selectorOrigen = page.locator('select').nth(0);
  const selectorDestino = page.locator('select').nth(1);
  const selectorNivel = page.locator('select').nth(2);
  const botonRonda = page.locator('button', { hasText: 'Tirar ronda' }).first();
  const botonReiniciar = page.locator('button', { hasText: 'Reiniciar' }).first();

  /** Elige el par del frente (Alemania contra Francia, colores contrastados). */
  const elegirParArena = async (): Promise<void> => {
    await selectorOrigen.selectOption('alemania');
    await selectorDestino.selectOption('francia');
  };

  // Cuatro rondas seguidas: cada una sube el calor de los dos territorios.
  // Tactico tarda ~1.7 s por ronda (la primera ademas abre el campo: 3.1 s).
  await elegirParArena();
  for (let ronda = 0; ronda < 4; ronda += 1) {
    await botonRonda.click();
    await page.waitForTimeout(ronda === 0 ? 3400 : 2600);
  }
  // Se espera a que la escena cierre (el calor ya quedo en el tablero).
  await page.waitForTimeout(2600);
  const panelCalor = await hudTexto();
  comprobar(
    'calor',
    /Calor: 0\.[1-9]/.test(panelCalor),
    `el panel no publica calor (texto: "${panelCalor.slice(-160)}")`,
  );
  await disparar('c4-calor.png');

  // ---- 3. Los tres niveles de espectaculo ---------------------------------
  // Duraciones de cada nivel: Tactico abre en 0.84 s y sus duelos corren de
  // 1.44 a 2.24 s; Cinematico abre en 1.19 s y sus duelos de 2.04 a 3.29 s;
  // Rapido entra directo (la camara no se mueve) y su ronda dura 0.58 s.
  //
  // Cada captura consume ~1.2 s de reloj y el cuadro capturado corresponde al
  // estado ~1.2 s despues del momento pedido, asi que los momentos se eligen
  // para que el cuadro REAL caiga en la ventana buscada: Cinematico pide 1.7 s
  // (duelo, margen de sobra) y 2.9 s (reacomodo / fin de ronda); Rapido pide
  // 0.32 s sabiendo que su ronda ya resolvio: lo que se ve es justamente su
  // marca, el encuadre amplio porque la camara nunca se acerca.
  const niveles: readonly (readonly [string, readonly number[], string])[] = [
    ['fast', [0.32], 'c4-nivel-rapido'],
    ['tactical', [0.55, 2.0], 'c4-nivel-tactico'],
    ['cinematic', [1.7, 2.9], 'c4-nivel-cinematico'],
  ];

  for (const [nivel, momentos, prefijo] of niveles) {
    // Reiniciar vuelve la camara al mundo y limpia el calor: cada nivel
    // juega su secuencia completa (apertura + ronda).
    await botonReiniciar.click();
    await page.waitForTimeout(800);
    await elegirParArena();
    await selectorNivel.selectOption(nivel);
    const inicioRonda = Date.now();
    await botonRonda.click();
    for (const [indice, momento] of momentos.entries()) {
      const restante = momento * 1000 - (Date.now() - inicioRonda);
      if (restante > 0) await page.waitForTimeout(restante);
      await disparar(`${prefijo}-${indice + 1}.png`);
    }
    await page.waitForTimeout(2200); // fin de la ronda y cierre de la escena
  }

  // ---- 4. Calidad reducida forzada ----------------------------------------
  await botonReiniciar.click();
  await page.waitForTimeout(800);
  await elegirParArena();
  // Mismo nivel y mismos momentos que la captura Tactico: la unica diferencia
  // entre ambos pares de imagenes es la calidad.
  await selectorNivel.selectOption('tactical');
  const casillero = page.locator('input[type="checkbox"]').first();
  await casillero.check();
  const panelCalidad = await hudTexto();
  comprobar(
    'calidad',
    panelCalidad.includes('Calidad: reducida (4 u, x0.30)'),
    `el panel no publica calidad reducida (texto: "${panelCalidad.slice(-120)}")`,
  );
  // Despliegue con 4 unidades por bando (en plena calidad son 12 y 8) y un
  // duelo a la misma altura que la captura Tactico, para comparar.
  const inicioCalidad = Date.now();
  await botonRonda.click();
  for (const [indice, momento] of [0.5, 2.0].entries()) {
    const restante = momento * 1000 - (Date.now() - inicioCalidad);
    if (restante > 0) await page.waitForTimeout(restante);
    await disparar(`c4-calidad-${indice + 1}.png`);
  }
  await page.waitForTimeout(1500);

  // La captura de calentamiento se descarta.
  const calentamiento = join(OUT, 'c4-warmup.png');
  if (existsSync(calentamiento)) unlinkSync(calentamiento);

  if (errores.length > 0) {
    console.error('errores de consola:', errores.slice(0, 5).join(' | '));
  }
  for (const fallo of fallos) console.error(`[c4] FALLO ${fallo}`);
  if (fallos.length > 0 || errores.length > 0) process.exitCode = 1;

  console.log('capturas C4 escritas en test-results/');
  await browser.close();
  await close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
