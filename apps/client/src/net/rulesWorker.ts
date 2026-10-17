/**
 * Worker del modo local.
 *
 * Corre el motor de reglas (`packages/rules`, puro) FUERA del hilo principal:
 * la UI y el render nunca se bloquean con la logica, ni con las partidas de
 * los bots. El worker mantiene el estado COMPLETO (tarjetas y misiones
 * incluidas) y solo manda la vista publica del jugador de turno: igual que
 * haria el servidor autoritativo en el modo online (Hito 6).
 *
 * Protocolo (los pedidos llevan `id`, las respuestas lo repiten; los pasos de
 * bot no tienen pedido y por eso no llevan `id`):
 *   -> { id, kind: 'create'; spec; delayMs }
 *   -> { id, kind: 'command'; command }
 *   -> { kind: 'stopAuto' }
 *   <- { id, kind: 'created'; state }
 *   <- { id, kind: 'applied'; state; events }
 *   <- { id, kind: 'rejected'; code; message }
 *   <- { kind: 'auto'; state; events }
 *   <- { kind: 'autoFailed'; code; message }
 *
 * Ver docs/adr/0013-modo-local.md
 */

import type { Command, PlayerSetup } from '@conqueror/rules';
import type { RulesConfig } from '@conqueror/shared';

import { GameCore, startAutoPlay } from './engineCore.js';

/** Scope minimo del worker, sin depender de `lib.webworker`. */
interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

const ctx = globalThis as unknown as WorkerScope;

interface Pedido {
  readonly id: number;
  readonly kind: 'create' | 'command' | 'stopAuto';
  readonly spec?: {
    readonly players: readonly PlayerSetup[];
    readonly config: RulesConfig;
    readonly seed: number;
    readonly botPlayers?: readonly string[];
    readonly botSeed?: number;
  };
  readonly delayMs?: number;
  readonly command?: Command;
}

let core: GameCore | null = null;
let detenerAuto: (() => void) | null = null;
let delayActual = 0;

const post = (mensaje: unknown): void => ctx.postMessage(mensaje);

/** (Re)programa los bots si el jugador de turno lo es. */
function programarAuto(): void {
  detenerAuto?.();
  detenerAuto = null;
  if (core === null) return;
  detenerAuto = startAutoPlay(core, delayActual, (resultado) => {
    if (resultado.ok) {
      post({ kind: 'auto', state: resultado.state, events: resultado.events });
    } else {
      post({ kind: 'autoFailed', code: resultado.code, message: resultado.message });
    }
  });
}

ctx.addEventListener('message', (event: MessageEvent) => {
  const mensaje = event.data as Pedido;
  if (mensaje === null || typeof mensaje !== 'object') return;

  switch (mensaje.kind) {
    case 'create': {
      if (mensaje.spec === undefined) return;
      core = new GameCore();
      delayActual = mensaje.delayMs ?? 0;
      try {
        const state = core.create(mensaje.spec);
        post({ id: mensaje.id, kind: 'created', state });
        programarAuto();
      } catch (error) {
        post({
          id: mensaje.id,
          kind: 'rejected',
          code: 'BAD_SETUP',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    case 'command': {
      if (core === null) {
        post({
          id: mensaje.id,
          kind: 'rejected',
          code: 'NOT_STARTED',
          message: 'La partida no esta armada',
        });
        return;
      }
      if (mensaje.command === undefined) return;
      const resultado = core.send(mensaje.command);
      if (resultado.ok) {
        post({ id: mensaje.id, kind: 'applied', state: resultado.state, events: resultado.events });
        // Si el turno quedo en manos de un bot, sigue jugando solo.
        programarAuto();
      } else {
        post({
          id: mensaje.id,
          kind: 'rejected',
          code: resultado.code,
          message: resultado.message,
        });
      }
      return;
    }

    case 'stopAuto': {
      detenerAuto?.();
      detenerAuto = null;
      return;
    }

    default:
      return;
  }
});
