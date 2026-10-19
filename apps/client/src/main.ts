/**
 * Arranque del cliente (Hitos 4 y 5).
 *
 * Modos:
 *   - por defecto      landing (Hito 5), la puerta de entrada.
 *   - `?jugar=1`       pantalla de configuracion de partida local.
 *   - `?explorar=1`    tablero con datos de prueba, sin reglas (Hito 2).
 *   - `?auto=1`        arranca directo una partida local (por defecto, de bots):
 *                      la usan el smoke e2e y las pruebas manuales del flujo.
 *
 * La landing entra por import dinamico: quien va directo a jugar no descarga
 * GSAP, Lenis ni su CSS.
 */

import './styles/main.css';

import type { TerritoryId } from '@conqueror/shared';
import { DEFAULT_RULES_CONFIG, PLAYER_COLOR_ORDER, type PlayerColorId } from '@conqueror/shared';
import { LOCALE_CHANGE_EVENT, detectLocale, getLocale, setLocale, t } from './app/i18n.js';
import { createMockGameState, type MockGameState } from './app/fixtures.js';
import { playerColor } from './app/palette.js';
import { createRenderer, type RendererHandle } from './render/renderer.js';
import { createGameScene, type AttackOddsInfo, type GameScene } from './scenes/game/GameScene.js';
import { startMatch, type MatchApp } from './scenes/game/matchApp.js';
import { renderSetup, type LocalGameSetup } from './ui/setup.js';
import type { GameTransport } from './net/transport.js';

const params = new URLSearchParams(window.location.search);
const debugActivo = params.get('debug') === '1' || params.get('debug') === 'combat';
const modoExplorar = params.get('explorar') === '1';

function nodo(etiqueta: string, clase: string, texto?: string): HTMLElement {
  const element = document.createElement(etiqueta);
  element.className = clase;
  if (texto !== undefined) element.textContent = texto;
  return element;
}

function esTactil(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Limita un entero al rango; si no es numero, devuelve el por defecto. */
function limitar(valor: number, minimo: number, maximo: number, porDefecto: number): number {
  if (!Number.isFinite(valor)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, Math.round(valor)));
}

/**
 * Partida automatica (smoke e2e y pruebas de flujo): jugadores bots salvo los
 * primeros `humanos`, semilla fija por defecto para resultados reproducibles.
 */
function setupAutomatica(): LocalGameSetup {
  const config = DEFAULT_RULES_CONFIG;
  const total = limitar(Number(params.get('jugadores')), config.players.min, config.players.max, 3);
  const humanos = limitar(Number(params.get('humanos')), 0, total, 0);
  const semilla = limitar(Number(params.get('semilla')), 1, 9_999_999, 20261017);

  const players = Array.from({ length: total }, (_, indice) => {
    const bot = indice >= humanos;
    return {
      id: `p${indice + 1}`,
      name: bot ? `Bot ${indice + 1}` : `Jugador ${indice + 1}`,
      color: (PLAYER_COLOR_ORDER[indice] ?? 'rojo') as PlayerColorId,
      bot,
    };
  });

  return {
    players,
    seed: semilla,
    config,
    botPlayers: players.filter((player) => player.bot).map((player) => player.id),
  };
}

// -----------------------------------------------------------------------------
// Modo exploracion (tablero con datos de prueba, del Hito 2)
// -----------------------------------------------------------------------------

interface AppState {
  scene: GameScene | null;
  gameState: MockGameState | null;
  selected: TerritoryId | null;
  hovered: TerritoryId | null;
  /** Destino de ataque posible bajo el cursor, con su probabilidad. */
  attackOdds: AttackOddsInfo | null;
  error: string | null;
  errorDetalle: string | null;
}

const app: AppState = {
  scene: null,
  gameState: null,
  selected: null,
  hovered: null,
  attackOdds: null,
  error: null,
  errorDetalle: null,
};

function barraSuperior(): HTMLElement {
  const barra = nodo(
    'header',
    'pointer-events-auto flex flex-wrap items-center justify-between gap-3 border-b border-lana-3/60 bg-hilo/80 px-4 py-2.5 backdrop-blur-sm sm:px-6',
  );

  const marca = nodo('div', 'flex items-baseline gap-3');
  marca.append(
    nodo('h1', 'font-display text-lg tracking-wide text-qolli sm:text-xl', t('app.nombre')),
    nodo('p', 'hidden text-xs uppercase tracking-[0.2em] text-algodon/55 sm:block', t('app.lema')),
  );

  const jugadores = nodo('div', 'flex flex-wrap items-center gap-2');
  for (const player of app.gameState?.players ?? []) {
    const color = playerColor(player.color);
    const chip = nodo(
      'span',
      'inline-flex items-center gap-2 rounded-full border border-lana-3 bg-lana-2/70 px-2.5 py-1 text-xs text-algodon/85',
    );
    const punto = nodo('span', 'inline-block h-2.5 w-2.5 rounded-full');
    punto.style.backgroundColor = `#${color.getHexString()}`;
    const territorios = Object.values(app.gameState?.territories ?? {}).filter(
      (territory) => territory.owner === player.id,
    ).length;
    const ejercitos = Object.values(app.gameState?.territories ?? {})
      .filter((territory) => territory.owner === player.id)
      .reduce((total, territory) => total + territory.armies, 0);
    chip.append(
      punto,
      nodo('span', 'font-semibold', player.name),
      nodo('span', 'text-algodon/55', `${territorios} ${t('hud.territorios')}`),
      nodo('span', 'text-algodon/55', `${ejercitos} ${t('hud.ejercitos')}`),
    );
    jugadores.append(chip);
  }

  const idiomas = nodo('div', 'flex items-center gap-2');
  idiomas.append(nodo('span', 'sr-only', t('accion.idioma')));
  for (const locale of ['es-AR', 'en'] as const) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = locale === 'es-AR' ? 'ES' : 'EN';
    boton.dataset.locale = locale;
    boton.setAttribute('aria-pressed', String(locale === getLocale()));
    boton.className =
      'rounded-md border border-lana-3 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ' +
      'text-algodon/70 transition-colors hover:border-qolli hover:text-qolli ' +
      'aria-pressed:border-qolli aria-pressed:bg-qolli/15 aria-pressed:text-qolli';
    boton.addEventListener('click', () => setLocale(locale));
    idiomas.append(boton);
  }

  barra.append(marca, jugadores, idiomas);
  return barra;
}

/** Panel lateral con el detalle del territorio seleccionado. */
function panelDetalle(): HTMLElement {
  const contenedor = nodo(
    'aside',
    'pointer-events-auto w-64 rounded-lg border border-lana-3/70 bg-lana/85 p-3 shadow-xl shadow-hilo/50 backdrop-blur-sm sm:w-72 sm:p-4',
  );
  contenedor.append(
    nodo(
      'h2',
      'text-[11px] font-semibold uppercase tracking-[0.18em] text-qolli',
      t('hud.territorio'),
    ),
  );

  const id = app.selected ?? app.hovered;
  if (id === null || app.scene === null) {
    contenedor.append(nodo('p', 'mt-2 text-sm text-algodon/60', t('hud.sinSeleccion')));
    contenedor.append(
      nodo('p', 'mt-3 text-[11px] leading-relaxed text-algodon/45', t('hud.ayuda')),
    );
    return contenedor;
  }

  const entry = app.scene.data.byId.get(id);
  const estado = app.gameState?.territories[id];
  const jugador = app.gameState?.players.find((player) => player.id === estado?.owner);

  const titulo = nodo('div', 'mt-1 flex items-center gap-2');
  if (jugador !== undefined) {
    const punto = nodo('span', 'inline-block h-3 w-3 rounded-full');
    punto.style.backgroundColor = `#${playerColor(jugador.color).getHexString()}`;
    titulo.append(punto);
  }
  titulo.append(
    nodo('span', 'font-display text-base text-algodon', entry?.names[getLocale()] ?? id),
  );
  contenedor.append(titulo);

  const filas: readonly (readonly [string, string])[] = [
    [t('hud.dueno'), jugador?.name ?? t('hud.sinDueno')],
    [t('hud.ejercitos'), String(estado?.armies ?? 0)],
    [t('hud.fronteras'), String(app.scene.data.adjacency.byTerritory[id]?.length ?? 0)],
    [
      t('hud.fichas'),
      String(app.scene.data.fronts.fronts.filter((f) => f.a === id || f.b === id).length),
    ],
  ];

  const lista = nodo('dl', 'mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm');
  for (const [clave, valor] of filas) {
    lista.append(
      nodo('dt', 'text-algodon/55', clave),
      nodo('dd', 'text-right text-algodon', valor),
    );
  }
  contenedor.append(lista);

  const vecinos = app.scene.data.adjacency.byTerritory[id] ?? [];
  if (vecinos.length > 0) {
    const vecinosBox = nodo('div', 'mt-3 border-t border-lana-3/60 pt-2');
    vecinosBox.append(
      nodo('p', 'text-[11px] uppercase tracking-wider text-algodon/45', t('hud.fronteras')),
    );
    const listaVecinos = nodo('div', 'mt-1 flex flex-wrap gap-1');
    for (const vecino of vecinos) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = app.scene.data.byId.get(vecino)?.names[getLocale()] ?? vecino;
      chip.className =
        'rounded border border-lana-3 px-1.5 py-0.5 text-[11px] text-algodon/70 hover:border-qolli hover:text-qolli';
      chip.addEventListener('click', () => seleccionar(vecino));
      listaVecinos.append(chip);
    }
    vecinosBox.append(listaVecinos);
    contenedor.append(vecinosBox);
  }

  // Ataque apuntado: flecha en el mapa y probabilidad estimada de conquista.
  if (app.attackOdds !== null && app.scene !== null) {
    const origen =
      app.scene.data.byId.get(app.attackOdds.from)?.names[getLocale()] ?? app.attackOdds.from;
    const destino =
      app.scene.data.byId.get(app.attackOdds.to)?.names[getLocale()] ?? app.attackOdds.to;
    const caja = nodo('div', 'mt-3 rounded border border-grana/60 bg-grana/10 p-2');
    caja.append(
      nodo('p', 'text-[11px] uppercase tracking-wider text-grana', t('hud.ataque')),
      nodo('p', 'mt-1 text-sm text-algodon', `${origen} → ${destino}`),
      nodo(
        'p',
        'mt-1 text-sm font-semibold text-qolli',
        t('hud.probabilidad', { valor: Math.round(app.attackOdds.probability * 100) }),
      ),
    );
    contenedor.append(caja);
  }

  return contenedor;
}

function panelError(): HTMLElement {
  const contenedor = nodo('div', 'flex flex-1 items-center justify-center p-6');
  const caja = nodo(
    'section',
    'pointer-events-auto w-full max-w-lg rounded-xl border border-grana/70 bg-lana/90 p-6',
  );
  caja.setAttribute('role', 'alert');
  caja.append(
    nodo('h2', 'font-display text-lg text-grana', app.error ?? ''),
    nodo('p', 'mt-2 text-sm text-algodon/70', app.errorDetalle ?? ''),
  );
  contenedor.append(caja);
  return contenedor;
}

function panelCargando(): HTMLElement {
  const contenedor = nodo('div', 'flex flex-1 items-center justify-center p-6');
  const caja = nodo(
    'section',
    'pointer-events-none rounded-xl border border-lana-3/70 bg-lana/80 px-6 py-4 text-center',
  );
  caja.setAttribute('role', 'status');
  caja.append(nodo('p', 'font-display text-base text-algodon', t('hud.cargandoMapa')));
  contenedor.append(caja);
  return contenedor;
}

function seleccionar(id: TerritoryId | null): void {
  app.selected = id;
  if (id !== null) app.scene?.focusTerritory(id, { distance: 300, polarDeg: 46 });
  pintar();
}

function pintar(): void {
  const hud = document.getElementById('hud');
  if (hud === null) return;

  if (app.error !== null) {
    hud.replaceChildren(barraSuperior(), panelError());
    return;
  }
  if (app.scene === null) {
    hud.replaceChildren(barraSuperior(), panelCargando());
    return;
  }

  const cuerpo = nodo('div', 'flex min-h-0 flex-1 items-start justify-between gap-4 p-3 sm:p-5');
  cuerpo.append(panelDetalle());
  hud.replaceChildren(barraSuperior(), cuerpo);
}

function montarDepuracion(handle: RendererHandle, scene: GameScene): void {
  const panel = document.getElementById('depuracion');
  if (panel === null) return;
  panel.classList.remove('hidden');

  const titulo = nodo('div', 'mb-1 font-semibold text-qolli', t('debug.titulo'));
  const lineas = nodo('div', 'whitespace-pre');
  lineas.id = 'depuracion-lineas';
  panel.replaceChildren(titulo, lineas);

  window.setInterval(() => {
    const stats = handle.stats();
    const contexto = handle.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1';
    const apuntado = app.hovered ?? app.selected;
    const modelos = scene.models.state();
    const cargados = modelos.reports.filter((report) => report.status === 'loaded').length;
    lineas.textContent = [
      `${t('debug.fps')}: ${stats.fps}`,
      `${t('debug.drawcalls')}: ${stats.drawCalls}`,
      `${t('debug.triangulos')}: ${stats.triangles}`,
      `${t('debug.contexto')}: ${contexto}`,
      `${t('debug.unidades')}: ${scene.visibleUnits()}`,
      `${t('debug.modelos')}: ${modelos.reports.length === 0 ? '-' : `${cargados}/${modelos.reports.length}`}`,
      `${t('debug.calor')}: ${apuntado === null ? '-' : scene.heatOf(apuntado).toFixed(2)}`,
      `${t('debug.seleccionado')}: ${app.selected ?? '-'}`,
      `${t('debug.apuntado')}: ${app.hovered ?? '-'}`,
    ].join('\n');
  }, 500);
}

async function arrancarExploracion(canvas: HTMLCanvasElement): Promise<void> {
  const jugadoresIniciales = Math.max(2, Math.min(6, Number(params.get('jugadores') ?? '4')));

  pintar();

  let handle: RendererHandle;
  try {
    handle = createRenderer(canvas);
  } catch (error) {
    app.error = t('error.webgl');
    app.errorDetalle = error instanceof Error ? error.message : String(error);
    pintar();
    return;
  }

  try {
    const scene = await createGameScene({
      renderer: handle,
      canvas,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      mapMaxUnits: esTactil() ? 3 : 5,
      rules: DEFAULT_RULES_CONFIG,
    });

    app.scene = scene;
    handle.scene.add(scene.group);

    const gameState = createMockGameState({
      territoryIds: scene.board.territoryIds,
      neighbors: scene.data.adjacency.byTerritory,
      playerCount: jugadoresIniciales,
      seed: 20261016,
    });
    app.gameState = gameState;
    scene.setGameState(gameState);

    // Modo exploracion: no hay partida, asi que el clic solo elige y encuadra.
    // La logica de origen/destino vive en la partida (scenes/game/matchApp).
    scene.onPick((id) => {
      app.selected = id;
      scene.setSelection({ origin: id, target: null });
      if (id !== null) scene.focusTerritory(id, { distance: 320, polarDeg: 44 });
      pintar();
    });

    // El objetivo de ataque bajo el cursor cambio (o desaparecio): se refresca
    // el panel para mostrar u ocultar la probabilidad estimada.
    scene.onAttackOdds((info) => {
      app.attackOdds = info;
      pintar();
    });

    handle.onFrame((delta) => {
      scene.update(delta);
      app.hovered = scene.hovered();
    });

    handle.requestRender();
    pintar();

    if (debugActivo) montarDepuracion(handle, scene);
  } catch (error) {
    app.error = t('error.mapa');
    app.errorDetalle = `${t('error.mapa.detalle')} (${error instanceof Error ? error.message : String(error)})`;
    pintar();
  }

  const alCambiarIdioma = (): void => {
    // Los nombres estan horneados en el atlas del mapa: se rehacen.
    app.scene?.refreshLabels();
    pintar();
  };
  document.addEventListener(LOCALE_CHANGE_EVENT, alCambiarIdioma);
}

// -----------------------------------------------------------------------------
// Modo partida local
// -----------------------------------------------------------------------------

/**
 * Arranca la partida y devuelve el control para descartarla. Es el mismo
 * camino para el modo local y el online (Hito 6): la diferencia es el
 * transporte con el que habla `matchApp`.
 */
async function iniciarPartida(
  opciones: {
    setup: LocalGameSetup;
    transporte?: GameTransport;
    online?: boolean;
    playerId?: string;
  },
  canvas: HTMLCanvasElement,
  hud: HTMLElement,
): Promise<MatchApp> {
  // Contenedor del cartel de relevo (hot-seat), por encima de todo.
  const relevo = nodo('div', 'hidden');
  relevo.id = 'relevo';
  document.body.append(relevo);

  const partida = await startMatch({
    setup: opciones.setup,
    canvas,
    hud,
    relevo,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    botDelayMs: limitar(Number(params.get('delay')), 0, 5000, 700),
    ...(opciones.transporte === undefined ? {} : { transport: opciones.transporte }),
    ...(opciones.online === true ? { online: true } : {}),
    ...(opciones.playerId === undefined ? {} : { localPlayerId: opciones.playerId }),
    ...(debugActivo ? { debug: true } : {}),
    onExit: () => {
      // Se libera la partida completa (worker, render, escenas) antes de
      // volver: si no, la anterior sigue corriendo.
      partida.dispose();
      relevo.remove();
      hud.replaceChildren();
      if (opciones.online === true) {
        window.location.href = './?online=1';
        return;
      }
      renderSetup(hud, {
        config: DEFAULT_RULES_CONFIG,
        onStart: (nuevo) => void iniciarPartida({ setup: nuevo }, canvas, hud),
      });
    },
  });
  return partida;
}

async function arrancarPartida(
  setup: LocalGameSetup,
  canvas: HTMLCanvasElement,
  hud: HTMLElement,
): Promise<void> {
  try {
    await iniciarPartida({ setup }, canvas, hud);
  } catch (error) {
    hud.replaceChildren();
    const caja = nodo(
      'section',
      'pointer-events-auto mx-auto mt-16 w-full max-w-lg rounded-xl border border-grana/70 bg-lana/90 p-6',
    );
    caja.setAttribute('role', 'alert');
    caja.append(
      nodo('h2', 'font-display text-lg text-grana', t('error.mapa')),
      nodo(
        'p',
        'mt-2 text-sm text-algodon/70',
        error instanceof Error ? error.message : String(error),
      ),
    );
    hud.append(caja);
  }
}

async function main(): Promise<void> {
  setLocale(detectLocale());

  const hud = document.getElementById('hud');
  const canvas = document.getElementById('lienzo');
  if (hud === null || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Falta el HUD o el lienzo en index.html');
  }

  if (modoExplorar) {
    await arrancarExploracion(canvas);
    return;
  }

  if (params.get('auto') === '1') {
    await arrancarPartida(setupAutomatica(), canvas, hud);
    return;
  }

  // --- Modo online (Hito 6) -----------------------------------------------------
  // `?sala=CODE` entra directo a una sala compartida; `?online=1` abre el lobby
  // (crear o unirse). El modulo se carga en diferido: quien juega local o mira
  // la landing no baja el SDK de Colyseus.
  const codigoSala = params.get('sala');
  if (codigoSala !== null || params.get('online') === '1') {
    const { renderOnline } = await import('./ui/online.js');
    renderOnline(hud, {
      ...(codigoSala === null ? {} : { codigoInicial: codigoSala }),
      onStart: (setup, transporte, playerId) =>
        void iniciarPartida({ setup, transporte, online: true, playerId }, canvas, hud),
    });
    return;
  }

  const abrirConfiguracion = (): void => {
    renderSetup(hud, {
      config: DEFAULT_RULES_CONFIG,
      onStart: (setup) => arrancarPartida(setup, canvas, hud),
    });
  };

  if (params.get('jugar') === '1') {
    abrirConfiguracion();
    return;
  }

  // --- Landing (Hito 5) ------------------------------------------------------
  const { mountLanding } = await import('./ui/landing.js');
  const landing = mountLanding({
    onPlay: () => {
      landing.dispose();
      // URL propia para que se pueda compartir y para que el boton "atras"
      // tenga a donde volver.
      window.history.pushState({}, '', '?jugar=1');
      abrirConfiguracion();
    },
    onExplore: () => {
      window.location.href = '?explorar=1';
    },
  });

  // Volver atras desde la configuracion tiene que devolver la landing. El
  // estado de la landing no se conserva: se recarga, que es mas simple y
  // siempre consistente.
  window.addEventListener('popstate', () => window.location.reload(), { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void main(), { once: true });
} else {
  void main();
}
