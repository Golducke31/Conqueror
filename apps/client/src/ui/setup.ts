/**
 * Pantalla de configuracion de partida local (Hito 4).
 *
 * De aca sale el `LocalGameSetup` que consume `matchApp`: quienes juegan,
 * cuantos son bots, con que reglas y con que semilla. Todo sale de
 * `RulesConfig` (nada hardcodeado): la cantidad de jugadores la limita
 * `config.players`, la victoria se elige entre las estrategias que soporta el
 * motor.
 *
 * La landing/lobby con scroll narrativo (Lenis + GSAP) llega en el Hito 5;
 * esta pantalla es lo minimo para jugar.
 */

import type { PlayerColorId, RulesConfig } from '@conqueror/shared';
import { PLAYER_COLOR_ORDER } from '@conqueror/shared';

import { t } from '../app/i18n.js';
import { boton, campo, nodo, selector } from './dom.js';

export interface LocalPlayerSetup {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColorId;
  /** Si lo juega el bot nivel 1. */
  readonly bot: boolean;
}

export interface LocalGameSetup {
  readonly players: readonly LocalPlayerSetup[];
  readonly seed: number;
  readonly config: RulesConfig;
  /** Ids de los jugadores que juega el bot. */
  readonly botPlayers: readonly string[];
}

export interface SetupOpciones {
  readonly config: RulesConfig;
  readonly onStart: (setup: LocalGameSetup) => void;
}

/** Nombres por defecto de los jugadores. */
function nombrePorDefecto(indice: number, total: number): string {
  if (total === 2) return indice === 0 ? 'Jugador 1' : 'Jugador 2';
  return `Jugador ${indice + 1}`;
}

/** Semilla aleatoria de 7 digitos (fecha + azar), para partidas no reproducibles. */
function semillaAleatoria(): number {
  return Math.floor(Math.random() * 9_000_000) + 1_000_000;
}

export function renderSetup(contenedor: HTMLElement, opciones: SetupOpciones): void {
  const config = opciones.config;
  const minimo = config.players.min;
  const maximo = config.players.max;

  let cantidad = Math.min(maximo, Math.max(minimo, 3));
  let estrategia = config.victory.strategy;
  const bots = new Set<number>();
  const nombres = new Map<number, string>();

  contenedor.replaceChildren();

  const centro = nodo(
    'section',
    'pointer-events-auto mx-auto w-full max-w-xl self-center rounded-xl border border-lana-3/70 bg-lana/90 p-6 shadow-xl shadow-hilo/60 backdrop-blur-sm',
  );

  centro.append(
    nodo('h1', 'font-display text-2xl tracking-wide text-qolli', t('app.nombre')),
    nodo('p', 'mt-1 text-sm text-algodon/60', t('setup.descripcion')),
  );

  // --- Cantidad de jugadores -------------------------------------------------
  const contador = nodo('div', 'mt-5 flex items-center gap-3');
  contador.append(
    nodo('span', 'text-[11px] uppercase tracking-wider text-algodon/50', t('setup.jugadores')),
  );
  const valorCantidad = nodo('span', 'text-lg font-semibold text-qolli', String(cantidad));
  for (const delta of [-1, 1] as const) {
    contador.append(
      boton(
        delta < 0 ? '−' : '+',
        () => {
          const siguiente = Math.min(maximo, Math.max(minimo, cantidad + delta));
          if (siguiente === cantidad) return;
          if (delta < 0) {
            bots.delete(cantidad - 1);
            nombres.delete(cantidad - 1);
          }
          cantidad = siguiente;
          valorCantidad.textContent = String(cantidad);
          pintarJugadores();
        },
        { pequeno: true },
      ),
    );
  }
  contador.append(valorCantidad);
  centro.append(contador);

  // --- Jugadores --------------------------------------------------------------
  const lista = nodo('div', 'mt-4 grid gap-2');
  centro.append(lista);

  const pintarJugadores = (): void => {
    lista.replaceChildren();
    for (let indice = 0; indice < cantidad; indice += 1) {
      const fila = nodo(
        'div',
        'flex items-center gap-2 rounded border border-lana-3/60 bg-hilo/50 px-3 py-2',
      );

      const punto = nodo('span', 'inline-block h-3.5 w-3.5 shrink-0 rounded-full');
      const color = (PLAYER_COLOR_ORDER[indice] ?? 'rojo') as PlayerColorId;
      punto.style.backgroundColor = `#${colorHex(color)}`;

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 20;
      input.value = nombres.get(indice) ?? nombrePorDefecto(indice, cantidad);
      input.placeholder = nombrePorDefecto(indice, cantidad);
      input.className =
        'min-w-0 flex-1 rounded border border-lana-3 bg-hilo/80 px-2 py-1 text-sm text-algodon';
      input.addEventListener('input', () => nombres.set(indice, input.value));

      const etiqueta = document.createElement('label');
      etiqueta.className = 'flex shrink-0 items-center gap-1.5 text-[11px] text-algodon/60';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'h-3.5 w-3.5 accent-qolli';
      check.checked = bots.has(indice);
      check.addEventListener('change', () => {
        if (check.checked) bots.add(indice);
        else bots.delete(indice);
      });
      etiqueta.append(check, nodo('span', '', t('setup.bot')));

      fila.append(punto, input, etiqueta);
      lista.append(fila);
    }
  };

  // --- Reglas ------------------------------------------------------------------
  const grid = nodo('div', 'mt-5 grid grid-cols-2 gap-3');
  const selectorEstrategia = selector(
    [
      ['secret-missions', t('setup.misiones')],
      ['common-objective', t('setup.objetivo', { n: config.victory.commonObjectiveTerritories })],
    ],
    estrategia,
    (valor) => {
      estrategia = valor as RulesConfig['victory']['strategy'];
    },
  );
  const inputSemilla = document.createElement('input');
  inputSemilla.type = 'number';
  inputSemilla.placeholder = t('setup.semillaAyuda');
  inputSemilla.className =
    'w-full rounded border border-lana-3 bg-hilo/80 px-2 py-1 text-xs text-algodon';
  grid.append(
    campo(t('setup.victoria'), selectorEstrategia),
    campo(t('setup.semilla'), inputSemilla),
  );
  centro.append(grid);

  // --- Acciones -----------------------------------------------------------------
  const acciones = nodo('div', 'mt-6 flex flex-wrap items-center gap-3');
  const todosBots = (): void => {
    bots.clear();
    for (let indice = 0; indice < cantidad; indice += 1) bots.add(indice);
    pintarJugadores();
  };
  acciones.append(
    boton(
      t('setup.empezar'),
      () => {
        const players: LocalPlayerSetup[] = [];
        for (let indice = 0; indice < cantidad; indice += 1) {
          const nombre = nombres.get(indice) ?? nombrePorDefecto(indice, cantidad);
          players.push({
            id: `p${indice + 1}`,
            name: (bots.has(indice) ? `Bot ${nombre.replace(/^Bot /, '')}` : nombre).slice(0, 24),
            color: (PLAYER_COLOR_ORDER[indice] ?? 'rojo') as PlayerColorId,
            bot: bots.has(indice),
          });
        }
        const semilla = Number.parseInt(inputSemilla.value, 10);
        opciones.onStart({
          players,
          seed: Number.isFinite(semilla) && semilla > 0 ? semilla : semillaAleatoria(),
          config: {
            ...config,
            victory: { ...config.victory, strategy: estrategia },
          },
          botPlayers: players.filter((player) => player.bot).map((player) => player.id),
        });
      },
      { primario: true, dato: { accion: 'empezar' } },
    ),
    boton(t('setup.todosBots'), todosBots, { pequeno: true }),
    nodo('span', 'text-[11px] text-algodon/45', t('setup.notaBots')),
  );
  centro.append(acciones);

  const envoltorio = nodo('div', 'flex min-h-full flex-col justify-center p-4');
  envoltorio.append(centro);
  contenedor.append(envoltorio);

  pintarJugadores();
}

/** Hex de un color de jugador, para el punto de la lista. */
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
