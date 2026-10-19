/**
 * Lobby online (Hito 6).
 *
 * Pantalla para jugar con otra persona: crear una sala (y compartir el link),
 * o unirse con el codigo. El lobby arma la sala de Colyseus con el SDK del
 * cliente, muestra los asientos en vivo y, cuando arranca la partida, le pasa
 * el transporte ya conectado a `matchApp`: la partida en si es la misma.
 *
 * Ver docs/adr/0016-modo-online.md
 */

import { Client, type Room as RoomColyseus } from '@colyseus/sdk';

import type { GameSpec, SeatInfo, ServerMessage } from '@conqueror/rules';
import type { PlayerColorId } from '@conqueror/shared';
import { DEFAULT_RULES_CONFIG, PLAYER_COLOR_ORDER } from '@conqueror/shared';

import { t } from '../app/i18n.js';
import { ColyseusTransport, endpointOnline } from '../net/colyseusTransport.js';
import type { LocalGameSetup } from './setup.js';
import { boton, campo, nodo } from './dom.js';

export interface OnlineOpciones {
  /** Arranca la partida con el setup y el transporte ya conectados. */
  readonly onStart: (
    setup: LocalGameSetup,
    transporte: ColyseusTransport,
    playerId: string,
  ) => void;
  /** Codigo para unirse de una (link compartido `?sala=CODE`). */
  readonly codigoInicial?: string;
}

/** Hex por color de jugador (igual que la pantalla local). */
function colorHex(color: PlayerColorId): string {
  const hex: Readonly<Record<PlayerColorId, string>> = {
    rojo: 'c0392b',
    azul: '2f6fb5',
    amarillo: 'e2a72e',
    verde: '2f6b4f',
    negro: '2e3440',
    magenta: 'a03a8c',
  };
  return hex[color] ?? 'c0392b';
}

function nombreGuardado(): string {
  try {
    return window.localStorage.getItem('conqueror.nombre') ?? '';
  } catch {
    return '';
  }
}

function guardarNombre(nombre: string): void {
  try {
    window.localStorage.setItem('conqueror.nombre', nombre);
  } catch {
    /* modo privado: seguimos sin recordar */
  }
}

/** Setup para el cliente: los jugadores vienen de la especificacion del server. */
export function setupDeBienvenida(spec: GameSpec): LocalGameSetup {
  return {
    players: spec.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      bot: (spec.botPlayers ?? []).includes(player.id),
    })),
    seed: spec.seed,
    config: spec.config,
    botPlayers: [...(spec.botPlayers ?? [])],
  };
}

export function renderOnline(contenedor: HTMLElement, opciones: OnlineOpciones): void {
  contenedor.replaceChildren();

  const centro = nodo(
    'section',
    'pointer-events-auto mx-auto w-full max-w-xl self-center rounded-xl border border-lana-3/70 bg-lana/90 p-6 shadow-xl shadow-hilo/60 backdrop-blur-sm',
  );

  const volver = document.createElement('a');
  volver.href = './';
  volver.className =
    'mb-4 inline-flex items-center gap-1.5 text-[11px] text-algodon/50 hover:text-qolli';
  volver.textContent = `← ${t('landing.pie.volver')}`;
  centro.append(volver);

  centro.append(
    nodo('h1', 'font-display text-2xl tracking-wide text-qolli', t('online.titulo')),
    nodo('p', 'mt-1 text-sm text-algodon/60', t('online.descripcion')),
  );

  const error = nodo('p', 'mt-3 hidden text-sm text-grana');
  const mostrarError = (mensaje: string): void => {
    error.textContent = mensaje;
    error.classList.remove('hidden');
  };
  centro.append(error);

  // --- Formas de entrar -----------------------------------------------------------
  const campoNombre = document.createElement('input');
  campoNombre.type = 'text';
  campoNombre.maxLength = 20;
  campoNombre.placeholder = t('online.nombre');
  campoNombre.value = nombreGuardado();
  campoNombre.className =
    'w-full rounded border border-lana-3 bg-hilo/80 px-3 py-2 text-sm text-algodon';

  const campoCodigo = document.createElement('input');
  campoCodigo.type = 'text';
  campoCodigo.maxLength = 12;
  campoCodigo.placeholder = t('online.codigo');
  campoCodigo.className =
    'w-full rounded border border-lana-3 bg-hilo/80 px-3 py-2 text-sm text-algodon';

  const crear = boton(
    t('online.crear'),
    () => {
      void entrar(true, campoNombre.value);
    },
    { primario: true, dato: { accion: 'crear-sala' } },
  );
  const unirse = boton(
    t('online.unirse'),
    () => {
      void entrar(false, campoNombre.value, campoCodigo.value);
    },
    { dato: { accion: 'unirse' } },
  );

  const fila = nodo('div', 'mt-5 flex flex-wrap items-end gap-3');
  fila.append(
    campo(t('online.nombre'), campoNombre),
    campo(t('online.codigo'), campoCodigo),
    nodo('div', 'flex gap-2', undefined),
  );
  fila.lastElementChild?.append(crear, unirse);
  centro.append(fila);

  const envoltorio = nodo('div', 'flex min-h-full flex-col justify-center p-4');
  envoltorio.append(centro);
  contenedor.append(envoltorio);

  // Link compartido (?sala=CODE): se une de una.
  if (opciones.codigoInicial !== undefined && opciones.codigoInicial.length > 0) {
    campoCodigo.value = opciones.codigoInicial;
    window.setTimeout(() => {
      void entrar(false, campoNombre.value, opciones.codigoInicial ?? '');
    }, 0);
  }

  // --- Conexion --------------------------------------------------------------------

  async function entrar(crearSala: boolean, nombreCrudo: string, codigo = ''): Promise<void> {
    error.classList.add('hidden');
    const nombre = nombreCrudo.trim() || t('online.jugador');
    guardarNombre(nombre);

    try {
      const client = new Client(endpointOnline());
      const sala: RoomColyseus = crearSala
        ? await client.create('conqueror', { name: nombre })
        : await client.joinById(codigo.trim(), { name: nombre });
      if (crearSala) {
        mostrarSala(sala, opciones);
        return;
      }
      // Union a sala existente: si ya arranco, se ve como espectador.
      const transporte = ColyseusTransport.desdeSala(sala);
      const bienvenida = await transporte.saludar();
      if (bienvenida.state !== null) {
        opciones.onStart(setupDeBienvenida(bienvenida.spec), transporte, bienvenida.playerId);
        return;
      }
      const anfitrion = bienvenida.seats.find((asiento) => asiento.host);
      mostrarSala(sala, opciones, transporte, anfitrion?.playerId === bienvenida.playerId);
    } catch (fallo) {
      mostrarError(fallo instanceof Error && fallo.message ? fallo.message : t('online.error'));
    }
  }

  /** Sala con asientos en vivo: el host espera, completa con bots y arranca. */
  function mostrarSala(
    sala: RoomColyseus,
    opcionesOnline: OnlineOpciones,
    transporte: ColyseusTransport = ColyseusTransport.desdeSala(sala),
    esHost = true,
  ): void {
    let asientos: SeatInfo[] = [];
    let fase: 'lobby' | 'playing' | 'over' = 'lobby';
    let configurada = false;
    let arranco = false;
    let botsExtra = 0;

    centro.replaceChildren();

    const volverSala = document.createElement('a');
    volverSala.href = './';
    volverSala.className =
      'mb-4 inline-flex items-center gap-1.5 text-[11px] text-algodon/50 hover:text-qolli';
    volverSala.textContent = `← ${t('landing.pie.volver')}`;
    centro.append(volverSala);
    centro.append(nodo('h1', 'font-display text-2xl tracking-wide text-qolli', t('online.sala')));

    const link = `${window.location.origin}${window.location.pathname}?sala=${sala.roomId}`;
    const lineaLink = nodo('div', 'mt-3 rounded border border-lana-3/60 bg-hilo/50 p-3');
    lineaLink.append(
      nodo('p', 'text-[11px] uppercase tracking-wider text-algodon/50', t('online.link')),
      nodo('p', 'mt-1 break-all text-xs text-qolli', link),
    );
    const copiar = boton(
      t('online.copiar'),
      () => {
        void navigator.clipboard
          ?.writeText(link)
          .then(() => {
            copiar.textContent = t('online.copiado');
          })
          .catch(() => undefined);
      },
      { pequeno: true },
    );
    lineaLink.append(copiar);
    centro.append(lineaLink);

    const lista = nodo('div', 'mt-4 grid gap-2');
    centro.append(lista);

    // --- Bots de relleno (el host completa la partida) ------------------------------
    const contadorBots = nodo('div', 'mt-4 flex items-center gap-3');
    const valorBots = nodo('span', 'text-lg font-semibold text-qolli', String(botsExtra));
    const cambiarBots = (delta: number): void => {
      const siguiente = Math.min(
        DEFAULT_RULES_CONFIG.players.max - Math.max(1, asientos.filter((a) => a.connected).length),
        Math.max(0, botsExtra + delta),
      );
      if (siguiente === botsExtra) return;
      botsExtra = siguiente;
      valorBots.textContent = String(botsExtra);
      pintarSala();
    };
    for (const delta of [-1, 1] as const) {
      contadorBots.append(
        boton(delta < 0 ? '−' : '+', () => cambiarBots(delta), { pequeno: true }),
      );
    }
    contadorBots.append(valorBots);
    const etiquetaBots = nodo(
      'span',
      'text-[11px] uppercase tracking-wider text-algodon/50',
      t('online.bots'),
    );
    contadorBots.prepend(etiquetaBots);
    centro.append(contadorBots);

    const empezar = boton(
      t('online.empezar'),
      () => {
        void configurar();
      },
      { primario: true, dato: { accion: 'empezar-online' } },
    );
    const pie = nodo('div', 'mt-5 flex flex-wrap items-center gap-3');
    pie.append(empezar, nodo('span', 'text-[11px] text-algodon/45', t('online.esperando')));
    centro.append(pie);

    const bajaAsientos = sala.onMessage('seats', ((
      mensaje: Extract<ServerMessage, { kind: 'seats' }>,
    ) => {
      asientos = [...mensaje.seats];
      fase = mensaje.fase;
      pintarSala();
      if (fase === 'playing' && !arranco) void arrancar();
    }) as never) as () => void;

    function pintarSala(): void {
      lista.replaceChildren();
      const ordenados = [...asientos].sort((a, b) => a.playerId.localeCompare(b.playerId));
      if (ordenados.length === 0) {
        lista.append(nodo('p', 'text-sm text-algodon/55', t('online.sinJugadores')));
      }
      for (const [indice, asiento] of ordenados.entries()) {
        const fila = nodo(
          'div',
          'flex items-center gap-2 rounded border border-lana-3/60 bg-hilo/50 px-3 py-2 text-sm',
        );
        const punto = nodo('span', 'inline-block h-3 w-3 shrink-0 rounded-full');
        punto.style.backgroundColor = `#${colorHex(
          (PLAYER_COLOR_ORDER[indice] ?? 'rojo') as PlayerColorId,
        )}`;
        const etiquetas = nodo('div', 'flex items-center gap-2');
        if (asiento.host) {
          etiquetas.append(nodo('span', 'text-[10px] uppercase text-qolli', t('online.host')));
        }
        if (!asiento.connected) {
          etiquetas.append(nodo('span', 'text-[10px] text-algodon/40', t('online.desconectado')));
        }
        fila.append(punto, nodo('span', 'flex-1 text-algodon', asiento.name), etiquetas);
        lista.append(fila);
      }
      const humanos = ordenados.filter((asiento) => asiento.connected).length;
      empezar.disabled = !esHost || humanos + botsExtra < DEFAULT_RULES_CONFIG.players.min;
    }

    function setupDelHost(): LocalGameSetup {
      const jugando = [...asientos]
        .filter((asiento) => asiento.connected)
        .sort((a, b) => a.playerId.localeCompare(b.playerId));
      const total = Math.max(
        DEFAULT_RULES_CONFIG.players.min,
        Math.min(DEFAULT_RULES_CONFIG.players.max, jugando.length + botsExtra),
      );
      const players = Array.from({ length: total }, (_, indice) => {
        const asiento = jugando[indice];
        return {
          id: `p${indice + 1}`,
          name: asiento?.name ?? `Bot ${indice + 1}`,
          color: (PLAYER_COLOR_ORDER[indice] ?? 'rojo') as PlayerColorId,
          bot: asiento === undefined,
        };
      });
      return {
        players,
        seed: Math.floor(Math.random() * 9_000_000) + 1_000_000,
        config: DEFAULT_RULES_CONFIG,
        botPlayers: players.filter((player) => player.bot).map((player) => player.id),
      };
    }

    async function configurar(): Promise<void> {
      if (configurada) return;
      configurada = true;
      const spec: GameSpec = setupDelHost();
      (sala.send as (tipo: string, mensaje: unknown) => void)('configure', { spec });
    }

    async function arrancar(): Promise<void> {
      arranco = true;
      bajaAsientos();
      const bienvenida = await transporte.saludar();
      opcionesOnline.onStart(setupDeBienvenida(bienvenida.spec), transporte, bienvenida.playerId);
    }

    pintarSala();
    // Pide asientos apenas entra: el resto de la sala ya estaba conectada.
    (sala.send as (tipo: string, mensaje: unknown) => void)('hola', {});
  }
}
